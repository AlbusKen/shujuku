/**
 * tests/service/template/chat-scope-guide.test.ts
 * SheetGuide 数据操作 单元测试（D 组）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockSettings,
  mockGetCurrentIsolationKey,
  mockCurrentJsonTableData,
  mockGetChatArray,
  mockSaveChatToHost,
  mockGetChatScopedConfigContainer,
  mockPeekChatScopedConfigContainer,
  mockNormalizeChatScopedConfigContainer,
  mockGetChatSheetGuideContainer,
  mockPeekChatSheetGuideContainer,
  mockGetChatFirstLayerMessage,
  mockParseTableTemplateJson,
  mockEnsureSheetOrderNumbers,
  mockCloneScopedConfigData,
  mockEnsureExportConfigDefaults,
  mockEnsureGlobalInjectionConfigDefaults,
  mockSaveCurrentProfileTemplate,
  mockSetTableTemplate,
  // chat-scope-template mocks
  mockNormalizeTemplateScopeMode,
  mockNormalizeTemplateScopeIsolationKey,
  mockSanitizeTemplateSnapshotForChat,
  mockGetCurrentChatTemplateScopeState,
  mockSetCurrentChatTemplateScopeState,
  mockBuildChatTemplateScopeStateFromCurrent,
  mockGetGlobalTemplateSnapshotForCurrentProfile,
  mockUpsertChatTemplatePresetEntry,
    mockNormalizeChatTemplateScopeState,
    mockSetChatScopedConfigContainer,
    mockSetChatSheetGuideContainer,
    // chat-scope-sheet mocks
    mockGetSortedSheetKeys,
} = vi.hoisted(() => ({
  mockSettings: { dataIsolationEnabled: false, dataIsolationCode: '' } as any,
  mockGetCurrentIsolationKey: vi.fn(() => ''),
  mockCurrentJsonTableData: {} as any,
  mockGetChatArray: vi.fn(() => []),
  mockSaveChatToHost: vi.fn().mockResolvedValue(undefined),
  mockGetChatScopedConfigContainer: vi.fn(() => null),
  mockPeekChatScopedConfigContainer: vi.fn(() => null),
  mockNormalizeChatScopedConfigContainer: vi.fn((c: any) => c || { version: 1 }),
  mockGetChatSheetGuideContainer: vi.fn(() => ({})),
  mockPeekChatSheetGuideContainer: vi.fn(() => ({})),
  mockGetChatFirstLayerMessage: vi.fn(() => null),
  mockParseTableTemplateJson: vi.fn(() => ({})),
  mockEnsureSheetOrderNumbers: vi.fn(() => false),
  mockCloneScopedConfigData: vi.fn((data: any) => data ? JSON.parse(JSON.stringify(data)) : null),
  mockEnsureExportConfigDefaults: vi.fn((cfg: any, name: string) => cfg || { enabled: true, name }),
  mockEnsureGlobalInjectionConfigDefaults: vi.fn((cfg: any) => cfg || { enabled: false }),
  mockSaveCurrentProfileTemplate: vi.fn(),
  mockSetTableTemplate: vi.fn(),
  mockNormalizeTemplateScopeMode: vi.fn((m: any) => {
    if (m === 'chat_override') return 'chat_override';
    if (m === 'preset_link') return 'preset_link';
    return 'inherit_global';
  }),
  mockNormalizeTemplateScopeIsolationKey: vi.fn((k: any) => String(k ?? '')),
  mockSanitizeTemplateSnapshotForChat: vi.fn(() => null),
  mockGetCurrentChatTemplateScopeState: vi.fn(() => null),
  mockSetCurrentChatTemplateScopeState: vi.fn(() => null),
  mockBuildChatTemplateScopeStateFromCurrent: vi.fn(() => null),
  mockGetGlobalTemplateSnapshotForCurrentProfile: vi.fn(() => null),
  mockUpsertChatTemplatePresetEntry: vi.fn(() => null),
  mockSetChatScopedConfigContainer: vi.fn((chat: any[], container: any) => {
    const first = Array.isArray(chat) ? chat[0] : null;
    if (!first) return;
    if (container) first._acu_scoped_config = container;
    else delete first._acu_scoped_config;
  }),
  mockSetChatSheetGuideContainer: vi.fn((chat: any[], container: any) => {
    const first = Array.isArray(chat) ? chat[0] : null;
    if (!first) return;
    if (container) first._acu_sheet_guide = container;
    else delete first._acu_sheet_guide;
  }),
  mockNormalizeChatTemplateScopeState: vi.fn((raw: any) => ({
    mode: raw?.mode || 'inherit_global',
    isolationKey: String(raw?.isolationKey ?? ''),
    presetName: raw?.presetName || '',
    templateStr: raw?.templateStr || '',
    guideData: raw?.guideData || null,
    originGlobalName: raw?.originGlobalName || '',
    originGlobalRevision: raw?.originGlobalRevision || 0,
    updatedAt: raw?.updatedAt || 0,
    source: raw?.source || 'inherit',
  })),
  mockGetSortedSheetKeys: vi.fn((data: any) => {
    if (!data || typeof data !== 'object') return [];
    return Object.keys(data).filter((k: string) => k.startsWith('sheet_')).sort();
  }),
}));

// ═══ Mocks ═══

vi.mock('../../../src/shared/defaults-json.js', () => ({
  DEFAULT_TABLE_TEMPLATE_ACU: '{}',
  get TABLE_TEMPLATE_ACU() { return '{}'; },
  _set_TABLE_TEMPLATE_ACU: mockSetTableTemplate,
}));

vi.mock('../../../src/data/repositories/profile-repo', () => ({
  readProfileTemplateFromStorage_ACU: vi.fn(() => null),
  saveCurrentProfileTemplate_ACU: mockSaveCurrentProfileTemplate,
}));

vi.mock('../../../src/shared/template-preset-utils', () => ({
  DEFAULT_TEMPLATE_PRESET_OPTION_VALUE_ACU: '',
  deriveTemplatePresetNameForImport_ACU: vi.fn((opts: any) => opts?.presetName || ''),
  getCurrentTemplatePresetName_ACU: vi.fn(() => ''),
  normalizeTemplatePresetSelectionValue_ACU: vi.fn((v: any) => v || ''),
}));

vi.mock('../../../src/data/storage/chat-history', () => ({
  CHAT_SCOPED_CONFIG_FIELD_ACU: '_acu_scoped_config',
  CHAT_SHEET_GUIDE_FIELD_ACU: '_acu_sheet_guide',
  CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU: '_seedRows',
  CHAT_SHEET_GUIDE_VERSION_ACU: 2,
  CHAT_TEMPLATE_ARCHIVE_OPTION_PREFIX_ACU: 'archive_',
  LEGACY_CHAT_TABLE_HEADER_GUIDE_FIELD_ACU: '_acu_table_header_guide',
  MAX_CHAT_TEMPLATE_ARCHIVES_PER_TAG_ACU: 5,
  getChatScopedConfigContainer_ACU: mockGetChatScopedConfigContainer,
  peekChatScopedConfigContainer_ACU: mockPeekChatScopedConfigContainer,
  getChatSheetGuideContainer_ACU: mockGetChatSheetGuideContainer,
  peekChatSheetGuideContainer_ACU: mockPeekChatSheetGuideContainer,
  normalizeChatScopedConfigContainer_ACU: mockNormalizeChatScopedConfigContainer,
  setChatScopedConfigContainer_ACU: mockSetChatScopedConfigContainer,
  setChatSheetGuideContainer_ACU: mockSetChatSheetGuideContainer,
}));

vi.mock('../../../src/service/template/template-preset-service', () => ({
  getDefaultTemplateSnapshot_ACU: vi.fn(() => null),
  getTemplatePreset_ACU: vi.fn(() => null),
  getTemplatePresetDisplayName_ACU: vi.fn(() => ''),
  persistTemplateScopeSelectionState_ACU: vi.fn(),
  upsertTemplatePreset_ACU: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return mockCurrentJsonTableData; },
  getCurrentIsolationKey_ACU: mockGetCurrentIsolationKey,
  settings_ACU: mockSettings,
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: mockGetChatArray,
  saveChatToHost_ACU: mockSaveChatToHost,
}));

vi.mock('../../../src/shared/constants', () => ({
  TABLE_ORDER_FIELD_ACU: 'orderNo',
}));

vi.mock('../../../src/service/settings/settings-service', () => ({
  applyTemplateScopeForCurrentChat_ACU: vi.fn(),
}));

vi.mock('../../../src/service/worldbook/pipeline', () => ({
  refreshMergedDataAndNotify_ACU: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/shared/json-helpers', () => ({
  safeJsonParse_ACU: (json: string, fallback: any) => { try { return JSON.parse(json); } catch { return fallback; } },
  safeJsonStringify_ACU: (obj: any, fallback: string) => { try { return JSON.stringify(obj); } catch { return fallback; } },
}));

vi.mock('../../../src/shared/utils', () => ({
  applySheetOrderNumbers_ACU: vi.fn(),
  cloneScopedConfigData_ACU: mockCloneScopedConfigData,
  ensureSheetOrderNumbers_ACU: mockEnsureSheetOrderNumbers,
  formatPlotScopeUpdatedAt_ACU: vi.fn(() => ''),
  getChatFirstLayerMessage_ACU: mockGetChatFirstLayerMessage,
  hashUserInput_ACU: vi.fn((t: string) => `hash_${t}`),
  isSummaryOrOutlineTable_ACU: vi.fn((name: string) => name?.includes('纪要') || name?.includes('总结')),
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  parseTableTemplateJson_ACU: mockParseTableTemplateJson,
}));

vi.mock('../../../src/service/worldbook/injection-engine', () => ({
  ensureExportConfigDefaults_ACU: mockEnsureExportConfigDefaults,
  ensureGlobalInjectionConfigDefaults_ACU: mockEnsureGlobalInjectionConfigDefaults,
}));

vi.mock('../../../src/data/repositories/chat-message-data-repo', () => ({
  readIsolatedTagData_ACU: vi.fn(() => null),
  readLegacyIndependentData_ACU: vi.fn(() => null),
  readLegacyStandardData_ACU: vi.fn(() => null),
  readLegacySummaryData_ACU: vi.fn(() => null),
  isLegacyMatchForIsolation_ACU: vi.fn(() => false),
}));

// mock chat-scope-template（guide 的循环依赖）
vi.mock('../../../src/service/template/chat-scope/chat-scope-template', () => ({
  normalizeTemplateScopeMode_ACU: mockNormalizeTemplateScopeMode,
  normalizeTemplateScopeIsolationKey_ACU: mockNormalizeTemplateScopeIsolationKey,
  sanitizeTemplateSnapshotForChat_ACU: mockSanitizeTemplateSnapshotForChat,
  getCurrentChatTemplateScopeState_ACU: mockGetCurrentChatTemplateScopeState,
  setCurrentChatTemplateScopeState_ACU: mockSetCurrentChatTemplateScopeState,
  buildChatTemplateScopeStateFromCurrent_ACU: mockBuildChatTemplateScopeStateFromCurrent,
  getGlobalTemplateSnapshotForCurrentProfile_ACU: mockGetGlobalTemplateSnapshotForCurrentProfile,
  upsertChatTemplatePresetEntry_ACU: mockUpsertChatTemplatePresetEntry,
  normalizeChatTemplateScopeState_ACU: mockNormalizeChatTemplateScopeState,
}));

// mock chat-scope-sheet
vi.mock('../../../src/service/template/chat-scope/chat-scope-sheet', () => ({
  getSortedSheetKeys_ACU: mockGetSortedSheetKeys,
}));

import {
  materializeDataFromSheetGuide_ACU,
  clearChatSheetGuideDataForIsolationKey_ACU,
  getChatSheetGuideDataForIsolationKey_ACU,
  setChatSheetGuideDataForIsolationKey_ACU,
  getEffectiveSeedRowsForSheet_ACU,
  attachSeedRowsToCurrentDataFromGuide_ACU,
  buildChatSheetGuideDataFromData_ACU,
  buildChatSheetGuideDataFromTemplateObj_ACU,
  overwriteChatSheetGuideFromTemplate_ACU,
  ensureStableRowIdsForSeedRows_ACU,
  ensureStableRowIdsForSheetContent_ACU,
  ensureChatSheetGuideSeeded_ACU,
  migrateLegacyTemplateScopeForCurrentChat_ACU,
} from '../../../src/service/template/chat-scope/chat-scope-guide';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentIsolationKey.mockReturnValue('');
  mockGetChatArray.mockReturnValue([]);
  mockGetChatFirstLayerMessage.mockReturnValue(null);
  mockGetChatScopedConfigContainer.mockReturnValue(null);
  mockPeekChatScopedConfigContainer.mockReturnValue(null);
  mockGetChatSheetGuideContainer.mockReturnValue({});
  mockPeekChatSheetGuideContainer.mockReturnValue({});
  mockParseTableTemplateJson.mockReturnValue({});
  mockEnsureSheetOrderNumbers.mockReturnValue(false);
  mockGetCurrentChatTemplateScopeState.mockReturnValue(null);
  mockSetCurrentChatTemplateScopeState.mockReturnValue(null);
  mockBuildChatTemplateScopeStateFromCurrent.mockReturnValue(null);
  mockSanitizeTemplateSnapshotForChat.mockReturnValue(null);
  mockGetGlobalTemplateSnapshotForCurrentProfile.mockReturnValue(null);
  // 重置 mockCurrentJsonTableData 为空对象
  Object.keys(mockCurrentJsonTableData).forEach(k => delete mockCurrentJsonTableData[k]);
});

// ═══ materializeDataFromSheetGuide_ACU ═══
describe('materializeDataFromSheetGuide_ACU', () => {
  it('null guide 返回只有 mate 的对象', () => {
    const result = materializeDataFromSheetGuide_ACU(null);
    expect(result.mate).toBeDefined();
    expect(result.mate.type).toBe('chatSheets');
  });

  it('有效 guide 物化表头 + seedRows', () => {
    const guide = {
      mate: { type: 'chatSheets', version: 2 },
      sheet_0: {
        uid: 's0',
        name: '物品表',
        content: [['row_id', '物品名']],
        _seedRows: [['1', '铁剑'], ['2', '盾牌']],
        sourceData: {},
        updateConfig: {},
      },
    };
    const result = materializeDataFromSheetGuide_ACU(guide, { includeSeedRows: true });
    expect(result.sheet_0).toBeDefined();
    // content 应包含表头 + seedRows
    expect(result.sheet_0.content).toEqual([['row_id', '物品名'], ['1', '铁剑'], ['2', '盾牌']]);
  });

  it('includeSeedRows=true 时拒绝重复非空身份', () => {
    const guide = {
      sheet_0: {
        name: '表',
        content: [['row_id', '名称']],
        _seedRows: [['', '第一行'], ['1', '第二行'], ['1', '第三行']],
      },
    };

    expect(() => materializeDataFromSheetGuide_ACU(guide, { includeSeedRows: true }))
      .toThrow('重复 row_id');
  });

  it('includeSeedRows=false 时只包含表头', () => {
    const guide = {
      sheet_0: {
        name: '表',
        content: [['row_id', '名称']],
        _seedRows: [['1', '数据']],
      },
    };
    const result = materializeDataFromSheetGuide_ACU(guide, { includeSeedRows: false });
    expect(result.sheet_0.content).toEqual([['row_id', '名称']]);
  });
});

// ═══ clearChatSheetGuideDataForIsolationKey_ACU ═══
describe('clearChatSheetGuideDataForIsolationKey_ACU', () => {
  it('无首条消息返回 false', () => {
    mockGetChatFirstLayerMessage.mockReturnValue(null);
    expect(clearChatSheetGuideDataForIsolationKey_ACU()).toBe(false);
  });

  it('无容器返回 false', () => {
    mockGetChatFirstLayerMessage.mockReturnValue({});
    mockGetChatSheetGuideContainer.mockReturnValue(null);
    expect(clearChatSheetGuideDataForIsolationKey_ACU()).toBe(false);
  });

  it('有容器且有对应 tag 时删除并返回 true', () => {
    const firstMsg: any = {};
    mockGetChatFirstLayerMessage.mockReturnValue(firstMsg);
    mockGetChatArray.mockReturnValue([firstMsg]);
    mockCloneScopedConfigData.mockReturnValue({ version: 2, tags: { '': { data: {} } } });
    mockGetChatSheetGuideContainer.mockReturnValue({ version: 2, tags: { '': { data: {} } } });
    const result = clearChatSheetGuideDataForIsolationKey_ACU({ isolationKey: '' });
    expect(result).toBe(true);
  });
});

// ═══ getChatSheetGuideDataForIsolationKey_ACU ═══
describe('getChatSheetGuideDataForIsolationKey_ACU', () => {
  it('有 scoped state 的 guideData 时直接返回', () => {
    const guideData = {
      mate: { type: 'chatSheets', version: 2 },
      sheet_0: { name: '表', content: [['row_id']] },
    };
    mockGetCurrentChatTemplateScopeState.mockReturnValue({
      mode: 'chat_override',
      guideData,
    });
    const result = getChatSheetGuideDataForIsolationKey_ACU('');
    expect(result).toBeDefined();
    expect(result.sheet_0).toBeDefined();
  });

  it('读取历史 guide 时将“行号”首列表头和旧 _seedRows 无损规范为 row_id', () => {
    mockGetCurrentChatTemplateScopeState.mockReturnValue({
      mode: 'chat_override',
      guideData: {
        mate: { type: 'chatSheets', version: 1 },
        sheet_0: {
          name: '表', content: [['行号', '名称']],
          _seedRows: [['7', '铁剑']],
        },
      },
    });

    const result = getChatSheetGuideDataForIsolationKey_ACU('');

    expect(result?.sheet_0.content).toEqual([['row_id', '名称']]);
    expect(result?.sheet_0._seedRows).toEqual([['7', '铁剑']]);
  });

  it('无 scoped state 时回退到全局快照', () => {
    mockGetCurrentChatTemplateScopeState.mockReturnValue(null);
    // migrateLegacy 也返回 null
    mockGetGlobalTemplateSnapshotForCurrentProfile.mockReturnValue({
      templateStr: '{}',
      templateObj: { sheet_0: { name: '表', content: [['row_id']] } },
    });
    // buildChatSheetGuideDataFromTemplateObj_ACU 是真实函数，会被调用
    // 但由于 TABLE_TEMPLATE_ACU 是 '{}'，sanitizeTemplateSnapshotForChat 返回 null
    // 最终会走到 globalSnapshot 分支
    const result = getChatSheetGuideDataForIsolationKey_ACU('');
    // 验证函数不抛错
    expect(mockGetCurrentChatTemplateScopeState).toHaveBeenCalled();
  });

  it('scoped Guide 含超宽 seedRows 时返回按最终表头宽度收敛的克隆，且不保存聊天', () => {
    mockGetCurrentChatTemplateScopeState.mockReturnValue({
      mode: 'chat_override',
      guideData: {
        mate: { type: 'chatSheets', version: 2 },
        sheet_0: {
          name: '表',
          content: [['row_id', '名称']],
          _seedRows: [['7', '铁剑', '旧列']],
        },
      },
    });

    const result = getChatSheetGuideDataForIsolationKey_ACU('');

    expect(result?.sheet_0._seedRows).toEqual([['7', '铁剑']]);
    expect(mockSaveChatToHost).not.toHaveBeenCalled();
  });

  it('preset/global 模板构建出的 Guide 使用相同超宽收敛规则', () => {
    mockGetCurrentChatTemplateScopeState.mockReturnValue({
      mode: 'preset_link',
      presetName: 'preset-a',
    });
    mockSanitizeTemplateSnapshotForChat.mockReturnValue({
      templateObj: {
        sheet_0: { uid: 'sheet_0', name: '表', content: [['row_id', '名称']], _seedRows: [['1', '甲', '旧']] },
      },
    });

    const result = getChatSheetGuideDataForIsolationKey_ACU('');
    expect(result?.sheet_0._seedRows).toEqual([['1', '甲']]);
  });

  it('不可解释的结构错误仍从 getter 抛出', () => {
    mockGetCurrentChatTemplateScopeState.mockReturnValue({
      mode: 'chat_override',
      guideData: {
        mate: { type: 'chatSheets', version: 2 },
        sheet_0: { name: '坏表', content: [['名称', '行号']], seedRows: [['铁剑', '1']] },
      },
    });
    expect(() => getChatSheetGuideDataForIsolationKey_ACU('')).toThrow(/Sheet Guide row_id 结构无效/);
  });
});

// ═══ setChatSheetGuideDataForIsolationKey_ACU ═══
describe('setChatSheetGuideDataForIsolationKey_ACU', () => {
  it('无首条消息返回 false', () => {
    mockGetChatFirstLayerMessage.mockReturnValue(null);
    const result = setChatSheetGuideDataForIsolationKey_ACU('', { sheet_0: { name: '表', content: [['row_id']] } });
    expect(result).toBe(false);
  });

  it('无效 guide 返回 false', () => {
    mockGetChatFirstLayerMessage.mockReturnValue({});
    const result = setChatSheetGuideDataForIsolationKey_ACU('', null);
    expect(result).toBe(false);
  });

  it('有效 guide 写入容器并返回 true', () => {
    const firstMsg: any = {};
    mockGetChatFirstLayerMessage.mockReturnValue(firstMsg);
    mockGetChatArray.mockReturnValue([firstMsg]);
    mockGetChatSheetGuideContainer.mockReturnValue({ version: 2, tags: {} });
    const guideData = {
      sheet_0: {
        uid: 's0',
        name: '物品表',
        content: [['row_id', '物品名']],
        sourceData: {},
        updateConfig: {},
      },
    };
    const result = setChatSheetGuideDataForIsolationKey_ACU('', guideData, { reason: 'test' });
    expect(result).toBe(true);
    expect(firstMsg._acu_sheet_guide).toBeDefined();
  });

  it('setter 接收可收敛的超宽 Guide 时保存规范化结果', () => {
    const firstMsg: any = {};
    mockGetChatFirstLayerMessage.mockReturnValue(firstMsg);
    mockGetChatArray.mockReturnValue([firstMsg]);
    mockGetChatSheetGuideContainer.mockReturnValue({ version: 2, tags: {} });

    const result = setChatSheetGuideDataForIsolationKey_ACU('', {
      sheet_0: {
        uid: 's0',
        name: '物品表',
        content: [['row_id', '物品名']],
        _seedRows: [['7', '铁剑', '旧列']],
        sourceData: {},
        updateConfig: {},
      },
    }, { reason: 'test' });

    expect(result).toBe(true);
    expect(firstMsg._acu_sheet_guide.tags[''].data.sheet_0._seedRows).toEqual([['7', '铁剑']]);
  });

  it('setter 拒绝不可解释的结构错误', () => {
    const firstMsg: any = {};
    mockGetChatFirstLayerMessage.mockReturnValue(firstMsg);
    mockGetChatArray.mockReturnValue([firstMsg]);
    const result = setChatSheetGuideDataForIsolationKey_ACU('', {
      sheet_0: { name: '坏表', content: [['名称', '行号']], seedRows: [['铁剑', '1']] },
    });
    expect(result).toBe(false);
  });

  it('未要求同步 scope 时只写入 guide', () => {
    const firstMsg: any = {};
    mockGetChatFirstLayerMessage.mockReturnValue(firstMsg);
    mockGetChatArray.mockReturnValue([firstMsg]);
    mockGetChatSheetGuideContainer.mockReturnValue({ version: 2, tags: {} });

    const result = setChatSheetGuideDataForIsolationKey_ACU('', {
      sheet_0: { uid: 's0', name: '表', content: [['row_id']], sourceData: {}, updateConfig: {} },
    });

    expect(result).toBe(true);
    expect(mockBuildChatTemplateScopeStateFromCurrent).not.toHaveBeenCalled();
    expect(mockSetCurrentChatTemplateScopeState).not.toHaveBeenCalled();
    expect(firstMsg._acu_sheet_guide.tags[''].data.sheet_0.name).toBe('表');
  });

  it('同步 scope 但无法构建状态时返回 false', () => {
    const firstMsg: any = {};
    mockGetChatFirstLayerMessage.mockReturnValue(firstMsg);
    mockGetChatArray.mockReturnValue([firstMsg]);
    mockGetChatSheetGuideContainer.mockReturnValue({ version: 2, tags: {} });
    mockBuildChatTemplateScopeStateFromCurrent.mockReturnValue(null);

    const result = setChatSheetGuideDataForIsolationKey_ACU('', {
      sheet_0: { uid: 's0', name: '表', content: [['row_id']], sourceData: {}, updateConfig: {} },
    }, { syncTemplateScope: true });

    expect(result).toBe(false);
    expect(mockSetCurrentChatTemplateScopeState).not.toHaveBeenCalled();
  });

  it('同步 scope 写入失败时返回 false，并将规范化 guide 用于 scope 构建', () => {
    const firstMsg: any = {};
    mockGetChatFirstLayerMessage.mockReturnValue(firstMsg);
    mockGetChatArray.mockReturnValue([firstMsg]);
    mockGetChatSheetGuideContainer.mockReturnValue({ version: 2, tags: {} });
    const templateState = { mode: 'chat_override', templateStr: '{}' };
    mockBuildChatTemplateScopeStateFromCurrent.mockReturnValue(templateState);
    mockSetCurrentChatTemplateScopeState.mockReturnValue(false);

    const result = setChatSheetGuideDataForIsolationKey_ACU('', {
      sheet_0: { uid: 's0', name: '表', content: [['row_id']], sourceData: {}, updateConfig: {} },
    }, { syncTemplateScope: true });

    expect(result).toBe(false);
    expect(mockSetCurrentChatTemplateScopeState).toHaveBeenCalledWith(templateState, expect.objectContaining({ isolationKey: '' }));
    const builderInput = mockBuildChatTemplateScopeStateFromCurrent.mock.calls[0][0];
    expect(builderInput.guideData).toBe(firstMsg._acu_sheet_guide.tags[''].data);
  });
});

// ═══ getEffectiveSeedRowsForSheet_ACU ═══
describe('getEffectiveSeedRowsForSheet_ACU', () => {
  beforeEach(() => {
    mockGetChatArray.mockReturnValue([{ is_user: true, mes: '第一条用户消息' }]);
  });

  it('无效 sheetKey 返回空数组', () => {
    expect(getEffectiveSeedRowsForSheet_ACU('')).toEqual([]);
    expect(getEffectiveSeedRowsForSheet_ACU('invalid')).toEqual([]);
  });

  it('currentData 有种子行时直接返回', () => {
    mockCurrentJsonTableData.sheet_0 = { _seedRows: [['1', '铁剑']] };
    const result = getEffectiveSeedRowsForSheet_ACU('sheet_0');
    expect(result).toEqual([['1', '铁剑']]);
    // 深拷贝验证
    expect(result).not.toBe(mockCurrentJsonTableData.sheet_0._seedRows);
  });

  it('currentData 无种子行时回退到 guide', () => {
    mockCurrentJsonTableData.sheet_0 = {};
    mockGetCurrentChatTemplateScopeState.mockReturnValue({
      mode: 'chat_override',
      guideData: {
        mate: { type: 'chatSheets', version: 2 },
        sheet_0: { name: '表', content: [['row_id', '值']], _seedRows: [['1', '数据']] },
      },
    });
    const result = getEffectiveSeedRowsForSheet_ACU('sheet_0');
    expect(result).toEqual([['1', '数据']]);
  });

  it('currentData 的种子行缺失 row_id 时按未占用数字补齐', () => {
    mockCurrentJsonTableData.sheet_0 = { _seedRows: [[null, '空值'], ['1', '已存在'], ['', '空串']] };

    const result = getEffectiveSeedRowsForSheet_ACU('sheet_0');

    expect(result).toEqual([['2', '空值'], ['1', '已存在'], ['3', '空串']]);
    expect(result).not.toBe(mockCurrentJsonTableData.sheet_0._seedRows);
  });

  it('回退到 guide 时拒绝重复非空 row_id，避免静默改变历史身份', () => {
    mockCurrentJsonTableData.sheet_0 = {};
    mockGetCurrentChatTemplateScopeState.mockReturnValue({
      mode: 'chat_override',
      guideData: { mate: { type: 'chatSheets', version: 2 }, sheet_0: { name: '表', content: [['row_id', '值']], _seedRows: [['alpha', '首个'], ['alpha', '重复']] } },
    });

    const result = getEffectiveSeedRowsForSheet_ACU('sheet_0');

    expect(result).toEqual([]);
  });

  it('allowTemplateFallback=false 时不回退到模板', () => {
    mockCurrentJsonTableData.sheet_0 = {};
    mockGetCurrentChatTemplateScopeState.mockReturnValue(null);
    mockPeekChatScopedConfigContainer.mockReturnValue(null);
    mockPeekChatSheetGuideContainer.mockReturnValue({});
    const result = getEffectiveSeedRowsForSheet_ACU('sheet_0', { allowTemplateFallback: false });
    expect(result).toEqual([]);
  });

  it('历史 seedRows picker 只使用纯读取容器，不触发迁移型 getter', () => {
    mockCurrentJsonTableData.sheet_0 = {};
    mockGetCurrentChatTemplateScopeState.mockReturnValue(null);
    mockPeekChatScopedConfigContainer.mockReturnValue(null);
    mockPeekChatSheetGuideContainer.mockReturnValue({
      version: 2,
      tags: { legacy: { updatedAt: 1, data: { sheet_0: { _seedRows: [['1', '历史数据']] } } } },
    });

    expect(getEffectiveSeedRowsForSheet_ACU('sheet_0', { guideData: {} })).toEqual([['1', '历史数据']]);
    expect(mockPeekChatScopedConfigContainer).toHaveBeenCalledWith(mockGetChatArray());
    expect(mockPeekChatSheetGuideContainer).toHaveBeenCalledWith(mockGetChatArray());
    expect(mockGetChatScopedConfigContainer).not.toHaveBeenCalled();
    expect(mockGetChatSheetGuideContainer).not.toHaveBeenCalled();
  });
});

// ═══ attachSeedRowsToCurrentDataFromGuide_ACU ═══
describe('attachSeedRowsToCurrentDataFromGuide_ACU', () => {
  it('无 currentData 返回 false', () => {
    // mockCurrentJsonTableData 是空对象，但不是 null
    // 需要测试 guide 为 null 的情况
    expect(attachSeedRowsToCurrentDataFromGuide_ACU(null)).toBe(false);
  });

  it('已有种子行不覆盖', () => {
    mockCurrentJsonTableData.sheet_0 = { _seedRows: [['existing']] };
    const guide = {
      sheet_0: { name: '表', content: [['row_id']], _seedRows: [['new']] },
    };
    const result = attachSeedRowsToCurrentDataFromGuide_ACU(guide);
    expect(result).toBe(false);
    expect(mockCurrentJsonTableData.sheet_0._seedRows).toEqual([['existing']]);
  });

  it('无种子行时从 guide 附加', () => {
    mockCurrentJsonTableData.sheet_0 = { name: '表' };
    const guide = {
      sheet_0: { name: '表', content: [['row_id']], _seedRows: [['1', '种子']] },
    };
    const result = attachSeedRowsToCurrentDataFromGuide_ACU(guide);
    expect(result).toBe(true);
    expect(mockCurrentJsonTableData.sheet_0._seedRows).toEqual([['1', '种子']]);
  });
});

// ═══ buildChatSheetGuideDataFromData_ACU ═══
describe('buildChatSheetGuideDataFromData_ACU', () => {
  it('null 输入返回 null', () => {
    expect(buildChatSheetGuideDataFromData_ACU(null)).toBeNull();
  });

  it('有效数据构建 guide（只保留表头）', () => {
    const data = {
      mate: { type: 'chatSheets' },
      sheet_0: {
        uid: 's0',
        name: '物品表',
        content: [['row_id', '物品名'], ['1', '铁剑']],
        sourceData: { note: '' },
        updateConfig: { contextDepth: 5 },
        orderNo: 0,
      },
    };
    const result = buildChatSheetGuideDataFromData_ACU(data);
    expect(result).not.toBeNull();
    expect(result.sheet_0).toBeDefined();
    expect(result.sheet_0.name).toBe('物品表');
    // guide 只保留表头
    expect(result.sheet_0.content).toEqual([['row_id', '物品名']]);
  });

  it('preserveSeedRows 时保留种子行', () => {
    const data = {
      sheet_0: { name: '表', content: [['row_id']], orderNo: 0 },
    };
    const preserveGuide = {
      sheet_0: { _seedRows: [['1', '保留的种子']] },
    };
    const result = buildChatSheetGuideDataFromData_ACU(data, { preserveSeedRowsFromGuideData: preserveGuide });
    expect(result.sheet_0._seedRows).toEqual([['1', '保留的种子']]);
  });

  it('有 orderedKeys 时按指定顺序', () => {
    const data = {
      sheet_b: { name: 'B', content: [['row_id']], orderNo: 1 },
      sheet_a: { name: 'A', content: [['row_id']], orderNo: 0 },
    };
    const result = buildChatSheetGuideDataFromData_ACU(data, { orderedKeys: ['sheet_b', 'sheet_a'] });
    expect(result).not.toBeNull();
    const sheetKeys = Object.keys(result).filter((k: string) => k.startsWith('sheet_'));
    expect(sheetKeys[0]).toBe('sheet_b');
    expect(sheetKeys[1]).toBe('sheet_a');
  });
});

// ═══ buildChatSheetGuideDataFromTemplateObj_ACU ═══
describe('buildChatSheetGuideDataFromTemplateObj_ACU', () => {
  it('null 输入返回 null', () => {
    expect(buildChatSheetGuideDataFromTemplateObj_ACU(null)).toBeNull();
  });

  it('无 sheet_ 键返回 null', () => {
    expect(buildChatSheetGuideDataFromTemplateObj_ACU({ mate: {} })).toBeNull();
  });

  it('有多行 content 时提取 seedRows', () => {
    const templateObj = {
      sheet_0: {
        uid: 's0',
        name: '物品表',
        content: [['row_id', '物品名'], ['1', '铁剑'], ['2', '盾牌']],
        orderNo: 0,
      },
    };
    const result = buildChatSheetGuideDataFromTemplateObj_ACU(templateObj, { stripSeedRows: true });
    expect(result).not.toBeNull();
    expect(result.sheet_0._seedRows).toEqual([['1', '铁剑'], ['2', '盾牌']]);
    // stripSeedRows=true 时 content 只保留表头
    expect(result.sheet_0.content).toEqual([['row_id', '物品名']]);
  });

  it('stripSeedRows=false 时保留完整 content', () => {
    const templateObj = {
      sheet_0: {
        name: '表',
        content: [['row_id'], ['1', '数据']],
        orderNo: 0,
      },
    };
    const result = buildChatSheetGuideDataFromTemplateObj_ACU(templateObj, { stripSeedRows: false });
    expect(result).not.toBeNull();
    // seedRows 仍然被提取
    expect(result.sheet_0._seedRows).toEqual([['1', '数据']]);
    // 但 content 保留完整（因为 stripSeedRows=false）
    expect(result.sheet_0.content.length).toBeGreaterThanOrEqual(1);
  });
});

// ═══ overwriteChatSheetGuideFromTemplate_ACU ═══
describe('overwriteChatSheetGuideFromTemplate_ACU', () => {
  it('null 模板返回 false', async () => {
    const result = await overwriteChatSheetGuideFromTemplate_ACU(null);
    expect(result).toBe(false);
  });

  it('有效模板写入 guide 并返回 true', async () => {
    const firstMsg: any = {};
    mockGetChatFirstLayerMessage.mockReturnValue(firstMsg);
    mockGetChatArray.mockReturnValue([firstMsg]);
    mockGetChatSheetGuideContainer.mockReturnValue({ version: 2, tags: {} });
    const templateObj = {
      sheet_0: {
        uid: 's0',
        name: '物品表',
        content: [['row_id', '物品名']],
        orderNo: 0,
      },
    };
    const result = await overwriteChatSheetGuideFromTemplate_ACU(templateObj, { reason: 'test' });
    expect(result).toBe(true);
    expect(mockSaveChatToHost).toHaveBeenCalled();
  });
});

// ═══ ensureChatSheetGuideSeeded_ACU ═══
describe('ensureChatSheetGuideSeeded_ACU', () => {
  it('已有 guide 且 force=false 时返回现有数据', async () => {
    mockGetCurrentChatTemplateScopeState.mockReturnValue({
      mode: 'chat_override',
      guideData: {
        mate: { type: 'chatSheets', version: 2 },
        sheet_0: { name: '表', content: [['row_id']] },
      },
    });
    const result = await ensureChatSheetGuideSeeded_ACU({ force: false });
    expect(result).toBeDefined();
  });

  it('无聊天数组时返回 null', async () => {
    mockGetCurrentChatTemplateScopeState.mockReturnValue(null);
    mockGetChatArray.mockReturnValue([]);
    const result = await ensureChatSheetGuideSeeded_ACU();
    // 空数组 → 返回 existing 或 null
    expect(result).toBeNull();
  });
});

// ═══ migrateLegacyTemplateScopeForCurrentChat_ACU ═══
describe('migrateLegacyTemplateScopeForCurrentChat_ACU', () => {
  it('已有 scoped state 时直接返回', () => {
    const existingState = { mode: 'chat_override', templateStr: '{}' };
    mockGetCurrentChatTemplateScopeState.mockReturnValue(existingState);
    const result = migrateLegacyTemplateScopeForCurrentChat_ACU();
    expect(result).toBe(existingState);
  });

  it('无任何旧数据时返回 null', () => {
    mockGetCurrentChatTemplateScopeState.mockReturnValue(null);
    mockGetChatSheetGuideContainer.mockReturnValue({});
    mockGetChatArray.mockReturnValue([]);
    const result = migrateLegacyTemplateScopeForCurrentChat_ACU();
    expect(result).toBeNull();
  });
});

describe('row_id 稳定化 helpers', () => {
  it('ensureStableRowIdsForSeedRows_ACU 只补空身份，不重编号重复非空身份', () => {
    const input = [['', '第一行'], ['1', '第二行'], ['1', '第三行'], ['r1', '第四行']];

    const result = ensureStableRowIdsForSeedRows_ACU(input as any);

    expect(result).toEqual([['2', '第一行'], ['1', '第二行'], ['1', '第三行'], ['r1', '第四行']]);
    expect(result).not.toBe(input);
    expect(input[0][0]).toBe('');
  });

  it('ensureStableRowIdsForSheetContent_ACU 保留表头并为 undefined/空行补齐 row_id', () => {
    const input = [['row_id', '名称'], [undefined, '未定义'], [], ['SystemRules', '稳定值']];

    const result = ensureStableRowIdsForSheetContent_ACU(input as any);

    expect(result).toEqual([
      ['row_id', '名称'],
      ['1', '未定义'],
      ['2'],
      ['SystemRules', '稳定值'],
    ]);
  });
});