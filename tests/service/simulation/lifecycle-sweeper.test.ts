import { describe, expect, it } from 'vitest';
import { buildDefaultWorldSimulationSettings_ACU, buildEmptyWorldSimulationLedger_ACU } from '../../../src/service/simulation/defaults';
import { sweepWorldLifecycle_ACU } from '../../../src/service/simulation/lifecycle-sweeper';
import { WORLD_PLAYER_REGION_VISITS_CAP_ACU, type WorldActor_ACU, type WorldRumor_ACU, type WorldSeed_ACU, type WorldSimulationLedger_ACU } from '../../../src/service/simulation/model';

const settings = () => {
  const next = buildDefaultWorldSimulationSettings_ACU();
  next.dynamics.rumorTTLDays = 10;
  return next;
};
const ledger = (patch: Partial<WorldSimulationLedger_ACU> = {}): WorldSimulationLedger_ACU => ({
  ...buildEmptyWorldSimulationLedger_ACU(),
  clock: { day: 40, slot: '', storyTime: '第40日', precision: 'exact', evidenceRefs: [] },
  ...patch,
});
const rumor = (patch: Partial<WorldRumor_ACU> = {}): WorldRumor_ACU => ({
  id: 'rumor-1', fact: '铁匠死在北岭', originDay: 1, earliestRevealDay: 2, channels: ['青阳城'],
  relatedActorIds: [], status: 'revealed', revealedAtDay: 5, revision: 1, ...patch,
});
const seed = (patch: Partial<WorldSeed_ACU> = {}): WorldSeed_ACU => ({
  id: 'seed-1', title: '矿难', status: 'retired', level: 1, catalyst: '', visibility: 'hidden', actorIds: [],
  location: { region: '北岭' }, expiresAtDay: 10, missedOutcome: '矿洞塌了', exposePolicy: 'on_collision',
  evidenceRefs: [], retiredReason: 'missed', revision: 1, ...patch,
});
const actor = (patch: Partial<WorldActor_ACU> = {}): WorldActor_ACU => ({
  id: 'actor-1', name: '铁匠', interests: [], location: '北岭', locationRef: { region: '北岭' },
  life: 'dead', diedAtDay: 5, deathSummary: '铁匠死在北岭', resources: [], goals: [], constraints: [],
  informationSources: [], knownFacts: [], visibility: 'public', revision: 1, ...patch,
});

describe('lifecycle sweeper', () => {
  it('revealed 且超过 TTL 的传闻在事实已登记时删除，否则跳过', () => {
    const registered = sweepWorldLifecycle_ACU(ledger({
      rumors: [rumor()],
      chronicle: [{ id: 'ch-1', at: 'd5', summary: '铁匠死在北岭', relatedIds: [], evidenceRefs: [] }],
    }), settings());
    expect(registered.droppedRumorIds).toEqual(['rumor-1']);
    expect(registered.ledger.rumors).toEqual([]);

    const skipped = sweepWorldLifecycle_ACU(ledger({ rumors: [rumor()] }), settings());
    expect(skipped.droppedRumorIds).toEqual([]);
    expect(skipped.skipped).toEqual([expect.objectContaining({ kind: 'rumor', id: 'rumor-1' })]);
    expect(skipped.ledger.rumors).toHaveLength(1);
  });

  it('未超 TTL 或非 revealed 的传闻不删除', () => {
    const fresh = sweepWorldLifecycle_ACU(ledger({
      clock: { day: 8, slot: '', storyTime: '', precision: 'exact', evidenceRefs: [] },
      rumors: [rumor()],
      chronicle: [{ id: 'ch-1', at: 'd5', summary: '铁匠死在北岭', relatedIds: [], evidenceRefs: [] }],
    }), settings());
    expect(fresh.droppedRumorIds).toEqual([]);
    const latent = sweepWorldLifecycle_ACU(ledger({
      rumors: [rumor({ status: 'latent', revealedAtDay: null })],
    }), settings());
    expect(latent.droppedRumorIds).toEqual([]);
  });

  it('resolved/retired 且过期的种子在事实已登记时删除', () => {
    const dropped = sweepWorldLifecycle_ACU(ledger({
      seeds: [seed()],
      chronicle: [{ id: 'ch-1', at: 'd10', summary: '[错过] 矿洞塌了', relatedIds: ['seed-1'], evidenceRefs: [] }],
    }), settings());
    expect(dropped.droppedSeedIds).toEqual(['seed-1']);
    const active = sweepWorldLifecycle_ACU(ledger({ seeds: [seed({ status: 'active', retiredReason: null })] }), settings());
    expect(active.droppedSeedIds).toEqual([]);
    const unregistered = sweepWorldLifecycle_ACU(ledger({ seeds: [seed()] }), settings());
    expect(unregistered.droppedSeedIds).toEqual([]);
    expect(unregistered.skipped[0]?.kind).toBe('seed');
  });

  it('dead actor 超过 2×TTL 且事实已登记时删除', () => {
    const dropped = sweepWorldLifecycle_ACU(ledger({
      actors: [actor()],
      chronicleOverview: [{ fingerprint: 'fp', day: 5, oneLine: '铁匠死在北岭', archiveRef: 'arc-1' }],
    }), settings());
    expect(dropped.droppedActorIds).toEqual(['actor-1']);
    const recent = sweepWorldLifecycle_ACU(ledger({
      clock: { day: 20, slot: '', storyTime: '', precision: 'exact', evidenceRefs: [] },
      actors: [actor()],
      chronicle: [{ id: 'ch-1', at: 'd5', summary: '铁匠死在北岭', relatedIds: ['actor-1'], evidenceRefs: [] }],
    }), settings());
    expect(recent.droppedActorIds).toEqual([]);
  });

  it('regionVisits 接近上限时压缩最老连续同 region 段', () => {
    const visits = [
      ...Array.from({ length: 8 }, (_, index) => ({ region: '青阳城', day: index + 1 })),
      { region: '北岭', day: 20 },
    ];
    while (visits.length < WORLD_PLAYER_REGION_VISITS_CAP_ACU - 1) visits.push({ region: `r${visits.length}`, day: 30 + visits.length });
    const result = sweepWorldLifecycle_ACU(ledger({
      player: { location: { region: '北岭' }, locationUpdatedAtDay: 40, regionVisits: visits, contact: 'open', evidenceRefs: [] },
    }), settings());
    expect(result.compressedRegionVisits).toBe(true);
    expect(result.ledger.player.regionVisits[0]).toEqual({ region: '青阳城', day: 1 });
    expect(result.ledger.player.regionVisits.length).toBeLessThan(visits.length);
  });
});
