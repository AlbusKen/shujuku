import { describe, expect, it } from 'vitest';
import { buildEmptyWorldSimulationLedger_ACU } from '../../../src/service/simulation/defaults';
import { queryGatedWorldRecallRound_ACU } from '../../../src/service/simulation/world-recall-gate';
import { createWorldSimulationReadGateState_ACU } from '../../../src/service/simulation/agent/agent-read-gate';
import { readGatedWorldRecallAddress_ACU } from '../../../src/service/simulation/world-recall-read';
import type { WorldActor_ACU, WorldFact_ACU } from '../../../src/service/simulation/model';

function actor(id: string): WorldActor_ACU {
  return { id, name: id, interests: [], location: '', locationRef: null, life: 'alive', diedAtDay: null,
    deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [], knownFacts: [],
    visibility: 'hidden', currentAction: null, longTermAction: null, shortTermAction: null,
    simulationStatus: 'active', loreRefs: [], experiences: [], revision: 1 };
}
function fact(id: string): WorldFact_ACU {
  return { id, summary: '不可提前泄漏的秘密身份', temporalKind: 'occurrence', happenedAt: { day: 1, slot: '' },
    validFrom: null, validUntil: null, locationRef: { region: '上海', place: '广场' }, actorIds: [], worldEventIds: [],
    projectionPolicy: 'gated', revealState: 'locked', revealGate: { semanticCondition: '主动寻找' },
    nextCheck: { day: 2, slot: '', reason: '复核' }, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 };
}
const limits = { actorsPerPage: 8, recentHistoryPerActor: 2, relatedHistoryPerActor: 1, eventsPerPage: 8, factsPerPage: 8 };

const config = { historyTokenBudget: 100000, readTokenBudget: 100000, fallbackTokens: 100 };
const count = async (text: string) => text.length;

describe('格林召回分阶段读取权限', () => {
  it('本人获选的冷历史使用原地址精读，归档不放宽他人读取', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = [actor('a'), actor('b')];
    ledger.historyArchive = [{ id: 'cold', summary: '归档中的重要人生节点', happenedAt: { day: 1, slot: '' }, actorIds: ['a'],
      worldEventIds: [], locationRef: null, sourceFactIds: [], importance: 3, category: '人生节点', visibility: 'internal', revision: 1, legacyRefs: [] }];
    const state = createWorldSimulationReadGateState_ACU();
    const round = await queryGatedWorldRecallRound_ACU(ledger, ledger.clock, null, limits, state, config, 0, count);
    if (!round.allowed) throw new Error('expected grant');
    expect(await readGatedWorldRecallAddress_ACU(ledger, round.grant,
      { scope: 'actor', actorId: 'a', address: 'historyMilestones:cold' }, state, config, 0, ledger.clock, null, count))
      .toMatchObject({ status: 'ok', value: ledger.historyArchive[0] });
    expect(await readGatedWorldRecallAddress_ACU(ledger, round.grant,
      { scope: 'actor', actorId: 'b', address: 'historyMilestones:cold' }, state, config, 0, ledger.clock, null, count))
      .toMatchObject({ status: 'denied' });
  });

  it('仅能读取已入清单的本轮人物，不能用声明 scope 绕过地址限制', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = [actor('actor-1'), actor('actor-2')];
    const state = createWorldSimulationReadGateState_ACU();
    const round = await queryGatedWorldRecallRound_ACU(ledger, ledger.clock, null,
      { ...limits, actorsPerPage: 1, eventsPerPage: 1, factsPerPage: 1 },
      state, config, 0, count);
    if (!round.allowed) throw new Error('expected grant');
    expect((await readGatedWorldRecallAddress_ACU(ledger, round.grant, { scope: 'actor', actorId: 'actor-1', address: 'actors:actor-1' }, state, config, 0, ledger.clock, null, count))).toMatchObject({ status: 'ok' });
    expect((await readGatedWorldRecallAddress_ACU(ledger, round.grant, { scope: 'actor', actorId: 'actor-1', address: 'actors:actor-2' }, state, config, 0, ledger.clock, null, count))).toMatchObject({ status: 'denied' });
    expect((await readGatedWorldRecallAddress_ACU(ledger, round.grant, { scope: 'actor', actorId: 'actor-2', address: 'actors:actor-2' }, state, config, 0, ledger.clock, null, count))).toMatchObject({ status: 'ok' });
    expect(await readGatedWorldRecallAddress_ACU(ledger, round.grant, { scope: 'world', address: 'actors:actor-1' }, state, config, 0, ledger.clock, null, count)).toMatchObject({ status: 'denied' });
  });

  it('带冒号的稳定人物 ID 仍可按完整地址精读', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = [actor('actor:one')];
    const state = createWorldSimulationReadGateState_ACU();
    const round = await queryGatedWorldRecallRound_ACU(ledger, ledger.clock, null, limits,
      state, config, 0, count);
    if (!round.allowed) throw new Error('expected grant');
    const result = await readGatedWorldRecallAddress_ACU(ledger, round.grant,
      { scope: 'actor', actorId: 'actor:one', address: 'actors:actor:one' },
      state, config, 0, ledger.clock, null, count);
    expect(result).toMatchObject({ status: 'ok', value: { id: 'actor:one' } });
  });

  it('伪造或修改整轮许可不能放宽读取范围；账本变化令旧许可失效', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = [actor('actor-1')];
    const state = createWorldSimulationReadGateState_ACU();
    const round = await queryGatedWorldRecallRound_ACU(ledger, ledger.clock, null, limits,
      state, config, 0, count);
    if (!round.allowed) throw new Error('expected grant');
    const fake = { ...round.grant };
    expect((await readGatedWorldRecallAddress_ACU(ledger, fake, { scope: 'actor', actorId: 'actor-1', address: 'actors:actor-1' }, state, config, 0, ledger.clock, null, count))).toMatchObject({ status: 'denied' });
    round.manifests[0].actorIds.push('forged');
    ledger.actors.push(actor('forged'));
    expect((await readGatedWorldRecallAddress_ACU(ledger, round.grant, { scope: 'actor', actorId: 'forged', address: 'actors:forged' }, state, config, 0, ledger.clock, null, count))).toMatchObject({ status: 'denied' });
    expect((await readGatedWorldRecallAddress_ACU(ledger, round.grant, { scope: 'actor', actorId: 'actor-1', address: 'actors:actor-1' }, state, config, 0, ledger.clock, null, count))).toMatchObject({ status: 'denied' });
  });

  it('换预算状态或候选地点、时间不能借旧许可精读', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = [actor('actor-1')];
    const state = createWorldSimulationReadGateState_ACU();
    const round = await queryGatedWorldRecallRound_ACU(ledger, ledger.clock, null, limits, state, config, 0, count);
    if (!round.allowed) throw new Error('expected grant');
    const permit = { scope: 'actor' as const, actorId: 'actor-1', address: 'actors:actor-1' as const };
    expect(await readGatedWorldRecallAddress_ACU(ledger, round.grant, permit,
      createWorldSimulationReadGateState_ACU(), config, 0, ledger.clock, null, count)).toMatchObject({ status: 'denied' });
    expect(await readGatedWorldRecallAddress_ACU(ledger, round.grant, permit,
      state, config, 0, { ...ledger.clock, day: 2 }, null, count)).toMatchObject({ status: 'denied' });
    expect(await readGatedWorldRecallAddress_ACU(ledger, round.grant, permit,
      state, config, 0, ledger.clock, { region: '上海', place: '广场' }, count)).toMatchObject({ status: 'denied' });
  });

  it('实际精读受独立预算限制，拒绝不扣额度且不返回人物全文', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = [actor('actor-1')];
    const state = createWorldSimulationReadGateState_ACU();
    const round = await queryGatedWorldRecallRound_ACU(ledger, ledger.clock, null, limits, state, config, 0, count);
    if (!round.allowed) throw new Error('expected grant');
    const before = state.grantedTokens;
    const permit = { scope: 'actor' as const, actorId: 'actor-1', address: 'actors:actor-1' as const };
    const rejected = await readGatedWorldRecallAddress_ACU(ledger, round.grant, permit, state,
      { ...config, readTokenBudget: before + 1 }, 0, ledger.clock, null, count);
    expect(rejected).toMatchObject({ status: 'denied' });
    expect(JSON.stringify(rejected)).not.toContain('informationSources');
    expect(state.grantedTokens).toBe(before);
    const accepted = await readGatedWorldRecallAddress_ACU(ledger, round.grant, permit, state,
      config, 0, ledger.clock, null, count);
    expect(accepted).toMatchObject({ status: 'ok', value: { id: 'actor-1' } });
    expect(state.grantedTokens).toBeGreaterThan(before);
  });

  it('获选冷事实仍须使用原地址与清单权限精读', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.clock.day = 2;
    ledger.actors = [actor('actor-1')];
    ledger.facts = [fact('hot')];
    ledger.factArchive = [{ ...fact('cold-selected'), nextCheck: { day: 2, slot: '', reason: '复核' } }];
    const state = createWorldSimulationReadGateState_ACU();
    const round = await queryGatedWorldRecallRound_ACU(ledger, ledger.clock, { region: '上海', place: '广场' }, limits,
      state, config, 0, count);
    if (!round.allowed) throw new Error('expected grant');
    expect(round.manifests[0].dueFactIds).toEqual(['hot']);
    expect(await readGatedWorldRecallAddress_ACU(ledger, round.grant,
      { scope: 'world', address: 'facts:cold-selected' }, state, config, 0, ledger.clock, { region: '上海', place: '广场' }, count))
      .toMatchObject({ status: 'denied' });
  });

  it('投影阶段只获得 locked fact 的安全目录，不能用自报触发条件读取秘密全文', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = [actor('actor-1')];
    ledger.clock.day = 2;
    ledger.facts = [fact('secret-1'), { ...fact('secret-far'), nextCheck: null,
      locationRef: { region: '北京', place: '远方' } }];
    const state = createWorldSimulationReadGateState_ACU();
    const scene = { region: '上海', place: '广场' };
    const round = await queryGatedWorldRecallRound_ACU(ledger, ledger.clock, scene, limits,
      state, config, 0, count);
    if (!round.allowed) throw new Error('expected grant');
    expect(round.manifests[0].projectionCheckIds).toEqual(['secret-1']);
    const projection = await readGatedWorldRecallAddress_ACU(ledger, round.grant, { scope: 'projection-check', address: 'facts:secret-1' }, state, config, 0, ledger.clock, scene, count);
    expect(projection).toEqual({ status: 'safe-directory', value: { id: 'secret-1', locked: true } });
    expect(JSON.stringify(projection)).not.toContain('不可提前泄漏');
    expect((await readGatedWorldRecallAddress_ACU(ledger, round.grant, { scope: 'projection-check', address: 'facts:secret-far' }, state, config, 0, ledger.clock, scene, count))).toMatchObject({ status: 'denied' });
    expect((await readGatedWorldRecallAddress_ACU(ledger, round.grant, { scope: 'actor', address: 'facts:secret-1' }, state, config, 0, ledger.clock, scene, count))).toMatchObject({ status: 'denied' });
    expect(await readGatedWorldRecallAddress_ACU(ledger, round.grant, { scope: 'world', address: 'facts:secret-1' }, state, config, 0, ledger.clock, scene, count)).toMatchObject({ status: 'ok', value: { summary: '不可提前泄漏的秘密身份' } });
  });
});
