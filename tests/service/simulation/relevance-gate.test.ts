import { describe, expect, it } from 'vitest';
import { buildEmptyWorldSimulationLedger_ACU } from '../../../src/service/simulation/defaults';
import { relevanceGate_ACU } from '../../../src/service/simulation/relevance-gate';
import type { WorldRumor_ACU, WorldSeed_ACU, WorldSimulationLedger_ACU } from '../../../src/service/simulation/model';

const seed = (patch: Partial<WorldSeed_ACU> = {}): WorldSeed_ACU => ({
  id: 'seed-1', title: '矿难暗流', status: 'active', level: 12, catalyst: '', visibility: 'hidden', actorIds: ['actor-1'],
  location: { region: '青阳城' }, expiresAtDay: 30, missedOutcome: null, exposePolicy: 'on_collision',
  evidenceRefs: [], retiredReason: null, revision: 0, ...patch,
});
const rumor = (patch: Partial<WorldRumor_ACU> = {}): WorldRumor_ACU => ({
  id: 'rumor-1', fact: '铁匠死在北岭', originDay: 1, earliestRevealDay: 2, channels: ['青阳城'],
  relatedActorIds: ['actor-1'], status: 'ripe', revealedAtDay: null, revision: 0, ...patch,
});
const ledger = (patch: Partial<WorldSimulationLedger_ACU> = {}): WorldSimulationLedger_ACU => {
  const next = buildEmptyWorldSimulationLedger_ACU();
  next.clock.day = 5;
  next.player = { location: { region: '青阳城' }, locationUpdatedAtDay: 5, regionVisits: [], contact: 'open', evidenceRefs: [] };
  next.actors = [{
    id: 'actor-1', name: '铁匠', interests: [], location: '青阳城', locationRef: { region: '青阳城' },
    life: 'alive', diedAtDay: null, deathSummary: null, resources: [], goals: [], constraints: [],
    informationSources: [], knownFacts: [], visibility: 'public', revision: 0,
  }];
  next.seeds = [seed(), seed({ id: 'seed-far', title: '远方税案', location: { region: '临川' }, actorIds: [] })];
  next.rumors = [rumor(), rumor({ id: 'rumor-far', fact: '临川涨水', channels: ['临川'], relatedActorIds: [] })];
  return { ...next, ...patch };
};

describe('relevanceGate 三轨', () => {
  it('空间轨命中同 region 的 active 种子，渠道轨命中 open 且 ripe 的传闻', () => {
    const report = relevanceGate_ACU(ledger(), '无关闲笔');
    expect(report.collided).toEqual(['seed-1']);
    expect(report.collidedSeeds).toEqual(['seed-1']);
    expect(report.reachable).toEqual(['rumor-1']);
    expect(report.ripeRumors).toEqual(['rumor-1']);
    expect(report.unrelated.seeds).toContain('seed-far');
    expect(report.unrelated.rumors).toContain('rumor-far');
  });

  it('secluded 时渠道轨恒空，空间轨仍可命中', () => {
    const base = ledger();
    base.player.contact = 'secluded';
    const report = relevanceGate_ACU(base, '');
    expect(report.reachable).toEqual([]);
    expect(report.ripeRumors).toEqual([]);
    expect(report.secludedNote).toContain('传闻渠道不可用');
    expect(report.collided).toEqual(['seed-1']);
  });

  it('语义轨按正文实体相交，不相关资料仍留在账本', () => {
    const base = ledger();
    const before = JSON.parse(JSON.stringify(base));
    const report = relevanceGate_ACU(base, '铁匠提到远方税案，临川涨水');
    expect(report.semantic).toEqual(expect.arrayContaining(['seed-far', 'rumor-far']));
    expect(report.unrelated.seeds).not.toContain('seed-far');
    expect(base).toEqual(before);
    expect(base.seeds.map(item => item.id)).toEqual(['seed-1', 'seed-far']);
    expect(base.rumors.map(item => item.id)).toEqual(['rumor-1', 'rumor-far']);
  });
});
