// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  chatChanged: undefined as undefined | ((name: string) => Promise<void>),
  chatMutationHandler: undefined as undefined | ((data: any) => Promise<void>),
  generationStarted: undefined as undefined | ((type: any, params: any, dryRun: any) => void),
  generationEnded: undefined as undefined | ((messageId: any) => void),
  generationStopped: undefined as undefined | (() => void),
  messageSent: undefined as undefined | ((messageId: any) => Promise<void>),
  afterCommands: undefined as undefined | ((type: any, params: any, dryRun: any) => Promise<void>),
  currentChatKey: '',
  settings: { plotSettings: {} } as { plotSettings: Record<string, unknown>; worldSimulationPageEnabled?: boolean; plotSendDisguiseDisabled?: boolean },
  api: { chat: [] as any[], chatId: '', eventTypes: { CHAT_CHANGED: 'chat', MESSAGE_DELETED: 'deleted', MESSAGE_SWIPED: 'swiped', MESSAGE_SENT: 'message_sent', MESSAGE_UPDATED: 'message_updated', GENERATION_AFTER_COMMANDS: 'after_commands', GENERATION_STARTED: 'generation_started', GENERATION_ENDED: 'generation_ended', GENERATION_STOPPED: 'generation_stopped' }, eventSource: { on: vi.fn(), makeFirst: vi.fn(), makeLast: vi.fn(), emit: vi.fn() } } as any,
  gate: { lastUserMessageId: 7 as any, lastUserMessageText: 'stale', lastUserMessageAt: 1, lastUserSendIntentAt: 2, lastGeneration: { stale: true } as any, generationSeq: 0, activeGenerations: [] as any[] },
  resetTakeover: vi.fn(), dispose: vi.fn(), setData: vi.fn(), setTables: vi.fn(), setMessages: vi.fn(), setTotal: vi.fn(), setChat: vi.fn(),
  setChatMutationTimer: vi.fn(),
  notify: vi.fn(), resetScript: vi.fn(), loadPreset: vi.fn(), loadMessages: vi.fn(), refresh: vi.fn(),
  preload: vi.fn(), shouldRebuild: vi.fn(), rebuild: vi.fn(), restoreFlush: vi.fn(),
  // 切聊天向量预热门控：默认启用，保持既有 preload→rebuild/restore 编排语义。
  vectorPipelineEnabled: vi.fn(() => true),
  processBeforeGen: vi.fn(),
  orchestrate: vi.fn(),
  strategy1: vi.fn(), strategy2: vi.fn(), shouldProcessPlot: vi.fn(),
  flushPlot: vi.fn(), saveChat: vi.fn(),
  getInput: vi.fn(), setInput: vi.fn(), protectInput: vi.fn(),
  beginDisguise: vi.fn(), releaseDisguise: vi.fn(), discardDisguise: vi.fn(), setNotice: vi.fn(),
  markIntercept: vi.fn(), skipIntercept: vi.fn(), stopGeneration: vi.fn(),
  jquery: vi.fn(), draftInputListener: null as null | (() => void),
  input: '',
  shouldProcessSummary: vi.fn(),
  autoUpdate: vi.fn(() => true),
  handleNewMessage: vi.fn(),
  bindInternalGeneration: vi.fn(),
  consumeInternalGeneration: vi.fn(() => null),
  bindSimulationInternalGeneration: vi.fn(),
  consumeSimulationInternalGeneration: vi.fn(() => null),
  createSimulationIntent: vi.fn((eventMessageId: number, chatKey: string, isolationKey: string, generationSeq?: number) => ({ eventMessageId, chatKey, isolationKey, generationSeq })),
  handleSimulationCompletion: vi.fn(async () => null),
  getSimulationRuntime: vi.fn(),
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

vi.mock('../../../src/shared/host-api', () => ({ SillyTavern_API_ACU: m.api, jQuery_API_ACU: m.jquery }));
vi.mock('../../../src/shared/env', () => ({ topLevelWindow_ACU: { AutoCardUpdaterAPI: { _notifyTableUpdate: m.notify } } }));
vi.mock('../../../src/presentation/theme/toast', () => ({ showToastr_ACU: vi.fn() }));
vi.mock('../../../src/presentation/triggers/settings-ui-sync/settings-ui-connect', () => ({ attemptToLoadCoreApis_ACU: vi.fn(() => true), handleNewMessageDebounced_ACU: (...args: any[]) => m.handleNewMessage(...args) }));
vi.mock('../../../src/service/runtime/helpers-remaining', () => ({ ensureInitialSeedCheckpoint_ACU: vi.fn(), handleChatCompletionReady_ACU: vi.fn(), loadPresetAndCleanCharacterData_ACU: m.loadPreset }));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  chatMutationDebounceTimer_ACU: null, _set_chatMutationDebounceTimer_ACU: m.setChatMutationTimer, _set_wasStoppedByUser_ACU: vi.fn(), generationGate_ACU: m.gate,
  get currentChatFileIdentifier_ACU() { return m.currentChatKey; }, currentJsonTableData_ACU: null, getCurrentIsolationKey_ACU: () => 'test-isolation', discardLatestGenerationContext_ACU: vi.fn(), markUserSendIntent_ACU: vi.fn(), isProcessing_Plot_ACU: false, isQuietLikeGeneration_ACU: (...args: any[]) => m.isQuiet(...args), isRecentUserSendIntent_ACU: vi.fn(), loopState_ACU: { isLooping: false }, recordGenerationContext_ACU: (...args: any[]) => m.recordGeneration(...args), recordLastUserSend_ACU: vi.fn(), settings_ACU: m.settings, consumeGenerationContextForEnded_ACU: () => m.consumeGeneration(), shouldProcessAutoTableUpdateForGenerationEnded_ACU: (...args: any[]) => m.autoUpdate(...args), shouldProcessPlotForGeneration_ACU: (...args: any[]) => m.shouldProcessPlot(...args), shouldProcessSummaryVectorIndexForGeneration_ACU: (...args: any[]) => m.shouldProcessSummary(...args),
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
vi.mock('../../../src/service/plot/plot-logic', () => ({ markPlotIntercept_ACU: m.markIntercept, shouldSkipPlotIntercept_ACU: m.skipIntercept }));
vi.mock('../../../src/service/plot/plot-orchestrator', () => ({ orchestrateTavernHelperHook_ACU: (...args: any[]) => m.orchestrate(...args), orchestrateAfterCommandsStrategy1_ACU: (...args: any[]) => m.strategy1(...args), orchestrateAfterCommandsStrategy2_ACU: (...args: any[]) => m.strategy2(...args) }));
vi.mock('../../../src/service/runtime/plot-runtime/plot-history-preset', () => ({ flushPlotPendingSave_ACU: (...args: any[]) => m.flushPlot(...args) }));
vi.mock('../../../src/data/gateways/chat-gateway', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/data/gateways/chat-gateway')>(),
  saveChatToHostStrict_ACU: (...args: any[]) => m.saveChat(...args),
}));
vi.mock('../../../src/shared/host-input', () => ({
  getSendTextareaValue_ACU: () => m.getInput(),
  setSendTextareaValue_ACU: (text: string) => m.setInput(text),
  protectSendTextareaValue_ACU: (text: string) => m.protectInput(text),
}));
vi.mock('../../../src/presentation/components/plot-pending-disguise', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/presentation/components/plot-pending-disguise')>(),
  beginPlotPendingDisguise_ACU: (...args: any[]) => m.beginDisguise(...args),
  PLOT_PENDING_NOTICE_ACU: '剧情推进', SUMMARY_RECALL_PENDING_NOTICE_ACU: '召回',
}));
vi.mock('../../../src/presentation/components/plot-planning-ui', () => ({ runOptimizationLogicWithUI_ACU: vi.fn() }));
vi.mock('../../../src/presentation/components/summary-vector-index-ui', () => ({ processSummaryVectorIndexBeforeGenerationWithUI_ACU: (...args: any[]) => m.processBeforeGen(...args), shouldRebuildSummaryVectorIndexWithUI_ACU: (...args: any[]) => m.shouldRebuild(...args), rebuildCurrentSummaryVectorIndexWithUI_ACU: (...args: any[]) => m.rebuild(...args) }));
vi.mock('../../../src/service/vector/summary-vector-index-cache-service', () => ({ preloadSummaryVectorIndexCacheForCurrentChat_ACU: (...args: any[]) => m.preload(...args) }));
vi.mock('../../../src/service/vector/summary-vector-index-flush-queue', () => ({ restoreSummaryVectorIndexFlushQueueForCurrentChat_ACU: (...args: any[]) => m.restoreFlush(...args) }));
vi.mock('../../../src/service/fill-mode/fill-mode-gate', () => ({ isVectorPipelineEnabledForCurrentChat_ACU: () => m.vectorPipelineEnabled() }));
vi.mock('../../../src/service/vector/summary-vector-index-realign-state', () => ({ markSummaryVectorIndexDirtyForRealign_ACU: vi.fn() }));
vi.mock('../../../src/service/continuation/internal-ai-events', () => ({
  bindContinuationInternalAiGenerationStarted_ACU: (...args: any[]) => m.bindInternalGeneration(...args),
  consumeContinuationInternalAiGenerationEnded_ACU: (...args: any[]) => m.consumeInternalGeneration(...args),
}));
vi.mock('../../../src/service/simulation/simulation-internal-ai-events', () => ({
  bindWorldSimulationInternalAiGenerationStarted_ACU: (...args: any[]) => m.bindSimulationInternalGeneration(...args),
  consumeWorldSimulationInternalAiGenerationEnded_ACU: (...args: any[]) => m.consumeSimulationInternalGeneration(...args),
  hasWorldSimulationInternalAiInflight_ACU: () => false,
}));
vi.mock('../../../src/service/simulation/simulation-runtime', () => ({
  createWorldSimulationCompletionIntentForCurrentChat_ACU: (...args: any[]) => m.createSimulationIntent(...args),
  getWorldSimulationRuntime_ACU: () => m.getSimulationRuntime(),
}));
vi.mock('../../../src/service/continuation/continuation-runtime', () => ({ getContinuationRuntime_ACU: () => m.getContinuationRuntime() }));
vi.mock('../../../src/service/continuation/host-generation-bridge-registry', () => ({ getContinuationHostGenerationBridge_ACU: () => m.continuationBridge }));

import { disposePlotPendingHandoff_ACU, handoffPlotPendingSend_ACU } from '../../../src/presentation/components/plot-pending-disguise';

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
    if (event === 'message_sent') m.messageSent = callback;
    if (event === 'generation_stopped') m.generationStopped = callback;
    if (event === 'after_commands') m.afterCommands = callback;
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

afterEach(() => {
  disposePlotPendingHandoff_ACU(false);
  vi.clearAllTimers();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
  delete m.settings.worldSimulationPageEnabled;
  delete m.settings.plotSendDisguiseDisabled;
  m.api.chat = [];
  m.currentChatKey = '';
  m.preload.mockResolvedValue({ success: true, skipped: true, reason: 'no_manifest', chunkCount: 0 });
  m.shouldRebuild.mockReturnValue(false);
  m.rebuild.mockResolvedValue(undefined);
  m.restoreFlush.mockResolvedValue(0);
  m.processBeforeGen.mockResolvedValue({ success: true, skipped: true, reason: 'no_index_state' });
  m.orchestrate.mockResolvedValue({ action: 'passthrough' });
  m.strategy1.mockResolvedValue({ action: 'no_match' });
  m.strategy2.mockResolvedValue({ action: 'skip' });
  m.shouldProcessPlot.mockReturnValue(false);
  m.flushPlot.mockResolvedValue(null);
  m.saveChat.mockResolvedValue(undefined);
  m.input = '';
  m.api.stopGeneration = m.stopGeneration;
  m.skipIntercept.mockReturnValue(false);
  m.draftInputListener = null;
  m.jquery.mockReturnValue({
    on: (_event: string, listener: () => void) => { m.draftInputListener = listener; },
    off: () => { m.draftInputListener = null; },
  });
  m.getInput.mockImplementation(() => m.input);
  m.setInput.mockImplementation((text: string) => { m.input = text; return true; });
  m.protectInput.mockImplementation((text: string) => m.setInput(text) ? {
    element: document.querySelector('#send_textarea'),
    getDraft: () => '',
    release: (value: string) => { m.input = value; },
  } : null);

  m.beginDisguise.mockImplementation((originalText: string) => {
    m.input = '';
    return { originalText, release: m.releaseDisguise, discard: m.discardDisguise, setNotice: m.setNotice };
  });
  m.releaseDisguise.mockImplementation((text: string, options?: { waitForMessage?: boolean }) => {
    return options?.waitForMessage ? handoffPlotPendingSend_ACU(text) : m.setInput(text);
  });
  m.shouldProcessSummary.mockReturnValue(false);
  m.continuationRuntimeInitialize.mockResolvedValue(undefined);
  m.consumeInternalGeneration.mockReturnValue(null);
  m.consumeSimulationInternalGeneration.mockReturnValue(null);
  m.handleSimulationCompletion.mockResolvedValue(null);
  m.getSimulationRuntime.mockReturnValue({ handleAssistantCompletion: m.handleSimulationCompletion });
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
    expect(m.bindSimulationInternalGeneration).toHaveBeenCalledWith(m.gate.generationSeq);
    expect(m.consumeInternalGeneration).toHaveBeenCalledWith(m.gate.generationSeq);
    expect(m.consumeSimulationInternalGeneration).not.toHaveBeenCalled();
    expect(m.handleSimulationCompletion).not.toHaveBeenCalled();
    expect(m.autoUpdate).not.toHaveBeenCalled();
    expect(m.handleNewMessage).not.toHaveBeenCalled();
  });
});

describe('mainInitialize_ACU world simulation generation isolation', () => {
  it('simulation 内部生成结束时短路自动推演与常规正文管线', () => {
    m.consumeSimulationInternalGeneration.mockReturnValueOnce({ requestId: 'simulation-request', runId: 'run-a', role: 'world-director' });

    m.generationStarted!('normal', {}, false);
    m.generationEnded!(42);

    expect(m.bindSimulationInternalGeneration).toHaveBeenCalledWith(m.gate.generationSeq);
    expect(m.consumeSimulationInternalGeneration).toHaveBeenCalledWith(m.gate.generationSeq);
    expect(m.handleSimulationCompletion).not.toHaveBeenCalled();
    expect(m.autoUpdate).not.toHaveBeenCalled();
    expect(m.handleNewMessage).not.toHaveBeenCalled();
  });

  it('缺失开关默认不派发；开启后派发，关闭后停止且不影响自动填表', async () => {
    m.currentChatKey = 'chat-a';
    m.api.chat = [{ is_user: false, mes: 'assistant', message_id: 42 }];

    m.generationStarted!('normal', {}, false);
    m.generationEnded!(42);
    expect(m.createSimulationIntent).not.toHaveBeenCalled();
    expect(m.getSimulationRuntime).not.toHaveBeenCalled();
    expect(m.handleNewMessage).toHaveBeenCalledTimes(1);

    m.settings.worldSimulationPageEnabled = true;
    m.generationStarted!('normal', {}, false);
    m.generationEnded!(42);
    await Promise.resolve();
    expect(m.handleSimulationCompletion).toHaveBeenCalledTimes(1);

    m.settings.worldSimulationPageEnabled = false;
    m.generationStarted!('normal', {}, false);
    m.generationEnded!(42);
    expect(m.createSimulationIntent).toHaveBeenCalledTimes(1);
    expect(m.handleSimulationCompletion).toHaveBeenCalledTimes(1);
    expect(m.handleNewMessage).toHaveBeenCalledTimes(3);
  });

  it('普通最终 assistant 正文构造冻结意图并派发一次格林推演', async () => {
    m.settings.worldSimulationPageEnabled = true;
    m.currentChatKey = 'chat-a';
    m.api.chat = [{ is_user: true, mes: 'user' }, { is_user: false, mes: 'assistant', message_id: 42 }];

    m.generationStarted!('normal', {}, false);
    m.generationEnded!(42);
    await Promise.resolve();

    expect(m.createSimulationIntent).toHaveBeenCalledWith(42, 'chat-a', 'test-isolation', m.gate.generationSeq);
    expect(m.handleSimulationCompletion).toHaveBeenCalledTimes(1);
    expect(m.handleSimulationCompletion).toHaveBeenCalledWith(expect.objectContaining({ eventMessageId: 42, chatKey: 'chat-a' }));
  });

  it('quiet、dryRun 与 automatic_trigger 不派发格林推演', async () => {
    m.settings.worldSimulationPageEnabled = true;
    m.currentChatKey = 'chat-a';
    m.api.chat = [{ is_user: false, mes: 'assistant', message_id: 42 }];

    m.isQuiet.mockImplementation((type: any) => type === 'quiet');
    m.generationStarted!('quiet', {}, false);
    m.generationEnded!(42);
    m.generationStarted!('normal', {}, true);
    m.generationEnded!(42);
    m.generationStarted!('normal', { automatic_trigger: true }, false);
    m.generationEnded!(42);
    await Promise.resolve();

    expect(m.createSimulationIntent).not.toHaveBeenCalled();
    expect(m.handleSimulationCompletion).not.toHaveBeenCalled();
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
    expect(m.flushPlot).toHaveBeenCalledOnce();
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
    expect(m.flushPlot).not.toHaveBeenCalled();
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

    // 即使上一轮停在用户层，本轮发送框输入也必须优先，不能规划/覆盖旧层。
    const previousReply = { is_user: true, mes: '上一轮用户输入' };
    m.api.chat = [previousReply];
    m.input = '用户原文';
    m.shouldProcessPlot.mockReturnValue(true);
    m.processBeforeGen.mockResolvedValue({ success: true });
    m.strategy2.mockResolvedValue({ action: 'planned', finalMessage: '最终注入内容' });
    const params: any = {};
    expect(m.afterCommands).toBeTypeOf('function');
    await m.afterCommands!('normal', params, false);

    expect(m.beginDisguise).toHaveBeenCalledTimes(1);
    expect(m.beginDisguise).toHaveBeenCalledWith('用户原文', { notice: '召回' });
    expect(m.setNotice).toHaveBeenCalledWith('剧情推进');
    expect(m.strategy2).toHaveBeenCalledWith('用户原文', expect.any(Function));
    expect(m.releaseDisguise).toHaveBeenCalledWith('最终注入内容', { waitForMessage: true });
    expect(m.input).toBe('最终注入内容');
    expect(params.prompt).toBe('最终注入内容');
    expect(m.api.chat).toEqual([previousReply]);
    expect(m.flushPlot).not.toHaveBeenCalled();
    expect(m.saveChat).not.toHaveBeenCalled();
    expect(m.strategy1).not.toHaveBeenCalled();
    expect(m.processBeforeGen).toHaveBeenLastCalledWith({ userInput: '用户原文', source: 'generation_after_commands' });
    expect(m.stopGeneration).not.toHaveBeenCalled();

    // 宿主原生入楼后，事件才补写 pending，不依赖短轮询是否仍在运行。
    const userLayer = { is_user: true, mes: m.input };
    m.input = ''; // 宿主读取后正常清空输入框。
    m.api.chat.push(userLayer);
    expect(m.messageSent).toBeTypeOf('function');
    await m.messageSent!(1);
    expect(m.flushPlot).toHaveBeenCalledOnce();

    // /send 等已有用户层路径：宿主保存必须收到改写后的正文。
    m.input = ''; // /send 已经入楼，发送框不再包含待发送的输入。
    userLayer.mes = '用户原文';
    m.strategy1.mockResolvedValue({ action: 'planned', originalMessage: '用户原文', finalMessage: '已有层规划正文' });
    let savedChat: any[] = [];
    m.saveChat.mockImplementationOnce(async () => { savedChat = JSON.parse(JSON.stringify(m.api.chat)); });
    await m.afterCommands!('normal', {}, false);
    expect(m.saveChat).toHaveBeenCalledOnce();
    expect(savedChat[1].mes).toBe('已有层规划正文');
    expect(m.api.eventSource.emit).toHaveBeenCalledWith('message_updated', 1);
    expect(m.beginDisguise).toHaveBeenCalledTimes(1);
    expect(m.strategy2).toHaveBeenCalledTimes(1);

    // 空聊天也应规划本次输入；不再因没有历史楼层提前返回。
    m.api.chat = [];
    m.input = '首轮输入';
    await m.afterCommands!('normal', {}, false);
    expect(m.input).toBe('最终注入内容');
    expect(m.strategy2).toHaveBeenLastCalledWith('首轮输入', expect.any(Function));
    m.api.chat.push({ is_user: true, mes: m.input });
    m.input = '';
    await m.messageSent!(0);

    // 去重只针对成功交接的最终文本，不能被旧用户层的文本命中截断。
    m.api.chat = [{ is_user: true, mes: '旧用户层' }];
    m.skipIntercept.mockImplementation((text: string) => text === '旧用户层');
    m.input = '新一轮原文';
    await m.afterCommands!('normal', {}, false);
    expect(m.input).toBe('最终注入内容');
    m.api.chat.push({ is_user: true, mes: m.input });
    m.input = '';
    await m.messageSent!(1);

    // 明确无需规划应恢复原文发送，不停止生成。
    m.input = '无需规划原文';
    m.strategy2.mockResolvedValueOnce({ action: 'skip' });
    m.stopGeneration.mockClear();
    m.releaseDisguise.mockClear();
    m.protectInput.mockClear();
    const skipParams: any = {};
    await m.afterCommands!('normal', skipParams, false);
    expect(m.stopGeneration).not.toHaveBeenCalled();
    expect(m.protectInput).not.toHaveBeenCalled();
    expect(m.releaseDisguise).toHaveBeenCalledWith('无需规划原文', { waitForMessage: false });
    expect(m.input).toBe('无需规划原文');
    expect(skipParams.prompt).toBeUndefined();

    // 失败/忙碌/中止都必须调用真实取消函数，不能仅设置内部标记放行原文。
    for (const action of ['failed', 'aborted']) {
      m.input = '失败轮原文';
      m.strategy2.mockResolvedValueOnce({ action });
      m.stopGeneration.mockClear();
      m.releaseDisguise.mockClear();
      await m.afterCommands!('normal', {}, false);
      expect(m.stopGeneration).toHaveBeenCalledOnce();
      expect(m.releaseDisguise).toHaveBeenCalledOnce();
      expect(m.releaseDisguise).toHaveBeenCalledWith('', { restoreDraft: '失败轮原文' });
      expect(m.input).toBe('');
    }

    // release 返回 false，或谎报成功但发送框仍是原文，均须停止生成并清空。
    vi.useFakeTimers();
    for (const reportedSuccess of [false, true]) {
      m.input = '写回前原文';
      m.strategy2.mockResolvedValueOnce({ action: 'planned', finalMessage: '应发送的提示词' });
      m.releaseDisguise.mockImplementationOnce(() => { m.input = '写回前原文'; return reportedSuccess; });
      m.stopGeneration.mockClear();
      await m.afterCommands!('normal', {}, false);
      expect(m.stopGeneration).toHaveBeenCalledOnce();
      expect(m.input).toBe('');
      // 宿主继续读到的是空文本；触发其清空事件后，下一任务才恢复草稿。
      expect(m.draftInputListener).toBeTypeOf('function');
      const hostReadText = m.input;
      m.draftInputListener!();
      expect(m.input).toBe('');
      await vi.advanceTimersByTimeAsync(0);
      expect(hostReadText).toBe('');
      expect(m.input).toBe('写回前原文');
      expect(m.draftInputListener).toBeNull();
    }

    // 无伪装时也校验发送框写回，不能把 setter 的失败静默吞掉。
    m.shouldProcessSummary.mockReturnValue(false);
    m.beginDisguise.mockReturnValueOnce(null);
    m.input = '无伪装原文';
    m.setInput.mockImplementationOnce(() => false);
    m.stopGeneration.mockClear();
    await m.afterCommands!('normal', {}, false);
    expect(m.stopGeneration).toHaveBeenCalledOnce();
    expect(m.input).toBe('');

    // 恢复不能覆盖用户在等待期间新写的草稿。
    m.draftInputListener!();
    m.input = '新的草稿';
    await vi.advanceTimersByTimeAsync(0);
    expect(m.input).toBe('新的草稿');
    vi.useRealTimers();

    // TavernHelper 只有成功写回最终提示词才调用原始 generate。
    const hostGenerate = (window as any).original_TavernHelper_generate_ACU;
    const hostCalls = hostGenerate.mock.calls.length;
    for (const action of ['failed', 'skipped', 'loop_retry', 'aborted']) {
      m.orchestrate.mockResolvedValueOnce({ action });
      await (window as any).TavernHelper.generate({ user_input: '不能透传的原文' });
      expect(hostGenerate).toHaveBeenCalledTimes(hostCalls);
    }
    m.orchestrate.mockResolvedValueOnce({ action: 'planned', finalMessage: '最终提示词', writeBack: { target: 'user_input', value: '最终提示词' } });
    const options = { user_input: '原文', injects: [{ content: '保留的附加提示' }] };
    await (window as any).TavernHelper.generate(options);
    expect(hostGenerate).toHaveBeenCalledTimes(hostCalls + 1);
    expect(options.user_input).toBe('最终提示词');
    expect(options.injects[0].content).toBe('保留的附加提示');
    expect(m.markIntercept).toHaveBeenCalledWith('最终提示词');
  });
});


describe('发送交接生命周期', () => {
  it('伪装等待后宿主正常发送正文，完整剧情数据保存到本轮真实用户楼层', async () => {
    vi.useFakeTimers();
    const hostInput = await vi.importActual<typeof import('../../../src/shared/host-input')>('../../../src/shared/host-input');
    const element = document.querySelector<HTMLTextAreaElement>('#send_textarea')!;
    const collection = {
      0: element, length: 1,
      val(value?: string) {
        if (value !== undefined) element.value = value;
        return element.value;
      },
      trigger: vi.fn(),
    };
    m.jquery.mockReturnValue(collection);
    m.getInput.mockImplementation(() => element.value);
    m.setInput.mockImplementation(hostInput.setSendTextareaValue_ACU);
    m.protectInput.mockImplementation(hostInput.protectSendTextareaValue_ACU);
    m.currentChatKey = 'chat-a';

    // 仅召回必须执行真实伪装释放，不能由 release mock 掩盖输入框被锁定的回归。
    const pendingUi = document.createElement('div');
    pendingUi.innerHTML = '<div id="chat"></div><div id="message_template"><div class="mes"><span class="name_text"></span><div class="avatar"><img></div><div class="mes_text"></div></div></div>';
    document.body.appendChild(pendingUi);
    const wrap = (nodes: HTMLElement[]): any => ({
      0: nodes[0], length: nodes.length,
      first: () => wrap(nodes.slice(0, 1)),
      last: () => wrap(nodes.slice(-1)),
      not: (selector: string) => wrap(nodes.filter(node => !node.matches(selector))),
      children: (selector: string) => wrap(nodes.flatMap(node => Array.from(node.children) as HTMLElement[]).filter(node => node.matches(selector))),
      find: (selector: string) => wrap(nodes.flatMap(node => Array.from(node.querySelectorAll<HTMLElement>(selector)))),
      clone: () => wrap(nodes.map(node => node.cloneNode(true) as HTMLElement)),
      addClass: (name: string) => { nodes.forEach(node => node.classList.add(name)); return wrap(nodes); },
      attr: (name: string | Record<string, string>, value?: string) => {
        if (typeof name === 'string' && value === undefined) return nodes[0]?.getAttribute(name);
        const attributes = typeof name === 'string' ? { [name]: value! } : name;
        nodes.forEach(node => Object.entries(attributes).forEach(([key, text]) => node.setAttribute(key, text)));
        return wrap(nodes);
      },
      text: (text: string) => { nodes.forEach(node => { node.textContent = text; }); return wrap(nodes); },
      html: (html: string) => { nodes.forEach(node => { node.innerHTML = html; }); return wrap(nodes); },
      css: () => wrap(nodes),
      empty: () => { nodes.forEach(node => node.replaceChildren()); return wrap(nodes); },
      append: (other: any) => { nodes[0]?.append(...Array.from({ length: other.length }, (_, index) => other[index])); return wrap(nodes); },
      add: (other: any) => wrap([...nodes, ...Array.from({ length: other.length }, (_, index) => other[index])]),
      remove: () => nodes.forEach(node => node.remove()),
      scrollTop: () => wrap(nodes),
    });
    m.jquery.mockImplementation((selector: string, attributes?: Record<string, string>) => {
      if (selector === '#send_textarea') return collection;
      if (selector === '<span>') return wrap([document.createElement('span')]).attr(attributes!);
      return wrap(Array.from(document.querySelectorAll<HTMLElement>(selector)));
    });
    const pendingDisguise = await vi.importActual<typeof import('../../../src/presentation/components/plot-pending-disguise')>('../../../src/presentation/components/plot-pending-disguise');
    m.beginDisguise.mockImplementationOnce(pendingDisguise.beginPlotPendingDisguise_ACU);
    m.shouldProcessSummary.mockReturnValue(true);
    element.value = '仅召回原文';
    await m.afterCommands!('normal', {}, false);
    expect(m.beginDisguise).toHaveBeenCalledWith('仅召回原文', { notice: '召回' });
    expect(m.strategy2).not.toHaveBeenCalled();
    expect(m.protectInput).not.toHaveBeenCalled();
    expect(element.readOnly).toBe(false);
    expect(element.value).toBe('仅召回原文');
    expect(document.querySelector('.acu-plot-pending-mes')).toBeNull();
    const sendClick = new MouseEvent('click', { bubbles: true, cancelable: true });
    expect(document.querySelector('#send_but')!.dispatchEvent(sendClick)).toBe(true);
    pendingUi.remove();
    m.jquery.mockReturnValue(collection);
    m.beginDisguise.mockClear();
    m.settings.plotSendDisguiseDisabled = true;
    m.shouldProcessSummary.mockReturnValue(true);
    m.shouldProcessPlot.mockReturnValue(true);
    m.api.chat = [{ is_user: true, mes: '最终提示词' }];
    element.value = '本轮原文';
    let recallDone!: (value: any) => void;
    let planningDone!: (value: any) => void;
    let signalRecall!: () => void;
    let signalPlanning!: () => void;
    const recallStarted = new Promise<void>(resolve => { signalRecall = resolve; });
    const planningStarted = new Promise<void>(resolve => { signalPlanning = resolve; });
    m.processBeforeGen.mockImplementationOnce(() => {
      signalRecall();
      return new Promise(resolve => { recallDone = resolve; });
    });
    m.strategy2.mockImplementationOnce(() => {
      signalPlanning();
      return new Promise(resolve => { planningDone = resolve; });
    });
    const params: any = {};
    const pending = m.afterCommands!('normal', params, false);
    await recallStarted;
    expect(element.value).toBe('本轮原文');
    expect(m.beginDisguise).not.toHaveBeenCalled();
    recallDone({ success: true });
    await planningStarted;
    expect(m.strategy2).toHaveBeenCalledWith('本轮原文', expect.any(Function));
    expect(element.value).toBe('本轮原文');
    planningDone({ action: 'planned', finalMessage: '最终提示词' });
    await pending;
    expect(element.value).toBe('最终提示词');
    expect(element.readOnly).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(element, 'value')).toBe(false);
    expect(m.protectInput).not.toHaveBeenCalled();
    expect(params.prompt).toBe('最终提示词');
    expect(m.markIntercept).toHaveBeenCalledWith('最终提示词');
    await m.messageSent!(0);
    expect(element.value).toBe('最终提示词');

    // 宿主先读取并清空，再创建真实楼层；MESSAGE_SENT 等待 pending 保存完成才继续生成。
    const hostRead = String(collection.val());
    collection.val('');
    element.dispatchEvent(new Event('input', { bubbles: true }));
    m.api.chat.push({ is_user: true, mes: `宿主处理后的${hostRead}` });
    let savedChat: any[] = JSON.parse(JSON.stringify(m.api.chat)); // 宿主原生建楼保存。
    const pendingPlot = { content: '完整剧情反馈', taskResults: { task: '任务反馈' } };
    let finishSave!: () => void;
    m.saveChat.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { finishSave = resolve; });
      savedChat = JSON.parse(JSON.stringify(m.api.chat));
    });
    m.flushPlot.mockImplementationOnce(async () => {
      const layer = m.api.chat[1];
      layer.qrf_plot = pendingPlot.content;
      layer.qrf_plot_tasks = pendingPlot.taskResults;
      await m.saveChat();
      return { status: 'committed', targetIndex: 1 };
    });
    const { confirmPlotPendingHandoff_ACU } = await import('../../../src/presentation/components/plot-pending-disguise');
    expect(confirmPlotPendingHandoff_ACU()).toBe(false);
    let generationText: string | undefined;
    const hostContinue = (async () => {
      await m.messageSent!(1);
      generationText = m.api.chat[1].mes;
    })();
    expect(generationText).toBeUndefined();
    expect(savedChat[1].qrf_plot).toBeUndefined();
    finishSave();
    await hostContinue;
    expect(hostRead).toBe('最终提示词');
    expect(element.readOnly).toBe(false);
    expect(element.value).toBe('');
    expect(generationText).toBe('宿主处理后的最终提示词');
    expect(savedChat).toHaveLength(2);
    expect(savedChat[0]).toEqual({ is_user: true, mes: '最终提示词' });
    expect(savedChat[1]).toMatchObject({ is_user: true, mes: generationText, qrf_plot: pendingPlot.content, qrf_plot_tasks: pendingPlot.taskResults });
    expect(m.stopGeneration).not.toHaveBeenCalled();
    element.value = '下一轮草稿';
    expect(element.value).toBe('下一轮草稿');
    m.shouldProcessSummary.mockReturnValue(false);
    m.strategy2.mockResolvedValue({ action: 'planned', finalMessage: '停止轮提示词' });
    await m.afterCommands!('normal', {}, false);
    expect(element.readOnly).toBe(false);
    m.generationStopped!();
    expect(element.readOnly).toBe(false);
    expect(element.value).toBe('');
    expect(Object.prototype.hasOwnProperty.call(element, 'value')).toBe(false);
  });

  it('停止或切聊天后迟到的规划结果不写发送框、不登记成功交接', async () => {
    vi.useFakeTimers();
    m.shouldProcessPlot.mockReturnValue(true);
    for (const scenario of ['stopped', 'chat_changed']) {
      m.currentChatKey = 'chat-a';
      m.api.chat = [];
      m.input = '原文';
      let finish!: (value: any) => void;
      let signalPlanning!: () => void;
      const started = new Promise<void>(resolve => { signalPlanning = resolve; });
      m.strategy2.mockImplementationOnce(() => {
        signalPlanning();
        return new Promise(resolve => { finish = resolve; });
      });
      const params: any = {};
      const pending = m.afterCommands!('normal', params, false);
      await started;
      expect(m.input).toBe('');
      if (scenario === 'stopped') m.generationStopped!();
      else {
        m.api.chat = [];
        await m.chatChanged!('');
      }
      m.input = '当前会话的新草稿';
      m.releaseDisguise.mockClear();
      m.markIntercept.mockClear();
      m.discardDisguise.mockClear();
      finish({ action: 'planned', finalMessage: '已失效的提示词' });
      await pending;
      expect(m.releaseDisguise).not.toHaveBeenCalled();
      expect(m.discardDisguise).toHaveBeenCalled();
      expect(m.markIntercept).not.toHaveBeenCalled();
      expect(m.input).toBe('当前会话的新草稿');
      expect(params.prompt).toBeUndefined();
    }
  });
});
