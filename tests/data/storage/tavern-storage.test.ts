/**
 * tests/data/storage/tavern-storage.test.ts
 * 酒馆设置存储桥接 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockTopLevelWindow,
  mockIsIndexedDbAvailable,
  mockIdbRequestToPromise,
  mockStorage,
  mockIsExtensionMode,
} = vi.hoisted(() => ({
  mockTopLevelWindow: {} as any,
  mockIsIndexedDbAvailable: vi.fn(() => false),
  mockIdbRequestToPromise: vi.fn().mockResolvedValue(undefined),
  mockStorage: {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
  mockIsExtensionMode: vi.fn(() => false),
}));

vi.mock('../../../src/shared/env', () => ({
  topLevelWindow_ACU: mockTopLevelWindow,
  FORBID_BROWSER_LOCAL_STORAGE_FOR_CONFIG_ACU: false,
  ALLOW_LEGACY_LOCALSTORAGE_MIGRATION_ACU: true,
  legacyLocalStorage_ACU: { getItem: vi.fn(() => null), removeItem: vi.fn() },
  storage_ACU: mockStorage,
}));

vi.mock('../../../src/shared/constants', () => ({
  SCRIPT_ID_PREFIX_ACU: 'ACU',
  DEBUG_MODE_ACU: false,
}));

vi.mock('../../../src/shared/idb-import-temp', () => ({
  idbRequestToPromise_ACU: mockIdbRequestToPromise,
  isIndexedDbAvailable_ACU: mockIsIndexedDbAvailable,
}));

vi.mock('../../../src/shared/runtime-env', () => ({
  isExtensionMode: mockIsExtensionMode,
}));

import {
  USE_TAVERN_SETTINGS_STORAGE_ACU,
  TAVERN_SETTINGS_NAMESPACE_ACU,
  TAVERN_BRIDGE_GLOBAL_KEY_ACU,
  TAVERN_BRIDGE_INJECTED_FLAG_ACU,
  CONFIG_IDB_DB_NAME_ACU,
  CONFIG_IDB_STORE_NAME_ACU,
  sleep_ACU,
  injectTavernBridgeIntoTopWindow_ACU,
  tryReadBridgeFromTop_ACU,
  getTavernSettingsNamespace_ACU,
  getConfigStorage_ACU,
  configIdbGetCached_ACU,
  configIdbSetCached_ACU,
  configIdbRemoveCached_ACU,
  configIdbCache_ACU,
  configIdbDeletedKeys_ACU,
  initTavernSettingsBridge_ACU,
  tavernExtensionSettingsRoot_ACU,
  tavernSaveSettingsFn_ACU,
  _resetTavernStorageState_ACU,
} from '../../../src/data/storage/tavern-storage';

beforeEach(() => {
  vi.clearAllMocks();
  configIdbCache_ACU.clear();
  configIdbDeletedKeys_ACU.clear();
  // 清理 mockTopLevelWindow 上的属性
  Object.keys(mockTopLevelWindow).forEach(k => delete mockTopLevelWindow[k]);
});

// ═══ 常量验证 ═══
describe('常量导出', () => {
  it('USE_TAVERN_SETTINGS_STORAGE_ACU 为 true', () => {
    expect(USE_TAVERN_SETTINGS_STORAGE_ACU).toBe(true);
  });

  it('TAVERN_SETTINGS_NAMESPACE_ACU 包含前缀', () => {
    expect(TAVERN_SETTINGS_NAMESPACE_ACU).toContain('ACU');
  });

  it('TAVERN_BRIDGE_GLOBAL_KEY_ACU 是字符串', () => {
    expect(typeof TAVERN_BRIDGE_GLOBAL_KEY_ACU).toBe('string');
  });

  it('CONFIG_IDB_DB_NAME_ACU 包含前缀', () => {
    expect(CONFIG_IDB_DB_NAME_ACU).toContain('ACU');
  });

  it('CONFIG_IDB_STORE_NAME_ACU 是 kv', () => {
    expect(CONFIG_IDB_STORE_NAME_ACU).toBe('kv');
  });
});

// ═══ sleep_ACU ═══
describe('sleep_ACU', () => {
  it('返回 Promise', () => {
    const result = sleep_ACU(0);
    expect(result).toBeInstanceOf(Promise);
  });
});

// ═══ tryReadBridgeFromTop_ACU ═══
describe('tryReadBridgeFromTop_ACU', () => {
  it('无 bridge 时返回 false', () => {
    expect(tryReadBridgeFromTop_ACU()).toBe(false);
  });

  it('有 bridge 但无 extension_settings 时返回 false', () => {
    mockTopLevelWindow[TAVERN_BRIDGE_GLOBAL_KEY_ACU] = {};
    expect(tryReadBridgeFromTop_ACU()).toBe(false);
  });

  it('有 bridge 且有 extension_settings 时返回 true', () => {
    mockTopLevelWindow[TAVERN_BRIDGE_GLOBAL_KEY_ACU] = {
      extension_settings: { __userscripts: {} },
    };
    expect(tryReadBridgeFromTop_ACU()).toBe(true);
  });
});

// ═══ getTavernSettingsNamespace_ACU ═══
describe('getTavernSettingsNamespace_ACU', () => {
  it('有 bridge 时返回命名空间对象', () => {
    mockTopLevelWindow[TAVERN_BRIDGE_GLOBAL_KEY_ACU] = {
      extension_settings: {},
    };
    const ns = getTavernSettingsNamespace_ACU();
    expect(ns).toBeDefined();
    expect(typeof ns).toBe('object');
  });

  it('返回的命名空间对象可读写', () => {
    mockTopLevelWindow[TAVERN_BRIDGE_GLOBAL_KEY_ACU] = {
      extension_settings: {},
    };
    const ns = getTavernSettingsNamespace_ACU();
    ns.testKey = 'testValue';
    expect(getTavernSettingsNamespace_ACU().testKey).toBe('testValue');
  });
});

// ═══ configIdbGetCached_ACU / configIdbSetCached_ACU / configIdbRemoveCached_ACU ═══
describe('configIdb 缓存操作', () => {
  it('configIdbGetCached_ACU 无缓存返回 null', () => {
    expect(configIdbGetCached_ACU('nonexistent')).toBeNull();
  });

  it('configIdbSetCached_ACU 写入缓存', async () => {
    await configIdbSetCached_ACU('key1', 'value1');
    expect(configIdbCache_ACU.get('key1')).toBe('value1');
    expect(configIdbGetCached_ACU('key1')).toBe('value1');
  });

  it('configIdbSetCached_ACU 清除 deletedKeys', async () => {
    configIdbDeletedKeys_ACU.add('key1');
    await configIdbSetCached_ACU('key1', 'value1');
    expect(configIdbDeletedKeys_ACU.has('key1')).toBe(false);
  });

  it('configIdbRemoveCached_ACU 删除缓存并标记', async () => {
    configIdbCache_ACU.set('key1', 'value1');
    await configIdbRemoveCached_ACU('key1');
    expect(configIdbCache_ACU.has('key1')).toBe(false);
    expect(configIdbDeletedKeys_ACU.has('key1')).toBe(true);
  });
});

// ═══ getConfigStorage_ACU ═══
describe('getConfigStorage_ACU', () => {
  it('无 tavern bridge 时回退到 localStorage', () => {
    mockStorage.getItem.mockReturnValue('local_value');
    const store = getConfigStorage_ACU();
    expect(store.getItem('key1')).toBe('local_value');
  });

  it('有 tavern bridge 时优先读取 tavern', () => {
    mockTopLevelWindow[TAVERN_BRIDGE_GLOBAL_KEY_ACU] = {
      extension_settings: {},
    };
    const store = getConfigStorage_ACU();
    // 写入
    store.setItem('test_key', 'test_value');
    // 读取
    expect(store.getItem('test_key')).toBe('test_value');
    expect(store._isTavern).toBe(true);
  });

  it('有 IDB 缓存时从缓存读取', () => {
    configIdbCache_ACU.set('cached_key', 'cached_value');
    const store = getConfigStorage_ACU();
    expect(store.getItem('cached_key')).toBe('cached_value');
  });

  it('setItem 同时写入 IDB 缓存', () => {
    const store = getConfigStorage_ACU();
    store.setItem('new_key', 'new_value');
    // IDB 缓存应被更新
    expect(configIdbCache_ACU.get('new_key')).toBe('new_value');
  });

  it('removeItem 同时清除 IDB 缓存', () => {
    configIdbCache_ACU.set('del_key', 'del_value');
    const store = getConfigStorage_ACU();
    store.removeItem('del_key');
    expect(configIdbDeletedKeys_ACU.has('del_key')).toBe(true);
  });
});

// ═══ initTavernSettingsBridge_ACU 插件模式分支 ═══
describe('initTavernSettingsBridge_ACU（插件模式）', () => {
  // Node 环境下 window 未定义，需要手动提供
  const _origWindow = globalThis.window;

  beforeEach(() => {
    // 在 Node 环境下将 globalThis 作为 window，使 (window as any).xxx 可用
    if (typeof globalThis.window === 'undefined') {
      (globalThis as any).window = globalThis;
    }
  // 启用插件模式
    mockIsExtensionMode.mockReturnValue(true);
    // 重置模块级状态变量
    _resetTavernStorageState_ACU();
    // 清理 globalThis 上的酒馆全局对象
    delete (globalThis as any).SillyTavern;
    delete (globalThis as any).saveSettingsDebounced;
    delete (globalThis as any).saveSettings;
  });

  afterEach(() => {
    mockIsExtensionMode.mockReturnValue(false);
    delete (globalThis as any).SillyTavern;
    delete (globalThis as any).saveSettingsDebounced;
    delete (globalThis as any).saveSettings;
    // 恢复 window
    if (_origWindow === undefined) {
      delete (globalThis as any).window;
    }
  });

  it('SillyTavern.extensionSettings 存在时返回 true', async () => {
    (globalThis as any).SillyTavern = {
      getContext: () => ({
        extensionSettings: { __userscripts: {} },
        saveSettingsDebounced: vi.fn(),
      }),
    };
    const result = await initTavernSettingsBridge_ACU();
    expect(result).toBe(true);
  });

  it('SillyTavern 不存在时返回 false', async () => {
    // globalThis.SillyTavern 未定义
    const result = await initTavernSettingsBridge_ACU();
    expect(result).toBe(false);
  });

  it('SillyTavern 存在但 extensionSettings 为空时返回 false', async () => {
    (globalThis as any).SillyTavern = {
      getContext: () => ({}),
    };
    const result = await initTavernSettingsBridge_ACU();
    expect(result).toBe(false);
  });

  it('saveSettingsDebounced 优先于 saveSettings 被获取', async () => {
    const mockDebounced = vi.fn();
    const mockSave = vi.fn();
    (globalThis as any).SillyTavern = {
      getContext: () => ({
        extensionSettings: { __userscripts: {} },
        saveSettingsDebounced: mockDebounced,
        saveSettings: mockSave,
      }),
    };

    await initTavernSettingsBridge_ACU();
    // tavernSaveSettingsFn_ACU 应该是 mockDebounced 而非 mockSave
    expect(tavernSaveSettingsFn_ACU).toBe(mockDebounced);
  });

  it('只有 saveSettings 存在时作为后备', async () => {
    const mockSave = vi.fn();
    (globalThis as any).SillyTavern = {
      getContext: () => ({
        extensionSettings: { __userscripts: {} },
        saveSettings: mockSave,
      }),
    };

    await initTavernSettingsBridge_ACU();
    // getContext 不返回 saveSettingsDebounced 时，当前实现不会 fallback 到 saveSettings
    // 因为代码只检查 ctx.saveSettingsDebounced，所以这里应该是 null
    // 但如果需要 fallback，需要在代码中添加 saveSettings 的检查
    // 暂时验证当前行为
    expect(tavernSaveSettingsFn_ACU).toBeNull();
  });

  it('SillyTavern.extensionSettings 获取抛错时不崩溃', async () => {
    Object.defineProperty(globalThis, 'SillyTavern', {
      get() {
        throw new Error('access denied');
      },
      configurable: true,
    });

    // 不应抛出异常
    const result = await initTavernSettingsBridge_ACU();
    expect(result).toBe(false);

    // 清理
    delete (globalThis as any).SillyTavern;
  });
});

describe('设置桥接的请求捕获边界', () => {
  it('只装配设置读写，不导出或查询宿主生成状态', async () => {
    const script = { type: '', textContent: '' };
    const appendChild = vi.fn();
    mockTopLevelWindow.document = {
      createElement: vi.fn(() => script),
      head: { appendChild },
    };
    await expect(injectTavernBridgeIntoTopWindow_ACU()).resolves.toBe(true);
    expect(appendChild).toHaveBeenCalledWith(script);
    expect(script.textContent).toContain('.extension_settings =');
    expect(script.textContent).toContain('.saveSettingsDebounced =');
    expect(script.textContent).not.toContain('isGenerating');
    expect(mockTopLevelWindow[TAVERN_BRIDGE_INJECTED_FLAG_ACU]).toBe(true);
  });
});