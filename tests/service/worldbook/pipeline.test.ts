
/**
 * tests/service/worldbook/pipeline.test.ts
 * 世界书数据管线 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══ hoisted mocks ═══
const {
  mockSettings, mockCurrentJsonTableData, mockAllChatMessages,
  mockCoreApisAreReady, mockCurrentChatFileIdentifier,
  mockGetCurrentIsolationKey,
  mockSetCurrentJsonTableData, mockSetAllChatMessages,
  mockGetCurrentWorldbookConfig,
  mockIsWorldbookApiAvailable,
  mockGwGetLorebookEntries, mockGwSetLorebookEntries,
  mockGwCreateLorebookEntries, mockGwDeleteLorebookEntries,
  mockListLorebooks, mockGwGetWorldBooks, mockNormalizeLorebookEntriesForRead, mockResolveLorebookNameFromList,
  mockGetCharLorebooks, mockGetChatMessages, mockGetChatLength,
  mockSaveSettings,
  mockGetSortedSheetKeys, mockMaterializeDataFromSheetGuide,
  mockReorderDataBySheetKeys, mockGetChatSheetGuideDataForIsolationKey,
  mockGetImportBatchPrefix, mockGetImportStablePrefix,
  mockLogDebug, mockLogError, mockLogWarn,
  mockGetCurrentCharacterId,
  mockParseTableTemplateJson, mockIsEntryBlocked,
  mockFormatJsonToReadable, mockMaybeLiftWorldbookSuppression,
  mockMergeAllIndependentTables, mockConsumeLastMergeQuarantinedSheetKeys,
  mockConsumeLastMergeWarnings, mockShouldSuppressWorldbookInjection,
  mockAllocConsecutiveOrderBlock, mockApplyPlacementToEntry,
  mockBuildDefaultGlobalInjectionConfig, mockBuildUsedOrderSet,
  mockEnsureExportConfigDefaults, mockEnsureGlobalInjectionConfigDefaults,
  mockGetEntryOrderNumber, mockGetFixedPlacementDefaultsForTable,
  mockGetInjectionTargetLorebook, mockGetIsolationPrefix,
  mockIsEntryPlacementMatched, mockNormalizeLorebookPosition,
  mockNormalizePlacementConfig,
  mockUpdateCustomTableExports, mockUpdateImportantPersonsRelatedEntries,
  mockUpdateOutlineTableEntry, mockUpdateSummaryTableEntries,
  mockPersistNullRowCleanupShards,
} = vi.hoisted(() => {
  const mockSettings: any = {
    dataIsolationEnabled: false,
    dataIsolationCode: '',
    knownCustomEntryNames: [],
  };
  return {
    mockSettings,
    mockCurrentJsonTableData: { value: null as any },
    mockAllChatMessages: { value: [] as any[] },
    mockCoreApisAreReady: { value: true },
    mockCurrentChatFileIdentifier: { value: 'test-chat' },
    mockGetCurrentIsolationKey: vi.fn(() => ''),
    mockSetCurrentJsonTableData: vi.fn(),
    mockSetAllChatMessages: vi.fn(),
    mockGetCurrentWorldbookConfig: vi.fn(() => ({
      source: 'character',
      injectionTarget: 'character',
      manualSelection: [],
      enabledEntries: {},
      zeroTkOccupyMode: false,
    })),
    mockIsWorldbookApiAvailable: vi.fn(() => true),
    mockGwGetLorebookEntries: vi.fn(async () => []),
    mockGwSetLorebookEntries: vi.fn(async () => {}),
    mockGwCreateLorebookEntries: vi.fn(async () => {}),
    mockGwDeleteLorebookEntries: vi.fn(async () => {}),
    mockListLorebooks: vi.fn(async () => []),
    mockGwGetWorldBooks: vi.fn(async () => []),
    mockNormalizeLorebookEntriesForRead: vi.fn((entries: unknown) => Array.isArray(entries) ? entries : []),
    mockResolveLorebookNameFromList: vi.fn((requestedName: unknown, bookList: unknown) => {
      const requested = String(requestedName ?? '').normalize('NFKC').replace(/[\u200B\uFEFF]/g, '').trim();
      const names = (Array.isArray(bookList) ? bookList : []).map(item =>
        String(item && typeof item === 'object' ? (item as any).name ?? '' : item ?? '').trim()
      ).filter(Boolean);
      const exact = names.find(name => name === String(requestedName ?? '').trim());
      if (exact) return exact;
      const matches = names.filter(name => name.normalize('NFKC').replace(/[\u200B\uFEFF]/g, '').trim() === requested);
      return matches.length === 1 ? matches[0] : null;
    }),
    mockGetCharLorebooks: vi.fn(async () => ({ primary: null, additional: [] })),
    mockGetChatMessages: vi.fn(async () => []),
    mockGetChatLength: vi.fn(() => 0),
    mockSaveSettings: vi.fn(),
    mockGetSortedSheetKeys: vi.fn(() => []),
    mockMaterializeDataFromSheetGuide: vi.fn(() => null),
    mockReorderDataBySheetKeys: vi.fn((data: any) => data),
    mockGetChatSheetGuideDataForIsolationKey: vi.fn(() => null),
    mockGetImportBatchPrefix: vi.fn(() => '外部导入-'),
    mockGetImportStablePrefix: vi.fn(() => '外部导入-'),
    mockGetCurrentCharacterId: vi.fn(() => 'test-character'),
    mockLogDebug: vi.fn(),
    mockLogError: vi.fn(),
    mockLogWarn: vi.fn(),
    mockParseTableTemplateJson: vi.fn(() => null),
    mockIsEntryBlocked: vi.fn(() => false),
    mockFormatJsonToReadable: vi.fn(() => ({
      readableText: '测试可读文本',
      importantPersonsTable: null,
      summaryTable: null,
      outlineTable: null,
    })),
    mockMaybeLiftWorldbookSuppression: vi.fn(),
    mockMergeAllIndependentTables: vi.fn(async () => null),
    mockConsumeLastMergeQuarantinedSheetKeys: vi.fn(() => []),
    mockConsumeLastMergeWarnings: vi.fn(() => []),
    mockShouldSuppressWorldbookInjection: vi.fn(() => false),
    mockAllocConsecutiveOrderBlock: vi.fn(() => 100),
    mockApplyPlacementToEntry: vi.fn((entry: any, placement: any) => ({ ...entry, ...placement })),
    mockBuildDefaultGlobalInjectionConfig: vi.fn(() => ({
      readableEntryPlacement: { position: 'before_character_definition', depth: 2, order: 99981 },
      wrapperPlacement: { position: 'before_character_definition', depth: 2, order: 99980 },
    })),
    mockBuildUsedOrderSet: vi.fn(() => new Set<number>()),
    mockEnsureExportConfigDefaults: vi.fn((cfg: any) => ({
      enabled: false,
      splitByRow: false,
      entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 },
      fixedEntryPlacement: { position: 'at_depth_as_system', depth: 2, order: 99990 },
      fixedIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 99991 },
      ...cfg,
    })),
    mockEnsureGlobalInjectionConfigDefaults: vi.fn((cfg: any) => ({
      readableEntryPlacement: { position: 'before_character_definition', depth: 2, order: 99981 },
      wrapperPlacement: { position: 'before_character_definition', depth: 2, order: 99980 },
      ...cfg,
    })),
    mockGetEntryOrderNumber: vi.fn((entry: any) => entry?.order ?? null),
    mockGetFixedPlacementDefaultsForTable: vi.fn(() => ({
      entry: { position: 'at_depth_as_system', depth: 2, order: 99990 },
      index: { position: 'at_depth_as_system', depth: 2, order: 99991 },
    })),
    mockGetInjectionTargetLorebook: vi.fn(async () => 'test-lorebook'),
    mockGetIsolationPrefix: vi.fn(() => ''),
    mockIsEntryPlacementMatched: vi.fn(() => true),
    mockNormalizeLorebookPosition: vi.fn((pos: any) => pos || 'at_depth_as_system'),
    mockNormalizePlacementConfig: vi.fn((raw: any, fallback: any) => raw || fallback || { position: 'at_depth_as_system', depth: 2, order: 10000 }),
    mockUpdateCustomTableExports: vi.fn(async () => {}),
    mockUpdateImportantPersonsRelatedEntries: vi.fn(async () => {}),
    mockUpdateOutlineTableEntry: vi.fn(async () => {}),
    mockUpdateSummaryTableEntries: vi.fn(async () => {}),
    mockPersistNullRowCleanupShards: vi.fn(async () => ({ status: 'persisted', messageIndex: 3 })),
  };
});

// ═══ vi.mock ═══
vi.mock('../../../src/service/settings/settings-readers', () => ({
  getCurrentWorldbookConfig_ACU: mockGetCurrentWorldbookConfig,
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get settings_ACU() { return mockSettings; },
  get currentJsonTableData_ACU() { return mockCurrentJsonTableData.value; },
  get allChatMessages_ACU() { return mockAllChatMessages.value; },
  get coreApisAreReady_ACU() { return mockCoreApisAreReady.value; },
  get currentChatFileIdentifier_ACU() { return mockCurrentChatFileIdentifier.value; },
  getCurrentIsolationKey_ACU: mockGetCurrentIsolationKey,
  _set_currentJsonTableData_ACU: mockSetCurrentJsonTableData,
  _set_allChatMessages_ACU: mockSetAllChatMessages,
}));

vi.mock('../../../src/data/gateways/worldbook-gateway', () => ({
  createLorebookReadGuard_ACU: vi.fn(async () => async (_names?: string[]) => {}),
  isWorldbookApiAvailable_ACU: mockIsWorldbookApiAvailable,
  getLorebookEntries_ACU: mockGwGetLorebookEntries,
  getLorebookEntriesRequired_ACU: mockGwGetLorebookEntries,
  setLorebookEntries_ACU: mockGwSetLorebookEntries,
  createLorebookEntries_ACU: mockGwCreateLorebookEntries,
  deleteLorebookEntries_ACU: mockGwDeleteLorebookEntries,
  listLorebooks_ACU: mockListLorebooks,
  getWorldBooks_ACU: mockGwGetWorldBooks,
  normalizeLorebookEntriesForRead_ACU: mockNormalizeLorebookEntriesForRead,
  resolveLorebookNameFromList_ACU: mockResolveLorebookNameFromList,
}));

vi.mock('../../../src/data/gateways/character-gateway', () => ({
  getCharLorebooks_ACU: mockGetCharLorebooks,
  getChatMessages_ACU: mockGetChatMessages,
}));

vi.mock('../../../src/data/gateways/host-state-gateway', () => ({
  getCurrentCharacterId_ACU: mockGetCurrentCharacterId,
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatLength_ACU: mockGetChatLength,
}));

vi.mock('../../../src/service/settings/settings-service', () => ({
  saveSettings_ACU: mockSaveSettings,
}));

vi.mock('../../../src/service/template/chat-scope', () => ({
  getSortedSheetKeys_ACU: mockGetSortedSheetKeys,
  materializeDataFromSheetGuide_ACU: mockMaterializeDataFromSheetGuide,
  reorderDataBySheetKeys_ACU: mockReorderDataBySheetKeys,
  getChatSheetGuideDataForIsolationKey_ACU: mockGetChatSheetGuideDataForIsolationKey,
}));

vi.mock('../../../src/shared/constants', () => ({
  getImportBatchPrefix_ACU: mockGetImportBatchPrefix,
  getImportStablePrefix_ACU: mockGetImportStablePrefix,
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: mockLogDebug,
  logError_ACU: mockLogError,
  logWarn_ACU: mockLogWarn,
  parseTableTemplateJson_ACU: mockParseTableTemplateJson,
  isEntryBlocked_ACU: mockIsEntryBlocked,
}));

vi.mock('../../../src/service/runtime/helpers-remaining', () => ({
  formatJsonToReadable_ACU: mockFormatJsonToReadable,
  maybeLiftWorldbookSuppression_ACU: mockMaybeLiftWorldbookSuppression,
  mergeAllIndependentTables_ACU: mockMergeAllIndependentTables,
  consumeLastMergeQuarantinedSheetKeys_ACU: mockConsumeLastMergeQuarantinedSheetKeys,
  consumeLastMergeWarnings_ACU: mockConsumeLastMergeWarnings,
  shouldSuppressWorldbookInjection_ACU: mockShouldSuppressWorldbookInjection,
}));

vi.mock('../../../src/service/table/storage-frame-v2-persist', () => ({
  persistNullRowCleanupShards_ACU: mockPersistNullRowCleanupShards,
}));

vi.mock('../../../src/service/worldbook/injection-engine', () => ({
  allocConsecutiveOrderBlock_ACU: mockAllocConsecutiveOrderBlock,
  applyPlacementToEntry_ACU: mockApplyPlacementToEntry,
  buildDefaultGlobalInjectionConfig_ACU: mockBuildDefaultGlobalInjectionConfig,
  buildUsedOrderSet_ACU: mockBuildUsedOrderSet,
  ensureExportConfigDefaults_ACU: mockEnsureExportConfigDefaults,
  ensureGlobalInjectionConfigDefaults_ACU: mockEnsureGlobalInjectionConfigDefaults,
  getEntryOrderNumber_ACU: mockGetEntryOrderNumber,
  getFixedPlacementDefaultsForTable_ACU: mockGetFixedPlacementDefaultsForTable,
  getInjectionTargetLorebook_ACU: mockGetInjectionTargetLorebook,
  getIsolationPrefix_ACU: mockGetIsolationPrefix,
  isEntryPlacementMatched_ACU: mockIsEntryPlacementMatched,
  normalizeLorebookPosition_ACU: mockNormalizeLorebookPosition,
  normalizePlacementConfig_ACU: mockNormalizePlacementConfig,
  updateCustomTableExports_ACU: mockUpdateCustomTableExports,
  updateImportantPersonsRelatedEntries_ACU: mockUpdateImportantPersonsRelatedEntries,
  updateOutlineTableEntry_ACU: mockUpdateOutlineTableEntry,
  updateSummaryTableEntries_ACU: mockUpdateSummaryTableEntries,
}));

import {
  isImportTaggedLorebookEntry_ACU,
  getWorldbookCommentInfo_ACU,
  getWorldbookEntryKeywords_ACU,
  getWorldbookEntryPlaceholderSortKey_ACU,
  compareWorldbookEntriesForPlaceholder_ACU,
  createStrictLorebookReadError_ACU,
  getWorldbookNames_ACU,
  getLorebookEntriesStrict_ACU,
  summarizeStrictLorebookReadError_ACU,
  getLorebookEntriesByNames_ACU,
  getWorldBooks_ACU,
  loadAllChatMessages_ACU,
  deleteAllGeneratedEntries_ACU,
  refreshMergedDataAndNotify_ACU,
  collectCombinedWorldbookEntriesByStrategy_ACU,
  buildCombinedWorldbookContentByStrategy_ACU,
  getCombinedWorldbookContent_ACU,
  updateReadableLorebookEntry_ACU,
} from '../../../src/service/worldbook/pipeline';
import { createPlotWorldbookReadContext_ACU } from '../../../src/service/runtime/plot-runtime/plot-worldbook-read-context';

beforeEach(() => {
  vi.clearAllMocks();
  mockMergeAllIndependentTables.mockReset();
  mockSettings.dataIsolationEnabled = false;
  mockSettings.dataIsolationCode = '';
  mockSettings.knownCustomEntryNames = [];
  delete mockSettings.autoMergedOrder;
  mockCurrentJsonTableData.value = null;
  mockAllChatMessages.value = [];
  mockCoreApisAreReady.value = true;
  mockCurrentChatFileIdentifier.value = 'test-chat';
  mockIsWorldbookApiAvailable.mockReturnValue(true);
  mockGetInjectionTargetLorebook.mockResolvedValue('test-lorebook');
  mockGetIsolationPrefix.mockReturnValue('');
  mockShouldSuppressWorldbookInjection.mockReturnValue(false);
  mockGwGetLorebookEntries.mockResolvedValue([]);
  mockListLorebooks.mockResolvedValue([]);
  mockNormalizeLorebookEntriesForRead.mockImplementation((entries: unknown) => Array.isArray(entries) ? entries : []);
  mockResolveLorebookNameFromList.mockClear();
  mockGetCharLorebooks.mockResolvedValue({ primary: null, additional: [] });
  mockGetImportStablePrefix.mockReturnValue('外部导入-');
  mockGetImportBatchPrefix.mockReturnValue('外部导入-');
  mockPersistNullRowCleanupShards.mockResolvedValue({ status: 'persisted', messageIndex: 3 });
});

// ═══════════════════════════════════════════════════
// 纯函数测试
// ═══════════════════════════════════════════════════

describe('isImportTaggedLorebookEntry_ACU', () => {
  it('识别外部导入标记的条目', () => {
    mockGetImportStablePrefix.mockReturnValue('外部导入-');
    expect(isImportTaggedLorebookEntry_ACU({ comment: '外部导入-表格A' })).toBe(true);
  });

  it('识别带隔离前缀的外部导入条目', () => {
    mockGetImportStablePrefix.mockReturnValue('外部导入-');
    expect(isImportTaggedLorebookEntry_ACU({ comment: 'ACU-[test]-外部导入-表格A' })).toBe(true);
  });

  it('非导入条目返回 false', () => {
    mockGetImportStablePrefix.mockReturnValue('外部导入-');
    expect(isImportTaggedLorebookEntry_ACU({ comment: 'TavernDB-ACU-ReadableDataTable' })).toBe(false);
  });

  it('空 comment 返回 false', () => {
    expect(isImportTaggedLorebookEntry_ACU({ comment: '' })).toBe(false);
    expect(isImportTaggedLorebookEntry_ACU({})).toBe(false);
  });

  it('使用 name 字段作为后备', () => {
    mockGetImportStablePrefix.mockReturnValue('外部导入-');
    expect(isImportTaggedLorebookEntry_ACU({ name: '外部导入-表格B' })).toBe(true);
  });
});

describe('getWorldbookCommentInfo_ACU', () => {
  it('返回原始和规范化的 comment', () => {
    const result = getWorldbookCommentInfo_ACU({ comment: '测试条目' });
    expect(result.rawComment).toBe('测试条目');
    expect(result.normalizedComment).toBe('测试条目');
  });

  it('去除隔离前缀', () => {
    const result = getWorldbookCommentInfo_ACU({ comment: 'ACU-[test]-外部导入-batch1-内容' });
    expect(result.rawComment).toBe('ACU-[test]-外部导入-batch1-内容');
    expect(result.normalizedComment).toBe('内容');
  });

  it('空 comment 使用 name 字段', () => {
    const result = getWorldbookCommentInfo_ACU({ name: '备用名称' });
    expect(result.rawComment).toBe('备用名称');
  });

  it('空对象返回空字符串', () => {
    const result = getWorldbookCommentInfo_ACU({});
    expect(result.rawComment).toBe('');
    expect(result.normalizedComment).toBe('');
  });
});

describe('getWorldbookEntryKeywords_ACU', () => {
  it('从 key 数组提取关键词', () => {
    const result = getWorldbookEntryKeywords_ACU({ key: ['Hello', 'World'] });
    expect(result).toEqual(['hello', 'world']);
  });

  it('从 keys 数组提取关键词', () => {
    const result = getWorldbookEntryKeywords_ACU({ keys: ['Test'] });
    expect(result).toEqual(['test']);
  });

  it('合并 key 和 keys 并去重', () => {
    const result = getWorldbookEntryKeywords_ACU({ key: ['a', 'b'], keys: ['b', 'c'] });
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('字符串类型的 key 转为数组', () => {
    const result = getWorldbookEntryKeywords_ACU({ key: 'single' });
    expect(result).toEqual(['single']);
  });

  it('空输入返回空数组', () => {
    expect(getWorldbookEntryKeywords_ACU({})).toEqual([]);
    expect(getWorldbookEntryKeywords_ACU({ key: [] })).toEqual([]);
  });

  it('过滤空字符串和空白', () => {
    const result = getWorldbookEntryKeywords_ACU({ key: ['valid', '', '  '] });
    expect(result).toEqual(['valid']);
  });
});

describe('getWorldbookEntryPlaceholderSortKey_ACU', () => {
  beforeEach(() => {
    mockNormalizeLorebookPosition.mockImplementation((pos: any) => {
      if (pos === 'before_character_definition' || pos === '0') return 'before_character_definition';
      if (pos === 'after_character_definition' || pos === '1') return 'after_character_definition';
      return 'at_depth_as_system';
    });
    mockGetEntryOrderNumber.mockImplementation((entry: any) => {
      const v = entry?.order;
      const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
      return Number.isFinite(n) ? n : null;
    });
  });

  it('before_character_definition 排在 segment 0', () => {
    const key = getWorldbookEntryPlaceholderSortKey_ACU({ position: 'before_character_definition', order: 5 });
    expect(key.segment).toBe(0);
    expect(key.order).toBe(5);
  });

  it('after_character_definition 排在 segment 1', () => {
    const key = getWorldbookEntryPlaceholderSortKey_ACU({ position: 'after_character_definition', order: 10 });
    expect(key.segment).toBe(1);
  });

  it('at_depth_as_system 排在 segment 2，depthRank 为负 depth', () => {
    const key = getWorldbookEntryPlaceholderSortKey_ACU({ position: 'at_depth_as_system', depth: 5, order: 100 });
    expect(key.segment).toBe(2);
    expect(key.depthRank).toBe(-5);
    expect(key.order).toBe(100);
  });

  it('无 order 时使用 MAX_SAFE_INTEGER', () => {
    const key = getWorldbookEntryPlaceholderSortKey_ACU({ position: 'at_depth_as_system' });
    expect(key.order).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('compareWorldbookEntriesForPlaceholder_ACU', () => {
  beforeEach(() => {
    mockNormalizeLorebookPosition.mockImplementation((pos: any) => {
      if (pos === 'before_character_definition') return 'before_character_definition';
      if (pos === 'after_character_definition') return 'after_character_definition';
      return 'at_depth_as_system';
    });
    mockGetEntryOrderNumber.mockImplementation((entry: any) => {
      const v = entry?.order;
      const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
      return Number.isFinite(n) ? n : null;
    });
  });

  it('不同 segment 按 segment 排序', () => {
    const a = { position: 'before_character_definition', order: 1 };
    const b = { position: 'at_depth_as_system', depth: 2, order: 1 };
    expect(compareWorldbookEntriesForPlaceholder_ACU(a, b)).toBeLessThan(0);
  });

  it('同 segment 按 depthRank 排序', () => {
    const a = { position: 'at_depth_as_system', depth: 10, order: 1 };
    const b = { position: 'at_depth_as_system', depth: 5, order: 1 };
    expect(compareWorldbookEntriesForPlaceholder_ACU(a, b)).toBeLessThan(0);
  });

  it('同 segment 同 depth 按 order 排序', () => {
    const a = { position: 'at_depth_as_system', depth: 2, order: 5 };
    const b = { position: 'at_depth_as_system', depth: 2, order: 10 };
    expect(compareWorldbookEntriesForPlaceholder_ACU(a, b)).toBeLessThan(0);
  });

  it('完全相同时按 _acuPlaceholderOriginalIndex 排序', () => {
    const a = { position: 'at_depth_as_system', depth: 2, order: 5, _acuPlaceholderOriginalIndex: 0 };
    const b = { position: 'at_depth_as_system', depth: 2, order: 5, _acuPlaceholderOriginalIndex: 1 };
    expect(compareWorldbookEntriesForPlaceholder_ACU(a, b)).toBeLessThan(0);
  });

  it('相同条件按 bookName 排序', () => {
    const a = { position: 'at_depth_as_system', depth: 2, order: 5, _acuPlaceholderOriginalIndex: 0, bookName: 'A书' };
    const b = { position: 'at_depth_as_system', depth: 2, order: 5, _acuPlaceholderOriginalIndex: 0, bookName: 'B书' };
    expect(compareWorldbookEntriesForPlaceholder_ACU(a, b)).toBeLessThan(0);
  });
});

// ═══════════════════════════════════════════════════
// 异步函数测试
// ═══════════════════════════════════════════════════

describe('getWorldbookNames_ACU', () => {
  it('返回世界书名称列表', async () => {
    mockListLorebooks.mockResolvedValue(['书A', '书B']);
    const result = await getWorldbookNames_ACU();
    expect(result).toEqual(['书A', '书B']);
  });

  it('过滤空名称', async () => {
    mockListLorebooks.mockResolvedValue(['书A', '', null, '书B']);
    const result = await getWorldbookNames_ACU();
    expect(result).toEqual(['书A', '书B']);
  });

  it('处理对象格式的名称', async () => {
    mockListLorebooks.mockResolvedValue([{ name: '书A' }, { name: '书B' }]);
    const result = await getWorldbookNames_ACU();
    expect(result).toEqual(['书A', '书B']);
  });

  it('空列表返回空数组', async () => {
    mockListLorebooks.mockResolvedValue([]);
    const result = await getWorldbookNames_ACU();
    expect(result).toEqual([]);
  });

  it('null 返回空数组', async () => {
    mockListLorebooks.mockResolvedValue(null);
    const result = await getWorldbookNames_ACU();
    expect(result).toEqual([]);
  });
});

describe('getLorebookEntriesByNames_ACU', () => {
  it('按名称获取条目并标记 book', async () => {
    mockGwGetLorebookEntries.mockResolvedValue([
      { uid: 1, comment: '条目1' },
    ]);
    const result = await getLorebookEntriesByNames_ACU(['书A']);
    expect(result['书A']).toHaveLength(1);
    expect(result['书A'][0].book).toBe('书A');
  });

  it('去重名称', async () => {
    mockGwGetLorebookEntries.mockResolvedValue([]);
    await getLorebookEntriesByNames_ACU(['书A', '书A', '书B']);
    // 应该只调用 2 次（去重后）
    expect(mockGwGetLorebookEntries).toHaveBeenCalledTimes(2);
  });

  it('获取失败时传播异常，不伪装为空书且不记录正文', async () => {
    const sensitiveText = '用户输入、提示词和世界书正文都不能泄露';
    const error = new Error(sensitiveText);
    mockGwGetLorebookEntries.mockRejectedValue(error);
    await expect(getLorebookEntriesByNames_ACU(['书A'])).rejects.toBe(error);
    expect(mockLogWarn).toHaveBeenCalledWith('[Worldbook] 获取世界书条目失败，忽略该书并继续。', {
      phase: 'read_entries',
      attempt: 1,
      bookName: '书A',
      error: { category: 'read_failed' },
    });
    expect(JSON.stringify(mockLogWarn.mock.calls)).not.toContain(sensitiveText);
  });

  it('对象形式的可用列表不会误过滤真实世界书', async () => {
    mockListLorebooks.mockResolvedValue([{ name: '书A' }]);
    mockGwGetLorebookEntries.mockResolvedValue([{ uid: 1 }]);
    const result = await getLorebookEntriesByNames_ACU(['书A']);
    expect(mockGwGetLorebookEntries).toHaveBeenCalledWith('书A');
    expect(result['书A']).toHaveLength(1);
  });

  it('可用列表读取失败时停止，不使用未经验证的引用', async () => {
    const error = new Error('list unavailable');
    mockListLorebooks.mockRejectedValue(error);
    mockGwGetLorebookEntries.mockResolvedValue([{ uid: 1 }]);
    await expect(getLorebookEntriesByNames_ACU(['书A'])).rejects.toBe(error);
    expect(mockGwGetLorebookEntries).not.toHaveBeenCalled();
  });

  it('单本读取失败时不返回部分成功结果', async () => {
    mockListLorebooks.mockResolvedValue(['书A', '书B']);
    mockGwGetLorebookEntries.mockImplementation(async (name: string) => {
      if (name === '书A') throw new Error('not found');
      return [{ uid: 2 }];
    });
    await expect(getLorebookEntriesByNames_ACU(['书A', '书B'])).rejects.toThrow('not found');
    expect(mockGwGetLorebookEntries).not.toHaveBeenCalledWith('书B');
  });

  it('空输入返回空对象', async () => {
    const result = await getLorebookEntriesByNames_ACU([]);
    expect(result).toEqual({});
  });

  it('API 不可用时使用 fallback', async () => {
    mockIsWorldbookApiAvailable.mockReturnValue(false);
    mockGwGetWorldBooks.mockResolvedValue([
      { name: '书A', entries: [{ uid: 1, comment: '条目1' }] },
    ]);
    const result = await getLorebookEntriesByNames_ACU(['书A']);
    expect(result['书A']).toHaveLength(1);
  });

  it('fallback 路径复用 gateway 的条目归一化契约', async () => {
    mockIsWorldbookApiAvailable.mockReturnValue(false);
    const sourceEntries = [{ uid: 1, comment: 2024 }];
    mockGwGetWorldBooks.mockResolvedValue([{ name: '书A', entries: sourceEntries }]);
    mockNormalizeLorebookEntriesForRead.mockReturnValue([{ uid: 1, comment: '' }]);

    const result = await getLorebookEntriesByNames_ACU(['书A']);

    expect(mockNormalizeLorebookEntriesForRead).toHaveBeenCalledWith(sourceEntries, '书A');
    expect(result['书A']).toEqual([{ uid: 1, comment: '', book: '书A' }]);
  });

  it('Unicode 等价名称使用宿主真实名称读取，同时保留请求名称作为返回键', async () => {
    mockListLorebooks.mockResolvedValue(['AB\u200BC']);
    mockGwGetLorebookEntries.mockResolvedValue([{ uid: 1 }]);

    const result = await getLorebookEntriesByNames_ACU(['ＡＢＣ']);

    expect(mockGwGetLorebookEntries).toHaveBeenCalledWith('AB\u200BC');
    expect(result['ＡＢＣ']).toEqual([{ uid: 1, book: 'AB\u200BC' }]);
  });

  it('fallback 路径按 Unicode 等价名称匹配宿主真实对象', async () => {
    mockIsWorldbookApiAvailable.mockReturnValue(false);
    mockListLorebooks.mockResolvedValue(['AB\u200BC']);
    mockGwGetWorldBooks.mockResolvedValue([
      { name: 'AB\u200BC', entries: [{ uid: 1, comment: '条目1' }] },
    ]);

    const result = await getLorebookEntriesByNames_ACU(['ＡＢＣ']);

    expect(result['ＡＢＣ']).toEqual([{ uid: 1, comment: '条目1', book: 'AB\u200BC' }]);
  });

  it('Unicode 归一化后存在歧义时拒绝读取', async () => {
    mockListLorebooks.mockResolvedValue(['ABC', 'ＡＢＣ\u200B']);
    const result = await getLorebookEntriesByNames_ACU(['ＡＢＣ']);
    expect(result['ＡＢＣ']).toEqual([]);
    expect(mockGwGetLorebookEntries).not.toHaveBeenCalled();
  });
});

describe('getLorebookEntriesStrict_ACU', () => {
  it('trusted_direct 直接读取受信名称，不调用非原子列表预检', async () => {
    mockListLorebooks.mockRejectedValue(new Error('列表暂不可用'));
    mockGwGetLorebookEntries.mockResolvedValue([{ uid: 1, content: '正文' }]);

    const result = await getLorebookEntriesStrict_ACU(['角色主书'], {
      source: 'plot_runtime',
      validationPolicy: 'trusted_direct',
      runId: 'run-1',
    });

    expect(mockListLorebooks).not.toHaveBeenCalled();
    expect(mockGwGetLorebookEntries).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('success');
    expect(result.entriesByBook['角色主书']).toEqual([{ uid: 1, content: '正文', book: '角色主书' }]);
  });

  it('validate_list 对不存在的手动选择返回 invalid_selection，不读取宿主条目', async () => {
    mockListLorebooks.mockResolvedValue(['存在的书']);

    const result = await getLorebookEntriesStrict_ACU(['残留配置书'], {
      source: 'manual_validation',
      validationPolicy: 'validate_list',
      runId: 'run-1',
    });

    expect(result.status).toBe('invalid_selection');
    expect(result.invalidBookNames).toEqual(['残留配置书']);
    expect(mockGwGetLorebookEntries).not.toHaveBeenCalled();
  });

  it('validate_list 将等价 Unicode 名称解析为宿主真实名称后读取', async () => {
    mockListLorebooks.mockResolvedValue(['AB\u200BC']);
    mockGwGetLorebookEntries.mockResolvedValue([{ uid: 1, content: '正文' }]);

    const result = await getLorebookEntriesStrict_ACU(['ＡＢＣ'], {
      source: 'manual_validation', validationPolicy: 'validate_list', runId: 'run-unicode-name',
    });

    expect(result.status).toBe('success');
    expect(mockGwGetLorebookEntries).toHaveBeenCalledWith('AB\u200BC');
    expect(result.entriesByBook['AB\u200BC']).toEqual([{ uid: 1, content: '正文', book: 'AB\u200BC' }]);
  });

  it('同一 context 内同名宿主读取合并 in-flight Promise，并向调用方提供独立快照', async () => {
    let releaseRead: (() => void) | undefined;
    mockGwGetLorebookEntries.mockImplementation(() => new Promise(resolve => {
      releaseRead = () => resolve([{ uid: 7, content: '原始正文' }]);
    }));
    const context = { bookEntriesPromises: new Map<string, Promise<any>>(), runId: 'run-1' };

    const first = getLorebookEntriesStrict_ACU(['剧情书'], {
      source: 'plot_runtime', validationPolicy: 'trusted_direct', runId: 'run-1', context,
    });
    const second = getLorebookEntriesStrict_ACU(['剧情书'], {
      source: 'agent_runtime', validationPolicy: 'trusted_direct', runId: 'run-1', context,
    });
    await vi.waitFor(() => expect(releaseRead).toBeTypeOf('function'));
    releaseRead!();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(mockGwGetLorebookEntries).toHaveBeenCalledTimes(1);
    firstResult.entriesByBook['剧情书'][0].content = '派生修改';
    expect(secondResult.entriesByBook['剧情书'][0].content).toBe('原始正文');
  });

  it('同一 context 内并发 enumerate_all 只枚举一次且每本书只读取一次', async () => {
    mockListLorebooks.mockResolvedValue(['书A', '书B']);
    mockGwGetLorebookEntries.mockImplementation(async (bookName: string) => [{ uid: bookName, content: `${bookName}正文` }]);
    let availableBookNamesPromise: Promise<string[]> | undefined;
    const context = {
      bookEntriesPromises: new Map<string, Promise<any>>(),
      runId: 'run-enumerate',
      get availableBookNamesPromise() {
        if (!availableBookNamesPromise) availableBookNamesPromise = mockListLorebooks();
        return availableBookNamesPromise;
      },
    };

    const [first, second] = await Promise.all([
      getLorebookEntriesStrict_ACU([], {
        source: 'plot_table_index', validationPolicy: 'enumerate_all', runId: 'run-enumerate', context,
      }),
      getLorebookEntriesStrict_ACU([], {
        source: 'plot_table_index', validationPolicy: 'enumerate_all', runId: 'run-enumerate', context,
      }),
    ]);

    expect(mockListLorebooks).toHaveBeenCalledTimes(1);
    expect(mockGwGetLorebookEntries).toHaveBeenCalledTimes(2);
    expect(mockGwGetLorebookEntries).toHaveBeenCalledWith('书A');
    expect(mockGwGetLorebookEntries).toHaveBeenCalledWith('书B');
    first.entriesByBook['书A'][0].content = '派生修改';
    expect(second.entriesByBook['书A'][0].content).toBe('书A正文');
  });

  it('plot_table_index 会隔离列表中的明确 not-found 幽灵书，并保留有效书索引', async () => {
    mockListLorebooks.mockResolvedValue(['有效书', '幽灵书']);
    mockGwGetLorebookEntries.mockImplementation(async (bookName: string) => {
      if (bookName === '幽灵书') throw new Error("Lorebook '幽灵书' not found");
      return [{ uid: 1, content: '有效正文' }];
    });

    const result = await getLorebookEntriesStrict_ACU([], {
      source: 'plot_table_index', validationPolicy: 'enumerate_all', runId: 'run-ghost', notFoundPolicy: 'isolate_stale',
    });

    expect(result.status).toBe('success');
    expect(result.entriesByBook).toEqual({ 有效书: [{ uid: 1, content: '有效正文', book: '有效书' }] });
    expect(result.staleBookNames).toEqual(['幽灵书']);
    expect(result.failedBookNames).toEqual([]);
    expect(mockGwGetLorebookEntries).toHaveBeenCalledTimes(2);
  });

  it('plot_table_index 会隔离中文明确不存在的幽灵书', async () => {
    mockListLorebooks.mockResolvedValue(['有效书', '幽灵书']);
    mockGwGetLorebookEntries.mockImplementation(async (bookName: string) => {
      if (bookName === '幽灵书') throw new Error("世界书 '幽灵书' 不存在");
      return [{ uid: 1, content: '有效正文' }];
    });

    const result = await getLorebookEntriesStrict_ACU([], {
      source: 'plot_table_index', validationPolicy: 'enumerate_all', runId: 'run-chinese-ghost', notFoundPolicy: 'isolate_stale',
    });

    expect(result.status).toBe('success');
    expect(result.entriesByBook).toEqual({ 有效书: [{ uid: 1, content: '有效正文', book: '有效书' }] });
    expect(result.staleBookNames).toEqual(['幽灵书']);
    expect(result.failedBookNames).toEqual([]);
  });

  it('plot_table_index 在全部枚举项均为明确 not-found 时返回空索引', async () => {
    mockListLorebooks.mockResolvedValue(['幽灵书A', '幽灵书B']);
    mockGwGetLorebookEntries.mockImplementation(async (bookName: string) => {
      throw new Error(`Lorebook '${bookName}' does not exist`);
    });

    const result = await getLorebookEntriesStrict_ACU([], {
      source: 'plot_table_index', validationPolicy: 'enumerate_all', runId: 'run-all-ghosts', notFoundPolicy: 'isolate_stale',
    });

    expect(result.status).toBe('success');
    expect(result.entriesByBook).toEqual({});
    expect(result.staleBookNames).toEqual(['幽灵书A', '幽灵书B']);
    expect(result.failedBookNames).toEqual([]);
  });

  it.each([
    ['权限错误', new Error('Lorebook permission denied')],
    ['凭据缺失', new Error('Lorebook credentials missing')],
    ['权限范围缺失', new Error('Lorebook permission scope missing')],
    ['响应字段缺失', new Error('Lorebook response missing required field')],
    ['凭据 not-found', new Error('Lorebook credentials not found')],
    ['权限范围 not-found', new Error('Lorebook permission scope not found')],
    ['响应字段 not-found', new Error('Lorebook response field not found')],
    ['前置权限缺失', new Error('Missing permission for Lorebook')],
    ['网络错误', new Error('Lorebook network request failed')],
    ['类型错误', new TypeError('Lorebook response malformed')],
    ['非 Error 拒绝值', { reason: 'Lorebook unavailable' }],
    ['空拒绝值', undefined],
  ])('plot_table_index 不会将%s误隔离为幽灵书', async (_label, error) => {
    mockListLorebooks.mockResolvedValue(['故障书']);
    mockGwGetLorebookEntries.mockRejectedValue(error);

    const result = await getLorebookEntriesStrict_ACU([], {
      source: 'plot_table_index', validationPolicy: 'enumerate_all', runId: 'run-non-ghost-failure',
    });

    expect(result.status).toBe('read_failed');
    expect(result.entriesByBook).toEqual({});
    expect(result.staleBookNames).toEqual([]);
    expect(result.failedBookNames).toEqual(['故障书']);
  });

  it('plot_table_index 遇到未知条目读取失败时仍严格失败', async () => {
    mockListLorebooks.mockResolvedValue(['有效书', '故障书']);
    mockGwGetLorebookEntries.mockImplementation(async (bookName: string) => {
      if (bookName === '故障书') throw new TypeError('host response malformed');
      return [{ uid: 1, content: '有效正文' }];
    });

    const result = await getLorebookEntriesStrict_ACU([], {
      source: 'plot_table_index', validationPolicy: 'enumerate_all', runId: 'run-unknown-failure',
    });

    expect(result.status).toBe('read_failed');
    expect(result.entriesByBook).toEqual({ 有效书: [{ uid: 1, content: '有效正文', book: '有效书' }] });
    expect(result.staleBookNames).toEqual([]);
    expect(result.failedBookNames).toEqual(['故障书']);
  });

  it('character 与 manual 路径不会隔离列表内的明确 not-found 幽灵书', async () => {
    mockListLorebooks.mockResolvedValue(['幽灵书']);
    mockGwGetLorebookEntries.mockRejectedValue(new Error("世界书 '幽灵书' 不存在"));

    const [characterResult, manualResult] = await Promise.all([
      getLorebookEntriesStrict_ACU(['幽灵书'], {
        source: 'plot_runtime', validationPolicy: 'trusted_direct', runId: 'run-character-ghost',
      }),
      getLorebookEntriesStrict_ACU(['幽灵书'], {
        source: 'manual_validation', validationPolicy: 'validate_list', runId: 'run-manual-ghost',
      }),
    ]);

    expect(characterResult.status).toBe('read_failed');
    expect(characterResult.staleBookNames).toEqual([]);
    expect(manualResult.status).toBe('read_failed');
    expect(manualResult.staleBookNames).toEqual([]);
  });

  it('严格读取失败保留逐书安全分类，并能生成不含宿主原始异常的结构化摘要', async () => {
    const sensitiveText = '宿主原始错误、条目正文和提示词不得进入严格读取摘要';
    mockGwGetLorebookEntries
      .mockResolvedValueOnce([{ uid: 1, content: '有效正文' }])
      .mockRejectedValueOnce(new Error(`Lorebook '失效附加书' not found: ${sensitiveText}`));

    const result = await getLorebookEntriesStrict_ACU(['有效主书', '失效附加书'], {
      source: 'plot_runtime', validationPolicy: 'trusted_direct', runId: 'run-character-diagnostic',
    });

    expect(result.status).toBe('read_failed');
    expect(result.entriesByBook).toEqual({ 有效主书: [{ uid: 1, content: '有效正文', book: '有效主书' }] });
    expect(result.failedBookNames).toEqual(['失效附加书']);
    expect(result.failedBooks).toEqual([{ bookName: '失效附加书', errorCategory: 'lorebook_not_found' }]);

    const summary = summarizeStrictLorebookReadError_ACU(createStrictLorebookReadError_ACU(result));
    expect(summary).toEqual({
      category: 'strict_lorebook_read',
      status: 'read_failed',
      source: 'plot_runtime',
      validationPolicy: 'trusted_direct',
      runId: 'run-character-diagnostic',
      failedCount: 1,
      failedBookNames: ['失效附加书'],
      errorCategories: ['lorebook_not_found'],
      invalidCount: 0,
      staleCount: 0,
    });
    expect(JSON.stringify(summary)).not.toContain(sensitiveText);
  });

  it('同名但缺少结构化字段的错误不会被误识别或导致摘要二次失败', () => {
    const lookalike = Object.assign(new Error('untrusted host error'), {
      name: 'StrictLorebookReadError_ACU',
    });

    expect(summarizeStrictLorebookReadError_ACU(lookalike)).toBeNull();
  });

  it('不同 context 的 enumerate_all 不复用上一轮列表或条目 Promise', async () => {
    mockListLorebooks.mockResolvedValue(['书A']);
    mockGwGetLorebookEntries.mockResolvedValue([{ uid: 1, content: '正文' }]);
    const createContext = (runId: string) => {
      let availableBookNamesPromise: Promise<string[]> | undefined;
      return {
        bookEntriesPromises: new Map<string, Promise<any>>(),
        runId,
        get availableBookNamesPromise() {
          if (!availableBookNamesPromise) availableBookNamesPromise = mockListLorebooks();
          return availableBookNamesPromise;
        },
      };
    };

    await getLorebookEntriesStrict_ACU([], {
      source: 'plot_table_index', validationPolicy: 'enumerate_all', runId: 'run-1', context: createContext('run-1'),
    });
    await getLorebookEntriesStrict_ACU([], {
      source: 'plot_table_index', validationPolicy: 'enumerate_all', runId: 'run-2', context: createContext('run-2'),
    });

    expect(mockListLorebooks).toHaveBeenCalledTimes(2);
    expect(mockGwGetLorebookEntries).toHaveBeenCalledTimes(2);
  });

  it('宿主读取 reject 后优先报告 aborted 而不是 read_failed', async () => {
    let aborted = false;
    mockListLorebooks.mockResolvedValue(['幽灵书']);
    mockGwGetLorebookEntries.mockImplementation(async () => {
      aborted = true;
      throw new Error("Lorebook '幽灵书' not found");
    });

    const result = await getLorebookEntriesStrict_ACU([], {
      source: 'plot_table_index', validationPolicy: 'enumerate_all', runId: 'run-abort',
      context: { bookEntriesPromises: new Map<string, Promise<any>>(), runId: 'run-abort', isAborted: () => aborted },
    });

    expect(result.status).toBe('aborted');
    expect(result.failedBookNames).toEqual([]);
    expect(result.failedBooks).toEqual([]);
  });

  it('宿主读取 reject 后在作用域变化时报告 scope_changed 而不是 read_failed', async () => {
    let active = true;
    mockListLorebooks.mockResolvedValue(['幽灵书']);
    mockGwGetLorebookEntries.mockImplementation(async () => {
      active = false;
      throw new Error("Lorebook '幽灵书' not found");
    });

    const result = await getLorebookEntriesStrict_ACU([], {
      source: 'plot_table_index', validationPolicy: 'enumerate_all', runId: 'run-scope',
      context: { bookEntriesPromises: new Map<string, Promise<any>>(), runId: 'run-scope', isActive: () => active },
    });

    expect(result.status).toBe('scope_changed');
    expect(result.failedBookNames).toEqual([]);
    expect(result.failedBooks).toEqual([]);
  });

  it('并发读取中 Abort 覆盖先完成的 scope_changed', async () => {
    let active = true;
    let aborted = false;
    let releaseFirstRead: (() => void) | undefined;
    let releaseSecondRead: (() => void) | undefined;
    let startedReads = 0;
    let markBothReadsStarted: (() => void) | undefined;
    const bothReadsStarted = new Promise<void>(resolve => {
      markBothReadsStarted = resolve;
    });
    mockListLorebooks.mockResolvedValue(['先完成书', '后完成书']);
    mockGwGetLorebookEntries.mockImplementation((bookName: string) => new Promise((_resolve, reject) => {
      startedReads += 1;
      if (startedReads === 2) markBothReadsStarted?.();
      if (bookName === '先完成书') {
        releaseFirstRead = () => {
          active = false;
          reject(new Error("Lorebook '先完成书' not found"));
        };
        return;
      }
      releaseSecondRead = () => {
        aborted = true;
        reject(new Error("Lorebook '后完成书' not found"));
      };
    }));

    const resultPromise = getLorebookEntriesStrict_ACU([], {
      source: 'plot_table_index', validationPolicy: 'enumerate_all', runId: 'run-concurrent-priority',
      context: {
        bookEntriesPromises: new Map<string, Promise<any>>(),
        runId: 'run-concurrent-priority',
        isActive: () => active,
        isAborted: () => aborted,
      },
    });
    await bothReadsStarted;
    releaseFirstRead?.();
    await Promise.resolve();
    releaseSecondRead?.();

    const result = await resultPromise;
    expect(result.status).toBe('aborted');
    expect(result.entriesByBook).toEqual({});
    expect(result.staleBookNames).toEqual([]);
    expect(result.failedBookNames).toEqual([]);
  });

  it('真实 Plot context 在多表 scope 中只枚举一次且每本书只读取一次', async () => {
    mockListLorebooks.mockResolvedValue(['书A', '书B']);
    mockGwGetLorebookEntries.mockImplementation(async (bookName: string) => (
      bookName === '书A'
        ? [{ uid: 1, comment: 'TavernDB-ACU-CustomExport-关系档案' }]
        : [{ uid: 2, comment: 'TavernDB-ACU-CustomExport-道具档案' }]
    ));
    const tableData = {
      relation_sheet: { name: '关系档案', exportConfig: { entryName: '关系档案' } },
      item_sheet: { name: '道具档案', exportConfig: { entryName: '道具档案' } },
    };
    const context = createPlotWorldbookReadContext_ACU({ resolveCharacterLorebookNames: async () => ['书A', '书B'] });

    const [index, relationKeys, itemKeys, repeatedRelationKeys] = await Promise.all([
      context.tableWorldbookIndexPromise,
      context.getTableWorldbookScopedKeys('关系档案', tableData),
      context.getTableWorldbookScopedKeys('道具档案', tableData),
      context.getTableWorldbookScopedKeys('关系档案', tableData),
    ]);

    expect(mockListLorebooks).toHaveBeenCalledTimes(1);
    expect(mockGwGetLorebookEntries).toHaveBeenCalledTimes(2);
    expect(mockGwGetLorebookEntries).toHaveBeenCalledWith('书A');
    expect(mockGwGetLorebookEntries).toHaveBeenCalledWith('书B');
    expect(index.entriesByBook).toEqual(expect.objectContaining({ 书A: expect.any(Array), 书B: expect.any(Array) }));
    expect(relationKeys).toEqual(new Set(['书A\u00001']));
    expect(itemKeys).toEqual(new Set(['书B\u00002']));
    expect(repeatedRelationKeys).toBe(relationKeys);
  });

  it('T8-2 表名 resolver 观测：候选 index 懒建一次，多 token 复用（indexBuildCount=1）', async () => {
    mockListLorebooks.mockResolvedValue(['书A', '书B']);
    mockGwGetLorebookEntries.mockImplementation(async (bookName: string) => (
      bookName === '书A'
        ? [{ uid: 1, comment: 'TavernDB-ACU-CustomExport-关系档案' }]
        : [{ uid: 2, comment: 'TavernDB-ACU-CustomExport-道具档案' }]
    ));
    const tableData = {
      relation_sheet: { name: '关系档案', exportConfig: { entryName: '关系档案' } },
      item_sheet: { name: '道具档案', exportConfig: { entryName: '道具档案' } },
    };
    const context = createPlotWorldbookReadContext_ACU({ resolveCharacterLorebookNames: async () => ['书A', '书B'] });

    expect(context.tableIndexBuildCount).toBe(0);
    await context.tableWorldbookIndexPromise;
    expect(context.tableIndexBuildCount).toBe(1);
    await context.getTableWorldbookScopedKeys('关系档案', tableData);
    await context.getTableWorldbookScopedKeys('道具档案', tableData);
    // 懒建语义：index 只构建一次，多个 token 复用；物理读取仍只发生一次/书。
    expect(context.tableIndexBuildCount).toBe(1);
    expect(mockGwGetLorebookEntries).toHaveBeenCalledTimes(2);
  });

  it('真实 Plot context 按 tableData 对象和 run 隔离表 scope 与 gateway 读取', async () => {
    mockListLorebooks.mockResolvedValue(['书A']);
    mockGwGetLorebookEntries.mockResolvedValue([{ uid: 1, comment: 'TavernDB-ACU-CustomExport-关系档案' }]);
    const firstTableData = { relation_sheet: { name: '关系档案', exportConfig: { entryName: '关系档案' } } };
    const secondTableData = { relation_sheet: { name: '关系档案', exportConfig: { entryName: '关系档案-另一配置' } } };
    const firstContext = createPlotWorldbookReadContext_ACU({ resolveCharacterLorebookNames: async () => ['书A'] });

    const firstKeys = await firstContext.getTableWorldbookScopedKeys('关系档案', firstTableData);
    const secondKeys = await firstContext.getTableWorldbookScopedKeys('关系档案', secondTableData);
    expect(firstKeys).toEqual(new Set(['书A\u00001']));
    expect(secondKeys).toEqual(new Set());
    expect(secondKeys).not.toBe(firstKeys);
    expect(mockListLorebooks).toHaveBeenCalledTimes(1);
    expect(mockGwGetLorebookEntries).toHaveBeenCalledTimes(1);

    firstContext.dispose();
    const secondContext = createPlotWorldbookReadContext_ACU({ resolveCharacterLorebookNames: async () => ['书A'] });
    const secondRunKeys = await secondContext.getTableWorldbookScopedKeys('关系档案', firstTableData);

    expect(secondRunKeys).toEqual(new Set(['书A\u00001']));
    expect(mockListLorebooks).toHaveBeenCalledTimes(2);
    expect(mockGwGetLorebookEntries).toHaveBeenCalledTimes(2);
  });

  it('真实 Plot context dispose 后飞行索引以 aborted 失败，不能返回正文快照', async () => {
    let releaseEntries: (() => void) | undefined;
    let markGatewayStarted: (() => void) | undefined;
    const gatewayStarted = new Promise<void>(resolve => {
      markGatewayStarted = resolve;
    });
    mockListLorebooks.mockResolvedValue(['书A']);
    mockGwGetLorebookEntries.mockImplementation(() => new Promise(resolve => {
      markGatewayStarted?.();
      releaseEntries = () => resolve([{ uid: 1, content: '不得泄漏' }]);
    }));
    const context = createPlotWorldbookReadContext_ACU({ resolveCharacterLorebookNames: async () => ['书A'] });
    const indexPromise = context.tableWorldbookIndexPromise;
    await gatewayStarted;
    context.dispose();
    releaseEntries?.();

    await expect(indexPromise).rejects.toThrow('StrictLorebookRead:aborted');
    expect(mockGwGetLorebookEntries).toHaveBeenCalledTimes(1);
  });

  it('宿主 reject 后 abort 与 scope change 同时发生时优先报告 aborted', async () => {
    let aborted = false;
    let active = true;
    mockGwGetLorebookEntries.mockImplementation(async () => {
      aborted = true;
      active = false;
      throw new Error('host read failed');
    });

    const result = await getLorebookEntriesStrict_ACU(['剧情书'], {
      source: 'plot_runtime', validationPolicy: 'trusted_direct', runId: 'run-priority',
      context: {
        bookEntriesPromises: new Map<string, Promise<any>>(),
        runId: 'run-priority',
        isAborted: () => aborted,
        isActive: () => active,
      },
    });

    expect(result.status).toBe('aborted');
    expect(result.failedBookNames).toEqual([]);
  });

  it('受信 runtime 读取失败返回 read_failed 而不是伪装为空数组', async () => {
    mockGwGetLorebookEntries.mockRejectedValue(new Error('host read failed'));

    const result = await getLorebookEntriesStrict_ACU(['剧情书'], {
      source: 'plot_runtime', validationPolicy: 'trusted_direct', runId: 'run-1',
    });

    expect(result.status).toBe('read_failed');
    expect(result.failedBookNames).toEqual(['剧情书']);
    expect(result.entriesByBook).toEqual({});
  });
});

describe('getWorldBooks_ACU', () => {
  it('返回世界书列表及其条目', async () => {
    mockListLorebooks.mockResolvedValue(['书A']);
    mockGwGetLorebookEntries.mockResolvedValue([{ uid: 1, comment: '条目1' }]);
    const result = await getWorldBooks_ACU();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('书A');
    expect(result[0].entries).toHaveLength(1);
  });

  it('无世界书时返回空数组', async () => {
    mockListLorebooks.mockResolvedValue([]);
    const result = await getWorldBooks_ACU();
    expect(result).toEqual([]);
  });
});

describe('loadAllChatMessages_ACU', () => {
  it('加载聊天消息', async () => {
    mockGetChatLength.mockReturnValue(3);
    mockGetChatMessages.mockResolvedValue([
      { message: '消息1' },
      { message: '消息2' },
      { message: '消息3' },
    ]);
    await loadAllChatMessages_ACU();
    expect(mockSetAllChatMessages).toHaveBeenCalled();
    const callArg = mockSetAllChatMessages.mock.calls[0][0];
    expect(callArg).toHaveLength(3);
  });

  it('API 未就绪时不加载', async () => {
    mockCoreApisAreReady.value = false;
    await loadAllChatMessages_ACU();
    expect(mockGetChatLength).not.toHaveBeenCalled();
  });

  it('世界书 API 不可用时不加载', async () => {
    mockIsWorldbookApiAvailable.mockReturnValue(false);
    await loadAllChatMessages_ACU();
    expect(mockGetChatLength).not.toHaveBeenCalled();
  });

  it('无消息时设为空数组', async () => {
    mockGetChatLength.mockReturnValue(0);
    await loadAllChatMessages_ACU();
    expect(mockSetAllChatMessages).toHaveBeenCalledWith([]);
  });

  it('获取失败时设为空数组', async () => {
    mockGetChatLength.mockReturnValue(5);
    mockGetChatMessages.mockRejectedValue(new Error('网络错误'));
    await loadAllChatMessages_ACU();
    expect(mockSetAllChatMessages).toHaveBeenCalledWith([]);
  });
});

describe('deleteAllGeneratedEntries_ACU', () => {
  it('删除匹配基础前缀的条目', async () => {
    mockGwGetLorebookEntries.mockResolvedValue([
      { uid: 1, comment: 'TavernDB-ACU-ReadableDataTable' },
      { uid: 2, comment: 'TavernDB-ACU-OutlineTable' },
      { uid: 3, comment: '无关条目' },
    ]);
    await deleteAllGeneratedEntries_ACU();
    expect(mockGwDeleteLorebookEntries).toHaveBeenCalledWith('test-lorebook', [1, 2]);
  });

  it('不删除外部导入条目', async () => {
    mockGwGetLorebookEntries.mockResolvedValue([
      { uid: 1, comment: '外部导入-表格A' },
      { uid: 2, comment: 'TavernDB-ACU-ReadableDataTable' },
    ]);
    await deleteAllGeneratedEntries_ACU();
    expect(mockGwDeleteLorebookEntries).toHaveBeenCalledWith('test-lorebook', [2]);
  });

  it('隔离模式下只删除匹配前缀的条目', async () => {
    mockSettings.dataIsolationEnabled = true;
    mockSettings.dataIsolationCode = 'test';
    mockGetIsolationPrefix.mockReturnValue('ACU-[test]-');
    mockGwGetLorebookEntries.mockResolvedValue([
      { uid: 1, comment: 'ACU-[test]-TavernDB-ACU-ReadableDataTable' },
      { uid: 2, comment: 'ACU-[other]-TavernDB-ACU-ReadableDataTable' },
      { uid: 3, comment: 'TavernDB-ACU-ReadableDataTable' },
    ]);
    await deleteAllGeneratedEntries_ACU();
    expect(mockGwDeleteLorebookEntries).toHaveBeenCalledWith('test-lorebook', [1]);
  });

  it('隔离模式下不删除当前隔离前缀内的外部导入条目', async () => {
    mockSettings.dataIsolationEnabled = true;
    mockSettings.dataIsolationCode = 'test';
    mockGetIsolationPrefix.mockReturnValue('ACU-[test]-');
    mockGwGetLorebookEntries.mockResolvedValue([
      { uid: 1, comment: 'ACU-[test]-外部导入-TavernDB-ACU-ReadableDataTable' },
      { uid: 2, comment: 'ACU-[test]-外部导入-TavernDB-ACU-WrapperStart' },
      { uid: 3, comment: 'ACU-[test]-TavernDB-ACU-ReadableDataTable' },
      { uid: 4, comment: 'ACU-[other]-TavernDB-ACU-ReadableDataTable' },
    ]);
    await deleteAllGeneratedEntries_ACU();
    expect(mockGwDeleteLorebookEntries).toHaveBeenCalledWith('test-lorebook', [3]);
  });

  it('使用稳定导入前缀保护非默认前缀的已知自定义条目', async () => {
    mockGetImportStablePrefix.mockReturnValue('Imported-');
    mockSettings.knownCustomEntryNames = ['Imported-TavernDB-ACU-CustomExport-表A'];
    mockGwGetLorebookEntries.mockResolvedValue([
      { uid: 1, comment: 'Imported-TavernDB-ACU-CustomExport-表A' },
      { uid: 2, comment: 'TavernDB-ACU-ReadableDataTable' },
    ]);
    await deleteAllGeneratedEntries_ACU();
    expect(mockGwDeleteLorebookEntries).toHaveBeenCalledWith('test-lorebook', [2]);
  });

  it('无 lorebook 时直接返回', async () => {
    mockGetInjectionTargetLorebook.mockResolvedValue(null);
    await deleteAllGeneratedEntries_ACU();
    expect(mockGwGetLorebookEntries).not.toHaveBeenCalled();
  });

  it('使用指定的 targetLorebook', async () => {
    mockGwGetLorebookEntries.mockResolvedValue([
      { uid: 1, comment: 'TavernDB-ACU-ReadableDataTable' },
    ]);
    await deleteAllGeneratedEntries_ACU('custom-lorebook');
    expect(mockGwGetLorebookEntries).toHaveBeenCalledWith('custom-lorebook');
    expect(mockGwDeleteLorebookEntries).toHaveBeenCalledWith('custom-lorebook', [1]);
  });

  it('删除后清理 knownCustomEntryNames', async () => {
    mockSettings.knownCustomEntryNames = ['TavernDB-ACU-CustomExport-表A', 'ACU-[iso]-条目B'];
    mockGwGetLorebookEntries.mockResolvedValue([
      { uid: 1, comment: 'TavernDB-ACU-ReadableDataTable' },
    ]);
    await deleteAllGeneratedEntries_ACU();
    // 非隔离模式下只保留带 ACU-[ 前缀的
    expect(mockSettings.knownCustomEntryNames).toEqual(['ACU-[iso]-条目B']);
  });

  it('非隔离模式下不删除 ACU-[ 开头的条目', async () => {
    mockGwGetLorebookEntries.mockResolvedValue([
      { uid: 1, comment: 'ACU-[test]-TavernDB-ACU-ReadableDataTable' },
    ]);
    await deleteAllGeneratedEntries_ACU();
    expect(mockGwDeleteLorebookEntries).not.toHaveBeenCalled();
  });
});

describe('refreshMergedDataAndNotify_ACU', () => {
  it('合并数据并更新世界书', async () => {
    const mergedData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_0: { name: '测试表', content: [['', '列1'], ['', '值1']] },
    };
    mockMergeAllIndependentTables.mockResolvedValue(mergedData);
    mockGetSortedSheetKeys.mockReturnValue(['sheet_0']);
    mockReorderDataBySheetKeys.mockReturnValue(mergedData);

    const result = await refreshMergedDataAndNotify_ACU();
    expect(mockSetCurrentJsonTableData).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('遇到空 row_id 和数值业务列时清理坏行且不调用 startsWith 造成崩溃', async () => {
    const mergedData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_0: {
        name: '测试表',
        content: [
          ['row_id', '数值'],
          [null, 15],
          ['2', 30],
          ['3', 'AM-有效记录'],
        ],
      },
    };
    mockMergeAllIndependentTables.mockResolvedValue(mergedData);
    mockGetSortedSheetKeys.mockReturnValue(['sheet_0']);
    mockReorderDataBySheetKeys.mockImplementation((data: any) => data);

    const result = await refreshMergedDataAndNotify_ACU();

    expect(mergedData.sheet_0.content).toEqual([
      ['row_id', '数值'],
      ['2', 30],
      ['3', 'AM-有效记录'],
    ]);
    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('缺少 row_id'));
    expect(mockPersistNullRowCleanupShards).toHaveBeenCalledWith(expect.objectContaining({
      sheetDataByKey: expect.objectContaining({ sheet_0: expect.objectContaining({ content: [['row_id', '数值'], ['2', 30], ['3', 'AM-有效记录']] }) }),
    }));
    expect(result).toMatchObject({ removedNullRowCount: 1, nullRowCleanupPersisted: 'persisted', nullRowCleanupMessageIndex: 3, degraded: false });
  });

  it('刷新时迁移纪要历史尾标记状态并保持 canonical 等宽', async () => {
    const mergedData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_3NoMc1wI: {
        name: '纪要表',
        content: [
          ['row_id', '内容'],
          ['1', '历史合并纪要', 'auto_merged'],
          ['2', 'AM-普通纪要'],
        ],
      },
    };
    mockMergeAllIndependentTables.mockResolvedValue(mergedData);
    mockGetSortedSheetKeys.mockReturnValue(['sheet_3NoMc1wI']);
    mockReorderDataBySheetKeys.mockImplementation((data: any) => data);

    const result = await refreshMergedDataAndNotify_ACU();

    expect(mockSettings.autoMergedOrder).toEqual({ sheet_3NoMc1wI: ['1'] });
    expect(mockSaveSettings).toHaveBeenCalledTimes(1);
    expect(mergedData.sheet_3NoMc1wI.content).toEqual([
      ['row_id', '内容'],
      ['1', '历史合并纪要'],
      ['2', 'AM-普通纪要'],
    ]);
    expect(result).toMatchObject({ integrityFixed: true, canonicalIssues: [], degraded: false });
  });

  it('刷新不修复非精确历史尾标记，保留 canonical 拒绝证据', async () => {
    const mergedData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_3NoMc1wI: { name: '纪要表', content: [['row_id', '内容'], ['1', '坏行', 'manual'], ['2', '更坏', 'auto_merged', 'extra']] },
    };
    mockMergeAllIndependentTables.mockResolvedValue(mergedData);
    mockGetSortedSheetKeys.mockReturnValue(['sheet_3NoMc1wI']);
    mockReorderDataBySheetKeys.mockImplementation((data: any) => data);

    const result = await refreshMergedDataAndNotify_ACU();

    expect(mockSettings.autoMergedOrder).toBeUndefined();
    expect(mockSaveSettings).not.toHaveBeenCalled();
    expect(mergedData.sheet_3NoMc1wI.content).toEqual([['row_id', '内容'], ['1', '坏行', 'manual'], ['2', '更坏', 'auto_merged', 'extra']]);
    expect(result).toMatchObject({ canonicalIssues: [], degraded: false });
  });


  it('存在无法自动合并的 canonical issue 时只清理内存并跳过持久化', async () => {
    const mergedData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_0: { name: '测试表', content: [['row_id', '名称'], [null, '删除'], ['1', '甲'], ['1', '乙']] },
    };
    const staleReplaySnapshot = JSON.parse(JSON.stringify(mergedData));
    mockMergeAllIndependentTables
      .mockResolvedValueOnce(mergedData)
      .mockResolvedValueOnce(staleReplaySnapshot);
    mockGetSortedSheetKeys.mockReturnValue(['sheet_0']);
    mockReorderDataBySheetKeys.mockImplementation((data: any) => data);

    const result = await refreshMergedDataAndNotify_ACU();

    expect(mockPersistNullRowCleanupShards).not.toHaveBeenCalled();
    expect(mockMergeAllIndependentTables).toHaveBeenCalledTimes(1);
    expect(mockFormatJsonToReadable).toHaveBeenCalledWith(expect.objectContaining({
      sheet_0: expect.objectContaining({ content: [['row_id', '名称'], ['1', '甲'], ['1', '乙']] }),
    }));
    expect(result).toMatchObject({
      removedNullRowCount: 1,
      canonicalIssues: [expect.objectContaining({ reason: 'duplicate_row_id' })],
      nullRowCleanupPersisted: 'skipped_invalid_data',
      degraded: true,
    });
  });

  it('自愈持久化失败不阻断内存加载，并明确标记 degraded', async () => {
    const dirtyHistorySnapshot = { mate: { type: 'chatSheets', version: 1 }, sheet_0: { name: '测试表', content: [['row_id', '名称'], [null, '删除'], ['1', '保留']] } };
    const staleReplaySnapshot = JSON.parse(JSON.stringify(dirtyHistorySnapshot));
    mockMergeAllIndependentTables
      .mockResolvedValueOnce(dirtyHistorySnapshot)
      .mockResolvedValueOnce(staleReplaySnapshot);
    mockGetSortedSheetKeys.mockReturnValue(['sheet_0']);
    mockReorderDataBySheetKeys.mockImplementation((data: any) => data);
    mockPersistNullRowCleanupShards.mockResolvedValueOnce({ status: 'failed', error: 'host save failed' });

    const result = await refreshMergedDataAndNotify_ACU();

    expect(mockMergeAllIndependentTables).toHaveBeenCalledTimes(1);
    expect(mockFormatJsonToReadable).toHaveBeenCalledWith(expect.objectContaining({
      sheet_0: expect.objectContaining({ content: [['row_id', '名称'], ['1', '保留']] }),
    }));
    expect(result).toMatchObject({ degraded: true, nullRowCleanupPersisted: 'failed', nullRowCleanupError: 'host save failed' });
  });

  it.each(['skipped_no_anchor', 'skipped_no_v2_target'] as const)('自愈持久化为 %s 时保留内存清理并标记 degraded', async (status) => {
    const mergedData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_0: { name: '测试表', content: [['row_id', '名称'], [null, '删除'], ['1', '保留']] },
    };
    const staleReplaySnapshot = JSON.parse(JSON.stringify(mergedData));
    mockMergeAllIndependentTables
      .mockResolvedValueOnce(mergedData)
      .mockResolvedValueOnce(staleReplaySnapshot);
    mockGetSortedSheetKeys.mockReturnValue(['sheet_0']);
    mockReorderDataBySheetKeys.mockImplementation((data: any) => data);
    mockPersistNullRowCleanupShards.mockResolvedValueOnce({ status });

    const result = await refreshMergedDataAndNotify_ACU();

    expect(mergedData.sheet_0.content).toEqual([['row_id', '名称'], ['1', '保留']]);
    expect(mockMergeAllIndependentTables).toHaveBeenCalledTimes(1);
    expect(mockFormatJsonToReadable).toHaveBeenCalledWith(expect.objectContaining({
      sheet_0: expect.objectContaining({ content: [['row_id', '名称'], ['1', '保留']] }),
    }));
    expect(result).toMatchObject({
      removedNullRowCount: 1,
      nullRowCleanupPersisted: status,
      degraded: true,
    });
  });

  it('仅存在重复 row_id 时标记 degraded，但不伪造 null-row 持久化状态', async () => {
    const mergedData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_0: { name: '测试表', content: [['row_id', '名称'], ['1', '甲'], ['1', '乙']] },
    };
    mockMergeAllIndependentTables.mockResolvedValue(mergedData);
    mockGetSortedSheetKeys.mockReturnValue(['sheet_0']);
    mockReorderDataBySheetKeys.mockImplementation((data:any) => data);

    const result = await refreshMergedDataAndNotify_ACU();

    expect(mockPersistNullRowCleanupShards).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      removedNullRowCount: 0,
      canonicalIssues: [expect.objectContaining({ reason: 'duplicate_row_id' })],
      nullRowCleanupPersisted: 'skipped_no_changes',
      degraded: true,
    });
  });

  it('合并失败时使用指导表物化', async () => {
    mockMergeAllIndependentTables.mockResolvedValue(null);
    const guideData = { sheet_0: { name: '指导表' } };
    mockGetChatSheetGuideDataForIsolationKey.mockReturnValue(guideData);
    const materializedData = { sheet_0: { name: '物化数据' } };
    mockMaterializeDataFromSheetGuide.mockReturnValue(materializedData);

    await refreshMergedDataAndNotify_ACU();
    expect(mockMaterializeDataFromSheetGuide).toHaveBeenCalledWith(guideData, { includeSeedRows: false });
    expect(mockSetCurrentJsonTableData).toHaveBeenCalledWith(materializedData);
  });

  it('无指导表时使用模板结构', async () => {
    mockMergeAllIndependentTables.mockResolvedValue(null);
    mockGetChatSheetGuideDataForIsolationKey.mockReturnValue(null);
    const templateData = { mate: { type: 'chatSheets', version: 1 }, sheet_0: {} };
    mockParseTableTemplateJson.mockReturnValue(templateData);

    await refreshMergedDataAndNotify_ACU();
    expect(mockParseTableTemplateJson).toHaveBeenCalledWith({ stripSeedRows: true });
    expect(mockSetCurrentJsonTableData).toHaveBeenCalledWith(templateData);
  });

  it('模板也失败时设为最小空结构', async () => {
    mockMergeAllIndependentTables.mockResolvedValue(null);
    mockGetChatSheetGuideDataForIsolationKey.mockReturnValue(null);
    mockParseTableTemplateJson.mockReturnValue(null);

    await refreshMergedDataAndNotify_ACU();
    expect(mockSetCurrentJsonTableData).toHaveBeenCalledWith(
      expect.objectContaining({ mate: expect.objectContaining({ type: 'chatSheets', version: 1 }) })
    );
  });

  it('提供 canonicalData 时跳过 mergeAllIndependentTables 重放，但仍更新运行时与世界书', async () => {
    const canonicalData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_0: { name: '测试表', content: [['row_id', '列1'], ['1', '值1']] },
    };
    mockMergeAllIndependentTables.mockResolvedValue({ mate: { type: 'chatSheets', version: 1 } });
    mockGetSortedSheetKeys.mockReturnValue(['sheet_0']);
    mockReorderDataBySheetKeys.mockReturnValue(canonicalData);

    const result = await refreshMergedDataAndNotify_ACU({ canonicalData });

    // canonical 路径不得再从聊天完整 replay（mergeAllIndependentTables 内部会 loadTableStateFromFramesV2_ACU）
    expect(mockMergeAllIndependentTables).not.toHaveBeenCalled();
    expect(mockSetCurrentJsonTableData).toHaveBeenCalledWith(
      expect.objectContaining({ sheet_0: expect.objectContaining({ name: '测试表' }) })
    );
    // 规范化/排序/世界书副作用仍执行
    expect(mockGetSortedSheetKeys).toHaveBeenCalled();
    expect(result?.mergedData).toEqual(expect.objectContaining({ sheet_0: expect.objectContaining({ name: '测试表' }) }));
  });

  it('未提供 canonicalData 时保持冷路径全量合并（兼容既有调用方）', async () => {
    const mergedData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_0: { name: '冷路径表', content: [['row_id', '列1'], ['1', '值1']] },
    };
    mockMergeAllIndependentTables.mockResolvedValue(mergedData);
    mockGetSortedSheetKeys.mockReturnValue(['sheet_0']);
    mockReorderDataBySheetKeys.mockReturnValue(mergedData);

    const result = await refreshMergedDataAndNotify_ACU();

    expect(mockMergeAllIndependentTables).toHaveBeenCalledTimes(1);
    expect(result?.mergedData).toEqual(expect.objectContaining({ sheet_0: expect.objectContaining({ name: '冷路径表' }) }));
  });

});

describe('updateReadableLorebookEntry_ACU', () => {
  it('抑制期间只执行清理', async () => {
    mockShouldSuppressWorldbookInjection.mockReturnValue(true);
    await updateReadableLorebookEntry_ACU(false, false);
    // 应该调用 deleteAllGeneratedEntries 但不调用 formatJsonToReadable
    expect(mockFormatJsonToReadable).not.toHaveBeenCalled();
  });

  it('使用 dataOverride 时深拷贝权威快照且不重新合并聊天历史', async () => {
    const dataOverride = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_0: { name: '测试表', content: [['row_id', '名称'], ['1', '清理后记录']] },
    };
    mockMergeAllIndependentTables.mockResolvedValue({
      mate: { type: 'chatSheets', version: 1 },
      sheet_0: { name: '旧历史', content: [['row_id', '名称'], [null, '脏行']] },
    });

    await updateReadableLorebookEntry_ACU(false, false, null, dataOverride);

    const [storedSnapshot] = mockSetCurrentJsonTableData.mock.calls[0];
    expect(mockMergeAllIndependentTables).not.toHaveBeenCalled();
    expect(storedSnapshot).toEqual(dataOverride);
    expect(storedSnapshot).not.toBe(dataOverride);
    expect(storedSnapshot.sheet_0).not.toBe(dataOverride.sheet_0);
    expect(storedSnapshot.sheet_0.content).not.toBe(dataOverride.sheet_0.content);
    expect(storedSnapshot.sheet_0.content[1]).not.toBe(dataOverride.sheet_0.content[1]);
    expect(mockFormatJsonToReadable).toHaveBeenCalledWith(storedSnapshot);
  });

  it('外部导入模式不检查抑制', async () => {
    mockShouldSuppressWorldbookInjection.mockReturnValue(true);
    mockCurrentJsonTableData.value = {
      sheet_0: { name: '测试', content: [['', '列1'], ['', '值1']] },
    };
    mockFormatJsonToReadable.mockReturnValue({
      readableText: '测试文本',
      importantPersonsTable: null,
      summaryTable: null,
      outlineTable: null,
    });
    await updateReadableLorebookEntry_ACU(false, true);
    // 外部导入模式应该继续执行
    expect(mockFormatJsonToReadable).toHaveBeenCalled();
  });

  it('无数据时中止', async () => {
    mockMergeAllIndependentTables.mockResolvedValue(null);
    mockCurrentJsonTableData.value = null;
    await updateReadableLorebookEntry_ACU(false, false);
    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('no data available'));
  });

  it('调用各个注入函数', async () => {
    const mergedData = {
      sheet_0: { name: '测试', content: [['', '列1'], ['', '值1']] },
    };
    mockMergeAllIndependentTables.mockResolvedValue(mergedData);
    mockFormatJsonToReadable.mockReturnValue({
      readableText: '测试可读文本',
      importantPersonsTable: { name: '重要人物表', content: [['', '姓名'], ['', '角色A']] },
      summaryTable: { name: '总结表', content: [['', '编码索引'], ['', 'AM0001']] },
      outlineTable: { name: '总体大纲', content: [['', '大纲列'], ['', '内容']] },
    });

    await updateReadableLorebookEntry_ACU(true, false);
    expect(mockUpdateImportantPersonsRelatedEntries).toHaveBeenCalled();
    expect(mockUpdateSummaryTableEntries).toHaveBeenCalled();
    expect(mockUpdateOutlineTableEntry).toHaveBeenCalled();
    expect(mockUpdateCustomTableExports).toHaveBeenCalled();
  });

  it('外部导入模式把目标世界书传给所有派生条目生成器', async () => {
    mockCurrentJsonTableData.value = {
      sheet_0: { name: '测试', content: [['', '列1'], ['', '值1']] },
    };
    mockFormatJsonToReadable.mockReturnValue({
      readableText: '测试可读文本',
      importantPersonsTable: { name: '重要人物表', content: [['', '姓名'], ['', '角色A']] },
      summaryTable: { name: '总结表', content: [['', '编码索引'], ['', 'AM0001']] },
      outlineTable: { name: '总体大纲', content: [['', '大纲列'], ['', '内容']] },
    });

    await updateReadableLorebookEntry_ACU(true, true, 'target-book');

    expect(mockUpdateImportantPersonsRelatedEntries).toHaveBeenCalledWith(expect.any(Object), true, 'target-book');
    expect(mockUpdateSummaryTableEntries).toHaveBeenCalledWith(expect.any(Object), true, 'target-book');
    expect(mockUpdateOutlineTableEntry).toHaveBeenCalledWith(expect.any(Object), true, 'target-book');
    expect(mockUpdateCustomTableExports).toHaveBeenCalledWith(expect.any(Object), true, 'target-book');
    expect(mockGwGetLorebookEntries).toHaveBeenCalledWith('target-book');
  });

  it('总结表仅有隐藏列数据时删除 MemoryStart/MemoryEnd，而不创建空壳记忆条目', async () => {
    mockMergeAllIndependentTables.mockResolvedValue({
      sheet_0: {
        name: '公开表',
        content: [['row_id', '名称'], ['1', '可见数据']],
      },
    });
    mockFormatJsonToReadable.mockReturnValue({
      readableText: '公开表数据',
      importantPersonsTable: null,
      outlineTable: null,
      summaryTable: {
        name: '总结表',
        sourceData: {
          ddl: 'CREATE TABLE summary (row_id INTEGER PRIMARY KEY, summary TEXT, legacy_note TEXT);',
          hiddenPhysicalColumns: ['legacy_note'],
        },
        content: [['row_id', '总结', '旧备注'], ['1', '', '隐藏历史']],
      },
    });
    mockGwGetLorebookEntries.mockResolvedValue([
      { uid: 101, comment: 'TavernDB-ACU-MemoryStart' },
      { uid: 102, comment: 'TavernDB-ACU-MemoryEnd' },
    ]);

    await updateReadableLorebookEntry_ACU(true, false);

    expect(mockGwDeleteLorebookEntries).toHaveBeenCalledWith('test-lorebook', [101, 102]);
    expect(mockGwCreateLorebookEntries).not.toHaveBeenCalledWith(
      'test-lorebook',
      expect.arrayContaining([expect.objectContaining({ comment: 'TavernDB-ACU-MemoryStart' })]),
    );
  });

  it('全部数据仅存在于隐藏列时按公开视图清理旧世界书条目', async () => {
    mockMergeAllIndependentTables.mockResolvedValue({
      sheet_0: {
        name: '隐藏历史表',
        sourceData: {
          ddl: 'CREATE TABLE history (row_id INTEGER PRIMARY KEY, title TEXT, legacy_note TEXT);',
          hiddenPhysicalColumns: ['legacy_note'],
        },
        content: [['row_id', '标题', '旧备注'], ['1', '', '隐藏历史']],
      },
    });
    mockFormatJsonToReadable.mockReturnValue({
      readableText: '数据库为空。',
      importantPersonsTable: null,
      summaryTable: null,
      outlineTable: null,
    });
    mockGwGetLorebookEntries.mockResolvedValue([
      { uid: 201, comment: 'TavernDB-ACU-ReadableDataTable' },
      { uid: 202, comment: 'TavernDB-ACU-WrapperStart' },
      { uid: 203, comment: 'TavernDB-ACU-MemoryStart' },
    ]);

    await updateReadableLorebookEntry_ACU(true, false);

    expect(mockGwDeleteLorebookEntries).toHaveBeenCalledWith('test-lorebook', [201, 202, 203]);
    expect(mockUpdateCustomTableExports).toHaveBeenCalledWith(null, false, null);
  });
});

describe('collectCombinedWorldbookEntriesByStrategy_ACU entryStateView', () => {
  it('pre_takeover 使用快照恢复 enabled、keys 和 type，且不修改 gateway 原对象', async () => {
    const liveEntry = { uid: 1, comment: '受控条目', content: '命中内容', enabled: false, type: 'constant', key: [], keys: [] };
    mockGwGetLorebookEntries.mockResolvedValue([liveEntry]);

    const result = await collectCombinedWorldbookEntriesByStrategy_ACU({
      bookNames: ['书A'],
      baseScanText: '旧关键词',
      entryStateView: 'pre_takeover',
      entryStateSnapshotSignature: 'scope-signature',
      entryStateSnapshot: {
        active: true,
        selectionSignature: 'scope-signature',
        createdAt: 1,
        books: {
          书A: [{ uid: 1, previousEnabled: true, previousKeys: ['旧关键词'], previousType: 'keyword' }],
        },
      },
      sortEntries: null,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({ enabled: true, key: ['旧关键词'], keys: ['旧关键词'], type: 'keyword' }));
    expect(liveEntry).toEqual({ uid: 1, comment: '受控条目', content: '命中内容', enabled: false, type: 'constant', key: [], keys: [] });
  });

  it('pre_takeover 保留 previousEnabled=false，不让 live 常量状态复活条目', async () => {
    mockGwGetLorebookEntries.mockResolvedValue([
      { uid: 2, comment: '接管后常量', content: '不应出现', enabled: true, type: 'constant', key: [], keys: [] },
    ]);

    const result = await collectCombinedWorldbookEntriesByStrategy_ACU({
      bookNames: ['书A'],
      entryStateView: 'pre_takeover',
      entryStateSnapshotSignature: 'scope-signature',
      entryStateSnapshot: {
        active: true,
        selectionSignature: 'scope-signature',
        createdAt: 1,
        books: {
          书A: [{ uid: 2, previousEnabled: false, previousKeys: [], previousType: undefined }],
        },
      },
    });

    expect(result).toEqual([]);
  });

  it('inactive pre_takeover snapshot 合法退化为 live 且不记录签名警告', async () => {
    mockGwGetLorebookEntries.mockResolvedValue([
      { uid: 3, comment: 'live 条目', content: 'live 内容', enabled: true, type: 'constant', key: [], keys: [] },
    ]);

    const result = await collectCombinedWorldbookEntriesByStrategy_ACU({
      bookNames: ['书A'],
      entryStateView: 'pre_takeover',
      entryStateSnapshotSignature: '',
      entryStateSnapshot: { active: false, selectionSignature: '', createdAt: 0, books: {} },
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({ enabled: true, type: 'constant' }));
    expect(mockLogWarn).not.toHaveBeenCalledWith(expect.stringContaining('pre_takeover snapshot unavailable or signature mismatch'));
  });

  it('active 但没有有效快照条目时退化为 live 并记录警告', async () => {
    mockGwGetLorebookEntries.mockResolvedValue([
      { uid: 3, comment: 'live 条目', content: 'live 内容', enabled: true, type: 'constant', key: [], keys: [] },
    ]);

    const result = await collectCombinedWorldbookEntriesByStrategy_ACU({
      bookNames: ['书A'],
      entryStateView: 'pre_takeover',
      entryStateSnapshotSignature: 'scope-signature',
      entryStateSnapshot: {
        active: true,
        selectionSignature: 'scope-signature',
        createdAt: 1,
        books: {},
      },
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({ enabled: true, type: 'constant' }));
    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('pre_takeover snapshot unavailable or signature mismatch'));
  });

  it('签名不匹配时退化为 live 并记录警告', async () => {
    mockGwGetLorebookEntries.mockResolvedValue([
      { uid: 3, comment: 'live 条目', content: 'live 内容', enabled: true, type: 'constant', key: [], keys: [] },
    ]);

    const result = await collectCombinedWorldbookEntriesByStrategy_ACU({
      bookNames: ['书A'],
      entryStateView: 'pre_takeover',
      entryStateSnapshotSignature: 'expected-signature',
      entryStateSnapshot: {
        active: true,
        selectionSignature: 'stale-signature',
        createdAt: 1,
        books: { 书A: [{ uid: 3, previousEnabled: false, previousKeys: [], previousType: 'keyword' }] },
      },
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({ enabled: true, type: 'constant' }));
    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('pre_takeover snapshot unavailable or signature mismatch'));
  });

  it('live 默认视图不读取快照状态', async () => {
    mockGwGetLorebookEntries.mockResolvedValue([
      { uid: 4, comment: 'live 禁用条目', content: '不应出现', enabled: false, type: 'constant', key: [], keys: [] },
    ]);

    const result = await collectCombinedWorldbookEntriesByStrategy_ACU({
      bookNames: ['书A'],
      entryStateSnapshotSignature: 'scope-signature',
      entryStateSnapshot: {
        active: true,
        selectionSignature: 'scope-signature',
        createdAt: 1,
        books: { 书A: [{ uid: 4, previousEnabled: true, previousKeys: [], previousType: 'constant' }] },
      },
    });

    expect(result).toEqual([]);
  });

  it('在状态投影后将 excludeEntry 置于 includeEntry、forceIncludeEntry 和 isSelected 之前', async () => {
    const includeEntry = vi.fn(() => true);
    const forceIncludeEntry = vi.fn(() => true);
    const isSelected = vi.fn(() => true);
    const excludeEntry = vi.fn((entry: any) => entry.type === 'keyword' && entry.key.includes('接管前关键词'));
    mockGwGetLorebookEntries.mockResolvedValue([
      { uid: 5, comment: '受控条目', content: '不应出现', enabled: false, type: 'constant', key: [], keys: [] },
    ]);

    const result = await collectCombinedWorldbookEntriesByStrategy_ACU({
      bookNames: ['书A'],
      baseScanText: '接管前关键词',
      entryStateView: 'pre_takeover',
      entryStateSnapshotSignature: 'scope-signature',
      entryStateSnapshot: {
        active: true,
        selectionSignature: 'scope-signature',
        createdAt: 1,
        books: { 书A: [{ uid: 5, previousEnabled: true, previousKeys: ['接管前关键词'], previousType: 'keyword' }] },
      },
      excludeEntry,
      includeEntry,
      forceIncludeEntry,
      isSelected,
    });

    expect(result).toEqual([]);
    expect(excludeEntry).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, type: 'keyword', key: ['接管前关键词'] }));
    expect(includeEntry).not.toHaveBeenCalled();
    expect(forceIncludeEntry).not.toHaveBeenCalled();
    expect(isSelected).not.toHaveBeenCalled();
  });

  it('entryScope 排除常量条目时不会让其内容参与关键词递归', async () => {
    mockGwGetLorebookEntries.mockResolvedValue([
      { uid: 6, comment: '作用域外常量', content: '仅作用域外关键词', enabled: true, type: 'constant', key: [], keys: [], prevent_recursion: false },
      { uid: 7, comment: '关键词条目', content: '不应被递归触发', enabled: true, type: 'keyword', key: ['仅作用域外关键词'], keys: [] },
    ]);

    const result = await collectCombinedWorldbookEntriesByStrategy_ACU({
      bookNames: ['书A'],
      entryScope: (entry: any) => entry.uid !== 6,
      sortEntries: null,
    });

    expect(result).toEqual([]);
  });
});

describe('buildCombinedWorldbookContentByStrategy_ACU', () => {
  it('无世界书名称时返回空字符串', async () => {
    const result = await buildCombinedWorldbookContentByStrategy_ACU({ bookNames: [] });
    expect(result).toBe('');
  });

  it('组合常量和关键词触发的条目', async () => {
    mockGwGetLorebookEntries.mockResolvedValue([
      { uid: 1, comment: '常量条目', content: '常量内容', enabled: true, type: 'constant', key: [], keys: [] },
      { uid: 2, comment: '关键词条目', content: '关键词内容', enabled: true, type: 'keyword', key: ['测试'], keys: [] },
    ]);
    const result = await buildCombinedWorldbookContentByStrategy_ACU({
      bookNames: ['书A'],
      baseScanText: '这是一个测试文本',
      formatEntry: (entry: any) => entry.content,
      sortEntries: null,
    });
    expect(result).toContain('常量内容');
    expect(result).toContain('关键词内容');
  });

  it('排除禁用条目', async () => {
    mockGwGetLorebookEntries.mockResolvedValue([
      { uid: 1, comment: '禁用条目', content: '禁用内容', enabled: false, type: 'constant', key: [], keys: [] },
    ]);
    const result = await buildCombinedWorldbookContentByStrategy_ACU({
      bookNames: ['书A'],
      formatEntry: (entry: any) => entry.content,
    });
    expect(result).toBe('');
  });

  it('includeEntry 过滤器生效', async () => {
    mockGwGetLorebookEntries.mockResolvedValue([
      { uid: 1, comment: 'TavernDB-ACU-内部', content: '内部内容', enabled: true, type: 'constant', key: [], keys: [] },
      { uid: 2, comment: '用户条目', content: '用户内容', enabled: true, type: 'constant', key: [], keys: [] },
    ]);
    const result = await buildCombinedWorldbookContentByStrategy_ACU({
      bookNames: ['书A'],
      includeEntry: (entry: any) => !entry.comment.startsWith('TavernDB-ACU-'),
      formatEntry: (entry: any) => entry.content,
      sortEntries: null,
    });
    expect(result).toContain('用户内容');
    expect(result).not.toContain('内部内容');
  });

  it('递归触发关键词条目', async () => {
    mockGwGetLorebookEntries.mockResolvedValue([
      { uid: 1, comment: '常量', content: '包含关键词A的内容', enabled: true, type: 'constant', key: [], keys: [], prevent_recursion: false },
      { uid: 2, comment: '关键词A条目', content: '关键词A的详细内容', enabled: true, type: 'keyword', key: ['关键词a'], keys: [] },
    ]);
    const result = await buildCombinedWorldbookContentByStrategy_ACU({
      bookNames: ['书A'],
      baseScanText: '',
      formatEntry: (entry: any) => entry.content,
      sortEntries: null,
    });
    expect(result).toContain('关键词A的详细内容');
  });
});

describe('getCombinedWorldbookContent_ACU', () => {
  it('API 不可用时明确拒绝读取，不伪装成空书', async () => {
    mockIsWorldbookApiAvailable.mockReturnValue(false);
    await expect(getCombinedWorldbookContent_ACU()).rejects.toMatchObject({
      name: 'WorldbookReadError_ACU', category: 'api_unavailable',
    });
  });

  it('character 模式获取角色世界书', async () => {
    mockGetCurrentWorldbookConfig.mockReturnValue({
      source: 'character',
      enabledEntries: {},
    });
    mockGetCharLorebooks.mockResolvedValue({ primary: '主世界书', additional: ['附加书'] });
    mockGwGetLorebookEntries.mockResolvedValue([]);
    await getCombinedWorldbookContent_ACU();
    expect(mockGetCharLorebooks).toHaveBeenCalled();
  });

  it('character 模式读取角色世界书失败时不记录宿主错误正文', async () => {
    const sensitiveText = '用户输入、提示词和世界书正文都不能泄露';
    mockGetCurrentWorldbookConfig.mockReturnValue({
      source: 'character',
      enabledEntries: {},
    });
    const error = new Error(sensitiveText);
    mockGetCharLorebooks.mockRejectedValue(error);

    await expect(getCombinedWorldbookContent_ACU()).rejects.toBe(error);
    expect(mockLogError).toHaveBeenCalledWith('[Worldbook] 获取角色世界书失败:', {
      phase: 'resolve_character',
      error: { category: 'read_failed' },
    });
    expect(JSON.stringify(mockLogError.mock.calls)).not.toContain(sensitiveText);
  });

  it('manual 模式使用手动选择', async () => {
    mockGetCurrentWorldbookConfig.mockReturnValue({
      source: 'manual',
      manualSelection: ['手动书A'],
      enabledEntries: {},
    });
    mockGwGetLorebookEntries.mockResolvedValue([]);
    await getCombinedWorldbookContent_ACU();
    // 不应调用 getCharLorebooks
    expect(mockGetCharLorebooks).not.toHaveBeenCalled();
  });

  it('过滤 TavernDB-ACU- 前缀的条目', async () => {
    mockGetCurrentWorldbookConfig.mockReturnValue({
      source: 'manual',
      manualSelection: ['书A'],
      enabledEntries: {},
    });
    mockGwGetLorebookEntries.mockResolvedValue([
      { uid: 1, comment: 'TavernDB-ACU-ReadableDataTable', content: '内部', enabled: true, type: 'constant', key: [], keys: [] },
      { uid: 2, comment: '用户条目', content: '用户内容', enabled: true, type: 'constant', key: [], keys: [] },
    ]);
    const result = await getCombinedWorldbookContent_ACU();
    expect(result).not.toContain('内部');
  });

  it('仅在 includeGeneratedEntries 与精确 entryScope 同时提供时收集目标内部导出条目', async () => {
    mockGetCurrentWorldbookConfig.mockReturnValue({
      source: 'manual',
      manualSelection: ['书A'],
      enabledEntries: {},
    });
    mockGwGetLorebookEntries.mockResolvedValue([
      { uid: 1, comment: 'TavernDB-ACU-CustomExport-人物关系', content: '目标表导出', enabled: true, type: 'constant', key: [], keys: [] },
      { uid: 2, comment: 'TavernDB-ACU-CustomExport-背包', content: '非目标表导出', enabled: true, type: 'constant', key: [], keys: [] },
      { uid: 3, comment: '用户条目', content: '非目标用户条目', enabled: true, type: 'constant', key: [], keys: [] },
    ]);

    const result = await getCombinedWorldbookContent_ACU('', {
      includeGeneratedEntries: true,
      entryScope: (entry: any) => entry.uid === 1,
    });

    expect(result).toContain('目标表导出');
    expect(result).not.toContain('非目标表导出');
    expect(result).not.toContain('非目标用户条目');
  });

  it('facade 将 excludeEntry 置于 Agent greenlight 之前传递给 collector', async () => {
    mockGetCurrentWorldbookConfig.mockReturnValue({
      source: 'manual',
      manualSelection: ['书A'],
      enabledEntries: {},
    });
    mockGwGetLorebookEntries.mockResolvedValue([
      { uid: 1, comment: 'TavernDB-ACU-内部', content: '不可被绿灯复活', enabled: false, type: 'keyword', key: ['不会触发'], keys: [] },
      { uid: 2, comment: '用户条目', content: '应保留', enabled: true, type: 'constant', key: [], keys: [] },
      { uid: 3, comment: '作用域外用户条目', content: '不应越过作用域', enabled: true, type: 'constant', key: [], keys: [] },
    ]);

    const result = await getCombinedWorldbookContent_ACU('', {
      agentGreenlights: [{ bookName: '书A', uid: 1, reason: '不应绕过排除' }],
      excludeEntry: (entry: any) => entry.comment === 'TavernDB-ACU-内部',
      entryScope: (entry: any) => entry.uid !== 3,
    });

    expect(result).toContain('应保留');
    expect(result).not.toContain('不可被绿灯复活');
    expect(result).not.toContain('不应越过作用域');
  });

  it('填表世界书合成只输出条目正文，不泄漏普通条目或绿灯条目的 comment', async () => {
    mockGetCurrentWorldbookConfig.mockReturnValue({
      source: 'manual',
      manualSelection: ['书A'],
      enabledEntries: {},
    });
    mockGwGetLorebookEntries.mockResolvedValue([
      { uid: 1, comment: 'TavernDB-ACU-AgentGreenlight-元数据', content: '绿灯正文内容', enabled: false, type: 'keyword', key: ['不会触发'], keys: [] },
      { uid: 2, comment: '普通条目', content: '普通内容', enabled: true, type: 'constant', key: [], keys: [] },
      { uid: 3, comment: '关键词条目', content: '关键词内容', enabled: true, type: 'selective', key: ['扫描文本'], keys: [] },
    ]);

    const result = await getCombinedWorldbookContent_ACU('扫描文本', {
      agentGreenlights: [{ bookName: '书A', uid: 1, reason: '正文需要' }],
    });

    expect(result).toContain('绿灯正文内容');
    expect(result).toContain('普通内容');
    expect(result).toContain('关键词内容');
    expect(result).not.toContain('普通条目');
    expect(result).not.toContain('关键词条目');
    expect(result).not.toContain('TavernDB-ACU-AgentGreenlight');
    expect(result).not.toContain('#');
  });

  it('pre_takeover 让已接管条目按 previousKeys 命中，但不修改 live 条目', async () => {
    mockGetCurrentWorldbookConfig.mockReturnValue({
      source: 'manual',
      manualSelection: ['书A'],
      enabledEntries: { 书A: [1] },
    });
    const liveEntry = {
      uid: 1,
      comment: '受控关键词条目',
      content: '接管前关键词命中正文',
      enabled: false,
      type: 'constant',
      key: [],
      keys: [],
    };
    mockGwGetLorebookEntries.mockResolvedValue([liveEntry]);

    const result = await getCombinedWorldbookContent_ACU('旧关键词', {
      entryStateView: 'pre_takeover',
      entryStateSnapshotSignature: 'scope-signature',
      entryStateSnapshot: {
        active: true,
        selectionSignature: 'scope-signature',
        createdAt: 1,
        books: {
          书A: [{ uid: 1, previousEnabled: true, previousKeys: ['旧关键词'], previousType: 'selective' }],
        },
      },
    });

    expect(result).toContain('接管前关键词命中正文');
    expect(result).not.toContain('受控关键词条目');
    expect(liveEntry).toEqual({
      uid: 1,
      comment: '受控关键词条目',
      content: '接管前关键词命中正文',
      enabled: false,
      type: 'constant',
      key: [],
      keys: [],
    });
  });

  it('pre_takeover 下接管前启用的受控条目仍尊重当前任务的未勾选状态', async () => {
    mockGetCurrentWorldbookConfig.mockReturnValue({
      source: 'manual',
      manualSelection: ['书A'],
      enabledEntries: { 书A: [] },
    });
    mockGwGetLorebookEntries.mockResolvedValue([{
      uid: 1,
      comment: '受控关键词条目',
      content: '接管前正常注入正文',
      enabled: false,
      type: 'constant',
      key: [],
      keys: [],
    }]);
    const snapshot = {
      active: true,
      selectionSignature: 'scope-signature',
      createdAt: 1,
      books: {
        书A: [{ uid: 1, previousEnabled: true, previousKeys: ['旧关键词'], previousType: 'selective' }],
      },
    };

    const uncheckedResult = await getCombinedWorldbookContent_ACU('旧关键词', {
      entryStateView: 'pre_takeover',
      entryStateSnapshotSignature: 'scope-signature',
      entryStateSnapshot: snapshot,
    });
    expect(uncheckedResult).toBe('');

    const unmatchedResult = await getCombinedWorldbookContent_ACU('没有匹配的文本', {
      entryStateView: 'pre_takeover',
      entryStateSnapshotSignature: 'scope-signature',
      entryStateSnapshot: snapshot,
    });
    expect(unmatchedResult).toBe('');
  });

  it('pre_takeover 不复活 previousEnabled=false 的受控条目', async () => {
    mockGetCurrentWorldbookConfig.mockReturnValue({
      source: 'manual',
      manualSelection: ['书A'],
      enabledEntries: { 书A: [1] },
    });
    mockGwGetLorebookEntries.mockResolvedValue([{
      uid: 1, comment: '原本关闭条目', content: '不应注入的正文', enabled: true, type: 'constant', key: [], keys: [],
    }]);

    const result = await getCombinedWorldbookContent_ACU('旧关键词', {
      entryStateView: 'pre_takeover',
      entryStateSnapshotSignature: 'scope-signature',
      entryStateSnapshot: {
        active: true,
        selectionSignature: 'scope-signature',
        createdAt: 1,
        books: { 书A: [{ uid: 1, previousEnabled: false, previousKeys: ['旧关键词'], previousType: 'selective' }] },
      },
    });
    expect(result).toBe('');
  });

  it.each(['scope_changed', 'aborted', 'lorebook_not_found', 'unknown'])('条目读取 %s 时原样透传失败', async category => {
    mockGetCurrentWorldbookConfig.mockReturnValue({ source: 'manual', manualSelection: ['书A'], enabledEntries: {} });
    const error = Object.assign(new Error('敏感宿主错误正文'), {
      name: category === 'aborted' ? 'AbortError' : 'WorldbookReadError_ACU', category,
    });
    mockGwGetLorebookEntries.mockRejectedValue(error);
    await expect(getCombinedWorldbookContent_ACU()).rejects.toBe(error);
    expect(JSON.stringify(mockLogError.mock.calls)).not.toContain('敏感宿主错误正文');
  });

  it.each(['书A', ' 书A ', 'Ａ / "引号" & # + \u200b'])('绿灯以宿主原名 %s 匹配，不合并不同书名', async bookName => {
    mockGetCurrentWorldbookConfig.mockReturnValue({ source: 'manual', manualSelection: [bookName], enabledEntries: {} });
    mockGwGetLorebookEntries.mockResolvedValue([{
      uid: 1, comment: '用户条目', content: '仅精确书名可放行', enabled: false,
      type: 'selective', key: ['不匹配'], keys: [],
    }]);
    const content = await getCombinedWorldbookContent_ACU('', { agentGreenlights: [{ bookName, uid: 1 }] });
    expect(content).toBe('仅精确书名可放行');
    const differentName = bookName.trim() === bookName ? ` ${bookName} ` : bookName.trim();
    await expect(getCombinedWorldbookContent_ACU('', {
      agentGreenlights: [{ bookName: differentName, uid: 1 }],
    })).resolves.toBe('');
  });
});
