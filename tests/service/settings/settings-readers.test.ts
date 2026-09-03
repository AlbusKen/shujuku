/**
 * tests/service/settings/settings-readers.test.ts
 * 设置读取器 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSettings } = vi.hoisted(() => {
  const mockSettings: any = {
    characterSettings: {},
    zeroTkOccupyModeDefault: false,
  };
  return { mockSettings };
});
let currentTables: any = {};
const parseTableTemplate = vi.fn();

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: mockSettings,
  currentChatFileIdentifier_ACU: 'test-char',
  get currentJsonTableData_ACU() { return currentTables; },
}));

// 默认让角色卡键解析失败 → 退回聊天级键 'test-char'，与既有用例保持一致；
// 迁移用例里再把它切换成可靠的角色卡键。
const mockScope = vi.hoisted(() => ({ cardKey: null as string | null }));
vi.mock('../../../src/data/gateways/host-state-gateway', () => ({
  getCurrentCharacterCardKey_ACU: () => mockScope.cardKey,
}));

vi.mock('../../../src/data/repositories/profile-repo', () => ({
  globalMeta_ACU: { zeroTkOccupyModeGlobal: false },
}));

vi.mock('../../../src/shared/defaults', () => ({
  defaultWorldbookConfig_ACU: {
    enabled: true,
    zeroTkOccupyMode: false,
    outlineEntryEnabled: true,
    maxEntries: 10,
  },
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  deepMerge_ACU: vi.fn((target: any, source: any) => ({ ...target, ...source })),
  parseTableTemplateJson_ACU: (...args: any[]) => parseTableTemplate(...args),
}));
vi.mock('../../../src/service/template/chat-scope', () => ({
  getSortedSheetKeys_ACU: (tables: Record<string, unknown> | null | undefined) => Object.keys(tables || {}).sort(),
}));

import {
  getCurrentTableDisplayData_ACU,
  getCurrentCharSettings_ACU,
  getCurrentWorldbookConfig_ACU,
  getSelectedImportTableKeys_ACU,
  getSelectedManualTableKeys_ACU,
 hasRuntimeTableData_ACU,
} from '../../../src/service/settings/settings-readers';

beforeEach(() => {
  mockScope.cardKey = null;
  mockSettings.characterSettings = {};
  mockSettings.zeroTkOccupyModeDefault = false;
  mockSettings.manualSelectedTables = [];
  mockSettings.hasManualSelection = false;
  mockSettings.importSelectedTables = [];
  mockSettings.hasImportTableSelection = false;
  currentTables = { sheet_b: {}, sheet_a: {} };
  parseTableTemplate.mockReset();
  parseTableTemplate.mockReturnValue(null);
});

describe('getCurrentCharSettings_ACU', () => {
  it('首次调用创建新的角色设置，worldbookConfig 包含默认值', () => {
    const result = getCurrentCharSettings_ACU();
    expect(result).toBeDefined();
    expect(result.worldbookConfig).toBeDefined();
    // 验证默认配置的具体字段值（deepMerge 后应包含 defaultWorldbookConfig_ACU 的字段）
    expect(result.worldbookConfig.enabled).toBe(true);
    expect(result.worldbookConfig.maxEntries).toBe(10);
    // zeroTkOccupyModeGlobal=false 时，zeroTkOccupyMode 应为 false
    expect(result.worldbookConfig.zeroTkOccupyMode).toBe(false);
    expect(result.worldbookConfig.outlineEntryEnabled).toBe(true);
  });
  it('已有设置时 deepMerge 保留已有字段并补全缺失字段', () => {
    mockSettings.characterSettings['test-char'] = {
      worldbookConfig: { enabled: false, customField: 'test' },
    };
    const result = getCurrentCharSettings_ACU();
    // deepMerge 后：source(existing) 覆盖 target(default)
    expect(result.worldbookConfig.enabled).toBe(false);
    expect(result.worldbookConfig.customField).toBe('test');
    // 默认值应被补全
    expect(result.worldbookConfig.maxEntries).toBe(10);
  });
  it('characterSettings 为 null 时自动初始化', () => {
    mockSettings.characterSettings = null;
    const result = getCurrentCharSettings_ACU();
    expect(result).toBeDefined();
    expect(mockSettings.characterSettings).not.toBeNull();
    expect(result.worldbookConfig.enabled).toBe(true);
  });
  it('深度合并默认配置后字段完整', () => {
    mockSettings.characterSettings['test-char'] = {
      worldbookConfig: { enabled: false },
    };
    const result = getCurrentCharSettings_ACU();
    expect(result.worldbookConfig).toBeDefined();
    // 验证 deepMerge 补全了 maxEntries
    expect(result.worldbookConfig.maxEntries).toBe(10);
    // zeroTkOccupyMode 被强制设置为 globalZeroTkDefault
    expect(result.worldbookConfig.zeroTkOccupyMode).toBe(false);
    expect(result.worldbookConfig.outlineEntryEnabled).toBe(true);
  });

  describe('以角色卡为单位存储', () => {
    it('能解析到角色卡时以角色卡键存储，而不是聊天文件名', () => {
      mockScope.cardKey = 'char:alice.png';
      getCurrentCharSettings_ACU();
      expect(mockSettings.characterSettings['char:alice.png']).toBeDefined();
      expect(mockSettings.characterSettings['test-char']).toBeUndefined();
    });

    it('首次访问角色卡时把当前聊天的旧条目迁移到角色卡键下并删除旧条目', () => {
      mockScope.cardKey = 'char:alice.png';
      mockSettings.characterSettings['test-char'] = {
        worldbookConfig: { enabled: false, source: 'manual', manualSelection: ['填表书'] },
      };
      const result = getCurrentCharSettings_ACU();
      expect(result.worldbookConfig.source).toBe('manual');
      expect(result.worldbookConfig.manualSelection).toEqual(['填表书']);
      expect(mockSettings.characterSettings['char:alice.png']).toBe(result);
      expect(mockSettings.characterSettings['test-char']).toBeUndefined();
    });

    it('角色卡键已有记录时不再迁移旧的聊天级条目', () => {
      mockScope.cardKey = 'char:alice.png';
      mockSettings.characterSettings['char:alice.png'] = { worldbookConfig: { source: 'manual', manualSelection: ['卡的书'] } };
      mockSettings.characterSettings['test-char'] = { worldbookConfig: { source: 'manual', manualSelection: ['聊天的书'] } };
      const result = getCurrentCharSettings_ACU();
      expect(result.worldbookConfig.manualSelection).toEqual(['卡的书']);
      expect(mockSettings.characterSettings['test-char']).toBeDefined();
    });

    it('同一张卡不同聊天读到同一份配置', () => {
      mockScope.cardKey = 'char:alice.png';
      const first = getCurrentCharSettings_ACU();
      first.worldbookConfig.source = 'manual';
      const second = getCurrentCharSettings_ACU();
      expect(second.worldbookConfig.source).toBe('manual');
    });
  });
});

describe('getCurrentWorldbookConfig_ACU', () => {
  it('返回世界书配置', () => {
    const config = getCurrentWorldbookConfig_ACU();
    expect(config).toBeDefined();
    expect(config.enabled).toBeDefined();
  });
  it('与 getCurrentCharSettings_ACU 返回的一致', () => {
    const charSettings = getCurrentCharSettings_ACU();
    const config = getCurrentWorldbookConfig_ACU();
    expect(config).toBe(charSettings.worldbookConfig);
  });
});


describe('持久化表格选择读取器', () => {
  it('未曾手动选择时返回当前全部表，显式选择后严格返回仍存在的交集', () => {
    expect(getSelectedManualTableKeys_ACU()).toEqual(['sheet_a', 'sheet_b']);

    mockSettings.hasManualSelection = true;
    mockSettings.manualSelectedTables = ['sheet_b', 'deleted', 'sheet_b'];

    expect(getSelectedManualTableKeys_ACU()).toEqual(['sheet_b', 'sheet_b']);
  });

  it('导入选择优先使用无种子行模板；显式空选择不回退为全选', () => {
    parseTableTemplate.mockReturnValue({ template_b: {}, template_a: {} });
    expect(getSelectedImportTableKeys_ACU()).toEqual(['template_a', 'template_b']);

    mockSettings.hasImportTableSelection = true;
    mockSettings.importSelectedTables = [];

    expect(getSelectedImportTableKeys_ACU()).toEqual([]);
    expect(parseTableTemplate).toHaveBeenCalledWith({ stripSeedRows: true });
  });

  it('模板不可用时导入选择回退到当前聊天表格', () => {
    parseTableTemplate.mockImplementation(() => { throw new Error('invalid template'); });
    mockSettings.hasImportTableSelection = true;
    mockSettings.importSelectedTables = ['sheet_b', 'deleted'];

    expect(getSelectedImportTableKeys_ACU()).toEqual(['sheet_b']);
  });
});

describe('hasRuntimeTableData_ACU 执行就绪判据', () => {
  it('runtime 含 sheet_* 时返回 true（不解析模板）', () => {
    currentTables = { sheet_a: {}, mate: {} };
    parseTableTemplate.mockReturnValue({ sheet_tpl: {} });
    expect(hasRuntimeTableData_ACU()).toBe(true);
    // 就绪判据不得触发模板解析
    expect(parseTableTemplate).not.toHaveBeenCalled();
  });

  it('runtime 为 null（purge 后）时返回 false，即使模板可解析', () => {
    currentTables = null;
    parseTableTemplate.mockReturnValue({ sheet_tpl: {} });
    expect(hasRuntimeTableData_ACU()).toBe(false);
    expect(parseTableTemplate).not.toHaveBeenCalled();
  });

  it('runtime 仅有 mate / 空对象时返回 false', () => {
    currentTables = { mate: {} };
    expect(hasRuntimeTableData_ACU()).toBe(false);
    currentTables = {};
    expect(hasRuntimeTableData_ACU()).toBe(false);
  });
});


describe('getCurrentTableDisplayData_ACU', () => {
  it('runtime 有表时直接返回 runtime，不解析模板', () => {
    currentTables = { sheet_a: { name: 'A' }, sheet_b: { name: 'B' } };
    parseTableTemplate.mockClear();

    const result = getCurrentTableDisplayData_ACU();

    expect(result).toBe(currentTables);
    expect(parseTableTemplate).not.toHaveBeenCalled();
  });

  it('runtime 为 null 时回退到去除 seed rows 的全局模板', () => {
    currentTables = null;
    const templateData = { sheet_a: { name: 'A', content: [['h1']] }, sheet_b: { name: 'B' } };
    parseTableTemplate.mockReturnValue(templateData);

    const result = getCurrentTableDisplayData_ACU();

    expect(result).toBe(templateData);
    expect(parseTableTemplate).toHaveBeenCalledWith({ stripSeedRows: true });
  });

  it('runtime 为空对象（无 sheet_*）时同样回退模板', () => {
    currentTables = { mate: { type: 'chatSheets', version: 1 } };
    parseTableTemplate.mockReturnValue({ sheet_c: { name: 'C' } });

    const result = getCurrentTableDisplayData_ACU();

    expect(result).toEqual({ sheet_c: { name: 'C' } });
  });

  it('模板解析失败时返回 null，不抛出', () => {
    currentTables = null;
    parseTableTemplate.mockImplementation(() => { throw new Error('parse failed'); });

    expect(getCurrentTableDisplayData_ACU()).toBeNull();
  });

  it('模板无有效 sheet_* 时返回 null', () => {
    currentTables = null;
    parseTableTemplate.mockReturnValue({ mate: { type: 'chatSheets' } });

    expect(getCurrentTableDisplayData_ACU()).toBeNull();
  });
});
