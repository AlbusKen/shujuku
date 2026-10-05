/**
 * tests/presentation/triggers/settings-ui-connect-materialization.test.ts
 * handleNewMessageDebounced_ACU 有界物化等待集成测试
 *
 * 核心回归场景（计划 T3.1）：GENERATION_ENDED 捕获时 chat 尾部是用户楼层，
 * 防抖回调执行后 AI 楼层才追加进 chat → 必须解析到 AI 并进入 update_only，
 * 而不是旧代码的 last_message_not_ai skip。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => {
  let chat: any[] = [];
  return {
    getChat: () => chat,
    setChat: (next: any[]) => { chat = next; },
    autoFillTimer: null as ReturnType<typeof setTimeout> | null,
    setAutoFillTimer: vi.fn(),
    loadAllChatMessages: vi.fn(),
    triggerAutomaticUpdateIfNeeded: vi.fn(),
    evaluateNewMessageAction: vi.fn(),
    resolveGeneratedAiMessageIndex: vi.fn(),
    logAutoFillSkip: vi.fn(),
    logDebug: vi.fn(),
    startRuntimePerformanceSpan: vi.fn(() => ({ id: 'span', end: vi.fn() })),
    maybeLiftWorldbookSuppression: vi.fn(),
  };
});

vi.mock('../../../src/service/runtime/state-manager', () => ({
  NEW_MESSAGE_DEBOUNCE_DELAY_ACU: 500,
  AI_MATERIALIZATION_MAX_RETRIES_ACU: 3,
  AI_MATERIALIZATION_RETRY_DELAY_MS_ACU: 100,
  allChatMessages_ACU: [],
  coreApisAreReady_ACU: true,
  currentChatFileIdentifier_ACU: 'chat-a',
  currentJsonTableData_ACU: null,
  settings_ACU: { contentOptimizationSettings: {} },
  isAutoUpdatingCard_ACU: false,
  wasStoppedByUser_ACU: false,
  getCurrentIsolationKey_ACU: () => '',
  _set_coreApisAreReady_ACU: vi.fn(),
  _set_lastTotalAiMessages_ACU: vi.fn(),
  _set_allChatMessages_ACU: vi.fn(),
  _set_currentChatFileIdentifier_AC: vi.fn(),
  _set_currentJsonTableData_ACU: vi.fn(),
  _set_independentTableStates_ACU: vi.fn(),
  _set_isProcessing_Plot_ACU: vi.fn(),
  _set_isAutoUpdatingCard_ACU: vi.fn(),
  _set_wasStoppedByUser_ACU: vi.fn(),
  _set_autoFillDebounceTimer_ACU: vi.fn(),
  _set_manualExtraHint_ACU: vi.fn(),
  generationGate_ACU: { lastGeneration: null },
}));

vi.mock('../../../src/service/chat/chat-service', () => ({
  getChatArray_ACU: () => m.getChat(),
  saveChatToHost_ACU: vi.fn(),
}));

vi.mock('../../../src/service/worldbook/pipeline', () => ({
  loadAllChatMessages_ACU: m.loadAllChatMessages,
}));

vi.mock('../../../src/service/runtime/message-handler', () => ({
  evaluateNewMessageAction_ACU: m.evaluateNewMessageAction,
  resolveGeneratedAiMessageIndex_ACU: m.resolveGeneratedAiMessageIndex,
}));

vi.mock('../../../src/presentation/triggers/settings-ui-sync/settings-ui-trigger', () => ({
  triggerAutomaticUpdateIfNeeded_ACU: m.triggerAutomaticUpdateIfNeeded,
}));

vi.mock('../../../src/shared/trigger-diagnostics', () => ({
  logAutoFillSkip_ACU: m.logAutoFillSkip,
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: m.logDebug,
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  isSummaryOrOutlineTable_ACU: vi.fn(),
  cleanChatName_ACU: vi.fn(),
  escapeHtml_ACU: vi.fn(),
}));

vi.mock('../../../src/shared/runtime-performance', () => ({
  startRuntimePerformanceSpan_ACU: m.startRuntimePerformanceSpan,
}));

vi.mock('../../../src/service/runtime/helpers-remaining', () => ({
  maybeLiftWorldbookSuppression_ACU: m.maybeLiftWorldbookSuppression,
}));

vi.mock('../../../src/presentation/components/plot-editors', () => ({
  get autoFillDebounceTimer_ACU() { return m.autoFillTimer; },
  _set_autoFillDebounceTimer_ACU: m.setAutoFillTimer,
  isAutoUpdatingCard_ACU: false,
  wasStoppedByUser_ACU: false,
  _set_wasStoppedByUser_ACU: vi.fn(),
  manualExtraHint_ACU: '',
  getCharCardPromptFromUI_ACU: vi.fn(),
  renderPromptSegments_ACU: vi.fn(),
}));

const user = { is_user: true, mes: '用户消息' };
const ai = { is_user: false, mes: '本轮 AI 回复', name: '角色A' };
const narrator = { is_user: false, mes: '系统旁白', extra: { type: 'narrator' } };

const baseIntent = {
  eventMessageId: 1,
  chatKey: 'chat-a',
  isolationKey: '',
  capturedAt: Date.now(),
  capturedChatLength: 2,
  capturedAiFloorCount: 0,
};

beforeEach(() => {
  vi.useFakeTimers();
  m.autoFillTimer = null;
  m.setAutoFillTimer.mockImplementation((timer) => { m.autoFillTimer = timer; });
  m.setChat([user, user]);
  m.loadAllChatMessages.mockResolvedValue(undefined);
  m.triggerAutomaticUpdateIfNeeded.mockResolvedValue(undefined);
  m.evaluateNewMessageAction.mockReturnValue({ action: 'update_only', reason: 'No content optimization configured', lastMessageIndex: 2 });
});

afterEach(() => {
  vi.clearAllTimers();
  m.autoFillTimer = null;
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('handleNewMessageDebounced_ACU 有界物化等待', () => {
  it('捕获时用户锚点、防抖后追加 AI → 解析唯一候选并触发 update', async () => {
    const { handleNewMessageDebounced_ACU } = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-connect');

    // 第一次解析：pending（AI 尚未物化）
    m.resolveGeneratedAiMessageIndex.mockReturnValueOnce({ kind: 'pending_materialization', candidates: [] });
    // 重试后：AI 已追加，解析成功
    m.resolveGeneratedAiMessageIndex.mockReturnValueOnce({ kind: 'resolved', messageIndex: 2 });

    // 触发防抖，执行回调时 chat 仍为 [user, user]，之后（重试间隙）追加 AI
    const promise = handleNewMessageDebounced_ACU('GENERATION_ENDED', { ...baseIntent });

    // 防抖 500ms
    await vi.advanceTimersByTimeAsync(500);
    // 第一次重试等待 100ms 前追加 AI 楼层
    m.setChat([user, user, ai]);
    await vi.advanceTimersByTimeAsync(100);

    await promise;

    expect(m.resolveGeneratedAiMessageIndex).toHaveBeenCalledTimes(2);
    expect(m.evaluateNewMessageAction).toHaveBeenCalledWith(
      [user, user, ai],
      false, true, false,
      {},
      2,
    );
    expect(m.triggerAutomaticUpdateIfNeeded).toHaveBeenCalledTimes(1);
    expect(m.logAutoFillSkip).not.toHaveBeenCalled();
  });

  it('重试超时仍未物化 → 记录专用原因，不触发更新', async () => {
    const { handleNewMessageDebounced_ACU } = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-connect');

    m.resolveGeneratedAiMessageIndex.mockReturnValue({ kind: 'pending_materialization', candidates: [] });

    const promise = handleNewMessageDebounced_ACU('GENERATION_ENDED', { ...baseIntent });
    await vi.advanceTimersByTimeAsync(500 + 3 * 100);
    await promise;

    expect(m.resolveGeneratedAiMessageIndex).toHaveBeenCalledTimes(4); // 1 次初始 + 3 次重试
    expect(m.logAutoFillSkip).toHaveBeenCalledWith(
      'generated_ai_message_not_materialized',
      expect.objectContaining({ eventMessageId: 1 }),
    );
    expect(m.evaluateNewMessageAction).not.toHaveBeenCalled();
    expect(m.triggerAutomaticUpdateIfNeeded).not.toHaveBeenCalled();
  });

  it('出现双 AI 候选 → ambiguous，fail loud，不触发更新', async () => {
    const { handleNewMessageDebounced_ACU } = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-connect');

    m.resolveGeneratedAiMessageIndex.mockReturnValue({ kind: 'ambiguous', candidates: [2, 3] });

    const promise = handleNewMessageDebounced_ACU('GENERATION_ENDED', { ...baseIntent });
    await vi.advanceTimersByTimeAsync(500);
    await promise;

    expect(m.logAutoFillSkip).toHaveBeenCalledWith(
      'ambiguous_generated_ai_message',
      expect.objectContaining({ candidateIndexes: [2, 3] }),
    );
    expect(m.evaluateNewMessageAction).not.toHaveBeenCalled();
  });

  it('结束、接收和渲染通知共用防抖，合并为一次按需检查', async () => {
    const { handleNewMessageDebounced_ACU } = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-connect');
    m.setChat([user, ai]);
    m.resolveGeneratedAiMessageIndex.mockReturnValue({ kind: 'resolved', messageIndex: 1 });
    m.evaluateNewMessageAction.mockReturnValue({ action: 'update_only', lastMessageIndex: 1 });
    const messageIntent = { ...baseIntent, eventMessageIdKind: 'index' as const, capturedAiFloorCount: 1 };

    await handleNewMessageDebounced_ACU('GENERATION_ENDED', { ...baseIntent, eventMessageId: 2 });
    await handleNewMessageDebounced_ACU('MESSAGE_RECEIVED', messageIntent);
    await vi.advanceTimersByTimeAsync(250);
    await handleNewMessageDebounced_ACU('CHARACTER_MESSAGE_RENDERED', messageIntent);
    await vi.advanceTimersByTimeAsync(499);
    expect(m.loadAllChatMessages).not.toHaveBeenCalled();
    expect(m.triggerAutomaticUpdateIfNeeded).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(m.loadAllChatMessages).toHaveBeenCalledTimes(1);
    expect(m.resolveGeneratedAiMessageIndex).toHaveBeenCalledExactlyOnceWith({ liveChat: [user, ai], intent: messageIntent });
    expect(m.evaluateNewMessageAction).toHaveBeenCalledTimes(1);
    expect(m.triggerAutomaticUpdateIfNeeded).toHaveBeenCalledTimes(1);
  });

  it('同楼层后续正文变化仍能再次唤醒，不被首次通知永久去重', async () => {
    const { handleNewMessageDebounced_ACU } = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-connect');
    m.setChat([user, ai]);
    m.resolveGeneratedAiMessageIndex.mockReturnValue({ kind: 'resolved', messageIndex: 1 });
    m.evaluateNewMessageAction.mockReturnValue({ action: 'update_only', lastMessageIndex: 1 });
    const messageIntent = { ...baseIntent, eventMessageIdKind: 'index' as const, capturedAiFloorCount: 1 };

    await handleNewMessageDebounced_ACU('MESSAGE_RECEIVED', messageIntent);
    await vi.advanceTimersByTimeAsync(500);
    expect(m.triggerAutomaticUpdateIfNeeded).toHaveBeenCalledTimes(1);

    m.setChat([user, { ...ai, mes: '续写后的正文' }]);
    await handleNewMessageDebounced_ACU('CHARACTER_MESSAGE_RENDERED', messageIntent);
    await vi.advanceTimersByTimeAsync(500);
    expect(m.triggerAutomaticUpdateIfNeeded).toHaveBeenCalledTimes(2);
    expect(m.evaluateNewMessageAction).toHaveBeenLastCalledWith(
      m.getChat(), false, true, false, {}, 1,
    );
  });

  it('防抖期间切聊天 → chat_changed，丢弃且不污染新会话', async () => {
    const { handleNewMessageDebounced_ACU } = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-connect');

    // 第一次解析 pending，等待中模拟切聊天（currentChatFileIdentifier_ACU 变化）
    m.resolveGeneratedAiMessageIndex.mockReturnValueOnce({ kind: 'pending_materialization', candidates: [] });

    const promise = handleNewMessageDebounced_ACU('GENERATION_ENDED', { ...baseIntent });
    await vi.advanceTimersByTimeAsync(500);

    // 修改 state-manager mock 的 currentChatFileIdentifier_ACU 需要重新 import，这里用 chatKey 不匹配验证
    // 直接模拟：重试前 chatKey 不匹配
    const stateManager = await import('../../../src/service/runtime/state-manager');
    (stateManager as any).currentChatFileIdentifier_ACU = 'chat-b';
    await vi.advanceTimersByTimeAsync(100);
    await promise;

    expect(m.logAutoFillSkip).toHaveBeenCalledWith(
      'chat_changed',
      expect.objectContaining({ chatKey: 'chat-a' }),
    );
    expect(m.evaluateNewMessageAction).not.toHaveBeenCalled();
  });
});
