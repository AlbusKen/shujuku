/**
 * tests/service/template/template-preset-service.test.ts
 * 模板预设业务逻辑 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockStore, mockSettings, mockChat, mockChatState } = vi.hoisted(() => {
  const mockStore: any = {};
  const mockChat: any[] = [{ is_user: false }];
  return {
    mockStore,
    mockSettings: { templatePresetName: '', dataIsolationEnabled: false } as any,
    mockChat,
    mockChatState: { current: mockChat } as { current: any[] },
  };
});

vi.mock('../../../src/shared/data-constants', () => ({
  STORAGE_KEY_TEMPLATE_PRESETS_ACU: 'template_presets',
}));

vi.mock('../../../src/shared/defaults-json.js', () => ({
  DEFAULT_TABLE_TEMPLATE_ACU: '{"sheet_0":{"name":"默认表"}}',
  TABLE_TEMPLATE_ACU: '{"sheet_0":{"name":"当前表"}}',
  _set_TABLE_TEMPLATE_ACU: vi.fn(),
}));

vi.mock('../../../src/shared/template-preset-utils', () => ({
  DEFAULT_TEMPLATE_PRESET_OPTION_VALUE_ACU: '__default__',
  getCurrentTemplatePresetName_ACU: vi.fn(() => ''),
  isDefaultTemplatePresetSelection_ACU: vi.fn((v: string) => !v || v === '__default__'),
  normalizeTemplatePresetSelectionValue_ACU: vi.fn((v: string) => (v === '__default__' ? '' : (v || '').trim())),
}));

vi.mock('../../../src/data/storage/tavern-storage', () => ({
  getConfigStorage_ACU: vi.fn(() => ({
    getItem: (key: string) => mockStore[key] || null,
    setItem: (key: string, value: string) => { mockStore[key] = value; },
  })),
}));

vi.mock('../../../src/data/repositories/profile-repo', () => ({
  saveCurrentProfileTemplate_ACU: vi.fn(),
}));

vi.mock('../../../src/service/settings/settings-service', () => ({
  persistCurrentTemplatePresetName_ACU: vi.fn(),
  saveSettings_ACU: vi.fn(),
  applyTemplateScopeForCurrentChat_ACU: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  currentJsonTableData_ACU: { mate: { type: 'chatSheets', version: 1 } },
  getCurrentIsolationKey_ACU: vi.fn(() => ''),
  settings_ACU: mockSettings,
  _set_currentJsonTableData_ACU: vi.fn(),
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: vi.fn(() => mockChatState.current),
  saveChatToHost_ACU: vi.fn(),
}));
vi.mock('../../../src/data/storage/chat-history', () => ({
  getActiveChatStorageIdentity_ACU: vi.fn(() => 'chat-a'),
}));

vi.mock('../../../src/service/template/chat-scope', () => ({
  activateChatTemplatePresetSelection_ACU: vi.fn(),
  buildChatSheetGuideDataFromData_ACU: vi.fn((data: any) => data),
  buildChatSheetGuideDataFromTemplateObj_ACU: vi.fn((templateObj: any) => ({ mate: templateObj?.mate, sheets: {} })),
  buildChatTemplatePresetLinkState_ACU: vi.fn(),
  buildChatTemplateScopeStateFromCurrent_ACU: vi.fn(),
  clearChatSheetGuideDataForIsolationKey_ACU: vi.fn(),
  getChatSheetGuideDataForIsolationKey_ACU: vi.fn(() => null),
  getCurrentChatTemplateScopeState_ACU: vi.fn(() => null),
  getGlobalTemplateSnapshotForCurrentProfile_ACU: vi.fn(() => null),
  listChatTemplatePresetEntries_ACU: vi.fn(() => []),
  migrateLegacyTemplateScopeForCurrentChat_ACU: vi.fn(() => null),
  normalizeTemplateScopeIsolationKey_ACU: vi.fn((k: string) => k),
  normalizeTemplateScopeMode_ACU: vi.fn((mode: string) => ['chat_override', 'preset_link'].includes(mode) ? mode : 'inherit_global'),
  sanitizeChatSheetsObject_ACU: vi.fn((obj: any) => obj),
  sanitizeTemplateSnapshotForChat_ACU: vi.fn((obj: any) => obj ? { templateStr: JSON.stringify(obj) } : null),
  setCurrentChatTemplateScopeState_ACU: vi.fn(),
  upsertChatTemplatePresetEntry_ACU: vi.fn(),
}));

vi.mock('../../../src/service/worldbook/pipeline', () => ({
  refreshMergedDataAndNotify_ACU: vi.fn(),
}));

vi.mock('../../../src/shared/json-helpers', () => ({
  safeJsonParse_ACU: vi.fn((str: string, fb: any) => { try { return JSON.parse(str); } catch { return fb; } }),
  safeJsonStringify_ACU: vi.fn((obj: any, fb: string) => { try { return JSON.stringify(obj); } catch { return fb; } }),
}));

vi.mock('../../../src/shared/utils', () => ({
  logWarn_ACU: vi.fn(),
  logDebug_ACU: vi.fn(),
  ensureSheetOrderNumbers_ACU: vi.fn(),
  parseTableTemplateJson_ACU: vi.fn(() => ({ sheet_0: { name: '测试表' } })),
}));

vi.mock('../../../src/service/worldbook/injection-engine', () => ({
  buildDefaultExportConfig_ACU: vi.fn(() => ({})),
  ensureExportConfigDefaults_ACU: vi.fn((c: any) => c),
}));
vi.mock('../../../src/service/template/chat-template-reconciler', () => ({
  reconcileChatTemplate_ACU: vi.fn(),
}));
vi.mock('../../../src/service/table/storage-frame-v2-persist', () => ({
  commitCurrentFloorTemplateChanges_ACU: vi.fn(),
  commitCurrentFloorTemplateScopeOnly_ACU: vi.fn(),
}));
const replayMocks = vi.hoisted(() => ({
  load: vi.fn(),
}));
vi.mock('../../../src/service/table/storage-frame-v2-replay', () => ({
  loadTableStateFromFramesV2_ACU: replayMocks.load,
  loadTableStateFromFramesV2Detailed_ACU: vi.fn(async (...args: any[]) => {
    const data = await replayMocks.load(...args);
    return data ? { baseKind: 'full_checkpoint', data } : null;
  }),
  hasStructuralReplayCompatibilityRepairs_ACU: (repairs: any[] | undefined) => Boolean(repairs?.some(repair => repair.severity !== 'provisional')),
}));
vi.mock('../../../src/service/table/storage-strategy-resolver', () => ({
  resolveTableStorageStrategy_ACU: vi.fn(() => ({ mode: 'v2' })),
  isV2TagData_ACU: vi.fn((tagData: any) => tagData?.storageFrame?.version === 2 && Array.isArray(tagData.storageFrame.logEntries)),
  isLegacyV1TagData_ACU: vi.fn(() => false),
  hasLegacyTopLevelTableData_ACU: vi.fn(() => false),
}));
const switchModeMocks = vi.hoisted(() => ({
  resolveTemplateSwitchMode: vi.fn(() => ({ mode: 'inherit' })),
}));
vi.mock('../../../src/service/table/template-switch-mode-resolver', () => ({
  resolveTemplateSwitchMode_ACU: switchModeMocks.resolveTemplateSwitchMode,
}));
vi.mock('../../../src/service/table/table-write-transaction', () => ({
  captureTableRuntimeRevisionForWriteSet_ACU: vi.fn(() => 'runtime-v1:test'),
}));
vi.mock('../../../src/service/table/storage-mode', () => ({
  isSqliteMode: vi.fn(() => true),
  getCurrentStorageMode: vi.fn(() => 'sqlite'),
}));
vi.mock('../../../src/service/table/table-storage-strategy', () => ({
  reloadStorageProvider: vi.fn(),
  didSqliteFallbackAfterReload_ACU: vi.fn(() => false),
}));

import {
  listTemplatePresetNames_ACU,
  getTemplatePreset_ACU,
  upsertTemplatePreset_ACU,
  deleteTemplatePreset_ACU,
  getTemplatePresetDisplayName_ACU,
  ensureUniqueTemplatePresetName_ACU,
  normalizeTemplateOperationScope_ACU,
  resolveActiveTemplatePresetName_ACU,
  getActiveTemplatePresetMeta_ACU,
  normalizeTemplateForPresetSave_ACU,
  getDefaultTemplateSnapshot_ACU,
  parseImportedTemplateData_ACU,
  persistTemplateScopeSelectionState_ACU,
  applyTemplateSnapshotToScope_ACU,
  applyTemplatePresetToCurrent_ACU,
  applyChatTemplateSnapshotWithReconciliation_ACU,
  followGlobalTemplateForCurrentChat_ACU,
  getRuntimeTemplateSnapshot_ACU,
  resolveTemplateForExport_ACU,
} from '../../../src/service/template/template-preset-service';

import { saveSettings_ACU } from '../../../src/service/settings/settings-service';
import { getCurrentChatTemplateScopeState_ACU, sanitizeTemplateSnapshotForChat_ACU, getGlobalTemplateSnapshotForCurrentProfile_ACU, activateChatTemplatePresetSelection_ACU, normalizeTemplateScopeMode_ACU, setCurrentChatTemplateScopeState_ACU, clearChatSheetGuideDataForIsolationKey_ACU } from '../../../src/service/template/chat-scope';
import { getCurrentTemplatePresetName_ACU } from '../../../src/shared/template-preset-utils';
import { ensureSheetOrderNumbers_ACU, logWarn_ACU, parseTableTemplateJson_ACU } from '../../../src/shared/utils';
import { detectDisplayNameTranslationHazards_ACU, TemplateImportValidationError_ACU, validateImportedTemplateObject_ACU } from '../../../src/service/template/template-import-validator';
import { buildDefaultTableTemplateObject_ACU } from '../../../src/shared/table-defaults/index.js';
import { reconcileChatTemplate_ACU } from '../../../src/service/template/chat-template-reconciler';
import { getCurrentStorageMode, isSqliteMode } from '../../../src/service/table/storage-mode';
import { didSqliteFallbackAfterReload_ACU, reloadStorageProvider } from '../../../src/service/table/table-storage-strategy';
import { getActiveChatStorageIdentity_ACU } from '../../../src/data/storage/chat-history';
import { saveChatToHost_ACU } from '../../../src/data/gateways/chat-gateway';
import { refreshMergedDataAndNotify_ACU } from '../../../src/service/worldbook/pipeline';
import {
  subscribeTemplateRuntimeChanges_ACU,
} from '../../../src/shared/template-runtime-change';
import {
  commitCurrentFloorTemplateChanges_ACU,
  commitCurrentFloorTemplateScopeOnly_ACU,
} from '../../../src/service/table/storage-frame-v2-persist';
import { loadTableStateFromFramesV2_ACU, loadTableStateFromFramesV2Detailed_ACU } from '../../../src/service/table/storage-frame-v2-replay';
import { resolveTableStorageStrategy_ACU } from '../../../src/service/table/storage-strategy-resolver';
import { captureTableRuntimeRevisionForWriteSet_ACU } from '../../../src/service/table/table-write-transaction';

beforeEach(() => {
  // 清空 mockStore
  Object.keys(mockStore).forEach(k => delete mockStore[k]);
  vi.clearAllMocks();
  mockChat.splice(0, mockChat.length, { is_user: false });
  mockChatState.current = mockChat;
  switchModeMocks.resolveTemplateSwitchMode.mockReturnValue({ mode: 'inherit' });
  vi.mocked(getActiveChatStorageIdentity_ACU).mockReturnValue('chat-a');
  vi.mocked(getCurrentStorageMode).mockReturnValue('sqlite');
  vi.mocked(didSqliteFallbackAfterReload_ACU).mockReturnValue(false);
  vi.mocked(resolveTableStorageStrategy_ACU).mockReturnValue({ mode: 'v2' });
  vi.mocked(getCurrentChatTemplateScopeState_ACU).mockReturnValue(null);
  vi.mocked(getCurrentTemplatePresetName_ACU).mockReturnValue('');
  vi.mocked(normalizeTemplateScopeMode_ACU).mockImplementation((mode: string) => ['chat_override', 'preset_link'].includes(mode) ? mode : 'inherit_global');
});

// ═══ CRUD ═══
describe('listTemplatePresetNames_ACU', () => {
  it('无预设返回空数组', () => {
    expect(listTemplatePresetNames_ACU()).toEqual([]);
  });
  it('有预设返回排序后的名称', () => {
    mockStore.template_presets = JSON.stringify({
      version: 1,
      presets: { '预设B': { templateStr: '{}' }, '预设A': { templateStr: '{}' } },
    });
    const names = listTemplatePresetNames_ACU();
    expect(names).toEqual(['预设A', '预设B']);
  });
});

describe('getTemplatePreset_ACU', () => {
  it('找到预设返回对象', () => {
    mockStore.template_presets = JSON.stringify({
      version: 1,
      presets: { '预设A': { templateStr: '{"sheet_0":{}}', updatedAt: 1000 } },
    });
    const preset = getTemplatePreset_ACU('预设A');
    expect(preset).not.toBeNull();
    expect(preset!.templateStr).toContain('sheet_0');
  });
  it('未找到返回 null', () => {
    expect(getTemplatePreset_ACU('不存在')).toBeNull();
  });
  it('空名称返回 null', () => {
    expect(getTemplatePreset_ACU('')).toBeNull();
  });
});

describe('upsertTemplatePreset_ACU', () => {
  it('创建新预设', () => {
    const result = upsertTemplatePreset_ACU('新预设', '{"sheet_0":{}}');
    expect(result).toBe(true);
    const stored = JSON.parse(mockStore.template_presets);
    expect(stored.presets['新预设']).not.toBeUndefined();
    expect(stored.presets['新预设'].templateStr).toBe('{"sheet_0":{}}');
  });
  it('更新已有预设', () => {
    upsertTemplatePreset_ACU('预设A', '旧内容');
    upsertTemplatePreset_ACU('预设A', '新内容');
    const stored = JSON.parse(mockStore.template_presets);
    expect(stored.presets['预设A'].templateStr).toBe('新内容');
  });
  it('空名称返回 false', () => {
    expect(upsertTemplatePreset_ACU('', '{}')).toBe(false);
  });
});

describe('deleteTemplatePreset_ACU', () => {
  it('删除已有预设', () => {
    upsertTemplatePreset_ACU('预设A', '{}');
    const result = deleteTemplatePreset_ACU('预设A');
    expect(result).toBe(true);
    expect(getTemplatePreset_ACU('预设A')).toBeNull();
  });
  it('删除不存在的预设返回 false', () => {
    expect(deleteTemplatePreset_ACU('不存在')).toBe(false);
  });
  it('空名称返回 false', () => {
    expect(deleteTemplatePreset_ACU('')).toBe(false);
  });
});

// ═══ 纯逻辑工具函数 ═══
describe('getTemplatePresetDisplayName_ACU', () => {
  it('有名称返回名称', () => {
    expect(getTemplatePresetDisplayName_ACU('预设A')).toBe('预设A');
  });
  it('空名称返回默认预设', () => {
    expect(getTemplatePresetDisplayName_ACU('')).toBe('默认预设');
  });
  it('默认值标记返回默认预设', () => {
    expect(getTemplatePresetDisplayName_ACU('__default__')).toBe('默认预设');
  });
});

describe('ensureUniqueTemplatePresetName_ACU', () => {
  it('名称不冲突时原样返回', () => {
    expect(ensureUniqueTemplatePresetName_ACU('新预设')).toBe('新预设');
  });
  it('名称冲突时添加序号', () => {
    upsertTemplatePreset_ACU('预设A', '{}');
    const unique = ensureUniqueTemplatePresetName_ACU('预设A');
    expect(unique).toBe('预设A (2)');
  });
  it('空名称返回空字符串', () => {
    expect(ensureUniqueTemplatePresetName_ACU('')).toBe('');
  });
});

describe('normalizeTemplateOperationScope_ACU', () => {
  it('chat 返回 chat', () => {
    expect(normalizeTemplateOperationScope_ACU('chat')).toBe('chat');
  });
  it('其他值返回 global', () => {
    expect(normalizeTemplateOperationScope_ACU('global')).toBe('global');
    expect(normalizeTemplateOperationScope_ACU('')).toBe('global');
    expect(normalizeTemplateOperationScope_ACU('unknown')).toBe('global');
  });
});

// ═══ resolveActiveTemplatePresetName_ACU ═══
describe('resolveActiveTemplatePresetName_ACU', () => {
  it('无 chatScope 时回退到全局', () => {
    vi.mocked(getCurrentTemplatePresetName_ACU).mockReturnValueOnce('全局预设');
    expect(resolveActiveTemplatePresetName_ACU()).toBe('全局预设');
  });
  it('有 chatScope 时使用 chatScope 的 presetName', () => {
    vi.mocked(getCurrentChatTemplateScopeState_ACU).mockReturnValueOnce({ mode: 'chat_override', presetName: '聊天预设' } as any);
    expect(resolveActiveTemplatePresetName_ACU()).toBe('聊天预设');
  });
  it('chat_override 的空 presetName 表示默认聊天模板，不回退全局预设', () => {
    vi.mocked(getCurrentTemplatePresetName_ACU).mockReturnValue('global-A');
    vi.mocked(getCurrentChatTemplateScopeState_ACU).mockReturnValue({ mode: 'chat_override', presetName: '' } as any);

    expect(resolveActiveTemplatePresetName_ACU()).toBe('');
    expect(getActiveTemplatePresetMeta_ACU()).toMatchObject({
      presetName: '', displayName: '默认预设', mode: 'chat_override', scope: 'chat', scopeLabel: '当前聊天',
    });
  });
  it('preset_link 的空 presetName 同样保留默认模板语义', () => {
    vi.mocked(getCurrentTemplatePresetName_ACU).mockReturnValueOnce('global-A');
    vi.mocked(getCurrentChatTemplateScopeState_ACU).mockReturnValueOnce({ mode: 'preset_link', presetName: '' } as any);
    expect(resolveActiveTemplatePresetName_ACU()).toBe('');
  });
  it('inherit_global 的空 presetName 仍回退全局预设', () => {
    vi.mocked(getCurrentTemplatePresetName_ACU).mockReturnValueOnce('global-A');
    vi.mocked(getCurrentChatTemplateScopeState_ACU).mockReturnValueOnce({ mode: 'inherit_global', presetName: '' } as any);
    expect(resolveActiveTemplatePresetName_ACU()).toBe('global-A');
  });
  it('fallbackToGlobal=false 且无 chatScope 时返回空', () => {
    expect(resolveActiveTemplatePresetName_ACU({ fallbackToGlobal: false })).toBe('');
  });
});

// ═══ getActiveTemplatePresetMeta_ACU ═══
describe('getActiveTemplatePresetMeta_ACU', () => {
  it('返回包含 presetName 和 scope 的元数据', () => {
    const meta = getActiveTemplatePresetMeta_ACU();
    expect(meta).toHaveProperty('presetName');
    expect(meta).toHaveProperty('scope');
    expect(meta).toHaveProperty('displayName');
    expect(meta).toHaveProperty('mode');
    expect(meta).toHaveProperty('scopeLabel');
  });
  it('无 chatScope 时 scope 为 global', () => {
    const meta = getActiveTemplatePresetMeta_ACU();
    expect(meta.scope).toBe('global');
  });
});

// ═══ normalizeTemplateForPresetSave_ACU ═══
describe('normalizeTemplateForPresetSave_ACU', () => {
  it('正常模板返回 templateObj 和 templateStr', () => {
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValueOnce({ sheet_0: { name: '表' }, mate: { type: 'chatSheets' } });
    const result = normalizeTemplateForPresetSave_ACU();
    expect(result).not.toBeNull();
    expect(result!.templateObj).not.toBeNull();
    expect(result!.templateObj).toHaveProperty('sheet_0');
    expect(result!.templateStr).toContain('sheet_0');
  });
  it('parseTableTemplateJson 返回 null 时返回 null', () => {
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValueOnce(null);
    expect(normalizeTemplateForPresetSave_ACU()).toBeNull();
  });
});

// ═══ getDefaultTemplateSnapshot_ACU ═══
describe('getDefaultTemplateSnapshot_ACU', () => {
  it('返回默认模板快照', () => {
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValueOnce({ templateStr: '{"sheet_0":{}}', templateObj: { sheet_0: {} } } as any);
    const result = getDefaultTemplateSnapshot_ACU();
    expect(result).not.toBeNull();
    expect(result!.templateStr).toBe('{"sheet_0":{}}');
  });
});

// ═══ parseImportedTemplateData_ACU ═══
describe('parseImportedTemplateData_ACU', () => {
  it('有效 JSON 字符串解析成功', () => {
    const validTemplate = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_legacy_random: { uid: 'sheet_legacy_random', name: '表1', content: [['row_id', '名称']], sourceData: {} },
    };
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValueOnce({
      templateStr: JSON.stringify(validTemplate),
      templateObj: validTemplate,
    } as any);
    const result = parseImportedTemplateData_ACU(JSON.stringify(validTemplate));
    expect(result).toHaveProperty('snapshot');
    expect(result).toHaveProperty('templateObj');
    expect(result).toHaveProperty('templateStr');
  });
  it('无数据业务表头会在严格校验前补齐 row_id，且快照使用规范化结果', () => {
    const template = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_legacy_random: { uid: 'sheet_legacy_random', name: '表1', content: [['名称']], sourceData: {} },
    };
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockImplementationOnce((value: any) => ({
      templateStr: JSON.stringify(value),
      templateObj: value,
    }));

    const result = parseImportedTemplateData_ACU(template);

    expect(result.templateObj.sheet_legacy_random.content).toEqual([['row_id', '名称']]);
    expect(vi.mocked(sanitizeTemplateSnapshotForChat_ACU)).toHaveBeenCalledWith(expect.objectContaining({
      sheet_legacy_random: expect.objectContaining({ content: [['row_id', '名称']] }),
    }));
    expect(template.sheet_legacy_random.content).toEqual([['名称']]);
  });
  it('有数据的缺失 row_id 模板在严格校验前规范化，快照与输入对象契约保持一致', () => {
    const template = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_legacy_random: { uid: 'sheet_legacy_random', name: '表1', content: [['名称'], ['铁剑']], sourceData: {} },
    };
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockImplementationOnce((value: any) => ({
      templateStr: JSON.stringify(value), templateObj: value,
    }));

    const result = parseImportedTemplateData_ACU(template);

    expect(result.templateObj.sheet_legacy_random.content).toEqual([
      ['row_id', '名称'], ['1', '铁剑'],
    ]);
    expect(sanitizeTemplateSnapshotForChat_ACU).toHaveBeenCalledWith(expect.objectContaining({
      sheet_legacy_random: expect.objectContaining({ content: [['row_id', '名称'], ['1', '铁剑']] }),
    }));
    expect(template.sheet_legacy_random.content).toEqual([['名称'], ['铁剑']]);
  });
  it('无效 JSON 抛出错误', () => {
    expect(() => parseImportedTemplateData_ACU('not json')).toThrow('JSON解析错误');
  });
  it('缺少 mate 抛出错误', () => {
    expect(() => parseImportedTemplateData_ACU('{"sheet_0":{}}')).toThrow('mate');
  });
  it('缺少 sheet 抛出错误', () => {
    expect(() => parseImportedTemplateData_ACU('{"mate":{"type":"chatSheets"}}')).toThrow('未找到任何表格');
  });
  it('sheet 结构不完整抛出错误', () => {
    const data = { mate: { type: 'chatSheets' }, sheet_0: { name: '表' } };
    expect(() => parseImportedTemplateData_ACU(data)).toThrow('结构不完整');
  });
  it('非字符串非对象抛出错误', () => {
    expect(() => parseImportedTemplateData_ACU(123)).toThrow('无效的模板数据');
  });
  it('校验失败时不会调用 sanitizer 或持久化预设', () => {
    const invalid = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_legacy_random: { uid: 'sheet_legacy_random', name: '表1', content: [['名称', 'row_id']], sourceData: {} },
    };
    const storeBefore = JSON.stringify(mockStore);
    expect(() => parseImportedTemplateData_ACU(invalid)).toThrow(TemplateImportValidationError_ACU);
    expect(sanitizeTemplateSnapshotForChat_ACU).not.toHaveBeenCalled();
    expect(JSON.stringify(mockStore)).toBe(storeBefore);
  });

  it('显式 dataMode=replace 时返回回填的 dataMode/conflictPolicy', () => {
    const template = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { uid: 'sheet_a', name: '表1', content: [['row_id', '名称'], ['1', '铁剑']], sourceData: {} },
    };
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockImplementationOnce((value: any) => ({
      templateStr: JSON.stringify(value), templateObj: value,
    }));
    const result = parseImportedTemplateData_ACU(template, { dataMode: 'replace', conflictPolicy: 'reject' });
    expect(result.dataMode).toBe('replace');
    expect(result.conflictPolicy).toBe('reject');
  });

  it('模板带数据且未显式指定时默认推导 replace（runtime 空）', () => {
    const template = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { uid: 'sheet_a', name: '表1', content: [['row_id', '名称'], ['1', '铁剑']], sourceData: {} },
    };
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockImplementationOnce((value: any) => ({
      templateStr: JSON.stringify(value), templateObj: value,
    }));
    const result = parseImportedTemplateData_ACU(template);
    expect(result.dataMode).toBe('replace');
    expect(result.conflictPolicy).toBe('keep-current');
  });

  it('模板无数据时默认推导 seed（不凭空造行）', () => {
    const template = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { uid: 'sheet_a', name: '表1', content: [['row_id', '名称']], sourceData: {} },
    };
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockImplementationOnce((value: any) => ({
      templateStr: JSON.stringify(value), templateObj: value,
    }));
    const result = parseImportedTemplateData_ACU(template);
    expect(result.dataMode).toBe('seed');
  });

  it('显式 dataMode=merge 时保留显式值并规范化 conflictPolicy', () => {
    const template = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { uid: 'sheet_a', name: '表1', content: [['row_id', 'code', 'name'], ['1', 'C1', '铁剑']], sourceData: {} },
    };
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockImplementationOnce((value: any) => ({
      templateStr: JSON.stringify(value), templateObj: value,
    }));
    const result = parseImportedTemplateData_ACU(template, { dataMode: 'merge' });
    expect(result.dataMode).toBe('merge');
    expect(result.conflictPolicy).toBe('keep-current');
  });

  it('content 与 seedRows 完全重复时导入入口自动去重并返回 deduplication 审计', () => {
    const template = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: {
        uid: 'sheet_a', name: '表1',
        content: [['row_id', '名称'], ['1', '铁剑']],
        seedRows: [['1', '铁剑']],
        sourceData: {},
      },
    };
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockImplementationOnce((value: any) => ({
      templateStr: JSON.stringify(value), templateObj: value,
    }));
    const result = parseImportedTemplateData_ACU(template);
    expect(result).toHaveProperty('snapshot');
    // 去重后 seedRows 副本被删除，content 保留主行
    expect(result.templateObj.sheet_a.content).toEqual([['row_id', '名称'], ['1', '铁剑']]);
    expect(result.templateObj.sheet_a.seedRows).toEqual([]);
    expect(result.deduplication).toEqual([
      { sheetKey: 'sheet_a', sheetName: '表1', removedCount: 1, rowIds: ['1'] },
    ]);
    // 输入对象不被修改
    expect(template.sheet_a.seedRows).toEqual([['1', '铁剑']]);
  });

  it('content 与 seedRows 同 row_id 但内容不同时导入入口仍阻断', () => {
    const template = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: {
        uid: 'sheet_a', name: '表1',
        content: [['row_id', '名称'], ['1', '铁剑']],
        seedRows: [['1', '盾牌']],
        sourceData: {},
      },
    };
    expect(() => parseImportedTemplateData_ACU(template)).toThrow(TemplateImportValidationError_ACU);
    expect(sanitizeTemplateSnapshotForChat_ACU).not.toHaveBeenCalled();
  });

  it('多张首列为 null 占位的表经真实导入入口规范化，不再报第 2 列列名不能为空', () => {
    const template = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_worldview: {
        uid: 'sheet_worldview', name: '世界观',
        content: [[null, '主要世界观', '力量体系'], ['', '高魔', '强者']],
        sourceData: { ddl: 'CREATE TABLE worldview (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  worldview TEXT, -- 主要世界观\n  power_system TEXT -- 力量体系\n);' },
      },
      sheet_system: {
        uid: 'sheet_system', name: '系统',
        content: [[null, '系统名', '版本'], ['', '斗气', '1.0']],
        sourceData: { ddl: 'CREATE TABLE system (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  name TEXT, -- 系统名\n  version TEXT -- 版本\n);' },
      },
    };
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockImplementationOnce((value: any) => ({
      templateStr: JSON.stringify(value), templateObj: value,
    }));

    const result = parseImportedTemplateData_ACU(template);

    expect(result).toHaveProperty('snapshot');
    expect(result).toHaveProperty('templateObj');
    expect(result.templateObj.sheet_worldview.content).toEqual([
      ['row_id', '主要世界观', '力量体系'], ['1', '高魔', '强者'],
    ]);
    expect(result.templateObj.sheet_system.content).toEqual([
      ['row_id', '系统名', '版本'], ['1', '斗气', '1.0'],
    ]);
    expect(result.templateObj.sheet_worldview.sourceData.ddl).toContain('row_id INTEGER PRIMARY KEY');
    expect(result.templateObj.sheet_system.sourceData.ddl).toContain('row_id INTEGER PRIMARY KEY');
    // 输入对象不被修改
    expect(template.sheet_worldview.content[0]).toEqual([null, '主要世界观', '力量体系']);
    expect(template.sheet_system.content[0]).toEqual([null, '系统名', '版本']);
  });

});

describe('validateImportedTemplateObject_ACU', () => {
  const validSheet = (overrides: any = {}) => ({
    uid: 'sheet_legacy_random', name: '背包', content: [['row_id', '名称']], sourceData: {}, ...overrides,
  });
  const sheetWithDdl = (uid: string, name: string, columnName: string, sqlName: string) => ({
    uid,
    name,
    content: [['row_id', columnName]],
    sourceData: {
      ddl: `CREATE TABLE ignored ( -- ${name}\n  row_id INTEGER PRIMARY KEY, -- 行号\n  ${sqlName} TEXT -- ${columnName}\n);`,
    },
  });

  it('保留合法历史随机 key，并且不修改输入', () => {
    const template = { mate: { type: 'chatSheets' }, sheet_legacy_random: validSheet() };
    const before = JSON.stringify(template);
    expect(validateImportedTemplateObject_ACU(template)).toEqual([]);
    expect(JSON.stringify(template)).toBe(before);
  });

  it('接受项目默认模板中的混合大小写历史随机 key', () => {
    expect(validateImportedTemplateObject_ACU(buildDefaultTableTemplateObject_ACU())).toEqual([]);
  });

  it('拒绝大小写错误或无 sheet_ 前缀的 sheet-like 顶层对象', () => {
    const invalid = {
      mate: { type: 'chatSheets' },
      sheet_valid: validSheet({ uid: 'sheet_valid' }),
      Sheet_wrong_case: validSheet({ uid: 'Sheet_wrong_case' }),
      misplaced: validSheet({ uid: 'misplaced' }),
      incomplete: { name: '缺字段表', content: [['row_id', '名称']] },
    };
    expect(validateImportedTemplateObject_ACU(invalid)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid_sheet_key', sheetKey: 'Sheet_wrong_case' }),
      expect.objectContaining({ code: 'invalid_sheet_key', sheetKey: 'misplaced' }),
      expect.objectContaining({ code: 'invalid_sheet_key', sheetKey: 'incomplete' }),
    ]));
    expect(() => parseImportedTemplateData_ACU(invalid)).toThrow(TemplateImportValidationError_ACU);
    expect(sanitizeTemplateSnapshotForChat_ACU).not.toHaveBeenCalled();
  });

  it('拒绝重复 canonical 表名和不一致 uid', () => {
    const template = {
      mate: { type: 'chatSheets' },
      sheet_one: validSheet({ uid: 'sheet_one', name: ' Inventory ' }),
      sheet_two: validSheet({ uid: 'sheet_wrong', name: 'inventory' }),
    };
    expect(validateImportedTemplateObject_ACU(template)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'duplicate_sheet_name', sheetKey: 'sheet_two' }),
      expect.objectContaining({ code: 'sheet_uid_mismatch', sheetKey: 'sheet_two' }),
    ]));
  });

  it('拒绝与另一张表当前名称或历史名称规范化冲突的 tableAliases', () => {
    const template = {
      mate: { type: 'chatSheets' },
      sheet_protagonist: validSheet({
        uid: 'sheet_protagonist',
        name: '主角信息表',
        sourceData: { tableAliases: ['主角信息'] },
      }),
      sheet_other: validSheet({
        uid: 'sheet_other',
        name: '其他表',
        sourceData: { tableAliases: [' Ｐｒｏｔａｇｏｎｉｓｔ＿Ｉｎｆｏ ', '主角信息'] },
      }),
    };

    expect(validateImportedTemplateObject_ACU(template)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'table_alias_conflict', sheetKey: 'sheet_other', conflictsWith: 'sheet_protagonist' }),
    ]));
  });

  it('拒绝缺失表头、错位 row_id、空列和 canonical 重名列', () => {
    const missingHeader = { mate: { type: 'chatSheets' }, sheet_one: validSheet({ uid: 'sheet_one', content: [] }) };
    expect(validateImportedTemplateObject_ACU(missingHeader)).toContainEqual(expect.objectContaining({ code: 'missing_header_row' }));
    const malformedHeaders = { mate: { type: 'chatSheets' }, sheet_one: validSheet({ uid: 'sheet_one', content: [['名称', 'row_id', ' 名称 ', '']] }) };
    expect(validateImportedTemplateObject_ACU(malformedHeaders)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'missing_row_id' }),
      expect.objectContaining({ code: 'misplaced_row_id', columnIndex: 1 }),
      expect.objectContaining({ code: 'duplicate_column_name', columnIndex: 2 }),
      expect.objectContaining({ code: 'empty_header_cell', columnIndex: 3 }),
    ]));
  });

  it('拒绝映射到同一物理列名候选的显示列', () => {
    const template = { mate: { type: 'chatSheets' }, sheet_one: validSheet({ uid: 'sheet_one', content: [['row_id', 'a b', 'a-b']] }) };
    expect(validateImportedTemplateObject_ACU(template)).toContainEqual(expect.objectContaining({
      code: 'physical_column_name_collision', columnIndex: 2, conflictsWith: 1,
    }));
  });

  it('同展示列映射到同一物理列时不报告翻译歧义', () => {
    const template = {
      mate: { type: 'chatSheets' },
      sheet_one: sheetWithDdl('sheet_one', '表一', '名称', 'name'),
      sheet_two: sheetWithDdl('sheet_two', '表二', '名称', 'name'),
    };

    expect(detectDisplayNameTranslationHazards_ACU(template)).toEqual([]);
  });

  it('同展示列映射到不同物理列时报告非阻断翻译风险', () => {
    const template = {
      mate: { type: 'chatSheets' },
      sheet_one: sheetWithDdl('sheet_one', '表一', '名称', 'person_name'),
      sheet_two: sheetWithDdl('sheet_two', '表二', '名称', 'item_name'),
    };

    expect(detectDisplayNameTranslationHazards_ACU(template)).toContainEqual(expect.objectContaining({
      code: 'display_column_translation_ambiguity', sheetKey: 'sheet_two', conflictsWith: 'sheet_one',
    }));
  });

  it('表展示名是另一张表列展示名子串时报告翻译风险', () => {
    const template = {
      mate: { type: 'chatSheets' },
      sheet_place: sheetWithDdl('sheet_place', '地点', '名称', 'name'),
      sheet_character: sheetWithDdl('sheet_character', '角色', '所在地点', 'location_name'),
    };

    expect(detectDisplayNameTranslationHazards_ACU(template)).toContainEqual(expect.objectContaining({
      code: 'display_name_substring_hazard', sheetKey: 'sheet_place', conflictsWith: 'sheet_character',
    }));
  });

  it('表展示名也是本表列展示名子串时同样报告翻译风险', () => {
    const template = {
      mate: { type: 'chatSheets' },
      sheet_place: sheetWithDdl('sheet_place', '地点', '所在地点', 'location_name'),
    };

    expect(detectDisplayNameTranslationHazards_ACU(template)).toContainEqual(expect.objectContaining({
      code: 'display_name_substring_hazard', sheetKey: 'sheet_place', conflictsWith: 'sheet_place',
    }));
  });

  it('默认模板没有展示名翻译风险', () => {
    expect(detectDisplayNameTranslationHazards_ACU(buildDefaultTableTemplateObject_ACU())).toEqual([]);
  });

  it('展示名翻译风险仅记录警告，不阻断导入', () => {
    const template = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_one: sheetWithDdl('sheet_one', '表一', '名称', 'person_name'),
      sheet_two: sheetWithDdl('sheet_two', '表二', '名称', 'item_name'),
    };
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValueOnce({
      templateStr: JSON.stringify(template),
      templateObj: template,
    } as any);

    expect(() => parseImportedTemplateData_ACU(template)).not.toThrow();
    expect(logWarn_ACU).toHaveBeenCalledWith(expect.stringContaining('SQL 展示名翻译风险'));
  });
});

// ═══ persistTemplateScopeSelectionState_ACU ═══
describe('persistTemplateScopeSelectionState_ACU', () => {
  it('updateGlobal=true 时调用 saveSettings', () => {
    persistTemplateScopeSelectionState_ACU('预设A', { updateGlobal: true, save: true });
    expect(saveSettings_ACU).toHaveBeenCalled();
  });
  it('save=false 时不调用 saveSettings', () => {
    vi.mocked(saveSettings_ACU).mockClear();
    persistTemplateScopeSelectionState_ACU('预设A', { save: false });
    expect(saveSettings_ACU).not.toHaveBeenCalled();
  });
  it('返回规范化的预设名', () => {
    const result = persistTemplateScopeSelectionState_ACU('  预设B  ');
    expect(result).toBe('预设B');
  });
});

// ═══ applyTemplateSnapshotToScope_ACU ═══
describe('applyTemplateSnapshotToScope_ACU', () => {
  it('有效快照应用成功（当前聊天有 chat_override 时走轻路径，不触发协调）', async () => {
    vi.mocked(getCurrentChatTemplateScopeState_ACU).mockReturnValue({ mode: 'chat_override', templateStr: '{"sheet_x":{}}' } as any);
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValueOnce({
      templateStr: '{"sheet_0":{}}',
      templateObj: { sheet_0: {} },
    } as any);
    const result = await applyTemplateSnapshotToScope_ACU('{"sheet_0":{}}', { scope: 'global' });
    expect(result).toBeTruthy();
    expect((result as any).saved).toBe(true);
    // 全局切换不影响 chat_override 聊天的生效模板：不得触发协调提交
    expect(reconcileChatTemplate_ACU).not.toHaveBeenCalled();
    expect(commitCurrentFloorTemplateScopeOnly_ACU).not.toHaveBeenCalled();
    expect(commitCurrentFloorTemplateChanges_ACU).not.toHaveBeenCalled();
  });
  it('无效快照返回 false', async () => {
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValueOnce(null);
    const result = await applyTemplateSnapshotToScope_ACU(null);
    expect(result).toBe(false);
  });

  it('全局模板实际应用成功后才发布运行时变更（空聊天走轻路径）', async () => {
    mockChatState.current = [];
    const received = vi.fn();
    const unsubscribe = subscribeTemplateRuntimeChanges_ACU(received);
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValueOnce({
      templateStr: '{"sheet_0":{}}',
      templateObj: { sheet_0: {} },
    } as any);

    try {
      await expect(applyTemplateSnapshotToScope_ACU('{"sheet_0":{}}', { scope: 'global' })).resolves.toBeTruthy();
      expect(received).toHaveBeenCalledOnce();
      // 空聊天不受全局切换影响：不触发协调
      expect(reconcileChatTemplate_ACU).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });
});

// ═══ S1-3：全局切换影响 inherit_global 聊天时强制走协调器 ═══
describe('applyTemplateSnapshotToScope_ACU S1-3 全局切换协调', () => {
  const candidate = {
    mate: { type: 'chatSheets', version: 1 },
    sheet_0: { uid: 'sheet_0', name: '表', content: [['row_id']], sourceData: {}, updateConfig: {}, exportConfig: {} },
  };

  function mockSuccessfulReconciliation() {
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValue({
      templateStr: JSON.stringify(candidate),
      templateObj: candidate,
    } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockResolvedValue(candidate as any);
    vi.mocked(reconcileChatTemplate_ACU).mockResolvedValue({
      candidateData: candidate, sheetChanges: [], deletedSheetKeys: [], blockers: [], audit: [],
    } as any);
    vi.mocked(commitCurrentFloorTemplateScopeOnly_ACU).mockResolvedValue({ saved: true, mode: 'scope_only' } as any);
  }

  it('inherit_global + 非空聊天：先协调提交当前聊天，成功后落全局并把 scope 翻回 inherit_global', async () => {
    mockSuccessfulReconciliation();

    const result: any = await applyTemplateSnapshotToScope_ACU(candidate, {
      scope: 'global',
      source: 'ui_global_select',
      presetName: '预设A',
    });

    expect(result).toMatchObject({ saved: true, scope: 'global', reconciledCurrentChat: true });
    // 协调提交确实发生（scope-only 或结构提交其一）
    expect(commitCurrentFloorTemplateScopeOnly_ACU).toHaveBeenCalled();
    // 提交成功后 scope 翻回 inherit_global（不清指导表，不走 persistTemplateScopeSelectionState 的 inherit_global 分支）
    expect(setCurrentChatTemplateScopeState_ACU).toHaveBeenCalledWith(
      { mode: 'inherit_global' },
      expect.objectContaining({ reason: 'template_scope_global_switch_reconcile' }),
    );
    expect(clearChatSheetGuideDataForIsolationKey_ACU).not.toHaveBeenCalled();
    // 全局状态照常落盘
    const { saveCurrentProfileTemplate_ACU } = await import('../../../src/data/repositories/profile-repo');
    expect(saveCurrentProfileTemplate_ACU).toHaveBeenCalled();
    expect(saveChatToHost_ACU).toHaveBeenCalled();
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockRestore();
  });

  it('协调被 blockers 拒绝时返回 saved:false 且不碰任何全局状态（fail-closed）', async () => {
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValue({
      templateStr: JSON.stringify(candidate),
      templateObj: candidate,
    } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockResolvedValue(candidate as any);
    vi.mocked(reconcileChatTemplate_ACU).mockResolvedValue({
      candidateData: candidate, sheetChanges: [], deletedSheetKeys: [],
      blockers: ['删除表「旧表」需要显式确认'], audit: [],
    } as any);

    const result: any = await applyTemplateSnapshotToScope_ACU(candidate, {
      scope: 'global',
      source: 'ui_global_select',
      presetName: '预设A',
    });

    expect(result).toMatchObject({ saved: false });
    expect(result.blockers).toEqual(['删除表「旧表」需要显式确认']);
    const { saveCurrentProfileTemplate_ACU } = await import('../../../src/data/repositories/profile-repo');
    const { persistCurrentTemplatePresetName_ACU } = await import('../../../src/service/settings/settings-service');
    const { _set_TABLE_TEMPLATE_ACU } = await import('../../../src/shared/defaults-json.js');
    expect(saveCurrentProfileTemplate_ACU).not.toHaveBeenCalled();
    expect(persistCurrentTemplatePresetName_ACU).not.toHaveBeenCalled();
    expect(_set_TABLE_TEMPLATE_ACU).not.toHaveBeenCalled();
    expect(setCurrentChatTemplateScopeState_ACU).not.toHaveBeenCalledWith(
      { mode: 'inherit_global' },
      expect.anything(),
    );
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockRestore();
  });

  it('applyTemplatePresetToCurrent_ACU updateGlobal:true 透传协调失败（saved:false + blockers）', async () => {
    upsertTemplatePreset_ACU('预设A', JSON.stringify(candidate));
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValue({
      templateStr: JSON.stringify(candidate),
      templateObj: candidate,
    } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockResolvedValue(candidate as any);
    vi.mocked(reconcileChatTemplate_ACU).mockResolvedValue({
      candidateData: candidate, sheetChanges: [], deletedSheetKeys: [],
      blockers: ['删除列「HP」需要显式确认'], audit: [],
    } as any);

    const result: any = await applyTemplatePresetToCurrent_ACU('预设A', { updateGlobal: true });

    expect(result).toMatchObject({ saved: false });
    expect(result.blockers).toEqual(['删除列「HP」需要显式确认']);
    expect(result.isDefault).toBeUndefined();
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockRestore();
  });
});

// ═══ applyTemplatePresetToCurrent_ACU ═══
describe('applyTemplatePresetToCurrent_ACU', () => {
  it('默认预设应用成功（空聊天走轻路径）', async () => {
    mockChatState.current = [];
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValue({
      templateStr: '{"sheet_0":{}}',
      templateObj: { sheet_0: {} },
    } as any);
    const result = await applyTemplatePresetToCurrent_ACU('', { updateGlobal: true });
    expect(result).toBeTruthy();
    expect(reconcileChatTemplate_ACU).not.toHaveBeenCalled();
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockRestore();
  });
  it('不存在的预设返回 false', async () => {
    const result = await applyTemplatePresetToCurrent_ACU('不存在的预设', { updateGlobal: true });
    expect(result).toBe(false);
  });
  it('updateGlobal=false 且无结构变化时通过 scope-only 提交应用 chat 模板', async () => {
    const candidate = { mate: { type: 'chatSheets', version: 1 }, sheet_0: { uid: 'sheet_0', name: '表', content: [['row_id']], sourceData: {}, updateConfig: {}, exportConfig: {} } };
    upsertTemplatePreset_ACU('预设A', JSON.stringify(candidate));
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValue({ templateStr: JSON.stringify(candidate), templateObj: candidate } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockResolvedValue(candidate as any);
    vi.mocked(reconcileChatTemplate_ACU).mockResolvedValue({ candidateData: candidate, sheetChanges: [], deletedSheetKeys: [], blockers: [], audit: [] } as any);
    vi.mocked(commitCurrentFloorTemplateScopeOnly_ACU).mockResolvedValue({ saved: true, mode: 'scope_only' } as any);

    const result = await applyTemplatePresetToCurrent_ACU('预设A', { updateGlobal: false });

    expect(result).toMatchObject({ presetName: '预设A', mode: 'chat_override', fromGlobalPreset: true });
    expect(commitCurrentFloorTemplateScopeOnly_ACU).toHaveBeenCalledWith(expect.objectContaining({
      baselineData: candidate, candidateData: candidate, templateSource: candidate,
    }));
    expect(commitCurrentFloorTemplateChanges_ACU).not.toHaveBeenCalled();
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockRestore();
  });

  it('聊天选择全局预设时物化为 chat_override 快照而不是 preset_link', async () => {
    vi.mocked(activateChatTemplatePresetSelection_ACU).mockClear();
    upsertTemplatePreset_ACU('预设A', '{"sheet_0":{"name":"全局表"}}');
    const candidate = { mate: { type: 'chatSheets', version: 1 }, sheet_0: { uid: 'sheet_0', name: '全局表', content: [['row_id']], sourceData: {}, updateConfig: {}, exportConfig: {} } };
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValue({
      templateStr: JSON.stringify(candidate),
      templateObj: candidate,
    } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockResolvedValue(candidate as any);
    vi.mocked(reconcileChatTemplate_ACU).mockResolvedValue({ candidateData: candidate, sheetChanges: [], deletedSheetKeys: [], blockers: [], audit: [] } as any);
    vi.mocked(commitCurrentFloorTemplateScopeOnly_ACU).mockResolvedValue({ saved: true, mode: 'scope_only' } as any);

    const result = await applyTemplatePresetToCurrent_ACU('预设A', {
      updateGlobal: false,
      chatSelectionSource: 'global',
    });

    expect(result).toMatchObject({ mode: 'chat_override', fromGlobalPreset: true });
    expect(activateChatTemplatePresetSelection_ACU).not.toHaveBeenCalled();
    expect(commitCurrentFloorTemplateScopeOnly_ACU).toHaveBeenCalledWith(expect.objectContaining({
      baselineData: candidate, candidateData: candidate, templateSource: candidate,
    }));
    expect(commitCurrentFloorTemplateChanges_ACU).not.toHaveBeenCalled();
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockRestore();
  });
});

describe('applyChatTemplateSnapshotWithReconciliation_ACU', () => {
  const candidate = { mate: { type: 'chatSheets', version: 1 }, sheet_live: { uid: 'sheet_live', name: '背包', content: [['row_id', '名称']], sourceData: {}, updateConfig: {}, exportConfig: {} } };

  it('无持久化表格数据时按表名重新分配稳定 key，并以空基线创建首次 checkpoint', async () => {
    const legacyCandidate = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_randomA: { ...candidate.sheet_live, uid: 'sheet_randomA', name: '背包' },
      sheet_randomB: { ...candidate.sheet_live, uid: 'sheet_randomB', name: '任务表' },
    };
    switchModeMocks.resolveTemplateSwitchMode.mockReturnValue({ mode: 'pristine' } as any);
    const staleGuide = { mate: legacyCandidate.mate, sheet_randomA: { seedRows: [['old-row']] } };
    const { getChatSheetGuideDataForIsolationKey_ACU, buildChatSheetGuideDataFromData_ACU } = await import('../../../src/service/template/chat-scope');
    vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue(staleGuide as any);
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValue({ templateObj: legacyCandidate, templateStr: JSON.stringify(legacyCandidate) } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockResolvedValue(null);
    vi.mocked(reconcileChatTemplate_ACU).mockImplementation(async ({ baselineData, templateData }: any) => ({
      candidateData: templateData,
      sheetChanges: Object.keys(templateData).filter(key => key.startsWith('sheet_')).map(sheetKey => ({
        kind: 'introduction', sheetKey, sheetData: templateData[sheetKey],
      })),
      deletedSheetKeys: [],
      blockers: [],
      audit: [],
      baselineData,
    }) as any);
    vi.mocked(commitCurrentFloorTemplateChanges_ACU).mockResolvedValue({ saved: true, mode: 'v2_commit' } as any);

    const result = await applyChatTemplateSnapshotWithReconciliation_ACU(legacyCandidate);

    expect(reconcileChatTemplate_ACU).toHaveBeenCalledWith(expect.objectContaining({
      baselineData: { mate: legacyCandidate.mate },
      templateData: expect.objectContaining({
        sheet_bei_bao: expect.objectContaining({ uid: 'sheet_bei_bao', name: '背包' }),
        sheet_ren_wu_biao: expect.objectContaining({ uid: 'sheet_ren_wu_biao', name: '任务表' }),
      }),
    }));
    // pristine 会话切模板不得产生任何 storage frame：结构只落 guide + scope 容器。
    expect(commitCurrentFloorTemplateChanges_ACU).not.toHaveBeenCalled();
    expect(commitCurrentFloorTemplateScopeOnly_ACU).toHaveBeenCalledWith(expect.objectContaining({
      pristineOverride: true,
    }));
    expect(buildChatSheetGuideDataFromData_ACU).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      preserveSeedRowsFromGuideData: null,
      seedRowsFromTemplateObj: expect.objectContaining({ sheet_bei_bao: expect.any(Object) }),
    }));
    expect(result).toMatchObject({ saved: true });
  });

  it('pristine 重分配不修改输入，并保留非 sheet 字段与模板 seedRows', async () => {
    const template = {
      mate: { type: 'chatSheets', version: 1 },
      customTemplateMetadata: { revision: 7 },
      sheet_legacy: {
        ...candidate.sheet_live,
        uid: 'sheet_legacy',
        name: 'Inventory',
        seedRows: [['template-row']],
      },
    };
    const before = JSON.stringify(template);
    switchModeMocks.resolveTemplateSwitchMode.mockReturnValue({ mode: 'pristine' } as any);
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValue({ templateObj: template, templateStr: JSON.stringify(template) } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockResolvedValue(null);
    vi.mocked(reconcileChatTemplate_ACU).mockImplementation(async ({ templateData }: any) => ({
      candidateData: templateData,
      sheetChanges: [{ kind: 'introduction', sheetKey: 'sheet_inventory', sheetData: templateData.sheet_inventory }],
      deletedSheetKeys: [],
      blockers: [],
      audit: [],
    }) as any);
    vi.mocked(commitCurrentFloorTemplateChanges_ACU).mockResolvedValue({ saved: true, mode: 'v2_commit' } as any);

    const result = await applyChatTemplateSnapshotWithReconciliation_ACU(template);

    expect(result).toMatchObject({ saved: true });
    expect(JSON.stringify(template)).toBe(before);
    expect(reconcileChatTemplate_ACU).toHaveBeenCalledWith(expect.objectContaining({
      templateData: expect.objectContaining({
        customTemplateMetadata: { revision: 7 },
        sheet_inventory: expect.objectContaining({
          uid: 'sheet_inventory',
          seedRows: [['template-row']],
        }),
      }),
    }));
  });

  it.each([
    ['空表名', ['', '有效表'], 'empty_name'],
    ['canonical 重名', [' Inventory ', 'inventory'], 'duplicate_canonical_name'],
  ])('pristine 模板存在%s时 fail-loud，且零协调零提交', async (_label, names, diagnostic) => {
    const invalidTemplate = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_one: { ...candidate.sheet_live, uid: 'sheet_one', name: names[0] },
      sheet_two: { ...candidate.sheet_live, uid: 'sheet_two', name: names[1] },
    };
    switchModeMocks.resolveTemplateSwitchMode.mockReturnValue({ mode: 'pristine' } as any);
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValue({ templateObj: invalidTemplate, templateStr: JSON.stringify(invalidTemplate) } as any);

    const result = await applyChatTemplateSnapshotWithReconciliation_ACU(invalidTemplate);

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining(diagnostic) });
    expect(reconcileChatTemplate_ACU).not.toHaveBeenCalled();
    expect(commitCurrentFloorTemplateChanges_ACU).not.toHaveBeenCalled();
    expect(commitCurrentFloorTemplateScopeOnly_ACU).not.toHaveBeenCalled();
  });

  it('pristine 模板含畸形 sheet 时 fail-loud，不能静默丢表', async () => {
    const malformedTemplate = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_valid: { ...candidate.sheet_live, uid: 'sheet_valid', name: '有效表' },
      sheet_broken: [],
    };
    switchModeMocks.resolveTemplateSwitchMode.mockReturnValue({ mode: 'pristine' } as any);
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValue({ templateObj: malformedTemplate, templateStr: JSON.stringify(malformedTemplate) } as any);

    const result = await applyChatTemplateSnapshotWithReconciliation_ACU(malformedTemplate);

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('sheet_broken') });
    expect(reconcileChatTemplate_ACU).not.toHaveBeenCalled();
    expect(commitCurrentFloorTemplateChanges_ACU).not.toHaveBeenCalled();
    expect(commitCurrentFloorTemplateScopeOnly_ACU).not.toHaveBeenCalled();
  });

  it('畸形 V2 被分类为 v2 且 replay 不可用时 fail-closed，不重分配也不协调', async () => {
    const legacyKeyTemplate = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_random_history: { ...candidate.sheet_live, uid: 'sheet_random_history' },
    };
    vi.mocked(resolveTableStorageStrategy_ACU).mockReturnValue({ mode: 'v2' });
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValue({ templateObj: legacyKeyTemplate, templateStr: JSON.stringify(legacyKeyTemplate) } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockResolvedValue(null);
    vi.mocked(reconcileChatTemplate_ACU).mockResolvedValue({ candidateData: legacyKeyTemplate, sheetChanges: [], deletedSheetKeys: [], blockers: ['V2 replay 不可用'], audit: [] } as any);

    const result = await applyChatTemplateSnapshotWithReconciliation_ACU(legacyKeyTemplate);

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('V2 replay 基线不可用') });
    expect(reconcileChatTemplate_ACU).not.toHaveBeenCalled();
    expect(commitCurrentFloorTemplateChanges_ACU).not.toHaveBeenCalled();
    expect(commitCurrentFloorTemplateScopeOnly_ACU).not.toHaveBeenCalled();
  });

  it('已有持久化表格数据时保留模板既有 key，继续走严格协调', async () => {
    vi.mocked(resolveTableStorageStrategy_ACU).mockReturnValue({ mode: 'v2' });
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValue({ templateObj: candidate, templateStr: JSON.stringify(candidate) } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockResolvedValue(candidate as any);
    vi.mocked(reconcileChatTemplate_ACU).mockResolvedValue({ candidateData: candidate, sheetChanges: [], deletedSheetKeys: [], blockers: ['key 冲突'], audit: [] } as any);

    const result = await applyChatTemplateSnapshotWithReconciliation_ACU(candidate);

    expect(reconcileChatTemplate_ACU).toHaveBeenCalledWith(expect.objectContaining({ templateData: candidate, baselineData: candidate }));
    expect(result).toMatchObject({ saved: false, blockers: ['key 冲突'] });
  });

  it('已有 legacy 持久化数据时不重分配模板 key，并由原提交契约 fail-closed', async () => {
    vi.mocked(resolveTableStorageStrategy_ACU).mockReturnValue({ mode: 'legacy-v1', reason: 'legacy table data detected' });
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValue({ templateObj: candidate, templateStr: JSON.stringify(candidate) } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockResolvedValue(null);
    vi.mocked(reconcileChatTemplate_ACU).mockResolvedValue({ candidateData: candidate, sheetChanges: [], deletedSheetKeys: [], blockers: [], audit: [] } as any);
    vi.mocked(commitCurrentFloorTemplateScopeOnly_ACU).mockResolvedValue({ saved: false, error: '检测到 legacy 持久化数据，必须先完成迁移' } as any);
    const received = vi.fn();
    const unsubscribe = subscribeTemplateRuntimeChanges_ACU(received);

    let result: any;
    try {
      result = await applyChatTemplateSnapshotWithReconciliation_ACU(candidate);
    } finally {
      unsubscribe();
    }

    expect(reconcileChatTemplate_ACU).toHaveBeenCalledWith(expect.objectContaining({ templateData: candidate }));
    expect(commitCurrentFloorTemplateScopeOnly_ACU).toHaveBeenCalledWith(expect.objectContaining({ templateSource: candidate }));
    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('legacy') });
    expect(received).not.toHaveBeenCalled();
  });

  it('将 replay 基线与协调结果送入唯一的 V2 原子提交入口', async () => {
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValue({ templateObj: candidate, templateStr: JSON.stringify(candidate) } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockResolvedValue({ mate: { type: 'chatSheets', version: 1 }, sheet_live: candidate.sheet_live } as any);
    vi.mocked(reconcileChatTemplate_ACU).mockResolvedValue({ candidateData: candidate, sheetChanges: [{ kind: 'operations', sheetKey: 'sheet_live', targetSheetData: candidate.sheet_live, operations: [{ kind: 'meta_update', sheetKey: 'sheet_live', meta: { name: '背包' } }] }], deletedSheetKeys: [], blockers: [], audit: [] } as any);
    vi.mocked(commitCurrentFloorTemplateChanges_ACU).mockResolvedValue({ saved: true, mode: 'v2_commit' } as any);
    const received = vi.fn();
    const unsubscribe = subscribeTemplateRuntimeChanges_ACU(received);

    let result: any;
    try {
      result = await applyChatTemplateSnapshotWithReconciliation_ACU(candidate, { source: 'test', presetName: '预设A' });
    } finally {
      unsubscribe();
    }

    expect(reconcileChatTemplate_ACU).toHaveBeenCalledWith(expect.objectContaining({
      baselineData: expect.objectContaining({ sheet_live: candidate.sheet_live }), templateData: candidate, destructiveChangeConfirmed: false, storageMode: 'sqlite',
    }));
    expect(commitCurrentFloorTemplateChanges_ACU).toHaveBeenCalledWith(expect.objectContaining({
      isolationKey: '', baseRevision: 'runtime-v1:test', sheetChanges: expect.any(Array), deletedSheetKeys: [], templateSource: candidate, storageMode: 'sqlite',
    }));
    expect(result).toMatchObject({ saved: true });
    expect(received).toHaveBeenCalledOnce();
  });

  it('同一聊天已有模板协调进行中时拒绝第二个请求，避免产生并发结构计划', async () => {
    let resolveBaseline!: (value: any) => void;
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValue({ templateObj: candidate, templateStr: JSON.stringify(candidate) } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockImplementationOnce(() => new Promise(resolve => {
      resolveBaseline = resolve;
    }) as any);
    vi.mocked(reconcileChatTemplate_ACU).mockResolvedValue({
      candidateData: candidate, sheetChanges: [], deletedSheetKeys: [], blockers: [], audit: [],
    } as any);
    vi.mocked(commitCurrentFloorTemplateScopeOnly_ACU).mockResolvedValue({ saved: true, mode: 'scope_only' } as any);

    const first = applyChatTemplateSnapshotWithReconciliation_ACU(candidate);
    const second = await applyChatTemplateSnapshotWithReconciliation_ACU(candidate);

    expect(second).toMatchObject({ saved: false, error: expect.stringContaining('正在进行中') });
    expect(loadTableStateFromFramesV2_ACU).toHaveBeenCalledOnce();

    resolveBaseline({ mate: { type: 'chatSheets', version: 1 }, sheet_live: candidate.sheet_live });
    await expect(first).resolves.toMatchObject({ saved: true });
  });

  it('结构性切换将生成 baseline 的同一 revision 传给提交，不能在协调后另取新 revision', async () => {
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValue({ templateObj: candidate, templateStr: JSON.stringify(candidate) } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockResolvedValue({ mate: { type: 'chatSheets', version: 1 } } as any);
    vi.mocked(captureTableRuntimeRevisionForWriteSet_ACU).mockReturnValue('runtime-v1:baseline');
    vi.mocked(reconcileChatTemplate_ACU).mockImplementation(async () => {
      vi.mocked(captureTableRuntimeRevisionForWriteSet_ACU).mockReturnValue('runtime-v1:changed-after-plan');
      return {
        candidateData: candidate,
        sheetChanges: [{ kind: 'introduction', sheetKey: 'sheet_live', sheetData: candidate.sheet_live }],
        deletedSheetKeys: [], blockers: [], audit: [],
      } as any;
    });
    vi.mocked(commitCurrentFloorTemplateChanges_ACU).mockResolvedValue({ saved: true, mode: 'v2_commit' } as any);

    await applyChatTemplateSnapshotWithReconciliation_ACU(candidate);

    expect(commitCurrentFloorTemplateChanges_ACU).toHaveBeenCalledWith(expect.objectContaining({
      baseRevision: 'runtime-v1:baseline',
    }));
  });

  it('读取 baseline 期间 revision 改变时丢弃旧快照并用一致快照协调', async () => {
    const staleBaseline = { mate: { type: 'chatSheets', version: 1 } };
    const currentBaseline = { mate: { type: 'chatSheets', version: 1 }, sheet_live: candidate.sheet_live };
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValue({ templateObj: candidate, templateStr: JSON.stringify(candidate) } as any);
    vi.mocked(captureTableRuntimeRevisionForWriteSet_ACU)
      .mockReturnValueOnce('runtime-v1:before-stale')
      .mockReturnValueOnce('runtime-v1:after-stale')
      .mockReturnValueOnce('runtime-v1:current')
      .mockReturnValueOnce('runtime-v1:current');
    vi.mocked(loadTableStateFromFramesV2_ACU)
      .mockResolvedValueOnce(staleBaseline as any)
      .mockResolvedValueOnce(currentBaseline as any);
    vi.mocked(reconcileChatTemplate_ACU).mockResolvedValue({
      candidateData: candidate,
      sheetChanges: [{ kind: 'rebase', sheetKey: 'sheet_live', sheetData: candidate.sheet_live }],
      deletedSheetKeys: [], blockers: [], audit: [],
    } as any);
    vi.mocked(commitCurrentFloorTemplateChanges_ACU).mockResolvedValue({ saved: true, mode: 'v2_commit' } as any);

    await applyChatTemplateSnapshotWithReconciliation_ACU(candidate);

    expect(loadTableStateFromFramesV2_ACU).toHaveBeenCalledTimes(2);
    expect(reconcileChatTemplate_ACU).toHaveBeenCalledWith(expect.objectContaining({ baselineData: currentBaseline }));
    expect(commitCurrentFloorTemplateChanges_ACU).toHaveBeenCalledWith(expect.objectContaining({ baseRevision: 'runtime-v1:current' }));
  });

  it('V2 provisional Sheet 补锚交给模板提交在同一候选中收敛', async () => {
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValue({ templateObj: candidate, templateStr: JSON.stringify(candidate) } as any);
    vi.mocked(loadTableStateFromFramesV2Detailed_ACU).mockResolvedValueOnce({
      baseKind: 'full_checkpoint',
      data: candidate,
      requiresCheckpointConvergence: true,
      compatibilityRepairs: [{
        kind: 'temporary_sheet_anchor',
        severity: 'provisional',
        sheetKey: 'sheet_live',
        messageIndex: 384,
        seq: 1,
        operationIndex: 0,
        templateFingerprint: 'test-fingerprint',
        reason: 'missing_at_operation',
      }],
    } as any);
    vi.mocked(reconcileChatTemplate_ACU).mockResolvedValue({
      candidateData: candidate,
      sheetChanges: [{ kind: 'operations', sheetKey: 'sheet_live', targetSheetData: candidate.sheet_live, operations: [{ kind: 'meta_update', sheetKey: 'sheet_live', meta: { name: '背包' } }] }],
      deletedSheetKeys: [], blockers: [], audit: [],
    } as any);
    vi.mocked(commitCurrentFloorTemplateChanges_ACU).mockResolvedValue({ saved: true, mode: 'v2_commit' } as any);

    const result = await applyChatTemplateSnapshotWithReconciliation_ACU(candidate);

    expect(result).toMatchObject({ saved: true });
    expect(reconcileChatTemplate_ACU).toHaveBeenCalledWith(expect.objectContaining({ baselineData: candidate }));
    expect(commitCurrentFloorTemplateChanges_ACU).toHaveBeenCalledWith(expect.objectContaining({
      sheetChanges: expect.arrayContaining([expect.objectContaining({ kind: 'operations', sheetKey: 'sheet_live' })]),
    }));
    expect(commitCurrentFloorTemplateScopeOnly_ACU).not.toHaveBeenCalled();
  });

  it('已有 V2 聊天的 replay baseline 不可用时 fail-closed，不得使用运行时缓存生成结构计划', async () => {
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValue({ templateObj: candidate, templateStr: JSON.stringify(candidate) } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockResolvedValue(null);

    const result = await applyChatTemplateSnapshotWithReconciliation_ACU(candidate);

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('V2 replay 基线不可用') });
    expect(reconcileChatTemplate_ACU).not.toHaveBeenCalled();
    expect(commitCurrentFloorTemplateChanges_ACU).not.toHaveBeenCalled();
  });

  it('协调器阻断时零提交', async () => {
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValue({ templateObj: candidate, templateStr: JSON.stringify(candidate) } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockResolvedValue({ mate: { type: 'chatSheets', version: 1 } } as any);
    vi.mocked(reconcileChatTemplate_ACU).mockResolvedValue({ candidateData: {}, sheetChanges: [], deletedSheetKeys: [], blockers: ['删除表需要确认'], audit: [] } as any);

    const result = await applyChatTemplateSnapshotWithReconciliation_ACU(candidate);

    expect(result).toMatchObject({ saved: false, blockers: ['删除表需要确认'] });
    expect(commitCurrentFloorTemplateChanges_ACU).not.toHaveBeenCalled();
  });

  it('SQLite 模式提交成功后按 checkpoint 重建 runtime 快照', async () => {
    // checkpoint 已落盘但 runtime 仍是旧快照时，新引入表自带数据会在编辑器里显示 0 行。
    vi.mocked(isSqliteMode).mockReturnValue(true);
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValue({ templateObj: candidate, templateStr: JSON.stringify(candidate) } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockResolvedValue({ mate: { type: 'chatSheets', version: 1 } } as any);
    vi.mocked(reconcileChatTemplate_ACU).mockResolvedValue({ candidateData: candidate, sheetChanges: [{ kind: 'introduction', sheetKey: 'sheet_live', sheetData: candidate.sheet_live }], deletedSheetKeys: [], blockers: [], audit: [] } as any);
    vi.mocked(commitCurrentFloorTemplateChanges_ACU).mockResolvedValue({ saved: true, mode: 'v2_commit' } as any);

    const result = await applyChatTemplateSnapshotWithReconciliation_ACU(candidate);

    expect(result).toMatchObject({ saved: true });
    expect(reloadStorageProvider).toHaveBeenCalled();
  });

  it('原生模式将 native 契约传给协调与提交，且不触发 SQLite runtime 重建', async () => {
    vi.mocked(isSqliteMode).mockReturnValue(false);
    vi.mocked(getCurrentStorageMode).mockReturnValue('native');
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValue({ templateObj: candidate, templateStr: JSON.stringify(candidate) } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockResolvedValue({ mate: { type: 'chatSheets', version: 1 } } as any);
    vi.mocked(reconcileChatTemplate_ACU).mockResolvedValue({ candidateData: candidate, sheetChanges: [{ kind: 'introduction', sheetKey: 'sheet_live', sheetData: candidate.sheet_live }], deletedSheetKeys: [], blockers: [], audit: [] } as any);
    vi.mocked(commitCurrentFloorTemplateChanges_ACU).mockResolvedValue({ saved: true, mode: 'v2_commit' } as any);

    await applyChatTemplateSnapshotWithReconciliation_ACU(candidate);

    expect(reconcileChatTemplate_ACU).toHaveBeenCalledWith(expect.objectContaining({ storageMode: 'native' }));
    expect(commitCurrentFloorTemplateChanges_ACU).toHaveBeenCalledWith(expect.objectContaining({ storageMode: 'native' }));
    expect(reloadStorageProvider).not.toHaveBeenCalled();
  });

  it('runtime 重建失败保留已保存事实并返回后置告警', async () => {
    vi.mocked(isSqliteMode).mockReturnValue(true);
    vi.mocked(reloadStorageProvider).mockRejectedValueOnce(new Error('reload boom'));
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValue({ templateObj: candidate, templateStr: JSON.stringify(candidate) } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockResolvedValue({ mate: { type: 'chatSheets', version: 1 } } as any);
    vi.mocked(reconcileChatTemplate_ACU).mockResolvedValue({ candidateData: candidate, sheetChanges: [{ kind: 'introduction', sheetKey: 'sheet_live', sheetData: candidate.sheet_live }], deletedSheetKeys: [], blockers: [], audit: [] } as any);
    vi.mocked(commitCurrentFloorTemplateChanges_ACU).mockResolvedValue({ saved: true, mode: 'v2_commit' } as any);

    const result = await applyChatTemplateSnapshotWithReconciliation_ACU(candidate);

    expect(result).toMatchObject({ saved: true, runtimeReady: false, postCommitWarning: expect.stringContaining('reload boom') });
  });

  it('runtime 重载静默回退到 native 时返回后置告警', async () => {
    vi.mocked(isSqliteMode).mockReturnValue(true);
    vi.mocked(didSqliteFallbackAfterReload_ACU).mockReturnValueOnce(true);
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValue({ templateObj: candidate, templateStr: JSON.stringify(candidate) } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockResolvedValue({ mate: { type: 'chatSheets', version: 1 } } as any);
    vi.mocked(reconcileChatTemplate_ACU).mockResolvedValue({ candidateData: candidate, sheetChanges: [{ kind: 'introduction', sheetKey: 'sheet_live', sheetData: candidate.sheet_live }], deletedSheetKeys: [], blockers: [], audit: [] } as any);
    vi.mocked(commitCurrentFloorTemplateChanges_ACU).mockResolvedValue({ saved: true, mode: 'v2_commit' } as any);

    const result = await applyChatTemplateSnapshotWithReconciliation_ACU(candidate);

    expect(result).toMatchObject({ saved: true, runtimeReady: false, postCommitWarning: expect.stringContaining('回退到原生模式') });
  });

  it('入口没有可绑定聊天时立即拒绝，不等待随后出现的任意聊天', async () => {
    mockChat.splice(0, mockChat.length);
    vi.mocked(getActiveChatStorageIdentity_ACU).mockReturnValue('');
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValue({ templateObj: candidate, templateStr: JSON.stringify(candidate) } as any);

    const result = await applyChatTemplateSnapshotWithReconciliation_ACU(candidate);

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('没有可绑定的目标聊天') });
    expect(loadTableStateFromFramesV2_ACU).not.toHaveBeenCalled();
    expect(commitCurrentFloorTemplateChanges_ACU).not.toHaveBeenCalled();
    expect(commitCurrentFloorTemplateScopeOnly_ACU).not.toHaveBeenCalled();
  });

  it('提交后的运行时数据刷新失败时保留保存事实并返回告警', async () => {
    vi.mocked(isSqliteMode).mockReturnValue(false);
    vi.mocked(refreshMergedDataAndNotify_ACU).mockRejectedValueOnce(new Error('refresh boom'));
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValue({ templateObj: candidate, templateStr: JSON.stringify(candidate) } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockResolvedValue({ mate: { type: 'chatSheets', version: 1 } } as any);
    vi.mocked(reconcileChatTemplate_ACU).mockResolvedValue({ candidateData: candidate, sheetChanges: [{ kind: 'introduction', sheetKey: 'sheet_live', sheetData: candidate.sheet_live }], deletedSheetKeys: [], blockers: [], audit: [] } as any);
    vi.mocked(commitCurrentFloorTemplateChanges_ACU).mockResolvedValue({ saved: true, mode: 'v2_commit' } as any);

    const result = await applyChatTemplateSnapshotWithReconciliation_ACU(candidate);

    expect(result).toMatchObject({ saved: true, runtimeReady: false, postCommitWarning: expect.stringContaining('refresh boom') });
  });

  it('等待期间目标聊天切换时立即拒绝且不提交', async () => {
    vi.useFakeTimers();
    vi.mocked(getActiveChatStorageIdentity_ACU).mockReturnValue('');
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValue({ templateObj: candidate, templateStr: JSON.stringify(candidate) } as any);

    const pending = applyChatTemplateSnapshotWithReconciliation_ACU(candidate);
    mockChat.splice(0, mockChat.length, { is_user: false, switched: true });
    await vi.advanceTimersByTimeAsync(100);
    const result = await pending;
    vi.useRealTimers();

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('目标聊天已切换') });
    expect(loadTableStateFromFramesV2_ACU).not.toHaveBeenCalled();
    expect(commitCurrentFloorTemplateChanges_ACU).not.toHaveBeenCalled();
  });

  it('等待完成后使用 gateway 的最新 chat 数组判定存储策略，避免陈旧引用', async () => {
    vi.useFakeTimers();
    const firstMessage = mockChat[0];
    const readyChat = [firstMessage, { is_user: false, newArray: true }];
    vi.mocked(getActiveChatStorageIdentity_ACU)
      .mockReturnValueOnce('')
      .mockReturnValueOnce('')
      .mockReturnValue('chat-a');
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValue({ templateObj: candidate, templateStr: JSON.stringify(candidate) } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockResolvedValue(candidate as any);
    vi.mocked(reconcileChatTemplate_ACU).mockResolvedValue({ candidateData: candidate, sheetChanges: [], deletedSheetKeys: [], blockers: ['stop'], audit: [] } as any);

    const pending = applyChatTemplateSnapshotWithReconciliation_ACU(candidate);
    mockChatState.current = readyChat;
    await vi.advanceTimersByTimeAsync(100);
    const result = await pending;
    vi.useRealTimers();

    expect(resolveTableStorageStrategy_ACU).toHaveBeenCalledWith(readyChat, '', expect.any(Object));
    expect(result).toMatchObject({ saved: false, blockers: ['stop'] });
  });


  it('组件取消等待时立即拒绝且不提交', async () => {
    vi.mocked(getActiveChatStorageIdentity_ACU).mockReturnValue('');
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValue({ templateObj: candidate, templateStr: JSON.stringify(candidate) } as any);
    const controller = new AbortController();

    const pending = applyChatTemplateSnapshotWithReconciliation_ACU(candidate, { signal: controller.signal });
    controller.abort();
    const result = await pending;

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('已取消') });
    expect(loadTableStateFromFramesV2_ACU).not.toHaveBeenCalled();
    expect(commitCurrentFloorTemplateChanges_ACU).not.toHaveBeenCalled();
  });

  it('聊天存储上下文未就绪时在提交前拒绝', async () => {
    vi.useFakeTimers();
    vi.mocked(getActiveChatStorageIdentity_ACU).mockReturnValue('');
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValue({ templateObj: candidate, templateStr: JSON.stringify(candidate) } as any);
    const pending = applyChatTemplateSnapshotWithReconciliation_ACU(candidate);
    await vi.advanceTimersByTimeAsync(3200);
    const result = await pending;
    vi.useRealTimers();

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('聊天元数据尚未就绪') });
    expect(loadTableStateFromFramesV2_ACU).not.toHaveBeenCalled();
    expect(commitCurrentFloorTemplateChanges_ACU).not.toHaveBeenCalled();
  });
});

// ═══ followGlobalTemplateForCurrentChat_ACU（S1-2 跟随全局） ═══
describe('followGlobalTemplateForCurrentChat_ACU', () => {
  const globalTemplate = { mate: { type: 'chatSheets', version: 1 }, sheet_live: { uid: 'sheet_live', name: '背包', content: [['row_id', '名称']], sourceData: {}, updateConfig: {}, exportConfig: {} } };
  const overrideState = { mode: 'chat_override', presetName: '聊天预设', templateStr: '{"sheet_x":{}}' };

  function mockSuccessfulReconciliation() {
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValue({ templateObj: globalTemplate, templateStr: JSON.stringify(globalTemplate) } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockResolvedValue({ mate: globalTemplate.mate, sheet_live: globalTemplate.sheet_live } as any);
    vi.mocked(reconcileChatTemplate_ACU).mockResolvedValue({ candidateData: globalTemplate, sheetChanges: [{ kind: 'operations', sheetKey: 'sheet_live', targetSheetData: globalTemplate.sheet_live, operations: [] }], deletedSheetKeys: [], blockers: [], audit: [] } as any);
    vi.mocked(commitCurrentFloorTemplateChanges_ACU).mockResolvedValue({ saved: true, mode: 'v2_commit' } as any);
  }

  it('无聊天覆盖时短路 alreadyFollowing，不走协调也不翻 scope', async () => {
    vi.mocked(getCurrentChatTemplateScopeState_ACU).mockReturnValue(null);
    vi.mocked(getCurrentTemplatePresetName_ACU).mockReturnValue('全局A');

    const result = await followGlobalTemplateForCurrentChat_ACU();

    expect(result).toMatchObject({ saved: true, alreadyFollowing: true, mode: 'inherit_global', presetName: '全局A' });
    expect(reconcileChatTemplate_ACU).not.toHaveBeenCalled();
    expect(setCurrentChatTemplateScopeState_ACU).not.toHaveBeenCalled();
  });

  it('全局快照缺失时拒绝且不协调', async () => {
    vi.mocked(getCurrentChatTemplateScopeState_ACU).mockReturnValue(overrideState as any);
    vi.mocked(getGlobalTemplateSnapshotForCurrentProfile_ACU).mockReturnValue(null as any);

    const result = await followGlobalTemplateForCurrentChat_ACU();

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('无法解析当前全局模板') });
    expect(reconcileChatTemplate_ACU).not.toHaveBeenCalled();
    expect(setCurrentChatTemplateScopeState_ACU).not.toHaveBeenCalled();
  });

  it('协调提交成功后把 scope 翻成 inherit_global、保存聊天并广播', async () => {
    vi.mocked(getCurrentChatTemplateScopeState_ACU).mockReturnValue(overrideState as any);
    vi.mocked(getGlobalTemplateSnapshotForCurrentProfile_ACU).mockReturnValue({ templateObj: globalTemplate, templateStr: JSON.stringify(globalTemplate) } as any);
    vi.mocked(getCurrentTemplatePresetName_ACU).mockReturnValue('全局A');
    mockSuccessfulReconciliation();
    const received = vi.fn();
    const unsubscribe = subscribeTemplateRuntimeChanges_ACU(received);

    let result: any;
    try {
      result = await followGlobalTemplateForCurrentChat_ACU({ source: 'test_follow' });
    } finally {
      unsubscribe();
    }

    expect(result).toMatchObject({ saved: true, mode: 'inherit_global', presetName: '全局A' });
    expect(setCurrentChatTemplateScopeState_ACU).toHaveBeenCalledWith(
      { mode: 'inherit_global' },
      expect.objectContaining({ reason: 'template_scope_follow_global' }),
    );
    // 不得走 persistTemplateScopeSelectionState 的 inherit_global 分支清掉协调刚写的指导表。
    expect(clearChatSheetGuideDataForIsolationKey_ACU).not.toHaveBeenCalled();
    expect(saveChatToHost_ACU).toHaveBeenCalled();
    expect(received).toHaveBeenCalled();
  });

  it('协调返回 blockers 时不翻 scope、透传结果', async () => {
    vi.mocked(getCurrentChatTemplateScopeState_ACU).mockReturnValue(overrideState as any);
    vi.mocked(getGlobalTemplateSnapshotForCurrentProfile_ACU).mockReturnValue({ templateObj: globalTemplate, templateStr: JSON.stringify(globalTemplate) } as any);
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValue({ templateObj: globalTemplate, templateStr: JSON.stringify(globalTemplate) } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockResolvedValue({ mate: globalTemplate.mate, sheet_live: globalTemplate.sheet_live } as any);
    vi.mocked(reconcileChatTemplate_ACU).mockResolvedValue({ candidateData: globalTemplate, sheetChanges: [], deletedSheetKeys: [], blockers: ['删除表「任务」需要显式确认'], audit: [] } as any);

    const result = await followGlobalTemplateForCurrentChat_ACU();

    expect(result).toMatchObject({ saved: false, blockers: ['删除表「任务」需要显式确认'] });
    expect(setCurrentChatTemplateScopeState_ACU).not.toHaveBeenCalled();
    expect(saveChatToHost_ACU).not.toHaveBeenCalled();
  });
});

// ═══ resolveTemplateForExport_ACU ═══
describe('resolveTemplateForExport_ACU', () => {
  it('global scope 有选中预设时从预设加载', () => {
    upsertTemplatePreset_ACU('导出预设', '{"sheet_0":{"name":"导出表"}}');
    const result = resolveTemplateForExport_ACU('global', '导出预设');
    expect(result).not.toBeNull();
    expect(result!.fromPresetName).toBe('导出预设');
  });
  it('global scope 无预设时回退到全局快照', () => {
    vi.mocked(getGlobalTemplateSnapshotForCurrentProfile_ACU).mockReturnValueOnce({
      templateObj: { sheet_0: { name: '全局表' } },
      templateStr: '{}',
    } as any);
    const result = resolveTemplateForExport_ACU('global');
    expect(result).not.toBeNull();
    expect(result!.jsonData).toHaveProperty('sheet_0');
  });
  it('chat scope 返回聊天级模板', () => {
    vi.mocked(getCurrentChatTemplateScopeState_ACU).mockReturnValueOnce({
      mode: 'chat_override',
      templateStr: '{"sheet_0":{"name":"聊天表"}}',
      presetName: '聊天预设',
    } as any);
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValueOnce({
      templateObj: { sheet_0: { name: '聊天表' } },
      templateStr: '{}',
    } as any);
    const result = resolveTemplateForExport_ACU('chat');
    expect(result).not.toBeNull();
  });
  it('所有来源都无数据时返回 null', () => {
    vi.mocked(getGlobalTemplateSnapshotForCurrentProfile_ACU).mockReturnValueOnce(null);
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValueOnce(null);
    vi.mocked(getGlobalTemplateSnapshotForCurrentProfile_ACU).mockReturnValueOnce(null);
    const result = resolveTemplateForExport_ACU('global');
    expect(result).toBeNull();
  });
});

// ═══ getRuntimeTemplateSnapshot_ACU ═══
describe('getRuntimeTemplateSnapshot_ACU', () => {
  beforeEach(() => {
    // 既有用例（"所有来源都无数据时返回 null"）曾用 mockReturnValueOnce 留下未消费
    // 的 once 队列；vi.clearAllMocks 不清 once 队列，会污染后续用例。这里显式 reset
    // 并恢复默认实现，保证本块用例隔离。
    vi.mocked(parseTableTemplateJson_ACU).mockReset().mockReturnValue({ sheet_0: { name: '测试表' } });
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReset().mockImplementation((obj: any) => obj
      ? { templateStr: JSON.stringify(obj), templateObj: obj }
      : null);
    // 恢复 ensure 的真实行为（写 orderNo），供 orderNo 断言使用
    vi.mocked(ensureSheetOrderNumbers_ACU).mockReset().mockImplementation((obj: any, opts: any) => {
      const keys = (opts?.baseOrderKeys || Object.keys(obj).filter((k: string) => k.startsWith('sheet_'))).sort();
      keys.forEach((key: string, index: number) => { if (obj[key] && typeof obj[key] === 'object') obj[key].orderNo = index + 1; });
      return obj;
    });
  });
  it('运行时模板可解析时返回 sanitized 快照', () => {
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValueOnce({ sheet_0: { name: '运行时表' } } as any);
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValueOnce({
      templateStr: '{"sheet_0":{"name":"运行时表"}}',
      templateObj: { sheet_0: { name: '运行时表' } },
    } as any);
    const result = getRuntimeTemplateSnapshot_ACU();
    expect(result).not.toBeNull();
    expect(result!.templateStr).toBe('{"sheet_0":{"name":"运行时表"}}');
    expect(sanitizeTemplateSnapshotForChat_ACU).toHaveBeenCalled();
  });

  it('解析失败返回 null，不回落默认模板', () => {
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValueOnce(null as any);
    expect(getRuntimeTemplateSnapshot_ACU()).toBeNull();
  });

  it('sanitize 失败返回 null，不回落默认模板', () => {
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValueOnce({ sheet_0: { name: '运行时表' } } as any);
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValueOnce(null as any);
    expect(getRuntimeTemplateSnapshot_ACU()).toBeNull();
  });
});

// ═══ resolveTemplateForExport_ACU runtime scope ═══
describe('resolveTemplateForExport_ACU · runtime scope', () => {
  beforeEach(() => {
    vi.mocked(parseTableTemplateJson_ACU).mockReset().mockReturnValue({ sheet_0: { name: '测试表' } });
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReset().mockImplementation((obj: any) => obj
      ? { templateStr: JSON.stringify(obj), templateObj: obj }
      : null);
    vi.mocked(ensureSheetOrderNumbers_ACU).mockReset().mockImplementation((obj: any, opts: any) => {
      const keys = (opts?.baseOrderKeys || Object.keys(obj).filter((k: string) => k.startsWith('sheet_'))).sort();
      keys.forEach((key: string, index: number) => { if (obj[key] && typeof obj[key] === 'object') obj[key].orderNo = index + 1; });
      return obj;
    });
    vi.mocked(getGlobalTemplateSnapshotForCurrentProfile_ACU).mockReset().mockReturnValue(null);
  });
  it('runtime scope 返回运行时内容，且 sheet 有 orderNo 与 exportConfig', () => {
    const runtimeObj = {
      sheet_0: { name: '运行时表', exportConfig: { enabled: true } },
    };
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValueOnce(runtimeObj as any);
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValueOnce({
      templateStr: JSON.stringify(runtimeObj),
      templateObj: runtimeObj,
    } as any);
    const result = resolveTemplateForExport_ACU('runtime');
    expect(result).not.toBeNull();
    expect(result!.jsonData.sheet_0).toBeDefined();
    expect(result!.jsonData.sheet_0).toHaveProperty('orderNo');
    expect(result!.jsonData.sheet_0).toHaveProperty('exportConfig');
  });

  it('运行时模板 ≠ 预设库同名预设时，runtime 返回运行时内容、global 返回库内容，二者不相等', () => {
    // 预设库同名预设（旧内容）
    upsertTemplatePreset_ACU('同名预设', '{"sheet_0":{"name":"库内容"}}');
    // 运行时内容（新内容）
    const runtimeObj = { sheet_0: { name: '运行时新内容' } };
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValueOnce(runtimeObj as any);
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockImplementationOnce((value: any) => ({
      templateStr: JSON.stringify(value),
      templateObj: value,
    } as any));
    const runtimeResult = resolveTemplateForExport_ACU('runtime');
    const globalResult = resolveTemplateForExport_ACU('global', '同名预设');
    expect(runtimeResult).not.toBeNull();
    expect(globalResult).not.toBeNull();
    expect(JSON.stringify(runtimeResult!.jsonData)).not.toBe(JSON.stringify(globalResult!.jsonData));
  });

  it('运行时解析失败返回 null', () => {
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValueOnce(null as any);
    expect(resolveTemplateForExport_ACU('runtime')).toBeNull();
  });

  it('global 传不存在的预设名且不传 options 时仍返回 null（回归断言）', () => {
    expect(resolveTemplateForExport_ACU('global', '不存在的预设')).toBeNull();
  });

  it('global 传不存在的预设名但 allowRuntimeFallback=true 时回落到全局快照', () => {
    vi.mocked(getGlobalTemplateSnapshotForCurrentProfile_ACU).mockReturnValueOnce({
      templateObj: { sheet_0: { name: '全局快照' } },
      templateStr: '{}',
    } as any);
    const result = resolveTemplateForExport_ACU('global', '不存在的预设', { allowRuntimeFallback: true });
    expect(result).not.toBeNull();
    expect(result!.jsonData.sheet_0.name).toBe('全局快照');
  });
});

