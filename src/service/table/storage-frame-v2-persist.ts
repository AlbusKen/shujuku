import { getChatArray_ACU, saveChatToHost_ACU, saveChatToHostStrict_ACU } from '../../data/gateways/chat-gateway';
import { advanceProvisionalBridgeCommitProgress_ACU, authorizeManualCatchUpBucketWrite_ACU, readActiveProvisionalBridge_ACU } from './manual-catch-up-provisional-bridge';
import { cloneIsolatedData_ACU, collectSqlTargetTableNamesFromStorageFrameV2_ACU, purgeManualRefillIncrementalSheetKeysFromStorageFrameV2_ACU, purgeSheetKeysFromMessage_ACU, readIsolatedDataContainer_ACU, readIsolatedTagData_ACU, writeMessageIdentity_ACU } from '../../data/repositories/chat-message-data-repo';
import { getActiveChatStorageIdentity_ACU, peekChatScopedConfigContainer_ACU, peekChatSheetGuideContainer_ACU, setChatScopedConfigContainer_ACU, setChatSheetGuideContainer_ACU } from '../../data/storage/chat-history';
import type { Sheet_ACU, TableDataObject_ACU } from '../../shared/models/table-data';
import type { StorageMode } from '../../shared/table-storage-provider';
import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { startRuntimePerformanceSpan_ACU } from '../../shared/runtime-performance';
import { getCurrentIsolationKey_ACU, settings_ACU } from '../runtime/state-manager';
import { normalizeGuideData_ACU, setChatSheetGuideDataForIsolationKey_ACU } from '../template/chat-scope';
import { ensureGlobalInjectionConfigDefaults_ACU } from '../worldbook/injection-engine';
import type { ManualRefillProgressV2_ACU, TableMutationEventV2_ACU, TableMutationLogEntryV2_ACU, TableMutationSourceV2_ACU, TableStorageFrameV2_ACU, TableCheckpointV2_ACU, TableMutationWriteSetV2_ACU, TableMutationOperationV2_ACU, TableSheetCheckpointV2_ACU, TableV2RecoveryBackup_ACU } from './storage-frame-v2-types';
import { hasLegacyTopLevelTableData_ACU, hasV2TableHistoryEvidence_ACU, isLegacyV1TagData_ACU, isV2TagData_ACU } from './storage-strategy-resolver';
import { applyTableOperationV2_ACU, collectScheduleSummaryFromFramesV2_ACU, hasStructuralReplayCompatibilityRepairs_ACU, hasUnanchoredReplayArtifactsForChatV2_ACU, loadTableStateFromFramesV2Detailed_ACU, resolveHeaderOnlyTemplateSnapshot_ACU, type TableReplayCompatibilityRepairV2_ACU } from './storage-frame-v2-replay';
import { runTableWriteTransaction_ACU, type TableWriteTransactionContext_ACU } from './table-write-transaction';
import { formatCanonicalRowIssues_ACU, normalizeCanonicalTableRows_ACU } from '../../shared/canonical-row-normalizer';
import { createSheetInsertPlan, generateDDL, validateDDLTextAgainstHeaders_ACU } from '../../data/sqlite/schema-mapper';
import { hydrateTableDataStrict_ACU } from './sqlite-template-validation';
import { buildCanonicalFullCheckpoint_ACU, buildCanonicalSheetCheckpoint_ACU } from './canonical-checkpoint-builder';
import { getTableDataFingerprint_ACU } from './table-data-upgrade-audit';
import { parseDDLColumnInfos_ACU } from '../../shared/ddl-utils';
import { validateCanonicalCheckpoint_ACU } from '../../shared/canonical-checkpoint-validator';
import { findLatestTransitionCheckpoint_ACU } from './compat-transition-checkpoint';
import { reconcileRevealedSheetWithTemplate_ACU } from '../template/chat-template-reconciler';

export interface TableCheckpointGenerationConfig_ACU {
  maxEntriesAfterCheckpoint: number;
  maxOperationKbAfterCheckpoint: number;
  maxOperationBytesAfterCheckpoint: number;
  maxOperationCountAfterCheckpoint: number;
  cumulativeOperationRatioPercent: number;
  singleOperationRatioPercent: number;
  cumulativeOperationRatio: number;
  singleOperationRatio: number;
}

export interface TableCheckpointGenerationStatus_ACU {
  latestCheckpointMessageIndex?: number;
  latestCheckpointAiFloor?: number;
  entryCountAfterCheckpoint: number;
  cumulativeOperationBytes: number;
  cumulativeOperationCount: number;
  fullCheckpointBytes: number;
  nextWriteKind: 'incremental' | 'full';
  config: TableCheckpointGenerationConfig_ACU;
}

export interface ReplaceExistingIncrementalOptions_ACU {
  targetMessageIndices: number[];
  targetSheetKeys: string[];
}

export interface PersistTableMutationV2Options_ACU {
  targetMessageIndex?: number;
  source: TableMutationSourceV2_ACU;
  /**
   * 调用方声明的事务后数据。持久化层不再做 replay-vs-afterData 相等性阻断；
   * 数据正确性由来源链路保证，本层只校验输入合法性、操作可应用性与原子保存。
   */
  afterData: TableDataObject_ACU;
  operations?: TableMutationOperationV2_ACU[];
  filledSheetKeys?: string[];
  candidateChangedSheetKeys?: string[] | null;
  groupKeys?: string[];
  requestId?: string;
  batchId?: string;
  error?: string;
  forceCheckpoint?: boolean;
  checkpointReason?: TableCheckpointV2_ACU['reason'];
  manualRefillProgress?: ManualRefillProgressV2_ACU;
  isolationKey?: string;
  baseRevision?: string | null;
  parentRevision?: string | null;
  writeSet?: TableMutationWriteSetV2_ACU;
  revisionWriteSet?: TableMutationWriteSetV2_ACU;
  /** 在追加本次 entry 前，裁剪指定消息与表的历史手动填表增量。 */
  replaceExistingIncremental?: ReplaceExistingIncrementalOptions_ACU;
  /** 调用方已处于 transactionContext.runCommit 临界区内时使用，避免嵌套 commit 锁。 */
  assumeCommitLock?: boolean;
  /** 对破坏性复合写入要求宿主真实保存；默认保持历史宽松保存语义。 */
  strictSave?: boolean;
  /** manual catch-up provisional bridge run 的 runId；传入时按 bridge 准入规则校验写入。 */
  manualCatchUpRunId?: string;
  performanceRunId?: string;
  performanceParentSpanId?: string;
  transactionContext?: Pick<TableWriteTransactionContext_ACU, 'runCommit' | 'baseRevision' | 'writeSet' | 'assertFresh'>;
}

export interface PersistTableMutationLogBatchTargetV2_ACU {
  targetMessageIndex: number;
  operations: TableMutationOperationV2_ACU[];
  changedSheetKeys: string[];
}

/**
 * 多消息层 V2 增量提交。所有 target 都在内存 clone 中构造，
 * 确认后一次性写回消息对象并调用严格宿主保存。
 * afterData 正确性由来源链路保证，本层不做 candidate replay 与 afterData 的相等性阻断。
 */
export interface PersistTableMutationLogBatchV2Options_ACU {
  source: TableMutationSourceV2_ACU;
  afterData: TableDataObject_ACU;
  targets: PersistTableMutationLogBatchTargetV2_ACU[];
  isolationKey?: string;
  requestId?: string;
  batchId?: string;
  revisionWriteSet?: TableMutationWriteSetV2_ACU;
  transactionContext?: Pick<TableWriteTransactionContext_ACU, 'runCommit' | 'baseRevision' | 'writeSet' | 'assertFresh'>;
  /** 调用方已处于 transactionContext.runCommit 临界区内时使用。 */
  assumeCommitLock?: boolean;
}

export interface PersistTableSheetCheckpointV2Options_ACU {
  targetMessageIndex?: number;
  sheetKey: string;
  sheetData: Sheet_ACU;
  reason?: TableCheckpointV2_ACU['reason'];
  createdAt?: number;
  event?: TableMutationEventV2_ACU;
  manualRefillProgress?: ManualRefillProgressV2_ACU;
  isolationKey?: string;
  baseRevision?: string | null;
  /** 调用方已处于 transactionContext.runCommit 临界区内时使用，避免嵌套 commit 锁。 */
  assumeCommitLock?: boolean;
  transactionContext?: Pick<TableWriteTransactionContext_ACU, 'runCommit' | 'baseRevision' | 'writeSet' | 'assertFresh'>;
}

export interface CommitCurrentFloorTemplateChangesOptions_ACU {
  /** 未指定时选择当前聊天末尾的最新 AI 楼层。 */
  targetMessageIndex?: number;
  isolationKey?: string;
  sheetChanges: TemplateSheetChange_ACU[];
  /** 在本次模板提交中从全聊天历史精确硬删除的 Sheet。 */
  deletedSheetKeys?: string[];
  guideData: Record<string, any>;
  /** 同步当前聊天模板 scope；由 guide setter 生成一致的 chat_override 快照。 */
  syncTemplateScope?: boolean;
  templateSource?: any;
  presetName?: string;
  /**
   * 休眠溯源（S3-4）：本次提交中被 hide 的表在休眠前所属的活跃预设名。
   * 写入各 hide checkpoint 的可选 hideSourcePresetName 字段，供休眠清单展示「来源模板」。
   */
  hideSourcePresetName?: string;
  source?: string;
  reason?: string;
  /** Correlates one template reconciliation across planning and atomic persistence logs. */
  requestId?: string;
  createdAt?: number;
  baseRevision?: string | null;
  expectedChatIdentity?: string;
  expectedFirstMessage?: unknown;
  signal?: AbortSignal;
  /** native 只校验 canonical JSON；sqlite 额外执行 DDL 与 strict hydrate 门禁。 */
  storageMode?: StorageMode;
}

export interface CommitCurrentFloorTemplateChangesResult_ACU {
  saved: boolean;
  mode?: 'template_only' | 'scope_only' | 'v2_commit';
  messageIndex?: number;
  checkpoints?: TableSheetCheckpointV2_ACU[];
  removedNullRowCount?: number;
  deletedSheetKeys?: string[];
  purgedMessageCount?: number;
  hardDeleteCheckpointCreated?: boolean;
  error?: string;
}

export interface CommitCurrentFloorTemplateScopeOnlyOptions_ACU {
  isolationKey?: string;
  baselineData: TableDataObject_ACU;
  candidateData: TableDataObject_ACU;
  guideData: Record<string, any>;
  templateSource: any;
  presetName?: string;
  source?: string;
  reason?: string;
  createdAt?: number;
  expectedChatIdentity?: string;
  expectedFirstMessage?: unknown;
  signal?: AbortSignal;
  /**
   * pristine 会话（无任何实质表格数据）专用：允许 baseline 与 candidate 的持久化投影不一致。
   * 语义是「该会话尚无数据帧，模板结构只需落到聊天级配置层」，
   * 因此不要求投影匹配，但仍然不写任何 storage frame。
   * 调用方必须先用 resolveTemplateSwitchMode_ACU 确认为 pristine 才可传 true。
   */
  pristineOverride?: boolean;
}

function assertTemplateCommitChatContext_ACU(expectedChat: unknown[], options: { expectedChatIdentity?: string; expectedFirstMessage?: unknown; signal?: AbortSignal }): void {
  if (options.signal?.aborted) throw new Error('模板提交已取消。');
  const activeChat = getChatArray_ACU();
  if (!Array.isArray(activeChat) || activeChat.length === 0) throw new Error('目标聊天已切换，已取消模板提交。');
  if (options.expectedFirstMessage && (expectedChat[0] !== options.expectedFirstMessage || activeChat[0] !== options.expectedFirstMessage)) {
    throw new Error('目标聊天已切换，已取消模板提交。');
  }
  if (options.expectedChatIdentity && getActiveChatStorageIdentity_ACU(activeChat) !== options.expectedChatIdentity) {
    throw new Error('目标聊天已切换，已取消模板提交。');
  }
}

type TemplatePersistOperation_ACU = Extract<TableMutationOperationV2_ACU, {
  kind: 'sheet_schema_migrate' | 'meta_update';
}>;

export type TemplateSheetChange_ACU =
  | {
    kind: 'introduction';
    sheetKey: string;
    sheetData: Sheet_ACU;
  }
  | {
    kind: 'rebase';
    sheetKey: string;
    sheetData: Sheet_ACU;
  }
  | {
    kind: 'reveal';
    sheetKey: string;
    sheetData: Sheet_ACU;
  }
  | {
    kind: 'hide';
    sheetKey: string;
    sheetData: Sheet_ACU;
  }
  | {
    kind: 'operations';
    sheetKey: string;
    targetSheetData: Sheet_ACU;
    operations: TemplatePersistOperation_ACU[];
  };

export type NullRowCleanupPersistStatus_ACU =
  | 'persisted'
  | 'skipped_no_changes'
  | 'skipped_no_target'
  | 'skipped_no_anchor'
  | 'skipped_no_v2_target'
  | 'skipped_invalid_data'
  | 'failed';

export interface PersistNullRowCleanupShardsOptions_ACU {
  sheetDataByKey: Record<string, Sheet_ACU>;
  isolationKey?: string;
  createdAt?: number;
}

export interface PersistNullRowCleanupShardsResult_ACU {
  status: NullRowCleanupPersistStatus_ACU;
  messageIndex?: number;
  checkpoints?: TableSheetCheckpointV2_ACU[];
  error?: string;
}

function safeJsonByteLength_ACU(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function cloneOptionalJson_ACU<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function countOperationUnits_ACU(operations: unknown[]): number {
  return operations.reduce<number>((sum, operation: any) => {
    if ((operation?.kind === 'sql_batch' || operation?.kind === 'sql_sheet_batch') && Array.isArray(operation.statements)) return sum + operation.statements.length;
    if (operation?.kind === 'data_replace' || operation?.kind === 'sheet_replace') return sum + 1;
    return sum + 1;
  }, 0);
}

function normalizePositiveIntegerSetting_ACU(value: unknown, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) && num >= 1 ? Math.floor(num) : fallback;
}

export function resolveCheckpointGenerationConfig_ACU(): TableCheckpointGenerationConfig_ACU {
  // 单一保留边界 checkpoint 策略下，运行期 full checkpoint 不再由用户阈值触发。
  // 这里保留 status shape 给旧调用方读取日志统计，但这些值不再参与写入判定。
  const maxOperationKbAfterCheckpoint = Number.MAX_SAFE_INTEGER;
  const cumulativeOperationRatioPercent = 100;
  const singleOperationRatioPercent = 100;

  return {
    maxEntriesAfterCheckpoint: Number.MAX_SAFE_INTEGER,
    maxOperationKbAfterCheckpoint,
    maxOperationBytesAfterCheckpoint: maxOperationKbAfterCheckpoint * 1024,
    maxOperationCountAfterCheckpoint: Number.MAX_SAFE_INTEGER,
    cumulativeOperationRatioPercent,
    singleOperationRatioPercent,
    cumulativeOperationRatio: cumulativeOperationRatioPercent / 100,
    singleOperationRatio: singleOperationRatioPercent / 100,
  };
}

function deepClone_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function generateEntryId_ACU(): string {
  return `v2_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function buildCommitRevision_ACU(seq: number | 'checkpoint', entryId: string): string {
  return `${seq}:${entryId}`;
}

type AppendMutationLogEntryOptions_ACU = Omit<TableMutationLogEntryV2_ACU,
  'seq' | 'entryId' | 'parentRevision' | 'commitRevision'> & {
  seq: number;
  parentRevision?: string | null;
};

function appendMutationLogEntry_ACU(
  frame: TableStorageFrameV2_ACU,
  options: AppendMutationLogEntryOptions_ACU,
): TableMutationLogEntryV2_ACU {
  const entryId = generateEntryId_ACU();
  const parentRevision = options.parentRevision !== undefined
    ? options.parentRevision
    : (frame.headRevision ?? null);
  const commitRevision = buildCommitRevision_ACU(options.seq, entryId);
  const entry: TableMutationLogEntryV2_ACU = {
    seq: options.seq,
    entryId,
    createdAt: options.createdAt,
    source: options.source,
    targetMessageIndex: options.targetMessageIndex,
    aiFloor: options.aiFloor,
    filledSheetKeys: options.filledSheetKeys,
    changedSheetKeys: options.changedSheetKeys,
    groupKeys: options.groupKeys,
    ...(options.requestId !== undefined ? { requestId: options.requestId } : {}),
    ...(options.batchId !== undefined ? { batchId: options.batchId } : {}),
    ...(options.error !== undefined ? { error: options.error } : {}),
    operations: options.operations,
    baseRevision: options.baseRevision,
    parentRevision,
    commitRevision,
    ...(options.writeSet !== undefined ? { writeSet: options.writeSet } : {}),
  };
  frame.logEntries.push(entry);
  frame.headRevision = commitRevision;
  return entry;
}

function findTargetAiMessage_ACU(chat: any[], targetMessageIndex: number | undefined): { message: any; index: number } | null {
  if (targetMessageIndex !== undefined && targetMessageIndex !== -1) {
    const message = chat[targetMessageIndex];
    if (message && !message.is_user) {
      return { message, index: targetMessageIndex };
    }
    return null;
  }

  for (let i = chat.length - 1; i >= 0; i -= 1) {
    if (chat[i] && !chat[i].is_user) {
      return { message: chat[i], index: i };
    }
  }

  return null;
}

function normalizeIncrementalReplacement_ACU(
  replacement: ReplaceExistingIncrementalOptions_ACU | undefined,
  targetMessageIndex: number,
  chat: any[],
): { targetMessageIndices: number[]; targetSheetKeys: string[] } | { error: string } | null {
  if (!replacement) return null;
  if (!Array.isArray(replacement.targetMessageIndices) || replacement.targetMessageIndices.length === 0) {
    return { error: 'V2 incremental replacement requires non-empty targetMessageIndices.' };
  }
  if (!Array.isArray(replacement.targetSheetKeys) || replacement.targetSheetKeys.length === 0) {
    return { error: 'V2 incremental replacement requires non-empty targetSheetKeys.' };
  }
  const targetMessageIndices = replacement.targetMessageIndices.map(Number);
  if (targetMessageIndices.some(index => !Number.isInteger(index) || index < 0 || index >= chat.length)
    || new Set(targetMessageIndices).size !== targetMessageIndices.length
    || !targetMessageIndices.includes(targetMessageIndex)
    || targetMessageIndices.some(index => !chat[index] || chat[index].is_user)) {
    return { error: 'V2 incremental replacement targetMessageIndices must contain unique existing AI message indices including the persist target.' };
  }
  const targetSheetKeys = replacement.targetSheetKeys.map(sheetKey => String(sheetKey || '').trim());
  if (targetSheetKeys.some(sheetKey => !sheetKey.startsWith('sheet_'))
    || new Set(targetSheetKeys).size !== targetSheetKeys.length) {
    return { error: 'V2 incremental replacement targetSheetKeys must contain unique sheet_ keys.' };
  }
  return { targetMessageIndices, targetSheetKeys };
}

function collectReplacementSqlTableNames_ACU(
  chat: any[],
  isolationKey: string,
  targetMessageIndices: number[],
  targetSheetKeys: string[],
): Set<string> {
  const maxTargetMessageIndex = Math.max(...targetMessageIndices);
  const sheetKeySet = new Set(targetSheetKeys);
  const knownSqlTableNames = new Set<string>();
  for (let index = 0; index <= maxTargetMessageIndex; index += 1) {
    const tagData = readIsolatedTagData_ACU(chat[index], isolationKey);
    if (!isV2TagData_ACU(tagData)) continue;
    collectSqlTargetTableNamesFromStorageFrameV2_ACU(tagData.storageFrame, sheetKeySet)
      .forEach(tableName => knownSqlTableNames.add(tableName));
  }
  return knownSqlTableNames;
}

function countAiFloor_ACU(chat: any[], messageIndex: number): number {
  let count = 0;
  for (let i = 0; i <= messageIndex && i < chat.length; i += 1) {
    if (chat[i] && !chat[i].is_user) count += 1;
  }
  return count;
}

/**
 * 判断目标楼层及之前是否存在可作为回放锚点的 full checkpoint。
 *
 * 缺少锚点时本次写入会被 persist 层视为初始 full checkpoint，
 * 调用方必须只提交 afterData 快照、不得附带 operations。
 */
export function hasAnyV2Checkpoint_ACU(chat: any[], isolationKey: string, maxMessageIndex = chat.length - 1): boolean {
  const hasFullCheckpoint = chat.slice(0, Math.max(0, maxMessageIndex + 1)).some(message => {
    const tagData = readIsolatedTagData_ACU(message, isolationKey);
    return isV2TagData_ACU(tagData) && tagData.storageFrame.checkpoint?.kind === 'full';
  });
  return hasFullCheckpoint || findLatestTransitionCheckpoint_ACU(chat, isolationKey, maxMessageIndex) !== null;
}

function hasAnyV2Frame_ACU(chat: any[], isolationKey: string, maxMessageIndex = chat.length - 1): boolean {
  return chat.slice(0, Math.max(0, maxMessageIndex + 1)).some(message => {
    const tagData = readIsolatedTagData_ACU(message, isolationKey);
    return isV2TagData_ACU(tagData);
  });
}

function projectReplayComparableData_ACU(data: TableDataObject_ACU): TableDataObject_ACU {
  const projected = deepClone_ACU(data);
  for (const [key, value] of Object.entries(projected)) {
    if (!key.startsWith('sheet_') || !isObjectRecord_ACU(value)) continue;
    delete (value as Record<string, any>).seedRows;
  }
  return projected;
}

/**
 * 取 Sheet 表头行（content[0]）并做最小归一：null 统一为空串。
 * 不做别名改写或 trim——任何未归一化的真实差异都应 fail-closed 拒绝降级。
 */
function projectSheetHeaderCells_ACU(sheet: Sheet_ACU): string[] {
  const content = sheet.content;
  if (!Array.isArray(content) || !Array.isArray(content[0])) return [];
  return content[0].map(cell => (cell === null ? '' : String(cell)));
}

/**
 * 提取 DDL 的物理列身份，排除显示层注释与 DDL 原文。
 * 只比较 sqlName/类型/主键/NOT NULL/默认值——「只改显示表头同步 DDL 注释」
 * 不构成结构差异，不得触发降级阻断。
 * DDL 缺失或空时返回空数组；两侧 DDL 存在性不同即视为结构差异。
 */
function projectSheetDDLIdentity_ACU(ddl: unknown): Array<{
  sqlName: string;
  declaredType: string | null;
  isPrimaryKey: boolean;
  isNotNull: boolean;
  hasDefault: boolean;
  defaultExpression: string | null;
}> {
  const text = typeof ddl === 'string' ? ddl : '';
  if (!text.trim()) return [];
  return parseDDLColumnInfos_ACU(text).map(column => ({
    sqlName: column.sqlName,
    declaredType: column.declaredType,
    isPrimaryKey: column.isPrimaryKey,
    isNotNull: column.isNotNull,
    hasDefault: column.hasDefault,
    defaultExpression: column.defaultExpression,
  }));
}

/**
 * Header-only 回放比较专用结构投影（P0 修复核心）。
 *
 * template_only_root 降级前，候选回放（模板临时基线）与原 checkpoint 比较的是
 * 「表结构」而非「全部持久化字段」：checkpoint 携带旧模板的 updateConfig、
 * exportConfig、sourceData.note 等非结构配置，模板基线携带当前配置，全量指纹
 * 比较必然把「仅改配置」误报为结构不一致。
 *
 * 本投影只保留影响表集合与作用域的结构字段：
 * - mate 仅保留 type/version（格式标识，排除注入配置与 UI sentinel）
 * - 每张表保留 uid/name/orderNo（身份、显示名、顺序）
 * - content[0] 完整表头行（row_id 位置与列顺序）
 * - DDL 物理列身份（见 projectSheetDDLIdentity_ACU）
 *
 * 任何真实结构变化（表增删、表头改名、列增删/位移、row_id 变化、DDL 物理列
 * 变化）都会改变指纹，维持 fail-closed。
 */
function projectHeaderOnlyReplayComparableData_ACU(data: TableDataObject_ACU): TableDataObject_ACU {
  const projected: Record<string, unknown> = {};
  const mate = (data as Record<string, any>).mate;
  if (isObjectRecord_ACU(mate)) {
    projected.mate = { type: mate.type, version: mate.version };
  }
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith('sheet_') || !isObjectRecord_ACU(value)) continue;
    const sheet = value as Sheet_ACU;
    projected[key] = {
      uid: sheet.uid,
      name: sheet.name,
      orderNo: sheet.orderNo,
      header: projectSheetHeaderCells_ACU(sheet),
      ddlColumns: projectSheetDDLIdentity_ACU(sheet.sourceData ? sheet.sourceData.ddl : ''),
    };
  }
  return projected as TableDataObject_ACU;
}

/**
 * 结构差异诊断：与 projectHeaderOnlyReplayComparableData_ACU 的投影字段一一对应，
 * 保证「指纹不等 ⇒ 本函数至少返回一条差异」。
 */
function diffHeaderOnlyReplayStructures_ACU(
  checkpointData: TableDataObject_ACU,
  replayData: TableDataObject_ACU,
): string[] {
  const details: string[] = [];
  const checkpointKeys = Object.keys(checkpointData).filter(key => key.startsWith('sheet_'));
  const replayKeys = Object.keys(replayData).filter(key => key.startsWith('sheet_'));
  const addedSheets = replayKeys.filter(key => !checkpointKeys.includes(key));
  const removedSheets = checkpointKeys.filter(key => !replayKeys.includes(key));
  if (addedSheets.length > 0) details.push(`addedSheets=[${addedSheets.join(',')}]`);
  if (removedSheets.length > 0) details.push(`removedSheets=[${removedSheets.join(',')}]`);
  const mateA = (checkpointData as Record<string, any>).mate;
  const mateB = (replayData as Record<string, any>).mate;
  if (mateA?.type !== mateB?.type) details.push('mate.typeChanged');
  if (mateA?.version !== mateB?.version) details.push('mate.versionChanged');
  for (const key of checkpointKeys) {
    if (!replayKeys.includes(key)) continue;
    const checkpointSheet = checkpointData[key] as Sheet_ACU;
    const replaySheet = replayData[key] as Sheet_ACU;
    if (checkpointSheet.uid !== replaySheet.uid) details.push(`${key}.uidChanged`);
    if (checkpointSheet.name !== replaySheet.name) details.push(`${key}.nameChanged`);
    if (checkpointSheet.orderNo !== replaySheet.orderNo) details.push(`${key}.orderChanged`);
    const checkpointHeader = projectSheetHeaderCells_ACU(checkpointSheet);
    const replayHeader = projectSheetHeaderCells_ACU(replaySheet);
    if (JSON.stringify(checkpointHeader) !== JSON.stringify(replayHeader)) details.push(`${key}.headerChanged`);
    const checkpointDdl = projectSheetDDLIdentity_ACU(checkpointSheet.sourceData ? checkpointSheet.sourceData.ddl : '');
    const replayDdl = projectSheetDDLIdentity_ACU(replaySheet.sourceData ? replaySheet.sourceData.ddl : '');
    if (JSON.stringify(checkpointDdl) !== JSON.stringify(replayDdl)) details.push(`${key}.ddlChanged`);
  }
  return details;
}

async function verifyTemporaryBaselineUpgrade_ACU(
  replayData: TableDataObject_ACU,
  operations: TableMutationOperationV2_ACU[],
  afterData: TableDataObject_ACU,
): Promise<boolean> {
  const expected = deepClone_ACU(replayData);
  for (const operation of operations) await applyTableOperationV2_ACU(expected, operation);
  return getTableDataFingerprint_ACU(projectReplayComparableData_ACU(expected))
    === getTableDataFingerprint_ACU(projectReplayComparableData_ACU(afterData));
}

function buildCandidateChatWithIsolatedDataOverrides_ACU(
  chat: any[],
  isolatedDataByMessageIndex: Map<number, Record<string, any>>,
): any[] {
  return chat.map((message, messageIndex) => {
    const isolatedData = isolatedDataByMessageIndex.get(messageIndex);
    return isolatedData === undefined
      ? message
      : { ...message, TavernDB_ACU_IsolatedData: isolatedData };
  });
}

async function validateTemporaryBaselineUpgradeCandidate_ACU(
  candidateChat: any[],
  isolationKey: string,
  targetMessageIndex: number,
  afterData: TableDataObject_ACU,
): Promise<string | null> {
  const validateReplay = async (
    scope: 'boundary' | 'suffix',
    options: { maxMessageIndex?: number },
  ): Promise<string | null> => {
    let replay;
    try {
      replay = await loadTableStateFromFramesV2Detailed_ACU(candidateChat, isolationKey, {
        ...options,
        updateRuntimeState: false,
        compatibilityMode: 'disabled',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `V2 candidate_${scope}_replay_failed: ${message}`;
    }
    if (!replay || replay.baseKind !== 'full_checkpoint') {
      return `V2 candidate_${scope}_replay_failed: 未能从正式 full checkpoint 建立回放基底。`;
    }
    if (replay.requiresCheckpointConvergence || replay.compatibilityRepairs?.length) {
      return `V2 candidate_requires_convergence: ${scope} replay 仍依赖临时 Sheet 补锚。`;
    }
    if (scope === 'boundary'
      && getTableDataFingerprint_ACU(projectReplayComparableData_ACU(replay.data))
        !== getTableDataFingerprint_ACU(projectReplayComparableData_ACU(afterData))) {
      return 'V2 candidate_boundary_replay_failed: checkpoint 边界回放结果与 afterData 不一致。';
    }
    return null;
  };

  return await validateReplay('boundary', { maxMessageIndex: targetMessageIndex })
    || await validateReplay('suffix', {});
}

async function validateProvisionalConvergenceCandidate_ACU(
  candidateChat: any[],
  isolationKey: string,
  targetMessageIndex: number,
): Promise<string | null> {
  // 单根不变量显式守护：候选 chat 同一隔离键下至多一个 full checkpoint。
  // convergence 只允许把临时锚点固化到既有唯一根，绝不允许候选再造出第二个基线。
  const invariantViolation = assertSingleActiveFullCheckpointV2_ACU(candidateChat, isolationKey, 'convergence_candidate');
  if (invariantViolation) return invariantViolation;
  for (const [scope, options] of [
    ['boundary', { maxMessageIndex: targetMessageIndex }],
    ['suffix', {}],
  ] as const) {
    try {
      const replay = await loadTableStateFromFramesV2Detailed_ACU(candidateChat, isolationKey, {
        ...options,
        updateRuntimeState: false,
        compatibilityMode: 'disabled',
      });
      if (!replay || replay.baseKind !== 'full_checkpoint') {
        return `V2 convergence_candidate_${scope}_replay_failed: 候选未能从正式 full checkpoint 建立回放基底。`;
      }
      if (replay.requiresCheckpointConvergence || replay.compatibilityRepairs?.length) {
        return `V2 convergence_candidate_${scope}_requires_repair: 候选仍依赖兼容补锚。`;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `V2 convergence_candidate_${scope}_replay_failed: ${message}`;
    }
  }
  return null;
}

/**
 * 从当前模板重新解析 header-only snapshot，并校验与 replay 当时记录一致。
 *
 * 锚点数据不随 compatibilityRepairs 持久化（replay 只记录了 templateFingerprint），
 * 因此收敛侧必须重新解析模板；用指纹校验可防止模板在两次解析之间被改，
 * 不一致即 fail-closed，绝不基于不可信的模板数据写锚点。
 */
function resolveConvergenceAnchorSheetData_ACU(
  chat: any[],
  isolationKey: string,
  repairs: readonly TableReplayCompatibilityRepairV2_ACU[],
): { bySheetKey: Map<string, Sheet_ACU>; error?: undefined } | { bySheetKey?: undefined; error: string } {
  const headerOnly = resolveHeaderOnlyTemplateSnapshot_ACU(chat, isolationKey);
  if (!headerOnly) {
    return { error: 'V2 收敛无法从当前聊天模板重新解析 header-only 锚点数据，已拒绝自动收敛。' };
  }
  const fingerprint = getTableDataFingerprint_ACU(headerOnly);
  const bySheetKey = new Map<string, Sheet_ACU>();
  for (const repair of repairs) {
    if (repair.templateFingerprint && repair.templateFingerprint !== fingerprint) {
      return { error: `V2 收敛模板指纹不一致（replay 时 ${repair.templateFingerprint}，当前 ${fingerprint}），模板已在补锚后被修改，拒绝按不可信模板写锚点。` };
    }
    const sheet = headerOnly[repair.sheetKey];
    if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet) || !('content' in sheet)) {
      return { error: `V2 收敛锚点缺少目标表 ${repair.sheetKey} 的模板数据，已拒绝自动收敛。` };
    }
    const sheetData = sheet as Sheet_ACU;
    bySheetKey.set(repair.sheetKey, deepClone_ACU(sheetData));
  }
  return { bySheetKey };
}

/**
 * 把 per-sheet 锚点写入目标帧的 perSheetCheckpoints（untimed）。
 *
 * - timeline 取 untimed（undefined）：回放循环在帧开头对 untimed checkpoint
 *   整表写入 state，无需引入 introduction/rebase 等时序标记；锚点落在 full
 *   根帧时在 state 初始化后立即生效（storage-frame-v2-replay.ts:1349）。
 * - 目标帧若已有同表 log entry，按 logEntryConflictsWithSheetCheckpoint_ACU 语义拒绝
 *   （对齐 persistTableSheetCheckpointV2Core_ACU 的冲突守卫），不新造规则。
 */
function writeSheetAnchorCheckpointsToFrame_ACU(
  frame: TableStorageFrameV2_ACU,
  bySheetKey: Map<string, Sheet_ACU>,
  createdAt: number,
  baseRevision: string | null | undefined,
  context: { messageIndex: number; aiFloor: number; isolationKey: string },
): { ok: true } | { ok: false; error: string } {
  for (const [sheetKey, sheet] of bySheetKey) {
    const conflictingEntry = (frame.logEntries || []).find(entry => logEntryConflictsWithSheetCheckpoint_ACU(entry, sheetKey));
    if (conflictingEntry) {
      return { ok: false, error: `V2 收敛锚点无法写入：根帧已有同表 log entry（sheetKey=${sheetKey}, entryId=${conflictingEntry.entryId}），请先恢复。` };
    }
    const checkpointResult = buildCanonicalSheetCheckpoint_ACU({
      createdAt,
      reason: 'integrity_repair',
      sheetKey,
      data: sheet,
      baseRevision,
      context,
    });
    if (checkpointResult.checkpoint === undefined) {
      return { ok: false, error: `V2 收敛锚点构建失败（${sheetKey}）：${checkpointResult.error}` };
    }
    frame.perSheetCheckpoints = {
      ...(frame.perSheetCheckpoints || {}),
      [sheetKey]: checkpointResult.checkpoint,
    };
  }
  return { ok: true };
}


async function validateHardDeleteCandidate_ACU(
  candidateChat: any[],
  isolationKey: string,
  targetMessageIndex: number,
  deletedSheetKeys: string[],
  expectedData: TableDataObject_ACU,
): Promise<string | null> {
  let replay;
  try {
    replay = await loadTableStateFromFramesV2Detailed_ACU(candidateChat, isolationKey, {
      maxMessageIndex: targetMessageIndex,
      updateRuntimeState: false,
      compatibilityMode: 'disabled',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `V2 hard-delete candidate replay failed: ${message}`;
  }
  if (!replay || replay.baseKind !== 'full_checkpoint') {
    return 'V2 hard-delete candidate replay failed: 未能从正式 full checkpoint 建立回放基底。';
  }
  if (replay.requiresCheckpointConvergence || replay.compatibilityRepairs?.length) {
    return 'V2 hard-delete candidate replay requires compatibility convergence.';
  }
  const resurrectedSheetKeys = deletedSheetKeys.filter(sheetKey => Object.prototype.hasOwnProperty.call(replay.data, sheetKey));
  if (resurrectedSheetKeys.length > 0) {
    return `V2 hard-delete candidate replay resurrected deleted Sheet: ${resurrectedSheetKeys.join(', ')}。`;
  }
  if (getTableDataFingerprint_ACU(projectReplayComparableData_ACU(replay.data))
    !== getTableDataFingerprint_ACU(projectReplayComparableData_ACU(expectedData))) {
    return 'V2 hard-delete candidate replay does not match the requested terminal template state.';
  }
  return null;
}

export function getLatestTableStorageHeadRevisionV2_ACU(chat: any[] | null | undefined, isolationKey: string): string | null {
  if (!Array.isArray(chat) || chat.length === 0) return null;
  let headRevision: string | null = null;
  for (const message of chat) {
    const tagData = readIsolatedTagData_ACU(message, isolationKey);
    if (isV2TagData_ACU(tagData)) {
      headRevision = tagData.storageFrame.headRevision ?? headRevision;
    }
  }
  return headRevision;
}


/**
 * 按楼层正序收集同一隔离键下全部 full checkpoint 的 message index。
 *
 * 同一隔离键下同一时刻只能存在一个 full checkpoint（见 persistTableMutationLogV2Core_ACU
 * 的不变量注释）：回放只认最后一个 full checkpoint，多出来的基线会让它之前的
 * 所有增量失效。本原语用于显式计数与断言该不变量，供 convergence / recovery / compaction
 * 等写入路径共用，避免各路径各自重复扫描。
 *
 * @param maxMessageIndex 只统计该楼层及之前；缺省为聊天末尾。
 */
export function collectV2FullCheckpointIndices_ACU(
  chat: any[] | null | undefined,
  isolationKey: string,
  maxMessageIndex?: number,
): number[] {
  if (!Array.isArray(chat) || chat.length === 0) return [];
  const upperBound = maxMessageIndex === undefined
    ? chat.length - 1
    : Math.max(-1, Math.min(chat.length - 1, Math.floor(maxMessageIndex)));
  const indices: number[] = [];
  for (let i = 0; i <= upperBound; i += 1) {
    const tagData = readIsolatedTagData_ACU(chat[i], isolationKey);
    if (isV2TagData_ACU(tagData) && tagData.storageFrame.checkpoint?.kind === 'full') {
      indices.push(i);
    }
  }
  return indices;
}

/**
 * 断言同一隔离键下至多存在一个 full checkpoint（单根不变量）。
 *
 * 违反时返回带全部索引与各自 reason 的失败信息，便于事故复盘直接定位是哪些
 * 楼层、以什么理由写了多余基线；命中不变量时返回 null。
 */
export function assertSingleActiveFullCheckpointV2_ACU(
  chat: any[] | null | undefined,
  isolationKey: string,
  context: string,
): string | null {
  const indices = collectV2FullCheckpointIndices_ACU(chat, isolationKey);
  if (indices.length <= 1) return null;
  const detail = indices.map(index => {
    const tagData = readIsolatedTagData_ACU(chat?.[index], isolationKey);
    const checkpoint = isV2TagData_ACU(tagData) ? tagData.storageFrame.checkpoint : undefined;
    return `#${index}(${checkpoint?.reason ?? 'unknown'})`;
  }).join('、');
  return `V2 ${context} 违反单根不变量：同一隔离键下存在 ${indices.length} 个 full checkpoint（${detail}），回放只认最后一个，多余基线会使之前增量失效。`;
}

/**
 * S2-4：初始化（reason:'init'）full checkpoint 的统一写入口。
 *
 * 之前 template-state-reset 在调用方手工拼装 storageFrame 直接赋给消息，
 * frame 协议散落且没有单根断言。此入口把「frame 拼装 + 单根不变量校验」收敛到
 * persist 层：写入后若同一隔离键下存在多个 full checkpoint，立即抛错（调用方
 * 的事务快照回滚会撤销本次赋值），不允许半写状态落盘。
 *
 * 注意：只负责写 frame，不改 TavernDB_ACU_Identity、不保存聊天——这些仍由
 * 调用方在其事务语义内完成。目标楼同一消息上其他隔离键的数据原样保留。
 */
export function writeInitFullCheckpointFrameV2_ACU(options: {
  chat: any[];
  targetIndex: number;
  isolationKey: string;
  checkpoint: TableCheckpointV2_ACU;
}): void {
  const { chat, targetIndex, isolationKey, checkpoint } = options;
  const target = Array.isArray(chat) ? chat[targetIndex] : undefined;
  if (!target || target.is_user) {
    throw new Error(`初始化 checkpoint 写入目标无效：楼层 #${targetIndex} 不存在或不是 AI 楼层。`);
  }
  if (checkpoint?.kind !== 'full' || checkpoint.reason !== 'init') {
    throw new Error(`初始化 checkpoint 写入口只接受 reason:'init' 的 full checkpoint（收到 kind=${checkpoint?.kind}, reason=${(checkpoint as any)?.reason}）。`);
  }
  target.TavernDB_ACU_IsolatedData = {
    ...(target.TavernDB_ACU_IsolatedData || {}),
    [isolationKey]: { _acu_storage_version: 2, storageFrame: { version: 2, checkpoint, logEntries: [] } },
  };
  const violation = assertSingleActiveFullCheckpointV2_ACU(chat, isolationKey, 'init_reset');
  if (violation) throw new Error(violation);
}

function findLatestFullCheckpoint_ACU(
  chat: any[] | null | undefined,
  isolationKey: string,
): { message: any; index: number; checkpoint: TableCheckpointV2_ACU } | null {
  if (!Array.isArray(chat) || chat.length === 0) return null;
  const indices = collectV2FullCheckpointIndices_ACU(chat, isolationKey);
  if (indices.length === 0) return null;
  const index = indices[indices.length - 1];
  const tagData = readIsolatedTagData_ACU(chat[index], isolationKey);
  return { message: chat[index], index, checkpoint: tagData.storageFrame.checkpoint };
}

function findLatestReplayRootMessageIndex_ACU(
  chat: any[] | null | undefined,
  isolationKey: string,
): number | null {
  const fullCheckpoint = findLatestFullCheckpoint_ACU(chat, isolationKey);
  return fullCheckpoint?.index ?? null;
}

/**
 * 统一「bounded 与 unbounded」两种视角的写目标回放根准入检查。
 *
 * 背景：persist 层在 `persistTableMutationLogV2Core_ACU`（1908）与 sheet checkpoint
 * 路径（2702）对「写目标早于最新 full checkpoint」fail-fast，但该检查发生在 AI 调用
 * 之后——AI 已消耗 token 才在写入阶段暴露。本函数把同一判定前移到编排层：任何写目标
 * 早于回放根（最新 full checkpoint）的 bucket，在发起 AI 请求前就必须被阻止。
 *
 * 视角说明：
 * - bounded（目标楼层及之前是否存在 anchor）：`hasAnyV2Checkpoint_ACU(chat, key, maxMessageIndex)`
 *   只能回答「有没有」，无法区分「目标自身就是根」与「目标早于根」——对目标=根放行、
 *   对目标<根阻止，必须看 unbounded 的 `findLatestFullCheckpoint_ACU` 才能区分。
 * - unbounded：`findLatestFullCheckpoint_ACU` 给出全局最新 full checkpoint 楼层。
 *
 * 例外：provisional bridge run（manual catch-up 追平场景，写目标可合法早于原 full 根，
 * 见 persist 层 2293-2295 的 bridge 写入准入）——`manualCatchUpRunId` 匹配 active bridge
 * 时放行，避免把 bridge 的合法前移写误判为拓扑越界。
 *
 * @returns 可放行时返回 `{ allow: true }`；否则返回 `{ allow: false, reason, targetMessageIndex, latestFullCheckpointIndex }`
 */
export function assertWriteTargetNotBeforeReplayRoot_ACU(options: {
  chat: any[];
  isolationKey: string;
  targetMessageIndex: number;
  /** manual catch-up provisional bridge run 的 runId；匹配 active bridge 时放行。 */
  manualCatchUpRunId?: string;
}): { allow: true; reason?: never } | { allow: false; reason: string; targetMessageIndex: number; latestFullCheckpointIndex: number } {
  const { chat, isolationKey, targetMessageIndex, manualCatchUpRunId } = options;
  if (!Array.isArray(chat) || chat.length === 0) return { allow: true };
  if (!Number.isInteger(targetMessageIndex) || targetMessageIndex < 0) return { allow: true };
  const latestRootIndex = findLatestReplayRootMessageIndex_ACU(chat, isolationKey);
  if (latestRootIndex === null) return { allow: true };
  if (targetMessageIndex >= latestRootIndex) return { allow: true };
  // provisional bridge 例外：active bridge 且 runId 匹配 → 放行
  if (manualCatchUpRunId && readActiveProvisionalBridge_ACU(chat, isolationKey)?.runId === manualCatchUpRunId) {
    return { allow: true };
  }
  return {
    allow: false,
    reason: `写目标早于 V2 回放根且无有效 provisional bridge：targetMessageIndex=${targetMessageIndex}, latestReplayRootIndex=${latestRootIndex}。`,
    targetMessageIndex,
    latestFullCheckpointIndex: latestRootIndex,
  };
}


function getLogEntriesAfterLatestCheckpoint_ACU(chat: any[], isolationKey: string): TableMutationLogEntryV2_ACU[] {
  const latestCheckpoint = findLatestFullCheckpoint_ACU(chat, isolationKey);
  const latestCheckpointIndex = latestCheckpoint?.index ?? -1;
  const entries: TableMutationLogEntryV2_ACU[] = [];
  for (let i = Math.max(0, latestCheckpointIndex); i < chat.length; i += 1) {
    const tagData = readIsolatedTagData_ACU(chat[i], isolationKey);
    if (isV2TagData_ACU(tagData)) {
      entries.push(...(tagData.storageFrame.logEntries || []));
    }
  }
  return entries;
}

export function collectCheckpointGenerationStatusV2_ACU(
  chat: any[] | null | undefined,
  isolationKey: string,
  currentData?: TableDataObject_ACU | null,
): TableCheckpointGenerationStatus_ACU {
  const config = resolveCheckpointGenerationConfig_ACU();
  const safeChat = Array.isArray(chat) ? chat : [];
  const latestCheckpoint = findLatestFullCheckpoint_ACU(safeChat, isolationKey);
  const previousEntries = getLogEntriesAfterLatestCheckpoint_ACU(safeChat, isolationKey);
  const previousOperations = previousEntries.flatMap(entry => entry.operations || []);
  const fullCheckpointSource = currentData || latestCheckpoint?.checkpoint?.data || {};
  const fullCheckpointBytes = Math.max(1, safeJsonByteLength_ACU(fullCheckpointSource));
  const cumulativeOperationBytes = safeJsonByteLength_ACU(previousOperations);
  const cumulativeOperationCount = countOperationUnits_ACU(previousOperations);

  return {
    ...(latestCheckpoint ? {
      latestCheckpointMessageIndex: latestCheckpoint.index,
      latestCheckpointAiFloor: countAiFloor_ACU(safeChat, latestCheckpoint.index),
    } : {}),
    entryCountAfterCheckpoint: previousEntries.length,
    cumulativeOperationBytes,
    cumulativeOperationCount,
    fullCheckpointBytes,
    nextWriteKind: latestCheckpoint ? 'incremental' : 'full',
    config,
  };
}

function normalizeKeys_ACU(keys: string[] | null | undefined, data?: TableDataObject_ACU): string[] {
  if (!Array.isArray(keys)) return [];
  return [...new Set(keys.filter(key => typeof key === 'string' && key.startsWith('sheet_') && (!data || Boolean(data[key]))))];
}

function collectScopedAfterDataSheetKeys_ACU(options: PersistTableMutationV2Options_ACU): string[] | null {
  const keys = new Set<string>();
  const addKeys = (values: unknown): void => {
    if (!Array.isArray(values)) return;
    values.forEach(value => {
      if (typeof value === 'string' && value.startsWith('sheet_')) keys.add(value);
    });
  };
  addKeys(options.filledSheetKeys);
  addKeys(options.candidateChangedSheetKeys);
  addKeys(options.groupKeys);
  addKeys(options.replaceExistingIncremental?.targetSheetKeys);

  for (const operation of options.operations || []) {
    if (!operation || typeof operation !== 'object') return null;
    switch (operation.kind) {
      case 'sql_sheet_batch':
      case 'row_upsert':
      case 'row_delete':
      case 'meta_update':
      case 'sheet_schema_migrate':
      case 'sheet_replace': {
        const sheetKey = operation.sheetKey;
        if (typeof sheetKey !== 'string' || !sheetKey.startsWith('sheet_')) return null;
        keys.add(sheetKey);
        break;
      }
      case 'data_replace':
      case 'sql_batch':
      case 'table_edit_dsl':
      default:
        // 未知 operation 不能因“碰巧带 sheetKey”就被推断为单表语义。
        return null;
    }
  }
  return [...keys];
}

function clonePersistAfterData_ACU(
  options: PersistTableMutationV2Options_ACU,
  requiresFullSnapshot: boolean,
): TableDataObject_ACU {
  if (requiresFullSnapshot) return deepClone_ACU(options.afterData);
  const sheetKeys = collectScopedAfterDataSheetKeys_ACU(options);
  if (sheetKeys === null) return deepClone_ACU(options.afterData);
  const projected: TableDataObject_ACU = {} as TableDataObject_ACU;
  if (Object.prototype.hasOwnProperty.call(options.afterData, 'mate')) {
    (projected as any).mate = deepClone_ACU((options.afterData as any).mate);
  }
  sheetKeys.forEach(sheetKey => {
    if (Object.prototype.hasOwnProperty.call(options.afterData, sheetKey)) {
      (projected as any)[sheetKey] = deepClone_ACU((options.afterData as any)[sheetKey]);
    }
  });
  return projected;
}

function normalizeOperations_ACU(
  operations: TableMutationOperationV2_ACU[] | null | undefined,
  afterData: TableDataObject_ACU,
  source: TableMutationSourceV2_ACU,
  allowImportDataReplaceFallback: boolean,
): TableMutationOperationV2_ACU[] {
  if (Array.isArray(operations) && operations.length > 0) {
    return deepClone_ACU(operations);
  }
  if (source === 'import' && allowImportDataReplaceFallback) {
    return [{
      kind: 'data_replace',
      data: deepClone_ACU(afterData),
      reason: 'import',
    }];
  }
  return [];
}

function getOrInitV2Frame_ACU(isolatedData: Record<string, any>, isolationKey: string): TableStorageFrameV2_ACU {
  const tagData = isolatedData[isolationKey];
  if (isV2TagData_ACU(tagData)) {
    return tagData.storageFrame;
  }

  const nextTagData: any = {
    storageFrame: {
      version: 2,
      logEntries: [],
    },
    _acu_storage_version: 2,
  };

  if (tagData?.summaryVectorIndexState !== undefined) {
    nextTagData.summaryVectorIndexState = tagData.summaryVectorIndexState;
  }
  if (tagData?.summaryVectorIndexManifest !== undefined) {
    nextTagData.summaryVectorIndexManifest = tagData.summaryVectorIndexManifest;
  }

  isolatedData[isolationKey] = nextTagData;
  return nextTagData.storageFrame;
}

function isObjectRecord_ACU(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

type TemplateCommitStorageState_ACU =
  | { kind: 'pristine_without_checkpoint' }
  | { kind: 'existing_full_checkpoint'; checkpoint: { message: any; index: number; checkpoint: TableCheckpointV2_ACU } }
  | { kind: 'legacy_persisted_data'; details: string[] }
  | { kind: 'orphan_v2_artifacts'; details: string[] }
  | {
    kind: 'template_only_root';
    checkpoint: { message: any; index: number; checkpoint: TableCheckpointV2_ACU };
    details: string[];
  };

/**
 * 判定单个 Sheet 是否为 header-only（最多表头行，不含数据行）。
 * 与 chat-service 的 isSafeHeaderOnlyResetCheckpoint_ACU 等价判定保持一致，
 * 但这里以 isObjectRecord_ACU 先做结构保护，避免畸形结构被误判为 header-only。
 */
function sheetIsHeaderOnly_ACU(sheet: unknown): boolean {
  if (!isObjectRecord_ACU(sheet)) return false;
  const content = (sheet as { content?: unknown }).content;
  if (!Array.isArray(content)) return false;
  return content.length <= 1;
}

/**
 * 判定 frame 是否携带「真实后缀 replay artifact」。
 *
 * 「真实后缀」= 不属于该 frame 自身 checkpoint 的 replay 证据：
 * - per-sheet checkpoint 带 timeline → 后续补挂的收敛锚点/rebase
 * - per-sheet checkpoint / headRevision 但该 frame 无自有 full checkpoint → 悬空 artifact
 * - intrinsic（随自有 full checkpoint 一起写入、无 timeline 的 per-sheet；
 *   自有 full checkpoint 下的 headRevision）→ 不算
 *
 * 本函数是 persist 层 template_only_root 判定（条件 6/7）与 chat-service 追平
 * preflight（hasV2ReplayArtifact_ACU）的**唯一**判定来源。两层各自实现会漂移出
 * 「persist 认为可降级、preflight 认为 blocked」的夹缝，故此处导出共用。
 */
export function frameHasSuffixReplayArtifact_ACU(frame: TableStorageFrameV2_ACU): boolean {
  if ((frame.logEntries || []).length > 0) return true;
  if (frame.manualRefillProgress !== undefined) return true;
  const hasOwnFullCheckpoint = frame.checkpoint?.kind === 'full';
  for (const checkpoint of Object.values(frame.perSheetCheckpoints || {})) {
    if (!hasOwnFullCheckpoint) return true; // 无根却有单表锚点 = 悬空 artifact
    if ((checkpoint as TableSheetCheckpointV2_ACU)?.timeline !== undefined) return true; // 补挂 = 真实后缀
  }
  const hr = frame.headRevision;
  const hasHeadRevision = hr !== undefined && hr !== null && (typeof hr !== 'string' || hr.length > 0);
  if (hasHeadRevision && !hasOwnFullCheckpoint) return true;
  return false;
}

/**
 * template_only_root 七项判定：
 * 1. 全聊天该 isolationKey 下 full checkpoint 数量恰为 1
 * 2. checkpoint.reason ∈ {'init', 'migration'}
 * 3. validateCanonicalCheckpoint_ACU(checkpoint).valid === true
 * 4. header-only：checkpoint.data 中每个 sheet_* 的 content.length <= 1
 * 5. 该 frame logEntries.length === 0
 * 6. 该 frame 的所有 perSheetCheckpoints 均为 intrinsic（无 timeline 且 data.content.length <= 1）
 * 7. 该 checkpoint 之后不存在任何携带真实后缀 artifact 的 frame
 */
function classifyAsTemplateOnlyRoot_ACU(
  chat: any[],
  isolationKey: string,
  checkpoint: { message: any; index: number; checkpoint: TableCheckpointV2_ACU },
  frame: TableStorageFrameV2_ACU,
): { kind: 'template_only_root'; checkpoint: { message: any; index: number; checkpoint: TableCheckpointV2_ACU }; details: string[] } | null {
  const details: string[] = [];
  // 条件 1：唯一 full checkpoint
  const fullIndices = collectV2FullCheckpointIndices_ACU(chat, isolationKey);
  if (fullIndices.length !== 1) {
    details.push(`full_checkpoint_count=${fullIndices.length}`);
    return null;
  }
  if (fullIndices[0] !== checkpoint.index) {
    details.push(`latest_full_checkpoint_index=${fullIndices[0]} !== ${checkpoint.index}`);
    return null;
  }
  // 条件 2：reason ∈ {init, migration}
  if (!['init', 'migration'].includes(checkpoint.checkpoint.reason)) {
    details.push(`reason=${checkpoint.checkpoint.reason}`);
    return null;
  }
  // 条件 3：canonical 校验
  if (!validateCanonicalCheckpoint_ACU(checkpoint.checkpoint).valid) {
    details.push('canonical_invalid');
    return null;
  }
  // 条件 4：checkpoint.data header-only
  const data = checkpoint.checkpoint.data;
  if (!isObjectRecord_ACU(data)) {
    details.push('checkpoint_data_not_object');
    return null;
  }
  const sheetKeys = Object.keys(data).filter(key => key.startsWith('sheet_'));
  if (sheetKeys.length === 0) {
    details.push('no_sheet_keys');
    return null;
  }
  if (sheetKeys.some(key => !sheetIsHeaderOnly_ACU(data[key]))) {
    details.push('checkpoint_has_data_rows');
    return null;
  }
  // 条件 5：logEntries 为空
  if (!Array.isArray(frame.logEntries) || frame.logEntries.length > 0) {
    details.push('log_entries_non_empty');
    return null;
  }
  // 条件 6：perSheetCheckpoints 全部 intrinsic
  const perSheet = frame.perSheetCheckpoints || {};
  if (!isObjectRecord_ACU(perSheet)) {
    details.push('per_sheet_checkpoints_malformed');
    return null;
  }
  for (const sheetKey of Object.keys(perSheet)) {
    const sheetCheckpoint = perSheet[sheetKey] as TableSheetCheckpointV2_ACU;
    if (!isObjectRecord_ACU(sheetCheckpoint)) {
      details.push(`per_sheet_${sheetKey}_malformed`);
      return null;
    }
    if (sheetCheckpoint.timeline !== undefined) {
      details.push(`per_sheet_${sheetKey}_has_timeline`);
      return null;
    }
    if (!sheetIsHeaderOnly_ACU(sheetCheckpoint.data)) {
      details.push(`per_sheet_${sheetKey}_has_data_rows`);
      return null;
    }
  }
  // 条件 7：该 checkpoint 之后不存在任何携带真实后缀 artifact 的 frame
  for (let index = checkpoint.index + 1; index < chat.length; index += 1) {
    const message = chat[index];
    if (!message || message.is_user) continue;
    const tagData = readIsolatedTagData_ACU(message, isolationKey) as any;
    if (!isV2TagData_ACU(tagData)) continue;
    if (frameHasSuffixReplayArtifact_ACU(tagData.storageFrame)) {
      details.push(`suffix_artifact_after_root=${index}`);
      return null;
    }
  }
  return { kind: 'template_only_root', checkpoint, details };
}

function classifyTemplateCommitStorageState_ACU(
  chat: any[],
  isolationKey: string,
): TemplateCommitStorageState_ACU {
  const legacyDetails: string[] = [];
  const v2FrameWithoutCheckpointDetails: string[] = [];
  const orphanDetails: string[] = [];
  let latestCheckpoint: { message: any; index: number; checkpoint: TableCheckpointV2_ACU } | null = null;
  const isolationConfig = {
    enabled: settings_ACU.dataIsolationEnabled,
    code: settings_ACU.dataIsolationCode,
  };

  for (let index = 0; index < chat.length; index += 1) {
    const message = chat[index];
    if (!message || message.is_user) continue;
    const tagData = readIsolatedTagData_ACU(message, isolationKey) as any;
    if (isLegacyV1TagData_ACU(tagData) || hasLegacyTopLevelTableData_ACU(message, isolationConfig)) {
      legacyDetails.push(`message#${index}`);
      continue;
    }
    if (isV2TagData_ACU(tagData)) {
      if (tagData.storageFrame.checkpoint?.kind === 'full') {
        latestCheckpoint = { message, index, checkpoint: tagData.storageFrame.checkpoint };
      } else {
        v2FrameWithoutCheckpointDetails.push(`message#${index}: V2 storage frame has no full checkpoint`);
      }
      continue;
    }
    if (hasV2HistoryMarker_ACU(tagData)) {
      orphanDetails.push(`message#${index}: malformed V2 storage marker`);
    }
  }

  if (legacyDetails.length > 0) return { kind: 'legacy_persisted_data', details: legacyDetails };
  if (latestCheckpoint) {
    // 只保留“最新”的 full checkpoint 作为候选：若存在多个，classifyAsTemplateOnlyRoot_ACU
    // 会在条件 1（唯一性）拒绝，从而维持 existing_full_checkpoint 语义。
    const isolatedContainer = readIsolatedDataContainer_ACU(latestCheckpoint.message);
    const frame = isolatedContainer?.[isolationKey]?.storageFrame;
    if (isObjectRecord_ACU(frame)) {
      const templateOnlyRoot = classifyAsTemplateOnlyRoot_ACU(chat, isolationKey, latestCheckpoint, frame);
      if (templateOnlyRoot) return templateOnlyRoot;
    }
    return { kind: 'existing_full_checkpoint', checkpoint: latestCheckpoint };
  }
  if (v2FrameWithoutCheckpointDetails.length > 0) {
    return { kind: 'orphan_v2_artifacts', details: [...v2FrameWithoutCheckpointDetails, ...orphanDetails] };
  }
  if (orphanDetails.length > 0) return { kind: 'orphan_v2_artifacts', details: orphanDetails };
  return { kind: 'pristine_without_checkpoint' };
}

function classifyTemplateCommitStorageStateAfterDeletedSheets_ACU(
  chat: any[],
  isolationKey: string,
  deletedSheetKeys: string[],
): TemplateCommitStorageState_ACU {
  if (deletedSheetKeys.length === 0) return classifyTemplateCommitStorageState_ACU(chat, isolationKey);
  const simulatedChat = deepClone_ACU(chat);
  for (const message of simulatedChat) {
    if (message && !message.is_user) purgeSheetKeysFromMessage_ACU(message, deletedSheetKeys);
  }
  return classifyTemplateCommitStorageState_ACU(simulatedChat, isolationKey);
}

/**
 * 将「template_only_root」降级为 scope-only 状态。
 *
 * 背景：旧版 V2 可视化编辑器在 pristine 会话中无条件写 full checkpoint（header-only），
 * 在聊天末尾立起回放根，导致后续追平撞上「write target precedes the latest full checkpoint」
 * fail-fast（F2）。Task 1 只防新增，本函数修复既存：把这种可证明安全的 header-only init/migration
 * 根从聊天中移除，恢复为无 checkpoint 的 scope-only 拓扑。
 *
 * 安全性保障：
 * - 仅当 classifyTemplateCommitStorageState_ACU 判定为 template_only_root（7 项条件全满足）才执行
 * - 降级前后做 replay 指纹比对（fail-closed）：降级后每张表的 content 必须与原 checkpoint header-only
 *   content 等价，不等价则拒绝、零写入
 * - 原 frame 完整备份到 recoveryBackup（recoveryKind: 'demoted_template_only_root'）
 * - saveChatToHostStrict_ACU 失败则完整还原内存并返回失败
 *
 * 返回值契约（调用方必须依赖字段，不得匹配 reason 文案）：
 * - { ok: true, demoted: true }
 *     确实存在可降级 root 且已移除并落盘。
 * - { ok: false, demoted: false, noReplayRoot: true }
 *     聊天中不存在 full checkpoint（空聊天 / pristine / 悬空 artifact），
 *     replay 无根，结构零冲突。降级无事可做，**不构成任何写入阻断理由**：
 *     调用方应继续 scope-only 提交（scope-only 本身不写 storage frame）。
 * - { ok: false, demoted: false, noReplayRoot 缺省/false }
 *     聊天中存在回放根但无法安全移除，或状态危险（真实数据根 / legacy 漂移）。
 *     残留根会在 replay 中重建旧结构、与新模板 scope 冲突，
 *     调用方必须 fail-closed 中止，零写入。
 *
 * 注意：本函数是「机会性清理」，不是保存的前置条件。禁止调用方把
 * 「降级没做成」等同于「保存不允许」——那会让最正常的 pristine 会话
 * 永久无法保存模板（历史缺陷即此）。
 */
export async function demoteTemplateOnlyRootToScopeOnly_ACU(options: {
  isolationKey?: string;
  requestId?: string;
} = {}): Promise<{ ok: boolean; reason?: string; demoted?: boolean; noReplayRoot?: boolean }> {
  const isolationKey = options.isolationKey ?? getCurrentIsolationKey_ACU();
  try {
    return await runTableWriteTransaction_ACU({
      source: 'system_cleanup',
      reason: 'demoteTemplateOnlyRootToScopeOnly',
      isolationKey,
      writeSet: [{ kind: 'all' }],
      maintenanceMode: 'exclusive',
    }, async () => {
      const chat = getChatArray_ACU();
      if (!Array.isArray(chat) || chat.length === 0) {
        // 空聊天没有任何 frame，replay 无根：属「无需清理」，不是失败。
        return {
          ok: false,
          demoted: false,
          noReplayRoot: true,
          reason: '聊天记录为空，不存在任何回放根，无需降级。',
        };
      }
      const storageState = classifyTemplateCommitStorageState_ACU(chat, isolationKey);
      if (storageState.kind !== 'template_only_root') {
        // 判据是「聊天里有没有 full checkpoint（回放根）」，不是「降级动作是否适用」：
        // - 无根 → replay 退化为模板临时基线，scope-only 不写 frame，结构零冲突 → 放行
        // - 有根但不可安全移除 → 残留根会重建旧结构 → fail-closed
        const noReplayRoot = storageState.kind === 'pristine_without_checkpoint'
          || storageState.kind === 'orphan_v2_artifacts';
        if (storageState.kind === 'orphan_v2_artifacts') {
          // 悬空 artifact 不阻止模板保存（无 full checkpoint，scope-only 不写 frame），
          // 但会让后续追平 preflight blocked，留痕以便事故复盘。
          logWarn_ACU(`[V2 Persist] 无回放根可降级，但检测到悬空 V2 artifact: isolationKey=${isolationKey}, details=${storageState.details.join(', ')}。`);
        }
        return {
          ok: false,
          demoted: false,
          noReplayRoot,
          reason: storageState.kind === 'existing_full_checkpoint'
            ? '检测到含真实数据或后缀 artifact 的 full checkpoint，无法安全移除回放根，拒绝降级，零写入。'
            : storageState.kind === 'legacy_persisted_data'
              ? `检测到 legacy 表格数据（${storageState.details.join(', ')}）与 pristine 判定冲突，拒绝降级，零写入。`
              : `当前状态为 ${storageState.kind}，不存在需要降级的回放根。`,
        };
      }

      const { message: rootMessage, index: rootIndex, checkpoint: rootCheckpoint } = storageState.checkpoint;
      const isolatedContainer = readIsolatedDataContainer_ACU(rootMessage) || {};
      const tagData = isolatedContainer[isolationKey] as any;
      if (!isV2TagData_ACU(tagData) || !isObjectRecord_ACU(tagData.storageFrame)) {
        return { ok: false, demoted: false, reason: 'template_only_root 帧结构异常，拒绝降级，零写入。' };
      }
      const sourceFrame = tagData.storageFrame as TableStorageFrameV2_ACU;
      const backupFrame = deepClone_ACU(sourceFrame);

      // 构造候选聊天：移除该 frame 的 checkpoint / perSheetCheckpoints / headRevision。
      const candidateChat = deepClone_ACU(chat);
      const candidateContainer = readIsolatedDataContainer_ACU(candidateChat[rootIndex]) || {};
      // 写 recoveryBackup 必须放在「整条移除」判空之前：正常路径 frame 降级为
      // {version:2, logEntries:[]} 标准空帧（tagData 保留，backup 随 tagData 落盘）；
      // 仅畸形空壳（连 logEntries 都没有）才在下方整条移除 tagData，此时 backup 无处
      // 安放，fail-closed 拒绝降级。先写 backup 消除对判空顺序的依赖。
      const backupTagData = candidateContainer[isolationKey];
      if (!backupTagData || typeof backupTagData !== 'object' || !isObjectRecord_ACU(backupTagData.storageFrame)) {
        return { ok: false, demoted: false, reason: 'template_only_root 降级候选 tagData 缺失，拒绝写入，零写入。' };
      }
      backupTagData.recoveryBackup = {
        version: 1,
        createdAt: Date.now(),
        recoveryKind: 'demoted_template_only_root',
        sourceMessageIndex: rootIndex,
        storageFrame: backupFrame,
      } satisfies TableV2RecoveryBackup_ACU;
      const candidateTagData = candidateContainer[isolationKey] as any;
      if (!isV2TagData_ACU(candidateTagData) || !isObjectRecord_ACU(candidateTagData.storageFrame)) {
        return { ok: false, demoted: false, reason: 'template_only_root 候选帧结构异常，拒绝降级，零写入。' };
      }
      const candidateFrame = candidateTagData.storageFrame as TableStorageFrameV2_ACU;
      delete candidateFrame.checkpoint;
      delete candidateFrame.perSheetCheckpoints;
      delete candidateFrame.headRevision;
      const candidateRemainingKeys = Object.keys(candidateFrame);
      const candidateIsEmptyFrame = candidateRemainingKeys.length === 0
        || (candidateRemainingKeys.length === 1 && candidateRemainingKeys[0] === 'version');
      if (candidateIsEmptyFrame) {
        delete candidateContainer[isolationKey];
        if (Object.keys(candidateContainer).length === 0) delete candidateChat[rootIndex].TavernDB_ACU_IsolatedData;
        else candidateChat[rootIndex].TavernDB_ACU_IsolatedData = candidateContainer;
      } else {
        candidateChat[rootIndex].TavernDB_ACU_IsolatedData = candidateContainer;
      }

      // 降级后候选回放结果。
      // 正常降级形态的候选帧是干净空帧（{version:2, logEntries:[]}）：
      // hasUnanchoredReplayArtifacts_ACU 判定为 false，replay 引擎在
      // storage-frame-v2-replay.ts 直接返回 null（连 temporary baseline 分支都到不了）。
      // 此时回退到 resolveHeaderOnlyTemplateSnapshot_ACU —— 降级后聊天无 full
      // checkpoint，模板临时基线（scope/全局模板派生）正是其唯一结构来源，
      // 与计划「候选回放退化为模板临时基线」的口径一致。
      // 异常候选（replay 实际产出兼容修复）仍 fail-closed，不回退。
      let replayAfter;
      try {
        replayAfter = await loadTableStateFromFramesV2Detailed_ACU(candidateChat, isolationKey, {
          updateRuntimeState: false,
          compatibilityMode: 'disabled',
        });
      } catch (error: any) {
        return { ok: false, demoted: false, reason: `template_only_root 降级后候选 replay 校验失败：${error?.message || String(error)}` };
      }
      if (!replayAfter) {
        const templateBaseline = resolveHeaderOnlyTemplateSnapshot_ACU(chat, isolationKey);
        if (!templateBaseline) {
          return { ok: false, demoted: false, reason: 'template_only_root 降级后候选 replay 无法校验，且当前模板基线不可得，拒绝降级，零写入。' };
        }
        replayAfter = { data: templateBaseline, baseKind: 'temporary_template_baseline' };
      }
      if (replayAfter.requiresCheckpointConvergence || replayAfter.compatibilityRepairs?.length) {
        return { ok: false, demoted: false, reason: 'template_only_root 降级后候选 replay 仍依赖兼容修复，拒绝降级，零写入。' };
      }

      // 指纹比对（fail-closed）：候选回放的每张表 content 必须与原 checkpoint 的
      // header-only content 等价。降级后无 full checkpoint，回放退化为模板临时基线
      // （resolveHeaderOnlyTemplateSnapshot_ACU 由 guide 派生），因此不能拿“降级前
      // replay vs 降级后 replay”直接比（两者来源不同）；正确口径是候选回放的 content
      // 逐表与原 checkpoint 的 header-only 结构投影等价。投影只保留表集合与作用域
      // 结构字段（uid/name/orderNo/表头行/DDL 物理列），排除 updateConfig、
      // exportConfig、sourceData.note 等非结构配置——仅改配置不再被误报为结构
      // 不一致（P0 缺陷修复）。
      const afterFingerprint = getTableDataFingerprint_ACU(projectHeaderOnlyReplayComparableData_ACU(replayAfter.data));
      const expectedFingerprint = getTableDataFingerprint_ACU(projectHeaderOnlyReplayComparableData_ACU(rootCheckpoint.data as TableDataObject_ACU));
      if (afterFingerprint !== expectedFingerprint) {
        const diffDetails = diffHeaderOnlyReplayStructures_ACU(rootCheckpoint.data as TableDataObject_ACU, replayAfter.data);
        const detailText = diffDetails.length > 0 ? `（${diffDetails.join('; ')}）` : '';
        return { ok: false, demoted: false, reason: `template_only_root 降级后候选 replay 与原 checkpoint 表结构不一致，已拒绝写入；请先执行 V2 恢复诊断。${detailText}` };
      }

      // 真实写回：直接应用候选的最终容器形态，避免在真实对象上重复判空造成双写不一致。
      // 正常路径（frame 降级为 {version:2, logEntries:[]} 标准空帧）保留 tagData，
      // recoveryBackup 随 tagData 一起落盘；仅畸形空壳才整条移除 tagData。
      const candidateFinalContainer = candidateChat[rootIndex].TavernDB_ACU_IsolatedData;
      if (candidateFinalContainer === undefined) delete rootMessage.TavernDB_ACU_IsolatedData;
      else rootMessage.TavernDB_ACU_IsolatedData = candidateFinalContainer;
      writeMessageIdentity_ACU(rootMessage, {
        enabled: settings_ACU.dataIsolationEnabled,
        code: settings_ACU.dataIsolationCode,
      });

      logDebug_ACU(`[V2 Persist] template_only_root 降级完成: requestId=${options.requestId || 'unknown'}, rootIndex=${rootIndex}, reason=${rootCheckpoint.reason}, fingerprint=${afterFingerprint}。`);
      await saveChatToHostStrict_ACU();
      return { ok: true, demoted: true };
    });
  } catch (error: any) {
    return { ok: false, demoted: false, reason: error?.message || String(error) };
  }
}



function isPlainObjectRecord_ACU(value: unknown): value is Record<string, any> {
  if (!isObjectRecord_ACU(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function logEntryConflictsWithSheetCheckpoint_ACU(entry: TableMutationLogEntryV2_ACU, sheetKey: string): boolean {
  if ([...(entry.filledSheetKeys || []), ...(entry.changedSheetKeys || []), ...(entry.groupKeys || [])].includes(sheetKey)) {
    return true;
  }

  for (const operation of entry.operations || []) {
    if (operation.kind === 'data_replace' || operation.kind === 'sql_batch' || operation.kind === 'table_edit_dsl') {
      return true;
    }
    if ('sheetKey' in operation && operation.sheetKey === sheetKey) {
      return true;
    }
  }

  return (entry.patches || []).some(patch => patch.sheetKey === sheetKey);
}

function getValidatedFrameLastLogSeq_ACU(frame: TableStorageFrameV2_ACU): number {
  let previousSeq = -1;
  for (const [index, entry] of frame.logEntries.entries()) {
    const seq = entry?.seq;
    if (!Number.isInteger(seq) || seq < 0) {
      throw new Error(`V2 当前楼层模板提交包含非法 log seq: index=${index}, seq=${String(seq)}。`);
    }
    if (seq <= previousSeq) {
      throw new Error(`V2 当前楼层模板提交要求 log seq 唯一且严格递增: previous=${previousSeq}, current=${seq}。`);
    }
    previousSeq = seq;
  }
  return Math.max(0, previousSeq);
}

function checkpointDataContainsSheet_ACU(checkpoint: TableCheckpointV2_ACU | null | undefined, sheetKey: string): boolean {
  return Boolean(checkpoint?.data && Object.prototype.hasOwnProperty.call(checkpoint.data, sheetKey));
}

function recordContainsSheet_ACU(value: unknown, sheetKey: string): boolean {
  return isObjectRecord_ACU(value) && Object.prototype.hasOwnProperty.call(value, sheetKey);
}

function hasV2HistoryMarker_ACU(tagData: unknown): boolean {
  return hasV2TableHistoryEvidence_ACU(tagData);
}

const CHECKPOINT_REASONS_FOR_INTRODUCTION_HISTORY_ACU = new Set([
  'init', 'periodic', 'manual', 'schema_change', 'compaction', 'import', 'migration', 'integrity_repair',
]);

function isFiniteNonNegativeNumber_ACU(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isFiniteNonNegativeInteger_ACU(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

/**
 * 结构性全局 replay operation：按类型定义就没有 sheetKey
 * （TableSqlBatchOperationV2_ACU / TableEditDslOperationV2_ACU）。
 *
 * 它们对"目标表是否存在过"既不能证明也不能证伪，属于归属未知，
 * 必须与"scoped kind 缺 sheetKey"（真结构畸形）区分开。
 */
const HISTORY_GLOBAL_ARTIFACT_KINDS_ACU = new Set<string>(['sql_batch', 'table_edit_dsl']);

function isStringArray_ACU(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function eventIsValidForIntroductionHistory_ACU(value: unknown): boolean {
  return value === undefined || (
    isObjectRecord_ACU(value)
    && isStringArray_ACU(value.filledSheetKeys)
    && isStringArray_ACU(value.changedSheetKeys)
    && (value.groupKeys === undefined || isStringArray_ACU(value.groupKeys))
    && (value.requestId === undefined || typeof value.requestId === 'string')
    && (value.batchId === undefined || typeof value.batchId === 'string')
    && (value.error === undefined || typeof value.error === 'string')
  );
}

function scheduleSummaryIsValidForIntroductionHistory_ACU(value: unknown): boolean {
  return value === undefined || (
    isObjectRecord_ACU(value)
    && Object.values(value).every(summary => isObjectRecord_ACU(summary)
      && (summary.lastFilledAiFloor === undefined || isFiniteNonNegativeNumber_ACU(summary.lastFilledAiFloor))
      && (summary.lastChangedAiFloor === undefined || isFiniteNonNegativeNumber_ACU(summary.lastChangedAiFloor)))
  );
}

function manualRefillProgressIsValidForIntroductionHistory_ACU(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isObjectRecord_ACU(value) || value.kind !== 'manual_refill') return false;
  const legacyStatus = value.status === 'in_progress' || value.status === 'complete';
  const commonFieldsAreValid = isStringArray_ACU(value.selectedSheetKeys)
    && Array.isArray(value.contextMessageIndices) && value.contextMessageIndices.every(Number.isInteger)
    && ['originalStartMessageIndex', 'targetMessageIndex', 'batchSize', 'completedUntilMessageIndex', 'updatedAt']
      .every(key => isFiniteNonNegativeNumber_ACU(value[key]))
    && (value.completedSheetMessageIndexByKey === undefined || (
      isObjectRecord_ACU(value.completedSheetMessageIndexByKey)
      && Object.values(value.completedSheetMessageIndexByKey).every(Number.isInteger)
    ));
  if (!commonFieldsAreValid) return false;
  if (value.version === undefined) return legacyStatus;
  return value.version === 2
    && ['planned', 'collecting', 'committing', 'committed', 'stopped', 'failed', 'sync_pending', 'complete'].includes(value.status)
    && typeof value.runId === 'string' && value.runId.length > 0
    && (value.mode === 'refill' || value.mode === 'catch_up')
    && isFiniteNonNegativeNumber_ACU(value.targetAiFloor)
    && typeof value.planSignature === 'string'
    && ['waveIndex', 'bucketIndex', 'totalWaves', 'totalBuckets'].every(key => isFiniteNonNegativeInteger_ACU(value[key]))
    && (value.lastError === undefined || typeof value.lastError === 'string');
}

function timelineIsValidForIntroductionHistory_ACU(value: unknown): boolean {
  return value === undefined || (
    isObjectRecord_ACU(value)
    && (value.kind === 'sheet_introduction' || value.kind === 'sheet_rebase'
      || value.kind === 'sheet_reveal' || value.kind === 'sheet_hide')
    && Number.isInteger(value.activateAtMessageIndex) && value.activateAtMessageIndex >= 0
    && Number.isInteger(value.afterSeq) && value.afterSeq >= 0
  );
}

function sheetIsValidForIntroductionHistory_ACU(value: unknown): boolean {
  return isObjectRecord_ACU(value)
    && typeof value.uid === 'string'
    && typeof value.name === 'string'
    && isObjectRecord_ACU(value.sourceData)
    && Array.isArray(value.content)
    && value.content.every(row => Array.isArray(row) && row.every(cell => cell === null || typeof cell === 'string'))
    && isObjectRecord_ACU(value.updateConfig)
    && isObjectRecord_ACU(value.exportConfig)
    && typeof value.orderNo === 'number' && Number.isFinite(value.orderNo);
}

function schemaDescriptorIsValidForIntroductionHistory_ACU(value: unknown, version: 1 | 2): boolean {
  if (!isObjectRecord_ACU(value)
    || value.descriptorVersion !== version
    || !['uid', 'tableName', 'ddl', 'normalizedSql', 'tableSuffix'].every(key => typeof value[key] === 'string')
    || !Array.isArray(value.headers) || !value.headers.every(header => header === null || typeof header === 'string')
    || !isStringArray_ACU(value.tableConstraints)
    || !Array.isArray(value.columns)
  ) return false;

  return value.columns.every(column => isObjectRecord_ACU(column)
    && isFiniteNonNegativeInteger_ACU(column.index)
    && ['physicalName', 'displayHeader', 'normalizedDefinition'].every(key => typeof column[key] === 'string')
    && (version === 1 || column.defaultExpression === null || typeof column.defaultExpression === 'string'));
}

function migrationIsValidForIntroductionHistory_ACU(operation: Record<string, any>): boolean {
  if (typeof operation.sheetKey !== 'string'
    || ![1, 2].includes(operation.contractVersion)
    || typeof operation.beforeSchemaDigest !== 'string'
    || typeof operation.targetSchemaDigest !== 'string'
    || !schemaDescriptorIsValidForIntroductionHistory_ACU(operation.beforeSchema, operation.contractVersion)
    || !schemaDescriptorIsValidForIntroductionHistory_ACU(operation.targetSchema, operation.contractVersion)
  ) return false;

  if (operation.contractVersion === 1) {
    return Array.isArray(operation.columnChanges)
      && operation.columnChanges.every(change => isObjectRecord_ACU(change)
        && ['rename_display', 'add', 'drop'].includes(change.kind)
        && typeof change.physicalName === 'string'
        && ((change.kind === 'rename_display' && typeof change.fromHeader === 'string' && typeof change.toHeader === 'string')
          || (change.kind === 'add' && typeof change.header === 'string' && isFiniteNonNegativeInteger_ACU(change.index))
          || (change.kind === 'drop' && typeof change.header === 'string' && isFiniteNonNegativeInteger_ACU(change.index))))
      && isObjectRecord_ACU(operation.migrationPolicy)
      && typeof operation.migrationPolicy.destructiveChangeConfirmed === 'boolean';
  }

  return Array.isArray(operation.physicalColumnMappings)
    && operation.physicalColumnMappings.every(mapping => isObjectRecord_ACU(mapping)
      && typeof mapping.fromPhysicalName === 'string' && typeof mapping.toPhysicalName === 'string')
    && isObjectRecord_ACU(operation.fills)
    && Array.isArray(operation.conversions)
    && operation.conversions.every(conversion => isObjectRecord_ACU(conversion)
      && typeof conversion.fromPhysicalName === 'string'
      && typeof conversion.toPhysicalName === 'string'
      && isObjectRecord_ACU(conversion.policy)
      && ['identity', 'stringify', 'integer_strict', 'real_strict'].includes(conversion.policy.kind))
    && isObjectRecord_ACU(operation.dryRun)
    && ['convertedRowCount', 'failedRowCount', 'lossyRowCount'].every(key => isFiniteNonNegativeInteger_ACU(operation.dryRun[key]))
    && isObjectRecord_ACU(operation.migrationPolicy)
    && typeof operation.migrationPolicy.destructiveChangeConfirmed === 'boolean'
    && typeof operation.migrationPolicy.lossyConversionConfirmed === 'boolean';
}

function logEntryIsValidForIntroductionHistory_ACU(value: unknown): value is Record<string, any> {
  // 只校验容器可遍历性。这个判定回答的问题是"能否从这条 entry 读出目标表证据"，
  // 而 seq / entryId / createdAt / source / aiFloor / revision 等 envelope 字段
  // 与"目标表是否存在过"无关：用无关字段的畸形去否定目标表的存在性判断，会让
  // 一条坏 entry 永久污染该 isolationKey 下所有表的 evidence（现场 reason 只是
  // 换个字符串）。envelope 字段改由诊断日志记录，不参与 fail-closed。
  return isObjectRecord_ACU(value)
    && Array.isArray(value.operations)
    && (value.patches === undefined || Array.isArray(value.patches));
}

function checkpointIsValidForIntroductionHistory_ACU(value: unknown): value is TableCheckpointV2_ACU {
  return isObjectRecord_ACU(value)
    && value.kind === 'full'
    && isFiniteNonNegativeNumber_ACU(value.createdAt)
    && typeof value.reason === 'string' && CHECKPOINT_REASONS_FOR_INTRODUCTION_HISTORY_ACU.has(value.reason)
    && isObjectRecord_ACU(value.data)
    && scheduleSummaryIsValidForIntroductionHistory_ACU(value.scheduleSummary)
    && eventIsValidForIntroductionHistory_ACU(value.event)
    && manualRefillProgressIsValidForIntroductionHistory_ACU(value.manualRefillProgress);
}

function sheetCheckpointMapIsValidForIntroductionHistory_ACU(value: unknown): value is Record<string, TableSheetCheckpointV2_ACU> {
  return isObjectRecord_ACU(value)
    && Object.entries(value).every(([sheetKey, checkpoint]) => (
      sheetKey.startsWith('sheet_')
      && isObjectRecord_ACU(checkpoint)
      && checkpoint.kind === 'sheet_full'
      && checkpoint.sheetKey === sheetKey
      && isFiniteNonNegativeNumber_ACU(checkpoint.createdAt)
      && typeof checkpoint.reason === 'string' && CHECKPOINT_REASONS_FOR_INTRODUCTION_HISTORY_ACU.has(checkpoint.reason)
      && isObjectRecord_ACU(checkpoint.data)
      && scheduleSummaryIsValidForIntroductionHistory_ACU(checkpoint.scheduleSummary)
      && eventIsValidForIntroductionHistory_ACU(checkpoint.event)
      && manualRefillProgressIsValidForIntroductionHistory_ACU(checkpoint.manualRefillProgress)
      && (checkpoint.baseRevision === undefined || checkpoint.baseRevision === null || typeof checkpoint.baseRevision === 'string')
      && timelineIsValidForIntroductionHistory_ACU(checkpoint.timeline)
    ));
}

function operationContainsOrCannotDisproveSheet_ACU(operation: unknown, sheetKey: string): boolean {
  if (!isObjectRecord_ACU(operation)) return true;
  switch (operation.kind) {
    case 'data_replace':
      return !isObjectRecord_ACU(operation.data) || recordContainsSheet_ACU(operation.data, sheetKey);
    case 'sql_sheet_batch':
      return typeof operation.sheetKey !== 'string'
        || !isStringArray_ACU(operation.statements)
        || (operation.params !== undefined && (!Array.isArray(operation.params)
          || !operation.params.every(params => Array.isArray(params)
            && params.every(value => value === null || typeof value === 'string' || typeof value === 'number'))))
        || (operation.tableName !== undefined && typeof operation.tableName !== 'string')
        || (operation.reason !== undefined && !['manual_crud', 'import', 'system'].includes(operation.reason))
        || operation.sheetKey === sheetKey;
    case 'sheet_replace':
      return typeof operation.sheetKey !== 'string'
        || !sheetIsValidForIntroductionHistory_ACU(operation.sheet)
        || !['manual_crud', 'import', 'system'].includes(operation.reason)
        || operation.sheetKey === sheetKey;
    case 'sheet_schema_migrate':
      return !migrationIsValidForIntroductionHistory_ACU(operation) || operation.sheetKey === sheetKey;
    case 'row_upsert':
      return typeof operation.sheetKey !== 'string'
        || typeof operation.rowId !== 'string'
        || !Array.isArray(operation.cells) || !operation.cells.every(value => value === null || typeof value === 'string')
        || operation.sheetKey === sheetKey;
    case 'row_delete':
      return typeof operation.sheetKey !== 'string'
        || typeof operation.rowId !== 'string'
        || operation.sheetKey === sheetKey;
    case 'meta_update':
      return typeof operation.sheetKey !== 'string'
        || !isObjectRecord_ACU(operation.meta)
        || operation.sheetKey === sheetKey;
    // sql_batch and table_edit_dsl are global replay operations; all unknown
    // kinds are future or malformed persisted contracts and must fail closed.
    default:
      return true;
  }
}

function patchContainsOrCannotDisproveSheet_ACU(patch: unknown, sheetKey: string): boolean {
  if (!isObjectRecord_ACU(patch)) return true;
  switch (patch.kind) {
    case 'sheet_replace':
      return typeof patch.sheetKey !== 'string'
        || !sheetIsValidForIntroductionHistory_ACU(patch.sheet)
        || !['schema_change', 'unstable_row_id', 'raw_sql_export', 'import', 'fallback'].includes(patch.reason)
        || patch.sheetKey === sheetKey;
    case 'row_upsert':
      return typeof patch.sheetKey !== 'string'
        || typeof patch.rowId !== 'string'
        || !Array.isArray(patch.cells) || !patch.cells.every(value => value === null || typeof value === 'string')
        || patch.sheetKey === sheetKey;
    case 'row_delete':
      return typeof patch.sheetKey !== 'string'
        || typeof patch.rowId !== 'string'
        || patch.sheetKey === sheetKey;
    case 'meta_update':
      return typeof patch.sheetKey !== 'string'
        || !isObjectRecord_ACU(patch.meta)
        || patch.sheetKey === sheetKey;
    default:
      return true;
  }
}

/**
 * Introduction shards can only represent genuinely new tables. This scans the
 * persisted V2 history rather than trusting the final replay state, because a
 * later data_replace may have removed a table that existed earlier.
 */
type IntroductionHistoryEvidence_ACU = {
  /**
   * - present：历史里有归属目标表的可验证证据，表确实存在过。
   * - absent：历史可完整证伪，目标表从未存在。
   * - may_exist：仅存在归属未知的全局 artifact（sql_batch / table_edit_dsl），
   *   既不能证明也不能证伪。调用方须按"可能存在过"处理，不得直接当作全新表。
   * - indeterminate：归属指向目标表但结构畸形，或未知 kind / 容器不可遍历，
   *   仍保持 fail-closed。
   */
  status: 'absent' | 'present' | 'indeterminate' | 'may_exist';
  sheetKey: string;
  messageIndex?: number;
  artifactKind?: 'frame' | 'checkpoint' | 'per_sheet_checkpoint' | 'operation' | 'patch';
  reason?: string;
};

function introductionHistoryEvidence_ACU(
  chat: any[],
  isolationKey: string,
  maxMessageIndex: number,
  sheetKey: string,
): IntroductionHistoryEvidence_ACU {
  const absent = (): IntroductionHistoryEvidence_ACU => ({ status: 'absent', sheetKey });
  const present = (messageIndex: number, artifactKind: IntroductionHistoryEvidence_ACU['artifactKind']): IntroductionHistoryEvidence_ACU => (
    { status: 'present', sheetKey, messageIndex, artifactKind }
  );
  const indeterminate = (
    messageIndex: number,
    artifactKind: IntroductionHistoryEvidence_ACU['artifactKind'],
    reason: string,
  ): IntroductionHistoryEvidence_ACU => ({ status: 'indeterminate', sheetKey, messageIndex, artifactKind, reason });
  // 归属未知的全局 artifact 不再让扫描立即失败：记录首次出现位置后继续向后扫描，
  // 因为更晚的楼层仍可能给出确定结论（present / absent）。
  let firstUnattributableGlobal: { messageIndex: number; artifactKind: IntroductionHistoryEvidence_ACU['artifactKind'] } | null = null;
  const noteUnattributableGlobal = (
    messageIndex: number,
    artifactKind: IntroductionHistoryEvidence_ACU['artifactKind'],
  ): void => {
    if (firstUnattributableGlobal === null) firstUnattributableGlobal = { messageIndex, artifactKind };
  };

  for (let messageIndex = 0; messageIndex <= maxMessageIndex; messageIndex += 1) {
    const rawIsolatedData = chat[messageIndex]?.TavernDB_ACU_IsolatedData;
    const isolatedDataFieldType = rawIsolatedData === undefined || rawIsolatedData === null
      ? 'absent'
      : typeof rawIsolatedData === 'string'
        ? 'string'
        : isObjectRecord_ACU(rawIsolatedData)
          ? 'object'
          : 'invalid';
    logDebug_ACU(`[V2 Persist] introduction_history_evidence_field_type: messageIndex=${messageIndex},isolatedDataFieldType=${isolatedDataFieldType}`);
    if (isolatedDataFieldType !== 'object') {
      logWarn_ACU(`[V2 Persist] introduction_history_evidence_field_type_unusual: messageIndex=${messageIndex}, isolatedDataFieldType=${isolatedDataFieldType}`);
    }
    const tagData = readIsolatedTagData_ACU(chat[messageIndex], isolationKey);
    if (!hasV2HistoryMarker_ACU(tagData)) continue;

    const frame = tagData.storageFrame as unknown;
    if (!isObjectRecord_ACU(frame) || frame.version !== 2 || !Array.isArray(frame.logEntries)) {
      return indeterminate(messageIndex, 'frame', 'V2 storage frame 无法解析');
    }
    if (frame.checkpoint !== undefined && !checkpointIsValidForIntroductionHistory_ACU(frame.checkpoint)) {
      return indeterminate(messageIndex, 'checkpoint', 'full checkpoint 无法验证');
    }
    if (checkpointDataContainsSheet_ACU(frame.checkpoint, sheetKey)) return present(messageIndex, 'checkpoint');
    if (frame.perSheetCheckpoints !== undefined && !isObjectRecord_ACU(frame.perSheetCheckpoints)) {
      return indeterminate(messageIndex, 'per_sheet_checkpoint', 'per-sheet checkpoint map 无法解析');
    }
    if (recordContainsSheet_ACU(frame.perSheetCheckpoints, sheetKey)) {
      const checkpoint = (frame.perSheetCheckpoints as Record<string, unknown>)[sheetKey];
      if (!sheetCheckpointMapIsValidForIntroductionHistory_ACU({ [sheetKey]: checkpoint })) {
        return indeterminate(messageIndex, 'per_sheet_checkpoint', '目标 sheet checkpoint 无法验证');
      }
      return present(messageIndex, 'per_sheet_checkpoint');
    }

    for (const entry of frame.logEntries) {
      if (!logEntryIsValidForIntroductionHistory_ACU(entry)) {
        logWarn_ACU(`[V2 Persist] introduction_history_entry_invalid: messageIndex=${messageIndex}, entrySeq=${String((entry as any)?.seq)}`);
        return indeterminate(messageIndex, 'operation', 'mutation log entry 无法验证');
      }

      for (const [operationIndex, operation] of entry.operations.entries()) {
        const operationEvidence = scopedHistoryArtifactEvidence_ACU(operation, sheetKey, operationContainsOrCannotDisproveSheet_ACU);
        if (operationEvidence === 'present') return present(messageIndex, 'operation');
        if (operationEvidence === 'unattributable_global') {
          noteUnattributableGlobal(messageIndex, 'operation');
          continue;
        }
        if (operationEvidence === 'indeterminate') {
          logWarn_ACU(`[V2 Persist] introduction_history_operation_indeterminate: messageIndex=${messageIndex}, entrySeq=${String(entry.seq)}, operationIndex=${operationIndex}`);
          return indeterminate(messageIndex, 'operation', '目标相关 operation 无法验证');
        }
      }

      if (entry.patches === undefined) continue;
      if (!Array.isArray(entry.patches)) return indeterminate(messageIndex, 'patch', 'patch 列表无法解析');
      for (const [patchIndex, patch] of entry.patches.entries()) {
        const patchEvidence = scopedHistoryArtifactEvidence_ACU(patch, sheetKey, patchContainsOrCannotDisproveSheet_ACU);
        if (patchEvidence === 'present') return present(messageIndex, 'patch');
        if (patchEvidence === 'unattributable_global') {
          noteUnattributableGlobal(messageIndex, 'patch');
          continue;
        }
        if (patchEvidence === 'indeterminate') {
          logWarn_ACU(`[V2 Persist] introduction_history_patch_indeterminate: messageIndex=${messageIndex}, entrySeq=${String(entry.seq)}, patchIndex=${patchIndex}`);
          return indeterminate(messageIndex, 'patch', '目标相关 patch 无法验证');
        }
      }
    }
  }
  if (firstUnattributableGlobal !== null) {
    const note = firstUnattributableGlobal as { messageIndex: number; artifactKind: IntroductionHistoryEvidence_ACU['artifactKind'] };
    logDebug_ACU(`[V2 Persist] introduction_history_may_exist: sheetKey=${sheetKey}, messageIndex=${note.messageIndex}, artifact=${note.artifactKind || 'unknown'}。`);
    return {
      status: 'may_exist',
      sheetKey,
      messageIndex: note.messageIndex,
      artifactKind: note.artifactKind,
      reason: '仅存在归属未知的全局 artifact，无法证明或证伪目标表存在',
    };
  }
  return absent();
}

function scopedHistoryArtifactEvidence_ACU(
  artifact: unknown,
  sheetKey: string,
  containsOrCannotDisprove: (artifact: unknown, sheetKey: string) => boolean,
): 'absent' | 'present' | 'indeterminate' | 'unattributable_global' {
  const indeterminateWithDiagnostics = (branch: number, failedField: string): 'indeterminate' => {
    const artifactKind = isObjectRecord_ACU(artifact) ? String((artifact as any).kind) : typeof artifact;
    const hasSheetKey = isObjectRecord_ACU(artifact) && typeof (artifact as any).sheetKey === 'string';
    logWarn_ACU(
      `[V2 Persist] scoped_history_artifact_indeterminate: branch=${branch}, artifactKind=${artifactKind}, hasSheetKey=${hasSheetKey}, sheetKeyMatchesTarget=${hasSheetKey && (artifact as any).sheetKey === sheetKey}, failedField=${failedField}`,
    );
    return 'indeterminate';
  };
  if (!isObjectRecord_ACU(artifact)) return indeterminateWithDiagnostics(1, 'artifact');
  if (artifact.kind === 'data_replace') {
    if (!isObjectRecord_ACU(artifact.data)) return indeterminateWithDiagnostics(2, 'data');
    return recordContainsSheet_ACU(artifact.data, sheetKey) ? 'present' : 'absent';
  }
  // sql_batch / table_edit_dsl 是全局 replay operation，按类型定义就没有 sheetKey
  // （见 storage-frame-v2-types.ts）。它们既不能证明也不能证伪目标表存在过，
  // 属于"归属未知"而不是"结构畸形"。原实现把两者混进同一个 indeterminate，
  // 导致任何一条合法全局 operation 让该 isolationKey 下所有表的 evidence 永久失效。
  //
  // 但只有"符合类型定义（不带 sheetKey）"的全局 artifact 才算归属未知。
  // 全局 kind 却携带 sheetKey 属于伪造归属 / 契约违规：它声称自己定位到某个表，
  // 而该 kind 的 replay 语义是全局的，两者矛盾且无法判定真实影响面，必须 fail-closed。
  if (HISTORY_GLOBAL_ARTIFACT_KINDS_ACU.has(artifact.kind as string)) {
    if ('sheetKey' in artifact) {
      return indeterminateWithDiagnostics(7, 'global_kind_with_forged_sheetKey');
    }
    logDebug_ACU(
      `[V2 Persist] scoped_history_artifact_unattributable_global: artifactKind=${String(artifact.kind)}, targetSheetKey=${sheetKey}`,
    );
    return 'unattributable_global';
  }
  if (typeof artifact.sheetKey !== 'string') return indeterminateWithDiagnostics(3, 'sheetKey');
  if (artifact.sheetKey !== sheetKey) {
    // 这些 mutation/patch 是严格按 sheetKey 定位的；另一个 sheet 的局部损坏
    // 不能伪造目标表曾存在的证据。未知 kind 仍保持 fail-closed。
    // sql_sheet_batch 必须在此列：它是新填表写入的首选形态（见 storage-frame-v2-types.ts:230），
    // sheetKey 为必填，且 buildSqlSheetBatchOperations_ACU 只在该 statement 只涉及单表时才产出
    // （多表命中走 ambiguousStatements，见 sql-table-service.ts:773-778），
    // 即 sheetKey 就是它的完整影响面。漏列会让任意一张表的历史填表写入，
    // 把同 isolationKey 下其他表的 evidence 永久变成 indeterminate。
    if (artifact.kind === 'sql_sheet_batch') {
      // 别表 sql_sheet_batch 仍须结构合法才可证伪目标表：畸形结构（statements 非字符串数组等）
      // 无法判定真实影响面，必须保持 fail-closed（与既有测试契约一致）。
      const structureIsValid = Array.isArray(artifact.statements)
        && artifact.statements.every(statement => typeof statement === 'string');
      if (!structureIsValid) return indeterminateWithDiagnostics(4, 'kind_unknown_or_unscoped');
      return 'absent';
    }
    if (['sheet_replace', 'sheet_schema_migrate', 'row_upsert', 'row_delete', 'meta_update'].includes(artifact.kind)) {
      return 'absent';
    }
    return indeterminateWithDiagnostics(4, 'kind_unknown_or_unscoped');
  }
  if (!containsOrCannotDisprove(artifact, sheetKey)) return 'absent';
  // 归属明确的 mutation/patch：只要结构可验证（statements/params/tableName 等），
  // 它就是该表"曾存在"的铁证，reason 等标注字段不参与"能否证伪"判定。
  // 旧版本手动重填等路径可能写出非当前白名单的 reason（如 manual_refill），
  // 这些值不影响表是否存在过；只有结构畸形才保持 fail-closed。
  if (artifact.kind === 'sql_sheet_batch') {
    const structureIsValid = typeof artifact.sheetKey === 'string'
      && Array.isArray(artifact.statements)
      && artifact.statements.every(statement => typeof statement === 'string')
      && (artifact.params === undefined
        || (Array.isArray(artifact.params)
          && artifact.params.every(params => Array.isArray(params)
            && params.every(value => value === null || typeof value === 'string' || typeof value === 'number'))))
      && (artifact.tableName === undefined || typeof artifact.tableName === 'string');
    return structureIsValid ? 'present' : indeterminateWithDiagnostics(5, 'sql_sheet_batch_structure');
  }
  // 其余归属明确的 kind：用哨兵区分"目标表证据确凿"与"字段无法验证"。
  // 哨兵只对会随 sheetKey 变化的字段敏感；reason 等标注字段不得让合法
  // 本表 operation 退化为 indeterminate（否则历史手动填表会被误判为不可验证）。
  return containsOrCannotDisprove(artifact, '__acu_history_evidence_sentinel__')
    ? indeterminateWithDiagnostics(6, 'sentinel_unfalsifiable')
    : 'present';
}
/**
 * 定位 reveal 数据来源（语义1：恢复"离开时最新状态"）。
 *
 * 关键数据安全约束：不取任何单一 checkpoint 的静态快照（可能是中间态/过期态），
 * 而是从 target.index 向前逐楼层做 bounded replay，找到该 sheet 仍可见的"最高楼层"，
 * 其 replay 结果即为该表最后一次可见时的完整状态。当前 frame 的精确同 key checkpoint
 * 仅在 bounded replay 找不到来源时作为同楼层回退；调用方必须在收敛重写前传入其副本。
 */
type RevealSourceResolution_ACU =
  | { status: 'resolved'; sheetData: Sheet_ACU; sourceKind: 'bounded_replay' | 'current_sheet_checkpoint'; messageIndex: number }
  | { status: 'not_found' }
  | { status: 'indeterminate'; reason: string };

async function resolveRevealSource_ACU(
  chat: any[],
  isolationKey: string,
  maxMessageIndex: number,
  sheetKey: string,
  preferredHideCheckpoint?: unknown,
  currentSheetCheckpoint?: unknown,
): Promise<RevealSourceResolution_ACU> {
  // 优先使用生命周期派生指向的最后 hide checkpoint：hide 语义保证 checkpoint.data 保留
  // 离开 active 状态前的完整数据，且当前 frame 的精确同 key checkpoint 已通过 created/seq
  // 校验。仅在缺少可信 hide checkpoint 时才退回逐边界 bounded replay（兼容旧历史）。
  if (isObjectRecord_ACU(preferredHideCheckpoint)) {
    const timeline = (preferredHideCheckpoint as any).timeline;
    const data = (preferredHideCheckpoint as any).data;
    if (isObjectRecord_ACU(timeline) && timeline.kind === 'sheet_hide' && isObjectRecord_ACU(data)) {
      return {
        status: 'resolved',
        sheetData: deepClone_ACU(data) as Sheet_ACU,
        sourceKind: 'current_sheet_checkpoint',
        messageIndex: maxMessageIndex,
      };
    }
    // 候选 hide checkpoint 结构非法：不得静默降级，继续走 bounded replay 验证，若仍找不到则 indeterminate。
  }
  let replayFailureCount = 0;
  for (let boundary = maxMessageIndex; boundary >= 0; boundary -= 1) {
    const tagData = readIsolatedTagData_ACU(chat[boundary], isolationKey);
    if (!hasV2HistoryMarker_ACU(tagData)) continue;
    let replayed: Awaited<ReturnType<typeof loadTableStateFromFramesV2Detailed_ACU>> = null;
    try {
      replayed = await loadTableStateFromFramesV2Detailed_ACU(chat, isolationKey, {
        maxMessageIndex: boundary,
        updateRuntimeState: false,
        compatibilityMode: 'disabled',
      });
    } catch {
      // 该边界 replay 失败不代表更早边界不可用；继续向前寻找可信可见状态。
      replayFailureCount += 1;
      continue;
    }
    if (replayed && Object.prototype.hasOwnProperty.call(replayed.data, sheetKey)) {
      const candidate = (replayed.data as Record<string, unknown>)[sheetKey];
      if (isObjectRecord_ACU(candidate)) {
        return {
          status: 'resolved',
          sheetData: deepClone_ACU(candidate) as Sheet_ACU,
          sourceKind: 'bounded_replay',
          messageIndex: boundary,
        };
      }
      return { status: 'indeterminate', reason: `bounded replay 返回了非对象 sheet：messageIndex=${boundary}` };
    }
  }
  if (isObjectRecord_ACU(currentSheetCheckpoint)) {
    const checkpointData = currentSheetCheckpoint.data;
    if (isObjectRecord_ACU(checkpointData)) {
      return {
        status: 'resolved',
        sheetData: deepClone_ACU(checkpointData) as Sheet_ACU,
        sourceKind: 'current_sheet_checkpoint',
        messageIndex: maxMessageIndex,
      };
    }
    return { status: 'indeterminate', reason: '当前目标 sheet checkpoint 缺少对象 data' };
  }
  if (replayFailureCount > 0) {
    return { status: 'indeterminate', reason: `无法完成 ${replayFailureCount} 个 bounded replay 边界` };
  }
  return { status: 'not_found' };
}



function validateSheetCheckpointInput_ACU(
  options: PersistTableSheetCheckpointV2Options_ACU,
): { createdAt: number; reason: TableCheckpointV2_ACU['reason'] } | { error: string } {
  if (typeof options.sheetKey !== 'string' || !options.sheetKey.startsWith('sheet_')) {
    return { error: 'V2 sheet checkpoint requires a sheetKey beginning with "sheet_".' };
  }
  if (!isObjectRecord_ACU(options.sheetData)) {
    return { error: `V2 sheet checkpoint requires object sheetData for ${options.sheetKey}.` };
  }
  if (!options.reason) {
    return { error: 'V2 sheet checkpoint requires an explicit checkpoint reason.' };
  }
  const createdAt = options.createdAt ?? Date.now();
  if (!Number.isFinite(createdAt) || createdAt < 0) {
    return { error: 'V2 sheet checkpoint requires a finite non-negative createdAt.' };
  }
  return { createdAt, reason: options.reason };
}

async function persistTableMutationLogV2Core_ACU(
  options: PersistTableMutationV2Options_ACU,
): Promise<{ saved: boolean; messageIndex?: number; entry?: TableMutationLogEntryV2_ACU; error?: string }> {
  const chat = getChatArray_ACU();
  if (!chat || chat.length === 0) {
    return { saved: false, error: 'chat history is empty' };
  }

  const target = findTargetAiMessage_ACU(chat, options.targetMessageIndex);
  if (!target) {
    return { saved: false, error: 'no AI message found' };
  }

  options.transactionContext?.assertFresh?.('persistTableMutationLogV2:before_persist');
  if (!chat[target.index] || chat[target.index] !== target.message || target.message.is_user) {
    return { saved: false, error: 'target AI message changed before persist; abort stale table write.' };
  }

  const isolationKey = options.isolationKey ?? getCurrentIsolationKey_ACU();
  const replacementValidation = normalizeIncrementalReplacement_ACU(options.replaceExistingIncremental, target.index, chat);
  if (replacementValidation && 'error' in replacementValidation) {
    return { saved: false, error: replacementValidation.error };
  }
  const replacement = replacementValidation as { targetMessageIndices: number[]; targetSheetKeys: string[] } | null;
  const hasExistingCheckpoint = hasAnyV2Checkpoint_ACU(chat, isolationKey, target.index);
  const hasCheckpointAnywhere = hasAnyV2Checkpoint_ACU(chat, isolationKey);
  const requiresFullAfterData = !hasCheckpointAnywhere
    || (options.source === 'import' && (!Array.isArray(options.operations) || options.operations.length === 0));
  const afterData = clonePersistAfterData_ACU(options, requiresFullAfterData);
  const normalization = normalizeCanonicalTableRows_ACU(afterData);
  if (normalization.errors.length > 0) {
    return { saved: false, error: `V2 operation log snapshot 行标识不合法：${formatCanonicalRowIssues_ACU(normalization.errors)}` };
  }
  if (normalization.removedRows.length > 0) {
    return { saved: false, error: `V2 operation log snapshot 包含空 row_id 行，拒绝静默删除：${formatCanonicalRowIssues_ACU(normalization.removedRows)}` };
  }
  const filledSheetKeys = normalizeKeys_ACU(options.filledSheetKeys, afterData);
  const candidateChangedSheetKeys = normalizeKeys_ACU(options.candidateChangedSheetKeys, afterData);
  // 「本次是否首次初始化」必须看整个聊天，而不是只看目标楼层之前。
  // 对更早楼层填表（追平/重填）时，锚点可能位于更晚的楼层；
  // 只看之前会误判为首次初始化，从而又写一个 init full checkpoint，
  // 于是聊天里出现两个初始基线，回放只认最后一个，前面楼层的数据全部失效。
  const hasExistingV2Frame = hasAnyV2Frame_ACU(chat, isolationKey, target.index);
  const operations = normalizeOperations_ACU(options.operations, afterData, options.source, hasExistingCheckpoint);
  const effectiveChangedSheetKeys = candidateChangedSheetKeys;
  const hasMetadataOnlyFillEvent = filledSheetKeys.length > 0 || (Array.isArray(options.groupKeys) && options.groupKeys.length > 0);
  const hasManualRefillProgress = !!options.manualRefillProgress;
  const isManualRefillProgressOnly = operations.length === 0 && !hasMetadataOnlyFillEvent && hasManualRefillProgress;
  const latestFullCheckpoint = findLatestFullCheckpoint_ACU(chat, isolationKey);
  const latestReplayRootIndex = findLatestReplayRootMessageIndex_ACU(chat, isolationKey);
  const writesReplayArtifact = operations.length > 0 || hasMetadataOnlyFillEvent || hasManualRefillProgress || replacement !== null;
  // 阶段 F：单目标 persist 内部两次同 boundary 冷 replay 的去重证据。
  // provisional convergence 校验（hasExistingCheckpoint 分支）与 append 前的 active
  // sheet state 校验都用 maxMessageIndex=target.index + updateRuntimeState:false，
  // boundary 与选项完全一致；两者之间 chat 只读不改（写入全部落在 cloneIsolatedData_ACU
  // 派生的候选帧与 replacementIsolatedDataByMessageIndex 上），headRevision digest 不变，
  // 因此第二次可复用第一次结果，省一整轮冷回放。
  //
  // 只在两次调用必定同时触发时才创建证据：hasExistingCheckpoint 为真必然
  // hasCheckpointAnywhere 为真 → shouldCheckpoint 为假 → 必走 shouldAppendLogEntry 分支。
  // 否则传 null：只写不读时 replay 仍会为写回付一次全表 deepClone —— 纯亏（阶段 G1 已实证）。
  //
  // 语义等价性：evidence 仅在无 compatibilityRepairs 且无 requiresCheckpointConvergence 时
  // 写入，故命中时第二处的 repairs 判定与冷回放同为空集；有 repair 时不写证据、第二处自然冷回放。
  const bothBoundaryReplaysWillRun = hasExistingCheckpoint
    && writesReplayArtifact
    && operations.some(operation => typeof (operation as any)?.sheetKey === 'string'
      && (operation as any).sheetKey.startsWith('sheet_'));
  const boundaryReplayEvidence = bothBoundaryReplaysWillRun
    ? ({} as import('./v2-replay-session').V2ReplayEvidence_ACU)
    : null;
  // V2 replay 只从最后一个 full checkpoint 开始。向该 checkpoint 之前写入任何
  // operation、填表事件或追平进度都会制造“保存成功但永远无法回放”的伪提交；不能等到
  // terminal progress-only 写入时才暴露问题。
  if (writesReplayArtifact && latestReplayRootIndex !== null && latestReplayRootIndex > target.index) {
    return {
      saved: false,
      error: `V2 write target precedes the latest full checkpoint and would never replay: targetMessageIndex=${target.index}, latestFullCheckpointIndex=${latestReplayRootIndex}.`,
    };
  }
  const hasUnanchoredArtifacts = !hasCheckpointAnywhere
    && hasUnanchoredReplayArtifactsForChatV2_ACU(chat, isolationKey);
  let temporaryBaselineUpgrade = false;
  if (hasUnanchoredArtifacts && !isManualRefillProgressOnly) {
    const replay = await loadTableStateFromFramesV2Detailed_ACU(chat, isolationKey, {
      maxMessageIndex: target.index,
      updateRuntimeState: false,
      ...(options.performanceRunId ? { performanceRunId: options.performanceRunId } : {}),
      ...(options.performanceParentSpanId
        ? { performanceParentSpanId: options.performanceParentSpanId }
        : {}),
      allowTemporaryTemplateBaseline: true,
      compatibilityMode: 'disabled',
    });
    if (!replay || replay.baseKind !== 'temporary_template_baseline'
      || replay.requiresCheckpointConvergence || replay.compatibilityRepairs?.length) {
      return { saved: false, error: 'V2 boundary_replay_failed: 无锚点 artifacts 无法从当前聊天模板建立安全临时基线，已拒绝自动升级。' };
    }
    if (!await verifyTemporaryBaselineUpgrade_ACU(replay.data, operations, afterData)) {
      return { saved: false, error: 'V2 boundary_after_data_mismatch: 临时基线回放与本次 afterData 不一致，已拒绝建立 full checkpoint。' };
    }
    temporaryBaselineUpgrade = true;
  }
  // A temporary sheet anchor is derived from the current template, not from
  // persisted evidence. Before accepting another write, replace that dependency
  // with the *pre-write* replay state in the same candidate commit. Using
  // `afterData` here would capture the current operation and then append it a
  // second time, so the checkpoint must come from the replay before this call
  // mutates the frame.
  let provisionalConvergenceReplay: Awaited<ReturnType<typeof loadTableStateFromFramesV2Detailed_ACU>> | null = null;
  if (hasExistingCheckpoint && writesReplayArtifact) {
    let replay;
    try {
      replay = await loadTableStateFromFramesV2Detailed_ACU(chat, isolationKey, {
        maxMessageIndex: target.index,
        updateRuntimeState: false,
        ...(boundaryReplayEvidence ? { replayEvidence: boundaryReplayEvidence } : {}),
        ...(options.performanceRunId ? { performanceRunId: options.performanceRunId } : {}),
        ...(options.performanceParentSpanId
          ? { performanceParentSpanId: options.performanceParentSpanId }
          : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { saved: false, error: `V2 写入前无法验证 provisional replay：${message}` };
    }
    if (replay?.requiresCheckpointConvergence || replay?.compatibilityRepairs?.length) {
      if (!replay || !replay.compatibilityRepairs?.length
        || hasStructuralReplayCompatibilityRepairs_ACU(replay.compatibilityRepairs)) {
        return { saved: false, error: 'V2 写入前检测到结构性 replay repair，不能自动收敛或继续写入。' };
      }
      provisionalConvergenceReplay = replay;
    }
  }
  if (!manualRefillProgressIsValidForIntroductionHistory_ACU(options.manualRefillProgress)) {
    return { saved: false, error: 'V2 manualRefillProgress 格式无效，已拒绝写入。' };
  }
  if (isManualRefillProgressOnly && !hasExistingCheckpoint) {
    return {
      saved: false,
      error: 'V2 manualRefillProgress-only write requires an existing full checkpoint anchor.',
    };
  }
  // `hasExistingV2Frame` only proves that a V2 envelope exists; it does not
  // establish which later write is entitled to choose the one global replay
  // anchor. In particular, a historical catch-up bucket can otherwise turn an
  // earlier empty V2 frame into a migration-labelled checkpoint at whichever
  // bucket happens to commit first.
  //
  // Import keeps its established data_replace bootstrap path. A genuine
  // legacy-to-V2 migration never reaches this function: it writes a checkpoint
  // together with migrationProvenance in storage-v2-migration.ts.
  const usesImplicitMigrationCheckpoint = !hasCheckpointAnywhere
    && !temporaryBaselineUpgrade
    && options.checkpointReason === undefined
    && options.source !== 'import'
    && hasExistingV2Frame;
  if (usesImplicitMigrationCheckpoint) {
    return { saved: false, error: 'V2 storage contains frames but no full checkpoint anchor; refusing to create an implicit migration checkpoint at the current write target. Please run V2 recovery diagnostics first.' };
  }
  const initialCheckpointReason: TableCheckpointV2_ACU['reason'] = temporaryBaselineUpgrade
    ? 'integrity_repair'
    : (options.checkpointReason || (hasExistingV2Frame ? 'migration' : 'init'));
  // 同一隔离键下同一时刻只能存在一个 full checkpoint。
  //
  // 只要整个聊天已经有 full checkpoint，本次写入就只能追加增量，
  // 即使目标楼层在那个 checkpoint 之前也一样。回放只认最后一个 full checkpoint，
  // 多出来的基线会让它之前的所有增量失效（表现为「只有最后一层有数据」）。
  //
  // 这条对所有 source 一致：导入只可能带来「现有没有的表」，
  // 同一张表的差异只是列，新增列按空处理，不需要另立基线。
  const shouldCheckpoint = !hasCheckpointAnywhere
    && !isManualRefillProgressOnly
    && (temporaryBaselineUpgrade
      || initialCheckpointReason === 'init'
      || initialCheckpointReason === 'migration');
  if (shouldCheckpoint && operations.length > 0 && !temporaryBaselineUpgrade) {
    return { saved: false, error: 'V2 初始 full checkpoint 不接受 operations；请仅提交 afterData 快照。' };
  }

  const targetExistingTagData = cloneIsolatedData_ACU(target.message)?.[isolationKey];
  const targetExistingFrame = isV2TagData_ACU(targetExistingTagData)
    ? deepClone_ACU(targetExistingTagData.storageFrame)
    : null;
  const isolatedData = cloneIsolatedData_ACU(target.message) as Record<string, any>;
  const frame = getOrInitV2Frame_ACU(isolatedData, isolationKey);
  const replacementIsolatedDataByMessageIndex = new Map<number, Record<string, any>>();
  if (replacement) {
    const knownSqlTableNames = collectReplacementSqlTableNames_ACU(
      chat,
      isolationKey,
      replacement.targetMessageIndices,
      replacement.targetSheetKeys,
    );
    for (const messageIndex of replacement.targetMessageIndices) {
      const nextIsolatedData = messageIndex === target.index
        ? isolatedData
        : cloneIsolatedData_ACU(chat[messageIndex]) as Record<string, any>;
      const tagData = nextIsolatedData[isolationKey];
      if (!isV2TagData_ACU(tagData)) continue;
      if (purgeManualRefillIncrementalSheetKeysFromStorageFrameV2_ACU(
        tagData.storageFrame,
        new Set(replacement.targetSheetKeys),
        knownSqlTableNames,
      )) {
        replacementIsolatedDataByMessageIndex.set(messageIndex, nextIsolatedData);
      }
    }
  }
  const currentWriteSet = options.writeSet ?? options.transactionContext?.writeSet;
  const revisionWriteSet = options.revisionWriteSet;
  const requestedBaseRevision = options.baseRevision !== undefined
    ? options.baseRevision
    : options.transactionContext?.baseRevision;

  if (operations.length === 0 && !hasMetadataOnlyFillEvent && !hasManualRefillProgress && options.source !== 'import' && hasExistingCheckpoint) {
    return { saved: false, error: `V2 operation log requires explicit operations for source=${options.source}; snapshot diff fallback is not allowed.` };
  }

  if (options.forceCheckpoint && !shouldCheckpoint) {
    logWarn_ACU(`[V2 Persist] 单一保留边界 checkpoint 策略已忽略非初次 forceCheckpoint：reason=${options.checkpointReason || 'unspecified'}, source=${options.source}`);
  }

  if (options.manualRefillProgress) {
    frame.manualRefillProgress = deepClone_ACU(options.manualRefillProgress);
  }
  const shouldAppendLogEntry = operations.length > 0 || hasMetadataOnlyFillEvent;
  const now = Date.now();
  const aiFloor = countAiFloor_ACU(chat, target.index);
  let entry: TableMutationLogEntryV2_ACU | undefined;

  // 临时补锚收敛：把 replay 期间的 compatibility 锚点固化为根帧 per-sheet checkpoint。
  // 锚点只依赖当前模板（未持久化），所以必须在写入前用同一候选提交里 *写入前* 的
  // replay state 固化它；afterData 会捕获本次操作并二次追加。
  //
  // 不变量：同一隔离键同一时刻只有一个 full checkpoint。既有 full 是回放根，
  // 这里只能往 latestFullCheckpoint.index 那层写 per-sheet 锚点（untimed），
  // 绝不写第二个 full —— 否则回放根被抢占，旧根之前的全部增量失效。
  if (provisionalConvergenceReplay) {
    const invariantViolation = assertSingleActiveFullCheckpointV2_ACU(
      chat,
      isolationKey,
      'persistTableMutationLogV2:single_target_convergence',
    );
    if (invariantViolation) return { saved: false, error: invariantViolation };
    if (!latestFullCheckpoint) {
      return { saved: false, error: 'V2 临时补锚收敛缺少既有 full checkpoint 根，已拒绝。' };
    }
    const anchorData = resolveConvergenceAnchorSheetData_ACU(
      chat,
      isolationKey,
      provisionalConvergenceReplay.compatibilityRepairs || [],
    );
    if (anchorData.error) {
      return { saved: false, error: anchorData.error };
    }
    const recoveryBackup: TableV2RecoveryBackup_ACU = {
      version: 1,
      createdAt: now,
      recoveryKind: 'temporary_sheet_anchor_convergence',
      sourceMessageIndex: target.index,
      storageFrame: targetExistingFrame || frame,
    };
    const tagData = isolatedData[isolationKey];
    if (tagData && typeof tagData === 'object' && !Array.isArray(tagData)) {
      (tagData as Record<string, any>).recoveryBackup = recoveryBackup;
    }

    if (latestFullCheckpoint.index !== target.index) {
      // 既有 full 在更早楼层：锚点必须落在那层（回放根），而不是当前目标层。
      const rootIsolatedData = cloneIsolatedData_ACU(latestFullCheckpoint.message) as Record<string, any>;
      const rootFrame = getOrInitV2Frame_ACU(rootIsolatedData, isolationKey);
      const rootWrite = writeSheetAnchorCheckpointsToFrame_ACU(
        rootFrame,
        anchorData.bySheetKey,
        now,
        undefined, // 根帧锚点不接续任何 revision；untimed 在 state 初始化后立即生效
        { messageIndex: latestFullCheckpoint.index, aiFloor: countAiFloor_ACU(chat, latestFullCheckpoint.index), isolationKey },
      );
      if (rootWrite.ok === false) {
        return { saved: false, error: rootWrite.error };
      }
      replacementIsolatedDataByMessageIndex.set(latestFullCheckpoint.index, rootIsolatedData);
    } else {
      // 既有 full 就在当前目标层：直接在本次候选帧上写锚点。
      const write = writeSheetAnchorCheckpointsToFrame_ACU(
        frame,
        anchorData.bySheetKey,
        now,
        requestedBaseRevision,
        { messageIndex: target.index, aiFloor, isolationKey },
      );
      if (write.ok === false) {
        return { saved: false, error: write.error };
      }
    }
  }


  if (shouldCheckpoint) {
    const checkpointRevision = buildCommitRevision_ACU('checkpoint', generateEntryId_ACU());
    const checkpointEvent = {
      filledSheetKeys,
      changedSheetKeys: effectiveChangedSheetKeys,
      groupKeys: options.groupKeys || [],
      requestId: options.requestId,
      batchId: options.batchId,
      error: options.error,
    };
    const checkpointResult = buildCanonicalFullCheckpoint_ACU({
      createdAt: now,
      reason: initialCheckpointReason,
      data: afterData,
      scheduleSummary: collectScheduleSummaryFromFramesV2_ACU(chat, isolationKey, { maxMessageIndex: target.index }),
      event: checkpointEvent,
      context: { messageIndex: target.index, aiFloor, isolationKey },
    });
    if (!checkpointResult.checkpoint) {
      return { saved: false, error: checkpointResult.error };
    }
    frame.checkpoint = checkpointResult.checkpoint;
    frame.headRevision = checkpointRevision;
    frame.logEntries = [];
    delete frame.perSheetCheckpoints;
    if (temporaryBaselineUpgrade && targetExistingFrame) {
      const recoveryBackup: TableV2RecoveryBackup_ACU = {
        version: 1,
        createdAt: now,
        recoveryKind: 'temporary_template_baseline_upgrade',
        sourceMessageIndex: target.index,
        storageFrame: targetExistingFrame,
      };
      const tagData = isolatedData[isolationKey];
      if (tagData && typeof tagData === 'object' && !Array.isArray(tagData)) {
        tagData.recoveryBackup = recoveryBackup;
      }
    }
    logDebug_ACU(`[V2 Persist] 写入 full checkpoint: messageIndex=${target.index}, revision=${checkpointRevision}, sheets=${Object.keys(afterData).filter(k => k.startsWith('sheet_')).length}`);
  } else if (shouldAppendLogEntry) {
    // 目标表必须在追加 operation 前的 active replay state 中真实存在。仅仅曾在历史
    // checkpoint 出现过不够：sheet_hide / data_replace 都可能已将它移出 active state；
    // compatibility temporary anchor 也不是可供新写入依赖的持久化锚点。
    const operationSheetKeys = [...new Set(
      operations
        .map(operation => (operation as any)?.sheetKey)
        .filter((sheetKey: unknown): sheetKey is string => typeof sheetKey === 'string' && sheetKey.startsWith('sheet_')),
    )];
    if (operationSheetKeys.length > 0) {
      let replayBeforeAppend;
      try {
        replayBeforeAppend = await loadTableStateFromFramesV2Detailed_ACU(chat, isolationKey, {
          maxMessageIndex: target.index,
          updateRuntimeState: false,
          ...(boundaryReplayEvidence ? { replayEvidence: boundaryReplayEvidence } : {}),
          ...(options.performanceRunId ? { performanceRunId: options.performanceRunId } : {}),
          ...(options.performanceParentSpanId
            ? { performanceParentSpanId: options.performanceParentSpanId }
            : {}),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { saved: false, error: `V2 无法确认 operation 执行前的 active sheet state，已拒绝写入：${message}` };
      }
      // 已在当前候选 frame 写入 full checkpoint 的 provisional replay 不再是
      // "compatibility-only"：再追加 header shard 会制造冗余 timeline，且让本次
      // operation 对不必要的第二个锚点产生依赖。
      const compatibilityOnlySheetKeys = provisionalConvergenceReplay
        ? new Set<string>()
        : new Set((replayBeforeAppend?.compatibilityRepairs || []).map(repair => repair.sheetKey));
      {
        const missingSheetKeys = operationSheetKeys.filter(
          sheetKey => Boolean((afterData as any)[sheetKey])
            && (!Object.prototype.hasOwnProperty.call(replayBeforeAppend?.data || {}, sheetKey)
              || compatibilityOnlySheetKeys.has(sheetKey)),
        );
        const introduced: TableSheetCheckpointV2_ACU[] = [];
        for (const sheetKey of missingSheetKeys) {
          // 锚点只提供表结构，必须裁成 header-only：
          // 本次增量会自行写入数据行，若锚点带上同样的行，回放时会主键冲突
          // （UNIQUE constraint failed）。
          const anchorSheet = deepClone_ACU((afterData as any)[sheetKey]) as Sheet_ACU;
          if (Array.isArray(anchorSheet?.content) && anchorSheet.content.length > 0) {
            anchorSheet.content = [deepClone_ACU(anchorSheet.content[0])];
          }
          const sheetCheckpointResult = buildCanonicalSheetCheckpoint_ACU({
            createdAt: now,
            reason: 'schema_change',
            sheetKey,
            data: anchorSheet,
            event: { filledSheetKeys: [], changedSheetKeys: [sheetKey], groupKeys: [] },
            baseRevision: requestedBaseRevision,
            context: { messageIndex: target.index, aiFloor, isolationKey },
          });
          if (!sheetCheckpointResult.checkpoint) {
            return { saved: false, error: sheetCheckpointResult.error };
          }
          const historyEvidence = introductionHistoryEvidence_ACU(chat, isolationKey, target.index, sheetKey);
          if (historyEvidence.status === 'indeterminate') {
            return {
              saved: false,
              error: `V2 sheet introduction history is indeterminate: sheetKey=${sheetKey}, messageIndex=${historyEvidence.messageIndex ?? 'unknown'}, reason=${historyEvidence.reason || 'unknown'}.`,
            };
          }
          // 本路径两条分支写的是同一个 header-only 锚点，replay 对
          // introduction / rebase / reveal 的数据应用完全一致
          // （storage-frame-v2-replay.ts:837-843），可见性判定也只区分 hide
          // （同文件 209 行）。因此这里的 kind 只是生命周期标注：
          // may_exist（仅有归属未知的全局 artifact）按"可能存在过"取 reveal，
          // 既不阻断写入，也不宣称该表是全新表。
          const timelineKind = historyEvidence.status === 'present' || historyEvidence.status === 'may_exist'
            ? 'sheet_reveal' as const
            : 'sheet_introduction' as const;
          // timeline 决定回放时该表在本楼何时进入 state：必须早于本次追加的增量。
          introduced.push({
            ...sheetCheckpointResult.checkpoint,
            timeline: {
              kind: timelineKind,
              activateAtMessageIndex: target.index,
              afterSeq: Math.max(0, ...frame.logEntries.map(item => Number(item.seq) || 0)),
            },
          });
        }
        if (introduced.length > 0) {
          frame.perSheetCheckpoints = {
            ...(frame.perSheetCheckpoints || {}),
            ...Object.fromEntries(introduced.map(checkpoint => [checkpoint.sheetKey, checkpoint])),
          };
          logDebug_ACU(`[V2 Persist] 为本楼缺失的目标表补写 per-sheet checkpoint：${introduced.map(c => c.sheetKey).join('、')}（messageIndex=${target.index}）。`);
        }
      }
    }
    const nextSeq = Math.max(0, ...frame.logEntries.map(item => Number(item.seq) || 0)) + 1;
    const parentRevision = options.parentRevision !== undefined ? options.parentRevision : (frame.headRevision ?? null);
    entry = appendMutationLogEntry_ACU(frame, {
      seq: nextSeq,
      createdAt: now,
      source: options.source,
      targetMessageIndex: target.index,
      aiFloor,
      filledSheetKeys,
      changedSheetKeys: effectiveChangedSheetKeys,
      groupKeys: options.groupKeys || [],
      requestId: options.requestId,
      batchId: options.batchId,
      error: options.error,
      operations,
      baseRevision: requestedBaseRevision ?? parentRevision,
      parentRevision,
      writeSet: currentWriteSet,
    });
    logDebug_ACU(`[V2 Persist] 追加 operation log entry: messageIndex=${target.index}, seq=${entry.seq}, revision=${entry.commitRevision}, operations=${operations.length}`);
  }

  if (!shouldAppendLogEntry && !shouldCheckpoint && options.manualRefillProgress) {
    logDebug_ACU(`[V2 Persist] 仅更新 manualRefillProgress，不追加 mutation entry: messageIndex=${target.index}`);
  }

  // provisional bridge 提交进度推进：仅当本次是匹配 runId 的 manual catch-up bucket
  // （准入已放行，目标 < 原 full 边界）时更新 bridge.lastCommittedTargetIndex，并把它
  // 所在的根消息并入替换集合，与本次 bucket 提交同一次 strict save 原子落盘。
  // 崩溃后 recover 依赖该进度区分“零提交回滚”与“有提交 finalize”，不能滞后。
  const activeBridge = readActiveProvisionalBridge_ACU(chat, isolationKey);
  if (activeBridge && options.manualCatchUpRunId && activeBridge.runId === options.manualCatchUpRunId
    && target.index < activeBridge.originalFullCheckpointIndex) {
    const progress = advanceProvisionalBridgeCommitProgress_ACU(chat, isolationKey, target.index);
    if (progress.ok && progress.status === 'advanced') {
      replacementIsolatedDataByMessageIndex.set(progress.messageIndex, progress.isolatedData);
    } else if (progress.ok === false) {
      // 结构性失败（找不到根）才阻断；幂等重试（already_committed）不阻断本次提交。
      if (progress.code === 'root_missing') {
        return { saved: false, error: `provisional bridge 提交进度推进失败：${progress.error}` };
      }
    }
  }
  replacementIsolatedDataByMessageIndex.set(target.index, isolatedData);
  if (temporaryBaselineUpgrade || provisionalConvergenceReplay) {
    const candidateChat = buildCandidateChatWithIsolatedDataOverrides_ACU(chat, replacementIsolatedDataByMessageIndex);
    const candidateValidationError = temporaryBaselineUpgrade
      ? await validateTemporaryBaselineUpgradeCandidate_ACU(
        candidateChat,
        isolationKey,
        target.index,
        afterData,
      )
      : await validateProvisionalConvergenceCandidate_ACU(
        candidateChat,
        isolationKey,
        target.index,
      );
    if (candidateValidationError) {
      return { saved: false, error: candidateValidationError };
    }
    options.transactionContext?.assertFresh?.('persistTableMutationLogV2:before_boundary_checkpoint_save');
  }
  const previousMessageState = [...replacementIsolatedDataByMessageIndex.keys()].map(messageIndex => {
    const message = chat[messageIndex];
    return {
      message,
      hadIsolatedData: Object.prototype.hasOwnProperty.call(message, 'TavernDB_ACU_IsolatedData'),
      isolatedData: message.TavernDB_ACU_IsolatedData,
      hadIdentity: Object.prototype.hasOwnProperty.call(message, 'TavernDB_ACU_Identity'),
      identity: message.TavernDB_ACU_Identity,
    };
  });
  try {
    for (const [messageIndex, nextIsolatedData] of replacementIsolatedDataByMessageIndex) {
      chat[messageIndex].TavernDB_ACU_IsolatedData = nextIsolatedData;
    }
    writeMessageIdentity_ACU(target.message, {
      enabled: settings_ACU.dataIsolationEnabled,
      code: settings_ACU.dataIsolationCode,
    });
    // 临时基线升级会替换 orphan frame、清空日志并写 recoveryBackup，必须确认宿主真实落盘。
    if (options.strictSave || replacement || temporaryBaselineUpgrade || provisionalConvergenceReplay) {
      await saveChatToHostStrict_ACU();
    } else {
      await saveChatToHost_ACU();
    }
  } catch (error) {
    for (const state of previousMessageState) {
      if (state.hadIsolatedData) state.message.TavernDB_ACU_IsolatedData = state.isolatedData;
      else delete state.message.TavernDB_ACU_IsolatedData;
      if (state.hadIdentity) state.message.TavernDB_ACU_Identity = state.identity;
      else delete state.message.TavernDB_ACU_Identity;
    }
    throw error;
  }
  return { saved: true, messageIndex: target.index, entry };
}

export async function persistTableMutationLogV2_ACU(
  options: PersistTableMutationV2Options_ACU,
): Promise<{ saved: boolean; messageIndex?: number; entry?: TableMutationLogEntryV2_ACU; error?: string }> {
  const performanceSpan = startRuntimePerformanceSpan_ACU('v2-persist-mutation-log', {
    runId: options.performanceRunId,
    parentSpanId: options.performanceParentSpanId,
    settings: settings_ACU,
    metrics: {
      targetMessageIndex: options.targetMessageIndex,
      operationCount: Array.isArray(options.operations) ? options.operations.length : 0,
      changedSheetCount: Array.isArray(options.candidateChangedSheetKeys) ? options.candidateChangedSheetKeys.length : 0,
      source: options.source,
      strictSave: options.strictSave === true,
      replacement: Boolean(options.replaceExistingIncremental),
    },
  });
  if (!options.transactionContext) {
    const result = { saved: false, error: 'V2 operation log write requires TableWriteTransactionContext; direct unsafe writes are not allowed.' };
    performanceSpan.end({ success: false });
    return result;
  }
  // manual catch-up provisional bridge 写入准入（t5）：
  // 存在 active bridge 时，任何 V2 写入都必须携带匹配的 runId 且目标早于原 full 边界，
  // 否则视为无关写入（自动更新/CRUD/导入/其他 run）直接阻断，不能混入 provisional 时间线。
  // 不用全局布尔：每次写入都基于 live chat 重新读取 bridge 校验。
  try {
    const chat = getChatArray_ACU();
    const isolationKey = options.isolationKey ?? getCurrentIsolationKey_ACU();
    const bridge = readActiveProvisionalBridge_ACU(chat, isolationKey);
    if (bridge) {
      const targetIndex = options.targetMessageIndex ?? -1;
      const auth = authorizeManualCatchUpBucketWrite_ACU(
        bridge,
        options.manualCatchUpRunId,
        targetIndex,
        getActiveChatStorageIdentity_ACU(chat),
        isolationKey,
      );
      if (!auth.ok) {
        const result = { saved: false, error: `provisional bridge 写入被拒绝：${(auth as { ok: false; error: string }).error}` };
        performanceSpan.end({ success: false });
        return result;
      }
    }
  } catch (bridgeCheckError) {
    const result = { saved: false, error: `provisional bridge 准入检查失败：${bridgeCheckError instanceof Error ? bridgeCheckError.message : String(bridgeCheckError)}` };
    performanceSpan.end({ success: false });
    return result;
  }
  try {
    const hasPerformanceContext = Boolean(options.performanceRunId || options.performanceParentSpanId);
    const coreOptions = hasPerformanceContext
      ? { ...options, performanceParentSpanId: performanceSpan.id }
      : options;
    const result = options.assumeCommitLock
      ? await persistTableMutationLogV2Core_ACU(coreOptions)
      : await options.transactionContext.runCommit(() => persistTableMutationLogV2Core_ACU(coreOptions), options.revisionWriteSet);
    performanceSpan.end({ success: result.saved });
    return result;
  } catch (error) {
    performanceSpan.end({ success: false });
    throw error;
  }
}

function validateBatchOperationScope_ACU(
  targetIndex: number,
  operations: TableMutationOperationV2_ACU[],
  changedSheetKeys: string[],
): string | null {
  const changedKeys = new Set(changedSheetKeys);
  for (const operation of operations) {
    if (!operation || typeof operation !== 'object') return `V2 batch write target ${targetIndex} has an invalid operation.`;
    if (operation.kind === 'data_replace' || operation.kind === 'sql_batch' || operation.kind === 'table_edit_dsl') {
      return `V2 batch write target ${targetIndex} contains unsupported unscoped operation: ${operation.kind}.`;
    }
    const sheetKey = typeof (operation as any).sheetKey === 'string' ? (operation as any).sheetKey.trim() : '';
    if (!sheetKey || !changedKeys.has(sheetKey)) {
      return `V2 batch write target ${targetIndex} operation scope is outside changed sheet keys.`;
    }
  }
  return null;
}

function mergeBatchTargetsByMessageIndex_ACU(
  targets: PersistTableMutationLogBatchTargetV2_ACU[],
  afterData: TableDataObject_ACU,
): Map<number, PersistTableMutationLogBatchTargetV2_ACU> | { error: string } {
  const targetByIndex = new Map<number, PersistTableMutationLogBatchTargetV2_ACU>();
  for (const target of targets) {
    const targetIndex = Number(target?.targetMessageIndex);
    if (!Number.isInteger(targetIndex)) return { error: `V2 batch write target index is invalid: ${targetIndex}.` };
    if (!Array.isArray(target.operations) || target.operations.length === 0) {
      return { error: `V2 batch write target ${targetIndex} has no operations.` };
    }
    const normalizedKeys = normalizeKeys_ACU(target.changedSheetKeys, afterData);
    if (normalizedKeys.length === 0) return { error: `V2 batch write target ${targetIndex} has no valid changed sheet keys.` };
    const scopeError = validateBatchOperationScope_ACU(targetIndex, target.operations, normalizedKeys);
    if (scopeError) return { error: scopeError };
    const existing = targetByIndex.get(targetIndex);
    if (!existing) {
      targetByIndex.set(targetIndex, {
        targetMessageIndex: targetIndex,
        operations: deepClone_ACU(target.operations),
        changedSheetKeys: normalizedKeys,
      });
      continue;
    }
    existing.operations.push(...deepClone_ACU(target.operations));
    existing.changedSheetKeys = [...new Set([...existing.changedSheetKeys, ...normalizedKeys])].sort();
  }
  return targetByIndex;
}



async function persistTableMutationLogBatchV2Core_ACU(
  options: PersistTableMutationLogBatchV2Options_ACU,
): Promise<{ saved: boolean; messageIndices?: number[]; error?: string }> {
  const chat = getChatArray_ACU();
  if (!Array.isArray(chat) || chat.length === 0) return { saved: false, error: 'chat history is empty' };
  if (!Array.isArray(options.targets) || options.targets.length === 0) return { saved: false, error: 'V2 batch write requires at least one target.' };

  const isolationKey = options.isolationKey ?? getCurrentIsolationKey_ACU();
  const latestCheckpoint = findLatestFullCheckpoint_ACU(chat, isolationKey);
  const latestReplayRootIndex = findLatestReplayRootMessageIndex_ACU(chat, isolationKey);
  if (latestReplayRootIndex === null) return { saved: false, error: 'V2 batch write requires an existing replay checkpoint anchor.' };
  options.transactionContext?.assertFresh?.('persistTableMutationLogBatchV2:before_persist');

  const mergedTargets = mergeBatchTargetsByMessageIndex_ACU(options.targets, options.afterData);
  if ('error' in mergedTargets) return { saved: false, error: mergedTargets.error };
  const targetByIndex = mergedTargets;
  const changedSheetKeys = new Set<string>();
  for (const [targetIndex, target] of targetByIndex) {
    if (!Number.isInteger(targetIndex) || targetIndex < latestReplayRootIndex || !chat[targetIndex] || chat[targetIndex].is_user) {
      return { saved: false, error: `V2 batch write target is invalid or precedes replay checkpoint: ${targetIndex}.` };
    }
    target.changedSheetKeys.forEach(sheetKey => changedSheetKeys.add(sheetKey));
  }

  const convergenceTargetIndex = Math.min(...targetByIndex.keys());
  let provisionalConvergenceReplay: Awaited<ReturnType<typeof loadTableStateFromFramesV2Detailed_ACU>> | null = null;
  try {
    const replay = await loadTableStateFromFramesV2Detailed_ACU(chat, isolationKey, {
      maxMessageIndex: convergenceTargetIndex,
      updateRuntimeState: false,
    });
    if (replay?.requiresCheckpointConvergence || replay?.compatibilityRepairs?.length) {
      if (!replay?.compatibilityRepairs?.length
        || hasStructuralReplayCompatibilityRepairs_ACU(replay.compatibilityRepairs)) {
        return { saved: false, error: 'V2 batch 写入前检测到结构性 replay repair，不能自动收敛或继续写入。' };
      }
      provisionalConvergenceReplay = replay;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { saved: false, error: `V2 batch 写入前无法验证 provisional replay：${message}` };
  }

  const candidateChat = deepClone_ACU(chat);
  for (const [targetIndex, target] of targetByIndex) {
    const message = candidateChat[targetIndex];
    let isolatedData = cloneIsolatedData_ACU(message) as Record<string, any>;
    let tagData = isolatedData[isolationKey];
    if (!isV2TagData_ACU(tagData)) return { saved: false, error: `V2 batch write target ${targetIndex} has no V2 storage frame.` };
    let frame = tagData.storageFrame as TableStorageFrameV2_ACU;
    if (provisionalConvergenceReplay && targetIndex === convergenceTargetIndex) {
      const invariantViolation = assertSingleActiveFullCheckpointV2_ACU(
        chat,
        isolationKey,
        'persistTableMutationLogBatchV2:convergence',
      );
      if (invariantViolation) return { saved: false, error: invariantViolation };
      // 同一隔离键同一时刻只有一个 full checkpoint：convergence 只允许在既有 full
      // 根帧（latestCheckpoint.index）写 per-sheet 锚点，绝不写第二个 full。
      const anchorData = resolveConvergenceAnchorSheetData_ACU(
        chat,
        isolationKey,
        provisionalConvergenceReplay.compatibilityRepairs || [],
      );
      if (anchorData.error) {
        return { saved: false, error: anchorData.error };
      }
      const rootMessage = candidateChat[latestCheckpoint.index];
      if (!rootMessage) {
        return { saved: false, error: `V2 batch 收敛缺少既有 full checkpoint 根消息（index=${latestCheckpoint.index}），已拒绝。` };
      }
      const rootIsolatedData = cloneIsolatedData_ACU(rootMessage) as Record<string, any>;
      const rootFrame = getOrInitV2Frame_ACU(rootIsolatedData, isolationKey);
      const rootWrite = writeSheetAnchorCheckpointsToFrame_ACU(
        rootFrame,
        anchorData.bySheetKey,
        Date.now(),
        undefined,
        { messageIndex: latestCheckpoint.index, aiFloor: countAiFloor_ACU(candidateChat, latestCheckpoint.index), isolationKey },
      );
      if (rootWrite.ok === false) {
        return { saved: false, error: rootWrite.error };
      }
      // recoveryBackup 必须备份收敛前的原始帧（不含锚点），证据不掺入本次修改。
      const previousFrame = deepClone_ACU(frame);
      rootMessage.TavernDB_ACU_IsolatedData = rootIsolatedData;
      if (latestCheckpoint.index === targetIndex) {
        // 根帧就是当前目标：锚点与本次 log entry 必须落在同一 isolatedData 拷贝上，
        // 否则落盘时 isolatedData 覆盖会把锚点丢弃。
        isolatedData = rootIsolatedData;
        tagData = isolatedData[isolationKey];
        frame = tagData.storageFrame as TableStorageFrameV2_ACU;
      }
      // 目标帧只保留 recoveryBackup 证据，checkpoint/perSheetCheckpoints 不被改写。
      (tagData as Record<string, any>).recoveryBackup = {
        version: 1,
        createdAt: Date.now(),
        recoveryKind: 'temporary_sheet_anchor_convergence',
        sourceMessageIndex: targetIndex,
        storageFrame: previousFrame,
      } satisfies TableV2RecoveryBackup_ACU;
    }
    const nextSeq = Math.max(0, ...(frame.logEntries || []).map(item => Number(item.seq) || 0)) + 1;
    const entryId = generateEntryId_ACU();
    const parentRevision = frame.headRevision ?? null;
    const entry: TableMutationLogEntryV2_ACU = {
      seq: nextSeq,
      entryId,
      createdAt: Date.now(),
      source: options.source,
      targetMessageIndex: targetIndex,
      aiFloor: countAiFloor_ACU(candidateChat, targetIndex),
      filledSheetKeys: [],
      changedSheetKeys: target.changedSheetKeys,
      groupKeys: [],
      requestId: options.requestId,
      batchId: options.batchId,
      operations: deepClone_ACU(target.operations),
      baseRevision: options.transactionContext?.baseRevision ?? parentRevision,
      parentRevision,
      commitRevision: buildCommitRevision_ACU(nextSeq, entryId),
      writeSet: options.transactionContext?.writeSet,
    };
    frame.logEntries = [...(frame.logEntries || []), entry];
    frame.headRevision = entry.commitRevision;
    message.TavernDB_ACU_IsolatedData = isolatedData;
    writeMessageIdentity_ACU(message, {
      enabled: settings_ACU.dataIsolationEnabled,
      code: settings_ACU.dataIsolationCode,
    });
  }
  const targetMessageIndices = [...targetByIndex.keys()].sort((a, b) => a - b);
  const operationCount = [...targetByIndex.values()].reduce((sum, target) => sum + target.operations.length, 0);
  logDebug_ACU(
    `[V2 Persist] batch candidate 写入准备完成（已移除 afterData 相等性阻断）: source=${options.source}, targetMessageIndex=${targetMessageIndices.join(',')}, operations=${operationCount}, targets=${targetByIndex.size}, changedSheets=${changedSheetKeys.size}`,
  );

  if (provisionalConvergenceReplay) {
    const candidateValidationError = await validateProvisionalConvergenceCandidate_ACU(
      candidateChat,
      isolationKey,
      convergenceTargetIndex,
    );
    if (candidateValidationError) return { saved: false, error: candidateValidationError };
    options.transactionContext?.assertFresh?.('persistTableMutationLogBatchV2:before_convergence_save');
  }

  // convergence 会把锚点写入根帧（latestCheckpoint.index）；若根帧不是 batch target，
  // 必须把根帧一并纳入原子落盘集合，否则锚点只在内存候选里、落盘即丢失。
  const persistIndices = provisionalConvergenceReplay && !targetByIndex.has(latestCheckpoint.index)
    ? [...targetByIndex.keys(), latestCheckpoint.index]
    : [...targetByIndex.keys()];
  const snapshots = persistIndices.map(index => ({
    index,
    message: chat[index],
    hadIsolatedData: Object.prototype.hasOwnProperty.call(chat[index], 'TavernDB_ACU_IsolatedData'),
    isolatedData: chat[index].TavernDB_ACU_IsolatedData,
    hadIdentity: Object.prototype.hasOwnProperty.call(chat[index], 'TavernDB_ACU_Identity'),
    identity: chat[index].TavernDB_ACU_Identity,
  }));
  try {
    for (const { index } of snapshots) {
      chat[index].TavernDB_ACU_IsolatedData = candidateChat[index].TavernDB_ACU_IsolatedData;
      if (Object.prototype.hasOwnProperty.call(candidateChat[index], 'TavernDB_ACU_Identity')) {
        chat[index].TavernDB_ACU_Identity = candidateChat[index].TavernDB_ACU_Identity;
      } else {
        delete chat[index].TavernDB_ACU_Identity;
      }
    }
    await saveChatToHostStrict_ACU();
  } catch (error) {
    for (const snapshot of snapshots) {
      if (snapshot.hadIsolatedData) snapshot.message.TavernDB_ACU_IsolatedData = snapshot.isolatedData;
      else delete snapshot.message.TavernDB_ACU_IsolatedData;
      if (snapshot.hadIdentity) snapshot.message.TavernDB_ACU_Identity = snapshot.identity;
      else delete snapshot.message.TavernDB_ACU_Identity;
    }
    throw error;
  }

  return { saved: true, messageIndices: [...targetByIndex.keys()].sort((left, right) => left - right) };
}

export async function persistTableMutationLogBatchV2_ACU(
  options: PersistTableMutationLogBatchV2Options_ACU,
): Promise<{ saved: boolean; messageIndices?: number[]; error?: string }> {
  if (!options.transactionContext) {
    return { saved: false, error: 'V2 batch operation log write requires TableWriteTransactionContext; direct unsafe writes are not allowed.' };
  }
  if (options.assumeCommitLock) return persistTableMutationLogBatchV2Core_ACU(options);
  return options.transactionContext.runCommit(
    () => persistTableMutationLogBatchV2Core_ACU(options),
    options.revisionWriteSet,
  );
}

async function persistTableSheetCheckpointV2Core_ACU(
  options: PersistTableSheetCheckpointV2Options_ACU,
): Promise<{ saved: boolean; messageIndex?: number; checkpoint?: TableSheetCheckpointV2_ACU; error?: string }> {
  const validation = validateSheetCheckpointInput_ACU(options);
  if ('error' in validation) return { saved: false, error: validation.error };
  const normalizedSheetData = deepClone_ACU(options.sheetData);
  const normalization = normalizeCanonicalTableRows_ACU({ [options.sheetKey]: normalizedSheetData });
  if (normalization.errors.length > 0) {
    return { saved: false, error: `V2 sheet checkpoint 行标识不合法：${formatCanonicalRowIssues_ACU(normalization.errors)}` };
  }
  if (normalization.removedRows.length > 0) {
    return { saved: false, error: `V2 sheet checkpoint 包含空 row_id 行，拒绝静默删除：${formatCanonicalRowIssues_ACU(normalization.removedRows)}` };
  }

  const chat = getChatArray_ACU();
  if (!chat || chat.length === 0) {
    return { saved: false, error: 'chat history is empty' };
  }
  const isolationKey = options.isolationKey ?? getCurrentIsolationKey_ACU();
  const latestFullCheckpoint = findLatestFullCheckpoint_ACU(chat, isolationKey);
  const latestReplayRootIndex = findLatestReplayRootMessageIndex_ACU(chat, isolationKey);
  if (latestReplayRootIndex === null) {
    return { saved: false, error: 'V2 sheet checkpoint requires an existing full checkpoint anchor.' };
  }

  const target = findTargetAiMessage_ACU(chat, options.targetMessageIndex);
  if (!target) {
    return { saved: false, error: 'no AI message found' };
  }
  if (target.index < latestReplayRootIndex) {
    return { saved: false, error: `V2 sheet checkpoint target precedes the latest full checkpoint and would never replay: targetMessageIndex=${target.index}, latestFullCheckpointIndex=${latestReplayRootIndex}.` };
  }

  options.transactionContext?.assertFresh?.('persistTableSheetCheckpointV2:before_persist');
  if (!chat[target.index] || chat[target.index] !== target.message || target.message.is_user) {
    return { saved: false, error: 'target AI message changed before persist; abort stale sheet checkpoint write.' };
  }

  const isolatedData = cloneIsolatedData_ACU(target.message) as Record<string, any>;
  const frame = getOrInitV2Frame_ACU(isolatedData, isolationKey);
  const conflictingEntry = (frame.logEntries || []).find(entry => logEntryConflictsWithSheetCheckpoint_ACU(entry, options.sheetKey));
  if (conflictingEntry) {
    return {
      saved: false,
      error: `V2 sheet checkpoint cannot be inserted before an existing target-sheet log entry: sheetKey=${options.sheetKey}, entryId=${conflictingEntry.entryId}.`,
    };
  }

  const existingCheckpoint = frame.perSheetCheckpoints?.[options.sheetKey];
  if (existingCheckpoint && Number(existingCheckpoint.createdAt) > validation.createdAt) {
    return {
      saved: false,
      error: `V2 sheet checkpoint cannot replace a newer checkpoint: sheetKey=${options.sheetKey}, existingCreatedAt=${existingCheckpoint.createdAt}, requestedCreatedAt=${validation.createdAt}.`,
    };
  }

  const scheduleSummary = collectScheduleSummaryFromFramesV2_ACU(chat, isolationKey, { maxMessageIndex: target.index })[options.sheetKey];
  const checkpointResult = buildCanonicalSheetCheckpoint_ACU({
    createdAt: validation.createdAt,
    reason: validation.reason,
    sheetKey: options.sheetKey,
    data: normalizedSheetData,
    ...(scheduleSummary ? { scheduleSummary } : {}),
    ...(options.event ? { event: options.event } : {}),
    ...(options.manualRefillProgress ? { manualRefillProgress: options.manualRefillProgress } : {}),
    baseRevision: options.baseRevision !== undefined ? options.baseRevision : options.transactionContext?.baseRevision,
    context: { messageIndex: target.index, isolationKey },
  });
  if (!checkpointResult.checkpoint) return { saved: false, error: checkpointResult.error };
  const checkpoint = checkpointResult.checkpoint;

  const hadIsolatedData = Object.prototype.hasOwnProperty.call(target.message, 'TavernDB_ACU_IsolatedData');
  const previousIsolatedData = target.message.TavernDB_ACU_IsolatedData;
  const hadIdentity = Object.prototype.hasOwnProperty.call(target.message, 'TavernDB_ACU_Identity');
  const previousIdentity = target.message.TavernDB_ACU_Identity;
  frame.perSheetCheckpoints = {
    ...(frame.perSheetCheckpoints || {}),
    [options.sheetKey]: checkpoint,
  };
  try {
    target.message.TavernDB_ACU_IsolatedData = isolatedData;
    writeMessageIdentity_ACU(target.message, {
      enabled: settings_ACU.dataIsolationEnabled,
      code: settings_ACU.dataIsolationCode,
    });
    await saveChatToHost_ACU();
  } catch (error) {
    if (hadIsolatedData) {
      target.message.TavernDB_ACU_IsolatedData = previousIsolatedData;
    } else {
      delete target.message.TavernDB_ACU_IsolatedData;
    }
    if (hadIdentity) {
      target.message.TavernDB_ACU_Identity = previousIdentity;
    } else {
      delete target.message.TavernDB_ACU_Identity;
    }
    throw error;
  }
  logDebug_ACU(`[V2 Persist] 写入单表 checkpoint: messageIndex=${target.index}, sheetKey=${options.sheetKey}, createdAt=${checkpoint.createdAt}`);
  return { saved: true, messageIndex: target.index, checkpoint };
}

/**
 * Persists normalized sheet snapshots after load-time removal of empty row_id rows.
 * This deliberately updates only per-sheet checkpoints: guide, scope, root checkpoint,
 * operation log and independent data outside the target frame remain untouched.
 */
export async function persistNullRowCleanupShards_ACU(
  options: PersistNullRowCleanupShardsOptions_ACU,
): Promise<PersistNullRowCleanupShardsResult_ACU> {
  const requestedEntries = Object.entries(options.sheetDataByKey || {})
    .filter(([sheetKey]) => sheetKey.startsWith('sheet_'));
  if (requestedEntries.length === 0) return { status: 'skipped_no_changes' };

  const sheetKeys = requestedEntries.map(([sheetKey]) => sheetKey);
  if (new Set(sheetKeys).size !== sheetKeys.length) {
    return { status: 'skipped_invalid_data', error: 'null-row cleanup contains duplicate sheetKey.' };
  }

  const createdAt = options.createdAt ?? Date.now();
  if (!Number.isFinite(createdAt) || createdAt < 0) {
    return { status: 'skipped_invalid_data', error: 'null-row cleanup requires a finite non-negative createdAt.' };
  }

  const isolationKey = options.isolationKey ?? getCurrentIsolationKey_ACU();
  try {
    return await runTableWriteTransaction_ACU({
      source: 'system_cleanup',
      reason: 'persistNullRowCleanupShards',
      isolationKey,
      writeSet: sheetKeys.map(sheetKey => ({ kind: 'schema' as const, sheetKey })),
      maintenanceMode: 'exclusive',
    }, async (transactionContext) => transactionContext.runCommit(async () => {
      const chat = getChatArray_ACU();
      const target = findTargetAiMessage_ACU(chat, undefined);
      if (!target) return { status: 'skipped_no_target' };

      const latestFullCheckpoint = findLatestFullCheckpoint_ACU(chat, isolationKey);
      const latestReplayRootIndex = findLatestReplayRootMessageIndex_ACU(chat, isolationKey);
      if (latestReplayRootIndex === null) return { status: 'skipped_no_anchor' };
      if (target.index < latestReplayRootIndex) {
        return {
          status: 'failed',
          error: `null-row cleanup target precedes full checkpoint: targetMessageIndex=${target.index}, latestFullCheckpointIndex=${latestReplayRootIndex}.`,
        };
      }

      transactionContext.assertFresh?.('persistNullRowCleanupShards:before_commit');
      if (chat[target.index] !== target.message || target.message.is_user) {
        return { status: 'failed', error: 'target AI message changed before null-row cleanup persist.' };
      }

      const normalizedSheets = new Map<string, Sheet_ACU>();
      for (const [sheetKey, sourceSheet] of requestedEntries) {
        if (!isObjectRecord_ACU(sourceSheet)) {
          return { status: 'skipped_invalid_data', error: `null-row cleanup requires object sheetData: ${sheetKey}.` };
        }
        const sheetData = deepClone_ACU(sourceSheet);
        const normalization = normalizeCanonicalTableRows_ACU({ [sheetKey]: sheetData });
        if (normalization.errors.length > 0) {
          return { status: 'skipped_invalid_data', error: `null-row cleanup sheet 行标识不合法：${formatCanonicalRowIssues_ACU(normalization.errors)}` };
        }
        if (!Array.isArray(sheetData.content?.[0]) || sheetData.content[0][0] !== 'row_id') {
          return { status: 'skipped_invalid_data', error: `null-row cleanup sheet 缺少 row_id 表头：${sheetKey}.` };
        }
        normalizedSheets.set(sheetKey, sheetData);
      }

      const targetTagData = readIsolatedTagData_ACU(target.message, isolationKey);
      if (!isV2TagData_ACU(targetTagData)) {
        return { status: 'skipped_no_v2_target' };
      }

      const isolatedData = cloneIsolatedData_ACU(target.message) as Record<string, any>;
      const frame = isolatedData[isolationKey]?.storageFrame;
      if (!isV2TagData_ACU(isolatedData[isolationKey]) || !frame) {
        return { status: 'failed', error: 'target V2 frame changed while preparing null-row cleanup persist.' };
      }
      const scheduleSummaryBySheet = collectScheduleSummaryFromFramesV2_ACU(chat, isolationKey, { maxMessageIndex: target.index });
      const checkpoints: TableSheetCheckpointV2_ACU[] = [];
      for (const sheetKey of sheetKeys) {
        const conflictingEntry = (frame.logEntries || []).find((entry: TableMutationLogEntryV2_ACU) => logEntryConflictsWithSheetCheckpoint_ACU(entry, sheetKey));
        if (conflictingEntry) {
          return { status: 'failed', error: `null-row cleanup conflicts with target-sheet log entry: sheetKey=${sheetKey}, entryId=${conflictingEntry.entryId}.` };
        }
        const existingCheckpoint = frame.perSheetCheckpoints?.[sheetKey];
        if (existingCheckpoint && Number(existingCheckpoint.createdAt) > createdAt) {
          return { status: 'failed', error: `null-row cleanup cannot replace newer checkpoint: sheetKey=${sheetKey}, existingCreatedAt=${existingCheckpoint.createdAt}, requestedCreatedAt=${createdAt}.` };
        }
        const scheduleSummary = scheduleSummaryBySheet[sheetKey];
        checkpoints.push({
          kind: 'sheet_full',
          createdAt,
          reason: 'integrity_repair',
          sheetKey,
          data: normalizedSheets.get(sheetKey)!,
          ...(scheduleSummary ? { scheduleSummary: deepClone_ACU(scheduleSummary) } : {}),
          event: { filledSheetKeys: [], changedSheetKeys: [sheetKey] },
          baseRevision: transactionContext.baseRevision,
        });
      }

      const hadIsolatedData = Object.prototype.hasOwnProperty.call(target.message, 'TavernDB_ACU_IsolatedData');
      const previousIsolatedData = target.message.TavernDB_ACU_IsolatedData;
      const hadIdentity = Object.prototype.hasOwnProperty.call(target.message, 'TavernDB_ACU_Identity');
      const previousIdentity = target.message.TavernDB_ACU_Identity;
      try {
        frame.perSheetCheckpoints = {
          ...(frame.perSheetCheckpoints || {}),
          ...Object.fromEntries(checkpoints.map(checkpoint => [checkpoint.sheetKey, checkpoint])),
        };
        target.message.TavernDB_ACU_IsolatedData = isolatedData;
        writeMessageIdentity_ACU(target.message, {
          enabled: settings_ACU.dataIsolationEnabled,
          code: settings_ACU.dataIsolationCode,
        });
        await saveChatToHostStrict_ACU();
        logDebug_ACU(`[V2 Persist] 空 row_id 自愈 shard 已保存: messageIndex=${target.index}, checkpoints=${checkpoints.length}, isolationKey=${isolationKey}`);
        return { status: 'persisted', messageIndex: target.index, checkpoints };
      } catch (error: any) {
        if (hadIsolatedData) target.message.TavernDB_ACU_IsolatedData = previousIsolatedData;
        else delete target.message.TavernDB_ACU_IsolatedData;
        if (hadIdentity) target.message.TavernDB_ACU_Identity = previousIdentity;
        else delete target.message.TavernDB_ACU_Identity;
        try {
          await saveChatToHostStrict_ACU();
        } catch (rollbackError: any) {
          return { status: 'failed', error: `${error?.message || String(error)}；回滚保存也失败：${rollbackError?.message || String(rollbackError)}` };
        }
        return { status: 'failed', error: error?.message || String(error) };
      }
    }, result => result.status === 'persisted'
      ? sheetKeys.map(sheetKey => ({ kind: 'schema' as const, sheetKey }))
      : []));
  } catch (error: any) {
    return { status: 'failed', error: error?.message || String(error) };
  }
}

function templateSheetPersistentProjection_ACU(sheet: Sheet_ACU): Record<string, unknown> {
  return {
    uid: sheet.uid,
    name: sheet.name,
    orderNo: sheet.orderNo,
    content: sheet.content,
    sourceData: sheet.sourceData,
    updateConfig: sheet.updateConfig,
    exportConfig: sheet.exportConfig,
  };
}

function canonicalJson_ACU(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson_ACU).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson_ACU(record[key])}`).join(',')}}`;
}

function templatePersistentProjectionMatches_ACU(
  baselineData: TableDataObject_ACU,
  candidateData: TableDataObject_ACU,
): boolean {
  const project = (data: TableDataObject_ACU): Record<string, unknown> => Object.fromEntries(
    Object.keys(data)
      .filter(key => key.startsWith('sheet_'))
      .sort()
      .map(key => [key, templateSheetPersistentProjection_ACU(data[key] as Sheet_ACU)]),
  );
  return canonicalJson_ACU(project(baselineData)) === canonicalJson_ACU(project(candidateData));
}

/**
 * Persists a chat template selection when reconciliation has proved that no
 * sheet-level storage mutation is necessary. This deliberately remains a
 * separate API: the structural commit entry point must keep rejecting empty
 * change sets so accidental lost migrations cannot be reported as success.
 */
export async function commitCurrentFloorTemplateScopeOnly_ACU(
  options: CommitCurrentFloorTemplateScopeOnlyOptions_ACU,
): Promise<CommitCurrentFloorTemplateChangesResult_ACU> {
  if (!options.guideData || typeof options.guideData !== 'object' || Array.isArray(options.guideData)) {
    return { saved: false, error: 'scope-only 模板提交必须提供有效的 guideData。' };
  }
  if (options.pristineOverride !== true) {
    if (!options.baselineData || !options.candidateData
      || !templatePersistentProjectionMatches_ACU(options.baselineData, options.candidateData)) {
      return { saved: false, error: 'scope-only 模板提交要求 baseline 与 candidate 的持久化 Sheet 投影完全一致。' };
    }
  }
  const createdAt = options.createdAt ?? Date.now();
  if (!Number.isFinite(createdAt) || createdAt < 0) {
    return { saved: false, error: 'scope-only 模板提交 requires a finite non-negative createdAt.' };
  }
  const isolationKey = options.isolationKey ?? getCurrentIsolationKey_ACU();
  try {
    return await runTableWriteTransaction_ACU({
      source: 'template_assistant',
      reason: options.reason || 'commitCurrentFloorTemplateScopeOnly',
      isolationKey,
      writeSet: [{ kind: 'all' }],
      maintenanceMode: 'exclusive',
    }, async transactionContext => transactionContext.runCommit(async () => {
      const chat = getChatArray_ACU();
      if (!Array.isArray(chat) || chat.length === 0) throw new Error('chat history is empty');
      assertTemplateCommitChatContext_ACU(chat, options);
      transactionContext.assertFresh?.('commitCurrentFloorTemplateScopeOnly:before_commit');
      assertTemplateCommitChatContext_ACU(chat, options);
      const previousScopeContainer = cloneOptionalJson_ACU(peekChatScopedConfigContainer_ACU(chat));
      const previousGuideContainer = cloneOptionalJson_ACU(peekChatSheetGuideContainer_ACU(chat));
      try {
        const guideUpdated = setChatSheetGuideDataForIsolationKey_ACU(isolationKey, options.guideData, {
          reason: options.reason || 'chat_template_scope_only',
          syncTemplateScope: true,
          templateSource: options.templateSource,
          presetName: options.presetName,
          source: options.source,
          updatedAt: createdAt,
        });
        if (!guideUpdated) throw new Error('scope-only 模板提交无法写入 guideData 与 template scope。');
        await saveChatToHostStrict_ACU();
        return { saved: true, mode: 'scope_only' as const };
      } catch (error: any) {
        setChatScopedConfigContainer_ACU(chat, previousScopeContainer);
        setChatSheetGuideContainer_ACU(chat, previousGuideContainer);
        try {
          await saveChatToHostStrict_ACU();
        } catch (rollbackError: any) {
          throw new Error(`${error?.message || String(error)}；回滚保存也失败：${rollbackError?.message || String(rollbackError)}`);
        }
        throw error;
      }
    }, []));
  } catch (error: any) {
    return { saved: false, error: error?.message || String(error) };
  }
}

function assertValidTemplateMetaUpdate_ACU(operation: Record<string, any>, sheetKey: string): void {
  if (!isPlainObjectRecord_ACU(operation.meta)) {
    throw new Error(`当前楼层模板提交 meta_update.meta 必须是普通对象：${sheetKey}。`);
  }
  const allowedKeys = new Set(['name', 'orderNo', 'sourceData', 'updateConfig', 'exportConfig']);
  if (Object.keys(operation.meta).some(key => !allowedKeys.has(key))) {
    throw new Error(`当前楼层模板提交 meta_update 包含非法字段：${sheetKey}。`);
  }
  if (operation.meta.name !== undefined && typeof operation.meta.name !== 'string') {
    throw new Error(`当前楼层模板提交 meta_update.name 无效：${sheetKey}。`);
  }
  if (operation.meta.orderNo !== undefined && (typeof operation.meta.orderNo !== 'number' || !Number.isFinite(operation.meta.orderNo))) {
    throw new Error(`当前楼层模板提交 meta_update.orderNo 无效：${sheetKey}。`);
  }
  for (const key of ['sourceData', 'updateConfig', 'exportConfig'] as const) {
    if (operation.meta[key] !== undefined && !isPlainObjectRecord_ACU(operation.meta[key])) {
      throw new Error(`当前楼层模板提交 meta_update.${key} 必须是普通对象：${sheetKey}。`);
    }
  }
  if (operation.meta.sourceData && Object.prototype.hasOwnProperty.call(operation.meta.sourceData, 'ddl')) {
    throw new Error(`当前楼层模板提交禁止 meta_update 修改 sourceData.ddl：${sheetKey}。`);
  }
}

async function assertValidInitialTemplateSnapshot_ACU(
  data: Record<string, any>,
  guideData: Record<string, any>,
  storageMode: StorageMode,
): Promise<void> {
  const mate = data.mate;
  if (!isPlainObjectRecord_ACU(mate) || typeof mate.type !== 'string' || mate.type.length === 0) {
    throw new Error('V2 首次模板提交的 templateSource.mate 无效。');
  }
  if (mate.version !== undefined && (!Number.isFinite(mate.version) || mate.version < 0)) {
    throw new Error('V2 首次模板提交的 templateSource.mate.version 无效。');
  }
  if (mate.updateConfigUiSentinel !== undefined && !Number.isFinite(mate.updateConfigUiSentinel)) {
    throw new Error('V2 首次模板提交的 templateSource.mate.updateConfigUiSentinel 无效。');
  }
  mate.version = mate.version ?? 1;
  mate.updateConfigUiSentinel = mate.updateConfigUiSentinel ?? 0;
  mate.globalInjectionConfig = ensureGlobalInjectionConfigDefaults_ACU(mate.globalInjectionConfig);

  const invalidRootKey = Object.keys(data).find(key => key !== 'mate' && !key.startsWith('sheet_'));
  if (invalidRootKey) {
    throw new Error(`V2 首次模板提交的 templateSource 包含非法根字段：${invalidRootKey}。`);
  }
  const sheetKeys = Object.keys(data).filter(key => key.startsWith('sheet_')).sort();
  if (sheetKeys.length === 0) {
    throw new Error('V2 首次模板提交的 templateSource 不包含任何 Sheet。');
  }
  const normalizedGuideData = normalizeGuideData_ACU(deepClone_ACU(guideData));
  if (!normalizedGuideData) {
    throw new Error('V2 首次模板提交的 guideData 无法规范化。');
  }
  const guideSheetKeys = Object.keys(normalizedGuideData).filter(key => key.startsWith('sheet_')).sort();
  if (sheetKeys.length !== guideSheetKeys.length || sheetKeys.some((key, index) => key !== guideSheetKeys[index])) {
    throw new Error('V2 首次模板提交的 templateSource 与 guideData 的 Sheet 集合不一致。');
  }

  for (const sheetKey of sheetKeys) {
    const sheet = data[sheetKey];
    if (!sheetIsValidForIntroductionHistory_ACU(sheet)) {
      throw new Error(`V2 首次模板提交的 templateSource 包含无效 Sheet：${sheetKey}。`);
    }
    if (sheet.content.length === 0 || sheet.content[0].length === 0 || sheet.content[0][0] !== 'row_id') {
      throw new Error(`V2 首次模板提交的 templateSource Sheet 缺少 row_id 表头：${sheetKey}。`);
    }
    if (storageMode === 'sqlite') {
      if (!String(sheet.sourceData.ddl || '').trim()) {
        sheet.sourceData.ddl = generateDDL(sheet as Sheet_ACU, sheet.uid || sheetKey);
      }
      const ddlValidation = validateDDLTextAgainstHeaders_ACU(sheet.sourceData.ddl, sheet.content[0]);
      if (!ddlValidation.valid) {
        throw new Error(`V2 首次模板提交的 templateSource Sheet DDL 无法 strict hydrate：${sheetKey}：${ddlValidation.message}`);
      }
      try {
        createSheetInsertPlan(sheet as Sheet_ACU);
      } catch (error: any) {
        throw new Error(`V2 首次模板提交的 templateSource Sheet 无法 hydrate：${sheetKey}：${error?.message || String(error)}`);
      }
    }
  }
  if (storageMode === 'sqlite') {
    try {
      // 持久化契约校验路径：这里刻意保持严格（不传 allowRuntimeDdlFallback）。
      // 若在此降级，非法显式 DDL 会以全 TEXT fallback schema 进入权威 V2 快照，
      // 后续读取得到的是与用户编写 DDL 不符的结构，且损坏点离修改点很远。
      // 运行时注入/协调路径（template-state-reset / chat-template-reconciler）才允许降级。
      await hydrateTableDataStrict_ACU(data);
    } catch (error: any) {
      throw new Error(`V2 首次模板提交的完整 templateSource 无法通过 SQLite strict hydrate：${error?.message || String(error)}`);
    }
  }
}

const TEMPLATE_DELETE_MESSAGE_FIELDS_ACU = [
  'TavernDB_ACU_IsolatedData',
  'TavernDB_ACU_Identity',
  'TavernDB_ACU_IndependentData',
  'TavernDB_ACU_Data',
  'TavernDB_ACU_SummaryData',
  'TavernDB_ACU_ModifiedKeys',
  'TavernDB_ACU_UpdateGroupKeys',
] as const;

type TemplateDeleteMessageSnapshot_ACU = {
  message: Record<string, any>;
  fields: Map<string, { hadValue: boolean; value: unknown }>;
};

function normalizeDeletedTemplateSheetKeys_ACU(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('当前楼层模板提交的 deletedSheetKeys 必须为数组。');
  const keys = value.map(key => String(key || ''));
  if (keys.some(key => !key.startsWith('sheet_'))) throw new Error('当前楼层模板提交包含非法 deletedSheetKey。');
  if (new Set(keys).size !== keys.length) throw new Error('当前楼层模板提交不能包含重复 deletedSheetKey。');
  return keys;
}

function snapshotTemplateDeleteMessages_ACU(chat: unknown[], deepCloneValues: boolean): TemplateDeleteMessageSnapshot_ACU[] {
  const snapshots: TemplateDeleteMessageSnapshot_ACU[] = [];
  for (const message of chat) {
    if (!message || (message as any).is_user || typeof message !== 'object') continue;
    const messageRecord = message as Record<string, any>;
    snapshots.push({
      message: messageRecord,
      fields: new Map(TEMPLATE_DELETE_MESSAGE_FIELDS_ACU.map(field => [field, {
        hadValue: Object.prototype.hasOwnProperty.call(messageRecord, field),
        value: deepCloneValues ? cloneOptionalJson_ACU(messageRecord[field]) : messageRecord[field],
      }])),
    });
  }
  return snapshots;
}

function restoreTemplateDeleteMessageSnapshots_ACU(snapshots: TemplateDeleteMessageSnapshot_ACU[]): void {
  for (const snapshot of snapshots) {
    for (const [field, previous] of snapshot.fields) {
      if (previous.hadValue) snapshot.message[field] = previous.value;
      else delete snapshot.message[field];
    }
  }
}

function assertValidTemplateSheetChanges_ACU(sheetChanges: TemplateSheetChange_ACU[], deletedSheetKeys: string[]): void {
  if (sheetChanges.length === 0 && deletedSheetKeys.length === 0) {
    throw new Error('当前楼层模板提交必须至少包含一个 sheet change 或 deletedSheetKey。');
  }
  const sheetKeys = sheetChanges.map(change => String(change?.sheetKey || ''));
  if (sheetKeys.some(sheetKey => !sheetKey.startsWith('sheet_'))) {
    throw new Error('当前楼层模板提交包含非法 sheetKey。');
  }
  if (new Set(sheetKeys).size !== sheetKeys.length) {
    throw new Error('当前楼层模板提交不能包含重复 sheetKey。');
  }
  if (sheetKeys.some(sheetKey => deletedSheetKeys.includes(sheetKey))) {
    throw new Error('当前楼层模板提交不能同时删除和变更同一 sheetKey。');
  }
  for (const change of sheetChanges) {
    if (change.kind === 'introduction' || change.kind === 'rebase' || change.kind === 'reveal' || change.kind === 'hide') {
      if (!isObjectRecord_ACU(change.sheetData)) throw new Error(`当前楼层模板提交缺少可恢复 Sheet：${change.sheetKey}。`);
      continue;
    }
    if (change.kind !== 'operations' || !isObjectRecord_ACU(change.targetSheetData) || !Array.isArray(change.operations) || change.operations.length === 0) {
      throw new Error(`当前楼层模板提交 operations action 无效：${change.sheetKey}。`);
    }
    let migrationCount = 0;
    let metaUpdateCount = 0;
    for (const operation of change.operations) {
      if (!operation || (operation.kind !== 'sheet_schema_migrate' && operation.kind !== 'meta_update') || operation.sheetKey !== change.sheetKey) {
        throw new Error(`当前楼层模板提交包含不允许或归属错误的 operation：${change.sheetKey}。`);
      }
      if (operation.kind === 'sheet_schema_migrate') {
        migrationCount += 1;
        if (!migrationIsValidForIntroductionHistory_ACU(operation as Record<string, any>)) {
          throw new Error(`当前楼层模板提交包含畸形 sheet_schema_migrate：${change.sheetKey}。`);
        }
      }
      if (operation.kind === 'meta_update') {
        metaUpdateCount += 1;
        assertValidTemplateMetaUpdate_ACU(operation, change.sheetKey);
      }
    }
    if (migrationCount > 1 || metaUpdateCount > 1 || (migrationCount === 1 && change.operations[0].kind !== 'sheet_schema_migrate')) {
      throw new Error(`当前楼层模板提交 operation 顺序或数量无效：${change.sheetKey}。`);
    }
  }
}

/**
 * 在当前最新 AI 楼层原子写入模板结构变更。
 *
 * 单表 checkpoint API 自带宿主保存，不能用于这里；本函数先完成所有内存写入，
 * 再严格保存一次，失败时恢复 storage frame、guide 与 template scope。
 */
export async function commitCurrentFloorTemplateChanges_ACU(
  options: CommitCurrentFloorTemplateChangesOptions_ACU,
): Promise<CommitCurrentFloorTemplateChangesResult_ACU> {
  if (!options.guideData || typeof options.guideData !== 'object' || Array.isArray(options.guideData)) {
    return { saved: false, error: '当前楼层模板提交必须提供有效的 guideData。' };
  }
  const requestedChanges = Array.isArray(options.sheetChanges) ? options.sheetChanges : [];
  let deletedSheetKeys: string[];
  try {
    deletedSheetKeys = normalizeDeletedTemplateSheetKeys_ACU(options.deletedSheetKeys);
    assertValidTemplateSheetChanges_ACU(requestedChanges, deletedSheetKeys);
  } catch (error: any) {
    return { saved: false, error: error?.message || String(error) };
  }
  const sheetKeys = [...new Set([...requestedChanges.map(change => change.sheetKey), ...deletedSheetKeys])];
  const storageMode = options.storageMode === 'native' ? 'native' : 'sqlite';
  const createdAt = options.createdAt ?? Date.now();
  if (!Number.isFinite(createdAt) || createdAt < 0) {
    return { saved: false, error: '当前楼层模板提交 requires a finite non-negative createdAt.' };
  }

  const isolationKey = options.isolationKey ?? getCurrentIsolationKey_ACU();
  const writeSet = sheetKeys.map(sheetKey => ({ kind: 'schema' as const, sheetKey }));
  try {
    return await runTableWriteTransaction_ACU({
    source: 'template_assistant',
    reason: options.reason || 'commitCurrentFloorTemplateChanges',
    isolationKey,
    writeSet,
    maintenanceMode: 'exclusive',
    baseRevision: options.baseRevision,
  }, async (transactionContext) => transactionContext.runCommit(async () => {
    const chat = getChatArray_ACU();
    if (!Array.isArray(chat) || chat.length === 0) {
      throw new Error('chat history is empty');
    }
    assertTemplateCommitChatContext_ACU(chat, options);

    const latestAiTarget = findTargetAiMessage_ACU(chat, undefined);
    const target = findTargetAiMessage_ACU(chat, options.targetMessageIndex);
    if (!latestAiTarget || !target) {
      throw new Error('当前聊天不存在可提交的 AI 楼层。');
    }
    if (target.index !== latestAiTarget.index) {
      throw new Error(`当前楼层模板提交只能写入最新 AI 楼层：requested=${target.index}, latest=${latestAiTarget.index}。`);
    }

    let storageState = classifyTemplateCommitStorageState_ACU(chat, isolationKey);
    if (storageState.kind === 'legacy_persisted_data') {
      const storageStateAfterDeletedSheets = classifyTemplateCommitStorageStateAfterDeletedSheets_ACU(chat, isolationKey, deletedSheetKeys);
      if (storageStateAfterDeletedSheets.kind === 'legacy_persisted_data') {
        throw new Error(`当前楼层模板提交检测到 legacy 持久化数据，必须先完成迁移：${storageStateAfterDeletedSheets.details.join(', ')}。`);
      }
      storageState = storageStateAfterDeletedSheets;
    }
    if (storageState.kind === 'orphan_v2_artifacts') {
      throw new Error(`当前楼层模板提交检测到缺少 full checkpoint 的 V2 存储痕迹，已拒绝覆盖：${storageState.details.join(', ')}。`);
    }
    const latestFullCheckpoint = storageState.kind === 'existing_full_checkpoint'
      ? storageState.checkpoint
      : null;
    if (latestFullCheckpoint && target.index < latestFullCheckpoint.index) {
      throw new Error(`V2 当前楼层模板提交目标早于最近 full checkpoint：targetMessageIndex=${target.index}, latestFullCheckpointIndex=${latestFullCheckpoint.index}。`);
    }

    transactionContext.assertFresh?.('commitCurrentFloorTemplateChanges:before_commit');
    assertTemplateCommitChatContext_ACU(chat, options);
    if (chat[target.index] !== target.message || target.message.is_user) {
      throw new Error('target AI message changed before template commit; abort stale table write.');
    }

    if (storageState.kind === 'pristine_without_checkpoint') {
      if (!isObjectRecord_ACU(options.templateSource)) {
        throw new Error('预填表模板提交必须提供完整有效的 templateSource。');
      }
      const templateSnapshot = deepClone_ACU(options.templateSource);
      // 这条分支不做增量删除：checkpoint 完全由 templateSource 重建，且此时没有任何
      // 历史楼层数据需要回溯清理。因此删除只要求「被删表确实已不在新快照里」，
      // 快照仍保留该表说明调用方状态不一致，必须拒绝而不是静默放行。
      const staleDeletedSheetKeys = deletedSheetKeys.filter(sheetKey => sheetKey in templateSnapshot);
      if (staleDeletedSheetKeys.length > 0) {
        throw new Error(`预填表模板提交的 templateSource 仍包含已删除 Sheet：${staleDeletedSheetKeys.join(', ')}。`);
      }
      await assertValidInitialTemplateSnapshot_ACU(templateSnapshot, options.guideData, storageMode);
      assertTemplateCommitChatContext_ACU(chat, options);
      for (const change of requestedChanges) {
        // hide 的语义就是把该表从活跃模板中移除，因此它不会出现在新的 templateSource
        // 快照里；这里要求快照包含它会让「隐藏表 + 无 checkpoint」的切换直接失败。
        if (change.kind === 'hide') continue;
        const snapshotSheet: unknown = templateSnapshot[change.sheetKey];
        if (!isObjectRecord_ACU(snapshotSheet) || !Array.isArray(snapshotSheet.content)) {
          throw new Error(`预填表模板提交的 templateSource 缺少变更 Sheet：${change.sheetKey}。`);
        }
        const expectedSheet = deepClone_ACU(change.kind === 'operations' ? change.targetSheetData : change.sheetData);
        const expectedNormalization = normalizeCanonicalTableRows_ACU({ [change.sheetKey]: expectedSheet });
        if (expectedNormalization.errors.length > 0) {
          throw new Error(`预填表模板提交目标 Sheet 行标识不合法：${formatCanonicalRowIssues_ACU(expectedNormalization.errors)}`);
        }
        if (storageMode === 'sqlite') {
          if (!expectedSheet.sourceData || typeof expectedSheet.sourceData !== 'object') expectedSheet.sourceData = {} as any;
          if (!String(expectedSheet.sourceData.ddl || '').trim()) {
            expectedSheet.sourceData.ddl = generateDDL(expectedSheet, expectedSheet.uid || change.sheetKey);
          }
        }
        if (canonicalJson_ACU(templateSheetPersistentProjection_ACU(snapshotSheet as Sheet_ACU)) !== canonicalJson_ACU(templateSheetPersistentProjection_ACU(expectedSheet))) {
          throw new Error(`预填表模板提交的 templateSource 与目标 Sheet 不一致：${change.sheetKey}。`);
        }
      }
      const previousScopeContainer = cloneOptionalJson_ACU(peekChatScopedConfigContainer_ACU(chat));
      const previousGuideContainer = cloneOptionalJson_ACU(peekChatSheetGuideContainer_ACU(chat));
      const messageSnapshots = snapshotTemplateDeleteMessages_ACU(chat, true);
      try {
        const checkpointData = deepClone_ACU(templateSnapshot);
        const checkpointSheets = Object.keys(checkpointData).filter(key => key.startsWith('sheet_')).sort();
        for (const sheetKey of checkpointSheets) {
          const sheet = checkpointData[sheetKey] as Sheet_ACU;
          sheet.content = [deepClone_ACU(sheet.content[0])];
        }
        const checkpointResult = buildCanonicalFullCheckpoint_ACU({
          createdAt,
          reason: 'init',
          data: checkpointData as TableDataObject_ACU,
          event: { filledSheetKeys: [], changedSheetKeys: checkpointSheets, groupKeys: [] },
          context: { messageIndex: target.index, aiFloor: countAiFloor_ACU(chat, target.index), isolationKey },
        });
        if (!checkpointResult.checkpoint) throw new Error(checkpointResult.error);

        const initialSheetCheckpoints: TableSheetCheckpointV2_ACU[] = [];
        for (const sheetKey of checkpointSheets) {
          const sheetCheckpointResult = buildCanonicalSheetCheckpoint_ACU({
            createdAt,
            reason: 'schema_change',
            sheetKey,
            data: checkpointData[sheetKey] as Sheet_ACU,
            event: { filledSheetKeys: [], changedSheetKeys: [sheetKey], groupKeys: [] },
            baseRevision: options.baseRevision !== undefined ? options.baseRevision : transactionContext.baseRevision,
            context: { messageIndex: target.index, aiFloor: countAiFloor_ACU(chat, target.index), isolationKey },
          });
          if (!sheetCheckpointResult.checkpoint) throw new Error(sheetCheckpointResult.error);
          initialSheetCheckpoints.push(sheetCheckpointResult.checkpoint);
        }

        const isolatedData = cloneIsolatedData_ACU(target.message) as Record<string, any>;
        const frame = getOrInitV2Frame_ACU(isolatedData, isolationKey);
        frame.checkpoint = checkpointResult.checkpoint;
        frame.perSheetCheckpoints = Object.fromEntries(initialSheetCheckpoints.map(checkpoint => [checkpoint.sheetKey, checkpoint]));
        frame.logEntries = [];
        frame.headRevision = buildCommitRevision_ACU('checkpoint', generateEntryId_ACU());
        target.message.TavernDB_ACU_IsolatedData = isolatedData;
        writeMessageIdentity_ACU(target.message, {
          enabled: settings_ACU.dataIsolationEnabled,
          code: settings_ACU.dataIsolationCode,
        });
        const guideUpdated = setChatSheetGuideDataForIsolationKey_ACU(isolationKey, options.guideData, {
          reason: options.reason || 'visualizer_v2_template_only',
          syncTemplateScope: true,
          templateSource: templateSnapshot,
          presetName: options.presetName,
          source: options.source,
          updatedAt: createdAt,
        });
        if (!guideUpdated) throw new Error('预填表模板提交无法原子写入 guideData 与 template scope。');
        assertTemplateCommitChatContext_ACU(chat, options);
        await saveChatToHostStrict_ACU();
        return { saved: true, mode: 'v2_commit', messageIndex: target.index, checkpoints: initialSheetCheckpoints, removedNullRowCount: 0 };
      } catch (error: any) {
        restoreTemplateDeleteMessageSnapshots_ACU(messageSnapshots);
        setChatScopedConfigContainer_ACU(chat, previousScopeContainer);
        setChatSheetGuideContainer_ACU(chat, previousGuideContainer);
        try {
          await saveChatToHostStrict_ACU();
        } catch (rollbackError: any) {
          throw new Error(`${error?.message || String(error)}；回滚保存也失败：${rollbackError?.message || String(rollbackError)}`);
        }
        throw error;
      }
    }

    // 目标楼层缺合法 V2 frame 时按 getOrInitV2Frame_ACU 语义初始化空 frame。
    // 但必须区分"缺 frame"（可初始化）与"frame 畸形"（必须先修复）：
    // 有 V2 历史 marker（hasV2TableHistoryEvidence_ACU=true）却非合法 V2，
    // 说明是损坏的存储痕迹，绝不能当作缺 frame 静默初始化覆盖。
    const targetTagData = readIsolatedTagData_ACU(target.message, isolationKey);
    if (targetTagData !== null
      && !isV2TagData_ACU(targetTagData)
      && hasV2TableHistoryEvidence_ACU(targetTagData)) {
      throw new Error('当前楼层模板提交检测到目标 AI 楼层存在损坏的 V2 storage frame；请先完成修复迁移。');
    }

    const messageSnapshots = snapshotTemplateDeleteMessages_ACU(chat, deletedSheetKeys.length > 0);
    const previousScopeContainer = cloneOptionalJson_ACU(peekChatScopedConfigContainer_ACU(chat));
    const previousGuideContainer = cloneOptionalJson_ACU(peekChatSheetGuideContainer_ACU(chat));
    let primarySaveAttempted = false;
    let sharedStateMutated = false;
    let convergenceRootSnapshot: { message: any; hadIsolatedData: boolean; isolatedData: unknown } | null = null;
    let purgedMessageCount = 0;
    let hardDeleteCheckpointCreated = false;

    try {
    const introductionSheets = new Map<string, Sheet_ACU>();
    const rebaseSheets = new Map<string, Sheet_ACU>();
    const revealSheets = new Map<string, Sheet_ACU>();
    const hideSheetKeys = new Set<string>();
    let removedNullRowCount = 0;
    for (const change of requestedChanges) {
      if (change.kind === 'hide') {
        hideSheetKeys.add(change.sheetKey);
        continue;
      }
      const targetSheetData = deepClone_ACU(change.kind === 'operations' ? change.targetSheetData : change.sheetData);
      // introduction 允许两种形态：header-only 空壳（首次填表前可改结构），
      // 或模板自带数据的整表（作者已定义初始格式，引入时即落盘）。
      if (change.kind === 'introduction' && !Array.isArray(targetSheetData.content?.[0])) {
        throw new Error(`V2 sheet introduction requires a header row: sheetKey=${change.sheetKey}.`);
      }
      const normalization = normalizeCanonicalTableRows_ACU({ [change.sheetKey]: targetSheetData });
      removedNullRowCount += normalization.removedRows.length;
      if (normalization.errors.length > 0) {
        throw new Error(`V2 当前楼层模板提交行标识不合法：${formatCanonicalRowIssues_ACU(normalization.errors)}`);
      }
      const headers = targetSheetData.content?.[0];
      if (!Array.isArray(headers) || headers[0] !== 'row_id') {
        throw new Error(`V2 当前楼层模板提交缺少 row_id 表头：${change.sheetKey}。`);
      }
      if (storageMode === 'sqlite') {
        if (!targetSheetData.sourceData || typeof targetSheetData.sourceData !== 'object') targetSheetData.sourceData = {} as any;
        if (!String(targetSheetData.sourceData.ddl || '').trim()) {
          targetSheetData.sourceData.ddl = generateDDL(targetSheetData, targetSheetData.uid || change.sheetKey);
        }
        const ddlValidation = validateDDLTextAgainstHeaders_ACU(targetSheetData.sourceData.ddl, headers);
        if (!ddlValidation.valid) {
          throw new Error(`V2 当前楼层模板提交 DDL 无法 strict hydrate：${change.sheetKey}：${ddlValidation.message}`);
        }
        createSheetInsertPlan(targetSheetData);
      }
      if (change.kind === 'introduction') introductionSheets.set(change.sheetKey, targetSheetData);
      else if (change.kind === 'rebase') rebaseSheets.set(change.sheetKey, targetSheetData);
      else if (change.kind === 'reveal') revealSheets.set(change.sheetKey, targetSheetData);
    }

    let isolatedData = cloneIsolatedData_ACU(target.message) as Record<string, any>;
    // 缺 frame 时由 getOrInitV2Frame_ACU 初始化空 frame（version:2, logEntries:[]），
    // 保留既有 summaryVectorIndexState / summaryVectorIndexManifest。
    const frame = getOrInitV2Frame_ACU(isolatedData, isolationKey);
    if (!isV2TagData_ACU(isolatedData[isolationKey])) {
      throw new Error('目标 V2 storage frame 在模板提交准备期间发生变化。');
    }
    const activeReplay = await loadTableStateFromFramesV2Detailed_ACU(chat, isolationKey, { maxMessageIndex: target.index, updateRuntimeState: false });
    assertTemplateCommitChatContext_ACU(chat, options);
    if (!activeReplay) {
      throw new Error('V2 当前楼层模板提交无法解析 active full checkpoint replay state。');
    }
    // 收敛会清空候选 frame 的 per-sheet checkpoints；先按目标 key 捕获不可变副本，
    // 仅供同楼层 reveal 在 bounded replay 找不到可见来源时使用。
    const revealCheckpointSources = new Map<string, unknown>();
    for (const change of requestedChanges.filter(item => item.kind === 'introduction')) {
      const checkpoint = frame.perSheetCheckpoints?.[change.sheetKey];
      if (checkpoint !== undefined) revealCheckpointSources.set(change.sheetKey, deepClone_ACU(checkpoint));
    }
    if (activeReplay.requiresCheckpointConvergence || activeReplay.compatibilityRepairs?.length) {
      if (!activeReplay.compatibilityRepairs?.length
        || hasStructuralReplayCompatibilityRepairs_ACU(activeReplay.compatibilityRepairs)) {
        const affectedSheetKeys = [...new Set((activeReplay.compatibilityRepairs || []).map(repair => repair.sheetKey))];
        throw new Error(
          `V2 当前楼层模板提交检测到结构性 replay repair，不能自动收敛或继续写入：${affectedSheetKeys.join('、') || '未知 Sheet'}。`,
        );
      }
      const invariantViolation = assertSingleActiveFullCheckpointV2_ACU(
        chat,
        isolationKey,
        'commitCurrentFloorTemplateChanges_ACU:convergence',
      );
      if (invariantViolation) throw new Error(invariantViolation);
      if (!latestFullCheckpoint) {
        throw new Error('V2 当前楼层模板提交收敛缺少既有 full checkpoint 根，已拒绝。');
      }
      const anchorData = resolveConvergenceAnchorSheetData_ACU(
        chat,
        isolationKey,
        activeReplay.compatibilityRepairs || [],
      );
      if (anchorData.error) {
        throw new Error(anchorData.error);
      }
      // 同一隔离键同一时刻只有一个 full checkpoint：convergence 只在既有 full 根帧
      // 写 per-sheet 锚点（untimed），绝不第二个 full，否则回放根被抢占。
      // recoveryBackup 必须备份收敛前的原始帧（不含锚点），证据不掺入本次修改。
      const previousFrame = deepClone_ACU(frame);
      const rootIsolatedData = latestFullCheckpoint.index === target.index
        ? isolatedData
        : cloneIsolatedData_ACU(chat[latestFullCheckpoint.index]) as Record<string, any>;
      const rootFrame = getOrInitV2Frame_ACU(rootIsolatedData, isolationKey);
      const rootWrite = writeSheetAnchorCheckpointsToFrame_ACU(
        rootFrame,
        anchorData.bySheetKey,
        createdAt,
        undefined,
        { messageIndex: latestFullCheckpoint.index, aiFloor: countAiFloor_ACU(chat, latestFullCheckpoint.index), isolationKey },
      );
      if (rootWrite.ok === false) {
        throw new Error(rootWrite.error);
      }
      if (latestFullCheckpoint.index !== target.index) {
        // 根帧不在当前目标：把带锚点的 isolatedData 挂回真实根消息，随候选保存落盘。
        const rootMessage = chat[latestFullCheckpoint.index];
        convergenceRootSnapshot = { message: rootMessage, hadIsolatedData: Object.prototype.hasOwnProperty.call(rootMessage, 'TavernDB_ACU_IsolatedData'), isolatedData: rootMessage.TavernDB_ACU_IsolatedData };
        chat[latestFullCheckpoint.index].TavernDB_ACU_IsolatedData = rootIsolatedData;
        // 根消息已实际修改：若后续（候选验证等）抛错，必须参与回滚还原。
        sharedStateMutated = true;
      } else {
        // 根帧即目标帧：锚点已写入 frame（isolatedData 同一对象），无需额外挂回。
        isolatedData = rootIsolatedData;
      }
      const tagData = isolatedData[isolationKey];
      if (!isV2TagData_ACU(tagData)) {
        throw new Error('V2 当前楼层模板提交在 provisional 收敛准备期间缺少有效 storage frame。');
      }
      tagData.recoveryBackup = {
        version: 1,
        createdAt,
        recoveryKind: 'temporary_sheet_anchor_convergence',
        sourceMessageIndex: target.index,
        storageFrame: previousFrame,
      } satisfies TableV2RecoveryBackup_ACU;
      logDebug_ACU(`[V2 Persist] 当前楼层模板提交已在既有 full 根帧收敛 provisional Sheet 补锚：messageIndex=${target.index}, rootIndex=${latestFullCheckpoint.index}。`);

    }
    const activeReplayState = activeReplay.data;
    const checkpoints: TableSheetCheckpointV2_ACU[] = [];
    const scheduleSummaryBySheet = collectScheduleSummaryFromFramesV2_ACU(chat, isolationKey, { maxMessageIndex: target.index });
    const targetFrameLastLogSeq = getValidatedFrameLastLogSeq_ACU(frame);
    // reveal 目标集合：包括显式 reveal change，以及"introduction 但历史存在(active 无)"自动转 reveal 的 sheetKey。
    const revealDataBySheet = new Map<string, Sheet_ACU>();
    for (const change of requestedChanges.filter(item => item.kind === 'introduction')) {
      // 是否“仍活跃”只由 replay 后的 active state 判定。
      //
      // perSheetCheckpoints 只是历史痕迹：表可能经由 hide、data_replace 或早期删除逻辑
      // 离开 active state，却仍留下一个没有 hide timeline 的 sheet checkpoint。
      // 把这种痕迹当作“仍活跃”，会让重新切回带该表的模板时走不到下面的唤醒分支，
      // 被误判成“重复引入”直接拒绝。历史里存在过的表由 history evidence 分支负责唤醒。
      const activeHas = Object.prototype.hasOwnProperty.call(activeReplayState, change.sheetKey);
      const historyEvidence = introductionHistoryEvidence_ACU(chat, isolationKey, target.index, change.sheetKey);
      logDebug_ACU(`[V2 Persist] introduction_lifecycle_decision: requestId=${options.requestId || 'unknown'}, sheetKey=${change.sheetKey}, activeHas=${activeHas}, history=${historyEvidence.status}, historyMessageIndex=${historyEvidence.messageIndex ?? 'none'}, historyArtifact=${historyEvidence.artifactKind || 'none'}。`);
      if (activeHas) {
        // 仍活跃：既非全新，也非可恢复的隐藏表。绝不能让模板 introduction 覆盖活数据。
        // 正常的 stale plan 应先被 baseRevision 拦截；保留这里作为跨入口/异常状态的最终保险。
        logDebug_ACU(`[V2 Persist] active_introduction_conflict: requestId=${options.requestId || 'unknown'}, sheetKey=${change.sheetKey}, messageIndex=${target.index}, baseRevision=${options.baseRevision ?? transactionContext.baseRevision ?? 'unknown'}。`);
        throw new Error(
          `V2 active_introduction_conflict: 当前模板计划尝试将仍在使用的表作为新表引入，已拒绝覆盖已有数据：sheetKey=${change.sheetKey}，requestId=${options.requestId || 'unknown'}。请重新读取当前表格后重试。`,
        );
      }
      if (historyEvidence.status === 'indeterminate') {
        logDebug_ACU(`[V2 Persist] history_indeterminate: requestId=${options.requestId || 'unknown'}, sheetKey=${change.sheetKey}, messageIndex=${historyEvidence.messageIndex ?? 'unknown'}, artifact=${historyEvidence.artifactKind || 'unknown'}, reason=${historyEvidence.reason || 'unknown'}。`);
        throw new Error(
          `V2 history_indeterminate: sheetKey=${change.sheetKey}, messageIndex=${historyEvidence.messageIndex ?? 'unknown'}, `
          + `artifact=${historyEvidence.artifactKind || 'unknown'}, reason=${historyEvidence.reason || 'unknown'}.`,
        );
      }
      if (historyEvidence.status === 'present' || historyEvidence.status === 'may_exist') {
        // present：历史确实曾有该表（可恢复的隐藏表）。
        // may_exist：只有归属未知的全局 artifact（sql_batch / table_edit_dsl），
        //   无法证明也无法证伪。此时不能直接当作全新表引入（可能覆盖真实历史数据），
        //   必须先尝试定位可信恢复来源；只有 bounded replay 在全部历史边界都找不到
        //   该表可见数据时，才可安全回落 introduction。
        // 优先使用生命周期派生的最后 hide checkpoint（含完整退出数据），仅在缺少可信
        // hide checkpoint 时才退回逐边界 bounded replay（兼容旧历史）。
        const preferredHideCheckpoint = frame.perSheetCheckpoints?.[change.sheetKey];
        const revealSource = await resolveRevealSource_ACU(
          chat,
          isolationKey,
          target.index,
          change.sheetKey,
          preferredHideCheckpoint,
          revealCheckpointSources.get(change.sheetKey),
        );
        assertTemplateCommitChatContext_ACU(chat, options);
        if (revealSource.status === 'resolved') {
          // 能定位到可信历史可见数据 → 曾被隐藏的表，reveal 恢复"离开时最新状态"（语义1）。
          logDebug_ACU(`[V2 Persist] reveal_source_resolved: requestId=${options.requestId || 'unknown'}, sheetKey=${change.sheetKey}, sourceKind=${revealSource.sourceKind}, sourceMessageIndex=${revealSource.messageIndex}。`);
          revealDataBySheet.set(change.sheetKey, revealSource.sheetData);
          continue;
        }
        if (revealSource.status === 'indeterminate') {
          logDebug_ACU(`[V2 Persist] reveal_source_indeterminate: requestId=${options.requestId || 'unknown'}, sheetKey=${change.sheetKey}, historyMessageIndex=${historyEvidence.messageIndex ?? 'unknown'}, reason=${revealSource.reason}。`);
          throw new Error(`V2 reveal_source_indeterminate: sheetKey=${change.sheetKey}, reason=${revealSource.reason}。`);
        }
        // revealSource.status === 'not_found'
        if (historyEvidence.status === 'present') {
          // 有确定的历史存在证据却找不到恢复来源：状态不一致，保持 fail-closed。
          logDebug_ACU(`[V2 Persist] reveal_source_missing: requestId=${options.requestId || 'unknown'}, sheetKey=${change.sheetKey}, historyMessageIndex=${historyEvidence.messageIndex ?? 'unknown'}。`);
          throw new Error(`V2 reveal_source_missing: sheetKey=${change.sheetKey} 有历史存在证据但无法定位可信恢复来源，已拒绝写入。`);
        }
        // may_exist + not_found：bounded replay 已扫过全部历史边界且该表从未可见，
        // 说明那条全局 artifact 并未真的建立过该表。此时按全新表 introduction 处理
        // 不会覆盖任何真实数据，落到下面的 introduction 分支。
        logDebug_ACU(`[V2 Persist] may_exist_falls_back_to_introduction: requestId=${options.requestId || 'unknown'}, sheetKey=${change.sheetKey}, historyMessageIndex=${historyEvidence.messageIndex ?? 'unknown'}。`);
      }
      // 真正全新表：走 introduction。
      const existingCheckpoint = frame.perSheetCheckpoints?.[change.sheetKey];
      if (existingCheckpoint && Number(existingCheckpoint.createdAt) > createdAt) {
        throw new Error(`V2 sheet checkpoint cannot replace a newer checkpoint: sheetKey=${change.sheetKey}, existingCreatedAt=${existingCheckpoint.createdAt}, requestedCreatedAt=${createdAt}.`);
      }
      const scheduleSummary = scheduleSummaryBySheet[change.sheetKey];
      checkpoints.push({
        kind: 'sheet_full',
        createdAt,
        reason: 'schema_change',
        sheetKey: change.sheetKey,
        data: introductionSheets.get(change.sheetKey)!,
        ...(scheduleSummary ? { scheduleSummary: deepClone_ACU(scheduleSummary) } : {}),
        event: { filledSheetKeys: [], changedSheetKeys: [change.sheetKey] },
        timeline: {
          kind: 'sheet_introduction' as const,
          activateAtMessageIndex: target.index,
          afterSeq: targetFrameLastLogSeq,
        },
        baseRevision: options.baseRevision !== undefined ? options.baseRevision : transactionContext.baseRevision,
      });
    }

    // 显式 reveal change：恢复"离开时最新可信数据"。
    // 协调器只带模板结构（可能是 header-only 空壳），数据恢复必须以历史为准：
    // 优先使用生命周期派生的最后 hide checkpoint（data 保留退出前完整数据），
    // 缺失时退回逐边界 bounded replay（兼容旧历史）；两者都不可信才 fail-closed；
    // 仅当历史上完全不存在该表（not_found）时才回退 caller 的模板结构（语义同 introduction）。
    for (const change of requestedChanges.filter(item => item.kind === 'reveal')) {
      const preferredHideCheckpoint = frame.perSheetCheckpoints?.[change.sheetKey];
      const revealSource = await resolveRevealSource_ACU(
        chat,
        isolationKey,
        target.index,
        change.sheetKey,
        preferredHideCheckpoint,
        revealCheckpointSources.get(change.sheetKey),
      );
      assertTemplateCommitChatContext_ACU(chat, options);
      if (revealSource.status === 'resolved') {
        logDebug_ACU(`[V2 Persist] reveal_source_resolved: requestId=${options.requestId || 'unknown'}, sheetKey=${change.sheetKey}, sourceKind=${revealSource.sourceKind}, sourceMessageIndex=${revealSource.messageIndex}。`);
        revealDataBySheet.set(change.sheetKey, revealSource.sheetData);
        continue;
      }
      if (revealSource.status === 'indeterminate') {
        logDebug_ACU(`[V2 Persist] reveal_source_indeterminate: requestId=${options.requestId || 'unknown'}, sheetKey=${change.sheetKey}, reason=${revealSource.reason}。`);
        throw new Error(`V2 reveal_source_indeterminate: sheetKey=${change.sheetKey}, reason=${revealSource.reason}。`);
      }
      // not_found：历史上从未见过该表。显式 reveal 通常由协调器在 hidden 生命周期下生成，
      // 理论上不应走到这里；但为兼容异常/旧历史，回退 caller 模板结构（等价 introduction）。
      logDebug_ACU(`[V2 Persist] reveal_source_missing_fallback: requestId=${options.requestId || 'unknown'}, sheetKey=${change.sheetKey}, 使用 caller 模板结构作为全新表。`);
      revealDataBySheet.set(change.sheetKey, revealSheets.get(change.sheetKey)!);
    }

    // 统一写入 reveal checkpoint（timeline: sheet_reveal，回放语义同 rebase）。
    for (const [sheetKey, revealData] of revealDataBySheet) {
      if (Object.prototype.hasOwnProperty.call(activeReplayState, sheetKey)) {
        throw new Error(`V2 sheet reveal requires a hidden sheet: sheetKey=${sheetKey} 仍存在于 active checkpoint state。`);
      }
      const existingCheckpoint = frame.perSheetCheckpoints?.[sheetKey];
      if (existingCheckpoint && Number(existingCheckpoint.createdAt) > createdAt) {
        throw new Error(`V2 sheet checkpoint cannot replace a newer checkpoint: sheetKey=${sheetKey}, existingCreatedAt=${existingCheckpoint.createdAt}, requestedCreatedAt=${createdAt}.`);
      }
      // reveal 后列级再协调（S1-4）：恢复的是"离开时最新状态"，休眠期间模板可能已演进
      // （加列/减列/改名）。落盘前把恢复数据 rebase 到当前模板列集——匹配列继承数据、
      // 新列按契约填充、模板缺失列进尾部隐藏列（列级休眠，数据不删）。
      // not_found 回退时 revealData 就是模板结构本身（同一对象引用），无需再协调。
      const revealTemplateStructure = revealSheets.get(sheetKey) ?? introductionSheets.get(sheetKey);
      let effectiveRevealData = revealData;
      if (revealTemplateStructure && revealTemplateStructure !== revealData) {
        const rebase = reconcileRevealedSheetWithTemplate_ACU(revealData, revealTemplateStructure, sheetKey, storageMode);
        effectiveRevealData = rebase.sheet;
        // 与其他 targetSheetData 同一关卡：协调结果必须能构造合法 hydrate 映射。
        if (storageMode === 'sqlite') createSheetInsertPlan(effectiveRevealData);
        logDebug_ACU(`[V2 Persist] reveal_rebase: requestId=${options.requestId || 'unknown'}, sheetKey=${sheetKey}, inherited=${rebase.audit.inheritedColumns.length}, added=${rebase.audit.addedColumns.length}, hidden=${rebase.audit.hiddenColumns.length}, changed=${rebase.changed}。`);
      }
      const scheduleSummary = scheduleSummaryBySheet[sheetKey];
      checkpoints.push({
        kind: 'sheet_full',
        createdAt,
        reason: 'schema_change',
        sheetKey,
        data: effectiveRevealData,
        ...(scheduleSummary ? { scheduleSummary: deepClone_ACU(scheduleSummary) } : {}),
        event: { filledSheetKeys: [], changedSheetKeys: [sheetKey] },
        timeline: {
          kind: 'sheet_reveal' as const,
          activateAtMessageIndex: target.index,
          afterSeq: targetFrameLastLogSeq,
        },
        baseRevision: options.baseRevision !== undefined ? options.baseRevision : transactionContext.baseRevision,
      });
    }

    for (const change of requestedChanges.filter(item => item.kind === 'rebase')) {
      if (
        !Object.prototype.hasOwnProperty.call(activeReplayState, change.sheetKey)
      ) {
        throw new Error(`V2 sheet rebase requires an existing sheet: sheetKey=${change.sheetKey} is absent from the active checkpoint state.`);
      }
      if (deletedSheetKeys.includes(change.sheetKey)) {
        throw new Error(`V2 sheet rebase 不能与删除同一 sheetKey 组合：${change.sheetKey}。`);
      }
      const existingCheckpoint = frame.perSheetCheckpoints?.[change.sheetKey];
      if (existingCheckpoint && Number(existingCheckpoint.createdAt) > createdAt) {
        throw new Error(`V2 sheet checkpoint cannot replace a newer checkpoint: sheetKey=${change.sheetKey}, existingCreatedAt=${existingCheckpoint.createdAt}, requestedCreatedAt=${createdAt}.`);
      }
      const scheduleSummary = scheduleSummaryBySheet[change.sheetKey];
      checkpoints.push({
        kind: 'sheet_full',
        createdAt,
        reason: 'schema_change',
        sheetKey: change.sheetKey,
        data: rebaseSheets.get(change.sheetKey)!,
        ...(scheduleSummary ? { scheduleSummary: deepClone_ACU(scheduleSummary) } : {}),
        event: { filledSheetKeys: [], changedSheetKeys: [change.sheetKey] },
        timeline: {
          kind: 'sheet_rebase' as const,
          activateAtMessageIndex: target.index,
          afterSeq: targetFrameLastLogSeq,
        },
        baseRevision: options.baseRevision !== undefined ? options.baseRevision : transactionContext.baseRevision,
      });
    }

    // hide：将当前可见的表标记隐藏，数据完整保留在 checkpoint.data，不 purge。
    for (const sheetKey of hideSheetKeys) {
      if (deletedSheetKeys.includes(sheetKey)) {
        throw new Error(`V2 sheet hide 不能与删除同一 sheetKey 组合：${sheetKey}。`);
      }
      // hide 的语义是"当前可见 → 隐藏"：activeReplayState 中的当前数据就是权威来源，
      // 直接 O(1) 取用，避免对每次 hide 都做逐边界 bounded replay（阶段7：性能收敛）。
      // 仅当 active 无该表（异常状态）时才退回逐边界查找并验证。
      let hideSource: RevealSourceResolution_ACU;
      const activeSheetData = (activeReplayState as Record<string, unknown>)[sheetKey];
      if (isObjectRecord_ACU(activeSheetData)) {
        hideSource = {
          status: 'resolved',
          sheetData: deepClone_ACU(activeSheetData) as Sheet_ACU,
          sourceKind: 'bounded_replay',
          messageIndex: target.index,
        };
      } else {
        hideSource = await resolveRevealSource_ACU(chat, isolationKey, target.index, sheetKey);
      }
      assertTemplateCommitChatContext_ACU(chat, options);
      if (hideSource.status === 'indeterminate') {
        throw new Error(`V2 sheet hide 数据来源无法确认：sheetKey=${sheetKey}，reason=${hideSource.reason}。`);
      }
      if (hideSource.status === 'not_found') {
        throw new Error(`V2 sheet hide 无法定位待隐藏表的当前数据：sheetKey=${sheetKey}。`);
      }
      const existingCheckpoint = frame.perSheetCheckpoints?.[sheetKey];
      if (existingCheckpoint && Number(existingCheckpoint.createdAt) > createdAt) {
        throw new Error(`V2 sheet checkpoint cannot replace a newer checkpoint: sheetKey=${sheetKey}, existingCreatedAt=${existingCheckpoint.createdAt}, requestedCreatedAt=${createdAt}.`);
      }
      const scheduleSummary = scheduleSummaryBySheet[sheetKey];
      const hideSourcePresetName = typeof options.hideSourcePresetName === 'string' && options.hideSourcePresetName.trim().length > 0
        ? options.hideSourcePresetName
        : undefined;
      checkpoints.push({
        kind: 'sheet_full',
        createdAt,
        reason: 'schema_change',
        sheetKey,
        data: hideSource.sheetData,
        ...(scheduleSummary ? { scheduleSummary: deepClone_ACU(scheduleSummary) } : {}),
        // S3-4 休眠溯源：记录休眠前活跃的预设名，供生命周期投影展示「来源模板」。
        // 可选附加字段，checkpoint 校验与回放对未知字段宽容，历史数据缺失时展示层回退「未记录」。
        ...(hideSourcePresetName ? { hideSourcePresetName } : {}),
        event: { filledSheetKeys: [], changedSheetKeys: [sheetKey] },
        timeline: {
          kind: 'sheet_hide' as const,
          activateAtMessageIndex: target.index,
          // hide 必须晚于本次提交写入的 log 生效：该 log（seq = targetFrameLastLogSeq + 1）
          // 可能仍包含针对待隐藏表的合法 operation（例如切模板前刚补齐填表）。
          // 回放判定是 afterSeq < nextSeq，用 targetFrameLastLogSeq 会让 hide 抢在该 log 之前
          // 删表，导致后续 operation 撞上 no such table。
          // introduction / rebase / reveal 相反，必须早于本批 log，故仍用 targetFrameLastLogSeq。
          afterSeq: targetFrameLastLogSeq + 1,
        },
        baseRevision: options.baseRevision !== undefined ? options.baseRevision : transactionContext.baseRevision,
      });
    }


    const operationChanges = requestedChanges.filter((change): change is Extract<TemplateSheetChange_ACU, { kind: 'operations' }> => change.kind === 'operations');
    const operations = operationChanges.flatMap(change => change.operations.map(operation => deepClone_ACU(operation)));

    const entryOptions: AppendMutationLogEntryOptions_ACU | undefined = operations.length === 0 ? undefined : (() => {
      const seq = targetFrameLastLogSeq + 1;
      const parentRevision = frame.headRevision ?? null;
      return {
        seq,
        createdAt,
        source: 'template_assistant' as const,
        targetMessageIndex: target.index,
        aiFloor: countAiFloor_ACU(chat, target.index),
        filledSheetKeys: [] as string[],
        changedSheetKeys: operationChanges.map(change => change.sheetKey),
        groupKeys: [] as string[],
        operations,
        baseRevision: options.baseRevision !== undefined ? options.baseRevision : (transactionContext.baseRevision ?? parentRevision),
        parentRevision,
        writeSet,
      };
    })();

      // 所有异步准备完成后，在第一次内存写入前重新核验当前活动聊天与取消状态。
      assertTemplateCommitChatContext_ACU(chat, options);
      let persistedCheckpoints = checkpoints;
      if (deletedSheetKeys.length > 0) {
        // data_replace 是完整历史状态，不能靠从旧 payload 局部删除 key 来伪造历史。
        // 最新楼层改写为删除后的完整 checkpoint，使更早的整库替换不再参与当前 replay。
        const terminalData = isObjectRecord_ACU(options.templateSource)
          ? deepClone_ACU(options.templateSource as TableDataObject_ACU)
          : deepClone_ACU(activeReplayState);
        deletedSheetKeys.forEach(sheetKey => delete (terminalData as Record<string, unknown>)[sheetKey]);
        const terminalScheduleSummary = Object.fromEntries(
          Object.entries(scheduleSummaryBySheet).filter(([sheetKey]) => !deletedSheetKeys.includes(sheetKey)),
        );
        const terminalCheckpoint = buildCanonicalFullCheckpoint_ACU({
          createdAt,
          reason: 'schema_change',
          data: terminalData,
          scheduleSummary: terminalScheduleSummary,
          event: {
            filledSheetKeys: [],
            changedSheetKeys: [...new Set([
              ...requestedChanges.map(change => change.sheetKey),
              ...deletedSheetKeys,
            ])],
            groupKeys: [],
          },
          context: { messageIndex: target.index, aiFloor: countAiFloor_ACU(chat, target.index), isolationKey },
        });
        if (!terminalCheckpoint.checkpoint) throw new Error(terminalCheckpoint.error);
        frame.checkpoint = terminalCheckpoint.checkpoint;
        frame.logEntries = [];
        delete frame.perSheetCheckpoints;
        frame.headRevision = buildCommitRevision_ACU('checkpoint', generateEntryId_ACU());
        persistedCheckpoints = [];
        hardDeleteCheckpointCreated = true;

        const candidateChat = deepClone_ACU(chat);
        for (const message of candidateChat) {
          if (message && !message.is_user) purgeSheetKeysFromMessage_ACU(message, deletedSheetKeys);
        }
        candidateChat[target.index].TavernDB_ACU_IsolatedData = isolatedData;
        const candidateValidationError = await validateHardDeleteCandidate_ACU(
          candidateChat, isolationKey, target.index, deletedSheetKeys, terminalData,
        );
        if (candidateValidationError) throw new Error(candidateValidationError);
      } else {
        frame.perSheetCheckpoints = {
          ...(frame.perSheetCheckpoints || {}),
          ...Object.fromEntries(checkpoints.map(checkpoint => [checkpoint.sheetKey, checkpoint])),
        };
        if (entryOptions) appendMutationLogEntry_ACU(frame, entryOptions);
      }
      if (activeReplay.requiresCheckpointConvergence || activeReplay.compatibilityRepairs?.length) {
        const candidateChat = buildCandidateChatWithIsolatedDataOverrides_ACU(
          chat,
          new Map([[target.index, isolatedData]]),
        );
        const candidateValidationError = await validateProvisionalConvergenceCandidate_ACU(
          candidateChat,
          isolationKey,
          target.index,
        );
        if (candidateValidationError) throw new Error(candidateValidationError);
        transactionContext.assertFresh?.('commitCurrentFloorTemplateChanges:before_convergence_save');
      }
      assertTemplateCommitChatContext_ACU(chat, options);
      sharedStateMutated = true;
      purgedMessageCount = deletedSheetKeys.length === 0 ? 0 : messageSnapshots.reduce((count, snapshot) => (
        purgeSheetKeysFromMessage_ACU(snapshot.message, deletedSheetKeys) ? count + 1 : count
      ), 0);
      target.message.TavernDB_ACU_IsolatedData = isolatedData;
      // isolatedData 在异步准备前已克隆；重新挂回目标消息后必须同步应用删除，
      // 否则会把刚刚从真实消息清理掉的目标 frame 旧快照覆盖回来。
      if (deletedSheetKeys.length > 0) purgeSheetKeysFromMessage_ACU(target.message, deletedSheetKeys);
      writeMessageIdentity_ACU(target.message, {
        enabled: settings_ACU.dataIsolationEnabled,
        code: settings_ACU.dataIsolationCode,
      });
      const guideUpdated = setChatSheetGuideDataForIsolationKey_ACU(isolationKey, options.guideData, {
        reason: options.reason || 'visualizer_v2_schema_change',
        syncTemplateScope: options.syncTemplateScope === true,
        templateSource: options.templateSource,
        presetName: options.presetName,
        source: options.source,
        updatedAt: createdAt,
      });
      if (!guideUpdated) throw new Error('当前楼层模板提交无法写入 guideData。');
      assertTemplateCommitChatContext_ACU(chat, options);
      primarySaveAttempted = true;
      await saveChatToHostStrict_ACU();
      logDebug_ACU(`[V2 Persist] 当前楼层模板提交完成: requestId=${options.requestId || 'unknown'}, messageIndex=${target.index}, checkpoints=${checkpoints.length}, checkpointTimelines=${checkpoints.map(checkpoint => `${checkpoint.sheetKey}:${checkpoint.timeline?.kind || 'none'}@${checkpoint.timeline?.afterSeq ?? 'none'}`).join(',') || 'none'}, operations=${operations.length}, baseRevision=${options.baseRevision ?? transactionContext.baseRevision ?? 'unknown'}, commitRevision=${frame.headRevision ?? 'unknown'}, isolationKey=${isolationKey}`);
      return {
        saved: true,
        mode: 'v2_commit',
        messageIndex: target.index,
        checkpoints: persistedCheckpoints,
        removedNullRowCount,
        ...(deletedSheetKeys.length > 0 ? { deletedSheetKeys, purgedMessageCount, hardDeleteCheckpointCreated } : {}),
      };
    } catch (error: any) {
      if (sharedStateMutated) {
        restoreTemplateDeleteMessageSnapshots_ACU(messageSnapshots);
        if (convergenceRootSnapshot) {
          if (convergenceRootSnapshot.hadIsolatedData) convergenceRootSnapshot.message.TavernDB_ACU_IsolatedData = convergenceRootSnapshot.isolatedData;
          else delete convergenceRootSnapshot.message.TavernDB_ACU_IsolatedData;
        }
        setChatScopedConfigContainer_ACU(chat, previousScopeContainer);
        setChatSheetGuideContainer_ACU(chat, previousGuideContainer);
      }
      if (primarySaveAttempted) {
        try {
          await saveChatToHostStrict_ACU();
        } catch (rollbackError: any) {
          throw new Error(`${error?.message || String(error)}；回滚保存也失败：${rollbackError?.message || String(rollbackError)}`);
        }
      }
      throw error;
    }
  }, writeSet));
  } catch (error: any) {
    const message = error?.message || String(error);
    if (/runtime revision conflict/i.test(message)) {
      logDebug_ACU(`[V2 Persist] stale_revision_conflict: requestId=${options.requestId || 'unknown'}, baseRevision=${options.baseRevision ?? 'unknown'}。`);
      return { saved: false, error: `V2 stale_revision_conflict: ${message}` };
    }
    return { saved: false, error: message };
  }
}

export async function persistTableSheetCheckpointV2_ACU(
  options: PersistTableSheetCheckpointV2Options_ACU,
): Promise<{ saved: boolean; messageIndex?: number; checkpoint?: TableSheetCheckpointV2_ACU; error?: string }> {
  if (!options.transactionContext) {
    return { saved: false, error: 'V2 sheet checkpoint write requires TableWriteTransactionContext; direct unsafe writes are not allowed.' };
  }
  if (options.assumeCommitLock) return persistTableSheetCheckpointV2Core_ACU(options);
  return options.transactionContext.runCommit(() => persistTableSheetCheckpointV2Core_ACU(options), []);
}
