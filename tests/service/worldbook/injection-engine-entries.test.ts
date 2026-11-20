
/**
 * tests/service/worldbook/injection-engine-entries.test.ts
 * 世界书注入引擎条目管理 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockGetCurrentWorldbookConfig,
  mockIsWorldbookApiAvailable, mockGetLorebookEntries, mockSetLorebookEntries,
  mockCreateLorebookEntries, mockDeleteLorebookEntries,
  mockLogDebug, mockLogError, mockLogWarn,
  mockGetImportBatchPrefix,
  mockEnsureExportConfigDefaults, mockNormalizePlacementConfig,
  mockGetFixedPlacementDefaultsForTable, mockApplyPlacementToEntry, mockIsEntryPlacementMatched,
  mockBuildUsedOrderSet, mockAllocOrder, mockAllocConsecutiveOrderBlock,
  mockGetInjectionTargetLorebook, mockGetIsolationPrefix,
} = vi.hoisted(() => ({
  mockGetCurrentWorldbookConfig: vi.fn(() => ({
    zeroTkOccupyMode: false,
  })),
  mockIsWorldbookApiAvailable: vi.fn(() => true),
  mockGetLorebookEntries: vi.fn(async () => []),
  mockSetLorebookEntries: vi.fn(async () => {}),
  mockCreateLorebookEntries: vi.fn(async () => {}),
  mockDeleteLorebookEntries: vi.fn(async () => {}),
  mockLogDebug: vi.fn(),
  mockLogError: vi.fn(),
  mockLogWarn: vi.fn(),
  mockGetImportBatchPrefix: vi.fn(() => '外部导入-'),
  mockEnsureExportConfigDefaults: vi.fn((cfg: any) => ({
    fixedEntryPlacement: { position: 'at_depth_as_system', depth: 9999, order: 99987 },
    fixedIndexPlacement: { position: 'at_depth_as_system', depth: 9999, order: 99988 },
    ...cfg,
  })),
  mockNormalizePlacementConfig: vi.fn((raw: any, fallback: any) => raw || fallback),
  mockGetFixedPlacementDefaultsForTable: vi.fn(() => ({
    entry: { position: 'at_depth_as_system', depth: 9999, order: 99987 },
    index: { position: 'at_depth_as_system', depth: 9999, order: 99988 },
  })),
  mockApplyPlacementToEntry: vi.fn((entry: any, placement: any) => ({ ...entry, ...placement })),
  mockIsEntryPlacementMatched: vi.fn(() => true),
  mockBuildUsedOrderSet: vi.fn(() => new Set<number>()),
  mockAllocOrder: vi.fn(() => 10001),
  mockAllocConsecutiveOrderBlock: vi.fn(() => 100),
  mockGetInjectionTargetLorebook: vi.fn(async () => 'test-lorebook'),
  mockGetIsolationPrefix: vi.fn(() => ''),
}));

vi.mock('../../../src/service/settings/settings-readers', () => ({
  getCurrentWorldbookConfig_ACU: mockGetCurrentWorldbookConfig,
}));

vi.mock('../../../src/service/fill-mode/fill-mode-gate', () => ({
  isVectorPipelineEnabledForCurrentChat_ACU: () => false,
}));

vi.mock('../../../src/data/gateways/worldbook-gateway', () => ({
  isWorldbookApiAvailable_ACU: mockIsWorldbookApiAvailable,
  getLorebookEntries_ACU: mockGetLorebookEntries,
  setLorebookEntries_ACU: mockSetLorebookEntries,
  createLorebookEntries_ACU: mockCreateLorebookEntries,
  deleteLorebookEntries_ACU: mockDeleteLorebookEntries,
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: mockLogDebug,
  logError_ACU: mockLogError,
  logWarn_ACU: mockLogWarn,
}));

vi.mock('../../../src/shared/constants', () => ({
  getImportBatchPrefix_ACU: mockGetImportBatchPrefix,
}));

vi.mock('../../../src/service/worldbook/injection-engine-config', () => ({
  ensureExportConfigDefaults_ACU: mockEnsureExportConfigDefaults,
  normalizePlacementConfig_ACU: mockNormalizePlacementConfig,
  getFixedPlacementDefaultsForTable_ACU: mockGetFixedPlacementDefaultsForTable,
  applyPlacementToEntry_ACU: mockApplyPlacementToEntry,
  isEntryPlacementMatched_ACU: mockIsEntryPlacementMatched,
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

import {
  splitKeywordsByComma_ACU,
  updateOutlineTableEntry_ACU,
  updateSummaryTableEntries_ACU,
  updateImportantPersonsRelatedEntries_ACU,
} from '../../../src/service/worldbook/injection-engine-entries';

beforeEach(() => {
  vi.clearAllMocks();
  mockIsWorldbookApiAvailable.mockReturnValue(true);
  mockGetInjectionTargetLorebook.mockResolvedValue('test-lorebook');
  mockGetIsolationPrefix.mockReturnValue('');
  mockGetLorebookEntries.mockResolvedValue([]);
  mockBuildUsedOrderSet.mockReturnValue(new Set<number>());
  mockAllocOrder.mockReturnValue(10001);
  mockAllocConsecutiveOrderBlock.mockReturnValue(100);
  mockGetCurrentWorldbookConfig.mockReturnValue({ zeroTkOccupyMode: false });
});

// ═══ splitKeywordsByComma_ACU ═══
describe('splitKeywordsByComma_ACU', () => {
  it('英文逗号分割', () => {
    expect(splitKeywordsByComma_ACU('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('中文逗号分割', () => {
    expect(splitKeywordsByComma_ACU('甲，乙，丙')).toEqual(['甲', '乙', '丙']);
  });

  it('混合逗号分割', () => {
    expect(splitKeywordsByComma_ACU('a，b,c')).toEqual(['a', 'b', 'c']);
  });

  it('去除前后空格', () => {
    expect(splitKeywordsByComma_ACU(' a , b , c ')).toEqual(['a', 'b', 'c']);
  });

  it('过滤空字符串', () => {
    expect(splitKeywordsByComma_ACU('a,,b')).toEqual(['a', 'b']);
  });

  it('空输入返回空数组', () => {
    expect(splitKeywordsByComma_ACU('')).toEqual([]);
    expect(splitKeywordsByComma_ACU(null as any)).toEqual([]);
  });

  it('单个关键词', () => {
    expect(splitKeywordsByComma_ACU('单独')).toEqual(['单独']);
  });
});

// ═══ updateOutlineTableEntry_ACU ═══
describe('updateOutlineTableEntry_ACU', () => {
  it('API 不可用时直接返回', async () => {
    mockIsWorldbookApiAvailable.mockReturnValue(false);
    await updateOutlineTableEntry_ACU({ name: '总体大纲', content: [['', '列1'], ['', '值1']] });
    expect(mockGetLorebookEntries).not.toHaveBeenCalled();
  });

  it('无 lorebook 时直接返回', async () => {
    mockGetInjectionTargetLorebook.mockResolvedValue(null);
    await updateOutlineTableEntry_ACU({ name: '总体大纲', content: [['', '列1'], ['', '值1']] });
    expect(mockGetLorebookEntries).not.toHaveBeenCalled();
  });

  it('空表格数据时删除已有条目', async () => {
    mockGetLorebookEntries.mockResolvedValue([
      { uid: 1, comment: 'TavernDB-ACU-OutlineTable' },
    ]);
    await updateOutlineTableEntry_ACU(null);
    expect(mockDeleteLorebookEntries).toHaveBeenCalledWith('test-lorebook', [1]);
  });

  it('表格只有表头时删除已有条目', async () => {
    mockGetLorebookEntries.mockResolvedValue([
      { uid: 1, comment: 'TavernDB-ACU-OutlineTable' },
    ]);
    await updateOutlineTableEntry_ACU({ name: '总体大纲', content: [['', '列1']] });
    expect(mockDeleteLorebookEntries).toHaveBeenCalledWith('test-lorebook', [1]);
  });

  it('已有条目时更新', async () => {
    mockGetLorebookEntries.mockResolvedValue([
      { uid: 1, comment: 'TavernDB-ACU-OutlineTable', content: '旧内容', enabled: true, type: 'constant', prevent_recursion: true },
    ]);
    mockIsEntryPlacementMatched.mockReturnValue(false); // 触发更新
    await updateOutlineTableEntry_ACU({ name: '总体大纲', content: [['', '列1'], ['', '值1']] });
    expect(mockSetLorebookEntries).toHaveBeenCalled();
  });

  it('无已有条目时创建', async () => {
    mockGetLorebookEntries.mockResolvedValue([]);
    await updateOutlineTableEntry_ACU({ name: '总体大纲', content: [['', '列1'], ['', '值1']] });
    expect(mockCreateLorebookEntries).toHaveBeenCalled();
    const createArgs = mockCreateLorebookEntries.mock.calls[0];
    expect(createArgs[0]).toBe('test-lorebook');
    expect(createArgs[1][0].comment).toBe('TavernDB-ACU-OutlineTable');
  });

  it('总体大纲条目不包含隐藏 physical column，并保持后续列对齐', async () => {
    await updateOutlineTableEntry_ACU({
      name: '总体大纲',
      sourceData: {
        ddl: 'CREATE TABLE outline (row_id INTEGER PRIMARY KEY, chapter TEXT, legacy_note TEXT, plot TEXT);',
        hiddenPhysicalColumns: ['legacy_note'],
      },
      content: [
        ['row_id', '章节', '旧备注', '剧情'],
        ['1', '第一章', '历史秘密', '启程'],
      ],
    });

    const content = mockCreateLorebookEntries.mock.calls[0][1][0].content;
    expect(content).toContain('| 章节 | 剧情 |');
    expect(content).toContain('| 第一章 | 启程 |');
    expect(content).not.toContain('旧备注');
    expect(content).not.toContain('历史秘密');
  });

  it('外部导入模式使用导入前缀', async () => {
    mockGetLorebookEntries.mockResolvedValue([]);
    await updateOutlineTableEntry_ACU({ name: '总体大纲', content: [['', '列1'], ['', '值1']] }, true);
    const createArgs = mockCreateLorebookEntries.mock.calls[0];
    expect(createArgs[1][0].comment).toContain('外部导入-');
  });

  it('外部导入模式优先写入指定目标世界书', async () => {
    mockGetLorebookEntries.mockResolvedValue([]);
    await updateOutlineTableEntry_ACU({ name: '总体大纲', content: [['', '列1'], ['', '值1']] }, true, 'target-book');
    expect(mockGetInjectionTargetLorebook).not.toHaveBeenCalled();
    expect(mockGetLorebookEntries).toHaveBeenCalledWith('target-book');
    expect(mockCreateLorebookEntries).toHaveBeenCalledWith('target-book', expect.any(Array));
  });

  it('隔离模式使用隔离前缀', async () => {
    mockGetIsolationPrefix.mockReturnValue('ACU-[test]-');
    mockGetLorebookEntries.mockResolvedValue([]);
    await updateOutlineTableEntry_ACU({ name: '总体大纲', content: [['', '列1'], ['', '值1']] });
    const createArgs = mockCreateLorebookEntries.mock.calls[0];
    expect(createArgs[1][0].comment).toBe('ACU-[test]-TavernDB-ACU-OutlineTable');
  });

  it('0TK 占用模式下条目 enabled 为 false', async () => {
    mockGetCurrentWorldbookConfig.mockReturnValue({ zeroTkOccupyMode: true });
    mockGetLorebookEntries.mockResolvedValue([]);
    await updateOutlineTableEntry_ACU({ name: '总体大纲', content: [['', '列1'], ['', '值1']] });
    const createArgs = mockCreateLorebookEntries.mock.calls[0];
    expect(createArgs[1][0].enabled).toBe(false);
  });

  it('异常时记录错误', async () => {
    mockGetLorebookEntries.mockRejectedValue(new Error('网络错误'));
    await updateOutlineTableEntry_ACU({ name: '总体大纲', content: [['', '列1'], ['', '值1']] });
    expect(mockLogError).toHaveBeenCalledWith(expect.stringContaining('Failed to update outline'), expect.any(Error));
  });
});

// ═══ updateSummaryTableEntries_ACU ═══
describe('updateSummaryTableEntries_ACU', () => {
  const summaryTable = {
    name: '总结表',
    content: [
      ['', '编码索引', '内容'],
      ['', 'AM0001', '第一条总结'],
      ['', 'AM0002', '第二条总结'],
    ],
  };

  it('API 不可用时直接返回', async () => {
    mockIsWorldbookApiAvailable.mockReturnValue(false);
    await updateSummaryTableEntries_ACU(summaryTable);
    expect(mockGetLorebookEntries).not.toHaveBeenCalled();
  });

  it('无 lorebook 时直接返回', async () => {
    mockGetInjectionTargetLorebook.mockResolvedValue(null);
    await updateSummaryTableEntries_ACU(summaryTable);
    expect(mockGetLorebookEntries).not.toHaveBeenCalled();
  });

  it('非导入模式先删除旧条目再创建', async () => {
    mockGetLorebookEntries.mockResolvedValue([
      { uid: 1, comment: '总结条目1' },
      { uid: 2, comment: '总结条目2' },
    ]);
    await updateSummaryTableEntries_ACU(summaryTable);
    expect(mockDeleteLorebookEntries).toHaveBeenCalledWith('test-lorebook', [1, 2]);
    expect(mockCreateLorebookEntries).toHaveBeenCalled();
  });

  it('导入模式不删除旧条目', async () => {
    mockGetLorebookEntries.mockResolvedValue([
      { uid: 1, comment: '外部导入-总结条目1' },
    ]);
    await updateSummaryTableEntries_ACU(summaryTable, true);
    expect(mockDeleteLorebookEntries).not.toHaveBeenCalled();
    expect(mockCreateLorebookEntries).toHaveBeenCalled();
  });

  it('外部导入模式的总结条目写入指定目标世界书', async () => {
    await updateSummaryTableEntries_ACU(summaryTable, true, 'target-book');
    expect(mockGetInjectionTargetLorebook).not.toHaveBeenCalled();
    expect(mockGetLorebookEntries).toHaveBeenCalledWith('target-book');
    expect(mockCreateLorebookEntries).toHaveBeenCalledWith('target-book', expect.any(Array));
  });

  it('创建的条目使用 keyword 类型', async () => {
    await updateSummaryTableEntries_ACU(summaryTable);
    const createArgs = mockCreateLorebookEntries.mock.calls[0];
    expect(createArgs[1].length).toBe(2); // 2 行数据
    expect(createArgs[1][0].type).toBe('keyword');
    expect(createArgs[1][0].keys).toEqual(['AM0001']);
  });

  it('总结条目不包含隐藏 physical column，关键词列投影后仍正确定位', async () => {
    await updateSummaryTableEntries_ACU({
      name: '总结表',
      sourceData: {
        ddl: 'CREATE TABLE summary (row_id INTEGER PRIMARY KEY, code_index TEXT, legacy_note TEXT, content TEXT);',
        hiddenPhysicalColumns: ['legacy_note'],
      },
      content: [
        ['row_id', '编码索引', '旧备注', '内容'],
        ['1', 'AM0001', '历史秘密', '第一条总结'],
      ],
    });

    const entry = mockCreateLorebookEntries.mock.calls[0][1][0];
    expect(entry.keys).toEqual(['AM0001']);
    expect(entry.content).toBe('| AM0001 | 第一条总结 |\n');
    expect(entry.content).not.toContain('历史秘密');
  });

  it('无"编码索引"列时记录错误', async () => {
    const badTable = {
      name: '总结表',
      content: [['', '其他列'], ['', '数据']],
    };
    await updateSummaryTableEntries_ACU(badTable);
    expect(mockLogError).toHaveBeenCalledWith(expect.stringContaining('编码索引'));
    expect(mockCreateLorebookEntries).not.toHaveBeenCalled();
  });

  it('空表格数据不创建条目', async () => {
    const emptyTable = { name: '总结表', content: [['', '编码索引']] };
    await updateSummaryTableEntries_ACU(emptyTable);
    expect(mockCreateLorebookEntries).not.toHaveBeenCalled();
  });

  it('跳过无关键词的行', async () => {
    const tableWithEmptyKeyword = {
      name: '总结表',
      content: [
        ['', '编码索引', '内容'],
        ['', '', '无索引的行'],
      ['', 'AM0001', '有索引的行'],
      ],
    };
    await updateSummaryTableEntries_ACU(tableWithEmptyKeyword);
    const createArgs = mockCreateLorebookEntries.mock.calls[0];
    expect(createArgs[1].length).toBe(1); // 只有 1 行有效
  });

  it('异常时记录错误', async () => {
    mockGetLorebookEntries.mockRejectedValue(new Error('网络错误'));
    await updateSummaryTableEntries_ACU(summaryTable);
    expect(mockLogError).toHaveBeenCalledWith(expect.stringContaining('Failed to update summary'), expect.any(Error));
  });
});

// ═══ updateImportantPersonsRelatedEntries_ACU ═══
describe('updateImportantPersonsRelatedEntries_ACU', () => {
  const personsTable = {
    name: '重要人物表',
    content: [
      ['', '姓名', '描述'],
      ['', '角色A', '描述A'],
      ['', '角色B(别名)', '描述B'],
    ],
  };

  it('API 不可用时直接返回', async () => {
    mockIsWorldbookApiAvailable.mockReturnValue(false);
    await updateImportantPersonsRelatedEntries_ACU(personsTable);
    expect(mockGetLorebookEntries).not.toHaveBeenCalled();
  });

  it('无 lorebook 时直接返回', async () => {
    mockGetInjectionTargetLorebook.mockResolvedValue(null);
    await updateImportantPersonsRelatedEntries_ACU(personsTable);
    expect(mockGetLorebookEntries).not.toHaveBeenCalled();
  });

  it('非导入模式先删除旧条目', async () => {
    mockGetLorebookEntries.mockResolvedValue([
      { uid: 1, comment: '重要人物条目1' },
      { uid: 2, comment: 'TavernDB-ACU-ImportantPersonsIndex' },
    ]);
    await updateImportantPersonsRelatedEntries_ACU(personsTable);
    expect(mockDeleteLorebookEntries).toHaveBeenCalledWith('test-lorebook', [1, 2]);
  });

  it('导入模式不删除旧条目', async () => {
    mockGetLorebookEntries.mockResolvedValue([
      { uid: 1, comment: '外部导入-重要人物条目1' },
    ]);
    await updateImportantPersonsRelatedEntries_ACU(personsTable, true);
    expect(mockDeleteLorebookEntries).not.toHaveBeenCalled();
  });

  it('外部导入模式的重要人物条目写入指定目标世界书', async () => {
    await updateImportantPersonsRelatedEntries_ACU(personsTable, true, 'target-book');
    expect(mockGetInjectionTargetLorebook).not.toHaveBeenCalled();
    expect(mockGetLorebookEntries).toHaveBeenCalledWith('target-book');
    expect(mockCreateLorebookEntries).toHaveBeenCalledWith('target-book', expect.any(Array));
  });

  it('创建人物条目 + 表头 + 索引', async () => {
    await updateImportantPersonsRelatedEntries_ACU(personsTable);
    const createArgs = mockCreateLorebookEntries.mock.calls[0];
    // 表头(1) + 人物条目(2) + 索引(1) = 4
    expect(createArgs[1].length).toBe(4);
  });

  it('人物条目使用 keyword 类型', async () => {
    await updateImportantPersonsRelatedEntries_ACU(personsTable);
    const createArgs = mockCreateLorebookEntries.mock.calls[0];
    // 第 2 个条目（第 1 个人物条目，第 0 个是表头）
    expect(createArgs[1][1].type).toBe('keyword');
  });

  it('括号前的名称作为额外关键词', async () => {
    await updateImportantPersonsRelatedEntries_ACU(personsTable);
    const createArgs = mockCreateLorebookEntries.mock.calls[0];
    // 角色B(别名) 应该生成 ['角色B(别名)', '角色B'] 两个关键词
    const personBEntry = createArgs[1][2]; // 第 3 个条目是角色B
    expect(personBEntry.keys).toContain('角色B');
  });

  it('重要人物条目与表头不包含隐藏 physical column，姓名索引保持正确', async () => {
    await updateImportantPersonsRelatedEntries_ACU({
      name: '重要人物表',
      sourceData: {
        ddl: 'CREATE TABLE persons (row_id INTEGER PRIMARY KEY, name TEXT, legacy_note TEXT, description TEXT);',
        hiddenPhysicalColumns: ['legacy_note'],
      },
      content: [
        ['row_id', '姓名', '旧备注', '描述'],
        ['1', '角色A', '历史秘密', '描述A'],
      ],
    });

    const entries = mockCreateLorebookEntries.mock.calls[0][1];
    const header = entries.find((entry: any) => String(entry.comment).includes('PersonsHeader'));
    const person = entries.find((entry: any) => String(entry.comment).startsWith('重要人物条目'));
    expect(header.content).toContain('| 姓名 | 描述 |');
    expect(header.content).not.toContain('旧备注');
    expect(person.keys).toEqual(['角色A']);
    expect(person.content).toBe('| 角色A | 描述A |');
    expect(person.content).not.toContain('历史秘密');
  });

  it('无"姓名"或"角色名"列时记录错误', async () => {
    const badTable = {
      name: '重要人物表',
      content: [['', '其他列'], ['', '数据']],
    };
    await updateImportantPersonsRelatedEntries_ACU(badTable);
    expect(mockLogError).toHaveBeenCalledWith(expect.stringContaining('姓名'));
  });

  it('空表格数据不创建条目', async () => {
    const emptyTable = { name: '重要人物表', content: [['', '姓名']] };
    await updateImportantPersonsRelatedEntries_ACU(emptyTable);
    expect(mockCreateLorebookEntries).not.toHaveBeenCalled();
  });

  it('隔离模式使用隔离前缀', async () => {
    mockGetIsolationPrefix.mockReturnValue('ACU-[test]-');
    await updateImportantPersonsRelatedEntries_ACU(personsTable);
    const createArgs = mockCreateLorebookEntries.mock.calls[0];
    expect(createArgs[1][0].comment).toContain('ACU-[test]-');
  });

  it('异常时记录错误', async () => {
    mockGetLorebookEntries.mockRejectedValue(new Error('网络错误'));
    await updateImportantPersonsRelatedEntries_ACU(personsTable);
    expect(mockLogError).toHaveBeenCalledWith(expect.stringContaining('Failed to update important persons'), expect.any(Error));
  });
});
