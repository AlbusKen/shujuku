import { describe, expect, it } from 'vitest';
import { buildEmptyWorldSimulationLedger_ACU } from '../../../src/service/simulation/defaults';
import { createWorldSimulationReadGateState_ACU } from '../../../src/service/simulation/agent/agent-read-gate';
import { queryGatedWorldRecallRound_ACU } from '../../../src/service/simulation/world-recall-gate';
import { planWorldProjectionChecks_ACU } from '../../../src/service/simulation/world-projection-check';
import type { WorldFact_ACU } from '../../../src/service/simulation/model';

function fact(id: string, overrides: Partial<WorldFact_ACU> = {}): WorldFact_ACU {
  return { id, summary: `保密正文${id}`, temporalKind: 'occurrence', happenedAt: { day: 2, slot: '' },
    validFrom: null, validUntil: null, locationRef: { region: '上海', place: '广场' }, actorIds: [], worldEventIds: [],
    projectionPolicy: 'gated', revealState: 'locked', revealGate: { semanticCondition: '主动询问',
      actorIds: ['actor-1'], locationRef: { region: '上海', place: '广场' } }, nextCheck: { day: 2, slot: '', reason: '复核' },
    sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1, ...overrides };
}
const limits = { actorsPerPage: 8, recentHistoryPerActor: 2, relatedHistoryPerActor: 1, eventsPerPage: 8, factsPerPage: 8 };
const scene = { region: '上海', place: '广场' };
const count = async (text: string) => text.length;

describe('格林正文投影安全规划', () => {
  it('附近已解锁场景事实仅列 ID；锁定事实只能等待语义审查，未触发保持 blocked', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.clock.day = 2;
    ledger.actors = [{ id: 'actor-1', name: '当事人', interests: [], location: '', locationRef: null,
      life: 'alive', diedAtDay: null, deathSummary: null, resources: [], goals: [], constraints: [],
      informationSources: [], knownFacts: [], visibility: 'hidden', currentAction: null,
      shortTermAction: null, longTermAction: null, simulationStatus: 'active', loreRefs: [], experiences: [], revision: 1 }];
    ledger.facts = [fact('scene-1', { projectionPolicy: 'scene', revealState: 'unlocked', revealGate: null }),
      fact('secret-ready'), fact('secret-blocked', { revealGate: { semanticCondition: '主动寻找', actorIds: ['actor-2'] } }),
      fact('secret-time-blocked', { revealGate: { semanticCondition: '主动寻找', notBefore: { day: 2, slot: '午后' } } })];
    const snapshot = structuredClone(ledger);
    const state = createWorldSimulationReadGateState_ACU();
    const round = await queryGatedWorldRecallRound_ACU(ledger, ledger.clock, scene, limits,
      state, { historyTokenBudget: 50000, readTokenBudget: 10000, fallbackTokens: 100 }, 0, count);
    if (!round.allowed) throw new Error('expected grant');
    const result = planWorldProjectionChecks_ACU(ledger, round.grant, ledger.clock, scene, ['actor-1'], state);
    expect(result.sceneFactIds).toEqual(['scene-1']);
    expect(result.semanticCheckIds).toEqual(['secret-ready']);
    expect(result.blockedFactIds).toHaveLength(2);
    expect(result.blockedFactIds).toEqual(expect.arrayContaining(['secret-blocked', 'secret-time-blocked']));
    expect(JSON.stringify(result)).not.toContain('保密正文');
    expect(ledger).toEqual(snapshot);
  });

  it('接触清单中的未知人物不能通过 gated fact 的结构门槛', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.clock.day = 2;
    ledger.facts = [fact('unknown-contact')];
    const state = createWorldSimulationReadGateState_ACU();
    const round = await queryGatedWorldRecallRound_ACU(ledger, ledger.clock, scene, limits,
      state, { historyTokenBudget: 50000, readTokenBudget: 10000, fallbackTokens: 100 }, 0, count);
    if (!round.allowed) throw new Error('expected grant');
    expect(planWorldProjectionChecks_ACU(ledger, round.grant, ledger.clock, scene, ['actor-1'], state)).toEqual({
      sceneFactIds: [], semanticCheckIds: [], blockedFactIds: ['unknown-contact'],
    });
    expect(ledger.facts[0].revealState).toBe('locked');
  });

  it('账本变化令旧许可失效，世界内部到期事实不自动出现在正文候选', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.clock.day = 2;
    ledger.facts = [fact('internal-1', { projectionPolicy: 'internal', revealGate: null })];
    const state = createWorldSimulationReadGateState_ACU();
    const round = await queryGatedWorldRecallRound_ACU(ledger, ledger.clock, scene, limits,
      state, { historyTokenBudget: 50000, readTokenBudget: 10000, fallbackTokens: 100 }, 0, count);
    if (!round.allowed) throw new Error('expected grant');
    expect(planWorldProjectionChecks_ACU(ledger, round.grant, ledger.clock, scene, [], state)).toEqual({
      sceneFactIds: [], semanticCheckIds: [], blockedFactIds: [],
    });
    ledger.facts[0].summary = '更新后的事实';
    expect(() => planWorldProjectionChecks_ACU(ledger, round.grant, ledger.clock, scene, [], state)).toThrow(/整轮召回许可/);
  });
});
