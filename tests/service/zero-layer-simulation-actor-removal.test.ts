import { afterEach, describe, expect, it, vi } from 'vitest';
// 上游已停用零层；这里打开功能开关，以继续验证零层存储逻辑。
vi.mock('../../src/service/zero-layer/feature-policy', () => ({
  isZeroLayerFeatureEnabled_ACU: () => true,
  assertZeroLayerFeatureEnabled_ACU: () => undefined,
}));
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../src/service/simulation/defaults';
import { seedLedgerFieldView_ACU } from '../../src/service/simulation/simulation-ledger-fold';
import { commitZeroLayerSimulationRound_ACU } from '../../src/service/zero-layer/simulation-commit';
import { deleteZeroLayerSimulationActor_ACU } from '../../src/service/zero-layer/simulation-actor-removal';
import { deleteZeroLayerSimulationEvent_ACU } from '../../src/service/zero-layer/simulation-event-removal';
import { deleteZeroLayerSimulationHistory_ACU } from '../../src/service/zero-layer/simulation-history-removal';
import { appendZeroLayerSimulationActors_ACU } from '../../src/service/zero-layer/simulation-actor-import';
import { readPreparedSimulationCausalView_ACU } from '../../src/service/zero-layer/prepared-simulation-causal-view';
import { readZeroLayerPublishedMaterials_ACU } from '../../src/service/zero-layer/published-materials';
import { emptyZeroLayerSimulation_ACU, ZeroLayerSimulationStore_ACU } from '../../src/service/zero-layer/simulation-store';
import { emptyZeroLayerContinuation_ACU } from '../../src/service/zero-layer/continuation-store';
import { ZeroLayerStore_ACU } from '../../src/service/zero-layer/store';
import { physicalHistoryFingerprint_ACU, physicalHistorySnapshot_ACU } from '../../src/service/zero-layer/carrier-context';
import { ZERO_LAYER_CARRIER_FIELD_ACU, type ZeroLayerEnvelope_ACU } from '../../src/service/zero-layer/model';
import { validateZeroLayerEnvelope_ACU } from '../../src/service/zero-layer/validation';
import { _set_SillyTavern_API_ACU } from '../../src/shared/host-api';
import type { WorldRoundCandidate_ACU } from '../../src/service/simulation/world-candidate';
import type { WorldSimulationRunIdentity_ACU } from '../../src/service/simulation/model';

function actor(id: string) {
  return { id, name: id, interests: [], location: '', locationRef: null, life: 'alive' as const,
    diedAtDay: null, deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [],
    knownFacts: [], visibility: 'hidden' as const, currentAction: null, longTermAction: null, shortTermAction: null,
    simulationStatus: 'active' as const, loreRefs: [], experiences: [], revision: 1 };
}

async function setup(options: { coldHistory?: boolean } = {}) {
  const carrier: Record<string, unknown> = { is_user: false, mes: '物理正文', swipe_id: 0 };
  const chat = [carrier];
  let remote: unknown[] = structuredClone(chat);
  let failSave = false;
  const saveChat = vi.fn(async () => { if (failSave) throw new Error('save failed'); remote = structuredClone(chat); });
  const simulation = emptyZeroLayerSimulation_ACU();
  simulation.envelope = buildDefaultWorldSimulationEnvelope_ACU();
  simulation.envelope.ledger.actors = [actor('actor-1'), actor('actor-2')];
  simulation.envelope.ledger.worldEvents = [{ id: 'event-1', title: '未完事件', state: '进行中', status: 'active',
    actorIds: [], organizationIds: [], locationRefs: [], startedAt: null, deadline: null, nextCheck: null,
    relatedEventIds: [], loreRefs: [], evidenceRefs: [], tags: [], revision: 1, legacy: null },
  { id: 'event-2', title: '另一事件', state: '进行中', status: 'active', actorIds: [], organizationIds: [],
    locationRefs: [], startedAt: null, deadline: null, nextCheck: null, relatedEventIds: ['event-1'],
    loreRefs: [], evidenceRefs: [], tags: [], revision: 1, legacy: null }];
  if (options.coldHistory) {
    simulation.envelope.ledger.historyArchive = [{ id: 'cold-history', summary: '冷层旧事', happenedAt: { day: 1, slot: '' },
      actorIds: [], worldEventIds: [], locationRef: null, sourceFactIds: [], importance: 1, category: '行动',
      visibility: 'internal', revision: 2, legacyRefs: [], narrativeRecord: { status: 'recorded', recordedAt: { day: 1, slot: '' },
        anchorDigest: 'c'.repeat(64), deliveryQuote: '投送', evidenceQuote: '正文' } }];
  }
  simulation.fields = seedLedgerFieldView_ACU(simulation.envelope.ledger, 1);
  const source: ZeroLayerEnvelope_ACU = {
    schemaVersion: 1, sessionId: 'session-1', scope: { chatId: 'chat-1', characterKey: 'char:card.png' },
    carrierId: 'carrier-1', carrierSwipeId: 0, seedBody: '物理正文',
    activationFingerprint: await physicalHistoryFingerprint_ACU(physicalHistorySnapshot_ACU(chat)),
    activationMessageCount: 1, enabled: true, apiPresetName: '', revision: 1, activeBranchId: 'branch-1',
    branches: [{ branchId: 'branch-1', headTurnId: null, simulation, continuation: emptyZeroLayerContinuation_ACU() }],
    turns: [{ turnId: 'turn-1', branchId: 'branch-1', parentTurnId: null, attemptId: 'attempt-1', input: '继续',
      body: '已保存的故事正文', phase: 'response-durable', createdAt: 1, updatedAt: 1,
      userFloor: { floorId: 'user-1', role: 'user', data: {} },
      assistantFloor: { floorId: 'floor-1', role: 'assistant', data: { table: {
        floorId: 'floor-1', tableData: { mate: {} }, completedAiFloorBySheetKey: {}, filledSheetKeys: [],
      } } }, requiredEffects: ['simulation'], effectReceipts: [], errorCode: null }],
  };
  carrier[ZERO_LAYER_CARRIER_FIELD_ACU] = validateZeroLayerEnvelope_ACU(source);
  _set_SillyTavern_API_ACU({ chat, chatId: 'chat-1', characterId: 0, this_chid: 0,
    characters: [{ avatar: 'card.png', name: '测试角色' }], getCurrentChatId: () => 'chat-1', saveChat } as any);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));

  const store = new ZeroLayerSimulationStore_ACU();
  const anchor = store.anchorForTurn('turn-1');
  const identity: WorldSimulationRunIdentity_ACU = { runId: 'run-1', chatIdentity: store.getChatIdentity(),
    triggerKind: 'assistant_completed', triggerConversationMessageId: null, kind: 'logical', logicalRef: anchor.logicalRef,
    anchorContentDigest: anchor.contentDigest, baseLedgerRevision: 0, taskId: 'task-1', stageId: 'stage-1', stageRevision: 1,
    deliveryTarget: 'body', workflowMode: 'layered', workflowProtocol: 'world-round-v1' };
  await store.updateState(state => {
    state.envelope!.task = { taskId: identity.taskId, originInstruction: '推进', status: 'running', createdAt: 1,
      updatedAt: 1, activeRun: identity, stopReason: null };
    state.envelope!.activeStageId = identity.stageId;
    state.envelope!.stages = [{ stageId: identity.stageId, stageNumber: 1, status: 'running', activeRevision: 1,
      revisions: [{ revision: 1, createdAt: 1, reason: 'initial', replanInstruction: '', frozen: true,
        plan: { schemaVersion: 1, title: '阶段', objective: '推进', impactScope: [], factsToVerify: [], plannedTools: [],
          plannedSpecialists: [], expectedLedgerChanges: [], convergenceConditions: [], blockingConditions: [], completedSteps: [], nextStep: '' } }] }];
  });
  const fact = { id: 'shared-fact', summary: '守卫知晓旧路线', temporalKind: 'occurrence' as const,
    happenedAt: { day: 2, slot: '' }, validFrom: null, validUntil: null, locationRef: null,
    actorIds: ['actor-1', 'actor-2'], worldEventIds: ['event-1'], projectionPolicy: 'internal' as const,
    revealState: 'locked' as const, revealGate: { worldEventIds: ['event-1'], semanticCondition: '保密' }, nextCheck: null,
    sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 };
  const candidate: WorldRoundCandidate_ACU = { baseRevision: 0,
    candidateClock: { ...store.read()!.ledger.clock, day: 2 }, worldEventWrites: [], actorWrites: [],
    factWrites: [{ value: fact, expectedRevision: 0 }], historyMilestoneWrites: [{ expectedRevision: 0, value: {
      id: 'shared-history', summary: '两人曾同行', happenedAt: { day: 2, slot: '' }, actorIds: ['actor-1', 'actor-2'],
      worldEventIds: ['event-1'], locationRef: null, sourceFactIds: ['shared-fact'], importance: 1,
      category: '行动', visibility: 'internal', revision: 1, legacyRefs: [],
    } }], actorCompletions: [
      { actorId: 'actor-1', completion: 'no_change', expectedRevision: 1 },
      { actorId: 'actor-2', completion: 'no_change', expectedRevision: 1 },
    ], projection: { anchor: null, deliveries: [] }, completion: 'changed' };
  await commitZeroLayerSimulationRound_ACU(store, { identity, anchor, roundCandidate: candidate,
    completedAt: 10, timelineId: 'timeline-1', summary: '结算' });
  const zeroStore = new ZeroLayerStore_ACU();
  const settled = await zeroStore.commit({ type: 'transition-turn', turnId: 'turn-1', attemptId: 'attempt-1',
    phase: 'effects-durable' }, store.readSource().revision);
  await zeroStore.commit({ type: 'transition-turn', turnId: 'turn-1', attemptId: 'attempt-1',
    phase: 'published' }, settled.revision);
  return { store, zeroStore, anchor, saveChat, setFailSave: (value: boolean) => { failSave = value; },
    getRemote: () => structuredClone(remote) };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); _set_SillyTavern_API_ACU(undefined); });

describe('零层手动删除世界人物', () => {
  it('已发布真实回执之后只改权威账本，清理栏目和引用，下一 prepared 不从旧回执复活', async () => {
    const { store, zeroStore, anchor, getRemote } = await setup();
    const before = store.readSource();
    const oldTurn = structuredClone(before.turns[0]);
    const secondBranch = structuredClone(before.branches[0]);
    secondBranch.branchId = 'branch-2';
    secondBranch.fork = { sourceBranchId: 'branch-1', headTurnId: 'turn-1', sourceRevision: before.revision - 1 };
    // 预置一条未活动分支，验证删除不会越界改写它。
    (store.context.carrier[ZERO_LAYER_CARRIER_FIELD_ACU] as ZeroLayerEnvelope_ACU).branches.push(secondBranch);
    await deleteZeroLayerSimulationActor_ACU(store, 'actor-1');
    const saved = store.readSource();
    const ledger = saved.branches[0].simulation!.envelope!.ledger;
    expect(ledger.actors.map(actor => actor.id)).toEqual(['actor-2']);
    expect(saved.branches[0].simulation!.fields.records.actors?.['actor-1']).toBeUndefined();
    expect(ledger.facts[0]).toMatchObject({ id: 'shared-fact', actorIds: ['actor-2'], summary: '守卫知晓旧路线' });
    expect(ledger.historyMilestones[0]).toMatchObject({ id: 'shared-history', actorIds: ['actor-2'], summary: '两人曾同行' });
    expect(saved.turns[0]).toEqual(oldTurn);
    expect(saved.branches[1]).toEqual(secondBranch);
    expect(saved.branches[0].simulation!.actorRemoval).toMatchObject({ sourceRef: anchor.logicalRef, baseLedgerRevision: 1,
      ledgerRevision: 2 });
    expect(readZeroLayerPublishedMaterials_ACU(saved).simulation!.envelope!.ledger.actors.map(actor => actor.id)).toEqual(['actor-2']);
    expect((getRemote()[0] as Record<string, any>)[ZERO_LAYER_CARRIER_FIELD_ACU].branches[0].simulation.envelope.ledger.actors)
      .toHaveLength(1);
    const prepared = await zeroStore.commit({ type: 'prepare-turn', turnId: 'turn-2', attemptId: 'attempt-2',
      input: '接下来', requiredEffects: [] }, saved.revision);
    const next = readPreparedSimulationCausalView_ACU(prepared, 'turn-2', 'attempt-2')!;
    expect(next.actors.map(actor => actor.id)).toEqual(['actor-2']);
    expect(next.facts[0].actorIds).toEqual(['actor-2']);
    expect(prepared.turns.at(-1)!.materialBaseline!.simulation!.envelope!.ledger.actors).toHaveLength(1);
  });

  it('连续删除沿原确认回执继承维护链，篡改来源或工作指纹拒绝因果读取', async () => {
    const { store, zeroStore, anchor } = await setup();
    await deleteZeroLayerSimulationActor_ACU(store, 'actor-1');
    await deleteZeroLayerSimulationActor_ACU(store, 'actor-2');
    const state = store.readState();
    expect(state.envelope!.ledger.actors).toEqual([]);
    expect(state.actorRemoval).toMatchObject({ sourceRef: anchor.logicalRef, baseLedgerRevision: 1, ledgerRevision: 3 });
    const prepared = await zeroStore.commit({ type: 'prepare-turn', turnId: 'turn-2', attemptId: 'attempt-2',
      input: '接下来', requiredEffects: [] }, store.readSource().revision);
    expect(readPreparedSimulationCausalView_ACU(prepared, 'turn-2', 'attempt-2')!.actors).toEqual([]);
    const tampered = structuredClone(prepared);
    tampered.turns.at(-1)!.materialBaseline!.simulation!.actorRemoval!.baseLedgerFingerprint = '0'.repeat(64);
    expect(() => readPreparedSimulationCausalView_ACU(tampered, 'turn-2', 'attempt-2')).toThrow();
  });

  it('暂停任务删除后使旧运行作废，不把暂停误认为运行中', async () => {
    const { store } = await setup();
    await store.updateState(state => {
      state.envelope!.task!.status = 'paused';
      state.envelope!.task!.activeRun = null;
    });
    await deleteZeroLayerSimulationActor_ACU(store, 'actor-1');
    expect(store.readState().envelope!.task).toMatchObject({ status: 'abandoned', activeRun: null });
    expect(store.readState().runState).toBeNull();
    expect(store.readState().runProof).toBeNull();
  });

  it('partial 草稿只清理被删人物引用而不删除其它字段', async () => {
    const { store } = await setup();
    await store.updateState(state => {
      state.fields.records.seeds = { 'draft-seed': {
        module: 'seeds', id: 'draft-seed', status: 'partial', updatedAt: 12,
        fields: { actorIds: { value: ['actor-1', 'actor-2'], revision: 1, updatedAt: 12 },
          title: { value: '保留草稿', revision: 1, updatedAt: 12 } },
        missingFields: ['status', 'level', 'catalyst', 'visibility', 'location', 'evidenceRefs'],
      } };
    });
    await deleteZeroLayerSimulationActor_ACU(store, 'actor-1');
    const draft = store.readState().fields.records.seeds!['draft-seed'];
    expect(draft.status).toBe('partial');
    expect(draft.fields.title.value).toBe('保留草稿');
    expect(draft.fields.actorIds.value).toEqual(['actor-2']);
  });

  it('保存失败不改写旧状态；在途回合不允许删除', async () => {
    const { store, zeroStore, setFailSave, getRemote } = await setup();
    const before = store.readSource();
    setFailSave(true);
    await expect(deleteZeroLayerSimulationActor_ACU(store, 'actor-1')).rejects.toThrow();
    expect(await store.store.recover()).toEqual(before);
    expect(store.readSource()).toEqual(before);
    expect((getRemote()[0] as Record<string, any>)[ZERO_LAYER_CARRIER_FIELD_ACU]).toEqual(before);
    setFailSave(false);
    const prepared = await zeroStore.commit({ type: 'prepare-turn', turnId: 'turn-2', attemptId: 'attempt-2',
      input: '接下来', requiredEffects: [] }, before.revision);
    await expect(deleteZeroLayerSimulationActor_ACU(store, 'actor-1'))
      .rejects.toMatchObject({ code: 'pending-turn' });
    expect(store.readSource()).toEqual(prepared);
  });

  it('事件删除独立来源链；与人物删除连续维护后 prepared 因果不复活', async () => {
    const { store, zeroStore, anchor } = await setup();
    await deleteZeroLayerSimulationActor_ACU(store, 'actor-1');
    await deleteZeroLayerSimulationEvent_ACU(store, 'event-1');
    await deleteZeroLayerSimulationActor_ACU(store, 'actor-2');
    await deleteZeroLayerSimulationEvent_ACU(store, 'event-2');
    const state = store.readState();
    expect(state.eventRemoval).toMatchObject({ sourceRef: anchor.logicalRef, baseLedgerRevision: 1, ledgerRevision: 5 });
    expect(state.actorRemoval).toMatchObject({ sourceRef: anchor.logicalRef, baseLedgerRevision: 1, ledgerRevision: 4 });
    expect(state.envelope!.ledger.worldEvents).toEqual([]);
    expect(state.envelope!.ledger.facts[0]).toMatchObject({ summary: '守卫知晓旧路线', worldEventIds: [],
      revealState: 'locked', revealGate: null });
    const prepared = await zeroStore.commit({ type: 'prepare-turn', turnId: 'turn-2', attemptId: 'attempt-2',
      input: '接下来', requiredEffects: [] }, store.readSource().revision);
    const next = readPreparedSimulationCausalView_ACU(prepared, 'turn-2', 'attempt-2')!;
    expect(next.worldEvents).toEqual([]);
    expect(next.actors).toEqual([]);
    expect(next.facts[0].worldEventIds).toEqual([]);
    expect(next.historyMilestones[0].worldEventIds).toEqual([]);
    const tampered = structuredClone(prepared);
    tampered.turns.at(-1)!.materialBaseline!.simulation!.eventRemoval!.baseLedgerFingerprint = '0'.repeat(64);
    expect(() => readPreparedSimulationCausalView_ACU(tampered, 'turn-2', 'attempt-2')).toThrow();
  });

  it('事件删除与人物入册交错后仍从原确认来源读取最新账本', async () => {
    const { store, zeroStore, anchor } = await setup();
    await deleteZeroLayerSimulationEvent_ACU(store, 'event-1');
    await appendZeroLayerSimulationActors_ACU(store, [actor('new-a')]);
    await deleteZeroLayerSimulationEvent_ACU(store, 'event-2');
    await appendZeroLayerSimulationActors_ACU(store, [actor('new-b')]);
    expect(store.readState().actorImport).toMatchObject({ sourceRef: anchor.logicalRef, baseLedgerRevision: 1, ledgerRevision: 5 });
    const prepared = await zeroStore.commit({ type: 'prepare-turn', turnId: 'turn-2', attemptId: 'attempt-2',
      input: '接下来', requiredEffects: [] }, store.readSource().revision);
    const next = readPreparedSimulationCausalView_ACU(prepared, 'turn-2', 'attempt-2')!;
    expect(next.worldEvents).toEqual([]);
    expect(next.actors.map(item => item.id)).toEqual(['actor-1', 'actor-2', 'new-a', 'new-b']);
    expect(next.facts[0].worldEventIds).toEqual([]);
  });

  it('事件删除保存失败恢复旧状态，partial 只清目标引用并保留草稿', async () => {
    const { store, setFailSave, getRemote } = await setup();
    await store.updateState(state => {
      state.fields.records.seeds = { draft: { module: 'seeds', id: 'draft', status: 'partial', updatedAt: 12,
        fields: { title: { value: '保留草稿', revision: 1, updatedAt: 12 },
          actorIds: { value: ['actor-1', 'actor-2'], revision: 1, updatedAt: 12 } },
        missingFields: ['status', 'level', 'catalyst', 'visibility', 'location', 'evidenceRefs'],
      } };
      state.fields.records.chronicle = { draft: { module: 'chronicle', id: 'draft', status: 'partial', updatedAt: 12,
        fields: { relatedIds: { value: ['event-1', 'event-2', 'actor-1'], revision: 1, updatedAt: 12 },
          at: { value: '旧日', revision: 1, updatedAt: 12 } }, missingFields: ['summary'] } };
    });
    const before = store.readSource();
    setFailSave(true);
    await expect(deleteZeroLayerSimulationEvent_ACU(store, 'event-1')).rejects.toThrow();
    expect(await store.store.recover()).toEqual(before);
    expect(store.readSource()).toEqual(before);
    expect((getRemote()[0] as Record<string, any>)[ZERO_LAYER_CARRIER_FIELD_ACU]).toEqual(before);
    setFailSave(false);
    await deleteZeroLayerSimulationEvent_ACU(store, 'event-1');
    const draft = store.readState().fields.records.seeds!.draft;
    expect(draft.fields.title.value).toBe('保留草稿');
    expect(draft.fields.actorIds.value).toEqual(['actor-1', 'actor-2']);
    expect(store.readState().fields.records.chronicle!.draft.fields.relatedIds.value).toEqual(['event-2', 'actor-1']);
    expect(store.readState().fields.records.chronicle!.draft.fields.at.value).toBe('旧日');
  });

  it('历史删除独立来源链；与人物入册、人物删除、事件删除交错后 prepared 仍从原确认来源读取最新账本，已删历史不复活', async () => {
    const { store, zeroStore, anchor } = await setup({ coldHistory: true });
    expect(store.read()!.ledger.historyArchive!.map(item => item.id)).toEqual(['cold-history']);
    const baseRevision = store.read()!.ledger.revision;
    await deleteZeroLayerSimulationHistory_ACU(store, 'shared-history');
    await appendZeroLayerSimulationActors_ACU(store, [actor('new-a')]);
    await deleteZeroLayerSimulationEvent_ACU(store, 'event-1');
    await deleteZeroLayerSimulationActor_ACU(store, 'actor-1');
    await deleteZeroLayerSimulationHistory_ACU(store, 'cold-history');
    const state = store.readState();
    expect(state.historyRemoval).toMatchObject({ sourceRef: anchor.logicalRef, ledgerRevision: baseRevision + 5 });
    expect(state.historyRemoval!.baseLedgerRevision).toBe(state.eventRemoval!.baseLedgerRevision);
    expect(state.envelope!.ledger.historyMilestones).toEqual([]);
    expect(state.envelope!.ledger.historyArchive).toEqual([]);
    // 其余实体只被各自的维护动作改动，历史删除不动事实原文与人物。
    expect(state.envelope!.ledger.facts[0]).toMatchObject({ id: 'shared-fact', summary: '守卫知晓旧路线' });
    const prepared = await zeroStore.commit({ type: 'prepare-turn', turnId: 'turn-2', attemptId: 'attempt-2',
      input: '接下来', requiredEffects: [] }, store.readSource().revision);
    const next = readPreparedSimulationCausalView_ACU(prepared, 'turn-2', 'attempt-2')!;
    expect(next.historyMilestones).toEqual([]);
    expect(next.actors.map(item => item.id)).toEqual(['actor-2', 'new-a']);
    expect(next.worldEvents.map(item => item.id)).toEqual(['event-2']);
    expect(next.facts.map(item => item.id)).toEqual(['shared-fact']);
    const tampered = structuredClone(prepared);
    tampered.turns.at(-1)!.materialBaseline!.simulation!.historyRemoval!.baseLedgerFingerprint = '0'.repeat(64);
    expect(() => readPreparedSimulationCausalView_ACU(tampered, 'turn-2', 'attempt-2')).toThrow();
  });

  it('历史删除后再被人物入册等维护接续时来源链连续，缺失历史与在途回合被拒绝', async () => {
    const { store } = await setup();
    await expect(deleteZeroLayerSimulationHistory_ACU(store, 'missing-history')).rejects.toThrow();
    await expect(deleteZeroLayerSimulationHistory_ACU(store, '  ')).rejects.toThrow();
    await deleteZeroLayerSimulationHistory_ACU(store, 'shared-history');
    await appendZeroLayerSimulationActors_ACU(store, [actor('later')]);
    const state = store.readState();
    expect(state.actorImport!.sourceRef).toEqual(state.historyRemoval!.sourceRef);
    expect(state.actorImport!.baseLedgerRevision).toBe(state.historyRemoval!.baseLedgerRevision);
    expect(state.actorImport!.ledgerRevision).toBe(state.historyRemoval!.ledgerRevision + 1);
  });

  it('历史删除保存失败恢复旧状态，成功后远端载体与权威账本一致', async () => {
    const { store, setFailSave, getRemote } = await setup();
    const before = store.readSource();
    setFailSave(true);
    await expect(deleteZeroLayerSimulationHistory_ACU(store, 'shared-history')).rejects.toThrow();
    expect(await store.store.recover()).toEqual(before);
    expect(store.readSource()).toEqual(before);
    expect((getRemote()[0] as Record<string, any>)[ZERO_LAYER_CARRIER_FIELD_ACU]).toEqual(before);
    expect(store.read()!.ledger.historyMilestones.map(item => item.id)).toEqual(['shared-history']);
    setFailSave(false);
    await deleteZeroLayerSimulationHistory_ACU(store, 'shared-history');
    expect(store.read()!.ledger.historyMilestones).toEqual([]);
    const remote = (getRemote()[0] as Record<string, any>)[ZERO_LAYER_CARRIER_FIELD_ACU];
    expect(remote.branches[0].simulation.envelope.ledger).toEqual(store.read()!.ledger);
    expect(remote.branches[0].simulation.historyRemoval).toBeDefined();
  });
});
