import { describe, expect, it } from 'vitest';
import { buildDefaultWorldSimulationSettings_ACU, buildEmptyWorldSimulationLedger_ACU } from '../../../src/service/simulation/defaults';
import type { WorldRumor_ACU, WorldSeed_ACU, WorldSimulationLedger_ACU } from '../../../src/service/simulation/model';
import {
  assertCollisionFulfillment_ACU,
  detectWorldCollisions_ACU,
  filterUnreachableRumorSignals_ACU,
  maintainWorldPlayer_ACU,
  refreshWorldRumors_ACU,
  sweepWorldLedger_ACU,
} from '../../../src/service/simulation/world-dynamics';

const settings = (patch: Partial<ReturnType<typeof buildDefaultWorldSimulationSettings_ACU>['dynamics']> = {}) => {
  const next = buildDefaultWorldSimulationSettings_ACU();
  next.dynamics = { ...next.dynamics, ...patch };
  return next;
};
const clock = (day: number) => ({ day, slot: '', storyTime: `第${day}日`, precision: 'exact' as const, evidenceRefs: [] });
const player = (region: string | null, contact: 'open' | 'secluded', regionVisits: Array<{ region: string; day: number }> = []) => ({
  location: region ? { region } : null, locationUpdatedAtDay: 1, regionVisits, contact, evidenceRefs: [],
});
const seed = (patch: Partial<WorldSeed_ACU> = {}): WorldSeed_ACU => ({
  id: 'seed-1', title: '暗流', status: 'active', level: 1, catalyst: '', visibility: 'hidden', actorIds: [],
  location: { region: '青阳城' }, expiresAtDay: 3, missedOutcome: '矿洞塌了', exposePolicy: 'on_collision',
  evidenceRefs: [], retiredReason: null, revision: 0, ...patch,
});
const rumor = (patch: Partial<WorldRumor_ACU> = {}): WorldRumor_ACU => ({
  id: 'rumor-1', fact: '铁匠死在北岭', originDay: 1, earliestRevealDay: 3, channels: ['青阳城'],
  relatedActorIds: [], status: 'latent', revealedAtDay: null, revision: 0, ...patch,
});
const ledger = (patch: Partial<WorldSimulationLedger_ACU> = {}): WorldSimulationLedger_ACU => ({ ...buildEmptyWorldSimulationLedger_ACU(), ...patch });

describe('world dynamics', () => {
  it('清扫过期种子并让超龄 latent 传闻死亡', () => {
    const result = sweepWorldLedger_ACU(ledger({
      clock: clock(5), seeds: [seed()], rumors: [rumor({ earliestRevealDay: 1 })],
    }), settings({ rumorTTLDays: 2 }));
    expect(result.sweptSeedIds).toEqual(['seed-1']);
    expect(result.ledger.seeds[0]).toMatchObject({ status: 'retired', retiredReason: 'missed', revision: 1 });
    expect(result.ledger.chronicle[0].summary).toBe('[错过] 矿洞塌了');
    expect(result.deadRumorIds).toEqual(['rumor-1']);
  });

  it('missedSweepEnabled=false 时短路', () => {
    const result = sweepWorldLedger_ACU(ledger({ clock: clock(9), seeds: [seed()] }), settings({ missedSweepEnabled: false }));
    expect(result.sweptSeedIds).toEqual([]);
    expect(result.ledger.seeds[0].status).toBe('active');
  });

  it('传闻 latent→ripe→revealed；secluded 不判错过机会', () => {
    const ripe = refreshWorldRumors_ACU(ledger({ clock: clock(3), rumors: [rumor()] }), [], settings());
    expect(ripe.rumors[0].status).toBe('ripe');
    expect(refreshWorldRumors_ACU(ripe, ['rumor-1'], settings()).rumors[0]).toMatchObject({ status: 'revealed', revealedAtDay: 3 });
    const delayed = refreshWorldRumors_ACU(ledger({
      clock: clock(40), player: player('青阳城', 'secluded'), rumors: [rumor({ status: 'ripe' })],
    }), [], settings());
    expect(delayed.rumors[0].status).toBe('ripe');
  });

  it('到访渠道地且超 TTL 则错过；超 2×TTL 彻底过时', () => {
    const missed = refreshWorldRumors_ACU(ledger({
      clock: clock(40), player: player('青阳城', 'open', [{ region: '青阳城', day: 4 }]), rumors: [rumor({ status: 'ripe' })],
    }), [], settings());
    expect(missed.rumors[0].status).toBe('dead');
    expect(refreshWorldRumors_ACU(ledger({
      clock: clock(70), rumors: [rumor({ status: 'ripe' })],
    }), [], settings()).rumors[0].status).toBe('dead');
  });

  it('secluded 时剔除 rumor 信号且不阻断', () => {
    const filtered = filterUnreachableRumorSignals_ACU(
      { signals: [{ text: '客栈传闻', voice: 'rumor', sourceId: 'rumor-1' }, { text: '风声', voice: 'ambient' }], excludedFacts: [], evidenceRefs: [] },
      ledger({ rumors: [rumor({ status: 'ripe' })], player: player('青阳城', 'secluded') }),
    );
    expect(filtered.guidance.signals).toEqual([{ text: '风声', voice: 'ambient' }]);
    expect(filtered.strippedRumorIds).toEqual(['rumor-1']);
  });

  it('碰撞报告命中活跃未过期种子；secluded 时 ripeRumors 为空', () => {
    const open = detectWorldCollisions_ACU(ledger({
      clock: clock(2), player: player('青阳城', 'open'), seeds: [seed(), seed({ id: 'seed-expired', expiresAtDay: 1 })], rumors: [rumor({ status: 'ripe' })],
    }));
    expect(open).toMatchObject({ playerRegion: '青阳城', collidedSeeds: ['seed-1'], ripeRumors: ['rumor-1'], secludedNote: null });
    const closed = detectWorldCollisions_ACU(ledger({ player: player('青阳城', 'secluded'), rumors: [rumor({ status: 'ripe' })] }));
    expect(closed.ripeRumors).toEqual([]);
    expect(closed.secludedNote).toMatch(/传闻渠道不可用/);
  });

  it('碰撞 region 规范化后匹配种子与传闻渠道', () => {
    const report = detectWorldCollisions_ACU(ledger({
      clock: clock(2), player: player('  QingYang  ', 'open'),
      seeds: [seed({ location: { region: 'qingyang' } })], rumors: [rumor({ status: 'ripe', channels: ['QINGYANG'] })],
    }));
    expect(report).toMatchObject({ playerRegion: 'qingyang', collidedSeeds: ['seed-1'], ripeRumors: ['rumor-1'] });
  });

  it('on_collision 未兑现与 latent 传闻泄露记为违规', () => {
    const report = { playerRegion: '青阳城', playerContact: 'open' as const, secludedNote: null, collidedSeeds: ['seed-1'], ripeRumors: [] };
    const base = ledger({ seeds: [seed()], rumors: [rumor()] });
    expect(assertCollisionFulfillment_ACU(report, { signals: [], excludedFacts: [], evidenceRefs: [] }, base)).toEqual(['碰撞种子 seed-1 缺少 encounter 信号']);
    expect(assertCollisionFulfillment_ACU(report, {
      signals: [{ text: '铁匠死在北岭', voice: 'ambient' }, { text: '矿难', voice: 'encounter', sourceId: 'seed-1' }],
      excludedFacts: [], evidenceRefs: [],
    }, base).join('\n')).toMatch(/latent 传闻 rumor-1/);
  });

  it('open 到访写入 regionVisits，secluded 不追加', () => {
    const previous = buildEmptyWorldSimulationLedger_ACU().player;
    const open = maintainWorldPlayer_ACU(ledger({ clock: clock(4), player: player('青阳城', 'open') }), previous);
    expect(open.player).toMatchObject({ locationUpdatedAtDay: 4, regionVisits: [{ region: '青阳城', day: 4 }] });
    expect(maintainWorldPlayer_ACU(ledger({ clock: clock(4), player: player('青阳城', 'secluded') }), previous).player.regionVisits).toEqual([]);
  });
});
