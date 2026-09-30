// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

async function importTrigger() {
  vi.resetModules();
  const showCustomConfirm_ACU = vi.fn();
  const showToastr_ACU = vi.fn(() => null);
  const orchestrateManualUpdate_ACU = vi.fn();
  const processUpdatesBatch_ACU = vi.fn();
  const executeCardUpdateCore_ACU = vi.fn();
  const resetManualUpdateButton_ACU = vi.fn();

  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    settings_ACU: { manualUpdateContextDepth: 3, skipUpdateFloors: 0 },
    currentJsonTableData_ACU: { sheet_0: { name: '物品表' } },
    getCurrentIsolationKey_ACU: vi.fn(() => ''),
    _set_wasStoppedByUser_ACU: vi.fn(),
    _set_isAutoUpdatingCard_ACU: vi.fn(),
    abortAllActiveRequests_ACU: vi.fn(),
  }));
  vi.doMock('../../../src/service/chat/chat-service', () => ({
    getChatArray_ACU: vi.fn(() => [{ is_user: false, mes: 'AI 1' }]),
    saveCurrentDataForTable_ACU: vi.fn(),
  }));
  vi.doMock('../../../src/service/settings/settings-readers', () => ({
    getSelectedManualTableKeys_ACU: vi.fn(() => ['sheet_0']),
  }));
  vi.doMock('../../../src/presentation/theme/toast', () => ({ showToastr_ACU }));
  vi.doMock('../../../src/presentation/theme/custom-confirm', () => ({ showCustomConfirm_ACU }));
  vi.doMock('../../../src/shared/constants', () => ({ ACU_TOAST_CATEGORY_ACU: { MANUAL_TABLE: 'manual' } }));
  vi.doMock('../../../src/shared/utils', () => ({ logDebug_ACU: vi.fn(), logError_ACU: vi.fn(), logWarn_ACU: vi.fn() }));
  vi.doMock('../../../src/presentation/state/ui-refs', () => ({ $statusMessageSpan_ACU: null }));
  vi.doMock('../../../src/shared/env', () => ({ topLevelWindow_ACU: { AutoCardUpdaterAPI: { _notifyTableFillStart: vi.fn(), _notifyTableUpdate: vi.fn() } } }));
  vi.doMock('../../../src/presentation/components/status-display', () => ({
    resetManualUpdateButton_ACU,
    shouldShowVectorMemoryManualUpdateWarning_ACU: vi.fn(() => false),
    syncManualUpdateButtonAvailability_ACU: vi.fn(),
  }));
  vi.doMock('../../../src/presentation/components/update-status-display', () => ({ updateCardUpdateStatusDisplay_ACU: vi.fn() }));

  vi.doMock('../../../src/presentation/triggers/settings-ui-sync', () => ({ collectManualExtraHint_ACU: vi.fn() }));
  vi.doMock('../../../src/presentation/components/pipeline-ui-helpers', () => ({ refreshMergedDataAndNotifyWithUI_ACU: vi.fn(async () => undefined) }));
  vi.doMock('../../../src/service/table/update-orchestrator', () => ({
    processUpdatesBatch_ACU,
    executeCardUpdateCore_ACU,
    orchestrateManualUpdate_ACU,
  }));
  vi.doMock('../../../src/service/table/table-history', () => ({
    collectV2CheckpointFloorsFromChat_ACU: vi.fn(() => [{ messageIndex: 0, aiFloor: 1, reason: 'init' }]),
  }));

  const { handleManualUpdate_ACU, proceedWithCardUpdate_ACU, processUpdates_ACU } = await import('../../../src/presentation/triggers/update-process');
  return {
    handleManualUpdate_ACU,
    proceedWithCardUpdate_ACU,
    processUpdates_ACU,
    showCustomConfirm_ACU,
    showToastr_ACU,
    orchestrateManualUpdate_ACU,
    processUpdatesBatch_ACU,
    executeCardUpdateCore_ACU,
    resetManualUpdateButton_ACU,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('handleManualUpdate_ACU destructive refill confirmation', () => {
  it('单次确认文案明示会删除范围内 checkpoint 与增量，并提示不可恢复风险', async () => {
    const { handleManualUpdate_ACU, showCustomConfirm_ACU } = await importTrigger();
    showCustomConfirm_ACU.mockResolvedValueOnce(false);

    await handleManualUpdate_ACU();

    expect(showCustomConfirm_ACU).toHaveBeenCalledTimes(1);
    expect(showCustomConfirm_ACU.mock.calls[0][0]).toBe('手动填表确认');
    const message = showCustomConfirm_ACU.mock.calls[0][1];
    expect(message).toContain('会先删除本次重填范围内选中表的 checkpoint 与 V2 增量日志');
    expect(message).toContain('此前楼层的表格数据将无法恢复');
    expect(message).toContain('范围外的 checkpoint、范围外聊天记录的表格数据和未选中的表不会被删除');
    expect(message).not.toContain('第二次破坏性确认');
  });

  it('用户取消唯一确认时不调用 orchestrator，且不展示 error toast', async () => {
    const { handleManualUpdate_ACU, showCustomConfirm_ACU, showToastr_ACU, orchestrateManualUpdate_ACU } = await importTrigger();
    showCustomConfirm_ACU.mockResolvedValueOnce(false);

    await handleManualUpdate_ACU();

    expect(orchestrateManualUpdate_ACU).not.toHaveBeenCalled();
    expect(showCustomConfirm_ACU).toHaveBeenCalledTimes(1);
    expect(showToastr_ACU).toHaveBeenCalledWith('info', '已取消手动填表。');
    expect(showToastr_ACU.mock.calls.some(call => call[0] === 'error')).toBe(false);
  });

  it('用户确认后只调用 orchestrator 一次，且不再传 confirmBoundaryReset', async () => {
    const { handleManualUpdate_ACU, showCustomConfirm_ACU, orchestrateManualUpdate_ACU } = await importTrigger();
    showCustomConfirm_ACU.mockResolvedValue(true);
    orchestrateManualUpdate_ACU.mockResolvedValue({ success: true });

    await handleManualUpdate_ACU();

    expect(orchestrateManualUpdate_ACU).toHaveBeenCalledTimes(1);
    expect(showCustomConfirm_ACU).toHaveBeenCalledTimes(1);
    expect(orchestrateManualUpdate_ACU.mock.calls[0][0]).toEqual(['sheet_0']);
    expect(orchestrateManualUpdate_ACU.mock.calls[0][3]).toEqual(expect.objectContaining({ clearBeforeUpdate: true }));
    expect(orchestrateManualUpdate_ACU.mock.calls[0][3]).not.toHaveProperty('confirmBoundaryReset');
  });

  it('orchestrator 失败时展示 error toast', async () => {
    const { handleManualUpdate_ACU, showCustomConfirm_ACU, showToastr_ACU, orchestrateManualUpdate_ACU } = await importTrigger();
    showCustomConfirm_ACU.mockResolvedValue(true);
    orchestrateManualUpdate_ACU.mockResolvedValue({ success: false, error: '清理后重填失败' });

    await handleManualUpdate_ACU();

    expect(showToastr_ACU).toHaveBeenCalledWith('error', '清理后重填失败');
  });
});


describe('update error toast ownership', () => {
  it('直接执行单次更新失败时由 proceedWithCardUpdate 显示一次错误', async () => {
    const { proceedWithCardUpdate_ACU, executeCardUpdateCore_ACU, showToastr_ACU } = await importTrigger();
    executeCardUpdateCore_ACU.mockResolvedValue({ success: false, modifiedKeys: [], error: '单次失败' });

    const result = await proceedWithCardUpdate_ACU([{ is_user: false, mes: 'AI' }]);

    expect(result.success).toBe(false);
    expect(showToastr_ACU.mock.calls.filter(call => call[0] === 'error')).toEqual([
      ['error', '更新失败: 单次失败'],
    ]);
  });

  it('批处理失败时内部 proceed 不报错，由 processUpdates 最外层只显示一次', async () => {
    const { processUpdates_ACU, processUpdatesBatch_ACU, executeCardUpdateCore_ACU, showToastr_ACU } = await importTrigger();
    executeCardUpdateCore_ACU.mockResolvedValue({ success: false, modifiedKeys: [], error: '内部失败' });
    processUpdatesBatch_ACU.mockImplementation(async (_indices: number[], _mode: string, _options: any, executeUpdate: any) => {
      const inner = await executeUpdate([{ is_user: false, mes: 'AI' }], 1, 'auto_standard', false, ['sheet_0'], null, {
        currentBatch: 1,
        totalBatches: 1,
        batchBaseSnapshot: {},
      });
      expect(inner.success).toBe(false);
      return { success: false, failedBatches: [0], error: '批处理失败' };
    });

    const result = await processUpdates_ACU([1], 'auto');

    expect(result.success).toBe(false);
    expect(showToastr_ACU.mock.calls.filter(call => call[0] === 'error')).toEqual([
      ['error', '批处理失败'],
    ]);
  });

  it('批处理静默内部失败仍只由最外层输出一次最终错误', async () => {
    const { processUpdates_ACU, processUpdatesBatch_ACU, showToastr_ACU } = await importTrigger();
    processUpdatesBatch_ACU.mockResolvedValue({ success: false, failedBatches: [0], error: '静默批失败' });

    await processUpdates_ACU([1], 'auto');

    expect(showToastr_ACU.mock.calls.filter(call => call[0] === 'error')).toEqual([['error', '静默批失败']]);
  });
});
