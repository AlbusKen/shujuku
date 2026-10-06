import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  wasStopped: false,
  chatKey: 'chat-a',
  isolationKey: 'isolation-a',
  executePlan: vi.fn(),
  logSkip: vi.fn(),
  sqlite: true,
  showToast: vi.fn(),
  beginTask: vi.fn(),
  updateTask: vi.fn(),
  endTask: vi.fn(),
  grouped: vi.fn(),
  staging: vi.fn(),
  abortRequests: vi.fn(),
  buildPlan: vi.fn(() => ({ tablesToUpdate: [{ sheetKey: 'sheet_0' }], updateGroups: { group_1: {} } })),
  getChat: vi.fn(() => [{ is_user: true }, { is_user: false }]),
  preCheck: null as { canProceed: boolean; reason?: string; code?: string } | null,
}));

vi.mock('../../../src/presentation/components/plot-editors', () => ({
  getCharCardPromptFromUI_ACU: vi.fn(), isAutoUpdatingCard_ACU: false,
  renderPromptSegments_ACU: vi.fn(), get wasStoppedByUser_ACU() { return m.wasStopped; },
  _set_isAutoUpdatingCard_ACU: vi.fn(),
}));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  NEW_MESSAGE_DEBOUNCE_DELAY_ACU: 500, abortAllActiveRequests_ACU: m.abortRequests,
  allChatMessages_ACU: [], coreApisAreReady_ACU: true,
  get currentChatFileIdentifier_ACU() { return m.chatKey; },
  currentJsonTableData_ACU: { sheet_0: {} }, getCurrentIsolationKey_ACU: vi.fn(() => m.isolationKey),
  lastTotalAiMessages_ACU: 1, settings_ACU: { autoUpdateEnabled: true, maxConcurrentGroups: 1, silentModeEnabled: true },
  _set_coreApisAreReady_ACU: vi.fn(), _set_lastTotalAiMessages_ACU: vi.fn(),
  _set_manualExtraHint_ACU: vi.fn(), _set_wasStoppedByUser_ACU: vi.fn(),
}));
vi.mock('../../../src/service/table/update-scheduler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/service/table/update-scheduler')>();
  return {
  ...actual,
  checkAutoUpdatePreConditions_ACU: vi.fn((...args: Parameters<typeof actual.checkAutoUpdatePreConditions_ACU>) => m.preCheck ?? actual.checkAutoUpdatePreConditions_ACU(...args)),

  buildAutoUpdatePlan_ACU: (...args: any[]) => m.buildPlan(...args),
  executeAutoUpdatePlan_ACU: (...args: any[]) => m.executePlan(...args),
  };
});
vi.mock('../../../src/service/chat/chat-service', () => ({ getChatArray_ACU: (...args: any[]) => m.getChat(...args), saveChatToHost_ACU: vi.fn() }));
vi.mock('../../../src/shared/runtime-performance', () => ({ startRuntimePerformanceSpan_ACU: vi.fn(() => ({ id: 'span', end: vi.fn() })) }));
vi.mock('../../../src/shared/trigger-diagnostics', () => ({
  logAutoFillSkip_ACU: (...args: any[]) => m.logSkip(...args),
  logAutoFillStage_ACU: vi.fn(),
}));
vi.mock('../../../src/service/template/chat-scope', () => ({ getSortedSheetKeys_ACU: vi.fn(() => ['sheet_0']) }));
vi.mock('../../../src/service/table/storage-mode', () => ({ isSqliteMode: () => m.sqlite }));
vi.mock('../../../src/presentation/theme/toast', () => ({ showToastr_ACU: m.showToast }));
vi.mock('../../../src/shared/notice-hub', () => ({ beginNoticeTask_ACU: m.beginTask }));
vi.mock('../../../src/presentation/components/status-display', () => ({
  syncManualUpdateButtonAvailability_ACU: vi.fn(),
}));
vi.mock('../../../src/presentation/components/update-status-display', () => ({ updateCardUpdateStatusDisplay_ACU: vi.fn() }));
vi.mock('../../../src/shared/utils', () => ({ logDebug_ACU: vi.fn(), logError_ACU: vi.fn(), logWarn_ACU: vi.fn(), isSummaryOrOutlineTable_ACU: vi.fn() }));
vi.mock('../../../src/service/worldbook/pipeline', () => ({ loadAllChatMessages_ACU: vi.fn(), updateReadableLorebookEntry_ACU: vi.fn() }));
vi.mock('../../../src/service/table/table-storage-strategy', () => ({ getStorageProvider: vi.fn(() => ({ getCurrentData: vi.fn() })) }));
vi.mock('../../../src/shared/env', () => ({ topLevelWindow_ACU: {} }));
vi.mock('../../../src/presentation/triggers/settings-ui-sync/settings-ui-config', () => ({ purgeOldLayerData_ACU: vi.fn() }));
vi.mock('../../../src/service/table/update-orchestrator', () => ({
  processGroupedRuntimeChunk_ACU: m.grouped,
  executeAutoFillStagingGroups_ACU: m.staging,
}));

async function settleMicrotasks() { await Promise.resolve(); await Promise.resolve(); }

describe('triggerAutomaticUpdateIfNeeded_ACU 逐次串行调度', () => {
  beforeEach(() => {
    m.wasStopped = false;
    m.chatKey = 'chat-a';
    m.isolationKey = '';
    m.sqlite = true;
    m.showToast.mockReset();
    m.updateTask.mockReset();
    m.endTask.mockReset();
    m.beginTask.mockReset().mockReturnValue({ update: m.updateTask, end: m.endTask });
    m.grouped.mockReset();
    m.staging.mockReset();
    m.abortRequests.mockReset();
    m.executePlan.mockReset();
    m.logSkip.mockReset();
    m.buildPlan.mockReset();
    m.getChat.mockReset();
    m.getChat.mockReturnValue([{ is_user: true }, { is_user: false }]);
    m.preCheck = null;
  });

  it('自动开关关闭时记录原因且不执行填表', async () => {
    m.preCheck = { canProceed: false, reason: 'Auto update is disabled via settings.', code: 'auto_update_disabled' };
    const { triggerAutomaticUpdateIfNeeded_ACU } = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-trigger');
    await triggerAutomaticUpdateIfNeeded_ACU();
    await settleMicrotasks();
    expect(m.logSkip).toHaveBeenCalledWith('preconditions_failed', expect.objectContaining({
      preconditionReason: 'auto_update_disabled',
    }));
    // fail-closed：前置检查失败时只记录一次 skip，不构建也不执行更新计划。
    expect(m.logSkip).toHaveBeenCalledTimes(1);
    expect(m.buildPlan).not.toHaveBeenCalled();
    expect(m.executePlan).not.toHaveBeenCalled();
  });

  it('使用实时聊天调度，无实际请求时静默，普通与跨边界填表首次调用才显示进度', async () => {
    const chat = [{ is_user: false }];
    m.getChat.mockReturnValue(chat);
    m.sqlite = false;
    m.executePlan.mockResolvedValue({ failedGroups: 0, errors: [], autoMergeTriggered: false, autoMergeSuccess: false });
    const { triggerAutomaticUpdateIfNeeded_ACU } = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-trigger');

    await triggerAutomaticUpdateIfNeeded_ACU();
    expect(m.beginTask).not.toHaveBeenCalled();
    expect(m.showToast).not.toHaveBeenCalled();

    for (const staging of [false, true]) {
      m.sqlite = staging;
      const taskCount = m.beginTask.mock.calls.length;
      const runner = staging ? m.staging : m.grouped;
      runner.mockImplementationOnce(async (_groups, _mode, options) => {
        options.onProgress({ phase: 'preparing' });
        expect(m.beginTask).toHaveBeenCalledTimes(taskCount);
        options.onProgress({ phase: 'calling_ai', attempt: 1, maxRetries: 1 });
        expect(m.beginTask).toHaveBeenCalledTimes(taskCount + 1);
        options.onProgress({ phase: 'calling_ai', attempt: 2, maxRetries: 2 });
        expect(m.beginTask).toHaveBeenCalledTimes(taskCount + 1);
        const action = m.beginTask.mock.calls[taskCount][1].action;
        expect(action.label).toBe('终止');
        action.run();
        expect(options.abortController.signal.aborted).toBe(true);
        return { success: true, failedGroups: [] };
      });
      m.executePlan.mockImplementationOnce(async (_plan, _settings, _setUpdating, ops) => {
        const execute = staging ? ops.processStagingGroupedUpdates : ops.processGroupedUpdates;
        await execute([], 'auto_independent', {});
        return { failedGroups: 0, errors: [], autoMergeTriggered: false, autoMergeSuccess: false };
      });
      await triggerAutomaticUpdateIfNeeded_ACU();
      expect(m.endTask).toHaveBeenCalledTimes(taskCount + 1);
    }

    expect(m.buildPlan).toHaveBeenCalledWith(chat, expect.any(Object), expect.any(Object), '', expect.any(Object));
    expect(m.executePlan).toHaveBeenCalledTimes(3);
    expect(m.abortRequests).toHaveBeenCalledTimes(2);
    expect(m.showToast.mock.calls.some(call => call[0] === 'info')).toBe(false);
    expect(m.logSkip).not.toHaveBeenCalled();
  });

  it('没有到期表时仍按需返回，不强制执行填表', async () => {
    m.buildPlan.mockReturnValue({ tablesToUpdate: [], updateGroups: {} });
    const { triggerAutomaticUpdateIfNeeded_ACU } = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-trigger');

    await Promise.all([
      triggerAutomaticUpdateIfNeeded_ACU(),
      triggerAutomaticUpdateIfNeeded_ACU(),
      triggerAutomaticUpdateIfNeeded_ACU(),
    ]);

    expect(m.logSkip).toHaveBeenCalledWith('no_tables_due', expect.objectContaining({ aiFloorCount: 1 }));
    expect(m.executePlan).not.toHaveBeenCalled();
    expect(m.beginTask).not.toHaveBeenCalled();
    expect(m.showToast).not.toHaveBeenCalled();
  });

  it('执行中到达多个触发时逐次按 FIFO 执行，不合并也不并发', async () => {
    let releaseFirst!: () => void;
    let releaseFollowUp!: () => void;
    m.executePlan
      .mockImplementationOnce(() => new Promise(resolve => { releaseFirst = () => resolve({ failedGroups: 0, errors: [], autoMergeTriggered: false, autoMergeSuccess: false }); }))
      .mockImplementationOnce(() => new Promise(resolve => { releaseFollowUp = () => resolve({ failedGroups: 0, errors: [], autoMergeTriggered: false, autoMergeSuccess: false }); }))
      .mockResolvedValue({ failedGroups: 0, errors: [], autoMergeTriggered: false, autoMergeSuccess: false });

    const { triggerAutomaticUpdateIfNeeded_ACU } = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-trigger');
    const first = triggerAutomaticUpdateIfNeeded_ACU({ runId: 'first' });
    await settleMicrotasks();
    const second = triggerAutomaticUpdateIfNeeded_ACU({ runId: 'second' });
    const third = triggerAutomaticUpdateIfNeeded_ACU({ runId: 'third' });
    expect(m.executePlan).toHaveBeenCalledTimes(1);

    releaseFirst();
    await first;
    await settleMicrotasks();
    expect(m.executePlan).toHaveBeenCalledTimes(2);
    releaseFollowUp();
    await Promise.all([second, third]);
    expect(m.executePlan).toHaveBeenCalledTimes(3);
    expect(m.buildPlan.mock.calls.map(call => call[4].runId)).toEqual(['first', 'second', 'third']);
    expect(m.logSkip).not.toHaveBeenCalled();
  });

  it('当前请求停止并失败时仍执行已接收的后续调度', async () => {
    let releaseFirst!: () => void;
    const error = new Error('当前填表已终止');
    m.executePlan.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      releaseFirst = () => reject(error);
    })).mockResolvedValue({ failedGroups: 0, errors: [], autoMergeTriggered: false, autoMergeSuccess: false });

    const { triggerAutomaticUpdateIfNeeded_ACU } = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-trigger');
    const first = triggerAutomaticUpdateIfNeeded_ACU();
    await settleMicrotasks();
    const second = triggerAutomaticUpdateIfNeeded_ACU();
    m.wasStopped = true;

    const rejected = expect(first).rejects.toThrow(error);
    releaseFirst();
    await rejected;
    await second;

    expect(m.executePlan).toHaveBeenCalledTimes(2);
    expect(m.logSkip).toHaveBeenCalledWith('execution_failed', expect.objectContaining({ stage: 'dispatch' }));
    expect(m.logSkip).toHaveBeenCalledTimes(1);
  });

  it.each(['chat', 'isolation', 'array', 'epoch'] as const)('正文接收任务等待期间 %s 变化，不在新作用域执行', async changed => {
    let releaseFirst!: () => void;
    let epoch = 0;
    m.executePlan.mockImplementationOnce(() => new Promise(resolve => {
      releaseFirst = () => resolve({ failedGroups: 0, errors: [], autoMergeTriggered: false, autoMergeSuccess: false });
    }));
    const { triggerAutomaticUpdateIfNeeded_ACU } = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-trigger');
    const first = triggerAutomaticUpdateIfNeeded_ACU();
    await settleMicrotasks();
    const queued = triggerAutomaticUpdateIfNeeded_ACU(undefined, {
      eventType: 'CHARACTER_MESSAGE_RENDERED', messageId: 1,
      chatKey: m.chatKey, isolationKey: m.isolationKey,
      isCurrentChat: () => epoch === 0,
    });
    if (changed === 'chat') m.chatKey = 'chat-b';
    if (changed === 'isolation') m.isolationKey = 'another-isolation';
    if (changed === 'array') m.getChat.mockReturnValue([{ is_user: false }]);
    if (changed === 'epoch') ++epoch;

    releaseFirst();
    await Promise.all([first, queued]);

    expect(m.executePlan).toHaveBeenCalledOnce();
    expect(m.buildPlan).toHaveBeenCalledOnce();
    expect(m.logSkip).toHaveBeenCalledExactlyOnceWith('chat_changed', expect.objectContaining({
      eventType: 'CHARACTER_MESSAGE_RENDERED', chatKey: 'chat-a', isolationKey: '', stage: 'dequeue',
    }));
  });
});
