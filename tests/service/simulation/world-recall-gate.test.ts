import { describe, expect, it } from 'vitest';
import { buildEmptyWorldSimulationLedger_ACU } from '../../../src/service/simulation/defaults';
import { createWorldSimulationReadGateState_ACU } from '../../../src/service/simulation/agent/agent-read-gate';
import { queryGatedWorldRecallPage_ACU, queryGatedWorldRecallRound_ACU } from '../../../src/service/simulation/world-recall-gate';
import { buildWorldRecallIndex_ACU } from '../../../src/service/simulation/world-recall-index';
import type { WorldActor_ACU, WorldFact_ACU } from '../../../src/service/simulation/model';

const limits = { actorsPerPage: 8, recentHistoryPerActor: 2, relatedHistoryPerActor: 1, eventsPerPage: 8, factsPerPage: 8 };
const count = async (text: string) => text.length;
function actor(id: string): WorldActor_ACU {
  return { id, name: id, interests: [], location: '', locationRef: null, life: 'alive', diedAtDay: null,
    deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [], knownFacts: [],
    visibility: 'hidden', currentAction: null, longTermAction: null, shortTermAction: null,
    simulationStatus: 'active', loreRefs: [], experiences: [], revision: 1 };
}
function fact(id: string): WorldFact_ACU {
  return { id, summary: 'LOCKED_SECRET_NEVER_IN_RESPONSE', temporalKind: 'occurrence',
    happenedAt: { day: 1, slot: '' }, validFrom: null, validUntil: null, locationRef: null,
    actorIds: [], worldEventIds: [], projectionPolicy: 'gated', revealState: 'locked',
    revealGate: { condition: '主动寻找' }, nextCheck: { day: 1, slot: '', reason: '复核' },
    sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 };
}

describe('新召回页读取预算门禁', () => {
  it('超预算整页拒绝且不返回秘密、ID 或 cursor；缩小预算后可重试同一页', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = [actor('actor-1'), actor('actor-2')];
    ledger.facts = [fact('secret-1')];
    const index = buildWorldRecallIndex_ACU(ledger);
    const state = createWorldSimulationReadGateState_ACU();
    const config = { historyTokenBudget: 1000, readTokenBudget: 10, fallbackTokens: 5 };
    const rejected = await queryGatedWorldRecallPage_ACU(index, ledger.actors, ledger.clock, null, limits, null,
      state, config, 0, count);
    expect(rejected).toMatchObject({ allowed: false, reason: 'read-batch-too-large' });
    expect(rejected).not.toHaveProperty('manifest');
    expect(rejected).not.toHaveProperty('nextCursor');
    expect(JSON.stringify(rejected)).not.toContain('secret-1');
    expect(JSON.stringify(rejected)).not.toContain('LOCKED_SECRET_NEVER_IN_RESPONSE');
    expect(state.grantedTokens).toBe(0);
    const accepted = await queryGatedWorldRecallPage_ACU(index, ledger.actors, ledger.clock, null, limits, null,
      state, { ...config, readTokenBudget: 1000 }, 0, count);
    expect(accepted.allowed).toBe(true);
    if (!accepted.allowed) throw new Error('expected accepted page');
    expect(accepted.manifest.projectionCheckIds).toEqual(['secret-1']);
    expect(state.grantedTokens).toBe(accepted.tokens);
    expect(JSON.stringify(accepted)).not.toContain('LOCKED_SECRET_NEVER_IN_RESPONSE');
  });

  it('整轮后页失败时不泄漏前页、不消耗已授权额度，全部通过才公开所有人物', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = Array.from({ length: 5 }, (_, i) => actor(`actor-${i}`));
    const index = buildWorldRecallIndex_ACU(ledger);
    const state = createWorldSimulationReadGateState_ACU();
    state.grantedTokens = 7;
    const paging = { ...limits, actorsPerPage: 2, eventsPerPage: 2, factsPerPage: 2 };
    const config = { historyTokenBudget: 10000, readTokenBudget: 1000, fallbackTokens: 100 };
    const first = await queryGatedWorldRecallPage_ACU(index, ledger.actors, ledger.clock, null, paging, null,
      createWorldSimulationReadGateState_ACU(), config, 0, count);
    if (!first.allowed) throw new Error('first page should fit');
    const rejected = await queryGatedWorldRecallRound_ACU(ledger, ledger.clock, null, paging,
      state, { ...config, readTokenBudget: first.tokens + 7 }, 0, count);
    expect(rejected.allowed).toBe(false);
    expect(rejected).not.toHaveProperty('manifests');
    expect(JSON.stringify(rejected)).not.toContain('actor-0');
    expect(state.grantedTokens).toBe(7);
    const accepted = await queryGatedWorldRecallRound_ACU(ledger, ledger.clock, null, paging,
      state, { ...config, readTokenBudget: 10000 }, 0, count);
    if (!accepted.allowed) throw new Error('round should fit');
    expect(accepted.manifests.flatMap(page => page.actorIds)).toEqual(ledger.actors.map(actor => actor.id));
    expect(state.grantedTokens).toBe(7 + accepted.tokens);
  });

  it('异步 token 计数时账本变化则整轮拒绝签发许可且不占额度', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = [actor('actor-1')];
    const state = createWorldSimulationReadGateState_ACU();
    const changed = async (text: string) => {
      ledger.actors[0].name = '外部改名';
      return text.length;
    };
    const result = await queryGatedWorldRecallRound_ACU(ledger, ledger.clock, null, limits,
      state, { historyTokenBudget: 10000, readTokenBudget: 10000, fallbackTokens: 100 }, 0, changed);
    expect(result).toMatchObject({ allowed: false, reason: 'snapshot-changed' });
    expect(result).not.toHaveProperty('grant');
    expect(state.grantedTokens).toBe(0);
  });

  it('授权页累积计入预算，后续页面不足额时拒绝且不前移 cursor', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = Array.from({ length: 4 }, (_, i) => actor(`actor-${i}`));
    const index = buildWorldRecallIndex_ACU(ledger);
    const state = createWorldSimulationReadGateState_ACU();
    const first = await queryGatedWorldRecallPage_ACU(index, ledger.actors, ledger.clock, null,
      { ...limits, actorsPerPage: 2, eventsPerPage: 2, factsPerPage: 2 }, null, state,
      { historyTokenBudget: 10000, readTokenBudget: 600, fallbackTokens: 100 }, 0, count);
    expect(first.allowed).toBe(true);
    if (!first.allowed) throw new Error('expected first page');
    const second = await queryGatedWorldRecallPage_ACU(index, ledger.actors, ledger.clock, null,
      { ...limits, actorsPerPage: 2, eventsPerPage: 2, factsPerPage: 2 }, first.nextCursor, state,
      { historyTokenBudget: 10000, readTokenBudget: first.tokens, fallbackTokens: 100 }, 0, count);
    expect(second.allowed).toBe(false);
    expect(second).not.toHaveProperty('nextCursor');
    expect(state.grantedTokens).toBe(first.tokens);
  });
});
