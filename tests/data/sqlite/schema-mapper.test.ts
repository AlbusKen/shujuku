/**
 * tests/data/sqlite/schema-mapper.test.ts
 * schema-mapper 纯函数单元测试
 */
import { describe, it, expect } from 'vitest';
import {
  generateDDL,
  generateFallbackDDL,
  generateInserts,
  resultToContent,
  validateDDLAgainstHeaders,
  parseDDLTableName,
  parseDDLChineseName,
  parseDDLColumnNames,
  parseDDLColumnComments,
  buildColumnNameMap,
  parseDDLColumnInfos_ACU,
  resolveEffectiveDDL,
} from '../../../src/data/sqlite/schema-mapper';
import {
  getSheetColumnProjection_ACU,
  parseDDLTableSuffix_ACU,
  parseDDLSafeDefaultLiteral_ACU,
  projectSheetDDLForVisibleColumns_ACU,
  projectSheetRowToVisibleColumns_ACU,
  removeDDLColumnAtIndex_ACU,
  downgradeRowIdPrimaryKeyForLegacyReplay_ACU,
} from '../../../src/shared/ddl-utils';
import type { Sheet_ACU } from '../../../src/shared/models/table-data';

// ═══════════════════════════════════════════════════════════════
// 辅助：构造最小 Sheet_ACU mock
// ═══════════════════════════════════════════════════════════════
function makeSheet(overrides: Partial<Sheet_ACU> = {}): Sheet_ACU {
  return {
    uid: 'test_table',
    name: '测试表',
    sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '' },
    content: [
      ['row_id', '姓名', '年龄'],
      ['1', '张三', '25'],
      ['2', '李四', '30'],
    ],
    updateConfig: { uiSentinel: 0, contextDepth: 0, updateFrequency: 0, batchSize: 0, skipFloors: 0 },
    exportConfig: {} as any,
    orderNo: 0,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// parseDDLTableName
// ═══════════════════════════════════════════════════════════════
describe('parseDDLTableName', () => {
  it('解析标准 CREATE TABLE 语句的表名', () => {
    expect(parseDDLTableName('CREATE TABLE inventory (\n  row_id INTEGER PRIMARY KEY\n);')).toBe('inventory');
  });

  it('解析带 IF NOT EXISTS 的表名', () => {
    expect(parseDDLTableName('CREATE TABLE IF NOT EXISTS my_table (id INTEGER);')).toBe('my_table');
  });

  it('跳过前置注释并保留含括号的 quoted identifier', () => {
    expect(parseDDLTableName(`-- CREATE TABLE decoy (
      CREATE TABLE IF NOT EXISTS "inventory(x)" (row_id INTEGER PRIMARY KEY);`)).toBe('"inventory(x)"');
    expect(parseDDLTableName(`/* CREATE TABLE decoy ( */
      CREATE TABLE [inventory(x)]]archive] (row_id INTEGER PRIMARY KEY);`)).toBe('[inventory(x)]]archive]');
  });

  it('保留 escaped backtick identifier', () => {
    expect(parseDDLTableName('CREATE TABLE `inventory(x)``archive` (row_id INTEGER PRIMARY KEY);')).toBe('`inventory(x)``archive`');
  });

  it('空字符串返回 null', () => {
    expect(parseDDLTableName('')).toBeNull();
  });

  it('无效 DDL 返回 null', () => {
    expect(parseDDLTableName('SELECT * FROM foo')).toBeNull();
  });

  it('大小写不敏感', () => {
    expect(parseDDLTableName('create table Foo (id int);')).toBe('Foo');
  });
});

// ═══════════════════════════════════════════════════════════════
// parseDDLChineseName
// ═══════════════════════════════════════════════════════════════
describe('parseDDLChineseName', () => {
  it('解析第一行注释中的中文表名', () => {
    expect(parseDDLChineseName('CREATE TABLE inventory (  -- 背包物品表\n  row_id INTEGER\n);')).toBe('背包物品表');
  });

  it('无注释返回 null', () => {
    expect(parseDDLChineseName('CREATE TABLE inventory (\n  row_id INTEGER\n);')).toBeNull();
  });

  it('空字符串返回 null', () => {
    expect(parseDDLChineseName('')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// parseDDLColumnNames
// ═══════════════════════════════════════════════════════════════
describe('parseDDLColumnNames', () => {
  it('解析标准 DDL 的列名', () => {
    const ddl = `CREATE TABLE inventory (
      row_id INTEGER PRIMARY KEY,
      item_name TEXT NOT NULL,
      quantity INTEGER DEFAULT 1
    );`;
    expect(parseDDLColumnNames(ddl)).toEqual(['row_id', 'item_name', 'quantity']);
  });

  it('处理 CHECK 约束中的嵌套括号', () => {
    const ddl = `CREATE TABLE inventory (
      row_id INTEGER PRIMARY KEY,
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      status TEXT CHECK(status IN ('active', 'inactive'))
    );`;
    const cols = parseDDLColumnNames(ddl);
    expect(cols).toEqual(['row_id', 'quantity', 'status']);
  });

  it('跳过表级约束', () => {
    const ddl = `CREATE TABLE test (
      id INTEGER,
      name TEXT,
      PRIMARY KEY (id),
      UNIQUE (name)
    );`;
    expect(parseDDLColumnNames(ddl)).toEqual(['id', 'name']);
  });

  it('空 DDL 返回空数组', () => {
    expect(parseDDLColumnNames('')).toEqual([]);
  });

  it('无括号的无效 DDL 返回空数组', () => {
    expect(parseDDLColumnNames('CREATE TABLE foo')).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// parseDDLColumnComments
// ═══════════════════════════════════════════════════════════════
describe('parseDDLColumnComments', () => {
  it('解析列名到注释的映射', () => {
    const ddl = `CREATE TABLE inventory ( -- 背包物品表
      row_id INTEGER PRIMARY KEY, -- 行号
      item_name TEXT NOT NULL, -- 物品名称
      quantity INTEGER DEFAULT 1 -- 数量
    );`;
    const comments = parseDDLColumnComments(ddl);
    expect(comments.get('row_id')).toBe('行号');
    expect(comments.get('item_name')).toBe('物品名称');
    expect(comments.get('quantity')).toBe('数量');
  });

  it('无注释的列不在映射中', () => {
    const ddl = `CREATE TABLE test (
      id INTEGER PRIMARY KEY,
      name TEXT -- 姓名
    );`;
    const comments = parseDDLColumnComments(ddl);
    expect(comments.has('id')).toBe(false);
    expect(comments.get('name')).toBe('姓名');
  });

  it('空 DDL 返回空 Map', () => {
    expect(parseDDLColumnComments('').size).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// buildColumnNameMap
// ═══════════════════════════════════════════════════════════════
describe('buildColumnNameMap', () => {
  it('构建双向映射', () => {
    const ddl = `CREATE TABLE inventory (
      row_id INTEGER PRIMARY KEY, -- 行号
      item_name TEXT, -- 物品名称
      quantity INTEGER -- 数量
    );`;
    const { sqlToChinese, chineseToSql } = buildColumnNameMap(ddl);
    expect(sqlToChinese.get('item_name')).toBe('物品名称');
    expect(chineseToSql.get('物品名称')).toBe('item_name');
    expect(sqlToChinese.get('quantity')).toBe('数量');
    expect(chineseToSql.get('数量')).toBe('quantity');
  });
});

// ═══════════════════════════════════════════════════════════════
// parseDDLColumnInfos_ACU
// ═══════════════════════════════════════════════════════════════
describe('parseDDLColumnInfos_ACU', () => {
  it('保留含逗号字符串 DEFAULT 的完整列定义与约束信息', () => {
    const ddl = `CREATE TABLE inventory (
      row_id INTEGER PRIMARY KEY, -- 行号
      item_name TEXT NOT NULL, -- 名称
      status TEXT NOT NULL DEFAULT 'pending, review' -- 状态
    );`;

    expect(parseDDLColumnInfos_ACU(ddl)).toEqual(expect.arrayContaining([
      expect.objectContaining({ index: 0, sqlName: 'row_id', declaredType: 'INTEGER', comment: '行号', isPrimaryKey: true, isNotNull: false, hasDefault: false, normalizedDefinition: 'row_id INTEGER PRIMARY KEY' }),
      expect.objectContaining({ index: 1, sqlName: 'item_name', declaredType: 'TEXT', comment: '名称', isPrimaryKey: false, isNotNull: true, hasDefault: false, normalizedDefinition: 'item_name TEXT NOT NULL' }),
      expect.objectContaining({ index: 2, sqlName: 'status', declaredType: 'TEXT', comment: '状态', isPrimaryKey: false, isNotNull: true, hasDefault: true, normalizedDefinition: "status TEXT NOT NULL DEFAULT 'pending, review'" }),
    ]));
  });

  it('CHECK 字符串中的 DEFAULT 不会被误判为列级默认值', () => {
    const ddl = `CREATE TABLE inventory (
      row_id INTEGER PRIMARY KEY, -- 行号
      name TEXT NOT NULL CHECK(name <> 'DEFAULT') -- 名称
    );`;

    expect(parseDDLColumnInfos_ACU(ddl)[1]).toMatchObject({ declaredType: 'TEXT', isNotNull: true, hasDefault: false });
  });

  it('块注释中的 DEFAULT 不会被误判为列级默认值', () => {
    const ddl = `CREATE TABLE inventory (
      row_id INTEGER PRIMARY KEY, -- 行号
      name TEXT NOT NULL /* DEFAULT 仅为说明 */ -- 名称
    );`;

    expect(parseDDLColumnInfos_ACU(ddl)[1]).toMatchObject({ declaredType: 'TEXT', isNotNull: true, hasDefault: false });
  });

  it('保留 DEFAULT 的精确 literal，并拒绝需要执行 SQL 的表达式', () => {
    const ddl = `CREATE TABLE inventory (
      row_id INTEGER PRIMARY KEY,
      title TEXT DEFAULT 'it''s, safe',
      amount REAL DEFAULT -1.25e+2,
      enabled INTEGER DEFAULT TRUE,
      payload BLOB DEFAULT X'00FF',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      random_value INTEGER DEFAULT (abs(-1))
    );`;
    const columns = parseDDLColumnInfos_ACU(ddl);

    expect(columns[1]).toMatchObject({ hasDefault: true, defaultExpression: "'it''s, safe'" });
    expect(columns[2]).toMatchObject({ hasDefault: true, defaultExpression: '-1.25e+2' });
    expect(columns[3]).toMatchObject({ hasDefault: true, defaultExpression: 'TRUE' });
    expect(columns[4]).toMatchObject({ hasDefault: true, defaultExpression: "X'00FF'" });
    expect(columns[5]).toMatchObject({ hasDefault: true, defaultExpression: 'CURRENT_TIMESTAMP' });
    expect(columns[6]).toMatchObject({ hasDefault: true, defaultExpression: '(abs(-1))' });
    expect(parseDDLSafeDefaultLiteral_ACU(columns[1].defaultExpression)).toEqual({ kind: 'string', sql: "'it''s, safe'", value: "it's, safe" });
    expect(parseDDLSafeDefaultLiteral_ACU(columns[2].defaultExpression)).toEqual({ kind: 'real', sql: '-1.25e+2', value: -125 });
    expect(parseDDLSafeDefaultLiteral_ACU(columns[3].defaultExpression)).toEqual({ kind: 'boolean', sql: 'TRUE', value: true });
    expect(parseDDLSafeDefaultLiteral_ACU(columns[4].defaultExpression)).toEqual({ kind: 'blob', sql: "X'00FF'", value: '00FF' });
    expect(parseDDLSafeDefaultLiteral_ACU(columns[5].defaultExpression)).toBeNull();
    expect(parseDDLSafeDefaultLiteral_ACU(columns[6].defaultExpression)).toBeNull();
  });

  it('DEFAULT 后的约束不属于 defaultExpression', () => {
    const ddl = 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, score INTEGER DEFAULT 0 NOT NULL CHECK(score >= 0));';
    expect(parseDDLColumnInfos_ACU(ddl)[1]).toMatchObject({ hasDefault: true, defaultExpression: '0' });
  });
});

describe('downgradeRowIdPrimaryKeyForLegacyReplay_ACU', () => {
  it.each([
    ['plain', 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT NOT NULL);'],
    ['autoincrement', 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);'],
    ['check retained', 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY CHECK (row_id > 0), name TEXT NOT NULL);'],
  ])('仅移除 %s DDL 的 row_id 主键约束', (_label, ddl) => {
    const downgraded = downgradeRowIdPrimaryKeyForLegacyReplay_ACU(ddl);

    expect(downgraded).not.toMatch(/\bPRIMARY\s+KEY\b/i);
    expect(downgraded).not.toMatch(/\bAUTOINCREMENT\b/i);
    expect(downgraded).toContain('name TEXT NOT NULL');
  });

  it('保留与 row_id 唯一性无关的列级和表级约束', () => {
    const ddl = "CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT UNIQUE CHECK(name <> ''), owner_id INTEGER REFERENCES owners(id), CONSTRAINT inventory_name_unique UNIQUE (name));";

    const downgraded = downgradeRowIdPrimaryKeyForLegacyReplay_ACU(ddl);

    expect(downgraded).not.toMatch(/row_id\s+INTEGER\s+PRIMARY\s+KEY/i);
    expect(downgraded).toContain("name TEXT UNIQUE CHECK(name <> '')");
    expect(downgraded).toContain('REFERENCES owners(id)');
    expect(downgraded).toContain('CONSTRAINT inventory_name_unique UNIQUE (name)');
  });

  it('降级带首列前置块注释的 DDL 并保留注释', () => {
    const ddl = `CREATE TABLE inventory (
      /* misleading ) */ row_id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    );`;

    const downgraded = downgradeRowIdPrimaryKeyForLegacyReplay_ACU(ddl);

    expect(downgraded).not.toMatch(/\bPRIMARY\s+KEY\b/i);
    expect(downgraded).not.toMatch(/\bAUTOINCREMENT\b/i);
    expect(downgraded).toContain('/* misleading ) */');
    expect(downgraded).toContain('name TEXT NOT NULL');
  });

  it('拒绝移除 row_id 主键后会失效的 WITHOUT ROWID 表', () => {
    expect(() => downgradeRowIdPrimaryKeyForLegacyReplay_ACU(
      'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT) WITHOUT ROWID;',
    )).toThrow('不支持 WITHOUT ROWID 表');
  });
});

// ═══════════════════════════════════════════════════════════════
// parseDDLTableSuffix_ACU
// ═══════════════════════════════════════════════════════════════
describe('parseDDLTableSuffix_ACU', () => {
  it.each([
    ['空 suffix', 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY);', ''],
    ['STRICT 与空白分号', 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY)   STRICT  ;  ', 'STRICT'],
    ['WITHOUT ROWID', 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY) WITHOUT ROWID;', 'WITHOUT ROWID'],
    ['前置行注释和带括号 quoted identifier', `-- misleading ( before CREATE TABLE
      CREATE TABLE IF NOT EXISTS "inventory(x)" (row_id INTEGER PRIMARY KEY) STRICT;`, 'STRICT'],
    ['前置块注释和 bracket identifier', `/* misleading ) ( */
      CREATE TABLE [inventory(x)]]archive] (row_id INTEGER PRIMARY KEY) WITHOUT ROWID;`, 'WITHOUT ROWID'],
    ['组合 suffix', 'CREATE TABLE `inventory(x)` (row_id INTEGER PRIMARY KEY) STRICT, WITHOUT ROWID;', 'STRICT, WITHOUT ROWID'],
    ['嵌套 CHECK、引号和注释', `CREATE TABLE inventory (
      row_id INTEGER PRIMARY KEY,
      value TEXT CHECK (value IN ('(', ')')), -- ) must not close the table
      note TEXT /* ) must not close the table */
    ) STRICT -- suffix comment
    ;`, 'STRICT'],
  ])('%s 被稳定规范化', (_name, ddl, expected) => {
    expect(parseDDLTableSuffix_ACU(ddl)).toBe(expected);
  });
});

describe('hiddenPhysicalColumns projection', () => {
  const sheet = makeSheet({
    sourceData: {
      note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '',
      ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT, legacy_note TEXT, quantity INTEGER);',
      hiddenPhysicalColumns: ['legacy_note'],
    },
    content: [
      ['row_id', '名称', '旧备注', '数量'],
      ['1', '铁剑', '历史秘密', '3'],
    ],
  });

  it('按 physical column 投影 DDL 与行，并保留右侧可见列 sourceIndex', () => {
    const projection = getSheetColumnProjection_ACU(sheet);
    expect(projection.visibleColumns.map(column => ({ physicalName: column.physicalName, sourceIndex: column.sourceIndex }))).toEqual([
      { physicalName: 'row_id', sourceIndex: 0 },
      { physicalName: 'item_name', sourceIndex: 1 },
      { physicalName: 'quantity', sourceIndex: 3 },
    ]);
    expect(projectSheetDDLForVisibleColumns_ACU(sheet)).not.toContain('legacy_note');
    expect(projectSheetRowToVisibleColumns_ACU(sheet, sheet.content[1])).toEqual(['1', '铁剑', '3']);
    expect(sheet.content[1]).toEqual(['1', '铁剑', '历史秘密', '3']);
  });
  it('隐藏列投影保留剩余列的中文注释', () => {
    // 注释是中文表头与 SQL 列名的唯一映射依据。投影时丢掉注释会让
    // resolveInsertColumnMappings 匹配不到任何列，以「表头没有对应的 DDL 列」拒绝写入；
    // prompt 里的 AI 也会失去列语义。
    const commented = makeSheet({
      sourceData: {
        note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '',
        ddl: [
          'CREATE TABLE inventory (',
          '  row_id INTEGER PRIMARY KEY, -- 行号',
          '  item_name TEXT, -- 名称',
          '  legacy_note TEXT, -- 旧备注',
          '  quantity INTEGER -- 数量',
          ');',
        ].join('\n'),
        hiddenPhysicalColumns: ['legacy_note'],
      },
      content: [
        ['row_id', '名称', '旧备注', '数量'],
        ['1', '铁剑', '历史秘密', '3'],
      ],
    });

    const projected = projectSheetDDLForVisibleColumns_ACU(commented);
    expect(projected).not.toContain('legacy_note');
    expect(projected).not.toContain('旧备注');
    expect(projected).toContain('-- 行号');
    expect(projected).toContain('-- 名称');
    expect(projected).toContain('-- 数量');
  });



  it('非法 hiddenPhysicalColumns 配置 fail closed', () => {
    expect(() => getSheetColumnProjection_ACU({ ...sheet, sourceData: { ...sheet.sourceData, hiddenPhysicalColumns: 'legacy_note' as any } }))
      .toThrow('必须是 physical column 字符串数组');
    expect(() => getSheetColumnProjection_ACU({ ...sheet, sourceData: { ...sheet.sourceData, hiddenPhysicalColumns: ['legacy_note', 'LEGACY_NOTE'] } }))
      .toThrow('大小写不敏感的重复');
    expect(() => getSheetColumnProjection_ACU({ ...sheet, sourceData: { ...sheet.sourceData, hiddenPhysicalColumns: ['row_id'] } }))
      .toThrow('row_id 不允许隐藏');
    expect(() => getSheetColumnProjection_ACU({ ...sheet, sourceData: { ...sheet.sourceData, hiddenPhysicalColumns: ['missing_col'] } }))
      .toThrow('指向不存在的 physical column');
  });

  it('DDL 与表头无法完整对齐时按名匹配隐藏列，而不是拒绝投影', () => {
    // 模板范围投影会构造「模板列少于运行时列」的形态：DDL 列数与 content[0] 不等。
    // 此时不再抛错，而是按 DDL 物理名 / 表头名匹配隐藏列。
    const projection = getSheetColumnProjection_ACU({
      ...sheet,
      sourceData: {
        ...sheet.sourceData,
        ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT, legacy_note TEXT);',
      },
    });
    // legacy_note 在 DDL 里存在，仍应被识别为隐藏列。
    expect(projection.hiddenPhysicalColumns).toEqual(['legacy_note']);
    expect(projection.visibleColumns.some(column => column.header === '旧备注')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// generateDDL
// ═══════════════════════════════════════════════════════════════
describe('generateDDL', () => {
  it('优先使用 sourceData.ddl', () => {
    const sheet = makeSheet({
      sourceData: {
        note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '',
        ddl: 'CREATE TABLE custom_table (\n  row_id INTEGER PRIMARY KEY\n);',
      },
    });
    expect(generateDDL(sheet)).toBe('CREATE TABLE custom_table (\n  row_id INTEGER PRIMARY KEY\n);');
  });

  it('无 DDL 时 fallback 生成全 TEXT DDL', () => {
    const sheet = makeSheet();
    const ddl = generateDDL(sheet);
    expect(ddl).toContain('CREATE TABLE');
    expect(ddl).toContain('row_id INTEGER PRIMARY KEY');
    expect(ddl).toContain('TEXT');
  });

  it('空 content 时生成最小 DDL', () => {
    const sheet = makeSheet({ content: [] });
    const ddl = generateDDL(sheet);
    expect(ddl).toContain('row_id INTEGER PRIMARY KEY');
  });
});

describe('resolveEffectiveDDL', () => {
  it('无 DDL 时返回 fallback_missing 并生成 row_id INTEGER PRIMARY KEY + 全 TEXT（T4.1）', () => {
    const sheet = makeSheet({
      sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '' },
      content: [['row_id', '姓名', '年龄'], ['1', '张三', '25']],
    });

    const resolved = resolveEffectiveDDL(sheet, 'sheet_people', 'ren_yuan_biao');

    expect(resolved.source).toBe('fallback_missing');
    expect(resolved.effectiveDDL).toContain('CREATE TABLE ren_yuan_biao');
    expect(resolved.effectiveDDL).toContain('row_id INTEGER PRIMARY KEY');
    expect(resolved.effectiveDDL).toContain('xing_ming TEXT');
    expect(resolved.effectiveDDL).toContain('nian_ling TEXT');
    // 物理表名走拼音：中文表名 → slug
    expect(resolved.effectiveDDL).not.toContain('sheet_people');
  });

  it('非法显式 DDL 仅生成 runtime fallback，不改写 sourceData.ddl', () => {
    const sheet = makeSheet({
      sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '', ddl: 'CREATE TABLE broken ( INVALID SYNTAX;' },
      content: [['row_id', '姓名', '状态'], ['1', 'A', '就绪']],
    });

    const resolved = resolveEffectiveDDL(sheet, 'sheet_runtime');

    expect(resolved.source).toBe('fallback_invalid');
    expect(resolved.effectiveDDL).toContain('CREATE TABLE sheet_runtime');
    expect(resolved.effectiveDDL).toContain('xing_ming TEXT');
    expect(resolved.columnMap.mappings.map(mapping => mapping.sqlName)).toEqual(['row_id', 'xing_ming', 'zhuang_tai']);
    expect(sheet.sourceData.ddl).toBe('CREATE TABLE broken ( INVALID SYNTAX;');
  });

  it('fallback columnMap 与 DDL 对中文、保留字和同音字物理冲突保持一致', () => {
    const sheet = makeSheet({
      content: [['row_id', '物品名称', 'select', '理想', '离乡'], ['1', '铁剑', 'x', 'A', 'B']],
    });

    const resolved = resolveEffectiveDDL(sheet, 'sheet_mapping');

    expect(resolved.source).toBe('fallback_missing');
    expect(resolved.columnMap.mappings.map(mapping => mapping.sqlName)).toEqual(['row_id', 'wu_pin_ming_cheng', 'col_select', 'li_xiang', 'li_xiang_2']);
    for (const mapping of resolved.columnMap.mappings.slice(1)) {
      expect(resolved.effectiveDDL).toMatch(new RegExp(`${mapping.sqlName} TEXT,? -- ${mapping.displayName}`));
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// generateFallbackDDL
// ═══════════════════════════════════════════════════════════════
describe('generateFallbackDDL', () => {
  it('第一列 row_id 映射为 INTEGER PRIMARY KEY', () => {
    const ddl = generateFallbackDDL('test_table', ['row_id', '姓名', '年龄']);
    expect(ddl).toContain('row_id INTEGER PRIMARY KEY');
  });

  it('ASCII 列名保留为 SQL 标识符', () => {
    const ddl = generateFallbackDDL('test_table', ['row_id', 'name', 'age']);
    expect(ddl).toContain('name TEXT');
    expect(ddl).toContain('age TEXT');
  });

  it('中文列名生成稳定且唯一的 ASCII 物理列名，并保留表头注释', () => {
    const ddl = generateFallbackDDL('test_table', ['row_id', '姓名', '状态']);
    expect(ddl).toContain('xing_ming TEXT');
    expect(ddl).toContain('-- 姓名');
    expect(ddl).toContain('zhuang_tai TEXT -- 状态');
    expect(validateDDLAgainstHeaders(ddl, ['row_id', '姓名', '状态']).valid).toBe(true);
  });

  it('重复表头 fail-closed，不再生成 col_N 掩盖重复列', () => {
    expect(() => generateFallbackDDL('test_table', ['row_id', 'name', 'name']))
      .toThrow(/第 3 列/);
  });

  it('中间空列表头 fail-closed，不再生成 col_N 掩盖空列', () => {
    expect(() => generateFallbackDDL('test_table', ['row_id', '姓名', '', '状态']))
      .toThrow(/第 3 列/);
  });

  it('纯空格表头 fail-closed', () => {
    expect(() => generateFallbackDDL('test_table', ['row_id', '姓名', '   ', '状态']))
      .toThrow(/第 3 列/);
  });

  it('非首位 row_id fail-closed', () => {
    expect(() => generateFallbackDDL('test_table', ['姓名', 'row_id', '状态']))
      .toThrow(/row_id|首列|第 1 列/);
  });

  it('规范化重名（Name/name）fail-closed', () => {
    expect(() => generateFallbackDDL('test_table', ['row_id', 'Name', 'name']))
      .toThrow(/第 3 列/);
  });

  it('生成与验证共享同一份表头契约：合法表头生成后验证通过，空列生成失败且验证也失败', () => {
    const ddl = generateFallbackDDL('test_table', ['row_id', '姓名', '状态']);
    expect(validateDDLAgainstHeaders(ddl, ['row_id', '姓名', '状态']).valid).toBe(true);
    // 表头中间空列：验证侧同样 fail-closed，不再出现“生成 5 列/验证 4 列”的二次错误
    expect(validateDDLAgainstHeaders(ddl, ['row_id', '姓名', '', '状态']).valid).toBe(false);
  });

  it('中文表头生成稳定 ASCII 物理列并保留精确注释映射', () => {
    const ddl = generateFallbackDDL('test_table', ['row_id', '姓名', '状态']);
    expect(ddl).toContain('xing_ming TEXT');
    expect(ddl).toContain('-- 姓名');
    expect(ddl).toContain('zhuang_tai TEXT -- 状态');
    expect(validateDDLAgainstHeaders(ddl, ['row_id', '姓名', '状态']).valid).toBe(true);
  });

  it('规范化不同但物理 slug 相同的列仍用稳定后缀消歧', () => {
    // 中文同音不同字：canonical 不同（li_xiang_1/li_xiang_2 之类），slug 撞车
    const ddl = generateFallbackDDL('test_table', ['row_id', '理想', '离乡']);
    expect(ddl).toContain('li_xiang TEXT');
    expect(ddl).toContain('li_xiang_2 TEXT');
  });


  it('首列 null 占位（visualizer 不可编辑 row_id）映射为 row_id', () => {
    const ddl = generateFallbackDDL('test_table', [null, '姓名', '状态']);
    expect(ddl).toContain('row_id INTEGER PRIMARY KEY');
    expect(ddl).toContain('姓名');
    expect(validateDDLAgainstHeaders(ddl, [null, '姓名', '状态']).valid).toBe(true);
  });

  it('首列空字符串（非 null 占位）fail-closed', () => {
    expect(() => generateFallbackDDL('test_table', ['', '姓名', '状态']))
      .toThrow(/row_id|首列|第 1 列/);
  });
  it('空 headers 生成最小 DDL', () => {
    const ddl = generateFallbackDDL('test_table', []);
    expect(ddl).toContain('row_id INTEGER PRIMARY KEY');
  });
});

// ═══════════════════════════════════════════════════════════════
// generateInserts
// ═══════════════════════════════════════════════════════════════
describe('generateInserts', () => {
  it('从 content 生成 INSERT 语句', () => {
    const sheet = makeSheet();
    const inserts = generateInserts(sheet, 'test_table');
    expect(inserts).toHaveLength(2);
    expect(inserts[0]).toContain('INSERT INTO');
    expect(inserts[0]).not.toContain('INSERT OR REPLACE');
    expect(inserts[0]).toContain('test_table');
  });

  it('null 值转为 NULL', () => {
    const sheet = makeSheet({
      content: [
        ['row_id', 'name'],
        ['1', null],
      ],
    });
    const inserts = generateInserts(sheet, 'test_table');
    expect(inserts[0]).toContain('NULL');
  });

  it('空字符串保持为空字符串字面量而不是 NULL', () => {
    const sheet = makeSheet({
      content: [
        ['row_id', 'name', 'note'],
        ['1', '角色A', ''],
      ],
    });
    const inserts = generateInserts(sheet, 'test_table');
    expect(inserts[0]).toContain("'角色A', ''");
    expect(inserts[0]).not.toContain("'角色A', NULL");
  });

  it('数字字符串不加引号', () => {
    const sheet = makeSheet({
      content: [
        ['row_id', 'count'],
        ['1', '42'],
      ],
    });
    const inserts = generateInserts(sheet, 'test_table');
    expect(inserts[0]).toContain('42');
    // 42 不应该被引号包围
    expect(inserts[0]).not.toContain("'42'");
  });

  it('含单引号的字符串正确转义', () => {
    const sheet = makeSheet({
      content: [
        ['row_id', 'desc'],
        ['1', "it's a test"],
      ],
    });
    const inserts = generateInserts(sheet, 'test_table');
    expect(inserts[0]).toContain("it''s a test");
  });

  it('DDL 列顺序与旧中文表头错位时，按注释映射源值而不是按数组位置', () => {
    const sheet = makeSheet({
      uid: 'chronicle',
      sourceData: {
        note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '',
        ddl: `CREATE TABLE chronicle (
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

    const inserts = generateInserts(sheet, 'chronicle');

    expect(inserts).toEqual([
      "INSERT INTO chronicle (row_id, code_index, time_span, summary, chronicle_text, key_dialogue) VALUES (1, 'AM0001', '2026-10-15 14:30 ~ 2026-10-15 15:00', '摘要', '完整纪要正文', NULL);",
    ]);
  });

  it('ASCII 展示表头按 DDL 注释映射到物理列生成 INSERT', () => {
    const sheet = makeSheet({
      uid: 'battle_status',
      sourceData: {
        note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '',
        ddl: `CREATE TABLE battle_status (
  row_id INTEGER PRIMARY KEY, -- 行号
  hp_rp TEXT, -- HP/RP
  en TEXT -- EN
);`,
      },
      content: [
        ['row_id', 'HP/RP', 'EN'],
        ['1', '10/20', '8'],
      ],
    });

    expect(generateInserts(sheet, 'battle_status')).toEqual([
      "INSERT INTO battle_status (row_id, hp_rp, en) VALUES (1, '10/20', 8);",
    ]);
  });

  it('缺少有 DEFAULT 的新增列时省略该 INSERT 列以保留 SQL 默认值', () => {
    const sheet = makeSheet({
      sourceData: {
        note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '',
        ddl: `CREATE TABLE inventory (
  row_id INTEGER PRIMARY KEY, -- 行号
  item_name TEXT NOT NULL, -- 名称
  quantity INTEGER DEFAULT 1 -- 数量
);`,
      },
      content: [
        ['row_id', '名称'],
        ['1', '铁剑'],
      ],
    });

    expect(generateInserts(sheet, 'inventory')).toEqual([
      "INSERT INTO inventory (row_id, item_name) VALUES (1, '铁剑');",
    ]);
  });

  it('重复中文表头无法唯一映射时拒绝生成 INSERT', () => {
    const sheet = makeSheet({
      sourceData: {
        note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '',
        ddl: `CREATE TABLE inventory (
  row_id INTEGER PRIMARY KEY, -- 行号
  item_name TEXT NOT NULL -- 名称
);`,
      },
      content: [
        ['row_id', '名称', '名称'],
        ['1', '铁剑', '重复值'],
      ],
    });

    expect(() => generateInserts(sheet, 'inventory')).toThrow('snapshot 表头存在重复列');
  });

  it('未映射表头存在非空数据时拒绝静默丢弃', () => {
    const sheet = makeSheet({
      sourceData: {
        note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '',
        ddl: `CREATE TABLE inventory (
  row_id INTEGER PRIMARY KEY, -- 行号
  item_name TEXT NOT NULL -- 名称
);`,
      },
      content: [
        ['row_id', '名称', '旧字段'],
        ['1', '铁剑', '不能丢失'],
      ],
    });

    expect(() => generateInserts(sheet, 'inventory')).toThrow('拒绝丢弃非空数据');
  });

  it('仅 row_id 可识别时，即使等宽也拒绝猜测未知业务表头的位置', () => {
    const sheet = makeSheet({
      sourceData: {
        note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '',
        ddl: `CREATE TABLE legacy_inventory (
  row_id INTEGER PRIMARY KEY, -- 行号
  item_name TEXT NOT NULL, -- 名称
  quantity INTEGER NOT NULL -- 数量
);`,
      },
      content: [
        ['行号', '旧名称', '旧数量'],
        ['1', '铁剑', '3'],
      ],
    });

    expect(() => generateInserts(sheet, 'legacy_inventory')).toThrow('缺少必需 DDL 列');
  });

  it('未知业务表头即使看似保持 DDL 顺序也拒绝位置猜测', () => {
    const sheet = makeSheet({
      sourceData: {
        note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '',
        ddl: `CREATE TABLE legacy_inventory (
  row_id INTEGER PRIMARY KEY, -- 行号
  item_name TEXT NOT NULL, -- 名称
  quantity INTEGER NOT NULL -- 数量
);`,
      },
      content: [
        ['row_id', '旧名称', '旧数量'],
        ['1', '铁剑', '3'],
      ],
    });

    expect(() => generateInserts(sheet, 'legacy_inventory')).toThrow('缺少必需 DDL 列');
  });

  it('行号别名与完整 DDL 注释表头可确定性映射', () => {
    const sheet = makeSheet({
      sourceData: {
        note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '',
        ddl: `CREATE TABLE inventory (
  row_id INTEGER PRIMARY KEY, -- 行号
  item_name TEXT NOT NULL, -- 名称
  quantity INTEGER NOT NULL -- 数量
);`,
      },
      content: [
        ['行号', '名称', '数量'],
        ['1', '铁剑', '3'],
      ],
    });

    expect(generateInserts(sheet, 'inventory')).toEqual([
      "INSERT INTO inventory (row_id, item_name, quantity) VALUES (1, '铁剑', 3);",
    ]);
  });

  it('表级复合 PRIMARY KEY 不符合 canonical row_id 首列契约时拒绝 hydrate', () => {
    const sheet = makeSheet({
      sourceData: {
        note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '',
        ddl: `CREATE TABLE inventory (
  row_id INTEGER, -- 行号
  item_name TEXT NOT NULL, -- 名称
  PRIMARY KEY (row_id, item_name)
);`,
      },
      content: [
        ['row_id', '名称'],
        ['1', '铁剑'],
      ],
    });

    expect(() => generateInserts(sheet, 'inventory')).toThrow('DDL 必须以 row_id INTEGER PRIMARY KEY 作为首列');
  });

  it('row_id 不是 INTEGER 时拒绝 canonical hydrate', () => {
    const sheet = makeSheet({
      sourceData: {
        note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '',
        ddl: `CREATE TABLE inventory (
  row_id TEXT PRIMARY KEY, -- 行号
  item_name TEXT NOT NULL -- 名称
);`,
      },
      content: [
        ['row_id', '名称'],
        ['1', '铁剑'],
      ],
    });

    expect(() => generateInserts(sheet, 'inventory')).toThrow('DDL 必须以 row_id INTEGER PRIMARY KEY 作为首列');
  });

  it('CHECK 字符串含 DEFAULT 的 NOT NULL 列缺失表头时仍拒绝 hydrate', () => {
    const sheet = makeSheet({
      sourceData: {
        note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '',
        ddl: `CREATE TABLE inventory (
  row_id INTEGER PRIMARY KEY, -- 行号
  name TEXT NOT NULL CHECK(name <> 'DEFAULT') -- 名称
);`,
      },
      content: [
        ['row_id'],
        ['1'],
      ],
    });

    expect(() => generateInserts(sheet, 'inventory')).toThrow('缺少必需 DDL 列「name」');
  });

  it('块注释含 DEFAULT 的 NOT NULL 列缺失表头时仍拒绝 hydrate', () => {
    const sheet = makeSheet({
      sourceData: {
        note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '',
        ddl: `CREATE TABLE inventory (
  row_id INTEGER PRIMARY KEY, -- 行号
  name TEXT NOT NULL /* DEFAULT 仅为说明 */ -- 名称
);`,
      },
      content: [
        ['row_id'],
        ['1'],
      ],
    });

    expect(() => generateInserts(sheet, 'inventory')).toThrow('缺少必需 DDL 列「name」');
  });

  it('quoted row_id 不属于 canonical hydrate 支持的裸标识符契约时拒绝', () => {
    const sheet = makeSheet({
      sourceData: {
        note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '',
        ddl: `CREATE TABLE inventory (
  "row_id" INTEGER PRIMARY KEY, -- 行号
  item_name TEXT NOT NULL -- 名称
);`,
      },
      content: [
        ['row_id', '名称'],
        ['1', '铁剑'],
      ],
    });

    expect(() => generateInserts(sheet, 'inventory')).toThrow('DDL 必须以 row_id INTEGER PRIMARY KEY 作为首列');
  });

  it('空 content 返回空数组', () => {
    const sheet = makeSheet({ content: [] });
    expect(generateInserts(sheet, 'test_table')).toEqual([]);
  });

  it('只有表头没有数据行返回空数组', () => {
    const sheet = makeSheet({ content: [['row_id', 'name']] });
    expect(generateInserts(sheet, 'test_table')).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// resultToContent
// ═══════════════════════════════════════════════════════════════
describe('resultToContent', () => {
  it('将 SQL 结果转为 content 二维数组', () => {
    const columns = ['row_id', 'name', 'age'];
    const values: any[][] = [[1, '张三', 25], [2, '李四', 30]];
    const content = resultToContent(columns, values);
    expect(content[0]).toEqual(['row_id', 'name', 'age']);
    expect(content[1]).toEqual(['1', '张三', '25']);
    expect(content[2]).toEqual(['2', '李四', '30']);
  });

  it('使用中文表头映射', () => {
    const columns = ['row_id', 'item_name', 'quantity'];
    const values: any[][] = [[1, '铁剑', 3]];
    const chineseHeaders = new Map([['item_name', '物品名称'], ['quantity', '数量']]);
    const content = resultToContent(columns, values, chineseHeaders);
    expect(content[0]).toEqual(['row_id', '物品名称', '数量']);
  });

  it('null 值保持为 null', () => {
    const columns = ['row_id', 'name'];
    const values: any[][] = [[1, null]];
    const content = resultToContent(columns, values);
    expect(content[1][1]).toBeNull();
  });

  it('空结果返回只有 row_id 表头的数组', () => {
    const content = resultToContent([], []);
    expect(content).toEqual([['row_id']]);
  });

  it('Uint8Array 值转为 [BLOB]', () => {
    const columns = ['row_id', 'data'];
    const values: any[][] = [[1, new Uint8Array([1, 2, 3])]];
    const content = resultToContent(columns, values);
    expect(content[1][1]).toBe('[BLOB]');
  });
});

// ═══════════════════════════════════════════════════════════════
// validateDDLAgainstHeaders
// ═══════════════════════════════════════════════════════════════
describe('validateDDLAgainstHeaders', () => {
  it('匹配的 DDL 和表头返回 valid', () => {
    const ddl = `CREATE TABLE test (
      row_id INTEGER PRIMARY KEY, -- 行号
      name TEXT, -- 姓名
      age INTEGER -- 年龄
    );`;
    const result = validateDDLAgainstHeaders(ddl, ['row_id', '姓名', '年龄']);
    expect(result.valid).toBe(true);
    expect(result.mismatches).toHaveLength(0);
  });

  it('英文物理列名配中文注释时按中文表头校验通过', () => {
    const ddl = `CREATE TABLE inventory (
      row_id INTEGER PRIMARY KEY, -- 行号
      item_name TEXT, -- 物品名称
      quantity INTEGER, -- 数量
      description TEXT -- 描述/效果
    );`;
    const result = validateDDLAgainstHeaders(ddl, ['row_id', '物品名称', '数量', '描述/效果']);
    expect(result.valid).toBe(true);
    expect(result.mismatches).toHaveLength(0);
  });

  it('ASCII 展示表头可通过精确 DDL 注释校验', () => {
    const ddl = `CREATE TABLE battle_status (
      row_id INTEGER PRIMARY KEY, -- 行号
      hp_rp TEXT, -- HP/RP
      en TEXT -- EN
    );`;

    const result = validateDDLAgainstHeaders(ddl, ['row_id', 'HP/RP', 'EN']);

    expect(result.valid).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it('宽松 DDL 不因缺少 NOT NULL/UNIQUE/CHECK 等业务约束而失败', () => {
    const ddl = `CREATE TABLE chronicle ( -- 纪要表
      row_id INTEGER PRIMARY KEY, -- 行号
      code_index TEXT, -- 编码索引
      time_span TEXT, -- 时间跨度
      summary TEXT -- 概览
    );`;
    const result = validateDDLAgainstHeaders(ddl, ['row_id', '编码索引', '时间跨度', '概览']);
    expect(result.valid).toBe(true);
    expect(result.mismatches).toHaveLength(0);
  });

  it('中文“行号”表头视为 row_id 别名，不导致 DDL/表头错位误报', () => {
    const ddl = `CREATE TABLE tdoll_construction (
      row_id INTEGER PRIMARY KEY, -- 行号
      start_time TEXT, -- 开始时间
      construction_time TEXT, -- 建造时间
      cost_manpower INTEGER, -- 消耗人力
      cost_ammo INTEGER, -- 消耗弹药
      cost_ration INTEGER, -- 消耗口粮
      cost_parts INTEGER -- 消耗零件
    );`;
    const result = validateDDLAgainstHeaders(ddl, ['行号', '开始时间', '建造时间', '消耗人力', '消耗弹药', '消耗口粮', '消耗零件']);
    expect(result.valid).toBe(true);
    expect(result.mismatches).toHaveLength(0);
  });

  it('row_id 的 INTEGER 与 PRIMARY KEY 被行内注释分隔时仍按解析结构校验', () => {
    const ddl = `CREATE TABLE inventory (
      row_id INTEGER -- 行号
        PRIMARY KEY,
      item_name TEXT -- 名称
    );`;

    const result = validateDDLAgainstHeaders(ddl, ['row_id', '名称']);

    expect(result.valid).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it('列数不匹配时报告', () => {
    const ddl = `CREATE TABLE test (
      row_id INTEGER PRIMARY KEY,
      name TEXT
    );`;
    const result = validateDDLAgainstHeaders(ddl, ['row_id', '姓名', '年龄']);
    expect(result.valid).toBe(false);
    expect(result.mismatches.some(m => m.includes('列数不匹配'))).toBe(true);
  });

  it('注释与表头不匹配时报告', () => {
    const ddl = `CREATE TABLE test (
      row_id INTEGER PRIMARY KEY, -- 行号
      name TEXT, -- 名字
      age INTEGER -- 年龄
    );`;
    const result = validateDDLAgainstHeaders(ddl, ['row_id', '姓名', '年龄']);
    expect(result.valid).toBe(false);
    expect(result.mismatches.some(m => m.includes('不匹配'))).toBe(true);
  });

  it('列顺序与表头不一致时报告', () => {
    const ddl = `CREATE TABLE test (
      row_id INTEGER PRIMARY KEY, -- 行号
      age INTEGER, -- 年龄
      name TEXT -- 姓名
    );`;
    const result = validateDDLAgainstHeaders(ddl, ['row_id', '姓名', '年龄']);
    expect(result.valid).toBe(false);
    expect(result.mismatches.some(m => m.includes('第 1 列不匹配'))).toBe(true);
  });
});

describe('removeDDLColumnAtIndex_ACU', () => {
  it('精确移除目标列并保留其他原始列定义、块注释与 suffix', () => {
    const ddl = `CREATE TABLE inventory (
  row_id INTEGER PRIMARY KEY, -- 行号
  keep TEXT /* 业务兼容说明 */ DEFAULT 'x', -- 保留列
  obsolete TEXT -- 删除列
) STRICT;`;

    const result = removeDDLColumnAtIndex_ACU(ddl, 2);

    expect(result).toContain("keep TEXT /* 业务兼容说明 */ DEFAULT 'x' -- 保留列");
    expect(result).not.toContain("keep TEXT /* 业务兼容说明 */ DEFAULT 'x', -- 保留列");
    expect(result).toContain(') STRICT;');
    expect(result).not.toContain('obsolete TEXT');
  });

  it('删除末尾业务列时移除前一列分隔逗号并保留注释', () => {
    const ddl = `CREATE TABLE inventory (
  row_id INTEGER PRIMARY KEY, -- 行号
  keep TEXT, -- 保留列
  obsolete TEXT -- 删除列
);`;

    const result = removeDDLColumnAtIndex_ACU(ddl, 2);

    expect(result).toContain('keep TEXT -- 保留列');
    expect(result).not.toContain('keep TEXT, -- 保留列');
  });

  it('目标列被表级约束以无引号名称引用时 fail closed', () => {
    const ddl = `CREATE TABLE inventory (
  row_id INTEGER PRIMARY KEY,
  "note" TEXT,
  CONSTRAINT note_required CHECK(note IS NOT NULL)
);`;

    expect(() => removeDDLColumnAtIndex_ACU(ddl, 1)).toThrow('表级约束');
  });

  it('表级约束与普通列同一物理行时仍 fail closed', () => {
    const ddl = `CREATE TABLE inventory (
  row_id INTEGER PRIMARY KEY,
  "note" TEXT,
  keep TEXT, CONSTRAINT note_required CHECK(note IS NOT NULL)
);`;

    expect(() => removeDDLColumnAtIndex_ACU(ddl, 1)).toThrow('表级约束');
  });

  it('拒绝 row_id、内联约束和无法按行精确删除的 DDL', () => {
    expect(() => removeDDLColumnAtIndex_ACU('CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT);', 0)).toThrow('row_id');
    expect(() => removeDDLColumnAtIndex_ACU(`CREATE TABLE inventory (
  row_id INTEGER PRIMARY KEY,
  name TEXT UNIQUE
);`, 1)).toThrow('带有约束');
    expect(() => removeDDLColumnAtIndex_ACU('CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT, obsolete TEXT);', 2)).toThrow('多行列定义或表级约束');
  });
});
