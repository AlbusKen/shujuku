import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readWorldRoundPayload_ACU } from '../../helpers/world-round-payload';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../../src/service/simulation/defaults';
import { prepareWorldRoundRun_ACU } from '../../../src/service/simulation/agent/world-round-prepare';
import { commitWorldSimulationRound_ACU } from '../../../src/service/simulation/simulation-commit-adapter';
import { WorldSimulationOrchestrator_ACU, resetWorldSimulationOrchestratorStateForTests_ACU } from '../../../src/service/simulation/simulation-orchestrator';
import { FirstFloorWorldSimulationStore_ACU, assertWorldSimulationAnchorCurrent_ACU, resolveWorldSimulationAnchor_ACU } from '../../../src/service/simulation/simulation-store';
import { buildWorldRunMaterials_ACU } from '../../../src/service/simulation/world-run-materials';
import { readWorldSimulationLedgerAtAnchor_ACU } from '../../../src/service/simulation/agent/agent-module-store';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';
import type { WorldSimulationAgentName_ACU } from '../../../src/service/simulation/agent/agent-catalog';
import type { WorldSimulationRunIdentity_ACU } from '../../../src/service/simulation/model';

function actor(id: string) {
  return { id, name: id, interests: [], location: '', locationRef: null, life: 'alive' as const,
    diedAtDay: null, deathSummary: null, resources: [], goals: ['待命'], constraints: [],
    informationSources: [], knownFacts: [], visibility: 'hidden' as const, currentAction: null,
    shortTermAction: null, longTermAction: null, simulationStatus: 'active' as const,
    loreRefs: [], experiences: [], revision: 1 };
}

function payload(messages: readonly { content: string }[]): Record<string, unknown> {
  return readWorldRoundPayload_ACU(messages);
}

function responseForStage(data: Record<string, unknown>, failSecondActorBatch: boolean, actorBatchCount: { value: number }, failWorldPage: boolean): string {
  if (data.stage === 'world-narrative-review-v1') {
    return JSON.stringify({ locationRef: null, contactedActorIds: [], evidence: [], reviews: [] });
  }
  if (data.stage === 'clock-candidate') {
    return JSON.stringify({ candidateClock: { day: 2, slot: '夜', storyTime: '第二日夜', precision: 'exact', evidenceRefs: [] } });
  }
  if (data.stage === 'worldbook-selection') return JSON.stringify({ refs: [] });
  if (data.stage === 'recall-selection') {
    const actorIds = (data.directory as { actorIds: string[] }).actorIds;
    return JSON.stringify({
      selections: actorIds.map(actorId => ({ actorId, historyMilestoneIds: [], worldEventIds: [], factIds: [], reason: '本页无额外资料', priority: 5, scope: 'actor' })),
      worldSelection: { worldEventIds: [], factIds: [], reason: '本页无到期世界资料', priority: 5, scope: 'world' },
    });
  }
  if (data.stage === 'world-page') return failWorldPage ? 'not-json' : JSON.stringify({ worldEventWrites: [], factWrites: [] });
  const actorIds = data.actorIds as string[];
  actorBatchCount.value += 1;
  if (failSecondActorBatch && actorBatchCount.value === 2) return 'not-json';
  const actorId = actorIds[0];
  return JSON.stringify({
    actorWrites: [{ value: { ...actor(actorId), goals: ['巡查钟楼'], revision: 2 }, expectedRevision: 1 }],
    actorCompletions: actorIds.map(id => ({ actorId: id, completion: id === actorId ? 'changed' : 'no_change', expectedRevision: 1 })),
    factWrites: [{ value: { id: `fact-${actorId}`, summary: `${actorId} 已开始巡查钟楼`, temporalKind: 'occurrence',
      happenedAt: { day: 2, slot: '夜' }, validFrom: null, validUntil: null, locationRef: null,
      actorIds: [actorId], worldEventIds: [], projectionPolicy: 'internal', revealState: 'locked',
      revealGate: null, nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 }, expectedRevision: 0 }],
    historyMilestoneWrites: [],
  });
}

type FixtureOptions = {
  mode?: 'single' | 'layered';
  deliveryTarget?: 'body' | 'plot';
  actorCount?: number;
  failSecondActorBatch?: boolean;
  failWorldPage?: boolean;
  networkErrorOnSecondActorBatch?: boolean;
  beforeActorReply?: () => void;
  holdClock?: boolean;
  onBusinessSave?: (chat: any[]) => void;
  initialSwipeCache?: string;
  hostShape?: 'default' | 'getter-only' | 'legacy-only' | 'getter-and-legacy' | 'getter-preferred' | 'chat-id-only' | 'proxy-context' | 'no-identity' | 'other-character';
  switchChatDuring?: 'save';
};

function fixture(options: FixtureOptions = {}) {
  let chatIdentity = 'world-round-host';
  const saveSnapshots: any[] = [];
  let primaryFailure = false;
  let primaryFailureCount = 0;
  let switchChatAfterBusinessSave = false;
  const chat: any[] = [{}, {
    message_id: 71, is_user: false, mes: '钟楼下的风停了一瞬。', message: '钟楼下的风停了一瞬。', swipe_id: 0,
    swipes: [options.initialSwipeCache ?? '钟楼下的风停了一瞬。'],
  }];
  let remote = structuredClone(chat);
  const saveChat = vi.fn(async () => {
    const snapshot = structuredClone(chat);
    saveSnapshots.push(snapshot);
    if (primaryFailure && primaryFailureCount++ === 0) throw new Error('HOST_PRIMARY_SAVE_FAILED');
    if (snapshot[0]._qrf_world_simulation?.ledger.revision === 1) options.onBusinessSave?.(chat);
    remote = structuredClone(chat);
    if ((switchChatAfterBusinessSave || options.switchChatDuring === 'save') && snapshot[0]._qrf_world_simulation?.ledger.revision === 1) {
      chatIdentity = 'world-round-other-chat';
    }
  });
  const hostShape = options.hostShape ?? 'default';
  const hostApi: Record<string, unknown> = { chat, characters: hostShape === 'no-identity' ? undefined : [
    { avatar: 'world-round-host.png', name: '集成测试角色' },
    { avatar: 'other-character.png', name: '另一角色' },
  ], saveChat };
  if (hostShape === 'default' || hostShape === 'legacy-only' || hostShape === 'chat-id-only') hostApi.chatId = chatIdentity;
  if (hostShape !== 'no-identity' && hostShape !== 'chat-id-only') hostApi.getCurrentChatId = () => chatIdentity;
  if (hostShape === 'default' || hostShape === 'getter-only' || hostShape === 'getter-preferred' || hostShape === 'chat-id-only') hostApi.characterId = 0;
  if (hostShape === 'other-character') hostApi.characterId = 1;
  if (hostShape !== 'no-identity') hostApi.this_chid = hostShape === 'other-character' ? 1 : 0;
  if (hostShape === 'getter-preferred') hostApi.chatId = 'stale-chat-id';
  const dynamicHostApi = hostShape === 'proxy-context'
    ? new Proxy({}, {
      get(_target, key) {
        // 插件每次访问返回最新 context 字段；旧版本不提供 chatId/characterId。
        const context = { ...hostApi };
        if (key === 'chatId' || key === 'characterId') return undefined;
        return Reflect.get(context, key);
      },
      has(_target, key) { return key === 'chatId' || key === 'characterId' ? false : Reflect.has(hostApi, key); },
    }) : hostApi;
  _set_SillyTavern_API_ACU(dynamicHostApi as any);
  const fetchChat = vi.fn(async () => { throw new Error('HOST_FETCH_NETWORK_UNAVAILABLE'); });
  vi.stubGlobal('fetch', fetchChat);
  const envelope = buildDefaultWorldSimulationEnvelope_ACU();
  envelope.settings.workflowMode = options.mode ?? 'layered';
  envelope.settings.deliveryTarget = options.deliveryTarget ?? 'body';
  envelope.ledger.actors = Array.from({ length: options.actorCount ?? 1 }, (_, index) => actor(`actor-${index + 1}`));
  chat[0]._qrf_world_simulation = envelope;
  const store = new FirstFloorWorldSimulationStore_ACU();
  const anchor = resolveWorldSimulationAnchor_ACU(1, chat);
  let id = 0;
  let releaseClock: (() => void) | undefined;
  const clockEntered = new Promise<void>(resolve => { releaseClock = resolve; });
  const actorBatchCount = { value: 0 };
  const invoke = vi.fn(async (_role: WorldSimulationAgentName_ACU, messages: readonly { role: string; content: string }[]) => {
    const data = payload(messages);
    if (data.stage === 'clock-candidate' && options.holdClock) await clockEntered;
    if (data.stage === 'actor-batch') {
      options.beforeActorReply?.();
      if (options.networkErrorOnSecondActorBatch && actorBatchCount.value === 1) throw new Error('NETWORK_UNAVAILABLE');
    }
    return responseForStage(data, options.failSecondActorBatch === true, actorBatchCount, options.failWorldPage === true);
  });
  const prepare = async (input: { identity: WorldSimulationRunIdentity_ACU; anchor: typeof anchor; envelope: NonNullable<ReturnType<typeof store.read>>; signal: AbortSignal }) => {
    const worldbookSnapshot = { available: true as const, entries: [] };
    const userRequirements = { schemaVersion: 1 as const, requirements: [], updatedAt: 1 };
    const materials = buildWorldRunMaterials_ACU({
      instruction: input.envelope.task!.originInstruction,
      userRequirements,
      worldbookSnapshot,
      workflowMode: input.identity.workflowMode,
      deliveryTarget: input.identity.deliveryTarget,
      worldRoundPrompts: input.envelope.settings.worldRoundPrompts,
    });
    if (!input.envelope.task!.runMaterials) {
      await store.updateAtomically(current => ({ ...current!, task: { ...current!.task!, runMaterials: materials, updatedAt: ++id }, updatedAt: id }), {
        chatIdentity: input.identity.chatIdentity, taskId: input.identity.taskId, stageId: input.identity.stageId, revision: input.identity.stageRevision,
      });
    }
    const frozen = store.read()!;
    return prepareWorldRoundRun_ACU({
      identity: input.identity,
      envelope: frozen,
      anchor: input.anchor,
      anchorBody: chat[1].mes,
      instruction: frozen.task!.originInstruction,
      userRequirements,
      worldbookSnapshot,
      runMaterials: frozen.task!.runMaterials,
      signal: input.signal,
      invoke,
      readCurrent: () => store.read(),
      assertAnchorCurrent: () => { assertWorldSimulationAnchorCurrent_ACU(input.anchor, chat); },
      hasLegacyWrites: false,
      now: 1,
    });
  };
  const commitRound = vi.fn(async (input: any) => commitWorldSimulationRound_ACU({ ...input,
    commitCandidate: { runId: input.identity.runId, taskId: input.identity.taskId, stageId: input.identity.stageId,
      stageRevision: input.identity.stageRevision, baseLedgerRevision: input.identity.baseLedgerRevision,
      summary: input.summary, acceptedCandidates: [], evidenceRefs: [] } }));
  const orchestrator = new WorldSimulationOrchestrator_ACU({
    store, now: () => ++id, allocateId: kind => `${kind}-${++id}`, workflowProtocol: 'world-round-v1',
    prepare, assertAnchorCurrent: current => { assertWorldSimulationAnchorCurrent_ACU(current, chat); },
    commitRound, commitProjection: vi.fn(),
  });
  return {
    chat, anchor, store, invoke, saveChat, saveSnapshots, fetchChat, remote: () => structuredClone(remote), commitRound, orchestrator,
    start: () => orchestrator.start({ triggerKind: 'assistant_completed', anchor, instruction: '推进钟楼外的世界' }),
    setPrimaryFailure: () => { primaryFailure = true; },
    setUnknownSaveResult: () => { switchChatAfterBusinessSave = true; },
    changeChat: () => { chatIdentity = 'world-round-other-chat'; },
    changeSwipe: () => { chat[1].swipe_id = 1; },
    releaseClock: () => releaseClock?.(),
  };
}

describe('world-round 宿主整合', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetWorldSimulationOrchestratorStateForTests_ACU();
    _set_SillyTavern_API_ACU(undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetWorldSimulationOrchestratorStateForTests_ACU();
    _set_SillyTavern_API_ACU(undefined);
  });

  it.each(['single', 'layered'] as const)('%s 经宿主执行、真实 runner 与受限提交，在一次业务保存中写入时钟、人物和事实', async mode => {
    const f = fixture({ mode });

    const result = await f.start();

    expect(result).toMatchObject({ status: 'completed', identity: { workflowProtocol: 'world-round-v1', workflowMode: mode },
      result: { outcome: 'world_round', finalProjection: { content: null, sourceAgent: 'world-round', deliverable: false } } });
    const saved = readWorldSimulationLedgerAtAnchor_ACU(resolveWorldSimulationAnchor_ACU(1, f.chat), f.chat)!;
    expect(saved).toMatchObject({ revision: 1, clock: { day: 2, slot: '夜' }, actors: [{ id: 'actor-1', goals: ['巡查钟楼'] }], facts: [{ id: 'fact-actor-1' }] });
    expect(f.chat[1].mes).toBe('钟楼下的风停了一瞬。');
    expect(f.commitRound).toHaveBeenCalledOnce();
    const task = f.chat[0]._qrf_world_simulation.task;
    const manifest = task.runMaterials;
    expect(Object.keys(manifest).sort()).toEqual(['instructionHash', 'promptsHash', 'requirementsHash', 'schemaVersion', 'worldbookHash']);
    expect(JSON.stringify(manifest)).not.toContain('推进钟楼外的世界');
    expect(task).toMatchObject({ status: 'completed', activeRun: null, completedRun: {
      runId: result.identity.runId, workflowProtocol: 'world-round-v1', workflowMode: mode, deliveryTarget: 'body',
    } });
    expect(f.remote()[0]._qrf_world_simulation).toEqual(f.chat[0]._qrf_world_simulation);
    expect(f.fetchChat).not.toHaveBeenCalled();
    const businessSaves = f.saveSnapshots.filter(snapshot => snapshot[0]._qrf_world_simulation?.ledger.revision === 1);
    expect(businessSaves).toHaveLength(1);
    expect(businessSaves[0][0]._qrf_world_simulation.ledger).toMatchObject({ clock: { day: 2 }, actors: [{ id: 'actor-1' }], facts: [{ id: 'fact-actor-1' }] });
    expect(f.remote()[0]._qrf_world_simulation.ledger).toMatchObject({ revision: 1, clock: { day: 2, slot: '夜' },
      actors: [{ id: 'actor-1', goals: ['巡查钟楼'] }], facts: [{ id: 'fact-actor-1' }] });
  });

  it.each([
    ['single', 'body', 'getter-only'], ['layered', 'plot', 'legacy-only'],
    ['single', 'plot', 'getter-and-legacy'], ['layered', 'body', 'proxy-context'],
    ['single', 'body', 'getter-preferred'], ['layered', 'plot', 'chat-id-only'],
    ['single', 'plot', 'no-identity'], ['layered', 'body', 'no-identity'],
    ['single', 'body', 'other-character'], ['layered', 'plot', 'other-character'],
  ] as const)('%s/%s 宿主 %s 身份经真实 runner、提交与保存后完成整轮', async (mode, deliveryTarget, hostShape) => {
    const f = fixture({ mode, deliveryTarget, hostShape });

    const result = await f.start();

    expect(result, JSON.stringify(result)).toMatchObject({ status: 'completed', identity: { workflowMode: mode, deliveryTarget } });
    expect(f.commitRound).toHaveBeenCalledOnce();
    // runner 的准备阶段也可能调用 saveChat；只计算携带本轮账本的业务保存。
    expect(f.saveSnapshots.filter(snapshot => snapshot[0]._qrf_world_simulation?.ledger.revision === 1)).toHaveLength(1);
    expect(f.fetchChat).not.toHaveBeenCalled();
    const saved = readWorldSimulationLedgerAtAnchor_ACU(resolveWorldSimulationAnchor_ACU(1, f.chat), f.chat)!;
    expect(saved).toMatchObject({ revision: 1, clock: { day: 2, slot: '夜' },
      actors: [{ id: 'actor-1', goals: ['巡查钟楼'] }], facts: [{ id: 'fact-actor-1' }] });
    expect(f.remote()[0]._qrf_world_simulation.ledger).toEqual(saved);
    expect(f.remote()[0]._qrf_world_simulation.task).toMatchObject({ status: 'completed', completedRun: { workflowMode: mode, deliveryTarget } });
    expect(f.chat[1].mes).toBe('钟楼下的风停了一瞬。');
    expect(f.remote()[1].mes).toBe('钟楼下的风停了一瞬。');
  });

  it('仅 getter/chatId 无实时同步时，保存期间 getter 切换聊天不误报完成', async () => {
    const f = fixture({ hostShape: 'getter-preferred', switchChatDuring: 'save' });

    const result = await f.start();

    expect(result).toMatchObject({ status: 'failed', error: { code: 'WORLD_SIMULATION_REVISION_CONFLICT', details: { recovery: 'unavailable' } } });
    expect(f.commitRound).toHaveBeenCalledOnce();
    expect(f.saveSnapshots.filter(snapshot => snapshot[0]._qrf_world_simulation?.ledger.revision === 1)).toHaveLength(1);
    expect(f.fetchChat).not.toHaveBeenCalled();
  });

  it('fetch 故障不阻断宿主 saveChat 正常完成整轮', async () => {
    const f = fixture({ hostShape: 'getter-only', deliveryTarget: 'plot' });

    const result = await f.start();

    expect(result).toMatchObject({ status: 'completed' });
    expect(f.commitRound).toHaveBeenCalledOnce();
    expect(f.fetchChat).not.toHaveBeenCalled();
    expect(f.saveSnapshots.filter(snapshot => snapshot[0]._qrf_world_simulation?.ledger.revision === 1)).toHaveLength(1);
    expect(f.chat[1].mes).toBe('钟楼下的风停了一瞬。');
  });

  it('私有对象键序、无关楼层变化和 mes/swipes 旧缓存差异不阻碍整轮提交', async () => {
    const f = fixture({ onBusinessSave: chat => {
      chat[1].swipes[0] = '宿主保留的旧 swipe 缓存';
      chat.push({ message_id: 72, mes: '其他楼层', extra: { hostNote: true } });
      const first = chat[0]._qrf_world_simulation;
      chat[0]._qrf_world_simulation = Object.fromEntries(Object.entries(first).reverse());
      chat[1].extra = { hostMetadata: true };
    } });
    const result = await f.start();
    expect(result, JSON.stringify(result)).toMatchObject({ status: 'completed' });
    expect(f.chat[1].mes).toBe('钟楼下的风停了一瞬。');
    expect(f.chat[1].swipes[0]).toBe('宿主保留的旧 swipe 缓存');
    expect(f.chat[2].extra).toEqual({ hostNote: true });
  });

  it('初始 mes 与 active swipe 缓存不一致也不会改写历史缓存', async () => {
    const f = fixture({ initialSwipeCache: '另一宿主版本的 swipe 缓存' });
    await expect(f.start()).resolves.toMatchObject({ status: 'completed' });
    expect(f.chat[1].mes).toBe('钟楼下的风停了一瞬。');
    expect(f.chat[1].swipes[0]).toBe('另一宿主版本的 swipe 缓存');
  });

  it('宿主保存监听只改变无关消息字段与私有对象键序时仍可确认完成', async () => {
    const f = fixture({ onBusinessSave: chat => {
      chat[1].hostAnnotation = '保存后的附注';
      const state = chat[1]._qrf_world_simulation_state;
      if (state) chat[1]._qrf_world_simulation_state = Object.fromEntries(Object.entries(state).reverse());
    } });
    await expect(f.start()).resolves.toMatchObject({ status: 'completed' });
  });

  it('宿主重排已提交实体数组时仍按实体 id 确认保存', async () => {
    const f = fixture({ actorCount: 2, onBusinessSave: chat => {
      chat[0]._qrf_world_simulation.ledger.actors.reverse();
    } });
    await expect(f.start()).resolves.toMatchObject({ status: 'completed' });
    expect(f.chat[0]._qrf_world_simulation.ledger.actors.map((item: { id: string }) => item.id)).toEqual(['actor-2', 'actor-1']);
  });

  it('旧投送记录不妨碍本轮继承并提交', async () => {
    const f = fixture();
    f.chat[0]._qrf_world_simulation.ledger.facts.push({ id: 'previous-fact', summary: '旧轮已投送钟楼风声', temporalKind: 'occurrence',
      happenedAt: { day: 1, slot: '夜' }, validFrom: null, validUntil: null, locationRef: null,
      actorIds: [], worldEventIds: [], projectionPolicy: 'scene', revealState: 'unlocked',
      revealGate: null, nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 });
    f.chat[0]._qrf_world_simulation.ledger.projection.anchor = 'previous-anchor';
    f.chat[0]._qrf_world_simulation.ledger.projection.deliveries.push({ factId: 'previous-fact', status: 'delivered', attempts: 1 });
    const result = await f.start();
    expect(result, JSON.stringify(result)).toMatchObject({ status: 'completed' });
    expect(f.chat[0]._qrf_world_simulation.ledger.projection.deliveries).toEqual([{ factId: 'previous-fact', status: 'delivered', attempts: 1 }]);
  });

  it('保存期间同楼层正文被宿主改动仍保留新文字并完成账本保存', async () => {
    const f = fixture({ onBusinessSave: chat => { chat[1].mes = '被宿主改写的正文'; } });
    await expect(f.start()).resolves.toMatchObject({ status: 'completed' });
    expect(f.chat[1].mes).toBe('被宿主改写的正文');
    expect(f.remote()[0]._qrf_world_simulation.ledger.revision).toBe(1);
  });

  it.each(['swipe', 'chat'] as const)('保存期间 %s 改变时不写入其他目标', async change => {
    const f = fixture({ onBusinessSave: chat => {
      if (change === 'swipe') chat[1].swipe_id = 1;
    } });
    if (change === 'chat') {
      // 此路径由已有结果未知用例覆盖。
      f.setUnknownSaveResult();
    }
    const result = await f.start();
    expect(result).toMatchObject({ status: 'failed' });
    expect(f.saveSnapshots.filter(snapshot => snapshot[0]._qrf_world_simulation?.ledger.revision === 1)).toHaveLength(1);
  });

  it('后续人物批次返回非 JSON 时保留该批人物原状态，仍保存前批合法人物、事实与时钟', async () => {
    const f = fixture({ actorCount: 25, failSecondActorBatch: true });

    const result = await f.start();

    expect(result).toMatchObject({ status: 'completed' });
    expect(f.commitRound).toHaveBeenCalledOnce();
    const actorBatches = f.invoke.mock.calls.map(([, messages]) => payload(messages))
      .filter(data => data.stage === 'actor-batch').map(data => data.actorIds as string[]);
    expect(actorBatches).toHaveLength(2);
    expect(actorBatches.map(batch => batch.length)).toEqual([24, 1]);
    const firstActorId = actorBatches[0][0];
    const secondBatchId = actorBatches[1][0];
    const saved = readWorldSimulationLedgerAtAnchor_ACU(resolveWorldSimulationAnchor_ACU(1, f.chat), f.chat)!;
    expect(saved).toMatchObject({ revision: 1, clock: { day: 2, slot: '夜' } });
    expect(saved.actors).toHaveLength(25);
    expect(saved.actors.find(item => item.id === firstActorId)).toMatchObject({ goals: ['巡查钟楼'], revision: 2 });
    for (const actorId of [...actorBatches[0].slice(1), secondBatchId]) {
      expect(saved.actors.find(item => item.id === actorId)).toMatchObject({ goals: ['待命'], revision: 1 });
    }
    expect(saved.facts.map(fact => fact.id)).toEqual([`fact-${firstActorId}`]);
    expect(saved.facts.some(fact => fact.actorIds.includes(secondBatchId))).toBe(false);
    expect(f.remote()[0]._qrf_world_simulation.ledger).toEqual(saved);
    expect(f.saveSnapshots.filter(snapshot => snapshot[0]._qrf_world_simulation?.ledger.revision === 1)).toHaveLength(1);
  });

  it('世界页返回非 JSON 时该页不产生写入，合法人物批次仍可提交', async () => {
    const f = fixture({ failWorldPage: true });

    await expect(f.start()).resolves.toMatchObject({ status: 'completed' });
    expect(f.commitRound).toHaveBeenCalledOnce();
    const saved = readWorldSimulationLedgerAtAnchor_ACU(resolveWorldSimulationAnchor_ACU(1, f.chat), f.chat)!;
    expect(saved).toMatchObject({ revision: 1, clock: { day: 2 }, worldEvents: [], actors: [{ id: 'actor-1', goals: ['巡查钟楼'] }], facts: [{ id: 'fact-actor-1' }] });
  });

  it('后续人物批次网络异常仍整轮拒绝，不持久化前批候选', async () => {
    const f = fixture({ actorCount: 25, networkErrorOnSecondActorBatch: true });

    const result = await f.start();

    expect(result).toMatchObject({ status: 'failed', error: { message: expect.stringContaining('NETWORK_UNAVAILABLE') } });
    expect(f.commitRound).not.toHaveBeenCalled();
    expect(f.store.read()!.ledger).toMatchObject({ revision: 0, clock: { day: 1 }, actors: Array.from({ length: 25 }, () => ({ goals: ['待命'] })), facts: [] });
    expect(f.saveSnapshots.filter(snapshot => snapshot[0]._qrf_world_simulation?.ledger.revision === 1)).toHaveLength(0);
  });

  it('宿主主保存失败后补偿，整轮业务变更不残留且失败不会冒充完成', async () => {
    let f: ReturnType<typeof fixture>;
    f = fixture({ beforeActorReply: () => f.setPrimaryFailure() });

    const result = await f.start();

    expect(result).toMatchObject({ status: 'failed', error: { code: 'WORLD_SIMULATION_PERSIST_FAILED' } });
    expect(f.commitRound).toHaveBeenCalledOnce();
    expect(f.store.read()!.ledger).toMatchObject({ revision: 0, clock: { day: 1 }, facts: [] });
    expect(f.chat[1].mes).toBe('钟楼下的风停了一瞬。');
    expect(f.saveSnapshots.filter(snapshot => snapshot[0]._qrf_world_simulation?.ledger.revision === 1)).toHaveLength(1);
  });

  it('宿主保存后聊天切换属于结果未知：不把内存候选当作完成', async () => {
    let f: ReturnType<typeof fixture>;
    f = fixture({ beforeActorReply: () => f.setUnknownSaveResult() });

    const result = await f.start();

    expect(result).toMatchObject({ status: 'failed', error: { code: 'WORLD_SIMULATION_REVISION_CONFLICT', details: { recovery: 'unavailable' } } });
    expect(f.commitRound).toHaveBeenCalledOnce();
    expect(f.saveSnapshots.filter(snapshot => snapshot[0]._qrf_world_simulation?.ledger.revision === 1)).toHaveLength(1);
  });

  it.each(['swipe', 'chat'] as const)('%s 锚点在提交前变化时拒绝写入', async change => {
    const f = fixture({ beforeActorReply: () => change === 'swipe' ? f.changeSwipe() : f.changeChat() });

    const result = await f.start();

    expect(result).toMatchObject({ status: 'failed' });
    expect(f.commitRound).not.toHaveBeenCalled();
    expect(f.store.read()!.ledger.revision).toBe(0);
    expect(f.saveSnapshots.filter(snapshot => snapshot[0]._qrf_world_simulation?.ledger.revision === 1)).toHaveLength(0);
  });

  it('取消后 runner 不提交；同一冻结锚点的重复自动触发不再推演', async () => {
    const f = fixture({ holdClock: true });
    const running = f.start();
    await vi.waitFor(() => expect(f.invoke).toHaveBeenCalledTimes(1));
    expect(f.orchestrator.cancel(f.anchor.chatIdentity)).toBe(true);
    f.releaseClock();

    const cancelled = await running;
    expect(cancelled).toMatchObject({ status: 'cancelled' });
    expect(f.commitRound).not.toHaveBeenCalled();
    expect(f.store.read()!.ledger.revision).toBe(0);

    const completed = fixture();
    await expect(completed.start()).resolves.toMatchObject({ status: 'completed' });
    const calls = completed.invoke.mock.calls.length;
    await expect(completed.start()).resolves.toEqual({ status: 'skipped', reason: 'duplicate' });
    expect(completed.invoke).toHaveBeenCalledTimes(calls);
    expect(completed.commitRound).toHaveBeenCalledOnce();
  });
});
