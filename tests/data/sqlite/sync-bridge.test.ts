/**
 * tests/data/sqlite/sync-bridge.test.ts
 * SyncBridge 组合测试 — 使用真实 SqliteEngine + schema-mapper
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteEngine } from '../../../src/data/sqlite/sqlite-engine';
import { SyncBridge } from '../../../src/data/sqlite/sync-bridge';
import { getPhysicalTableNameForSheet_ACU } from '../../../src/shared/sheet-identity';
import type { TableDataObject_ACU, Sheet_ACU, Mate_ACU } from '../../../src/shared/models/table-data';

// ═══════════════════════════════════════════════════════════════
// 辅助：构造测试数据
// ═══════════════════════════════════════════════════════════════
function makeMate(): Mate_ACU {
  return {
    type: 'acu_table_data',
    version: 3,
    updateConfigUiSentinel: 0,
    globalInjectionConfig: {
      readableEntryPlacement: { position: 'before_char', depth: 4, order: 100 },
      wrapperPlacement: { position: 'before_char', depth: 4, order: 100 },
    },
  };
}

function makeSheet(overrides: Partial<Sheet_ACU> = {}): Sheet_ACU {
  return {
    uid: 'inventory',
    name: '背包物品表',
    sourceData: {
      note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '',
      ddl: `CREATE TABLE inventory ( -- 背包物品表
  row_id INTEGER PRIMARY KEY, -- 行号
  item_name TEXT NOT NULL, -- 物品名称
  quantity INTEGER DEFAULT 1, -- 数量
  description TEXT -- 描述
);`,
    },
    content: [
      ['row_id', '物品名称', '数量', '描述'],
      ['1', '铁剑', '3', '普通的铁剑'],
      ['2', '治疗药水', '5', '恢复少量HP'],
    ],
    updateConfig: { uiSentinel: 0, contextDepth: 0, updateFrequency: 0, batchSize: 0, skipFloors: 0 },
    exportConfig: {} as any,
    orderNo: 0,
    ...overrides,
  };
}

function makeTableData(sheets: Record<string, Sheet_ACU> = {}): TableDataObject_ACU {
  const data: TableDataObject_ACU = { mate: makeMate() };
  for (const [key, sheet] of Object.entries(sheets)) {
    data[key] = sheet;
  }
  return data;
}

function getRuntimeTableName(data: TableDataObject_ACU, sheetKey: string): string {
  return getPhysicalTableNameForSheet_ACU(data, sheetKey);
}

describe('SyncBridge', () => {
  let engine: SqliteEngine;
  let bridge: SyncBridge;

  beforeEach(async () => {
    engine = new SqliteEngine();
    await engine.init();
    bridge = new SyncBridge(engine);
  });

  afterEach(() => {
    engine.dispose();
  });

  // ═══════════════════════════════════════════════════════════════
  // loadFromTableData
  // ═══════════════════════════════════════════════════════════════
  describe('loadFromTableData', () => {
    it('加载单张表到 SQLite', () => {
      const data = makeTableData({ sheet_0: makeSheet() });
      const tableName = getRuntimeTableName(data, 'sheet_0');
      bridge.loadFromTableData(data);

      // 验证表已创建
      const tableNames = engine.getTableNames();
      expect(tableNames).toContain(tableName);

      // 验证数据已灌入
      const result = engine.query(`SELECT * FROM ${tableName};`);
      expect(result.values).toHaveLength(2);
      expect(result.values[0][1]).toBe('铁剑');
      expect(result.values[1][1]).toBe('治疗药水');
    });

    it('加载多张表', () => {
      const sheet2 = makeSheet({
        uid: 'characters',
        name: '重要人物表',
        sourceData: {
          note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '',
          ddl: `CREATE TABLE characters ( -- 重要人物表
  row_id INTEGER PRIMARY KEY, -- 行号
  char_name TEXT NOT NULL, -- 姓名
  status TEXT DEFAULT '存活' -- 状态
);`,
        },
        content: [
          ['row_id', '姓名', '状态'],
          ['1', '角色A', '存活'],
        ],
      });

      const data = makeTableData({
        sheet_0: makeSheet(),
        sheet_1: sheet2,
      });
      bridge.loadFromTableData(data);

      expect(engine.getTableNames()).toContain(getRuntimeTableName(data, 'sheet_0'));
      expect(engine.getTableNames()).toContain(getRuntimeTableName(data, 'sheet_1'));
    });

    it('非首列空业务表头的表跳过建表，有效表照常建表（SQL 活动路径休眠）', () => {
      const dormantSheet = makeSheet({
        uid: 'dormant',
        name: '空表头表',
        sourceData: { ddl: 'CREATE TABLE dormant (row_id INTEGER PRIMARY KEY, value TEXT);' },
        content: [['row_id', '', '']], // 第 2、3 列空业务表头
      });
      const validSheet = makeSheet({
        uid: 'inventory',
        name: '背包物品表',
      });
      const data = makeTableData({ sheet_dormant: dormantSheet, sheet_0: validSheet });

      bridge.loadFromTableData(data, { strict: true });

      const tableNames = engine.getTableNames();
      // 休眠表不建表
      expect(tableNames).not.toContain('dormant');
      expect(tableNames).not.toContain(getRuntimeTableName(data, 'sheet_dormant'));
      // 有效表照常建表
      expect(tableNames).toContain(getRuntimeTableName(data, 'sheet_0'));
    });

    it('null 或空对象不报错', () => {
      expect(() => bridge.loadFromTableData(null as any)).not.toThrow();
      expect(() => bridge.loadFromTableData({} as any)).not.toThrow();
    });

    it('引擎未初始化时抛出错误', () => {
      engine.dispose();
      const data = makeTableData({ sheet_0: makeSheet() });
      expect(() => bridge.loadFromTableData(data)).toThrow('未初始化');
    });

    it('加载快照时保留 NOT NULL 字段中的空字符串', () => {
      const characterSheet = makeSheet({
        uid: 'characters',
        name: '角色表',
        sourceData: {
          note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '',
          ddl: `CREATE TABLE characters ( -- 角色表
  row_id INTEGER PRIMARY KEY, -- 行号
  name TEXT NOT NULL, -- 姓名
  note TEXT NOT NULL DEFAULT '' -- 备注
);`,
        },
        content: [
          ['row_id', '姓名', '备注'],
          ['1', '角色A', ''],
        ],
      });
      const data = makeTableData({ sheet_0: characterSheet });
      const tableName = getRuntimeTableName(data, 'sheet_0');

      expect(() => bridge.loadFromTableData(data, { strict: true })).not.toThrow();

      const result = engine.query(`SELECT note FROM ${tableName} WHERE name = ?;`, ['角色A']);
      expect(result.values[0][0]).toBe('');
    });

    it('显式 legacy DDL 表名不覆盖显示名派生的 runtime 物理名，且保持 round-trip', () => {
      const chronicleSheet = makeSheet({
        uid: 'chronicle',
        name: '纪要表',
        sourceData: {
          note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '',
          ddl: `CREATE TABLE chronicle ( -- 纪要表
  row_id INTEGER PRIMARY KEY, -- 行号
  code_index TEXT, -- 编码索引
  time_span TEXT, -- 时间跨度
  summary TEXT, -- 概览
  chronicle_text TEXT, -- 纪要
  key_dialogue TEXT -- 重要对话
);`,
        },
        content: [
          ['row_id', '纪要', '编码索引', '时间跨度', '概览', '重要对话'],
          ['1', '完整纪要正文', 'AM0001', '2026-10-15 14:30 ~ 2026-10-15 15:00', '摘要', null],
        ],
      });

      bridge.loadFromTableData(makeTableData({ sheet_chronicle: chronicleSheet }), { strict: true });

      expect(engine.getTableNames()).toContain('jiyaobiao');
      expect(engine.getTableNames()).not.toContain('chronicle');
      expect(engine.query(
        'SELECT code_index, time_span, summary, chronicle_text, key_dialogue FROM jiyaobiao WHERE row_id = 1;'
      ).values).toEqual([
        ['AM0001', '2026-10-15 14:30 ~ 2026-10-15 15:00', '摘要', '完整纪要正文', null],
      ]);

      const exported = bridge.exportToTableData(makeMate()).sheet_chronicle as Sheet_ACU;
      expect(exported.content).toEqual([
        ['row_id', '编码索引', '时间跨度', '概览', '纪要', '重要对话'],
        ['1', 'AM0001', '2026-10-15 14:30 ~ 2026-10-15 15:00', '摘要', '完整纪要正文', null],
      ]);
    });

    it('非 strict 模式下必需值缺失时不留下半建表状态', () => {
      const invalidSheet = makeSheet({
        uid: 'required_value',
        name: '必填值表',
        sourceData: {
          note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '',
          ddl: `CREATE TABLE required_value (
  row_id INTEGER PRIMARY KEY, -- 行号
  name TEXT NOT NULL -- 名称
);`,
        },
        content: [
          ['row_id', '名称'],
          ['1', null],
        ],
      });

      expect(() => bridge.loadFromTableData(makeTableData({ sheet_invalid: invalidSheet }))).not.toThrow();
      expect(engine.getTableNames()).not.toContain('required_value');
    });

    it('非 strict 模式下失败表不写 meta，后续合法表仍完整加载', () => {
      const invalidSheet = makeSheet({
        uid: 'required_value',
        name: '必填值表',
        sourceData: {
          note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '',
          ddl: `CREATE TABLE required_value (
  row_id INTEGER PRIMARY KEY, -- 行号
  name TEXT NOT NULL -- 名称
);`,
        },
        content: [
          ['row_id', '名称'],
          ['1', null],
        ],
      });

      const data = makeTableData({ sheet_invalid: invalidSheet, sheet_valid: makeSheet() });
      const validTableName = getRuntimeTableName(data, 'sheet_valid');
      bridge.loadFromTableData(data);

      expect(engine.getTableNames()).not.toContain('required_value');
      expect(engine.query("SELECT sheet_key FROM _acu_sheet_meta WHERE sheet_key = 'sheet_invalid';").values).toEqual([]);
      expect(engine.getTableNames()).toContain(validTableName);
      expect(engine.query(`SELECT item_name FROM ${validTableName} ORDER BY row_id;`).values).toEqual([
        ['铁剑'],
        ['治疗药水'],
      ]);
    });

    it('非 strict 模式下 INSERT 约束失败会回滚用户表和 meta，后续表继续加载', () => {
      const invalidSheet = makeSheet({
        uid: 'checked_value',
        name: '受约束表',
        sourceData: {
          note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '',
          ddl: `CREATE TABLE checked_value (
  row_id INTEGER PRIMARY KEY, -- 行号
  name TEXT NOT NULL CHECK(length(name) >= 3) -- 名称
);`,
        },
        content: [
          ['row_id', '名称'],
          ['1', '短'],
        ],
      });

      const data = makeTableData({ sheet_invalid: invalidSheet, sheet_valid: makeSheet() });
      const validTableName = getRuntimeTableName(data, 'sheet_valid');
      bridge.loadFromTableData(data);

      expect(engine.getTableNames()).not.toContain('checked_value');
      expect(engine.query("SELECT sheet_key FROM _acu_sheet_meta WHERE sheet_key = 'sheet_invalid';").values).toEqual([]);
      expect(engine.getTableNames()).toContain(validTableName);
      expect(engine.query(`SELECT item_name FROM ${validTableName} ORDER BY row_id;`).values).toEqual([
        ['铁剑'],
        ['治疗药水'],
      ]);
    });

    it('strict hydrate 的 SQLite 写入失败保留脱敏后的语句位置、操作与约束诊断', () => {
      const privateChronicleText = '这段纪要正文不得出现在 SQLite 错误诊断中。';
      const invalidSheet = makeSheet({
        uid: 'checked_value',
        name: '受约束表',
        sourceData: {
          note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '',
          ddl: `CREATE TABLE checked_value (
  row_id INTEGER PRIMARY KEY, -- 行号
  name TEXT NOT NULL CHECK(length(name) >= 3) -- 名称
);`,
        },
        content: [
          ['row_id', '名称'],
          ['1', privateChronicleText],
          ['2', '短'],
        ],
      });

      expect(() => bridge.loadFromTableData(makeTableData({ sheet_invalid: invalidSheet }), { strict: true }))
        .toThrow('SQLite 写入失败：第 3 条语句失败（INSERT INTO shouyueshubiao）：CHECK constraint failed');
      try {
        bridge.loadFromTableData(makeTableData({ sheet_invalid: invalidSheet }), { strict: true });
      } catch (error: any) {
        expect(error.message).not.toContain(privateChronicleText);
        expect(error.message).not.toContain('VALUES');
      }
    });

    it('单张表加载失败不影响其他表', () => {
      // 第一张表 DDL 有语法错误
      const badSheet = makeSheet({
        uid: 'bad_table',
        name: '坏表',
        sourceData: {
          note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '',
          ddl: 'CREATE TABLE bad_table ( INVALID SYNTAX;',
        },
      });

      const data = makeTableData({
        sheet_0: badSheet,
        sheet_1: makeSheet(),
      });
      const validTableName = getRuntimeTableName(data, 'sheet_1');

      // 不应该抛出错误（内部 try-catch 隔离）
      expect(() => bridge.loadFromTableData(data)).not.toThrow();

      // 好的表应该正常加载
      expect(engine.getTableNames()).toContain(validTableName);
    });

    it('runtime fallback 可加载非法显式 DDL，保留原文并按稳定 columnMap round-trip', () => {
      const invalidDdl = 'CREATE TABLE broken_runtime ( INVALID SYNTAX;';
      const sheet = makeSheet({
        uid: 'sheet_runtime',
        name: '运行时回退表',
        sourceData: {
          note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '',
          ddl: invalidDdl,
        },
        content: [
          ['row_id', '物品名称', 'select'],
          ['1', '铁剑', '稀有'],
        ],
      });
      const data = makeTableData({ sheet_runtime: sheet });
      const tableName = getRuntimeTableName(data, 'sheet_runtime');

      bridge.loadFromTableData(data, { strict: true, allowRuntimeDdlFallback: true });

      expect(engine.getTableNames()).toContain(tableName);
      expect(engine.query(`SELECT wu_pin_ming_cheng, col_select FROM ${tableName};`).values).toEqual([['铁剑', '稀有']]);
      const exported = bridge.exportToTableData(makeMate()).sheet_runtime as Sheet_ACU;
      expect(exported.content).toEqual([
        ['row_id', '物品名称', 'select'],
        ['1', '铁剑', '稀有'],
      ]);
      expect(exported.sourceData.ddl).toBe(invalidDdl);
    });

    it('runtime fallback 按 sheetKey 记录一次结构化诊断', () => {
      const invalidDdl = 'CREATE TABLE broken_observable ( INVALID SYNTAX;';
      const sheet = makeSheet({
        uid: 'sheet_observable',
        sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '', ddl: invalidDdl },
      });
      const data = makeTableData({ sheet_observable: sheet });
      const tableName = getRuntimeTableName(data, 'sheet_observable');

      bridge.loadFromTableData(data, { strict: true, allowRuntimeDdlFallback: true });
      engine.run(`DROP TABLE ${tableName};`);
      bridge.loadFromTableData(data, { strict: true, allowRuntimeDdlFallback: true });

      expect(bridge.getRuntimeFallbackDiagnostics_ACU()).toEqual([expect.objectContaining({
        sheetKey: 'sheet_observable', reason: 'fallback_invalid', effectiveTableName: tableName, phase: 'initial_load',
      })]);
      expect(bridge.getRuntimeFallbackDiagnostics_ACU()[0].originalDdlDigest).toBeTruthy();
    });

    it('解析通过但 SQLite 建表失败时仅在 runtime context 重试 fallback', () => {
      const executionInvalidDdl = `CREATE TABLE execution_broken (
  row_id INTEGER PRIMARY KEY, -- 行号
  item_name TEXT -- 物品名称
) INVALID_SUFFIX;`;
      const sheet = makeSheet({
        uid: 'execution_broken',
        name: '执行失败回退表',
        sourceData: {
          note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '',
          ddl: executionInvalidDdl,
        },
        content: [['row_id', '物品名称'], ['1', '铁剑']],
      });
      const data = makeTableData({ sheet_execution: sheet });
      const tableName = getRuntimeTableName(data, 'sheet_execution');

      bridge.loadFromTableData(data, { strict: true, allowRuntimeDdlFallback: true });

      expect(bridge.getRuntimeEffectiveSchemas_ACU().get('sheet_execution')).toEqual(expect.objectContaining({
        source: 'fallback_invalid',
        effectiveDDL: expect.stringContaining(`CREATE TABLE ${tableName}`),
      }));
      expect(engine.getTableNames()).toContain(tableName);
      expect(engine.query(`SELECT wu_pin_ming_cheng FROM ${tableName};`).values).toEqual([['铁剑']]);
      const exported = bridge.exportToTableData(makeMate()).sheet_execution as Sheet_ACU & { _acu_runtimeEffectiveSchema?: any };
      expect(exported.sourceData.ddl).toBe(executionInvalidDdl);
      expect(exported._acu_runtimeEffectiveSchema).toEqual(expect.objectContaining({
        source: 'fallback_invalid',
        effectiveDDL: expect.stringContaining(`CREATE TABLE ${tableName}`),
      }));
      expect(exported._acu_runtimeEffectiveSchema.effectiveDDL).not.toContain('INVALID_SUFFIX');
      expect(JSON.stringify(exported)).not.toContain('_acu_runtimeEffectiveSchema');
      expect(JSON.parse(JSON.stringify(exported)).sourceData.ddl).toBe(executionInvalidDdl);
      expect(bridge.getRuntimeFallbackDiagnostics_ACU()).toEqual([expect.objectContaining({
        sheetKey: 'sheet_execution', phase: 'runtime_ddl_retry', failureSummary: expect.stringContaining('INVALID_SUFFIX'),
      })]);
    });

    it('DDL 合法但快照存在非空未映射字段时继续 fail closed，不触发 fallback', () => {
      const sheet = makeSheet({
        content: [['row_id', '物品名称', '数量', '旧字段'], ['1', '铁剑', '3', '不能丢失']],
      });
      const data = makeTableData({ sheet_unsafe: sheet });

      expect(() => bridge.loadFromTableData(data, { strict: true, allowRuntimeDdlFallback: true })).toThrow('没有对应的 DDL 列');
      expect(engine.getTableNames()).not.toContain(getRuntimeTableName(data, 'sheet_unsafe'));
    });

    it('strict hydrate 未显式允许 runtime fallback 时拒绝非法 DDL', () => {
      const sheet = makeSheet({
        sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '', ddl: 'CREATE TABLE broken ( INVALID SYNTAX;' },
      });

      expect(() => bridge.loadFromTableData(makeTableData({ sheet_broken: sheet }), { strict: true })).toThrow('显式 DDL 缺少可用的 row_id INTEGER PRIMARY KEY 结构');
      expect(engine.getTableNames()).not.toContain('sheet_broken');
    });

    it('strict hydrate 只修复精确 auto_merged 尾列并保留调用方快照', () => {
      const legacySheet = makeSheet({
        name: '纪要表',
        content: [
          ['row_id', '物品名称', '数量', '描述'],
          ['1', '历史纪要', '1', '旧数据', 'auto_merged'],
        ],
      });
      const data = makeTableData({ sheet_3NoMc1wI: legacySheet });
      const before = structuredClone(data);
      const tableName = getRuntimeTableName(data, 'sheet_3NoMc1wI');

      expect(() => bridge.loadFromTableData(data, { strict: true })).not.toThrow();
      expect(data).toEqual(before);
      expect(engine.query(`SELECT item_name FROM ${tableName};`).values).toEqual([['历史纪要']]);
    });

    it('strict hydrate 继续拒绝非目标宽度异常', () => {
      const invalidSheet = makeSheet({
        name: '纪要表',
        content: [['row_id', '物品名称', '数量', '描述'], ['1', '坏行', '1', '旧数据', 'manual']],
      });
      const data = makeTableData({ sheet_3NoMc1wI: invalidSheet });

      expect(() => bridge.loadFromTableData(data, { strict: true })).toThrow('row_width_mismatch');
      expect(engine.getTableNames()).not.toContain(getRuntimeTableName(data, 'sheet_3NoMc1wI'));
    });


    it('strict hydrate 在同一快照内 row_id 重复时 fail closed，不覆盖既有行', () => {
      const duplicatedRowSheet = makeSheet({
        content: [
          ['row_id', '物品名称', '数量', '描述'],
          ['1', '旧种子行', '1', '模板 seedRows'],
          ['1', '新快照行', '9', '后续消息覆盖'],
        ],
      });
      const data = makeTableData({ sheet_0: duplicatedRowSheet });
      const tableName = getRuntimeTableName(data, 'sheet_0');

      expect(() => bridge.loadFromTableData(data, { strict: true })).toThrow('duplicate_row_id');
      expect(engine.getTableNames()).not.toContain(tableName);
    });

    it('strict hydrate 拒绝空 row_id 且不修改调用方快照', () => {
      const invalidSheet = makeSheet({
        content: [
          ['row_id', '物品名称', '数量', '描述'],
          ['', '无身份行', '1', '不得静默删除'],
        ],
      });
      const data = makeTableData({ sheet_0: invalidSheet });
      const before = structuredClone(data);
      const tableName = getRuntimeTableName(data, 'sheet_0');

      expect(() => bridge.loadFromTableData(data, { strict: true })).toThrow('empty_row_id');
      expect(data).toEqual(before);
      expect(engine.getTableNames()).not.toContain(tableName);
    });

    it('strict hydrate 拒绝 seedRows 空 row_id 且不修改调用方快照', () => {
      const invalidSheet = makeSheet() as Sheet_ACU & { seedRows?: unknown[][] };
      invalidSheet.seedRows = [['', '无身份种子行', '1', '不得静默删除']];
      const data = makeTableData({ sheet_0: invalidSheet });
      const before = structuredClone(data);
      const tableName = getRuntimeTableName(data, 'sheet_0');

      expect(() => bridge.loadFromTableData(data, { strict: true })).toThrow('empty_row_id');
      expect(data).toEqual(before);
      expect(engine.getTableNames()).not.toContain(tableName);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // exportToTableData
  // ═══════════════════════════════════════════════════════════════
  describe('exportToTableData', () => {
    it('从 SQLite 导出为 TableDataObject', () => {
      const originalData = makeTableData({ sheet_0: makeSheet() });
      bridge.loadFromTableData(originalData);

      const exported = bridge.exportToTableData(makeMate());
      expect(exported.mate).toBeDefined();

      // 找到导出的 sheet
      const sheetKeys = Object.keys(exported).filter(k => k.startsWith('sheet_'));
      expect(sheetKeys).toHaveLength(1);

      const sheet = exported[sheetKeys[0]] as Sheet_ACU;
      expect(sheet.name).toBe('背包物品表');
      expect(sheet.content).toHaveLength(3); // 表头 + 2 行数据
      expect(sheet.content[0]).toContain('物品名称'); // 中文表头还原
    });

    it('导出后数据与原始数据一致', () => {
      const originalData = makeTableData({ sheet_0: makeSheet() });
      bridge.loadFromTableData(originalData);

      const exported = bridge.exportToTableData(makeMate());
      const sheetKeys = Object.keys(exported).filter(k => k.startsWith('sheet_'));
      const sheet = exported[sheetKeys[0]] as Sheet_ACU;

      // 数据行数一致
      expect(sheet.content.length).toBe(3);
      // 第一行数据的物品名称
      expect(sheet.content[1]).toContain('铁剑');
      expect(sheet.content[2]).toContain('治疗药水');
    });

    it('空表导出时从 DDL 恢复完整表头，避免只剩 row_id', () => {
      const emptySheet = makeSheet({
        uid: 'tdoll_construction',
        name: '人形建造表',
        sourceData: {
          note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '',
          ddl: `CREATE TABLE tdoll_construction ( -- 人形建造表
  row_id INTEGER PRIMARY KEY, -- 行号
  start_time TEXT NOT NULL, -- 开始时间
  construction_time TEXT NOT NULL, -- 建造时间
  cost_manpower INTEGER NOT NULL CHECK(cost_manpower >= 0), -- 消耗人力
  cost_ammo INTEGER NOT NULL CHECK(cost_ammo >= 0), -- 消耗弹药
  cost_ration INTEGER NOT NULL CHECK(cost_ration >= 0), -- 消耗口粮
  cost_parts INTEGER NOT NULL CHECK(cost_parts >= 0) -- 消耗零件
);`,
        },
        content: [['行号', '开始时间', '建造时间', '消耗人力', '消耗弹药', '消耗口粮', '消耗零件']],
      });
      const originalData = makeTableData({ sheet_empty: emptySheet });
      bridge.loadFromTableData(originalData);

      const exported = bridge.exportToTableData(makeMate());
      const sheet = exported.sheet_empty as Sheet_ACU;

      expect(sheet.content).toHaveLength(1);
      expect(sheet.content[0]).toEqual(['row_id', '开始时间', '建造时间', '消耗人力', '消耗弹药', '消耗口粮', '消耗零件']);
    });

    it('引擎未初始化时抛出错误', () => {
      engine.dispose();
      expect(() => bridge.exportToTableData(makeMate())).toThrow('未初始化');
    });

    it('strict 模式下用户表缺失元数据时 fail closed', () => {
      bridge.loadFromTableData(makeTableData({ sheet_0: makeSheet() }));
      engine.run('CREATE TABLE orphan_table (row_id INTEGER PRIMARY KEY, value TEXT);');

      expect(() => bridge.exportToTableData(makeMate(), { strict: true }))
        .toThrow('缺少可识别的元数据');
    });

    it('strict 模式下单表导出失败时向上抛出', () => {
      const originalData = makeTableData({ sheet_0: makeSheet() });
      const tableName = getRuntimeTableName(originalData, 'sheet_0');
      bridge.loadFromTableData(originalData);
      const originalQuery = engine.query.bind(engine);
      const querySpy = vi.spyOn(engine, 'query').mockImplementation((sql: string, params?: any, options?: any) => {
        if (sql === `SELECT * FROM ${tableName};`) throw new Error('sheet export boom');
        return originalQuery(sql, params, options);
      });

      expect(() => bridge.exportToTableData(makeMate(), { strict: true }))
        .toThrow('sheet export boom');
      querySpy.mockRestore();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // syncToJson
  // ═══════════════════════════════════════════════════════════════
  describe('syncToJson', () => {
    it('同步 SQLite 数据到 JSON 视图', () => {
      const originalData = makeTableData({ sheet_0: makeSheet() });
      const tableName = getRuntimeTableName(originalData, 'sheet_0');
      bridge.loadFromTableData(originalData);

      // 在 SQLite 中修改数据
      engine.run(`UPDATE ${tableName} SET quantity = 10 WHERE item_name = '铁剑';`);

      // 同步到 JSON
      const synced = bridge.syncToJson(originalData);
      const sheetKeys = Object.keys(synced).filter(k => k.startsWith('sheet_'));
      const sheet = synced[sheetKeys[0]] as Sheet_ACU;

      // 验证修改已同步
      // 找到铁剑那行，检查数量
      const ironSwordRow = sheet.content.find(row => row.includes('铁剑'));
      expect(ironSwordRow).toBeDefined();
      // quantity 列的值应该是 '10'（content 中全是 string）
      expect(ironSwordRow).toContain('10');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 元数据保存与恢复
  // ═══════════════════════════════════════════════════════════════
  describe('元数据保存与恢复', () => {
    it('sourceData 在导出后保留', () => {
      const originalData = makeTableData({ sheet_0: makeSheet() });
      bridge.loadFromTableData(originalData);

      const exported = bridge.exportToTableData(makeMate());
      const sheetKeys = Object.keys(exported).filter(k => k.startsWith('sheet_'));
      const sheet = exported[sheetKeys[0]] as Sheet_ACU;

      expect(sheet.sourceData).toBeDefined();
      expect(sheet.sourceData.ddl).toContain('CREATE TABLE inventory');
    });

    it('uid 和 name 在导出后保留', () => {
      const originalData = makeTableData({ sheet_0: makeSheet() });
      bridge.loadFromTableData(originalData);

      const exported = bridge.exportToTableData(makeMate());
      const sheetKeys = Object.keys(exported).filter(k => k.startsWith('sheet_'));
      const sheet = exported[sheetKeys[0]] as Sheet_ACU;

      expect(sheet.uid).toBe('inventory');
      expect(sheet.name).toBe('背包物品表');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // meta 物理名列 + 多路识别（健全化读取）
  // ═══════════════════════════════════════════════════════════════
  describe('meta 多路识别', () => {
    it('_acu_sheet_meta 记录 physical_table_name，值等于实际建表名', () => {
      const data = makeTableData({ sheet_0: makeSheet() });
      const tableName = getRuntimeTableName(data, 'sheet_0');
      bridge.loadFromTableData(data);

      const meta = engine.query('SELECT physical_table_name FROM _acu_sheet_meta WHERE sheet_key = ?;', ['sheet_0']);
      expect(meta.values[0][0]).toBe(tableName);
    });

    it('路径1：meta 存储物理名可反查导出，即使实际表名是历史 hash 形态', () => {
      // 模拟老库：物理表名带历史 hash 后缀，且 meta 里存的就是这个历史名。
      const legacyTable = 'beibaowupinbiao_deadbeef01';
      engine.run(`CREATE TABLE ${legacyTable} ( -- 背包物品表\n  row_id INTEGER PRIMARY KEY, -- 行号\n  item_name TEXT -- 物品名称\n);`);
      engine.run(`INSERT INTO ${legacyTable} (row_id, item_name) VALUES (1, '铁剑');`);
      engine.run(`CREATE TABLE IF NOT EXISTS _acu_sheet_meta (
        sheet_key TEXT PRIMARY KEY, uid TEXT NOT NULL, name TEXT NOT NULL, order_no INTEGER DEFAULT 0,
        source_data_json TEXT, update_config_json TEXT, export_config_json TEXT, physical_table_name TEXT
      );`);
      engine.run(
        'INSERT INTO _acu_sheet_meta (sheet_key, uid, name, order_no, source_data_json, update_config_json, export_config_json, physical_table_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
        ['sheet_beibao', 'inventory', '背包物品表', 0, '{}', '{}', '{}', legacyTable],
      );

      const exported = bridge.exportToTableData(makeMate());
      expect(exported.sheet_beibao).toBeDefined();
      expect((exported.sheet_beibao as Sheet_ACU).name).toBe('背包物品表');
    });

    it('路径3：老库 meta 无 physical_table_name 且新算法算不出时，靠 DDL 内旧表名唯一命中导出', () => {
      // 老库：物理表名 = 用户 DDL 里写死的英文名，与显示名拼音不一致；meta 无物理名列。
      const legacyTable = 'legacy_chronicle';
      engine.run(`CREATE TABLE ${legacyTable} ( -- 纪要表\n  row_id INTEGER PRIMARY KEY, -- 行号\n  summary TEXT -- 概览\n);`);
      engine.run(`INSERT INTO ${legacyTable} (row_id, summary) VALUES (1, '摘要');`);
      // 仅建老结构（无 physical_table_name 列），模拟未迁移库。
      engine.run(`CREATE TABLE IF NOT EXISTS _acu_sheet_meta (
        sheet_key TEXT PRIMARY KEY, uid TEXT NOT NULL, name TEXT NOT NULL, order_no INTEGER DEFAULT 0,
        source_data_json TEXT, update_config_json TEXT, export_config_json TEXT
      );`);
      const ddl = `CREATE TABLE ${legacyTable} ( -- 纪要表\n  row_id INTEGER PRIMARY KEY, -- 行号\n  summary TEXT -- 概览\n);`;
      // 显示名故意留空，逼新算法路径失效，仅剩 DDL 别名路径。
      engine.run(
     'INSERT INTO _acu_sheet_meta (sheet_key, uid, name, order_no, source_data_json, update_config_json, export_config_json) VALUES (?, ?, ?, ?, ?, ?, ?);',
        ['sheet_chronicle', 'chronicle', 'X', 0, JSON.stringify({ ddl }), '{}', '{}'],
      );

      const exported = bridge.exportToTableData(makeMate());
      expect(exported.sheet_chronicle).toBeDefined();
      expect((exported.sheet_chronicle as Sheet_ACU).content).toEqual([
        ['row_id', '概览'],
        ['1', '摘要'],
      ]);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 无 DDL 的 fallback 模式
  // ═══════════════════════════════════════════════════════════════
  describe('无 DDL 的 fallback 模式', () => {
    it('无 DDL 时自动生成全 TEXT DDL', () => {
      const sheet = makeSheet({
        sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '' },
        content: [
          ['row_id', 'name', 'value'],
          ['1', 'test', '100'],
        ],
      });
      const data = makeTableData({ sheet_0: sheet });
      bridge.loadFromTableData(data);

      // 表应该被创建（使用 uid 作为表名）
      const tableNames = engine.getTableNames();
      expect(tableNames.length).toBeGreaterThan(0);

      // 数据应该被灌入
      const tableName = tableNames[0];
      const result = engine.query(`SELECT * FROM ${tableName};`);
      expect(result.values).toHaveLength(1);
    });

    it('中文表名+中文表头端到端 hydrate：物理名为拼音 slug，列全 TEXT，数据可读回（T4.2）', () => {
      const sheet = makeSheet({
        uid: 'sheet_tianqi',
        name: '天气表',
        sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '' },
        content: [
          ['row_id', '天气状况', '温度'],
          ['1', '晴', '28'],
          ['2', '多云', '24'],
        ],
      });
      const data = makeTableData({ sheet_tianqi: sheet });
      bridge.loadFromTableData(data);

      // 物理表名来自中文表名的拼音 slug（toAsciiSlug_ACU），且去除下划线
      // （见 sheet-identity.ts:145 physicalTableNameBase_ACU 的 .replace(/_/g, '')）。
      const tableNames = engine.getTableNames();
      expect(tableNames).toContain('tianqibiao');
      const ddl = engine.getTableDDL('tianqibiao');
      expect(ddl).toContain('CREATE TABLE tianqibiao');
      expect(ddl).toContain('row_id INTEGER PRIMARY KEY');
      // 其余列全 TEXT，物理列名保留 slug 下划线（列名不经过表名的去下划线规则）
      expect(ddl).toContain('tian_qi_zhuang_kuang TEXT');
      expect(ddl).toContain('wen_du TEXT');

      const result = engine.query('SELECT * FROM tianqibiao;');
      expect(result.columns).toEqual(['row_id', 'tian_qi_zhuang_kuang', 'wen_du']);
      expect(result.values).toEqual([
        [1, '晴', '28'],
        [2, '多云', '24'],
      ]);
    });

    it('test31 两组真实中文表头 fallback 后，PRAGMA table_info 与 runtime effective columnMap 完全一致', () => {
      const storyHeaders = ['row_id', '时间范围', '大纲概要', '事件意义', '相关人物', '相关物品', '编码索引'];
      const placeHeaders = ['row_id', '地点名称', '地点类型', '地点描述', '所属区域', '关联事件', '剧情意义'];
      const data = makeTableData({
        sheet_gushidagang: makeSheet({
          uid: 'gushidagangbiao',
          name: '故事大纲表',
          sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '' },
          content: [storyHeaders, ['1', '起点', '开局', '相遇', '主角', '信物', 'A001']],
        }),
        sheet_zhongyaodidian: makeSheet({
          uid: 'zhongyaodidianbiao',
          name: '重要地点表',
          sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '' },
          content: [placeHeaders, ['1', '指挥室', '室内', '中央房间', '总部', '开场', '关键']],
        }),
      });
      bridge.loadFromTableData(data);

      const gushidagang = bridge.exportToTableData(makeMate()).sheet_gushidagang as Sheet_ACU & { _acu_runtimeEffectiveSchema?: any };
      const zhongyaodidian = bridge.exportToTableData(makeMate()).sheet_zhongyaodidian as Sheet_ACU & { _acu_runtimeEffectiveSchema?: any };
      const expectedStory = ['row_id', 'shi_jian_fan_wei', 'da_gang_gai_yao', 'shi_jian_yi_yi', 'xiang_guan_ren_wu', 'xiang_guan_wu_pin', 'bian_ma_suo_yin'];
      const expectedPlace = ['row_id', 'di_dian_ming_cheng', 'di_dian_lei_xing', 'di_dian_miao_shu', 'suo_shu_qu_yu', 'guan_lian_shi_jian', 'ju_qing_yi_yi'];

      // runtime effective schema 的 columnMap 就是 SQLite 实际列序。
      expect(gushidagang._acu_runtimeEffectiveSchema.columnMap.mappings.map((m: any) => m.sqlName)).toEqual(expectedStory);
      expect(zhongyaodidian._acu_runtimeEffectiveSchema.columnMap.mappings.map((m: any) => m.sqlName)).toEqual(expectedPlace);

      // PRAGMA table_info 列序与 columnMap 完全一致：SQLite 实际 schema 是唯一权威。
      for (const [tableName, expected] of [['gushidagangbiao', expectedStory], ['zhongyaodidianbiao', expectedPlace]] as const) {
        const tableInfo = engine.getTableInfo(tableName);
        expect(tableInfo.map(column => column.name)).toEqual(expected);
      }

      // 错误拼写绝不出现在 runtime schema 中。
      expect(expectedStory).not.toContain('xi_xiang_guan_wu_pin');
      expect(expectedPlace).not.toContain('di_di_an_lei_xing');
    });
  });
});
