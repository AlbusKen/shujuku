/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadFlow() {
  vi.resetModules();
  const settings: any = { dataIsolationCode: 'alpha', deleteStartFloor: 1, deleteEndFloor: null, retainRecentLayers: 100, charCardPrompt: [], storageMode: 'native' };
  const history = ['alpha', 'beta'];
  const switchIsolation = vi.fn(async (code: string) => { settings.dataIsolationCode = code; });
  const removeHistory = vi.fn((code: string) => history.splice(history.indexOf(code), 1));
  const deleteGenerated = vi.fn(async () => undefined);
  const applyTemplateScope = vi.fn();
  const overrideLatest = vi.fn(async () => 2);
  const deleteScoped = vi.fn(async () => ({ path: 'range' as const, deletedCount: 2 }));
  const reloadProvider = vi.fn(async () => undefined);
  const loadOrCreate = vi.fn(async () => undefined);
  const refreshMerged = vi.fn(async () => undefined);
  const cleanupWorldbook = vi.fn(async () => 1);
  const scan = vi.fn(async () => [{ isolationKey: 'alpha', status: 'ok', requiresConfirmation: false, message: 'ok', isCurrentIsolation: true }]);
  const prepare = vi.fn(async () => ({ planId: 'plan-1', status: 'recoverable_orphan_data_replace', isolationKey: 'alpha', requiresConfirmation: true, message: 'recover' }));
  const commit = vi.fn(async () => ({ status: 'committed', planId: 'plan-1' }));

  vi.doMock('../../../src/service/runtime/state-manager', () => ({ settings_ACU: settings, currentChatFileIdentifier_ACU: 'chat', currentJsonTableData_ACU: { sheet_a: {} }, getCurrentIsolationKey_ACU: () => settings.dataIsolationCode }));
  vi.doMock('../../../src/service/settings/settings-service', () => ({ applyTemplateScopeForCurrentChat_ACU: applyTemplateScope, applyCombinedSettingsImport_ACU: vi.fn(), getDataIsolationHistory_ACU: () => [...history], removeDataIsolationHistory_ACU: removeHistory, saveSettings_ACU: vi.fn(), switchIsolationProfile_ACU: switchIsolation }));
  vi.doMock('../../../src/service/settings/settings-write-service', () => ({
    resetAllPromptsToDefault_ACU: vi.fn(() => ({ ok: true, code: 'ok', changed: true })),
    snapshotSettingsFields_ACU: vi.fn(() => ({})),
    restoreSettingsFields_ACU: vi.fn(),
  }));
  vi.doMock('../../../src/service/chat/chat-service', () => ({ getChatArray_ACU: () => [{ is_user: false }], deleteLocalDataWithScope_ACU: deleteScoped, isFullRangeDeletionRequest_ACU: () => false, overrideLatestLayerWithTemplateCore_ACU: overrideLatest }));
  vi.doMock('../../../src/service/table/table-service', () => ({ loadOrCreateJsonTableFromChatHistory_ACU: loadOrCreate }));
  vi.doMock('../../../src/service/worldbook/worldbook-cleanup', () => ({ cleanupWorldbookEntriesAfterDataDeletion_ACU: cleanupWorldbook }));
  vi.doMock('../../../src/service/worldbook/pipeline', () => ({ deleteAllGeneratedEntries_ACU: deleteGenerated, refreshMergedDataAndNotify_ACU: refreshMerged }));
  vi.doMock('../../../src/service/table/storage-mode', () => ({ getCurrentStorageMode: () => 'native', isSqliteMode: () => false }));
  vi.doMock('../../../src/service/table/table-storage-strategy', () => ({ reloadStorageProvider: reloadProvider }));
  vi.doMock('../../../src/service/table/table-v2-recovery-service', () => ({ scanV2IsolationDiagnostics_ACU: scan, prepareV2Recovery_ACU: prepare, commitPreparedV2Recovery_ACU: commit }));
  vi.doMock('../../../src/service/template/template-preset-service', () => ({ applyTemplateSnapshotToScope_ACU: vi.fn(), getDefaultTemplateSnapshot_ACU: vi.fn() }));

  const { createPinia, setActivePinia } = await import('pinia');
  setActivePinia(createPinia());
  const [{ useDataManagement }, { useToastStore }] = await Promise.all([
    import('../../../src/presentation-v2/composables/useDataManagement'),
    import('../../../src/presentation-v2/stores/toast-store'),
  ]);
  const toast = useToastStore();
  const toastSuccess = vi.spyOn(toast, 'success').mockImplementation(() => {});
  const toastError = vi.spyOn(toast, 'error').mockImplementation(() => {});
  const toastWarning = vi.spyOn(toast, 'warning').mockImplementation(() => {});
  return { flow: useDataManagement(), settings, history, switchIsolation, removeHistory, deleteGenerated, applyTemplateScope, overrideLatest, deleteScoped, reloadProvider, loadOrCreate, refreshMerged, cleanupWorldbook, scan, prepare, commit, toast, toastSuccess, toastError, toastWarning };
}

beforeEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('useDataManagement', () => {
  it('隔离切换和历史删除保持当前隔离域状态一致', async () => {
    const d = await loadFlow();
    d.flow.refresh();
    d.flow.isolationCode.value = 'gamma';
    await d.flow.applyIsolation();
    expect(d.switchIsolation).toHaveBeenCalledWith('gamma');
    expect(d.flow.currentIsolationLabel.value).toBe('gamma');
    await d.flow.removeHistory('beta');
    expect(d.removeHistory).toHaveBeenCalledWith('beta');
    await d.flow.removeHistory('gamma');
    expect(d.switchIsolation).toHaveBeenLastCalledWith('');
    expect(d.removeHistory).toHaveBeenCalledWith('gamma');
  });

  it('隐藏入口对应的业务链路仍可独立执行', async () => {
    const d = await loadFlow();
    d.flow.refresh();
    await d.flow.deleteCurrentIsolationEntries();
    await d.flow.overrideLatestLayerWithTemplate();
    await d.flow.deleteLocalData('current');
    expect(d.deleteGenerated).toHaveBeenCalledOnce();
    expect(d.applyTemplateScope.mock.invocationCallOrder[0]).toBeLessThan(d.overrideLatest.mock.invocationCallOrder[0]);
    expect(d.deleteScoped).toHaveBeenCalledWith('current', 1, null, 'range');
    expect(d.loadOrCreate).toHaveBeenCalled();
    expect(d.refreshMerged).toHaveBeenCalled();
    expect(d.cleanupWorldbook).toHaveBeenCalled();
  });
  it('V2 诊断与恢复只透传服务端冻结的 planId 和确认值', async () => {
    const d = await loadFlow();
    await d.flow.scanV2IsolationDiagnostics();
    expect(d.scan).toHaveBeenCalledOnce();
    expect(d.prepare).not.toHaveBeenCalled();
    expect(d.flow.v2IsolationDiagnostics.value).toHaveLength(1);

    await d.flow.prepareV2Recovery();
    await d.flow.commitV2Recovery(true);
    expect(d.prepare).toHaveBeenCalledOnce();
    expect(d.commit).toHaveBeenCalledWith('plan-1', { confirmOrphanDataReplace: true });
  });

  it('purge 成功时不在 UI 层 reload（回落由 purge 服务内部完成），只刷新合并视图与 toast', async () => {
    const d = await loadFlow();
    d.deleteScoped.mockResolvedValueOnce({
      path: 'purge',
      result: {
        saved: true,
        clearedMessageCount: 12,
        removedMetadata: ['_acu_chat_sheet_guide', '_acu_chat_template_scope'],
      },
    });

    await d.flow.deleteLocalData('all');

    // S1-1：runtime 回落由 purge 服务内部完成，UI 层不再 loadOrCreate/reloadProvider；
    // 世界书清理也由 purge 内部完成。UI 层只刷新合并视图让面板展示模板空结构。
    expect(d.loadOrCreate).not.toHaveBeenCalled();
    expect(d.reloadProvider).not.toHaveBeenCalled();
    expect(d.refreshMerged).toHaveBeenCalledOnce();
    expect(d.cleanupWorldbook).not.toHaveBeenCalled();
    expect(d.deleteGenerated).not.toHaveBeenCalled();
    // 本页 refresh 与成功 toast 保留。
    expect(d.toastSuccess).toHaveBeenCalled();
  });

  it('purge 失败时不走成功路径，不触发任何 reload/持久化/世界书调用', async () => {
    const d = await loadFlow();
    d.deleteScoped.mockResolvedValueOnce({
      path: 'purge',
      result: {
        saved: false,
        clearedMessageCount: 0,
        removedMetadata: [],
        error: '保存失败，已回滚。',
      },
    });

    await d.flow.deleteLocalData('all');

    expect(d.toastError).toHaveBeenCalled();
    expect(d.toastSuccess).not.toHaveBeenCalled();
    expect(d.loadOrCreate).not.toHaveBeenCalled();
    expect(d.reloadProvider).not.toHaveBeenCalled();
    expect(d.refreshMerged).not.toHaveBeenCalled();
    expect(d.cleanupWorldbook).not.toHaveBeenCalled();
  });

  it('purge 带 cleanupWarnings 时展示 warning，仍刷新合并视图但不在 UI 层重载', async () => {
    const d = await loadFlow();
    d.deleteScoped.mockResolvedValueOnce({
      path: 'purge',
      result: {
        saved: true,
        clearedMessageCount: 3,
        removedMetadata: [],
        cleanupWarnings: ['世界书清理失败。'],
      },
    });

    await d.flow.deleteLocalData('all');

    expect(d.toastWarning).toHaveBeenCalled();
    expect(d.loadOrCreate).not.toHaveBeenCalled();
    expect(d.reloadProvider).not.toHaveBeenCalled();
    expect(d.refreshMerged).toHaveBeenCalledOnce();
    expect(d.cleanupWorldbook).not.toHaveBeenCalled();
  });

});

