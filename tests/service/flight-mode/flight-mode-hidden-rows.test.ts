import { describe, expect, it } from 'vitest';
import { getHiddenChronicleRowIdsAfterBigSummaryInsert_ACU, projectFlightModeHiddenChronicleRows_ACU } from '../../../src/service/flight-mode/flight-mode-hidden-rows';

const state = {
  enabled: true,
  enabledAt: 1,
  hiddenRowIds: ['old'],
  bigSummarySheetKey: 'sheet_da_zong_jie',
};

function data(summaryRows: string[][], chronicleRows: string[][]) {
  return {
    sheet_chronicle: { name: '纪要表', content: [['row_id', '事件'], ...chronicleRows] },
    sheet_da_zong_jie: { name: '大总结', content: [['row_id', '总结'], ...summaryRows] },
  };
}

describe('flight-mode-hidden-rows', () => {
  it('大总结新增行时只隐藏写入前可见的纪要行，同批新增纪要保持可见', () => {
    const before = data([], [['c1', '旧纪要']]);
    const after = data([['s1', '阶段总结']], [['c1', '旧纪要'], ['c2', '同批新增纪要']]);

    expect(getHiddenChronicleRowIdsAfterBigSummaryInsert_ACU(before, after, state)).toEqual(['c1', 'old']);
  });

  it('未新增大总结行时不改变隐藏集合', () => {
    const before = data([['s1', '已有总结']], [['c1', '纪要']]);
    const after = data([['s1', '修订后的总结']], [['c1', '纪要'], ['c2', '新增纪要']]);

    expect(getHiddenChronicleRowIdsAfterBigSummaryInsert_ACU(before, after, state)).toBeNull();
  });

  it('关闭态或真实大总结 key 不匹配时短路', () => {
    const before = data([], [['c1', '纪要']]);
    const after = data([['s1', '总结']], [['c1', '纪要']]);
    expect(getHiddenChronicleRowIdsAfterBigSummaryInsert_ACU(before, after, { ...state, enabled: false })).toBeNull();
    expect(getHiddenChronicleRowIdsAfterBigSummaryInsert_ACU(before, after, { ...state, bigSummarySheetKey: 'sheet_other' })).toBeNull();
  });

  it('仅在开启且存在隐藏行时投影纪要表，保留原始快照和非纪要表引用', () => {
    const source: any = {
      sheet_chronicle: { name: '纪要表', content: [['row_id', '事件'], ['c1', '可见'], ['c2', '隐藏']] },
      sheet_other: { name: '其他表', content: [['row_id', '值'], ['o1', '保留']] },
    };

    const projected = projectFlightModeHiddenChronicleRows_ACU(source, { ...state, hiddenRowIds: ['c2'] });

    expect(projected).not.toBe(source);
    expect(projected.sheet_chronicle).not.toBe(source.sheet_chronicle);
    expect(projected.sheet_chronicle.content).toEqual([['row_id', '事件'], ['c1', '可见']]);
    expect(projected.sheet_other).toBe(source.sheet_other);
    expect(source.sheet_chronicle.content).toEqual([['row_id', '事件'], ['c1', '可见'], ['c2', '隐藏']]);
  });

  it('关闭态、空隐藏集合及无纪要表时返回原始引用', () => {
    const source: any = {
      sheet_chronicle: { name: '纪要表', content: [['row_id'], ['c1']] },
      sheet_other: { name: '其他表', content: [['row_id'], ['o1']] },
    };
    expect(projectFlightModeHiddenChronicleRows_ACU(source, { ...state, enabled: false })).toBe(source);
    expect(projectFlightModeHiddenChronicleRows_ACU(source, { ...state, hiddenRowIds: [] })).toBe(source);
    expect(projectFlightModeHiddenChronicleRows_ACU({ sheet_other: source.sheet_other }, state)).toEqual({ sheet_other: source.sheet_other });
  });
});
