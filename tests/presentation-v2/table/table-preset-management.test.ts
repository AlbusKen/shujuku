/**
 * useTablePresetManagement — 表格模板预设管理行为
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

async function importManagement() {
  vi.resetModules();
  const deleteTemplatePreset = vi.fn(() => true);
  const applyTemplatePresetToCurrent = vi.fn(async () => ({ presetName: '', isDefault: true }));
  const openVisualizerSurface = vi.fn(async () => true);
  const ensureTemplateRecoveryOrDeleteCurrentIsolationData = vi.fn(async () => ({ success: true, dataWasReset: false }));
  let activeTemplateMode = 'inherit_global';
  const promptFollowGlobalAfterSetDefault = vi.fn(async () => true);
  const runFollowGlobalTemplateFlow = vi.fn(async () => true);
  let runtimeSnapshot: any = { templateStr: '{"sheet_a":{"name":"运行时"}}', templateObj: { sheet_a: { name: '运行时' } } };
  const resolveTemplateForExport = vi.fn((scope: string, name?: string) => ({
    jsonData: { sheet_a: { name: scope === 'runtime' ? '运行时' : name || 'global-A' } },
    fromPresetName: scope === 'runtime' ? 'global-A' : (name || 'global-A'),
  }));

  vi.doMock('../../../src/service/template/template-preset-service', () => ({
    applyTemplatePresetToCurrent_ACU: applyTemplatePresetToCurrent,
    deleteTemplatePreset_ACU: deleteTemplatePreset,
    ensureUniqueTemplatePresetName_ACU: (name: string) => name,
    getActiveTemplatePresetMeta_ACU: () => ({ presetName: 'global-A', scope: activeTemplateMode === 'chat_override' ? 'chat' : 'global', mode: activeTemplateMode }),
    getDefaultTemplateSnapshot_ACU: () => ({ templateStr: '{"mate":{"type":"chatSheets"},"sheet_a":{"name":"A","content":[],"sourceData":{}}}' }),
    getRuntimeTemplateSnapshot_ACU: () => runtimeSnapshot,
    getTemplatePreset_ACU: () => ({ templateStr: '{}' }),
    listTemplatePresetNames_ACU: () => ['global-A', 'global-B'],
    resolveActiveTemplatePresetName_ACU: () => 'global-A',
    resolveTemplateForExport_ACU: resolveTemplateForExport,
    upsertTemplatePreset_ACU: vi.fn(() => true),
  }));
  vi.doMock('../../../src/service/template/chat-scope', () => ({
    sanitizeChatSheetsObject_ACU: (value: any) => value,
  }));
  vi.doMock('../../../src/shared/template-preset-utils', () => ({
    sanitizeFilenameComponent_ACU: (value: string) => value,
    normalizeTemplatePresetSelectionValue_ACU: (value: unknown) => String(value ?? '').trim(),
    getCurrentTemplatePresetName_ACU: () => 'global-A',
  }));
  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    settings_ACU: { currentTemplatePresetName: 'global-A' },
  }));
  vi.doMock('../../../src/presentation-v2/composables/useTemplateRecoveryGuard', () => ({
    ensureTemplateRecoveryOrDeleteCurrentIsolationData_ACU: ensureTemplateRecoveryOrDeleteCurrentIsolationData,
  }));
  vi.doMock('../../../src/service/template/chat-scope', () => ({
    sanitizeChatSheetsObject_ACU: (value: any) => value,
    buildChatSheetGuideDataFromTemplateObj_ACU: (value: any) => value ? { sheets: {} } : null,
  }));
  vi.doMock('../../../src/presentation-v2/surfaces/visualizer/open-visualizer-surface', () => ({
    openVisualizerSurface_ACU: openVisualizerSurface,
  }));
  vi.doMock('../../../src/presentation-v2/composables/templateFollowGlobalFlow', () => ({
    promptFollowGlobalAfterSetDefault_ACU: promptFollowGlobalAfterSetDefault,
    runFollowGlobalTemplateFlow_ACU: runFollowGlobalTemplateFlow,
  }));

  const { createPinia, setActivePinia } = await import('pinia');
  setActivePinia(createPinia());
  const { useTablePresetManagement } = await import('../../../src/presentation-v2/composables/useTablePresetManagement');
  return {
    management: useTablePresetManagement(),
    deleteTemplatePreset,
    applyTemplatePresetToCurrent,
    openVisualizerSurface,
    resolveTemplateForExport,
    ensureTemplateRecoveryOrDeleteCurrentIsolationData,
    promptFollowGlobalAfterSetDefault,
    runFollowGlobalTemplateFlow,
    setRuntimeSnapshot: (value: any) => { runtimeSnapshot = value; },
    setActiveTemplateMode: (mode: string) => { activeTemplateMode = mode; },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useTablePresetManagement', () => {
  it('删除当前选中预设后，将全局默认和当前聊天回退到默认预设', async () => {
    const { management, deleteTemplatePreset, applyTemplatePresetToCurrent } = await importManagement();

    const promise = management.deletePreset('global-A');
    const { useDialogStore } = await import('../../../src/presentation-v2/stores/dialog-store');
    const dialog = useDialogStore();
    expect(dialog.active?.message).toContain('确定要删除全局模板预设「global-A」吗？');
    dialog.submitActive();
    await promise;

    expect(deleteTemplatePreset).toHaveBeenCalledWith('global-A');
    expect(applyTemplatePresetToCurrent).toHaveBeenCalledWith('', expect.objectContaining({
      updateGlobal: true,
      persistChatScope: false,
    }));
    expect(applyTemplatePresetToCurrent).toHaveBeenCalledWith('', expect.objectContaining({
      updateGlobal: false,
      persistChatScope: true,
    }));
  });

  it('从 v2 表格模板面板打开 v2 visualizer，不走旧 AutoCardUpdaterAPI', async () => {
    const { management, openVisualizerSurface } = await importManagement();

    await management.openVisualizer();

    expect(openVisualizerSurface).toHaveBeenCalledWith({ source: 'v2-shell' });
  });

  it('编辑指定预设时先切换聊天预设，再打开 v2 visualizer', async () => {
    const { management, applyTemplatePresetToCurrent, openVisualizerSurface } = await importManagement();

    await management.editPreset('global-B');

    expect(applyTemplatePresetToCurrent).toHaveBeenCalledWith('global-B', expect.objectContaining({
      source: 'v2_table_drawer_edit',
      persistChatScope: true,
    }));
    expect(openVisualizerSurface).toHaveBeenCalledWith({ source: 'v2-shell' });
  });

  it('聊天预设切换返回 saved=false 时不打开 visualizer 且显示真实错误', async () => {
    const { management, applyTemplatePresetToCurrent, openVisualizerSurface } = await importManagement();
    applyTemplatePresetToCurrent.mockResolvedValueOnce({ saved: false, error: '目标聊天已切换，已取消模板提交。' });

    await management.editPreset('global-B');

    expect(openVisualizerSurface).not.toHaveBeenCalled();
    const { useToastStore } = await import('../../../src/presentation-v2/stores/toast-store');
    expect(useToastStore().items.at(-1)).toMatchObject({ kind: 'error', text: '目标聊天已切换，已取消模板提交。' });
  });

  it('聊天预设已保存但 runtime 不可用时显示警告且不打开 visualizer', async () => {
    const { management, applyTemplatePresetToCurrent, openVisualizerSurface } = await importManagement();
    applyTemplatePresetToCurrent.mockResolvedValueOnce({
      saved: true,
      runtimeReady: false,
      postCommitWarning: '模板已保存，但 SQLite 运行时重建失败。',
    });

    await management.editPreset('global-B');

    expect(openVisualizerSurface).not.toHaveBeenCalled();
    const { useToastStore } = await import('../../../src/presentation-v2/stores/toast-store');
    expect(useToastStore().items.at(-1)).toMatchObject({ kind: 'warning', text: '模板已保存，但 SQLite 运行时重建失败。' });
  });

  it('删除活跃预设前聊天回退失败时保留预设且不报告成功', async () => {
    const { management, deleteTemplatePreset, applyTemplatePresetToCurrent } = await importManagement();
    applyTemplatePresetToCurrent
      .mockResolvedValueOnce({ presetName: '', isDefault: true })
      .mockResolvedValueOnce({ saved: false, error: '目标聊天已切换，已取消模板提交。' });

    const promise = management.deletePreset('global-A');
    const { useDialogStore } = await import('../../../src/presentation-v2/stores/dialog-store');
    useDialogStore().submitActive();
    await promise;

    expect(deleteTemplatePreset).not.toHaveBeenCalled();
    const { useToastStore } = await import('../../../src/presentation-v2/stores/toast-store');
    expect(useToastStore().items.at(-1)).toMatchObject({ kind: 'error', text: '目标聊天已切换，已取消模板提交。' });
  });

  it('presetMeta 列表首位包含 runtime 只读项', async () => {
    const { management } = await importManagement();
    expect(management.presetMeta.value[0]).toMatchObject({
      name: '__runtime__',
      kind: 'runtime',
      readOnly: true,
    });
    expect(management.presetMeta.value.map(item => item.name)).toEqual(['__runtime__', 'global-A', 'global-B']);
  });

  it('exportPreset 对 runtime 项以 runtime scope 解析，文件名为 runtime 前缀', async () => {
    const { management, resolveTemplateForExport } = await importManagement();
    const toast = (await import('../../../src/presentation-v2/stores/toast-store')).useToastStore();
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });

    management.exportPreset('__runtime__');

    expect(resolveTemplateForExport).toHaveBeenCalledWith('runtime');
    expect(toast.items.at(-1)).toMatchObject({ kind: 'success', text: '当前生效模板已导出。' });
  });

  it('deletePreset / renamePreset / setAsDefault 拒绝 runtime 哨兵名', async () => {
    const { management, deleteTemplatePreset } = await importManagement();
    const toast = (await import('../../../src/presentation-v2/stores/toast-store')).useToastStore();

    await management.deletePreset('__runtime__');
    expect(deleteTemplatePreset).not.toHaveBeenCalled();
    expect(toast.items.at(-1)).toMatchObject({ kind: 'warning', text: '当前生效模板是只读运行时条目，不能删除。' });

    await management.renamePreset('__runtime__');
    expect(toast.items.at(-1)).toMatchObject({ kind: 'warning', text: '当前生效模板是只读运行时条目，不能重命名。' });

    await management.setAsDefault('__runtime__');
    expect(toast.items.at(-1)).toMatchObject({ kind: 'warning', text: '当前生效模板不是全局预设，不能设为默认。' });
  });

  it('editPreset 在恢复守卫失败时不调用切换', async () => {
    const { management, applyTemplatePresetToCurrent, ensureTemplateRecoveryOrDeleteCurrentIsolationData } = await importManagement();
    ensureTemplateRecoveryOrDeleteCurrentIsolationData.mockResolvedValueOnce({ success: false, dataWasReset: false });

    await management.editPreset('global-B');

    expect(applyTemplatePresetToCurrent).not.toHaveBeenCalled();
  });

  it('setAsDefault 时当前聊天有覆盖 → 触发清覆盖确认；无覆盖 → 不触发', async () => {
    const { management, setActiveTemplateMode, promptFollowGlobalAfterSetDefault } = await importManagement();

    await management.setAsDefault('global-B');
    expect(promptFollowGlobalAfterSetDefault).not.toHaveBeenCalled();

    setActiveTemplateMode('chat_override');
    await management.setAsDefault('global-B');
    expect(promptFollowGlobalAfterSetDefault).toHaveBeenCalledOnce();
    expect(promptFollowGlobalAfterSetDefault).toHaveBeenCalledWith(expect.objectContaining({ newDefaultName: 'global-B' }));
  });

  it('editPreset 出现破坏性 blockers 时经确认后重试', async () => {
    const { management, applyTemplatePresetToCurrent } = await importManagement();
    const { useDialogStore } = await import('../../../src/presentation-v2/stores/dialog-store');
    applyTemplatePresetToCurrent
      .mockResolvedValueOnce({ saved: false, blockers: ['删除表「旧表」需要显式确认。'], error: '删除表「旧表」需要显式确认。' })
      .mockResolvedValueOnce({ saved: true, mode: 'v2_commit' });

    const pending = management.editPreset('global-B');
    await new Promise(r => setTimeout(r, 0));
    useDialogStore().submitActive();
    await pending;

    expect(applyTemplatePresetToCurrent).toHaveBeenNthCalledWith(1, 'global-B', expect.objectContaining({ destructiveChangeConfirmed: false }));
    expect(applyTemplatePresetToCurrent).toHaveBeenNthCalledWith(2, 'global-B', expect.objectContaining({ destructiveChangeConfirmed: true }));
  });

  it('setAsDefault 全局切换出现破坏性 blockers 时经确认后重试（S1-3）', async () => {
    const { management, applyTemplatePresetToCurrent } = await importManagement();
    const { useDialogStore } = await import('../../../src/presentation-v2/stores/dialog-store');
    applyTemplatePresetToCurrent
      .mockResolvedValueOnce({ saved: false, blockers: ['删除列「HP」需要显式确认。'], error: '删除列「HP」需要显式确认。' })
      .mockResolvedValueOnce({ saved: true });

    const pending = management.setAsDefault('global-B');
    await new Promise(r => setTimeout(r, 0));
    useDialogStore().submitActive();
    await pending;

    expect(applyTemplatePresetToCurrent).toHaveBeenNthCalledWith(1, 'global-B', expect.objectContaining({
      updateGlobal: true,
      destructiveChangeConfirmed: false,
    }));
    expect(applyTemplatePresetToCurrent).toHaveBeenNthCalledWith(2, 'global-B', expect.objectContaining({
      updateGlobal: true,
      destructiveChangeConfirmed: true,
    }));
    const { useToastStore } = await import('../../../src/presentation-v2/stores/toast-store');
    expect(useToastStore().items.at(-1)).toMatchObject({ kind: 'success', text: '「global-B」已设为全局默认。' });
  });

  it('setAsDefault 协调失败（saved:false）时显示真实错误且不误报成功（S1-3）', async () => {
    const { management, applyTemplatePresetToCurrent, promptFollowGlobalAfterSetDefault } = await importManagement();
    applyTemplatePresetToCurrent.mockResolvedValueOnce({ saved: false, error: '目标聊天已切换，已取消模板提交。' });

    await management.setAsDefault('global-B');

    const { useToastStore } = await import('../../../src/presentation-v2/stores/toast-store');
    expect(useToastStore().items.at(-1)).toMatchObject({ kind: 'error', text: '目标聊天已切换，已取消模板提交。' });
    expect(useToastStore().items.some(item => item.kind === 'success')).toBe(false);
    expect(promptFollowGlobalAfterSetDefault).not.toHaveBeenCalled();
  });
});
