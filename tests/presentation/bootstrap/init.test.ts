// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  chatChanged: undefined as undefined | ((name: string) => Promise<void>),
  chatMutationHandler: undefined as undefined | ((data: any) => Promise<void>),
  generationStarted: undefined as undefined | ((type: any, params: any, dryRun: any) => void),
  generationEnded: undefined as undefined | ((messageId: any) => void),
  generationStopped: undefined as undefined | (() => void),
  messageSent: undefined as undefined | ((messageId: any) => Promise<void>),
  messageReceived: undefined as undefined | ((messageId?: any, type?: any) => void),
  characterMessageRendered: undefined as undefined | ((messageId?: any, type?: any) => void),
  afterCommands: undefined as undefined | ((type: any, params: any, dryRun: any) => Promise<void>),
  currentChatKey: '',
  settings: { plotSettings: {} } as { plotSettings: Record<string, unknown>; worldSimulationPageEnabled?: boolean; plotSendDisguiseDisabled?: boolean },
  api: { chat: [] as any[], chatId: '', eventTypes: { CHAT_CHANGED: 'chat', MESSAGE_DELETED: 'deleted', MESSAGE_SWIPED: 'swiped', MESSAGE_SENT: 'message_sent', MESSAGE_UPDATED: 'message_updated', MESSAGE_RECEIVED: 'message_received', CHARACTER_MESSAGE_RENDERED: 'character_message_rendered', GENERATION_AFTER_COMMANDS: 'after_commands', GENERATION_STARTED: 'generation_started', GENERATION_ENDED: 'generation_ended', GENERATION_STOPPED: 'generation_stopped' }, eventSource: { on: vi.fn(), makeFirst: vi.fn(), makeLast: vi.fn(), emit: vi.fn() } } as any,
  gate: { lastUserMessageId: 7 as any, lastUserMessageText: 'stale', lastUserMessageAt: 1, lastUserSendIntentAt: 2, lastGeneration: { stale: true } as any, generationSeq: 0, activeGenerations: [] as any[] },
  resetTakeover: vi.fn(), dispose: vi.fn(), setData: vi.fn(), setTables: vi.fn(), setMessages: vi.fn(), setTotal: vi.fn(), setChat: vi.fn(),
  setChatMutationTimer: vi.fn(),
  notify: vi.fn(), resetScript: vi.fn(), loadPreset: vi.fn(), loadMessages: vi.fn(), refresh: vi.fn(),
  preload: vi.fn(), shouldRebuild: vi.fn(), rebuild: vi.fn(), restoreFlush: vi.fn(),
  // 切聊天向量预热门控：默认启用，保持既有 preload→rebuild/restore 编排语义。
  vectorPipelineEnabled: vi.fn(() => true),
  vectorPlan: null as any,
  processBeforeGen: vi.fn(),
  orchestrate: vi.fn(),
  strategy1: vi.fn(), strategy2: vi.fn(), shouldProcessPlot: vi.fn(),
  flushPlot: vi.fn(), saveChat: vi.fn(),
  persistedChat: [] as any[],
  ensureSeed: vi.fn(), processingPlot: false,
  hostEmit: vi.fn(), messageUpdated: vi.fn(),
  getInput: vi.fn(), setInput: vi.fn(),
  beginDisguise: vi.fn(), finishDisguise: vi.fn(), generate: vi.fn(),
  markIntercept: vi.fn(), skipIntercept: vi.fn(() => false), stopGeneration: vi.fn(),
  jquery: vi.fn(), clearPendingPlot: vi.fn(),
  input: '',
  shouldProcessSummary: vi.fn(),
  autoUpdate: vi.fn(async () => undefined),
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
    m.gate.lastGeneration = context;
    return context;
  }),
  consumeGeneration: vi.fn(() => m.gate.activeGenerations.pop() || null),
  isQuiet: vi.fn(() => false),
}));

vi.mock('../../../src/shared/host-api', () => ({ SillyTavern_API_ACU: m.api, jQuery_API_ACU: m.jquery }));
vi.mock('../../../src/shared/env', () => ({ topLevelWindow_ACU: { AutoCardUpdaterAPI: { _notifyTableUpdate: m.notify } } }));
vi.mock('../../../src/presentation/theme/toast', () => ({ showToastr_ACU: vi.fn() }));
vi.mock('../../../src/presentation/triggers/settings-ui-sync/settings-ui-connect', () => ({ attemptToLoadCoreApis_ACU: vi.fn(() => true), handleContentOptimizationEvent_ACU: (...args: any[]) => m.handleNewMessage(...args) }));
vi.mock('../../../src/presentation/triggers/settings-ui-sync/settings-ui-trigger', () => ({ triggerAutomaticUpdateIfNeeded_ACU: (...args: any[]) => m.autoUpdate(...args) }));
vi.mock('../../../src/service/runtime/helpers-remaining', () => ({ ensureInitialSeedCheckpoint_ACU: m.ensureSeed, handleChatCompletionReady_ACU: vi.fn(), loadPresetAndCleanCharacterData_ACU: m.loadPreset }));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  chatMutationDebounceTimer_ACU: null, _set_chatMutationDebounceTimer_ACU: m.setChatMutationTimer, _set_wasStoppedByUser_ACU: vi.fn(), generationGate_ACU: m.gate,
  get currentChatFileIdentifier_ACU() { return m.currentChatKey; }, currentJsonTableData_ACU: null, getCurrentIsolationKey_ACU: () => 'test-isolation', discardLatestGenerationContext_ACU: vi.fn(), markUserSendIntent_ACU: vi.fn(), get isProcessing_Plot_ACU() { return m.processingPlot; }, isQuietLikeGeneration_ACU: (...args: any[]) => m.isQuiet(...args), isRecentUserSendIntent_ACU: vi.fn(), loopState_ACU: { isLooping: false }, recordGenerationContext_ACU: (...args: any[]) => m.recordGeneration(...args), recordLastUserSend_ACU: vi.fn(), settings_ACU: m.settings, consumeGenerationContextForEnded_ACU: () => m.consumeGeneration(), shouldProcessPlotForGeneration_ACU: (...args: any[]) => m.shouldProcessPlot(...args), shouldProcessSummaryVectorIndexForGeneration_ACU: (...args: any[]) => m.shouldProcessSummary(...args),
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
vi.mock('../../../src/service/plot/plot-logic', () => ({ markPlotIntercept_ACU: m.markIntercept, shouldSkipPlotIntercept_ACU: m.skipIntercept }));
vi.mock('../../../src/service/plot/plot-orchestrator', () => ({ orchestrateTavernHelperHook_ACU: (...args: any[]) => m.orchestrate(...args), orchestrateAfterCommandsStrategy1_ACU: (...args: any[]) => m.strategy1(...args), orchestrateAfterCommandsStrategy2_ACU: (...args: any[]) => m.strategy2(...args) }));
vi.mock('../../../src/service/runtime/plot-runtime/plot-history-preset', () => ({ flushPlotPendingSave_ACU: (...args: any[]) => m.flushPlot(...args) }));
vi.mock('../../../src/shared/host-input', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/shared/host-input')>(),
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
vi.mock('../../../src/service/fill-mode/fill-mode-gate', () => ({ isVectorPipelineEnabledForCurrentChat_ACU: () => m.vectorPipelineEnabled(), getVectorPipelinePlanForCurrentChat_ACU: () => m.vectorPlan }));
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
  document.querySelector('#send_but')!.insertAdjacentHTML('afterend', '<button id="mes_stop" style="display: none"></button>');
  vi.spyOn(globalThis, 'setInterval').mockImplementation(() => 0 as any);
  // T5：TavernHelper.generate 钩子测试需要宿主 API 在 mainInitialize 前就绪，钩子才会被安装。
  (window as any).TavernHelper = { generate: vi.fn(async (...args: any[]) => ({ handled: true, args })) };
  m.api.eventTypes.USER_MESSAGE_RENDERED = 'user_message_rendered';
  m.api.eventTypes.WORLDINFO_ENTRIES_LOADED = 'worldinfo_entries_loaded';
  m.api.eventTypes.GENERATE_AFTER_DATA = 'generate_after_data';
  // 与宿主一致：原派发器吞掉监听器异常，阻断必须由外层派发返回边界完成。
  m.hostEmit.mockImplementation(async (event: string, ...args: any[]) => {
    if (event === 'after_commands') {
      try { await m.afterCommands!(args[0], args[1], args[2]); } catch { /* 宿主吞监听器异常 */ }
    } else if (event === 'message_sent') {
      await m.messageSent?.(args[0]);
    } else if (event === 'message_updated') {
      await m.messageUpdated(args[0]);
    } else if (event === 'generation_stopped') {
      m.generationStopped?.();
    } else if (event === 'chat') {
      await m.chatChanged?.(args[0]);
    }
  });
  m.api.eventSource.emit = m.hostEmit;
  m.api.eventSource.on.mockImplementation((event: string, callback: any) => {
    if (event === 'chat') m.chatChanged = callback;
    if (event === 'deleted' || event === 'swiped') m.chatMutationHandler = callback;
    if (event === 'generation_started') m.generationStarted = callback;
    if (event === 'message_sent') m.messageSent = callback;
    if (event === 'message_received') m.messageReceived = callback;
    if (event === 'character_message_rendered') m.characterMessageRendered = callback;
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
  delete document.body.dataset.generating;
  document.querySelector<HTMLElement>('#mes_stop')!.style.display = 'none';
  m.processingPlot = false;
  m.vectorPlan = null;
  m.skipIntercept.mockReturnValue(false);
  m.ensureSeed.mockResolvedValue(false);
  m.isQuiet.mockReturnValue(false);
  m.autoUpdate.mockResolvedValue(undefined);
  m.handleNewMessage.mockResolvedValue(undefined);
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
  m.generate.mockImplementation(async (type: string) => {
    await m.api.eventSource.emit('after_commands', type, {}, false);
    // 宿主 regenerate 在构造正文上下文前删除末尾非 user 消息。
    if (type === 'regenerate' && m.api.chat.length && !m.api.chat.at(-1).is_user) {
      const index = m.api.chat.length - 1;
      m.api.chat.pop();
      document.querySelector(`#chat .mes[mesid="${index}"]`)?.remove();
    }
  });
  m.jquery.mockImplementation((selector: string) => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
    return { ...nodes, length: nodes.length, remove: () => nodes.forEach(node => node.remove()) };
  });
  m.api.addOneMessage = vi.fn((message: any) => {
    const node = document.querySelector('#message_template .mes')!.cloneNode(true) as HTMLElement;
    node.setAttribute('mesid', String(m.api.chat.indexOf(message)));
    node.setAttribute('is_user', String(message.is_user));
    node.querySelector('.name_text')!.textContent = message.name;
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
    expect(m.autoUpdate).not.toHaveBeenCalled();
    expect(m.gate).toEqual({ lastUserMessageId: null, lastUserMessageText: '', lastUserMessageAt: 0, lastUserSendIntentAt: 0, lastGeneration: null, generationSeq: 0, activeGenerations: [] });
  });

  it('无效聊天名但仍有消息时不误清理运行时', async () => {
    m.api.chat = [
      { is_user: false, mes: '已有开场白' },
      { is_user: true, mes: '已有用户消息' },
      { is_user: false, mes: '已有回复' },
    ];
    await m.chatChanged!('');

    expect(m.resetTakeover).not.toHaveBeenCalled();
    expect(m.dispose).not.toHaveBeenCalled();
    expect(m.resetScript).toHaveBeenCalledWith('', { reason: 'chat_changed' });
    expect(m.loadPreset).toHaveBeenCalledOnce();
    expect(m.autoUpdate).not.toHaveBeenCalled();
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

describe('mainInitialize_ACU 正文消息事件自动填表接线', () => {
  it.each(['MESSAGE_RECEIVED', 'CHARACTER_MESSAGE_RENDERED'] as const)('%s 独立唤醒检查并传递明确消息下标', (eventName) => {
    m.currentChatKey = 'chat-a';
    m.api.chat = [{ is_user: true, mes: '用户' }, { is_user: false, mes: '正文' }];
    m.autoUpdate.mockResolvedValue(undefined);
    const callback = eventName === 'MESSAGE_RECEIVED' ? m.messageReceived : m.characterMessageRendered;

    expect(callback).toBeTypeOf('function');
    expect(callback!(1, 'normal')).toBeUndefined();

    expect(m.handleNewMessage).toHaveBeenCalledWith(eventName, expect.objectContaining({
      eventMessageId: 1, eventMessageIdKind: 'index', chatKey: 'chat-a',
      isolationKey: 'test-isolation', capturedChatLength: 2, capturedAiFloorCount: 1,
    }));
    expect(m.autoUpdate).toHaveBeenCalledExactlyOnceWith();
    expect(m.consumeGeneration).not.toHaveBeenCalled();
    expect(m.consumeInternalGeneration).not.toHaveBeenCalled();
    expect(m.consumeSimulationInternalGeneration).not.toHaveBeenCalled();
    expect(m.handleSimulationCompletion).not.toHaveBeenCalled();
  });

  it.each(['normal', 'swipe', 'appendFinal', 'continue', 'first_message', 'quiet'])('正文事件的 %s 类型只排除开场白自动填表，保留后续真实回复', (type) => {
    m.autoUpdate.mockResolvedValue(undefined);
    m.isQuiet.mockReturnValue(true);
    m.generationStarted!('normal', { quiet_prompt: '附加提示', automatic_trigger: true }, false);

    m.messageReceived!(0, type);
    m.characterMessageRendered!(0, type);

    expect(m.handleNewMessage).toHaveBeenCalledTimes(2);
    expect(m.autoUpdate).toHaveBeenCalledTimes(type === 'first_message' ? 0 : 2);
    expect(m.consumeGeneration).not.toHaveBeenCalled();

    if (type === 'first_message') {
      // 开场白过滤不建立冷却期，也不按下标永久禁用首条消息的真实续写。
      m.messageReceived!(0, 'continue');
      m.characterMessageRendered!(0, 'continue');
      expect(m.autoUpdate).toHaveBeenCalledTimes(2);
      expect(m.handleNewMessage).toHaveBeenCalledTimes(4);
      m.generationEnded!(1);
      expect(m.autoUpdate).toHaveBeenCalledTimes(3);
    }
  });

  it('无消息参数仍唤醒已有兼容检查，不增加拒绝条件', () => {
    m.messageReceived!();
    m.characterMessageRendered!('unknown');

    expect(m.handleNewMessage).toHaveBeenNthCalledWith(1, 'MESSAGE_RECEIVED', undefined);
    expect(m.handleNewMessage).toHaveBeenNthCalledWith(2, 'CHARACTER_MESSAGE_RENDERED', undefined);
  });
});

describe('mainInitialize_ACU continuation internal AI event isolation', () => {
  it('内部生成只隔离续写和优化，不阻断填表信号', () => {
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
    expect(m.autoUpdate).toHaveBeenCalledTimes(1);
    expect(m.handleNewMessage).not.toHaveBeenCalled();
  });
});

describe('mainInitialize_ACU world simulation generation isolation', () => {
  it('simulation 内部生成结束时仅短路推演和优化，仍派发填表', () => {
    m.consumeSimulationInternalGeneration.mockReturnValueOnce({ requestId: 'simulation-request', runId: 'run-a', role: 'world-director' });

    m.generationStarted!('normal', {}, false);
    m.generationEnded!(42);

    expect(m.bindSimulationInternalGeneration).toHaveBeenCalledWith(m.gate.generationSeq);
    expect(m.consumeSimulationInternalGeneration).toHaveBeenCalledWith(m.gate.generationSeq);
    expect(m.handleSimulationCompletion).not.toHaveBeenCalled();
    expect(m.autoUpdate).toHaveBeenCalledTimes(1);
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
    expect(m.autoUpdate).toHaveBeenCalledTimes(3);
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
    expect(m.autoUpdate).toHaveBeenCalledExactlyOnceWith();
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
  it('召回异常仍可发送，剧情失败或忙碌阻断正文', async () => {
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

    let hostCalls = hostGenerate.mock.calls.length;
    for (const action of ['passthrough', 'aborted']) {
      m.orchestrate.mockResolvedValueOnce({ action });
      await (window as any).TavernHelper.generate({ user_input: '继续发送的原文' });
      expect(hostGenerate).toHaveBeenCalledTimes(++hostCalls);
    }
    for (const result of [{ action: 'failed' }, { action: 'skipped' }, { action: 'loop_retry' }, { action: 'busy' },
      { action: 'failed', blocked: true }, { action: 'failed', apiRetriesExhausted: true }, { action: 'aborted', manual: true }]) {
      m.orchestrate.mockResolvedValueOnce(result);
      await (window as any).TavernHelper.generate({ user_input: '取消轮原文' });
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
  it.each([false, true])('发送等待与成功路径遵循伪装开关（解除伪装=%s）', async unmasked => {
    vi.useFakeTimers();
    m.shouldProcessPlot.mockReturnValue(true);
    m.shouldProcessSummary.mockReturnValue(true);
    m.settings.plotSendDisguiseDisabled = unmasked;
    const handoff = { resume: vi.fn(async (generate: () => Promise<unknown>) => { await generate(); }), cancel: vi.fn(async () => undefined) };
    const bridge = {
      prepareHostGenerationRedirect: vi.fn(async () => handoff),
      onGenerationStarted: vi.fn(() => true),
    };
    m.continuationBridge = bridge;
    m.generationStarted!('normal', {}, false);
    const sourceSequence = m.gate.generationSeq;
    const pendingUi = await vi.importActual<typeof import('../../../src/presentation/components/plot-pending-disguise')>('../../../src/presentation/components/plot-pending-disguise');
    m.beginDisguise.mockImplementation(pendingUi.beginPlotPendingDisguise_ACU);
    const previous = { is_user: false, mes: '历史回复' };
    m.api.chat = [previous];
    m.input = '本轮原输入';
    let complete!: (result: any) => void;
    let started!: () => void;
    const planningStarted = new Promise<void>(resolve => { started = resolve; });
    (unmasked ? m.strategy2 : m.strategy1).mockImplementationOnce(() => {
      started();
      return new Promise(resolve => { complete = resolve; });
    });
    let savedChat: any[] = [];
    m.saveChat.mockImplementation(async () => {
      savedChat = JSON.parse(JSON.stringify(m.api.chat));
      m.persistedChat = savedChat;
    });
    const params: any = {};
    const request = m.api.eventSource.emit('after_commands', 'normal', params, false);
    const redirected = unmasked ? expect(request).resolves.toBeUndefined()
      : expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await planningStarted;
    if (unmasked) {
      expect(m.input).toBe('本轮原输入');
      expect(m.api.chat).toEqual([previous]);
      expect(m.api.addOneMessage).not.toHaveBeenCalled();
      expect(m.beginDisguise).not.toHaveBeenCalled();
      expect(document.body.dataset.generating).toBeUndefined();
      expect(document.querySelector<HTMLElement>('#mes_stop')!.style.display).toBe('none');
      expect(m.saveChat).not.toHaveBeenCalled();
      expect(m.generate).not.toHaveBeenCalled();
      complete({ action: 'planned', finalMessage: '最终剧情正文' });
      await redirected;
      expect(params.prompt).toBe('最终剧情正文');
      expect(m.input).toBe('最终剧情正文');
      expect(m.api.chat).toEqual([previous]);
      expect(m.strategy1).not.toHaveBeenCalled();
      expect(m.strategy2).toHaveBeenCalledOnce();
      expect(m.processBeforeGen).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(0);
      expect(m.generate).not.toHaveBeenCalled();
      expect(bridge.prepareHostGenerationRedirect).not.toHaveBeenCalled();
      expect(handoff.resume).not.toHaveBeenCalled();
      return;
    }
    const user = m.api.chat[1];
    expect(bridge.prepareHostGenerationRedirect).toHaveBeenCalledExactlyOnceWith(sourceSequence);
    expect(bridge.prepareHostGenerationRedirect).toHaveBeenCalledBefore(m.strategy1 as any);
    const node = document.querySelector('#chat .mes[mesid="1"]');
    expect(user).toMatchObject({ is_user: true, mes: '本轮原输入' });
    expect(m.api.chat).toHaveLength(3);
    expect(m.api.chat[2]).toMatchObject({ is_user: false, mes: '', _qrf_plot_pending_placeholder: true });
    expect(m.api.addOneMessage).toHaveBeenCalledTimes(2);
    expect(m.saveChat).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(m.generate).not.toHaveBeenCalled();
    expect(document.body.dataset.generating).toBe('true');
    expect(document.querySelector<HTMLElement>('#mes_stop')!.style.display).toBe('flex');
    expect(m.hostEmit).not.toHaveBeenCalledWith('generation_ended', expect.anything());
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
    expect(node?.querySelector('.mes_text')?.textContent).toBe('最终剧情正文');
    expect(m.generate).not.toHaveBeenCalled();
    completeRender();
    await redirected;
    expect(m.api.chat[1]).toBe(user);
    expect(document.querySelector('#chat .mes[mesid="1"]')).toBe(node);
    expect(node?.querySelector('.mes_text')?.textContent).toBe('最终剧情正文');
    expect(savedChat[1]).toMatchObject({ mes: '最终剧情正文', qrf_plot: '完整剧情反馈', qrf_plot_tasks: { task: '任务反馈' } });
    expect(savedChat[0]).toEqual(previous);
    expect(m.generate).not.toHaveBeenCalled();
    expect(document.body.dataset.generating).toBeUndefined();
    expect(document.querySelector<HTMLElement>('#mes_stop')!.style.display).toBe('none');
    expect(m.hostEmit).not.toHaveBeenCalledWith('generation_ended', expect.anything());
    await vi.advanceTimersByTimeAsync(0);
    expect(m.generate).toHaveBeenCalledExactlyOnceWith('regenerate');
    expect(handoff.resume).toHaveBeenCalledOnce();
    expect(handoff.cancel).not.toHaveBeenCalled();
    expect(document.querySelector('#chat .acu-plot-pending-mes')).toBeNull();
    expect(m.input).toBe('下一轮草稿');
    expect(m.setInput).not.toHaveBeenCalledWith('最终剧情正文');
    await m.api.eventSource.emit('after_commands', 'regenerate', {}, false);
    expect(m.strategy1).toHaveBeenCalledOnce();
    expect(m.processBeforeGen).toHaveBeenCalledOnce();
  });

  it.each([false, true])('任务失败或手动终止恢复原输入，保存失败继续（解除伪装=%s）', async unmasked => {
    vi.useFakeTimers();
    m.shouldProcessPlot.mockReturnValue(true);
    m.settings.plotSendDisguiseDisabled = unmasked;
    const handoff = { resume: vi.fn(async (generate: () => Promise<unknown>) => { await generate(); }), cancel: vi.fn(async () => undefined) };
    const bridge = { prepareHostGenerationRedirect: vi.fn(async () => handoff), onGenerationStarted: vi.fn(() => true) };
    m.continuationBridge = bridge;
    m.generationStarted!('normal', {}, false);
    const pendingUi = await vi.importActual<typeof import('../../../src/presentation/components/plot-pending-disguise')>('../../../src/presentation/components/plot-pending-disguise');
    m.beginDisguise.mockImplementation(pendingUi.beginPlotPendingDisguise_ACU);
    const previous = { is_user: false, mes: '历史回复' };
    m.api.chat = [previous];
    const stopResults = [{ action: 'failed', apiRetriesExhausted: true }, { action: 'failed', blocked: true }, { action: 'aborted', manual: true }];
    for (const result of stopResults) {
      m.input = '失败轮原输入';
      (unmasked ? m.strategy2 : m.strategy1).mockResolvedValueOnce(result);
      await expect(m.api.eventSource.emit('after_commands', 'normal', {}, false)).rejects.toMatchObject({ name: 'AbortError' });
      expect(m.api.chat).toEqual([previous]);
      expect(document.querySelector('#chat .mes[mesid="1"]')).toBeNull();
      expect(document.querySelector('#chat .acu-plot-pending-mes')).toBeNull();
      expect(document.body.dataset.generating).toBeUndefined();
      expect(document.querySelector<HTMLElement>('#mes_stop')!.style.display).toBe('none');
      expect(m.input).toBe('失败轮原输入');
    }
    m.input = '任务后保存失败原输入';
    expect(handoff.cancel).toHaveBeenCalledTimes(unmasked ? 0 : stopResults.length);
    expect(handoff.resume).not.toHaveBeenCalled();
    if (unmasked) {
      expect(m.api.addOneMessage).not.toHaveBeenCalled();
      expect(m.beginDisguise).not.toHaveBeenCalled();
      expect(m.saveChat).not.toHaveBeenCalled();
      expect(m.strategy2).toHaveBeenCalledTimes(stopResults.length);
      expect(m.generate).not.toHaveBeenCalled();
      return;
    }
    m.strategy1.mockResolvedValueOnce({ action: 'planned', finalMessage: '任务已完成的提示词' });
    m.saveChat.mockRejectedValueOnce(new Error('保存失败'));
    await expect(m.api.eventSource.emit('after_commands', 'normal', {}, false)).rejects.toMatchObject({ name: 'AbortError' });
    expect(m.strategy1).toHaveBeenCalledTimes(stopResults.length + 1);
    expect(m.api.chat[0]).toBe(previous);
    expect(m.api.chat[1].mes).toBe('任务已完成的提示词');
    expect(m.api.chat).toHaveLength(3);
    expect(m.input).toBe('');
    expect(document.body.dataset.generating).toBeUndefined();
    expect(document.querySelector<HTMLElement>('#mes_stop')!.style.display).toBe('none');
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(m.generate).toHaveBeenCalledExactlyOnceWith('regenerate');
    expect(handoff.resume).toHaveBeenCalledOnce();
    expect(handoff.cancel).toHaveBeenCalledTimes(stopResults.length);
    expect(m.api.chat).toHaveLength(2);
  });

  it('仅交火召回保留原伪装楼层流程，召回失败仍继续正文', async () => {
    vi.useFakeTimers();
    m.shouldProcessSummary.mockReturnValue(true);
    const pendingUi = await vi.importActual<typeof import('../../../src/presentation/components/plot-pending-disguise')>('../../../src/presentation/components/plot-pending-disguise');
    m.beginDisguise.mockImplementation(pendingUi.beginPlotPendingDisguise_ACU);
    m.input = '召回原输入';
    await expect(m.api.eventSource.emit('after_commands', 'normal', {}, false)).rejects.toMatchObject({ name: 'AbortError' });
    expect(m.api.chat).toHaveLength(2);
    expect(m.api.chat[1]).toMatchObject({ is_user: false, _qrf_plot_pending_placeholder: true });
    expect(document.querySelector('#chat .acu-plot-pending-mes')).not.toBeNull();
    expect(m.api.chat[0].mes).toBe('召回原输入');
    expect(m.input).toBe('');
    expect(m.strategy1).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(m.generate).toHaveBeenCalledExactlyOnceWith('regenerate');
    expect(m.api.chat).toHaveLength(1);
    m.input = '失败召回原输入';
    m.processBeforeGen.mockResolvedValueOnce({ success: false, reason: 'request_failed' });
    await expect(m.api.eventSource.emit('after_commands', 'normal', {}, false)).rejects.toMatchObject({ name: 'AbortError' });
    expect(m.api.chat).toHaveLength(3);
    expect(m.api.chat[1].mes).toBe('失败召回原输入');
    expect(m.input).toBe('');
    await vi.advanceTimersByTimeAsync(0);
    expect(m.generate).toHaveBeenCalledTimes(2);
    expect(m.api.chat).toHaveLength(2);
  });

  it('召回后返回 busy 只清理本次临时楼层，保留其他规划与新草稿且不续发', async () => {
    vi.useFakeTimers();
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
    expect(m.api.chat).toHaveLength(2);
    m.processingPlot = true;
    m.input = '其他请求的草稿';
    m.strategy1.mockResolvedValueOnce({ action: 'busy' });
    complete({ success: true });
    await redirected;
    expect(consume).not.toHaveBeenCalled();
    expect(m.api.chat).toHaveLength(0);
    expect(m.input).toBe('其他请求的草稿');
    expect(m.stopGeneration).not.toHaveBeenCalled();
    expect(m.processingPlot).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(m.generate).not.toHaveBeenCalled();
  });

  it.each(['existing', 'pending'])('无需规划继续，忙碌与失败退出不续发且保留既有楼层和新草稿（%s）', async path => {
    vi.useFakeTimers();
    m.shouldProcessPlot.mockReturnValue(true);
    const layer = { is_user: true, mes: '已有用户正文' };
    m.api.chat = [layer];
    m.input = path === 'pending' ? '待发送输入' : '';
    for (const action of ['busy', 'no_match', 'skipped', 'loop_retry', 'failed']) {
      m.input = path === 'pending' ? '待发送输入' : '';
      m.strategy1.mockImplementationOnce(async () => {
        m.input = '其他请求的草稿';
        return { action };
      });
      const userCount = m.api.chat.length;
      await expect(m.api.eventSource.emit('after_commands', 'normal', {}, false)).rejects.toMatchObject({ name: 'AbortError' });
      expect(m.api.chat[0]).toBe(layer);
      expect(m.api.chat).toHaveLength(userCount + (action === 'no_match' ? (path === 'pending' ? 2 : 1) : 0));
      expect(layer.mes).toBe('已有用户正文');
      expect(m.input).toBe('其他请求的草稿');
      expect(m.stopGeneration).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(m.generate).toHaveBeenCalledTimes(1);
  });



});

describe('向量模式宿主普通发送', () => {
  beforeEach(() => {
    m.vectorPlan = { kind: 'vector' };
    m.shouldProcessSummary.mockReturnValue(true);
    m.shouldProcessPlot.mockReturnValue(true);
  });

  async function hostSend(consume: () => void, params: any = {}, lores = { globalLore: [] as any[], characterLore: [] as any[], chatLore: [] as any[], personaLore: [] as any[] }) {
    await m.api.eventSource.emit('after_commands', 'normal', params, false);
    const text = m.input;
    m.input = '';
    if (text) {
      const message = { is_user: true, mes: text, name: '用户' };
      m.api.chat.push(message);
      await m.saveChat();
      const index = m.api.chat.length - 1;
      await m.api.eventSource.emit('message_sent', index);
      m.api.addOneMessage(message);
      await m.api.eventSource.emit('user_message_rendered', index);
    }
    // 世界书加载层会吞掉异常，正文请求边界仍必须阻断取消。
    try { await m.api.eventSource.emit('worldinfo_entries_loaded', lores); } catch { /* 宿主返回空世界书 */ }
    await m.api.eventSource.emit('generate_after_data', {}, false);
    consume();
  }

  function holdRecall() {
    let complete!: (result: any) => void;
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    m.processBeforeGen.mockImplementationOnce(() => {
      started();
      return new Promise(resolve => { complete = resolve; });
    });
    return { ready, complete: (result: any) => complete(result) };
  }

  it.each([false, true])('宿主保存唯一用户楼后等待召回，不发送等待中新草稿（解除伪装=%s）', async unmasked => {
    m.settings.plotSendDisguiseDisabled = unmasked;
    m.api.chat = [{ is_user: false, mes: '历史回复' }];
    m.input = '本轮输入';
    const recall = holdRecall();
    const consume = vi.fn();
    const request = hostSend(consume);
    await recall.ready;
    expect(m.persistedChat).toEqual([{ is_user: false, mes: '历史回复' }, { is_user: true, mes: '本轮输入', name: '用户' }]);
    expect(m.api.chat).toHaveLength(2);
    expect(m.api.addOneMessage).toHaveBeenCalledOnce();
    expect(m.beginDisguise).not.toHaveBeenCalled();
    expect(m.setInput).not.toHaveBeenCalled();
    expect(m.processBeforeGen.mock.calls[0][0]).toMatchObject({ userInput: '本轮输入', source: 'user_message_rendered' });
    expect(document.body.dataset.generating).toBe('true');
    expect(document.querySelector<HTMLElement>('#mes_stop')!.style.display).toBe('flex');
    expect(consume).not.toHaveBeenCalled();
    m.input = '下一轮草稿';
    recall.complete({ success: true, injectedCount: 2 });
    await request;
    expect(consume).toHaveBeenCalledOnce();
    expect(m.input).toBe('下一轮草稿');
    expect(m.api.chat).toHaveLength(2);
    expect(m.generate).not.toHaveBeenCalled();
    expect(m.strategy1).not.toHaveBeenCalled();
    expect(m.strategy2).not.toHaveBeenCalled();
    expect(m.hostEmit).not.toHaveBeenCalledWith('deleted', expect.anything());
    expect(document.body.dataset.generating).toBeUndefined();
    expect(document.querySelector<HTMLElement>('#mes_stop')!.style.display).toBe('none');
  });

  it.each([
    ['new', 'failure'], ['new', 'exception'], ['existing', 'failure'], ['existing', 'exception'],
  ])('%s 用户楼召回%s时报错并停止正文，保留楼层与新草稿', async (path, outcome) => {
    const user = { is_user: true, mes: '已有用户正文' };
    m.api.chat = path === 'existing' ? [user] : [];
    m.input = path === 'existing' ? '' : '失败时也保存';
    if (path === 'existing') await m.saveChat();
    m.processBeforeGen.mockImplementationOnce(async () => {
      m.input = '下一轮草稿';
      if (outcome === 'exception') throw new Error('召回失败');
      return { success: false, reason: 'embedding_failed' };
    });
    const consume = vi.fn();
    await expect(hostSend(consume)).rejects.toMatchObject({ name: 'AbortError' });
    expect(consume).not.toHaveBeenCalled();
    expect(m.persistedChat).toEqual(path === 'existing' ? [user] : [{ is_user: true, mes: '失败时也保存', name: '用户' }]);
    expect(m.api.chat).toEqual(m.persistedChat);
    expect(m.input).toBe('下一轮草稿');
    expect(m.processBeforeGen.mock.calls[0][0].signal.aborted).toBe(true);
    const { showToastr_ACU } = await import('../../../src/presentation/theme/toast');
    expect(showToastr_ACU).toHaveBeenCalledWith('error', '纪要召回失败，本次生成已停止。', '向量表格');
    expect(m.generate).not.toHaveBeenCalled();
    expect(m.beginDisguise).not.toHaveBeenCalled();
    expect(m.hostEmit).not.toHaveBeenCalledWith('deleted', expect.anything());
    expect(document.body.dataset.generating).toBeUndefined();
    expect(document.querySelector<HTMLElement>('#mes_stop')!.style.display).toBe('none');
  });

  it.each(['stop', 'signal', 'chat'])('召回等待中%s立即阻断正文，迟到结果不能续发', async cause => {
    m.input = '停止轮';
    const recall = holdRecall();
    const consume = vi.fn();
    const controller = new AbortController();
    const request = hostSend(consume, { signal: controller.signal });
    const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await recall.ready;
    const options = m.processBeforeGen.mock.calls[0][0];
    m.input = '保留草稿';
    if (cause === 'stop') await m.api.eventSource.emit('generation_stopped');
    else if (cause === 'signal') controller.abort();
    else {
      m.api.chat = [{ is_user: false, mes: '新聊天' }];
      await m.api.eventSource.emit('chat', 'chat-b');
    }
    await rejected;
    expect(options.signal.aborted).toBe(true);
    expect(() => options.assertActive()).toThrow();
    recall.complete({ success: true, injectedCount: 4 });
    await Promise.resolve();
    expect(consume).not.toHaveBeenCalled();
    expect(m.generate).not.toHaveBeenCalled();
    expect(m.input).toBe('保留草稿');
    expect(document.body.dataset.generating).toBeUndefined();
    expect(document.querySelector<HTMLElement>('#mes_stop')!.style.display).toBe('none');
  });

  it('已有用户楼在输入消费后召回，草稿保留且本轮蓝灯按世界书和 uid 同步', async () => {
    const user = { is_user: true, mes: '已有用户正文' };
    m.api.chat = [user];
    const lores = {
      globalLore: [{ world: 'book', uid: 1, constant: false }, { world: 'other', uid: 1, constant: false }],
      characterLore: [{ world: 'book', uid: 2, constant: true }, { world: 'book', uid: 3, constant: true }],
      chatLore: [] as any[], personaLore: [] as any[],
    };
    const recall = holdRecall();
    const consume = vi.fn();
    const request = hostSend(consume, {}, lores);
    await recall.ready;
    const options = m.processBeforeGen.mock.calls[0][0];
    expect(options).toMatchObject({ userInput: '已有用户正文', source: 'worldinfo_entries_loaded' });
    expect(m.input).toBe('');
    m.input = '召回期间的新草稿';
    options.onVectorTableEntriesApplied('book', [{ uid: 1, type: 'constant' }, { uid: 2, type: 'keyword' }]);
    recall.complete({ success: true, injectedCount: 1 });
    await request;
    expect(consume).toHaveBeenCalledOnce();
    expect(m.api.chat).toEqual([user]);
    expect(m.api.addOneMessage).not.toHaveBeenCalled();
    expect(m.generate).not.toHaveBeenCalled();
    expect(m.setInput).not.toHaveBeenCalled();
    expect(m.input).toBe('召回期间的新草稿');
    expect(lores.globalLore.map(entry => entry.constant)).toEqual([true, false]);
    expect(lores.characterLore.map(entry => entry.constant)).toEqual([false, true]);
  });

  it.each(['stop', 'signal', 'chat'])('召回结束到正文请求之间的 %s 仍阻断正文', async cause => {
    const controller = new AbortController();
    m.api.chat = [{ is_user: true, mes: '已有正文' }];
    await m.api.eventSource.emit('after_commands', 'normal', { signal: controller.signal }, false);
    // 与宿主一致，先读取并清空输入框，再加载世界书。
    m.input = '';
    await m.api.eventSource.emit('worldinfo_entries_loaded', { globalLore: [], characterLore: [], chatLore: [], personaLore: [] });
    expect(m.processBeforeGen).toHaveBeenCalledOnce();
    m.input = '正文装配期间草稿';
    if (cause === 'stop') await m.api.eventSource.emit('generation_stopped');
    else if (cause === 'signal') controller.abort();
    else {
      m.api.chat = [{ is_user: false, mes: '新聊天' }];
      await m.api.eventSource.emit('chat', 'chat-b');
    }
    const consume = vi.fn();
    const request = (async () => {
      await m.api.eventSource.emit('generate_after_data', {}, false);
      consume();
    })();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(consume).not.toHaveBeenCalled();
    expect(m.input).toBe('正文装配期间草稿');
    expect(m.generate).not.toHaveBeenCalled();
  });

  it('已有用户楼复用原楼，停止仍在外层阻断', async () => {
    const user = { is_user: true, mes: '已有用户楼' };
    m.api.chat = [user];
    const recall = holdRecall();
    const consume = vi.fn();
    const request = hostSend(consume);
    const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await recall.ready;
    await m.api.eventSource.emit('generation_stopped');
    await rejected;
    recall.complete({ success: true });
    expect(m.api.chat).toEqual([user]);
    expect(m.api.addOneMessage).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
  });
  it('用户入楼前停止仍阻断迟到入楼，并允许下一次普通发送', async () => {
    m.input = '入楼前停止';
    await m.api.eventSource.emit('after_commands', 'normal', {}, false);
    expect(m.processBeforeGen).not.toHaveBeenCalled();
    await m.api.eventSource.emit('generation_stopped');
    const user = { is_user: true, mes: '入楼前停止' };
    m.api.chat.push(user);
    await expect(m.api.eventSource.emit('user_message_rendered', 0)).rejects.toMatchObject({ name: 'AbortError' });
    expect(m.processBeforeGen).not.toHaveBeenCalled();
    m.input = '重试输入';
    const consume = vi.fn();
    await hostSend(consume);
    expect(consume).toHaveBeenCalledOnce();
    expect(m.processBeforeGen).toHaveBeenCalledOnce();
    expect(m.api.chat[0]).toBe(user);
    expect(m.api.chat).toHaveLength(2);
  });

  it('入楼前停止且宿主不再派发入楼事件，下一次发送不被旧租约卡住', async () => {
    m.input = '未入楼';
    await m.api.eventSource.emit('after_commands', 'normal', {}, false);
    await m.api.eventSource.emit('generation_stopped');
    expect(document.body.dataset.generating).toBeUndefined();
    m.input = '新的发送';
    const consume = vi.fn();
    await hostSend(consume);
    expect(consume).toHaveBeenCalledOnce();
    expect(m.persistedChat).toEqual([{ is_user: true, mes: '新的发送', name: '用户' }]);
    expect(m.generate).not.toHaveBeenCalled();
  });

  it('召回结果刚返回时停止仍阻断本轮正文', async () => {
    m.input = '完成交界停止';
    const recall = holdRecall();
    const consume = vi.fn();
    const request = hostSend(consume);
    const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await recall.ready;
    recall.complete({ success: true });
    await m.api.eventSource.emit('generation_stopped');
    await rejected;
    expect(consume).not.toHaveBeenCalled();
    expect(m.api.chat).toHaveLength(1);
  });

});
