/**
 * usePlotWorldbookAgentControl 单元测试
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const toast = {
  success: vi.fn(),
  info: vi.fn(() => 'progress-1'),
  warning: vi.fn(),
  error: vi.fn(),
  update: vi.fn(() => true),
};
const dialog = {
  confirm: vi.fn(async () => true),
};
const mockGetPromptTemplates = vi.fn();
const mockReadControl = vi.fn();
const mockSaveSettings = vi.fn();
const mockSetPromptTemplates = vi.fn();
const mockRefreshSnapshot = vi.fn(async () => ({ active: false, selectionSignature: '', createdAt: 0, books: {} }));
const mockWriteControl = vi.fn();
const mockTakeover = vi.fn(async () => ({ updated: false, reason: 'noop', failed: 0 }));
const mockRestore = vi.fn(async () => ({ updated: false, reason: 'noop', skipped: 0, failed: 0 }));
const mockClearSkillMeta = vi.fn(async () => ({ total: 2, cleared: 2, skipped: 0, failed: 0, errors: [] }));
const mockResolveAvailability = vi.fn(async () => ({
  configuredMode: 'agent',
  control: createSettings().plotSettings.agentWorldbookControl,
  configSource: 'worldbook',
  available: true,
  skillCount: 2,
  bookNames: ['角色A世界书'],
  configBookName: '角色A世界书',
  writableBookName: '角色A世界书',
  reason: 'available',
  skillMetas: [],
}));
const mockSkillify = vi.fn(async (options: any) => {
  options.onProgress?.({ phase: 'collecting' });
  throw new Error('boom');
});

function createGlobalPromptTemplates() {
  return {
    agentDecisionPromptSegments: [{ role: 'system', content: 'global decision', deletable: false }],
    agentSkillifyPromptSegments: [{ role: 'user', content: 'global skillify', deletable: true }],
  };
}

function createSettings() {
  return {
    apiPresets: [],
    plotSettings: {
      agentWorldbookControlSnapshot: { active: false, selectionSignature: '', createdAt: 0, books: {} },
      agentWorldbookControl: {
        enabled: true,
        mode: 'agent',
        agentPlotExecutionMode: 'sequential',
        agentApiPreset: '',
        agentSkillApiPreset: '',
        agentDecisionConcurrency: 1,
        maxSkillifyConcurrency: 3,
        worldbookScope: { source: 'character', manualSelection: [] },
        contextSettings: { agentAiMaxRetries: 2 },
        agentDecisionPromptSegments: [],
        agentSkillifyPromptSegments: [],
      },
    },
  } as any;
}

async function getComposable(options: {
  readControl?: () => Promise<any>;
  waitForReady?: boolean;
} = {}) {
  vi.resetModules();
  const settings = createSettings();
  const worldbookControl = {
    ...settings.plotSettings.agentWorldbookControl,
    contextSettings: { ...settings.plotSettings.agentWorldbookControl.contextSettings },
  };
  mockReadControl.mockImplementation(options.readControl || (async () => ({
    source: 'worldbook',
    bookName: '角色A世界书',
    writableBookName: '角色A世界书',
    reason: '',
    control: worldbookControl,
  })));

  mockWriteControl.mockImplementation(async (patch: any) => {
    Object.assign(worldbookControl, patch || {});
    return { updated: true, control: worldbookControl };
  });

  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    settings_ACU: settings,
    _set_pendingFinalGenerationGreenlights_ACU: vi.fn(),
  }));
  vi.doMock('../../../src/service/settings/settings-service', () => ({
    saveSettings_ACU: mockSaveSettings,
  }));
  vi.doMock('../../../src/service/agent/agent-worldbook-takeover', () => ({
    getPlotAgentWorldbookSnapshot_ACU: () => settings.plotSettings.agentWorldbookControlSnapshot,
    refreshPlotAgentWorldbookSnapshotFromWorldbooks_ACU: mockRefreshSnapshot,
    restoreWorldbookGreenlights_ACU: mockRestore,
    takeoverWorldbookGreenlights_ACU: mockTakeover,
  }));
  vi.doMock('../../../src/service/agent/agent-skillify-service', () => ({
    skillifyCurrentPlotWorldbookSelection_ACU: mockSkillify,
  }));
  vi.doMock('../../../src/service/agent/agent-worldbook-skill-meta', () => ({
    clearWorldbookSkillMetaBlocks_ACU: mockClearSkillMeta,
    resolveAgentWorldbookFilterAvailability_ACU: mockResolveAvailability,
  }));
  vi.doMock('../../../src/service/agent/agent-worldbook-config-meta', () => ({
    getAgentPromptTemplateDefaults_ACU: mockGetPromptTemplates,
    readAgentWorldbookControlFromWorldbooks_ACU: mockReadControl,
    setAgentPromptTemplateDefaults_ACU: mockSetPromptTemplates,
    writeAgentWorldbookControlToWorldbook_ACU: mockWriteControl,
  }));
  vi.doMock('../../../src/service/agent/agent-prompt-template', () => ({
    clonePromptSegments_ACU: (segments: any[]) => [...segments],
    getDefaultAgentDecisionPromptSegments_ACU: () => [
      { role: 'system', content: 'built-in decision', deletable: false },
    ],
    getDefaultAgentSkillifyPromptSegments_ACU: () => [
      { role: 'system', content: 'built-in skillify', deletable: false },
    ],
    normalizeAgentContextSettings_ACU: (value: any) => ({ agentAiMaxRetries: 2, ...(value || {}) }),
    normalizeEditablePromptSegments_ACU: (segments: any[] | undefined, fallback: any[]) => segments || fallback,
  }));
  vi.doMock('../../../src/presentation-v2/stores/dialog-store', () => ({
    useDialogStore: () => dialog,
  }));
  vi.doMock('../../../src/presentation-v2/stores/toast-store', () => ({
    useToastStore: () => toast,
  }));

  const mod = await import('../../../src/presentation-v2/composables/usePlotWorldbookAgentControl');
  const composable = Object.assign(mod.usePlotWorldbookAgentControl(), { __settings: settings });
  if (options.waitForReady !== false) await vi.waitFor(() => expect(composable.isReady.value).toBe(true));
  return composable;
}

describe('usePlotWorldbookAgentControl', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockGetPromptTemplates.mockReset();
    mockGetPromptTemplates.mockReturnValue(createGlobalPromptTemplates());
    mockReadControl.mockReset();
    mockSaveSettings.mockClear();
    mockSetPromptTemplates.mockReset();
    mockSetPromptTemplates.mockReturnValue(true);
    mockRefreshSnapshot.mockClear();
    mockWriteControl.mockReset();
    mockSkillify.mockClear();
    mockTakeover.mockClear();
    mockRestore.mockClear();
    mockClearSkillMeta.mockClear();
    mockResolveAvailability.mockClear();
    dialog.confirm.mockClear();
    toast.success.mockClear();
    toast.info.mockClear();
    toast.warning.mockClear();
    toast.error.mockClear();
    toast.update.mockClear();
    toast.info.mockReturnValue('progress-1');
    toast.update.mockReturnValue(true);
    dialog.confirm.mockResolvedValue(true);
    mockRefreshSnapshot.mockResolvedValue({ active: false, selectionSignature: '', createdAt: 0, books: {} });
    mockSkillify.mockImplementation(async (options: any) => {
      options.onProgress?.({ phase: 'collecting' });
      throw new Error('boom');
    });
    mockTakeover.mockResolvedValue({ updated: false, reason: 'noop', failed: 0 });
    mockRestore.mockResolvedValue({ updated: false, reason: 'noop', skipped: 0, failed: 0 });
    mockClearSkillMeta.mockResolvedValue({ total: 2, cleared: 2, skipped: 0, failed: 0, errors: [] });
    mockResolveAvailability.mockResolvedValue({
      configuredMode: 'agent',
      control: createSettings().plotSettings.agentWorldbookControl,
      configSource: 'worldbook',
      available: true,
      skillCount: 2,
      bookNames: ['角色A世界书'],
      configBookName: '角色A世界书',
      writableBookName: '角色A世界书',
      reason: 'available',
      skillMetas: [],
    });
  });

  it('skillifyAll 异常时把已有 progress toast 更新为 error 而不是新建 error toast', async () => {
    const c = await getComposable();

    const result = await c.skillifyAll();

    expect(result).toBe(false);
    expect(toast.info).toHaveBeenCalledWith('正在扫描当前世界书范围内可 Skill 化的条目...', {
      durationMs: 0,
      muteable: false,
      dismissible: false,
      feature: 'Skill 化',
    });
    expect(toast.update).toHaveBeenCalledWith(
      'progress-1',
      'error',
      expect.stringContaining('boom'),
      { muteable: false },
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('skillifyAll 异常且 progress toast 更新失败时新建 error toast 兜底', async () => {
    toast.update.mockReturnValue(false);
    const c = await getComposable();

    const result = await c.skillifyAll();

    expect(result).toBe(false);
    expect(toast.update).toHaveBeenCalledWith(
      'progress-1',
      'error',
      expect.stringContaining('boom'),
      { muteable: false },
    );
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('boom'),
      { muteable: false },
    );
  });

  it('skillifyAll 调用时传入当前 Skill 化并发数', async () => {
    mockSkillify.mockImplementation(async (options: any) => {
      options.onProgress?.({ phase: 'collecting' });
      options.onProgress?.({ phase: 'complete', current: 1, total: 1, updated: 1, skipped: 0, failed: 0 });
      return { totalCandidates: 1, updated: 1, skipped: 0, failed: 0 };
    });
    const c = await getComposable();

    const result = await c.skillifyAll();

    expect(result).toBe(true);
    expect(mockSkillify).toHaveBeenCalledWith(expect.objectContaining({
      maxConcurrency: 3,
      maxAiRetries: 2,
      overwriteManual: false,
    }));
  });


  it('skillifySelected 空选择时 warning 且不调用 Skill 化服务', async () => {
    const c = await getComposable();

    const result = await c.skillifySelected([]);

    expect(result).toBe(false);
    expect(mockSkillify).not.toHaveBeenCalled();
    expect(dialog.confirm).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledWith('请先勾选要 Skill 化的世界书条目。', { muteable: false });
  });

  it('skillifySelected 非空选择时透传 selectedEntries 并复用 Skill 化流程', async () => {
    mockSkillify.mockImplementation(async (options: any) => {
      options.onProgress?.({ phase: 'collecting' });
      options.onProgress?.({ phase: 'complete', current: 1, total: 1, updated: 1, skipped: 0, failed: 0 });
      return { totalCandidates: 1, updated: 1, skipped: 0, failed: 0 };
    });
    const c = await getComposable();

    const result = await c.skillifySelected([{ bookName: '角色A世界书', uid: 2 }]);

    expect(result).toBe(true);
    expect(dialog.confirm).toHaveBeenCalledTimes(1);
    expect(mockSkillify).toHaveBeenCalledWith(expect.objectContaining({
      selectedEntries: [{ bookName: '角色A世界书', uid: 2 }],
      maxConcurrency: 3,
      maxAiRetries: 2,
      overwriteManual: false,
    }));
  });

  it('setAgentDecisionConcurrency 保存高于旧上限的独立决策并发数', async () => {
    const c = await getComposable();

    await expect(c.setAgentDecisionConcurrency(9)).resolves.toBe(true);

    expect(mockWriteControl).toHaveBeenCalledWith({ agentDecisionConcurrency: 9 });
    expect(c.agentDecisionConcurrency.value).toBe(9);

    mockWriteControl.mockClear();
    await expect(c.setAgentDecisionConcurrency('not-a-number')).resolves.toBe(false);
    await expect(c.setAgentDecisionConcurrency('')).resolves.toBe(false);
    await expect(c.setAgentDecisionConcurrency('   ')).resolves.toBe(false);
    expect(mockWriteControl).not.toHaveBeenCalled();
  });

  it('setMaxSkillifyConcurrency 保存高于旧上限的并发数', async () => {
    const c = await getComposable();

    await expect(c.setMaxSkillifyConcurrency(9)).resolves.toBe(true);

    expect(mockWriteControl).toHaveBeenCalledWith({ maxSkillifyConcurrency: 9 });
    expect(c.maxSkillifyConcurrency.value).toBe(9);

    mockWriteControl.mockClear();
    await expect(c.setMaxSkillifyConcurrency('not-a-number')).resolves.toBe(false);
    await expect(c.setMaxSkillifyConcurrency('')).resolves.toBe(false);
    await expect(c.setMaxSkillifyConcurrency('   ')).resolves.toBe(false);
    expect(mockWriteControl).not.toHaveBeenCalled();
  });

  it('拒绝空白上下文数字输入而不写入配置', async () => {
    const c = await getComposable();

    await expect(c.setContextSetting('agentAiMaxRetries', '')).resolves.toBe(false);
    await expect(c.setContextSetting('agentAiMaxRetries', '   ')).resolves.toBe(false);
    expect(mockWriteControl).not.toHaveBeenCalled();
  });

  it('skillifyAll 成功更新 Skill 后在 Agent 模式同步物理接管并刷新 snapshot', async () => {
    mockSkillify.mockImplementation(async (options: any) => {
      options.onProgress?.({ phase: 'collecting' });
      options.onProgress?.({ phase: 'complete', current: 1, total: 1, updated: 1, skipped: 0, failed: 0 });
      return { totalCandidates: 1, updated: 1, skipped: 0, failed: 0 };
    });
    const activeSnapshot = { active: true, selectionSignature: 'sig', createdAt: 1, books: { '角色A世界书': [{ uid: 1 }] } };
    mockTakeover.mockResolvedValueOnce({ updated: true, reason: 'native_worldbook_trigger_disabled', failed: 0 });
    mockRefreshSnapshot.mockResolvedValue(activeSnapshot);
    const c = await getComposable();

    const result = await c.skillifyAll();

    expect(result).toBe(true);
    expect(mockTakeover).toHaveBeenCalledTimes(1);
    expect(c.snapshot.value).toEqual(activeSnapshot);
  });

  it('syncAgentWorldbookTakeoverAfterSkillChange 在非 Agent 模式不触发物理接管', async () => {
    const c = await getComposable();
    await c.setMode('passive');
    mockTakeover.mockClear();
    mockRefreshSnapshot.mockClear();

    const result = await c.syncAgentWorldbookTakeoverAfterSkillChange();

    expect(result).toBe(false);
    expect(mockTakeover).not.toHaveBeenCalled();
    expect(mockRefreshSnapshot).toHaveBeenCalledTimes(1);
  });

  it('syncAgentWorldbookTakeoverAfterSkillChange 在 Agent 模式触发物理接管并刷新 snapshot', async () => {
    const activeSnapshot = { active: true, selectionSignature: 'sig', createdAt: 1, books: { '角色A世界书': [{ uid: 1 }] } };
    mockTakeover.mockResolvedValueOnce({ updated: true, reason: 'native_worldbook_trigger_disabled', failed: 0 });
    mockRefreshSnapshot.mockResolvedValue(activeSnapshot);
    const c = await getComposable();

    const result = await c.syncAgentWorldbookTakeoverAfterSkillChange();

    expect(result).toBe(true);
    expect(mockTakeover).toHaveBeenCalledTimes(1);
    expect(c.snapshot.value).toEqual(activeSnapshot);
  });

  it('syncAgentWorldbookTakeoverAfterSkillChange 刷新配置失败时不抛出且不触发物理接管', async () => {
    const c = await getComposable();
    await Promise.resolve();
    mockRefreshSnapshot.mockClear();
    mockRefreshSnapshot.mockRejectedValueOnce(new Error('refresh failed'));

    const result = await c.syncAgentWorldbookTakeoverAfterSkillChange();

    expect(result).toBe(false);
    expect(mockTakeover).not.toHaveBeenCalled();
    expect(mockRefreshSnapshot).toHaveBeenCalledTimes(2);
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('refresh failed'), { muteable: false });
  });

  it('setMode agent 保存成功后触发物理接管并刷新 active snapshot', async () => {
    mockTakeover.mockResolvedValueOnce({ updated: true, reason: 'native_worldbook_trigger_disabled', failed: 0 });
    const activeSnapshot = { active: true, selectionSignature: 'sig', createdAt: 1, books: { '角色A世界书': [{ uid: 1 }] } };
    mockRefreshSnapshot
      .mockResolvedValue(activeSnapshot)
      .mockResolvedValueOnce({ active: false, selectionSignature: '', createdAt: 0, books: {} })
      .mockResolvedValueOnce(activeSnapshot);
    const c = await getComposable();

    await c.setMode('agent');

    expect(mockWriteControl).toHaveBeenCalledWith({ mode: 'agent', enabled: true });
    expect(mockTakeover).toHaveBeenCalledTimes(1);
    expect(mockRefreshSnapshot).toHaveBeenCalled();
    expect(c.snapshot.value.active).toBe(true);
    expect(toast.info).toHaveBeenCalledWith('Agent 世界书已切换为接管模式。', { muteable: false });
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('setMode agent 接管失败时提示 warning，不把失败伪装成成功', async () => {
    mockTakeover.mockResolvedValueOnce({ updated: true, reason: 'snapshot_state_write_failed', failed: 1 });
    mockRefreshSnapshot.mockResolvedValue({ active: false, selectionSignature: 'sig', createdAt: 0, books: {} });
    const c = await getComposable();

    await c.setMode('agent');

    expect(mockWriteControl).toHaveBeenCalledWith({ mode: 'agent', enabled: true });
    expect(mockTakeover).toHaveBeenCalledTimes(1);
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('snapshot_state_write_failed'), { muteable: false });
    expect(toast.info).not.toHaveBeenCalledWith('Agent 世界书已切换为接管模式。', { muteable: false });
  });

  it('setMode disabled 保存成功后执行 restore_only 恢复但保留 legacy snapshot', async () => {
    const c = await getComposable();
    const settings = (c as any).__settings;

    await c.setMode('disabled');

    expect(mockWriteControl).toHaveBeenCalledWith({ mode: 'disabled', enabled: false });
    expect(mockRestore).toHaveBeenCalledWith({ cleanupMode: 'restore_only' });
    expect(mockRestore).toHaveBeenCalledTimes(1);
    expect(settings.plotSettings.agentWorldbookControl.mode).toBe('disabled');
    expect(settings.plotSettings.agentWorldbookControl.enabled).toBe(false);
    expect(settings.plotSettings.agentWorldbookControlSnapshot).toBeDefined();
    expect(mockSaveSettings).toHaveBeenCalledTimes(1);
  });

  it('setMode disabled 恢复失败时 warning，不把关闭模式伪装成完整成功', async () => {
    mockRestore.mockResolvedValueOnce({ updated: true, reason: 'native_worldbook_trigger_restore_failed', skipped: 0, failed: 1 });
    const c = await getComposable();
    const settings = (c as any).__settings;

    await c.setMode('disabled');

    expect(mockWriteControl).toHaveBeenCalledWith({ mode: 'disabled', enabled: false });
    expect(mockRestore).toHaveBeenCalledWith({ cleanupMode: 'restore_only' });
    expect(settings.plotSettings.agentWorldbookControl.mode).toBe('disabled');
    expect(settings.plotSettings.agentWorldbookControl.enabled).toBe(false);
    expect(settings.plotSettings.agentWorldbookControlSnapshot).toBeDefined();
    expect(toast.warning).toHaveBeenCalledWith('部分世界书条目恢复失败，已保留 Agent 快照以避免永久丢失；Agent 模式已关闭。', { muteable: false });
    expect(toast.info).not.toHaveBeenCalledWith('Agent 世界书已关闭。', { muteable: false });
  });

  it('restore 取消确认时不清理也不关闭 Agent 模式', async () => {
    dialog.confirm.mockResolvedValue(false);
    const c = await getComposable();
    const settings = (c as any).__settings;

    await expect(c.restore()).resolves.toBe(false);

    expect(mockRestore).not.toHaveBeenCalled();
    expect(mockWriteControl).not.toHaveBeenCalled();
    expect(settings.plotSettings.agentWorldbookControl.mode).toBe('agent');
    expect(settings.plotSettings.agentWorldbookControlSnapshot).toBeDefined();
  });

  it('restore 清理并初始化后关闭 state control 与 legacy settings', async () => {
    const c = await getComposable();
    const settings = (c as any).__settings;
    mockRestore.mockImplementation(async () => {
      expect(settings.plotSettings.agentWorldbookControlSnapshot).toBeDefined();
      return { updated: true, reason: 'native_worldbook_trigger_restored', skipped: 0, failed: 0 };
    });

    await expect(c.restore()).resolves.toBe(true);

    expect(mockWriteControl).toHaveBeenCalledWith({ mode: 'disabled', enabled: false });
    expect(mockRestore).toHaveBeenCalledWith({ cleanupMode: 'full' });
    expect(mockRestore).toHaveBeenCalledTimes(1);
    expect(settings.plotSettings.agentWorldbookControl.mode).toBe('disabled');
    expect(settings.plotSettings.agentWorldbookControl.enabled).toBe(false);
    expect(settings.plotSettings.agentWorldbookControlSnapshot).toBeUndefined();
    expect(mockSaveSettings).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledWith('已清理并初始化 Agent 世界书状态；Agent 模式已关闭，下次使用时会重新初始化。', { muteable: false });
  });

  it('restore 恢复失败时保留 legacy snapshot，避免丢失恢复依据', async () => {
    const c = await getComposable();
    const settings = (c as any).__settings;
    mockRestore.mockImplementation(async () => {
      expect(settings.plotSettings.agentWorldbookControlSnapshot).toBeDefined();
      return { updated: true, reason: 'native_worldbook_trigger_restore_failed', skipped: 0, failed: 1 };
    });

    await expect(c.restore()).resolves.toBe(false);

    expect(mockWriteControl).toHaveBeenCalledWith({ mode: 'disabled', enabled: false });
    expect(mockRestore).toHaveBeenCalledWith({ cleanupMode: 'full' });
    expect(settings.plotSettings.agentWorldbookControl.mode).toBe('disabled');
    expect(settings.plotSettings.agentWorldbookControl.enabled).toBe(false);
    expect(settings.plotSettings.agentWorldbookControlSnapshot).toBeDefined();
    expect(mockSaveSettings).toHaveBeenCalledTimes(1);
    expect(toast.warning).toHaveBeenCalledWith('部分世界书条目恢复失败，已保留 Agent 快照以避免永久丢失；Agent 模式已关闭。', { muteable: false });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('clearSkillMeta 取消确认时不清除也不触发接管', async () => {
    dialog.confirm.mockResolvedValue(false);
    const c = await getComposable();

    const result = await c.clearSkillMeta();

    expect(result).toBe(false);
    expect(mockClearSkillMeta).not.toHaveBeenCalled();
    expect(mockTakeover).not.toHaveBeenCalled();
    expect(mockRestore).not.toHaveBeenCalled();
  });

  it('clearSkillMeta 清除当前 Agent 世界书范围并且不触发接管或恢复', async () => {
    const c = await getComposable();

    const result = await c.clearSkillMeta();

    expect(result).toBe(true);
    expect(mockResolveAvailability).toHaveBeenCalledTimes(2);
    expect(mockClearSkillMeta).toHaveBeenCalledWith(['角色A世界书']);
    expect(mockTakeover).not.toHaveBeenCalled();
    expect(mockRestore).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('已清除 2 条世界书 Skill 元数据。', { muteable: false });
  });

  it('clearSkillMeta 无可清除条目时返回 false 并提示 noop', async () => {
    mockClearSkillMeta.mockResolvedValue({ total: 0, cleared: 0, skipped: 0, failed: 0, errors: [] });
    const c = await getComposable();

    await expect(c.clearSkillMeta()).resolves.toBe(false);
    expect(toast.info).toHaveBeenCalledWith('当前 Agent 世界书范围内没有可清除的 Skill 元数据。', { muteable: false });
  });

  it('初始化完成前拒绝当前世界书与全局模板写入', async () => {
    let resolveRead: ((value: any) => void) | undefined;
    const c = await getComposable({ readControl: () => new Promise(resolve => { resolveRead = resolve; }), waitForReady: false });

    expect(c.isReady.value).toBe(false);
    await c.setPromptSegments('decision', [{ role: 'user', content: 'should not save', deletable: true }]);
    await expect(c.savePromptSegmentsAsGlobalTemplate(
      [{ role: 'user', content: 'decision draft', deletable: true }],
      [{ role: 'user', content: 'skillify draft', deletable: true }],
    )).resolves.toBe(false);
    expect(mockWriteControl).not.toHaveBeenCalled();
    expect(mockSetPromptTemplates).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledTimes(2);

    resolveRead?.({
      source: 'worldbook', bookName: '角色A世界书', writableBookName: '角色A世界书', reason: '',
      control: createSettings().plotSettings.agentWorldbookControl,
    });
    await vi.waitFor(() => expect(c.isReady.value).toBe(true));
  });

  it('初始化读取失败时保持写入门闩，重试成功后才开放当前世界书写入', async () => {
    const success = await getComposable();
    expect(success.isReady.value).toBe(true);

    let shouldFail = true;
    const failure = await getComposable({
      waitForReady: false,
      readControl: async () => {
        if (shouldFail) throw new Error('read failed');
        return {
          source: 'worldbook',
          bookName: '角色A世界书',
          writableBookName: '角色A世界书',
          reason: '',
          control: createSettings().plotSettings.agentWorldbookControl,
        };
      },
    });
    await vi.waitFor(() => expect(failure.initializationFailed.value).toBe(true));
    expect(failure.isReady.value).toBe(false);
    await failure.setPromptSegments('decision', [{ role: 'user', content: 'must not save', deletable: true }]);
    await expect(failure.savePromptSegmentsAsGlobalTemplate(
      [{ role: 'user', content: 'decision draft', deletable: true }],
      [{ role: 'user', content: 'skillify draft', deletable: true }],
    )).resolves.toBe(false);
    expect(mockWriteControl).not.toHaveBeenCalled();
    expect(mockSetPromptTemplates).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('read failed'), { muteable: false });

    shouldFail = false;
    await failure.retryInitialization();
    expect(failure.initializationFailed.value).toBe(false);
    expect(failure.isReady.value).toBe(true);
    await failure.setPromptSegments('decision', [{ role: 'user', content: 'saved after retry', deletable: true }]);
    expect(mockWriteControl).toHaveBeenCalledWith({
      agentDecisionPromptSegments: [{ role: 'user', content: 'saved after retry', deletable: true }],
    });
  });


  it('状态未确认的控制写入失败时刷新读回状态而不回填旧控制值', async () => {
    const persistedControl = {
      ...createSettings().plotSettings.agentWorldbookControl,
      maxSkillifyConcurrency: 4,
    };
    const c = await getComposable({ readControl: async () => ({
      source: 'worldbook',
      bookName: '角色A世界书',
      writableBookName: '角色A世界书',
      reason: '',
      control: persistedControl,
    }) });
    mockWriteControl.mockResolvedValueOnce({
      updated: false,
      reason: 'scope_state_write_unconfirmed',
      stateConfirmed: false,
      control: { ...persistedControl, maxSkillifyConcurrency: 1 },
    });

    await c.setMaxSkillifyConcurrency(2);

    expect(mockReadControl).toHaveBeenCalledTimes(2);
    expect(c.maxSkillifyConcurrency.value).toBe(4);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('scope_state_write_unconfirmed'), { muteable: false });
  });


  it('状态未确认且快照重新读取失败时不提交部分 UI 状态', async () => {
    const persistedControl = createSettings().plotSettings.agentWorldbookControl;
    const readbackControl = { ...persistedControl, maxSkillifyConcurrency: 4 };
    let readCount = 0;
    const c = await getComposable({ readControl: async () => {
      readCount += 1;
      return {
        source: readCount === 1 ? 'worldbook' : 'default',
        bookName: readCount === 1 ? '角色A世界书' : '',
        writableBookName: readCount === 1 ? '角色A世界书' : '',
        reason: readCount === 1 ? '' : 'readback-default',
        control: readCount === 1 ? persistedControl : readbackControl,
      };
    } });
    mockWriteControl.mockResolvedValueOnce({
      updated: false,
      reason: 'scope_state_write_unconfirmed',
      stateConfirmed: false,
      control: { ...persistedControl, maxSkillifyConcurrency: 1 },
    });
    mockRefreshSnapshot.mockRejectedValueOnce(new Error('snapshot readback failed'));

    await expect(c.setMaxSkillifyConcurrency(2)).resolves.toBe(false);

    expect(readCount).toBe(2);
    expect(c.maxSkillifyConcurrency.value).toBe(3);
    expect(c.configSource.value).toBe('worldbook');
    expect(c.configBookName.value).toBe('角色A世界书');
    expect(c.writableConfigBookName.value).toBe('角色A世界书');
    expect(c.snapshot.value).toEqual({ active: false, selectionSignature: '', createdAt: 0, books: {} });
    expect(toast.warning).toHaveBeenCalledWith('Agent 世界书配置保存状态未确认，且重新读取失败；请刷新后重试。', { muteable: false });
  });


  it('状态未确认且重新读取失败时保留当前控制值并返回受控失败', async () => {
    const persistedControl = createSettings().plotSettings.agentWorldbookControl;
    let readCount = 0;
    const c = await getComposable({ readControl: async () => {
      readCount += 1;
      if (readCount === 1) {
        return {
          source: 'worldbook',
          bookName: '角色A世界书',
          writableBookName: '角色A世界书',
          reason: '',
          control: persistedControl,
        };
      }
      throw new Error('readback failed');
    } });
    mockWriteControl.mockResolvedValueOnce({
      updated: false,
      reason: 'scope_state_write_unconfirmed',
      stateConfirmed: false,
      control: { ...persistedControl, maxSkillifyConcurrency: 1 },
    });

    await expect(c.setMaxSkillifyConcurrency(2)).resolves.toBe(false);

    expect(readCount).toBe(2);
    expect(c.maxSkillifyConcurrency.value).toBe(3);
    expect(toast.warning).toHaveBeenCalledWith('Agent 世界书配置保存状态未确认，且重新读取失败；请刷新后重试。', { muteable: false });
  });

  it('保存全局模板失败时显示错误且不写当前世界书', async () => {
    mockSetPromptTemplates.mockReturnValue(false);
    const c = await getComposable();
    const decision = [{ role: 'user', content: 'decision draft', deletable: true }];
    const skillify = [{ role: 'user', content: 'skillify draft', deletable: true }];

    await expect(c.savePromptSegmentsAsGlobalTemplate(decision, skillify)).resolves.toBe(false);

    expect(mockSetPromptTemplates).toHaveBeenCalledWith({
      agentDecisionPromptSegments: decision,
      agentSkillifyPromptSegments: skillify,
    });
    expect(mockWriteControl).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('全局 Agent 提示词模板保存失败。', { muteable: false });
  });

  it('保存当前世界书只写世界书，不写全局模板', async () => {
    const c = await getComposable();
    const decision = [{ role: 'user', content: 'decision draft', deletable: true }];
    const skillify = [{ role: 'user', content: 'skillify draft', deletable: true }];

    await expect(c.savePromptSegmentsToCurrentWorldbook(decision, skillify)).resolves.toBe(true);

    expect(mockWriteControl).toHaveBeenCalledWith({
      agentDecisionPromptSegments: decision,
      agentSkillifyPromptSegments: skillify,
    });
    expect(mockSetPromptTemplates).not.toHaveBeenCalled();
  });

  it('保存全局模板只写全局模板，不写当前世界书', async () => {
    const c = await getComposable();
    const decision = [{ role: 'user', content: 'decision draft', deletable: true }];
    const skillify = [{ role: 'user', content: 'skillify draft', deletable: true }];

    await expect(c.savePromptSegmentsAsGlobalTemplate(decision, skillify)).resolves.toBe(true);

    expect(mockSetPromptTemplates).toHaveBeenCalledWith({
      agentDecisionPromptSegments: decision,
      agentSkillifyPromptSegments: skillify,
    });
    expect(mockWriteControl).not.toHaveBeenCalled();
  });

  it('获取内置提示词副本，不读取全局模板也不写当前世界书', async () => {
    const c = await getComposable();
    mockGetPromptTemplates.mockClear();

    const first = c.getBuiltInPromptSegments('decision');
    first[0].content = 'mutated';
    const second = c.getBuiltInPromptSegments('decision');

    expect(second).toEqual([{ role: 'system', content: 'built-in decision', deletable: false }]);
    expect(mockGetPromptTemplates).not.toHaveBeenCalled();
    expect(mockWriteControl).not.toHaveBeenCalled();
  });

  it('retains the cursor for an unchanged scope and reuses it for the next Skillify batch', async () => {
    mockSkillify
      .mockResolvedValueOnce({
        totalCandidates: 1,
        totalMatched: 2,
        selectedForRun: 1,
        remaining: 1,
        truncated: true,
        nextCursor: { bookName: '角色A世界书', uid: 'entry-1' },
        updated: 0,
        skipped: 1,
        failed: 0,
        results: [],
      })
      .mockResolvedValueOnce({
        totalCandidates: 1,
        totalMatched: 1,
        selectedForRun: 1,
        remaining: 0,
        truncated: false,
        nextCursor: { bookName: '角色A世界书', uid: 'entry-2' },
        updated: 0,
        skipped: 1,
        failed: 0,
        results: [],
      });
    const c = await getComposable();

    await expect(c.skillifyAll()).resolves.toBe(false);
    expect(c.skillifyCursor.value).toEqual({ bookName: '角色A世界书', uid: 'entry-1' });
    expect(c.skillifyBatchStats.value).toEqual({ totalMatched: 2, selectedForRun: 1, remaining: 1, truncated: true });

    await c.refresh();
    expect(c.skillifyCursor.value).toEqual({ bookName: '角色A世界书', uid: 'entry-1' });

    await expect(c.skillifyAll()).resolves.toBe(false);
    expect(mockSkillify.mock.calls[1][0]).toMatchObject({ cursor: { bookName: '角色A世界书', uid: 'entry-1' } });
    expect(c.skillifyCursor.value).toBeUndefined();
    expect(c.skillifyBatchStats.value).toEqual({ totalMatched: 1, selectedForRun: 1, remaining: 0, truncated: false });
  });

  it('clears the cursor and batch statistics when the selection signature changes', async () => {
    mockSkillify.mockResolvedValueOnce({
      totalCandidates: 1,
      totalMatched: 2,
      selectedForRun: 1,
      remaining: 1,
      truncated: true,
      nextCursor: { bookName: '角色A世界书', uid: 'entry-1' },
      updated: 0,
      skipped: 1,
      failed: 0,
      results: [],
    });
    const c = await getComposable();

    await c.skillifyAll();
    mockRefreshSnapshot.mockResolvedValueOnce({ active: false, selectionSignature: 'changed-scope', createdAt: 2, books: {} });
    await c.refresh();

    expect(c.skillifyCursor.value).toBeUndefined();
    expect(c.skillifyBatchStats.value).toBeNull();
  });

});
