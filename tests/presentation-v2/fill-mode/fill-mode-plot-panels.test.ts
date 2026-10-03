/**
 * FillModePage 剧情推进面板集成 — LLM模型逻辑召回模式下的剧情推进面板
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

async function mountPlotPage(opts: {
  devOptions?: { plotAdvanced?: boolean };
  settings?: any;
  resolveCharacterBinding?: () => Promise<any>;
} = {}) {
  vi.resetModules();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  const persisted: any = { uiTierV2: { tier: 'high' }, router: { activePageId: 'fill-mode' } };
  if (opts.devOptions) persisted.devOptions = opts.devOptions;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));

  const settings = opts.settings ?? createSettings();
  const mockGetCurrentCharacterWorldbookBinding = vi.fn(
    opts.resolveCharacterBinding ?? (async () => ({
      primary: 'CharBook',
      additional: [],
      orderedNames: ['CharBook'],
      apiSource: 'getCharWorldbookNames',
    })),
  );

  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    settings_ACU: settings,
    currentChatFileIdentifier_ACU: 'chat-plot',
    currentJsonTableData_ACU: null,
    getCurrentIsolationKey_ACU: () => '',
    coreApisAreReady_ACU: true,
  }));
  vi.doMock('../../../src/service/settings/settings-service', () => ({
    saveSettings_ACU: vi.fn(),
    setGlobalPlotEnabled_ACU: vi.fn((val: boolean) => { settings.plotSettings.enabled = val; return val; }),
  }));
  vi.doMock('../../../src/service/ai/ai-service', () => ({
    getConnectionManagerProfiles_ACU: () => [],
    fetchAvailableModels_ACU: vi.fn(async () => ({ success: true, models: [] })),
  }));
  vi.doMock('../../../src/service/worldbook/pipeline', () => ({
    getWorldbookNames_ACU: vi.fn(async () => ['world-A', 'world-B']),
    getLorebookEntriesByNames_ACU: vi.fn(async () => ({
      'CharBook': [
        { uid: 1, comment: '角色设定', name: '角色设定', enabled: true },
        { uid: 2, comment: 'TavernDB-ACU-OutlineTable', name: 'TavernDB-ACU-OutlineTable', enabled: true },
        { uid: 3, comment: '世界观', name: '世界观', enabled: true },
      ],
    })),
  }));
  vi.doMock('../../../src/service/worldbook/worldbook-service', () => ({
    getCurrentCharPrimaryLorebook_ACU: vi.fn(async () => 'CharBook'),
    getCurrentCharacterWorldbookBinding_ACU: mockGetCurrentCharacterWorldbookBinding,
    getCharLorebooks_ACU: vi.fn(async () => ({ primary: 'CharBook', additional: [] })),
  }));
  vi.doMock('../../../src/service/agent/agent-worldbook-takeover', () => ({
    getPlotAgentWorldbookSnapshot_ACU: () => ({ active: false, selectionSignature: '', createdAt: 0, books: {} }),
    refreshPlotAgentWorldbookSnapshotFromWorldbooks_ACU: vi.fn(async () => ({ active: false, selectionSignature: '', createdAt: 0, books: {} })),
  }));

  // 剧情推进面板只在 LLM模型逻辑召回模式 / 交火模式下出现：经真实权威存储播种所选模式。
  const profileRepo = await import('../../../src/data/repositories/profile-repo');
  profileRepo.globalMeta_ACU.formFillPreferencesGlobal = {
    schemaVersion: 1,
    selectedMode: 'llm',
    classic: { recentChronicleRows: 15 },
    vector: { resultCount: 200 },
  };
  const mount = await import('../../../src/presentation-v2/bootstrap/mount');
  await mount.openAcuV2App();
  await new Promise(r => setTimeout(r, 0));
  return { mount, settings, mockGetCurrentCharacterWorldbookBinding };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PlotPage', () => {
  it('渲染主区头部与状态行，header 不再放启用 toggle', async () => {
    const { mount, settings } = await mountPlotPage();

    const page = document.querySelector('.acu-v2-fill-mode-page');
    expect(page).not.toBeNull();
    const text = page!.textContent || '';
    expect(text).toContain('剧情推进');
    expect(text).toContain('剧情推进预设');
    expect(text).toContain('剧情推进世界书');
    expect(text).toContain('记忆召回'); // active preset name
    expect(Array.from(page!.querySelectorAll('button')).some(b => b.textContent?.trim() === '刷新')).toBe(false);

    const toggle = document.querySelector('button[data-acu-plot-toggle="enabled"]') as HTMLButtonElement | null;
    expect(toggle).toBeNull();

    expect(text).not.toContain('LLM / continuation API 预设');
    const disguiseToggle = page!.querySelector<HTMLButtonElement>('[data-acu-plot-disguise-disabled-toggle]')!;
    expect(disguiseToggle.getAttribute('aria-checked')).toBe('false');
    disguiseToggle.click();
    await Promise.resolve();
    expect(settings.plotSendDisguiseDisabled).toBe(true);
    expect(disguiseToggle.getAttribute('aria-checked')).toBe('true');
    const { usePlotPresetStore } = await import('../../../src/presentation-v2/stores/plot-preset-store');
    const plotStore = usePlotPresetStore();
    plotStore.resetCurrentToDefaults();
    expect(settings.plotSendDisguiseDisabled).toBe(true);
    disguiseToggle.click();
    await Promise.resolve();
    expect(settings.plotSendDisguiseDisabled).toBe(false);

    const repo = await import('../../../src/data/repositories/profile-repo');
    const preferences = await import('../../../src/service/fill-mode/fill-mode-preferences');
    const legacy = { ...repo.globalMeta_ACU.formFillPreferencesGlobal, llm: { apiPresetName: '旧字段' } };
    repo.globalMeta_ACU.formFillPreferencesGlobal = legacy;
    const read = preferences.readFillModePreferences_ACU();
    expect(repo.globalMeta_ACU.formFillPreferencesGlobal).toBe(legacy);
    expect(read.preferences).not.toHaveProperty('llm');
    const save = vi.spyOn(repo, 'saveGlobalMeta_ACU').mockReturnValue(true);
    const saved = preferences.saveFillModePreferences_ACU(read.preferences);
    expect(saved.ok).toBe(true);
    expect(repo.globalMeta_ACU.formFillPreferencesGlobal).not.toHaveProperty('llm');
    expect(save).toHaveBeenCalledOnce();
    save.mockRestore();

    mount.__resetAcuV2MountForTests();
  });

  it('开发者选项关闭时，编辑抽屉不渲染"匹配替换"字段', async () => {
    const { mount } = await mountPlotPage();

    const editButton = Array.from(document.querySelectorAll('button'))
      .find(b => b.getAttribute('title') === '编辑当前预设') as HTMLButtonElement | undefined;
    expect(editButton).not.toBeUndefined();
    editButton!.click();
    await new Promise(r => setTimeout(r, 0));

    const drawer = document.querySelector('.acu-v2-drawer');
    expect(drawer).not.toBeNull();
    expect(drawer!.textContent || '').not.toContain('匹配替换（进阶）');
    const footerButtons = Array.from(drawer!.querySelectorAll<HTMLButtonElement>('.acu-v2-plot-drawer__actions button'));
    expect(footerButtons[0].textContent?.trim()).toBe('关闭');
    expect(footerButtons[0].classList.contains('acu-btn--default')).toBe(true);
    expect(drawer!.textContent || '').not.toContain('取消');
    mount.__resetAcuV2MountForTests();
  });

  it('开发者选项开启时，在编辑抽屉渲染"匹配替换"字段（含 5 个数字字段）', async () => {
    const { mount } = await mountPlotPage({ devOptions: { plotAdvanced: true } });

    expect(document.querySelector('.acu-v2-fill-mode-page')!.textContent || '').not.toContain('匹配替换（进阶）');

    const editButton = Array.from(document.querySelectorAll('button'))
      .find(b => b.getAttribute('title') === '编辑当前预设') as HTMLButtonElement | undefined;
    expect(editButton).not.toBeUndefined();
    editButton!.click();
    await new Promise(r => setTimeout(r, 0));

    const drawer = document.querySelector('.acu-v2-drawer');
    expect(drawer).not.toBeNull();
    const drawerText = drawer!.textContent || '';
    expect(drawerText).toContain('匹配替换（进阶）');
    expect(drawerText).toContain('随当前剧情推进预设保存');
    expect(drawerText.indexOf('标签筛选')).toBeLessThan(drawerText.indexOf('匹配替换（进阶）'));
    expect(drawerText.indexOf('匹配替换（进阶）')).toBeLessThan(drawerText.indexOf('当前任务使用的 API'));

    const inputs = Array.from(document.querySelectorAll('.acu-v2-plot-match-fields input[type="number"]'));
    expect(inputs).toHaveLength(5);

    mount.__resetAcuV2MountForTests();
  });

  it('编辑抽屉保存匹配替换参数到当前剧情推进预设', async () => {
    const { mount, settings } = await mountPlotPage({ devOptions: { plotAdvanced: true } });

    const editButton = Array.from(document.querySelectorAll('button'))
      .find(b => b.getAttribute('title') === '编辑当前预设') as HTMLButtonElement | undefined;
    expect(editButton).not.toBeUndefined();
    editButton!.click();
    await new Promise(r => setTimeout(r, 0));

    const drawer = document.querySelector('.acu-v2-drawer') as HTMLElement | null;
    expect(drawer).not.toBeNull();
    const inputs = Array.from(drawer!.querySelectorAll('.acu-v2-plot-match-fields input[type="number"]')) as HTMLInputElement[];
    expect(inputs).toHaveLength(5);

    const values = ['2.25', '1.75', '0.5', '1.25', '42'];
    for (let index = 0; index < inputs.length; index += 1) {
      inputs[index].value = values[index];
      inputs[index].dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    }

    const saveButton = Array.from(drawer!.querySelectorAll('button'))
      .find(button => (button.textContent || '').includes('保存预设')) as HTMLButtonElement | undefined;
    expect(saveButton).not.toBeUndefined();
    saveButton!.click();
    await new Promise(r => setTimeout(r, 0));

    const savedPreset = settings.plotSettings.promptPresets.find((preset: any) => preset.name === '记忆召回');
    expect(savedPreset.rateMain).toBe(2.25);
    expect(savedPreset.ratePersonal).toBe(1.75);
    expect(savedPreset.rateErotic).toBe(0.5);
    expect(savedPreset.rateCuckold).toBe(1.25);
    expect(savedPreset.recallCount).toBe(42);
    expect(settings.plotSettings.rateMain).toBe(2.25);
    expect(settings.plotSettings.recallCount).toBe(42);

    mount.__resetAcuV2MountForTests();
  });

  it('任务 API 区域不暴露开发编号和 fallback 术语', async () => {
    const { mount } = await mountPlotPage();

    const editButton = Array.from(document.querySelectorAll('button'))
      .find(b => b.getAttribute('title') === '编辑当前预设') as HTMLButtonElement | undefined;
    expect(editButton).not.toBeUndefined();
    editButton!.click();
    await new Promise(r => setTimeout(r, 0));

    const drawer = document.querySelector('.acu-v2-drawer');
    expect(drawer).not.toBeNull();
    const text = drawer!.textContent || '';
    expect(text).toContain('当前任务使用的 API');
    expect(text).not.toContain('D23.4');
    expect(text).not.toContain('override');
    expect(text).not.toContain('三层 fallback');

    mount.__resetAcuV2MountForTests();
  });

  it('编辑预设抽屉的任务提示词段提供图标式上移和下移按钮', async () => {
    const { mount } = await mountPlotPage();

    const editButton = Array.from(document.querySelectorAll('button'))
      .find(b => b.getAttribute('title') === '编辑当前预设') as HTMLButtonElement | undefined;
    expect(editButton).not.toBeUndefined();
    editButton!.click();
    await new Promise(r => setTimeout(r, 0));

    const promptSegments = document.querySelector('.acu-v2-drawer .acu-prompt-segs') as HTMLElement | null;
    expect(promptSegments).not.toBeNull();
    const moveUpButton = promptSegments!.querySelector('button[title="上移该段"]') as HTMLButtonElement | null;
    const moveDownButton = promptSegments!.querySelector('button[title="下移该段"]') as HTMLButtonElement | null;
    expect(moveUpButton).not.toBeNull();
    expect(moveDownButton).not.toBeNull();
    expect(moveUpButton!.textContent?.trim()).toBe('');
    expect(moveDownButton!.textContent?.trim()).toBe('');

    mount.__resetAcuV2MountForTests();
  });

  it('编辑预设抽屉包含标签筛选，并将规则保存进预设', async () => {
    const { mount, settings } = await mountPlotPage();

    const editButton = Array.from(document.querySelectorAll('button'))
      .find(b => b.getAttribute('title') === '编辑当前预设') as HTMLButtonElement | undefined;
    expect(editButton).not.toBeUndefined();
    editButton!.click();
    await new Promise(r => setTimeout(r, 0));

    const drawer = document.querySelector('.acu-v2-drawer') as HTMLElement | null;
    expect(drawer).not.toBeNull();
    expect(drawer!.textContent || '').toContain('标签筛选');
    expect(drawer!.textContent || '').not.toContain('剧情上下文过滤');
    expect(drawer!.textContent || '').toContain('提取规则');
    expect(drawer!.textContent || '').toContain('排除规则');

    const filterSection = Array.from(drawer!.querySelectorAll('.acu-v2-form__section'))
      .find(section => (section.textContent || '').includes('标签筛选')) as HTMLElement | undefined;
    expect(filterSection).not.toBeUndefined();

    // 规则列表默认折叠：先点 header 展开，再寻找添加按钮。
    const headers = Array.from(filterSection!.querySelectorAll<HTMLButtonElement>('.acu-rule-pair-list__header'));
    expect(headers.length).toBe(2);
    headers.forEach(h => h.click());
    await new Promise(r => setTimeout(r, 0));

    const addExtractButton = Array.from(filterSection!.querySelectorAll('button'))
      .find(button => (button.textContent || '').includes('添加提取规则')) as HTMLButtonElement | undefined;
    const addExcludeButton = Array.from(filterSection!.querySelectorAll('button'))
      .find(button => (button.textContent || '').includes('添加排除规则')) as HTMLButtonElement | undefined;
    expect(addExtractButton).not.toBeUndefined();
    expect(addExcludeButton).not.toBeUndefined();

    addExtractButton!.click();
    addExcludeButton!.click();
    await new Promise(r => setTimeout(r, 0));

    const inputs = Array.from(filterSection!.querySelectorAll('input.acu-input')) as HTMLInputElement[];
    expect(inputs.length).toBeGreaterThanOrEqual(4);
    const values = ['<recall>', '</recall>', '<thinking>', '</thinking>'];
    for (let index = 0; index < 4; index += 1) {
      const input = inputs[index];
      input.value = values[index];
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    }

    const saveButton = Array.from(drawer!.querySelectorAll('button'))
      .find(button => (button.textContent || '').includes('保存预设')) as HTMLButtonElement | undefined;
    expect(saveButton).not.toBeUndefined();
    saveButton!.click();
    await new Promise(r => setTimeout(r, 0));

    const savedPreset = settings.plotSettings.promptPresets.find((preset: any) => preset.name === '记忆召回');
    expect(savedPreset.contextExtractRules).toEqual([{ start: '<recall>', end: '</recall>' }]);
    expect(savedPreset.contextExcludeRules).toEqual([{ start: '<thinking>', end: '</thinking>' }]);
    expect(savedPreset.contextExtractTags).toBeUndefined();
    expect(savedPreset.contextExcludeTags).toBeUndefined();

    mount.__resetAcuV2MountForTests();
  });

  it('每个 AcuPanel 都附常驻说明信息条（D22.5）', async () => {
    const { mount } = await mountPlotPage();
    const panels = document.querySelectorAll('.acu-v2-fill-mode-page .acu-panel');
    expect(panels.length).toBeGreaterThanOrEqual(2);
    panels.forEach(panel => {
      expect(panel.querySelector('.acu-panel__description-region .acu-info-banner')).not.toBeNull();
    });
    mount.__resetAcuV2MountForTests();
  });

  it('剧情推进 API 预设下拉默认空选项 = "跟随当前活动"，并列出 apiStore 预设', async () => {
    const { mount } = await mountPlotPage();

    const panel = Array.from(document.querySelectorAll('.acu-v2-fill-mode-page .acu-panel'))
      .find(p => (p.textContent || '').includes('剧情推进 API 预设'));
    expect(panel).not.toBeUndefined();
    const acuSelect = panel!.querySelector('.acu-select') as HTMLElement | null;
    expect(acuSelect).not.toBeNull();
    const trigger = acuSelect!.querySelector('.acu-select__trigger') as HTMLButtonElement;
    expect(trigger.textContent).toContain('跟随当前活动 API（gpt-mini）');
    trigger.click();
    await new Promise(r => setTimeout(r, 0));
    const items = Array.from(acuSelect!.querySelectorAll('.acu-select__item'));
    const labels = items.map(li => li.textContent?.trim() || '');
    expect(labels[0]).toBe('跟随当前活动 API（gpt-mini）');
    expect(labels.some(l => l === 'gpt-mini')).toBe(true);

    mount.__resetAcuV2MountForTests();
  });

  it('点击"管理预设"按钮打开抽屉并显示已有预设', async () => {
    const { mount } = await mountPlotPage();

    const gearButton = Array.from(document.querySelectorAll('button'))
      .find(b => b.getAttribute('title') === '管理预设') as HTMLButtonElement | undefined;
    expect(gearButton).not.toBeUndefined();
    gearButton!.click();
    await new Promise(r => setTimeout(r, 0));

    const drawer = document.querySelector('.acu-v2-drawer');
    expect(drawer).not.toBeNull();
    expect(drawer!.textContent || '').toContain('管理剧情推进预设');
    expect(drawer!.textContent || '').toContain('记忆召回');

    mount.__resetAcuV2MountForTests();
  });

  it('剧情推进预设下拉直接使用 AcuPresetDropdown，显示任务数并支持切换与星标', async () => {
    const { mount, settings } = await mountPlotPage();

    const trigger = document.querySelector('#fill-mode-plot-panel .acu-preset-dd__trigger') as HTMLButtonElement | null;
    expect(trigger).not.toBeNull();
    expect(trigger!.textContent).toContain('记忆召回');

    trigger!.click();
    await Promise.resolve();
    const items = Array.from(document.querySelectorAll('#fill-mode-plot-panel .acu-preset-dd__item')) as HTMLElement[];
    const defaultItem = items.find(item => item.textContent?.includes('默认预设'));
    expect(defaultItem).not.toBeUndefined();
    expect(defaultItem!.textContent).toContain('1 个任务');
    const slowItem = items.find(item => item.textContent?.includes('低速推进'));
    expect(slowItem).not.toBeUndefined();
    expect(slowItem!.textContent).toContain('2 个任务');
    slowItem!.click();
    await Promise.resolve();
    expect(trigger!.textContent).toContain('低速推进');

    trigger!.click();
    await Promise.resolve();
    const stars = Array.from(document.querySelectorAll('#fill-mode-plot-panel .acu-preset-dd__star')) as HTMLButtonElement[];
    stars.find(star => star.closest('.acu-preset-dd__item')?.textContent?.includes('低速推进'))!.click();
    await Promise.resolve();
    expect(settings.plotSettings.lastUsedPresetName).toBe('低速推进');

    mount.__resetAcuV2MountForTests();
  });

  it('剧情推进预设下拉支持选择默认预设，并可将默认预设设为全局默认', async () => {
    const { mount, settings } = await mountPlotPage();

    const trigger = document.querySelector('#fill-mode-plot-panel .acu-preset-dd__trigger') as HTMLButtonElement | null;
    expect(trigger).not.toBeNull();

    trigger!.click();
    await Promise.resolve();
    const defaultItem = Array.from(document.querySelectorAll('#fill-mode-plot-panel .acu-preset-dd__item'))
      .find(item => item.textContent?.includes('默认预设')) as HTMLElement | undefined;
    expect(defaultItem).not.toBeUndefined();
    defaultItem!.click();
    await Promise.resolve();

    expect(trigger!.textContent).toContain('记忆召回');
    expect(settings.plotPresetBindings?.['chat-plot']).toBeUndefined();

    trigger!.click();
    await Promise.resolve();
    const defaultStar = Array.from(document.querySelectorAll('#fill-mode-plot-panel .acu-preset-dd__star'))
      .find(star => star.closest('.acu-preset-dd__item')?.textContent?.includes('默认预设')) as HTMLButtonElement | undefined;
    expect(defaultStar).not.toBeUndefined();
    defaultStar!.click();
    await Promise.resolve();

    expect(settings.plotSettings.lastUsedPresetName).toBe('');
    expect((document.querySelector('.acu-v2-plot-page__status-line') as HTMLElement).textContent || '').toContain('全局默认: 默认预设');

    mount.__resetAcuV2MountForTests();
  });

  it('当前为默认预设时主编辑按钮会从默认新建', async () => {
    const settings = createSettings();
    settings.plotSettings.lastUsedPresetName = '';
    const { mount } = await mountPlotPage({ settings });

    const editButton = document.querySelector('button[title="从默认新建预设"]') as HTMLButtonElement | null;
    expect(editButton).not.toBeNull();
    expect(editButton!.disabled).toBe(false);
    editButton!.click();
    await new Promise(r => setTimeout(r, 0));

    const drawer = document.querySelector('.acu-v2-drawer') as HTMLElement | null;
    expect(drawer).not.toBeNull();
    expect(drawer!.textContent || '').toContain('从默认新建剧情推进预设');
    expect(drawer!.querySelectorAll('.acu-v2-plot-tasks__card')).toHaveLength(1);
    expect(drawer!.querySelector('.acu-v2-plot-tasks__card')?.tagName).toBe('BUTTON');
    const nameInput = drawer!.querySelector('.acu-v2-form__section input.acu-input') as HTMLInputElement | null;
    expect(nameInput).not.toBeNull();
    expect(nameInput!.value).toBe('新预设');

    mount.__resetAcuV2MountForTests();
  });

  it('管理抽屉从默认新建时使用内置默认任务初始化，并可保存为自定义预设', async () => {
    const { mount, settings } = await mountPlotPage();

    const gearButton = Array.from(document.querySelectorAll('button'))
      .find(b => b.getAttribute('title') === '管理预设') as HTMLButtonElement | undefined;
    expect(gearButton).not.toBeUndefined();
    gearButton!.click();
    await new Promise(r => setTimeout(r, 0));

    const createButton = Array.from(document.querySelectorAll('.acu-v2-drawer button'))
      .find(button => (button.textContent || '').includes('从默认新建')) as HTMLButtonElement | undefined;
    expect(createButton).not.toBeUndefined();
    createButton!.click();
    await new Promise(r => setTimeout(r, 0));

    const drawer = document.querySelector('.acu-v2-drawer') as HTMLElement | null;
    expect(drawer).not.toBeNull();
    expect(drawer!.textContent || '').toContain('从默认新建剧情推进预设');
    expect(drawer!.querySelectorAll('.acu-v2-plot-tasks__card')).toHaveLength(1);
    expect(drawer!.querySelector('.acu-v2-plot-tasks__card')?.tagName).toBe('BUTTON');

    const nameInput = drawer!.querySelector('.acu-v2-form__section input.acu-input') as HTMLInputElement | null;
    expect(nameInput).not.toBeNull();
    expect(nameInput!.value).toBe('新预设');

    const saveButton = Array.from(drawer!.querySelectorAll('button'))
      .find(button => (button.textContent || '').includes('保存预设')) as HTMLButtonElement | undefined;
    expect(saveButton).not.toBeUndefined();
    saveButton!.click();
    await new Promise(r => setTimeout(r, 0));

    const savedPreset = settings.plotSettings.promptPresets.find((preset: any) => preset.name === '新预设');
    expect(savedPreset).toBeDefined();
    expect(savedPreset.plotTasks).toHaveLength(1);

    mount.__resetAcuV2MountForTests();
  });

  it('面板导入按钮会导入为预设并切换当前聊天使用', async () => {
    const { mount, settings } = await mountPlotPage();

    const input = document.querySelector('.acu-v2-fill-mode-page .acu-file-button__input') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    const file = new File([
      JSON.stringify([
        {
          name: '导入推进',
          plotTasks: [{ id: 'import-task', name: '导入任务', stage: 1, order: 0 }],
        },
      ]),
    ], 'plot-import.json', { type: 'application/json' });
    Object.defineProperty(input!, 'files', { value: [file], configurable: true });
    input!.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    expect(settings.plotSettings.promptPresets.map((preset: any) => preset.name)).toContain('导入推进');
    expect(settings.plotPresetBindings?.['chat-plot']?.presetName).toBe('导入推进');

    mount.__resetAcuV2MountForTests();
  });

  it('世界书来源选择器支持角色卡来源与手动多选', async () => {
    const { mount, settings } = await mountPlotPage();

    const picker = document.querySelector('.acu-v2-wb-source-picker') as HTMLElement | null;
    expect(picker).not.toBeNull();
    expect(picker!.textContent).not.toContain('当前角色卡所有世界书 · 主册 CharBook');
    expect(document.querySelector('.acu-v2-wb-entry-picker__hint')?.textContent)
      .toContain('目前已选: 角色卡所有世界书 · 主册 CharBook');

    const manualButton = Array.from(picker!.querySelectorAll<HTMLButtonElement>('.acu-segmented__item'))
      .find(button => button.textContent?.trim() === '手动选择')!;
    manualButton.click();
    await Promise.resolve();

    const checkboxes = Array.from(picker!.querySelectorAll<HTMLButtonElement>('button[role="checkbox"]'));
    const worldA = checkboxes.find(button => button.textContent?.trim() === 'world-A')!;
    const worldB = checkboxes.find(button => button.textContent?.trim() === 'world-B')!;
    worldA.click();
    worldB.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(settings.plotSettings.plotWorldbookConfig.source).toBe('manual');
    expect(settings.plotSettings.plotWorldbookConfig.manualSelection).toEqual(['world-A', 'world-B']);
    expect(document.querySelector('.acu-v2-wb-entry-picker__hint')?.textContent).toContain('目前已选: world-A、world-B');
    expect(worldA.getAttribute('aria-checked')).toBe('true');
    expect(worldB.getAttribute('aria-checked')).toBe('true');

    mount.__resetAcuV2MountForTests();
  });

  it('角色世界书 binding 读取失败时显示明确错误且不将失败持久化为空选择', async () => {
    const settings = createSettings();
    const bindingError = new Error('host binding read failed');
    const { mount, mockGetCurrentCharacterWorldbookBinding } = await mountPlotPage({
      settings,
      resolveCharacterBinding: async () => { throw bindingError; },
    });
    await new Promise(r => setTimeout(r, 50));

    const error = document.querySelector('.acu-v2-wb-entries [role="alert"]');
    expect(error?.textContent).toContain('加载角色世界书失败');
    expect(error?.textContent).not.toContain(bindingError.message);
    expect(settings.plotSettings.plotWorldbookConfig.enabledEntries).toEqual({});
    expect(mockGetCurrentCharacterWorldbookBinding).toHaveBeenCalledTimes(1);

    mount.__resetAcuV2MountForTests();
  });

  it('世界书条目列表渲染可见条目并过滤数据库生成条目', async () => {
    const { mount } = await mountPlotPage();
    await new Promise(r => setTimeout(r, 50));

    const entryList = document.querySelector('.acu-v2-wb-entries');
    expect(entryList).not.toBeNull();
    expect(entryList!.textContent || '').not.toContain('角色设定');

    const header = entryList!.querySelector('.acu-v2-wb-entry-group__header') as HTMLButtonElement | null;
    expect(header).not.toBeNull();
    expect(header!.textContent).toContain('2/2 条');
    header!.click();
    await Promise.resolve();

    const text = entryList!.textContent || '';
    expect(text).toContain('角色设定');
    expect(text).toContain('世界观');
    expect(text).not.toContain('TavernDB-ACU-OutlineTable');

    mount.__resetAcuV2MountForTests();
  });

  it('世界书条目区域渲染"全选"和"全不选"按钮', async () => {
    const { mount } = await mountPlotPage();
    await new Promise(r => setTimeout(r, 50));

    const toolbar = document.querySelector('.acu-v2-wb-entry-toolbar');
    expect(toolbar).not.toBeNull();
    const buttons = Array.from(toolbar!.querySelectorAll('button')).map(b => b.textContent?.trim());
    expect(buttons).toContain('全选');
    expect(buttons).toContain('全不选');
    expect(buttons).not.toContain('Skill 全选');
    expect(buttons).not.toContain('对所选 Skill 化');
    expect(document.querySelector('.acu-v2-agent-wb-control')).toBeNull();

    mount.__resetAcuV2MountForTests();
  });

  it('世界书条目区域渲染搜索过滤输入框', async () => {
    const { mount } = await mountPlotPage();
    await new Promise(r => setTimeout(r, 50));

    const filterInput = document.querySelector('.acu-v2-wb-entry-toolbar__filter .acu-input') as HTMLInputElement | null;
    expect(filterInput).not.toBeNull();
    expect(filterInput!.placeholder).toContain('搜索');

    mount.__resetAcuV2MountForTests();
  });

  it('首次加载时 enabledEntries 持久化可见条目 uid', async () => {
    const settings = createSettings();
    settings.plotSettings.plotWorldbookConfig.enabledEntries = {};

    const { mount } = await mountPlotPage({ settings });
    await new Promise(r => setTimeout(r, 50));

    expect(settings.plotSettings.plotWorldbookConfig.enabledEntries['CharBook']).toBeDefined();
    const enabled: number[] = settings.plotSettings.plotWorldbookConfig.enabledEntries['CharBook'];
    expect(enabled).toContain(1);
    expect(enabled).toContain(3);
    expect(enabled).not.toContain(2);

    mount.__resetAcuV2MountForTests();
  });
});
