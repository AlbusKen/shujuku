/**
 * tests/shared/sheet-identity-merge.test.ts
 * 两代 sheetKey 身份归并纯函数单元测试（零 mock，直接测输入输出）
 */
import { describe, expect, it } from 'vitest';
import { mergeLegacySheetIdentities_ACU, redirectSheetKeysInData_ACU, reuseSheetDataByName_ACU } from '../../src/shared/sheet-identity-merge';
import { getSheetColumnProjection_ACU, parseDDLColumnInfos_ACU } from '../../src/shared/ddl-utils';
import { buildSheetTableAliasMap_ACU } from '../../src/shared/sql-read-resolver';
import { buildStableSheetKeyCandidate_ACU } from '../../src/shared/sheet-identity';

const NEW_KEY = buildStableSheetKeyCandidate_ACU('背包')!;

function makeSheet(name: string, rows: unknown[][], extra: Record<string, unknown> = {}) {
  return {
    uid: name,
    name,
    content: [['row_id', 'name'], ...rows],
    updateConfig: {},
    exportConfig: {},
    orderNo: 0,
    ...extra,
  } as any;
}

describe('mergeLegacySheetIdentities_ACU', () => {
  it('无同名冲突时是纯 no-op', () => {
    const state = {
      mate: { type: 'acu', version: 1 },
      sheet_a: makeSheet('背包', [['1', '铁剑']]),
      sheet_b: makeSheet('技能', [['1', '火球']]),
    } as any;
    const before = JSON.parse(JSON.stringify(state));

    const result = mergeLegacySheetIdentities_ACU(state);

    expect(result.changed).toBe(false);
    expect(result.remaps).toEqual([]);
    expect(state).toEqual(before);
  });

  it('两代 key 同名时保留稳定引用，按已知数据先后更新同 row_id 并保留独有行', () => {
    const state = {
      sheet_x9k2f: makeSheet('背包', [['1', '旧行'], ['2', '旧独有行']]),
      [NEW_KEY]: makeSheet('背包', [['1', '新行']]),
    } as any;

    const result = mergeLegacySheetIdentities_ACU(state, null, {
      dataOrderBySheetKey: new Map([['sheet_x9k2f', 1], [NEW_KEY, 2]]),
    });

    expect(result.changed).toBe(true);
    // row_id=1 两侧都有不同的值：winner 行保留，冲突 id 记录、不静默。
    expect(result.remaps).toEqual([{
      fromKey: 'sheet_x9k2f',
      toKey: NEW_KEY,
      canonicalName: '背包',
      overriddenRows: 1,
      appendedRows: 1,
      conflictingRowIds: ['1'],
      droppedColumns: [],
    }]);
    expect(state.sheet_x9k2f).toBeUndefined();
    expect(state[NEW_KEY].content).toEqual([
      ['row_id', 'name'],
      ['1', '新行'],
      ['2', '旧独有行'],
    ]);
  });

  it('preferredKeys 只选择引用，不决定数据先后', () => {
    const state = {
      sheet_legacy_hash: makeSheet('背包', [['1', '指导表侧行']]),
      [NEW_KEY]: makeSheet('背包', [['1', '另一代行'], ['2', '独有行']]),
    } as any;

    const result = mergeLegacySheetIdentities_ACU(state, ['sheet_legacy_hash'], {
      dataOrderBySheetKey: new Map([[NEW_KEY, 1], ['sheet_legacy_hash', 2]]),
    });

    expect(result.remaps).toEqual([{
      fromKey: NEW_KEY,
      toKey: 'sheet_legacy_hash',
      canonicalName: '背包',
      overriddenRows: 1,
      appendedRows: 1,
      conflictingRowIds: ['1'],
      droppedColumns: [],
    }]);
    expect(state[NEW_KEY]).toBeUndefined();
    expect(state.sheet_legacy_hash.content).toEqual([
      ['row_id', 'name'],
      ['1', '指导表侧行'],
      ['2', '独有行'],
    ]);
  });

  it('两侧都不含新版稳定 key 时按 key 字典序取首位（确定性）', () => {
    const state = {
      sheet_zzz: makeSheet('背包', [['1', 'zzz 行']]),
      sheet_aaa: makeSheet('背包', [['2', 'aaa 行']]),
    } as any;

    const result = mergeLegacySheetIdentities_ACU(state);

    expect(result.remaps[0].toKey).toBe('sheet_aaa');
    expect(state.sheet_zzz).toBeUndefined();
    expect(state.sheet_aaa.content).toEqual([
      ['row_id', 'name'],
      ['1', 'zzz 行'],
      ['2', 'aaa 行'],
    ]);
  });

  it('winner 无可用 content 时整体采纳 loser 的 content，并继承 seedRows/sourceData', () => {
    const loserSheet = makeSheet('背包', [['1', '旧数据']], {
      seedRows: [['1', '种子']],
      sourceData: { ddl: 'CREATE TABLE beibao (row_id INTEGER PRIMARY KEY, name TEXT);' },
    });
    const winnerSheet = makeSheet('背包', []);
    winnerSheet.content = [];
    delete winnerSheet.sourceData;
    const state = {
      sheet_old_hash: loserSheet,
      [NEW_KEY]: winnerSheet,
    } as any;

    const result = mergeLegacySheetIdentities_ACU(state);

    expect(result.remaps[0]).toEqual(expect.objectContaining({ fromKey: 'sheet_old_hash', toKey: NEW_KEY }));
    expect(state[NEW_KEY].content).toEqual([['row_id', 'name'], ['1', '旧数据']]);
    expect(state[NEW_KEY].seedRows).toEqual([['1', '种子']]);
    expect(state[NEW_KEY].sourceData.ddl).toBe('CREATE TABLE beibao (row_id INTEGER PRIMARY KEY, name TEXT);');
    expect(state[NEW_KEY].sourceData.tableAliases).toContain('sheet_old_hash');
  });

  it('归并幂等：第二次调用是 no-op', () => {
    const state = {
      sheet_old_hash: makeSheet('背包', [['1', '旧行'], ['3', '旧独有']]),
      [NEW_KEY]: makeSheet('背包', [['1', '新行'], ['2', '新独有']]),
    } as any;

    const first = mergeLegacySheetIdentities_ACU(state);
    const afterFirst = JSON.parse(JSON.stringify(state));
    const second = mergeLegacySheetIdentities_ACU(state);

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(state).toEqual(afterFirst);
  });

  it('同名异构：loser 行按表头名映射到 winner 列（重排/新增列补空），不按位置拼接', () => {
    const state = {
      // 旧结构：name, state
      sheet_old_hash: { ...makeSheet('主角信息表', []), content: [['row_id', 'name', 'state'], ['1', '名字0', '状态=旧A1']] },
      // 新结构：state 前移、中间新增 pos 列
      sheet_zhu_jue_xin_xi_biao: { ...makeSheet('主角信息表', []), content: [['row_id', 'state', 'pos', 'name']] },
    } as any;

    const result = mergeLegacySheetIdentities_ACU(state, ['sheet_zhu_jue_xin_xi_biao']);

    expect(state.sheet_old_hash).toBeUndefined();
    expect(state.sheet_zhu_jue_xin_xi_biao.content).toEqual([
      ['row_id', 'state', 'pos', 'name'],
      ['1', '状态=旧A1', '', '名字0'],
    ]);
    expect(result.remaps).toEqual([expect.objectContaining({ appendedRows: 1, conflictingRowIds: [], droppedColumns: [] })]);
  });

  it('同名异构：历史独有列休眠保留，明确较晚写空不被旧值回填', () => {
    const state = {
      sheet_old_hash: { ...makeSheet('主角信息表', []), content: [['row_id', 'name', 'legacy_only'], ['1', '名字0', '旧独有值'], ['2', '名字2', '']] },
      sheet_zhu_jue_xin_xi_biao: { ...makeSheet('主角信息表', []), content: [['row_id', 'name'], ['1', '']] },
    } as any;

    const result = mergeLegacySheetIdentities_ACU(state, ['sheet_zhu_jue_xin_xi_biao'], {
      dataOrderBySheetKey: new Map([['sheet_old_hash', 1], ['sheet_zhu_jue_xin_xi_biao', 2]]),
    });

    expect(state.sheet_zhu_jue_xin_xi_biao.content).toEqual([
      ['row_id', 'name', 'legacy_only'],
      ['1', '', '旧独有值'],
      ['2', '名字2', ''],
    ]);
    expect(state.sheet_zhu_jue_xin_xi_biao.sourceData.hiddenPhysicalColumns).toEqual(['legacy_only']);
    expect(result.remaps).toEqual([expect.objectContaining({ overriddenRows: 1, appendedRows: 1, conflictingRowIds: ['1'], droppedColumns: [] })]);
  });

  it('行身份守恒：归并后不同 row_id 的行一个不丢', () => {
    const state = {
      sheet_old_hash: makeSheet('背包', [['1', '旧1'], ['2', '旧2'], ['5', '旧5']]),
      [NEW_KEY]: makeSheet('背包', [['1', '新1'], ['3', '新3']]),
    } as any;

    mergeLegacySheetIdentities_ACU(state);

    const rowIds = state[NEW_KEY].content.slice(1).map((row: unknown[]) => row[0]);
    expect([...rowIds].sort()).toEqual(['1', '2', '3', '5']);
  });

  // Issue #13 Bug 1：旧随机 key 的显示名恰好是新稳定 key 声明的历史别名（改名后累积），
  // 两者是同一逻辑表，必须按身份集合（显示名 ∪ tableAliases）归并，而不是只比显示名。
  it('旧 key 显示名与新 key 的显式 tableAliases 重合时归并到新 key，并保留别名身份', () => {
    const SKILL_KEY = buildStableSheetKeyCandidate_ACU('主角技能')!;
    const state = {
      sheet_lEARaBa8: makeSheet('主角技能表', []),
      [SKILL_KEY]: makeSheet('主角技能', [['1', '火球']], { sourceData: { tableAliases: ['主角技能表'] } }),
    } as any;

    const result = mergeLegacySheetIdentities_ACU(state);

    expect(result.changed).toBe(true);
    expect(result.remaps).toEqual([{
      fromKey: 'sheet_lEARaBa8',
      toKey: SKILL_KEY,
      canonicalName: '主角技能',
      overriddenRows: 0,
      appendedRows: 0,
      conflictingRowIds: [],
      droppedColumns: [],
    }]);
    expect(state.sheet_lEARaBa8).toBeUndefined();
    expect(state[SKILL_KEY].content).toEqual([['row_id', 'name'], ['1', '火球']]);
    // 旧名已是 winner 的别名，不重复追加。
    expect(state[SKILL_KEY].sourceData.tableAliases).toEqual(['主角技能表', 'sheet_lEARaBa8']);
  });

  it('两侧只靠共同别名相连时也归并，loser 的显示名与别名累积进 winner.tableAliases', () => {
    const state = {
      sheet_zzz: makeSheet('人物档案', [['2', '旧行']], { sourceData: { tableAliases: ['角色表', '旧档案'] } }),
      sheet_aaa: makeSheet('主角信息', [['1', '新行']], { sourceData: { tableAliases: ['角色表'] } }),
    } as any;

    const result = mergeLegacySheetIdentities_ACU(state);

    expect(result.remaps).toEqual([expect.objectContaining({ fromKey: 'sheet_zzz', toKey: 'sheet_aaa', canonicalName: '主角信息' })]);
    expect(state.sheet_zzz).toBeUndefined();
    expect(state.sheet_aaa.content).toEqual([['row_id', 'name'], ['1', '新行'], ['2', '旧行']]);
    expect(state.sheet_aaa.sourceData.tableAliases).toEqual(['角色表', 'sheet_zzz', '人物档案', '旧档案']);
  });

  it('身份关系可传递：A 与 B 同名、B 与 C 同别名时三者归并为一组', () => {
    const state = {
      sheet_c: makeSheet('装备', [['3', 'C 行']], { sourceData: { tableAliases: ['物品'] } }),
      sheet_b: makeSheet('背包', [['2', 'B 行']], { sourceData: { tableAliases: ['物品'] } }),
      [NEW_KEY]: makeSheet('背包', [['1', 'A 行']]),
    } as any;

    const result = mergeLegacySheetIdentities_ACU(state);

    expect(result.remaps.map(remap => remap.fromKey).sort()).toEqual(['sheet_b', 'sheet_c']);
    expect(result.remaps.every(remap => remap.toKey === NEW_KEY)).toBe(true);
    expect(state.sheet_b).toBeUndefined();
    expect(state.sheet_c).toBeUndefined();
    expect(state[NEW_KEY].content.slice(1).map((row: unknown[]) => row[0]).sort()).toEqual(['1', '2', '3']);
    expect(state[NEW_KEY].sourceData.tableAliases).toEqual(['sheet_b', '物品', 'sheet_c', '装备']);
  });

  it('winner 没有 sourceData 且需要累积别名时创建 sourceData 承载 tableAliases', () => {
    const INFO_KEY = buildStableSheetKeyCandidate_ACU('主角信息')!;
    const winnerSheet = makeSheet('主角信息', [['1', '新行']]);
    delete winnerSheet.sourceData;
    const state = {
      sheet_legacy: makeSheet('主角信息表', [], { sourceData: { tableAliases: ['主角信息'] } }),
      [INFO_KEY]: winnerSheet,
    } as any;

    const result = mergeLegacySheetIdentities_ACU(state);

    expect(result.remaps[0]).toEqual(expect.objectContaining({ fromKey: 'sheet_legacy', toKey: INFO_KEY }));
    // loser 的 sourceData 先按既有语义整体继承，再累积 loser 的显示名；winner 自身名不进别名。
    expect(state[INFO_KEY].sourceData.tableAliases).toEqual(['sheet_legacy', '主角信息表']);
  });

  it('显示名做 canonical 归一（空白/大小写差异视为同名）', () => {
    const state = {
      sheet_old_hash: makeSheet(' Inventory ', [['2', '旧行']]),
      sheet_inventory: makeSheet('inventory', [['1', '新行']]),
    } as any;

    const result = mergeLegacySheetIdentities_ACU(state);

    expect(result.changed).toBe(true);
    expect(result.remaps[0].canonicalName).toBe('inventory');
    expect(state.sheet_inventory.content).toEqual([
      ['row_id', 'name'],
      ['1', '新行'],
      ['2', '旧行'],
    ]);
  });
  it.each([['sheet_aaa', 'sheet_zzz'], ['sheet_zzz', 'sheet_aaa']])('数据先后独立于引用 key 和输入顺序：%s → %s', (oldKey, newKey) => {
    const oldSheet = makeSheet('背包', [['1', '旧值'], ['2', '独有行']]);
    const newSheet = makeSheet('背包', [['1', '']]);
    for (const entries of [[[oldKey, oldSheet], [newKey, newSheet]], [[newKey, newSheet], [oldKey, oldSheet]]] as any[]) {
      const state = Object.fromEntries(entries) as any;
      const before = JSON.stringify(entries);
      mergeLegacySheetIdentities_ACU(state, [oldKey], { dataOrderBySheetKey: new Map([[oldKey, 1], [newKey, 2]]) });
      expect(state[oldKey].content).toEqual([['row_id', 'name'], ['1', ''], ['2', '独有行']]);
      expect(JSON.stringify(entries)).toBe(before);
      expect(mergeLegacySheetIdentities_ACU(state).changed).toBe(false);
    }
  });

  it('结构切换保留行与休眠列定义，再出现时按名唤醒；明确替换不回填删除的行', () => {
    const before = makeSheet('背包', [], {
      uid: 'old-uid', content: [['row_id', '名称', '备注'], ['1', '铁剑', '记忆'], ['2', '木剑', '']],
      sourceData: { ddl: 'CREATE TABLE old_table (row_id INTEGER PRIMARY KEY, item_name TEXT, note TEXT DEFAULT \'原备注\');' },
    });
    const template = makeSheet('背包', [], {
      content: [['row_id', '名称']], sourceData: { ddl: 'CREATE TABLE next_table (row_id INTEGER PRIMARY KEY, title TEXT);' },
    });
    const original = JSON.stringify(before);
    const hidden = reuseSheetDataByName_ACU(before, template, 'structure');
    expect(hidden.content).toEqual(before.content);
    expect(getSheetColumnProjection_ACU(hidden).visibleColumns.map(column => column.header)).toEqual(['row_id', '名称']);
    expect(parseDDLColumnInfos_ACU(hidden.sourceData.ddl!)[2].defaultExpression).toBe("'原备注'");
    const restored = reuseSheetDataByName_ACU(hidden, before, 'structure');
    expect(restored.content).toEqual(before.content);
    expect(restored.sourceData.hiddenPhysicalColumns || []).toEqual([]);
    const cleared = reuseSheetDataByName_ACU(restored, { ...template, content: [['row_id', '名称'], ['1', '']] }, 'replace');
    expect(cleared.content).toEqual([['row_id', '名称', '备注'], ['1', '', null]]);
    expect(reuseSheetDataByName_ACU(cleared, before, 'structure').content).toEqual([['row_id', '名称', '备注'], ['1', '', null]]);
    expect(JSON.stringify(before)).toBe(original);
  });

  it('重复快照相等去重；显式清空不被 header-only 之外的旧快照恢复', () => {
    const state = { sheet_old: makeSheet('背包', [['1', '旧值']]), sheet_new: makeSheet('背包', []) } as any;
    mergeLegacySheetIdentities_ACU(state, ['sheet_old'], {
      dataOrderBySheetKey: new Map([['sheet_old', 1], ['sheet_new', 2]]), replaceDataFromKeys: new Set(['sheet_new']),
    });
    expect(state.sheet_old.content).toEqual([['row_id', 'name']]);
    const duplicate = { sheet_a: makeSheet('背包', [['1', '相同']]), sheet_b: makeSheet('背包', [['1', '相同']]) } as any;
    expect(mergeLegacySheetIdentities_ACU(duplicate).remaps[0].conflictingRowIds).toEqual([]);
    expect(duplicate.sheet_a.content).toHaveLength(2);
  });

  it('运输用 key/uid 只用于引用，不误并不同名或同 slug 的表', () => {
    const data = { sheet_a: makeSheet('诗', [['1', '甲']], { uid: 'old-a' }), sheet_b: makeSheet('师', [['1', '乙']], { sourceData: { tableAliases: ['sheet_a', 'old-a'] } }) } as any;
    expect(mergeLegacySheetIdentities_ACU(data).changed).toBe(false);
    const sameName = { sheet_old: makeSheet('背包', [['1', '值']], { uid: 'old-id' }), sheet_new: makeSheet('背包', []) } as any;
    mergeLegacySheetIdentities_ACU(sameName, ['sheet_new']);
    const aliases = buildSheetTableAliasMap_ACU([sameName]).aliases;
    expect(aliases.get('sheet_old')).toBe(aliases.get('sheet_new'));
    expect(aliases.get('old-id')).toBe(aliases.get('sheet_new'));
  });
  it('明确不同当前名不经共同历史别名间接归并，同名重复仍先收敛', () => {
    for (const reverse of [false, true]) {
      const entries = [
        ['sheet_a', makeSheet('甲表', [['1', '甲']], { sourceData: { tableAliases: ['桥接'] } })],
        ['sheet_b', makeSheet('乙表', [['2', '乙']], { sourceData: { tableAliases: ['桥接'] } })],
        ['sheet_c', makeSheet('旧名', [['3', '旧']], { sourceData: { tableAliases: ['桥接'] } })],
        ['sheet_d', makeSheet('乙表', [['4', '乙独有']])],
      ] as const;
      const data = Object.fromEntries(reverse ? [...entries].reverse() : entries) as any;
      mergeLegacySheetIdentities_ACU(data, undefined, { distinctCurrentNames: new Set(['甲表', '乙表']) });
      expect(Object.keys(data).filter(key => data[key].name === '乙表')).toHaveLength(1);
      expect(data.sheet_a).toBeDefined();
      expect(data.sheet_b).toBeDefined();
      expect(data.sheet_a.content.flat()).not.toContain('乙');
      expect(data.sheet_b.content.flat()).not.toContain('甲');
    }
  });
  it('提交恢复到历史 key 时只改挂请求 key，保留旧 key 别名且不修改输入', () => {
    const input = { mate: { type: 'chatSheets' }, sheet_new: makeSheet('背包', [], { uid: 'sheet_new' }) } as any;
    const original = JSON.stringify(input);
    const out = redirectSheetKeysInData_ACU(input, [{ requestedKey: 'sheet_new', sheetKey: 'sheet_old', uid: 'old-uid' }]);
    expect(out.sheet_new).toBeUndefined();
    expect(out.sheet_old).toMatchObject({ uid: 'old-uid', name: '背包' });
    expect(out.sheet_old.sourceData.tableAliases).toEqual(['sheet_new']);
    expect(JSON.stringify(input)).toBe(original);
    const occupied = { sheet_new: input.sheet_new, sheet_old: makeSheet('背包', []) } as any;
    expect(redirectSheetKeysInData_ACU(occupied, [{ requestedKey: 'sheet_new', sheetKey: 'sheet_old' }])).toEqual(occupied);
  });

  it('休眠列保留来源侧可搬运的表级约束，物理名被改写时不搬运', () => {
    const before = makeSheet('背包', [], {
      content: [['row_id', '名称', '编号'], ['1', '剑', 'A1']],
      sourceData: { ddl: 'CREATE TABLE old_table (row_id INTEGER PRIMARY KEY, item_name TEXT, code TEXT, UNIQUE (code));' },
    });
    const template = makeSheet('背包', [], {
      content: [['row_id', '名称']], sourceData: { ddl: 'CREATE TABLE next_table (row_id INTEGER PRIMARY KEY, item_name TEXT);' },
    });
    const hidden = reuseSheetDataByName_ACU(before, template, 'structure');
    expect(hidden.content).toEqual(before.content);
    expect(hidden.sourceData.ddl).toMatch(/UNIQUE\s*\(\s*code\s*\)/);
    const colliding = makeSheet('背包', [], {
      content: [['row_id', '名称', '代码']], sourceData: { ddl: 'CREATE TABLE next_table (row_id INTEGER PRIMARY KEY, item_name TEXT, code TEXT);' },
    });
    const renamed = reuseSheetDataByName_ACU(before, colliding, 'structure');
    expect(parseDDLColumnInfos_ACU(renamed.sourceData.ddl!).map(column => column.sqlName)).toContain('code_2');
    expect(renamed.sourceData.ddl).not.toMatch(/UNIQUE\s*\(\s*code\s*\)/);
  });



});
