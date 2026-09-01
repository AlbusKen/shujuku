import { describe, expect, it } from 'vitest';
import { normalizeSheetGuideRowIds_ACU } from '../../../src/service/template/chat-scope/sheet-guide-row-id-normalizer';

function guide(header: unknown[], rows: unknown[][] = []) {
  return { mate: { type: 'chatSheets', version: 2 }, sheet_a: { uid: 'sheet_a', name: '测试表', content: [header], seedRows: rows } };
}

describe('normalizeSheetGuideRowIds_ACU', () => {
  it('普通业务表头插入 row_id，并保持种子行的业务值与顺序', () => {
    const input = guide(['名称', '数量'], [['铁剑', 1], ['药水', 2]]);
    const result = normalizeSheetGuideRowIds_ACU(input);
    expect(result.blockers).toEqual([]);
    expect(result.guideData.sheet_a.content).toEqual([['row_id', '名称', '数量']]);
    expect(result.guideData.sheet_a.seedRows).toEqual([['1', '铁剑', 1], ['2', '药水', 2]]);
    expect(input.sheet_a.content).toEqual([['名称', '数量']]);
    expect(input.sheet_a.seedRows).toEqual([['铁剑', 1], ['药水', 2]]);
  });

  it('将“行号”首列作为身份别名改名，不右移业务列', () => {
    const result = normalizeSheetGuideRowIds_ACU(guide(['行号', '名称'], [['7', '铁剑']]));
    expect(result.blockers).toEqual([]);
    expect(result.guideData.sheet_a.content).toEqual([['row_id', '名称']]);
    expect(result.guideData.sheet_a.seedRows).toEqual([['7', '铁剑']]);
  });

  it('重复执行幂等，错位身份列和重复 ID 均拒绝自动修复', () => {
    const first = normalizeSheetGuideRowIds_ACU(guide(['名称'], [['铁剑']]));
    expect(normalizeSheetGuideRowIds_ACU(first.guideData).changed).toBe(false);
    expect(normalizeSheetGuideRowIds_ACU(guide(['名称', '行号'], [['铁剑', '1']])).blockers).toHaveLength(1);
    expect(normalizeSheetGuideRowIds_ACU(guide(['row_id', '名称'], [['1', '铁剑'], ['1', '盾牌']])).blockers).toHaveLength(1);
  });

  it.each(['id', 'rowId', 'row-id'])('将首列历史别名 %s 改名为 row_id，不改变行值位置', (alias) => {
    const result = normalizeSheetGuideRowIds_ACU(guide([alias, '名称'], [['legacy-7', '铁剑']]));

    expect(result.blockers).toEqual([]);
    expect(result.guideData.sheet_a.content).toEqual([['row_id', '名称']]);
    expect(result.guideData.sheet_a.seedRows).toEqual([['legacy-7', '铁剑']]);
  });

  it('短种子行尾部补 null，非法种子行仍 fail-closed，超宽行按最终表头裁剪', () => {
    const shortRow = normalizeSheetGuideRowIds_ACU(guide(['row_id', '名称', '数量'], [['7', '铁剑']]));
    expect(shortRow.blockers).toEqual([]);
    expect(shortRow.guideData.sheet_a.seedRows).toEqual([['7', '铁剑', null]]);

    const oversized = normalizeSheetGuideRowIds_ACU(guide(['名称'], [['铁剑', '额外列']]));
    expect(oversized.blockers).toEqual([]);
    expect(oversized.changed).toBe(true);
    expect(oversized.guideData.sheet_a.seedRows).toEqual([['1', '铁剑']]);
    const nonArrayRows: any = guide(['row_id', '名称']);
    nonArrayRows.sheet_a.seedRows = ['非法行'];
    expect(normalizeSheetGuideRowIds_ACU(nonArrayRows).blockers).toHaveLength(1);
  });

  it('已有 canonical row_id 表头时，超宽行裁掉右侧单元格', () => {
    const result = normalizeSheetGuideRowIds_ACU(guide(['row_id', '名称'], [['7', '铁剑', '多余']]));
    expect(result.blockers).toEqual([]);
    expect(result.changed).toBe(true);
    expect(result.guideData.sheet_a.seedRows).toEqual([['7', '铁剑']]);
  });

  it.each(['id', 'rowId', 'row-id', '行号'])('首列别名 %s 改名后按最终宽度收敛超宽行', (alias) => {
    const result = normalizeSheetGuideRowIds_ACU(guide([alias, '名称'], [['legacy-7', '铁剑', '旧列']]));
    expect(result.blockers).toEqual([]);
    expect(result.guideData.sheet_a.content).toEqual([['row_id', '名称']]);
    expect(result.guideData.sheet_a.seedRows).toEqual([['legacy-7', '铁剑']]);
  });

  it('无身份列表头先按业务宽度收敛，再插入 row_id 并分配稳定 ID', () => {
    const result = normalizeSheetGuideRowIds_ACU(guide(['名称', '数量'], [['铁剑', 1, '旧列'], ['药水']]));
    expect(result.blockers).toEqual([]);
    expect(result.guideData.sheet_a.content).toEqual([['row_id', '名称', '数量']]);
    expect(result.guideData.sheet_a.seedRows).toEqual([['1', '铁剑', 1], ['2', '药水', null]]);
  });

  it('同表混合短行、等宽行和超宽行时分别补齐、保留、裁剪', () => {
    const result = normalizeSheetGuideRowIds_ACU(guide(
      ['row_id', '名称', '数量'],
      [['1', '短'], ['2', '等宽', 3], ['3', '超宽', 4, '丢弃']],
    ));
    expect(result.blockers).toEqual([]);
    expect(result.guideData.sheet_a.seedRows).toEqual([
      ['1', '短', null],
      ['2', '等宽', 3],
      ['3', '超宽', 4],
    ]);
  });

  it('多张表同时超宽时全部成功规范化', () => {
    const input: any = {
      mate: { type: 'chatSheets', version: 2 },
      sheet_a: { uid: 'sheet_a', name: 'A', content: [['row_id', '名称']], seedRows: [['1', '甲', '旧']] },
      sheet_b: { uid: 'sheet_b', name: 'B', content: [['名称']], seedRows: [['乙', '旧']] },
    };
    const result = normalizeSheetGuideRowIds_ACU(input);
    expect(result.blockers).toEqual([]);
    expect(result.guideData.sheet_a.seedRows).toEqual([['1', '甲']]);
    expect(result.guideData.sheet_b.seedRows).toEqual([['1', '乙']]);
  });

  it('旧 _seedRows 字段继续被读取并规范化', () => {
    const input: any = { mate: { type: 'chatSheets', version: 2 }, sheet_a: { uid: 'sheet_a', name: '测试表', content: [['row_id', '名称']], _seedRows: [['7', '铁剑', '旧列']] } };
    const result = normalizeSheetGuideRowIds_ACU(input);
    expect(result.blockers).toEqual([]);
    expect(result.guideData.sheet_a._seedRows).toEqual([['7', '铁剑']]);
  });

  it('第二次规范化幂等，输入对象保持不变', () => {
    const input = guide(['row_id', '名称'], [['7', '铁剑', '旧列']]);
    const first = normalizeSheetGuideRowIds_ACU(input);
    const second = normalizeSheetGuideRowIds_ACU(first.guideData);
    expect(second.changed).toBe(false);
    expect(second.guideData).toEqual(first.guideData);
    expect(input.sheet_a.seedRows).toEqual([['7', '铁剑', '旧列']]);
  });

  it('同时存在 seedRows 与历史 _seedRows 时，以当前字段 seedRows 为准', () => {
    const input: any = guide(['名称'], [['当前字段']]);
    input.sheet_a._seedRows = [['历史字段']];

    const result = normalizeSheetGuideRowIds_ACU(input);

    expect(result.blockers).toEqual([]);
    expect(result.guideData.sheet_a.seedRows).toEqual([['1', '当前字段']]);
    expect(result.guideData.sheet_a._seedRows).toEqual([['历史字段']]);
  });

  it('缺失或空表头时拒绝，且 blocker 候选不得被调用方当作成功结果使用', () => {
    const missingContent: any = { mate: {}, sheet_a: { name: '坏表' } };
    const emptyHeader = guide([], []);

    expect(normalizeSheetGuideRowIds_ACU(missingContent).blockers).toHaveLength(1);
    expect(normalizeSheetGuideRowIds_ACU(emptyHeader).blockers).toHaveLength(1);
  });
});
