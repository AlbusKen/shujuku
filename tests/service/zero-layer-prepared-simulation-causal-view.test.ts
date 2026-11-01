import { afterEach, describe, expect, it, vi } from 'vitest';
// 上游已停用零层；这里打开功能开关，以继续验证零层存储逻辑。
vi.mock('../../src/service/zero-layer/feature-policy', () => ({
  isZeroLayerFeatureEnabled_ACU: () => true,
  assertZeroLayerFeatureEnabled_ACU: () => undefined,
}));
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../src/service/simulation/defaults';
import { seedLedgerFieldView_ACU } from '../../src/service/simulation/simulation-ledger-fold';
import { buildWorldSimulationProjection_ACU } from '../../src/service/simulation/simulation-projection';
import { commitZeroLayerSimulationRound_ACU } from '../../src/service/zero-layer/simulation-commit';
import { readPreparedSimulationCausalView_ACU } from '../../src/service/zero-layer/prepared-simulation-causal-view';
import { emptyZeroLayerSimulation_ACU, ZeroLayerSimulationStore_ACU } from '../../src/service/zero-layer/simulation-store';
import { ZeroLayerStore_ACU } from '../../src/service/zero-layer/store';
import { emptyZeroLayerContinuation_ACU } from '../../src/service/zero-layer/continuation-store';
import { physicalHistoryFingerprint_ACU, physicalHistorySnapshot_ACU } from '../../src/service/zero-layer/carrier-context';
import { ZERO_LAYER_CARRIER_FIELD_ACU, type ZeroLayerEnvelope_ACU } from '../../src/service/zero-layer/model';
import { validateZeroLayerEnvelope_ACU } from '../../src/service/zero-layer/validation';
import { getTableDataFingerprint_ACU } from '../../src/service/table/table-data-upgrade-audit';
import { _set_SillyTavern_API_ACU } from '../../src/shared/host-api';
import type { WorldRoundCandidate_ACU } from '../../src/service/simulation/world-candidate';
import type { WorldSimulationRunIdentity_ACU } from '../../src/service/simulation/model';

function actor(id: string) {
  return { id, name: '守卫', interests: [], location: '', locationRef: null, life: 'alive' as const,
    diedAtDay: null, deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [],
    knownFacts: [], visibility: 'hidden' as const, currentAction: null, longTermAction: null, shortTermAction: null,
    simulationStatus: 'active' as const, loreRefs: [], experiences: [], revision: 1 };
}

function turnOf(source: ZeroLayerEnvelope_ACU, turnId: string) {
  return source.turns.find(turn => turn.turnId === turnId)!;
}

async function setup() {
  const carrier: Record<string, unknown> = { is_user: false, mes: '物理正文', swipe_id: 0 };
  const chat = [carrier];
  let remote: unknown[] = [];
  const simulation = emptyZeroLayerSimulation_ACU();
  simulation.envelope = buildDefaultWorldSimulationEnvelope_ACU();
  simulation.envelope.ledger.actors = [actor('actor-1')];
  simulation.fields = seedLedgerFieldView_ACU(simulation.envelope.ledger, 1);
  const source: ZeroLayerEnvelope_ACU = {
    schemaVersion: 1, sessionId: 'session-1', scope: { chatId: 'chat-1', characterKey: 'char:card.png' },
    carrierId: 'carrier-1', carrierSwipeId: 0, seedBody: '物理正文',
    activationFingerprint: await physicalHistoryFingerprint_ACU(physicalHistorySnapshot_ACU(chat)),
    activationMessageCount: 1, enabled: true, apiPresetName: '', revision: 1, activeBranchId: 'branch-1',
    branches: [{ branchId: 'branch-1', headTurnId: null, simulation, continuation: emptyZeroLayerContinuation_ACU() }],
    turns: [{ turnId: 'parent-1', branchId: 'branch-1', parentTurnId: null, attemptId: 'parent-attempt', input: '继续',
      body: '已发布逻辑正文', phase: 'response-durable', createdAt: 1, updatedAt: 1,
      userFloor: { floorId: 'parent-user', role: 'user', data: {} },
      assistantFloor: { floorId: 'parent-floor', role: 'assistant', data: { table: {
        floorId: 'parent-floor', tableData: { mate: {} }, completedAiFloorBySheetKey: {}, filledSheetKeys: [],
      } } },
      simulationDeliveryTarget: 'body', requiredEffects: ['simulation'], effectReceipts: [], errorCode: null }],
  };
  carrier[ZERO_LAYER_CARRIER_FIELD_ACU] = validateZeroLayerEnvelope_ACU(source);
  remote = structuredClone(chat);
  _set_SillyTavern_API_ACU({ chat, chatId: 'chat-1', characterId: 0, this_chid: 0,
    characters: [{ avatar: 'card.png', name: '测试角色' }], getCurrentChatId: () => 'chat-1',
    saveChat: vi.fn(async () => { remote = structuredClone(chat); }) } as any);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));

  const store = new ZeroLayerSimulationStore_ACU();
  const anchor = store.anchorForTurn('parent-1');
  const identity: WorldSimulationRunIdentity_ACU = { runId: 'run-1', chatIdentity: store.getChatIdentity(),
    triggerKind: 'assistant_completed', triggerConversationMessageId: null, kind: 'logical', logicalRef: anchor.logicalRef,
    anchorContentDigest: anchor.contentDigest, baseLedgerRevision: 0, taskId: 'task-1', stageId: 'stage-1', stageRevision: 1,
    deliveryTarget: 'body', workflowMode: 'layered', workflowProtocol: 'world-round-v1' };
  await store.updateState(state => {
    state.envelope!.task = { taskId: identity.taskId, originInstruction: '推进', status: 'running', createdAt: 1, updatedAt: 1,
      activeRun: identity, stopReason: null };
    state.envelope!.activeStageId = identity.stageId;
    state.envelope!.stages = [{ stageId: identity.stageId, stageNumber: 1, status: 'running', activeRevision: 1,
      revisions: [{ revision: 1, createdAt: 1, reason: 'initial', replanInstruction: '', frozen: true,
        plan: { schemaVersion: 1, title: '阶段', objective: '推进', impactScope: [], factsToVerify: [], plannedTools: [],
          plannedSpecialists: [], expectedLedgerChanges: [], convergenceConditions: [], blockingConditions: [], completedSteps: [], nextStep: '' } }] }];
  });
  const fact = { id: 'locked-fact', summary: '守卫更换巡逻路线', temporalKind: 'occurrence' as const,
    happenedAt: { day: 2, slot: '' }, validFrom: null, validUntil: null, locationRef: null, actorIds: ['actor-1'], worldEventIds: [],
    projectionPolicy: 'internal' as const, revealState: 'locked' as const, revealGate: null, nextCheck: null,
    sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 };
  const roundCandidate: WorldRoundCandidate_ACU = { baseRevision: 0, candidateClock: { ...store.read()!.ledger.clock, day: 2 },
    worldEventWrites: [], actorWrites: [], factWrites: [{ value: fact, expectedRevision: 0 }],
    historyMilestoneWrites: [], actorCompletions: [{ actorId: 'actor-1', completion: 'no_change', expectedRevision: 1 }],
    projection: { anchor: null, deliveries: [] }, completion: 'changed' };
  await commitZeroLayerSimulationRound_ACU(store, { identity, anchor, roundCandidate, completedAt: 10, timelineId: 'timeline-1', summary: '账本结算' });

  const zeroStore = new ZeroLayerStore_ACU();
  const beforeSettle = store.readSource();
  const settled = await zeroStore.commit({
    type: 'transition-turn', turnId: 'parent-1', attemptId: 'parent-attempt', phase: 'effects-durable',
  }, beforeSettle.revision);
  const published = await zeroStore.commit({
    type: 'transition-turn', turnId: 'parent-1', attemptId: 'parent-attempt', phase: 'published',
  }, settled.revision);

  const skippedPrepared = await zeroStore.commit({
    type: 'prepare-turn', turnId: 'skipped-2', attemptId: 'skipped-attempt', input: '下一步', requiredEffects: [],
  }, published.revision);
  const skippedDispatching = await zeroStore.commit({
    type: 'transition-turn', turnId: 'skipped-2', attemptId: 'skipped-attempt', phase: 'dispatching',
  }, skippedPrepared.revision);
  const skippedResponse = await zeroStore.commit({
    type: 'transition-turn', turnId: 'skipped-2', attemptId: 'skipped-attempt', phase: 'response-durable',
    changes: { body: '已发布但关闭自动推演的逻辑正文' },
  }, skippedDispatching.revision);
  const rawAfterResponse = carrier[ZERO_LAYER_CARRIER_FIELD_ACU] as ZeroLayerEnvelope_ACU;
  const skippedTurn = turnOf(rawAfterResponse, 'skipped-2');
  const parentTable = structuredClone(turnOf(rawAfterResponse, 'parent-1').assistantFloor.data.table) as any;
  parentTable.floorId = skippedTurn.assistantFloor.floorId;
  skippedTurn.assistantFloor.data.table = parentTable;
  const skippedStore = new ZeroLayerSimulationStore_ACU();
  await skippedStore.skipAutomatic(skippedStore.anchorForTurn('skipped-2'));
  const skippedEffect = skippedStore.readSource();
  const skippedSettled = await zeroStore.commit({
    type: 'transition-turn', turnId: 'skipped-2', attemptId: 'skipped-attempt', phase: 'effects-durable',
  }, skippedEffect.revision);
  const skippedPublished = await zeroStore.commit({
    type: 'transition-turn', turnId: 'skipped-2', attemptId: 'skipped-attempt', phase: 'published',
  }, skippedSettled.revision);
  return zeroStore.commit({
    type: 'prepare-turn', turnId: 'prepared-3', attemptId: 'prepared-attempt', input: '下一步', requiredEffects: [],
  }, skippedPublished.revision);
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); _set_SillyTavern_API_ACU(undefined); });

describe('prepared 推演因果视图', () => {
  it('从真实 commit→publish→skipped→publish 链读取最近已确认祖先，分支工作态漂移不污染且深拷贝', async () => {
    const prepared = await setup();
    const view = readPreparedSimulationCausalView_ACU(prepared, 'prepared-3', 'prepared-attempt')!;
    expect(view.source).toMatchObject({ turnId: 'parent-1', attemptId: 'parent-attempt', branchId: 'branch-1', floorId: 'parent-floor' });
    expect(view.facts).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'locked-fact', revealState: 'locked' })]));
    expect(view.facts[0].summary).toBe('守卫更换巡逻路线');
    prepared.branches[0].simulation!.envelope!.ledger.facts[0].summary = '未来工作态';
    expect(readPreparedSimulationCausalView_ACU(prepared, 'prepared-3', 'prepared-attempt')!.facts[0].summary).toBe('守卫更换巡逻路线');
    view.facts[0].summary = '调用方改写';
    expect(turnOf(prepared, 'prepared-3').materialBaseline!.simulation!.envelope!.ledger.facts[0].summary).toBe('守卫更换巡逻路线');
    expect(turnOf(prepared, 'prepared-3').body).toBeNull();
  });

  it('拒绝缺失/损坏基底、错误身份、非 published 父、错误回执 revision 与账本篡改', async () => {
    const prepared = await setup();
    const missing = structuredClone(prepared); delete (turnOf(missing, 'prepared-3') as any).materialBaseline;
    expect(() => readPreparedSimulationCausalView_ACU(missing, 'prepared-3', 'prepared-attempt')).toThrow(/基底/);
    expect(() => readPreparedSimulationCausalView_ACU(prepared, 'prepared-3', 'other')).toThrow(/身份/);
    const nonPublished = structuredClone(prepared); turnOf(nonPublished, 'skipped-2').phase = 'effects-durable';
    expect(() => readPreparedSimulationCausalView_ACU(nonPublished, 'prepared-3', 'prepared-attempt')).toThrow();
    const wrongRevision = structuredClone(prepared);
    turnOf(wrongRevision, 'prepared-3').materialBaseline!.simulation!.confirmed[0].ledgerRevision = 0;
    expect(() => readPreparedSimulationCausalView_ACU(wrongRevision, 'prepared-3', 'prepared-attempt')).toThrow();
    const tampered = structuredClone(prepared);
    turnOf(tampered, 'prepared-3').materialBaseline!.simulation!.envelope!.ledger.facts[0].summary = '篡改冻结事实';
    expect(() => readPreparedSimulationCausalView_ACU(tampered, 'prepared-3', 'prepared-attempt')).toThrow(/不一致/);
  });

  it('更近有效的非 skipped 回执没有匹配确认或不同账本时拒绝，不回退借用更早资料', async () => {
    const prepared = await setup();
    const newer = turnOf(prepared, 'skipped-2');
    const result = newer.assistantFloor.data.simulation as any;
    result.outcome = 'no_change';
    result.ledger = structuredClone(prepared.branches[0].simulation!.envelope!.ledger);
    result.ledger.revision += 1;
    result.projection = buildWorldSimulationProjection_ACU(result.ledger);
    const receipt = newer.effectReceipts.find(item => item.kind === 'simulation')!;
    receipt.status = 'durable';
    receipt.fingerprint = getTableDataFingerprint_ACU(result);
    expect(() => readPreparedSimulationCausalView_ACU(prepared, 'prepared-3', 'prepared-attempt')).toThrow(/最近已确认|不一致/);
  });

  it('伪回执、不可达跨分支确认、父链循环/缺失/未发布均严格拒绝', async () => {
    const prepared = await setup();
    const forged = structuredClone(prepared);
    (turnOf(forged, 'skipped-2').assistantFloor.data.simulation as any).summary = '伪造回执';
    expect(() => readPreparedSimulationCausalView_ACU(forged, 'prepared-3', 'prepared-attempt')).toThrow();

    const crossBranch = structuredClone(prepared);
    turnOf(crossBranch, 'prepared-3').materialBaseline!.simulation!.confirmed[0].ref.branchId = 'branch-other';
    expect(() => readPreparedSimulationCausalView_ACU(crossBranch, 'prepared-3', 'prepared-attempt')).toThrow(/最近已确认/);

    const cycle = structuredClone(prepared); turnOf(cycle, 'skipped-2').parentTurnId = 'skipped-2';
    expect(() => readPreparedSimulationCausalView_ACU(cycle, 'prepared-3', 'prepared-attempt')).toThrow();
    const missingParent = structuredClone(prepared); turnOf(missingParent, 'skipped-2').parentTurnId = 'gone';
    expect(() => readPreparedSimulationCausalView_ACU(missingParent, 'prepared-3', 'prepared-attempt')).toThrow();
    const unpublished = structuredClone(prepared); turnOf(unpublished, 'parent-1').phase = 'effects-durable';
    expect(() => readPreparedSimulationCausalView_ACU(unpublished, 'prepared-3', 'prepared-attempt')).toThrow();
  });

  it('无基底、无确认或从未确认的已发布父链安全返回 null，不回填分支工作态', async () => {
    const prepared = await setup();
    const noBaseline = structuredClone(prepared); turnOf(noBaseline, 'prepared-3').materialBaseline!.simulation = null;
    expect(readPreparedSimulationCausalView_ACU(noBaseline, 'prepared-3', 'prepared-attempt')).toBeNull();
    const noConfirmed = structuredClone(prepared); turnOf(noConfirmed, 'prepared-3').materialBaseline!.simulation!.confirmed = [];
    expect(readPreparedSimulationCausalView_ACU(noConfirmed, 'prepared-3', 'prepared-attempt')).toBeNull();
  });
});
