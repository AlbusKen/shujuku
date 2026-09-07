/**
 * service/table/compat-transition-checkpoint.ts — 过渡回放根（spv79 专用 + 通用兼容）
 *
 * 由 spv79-transition-checkpoint.ts 迁入并泛化：
 * - spv79TransitionCheckpoint：仅覆盖 duplicate_row_id 的旧版私有过渡根（读取兼容保留）。
 * - compatTransitionCheckpoint：通用兼容过渡根，覆盖 spv7.9 语义全集的固化结果。
 * 两者同时存在时取 cutoff 更新者作为回放基座（findLatestTransitionCheckpoint_ACU）。
 */
import { readIsolatedTagData_ACU } from '../../data/repositories/chat-message-data-repo';
import type { TableDataObject_ACU } from '../../shared/models/table-data';
import { isEmptyCanonicalRowId_ACU, restoreLegacyRowIdentity_ACU } from '../../shared/canonical-row-normalizer';
import { validateCanonicalCheckpointData_ACU } from '../../shared/canonical-checkpoint-validator';
import { allocateStableRowId_ACU } from '../../shared/stable-row-id-allocator';
import type { CompatTransitionCheckpointV1_ACU, Spv79TransitionCheckpointV1_ACU } from './storage-frame-v2-types';

export interface Spv79TransitionCheckpointRef_ACU {
  messageIndex: number;
  aiFloor: number;
  checkpoint: Spv79TransitionCheckpointV1_ACU;
}

export interface CompatTransitionCheckpointRef_ACU {
  messageIndex: number;
  aiFloor: number;
  checkpoint: CompatTransitionCheckpointV1_ACU;
}

export type TransitionCheckpointSource_ACU = 'compat' | 'spv79';

/** 统一过渡根引用：回放基座只依赖 cutoff/data/scheduleSummary，与来源无关。 */
export interface TransitionCheckpointRef_ACU {
  messageIndex: number;
  aiFloor: number;
  source: TransitionCheckpointSource_ACU;
  checkpoint: Spv79TransitionCheckpointV1_ACU | CompatTransitionCheckpointV1_ACU;
}

/** cutoff 判定的最小结构契约：spv79 与 compat 两代根共用同一套判定函数。 */
export interface TransitionCutoffSource_ACU {
  cutoff: {
    messageIndex: number;
    seq: number;
    operationIndex: number;
  };
}

function hasValidScheduleSummary_ACU(value: unknown): boolean {
  return value === undefined || (!!value && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every(summary => !!summary
      && typeof summary === 'object' && !Array.isArray(summary)
      && ((summary as Record<string, unknown>).lastFilledAiFloor === undefined
        || (Number.isFinite((summary as Record<string, unknown>).lastFilledAiFloor)
          && Number((summary as Record<string, unknown>).lastFilledAiFloor) >= 0))
      && ((summary as Record<string, unknown>).lastChangedAiFloor === undefined
        || (Number.isFinite((summary as Record<string, unknown>).lastChangedAiFloor)
          && Number((summary as Record<string, unknown>).lastChangedAiFloor) >= 0))));
}

function hasValidCutoffAndCommonFields_ACU(checkpoint: Record<string, unknown>): boolean {
  const cutoff = checkpoint.cutoff as Record<string, unknown> | undefined;
  const canonicalData = validateCanonicalCheckpointData_ACU(checkpoint.data);
  return checkpoint.version === 1
    && Number.isFinite(checkpoint.createdAt) && Number(checkpoint.createdAt) >= 0
    && canonicalData.valid
    && !!cutoff
    && Number.isInteger(cutoff.messageIndex) && Number(cutoff.messageIndex) >= 0
    && Number.isInteger(cutoff.seq) && Number(cutoff.seq) >= 0
    && Number.isInteger(cutoff.operationIndex) && Number(cutoff.operationIndex) >= -1
    && hasValidScheduleSummary_ACU(checkpoint.scheduleSummary);
}

function isCheckpoint_ACU(value: unknown): value is Spv79TransitionCheckpointV1_ACU {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const checkpoint = value as Record<string, unknown>;
  return checkpoint.kind === 'spv79_duplicate_row_id_transition'
    && hasValidCutoffAndCommonFields_ACU(checkpoint);
}

function isCompatCheckpoint_ACU(value: unknown): value is CompatTransitionCheckpointV1_ACU {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const checkpoint = value as Record<string, unknown>;
  return checkpoint.kind === 'compat_replay_transition'
    && Array.isArray(checkpoint.tolerances)
    && (checkpoint.tolerances as unknown[]).every(item => typeof item === 'string')
    && hasValidCutoffAndCommonFields_ACU(checkpoint);
}

export function findLatestSpv79TransitionCheckpoint_ACU(
  chat: any[] | null | undefined,
  isolationKey: string,
  maxMessageIndex?: number,
): Spv79TransitionCheckpointRef_ACU | null {
  if (!Array.isArray(chat)) return null;
  const upperBound = maxMessageIndex === undefined
    ? chat.length - 1
    : Math.min(chat.length - 1, Math.max(-1, Math.floor(maxMessageIndex)));
  let aiFloor = 0;
  let latest: Spv79TransitionCheckpointRef_ACU | null = null;
  for (let messageIndex = 0; messageIndex <= upperBound; messageIndex += 1) {
    const message = chat[messageIndex];
    if (!message || message.is_user) continue;
    aiFloor += 1;
    const tagData = readIsolatedTagData_ACU(message, isolationKey) as any;
    const checkpoint = tagData?.spv79TransitionCheckpoint;
    if (isCheckpoint_ACU(checkpoint)) latest = { messageIndex, aiFloor, checkpoint };
  }
  return latest;
}

export function findLatestCompatTransitionCheckpoint_ACU(
  chat: any[] | null | undefined,
  isolationKey: string,
  maxMessageIndex?: number,
): CompatTransitionCheckpointRef_ACU | null {
  if (!Array.isArray(chat)) return null;
  const upperBound = maxMessageIndex === undefined
    ? chat.length - 1
    : Math.min(chat.length - 1, Math.max(-1, Math.floor(maxMessageIndex)));
  let aiFloor = 0;
  let latest: CompatTransitionCheckpointRef_ACU | null = null;
  for (let messageIndex = 0; messageIndex <= upperBound; messageIndex += 1) {
    const message = chat[messageIndex];
    if (!message || message.is_user) continue;
    aiFloor += 1;
    const tagData = readIsolatedTagData_ACU(message, isolationKey) as any;
    const checkpoint = tagData?.compatTransitionCheckpoint;
    if (isCompatCheckpoint_ACU(checkpoint)) latest = { messageIndex, aiFloor, checkpoint };
  }
  return latest;
}

/** cutoff 字典序比较：left 在 right 之前（更旧）返回负数，相等返回 0。 */
export function compareTransitionCutoffs_ACU(
  left: TransitionCutoffSource_ACU['cutoff'],
  right: TransitionCutoffSource_ACU['cutoff'],
): number {
  if (left.messageIndex !== right.messageIndex) return left.messageIndex - right.messageIndex;
  if (left.seq !== right.seq) return left.seq - right.seq;
  return left.operationIndex - right.operationIndex;
}

/**
 * 统一过渡根查找：两代槽位同时存在时取 cutoff 更新者；cutoff 全等时取
 * createdAt 更新者；再平局取 compat（更泛化的一代）。
 */
export function findLatestTransitionCheckpoint_ACU(
  chat: any[] | null | undefined,
  isolationKey: string,
  maxMessageIndex?: number,
): TransitionCheckpointRef_ACU | null {
  const spv79 = findLatestSpv79TransitionCheckpoint_ACU(chat, isolationKey, maxMessageIndex);
  const compat = findLatestCompatTransitionCheckpoint_ACU(chat, isolationKey, maxMessageIndex);
  if (!spv79 && !compat) return null;
  if (!compat) return { ...spv79!, source: 'spv79' };
  if (!spv79) return { ...compat, source: 'compat' };
  const cutoffOrder = compareTransitionCutoffs_ACU(spv79.checkpoint.cutoff, compat.checkpoint.cutoff);
  if (cutoffOrder !== 0) {
    return cutoffOrder > 0 ? { ...spv79, source: 'spv79' } : { ...compat, source: 'compat' };
  }
  if (spv79.checkpoint.createdAt > compat.checkpoint.createdAt) return { ...spv79, source: 'spv79' };
  return { ...compat, source: 'compat' };
}

/**
 * Frame-level artifacts (full/per-sheet checkpoints and timelines) have no
 * operation cursor. A transition root therefore owns every such artifact up
 * to and including the cutoff message.
 */
export function isFrameArtifactAfterSpv79TransitionCutoff_ACU(
  messageIndex: number,
  checkpoint: TransitionCutoffSource_ACU,
): boolean {
  return messageIndex > checkpoint.cutoff.messageIndex;
}

/** Entry-level events have a seq but no operationIndex, so the cutoff entry is absorbed whole. */
export function isEntryAfterSpv79TransitionCutoff_ACU(
  messageIndex: number,
  seq: number,
  checkpoint: TransitionCutoffSource_ACU,
): boolean {
  if (messageIndex !== checkpoint.cutoff.messageIndex) return messageIndex > checkpoint.cutoff.messageIndex;
  return seq > checkpoint.cutoff.seq;
}

export function isAfterSpv79TransitionCutoff_ACU(
  messageIndex: number,
  seq: number,
  operationIndex: number,
  checkpoint: TransitionCutoffSource_ACU,
): boolean {
  const cutoff = checkpoint.cutoff;
  if (messageIndex !== cutoff.messageIndex) return messageIndex > cutoff.messageIndex;
  if (seq !== cutoff.seq) return seq > cutoff.seq;
  return operationIndex > cutoff.operationIndex;
}

export function cloneSpv79TransitionData_ACU(checkpoint: { data: TableDataObject_ACU }): TableDataObject_ACU {
  return JSON.parse(JSON.stringify(checkpoint.data)) as TableDataObject_ACU;
}

/**
 * 将旧回放的最终可见状态转为新版行身份。旧身份不再参与后续普通 V2 增量，
 * 因此按每张表的物理行序统一重编号，而不是猜测 duplicate row_id 的历史归属。
 */
export function reindexSpv79TransitionState_ACU(source: TableDataObject_ACU): TableDataObject_ACU {
  const data = JSON.parse(JSON.stringify(source)) as TableDataObject_ACU;
  restoreLegacyRowIdentity_ACU(data);
  Object.entries(data).forEach(([sheetKey, value]) => {
    if (!sheetKey.startsWith('sheet_') || !value || typeof value !== 'object') return;
    const sheet = value as any;
    if (!Array.isArray(sheet.content) || !Array.isArray(sheet.content[0])) return;
    sheet.content[0][0] = 'row_id';
    let nextId = 1;
    for (let index = 1; index < sheet.content.length; index += 1) {
      if (!Array.isArray(sheet.content[index])) continue;
      sheet.content[index][0] = String(nextId++);
    }
    if (Array.isArray(sheet.seedRows)) {
      sheet.seedRows.forEach((row: unknown) => {
        if (Array.isArray(row)) row[0] = String(nextId++);
      });
    }
  });
  return data;
}

export interface CompatTransitionRowIdentityRepair_ACU {
  sheetKey: string;
  /** content 行索引（含表头，从 1 起）；seedRows 用负数表示：-(index+1)。 */
  rowIndex: number;
  previousRowId: string;
  nextRowId: string;
  reason: 'duplicate_row_id' | 'empty_row_id';
}

export interface CompatTransitionRowIdentityResult_ACU {
  data: TableDataObject_ACU;
  repairs: CompatTransitionRowIdentityRepair_ACU[];
}

/**
 * 把兼容宽容回放的可见状态归一为 canonical 行身份契约，但**保留每一个已有 row_id**。
 *
 * 与 reindexSpv79TransitionState_ACU 的全表重编号不同：兼容过渡根可能落在聊天中段，
 * 其后仍有严格回放的增量按 row_id 引用行（`UPDATE ... WHERE row_id = 5`）。如果固化时把
 * 5 改成 3，后续增量会静默更新到另一行。因此这里只处理会让 canonical 校验失败的行：
 * - 同表内第二次及之后出现的重复 row_id → 分配该表当前最大 id + 1（首次出现保留原 id）；
 * - 空 row_id（restoreLegacyRowIdentity_ACU 之后仍为空的行）→ 同样分配新 id。
 * 所有 id 按 trim 后的字符串比较与写回；表头身份列统一为 'row_id'。
 */
export function dedupeCompatTransitionRowIdentities_ACU(source: TableDataObject_ACU): CompatTransitionRowIdentityResult_ACU {
  const data = JSON.parse(JSON.stringify(source)) as TableDataObject_ACU;
  restoreLegacyRowIdentity_ACU(data);
  const repairs: CompatTransitionRowIdentityRepair_ACU[] = [];
  Object.entries(data).forEach(([sheetKey, value]) => {
    if (!sheetKey.startsWith('sheet_') || !value || typeof value !== 'object') return;
    const sheet = value as any;
    if (!Array.isArray(sheet.content) || !Array.isArray(sheet.content[0])) return;
    sheet.content[0][0] = 'row_id';
    const contentRows: unknown[][] = [];
    for (let index = 1; index < sheet.content.length; index += 1) {
      if (Array.isArray(sheet.content[index])) contentRows.push(sheet.content[index]);
    }
    const seedRows: unknown[][] = Array.isArray(sheet.seedRows)
      ? (sheet.seedRows as unknown[]).filter((row): row is unknown[] => Array.isArray(row))
      : [];
    // 先登记全部合法 id，再给冲突行分配，保证新 id 不会撞到后面尚未遍历的行。
    const reserved = new Set<string>();
    const seen = new Set<string>();
    for (const row of [...contentRows, ...seedRows]) {
      if (isEmptyCanonicalRowId_ACU(row[0])) continue;
      reserved.add(String(row[0]).trim());
    }
    const repairRow = (row: unknown[], rowIndex: number): void => {
      if (isEmptyCanonicalRowId_ACU(row[0])) {
        const nextRowId = allocateStableRowId_ACU(reserved);
        reserved.add(nextRowId);
        seen.add(nextRowId);
        repairs.push({ sheetKey, rowIndex, previousRowId: '', nextRowId, reason: 'empty_row_id' });
        row[0] = nextRowId;
        return;
      }
      const rowId = String(row[0]).trim();
      if (!seen.has(rowId)) {
        seen.add(rowId);
        row[0] = rowId;
        return;
      }
      const nextRowId = allocateStableRowId_ACU(reserved);
      reserved.add(nextRowId);
      seen.add(nextRowId);
      repairs.push({ sheetKey, rowIndex, previousRowId: rowId, nextRowId, reason: 'duplicate_row_id' });
      row[0] = nextRowId;
    };
    let contentRowIndex = 0;
    for (let index = 1; index < sheet.content.length; index += 1) {
      if (!Array.isArray(sheet.content[index])) continue;
      repairRow(contentRows[contentRowIndex], index);
      contentRowIndex += 1;
    }
    seedRows.forEach((row, index) => repairRow(row, -(index + 1)));
  });
  return { data, repairs };
}
