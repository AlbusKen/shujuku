import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  wasStopped: false,
  executePlan: vi.fn(),
  logSkip: vi.fn(),
  buildPlan: vi.fn(() => ({ tablesToUpdate: [{ sheetKey: 'sheet_0' }], updateGroups: { group_1: {} } })),
  getChat: vi.fn(() => [{ is_user: true }, { is_user: false }]),
  preCheck: { canProceed: true, reason: '' },
}));

vi.mock('../../../src/presentation/components/plot-editors', () => ({
  getCharCardPromptFromUI_ACU: vi.fn(), isAutoUpdatingCard_ACU: false,
  renderPromptSegments_ACU: vi.fn(), get wasStoppedByUser_ACU() { return m.wasStopped; },
  _set_isAutoUpdatingCard_ACU: vi.fn(),
}));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  NEW_MESSAGE_DEBOUNCE_DELAY_ACU: 500, abortAllActiveRequests_ACU: vi.fn(),
  allChatMessages_ACU: [{ is_user: true }, { is_user: false }], coreApisAreReady_ACU: true,
  currentJsonTableData_ACU: { sheet_0: {} }, getCurrentIsolationKey_ACU: vi.fn(() => ''),
  lastTotalAiMessages_ACU: 1, settings_ACU: { autoUpdateEnabled: true, maxConcurrentGroups: 1, silentModeEnabled: true },
  _set_coreApisAreReady_ACU: vi.fn(), _set_lastTotalAiMessages_ACU: vi.fn(),
  _set_manualExtraHint_ACU: vi.fn(), _set_wasStoppedByUser_ACU: vi.fn(),
}));
vi.mock('../../../src/service/table/update-scheduler', () => ({
  checkAutoUpdatePreConditions_ACU: vi.fn(() => m.preCheck),
  handleFloorIncreaseDelay_ACU: vi.fn(async () => undefined),
  buildAutoUpdatePlan_ACU: (...args: any[]) => m.buildPlan(...args),
  executeAutoUpdatePlan_ACU: (...args: any[]) => m.executePlan(...args),
}));
vi.mock('../../../src/service/chat/chat-service', () => ({ getChatArray_ACU: (...args: any[]) => m.getChat(...args), saveChatToHost_ACU: vi.fn() }));
vi.mock('../../../src/shared/runtime-performance', () => ({ startRuntimePerformanceSpan_ACU: vi.fn(() => ({ id: 'span', end: vi.fn() })) }));
vi.mock('../../../src/shared/trigger-diagnostics', () => ({ logAutoFillSkip_ACU: (...args: any[]) => m.logSkip(...args) }));
vi.mock('../../../src/service/template/chat-scope', () => ({ getSortedSheetKeys_ACU: vi.fn(() => ['sheet_0']) }));
vi.mock('../../../src/service/table/storage-mode', () => ({ isSqliteMode: vi.fn(() => true) }));
vi.mock('../../../src/presentation/theme/toast', () => ({ showToastr_ACU: vi.fn() }));
vi.mock('../../../src/presentation/components/update-status-display', () => ({ updateCardUpdateStatusDisplay_ACU: vi.fn() }));
vi.mock('../../../src/shared/utils', () => ({ logDebug_ACU: vi.fn(), logError_ACU: vi.fn(), logWarn_ACU: vi.fn(), isSummaryOrOutlineTable_ACU: vi.fn() }));
vi.mock('../../../src/service/worldbook/pipeline', () => ({ loadAllChatMessages_ACU: vi.fn(), updateReadableLorebookEntry_ACU: vi.fn() }));
vi.mock('../../../src/service/table/table-storage-strategy', () => ({ getStorageProvider: vi.fn(() => ({ getCurrentData: vi.fn() })) }));
vi.mock('../../../src/shared/env', () => ({ topLevelWindow_ACU: {} }));
vi.mock('../../../src/presentation/triggers/settings-ui-sync/settings-ui-config', () => ({ purgeOldLayerData_ACU: vi.fn() }));
vi.mock('../../../src/service/table/update-orchestrator', () => ({ processGroupedRuntimeChunk_ACU: vi.fn() }));

async function settleMicrotasks() { await Promise.resolve(); await Promise.resolve(); }

describe('triggerAutomaticUpdateIfNeeded_ACU 并发补跑', () => {
  beforeEach(() => { m.wasStopped = false; m.executePlan.mockReset(); m.logSkip.mockReset(); m.buildPlan.mockReset(); m.preCheck = { canProceed: true, reason: '' }; });

  it('前置检查失败时记录稳定原因码到诊断日志', async () => {
    m.preCheck = { canProceed: false, reason: 'Pre-flight checks failed.', code: 'runtime_not_ready' };
    const { triggerAutomaticUpdateIfNeeded_ACU } = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-trigger');
    await triggerAutomaticUpdateIfNeeded_ACU();
    await settleMicrotasks();
    expect(m.logSkip).toHaveBeenCalledWith('preconditions_failed', expect.objectContaining({
      preconditionReason: 'runtime_not_ready',
    }));
    // fail-closed：前置检查失败时只记录一次 skip，不构建也不执行更新计划。
    expect(m.logSkip).toHaveBeenCalledTimes(1);
    expect(m.buildPlan).not.toHaveBeenCalled();
    expect(m.executePlan).not.toHaveBeenCalled();
  });

  it('执行中到达多个触发时合并为一次后续执行', async () => {
    let releaseFirst!: () => void;
    let releaseFollowUp!: () => void;
    m.executePlan
      .mockImplementationOnce(() => new Promise(resolve => { releaseFirst = () => resolve({ failedGroups: 0, errors: [], autoMergeTriggered: false, autoMergeSuccess: false }); }))
      .mockImplementationOnce(() => new Promise(resolve => { releaseFollowUp = () => resolve({ failedGroups: 0, errors: [], autoMergeTriggered: false, autoMergeSuccess: false }); }));

    const { triggerAutomaticUpdateIfNeeded_ACU } = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-trigger');
    const first = triggerAutomaticUpdateIfNeeded_ACU({ runId: 'first' });
    await settleMicrotasks();
    await triggerAutomaticUpdateIfNeeded_ACU({ runId: 'second' });
    await triggerAutomaticUpdateIfNeeded_ACU({ runId: 'third' });
    expect(m.logSkip).toHaveBeenCalledWith('auto_update_coalesced', { inFlight: true });

    releaseFirst();
    await first;
    await settleMicrotasks();
    expect(m.executePlan).toHaveBeenCalledTimes(2);
    releaseFollowUp();
    await settleMicrotasks();
  });

  it('用户停止后清除 pending 触发而不补跑', async () => {
    let releaseFirst!: () => void;
    m.executePlan.mockImplementationOnce(() => new Promise(resolve => {
      releaseFirst = () => resolve({
        failedGroups: 0,
        errors: [],
        autoMergeTriggered: false,
        autoMergeSuccess: false,
      });
    }));

    const { triggerAutomaticUpdateIfNeeded_ACU } = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-trigger');
    const first = triggerAutomaticUpdateIfNeeded_ACU();
    await settleMicrotasks();
    await triggerAutomaticUpdateIfNeeded_ACU();
    m.wasStopped = true;

    releaseFirst();
    await first;
    await settleMicrotasks();

    expect(m.executePlan).toHaveBeenCalledTimes(1);
    expect(m.logSkip).toHaveBeenCalledWith('auto_update_coalesced', { inFlight: true });
  });
});
