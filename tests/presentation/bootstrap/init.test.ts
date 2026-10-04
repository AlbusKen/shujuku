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
  strategy1: vi.fn(), shouldProcessPlot: vi.fn(),
  flushPlot: vi.fn(), saveChat: vi.fn(),
  persistedChat: [] as any[],
  ensureSeed: vi.fn(), processingPlot: false,
  hostEmit: vi.fn(), messageUpdated: vi.fn(),
  getInput: vi.fn(), setInput: vi.fn(),
  beginDisguise: vi.fn(), finishDisguise: vi.fn(), generate: vi.fn(),
  markIntercept: vi.fn(), stopGeneration: vi.fn(),
  jquery: vi.fn(), clearPendingPlot: vi.fn(),
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
vi.mock('../../../src/service/runtime/helpers-remaining', () => ({ ensureInitialSeedCheckpoint_ACU: m.ensureSeed, handleChatCompletionReady_ACU: vi.fn(), loadPresetAndCleanCharacterData_ACU: m.loadPreset }));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  chatMutationDebounceTimer_ACU: null, _set_chatMutationDebounceTimer_ACU: m.setChatMutationTimer, _set_wasStoppedByUser_ACU: vi.fn(), generationGate_ACU: m.gate,
  get currentChatFileIdentifier_ACU() { return m.currentChatKey; }, currentJsonTableData_ACU: null, getCurrentIsolationKey_ACU: () => 'test-isolation', discardLatestGenerationContext_ACU: vi.fn(), markUserSendIntent_ACU: vi.fn(), get isProcessing_Plot_ACU() { return m.processingPlot; }, isQuietLikeGeneration_ACU: (...args: any[]) => m.isQuiet(...args), isRecentUserSendIntent_ACU: vi.fn(), loopState_ACU: { isLooping: false }, recordGenerationContext_ACU: (...args: any[]) => m.recordGeneration(...args), recordLastUserSend_ACU: vi.fn(), settings_ACU: m.settings, consumeGenerationContextForEnded_ACU: () => m.consumeGeneration(), shouldProcessAutoTableUpdateForGenerationEnded_ACU: (...args: any[]) => m.autoUpdate(...args), shouldProcessPlotForGeneration_ACU: (...args: any[]) => m.shouldProcessPlot(...args), shouldProcessSummaryVectorIndexForGeneration_ACU: (...args: any[]) => m.shouldProcessSummary(...args),
  _set_allChatMessages_ACU: m.setMessages, _set_currentChatFileIdentifier_ACU: (value: string) => { m.currentChatKey = value; m.setChat(value); }, _set_currentJsonTableData_ACU: m.setData, _set_independentTableStates_ACU: m.setTables, _set_isProcessing_Plot_ACU: vi.fn(), _set_lastTotalAiMessages_ACU: m.setTotal, _set_tempPlotToSave_ACU: m.clearPendingPlot,
}));
vi.mock('../../../src/service/settings/settings-service', () => ({ applyTemplateScopeForCurrentChat_ACU: vi.fn(), loadSettings_ACU: vi.fn() }));
vi.mock('../../../src/service/worldbook/injection-engine', () => ({ resetScriptStateForNewChat_ACU: m.resetScript }));
vi.mock('../../../src/service/agent/agent-worldbook-takeover', () => ({ resetPlotAgentWorldbookSessionSnapshot_ACU: m.resetTakeover }));
vi.mock('../../../src/service/table/table-storage-strategy', () => ({ reloadStorageProvider: vi.fn(), disposeStorageProvider: m.dispose }));
vi.mock('../../../src/service/table/storage-mode', () => ({ isSqliteMode: vi.fn(() => false) }));
vi.mock('../../../src/service/worldbook/pipeline', () => ({ loadAllChatMessages_ACU: m.loadMessages }));
vi.mock('../../../src/presentation/components/pipeline-ui-helpers', () => ({ refreshMergedDataAndNotifyWithUI_ACU: m.refresh }));

vi.mock('../../../src/shared/utils', () => ({ cleanChatName_ACU: vi.fn((name: string) => name), logDebug_ACU: vi.fn(), logError_ACU: vi.fn(), logWarn_ACU: vi.fn() }));
vi.mock('../../../src/service/plot/plot-logic', () => ({ markPlotIntercept_ACU: m.markIntercept }));
vi.mock('../../../src/service/plot/plot-orchestrator', () => ({ orchestrateTavernHelperHook_ACU: (...args: any[]) => m.orchestrate(...args), orchestrateAfterCommandsStrategy1_ACU: (...args: any[]) => m.strategy1(...args) }));
vi.mock('../../../src/service/runtime/plot-runtime/plot-history-preset', () => ({ flushPlotPendingSave_ACU: (...args: any[]) => m.flushPlot(...args) }));
vi.mock('../../../src/shared/host-input', () => ({
  getSendTextareaValue_ACU: () => m.getInput(),
  setSendTextareaValue_ACU: (text: string) => m.setInput(text),

}));
vi.mock('../../../src/presentation/components/plot-pending-disguise', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/presentation/components/plot-pending-disguise')>(),
  beginPlotPendingDisguise_ACU: (...args: any[]) => m.beginDisguise(...args),

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

import { disposePlotPendingDisguise_ACU } from '../../../src/presentation/components/plot-pending-disguise';

let reinitialize_ACU: (() => void) | null = null;

beforeAll(async () => {
  document.body.innerHTML = '<button id="send_but"></button><textarea id="send_textarea"></textarea><div id="chat"></div><div id="message_template"><div class="mes"><span class="name_text"></span><div class="avatar"><img></div><details class="mes_reasoning_details"><summary class="mes_reasoning_summary flex-container"><div class="mes_reasoning_header_block flex-container"><div class="mes_reasoning_header flex-container"><span class="mes_reasoning_header_title"></span><div class="mes_reasoning_arrow fa-solid fa-chevron-up"></div></div></div></summary><div class="mes_reasoning"></div></details><div class="mes_text"></div></div></div>';
  vi.spyOn(globalThis, 'setInterval').mockImplementation(() => 0 as any);
  // T5：TavernHelper.generate 钩子测试需要宿主 API 在 mainInitialize 前就绪，钩子才会被安装。
  (window as any).TavernHelper = { generate: vi.fn(async (...args: any[]) => ({ handled: true, args })) };
  // 与宿主一致：原派发器吞掉监听器异常，阻断必须由外层派发返回边界完成。
  m.hostEmit.mockImplementation(async (event: string, ...args: any[]) => {
    if (event === 'after_commands') {
      try { await m.afterCommands!(args[0], args[1], args[2]); } catch { /* 宿主吞监听器异常 */ }
    } else if (event === 'message_sent') {
      await m.messageSent?.(args[0]);
    } else if (event === 'message_updated') {
      await m.messageUpdated(args[0]);
    }
  });
  m.api.eventSource.emit = m.hostEmit;
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
  disposePlotPendingDisguise_ACU();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.clearAllMocks();
  m.processingPlot = false;
  m.ensureSeed.mockResolvedValue(false);
  m.isQuiet.mockReturnValue(false);
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

  m.shouldProcessPlot.mockReturnValue(false);
  m.flushPlot.mockResolvedValue(null);
  m.messageUpdated.mockResolvedValue(undefined);
  m.persistedChat = [];
  m.saveChat.mockImplementation(async () => { m.persistedChat = JSON.parse(JSON.stringify(m.api.chat)); });
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200,
    json: async () => JSON.parse(JSON.stringify(m.api.groupId != null ? m.persistedChat : [{ chat_metadata: {} }, ...m.persistedChat])),
  })));
  m.input = '';
  m.api.stopGeneration = m.stopGeneration;
  m.api.name1 = '用户';
  m.api.name2 = '角色';
  m.api.chatId = 'chat-a';
  m.api.characterId = '0';
  m.api.characters = [{ name: '角色', avatar: 'character.png' }];
  delete m.api.groupId;
  m.api.eventTypes.USER_MESSAGE_RENDERED = 'user_message_rendered';
  m.api.humanizedDateTime = () => '2026-01-01';
  m.api.saveChat = m.saveChat;
  m.api.generate = m.generate;
  m.generate.mockResolvedValue(undefined);
  m.jquery.mockImplementation((selector: string) => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
    return { ...nodes, length: nodes.length, remove: () => nodes.forEach(node => node.remove()) };
  });
  m.api.addOneMessage = vi.fn((message: any) => {
    const node = document.createElement('div');
    node.className = 'mes';
    node.setAttribute('mesid', String(m.api.chat.indexOf(message)));
    node.setAttribute('is_user', String(message.is_user));
    node.innerHTML = '<div class="mes_text"></div>';
    node.querySelector('.mes_text')!.textContent = message.mes;
    document.querySelector('#chat')?.append(node);
  });
  m.api.updateMessageBlock = vi.fn((index: number, message: any) => {
    const content = document.querySelector(`#chat .mes[mesid="${index}"] .mes_text`);
    if (content) content.textContent = message.mes;
  });
  document.querySelector('#chat')?.replaceChildren();
  m.getInput.mockImplementation(() => m.input);
  m.setInput.mockImplementation((text: string) => { m.input = text; return true; });
  m.beginDisguise.mockImplementation(() => ({ finish: m.finishDisguise }));
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

describe('mainInitialize_ACU TavernHelper.generate 独立入口契约', () => {
  it('召回异常沿用原入口降级，只有有效剧情结果才能交给原始生成', async () => {
    await m.chatChanged!('chat-a');
    m.shouldProcessSummary.mockReturnValue(true);
    m.processBeforeGen.mockRejectedValueOnce(new Error('召回请求失败'));
    const args = [{ user_input: 'find relic' }];
    const hostGenerate = (window as any).original_TavernHelper_generate_ACU;
    const result = await (window as any).TavernHelper.generate(...args);
    expect(m.processBeforeGen).toHaveBeenCalledOnce();
    expect(m.orchestrate).toHaveBeenCalledOnce();
    expect(hostGenerate).toHaveBeenCalledExactlyOnceWith(...args);
    expect(result).toEqual({ handled: true, args });

    const hostCalls = hostGenerate.mock.calls.length;
    for (const action of ['failed', 'skipped', 'loop_retry', 'aborted', 'busy']) {
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
    expect(m.generate).not.toHaveBeenCalled();
  });
});


// 钩子由 mainInitialize_ACU 在 beforeAll 时安装（window.TavernHelper 已就绪）。
describe('发送前处理楼层生命周期', () => {
  it('等待时真实入楼，成功保存完整剧情数据后保留同一节点并重生成一次', async () => {
    vi.useFakeTimers();
    m.shouldProcessPlot.mockReturnValue(true);
    m.shouldProcessSummary.mockReturnValue(true);
    const pendingUi = await vi.importActual<typeof import('../../../src/presentation/components/plot-pending-disguise')>('../../../src/presentation/components/plot-pending-disguise');
    m.beginDisguise.mockImplementation(pendingUi.beginPlotPendingDisguise_ACU);
    const previous = { is_user: false, mes: '历史回复' };
    m.api.chat = [previous];
    m.input = '本轮原输入';
    let complete!: (result: any) => void;
    let started!: () => void;
    const planningStarted = new Promise<void>(resolve => { started = resolve; });
    m.strategy1.mockImplementationOnce(() => {
      started();
      return new Promise(resolve => { complete = resolve; });
    });
    let savedChat: any[] = [];
    m.saveChat.mockImplementation(async () => {
      savedChat = JSON.parse(JSON.stringify(m.api.chat));
      m.persistedChat = savedChat;
    });
    const request = m.api.eventSource.emit('after_commands', 'normal', {}, false);
    const redirected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await planningStarted;
    const user = m.api.chat[1];
    const node = document.querySelector('#chat .mes[mesid="1"]');
    expect(user).toMatchObject({ is_user: true, mes: '本轮原输入' });
    expect(savedChat[1].mes).toBe('本轮原输入');
    expect(m.generate).not.toHaveBeenCalled();
    expect(m.input).toBe('');
    expect(document.querySelectorAll('#chat .acu-plot-pending-mes')).toHaveLength(1);
    const ai = document.querySelector<HTMLElement>('#chat .acu-plot-pending-mes')!;
    expect(ai.dataset.reasoningState).toBe('thinking');
    expect(ai.querySelector('.mes_reasoning_details')?.getAttribute('data-state')).toBe('thinking');
    expect(ai.querySelector('.mes_reasoning_header_title')?.textContent).toBe('Thinking...');
    m.input = '下一轮草稿';
    m.flushPlot.mockImplementationOnce(async () => {
      user.qrf_plot = '完整剧情反馈';
      user.qrf_plot_tasks = { task: '任务反馈' };
      await m.saveChat();
      return { status: 'committed', targetIndex: 1 };
    });
    let completeRender!: () => void;
    let renderingStarted!: () => void;
    const renderStarted = new Promise<void>(resolve => { renderingStarted = resolve; });
    m.messageUpdated.mockImplementationOnce(() => {
      renderingStarted();
      return new Promise<void>(resolve => { completeRender = resolve; });
    });
    complete({ action: 'planned', finalMessage: '最终剧情正文' });
    await renderStarted;
    expect(m.api.updateMessageBlock).toHaveBeenCalledExactlyOnceWith(1, user, { rerenderMessage: true });
    expect(m.messageUpdated).toHaveBeenCalledExactlyOnceWith(1);
    expect(m.hostEmit).toHaveBeenCalledWith('message_updated', 1);
    expect(node?.textContent).toBe('最终剧情正文');
    expect(m.generate).not.toHaveBeenCalled();
    completeRender();
    await redirected;
    expect(m.api.chat[1]).toBe(user);
    expect(document.querySelector('#chat .mes[mesid="1"]')).toBe(node);
    expect(node?.textContent).toBe('最终剧情正文');
    expect(savedChat[1]).toMatchObject({ mes: '最终剧情正文', qrf_plot: '完整剧情反馈', qrf_plot_tasks: { task: '任务反馈' } });
    expect(savedChat[0]).toEqual(previous);
    expect(m.generate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(m.generate).toHaveBeenCalledExactlyOnceWith('regenerate');
    expect(document.querySelector('#chat .acu-plot-pending-mes')).toBeNull();
    expect(m.input).toBe('下一轮草稿');
    expect(m.setInput).not.toHaveBeenCalledWith('最终剧情正文');
    await m.api.eventSource.emit('after_commands', 'regenerate', {}, false);
    expect(m.strategy1).toHaveBeenCalledOnce();
    expect(m.processBeforeGen).toHaveBeenCalledOnce();
  });

  it('失败删除本轮真实用户楼层和 AI 占位，并恢复原输入', async () => {
    vi.useFakeTimers();
    m.shouldProcessPlot.mockReturnValue(true);
    const pendingUi = await vi.importActual<typeof import('../../../src/presentation/components/plot-pending-disguise')>('../../../src/presentation/components/plot-pending-disguise');
    m.beginDisguise.mockImplementation(pendingUi.beginPlotPendingDisguise_ACU);
    const previous = { is_user: false, mes: '历史回复' };
    m.api.chat = [previous];
    for (const result of [{ action: 'failed' }, { action: 'aborted' }, { action: 'planned', finalMessage: ' ' }]) {
      m.input = '失败轮原输入';
      m.strategy1.mockResolvedValueOnce(result);
      await expect(m.api.eventSource.emit('after_commands', 'normal', {}, false)).rejects.toMatchObject({ name: 'AbortError' });
      expect(m.api.chat).toEqual([previous]);
      expect(document.querySelector('#chat .mes[mesid="1"]')).toBeNull();
      expect(document.querySelector('#chat .acu-plot-pending-mes')).toBeNull();
      expect(m.input).toBe('失败轮原输入');
    }
    m.input = '建楼保存失败原输入';
    m.saveChat.mockRejectedValueOnce(new Error('保存失败'));
    await expect(m.api.eventSource.emit('after_commands', 'normal', {}, false)).rejects.toMatchObject({ name: 'AbortError' });
    expect(m.api.chat).toEqual([previous]);
    expect(document.querySelector('#chat .mes[mesid="1"]')).toBeNull();
    expect(document.querySelector('#chat .acu-plot-pending-mes')).toBeNull();
    expect(m.input).toBe('建楼保存失败原输入');
    await vi.advanceTimersByTimeAsync(0);
    expect(m.generate).not.toHaveBeenCalled();
  });

  it('仅向量或交火召回使用同一真实楼层流程，成功保留原文，失败撤销本轮', async () => {
    vi.useFakeTimers();
    m.shouldProcessSummary.mockReturnValue(true);
    m.settings.plotSendDisguiseDisabled = true;
    const pendingUi = await vi.importActual<typeof import('../../../src/presentation/components/plot-pending-disguise')>('../../../src/presentation/components/plot-pending-disguise');
    m.beginDisguise.mockImplementation(pendingUi.beginPlotPendingDisguise_ACU);
    m.input = '召回原输入';
    await expect(m.api.eventSource.emit('after_commands', 'normal', {}, false)).rejects.toMatchObject({ name: 'AbortError' });
    expect(m.api.chat).toHaveLength(1);
    expect(m.api.chat[0].mes).toBe('召回原输入');
    expect(m.input).toBe('');
    expect(m.strategy1).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(m.generate).toHaveBeenCalledExactlyOnceWith('regenerate');
    m.input = '失败召回原输入';
    m.processBeforeGen.mockResolvedValueOnce({ success: false, reason: 'request_failed' });
    await expect(m.api.eventSource.emit('after_commands', 'normal', {}, false)).rejects.toMatchObject({ name: 'AbortError' });
    expect(m.api.chat).toHaveLength(1);
    expect(m.input).toBe('失败召回原输入');
    await vi.advanceTimersByTimeAsync(0);
    expect(m.generate).toHaveBeenCalledOnce();
  });

  it('停止或切聊天后迟到的规划结果不修改草稿、不触发正文生成', async () => {
    vi.useFakeTimers();
    m.shouldProcessPlot.mockReturnValue(true);
    for (const scenario of ['stopped', 'chat_changed']) {
      m.api.chat = [];
      m.input = '本轮原文';
      let complete!: (result: any) => void;
      let started!: () => void;
      const planningStarted = new Promise<void>(resolve => { started = resolve; });
      m.strategy1.mockImplementationOnce(() => {
        started();
        return new Promise(resolve => { complete = resolve; });
      });
      const request = m.api.eventSource.emit('after_commands', 'normal', {}, false);
      const redirected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
      await planningStarted;
      const user = m.api.chat[0];
      if (scenario === 'stopped') m.generationStopped!();
      else { m.api.chat = []; await m.chatChanged!(''); }
      m.input = '当前会话的新草稿';
      complete({ action: 'planned', finalMessage: '失效结果' });
      await redirected;
      await vi.advanceTimersByTimeAsync(0);
      expect(m.api.chat).not.toContain(user);
      expect(m.input).toBe('当前会话的新草稿');
      expect(m.generate).not.toHaveBeenCalled();
      expect(user.mes).toBe('本轮原文');
    }
  });

  it.each([false, true])('checkpoint 等待期间拒绝双入站，不调用全局停止（STOPPED=%s）', async (emitsStopped) => {
    vi.useFakeTimers();
    m.shouldProcessPlot.mockReturnValue(true);
    m.input = '首轮输入';
    m.stopGeneration.mockImplementation(() => { if (emitsStopped) m.generationStopped!(); });
    let complete!: (value: boolean) => void;
    let started!: () => void;
    const seedStarted = new Promise<void>(resolve => { started = resolve; });
    m.ensureSeed.mockImplementationOnce(() => {
      started();
      return new Promise(resolve => { complete = resolve; });
    });
    m.strategy1.mockResolvedValueOnce({ action: 'planned', finalMessage: '首轮提示词' });
    const request = m.api.eventSource.emit('after_commands', 'normal', {}, false);
    const redirected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await seedStarted;
    await expect(m.api.eventSource.emit('after_commands', 'normal', {}, false)).rejects.toMatchObject({ name: 'AbortError' });
    expect(m.ensureSeed).toHaveBeenCalledOnce();
    expect(m.api.chat).toEqual([]);
    expect(m.setInput).not.toHaveBeenCalled();
    complete(false);
    await redirected;
    await vi.advanceTimersByTimeAsync(0);
    expect(m.strategy1).toHaveBeenCalledOnce();
    expect(m.api.chat[0].mes).toBe('首轮提示词');
    expect(m.generate).toHaveBeenCalledExactlyOnceWith('regenerate');
    expect(m.stopGeneration).not.toHaveBeenCalled();
  });


  it('入口已忙时，宿主不能消费另一轮输入，也不触发全局停止', async () => {
    m.shouldProcessPlot.mockReturnValue(true);
    m.processingPlot = true;
    m.input = '有效请求的正文';
    const consume = vi.fn();
    await expect((async () => {
      await m.api.eventSource.emit('after_commands', 'normal', {}, false);
      consume();
    })()).rejects.toMatchObject({ name: 'AbortError' });
    expect(consume).not.toHaveBeenCalled();
    expect(m.api.chat).toEqual([]);
    expect(m.input).toBe('有效请求的正文');
    expect(m.ensureSeed).not.toHaveBeenCalled();
    expect(m.setInput).not.toHaveBeenCalled();
    expect(m.stopGeneration).not.toHaveBeenCalled();
  });

  it('召回期间其他入口开始规划时，仅撤销本轮楼层并保留新草稿', async () => {
    m.shouldProcessPlot.mockReturnValue(true);
    m.shouldProcessSummary.mockReturnValue(true);
    m.input = '本轮输入';
    let complete!: (result: any) => void;
    let started!: () => void;
    const recallStarted = new Promise<void>(resolve => { started = resolve; });
    m.processBeforeGen.mockImplementationOnce(() => {
      started();
      return new Promise(resolve => { complete = resolve; });
    });
    const consume = vi.fn();
    const request = (async () => {
      await m.api.eventSource.emit('after_commands', 'normal', {}, false);
      consume();
    })();
    const redirected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await recallStarted;
    m.processingPlot = true;
    m.input = '其他请求的草稿';
    m.strategy1.mockResolvedValueOnce({ action: 'busy' });
    complete({ success: true });
    await redirected;
    expect(consume).not.toHaveBeenCalled();
    expect(m.api.chat).toEqual([]);
    expect(m.input).toBe('其他请求的草稿');
    expect(m.stopGeneration).not.toHaveBeenCalled();
    expect(m.processingPlot).toBe(true);
  });

  it.each(['existing', 'pending'])('编排返回 busy 时不删除历史楼层或覆盖新草稿（%s）', async path => {
    m.shouldProcessPlot.mockReturnValue(true);
    const layer = { is_user: true, mes: '已有用户正文' };
    m.api.chat = [layer];
    m.input = path === 'pending' ? '待发送输入' : '';
    m.strategy1.mockImplementationOnce(async () => {
      m.input = '其他请求的草稿';
      return { action: 'busy' };
    });
    await expect(m.api.eventSource.emit('after_commands', 'normal', {}, false)).rejects.toMatchObject({ name: 'AbortError' });
    expect(m.api.chat).toEqual([layer]);
    expect(layer.mes).toBe('已有用户正文');
    expect(m.input).toBe('其他请求的草稿');
    expect(m.stopGeneration).not.toHaveBeenCalled();
    expect(m.generate).not.toHaveBeenCalled();
  });

  it.each(['stopped', 'chat_changed'])('失效旧回调不释放新一轮发送归属（%s）', async scenario => {
    vi.useFakeTimers();
    m.shouldProcessPlot.mockReturnValue(true);
    const finishes: Array<(result: any) => void> = [];
    m.strategy1.mockImplementation(() => new Promise(resolve => { finishes.push(resolve); }));
    m.input = '旧轮输入';
    const oldRequest = m.api.eventSource.emit('after_commands', 'normal', {}, false);
    const oldRedirected = expect(oldRequest).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(finishes).toHaveLength(1));
    const oldUser = m.api.chat[0];
    if (scenario === 'stopped') m.generationStopped!();
    else {
      // 宿主复用 chat 数组；身份与事件决定旧轮次已失效。
      m.api.chat.splice(0);
      m.api.chatId = 'chat-b';
      document.querySelector('#chat')?.replaceChildren();
      await m.chatChanged!('chat-b');
    }
    m.input = '新轮输入';
    const newRequest = m.api.eventSource.emit('after_commands', 'normal', {}, false);
    const newRedirected = expect(newRequest).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(finishes).toHaveLength(2));
    const newUser = m.api.chat[m.api.chat.length - 1];
    finishes[0]({ action: 'planned', finalMessage: '旧轮迟到结果' });
    await oldRedirected;
    expect(m.api.chat).not.toContain(oldUser);
    expect(m.api.chat).toContain(newUser);
    await expect(m.api.eventSource.emit('after_commands', 'normal', {}, false)).rejects.toMatchObject({ name: 'AbortError' });
    expect(m.strategy1).toHaveBeenCalledTimes(2);
    finishes[1]({ action: 'planned', finalMessage: '新轮提示词' });
    await newRedirected;
    await vi.advanceTimersByTimeAsync(0);
    expect(m.api.chat).toEqual([newUser]);
    expect(newUser.mes).toBe('新轮提示词');
    expect(document.querySelector('#chat .mes[mesid="0"] .mes_text')?.textContent).toBe('新轮提示词');
    expect(m.generate).toHaveBeenCalledExactlyOnceWith('regenerate');
    expect(m.stopGeneration).not.toHaveBeenCalled();
  });


});
