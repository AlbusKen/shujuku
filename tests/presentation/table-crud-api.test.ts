/**
 * tests/presentation/table-crud-api.test.ts
 * 表格 CRUD API 单元测试 — SQLite 模式 SQL 生成逻辑
 *
 * 策略：mock 全局状态 + mock provider，测试 SQL 生成的正确性和边界条件
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════
// Mock 设置
// ═══════════════════════════════════════════════════════════════

vi.mock('../../src/shared/env', () => ({
  topLevelWindow_ACU: { AutoCardUpdaterAPI: { _notifyTableUpdate: vi.fn() } },
}));

vi.mock('../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  isSummaryOrOutlineTable_ACU: vi.fn(() => false),
}));

vi.mock('../../src/shared/host-api', () => ({
  SillyTavern_API_ACU: { chat: [] },
}));

let mockCurrentJsonTableData: any = null;
let mockSettings: any = { dataIsolationEnabled: false, dataIsolationCode: '' };
let mockIsAutoUpdatingCard = false;

vi.mock('../../src/service/runtime/state-manager', () => ({
  currentChatFileIdentifier_ACU: 'chat-a',
  get currentJsonTableData_ACU() { return mockCurrentJsonTableData; },
  get settings_ACU() { return mockSettings; },
  get isAutoUpdatingCard_ACU() { return mockIsAutoUpdatingCard; },
  getCurrentIsolationKey_ACU: vi.fn(() => ''),
  _set_currentJsonTableData_ACU: vi.fn((data: any) => { mockCurrentJsonTableData = data; }),
}));

let mockIsSqliteMode = false;
vi.mock('../../src/service/table/storage-mode', () => ({
  isSqliteMode: vi.fn(() => mockIsSqliteMode),
}));

const {
  mockApplyParameterizedSqlMutation,
  mockBuildSqlSheetBatchOperations,
  mockPersistTablesToChatMessage,
  mockRebindSqlMutationTableIdentifiers,
  mockRebindSqlMutationIdentifiers,
  mockExecuteRuntimeMutation,
  mockGetRuntimeData,
  mockCreateRuntimeSnapshot,
  mockRestoreRuntimeSnapshot,
  mockEnsureStorageProviderReady,
  mockReloadStorageProvider,
  mockRunTableWriteTransaction,
} = vi.hoisted(() => ({
  mockApplyParameterizedSqlMutation: vi.fn(),
  mockBuildSqlSheetBatchOperations: vi.fn((statements: string[], _tableData: any, options: any) => ({
    operations: [{
      kind: 'sql_sheet_batch',
      sheetKey: options.fallbackTargetSheetKeys?.[0] || 'sheet_0',
      tableName: 'beibaowupinbiao',
      statements,
      reason: options.reason,
    }],
  })),
  mockPersistTablesToChatMessage: vi.fn().mockResolvedValue({ saved: true, messageIndex: 0 }),
  mockRebindSqlMutationTableIdentifiers: vi.fn((statements: string[]) => statements),
  mockRebindSqlMutationIdentifiers: vi.fn((statements: string[]) => statements),
  mockExecuteRuntimeMutation: vi.fn((_sql: string, _params?: any[]) => ({
    changes: 1,
    errors: [] as string[],
  })),
  mockGetRuntimeData: vi.fn(),
  mockCreateRuntimeSnapshot: vi.fn(() => new Uint8Array([1, 2, 3])),
  mockRestoreRuntimeSnapshot: vi.fn().mockResolvedValue(undefined),
  mockEnsureStorageProviderReady: vi.fn().mockImplementation(async () => ({
    executeMutation: mockExecuteRuntimeMutation,
    getCurrentData: mockGetRuntimeData,
    createRuntimeSnapshot: mockCreateRuntimeSnapshot,
    restoreRuntimeSnapshot: mockRestoreRuntimeSnapshot,
  })),
  mockReloadStorageProvider: vi.fn().mockResolvedValue(undefined),
  mockRunTableWriteTransaction: vi.fn(async (options: any, task: any) => task({
    transactionId: 'tx-crud-test',
    chatKey: 'chat-a',
    isolationKey: '',
    source: options.source,
    baseRevision: null,
    writeSet: options.writeSet,
    runCommit: async (commitTask: any) => commitTask(),
  }, options.initialData ? JSON.parse(JSON.stringify(options.initialData)) : null)),
}));
vi.mock('../../src/service/table/table-storage-strategy', () => ({
  getStorageProvider: vi.fn(() => ({
    executeMutation: mockExecuteRuntimeMutation,
    getCurrentData: mockGetRuntimeData,
    createRuntimeSnapshot: mockCreateRuntimeSnapshot,
    restoreRuntimeSnapshot: mockRestoreRuntimeSnapshot,
  })),
  // CRUD 的 mapper 同步必须经活跃 provider 的 owner-aware 刷新；
  // 这里默认无活跃 SQLite provider，走无所有权兼容刷新分支。
  getActiveStorageProvider: vi.fn(() => null),
  ensureStorageProviderReady_ACU: mockEnsureStorageProviderReady,
  reloadStorageProvider: mockReloadStorageProvider,
}));

vi.mock('../../src/service/table/sql-table-service', () => ({
  applyParameterizedSqlMutationToTableDataSnapshot_ACU: mockApplyParameterizedSqlMutation,
  buildSqlSheetBatchOperations_ACU: mockBuildSqlSheetBatchOperations,
  rebindSqlMutationIdentifiers_ACU: mockRebindSqlMutationIdentifiers,
  rebindSqlMutationTableIdentifiers_ACU: mockRebindSqlMutationTableIdentifiers,
}));

vi.mock('../../src/service/table/table-service', () => ({
  ensureLegacyStorageMigratedBeforeWrite_ACU: vi.fn().mockResolvedValue({ success: true, migrated: false }),
  persistTablesToChatMessage_ACU: mockPersistTablesToChatMessage,
  saveIndependentTableToChatHistory_ACU: vi.fn().mockResolvedValue({ saved: true }),
}));

// 保留真实 NameMapper 行为，只监视无所有权兼容入口是否被调用。
const { mockEnsureGlobalNameMapperForDDLs } = vi.hoisted(() => ({
  mockEnsureGlobalNameMapperForDDLs: vi.fn(),
}));
vi.mock('../../src/service/runtime/template-vars/name-mapper', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/service/runtime/template-vars/name-mapper')>();
  return {
    ...original,
    ensureGlobalNameMapperForDDLs_ACU: (ddlMap: Map<string, string>) => {
      mockEnsureGlobalNameMapperForDDLs(ddlMap);
      return original.ensureGlobalNameMapperForDDLs_ACU(ddlMap);
    },
  };
});

vi.mock('../../src/service/table/table-write-transaction', () => ({
  captureTableRuntimeRevisionForWriteSet_ACU: vi.fn(() => 'runtime-rev-head'),
  runTableWriteTransaction_ACU: mockRunTableWriteTransaction,
}));

vi.mock('../../src/service/table/table-history', () => ({
  getLatestTableAppendMessageIndexFromChat_ACU: vi.fn(() => 0),
  resolveTableHistoryStateFromChat_ACU: vi.fn(() => ({
    latestAiMessageIndex: 0,
    latestDataMessageIndex: -1,
    lastTrackedUpdateMessageIndex: -1,
    latestDataAiFloor: 0,
    lastTrackedUpdateAiFloor: 0,
    hasAnyData: false,
    hasTrackedUpdate: false,
  })),
}));

vi.mock('../../src/presentation/triggers/update-process', () => ({
  saveCurrentDataForTable_ACU: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/presentation/components/pipeline-ui-helpers', () => ({
  refreshMergedDataAndNotifyWithUI_ACU: vi.fn().mockResolvedValue(undefined),
}));

import {
  quoteIdentifier,
  findTargetSheet,
  createTableCrudApi,
} from '../../src/presentation/bootstrap/api-groups/table-crud-api';
import { resolveTableHistoryStateFromChat_ACU } from '../../src/service/table/table-history';
import { SillyTavern_API_ACU } from '../../src/shared/host-api';
import { getActiveStorageProvider } from '../../src/service/table/table-storage-strategy';

// ═══════════════════════════════════════════════════════════════
// quoteIdentifier
// ═══════════════════════════════════════════════════════════════
describe('quoteIdentifier', () => {
  it('普通英文标识符', () => {
    expect(quoteIdentifier('item_name')).toBe('`item_name`');
  });

  it('中文标识符', () => {
    expect(quoteIdentifier('背包物品表')).toBe('`背包物品表`');
  });

  it('包含反引号的标识符（转义）', () => {
    expect(quoteIdentifier('col`name')).toBe('`col``name`');
  });

  it('空字符串', () => {
    expect(quoteIdentifier('')).toBe('``');
  });

  it('包含空格的标识符', () => {
    expect(quoteIdentifier('item name')).toBe('`item name`');
  });

  it('包含特殊字符的标识符', () => {
    expect(quoteIdentifier('col-1')).toBe('`col-1`');
  });

  it('多个反引号', () => {
    expect(quoteIdentifier('a``b')).toBe('`a````b`');
  });
});

// ═══════════════════════════════════════════════════════════════
// findTargetSheet
// ═══════════════════════════════════════════════════════════════
describe('findTargetSheet', () => {
  beforeEach(() => {
    mockCurrentJsonTableData = null;
    mockEnsureGlobalNameMapperForDDLs.mockClear();
  });

  it('找到匹配的表', () => {
    mockCurrentJsonTableData = {
      sheet_0: { name: '背包物品表', content: [['row_id', 'item']] },
      sheet_1: { name: '技能表', content: [['row_id', 'skill']] },
    };
    const result = findTargetSheet('技能表');
    expect(result).not.toBeNull();
    expect(result!.sheetKey).toBe('sheet_1');
    expect(result!.sheet.name).toBe('技能表');
  });

  it('找不到表返回 null', () => {
    mockCurrentJsonTableData = {
      sheet_0: { name: '背包物品表', content: [] },
    };
    expect(findTargetSheet('不存在的表')).toBeNull();
  });

  it('currentJsonTableData 为 null 返回 null', () => {
    mockCurrentJsonTableData = null;
    expect(findTargetSheet('任意表')).toBeNull();
  });

  it('跳过非 sheet_ 开头的键', () => {
    mockCurrentJsonTableData = {
      mate: { name: '背包物品表' },
      sheet_0: { name: '背包物品表', content: [] },
    };
    const result = findTargetSheet('背包物品表');
    expect(result!.sheetKey).toBe('sheet_0');
  });

  describe('活跃 SQLite runtime 的 owner-aware 映射刷新', () => {
    const tableData = {
      sheet_0: { name: '背包物品表', content: [['row_id', 'item']] },
    };

    afterEach(() => {
      vi.mocked(getActiveStorageProvider).mockReturnValue(null as any);
    });

    it('存在活跃 SQLite runtime 时经其刷新映射，不走无所有权兼容入口', () => {
      mockCurrentJsonTableData = tableData;
      const refreshNameMapperForData_ACU = vi.fn(() => true);
      vi.mocked(getActiveStorageProvider).mockReturnValue({ mode: 'sqlite', refreshNameMapperForData_ACU } as any);

      const result = findTargetSheet('背包物品表');

      expect(result!.sheetKey).toBe('sheet_0');
      expect(refreshNameMapperForData_ACU).toHaveBeenCalledWith(tableData);
      expect(mockEnsureGlobalNameMapperForDDLs).not.toHaveBeenCalled();
    });

    it('活跃 SQLite runtime 发布被拒时 fail-closed，不得带着不同源映射解析表名', () => {
      mockCurrentJsonTableData = tableData;
      const refreshNameMapperForData_ACU = vi.fn(() => false);
      vi.mocked(getActiveStorageProvider).mockReturnValue({ mode: 'sqlite', refreshNameMapperForData_ACU } as any);

      expect(findTargetSheet('背包物品表')).toBeNull();
      expect(mockEnsureGlobalNameMapperForDDLs).not.toHaveBeenCalled();
    });

    it('活跃 SQLite runtime 缺少 owner-aware 刷新能力时同样 fail-closed', () => {
      mockCurrentJsonTableData = tableData;
      vi.mocked(getActiveStorageProvider).mockReturnValue({ mode: 'sqlite' } as any);

      expect(findTargetSheet('背包物品表')).toBeNull();
      expect(mockEnsureGlobalNameMapperForDDLs).not.toHaveBeenCalled();
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// createTableCrudApi — SQLite 模式 SQL 生成
// ═══════════════════════════════════════════════════════════════
describe('createTableCrudApi — SQLite 模式', () => {
  let api: Record<string, Function>;
  const mockCtx: any = {};

  function useInvestigatorSheetWithUncommentedStats() {
    mockCurrentJsonTableData = {
      sheet_diao_cha_yuan_jue_se_ka_biao: {
        uid: 'sheet_diao_cha_yuan_jue_se_ka_biao',
        name: '调查员角色卡表',
        sourceData: {
          ddl: `CREATE TABLE investigator_legacy ( -- 调查员角色卡表
  row_id INTEGER PRIMARY KEY, -- 行号
  STR TEXT,
  DEX TEXT,
  name TEXT -- 姓名
);`,
        },
        content: [['row_id', 'STR', 'DEX', '姓名'], ['1', '50', '60', '助手']],
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsSqliteMode = true;
    (SillyTavern_API_ACU as any).chat = [{ is_user: false }];
    mockCurrentJsonTableData = {
      sheet_0: {
        uid: 'inventory',
        name: '背包物品表',
        sourceData: {
          ddl: `CREATE TABLE inventory ( -- 背包物品表
  row_id INTEGER PRIMARY KEY, -- 行号
  item_name TEXT, -- 物品名
  quantity TEXT -- 数量
);`,
        },
        content: [
          ['row_id', '物品名', '数量'],
          ['1', '铁剑', '3'],
          ['2', '药水', '5'],
        ],
      },
    };
    mockApplyParameterizedSqlMutation.mockImplementation(async (sql: string, params: any[], tableData: any) => {
      const workingData = JSON.parse(JSON.stringify(tableData));
      const sheet = workingData.sheet_0;
      if (String(sql).startsWith('INSERT')) {
        sheet.content.push(['3', params[0] ?? '', params[1] ?? '']);
      } else if (String(sql).startsWith('DELETE')) {
        sheet.content = sheet.content.filter((row: any[]) => row[0] !== params[0]);
      } else if (String(sql).startsWith('UPDATE')) {
        const row = sheet.content.find((item: any[]) => item[0] === params[params.length - 1]);
        if (row) row[1] = params[0];
      }
      return {
        success: true,
        modifiedKeys: ['sheet_0'],
        appliedEdits: 1,
        changes: 1,
        workingData,
      };
    });
    mockPersistTablesToChatMessage.mockResolvedValue({ saved: true, messageIndex: 0 });
    mockExecuteRuntimeMutation.mockReturnValue({ changes: 1, errors: [] });
    mockGetRuntimeData.mockImplementation(() => {
      const workingData = JSON.parse(JSON.stringify(mockCurrentJsonTableData));
      const sheet = Object.entries(workingData)
        .find(([key, value]) => key.startsWith('sheet_') && value && typeof value === 'object')?.[1] as any;
      if (!sheet) return workingData;
      const lastCall = mockExecuteRuntimeMutation.mock.calls.at(-1) || [];
      const sql = String(lastCall[0] || '');
      const params = (lastCall[1] || []) as any[];
      if (sql.startsWith('INSERT')) {
        sheet.content.push([String(sheet.content.length), params[0] ?? '', params[1] ?? '']);
      } else if (sql.startsWith('DELETE')) {
        sheet.content = sheet.content.filter((row: any[]) => row[0] !== params[0]);
      } else if (sql.startsWith('UPDATE')) {
        const row = sheet.content.find((item: any[]) => item[0] === params[params.length - 1]);
        if (row) row[1] = params[0];
      }
      return workingData;
    });
    mockCreateRuntimeSnapshot.mockReturnValue(new Uint8Array([1, 2, 3]));
    mockRestoreRuntimeSnapshot.mockResolvedValue(undefined);
    mockEnsureStorageProviderReady.mockResolvedValue({
      executeMutation: mockExecuteRuntimeMutation,
      getCurrentData: mockGetRuntimeData,
      createRuntimeSnapshot: mockCreateRuntimeSnapshot,
      restoreRuntimeSnapshot: mockRestoreRuntimeSnapshot,
    });
    mockReloadStorageProvider.mockResolvedValue(undefined);
    mockRunTableWriteTransaction.mockImplementation(async (options: any, task: any) => task({
      transactionId: 'tx-crud-test',
      chatKey: 'chat-a',
      isolationKey: '',
      source: options.source,
      baseRevision: null,
      writeSet: options.writeSet,
      runCommit: async (commitTask: any) => commitTask(),
    }, options.initialData ? JSON.parse(JSON.stringify(options.initialData)) : mockCurrentJsonTableData));
    api = createTableCrudApi(mockCtx);
  });

  // ─── AI 填表期间外部写入互斥 ───
  describe('isAutoUpdatingCard 填表互斥', () => {
    afterEach(() => {
      mockIsAutoUpdatingCard = false;
    });

    it('填表进行中 updateCell 被拒绝：不执行 SQL、不落盘、返回 false', async () => {
      mockIsAutoUpdatingCard = true;
      const result = await api.updateCell('背包物品表', 1, '数量', '10');
      expect(result).toBe(false);
      expect(mockExecuteRuntimeMutation).not.toHaveBeenCalled();
      expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
    });

    it('填表结束后同一调用恢复可用', async () => {
      mockIsAutoUpdatingCard = true;
      expect(await api.updateCell('背包物品表', 1, '数量', '10')).toBe(false);
      mockIsAutoUpdatingCard = false;
      expect(await api.updateCell('背包物品表', 1, '数量', '10')).toBe(true);
      expect(mockExecuteRuntimeMutation).toHaveBeenCalledTimes(1);
    });
  });

  // ─── 表格锁对开放 API 生效（S2-2）───
  describe('表格锁对 CRUD API 生效', () => {
    // scopeKey = 'chat-a::'（currentChatFileIdentifier='chat-a'，isolationKey=''）
    function setLocks(bucket: any) {
      mockSettings.tableUpdateLocks = { 'chat-a::': { sheet_0: bucket } };
    }

    afterEach(() => {
      delete mockSettings.tableUpdateLocks;
    });

    it('行锁拒绝 updateCell / updateRow / deleteRow，不影响其他行', async () => {
      setLocks({ v: 2, rowIds: ['1'], colNames: [], cells: [] });
      expect(await api.updateCell('背包物品表', 1, '数量', '10')).toBe(false);
      expect(await api.updateRow('背包物品表', 1, { '数量': '10' })).toBe(false);
      expect(await api.deleteRow('背包物品表', 1)).toBe(false);
      expect(mockExecuteRuntimeMutation).not.toHaveBeenCalled();
      // 未锁定的第 2 行不受影响
      expect(await api.updateCell('背包物品表', 2, '数量', '9')).toBe(true);
      expect(mockExecuteRuntimeMutation).toHaveBeenCalledTimes(1);
    });

    it('列锁拒绝对该列的 updateCell 与含该列的 updateRow，其他列可写', async () => {
      setLocks({ v: 2, rowIds: [], colNames: ['数量'], cells: [] });
      expect(await api.updateCell('背包物品表', 1, '数量', '10')).toBe(false);
      expect(await api.updateRow('背包物品表', 1, { '物品名': '长剑', '数量': '10' })).toBe(false);
      expect(mockExecuteRuntimeMutation).not.toHaveBeenCalled();
      expect(await api.updateCell('背包物品表', 1, '物品名', '长剑')).toBe(true);
    });

    it('单元格锁只拒绝对应格；含锁定格的行不可删除', async () => {
      setLocks({ v: 2, rowIds: [], colNames: [], cells: [['1', '数量']] });
      expect(await api.updateCell('背包物品表', 1, '数量', '10')).toBe(false);
      expect(await api.deleteRow('背包物品表', 1)).toBe(false);
      expect(mockExecuteRuntimeMutation).not.toHaveBeenCalled();
      expect(await api.updateCell('背包物品表', 1, '物品名', '长剑')).toBe(true);
      expect(await api.updateCell('背包物品表', 2, '数量', '9')).toBe(true);
    });

    it('legacy 索引锁自动按内容迁移后同样生效', async () => {
      // rows:[0] 指向第一条数据行（row_id=1）
      setLocks({ rows: [0], cols: [], cells: [] });
      expect(await api.updateCell('背包物品表', 1, '数量', '10')).toBe(false);
      expect(mockExecuteRuntimeMutation).not.toHaveBeenCalled();
      // 迁移后升级为 v2 身份桶
      expect(mockSettings.tableUpdateLocks['chat-a::'].sheet_0.v).toBe(2);
      expect(mockSettings.tableUpdateLocks['chat-a::'].sheet_0.rowIds).toEqual(['1']);
    });

    it('锁不阻止 insertRow', async () => {
      setLocks({ v: 2, rowIds: ['1'], colNames: ['数量'], cells: [] });
      const newIndex = await api.insertRow('背包物品表', { '物品名': '盾牌', '数量': '1' });
      expect(newIndex).not.toBe(-1);
      expect(mockExecuteRuntimeMutation).toHaveBeenCalled();
    });
  });

  // ─── updateCell ───
  describe('updateCell', () => {
    it('生成正确的 UPDATE SQL（列名为字符串）', async () => {
      await api.updateCell('背包物品表', 1, '数量', '10');
      expect(mockExecuteRuntimeMutation).toHaveBeenCalledWith(
        'UPDATE `beibaowupinbiao` SET `quantity` = ? WHERE `row_id` = ?;',
        ['10', '1'],
      );
    });

    it('SQLite updateCell 在统一事务内执行', async () => {
      await api.updateCell('背包物品表', 1, '数量', '10');
      expect(mockRunTableWriteTransaction).toHaveBeenCalledWith(expect.objectContaining({
        source: 'manual_crud',
        reason: 'updateCell:sqlite',
        writeSet: [{ kind: 'cell', sheetKey: 'sheet_0', rowId: '1', columnKey: '数量' }],
      }), expect.any(Function));
    });

    it('生成正确的 UPDATE SQL（列名为数字索引）', async () => {
      await api.updateCell('背包物品表', 1, 1, '新铁剑');
      expect(mockExecuteRuntimeMutation).toHaveBeenCalledWith(
        'UPDATE `beibaowupinbiao` SET `item_name` = ? WHERE `row_id` = ?;',
        ['新铁剑', '1'],
      );
    });

    it('value 为 null 时生成 NULL', async () => {
      await api.updateCell('背包物品表', 1, '数量', null);
      expect(mockExecuteRuntimeMutation).toHaveBeenCalledWith(
        'UPDATE `beibaowupinbiao` SET `quantity` = ? WHERE `row_id` = ?;',
        [null, '1'],
      );
    });

    it('value 包含单引号时正确转义', async () => {
      await api.updateCell('背包物品表', 1, '物品名', "铁剑'加强版");
      expect(mockExecuteRuntimeMutation).toHaveBeenCalledWith(
        'UPDATE `beibaowupinbiao` SET `item_name` = ? WHERE `row_id` = ?;',
        ["铁剑'加强版", '1'],
      );
    });

    it('历史 DDL 表名只能定位 sheet，写入必须使用显示名派生的 runtime 表名', async () => {
      const result = await api.updateCell('inventory', 1, '数量', '10');

      expect(result).toBe(true);
      expect(mockExecuteRuntimeMutation).toHaveBeenCalledWith(
        'UPDATE `beibaowupinbiao` SET `quantity` = ? WHERE `row_id` = ?;',
        ['10', '1'],
      );
    });

    it('显式 DDL 中无注释的 ASCII 物理列仍可更新', async () => {
      useInvestigatorSheetWithUncommentedStats();

      const result = await api.updateCell('调查员角色卡表', 1, 'STR', '65');

      expect(result).toBe(true);
      expect(mockExecuteRuntimeMutation).toHaveBeenCalledWith(
        'UPDATE `diaochayuanjuesekabiao` SET `STR` = ? WHERE `row_id` = ?;',
        ['65', '1'],
      );
    });

    it('表不存在返回 false', async () => {
      const result = await api.updateCell('不存在的表', 1, '数量', '10');
      expect(result).toBe(false);
    });

    it('列不存在返回 false', async () => {
      const result = await api.updateCell('背包物品表', 1, '不存在的列', '10');
      expect(result).toBe(false);
    });

    it('行索引越界返回 false', async () => {
      const result = await api.updateCell('背包物品表', 0, '数量', '10');
      expect(result).toBe(false);
    });

    it('SQL 执行失败返回 false', async () => {
      mockExecuteRuntimeMutation.mockReturnValue({ errors: ['SQL 语法错误'], changes: 0 });
      const result = await api.updateCell('背包物品表', 1, '数量', '10');
      expect(result).toBe(false);
    });

    it('运行时未就绪时拒绝写入且不持久化', async () => {
      mockEnsureStorageProviderReady.mockRejectedValueOnce(new Error('[StorageStrategy] sqlite 存储运行时未就绪，已阻止 SQL 写入。'));

      const result = await api.updateCell('背包物品表', 1, '数量', '10');

      expect(result).toBe(false);
      expect(mockEnsureStorageProviderReady).toHaveBeenCalledOnce();
      expect(mockExecuteRuntimeMutation).not.toHaveBeenCalled();
      expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
    });

    it('currentJsonTableData 为 null 返回 false', async () => {
      mockCurrentJsonTableData = null;
      const result = await api.updateCell('背包物品表', 1, '数量', '10');
      expect(result).toBe(false);
    });

    it('已有历史数据时不把编辑器保存记为最新填表更新', async () => {
      vi.mocked(resolveTableHistoryStateFromChat_ACU).mockReturnValueOnce({
        latestAiMessageIndex: 1,
        latestDataMessageIndex: 0,
        lastTrackedUpdateMessageIndex: 0,
        latestDataAiFloor: 1,
        lastTrackedUpdateAiFloor: 1,
        hasAnyData: true,
        hasTrackedUpdate: true,
      });
      await api.updateCell('背包物品表', 1, '数量', '10');
      const { saveCurrentDataForTable_ACU } = await import('../../src/presentation/triggers/update-process');
      expect(vi.mocked(saveCurrentDataForTable_ACU)).not.toHaveBeenCalled();
      expect(mockPersistTablesToChatMessage).toHaveBeenCalledWith(expect.objectContaining({
        source: 'manual_crud',
        targetSheetKeys: ['sheet_0'],
        updateGroupKeys: null,
        trackingSheetKeys: [],
        trackAsUpdate: false,
      }));
    });
  });

  // ─── updateRow ───
  describe('updateRow', () => {
    it('生成正确的 UPDATE SQL（多列）', async () => {
      await api.updateRow('背包物品表', 1, { '物品名': '钢剑', '数量': '7' });
      expect(mockExecuteRuntimeMutation).toHaveBeenCalledWith(
        'UPDATE `beibaowupinbiao` SET `item_name` = ?, `quantity` = ? WHERE `row_id` = ?;',
        ['钢剑', '7', '1'],
      );
    });

    it('跳过 isImportMode 内部标记', async () => {
      await api.updateRow('背包物品表', 1, { '物品名': '钢剑', isImportMode: true });
      expect(String(mockExecuteRuntimeMutation.mock.calls[0]?.[0] || '')).not.toContain('isImportMode');
    });

    it('包含未解析列时原子拒绝，不能执行部分更新', async () => {
      const result = await api.updateRow('背包物品表', 1, { '不存在的列': '值', '物品名': '钢剑' });
      expect(result).toBe(false);
      expect(mockExecuteRuntimeMutation).not.toHaveBeenCalled();
      expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
    });

    it('显式 DDL 中无注释的 ASCII 物理列仍可批量更新', async () => {
      useInvestigatorSheetWithUncommentedStats();

      const result = await api.updateRow('调查员角色卡表', 1, { STR: '65' });

      expect(result).toBe(true);
      expect(mockExecuteRuntimeMutation).toHaveBeenCalledWith(
        'UPDATE `diaochayuanjuesekabiao` SET `STR` = ? WHERE `row_id` = ?;',
        ['65', '1'],
      );
    });

    it('无有效列时返回 false（无效操作）', async () => {
      const result = await api.updateRow('背包物品表', 1, { '不存在的列': '值' });
      expect(result).toBe(false);
      expect(mockExecuteRuntimeMutation).not.toHaveBeenCalled();
    });

    it('rowIndex < 1 返回 false', async () => {
      const result = await api.updateRow('背包物品表', 0, { '物品名': '钢剑' });
      expect(result).toBe(false);
    });

    it('运行时未就绪时拒绝写入且不持久化', async () => {
      mockEnsureStorageProviderReady.mockRejectedValueOnce(new Error('[StorageStrategy] sqlite 存储运行时未就绪，已阻止 SQL 写入。'));

      const result = await api.updateRow('背包物品表', 1, { '物品名': '钢剑' });

      expect(result).toBe(false);
      expect(mockEnsureStorageProviderReady).toHaveBeenCalledOnce();
      expect(mockExecuteRuntimeMutation).not.toHaveBeenCalled();
      expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
    });

    it('row_id 不存在返回 false', async () => {
      mockCurrentJsonTableData.sheet_0.content[1][0] = null;
      const result = await api.updateRow('背包物品表', 1, { '物品名': '钢剑' });
      expect(result).toBe(false);
    });
  });

  // ─── insertRow ───
  describe('insertRow', () => {
    it('生成正确的 INSERT SQL', async () => {
      await api.insertRow('背包物品表', { '物品名': '盾牌', '数量': '1' });
      expect(mockExecuteRuntimeMutation).toHaveBeenCalledWith(
        'INSERT INTO `beibaowupinbiao` (`item_name`, `quantity`) VALUES (?, ?);',
        ['盾牌', '1'],
      );
    });

    it('默认提交的通知契约：notifyMeta.persisted=true（S2-1）', async () => {
      const { refreshMergedDataAndNotifyWithUI_ACU } = await import('../../src/presentation/components/pipeline-ui-helpers');
      vi.mocked(refreshMergedDataAndNotifyWithUI_ACU).mockClear();

      await api.insertRow('背包物品表', { '物品名': '盾牌' });

      expect(refreshMergedDataAndNotifyWithUI_ACU).toHaveBeenCalledWith(expect.objectContaining({
        notifyMeta: { persisted: true },
      }));
    });

    it('skipChatSave 提交的通知契约：notifyMeta.persisted=false（S2-1）', async () => {
      const { refreshMergedDataAndNotifyWithUI_ACU } = await import('../../src/presentation/components/pipeline-ui-helpers');
      vi.mocked(refreshMergedDataAndNotifyWithUI_ACU).mockClear();

      await api.insertRow({ tableName: '背包物品表', data: { '物品名': '盾牌' }, skipChatSave: true });

      expect(refreshMergedDataAndNotifyWithUI_ACU).toHaveBeenCalledWith(expect.objectContaining({
        notifyMeta: { persisted: false },
      }));
    });

    it('跳过 row_id 列（自增）', async () => {
      await api.insertRow('背包物品表', { row_id: '99', '物品名': '盾牌' });
      expect(mockExecuteRuntimeMutation).toHaveBeenCalledWith(
        'INSERT INTO `beibaowupinbiao` (`item_name`) VALUES (?);',
        ['盾牌'],
      );
    });

    it('空 data 生成 DEFAULT VALUES', async () => {
      await api.insertRow('背包物品表', {});
      expect(mockExecuteRuntimeMutation).toHaveBeenCalledWith('INSERT INTO `beibaowupinbiao` DEFAULT VALUES;', []);
    });

    it('value 为 null 时将 null 作为参数传递', async () => {
      await api.insertRow('背包物品表', { '物品名': null, '数量': '1' });
      expect(mockExecuteRuntimeMutation).toHaveBeenCalledWith(
        'INSERT INTO `beibaowupinbiao` (`item_name`, `quantity`) VALUES (?, ?);',
        [null, '1'],
      );
    });

    it('value 包含单引号时传递原始值不作转义（由参数化查询处理）', async () => {
      await api.insertRow('背包物品表', { '物品名': "铁剑'加强版" });
      expect(mockExecuteRuntimeMutation).toHaveBeenCalledWith(
        'INSERT INTO `beibaowupinbiao` (`item_name`) VALUES (?);',
        ["铁剑'加强版"],
      );
    });

    it('显式 DDL 中无注释的 ASCII 物理列仍可插入', async () => {
      useInvestigatorSheetWithUncommentedStats();

      const result = await api.insertRow('调查员角色卡表', { STR: '65' });

      expect(result).toBe(2);
      expect(mockExecuteRuntimeMutation).toHaveBeenCalledWith(
        'INSERT INTO `diaochayuanjuesekabiao` (`STR`) VALUES (?);',
        ['65'],
      );
    });

    it('等待模板导入中的 runtime 后，使用最新 canonical 模板插入对象参数数据', async () => {
      const readyProvider = {
        executeMutation: mockExecuteRuntimeMutation,
        getCurrentData: mockGetRuntimeData,
        createRuntimeSnapshot: mockCreateRuntimeSnapshot,
        restoreRuntimeSnapshot: mockRestoreRuntimeSnapshot,
      };
      mockEnsureStorageProviderReady.mockImplementation(async () => {
        // 模拟 importTemplateFromData 已提交新模板，但 SQLite reload flight 尚未完成。
        // CRUD 必须在 await 后重新读取 canonical 数据，而不是用调用开始时的旧库存表。
        mockCurrentJsonTableData = {
          sheet_hero: {
            uid: 'hero',
            name: '主角信息',
            sourceData: {
              ddl: `CREATE TABLE hero_legacy ( -- 主角信息
  row_id INTEGER PRIMARY KEY, -- 行号
  character_name TEXT -- 人物名称
);`,
            },
            content: [['row_id', '人物名称']],
          },
        };
        mockGetRuntimeData.mockImplementation(() => {
          const workingData = JSON.parse(JSON.stringify(mockCurrentJsonTableData));
          const sheet = workingData.sheet_hero;
          const lastCall = mockExecuteRuntimeMutation.mock.calls.at(-1) || [];
          const sql = String(lastCall[0] || '');
          const params = (lastCall[1] || []) as any[];
          if (sql.startsWith('INSERT')) {
            sheet.content.push(['1', params[0] ?? '']);
          }
          return workingData;
        });
        return readyProvider;
      });

      const result = await api.insertRow({
        tableName: '主角信息',
        data: { '人物名称': '助手' },
        skipNotify: true,
      });

      expect(result).toBe(1);
      expect(mockEnsureStorageProviderReady).toHaveBeenCalledTimes(2);
      expect(mockExecuteRuntimeMutation).toHaveBeenCalledWith(
        'INSERT INTO `zhujuexinxi` (`character_name`) VALUES (?);',
        ['助手'],
      );
      expect(mockPersistTablesToChatMessage).toHaveBeenCalledWith(expect.objectContaining({
        source: 'manual_crud',
        targetSheetKeys: ['sheet_hero'],
      }));
    });

    it('表不存在返回 -1', async () => {
      const result = await api.insertRow('不存在的表', { '物品名': '盾牌' });
      expect(result).toBe(-1);
    });

    it('SQL 执行失败返回 -1', async () => {
      mockExecuteRuntimeMutation.mockReturnValue({ errors: ['SQL 错误'], changes: 0 });
      const result = await api.insertRow('背包物品表', { '物品名': '盾牌' });
      expect(result).toBe(-1);
    });

    it('包含未解析列时拒绝 INSERT，不能静默丢弃字段', async () => {
      const result = await api.insertRow('背包物品表', { '物品名': '盾牌', '不存在的列': '值' });

      expect(result).toBe(-1);
      expect(mockExecuteRuntimeMutation).not.toHaveBeenCalled();
      expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
    });

    it('DDL 中存在但 canonical 表头缺失的 ASCII 物理列仍拒绝写入', async () => {
      useInvestigatorSheetWithUncommentedStats();
      mockCurrentJsonTableData.sheet_diao_cha_yuan_jue_se_ka_biao.content[0] = ['row_id', 'DEX', '姓名'];

      const result = await api.insertRow('调查员角色卡表', { STR: '65' });

      expect(result).toBe(-1);
      expect(mockExecuteRuntimeMutation).not.toHaveBeenCalled();
      expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
    });

    it('真实运行时 DB 约束失败时不写持久层', async () => {
      mockExecuteRuntimeMutation.mockReturnValue({ errors: ['NOT NULL constraint failed: map_elements.element_name'], changes: 0 });

      const result = await api.insertRow('背包物品表', { '物品名': null, '数量': '1' });

      expect(result).toBe(-1);
      expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
      expect(mockReloadStorageProvider).not.toHaveBeenCalled();
    });

    it('运行时未就绪时拒绝写入且不持久化', async () => {
      mockEnsureStorageProviderReady.mockRejectedValueOnce(new Error('[StorageStrategy] sqlite 存储运行时未就绪，已阻止 SQL 写入。'));

      const result = await api.insertRow('背包物品表', { '物品名': '盾牌' });

      expect(result).toBe(-1);
      expect(mockEnsureStorageProviderReady).toHaveBeenCalledOnce();
      expect(mockExecuteRuntimeMutation).not.toHaveBeenCalled();
      expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
    });

    it('非 SQLite insertRow 使用最大 row_id 加一，并使 operation 身份与 cells 一致', async () => {
      mockIsSqliteMode = false;
      mockCurrentJsonTableData.sheet_0.content = [
        ['row_id', '物品名', '数量'],
        ['1', '铁剑', '3'],
        ['3', '盾牌', '1'],
      ];

      const result = await api.insertRow('背包物品表', { '物品名': '药水', '数量': '0' });

      expect(result).toBe(3);
      expect(mockCurrentJsonTableData.sheet_0.content[3]).toEqual(['4', '药水', '0']);
      expect(mockPersistTablesToChatMessage).toHaveBeenCalledWith(expect.objectContaining({
        source: 'manual_crud',
        tableData: expect.objectContaining({
          sheet_0: expect.objectContaining({ content: expect.arrayContaining([['4', '药水', '0']]) }),
        }),
      }));
    });

    it('持久化失败时在同一公共提交模型内 reload 运行时', async () => {
      mockPersistTablesToChatMessage.mockResolvedValue({ saved: false, error: 'save failed' });

      const result = await api.insertRow('背包物品表', { '物品名': '盾牌', '数量': '1' });

      expect(result).toBe(-1);
      expect(mockExecuteRuntimeMutation).toHaveBeenCalled();
      expect(mockPersistTablesToChatMessage).toHaveBeenCalledWith(expect.objectContaining({
        source: 'manual_crud',
        tableData: expect.any(Object),
        assumeCommitLock: true,
      }));
      expect(mockReloadStorageProvider).toHaveBeenCalled();
    });
  });

  // ─── deleteRow ───
  describe('deleteRow', () => {
    it('生成正确的 DELETE SQL', async () => {
      await api.deleteRow('背包物品表', 1);
      expect(mockExecuteRuntimeMutation).toHaveBeenCalledWith(
        'DELETE FROM `beibaowupinbiao` WHERE `row_id` = ?;',
        ['1'],
      );
    });

    it('rowIndex < 1 返回 false', async () => {
      const result = await api.deleteRow('背包物品表', 0);
      expect(result).toBe(false);
    });

    it('rowIndex 越界返回 false', async () => {
      const result = await api.deleteRow('背包物品表', 99);
      expect(result).toBe(false);
    });

    it('row_id 为 null 返回 false', async () => {
      mockCurrentJsonTableData.sheet_0.content[1][0] = null;
      const result = await api.deleteRow('背包物品表', 1);
      expect(result).toBe(false);
    });

    it('SQL 执行失败返回 false', async () => {
      mockExecuteRuntimeMutation.mockReturnValue({ errors: ['SQL 错误'], changes: 0 });
      const result = await api.deleteRow('背包物品表', 1);
      expect(result).toBe(false);
    });

    it('运行时未就绪时拒绝写入且不持久化', async () => {
      mockEnsureStorageProviderReady.mockRejectedValueOnce(new Error('[StorageStrategy] sqlite 存储运行时未就绪，已阻止 SQL 写入。'));

      const result = await api.deleteRow('背包物品表', 1);

      expect(result).toBe(false);
      expect(mockEnsureStorageProviderReady).toHaveBeenCalledOnce();
      expect(mockExecuteRuntimeMutation).not.toHaveBeenCalled();
      expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
    });

    it('表不存在返回 false', async () => {
      const result = await api.deleteRow('不存在的表', 1);
      expect(result).toBe(false);
    });
  });
});
