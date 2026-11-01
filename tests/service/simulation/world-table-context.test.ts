import { describe, expect, it, vi } from 'vitest';
import validFrame from '../../fixtures/migrations/spv7.9/v2-valid-full-checkpoint.json';
import invalidFrame from '../../fixtures/migrations/spv7.9/v2-invalid-duplicate-row-id.json';
import { getTableDataFingerprint_ACU } from '../../../src/service/table/table-data-upgrade-audit';
import { readHostWorldTableSnapshot_ACU, readLogicalWorldTableSnapshot_ACU } from '../../../src/service/simulation/world-table-context';

const frameMessage = (frame: unknown, isolationKey = '') => ({ is_user: false,
  TavernDB_ACU_IsolatedData: { [isolationKey]: { _acu_storage_version: 2, storageFrame: structuredClone(frame) } },
});
const sheet = () => structuredClone(validFrame.checkpoint.data);

function turn() {
  return { turnId: 'turn-1', attemptId: 'attempt-1', branchId: 'branch-1',
    assistantFloor: { floorId: 'assistant-1', data: {} },
    tableInput: { tableData: sheet() }, effectReceipts: [],
    tableCandidate: { tableData: { mate: { type: 'acu', version: 1 } } },
  } as any;
}

describe('世界推演表格只读上下文', () => {
  it('普通 V2 回放在 anchor 截止，隔离其他标签与后续楼层', async () => {
    const frame = structuredClone(validFrame);
    frame.checkpoint.data.sheet_0.content[1][1] = '冻结前';
    const chat = [frameMessage(frame), { is_user: false, mes: '当前锚点' },
      frameMessage(validFrame, 'another-isolation'), frameMessage(invalidFrame)];
    const before = structuredClone(chat);
    expect((await readHostWorldTableSnapshot_ACU(chat, 1)).sheet_0.content[1][1]).toBe('冻结前');
    expect(chat).toEqual(before);
  });

  it('V2 SQLite 日志行作为世界状态完整回放，之后楼层不进入快照', async () => {
    const frame = structuredClone(validFrame) as any;
    frame.checkpoint.data.sheet_0 = { ...frame.checkpoint.data.sheet_0,
      uid: 'inventory', name: 'inventory', content: [['row_id', 'name'], ['1', '铁剑']],
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT);' } };
    frame.logEntries = [{ seq: 1, entryId: 'world-sql-row', createdAt: 2, source: 'auto_fill',
      targetMessageIndex: 0, aiFloor: 1, filledSheetKeys: ['sheet_0'], changedSheetKeys: ['sheet_0'], groupKeys: [],
      operations: [{ kind: 'sql_batch', statements: ["INSERT INTO inventory VALUES (2, '药水')"] }] }];
    const result = await readHostWorldTableSnapshot_ACU([frameMessage(frame)], 0);
    expect(result.sheet_0.content).toEqual([['row_id', 'name'], ['1', '铁剑'], ['2', '药水']]);
  });

  it('V2 实际回放错误不伪装成空表；无已保存表才是空表', async () => {
    const corrupt = frameMessage(invalidFrame) as any;
    corrupt.TavernDB_ACU_IsolatedData[''].storageFrame.logEntries = [{ seq: 1, entryId: 'invalid-sql',
      createdAt: 2, source: 'manual_fill', targetMessageIndex: 0, aiFloor: 1,
      filledSheetKeys: ['sheet_0'], changedSheetKeys: ['sheet_0'], groupKeys: [],
      operations: [{ kind: 'sql_sheet_batch', sheetKey: 'sheet_0', tableName: 'inventory', reason: 'system',
        statements: ['INSERT INTO inventory (missing_column) VALUES (1)'] }] }];
    await expect(readHostWorldTableSnapshot_ACU([corrupt], 0)).rejects.toThrow();
    expect(await readHostWorldTableSnapshot_ACU([{ is_user: false }], 0)).toEqual({});
  });

  it('legacy 显式快照只读合并，截止在当前楼层', async () => {
    const data = sheet();
    const chat = [{ is_user: false, TavernDB_ACU_IndependentData: { sheet_0: data.sheet_0 },
      TavernDB_ACU_ScopedConfig: { version: 1, template: { '': {
        mode: 'chat_override', isolationKey: '', templateStr: JSON.stringify(data) } } } },
      { is_user: false, mes: '当前锚点' },
      { is_user: false, TavernDB_ACU_IndependentData: { sheet_0: { ...data.sheet_0, content: [['row_id', '名称'], ['2', '未来']] } } }];
    const before = structuredClone(chat);
    const result = await readHostWorldTableSnapshot_ACU(chat, 1);
    expect(result.sheet_0.content).toContainEqual(['1', '铁剑']);
    expect(JSON.stringify(result)).not.toContain('未来');
    expect(chat).toEqual(before);
  });

  it('逻辑表优先已确认结果，不读候选；无结果退回冻结输入', () => {
    const current = turn();
    expect(readLogicalWorldTableSnapshot_ACU(current)).toEqual(current.tableInput.tableData);
    current.assistantFloor.data.table = {};
    expect(() => readLogicalWorldTableSnapshot_ACU(current)).toThrow();
    delete current.assistantFloor.data.table;
    const result = { floorId: current.assistantFloor.floorId, tableData: sheet(),
      completedAiFloorBySheetKey: {}, filledSheetKeys: [] };
    result.tableData.sheet_0.content[1][1] = '已确认';
    current.assistantFloor.data.table = result;
    current.effectReceipts.push({ kind: 'table', status: 'durable', effectId: 'receipt',
      fingerprint: getTableDataFingerprint_ACU(result) });
    expect(readLogicalWorldTableSnapshot_ACU(current).sheet_0.content[1][1]).toBe('已确认');
    current.assistantFloor.data.table = { ...result, floorId: '其他楼层' };
    expect(() => readLogicalWorldTableSnapshot_ACU(current)).toThrow();
  });
});
