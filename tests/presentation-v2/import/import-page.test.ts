/**
 * ImportPage 集成 — 阶段 2 外部导入页结构
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'acu_v2_ui_state';

function createSettings() {
  return {
    apiMode: 'custom',
    apiConfig: { url: '', apiKey: '', model: '', useMainApi: true, max_tokens: 60000, temperature: 1 },
    tavernProfile: '',
    streamingEnabled: false,
    apiPresets: [],
    defaultApiPresetName: '',
    apiPresetBindingsByChat: {},
    importWorldbookTarget: 'world-A',
    importSplitSize: 5000,
    importSelectedTables: ['sheetA'],
    hasImportTableSelection: true,
    importPromptExcludeImportedWorldbookEntries: true,
    contentOptimizationSettings: { apiPreset: '' },
    tableApiPresetOverridesByName: {},
  } as any;
}

async function mountImportPage(
  settings = createSettings(),
  staging: { entries?: Array<{ content: string }>; status?: Record<string, unknown> } = {},
) {
  vi.resetModules();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ uiTierV2: { tier: 'high' }, router: { activePageId: 'import' } }));

  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    settings_ACU: settings,
    currentChatFileIdentifier_ACU: 'chat-import',
    currentJsonTableData_ACU: { sheetA: { name: 'A 表' }, sheetB: { name: 'B 表' } },
    getCurrentIsolationKey_ACU: () => '',
    coreApisAreReady_ACU: true,
  }));
  vi.doMock('../../../src/service/settings/settings-service', () => ({
    saveSettings_ACU: vi.fn(),
  }));
  vi.doMock('../../../src/service/ai/ai-service', () => ({
    getConnectionManagerProfiles_ACU: () => [],
    fetchAvailableModels_ACU: vi.fn(async () => ({ success: true, models: [] })),
  }));
  vi.doMock('../../../src/service/vector/vector-memory-config', () => ({
    getCurrentVectorMemoryConfig_ACU: () => ({
      embeddingEndpoint: '', embeddingModel: '', embeddingApiKey: '',
      rerankEndpoint: '', rerankModel: '', rerankApiKey: '',
    }),
    validateSummaryVectorIndexConfig_ACU: () => ({ valid: true, errors: [] }),
  }));
  vi.doMock('../../../src/service/worldbook/pipeline', () => ({
    getWorldbookNames_ACU: vi.fn(async () => ['world-A', 'world-B']),
  }));
  vi.doMock('../../../src/service/worldbook/worldbook-service', () => ({
    getCurrentCharPrimaryLorebook_ACU: vi.fn(async () => 'CharBook'),
  }));
  vi.doMock('../../../src/shared/idb-import-temp', () => ({
    importTempGet_ACU: vi.fn(async (key: string) => {
      if (key.endsWith('importedTxtEntries') && staging.entries) {
        return JSON.stringify(staging.entries);
      }
      if (key.endsWith('importedTxtStatus') && staging.status) {
        return JSON.stringify(staging.status);
      }
      return null;
    }),
    importTempRemove_ACU: vi.fn(),
    importTempSet_ACU: vi.fn(),
  }));
  vi.doMock('../../../src/service/import/import-executor', () => ({
    clearImportedEntriesCore_ACU: vi.fn(async () => ({ deletedCount: 0, localCleared: true })),
    deleteImportedEntriesCore_ACU: vi.fn(async () => 0),
    finalizeImportAndCleanup_ACU: vi.fn(async () => ({ success: true, cleanedCount: 0 })),
    initImportDatabase_ACU: vi.fn(async () => ({
      success: true,
      status: { total: 0, currentIndex: 0, selectionSig: '[]' },
      modeSuffix: '-Selected',
    })),
    saveChunkProgress_ACU: vi.fn(async () => true),
  }));
  vi.doMock('../../../src/service/table/update-orchestrator', () => ({
    executeCardUpdateCore_ACU: vi.fn(async () => ({ success: true, modifiedKeys: [] })),
  }));
  vi.doMock('../../../src/service/template/chat-scope', () => ({
    getSortedSheetKeys_ACU: (data: any) => (data ? Object.keys(data) : []),
  }));

  const mount = await import('../../../src/presentation-v2/bootstrap/mount');
  await mount.openAcuV2App();
  // allow async onMounted hooks (worldbook list, staging refresh) to settle
  await new Promise(r => setTimeout(r, 0));
  return { mount, settings };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ImportPage', () => {
  it('渲染外部导入页骨架，包含 4 个面板', async () => {
    const { mount } = await mountImportPage();

    const page = document.querySelector('.acu-v2-import-page');
    expect(page).not.toBeNull();
    const text = page!.textContent || '';
    expect(document.querySelector('.acu-v2-app__page-title')?.textContent?.trim()).toBe('外部导入');
    expect(text).toContain('写入目标');
    expect(text).toContain('拆分与编码');
    expect(text).toContain('写入表格选择');
    expect(text).toContain('状态 / 操作区');

    mount.__resetAcuV2MountForTests();
  });

  it('状态操作区把清空缓存放在主流程之后、删除之前，并使用普通按钮', async () => {
    const { mount } = await mountImportPage();

    const panel = Array.from(document.querySelectorAll<HTMLElement>('.acu-v2-import-page .acu-panel'))
      .find(el => el.querySelector('.acu-panel__title')?.textContent?.includes('状态 / 操作区'));
    expect(panel).not.toBeUndefined();
    expect(panel!.querySelector('.acu-v2-import-page__action-grid')).not.toBeNull();

    const buttons = Array.from(panel!.querySelectorAll<HTMLButtonElement>('button'));
    const labels = buttons.map(button => button.textContent?.trim() || '').filter(Boolean);
    expect(labels).toEqual([
      '选择并拆分',
      '写入',
      '清空缓存',
      '删除条目',
    ]);

    const clearButton = buttons.find(button => button.textContent?.includes('清空缓存'))!;
    const deleteButton = buttons.find(button => button.textContent?.includes('删除条目'))!;
    const splitButton = buttons.find(button => button.textContent?.includes('选择并拆分'))!;
    expect(splitButton.classList.contains('acu-btn--block')).toBe(true);
    expect(clearButton.classList.contains('acu-btn--default')).toBe(true);
    expect(deleteButton.classList.contains('acu-btn--danger')).toBe(true);

    mount.__resetAcuV2MountForTests();
  });

  it('世界书选择器列出当前世界书 + 角色卡 sentinel', async () => {
    const { mount } = await mountImportPage();

    const acuSelect = document.querySelector('.acu-v2-wb-selector .acu-select') as HTMLElement | null;
    expect(acuSelect).not.toBeNull();
    const trigger = acuSelect!.querySelector('.acu-select__trigger') as HTMLButtonElement;
    trigger.click();
    await new Promise(r => setTimeout(r, 0));
    const items = Array.from(acuSelect!.querySelectorAll('.acu-select__item'));
    const values = items.map(li => li.textContent?.trim() || '');
    expect(values).toContain('world-A');
    expect(values).toContain('world-B');
    expect(values.some(v => v.includes('CharBook'))).toBe(true);

    mount.__resetAcuV2MountForTests();
  });

  it('注入按钮在 staging 为空时禁用', async () => {
    const { mount } = await mountImportPage();

    const buttons = Array.from(document.querySelectorAll('button'));
    const inject = buttons.find(b => b.textContent?.includes('写入')) as HTMLButtonElement | undefined;
    expect(inject).not.toBeUndefined();
    expect(inject!.disabled).toBe(true);

    mount.__resetAcuV2MountForTests();
  });

  it('终止在首个分块前保存的 0 断点会显示继续写入', async () => {
    const { mount } = await mountImportPage(createSettings(), {
      entries: [{ content: '第一段' }, { content: '第二段' }],
      status: { total: 2, currentIndex: 0, selectionSig: JSON.stringify(['sheetA']) },
    });

    const buttons = Array.from(document.querySelectorAll('button'));
    const inject = buttons.find(b => b.textContent?.includes('继续写入')) as HTMLButtonElement | undefined;
    expect(inject).not.toBeUndefined();
    expect(inject!.disabled).toBe(false);
    expect(document.body.textContent || '').toContain('状态：已暂停，完成 0/2。');

    mount.__resetAcuV2MountForTests();
  });

  it('未呈现"屏蔽外部导入世界书条目占位符"开关（D21.9）', async () => {
    const { mount } = await mountImportPage();
    expect(document.body.textContent || '').not.toContain('屏蔽外部导入世界书条目占位符');
    mount.__resetAcuV2MountForTests();
  });

  it('表选择器渲染当前模板的表，复用 AcuPanel/AcuButton', async () => {
    const { mount } = await mountImportPage();

    expect(document.querySelectorAll('.acu-v2-table-selector__item').length).toBe(2);
    expect(document.querySelector('.acu-panel')).not.toBeNull();
    expect(document.querySelector('.acu-btn')).not.toBeNull();

    mount.__resetAcuV2MountForTests();
  });

  it('每个面板都渲染常驻说明信息条（统一格式约定）', async () => {
    const { mount } = await mountImportPage();

    const panels = document.querySelectorAll('.acu-v2-import-page .acu-panel');
    expect(panels.length).toBe(4);
    panels.forEach(panel => {
      const banner = panel.querySelector('.acu-info-banner');
      expect(banner).not.toBeNull();
      // banner 必须作为标题附属说明，不能塞进 header
      expect(panel.querySelector('.acu-panel__header .acu-info-banner')).toBeNull();
      expect(panel.querySelector('.acu-panel__description-region .acu-info-banner')).not.toBeNull();
    });

    mount.__resetAcuV2MountForTests();
  });
});
