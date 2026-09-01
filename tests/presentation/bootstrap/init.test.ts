// @vitest-environment jsdom

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  chatChanged: undefined as undefined | ((name: string) => Promise<void>),
  chatMutationHandler: undefined as undefined | ((data: any) => Promise<void>),
  generationStarted: undefined as undefined | ((type: any, params: any, dryRun: any) => void),
  generationEnded: undefined as undefined | ((messageId: any) => void),
  currentChatKey: '',
  api: { chat: [] as any[], chatId: '', eventTypes: { CHAT_CHANGED: 'chat', MESSAGE_DELETED: 'deleted', MESSAGE_SWIPED: 'swiped', GENERATION_STARTED: 'generation_started', GENERATION_ENDED: 'generation_ended' }, eventSource: { on: vi.fn(), makeFirst: vi.fn(), makeLast: vi.fn(), emit: vi.fn() } } as any,
  gate: { lastUserMessageId: 7 as any, lastUserMessageText: 'stale', lastUserMessageAt: 1, lastUserSendIntentAt: 2, lastGeneration: { stale: true } as any, generationSeq: 0, activeGenerations: [] as any[] },
  resetTakeover: vi.fn(), dispose: vi.fn(), setData: vi.fn(), setTables: vi.fn(), setMessages: vi.fn(), setTotal: vi.fn(), setChat: vi.fn(),
  setChatMutationTimer: vi.fn(),
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
  recordGeneration: vi.fn((type: any, params: any, dryRun: any) => {
    const context = { seq: ++m.gate.generationSeq, type, params, dryRun };
    m.gate.activeGenerations.push(context);
    return context;
  }),
  consumeGeneration: vi.fn(() => m.gate.activeGenerations.pop() || null),
  isQuiet: vi.fn(() => false),
}));

vi.mock('../../../src/shared/host-api', () => ({ SillyTavern_API_ACU: m.api }));
vi.mock('../../../src/shared/env', () => ({ topLevelWindow_ACU: { AutoCardUpdaterAPI: { _notifyTableUpdate: m.notify } } }));
vi.mock('../../../src/presentation/theme/toast', () => ({ showToastr_ACU: vi.fn() }));
vi.mock('../../../src/presentation/triggers/settings-ui-sync/settings-ui-connect', () => ({ attemptToLoadCoreApis_ACU: vi.fn(() => true), handleNewMessageDebounced_ACU: (...args: any[]) => m.handleNewMessage(...args) }));
vi.mock('../../../src/service/runtime/helpers-remaining', () => ({ ensureInitialSeedCheckpoint_ACU: vi.fn(), handleChatCompletionReady_ACU: vi.fn(), loadPresetAndCleanCharacterData_ACU: m.loadPreset }));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  chatMutationDebounceTimer_ACU: null, _set_chatMutationDebounceTimer_ACU: m.setChatMutationTimer, _set_wasStoppedByUser_ACU: vi.fn(), generationGate_ACU: m.gate,
  get currentChatFileIdentifier_ACU() { return m.currentChatKey; }, currentJsonTableData_ACU: null, getCurrentIsolationKey_ACU: () => 'test-isolation', discardLatestGenerationContext_ACU: vi.fn(), markUserSendIntent_ACU: vi.fn(), isProcessing_Plot_ACU: false, isQuietLikeGeneration_ACU: (...args: any[]) => m.isQuiet(...args), isRecentUserSendIntent_ACU: vi.fn(), loopState_ACU: { isLooping: false }, recordGenerationContext_ACU: (...args: any[]) => m.recordGeneration(...args), recordLastUserSend_ACU: vi.fn(), settings_ACU: { plotSettings: {} }, consumeGenerationContextForEnded_ACU: () => m.consumeGeneration(), shouldProcessAutoTableUpdateForGenerationEnded_ACU: (...args: any[]) => m.autoUpdate(...args), shouldProcessPlotForGeneration_ACU: vi.fn(), shouldProcessSummaryVectorIndexForGeneration_ACU: (...args: any[]) => m.shouldProcessSummary(...args),
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

let reinitialize_ACU: (() => void) | null = null;

beforeAll(async () => {
  document.body.innerHTML = '<button id="send_but"></button><textarea id="send_textarea"></textarea>';
  vi.spyOn(globalThis, 'setInterval').mockImplementation(() => 0 as any);
  // T5：TavernHelper.generate 钩子测试需要宿主 API 在 mainInitialize 前就绪，钩子才会被安装。
  (window as any).TavernHelper = { generate: vi.fn(async (...args: any[]) => ({ handled: true, args })) };
  m.api.eventSource.on.mockImplementation((event: string, callback: any) => {
    if (event === 'chat') m.chatChanged = callback;
    if (event === 'deleted' || event === 'swiped') m.chatMutationHandler = callback;
    if (event === 'generation_started') m.generationStarted = callback;
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
  m.api.chat = [];
  m.currentChatKey = '';
  m.preload.mockResolvedValue({ success: true, skipped: true, reason: 'no_manifest', chunkCount: 0 });
  m.shouldRebuild.mockReturnValue(false);
  m.rebuild.mockResolvedValue(undefined);
  m.restoreFlush.mockResolvedValue(0);
  m.processBeforeGen.mockResolvedValue({ success: true, skipped: true, reason: 'no_index_state' });
  m.orchestrate.mockResolvedValue({ action: 'passthrough' });
  m.shouldProcessSummary.mockReturnValue(false);
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
  it('删除或滑动事件仅设置聊天变更 timer，并在 trailing 窗口后执行一轮', async () => {
    vi.useFakeTimers();
    expect(m.chatMutationHandler).toBeTypeOf('function');

    await m.chatMutationHandler!({});

    expect(m.setChatMutationTimer).toHaveBeenCalledOnce();
    expect(m.refresh).not.toHaveBeenCalled();
    // T2 调度器 trailing 窗口为 1200ms（旧行为 500ms）
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

