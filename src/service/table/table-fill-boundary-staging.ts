import { getChatArray_ACU, saveChatToHostStrict_ACU } from '../../data/gateways/chat-gateway';
import { readIsolatedDataContainer_ACU, writeMessageIdentity_ACU } from '../../data/repositories/chat-message-data-repo';
import type { Sheet_ACU, TableDataObject_ACU } from '../../shared/models/table-data';
import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { currentChatFileIdentifier_ACU, getCurrentIsolationKey_ACU, settings_ACU, _set_currentJsonTableData_ACU } from '../runtime/state-manager';
import { createCanonicalSnapshotEnvelope_ACU } from './canonical-snapshot-envelope';
import { buildCanonicalSheetCheckpoint_ACU } from './canonical-checkpoint-builder';
import { getOriginalFullFrameFingerprint_ACU } from './manual-catch-up-provisional-bridge';
import { isSqliteMode } from './storage-mode';
import { loadTableStatesAtBoundariesFromFramesV2Detailed_ACU, type TableReplayResultV2_ACU } from './storage-frame-v2-replay';
import { isV2TagData_ACU } from './storage-strategy-resolver';
import type { TableStorageFrameV2_ACU } from './storage-frame-v2-types';
import { getTableDataFingerprint_ACU } from './table-data-upgrade-audit';
import { getRuntimeLifecycleEpoch_ACU, hydrateStorageProviderFromSnapshot_ACU } from './table-storage-strategy';
import { runTableWriteTransaction_ACU } from './table-write-transaction';

export type TableFillRunKind = 'manual_refill' | 'auto_fill' | 'manual_catch_up';

export type TableFillBoundaryDiagnosticCode_ACU =
  | 'invalid_input'
  | 'multiple_full_checkpoints'
  | 'full_checkpoint_root_mismatch'
  | 'full_checkpoint_fingerprint_mismatch'
  | 'staging_scope_changed'
  | 'staging_target_snapshot_missing'
  | 'selected_sheet_boundary_mismatch'
  | 'non_target_boundary_mismatch'
  | 'non_target_head_mismatch'
  | 'candidate_write_surface_violation'
  | 'candidate_replay_requires_repair'
  | 'boundary_strict_save_failed'
  | 'runtime_publish_failed'
  | 'boundary_replay_mismatch'
  | 'boundary_commit_failed';

export type TableFillBoundaryStagingPhase =
  | 'pre_boundary_staging'
  | 'boundary_committing'
  | 'post_boundary_persisting';

export class TableFillBoundaryPlanError_ACU extends Error {
  constructor(
    readonly code: 'invalid_input' | 'multiple_full_checkpoints',
    message: string,
  ) {
    super(message);
    this.name = 'TableFillBoundaryPlanError_ACU';
  }
}

export interface TableFillBoundaryStagingScope_ACU {
  readonly runKind: TableFillRunKind;
  readonly runId: string;
  readonly chatKey: string;
  readonly isolationKey: string;
  readonly originalFullIndex: number | null;
  readonly rangeStartMessageIndex: number | null;
  readonly rangeEndMessageIndex: number | null;
  readonly targetSheetKeys: readonly string[];
  readonly templateFingerprint: string;
}

export interface TableFillBoundaryStagingPlanInput_ACU {
  runKind: TableFillRunKind;
  runId: string;
  chatKey: string;
  isolationKey: string;
  targetSheetKeys: readonly string[];
  templateFingerprint: string;
  messageIndices: readonly number[];
  fullCheckpointIndices: readonly number[];
}

export interface TableFillBoundaryStagingPlan_ACU {
  readonly scope: TableFillBoundaryStagingScope_ACU;
  preBoundaryIndices: number[];
  postBoundaryIndices: number[];
  requiresStaging: boolean;
  phase: TableFillBoundaryStagingPhase;
  lastStagedTargetMessageIndex: number | null;
  stagedBucketCount: number;
  boundaryCommitted: boolean;
}

/**
 * 目标表 overlay：staging 的唯一权威状态。
 * sheets 只能包含 targetSheetKeys；非目标表、mate 和整库 runtime 不得进入。
 */
export interface TableFillTargetOverlay_ACU {
  readonly targetSheetKeys: readonly string[];
  sheets: Record<string, Sheet_ACU>;
  lastTargetMessageIndex: number | null;
  stagedBucketCount: number;
}

/**
 * 共享 stage-only runner 的运行时上下文。
 * overlay 是唯一权威 staging 状态；不再保存整库 stagedWorkingData/lastStagedSnapshot。
 */
export interface TableFillStagingRunContext_ACU {
  readonly runId: string;
  readonly chatKey: string;
  readonly isolationKey: string;
  readonly targetSheetKeys: readonly string[];
  readonly originalFullIndex: number | null;
  readonly originalFullFingerprint: string | null;
  readonly templateFingerprint: string;
  overlay: TableFillTargetOverlay_ACU;
}

export function createTableFillStagingRunContext_ACU(input: {
  runId: string;
  chatKey: string;
  isolationKey: string;
  targetSheetKeys: readonly string[];
  originalFullIndex: number | null;
  originalFullFingerprint?: string | null;
  templateFingerprint: string;
}): TableFillStagingRunContext_ACU {
  return {
    runId: input.runId,
    chatKey: input.chatKey,
    isolationKey: input.isolationKey,
    targetSheetKeys: Object.freeze([...input.targetSheetKeys]),
    originalFullIndex: input.originalFullIndex,
    originalFullFingerprint: input.originalFullFingerprint ?? null,
    templateFingerprint: input.templateFingerprint,
    overlay: createEmptyTargetOverlay_ACU(input.targetSheetKeys),
  };
}

export function createEmptyTargetOverlay_ACU(targetSheetKeys: readonly string[]): TableFillTargetOverlay_ACU {
  return {
    targetSheetKeys: Object.freeze([...targetSheetKeys]),
    sheets: {},
    lastTargetMessageIndex: null,
    stagedBucketCount: 0,
  };
}

export function extractTargetOverlaySheets_ACU(
  data: Record<string, any> | null | undefined,
  targetSheetKeys: readonly string[],
): Record<string, Sheet_ACU> {
  const sheets: Record<string, Sheet_ACU> = {};
  if (!data || typeof data !== 'object') return sheets;
  for (const sheetKey of targetSheetKeys) {
    const sheet = data[sheetKey];
    if (sheet && typeof sheet === 'object' && !Array.isArray(sheet)) {
      sheets[sheetKey] = JSON.parse(JSON.stringify(sheet)) as Sheet_ACU;
    }
  }
  return sheets;
}

/**
 * 纯函数：historicalBase + target overlay → bucket working view。
 * 不写聊天、不写全局 runtime、不碰 provider。
 */
export function assembleBucketWorkingView_ACU(
  historicalBase: Record<string, any> | null | undefined,
  overlay: TableFillTargetOverlay_ACU | null | undefined,
): Record<string, any> {
  const base = historicalBase && typeof historicalBase === 'object'
    ? JSON.parse(JSON.stringify(historicalBase))
    : {};
  if (!overlay) return base;
  for (const sheetKey of overlay.targetSheetKeys) {
    const overlaySheet = overlay.sheets[sheetKey];
    if (overlaySheet && typeof overlaySheet === 'object') {
      base[sheetKey] = JSON.parse(JSON.stringify(overlaySheet));
    }
  }
  return base;
}

export function mergeTargetOverlayFromBucket_ACU(
  overlay: TableFillTargetOverlay_ACU,
  data: Record<string, any> | null | undefined,
  targetMessageIndex: number,
): TableFillTargetOverlay_ACU {
  return {
    targetSheetKeys: overlay.targetSheetKeys,
    sheets: {
      ...overlay.sheets,
      ...extractTargetOverlaySheets_ACU(data, overlay.targetSheetKeys),
    },
    lastTargetMessageIndex: targetMessageIndex,
    stagedBucketCount: overlay.stagedBucketCount + 1,
  };
}

export function readOriginalFullFrameFingerprint_ACU(
  chat: any[],
  isolationKey: string,
  originalFullIndex: number,
): string | null {
  const message = chat[originalFullIndex];
  if (!message) return null;
  const container = readIsolatedDataContainer_ACU(message);
  const tagData = container?.[isolationKey];
  if (!isV2TagData_ACU(tagData)) return null;
  const frame = (tagData as any).storageFrame as TableStorageFrameV2_ACU | undefined;
  if (!frame || frame.checkpoint?.kind !== 'full') return null;
  return getOriginalFullFrameFingerprint_ACU(frame);
}

function canonicalSheetFingerprint_ACU(sheet: unknown): string {
  return getTableDataFingerprint_ACU(sheet ?? null);
}

function failBoundary_ACU(
  diagnosticCode: TableFillBoundaryDiagnosticCode_ACU,
  error: string,
): { ok: false; error: string; diagnosticCode: TableFillBoundaryDiagnosticCode_ACU } {
  return { ok: false, error, diagnosticCode };
}

function assertCandidateWriteSurface_ACU(
  liveChat: any[],
  candidateChat: any[],
  isolationKey: string,
  originalFullIndex: number,
  targetSheetKeys: readonly string[],
): string | null {
  if (!Array.isArray(liveChat) || !Array.isArray(candidateChat) || liveChat.length !== candidateChat.length) {
    return 'candidate 改变了消息数量';
  }
  const targetSet = new Set(targetSheetKeys);
  const hostReserved = new Set(['TavernDB_ACU_IsolatedData']);
  for (let index = 0; index < liveChat.length; index += 1) {
    const liveMessage = liveChat[index] || {};
    const candidateMessage = candidateChat[index] || {};
    const liveHost: Record<string, unknown> = {};
    const candidateHost: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(liveMessage)) {
      if (!hostReserved.has(key)) liveHost[key] = value;
    }
    for (const [key, value] of Object.entries(candidateMessage)) {
      if (!hostReserved.has(key)) candidateHost[key] = value;
    }
    if (getTableDataFingerprint_ACU(liveHost) !== getTableDataFingerprint_ACU(candidateHost)) {
      return `message[${index}] 宿主字段被改写`;
    }
    const liveIso = (liveMessage as any).TavernDB_ACU_IsolatedData && typeof (liveMessage as any).TavernDB_ACU_IsolatedData === 'object'
      ? (liveMessage as any).TavernDB_ACU_IsolatedData
      : {};
    const candidateIso = (candidateMessage as any).TavernDB_ACU_IsolatedData && typeof (candidateMessage as any).TavernDB_ACU_IsolatedData === 'object'
      ? (candidateMessage as any).TavernDB_ACU_IsolatedData
      : {};
    const isolationKeys = new Set([...Object.keys(liveIso), ...Object.keys(candidateIso)]);
    for (const key of isolationKeys) {
      if (key !== isolationKey) {
        if (getTableDataFingerprint_ACU(liveIso[key] ?? null) !== getTableDataFingerprint_ACU(candidateIso[key] ?? null)) {
          return `message[${index}] 非目标 isolationKey 被改写`;
        }
        continue;
      }
      if (index !== originalFullIndex) {
        if (getTableDataFingerprint_ACU(liveIso[key] ?? null) !== getTableDataFingerprint_ACU(candidateIso[key] ?? null)) {
          return `message[${index}] 目标 isolation 在非根楼层被改写`;
        }
        continue;
      }
      const liveTag = liveIso[key] && typeof liveIso[key] === 'object' ? liveIso[key] : {};
      const candidateTag = candidateIso[key] && typeof candidateIso[key] === 'object' ? candidateIso[key] : {};
      const liveFrame = (liveTag.storageFrame || {}) as TableStorageFrameV2_ACU;
      const candidateFrame = (candidateTag.storageFrame || {}) as TableStorageFrameV2_ACU;
      const liveTagRest = { ...liveTag, storageFrame: undefined };
      const candidateTagRest = { ...candidateTag, storageFrame: undefined };
      if (getTableDataFingerprint_ACU(liveTagRest) !== getTableDataFingerprint_ACU(candidateTagRest)) {
        return 'full checkpoint 宿主 tag 元数据被改写';
      }
      if (getTableDataFingerprint_ACU(liveFrame.checkpoint ?? null) !== getTableDataFingerprint_ACU(candidateFrame.checkpoint ?? null)) {
        return 'full checkpoint 本体被改写';
      }
      if (getTableDataFingerprint_ACU(liveFrame.logEntries ?? []) !== getTableDataFingerprint_ACU(candidateFrame.logEntries ?? [])) {
        return 'logEntries 被改写';
      }
      if (getTableDataFingerprint_ACU(liveFrame.headRevision ?? null) !== getTableDataFingerprint_ACU(candidateFrame.headRevision ?? null)) {
        return 'headRevision 被改写';
      }
      const liveFrameRest: Record<string, unknown> = { ...(liveFrame as any) };
      const candidateFrameRest: Record<string, unknown> = { ...(candidateFrame as any) };
      delete liveFrameRest.perSheetCheckpoints;
      delete candidateFrameRest.perSheetCheckpoints;
      delete liveFrameRest.checkpoint;
      delete candidateFrameRest.checkpoint;
      delete liveFrameRest.logEntries;
      delete candidateFrameRest.logEntries;
      delete liveFrameRest.headRevision;
      delete candidateFrameRest.headRevision;
      if (getTableDataFingerprint_ACU(liveFrameRest) !== getTableDataFingerprint_ACU(candidateFrameRest)) {
        return 'storageFrame 其他元数据被改写';
      }
      const livePer = liveFrame.perSheetCheckpoints || {};
      const candidatePer = candidateFrame.perSheetCheckpoints || {};
      const perKeys = new Set([...Object.keys(livePer), ...Object.keys(candidatePer)]);
      for (const sheetKey of perKeys) {
        if (targetSet.has(sheetKey)) continue;
        if (getTableDataFingerprint_ACU((livePer as any)[sheetKey] ?? null) !== getTableDataFingerprint_ACU((candidatePer as any)[sheetKey] ?? null)) {
          return `非目标 perSheetCheckpoints[${sheetKey}] 被改写`;
        }
      }
    }
  }
  return null;
}

function requireNonEmptyString_ACU(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new TableFillBoundaryPlanError_ACU('invalid_input', `跨 full checkpoint 填表规划缺少有效 ${field}。`);
  }
  return normalized;
}

function normalizeStrictlyIncreasingIndices_ACU(indices: readonly number[], field: string): number[] {
  if (!Array.isArray(indices)) {
    throw new TableFillBoundaryPlanError_ACU('invalid_input', `跨 full checkpoint 填表规划的 ${field} 必须是消息索引数组。`);
  }
  const normalized = [...indices];
  for (let index = 0; index < normalized.length; index += 1) {
    const value = normalized[index];
    if (!Number.isInteger(value) || value < 0 || (index > 0 && value <= normalized[index - 1])) {
      throw new TableFillBoundaryPlanError_ACU('invalid_input', `跨 full checkpoint 填表规划的 ${field} 必须为严格递增的非负整数。`);
    }
  }
  return normalized;
}

function normalizeTargetSheetKeys_ACU(targetSheetKeys: readonly string[]): string[] {
  if (!Array.isArray(targetSheetKeys)) {
    throw new TableFillBoundaryPlanError_ACU('invalid_input', '跨 full checkpoint 填表规划的目标表必须是数组。');
  }
  const normalized = [...new Set(targetSheetKeys.map(sheetKey => requireNonEmptyString_ACU(sheetKey, '目标表')))].sort();
  if (!normalized.length) {
    throw new TableFillBoundaryPlanError_ACU('invalid_input', '跨 full checkpoint 填表规划至少需要一个目标表。');
  }
  return normalized;
}

export function planTableFillBoundaryStaging_ACU(input: TableFillBoundaryStagingPlanInput_ACU): TableFillBoundaryStagingPlan_ACU {
  if (!input || typeof input !== 'object') {
    throw new TableFillBoundaryPlanError_ACU('invalid_input', '跨 full checkpoint 填表规划输入无效。');
  }
  if (!['manual_refill', 'auto_fill', 'manual_catch_up'].includes(input.runKind)) {
    throw new TableFillBoundaryPlanError_ACU('invalid_input', '跨 full checkpoint 填表规划的运行类型无效。');
  }

  const runId = requireNonEmptyString_ACU(input.runId, 'runId');
  const chatKey = requireNonEmptyString_ACU(input.chatKey, 'chatKey');
  const isolationKey = typeof input.isolationKey === 'string' ? input.isolationKey : '';
  if (typeof input.isolationKey !== 'string') {
    throw new TableFillBoundaryPlanError_ACU('invalid_input', '跨 full checkpoint 填表规划的 isolationKey 必须是字符串。');
  }
  const templateFingerprint = requireNonEmptyString_ACU(input.templateFingerprint, '模板指纹');
  const targetSheetKeys = normalizeTargetSheetKeys_ACU(input.targetSheetKeys);
  const messageIndices = normalizeStrictlyIncreasingIndices_ACU(input.messageIndices, '待填索引');
  const fullCheckpointIndices = normalizeStrictlyIncreasingIndices_ACU(input.fullCheckpointIndices, 'full checkpoint 索引');

  if (fullCheckpointIndices.length > 1) {
    throw new TableFillBoundaryPlanError_ACU(
      'multiple_full_checkpoints',
      `跨 full checkpoint 填表规划拒绝执行：同一 isolationKey 下存在 ${fullCheckpointIndices.length} 个 full checkpoint（${fullCheckpointIndices.join(', ')}）。`,
    );
  }

  const originalFullIndex = fullCheckpointIndices[0] ?? null;
  const preBoundaryIndices = originalFullIndex === null ? [] : messageIndices.filter(index => index < originalFullIndex);
  const postBoundaryIndices = originalFullIndex === null ? messageIndices : messageIndices.filter(index => index >= originalFullIndex);
  const requiresStaging = preBoundaryIndices.length > 0;
  const scope: TableFillBoundaryStagingScope_ACU = Object.freeze({
    runKind: input.runKind,
    runId,
    chatKey,
    isolationKey,
    originalFullIndex,
    rangeStartMessageIndex: messageIndices[0] ?? null,
    rangeEndMessageIndex: messageIndices.length > 0 ? messageIndices[messageIndices.length - 1] : null,
    targetSheetKeys: Object.freeze([...targetSheetKeys]),
    templateFingerprint,
  });

  return {
    scope,
    preBoundaryIndices,
    postBoundaryIndices,
    requiresStaging,
    phase: requiresStaging ? 'pre_boundary_staging' : 'post_boundary_persisting',
    lastStagedTargetMessageIndex: null,
    stagedBucketCount: 0,
    boundaryCommitted: false,
  };
}

/**
 * 计划 5.2：统一按边界拆分计划。
 *
 * 跨原 full 边界的原 batch（indices 同时含 < originalFullIndex 与 >= originalFullIndex）
 * 必须拆成两个新 batch，并重新计算 messageIndices / first-last / saveTargetIndex /
 * mergeBaseMaxMessageIndex / batch/progress 序号。
 *
 * 每段返回：
 * - indices：该段实际待填楼层（已滤除不在 messageIndices 内的楼层）；
 * - saveTargetIndex：段内最后实际楼层；
 * - mergeBaseMaxMessageIndex：段内首楼 - 1；若段首为原根，则取 max(首楼-1, originalFullIndex)
 *   以便基底覆盖原根；pre 段段首即 rangeStart 时允许 -1（无边界基底，落模板基线）。
 */
export interface BoundarySegment_ACU {
  readonly indices: readonly number[];
  readonly saveTargetIndex: number;
  readonly mergeBaseMaxMessageIndex: number;
}

export function splitMessageIndicesAtBoundary_ACU(
  messageIndices: readonly number[],
  originalFullIndex: number | null,
  fullMessageIndexSet: ReadonlySet<number> = new Set(),
): BoundarySegment_ACU[] {
  const normalized = normalizeStrictlyIncreasingIndices_ACU(messageIndices, '待拆索引');
  if (!normalized.length) return [];
  if (originalFullIndex === null) {
    const first = normalized[0];
    const last = normalized[normalized.length - 1];
    return [{
      indices: [...normalized],
      saveTargetIndex: last,
      mergeBaseMaxMessageIndex: first - 1,
    }];
  }

  const segments: BoundarySegment_ACU[] = [];
  const pre = normalized.filter(index => index < originalFullIndex);
  const post = normalized.filter(index => index >= originalFullIndex);
  if (pre.length > 0) {
    segments.push({
      indices: [...pre],
      saveTargetIndex: pre[pre.length - 1],
      mergeBaseMaxMessageIndex: pre[0] - 1,
    });
  }
  if (post.length > 0) {
    const mergeBaseMax = post[0] - 1;
    // 若边界楼层本身在待填集合内且作为正式根，基底必须至少覆盖原根，
    // 防止用边界前空基底覆盖已确认的正式根数据。
    const effectiveMergeBaseMax = fullMessageIndexSet.has(originalFullIndex)
      ? Math.max(mergeBaseMax, originalFullIndex)
      : mergeBaseMax;
    segments.push({
      indices: [...post],
      saveTargetIndex: post[post.length - 1],
      mergeBaseMaxMessageIndex: effectiveMergeBaseMax,
    });
  }
  return segments;
}


export interface TableFillBoundaryCommitSuccess_ACU {
  ok: true;
  boundaryCommitSummary: { selectedSheetKeys: string[]; originalFullCheckpointIndex: number };
  verifiedHeadSnapshot: Record<string, any>;
}

export type TableFillBoundaryCommitResult_ACU =
  | TableFillBoundaryCommitSuccess_ACU
  | { ok: false; error: string; diagnosticCode?: TableFillBoundaryDiagnosticCode_ACU };

/**
 * 跨 full checkpoint 分阶段提交的边界汇合。
 *
 * live/candidate 在同一 cutoff 上比较：
 * - boundary 目标表 == target overlay；非目标表 == liveBoundary
 * - head 非目标表 == liveHead；目标表必须由 candidate 完整 replay 得到，允许原 suffix log 继续生效
 */
export async function commitStagedSheetsAtFullBoundaryAtomic_ACU(
  runId: string,
  options: {
    chatKey?: string;
    isolationKey?: string;
    originalFullIndex: number;
    originalFullFingerprint?: string | null;
    templateFingerprint?: string;
    /** 仅含目标表的 overlay 快照。 */
    stagedSnapshot: Record<string, any>;
    targetSheetKeys: readonly string[];
  },
): Promise<TableFillBoundaryCommitResult_ACU> {
  const isolationKey = options.isolationKey ?? getCurrentIsolationKey_ACU();
  const chatKey = options.chatKey ?? currentChatFileIdentifier_ACU;
  const targetSheetKeys = [...options.targetSheetKeys];

  return runTableWriteTransaction_ACU({
    source: 'manual_fill',
    reason: 'commitStagedSheetsAtFullBoundaryAtomic',
    isolationKey,
    writeSet: targetSheetKeys.map(sheetKey => ({ kind: 'sheet' as const, sheetKey })),
    maintenanceMode: 'exclusive',
  }, async () => {
    if (String(currentChatFileIdentifier_ACU || '') !== String(chatKey || '')
      || String(getCurrentIsolationKey_ACU() || '') !== String(isolationKey || '')) {
      return failBoundary_ACU('staging_scope_changed', 'boundary commit 复检失败：chatKey 或 isolationKey 已切换。');
    }

    const chat = getChatArray_ACU();
    const fullIndices: number[] = [];
    for (let index = 0; index < chat.length; index += 1) {
      const message = chat[index];
      const container = readIsolatedDataContainer_ACU(message);
      if (!container) continue;
      const tagData = container[isolationKey];
      if (!isV2TagData_ACU(tagData)) continue;
      const frame = (tagData as any).storageFrame as TableStorageFrameV2_ACU | undefined;
      if (frame?.checkpoint?.kind === 'full') fullIndices.push(index);
    }
    if (fullIndices.length !== 1) {
      return failBoundary_ACU(
        'multiple_full_checkpoints',
        `boundary commit 拒绝执行：同一 isolationKey 下存在 ${fullIndices.length} 个 full checkpoint（${fullIndices.join(', ')}），必须唯一。`,
      );
    }
    if (fullIndices[0] !== options.originalFullIndex) {
      return failBoundary_ACU(
        'full_checkpoint_root_mismatch',
        `boundary commit 原 full 根不匹配：expected=${options.originalFullIndex}, actual=${fullIndices[0]}；拒绝汇合。`,
      );
    }

    const originalMessage = chat[options.originalFullIndex];
    if (!originalMessage) {
      return failBoundary_ACU('full_checkpoint_root_mismatch', `原 full checkpoint 楼层 ${options.originalFullIndex} 不存在，无法汇合。`);
    }
    const originalContainer = readIsolatedDataContainer_ACU(originalMessage) || {};
    if (!isV2TagData_ACU(originalContainer[isolationKey])) {
      return failBoundary_ACU('full_checkpoint_root_mismatch', `原 full checkpoint 楼层 ${options.originalFullIndex} 缺少 V2 数据。`);
    }
    const liveFrame = (originalContainer[isolationKey] as any).storageFrame as TableStorageFrameV2_ACU;
    if (liveFrame?.checkpoint?.kind !== 'full') {
      return failBoundary_ACU('full_checkpoint_root_mismatch', `原 full checkpoint 楼层 ${options.originalFullIndex} 的 frame 缺少正式 full 根。`);
    }
    const liveFingerprint = getOriginalFullFrameFingerprint_ACU(liveFrame);
    if (options.originalFullFingerprint && options.originalFullFingerprint !== liveFingerprint) {
      return failBoundary_ACU(
        'full_checkpoint_fingerprint_mismatch',
        `boundary commit 原 full 根指纹不匹配：runId=${runId}, index=${options.originalFullIndex}。`,
      );
    }

    const overlaySheets = extractTargetOverlaySheets_ACU(options.stagedSnapshot, targetSheetKeys);
    for (const sheetKey of targetSheetKeys) {
      if (!overlaySheets[sheetKey]) {
        return failBoundary_ACU('staging_target_snapshot_missing', `boundary commit 缺少 selected sheet 的 staging 快照：${sheetKey}。`);
      }
    }

    const headIndex = Math.max(0, chat.length - 1);
    let liveBoundary: TableReplayResultV2_ACU | undefined;
    let liveHead: TableReplayResultV2_ACU | undefined;
    try {
      const liveStates = await loadTableStatesAtBoundariesFromFramesV2Detailed_ACU(
        chat,
        isolationKey,
        [options.originalFullIndex, headIndex],
        { updateRuntimeState: false, compatibilityMode: 'disabled' },
      );
      liveBoundary = liveStates.get(options.originalFullIndex);
      liveHead = liveStates.get(headIndex);
      if (!liveBoundary || liveBoundary.baseKind !== 'full_checkpoint' || !liveBoundary.data) {
        return failBoundary_ACU('boundary_replay_mismatch', `boundary commit live boundary replay 未建立正式基底：boundary=${options.originalFullIndex}。`);
      }
      if (liveBoundary.requiresCheckpointConvergence || liveBoundary.compatibilityRepairs?.length) {
        return failBoundary_ACU('candidate_replay_requires_repair', `boundary commit live boundary replay 依赖兼容修复：boundary=${options.originalFullIndex}。`);
      }
      if (!liveHead || liveHead.baseKind !== 'full_checkpoint' || !liveHead.data) {
        return failBoundary_ACU('boundary_replay_mismatch', `boundary commit live head replay 未建立正式基底：boundary=${headIndex}。`);
      }
      if (liveHead.requiresCheckpointConvergence || liveHead.compatibilityRepairs?.length) {
        return failBoundary_ACU('candidate_replay_requires_repair', `boundary commit live head replay 依赖兼容修复：boundary=${headIndex}。`);
      }
    } catch (error: any) {
      return failBoundary_ACU('boundary_replay_mismatch', `boundary commit live replay 验证异常：${error?.message || String(error)}`);
    }

    const originalTagData = JSON.parse(JSON.stringify(originalContainer[isolationKey]));
    const frame = originalTagData.storageFrame as TableStorageFrameV2_ACU;
    const maxSeq = Math.max(0, ...(frame.logEntries || []).map(entry => Number((entry as any).seq) || 0));
    const now = Date.now();
    const perSheetCheckpoints = { ...(frame.perSheetCheckpoints || {}) };
    for (const sheetKey of targetSheetKeys) {
      const sheetCheckpointResult = buildCanonicalSheetCheckpoint_ACU({
        createdAt: now,
        reason: 'manual',
        sheetKey,
        data: overlaySheets[sheetKey],
        event: { filledSheetKeys: [sheetKey], changedSheetKeys: [sheetKey], groupKeys: [] },
        context: { messageIndex: options.originalFullIndex, isolationKey, reason: 'manual' },
      });
      if (!sheetCheckpointResult.checkpoint) {
        return failBoundary_ACU('staging_target_snapshot_missing', `boundary commit 无法构建 selected sheet rebase：${sheetKey}：${sheetCheckpointResult.error}`);
      }
      perSheetCheckpoints[sheetKey] = {
        ...sheetCheckpointResult.checkpoint,
        timeline: {
          kind: 'sheet_rebase',
          activateAtMessageIndex: options.originalFullIndex,
          afterSeq: maxSeq,
        },
      };
    }
    frame.perSheetCheckpoints = perSheetCheckpoints;

    const liveChatClone = JSON.parse(JSON.stringify(chat)) as any[];
    const candidateChat = JSON.parse(JSON.stringify(chat)) as any[];
    const candidateOriginalMessage = candidateChat[options.originalFullIndex];
    if (!candidateOriginalMessage) {
      return failBoundary_ACU('full_checkpoint_root_mismatch', `候选聊天缺少原 full 楼层 ${options.originalFullIndex}，无法汇合。`);
    }
    const candidateContainer = readIsolatedDataContainer_ACU(candidateOriginalMessage) || {};
    candidateContainer[isolationKey] = originalTagData;
    candidateOriginalMessage.TavernDB_ACU_IsolatedData = candidateContainer;

    const writeSurfaceError = assertCandidateWriteSurface_ACU(
      liveChatClone,
      candidateChat,
      isolationKey,
      options.originalFullIndex,
      targetSheetKeys,
    );
    if (writeSurfaceError) {
      return failBoundary_ACU('candidate_write_surface_violation', `boundary commit 写入面越权：${writeSurfaceError}。`);
    }

    let candidateHeadData: Record<string, any> | null = null;
    try {
      const candidateStates = await loadTableStatesAtBoundariesFromFramesV2Detailed_ACU(
        candidateChat,
        isolationKey,
        [options.originalFullIndex, headIndex],
        { updateRuntimeState: false, compatibilityMode: 'disabled' },
      );
      const candidateBoundary = candidateStates.get(options.originalFullIndex);
      const candidateHead = candidateStates.get(headIndex);
      if (!candidateBoundary || candidateBoundary.baseKind !== 'full_checkpoint' || !candidateBoundary.data) {
        return failBoundary_ACU('boundary_replay_mismatch', `boundary commit 候选 boundary replay 未建立正式基底：boundary=${options.originalFullIndex}。`);
      }
      if (candidateBoundary.requiresCheckpointConvergence || candidateBoundary.compatibilityRepairs?.length) {
        return failBoundary_ACU('candidate_replay_requires_repair', `boundary commit 候选 boundary replay 依赖兼容修复：boundary=${options.originalFullIndex}。`);
      }
      if (!candidateHead || candidateHead.baseKind !== 'full_checkpoint' || !candidateHead.data) {
        return failBoundary_ACU('boundary_replay_mismatch', `boundary commit 候选 head replay 未建立正式基底：boundary=${headIndex}。`);
      }
      if (candidateHead.requiresCheckpointConvergence || candidateHead.compatibilityRepairs?.length) {
        return failBoundary_ACU('candidate_replay_requires_repair', `boundary commit 候选 head replay 依赖兼容修复：boundary=${headIndex}。`);
      }
      candidateHeadData = candidateHead.data as Record<string, any>;

      const sheetKeys = new Set<string>([
        ...Object.keys(liveBoundary.data || {}),
        ...Object.keys(liveHead.data || {}),
        ...Object.keys(candidateBoundary.data || {}),
        ...Object.keys(candidateHead.data || {}),
        ...targetSheetKeys,
      ].filter(key => key.startsWith('sheet_')));

      for (const sheetKey of sheetKeys) {
        const isTarget = targetSheetKeys.includes(sheetKey);
        if (isTarget) {
          if (canonicalSheetFingerprint_ACU(candidateBoundary.data?.[sheetKey]) !== canonicalSheetFingerprint_ACU(overlaySheets[sheetKey])) {
            logWarn_ACU(`[TableFillBoundaryStaging] selected_sheet_boundary_mismatch: runId=${runId}, cutoff=${options.originalFullIndex}, sheetKey=${sheetKey}, overlay=${canonicalSheetFingerprint_ACU(overlaySheets[sheetKey])}, candidate=${canonicalSheetFingerprint_ACU(candidateBoundary.data?.[sheetKey])}`);
            return failBoundary_ACU('selected_sheet_boundary_mismatch', `boundary commit 后 selected sheet 边界回放不一致：${sheetKey}。`);
          }
          if (!candidateHead.data?.[sheetKey] || typeof candidateHead.data[sheetKey] !== 'object') {
            return failBoundary_ACU('selected_sheet_boundary_mismatch', `boundary commit 候选 head 缺少目标表：${sheetKey}。`);
          }
          continue;
        }
        if (canonicalSheetFingerprint_ACU(candidateBoundary.data?.[sheetKey]) !== canonicalSheetFingerprint_ACU(liveBoundary.data?.[sheetKey])) {
          logWarn_ACU(`[TableFillBoundaryStaging] non_target_boundary_mismatch: runId=${runId}, cutoff=${options.originalFullIndex}, sheetKey=${sheetKey}`);
          return failBoundary_ACU('non_target_boundary_mismatch', `boundary commit 后非目标表边界回放不一致：${sheetKey}。`);
        }
        if (canonicalSheetFingerprint_ACU(candidateHead.data?.[sheetKey]) !== canonicalSheetFingerprint_ACU(liveHead.data?.[sheetKey])) {
          logWarn_ACU(`[TableFillBoundaryStaging] non_target_head_mismatch: runId=${runId}, cutoff=${headIndex}, sheetKey=${sheetKey}`);
          return failBoundary_ACU('non_target_head_mismatch', `boundary commit 后非目标表 head 回放不一致：${sheetKey}。`);
        }
      }
    } catch (error: any) {
      return failBoundary_ACU('boundary_replay_mismatch', `boundary commit 候选 replay 验证异常：${error?.message || String(error)}`);
    }

    const before = JSON.parse(JSON.stringify(chat));
    try {
      chat.length = 0;
      chat.push(...candidateChat);
      writeMessageIdentity_ACU(candidateOriginalMessage, {
        enabled: settings_ACU.dataIsolationEnabled,
        code: settings_ACU.dataIsolationCode,
      });
      await saveChatToHostStrict_ACU();
    } catch (error: any) {
      chat.length = 0;
      chat.push(...before);
      return failBoundary_ACU('boundary_strict_save_failed', `boundary commit 严格保存失败：${error?.message || String(error)}`);
    }
    logDebug_ACU(`[TableFillBoundaryStaging] 已原子汇合：runId=${runId}, originalFull=${options.originalFullIndex}, sheets=${targetSheetKeys.join('、')}。`);
    return {
      ok: true,
      boundaryCommitSummary: {
        selectedSheetKeys: [...targetSheetKeys],
        originalFullCheckpointIndex: options.originalFullIndex,
      },
      verifiedHeadSnapshot: candidateHeadData ? JSON.parse(JSON.stringify(candidateHeadData)) : {},
    };
  });
}

export async function publishVerifiedBoundaryHead_ACU(input: {
  verifiedHeadSnapshot: Record<string, any>;
  chatKey: string;
  isolationKey: string;
}): Promise<{ ok: true } | { ok: false; error: string; diagnosticCode: 'runtime_publish_failed' }> {
  try {
    if (String(currentChatFileIdentifier_ACU || '') !== String(input.chatKey || '')
      || String(getCurrentIsolationKey_ACU() || '') !== String(input.isolationKey || '')) {
      return {
        ok: false,
        error: 'boundary runtime 发布复检失败：chatKey 或 isolationKey 已切换。',
        diagnosticCode: 'runtime_publish_failed',
      };
    }
    const snapshot = JSON.parse(JSON.stringify(input.verifiedHeadSnapshot || {})) as TableDataObject_ACU;
    if (isSqliteMode()) {
      const envelope = createCanonicalSnapshotEnvelope_ACU({
        data: snapshot,
        chatIdentity: String(input.chatKey || ''),
        isolationKey: String(input.isolationKey || ''),
        storageMode: 'sqlite',
        lifecycleEpoch: getRuntimeLifecycleEpoch_ACU(),
        source: 'boundary_commit_head',
      });
      if (!envelope) {
        return { ok: false, error: 'boundary runtime 发布失败：无法构造 verified head envelope。', diagnosticCode: 'runtime_publish_failed' };
      }
      const hydrated = await hydrateStorageProviderFromSnapshot_ACU(envelope);
      if (!hydrated.ok) {
        return {
          ok: false,
          error: `boundary runtime 发布失败：${hydrated.error || hydrated.failureCode || 'hydrate 未成功'}。持久化聊天仍是权威，请重新 hydrate。`,
          diagnosticCode: 'runtime_publish_failed',
        };
      }
    }
    _set_currentJsonTableData_ACU(snapshot);
    return { ok: true };
  } catch (error: any) {
    return {
      ok: false,
      error: `boundary runtime 发布异常：${error?.message || String(error)}。持久化聊天仍是权威，请重新 hydrate。`,
      diagnosticCode: 'runtime_publish_failed',
    };
  }
}
