import { getChatArray_ACU, saveChatToHostStrict_ACU } from '../../data/gateways/chat-gateway';
import { cloneIsolatedData_ACU, readIsolatedTagData_ACU } from '../../data/repositories/chat-message-data-repo';
import type { TableDataObject_ACU } from '../../shared/models/table-data';
import { currentChatFileIdentifier_ACU, getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import { buildCanonicalFullCheckpoint_ACU } from './canonical-checkpoint-builder';
import { auditTableDataForUpgrade_ACU, getTableDataFingerprint_ACU } from './table-data-upgrade-audit';
import { repairTableDataFromAudit_ACU, type UpgradeIdRemap_ACU } from './table-data-repair';
import { validateCanonicalCheckpoint_ACU } from '../../shared/canonical-checkpoint-validator';
import { detectPhysicalTableNameCollisions_ACU, type PhysicalTableNameCollision_ACU } from '../../shared/sheet-identity';
import { getCurrentStorageMode } from './storage-mode';
import { isV2TagData_ACU } from './storage-strategy-resolver';
import { didSqliteFallbackAfterReload_ACU, reloadStorageProvider } from './table-storage-strategy';
import { loadTableStateFromFramesV2Detailed_ACU, type TableReplayCompatibilityRepairV2_ACU } from './storage-frame-v2-replay';
import type { TableMutationOperationV2_ACU, TablePatchV2_ACU, TableStorageFrameV2_ACU, TableV2RecoveryBackup_ACU } from './storage-frame-v2-types';
import { runTableWriteTransaction_ACU } from './table-write-transaction';

type RecoveryKind_ACU = 'repaired_full_checkpoint' | 'confirmed_orphan_data_replace' | 'temporary_sheet_anchor_convergence' | 'redundant_full_checkpoint_convergence' | 'restored_from_recovery_backup';
export type V2RecoveryStatus_ACU = 'recoverable_repaired_checkpoint' | 'recoverable_orphan_data_replace' | 'recoverable_temporary_sheet_anchor' | 'recoverable_redundant_full_checkpoint' | 'recoverable_from_recovery_backup' | 'unrecoverable_late_checkpoint_artifacts' | 'unrecoverable_no_base' | 'unrecoverable_identity_conflict' | 'unrecoverable';
export type V2RecoveryCommitStatus_ACU = 'committed' | 'committed_postcondition_failed' | 'commit_failed_rolled_back';

export interface V2RecoveryCommitResult_ACU {
  status: V2RecoveryCommitStatus_ACU;
  planId: string;
  error?: string;
}

export interface CommitPreparedV2RecoveryOptions_ACU {
  confirmOrphanDataReplace?: boolean;
}

export interface V2RecoverySummary_ACU {
  planId?: string;
  status: V2RecoveryStatus_ACU;
  isolationKey: string;
  sourceMessageIndex?: number;
  affectedSheetKeys?: string[];
  compatibilityRepairs?: TableReplayCompatibilityRepairV2_ACU[];
  requiresConfirmation: boolean;
  message: string;
}
export interface V2IsolationDiagnostic_ACU extends V2RecoverySummary_ACU {
  isCurrentIsolation: boolean;
}
interface V2RecoveryDiagnosis_ACU {
  summary: V2RecoverySummary_ACU;
  plan?: Omit<RecoveryPlan_ACU, 'planId'>;
}
interface RecoveryPlan_ACU extends V2RecoverySummary_ACU {
  kind: RecoveryKind_ACU;
  chat: any[];
  chatKey: string;
  sourceFrameFingerprint: string;
  redundantFullIndices?: number[];
  redundantFrameFingerprints?: Array<{ messageIndex: number; fingerprint: string }>;
  candidateData: TableDataObject_ACU;
}
const plans_ACU = new Map<string, RecoveryPlan_ACU>();
function clone_ACU<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function buildPlanId_ACU(): string { return `v2_recovery_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`; }
function getErrorMessage_ACU(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '未知错误');
}
function getFrameFingerprint_ACU(frame: TableStorageFrameV2_ACU): string {
  return JSON.stringify(frame);
}
function countAiFloorInChat_ACU(chat: any[], messageIndex: number): number {
  let count = 0;
  for (let i = 0; i <= messageIndex && i < chat.length; i += 1) {
    if (chat[i] && !chat[i].is_user) count += 1;
  }
  return count;
}
function currentScopeMatches_ACU(plan: RecoveryPlan_ACU): boolean {
  return getChatArray_ACU() === plan.chat
    && String(currentChatFileIdentifier_ACU || '').trim() === plan.chatKey
    && getCurrentIsolationKey_ACU() === plan.isolationKey;
}
function getFrames_ACU(chat: any[], isolationKey: string): Array<{ messageIndex: number; frame: TableStorageFrameV2_ACU }> {
  const frames: Array<{ messageIndex: number; frame: TableStorageFrameV2_ACU }> = [];
  for (let messageIndex = 0; messageIndex < chat.length; messageIndex += 1) {
    const message = chat[messageIndex];
    if (!message || message.is_user) continue;
    const tagData = readIsolatedTagData_ACU(message, isolationKey);
    if (isV2TagData_ACU(tagData)) frames.push({ messageIndex, frame: tagData.storageFrame });
  }
  return frames;
}
function hasReplayArtifactsAfterCheckpoint_ACU(frame: TableStorageFrameV2_ACU): boolean {
  return (frame.logEntries?.length || 0) > 0
    || Object.keys(frame.perSheetCheckpoints || {}).length > 0
    || !!frame.manualRefillProgress;
}
function hasAnyReplayArtifacts_ACU(frame: TableStorageFrameV2_ACU): boolean {
  return !!frame.checkpoint || hasReplayArtifactsAfterCheckpoint_ACU(frame);
}
function hasV2ReplayArtifact_ACU(frame: TableStorageFrameV2_ACU): boolean {
  return (frame.logEntries?.length || 0) > 0
    || Object.keys(frame.perSheetCheckpoints || {}).length > 0
    || frame.manualRefillProgress !== undefined
    || (frame.headRevision !== undefined && frame.headRevision !== null);
}
function findLateCheckpointWithSuffixArtifacts_ACU(
  frames: Array<{ messageIndex: number; frame: TableStorageFrameV2_ACU }>,
): { checkpointMessageIndex: number; suffixMessageIndex: number } | null {
  const fullCheckpoints = frames.filter(item => item.frame.checkpoint?.kind === 'full');
  if (fullCheckpoints.length !== 1) return null;
  const checkpoint = fullCheckpoints[0];
  const checkpointData = checkpoint.frame.checkpoint;
  if (!checkpointData
    || !['init', 'migration'].includes(checkpointData.reason)
    || !validateCanonicalCheckpoint_ACU(checkpointData).valid
    || hasV2ReplayArtifact_ACU(checkpoint.frame)) return null;

  // 此类诊断只覆盖“较晚 reset 锚点截断了已有历史”的布局。普通 init 后的
  // 正常增量没有前置 artifact，不能误报为需要人工恢复。
  if (!frames.some(item => item.messageIndex < checkpoint.messageIndex && hasV2ReplayArtifact_ACU(item.frame))) return null;
  const suffix = frames.find(item => item.messageIndex > checkpoint.messageIndex && hasV2ReplayArtifact_ACU(item.frame));
  return suffix ? { checkpointMessageIndex: checkpoint.messageIndex, suffixMessageIndex: suffix.messageIndex } : null;
}
function isIsolatedDataReplaceFrame_ACU(frame: TableStorageFrameV2_ACU): boolean {
  if (Object.keys(frame.perSheetCheckpoints || {}).length > 0 || frame.manualRefillProgress) return false;
  if ((frame.logEntries?.length || 0) !== 1) return false;
  const entry = frame.logEntries[0];
  return !entry?.patches?.length
    && Array.isArray(entry.operations)
    && entry.operations.length === 1
    && entry.operations[0]?.kind === 'data_replace';
}
function hasLaterReplayArtifacts_ACU(
  frames: Array<{ messageIndex: number; frame: TableStorageFrameV2_ACU }>,
  sourceMessageIndex: number,
): boolean {
  return frames.some(item => item.messageIndex > sourceMessageIndex && hasAnyReplayArtifacts_ACU(item.frame));
}

function canonicalRowId_ACU(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const rowId = String(value).trim();
  return rowId || null;
}
function buildRemappedRowIdKeys_ACU(idRemap: UpgradeIdRemap_ACU[]): Set<string> {
  const keys = new Set<string>();
  for (const remap of idRemap) {
    const rowId = canonicalRowId_ACU(remap.previousRowId);
    if (rowId) keys.add(`${remap.sheetKey}\u0000${rowId}`);
  }
  return keys;
}
function operationReferencesRemappedRowId_ACU(
  operation: TableMutationOperationV2_ACU | TablePatchV2_ACU,
  remappedRowIdKeys: Set<string>,
): string | null {
  if (operation.kind === 'row_upsert' || operation.kind === 'row_delete') {
    const rowId = canonicalRowId_ACU(operation.rowId);
    return rowId && remappedRowIdKeys.has(`${operation.sheetKey}\u0000${rowId}`) ? rowId : null;
  }
  const referencesBoundRemappedRowId = (statements: string[], params: unknown[][] | undefined, sheetKey?: string): string | null => {
    for (let index = 0; index < statements.length; index += 1) {
      if (!/\brow_id\b/i.test(statements[index] || '')) continue;
      for (const value of params?.[index] || []) {
        const rowId = canonicalRowId_ACU(value);
        if (!rowId) continue;
        if (sheetKey) {
          if (remappedRowIdKeys.has(`${sheetKey}\u0000${rowId}`)) return rowId;
        } else if ([...remappedRowIdKeys].some(key => key.endsWith(`\u0000${rowId}`))) {
          return rowId;
        }
      }
    }
    return null;
  };
  if (operation.kind === 'sql_sheet_batch') {
    return referencesBoundRemappedRowId(operation.statements, operation.params, operation.sheetKey);
  }
  if (operation.kind === 'sql_batch') {
    return referencesBoundRemappedRowId(operation.statements, operation.params);
  }
  return null;
}
function findAmbiguousRowIdReference_ACU(
  frames: Array<{ messageIndex: number; frame: TableStorageFrameV2_ACU }>,
  sourceMessageIndex: number,
  idRemap: UpgradeIdRemap_ACU[],
): string | null {
  const remappedRowIdKeys = buildRemappedRowIdKeys_ACU(idRemap);
  if (remappedRowIdKeys.size === 0) return null;
  for (const item of frames) {
    if (item.messageIndex < sourceMessageIndex) continue;
    for (const entry of item.frame.logEntries || []) {
      for (const operation of [...(entry.operations || []), ...(entry.patches || [])]) {
        const rowId = operationReferencesRemappedRowId_ACU(operation, remappedRowIdKeys);
        if (rowId) return `messageIndex=${item.messageIndex}、seq=${entry.seq} 的 ${operation.kind} 引用了重映射前的 row_id=${rowId}`;
      }
    }
  }
  return null;
}

function hasSamePlanScope_ACU(left: RecoveryPlan_ACU, right: RecoveryPlan_ACU): boolean {
  return left.chat === right.chat
    && left.chatKey === right.chatKey
    && left.isolationKey === right.isolationKey;
}

function createPlan_ACU(plan: Omit<RecoveryPlan_ACU, 'planId'>): V2RecoverySummary_ACU {
  for (const [existingPlanId, existingPlan] of plans_ACU) {
    if (hasSamePlanScope_ACU(existingPlan, plan as RecoveryPlan_ACU)) plans_ACU.delete(existingPlanId);
  }
  const planId = buildPlanId_ACU();
  plans_ACU.set(planId, { ...plan, planId });
  return {
    planId,
    status: plan.status,
    isolationKey: plan.isolationKey,
    sourceMessageIndex: plan.sourceMessageIndex,
    ...(plan.affectedSheetKeys?.length ? { affectedSheetKeys: clone_ACU(plan.affectedSheetKeys) } : {}),
    ...(plan.compatibilityRepairs?.length ? { compatibilityRepairs: clone_ACU(plan.compatibilityRepairs) } : {}),
    requiresConfirmation: plan.requiresConfirmation,
    message: plan.message,
  };
}
function getPlanSourceFrame_ACU(plan: RecoveryPlan_ACU): TableStorageFrameV2_ACU | null {
  if (!Number.isInteger(plan.sourceMessageIndex)) return null;
  const message = plan.chat[plan.sourceMessageIndex as number];
  const tagData = readIsolatedTagData_ACU(message, plan.isolationKey);
  return isV2TagData_ACU(tagData) ? tagData.storageFrame : null;
}
function planAffectedFramesUnchanged_ACU(plan: RecoveryPlan_ACU): string | null {
  // 单根收敛会改写多个 full 帧：任一受影响帧在计划创建后变化，计划即失效。
  // 校验全部冗余 full 帧 + 根帧指纹，缺一即拒绝（P4-5）。
  for (const item of plan.redundantFrameFingerprints || []) {
    const message = plan.chat[item.messageIndex as number];
    const tagData = readIsolatedTagData_ACU(message, plan.isolationKey);
    const frame = isV2TagData_ACU(tagData) ? tagData.storageFrame : null;
    if (!frame || getFrameFingerprint_ACU(frame) !== item.fingerprint) {
      return `受影响帧已变化：messageIndex=${item.messageIndex}。`;
    }
  }
  const sourceFrame = getPlanSourceFrame_ACU(plan);
  if (!sourceFrame || getFrameFingerprint_ACU(sourceFrame) !== plan.sourceFrameFingerprint) {
    return '恢复源 frame 已变化，请重新诊断。';
  }
  return null;
}
function buildRecoveredCandidateChat_ACU(plan: RecoveryPlan_ACU): any[] {
  const sourceMessageIndex = plan.sourceMessageIndex;
  if (!Number.isInteger(sourceMessageIndex)) throw new Error('恢复计划缺少 sourceMessageIndex。');
  const candidateChat = clone_ACU(plan.chat);
  if (plan.kind === 'redundant_full_checkpoint_convergence') {
    // 多消息降级：保留末位 full（回放根）不动，其余 full 帧无损降级为
    // data_replace fallback entry，原帧整体入 recoveryBackup。
    // 根帧 data 已含全部累计状态（convergence full 由该根之上的 replay 构造），
    // 降级多余 full 后回放输出必须与降级前完全一致（P4-6 强校验）。
    const redundantIndices = plan.redundantFullIndices || [];
    if (redundantIndices.length === 0) throw new Error('单 full 收敛计划缺少冗余 full 帧索引。');
    for (const messageIndex of redundantIndices) {
      const message = candidateChat[messageIndex as number];
      if (!message) throw new Error(`降级目标消息缺失：messageIndex=${messageIndex}。`);
      const tagData = readIsolatedTagData_ACU(message, plan.isolationKey);
      if (!isV2TagData_ACU(tagData)) throw new Error(`降级目标消息不再包含 V2 storage frame：messageIndex=${messageIndex}。`);
      const originalFrame = clone_ACU(tagData.storageFrame);
      const originalCheckpoint = originalFrame.checkpoint;
      const originalEntries = originalFrame.logEntries || [];
      // data_replace 是完整替换语义，必须排在原日志之后且 seq 大于所有原日志，
      // 否则会被回放当成“替换基底之前的普通日志”而重新应用，破坏替换语义。
      const fallbackSeq = originalEntries.reduce((max, entry) => Math.max(max, entry.seq || 0), 0) + 1;
      const fallbackEntry = {
        seq: fallbackSeq,
        entryId: `redundant-full-fallback-${messageIndex}`,
        createdAt: originalCheckpoint?.createdAt ?? Date.now(),
        source: 'system' as const,
        targetMessageIndex: messageIndex,
        aiFloor: countAiFloorInChat_ACU(plan.chat, messageIndex),
        filledSheetKeys: originalCheckpoint?.event?.filledSheetKeys ?? [],
        changedSheetKeys: originalCheckpoint?.event?.changedSheetKeys ?? [],
        groupKeys: originalCheckpoint?.event?.groupKeys ?? [],
        operations: [{ kind: 'data_replace' as const, data: clone_ACU(originalCheckpoint?.data || {}) as TableDataObject_ACU, reason: 'checkpoint_fallback' as const }],
      };
      const downgradedFrame: TableStorageFrameV2_ACU = {
        version: 2,
        headRevision: 'redundant-full-downgraded',
        logEntries: [...originalEntries, fallbackEntry],
        ...(originalFrame.perSheetCheckpoints ? { perSheetCheckpoints: clone_ACU(originalFrame.perSheetCheckpoints) } : {}),
        ...(originalFrame.manualRefillProgress ? { manualRefillProgress: clone_ACU(originalFrame.manualRefillProgress) } : {}),
      };
      const isolatedData = cloneIsolatedData_ACU(message);
      const recoveryBackup: TableV2RecoveryBackup_ACU = {
        version: 1,
        createdAt: Date.now(),
        recoveryKind: plan.kind,
        sourceMessageIndex,
        failedMessageIndex: messageIndex,
        storageFrame: originalFrame,
      };
      isolatedData[plan.isolationKey] = {
        ...isolatedData[plan.isolationKey],
        _acu_storage_version: 2 as const,
        storageFrame: downgradedFrame,
        recoveryBackup,
      };
      message.TavernDB_ACU_IsolatedData = isolatedData;
    }
    return candidateChat;
  }

  const sourceMessage = candidateChat[sourceMessageIndex as number];
  const sourceTagData = readIsolatedTagData_ACU(sourceMessage, plan.isolationKey);
  if (!isV2TagData_ACU(sourceTagData)) throw new Error('恢复源消息不再包含 V2 storage frame。');

  const checkpointBuild = buildCanonicalFullCheckpoint_ACU({
    createdAt: Date.now(),
    reason: 'integrity_repair',
    data: plan.candidateData,
  });
  if (!checkpointBuild.checkpoint) throw new Error(checkpointBuild.error);

  const recoveryBackup: TableV2RecoveryBackup_ACU = {
    version: 1,
    createdAt: Date.now(),
    recoveryKind: plan.kind,
    sourceMessageIndex,
    failedMessageIndex: sourceMessageIndex,
    storageFrame: clone_ACU(sourceTagData.storageFrame),
  };
  const isolatedData = cloneIsolatedData_ACU(sourceMessage);
  // 修复的是已验证的 checkpoint 基底，不是把其后 artifact 一并抹掉。
  // 只有已被诊断为完整可替换的孤立 frame/临时补锚才收敛为纯 checkpoint。
  const recoveredFrame: TableStorageFrameV2_ACU = plan.kind === 'repaired_full_checkpoint'
    ? { ...clone_ACU(sourceTagData.storageFrame), checkpoint: checkpointBuild.checkpoint }
    : { version: 2, checkpoint: checkpointBuild.checkpoint, logEntries: [] };
  const nextTagData = {
    ...isolatedData[plan.isolationKey],
    _acu_storage_version: 2 as const,
    storageFrame: recoveredFrame,
    recoveryBackup,
  };
  isolatedData[plan.isolationKey] = nextTagData;
  sourceMessage.TavernDB_ACU_IsolatedData = isolatedData;
  return candidateChat;
}
async function validateRecoveredCandidateReplay_ACU(plan: RecoveryPlan_ACU, candidateChat: any[]): Promise<void> {
  const replay = await loadTableStateFromFramesV2Detailed_ACU(candidateChat, plan.isolationKey, {
    updateRuntimeState: false,
    compatibilityMode: 'disabled',
  });
  if (!replay) throw new Error('恢复候选未产生可回放表数据。');
  if (replay.requiresCheckpointConvergence || replay.compatibilityRepairs?.length) throw new Error('恢复候选仍依赖临时 Sheet 补锚。');
  // 单 full 收敛：收敛前（原始 chat）必须可完整回放，且收敛前后 replay 指纹必须完全一致，否则拒绝提交。
  // 在 validate 内重算基线而非依赖诊断期存档，可覆盖 diagnose 与 commit 之间任何帧的外部改动。
  if (plan.kind === 'redundant_full_checkpoint_convergence') {
    const baselineReplay = await loadTableStateFromFramesV2Detailed_ACU(plan.chat, plan.isolationKey, {
      updateRuntimeState: false,
      compatibilityMode: 'disabled',
    });
    if (!baselineReplay) throw new Error('收敛前原始历史不可回放，拒绝执行单 full 收敛。');
    if (baselineReplay.requiresCheckpointConvergence || baselineReplay.compatibilityRepairs?.length) {
      throw new Error('收敛前原始历史仍依赖临时 Sheet 补锚，拒绝执行单 full 收敛。');
    }
    if (getTableDataFingerprint_ACU(baselineReplay.data) !== getTableDataFingerprint_ACU(replay.data)) {
      throw new Error('单 full 收敛前后 replay 结果不一致，拒绝提交。');
    }
  }
  // 基底修复后的 suffix 必须被严格回放；其结果不应再与修复时的基底本身相等。
  if (plan.kind !== 'repaired_full_checkpoint'
    && getTableDataFingerprint_ACU(replay.data) !== getTableDataFingerprint_ACU(plan.candidateData)) {
    throw new Error('恢复候选 replay 结果与修复数据不一致。');
  }
}
function repairCandidate_ACU(data: unknown): { candidateData: TableDataObject_ACU | null; idRemap: UpgradeIdRemap_ACU[]; status: 'clean' | 'repairable' | 'requires_confirmation' | 'unrecoverable' } {
  const audit = auditTableDataForUpgrade_ACU(data);
  if (audit.status !== 'repairable') return { candidateData: null, idRemap: [], status: audit.status };
  const repair = repairTableDataFromAudit_ACU(audit);
  return {
    candidateData: repair.requiresConfirmation ? null : repair.candidateData as TableDataObject_ACU,
    idRemap: repair.idRemap,
    status: audit.status,
  };
}
function findOrphanDataReplace_ACU(frame: TableStorageFrameV2_ACU): TableDataObject_ACU | null {
  let candidate: TableDataObject_ACU | null = null;
  for (const entry of frame.logEntries || []) for (const operation of entry?.operations || []) {
    if (operation?.kind === 'data_replace') candidate = operation.data;
  }
  return candidate;
}
type IdentityConflictCategory_ACU = 'empty_shell' | 'duplicate_structure' | 'heterogeneous_with_data' | 'ambiguous_conflict';

function identityConflictRows_ACU(sheet: unknown): unknown[][] {
  if (!sheet || typeof sheet !== 'object' || !Array.isArray((sheet as any).content)) return [];
  return ((sheet as any).content as unknown[][]).slice(1);
}

function identityConflictHeader_ACU(sheet: unknown): string[] {
  if (!sheet || typeof sheet !== 'object' || !Array.isArray((sheet as any).content) || !Array.isArray((sheet as any).content[0])) return [];
  return ((sheet as any).content[0] as unknown[]).map(String);
}

function describeIdentityConflict_ACU(
  collision: PhysicalTableNameCollision_ACU,
  data: unknown,
): { category: IdentityConflictCategory_ACU; detail: string } {
  const dataRecord = (data || {}) as Record<string, unknown>;
  const rowsList = collision.sheetKeys.map(key => identityConflictRows_ACU(dataRecord[key]));
  const headers = collision.sheetKeys.map(key => identityConflictHeader_ACU(dataRecord[key]));
  const nonEmptyRows = rowsList.map(rows => rows.filter(row => row && row.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== '')));
  const allEmpty = nonEmptyRows.every(rows => rows.length === 0);
  const sameHeader = headers.length > 1 && headers.every(header => JSON.stringify(header) === JSON.stringify(headers[0]));
  const sameStructure = sameHeader && rowsList.every(rows => JSON.stringify(rows) === JSON.stringify(rowsList[0]));
  const rowCounts = rowsList.map(rows => rows.length).join(' vs ');

  if (allEmpty) return { category: 'empty_shell', detail: '双方均无数据行（仅表头或空壳）。' };
  if (sameStructure) return { category: 'duplicate_structure', detail: '列结构相同且数据完全一致，是重复 key 而非新数据。' };
  if (sameHeader) {
    const rowIdSets = rowsList.map(rows => new Set(rows.map(row => String((row as unknown[])?.[0] ?? '').trim()).filter(Boolean)));
    const hasSharedRowId = rowIdSets.length === 2 && [...rowIdSets[0]].some(rowId => rowIdSets[1].has(rowId));
    if (hasSharedRowId) {
      return { category: 'ambiguous_conflict', detail: `列结构相同但存在同 row_id 冲突（行数 ${rowCounts}），不能仅凭 row_id 选赢家。` };
    }
    return { category: 'heterogeneous_with_data', detail: `列结构相同但数据行不同（行数 ${rowCounts}），可按 row_id 补并但需要确认旧 key 是否同属一张表。` };
  }
  return {
    category: 'heterogeneous_with_data',
    detail: `列结构不同（${headers.map((header, index) => `${collision.sheetKeys[index]}:[${header.join('、')}]`).join(' vs ')}}）且存在数据。`,
  };
}

function buildIdentityConflictSummary_ACU(
  isolationKey: string,
  sourceMessageIndex: number,
  conflicts: PhysicalTableNameCollision_ACU[],
  data: unknown,
): V2RecoverySummary_ACU {
  const detail = conflicts
    .map(collision => {
      const described = describeIdentityConflict_ACU(collision, data);
      return `物理表名「${collision.physicalTableName}」← ${collision.sheetNames.map((name, index) => `「${name}」(${collision.sheetKeys[index]})`).join(' / ')}；原因=${collision.reason}；分类=${described.category}；${described.detail}`;
    })
    .join('；');
  return {
    status: 'unrecoverable_identity_conflict',
    isolationKey,
    sourceMessageIndex,
    affectedSheetKeys: [...new Set(conflicts.flatMap(collision => collision.sheetKeys))],
    requiresConfirmation: false,
    message: `检测到 ${conflicts.length} 组物理表名冲突（双身份）：${detail}同一规范表名被保留为多个 sheetKey 时需先完成身份归并（identity_merge_failed）；不同表拼音同名需用户重命名。已拒绝自动恢复。`,
  };
}
async function diagnoseV2Recovery_ACU(chat: any[], isolationKey: string): Promise<V2RecoveryDiagnosis_ACU> {
  const frames = getFrames_ACU(chat, isolationKey);
  if (frames.length === 0) return { summary: { status: 'unrecoverable_no_base', isolationKey, requiresConfirmation: false, message: '当前隔离标识不存在 V2 storage frame。' } };
  const latestFull = [...frames].reverse().find(item => item.frame.checkpoint?.kind === 'full');
  if (latestFull?.frame.checkpoint) {
    // 单根不变量：同一隔离键下同一时刻只能存在一个 full checkpoint。
    // 双 full（如 convergence 旧缺陷在 (0,10) 落盘）会让 findLateCheckpointWithSuffixArtifacts_ACU
    // 因 fullCheckpoints.length !== 1 返回 null，导致下方走到「无需恢复」死锁。
    // 必须在其它判定之前识别并给出可恢复路径：保留末位 full（回放根），其余无损降级。
    const fullCheckpoints = frames.filter(item => item.frame.checkpoint?.kind === 'full');
    if (fullCheckpoints.length >=2) {
      const rootIndex = fullCheckpoints[fullCheckpoints.length - 1].messageIndex;
      const redundantIndices = fullCheckpoints.slice(0, -1).map(item => item.messageIndex);
      // 末位 full 是回放根；其 data 已含之前全部累计状态（convergence full 由该根之上的 replay 构造）。
      // 降级多余 full 在数学上不可能改变回放输出 —— 降级前后指纹必须一致，由 P4-6 强校验。
      const rootReplay = await loadTableStateFromFramesV2Detailed_ACU(chat, isolationKey, { updateRuntimeState: false });
      const rootData = rootReplay?.data || latestFull.frame.checkpoint.data;
      const rootIdentityConflicts = detectPhysicalTableNameCollisions_ACU(rootData);
      if (rootIdentityConflicts.length > 0) {
        return { summary: buildIdentityConflictSummary_ACU(isolationKey, rootIndex, rootIdentityConflicts, rootData) };
      }
      const summary: V2RecoverySummary_ACU = {
        status: 'recoverable_redundant_full_checkpoint',
        isolationKey,
        sourceMessageIndex: rootIndex,
        affectedSheetKeys: [],
        requiresConfirmation: false,
        message: `检测到 ${fullCheckpoints.length} 个 full checkpoint（#${fullCheckpoints.map(item => item.messageIndex).join('、')}）；将保留末位 #${rootIndex} 为唯一回放根，其余（#${redundantIndices.join('、')}）无损降级为 data_replace fallback 并各自原帧入 recoveryBackup。`,
      };
      return { summary, plan: {
        ...summary,
        kind: 'redundant_full_checkpoint_convergence',
        chat,
        chatKey: String(currentChatFileIdentifier_ACU || '').trim(),
        sourceFrameFingerprint: getFrameFingerprint_ACU(latestFull.frame),
        redundantFullIndices: redundantIndices,
        redundantFrameFingerprints: fullCheckpoints.slice(0, -1).map(item => ({
          messageIndex: item.messageIndex,
          fingerprint: getFrameFingerprint_ACU(item.frame),
        })),
        candidateData: rootData,
      } };
    }
    const repair = repairCandidate_ACU(latestFull.frame.checkpoint.data);
    if (repair.status === 'clean') {
      // P5：物理表名冲突（同一规范显示名保留为多个 sheetKey，或不同表拼音同名）
      // 是双身份的直接证据。JS 回放可能“成功”，因为冲突只发生在 SQLite 物理表名
      // 维度，不能在 clean 分支直接走到“无需恢复”或 integrity_repair 收敛。
      const identityConflicts = detectPhysicalTableNameCollisions_ACU(latestFull.frame.checkpoint.data);
      if (identityConflicts.length > 0) {
        return { summary: buildIdentityConflictSummary_ACU(isolationKey, latestFull.messageIndex, identityConflicts, latestFull.frame.checkpoint.data) };
      }
      let replay;
      try {
        replay = await loadTableStateFromFramesV2Detailed_ACU(chat, isolationKey, { updateRuntimeState: false });
      } catch (error) {
        return { summary: { status: 'unrecoverable', isolationKey, sourceMessageIndex: latestFull.messageIndex, requiresConfirmation: false, message: `full checkpoint 虽通过静态审计，但完整回放失败：${getErrorMessage_ACU(error)}` } };
      }
      if (replay?.requiresCheckpointConvergence && replay.compatibilityRepairs?.length) {
        const source = frames[frames.length - 1];
        const repairedSheetKeys = [...new Set(replay.compatibilityRepairs.map(item => item.sheetKey))];
        const repairPositions = replay.compatibilityRepairs.map(item => `#${item.messageIndex}/seq=${item.seq}/op=${item.operationIndex}`).join('、');
        const summary: V2RecoverySummary_ACU = {
          status: 'recoverable_temporary_sheet_anchor', isolationKey, sourceMessageIndex: source.messageIndex,
          affectedSheetKeys: repairedSheetKeys,
          compatibilityRepairs: clone_ACU(replay.compatibilityRepairs),
          requiresConfirmation: false,
          message: `检测到历史回放依赖临时 Sheet 补锚（${repairedSheetKeys.join('、')}，位置 ${repairPositions}）；可通过 integrity_repair full checkpoint 自动收敛。`,
        };
        return { summary, plan: {
          ...summary, kind: 'temporary_sheet_anchor_convergence', chat,
          chatKey: String(currentChatFileIdentifier_ACU || '').trim(),
          sourceFrameFingerprint: getFrameFingerprint_ACU(source.frame), candidateData: replay.data,
        } };
      }
      const lateCheckpoint = findLateCheckpointWithSuffixArtifacts_ACU(frames);
      if (lateCheckpoint) {
        return {
          summary: {
            status: 'unrecoverable_late_checkpoint_artifacts',
            isolationKey,
            sourceMessageIndex: lateCheckpoint.checkpointMessageIndex,
            requiresConfirmation: false,
            message: `检测到较晚的 canonical ${latestFull.frame.checkpoint.reason} checkpoint（#${lateCheckpoint.checkpointMessageIndex}）两侧均存在 V2 replay artifact；自动前移会改变后缀回放语义，已拒绝自动恢复。请先导出 recovery backup，再人工核对并执行 V2 恢复诊断。`,
          },
        };
      }
      const isTemplateFallbackRoot = latestFull.frame.checkpoint.fallbackProvenance?.kind === 'manual_refill_template_root';
      return {
        summary: {
          status: 'unrecoverable',
          isolationKey,
          sourceMessageIndex: latestFull.messageIndex,
          requiresConfirmation: false,
          message: isTemplateFallbackRoot
            ? '最新 full checkpoint 是可正常回放的手动重填模板临时根；无需完整性恢复，后续边界 compaction 会将其固化为正式 checkpoint。'
            : '最新 full checkpoint 已通过完整性审计，无需恢复。',
        },
      };
    }
    if (!repair.candidateData) return { summary: { status: 'unrecoverable', isolationKey, sourceMessageIndex: latestFull.messageIndex, requiresConfirmation: false, message: '最新 full checkpoint 不可无损自动修复；请先导出原始 frame。' } };
    const ambiguity = findAmbiguousRowIdReference_ACU(frames, latestFull.messageIndex, repair.idRemap);
    if (ambiguity) {
      const message = `重复 row_id 修复会改变后续引用的语义：${ambiguity}；拒绝猜测。`;
      return { summary: { status: 'unrecoverable', isolationKey, sourceMessageIndex: latestFull.messageIndex, requiresConfirmation: false, message } };
    }
    const suffixCount = frames.filter(item => item.messageIndex > latestFull.messageIndex && hasAnyReplayArtifacts_ACU(item.frame)).length
      + (hasReplayArtifactsAfterCheckpoint_ACU(latestFull.frame) ? 1 : 0);
    const summary: V2RecoverySummary_ACU = { status: 'recoverable_repaired_checkpoint', isolationKey, sourceMessageIndex: latestFull.messageIndex, requiresConfirmation: false, message: suffixCount > 0 ? '已生成 full 修复候选；将保留并严格回放后缀 artifact。' : '已生成 full 修复候选。' };
    return { summary, plan: { ...summary, kind: 'repaired_full_checkpoint', chat, chatKey: String(currentChatFileIdentifier_ACU || '').trim(), sourceFrameFingerprint: getFrameFingerprint_ACU(latestFull.frame), candidateData: repair.candidateData } };
  }
  for (const item of [...frames].reverse()) {
    if (!isIsolatedDataReplaceFrame_ACU(item.frame)) continue;
    if (hasLaterReplayArtifacts_ACU(frames, item.messageIndex)) return { summary: { status: 'unrecoverable', isolationKey, sourceMessageIndex: item.messageIndex, requiresConfirmation: false, message: '无锚点 data_replace 之后仍存在 V2 replay artifact；无法证明替换不会截断数据，拒绝自动恢复。' } };
    const candidateData = findOrphanDataReplace_ACU(item.frame);
    if (!candidateData) continue;
    const repair = repairCandidate_ACU(candidateData);
    if (repair.status !== 'clean' && !repair.candidateData) return { summary: { status: 'unrecoverable', isolationKey, sourceMessageIndex: item.messageIndex, requiresConfirmation: false, message: '无锚点 data_replace 不满足无损自动修复条件。' } };
    const summary: V2RecoverySummary_ACU = { status: 'recoverable_orphan_data_replace', isolationKey, sourceMessageIndex: item.messageIndex, requiresConfirmation: true, message: '检测到无锚点 data_replace；必须明确确认后才会提升为 full checkpoint。' };
    return { summary, plan: { ...summary, kind: 'confirmed_orphan_data_replace', chat, chatKey: String(currentChatFileIdentifier_ACU || '').trim(), sourceFrameFingerprint: getFrameFingerprint_ACU(item.frame), candidateData: repair.candidateData || candidateData } };
  }
  // 空信封无锚点状态（手动重填全范围清理删除唯一 full checkpoint 后遗留）：
  // 无任何 full checkpoint、无 artifact，但 tagData 上可能保留 recoveryBackup
  // （demote/清理/恢复动作写入的原帧证据）。若 backup 内 frame 携带合法 full
  // checkpoint，可用其 data 作为 integrity_repair 根的无损重建基底。
  for (let messageIndex = 0; messageIndex < chat.length; messageIndex += 1) {
    const message = chat[messageIndex];
    if (!message || message.is_user) continue;
    const tagData = readIsolatedTagData_ACU(message, isolationKey) as any;
    if (!tagData || typeof tagData !== 'object') continue;
    const backup = tagData.recoveryBackup as TableV2RecoveryBackup_ACU | undefined;
    if (!backup || typeof backup !== 'object' || !backup.storageFrame || typeof backup.storageFrame !== 'object') continue;
    const backupCheckpoint = backup.storageFrame.checkpoint;
    if (!backupCheckpoint || backupCheckpoint.kind !== 'full' || !backupCheckpoint.data) continue;
    const candidateData = backupCheckpoint.data as TableDataObject_ACU;
    const repair = repairCandidate_ACU(candidateData);
    if (repair.status !== 'clean' && !repair.candidateData) {
      return { summary: { status: 'unrecoverable', isolationKey, sourceMessageIndex: messageIndex, requiresConfirmation: false, message: 'recoveryBackup 内的 full checkpoint 数据不满足无损自动修复条件。' } };
    }
    const summary: V2RecoverySummary_ACU = {
      status: 'recoverable_from_recovery_backup',
      isolationKey,
      sourceMessageIndex: messageIndex,
      requiresConfirmation: false,
      message: `检测到无锚点 V2 空信封，但其 tagData 保留 recoveryBackup（kind=${backup.recoveryKind || 'unknown'}）；可用备份中的 full checkpoint 数据重建 integrity_repair 根。应用修复时原始 frame 会保留为隔离备份。`,
    };
    return { summary, plan: { ...summary, kind: 'restored_from_recovery_backup', chat, chatKey: String(currentChatFileIdentifier_ACU || '').trim(), sourceFrameFingerprint: getFrameFingerprint_ACU(backup.storageFrame), candidateData: repair.candidateData || candidateData } };
  }
  return { summary: { status: 'unrecoverable_no_base', isolationKey, requiresConfirmation: false, message: '仅检测到无 base 的 V2 日志；无法编造恢复数据。' } };
}
export async function scanV2IsolationDiagnostics_ACU(chat: any[] = getChatArray_ACU()): Promise<V2IsolationDiagnostic_ACU[]> {
  const isolationKeys = new Set<string>();
  for (const message of chat) {
    if (message?.is_user) continue;
    const isolatedData = message?.TavernDB_ACU_IsolatedData;
    if (!isolatedData || typeof isolatedData !== 'object' || Array.isArray(isolatedData)) continue;
    for (const isolationKey of Object.keys(isolatedData)) {
      if (isV2TagData_ACU(isolatedData[isolationKey])) isolationKeys.add(isolationKey);
    }
  }
  const currentIsolationKey = getCurrentIsolationKey_ACU();
  const diagnostics = await Promise.all([...isolationKeys].map(async isolationKey => ({
    ...(await diagnoseV2Recovery_ACU(chat, isolationKey)).summary,
    isCurrentIsolation: isolationKey === currentIsolationKey,
  })));
  return diagnostics;
}
export async function prepareV2Recovery_ACU(options: { chat?: any[]; isolationKey?: string } = {}): Promise<V2RecoverySummary_ACU> {
  const chat = options.chat || getChatArray_ACU();
  const isolationKey = options.isolationKey ?? getCurrentIsolationKey_ACU();
  const diagnosis = await diagnoseV2Recovery_ACU(chat, isolationKey);
  return diagnosis.plan ? createPlan_ACU(diagnosis.plan) : diagnosis.summary;
}

export async function commitPreparedV2Recovery_ACU(
  planId: string,
  options: CommitPreparedV2RecoveryOptions_ACU = {},
): Promise<V2RecoveryCommitResult_ACU> {
  const plan = plans_ACU.get(planId);
  const failure = (error: string): V2RecoveryCommitResult_ACU => ({ status: 'commit_failed_rolled_back', planId, error });
  if (!plan) return failure('恢复计划不存在或已失效，请重新诊断。');
  if (plan.requiresConfirmation && options.confirmOrphanDataReplace !== true) {
    return failure('无锚点 data_replace 恢复必须显式确认。');
  }
  if (!currentScopeMatches_ACU(plan)) {
    plans_ACU.delete(planId);
    return failure('恢复计划作用域已变化，请重新诊断。');
  }
  const affectedChanged = planAffectedFramesUnchanged_ACU(plan);
  if (affectedChanged) {
    plans_ACU.delete(planId);
    return failure(affectedChanged);
  }

  let candidateChat: any[];
  try {
    candidateChat = buildRecoveredCandidateChat_ACU(plan);
  } catch (error) {
    return failure(`恢复候选构造失败：${getErrorMessage_ACU(error)}`);
  }
  try {
    await validateRecoveredCandidateReplay_ACU(plan, candidateChat);
  } catch (error) {
    return failure(`恢复候选 replay 校验失败，未保存任何更改：${getErrorMessage_ACU(error)}`);
  }

  const commitResult = await runTableWriteTransaction_ACU<V2RecoveryCommitResult_ACU>({
    source: 'system',
    reason: 'v2_integrity_recovery',
    isolationKey: plan.isolationKey,
    writeSet: [{ kind: 'all' }],
    maintenanceMode: 'exclusive',
  }, async (ctx) => {
    try {
      return await ctx.runCommit(async () => {
        if (!currentScopeMatches_ACU(plan)) {
          plans_ACU.delete(planId);
          return failure('恢复计划作用域已变化，请重新诊断。');
        }
        const affectedChanged = planAffectedFramesUnchanged_ACU(plan);
        if (affectedChanged) {
          plans_ACU.delete(planId);
          return failure(affectedChanged);
        }

        const beforeChat = clone_ACU(plan.chat);
        plan.chat.splice(0, plan.chat.length, ...candidateChat);
        try {
          await saveChatToHostStrict_ACU();
        } catch (error) {
          plan.chat.splice(0, plan.chat.length, ...beforeChat);
          return failure(`宿主保存失败，已恢复内存聊天：${getErrorMessage_ACU(error)}`);
        }

        plans_ACU.delete(planId);
        if (!currentScopeMatches_ACU(plan)) {
          return failure('宿主保存后恢复计划作用域已变化。');
        }
        return { status: 'committed', planId };
      });
    } catch (error) {
      return failure(getErrorMessage_ACU(error));
    }
  });
  if (commitResult.status !== 'committed') return commitResult;

  const expectedStorageMode = getCurrentStorageMode();
  try {
    if (expectedStorageMode === 'sqlite') {
      await reloadStorageProvider();
      if (didSqliteFallbackAfterReload_ACU(expectedStorageMode)) {
        throw new Error('SQLite 运行时重载后已静默回退到 native provider。');
      }
    }
    if (!currentScopeMatches_ACU(plan)) throw new Error('宿主保存后运行时重载期间恢复计划作用域已变化。');
    return commitResult;
  } catch (error) {
    return { status: 'committed_postcondition_failed', planId, error: getErrorMessage_ACU(error) };
  }
}
