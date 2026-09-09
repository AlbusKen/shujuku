import { describe, expect, it } from 'vitest';

import {
  findTouchedSummarySheetKey_ACU,
  planUnmirroredEntryDeltasV2_ACU,
} from '../../../src/service/vector/summary-vector-mirror-writer';

const SUMMARY = 'sheet_summary';
const OTHER = 'sheet_other';

const tableData = {
  [SUMMARY]: { name: '纪要表', content: [['row_id', '概要']] },
  [OTHER]: { name: '角色表', content: [['row_id', '姓名']] },
};

describe('planUnmirroredEntryDeltasV2_ACU', () => {
  it('第一个未镜像 entry 以 checkpoint 集合为 before', () => {
    const plans = planUnmirroredEntryDeltasV2_ACU(
      [
        { messageIndex: 1, entryId: 'e1', commitRevision: 'r1', seq: 1, rowIdsAfter: ['1', '2'] },
        { messageIndex: 2, entryId: 'e2', commitRevision: 'r2', seq: 1, rowIdsAfter: ['2', '3'] },
      ],
      [],
      ['1'],
    );
    expect(plans).toEqual([
      { messageIndex: 1, entryId: 'e1', commitRevision: 'r1', added: ['2'], removed: [] },
      { messageIndex: 2, entryId: 'e2', commitRevision: 'r2', added: ['3'], removed: ['1'] },
    ]);
  });

  it('已镜像 entry 只推进 before，不产出 delta', () => {
    const plans = planUnmirroredEntryDeltasV2_ACU(
      [
        { messageIndex: 1, entryId: 'e1', commitRevision: 'r1', seq: 1, rowIdsAfter: ['1', '2'] },
        { messageIndex: 2, entryId: 'e2', commitRevision: 'r2', seq: 1, rowIdsAfter: ['1', '2', '3'] },
      ],
      ['e1'],
      ['1'],
    );
    expect(plans).toEqual([
      { messageIndex: 2, entryId: 'e2', commitRevision: 'r2', added: ['3'], removed: [] },
    ]);
  });

  it('增减皆空不写 delta', () => {
    const plans = planUnmirroredEntryDeltasV2_ACU(
      [{ messageIndex: 1, entryId: 'e1', commitRevision: 'r1', seq: 1, rowIdsAfter: ['1'] }],
      [],
      ['1'],
    );
    expect(plans).toEqual([]);
  });
});

describe('findTouchedSummarySheetKey_ACU', () => {
  it('changedSheetKeys 命中纪要表', () => {
    expect(findTouchedSummarySheetKey_ACU({
      tableData,
      changedSheetKeys: [OTHER, SUMMARY],
    })).toBe(SUMMARY);
  });

  it('writeSet all 时从 tableData 找纪要表', () => {
    expect(findTouchedSummarySheetKey_ACU({
      tableData,
      writeSet: [{ kind: 'all' }],
    })).toBe(SUMMARY);
  });

  it('只改非纪要表返回 null', () => {
    expect(findTouchedSummarySheetKey_ACU({
      tableData,
      changedSheetKeys: [OTHER],
    })).toBeNull();
  });
});
