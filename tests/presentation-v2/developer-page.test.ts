/**
 * DeveloperPage 集成 — 开发者字段与运行参数
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'acu_v2_ui_state';

function createSettings() {
  return {
    autoUpdateThreshold: 3,
    autoUpdateFrequency: 2,
    updateBatchSize: 2,
    maxConcurrentGroups: 1,
    skipUpdateFloors: 0,
    retainRecentLayers: 100,
    autoUpdateTokenThreshold: 500,
    tableMaxRetries: 3,
    tableEditLastPairOnly: true,
    strictJsonTableFillEnabled: false,
    tableContextExtractTags: '',
    tableContextExtractRules: [],
    tableContextExcludeTags: '',
    tableContextExcludeRules: [],
    storageMode: 'native',
    tableApiPreset: '',
    charCardPrompt: [
      { role: 'USER', content: '主任务', mainSlot: 'A', isMain: true, deletable: false },
      { role: 'USER', content: '数据段', mainSlot: 'B', isMain2: true, deletable: false },
    ],
    apiPresets: [],
    defaultApiPresetName: '',
    apiPresetBindingsByChat: {},
    contentOptimizationSettings: { apiPreset: '' },
    tableApiPresetOverridesByName: {},
  } as any;
}

async function mountDeveloperPage() {
  vi.resetModules();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      uiTierV2: { tier: 'high' }, router: { activePageId: 'developer' },
      devOptions: { developerOptionsEnabled: true },
    }),
  );

  const settings = createSettings();
  const saveSettings = vi.fn(() => ({ saved: true, storageType: 'memory' }));

  vi.doMock('../../src/service/runtime/state-manager', () => ({
    settings_ACU: settings,
    currentChatFileIdentifier_ACU: 'chat-dev',
    currentJsonTableData_ACU: {},
    coreApisAreReady_ACU: true,
    getCurrentIsolationKey_ACU: () => '',
  }));
  vi.doMock('../../src/service/settings/settings-service', () => ({
    saveSettings_ACU: saveSettings,
    setGlobalPlotEnabled_ACU: vi.fn(),
    setZeroTkOccupyMode_ACU: vi.fn(),
    setSummaryVectorIndexMode_ACU: vi.fn(),
  }));
  vi.doMock('../../src/service/table/storage-mode', () => ({
    getCurrentStorageMode: () => settings.storageMode,
    isSqliteMode: () => false,
  }));
  vi.doMock('../../src/service/chat/chat-service', () => ({
    getChatArray_ACU: () => [],
  }));
  vi.doMock('../../src/service/template/chat-scope', () => ({
    getSortedSheetKeys_ACU: () => [],
    getCurrentChatPlotScopeState_ACU: () => null,
    setCurrentChatPlotScopeState_ACU: vi.fn(),
  }));
  vi.doMock('../../src/service/template/template-preset-service', () => ({
    getActiveTemplatePresetMeta_ACU: () => ({ displayName: '默认预设', scopeLabel: '全局' }),
  }));
  vi.doMock('../../src/service/ai/ai-service', () => ({
    getConnectionManagerProfiles_ACU: () => [],
    fetchAvailableModels_ACU: vi.fn(async () => ({ success: true, models: [] })),
  }));

  const mount = await import('../../src/presentation-v2/bootstrap/mount');
  await mount.openAcuV2App();
  await new Promise(r => setTimeout(r, 0));
  return { mount, settings, saveSettings };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('DeveloperPage', () => {
  it('渲染开发者开关和填表执行参数', async () => {
    const { mount } = await mountDeveloperPage();

    const page = document.querySelector('.acu-v2-developer-page');
    expect(page).not.toBeNull();
    const text = page!.textContent || '';
    expect(text).toContain('开发者 gated 字段');
    expect(text).toContain('填表执行参数');
    expect(text).toContain('填表高级选项');
    expect(text).toContain('旧 UI 入口');
    expect(text).toContain('严格 JSON 填表响应');
    expect(text).not.toContain('填表使用工具调用');
    expect(text).toContain('最大并发更新组数');

    mount.__resetAcuV2MountForTests();
  });

  it('旧 UI 入口开关会写入 dev-options 并同步菜单显隐', async () => {
    const { mount } = await mountDeveloperPage();
    const { MENU_ITEM_CONTAINER_ID_ACU } = await import('../../src/shared/data-constants');

    const legacyContainer = document.createElement('div');
    legacyContainer.id = MENU_ITEM_CONTAINER_ID_ACU;
    legacyContainer.style.display = 'none';
    legacyContainer.setAttribute('tabindex', '-1');
    document.body.appendChild(legacyContainer);

    const toggle = document.querySelector(
      'button[data-acu-toggle-key="legacyUiMenuVisible"]',
    ) as HTMLButtonElement | null;
    expect(toggle).not.toBeNull();
    expect(toggle!.getAttribute('aria-checked')).toBe('false');

    toggle!.click();
    await Promise.resolve();

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    expect(persisted?.devOptions?.legacyUiMenuVisible).toBe(true);
    expect(legacyContainer.style.display).toBe('');
    expect(legacyContainer.getAttribute('tabindex')).toBe('0');

    toggle!.click();
    await Promise.resolve();

    const nextPersisted = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    expect(nextPersisted?.devOptions?.legacyUiMenuVisible).toBe(false);
    expect(legacyContainer.style.display).toBe('none');
    expect(legacyContainer.getAttribute('tabindex')).toBe('-1');

    mount.__resetAcuV2MountForTests();
  });

  it('严格 JSON 填表响应仅在高级选项中显示，切换后保存设置', async () => {
    const { mount, settings, saveSettings } = await mountDeveloperPage();

    const toggle = document.querySelector<HTMLButtonElement>(
      'button[data-acu-toggle-key="strictJsonTableFillEnabled"]',
    );
    expect(toggle).not.toBeNull();
    expect(toggle!.getAttribute('aria-checked')).toBe('false');

    toggle!.click();
    await Promise.resolve();

    expect(settings.strictJsonTableFillEnabled).toBe(true);
    expect(saveSettings).toHaveBeenCalledTimes(1);

    mount.__resetAcuV2MountForTests();
  });

  it('最大并发更新组数输入会保存到 settings', async () => {
    const { mount, settings, saveSettings } = await mountDeveloperPage();

    const panel = Array.from(document.querySelectorAll<HTMLElement>('.acu-v2-developer-page .acu-panel'))
      .find(el => el.querySelector('.acu-panel__title')?.textContent?.includes('填表执行参数'))!;
    const input = panel.querySelector<HTMLInputElement>('input[type="number"]')!;
    input.value = '4';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();

    expect(settings.maxConcurrentGroups).toBe(4);
    expect(saveSettings).toHaveBeenCalled();

    mount.__resetAcuV2MountForTests();
  });
});
