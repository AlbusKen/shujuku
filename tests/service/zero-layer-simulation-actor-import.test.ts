import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../src/service/simulation/defaults';
import { seedLedgerFieldView_ACU } from '../../src/service/simulation/simulation-ledger-fold';
import { commitZeroLayerSimulationRound_ACU } from '../../src/service/zero-layer/simulation-commit';
import { appendZeroLayerSimulationActors_ACU } from '../../src/service/zero-layer/simulation-actor-import';
import { deleteZeroLayerSimulationActor_ACU } from '../../src/service/zero-layer/simulation-actor-removal';
import { readPreparedSimulationCausalView_ACU } from '../../src/service/zero-layer/prepared-simulation-causal-view';
import { readZeroLayerPublishedMaterials_ACU } from '../../src/service/zero-layer/published-materials';
import { emptyZeroLayerSimulation_ACU, ZeroLayerSimulationStore_ACU } from '../../src/service/zero-layer/simulation-store';
import { emptyZeroLayerContinuation_ACU } from '../../src/service/zero-layer/continuation-store';
import { ZeroLayerStore_ACU } from '../../src/service/zero-layer/store';
import { physicalHistoryFingerprint_ACU, physicalHistorySnapshot_ACU } from '../../src/service/zero-layer/carrier-context';
import { ZERO_LAYER_CARRIER_FIELD_ACU, type ZeroLayerEnvelope_ACU } from '../../src/service/zero-layer/model';
import { validateZeroLayerEnvelope_ACU } from '../../src/service/zero-layer/validation';
import { _set_SillyTavern_API_ACU } from '../../src/shared/host-api';
import type { WorldActor_ACU, WorldSimulationRunIdentity_ACU } from '../../src/service/simulation/model';
import type { WorldRoundCandidate_ACU } from '../../src/service/simulation/world-candidate';

function actor(id: string, name = id, loreRefs: string[] = []): WorldActor_ACU {
  return { id, name, interests: [], location: '', locationRef: null, life: 'alive', diedAtDay: null,
    deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [], knownFacts: [],
    visibility: 'hidden', currentAction: null, longTermAction: null, shortTermAction: null,
    simulationStatus: 'active', loreRefs, experiences: [], revision: 1 };
}

async function setup(options: { empty?: boolean } = {}) {
  const carrier: Record<string, unknown> = { is_user: false, mes: '物理正文', swipe_id: 0 };
  const chat = [carrier];
  let remote: unknown[] = structuredClone(chat);
  let failSave = false;
  const saveChat = vi.fn(async () => { if (failSave) throw new Error('save failed'); remote = structuredClone(chat); });
  const simulation = emptyZeroLayerSimulation_ACU();
  if (!options.empty) {
    simulation.envelope = buildDefaultWorldSimulationEnvelope_ACU();
    simulation.envelope.ledger.actors = [actor('original', '原住民', ['lore-original'])];
    simulation.fields = seedLedgerFieldView_ACU(simulation.envelope.ledger, 1);
  }
  const source: ZeroLayerEnvelope_ACU = {
    schemaVersion: 1, sessionId: 'session-1', scope: { chatId: 'chat-1', characterKey: 'char:card.png' },
    carrierId: 'carrier-1', carrierSwipeId: 0, seedBody: '物理正文',
    activationFingerprint: await physicalHistoryFingerprint_ACU(physicalHistorySnapshot_ACU(chat)),
    activationMessageCount: 1, enabled: true, apiPresetName: '', revision: 1, activeBranchId: 'branch-1',
    branches: [{ branchId: 'branch-1', headTurnId: null, simulation, continuation: emptyZeroLayerContinuation_ACU() }],
    turns: options.empty ? [] : [{ turnId: 'turn-1', branchId: 'branch-1', parentTurnId: null, attemptId: 'attempt-1', input: '继续',
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
  if (options.empty) return { store, zeroStore: new ZeroLayerStore_ACU(), anchor: null,
    saveChat, setFailSave: (value: boolean) => { failSave = value; }, getRemote: () => structuredClone(remote) };
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
  const candidate: WorldRoundCandidate_ACU = { baseRevision: 0,
    candidateClock: { ...store.read()!.ledger.clock, day: 2 }, worldEventWrites: [], actorWrites: [],
    factWrites: [], historyMilestoneWrites: [], actorCompletions: [
      { actorId: 'original', completion: 'no_change', expectedRevision: 1 }],
    projection: { anchor: null, deliveries: [] }, completion: 'changed' };
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

describe('零层世界人物手动入册', () => {
  it('首次空白分支建立账本，保持零模型确认、零旧回执', async () => {
    const { store, saveChat } = await setup({ empty: true });
    expect(store.readState().envelope).toBeNull();
    expect(await appendZeroLayerSimulationActors_ACU(store, [actor('first')])).toBe(1);
    expect(store.readState().envelope!.ledger.actors.map(item => item.id)).toEqual(['first']);
    expect(store.readState().actorImport).toMatchObject({ sourceRef: null, baseLedgerRevision: 0, ledgerRevision: 1 });
    expect(store.readState().confirmed).toEqual([]);
    expect(store.readSource().turns).toEqual([]);
    const calls = saveChat.mock.calls.length;
    expect(await appendZeroLayerSimulationActors_ACU(store, [])).toBe(0);
    expect(await appendZeroLayerSimulationActors_ACU(store, [actor('first')])).toBe(0);
    expect(saveChat.mock.calls.length).toBe(calls);
  });

  it('真实已发布回执后入册，下一 prepared 看到新人物，正文、旧回执与另一分支不变', async () => {
    const { store, zeroStore, anchor, getRemote } = await setup();
    const before = store.readSource();
    const oldTurn = structuredClone(before.turns[0]);
    const otherBranch = structuredClone(before.branches[0]);
    otherBranch.branchId = 'branch-2';
    otherBranch.fork = { sourceBranchId: 'branch-1', headTurnId: 'turn-1', sourceRevision: before.revision - 1 };
    (store.context.carrier[ZERO_LAYER_CARRIER_FIELD_ACU] as ZeroLayerEnvelope_ACU).branches.push(otherBranch);
    expect(await appendZeroLayerSimulationActors_ACU(store, [{ ...actor('new', '新来的人'), previousActionResult: '无' }])).toBe(1);
    const saved = store.readSource();
    expect(saved.branches[0].simulation!.envelope!.ledger.actors.map(item => item.id)).toEqual(['original', 'new']);
    expect(saved.branches[0].simulation!.envelope!.ledger.actors[0]).not.toHaveProperty('previousActionResult');
    expect(saved.branches[0].simulation!.envelope!.ledger.actors[1].previousActionResult).toBe('无');
    expect(saved.branches[0].simulation!.fields.records.actors?.new.fields.previousActionResult.value).toBe('无');
    expect(saved.branches[0].simulation!.actorImport).toMatchObject({ sourceRef: anchor!.logicalRef, baseLedgerRevision: 1, ledgerRevision: 2 });
    expect(saved.branches[0].simulation!.actorRemoval).toBeUndefined();
    expect(saved.branches[0].simulation!.envelope!.task).toMatchObject({ status: 'completed', activeRun: null });
    expect(saved.branches[0].simulation!.envelope!.task!.completedRun).toBeUndefined();
    expect(saved.turns[0]).toEqual(oldTurn);
    expect(saved.branches[1]).toEqual(otherBranch);
    expect(readZeroLayerPublishedMaterials_ACU(saved).simulation!.envelope!.ledger.actors.map(item => item.id))
      .toEqual(['original', 'new']);
    expect((getRemote()[0] as Record<string, any>)[ZERO_LAYER_CARRIER_FIELD_ACU].turns[0]).toEqual(oldTurn);
    const prepared = await zeroStore.commit({ type: 'prepare-turn', turnId: 'turn-2', attemptId: 'attempt-2',
      input: '接下来', requiredEffects: [] }, saved.revision);
    expect(readPreparedSimulationCausalView_ACU(prepared, 'turn-2', 'attempt-2')!.actors.map(item => item.id))
      .toEqual(['original', 'new']);
    expect(readPreparedSimulationCausalView_ACU(prepared, 'turn-2', 'attempt-2')!.actors[1].previousActionResult).toBe('无');
    const tampered = structuredClone(prepared);
    tampered.turns.at(-1)!.materialBaseline!.simulation!.actorImport!.baseLedgerFingerprint = '0'.repeat(64);
    expect(() => readPreparedSimulationCausalView_ACU(tampered, 'turn-2', 'attempt-2')).toThrow();
  });

  it('连续 import/delete/import 与先 delete 后 import 均继承原回执来源', async () => {
    const { store, zeroStore, anchor } = await setup();
    await appendZeroLayerSimulationActors_ACU(store, [actor('one')]);
    await deleteZeroLayerSimulationActor_ACU(store, 'one');
    await appendZeroLayerSimulationActors_ACU(store, [actor('two')]);
    expect(store.readState().actorImport).toMatchObject({ sourceRef: anchor!.logicalRef, baseLedgerRevision: 1, ledgerRevision: 4 });
    await deleteZeroLayerSimulationActor_ACU(store, 'original');
    await appendZeroLayerSimulationActors_ACU(store, [actor('three')]);
    const prepared = await zeroStore.commit({ type: 'prepare-turn', turnId: 'turn-2', attemptId: 'attempt-2',
      input: '继续', requiredEffects: [] }, store.readSource().revision);
    expect(readPreparedSimulationCausalView_ACU(prepared, 'turn-2', 'attempt-2')!.actors.map(item => item.id))
      .toEqual(['two', 'three']);
  });

  it('同 id、同名共享来源不覆盖；全无批准候选不保存', async () => {
    const { store, saveChat } = await setup();
    expect(await appendZeroLayerSimulationActors_ACU(store, [actor('original', '覆盖'), actor('new', '原住民', ['lore-original']),
      actor('same-name', '原住民', ['different-lore'])])).toBe(1);
    expect(store.readView().ledger.actors.map(item => item.id)).toEqual(['original', 'same-name']);
    const saved = store.readSource();
    const count = saveChat.mock.calls.length;
    expect(await appendZeroLayerSimulationActors_ACU(store, [])).toBe(0);
    expect(await appendZeroLayerSimulationActors_ACU(store, [actor('original')])).toBe(0);
    expect(saveChat.mock.calls.length).toBe(count);
    expect(store.readSource()).toEqual(saved);
  });

  it('取消、在途回合、未暂停运行均阻止入册；保存失败可恢复旧状态', async () => {
    const { store, zeroStore, setFailSave, getRemote } = await setup();
    const before = store.readSource();
    const aborted = new AbortController(); aborted.abort();
    await expect(appendZeroLayerSimulationActors_ACU(store, [actor('one')], { signal: aborted.signal }))
      .rejects.toMatchObject({ code: 'scope-changed' });
    await expect(appendZeroLayerSimulationActors_ACU(store, [actor('one')], { isCurrent: () => false }))
      .rejects.toMatchObject({ code: 'scope-changed' });
    setFailSave(true);
    await expect(appendZeroLayerSimulationActors_ACU(store, [actor('one')])).rejects.toThrow();
    expect(await store.store.recover()).toEqual(before);
    expect(store.readSource()).toEqual(before);
    expect((getRemote()[0] as Record<string, any>)[ZERO_LAYER_CARRIER_FIELD_ACU]).toEqual(before);
    setFailSave(false);
    await store.updateState(state => { state.envelope!.task!.status = 'running'; state.envelope!.task!.activeRun = {
      runId: 'run-new', chatIdentity: store.getChatIdentity(), triggerKind: 'assistant_completed',
      triggerConversationMessageId: null, kind: 'logical', logicalRef: store.anchorForTurn('turn-1').logicalRef,
      anchorContentDigest: store.anchorForTurn('turn-1').contentDigest, baseLedgerRevision: 1,
      taskId: 'task-1', stageId: 'stage-1', stageRevision: 1, deliveryTarget: 'body',
      workflowMode: 'layered', workflowProtocol: 'world-round-v1',
    }; });
    await expect(appendZeroLayerSimulationActors_ACU(store, [actor('one')]))
      .rejects.toMatchObject({ code: 'effects-pending' });
    await store.updateState(state => { state.envelope!.task!.status = 'paused'; });
    await appendZeroLayerSimulationActors_ACU(store, [actor('one')]);
    expect(store.readState().envelope!.task).toMatchObject({ status: 'abandoned', activeRun: null });
    const prepared = await zeroStore.commit({ type: 'prepare-turn', turnId: 'turn-2', attemptId: 'attempt-2',
      input: '继续', requiredEffects: [] }, store.readSource().revision);
    await expect(appendZeroLayerSimulationActors_ACU(store, [actor('two')]))
      .rejects.toMatchObject({ code: 'pending-turn' });
    expect(store.readSource()).toEqual(prepared);
  });
});
