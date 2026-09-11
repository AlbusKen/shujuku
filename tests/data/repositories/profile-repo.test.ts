/**
 * tests/data/repositories/profile-repo.test.ts
 * Profile 与 GlobalMeta 管理 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockStore,
  mockLogWarn,
} = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    mockStore: {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { store.set(key, value); }),
      removeItem: vi.fn((key: string) => { store.delete(key); }),
      _clear: () => store.clear(),
      _store: store,
    },
    mockLogWarn: vi.fn(),
  };
});

vi.mock('../../../src/shared/json-helpers', () => ({
  safeJsonParse_ACU: (json: string, fallback: any) => { try { return JSON.parse(json); } catch { return fallback; } },
  safeJsonStringify_ACU: (obj: any, fallback: string) => { try { return JSON.stringify(obj); } catch { return fallback; } },
}));

vi.mock('../../../src/shared/utils', () => ({
  logWarn_ACU: mockLogWarn,
}));

vi.mock('../../../src/shared/data-constants', () => ({
  STORAGE_KEY_GLOBAL_META_ACU: 'acu_global_meta',
  normalizeIsolationCode_ACU: vi.fn((code: string) => String(code || '').trim()),
  getProfileSettingsKey_ACU: vi.fn((code: string) => `acu_settings_${code}`),
  getProfileTemplateKey_ACU: vi.fn((code: string) => `acu_template_${code}`),
}));

vi.mock('../../../src/data/storage/tavern-storage', () => ({
  getConfigStorage_ACU: () => mockStore,
}));

vi.mock('../../../src/shared/defaults-json.js', () => ({
  get TABLE_TEMPLATE_ACU() { return '{"sheet_0":{}}'; },
}));

import {
  globalMeta_ACU,
  buildDefaultGlobalMeta_ACU,
  loadGlobalMeta_ACU,
  saveGlobalMeta_ACU,
  readProfileSettingsFromStorage_ACU,
  writeProfileSettingsToStorage_ACU,
  readProfileTemplateFromStorage_ACU,
  writeProfileTemplateToStorage_ACU,
  deleteProfileFromStorage_ACU,
  saveCurrentProfileTemplate_ACU,
  sanitizeSettingsForProfileSave_ACU,
} from '../../../src/data/repositories/profile-repo';

beforeEach(() => {
  vi.clearAllMocks();
  mockStore._clear();
});

// ═══ buildDefaultGlobalMeta_ACU ═══
describe('buildDefaultGlobalMeta_ACU', () => {
  it('返回默认结构', () => {
    const meta = buildDefaultGlobalMeta_ACU();
    expect(meta.version).toBe(1);
    expect(meta.activeIsolationCode).toBe('');
    expect(meta.isolationCodeList).toEqual([]);
    expect(meta.migratedLegacySingleStore).toBe(false);
    expect(meta.zeroTkOccupyModeGlobal).toBe(false);
  });

  it('每次调用返回新对象', () => {
    const a = buildDefaultGlobalMeta_ACU();
    const b = buildDefaultGlobalMeta_ACU();
    expect(a).not.toBe(b);
  });
});

// ═══ loadGlobalMeta_ACU ═══
describe('loadGlobalMeta_ACU', () => {
  it('存储为空时返回默认值', () => {
    const meta = loadGlobalMeta_ACU();
    expect(meta.version).toBe(1);
    expect(meta.activeIsolationCode).toBe('');
  });

  it('存储有有效数据时加载', () => {
    mockStore._store.set('acu_global_meta', JSON.stringify({
      version: 1,
      activeIsolationCode: 'code_1',
      isolationCodeList: ['code_1', 'code_2'],
    }));
    const meta = loadGlobalMeta_ACU();
    expect(meta.activeIsolationCode).toBe('code_1');
    expect(meta.isolationCodeList).toEqual(['code_1', 'code_2']);
  });

  it('存储有损坏数据时返回默认值', () => {
    mockStore._store.set('acu_global_meta', 'not valid json');
    const meta = loadGlobalMeta_ACU();
    expect(meta.version).toBe(1);
    expect(meta.activeIsolationCode).toBe('');
  });

  it('isolationCodeList 非数组时重置为空数组', () => {
    mockStore._store.set('acu_global_meta', JSON.stringify({
      isolationCodeList: 'not_array',
    }));
    const meta = loadGlobalMeta_ACU();
    expect(meta.isolationCodeList).toEqual([]);
  });
});

// ═══ saveGlobalMeta_ACU ═══
describe('saveGlobalMeta_ACU', () => {
  it('正常保存返回 true', () => {
    const result = saveGlobalMeta_ACU();
    expect(result).toBe(true);
    expect(mockStore.setItem).toHaveBeenCalledWith('acu_global_meta', expect.any(String));
  });

  it('存储抛错返回 false', () => {
    mockStore.setItem.mockImplementationOnce(() => { throw new Error('存储满了'); });
    const result = saveGlobalMeta_ACU();
    expect(result).toBe(false);
    expect(mockLogWarn).toHaveBeenCalled();
  });
});

// ═══ readProfileSettingsFromStorage_ACU ═══
describe('readProfileSettingsFromStorage_ACU', () => {
  it('无数据返回 null', () => {
    expect(readProfileSettingsFromStorage_ACU('code_1')).toBeNull();
  });

  it('有有效 JSON 返回对象', () => {
    mockStore._store.set('acu_settings_code_1', JSON.stringify({ theme: 'dark' }));
    const result = readProfileSettingsFromStorage_ACU('code_1');
    expect(result).not.toBeNull();
    expect(result.theme).toBe('dark');
  });

  it('无效 JSON 返回 null', () => {
    mockStore._store.set('acu_settings_code_1', 'bad json');
    expect(readProfileSettingsFromStorage_ACU('code_1')).toBeNull();
  });
});

// ═══ writeProfileSettingsToStorage_ACU ═══
describe('writeProfileSettingsToStorage_ACU', () => {
  it('写入设置到存储', () => {
    writeProfileSettingsToStorage_ACU('code_1', { theme: 'dark' });
    expect(mockStore.setItem).toHaveBeenCalledWith('acu_settings_code_1', expect.any(String));
  });
});

// ═══ readProfileTemplateFromStorage_ACU ═══
describe('readProfileTemplateFromStorage_ACU', () => {
  it('无数据返回 null', () => {
    expect(readProfileTemplateFromStorage_ACU('code_1')).toBeNull();
  });

  it('有数据返回字符串', () => {
    mockStore._store.set('acu_template_code_1', '{"sheet_0":{}}');
    expect(readProfileTemplateFromStorage_ACU('code_1')).toBe('{"sheet_0":{}}');
  });

  it('空字符串返回 null', () => {
    mockStore._store.set('acu_template_code_1', '   ');
    expect(readProfileTemplateFromStorage_ACU('code_1')).toBeNull();
  });
});

// ═══ writeProfileTemplateToStorage_ACU ═══
describe('writeProfileTemplateToStorage_ACU', () => {
  it('写入模板到存储', () => {
    writeProfileTemplateToStorage_ACU('code_1', '{"sheet_0":{}}');
    expect(mockStore.setItem).toHaveBeenCalledWith('acu_template_code_1', '{"sheet_0":{}}');
  });
});

// ═══ deleteProfileFromStorage_ACU ═══
describe('deleteProfileFromStorage_ACU', () => {
  it('删除指定标签的设置与模板，不影响默认 Profile', () => {
    mockStore._store.set('acu_settings_old', 'settings');
    mockStore._store.set('acu_template_old', 'template');
    mockStore._store.set('acu_settings_', 'default-settings');
    mockStore._store.set('acu_template_', 'default-template');

    deleteProfileFromStorage_ACU('old');

    expect(mockStore.removeItem).toHaveBeenCalledWith('acu_settings_old');
    expect(mockStore.removeItem).toHaveBeenCalledWith('acu_template_old');
    expect(mockStore._store.has('acu_settings_old')).toBe(false);
    expect(mockStore._store.has('acu_template_old')).toBe(false);
    expect(mockStore._store.get('acu_settings_')).toBe('default-settings');
    expect(mockStore._store.get('acu_template_')).toBe('default-template');
  });

  it('空标签拒绝删除，避免误删默认 Profile', () => {
    expect(() => deleteProfileFromStorage_ACU('   ')).toThrow('不能删除默认 Profile');
    expect(mockStore.removeItem).not.toHaveBeenCalled();
  });
});

// ═══ saveCurrentProfileTemplate_ACU ═══
describe('saveCurrentProfileTemplate_ACU', () => {
  it('使用传入的 templateStr', () => {
    saveCurrentProfileTemplate_ACU('custom_template', { dataIsolationCode: 'code_1' });
    expect(mockStore.setItem).toHaveBeenCalledWith('acu_template_code_1', 'custom_template');
  });

  it('不传 templateStr 时使用 TABLE_TEMPLATE_ACU', () => {
    saveCurrentProfileTemplate_ACU(undefined, {});
    expect(mockStore.setItem).toHaveBeenCalledWith('acu_template_', '{"sheet_0":{}}');
  });
});

// ═══ sanitizeSettingsForProfileSave_ACU ═══
describe('sanitizeSettingsForProfileSave_ACU', () => {
  it('删除 dataIsolationHistory 和 dataIsolationEnabled', () => {
    const input = {
      theme: 'dark',
      dataIsolationHistory: ['code_1'],
      dataIsolationEnabled: true,
      otherSetting: 42,
    };
    const result = sanitizeSettingsForProfileSave_ACU(input);
    expect(result.theme).toBe('dark');
    expect(result.otherSetting).toBe(42);
    expect(result.dataIsolationHistory).toBeUndefined();
    expect(result.dataIsolationEnabled).toBeUndefined();
  });

  it('返回深拷贝', () => {
    const input = { nested: { value: 1 } };
    const result = sanitizeSettingsForProfileSave_ACU(input);
    expect(result.nested.value).toBe(1);
    result.nested.value = 2;
    expect(input.nested.value).toBe(1);
  });
});
