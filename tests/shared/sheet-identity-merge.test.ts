/**
 * tests/shared/sheet-identity-merge.test.ts
 * 两代 sheetKey 身份归并纯函数单元测试（零 mock，直接测输入输出）
 */
import { describe, expect, it } from 'vitest';
import { mergeLegacySheetIdentities_ACU } from '../../src/shared/sheet-identity-merge';
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

  it('两代 key 同名时归并到新版稳定 key：同 row_id winner 胜出，loser 独有行追加', () => {
    const state = {
      sheet_x9k2f: makeSheet('背包', [['1', '旧行'], ['2', '旧独有行']]),
      [NEW_KEY]: makeSheet('背包', [['1', '新行']]),
    } as any;

    const result = mergeLegacySheetIdentities_ACU(state);

    expect(result.changed).toBe(true);
    expect(result.remaps).toEqual([{
      fromKey: 'sheet_x9k2f',
      toKey: NEW_KEY,
      canonicalName: '背包',
      overriddenRows: 1,
      appendedRows: 1,
    }]);
    expect(state.sheet_x9k2f).toBeUndefined();
    expect(state[NEW_KEY].content).toEqual([
      ['row_id', 'name'],
      ['1', '新行'],
      ['2', '旧独有行'],
    ]);
  });

  it('preferredKeys（模板/指导表侧）优先于新版稳定 key 候选', () => {
    const state = {
      sheet_legacy_hash: makeSheet('背包', [['1', '指导表侧行']]),
      [NEW_KEY]: makeSheet('背包', [['1', '另一代行'], ['2', '独有行']]),
    } as any;

    const result = mergeLegacySheetIdentities_ACU(state, ['sheet_legacy_hash']);

    expect(result.remaps).toEqual([{
      fromKey: NEW_KEY,
      toKey: 'sheet_legacy_hash',
      canonicalName: '背包',
      overriddenRows: 1,
      appendedRows: 1,
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
      ['2', 'aaa 行'],
      ['1', 'zzz 行'],
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
    expect(state[NEW_KEY].sourceData).toEqual({ ddl: 'CREATE TABLE beibao (row_id INTEGER PRIMARY KEY, name TEXT);' });
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
    }]);
    expect(state.sheet_lEARaBa8).toBeUndefined();
    expect(state[SKILL_KEY].content).toEqual([['row_id', 'name'], ['1', '火球']]);
    // 旧名已是 winner 的别名，不重复追加。
    expect(state[SKILL_KEY].sourceData.tableAliases).toEqual(['主角技能表']);
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
    expect(state.sheet_aaa.sourceData.tableAliases).toEqual(['角色表', '人物档案', '旧档案']);
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
    expect(state[NEW_KEY].sourceData.tableAliases).toEqual(['物品', '装备']);
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
    expect(state[INFO_KEY].sourceData.tableAliases).toEqual(['主角信息表']);
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
});
