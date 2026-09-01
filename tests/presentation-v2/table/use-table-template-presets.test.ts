/**
 * useTableTemplatePresets — 表格模板预设状态语义
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

async function importComposable() {
  vi.resetModules();
  let selectedGlobal = 'global-A';
  let selectedChat = 'global-A';
  let activeScope: 'global' | 'chat' = 'global';
  let activeMode = 'inherit_global';
  let archiveEntries: any[] = [];
  let runtimeSnapshot: any = { templateStr: '{"sheet_1":{"name":"运行时"}}', templateObj: { sheet_1: { name: '运行时' } } };
  // S3-8：聊天快照串与库预设串默认一致（无偏离标记），各用例可通过 setter 制造偏离。
  let chatSnapshotStr = '{"sheet_1":{}}';
  let libraryPresetStr: string | null = '{"sheet_1":{}}';
  const applyTemplateSnapshotToScope_ACU = vi.fn(async () => ({ saved: true, presetName: selectedChat }));
  const applyTemplatePresetToCurrent_ACU = vi.fn(async () => ({ saved: true, presetName: selectedChat }));
  const resolveTemplateForExport_ACU = vi.fn(() => ({ jsonData: { sheet_1: {} }, fromPresetName: selectedChat || '默认预设' }));
  const ensureTemplateRecoveryOrDeleteCurrentIsolationData_ACU = vi.fn(async () => ({ success: true, dataWasReset: false }));
  const promptFollowGlobalAfterSetDefault_ACU = vi.fn(async () => true);
  const runFollowGlobalTemplateFlow_ACU = vi.fn(async () => true);

  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    settings_ACU: {},
  }));
  vi.doMock('../../../src/service/table/storage-mode', () => ({
    isSqliteMode: () => false,
  }));
  vi.doMock('../../../src/service/table/table-storage-strategy', () => ({
    reloadStorageProvider: vi.fn(async () => undefined),
  }));
  vi.doMock('../../../src/presentation-v2/composables/useTemplateRecoveryGuard', () => ({
    ensureTemplateRecoveryOrDeleteCurrentIsolationData_ACU,
  }));
  vi.doMock('../../../src/presentation-v2/composables/templateFollowGlobalFlow', () => ({
    promptFollowGlobalAfterSetDefault_ACU,
    runFollowGlobalTemplateFlow_ACU,
  }));
  vi.doMock('../../../src/service/template/chat-scope', () => ({
    buildChatSheetGuideDataFromTemplateObj_ACU: (value: any) => value ? { sheet_1: value.sheet_1 || {} } : null,
    getCurrentChatTemplateScopeState_ACU: () => activeMode === 'chat_override'
      ? { mode: 'chat_override', presetName: selectedChat, templateStr: chatSnapshotStr, guideData: { sheet_1: {} } }
      : null,
    listChatTemplateArchiveEntries_ACU: () => archiveEntries,
    sanitizeChatSheetsObject_ACU: (value: any) => value,
    // 忠实复刻同构化语义：解析后重新序列化，两侧串在内容相同时必然相等。
    sanitizeTemplateSnapshotForChat_ACU: (value: any) => {
      if (!value) return null;
      try {
        const obj = typeof value === 'string' ? JSON.parse(value) : value;
        return obj && typeof obj === 'object' ? { templateObj: obj, templateStr: JSON.stringify(obj) } : null;
      } catch {
        return null;
      }
    },
  }));
  vi.doMock('../../../src/shared/template-preset-utils', () => ({
    getCurrentTemplatePresetName_ACU: () => selectedGlobal,
    normalizeTemplatePresetSelectionValue_ACU: (value: string) => String(value || '').trim(),
    sanitizeFilenameComponent_ACU: (value: string) => String(value || '').trim(),
    deriveTemplatePresetNameForImport_ACU: () => '导入模板',
  }));
  vi.doMock('../../../src/service/template/template-preset-service', () => ({
    applyTemplateSnapshotToScope_ACU,
    applyTemplatePresetToCurrent_ACU,
    deleteTemplatePreset_ACU: vi.fn(() => true),
    getActiveTemplatePresetMeta_ACU: () => ({ presetName: selectedChat, scope: activeScope, mode: activeMode }),
    ensureUniqueTemplatePresetName_ACU: (name: string) => name,
    getDefaultTemplateSnapshot_ACU: () => ({ templateObj: { sheet_1: {} }, templateStr: '{"sheet_1":{}}' }),
    getRuntimeTemplateSnapshot_ACU: () => runtimeSnapshot,
    getTemplatePreset_ACU: () => (libraryPresetStr != null ? { templateStr: libraryPresetStr } : null),
    listTemplatePresetNames_ACU: () => ['global-A', 'chat-A'],
    normalizeTemplateForPresetSave_ACU: () => ({ templateStr: '{"sheet_1":{}}' }),
    parseImportedTemplateData_ACU: () => ({ templateObj: { sheet_1: {} }, templateStr: '{"sheet_1":{}}' }),
    resolveActiveTemplatePresetName_ACU: () => selectedChat,
    resolveTemplateForExport_ACU,
    upsertTemplatePreset_ACU: vi.fn(() => true),
  }));

  const { createPinia, setActivePinia } = await import('pinia');
  setActivePinia(createPinia());
  const [{ useTableTemplatePresets }, { useToastStore }, { useDialogStore }] = await Promise.all([
    import('../../../src/presentation-v2/composables/useTableTemplatePresets'),
    import('../../../src/presentation-v2/stores/toast-store'),
    import('../../../src/presentation-v2/stores/dialog-store'),
  ]);
  return {
    useTableTemplatePresets,
    toast: useToastStore(),
    dialog: useDialogStore(),
    applyTemplateSnapshotToScope_ACU,
    applyTemplatePresetToCurrent_ACU,
    resolveTemplateForExport_ACU,
    ensureTemplateRecoveryOrDeleteCurrentIsolationData_ACU,
    promptFollowGlobalAfterSetDefault_ACU,
    runFollowGlobalTemplateFlow_ACU,
    setSelectedGlobal: (value: string) => { selectedGlobal = value; },
    setSelectedChat: (value: string) => { selectedChat = value; },
    setActiveScope: (value: 'global' | 'chat') => { activeScope = value; activeMode = value === 'chat' ? 'chat_override' : 'inherit_global'; },
    setActiveMode: (value: string) => { activeMode = value; activeScope = value === 'inherit_global' ? 'global' : 'chat'; },
    setChatEntries: (value: any[]) => { archiveEntries = value; },
    setRuntimeSnapshot: (value: any) => { runtimeSnapshot = value; },
    setRuntimeAvailable: (available: boolean) => { runtimeSnapshot = available ? { templateStr: '{"sheet_1":{"name":"运行时"}}', templateObj: { sheet_1: { name: '运行时' } } } : null; },
    setChatSnapshotStr: (value: string) => { chatSnapshotStr = value; },
    setLibraryPresetStr: (value: string | null) => { libraryPresetStr = value; },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:test'),
    revokeObjectURL: vi.fn(),
  });
});

describe('useTableTemplatePresets', () => {
  it('isChatOverridden 按实际聊天作用域判断，同名快照也算覆盖', async () => {
    const { useTableTemplatePresets, setSelectedChat, setSelectedGlobal, setActiveScope } = await importComposable();
    const presets = useTableTemplatePresets();

    expect(presets.isChatOverridden.value).toBe(false);

    setActiveScope('chat');
    setSelectedChat('chat-A');
    presets.refresh();
    expect(presets.isChatOverridden.value).toBe(true);

    setSelectedChat('global-A');
    presets.refresh();
    expect(presets.isChatOverridden.value).toBe(true);

    setActiveScope('global');
    setSelectedGlobal('');
    setSelectedChat('');
    presets.refresh();
    expect(presets.isChatOverridden.value).toBe(false);
  });

  it('主下拉只显示全局预设和当前聊天快照，不显示历史归档', async () => {
    const { useTableTemplatePresets, setChatEntries, setSelectedChat, setActiveMode } = await importComposable();
    setChatEntries([{ archiveKey: 'archive-B', presetName: 'chat-B', templateStr: '{"sheet_1":{"name":"历史归档"}}', label: 'chat-B（聊天历史快照）' }]);
    setSelectedChat('global-A');
    setActiveMode('chat_override');

    const presets = useTableTemplatePresets();
    const labels = presets.chatPresetItems.value.map(item => item.label);

    expect(labels).toContain('global-A（全局预设）');
    expect(labels).toContain('global-A（当前聊天快照）');
    expect(labels).not.toContain('chat-B（当前聊天快照）');
    expect(presets.chatArchiveItems.value.map(item => item.label)).toContain('chat-B（聊天历史快照）');
    expect(presets.selectedChatPresetLabel.value).toBe('global-A（当前聊天快照）');
  });

  it('默认聊天快照保留空 presetName，不回退旧全局预设名称', async () => {
    const { useTableTemplatePresets, setSelectedChat, setSelectedGlobal, setActiveMode } = await importComposable();
    setSelectedGlobal('global-A');
    setSelectedChat('');
    setActiveMode('chat_override');

    const presets = useTableTemplatePresets();

    expect(presets.selectedChatPreset.value).toBe('snapshot:');
    expect(presets.selectedChatPresetLabel.value).toBe('默认预设（当前聊天快照）');
    expect(presets.chatPresetItems.value).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'snapshot:', label: '默认预设（当前聊天快照）' }),
    ]));
  });

  it('S3-8：快照内容与库中同名预设一致时无偏离标记', async () => {
    const { useTableTemplatePresets, setSelectedChat, setActiveMode } = await importComposable();
    setSelectedChat('global-A');
    setActiveMode('chat_override');

    const presets = useTableTemplatePresets();

    expect(presets.chatSnapshotDiffersFromLibrary.value).toBe(false);
    expect(presets.selectedChatPresetLabel.value).toBe('global-A（当前聊天快照）');
  });

  it('S3-8：快照内容偏离库中同名预设时标签带偏离后缀且 ref 为 true', async () => {
    const { useTableTemplatePresets, setSelectedChat, setActiveMode, setChatSnapshotStr } = await importComposable();
    setSelectedChat('global-A');
    setActiveMode('chat_override');
    setChatSnapshotStr('{"sheet_1":{"name":"用户改过的结构"}}');

    const presets = useTableTemplatePresets();

    expect(presets.chatSnapshotDiffersFromLibrary.value).toBe(true);
    expect(presets.selectedChatPresetLabel.value).toBe('global-A（当前聊天快照）（内容已偏离库预设）');
  });

  it('S3-8：库中同名预设已删除时 meta 标注且 ref 为 true，标签不带偏离后缀', async () => {
    const { useTableTemplatePresets, setSelectedChat, setActiveMode, setLibraryPresetStr } = await importComposable();
    setSelectedChat('global-A');
    setActiveMode('chat_override');
    setLibraryPresetStr(null);

    const presets = useTableTemplatePresets();

    expect(presets.chatSnapshotDiffersFromLibrary.value).toBe(true);
    const snapshotItem = presets.chatPresetItems.value.find(item => item.value === 'snapshot:global-A');
    expect(snapshotItem?.label).toBe('global-A（当前聊天快照）');
    expect(snapshotItem?.meta).toContain('库中已无同名预设');
  });

  it('S3-8：默认预设快照与全局默认快照比较，偏离时同样标记', async () => {
    const { useTableTemplatePresets, setSelectedChat, setActiveMode, setChatSnapshotStr } = await importComposable();
    setSelectedChat('');
    setActiveMode('chat_override');
    setChatSnapshotStr('{"sheet_1":{"name":"偏离默认"}}');

    const presets = useTableTemplatePresets();

    expect(presets.chatSnapshotDiffersFromLibrary.value).toBe(true);
    expect(presets.selectedChatPresetLabel.value).toBe('默认预设（当前聊天快照）（内容已偏离库预设）');
  });

  it('S3-8：非 chat_override 模式下偏离 ref 恒为 false', async () => {
    const { useTableTemplatePresets, setChatSnapshotStr } = await importComposable();
    setChatSnapshotStr('{"sheet_1":{"name":"偏离也无效"}}');

    const presets = useTableTemplatePresets();

    expect(presets.chatSnapshotDiffersFromLibrary.value).toBe(false);
  });

  it('选择同名全局项时按全局来源切换，不被本地快照抢占', async () => {
    const { useTableTemplatePresets, applyTemplatePresetToCurrent_ACU, setChatEntries } = await importComposable();
    setChatEntries([{ presetName: 'global-A', templateStr: '{"sheet_1":{"name":"本地"}}' }]);
    const presets = useTableTemplatePresets();
    const globalItem = presets.chatPresetItems.value.find(item => item.label === 'global-A（全局预设）');

    await presets.selectChatPreset(globalItem!.value);

    expect(applyTemplatePresetToCurrent_ACU).toHaveBeenCalledWith('global-A', expect.objectContaining({
      updateGlobal: false,
      chatSelectionSource: 'global',
    }));
  });

  it('切换当前聊天模板前使用统一恢复 guard，guard 取消时不切换', async () => {
    const { useTableTemplatePresets, applyTemplatePresetToCurrent_ACU, ensureTemplateRecoveryOrDeleteCurrentIsolationData_ACU } = await importComposable();
    const presets = useTableTemplatePresets();
    ensureTemplateRecoveryOrDeleteCurrentIsolationData_ACU.mockResolvedValueOnce({ success: false, dataWasReset: false });

    await presets.selectChatPreset('chat-A');

    expect(ensureTemplateRecoveryOrDeleteCurrentIsolationData_ACU).toHaveBeenCalledWith(expect.any(Object), 'switch-template');
    expect(applyTemplatePresetToCurrent_ACU).not.toHaveBeenCalled();
  });

  it('聊天模板切换进行中拒绝第二次重入，不并发生成第二个协调请求', async () => {
    const { useTableTemplatePresets, applyTemplatePresetToCurrent_ACU } = await importComposable();
    const presets = useTableTemplatePresets();
    let resolveFirst!: (value: any) => void;
    applyTemplatePresetToCurrent_ACU.mockImplementationOnce(() => new Promise(resolve => {
      resolveFirst = resolve;
    }));

    const first = presets.selectChatPreset('chat-A');
    await vi.waitFor(() => expect(applyTemplatePresetToCurrent_ACU).toHaveBeenCalledOnce());
    const second = presets.selectChatPreset('global-A');
    await second;

    expect(applyTemplatePresetToCurrent_ACU).toHaveBeenCalledOnce();
    expect(presets.busy.value).toBe(true);

    resolveFirst({ saved: true, mode: 'v2_commit' });
    await first;
    expect(presets.busy.value).toBe(false);
  });

  it('聊天模板切换被破坏性变更阻断时，经明确确认后以 destructiveChangeConfirmed 重试', async () => {
    const { useTableTemplatePresets, dialog, applyTemplatePresetToCurrent_ACU } = await importComposable();
    const presets = useTableTemplatePresets();
    applyTemplatePresetToCurrent_ACU
      .mockResolvedValueOnce({ saved: false, blockers: ['删除表「旧表」需要显式确认。'], error: '删除表「旧表」需要显式确认。' })
      .mockResolvedValueOnce({ saved: true, mode: 'v2_commit' });

    const pending = presets.selectChatPreset('chat-A');
    await vi.waitFor(() => expect(dialog.active).toMatchObject({
      kind: 'confirm',
      title: '确认破坏性模板变更',
      confirmVariant: 'danger',
    }));
    dialog.submitActive();
    await pending;

    expect(applyTemplatePresetToCurrent_ACU).toHaveBeenNthCalledWith(1, 'chat-A', expect.objectContaining({
      destructiveChangeConfirmed: false,
    }));
    expect(applyTemplatePresetToCurrent_ACU).toHaveBeenNthCalledWith(2, 'chat-A', expect.objectContaining({
      destructiveChangeConfirmed: true,
    }));
  });

  it('拒绝破坏性变更确认时不重试模板切换', async () => {
    const { useTableTemplatePresets, dialog, applyTemplatePresetToCurrent_ACU } = await importComposable();
    const presets = useTableTemplatePresets();
    applyTemplatePresetToCurrent_ACU.mockResolvedValueOnce({ saved: false, blockers: ['删除列「旧列」需要显式确认。'], error: '删除列「旧列」需要显式确认。' });

    const pending = presets.selectChatPreset('chat-A');
    await vi.waitFor(() => expect(dialog.active?.kind).toBe('confirm'));
    dialog.cancelActive();
    await pending;

    expect(applyTemplatePresetToCurrent_ACU).toHaveBeenCalledOnce();
    expect(presets.message.value).toMatchObject({ kind: 'error', text: '删除列「旧列」需要显式确认。' });
  });

  it('恢复历史归档通过单独对话框选择，并恢复选中的归档', async () => {
    const { useTableTemplatePresets, dialog, applyTemplateSnapshotToScope_ACU, setChatEntries } = await importComposable();
    setChatEntries([{ archiveKey: 'archive-B', presetName: 'chat-B', templateStr: '{"sheet_1":{"name":"历史归档"}}', label: 'chat-B（聊天历史快照）' }]);
    const presets = useTableTemplatePresets();

    const pending = presets.restoreArchivedChatTemplate();
    await Promise.resolve();
    expect(dialog.active?.kind).toBe('choice');
    dialog.submitActive('archive-B');
    await pending;

    expect(applyTemplateSnapshotToScope_ACU).toHaveBeenCalledWith(
      '{"sheet_1":{"name":"历史归档"}}',
      expect.objectContaining({
        scope: 'chat',
        source: 'v2_table_chat_archive_restore',
        presetName: 'chat-B',
        registerChatPresetEntry: false,
      }),
    );
  });

  it('模板已保存但 SQLite 重建失败时显示警告而不是成功提示', async () => {
    const { useTableTemplatePresets, toast, applyTemplatePresetToCurrent_ACU } = await importComposable();
    const presets = useTableTemplatePresets();
    applyTemplatePresetToCurrent_ACU.mockResolvedValueOnce({
      saved: true,
      runtimeReady: false,
      postCommitWarning: '模板已保存，但 SQLite 运行时重建失败。',
    });

    await presets.selectChatPreset('chat-A');

    expect(toast.items.at(-1)).toMatchObject({ kind: 'warning', text: '模板已保存，但 SQLite 运行时重建失败。' });
  });

  it('stale revision 时只重新读取并重试一次，成功后不显示错误', async () => {
    const { useTableTemplatePresets, toast, applyTemplatePresetToCurrent_ACU } = await importComposable();
    const presets = useTableTemplatePresets();
    applyTemplatePresetToCurrent_ACU
      .mockResolvedValueOnce({ saved: false, error: 'V2 stale_revision_conflict: runtime revision conflict' })
      .mockResolvedValueOnce({ saved: true, mode: 'v2_commit' });

    await presets.selectChatPreset('chat-A');

    expect(applyTemplatePresetToCurrent_ACU).toHaveBeenCalledTimes(2);
    expect(applyTemplatePresetToCurrent_ACU).toHaveBeenNthCalledWith(1, 'chat-A', expect.objectContaining({
      destructiveChangeConfirmed: false,
    }));
    expect(applyTemplatePresetToCurrent_ACU).toHaveBeenNthCalledWith(2, 'chat-A', expect.objectContaining({
      destructiveChangeConfirmed: false,
    }));
    expect(presets.message.value).toBeNull();
    expect(toast.items.some(item => item.kind === 'error')).toBe(false);
  });

  it('连续 stale revision 在一次重试后停止，并给出可操作提示', async () => {
    const { useTableTemplatePresets, toast, applyTemplatePresetToCurrent_ACU } = await importComposable();
    const presets = useTableTemplatePresets();
    applyTemplatePresetToCurrent_ACU
      .mockResolvedValueOnce({ saved: false, error: 'V2 stale_revision_conflict: runtime revision conflict' })
      .mockResolvedValueOnce({ saved: false, error: 'V2 stale_revision_conflict: runtime revision conflict' });

    await presets.selectChatPreset('chat-A');

    const expected = '表格状态在提交时已更新；系统重新读取后仍无法完成切换。请刷新当前聊天后重试。';
    expect(applyTemplatePresetToCurrent_ACU).toHaveBeenCalledTimes(2);
    expect(presets.message.value).toMatchObject({ kind: 'error', text: expected });
    expect(toast.items.at(-1)).toMatchObject({ kind: 'error', text: expected });
  });

  it.each([
    ['V2 history_indeterminate: sheetKey=sheet_a', '表格历史状态不完整或顺序异常，已拒绝覆盖数据。请先在数据管理中检查并恢复 V2 历史后重试。'],
    ['V2 reveal_source_missing: sheetKey=sheet_a', '历史表的可信恢复来源不可用，已拒绝写入。请先在数据管理中检查并恢复 V2 历史后重试。'],
  ])('历史恢复错误不自动重试，并展示可操作提示', async (error, expected) => {
    const { useTableTemplatePresets, toast, applyTemplatePresetToCurrent_ACU } = await importComposable();
    const presets = useTableTemplatePresets();
    applyTemplatePresetToCurrent_ACU.mockResolvedValueOnce({ saved: false, error });

    await presets.selectChatPreset('chat-A');

    expect(applyTemplatePresetToCurrent_ACU).toHaveBeenCalledOnce();
    expect(presets.message.value).toMatchObject({ kind: 'error', text: expected });
    expect(toast.items.at(-1)).toMatchObject({ kind: 'error', text: expected });
  });

  it('操作失败时保留局部错误并显示短 toast', async () => {
    const { useTableTemplatePresets, toast, applyTemplatePresetToCurrent_ACU } = await importComposable();
    const presets = useTableTemplatePresets();
    applyTemplatePresetToCurrent_ACU.mockResolvedValueOnce(null as any);

    await presets.selectGlobalPreset('broken');

    expect(presets.message.value).toMatchObject({
      kind: 'error',
      text: '全局模板预设切换失败。',
    });
    expect(toast.items.at(-1)).toMatchObject({
      kind: 'error',
      text: '全局模板预设切换失败。',
    });
  });

  it('导出无法解析当前模板时显示短 toast', async () => {
    const { useTableTemplatePresets, toast, resolveTemplateForExport_ACU } = await importComposable();
    const presets = useTableTemplatePresets();
    resolveTemplateForExport_ACU.mockReturnValueOnce(null as any);

    presets.exportTemplate('global');

    expect(presets.message.value).toMatchObject({
      kind: 'error',
      text: '无法解析当前模板。',
    });
    expect(toast.items.at(-1)).toMatchObject({
      kind: 'error',
      text: '无法解析当前模板。',
    });
  });
});

describe('useTableTemplatePresets · runtime 视图', () => {
  it('runtime 项出现在主下拉且不覆盖既有 global:/snapshot: 项，顺序稳定', async () => {
    const { useTableTemplatePresets, setActiveMode, setSelectedChat } = await importComposable();
    setSelectedChat('global-A');
    setActiveMode('chat_override');
    const presets = useTableTemplatePresets();

    const labels = presets.chatPresetItems.value.map(item => item.label);
    expect(labels).toContain('当前生效模板（内存）');
    expect(labels).toContain('global-A（全局预设）');
    expect(labels).toContain('global-A（当前聊天快照）');
    // 默认项 → runtime → 全局预设 → 聊天快照，顺序稳定
    expect(labels.indexOf('默认预设（全局）')).toBeLessThan(labels.indexOf('当前生效模板（内存）'));
    expect(labels.indexOf('当前生效模板（内存）')).toBeLessThan(labels.indexOf('global-A（全局预设）'));
    expect(labels.indexOf('global-A（全局预设）')).toBeLessThan(labels.indexOf('global-A（当前聊天快照）'));
  });

  it('运行时内容与库内容一致时 runtimeDiffersFromLibrary 为 false', async () => {
    const { useTableTemplatePresets, setRuntimeSnapshot } = await importComposable();
    setRuntimeSnapshot({ templateStr: '{"sheet_1":{}}', templateObj: { sheet_1: {} } });
    const presets = useTableTemplatePresets();
    expect(presets.runtimeDiffersFromLibrary.value).toBe(false);
  });

  it('运行时内容与库内容不同时 runtimeDiffersFromLibrary 为 true', async () => {
    const { useTableTemplatePresets, setRuntimeSnapshot } = await importComposable();
    setRuntimeSnapshot({ templateStr: '{"sheet_1":{"name":"新内容"}}', templateObj: { sheet_1: { name: '新内容' } } });
    const presets = useTableTemplatePresets();
    expect(presets.runtimeDiffersFromLibrary.value).toBe(true);
  });

  it('运行时解析失败时 runtimeTemplateAvailable=false、runtimeTemplateItem=null 且不抛异常', async () => {
    const { useTableTemplatePresets, setRuntimeAvailable } = await importComposable();
    setRuntimeAvailable(false);
    const presets = useTableTemplatePresets();
    expect(presets.runtimeTemplateAvailable.value).toBe(false);
    expect(presets.runtimeTemplateItem.value).toBeNull();
    expect(presets.chatPresetItems.value.some(item => item.label === '当前生效模板（内存）')).toBe(false);
    expect(() => presets.refresh()).not.toThrow();
  });

  it('exportTemplate(runtime) 以 runtime scope 调用 resolveTemplateForExport_ACU', async () => {
    const { useTableTemplatePresets, resolveTemplateForExport_ACU } = await importComposable();
    const presets = useTableTemplatePresets();
    presets.exportTemplate('runtime');
    expect(resolveTemplateForExport_ACU).toHaveBeenCalledWith('runtime', '');
  });

  it('选中 runtime 项时零切换调用（不触发模板切换事务）', async () => {
    const { useTableTemplatePresets, applyTemplatePresetToCurrent_ACU, applyTemplateSnapshotToScope_ACU } = await importComposable();
    const presets = useTableTemplatePresets();
    const runtimeItem = presets.chatPresetItems.value.find(item => item.label === '当前生效模板（内存）');
    expect(runtimeItem).toBeDefined();
    await presets.selectChatPreset(runtimeItem!.value);
    expect(applyTemplatePresetToCurrent_ACU).not.toHaveBeenCalled();
    expect(applyTemplateSnapshotToScope_ACU).not.toHaveBeenCalled();
  });

  it('followGlobalTemplate 走共享跟随全局流程（S1-2）', async () => {
    const { useTableTemplatePresets, runFollowGlobalTemplateFlow_ACU } = await importComposable();
    const presets = useTableTemplatePresets();

    await presets.followGlobalTemplate();

    expect(runFollowGlobalTemplateFlow_ACU).toHaveBeenCalledOnce();
  });

  it('星标设全局默认后：聊天有覆盖 → 触发清覆盖确认；无覆盖 → 不触发（S1-2）', async () => {
    const { useTableTemplatePresets, promptFollowGlobalAfterSetDefault_ACU, setActiveMode } = await importComposable();
    const presets = useTableTemplatePresets();

    await presets.selectGlobalPreset('global:global-B');
    expect(promptFollowGlobalAfterSetDefault_ACU).not.toHaveBeenCalled();

    setActiveMode('chat_override');
    await presets.selectGlobalPreset('global:global-B');
    expect(promptFollowGlobalAfterSetDefault_ACU).toHaveBeenCalledOnce();
    expect(promptFollowGlobalAfterSetDefault_ACU).toHaveBeenCalledWith(expect.objectContaining({ newDefaultName: 'global-B' }));
  });

  it('全局切换被破坏性变更阻断时，经确认后以 destructiveChangeConfirmed 重试（S1-3）', async () => {
    const { useTableTemplatePresets, dialog, applyTemplatePresetToCurrent_ACU } = await importComposable();
    const presets = useTableTemplatePresets();
    applyTemplatePresetToCurrent_ACU
      .mockResolvedValueOnce({ saved: false, blockers: ['删除表「旧表」需要显式确认。'], error: '删除表「旧表」需要显式确认。' } as any)
      .mockResolvedValueOnce({ saved: true, presetName: 'global-B' } as any);

    const pending = presets.selectGlobalPreset('global:global-B');
    await vi.waitFor(() => expect(dialog.active).toMatchObject({
      kind: 'confirm',
      title: '确认破坏性模板变更',
      confirmVariant: 'danger',
    }));
    dialog.submitActive();
    await pending;

    expect(applyTemplatePresetToCurrent_ACU).toHaveBeenNthCalledWith(1, 'global-B', expect.objectContaining({
      updateGlobal: true,
      destructiveChangeConfirmed: false,
    }));
    expect(applyTemplatePresetToCurrent_ACU).toHaveBeenNthCalledWith(2, 'global-B', expect.objectContaining({
      updateGlobal: true,
      destructiveChangeConfirmed: true,
    }));
  });

  it('全局切换协调失败（saved:false）时显示具体错误而不是误报成功（S1-3）', async () => {
    const { useTableTemplatePresets, toast, applyTemplatePresetToCurrent_ACU } = await importComposable();
    const presets = useTableTemplatePresets();
    applyTemplatePresetToCurrent_ACU.mockResolvedValueOnce({
      saved: false,
      error: '当前表格状态在读取模板基线时发生变化，请稍后重试。',
    } as any);

    await presets.selectGlobalPreset('global:global-B');

    expect(presets.message.value).toMatchObject({
      kind: 'error',
      text: '当前表格状态在读取模板基线时发生变化，请稍后重试。',
    });
    expect(toast.items.at(-1)).toMatchObject({ kind: 'error' });
  });

  it('全局切换协调成功但带 postCommitWarning 时显示警告（S1-3）', async () => {
    const { useTableTemplatePresets, toast, applyTemplatePresetToCurrent_ACU } = await importComposable();
    const presets = useTableTemplatePresets();
    applyTemplatePresetToCurrent_ACU.mockResolvedValueOnce({
      saved: true,
      reconciledCurrentChat: true,
      postCommitWarning: '模板已保存，但 SQLite 运行时重建失败。',
    } as any);

    await presets.selectGlobalPreset('global:global-B');

    expect(toast.items.some(item => item.kind === 'warning' && item.text === '模板已保存，但 SQLite 运行时重建失败。')).toBe(true);
  });
});