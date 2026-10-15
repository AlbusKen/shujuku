/**
 * API preset store — 阶段 1 API 预设语义
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createSettings() {
  return {
    apiMode: 'custom',
    apiConfig: { url: '', apiKey: '', model: '', useMainApi: true, max_tokens: 60000, temperature: 1 },
    tavernProfile: '',
    streamingEnabled: false,
    apiPresets: [
      {
        name: 'alpha',
        apiMode: 'custom',
        apiConfig: { url: 'https://alpha.test', apiKey: 'ka', model: 'ma', useMainApi: false, max_tokens: 1000, temperature: 0.7 },
        tavernProfile: '',
      },
      {
        name: 'beta',
        apiMode: 'tavern',
        apiConfig: { url: '', apiKey: '', model: '', useMainApi: true, max_tokens: 60000, temperature: 1 },
        tavernProfile: 'profile-beta',
      },
    ],
    defaultApiPresetName: 'alpha',
    apiPresetBindingsByChat: {},
    tableApiPreset: 'beta',
    plotApiPreset: 'beta',
    contentOptimizationSettings: { apiPreset: 'beta' },
    tableApiPresetOverridesByName: { SheetA: 'beta', SheetB: 'other' },
  };
}

async function importStore(settings: any, chatKey = 'chat-A') {
  vi.resetModules();
  const saveSettings = vi.fn(() => ({ saved: true, storageType: 'memory' }));
  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    settings_ACU: settings,
    currentChatFileIdentifier_ACU: chatKey,
  }));
  vi.doMock('../../../src/service/settings/settings-service', () => ({
    saveSettings_ACU: saveSettings,
  }));
  vi.doMock('../../../src/service/ai/ai-service', () => ({
    getConnectionManagerProfiles_ACU: () => [{ id: 'profile-beta', name: 'Beta Profile' }],
    fetchAvailableModels_ACU: vi.fn(async () => ({ success: true, models: ['m1', 'm2'] })),
  }));
  const [{ setActivePinia, createPinia }, { useApiPresetStore }] = await Promise.all([
    import('pinia'),
    import('../../../src/presentation-v2/stores/api-preset-store'),
  ]);
  setActivePinia(createPinia());
  return { store: useApiPresetStore(), saveSettings };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('useApiPresetStore', () => {
  it('从旧 settings 读取预设、默认项和当前聊天回退', async () => {
    const settings = createSettings();
    const { store } = await importStore(settings);

    store.refreshFromSettings();

    expect(store.presets.map(p => p.name)).toEqual(['alpha', 'beta']);
    expect(store.defaultApiPresetName).toBe('alpha');
    expect(store.activePresetName).toBe('alpha');
    expect(store.currentChatKey).toBe('chat-A');
  });

  it('没有预设时仍能识别当前 API 配置是否可用', async () => {
    const settings = createSettings();
    settings.apiPresets = [];
    settings.defaultApiPresetName = '';
    settings.apiMode = 'custom';
    settings.apiConfig = { url: 'https://direct.test', apiKey: '', model: 'direct-model', useMainApi: false, max_tokens: 1000, temperature: 1 };
    const { store } = await importStore(settings);

    store.refreshFromSettings();

    expect(store.activePresetName).toBe('');
    expect(store.currentConfigReady).toBe(true);
    expect(store.currentConfigLabel).toBe('direct-model');
  });

  it('没有聊天绑定和全局默认时，会从当前 API 配置反推出匹配预设', async () => {
    const settings = createSettings();
    settings.defaultApiPresetName = '';
    settings.apiPresetBindingsByChat = {};
    settings.apiMode = 'custom';
    settings.apiConfig = { url: 'https://alpha.test', apiKey: 'ka', model: 'ma', useMainApi: false, max_tokens: 1000, temperature: 0.7 };
    const { store } = await importStore(settings);

    store.refreshFromSettings();

    expect(store.activePresetName).toBe('alpha');
    expect(store.currentConfigReady).toBe(true);
  });

  it('设置当前聊天活动 API 时同步旧当前配置', async () => {
    const settings = createSettings();
    const { store, saveSettings } = await importStore(settings);
    store.refreshFromSettings();

    expect(store.setActivePresetForCurrentChat('beta')).toBe(true);

    expect(store.activePresetName).toBe('beta');
    expect(settings.apiPresetBindingsByChat['chat-A'].presetName).toBe('beta');
    expect(settings.apiMode).toBe('tavern');
    expect(settings.tavernProfile).toBe('profile-beta');
    expect(saveSettings).toHaveBeenCalled();
  });

  it('保存当前活动预设时同步当前聊天 apiConfig 细节字段', async () => {
    const settings = createSettings();
    settings.apiPresetBindingsByChat['chat-A'] = { presetName: 'alpha', updatedAt: 1 };
    const { store } = await importStore(settings);
    store.refreshFromSettings();

    expect(store.savePreset({
      name: 'alpha',
      apiMode: 'custom',
      tavernProfile: '',
      apiConfig: {
        url: 'https://alpha-2.test',
        apiKey: 'ka2',
        model: 'ma2',
        useMainApi: false,
        max_tokens: 2048,
        requestTimeoutSeconds: 90,
        sendViaTavern: true,
        temperature: 0.25,
        bodyParams: '{"top_p":0.9}',
        excludeBodyParams: 'temperature',
        requestHeaders: '{"x-test":"1"}',
      },
    }, 'alpha')).toBe(true);

    expect(store.activePresetName).toBe('alpha');
    expect(settings.apiPresetBindingsByChat['chat-A'].presetName).toBe('alpha');
    expect(settings.apiConfig).toEqual(expect.objectContaining({
      url: 'https://alpha-2.test',
      apiKey: 'ka2',
      model: 'ma2',
      useMainApi: false,
      max_tokens: 2048,
      requestTimeoutSeconds: 90,
      sendViaTavern: true,
      temperature: 0.25,
      bodyParams: '{"top_p":0.9}',
      excludeBodyParams: 'temperature',
      requestHeaders: '{"x-test":"1"}',
    }));
  });

  describe.each(['default', 'matched', 'bound'] as const)('活动项来源=%s', selection => {
    function activeSettings() {
      const settings = createSettings();
      settings.apiConfig = { ...settings.apiPresets[0].apiConfig };
      if (selection === 'matched') settings.defaultApiPresetName = '';
      if (selection === 'bound') {
        settings.defaultApiPresetName = 'beta';
        settings.apiPresetBindingsByChat['chat-A'] = { presetName: 'alpha', updatedAt: 1 };
      }
      return settings;
    }

    it.each([false, true])('保存活动项同步运行配置及持久化，重命名=%s', async rename => {
      const settings = activeSettings();
      const { store, saveSettings } = await importStore(settings);
      store.refreshFromSettings();
      expect(store.activePresetName).toBe('alpha');
      let persisted: any;
      saveSettings.mockImplementation(() => {
        persisted = JSON.parse(JSON.stringify(settings));
        return { saved: true, storageType: 'memory' };
      });
      const name = rename ? 'renamed' : 'alpha';
      const edited = JSON.parse(JSON.stringify(store.activePreset));
      edited.name = name;
      edited.apiConfig.model = 'model-B';
      expect(store.savePreset(edited, 'alpha')).toBe(true);
      expect(store.activePresetName).toBe(name);
      expect(store.currentConfigLabel).toBe('model-B');
      expect(settings.apiConfig.model).toBe('model-B');
      expect(settings.apiPresetBindingsByChat['chat-A'].presetName).toBe(name);
      expect(persisted.apiConfig.model).toBe('model-B');
      expect(persisted.apiPresets.find((p: any) => p.name === name).apiConfig.model).toBe('model-B');
      expect(saveSettings).toHaveBeenCalledTimes(1);
    });

    it('保存失败恢复活动项、预设、当前配置、默认项和聊天绑定', async () => {
      const settings = activeSettings();
      const { store, saveSettings } = await importStore(settings);
      store.refreshFromSettings();
      const before = JSON.parse(JSON.stringify(settings));
      saveSettings.mockReturnValueOnce({ saved: false, storageType: 'memory' });
      const edited = JSON.parse(JSON.stringify(store.activePreset));
      edited.name = 'renamed';
      edited.apiConfig.model = 'model-B';
      expect(store.savePreset(edited, 'alpha')).toBe(false);
      expect(settings.apiConfig).toEqual(before.apiConfig);
      expect(settings.apiPresets).toEqual(before.apiPresets);
      expect(settings.defaultApiPresetName).toBe(before.defaultApiPresetName);
      expect(settings.apiPresetBindingsByChat).toEqual(before.apiPresetBindingsByChat);
      expect(store.activePresetName).toBe('alpha');
      expect(store.activePreset?.apiConfig.model).toBe('ma');
      expect(store.currentConfigLabel).toBe('ma');
      expect(saveSettings).toHaveBeenCalledTimes(1);
    });

    it('编辑非活动项不切换运行配置或创建聊天绑定', async () => {
      const settings = activeSettings();
      const { store } = await importStore(settings);
      store.refreshFromSettings();
      const config = JSON.parse(JSON.stringify(settings.apiConfig));
      const bindings = JSON.parse(JSON.stringify(settings.apiPresetBindingsByChat));
      const edited = JSON.parse(JSON.stringify(store.presets.find(p => p.name === 'beta')));
      edited.tavernProfile = 'profile-edited';
      expect(store.savePreset(edited, 'beta')).toBe(true);
      expect(settings.apiConfig).toEqual(config);
      expect(settings.apiMode).toBe('custom');
      expect(settings.tavernProfile).toBe('');
      expect(settings.apiPresetBindingsByChat).toEqual(bindings);
    });
  });

  it('删除预设时清理默认、当前聊天和功能引用', async () => {
    const settings = createSettings();
    settings.apiPresetBindingsByChat['chat-A'] = { presetName: 'beta', updatedAt: 1 };
    const { store } = await importStore(settings);
    store.refreshFromSettings();

    expect(store.deletePreset('beta')).toBe(true);

    expect(store.presets.map(p => p.name)).toEqual(['alpha']);
    expect(settings.tableApiPreset).toBe('');
    expect(settings.plotApiPreset).toBe('');
    expect(settings.contentOptimizationSettings.apiPreset).toBe('');
    expect(settings.tableApiPresetOverridesByName).toEqual({ SheetB: 'other' });
    expect(settings.apiPresetBindingsByChat['chat-A'].presetName).toBe('alpha');
  });

  it('保存重命名预设时迁移默认和聊天绑定', async () => {
    const settings = createSettings();
    settings.apiPresetBindingsByChat['chat-A'] = { presetName: 'alpha', updatedAt: 1 };
    const { store } = await importStore(settings);
    store.refreshFromSettings();

    expect(store.savePreset({
      name: 'renamed',
      apiMode: 'custom',
      tavernProfile: '',
      apiConfig: { url: 'https://r.test', apiKey: '', model: 'mr', useMainApi: false, max_tokens: 2048, temperature: 0.8 },
    }, 'alpha')).toBe(true);

    expect(store.defaultApiPresetName).toBe('renamed');
    expect(settings.apiPresetBindingsByChat['chat-A'].presetName).toBe('renamed');
    expect(store.activePresetName).toBe('renamed');
    expect(settings.apiConfig).toEqual(expect.objectContaining({
      url: 'https://r.test',
      model: 'mr',
      useMainApi: false,
      max_tokens: 2048,
      temperature: 0.8,
    }));
    expect(settings.apiPresets.map((p: any) => p.name)).toContain('renamed');
  });

  it('保存非活动预设时不覆盖当前聊天 apiConfig', async () => {
    const settings = createSettings();
    settings.apiPresetBindingsByChat['chat-A'] = { presetName: 'alpha', updatedAt: 1 };
    const { store } = await importStore(settings);
    store.refreshFromSettings();

    expect(store.savePreset({
      name: 'beta',
      apiMode: 'tavern',
      tavernProfile: 'profile-beta-2',
      apiConfig: { url: '', apiKey: '', model: '', useMainApi: true, max_tokens: 777, temperature: 1.5, bodyParams: '{"a":1}', excludeBodyParams: '', requestHeaders: '' },
    }, 'beta')).toBe(true);

    expect(store.activePresetName).toBe('alpha');
    expect(settings.apiPresetBindingsByChat['chat-A'].presetName).toBe('alpha');
    expect(settings.apiConfig.url).toBe('');
    expect(settings.apiConfig.useMainApi).toBe(true);
    expect(settings.apiConfig.max_tokens).toBe(60000);
  });
});
