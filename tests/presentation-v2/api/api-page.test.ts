/**
 * ApiPage 集成 — 页面结构、面板内预设管理
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const STORAGE_KEY = 'acu_v2_ui_state';

function createSettings() {
  return {
    apiMode: 'custom',
    apiConfig: { url: 'https://alpha.test', apiKey: '', model: 'ma', useMainApi: false, max_tokens: 1000, temperature: 0.7 },
    tavernProfile: '',
    streamingEnabled: false,
    apiPresets: [
      {
        name: 'alpha',
        apiMode: 'custom',
        apiConfig: { url: 'https://alpha.test', apiKey: '', model: 'ma', useMainApi: false, max_tokens: 1000, temperature: 0.7 },
        tavernProfile: '',
      },
      {
        name: 'beta',
        apiMode: 'custom',
        apiConfig: { url: '', apiKey: '', model: '', useMainApi: true, max_tokens: 60000, temperature: 1 },
        tavernProfile: '',
      },
    ],
    defaultApiPresetName: 'alpha',
    apiPresetBindingsByChat: { 'chat-page': { presetName: 'beta', updatedAt: 1 } },
    tableApiPresetOverridesByName: {},
    contentOptimizationSettings: { apiPreset: '' },
  };
}

async function mountApiPage(settings = createSettings()) {
  vi.resetModules();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ router: { activePageId: 'api' } }));
  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    settings_ACU: settings,
    currentChatFileIdentifier_ACU: 'chat-page',
    getCurrentIsolationKey_ACU: () => '',
    coreApisAreReady_ACU: true,
  }));
  vi.doMock('../../../src/service/settings/settings-service', () => ({
    saveSettings_ACU: vi.fn(() => ({ saved: true, storageType: 'memory' })),
  }));
  vi.doMock('../../../src/service/ai/ai-service', () => ({
    getConnectionManagerProfiles_ACU: () => [],
    fetchAvailableModels_ACU: vi.fn(async () => ({ success: true, models: ['m1'] })),
  }));
  const mount = await import('../../../src/presentation-v2/bootstrap/mount');
  await mount.openAcuV2App();
  return { mount, settings };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ApiPage', () => {
  it('PC 布局保持左右等宽分栏，不把单个面板拉满', () => {
    const source = readFileSync('src/presentation-v2/pages/ApiPage.vue', 'utf8');

    expect(source).toContain('<AcuPanelGrid class="acu-v2-api-page__grid">');
    expect(source).toContain('acu-v2-api-page__spacer');
    expect(source).toContain('<DanglingReferenceBanner scope="api" />');
  });

  it('悬挂填表预设时在页面标记失效引用，不隐式改写', async () => {
    const settings = createSettings() as any;
    settings.tableApiPreset = 'ghost';
    const { mount } = await mountApiPage(settings);
    const page = document.querySelector('.acu-v2-api-page');
    expect(page!.textContent).toContain('填表 API 预设「ghost」已不存在');
    expect(page!.textContent).toContain('不会自动改写已保存的设置');
    expect(settings.tableApiPreset).toBe('ghost');
    mount.__resetAcuV2MountForTests();
  });

  it('渲染 API 预设面板，选择和编辑集中在同一面板', async () => {
    const { mount } = await mountApiPage();

    const page = document.querySelector('.acu-v2-api-page');
    expect(page).not.toBeNull();
    expect(page!.textContent).toContain('API 预设');
    expect(page!.querySelectorAll('.acu-panel')).toHaveLength(1);
    expect(page!.textContent).not.toContain('交火模式向量服务');
    expect(page!.textContent).not.toContain('Embedding Endpoint');
    expect(page!.textContent).not.toContain('去交火模式配置');
    expect(page!.querySelector('input[placeholder*="embeddings"]')).toBeNull();
    expect(page!.textContent).not.toContain('重载');

    // Active preset shown in preset panel and opened in config panel.
    expect(page!.textContent).toContain('beta');
    expect(page!.textContent).not.toContain('流式输出');
    expect(page!.textContent).toContain('当前聊天');
    expect(page!.textContent).not.toContain('当前配置状态');
    expect(page!.textContent).not.toContain('已保存预设');
    expect(page!.textContent).toContain('预设名称');
    expect(page!.textContent).toContain('连接方式');
    expect(page!.textContent).toContain('保存当前预设');
    expect(page!.querySelector('button[title="编辑当前预设"]')).toBeNull();

    const apiPanel = Array.from(page!.querySelectorAll<HTMLElement>('.acu-panel'))
      .find(panel => panel.querySelector('.acu-panel__title')?.textContent?.includes('API 预设'))!;
    expect(Array.from(page!.querySelectorAll<HTMLElement>('.acu-panel'))[0]).toBe(apiPanel);
    expect(apiPanel.querySelector('.acu-toggle')).toBeNull();
    expect(apiPanel.querySelector('button[title="新建预设"]')).not.toBeNull();
    expect(apiPanel.querySelector('button[title="删除当前预设"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain('管理 API 预设');

    // No import/export buttons (API presets are sensitive)
    expect(page!.textContent).not.toContain('导入');
    expect(page!.textContent).not.toContain('导出');

    mount.__resetAcuV2MountForTests();
  });

  it('当前 API 配置表单可直接保存活动预设并同步当前聊天绑定', async () => {
    const { mount, settings } = await mountApiPage();

    const page = document.querySelector('.acu-v2-api-page') as HTMLElement;
    const nameRow = Array.from(page.querySelectorAll('.acu-form-row'))
      .find(row => (row.textContent || '').includes('预设名称')) as HTMLElement;
    const nameInput = nameRow.querySelector('input') as HTMLInputElement;
    expect(nameInput.value).toBe('beta');

    nameInput.value = 'beta-renamed';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();

    const saveButton = Array.from(page.querySelectorAll('button'))
      .find(btn => btn.textContent?.includes('保存当前预设')) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false);
    saveButton.click();
    await Promise.resolve();

    expect(settings.apiPresets.some((preset: any) => preset.name === 'beta-renamed')).toBe(true);
    expect(settings.apiPresetBindingsByChat['chat-page'].presetName).toBe('beta-renamed');
    expect(page.textContent || '').not.toContain('已保存当前 API 预设');
    expect(document.body.textContent || '').toContain('已保存当前 API 预设');

    mount.__resetAcuV2MountForTests();
  });

  it('API 预设下拉可切换当前聊天并设置全局默认', async () => {
    const { mount, settings } = await mountApiPage();

    const trigger = document.querySelector('.acu-v2-api-page .acu-preset-dd__trigger') as HTMLButtonElement | null;
    expect(trigger).not.toBeNull();
    expect(trigger!.textContent).toContain('beta');

    trigger!.click();
    await Promise.resolve();
    const items = Array.from(document.querySelectorAll('.acu-v2-api-page .acu-preset-dd__item')) as HTMLElement[];
    items.find(item => item.textContent?.includes('alpha'))!.click();
    await Promise.resolve();
    expect(settings.apiPresetBindingsByChat['chat-page'].presetName).toBe('alpha');

    trigger!.click();
    await Promise.resolve();
    const stars = Array.from(document.querySelectorAll('.acu-v2-api-page .acu-preset-dd__star')) as HTMLButtonElement[];
    stars.find(star => star.closest('.acu-preset-dd__item')?.textContent?.includes('beta'))!.click();
    await Promise.resolve();
    expect(settings.defaultApiPresetName).toBe('beta');

    mount.__resetAcuV2MountForTests();
  });

  it('无预设时提示并可通过图标新建，第一个预设保存后自动选中', async () => {
    const emptySettings = createSettings();
    emptySettings.apiPresets = [];
    emptySettings.defaultApiPresetName = '';
    emptySettings.apiPresetBindingsByChat = {};
    const { mount, settings } = await mountApiPage(emptySettings);

    const page = document.querySelector('.acu-v2-api-page') as HTMLElement;
    expect(page.querySelector('.acu-message')).not.toBeNull();

    const createButton = Array.from(page.querySelectorAll<HTMLButtonElement>('button'))
      .find(btn => btn.getAttribute('title') === '新建预设')!;
    createButton.click();
    await Promise.resolve();

    const nameRow = Array.from(page.querySelectorAll('.acu-form-row'))
      .find(row => (row.textContent || '').includes('预设名称')) as HTMLElement;
    const nameInput = nameRow.querySelector('input') as HTMLInputElement;
    nameInput.value = 'first-api';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();

    const saveButton = Array.from(page.querySelectorAll<HTMLButtonElement>('button'))
      .find(btn => btn.textContent?.includes('保存并选中预设'))!;
    saveButton.click();
    await Promise.resolve();

    expect(settings.apiPresets.some((preset: any) => preset.name === 'first-api')).toBe(true);
    expect(settings.apiPresetBindingsByChat['chat-page'].presetName).toBe('first-api');
    expect(page.textContent || '').not.toContain('已保存当前 API 预设');
    expect(document.body.textContent || '').toContain('已保存当前 API 预设');

    mount.__resetAcuV2MountForTests();
  });
});
