import { describe, expect, it } from 'vitest';
import { decodeSqlIdentifier_ACU, rebindSqlMutationColumnReferences_ACU, rebindSqlMutationColumnsByTarget_ACU, rebindSqlMutationTableReferences_ACU, rebindSqlReadIdentifiers_ACU } from '../../src/shared/sql-mutation-table-rebind';

describe('sql mutation table rebind', () => {
  it('只重绑定表引用，保持字符串和注释原样', () => {
    const [result] = rebindSqlMutationTableReferences_ACU([
      "UPDATE global_state SET note = 'global_state literal' /* global_state comment */ WHERE row_id = 1",
    ], new Map([['global_state', 'quanjushujubiao']]));

    expect(result).toBe("UPDATE quanjushujubiao SET note = 'global_state literal' /* global_state comment */ WHERE row_id = 1");
  });

  it('不会把普通、递归、列名列表或多 CTE 名称重绑定为表', () => {
    const aliases = new Map([['global_state', 'runtime_global'], ['sheet_global', 'runtime_global'], ['old_target', 'runtime_target']]);
    const [recursive] = rebindSqlMutationTableReferences_ACU([
      'WITH RECURSIVE global_state(row_id) AS (SELECT 1) UPDATE sheet_global SET row_id = row_id WHERE row_id IN (SELECT row_id FROM global_state)',
    ], aliases);
    const [multiple] = rebindSqlMutationTableReferences_ACU([
      'WITH global_state AS (SELECT 1 AS row_id), sheet_global AS (SELECT row_id FROM global_state) UPDATE old_target SET row_id = row_id WHERE row_id IN (SELECT row_id FROM sheet_global)',
    ], aliases);

    expect(recursive).toContain('FROM global_state');
    expect(recursive).toContain('UPDATE runtime_global');
    expect(multiple).toContain('FROM global_state');
    expect(multiple).toContain('FROM sheet_global');
    expect(multiple).toContain('UPDATE runtime_target');
  });

  it('不会把嵌套 WITH 作用域内与 alias 同名的 CTE 引用重绑定为物理表', () => {
    const [result] = rebindSqlMutationTableReferences_ACU([
      'UPDATE old_table SET value = 1 WHERE EXISTS (WITH RECURSIVE old_table(row_id) AS (SELECT 1) SELECT 1 FROM old_table WHERE row_id = 1)',
    ], new Map([['old_table', 'runtime_table']]));

    expect(result).toBe(
      'UPDATE runtime_table SET value = 1 WHERE EXISTS (WITH RECURSIVE old_table(row_id) AS (SELECT 1) SELECT 1 FROM old_table WHERE row_id = 1)',
    );
  });

  it('重绑定 target、self-reference、JOIN 与 FROM 多表中的已知表，未知引用保持原文', () => {
    const aliases = new Map([
      ['old_global', 'runtime_global'],
      ['old_auxiliary', 'runtime_auxiliary'],
    ]);
    const [insert] = rebindSqlMutationTableReferences_ACU([
      'INSERT INTO old_global (row_id) SELECT source.row_id FROM old_global AS source JOIN old_auxiliary AS auxiliary ON source.row_id = auxiliary.row_id',
    ], aliases);
    const [unknown] = rebindSqlMutationTableReferences_ACU([
      'UPDATE old_global SET row_id = row_id WHERE EXISTS (SELECT 1 FROM missing_table)',
    ], aliases);

    expect(insert).toBe('INSERT INTO runtime_global (row_id) SELECT source.row_id FROM runtime_global AS source JOIN runtime_auxiliary AS auxiliary ON source.row_id = auxiliary.row_id');
    expect(unknown).toContain('UPDATE runtime_global');
    expect(unknown).toContain('FROM missing_table');
  });

  it('解码 DDL 引号标识符，并在 SQL 中保留原始引号风格', () => {
    expect(decodeSqlIdentifier_ACU('"global_state"')).toBe('global_state');
    expect(decodeSqlIdentifier_ACU('`global_state`')).toBe('global_state');
    expect(decodeSqlIdentifier_ACU('[global_state]')).toBe('global_state');
    const [result] = rebindSqlMutationTableReferences_ACU([
      'INSERT INTO [global_state] (row_id) SELECT row_id FROM `global_state`',
    ], new Map([['"global_state"', 'runtime_global']]));

    expect(result).toBe('INSERT INTO [runtime_global] (row_id) SELECT row_id FROM `runtime_global`');
  });

  it('目标表未知时原样返回，宽松模式也不接管 SQLite 语法错误', () => {
    const [result] = rebindSqlMutationTableReferences_ACU(['INSERT INTO missing_table VALUES (1)'], new Map([['known', 'runtime_known']]), { lenient: true });
    expect(result).toBe('INSERT INTO missing_table VALUES (1)');
  });

  it('严格写入模式在执行前拒绝未知目标表与关联表', () => {
    expect(() => rebindSqlMutationTableReferences_ACU(
      ['INSERT INTO missing_table VALUES (1)'],
      new Map([['known', 'runtime_known']]),
      { requireKnownTables: true },
    )).toThrow('无法识别的目标表「missing_table」');
    expect(() => rebindSqlMutationTableReferences_ACU(
      ['UPDATE known SET row_id = row_id WHERE EXISTS (SELECT 1 FROM missing_table)'],
      new Map([['known', 'runtime_known']]),
      { requireKnownTables: true },
    )).toThrow('无法识别的关联表「missing_table」');
  });

  it('严格写入模式仍允许已知表的 CTE，并重绑定真实表引用', () => {
    const [result] = rebindSqlMutationTableReferences_ACU(
      ['WITH known AS (SELECT 1 AS row_id) UPDATE old_target SET row_id = row_id WHERE row_id IN (SELECT row_id FROM known)'],
      new Map([['old_target', 'runtime_target']]),
      { requireKnownTables: true },
    );
    expect(result).toContain('UPDATE runtime_target');
    expect(result).toContain('FROM known');
  });

  it('只读查询重绑定表和单表列名，且不触碰字面量与注释', () => {
    const result = rebindSqlReadIdentifiers_ACU(
      "SELECT item_name, inventory_count, 'inventory' /* inventory */ FROM inventory WHERE item_name = '铁剑' -- inventory",
      new Map([['inventory', 'beibaowupinbiao']]),
      new Map([['beibaowupinbiao', new Map([['item_name', 'wupinmingcheng']])]]),
    );

    expect(result).toEqual({
      sql: "SELECT wupinmingcheng, inventory_count, 'inventory' /* inventory */ FROM beibaowupinbiao WHERE wupinmingcheng = '铁剑' -- inventory",
      tableRebindCount: 1,
      columnRebindCount: 2,
    });
  });

  it('保留 SELECT AS 输出别名', () => {
    const result = rebindSqlReadIdentifiers_ACU(
      'SELECT item_name AS item_name FROM inventory',
      new Map([['inventory', 'beibaowupinbiao']]),
      new Map([['beibaowupinbiao', new Map([['item_name', 'wupinmingcheng']])]]),
    );

    expect(result.sql).toBe('SELECT wupinmingcheng AS item_name FROM beibaowupinbiao');
  });

  it('只读查询在多表中遇到歧义列时不猜测', () => {
    const result = rebindSqlReadIdentifiers_ACU(
      'SELECT name FROM old_a JOIN old_b ON old_a.row_id = old_b.row_id',
      new Map([['old_a', 'runtime_a'], ['old_b', 'runtime_b']]),
      new Map([
        ['runtime_a', new Map([['name', 'name_a']])],
        ['runtime_b', new Map([['name', 'name_b']])],
      ]),
    );

    expect(result.sql).toBe('SELECT name FROM runtime_a JOIN runtime_b ON runtime_a.row_id = runtime_b.row_id');
    expect(result.columnRebindCount).toBe(0);
  });

  it('使用 JOIN 别名确定限定列归属，且不重写别名', () => {
    const result = rebindSqlReadIdentifiers_ACU(
      'SELECT a.name, b.name FROM old_a AS a JOIN old_b AS b ON a.row_id = b.row_id',
      new Map([['old_a', 'runtime_a'], ['old_b', 'runtime_b']]),
      new Map([
        ['runtime_a', new Map([['name', 'name_a']])],
        ['runtime_b', new Map([['name', 'name_b']])],
      ]),
    );

    expect(result.sql).toBe('SELECT a.name_a, b.name_b FROM runtime_a AS a JOIN runtime_b AS b ON a.row_id = b.row_id');
    expect(result.columnRebindCount).toBe(2);
  });

  it('隔离 CTE 与派生表作用域，保留它们的输出别名', () => {
    const aliases = new Map([['inventory', 'runtime_inventory'], ['other', 'runtime_other']]);
    const columns = new Map([
      ['runtime_inventory', new Map([['item_name', 'physical_item']])],
      ['runtime_other', new Map([['item_name', 'other_item']])],
    ]);
    const cte = rebindSqlReadIdentifiers_ACU(
      'WITH items AS (SELECT item_name AS item_name FROM inventory) SELECT item_name FROM items',
      aliases,
      columns,
    );
    const derived = rebindSqlReadIdentifiers_ACU(
      'SELECT sub.item_name FROM other JOIN (SELECT item_name AS item_name FROM inventory) AS sub ON 1 = 1',
      aliases,
      columns,
    );

    expect(cte.sql).toBe('WITH items AS (SELECT physical_item AS item_name FROM runtime_inventory) SELECT item_name FROM items');
    expect(derived.sql).toBe('SELECT sub.item_name FROM runtime_other JOIN (SELECT physical_item AS item_name FROM runtime_inventory) AS sub ON 1 = 1');
  });

  it('将派生表和 CTE 输出视为虚拟列，而不是实体列别名', () => {
    const aliases = new Map([['people', 'runtime_people'], ['other', 'runtime_other']]);
    const columns = new Map([
      ['runtime_people', new Map([['姓名', 'physical_name']])],
      ['runtime_other', new Map([['姓名', 'other_name']])],
    ]);
    const derived = rebindSqlReadIdentifiers_ACU(
      'SELECT 姓名, d.姓名 FROM other JOIN (SELECT physical_name AS 姓名 FROM people) AS d ON 1 = 1 ORDER BY 姓名',
      aliases,
      columns,
    );
    const cte = rebindSqlReadIdentifiers_ACU(
      'WITH people_view(姓名) AS (SELECT physical_name FROM people) SELECT 姓名 FROM people_view ORDER BY 姓名',
      aliases,
      columns,
    );

    expect(derived.sql).toBe('SELECT 姓名, d.姓名 FROM runtime_other JOIN (SELECT physical_name AS 姓名 FROM runtime_people) AS d ON 1 = 1 ORDER BY 姓名');
    expect(cte.sql).toBe('WITH people_view(姓名) AS (SELECT physical_name FROM runtime_people) SELECT 姓名 FROM people_view ORDER BY 姓名');
  });

  it('以 UNION 第一分支的输出别名保护派生表外层引用', () => {
    const result = rebindSqlReadIdentifiers_ACU(
      'SELECT d.姓名 FROM (SELECT name_a AS 姓名 FROM first_source UNION ALL SELECT name_b AS 别名 FROM second_source) AS d ORDER BY d.姓名',
      new Map([['first_source', 'runtime_first'], ['second_source', 'runtime_second']]),
      new Map([
        ['runtime_first', new Map([['姓名', 'name_a']])],
        ['runtime_second', new Map([['别名', 'name_b']])],
      ]),
    );

    expect(result.sql).toBe('SELECT d.姓名 FROM (SELECT name_a AS 姓名 FROM runtime_first UNION ALL SELECT name_b AS 别名 FROM runtime_second) AS d ORDER BY d.姓名');
  });

  it('在输出别名排序及未知派生输出场景保守地保留列标识符', () => {
    const aliases = new Map([['people', 'runtime_people'], ['other', 'runtime_other']]);
    const columns = new Map([
      ['runtime_people', new Map([['姓名', 'physical_name']])],
      ['runtime_other', new Map([['姓名', 'other_name']])],
    ]);
    const outputAlias = rebindSqlReadIdentifiers_ACU(
      'SELECT physical_name AS 姓名 FROM people ORDER BY 姓名',
      aliases,
      columns,
    );
    const unknownDerived = rebindSqlReadIdentifiers_ACU(
      'SELECT 姓名, d.姓名 FROM other JOIN (SELECT * FROM people) AS d ON 1 = 1',
      aliases,
      columns,
    );

    expect(outputAlias.sql).toBe('SELECT physical_name AS 姓名 FROM runtime_people ORDER BY 姓名');
    expect(unknownDerived.sql).toBe('SELECT 姓名, d.姓名 FROM runtime_other JOIN (SELECT * FROM runtime_people) AS d ON 1 = 1');
  });

  it('无别名派生表的 SELECT * 不得被当作已知中文输出列', () => {
    // 内层 SELECT * 导出物理列名；外层展示列名仍须交由 legacy 翻译层处理。
    const result = rebindSqlReadIdentifiers_ACU(
      'SELECT 姓名 FROM (SELECT * FROM people) ORDER BY 姓名',
      new Map([['people', 'runtime_people']]),
      new Map([['runtime_people', new Map([['姓名', 'physical_name']])]]),
    );

    expect(result.sql).toBe('SELECT 姓名 FROM (SELECT * FROM runtime_people) ORDER BY 姓名');
    expect(result.columnRebindCount).toBe(0);
  });

  it('无别名派生表的显式输出列在 ORDER BY、GROUP BY 与 HAVING 中保持虚拟列语义', () => {
    const aliases = new Map([['people', 'runtime_people']]);
    const columns = new Map([['runtime_people', new Map([['姓名', 'physical_name']])]]);
    const ordered = rebindSqlReadIdentifiers_ACU(
      'SELECT 姓名 FROM (SELECT physical_name AS 姓名 FROM people) ORDER BY 姓名',
      aliases,
      columns,
    );
    const grouped = rebindSqlReadIdentifiers_ACU(
      'SELECT 姓名 FROM (SELECT physical_name AS 姓名 FROM people) GROUP BY 姓名 HAVING 姓名 IS NOT NULL',
      aliases,
      columns,
    );

    expect(ordered.sql).toBe('SELECT 姓名 FROM (SELECT physical_name AS 姓名 FROM runtime_people) ORDER BY 姓名');
    expect(grouped.sql).toBe('SELECT 姓名 FROM (SELECT physical_name AS 姓名 FROM runtime_people) GROUP BY 姓名 HAVING 姓名 IS NOT NULL');
  });

  it('无别名 UNION 派生表沿用第一分支的显式输出，并在实体列同名时不猜测', () => {
    const result = rebindSqlReadIdentifiers_ACU(
      'SELECT 姓名 FROM other JOIN (SELECT name_a AS 姓名 FROM first_source UNION ALL SELECT name_b AS 别名 FROM second_source) ON 1 = 1 ORDER BY 姓名',
      new Map([
        ['other', 'runtime_other'],
        ['first_source', 'runtime_first'],
        ['second_source', 'runtime_second'],
      ]),
      new Map([
        ['runtime_other', new Map([['姓名', 'other_name']])],
        ['runtime_first', new Map([['姓名', 'name_a']])],
        ['runtime_second', new Map([['别名', 'name_b']])],
      ]),
    );

    expect(result.sql).toBe(
      'SELECT 姓名 FROM runtime_other JOIN (SELECT name_a AS 姓名 FROM runtime_first UNION ALL SELECT name_b AS 别名 FROM runtime_second) ON 1 = 1 ORDER BY 姓名',
    );
    expect(result.columnRebindCount).toBe(0);
  });

  it('无别名派生表的隐式输出列保持虚拟列语义，但不改变有别名派生表或 CTE', () => {
    const aliases = new Map([['people', 'runtime_people']]);
    const columns = new Map([['runtime_people', new Map([['姓名', 'physical_name']])]]);
    const aliasless = rebindSqlReadIdentifiers_ACU(
      'SELECT 姓名 FROM (SELECT physical_name 姓名 FROM people) ORDER BY 姓名',
      aliases,
      columns,
    );
    const named = rebindSqlReadIdentifiers_ACU(
      'SELECT d.姓名 FROM (SELECT physical_name 姓名 FROM people) AS d ORDER BY d.姓名',
      aliases,
      columns,
    );
    const cte = rebindSqlReadIdentifiers_ACU(
      'WITH d AS (SELECT physical_name 姓名 FROM people) SELECT 姓名 FROM d ORDER BY 姓名',
      aliases,
      columns,
    );

    expect(aliasless.sql).toBe('SELECT 姓名 FROM (SELECT physical_name 姓名 FROM runtime_people) ORDER BY 姓名');
    // P2 is deliberately limited to alias-less derived sources; preserve their existing output.
    expect(named.sql).toBe('SELECT d.姓名 FROM (SELECT physical_name physical_name FROM runtime_people) AS d ORDER BY d.姓名');
    expect(cte.sql).toBe('WITH d AS (SELECT physical_name physical_name FROM runtime_people) SELECT 姓名 FROM d ORDER BY 姓名');
  });

  it('仅识别有效隐式别名，不将 CASE 终止词、排序词或 SELECT * 误认为输出列', () => {
    const aliases = new Map([['people', 'runtime_people']]);
    const columns = new Map([['runtime_people', new Map([['姓名', 'physical_name'], ['状态值', 'state_value']])]]);
    const caseResult = rebindSqlReadIdentifiers_ACU(
      'SELECT 状态值 FROM (SELECT CASE WHEN physical_name IS NOT NULL THEN 1 ELSE 0 END 状态值 FROM people) ORDER BY 状态值',
      aliases,
      columns,
    );
    const starResult = rebindSqlReadIdentifiers_ACU(
      'SELECT 姓名 FROM (SELECT * FROM people) ORDER BY 姓名',
      aliases,
      columns,
    );

    expect(caseResult.sql).toBe('SELECT 状态值 FROM (SELECT CASE WHEN physical_name IS NOT NULL THEN 1 ELSE 0 END 状态值 FROM runtime_people) ORDER BY 状态值');
    expect(starResult.sql).toBe('SELECT 姓名 FROM (SELECT * FROM runtime_people) ORDER BY 姓名');
  });

  it('识别运算式和函数式的无别名派生输出别名', () => {
    const aliases = new Map([['people', 'runtime_people']]);
    const columns = new Map([['runtime_people', new Map([['数量', 'physical_amount'], ['总数', 'total_count']])]]);
    const arithmetic = rebindSqlReadIdentifiers_ACU(
      'SELECT 数量 FROM (SELECT physical_amount + 1 数量 FROM people) ORDER BY 数量',
      aliases,
      columns,
    );
    const aggregate = rebindSqlReadIdentifiers_ACU(
      'SELECT 总数 FROM (SELECT count(physical_amount) 总数 FROM people) ORDER BY 总数',
      aliases,
      columns,
    );

    expect(arithmetic.sql).toBe('SELECT 数量 FROM (SELECT physical_amount + 1 数量 FROM runtime_people) ORDER BY 数量');
    expect(aggregate.sql).toBe('SELECT 总数 FROM (SELECT count(physical_amount) 总数 FROM runtime_people) ORDER BY 总数');
  });

  it('不将函数名视为列标识符', () => {
    const result = rebindSqlReadIdentifiers_ACU(
      'SELECT count(*) FROM inventory',
      new Map([['inventory', 'runtime_inventory']]),
      new Map([['runtime_inventory', new Map([['count', 'physical_count']])]]),
    );

    expect(result.sql).toBe('SELECT count(*) FROM runtime_inventory');
  });


  it('歧义别名（ambiguousAliases）结构化拒绝，不当作未知表放行也不随机选择', () => {
    // 两个物理表共用英文名 shared_legacy：registry 将其移入 conflicts，rebind 必须 fail-loud。
    expect(() => rebindSqlMutationTableReferences_ACU(
      ['INSERT INTO shared_legacy (row_id) VALUES (1)'],
      new Map([['jiabiao', 'jiabiao'], ['yibiao', 'yibiao']]),
      { requireKnownTables: true, ambiguousAliases: new Set(['shared_legacy']) },
    )).toThrow('SQL 写入引用了歧义表名「shared_legacy」：该名称同时指向多张物理表，无法安全路由');

    // 关联表位置同样拒绝。
    expect(() => rebindSqlMutationTableReferences_ACU(
      ['UPDATE jiabiao SET row_id = row_id WHERE EXISTS (SELECT 1 FROM shared_legacy)'],
      new Map([['jiabiao', 'jiabiao']]),
      { requireKnownTables: true, ambiguousAliases: new Set(['shared_legacy']) },
    )).toThrow('SQL 写入引用了歧义表名「shared_legacy」');
  });

  it('唯一英文名与当前物理名都正确定位；重复英文 DDL 名不污染物理名的唯一映射', () => {
    // 两个物理表 jiabiao/yibiao 各自物理名唯一；shared_legacy 是它们的公共英文名。
    const aliases = new Map([
      ['jiabiao', 'jiabiao'],
      ['yibiao', 'yibiao'],
    ]);
    const [insertA] = rebindSqlMutationTableReferences_ACU(
      ['INSERT INTO jiabiao (row_id) VALUES (1)'],
      aliases,
      { requireKnownTables: true },
    );
    const [insertB] = rebindSqlMutationTableReferences_ACU(
      ['INSERT INTO yibiao (row_id) VALUES (1)'],
      aliases,
      { requireKnownTables: true },
    );
    expect(insertA).toBe('INSERT INTO jiabiao (row_id) VALUES (1)');
    expect(insertB).toBe('INSERT INTO yibiao (row_id) VALUES (1)');
  });

  it('唯一英文名 SQL 重绑定到当前物理名（改名后每次重算，不缓存旧物理名）', () => {
    // 改名后旧英文名仍唯一，映射必须指向新物理名。
    const aliasesAfterRename = new Map([
      ['characters', 'juesebiao'],
      ['juesebiao', 'juesebiao'],
    ]);
    const [result] = rebindSqlMutationTableReferences_ACU(
      ['UPDATE characters SET row_id = row_id WHERE row_id = 1'],
      aliasesAfterRename,
      { requireKnownTables: true },
    );
    expect(result).toBe('UPDATE juesebiao SET row_id = row_id WHERE row_id = 1');
  });
});

describe('sql mutation column rebind', () => {
  const columnAliases = new Map([
    ['quanjushujubiao', new Map([
      ['current_location', 'dangqianweizhi'],
      ['prev_scene_time', 'shangyichangjing'],
      ['cur_time', 'dangqianshijian'],
    ])],
  ]);

  it('UPDATE SET 列名重绑为当前物理列名', () => {
    const [result] = rebindSqlMutationColumnReferences_ACU(
      ["UPDATE quanjushujubiao SET current_location = '新地点' WHERE row_id = 1"],
      columnAliases,
      'quanjushujubiao',
    );
    expect(result).toBe("UPDATE quanjushujubiao SET dangqianweizhi = '新地点' WHERE row_id = 1");
  });

  it('INSERT 列清单重绑，但 VALUES 与字符串字面量原样', () => {
    const [result] = rebindSqlMutationColumnReferences_ACU(
      ["INSERT INTO quanjushujubiao (current_location, prev_scene_time) VALUES ('地点', '之前')"],
      columnAliases,
      'quanjushujubiao',
    );
    expect(result).toBe("INSERT INTO quanjushujubiao (dangqianweizhi, shangyichangjing) VALUES ('地点', '之前')");
  });

  it('WHERE 子句中的历史列名重绑，注释与字符串不动', () => {
    const [result] = rebindSqlMutationColumnReferences_ACU(
      ["UPDATE quanjushujubiao SET cur_time = 'x' WHERE current_location = '起点' /* comment */ AND prev_scene_time = 'a'"],
      columnAliases,
      'quanjushujubiao',
    );
    expect(result).toBe("UPDATE quanjushujubiao SET dangqianshijian = 'x' WHERE dangqianweizhi = '起点' /* comment */ AND shangyichangjing = 'a'");
  });

  it('别名查不到时原样保留，不猜测', () => {
    const [result] = rebindSqlMutationColumnReferences_ACU(
      ["UPDATE quanjushujubiao SET nonexistent = 'x' WHERE row_id = 1"],
      columnAliases,
      'quanjushujubiao',
    );
    expect(result).toBe("UPDATE quanjushujubiao SET nonexistent = 'x' WHERE row_id = 1");
  });

  it('目标表不是当前物理表时不重绑', () => {
    const [result] = rebindSqlMutationColumnReferences_ACU(
      ["UPDATE other_table SET current_location = 'x' WHERE row_id = 1"],
      columnAliases,
      'quanjushujubiao',
    );
    expect(result).toBe("UPDATE other_table SET current_location = 'x' WHERE row_id = 1");
  });

  it('含 JOIN / 关联表时整条拒绝列重绑（跨表无法证明归属）', () => {
    expect(() => rebindSqlMutationColumnReferences_ACU(
      ['UPDATE quanjushujubiao SET current_location = other.x FROM other WHERE quanjushujubiao.row_id = other.row_id'],
      columnAliases,
      'quanjushujubiao',
    )).toThrow('SQL_COLUMN_CROSS_TABLE_REFUSED_ACU');
  });

  it('INSERT...SELECT 含 SELECT 关键词：无法安全改列时原样放行，由上层/SQLite fail closed', () => {
    // 计划 3.3-5：无法安全改列时原样放行，让上层（sql-table-service 的
    // materializeSystemRowIdsForSqlInserts_ACU「不支持 INSERT SELECT」校验）或
    // SQLite 自己 fail closed。INSERT SELECT 的列来自 SELECT 来源表，纯工具无法
    // 证明归属，不能强行重绑；SELECT 检测先于跨表检测，故不抛跨表拒绝。
    const result = rebindSqlMutationColumnReferences_ACU(
      ['INSERT INTO quanjushujubiao (current_location) SELECT prev_scene_time FROM quanjushujubiao WHERE row_id = 1'],
      columnAliases,
      'quanjushujubiao',
    );
    expect(result[0]).toBe('INSERT INTO quanjushujubiao (current_location) SELECT prev_scene_time FROM quanjushujubiao WHERE row_id = 1');
  });

  it('UPDATE + SELECT 子查询（单表）：跳过列重绑、原样放行', () => {
    // replay.test.ts:869 的历史合法回放路径：WITH source AS (...) UPDATE [global_state]
    // SET story_state = (SELECT story_state FROM source) ...。source 是 CTE，
    // references() 用 isCteReference 排除 CTE 引用 → 只有 1 个表引用 → 走 SELECT 跳过
    // 分支原样放行。子查询内列归属不可证，不猜；若列名真是历史名，SQLite 报真实
    // no such column，仍 fail closed。
    const [result] = rebindSqlMutationColumnReferences_ACU(
      ["WITH source AS (SELECT 1 AS row_id, 'x' AS story_state) UPDATE quanjushujubiao SET story_state = (SELECT story_state FROM source) WHERE row_id = (SELECT row_id FROM source)"],
      columnAliases,
      'quanjushujubiao',
    );
    expect(result).toBe("WITH source AS (SELECT 1 AS row_id, 'x' AS story_state) UPDATE quanjushujubiao SET story_state = (SELECT story_state FROM source) WHERE row_id = (SELECT row_id FROM source)");
  });

  it('命中歧义列时抛结构化错误 SQL_COLUMN_ALIAS_AMBIGUOUS_ACU', () => {
    expect(() => rebindSqlMutationColumnReferences_ACU(
      ["UPDATE quanjushujubiao SET current_location = 'x' WHERE row_id = 1"],
      columnAliases,
      'quanjushujubiao',
      { ambiguousColumns: new Set(['current_location']) },
    )).toThrow('SQL_COLUMN_ALIAS_AMBIGUOUS_ACU');
  });

  it('quoted identifier 重绑且保留引号风格', () => {
    const quoted = new Map([
      ['quanjushujubiao', new Map([['current_location', 'dangqianweizhi']])],
    ]);
    const [result] = rebindSqlMutationColumnReferences_ACU(
      ['UPDATE quanjushujubiao SET "current_location" = \'x\' WHERE row_id = 1'],
      quoted,
      'quanjushujubiao',
    );
    expect(result).toBe('UPDATE quanjushujubiao SET "dangqianweizhi" = \'x\' WHERE row_id = 1');
  });

  it('不提供 lenient：无别名证据时原样保留（不吞 SQLite 错误）', () => {
    const [result] = rebindSqlMutationColumnReferences_ACU(
      ["UPDATE quanjushujubiao SET current_location = 'x' WHERE row_id = 1"],
      new Map(),
      'quanjushujubiao',
    );
    expect(result).toBe("UPDATE quanjushujubiao SET current_location = 'x' WHERE row_id = 1");
  });

  it('INSERT ... ON CONFLICT DO UPDATE：列清单与 DO UPDATE SET 左侧重绑，excluded 限定符右侧不重绑', () => {
    // 风险点 4：EXCLUDED 不在 READ_COLUMN_KEYWORDS_ACU 中，但 excluded 自身不在别名表
    // 则原样保留；excluded.current_location 的点号右侧被限定符规则排除。
    // DO UPDATE SET 左侧 current_location 经全语句扫描命中别名并重绑。
    const [result] = rebindSqlMutationColumnReferences_ACU(
      ["INSERT INTO quanjushujubiao (current_location) VALUES ('地点') ON CONFLICT (row_id) DO UPDATE SET current_location = excluded.current_location"],
      columnAliases,
      'quanjushujubiao',
    );
    expect(result).toBe("INSERT INTO quanjushujubiao (dangqianweizhi) VALUES ('地点') ON CONFLICT (row_id) DO UPDATE SET dangqianweizhi = excluded.current_location");
  });

  it('INSERT OR REPLACE INTO t (a, b) VALUES (...)：列清单重绑，VALUES 原样', () => {
    // 风险点 5：OR REPLACE 位于 action 与目标表之间，mutationTarget 应能定位目标表，
    // 列清单检测按 depth 定位第一个括号，不受 VALUES 括号干扰。
    const [result] = rebindSqlMutationColumnReferences_ACU(
      ["INSERT OR REPLACE INTO quanjushujubiao (current_location, prev_scene_time) VALUES ('地点', '之前')"],
      columnAliases,
      'quanjushujubiao',
    );
    expect(result).toBe("INSERT OR REPLACE INTO quanjushujubiao (dangqianweizhi, shangyichangjing) VALUES ('地点', '之前')");
  });

  it('Phase 6：歧义拒绝时错误信息含全部候选列与各自证据来源', () => {
    expect(() => rebindSqlMutationColumnReferences_ACU(
      ["UPDATE quanjushujubiao SET current_location = 'x' WHERE row_id = 1"],
      columnAliases,
      'quanjushujubiao',
      {
        ambiguousColumns: new Set(['current_location']),
        resolveAmbiguity: alias => [
          { target: 'prev_scene_time', evidence: 'physical_alias' },
          { target: 'cur_time', evidence: 'display_name' },
        ],
      },
    )).toThrow(/SQL_COLUMN_ALIAS_AMBIGUOUS_ACU.*current_location.*prev_scene_time.*physical_alias.*cur_time.*display_name/s);
  });
});

  it('rebindSqlMutationColumnsByTarget_ACU：按每条语句 mutation target 自动选择列 map', () => {
    const multiTableAliases = new Map([
      ['quanjushujubiao', new Map([['current_location', 'dangqianweizhi']])],
      ['juesebiao', new Map([['char_name', 'juesemingcheng']])],
    ]);
    const result = rebindSqlMutationColumnsByTarget_ACU(
      [
        "UPDATE quanjushujubiao SET current_location = '新地点' WHERE row_id = 1",
        "UPDATE juesebiao SET char_name = '助手' WHERE row_id = 2",
      ],
      multiTableAliases,
    );
    expect(result[0]).toBe("UPDATE quanjushujubiao SET dangqianweizhi = '新地点' WHERE row_id = 1");
    expect(result[1]).toBe("UPDATE juesebiao SET juesemingcheng = '助手' WHERE row_id = 2");
  });

  it('rebindSqlMutationColumnsByTarget_ACU：目标表未注册列别名时原样放行', () => {
    const result = rebindSqlMutationColumnsByTarget_ACU(
      ["UPDATE weizhubiao SET whatever = 'x' WHERE row_id = 1"],
      new Map([['quanjushujubiao', new Map([['current_location', 'dangqianweizhi']])]]),
    );
    expect(result[0]).toBe("UPDATE weizhubiao SET whatever = 'x' WHERE row_id = 1");
  });

  it('rebindSqlMutationColumnsByTarget_ACU：歧义按目标表隔离，仅命中目标表冲突', () => {
    const aliases = new Map([
      ['quanjushujubiao', new Map([['current_location', 'dangqianweizhi']])],
      ['juesebiao', new Map([['current_location', 'jueseweizhi']])],
    ]);
    // 只有 quanjushujubiao 的 current_location 冲突；juesebiao 的 current_location
    // 无歧义 → 正常重绑为 jueseweizhi，不受另一张表冲突影响（按目标表隔离）。
    const result = rebindSqlMutationColumnsByTarget_ACU(
      [
        "UPDATE juesebiao SET current_location = 'x' WHERE row_id = 1",
      ],
      aliases,
      { ambiguousColumns: new Map([['quanjushujubiao', new Set(['current_location'])]]) },
    );
    expect(result[0]).toBe("UPDATE juesebiao SET jueseweizhi = 'x' WHERE row_id = 1");
    // quanjushujubiao 命中歧义 → 结构化拒绝。
    expect(() => rebindSqlMutationColumnsByTarget_ACU(
      ["UPDATE quanjushujubiao SET current_location = 'x' WHERE row_id = 1"],
      aliases,
      { ambiguousColumns: new Map([['quanjushujubiao', new Set(['current_location'])]]) },
    )).toThrow('SQL_COLUMN_ALIAS_AMBIGUOUS_ACU');
  });

  it('rebindSqlMutationColumnsByTarget_ACU：跨表拒绝与 SELECT 放行语义与单表一致', () => {
    const aliases = new Map([['quanjushujubiao', new Map([['current_location', 'dangqianweizhi']])]]);
    // JOIN 多表 → 拒绝。
    expect(() => rebindSqlMutationColumnsByTarget_ACU(
      ['UPDATE quanjushujubiao SET current_location = other.x FROM other WHERE quanjushujubiao.row_id = other.row_id'],
      aliases,
    )).toThrow('SQL_COLUMN_CROSS_TABLE_REFUSED_ACU');
    // INSERT...SELECT → 原样放行（由上层/SQLite fail closed）。
    const [result] = rebindSqlMutationColumnsByTarget_ACU(
      ['INSERT INTO quanjushujubiao (current_location) SELECT prev_scene_time FROM quanjushujubiao WHERE row_id = 1'],
      aliases,
    );
    expect(result).toBe('INSERT INTO quanjushujubiao (current_location) SELECT prev_scene_time FROM quanjushujubiao WHERE row_id = 1');
  });

  // ── 阶段 E：requireKnownInsertColumns opt-in 未知 INSERT 列 gate ──
  it('requireKnownInsertColumns 下写短的列名只有唯一一列以它开头时自动纠正，前缀有歧义或过短仍拒绝', () => {
    const aliases = new Map([
      ['juesezhuangtaibiao', new Map([
        ['row_id', 'row_id'],
        ['char_name', 'char_name'],
        ['posture', 'posture'],
        ['special_status', 'special_status'],
        ['speech', 'speech'],
      ])],
    ]);
    const [fixed] = rebindSqlMutationColumnsByTarget_ACU(
      ["INSERT INTO juesezhuangtaibiao (row_id, char_name, post) VALUES ('1', '甲', '站立')"],
      aliases,
      { requireKnownInsertColumns: true },
    );
    expect(fixed).toBe("INSERT INTO juesezhuangtaibiao (row_id, char_name, posture) VALUES ('1', '甲', '站立')");
    expect(() => rebindSqlMutationColumnsByTarget_ACU(
      ["INSERT INTO juesezhuangtaibiao (row_id, sp) VALUES ('1', 'x')"],
      aliases,
      { requireKnownInsertColumns: true },
    )).toThrow('SQL_INSERT_UNKNOWN_COLUMN_ACU');
    expect(() => rebindSqlMutationColumnsByTarget_ACU(
      ["INSERT INTO juesezhuangtaibiao (row_id, spe) VALUES ('1', 'x')"],
      aliases,
      { requireKnownInsertColumns: true },
    )).toThrow('SQL_INSERT_UNKNOWN_COLUMN_ACU');
  });

  it('INSERT 列清单命中 registry 未知列时，requireKnownInsertColumns 抛 SQL_INSERT_UNKNOWN_COLUMN_ACU 且不含 VALUES', () => {
    const aliases = new Map([
      ['beibaowupinbiao', new Map([
        ['row_id', 'row_id'],
        ['item_name', 'item_name'],
        ['quantity', 'quantity'],
      ])],
    ]);
    // opt-in 关闭（默认）：未知列原样放行，保持 replay/历史兼容。
    const [lenient] = rebindSqlMutationColumnsByTarget_ACU(
      ["INSERT INTO beibaowupinbiao (xi_xiang_guan_wu_pin) VALUES ('错误列')"],
      aliases,
    );
    expect(lenient).toBe("INSERT INTO beibaowupinbiao (xi_xiang_guan_wu_pin) VALUES ('错误列')");
    // opt-in 开启：结构化拒绝，错误只含目标表/未知列/允许列，不含 VALUES。
    let caughtError: unknown;
    try {
      rebindSqlMutationColumnsByTarget_ACU(
        ["INSERT INTO beibaowupinbiao (xi_xiang_guan_wu_pin) VALUES ('错误列')"],
        aliases,
        { requireKnownInsertColumns: true },
      );
    } catch (error: unknown) {
      caughtError = error;
    }
    expect(caughtError).toBeTruthy();
    const message = caughtError instanceof Error ? caughtError.message : String(caughtError);
    expect(message).toContain('SQL_INSERT_UNKNOWN_COLUMN_ACU');
    expect(message).toContain('xi_xiang_guan_wu_pin');
    expect(message).toContain('beibaowupinbiao');
    // 脱敏：不得回显 VALUES 业务值与完整 SQL。
    expect(message).not.toContain('错误列');
    expect(message).not.toContain('INSERT INTO');
    expect(message).not.toContain('VALUES');
  });

  it('INSERT 列清单命中 registry 已知列（含别名）时不触发未知列 gate，并正常重绑', () => {
    const aliases = new Map([
      ['beibaowupinbiao', new Map([
        ['row_id', 'row_id'],
        ['item_name', 'item_name'],
        ['wu_pin_ming_cheng', 'item_name'],
      ])],
    ]);
    const [result] = rebindSqlMutationColumnsByTarget_ACU(
      ["INSERT INTO beibaowupinbiao (wu_pin_ming_cheng) VALUES ('药水')"],
      aliases,
      { requireKnownInsertColumns: true },
    );
    expect(result).toBe("INSERT INTO beibaowupinbiao (item_name) VALUES ('药水')");
  });

  it('UPDATE SET 不受 requireKnownInsertColumns 影响（gate 仅作用于 INSERT/REPLACE 列清单）', () => {
    const aliases = new Map([
      ['beibaowupinbiao', new Map([
        ['row_id', 'row_id'],
        ['item_name', 'item_name'],
      ])],
    ]);
    // UPDATE 里未知列不触发 INSERT gate（保持既有 no such column 语义，不引入新错误面）。
    const [result] = rebindSqlMutationColumnsByTarget_ACU(
      ["UPDATE beibaowupinbiao SET xi_xiang_guan_wu_pin = 'x' WHERE row_id = 1"],
      aliases,
      { requireKnownInsertColumns: true },
    );
    expect(result).toBe("UPDATE beibaowupinbiao SET xi_xiang_guan_wu_pin = 'x' WHERE row_id = 1");
  });

