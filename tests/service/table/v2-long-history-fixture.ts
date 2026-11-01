/**
 * 阶段 A：长历史合成 fixture（17 表 / 62 帧 / 约 660 operation）。
 *
 * 全部由确定性代码生成，不用 JSON 文件，避免数千行不可维护的静态数据。
 * 生成的 storage frame 遵循 V2 结构：首个 message 携带 full checkpoint（17 表），
 * 后续 message 携带 logEntries（sql_sheet_batch / row_upsert / data_replace）。
 *
 * 只用于 replay 性能/正确性观测，不参与生产路径。
 */

import type { TableStorageFrameV2_ACU } from '../../../../src/service/table/storage-frame-v2-types';

const SHEET_COUNT = 17;
const FRAME_COUNT = 62;
const OPERATIONS_PER_FRAME = 11; // 62 * 11 ≈ 660（首帧只含 checkpoint，无 operation）

function sheetKey(index: number): string {
  return `sheet_${index}`;
}

function physicalTableName(index: number): string {
  return `tbl_${index}`;
}

function makeSheet(index: number): any {
  return {
    uid: `uid_${index}`,
    name: `表${index}`,
    content: [
      ['row_id', 'name', 'value'],
      ['1', `初始行${index}`, index],
    ],
    sourceData: {
      ddl: `CREATE TABLE ${physicalTableName(index)} (row_id INTEGER PRIMARY KEY, name TEXT, value INTEGER);`,
    },
    updateConfig: {},
    exportConfig: {},
    orderNo: index,
  };
}

function makeCheckpointData(): any {
  const data: any = { mate: { type: 'acu', version: 1 } };
  for (let i = 0; i < SHEET_COUNT; i += 1) {
    data[sheetKey(i)] = makeSheet(i);
  }
  return data;
}

function makeFrame(index: number): TableStorageFrameV2_ACU {
  if (index === 0) {
    return {
      version: 2,
      checkpoint: {
        kind: 'full',
        createdAt: 1,
        reason: 'init',
        data: makeCheckpointData(),
      },
      logEntries: [],
    };
  }

  // 每帧生成 11 条 operation：连续 DML SQL 为主（模拟长历史 SQL 段），
  // 穿插少量 row_upsert 与一次 data_replace，制造结构事件与 epoch 失效。
  const operations: any[] = [];
  const frameBase = index * 1000;
  for (let op = 0; op < OPERATIONS_PER_FRAME; op += 1) {
    const target = (index + op) % SHEET_COUNT;
    if (op === 10) {
      // 每帧末插入 data_replace：强制结构失效，alias registry 必须重建。
      operations.push({ kind: 'data_replace', data: makeCheckpointData(), reason: 'frame_rollup' });
    } else if (op % 5 === 4) {
      operations.push({ kind: 'row_upsert', sheetKey: sheetKey(target), rowId: String(op + 1), cells: [String(op + 1), `行${frameBase + op}`, op] });
    } else {
      operations.push({
        kind: 'sql_sheet_batch',
        sheetKey: sheetKey(target),
        tableName: physicalTableName(target),
        statements: [`INSERT INTO ${physicalTableName(target)} (row_id, name, value) VALUES (?, ?, ?)`],
        params: [[frameBase + op, `sql${frameBase + op}`, op]],
        reason: 'system',
      });
    }
  }

  return {
    version: 2,
    logEntries: [{
      seq: index,
      entryId: `frame-${index}`,
      createdAt: index + 1,
      source: 'auto_fill',
      targetMessageIndex: index,
      aiFloor: 1,
      filledSheetKeys: [],
      changedSheetKeys: [],
      groupKeys: [],
      operations,
    }],
  };
}

export interface LongHistoryFixture_ACU {
  chat: any[];
  /** 每帧 sql_sheet_batch 数量（data_replace 除外）。 */
  sqlBatchPerFrame: number;
  /** 每帧 row_upsert 数量。 */
  rowUpsertPerFrame: number;
  /** 每帧 data_replace 数量。 */
  dataReplacePerFrame: number;
  frameCount: number;
  sheetCount: number;
  totalOperations: number;
  totalSqlOperations: number;
}

/**
 * 生成长历史（默认 62 帧）：首帧 full checkpoint（17 表），其余帧各 11 条 operation。
 * 每帧：8 条 sql_sheet_batch（op=0..3,5..8）+ 2 条 row_upsert（op=4,9）
 * + 1 条 data_replace（op=10）。
 * frameCount 用于规模基准（如 #58 的 400 帧），帧内容只依赖帧索引。
 */
export function buildLongHistoryFixture_ACU(frameCount: number = FRAME_COUNT): LongHistoryFixture_ACU {
  const chat: any[] = [];
  for (let i = 0; i < frameCount; i += 1) {
    chat.push({
      is_user: false,
      mes: `消息 ${i}`,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: makeFrame(i),
        },
      },
    });
  }

  const sqlBatchPerFrame = OPERATIONS_PER_FRAME - 3; // 8（op=4、op=9 是 row_upsert）
  const rowUpsertPerFrame = 2;
  const dataReplacePerFrame = 1;
  const totalOperations = (frameCount - 1) * OPERATIONS_PER_FRAME;
  const totalSqlOperations = (frameCount - 1) * sqlBatchPerFrame;

  return {
    chat,
    sqlBatchPerFrame,
    rowUpsertPerFrame,
    dataReplacePerFrame,
    frameCount,
    sheetCount: SHEET_COUNT,
    totalOperations,
    totalSqlOperations,
  };
}
