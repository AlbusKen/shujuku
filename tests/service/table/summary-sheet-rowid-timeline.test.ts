import { describe, expect, it } from 'vitest';

import { collectSummarySheetRowIdTimelineV2_ACU } from '../../../src/service/table/summary-sheet-rowid-timeline';

const ISO = '';
const SUMMARY = 'sheet_summary';
const OTHER = 'sheet_other';

function sheet(uid: string, name: string, rows: string[][]): any {
  return {
    uid,
    name,
    content: [['row_id', '概要', '编码索引'], ...rows],
    sourceData: {},
    updateConfig: {},
    exportConfig: {},
    orderNo: uid === SUMMARY ? 0 : 1,
  };
}

function checkpointData(summaryRows: string[][], otherRows: string[][] = [['1', '其它', 'x']]): any {
  return {
    mate: { type: 'acu', version: 1 },
    [SUMMARY]: sheet(SUMMARY, '纪要表', summaryRows),
    [OTHER]: sheet(OTHER, '其它表', otherRows),
  };
}

function tableEntry(options: {
  entryId: string;
  seq: number;
  sheetKey: string;
  operations: any[];
  writeSet?: any[];
}): any {
  return {
    seq: options.seq,
    entryId: options.entryId,
    createdAt: 1,
    source: 'auto_fill',
    targetMessageIndex: 0,
    aiFloor: 1,
    filledSheetKeys: [options.sheetKey],
    changedSheetKeys: [options.sheetKey],
    groupKeys: [],
    operations: options.operations,
    commitRevision: `rev-${options.entryId}`,
    writeSet: options.writeSet ?? [{ kind: 'sheet', sheetKey: options.sheetKey }],
  };
}

function ai(frame: any): any {
  return {
    is_user: false,
    mes: 'ai',
    TavernDB_ACU_IsolatedData: {
      [ISO]: { _acu_storage_version: 2, storageFrame: frame },
    },
  };
}

function fullFrame(entries: any[] = [], data = checkpointData([['1', '第一段', 'A001']])): any {
  return {
    version: 2,
    checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data },
    logEntries: entries,
  };
}

function logFrame(entries: any[]): any {
  return { version: 2, logEntries: entries };
}

describe('collectSummarySheetRowIdTimelineV2_ACU', () => {
  it('无 full checkpoint → unsupported_replay_base', async () => {
    const result = await collectSummarySheetRowIdTimelineV2_ACU({
      chat: [ai(logFrame([tableEntry({
        entryId: 'e1', seq: 1, sheetKey: SUMMARY,
        operations: [{ kind: 'row_upsert', sheetKey: SUMMARY, rowId: '2', cells: ['2', '新', 'A002'] }],
      })]))],
      isolationKey: ISO,
      sheetKey: SUMMARY,
    });
    expect(result.status).toBe('unsupported_replay_base');
    expect(result.entries).toEqual([]);
  });

  it('rowIdsAtCheckpoint 来自 checkpoint.data，不含 C 层 logEntries；触及纪要表的 entry 记录 rowIdsAfter', async () => {
    const chat = [
      ai(fullFrame([
        tableEntry({
          entryId: 'c1', seq: 1, sheetKey: SUMMARY,
          operations: [{ kind: 'row_upsert', sheetKey: SUMMARY, rowId: '2', cells: ['2', '第二段', 'A002'] }],
        }),
      ])),
      ai(logFrame([
        tableEntry({
          entryId: 'e2', seq: 1, sheetKey: SUMMARY,
          operations: [{ kind: 'row_upsert', sheetKey: SUMMARY, rowId: '3', cells: ['3', '第三段', 'A003'] }],
        }),
        tableEntry({
          entryId: 'e3', seq: 2, sheetKey: OTHER,
          operations: [{ kind: 'row_upsert', sheetKey: OTHER, rowId: '9', cells: ['9', '其它2', 'y'] }],
        }),
      ])),
    ];
    const result = await collectSummarySheetRowIdTimelineV2_ACU({
      chat, isolationKey: ISO, sheetKey: SUMMARY,
    });
    expect(result.status).toBe('ok');
    expect(result.checkpointMessageIndex).toBe(0);
    expect(result.rowIdsAtCheckpoint).toEqual(['1']);
    expect(result.entries.map((entry) => entry.entryId)).toEqual(['c1', 'e2']);
    expect(result.entries[0].rowIdsAfter).toEqual(['1', '2']);
    expect(result.entries[1].rowIdsAfter).toEqual(['1', '2', '3']);
    expect(result.rowIdsAtHead).toEqual(['1', '2', '3']);
    expect(result.duplicates).toEqual([]);
  });

  it('同层混合 row_upsert 与 row_delete 只投影精确变化', async () => {
    const chat = [
      ai(fullFrame([], checkpointData([['1', '一', 'A001'], ['2', '二', 'A002'], ['3', '三', 'A003']]))),
      ai(logFrame([
        tableEntry({
          entryId: 'mix', seq: 1, sheetKey: SUMMARY,
          operations: [
            { kind: 'row_delete', sheetKey: SUMMARY, rowId: '2' },
            { kind: 'row_upsert', sheetKey: SUMMARY, rowId: '4', cells: ['4', '四', 'A004'] },
          ],
        }),
      ])),
    ];
    const result = await collectSummarySheetRowIdTimelineV2_ACU({
      chat, isolationKey: ISO, sheetKey: SUMMARY,
    });
    expect(result.status).toBe('ok');
    expect(result.rowIdsAtCheckpoint).toEqual(['1', '2', '3']);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].rowIdsAfter.sort()).toEqual(['1', '3', '4']);
    expect(result.rowIdsAtHead.sort()).toEqual(['1', '3', '4']);
  });

  it('sheet_replace 整表替换后 rowId 集合等于替换后的表', async () => {
    const replacement = sheet(SUMMARY, '纪要表', [['10', '新一', 'B001'], ['11', '新二', 'B002']]);
    const chat = [
      ai(fullFrame([], checkpointData([['1', '旧', 'A001']]))),
      ai(logFrame([
        tableEntry({
          entryId: 'replace', seq: 1, sheetKey: SUMMARY,
          operations: [{
            kind: 'sheet_replace',
            sheetKey: SUMMARY,
            sheet: replacement,
            reason: 'import',
          }],
        }),
      ])),
    ];
    const result = await collectSummarySheetRowIdTimelineV2_ACU({
      chat, isolationKey: ISO, sheetKey: SUMMARY,
    });
    expect(result.status).toBe('ok');
    expect(result.rowIdsAtCheckpoint).toEqual(['1']);
    expect(result.entries[0].rowIdsAfter).toEqual(['10', '11']);
    expect(result.rowIdsAtHead).toEqual(['10', '11']);
  });

  it('重复 rowId 记入 duplicates，集合只保留首次出现', async () => {
    const chat = [
      ai(fullFrame([], checkpointData([['1', '一', 'A001'], ['1', '重复', 'A002']]))),
    ];
    const result = await collectSummarySheetRowIdTimelineV2_ACU({
      chat, isolationKey: ISO, sheetKey: SUMMARY,
    });
    expect(result.status).toBe('ok');
    expect(result.rowIdsAtCheckpoint).toEqual(['1']);
    expect(result.duplicates).toEqual([{ rowId: '1', entryId: null, messageIndex: 0 }]);
  });

  it('checkpoint 空 rowId 不进入 rowIdsAtCheckpoint；replay 补稳定 ID 后 emptyRowIdCount 以 head 为准', async () => {
    const chat = [
      ai(fullFrame([], checkpointData([['1', '一', 'A001'], ['', '空', 'A000']]))),
    ];
    const result = await collectSummarySheetRowIdTimelineV2_ACU({
      chat, isolationKey: ISO, sheetKey: SUMMARY,
    });
    expect(result.rowIdsAtCheckpoint).toEqual(['1']);
    expect(result.rowIdsAtHead).not.toContain('');
    expect(result.rowIdsAtHead.length).toBeGreaterThanOrEqual(1);
    expect(result.emptyRowIdCount).toBe(0);
  });

  it('checkpoint.data 没有目标表时 rowIdsAtCheckpoint 为空', async () => {
    const data = { mate: { type: 'acu', version: 1 }, [OTHER]: sheet(OTHER, '其它表', [['1', 'x', 'y']]) };
    const result = await collectSummarySheetRowIdTimelineV2_ACU({
      chat: [ai(fullFrame([], data))],
      isolationKey: ISO,
      sheetKey: SUMMARY,
    });
    expect(result.status).toBe('ok');
    expect(result.rowIdsAtCheckpoint).toEqual([]);
    expect(result.rowIdsAtHead).toEqual([]);
  });
});
