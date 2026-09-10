/**
 * VectorIndexPage 集成 — 交火模式（向量混合增强）页骨架与立即构建动作
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { defaultVectorMemoryConfig_ACU } from '../../../src/shared/defaults';

const STORAGE_KEY = 'acu_v2_ui_state';

function createSettings() {
  return {
    apiMode: 'custom',
    apiConfig: { url: '', apiKey: '', model: '', useMainApi: true, max_tokens: 60000, temperature: 1 },
    tavernProfile: '',
    streamingEnabled: false,
    apiPresets: [
      { name: 'kw-cheap', apiMode: 'custom', apiConfig: { url: 'https://x', apiKey: 'k', model: 'm', useMainApi: false, max_tokens: 1000, temperature: 1 } },
    ],
    defaultApiPresetName: 'kw-cheap',
    apiPresetBindingsByChat: {},
    summaryVectorIndexModeDefault: true,
    contentOptimizationSettings: { apiPreset: '' },
    tableApiPresetOverridesByName: {},
  } as any;
}

function createConfig() {
  return {
    enabled: true,
    threshold: 50,
    archiveTriggerCount: 9,
    archiveBatchSize: 3,
    archiveMaxConcurrency: 30,
    summaryIndexArchiveMaxConcurrency: 30,
    summaryIndexArchiveMaxInputChars: 24000,
    summaryIndexArchiveEmbeddingConcurrency: 3,
    topK: 10,
    minScore: 0.4,
    embeddingEndpoint: 'https://emb',
    embeddingApiKey: '',
    embeddingModel: 'text-embedding-3-large',
    rerankEndpoint: '',
    rerankApiKey: '',
    rerankModel: '',
    vectorNamespace: 'chat',
    entryComment: 'TavernDB-ACU-VectorMemory',
    entryKey: 'TavernDB-ACU-VectorMemory-Key',
    summaryIndexKeywordMinRows: 100,
    summaryChunkSentenceCount: 2,
    summaryPromptGroupId: 'remote-memory-archive-default',
    archiveWithoutSummary: false,
    summaryPromptGroup: [],
    keywordApiPreset: '',
    keywordContextPairCount: 1,
    keywordGenerationMaxAttempts: 3,
    keywordPromptGroup: JSON.parse(JSON.stringify(defaultVectorMemoryConfig_ACU.keywordPromptGroup)),
    recallCandidateLimit: 1000,
    recentFixedInjectCount: 50,
  };
}

async function mountVectorIndexPage(opts: {
  settings?: any,
  validation?: { valid: boolean, errors: string[] },
  archiveResult?: any,
  migrationResult?: any,
  healthReport?: any,
  devOptions?: Record<string, unknown>,
} = {}) {
  vi.resetModules();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    router: { activePageId: 'vector-index' },
    ...(opts.devOptions ? { devOptions: opts.devOptions } : {}),
  }));

  const settings = opts.settings ?? createSettings();
  const config = createConfig();
  const validationResult = opts.validation ?? { valid: true, errors: [] };
  const archiveResult = opts.archiveResult ?? { success: true, skipped: false, indexedRowCount: 12, chunkCount: 7, errors: [] };
  const migrationResult = opts.migrationResult ?? { success: true, skipped: false, indexedRowCount: 12, chunkCount: 7, errors: [] };
  const healthReport = opts.healthReport ?? { legacyManifestCount: 0, issues: [] };

  const saveSettings = vi.fn(() => ({ saved: true, storageType: 'memory' }));
  const archiveSummary = vi.fn(async () => archiveResult);
  const migrateLegacy = vi.fn(async () => migrationResult);
  const loadOrCreate = vi.fn(async () => ({ ok: true }));
  const saveIndependent = vi.fn(async () => ({ ok: true }));
  const runTableUpdateCommit = vi.fn(async (_options: any, apply: any) => {
    const applied = await apply({ transactionContext: { runCommit: async (task: any) => task() }, workingData: null });
    return { success: applied.success !== false, value: applied.value, tableData: applied.tableData, saved: true };
  });
  const updateLorebook = vi.fn(async () => true);
  const rebuildNow = vi.fn(async () => {
    await runTableUpdateCommit({}, async () => ({ success: true, value: null, tableData: {}, mutationResult: { changes: 1, errors: [] } }));
    const result = await archiveSummary({ mode: 'sync' });
    if (result.success && !result.skipped) await updateLorebook();
    return result;
  });
  const getLastIndex = vi.fn(() => 5);
  const clearCache = vi.fn(async () => undefined);
  const deleteIndex = vi.fn(async () => true);
  const getStats = vi.fn(async () => ({
    status: 'ready',
    indexId: 'idx-1',
    backend: 'st-files',
    rowCount: 1,
    chunkCount: 2,
    baseShardCount: 1,
    deltaShardCount: 0,
    tombstoneRowCount: 0,
    tombstoneChunkCount: 0,
    externalTotalBytes: 2048,
    cacheTotalBytes: 128,
    flushTaskDirtyCount: 0,
    flushTaskQueuedCount: 0,
    flushTaskFlushingCount: 0,
    flushTaskFailedCount: 0,
    updatedAt: '2026-05-08T12:00:00.000Z',
  }));
  const inspectHealth = vi.fn(async () => healthReport);

  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    settings_ACU: settings,
    currentChatFileIdentifier_ACU: 'chat-vector',
    currentJsonTableData_ACU: {
      sheet_summary: { name: '纪要表', content: [['id', 'summary'], ['1', 'r1']] },
    },
    getCurrentIsolationKey_ACU: () => '',
    coreApisAreReady_ACU: true,
  }));
  vi.doMock('../../../src/service/settings/settings-service', () => ({
    saveSettings_ACU: saveSettings,
  }));
  vi.doMock('../../../src/service/ai/ai-service', () => ({
    getConnectionManagerProfiles_ACU: () => [],
    fetchAvailableModels_ACU: vi.fn(async () => ({ success: true, models: [] })),
  }));
  vi.doMock('../../../src/service/vector/vector-memory-config', () => ({
    getCurrentVectorMemoryConfig_ACU: () => config,
    updateGlobalVectorMemoryConfigFields_ACU: (patch: Record<string, any>) => {
      Object.assign(config, patch);
      saveSettings();
      return { ok: true };
    },
    validateSummaryVectorIndexConfig_ACU: () => validationResult,
  }));
  vi.doMock('../../../src/service/vector/summary-vector-index-archive-service', () => ({
    archiveSummaryVectorIndexNow_ACU: archiveSummary,
    migrateLegacySummaryVectorIndexToContentAddressed_ACU: migrateLegacy,
  }));
  vi.doMock('../../../src/service/vector/summary-vector-index-rebuild-service', () => ({
    rebuildCurrentSummaryVectorIndexNow_ACU: rebuildNow,
  }));
  vi.doMock('../../../src/service/table/table-service', () => ({
    loadOrCreateJsonTableFromChatHistory_ACU: loadOrCreate,
    saveIndependentTableToChatHistory_ACU: saveIndependent,
  }));
  vi.doMock('../../../src/service/table/table-update-commit', () => ({
    runTableUpdateCommit_ACU: runTableUpdateCommit,
  }));
  vi.doMock('../../../src/service/chat/chat-service', () => ({
    getLastMessageIndex_ACU: getLastIndex,
    getChatArray_ACU: vi.fn(() => [{ is_user: false, mes: 'ai', mesId: 'm1' }]),
  }));
  vi.doMock('../../../src/service/worldbook/pipeline', () => ({
    updateReadableLorebookEntry_ACU: updateLorebook,
  }));
  vi.doMock('../../../src/service/vector/summary-vector-index-state-service', () => ({
    getLatestSummaryVectorIndexSnapshotState_ACU: vi.fn(() => ({
      summaryVectorIndexState: {
        manifest: { status: 'ready', indexId: 'idx-1' },
        rows: [{ rowKey: 'r1', status: 'active' }],
        chunks: [],
      },
      layers: [],
    })),
  }));
  vi.doMock('../../../src/service/vector/summary-vector-index-storage-service', () => ({
    getSummaryVectorIndexStats_ACU: getStats,
    inspectSummaryVectorIndexHealth_ACU: inspectHealth,
  }));
  vi.doMock('../../../src/service/vector/summary-vector-index-cache-service', () => ({
    clearAllSummaryVectorIndexCaches_ACU: clearCache,
  }));
  vi.doMock('../../../src/service/vector/summary-vector-index-chat-service', () => ({
    deleteCurrentSummaryVectorIndexFromChat_ACU: deleteIndex,
  }));

  const mount = await import('../../../src/presentation-v2/bootstrap/mount');
  await mount.openAcuV2App();
  await new Promise(r => setTimeout(r, 0));

  return {
    mount,
    settings,
    config,
    saveSettings,
    rebuildNow,
    archiveSummary,
    migrateLegacy,
    inspectHealth,
    loadOrCreate,
    saveIndependent,
    runTableUpdateCommit,
    updateLorebook,
    clearCache,
    deleteIndex,
    getStats,
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function flushDialog(): Promise<HTMLElement> {
  await new Promise(r => setTimeout(r, 0));
  const layer = document.querySelector<HTMLElement>('.acu-dialog-layer');
  expect(layer).not.toBeNull();
  return layer!;
}

describe('VectorIndexPage', () => {
  it('渲染交火模式页骨架，包含核心面板', async () => {
    const { mount, getStats } = await mountVectorIndexPage();

    const page = document.querySelector('.acu-v2-vector-index-page');
    expect(page).not.toBeNull();
    const text = page!.textContent || '';
    expect(text).toContain('交火模式');
    expect(text).toContain('索引状态');
    expect(text).not.toContain('向量服务引用');
    expect(text).not.toContain('Embedding 服务');
    expect(text).not.toContain('Rerank 服务（可选）');
    expect(text).toContain('Embedding / Rerank');
    expect(text).toContain('Embedding');
    expect(text).toContain('Rerank');
    expect(text).not.toContain('向量化（Embedding）');
    expect(text).not.toContain('重排（Rerank，可选）');
    expect(text).toContain('URL');
    expect(text).toContain('模型名');
    expect(text).not.toContain(`服务${'地址'}`);
    expect(text).not.toContain(`模型${'名称'}`);
    expect(text).not.toContain('召回参数');
    expect(text).not.toContain('归档与分块');
    expect(text).toContain('关键词生成');
    expect(text).toContain('关键词生成提示词');
    expect(text).toContain('使用默认提示词');
    expect(text).not.toContain('刷新状态');
    expect(text).not.toContain('段落数量');
    expect(text).not.toContain('保存状态');
    expect(getStats).toHaveBeenCalled();

    const maintenancePanel = Array.from(page!.querySelectorAll<HTMLElement>('.acu-panel'))
      .find(panel => panel.id === 'vector-index-status-panel')!;
    const actionButtons = Array.from(maintenancePanel.querySelectorAll<HTMLButtonElement>('.acu-v2-vector-index-page__actions button'))
      .map(button => button.textContent?.trim() || '');
    expect(actionButtons).toEqual([
      '立即构建交火纪要索引',
      '清空临时缓存',
      '删除当前索引',
    ]);
    expect(
      maintenancePanel.querySelector(
        '.acu-v2-vector-index-page__maintenance-spacer',
      ),
    ).not.toBeNull();
    expect(maintenancePanel.querySelector('.acu-stats')?.className).not.toContain(
      'maintenance-spacer',
    );
    expect(actionButtons.some(label => label.includes('刷新状态'))).toBe(false);
    const clearButton = Array.from(maintenancePanel.querySelectorAll<HTMLButtonElement>('.acu-v2-vector-index-page__actions button'))
      .find(button => button.textContent?.includes('清空临时缓存'))!;
    expect(clearButton.classList.contains('acu-btn--default')).toBe(true);

    const panelStacks = Array.from(page!.querySelectorAll<HTMLElement>('.acu-v2-vector-index-page__panel-stack'));
    expect(panelStacks.map(stack => Array.from(stack.querySelectorAll<HTMLElement>('.acu-panel__title'))
      .map(title => title.textContent?.trim()))).toEqual([
      ['索引状态', '关键词生成'],
      ['Embedding / Rerank', '关键词生成提示词'],
    ]);

    const promptPanel = Array.from(page!.querySelectorAll<HTMLElement>('.acu-panel'))
      .find(panel => panel.querySelector('.acu-panel__title')?.textContent?.includes('关键词生成提示词'))!;
    expect(promptPanel.querySelector('.acu-panel__actions .acu-badge')?.textContent).toContain('使用默认提示词');
    expect(promptPanel.querySelector('.acu-v2-vector-index-page__prompt-overview')).toBeNull();
    const mobileNavItems = Array.from(page!.querySelectorAll('.acu-mobile-panel-nav__item'))
      .map(item => item.textContent?.trim());
    expect(mobileNavItems).toEqual(['索引状态', '关键词', '向量服务', '提示词']);

    mount.__resetAcuV2MountForTests();
  });

  it('默认关键词提示词切换页面后仍显示默认 badge', async () => {
    const { mount, config } = await mountVectorIndexPage();

    expect(document.querySelector('.acu-v2-vector-index-page')?.textContent || '').toContain('使用默认提示词');

    const { useRouterStore } = await import('../../../src/presentation-v2/stores/router-store');
    useRouterStore().setActivePage('dashboard');
    await nextTick();

    config.keywordPromptGroup = config.keywordPromptGroup.map((segment: any) => ({
      ...segment,
      content: typeof segment.content === 'string' ? segment.content.trim() : segment.content,
    }));

    useRouterStore().setActivePage('vector-index');
    await nextTick();

    const textAfterReturn = document.querySelector('.acu-v2-vector-index-page')?.textContent || '';
    expect(textAfterReturn).toContain('使用默认提示词');
    expect(textAfterReturn).not.toContain('已自定义提示词');

    mount.__resetAcuV2MountForTests();
  });

  it('开发者选项开启后显示交火高级索引参数面板', async () => {
    const { mount } = await mountVectorIndexPage({ devOptions: { vectorIndexAdvanced: true } });

    const text = document.querySelector('.acu-v2-vector-index-page')?.textContent || '';
    expect(text).toContain('召回参数');
    expect(text).toContain('归档与分块');
    expect(text).toContain('触发阈值');
    expect(text).toContain('单请求最多行数');
    expect(text).toContain('单请求字符预算');
    expect(text).toContain('同时请求数');
    expect(text).not.toContain('滚动增量写入暂不可用');
    expect(text).not.toContain('折叠阈值 K');
    expect(text).not.toContain('V2 写入闸门');
    expect(document.querySelector('.acu-v2-vector-index-page__scope-allowlist')).toBeNull();
    const mobileNavItems = Array.from(document.querySelectorAll('.acu-v2-vector-index-page .acu-mobile-panel-nav__item'))
      .map(item => item.textContent?.trim());
    expect(mobileNavItems).toEqual(['索引状态', '关键词', '向量服务', '提示词', '召回参数', '归档分块']);

    mount.__resetAcuV2MountForTests();
  });

  it('每个面板都渲染常驻说明信息条', async () => {
    const { mount } = await mountVectorIndexPage();

    const panels = document.querySelectorAll('.acu-v2-vector-index-page .acu-panel');
    expect(panels.length).toBeGreaterThanOrEqual(3);
    panels.forEach(panel => {
      expect(panel.querySelector('.acu-panel__description-region .acu-info-banner')).not.toBeNull();
      expect(panel.querySelector('.acu-panel__header .acu-info-banner')).toBeNull();
    });

    mount.__resetAcuV2MountForTests();
  });

  it('全局 header 展示当前页标题，页面内不再渲染重复 header', async () => {
    const { mount } = await mountVectorIndexPage();

    expect(document.querySelector('.acu-v2-vector-index-page .acu-page-header')).toBeNull();
    const globalTitle = document.querySelector('.acu-v2-app__page-title');
    expect(globalTitle?.textContent?.trim()).toBe('交火模式');

    mount.__resetAcuV2MountForTests();
  });

  it('关键词 API 预设下拉的跟随项显示当前活动 API 预设名', async () => {
    const { mount } = await mountVectorIndexPage();

    const keywordPanel = Array.from(document.querySelectorAll<HTMLElement>('.acu-v2-vector-index-page .acu-panel'))
      .find(panel => panel.querySelector('.acu-panel__title')?.textContent?.includes('关键词生成'))!;
    const acuSelect = keywordPanel.querySelector('.acu-select') as HTMLElement | null;
    expect(acuSelect).not.toBeNull();
    const trigger = acuSelect!.querySelector('.acu-select__trigger') as HTMLButtonElement;
    expect(trigger.textContent).toContain('跟随当前活动 API（kw-cheap）');
    trigger.click();
    await Promise.resolve();

    const labels = Array.from(acuSelect!.querySelectorAll<HTMLElement>('.acu-select__item'))
      .map(item => (item.textContent || '').trim());
    expect(labels[0]).toBe('跟随当前活动 API（kw-cheap）');
    expect(labels).toContain('kw-cheap');

    mount.__resetAcuV2MountForTests();
  });

  it('立即构建按钮触发归档流程并显示成功消息', async () => {
    const { mount, archiveSummary, runTableUpdateCommit, updateLorebook } = await mountVectorIndexPage();

    const buildButton = Array.from(document.querySelectorAll('button'))
      .find(b => /立即构建交火纪要索引/.test(b.textContent || '')) as HTMLButtonElement | undefined;
    expect(buildButton).not.toBeUndefined();

    buildButton!.click();
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    expect(archiveSummary).toHaveBeenCalledTimes(1);
    expect(archiveSummary).toHaveBeenCalledWith({ mode: 'sync' });
    expect(runTableUpdateCommit).toHaveBeenCalledTimes(1);
    expect(updateLorebook).toHaveBeenCalledTimes(1);

    const text = document.body.textContent || '';
    expect(text).toMatch(/交火索引快照重建完成/);

    mount.__resetAcuV2MountForTests();
  });

  it('非破坏迁移旧索引入口不再渲染', async () => {
    const { mount, migrateLegacy } = await mountVectorIndexPage({
      healthReport: { legacyManifestCount: 1, issues: [] },
    });
    expect(document.body.textContent || '').not.toContain('非破坏迁移旧索引');
    expect(migrateLegacy).not.toHaveBeenCalled();
    mount.__resetAcuV2MountForTests();
  });

  it('清空临时缓存按钮只调用缓存清理服务，不删除当前索引', async () => {
    const { mount, clearCache, deleteIndex } = await mountVectorIndexPage();

    const clearButton = Array.from(document.querySelectorAll('button'))
      .find(b => /清空临时缓存/.test(b.textContent || '')) as HTMLButtonElement | undefined;
    expect(clearButton).not.toBeUndefined();

    clearButton!.click();
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    expect(clearCache).toHaveBeenCalledTimes(1);
    expect(deleteIndex).not.toHaveBeenCalled();
    expect(document.body.textContent || '').toContain('交火索引临时缓存与热缓存已清空');

    mount.__resetAcuV2MountForTests();
  });

  it('删除当前索引确认后调用当前聊天索引删除服务', async () => {
    const { mount, deleteIndex } = await mountVectorIndexPage();

    const deleteButton = Array.from(document.querySelectorAll('button'))
      .find(b => /删除当前索引/.test(b.textContent || '')) as HTMLButtonElement | undefined;
    expect(deleteButton).not.toBeUndefined();

    deleteButton!.click();
    const layer = await flushDialog();
    expect(layer.textContent || '').toContain('删除当前聊天的交火索引');
    const confirmButton = Array.from(layer.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('删除索引'));
    expect(confirmButton).not.toBeUndefined();
    confirmButton!.click();
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    expect(deleteIndex).toHaveBeenCalledTimes(1);
    expect(document.body.textContent || '').toContain('当前聊天的交火索引已删除');

    mount.__resetAcuV2MountForTests();
  });

  it('交火页渲染 Embedding / Rerank 配置并可保存向量服务', async () => {
    const { mount, config, saveSettings } = await mountVectorIndexPage();

    const page = document.querySelector('.acu-v2-vector-index-page') as HTMLElement;
    const text = page.textContent || '';
    expect(text).toContain('Embedding / Rerank');
    expect(text).toContain('Embedding');
    expect(text).toContain('Rerank');

    const embeddingEndpoint = page.querySelector('input[placeholder*="embeddings"]') as HTMLInputElement | null;
    expect(embeddingEndpoint).not.toBeNull();
    embeddingEndpoint!.value = ' https://new-emb.test ';
    embeddingEndpoint!.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));

    const saveButton = page.querySelector('.acu-v2-vector-api-form__actions button') as HTMLButtonElement | null;
    expect(saveButton).not.toBeNull();
    expect(saveButton!.textContent || '').toContain('保存');
    saveButton!.click();
    await new Promise(r => setTimeout(r, 0));

    expect(config.embeddingEndpoint).toBe('https://new-emb.test');
    expect(saveSettings).toHaveBeenCalled();

    mount.__resetAcuV2MountForTests();
  });

  it('关键词提示词编辑器只在侧抽屉中出现，保存后写回配置', async () => {
    const { mount, config, saveSettings } = await mountVectorIndexPage();

    expect(document.querySelector('.acu-v2-vector-index-page .acu-prompt-segs')).toBeNull();

    const editButton = Array.from(document.querySelectorAll('button'))
      .find(btn => btn.textContent?.includes('编辑提示词')) as HTMLButtonElement | undefined;
    expect(editButton).not.toBeUndefined();
    editButton!.click();
    await new Promise(r => setTimeout(r, 0));

    const drawer = document.querySelector('.acu-v2-drawer') as HTMLElement | null;
    expect(drawer).not.toBeNull();
    const textarea = drawer!.querySelector<HTMLTextAreaElement>('.acu-prompt-segs textarea');
    expect(textarea).not.toBeNull();
    textarea!.value = '新的关键词系统提示';
    textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));

    const saveButton = Array.from(drawer!.querySelectorAll('button'))
      .find(btn => btn.textContent?.includes('保存提示词')) as HTMLButtonElement | undefined;
    expect(saveButton).not.toBeUndefined();
    saveButton!.click();
    await new Promise(r => setTimeout(r, 0));

    expect(config.keywordPromptGroup[0].content).toBe('新的关键词系统提示');
    expect(saveSettings).toHaveBeenCalled();

    mount.__resetAcuV2MountForTests();
  });

  it('关键词提示词抽屉有未保存修改时关闭整个 UI 会确认', async () => {
    const { mount } = await mountVectorIndexPage();

    const editButton = Array.from(document.querySelectorAll('button'))
      .find(btn => btn.textContent?.includes('编辑提示词')) as HTMLButtonElement | undefined;
    expect(editButton).not.toBeUndefined();
    editButton!.click();
    await new Promise(r => setTimeout(r, 0));

    const drawer = document.querySelector('.acu-v2-drawer') as HTMLElement | null;
    expect(drawer).not.toBeNull();
    const textarea = drawer!.querySelector<HTMLTextAreaElement>('.acu-prompt-segs textarea');
    expect(textarea).not.toBeNull();
    textarea!.value = '未保存关键词提示';
    textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));

    const appClose = document.querySelector<HTMLButtonElement>('.acu-v2-app__close');
    expect(appClose).not.toBeNull();
    appClose!.click();
    const layer = await flushDialog();

    expect(layer.textContent || '').toContain('你有未保存的关键词生成提示词修改');
    expect(document.getElementById('acu-app-v2')!.style.display).not.toBe('none');
    expect(document.querySelector('.acu-v2-drawer')).not.toBeNull();

    mount.__resetAcuV2MountForTests();
  });

  it('最近固定注入条数输入非正整数时显示 toast 并重置为默认值', async () => {
    const { mount, config, saveSettings } = await mountVectorIndexPage({ devOptions: { vectorIndexAdvanced: true } });
    const alertSpy = vi.spyOn(window, 'alert');

    const row = Array.from(document.querySelectorAll('.acu-v2-vector-index-page .acu-form-row'))
      .find(el => /固定写入/.test(el.textContent || ''));
    const input = row?.querySelector('input') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input!.min).toBe('1');

    input!.value = '0';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    input!.dispatchEvent(new Event('change', { bubbles: true }));
    await nextTick();

    expect(alertSpy).not.toHaveBeenCalled();
    expect(document.querySelector('.acu-v2-toast--warning')?.textContent || '')
      .toContain('固定写入必须是正整数，已重置为默认值 50。');
    expect(config.recentFixedInjectCount).toBe(50);
    expect(input!.value).toBe('50');
    expect(saveSettings).toHaveBeenCalled();

    mount.__resetAcuV2MountForTests();
  });

  it('批处理上限写入交火索引实际读取的三个字段', async () => {
    const { mount, config, saveSettings } = await mountVectorIndexPage({ devOptions: { vectorIndexAdvanced: true } });

    const row = Array.from(document.querySelectorAll('.acu-v2-vector-index-page .acu-form-row'))
      .find(el => /单请求最多行数/.test(el.textContent || ''));
    const input = row?.querySelector('input') as HTMLInputElement | null;
    expect(input).not.toBeNull();

    input!.value = '42';
    input!.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));

    expect(config.summaryIndexArchiveMaxConcurrency).toBe(42);
    expect(config.archiveMaxConcurrency).toBe(30);
    expect(saveSettings).toHaveBeenCalled();

    const charRow = Array.from(document.querySelectorAll('.acu-v2-vector-index-page .acu-form-row'))
      .find(el => /单请求字符预算/.test(el.textContent || ''));
    const charInput = charRow?.querySelector('input') as HTMLInputElement | null;
    expect(charInput).not.toBeNull();
    charInput!.value = '1234';
    charInput!.dispatchEvent(new Event('change', { bubbles: true }));

    const concurrencyRow = Array.from(document.querySelectorAll('.acu-v2-vector-index-page .acu-form-row'))
      .find(el => /同时请求数/.test(el.textContent || ''));
    const concurrencyInput = concurrencyRow?.querySelector('input') as HTMLInputElement | null;
    expect(concurrencyInput).not.toBeNull();
    concurrencyInput!.value = '2';
    concurrencyInput!.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));

    expect(config.summaryIndexArchiveMaxInputChars).toBe(1234);
    expect(config.summaryIndexArchiveEmbeddingConcurrency).toBe(2);

    mount.__resetAcuV2MountForTests();
  });

  it('高级面板不再暴露 V2 writer kill switch 与 scope allowlist', async () => {
    const { mount } = await mountVectorIndexPage({ devOptions: { vectorIndexAdvanced: true } });
    expect(document.querySelector('.acu-v2-vector-index-page__scope-allowlist')).toBeNull();
    expect(document.body.textContent || '').not.toContain('V2 写入闸门');
    mount.__resetAcuV2MountForTests();
  });
});
