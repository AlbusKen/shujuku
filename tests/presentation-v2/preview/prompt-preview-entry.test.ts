/**
 * 提示词查看器入口按钮集成测试（FormFillPage / PlotPage）
 *
 * @vitest-environment jsdom
 */
// 覆盖：gate 禁用→按钮 disabled+title；可用→点击开抽屉并按 auto 生成、切管线重生成；
// Plot 同理 + 模拟输入生成 + 截断黄条。mount kit 以 form-fill-page.test.ts 与
// fill-mode-plot-panels.test.ts 为底本，追加三个 preview 服务 mock。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 当前 node 运行时的原生 localStorage getter（未提供 --localstorage-file 时为
 * undefined）会遮蔽 vitest jsdom 环境注入，原版页面测试在此环境下 localStorage.clear()
 * 即抛错（本文件编写时 form-fill-page.test.ts 在本机 29/29 全炸，属环境级回归）。
 * 这里用内存 stub 使入口测试环境无关。
 */
function installLocalStorageStub() {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  });
}

const STORAGE_KEY = 'acu_v2_ui_state';

const previewGate = vi.fn();
const previewTableFill = vi.fn();
const previewPlot = vi.fn();

const GATE_OK = () => ({
  tableFill: { available: true, blockers: [] },
  plot: { available: true, blockers: [] },
});

const TABLE_FILL_SAMPLE = {
  segments: [{ role: 'system', content: '填表系统段', tokens: 120 }],
  requestBody: { model: 'model-a' },
  totalTokens: 120,
  meta: {
    fillMode: 'llm',
    scenario: 'auto',
    storageMode: 'json',
    updateMode: 'merge',
    targetSheetKeys: [],
    presetName: '默认预设',
  },
};

const PLOT_SAMPLE_TRUNCATED = {
  tasks: [
    { taskId: 't1', taskName: '主线推进', stage: 1, presetName: '剧情预设', segments: [{ role: 'user', content: '推进', tokens: 30 }], totalTokens: 30 },
  ],
  truncatedToFirstStage: true,
  meta: { virtualInput: '模拟输入', hasExistingUserMessage: false as const },
};

function mockPreviewServices() {
  vi.doMock('../../../src/service/preview/prompt-preview-gate', () => ({
    evaluatePromptPreviewGate_ACU: previewGate,
  }));
  vi.doMock('../../../src/service/preview/table-fill-prompt-preview', () => ({
    previewTableFillPrompt_ACU: previewTableFill,
  }));
  vi.doMock('../../../src/service/preview/plot-prompt-preview', () => ({
    previewPlotPrompts_ACU: previewPlot,
  }));
}

function findButton(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find(b => (b.textContent ?? '').includes(text)) as HTMLButtonElement | undefined;
}

async function tick(times = 6) {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

/* ---------- FormFillPage mount kit（底本 form-fill-page.test.ts） ---------- */

function createFormFillSettings() {
  return {
    autoUpdateThreshold: 3,
    autoUpdateFrequency: 2,
    updateBatchSize: 2,
    manualUpdateContextDepth: null,
    manualUpdateBatchSize: null,
    maxConcurrentGroups: 1,
    skipUpdateFloors: 0,
    retainRecentLayers: 100,
    autoUpdateTokenThreshold: 500,
    tableMaxRetries: 3,
    tableEditLastPairOnly: true,
    tableContextExtractTags: '',
    tableContextExtractRules: [{ start: '<正文>', end: '</正文>' }],
    tableContextExcludeTags: '',
    tableContextExcludeRules: [{ start: '<think>', end: '</think>' }],
    storageMode: 'native',
    apiPresets: [{ name: 'fast', apiMode: 'custom', apiConfig: { url: '', apiKey: '', model: '', useMainApi: true, max_tokens: 1000, temperature: 1 }, tavernProfile: '' }],
    defaultApiPresetName: 'fast',
    apiPresetBindingsByChat: {},
    tableApiPreset: '',
    manualSelectedTables: [],
    hasManualSelection: false,
    charCardPrompt: [
      { role: 'SYSTEM', content: '系统段', deletable: true },
      { role: 'USER', content: '主任务', mainSlot: 'A', isMain: true, deletable: false },
      { role: 'USER', content: '数据段', mainSlot: 'B', isMain2: true, deletable: false },
    ],
  } as any;
}

function createTableData() {
  return {
    sheet_a: { name: '角色状态', content: [['id'], ['1']], updateConfig: { updateFrequency: -1, skipFloors: -1 } },
    sheet_b: { name: '事件记录', content: [['id'], ['1'], ['2']], updateConfig: { updateFrequency: -1, skipFloors: -1 } },
  };
}

async function mountFormFillPage() {
  vi.resetModules();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  const { ref, computed } = await import('vue');
  const settings = createFormFillSettings();
  const worldbookConfig: any = {
    source: 'character',
    manualSelection: [],
    enabledEntries: {},
    injectionTarget: 'character',
  };

  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    settings_ACU: settings,
    currentChatFileIdentifier_ACU: 'chat-form-fill',
    currentJsonTableData_ACU: createTableData(),
    getCurrentIsolationKey_ACU: () => '',
    coreApisAreReady_ACU: true,
    _set_manualExtraHint_ACU: vi.fn(),
    abortAllActiveRequests_ACU: vi.fn(),
    _set_wasStoppedByUser_ACU: vi.fn(),
    _set_isAutoUpdatingCard_ACU: vi.fn(),
  }));
  vi.doMock('../../../src/service/settings/settings-service', () => ({
    saveSettings_ACU: vi.fn(() => ({ saved: true, storageType: 'memory' })),
    setGlobalPlotEnabled_ACU: vi.fn(),
    setZeroTkOccupyMode_ACU: vi.fn(),
    setSummaryVectorIndexMode_ACU: vi.fn(),
  }));
  vi.doMock('../../../src/service/chat/chat-service', () => ({
    getChatArray_ACU: () => [
      { is_user: true, mes: 'u1' },
      { is_user: false, mes: 'a1' },
      { is_user: true, mes: 'u2' },
      { is_user: false, mes: 'a2' },
      { is_user: false, mes: 'a3' },
    ],
  }));
  vi.doMock('../../../src/service/settings/settings-readers', () => ({
    getCurrentWorldbookConfig_ACU: () => worldbookConfig,
    getCurrentCharSettings_ACU: () => ({ worldbookConfig }),
    getCurrentTableDisplayData_ACU: () => createTableData(),
    hasRuntimeTableData_ACU: () => true,
  }));
  vi.doMock('../../../src/presentation-v2/composables/useTableTemplatePresets', () => ({
    useTableTemplatePresets: () => ({
      busy: ref(false),
      message: ref(null),
      selectedGlobalPreset: ref('global-A'),
      selectedGlobalPresetValue: ref('global:global-A'),
      selectedChatPreset: ref('global:global-A'),
      selectedChatPresetLabel: ref('global-A（全局预设）'),
      isChatOverridden: computed(() => false),
      chatPresetItems: ref([{ value: 'global:', label: '默认预设（全局）', meta: '2 张表' }]),
      chatArchiveItems: ref([]),
      runtimeTemplateItem: ref(null),
      runtimeDiffersFromLibrary: ref(false),
      runtimeTemplateAvailable: ref(false),
      chatSnapshotDiffersFromLibrary: ref(false),
      refresh: vi.fn(),
      selectGlobalPreset: vi.fn(async () => {}),
      selectChatPreset: vi.fn(async () => {}),
      importPresetForCurrentChat: vi.fn(async () => {}),
      restoreArchivedChatTemplate: vi.fn(async () => {}),
      exportTemplate: vi.fn(),
    }),
  }));
  vi.doMock('../../../src/presentation-v2/composables/useTablePresetManagement', () => ({
    useTablePresetManagement: () => ({
      drawerView: ref('closed'),
      isDrawerOpen: computed(() => false),
      title: computed(() => ''),
      busy: ref(false),
      message: ref(null),
      presetMeta: ref([]),
      defaultPresetName: ref('global-A'),
      refresh: vi.fn(),
      openManage: vi.fn(),
      closeDrawer: vi.fn(),
      openVisualizer: vi.fn(async () => {}),
      editPreset: vi.fn(async () => {}),
      setAsDefault: vi.fn(async () => {}),
      deletePreset: vi.fn(async () => {}),
      exportPreset: vi.fn(),
      renamePreset: vi.fn(async () => {}),
      createBlankPreset: vi.fn(async () => {}),
    }),
  }));
  vi.doMock('../../../src/service/table/storage-mode', () => ({
    getCurrentStorageMode: () => settings.storageMode,
  }));
  vi.doMock('../../../src/service/template/chat-scope', () => ({
    getSortedSheetKeys_ACU: (data: any) => Object.keys(data).filter(k => k.startsWith('sheet_')),
    // 同文件内 FormFill 用例先注册的部分 mock 会遗留到 Plot 用例的导入链，这里补全导出
    getCurrentChatPlotScopeState_ACU: () => null,
    clearCurrentChatPlotScopeState_ACU: vi.fn(),
  }));
  vi.doMock('../../../src/service/template/template-preset-service', () => ({
    getActiveTemplatePresetMeta_ACU: () => ({ displayName: '默认预设', scopeLabel: '全局' }),
  }));
  vi.doMock('../../../src/service/table/table-history', () => ({
    collectV2CheckpointFloorsFromChat_ACU: () => [],
    resolveTableHistoryStateFromChat_ACU: () => ({
      latestAiMessageIndex: 4,
      latestDataMessageIndex: 3,
      lastTrackedUpdateMessageIndex: -1,
      latestDataAiFloor: 2,
      lastTrackedUpdateAiFloor: 0,
      hasAnyData: true,
      hasTrackedUpdate: false,
    }),
  }));
  vi.doMock('../../../src/service/table/table-storage-strategy', () => ({
    reloadStorageProvider: vi.fn(async () => {}),
    switchStorageMode: vi.fn(async () => {}),
  }));
  vi.doMock('../../../src/service/table/update-orchestrator', () => ({
    orchestrateManualUpdate_ACU: vi.fn(async () => ({ success: true })),
    orchestrateManualCatchUp_ACU: vi.fn(async () => ({ success: true, outcome: 'complete', committedBucketCount: 0 })),
    prepareManualCatchUpPlan_ACU: vi.fn(async () => ({ success: true, plan: null })),
    processUpdatesBatch_ACU: vi.fn(async () => ({ success: true })),
    executeCardUpdateCore_ACU: vi.fn(async () => ({ success: true, modifiedKeys: [] })),
  }));
  vi.doMock('../../../src/service/ai/ai-service', () => ({
    getConnectionManagerProfiles_ACU: (): any[] => [],
    fetchAvailableModels_ACU: vi.fn(async () => ({ success: true, models: [] })),
  }));
  vi.doMock('../../../src/service/worldbook/pipeline', () => ({
    refreshMergedDataAndNotify_ACU: vi.fn(async () => ({ degraded: false })),
    getWorldbookNames_ACU: vi.fn(async () => ['world-X']),
    getLorebookEntriesByNames_ACU: vi.fn(async () => ({})),
  }));
  vi.doMock('../../../src/service/worldbook/worldbook-service', () => ({
    getCurrentCharPrimaryLorebook_ACU: vi.fn(async () => 'CharBookFF'),
    getCharLorebooks_ACU: vi.fn(async () => ({ primary: 'CharBookFF', additional: [] })),
  }));
  mockPreviewServices();
  vi.spyOn(window, 'confirm').mockReturnValue(false);

  const mount = await import('../../../src/presentation-v2/bootstrap/mount');
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ uiTierV2: { tier: 'high' }, router: { activePageId: 'form-fill' } }));
  await mount.openAcuV2App();
  await tick();
}

/* ---------- PlotPage mount kit（底本 fill-mode-plot-panels.test.ts） ---------- */

function createPlotSettings() {
  return {
    apiMode: 'custom',
    apiConfig: { url: '', apiKey: '', model: '', useMainApi: true, max_tokens: 60000, temperature: 1 },
    tavernProfile: '',
    streamingEnabled: false,
    apiPresets: [
      { name: 'gpt-mini', apiMode: 'custom', apiConfig: { url: 'https://x', apiKey: 'k', model: 'm', useMainApi: false, max_tokens: 1000, temperature: 1 } },
    ],
    defaultApiPresetName: 'gpt-mini',
    apiPresetBindingsByChat: {},
    plotSettings: {
      enabled: true,
      promptPresets: [
        { name: '记忆召回', plotTasks: [{ id: 't1', name: 'A', stage: 1, order: 0 }] },
        { name: '低速推进', plotTasks: [{ id: 't2', name: 'B', stage: 1, order: 0 }, { id: 't3', name: 'C', stage: 2, order: 1 }] },
      ],
      lastUsedPresetName: '记忆召回',
      rateMain: 1,
      ratePersonal: 1,
      rateErotic: 0,
      rateCuckold: 1,
      recallCount: 20,
      plotWorldbookConfig: { source: 'character', manualSelection: [], enabledEntries: {} },
    },
    plotApiPreset: '',
    plotTaskApiPresetOverridesById: {},
    contentOptimizationSettings: { apiPreset: '' },
    tableApiPresetOverridesByName: {},
  } as any;
}

async function mountPlotPage() {
  vi.resetModules();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ uiTierV2: { tier: 'high' }, router: { activePageId: 'plot' } }));

  const settings = createPlotSettings();
  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    settings_ACU: settings,
    currentChatFileIdentifier_ACU: 'chat-plot',
    currentJsonTableData_ACU: null,
    getCurrentIsolationKey_ACU: () => '',
    coreApisAreReady_ACU: true,
  }));
  vi.doMock('../../../src/service/settings/settings-service', () => ({
    saveSettings_ACU: vi.fn(),
    setGlobalPlotEnabled_ACU: vi.fn(),
  }));
  vi.doMock('../../../src/service/ai/ai-service', () => ({
    getConnectionManagerProfiles_ACU: () => [],
    fetchAvailableModels_ACU: vi.fn(async () => ({ success: true, models: [] })),
  }));
  vi.doMock('../../../src/service/worldbook/pipeline', () => ({
    getWorldbookNames_ACU: vi.fn(async () => ['world-A']),
    getLorebookEntriesByNames_ACU: vi.fn(async () => ({})),
  }));
  vi.doMock('../../../src/service/worldbook/worldbook-service', () => ({
    getCurrentCharPrimaryLorebook_ACU: vi.fn(async () => 'CharBook'),
    getCurrentCharacterWorldbookBinding_ACU: vi.fn(async () => ({
      primary: 'CharBook',
      additional: [],
      orderedNames: ['CharBook'],
      apiSource: 'getCharWorldbookNames',
    })),
    getCharLorebooks_ACU: vi.fn(async () => ({ primary: 'CharBook', additional: [] })),
  }));
  vi.doMock('../../../src/service/agent/agent-worldbook-takeover', () => ({
    getPlotAgentWorldbookSnapshot_ACU: () => ({ active: false, selectionSignature: '', createdAt: 0, books: {} }),
    refreshPlotAgentWorldbookSnapshotFromWorldbooks_ACU: vi.fn(async () => ({ active: false, selectionSignature: '', createdAt: 0, books: {} })),
  }));
  vi.doMock('../../../src/service/template/chat-scope', () => ({
    getSortedSheetKeys_ACU: (data: any) => Object.keys(data).filter(k => k.startsWith('sheet_')),
    getCurrentChatPlotScopeState_ACU: () => null,
    clearCurrentChatPlotScopeState_ACU: vi.fn(),
  }));
  mockPreviewServices();

  // 剧情推进面板只在 LLM模型逻辑召回/交火模式下出现：经真实权威存储播种所选模式。
  const profileRepo = await import('../../../src/data/repositories/profile-repo');
  profileRepo.globalMeta_ACU.formFillPreferencesGlobal = {
    schemaVersion: 1,
    selectedMode: 'llm',
    classic: { recentChronicleRows: 15 },
    vector: { resultCount: 200 },
  } as any;

  const mount = await import('../../../src/presentation-v2/bootstrap/mount');
  await mount.openAcuV2App();
  await tick();
}

beforeEach(() => {
  installLocalStorageStub();
  vi.restoreAllMocks();
  previewGate.mockReset();
  previewTableFill.mockReset();
  previewPlot.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FormFillPage 提示词预览入口', () => {
  // FormFillPage 全页挂载较重，上游合并后依赖增多，单跑已 14s+，并行负载下会越过默认 15s 线。
  it('gate 禁用时按钮 disabled 且 title 为 blockers reason 拼接，编辑按钮不受影响', { timeout: 60000 }, async () => {
    previewGate.mockReturnValue({
      tableFill: {
        available: false,
        blockers: [
          { feature: 'api', reason: '未配置 API 预设' },
          { feature: 'preset', reason: '未选择填表预设' },
        ],
      },
      plot: { available: true, blockers: [] },
    });
    previewTableFill.mockResolvedValue(TABLE_FILL_SAMPLE);
    await mountFormFillPage();

    const btn = findButton('预览填表提示词');
    expect(btn).toBeTruthy();
    expect(btn!.hasAttribute('disabled')).toBe(true);
    expect(btn!.getAttribute('title')).toBe('未配置 API 预设；未选择填表预设');

    const editBtn = findButton('编辑提示词');
    expect(editBtn).toBeTruthy();
    expect(editBtn!.hasAttribute('disabled')).toBe(false);
    expect(previewTableFill).not.toHaveBeenCalled();
  });

  it('gate 可用时点击打开抽屉并按 auto 生成，切换管线重新生成', async () => {
    previewGate.mockReturnValue(GATE_OK());
    previewTableFill.mockResolvedValue(TABLE_FILL_SAMPLE);
    await mountFormFillPage();

    const btn = findButton('预览填表提示词');
    expect(btn!.hasAttribute('disabled')).toBe(false);
    btn!.click();
    await tick();

    expect(document.querySelector('.acu-v2-prompt-preview-drawer')).toBeTruthy();
    expect(previewTableFill).toHaveBeenCalledWith({ scenario: 'auto' });
    expect(document.querySelector('.acu-v2-prompt-preview-drawer')!.textContent).toContain('自动填表');

    const catchUpTab = Array.from(document.querySelectorAll('.acu-segmented__item'))
      .find(el => el.textContent?.includes('一键追平')) as HTMLElement | undefined;
    expect(catchUpTab).toBeTruthy();
    catchUpTab!.click();
    await tick();

    expect(previewTableFill).toHaveBeenLastCalledWith({ scenario: 'catch_up' });
  });
});

describe('PlotPage 提示词预览入口', () => {
  it('gate 禁用时按钮 disabled 且 title 为 blockers reason', async () => {
    previewGate.mockReturnValue({
      tableFill: { available: true, blockers: [] },
      plot: { available: false, blockers: [{ feature: 'mode', reason: '仅 LLM 模式可用' }] },
    });
    previewPlot.mockResolvedValue(PLOT_SAMPLE_TRUNCATED);
    await mountPlotPage();

    const btn = findButton('预览剧情提示词');
    expect(btn).toBeTruthy();
    expect(btn!.hasAttribute('disabled')).toBe(true);
    expect(btn!.getAttribute('title')).toBe('仅 LLM 模式可用');
    expect(previewPlot).not.toHaveBeenCalled();
  });

  it('点击打开抽屉，输入模拟文本并生成，展示任务与截断提示', async () => {
    previewGate.mockReturnValue(GATE_OK());
    previewPlot.mockResolvedValue(PLOT_SAMPLE_TRUNCATED);
    await mountPlotPage();

    const btn = findButton('预览剧情提示词');
    expect(btn).toBeTruthy();
    expect(btn!.hasAttribute('disabled')).toBe(false);
    btn!.click();
    await tick();

    const drawer = document.querySelector('.acu-v2-prompt-preview-drawer');
    expect(drawer).toBeTruthy();
    expect(previewPlot).not.toHaveBeenCalled();

    const textarea = drawer!.querySelector('textarea') as HTMLTextAreaElement | null;
    expect(textarea).toBeTruthy();
    expect(textarea!.placeholder).toContain('留空则 $7/$8 为空');
    textarea!.value = '模拟输入';
    textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(2);

    const genBtn = findButton('生成预览');
    expect(genBtn).toBeTruthy();
    genBtn!.click();
    await tick();

    expect(previewPlot).toHaveBeenCalledWith('模拟输入');
    const text = document.querySelector('.acu-v2-prompt-preview-drawer')!.textContent ?? '';
    expect(text).toContain('主线推进');
    expect(text).toContain('第 1 阶段');
    expect(text).toContain('为避免真实请求，仅展示第一阶段任务的提示词，后续阶段未执行');
  });
});
