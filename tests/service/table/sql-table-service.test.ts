/**
 * tests/service/table/sql-table-service.test.ts
 * SqlTableService 单元测试
 *
 * 策略：
 * - splitSqlStatements / extractTableNamesFromStatements 是纯函数，直接测试
 * - SqlTableService 类方法需要 mock 外部依赖（state-manager/table-service/helpers-data-merge/name-mapper）
 *   但使用真实 SqliteEngine + SyncBridge 作为后端
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════
// Mock 设置（必须在 import 被测模块之前）
// ═══════════════════════════════════════════════════════════════

// mock log 函数
vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  hashUserInput_ACU: vi.fn((text: string) => text ? 'mock-ddl-digest' : ''),
  isSummaryOrOutlineTable_ACU: vi.fn(() => false),
  parseTableTemplateJson_ACU: vi.fn(() => null),
  stripSeedRowsFromTemplate_ACU: vi.fn((obj: any) => {
    if (!obj || typeof obj !== 'object') return obj;
    Object.keys(obj).forEach(k => {
      if (!k.startsWith('sheet_')) return;
      const table = obj[k];
      if (!table || !Array.isArray(table.content) || table.content.length === 0) return;
      table.content = [table.content[0]];
    });
    return obj;
  }),
}));

// mock state-manager（settings/身份导出供 helpers-table-lock 的锁定差异回滚链使用）
let mockCurrentJsonTableData: any = null;
const mockLockSettings = vi.hoisted(() => ({ value: { tableUpdateLocks: {}, specialIndexLocks: {} } as any }));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return mockCurrentJsonTableData; },
  _set_currentJsonTableData_ACU: vi.fn((v: any) => { mockCurrentJsonTableData = v; }),
  get settings_ACU() { return mockLockSettings.value; },
  currentChatFileIdentifier_ACU: 'test-chat',
  getCurrentIsolationKey_ACU: () => 'iso-key',
}));

// mock settings-service（helpers-table-lock 的持久化依赖）
vi.mock('../../../src/service/settings/settings-service', () => ({
  saveSettings_ACU: vi.fn(),
}));

// mock table-service
const mockSaveIndependentTable = vi.fn().mockResolvedValue({ saved: true, messageIndex: 5 });
vi.mock('../../../src/service/table/table-service', () => ({
  saveIndependentTableToChatHistory_ACU: (...args: any[]) => mockSaveIndependentTable(...args),
}));

// mock helpers-data-merge
const mockMergeAll = vi.fn();
const mockSeedGreetingLocalData = vi.fn().mockResolvedValue(false);
vi.mock('../../../src/service/runtime/helpers-data-merge', () => ({
  mergeAllIndependentTables_ACU: (...args: any[]) => mockMergeAll(...args),
  seedGreetingLocalDataFromTemplate_ACU: (...args: any[]) => mockSeedGreetingLocalData(...args),
}));

// mock name-mapper
const { mockPublishGlobalNameMapper, mockReleaseGlobalNameMapper, mockPublishGlobalNameMapperEmptySchema, mockCreateNameMapperOwnerToken } = vi.hoisted(() => ({
  mockPublishGlobalNameMapper: vi.fn(() => true),
  mockReleaseGlobalNameMapper: vi.fn(() => true),
  mockPublishGlobalNameMapperEmptySchema: vi.fn(() => true),
  mockCreateNameMapperOwnerToken: vi.fn((label: string) => ({ id: 1, label })),
}));
vi.mock('../../../src/service/runtime/template-vars/name-mapper', () => ({
  createNameMapperOwnerToken_ACU: mockCreateNameMapperOwnerToken,
  publishGlobalNameMapperForDDLs_ACU: mockPublishGlobalNameMapper,
  publishGlobalNameMapperEmptySchema_ACU: mockPublishGlobalNameMapperEmptySchema,
  releaseGlobalNameMapperForOwner_ACU: mockReleaseGlobalNameMapper,
}));

// mock chat-scope（getEffectiveSeedRowsForSheet_ACU + getCurrentChatTemplateScopeState_ACU）
const mockGetEffectiveSeedRows = vi.fn().mockReturnValue([]);
const mockGetCurrentChatTemplateScopeState = vi.fn().mockReturnValue(null);
const mockShouldUseInitialSeedRows = vi.fn().mockReturnValue(false);
vi.mock('../../../src/service/template/chat-scope', () => ({
  getEffectiveSeedRowsForSheet_ACU: (...args: any[]) => mockGetEffectiveSeedRows(...args),
  getCurrentChatTemplateScopeState_ACU: (...args: any[]) => mockGetCurrentChatTemplateScopeState(...args),
  shouldUseInitialSeedRows_ACU: (...args: any[]) => mockShouldUseInitialSeedRows(...args),
  ensureStableRowIdsForSheetContent_ACU: vi.fn((content: any) => {
    if (!Array.isArray(content) || content.length === 0) return [];
    const header = Array.isArray(content[0]) ? [...content[0]] : ['row_id'];
    const rows = content.slice(1).map((row: any) => Array.isArray(row) ? [...row] : []);
    let nextId = 1;
    return [header, ...rows.map((row: any) => {
      const normalized = row[0] == null || String(row[0]).trim() === '' ? '' : String(row[0]).trim();
      const value = normalized || String(nextId++);
      if (row.length === 0) return [value];
      row[0] = value;
      return row;
    })];
  }),
  sanitizeTemplateSnapshotForChat_ACU: vi.fn((source: any) => {
    if (!source) return null;
    return { templateStr: typeof source === 'string' ? source : JSON.stringify(source), templateObj: typeof source === 'string' ? JSON.parse(source) : source };
  }),
}));

// mock template-preset-service
const mockGetTemplatePreset = vi.fn().mockReturnValue(null);
vi.mock('../../../src/service/template/template-preset-service', () => ({
  getTemplatePreset_ACU: (...args: any[]) => mockGetTemplatePreset(...args),
}));

// mock json-helpers
vi.mock('../../../src/shared/json-helpers', () => ({
  safeJsonParse_ACU: vi.fn((str: string, fallback: any) => {
    try { return JSON.parse(str); } catch { return fallback; }
  }),
}));

// 现在 import 被测模块
import {
  applySqlEditsToTableDataSnapshot_ACU,
  assertNoHiddenPhysicalColumnMutations_ACU,
  buildSqlSheetBatchOperations_ACU,
  captureSqlTableApplyScope_ACU,
  materializeSystemRowIdsForSqlInserts_ACU,
  rebindSqlMutationTableIdentifiers_ACU,
  SqlRuntimeSnapshotError_ACU,
  SqlRuntimeSchemaStaleError_ACU,
  SqlTableService,
  splitSqlStatements,
  extractTableNamesFromStatements,
} from '../../../src/service/table/sql-table-service';
import { parseTableTemplateJson_ACU } from '../../../src/shared/utils';
// ═══════════════════════════════════════════════════════════════
// 回归：新卡首次填表时 rebind 必须覆盖模板里的表（no such table 修复）
// ═══════════════════════════════════════════════════════════════
describe('rebindSqlMutationTableIdentifiers_ACU · 模板别名补充', () => {
  const protagonistDdl = `CREATE TABLE protagonist_info ( -- 主角信息表\n  row_id INTEGER PRIMARY KEY, -- 行号\n  name TEXT -- 姓名\n);`;
  const templateData: any = {
    mate: {},
    sheet_zhujue: {
      uid: 'protagonist',
      name: '主角信息表',
      sourceData: { ddl: protagonistDdl },
      content: [['row_id', '姓名']],
      updateConfig: {},
      exportConfig: {},
      orderNo: 0,
    },
  };

  beforeEach(() => {
    mockGetCurrentChatTemplateScopeState.mockReturnValue(null);
  });

  it('运行时快照为空时，仍能借模板把 DDL 旧表名重绑定为拼音物理名', () => {
    mockGetCurrentChatTemplateScopeState.mockReturnValue({
      mode: 'chat_override',
      templateStr: JSON.stringify(templateData),
    });
    // 场景 A：新卡首次填表，baseSnapshot 里还没有这张表。
    const emptySnapshot: any = { mate: {} };
    const [rebound] = rebindSqlMutationTableIdentifiers_ACU(
      ["INSERT INTO protagonist_info (row_id, name) VALUES (1, '阿不思')"],
      emptySnapshot,
    );
    expect(rebound).toContain('zhujuexinxibiao');
    expect(rebound).not.toContain('protagonist_info');
  });

  it('显式传入 null 补充源时不读模板，保持调用方完全控制', () => {
    mockGetCurrentChatTemplateScopeState.mockReturnValue({
      mode: 'chat_override',
      templateStr: JSON.stringify(templateData),
    });
    const [rebound] = rebindSqlMutationTableIdentifiers_ACU(
      ["INSERT INTO protagonist_info (row_id, name) VALUES (1, '阿不思')"],
      { mate: {} } as any,
      null,
    );
    expect(rebound).toContain('protagonist_info');
  });

  it('运行时快照已有该表时，物理名解析结果一致（幂等）', () => {
    const [rebound] = rebindSqlMutationTableIdentifiers_ACU(
      ["INSERT INTO protagonist_info (row_id, name) VALUES (1, '阿不思')"],
      templateData,
      null,
    );
    expect(rebound).toContain('zhujuexinxibiao');
    expect(rebound).not.toContain('protagonist_info');
  });

  it('将显式 tableAliases、sheetKey、uid 和显示名重绑定到同一物理表', () => {
    const aliasTemplate = {
      ...templateData,
      sheet_zhujue: {
        ...templateData.sheet_zhujue,
        sourceData: { ...templateData.sheet_zhujue.sourceData, tableAliases: ['主角信息'] },
      },
    } as any;

    for (const alias of ['sheet_zhujue', 'protagonist', '主角信息表', '主角信息']) {
      const [rebound] = rebindSqlMutationTableIdentifiers_ACU(
        [`UPDATE ${alias} SET name = '阿不思' WHERE row_id = 1`],
        aliasTemplate,
        null,
        { requireKnownTables: true },
      );
      expect(rebound).toContain('UPDATE zhujuexinxibiao');
    }
  });

  it('按共享别名注册表将 SQL 表名分类为权威 sheetKey', () => {
    const aliasTemplate = {
      ...templateData,
      sheet_zhujue: {
        ...templateData.sheet_zhujue,
        sourceData: { ...templateData.sheet_zhujue.sourceData, tableAliases: ['主角信息'] },
      },
    } as any;

    expect(buildSqlSheetBatchOperations_ACU(
      ["UPDATE 主角信息 SET name = '阿不思' WHERE row_id = 1"],
      aliasTemplate,
    ).classifiedSheetKeys).toEqual(['sheet_zhujue']);
  });

  it('AI 严格写入重绑定拒绝未知或冲突的作者 DDL 名，不保留原 SQL 交给 SQLite 猜测', () => {
    expect(() => rebindSqlMutationTableIdentifiers_ACU(
      ['INSERT INTO missing_contract (row_id, name) VALUES (1, \'不应写入\')'],
      templateData,
      null,
      { requireKnownTables: true },
    )).toThrow('无法识别的目标表「missing_contract」');

    const conflictingTemplate = {
      ...templateData,
      sheet_duplicate: { ...templateData.sheet_zhujue, uid: 'duplicate', name: '重复表' },
    } as any;
    // 冲突英文名不再被当作“未知表”：结构化识别为歧义表名，fail-loud。
    expect(() => rebindSqlMutationTableIdentifiers_ACU(
      ['INSERT INTO protagonist_info (row_id, name) VALUES (1, \'不应写入\')'],
      conflictingTemplate,
      null,
      { requireKnownTables: true },
    )).toThrow('SQL 写入引用了歧义表名「protagonist_info」：该名称同时指向多张物理表，无法安全路由');
  });
});



// ═══════════════════════════════════════════════════════════════
// 纯函数测试：splitSqlStatements
// ═══════════════════════════════════════════════════════════════
describe('splitSqlStatements', () => {
  it('按分号拆分多条语句', () => {
    const sql = "INSERT INTO t VALUES (1, 'a'); UPDATE t SET x = 1; DELETE FROM t WHERE id = 1;";
    const result = splitSqlStatements(sql);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("INSERT INTO t VALUES (1, 'a')");
    expect(result[1]).toBe('UPDATE t SET x = 1');
    expect(result[2]).toBe('DELETE FROM t WHERE id = 1');
  });

  it('跳过字符串内的分号（单引号）', () => {
    const sql = "INSERT INTO t VALUES (1, 'hello; world'); INSERT INTO t VALUES (2, 'foo');";
    const result = splitSqlStatements(sql);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("INSERT INTO t VALUES (1, 'hello; world')");
    expect(result[1]).toBe("INSERT INTO t VALUES (2, 'foo')");
  });

  it('跳过字符串内的分号（双引号）', () => {
    const sql = 'INSERT INTO t VALUES (1, "hello; world"); INSERT INTO t VALUES (2, "foo");';
    const result = splitSqlStatements(sql);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe('INSERT INTO t VALUES (1, "hello; world")');
    expect(result[1]).toBe('INSERT INTO t VALUES (2, "foo")');
  });

  it('处理转义的单引号（SQL 风格 \'\'）', () => {
    const sql = "INSERT INTO t VALUES (1, 'it''s a test'); INSERT INTO t VALUES (2, 'ok');";
    const result = splitSqlStatements(sql);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("INSERT INTO t VALUES (1, 'it''s a test')");
    expect(result[1]).toBe("INSERT INTO t VALUES (2, 'ok')");
  });

  it('最后一条语句没有分号结尾', () => {
    const sql = 'INSERT INTO t VALUES (1); UPDATE t SET x = 2';
    const result = splitSqlStatements(sql);
    expect(result).toHaveLength(2);
    expect(result[1]).toBe('UPDATE t SET x = 2');
  });

  it('空字符串返回空数组', () => {
    expect(splitSqlStatements('')).toEqual([]);
  });

  it('纯空白返回空数组', () => {
    expect(splitSqlStatements('   \n\t  ')).toEqual([]);
  });

  it('单条语句无分号', () => {
    const result = splitSqlStatements('SELECT * FROM t');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('SELECT * FROM t');
  });

  it('连续分号产生空语句被过滤', () => {
    const sql = 'INSERT INTO t VALUES (1);;; UPDATE t SET x = 2;;';
    const result = splitSqlStatements(sql);
    expect(result).toHaveLength(2);
  });

  it('多行 SQL 语句', () => {
    const sql = `INSERT INTO inventory
      VALUES (1, '铁剑', 3);
    UPDATE inventory
      SET quantity = 5
      WHERE item_name = '铁剑';`;
    const result = splitSqlStatements(sql);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('INSERT INTO inventory');
    expect(result[1]).toContain('UPDATE inventory');
  });

  it('字符串中包含转义双引号', () => {
    const sql = 'INSERT INTO t VALUES (1, "he said ""hello"""); INSERT INTO t VALUES (2, "ok");';
    const result = splitSqlStatements(sql);
    expect(result).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// 纯函数测试：extractTableNamesFromStatements
// ═══════════════════════════════════════════════════════════════
describe('extractTableNamesFromStatements', () => {
  it('提取 INSERT INTO 的表名', () => {
    const result = extractTableNamesFromStatements(["INSERT INTO inventory VALUES (1, '铁剑', 3)"]);
    expect(result).toEqual(['inventory']);
  });

  it('提取 INSERT OR REPLACE INTO 的表名', () => {
    const result = extractTableNamesFromStatements(["INSERT OR REPLACE INTO inventory VALUES (1, '铁剑', 3)"]);
    expect(result).toEqual(['inventory']);
  });

  it.each([
    ["REPLACE INTO inventory VALUES (1, '铁剑', 3)", 'inventory'],
    ["REPLACE INTO inventory (row_id, value) VALUES (1, 'INSERT INTO quest_log')", 'inventory'],
    ["REPLACE INTO inventory (row_id, value) VALUES (1, 'x') /* INSERT INTO quest_log */", 'inventory'],
    ["INSERT OR REPLACE INTO inventory (row_id, value) VALUES (1, 'UPDATE quest_log SET value = 1')", 'inventory'],
    ["REPLACE INTO main.inventory (row_id, value) VALUES (1, 'x')", 'inventory'],
  ])('使用 mutation token 提取真实目标表：%s', (sql, expected) => {
    expect(extractTableNamesFromStatements([sql])).toEqual([expected]);
  });

  it('提取 UPDATE 的表名', () => {
    const result = extractTableNamesFromStatements(["UPDATE inventory SET quantity = 5 WHERE row_id = 1"]);
    expect(result).toEqual(['inventory']);
  });

  it('提取 UPDATE OR IGNORE 的表名', () => {
    const result = extractTableNamesFromStatements(["UPDATE OR IGNORE inventory SET quantity = 5"]);
    expect(result).toEqual(['inventory']);
  });

  it('提取 DELETE FROM 的表名', () => {
    const result = extractTableNamesFromStatements(["DELETE FROM inventory WHERE row_id = 1"]);
    expect(result).toEqual(['inventory']);
  });

  it('提取 ALTER TABLE 的表名', () => {
    const result = extractTableNamesFromStatements(["ALTER TABLE inventory ADD COLUMN description TEXT"]);
    expect(result).toEqual(['inventory']);
  });

  it('多条语句提取多个表名（去重）', () => {
    const result = extractTableNamesFromStatements([
      "INSERT INTO inventory VALUES (1, '铁剑', 3)",
      "UPDATE inventory SET quantity = 5",
      "INSERT INTO characters VALUES (1, '角色A', 25)",
    ]);
    expect(result).toContain('inventory');
    expect(result).toContain('characters');
    expect(result).toHaveLength(2); // inventory 去重
  });

  it('SELECT 语句不提取表名', () => {
    const result = extractTableNamesFromStatements(["SELECT * FROM inventory"]);
    expect(result).toEqual([]);
  });

  it('CREATE TABLE 语句不提取表名', () => {
    const result = extractTableNamesFromStatements(["CREATE TABLE new_table (id INTEGER)"]);
    expect(result).toEqual([]);
  });

  it('空数组返回空数组', () => {
    expect(extractTableNamesFromStatements([])).toEqual([]);
  });

  it('空字符串语句不提取', () => {
    expect(extractTableNamesFromStatements(['', '  '])).toEqual([]);
  });

  it('大小写不敏感', () => {
    const result = extractTableNamesFromStatements(["insert into MyTable values (1)"]);
    expect(result).toEqual(['MyTable']);
  });
});

// ═══════════════════════════════════════════════════════════════
// SqlTableService 类测试
// ═══════════════════════════════════════════════════════════════
describe('applySqlEditsToTableDataSnapshot_ACU', () => {
  const TEST_DDL = `CREATE TABLE inventory (
    row_id INTEGER PRIMARY KEY,
    item_name TEXT NOT NULL,
    quantity INTEGER DEFAULT 1
  );`;

  const snapshotTableData: any = {
    mate: { type: 'acu', version: 1, updateConfigUiSentinel: 0, globalInjectionConfig: { readableEntryPlacement: { position: '', depth: 0, order: 0 }, wrapperPlacement: { position: '', depth: 0, order: 0 } } },
    sheet_0: {
      uid: 'inventory',
      name: '背包物品表',
      sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '', ddl: TEST_DDL },
      content: [
        ['row_id', 'item_name', 'quantity'],
        ['1', '铁剑', '3'],
      ],
      updateConfig: {},
      exportConfig: {},
      orderNo: 0,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentJsonTableData = null;
    mockLockSettings.value = { tableUpdateLocks: {}, specialIndexLocks: {} };
  });

  it('基于显式快照应用 SQL，返回 workingData 且不污染输入快照与全局状态', async () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    const result = await applySqlEditsToTableDataSnapshot_ACU("UPDATE inventory SET quantity = 9 WHERE row_id = 1; INSERT INTO inventory (item_name, quantity) VALUES ('治疗药水', 5);", inputSnapshot);

    expect(result.success).toBe(true);
    expect(result.modifiedKeys).toEqual(['sheet_0']);
    expect(result.appliedEdits).toBe(2);
    expect(result.workingData?.sheet_0.content).toEqual([['row_id', 'item_name', 'quantity'], ['1', '铁剑', '9'], ['2', '治疗药水', '5']]);
    expect(inputSnapshot.sheet_0.content).toEqual([['row_id', 'item_name', 'quantity'], ['1', '铁剑', '3']]);
    expect(mockCurrentJsonTableData).toBeNull();
  });

  it('generation 链将 sheetKey 和 uid alias 重绑定到权威物理表', async () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    inputSnapshot.sheet_0.uid = 'inventory_uid';

    const sheetKeyResult = await applySqlEditsToTableDataSnapshot_ACU('UPDATE sheet_0 SET quantity = 9 WHERE row_id = 1;', inputSnapshot);
    const uidResult = await applySqlEditsToTableDataSnapshot_ACU('UPDATE inventory_uid SET quantity = 9 WHERE row_id = 1;', inputSnapshot);

    expect(sheetKeyResult.success).toBe(true);
    expect(sheetKeyResult.modifiedKeys).toEqual(['sheet_0']);
    expect(uidResult.success).toBe(true);
    expect(uidResult.modifiedKeys).toEqual(['sheet_0']);
    expect(inputSnapshot.sheet_0.content).toEqual([['row_id', 'item_name', 'quantity'], ['1', '铁剑', '3']]);
  });

  it('严格单表范围下拒绝显式未知 SQL 表名，不能回退映射到唯一目标表', async () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));

    const result = await applySqlEditsToTableDataSnapshot_ACU(
      'UPDATE missing_contract SET quantity = 9 WHERE row_id = 1;',
      inputSnapshot,
      'auto_standard',
      { targetSheetKeys: ['sheet_0'], requireSheetScopedOperations: true, allowSingleTargetFallback: true },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('无法识别的目标表「missing_contract」');
    expect(inputSnapshot.sheet_0.content).toEqual([['row_id', 'item_name', 'quantity'], ['1', '铁剑', '3']]);
  });

  it('构建 V2 SQL operation 时不把显式未知表名归属给唯一回退目标', () => {
    const result = buildSqlSheetBatchOperations_ACU(
      ['UPDATE missing_contract SET quantity = 9 WHERE row_id = 1'],
      snapshotTableData,
      {
        fallbackTargetSheetKeys: ['sheet_0'],
        allowSingleTargetFallback: true,
        keepLegacyForUnclassified: true,
      },
    );

    expect(result.classifiedSheetKeys).toEqual([]);
    expect(result.unknownStatements).toEqual(['UPDATE missing_contract SET quantity = 9 WHERE row_id = 1']);
    expect(result.operations).toEqual([{ kind: 'sql_batch', statements: ['UPDATE missing_contract SET quantity = 9 WHERE row_id = 1'] }]);
  });

  it('SQL 失败时返回错误且不污染输入快照与全局状态', async () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    const result = await applySqlEditsToTableDataSnapshot_ACU('UPDATE inventory SET missing_col = 1 WHERE row_id = 1;', inputSnapshot);

    expect(result.success).toBe(false);
    expect(result.error).toContain('missing_col');
    expect(inputSnapshot.sheet_0.content).toEqual([['row_id', 'item_name', 'quantity'], ['1', '铁剑', '3']]);
    expect(mockCurrentJsonTableData).toBeNull();
  });

  it('严格单表日志模式下返回 sql_sheet_batch 而不是旧 sql_batch', async () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    const result = await applySqlEditsToTableDataSnapshot_ACU(
      "UPDATE inventory SET quantity = 9 WHERE row_id = 1; INSERT INTO inventory (item_name, quantity) VALUES ('治疗药水', 5);",
      inputSnapshot,
      'auto_standard',
      { targetSheetKeys: ['sheet_0'], requireSheetScopedOperations: true, allowSingleTargetFallback: true },
    );

    expect(result.success).toBe(true);
    expect(result.operations).toEqual([{
      kind: 'sql_sheet_batch',
      sheetKey: 'sheet_0',
      statements: [
        'UPDATE beibaowupinbiao SET quantity = 9 WHERE row_id = 1',
        "INSERT INTO beibaowupinbiao (row_id, item_name, quantity) VALUES (2, '治疗药水', 5)",
      ],
      tableName: 'beibaowupinbiao',
      reason: 'system',
    }]);
  });

  it('目标表可识别的 WITH UPDATE 记录为 sql_sheet_batch', async () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    const result = await applySqlEditsToTableDataSnapshot_ACU(
      "WITH selected AS (SELECT 1 AS row_id) UPDATE inventory SET quantity = 9 WHERE row_id IN (SELECT row_id FROM selected);",
      inputSnapshot,
      'auto_standard',
      { targetSheetKeys: ['sheet_0'], requireSheetScopedOperations: true, allowSingleTargetFallback: false },
    );

    expect(result.success).toBe(true);
    expect(result.workingData?.sheet_0.content[1]).toEqual(['1', '铁剑', '9']);
    expect(result.operations).toEqual([{
      kind: 'sql_sheet_batch',
      sheetKey: 'sheet_0',
      statements: ['WITH selected AS (SELECT 1 AS row_id) UPDATE beibaowupinbiao SET quantity = 9 WHERE row_id IN (SELECT row_id FROM selected)'],
      tableName: 'beibaowupinbiao',
      reason: 'system',
    }]);
  });

  it('无显式列清单的 INSERT SELECT 维持 fail-closed（无法确定 row_id 之外的列对应）', async () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    inputSnapshot.sheet_1 = {
      uid: 'quest_log',
      name: '任务表',
      sourceData: { ddl: 'CREATE TABLE quest_log (row_id INTEGER PRIMARY KEY, item_name TEXT NOT NULL, quantity INTEGER DEFAULT 1);' },
      content: [['row_id', 'item_name', 'quantity'], ['2', '支线任务', '1']],
      updateConfig: {},
      exportConfig: {},
      orderNo: 1,
    };

    const result = await applySqlEditsToTableDataSnapshot_ACU(
      'INSERT INTO inventory SELECT row_id, item_name, quantity FROM quest_log;',
      inputSnapshot,
      'auto_standard',
      { targetSheetKeys: ['sheet_0'], requireSheetScopedOperations: true, allowSingleTargetFallback: true },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('必须显式列出业务列');
    expect(inputSnapshot.sheet_0.content).toEqual([['row_id', 'item_name', 'quantity'], ['1', '铁剑', '3']]);
  });

  it('显式列清单的 INSERT SELECT 先执行后物化：结果行转为 VALUES 字面量 + 系统 row_id', async () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    inputSnapshot.sheet_1 = {
      uid: 'quest_log',
      name: '任务表',
      sourceData: { ddl: 'CREATE TABLE quest_log (row_id INTEGER PRIMARY KEY, item_name TEXT NOT NULL, quantity INTEGER DEFAULT 1);' },
      content: [['row_id', 'item_name', 'quantity'], ['2', '支线任务', '7']],
      updateConfig: {},
      exportConfig: {},
      orderNo: 1,
    };

    const result = await applySqlEditsToTableDataSnapshot_ACU(
      'INSERT INTO inventory (item_name, quantity) SELECT item_name, quantity FROM quest_log;',
      inputSnapshot,
      'auto_standard',
      { targetSheetKeys: ['sheet_0', 'sheet_1'], requireSheetScopedOperations: true, allowSingleTargetFallback: true },
    );

    expect(result.success).toBe(true);
    // 原行（铁剑）保留，SELECT 结果行（支线任务, 7）以系统 row_id 物化插入。
    const rows = (result.workingData as any).sheet_0.content.slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[1].slice(1)).toEqual(['支线任务', '7']);
  });

  it('7.3 双轨：runtime 目标为 fallback 拼音，SQL 用模板 authored 英文列名 → 写入成功', async () => {
    // 目标 sheet 无显式 DDL（fallback_missing），表头中文 → 物理列是确定性拼音。
    // SQL 使用作者 DDL 英文名 item_name/quantity，经 supplemental（当前聊天模板）
    // 的「DDL 列名 ↔ 表头显示名」结构对齐映射到目标拼音列。
    const inputSnapshot: any = {
      mate: { type: 'acu', version: 1 },
      sheet_0: {
        uid: 'inventory',
        name: '背包物品表',
        sourceData: {},
        content: [
          ['row_id', '物品名称', '数量'],
          ['1', '铁剑', '3'],
        ],
        updateConfig: {},
        exportConfig: {},
        orderNo: 0,
      },
    };
    mockGetCurrentChatTemplateScopeState.mockReturnValue({
      mode: 'chat_override',
      isolationKey: '',
      templateStr: JSON.stringify({
        mate: { type: 'acu', version: 1 },
        sheet_0: {
          uid: 'inventory',
          name: '背包物品表',
          sourceData: { ddl: TEST_DDL },
          content: [['row_id', '物品名称', '数量'], ['99', '示例', '1']],
          updateConfig: {},
          exportConfig: {},
          orderNo: 1,
        },
      }),
    });

    const result = await applySqlEditsToTableDataSnapshot_ACU(
      "UPDATE beibaowupinbiao SET item_name = '圣剑' WHERE row_id = 1",
      inputSnapshot,
      'auto_standard',
      { targetSheetKeys: ['sheet_0'], requireSheetScopedOperations: true, allowSingleTargetFallback: true },
    );
    expect(result.success).toBe(true);
    expect(result.workingData?.sheet_0.content[1][1]).toBe('圣剑');
  });

  it('7.3 双轨：runtime 目标为 explicit 英文 DDL，SQL 用 fallback 拼音列名 → 写入成功', async () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    // mapSqlColumnIdentifiers_ACU(['row_id', 'item_name', 'quantity']) 的确定性拼音为
    // ['row_id', 'item_name', 'quantity']；为验证异名桥接，目标表头使用中文显示名，
    // 并由显式 DDL 注释证明其与英文物理列的对应关系。
    inputSnapshot.sheet_0.sourceData.ddl = `CREATE TABLE inventory (
      row_id INTEGER PRIMARY KEY, -- 行号
      item_name TEXT NOT NULL, -- 物品名称
      quantity INTEGER DEFAULT 1 -- 数量
    );`;
    inputSnapshot.sheet_0.content = [['row_id', '物品名称', '数量'], ['1', '铁剑', '3']];
    const result = await applySqlEditsToTableDataSnapshot_ACU(
      "UPDATE beibaowupinbiao SET wu_pin_ming_cheng = '圣剑' WHERE row_id = 1",
      inputSnapshot,
      'auto_standard',
      { targetSheetKeys: ['sheet_0'], requireSheetScopedOperations: true, allowSingleTargetFallback: true },
    );
    expect(result.success).toBe(true);
    expect(result.workingData?.sheet_0.content[1][1]).toBe('圣剑');
  });

  it('7.3 双轨：supplemental 独有列不得写入 target（无证据不注册，SQLite no such column）', async () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    const result = await applySqlEditsToTableDataSnapshot_ACU(
      "UPDATE beibaowupinbiao SET nonexistent_col = 'x' WHERE row_id = 1",
      inputSnapshot,
      'auto_standard',
      { targetSheetKeys: ['sheet_0'], requireSheetScopedOperations: true, allowSingleTargetFallback: true },
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('no such column');
    // 零持久化：输入快照未被修改。
    expect(inputSnapshot.sheet_0.content).toEqual([['row_id', 'item_name', 'quantity'], ['1', '铁剑', '3']]);
  });


  it('为同一批 INSERT 按当前最大 row_id 连续分配，并持久化具体身份', async () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    inputSnapshot.sheet_0.content.push(['3', '盾牌', '1']);
    const result = await applySqlEditsToTableDataSnapshot_ACU(
      "INSERT INTO inventory (item_name, quantity) VALUES ('药水', 5), ('卷轴', 2);",
      inputSnapshot,
    );

    expect(result.success).toBe(true);
    expect(result.workingData?.sheet_0.content.slice(1).map((row: any[]) => row[0])).toEqual(['1', '3', '4', '5']);
    expect((result.operations?.[0] as any).statements).toEqual([
      "INSERT INTO beibaowupinbiao (row_id, item_name, quantity) VALUES (4, '药水', 5), (5, '卷轴', 2)",
    ]);
  });

  describe('锁定差异回滚（S0-2）', () => {
    const LOCK_SCOPE_KEY = 'test-chat::iso-key';

    beforeEach(() => {
      mockLockSettings.value = { tableUpdateLocks: {}, specialIndexLocks: {} };
    });

    it('锁定行被 UPDATE：workingData 恢复前像，补偿语句进入 operations，revertedByLocks 上报', async () => {
      mockLockSettings.value.tableUpdateLocks = {
        [LOCK_SCOPE_KEY]: { sheet_0: { v: 2, rowIds: ['1'], colNames: [], cells: [] } },
      };
      const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
      const result = await applySqlEditsToTableDataSnapshot_ACU(
        'UPDATE inventory SET quantity = 99 WHERE row_id = 1;',
        inputSnapshot,
        'auto_standard',
        { targetSheetKeys: ['sheet_0'], requireSheetScopedOperations: true, allowSingleTargetFallback: true },
      );

      expect(result.success).toBe(true);
      // 锁定行的修改已回滚
      expect(result.workingData?.sheet_0.content[1]).toEqual(['1', '铁剑', '3']);
      expect(result.revertedByLocks).toEqual([
        { sheetKey: 'sheet_0', tableName: '背包物品表', kind: 'cell_restored', rowId: '1', colName: 'quantity' },
      ]);
      // 补偿语句必须与原始语句一起持久化（冷回放重放 SQL 时才能得到同样结果）
      const statements = (result.operations?.[0] as any).statements as string[];
      expect(statements).toHaveLength(2);
      expect(statements[0]).toContain('SET quantity = 99');
      expect(statements[1]).toBe(`UPDATE "beibaowupinbiao" SET "quantity" = '3' WHERE "row_id" = '1';`);
    });

    it('锁定行被 DELETE：整行恢复', async () => {
      mockLockSettings.value.tableUpdateLocks = {
        [LOCK_SCOPE_KEY]: { sheet_0: { v: 2, rowIds: ['1'], colNames: [], cells: [] } },
      };
      const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
      const result = await applySqlEditsToTableDataSnapshot_ACU(
        'DELETE FROM inventory WHERE row_id = 1;',
        inputSnapshot,
      );

      expect(result.success).toBe(true);
      expect(result.workingData?.sheet_0.content.slice(1)).toEqual([['1', '铁剑', '3']]);
      expect(result.revertedByLocks).toEqual([
        { sheetKey: 'sheet_0', tableName: '背包物品表', kind: 'row_restored', rowId: '1' },
      ]);
    });

    it('锁定列被 UPDATE：仅该列回滚，其他列修改保留', async () => {
      mockLockSettings.value.tableUpdateLocks = {
        [LOCK_SCOPE_KEY]: { sheet_0: { v: 2, rowIds: [], colNames: ['quantity'], cells: [] } },
      };
      const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
      const result = await applySqlEditsToTableDataSnapshot_ACU(
        "UPDATE inventory SET quantity = 99, item_name = '圣剑' WHERE row_id = 1;",
        inputSnapshot,
      );

      expect(result.success).toBe(true);
      expect(result.workingData?.sheet_0.content[1]).toEqual(['1', '圣剑', '3']);
      expect(result.revertedByLocks).toEqual([
        { sheetKey: 'sheet_0', tableName: '背包物品表', kind: 'cell_restored', rowId: '1', colName: 'quantity' },
      ]);
    });

    it('legacy 索引锁自动迁移后同样生效', async () => {
      // 旧格式：rows:[0] 指向第一条数据行（row_id=1）
      mockLockSettings.value.tableUpdateLocks = {
        [LOCK_SCOPE_KEY]: { sheet_0: { rows: [0], cols: [], cells: [] } },
      };
      const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
      const result = await applySqlEditsToTableDataSnapshot_ACU(
        'UPDATE inventory SET quantity = 99 WHERE row_id = 1;',
        inputSnapshot,
      );

      expect(result.success).toBe(true);
      expect(result.workingData?.sheet_0.content[1]).toEqual(['1', '铁剑', '3']);
      // 迁移后存储升级为 v2 身份桶
      expect(mockLockSettings.value.tableUpdateLocks[LOCK_SCOPE_KEY].sheet_0.v).toBe(2);
      expect(mockLockSettings.value.tableUpdateLocks[LOCK_SCOPE_KEY].sheet_0.rowIds).toEqual(['1']);
    });

    it('锁不阻止对未锁定目标的修改与新增行', async () => {
      mockLockSettings.value.tableUpdateLocks = {
        [LOCK_SCOPE_KEY]: { sheet_0: { v: 2, rowIds: ['1'], colNames: [], cells: [] } },
      };
      const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
      const result = await applySqlEditsToTableDataSnapshot_ACU(
        "INSERT INTO inventory (item_name, quantity) VALUES ('药水', 5);",
        inputSnapshot,
      );

      expect(result.success).toBe(true);
      expect(result.revertedByLocks).toBeUndefined();
      expect(result.workingData?.sheet_0.content.slice(1)).toEqual([
        ['1', '铁剑', '3'],
        ['2', '药水', '5'],
      ]);
    });
  });

  it('静默忽略 AI 显式 row_id，并按系统保留序列重新分配', () => {
    const result = materializeSystemRowIdsForSqlInserts_ACU([
      "INSERT INTO beibaowupinbiao (row_id, item_name, quantity) VALUES (999, '药水', 5)",
      "INSERT INTO beibaowupinbiao (item_name, row_id, quantity) VALUES ('卷轴', 888, 2), ('盾牌', 777, 1)",
      "INSERT INTO beibaowupinbiao (item_name, quantity, \"ROW_ID\") VALUES ('钥匙', 1, 666)",
    ], snapshotTableData);

    expect(result).toEqual([
      "INSERT INTO beibaowupinbiao (row_id, item_name, quantity) VALUES (2, '药水', 5)",
      "INSERT INTO beibaowupinbiao (row_id, item_name, quantity) VALUES (3, '卷轴', 2), (4, '盾牌', 1)",
      "INSERT INTO beibaowupinbiao (row_id, item_name, quantity) VALUES (5, '钥匙', 1)",
    ]);
    expect(result.join('\n')).not.toContain('999');
    expect(result.join('\n')).not.toContain('888');
    expect(result.join('\n')).not.toContain('777');
    expect(result.join('\n')).not.toContain('666');
  });

  it('普通表保留 INSERT OR REPLACE 原生语义，并将实际 SQL 写入单表 operation', async () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    inputSnapshot.sheet_0.sourceData.ddl = 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT NOT NULL, quantity INTEGER DEFAULT 1);';
    inputSnapshot.sheet_0.content = [
      ['row_id', 'item_name', 'quantity'],
      ['1', '旧物品', '1'],
      ['2', '旧卷轴', '2'],
    ];
    const sql = "INSERT OR REPLACE INTO inventory (row_id, item_name, quantity) VALUES (1, '新物品', 9), (2, '新卷轴', 8);";

    expect(materializeSystemRowIdsForSqlInserts_ACU([sql], inputSnapshot)).toEqual([sql]);
    expect(() => assertNoHiddenPhysicalColumnMutations_ACU([sql], inputSnapshot)).not.toThrow();

    const result = await applySqlEditsToTableDataSnapshot_ACU(
      sql,
      inputSnapshot,
      'auto_standard',
      { targetSheetKeys: ['sheet_0'], requireSheetScopedOperations: true, allowSingleTargetFallback: true },
    );

    expect(result.success).toBe(true);
    expect(result.workingData?.sheet_0.content).toEqual([
      ['row_id', 'item_name', 'quantity'],
      ['1', '新物品', '9'],
      ['2', '新卷轴', '8'],
    ]);
    expect(result.operations).toEqual([{
      kind: 'sql_sheet_batch', sheetKey: 'sheet_0', statements: [sql.replace('inventory', 'beibaowupinbiao').replace(/;$/, '')],
      tableName: 'beibaowupinbiao', reason: 'system',
    }]);
  });

  it('REPLACE INTO 执行后返回 modifiedKeys 并生成单表 operation', async () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    inputSnapshot.sheet_1 = {
      uid: 'quest_log',
      name: '任务表',
      sourceData: { ddl: 'CREATE TABLE quest_log (row_id INTEGER PRIMARY KEY, value TEXT);' },
      content: [['row_id', 'value'], ['1', '旧任务']],
    };
    inputSnapshot.sheet_0.content = [
      ['row_id', 'item_name', 'quantity'],
      ['1', '旧物品', '1'],
    ];
    const sql = "REPLACE INTO inventory (row_id, item_name, quantity) VALUES (1, 'INSERT INTO quest_log', 9);";

    const result = await applySqlEditsToTableDataSnapshot_ACU(sql, inputSnapshot);

    expect(result.success).toBe(true);
    expect(result.modifiedKeys).toEqual(['sheet_0']);
    expect(result.workingData?.sheet_0.content).toEqual([
      ['row_id', 'item_name', 'quantity'],
      ['1', 'INSERT INTO quest_log', '9'],
    ]);
    expect(result.workingData?.sheet_1.content).toEqual([['row_id', 'value'], ['1', '旧任务']]);
    expect(result.operations).toEqual([{
      kind: 'sql_sheet_batch',
      sheetKey: 'sheet_0',
      statements: ["REPLACE INTO beibaowupinbiao (row_id, item_name, quantity) VALUES (1, 'INSERT INTO quest_log', 9)"],
      tableName: 'beibaowupinbiao',
      reason: 'system',
    }]);
  });

  it.each([
    "INSERT OR REPLACE INTO inventory (item_name, quantity) VALUES ('药水', 1)",
    "INSERT OR REPLACE INTO inventory (row_id, item_name, quantity) VALUES (3, '药水', 1)",
    "INSERT OR REPLACE INTO inventory (row_id, item_name, quantity) VALUES (1 + 0, '药水', 1)",
    "REPLACE INTO inventory (row_id, item_name, quantity) VALUES (1, '药水', 1)",
  ])('REPLACE 语句不再受固定槽位契约限制：%s', sql => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    expect(materializeSystemRowIdsForSqlInserts_ACU([sql], inputSnapshot)).toEqual([sql]);
    expect(() => assertNoHiddenPhysicalColumnMutations_ACU([sql], inputSnapshot)).not.toThrow();
  });

  it('普通稳定身份表允许 INSERT OR REPLACE', () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    const sql = "INSERT OR REPLACE INTO inventory (row_id, item_name, quantity) VALUES (1, '药水', 1)";

    expect(materializeSystemRowIdsForSqlInserts_ACU([sql], inputSnapshot)).toEqual([sql]);
    expect(() => assertNoHiddenPhysicalColumnMutations_ACU([sql], inputSnapshot)).not.toThrow();
  });

  it('显式 row_id 是唯一列时拒绝无业务内容的 INSERT', () => {
    expect(() => materializeSystemRowIdsForSqlInserts_ACU(
      ['INSERT INTO beibaowupinbiao (row_id) VALUES (999)'],
      snapshotTableData,
    )).toThrow('剔除 row_id 后没有业务列');
  });

  it('无列清单 INSERT 仍然 fail closed', () => {
    expect(() => materializeSystemRowIdsForSqlInserts_ACU(
      ["INSERT INTO beibaowupinbiao VALUES (2, '药水', 5)"],
      snapshotTableData,
    )).toThrow('必须显式列出业务列');
  });

  // ── 阶段 D：INSERT 列清单 token 级解析（test31 根因 3.3 注释残留）──
  // tokenizer 天然跳过行注释/块注释/字符串；列间/列后注释不得残留在列项中。
  it('列间行注释与列后块注释不残留，row_id 物化仍按 token 语义工作', () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    // 目标物理表名 beibaowupinbiao（inventory 重绑后）；列间 `-- 注释`、列后 `/* */` 都合法。
    const sql = [
      "INSERT INTO beibaowupinbiao (item_name, -- 物品名\n  quantity /* 数量 */) VALUES ('药水', 5)",
    ];
    const result = materializeSystemRowIdsForSqlInserts_ACU(sql, inputSnapshot);
    // 物化后列名只保留 token 语义，注释已消失；row_id 前置，业务列原文保留。
    expect(result).toEqual([
      "INSERT INTO beibaowupinbiao (row_id, item_name, quantity) VALUES (2, '药水', 5)",
    ]);
  });

  it('字符串字面量中的注释样文本不参与列清单解析', () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    // 列名是 item_name、quantity，不是字符串里的 "-- 伪注释"。
    const sql = [
      "INSERT INTO beibaowupinbiao (item_name, quantity) VALUES ('-- 伪注释', 5)",
    ];
    const result = materializeSystemRowIdsForSqlInserts_ACU(sql, inputSnapshot);
    expect(result).toEqual([
      "INSERT INTO beibaowupinbiao (row_id, item_name, quantity) VALUES (2, '-- 伪注释', 5)",
    ]);
  });

  it('尾逗号 / 空项 / 重复列 / 非法关键字列一律 fail-closed', () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    expect(() => materializeSystemRowIdsForSqlInserts_ACU(
      ['INSERT INTO beibaowupinbiao (item_name, quantity,) VALUES (\'药水\', 5)'],
      inputSnapshot,
    )).toThrow(/列清单|括号未闭合|空项|无法安全解析/);
    expect(() => materializeSystemRowIdsForSqlInserts_ACU(
      ['INSERT INTO beibaowupinbiao (item_name,, quantity) VALUES (\'药水\', 5)'],
      inputSnapshot,
    )).toThrow(/列清单|空项|无法安全解析/);
    expect(() => materializeSystemRowIdsForSqlInserts_ACU(
      ['INSERT INTO beibaowupinbiao (item_name, item_name) VALUES (\'药水\', 5)'],
      inputSnapshot,
    )).toThrow('列名重复');
    expect(() => materializeSystemRowIdsForSqlInserts_ACU(
      ['INSERT INTO beibaowupinbiao (SELECT, quantity) VALUES (\'药水\', 5)'],
      inputSnapshot,
    )).toThrow('非法标识符');
  });

  it('INSERT SELECT / 无显式列清单保持 fail-closed', () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    expect(() => materializeSystemRowIdsForSqlInserts_ACU(
      ['INSERT INTO beibaowupinbiao SELECT * FROM other'],
      inputSnapshot,
    )).toThrow('必须显式列出业务列');
    expect(() => materializeSystemRowIdsForSqlInserts_ACU(
      ['INSERT INTO beibaowupinbiao VALUES (1, \'药水\', 5)'],
      inputSnapshot,
    )).toThrow('必须显式列出业务列');
    // 带显式列清单但当前路径没有 SELECT 预执行器 → 仍拒绝。
    expect(() => materializeSystemRowIdsForSqlInserts_ACU(
      ['INSERT INTO beibaowupinbiao (item_name, quantity) SELECT item_name, quantity FROM other'],
      inputSnapshot,
    )).toThrow('不支持 INSERT SELECT');
  });

  it('显式 row_id 重分配 + 多 VALUES tuple + 注释同时存在时逐 tuple 物化', () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    const sql = [
      "INSERT INTO beibaowupinbiao (row_id /* 显式旧 id */, item_name, quantity) VALUES (99, '药水', 5), (88, '卷轴', 2)",
    ];
    const result = materializeSystemRowIdsForSqlInserts_ACU(sql, inputSnapshot);
    expect(result).toEqual([
      "INSERT INTO beibaowupinbiao (row_id, item_name, quantity) VALUES (2, '药水', 5), (3, '卷轴', 2)",
    ]);
  });

  // ── 修复六：AI SQL 语法宽容 ──

  it('INSERT OR IGNORE/ABORT/FAIL/ROLLBACK 保留冲突子句前缀并照常物化系统 row_id', () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    const result = materializeSystemRowIdsForSqlInserts_ACU([
      "INSERT OR IGNORE INTO beibaowupinbiao (item_name, quantity) VALUES ('药水', 5)",
      "INSERT OR ABORT INTO beibaowupinbiao (item_name, quantity) VALUES ('卷轴', 2)",
    ], inputSnapshot);
    expect(result).toEqual([
      "INSERT OR IGNORE INTO beibaowupinbiao (row_id, item_name, quantity) VALUES (2, '药水', 5)",
      "INSERT OR ABORT INTO beibaowupinbiao (row_id, item_name, quantity) VALUES (3, '卷轴', 2)",
    ]);
  });

  it('INSERT OR REPLACE 维持原生语义原样放行（不物化）', () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    const sql = "INSERT OR REPLACE INTO beibaowupinbiao (row_id, item_name, quantity) VALUES (1, '铁剑', 9)";
    expect(materializeSystemRowIdsForSqlInserts_ACU([sql], inputSnapshot)).toEqual([sql]);
  });

  it('值比列多 1 且列清单未含 row_id → 首值按 AI 自带 row_id 剔除', () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    const result = materializeSystemRowIdsForSqlInserts_ACU([
      "INSERT INTO beibaowupinbiao (item_name, quantity) VALUES (7, '药水', 5)",
    ], inputSnapshot);
    expect(result).toEqual([
      "INSERT INTO beibaowupinbiao (row_id, item_name, quantity) VALUES (2, '药水', 5)",
    ]);
  });

  it('值比列少 → 尾部补 NULL', () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    const result = materializeSystemRowIdsForSqlInserts_ACU([
      "INSERT INTO beibaowupinbiao (item_name, quantity) VALUES ('药水')",
    ], inputSnapshot);
    expect(result).toEqual([
      "INSERT INTO beibaowupinbiao (row_id, item_name, quantity) VALUES (2, '药水', NULL)",
    ]);
  });

  it('值比列多 1 但列清单已含 row_id → 维持拒绝', () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    expect(() => materializeSystemRowIdsForSqlInserts_ACU([
      "INSERT INTO beibaowupinbiao (row_id, item_name, quantity) VALUES (9, '药水', 5, 'extra')",
    ], inputSnapshot)).toThrow('值数量与列数量不一致');
  });

  it('值比列多 2 及以上 → 维持拒绝', () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    expect(() => materializeSystemRowIdsForSqlInserts_ACU([
      "INSERT INTO beibaowupinbiao (item_name, quantity) VALUES (1, '药水', 5, 'extra')",
    ], inputSnapshot)).toThrow('值数量与列数量不一致');
  });

  it('WITH ... INSERT ... SELECT 有预执行器时先执行后物化（WITH 前缀不进物化结果）', () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    const seenQueries: string[] = [];
    const result = materializeSystemRowIdsForSqlInserts_ACU([
      "WITH src AS (SELECT '药水' AS n, 5 AS q) INSERT INTO beibaowupinbiao (item_name, quantity) SELECT n, q FROM src",
    ], inputSnapshot, undefined, {
      selectQueryRunner: (sql: string) => {
        seenQueries.push(sql);
        return { columns: ['n', 'q'], values: [['药水', 5]] };
      },
    });
    expect(seenQueries).toEqual(["WITH src AS (SELECT '药水' AS n, 5 AS q) SELECT n, q FROM src"]);
    expect(result).toEqual([
      "INSERT INTO beibaowupinbiao (row_id, item_name, quantity) VALUES (2, '药水', 5)",
    ]);
  });

  it('INSERT SELECT 结果为空 → 物化为空串（调用方过滤为无操作）', () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    const result = materializeSystemRowIdsForSqlInserts_ACU([
      'INSERT INTO beibaowupinbiao (item_name, quantity) SELECT n, q FROM src',
    ], inputSnapshot, undefined, {
      selectQueryRunner: () => ({ columns: [], values: [] }),
    });
    expect(result).toEqual(['']);
  });

  it('INSERT SELECT 结果超过 500 行上限 → 拒绝', () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    expect(() => materializeSystemRowIdsForSqlInserts_ACU([
      'INSERT INTO beibaowupinbiao (item_name, quantity) SELECT n, q FROM src',
    ], inputSnapshot, undefined, {
      selectQueryRunner: () => ({ columns: ['n', 'q'], values: new Array(501).fill(['x', 1]) }),
    })).toThrow('超过物化上限');
  });

  it('INSERT SELECT 结果列数与插入列清单不一致 → 拒绝', () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    expect(() => materializeSystemRowIdsForSqlInserts_ACU([
      'INSERT INTO beibaowupinbiao (item_name, quantity) SELECT n FROM src',
    ], inputSnapshot, undefined, {
      selectQueryRunner: () => ({ columns: ['n'], values: [['药水']] }),
    })).toThrow('结果列数');
  });

  it('INSERT SELECT 结果字符串含单引号时按 SQL 转义物化', () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    const result = materializeSystemRowIdsForSqlInserts_ACU([
      'INSERT INTO beibaowupinbiao (item_name, quantity) SELECT n, q FROM src',
    ], inputSnapshot, undefined, {
      selectQueryRunner: () => ({ columns: ['n', 'q'], values: [["it's", null]] }),
    });
    expect(result).toEqual([
      "INSERT INTO beibaowupinbiao (row_id, item_name, quantity) VALUES (2, 'it''s', NULL)",
    ]);
  });

  it('WITH 前缀 + VALUES 插入维持拒绝', () => {
    const inputSnapshot = JSON.parse(JSON.stringify(snapshotTableData));
    expect(() => materializeSystemRowIdsForSqlInserts_ACU([
      "WITH src AS (SELECT 1) INSERT INTO beibaowupinbiao (item_name, quantity) VALUES ('药水', 5)",
    ], inputSnapshot, undefined, {
      selectQueryRunner: () => ({ columns: [], values: [] }),
    })).toThrow('不支持 WITH 前缀的 VALUES 插入');
  });

});

describe('assertNoHiddenPhysicalColumnMutations_ACU', () => {
  const tableData: any = {
    sheet_0: {
      uid: 'inventory',
      name: '背包物品表',
      sourceData: {
        ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT, legacy_note TEXT, quantity INTEGER);',
        hiddenPhysicalColumns: ['legacy_note'],
      },
      content: [
        ['row_id', '名称', '旧备注', '数量'],
        ['1', '铁剑', '历史秘密', '3'],
      ],
    },
  };

  it('拒绝 UPDATE、INSERT 和 WHERE 引用隐藏物理列', () => {
    expect(() => assertNoHiddenPhysicalColumnMutations_ACU([
      "UPDATE inventory SET legacy_note = '改写' WHERE row_id = 1",
    ], tableData)).toThrow('不允许引用隐藏物理列');
    expect(() => assertNoHiddenPhysicalColumnMutations_ACU([
      "INSERT INTO inventory (row_id, item_name, legacy_note, quantity) VALUES (2, '药水', '秘密', 1)",
    ], tableData)).toThrow('不允许引用隐藏物理列');
    expect(() => assertNoHiddenPhysicalColumnMutations_ACU([
      "UPDATE inventory SET quantity = 4 WHERE legacy_note = '历史秘密'",
    ], tableData)).toThrow('不允许引用隐藏物理列');
  });

  it('存在隐藏列时拒绝省略 INSERT 列清单，避免按完整物理顺序写穿', () => {
    expect(() => assertNoHiddenPhysicalColumnMutations_ACU([
      "INSERT INTO inventory VALUES (2, '药水', '秘密', 1)",
    ], tableData)).toThrow('必须显式列出可见目标列');
  });

  it('允许只引用可见列，并忽略字符串与注释中的隐藏列文本', () => {
    expect(() => assertNoHiddenPhysicalColumnMutations_ACU([
      "UPDATE inventory SET quantity = quantity + 1, item_name = 'legacy_note' /* legacy_note */ WHERE row_id = 1",
      "INSERT INTO inventory (row_id, item_name, quantity) VALUES (2, '药水', 1)",
    ], tableData)).not.toThrow();
  });

  it.each([
    'UPDATE main.inventory SET legacy_note = \'改写\' WHERE row_id = 1',
    'UPDATE "main"."inventory" SET "legacy_note" = \'改写\' WHERE row_id = 1',
    'UPDATE `main`.`inventory` SET `legacy_note` = \'改写\' WHERE row_id = 1',
    'UPDATE [main].[inventory] SET [legacy_note] = \'改写\' WHERE row_id = 1',
    "INSERT INTO main.inventory (row_id, item_name, legacy_note, quantity) VALUES (2, '药水', '秘密', 1)",
    "DELETE FROM main.inventory WHERE legacy_note = '历史秘密'",
  ])('拒绝 schema-qualified 或 quoted target 对隐藏列的引用：%s', statement => {
    expect(() => assertNoHiddenPhysicalColumnMutations_ACU([statement], tableData))
      .toThrow('不允许引用隐藏物理列');
  });

  it.each([
    'REPLACE INTO inventory (item_name, quantity) VALUES (\'药水\', 1)',
    'INSERT OR REPLACE INTO inventory (item_name, quantity) VALUES (\'药水\', 1)',
    'WITH payload AS (SELECT 1) REPLACE INTO inventory (item_name, quantity) VALUES (\'药水\', 1)',
  ])('允许 REPLACE 数据变更语句：%s', statement => {
    expect(() => assertNoHiddenPhysicalColumnMutations_ACU([statement], tableData)).not.toThrow();
  });

  it.each([
    'ALTER TABLE inventory DROP COLUMN legacy_note',
    'CREATE TABLE another_table (id INTEGER)',
    'DROP TABLE inventory',
    'BEGIN',
    'COMMIT',
  ])('对 AI SQL 的非 mutation 语句 fail closed：%s', statement => {
    expect(() => assertNoHiddenPhysicalColumnMutations_ACU([statement], tableData))
      .toThrow('SQLite 填表仅允许 INSERT、REPLACE、UPDATE、DELETE 数据变更语句');
  });

  it('拒绝多语句中位于后续语句的隐藏列引用', () => {
    expect(() => assertNoHiddenPhysicalColumnMutations_ACU([
      "UPDATE inventory SET quantity = 4 WHERE row_id = 1",
      "UPDATE inventory SET legacy_note = '历史秘密' WHERE row_id = 1",
    ], tableData)).toThrow('不允许引用隐藏物理列');
  });
});

describe('buildSqlSheetBatchOperations_ACU', () => {
  const tableData: any = {
    sheet_0: { uid: 'inventory', name: '背包表', sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, value TEXT);' } },
    sheet_1: { uid: 'quest_log', name: '任务表', sourceData: { ddl: 'CREATE TABLE quest_log (row_id INTEGER PRIMARY KEY, value TEXT);' } },
  };

  it('按 SQL 表名归类为单表 sql_sheet_batch，并按相邻同表合并', () => {
    const result = buildSqlSheetBatchOperations_ACU([
      "INSERT INTO inventory VALUES (1, 'a')",
      "UPDATE inventory SET value = 'b' WHERE row_id = 1",
      "INSERT INTO quest_log VALUES (1, 'q')",
    ], tableData, { reason: 'system' });

    expect(result.operations).toEqual([
      { kind: 'sql_sheet_batch', sheetKey: 'sheet_0', statements: ["INSERT INTO inventory VALUES (1, 'a')", "UPDATE inventory SET value = 'b' WHERE row_id = 1"], tableName: 'beibaobiao', reason: 'system' },
      { kind: 'sql_sheet_batch', sheetKey: 'sheet_1', statements: ["INSERT INTO quest_log VALUES (1, 'q')"], tableName: 'renwubiao', reason: 'system' },
    ]);
    expect(result.unknownStatements).toEqual([]);
    expect(result.ambiguousStatements).toEqual([]);
  });

  it('单目标 fallback 只在显式允许时把未知 SQL 归入目标 sheet', () => {
    const result = buildSqlSheetBatchOperations_ACU(
      ['CREATE TABLE temp_table (row_id INTEGER PRIMARY KEY)'],
      tableData,
      { fallbackTargetSheetKeys: ['sheet_0'], allowSingleTargetFallback: true, reason: 'system' },
    );

    expect(result.operations).toEqual([{ kind: 'sql_sheet_batch', sheetKey: 'sheet_0', statements: ['CREATE TABLE temp_table (row_id INTEGER PRIMARY KEY)'], tableName: 'beibaobiao', reason: 'system' }]);
    expect(result.unknownStatements).toEqual(['CREATE TABLE temp_table (row_id INTEGER PRIMARY KEY)']);
  });

  it('未归属语句在不允许单表 fallback 时保留为兼容 sql_batch', () => {
    const result = buildSqlSheetBatchOperations_ACU(
      ['UPDATE untracked_table SET value = 1'],
      tableData,
      { keepLegacyForUnclassified: true, reason: 'system' },
    );

    expect(result.operations).toEqual([{ kind: 'sql_batch', statements: ['UPDATE untracked_table SET value = 1'] }]);
    expect(result.unknownStatements).toEqual(['UPDATE untracked_table SET value = 1']);
    expect(result.ambiguousStatements).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// SqlTableService 类测试
// ═══════════════════════════════════════════════════════════════
describe('SqlTableService', () => {
  let service: SqlTableService;

  // 构造测试用的 TableDataObject
  const TEST_DDL = `CREATE TABLE inventory (
    row_id INTEGER PRIMARY KEY,
    item_name TEXT NOT NULL,
    quantity INTEGER DEFAULT 1
  );`;

  const testTableData: any = {
    mate: { type: 'acu', version: 1, updateConfigUiSentinel: 0, globalInjectionConfig: { readableEntryPlacement: { position: '', depth: 0, order: 0 }, wrapperPlacement: { position: '', depth: 0, order: 0 } } },
    sheet_0: {
      uid: 'inventory',
      name: 'inventory',
      sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '', ddl: TEST_DDL },
      content: [
        ['row_id', 'item_name', 'quantity'],
        ['1', '铁剑', '3'],
        ['2', '治疗药水', '5'],
      ],
      updateConfig: { uiSentinel: 0, contextDepth: 0, updateFrequency: 0, batchSize: 0, skipFloors: 0 },
      exportConfig: {},
      orderNo: 0,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentJsonTableData = null;
    mockPublishGlobalNameMapper.mockReturnValue(true);
    mockReleaseGlobalNameMapper.mockReturnValue(true);
    mockPublishGlobalNameMapperEmptySchema.mockReturnValue(true);
    // 重置 mock 返回值，防止测试之间的状态泄漏
    mockGetEffectiveSeedRows.mockReturnValue([]);
    mockGetCurrentChatTemplateScopeState.mockReturnValue(null);
    mockShouldUseInitialSeedRows.mockReturnValue(false);
    mockSeedGreetingLocalData.mockResolvedValue(false);
    mockGetTemplatePreset.mockReturnValue(null);
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue(null);
    service = new SqlTableService();
  });

  afterAll(() => {
    // 确保清理
    try { service?.dispose(); } catch (_) {}
  });

  // ═══════════════════════════════════════════════════════════════
  // _ensureInitialized（通过公开方法间接测试）
  // ═══════════════════════════════════════════════════════════════
  describe('未初始化时的行为', () => {
    it('applyEdits 未初始化时抛出错误', () => {
      expect(() => service.applyEdits('INSERT INTO t VALUES (1)')).toThrow('SQLite 引擎未初始化');
    });

    it('executeQuery 未初始化时抛出错误', () => {
      expect(() => service.executeQuery('SELECT 1')).toThrow('SQLite 引擎未初始化');
    });

    it('executeMutation 未初始化时抛出错误', () => {
      expect(() => service.executeMutation('INSERT INTO t VALUES (1)')).toThrow('SQLite 引擎未初始化');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // loadFromChat
  // ═══════════════════════════════════════════════════════════════
  describe('loadFromChat', () => {
    it('无数据且无可解析模板时返回 empty', async () => {
      mockMergeAll.mockResolvedValue(null);
      const result = await service.loadFromChat();
      expect(result.loaded).toBe(false);
      expect(result.source).toBe('empty');
    });

    it('无数据且无可解析模板时标记空 schema，不留下未绑定的 mapper', async () => {
      mockMergeAll.mockResolvedValue(null);

      const result = await service.loadFromChat();

      // runtime 已就绪但没有任何表。必须显式标记空 schema，
      // 否则同步读门禁会把正常的新聊天误报成 mapper 意外丢失。
      expect(result.source).toBe('empty');
      expect(service.isReady()).toBe(true);
      expect(mockPublishGlobalNameMapperEmptySchema).toHaveBeenCalledTimes(1);
      expect(mockPublishGlobalNameMapper).not.toHaveBeenCalled();
    });

    it('loadFromData(null) 空 schema 契约：loaded=false/source=empty/error 未定义/isReady=true，empty-schema mapper 已发布', async () => {
      const result = await service.loadFromData(null);

      expect(result).toEqual({ loaded: false, source: 'empty' });
      expect(result.error).toBeUndefined();
      expect(service.isReady()).toBe(true);
      expect(mockPublishGlobalNameMapperEmptySchema).toHaveBeenCalledTimes(1);
      expect(mockPublishGlobalNameMapper).not.toHaveBeenCalled();
    });



    it('首个用户消息后、首个真实 AI 回复前将模板 seedRows 写入运行时 SQLite，支持首次 SQL 读取', async () => {
      mockShouldUseInitialSeedRows.mockReturnValue(true);
      mockMergeAll.mockResolvedValue(null);
      const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
      vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
        mate: { type: 'acu', version: 1 },
        sheet_0: {
          uid: 'inventory',
          name: 'inventory',
          sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '', ddl: TEST_DDL },
          content: [
            ['row_id', 'item_name', 'quantity'],
            ['1', '铁剑', '3'],
            ['2', '治疗药水', '5'],
          ],
          updateConfig: {},
          exportConfig: {},
          orderNo: 0,
        },
      } as any);

      const result = await service.loadFromChat();
      expect(mockSeedGreetingLocalData).not.toHaveBeenCalled();
      expect(result.loaded).toBe(true);
      expect(result.source).toBe('initialized');
      const queryResult = service.executeQuery('SELECT * FROM inventory ORDER BY row_id');
      expect(queryResult.rowCount).toBe(2);
      expect(queryResult.values[0]).toContain('铁剑');
    });


    it('仅有基底状态数据时也写入运行时 SQLite，但不保留内部标记', async () => {
      const baseStateData = JSON.parse(JSON.stringify(testTableData));
      baseStateData.sheet_0._acu_from_base_state = true;
      mockMergeAll.mockResolvedValue(baseStateData);

      const result = await service.loadFromChat();
      expect(result.loaded).toBe(true);
      expect(result.source).toBe('initialized');
      const queryResult = service.executeQuery('SELECT * FROM inventory ORDER BY row_id');
      expect(queryResult.rowCount).toBe(2);
      expect((mockCurrentJsonTableData as any).sheet_0._acu_from_base_state).toBeUndefined();
    });

    it('有数据时成功加载', async () => {
      mockMergeAll.mockResolvedValue(JSON.parse(JSON.stringify(testTableData)));
      const result = await service.loadFromChat();
      expect(result.loaded).toBe(true);
      expect(result.source).toBe('merged');
    });

    it('从显式 canonical 快照 hydrate 时不再次回放聊天，且 SQL 基底与快照一致', async () => {
      const canonicalData = JSON.parse(JSON.stringify(testTableData));
      mockMergeAll.mockResolvedValue(null);

      const result = await service.loadFromData(canonicalData);

      expect(result).toEqual({ loaded: true, source: 'merged' });
      expect(mockMergeAll).not.toHaveBeenCalled();
      expect(service.isReady()).toBe(true);
      expect(service.executeQuery('SELECT * FROM inventory ORDER BY row_id').rowCount).toBe(2);
      service.applyEdits("UPDATE inventory SET quantity = 9 WHERE row_id = 1;");
      expect(service.executeQuery('SELECT quantity FROM inventory WHERE row_id = 1').values).toEqual([[9]]);
      expect(canonicalData.sheet_0.content[1]).toEqual(['1', '铁剑', '3']);
    });

    it('从错序旧 chronicle snapshot hydrate 后保持 SQLite ready 与字段语义', async () => {
      const canonicalData = JSON.parse(JSON.stringify(testTableData));
      canonicalData.sheet_0.uid = 'chronicle';
      canonicalData.sheet_0.name = '纪要表';
      canonicalData.sheet_0.sourceData.ddl = `CREATE TABLE chronicle (
  row_id INTEGER PRIMARY KEY, -- 行号
  code_index TEXT NOT NULL, -- 编码索引
  chronicle_text TEXT NOT NULL -- 纪要
);`;
      canonicalData.sheet_0.content = [
        ['row_id', '纪要', '编码索引'],
        ['1', '完整纪要正文', 'AM0001'],
      ];

      const result = await service.loadFromData(canonicalData);

      expect(result).toEqual({ loaded: true, source: 'merged' });
      expect(service.isReady()).toBe(true);
      expect(service.executeQuery('SELECT code_index, chronicle_text FROM jiyaobiao WHERE row_id = 1').values).toEqual([
        ['AM0001', '完整纪要正文'],
      ]);
      expect(canonicalData.sheet_0.content[1]).toEqual(['1', '完整纪要正文', 'AM0001']);
    });

    it('strict hydrate 遇到非空未映射旧字段时清理 runtime 并保持 not ready', async () => {
      const invalidData = JSON.parse(JSON.stringify(testTableData));
      invalidData.sheet_0.content = [
        ['row_id', 'item_name', 'quantity', '旧字段'],
        ['1', '铁剑', '3', '不能丢失'],
      ];

      const result = await service.loadFromData(invalidData);

      expect(result.loaded).toBe(false);
      expect(result.error).toContain('sqlite_hydrate_failed');
      expect(service.isReady()).toBe(false);
      expect(invalidData.sheet_0.content[1]).toEqual(['1', '铁剑', '3', '不能丢失']);
    });

    it('runtime load 遇到非法显式 DDL 时使用 fallback，且不修改调用方原始 DDL', async () => {
      const invalidData = JSON.parse(JSON.stringify(testTableData));
      invalidData.sheet_0.sourceData.ddl = 'CREATE TABLE broken (';

      const result = await service.loadFromData(invalidData);

      expect(result).toEqual({ loaded: true, source: 'merged' });
      expect(service.isReady()).toBe(true);
      expect(service.executeQuery('SELECT item_name, quantity FROM inventory ORDER BY row_id').values).toEqual([
        ['铁剑', '3'], ['治疗药水', '5'],
      ]);
      expect(invalidData.sheet_0.sourceData.ddl).toBe('CREATE TABLE broken (');
    });

    it('loadFromData 重置 runtime 时先使旧 mapper 失效，再按新 schema 重建', async () => {
      const canonicalData = JSON.parse(JSON.stringify(testTableData));

      await service.loadFromData(canonicalData);

      expect(mockReleaseGlobalNameMapper).toHaveBeenCalledBefore(mockPublishGlobalNameMapper);
      expect(mockPublishGlobalNameMapper).toHaveBeenLastCalledWith(expect.any(Map), expect.anything());
    });

    it('映射发布被更新 runtime 拒绝时，hydrate 必须失败而不是宣称就绪', async () => {
      mockPublishGlobalNameMapper.mockReturnValue(false);
      const canonicalData = JSON.parse(JSON.stringify(testTableData));

      const result = await service.loadFromData(canonicalData);

      expect(result.loaded).toBe(false);
      expect(result.error).toContain('name_mapper_publish_rejected');
      // 没有可信映射时中文表名/列名会被原样下发给 SQLite，绝不能对外 ready。
      expect(service.isReady()).toBe(false);
    });

    it('空 schema 标记被拒绝时同样不得宣称就绪', async () => {
      mockPublishGlobalNameMapperEmptySchema.mockReturnValue(false);
      mockMergeAll.mockResolvedValue(null);

      const result = await service.loadFromData(null);

      expect(result.loaded).toBe(false);
      expect(result.error).toContain('name_mapper_publish_rejected');
      expect(service.isReady()).toBe(false);
    });

    it('加载后可以执行查询', async () => {
      mockMergeAll.mockResolvedValue(JSON.parse(JSON.stringify(testTableData)));
      await service.loadFromChat();
      const queryResult = service.executeQuery('SELECT * FROM inventory');
      expect(queryResult.rowCount).toBe(2);
      expect(queryResult.columns).toContain('item_name');
    });

    it('加载失败时返回错误信息', async () => {
      mockMergeAll.mockRejectedValue(new Error('网络错误'));
      const result = await service.loadFromChat();
      expect(result.loaded).toBe(false);
      expect(result.error).toContain('网络错误');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // applyEdits
  // ═══════════════════════════════════════════════════════════════
  describe('applyEdits', () => {
    beforeEach(async () => {
      mockMergeAll.mockResolvedValue(JSON.parse(JSON.stringify(testTableData)));
      await service.loadFromChat();
    });

    it('执行单条 INSERT 语句', () => {
      const result = service.applyEdits("INSERT INTO inventory VALUES (3, '魔法书', 1);");
      expect(result.success).toBe(true);
      expect(result.appliedEdits).toBe(1);
      // 验证数据确实插入了
      const query = service.executeQuery('SELECT * FROM inventory WHERE row_id = 3');
      expect(query.rowCount).toBe(1);
    });

    it('执行多条语句', () => {
      const sql = "INSERT INTO inventory VALUES (3, '魔法书', 1); UPDATE inventory SET quantity = 10 WHERE row_id = 1;";
      const result = service.applyEdits(sql);
      expect(result.success).toBe(true);
      expect(result.appliedEdits).toBe(2);
    });

    it('部分运行时快照补建其它模板表后，applyEdits 会在 provider 边界重绑定 DDL 表名', async () => {
      const partialData = JSON.parse(JSON.stringify(testTableData));
      const templateData = {
        ...JSON.parse(JSON.stringify(testTableData)),
        sheet_1: {
          uid: 'story_chronicle',
          name: 'storychronicle',
          sourceData: {
            ddl: 'CREATE TABLE story_chronicle (row_id INTEGER PRIMARY KEY, title TEXT NOT NULL);',
          },
          content: [['row_id', 'title']],
          updateConfig: {},
          exportConfig: {},
          orderNo: 1,
        },
      };
      mockGetCurrentChatTemplateScopeState.mockReturnValue({
        mode: 'chat_override',
        templateStr: JSON.stringify(templateData),
      });
      await service.loadFromData(partialData);

      const result = service.applyEdits("INSERT INTO story_chronicle (row_id, title) VALUES (1, '归家之拥');");

      expect(result.success).toBe(true);
      expect(result.modifiedKeys).toContain('sheet_1');
      expect(service.executeQuery('SELECT title FROM storychronicle WHERE row_id = 1').values).toEqual([['归家之拥']]);
    });

    it('批量提交中已有表与模板新表混合写入时，每条语句都在 provider 边界完成重绑定', async () => {
      const partialData = JSON.parse(JSON.stringify(testTableData));
      const templateData = {
        ...JSON.parse(JSON.stringify(testTableData)),
        sheet_1: {
          uid: 'story_chronicle',
          name: 'storychronicle',
          sourceData: {
            ddl: 'CREATE TABLE story_chronicle (row_id INTEGER PRIMARY KEY, title TEXT NOT NULL);',
          },
          content: [['row_id', 'title']],
          updateConfig: {},
          exportConfig: {},
          orderNo: 1,
        },
      };
      mockGetCurrentChatTemplateScopeState.mockReturnValue({
        mode: 'chat_override',
        templateStr: JSON.stringify(templateData),
      });
      await service.loadFromData(partialData);

      const result = service.applyEditsBatch([
        "INSERT INTO inventory VALUES (3, '魔法书', 1);",
        "INSERT INTO story_chronicle (row_id, title) VALUES (1, '归家之拥');",
      ]);

      expect(result.success).toBe(true);
      expect(result.appliedEdits).toBe(2);
      expect(result.modifiedKeys).toEqual(expect.arrayContaining(['sheet_0', 'sheet_1']));
      expect(service.executeQuery('SELECT item_name FROM inventory WHERE row_id = 3').values).toEqual([['魔法书']]);
      expect(service.executeQuery('SELECT title FROM storychronicle WHERE row_id = 1').values).toEqual([['归家之拥']]);
    });

    it('部分运行时快照补建其它模板表后，executeMutation 同样重绑定 DDL 表名', async () => {
      const partialData = JSON.parse(JSON.stringify(testTableData));
      const templateData = {
        ...JSON.parse(JSON.stringify(testTableData)),
        sheet_1: {
          uid: 'history_summary',
          name: 'historysummary',
          sourceData: {
            ddl: 'CREATE TABLE lishijiyaobiao (row_id INTEGER PRIMARY KEY, summary TEXT NOT NULL);',
          },
          content: [['row_id', 'summary']],
          updateConfig: {},
          exportConfig: {},
          orderNo: 1,
        },
      };
      mockGetCurrentChatTemplateScopeState.mockReturnValue({
        mode: 'chat_override',
        templateStr: JSON.stringify(templateData),
      });
      await service.loadFromData(partialData);

      const result = service.executeMutation(
        "INSERT INTO lishijiyaobiao (row_id, summary) VALUES (?, ?)",
        [1, '玄关重逢'],
      );

      expect(result).toEqual({ changes: 1, errors: [] });
      expect(service.executeQuery('SELECT summary FROM historysummary WHERE row_id = 1').values).toEqual([['玄关重逢']]);
    });

    it('同一组 SQL 修改多张表时，后续表失败会回滚前面表的写入', async () => {
      const weaponDDL = `CREATE TABLE weapon_log (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);`;
      const questDDL = `CREATE TABLE quest_log (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);`;
      const data = {
        mate: { type: 'acu', version: 1 },
        sheet_0: { uid: 'inventory', name: 'inventory', sourceData: { ddl: TEST_DDL }, content: [['row_id', 'item_name', 'quantity'], ['1', '铁剑', '3']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
        sheet_1: { uid: 'weapon_log', name: 'weaponlog', sourceData: { ddl: weaponDDL }, content: [['row_id', 'value']], updateConfig: {}, exportConfig: {}, orderNo: 1 },
        sheet_2: { uid: 'quest_log', name: 'questlog', sourceData: { ddl: questDDL }, content: [['row_id', 'value']], updateConfig: {}, exportConfig: {}, orderNo: 2 },
      };
      mockMergeAll.mockResolvedValue(JSON.parse(JSON.stringify(data)));
      await service.loadFromChat();

      expect(() => service.applyEdits([
        "INSERT INTO weaponlog VALUES (1, 'A表已写');",
        "INSERT INTO questlog VALUES (1, 'B表已写');",
        "INSERT INTO inventory (missing_col) VALUES ('C表报错');",
      ].join('\n'))).toThrow();

      expect(service.executeQuery('SELECT COUNT(*) FROM weaponlog').values[0][0]).toBe(0);
      expect(service.executeQuery('SELECT COUNT(*) FROM questlog').values[0][0]).toBe(0);
    });

    it('空字符串返回成功（无操作）', () => {
      const result = service.applyEdits('');
      expect(result.success).toBe(true);
      expect(result.appliedEdits).toBe(0);
    });

    it('纯空白返回成功（无操作）', () => {
      const result = service.applyEdits('   \n\t  ');
      expect(result.success).toBe(true);
      expect(result.appliedEdits).toBe(0);
    });

    it('去除 HTML 注释标记', () => {
      const sql = "<!-- INSERT INTO inventory VALUES (3, '魔法书', 1); -->";
      const result = service.applyEdits(sql);
      expect(result.success).toBe(true);
      expect(result.appliedEdits).toBe(1);
    });

    it('SQL 语法错误时抛出异常', () => {
      expect(() => service.applyEdits('INVALID SQL SYNTAX HERE;')).toThrow();
    });

    it('返回受影响的 modifiedKeys', () => {
      // 设置 currentJsonTableData 以便 _tableNamesToSheetKeys 能工作
      mockCurrentJsonTableData = JSON.parse(JSON.stringify(testTableData));
      const result = service.applyEdits("UPDATE inventory SET quantity = 10 WHERE row_id = 1;");
      expect(result.modifiedKeys).toContain('sheet_0');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // [阶段 E] AI 写路径不再 reseed：seed 物化由 loadFromData 建表路径完成，
  // applyEdits 只执行用户 SQL，空表保持空，等待 AI 初始化（避免双写 UNIQUE 业务键）。
  // ═══════════════════════════════════════════════════════════════
  describe('applyEdits 不再在写路径 reseed', () => {
    beforeEach(async () => {
      mockMergeAll.mockResolvedValue(JSON.parse(JSON.stringify(testTableData)));
      await service.loadFromChat();
    });

    it('DELETE 全表后 UPDATE 不自动回灌，直接作用于空表', () => {
      const deleteResult = service.applyEdits('DELETE FROM inventory;');
      expect(deleteResult.success).toBe(true);

      const emptyQuery = service.executeQuery('SELECT COUNT(*) AS cnt FROM inventory');
      expect(emptyQuery.values[0][0]).toBe(0);

      mockGetEffectiveSeedRows.mockReturnValue([
        ['1', '铁剑', '3'],
        ['2', '治疗药水', '5'],
      ]);

      // 表为空，UPDATE 命中 0 行；seedRows 不应被自动回灌
      const result = service.applyEdits("UPDATE inventory SET quantity = 10 WHERE item_name = '铁剑';");
      expect(result.success).toBe(true);

      const queryResult = service.executeQuery('SELECT * FROM inventory ORDER BY row_id');
      expect(queryResult.rowCount).toBe(0);
    });

    it('非空表不触发 reseed', () => {
      mockGetEffectiveSeedRows.mockReturnValue([
        ['99', '不应出现的物品', '999'],
      ]);

      const result = service.applyEdits("UPDATE inventory SET quantity = 10 WHERE row_id = 1;");
      expect(result.success).toBe(true);

      const queryResult = service.executeQuery('SELECT * FROM inventory ORDER BY row_id');
      expect(queryResult.rowCount).toBe(2);
      const allItems = queryResult.values.map((r: any) => r[1]);
      expect(allItems).not.toContain('不应出现的物品');
    });

    it('无 seedRows 的表不触发 reseed', () => {
      service.applyEdits('DELETE FROM inventory;');
      mockGetEffectiveSeedRows.mockReturnValue([]);

      const result = service.applyEdits("UPDATE inventory SET quantity = 10 WHERE row_id = 1;");
      expect(result.success).toBe(true);

      const queryResult = service.executeQuery('SELECT COUNT(*) AS cnt FROM inventory');
      expect(queryResult.values[0][0]).toBe(0);
    });

    it('空表 + 有 seedRows 时写路径不 reseed，INSERT 由 AI 自行初始化', () => {
      service.applyEdits('DELETE FROM inventory;');
      mockGetEffectiveSeedRows.mockReturnValue([
        ['1', '铁剑', '3'],
      ]);

      // AI 写路径不前置 reseed，INSERT 正常执行（不再与 seedRows 双写）
      const result = service.applyEdits("INSERT INTO inventory (item_name, quantity) VALUES ('新物品', 1);");
      expect(result.success).toBe(true);

      const queryResult = service.executeQuery('SELECT COUNT(*) AS cnt FROM inventory');
      expect(queryResult.values[0][0]).toBe(1);
    });
  });

  describe('applyEditsWithSystemRowIds', () => {
    beforeEach(async () => {
      mockMergeAll.mockResolvedValue(JSON.parse(JSON.stringify(testTableData)));
      await service.loadFromChat();
      service.applyEdits('DELETE FROM inventory;');
      mockGetEffectiveSeedRows.mockReturnValue([
        ['1', '铁剑', '3'],
      ]);
    });

    it('[阶段 E] 空表不再由写路径补种，AI INSERT 从 row_id=1 开始分配', () => {
      const result = service.applyEditsWithSystemRowIds([
        "INSERT INTO inventory (row_id, item_name, quantity) VALUES (999, '魔法书', 1);",
        "INSERT INTO inventory (row_id, item_name, quantity) VALUES (888, '卷轴', 2);",
      ]);

      expect(result.success).toBe(true);
      expect(result.appliedEdits).toBe(2);
      expect(result.materializedSqlTexts).toHaveLength(2);
      expect(result.materializedSqlTexts[0]).toContain("VALUES (1, '魔法书', 1)");
      expect(result.materializedSqlTexts[0]).not.toContain('999');
      expect(result.materializedSqlTexts[1]).toContain("VALUES (2, '卷轴', 2)");
      expect(result.materializedSqlTexts[1]).not.toContain('888');

      const queryResult = service.executeQuery('SELECT row_id, item_name FROM inventory ORDER BY row_id');
      expect(queryResult.values).toEqual([
        [1, '魔法书'],
        [2, '卷轴'],
      ]);
      expect(result.tableData.sheet_0.content).toEqual([
        ['row_id', 'item_name', 'quantity'],
        ['1', '魔法书', '1'],
        ['2', '卷轴', '2'],
      ]);
    });

    it('非首列空业务表头的模板表在 SQL 活动快照中休眠：不进 activeSheetKeys，不阻塞有效表', () => {
      const originalChat = [{ mes: 'chat-scope-capture' }];
      const mixedTemplate = {
        mate: { type: 'acu', version: 1 },
        sheet_valid: {
          uid: 'valid_table',
          name: '有效表',
          sourceData: {
            ddl: 'CREATE TABLE valid_table (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);',
          },
          content: [['row_id', 'value']],
          updateConfig: {},
          exportConfig: {},
          orderNo: 1,
        },
        sheet_dormant: {
          uid: 'dormant_table',
          name: '空表头表',
          sourceData: {
            ddl: 'CREATE TABLE dormant_table (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);',
          },
          content: [['row_id', '', '']], // 第 2、3 列空业务表头
          updateConfig: {},
          exportConfig: {},
          orderNo: 2,
        },
      } as any;
      mockGetCurrentChatTemplateScopeState.mockImplementation(() => ({
        mode: 'chat_override',
        templateStr: JSON.stringify(mixedTemplate),
      }));
      mockGetEffectiveSeedRows.mockReturnValue([]);

      const capturedScope = captureSqlTableApplyScope_ACU({ chat: originalChat, isolationKey: 'scope-dormant' });

      // 有效表保留，休眠表剔除
      expect(capturedScope.activeSheetKeys).toEqual(['sheet_valid']);
      expect(capturedScope.templateData.sheet_valid).toBeDefined();
      expect(capturedScope.templateData.sheet_dormant).toBeUndefined();
      expect(capturedScope.templateDataWithRows.sheet_dormant).toBeUndefined();
      // 脱敏诊断：只含 sheetKey / 显示名 / 空列序号
      expect(capturedScope.skippedSheets).toEqual([
        { sheetKey: 'sheet_dormant', name: '空表头表', emptyHeaderIndexes: [2, 3] },
      ]);
    });

    it('全部模板表均非首列空表头时，SQL 活动快照为空集而非 null，且不丢元数据', () => {
      const originalChat = [{ mes: 'chat-scope-all-dormant' }];
      const allDormantTemplate = {
        mate: { type: 'acu', version: 1 },
        sheet_a: {
          uid: 'dormant_a',
          name: '空表头A',
          sourceData: { ddl: 'CREATE TABLE dormant_a (row_id INTEGER PRIMARY KEY, value TEXT);' },
          content: [['row_id', '']],
          updateConfig: {},
          exportConfig: {},
          orderNo: 1,
        },
        sheet_b: {
          uid: 'dormant_b',
          name: '空表头B',
          sourceData: { ddl: 'CREATE TABLE dormant_b (row_id INTEGER PRIMARY KEY, value TEXT);' },
          content: [['row_id', null]], // 首列占位合法，第 2 列 null
          updateConfig: {},
          exportConfig: {},
          orderNo: 2,
        },
      } as any;
      mockGetCurrentChatTemplateScopeState.mockImplementation(() => ({
        mode: 'chat_override',
        templateStr: JSON.stringify(allDormantTemplate),
      }));
      mockGetEffectiveSeedRows.mockReturnValue([]);

      const capturedScope = captureSqlTableApplyScope_ACU({ chat: originalChat, isolationKey: 'scope-all-dormant' });

      // 空 activeSheetKeys 表示“已知无活动表”，不是 null（null 表示范围未知、不过滤）
      expect(capturedScope.activeSheetKeys).toEqual([]);
      expect(capturedScope.templateData.mate).toEqual({ type: 'acu', version: 1 });
      expect(capturedScope.templateData.sheet_a).toBeUndefined();
      expect(capturedScope.templateData.sheet_b).toBeUndefined();
      expect(capturedScope.skippedSheets.map(s => s.sheetKey).sort()).toEqual(['sheet_a', 'sheet_b']);
    });
    it('AI 等待期间切换聊天模板后，提交仍使用请求前捕获的建表与别名快照', () => {
      const originalChat = [{ mes: 'chat-a' }];
      const switchedChat = [{ mes: 'chat-b' }];
      const originalTemplate = {
        mate: { type: 'acu', version: 1 },
        sheet_memory: {
          uid: 'memory_summary',
          name: '记忆概要表',
          sourceData: {
            ddl: 'CREATE TABLE memory_summary (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);',
          },
          content: [['row_id', 'value']],
          updateConfig: {},
          exportConfig: {},
          orderNo: 1,
        },
      } as any;
      const switchedTemplate = {
        mate: { type: 'acu', version: 1 },
        sheet_other: {
          uid: 'other_table',
          name: '其他表',
          sourceData: {
            ddl: 'CREATE TABLE other_table (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);',
          },
          content: [['row_id', 'value']],
          updateConfig: {},
          exportConfig: {},
          orderNo: 1,
        },
      } as any;
      mockGetCurrentChatTemplateScopeState.mockImplementation(({ chat }: any = {}) => ({
        mode: 'chat_override',
        templateStr: JSON.stringify(chat === originalChat ? originalTemplate : switchedTemplate),
      }));

      mockGetEffectiveSeedRows.mockReturnValue([]);
      const capturedScope = captureSqlTableApplyScope_ACU({ chat: originalChat, isolationKey: 'scope-a' });
      // 模拟 AI await 期间全局聊天已切到 chat-b。若提交仍走隐式全局 fallback，
      // memory_summary 不会建表，下面的 INSERT 会以 no such table 失败。
      mockGetCurrentChatTemplateScopeState.mockImplementation(() => ({
        mode: 'chat_override',
        templateStr: JSON.stringify(switchedTemplate),
      }));

      const result = service.applyEditsWithSystemRowIds([
        "INSERT INTO memory_summary (value) VALUES ('请求前模板仍生效');",
      ], 'auto_standard', capturedScope);

      expect(result.success).toBe(true);
      expect(result.materializedSqlTexts[0]).toContain('jiyigaiyaobiao');
      expect(service.executeQuery('SELECT value FROM jiyigaiyaobiao').values).toContainEqual(['请求前模板仍生效']);
      expect(() => service.executeQuery('SELECT * FROM qitabiao')).toThrow();
      expect(mockGetCurrentChatTemplateScopeState).toHaveBeenCalledWith({ chat: originalChat, isolationKey: 'scope-a' });
      expect(switchedChat).toEqual([{ mes: 'chat-b' }]);
    });

    it('提交前 finalize 严格导出失败时回滚补种与 AI SQL', () => {
      const syncBridge = (service as any).syncBridge;
      const originalExport = syncBridge.exportToTableData.bind(syncBridge);
      const exportSpy = vi.spyOn(syncBridge, 'exportToTableData');
      exportSpy
        .mockImplementationOnce((mate: any) => originalExport(mate))
        .mockImplementationOnce(() => { throw new Error('export boom'); });

      expect(() => service.applyEditsWithSystemRowIds([
        "INSERT INTO inventory (row_id, item_name, quantity) VALUES (999, '不应写入', 1);",
      ])).toThrow(SqlRuntimeSnapshotError_ACU);

      exportSpy.mockRestore();
      expect(service.executeQuery('SELECT COUNT(*) AS cnt FROM inventory').values[0][0]).toBe(0);
      expect(service.getCurrentData()?.sheet_0.content).toEqual([
        ['row_id', 'item_name', 'quantity'],
      ]);
    });

    // test31 复现矩阵：无 DDL fallback 表写错列。
    // 阶段 E 修复后：rebind 对 registry 未知 INSERT 列执行前抛
    // SQL_INSERT_UNKNOWN_COLUMN_ACU（结构化拒绝），错误只含表名/列名/允许列，
    // 不含 VALUES 与完整 SQL；零 SQLite mutation。
    it('test31 无 DDL fallback 表：未知列必须在 SQLite mutation 前结构化拒绝，数据库内容不变且错误脱敏', () => {
      // 构造无 DDL 的 inventory（fallback 列：row_id/item_name/quantity），
      // AI 拼写漂移写 xiang_xiang_guan_wu_pin / di_di_an_lei_xing 属于未知列。
      mockMergeAll.mockResolvedValue({
        mate: { type: 'acu', version: 1 },
        sheet_0: {
          uid: 'inventory',
          name: '背包物品表',
          sourceData: {},
          content: [['row_id', 'item_name', 'quantity'], ['1', '铁剑', '3']],
          updateConfig: {},
          exportConfig: {},
          orderNo: 0,
        },
      } as any);
      service.applyEditsWithSystemRowIds(['DELETE FROM inventory;']);

      const unknownColumn = 'xi_xiang_guan_wu_pin';
      let caughtError: unknown;
      try {
        service.applyEditsWithSystemRowIds([
          `INSERT INTO inventory (${unknownColumn}) VALUES ('错误列');`,
        ]);
      } catch (error: any) {
        caughtError = error;
      }
      expect(caughtError).toBeTruthy();
      // 阶段 E：执行前结构化拒绝，错误码必须是 SQL_INSERT_UNKNOWN_COLUMN_ACU。
      const message = caughtError instanceof Error ? caughtError.message : String(caughtError);
      expect(message).toContain('SQL_INSERT_UNKNOWN_COLUMN_ACU');
      // 脱敏：错误不得含 VALUES 里的业务值（'错误列'），也不得含完整 SQL。
      expect(message).not.toContain('错误列');
      expect(message).not.toContain('INSERT INTO');

      // 无论采用哪种拒绝路径，数据库内容必须保持原样：零 mutation。
      const count = service.executeQuery('SELECT COUNT(*) AS cnt FROM inventory').values[0][0];
      expect(count).toBe(0);
      expect(service.getCurrentData()?.sheet_0.content).toEqual([
        ['row_id', 'item_name', 'quantity'],
      ]);

    });
    it('冻结 schema 与 live SQLite 一致时正常执行（runtime schema digest 一致路径）', async () => {
      mockGetCurrentChatTemplateScopeState.mockReturnValue({
        mode: 'chat_override',
        templateStr: JSON.stringify({
          mate: { type: 'acu', version: 1 },
          sheet_0: {
            uid: 'inventory', name: 'inventory',
            sourceData: { ddl: TEST_DDL },
            content: [['row_id', 'item_name', 'quantity']],
            updateConfig: {}, exportConfig: {}, orderNo: 0,
          },
        }),
      });
      const runtimeData = service.getCurrentData() as any;
      expect(runtimeData?.sheet_0?._acu_runtimeEffectiveSchema).toBeDefined();
      const scope = captureSqlTableApplyScope_ACU({
        chat: [{ mes: 'stale-normal' }],
        isolationKey: 'stale-normal',
        runtimeData,
      });
      expect(scope.runtimeSchema?.digest).toBeTruthy();

      const result = service.applyEditsWithSystemRowIds([
        "INSERT INTO inventory (row_id, item_name, quantity) VALUES (900, '一致路径写入', 1);",
      ], 'auto_standard', scope);

      expect(result.success).toBe(true);
      expect(result.appliedEdits).toBe(1);
      expect(service.executeQuery("SELECT COUNT(*) AS cnt FROM inventory WHERE item_name = '一致路径写入'").values[0][0]).toBe(1);
    });

    it('AI 等待期间 live SQLite schema 漂移时提交前 fail-closed：抛 SQL_RUNTIME_SCHEMA_STALE_ACU 且零 mutation', async () => {
      // 顶层 utils mock 把 hashUserInput_ACU 固定成常量 digest，无法区分 schema 差异。
      // 本测试临时改为基于输入的可变 digest，验证后立即恢复，避免影响其他测试。
      const utilsModule = await import('../../../src/shared/utils');
      const originalHashImpl = (utilsModule as any).hashUserInput_ACU.getMockImplementation();
      (utilsModule as any).hashUserInput_ACU.mockImplementation((text: string) => (text ? `digest:${text}` : ''));

      mockGetCurrentChatTemplateScopeState.mockReturnValue({
        mode: 'chat_override',
        templateStr: JSON.stringify({
          mate: { type: 'acu', version: 1 },
          sheet_0: {
            uid: 'inventory', name: 'inventory',
            sourceData: { ddl: TEST_DDL },
            content: [['row_id', 'item_name', 'quantity']],
            updateConfig: {}, exportConfig: {}, orderNo: 0,
          },
        }),
      });
      const runtimeData = service.getCurrentData() as any;
      const scope = captureSqlTableApplyScope_ACU({
        chat: [{ mes: 'stale-drift' }],
        isolationKey: 'stale-drift',
        runtimeData,
      });
      const frozenDigest = scope.runtimeSchema?.digest;
      expect(frozenDigest).toBeTruthy();

      // 模拟 AI 请求等待期间另一实例/用户修改了 live SQLite schema：
      // 重新 load 一份「DDL 增加新列」的数据，刷新 runtime descriptor → digest 变化。
      const driftedData = JSON.parse(JSON.stringify(await mockMergeAll()));
      driftedData.sheet_0.sourceData.ddl = `CREATE TABLE inventory (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  item_name TEXT, -- 物品名\n  quantity INTEGER, -- 数量\n  extra_col TEXT -- 新增列\n);`;
      driftedData.sheet_0.content = [
        ['row_id', '物品名', '数量', '新增列'],
        ['1', '铁剑', '3', 'x'],
      ];
      const reload = await service.loadFromData(driftedData);
      expect(reload.loaded).toBe(true);
      // 诊断：reload 后 live descriptor 的 digest 应与冻结 digest 不同。
      const afterReloadData = service.getCurrentData() as any;
      const afterReloadScope = captureSqlTableApplyScope_ACU({
        chat: [{ mes: 'stale-drift-after' }],
        isolationKey: 'stale-drift-after',
        runtimeData: afterReloadData,
      });
      expect(afterReloadScope.runtimeSchema?.digest).not.toBe(frozenDigest);

      let caught: unknown;
      try {
        service.applyEditsWithSystemRowIds([
          "INSERT INTO inventory (item_name, quantity) VALUES ('不应写入', 1);",
        ], 'auto_standard', scope);
      } catch (error: any) {
        caught = error;
      } finally {
        // 确保无论断言结果如何都恢复 hash mock，避免泄漏到后续测试。
        (utilsModule as any).hashUserInput_ACU.mockImplementation(originalHashImpl);
      }

      expect(caught).toBeInstanceOf(SqlRuntimeSchemaStaleError_ACU);
      expect(caught instanceof Error && String((caught as any).code)).toBe('SQL_RUNTIME_SCHEMA_STALE_ACU');
      // 零 mutation：stale gate 阻止了本轮 AI SQL 写入（reload 自带的数据行不算）。
      expect(service.executeQuery('SELECT COUNT(*) AS cnt FROM inventory WHERE item_name = \'不应写入\'').values[0][0]).toBe(0);
      expect(service.executeQuery('SELECT COUNT(*) AS cnt FROM inventory').values[0][0]).toBe(1);
    });
  });
  // ═══════════════════════════════════════════════════════════════
  // executeQuery
  // ═══════════════════════════════════════════════════════════════
  describe('executeQuery', () => {
    beforeEach(async () => {
      mockMergeAll.mockResolvedValue(JSON.parse(JSON.stringify(testTableData)));
      await service.loadFromChat();
    });

    it('执行 SELECT 查询', () => {
      const result = service.executeQuery('SELECT item_name, quantity FROM inventory');
      expect(result.columns).toEqual(['item_name', 'quantity']);
      expect(result.rowCount).toBe(2);
      expect(result.values[0]).toEqual(['铁剑', 3]);
    });

    it('带参数的查询', () => {
      const result = service.executeQuery('SELECT * FROM inventory WHERE item_name = ?', ['铁剑']);
      expect(result.rowCount).toBe(1);
    });

    it('无结果的查询', () => {
      const result = service.executeQuery("SELECT * FROM inventory WHERE item_name = '不存在'");
      expect(result.rowCount).toBe(0);
      expect(result.values).toEqual([]);
    });

    it('已存在空表 + 有 seedRows 时 executeQuery 不触发 reseed', () => {
      // 先加载有数据的表
      service.applyEdits('DELETE FROM inventory;');
      // 验证表已空
      const emptyCheck = service.executeQuery('SELECT COUNT(*) AS cnt FROM inventory');
      expect(emptyCheck.values[0][0]).toBe(0);

      // mock seedRows 返回数据（如果 reseed 被错误触发，查询后表会有数据）
      mockGetEffectiveSeedRows.mockReturnValue([
        ['1', '铁剑', '3'],
      ]);

      // 执行查询（不应触发 reseed）
      const queryResult = service.executeQuery('SELECT COUNT(*) AS cnt FROM inventory');
      expect(queryResult.values[0][0]).toBe(0);

      // 再次确认表仍为空（executeQuery 不应有写副作用）
      const finalCheck = service.executeQuery('SELECT * FROM inventory');
      expect(finalCheck.rowCount).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 新开卡场景：executeQuery 不触发建表
  // ═══════════════════════════════════════════════════════════════
  describe('新开卡场景下 executeQuery 不触发建表', () => {
    it('新开卡后 executeQuery 查询不存在的表应抛出错误，而非静默建表', async () => {
      // 模拟新开卡：mergeAll 返回 null
      mockMergeAll.mockResolvedValue(null);
      await service.loadFromChat();

      // executeQuery 不应触发建表，查询不存在的表应抛出错误
      expect(() => service.executeQuery('SELECT * FROM inventory')).toThrow();
    });

    it('新开卡后 applyEdits 才触发建表', async () => {
      // 模拟新开卡
      mockMergeAll.mockResolvedValue(null);
      await service.loadFromChat();

      // 设置模板数据，让 _ensureTablesFromTemplate 能找到模板
      const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
      vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
        mate: { type: 'acu', version: 1 },
        sheet_0: {
          uid: 'inventory',
          name: 'inventory',
          sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '', ddl: TEST_DDL },
          content: [['row_id', 'item_name', 'quantity']],
          updateConfig: {},
          exportConfig: {},
          orderNo: 0,
        },
      } as any);

      // applyEdits 应触发建表并成功执行
      const result = service.applyEdits("INSERT INTO inventory VALUES (1, '铁剑', 3);");
      expect(result.success).toBe(true);
      expect(result.appliedEdits).toBe(1);

      // 建表后 executeQuery 应正常工作
      const queryResult = service.executeQuery('SELECT * FROM inventory');
      expect(queryResult.rowCount).toBe(1);
    });

    it('新开卡首次写入遇到非法 DDL 时使用 runtime fallback，且不改写模板原文', async () => {
      mockMergeAll.mockResolvedValue(null);
      await service.loadFromChat();

      const invalidDdl = 'CREATE TABLE inventory ( INVALID SYNTAX;';
      const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
      vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
        mate: { type: 'acu', version: 1 },
        sheet_0: {
          uid: 'inventory',
          name: 'inventory',
          sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '', ddl: invalidDdl },
          content: [['row_id', '物品名称', '数量']],
          updateConfig: {},
          exportConfig: {},
          orderNo: 0,
        },
      } as any);

      const result = service.applyEdits("INSERT INTO inventory (row_id, wu_pin_ming_cheng, shu_liang) VALUES (1, '铁剑', '3');");

      expect(result.success).toBe(true);
      expect(service.executeQuery('SELECT wu_pin_ming_cheng, shu_liang FROM inventory').values).toEqual([['铁剑', '3']]);
      expect(vi.mocked(parseTableTemplateJson_ACU).mock.results.at(-1)?.value.sheet_0.sourceData.ddl).toBe(invalidDdl);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // _ensureTablesFromTemplate + seedRows 写入
  // ═══════════════════════════════════════════════════════════════
  describe('建表时 seedRows 写入 SQLite', () => {
    const TEST_DDL_WITH_SEED = `CREATE TABLE inventory (
      row_id INTEGER PRIMARY KEY,
      item_name TEXT NOT NULL,
      quantity INTEGER DEFAULT 1
    );`;

    it('有 seedRows 的表建表后数据被写入 SQLite', async () => {
      // 模拟新开卡
      mockMergeAll.mockResolvedValue(null);
      await service.loadFromChat();

      // 设置模板（stripSeedRows=true 后只有表头）
      const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
      vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
        mate: { type: 'acu', version: 1 },
        sheet_0: {
          uid: 'inventory',
          name: 'inventory',
          sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '', ddl: TEST_DDL_WITH_SEED },
          content: [['row_id', 'item_name', 'quantity']], // 只有表头
          updateConfig: {},
          exportConfig: {},
          orderNo: 0,
        },
      } as any);

      // mock seedRows 返回初始数据
      mockGetEffectiveSeedRows.mockReturnValue([
        ['1', '铁剑', '3'],
        ['2', '治疗药水', '5'],
      ]);

      // applyEdits 触发建表 + seedRows 写入
      const result = service.applyEdits("UPDATE inventory SET quantity = 10 WHERE item_name = '铁剑';");
      expect(result.success).toBe(true);

      // 验证 seedRows 已写入 SQLite
      const queryResult = service.executeQuery('SELECT * FROM inventory ORDER BY row_id');
      expect(queryResult.rowCount).toBe(2);
      expect(queryResult.values[0]).toContain('铁剑');
      // 验证 UPDATE 确实生效了（quantity 从 3 变为 10）
      expect(queryResult.values[0]).toContain(10);
      expect(queryResult.values[1]).toContain('治疗药水');
    });

    it('seedRows 缺失 row_id 时会稳定化后写入 SQLite', async () => {
      mockMergeAll.mockResolvedValue(null);
      await service.loadFromChat();

      const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
      vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
        mate: { type: 'acu', version: 1 },
        sheet_0: {
          uid: 'inventory',
          name: 'inventory',
          sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '', ddl: TEST_DDL_WITH_SEED },
          content: [['row_id', 'item_name', 'quantity']],
          updateConfig: {},
          exportConfig: {},
          orderNo: 0,
        },
      } as any);

      mockGetEffectiveSeedRows.mockReturnValue([
        [null, '铁剑', '3'],
        ['', '治疗药水', '5'],
      ]);

      const result = service.applyEdits("UPDATE inventory SET quantity = 10 WHERE item_name = '铁剑';");
      expect(result.success).toBe(true);

      const queryResult = service.executeQuery('SELECT row_id, item_name, quantity FROM inventory ORDER BY row_id');
      expect(queryResult.rowCount).toBe(2);
      expect(queryResult.values[0]).toEqual([1, '铁剑', 10]);
      expect(queryResult.values[1]).toEqual([2, '治疗药水', 5]);
    });

    it('没有 seedRows 的表建表后仍为空表', async () => {
      mockMergeAll.mockResolvedValue(null);
      await service.loadFromChat();

      const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
      vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
        mate: { type: 'acu', version: 1 },
        sheet_0: {
          uid: 'inventory',
          name: 'inventory',
          sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '', ddl: TEST_DDL_WITH_SEED },
          content: [['row_id', 'item_name', 'quantity']],
          updateConfig: {},
          exportConfig: {},
          orderNo: 0,
        },
      } as any);

      // mock seedRows 返回空
      mockGetEffectiveSeedRows.mockReturnValue([]);

      // applyEdits 触发建表（无 seedRows）
      const result = service.applyEdits("INSERT INTO inventory VALUES (1, '魔法书', 1);");
      expect(result.success).toBe(true);

      // 验证只有刚 INSERT 的那一行
      const queryResult = service.executeQuery('SELECT * FROM inventory');
      expect(queryResult.rowCount).toBe(1);
      expect(queryResult.values[0]).toContain('魔法书');
    });

    it('已存在的表不会被重复写入 seedRows', async () => {
      // 先加载有数据的表
      mockMergeAll.mockResolvedValue(JSON.parse(JSON.stringify(testTableData)));
      await service.loadFromChat();

      // 设置 seedRows（即使有也不应写入，因为表已存在）
      mockGetEffectiveSeedRows.mockReturnValue([
        ['99', '不应出现的物品', '999'],
      ]);

      const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
      vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
        mate: { type: 'acu', version: 1 },
        sheet_0: {
          uid: 'inventory',
          name: 'inventory',
          sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '', ddl: TEST_DDL },
          content: [['row_id', 'item_name', 'quantity']],
          updateConfig: {},
          exportConfig: {},
          orderNo: 0,
        },
      } as any);

      // applyEdits 触发 _ensureTablesFromTemplate，但表已存在，不应重建
      const result = service.applyEdits("UPDATE inventory SET quantity = 10 WHERE row_id = 1;");
      expect(result.success).toBe(true);

      // 验证原始数据未被 seedRows 覆盖
      const queryResult = service.executeQuery('SELECT * FROM inventory ORDER BY row_id');
      expect(queryResult.rowCount).toBe(2); // 原始 2 行
      expect(queryResult.values[0]).toContain('铁剑');
      // 不应出现 seedRows 中的数据
      const allItems = queryResult.values.map(r => r[1]);
      expect(allItems).not.toContain('不应出现的物品');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // _ensureTablesFromTemplate 模板来源优先级
  // ═══════════════════════════════════════════════════════════════
  describe('建表时只使用当前聊天模板预设', () => {
    const CHAT_TEMPLATE_DDL = `CREATE TABLE chat_table (
      row_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    );`;

    const GLOBAL_TEMPLATE_DDL = `CREATE TABLE global_table (
      row_id INTEGER PRIMARY KEY,
      value TEXT NOT NULL
    );`;

    it('chat_override 模式下只建聊天级模板中的表，不建全局模板的表', async () => {
      // 模拟新开卡
      mockMergeAll.mockResolvedValue(null);
      await service.loadFromChat();

      // 设置当前聊天模板为 chat_override（只有 chat_table）
      mockGetCurrentChatTemplateScopeState.mockReturnValue({
        mode: 'chat_override',
        templateStr: JSON.stringify({
          mate: { type: 'acu', version: 1 },
          sheet_0: {
            uid: 'chat_table',
            name: 'chattable',
            sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '', ddl: CHAT_TEMPLATE_DDL },
            content: [['row_id', 'name']],
            updateConfig: {},
            exportConfig: {},
            orderNo: 0,
          },
        }),
        presetName: '聊天预设',
      });

      // 全局模板有 global_table（不应该被建出来）
      const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
      vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
        mate: { type: 'acu', version: 1 },
        sheet_0: {
          uid: 'global_table',
          name: '全局表',
          sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '', ddl: GLOBAL_TEMPLATE_DDL },
          content: [['row_id', 'value']],
          updateConfig: {},
          exportConfig: {},
          orderNo: 0,
        },
      } as any);

      // applyEdits 触发建表
      const result = service.applyEdits("INSERT INTO chattable VALUES (1, '测试');");
      expect(result.success).toBe(true);

      // 验证 chat_table 被建出来了
      const chatQuery = service.executeQuery('SELECT * FROM chattable');
      expect(chatQuery.rowCount).toBe(1);

      // 验证 global_table 没有被建出来
      expect(() => service.executeQuery('SELECT * FROM global_table')).toThrow();
    });

    it('chat_override 建表时不能被旧 currentJsonTableData 的 CHECK 覆盖', async () => {
      mockMergeAll.mockResolvedValue(null);
      await service.loadFromChat();

      const oldDDL = `CREATE TABLE chat_table (
        row_id INTEGER PRIMARY KEY,
        status TEXT CHECK(status IN ('old')) -- 状态
      );`;
      const newDDL = `CREATE TABLE chat_table (
        row_id INTEGER PRIMARY KEY,
        status TEXT CHECK(status IN ('new')) -- 状态
      );`;
      mockCurrentJsonTableData = {
        mate: { type: 'acu', version: 1 },
        sheet_0: {
          uid: 'chat_table',
          name: '旧运行时表',
          sourceData: { ddl: oldDDL },
          content: [['row_id', '状态']],
          updateConfig: {},
          exportConfig: {},
          orderNo: 0,
        },
      };
      mockGetCurrentChatTemplateScopeState.mockReturnValue({
        mode: 'chat_override',
        templateStr: JSON.stringify({
          mate: { type: 'acu', version: 1 },
          sheet_0: {
            uid: 'chat_table',
            name: 'chattable',
            sourceData: { ddl: newDDL },
            content: [['row_id', '状态']],
            updateConfig: {},
            exportConfig: {},
            orderNo: 0,
          },
        }),
        presetName: '聊天预设',
      });

      const result = service.executeMutation("INSERT INTO chattable VALUES (1, 'new');");

      expect(result.errors).toEqual([]);
      expect(service.executeQuery('SELECT status FROM chattable').values[0][0]).toBe('new');
    });

    it('inherit_global 模式下 fallback 到全局模板', async () => {
      mockMergeAll.mockResolvedValue(null);
      await service.loadFromChat();

      // 当前聊天没有聊天级模板（inherit_global）
      mockGetCurrentChatTemplateScopeState.mockReturnValue(null);

      // 全局模板有 inventory 表
      const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
      vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
        mate: { type: 'acu', version: 1 },
        sheet_0: {
          uid: 'inventory',
          name: 'inventory',
          sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '', ddl: TEST_DDL },
          content: [['row_id', 'item_name', 'quantity']],
          updateConfig: {},
          exportConfig: {},
          orderNo: 0,
        },
      } as any);

      // applyEdits 触发建表（应使用全局模板）
      const result = service.applyEdits("INSERT INTO inventory VALUES (1, '铁剑', 3);");
      expect(result.success).toBe(true);

      const queryResult = service.executeQuery('SELECT * FROM inventory');
      expect(queryResult.rowCount).toBe(1);
    });

    it('preset_link 模式下使用链接的全局预设', async () => {
      mockMergeAll.mockResolvedValue(null);
      await service.loadFromChat();

      // 当前聊天链接了全局预设
      mockGetCurrentChatTemplateScopeState.mockReturnValue({
        mode: 'preset_link',
        presetName: '战斗模板',
        templateStr: '',
      });

      // mock 全局预设返回
      mockGetTemplatePreset.mockReturnValue({
        templateStr: JSON.stringify({
          mate: { type: 'acu', version: 1 },
          sheet_0: {
            uid: 'inventory',
            name: 'inventory',
            sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '', ddl: TEST_DDL },
            content: [['row_id', 'item_name', 'quantity']],
            updateConfig: {},
            exportConfig: {},
            orderNo: 0,
          },
        }),
      });

      const result = service.applyEdits("INSERT INTO inventory VALUES (1, '铁剑', 3);");
      expect(result.success).toBe(true);

      const queryResult = service.executeQuery('SELECT * FROM inventory');
      expect(queryResult.rowCount).toBe(1);
      expect(mockGetTemplatePreset).toHaveBeenCalledWith('战斗模板');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // executeMutation
  // ═══════════════════════════════════════════════════════════════
  describe('executeMutation', () => {
    beforeEach(async () => {
      mockMergeAll.mockResolvedValue(JSON.parse(JSON.stringify(testTableData)));
      await service.loadFromChat();
    });

    it('执行 INSERT 并返回 changes', () => {
      const result = service.executeMutation("INSERT INTO inventory VALUES (3, '魔法书', 1)");
      expect(result.changes).toBe(1);
      expect(result.errors).toEqual([]);
    });

    it('执行 UPDATE 并返回 changes', () => {
      const result = service.executeMutation('UPDATE inventory SET quantity = 10 WHERE row_id = 1');
      expect(result.changes).toBe(1);
      expect(result.errors).toEqual([]);
    });

    it('执行 DELETE 并返回 changes', () => {
      const result = service.executeMutation('DELETE FROM inventory WHERE row_id = 1');
      expect(result.changes).toBe(1);
      expect(result.errors).toEqual([]);
    });

    it('SQL 错误时返回 errors 而不抛出', () => {
      const result = service.executeMutation('INSERT INTO nonexistent_table VALUES (1)');
      expect(result.changes).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // [阶段 E] executeMutation 不再在写路径 reseed（同 applyEdits）。
  // ═══════════════════════════════════════════════════════════════
  describe('executeMutation 不再在写路径 reseed', () => {
    beforeEach(async () => {
      mockMergeAll.mockResolvedValue(JSON.parse(JSON.stringify(testTableData)));
      await service.loadFromChat();
    });

    it('DELETE 全表后 executeMutation UPDATE 不自动回灌，作用于空表', () => {
      service.applyEdits('DELETE FROM inventory;');
      mockGetEffectiveSeedRows.mockReturnValue([
        ['1', '铁剑', '3'],
        ['2', '治疗药水', '5'],
      ]);

      const result = service.executeMutation("UPDATE inventory SET quantity = 10 WHERE item_name = '铁剑'");
      expect(result.changes).toBe(0);
      expect(result.errors).toEqual([]);

      const queryResult = service.executeQuery('SELECT * FROM inventory ORDER BY row_id');
      expect(queryResult.rowCount).toBe(0);
    });

    it('非空表不触发 reseed', () => {
      mockGetEffectiveSeedRows.mockReturnValue([
        ['99', '不应出现的物品', '999'],
      ]);

      const result = service.executeMutation("UPDATE inventory SET quantity = 10 WHERE row_id = 1");
      expect(result.changes).toBe(1);

      const queryResult = service.executeQuery('SELECT * FROM inventory ORDER BY row_id');
      const allItems = queryResult.values.map((r: any) => r[1]);
      expect(allItems).not.toContain('不应出现的物品');
    });

    it('无 seedRows 的表不触发 reseed', () => {
      service.applyEdits('DELETE FROM inventory;');
      mockGetEffectiveSeedRows.mockReturnValue([]);

      const result = service.executeMutation("UPDATE inventory SET quantity = 10 WHERE row_id = 1");
      expect(result.changes).toBe(0);

      const queryResult = service.executeQuery('SELECT COUNT(*) AS cnt FROM inventory');
      expect(queryResult.values[0][0]).toBe(0);
    });

    it('用户 SQL 失败时表保持空，无 reseed 残留', () => {
      service.applyEdits('DELETE FROM inventory;');
      mockGetEffectiveSeedRows.mockReturnValue([
        ['1', '铁剑', '3'],
      ]);

      const result = service.executeMutation("UPDATE inventory SET nonexistent_col = 1 WHERE row_id = 1");
      expect(result.changes).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);

      const queryResult = service.executeQuery('SELECT * FROM inventory ORDER BY row_id');
      expect(queryResult.rowCount).toBe(0);

      const sheetContent = mockCurrentJsonTableData?.sheet_0?.content;
      expect(Array.isArray(sheetContent)).toBe(true);
      expect(sheetContent.length).toBe(1); // 仅表头，无 reseed 数据行
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // getCurrentData
  // ═══════════════════════════════════════════════════════════════
  describe('getCurrentData', () => {
    it('未初始化时返回 currentJsonTableData_ACU', () => {
      mockCurrentJsonTableData = { test: true };
      const result = service.getCurrentData();
      expect(result).toEqual({ test: true });
    });

    it('初始化后返回导出的数据', async () => {
      mockMergeAll.mockResolvedValue(JSON.parse(JSON.stringify(testTableData)));
      await service.loadFromChat();
      const result = service.getCurrentData();
      expect(result).not.toBeNull();
      expect(result).toHaveProperty('sheet_0');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // clearRuntimeData
  // ═══════════════════════════════════════════════════════════════
  describe('clearRuntimeData', () => {
    it('释放已初始化引擎并清空 JSON 视图', async () => {
      mockMergeAll.mockResolvedValue(JSON.parse(JSON.stringify(testTableData)));
      await service.loadFromChat();
      service.clearRuntimeData();
      expect(service.isReady()).toBe(false);
      expect(mockReleaseGlobalNameMapper).toHaveBeenCalled();
      expect(service.getCurrentData()).toBeNull();
      expect(() => service.executeQuery('SELECT 1')).toThrow('SQLite 引擎未初始化');
      const replaced = await service.replaceAllData(JSON.parse(JSON.stringify(testTableData)));
      expect(replaced.success).toBe(true);
      expect(service.isReady()).toBe(true);
      expect(service.executeQuery('SELECT * FROM inventory').rowCount).toBe(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // saveToChat
  // ═══════════════════════════════════════════════════════════════
  describe('saveToChat', () => {
    beforeEach(async () => {
      mockMergeAll.mockResolvedValue(JSON.parse(JSON.stringify(testTableData)));
      await service.loadFromChat();
    });

    it('拒绝 provider 直接保存，要求走公共提交模型', async () => {
      const result = await service.saveToChat();
      expect(result.saved).toBe(false);
      expect(result.error).toContain('table update commit model');
      expect(mockSaveIndependentTable).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // dispose
  // ═══════════════════════════════════════════════════════════════
  describe('dispose', () => {
    it('销毁后无法执行查询', async () => {
      mockMergeAll.mockResolvedValue(JSON.parse(JSON.stringify(testTableData)));
      await service.loadFromChat();
      service.dispose();
      expect(() => service.executeQuery('SELECT 1')).toThrow();
      expect(mockReleaseGlobalNameMapper).toHaveBeenCalled();
    });

    it('多次 dispose 不抛出', async () => {
      mockMergeAll.mockResolvedValue(JSON.parse(JSON.stringify(testTableData)));
      await service.loadFromChat();
      service.dispose();
      expect(() => service.dispose()).not.toThrow();
    });
  });

  describe('isolatedRuntime', () => {
    it('loadFromData / apply / dispose 不写全局 JSON，也不发布或释放全局 NameMapper', async () => {
      const { _set_currentJsonTableData_ACU } = await import('../../../src/service/runtime/state-manager');
      mockCurrentJsonTableData = {
        mate: { type: 'acu', version: 1 },
        sheet_keep: { uid: 'keep', name: 'keep', content: [['row_id', 'v'], ['1', 'shared']] },
      };
      const isolated = new SqlTableService({ isolatedRuntime: true });
      try {
        const loaded = await isolated.loadFromData(JSON.parse(JSON.stringify(testTableData)));
        expect(loaded.loaded).toBe(true);
        expect(isolated.isReady()).toBe(true);
        expect(mockCurrentJsonTableData.sheet_keep.content[1][1]).toBe('shared');
        expect(_set_currentJsonTableData_ACU).not.toHaveBeenCalled();
        expect(mockPublishGlobalNameMapper).not.toHaveBeenCalled();
        expect(mockPublishGlobalNameMapperEmptySchema).not.toHaveBeenCalled();

        isolated.applyEdits('UPDATE inventory SET quantity = 99 WHERE row_id = 1;');
        expect(isolated.executeQuery('SELECT quantity FROM inventory WHERE row_id = 1').values).toEqual([[99]]);
        expect(mockCurrentJsonTableData.sheet_keep.content[1][1]).toBe('shared');
        expect(_set_currentJsonTableData_ACU).not.toHaveBeenCalled();

        isolated.dispose();
        expect(mockReleaseGlobalNameMapper).not.toHaveBeenCalled();
        expect(mockCurrentJsonTableData.sheet_keep.content[1][1]).toBe('shared');
      } finally {
        try { isolated.dispose(); } catch (_) { /* already disposed */ }
      }
    });
  });
});
