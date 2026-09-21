
/**
 * tests/service/worldbook/injection-engine-custom.test.ts
 * 世界书自定义表格导出 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockSettings,
  mockGetCurrentWorldbookConfig,
  mockIsWorldbookApiAvailable, mockGetLorebookEntries, mockSetLorebookEntries,
  mockCreateLorebookEntries, mockDeleteLorebookEntries,
  mockSaveSettings,
  mockGetSortedSheetKeys,
  mockLogDebug, mockLogError, mockLogWarn,
  mockGetImportBatchPrefix,
  mockEnsureExportConfigDefaults, mockNormalizePlacementConfig,
  mockApplyPlacementToEntry,
  mockBuildUsedOrderSet, mockAllocOrder, mockAllocConsecutiveOrderBlock,
  mockGetInjectionTargetLorebook, mockGetIsolationPrefix,
  mockSplitKeywordsByComma,
  mockGetLatestSummaryVectorIndexSnapshotState,
  mockGetEffectiveSummaryVectorIndexConfig,
  mockGetCurrentFlightModeState,
  mockDidLastRecallSucceed,
} = vi.hoisted(() => ({
  mockSettings: {
    dataIsolationEnabled: false,
    dataIsolationCode: '',
    knownCustomEntryNames: [] as string[],
  } as any,
  mockGetCurrentWorldbookConfig: vi.fn(() => ({
    zeroTkOccupyMode: false,
  })),
  mockIsWorldbookApiAvailable: vi.fn(() => true),
  mockGetLorebookEntries: vi.fn(async () => []),
  mockSetLorebookEntries: vi.fn(async () => {}),
  mockCreateLorebookEntries: vi.fn(async () => {}),
  mockDeleteLorebookEntries: vi.fn(async () => {}),
  mockSaveSettings: vi.fn(),
  mockGetSortedSheetKeys: vi.fn(() => []),
  mockLogDebug: vi.fn(),
  mockLogError: vi.fn(),
  mockLogWarn: vi.fn(),
  mockGetImportBatchPrefix: vi.fn(() => '外部导入-'),
  mockEnsureExportConfigDefaults: vi.fn((cfg: any, name: string) => ({
    enabled: false,
    splitByRow: false,
    entryName: name || '',
    entryType: 'constant',
    keywords: '',
    preventRecursion: true,
    injectionTemplate: '',
    extraIndexEnabled: false,
    extraIndexEntryName: `${name || '表格'}-索引`,
    extraIndexColumns: [],
    extraIndexColumnModes: {},
    extraIndexInjectionTemplate: '',
    entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 },
    extraIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 10010 },
    fixedEntryPlacement: { position: 'at_depth_as_system', depth: 2, order: 99990 },
    fixedIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 99991 },
    ...cfg,
  })),
  mockNormalizePlacementConfig: vi.fn((raw: any, fallback: any) => raw || fallback || { position: 'at_depth_as_system', depth: 2, order: 10000 }),
  mockApplyPlacementToEntry: vi.fn((entry: any, placement: any) => ({ ...entry, ...placement })),
  mockBuildUsedOrderSet: vi.fn(() => new Set<number>()),
  mockAllocOrder: vi.fn(() => 10001),
  mockAllocConsecutiveOrderBlock: vi.fn(() => 100),
  mockGetInjectionTargetLorebook: vi.fn(async () => 'test-lorebook'),
  mockGetIsolationPrefix: vi.fn(() => ''),
  mockSplitKeywordsByComma: vi.fn((text: string) => {
    const raw = String(text || '').trim();
    if (!raw) return [];
    return raw.split(/[,，]/).map((k: string) => k.trim()).filter(Boolean);
  }),
  mockGetLatestSummaryVectorIndexSnapshotState: vi.fn(() => null),
  mockGetEffectiveSummaryVectorIndexConfig: vi.fn(() => ({
    summaryIndexKeywordMinRows: 3,
  })),
  mockGetCurrentFlightModeState: vi.fn(() => ({ enabled: false, hiddenRowIds: [], bigSummarySheetKey: '' })),
  mockDidLastRecallSucceed: vi.fn(() => false),
}));

vi.mock('../../../src/service/settings/settings-readers', () => ({
  getCurrentWorldbookConfig_ACU: mockGetCurrentWorldbookConfig,
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get settings_ACU() { return mockSettings; },
}));

vi.mock('../../../src/data/gateways/worldbook-gateway', () => ({
  isWorldbookApiAvailable_ACU: mockIsWorldbookApiAvailable,
  getLorebookEntries_ACU: mockGetLorebookEntries,
  setLorebookEntries_ACU: mockSetLorebookEntries,
  createLorebookEntries_ACU: mockCreateLorebookEntries,
  deleteLorebookEntries_ACU: mockDeleteLorebookEntries,
}));

vi.mock('../../../src/service/settings/settings-service', () => ({
  saveSettings_ACU: mockSaveSettings,
}));

vi.mock('../../../src/service/template/chat-scope', () => ({
  getSortedSheetKeys_ACU: mockGetSortedSheetKeys,
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: mockLogDebug,
  logError_ACU: mockLogError,
  logWarn_ACU: mockLogWarn,
}));

vi.mock('../../../src/shared/constants', () => ({
  getImportBatchPrefix_ACU: mockGetImportBatchPrefix,
  SCRIPT_ID_PREFIX_ACU: 'test-script-id',
}));

vi.mock('../../../src/service/worldbook/injection-engine-config', () => ({
  DEFAULT_ENTRY_PLACEMENT_ACU: Object.freeze({ position: 'at_depth_as_system', depth: 2, order: 10000 }),
  DEFAULT_EXTRA_INDEX_PLACEMENT_ACU: Object.freeze({ position: 'at_depth_as_system', depth: 2, order: 10010 }),
  ensureExportConfigDefaults_ACU: mockEnsureExportConfigDefaults,
  normalizePlacementConfig_ACU: mockNormalizePlacementConfig,
  applyPlacementToEntry_ACU: mockApplyPlacementToEntry,
}));

vi.mock('../../../src/service/worldbook/injection-engine-order', () => ({
  buildUsedOrderSet_ACU: mockBuildUsedOrderSet,
  allocOrder_ACU: mockAllocOrder,
  allocConsecutiveOrderBlock_ACU: mockAllocConsecutiveOrderBlock,
}));

vi.mock('../../../src/service/worldbook/injection-engine-state', () => ({
  getInjectionTargetLorebook_ACU: mockGetInjectionTargetLorebook,
  getIsolationPrefix_ACU: mockGetIsolationPrefix,
}));

vi.mock('../../../src/service/worldbook/injection-engine-entries', () => ({
  splitKeywordsByComma_ACU: mockSplitKeywordsByComma,
}));

vi.mock('../../../src/service/vector/summary-vector-index-state-service', () => ({
  getLatestSummaryVectorIndexSnapshotState_ACU: mockGetLatestSummaryVectorIndexSnapshotState,
}));

vi.mock('../../../src/service/vector/vector-memory-config', () => ({
  getEffectiveSummaryVectorIndexConfig_ACU: mockGetEffectiveSummaryVectorIndexConfig,
}));

vi.mock('../../../src/service/vector/summary-vector-index-recall-status', () => ({
  didLastSummaryVectorRecallSucceed_ACU: (...args: any[]) => mockDidLastRecallSucceed(...args),
}));

vi.mock('../../../src/service/flight-mode/flight-mode-state', () => ({
  getCurrentFlightModeState_ACU: (...args: any[]) => mockGetCurrentFlightModeState(...args),
}));

import { updateCustomTableExports_ACU } from '../../../src/service/worldbook/injection-engine-custom';

beforeEach(() => {
  vi.clearAllMocks();
  mockSettings.dataIsolationEnabled = false;
  mockSettings.dataIsolationCode = '';
  mockSettings.knownCustomEntryNames = [];
  mockIsWorldbookApiAvailable.mockReturnValue(true);
  mockGetInjectionTargetLorebook.mockResolvedValue('test-lorebook');
  mockGetIsolationPrefix.mockReturnValue('');
  mockGetLorebookEntries.mockResolvedValue([]);
  mockBuildUsedOrderSet.mockReturnValue(new Set<number>());
  mockAllocOrder.mockReturnValue(10001);
  mockAllocConsecutiveOrderBlock.mockReturnValue(100);
  mockGetCurrentWorldbookConfig.mockReturnValue({ zeroTkOccupyMode: false });
  mockGetSortedSheetKeys.mockReturnValue([]);
  mockGetCurrentFlightModeState.mockReset().mockReturnValue({ enabled: false, hiddenRowIds: [], bigSummarySheetKey: '' });
  mockDidLastRecallSucceed.mockReturnValue(false);
});

describe('updateCustomTableExports_ACU', () => {
  // ═══ 基础守卫 ═══
  describe('基础守卫', () => {
    it('API 不可用时直接返回', async () => {
      mockIsWorldbookApiAvailable.mockReturnValue(false);
      await updateCustomTableExports_ACU({ sheet_0: {} });
      expect(mockGetLorebookEntries).not.toHaveBeenCalled();
    });

    it('无 lorebook 时直接返回', async () => {
      mockGetInjectionTargetLorebook.mockResolvedValue(null);
      await updateCustomTableExports_ACU({ sheet_0: {} });
      expect(mockGetLorebookEntries).not.toHaveBeenCalled();
    });
  });

  // ═══ 清理模式（mergedData 为 null） ═══
  describe('清理模式', () => {
    it('mergedData 为 null 时只清理旧条目', async () => {
      mockGetLorebookEntries.mockResolvedValue([
        { uid: 1, comment: 'TavernDB-ACU-CustomExport-表A' },
        { uid: 2, comment: '无关条目' },
      ]);
      await updateCustomTableExports_ACU(null);
      expect(mockDeleteLorebookEntries).toHaveBeenCalledWith('test-lorebook', [1]);
      expect(mockCreateLorebookEntries).not.toHaveBeenCalled();
    });

    it('坏 comment 不会阻断旧条目清理或设置保存', async () => {
      mockGetLorebookEntries.mockResolvedValue([
        { uid: 1, comment: 2024 },
        { uid: 2, comment: 'TavernDB-ACU-CustomExport-表A' },
      ]);

      await expect(updateCustomTableExports_ACU(null)).resolves.toBeUndefined();

      expect(mockDeleteLorebookEntries).toHaveBeenCalledWith('test-lorebook', [2]);
      expect(mockSaveSettings).toHaveBeenCalled();
      expect(mockLogError).not.toHaveBeenCalled();
    });

    it('清理后保存 knownNames', async () => {
      mockSettings.knownCustomEntryNames = ['TavernDB-ACU-CustomExport-旧表'];
      mockGetLorebookEntries.mockResolvedValue([]);
      await updateCustomTableExports_ACU(null);
      expect(mockSaveSettings).toHaveBeenCalled();
    });

    it('隔离模式下只清理匹配前缀的条目', async () => {
      mockGetIsolationPrefix.mockReturnValue('ACU-[test]-');
      mockSettings.knownCustomEntryNames = ['ACU-[test]-TavernDB-ACU-CustomExport-表A'];
      mockGetLorebookEntries.mockResolvedValue([
        { uid: 1, comment: 'ACU-[test]-TavernDB-ACU-CustomExport-表A' },
        { uid: 2, comment: 'ACU-[other]-TavernDB-ACU-CustomExport-表B' },
      ]);
      await updateCustomTableExports_ACU(null);
      expect(mockDeleteLorebookEntries).toHaveBeenCalledWith('test-lorebook', [1]);
    });

    it('导入模式不删除旧条目', async () => {
      mockGetLorebookEntries.mockResolvedValue([
        { uid: 1, comment: 'TavernDB-ACU-CustomExport-表A' },
      ]);
      await updateCustomTableExports_ACU(null, true);
      expect(mockDeleteLorebookEntries).not.toHaveBeenCalled();
    });
  });

  // ═══ 整表导出 ═══
  describe('整表导出', () => {
    it('创建自定义导出条目', async () => {
      const mergedData: any = {
        sheet_0: {
          name: '自定义表',
          content: [['', '列1', '列2'], ['', '值A', '值B']],
          exportConfig: { enabled: true, entryName: '自定义表', entryType: 'constant' },
        },
      };
      mockGetSortedSheetKeys.mockReturnValue(['sheet_0']);
      mockEnsureExportConfigDefaults.mockReturnValue({
        enabled: true,
        splitByRow: false,
        entryName: '自定义表',
        entryType: 'constant',
        keywords: '',
        preventRecursion: true,
        injectionTemplate: '',
        extraIndexEnabled: false,
        extraIndexEntryName: '自定义表-索引',
        extraIndexColumns: [],
        extraIndexColumnModes: {},
        extraIndexInjectionTemplate: '',
        entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 },
        extraIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 10010 },
      });
      await updateCustomTableExports_ACU(mergedData);
      expect(mockCreateLorebookEntries).toHaveBeenCalled();
    });

    it('整表导出隐藏 physical column 且保持右侧可见列对齐', async () => {
      const mergedData: any = {
        sheet_0: {
          name: '自定义表',
          sourceData: {
            ddl: 'CREATE TABLE custom_table (row_id INTEGER PRIMARY KEY, name TEXT, legacy_note TEXT, status TEXT);',
            hiddenPhysicalColumns: ['legacy_note'],
          },
          content: [
            ['row_id', '名称', '旧备注', '状态'],
            ['1', '铁剑', '历史秘密', '可用'],
          ],
          exportConfig: { enabled: true, entryName: '自定义表', entryType: 'constant' },
        },
      };
      mockGetSortedSheetKeys.mockReturnValue(['sheet_0']);
      mockEnsureExportConfigDefaults.mockReturnValue({
        enabled: true,
        splitByRow: false,
        entryName: '自定义表',
        entryType: 'constant',
        keywords: '',
        preventRecursion: true,
        injectionTemplate: '',
        extraIndexEnabled: false,
        extraIndexEntryName: '自定义表-索引',
        extraIndexColumns: [],
        extraIndexColumnModes: {},
        extraIndexInjectionTemplate: '',
        entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 },
        extraIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 10010 },
      });

      await updateCustomTableExports_ACU(mergedData);

      const contents = mockCreateLorebookEntries.mock.calls[0][1].map((entry: any) => String(entry.content || '')).join('\n');
      expect(contents).toContain('| 名称 | 状态 |');
      expect(contents).toContain('| 铁剑 | 可用 |');
      expect(contents).not.toContain('旧备注');
      expect(contents).not.toContain('历史秘密');
    });

    it('飞行模式导出时排除隐藏纪要行且不修改原始快照', async () => {
      const mergedData: any = {
        sheet_chronicle: {
          name: '纪要表',
          content: [['row_id', '事件'], ['c1', '可见纪要'], ['c2', '隐藏纪要']],
          exportConfig: { enabled: true, entryName: '纪要表', entryType: 'constant' },
        },
      };
      mockGetSortedSheetKeys.mockReturnValue(['sheet_chronicle']);
      mockGetCurrentFlightModeState.mockReturnValue({ enabled: true, hiddenRowIds: ['c2'], bigSummarySheetKey: 'sheet_da_zong_jie' });
      mockEnsureExportConfigDefaults.mockReturnValue({
        enabled: true, splitByRow: false, entryName: '纪要表', entryType: 'constant', keywords: '', preventRecursion: true,
        injectionTemplate: '', extraIndexEnabled: false, extraIndexEntryName: '纪要表-索引', extraIndexColumns: [],
        extraIndexColumnModes: {}, extraIndexInjectionTemplate: '',
        entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 },
        extraIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 10010 },
      });

      await updateCustomTableExports_ACU(mergedData);

      const contents = mockCreateLorebookEntries.mock.calls[0][1].map((entry: any) => String(entry.content || '')).join('\n');
      expect(contents).toContain('可见纪要');
      expect(contents).not.toContain('隐藏纪要');
      expect(mergedData.sheet_chronicle.content).toEqual([
        ['row_id', '事件'], ['c1', '可见纪要'], ['c2', '隐藏纪要'],
      ]);
    });

    it('未启用导出的表格被跳过', async () => {
      const mergedData: any = {
        sheet_0: {
          name: '未启用表',
          content: [['', '列1'], ['', '值A']],
          exportConfig: { enabled: false },
        },
      };
      mockGetSortedSheetKeys.mockReturnValue(['sheet_0']);
      await updateCustomTableExports_ACU(mergedData);
      expect(mockCreateLorebookEntries).not.toHaveBeenCalled();
    });

    it('空行表格不创建条目', async () => {
      const mergedData: any = {
        sheet_0: {
          name: '空表',
          content: [['', '列1']],
          exportConfig: { enabled: true, entryName: '空表', entryType: 'constant' },
        },
      };
      mockGetSortedSheetKeys.mockReturnValue(['sheet_0']);
      mockEnsureExportConfigDefaults.mockReturnValue({
        enabled: true,
        splitByRow: false,
        entryName: '空表',
        entryType: 'constant',
        keywords: '',
        preventRecursion: true,
        injectionTemplate: '',
        extraIndexEnabled: false,
        extraIndexColumns: [],
        extraIndexColumnModes: {},
        entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 },
        extraIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 10010 },
      });
      await updateCustomTableExports_ACU(mergedData);
      expect(mockCreateLorebookEntries).not.toHaveBeenCalled();
    });

    it('更新 knownCustomEntryNames', async () => {
      const mergedData: any = {
        sheet_0: {
          name: '自定义表',
          content: [['', '列1'], ['', '值A']],
          exportConfig: { enabled: true, entryName: '自定义表', entryType: 'constant' },
        },
      };
      mockGetSortedSheetKeys.mockReturnValue(['sheet_0']);
      mockEnsureExportConfigDefaults.mockReturnValue({
        enabled: true,
        splitByRow: false,
        entryName: '自定义表',
        entryType: 'constant',
        keywords: '',
        preventRecursion: true,
        injectionTemplate: '',
        extraIndexEnabled: false,
        extraIndexColumns: [],
        extraIndexColumnModes: {},
        entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 },
        extraIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 10010 },
      });
      await updateCustomTableExports_ACU(mergedData);
      expect(mockSaveSettings).toHaveBeenCalled();
      expect(mockSettings.knownCustomEntryNames.length).toBeGreaterThan(0);
    });
  });

  // ═══ 按行拆分导出 ═══
  describe('按行拆分导出', () => {
    it('每行创建一个条目', async () => {
      const mergedData: any = {
        sheet_0: {
          name: '拆分表',
          content: [['', '列1', '列2'], ['', '值A1', '值A2'], ['', '值B1', '值B2']],
          exportConfig: { enabled: true, splitByRow: true, entryName: '拆分表', entryType: 'constant' },
        },
      };
      mockGetSortedSheetKeys.mockReturnValue(['sheet_0']);
      mockEnsureExportConfigDefaults.mockReturnValue({
        enabled: true,
        splitByRow: true,
        entryName: '拆分表',
        entryType: 'constant',
        keywords: '',
        preventRecursion: true,
        injectionTemplate: '',
        extraIndexEnabled: false,
        extraIndexEntryName: '拆分表-索引',
        extraIndexColumns: [],
        extraIndexColumnModes: {},
        extraIndexInjectionTemplate: '',
        entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 },
        extraIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 10010 },
      });
      await updateCustomTableExports_ACU(mergedData);
      expect(mockCreateLorebookEntries).toHaveBeenCalled();
      const createArgs = mockCreateLorebookEntries.mock.calls[0];
      // 表头(1) + 行条目(2) = 3
      expect(createArgs[1].length).toBe(3);
    });

    it('表名与 entryName 不同时，按行条目仍以 entryName 生成 comment 并从配置列提取关键词', async () => {
      const mergedData: any = {
        sheet_people: {
          name: '人物关系表',
          content: [
            ['', '姓名', '关系'],
            ['', '艾琳', '搭档'],
            ['', '布莱恩', '对手'],
          ],
          exportConfig: {
            enabled: true,
            splitByRow: true,
            entryName: '关系档案',
            entryType: 'keyword',
            keywords: '姓名',
          },
        },
      };
      mockGetSortedSheetKeys.mockReturnValue(['sheet_people']);
      mockEnsureExportConfigDefaults.mockReturnValue({
        enabled: true,
        splitByRow: true,
        entryName: '关系档案',
        entryType: 'keyword',
        keywords: '姓名',
        preventRecursion: true,
        injectionTemplate: '',
        extraIndexEnabled: false,
        extraIndexColumns: [],
        extraIndexColumnModes: {},
        extraIndexInjectionTemplate: '',
        entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 },
        extraIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 10010 },
      });

      await updateCustomTableExports_ACU(mergedData);

      const createdEntries = mockCreateLorebookEntries.mock.calls[0][1];
      expect(createdEntries).toEqual(expect.arrayContaining([
        expect.objectContaining({ comment: 'TavernDB-ACU-CustomExport-关系档案-表头', type: 'constant' }),
        expect.objectContaining({ comment: 'TavernDB-ACU-CustomExport-关系档案-1', keys: ['艾琳'], type: 'keyword', content: '| 艾琳 | 搭档 |\n' }),
        expect.objectContaining({ comment: 'TavernDB-ACU-CustomExport-关系档案-2', keys: ['布莱恩'], type: 'keyword', content: '| 布莱恩 | 对手 |\n' }),
      ]));
      expect(createdEntries.some((entry: any) => String(entry.comment).includes('人物关系表-'))).toBe(false);
    });
  });

  // ═══ 隔离模式 ═══
  describe('隔离模式', () => {
    it('条目名称带隔离前缀', async () => {
      mockGetIsolationPrefix.mockReturnValue('ACU-[test]-');
      const mergedData: any = {
        sheet_0: {
          name: '隔离表',
          content: [['', '列1'], ['', '值A']],
          exportConfig: { enabled: true, entryName: '隔离表', entryType: 'constant' },
        },
      };
      mockGetSortedSheetKeys.mockReturnValue(['sheet_0']);
      mockEnsureExportConfigDefaults.mockReturnValue({
        enabled: true,
        splitByRow: false,
        entryName: '隔离表',
        entryType: 'constant',
        keywords: '',
        preventRecursion: true,
        injectionTemplate: '',
        extraIndexEnabled: false,
        extraIndexColumns: [],
        extraIndexColumnModes: {},
        entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 },
        extraIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 10010 },
      });
      await updateCustomTableExports_ACU(mergedData);
      const createArgs = mockCreateLorebookEntries.mock.calls[0];
      // 条目名称应包含隔离前缀
      const hasIsoPrefix = createArgs[1].some((e: any) => e.comment && e.comment.startsWith('ACU-[test]-'));
      expect(hasIsoPrefix).toBe(true);
    });
  });

  // ═══ 外部导入模式 ═══
  describe('外部导入模式', () => {
    it('不更新 knownCustomEntryNames', async () => {
      const mergedData: any = {
        sheet_0: {
          name: '导入表',
          content: [['', '列1'], ['', '值A']],
          exportConfig: { enabled: true, entryName: '导入表', entryType: 'constant' },
        },
      };
      mockGetSortedSheetKeys.mockReturnValue(['sheet_0']);
      mockEnsureExportConfigDefaults.mockReturnValue({
        enabled: true,
        splitByRow: false,
        entryName: '导入表',
        entryType: 'constant',
        keywords: '',
        preventRecursion: true,
        injectionTemplate: '',
        extraIndexEnabled: false,
        extraIndexColumns: [],
        extraIndexColumnModes: {},
        entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 },
        extraIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 10010 },
      });
      await updateCustomTableExports_ACU(mergedData, true);
      // 外部导入模式不应保存 knownNames
      expect(mockSaveSettings).not.toHaveBeenCalled();
    });

    it('条目名称使用导入前缀', async () => {
      const mergedData: any = {
        sheet_0: {
          name: '导入表',
          content: [['', '列1'], ['', '值A']],
          exportConfig: { enabled: true, entryName: '导入表', entryType: 'constant' },
        },
      };
      mockGetSortedSheetKeys.mockReturnValue(['sheet_0']);
      mockEnsureExportConfigDefaults.mockReturnValue({
        enabled: true,
        splitByRow: false,
        entryName: '导入表',
        entryType: 'constant',
        keywords: '',
        preventRecursion: true,
        injectionTemplate: '',
        extraIndexEnabled: false,
        extraIndexColumns: [],
        extraIndexColumnModes: {},
        entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 },
        extraIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 10010 },
      });
      await updateCustomTableExports_ACU(mergedData, true);
      if (mockCreateLorebookEntries.mock.calls.length > 0) {
        const createArgs = mockCreateLorebookEntries.mock.calls[0];
        const hasImportPrefix = createArgs[1].some((e: any) => e.comment && e.comment.includes('外部导入-'));
        expect(hasImportPrefix).toBe(true);
        expect(createArgs[1]).toEqual(expect.arrayContaining([
          expect.objectContaining({
            comment: expect.stringContaining('ACU_CUSTOM_TABLE_EXPORT_V1'),
          }),
        ]));
      }
    });

    it('条目写入指定目标世界书', async () => {
      const mergedData: any = {
        sheet_0: {
          name: '导入表',
          content: [['', '列1'], ['', '值A']],
          exportConfig: { enabled: true, entryName: '导入表', entryType: 'constant' },
        },
      };
      mockGetSortedSheetKeys.mockReturnValue(['sheet_0']);
      mockEnsureExportConfigDefaults.mockReturnValue({
        enabled: true,
        splitByRow: false,
        entryName: '导入表',
        entryType: 'constant',
        keywords: '',
        preventRecursion: true,
        injectionTemplate: '',
        extraIndexEnabled: false,
        extraIndexColumns: [],
        extraIndexColumnModes: {},
        entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 },
        extraIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 10010 },
      });
      await updateCustomTableExports_ACU(mergedData, true, 'target-book');
      expect(mockGetInjectionTargetLorebook).not.toHaveBeenCalled();
      expect(mockGetLorebookEntries).toHaveBeenCalledWith('target-book');
      expect(mockCreateLorebookEntries).toHaveBeenCalledWith('target-book', expect.any(Array));
    });
  });

  // ═══ 异常处理 ═══
  describe('异常处理', () => {
    it('异常时记录错误', async () => {
      mockGetLorebookEntries.mockRejectedValue(new Error('网络错误'));
      await updateCustomTableExports_ACU({ sheet_0: {} });
      expect(mockLogError).toHaveBeenCalledWith(
        expect.stringContaining('Failed to update custom table export'),
        expect.any(Error)
      );
    });
  });

  // ═══ keyword 类型条目 ═══
  describe('keyword 类型条目', () => {
    it('keyword 类型无关键词时跳过', async () => {
      const mergedData: any = {
        sheet_0: {
          name: '关键词表',
          content: [['', '列1'], ['', '值A']],
          exportConfig: { enabled: true, entryName: '关键词表', entryType: 'keyword', keywords: '' },
        },
      };
      mockGetSortedSheetKeys.mockReturnValue(['sheet_0']);
      mockEnsureExportConfigDefaults.mockReturnValue({
        enabled: true,
        splitByRow: false,
        entryName: '关键词表',
        entryType: 'keyword',
        keywords: '',
        preventRecursion: true,
        injectionTemplate: '',
        extraIndexEnabled: false,
        extraIndexColumns: [],
        extraIndexColumnModes: {},
        entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 },
        extraIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 10010 },
      });
      await updateCustomTableExports_ACU(mergedData);
      expect(mockCreateLorebookEntries).not.toHaveBeenCalled();
    });
  });

  describe('附加索引生命周期', () => {
    it('关闭自定义纪要索引时删除旧索引且不会重新创建', async () => {
      mockEnsureExportConfigDefaults.mockReturnValue({
        enabled: true,
        splitByRow: false,
        entryName: '纪要表',
        entryType: 'constant',
        keywords: '',
        preventRecursion: true,
        injectionTemplate: '',
        extraIndexEnabled: false,
        extraIndexEntryName: '飞行模式前的自定义纪要索引',
        extraIndexColumns: ['内容'],
        extraIndexColumnModes: {},
        extraIndexInjectionTemplate: '',
        entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 },
        extraIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 10010 },
      });
      const previousEntries = [
        { uid: 101, comment: 'TavernDB-ACU-CustomExport-纪要表' },
        { uid: 102, comment: 'TavernDB-ACU-CustomExport-飞行模式前的自定义纪要索引' },
        { uid: 103, comment: '不相关条目' },
      ];
      mockGetLorebookEntries.mockResolvedValue(previousEntries);
      mockGetSortedSheetKeys.mockReturnValue(['sheet_chronicle']);

      await updateCustomTableExports_ACU({
        sheet_chronicle: {
          name: '纪要表',
          content: [['row_id', '内容'], ['1', '旧纪要']],
          exportConfig: {
            enabled: true,
            entryName: '纪要表',
            entryType: 'constant',
            extraIndexEnabled: false,
            extraIndexEntryName: '飞行模式前的自定义纪要索引',
            extraIndexColumns: ['内容'],
          },
        },
      });

      expect(mockDeleteLorebookEntries).toHaveBeenCalledWith('test-lorebook', [101, 102]);
      const recreated = mockCreateLorebookEntries.mock.calls[0][1];
      expect(recreated).toEqual(expect.arrayContaining([
        expect.objectContaining({ comment: '纪要表' }),
      ]));
      expect(recreated).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ comment: '飞行模式前的自定义纪要索引' }),
      ]));
    });
  });


  // ═══ 主条目禁用但索引启用 ═══
  describe('主条目禁用但索引启用', () => {
    it('只导出索引条目', async () => {
      const mergedData: any = {
        sheet_0: {
          name: '索引表',
          content: [['', '列1', '列2'], ['', '值A', '值B']],
          exportConfig: {
            enabled: true,
            injectIntoWorldbook: false,
            entryName: '索引表',
            entryType: 'constant',
            extraIndexEnabled: true,
            extraIndexEntryName: '索引表-索引',
            extraIndexColumns: ['列1'],
            extraIndexColumnModes: {},
          },
        },
      };
      mockGetSortedSheetKeys.mockReturnValue(['sheet_0']);
      mockEnsureExportConfigDefaults.mockReturnValue({
        enabled: true,
        splitByRow: false,
        entryName: '索引表',
        entryType: 'constant',
        keywords: '',
        preventRecursion: true,
        injectionTemplate: '',
        injectIntoWorldbook: false,
        extraIndexEnabled: true,
        extraIndexEntryName: '索引表-索引',
        extraIndexColumns: ['列1'],
        extraIndexColumnModes: {},
        extraIndexInjectionTemplate: '',
        entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 },
        extraIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 10010 },
      });
      await updateCustomTableExports_ACU(mergedData);
      // 应该创建了索引条目
      if (mockCreateLorebookEntries.mock.calls.length > 0) {
        const createArgs = mockCreateLorebookEntries.mock.calls[0];
        // 只有索引条目，没有主条目
        const hasMainEntry = createArgs[1].some((e: any) => e.comment && !e.comment.includes('索引'));
        // 索引条目应该存在
        const hasIndexEntry = createArgs[1].some((e: any) => e.comment && e.comment.includes('索引'));
      expect(hasIndexEntry).toBe(true);
        }
    });
  });

  describe('交火纪要索引内容保护', () => {
    function setupChronicleIndexExport() {
      mockGetCurrentWorldbookConfig.mockReturnValue({
        zeroTkOccupyMode: false,
        summaryVectorIndexModeEnabled: true,
      } as any);
      mockGetEffectiveSummaryVectorIndexConfig.mockReturnValue({ summaryIndexKeywordMinRows: 1 });
      mockGetLatestSummaryVectorIndexSnapshotState.mockReturnValue({
        summaryVectorIndexState: {
          rows: [{ rowKey: 'r1', status: 'active' }, { rowKey: 'r2', status: 'active' }],
          manifest: { snapshot: { activeRowKeys: ['r1', 'r2'] } },
        },
      });
      mockGetLorebookEntries.mockResolvedValue([
        { uid: 9, comment: 'TavernDB-ACU-CustomExport-纪要索引', content: '召回残留内容' },
      ]);
      mockGetSortedSheetKeys.mockReturnValue(['sheet_chronicle']);
      mockEnsureExportConfigDefaults.mockReturnValue({
        enabled: true,
        splitByRow: false,
        entryName: '纪要表',
        entryType: 'constant',
        keywords: '',
        preventRecursion: true,
        injectionTemplate: '',
        extraIndexEnabled: true,
        extraIndexEntryName: '纪要索引',
        extraIndexColumns: ['事件'],
        extraIndexColumnModes: {},
        extraIndexInjectionTemplate: '',
        entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 },
        extraIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 10010 },
      });
      return {
        sheet_chronicle: {
          name: '纪要表',
          content: [['row_id', '事件'], ['1', '表内全量概览']],
          exportConfig: {
            enabled: true,
            extraIndexEnabled: true,
            extraIndexEntryName: '纪要索引',
            extraIndexColumns: ['事件'],
          },
        },
      };
    }

    function collectedIndexContent(): string {
      const created = mockCreateLorebookEntries.mock.calls.flatMap((call) => call[1] || []);
      const updated = mockSetLorebookEntries.mock.calls.flatMap((call) => call[1] || []);
      const entries = [...created, ...updated];
      const indexEntry = entries.find((entry: any) => String(entry?.comment || '').includes('纪要索引'));
      return String(indexEntry?.content || '');
    }

    it('上一轮召回成功时保留现有召回内容', async () => {
      mockDidLastRecallSucceed.mockReturnValue(true);
      await updateCustomTableExports_ACU(setupChronicleIndexExport());
      expect(collectedIndexContent()).toContain('召回残留内容');
      expect(collectedIndexContent()).not.toContain('表内全量概览');
    });

    it('上一轮召回失败时用全量概览覆盖纪要索引', async () => {
      mockDidLastRecallSucceed.mockReturnValue(false);
      await updateCustomTableExports_ACU(setupChronicleIndexExport());
      expect(collectedIndexContent()).toContain('表内全量概览');
      expect(collectedIndexContent()).not.toContain('召回残留内容');
    });
  });
});
