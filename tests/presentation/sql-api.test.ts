/**
 * tests/presentation/sql-api.test.ts
 * 原生 SQL 对外 API 单元测试
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockCurrentJsonTableData: any = { mate: { type: 'acu', version: 1 }, sheet_0: { name: 'T', content: [['row_id'], ['1']] } };

const mocks = vi.hoisted(() => ({
  refreshMergedDataAndNotifyWithUI: vi.fn().mockResolvedValue(undefined),
  executeQuery: vi.fn(() => ({ columns: ['id'], values: [[1]], rowCount: 1 })),
  executeMutation: vi.fn(() => ({ changes: 1, errors: [] })),
  applyEditsBatch: vi.fn(() => ({ success: true, modifiedKeys: ['sheet_0'], appliedEdits: 2 })),
  applyEdits: vi.fn(() => ({ success: true, modifiedKeys: ['sheet_0'], appliedEdits: 2 })),
  saveToChat: vi.fn().mockResolvedValue({ saved: true, messageIndex: 3 }),
  persistTablesToChatMessage: vi.fn().mockResolvedValue({ saved: true, messageIndex: 3 }),
  getCurrentData: vi.fn(() => ({ mate: { type: 'acu', version: 1 }, sheet_0: { name: 'T', content: [['row_id'], ['1']] } })),
  getNameMapper: vi.fn(),
  translateSql: vi.fn((sql: string) => sql.replaceAll('背包物品表', 'inventory').replaceAll('物品名称', 'item_name').replaceAll('内容', 'content')),
  resolveColumnName: vi.fn((_tableName: string, columnName: string) => columnName),
  getChineseColumnName: vi.fn((_tableName: string, columnName: string) => columnName),
  getChineseTableName: vi.fn((tableName: string) => tableName),
  getStorageProvider: vi.fn(),
  isSqliteMode: vi.fn(() => true),
  isStorageRuntimeReadyForSyncRead: vi.fn(() => true),
  getStorageRuntimeHealth: vi.fn(() => ({
    status: 'ready',
    expectedMode: 'sqlite',
    activeMode: 'sqlite',
    loadToken: 1,
  })),
  runTableUpdateApplyWithScopeLock: vi.fn(async (_scopeKey: string, task: () => Promise<unknown>) => task()),
  reloadStorageProvider: vi.fn().mockResolvedValue(undefined),
  ensureStorageProviderReady: vi.fn().mockResolvedValue({
    executeQuery: vi.fn(() => ({ columns: ['id'], values: [[1]], rowCount: 1 })),
    executeMutation: vi.fn(() => ({ changes: 1, errors: [] })),
    applyEditsBatch: vi.fn(() => ({ success: true, modifiedKeys: ['sheet_0'], appliedEdits: 2 })),
    applyEdits: vi.fn(() => ({ success: true, modifiedKeys: ['sheet_0'], appliedEdits: 2 })),
    saveToChat: vi.fn().mockResolvedValue({ saved: true, messageIndex: 3 }),
    getCurrentData: vi.fn(() => ({ mate: { type: 'acu', version: 1 }, sheet_0: { name: 'T', content: [['row_id'], ['1']] } })),
  }),
  getChatArray: vi.fn(() => []),
  getLatestHeadRevision: vi.fn(() => 'rev-head'),
  captureTableRuntimeRevision: vi.fn(() => 'runtime-rev-head'),
  runTableWriteTransaction: vi.fn(async (_options: any, task: (ctx: any) => Promise<unknown>) => task({
    transactionId: 'tx-test',
    chatKey: 'chat-a',
    isolationKey: 'iso-a',
    source: _options.source,
    baseRevision: null,
    writeSet: _options.writeSet,
    runCommit: async (commitTask: any) => commitTask(),
  })),
}));

vi.mock('../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
}));

vi.mock('../../src/presentation/components/pipeline-ui-helpers', () => ({
  refreshMergedDataAndNotifyWithUI_ACU: mocks.refreshMergedDataAndNotifyWithUI,
}));

vi.mock('../../src/service/table/table-storage-strategy', () => ({
  getStorageProvider: mocks.getStorageProvider,
  reloadStorageProvider: mocks.reloadStorageProvider,
  ensureStorageProviderReady_ACU: mocks.ensureStorageProviderReady,
  isStorageRuntimeReadyForSyncRead_ACU: mocks.isStorageRuntimeReadyForSyncRead,
  getStorageRuntimeHealth_ACU: mocks.getStorageRuntimeHealth,
}));

vi.mock('../../src/service/table/storage-mode', () => ({
  isSqliteMode: mocks.isSqliteMode,
}));

function createBareProvider_ACU() {
  return {
    executeQuery: mocks.executeQuery,
    executeMutation: mocks.executeMutation,
    applyEdits: mocks.applyEdits,
    applyEditsBatch: mocks.applyEditsBatch,
    saveToChat: mocks.saveToChat,
    getCurrentData: mocks.getCurrentData,
  };
}

vi.mock('../../src/service/chat/chat-service', () => ({
  getChatArray_ACU: mocks.getChatArray,
}));

vi.mock('../../src/service/table/storage-frame-v2-persist', () => ({
  getLatestTableStorageHeadRevisionV2_ACU: mocks.getLatestHeadRevision,
}));

vi.mock('../../src/service/table/table-service', () => ({
  ensureLegacyStorageMigratedBeforeWrite_ACU: vi.fn().mockResolvedValue({ success: true, migrated: false }),
  persistTablesToChatMessage_ACU: mocks.persistTablesToChatMessage,
}));

vi.mock('../../src/service/runtime/state-manager', () => ({
  currentChatFileIdentifier_ACU: 'chat-a',
  get currentJsonTableData_ACU() { return mockCurrentJsonTableData; },
  isAutoUpdatingCard_ACU: false,
  getCurrentIsolationKey_ACU: vi.fn(() => 'iso-a'),
  _set_currentJsonTableData_ACU: vi.fn(),
}));

vi.mock('../../src/service/runtime/template-vars/name-mapper', () => ({
  getNameMapper: mocks.getNameMapper,
}));

vi.mock('../../src/service/runtime/read-query-resolver', async () => {
  const { resolveReadQuerySql_ACU } = await import('../../src/shared/sql-read-resolver');
  return {
    resolveCurrentRuntimeReadSql_ACU: (sql: string) => {
      const mapper = mocks.getNameMapper();
      return resolveReadQuerySql_ACU(sql, mockCurrentJsonTableData, mapper.translateSql.bind(mapper));
    },
  };
});

vi.mock('../../src/service/table/table-update-queue', () => ({
  buildTableUpdateApplyScopeKey_ACU: vi.fn((parts: any) => `${parts.chatKey}::${parts.isolationKey}::${parts.targetMessageIndex}`),
  runTableUpdateApplyWithScopeLock_ACU: mocks.runTableUpdateApplyWithScopeLock,
}));

vi.mock('../../src/service/table/table-write-transaction', () => ({
  captureTableRuntimeRevisionForWriteSet_ACU: mocks.captureTableRuntimeRevision,
  runTableWriteTransaction_ACU: mocks.runTableWriteTransaction,
}));

import { createSqlApi, installRuntimeGatedSqlReadApi_ACU, isSqlReadStatement_ACU } from '../../src/presentation/bootstrap/api-groups/sql-api';

describe('isSqlReadStatement_ACU', () => {
  it('识别查询类 SQL', () => {
    expect(isSqlReadStatement_ACU('SELECT * FROM t')).toBe(true);
    expect(isSqlReadStatement_ACU(' pragma table_info(t)')).toBe(true);
    expect(isSqlReadStatement_ACU('EXPLAIN QUERY PLAN SELECT 1')).toBe(true);
    expect(isSqlReadStatement_ACU('WITH cte AS (SELECT 1) SELECT * FROM cte')).toBe(true);
  });

  it('识别写入类 SQL', () => {
    expect(isSqlReadStatement_ACU('INSERT INTO t VALUES (1)')).toBe(false);
    expect(isSqlReadStatement_ACU('UPDATE t SET x = 1')).toBe(false);
    expect(isSqlReadStatement_ACU('DELETE FROM t')).toBe(false);
  });

  it('拒绝多语句和 WITH 包裹写入，避免查询 API 绕过写事务', () => {
    expect(isSqlReadStatement_ACU('SELECT 1; UPDATE t SET x = 1')).toBe(false);
    expect(isSqlReadStatement_ACU('WITH cte AS (SELECT 1) DELETE FROM t')).toBe(false);
    expect(isSqlReadStatement_ACU("WITH cte AS (SELECT 'UPDATE text') SELECT * FROM cte")).toBe(true);
  });
});

describe('createSqlApi', () => {
  let api: Record<string, Function>;
  const ctx: any = { getApi: () => ({ _notifyTableUpdate: vi.fn() }) };

  beforeEach(() => {
    mockCurrentJsonTableData = { mate: { type: 'acu', version: 1 }, sheet_0: { name: 'T', content: [['row_id'], ['1']] } };
    vi.clearAllMocks();
    mocks.isSqliteMode.mockReturnValue(true);
    mocks.isStorageRuntimeReadyForSyncRead.mockReturnValue(true);
    mocks.getStorageProvider.mockImplementation(createBareProvider_ACU);
    mocks.getNameMapper.mockReturnValue({
      translateSql: mocks.translateSql,
      resolveColumnName: mocks.resolveColumnName,
      getChineseColumnName: mocks.getChineseColumnName,
      getChineseTableName: mocks.getChineseTableName,
    });
    mocks.executeQuery.mockReturnValue({ columns: ['id'], values: [[1]], rowCount: 1 });
    mocks.executeMutation.mockReturnValue({ changes: 1, errors: [] });
    mocks.applyEditsBatch.mockReturnValue({ success: true, modifiedKeys: ['sheet_0'], appliedEdits: 2 });
    mocks.applyEdits.mockReturnValue({ success: true, modifiedKeys: ['sheet_0'], appliedEdits: 2 });
    mocks.saveToChat.mockResolvedValue({ saved: true, messageIndex: 3 });
    mocks.persistTablesToChatMessage.mockResolvedValue({ saved: true, messageIndex: 3 });
    mocks.getCurrentData.mockReturnValue({ mate: { type: 'acu', version: 1 }, sheet_0: { name: 'T', content: [['row_id'], ['1']] } });
    mocks.ensureStorageProviderReady.mockResolvedValue({
      executeQuery: mocks.executeQuery,
      executeMutation: mocks.executeMutation,
      applyEdits: mocks.applyEdits,
      applyEditsBatch: mocks.applyEditsBatch,
      saveToChat: mocks.saveToChat,
      getCurrentData: mocks.getCurrentData,
    });
    mocks.reloadStorageProvider.mockResolvedValue(undefined);
    mocks.getChatArray.mockReturnValue([]);
    mocks.getLatestHeadRevision.mockReturnValue('rev-head');
    mocks.captureTableRuntimeRevision.mockReturnValue('runtime-rev-head');
    mocks.runTableUpdateApplyWithScopeLock.mockImplementation(async (_scopeKey: string, task: () => Promise<unknown>) => task());
    mocks.runTableWriteTransaction.mockImplementation(async (_options: any, task: (ctx: any) => Promise<unknown>) => task({
      transactionId: 'tx-test',
      chatKey: 'chat-a',
      isolationKey: 'iso-a',
      source: _options.source,
      baseRevision: null,
      writeSet: _options.writeSet,
      runCommit: async (commitTask: any) => commitTask(),
    }));
    api = createSqlApi(ctx);
  });

  it('全局只读 SQL 方法仅在 SQLite runtime ready 后可见', () => {
    const publishedApi: Record<string, any> = { ...api };
    installRuntimeGatedSqlReadApi_ACU(publishedApi, api);

    mocks.isSqliteMode.mockReturnValue(false);
    expect(publishedApi.querySql).toBeUndefined();
    expect(publishedApi.executeSqlQuery).toBeUndefined();
    expect(publishedApi.queryTableRows).toBeUndefined();

    mocks.isSqliteMode.mockReturnValue(true);
    mocks.isStorageRuntimeReadyForSyncRead.mockReturnValue(false);
    expect(publishedApi.querySql).toBeUndefined();

    mocks.isStorageRuntimeReadyForSyncRead.mockReturnValue(true);
    expect(publishedApi.querySql).toBe(api.querySql);
    expect(publishedApi.executeSqlQuery).toBe(api.executeSqlQuery);
    expect(publishedApi.queryTableRows).toBe(api.queryTableRows);
  });

  it('聊天切换或重载导致 runtime 失去 ready 时会重新隐藏只读 SQL 方法', () => {
    const publishedApi: Record<string, any> = { ...api };
    installRuntimeGatedSqlReadApi_ACU(publishedApi, api);

    expect(typeof publishedApi.querySql).toBe('function');
    mocks.isStorageRuntimeReadyForSyncRead.mockReturnValue(false);
    expect(publishedApi.querySql).toBeUndefined();
    mocks.isStorageRuntimeReadyForSyncRead.mockReturnValue(true);
    expect(typeof publishedApi.querySql).toBe('function');
  });

  it('executeSqlQuery 调用 provider.executeQuery 并返回对象行', () => {
    const result = api.executeSqlQuery('SELECT * FROM inventory WHERE row_id = ?', [1]);

    expect(mocks.executeQuery).toHaveBeenCalledWith('SELECT * FROM inventory WHERE row_id = ?', [1]);
    expect(result).toEqual({ columns: ['id'], values: [[1]], rowCount: 1, rows: [{ id: 1 }], sql: 'SELECT * FROM inventory WHERE row_id = ?', offset: 0 });
  });

  it('executeSqlQuery 支持对象参数和 limit/offset 包装', () => {
    api.executeSqlQuery({ sql: 'SELECT * FROM t WHERE name = ?', params: ['铁剑'], limit: 10, offset: 5 });

    expect(mocks.executeQuery).toHaveBeenCalledWith('SELECT * FROM (SELECT * FROM t WHERE name = ?) AS acu_query LIMIT ? OFFSET ?', ['铁剑', 10, 5]);
  });

  it('queryTableRows 支持声明式分页查询', () => {
    api.queryTableRows({ tableName: 'T', columns: ['row_id'], where: { row_id: '1' }, limit: 20, offset: 10 });

    expect(mocks.executeQuery).toHaveBeenCalledWith('SELECT `row_id` FROM `t` WHERE `row_id` = ? LIMIT ? OFFSET ?', ['1', 20, 10]);
  });

  it('queryTableRows 将唯一历史 DDL 名定位到显示名派生的 runtime 表', () => {
    mockCurrentJsonTableData = {
      mate: { type: 'acu', version: 1 },
      sheet_0: {
        name: '纪要表',
        sourceData: { ddl: 'CREATE TABLE chronicle (row_id INTEGER PRIMARY KEY, content TEXT);' },
        content: [['row_id', 'content'], ['1', '记录']],
      },
    };

    api.queryTableRows({ tableName: 'chronicle', columns: ['row_id'], limit: 20, offset: 0 });

    expect(mocks.executeQuery).toHaveBeenCalledWith('SELECT `row_id` FROM `jiyaobiao` LIMIT ? OFFSET ?', [20, 0]);
  });

  it('queryTableRows 通过 uid 定位表，并接受显示列名与物理列名混用', () => {
    mockCurrentJsonTableData = {
      mate: { type: 'acu', version: 1 },
      sheet_misc: {
        uid: 'misc_uid',
        name: '杂表',
        sourceData: {
          ddl: 'CREATE TABLE legacy_misc (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  old_title TEXT, -- 名称\n  old_description TEXT -- 描述\n);',
        },
        content: [['row_id', '名称', '描述'], ['1', '已探索地点概览', '这里是描述']],
      },
    };

    api.queryTableRows({
      tableName: 'misc_uid',
      columns: ['old_description'],
      where: { 名称: '已探索地点概览' },
      orderBy: { column: '描述', direction: 'DESC' },
      limit: 20,
      offset: 0,
    });

    expect(mocks.executeQuery).toHaveBeenCalledWith(
      'SELECT `old_description` FROM `zabiao` WHERE `old_title` = ? ORDER BY `old_description` DESC LIMIT ? OFFSET ?',
      ['已探索地点概览', 20, 0],
    );
  });

  it('queryTableRows 遇到重复表别名时 fail-closed 并记录 alias_conflict', () => {
    mockCurrentJsonTableData = {
      mate: { type: 'acu', version: 1 },
      sheet_a: {
        uid: 'a_uid', name: '甲表',
        sourceData: { ddl: 'CREATE TABLE shared_legacy (row_id INTEGER PRIMARY KEY);' },
        content: [['row_id'], ['1']],
      },
      sheet_b: {
        uid: 'b_uid', name: '乙表',
        sourceData: { ddl: 'CREATE TABLE shared_legacy (row_id INTEGER PRIMARY KEY);' },
        content: [['row_id'], ['1']],
      },
    };

    expect(api.queryTableRows({ tableName: 'shared_legacy', columns: ['row_id'] })).toBeNull();
    expect(mocks.executeQuery).not.toHaveBeenCalled();
    expect(api.getLastSqlApiError()).toMatchObject({ method: 'queryTableRows', code: 'alias_conflict' });
  });

  it('executeSqlQuery 将原始 DDL 表名和显示列名重绑定到拼音物理标识符', () => {
    mockCurrentJsonTableData = {
      mate: { type: 'acu', version: 1 },
      sheet_0: {
        name: '纪要表',
        sourceData: { ddl: 'CREATE TABLE chronicle (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  content TEXT -- 内容\n);' },
        content: [['row_id', '内容'], ['1', '记录']],
      },
    };

    const result = api.executeSqlQuery('SELECT 内容 FROM chronicle WHERE 内容 = ?', ['记录']);

    expect(result).not.toBeNull();
    expect(mocks.executeQuery).toHaveBeenCalledWith('SELECT content FROM jiyaobiao WHERE content = ?', ['记录']);
  });

  it.each(['executeSqlQuery', 'querySql'] as const)('%s 保留派生输出显示列，而不将其改写为实体列', method => {
    mockCurrentJsonTableData = {
      mate: { type: 'acu', version: 1 },
      sheet_0: {
        uid: 'sheet_0',
        name: 'People',
        sourceData: { ddl: 'CREATE TABLE people (row_id INTEGER PRIMARY KEY, name TEXT -- 姓名);' },
        content: [['row_id', '姓名'], ['1', 'Ada']],
      },
    };
    mocks.translateSql.mockImplementationOnce((sql: string) => sql.replaceAll('姓名', 'name'));
    const sql = 'SELECT 姓名 FROM (SELECT name AS 姓名 FROM people) AS people_view ORDER BY 姓名';

    const result = api[method](sql);

    expect(result).not.toBeNull();
    expect(mocks.executeQuery).toHaveBeenCalledWith(sql, undefined);
  });

  it('executeSql 的读取分支保留派生输出显示列', async () => {
    mocks.translateSql.mockImplementationOnce((sql: string) => sql.replaceAll('姓名', 'name'));
    const sql = 'SELECT 姓名 FROM (SELECT name AS 姓名 FROM people) AS people_view ORDER BY 姓名';

    await api.executeSql(sql);

    expect(mocks.executeQuery).toHaveBeenCalledWith(sql, undefined);
  });

  it('querySql 拒绝写语句', () => {
    const result = api.querySql('UPDATE t SET name = 1');

    expect(result).toBeNull();
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it('querySql 拒绝 SELECT 后拼接写语句', () => {
    const result = api.querySql('SELECT 1; DELETE FROM t');

    expect(result).toBeNull();
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it('只读 SQL 在 runtime ready 时执行查询', () => {
    const result = api.executeSqlQuery('SELECT * FROM inventory');

    expect(result).toEqual({ columns: ['id'], values: [[1]], rowCount: 1, rows: [{ id: 1 }], sql: 'SELECT * FROM inventory', offset: 0 });
    expect(mocks.getStorageProvider).toHaveBeenCalledOnce();
    expect(mocks.isStorageRuntimeReadyForSyncRead).toHaveBeenCalledOnce();
    expect(mocks.executeQuery).toHaveBeenCalledWith('SELECT * FROM inventory', undefined);
  });

  it('只读 SQL 会翻译中文表列名后执行', () => {
    const sql = "SELECT 物品名称 FROM 背包物品表 WHERE 物品名称 = '铁剑'";

    const result = api.executeSqlQuery(sql);

    expect(result).toEqual(expect.objectContaining({ sql: "SELECT item_name FROM inventory WHERE item_name = '铁剑'" }));
    expect(mocks.getNameMapper).toHaveBeenCalled();
    expect(mocks.translateSql).toHaveBeenCalledOnce();
    expect(mocks.translateSql.mock.calls[0][0]).toContain('__ACU_SQL_PROTECTED_0__');
    expect(mocks.executeQuery).toHaveBeenCalledWith("SELECT item_name FROM inventory WHERE item_name = '铁剑'", undefined);
  });

  it('runtime 未就绪时拒绝只读 SQL，且不触发 provider 懒查询', () => {
    mocks.isStorageRuntimeReadyForSyncRead.mockReturnValueOnce(false);
    mocks.getStorageRuntimeHealth.mockReturnValueOnce({ status: 'degraded', expectedMode: 'sqlite', activeMode: 'native', loadToken: 2, failureCode: 'provider_fallback' });

    expect(api.executeSqlQuery('SELECT * FROM inventory')).toBeNull();
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it('保留只读失败契约，并公开结构化最后错误', () => {
    mocks.executeQuery.mockImplementationOnce(() => { throw new Error('no such table: missing_table'); });

    expect(api.querySql('SELECT * FROM missing_table')).toBeNull();
    expect(api.getLastSqlApiError()).toEqual(expect.objectContaining({
      method: 'querySql',
      code: 'table_not_found',
      message: 'no such table: missing_table',
    }));
  });

  it('无关 schema 别名冲突不掩盖缺失表错误', () => {
    mockCurrentJsonTableData = {
      mate: { type: 'acu', version: 1 },
      sheet_0: {
        uid: 'sheet_0',
        name: 'Alpha',
        sourceData: { ddl: 'CREATE TABLE legacy (row_id INTEGER PRIMARY KEY);' },
        content: [['row_id'], ['1']],
      },
      sheet_1: {
        uid: 'sheet_1',
        name: 'Legacy',
        sourceData: { ddl: 'CREATE TABLE other (row_id INTEGER PRIMARY KEY);' },
        content: [['row_id'], ['1']],
      },
    };
    mocks.executeQuery.mockImplementationOnce(() => { throw new Error('no such table: missing_table'); });

    expect(api.querySql('SELECT * FROM missing_table')).toBeNull();
    expect(api.getLastSqlApiError()).toEqual(expect.objectContaining({
      method: 'querySql',
      code: 'table_not_found',
      message: 'no such table: missing_table',
    }));
  });

  it('executeSqlMutation 将唯一 DDL alias 重绑定为 runtime SQL，并记录 sql_sheet_batch', async () => {
    mockCurrentJsonTableData = {
      mate: { type: 'acu', version: 1 },
      sheet_0: {
        name: 'T',
        sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT);' },
        content: [['row_id', 'name'], ['1', '旧值']],
      },
    };
    mocks.getCurrentData.mockReturnValue(mockCurrentJsonTableData);

    const result = await api.executeSqlMutation('INSERT INTO inventory(name) VALUES (?)', ['铁剑']);

    expect(mocks.executeMutation).toHaveBeenCalledWith('INSERT INTO t(name) VALUES (?)', ['铁剑']);
    expect(mocks.persistTablesToChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      source: 'raw_sql_mutation',
      targetSheetKeys: ['sheet_0'],
      trackingSheetKeys: [],
      operations: [{
        kind: 'sql_sheet_batch', sheetKey: 'sheet_0', tableName: 't',
        statements: ['INSERT INTO t(name) VALUES (?)'], params: [['铁剑']], reason: 'manual_crud',
      }],
    }));
    expect(mocks.refreshMergedDataAndNotifyWithUI).toHaveBeenCalledWith({ skipNotify: false });
    expect(result).toEqual({ changes: 1, errors: [], saved: true, messageIndex: 3 });
  });

  it('executeSqlMutation 在同 scope 锁内执行 SQL 和分层写回', async () => {
    await api.executeSqlMutation('UPDATE inventory SET name = ?', ['钢剑']);

    expect(mocks.runTableWriteTransaction).toHaveBeenCalledWith(expect.objectContaining({
      source: 'raw_sql_mutation',
      writeSet: [{ kind: 'all' }],
    }), expect.any(Function));
    expect(mocks.persistTablesToChatMessage).toHaveBeenCalledWith(expect.objectContaining({ source: 'raw_sql_mutation', targetSheetKeys: null, trackingSheetKeys: [] }));
  });

  it('executeSqlMutation 未声明 targetSheetKeys 时按 SQL 表名推断 sheet 级 writeSet', async () => {
    await api.executeSqlMutation('UPDATE T SET name = ?', ['钢剑']);

    expect(mocks.runTableWriteTransaction).toHaveBeenCalledWith(expect.objectContaining({
      source: 'raw_sql_mutation',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_0' }],
    }), expect.any(Function));
    expect(mocks.persistTablesToChatMessage).toHaveBeenCalledWith(expect.objectContaining({ source: 'raw_sql_mutation', targetSheetKeys: ['sheet_0'], trackingSheetKeys: [] }));
  });

  it('executeSqlMutation 写入失败时不保存不通知', async () => {
    mocks.executeMutation.mockReturnValue({ changes: 0, errors: ['SQL error'] });

    const result = await api.executeSqlMutation('BAD SQL');

    expect(result).toEqual({ changes: 0, errors: ['SQL error'] });
    expect(mocks.persistTablesToChatMessage).not.toHaveBeenCalled();
    expect(mocks.refreshMergedDataAndNotifyWithUI).not.toHaveBeenCalled();
  });

  it('executeSqlMutation 运行时未就绪时拒绝写入', async () => {
    mocks.ensureStorageProviderReady.mockRejectedValueOnce(new Error('[StorageStrategy] sqlite 存储运行时未就绪，已阻止 SQL 写入。'));

    const result = await api.executeSqlMutation('UPDATE inventory SET name = ?', ['钢剑']);

    expect(result).toEqual({ changes: 0, errors: ['[StorageStrategy] sqlite 存储运行时未就绪，已阻止 SQL 写入。'] });
    expect(mocks.executeMutation).not.toHaveBeenCalled();
    expect(mocks.persistTablesToChatMessage).not.toHaveBeenCalled();
  });

  it('executeSqlMutation 支持跳过保存和通知', async () => {
    const result = await api.executeSqlMutation({
      sql: 'UPDATE inventory SET name = ?',
      params: ['钢剑'],
      skipChatSave: true,
      skipNotify: true,
    });

    expect(result).toEqual({ changes: 1, errors: [] });
    expect(mocks.persistTablesToChatMessage).not.toHaveBeenCalled();
    expect(mocks.refreshMergedDataAndNotifyWithUI).not.toHaveBeenCalled();
  });

  it('executeSqlMutation 支持指定分层写回范围和附加追踪范围', async () => {
    await api.executeSqlMutation({
      sql: 'UPDATE inventory SET name = ?',
      params: ['钢剑'],
      targetSheetKeys: ['sheet_0'],
      updateGroupKeys: ['sheet_0'],
      trackingSheetKeys: [],
    });

    expect(mocks.persistTablesToChatMessage).toHaveBeenCalledWith(expect.objectContaining({ source: 'raw_sql_mutation', targetSheetKeys: ['sheet_0'], updateGroupKeys: ['sheet_0'], trackingSheetKeys: [] }));
  });

  it('executeSqlMutation 将 targetSheetKeys 转成 sheet 级 writeSet 并贯通 transactionContext', async () => {
    const txCtx = {
      transactionId: 'tx-sheet-0',
      chatKey: 'chat-a',
      isolationKey: 'iso-a',
      source: 'raw_sql_mutation',
      baseRevision: 'rev-base',
      writeSet: [{ kind: 'sheet' as const, sheetKey: 'sheet_0' }],
      runCommit: async (commitTask: any) => commitTask(),
    };
    mocks.runTableWriteTransaction.mockImplementationOnce(async (_options: any, task: (ctx: any) => Promise<unknown>) => task(txCtx));

    await api.executeSqlMutation({
      sql: 'UPDATE inventory SET name = ?',
      params: ['钢剑'],
      targetSheetKeys: ['sheet_0'],
    });

    expect(mocks.runTableWriteTransaction).toHaveBeenCalledWith(expect.objectContaining({
      source: 'raw_sql_mutation',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_0' }],
    }), expect.any(Function));
    const saveOptions = mocks.persistTablesToChatMessage.mock.calls[0][0];
    expect(saveOptions.transactionContext).toBe(txCtx);
    expect(saveOptions.assumeCommitLock).toBe(true);
  });

  it('executeSqlBatch 执行并持久化 runtime SQL 与 physical tableName', async () => {
    const sql = "INSERT INTO T VALUES (1, 'a'); UPDATE T SET name = 'b' WHERE row_id = 1;";

    const result = await api.executeSqlBatch(sql);

    expect(mocks.applyEditsBatch).toHaveBeenCalledWith(["INSERT INTO t VALUES (1, 'a')", "UPDATE t SET name = 'b' WHERE row_id = 1"], 'raw_sql_api');
    expect(mocks.applyEdits).not.toHaveBeenCalled();
    expect(mocks.runTableWriteTransaction).toHaveBeenCalledWith(expect.objectContaining({
      source: 'raw_sql_batch',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_0' }],
    }), expect.any(Function));
    expect(mocks.persistTablesToChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      source: 'raw_sql_batch',
      targetSheetKeys: ['sheet_0'],
      trackingSheetKeys: [],
      operations: [{
        kind: 'sql_sheet_batch', sheetKey: 'sheet_0', tableName: 't',
        statements: ["INSERT INTO t VALUES (1, 'a')", "UPDATE t SET name = 'b' WHERE row_id = 1"], reason: 'manual_crud',
      }],
    }));
    expect(mocks.refreshMergedDataAndNotifyWithUI).toHaveBeenCalledWith({ skipNotify: false });
    expect(result).toEqual({
      success: true,
      modifiedKeys: ['sheet_0'],
      appliedEdits: 2,
      changes: 2,
      errors: [],
      saved: true,
      messageIndex: 3,
    });
  });

  it('executeSqlBatch 支持覆盖 applyEdits 推断的写回范围', async () => {
    await api.executeSqlBatch({
      sql: "INSERT INTO T VALUES (1, 'a');",
      targetSheetKeys: ['sheet_0'],
      updateGroupKeys: ['sheet_0'],
      trackingSheetKeys: ['sheet_0'],
    });

    expect(mocks.persistTablesToChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      source: 'raw_sql_batch',
      targetSheetKeys: ['sheet_0'],
      updateGroupKeys: ['sheet_0'],
      trackingSheetKeys: ['sheet_0'],
    }));
  });

  it('executeSqlBatch 失败时返回错误且不保存', async () => {
    mocks.applyEditsBatch.mockImplementationOnce(() => { throw new Error('rollback'); });

    const result = await api.executeSqlBatch('INSERT INTO missing VALUES (1);');

    expect(result.success).toBe(false);
    expect(result.errors).toEqual(['rollback']);
    expect(mocks.persistTablesToChatMessage).not.toHaveBeenCalled();
  });

  it('executeSqlBatch 运行时未就绪时拒绝写入', async () => {
    mocks.ensureStorageProviderReady.mockRejectedValueOnce(new Error('[StorageStrategy] sqlite 存储运行时未就绪，已阻止 SQL 写入。'));

    const result = await api.executeSqlBatch('UPDATE inventory SET name = \'钢剑\';');

    expect(result).toEqual({ success: false, modifiedKeys: [], appliedEdits: 0, changes: 0, errors: ['[StorageStrategy] sqlite 存储运行时未就绪，已阻止 SQL 写入。'] });
    expect(mocks.applyEdits).not.toHaveBeenCalled();
    expect(mocks.persistTablesToChatMessage).not.toHaveBeenCalled();
  });

  it('executeSqlMutation 保存失败时由公共提交模型返回错误', async () => {
    mocks.persistTablesToChatMessage.mockResolvedValueOnce({ saved: false, error: 'conflict' });

    const result = await api.executeSqlMutation('UPDATE T SET name = ?', ['钢剑']);

    expect(result).toEqual({ changes: 0, errors: ['conflict'] });
    expect(mocks.persistTablesToChatMessage).toHaveBeenCalledWith(expect.objectContaining({ source: 'raw_sql_mutation', targetSheetKeys: ['sheet_0'], trackingSheetKeys: [] }));
  });

  it('executeSql 自动分派查询', async () => {
    const result = await api.executeSql('SELECT 1');

    expect(result).toEqual({ type: 'query', result: { columns: ['id'], values: [[1]], rowCount: 1, rows: [{ id: 1 }], sql: 'SELECT 1' } });
    expect(mocks.executeMutation).not.toHaveBeenCalled();
  });

  it('executeSql 自动分派写入', async () => {
    const result = await api.executeSql('UPDATE inventory SET name = ?', ['钢剑']);

    expect(result.type).toBe('mutation');
    expect(mocks.executeMutation).toHaveBeenCalledWith('UPDATE inventory SET name = ?', ['钢剑']);
  });
});
