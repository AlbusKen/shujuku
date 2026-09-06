import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  settings: {
    charCardPrompt: ['old'],
    mergeSummaryPrompt: 'old',
    tableKeyOrder: ['a'],
    tableUpdateLocks: { 'scope:': {} },
    specialIndexLocks: {},
    plotSettings: {},
    plotPresetBindings: {},
  } as any,
  saveSettings: vi.fn(() => ({ saved: true, storageType: 'memory' })),
  applyTemplateScope: vi.fn(),
  snapshot: vi.fn(),
  restore: vi.fn(),
  resetPrompts: vi.fn(() => ({ ok: true, code: 'ok', changed: true })),
  getDefault: vi.fn(() => ({ templateStr: '{}', templateObj: {} })),
  applyTemplate: vi.fn(async () => ({ saved: true })),
  clearLocks: vi.fn(() => ({ changed: false })),
  clearPlot: vi.fn(async () => ({ changed: false })),
  clearTemplate: vi.fn(async () => ({ changed: false })),
  loadOrCreate: vi.fn(async () => ({ ok: true })),
  refresh: vi.fn(async () => ({ ok: true })),
  saveChat: vi.fn(async () => undefined),
  logWarn: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get settings_ACU() { return h.settings; },
}));
vi.mock('../../../src/service/settings/settings-service', () => ({
  applyTemplateScopeForCurrentChat_ACU: h.applyTemplateScope,
  saveSettings_ACU: h.saveSettings,
}));
vi.mock('../../../src/service/settings/settings-write-service', () => ({
  resetAllPromptsToDefault_ACU: h.resetPrompts,
  snapshotSettingsFields_ACU: h.snapshot,
  restoreSettingsFields_ACU: h.restore,
}));
vi.mock('../../../src/service/template/template-preset-service', () => ({
  applyTemplateSnapshotToScope_ACU: h.applyTemplate,
  getDefaultTemplateSnapshot_ACU: h.getDefault,
}));
vi.mock('../../../src/service/template/chat-scope', () => ({
  clearCurrentChatTemplateSnapshots_ACU: h.clearTemplate,
}));
vi.mock('../../../src/service/runtime/helpers-table-lock', () => ({
  clearCurrentTableLocks_ACU: h.clearLocks,
}));
vi.mock('../../../src/service/plot/plot-logic', () => ({
  clearCurrentChatPlotPresetOverride_ACU: h.clearPlot,
}));
vi.mock('../../../src/service/table/table-service', () => ({
  loadOrCreateJsonTableFromChatHistory_ACU: h.loadOrCreate,
}));
vi.mock('../../../src/service/worldbook/pipeline', () => ({
  refreshMergedDataAndNotify_ACU: h.refresh,
}));
vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  saveChatToHost_ACU: h.saveChat,
}));
vi.mock('../../../src/shared/utils', () => ({
  logWarn_ACU: h.logWarn,
}));

import { resetAllDefaults_ACU } from '../../../src/service/table/reset-defaults-service';

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(h.settings, {
    charCardPrompt: ['old'],
    mergeSummaryPrompt: 'old',
    tableKeyOrder: ['a'],
    tableUpdateLocks: { 'scope:': {} },
    specialIndexLocks: {},
    plotSettings: {},
    plotPresetBindings: {},
  });
  h.saveSettings.mockReturnValue({ saved: true, storageType: 'memory' });
  h.resetPrompts.mockReturnValue({ ok: true, code: 'ok', changed: true });
  h.getDefault.mockReturnValue({ templateStr: '{}', templateObj: {} });
  h.applyTemplate.mockResolvedValue({ saved: true });
  h.clearLocks.mockReturnValue({ changed: false });
  h.clearPlot.mockResolvedValue({ changed: false });
  h.clearTemplate.mockResolvedValue({ changed: false });
  h.loadOrCreate.mockResolvedValue({ ok: true });
  h.refresh.mockResolvedValue({ ok: true });
  h.saveChat.mockResolvedValue(undefined);
  h.snapshot.mockImplementation((fields: string[]) => {
    const out: Record<string, any> = {};
    for (const field of fields) out[field] = h.settings[field];
    return out;
  });
  h.restore.mockImplementation((snap: Record<string, any>) => Object.assign(h.settings, snap));
});

describe('reset-defaults-service', () => {
  it('全选成功：准备→清理→模板→settings→chat→派生刷新顺序完整', async () => {
    const result = await resetAllDefaults_ACU();
    expect(result.success).toBe(true);
    expect(h.resetPrompts).toHaveBeenCalledWith(undefined, { save: false });
    expect(h.clearLocks).toHaveBeenCalledWith({ save: false });
    expect(h.clearPlot).toHaveBeenCalledWith(expect.objectContaining({ saveSettings: false, saveChat: false }));
    expect(h.clearTemplate).toHaveBeenCalledWith(expect.objectContaining({ save: false }));
    expect(h.applyTemplate).toHaveBeenCalledWith('{}', expect.objectContaining({ save: false, scope: 'global', persistChatScope: false }));
    expect(h.saveSettings).toHaveBeenCalled();
    expect(h.saveChat).toHaveBeenCalled();
    expect(h.loadOrCreate).toHaveBeenCalled();
    expect(h.refresh).toHaveBeenCalled();
    expect(result.completedSteps).toEqual(expect.arrayContaining([
      'prompts', 'table_order', 'table_locks', 'plot_snapshots',
      'template_snapshots', 'template', 'settings_persist', 'chat_persist', 'derived_refresh',
    ]));
  });

  it('settings 保存失败且未发生外部持久化时回滚并标记 compensated', async () => {
    h.saveSettings.mockReturnValue({ saved: false, storageType: 'memory', code: 'settings_loading', warning: 'not ready' });

    const result = await resetAllDefaults_ACU({
      restoreTemplateAndPrompts: false,
      clearTemplateSnapshots: false,
      clearPlotSnapshots: false,
      clearTableLocks: true,
      clearTableOrder: true,
    });

    expect(result.success).toBe(false);
    expect(h.restore).toHaveBeenCalled();
    expect(result.failures.find(f => f.step === 'settings_persist')?.compensated).toBe(true);
    expect(h.saveChat).not.toHaveBeenCalled();
  });

  it('模板已提交到 profile/聊天后再保存 settings 失败时不回滚已持久化状态', async () => {
    h.saveSettings.mockReturnValue({ saved: false, storageType: 'memory', code: 'storage_error', error: 'write failed' });

    const result = await resetAllDefaults_ACU({
      restoreTemplateAndPrompts: true,
      clearTemplateSnapshots: false,
      clearPlotSnapshots: false,
      clearTableLocks: false,
      clearTableOrder: false,
    });

    expect(result.success).toBe(false);
    expect(h.applyTemplate).toHaveBeenCalled();
    expect(h.restore).not.toHaveBeenCalled();
    expect(result.failures.find(f => f.step === 'settings_persist')?.compensated).toBe(false);
  });

  it('聊天清理保存失败返回部分持久化失败与可诊断警告', async () => {
    h.saveChat.mockRejectedValue(new Error('host save failed'));

    const result = await resetAllDefaults_ACU({
      restoreTemplateAndPrompts: false,
      clearTemplateSnapshots: true,
      clearPlotSnapshots: false,
      clearTableLocks: false,
      clearTableOrder: false,
    });

    expect(result.success).toBe(false);
    expect(result.failures.find(f => f.step === 'chat_persist')?.compensated).toBe(false);
    expect(result.warnings.some(w => w.includes('聊天保存失败'))).toBe(true);
  });

  it('已提交后派生刷新失败不伪造整体未变', async () => {
    h.refresh.mockRejectedValue(new Error('refresh boom'));

    const result = await resetAllDefaults_ACU({
      restoreTemplateAndPrompts: false,
      clearTemplateSnapshots: false,
      clearPlotSnapshots: false,
      clearTableLocks: false,
      clearTableOrder: true,
    });

    expect(result.success).toBe(false);
    expect(result.completedSteps).toContain('settings_persist');
    expect(result.failures.find(f => f.step === 'derived_refresh')?.compensated).toBe(false);
  });
});
