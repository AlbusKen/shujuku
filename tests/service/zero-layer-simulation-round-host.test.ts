import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../src/service/simulation/defaults';
import { seedLedgerFieldView_ACU } from '../../src/service/simulation/simulation-ledger-fold';
import { commitZeroLayerSimulationRound_ACU } from '../../src/service/zero-layer/simulation-commit';
import { prepareWorldBodyProjection_ACU, runWorldProjectionStage_ACU } from '../../src/service/simulation/agent/world-projection-stage';
import { materializeWorldRoundCandidate_ACU } from '../../src/service/simulation/world-candidate';
import { validateZeroLayerSimulationReceipt_ACU } from '../../src/service/zero-layer/simulation-validation';
import { emptyZeroLayerSimulation_ACU, ZeroLayerSimulationStore_ACU } from '../../src/service/zero-layer/simulation-store';
import { validateZeroLayerEnvelope_ACU } from '../../src/service/zero-layer/validation';
import { physicalHistoryFingerprint_ACU, physicalHistorySnapshot_ACU } from '../../src/service/zero-layer/carrier-context';
import { ZERO_LAYER_CARRIER_FIELD_ACU, type ZeroLayerEnvelope_ACU } from '../../src/service/zero-layer/model';
import { sha256HexSync_ACU } from '../../src/shared/sha256-sync';
import { buildZeroLayerTimeline_ACU, projectZeroLayerHostPrompts_ACU, projectZeroLayerPromptHistory_ACU } from '../../src/service/zero-layer/timeline';
import { _set_SillyTavern_API_ACU } from '../../src/shared/host-api';

async function setup(groupOnly = false, deliveryTarget: 'body' | 'plot' = 'body') {
  const characterKey = groupOnly ? 'group:group-1' : 'char:card.png';
  const carrier: Record<string, unknown> = { is_user: false, mes: '开场', swipe_id: 0 };
  const chat = [carrier];
  const envelope = buildDefaultWorldSimulationEnvelope_ACU();
  const simulation = emptyZeroLayerSimulation_ACU();
  const source: ZeroLayerEnvelope_ACU = {
    schemaVersion: 1, sessionId: 'session-1', scope: { chatId: 'chat-1', characterKey },
    carrierId: 'carrier-1', carrierSwipeId: 0, seedBody: '开场',
    activationFingerprint: await physicalHistoryFingerprint_ACU(physicalHistorySnapshot_ACU(chat)),
    activationMessageCount: 1, enabled: true, apiPresetName: '', revision: 1,
    activeBranchId: 'branch-1', branches: [{ branchId: 'branch-1', headTurnId: null, simulation }],
    turns: [{ turnId: 'turn-1', branchId: 'branch-1', parentTurnId: null, attemptId: 'attempt-1',
      input: '继续', body: '主角在广场等待', phase: 'response-durable', createdAt: 1, updatedAt: 1,
      userFloor: { floorId: 'user-1', role: 'user', data: {} },
      assistantFloor: { floorId: 'floor-1', role: 'assistant', data: {} },
      simulationDeliveryTarget: deliveryTarget, requiredEffects: ['simulation'], effectReceipts: [], errorCode: null }],
  };
  const digest = sha256HexSync_ACU(source.turns[0].body!);
  const logicalRef = { sessionId: source.sessionId, branchId: 'branch-1', turnId: 'turn-1',
    attemptId: 'attempt-1', floorId: 'floor-1' };
  const saveChat = vi.fn().mockResolvedValue(undefined);
  _set_SillyTavern_API_ACU(groupOnly ? { chat, chatId: 'chat-1', groupId: 'group-1',
    getCurrentChatId: () => 'chat-1', saveChat } as any : { chat, chatId: 'chat-1', characterId: 0, this_chid: 0,
    characters: [{ avatar: 'card.png', name: '测试角色' }], getCurrentChatId: () => 'chat-1',
    saveChat } as any);
  const identity = { kind: 'logical' as const, logicalRef, chatIdentity: JSON.stringify([
    'zero-layer-simulation', JSON.stringify([characterKey, 'chat-1']), 'session-1', 'branch-1']),
    triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null,
    anchorContentDigest: digest, baseLedgerRevision: 0, taskId: 'task-1', stageId: 'stage-1',
    stageRevision: 1, deliveryTarget, runId: 'run-1' };
  envelope.task = { taskId: identity.taskId, originInstruction: '推进', status: 'running',
    createdAt: 1, updatedAt: 1, activeRun: identity, stopReason: null };
  envelope.activeStageId = identity.stageId;
  envelope.stages = [{ stageId: identity.stageId, stageNumber: 1, status: 'running', activeRevision: 1,
    revisions: [{ revision: 1, createdAt: 1, reason: 'initial', replanInstruction: '', frozen: true,
      plan: { schemaVersion: 1, title: '阶段', objective: '推进', impactScope: [], factsToVerify: [],
        plannedTools: [], plannedSpecialists: [], expectedLedgerChanges: [], convergenceConditions: [],
        blockingConditions: [], completedSteps: [], nextStep: '' } }] }];
  simulation.envelope = envelope;
  simulation.fields = seedLedgerFieldView_ACU(envelope.ledger, 1);
  carrier[ZERO_LAYER_CARRIER_FIELD_ACU] = validateZeroLayerEnvelope_ACU(source);
  const store = new ZeroLayerSimulationStore_ACU();
  const anchor = store.anchorForTurn('turn-1');
  const input = { identity, anchor, roundCandidate: { baseRevision: 0,
    candidateClock: { ...envelope.ledger.clock, day: 2 }, worldEventWrites: [], actorWrites: [],
    factWrites: [], historyMilestoneWrites: [], actorCompletions: [],
    projection: { anchor: null, deliveries: [] }, completion: 'changed' as const },
    completedAt: 10, timelineId: 'timeline-1', summary: '账本已更新' };
  return { store, input, chat, carrier, saveChat };
}

describe('零层新候选真实载体保存', () => {
  afterEach(() => { vi.unstubAllGlobals(); _set_SillyTavern_API_ACU(undefined); });

  it('零层新候选不能将冻结执行模式替换为另一模式', async () => {
    const f = await setup();
    await expect(commitZeroLayerSimulationRound_ACU(f.store, {
      ...f.input, identity: { ...f.input.identity, workflowMode: 'single' },
    })).rejects.toMatchObject({ code: 'revision-conflict' });
    expect(f.saveChat).not.toHaveBeenCalled();
  });

  it('旧入口携带受审 proof 字段仍拒绝，不能借附加属性开启解锁路径', async () => {
    const f = await setup();
    await expect(commitZeroLayerSimulationRound_ACU(f.store, {
      ...f.input, proof: Object.freeze({}), factIds: ['fact-locked'],
    } as any)).rejects.toMatchObject({ code: 'invalid-transition' });
    expect(f.saveChat).not.toHaveBeenCalled();
  });

  it('真实正文 scene proof 只追加选定事实到结果投影，与账本及回执同次保存', async () => {
    const f = await setup();
    const state = f.store.readState();
    const base = state.envelope!.ledger;
    base.player.location = { region: '城区', place: '广场' };
    await f.store.updateState(state => {
      state.envelope!.ledger.player.location = { region: '城区', place: '广场' };
      state.fields = seedLedgerFieldView_ACU(state.envelope!.ledger, 1);
    });
    const candidate = { ...f.input.roundCandidate, factWrites: [{ expectedRevision: 0, value: {
      id: 'scene-1', summary: '广场钟声响起', temporalKind: 'occurrence' as const,
      happenedAt: { day: 2, slot: '' }, validFrom: null, validUntil: null,
      locationRef: { region: '城区', place: '广场' }, actorIds: [], worldEventIds: [],
      projectionPolicy: 'scene' as const, revealState: 'unlocked' as const, revealGate: null,
      nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1,
    } }], completion: 'changed' as const };
    const preview = materializeWorldRoundCandidate_ACU(base, candidate);
    const identity = { ...f.input.identity, workflowMode: 'single' as const, workflowProtocol: 'world-round-v1' as const };
    // 宿主冻结运行身份必须与投影 proof 所见一致。
    await f.store.updateState(state => { state.envelope!.task!.activeRun = identity; });
    const anchor = f.store.anchorForTurn('turn-1');
    const projectionInput = { ledger: preview, identity, targetAnchor: anchor,
      anchorText: '主角在广场等待', sceneLocation: { region: '城区', place: '广场' },
      settings: f.store.read()!.settings, signal: new AbortController().signal,
      invoke: async () => JSON.stringify({ reviews: [] }), isCurrent: () => true, countTokens: async () => 1 };
    const stage = await runWorldProjectionStage_ACU(projectionInput);
    const prepared = await prepareWorldBodyProjection_ACU({ ...projectionInput, receipt: stage.receipt,
      clock: preview.clock });
    expect(prepared.factIds).toEqual(['scene-1']);
    const beforeSave = f.saveChat.mock.calls.length;
    await commitZeroLayerSimulationRound_ACU(f.store, { ...f.input, identity, anchor, roundCandidate: candidate,
      bodyProjection: { proof: prepared.proof } });
    const source = f.store.readSource();
    const result = source.turns[0].assistantFloor.data.simulation as { delivery: string; projection: string; bodyFactIds: string[] };
    expect(result.delivery).toBe('body');
    expect(result.bodyFactIds).toEqual(['scene-1']);
    expect(result.projection).toContain('广场钟声响起');
    expect(result.projection).toContain('qrf-world-simulation-projection:v2:start');
    expect(source.turns[0].body).toBe('主角在广场等待');
    expect(f.carrier.mes).toBe('开场');
    expect(f.saveChat.mock.calls.length - beforeSave).toBe(1);
    expect(() => validateZeroLayerSimulationReceipt_ACU(source.turns[0], source.sessionId)).not.toThrow();
    const published = structuredClone(source);
    published.turns[0].phase = 'published';
    published.branches[0].headTurnId = published.turns[0].turnId;
    const timeline = buildZeroLayerTimeline_ACU(published, [{ is_user: false, mes: '开场', swipe_id: 0 }]);
    const logicalBody = timeline.floors.at(-1)!.body;
    expect(logicalBody).toContain('主角在广场等待');
    expect(logicalBody).toContain('广场钟声响起');
    expect(logicalBody.match(/qrf-world-simulation-projection:v2:start/g)).toHaveLength(1);
    expect(projectZeroLayerHostPrompts_ACU(timeline).at(-1)!.content).toBe(logicalBody);
    expect(projectZeroLayerPromptHistory_ACU(timeline).at(-1)!.mes).toBe(logicalBody);
    expect(published.turns[0].body).toBe('主角在广场等待');
  });

  it('伪造正文 proof 在保存前失败且不产生半投影', async () => {
    const f = await setup();
    const before = structuredClone(f.store.readSource());
    await expect(commitZeroLayerSimulationRound_ACU(f.store, { ...f.input,
      bodyProjection: { proof: {} } })).rejects.toThrow(/body proof/);
    expect(f.saveChat).not.toHaveBeenCalled();
    expect(f.store.readSource()).toEqual(before);
  });

  it('plot 目标只保存 ledger-only，不允许伪造正文证明', async () => {
    const f = await setup(false, 'plot');
    await commitZeroLayerSimulationRound_ACU(f.store, f.input);
    expect(f.store.readSource().turns[0].assistantFloor.data.simulation)
      .toMatchObject({ delivery: 'ledger-only', projection: null });
    const other = await setup(false, 'plot');
    await expect(commitZeroLayerSimulationRound_ACU(other.store, { ...other.input,
      bodyProjection: { proof: {} } })).rejects.toMatchObject({ code: 'invalid-transition' });
    expect(other.saveChat).not.toHaveBeenCalled();
  });

  it('正常保存只调用宿主 saveChat，不再额外 HTTP 回读', async () => {
    const f = await setup();
    const fetchMock = vi.fn(async () => { throw new Error('正常保存不应回读服务器'); });
    vi.stubGlobal('fetch', fetchMock);
    await commitZeroLayerSimulationRound_ACU(f.store, f.input);
    const current = f.store.readSource();
    expect(current.branches[0].simulation?.envelope?.ledger.clock.day).toBe(2);
    expect(current.turns[0].assistantFloor.data.simulation).toMatchObject({ delivery: 'ledger-only', projection: null });
    expect(current.turns[0].effectReceipts).toHaveLength(1);
    expect(f.saveChat).toHaveBeenCalledExactlyOnceWith();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('没有角色与 avatar 的群聊仍可沿宿主 saveChat 正常保存', async () => {
    const f = await setup(true);
    const fetchMock = vi.fn(async () => { throw new Error('不应自行构造回读地址'); });
    vi.stubGlobal('fetch', fetchMock);
    await commitZeroLayerSimulationRound_ACU(f.store, f.input);
    expect(f.store.readSource().branches[0].simulation?.envelope?.ledger.clock.day).toBe(2);
    expect(f.saveChat).toHaveBeenCalledExactlyOnceWith();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('保存结果未知后回读旧快照才允许重新提交，不能盲目重复执行', async () => {
    const f = await setup();
    const old = structuredClone(f.chat);
    let remote: typeof old = old;
    f.saveChat.mockImplementationOnce(async () => { throw new Error('保存结果未知'); });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
    await expect(commitZeroLayerSimulationRound_ACU(f.store, f.input)).rejects.toMatchObject({ code: 'persist-unknown' });
    await expect(commitZeroLayerSimulationRound_ACU(f.store, f.input)).rejects.toMatchObject({ code: 'persist-unknown' });
    expect(f.saveChat).toHaveBeenCalledTimes(1);
    const recovered = await f.store.store.recover();
    expect(recovered?.branches[0].simulation?.envelope?.ledger.clock.day).toBe(1);
    f.saveChat.mockImplementationOnce(async () => { remote = structuredClone(f.chat); });
    await commitZeroLayerSimulationRound_ACU(f.store, f.input);
    expect(f.store.readSource().branches[0].simulation?.envelope?.ledger.clock.day).toBe(2);
    expect(f.saveChat).toHaveBeenCalledTimes(2);
  });

  it('保存结果未知但服务器已保存候选时只回读结果，不二次提交', async () => {
    const f = await setup();
    let remote = structuredClone(f.chat);
    f.saveChat.mockImplementationOnce(async () => {
      remote = structuredClone(f.chat);
      throw new Error('网络在保存后断开');
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
    await expect(commitZeroLayerSimulationRound_ACU(f.store, f.input)).rejects.toMatchObject({ code: 'persist-unknown' });
    const recovered = await f.store.store.recover();
    expect(recovered?.branches[0].simulation?.envelope?.ledger.clock.day).toBe(2);
    expect(recovered?.turns[0].assistantFloor.data.simulation).toMatchObject({ delivery: 'ledger-only', projection: null });
    await expect(commitZeroLayerSimulationRound_ACU(f.store, f.input)).rejects.toBeTruthy();
    expect(f.saveChat).toHaveBeenCalledTimes(1);
  });

  it('保存抛错后显式恢复仍须服务器回读，服务器源不一致时保持未知', async () => {
    const f = await setup();
    f.saveChat.mockRejectedValueOnce(new Error('保存结果未知'));
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => [{}, { is_user: false, mes: '服务器旧正文' }] }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(commitZeroLayerSimulationRound_ACU(f.store, f.input)).rejects.toMatchObject({ code: 'persist-unknown' });
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(f.store.store.recover()).rejects.toMatchObject({ code: 'source-changed' });
    expect(fetchMock).toHaveBeenCalledOnce();
    await expect(commitZeroLayerSimulationRound_ACU(f.store, f.input)).rejects.toMatchObject({ code: 'persist-unknown' });
    expect(f.saveChat).toHaveBeenCalledOnce();
  });

  it('保存时聊天切换仍拒绝提交并标记未知', async () => {
    const f = await setup(true);
    f.saveChat.mockImplementationOnce(async () => {
      _set_SillyTavern_API_ACU({ chat: [{ is_user: false, mes: '另一聊天' }],
        groupId: 'other-group', getCurrentChatId: () => 'other-chat', saveChat: f.saveChat } as any);
    });
    await expect(commitZeroLayerSimulationRound_ACU(f.store, f.input)).rejects.toMatchObject({ code: 'persist-unknown' });
    expect(f.saveChat).toHaveBeenCalledOnce();
  });
});
