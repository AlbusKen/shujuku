import { describe, expect, it } from 'vitest';
import { buildEmptyWorldSimulationLedger_ACU } from '../../../src/service/simulation/defaults';
import { progressionPlan_ACU, seedCircle_ACU } from '../../../src/service/simulation/progression-plan';
import { relevanceGate_ACU } from '../../../src/service/simulation/relevance-gate';
import type { WorldSeed_ACU, WorldSimulationLedger_ACU } from '../../../src/service/simulation/model';

const seed = (patch: Partial<WorldSeed_ACU> = {}): WorldSeed_ACU => ({
  id: 'seed-1', title: '暗流', status: 'active', level: 4, catalyst: '', visibility: 'hidden', actorIds: [],
  location: { region: '北岭' }, expiresAtDay: 40, missedOutcome: null, exposePolicy: 'on_collision',
  evidenceRefs: [], retiredReason: null, revision: 0, ...patch,
});
const ledger = (seeds: WorldSeed_ACU[], day = 20): WorldSimulationLedger_ACU => {
  const next = buildEmptyWorldSimulationLedger_ACU();
  next.clock.day = day;
  next.player = { location: { region: '青阳城' }, locationUpdatedAtDay: day, regionVisits: [], contact: 'open', evidenceRefs: [] };
  next.seeds = seeds;
  return next;
};
const plan = (seeds: WorldSeed_ACU[], daysAdvanced: number, last: Record<string, number> = {}, story = '', day = 20) => {
  const current = ledger(seeds, day);
  return progressionPlan_ACU({
    ledger: current,
    daysAdvanced,
    relevance: relevanceGate_ACU(current, story),
    lastCatalyzedAtDayBySeed: last,
  });
};

describe('progressionPlan R1-R7', () => {
  it('R1 正文未过时间只 tick', () => {
    expect(plan([seed()], 0)[0]).toMatchObject({ seedId: 'seed-1', advance: 'tick', reason: expect.stringContaining('R1') });
  });

  it('R2 圈层频率：核心/中介 3 天，边缘 15 天', () => {
    expect(seedCircle_ACU(seed({ visibility: 'public' }), new Set())).toBe('core');
    expect(seedCircle_ACU(seed({ visibility: 'limited' }), new Set())).toBe('medium');
    expect(seedCircle_ACU(seed({ visibility: 'hidden' }), new Set())).toBe('edge');
    expect(plan([seed({ visibility: 'public' })], 1, { 'seed-1': 18 }, '', 20)[0]).toMatchObject({
      advance: 'tick', reason: expect.stringContaining('R2'), circle: 'core',
    });
    expect(plan([seed({ visibility: 'public' })], 1, { 'seed-1': 17 }, '', 20)[0]).toMatchObject({
      advance: 'catalyze', circle: 'core',
    });
    expect(plan([seed({ visibility: 'hidden' })], 1, { 'seed-1': 10 }, '', 20)[0]).toMatchObject({
      advance: 'tick', reason: expect.stringContaining('R2'), circle: 'edge',
    });
    expect(plan([seed({ visibility: 'hidden' })], 1, { 'seed-1': 5 }, '', 20)[0]).toMatchObject({
      advance: 'catalyze', circle: 'edge',
    });
  });

  it('R4 到期或已结束不推进', () => {
    expect(plan([seed({ expiresAtDay: 10 })], 1, {}, '', 20)[0]).toMatchObject({
      advance: 'none', reason: expect.stringContaining('R4'),
    });
    expect(plan([seed({ status: 'retired', retiredReason: 'missed' })], 1)[0].advance).toBe('none');
  });

  it('R6 碰撞种子优先催化，R7 冷却期内只 tick', () => {
    const collided = seed({ location: { region: '青阳城' }, visibility: 'hidden' });
    expect(plan([collided], 1, {}, '', 20)[0]).toMatchObject({
      advance: 'catalyze', reason: expect.stringContaining('R6'), circle: 'core',
    });
    expect(plan([collided], 1, { 'seed-1': 20 }, '', 20)[0]).toMatchObject({
      advance: 'tick', reason: expect.stringContaining('R7'),
    });
  });
});
