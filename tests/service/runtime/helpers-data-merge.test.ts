/**
 * tests/service/runtime/helpers-data-merge.test.ts
 * migrateContentNullToRowId 纯函数单元测试
 *
 * 策略：零 mock，直接测试输入输出
 * 注意：helpers-data-merge.ts 的导入链会触发 env.ts 中的 window.parent 访问，
 * 需要在 import 前 mock 掉 env.ts 和其他依赖浏览器环境的模块
 */
import { beforeEach, describe, it, expect, vi } from 'vitest';

// mock 掉所有依赖浏览器环境的模块
vi.mock('../../../src/shared/env', () => ({
  topLevelWindow_ACU: {},
  isLocalStorageDisabled_ACU: false,
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  isSummaryOrOutlineTable_ACU: vi.fn(() => false),
  parseTableTemplateJson_ACU: vi.fn(() => null),
  ensureSheetOrderNumbers_ACU: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  currentJsonTableData_ACU: null,
  settings_ACU: {},
  currentChatFileIdentifier_ACU: 'test-chat',
  independentTableStates_ACU: {},
  suppressWorldbookInjectionInGreeting_ACU: false,
  _set_suppressWorldbookInjectionInGreeting_ACU: vi.fn(),
  _set_currentJsonTableData_ACU: vi.fn(),
  getCurrentIsolationKey_ACU: vi.fn(() => ''),
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: vi.fn(() => []),
  saveChatToHost_ACU: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/service/settings/settings-service', () => ({
  applyTemplateScopeForCurrentChat_ACU: vi.fn(),
  saveSettings_ACU: vi.fn(),
}));

vi.mock('../../../src/service/template/chat-scope', () => ({
  buildChatSheetGuideDataFromTemplateObj_ACU: vi.fn(),
  getChatSheetGuideDataForIsolationKey_ACU: vi.fn(() => null),
  getSortedSheetKeys_ACU: vi.fn((data: any) => data ? Object.keys(data).filter((k: string) => k.startsWith('sheet_')).sort() : []),
  getTemplateSheetKeys_ACU: vi.fn(() => []),
  materializeDataFromSheetGuide_ACU: vi.fn(() => ({})),
  reorderDataBySheetKeys_ACU: vi.fn((data: any) => data),
  sanitizeTemplateSnapshotForChat_ACU: vi.fn(() => null),
  setChatSheetGuideDataForIsolationKey_ACU: vi.fn(),
  attachSeedRowsToCurrentDataFromGuide_ACU: vi.fn(),
  getEffectiveSeedRowsForSheet_ACU: vi.fn(() => []),
  ensureStableRowIdsForSheetContent_ACU: vi.fn((content: any[]) => {
    const copied = content.map(row => Array.isArray(row) ? [...row] : row);
    const reserved = new Set(
      copied.slice(1)
        .filter(Array.isArray)
        .map(row => String(row[0] ?? '').trim())
        .filter(Boolean),
    );
    let nextId = 1;
    for (const row of copied.slice(1)) {
      if (!Array.isArray(row)) continue;
      const rowId = String(row[0] ?? '').trim();
      if (rowId) {
        row[0] = rowId;
        continue;
      }
      while (reserved.has(String(nextId))) nextId += 1;
      row[0] = String(nextId);
      reserved.add(String(nextId));
      nextId += 1;
    }
    return copied;
  }),
}));

vi.mock('../../../src/service/worldbook/pipeline', () => ({
  deleteAllGeneratedEntries_ACU: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/data/repositories/chat-message-data-repo', () => ({
  readIsolatedTagData_ACU: vi.fn(() => null),
  readLegacyIndependentData_ACU: vi.fn(() => null),
  readLegacyStandardData_ACU: vi.fn(() => null),
  readLegacySummaryData_ACU: vi.fn(() => null),
  readModifiedKeys_ACU: vi.fn(() => []),
  readUpdateGroupKeys_ACU: vi.fn(() => []),
  readMessageIdentity_ACU: vi.fn(() => null),
  isLegacyMatchForIsolation_ACU: vi.fn(() => false),
  cloneIsolatedData_ACU: vi.fn((message: any) => JSON.parse(JSON.stringify(message?.TavernDB_ACU_IsolatedData || {}))),
  writeMessageIdentity_ACU: vi.fn(),
}));

vi.mock('../../../src/shared/template-preset-utils', () => ({
  deriveTemplatePresetNameForImport_ACU: vi.fn(() => ''),
}));

vi.mock('../../../src/service/template/template-preset-service', () => ({
  upsertTemplatePreset_ACU: vi.fn(() => true),
}));

vi.mock('../../../src/shared/constants', () => ({
  TABLE_ORDER_FIELD_ACU: 'orderNo',
}));

vi.mock('../../../src/service/table/storage-strategy-resolver', () => ({
  isV2TagData_ACU: vi.fn((tagData: any) => !!tagData?.storageFrame && tagData?._acu_storage_version === 2),
  resolveTableStorageStrategy_ACU: vi.fn(() => ({ mode: 'none' })),
}));

vi.mock('../../../src/service/table/storage-v2-migration', () => ({
  migrateLegacyStorageToV2OnLoad_ACU: vi.fn().mockResolvedValue({ migrated: true, data: null }),
}));

vi.mock('../../../src/service/table/storage-frame-v2-replay', () => ({
  loadTableStateFromFramesV2_ACU: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../src/service/table/storage-frame-v2-persist', () => ({
  persistTableMutationLogV2_ACU: vi.fn().mockResolvedValue({ saved: true, messageIndex: 0 }),
}));

vi.mock('../../../src/service/table/table-write-transaction', () => ({
  runTableWriteTransaction_ACU: vi.fn(async (_options: any, task: any) => task({
    transactionId: 'tx-test',
    chatKey: 'test-chat',
    isolationKey: '',
    source: _options.source,
    baseRevision: null,
    writeSet: _options.writeSet,
    runCommit: async (commitTask: any) => commitTask(),
  })),
}));

import { migrateContentNullToRowId, mergeAllIndependentTables_ACU } from '../../../src/service/runtime/helpers-data-merge';
import { getChatArray_ACU } from '../../../src/data/gateways/chat-gateway';
import { getChatSheetGuideDataForIsolationKey_ACU, materializeDataFromSheetGuide_ACU } from '../../../src/service/template/chat-scope';
import { resolveTableStorageStrategy_ACU } from '../../../src/service/table/storage-strategy-resolver';
import { loadTableStateFromFramesV2_ACU } from '../../../src/service/table/storage-frame-v2-replay';
import { migrateLegacyStorageToV2OnLoad_ACU } from '../../../src/service/table/storage-v2-migration';
import { logWarn_ACU, logError_ACU } from '../../../src/shared/utils';
import { normalizeSheetGuideRowIds_ACU } from '../../../src/service/template/chat-scope/sheet-guide-row-id-normalizer';

describe('migrateContentNullToRowId', () => {
  // ═══════════════════════════════════════════════════════════════
  // 正常迁移
  // ═══════════════════════════════════════════════════════════════
  it('将表头 null 替换为 "row_id"', () => {
    const data = {
      sheet_0: {
        name: '测试表',
        content: [
          [null, '名称', '数量'],
          [null, '铁剑', '3'],
          [null, '药水', '5'],
        ],
      },
    };
    const result = migrateContentNullToRowId(data);
    expect(result!.sheet_0.content[0][0]).toBe('row_id');
  });

  it('row_id 为 null 的历史数据行补发稳定身份而不删行（全版本兼容读取）', () => {
    const data = {
      sheet_0: {
        name: '测试表',
        content: [
          [null, '名称'],
          [null, '铁剑'],
          ['2', '药水'],
        ],
      },
    };
    const result = migrateContentNullToRowId(data);
    const content = result!.sheet_0.content;
    expect(content[0]).toEqual(['row_id', '名称']);
    expect(content).toHaveLength(3);
    // 旧协议按物理位置寻址、无行身份：读取时补发稳定 ID，业务数据一格不丢
    expect(String(content[1][0] ?? '').trim()).not.toBe('');
    expect(content[1][1]).toBe('铁剑');
    expect(content[2]).toEqual(['2', '药水']);
    expect(content[1][0]).not.toBe(content[2][0]);
  });

  it('多张表同时迁移', () => {
    const data = {
      sheet_0: {
        name: '表A',
        content: [[null, 'col1'], ['1', 'val1']],
      },
      sheet_1: {
        name: '表B',
        content: [[null, 'col2'], ['2', 'val2'], [null, 'val3']],
      },
    };
    const result = migrateContentNullToRowId(data);
    expect(result!.sheet_0.content[0][0]).toBe('row_id');
    expect(result!.sheet_0.content[1][0]).toBe('1');
    expect(result!.sheet_1.content[0][0]).toBe('row_id');
    expect(result!.sheet_1.content).toHaveLength(3);
    expect(result!.sheet_1.content[1]).toEqual(['2', 'val2']);
    // 空身份行补发稳定 ID 保留，不删行
    expect(result!.sheet_1.content[2][1]).toBe('val3');
    expect(String(result!.sheet_1.content[2][0] ?? '').trim()).not.toBe('');
  });

  // ═══════════════════════════════════════════════════════════════
  // 幂等性
  // ═══════════════════════════════════════════════════════════════
  it('已迁移的数据不重复处理（幂等）', () => {
    const data = {
      sheet_0: {
        name: '测试表',
        content: [
          ['row_id', '名称'],
          ['1', '铁剑'],
          ['2', '药水'],
        ],
      },
    };
    const result = migrateContentNullToRowId(data);
    expect(result!.sheet_0.content[0][0]).toBe('row_id');
    expect(result!.sheet_0.content[1][0]).toBe('1');
    expect(result!.sheet_0.content[2][0]).toBe('2');
  });

  it('表头为历史身份别名（id）时归一为 row_id 并保留行', () => {
    const data = {
      sheet_0: {
        name: '测试表',
        content: [
          ['id', '名称'],
          ['1', '铁剑'],
        ],
      },
    };
    const result = migrateContentNullToRowId(data);
    expect(result!.sheet_0.content[0][0]).toBe('row_id');
    expect(result!.sheet_0.content[1]).toEqual(['1', '铁剑']);
  });

  // ═══════════════════════════════════════════════════════════════
  // seedRows 迁移
  // ═══════════════════════════════════════════════════════════════
  it('seedRows 中 row_id 为 null 的行补发稳定身份而不删行', () => {
    const data = {
      sheet_0: {
        name: '测试表',
        content: [[null, '名称']],
        seedRows: [
          [null, '种子数据1'],
          ['2', '种子数据2'],
        ],
      },
    };
    const result = migrateContentNullToRowId(data);
    expect(result!.sheet_0.seedRows).toHaveLength(2);
    expect(result!.sheet_0.seedRows[0][1]).toBe('种子数据1');
    expect(String(result!.sheet_0.seedRows[0][0] ?? '').trim()).not.toBe('');
    expect(result!.sheet_0.seedRows[1]).toEqual(['2', '种子数据2']);
  });

  it('seedRows 不存在时不报错', () => {
    const data = {
      sheet_0: {
        name: '测试表',
        content: [[null, '名称'], [null, '铁剑']],
      },
    };
    expect(() => migrateContentNullToRowId(data)).not.toThrow();
  });

  it('seedRows 为空数组时不报错', () => {
    const data = {
      sheet_0: {
        name: '测试表',
        content: [[null, '名称']],
        seedRows: [],
      },
    };
    expect(() => migrateContentNullToRowId(data)).not.toThrow();
  });

  // ═══════════════════════════════════════════════════════════════
  // 边界条件
  // ═══════════════════════════════════════════════════════════════
  it('data 为 null 时返回 null', () => {
    expect(migrateContentNullToRowId(null)).toBeNull();
  });

  it('data 为 undefined 时返回 undefined', () => {
    expect(migrateContentNullToRowId(undefined as any)).toBeUndefined();
  });

  it('空对象返回空对象', () => {
    const result = migrateContentNullToRowId({});
    expect(result).toEqual({});
  });

  it('非 sheet_ 开头的键被跳过', () => {
    const data = {
      mate: { type: 'acu' },
      sheet_0: {
        name: '测试表',
        content: [[null, '名称'], [null, '铁剑']],
      },
    };
    const result = migrateContentNullToRowId(data);
    expect(result!.mate).toEqual({ type: 'acu' });
    expect(result!.sheet_0.content[0][0]).toBe('row_id');
  });

  it('content 为空数组时不报错', () => {
    const data = {
      sheet_0: {
        name: '测试表',
        content: [],
      },
    };
    expect(() => migrateContentNullToRowId(data)).not.toThrow();
  });

  it('content 不存在时不报错', () => {
    const data = {
      sheet_0: {
        name: '测试表',
      },
    };
    expect(() => migrateContentNullToRowId(data)).not.toThrow();
  });

  it('表头行为空数组时不报错', () => {
    const data = {
      sheet_0: {
        name: '测试表',
        content: [[]],
      },
    };
    expect(() => migrateContentNullToRowId(data)).not.toThrow();
  });

  it('只有表头行（无数据行）时正确迁移', () => {
    const data = {
      sheet_0: {
        name: '测试表',
        content: [[null, '名称', '数量']],
      },
    };
    const result = migrateContentNullToRowId(data);
    expect(result!.sheet_0.content[0][0]).toBe('row_id');
    expect(result!.sheet_0.content.length).toBe(1);
  });

  it('数据行第一列非 null 时保留原值，空 row_id 行补发身份保留', () => {
    const data = {
      sheet_0: {
        name: '测试表',
        content: [
          [null, '名称'],
          ['已有值', '铁剑'],
          [null, '药水'],
        ],
      },
    };
    const result = migrateContentNullToRowId(data);
    expect(result!.sheet_0.content[1][0]).toBe('已有值');
    expect(result!.sheet_0.content).toHaveLength(3);
    expect(result!.sheet_0.content[2][1]).toBe('药水');
    expect(String(result!.sheet_0.content[2][0] ?? '').trim()).not.toBe('');
  });

  it('表头已是 row_id 时空 row_id 行补发身份保留（不当作删除）', () => {
    const data = {
      sheet_0: {
        name: '已迁移表',
        content: [['row_id', '数值'], [null, 15], ['0', 0], ['2', 30]],
      },
    };

    const result = migrateContentNullToRowId(data);

    const content = result!.sheet_0.content;
    expect(content[0]).toEqual(['row_id', '数值']);
    expect(content).toHaveLength(4);
    expect(content[1][1]).toBe(15);
    expect(String(content[1][0] ?? '').trim()).not.toBe('');
    expect(content[2]).toEqual(['0', 0]);
    expect(content[3]).toEqual(['2', 30]);
  });
});

// ═══════════════════════════════════════════════════════════════
// mergeAllIndependentTables_ACU 核心数据合并测试
// ═══════════════════════════════════════════════════════════════
import { getCurrentIsolationKey_ACU } from '../../../src/service/runtime/state-manager';
import { readIsolatedTagData_ACU, isLegacyMatchForIsolation_ACU, readLegacyIndependentData_ACU } from '../../../src/data/repositories/chat-message-data-repo';
import { getTemplateSheetKeys_ACU, getSortedSheetKeys_ACU, reorderDataBySheetKeys_ACU } from '../../../src/service/template/chat-scope';

describe('mergeAllIndependentTables_ACU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认：无指导表，模板包含 sheet_0
    vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue(null);
    vi.mocked(getTemplateSheetKeys_ACU).mockReturnValue(['sheet_0']);
    vi.mocked(getCurrentIsolationKey_ACU).mockReturnValue('');
    vi.mocked(getSortedSheetKeys_ACU).mockImplementation((data: any) =>
      data ? Object.keys(data).filter((k: string) => k.startsWith('sheet_')).sort() : [],
    );
    vi.mocked(reorderDataBySheetKeys_ACU).mockImplementation((data: any) => data);
    vi.mocked(resolveTableStorageStrategy_ACU).mockReturnValue({ mode: 'none' } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockResolvedValue(null);
  });

  // ═══ 空聊天记录 ═══
  it('聊天记录为空时返回 null', async () => {
    vi.mocked(getChatArray_ACU).mockReturnValue([]);
    const result = await mergeAllIndependentTables_ACU();
    expect(result).toBeNull();
  });

  it('聊天记录为 null 时返回 null', async () => {
    vi.mocked(getChatArray_ACU).mockReturnValue(null as any);
    const result = await mergeAllIndependentTables_ACU();
    expect(result).toBeNull();
  });

  // ═══ 新版隔离标签存储格式 ═══
  it('从新版隔离标签存储中读取数据', async () => {
    const mockChat = [
      { is_user: false, mes: 'AI回复' },
    ];
    vi.mocked(getChatArray_ACU).mockReturnValue(mockChat);
    vi.mocked(readIsolatedTagData_ACU).mockReturnValue({
      independentData: {
        sheet_0: {
          name: '背包物品表',
          content: [['row_id', '物品名称', '数量'], ['1', '铁剑', '3']],
        },
      },
      modifiedKeys: ['sheet_0'],
      updateGroupKeys: [],
    });

    const result = await mergeAllIndependentTables_ACU();
    expect(result).not.toBeNull();
    expect(result!.sheet_0).toBeDefined();
    expect(result!.sheet_0.name).toBe('背包物品表');
    expect(result!.sheet_0.content[1][1]).toBe('铁剑');
  });

  // ═══ 畸形 tracking 字段防御（P3） ═══
  it('新版槽 tracking 为畸形对象时不抛错，按未跟踪处理', async () => {
    const mockChat = [
      { is_user: false, mes: 'AI回复' },
    ];
    vi.mocked(getChatArray_ACU).mockReturnValue(mockChat);
    vi.mocked(readIsolatedTagData_ACU).mockReturnValue({
      independentData: {
        sheet_0: {
          name: '背包物品表',
          content: [['row_id', '物品名称', '数量'], ['1', '铁剑', '3']],
        },
      },
      // 历史坏数据：应为 string[]，实际写入 {}（truthy，`|| []` 无法兜底）
      modifiedKeys: {} as any,
      updateGroupKeys: {} as any,
    });

    const result = await mergeAllIndependentTables_ACU();
    expect(result).not.toBeNull();
    expect(result!.sheet_0).toBeDefined();
    expect(result!.sheet_0.content[1][1]).toBe('铁剑');
  });


  // ═══ 模板过滤（全版本兼容：只拦无行占位表，带行表永不丢） ═══
  it('不在当前模板但含真实行的表格被兼容保留', async () => {
    vi.mocked(getTemplateSheetKeys_ACU).mockReturnValue(['sheet_0']); // 只有 sheet_0 在模板中
    const mockChat = [
      { is_user: false, mes: 'AI回复' },
    ];
    vi.mocked(getChatArray_ACU).mockReturnValue(mockChat);
    vi.mocked(readIsolatedTagData_ACU).mockReturnValue({
      independentData: {
        sheet_0: { name: '背包物品表', content: [['row_id', '物品名称'], ['1', '铁剑']] },
        sheet_1: { name: '旧表', content: [['row_id', '数据'], ['1', '旧数据']] }, // 不在模板中，但有真实行
      },
      modifiedKeys: ['sheet_0', 'sheet_1'],
      updateGroupKeys: [],
    });

    const result = await mergeAllIndependentTables_ACU();
    expect(result).not.toBeNull();
    expect(result!.sheet_0).toBeDefined();
    expect(result!.sheet_1).toBeDefined(); // 带真实行：兼容保留，不静默丢弃
    expect(result!.sheet_1.content).toEqual([['row_id', '数据'], ['1', '旧数据']]);
  });

  it('不在当前模板且无真实行的占位表仍被过滤（旧表不复活）', async () => {
    vi.mocked(getTemplateSheetKeys_ACU).mockReturnValue(['sheet_0']);
    const mockChat = [
      { is_user: false, mes: 'AI回复' },
    ];
    vi.mocked(getChatArray_ACU).mockReturnValue(mockChat);
    vi.mocked(readIsolatedTagData_ACU).mockReturnValue({
      independentData: {
        sheet_0: { name: '背包物品表', content: [['row_id', '物品名称'], ['1', '铁剑']] },
        sheet_1: { name: '旧表', content: [['row_id', '数据']] }, // 不在模板中且仅表头
      },
      modifiedKeys: ['sheet_0', 'sheet_1'],
      updateGroupKeys: [],
    });

    const result = await mergeAllIndependentTables_ACU();
    expect(result).not.toBeNull();
    expect(result!.sheet_0).toBeDefined();
    expect(result!.sheet_1).toBeUndefined(); // 无行占位表：按既有语义过滤
  });

  // ═══ 最新数据优先（从后往前遍历） ═══
  it('多条消息时取最新的数据（后面的消息优先）', async () => {
    const mockChat = [
      { is_user: false, mes: '旧AI回复' },
      { is_user: true, mes: '用户消息' },
      { is_user: false, mes: '新AI回复' },
    ];
    vi.mocked(getChatArray_ACU).mockReturnValue(mockChat);
    // 第3条消息（index=2）有新数据
    vi.mocked(readIsolatedTagData_ACU).mockImplementation((message: any) => {
      if (message.mes === '新AI回复') {
        return {
          independentData: {
            sheet_0: { name: '背包物品表', content: [['row_id', '物品名称'], ['1', '新铁剑']] },
          },
          modifiedKeys: ['sheet_0'],
          updateGroupKeys: [],
        };
      }
      if (message.mes === '旧AI回复') {
        return {
          independentData: {
            sheet_0: { name: '背包物品表', content: [['row_id', '物品名称'], ['1', '旧铁剑']] },
          },
          modifiedKeys: ['sheet_0'],
          updateGroupKeys: [],
        };
      }
      return null;
    });

    const result = await mergeAllIndependentTables_ACU();
    expect(result).not.toBeNull();
    // 从后往前遍历，新AI回复的数据先被找到
    expect(result!.sheet_0.content[1][1]).toBe('新铁剑');
  });

  // ═══ 跳过用户消息 ═══
  it('跳过用户消息', async () => {
    const mockChat = [
      { is_user: true, mes: '用户消息' },
      { is_user: false, mes: 'AI回复' },
    ];
    vi.mocked(getChatArray_ACU).mockReturnValue(mockChat);
    vi.mocked(readIsolatedTagData_ACU).mockImplementation((message: any) => {
      if (message.is_user) {
        // 如果用户消息被读取，说明跳过逻辑有问题
        return {
          independentData: {
            sheet_0: { name: '错误数据', content: [['row_id'], ['1']] },
          },
          modifiedKeys: ['sheet_0'],
          updateGroupKeys: [],
        };
      }
      return {
        independentData: {
          sheet_0: { name: '正确数据', content: [['row_id', '物品名称'], ['1', '铁剑']] },
        },
        modifiedKeys: ['sheet_0'],
        updateGroupKeys: [],
      };
    });

    const result = await mergeAllIndependentTables_ACU();
    expect(result).not.toBeNull();
    expect(result!.sheet_0.name).toBe('正确数据');
  });

  // ═══ 无数据且无指导表时返回 null ═══
  it('聊天记录中无任何表格数据时返回 null', async () => {
    const mockChat = [
      { is_user: false, mes: 'AI回复' },
    ];
    vi.mocked(getChatArray_ACU).mockReturnValue(mockChat);
    vi.mocked(readIsolatedTagData_ACU).mockReturnValue(null);
    vi.mocked(isLegacyMatchForIsolation_ACU).mockReturnValue(false);

    const result = await mergeAllIndependentTables_ACU();
    expect(result).toBeNull();
  });

  // ═══ 无数据但有指导表时返回物化结构 ═══
  it('无历史数据但有指导表时返回物化结构', async () => {
    const guideData = {
      sheet_0: {
        name: '背包物品表',
        content: [['row_id', '物品名称', '数量']],
        updateConfig: {},
      },
    };
    vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue(guideData);
    vi.mocked(materializeDataFromSheetGuide_ACU).mockReturnValue({
      sheet_0: {
        name: '背包物品表',
        content: [['row_id', '物品名称', '数量']],
        updateConfig: {},
      },
    });
    const mockChat = [
      { is_user: false, mes: 'AI回复' },
    ];
    vi.mocked(getChatArray_ACU).mockReturnValue(mockChat);
    vi.mocked(readIsolatedTagData_ACU).mockReturnValue(null);
    vi.mocked(isLegacyMatchForIsolation_ACU).mockReturnValue(false);

    const result = await mergeAllIndependentTables_ACU();
    expect(result).not.toBeNull();
    expect(result!.sheet_0).toBeDefined();
    expect(result!.sheet_0.name).toBe('背包物品表');
  });

  // ═══ 旧版存储格式兼容 ═══
  it('新版无数据时回退到旧版存储格式', async () => {
    const mockChat = [
      { is_user: false, mes: 'AI回复' },
    ];
    vi.mocked(getChatArray_ACU).mockReturnValue(mockChat);
    vi.mocked(readIsolatedTagData_ACU).mockReturnValue(null);
    vi.mocked(isLegacyMatchForIsolation_ACU).mockReturnValue(true);
    vi.mocked(readLegacyIndependentData_ACU).mockReturnValue({
      sheet_0: {
        name: '背包物品表',
        content: [['row_id', '物品名称'], ['1', '旧版铁剑']],
      },
    });

    const result = await mergeAllIndependentTables_ACU();
    expect(result).not.toBeNull();
    expect(result!.sheet_0.content[1][1]).toBe('旧版铁剑');
  });

  it('legacy-v1 迁移成功后返回修复候选数据，而非原始 legacy 合并数据', async () => {
    const legacyData = {
      sheet_0: {
        name: '背包物品表',
        content: [['row_id', '物品名称'], [' 1 ', '原始旧数据']],
      },
    };
    const repairedData = {
      sheet_0: {
        name: '背包物品表',
        content: [['row_id', '物品名称'], ['1', '修复后数据']],
      },
    };
    vi.mocked(getChatArray_ACU).mockReturnValue([{ is_user: false, mes: 'AI回复' }] as any);
    vi.mocked(resolveTableStorageStrategy_ACU)
      .mockReturnValueOnce({ mode: 'legacy-v1' } as any)
      .mockReturnValueOnce({ mode: 'v2' } as any);
    vi.mocked(readIsolatedTagData_ACU).mockReturnValue(null);
    vi.mocked(isLegacyMatchForIsolation_ACU).mockReturnValue(true);
    vi.mocked(readLegacyIndependentData_ACU).mockReturnValue(legacyData);
    vi.mocked(migrateLegacyStorageToV2OnLoad_ACU).mockResolvedValueOnce({ migrated: true, data: repairedData } as any);

    const result = await mergeAllIndependentTables_ACU();

    expect(migrateLegacyStorageToV2OnLoad_ACU).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sheet_0: expect.objectContaining({ content: [['row_id', '物品名称'], ['1', '原始旧数据']] }) }) }));
    expect(result).toEqual(repairedData);
  });

  it('legacy-v1 超宽 Guide 经真实 normalizer 后仍进入 migration，业务表内容不变', async () => {
    const oversizedGuide = {
      mate: { type: 'chatSheets', version: 2 },
      sheet_0: {
        uid: 'sheet_0',
        name: '背包物品表',
        content: [['row_id', '物品名称']],
        seedRows: [['seed', '模板种子', '旧列']],
      },
    };
    const legacyBusiness = {
      sheet_0: {
        name: '背包物品表',
        content: [['row_id', '物品名称'], ['1', '原始旧数据']],
      },
    };
    vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockImplementation(() => {
      const normalized = normalizeSheetGuideRowIds_ACU(oversizedGuide);
      if (normalized.blockers.length > 0) {
        throw new Error(`Sheet Guide row_id 结构无效：${normalized.blockers.join('；')}`);
      }
      expect(normalized.guideData.sheet_0.seedRows).toEqual([['seed', '模板种子']]);
      return normalized.guideData as any;
    });
    vi.mocked(materializeDataFromSheetGuide_ACU).mockImplementation((guideData: any) => ({
      sheet_0: {
        uid: 'sheet_0',
        name: '背包物品表',
        content: [['row_id', '物品名称']],
        updateConfig: {},
        seedRows: guideData?.sheet_0?.seedRows,
      },
    }));
    vi.mocked(getChatArray_ACU).mockReturnValue([{ is_user: false, mes: 'AI回复' }] as any);
    vi.mocked(resolveTableStorageStrategy_ACU)
      .mockReturnValueOnce({ mode: 'legacy-v1' } as any)
      .mockReturnValueOnce({ mode: 'v2' } as any);
    vi.mocked(readIsolatedTagData_ACU).mockReturnValue(null);
    vi.mocked(isLegacyMatchForIsolation_ACU).mockReturnValue(true);
    vi.mocked(readLegacyIndependentData_ACU).mockReturnValue(legacyBusiness);
    vi.mocked(migrateLegacyStorageToV2OnLoad_ACU).mockResolvedValueOnce({
      migrated: true,
      data: legacyBusiness,
    } as any);

    const result = await mergeAllIndependentTables_ACU();

    expect(migrateLegacyStorageToV2OnLoad_ACU).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sheet_0: expect.objectContaining({ content: [['row_id', '物品名称'], ['1', '原始旧数据']] }),
        }),
      }),
    );
    expect(result).toEqual(legacyBusiness);
  });

  it('legacy-v1 迁移声称成功但未返回候选数据时降级为直读旧数据，不再 throw', async () => {
    vi.mocked(getChatArray_ACU).mockReturnValue([{ is_user: false, mes: 'AI回复' }] as any);
    vi.mocked(resolveTableStorageStrategy_ACU).mockReturnValue({ mode: 'legacy-v1' } as any);
    vi.mocked(readIsolatedTagData_ACU).mockReturnValue(null);
    vi.mocked(isLegacyMatchForIsolation_ACU).mockReturnValue(true);
    vi.mocked(readLegacyIndependentData_ACU).mockReturnValue({
      sheet_0: { name: '背包物品表', content: [['row_id', '物品名称'], ['1', '旧数据']] },
    });
    vi.mocked(migrateLegacyStorageToV2OnLoad_ACU).mockResolvedValueOnce({ migrated: true } as any);

    // C4 读取不阻塞：迁移结果异常时降级为 xing 时代直读合并数据，数据照常可用。
    const result = await mergeAllIndependentTables_ACU();
    expect(result).not.toBeNull();
    expect(result!.sheet_0.content).toEqual([['row_id', '物品名称'], ['1', '旧数据']]);
    expect(logWarn_ACU).toHaveBeenCalledWith(expect.stringContaining('已降级为直读旧格式'));
  });

  // ═══ legacy-v1 guide 结构权：结构冲突降级（读永远宽容） ═══
  function mockLegacyChatWithGuide(legacyData: any, guideShells: any) {
    vi.mocked(getChatArray_ACU).mockReturnValue([{ is_user: false, mes: 'AI回复' }] as any);
    vi.mocked(resolveTableStorageStrategy_ACU).mockReturnValue({ mode: 'legacy-v1' } as any);
    vi.mocked(readIsolatedTagData_ACU).mockReturnValue(null);
    vi.mocked(isLegacyMatchForIsolation_ACU).mockReturnValue(true);
    vi.mocked(readLegacyIndependentData_ACU).mockReturnValue(legacyData);
    vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue(guideShells);
    vi.mocked(materializeDataFromSheetGuide_ACU).mockReturnValue(JSON.parse(JSON.stringify(guideShells)));
    // 迁移声称成功但无候选数据 → 走直读合并结果（覆盖 guide 结构权合并路径）
    vi.mocked(migrateLegacyStorageToV2OnLoad_ACU).mockResolvedValueOnce({ migrated: true } as any);
  }

  it('legacy-v1 历史行宽超过 guide 表头：降级保留历史结构，不 throw、不隔离丢表（原事故场景）', async () => {
    mockLegacyChatWithGuide({
      sheet_bag: {
        uid: 'sheet_bag',
        name: '背包物品表',
        sourceData: { ddl: 'create table 背包物品表 (row_id text, 物品名称 text, 数量 int);' },
        content: [['row_id', '物品名称', '数量'], ['1', '铁剑', '3'], ['2', '药水', '5']],
      },
    }, {
      sheet_bag: {
        uid: 'sheet_bag',
        name: '背包物品表',
        sourceData: { note: '新说明', ddl: 'create table 背包物品表 (row_id text, 物品名称 text);' },
        content: [['row_id', '物品名称']],
      },
    });

    const result = await mergeAllIndependentTables_ACU();

    expect(result).not.toBeNull();
    // 3 列历史结构完整保留：不截断、不 padding、行数据一格不丢
    expect(result!.sheet_bag.content).toEqual([['row_id', '物品名称', '数量'], ['1', '铁剑', '3'], ['2', '药水', '5']]);
    // ddl 属于结构，跟随历史数据；非结构元数据（note）仍从 guide 叠加
    expect(result!.sheet_bag.sourceData.ddl).toContain('数量 int');
    expect(result!.sheet_bag.sourceData.note).toBe('新说明');
    expect(logWarn_ACU).toHaveBeenCalledWith(expect.stringContaining('已降级保留历史结构'));
    expect(logError_ACU).not.toHaveBeenCalledWith(expect.stringContaining('合并失败'), expect.anything());
  });

  it('legacy-v1 guide 表头缺 row_id 首列且有历史数据：降级保留历史结构，不 throw、不隔离丢表', async () => {
    mockLegacyChatWithGuide({
      sheet_bag: {
        uid: 'sheet_bag',
        name: '背包物品表',
        content: [['row_id', '物品名称'], ['1', '铁剑']],
      },
    }, {
      sheet_bag: {
        uid: 'sheet_bag',
        name: '背包物品表',
        content: [['物品名称', '数量']], // 非法：首列不是 row_id
      },
    });

    const result = await mergeAllIndependentTables_ACU();

    expect(result).not.toBeNull();
    expect(result!.sheet_bag.content).toEqual([['row_id', '物品名称'], ['1', '铁剑']]);
    expect(logWarn_ACU).toHaveBeenCalledWith(expect.stringContaining('已降级保留历史结构'));
  });

  it('legacy-v1 历史行短于 guide 表头：padding 语义不回归（guide 结构权正常路径）', async () => {
    mockLegacyChatWithGuide({
      sheet_bag: {
        uid: 'sheet_bag',
        name: '背包物品表',
        content: [['row_id', '物品名称'], ['1', '铁剑']],
      },
    }, {
      sheet_bag: {
        uid: 'sheet_bag',
        name: '背包物品表',
        content: [['row_id', '物品名称', '数量']],
      },
    });

    const result = await mergeAllIndependentTables_ACU();

    expect(result).not.toBeNull();
    // guide 表头生效，短行补 null 到 guide 宽度
    expect(result!.sheet_bag.content).toEqual([['row_id', '物品名称', '数量'], ['1', '铁剑', null]]);
  });

  // ═══ updateConfig 兼容迁移 ═══
  it('旧版 updateConfig 中的 0 被迁移为 -1', async () => {
    const mockChat = [
      { is_user: false, mes: 'AI回复' },
    ];
    vi.mocked(getChatArray_ACU).mockReturnValue(mockChat);
    vi.mocked(readIsolatedTagData_ACU).mockReturnValue({
      independentData: {
        sheet_0: {
          name: '背包物品表',
          content: [['row_id', '物品名称'], ['1', '铁剑']],
          updateConfig: { contextDepth: 0, updateFrequency: 0, batchSize: 3, skipFloors: 0 },
        },
      },
      modifiedKeys: ['sheet_0'],
      updateGroupKeys: [],
    });

    const result = await mergeAllIndependentTables_ACU();
    expect(result).not.toBeNull();
    // 0 应被迁移为 -1（新语义）
    expect(result!.sheet_0.updateConfig.contextDepth).toBe(-1);
    expect(result!.sheet_0.updateConfig.updateFrequency).toBe(-1);
    expect(result!.sheet_0.updateConfig.batchSize).toBe(3); // 非0值不变
    expect(result!.sheet_0.updateConfig.skipFloors).toBe(-1);
    expect(result!.sheet_0.updateConfig.uiSentinel).toBe(-1);
  });

  it('V2 回放表与指导表同 key 不同名：按 key 继承数据，名字/元数据取 guide', async () => {
    vi.mocked(getChatArray_ACU).mockReturnValue([{ is_user: false, mes: 'AI回复' }] as any);
    vi.mocked(resolveTableStorageStrategy_ACU).mockReturnValue({ mode: 'v2' } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockResolvedValue({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test: {
        uid: 'sheet_test',
        name: '旧表名',
        sourceData: { note: '旧说明' },
        updateConfig: { uiSentinel: 0 },
        exportConfig: { enabled: false },
        orderNo: 9,
        content: [['row_id', '旧列'], ['1', '旧值']],
      },
      sheet_removed: {
        uid: 'sheet_removed',
        name: '旧表',
        content: [['row_id', '旧列'], ['1', '旧值']],
      },
    } as any);
    vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue({
      sheet_test: {
        uid: 'sheet_test',
        name: '新表名',
        sourceData: { note: '新说明' },
        updateConfig: { uiSentinel: -1 },
        exportConfig: { enabled: true },
        orderNo: 1,
        content: [['row_id', '新列', '新增列']],
        seedRows: [['seed', '模板种子']],
      },
    } as any);
    vi.mocked(materializeDataFromSheetGuide_ACU).mockReturnValue({
      sheet_test: {
        uid: 'sheet_test',
        name: '新表名',
        sourceData: { note: '新说明' },
        updateConfig: { uiSentinel: -1 },
        exportConfig: { enabled: true },
        orderNo: 1,
        content: [['row_id', '新列', '新增列']],
        seedRows: [['seed', '模板种子']],
      },
    } as any);

    const result = await mergeAllIndependentTables_ACU();

    expect(result).not.toBeNull();
    // key 同一性优先于名字匹配：同 key 改名不允许丢数据（authority=data 保留历史结构）
    expect(result!.sheet_test.name).toBe('新表名');
    expect(result!.sheet_test.sourceData).toEqual({ note: '新说明' });
    expect(result!.sheet_test.updateConfig).toEqual({ uiSentinel: -1 });
    expect(result!.sheet_test.exportConfig).toEqual({ enabled: true });
    expect(result!.sheet_test.orderNo).toBe(1);
    expect(result!.sheet_test.content).toEqual([['row_id', '旧列'], ['1', '旧值']]);
    expect(result!.sheet_test.seedRows).toEqual([['seed', '模板种子']]);
    // 不匹配任何 guide 表但含真实行：兼容携带，不静默丢弃
    expect(result!.sheet_removed).toBeDefined();
    expect(result!.sheet_removed.content).toEqual([['row_id', '旧列'], ['1', '旧值']]);
  });

  it('V2 canonical 回放与 guide 表头一致时：保留历史行，不 padding 短行，仅叠加非结构元数据', async () => {
    vi.mocked(getChatArray_ACU).mockReturnValue([{ is_user: false, mes: 'AI回复' }] as any);
    vi.mocked(resolveTableStorageStrategy_ACU).mockReturnValue({ mode: 'v2' } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockResolvedValue({
      sheet_legacy: {
        uid: 'sheet_legacy',
        name: '背包物品表',
        sourceData: { ddl: 'create table 背包物品表 (row_id text, 名称 text);' },
        content: [['row_id', '名称'], ['1', '铁剑']],
      },
    } as any);
    vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue({
      sheet_new: {
        uid: 'sheet_new',
        name: '背包物品表',
        sourceData: { note: '新说明', ddl: 'create table 背包物品表 (row_id text, 名称 text, 数量 int);' },
        updateConfig: { uiSentinel: -1 },
        exportConfig: { enabled: true },
        orderNo: 2,
        content: [['row_id', '名称']],
      },
    } as any);
    vi.mocked(materializeDataFromSheetGuide_ACU).mockReturnValue({
      sheet_new: {
        uid: 'sheet_new',
        name: '背包物品表',
        sourceData: { note: '新说明', ddl: 'create table 背包物品表 (row_id text, 名称 text, 数量 int);' },
        updateConfig: { uiSentinel: -1 },
        exportConfig: { enabled: true },
        orderNo: 2,
        content: [['row_id', '名称']],
      },
    } as any);

    const result = await mergeAllIndependentTables_ACU();

    // 表头一致：保留历史 content，不 padding（不再补 null），非结构元数据叠加
    expect(result?.sheet_new.content).toEqual([['row_id', '名称'], ['1', '铁剑']]);
    expect(result?.sheet_new.name).toBe('背包物品表');
    expect(result?.sheet_new.updateConfig).toEqual({ uiSentinel: -1 });
    expect(result?.sheet_new.exportConfig).toEqual({ enabled: true });
    expect(result?.sheet_new.orderNo).toBe(2);
    // 结构一致：inheritDdl=true，ddl 继承 guide；note 也来自 guide
    expect(result?.sheet_new.sourceData.ddl).toContain('数量 int');
    expect(result?.sheet_new.sourceData.note).toBe('新说明');
  });

  it('V2 canonical 回放行宽超过 guide 时：保留历史结构，不抛错、不截断，记录 warning', async () => {
    vi.mocked(getChatArray_ACU).mockReturnValue([{ is_user: false, mes: 'AI回复' }] as any);
    vi.mocked(resolveTableStorageStrategy_ACU).mockReturnValue({ mode: 'v2' } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockResolvedValue({
      sheet_legacy: {
        uid: 'sheet_legacy',
        name: '背包物品表',
        sourceData: { ddl: 'create table 背包物品表 (row_id text, 名称 text, 数量 int);' },
        content: [['row_id', '名称', '数量'], ['1', '铁剑', 1]],
      },
    } as any);
    vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue({
      sheet_new: {
        uid: 'sheet_new',
        name: '背包物品表',
        sourceData: { note: '新说明', ddl: 'create table 背包物品表 (row_id text, 名称 text);' },
        content: [['row_id', '名称']],
      },
    } as any);
    vi.mocked(materializeDataFromSheetGuide_ACU).mockReturnValue({
      sheet_new: {
        uid: 'sheet_new',
        name: '背包物品表',
        sourceData: { note: '新说明', ddl: 'create table 背包物品表 (row_id text, 名称 text);' },
        content: [['row_id', '名称']],
      },
    } as any);

    const result = await mergeAllIndependentTables_ACU();

    // 历史 3 列结构完整保留，不截断、不 padding
    expect(result?.sheet_new.content).toEqual([['row_id', '名称', '数量'], ['1', '铁剑', 1]]);
    // 结构不一致：inheritDdl=false，ddl 跟随 checkpoint，note 仍从 guide 叠加
    expect(result?.sheet_new.sourceData.ddl).toContain('数量 int');
    expect(result?.sheet_new.sourceData.note).toBe('新说明');
    // 结构不一致产生 warning
    expect(logWarn_ACU).toHaveBeenCalledWith(expect.stringContaining('Sheet Guide 表头与历史权威数据不一致'));
  });

  it('非法 guide 表头：有历史数据时降级为保留权威结构 + warning（不再 throw）', async () => {
    vi.mocked(getChatArray_ACU).mockReturnValue([{ is_user: false, mes: 'AI回复' }] as any);
    vi.mocked(resolveTableStorageStrategy_ACU).mockReturnValue({ mode: 'v2' } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockResolvedValue({
      sheet_test: {
        uid: 'sheet_test',
        name: '测试表',
        sourceData: { ddl: 'create table 测试表 (row_id text, 值 text);' },
        content: [['row_id', '值'], ['1', '保留']],
      },
    } as any);
    vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue({
      sheet_test: { uid: 'sheet_test', name: '测试表', content: [['行号', '值']] },
    } as any);
    vi.mocked(materializeDataFromSheetGuide_ACU).mockReturnValue({
      sheet_test: { uid: 'sheet_test', name: '测试表', content: [['行号', '值']] },
    } as any);

    const result = await mergeAllIndependentTables_ACU();

    // 有历史数据：保留权威表头，不抛错
    expect(result?.sheet_test.content).toEqual([['row_id', '值'], ['1', '保留']]);
    expect(logWarn_ACU).toHaveBeenCalledWith(expect.stringContaining('Sheet Guide 表头与历史权威数据不一致'));
  });

  it('V2 回放旧 key 与指导表规范显示名相同时迁入指导表 key', async () => {
    vi.mocked(getChatArray_ACU).mockReturnValue([{ is_user: false, mes: 'AI回复' }] as any);
    vi.mocked(resolveTableStorageStrategy_ACU).mockReturnValue({ mode: 'v2' } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockResolvedValue({
      sheet_legacy: {
        uid: 'sheet_legacy',
        name: '背包物品表',
        content: [['row_id', '物品名称'], ['1', '铁剑']],
      },
    } as any);
    vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue({
      sheet_new: { uid: 'sheet_new', name: '背包物品表', content: [['row_id', '物品名称', '数量']] },
    } as any);
    vi.mocked(materializeDataFromSheetGuide_ACU).mockReturnValue({
      sheet_new: { uid: 'sheet_new', name: '背包物品表', content: [['row_id', '物品名称', '数量']] },
    } as any);

    const result = await mergeAllIndependentTables_ACU();

    expect(result?.sheet_legacy).toBeUndefined();
    expect(result?.sheet_new).toMatchObject({
      uid: 'sheet_new',
      name: '背包物品表',
      // 新契约：表头不一致时保留历史权威结构（2 列），不 padding 补 null
      content: [['row_id', '物品名称'], ['1', '铁剑']],
    });
  });

  it('V2 回放表与指导表 key/名字均不匹配：兼容携带原表 + 指导表空壳并存', async () => {
    vi.mocked(getChatArray_ACU).mockReturnValue([{ is_user: false, mes: 'AI回复' }] as any);
    vi.mocked(resolveTableStorageStrategy_ACU).mockReturnValue({ mode: 'v2' } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockResolvedValue({
      sheet_legacy: { uid: 'sheet_legacy', name: '旧表', content: [['row_id', '值'], ['1', '旧数据']] },
    } as any);
    vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue({
      sheet_new: { uid: 'sheet_new', name: '新表', content: [['row_id', '值']] },
    } as any);
    vi.mocked(materializeDataFromSheetGuide_ACU).mockReturnValue({
      sheet_new: { uid: 'sheet_new', name: '新表', content: [['row_id', '值']] },
    } as any);

    const result = await mergeAllIndependentTables_ACU();

    // checkpoint 权威（authority=data）：表在即有效，兼容携带，不静默丢弃
    expect(result?.sheet_legacy).toMatchObject({
      uid: 'sheet_legacy',
      name: '旧表',
      content: [['row_id', '值'], ['1', '旧数据']],
    });
    expect(result?.sheet_new).toMatchObject({
      uid: 'sheet_new',
      name: '新表',
      content: [['row_id', '值']],
    });
  });

  it('多个历史 key 匹配同一指导表时拒绝自动继承并记录警告', async () => {
    const { logWarn_ACU } = await import('../../../src/shared/utils');
    vi.mocked(getChatArray_ACU).mockReturnValue([{ is_user: false, mes: 'AI回复' }] as any);
    vi.mocked(resolveTableStorageStrategy_ACU).mockReturnValue({ mode: 'v2' } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockResolvedValue({
      sheet_legacy_a: { uid: 'sheet_legacy_a', name: '背包物品表', content: [['row_id', '物品名称'], ['1', '铁剑']] },
      sheet_legacy_b: { uid: 'sheet_legacy_b', name: '背包物品表', content: [['row_id', '物品名称'], ['2', '药水']] },
    } as any);
    vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue({
      sheet_new: { uid: 'sheet_new', name: '背包物品表', content: [['row_id', '物品名称']] },
    } as any);
    vi.mocked(materializeDataFromSheetGuide_ACU).mockReturnValue({
      sheet_new: { uid: 'sheet_new', name: '背包物品表', content: [['row_id', '物品名称']] },
    } as any);

    const result = await mergeAllIndependentTables_ACU();

    // 拒绝自动继承（无法判定哪张是正身），但两张历史表按原 key 兼容携带，不丢数据
    expect(result?.sheet_legacy_a?.content).toEqual([['row_id', '物品名称'], ['1', '铁剑']]);
    expect(result?.sheet_legacy_b?.content).toEqual([['row_id', '物品名称'], ['2', '药水']]);
    expect(result?.sheet_new?.content).toEqual([['row_id', '物品名称']]);
    expect(logWarn_ACU).toHaveBeenCalledWith(expect.stringContaining('匹配多个历史 Sheet'));
  });

  it('guide-only 新表（checkpoint 中不存在）：完整按 guide 物化，含 sourceData.ddl', async () => {
    vi.mocked(getChatArray_ACU).mockReturnValue([{ is_user: false, mes: 'AI回复' }] as any);
    vi.mocked(resolveTableStorageStrategy_ACU).mockReturnValue({ mode: 'v2' } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockResolvedValue({
      sheet_existing: { uid: 'sheet_existing', name: '已有表', content: [['row_id', '列']] },
    } as any);
    vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue({
      sheet_new: {
        uid: 'sheet_new',
        name: '新表',
        sourceData: { ddl: 'create table 新表 (row_id text, 名称 text);' },
        content: [['row_id', '名称']],
        seedRows: [['1', '种子']],
      },
      sheet_existing: { uid: 'sheet_existing', name: '已有表', content: [['row_id', '列']] },
    } as any);
    vi.mocked(materializeDataFromSheetGuide_ACU).mockReturnValue({
      sheet_new: {
        uid: 'sheet_new',
        name: '新表',
        sourceData: { ddl: 'create table 新表 (row_id text, 名称 text);' },
        content: [['row_id', '名称']],
        seedRows: [['1', '种子']],
      },
      sheet_existing: { uid: 'sheet_existing', name: '已有表', content: [['row_id', '列']] },
    } as any);

    const result = await mergeAllIndependentTables_ACU();

    // guide-only 新表：完整按 guide 物化（含 ddl 与 seedRows）
    expect(result?.sheet_new).toBeDefined();
    expect(result?.sheet_new.sourceData.ddl).toContain('名称 text');
    expect(result?.sheet_new.content).toEqual([['row_id', '名称']]);
    // 已有表仍保留历史结构
    expect(result?.sheet_existing.content).toEqual([['row_id', '列']]);
  });

  it('宽度不一致时对合并结果调用 getSheetColumnProjection_ACU 不抛错（DDL 投影安全）', async () => {
    vi.mocked(getChatArray_ACU).mockReturnValue([{ is_user: false, mes: 'AI回复' }] as any);
    vi.mocked(resolveTableStorageStrategy_ACU).mockReturnValue({ mode: 'v2' } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockResolvedValue({
      sheet_legacy: {
        uid: 'sheet_legacy',
        name: '背包物品表',
        sourceData: { ddl: 'create table 背包物品表 (row_id text, 名称 text, 数量 int);' },
        content: [['row_id', '名称', '数量'], ['1', '铁剑', 1]],
      },
    } as any);
    vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue({
      sheet_new: {
        uid: 'sheet_new',
        name: '背包物品表',
        sourceData: { note: '说明', ddl: 'create table 背包物品表 (row_id text, 名称 text);' },
        content: [['row_id', '名称']],
      },
    } as any);
    vi.mocked(materializeDataFromSheetGuide_ACU).mockReturnValue({
      sheet_new: {
        uid: 'sheet_new',
        name: '背包物品表',
        sourceData: { note: '说明', ddl: 'create table 背包物品表 (row_id text, 名称 text);' },
        content: [['row_id', '名称']],
      },
    } as any);

    const result = await mergeAllIndependentTables_ACU();
    expect(result?.sheet_new).toBeDefined();

    // 直接验证 §2.7 风险消除：对合并结果做 DDL 投影不抛错
    const { getSheetColumnProjection_ACU } = await import('../../../src/shared/ddl-utils');
    const projection = getSheetColumnProjection_ACU(result?.sheet_new);
    expect(projection).toHaveProperty('columns');
    expect(projection.columns.length).toBeGreaterThan(0);
  });

  it('单表异常被隔离：其余表正常返回，异常表不拖垮整体加载', async () => {
    vi.mocked(getChatArray_ACU).mockReturnValue([{ is_user: false, mes: 'AI回复' }] as any);
    vi.mocked(resolveTableStorageStrategy_ACU).mockReturnValue({ mode: 'v2' } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockResolvedValue({
      sheet_good: { uid: 'sheet_good', name: '好表', content: [['row_id', '值'], ['1', '数据']] },
    } as any);
    vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue({
      // sheet_bad 为 guide-only（历史数据中不存在），且表头非法（首列非 row_id）→ 触发隔离
      sheet_bad: { uid: 'sheet_bad', name: '坏表', content: [['行号', '值']] },
      sheet_good: { uid: 'sheet_good', name: '好表', content: [['row_id', '值']] },
    } as any);
    vi.mocked(materializeDataFromSheetGuide_ACU).mockReturnValue({
      sheet_bad: { uid: 'sheet_bad', name: '坏表', content: [['行号', '值']] },
      sheet_good: { uid: 'sheet_good', name: '好表', content: [['row_id', '值']] },
    } as any);

    const result = await mergeAllIndependentTables_ACU();

    // guide-only 非法表头触发隔离（从结果剔除），好表正常返回
    expect(result?.sheet_bad).toBeUndefined();
    expect(result?.sheet_good).toBeDefined();
    // checkpoint 持结构权：好表的历史数据行完整保留
    expect(result?.sheet_good.content).toEqual([['row_id', '值'], ['1', '数据']]);
    expect(logError_ACU).toHaveBeenCalled();
  });


  it('auto_merged 越界尾列在 guide 结构比较前被剥离，不产生结构不一致 warning', async () => {
    vi.mocked(getChatArray_ACU).mockReturnValue([{ is_user: false, mes: 'AI回复' }] as any);
    vi.mocked(resolveTableStorageStrategy_ACU).mockReturnValue({ mode: 'v2' } as any);
    vi.mocked(loadTableStateFromFramesV2_ACU).mockResolvedValue({
      sheet_legacy: {
        uid: 'sheet_legacy',
        name: '背包物品表',
        // 历史形态：表头 2 列，数据行 3 列（行宽 = 表头 + 1），尾格为 'auto_merged'
        content: [['row_id', '名称'], ['1', '铁剑', 'auto_merged']],
      },
    } as any);
    vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue({
      sheet_new: {
        uid: 'sheet_new',
        name: '背包物品表',
        sourceData: { note: '说明' },
        content: [['row_id', '名称']],
      },
    } as any);
    vi.mocked(materializeDataFromSheetGuide_ACU).mockReturnValue({
      sheet_new: {
        uid: 'sheet_new',
        name: '背包物品表',
        sourceData: { note: '说明' },
        content: [['row_id', '名称']],
      },
    } as any);

    const result = await mergeAllIndependentTables_ACU();

    // 尾列 'auto_merged' 已在 guide 比较前剥离，数据行回到 2 列，与 guide 表头一致
    expect(result?.sheet_new.content).toEqual([['row_id', '名称'], ['1', '铁剑']]);
    // 不产生结构不一致 warning
    expect(logWarn_ACU).not.toHaveBeenCalledWith(expect.stringContaining('Sheet Guide 表头与历史权威数据不一致'));
  });
});

// ═══════════════════════════════════════════════════════════════
// formatJsonToReadable_ACU — JSON 表格数据转 Markdown 可读文本
// ═══════════════════════════════════════════════════════════════
import { formatJsonToReadable_ACU, fillFirstLayerWithTemplateData_ACU, shouldSuppressWorldbookInjection_ACU, maybeLiftWorldbookSuppression_ACU, getEffectiveAutoUpdateThreshold_ACU, isNewChatGreetingStage_ACU, isSingleAiNoUserChat_ACU, buildTemplateBaseStateDataForLocalStorage_ACU, ensureInitialSeedCheckpoint_ACU, parseReadableToJson_ACU, GREETING_LOCAL_BASE_STATE_MARKER_ACU } from '../../../src/service/runtime/helpers-data-merge';
import { settings_ACU, suppressWorldbookInjectionInGreeting_ACU, _set_suppressWorldbookInjectionInGreeting_ACU } from '../../../src/service/runtime/state-manager';
import { saveChatToHost_ACU } from '../../../src/data/gateways/chat-gateway';
import { persistTableMutationLogV2_ACU } from '../../../src/service/table/storage-frame-v2-persist';
import { buildChatSheetGuideDataFromTemplateObj_ACU, setChatSheetGuideDataForIsolationKey_ACU, sanitizeTemplateSnapshotForChat_ACU } from '../../../src/service/template/chat-scope';
import { applyTemplateScopeForCurrentChat_ACU } from '../../../src/service/settings/settings-service';

function mockPersistV2CheckpointSuccess_ACU() {
  vi.mocked(persistTableMutationLogV2_ACU).mockImplementation(async (options: any) => {
    const chat = getChatArray_ACU() || [];
    const target = chat[options.targetMessageIndex];
    if (target) {
      target.TavernDB_ACU_IsolatedData = target.TavernDB_ACU_IsolatedData || {};
      target.TavernDB_ACU_IsolatedData[options.isolationKey || ''] = {
        _acu_storage_version: 2,
        storageFrame: {
          version: 2,
          checkpoint: {
            kind: 'full',
            createdAt: 1,
            reason: options.checkpointReason || 'init',
            data: JSON.parse(JSON.stringify(options.afterData || {})),
          },
          logEntries: [],
        },
      };
    }
    await saveChatToHost_ACU();
    return { saved: true, messageIndex: options.targetMessageIndex };
  });
}


import { _set_currentJsonTableData_ACU } from '../../../src/service/runtime/state-manager';

describe('formatJsonToReadable_ACU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // getSortedSheetKeys_ACU 返回按 key 排序的表格键
    vi.mocked(getSortedSheetKeys_ACU).mockImplementation((data: any) =>
      data ? Object.keys(data).filter((k: string) => k.startsWith('sheet_')).sort() : [],
    );
  });

  it('jsonData 为 null 时返回默认空结构', () => {
    const result = formatJsonToReadable_ACU(null);
    expect(result.readableText).toBe('数据库为空。');
    expect(result.importantPersonsTable).toBeNull();
    expect(result.summaryTable).toBeNull();
    expect(result.outlineTable).toBeNull();
  });

  it('普通表格转为 Markdown 格式（跳过 row_id 列）', () => {
    const jsonData = {
      sheet_0: {
        name: '背包物品表',
        content: [
          ['row_id', '物品名称', '数量'],
          ['1', '铁剑', '3'],
          ['2', '药水', '5'],
        ],
      },
    };
    const result = formatJsonToReadable_ACU(jsonData);
    expect(result.readableText).toContain('# 背包物品表');
    expect(result.readableText).toContain('| 物品名称 | 数量 |');
    expect(result.readableText).toContain('|---|---|');
    expect(result.readableText).toContain('| 铁剑 | 3 |');
    expect(result.readableText).toContain('| 药水 | 5 |');
    // row_id 不应出现在输出中
    expect(result.readableText).not.toContain('row_id');
  });

  it('普通表 Markdown 隐藏 physical column 并保持右侧可见列对齐', () => {
    const jsonData = {
      sheet_0: {
        name: '背包物品表',
        sourceData: {
          ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT, legacy_note TEXT, quantity INTEGER);',
          hiddenPhysicalColumns: ['legacy_note'],
        },
        content: [
          ['row_id', '物品名称', '旧备注', '数量'],
          ['1', '铁剑', '历史秘密', '3'],
        ],
      },
    };

    const result = formatJsonToReadable_ACU(jsonData);
    expect(result.readableText).toContain('| 物品名称 | 数量 |');
    expect(result.readableText).toContain('| 铁剑 | 3 |');
    expect(result.readableText).not.toContain('旧备注');
    expect(result.readableText).not.toContain('历史秘密');
  });

  it('重要人物表被提取到独立字段，不出现在 readableText 中', () => {
    const jsonData = {
      sheet_0: {
        name: '重要人物表',
        content: [['row_id', '姓名'], ['1', '冈部']],
      },
      sheet_1: {
        name: '背包物品表',
        content: [['row_id', '物品名称'], ['1', '铁剑']],
      },
    };
    const result = formatJsonToReadable_ACU(jsonData);
    expect(result.importantPersonsTable).not.toBeNull();
    expect(result.importantPersonsTable.name).toBe('重要人物表');
    expect(result.readableText).not.toContain('# 重要人物表');
    // 普通表仍在 readableText 中
    expect(result.readableText).toContain('# 背包物品表');
  });

  it('总结表和总体大纲被提取到独立字段', () => {
    const jsonData = {
      sheet_0: {
        name: '总结表',
        content: [['row_id', '内容'], ['1', '总结内容']],
      },
      sheet_1: {
        name: '总体大纲',
        content: [['row_id', '章节'], ['1', '第一章']],
      },
    };
    const result = formatJsonToReadable_ACU(jsonData);
    expect(result.summaryTable).not.toBeNull();
    expect(result.summaryTable.name).toBe('总结表');
    expect(result.outlineTable).not.toBeNull();
    expect(result.outlineTable.name).toBe('总体大纲');
    expect(result.readableText).not.toContain('# 总结表');
    expect(result.readableText).not.toContain('# 总体大纲');
  });

  it('exportConfig.enabled=true 的表被跳过', () => {
    const jsonData = {
      sheet_0: {
        name: '自定义导出表',
        content: [['row_id', '数据'], ['1', '值']],
        exportConfig: { enabled: true },
      },
      sheet_1: {
        name: '普通表',
        content: [['row_id', '数据'], ['1', '值']],
      },
    };
    const result = formatJsonToReadable_ACU(jsonData);
    expect(result.readableText).not.toContain('# 自定义导出表');
    expect(result.readableText).toContain('# 普通表');
  });

  it('exportConfig.injectIntoWorldbook=false 的表被跳过', () => {
    const jsonData = {
      sheet_0: {
        name: '不注入表',
        content: [['row_id', '数据'], ['1', '值']],
        exportConfig: { injectIntoWorldbook: false },
      },
    };
    const result = formatJsonToReadable_ACU(jsonData);
    expect(result.readableText).not.toContain('# 不注入表');
  });

  it('只有数据行没有表头时仍不报错', () => {
    const jsonData = {
      sheet_0: {
        name: '空表头表',
        content: [],
      },
    };
    expect(() => formatJsonToReadable_ACU(jsonData)).not.toThrow();
  });

  it('多张普通表按顺序输出', () => {
    const jsonData = {
      sheet_0: {
        name: '表A',
        content: [['row_id', 'col1'], ['1', 'a1']],
      },
      sheet_1: {
        name: '表B',
        content: [['row_id', 'col2'], ['1', 'b1']],
      },
    };
    const result = formatJsonToReadable_ACU(jsonData);
    const indexA = result.readableText.indexOf('# 表A');
    const indexB = result.readableText.indexOf('# 表B');
    expect(indexA).toBeLessThan(indexB);
  });
});

// ═══════════════════════════════════════════════════════════════
// fillFirstLayerWithTemplateData_ACU — 将模板数据填充到第一楼
// ═══════════════════════════════════════════════════════════════
describe('fillFirstLayerWithTemplateData_ACU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: false, mes: '你好，欢迎来到冒险世界！' },
    ]);
    vi.mocked(getCurrentIsolationKey_ACU).mockReturnValue('');
    vi.mocked(getSortedSheetKeys_ACU).mockImplementation((data: any) =>
      data ? Object.keys(data).filter((k: string) => k.startsWith('sheet_')).sort() : [],
    );
    vi.mocked(reorderDataBySheetKeys_ACU).mockImplementation((data: any) => data);
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValue(null);
    vi.mocked(buildChatSheetGuideDataFromTemplateObj_ACU).mockReturnValue(null);
    mockPersistV2CheckpointSuccess_ACU();
  });

  it('将补齐身份后的系统规则快照同时写入 V2 checkpoint 与内存', async () => {
    const templateObj = {
      sheet_SystemRules: {
        name: '系统规则表',
        content: [
          ['row_id', '规则名称'],
          [null, '规则一'],
          ['', '规则二'],
          [' fixed-rule ', '规则三'],
        ],
      },
    };

    const result = await fillFirstLayerWithTemplateData_ACU(templateObj);

    expect(result).toEqual({ success: true, messageIndex: 0, sheetCount: 1 });
    const persistedSnapshot = vi.mocked(persistTableMutationLogV2_ACU).mock.calls[0][0].afterData;
    expect(persistedSnapshot.sheet_SystemRules.content).toEqual([
      ['row_id', '规则名称'],
      ['1', '规则一'],
      ['2', '规则二'],
      ['fixed-rule', '规则三'],
    ]);
    expect(vi.mocked(_set_currentJsonTableData_ACU)).toHaveBeenCalledWith(expect.objectContaining({
      sheet_SystemRules: expect.objectContaining({
        content: persistedSnapshot.sheet_SystemRules.content,
      }),
    }));
    expect(templateObj.sheet_SystemRules.content[1][0]).toBeNull();
    expect(templateObj.sheet_SystemRules.content[2][0]).toBe('');
  });

  it('保留原始模板给 guide，并使 guide seedRows 与 checkpoint 身份一致', async () => {
    const templateObj = {
      sheet_SystemRules: {
        name: '系统规则表',
        content: [
          ['row_id', '规则名称'],
          [null, '规则一'],
          [' fixed-rule ', '规则二'],
          ['', '规则三'],
        ],
      },
    };
    const expectedSeedRows = [
      ['1', '规则一'],
      ['fixed-rule', '规则二'],
      ['2', '规则三'],
    ];
    vi.mocked(buildChatSheetGuideDataFromTemplateObj_ACU).mockImplementation((source: any) => {
      expect(source).toBe(templateObj);
      expect(source.sheet_SystemRules.content).toEqual([
        ['row_id', '规则名称'],
        [null, '规则一'],
        [' fixed-rule ', '规则二'],
        ['', '规则三'],
      ]);
      return {
        sheet_SystemRules: {
          name: source.sheet_SystemRules.name,
          content: [['row_id', '规则名称']],
          seedRows: expectedSeedRows,
        },
      };
    });
    vi.mocked(setChatSheetGuideDataForIsolationKey_ACU).mockReturnValue(true);

    const result = await fillFirstLayerWithTemplateData_ACU(templateObj);

    expect(result).toEqual({ success: true, messageIndex: 0, sheetCount: 1 });
    const persistedSnapshot = vi.mocked(persistTableMutationLogV2_ACU).mock.calls[0][0].afterData;
    const guideData = vi.mocked(setChatSheetGuideDataForIsolationKey_ACU).mock.calls[0][1];
    expect(guideData.sheet_SystemRules.seedRows).toEqual(persistedSnapshot.sheet_SystemRules.content.slice(1));
    expect(templateObj.sheet_SystemRules.content[1][0]).toBeNull();
    expect(templateObj.sheet_SystemRules.content[2][0]).toBe(' fixed-rule ');
  });

  it('正常填充：写入 V2 初始化 checkpoint', async () => {
    const templateObj = {
      sheet_0: {
        name: '背包物品表',
        content: [['row_id', '物品名称', '数量'], ['1', '铁剑', '3']],
      },
    };

    const result = await fillFirstLayerWithTemplateData_ACU(templateObj);
    expect(result).toEqual({ success: true, messageIndex: 0, sheetCount: 1 });
    // 验证写入了 V2 checkpoint，不再同步旧格式
    expect(vi.mocked(persistTableMutationLogV2_ACU)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(saveChatToHost_ACU)).toHaveBeenCalledTimes(1);
    // 验证更新了内存数据
    expect(vi.mocked(_set_currentJsonTableData_ACU)).toHaveBeenCalledTimes(1);
  });

  it('聊天记录为空时返回 false', async () => {
    vi.mocked(getChatArray_ACU).mockReturnValue([]);
    const result = await fillFirstLayerWithTemplateData_ACU({ sheet_0: { name: '表', content: [] } });
    expect(result).toBe(false);
  });

  it('聊天中无AI消息时返回 false', async () => {
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true, mes: '用户消息' },
    ]);
    const result = await fillFirstLayerWithTemplateData_ACU({ sheet_0: { name: '表', content: [] } });
    expect(result).toBe(false);
  });

  it('模板中无表格数据时返回 false', async () => {
    const result = await fillFirstLayerWithTemplateData_ACU({ mate: { type: 'acu' } });
    expect(result).toBe(false);
  });

  it('有指导表时同步指导表和模板快照', async () => {
    const guideData = { sheet_0: { name: '背包物品表', content: [['row_id', '物品名称']] } };
    vi.mocked(buildChatSheetGuideDataFromTemplateObj_ACU).mockReturnValue(guideData);
    vi.mocked(sanitizeTemplateSnapshotForChat_ACU).mockReturnValue({ templateStr: '{}' } as any);
    vi.mocked(setChatSheetGuideDataForIsolationKey_ACU).mockReturnValue(true);

    const templateObj = {
      sheet_0: {
        name: '背包物品表',
        content: [['row_id', '物品名称'], ['1', '铁剑']],
      },
    };

    const result = await fillFirstLayerWithTemplateData_ACU(templateObj);

    expect(result).toEqual({ success: true, messageIndex: 0, sheetCount: 1 });
    expect(vi.mocked(setChatSheetGuideDataForIsolationKey_ACU)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(applyTemplateScopeForCurrentChat_ACU)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(persistTableMutationLogV2_ACU)).toHaveBeenCalledTimes(1);
    expect((getChatArray_ACU() as any[])[0]._acu_local_template_base_state_seeded).toBe(GREETING_LOCAL_BASE_STATE_MARKER_ACU);
    expect(vi.mocked(_set_currentJsonTableData_ACU)).toHaveBeenCalledTimes(1);
  });

  it('guide/scope 同步失败时不写 checkpoint、不设置已播种标记，且允许后续重试', async () => {
    const firstMessage: any = { is_user: false, mes: '你好，欢迎来到冒险世界！' };
    vi.mocked(getChatArray_ACU).mockReturnValue([firstMessage]);
    vi.mocked(buildChatSheetGuideDataFromTemplateObj_ACU).mockReturnValue({
      sheet_0: { name: '背包物品表', content: [['row_id', '物品名称']] },
    });
    vi.mocked(setChatSheetGuideDataForIsolationKey_ACU).mockReturnValue(false);

    const result = await fillFirstLayerWithTemplateData_ACU({
      sheet_0: {
        name: '背包物品表',
        content: [['row_id', '物品名称'], ['1', '铁剑']],
      },
    });

    expect(result).toBe(false);
    expect(firstMessage._acu_local_template_base_state_seeded).toBeUndefined();
    expect(vi.mocked(applyTemplateScopeForCurrentChat_ACU)).not.toHaveBeenCalled();
    expect(vi.mocked(persistTableMutationLogV2_ACU)).not.toHaveBeenCalled();
    expect(vi.mocked(saveChatToHost_ACU)).not.toHaveBeenCalled();
    expect(vi.mocked(_set_currentJsonTableData_ACU)).not.toHaveBeenCalled();

    vi.mocked(setChatSheetGuideDataForIsolationKey_ACU).mockReturnValue(true);
    const retryResult = await fillFirstLayerWithTemplateData_ACU({
      sheet_0: {
        name: '背包物品表',
        content: [['row_id', '物品名称'], ['1', '铁剑']],
      },
    });

    expect(retryResult).toEqual({ success: true, messageIndex: 0, sheetCount: 1 });
    expect(firstMessage._acu_local_template_base_state_seeded).toBe(GREETING_LOCAL_BASE_STATE_MARKER_ACU);
    expect(vi.mocked(setChatSheetGuideDataForIsolationKey_ACU)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(persistTableMutationLogV2_ACU)).toHaveBeenCalledTimes(1);
  });

  it('V2 checkpoint 写入失败时不设置已播种标记，后续可重试', async () => {
    const firstMessage: any = { is_user: false, mes: '你好，欢迎来到冒险世界！' };
    vi.mocked(getChatArray_ACU).mockReturnValue([firstMessage]);
    vi.mocked(buildChatSheetGuideDataFromTemplateObj_ACU).mockReturnValue({
      sheet_0: { name: '背包物品表', content: [['row_id', '物品名称']] },
    });
    vi.mocked(setChatSheetGuideDataForIsolationKey_ACU).mockReturnValue(true);
    vi.mocked(persistTableMutationLogV2_ACU).mockResolvedValueOnce({ saved: false, error: 'host save failed' });

    const result = await fillFirstLayerWithTemplateData_ACU({
      sheet_0: {
        name: '背包物品表',
        content: [['row_id', '物品名称'], ['1', '铁剑']],
      },
    });

    expect(result).toBe(false);
    expect(firstMessage._acu_local_template_base_state_seeded).toBeUndefined();
    expect(vi.mocked(_set_currentJsonTableData_ACU)).not.toHaveBeenCalled();

    mockPersistV2CheckpointSuccess_ACU();
    const retryResult = await fillFirstLayerWithTemplateData_ACU({
      sheet_0: { name: '背包物品表', content: [['row_id', '物品名称'], ['1', '铁剑']] },
    });
    expect(retryResult).toEqual({ success: true, messageIndex: 0, sheetCount: 1 });
    expect(firstMessage._acu_local_template_base_state_seeded).toBe(GREETING_LOCAL_BASE_STATE_MARKER_ACU);
  });

  it('多张表格全部写入', async () => {
    const templateObj = {
      sheet_0: { name: '表A', content: [['row_id', 'col1'], ['1', 'a']] },
      sheet_1: { name: '表B', content: [['row_id', 'col2'], ['1', 'b']] },
      sheet_2: { name: '表C', content: [['row_id', 'col3'], ['1', 'c']] },
    };

    const result = await fillFirstLayerWithTemplateData_ACU(templateObj);
    expect(result).toEqual({ success: true, messageIndex: 0, sheetCount: 3 });
  });

  it('不可安全修复的模板行会返回初始化失败，且不写入 checkpoint 或内存', async () => {
    const result = await fillFirstLayerWithTemplateData_ACU({
      sheet_invalid: {
        name: '非法表',
        content: [['row_id', '值'], ['1', '正常行'], '非数组行'],
      },
    });

    expect(result).toEqual({ success: false });
    expect(vi.mocked(persistTableMutationLogV2_ACU)).not.toHaveBeenCalled();
    expect(vi.mocked(_set_currentJsonTableData_ACU)).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// maybeLiftWorldbookSuppression_ACU — 解除世界书注入抑制
// ═══════════════════════════════════════════════════════════════
describe('maybeLiftWorldbookSuppression_ACU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('suppressWorldbookInjectionInGreeting_ACU 为 false 时直接返回，不调用任何函数', () => {
    // mock 模块返回 false（默认值）
    maybeLiftWorldbookSuppression_ACU();
    // 不应调用 _set_suppressWorldbookInjectionInGreeting_ACU
    expect(vi.mocked(_set_suppressWorldbookInjectionInGreeting_ACU)).not.toHaveBeenCalled();
  });

  it('聊天中无用户消息时不解除抑制', () => {
    // 需要 suppressWorldbookInjectionInGreeting_ACU 为 true 才能进入逻辑
    // 但由于 mock 模块返回的是固定值 false，这个测试验证的是：即使调用也不会错误地解除
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: false, mes: 'AI回复' },
    ]);
    maybeLiftWorldbookSuppression_ACU();
    expect(vi.mocked(_set_suppressWorldbookInjectionInGreeting_ACU)).not.toHaveBeenCalled();
  });

  it('聊天记录为非数组时不报错', () => {
    vi.mocked(getChatArray_ACU).mockReturnValue(null as any);
    expect(() => maybeLiftWorldbookSuppression_ACU()).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════
// getEffectiveAutoUpdateThreshold_ACU — 获取有效的自动更新阈值
// ═══════════════════════════════════════════════════════════════
describe('getEffectiveAutoUpdateThreshold_ACU', () => {
  it('settings_ACU.autoUpdateThreshold 为正常数字时返回该值', () => {
    (settings_ACU as any).autoUpdateThreshold = 5;
    const result = getEffectiveAutoUpdateThreshold_ACU();
    expect(result).toBe(5);
  });

  it('settings_ACU.autoUpdateThreshold 为 NaN 时返回默认值 3', () => {
    (settings_ACU as any).autoUpdateThreshold = 'abc';
    const result = getEffectiveAutoUpdateThreshold_ACU();
    expect(result).toBe(3);
  });

  it('settings_ACU.autoUpdateThreshold 为 undefined 时返回默认值 3', () => {
    (settings_ACU as any).autoUpdateThreshold = undefined;
    const result = getEffectiveAutoUpdateThreshold_ACU();
    expect(result).toBe(3);
  });

  it('settings_ACU.autoUpdateThreshold 为 0 时返回 0（合法值）', () => {
    (settings_ACU as any).autoUpdateThreshold = 0;
    const result = getEffectiveAutoUpdateThreshold_ACU();
    expect(result).toBe(0);
  });

  it('接受 calledFrom 参数但不影响返回值', () => {
    (settings_ACU as any).autoUpdateThreshold = 7;
    const result = getEffectiveAutoUpdateThreshold_ACU('manual');
    expect(result).toBe(7);
  });
});

// ═══════════════════════════════════════════════════════════════
// shouldSuppressWorldbookInjection_ACU — 世界书注入抑制判断
// ═══════════════════════════════════════════════════════════════
describe('shouldSuppressWorldbookInjection_ACU', () => {
  it('始终返回 false（用户要求取消首楼限制）', () => {
    expect(shouldSuppressWorldbookInjection_ACU()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// isNewChatGreetingStage_ACU — 判断是否处于新对话开场白阶段
// ═══════════════════════════════════════════════════════════════
describe('isNewChatGreetingStage_ACU', () => {
  it('只有AI消息、无用户消息时返回 true', () => {
    const chat = [{ is_user: false, mes: '你好，欢迎来到冒险世界！' }];
    expect(isNewChatGreetingStage_ACU(chat)).toBe(true);
  });

  it('有用户消息时返回 false', () => {
    const chat = [
      { is_user: false, mes: 'AI开场白' },
      { is_user: true, mes: '你好' },
    ];
    expect(isNewChatGreetingStage_ACU(chat)).toBe(false);
  });

  it('空数组返回 false', () => {
    expect(isNewChatGreetingStage_ACU([])).toBe(false);
  });

  it('null 输入返回 false', () => {
    expect(isNewChatGreetingStage_ACU(null as any)).toBe(false);
  });

  it('只有用户消息（无AI消息）时返回 false', () => {
    const chat = [{ is_user: true, mes: '用户消息' }];
    expect(isNewChatGreetingStage_ACU(chat)).toBe(false);
  });

  it('多条AI消息、无用户消息时返回 true', () => {
    const chat = [
      { is_user: false, mes: 'AI消息1' },
      { is_user: false, mes: 'AI消息2' },
    ];
    expect(isNewChatGreetingStage_ACU(chat)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// isSingleAiNoUserChat_ACU — 判断是否只有单条AI消息无用户消息
// ═══════════════════════════════════════════════════════════════
describe('isSingleAiNoUserChat_ACU', () => {
  it('单条AI消息、无用户消息时返回 true', () => {
    const chat = [{ is_user: false, mes: 'AI开场白' }];
    expect(isSingleAiNoUserChat_ACU(chat)).toBe(true);
  });

  it('多条AI消息、无用户消息时返回 false', () => {
    const chat = [
      { is_user: false, mes: 'AI消息1' },
      { is_user: false, mes: 'AI消息2' },
    ];
    expect(isSingleAiNoUserChat_ACU(chat)).toBe(false);
  });

  it('有用户消息时返回 false', () => {
    const chat = [
      { is_user: false, mes: 'AI消息' },
      { is_user: true, mes: '用户消息' },
    ];
    expect(isSingleAiNoUserChat_ACU(chat)).toBe(false);
  });

  it('空数组返回 false', () => {
    expect(isSingleAiNoUserChat_ACU([])).toBe(false);
  });

  it('null 输入返回 false', () => {
    expect(isSingleAiNoUserChat_ACU(null as any)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// buildTemplateBaseStateDataForLocalStorage_ACU — 构建本地存储数据结构
// ═══════════════════════════════════════════════════════════════
describe('buildTemplateBaseStateDataForLocalStorage_ACU', () => {
  it('正常模板对象返回包含 mate 和 sheet_ 数据的结构', () => {
    const templateObj = {
      sheet_0: { name: '背包物品表', content: [['row_id', '物品名称'], ['1', '铁剑']] },
      sheet_1: { name: '角色表', content: [['row_id', '角色名'], ['1', '冈部']] },
    };
    const result = buildTemplateBaseStateDataForLocalStorage_ACU(templateObj);
    expect(result).not.toBeNull();
    expect(result!.mate).toEqual({ type: 'chatSheets', version: 1 });
    expect(result!.sheet_0.name).toBe('背包物品表');
    expect(result!.sheet_1.name).toBe('角色表');
  });

  it('为初始 checkpoint 的模板预置行补齐稳定 row_id，且不修改原模板', () => {
    const systemRulesRows = Array.from({ length: 11 }, (_, index) => [
      index === 3 ? '8' : (index === 7 ? ' custom-rule ' : null),
      '规则类别',
      `规则${index + 1}`,
    ]);
    const templateObj = {
      sheet_SystemRules: {
        name: '系统规则表',
        content: [['row_id', '规则类别', '规则名称'], ...systemRulesRows],
      },
    };

    const result = buildTemplateBaseStateDataForLocalStorage_ACU(templateObj);

    expect(result!.sheet_SystemRules.content).toEqual([
      ['row_id', '规则类别', '规则名称'],
      ['1', '规则类别', '规则1'],
      ['2', '规则类别', '规则2'],
      ['3', '规则类别', '规则3'],
      ['8', '规则类别', '规则4'],
      ['4', '规则类别', '规则5'],
      ['5', '规则类别', '规则6'],
      ['6', '规则类别', '规则7'],
      ['custom-rule', '规则类别', '规则8'],
      ['7', '规则类别', '规则9'],
      ['9', '规则类别', '规则10'],
      ['10', '规则类别', '规则11'],
    ]);
    expect(templateObj.sheet_SystemRules.content).toEqual([
      ['row_id', '规则类别', '规则名称'],
      ...systemRulesRows,
    ]);
  });

  it('保留重复的非空 row_id，交由 canonical checkpoint 边界拒绝', () => {
    const templateObj = {
      sheet_duplicate: {
        name: '重复身份表',
        content: [['row_id', '值'], [' stable-id ', '第一行'], ['stable-id', '第二行']],
      },
    };

    const result = buildTemplateBaseStateDataForLocalStorage_ACU(templateObj);

    expect(result!.sheet_duplicate.content).toEqual([
      ['row_id', '值'],
      ['stable-id', '第一行'],
      ['stable-id', '第二行'],
    ]);
  });

  it('初始 checkpoint 基底拒绝缺少 row_id 表头的模板，不改写表头语义', () => {
    const templateObj = {
      sheet_invalid_header: {
        name: '非法表头',
        content: [['id', '值'], [null, '不可补齐']],
      },
    };

    expect(() => buildTemplateBaseStateDataForLocalStorage_ACU(templateObj))
      .toThrow(/缺少 row_id 表头/);
    expect(templateObj.sheet_invalid_header.content[0][0]).toBe('id');
  });

  it('初始 checkpoint 基底拒绝非数组数据行，不将其伪造为合法行', () => {
    const templateObj = {
      sheet_invalid: {
        name: '非法表',
        content: [['row_id', '值'], ['1', '首行'], ['1', '重复行'], '不是数组'],
      },
    };

    expect(() => buildTemplateBaseStateDataForLocalStorage_ACU(templateObj))
      .toThrow(/包含非数组数据行/);
  });

  it('返回的数据是深拷贝，修改不影响原对象', () => {
    const templateObj = {
      sheet_0: { name: '背包物品表', content: [['row_id', '物品名称'], ['1', '铁剑']] },
    };
    const result = buildTemplateBaseStateDataForLocalStorage_ACU(templateObj);
    result!.sheet_0.name = '被修改的名称';
    expect(templateObj.sheet_0.name).toBe('背包物品表');
  });

  it('null 输入返回 null', () => {
    expect(buildTemplateBaseStateDataForLocalStorage_ACU(null)).toBeNull();
  });

  it('非对象输入返回 null', () => {
    expect(buildTemplateBaseStateDataForLocalStorage_ACU('string' as any)).toBeNull();
  });

  it('无 sheet_ 键的对象返回 null', () => {
    const templateObj = { mate: { type: 'acu' }, config: {} };
    expect(buildTemplateBaseStateDataForLocalStorage_ACU(templateObj)).toBeNull();
  });

  it('非 sheet_ 键被排除', () => {
    const templateObj = {
      mate: { type: 'acu' },
      sheet_0: { name: '表A', content: [] },
      config: { enabled: true },
    };
    const result = buildTemplateBaseStateDataForLocalStorage_ACU(templateObj);
    expect(result).not.toBeNull();
    expect(result!.sheet_0).toBeDefined();
    expect(result!.config).toBeUndefined();
    expect(result!.mate).toEqual({ type: 'chatSheets', version: 1 }); // mate 被覆盖为标准结构
  });
});

// ═══════════════════════════════════════════════════════════════
// ensureInitialSeedCheckpoint_ACU — 首个真实 AI 回复前将模板基础状态写入 0 层
// ═══════════════════════════════════════════════════════════════
import { parseTableTemplateJson_ACU, ensureSheetOrderNumbers_ACU } from '../../../src/shared/utils';
import { deleteAllGeneratedEntries_ACU } from '../../../src/service/worldbook/pipeline';

describe('ensureInitialSeedCheckpoint_ACU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentIsolationKey_ACU).mockReturnValue('');
    vi.mocked(getSortedSheetKeys_ACU).mockImplementation((data: any) =>
      data ? Object.keys(data).filter((k: string) => k.startsWith('sheet_')).sort() : [],
    );
    vi.mocked(reorderDataBySheetKeys_ACU).mockImplementation((data: any) => data);
    vi.mocked(readIsolatedTagData_ACU).mockReturnValue(null);
    vi.mocked(readLegacyIndependentData_ACU).mockReturnValue(null);
    vi.mocked(isLegacyMatchForIsolation_ACU).mockReturnValue(false);
    mockPersistV2CheckpointSuccess_ACU();
  });

  it('只有开场白、还没有用户消息时返回 false', async () => {
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: false, mes: 'AI开场白' },
    ]);
    const result = await ensureInitialSeedCheckpoint_ACU();
    expect(result).toBe(false);
  });

  it('空聊天记录时返回 false', async () => {
    vi.mocked(getChatArray_ACU).mockReturnValue([]);
    const result = await ensureInitialSeedCheckpoint_ACU();
    expect(result).toBe(false);
  });

  it('幂等：已标记过的消息不重复写入', async () => {
    const greetingMsg = {
      is_user: false,
      mes: 'AI开场白',
      _acu_local_template_base_state_seeded: GREETING_LOCAL_BASE_STATE_MARKER_ACU,
    };
    vi.mocked(getChatArray_ACU).mockReturnValue([greetingMsg, { is_user: true, mes: '用户消息' }]);
    const result = await ensureInitialSeedCheckpoint_ACU();
    expect(result).toBe(false);
  });

  it('模板为 null 时返回 false', async () => {
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: false, mes: 'AI开场白' },
      { is_user: true, mes: '用户消息' },
    ]);
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue(null);
    const result = await ensureInitialSeedCheckpoint_ACU();
    expect(result).toBe(false);
  });

  it('首个用户消息后首次写入：默认写入 V2 full checkpoint、保存聊天、清理世界书、更新内存', async () => {
    const greetingMsg: any = { is_user: false, mes: 'AI开场白' };
    vi.mocked(getChatArray_ACU).mockReturnValue([greetingMsg, { is_user: true, mes: '用户消息' }]);
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      sheet_0: { name: '背包物品表', content: [['row_id', '物品名称'], ['1', '铁剑']] },
    });

    const result = await ensureInitialSeedCheckpoint_ACU();

    expect(result).toEqual({ success: true, messageIndex: 0 });
    const tagData = greetingMsg.TavernDB_ACU_IsolatedData?.[''];
    expect(tagData?._acu_storage_version).toBe(2);
    expect(tagData?.storageFrame?.version).toBe(2);
    expect(tagData?.storageFrame?.checkpoint?.kind).toBe('full');
    expect(tagData?.storageFrame?.checkpoint?.data?.sheet_0?.content?.[1]?.[1]).toBe('铁剑');
    expect(greetingMsg._acu_local_template_base_state_seeded).toBe(GREETING_LOCAL_BASE_STATE_MARKER_ACU);
    expect(vi.mocked(saveChatToHost_ACU)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deleteAllGeneratedEntries_ACU)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(_set_currentJsonTableData_ACU)).toHaveBeenCalledTimes(1);
  });

  it('用户消息尚未落聊天记录但发送已触发时，允许提前写入 0 层初始化 checkpoint', async () => {
    const greetingMsg: any = { is_user: false, mes: 'AI开场白' };
    vi.mocked(getChatArray_ACU).mockReturnValue([greetingMsg]);
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      sheet_0: { name: '表', content: [['row_id', 'col'], ['1', 'val']] },
    });

    const result = await ensureInitialSeedCheckpoint_ACU({ allowPendingFirstUserMessage: true });

    expect(result).toEqual({ success: true, messageIndex: 0 });
  });

  it('deleteAllGeneratedEntries_ACU 抛错时不影响整体流程（错误被捕获）', async () => {
    const greetingMsg: any = { is_user: false, mes: 'AI开场白' };
    vi.mocked(getChatArray_ACU).mockReturnValue([greetingMsg, { is_user: true, mes: '用户消息' }]);
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      sheet_0: { name: '表', content: [['row_id', 'col'], ['1', 'val']] },
    });
    vi.mocked(deleteAllGeneratedEntries_ACU).mockRejectedValue(new Error('世界书清理失败'));

    const result = await ensureInitialSeedCheckpoint_ACU();
    // 即使世界书清理失败，整体流程仍然成功
    expect(result).toEqual({ success: true, messageIndex: 0 });
    // 内存仍然被更新
    expect(vi.mocked(_set_currentJsonTableData_ACU)).toHaveBeenCalledTimes(1);
  });

  it('找不到第一条AI消息时返回 false', async () => {
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true, mes: '用户消息' },
    ]);
    const result = await ensureInitialSeedCheckpoint_ACU();
    expect(result).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// parseReadableToJson_ACU — 将 Markdown 文本反解析回 JSON 表格数据
// ═══════════════════════════════════════════════════════════════

// 需要动态修改 currentJsonTableData_ACU 的 mock 值
import * as stateManager from '../../../src/service/runtime/state-manager';

describe('parseReadableToJson_ACU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSortedSheetKeys_ACU).mockImplementation((data: any) =>
      data ? Object.keys(data).filter((k: string) => k.startsWith('sheet_')).sort() : [],
    );
  });

  it('currentJsonTableData_ACU 为 null 时返回 null', () => {
    // 默认 mock 中 currentJsonTableData_ACU 就是 null
    const result = parseReadableToJson_ACU('# 背包物品表\n| 物品名称 |\n|---|\n| 铁剑 |');
    expect(result).toBeNull();
  });

  it('正常单表解析：Markdown 文本还原为 JSON 表格数据', () => {
    // 设置 currentJsonTableData_ACU
    Object.defineProperty(stateManager, 'currentJsonTableData_ACU', {
      value: {
        sheet_0: {
          name: '背包物品表',
          content: [['row_id', '物品名称', '数量'], ['1', '铁剑', '3']],
        },
      },
      writable: true,
      configurable: true,
    });

    const markdownText = '# 背包物品表\n| 物品名称 | 数量 |\n|---|---|\n| 魔法杖 | 1 |\n| 药水 | 5 |';
    const result = parseReadableToJson_ACU(markdownText);

    expect(result).not.toBeNull();
    expect(result!.sheet_0.content[0]).toEqual(['row_id', '物品名称', '数量']); // 表头保留原始
    expect(result!.sheet_0.content[1]).toEqual(['2', '魔法杖', '1']); // 新行不复用旧身份
    expect(result!.sheet_0.content[2]).toEqual(['3', '药水', '5']); // 第一行分配后立即保留
    expect(result!.sheet_0.content.length).toBe(3); // 表头 + 2行数据

    // 恢复
    Object.defineProperty(stateManager, 'currentJsonTableData_ACU', {
      value: null, writable: true, configurable: true,
    });
  });

  it('表名不匹配时跳过该表', () => {
    Object.defineProperty(stateManager, 'currentJsonTableData_ACU', {
      value: {
        sheet_0: {
          name: '背包物品表',
          content: [['row_id', '物品名称'], ['1', '铁剑']],
        },
      },
      writable: true,
      configurable: true,
    });

    const markdownText = '# 不存在的表\n| 列1 |\n|---|\n| 值1 |';
    const result = parseReadableToJson_ACU(markdownText);

    expect(result).not.toBeNull();
    // 原始数据不变（不存在的表被跳过）
    expect(result!.sheet_0.content[1][1]).toBe('铁剑');

    Object.defineProperty(stateManager, 'currentJsonTableData_ACU', {
      value: null, writable: true, configurable: true,
    });
  });

  it('重建 Markdown 表格时使用稳定 allocator，从历史最大 row_id 后继续分配', () => {
    Object.defineProperty(stateManager, 'currentJsonTableData_ACU', {
      value: {
        sheet_0: {
          name: '背包物品表',
          content: [['row_id', '物品名称'], ['1', '铁剑'], ['3', '盾牌'], ['alpha', '标记']],
        },
      },
      writable: true,
      configurable: true,
    });

    const result = parseReadableToJson_ACU('# 背包物品表\n| 物品名称 |\n|---|\n| 魔法杖 |\n| 药水 |');

    expect(result?.sheet_0.content).toEqual([
      ['row_id', '物品名称'],
      ['4', '魔法杖'],
      ['5', '药水'],
    ]);
    Object.defineProperty(stateManager, 'currentJsonTableData_ACU', {
      value: null, writable: true, configurable: true,
    });
  });

  it('列数少于表头时自动补空字符串（pad）', () => {
    Object.defineProperty(stateManager, 'currentJsonTableData_ACU', {
      value: {
        sheet_0: {
          name: '表A',
          content: [['row_id', 'col1', 'col2', 'col3'], ['1', 'a', 'b', 'c']],
        },
      },
      writable: true,
      configurable: true,
    });

    // Markdown 只有 1 列数据，但表头有 3 列（+ row_id = 4列）
    const markdownText = '# 表A\n| col1 |\n|---|\n| 值1 |';
    const result = parseReadableToJson_ACU(markdownText);

    expect(result).not.toBeNull();
    // row_id + 值1 = 2列，需要 pad 到 4 列
    expect(result!.sheet_0.content[1].length).toBe(4);
    expect(result!.sheet_0.content[1][0]).toBe('2'); // 不复用原有 row_id
    expect(result!.sheet_0.content[1][1]).toBe('值1');
    expect(result!.sheet_0.content[1][2]).toBe(''); // padded
    expect(result!.sheet_0.content[1][3]).toBe(''); // padded

    Object.defineProperty(stateManager, 'currentJsonTableData_ACU', {
      value: null, writable: true, configurable: true,
    });
  });

  it('列数多于表头时截断（truncate）', () => {
    Object.defineProperty(stateManager, 'currentJsonTableData_ACU', {
      value: {
        sheet_0: {
          name: '表A',
          content: [['row_id', 'col1'], ['1', 'a']],
        },
      },
      writable: true,
      configurable: true,
    });

    // Markdown 有 3 列数据，但表头只有 1 列（+ row_id = 2列）
    const markdownText = '# 表A\n| col1 | col2 | col3 |\n|---|---|---|\n| 值1 | 值2 | 值3 |';
    const result = parseReadableToJson_ACU(markdownText);

    expect(result).not.toBeNull();
    // row_id + 值1 + 值2 + 值3 = 4列，需要 truncate 到 2 列
    expect(result!.sheet_0.content[1].length).toBe(2);
    expect(result!.sheet_0.content[1][0]).toBe('2'); // 不复用原有 row_id
    expect(result!.sheet_0.content[1][1]).toBe('值1'); // 只保留第一列

    Object.defineProperty(stateManager, 'currentJsonTableData_ACU', {
      value: null, writable: true, configurable: true,
    });
  });

  it('多表解析：每张表独立还原', () => {
    Object.defineProperty(stateManager, 'currentJsonTableData_ACU', {
      value: {
        sheet_0: {
          name: '表A',
          content: [['row_id', 'col1'], ['1', 'old_a']],
        },
        sheet_1: {
          name: '表B',
          content: [['row_id', 'col2'], ['1', 'old_b']],
        },
      },
      writable: true,
      configurable: true,
    });

    const markdownText = '# 表A\n| col1 |\n|---|\n| new_a |\n# 表B\n| col2 |\n|---|\n| new_b |';
    const result = parseReadableToJson_ACU(markdownText);

    expect(result).not.toBeNull();
    expect(result!.sheet_0.content[1][1]).toBe('new_a');
    expect(result!.sheet_1.content[1][1]).toBe('new_b');

    Object.defineProperty(stateManager, 'currentJsonTableData_ACU', {
      value: null, writable: true, configurable: true,
    });
  });

  it('返回的数据是深拷贝，修改不影响 currentJsonTableData_ACU', () => {
    const originalData = {
      sheet_0: {
        name: '表A',
        content: [['row_id', 'col1'], ['1', '原始值']],
      },
    };
    Object.defineProperty(stateManager, 'currentJsonTableData_ACU', {
      value: originalData,
      writable: true,
      configurable: true,
    });

    const markdownText = '# 表A\n| col1 |\n|---|\n| 新值 |';
    const result = parseReadableToJson_ACU(markdownText);

    // 修改返回值不影响原始数据
    result!.sheet_0.content[1][1] = '被篡改的值';
    expect(originalData.sheet_0.content[1][1]).toBe('原始值');

    Object.defineProperty(stateManager, 'currentJsonTableData_ACU', {
      value: null, writable: true, configurable: true,
    });
  });

  it('空文本（无 # 分隔符）时返回原始数据的克隆', () => {
    Object.defineProperty(stateManager, 'currentJsonTableData_ACU', {
      value: {
        sheet_0: {
          name: '表A',
          content: [['row_id', 'col1'], ['1', '原始值']],
        },
      },
      writable: true,
      configurable: true,
    });

    const result = parseReadableToJson_ACU('');
    expect(result).not.toBeNull();
    // 没有任何表被解析，返回原始数据的克隆
    expect(result!.sheet_0.content[1][1]).toBe('原始值');

    Object.defineProperty(stateManager, 'currentJsonTableData_ACU', {
      value: null, writable: true, configurable: true,
    });
  });
});
