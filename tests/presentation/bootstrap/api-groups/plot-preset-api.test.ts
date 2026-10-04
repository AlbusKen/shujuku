import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resetFromTemplate: vi.fn(),
  reconcileTemplate: vi.fn(),
  isSqliteMode: vi.fn(() => false),
  reloadStorage: vi.fn(),
  didSqliteFallback: vi.fn(() => false),
  sanitizeTemplate: vi.fn((template: any) => ({ templateStr: JSON.stringify(template) })),
  upsertTemplatePreset: vi.fn(() => true),
  saveSettings: vi.fn(),
  switchFillMode: vi.fn(),
  persistedPresets: [] as any[],
  refreshPreset: vi.fn(),
  switchPreset: vi.fn(() => ({ presetName: '西幻剧情引导', followsGlobal: false })),
  emitMessageUpdated: vi.fn(),
  notifyTableUpdate: vi.fn(),
}));

vi.mock('../../../../src/shared/env', () => ({
  topLevelWindow_ACU: { AutoCardUpdaterAPI: { _notifyTableUpdate: mocks.notifyTableUpdate } },
}));
vi.mock('../../../../src/shared/host-api', () => ({
  SillyTavern_API_ACU: { eventTypes: { MESSAGE_UPDATED: 'MESSAGE_UPDATED' }, eventSource: { emit: mocks.emitMessageUpdated } },
}));
vi.mock('../../../../src/shared/template-preset-utils', () => ({
  deriveTemplatePresetNameForImport_ACU: vi.fn(({ presetName }: any) => String(presetName || '').trim()),
}));
vi.mock('../../../../src/shared/utils', () => ({ logDebug_ACU: vi.fn(), logError_ACU: vi.fn(), logWarn_ACU: vi.fn() }));
vi.mock('../../../../src/service/runtime/state-manager', () => ({ settings_ACU: { plotSettings: { promptPresets: [] } } }));
vi.mock('../../../../src/service/plot/plot-logic', () => ({
  getCurrentRuntimePlotPresetName_ACU: vi.fn(),
  normalizePlotPresetExcludeRules_ACU: vi.fn((preset: any) => preset),
  switchCurrentChatPlotPreset_ACU: mocks.switchPreset,
}));
vi.mock('../../../../src/service/table/template-state-reset', () => ({
  resetCurrentChatTableStateFromTemplate_ACU: mocks.resetFromTemplate,
}));
vi.mock('../../../../src/service/template/template-preset-service', () => ({
  applyChatTemplateSnapshotWithReconciliation_ACU: mocks.reconcileTemplate,
  upsertTemplatePreset_ACU: mocks.upsertTemplatePreset,
}));
vi.mock('../../../../src/service/template/chat-scope', () => ({
  sanitizeTemplateSnapshotForChat_ACU: mocks.sanitizeTemplate,
}));
vi.mock('../../../../src/service/table/storage-mode', () => ({ isSqliteMode: mocks.isSqliteMode }));
vi.mock('../../../../src/service/table/table-storage-strategy', () => ({
  reloadStorageProvider: mocks.reloadStorage,
  didSqliteFallbackAfterReload_ACU: mocks.didSqliteFallback,
}));
vi.mock('../../../../src/presentation/components/settings-ui-helpers', () => ({ saveSettingsAndNotify_ACU: mocks.saveSettings }));
vi.mock('../../../../src/presentation/components/pipeline-ui-helpers', () => ({ refreshPresetUIAfterSwitch_ACU: mocks.refreshPreset }));
vi.mock('../../../../src/service/fill-mode/fill-mode-chat-switch', () => ({
  setCurrentChatFillMode_ACU: mocks.switchFillMode,
}));

import { createPlotPresetApi } from '../../../../src/presentation/bootstrap/api-groups/plot-preset-api';
import { settings_ACU } from '../../../../src/service/runtime/state-manager';

function createApi() {
  let api: Record<string, Function>;
  api = createPlotPresetApi({ getApi: () => api } as any);
  return api;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resetFromTemplate.mockResolvedValue({ saved: true, messageIndex: 0, runtimeReady: true });
  mocks.reconcileTemplate.mockResolvedValue({ saved: true, messageIndex: 0, runtimeReady: true });
  mocks.isSqliteMode.mockReturnValue(false);
  mocks.didSqliteFallback.mockReturnValue(false);
  mocks.sanitizeTemplate.mockImplementation((template: any) => ({ templateStr: JSON.stringify(template) }));
  mocks.upsertTemplatePreset.mockReturnValue(true);
  settings_ACU.plotSettings.promptPresets = [];
  mocks.persistedPresets = [];
  mocks.saveSettings.mockReset().mockImplementation(() => {
    mocks.persistedPresets = JSON.parse(JSON.stringify(settings_ACU.plotSettings.promptPresets));
    return { saved: true, storageType: 'tavern' };
  });
  mocks.switchFillMode.mockReset().mockResolvedValue({ ok: true, mode: 'llm', changed: true });
  mocks.switchPreset.mockReset().mockReturnValue({ presetName: '西幻剧情引导', followsGlobal: false });
  mocks.refreshPreset.mockReset();
});

describe('initGameSession 模板重置契约', () => {
  it('reset=true 通过单一原子入口写入模板，而不调用旧的 delete/guide-only 链路', async () => {
    const templateData = { mate: { type: 'chatSheets', version: 1 }, sheet_legacy: { uid: 'sheet_legacy', name: '角色', content: [['row_id', '名称'], ['seed-1', '助手']] } };

    const api = createApi();
    const result = await api.initGameSession({}, {
      templateData, presetData: { name: '西幻剧情引导' },
    });

    expect(mocks.resetFromTemplate).toHaveBeenCalledWith(templateData, expect.objectContaining({
      presetName: '', source: 'game_init', reason: 'game_init', resetExistingTableData: true,
    }));
    expect(result).toMatchObject({ success: true, templateInjected: true });
    expect(result).toMatchObject({ presetLoaded: true, fillModeSwitch: { ok: true, mode: 'llm' } });
    expect(mocks.persistedPresets.map(preset => preset.name)).toEqual(['西幻剧情引导']);
    expect(mocks.switchFillMode).toHaveBeenCalledWith('llm');
    mocks.switchFillMode.mockClear();
    mocks.refreshPreset.mockClear();
    const batch = await api.importPlotPresetsFromData([{ name: '批量一' }, {}, { name: '批量二' }]);
    expect(batch).toMatchObject({ success: false, imported: 2, failed: 1, fillModeSwitch: { ok: true, mode: 'llm' } });
    expect(batch.details.map((item: any) => item.success)).toEqual([true, false, true]);
    expect(mocks.switchFillMode).toHaveBeenCalledOnce();
    expect(mocks.refreshPreset).toHaveBeenCalledOnce();
    expect(mocks.persistedPresets.map(preset => preset.name)).toEqual(['西幻剧情引导', '批量一', '批量二']);
  });

  it('reset 成功后用已提交的规范化模板注册预设，而非原始缺列输入', async () => {
    const templateData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_summary_log: { uid: 'sheet_summary_log', name: 'SummaryLog', content: [['时间', '摘要'], ['T1', '事件']] },
    };
    const committedTemplateData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_summary_log: { uid: 'sheet_summary_log', name: 'SummaryLog', content: [['row_id', '时间', '摘要'], ['1', 'T1', '事件']] },
    };
    mocks.resetFromTemplate.mockResolvedValueOnce({
      saved: true, messageIndex: 0, runtimeReady: true, normalizedTemplateData: committedTemplateData,
    });

    const result = await createApi().initGameSession({}, {
      templateData, templatePresetName: '规范化预设', loadPreset: false,
    });

    expect(result).toMatchObject({ success: true, templateInjected: true });
    expect(mocks.sanitizeTemplate).toHaveBeenCalledWith(committedTemplateData);
    expect(mocks.sanitizeTemplate).not.toHaveBeenCalledWith(templateData);
    expect(mocks.upsertTemplatePreset).toHaveBeenCalledWith('规范化预设', JSON.stringify(committedTemplateData));
  });

  it('原子提交失败时返回失败，不能以 guide-only fallback 伪造模板注入成功', async () => {
    mocks.resetFromTemplate.mockResolvedValueOnce({ saved: false, error: '严格保存失败，状态已回滚。' });

    const result = await createApi().initGameSession({}, {
      templateData: { sheet_a: { uid: 'sheet_a', name: 'A', content: [['row_id']] } },
      loadPreset: false,
    });

    expect(result).toMatchObject({ success: false, templateInjected: false });
    expect(result.message).toContain('严格保存失败');
    const api = createApi();
    const previous = settings_ACU.plotSettings.promptPresets;
    for (const saved of [{ saved: false, error: '保存拒绝' }, { saved: true, storageType: 'memory' }]) {
      mocks.saveSettings.mockReturnValueOnce(saved);
      expect(await api.importPlotPresetFromData({ name: '未保存' })).toMatchObject({ success: false });
      expect(settings_ACU.plotSettings.promptPresets).toBe(previous);
      expect(mocks.persistedPresets).toEqual([]);
    }
    mocks.saveSettings.mockImplementationOnce(() => { throw new Error('保存异常'); });
    expect(await api.importPlotPresetFromData({ name: '异常' })).toMatchObject({ success: false });
    expect(settings_ACU.plotSettings.promptPresets).toBe(previous);
    expect(mocks.switchFillMode).not.toHaveBeenCalled();
  });

  it('reset=false 不执行破坏性重置，而是进入既有模板协调入口', async () => {
    const templateData = { sheet_a: { uid: 'sheet_a', name: 'A', content: [['row_id']] } };

    const result = await createApi().initGameSession({}, { templateData, loadPreset: false, resetExistingTableData: false });

    expect(mocks.resetFromTemplate).not.toHaveBeenCalled();
    expect(mocks.reconcileTemplate).toHaveBeenCalledWith(templateData, expect.objectContaining({
      source: 'game_init', presetName: '', destructiveChangeConfirmed: false,
    }));
    expect(result).toMatchObject({ success: true, templateInjected: true });
  });

  it('模板提交后不在 await initGameSession 的调用栈内刷新宿主消息或第三方 iframe', async () => {
    const result = await createApi().initGameSession({}, {
      templateData: { sheet_a: { uid: 'sheet_a', name: 'A', content: [['row_id']] } },
      loadPreset: false,
    });

    expect(result).toMatchObject({ success: true, templateInjected: true });
    expect(mocks.emitMessageUpdated).not.toHaveBeenCalled();
    expect(mocks.notifyTableUpdate).not.toHaveBeenCalled();
    expect(mocks.saveSettings).toHaveBeenCalledOnce();
  });

  it('SQLite 重载回退后保留已提交状态，并向调用方报告 runtime warning', async () => {
    mocks.isSqliteMode.mockReturnValue(true);
    mocks.didSqliteFallback.mockReturnValue(true);

    const result = await createApi().initGameSession({}, {
      templateData: { sheet_a: { uid: 'sheet_a', name: 'A', content: [['row_id']] } },
      loadPreset: false,
    });

    expect(mocks.reloadStorage).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ success: true, templateInjected: true, runtimeReady: false });
    expect(result.warning).toContain('回退到原生模式');
    const api = createApi();
    mocks.switchFillMode.mockResolvedValueOnce({ ok: false, reason: 'irreversible_confirmation_required', currentMode: 'classic' });
    const imported = await api.initGameSession({}, { injectTemplate: false, presetData: { name: '受保护预设' } });
    expect(imported).toMatchObject({ success: true, presetLoaded: true, fillModeSwitch: { ok: false, reason: 'irreversible_confirmation_required' } });
    expect(imported.warning).toContain('irreversible_confirmation_required');
    expect(mocks.persistedPresets.map(preset => preset.name)).toContain('受保护预设');
    mocks.switchFillMode.mockRejectedValueOnce(new Error('切换异常'));
    mocks.switchPreset.mockReturnValueOnce(null as any);
    mocks.refreshPreset.mockImplementationOnce(() => { throw new Error('刷新异常'); });
    const exceptional = await api.importPlotPresetFromData({ name: '异常后保留' }, { switchTo: true });
    expect(exceptional).toMatchObject({ success: true, switchedCurrentChat: false, fillModeSwitch: { ok: false, reason: 'switch_exception' } });
    expect(exceptional.warning).toContain('模式切换异常');
    expect(exceptional.warning).toContain('未能绑定');
    expect(exceptional.warning).toContain('界面刷新失败');
    expect(mocks.persistedPresets.map(preset => preset.name)).toContain('异常后保留');
    mocks.switchFillMode.mockResolvedValueOnce({ ok: false, reason: 'save_failed', currentMode: 'llm' });
    const batch = await api.importPlotPresetsFromData([{ name: '批量保留' }]);
    expect(batch).toMatchObject({ success: true, imported: 1, failed: 0, fillModeSwitch: { ok: false, reason: 'save_failed' } });
    expect(batch.warning).toContain('save_failed');
  });
});
