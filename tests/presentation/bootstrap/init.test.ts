// @vitest-environment jsdom

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => {
  const chatMutationTimer = { value: null as any };
  return {
  chatMutationTimer,
  chatChanged: undefined as undefined | ((name: string) => Promise<void>),
  messageDeleted: undefined as undefined | ((data: any) => Promise<void>),
  messageSwiped: undefined as undefined | ((data: any) => Promise<void>),
  generationStarted: undefined as undefined | ((type: any, params: any, dryRun: any) => void),
  generationAfterCommands: undefined as undefined | ((type: any, params: any, dryRun: any) => Promise<void>),
  generationEnded: undefined as undefined | ((messageId: any) => void),
  currentChatKey: '',
  messageUpdated: undefined as undefined | ((messageIndex: any) => Promise<void>),
  api: { chat: [] as any[], chatId: '', eventTypes: { CHAT_CHANGED: 'chat', MESSAGE_UPDATED: 'message_updated', MESSAGE_DELETED: 'deleted', MESSAGE_SWIPED: 'swiped', GENERATION_STARTED: 'generation_started', GENERATION_ENDED: 'generation_ended', GENERATION_AFTER_COMMANDS: 'generation_after' }, eventSource: { on: vi.fn(), makeFirst: vi.fn(), makeLast: vi.fn(), emit: vi.fn() } } as any,
  gate: { lastUserMessageId: 7 as any, lastUserMessageText: 'stale', lastUserMessageAt: 1, lastUserSendIntentAt: 2, lastGeneration: { stale: true } as any, generationSeq: 0, activeGenerations: [] as any[] },
  resetTakeover: vi.fn(), dispose: vi.fn(), setData: vi.fn(), setTables: vi.fn(), setMessages: vi.fn(), setTotal: vi.fn(), setChat: vi.fn(),
  setChatMutationTimer: vi.fn((timer: any) => { chatMutationTimer.value = timer; }),
  notify: vi.fn(), resetScript: vi.fn(), loadPreset: vi.fn(), loadMessages: vi.fn(), refresh: vi.fn(),
  preload: vi.fn(), shouldRebuild: vi.fn(), rebuild: vi.fn(), restoreFlush: vi.fn(),
  processBeforeGen: vi.fn(),
  orchestrate: vi.fn(),
  shouldProcessSummary: vi.fn(),
  autoUpdate: vi.fn(() => true),
  handleNewMessage: vi.fn(),
  bindInternalGeneration: vi.fn(),
  consumeInternalGeneration: vi.fn(() => null),
  getContinuationRuntime: vi.fn(),
  continuationRuntimeInitialize: vi.fn(async () => undefined),
  continuationBridge: null as any,
  settings: { plotSettings: {} as any },
  hiddenAppend: vi.fn(),
  hiddenNext: vi.fn(),
  worldSimRuntime: {
    awaitBeforePlotStart: vi.fn(async () => ({ kind: 'skipped' })),
    onAiFloorCompleted: vi.fn(async () => undefined),
    discardInFlightSettlementForCurrentChat: (...args: any[]) => m.worldSimDiscard(...args),
    discardInFlightSettlementsForOtherChats: (...args: any[]) => m.worldSimDiscardOther(...args),
  },
  worldSimDiscard: vi.fn(() => true),
  worldSimDiscardOther: vi.fn(() => 0),
  worldSimConsumeProjectionEmit: vi.fn(() => false),
  worldSimBindInternal: vi.fn(),
  worldSimConsumeInternal: vi.fn(() => null as any),
  worldSimConsumeUnattributed: vi.fn(() => null as any),
  worldSimHasActiveInternal: vi.fn(() => false),
  recordGeneration: vi.fn((type: any, params: any, dryRun: any) => {
    const context = { seq: ++m.gate.generationSeq, type, params, dryRun };
    m.gate.activeGenerations.push(context);
    return context;
  }),
  consumeGeneration: vi.fn(() => m.gate.activeGenerations.pop() || null),
  isQuiet: vi.fn(() => false),
  };
});

vi.mock('../../../src/shared/host-api', () => ({ SillyTavern_API_ACU: m.api }));
vi.mock('../../../src/shared/env', () => ({ topLevelWindow_ACU: { AutoCardUpdaterAPI: { _notifyTableUpdate: m.notify } } }));
vi.mock('../../../src/presentation/theme/toast', () => ({ showToastr_ACU: vi.fn() }));
vi.mock('../../../src/presentation/triggers/settings-ui-sync/settings-ui-connect', () => ({ attemptToLoadCoreApis_ACU: vi.fn(() => true), handleNewMessageDebounced_ACU: (...args: any[]) => m.handleNewMessage(...args) }));
vi.mock('../../../src/service/runtime/helpers-remaining', () => ({ ensureInitialSeedCheckpoint_ACU: vi.fn(), handleChatCompletionReady_ACU: vi.fn(), loadPresetAndCleanCharacterData_ACU: m.loadPreset }));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  get chatMutationDebounceTimer_ACU() { return m.chatMutationTimer.value; }, _set_chatMutationDebounceTimer_ACU: m.setChatMutationTimer, _set_wasStoppedByUser_ACU: vi.fn(), generationGate_ACU: m.gate,
  get currentChatFileIdentifier_ACU() { return m.currentChatKey; }, currentJsonTableData_ACU: null, getCurrentIsolationKey_ACU: () => 'test-isolation', discardLatestGenerationContext_ACU: vi.fn(), markUserSendIntent_ACU: vi.fn(), isProcessing_Plot_ACU: false, isQuietLikeGeneration_ACU: (...args: any[]) => m.isQuiet(...args), isRecentUserSendIntent_ACU: vi.fn(), loopState_ACU: { isLooping: false }, recordGenerationContext_ACU: (...args: any[]) => m.recordGeneration(...args), recordLastUserSend_ACU: vi.fn(), settings_ACU: m.settings, consumeGenerationContextForEnded_ACU: () => m.consumeGeneration(), shouldProcessAutoTableUpdateForGenerationEnded_ACU: (...args: any[]) => m.autoUpdate(...args), shouldProcessPlotForGeneration_ACU: vi.fn(), shouldProcessSummaryVectorIndexForGeneration_ACU: (...args: any[]) => m.shouldProcessSummary(...args),
  _set_allChatMessages_ACU: m.setMessages, _set_currentChatFileIdentifier_ACU: (value: string) => { m.currentChatKey = value; m.setChat(value); }, _set_currentJsonTableData_ACU: m.setData, _set_independentTableStates_ACU: m.setTables, _set_isProcessing_Plot_ACU: vi.fn(), _set_lastTotalAiMessages_ACU: m.setTotal,
}));
vi.mock('../../../src/service/settings/settings-service', () => ({ applyTemplateScopeForCurrentChat_ACU: vi.fn(), loadSettings_ACU: vi.fn() }));
vi.mock('../../../src/service/worldbook/injection-engine', () => ({ resetScriptStateForNewChat_ACU: m.resetScript }));
vi.mock('../../../src/service/agent/agent-worldbook-takeover', () => ({ resetPlotAgentWorldbookSessionSnapshot_ACU: m.resetTakeover }));
vi.mock('../../../src/service/table/table-storage-strategy', () => ({ reloadStorageProvider: vi.fn(), disposeStorageProvider: m.dispose }));
vi.mock('../../../src/service/table/storage-mode', () => ({ isSqliteMode: vi.fn(() => false) }));
vi.mock('../../../src/service/worldbook/pipeline', () => ({ loadAllChatMessages_ACU: m.loadMessages }));
vi.mock('../../../src/presentation/components/pipeline-ui-helpers', () => ({ refreshMergedDataAndNotifyWithUI_ACU: m.refresh }));

vi.mock('../../../src/shared/utils', () => ({ cleanChatName_ACU: vi.fn((name: string) => name), logDebug_ACU: vi.fn(), logError_ACU: vi.fn(), logWarn_ACU: vi.fn() }));
vi.mock('../../../src/service/plot/plot-logic', () => ({ shouldSkipPlotIntercept_ACU: vi.fn() }));
vi.mock('../../../src/service/plot/plot-orchestrator', () => ({ orchestrateTavernHelperHook_ACU: (...args: any[]) => m.orchestrate(...args), orchestrateAfterCommandsStrategy1_ACU: vi.fn(), orchestrateAfterCommandsStrategy2_ACU: vi.fn() }));
vi.mock('../../../src/shared/host-input', () => ({ getSendTextareaValue_ACU: vi.fn(), setSendTextareaValue_ACU: vi.fn() }));
vi.mock('../../../src/presentation/components/plot-planning-ui', () => ({ runOptimizationLogicWithUI_ACU: vi.fn() }));
vi.mock('../../../src/presentation/components/summary-vector-index-ui', () => ({ processSummaryVectorIndexBeforeGenerationWithUI_ACU: (...args: any[]) => m.processBeforeGen(...args), shouldRebuildSummaryVectorIndexWithUI_ACU: (...args: any[]) => m.shouldRebuild(...args), rebuildCurrentSummaryVectorIndexWithUI_ACU: (...args: any[]) => m.rebuild(...args) }));
vi.mock('../../../src/service/vector/summary-vector-index-cache-service', () => ({ preloadSummaryVectorIndexCacheForCurrentChat_ACU: (...args: any[]) => m.preload(...args) }));
vi.mock('../../../src/service/vector/summary-vector-index-flush-queue', () => ({ restoreSummaryVectorIndexFlushQueueForCurrentChat_ACU: (...args: any[]) => m.restoreFlush(...args) }));
vi.mock('../../../src/service/vector/summary-vector-index-realign-state', () => ({ markSummaryVectorIndexDirtyForRealign_ACU: vi.fn() }));
vi.mock('../../../src/service/continuation/internal-ai-events', () => ({
  bindContinuationInternalAiGenerationStarted_ACU: (...args: any[]) => m.bindInternalGeneration(...args),
  consumeContinuationInternalAiGenerationEnded_ACU: (...args: any[]) => m.consumeInternalGeneration(...args),
}));
vi.mock('../../../src/service/continuation/continuation-runtime', () => ({ getContinuationRuntime_ACU: () => m.getContinuationRuntime() }));
vi.mock('../../../src/service/continuation/host-generation-bridge-registry', () => ({ getContinuationHostGenerationBridge_ACU: () => m.continuationBridge }));
vi.mock('../../../src/service/simulation/hidden-context-injector', () => ({
  WorldSimulationHiddenContextInjector_ACU: class {
    appendToGenerateOptions = m.hiddenAppend;
    injectForNextHostGeneration = m.hiddenNext;
  },
}));
vi.mock('../../../src/service/simulation/simulation-runtime-registry', () => ({
  getWorldSimulationRuntime_ACU: () => m.worldSimRuntime,
  resetWorldSimulationRuntimeForTests_ACU: vi.fn(),
}));
vi.mock('../../../src/service/simulation/simulation-internal-ai-events', () => ({
  bindWorldSimulationInternalAiGenerationStarted_ACU: (...args: any[]) => m.worldSimBindInternal(...args),
  consumeWorldSimulationInternalAiGenerationEnded_ACU: (...args: any[]) => m.worldSimConsumeInternal(...args),
  consumeUnattributedWorldSimulationInternalAiEnded_ACU: (...args: any[]) => m.worldSimConsumeUnattributed(...args),
  hasActiveWorldSimulationInternalAiMainApiInvocation_ACU: (...args: any[]) => m.worldSimHasActiveInternal(...args),
}));
vi.mock('../../../src/service/simulation/simulation-commit-guard', () => ({
  consumeWorldSimulationProjectionEmit_ACU: (...args: any[]) => m.worldSimConsumeProjectionEmit(...args),
}));

let reinitialize_ACU: (() => void) | null = null;

beforeAll(async () => {
  document.body.innerHTML = '<button id="send_but"></button><textarea id="send_textarea"></textarea>';
  vi.spyOn(globalThis, 'setInterval').mockImplementation(() => 0 as any);
  // T5：TavernHelper.generate 钩子测试需要宿主 API 在 mainInitialize 前就绪，钩子才会被安装。
  (window as any).TavernHelper = { generate: vi.fn(async (...args: any[]) => ({ handled: true, args })) };
  m.api.eventSource.on.mockImplementation((event: string, callback: any) => {
    if (event === 'chat') m.chatChanged = callback;
    if (event === 'deleted') m.messageDeleted = callback;
    if (event === 'swiped') m.messageSwiped = callback;
    if (event === 'generation_started') m.generationStarted = callback;
    if (event === 'generation_after') m.generationAfterCommands = callback;
    if (event === 'message_updated') m.messageUpdated = callback;
  });
  m.api.eventSource.makeFirst.mockImplementation((event: string, callback: any) => {
    if (event === 'generation_ended') m.generationEnded = callback;
  });
  const { mainInitialize_ACU } = await import('../../../src/presentation/bootstrap/init');
  reinitialize_ACU = mainInitialize_ACU;
  reinitialize_ACU();
});

afterAll(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
  m.chatMutationTimer.value = null;
  m.api.chat = [];
  m.currentChatKey = '';
  m.preload.mockResolvedValue({ success: true, skipped: true, reason: 'no_manifest', chunkCount: 0 });
  m.shouldRebuild.mockReturnValue(false);
  m.rebuild.mockResolvedValue(undefined);
  m.restoreFlush.mockResolvedValue(0);
  m.processBeforeGen.mockResolvedValue({ success: true, skipped: true, reason: 'no_index_state' });
  m.orchestrate.mockResolvedValue({ action: 'passthrough' });
  m.shouldProcessSummary.mockReturnValue(false);
  m.settings.plotSettings = {};
  m.hiddenAppend.mockReturnValue(false);
  m.hiddenNext.mockReturnValue(false);
  m.worldSimRuntime.awaitBeforePlotStart.mockReset();
  m.worldSimRuntime.awaitBeforePlotStart.mockResolvedValue({ kind: 'skipped' });
  m.worldSimRuntime.onAiFloorCompleted.mockClear();
  m.worldSimConsumeInternal.mockReturnValue(null);
  m.worldSimConsumeUnattributed.mockReturnValue(null);
  m.worldSimHasActiveInternal.mockReturnValue(false);
  m.worldSimDiscard.mockReturnValue(true);
  m.worldSimDiscardOther.mockReturnValue(0);
  m.worldSimConsumeProjectionEmit.mockReturnValue(false);
  m.continuationRuntimeInitialize.mockResolvedValue(undefined);
  m.getContinuationRuntime.mockReturnValue({ initialize: m.continuationRuntimeInitialize });
  m.continuationBridge = null;
  Object.assign(m.gate, { lastUserMessageId: 7, lastUserMessageText: 'stale', lastUserMessageAt: 1, lastUserSendIntentAt: 2, lastGeneration: { stale: true }, generationSeq: 3, activeGenerations: [{ seq: 3 }] });
});

describe('mainInitialize_ACU CHAT_CHANGED 无活动聊天早退', () => {
  it('无效聊天名且无消息时清理运行时，并阻止后续聊天加载', async () => {
    expect(m.chatChanged).toBeTypeOf('function');
    await m.chatChanged!('');

    expect(m.resetTakeover).toHaveBeenCalledOnce();
    expect(m.dispose).toHaveBeenCalledOnce();
    expect(m.setData).toHaveBeenCalledWith(null);
    expect(m.setTables).toHaveBeenCalledWith({});
    expect(m.setMessages).toHaveBeenCalledWith([]);
    expect(m.setTotal).toHaveBeenCalledWith(0);
    expect(m.setChat).toHaveBeenCalledWith('');
    expect(m.notify).toHaveBeenCalledOnce();
    expect(m.resetScript).not.toHaveBeenCalled();
    expect(m.loadPreset).not.toHaveBeenCalled();
    expect(m.loadMessages).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
    expect(m.gate).toEqual({ lastUserMessageId: null, lastUserMessageText: '', lastUserMessageAt: 0, lastUserSendIntentAt: 0, lastGeneration: null, generationSeq: 0, activeGenerations: [] });
  });

  it('无效聊天名但仍有消息时不误清理运行时', async () => {
    m.api.chat = [{ mes: 'still active' }];
    await m.chatChanged!('');

    expect(m.resetTakeover).not.toHaveBeenCalled();
    expect(m.dispose).not.toHaveBeenCalled();
    expect(m.resetScript).toHaveBeenCalledWith('', { reason: 'chat_changed' });
    expect(m.loadPreset).toHaveBeenCalledOnce();
  });
});

describe('mainInitialize_ACU CHAT_CHANGED 向量 flush 恢复编排', () => {
  it('missing-file 指示普通重建时按 preload→rebuild 顺序执行且不恢复旧 flush task', async () => {
    vi.useFakeTimers();
    m.api.chat = [{ mes: 'active' }];
    m.resetScript.mockImplementation(async (chatKey: string) => { m.currentChatKey = chatKey; });
    m.preload.mockResolvedValue({ success: true, skipped: true, reason: 'external_files_missing_state_cleared_rebuild_required', chunkCount: 0, chatStateCleared: true });
    m.shouldRebuild.mockReturnValue(true);
    const order: string[] = [];
    m.preload.mockImplementation(async () => { order.push('preload'); return { success: true, skipped: true, reason: 'external_files_missing_state_cleared_rebuild_required', chunkCount: 0, chatStateCleared: true }; });
    m.rebuild.mockImplementation(async () => { order.push('rebuild'); });
    m.restoreFlush.mockImplementation(async () => { order.push('restore'); return 0; });

    await m.chatChanged!('chat-a');
    await vi.advanceTimersByTimeAsync(1200);

    expect(order).toEqual(['preload', 'rebuild']);
    expect(m.restoreFlush).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('state-clear-failed 时不恢复持久化旧 flush task', async () => {
    vi.useFakeTimers();
    m.api.chat = [{ mes: 'active' }];
    m.resetScript.mockImplementation(async (chatKey: string) => { m.currentChatKey = chatKey; });
    m.preload.mockResolvedValue({ success: false, skipped: true, reason: 'external_files_missing_state_clear_save_failed', chunkCount: 0, chatStateCleared: false });

    await m.chatChanged!('chat-a');
    await vi.advanceTimersByTimeAsync(1200);

    expect(m.rebuild).not.toHaveBeenCalled();
    expect(m.restoreFlush).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('mainInitialize_ACU 聊天变更防抖', () => {
  it('MESSAGE_DELETED 与 MESSAGE_SWIPED 都使世界推演候选失效，并聚合为一轮刷新', async () => {
    vi.useFakeTimers();
    expect(m.messageDeleted).toBeTypeOf('function');
    expect(m.messageSwiped).toBeTypeOf('function');

    await m.messageDeleted!({});
    expect(m.worldSimDiscard).toHaveBeenCalledTimes(1);

    await m.messageSwiped!({});

    expect(m.worldSimDiscard).toHaveBeenCalledTimes(2);
    expect(m.setChatMutationTimer).toHaveBeenCalledTimes(2);
    expect(m.refresh).not.toHaveBeenCalled();
    // T2 调度器的 trailing 窗口把连续删除/滑动聚合为一轮刷新。
    await vi.advanceTimersByTimeAsync(1199);
    expect(m.refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(m.refresh).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});

// T5：TavernHelper.generate 钩子内发送前注入失败不得中断宿主生成（对齐 GENERATION_AFTER_COMMANDS 降级）。

describe('mainInitialize_ACU continuation internal AI event isolation', () => {
  it('does not dispatch an explicitly attributed internal generation to auto-update', () => {
    const identity = { source: 'turn_instruction' as const, requestId: 'request-a', chatIdentity: 'chat-a', taskId: 'task-a', stageId: 'stage-a', revision: 1, nodeId: 'node-a', turnId: 'turn-a', attemptId: 'attempt-a' };
    m.consumeInternalGeneration.mockReturnValueOnce(identity);

    expect(m.generationStarted).toBeTypeOf('function');
    expect(m.generationEnded).toBeTypeOf('function');
    m.generationStarted!('normal', {}, false);
    m.generationEnded!(42);

    expect(m.bindInternalGeneration).toHaveBeenCalledWith(m.gate.generationSeq);
    expect(m.consumeInternalGeneration).toHaveBeenCalledWith(m.gate.generationSeq);
    expect(m.autoUpdate).not.toHaveBeenCalled();
    expect(m.handleNewMessage).not.toHaveBeenCalled();
  });
});

describe('mainInitialize_ACU continuation host generation isolation', () => {
  it('claimed host generation runs the bridge and the normal auto-update pipeline in parallel', () => {
    const bridge = { onGenerationStarted: vi.fn(() => true), claimsGenerationEnded: vi.fn(() => true), onGenerationEnded: vi.fn() };
    m.continuationBridge = bridge;
    expect(reinitialize_ACU).not.toBeNull();
    reinitialize_ACU!();

    expect(m.getContinuationRuntime).toHaveBeenCalled();

    m.generationStarted!('normal', {}, false);
    m.generationEnded!(42);

    // 第二个参数是宽松认领开关：普通生成（非 quiet、非 dryRun、非自动触发）才允许，
    // 因为宿主的 GENERATION_STARTED 常在发送返回后的微任务里才到，严格同步配对必然错过。
    expect(bridge.onGenerationStarted).toHaveBeenCalledWith(m.gate.generationSeq, { allowOrdinaryLooseClaim: true, automaticTrigger: false, quietLike: false, dryRun: false });
    // 生成结束侧的宽松认领沿用自动填表门控的判定结果：会产生正文楼层的生成才允许。
    expect(bridge.claimsGenerationEnded).toHaveBeenCalledWith(m.gate.generationSeq, { allowOrdinaryLooseClaim: true, automaticTrigger: false, quietLike: false, dryRun: false });
    expect(bridge.onGenerationEnded).toHaveBeenCalledWith(42, m.gate.generationSeq, { allowOrdinaryLooseClaim: true, automaticTrigger: false, quietLike: false, dryRun: false });
    // 解耦语义：桥只管续写轮次的归属确认/标签校验/自动续轮，不再短路常规管线；
    // 桥的事件分类直接使用宿主上下文；自动填表门控只负责一次常规派发，
    // handleNewMessage 仍照常收到完整意图快照。
    expect(m.autoUpdate).toHaveBeenCalledTimes(1);
    expect(m.handleNewMessage).toHaveBeenCalledWith('GENERATION_ENDED', expect.objectContaining({ eventMessageId: 42 }));
  });

  it('leaves an unclaimed host generation on the normal auto-update path', () => {
    const bridge = { onGenerationStarted: vi.fn(() => false), claimsGenerationEnded: vi.fn(() => false), onGenerationEnded: vi.fn() };
    m.continuationBridge = bridge;

    expect(reinitialize_ACU).not.toBeNull();
    reinitialize_ACU!();
    m.generationStarted!('normal', {}, false);
    m.generationEnded!(42);

    expect(bridge.onGenerationStarted).toHaveBeenCalledWith(m.gate.generationSeq, { allowOrdinaryLooseClaim: true, automaticTrigger: false, quietLike: false, dryRun: false });
    expect(bridge.claimsGenerationEnded).toHaveBeenCalledWith(m.gate.generationSeq, { allowOrdinaryLooseClaim: true, automaticTrigger: false, quietLike: false, dryRun: false });
    expect(bridge.onGenerationEnded).not.toHaveBeenCalled();
    expect(m.autoUpdate).toHaveBeenCalledWith(expect.objectContaining({ seq: m.gate.generationSeq }));
    expect(m.handleNewMessage).toHaveBeenCalledWith('GENERATION_ENDED', expect.objectContaining({ eventMessageId: 42 }));
  });

  it('quiet、dryRun 与自动触发的生成不开放宽松认领', () => {
    const bridge = { onGenerationStarted: vi.fn(() => false), claimsGenerationEnded: vi.fn(() => false), onGenerationEnded: vi.fn() };
    m.continuationBridge = bridge;
    reinitialize_ACU!();

    m.isQuiet.mockReturnValueOnce(true);
    m.generationStarted!('quiet', {}, false);
    m.generationStarted!('normal', {}, true);
    m.generationStarted!('normal', { automatic_trigger: true }, false);

    // 这三类生成都不是用户点发送产生的，宽松认领会把别人的生成错认成续写轮。
    for (const call of bridge.onGenerationStarted.mock.calls) expect(call[1].allowOrdinaryLooseClaim).toBe(false);
    expect(bridge.onGenerationStarted).toHaveBeenCalledTimes(3);
    m.generationEnded!(42);
    expect(bridge.claimsGenerationEnded).toHaveBeenLastCalledWith(m.gate.generationSeq, { allowOrdinaryLooseClaim: false, automaticTrigger: true, quietLike: false, dryRun: false });
  });
});

// 钩子由 mainInitialize_ACU 在 beforeAll 时安装（window.TavernHelper 已就绪）。
describe('mainInitialize_ACU TavernHelper.generate 钩子 T5 降级', () => {
  it('processSummaryVectorIndexBeforeGenerationWithUI_ACU 抛异常时，钩子不中断并继续原始生成', async () => {
    const original = (window as any).TavernHelper.generate;
    expect(typeof original).toBe('function');
    await m.chatChanged!('chat-a');


    m.shouldProcessSummary.mockReturnValue(true);
    m.processBeforeGen.mockRejectedValueOnce(new Error('Embedding 请求失败 403: insufficient balance'));
    const args = [{ user_input: 'find relic', quiet_prompt: undefined }];

    // 钩子应吞掉异常：不 reject，且后续编排与原始 generate 都继续执行。
    const result = await (window as any).TavernHelper.generate(...args);

    expect(m.processBeforeGen).toHaveBeenCalledTimes(1);
    expect(m.orchestrate).toHaveBeenCalledTimes(1);
    // 原始 generate 在编排后仍被调用（宿主生成未中断）。
    expect((window as any).original_TavernHelper_generate_ACU).toHaveBeenCalledTimes(1);


    expect(result).toEqual({ handled: true, args });
  });
});


describe('mainInitialize_ACU hidden 世界推演 system 注入', () => {
  it('在 TavernHelper.generate 发送前追加 hidden system inject，不改写既有 injects', async () => {
    m.settings.plotSettings = { enabled: true };
    m.hiddenAppend.mockReturnValue(true);
    const options = { user_input: 'find relic', injects: [{ role: 'user', content: 'caller data' }] };

    await (window as any).TavernHelper.generate(options);

    expect(m.hiddenAppend).toHaveBeenCalledWith(options, { plotEnabled: true });
    expect(options.injects).toEqual([{ role: 'user', content: 'caller data' }]);
    expect((window as any).original_TavernHelper_generate_ACU).toHaveBeenCalledWith(options);
  });

  it('在原生 GENERATION_AFTER_COMMANDS 的有效生成前请求一次 hidden system 注入', async () => {
    m.settings.plotSettings = { enabled: true };
    m.api.chat = [{ is_user: true, mes: '当前输入' }];
    expect(m.generationAfterCommands).toBeTypeOf('function');

    await m.generationAfterCommands!('normal', {}, false);
    expect(m.hiddenNext).toHaveBeenCalledWith({ plotEnabled: true });

    m.hiddenNext.mockClear();
    await m.generationAfterCommands!('normal', { automatic_trigger: true }, false);
    expect(m.hiddenNext).not.toHaveBeenCalled();
  });
});

describe('mainInitialize_ACU 世界推演接线', () => {
  it('在 TavernHelper.generate 的剧情处理前执行一次有界 join', async () => {
    await m.chatChanged!('chat-a');
    m.worldSimRuntime.awaitBeforePlotStart.mockClear();
    m.orchestrate.mockClear();

    await (window as any).TavernHelper.generate({ user_input: 'find relic' });

    expect(m.worldSimRuntime.awaitBeforePlotStart).toHaveBeenCalledTimes(1);
    // “之前”必须是顺序证据，而不是仅凭调用次数：join 完成后才允许进入剧情编排/交火召回。
    expect(m.orchestrate).toHaveBeenCalledTimes(1);
    expect(m.worldSimRuntime.awaitBeforePlotStart.mock.invocationCallOrder[0])
      .toBeLessThan(m.orchestrate.mock.invocationCallOrder[0]!);
  });

  it('在 GENERATION_AFTER_COMMANDS 的交火纪要索引/剧情推进前执行一次有界 join', async () => {
    m.shouldProcessSummary.mockReturnValue(true);
    m.api.chat = [{ is_user: true, mes: '当前输入' }];
    await m.chatChanged!('chat-a');
    m.worldSimRuntime.awaitBeforePlotStart.mockClear();
    m.processBeforeGen.mockClear();

    await m.generationAfterCommands!('normal', {}, false);

    expect(m.worldSimRuntime.awaitBeforePlotStart).toHaveBeenCalledTimes(1);
    // 纪要索引（交火召回）在同一入口内必须先看到已完成的 join。
    expect(m.processBeforeGen).toHaveBeenCalledTimes(1);
    expect(m.worldSimRuntime.awaitBeforePlotStart.mock.invocationCallOrder[0])
      .toBeLessThan(m.processBeforeGen.mock.invocationCallOrder[0]!);
  });

  it('对不触发纪要索引与剧情推进的生成不做 join 等待', async () => {
    expect(m.shouldProcessSummary()).toBeFalsy();
    m.api.chat = [{ is_user: true, mes: '当前输入' }];

    await m.generationAfterCommands!('normal', {}, false);

    expect(m.worldSimRuntime.awaitBeforePlotStart).not.toHaveBeenCalled();
  });

  it('join 抛错时只记录告警，不阻断宿主生成', async () => {
    await m.chatChanged!('chat-a');
    m.worldSimRuntime.awaitBeforePlotStart.mockRejectedValueOnce(new Error('join boom'));

    const result = await (window as any).TavernHelper.generate({ user_input: 'find relic' });

    expect(result).toEqual({ handled: true, args: [{ user_input: 'find relic' }] });
    expect((window as any).original_TavernHelper_generate_ACU).toHaveBeenCalledTimes(1);
  });

  it('世界推演内部生成的 GENERATION_ENDED 被排除，既不派发自动填表也不触发世界推演', () => {
    m.worldSimConsumeInternal.mockReturnValueOnce({ requestId: 'ws-1', chatIdentity: 'chat-a', source: 'world-sim-gate' });

    expect(m.generationStarted).toBeTypeOf('function');
    m.generationStarted!('normal', {}, false);
    m.generationEnded!(42);

    // 与 continuation 各自独立归属同一次宿主生成。
    expect(m.worldSimBindInternal).toHaveBeenCalledWith(m.gate.generationSeq);
    expect(m.worldSimConsumeInternal).toHaveBeenCalledWith(m.gate.generationSeq);
    expect(m.autoUpdate).not.toHaveBeenCalled();
    expect(m.handleNewMessage).not.toHaveBeenCalled();
    expect(m.worldSimRuntime.onAiFloorCompleted).not.toHaveBeenCalled();
  });

  it('内部调用窗口内无法归属的 GENERATION_ENDED 按 fail-closed 丢弃，不自触发', () => {
    // 归属失败（无 seq / 乱序 / 并发歧义）但内部主 API 调用仍开着：不得当作普通 AI 楼层。
    m.worldSimConsumeInternal.mockReturnValueOnce(null);
    m.worldSimHasActiveInternal.mockReturnValueOnce(true);

    m.generationStarted!('normal', {}, false);
    m.generationEnded!(42);

    expect(m.autoUpdate).not.toHaveBeenCalled();
    expect(m.handleNewMessage).not.toHaveBeenCalled();
    expect(m.worldSimRuntime.onAiFloorCompleted).not.toHaveBeenCalled();
  });

  it('同步窗口关闭后仍无法归属的内部结束事件同样被丢弃，不自触发', () => {
    // afterMainApiCall 已把同步窗口关掉，且宿主从未在 generateRaw 同步栈内送达
    // GENERATION_STARTED，因此归属永远拿不到 seq：这条残余路径必须 fail-closed。
    m.worldSimConsumeInternal.mockReturnValueOnce(null);
    m.worldSimHasActiveInternal.mockReturnValueOnce(false);
    m.worldSimConsumeUnattributed.mockReturnValueOnce({ requestId: 'ws-2', chatIdentity: 'chat-a', source: 'world-sim-rebase' });

    m.generationStarted!('normal', {}, false);
    m.generationEnded!(42);

    expect(m.autoUpdate).not.toHaveBeenCalled();
    expect(m.handleNewMessage).not.toHaveBeenCalled();
    expect(m.worldSimRuntime.onAiFloorCompleted).not.toHaveBeenCalled();
  });

  it('quiet、dryRun 与自动触发的生成不触发世界推演', () => {
    // 与填表门控解耦不等于放弃生成类型过滤：不产生正文楼层的生成不得触发推演。
    // 注意：GENERATION_STARTED 与 GENERATION_ENDED 都会调用 isQuietLikeGeneration_ACU，
    // 用 mockReturnValueOnce 会被前者先消费，因此这里持续返回 true 并在用例结束前复位。
    m.isQuiet.mockReturnValue(true);
    m.generationStarted!('quiet', {}, false);
    m.generationEnded!(42);
    expect(m.worldSimRuntime.onAiFloorCompleted).not.toHaveBeenCalled();
    m.isQuiet.mockReturnValue(false);

    m.worldSimRuntime.onAiFloorCompleted.mockClear();
    m.generationStarted!('normal', {}, true);
    m.generationEnded!(42);
    expect(m.worldSimRuntime.onAiFloorCompleted).not.toHaveBeenCalled();

    m.worldSimRuntime.onAiFloorCompleted.mockClear();
    m.generationStarted!('normal', { automatic_trigger: true }, false);
    m.generationEnded!(42);
    expect(m.worldSimRuntime.onAiFloorCompleted).not.toHaveBeenCalled();
  });

  it('缺少 generationContext 时不为世界推演触发，避免无法证明来源的楼层', () => {
    // 事件进入时生成上下文已被消费：无法证明是普通用户生成，必须 fail-closed。
    m.consumeGeneration.mockReturnValueOnce(null);
    m.generationEnded!(42);

    expect(m.worldSimRuntime.onAiFloorCompleted).not.toHaveBeenCalled();
  });

  it('AI 楼层完成后独立异步触发世界推演，不受自动填表门控否决影响', () => {
    // 自动填表门控否决（quiet/后台生成）不得连带否决世界推演触发。
    m.autoUpdate.mockReturnValue(false);

    m.generationStarted!('normal', {}, false);
    m.generationEnded!(42);

    expect(m.autoUpdate).toHaveBeenCalledTimes(1);
    expect(m.handleNewMessage).not.toHaveBeenCalled();
    expect(m.worldSimRuntime.onAiFloorCompleted).toHaveBeenCalledWith(expect.objectContaining({ eventMessageId: 42 }));
  });

  it('用户编辑楼层的 MESSAGE_UPDATED 会让在飞候选整体失效', async () => {
    expect(m.messageUpdated).toBeTypeOf('function');
    m.worldSimConsumeProjectionEmit.mockReturnValueOnce(false);

    await m.messageUpdated!(42);

    expect(m.worldSimConsumeProjectionEmit).toHaveBeenCalledWith(42);
    expect(m.worldSimDiscard).toHaveBeenCalledTimes(1);
  });

  it('系统联合提交自己 emit 的 MESSAGE_UPDATED 被 token 吞掉，不自我失效', async () => {
    // 联合提交成功后会 emit MESSAGE_UPDATED 让宿主重绘；若把它当用户编辑，会立刻作废刚刚结算的候选。
    m.worldSimConsumeProjectionEmit.mockReturnValueOnce(true);

    await m.messageUpdated!(42);

    expect(m.worldSimConsumeProjectionEmit).toHaveBeenCalledWith(42);
    expect(m.worldSimDiscard).not.toHaveBeenCalled();
  });

  it('CHAT_CHANGED 回收其他聊天的在飞候选', async () => {
    m.worldSimDiscardOther.mockReturnValueOnce(2);

    await m.chatChanged!('chat-a');

    // 世界推演的 chat 身份取自宿主 live chatId：切聊天后旧键再也观测不到，必须整体回收。
    expect(m.worldSimDiscardOther).toHaveBeenCalledTimes(1);
  });
});
