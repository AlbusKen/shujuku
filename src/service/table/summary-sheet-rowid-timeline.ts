/**
 * service/table/summary-sheet-rowid-timeline.ts — 纪要表 rowId 集合的 entry 边界时间线
 *
 * 向量镜像只跟踪 rowId 的增减，不解释 SQL / sheet_replace / data_replace 的语义。
 * 本模块对正式 V2 replay 做一次只读观察：
 *   - rowIdsAtCheckpoint：直接取表格 full checkpoint.data 中目标表的 rowId，不含 C 层 logEntries；
 *   - 每个触及目标表的 table entry 应用后记录 rowIdsAfter；
 *   - rowIdsAtHead：完整 replay 结束后目标表的 rowId 集合。
 *
 * 重复 rowId / 空 rowId 单独报告（R4），不阻断时间线本身；writer 据此 fail-closed。
 */

import type { Sheet_ACU } from '../../shared/models/table-data';
import { toChatIsolationSlotKey_ACU } from '../../shared/summary-vector-index-scope';
import { getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import { locateSummaryVectorMirrorBase_ACU } from '../vector/summary-vector-mirror-resolver';
import { loadTableStateFromFramesV2Detailed_ACU } from './storage-frame-v2-replay';
import type { TableMutationLogEntryV2_ACU, TableMutationWriteSetV2_ACU } from './storage-frame-v2-types';

export interface SummarySheetRowIdDuplicateV2_ACU {
  rowId: string;
  /** checkpoint 边界为 null；entry 边界为该 entry 的 entryId。 */
  entryId: string | null;
  messageIndex?: number;
}

export interface SummarySheetRowIdTimelineEntryV2_ACU {
  messageIndex: number;
  entryId: string;
  commitRevision: string | null;
  seq: number;
  rowIdsAfter: string[];
}

export type SummarySheetRowIdTimelineStatusV2_ACU =
  | 'ok'
  | 'unsupported_replay_base'
  | 'replay_failed';

export interface SummarySheetRowIdTimelineV2_ACU {
  status: SummarySheetRowIdTimelineStatusV2_ACU;
  checkpointMessageIndex: number | null;
  rowIdsAtCheckpoint: string[];
  entries: SummarySheetRowIdTimelineEntryV2_ACU[];
  rowIdsAtHead: string[];
  duplicates: SummarySheetRowIdDuplicateV2_ACU[];
  emptyRowIdCount: number;
  error?: string;
}

export interface CollectSummarySheetRowIdTimelineOptions_ACU {
  chat: any[] | null | undefined;
  isolationKey: string;
  sheetKey: string;
}

function normalizeSheetKey_ACU(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeRowId_ACU(value: unknown): string {
  return String(value ?? '').trim();
}

function inspectSheetRowIds_ACU(sheet: unknown): {
  rowIds: string[];
  duplicates: string[];
  emptyRowIdCount: number;
} {
  if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet)) {
    return { rowIds: [], duplicates: [], emptyRowIdCount: 0 };
  }
  const content = Array.isArray((sheet as Sheet_ACU).content) ? (sheet as Sheet_ACU).content : [];
  const seen = new Set<string>();
  const rowIds: string[] = [];
  const duplicates: string[] = [];
  let emptyRowIdCount = 0;
  for (let index = 1; index < content.length; index += 1) {
    const row = content[index];
    if (!Array.isArray(row)) continue;
    const rowId = normalizeRowId_ACU(row[0]);
    if (!rowId) {
      emptyRowIdCount += 1;
      continue;
    }
    if (seen.has(rowId)) {
      if (!duplicates.includes(rowId)) duplicates.push(rowId);
      continue;
    }
    seen.add(rowId);
    rowIds.push(rowId);
  }
  return { rowIds, duplicates, emptyRowIdCount };
}

function writeSetTouchesSheet_ACU(writeSet: TableMutationWriteSetV2_ACU | undefined, sheetKey: string): boolean {
  if (!Array.isArray(writeSet)) return false;
  return writeSet.some((unit) => {
    if (!unit || typeof unit !== 'object') return false;
    if (unit.kind === 'all') return true;
    return (unit.kind === 'sheet' || unit.kind === 'row' || unit.kind === 'cell' || unit.kind === 'schema')
      && normalizeSheetKey_ACU(unit.sheetKey) === sheetKey;
  });
}

export function tableEntryTouchesSheetV2_ACU(entry: TableMutationLogEntryV2_ACU | null | undefined, sheetKey: string): boolean {
  const target = normalizeSheetKey_ACU(sheetKey);
  if (!entry || !target) return false;
  if (Array.isArray(entry.changedSheetKeys) && entry.changedSheetKeys.some((key) => normalizeSheetKey_ACU(key) === target)) {
    return true;
  }
  return writeSetTouchesSheet_ACU(entry.writeSet, target);
}

function emptyTimeline_ACU(
  status: SummarySheetRowIdTimelineStatusV2_ACU,
  checkpointMessageIndex: number | null,
  error?: string,
): SummarySheetRowIdTimelineV2_ACU {
  return {
    status,
    checkpointMessageIndex,
    rowIdsAtCheckpoint: [],
    entries: [],
    rowIdsAtHead: [],
    duplicates: [],
    emptyRowIdCount: 0,
    ...(error ? { error } : {}),
  };
}

export async function collectSummarySheetRowIdTimelineV2_ACU(
  options: CollectSummarySheetRowIdTimelineOptions_ACU,
): Promise<SummarySheetRowIdTimelineV2_ACU> {
  const sheetKey = normalizeSheetKey_ACU(options.sheetKey);
  if (!sheetKey.startsWith('sheet_')) {
    return emptyTimeline_ACU('replay_failed', null, `sheetKey 非法：${sheetKey || '<empty>'}`);
  }

  const isolationKey = toChatIsolationSlotKey_ACU(options.isolationKey, getCurrentIsolationKey_ACU());
  const base = locateSummaryVectorMirrorBase_ACU(options.chat, isolationKey);
  if (!base || !base.frame.checkpoint || base.frame.checkpoint.kind !== 'full') {
    return emptyTimeline_ACU('unsupported_replay_base', null);
  }

  const checkpointInspect = inspectSheetRowIds_ACU(base.frame.checkpoint.data?.[sheetKey]);
  const duplicates: SummarySheetRowIdDuplicateV2_ACU[] = checkpointInspect.duplicates.map((rowId): SummarySheetRowIdDuplicateV2_ACU => ({
    rowId,
    entryId: null,
    messageIndex: base.messageIndex,
  }));
  const entries: SummarySheetRowIdTimelineEntryV2_ACU[] = [];

  let replay;
  try {
    replay = await loadTableStateFromFramesV2Detailed_ACU(options.chat, isolationKey, {
      updateRuntimeState: false,
      onEntryApplied: async (context) => {
        if (!tableEntryTouchesSheetV2_ACU(context.entry, sheetKey)) return;
        const sheet = await context.readSheet(sheetKey);
        const inspect = inspectSheetRowIds_ACU(sheet);
        inspect.duplicates.forEach((rowId) => {
          duplicates.push({
            rowId,
            entryId: context.entry.entryId,
            messageIndex: context.messageIndex,
          });
        });
        entries.push({
          messageIndex: context.messageIndex,
          entryId: context.entry.entryId,
          commitRevision: typeof context.entry.commitRevision === 'string' ? context.entry.commitRevision : null,
          seq: Number(context.entry.seq),
          rowIdsAfter: inspect.rowIds,
        });
      },
    });
  } catch (error: any) {
    return {
      ...emptyTimeline_ACU(
        'replay_failed',
        base.messageIndex,
        `V2 replay 失败：${error?.message || String(error || '未知错误')}`,
      ),
      rowIdsAtCheckpoint: checkpointInspect.rowIds,
      duplicates,
      emptyRowIdCount: checkpointInspect.emptyRowIdCount,
    };
  }

  if (!replay) {
    return {
      ...emptyTimeline_ACU('replay_failed', base.messageIndex, 'V2 replay 未返回结果。'),
      rowIdsAtCheckpoint: checkpointInspect.rowIds,
      duplicates,
      emptyRowIdCount: checkpointInspect.emptyRowIdCount,
    };
  }

  const headInspect = inspectSheetRowIds_ACU(replay.data?.[sheetKey]);

  return {
    status: 'ok',
    checkpointMessageIndex: base.messageIndex,
    rowIdsAtCheckpoint: checkpointInspect.rowIds,
    entries,
    rowIdsAtHead: headInspect.rowIds,
    duplicates,
    emptyRowIdCount: headInspect.emptyRowIdCount,
  };
}
