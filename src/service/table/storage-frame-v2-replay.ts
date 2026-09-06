import { getChatArray_ACU, saveChatToHostStrict_ACU } from '../../data/gateways/chat-gateway';
import { getCurrentIsolationKey_ACU, independentTableStates_ACU, settings_ACU } from '../runtime/state-manager';
import type { TableDataObject_ACU, Sheet_ACU, Mate_ACU } from '../../shared/models/table-data';
import { logError_ACU, logWarn_ACU, stripSeedRowsFromTemplate_ACU } from '../../shared/utils';
import { startRuntimePerformanceSpan_ACU } from '../../shared/runtime-performance';
import { SqliteEngine } from '../../data/sqlite/sqlite-engine';
import { SyncBridge } from '../../data/sqlite/sync-bridge';
import { normalizeSqlStructure, normalizeStatementValues } from '../../data/sqlite/sql-normalizer';
import type { TableCheckpointV2_ACU, TableMutationLogEntryV2_ACU, TableMutationOperationV2_ACU, TablePatchV2_ACU, TableSheetCheckpointV2_ACU, TableSheetLifecycleEntryV2_ACU, TableSheetLifecycleProjectionV2_ACU, TableStorageFrameV2_ACU } from './storage-frame-v2-types';
import { isV2TagData_ACU } from './storage-strategy-resolver';
import { writeMessageIdentity_ACU } from '../../data/repositories/chat-message-data-repo';
import { readIsolatedTagData_ACU } from '../../data/repositories/chat-message-data-repo';
import { ensureStableRowIdsForSeedRows_ACU, getCurrentChatTemplateScopeState_ACU, getEffectiveSeedRowsForSheet_ACU, getGlobalTemplateSnapshotForCurrentProfile_ACU, getSortedSheetKeys_ACU, sanitizeTemplateSnapshotForChat_ACU } from '../template/chat-scope';
import { formatCanonicalRowIssues_ACU, isEmptyCanonicalRowId_ACU, normalizeCanonicalTableRows_ACU, restoreLegacyRowIdentity_ACU } from '../../shared/canonical-row-normalizer';
import { allocateStableRowId_ACU, createStableRowIdReservation_ACU } from '../../shared/stable-row-id-allocator';
import { applySheetSchemaMigrationOperation_ACU } from './table-schema-migration';
import { getPhysicalTableNameFromResolvedMap_ACU, getPhysicalTableNameForSheet_ACU, resolvePhysicalTableNames_ACU } from '../../shared/sheet-identity';
import { parseDDLTableName } from '../../shared/ddl-utils';
import { decodeSqlIdentifier_ACU, rebindSqlMutationColumnReferences_ACU, rebindSqlMutationTableReferences_ACU } from '../../shared/sql-mutation-table-rebind';
import { buildSheetColumnAliasMap_ACU, buildSheetTableAliasMap_ACU, type SheetAliasMapResult_ACU, type SheetColumnAliasMapResult_ACU, type SheetColumnAliasEvidence_ACU } from '../../shared/sql-read-resolver';
import { auditTableDataForUpgrade_ACU, getTableDataFingerprint_ACU } from './table-data-upgrade-audit';
import { repairTableDataFromAudit_ACU } from './table-data-repair';
import { cloneSpv79TransitionData_ACU, compareTransitionCutoffs_ACU, findLatestTransitionCheckpoint_ACU, isAfterSpv79TransitionCutoff_ACU, isEntryAfterSpv79TransitionCutoff_ACU, isFrameArtifactAfterSpv79TransitionCutoff_ACU, reindexSpv79TransitionState_ACU } from './compat-transition-checkpoint';
import { mergeLegacySheetIdentities_ACU, type SheetIdentityRemap_ACU } from '../../shared/sheet-identity-merge';
import { runTableWriteTransaction_ACU } from './table-write-transaction';
import { buildReplayOptionsFingerprint_ACU, computeReplayHeadRevisionDigest_ACU, validateV2ReplayEvidenceFresh_ACU } from './v2-replay-session';

interface V2FrameRef_ACU {
  messageIndex: number;
  aiFloor: number;
  frame: TableStorageFrameV2_ACU;
}


/**
 * 阶段 G2：in-flight replay 去重（只对并发/紧邻的相同纯只读调用生效）。
 *
 * 聊天加载、worldbook 处理、可视化刷新等路径可能在同一生命周期内紧邻触发
 * 对同一 chat + isolationKey + boundary 的全量 replay。若每次调用都重建
 * SQLite runtime 并从 checkpoint 全量回放，同一份 canonical 数据被重复计算。
 *
 * key 由「影响 replay 结果的全部 options 字段」构成：chat 引用、isolationKey、
 * maxMessageIndex、结构映射指纹、allowTemporaryTemplateBaseline、
 * compatibilityMode、enableAliasContext。缺任一字段都会导致共享错误结果
 * （例如临时基线 vs null、冷/热 alias metrics 不同、模板结构变化未失效）。
 *
 * 排除的调用：updateRuntimeState:true（副作用路径改写 schedule，不可共享）、
 * captureBoundaries/captureSink（阶段 H 多边界捕获，各自消费 sink）、
 * replayEvidence（自带 evidence 复用语义）、signal/yieldBudgetMs（取消与调度
 * 是调用方私有意图，共享会丢失取消语义与独立让出）。
 *
 * 生命周期：Promise settle（resolve/reject）后立即删除，只合并并发窗口内的
 * 重复调用，不缓存历史结果（与计划「有界 in-flight」一致，无跨调用泄漏）。
 */
const inflightV2Replays_ACU = new Map<string, Promise<TableReplayResultV2_ACU | null>>();

function buildInflightReplayKey_ACU(
  chat: any[],
  isolationKey: string,
  options: LoadTableStateFromFramesV2Options_ACU,
  structureMappingDigest = '',
): string | null {
  if (options.updateRuntimeState) return null;
  if (Array.isArray(options.captureBoundaries) && options.captureBoundaries.length > 0) return null;
  if (options.replayEvidence) return null;
  if (options.signal) return null;
  if (Number(options.yieldBudgetMs) > 0) return null;
  return [
    'chat-ref',
    // chat 引用（数组对象身份）。同一数组内容原地变化时引用仍相同，但调用方
    // 若在两次调用间原地 mutate chat（fill run 每批提交），in-flight 窗口内
    // 引用相同而内容不同——由调用方保证 fill 提交不在并发 replay 窗口内发生
    // （commit lock 内串行），否则此处只合并同一时刻的请求，语义安全。
    String(chat),
    'iso', isolationKey,
    'max', options.maxMessageIndex ?? 'latest',
    'struct', structureMappingDigest || '',
    'tpl', options.allowTemporaryTemplateBaseline ? 1 : 0,
    'compat', options.compatibilityMode ?? 'default',
    'alias', options.enableAliasContext === false ? 0 : 1,
  ].join('|');
}

export type TableScheduleSummaryV2_ACU = NonNullable<TableCheckpointV2_ACU['scheduleSummary']>;

export type TableReplayBaseKindV2_ACU =
  | 'full_checkpoint'
  | 'replacement_anchor'
  | 'temporary_template_baseline'
  | 'spv79_transition_checkpoint'
  /** 从持久化的通用兼容过渡根（compatTransitionCheckpoint）起算的严格回放。 */
  | 'compat_transition_checkpoint'
  /** 严格回放失败后由 Tier-1 宽容回放直接产出的可用结果（未固化）。 */
  | 'compat_tolerant_replay';

export interface TableReplayCompatibilityRepairV2_ACU {
  kind: 'temporary_sheet_anchor';
  /**
   * `provisional` means this replay reconstructed a usable state from an
   * external template and can be converged by a verified checkpoint. Missing
   * severity is deliberately interpreted as structural by consumers: old
   * persisted diagnostics must never become less strict merely by upgrading.
   */
  severity?: 'provisional' | 'structural';
  sheetKey: string;
  messageIndex: number;
  seq: number;
  operationIndex: number;
  templateFingerprint: string;
  reason: 'missing_at_operation';
}

export function hasStructuralReplayCompatibilityRepairs_ACU(
  repairs: readonly TableReplayCompatibilityRepairV2_ACU[] | null | undefined,
): boolean {
  return Boolean(repairs?.some(repair => repair.severity !== 'provisional'));
}

/**
 * 列身份重绑诊断（Phase 4b）。
 *
 * 刻意**不进** `compatibilityRepairs`：全仓约 18 处直接用
 * `compatibilityRepairs?.length` 作为「拒绝写入 / 拒绝切模板 / 拒绝追平锚点 /
 * blocked_checkpoint_convergence」的硬阻塞条件（storage-frame-v2-persist.ts:492、
 * :529、:634、:1277、:2011、:2041、:2590、:3535、:3914；chat-service.ts:886、:905、
 * :1572、:1625、:2542；mixed-storage-decision.ts:238、:247；
 * manual-catch-up-provisional-bridge.ts:566、:682、:768），这些点绕过了
 * `hasStructuralReplayCompatibilityRepairs_ACU` 的 provisional 过滤，因此
 * `severity: 'provisional'` 在那里不起作用。
 *
 * 列重绑同样是确定性映射：同一份 frame + 同一份 schema 每次回放结果相同，不依赖
 * 任何临时构造，也没有需要 checkpoint 固化的状态。它只写稳定日志，不驱动收敛，
 * 更不向 replay 结果暴露会被调用方误当作持久化状态的诊断字段。
 */
export interface TableReplayResultV2_ACU {
  data: TableDataObject_ACU;
  baseKind: TableReplayBaseKindV2_ACU;
  compatibilityRepairs?: TableReplayCompatibilityRepairV2_ACU[];
  requiresCheckpointConvergence?: boolean;
  /** 阶段 A 观测：单次回放的纯数值安全指标（可选，兼容既有调用方）。 */
  metrics?: TableReplayMetricsV2_ACU;
  /** 阶段 H：本次调用实际捕获到的 boundary 消息索引（前向捕获命中时设置）。 */
  capturedBoundary?: number;
}

/**
 * Tier-1 兼容回放的容忍命中报告。每一项对应 spv7.9 读取器语义中一个与
 * canonical 严格语义不同的行为；计数供日志与过渡根固化 provenance 使用。
 */
export interface LegacyToleranceReport_ACU {
  /** 帧内 logEntries 按 seq 重排且与物理顺序不同的帧数。 */
  outOfOrderSeqSorted: number;
  /** legacy meta_update.sourceData.ddl 按 7.9 Object.assign 语义应用的次数。 */
  legacyMetaUpdateDdlApplied: number;
  /** 被跳过的未知 operation kind（7.9 行为：跳过 + warn）。 */
  unknownOperationKindsSkipped: string[];
  /** row_upsert 宽松语义（找到即替换、找不到 push）命中的次数。 */
  lenientRowUpserts: number;
  /** table_edit_dsl insertRow 使用旧行号算法 String(content.length) 的次数。 */
  legacyDslRowIdAllocations: number;
  /** 两代 sheetKey 身份归并记录。 */
  identityRemaps: SheetIdentityRemap_ACU[];
}

export function createLegacyToleranceReport_ACU(): LegacyToleranceReport_ACU {
  return {
    outOfOrderSeqSorted: 0,
    legacyMetaUpdateDdlApplied: 0,
    unknownOperationKindsSkipped: [],
    lenientRowUpserts: 0,
    legacyDslRowIdAllocations: 0,
    identityRemaps: [],
  };
}

/** 报告 → 命中容忍项代码列表（去重），用于日志与 compat 过渡根的 tolerances 字段。 */
export function summarizeLegacyToleranceReport_ACU(report: LegacyToleranceReport_ACU): string[] {
  const codes: string[] = [];
  if (report.outOfOrderSeqSorted > 0) codes.push(`out_of_order_seq:${report.outOfOrderSeqSorted}`);
  if (report.legacyMetaUpdateDdlApplied > 0) codes.push(`legacy_meta_update_ddl:${report.legacyMetaUpdateDdlApplied}`);
  if (report.unknownOperationKindsSkipped.length > 0) {
    codes.push(`unknown_operation_kind_skipped:${report.unknownOperationKindsSkipped.length}`);
  }
  if (report.lenientRowUpserts > 0) codes.push(`lenient_row_upsert:${report.lenientRowUpserts}`);
  if (report.legacyDslRowIdAllocations > 0) codes.push(`legacy_dsl_row_id:${report.legacyDslRowIdAllocations}`);
  if (report.identityRemaps.length > 0) codes.push(`sheet_identity_remap:${report.identityRemaps.length}`);
  codes.push('legacy_duplicate_row_ids');
  return codes;
}

export interface LoadTableStateFromFramesV2Options_ACU {
  maxMessageIndex?: number;
  updateRuntimeState?: boolean;
  throwOnRecoveryRequired?: boolean;
  /**
   * 默认关闭，保留无锚点 artifacts 返回 null 的 fail-closed 契约。
   * 开启后只允许从有效模板建立 header-only 临时基线，且仍拒绝孤立 data_replace。
   * 写入编排器应同时开启 throwOnRecoveryRequired，避免把待确认恢复误当成空表。
   */
  allowTemporaryTemplateBaseline?: boolean;
  /** apply 仅在明确 sql_sheet_batch.sheetKey 缺失时使用同 key 模板表做内存临时补锚。 */
  compatibilityMode?: 'apply' | 'disabled';
  performanceRunId?: string;
  performanceParentSpanId?: string;
  /**
   * 阶段 B2：单轮 replay alias registry 复用（默认开启；显式 false 关闭，
   * 供冷基线测试与紧急回滚）。同一 stateEpoch 内的连续 DML SQL 复用表/列
   * alias registry，结构事件（data_replace / sheet checkpoint / schema migrate /
   * sheet_replace / meta_update / table_edit_dsl / temporary anchor / legacy patch
   * 的 sheet_replace/meta_update）使 epoch 递增并失效缓存。
   */
  enableAliasContext?: boolean;
  /**
   * 阶段 E：单次 v2-replay 的仅内存复用证据（可选）。传入时，本调用在满足
   * validateV2ReplayEvidenceFresh_ACU 全部条件后直接复用上次 replay 结果；
   * 不满足或未传入 = 照常冷 replay（fail-open）。只有满足严格条件（full_checkpoint
   * 基、无结构 repair、同 chat 引用、同 boundary、updateRuntimeState:false）的
   * 成功结果才会写入 evidence。绝不持久化。
   */
  replayEvidence?: import('./v2-replay-session').V2ReplayEvidence_ACU | null;
  /**
   * 阶段 I：只读 replay 的取消信号（可选）。
   *
   * 仅在 `updateRuntimeState === false` 时生效：副作用路径会改写全局 schedule
   * state，中途抛出会留下半完成的 mutation，因此不接受取消。取消只在 frame/entry
   * 边界、replay state 完整时检查，绝不在单条 SQLite batch 或事务半执行状态中断。
   *
   * 命中取消时抛 V2ReplayAbortedError_ACU，调用方须据此区分「用户取消/切聊天」与
   * 「回放真的失败」，并且不得让被取消的旧结果覆盖新聊天状态。
   */
  signal?: AbortSignal;
  /**
   * 阶段 I：受控主线程让步预算（毫秒，可选）。
   *
   * 仅在 `updateRuntimeState === false` 时生效：副作用路径（replayEventForState_ACU /
   * replayCheckpointSchedule_ACU）改写全局 schedule state，中途让出会引入重入窗口，
   * 比不让出更危险，因此不接受 yield。
   *
   * 语义：自上次让出起累计处理超过该预算后，在 frame/entry 边界（replay state 完整、
   * 未处于单条 SQLite batch 或事务半执行状态）让出事件循环一次。建议 8～16ms；
   * 未传 = 不让出（与基线行为完全一致）。恢复后由同一边界的取消检查复查 signal。
   */
  yieldBudgetMs?: number;
  /**
   * 阶段 H：多 boundary 前向捕获（可选）。
   *
   * 传入严格递增的消息索引数组时，本次调用在 frame 循环中按消息顺序推进，
   * 每当 frameRefs 的消息索引命中该数组就 materialize 并深克隆捕获一次快照，
   * 返回 Map<boundary, TableReplayResultV2_ACU>。
   *
   * 只对「所有 boundary 共享同一起算 full checkpoint」的场景生效：此时从同一
   * checkpoint 起算、沿 frame 顺序推进到各 boundary，语义与「分别冷 replay 到
   * 每个 boundary」完全一致（同一 state/aliasContext/runtime 生命周期，alias
   * registry 推导不丢）。任何 boundary 起算 checkpoint 不同（跨 checkpoint 段）
   * 时，本选项被忽略，调用方应回退逐次冷 replay。
   *
   * 仅在 updateRuntimeState:false（只读路径）生效；副作用路径不得用多 boundary
   * 捕获（中间 materialize 会破坏 schedule replay 的连续性）。
   */
  captureBoundaries?: number[];
  /**
   * 阶段 H：前向捕获结果写入的目标容器（可选）。
   *
   * 与 captureBoundaries 配合：core 在每个命中 boundary 处 materialize 并深克隆
   * 快照后写入此 Map（key=boundary 消息索引）。仅 updateRuntimeState:false 生效。
   * 未传入时 core 使用内部临时 Map（快照随调用结束丢弃，等价于无 capture 消费方，
   * 零额外成本）。外层多 boundary API 必须传入才能读回各 boundary 快照。
   */
  captureSink?: Map<number, TableReplayResultV2_ACU>;
}

/**
 * 阶段 I：只读 replay 被 AbortSignal 取消时抛出的专用错误。
 *
 * 独立类型而非裸 Error：调用方必须能把取消与真实失败区分开——前者不应触发 V2 恢复
 * 流程、不应记为回放故障。消息刻意不含 `duplicate_row_id`，因此不会被
 * loadTableStateFromFramesV2Detailed_ACU 的 SPv7.9 过渡 checkpoint 分支误捕
 * （那条分支会写持久化数据，绝不能由取消触发）。
 */
export class V2ReplayAbortedError_ACU extends Error {
  readonly code = 'v2_replay_aborted';
  constructor(message = '[V2 Replay] 回放已取消。') {
    super(message);
    this.name = 'V2ReplayAbortedError_ACU';
  }
}

/**
 * 单次 v2-replay 的纯数值安全指标（阶段 A 观测）。
 *
 * 只允许有限整数计数，绝不记录 SQL 文本、表名、角色内容、单元格、DDL 原文或
 * 聊天标识。仅在同一调用链内存活，由 loadTableStateFromFramesV2DetailedCore_ACU
 * 创建并在 perf span 结束时上报，不写入模块全局或跨请求复用。
 */
export interface TableReplayMetricsV2_ACU {
  frameCount: number;
  logEntryCount: number;
  operationCount: number;
  sqlOperationCount: number;
  columnRebindCount: number;
  tableAliasBuildCount: number;
  columnAliasBuildCount: number;
  aliasInvalidateCount: number;
  /** 表/列 alias registry 命中已缓存 registry 的次数（与 build 次数互补）。 */
  aliasCacheHitCount: number;
  sqliteHydrateCount: number;
  sqliteMaterializeCount: number;
  /** evidence 复用命中次数（整轮冷回放被跳过）。单次调用最多 1。 */
  replayReuseCount: number;
  /** 传入了 evidence 但判定失配、回退冷回放的次数。单次调用最多 1。 */
  replayReuseFallbackCount: number;
  /** 阶段 G2：本次结果与并发/紧邻的同 key 调用共享（in-flight 去重命中）。单次调用最多 1。 */
  replayShareCount: number;
  /** 阶段 I：本调用实际让出事件循环的次数（时间预算耗尽才 +1）。 */
  yieldCount: number;
}

export function createReplayMetrics_ACU(): TableReplayMetricsV2_ACU {
  return {
    frameCount: 0,
    logEntryCount: 0,
    operationCount: 0,
    sqlOperationCount: 0,
    columnRebindCount: 0,
    tableAliasBuildCount: 0,
    columnAliasBuildCount: 0,
    aliasInvalidateCount: 0,
    aliasCacheHitCount: 0,
    sqliteHydrateCount: 0,
    sqliteMaterializeCount: 0,
    replayReuseCount: 0,
    replayReuseFallbackCount: 0,
    replayShareCount: 0,
    yieldCount: 0,
  };
}

/**
 * 阶段 B：单轮 replay 的 alias registry 复用上下文（纯计算，非缓存）。
 *
 * 只在一次 `loadTableStateFromFramesV2DetailedCore_ACU` 调用内存活，绝不写入
 * 模块全局或跨请求复用。`stateEpoch` 代表 JS authoritative state 的逻辑版本：
 * 任何会改变结构证据的事件（full/replacement base 切换、sheet checkpoint、
 * introduction/reveal/rebase/hide、temporary anchor、data_replace、
 * sheet_schema_migrate、sheet_replace、会改结构的 meta_update/table_edit_dsl、
 * materialize 后任何 JS state 修改、supplemental template 结构 fingerprint 变化）
 * 都必须递增 epoch 并清空缓存。
 *
 * 基础 Map/Set 视为只读。operation 特有的历史 tableName、short sheetKey 等
 * 兼容 alias 必须通过派生副本叠加，不能污染后续 operation（计划 3.1）。
 */
interface ReplayAliasContext_ACU {
  /** 当前 JS authoritative state 的逻辑版本。 */
  stateEpoch: number;
  /** 按 epoch 缓存的基础表 alias（不含 operation 特有的历史 tableName）。 */
  tableAliasRegistry: Map<string, string> | null;
  /** 按 epoch 缓存的基础表 alias 冲突集。 */
  tableConflictRegistry: Set<string> | null;
  /**
   * 按 epoch + supplementalFingerprint 缓存的列身份 registry，按 physicalName
   * 惰性构建：只包含本 epoch 内被 sql_sheet_batch 实际命中的表（阶段 D）。
   * 每表构建一次并缓存，结构事件经 invalidateReplayAliasContext_ACU 整体清空。
   */
  columnAliasRegistry: Map<string, import('../../shared/sql-read-resolver').SheetColumnAliasMapResult_ACU> | null;
  /** 观测计数引用（与 metrics 同一对象）。 */
  metrics: TableReplayMetricsV2_ACU;
  /** 测试和回滚开关。 */
  enabled: boolean;
}

function createReplayAliasContext_ACU(metrics: TableReplayMetricsV2_ACU): ReplayAliasContext_ACU {
  return {
    stateEpoch: 0,
    tableAliasRegistry: null,
    tableConflictRegistry: null,
    columnAliasRegistry: null,
    metrics,
    enabled: false,
  };
}

/** 结构事件使 epoch 递增并清空全部 registry 缓存。 */
function invalidateReplayAliasContext_ACU(context: ReplayAliasContext_ACU): void {
  context.stateEpoch += 1;
  context.tableAliasRegistry = null;
  context.tableConflictRegistry = null;
  context.columnAliasRegistry = null;
  if (context.metrics) context.metrics.aliasInvalidateCount += 1;
}

/**
 * 阶段 B1：集中失效判定——operation 是否改变表/列身份证据。
 *
 * 失效矩阵（与计划 4.1 一致）：
 * - 必须失效：full/replacement base 切换、per-sheet checkpoint/timeline introduction、
 *   temporary anchor、data_replace、sheet_schema_migrate、sheet_replace、meta_update、
 *   table_edit_dsl、legacy patch 中的 sheet_replace/meta_update；
 * - 不失效：row_upsert、row_delete 及仅数据行变化。
 *
 * 禁止继续在各分支散落凭感觉判断；所有调用点必须经此函数判定。
 */
function operationInvalidatesReplayAliasContext_ACU(
  operation: Pick<TableMutationOperationV2_ACU, 'kind'>,
): boolean {
  switch (operation.kind) {
    case 'data_replace':
    case 'sheet_schema_migrate':
    case 'sheet_replace':
    case 'meta_update':
    case 'table_edit_dsl':
      return true;
    case 'row_upsert':
    case 'row_delete':
    case 'sql_batch':
    case 'sql_sheet_batch':
      return false;
    default:
      // 未知 kind 由 applyTableOperationV2Core_ACU 末尾 fail closed，
      // 此处不提前抛错；按最保守语义视为结构事件。
      return true;
  }
}

/** 阶段 B1：legacy patch 是否改变表/列身份证据（与 operation 矩阵同源）。 */
function patchInvalidatesReplayAliasContext_ACU(patch: Pick<TablePatchV2_ACU, 'kind'>): boolean {
  return patch.kind === 'sheet_replace' || patch.kind === 'meta_update';
}

function deepClone_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function isReplayableV2TagData_ACU(tagData: unknown): tagData is { storageFrame: TableStorageFrameV2_ACU } {
  if (isV2TagData_ACU(tagData)) return true;
  if (!tagData || typeof tagData !== 'object' || Array.isArray(tagData)) return false;
  const frame = (tagData as { storageFrame?: unknown }).storageFrame;
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return false;
  const rawFrame = frame as Record<string, unknown>;
  // Only the old singleton log encoding is admitted here. Persist/write paths
  // deliberately keep the canonical-array type guard and will reserialize only
  // after their own validation succeeds.
  return rawFrame.version === 2
    && rawFrame.logEntries !== null
    && typeof rawFrame.logEntries === 'object'
    && !Array.isArray(rawFrame.logEntries);
}

function getV2FrameRefs_ACU(chat: any[], isolationKey: string): V2FrameRef_ACU[] {
  const refs: V2FrameRef_ACU[] = [];
  let aiFloor = 0;

  for (let i = 0; i < chat.length; i += 1) {
    const message = chat[i];
    if (!message || message.is_user) continue;
    aiFloor += 1;

    const tagData = readIsolatedTagData_ACU(message, isolationKey) as any;
    if (isReplayableV2TagData_ACU(tagData)) {
      refs.push({ messageIndex: i, aiFloor, frame: tagData.storageFrame });
    }
  }

  return refs;
}



/**
 * 只读派生：表级可见性生命周期（统一事实来源，不落盘）。
 *
 * 唯一持久化历史权威是 per-sheet timeline；本函数把各 frame 的 timeline 事件
 * 按楼层物理位置与 afterSeq 归并成一张表当前的可见性结论：
 * - active：最后可验证 timeline 是 introduction / rebase / reveal；
 * - hidden：最后可验证 timeline 是 hide（数据保留在 checkpoint.data）；
 * - never_seen：历史无目标相关 timeline / checkpoint / log；
 * - indeterminate：frame 容器、目标 checkpoint 或顺序无法判定。
 *
 * 该派生刻意不扫描业务 operation 内容；隐藏/显示状态完全由 timeline 表达，
 * 避免把普通 SQL 写入的归属歧义再次当作生命周期事实。
 */
export function deriveSheetLifecycleFromFramesV2_ACU(
  chatArg: any[] | null | undefined,
  isolationKey: string,
  options: { maxMessageIndex?: number } = {},
): TableSheetLifecycleProjectionV2_ACU {
  const chat = Array.isArray(chatArg) ? chatArg : [];
  const frameRefs = getV2FrameRefs_ACU(chat, isolationKey)
    .filter(ref => options.maxMessageIndex === undefined || ref.messageIndex <= options.maxMessageIndex);
  const statusBySheetKey: Record<string, TableSheetLifecycleEntryV2_ACU> = {};
  let sawIndeterminateFrame = false;
  const lifecycleFullCheckpoint = [...frameRefs].reverse().find(ref => ref.frame.checkpoint?.kind === 'full');
  const lifecycleTransitionCandidate = findLatestTransitionCheckpoint_ACU(chat, isolationKey, options.maxMessageIndex);
  const transitionRef = lifecycleTransitionCandidate && (!lifecycleFullCheckpoint || lifecycleFullCheckpoint.messageIndex <= lifecycleTransitionCandidate.checkpoint.cutoff.messageIndex)
    ? lifecycleTransitionCandidate : null;

  // 私有过渡根的语义是硬截断，而不是又一种可与旧 full checkpoint 合并的补丁。
  // 因此根之前的所有 lifecycle 证据（包括 hide checkpoint）都必须被忽略。
  if (transitionRef) {
    for (const sheetKey of Object.keys(transitionRef.checkpoint.data)) {
      if (!sheetKey.startsWith('sheet_')) continue;
      statusBySheetKey[sheetKey] = {
        status: 'active',
        lastTimelineKind: 'sheet_introduction',
        lastTimelineMessageIndex: transitionRef.messageIndex,
      };
    }
  }

  // 起算点必须与 replay 对齐：回放以最后一个 full checkpoint 为基底，更早帧的
  // per-sheet checkpoint 一律不再应用。若这里仍从全历史累积 active，早已被后续 full
  // 快照淘汰的表会永久停留在 active，与同一时点的 replay 基线互相矛盾，使模板协调层
  // 拿到「lifecycle=active 但基线不含该表」的不可自救状态。
  const fullCheckpointBaseIndex = findLastFullCheckpointFrameIndex_ACU(frameRefs);
  const transitionBaseIndex = transitionRef
    ? frameRefs.findIndex(ref => ref.messageIndex === transitionRef.messageIndex)
    : -1;
  const baseFrameIndex = transitionBaseIndex >= 0 ? transitionBaseIndex : fullCheckpointBaseIndex;
  if (!transitionRef && baseFrameIndex > 0) {
    // full 快照对 active 集合权威，对 hidden 集合不权威：hide 的数据按设计只存在于
    // hide checkpoint，不进 full checkpoint.data。基底之前因此只回收 hide 证据
    // （含 restoreSourceData，compaction 迁移隐藏表依赖它），其余历史痕迹一律丢弃。
    collectHiddenLifecycleEntriesBeforeBase_ACU(frameRefs, baseFrameIndex, statusBySheetKey);
  }

  for (let frameIndex = Math.max(0, baseFrameIndex); frameIndex < frameRefs.length; frameIndex += 1) {
    const ref = frameRefs[frameIndex];
    const frame = ref.frame;
    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) {
      sawIndeterminateFrame = true;
      continue;
    }
    // frame/checkpoint/timeline 没有 operationIndex；cutoff 消息及之前的 artifact
    // 都已被私有根吸收，不能仅跳过承载帧而让中间历史重新改变 lifecycle。
    if (transitionRef && !isFrameArtifactAfterSpv79TransitionCutoff_ACU(ref.messageIndex, transitionRef.checkpoint)) continue;

    // 全量 checkpoint = 该时点完整数据库快照：它列出的表为 active；它未列出的 active 表
    // 已被该快照淘汰，必须撤销结论（hidden 保留可恢复数据，indeterminate 保留 fail-closed）。
    const frameCheckpoint = frame.checkpoint as any;
    const checkpointData = frameCheckpoint?.data;
    if (checkpointData && typeof checkpointData === 'object' && !Array.isArray(checkpointData)) {
      if (frameCheckpoint.kind === 'full') {
        for (const [sheetKey, entry] of Object.entries(statusBySheetKey)) {
          if (entry.status !== 'active') continue;
          if (Object.prototype.hasOwnProperty.call(checkpointData, sheetKey)) continue;
          delete statusBySheetKey[sheetKey];
        }
      }
      for (const sheetKey of Object.keys(checkpointData)) {
        if (!sheetKey.startsWith('sheet_')) continue;
        statusBySheetKey[sheetKey] = {
          status: 'active',
          lastTimelineKind: 'sheet_introduction',
          lastTimelineMessageIndex: ref.messageIndex,
        };
      }
    }

    // per-sheet checkpoint 使用与 replay 相同的校验路径归一化，避免两处语义分叉。
    let validatedCheckpoints: TableSheetCheckpointV2_ACU[];
    try {
      validatedCheckpoints = getValidatedSheetCheckpoints_ACU(frame, ref.messageIndex);
    } catch (error) {
      // frame 容器或 checkpoint 结构无法判定：该帧涉及的表全部 indeterminate（fail-closed）。
      const perSheetCheckpoints = (frame as any).perSheetCheckpoints;
      if (perSheetCheckpoints !== undefined && perSheetCheckpoints !== null
        && typeof perSheetCheckpoints === 'object' && !Array.isArray(perSheetCheckpoints)) {
        for (const sheetKey of Object.keys(perSheetCheckpoints)) {
          if (sheetKey.startsWith('sheet_')) {
            statusBySheetKey[sheetKey] = { status: 'indeterminate' };
          }
        }
      }
      sawIndeterminateFrame = true;
      continue;
    }

    // 无 timeline 的 legacy checkpoint 在 replay 中于帧开头写回 active state；
    // 派生结论与 replay 保持一致：视为 active（保留为恢复候选）。
    for (const checkpoint of validatedCheckpoints) {
      const { sheetKey } = checkpoint;
      if (!sheetKey.startsWith('sheet_')) continue;
      if (checkpoint.timeline !== undefined) continue;
      statusBySheetKey[sheetKey] = {
        status: 'active',
        lastTimelineKind: 'sheet_introduction',
        lastTimelineMessageIndex: ref.messageIndex,
      };
    }

    // timeline checkpoint 按 afterSeq 归并：hide → hidden，其余 → active。
    // 与 replay 的 applyDueIntroductions 一致：afterSeq 在对应 log seq 之后生效；
    // 同一帧多个 checkpoint 由 getValidatedSheetCheckpoints_ACU 归一并保序。
    const timelineCheckpoints = getValidatedTimelineCheckpointsForFrame_ACU(validatedCheckpoints);
    for (const checkpoint of timelineCheckpoints) {
      const { sheetKey } = checkpoint;
      if (!sheetKey.startsWith('sheet_')) continue;
      const timeline = checkpoint.timeline!;
      if (timeline.afterSeq === undefined || !Number.isInteger(timeline.afterSeq) || timeline.afterSeq < 0) {
        statusBySheetKey[sheetKey] = { status: 'indeterminate' };
        sawIndeterminateFrame = true;
        continue;
      }
      const kind = timeline.kind;
      const entry: TableSheetLifecycleEntryV2_ACU = {
        status: kind === 'sheet_hide' ? 'hidden' : 'active',
        lastTimelineKind: kind,
        lastTimelineMessageIndex: ref.messageIndex,
        lastTimelineAfterSeq: timeline.afterSeq,
      };
      if (kind === 'sheet_hide' && checkpoint.data && typeof checkpoint.data === 'object' && !Array.isArray(checkpoint.data)) {
        entry.restoreSourceData = deepClone_ACU(checkpoint.data);
        attachHideProvenance_ACU(entry, checkpoint);
      }
      statusBySheetKey[sheetKey] = entry;
    }
  }

  const activeSheetKeys: string[] = [];
  const hiddenSheetKeys: string[] = [];
  const indeterminateSheetKeys: string[] = [];
  const neverSeenSheetKeys: string[] = [];
  for (const [sheetKey, entry] of Object.entries(statusBySheetKey)) {
    if (entry.status === 'active') activeSheetKeys.push(sheetKey);
    else if (entry.status === 'hidden') hiddenSheetKeys.push(sheetKey);
    else if (entry.status === 'indeterminate') indeterminateSheetKeys.push(sheetKey);
    else neverSeenSheetKeys.push(sheetKey);
  }
  activeSheetKeys.sort();
  hiddenSheetKeys.sort();
  indeterminateSheetKeys.sort();
  neverSeenSheetKeys.sort();

  return { statusBySheetKey, activeSheetKeys, hiddenSheetKeys, indeterminateSheetKeys, neverSeenSheetKeys };
}


/**
 * 从 hide checkpoint 上附带休眠溯源信息（S3-4 休眠可见性）：
 * createdAt（休眠时间）与可选的 hideSourcePresetName（休眠前活跃预设名，S3-4 起前向记录）。
 * 两者均为展示性字段，缺失时不填充、不报错——历史 checkpoint 天然没有它们。
 */
function attachHideProvenance_ACU(
  entry: TableSheetLifecycleEntryV2_ACU,
  checkpoint: TableSheetCheckpointV2_ACU,
): void {
  const createdAt = (checkpoint as any).createdAt;
  if (typeof createdAt === 'number' && Number.isFinite(createdAt)) {
    entry.lastTimelineCreatedAt = createdAt;
  }
  const sourcePresetName = (checkpoint as any).hideSourcePresetName;
  if (typeof sourcePresetName === 'string' && sourcePresetName.trim().length > 0) {
    entry.hideSourcePresetName = sourcePresetName;
  }
}

/** replay 的回放基底：最后一个 full checkpoint 所在帧在 frameRefs 中的下标（无则 -1）。 */
function findLastFullCheckpointFrameIndex_ACU(frameRefs: V2FrameRef_ACU[]): number {
  for (let index = frameRefs.length - 1; index >= 0; index -= 1) {
    if ((frameRefs[index].frame as any)?.checkpoint?.kind === 'full') return index;
  }
  return -1;
}

/**
 * 只回收回放基底之前的 hide 证据。hide 的表按设计不出现在 full checkpoint.data 中，
 * 其数据唯一存放处就是 hide checkpoint；compaction 迁移隐藏表（chat-service）与
 * reveal 恢复都依赖这份 restoreSourceData，所以它不能随基底之前的历史一起被丢弃。
 * 其余 timeline（introduction / rebase / reveal）的可见性结论已被基底 full 快照取代。
 */
function collectHiddenLifecycleEntriesBeforeBase_ACU(
  frameRefs: V2FrameRef_ACU[],
  baseFrameIndex: number,
  statusBySheetKey: Record<string, TableSheetLifecycleEntryV2_ACU>,
): void {
  for (let index = 0; index < baseFrameIndex; index += 1) {
    const ref = frameRefs[index];
    const frame = ref.frame;
    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) continue;
    let validatedCheckpoints: TableSheetCheckpointV2_ACU[];
    try {
      validatedCheckpoints = getValidatedSheetCheckpoints_ACU(frame, ref.messageIndex);
    } catch {
      // 基底之前的帧在 replay 中本就不参与回放；结构不可判定时不产出 hide 证据，
      // 由 compaction / reveal 各自的 fail-closed 路径继续兜底。
      continue;
    }
    for (const checkpoint of getValidatedTimelineCheckpointsForFrame_ACU(validatedCheckpoints)) {
      const { sheetKey } = checkpoint;
      if (!sheetKey.startsWith('sheet_')) continue;
      const timeline = checkpoint.timeline!;
      if (timeline.kind !== 'sheet_hide') {
        delete statusBySheetKey[sheetKey];
        continue;
      }
      if (timeline.afterSeq === undefined || !Number.isInteger(timeline.afterSeq) || timeline.afterSeq < 0) continue;
      const entry: TableSheetLifecycleEntryV2_ACU = {
        status: 'hidden',
        lastTimelineKind: 'sheet_hide',
        lastTimelineMessageIndex: ref.messageIndex,
        lastTimelineAfterSeq: timeline.afterSeq,
      };
      if (checkpoint.data && typeof checkpoint.data === 'object' && !Array.isArray(checkpoint.data)) {
        entry.restoreSourceData = deepClone_ACU(checkpoint.data);
        attachHideProvenance_ACU(entry, checkpoint);
      }
      statusBySheetKey[sheetKey] = entry;
    }
  }
}


/**
 * 判定 frameRefs 中是否存在「无锚点 replay artifacts」——服务于「回放能否开始」。
 *
 * **语义差异警告**：本函数与 persist 层的 `frameHasSuffixReplayArtifact_ACU`
 * （storage-frame-v2-persist.ts，chat-service 追平 preflight 也复用它）判定标准
 * **刻意不同**，不要把两者「统一」：
 *
 * - 本函数问的是「这些帧里有没有任何需要回放的证据」。此处把 intrinsic 证据
 *   （随根写入、无 timeline 的 per-sheet checkpoint；headRevision）也算作
 *   artifact 是**正确**的：调用方在没有 full checkpoint 时据此决定是否允许用
 *   模板临时基线回放，漏判会让本该恢复的历史被直接丢弃。
 * - `frameHasSuffixReplayArtifact_ACU` 问的是「这个 frame 有没有不属于它自身
 *   checkpoint 的后续增量」，用于判断某个 root 能否安全降级/前移，因此必须排除
 *   intrinsic，否则正常的 header-only root 会被误判为携带后缀 artifact。
 */
function hasUnanchoredReplayArtifacts_ACU(frameRefs: V2FrameRef_ACU[]): boolean {
  return frameRefs.some(({ frame }) => {
    const persistedFrame = frame as unknown as Record<string, unknown>;
    const perSheetCheckpoints = persistedFrame.perSheetCheckpoints;
    const hasPerSheetCheckpointArtifact = perSheetCheckpoints !== undefined
      && (perSheetCheckpoints === null
        || typeof perSheetCheckpoints !== 'object'
        || Array.isArray(perSheetCheckpoints)
        || Object.keys(perSheetCheckpoints).length > 0);
    const headRevision = persistedFrame.headRevision;
    const hasHeadRevisionArtifact = headRevision !== undefined
      && headRevision !== null
      && (typeof headRevision !== 'string' || headRevision.length > 0);

    const rawLogEntries = persistedFrame.logEntries;
    const hasLogEntryArtifact = Array.isArray(rawLogEntries)
      ? rawLogEntries.length > 0
      : rawLogEntries !== undefined && rawLogEntries !== null;
    return hasLogEntryArtifact
      || hasPerSheetCheckpointArtifact
      || persistedFrame.manualRefillProgress !== undefined
      || hasHeadRevisionArtifact;
  });
}

export function hasUnanchoredReplayArtifactsForChatV2_ACU(
  chatArg: any[] | null | undefined,
  isolationKey: string,
  options: { maxMessageIndex?: number } = {},
): boolean {
  const chat = Array.isArray(chatArg) ? chatArg : [];
  const frameRefs = getV2FrameRefs_ACU(chat, isolationKey)
    .filter(ref => options.maxMessageIndex === undefined || ref.messageIndex <= options.maxMessageIndex);
  return hasUnanchoredReplayArtifacts_ACU(frameRefs);
}

interface ReplacementAnchor_ACU {
  messageIndex: number;
  seq: number;
  operationIndex: number;
  data: TableDataObject_ACU;
}

/**
 * `data_replace` carries a complete post-state, so it is a self-sufficient
 * replay base: everything logged before it is superseded by definition. Older
 * histories that lost their full checkpoint can therefore still be replayed
 * exactly from their last replacement onward.
 *
 * Only a structurally complete payload qualifies. A truncated or non-object
 * `data` cannot be trusted as a base — adopting it would silently drop every
 * sheet it fails to carry — so such entries are skipped and an earlier
 * replacement is used instead.
 */
function findLastUsableReplacementAnchor_ACU(frameRefs: V2FrameRef_ACU[]): ReplacementAnchor_ACU | null {
  let anchor: ReplacementAnchor_ACU | null = null;
  for (const { messageIndex, frame } of frameRefs) {
    // Anchor discovery must observe the same ordering the replay loop will use,
    // otherwise a legacy frame with missing or repeated `seq` yields an anchor
    // cursor that cannot be matched during replay and the truncation of
    // superseded operations silently misfires. Warnings are suppressed here
    // because the replay loop reports the same repair on the same frame.
    let entries: TableMutationLogEntryV2_ACU[];
    try {
      entries = getReplayOrderedFrameLogEntries_ACU(frame, { warnOnRepair: false });
    } catch {
      // An undecodable frame cannot contribute an anchor. If it is inside the
      // replayed range the main loop still fails loudly on it.
      continue;
    }
    for (const entry of entries) {
      if (!Array.isArray(entry.operations)) continue;
      for (const [operationIndex, operation] of entry.operations.entries()) {
        if (operation?.kind !== 'data_replace') continue;
        const data = (operation as { data?: unknown }).data;
        if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
        const sheetKeys = Object.keys(data as Record<string, unknown>).filter(key => key.startsWith('sheet_'));
        if (sheetKeys.length === 0) continue;
        anchor = { messageIndex, seq: entry.seq, operationIndex, data: data as TableDataObject_ACU };
      }
    }
  }
  return anchor;
}

export function resolveHeaderOnlyTemplateSnapshot_ACU(chat: any[], isolationKey: string): TableDataObject_ACU | null {
  const scopeState = getCurrentChatTemplateScopeState_ACU({ chat, isolationKey });
  const globalSnapshot = scopeState ? null : getGlobalTemplateSnapshotForCurrentProfile_ACU();
  const effectiveTemplate = scopeState?.templateStr || scopeState?.templateObj
    || globalSnapshot?.templateObj || globalSnapshot?.templateStr;
  const snapshot = sanitizeTemplateSnapshotForChat_ACU(effectiveTemplate || null);
  if (!snapshot?.templateObj) return null;

  const headerOnly = stripSeedRowsFromTemplate_ACU(deepClone_ACU(snapshot.templateObj));
  if (!headerOnly || typeof headerOnly !== 'object' || Array.isArray(headerOnly)) return null;
  if (!Object.keys(headerOnly).some(key => key.startsWith('sheet_'))) return null;

  const state = headerOnly as TableDataObject_ACU;
  normalizeReplayState_ACU(state, 'temporary template baseline');
  return state;
}

function applyEventToScheduleSummary_ACU(
  summary: TableScheduleSummaryV2_ACU,
  event: Pick<TableMutationLogEntryV2_ACU, 'filledSheetKeys' | 'changedSheetKeys' | 'groupKeys'> | undefined,
  aiFloor: number,
): void {
  if (!event) return;

  const filledKeys = [...new Set([...(event.filledSheetKeys || []), ...(event.groupKeys || [])])];
  for (const sheetKey of filledKeys) {
    if (!summary[sheetKey]) summary[sheetKey] = {};
    summary[sheetKey].lastFilledAiFloor = aiFloor;
  }

  for (const sheetKey of event.changedSheetKeys || []) {
    if (!summary[sheetKey]) summary[sheetKey] = {};
    summary[sheetKey].lastChangedAiFloor = aiFloor;
  }
}

function replayEventForState_ACU(event: Pick<TableMutationLogEntryV2_ACU, 'filledSheetKeys' | 'changedSheetKeys' | 'groupKeys'> | undefined, aiFloor: number): void {
  if (!event) return;

  const filledKeys = [...new Set([...(event.filledSheetKeys || []), ...(event.groupKeys || [])])];
  for (const sheetKey of filledKeys) {
    if (!independentTableStates_ACU[sheetKey]) independentTableStates_ACU[sheetKey] = {};
    independentTableStates_ACU[sheetKey].lastUpdatedAiFloor = aiFloor;
  }

}

function replayCheckpointSchedule_ACU(checkpoint: TableCheckpointV2_ACU, fallbackAiFloor: number): void {
  const summary = checkpoint.scheduleSummary || {};
  for (const [sheetKey, state] of Object.entries(summary)) {
    if (state.lastFilledAiFloor === undefined) continue;
    if (!independentTableStates_ACU[sheetKey]) independentTableStates_ACU[sheetKey] = {};
    independentTableStates_ACU[sheetKey].lastUpdatedAiFloor = state.lastFilledAiFloor;
  }
  replayEventForState_ACU(checkpoint.event, fallbackAiFloor);
}

function replaceState_ACU(state: TableDataObject_ACU, next: TableDataObject_ACU): void {
  Object.keys(state).forEach(key => delete (state as any)[key]);
  Object.assign(state, deepClone_ACU(next));
}

/**
 * Repairs ordering metadata of a legacy timeline shard for this replay only.
 *
 * `activateAtMessageIndex` is no longer an addressing key (the physical frame
 * position is), so a missing or out-of-range value can be filled from the frame
 * itself. A missing `afterSeq` has no single safe default: applying a hide too
 * early makes the frame's own operations hit an already-deleted table, while
 * applying an introduction/rebase/reveal too late overwrites business writes
 * those operations performed. The checkpoint map does not record a position
 * relative to log entries, so that ordering remains fail-closed.
 */
function normalizeSheetCheckpointTimelineForReplay_ACU(
  timeline: NonNullable<TableSheetCheckpointV2_ACU['timeline']>,
  context: { recordKey: string; frameMessageIndex: number; sheetKey: string },
): NonNullable<TableSheetCheckpointV2_ACU['timeline']> {
  if (!timeline || typeof timeline !== 'object' || Array.isArray(timeline)
    || (timeline.kind !== 'sheet_introduction' && timeline.kind !== 'sheet_rebase'
      && timeline.kind !== 'sheet_reveal' && timeline.kind !== 'sheet_hide')) {
    throw new Error(`perSheetCheckpoints.${context.recordKey} 包含非法 timeline`);
  }

  const repairs: string[] = [];
  let activateAtMessageIndex = timeline.activateAtMessageIndex;
  if (activateAtMessageIndex === undefined) {
    activateAtMessageIndex = context.frameMessageIndex;
    repairs.push(`activateAtMessageIndex→${activateAtMessageIndex}`);
  } else if (!Number.isInteger(activateAtMessageIndex) || activateAtMessageIndex < 0) {
    throw new Error(`perSheetCheckpoints.${context.recordKey} 包含非法 timeline`);
  }
  let afterSeq = timeline.afterSeq;
  if (afterSeq === undefined) {
    throw new Error(
      `perSheetCheckpoints.${context.recordKey} 缺少 afterSeq，无法确定相对日志顺序：`
      + `sheetKey=${context.sheetKey}, messageIndex=${context.frameMessageIndex}`,
    );
  } else if (!Number.isInteger(afterSeq) || afterSeq < 0) {
    throw new Error(`perSheetCheckpoints.${context.recordKey} 包含非法 timeline`);
  }
  if (repairs.length === 0) return timeline;

  logWarn_ACU(
    `[V2 Replay] perSheetCheckpoints.${context.recordKey} 的 timeline 缺少可用排序元数据，`
    + `已仅在内存回放中按 frame 物理位置修复：${repairs.join('、')}。原 storage frame 未修改。`,
  );
  return { ...timeline, activateAtMessageIndex, afterSeq } as NonNullable<TableSheetCheckpointV2_ACU['timeline']>;
}

/**
 * Normalizes per-sheet checkpoint metadata for replay without mutating the frame.
 *
 * Writers derive the map key from `checkpoint.sheetKey`, so both sides agree on
 * anything written by a current version. Old archives can disagree, and every
 * other reader in this codebase (purge, table history, mixed-storage evidence,
 * persist) addresses these records by map key. The map key is therefore the
 * effective identity when both sides are usable, and the usable side wins when
 * only one is. Two records collapsing onto the same effective key stays
 * rejected: adopting either would silently drop one sheet's checkpoint.
 */
function getValidatedSheetCheckpoints_ACU(
  frame: TableStorageFrameV2_ACU,
  frameMessageIndex: number,
): TableSheetCheckpointV2_ACU[] {
  const checkpoints = frame.perSheetCheckpoints;
  if (checkpoints === undefined) return [];
  if (!checkpoints || typeof checkpoints !== 'object' || Array.isArray(checkpoints)) {
    throw new Error('perSheetCheckpoints 必须是按 sheetKey 索引的对象');
  }
  const isSheetKey = (value: unknown): value is string => typeof value === 'string' && value.startsWith('sheet_');
  const normalized = Object.entries(checkpoints).map(([recordKey, checkpoint]) => {
    if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)
      || checkpoint.kind !== 'sheet_full') {
      throw new Error(`perSheetCheckpoints.${recordKey} 缺少有效的 sheet_full checkpoint`);
    }
    if (!checkpoint.data || typeof checkpoint.data !== 'object' || Array.isArray(checkpoint.data)) {
      throw new Error(`perSheetCheckpoints.${recordKey} 缺少有效的单表 data`);
    }
    const declaredKey = checkpoint.sheetKey;
    if (!isSheetKey(recordKey) && !isSheetKey(declaredKey)) {
      throw new Error(`perSheetCheckpoints 包含非法键: ${recordKey}`);
    }

    const sheetKey = isSheetKey(recordKey) ? recordKey : declaredKey;
    const repairs: string[] = [];
    if (sheetKey !== declaredKey) repairs.push(`sheetKey ${String(declaredKey)}→${sheetKey}`);
    if (repairs.length > 0) {
      logWarn_ACU(
        `[V2 Replay] perSheetCheckpoints.${recordKey} 的协议元数据不完整，`
        + `已仅在内存回放中按 map key 归一：${repairs.join('、')}。原 storage frame 未修改。`,
      );
    }

    const timeline = checkpoint.timeline === undefined
      ? undefined
      : normalizeSheetCheckpointTimelineForReplay_ACU(checkpoint.timeline, {
        recordKey,
        frameMessageIndex,
        sheetKey,
      });
    return {
      ...checkpoint,
      kind: checkpoint.kind,
      sheetKey,
      ...(timeline === undefined ? {} : { timeline }),
    };
  }).sort((left, right) => left.sheetKey.localeCompare(right.sheetKey));

  const duplicateKey = normalized.find(
    (checkpoint, index) => normalized.findIndex(other => other.sheetKey === checkpoint.sheetKey) !== index,
  );
  if (duplicateKey) {
    throw new Error(`perSheetCheckpoints 归一化后存在重复 sheetKey: ${duplicateKey.sheetKey}`);
  }
  return normalized;
}

/**
 * Normalizes legacy log ordering without mutating the persisted frame.
 *
 * Old writers could omit `seq`, or emit repeated / out-of-order values, but
 * JSON array order still unambiguously preserves the order in which those
 * entries were persisted. In that case we use the physical ordinal as an
 * ephemeral sequence for this replay. Both state replay and schedule summary
 * consume this function, so they cannot diverge on the same history.
 */
function getReplayOrderedFrameLogEntries_ACU(
  frame: TableStorageFrameV2_ACU,
  options: { warnOnRepair?: boolean } = {},
): TableMutationLogEntryV2_ACU[] {
  const rawEntries = frame.logEntries;
  if (rawEntries === undefined) return [];
  const entries = Array.isArray(rawEntries)
    ? rawEntries
    : (rawEntries && typeof rawEntries === 'object' ? [rawEntries] : null);
  if (!entries) throw new Error('logEntries 必须是数组或旧版单条日志对象');

  const usesCanonicalOrder = entries.every((entry, index) => {
    const seq = (entry as any)?.seq;
    return Number.isInteger(seq) && seq >= 0 && (index === 0 || seq > (entries[index - 1] as any)?.seq);
  });
  if (usesCanonicalOrder) return entries as TableMutationLogEntryV2_ACU[];

  const normalized = entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`logEntries[${index}] 必须是对象，无法按物理顺序兼容。`);
    }
    return { ...(entry as TableMutationLogEntryV2_ACU), seq: index };
  });
  if (options.warnOnRepair !== false) {
    logWarn_ACU(
      `[V2 Replay] 检测到旧 logEntries 的 seq 缺失、重复或倒序，`
      + `已仅在内存回放中按数组物理顺序重建临时 seq：entries=${normalized.length}。原 storage frame 未修改。`,
    );
  }
  return normalized;
}

function getValidatedTimelineCheckpointsForFrame_ACU(
  checkpoints: TableSheetCheckpointV2_ACU[],
): TableSheetCheckpointV2_ACU[] {
  // shard 的物理承载 frame 是跨楼层回放位置；聊天插入、删除或导入会让旧的声明索引漂移。
  // activateAtMessageIndex 不再作为寻址键，缺失或越界时由 getValidatedSheetCheckpoints_ACU
  // 按 frame 物理位置补齐。同一 frame 内的真实生效顺序继续由 afterSeq 决定。
  return checkpoints.filter(checkpoint => checkpoint.timeline !== undefined);
}

function splitSqlStatementsForReplay_ACU(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inString = false;
  let stringChar = '';
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    if (inString) {
      current += char;
      if (char === stringChar) {
        if (i + 1 < sql.length && sql[i + 1] === stringChar) {
          current += sql[i + 1];
          i += 1;
        } else {
          inString = false;
        }
      }
    } else if (char === "'" || char === '"') {
      inString = true;
      stringChar = char;
      current += char;
    } else if (char === ';') {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
    } else {
      current += char;
    }
  }
  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

function normalizeSqlStatementsForReplay_ACU(statements: string[]): string[] {
  return statements
    .flatMap(statement => splitSqlStatementsForReplay_ACU(String(statement || '').replace(/<!--|-->/g, '').trim()))
    .map(statement => normalizeStatementValues(normalizeSqlStructure(statement)))
    .filter(Boolean);
}

interface SqlReplayRuntime_ACU {
  engine: SqliteEngine;
  syncBridge: SyncBridge;
  loaded: boolean;
  /**
   * replay 状态机当前权威状态：
   * - `sqlite_loaded`：SQLite 是当前权威状态；离开 SQL 段时须先 materialize 到 `state`。
   * - `js_materialized`：`state` 是当前权威状态；SQLite 已 dispose/未加载；连续
   *   JS-native operations 直接修改 candidate，不重复 hydrate。
   *
   * 单一转换入口：materializeSqlRuntimeToState_ACU（SQLite → JS）与
   * ensureSqlReplayRuntime_ACU（仅进入下一 SQL 段时 JS → SQLite）。
   */
  mode: 'sqlite_loaded' | 'js_materialized';
}

function normalizeReplayState_ACU(state: TableDataObject_ACU, context: string): void {
  const candidate = deepClone_ACU(state);
  const normalization = normalizeCanonicalTableRows_ACU(candidate);
  const canonicalIssues = [...normalization.errors, ...normalization.removedRows];
  if (canonicalIssues.length > 0) {
    throw new Error(`[V2 Replay] ${context} 行标识不合法：${formatCanonicalRowIssues_ACU(canonicalIssues)}`);
  }
  replaceState_ACU(state, candidate);
}

/**
 * Normalizes a candidate built from already-persisted history.
 *
 * Legacy payloads predate the row_id identity contract, so identity is restored
 * first and only then handed to the strict canonical normalizer. Without this
 * order, rows whose identity column was empty or absent are classified as
 * deleted and the whole replay aborts — which is what made upgraded chats
 * unreadable even though their data was intact.
 *
 * Newly constructed candidates (template baselines, freshly built checkpoints)
 * must keep using normalizeReplayState_ACU so new writes stay strict.
 */
function normalizeHistoricalReplayState_ACU(state: TableDataObject_ACU, context: string): void {
  const candidate = deepClone_ACU(state);
  const identity = restoreLegacyRowIdentity_ACU(candidate);

  // A repair that loses a row or a business cell is an implementation defect,
  // not a data defect. Fail loudly instead of persisting a lossy candidate.
  const { conservation } = identity;
  if (conservation.rowCountAfter !== conservation.rowCountBefore
    || conservation.businessCellCountAfter !== conservation.businessCellCountBefore) {
    throw new Error(
      `[V2 Replay] ${context} 历史行身份兼容破坏数据守恒：`
      + `rows ${conservation.rowCountBefore}→${conservation.rowCountAfter}, `
      + `cells ${conservation.businessCellCountBefore}→${conservation.businessCellCountAfter}。`,
    );
  }

  const normalization = normalizeCanonicalTableRows_ACU(candidate);
  const canonicalIssues = [...normalization.errors, ...normalization.removedRows];
  if (canonicalIssues.length > 0) {
    throw new Error(`[V2 Replay] ${context} 行标识不合法：${formatCanonicalRowIssues_ACU(canonicalIssues)}`);
  }

  if (identity.repairs.length > 0) {
    const assigned = identity.repairs.filter(repair => repair.code === 'assigned_row_id').length;
    const headerRepairs = identity.repairs.filter(repair => repair.code !== 'assigned_row_id');
    const affectedSheetKeys = [...new Set(identity.repairs.map(repair => repair.sheetKey))];
    logWarn_ACU(
      `[V2 Replay] ${context} 旧格式缺少行身份，已在内存副本中保留全部行`
      + `并补 ${assigned} 个 row_id、修正 ${headerRepairs.length} 个表头身份列：`
      + `${affectedSheetKeys.join(', ')}。原 storage frame 未修改。`,
    );
  }

  replaceState_ACU(state, candidate);
}

function formatLegacyDuplicateRepairDiagnostics_ACU(
  gate: 'canonical_precheck' | 'audit_gate' | 'repair_gate',
  options: {
    canonicalReasons?: string[];
    auditStatus?: string;
    auditCodes?: string[];
    auditLocations?: string[];
    requiresConfirmation?: boolean;
  } = {},
): string {
  const fields = [`gate=${gate}`];
  if (options.canonicalReasons?.length) fields.push(`canonical=${options.canonicalReasons.join(',')}`);
  if (options.auditStatus) fields.push(`audit_status=${options.auditStatus}`);
  if (options.auditCodes?.length) fields.push(`audit_codes=${options.auditCodes.join(',')}`);
  if (options.auditLocations?.length) fields.push(`audit_locations=${options.auditLocations.join(',')}`);
  if (options.requiresConfirmation !== undefined) fields.push(`requires_confirmation=${options.requiresConfirmation}`);
  return fields.join('; ');
}

function summarizeUpgradeIssueCodes_ACU(codes: string[]): string[] {
  const counts = new Map<string, number>();
  codes.forEach(code => counts.set(code, (counts.get(code) || 0) + 1));
  return [...counts].map(([code, count]) => `${code}:${count}`);
}

function summarizeUpgradeIssueLocations_ACU(issues: Array<{ code: string; sheetKey?: string; rowIndex?: number }>): string[] {
  return issues.map(issue => {
    const sheetKey = issue.sheetKey || 'unknown_sheet';
    const row = issue.rowIndex === undefined ? '' : `#${issue.rowIndex}`;
    return `${issue.code}@${sheetKey}${row}`;
  });
}

function normalizeLegacyDuplicateCheckpointState_ACU(state: TableDataObject_ACU): void {
  // Restore legacy identity on the live state first: an empty or absent row_id
  // is a legacy format trait, not a duplicate, and leaving it here would send
  // the whole checkpoint down the strict reject path below.
  restoreLegacyRowIdentity_ACU(state);

  const probe = deepClone_ACU(state);
  const normalization = normalizeCanonicalTableRows_ACU(probe);
  const nonDuplicateErrors = normalization.errors.filter(issue => issue.reason !== 'duplicate_row_id');
  if (normalization.removedRows.length > 0 || nonDuplicateErrors.length > 0) {
    const diagnostics = formatLegacyDuplicateRepairDiagnostics_ACU('canonical_precheck', {
      canonicalReasons: [...normalization.removedRows, ...nonDuplicateErrors].map(issue => issue.reason),
    });
    logWarn_ACU(`[V2 Replay] 旧 full checkpoint 重复 row_id 兼容修复未执行：${diagnostics}。`);
    normalizeHistoricalReplayState_ACU(state, `full checkpoint（${diagnostics}）`);
    return;
  }

  const audit = auditTableDataForUpgrade_ACU(state);
  const duplicateIssues = audit.issues.filter(issue => (
    issue.code === 'upgrade_duplicate_row_id'
    || issue.code === 'upgrade_seed_pool_conflict'
  ));
  // These repair actions preserve every existing row and business cell. New
  // writes remain strict; this exception is only for persisted legacy frames.
  const losslessIssueCodes = new Set([
    'upgrade_duplicate_row_id',
    'upgrade_seed_pool_conflict',
    'upgrade_row_width_mismatch',
  ]);
  const unsupportedIssues = audit.issues.filter(issue => !losslessIssueCodes.has(issue.code));
  if (audit.status === 'clean' && normalization.errors.length === 0) {
    replaceState_ACU(state, probe);
    return;
  }
  if (audit.status !== 'repairable' || duplicateIssues.length === 0 || unsupportedIssues.length > 0) {
    const diagnostics = formatLegacyDuplicateRepairDiagnostics_ACU('audit_gate', {
      auditStatus: audit.status,
      auditCodes: summarizeUpgradeIssueCodes_ACU(audit.issues.map(issue => issue.code)),
      auditLocations: summarizeUpgradeIssueLocations_ACU(audit.issues),
    });
    logWarn_ACU(`[V2 Replay] 旧 full checkpoint 重复 row_id 兼容修复未执行：${diagnostics}。`
      + '该 checkpoint 不可无损自动修复，请先导出原始 frame 后在数据管理执行 V2 恢复。');
    normalizeHistoricalReplayState_ACU(state, `full checkpoint（${diagnostics}）`);
    return;
  }
  const repair = repairTableDataFromAudit_ACU(audit);
  if (repair.requiresConfirmation || !repair.candidateData || typeof repair.candidateData !== 'object') {
    const diagnostics = formatLegacyDuplicateRepairDiagnostics_ACU('repair_gate', {
      auditStatus: audit.status,
      auditCodes: summarizeUpgradeIssueCodes_ACU(audit.issues.map(issue => issue.code)),
      auditLocations: summarizeUpgradeIssueLocations_ACU(audit.issues),
      requiresConfirmation: repair.requiresConfirmation,
    });
    logWarn_ACU(`[V2 Replay] 旧 full checkpoint 重复 row_id 兼容修复未执行：${diagnostics}。`);
    normalizeHistoricalReplayState_ACU(state, `full checkpoint（${diagnostics}）`);
    return;
  }
  const candidate = repair.candidateData as TableDataObject_ACU;
  normalizeHistoricalReplayState_ACU(candidate, 'legacy duplicate row_id repair');
  replaceState_ACU(state, candidate);
  const affectedSheetKeys = [...new Set(repair.idRemap.map(remap => remap.sheetKey))];
  logWarn_ACU(
    `[V2 Replay] 旧 full checkpoint 含重复 row_id，已在内存副本中保留全部行并重映射 ${repair.idRemap.length} 行：${affectedSheetKeys.join(', ')}。原 storage frame 未修改。`,
  );
}

/**
 * 幂等 dispose：统一维护 runtime 生命周期收尾。
 * 任何路径（materialize 成功后、operation 失败 finally、ownedRuntime 收尾）
 * 都经此收敛，避免底层 dispose 非幂等时出现双释放；loaded/mode 状态同步。
 */
function disposeSqlReplayRuntime_ACU(runtime: SqlReplayRuntime_ACU): void {
  if (!runtime) return;
  try {
    runtime.engine.dispose();
  } finally {
    runtime.loaded = false;
    runtime.mode = 'js_materialized';
  }
}

async function ensureSqlReplayRuntime_ACU(
  runtime: SqlReplayRuntime_ACU,
  state: TableDataObject_ACU,
  options: { legacyDuplicateRowIds?: boolean; metrics?: TableReplayMetricsV2_ACU } = {},
): Promise<void> {
  // 惰性 hydrate：仅在进入下一 SQL 段时从最新 `state` 加载一次。
  // SQLite 已是当前权威状态时直接复用，禁止在每 operation 后重建。
  if (runtime.mode === 'sqlite_loaded') return;
  if (runtime.mode === 'js_materialized' && runtime.loaded) {
    // 状态机不变量：js_materialized 时 SQLite 必须已 dispose（见 materialize），
    // 因此这里的 loaded 只可能来自未 materialize 的初始构造，按未加载处理。
    disposeSqlReplayRuntime_ACU(runtime);
  }
  // The snapshot handed to SQLite comes from persisted history, so legacy
  // identity must be restored before strict hydrate. The export path below
  // stays strict: by then every row has an identity, and a defect there would
  // be ours, not the historical data's.
  if (!options.legacyDuplicateRowIds) normalizeHistoricalReplayState_ACU(state, 'snapshot');
  await runtime.engine.init();
  if (options.legacyDuplicateRowIds) runtime.syncBridge.loadSpv79LegacyDuplicateRowIdHistory(state);
  else runtime.syncBridge.loadFromTableData(state, { strict: true });
  if (options.metrics) {
    options.metrics.sqliteHydrateCount += 1;
  }
  runtime.loaded = true;
  runtime.mode = 'sqlite_loaded';
}

function getExportedSqlReplayRuntimeState_ACU(
  runtime: SqlReplayRuntime_ACU,
  state: TableDataObject_ACU,
  options: { legacyDuplicateRowIds?: boolean } = {},
): TableDataObject_ACU {
  if (!runtime.loaded) return deepClone_ACU(state);
  const mate = (state.mate || { type: 'acu', version: 1 }) as Mate_ACU;
  const next = options.legacyDuplicateRowIds
    ? runtime.syncBridge.exportSpv79LegacyDuplicateRowIdHistory(mate)
    : runtime.syncBridge.exportToTableData(mate, { strict: true });
  if (!options.legacyDuplicateRowIds) normalizeReplayState_ACU(next, 'SQL 导出结果');
  return next;
}

function exportSqlReplayRuntime_ACU(
  runtime: SqlReplayRuntime_ACU,
  state: TableDataObject_ACU,
  options: { legacyDuplicateRowIds?: boolean } = {},
): void {
  if (!runtime.loaded) return;
  replaceState_ACU(state, getExportedSqlReplayRuntimeState_ACU(runtime, state, options));
}

/**
 * 单一转换入口（SQLite → JS）：严格导出 SQLite 到 `state`，成功后 dispose Database
 * 并将 runtime 标记为未加载。任何离开 SQL 段的路径（JS-native operation、sheet
 * checkpoint、replay 结束）都必须先经过这里，确保不再出现新旧双 Database 同时存活。
 */
async function materializeSqlRuntimeToState_ACU(
  runtime: SqlReplayRuntime_ACU,
  state: TableDataObject_ACU,
  options: { legacyDuplicateRowIds?: boolean; metrics?: TableReplayMetricsV2_ACU } = {},
): Promise<void> {
  if (runtime.mode !== 'sqlite_loaded' || !runtime.loaded) return;
  const exported = getExportedSqlReplayRuntimeState_ACU(runtime, state, options);
  if (options.metrics) options.metrics.sqliteMaterializeCount += 1;
  // 先导出成功再 dispose：导出抛错时保持 SQLite 权威状态不变，由上层 finally 清理。
  replaceState_ACU(state, exported);
  disposeSqlReplayRuntime_ACU(runtime);
}

function buildReplayCandidate_ACU(
  runtime: SqlReplayRuntime_ACU | null,
  state: TableDataObject_ACU,
  options: { legacyDuplicateRowIds?: boolean } = {},
): TableDataObject_ACU {
  // SQLite 已加载时返回 SQLite 权威状态（不 dispose；dispose 由
  // materializeSqlRuntimeToState_ACU 在 JS 路径的提交前统一执行）。
  return runtime?.loaded
    ? getExportedSqlReplayRuntimeState_ACU(runtime, state, options)
    : deepClone_ACU(state);
}

async function applySheetCheckpointsForReplay_ACU(
  state: TableDataObject_ACU,
  checkpoints: TableSheetCheckpointV2_ACU[],
  runtime: SqlReplayRuntime_ACU,
  metrics?: TableReplayMetricsV2_ACU,
  context?: ReplayAliasContext_ACU | null,
): Promise<void> {
  if (checkpoints.length === 0) return;
  if (context?.enabled) invalidateReplayAliasContext_ACU(context);
  else if (metrics) metrics.aliasInvalidateCount += checkpoints.length;
  // sheet checkpoint 属 JS 语义：离开 SQL 段先 materialize（导出并 dispose）。
  await materializeSqlRuntimeToState_ACU(runtime, state, { metrics });
  const candidate = deepClone_ACU(state);
  for (const checkpoint of checkpoints) {
    if (checkpoint.timeline?.kind === 'sheet_hide') {
      // hide：从 active replay state 移除该表的可见性（数据仍留存于 checkpoint.data 供后续 reveal）。
      delete candidate[checkpoint.sheetKey];
    } else {
      // introduction / rebase / reveal：用 checkpoint.data 整表写入 replay state。
      candidate[checkpoint.sheetKey] = deepClone_ACU(checkpoint.data);
    }
  }
  replaceState_ACU(state, candidate);
}

function buildReplaySqlTableAliases_ACU(
  state: TableDataObject_ACU,
  operation: Extract<TableMutationOperationV2_ACU, { kind: 'sql_batch' | 'sql_sheet_batch' }>,
  metrics?: TableReplayMetricsV2_ACU,
  context?: ReplayAliasContext_ACU | null,
): { aliases: Map<string, string>; conflicts: Set<string>; physicalNames: ReadonlyMap<string, string> | null } {
  const isPlainSqlIdentifier = (value: unknown): value is string => (
    typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_$]*$/.test(value)
  );

  // 基础 registry（buildSheetTableAliasMap_ACU + 短 sheetKey 别名）在同一
  // stateEpoch 内不变，按 epoch 缓存；operation 特有的历史 tableName 是
  // per-operation 派生叠加（派生副本，不污染缓存）。
  const useCache = Boolean(context?.enabled);
  // 冷构建路径：整个 state 的物理表名只解析一次（O(S^2) → O(S) 拼音计算），
  // 短 key 循环与 sql_sheet_batch 分支全部查 Map；缓存命中路径不重解析。
  const resolvedPhysicalNames = useCache && context!.tableAliasRegistry
    ? null
    : resolvePhysicalTableNames_ACU(state);
  let sharedRegistry: SheetAliasMapResult_ACU;
  let baseConflicts: Set<string>;
  if (useCache && context!.tableAliasRegistry && context!.tableConflictRegistry) {
    sharedRegistry = { aliases: context!.tableAliasRegistry, conflicts: context!.tableConflictRegistry };
    baseConflicts = context!.tableConflictRegistry;
    if (metrics) metrics.aliasCacheHitCount += 1;
  } else {
    sharedRegistry = buildSheetTableAliasMap_ACU([state], {
      includeExtendedAliases: true,
      // 冷构建已解析一次：直接复用，避免 buildSheetTableAliasMap_ACU 内重解析。
      preResolvedPhysicalNames: resolvedPhysicalNames ? [resolvedPhysicalNames] : undefined,
    });
    baseConflicts = new Set(sharedRegistry.conflicts);
    // 短 sheetKey 别名也属基础不变部分，合并进基础 registry。
    const addBaseAlias = (alias: unknown, runtimeName: string): void => {
      const normalized = decodeSqlIdentifier_ACU(alias).normalize('NFKC').trim().toLocaleLowerCase('en-US');
      if (!normalized || baseConflicts.has(normalized) || sharedRegistry.conflicts.has(normalized)) return;
      const existing = sharedRegistry.aliases.get(normalized);
      if (existing && existing !== runtimeName) {
        sharedRegistry.aliases.delete(normalized);
        baseConflicts.add(normalized);
        return;
      }
      sharedRegistry.aliases.set(normalized, runtimeName);
    };
    for (const [sheetKey, value] of Object.entries(state)) {
      if (!sheetKey.startsWith('sheet_')) continue;
      const sheet = value as Sheet_ACU;
      const runtimeName = resolvedPhysicalNames
        ? getPhysicalTableNameFromResolvedMap_ACU(resolvedPhysicalNames, sheetKey)
        : getPhysicalTableNameForSheet_ACU(state, sheetKey);
      if (isPlainSqlIdentifier(sheetKey.slice('sheet_'.length))) addBaseAlias(sheetKey.slice('sheet_'.length), runtimeName);
    }
    if (useCache) {
      context!.tableAliasRegistry = sharedRegistry.aliases;
      context!.tableConflictRegistry = baseConflicts;
    }
    if (metrics) metrics.tableAliasBuildCount += 1;
  }

  // 派生副本：当前 operation 专属的历史 tableName 别名叠加。
  const aliases = new Map(sharedRegistry.aliases);
  const conflicts = new Set(baseConflicts);
  const addAlias = (alias: unknown, runtimeName: string): void => {
    const normalized = decodeSqlIdentifier_ACU(alias).normalize('NFKC').trim().toLocaleLowerCase('en-US');
    if (!normalized || conflicts.has(normalized) || baseConflicts.has(normalized)) return;
    const existing = aliases.get(normalized);
    if (existing && existing !== runtimeName) {
      aliases.delete(normalized);
      conflicts.add(normalized);
      return;
    }
    aliases.set(normalized, runtimeName);
  };
  if (operation.kind === 'sql_sheet_batch') {
    // operation.tableName 是写入当时的历史物理表名，属于历史事实。
    // 表可能已改名（原名/拼音名互换）或该 sheetKey 暂不在当前 replay state 中，
    // 但只要能确定目标运行时表，就必须为历史名注册别名，否则这条增量会以
    // no such table 让整次回放失败。
    let target: string | null = null;
    if (state[operation.sheetKey]) {
      target = resolvedPhysicalNames
        ? getPhysicalTableNameFromResolvedMap_ACU(resolvedPhysicalNames, operation.sheetKey)
        : getPhysicalTableNameForSheet_ACU(state, operation.sheetKey);
      const historical = decodeSqlIdentifier_ACU(operation.tableName).trim().toLowerCase();
      const existingTarget = aliases.get(historical);
      if (historical && existingTarget && existingTarget !== target) {
        throw new Error(
          `[V2 Replay] sql_sheet_batch 历史表名与其他 Sheet 冲突：sheetKey=${operation.sheetKey}, tableName=${operation.tableName}, target=${target}, occupiedBy=${existingTarget}。`,
        );
      }
    } else {
      // sheetKey 不在 state 中时，退而按历史表名在已注册别名里定位目标表。
      const historical = decodeSqlIdentifier_ACU(operation.tableName).trim().toLowerCase();
      target = aliases.get(historical) || null;
    }
    if (target) addAlias(operation.tableName, target);
  }
  return { aliases, conflicts, physicalNames: resolvedPhysicalNames };
}

async function applySqlBatchOperationV2_ACU(
  state: TableDataObject_ACU,
  operation: Extract<TableMutationOperationV2_ACU, { kind: 'sql_batch' | 'sql_sheet_batch' }>,
  runtime: SqlReplayRuntime_ACU,
  supplementalTemplate: TableDataObject_ACU | null | undefined,
  options: { legacyDuplicateRowIds?: boolean; metrics?: TableReplayMetricsV2_ACU } = {},
  context?: ReplayAliasContext_ACU | null,
): Promise<void> {
  const statements = normalizeSqlStatementsForReplay_ACU(operation.statements || []);
  if (statements.length === 0) return;
  if (options.metrics) options.metrics.sqlOperationCount += statements.length;
  await ensureSqlReplayRuntime_ACU(runtime, state, options);
  // 结构 SQL（CREATE/ALTER/DROP/RENAME）改变 runtime schema，无法证明与 JS
  // state 在连续语句间保持同步；首版对含结构 SQL 的 operation 强制走冷 registry
  // 路径（本次重建，不读取也不写入缓存），保证后续 DML 仍可用同 epoch 缓存。
  const hasStructuralSql = statements.some(statement => /^\s*(CREATE|ALTER|DROP|RENAME)\b/i.test(statement));
  const effectiveContext = hasStructuralSql ? null : context;
  const { aliases, conflicts, physicalNames } = buildReplaySqlTableAliases_ACU(state, operation, options.metrics, effectiveContext);
  const replayStatements = rebindSqlMutationTableReferences_ACU(statements, aliases, {
    lenient: true,
    ambiguousAliases: conflicts,
  });
  // 列名重绑（计划 Phase 4）：仅 sql_sheet_batch 执行。sql_batch 是旧无归属类型，
  // 不做列重绑（计划 3.2）。表重绑已把目标表改写为当前物理名，故列别名以该
  // 物理名为 key 查询。列重绑抛错不捕获，让调用点的既有 wrapper 附加
  // messageIndex / seq / operationIndex 上下文；不提供 lenient（计划 4.1）。
  let columnReboundStatements = replayStatements;
  if (operation.kind === 'sql_sheet_batch'
    && typeof operation.sheetKey === 'string'
    && state[operation.sheetKey]) {
    const sheetKey = operation.sheetKey;
    const targetTableName = physicalNames
      ? getPhysicalTableNameFromResolvedMap_ACU(physicalNames, sheetKey)
      : getPhysicalTableNameForSheet_ACU(state, sheetKey);
    // 每个 operation 内构造：补锚经 commitReplayCandidate_ACU 更新 state 后，
    // 这里天然拿到补锚后的最新 state，无需额外重建（计划 4.3 确认项）。
    // target-first（计划 5.2）：target=state（checkpoint 权威），
    // supplemental=当前模板 header-only（只提供别名证据，绝不提供目标列）。
    // 列 registry 按 stateEpoch + supplementalFingerprint 缓存（阶段 B），
    // 并按 physicalName 惰性构建（阶段 D）：同一 epoch 内每张被 sql_sheet_batch
    // 命中的表只构建一次；结构 SQL 操作强制冷构建且不写入缓存（与表 alias 同策略）。
    // columnAliasBuildCount 语义 = 每 epoch 每命中表一次构建（与既有单表断言一致）。
    const useColumnCache = Boolean(context?.enabled) && !hasStructuralSql;
    const targetTableKey = targetTableName.toLowerCase();
    let columnResult: SheetColumnAliasMapResult_ACU | null = null;
    if (useColumnCache && context!.columnAliasRegistry) {
      // 命中本表已缓存的 registry（同一 epoch 内第二次及以后的 sql_sheet_batch）。
      columnResult = context!.columnAliasRegistry.get(targetTableKey) || null;
      // 命中即计数；未命中会走下方冷构建并累加 columnAliasBuildCount。
      if (columnResult && options.metrics) options.metrics.aliasCacheHitCount += 1;
    }
    if (!columnResult) {
      columnResult = buildSheetColumnAliasMap_ACU(state, {
        supplementalSources: [supplementalTemplate],
        skipInvalidSupplementalSources: true,
        // 惰性：只构建本 operation 命中的单张表（阶段 D）。等价性前提已由
        // resolvePhysicalTableNames_ACU fail-loud 冲突保证：无物理名冲突时单表
        // 构建与整库构建对该 physicalName 的 aliases/conflicts/evidence 逐字节一致。
        targetSheetKeys: new Set([sheetKey]),
      });
      if (useColumnCache) {
        if (!context!.columnAliasRegistry) context!.columnAliasRegistry = new Map();
        context!.columnAliasRegistry.set(targetTableKey, columnResult);
      }
      if (options.metrics) options.metrics.columnAliasBuildCount += 1;
    }
    const { aliases: columnAliases, conflicts: columnConflicts, sourceByAlias, conflictCandidates } = columnResult;
    const evidenceByAlias = sourceByAlias.get(targetTableName);
    const candidatesByAlias = conflictCandidates.get(targetTableName);
    let reboundCount = 0;
    columnReboundStatements = rebindSqlMutationColumnReferences_ACU(
      replayStatements,
      columnAliases,
      targetTableName,
      {
        ambiguousColumns: columnConflicts.get(targetTableName),
        // Phase 6：歧义拒绝时给出全部候选列与各自证据来源。
        resolveAmbiguity: candidatesByAlias
          ? alias => candidatesByAlias.get(alias.toLowerCase()) || []
          : undefined,
        onRebound: ({ from, to }) => {
          reboundCount += 1;
          // 阶段 B：列重绑日志聚合。历史长 SQL 段会产生大量重绑，逐条 warn
          // 会在主线程制造 console 开销并淹没真实告警；仅显式诊断开关下输出明细。
          if (settings_ACU.performanceDiagnosticsEnabled) {
            logWarn_ACU(
              `[V2 Replay][column-rebind] sheetKey=${sheetKey}, from=${from}, to=${to}, `
              + `evidence=${evidenceByAlias?.get(from.toLowerCase()) || 'unknown'}`,
            );
          }
        },
      },
    );
    if (options.metrics) options.metrics.columnRebindCount += reboundCount;
  }
  const params = Array.isArray(operation.params) ? operation.params : undefined;
  runtime.engine.runBatch(columnReboundStatements, params);
}


function assertMetaUpdateDoesNotChangeDdl_ACU(patch: Extract<TablePatchV2_ACU, { kind: 'meta_update' }>): void {
  const sourceData = patch.meta?.sourceData;
  if (sourceData && typeof sourceData === 'object' && !Array.isArray(sourceData)
    && Object.prototype.hasOwnProperty.call(sourceData, 'ddl')) {
    throw new Error(
      '[V2 Replay] legacy meta_update.sourceData.ddl 无法安全回放；该结构变更需要迁移为 sheet_schema_migrate 或 sheet_replace。',
    );
  }
}

function applyTablePatchLegacyDuplicateRowIds_ACU(
  state: TableDataObject_ACU,
  patch: TablePatchV2_ACU,
  toleranceReport?: LegacyToleranceReport_ACU,
): void {
  if (patch.kind === 'sheet_replace') {
    state[patch.sheetKey] = deepClone_ACU(patch.sheet);
    return;
  }
  const sheet = state[patch.sheetKey] as Sheet_ACU | undefined;
  if (!sheet || !Array.isArray(sheet.content)) {
    logWarn_ACU(`[V2 Replay] SPv7.9 兼容回放跳过缺少表或 content 的 patch: ${patch.sheetKey}`);
    return;
  }
  if (patch.kind === 'row_upsert') {
    if (!Array.isArray(patch.cells)) throw new Error(`[V2 Replay] legacy row_upsert cells 必须是数组：sheetKey=${patch.sheetKey}。`);
    const rowId = String(patch.rowId ?? patch.cells[0] ?? '').trim();
    if (!rowId) throw new Error(`[V2 Replay] legacy row_upsert 缺少 row_id：sheetKey=${patch.sheetKey}。`);
    const rowIndex = sheet.content.findIndex((row, index) => index > 0 && Array.isArray(row) && String(row[0] ?? '').trim() === rowId);
    const row = deepClone_ACU(patch.cells);
    if (row.length > 0) row[0] = rowId;
    if (rowIndex >= 0) sheet.content[rowIndex] = row;
    else sheet.content.push(row);
    if (toleranceReport) toleranceReport.lenientRowUpserts += 1;
    return;
  }
  if (patch.kind === 'row_delete') {
    const rowId = String(patch.rowId ?? '').trim();
    sheet.content = sheet.content.filter((row, index) => index === 0 || !Array.isArray(row) || String(row[0] ?? '').trim() !== rowId);
    return;
  }
  if (toleranceReport) {
    const sourceData = patch.meta?.sourceData;
    if (sourceData && typeof sourceData === 'object' && !Array.isArray(sourceData)
      && Object.prototype.hasOwnProperty.call(sourceData, 'ddl')) {
      // spv7.9 语义：meta_update.sourceData（含 ddl）按 Object.assign 合并应用。
      toleranceReport.legacyMetaUpdateDdlApplied += 1;
      logWarn_ACU(`[V2 Compat Replay] legacy meta_update.sourceData.ddl 按 spv7.9 语义应用：sheetKey=${patch.sheetKey}。`);
    }
  } else {
    assertMetaUpdateDoesNotChangeDdl_ACU(patch);
  }
  const meta = deepClone_ACU(patch.meta || {});
  if (meta.name !== undefined) sheet.name = meta.name;
  if (meta.orderNo !== undefined) sheet.orderNo = meta.orderNo;
  if (meta.updateConfig !== undefined) sheet.updateConfig = meta.updateConfig;
  if (meta.exportConfig !== undefined) sheet.exportConfig = meta.exportConfig;
  if (meta.sourceData !== undefined) sheet.sourceData = { ...sheet.sourceData, ...(meta.sourceData as Record<string, unknown>) };
}

export function applyTablePatchV2_ACU(state: TableDataObject_ACU, patch: TablePatchV2_ACU): void {
  if (patch.kind === 'sheet_replace') {
    state[patch.sheetKey] = deepClone_ACU(patch.sheet);
    return;
  }

  const sheet = state[patch.sheetKey] as Sheet_ACU | undefined;
  if (!sheet || !Array.isArray(sheet.content)) {
    const isLegacyRowUpsertDelete = patch.kind === 'row_upsert'
      && Array.isArray(patch.cells)
      && isEmptyCanonicalRowId_ACU(patch.cells[0]);
    if (isLegacyRowUpsertDelete) {
      throw new Error(
        `[V2 Replay] legacy row_upsert 删除目标 Sheet 缺失或 content 非法：sheetKey=${patch.sheetKey}。`,
      );
    }
    logWarn_ACU(`[V2 Replay] 跳过 patch，缺少表或 content: ${patch.sheetKey}`);
    return;
  }

  if (patch.kind === 'row_upsert') {
    if (!Array.isArray(patch.cells)) {
      throw new Error(`[V2 Replay] row_upsert cells 必须是数组：sheetKey=${patch.sheetKey}。`);
    }
    const nextCells = deepClone_ACU(patch.cells);
    const header = sheet.content[0];
    if (isEmptyCanonicalRowId_ACU(nextCells[0])) {
      const targetRowId = String(patch.rowId ?? '').trim();
      if (!targetRowId) {
        throw new Error(`[V2 Replay] legacy row_upsert 删除缺少 row_id：sheetKey=${patch.sheetKey}。`);
      }
      if (!Array.isArray(header) || header[0] !== 'row_id') {
        throw new Error(`[V2 Replay] legacy row_upsert 删除要求 row_id 表头：sheetKey=${patch.sheetKey}。`);
      }
      const matchingIndexes = sheet.content.reduce<number[]>((indexes, row, index) => {
        if (index > 0 && Array.isArray(row) && String(row[0] ?? '').trim() === targetRowId) indexes.push(index);
        return indexes;
      }, []);
      if (matchingIndexes.length === 0) {
        throw new Error(`[V2 Replay] legacy row_upsert 删除目标 row_id 不存在：sheetKey=${patch.sheetKey}。`);
      }
      if (matchingIndexes.length > 1) {
        throw new Error(`[V2 Replay] legacy row_upsert 删除遇到重复 row_id：sheetKey=${patch.sheetKey}。`);
      }
      sheet.content.splice(matchingIndexes[0], 1);
      return;
    }
    const rowId = String(patch.rowId ?? '').trim();
    const cellsRowId = String(nextCells[0]).trim();
    if (!rowId || rowId !== cellsRowId) {
      throw new Error(`[V2 Replay] row_upsert 身份不一致：sheetKey=${patch.sheetKey}。`);
    }
    if (!Array.isArray(header) || header[0] !== 'row_id') {
      throw new Error(`[V2 Replay] row_upsert 要求 row_id 表头：sheetKey=${patch.sheetKey}。`);
    }
    if (nextCells.length !== header.length) {
      throw new Error(`[V2 Replay] row_upsert 行宽不匹配：sheetKey=${patch.sheetKey}。`);
    }
    const matchingIndexes = sheet.content.reduce<number[]>((indexes, row, index) => {
      if (index > 0 && Array.isArray(row) && String(row[0] ?? '').trim() === rowId) indexes.push(index);
      return indexes;
    }, []);
    if (matchingIndexes.length > 1) {
      throw new Error(`[V2 Replay] row_upsert 遇到重复 row_id：sheetKey=${patch.sheetKey}。`);
    }
    nextCells[0] = rowId;
    if (matchingIndexes.length === 1) sheet.content[matchingIndexes[0]] = nextCells;
    else sheet.content.push(nextCells);
    return;
  }

  if (patch.kind === 'row_delete') {
    const targetRowId = String(patch.rowId ?? '').trim();
    sheet.content = sheet.content.filter((row, index) => {
      if (index === 0 || !Array.isArray(row)) return true;
      return String(row[0] ?? '').trim() !== targetRowId;
    });
    return;
  }

  if (patch.kind === 'meta_update') {
    const meta = deepClone_ACU(patch.meta || {});
    assertMetaUpdateDoesNotChangeDdl_ACU(patch);
    const sourceData = meta.sourceData;
    if (meta.name !== undefined) sheet.name = meta.name;
    if (meta.orderNo !== undefined) sheet.orderNo = meta.orderNo;
    if (meta.updateConfig !== undefined) sheet.updateConfig = meta.updateConfig;
    if (meta.exportConfig !== undefined) sheet.exportConfig = meta.exportConfig;
    if (sourceData !== undefined) {
      sheet.sourceData = { ...sheet.sourceData, ...(sourceData as Record<string, unknown>) };
    }
  }
}

function parseDslArgs_ACU(argsString: string): any[] | null {
  try {
    const firstBracket = argsString.indexOf('{');
    if (firstBracket === -1) return JSON.parse(`[${argsString}]`);
    const paramsPart = argsString.substring(0, firstBracket).trim();
    const jsonPart = argsString.substring(firstBracket);
    const initialArgs = JSON.parse(`[${paramsPart.replace(/,$/, '')}]`);
    return [...initialArgs, JSON.parse(jsonPart)];
  } catch (_) {
    return null;
  }
}

function extractTableEditDslCommands_ACU(text: string): string[] {
  const cleaned = String(text || '').replace(/<!--|-->/g, '');
  const commands: string[] = [];
  const commandPattern = /(?:insertRow|updateRow|deleteRow)\s*\(/g;
  let searchStart = 0;

  while (searchStart < cleaned.length) {
    commandPattern.lastIndex = searchStart;
    const match = commandPattern.exec(cleaned);
    if (!match) break;

    const commandStart = match.index;
    const openParenIndex = cleaned.indexOf('(', commandStart);
    if (openParenIndex === -1) break;

    let depth = 0;
    let inString = false;
    let stringChar = '';
    let escaped = false;
    let commandEnd = -1;

    for (let i = openParenIndex; i < cleaned.length; i += 1) {
      const char = cleaned[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === stringChar) {
          inString = false;
        }
        continue;
      }

      if (char === '"' || char === "'") {
        inString = true;
        stringChar = char;
        continue;
      }
      if (char === '(') {
        depth += 1;
      } else if (char === ')') {
        depth -= 1;
        if (depth === 0) {
          commandEnd = i + 1;
          break;
        }
      }
    }

    if (commandEnd === -1) break;
    const command = cleaned.slice(commandStart, commandEnd).trim().replace(/;$/, '');
    if (command) commands.push(command);
    searchStart = commandEnd;
  }

  return commands;
}

function resolveDslReplaySheetKeys_ACU(state: TableDataObject_ACU): string[] {
  const sortedKeys = getSortedSheetKeys_ACU(state as any);
  if (Array.isArray(sortedKeys) && sortedKeys.length > 0) return sortedKeys;
  return Object.keys(state).filter(k => k.startsWith('sheet_'));
}

function materializeSeedRowsForDslReplay_ACU(sheet: Sheet_ACU): void {
  if (!Array.isArray(sheet.content) || sheet.content.length !== 1) return;
  let seedRows = Array.isArray(sheet.seedRows) && sheet.seedRows.length > 0 ? sheet.seedRows : null;
  if (!seedRows && sheet.uid && String(sheet.uid).startsWith('sheet_')) {
    seedRows = getEffectiveSeedRowsForSheet_ACU(String(sheet.uid), {
      guideData: null,
      allowTemplateFallback: true,
    });
    if (Array.isArray(seedRows) && seedRows.length > 0) sheet.seedRows = deepClone_ACU(seedRows);
  }
  if (!Array.isArray(seedRows) || seedRows.length === 0) return;
  const headerRow = Array.isArray(sheet.content[0]) ? deepClone_ACU(sheet.content[0]) : ['row_id'];
  // 与实时 DSL 路径保持同一身份契约：只有明确的 seedRows 新行能在物化时补 row_id。
  sheet.content = [headerRow, ...ensureStableRowIdsForSeedRows_ACU(seedRows)];
}

function applyTableEditDslOperationV2_ACU(
  state: TableDataObject_ACU,
  text: string,
  toleranceReport?: LegacyToleranceReport_ACU,
): void {
  const sheetKeys = resolveDslReplaySheetKeys_ACU(state);
  const commands = extractTableEditDslCommands_ACU(text);

  for (const commandLine of commands) {
    const match = commandLine.match(/^(insertRow|deleteRow|updateRow)\s*\((.*)\)$/);
    if (!match) continue;
    const command = match[1];
    const args = parseDslArgs_ACU(match[2]);
    if (!args) continue;
    const tableIndex = Number(args[0]);
    const sheetKey = sheetKeys[tableIndex];
    const sheet = sheetKey ? state[sheetKey] as Sheet_ACU : null;
    if (!sheet || !Array.isArray(sheet.content)) continue;

    materializeSeedRowsForDslReplay_ACU(sheet);

    if (command === 'insertRow') {
      const data = args[1] || {};
      const headers = Array.isArray(sheet.content[0]) ? sheet.content[0].slice(1) : [];
      let firstCell: string;
      if (toleranceReport) {
        // spv7.9 行号算法：row_id = 当前物理行数（含表头），与旧版可见状态一致。
        firstCell = String(sheet.content.length);
        toleranceReport.legacyDslRowIdAllocations += 1;
      } else {
        firstCell = allocateStableRowId_ACU(createStableRowIdReservation_ACU(sheet.content.slice(1)));
      }
      const row = [firstCell];
      headers.forEach((_, colIndex) => row.push(data[colIndex] ?? data[String(colIndex)] ?? ''));
      sheet.content.push(row);
    } else if (command === 'deleteRow') {
      const rowIndex = Number(args[1]);
      if (Number.isFinite(rowIndex) && sheet.content.length > rowIndex + 1) sheet.content.splice(rowIndex + 1, 1);
    } else if (command === 'updateRow') {
      const rowIndex = Number(args[1]);
      const data = args[2] || {};
      const row = Number.isFinite(rowIndex) ? sheet.content[rowIndex + 1] : null;
      if (!Array.isArray(row)) continue;
      Object.keys(data).forEach(colIndexStr => {
        const colIndex = Number.parseInt(colIndexStr, 10);
        if (!Number.isFinite(colIndex)) return;
        row[colIndex + 1] = data[colIndexStr];
      });
    }
  }
}

export async function applyTableOperationV2_ACU(
  state: TableDataObject_ACU,
  operation: TableMutationOperationV2_ACU,
  runtime?: SqlReplayRuntime_ACU,
  supplementalTemplate?: TableDataObject_ACU | null,
  metrics?: TableReplayMetricsV2_ACU,
  context?: ReplayAliasContext_ACU | null,
): Promise<void> {
  await applyTableOperationV2Core_ACU(state, operation, runtime, supplementalTemplate, undefined, metrics, context);
}

async function applyTableOperationV2Core_ACU(
  state: TableDataObject_ACU,
  operation: TableMutationOperationV2_ACU,
  runtime?: SqlReplayRuntime_ACU,
  supplementalTemplate?: TableDataObject_ACU | null,
  options: { legacyDuplicateRowIds?: boolean; legacyTolerances?: LegacyToleranceReport_ACU } = {},
  metrics?: TableReplayMetricsV2_ACU,
  context?: ReplayAliasContext_ACU | null,
): Promise<void> {
  if (!operation || typeof operation !== 'object' || typeof (operation as any).kind !== 'string') {
    if (options.legacyTolerances) {
      options.legacyTolerances.unknownOperationKindsSkipped.push('missing_kind');
      logWarn_ACU('[V2 Compat Replay] 跳过缺少有效 kind 的 operation（spv7.9 兼容语义）。');
      return;
    }
    throw new Error('[V2 Replay] operation 缺少有效 kind。');
  }
  const ownedRuntime = !runtime && (operation.kind === 'sql_batch' || operation.kind === 'sql_sheet_batch')
    ? { engine: new SqliteEngine(), syncBridge: null as unknown as SyncBridge, loaded: false, mode: 'js_materialized' as const }
    : null;
  if (ownedRuntime) ownedRuntime.syncBridge = new SyncBridge(ownedRuntime.engine);
  const effectiveRuntime = runtime || ownedRuntime || null;

  try {
    // 阶段 B1：集中失效判定。任何改变表/列身份证据的 operation 使 epoch 递增
    // 并清空 registry 缓存；仅数据行变化（row_upsert/row_delete）不失效。
    // 结构 SQL（CREATE/ALTER/DROP/RENAME）在 applySqlBatchOperationV2_ACU 内部
    // 按冷 registry 语义处理，不在此重复失效。
    if (operationInvalidatesReplayAliasContext_ACU(operation)) {
      if (context?.enabled) invalidateReplayAliasContext_ACU(context);
      else if (metrics) metrics.aliasInvalidateCount += 1;
    }
    if (operation.kind === 'data_replace') {
      // JS-native 提交：先退出 SQL 段（materialize + dispose），再以 JS state 提交全量替换。
      if (effectiveRuntime) await materializeSqlRuntimeToState_ACU(effectiveRuntime, state, { ...options, metrics });
      const candidate = deepClone_ACU(operation.data);
      if (options.legacyDuplicateRowIds) {
        // SPv7.9 过渡回放逐项保留旧状态，不做历史 normalize；由上层 finally dispose。
      } else normalizeHistoricalReplayState_ACU(candidate, 'data_replace');
      replaceState_ACU(state, candidate);
      return;
    }
    if (operation.kind === 'sql_batch' || operation.kind === 'sql_sheet_batch') {
      if (!effectiveRuntime) throw new Error(`${operation.kind} replay requires runtime`);
      await applySqlBatchOperationV2_ACU(state, operation, effectiveRuntime, supplementalTemplate, { ...options, metrics }, context);
      if (ownedRuntime) exportSqlReplayRuntime_ACU(ownedRuntime, state, options);
      return;
    }
    if (operation.kind === 'sheet_schema_migrate') {
      if (effectiveRuntime) await materializeSqlRuntimeToState_ACU(effectiveRuntime, state, { ...options, metrics });
      const sourceState = buildReplayCandidate_ACU(effectiveRuntime, state, options);
      const candidate = await applySheetSchemaMigrationOperation_ACU(sourceState, operation);
      if (options.legacyDuplicateRowIds) {
        // SPv7.9 过渡回放逐项保留旧状态，不做历史 normalize。
      } else normalizeHistoricalReplayState_ACU(candidate, 'sheet_schema_migrate');
      replaceState_ACU(state, candidate);
      return;
    }
    if (operation.kind === 'sheet_replace') {
      if (effectiveRuntime) await materializeSqlRuntimeToState_ACU(effectiveRuntime, state, { ...options, metrics });
      const candidate = buildReplayCandidate_ACU(effectiveRuntime, state, options);
      candidate[operation.sheetKey] = deepClone_ACU(operation.sheet);
      if (options.legacyDuplicateRowIds) {
        // SPv7.9 过渡回放逐项保留旧状态，不做历史 normalize。
      } else normalizeHistoricalReplayState_ACU(candidate, 'sheet_replace');
      replaceState_ACU(state, candidate);
      return;
    }
    if (operation.kind === 'row_upsert' || operation.kind === 'row_delete' || operation.kind === 'meta_update') {
      if (operation.kind === 'meta_update' && !options.legacyTolerances) {
        assertMetaUpdateDoesNotChangeDdl_ACU(operation);
      }
      if (effectiveRuntime) await materializeSqlRuntimeToState_ACU(effectiveRuntime, state, { ...options, metrics });
      const candidate = buildReplayCandidate_ACU(effectiveRuntime, state, options);
      if (options.legacyDuplicateRowIds) applyTablePatchLegacyDuplicateRowIds_ACU(candidate, operation, options.legacyTolerances);
      else applyTablePatchV2_ACU(candidate, operation);
      if (options.legacyDuplicateRowIds) {
        // SPv7.9 过渡回放逐项保留旧状态，不做历史 normalize。
      } else normalizeHistoricalReplayState_ACU(candidate, operation.kind);
      replaceState_ACU(state, candidate);
      return;
    }
    if (operation.kind === 'table_edit_dsl') {
      if (effectiveRuntime) await materializeSqlRuntimeToState_ACU(effectiveRuntime, state, { ...options, metrics });
      const candidate = buildReplayCandidate_ACU(effectiveRuntime, state, options);
      applyTableEditDslOperationV2_ACU(candidate, operation.text, options.legacyTolerances);
      if (options.legacyDuplicateRowIds) {
        // SPv7.9 过渡回放逐项保留旧状态，不做历史 normalize。
      } else normalizeHistoricalReplayState_ACU(candidate, 'table_edit_dsl');
      replaceState_ACU(state, candidate);
      return;
    }

    if (options.legacyTolerances) {
      // spv7.9 读取器行为：未知 operation kind 跳过并告警，不使整条历史不可读。
      options.legacyTolerances.unknownOperationKindsSkipped.push(String((operation as any).kind));
      logWarn_ACU(`[V2 Compat Replay] 跳过未知 operation kind: ${String((operation as any).kind)}（spv7.9 兼容语义）。`);
      return;
    }
    throw new Error(`[V2 Replay] 不支持的 operation kind: ${(operation as any).kind}`);
  } finally {
    if (ownedRuntime) disposeSqlReplayRuntime_ACU(ownedRuntime);
  }
}

export function collectScheduleSummaryFromFramesV2_ACU(
  chatArg: any[] | null | undefined,
  isolationKey: string,
  options: { maxMessageIndex?: number } = {},
): TableScheduleSummaryV2_ACU {
  const chat = chatArg || [];
  if (!Array.isArray(chat) || chat.length === 0) return {};

  const frameRefs = getV2FrameRefs_ACU(chat, isolationKey)
    .filter(ref => options.maxMessageIndex === undefined || ref.messageIndex <= options.maxMessageIndex);
  const checkpointRef = [...frameRefs].reverse().find(ref => ref.frame.checkpoint?.kind === 'full');
  const transitionCandidate = findLatestTransitionCheckpoint_ACU(chat, isolationKey, options.maxMessageIndex);
  const transitionRef = transitionCandidate && (!checkpointRef || checkpointRef.messageIndex <= transitionCandidate.checkpoint.cutoff.messageIndex)
    ? transitionCandidate : null;

  const summary: TableScheduleSummaryV2_ACU = transitionRef
    ? deepClone_ACU(transitionRef.checkpoint.scheduleSummary || {})
    : (checkpointRef?.frame.checkpoint
      ? deepClone_ACU(checkpointRef.frame.checkpoint.scheduleSummary || {})
      : {});
  if (!transitionRef && checkpointRef?.frame.checkpoint) {
    applyEventToScheduleSummary_ACU(summary, checkpointRef.frame.checkpoint.event, checkpointRef.aiFloor);
  }

  for (const ref of frameRefs) {
    if (!transitionRef && checkpointRef && ref.messageIndex < checkpointRef.messageIndex) continue;
    const frameArtifactsAfterCutoff = !transitionRef
      || isFrameArtifactAfterSpv79TransitionCutoff_ACU(ref.messageIndex, transitionRef.checkpoint);
    // per-sheet artifact 没有 operationIndex；cutoff 消息及之前均由私有根的 summary 覆盖。
    const checkpoints = frameArtifactsAfterCutoff
      ? getValidatedSheetCheckpoints_ACU(ref.frame, ref.messageIndex)
      : [];
    const introductions = getValidatedTimelineCheckpointsForFrame_ACU(checkpoints);
    for (const sheetCheckpoint of checkpoints.filter(checkpoint => checkpoint.timeline === undefined)) {
      summary[sheetCheckpoint.sheetKey] = deepClone_ACU(sheetCheckpoint.scheduleSummary || {});
      applyEventToScheduleSummary_ACU(
        summary,
        sheetCheckpoint.event,
        ref.aiFloor,
      );
    }
    const entries = getReplayOrderedFrameLogEntries_ACU(ref.frame);
    const pendingIntroductions = [...introductions];
    const applyDueIntroductions = (nextSeq: number): void => {
      const due = pendingIntroductions.filter(checkpoint => checkpoint.timeline!.afterSeq < nextSeq);
      for (const checkpoint of due) {
        summary[checkpoint.sheetKey] = deepClone_ACU(checkpoint.scheduleSummary || {});
        applyEventToScheduleSummary_ACU(summary, checkpoint.event, ref.aiFloor);
        pendingIntroductions.splice(pendingIntroductions.indexOf(checkpoint), 1);
      }
    };
    for (const entry of entries) {
      // schedule event 是 entry 级事实，没有 operationIndex；cutoff entry 及之前均已吸收。
      if (transitionRef && !isEntryAfterSpv79TransitionCutoff_ACU(
        ref.messageIndex, entry.seq, transitionRef.checkpoint,
      )) continue;
      applyDueIntroductions(entry.seq);
      applyEventToScheduleSummary_ACU(summary, entry, ref.aiFloor);
    }
    applyDueIntroductions(Number.POSITIVE_INFINITY);
  }

  return summary;
}

async function loadTableStateFromFramesV2DetailedCore_ACU(
  chatArg?: any[],
  isolationKeyArg?: string,
  options: LoadTableStateFromFramesV2Options_ACU = {},
): Promise<TableReplayResultV2_ACU | null> {
  const chat = chatArg || getChatArray_ACU();
  if (!Array.isArray(chat) || chat.length === 0) return null;

  const isolationKey = isolationKeyArg ?? getCurrentIsolationKey_ACU();
  const frameRefs = getV2FrameRefs_ACU(chat, isolationKey)
    .filter(ref => options.maxMessageIndex === undefined || ref.messageIndex <= options.maxMessageIndex);
  const checkpointRef = [...frameRefs].reverse().find(ref => ref.frame.checkpoint?.kind === 'full');
  const transitionCandidate = findLatestTransitionCheckpoint_ACU(chat, isolationKey, options.maxMessageIndex);
  const transitionRef = transitionCandidate && (!checkpointRef || checkpointRef.messageIndex <= transitionCandidate.checkpoint.cutoff.messageIndex)
    ? transitionCandidate : null;
  const hasUnanchoredArtifacts = hasUnanchoredReplayArtifacts_ACU(frameRefs);
  let baseKind: TableReplayBaseKindV2_ACU = 'full_checkpoint';
  let state: TableDataObject_ACU;
  let replayStartMessageIndex: number;
  let replacementAnchorCursor: ReplacementAnchor_ACU | null = null;

  if (transitionRef) {
    state = cloneSpv79TransitionData_ACU(transitionRef.checkpoint);
    baseKind = transitionRef.source === 'compat' ? 'compat_transition_checkpoint' : 'spv79_transition_checkpoint';
    replayStartMessageIndex = transitionRef.messageIndex;
  } else if (!checkpointRef?.frame.checkpoint) {
    if (!hasUnanchoredArtifacts) return null;
    // A replacement anchor supersedes everything before it, so it is a valid
    // base on its own and needs no template baseline or user confirmation.
    const replacementAnchor = findLastUsableReplacementAnchor_ACU(frameRefs);
    if (replacementAnchor) {
      state = deepClone_ACU(replacementAnchor.data);
      normalizeLegacyDuplicateCheckpointState_ACU(state);
      baseKind = 'replacement_anchor';
      replayStartMessageIndex = replacementAnchor.messageIndex;
      replacementAnchorCursor = replacementAnchor;
      logWarn_ACU(
        `[V2 Replay] 未找到 full checkpoint，已采用最后一个完整 data_replace 作为替换基底：`
        + `messageIndex=${replacementAnchor.messageIndex}, seq=${replacementAnchor.seq}, `
        + `operationIndex=${replacementAnchor.operationIndex}。该基底之前的日志按完整替换语义被覆盖。`,
      );
    } else {
    if (!options.allowTemporaryTemplateBaseline) {
      logWarn_ACU('[V2 Replay] 未找到 full checkpoint，检测到无锚点 V2 replay artifacts，拒绝恢复不完整 V2 表格数据。');
      return null;
    }
    const temporaryBaseline = resolveHeaderOnlyTemplateSnapshot_ACU(chat, isolationKey);
    if (!temporaryBaseline) {
      logWarn_ACU('[V2 Replay] 无锚点 artifacts 缺少同聊天同隔离域的有效模板，拒绝建立临时基线。');
      return null;
    }
    state = temporaryBaseline;
    baseKind = 'temporary_template_baseline';
    replayStartMessageIndex = frameRefs[0]?.messageIndex ?? 0;
    logWarn_ACU('[V2 Replay] 未找到 full checkpoint，正使用当前聊天模板的 header-only 临时基线回放；该状态不是持久化锚点。');
    }
  } else {
    const checkpoint = checkpointRef.frame.checkpoint;
    state = deepClone_ACU(checkpoint.data);
    normalizeLegacyDuplicateCheckpointState_ACU(state);
    replayStartMessageIndex = checkpointRef.messageIndex;
    if (options.updateRuntimeState !== false) replayCheckpointSchedule_ACU(checkpoint, checkpointRef.aiFloor);
  }

  const runtime: SqlReplayRuntime_ACU = {
    engine: new SqliteEngine(),
    syncBridge: null as unknown as SyncBridge,
    loaded: false,
    mode: 'js_materialized',
  };
  const compatibilityRepairs: TableReplayCompatibilityRepairV2_ACU[] = [];
  let headerOnlyTemplate: TableDataObject_ACU | null | undefined;
  let headerOnlyTemplateFingerprint = '';
  runtime.syncBridge = new SyncBridge(runtime.engine);
  const metrics = createReplayMetrics_ACU();
  // 阶段 H：多 boundary 前向捕获状态。captureBoundarySet 是待捕获的 boundary
  // 集合（递增），capturedBoundaries 收集已捕获快照。仅当调用方传入
  // captureBoundaries 且当前是只读路径时才初始化；否则为空 Set/Map，捕获逻辑
  // 零开销（has/delete 对空 Set 恒 false）。
  //
  // 捕获结果写入调用方传入的 captureSink（外层多 boundary API 借此读回各 boundary
  // 快照）；未传则用内部临时 Map，快照随本次调用结束丢弃（等价于无消费方，零
  // 额外成本）。主结果不携带捕获 Map，避免在 result 上引入与现有契约不符的新字段。
  const captureBoundarySet = new Set<number>(
    options.updateRuntimeState === false
      ? (Array.isArray(options.captureBoundaries) ? options.captureBoundaries : [])
      : [],
  );
  const capturedBoundaries = options.captureSink
    ?? new Map<number, TableReplayResultV2_ACU>();

  try {
    // 阶段 B2：单次回放调用内复用的 alias registry 上下文。仅在此调用内
    // 存活（不写模块全局/跨请求复用），默认安全启用（options.enableAliasContext
    // !== false）；显式 false 作为测试与紧急回滚开关，保证关闭时与基线一致。
    const aliasContext = createReplayAliasContext_ACU(metrics);
    aliasContext.enabled = options.enableAliasContext !== false;
    // 列重绑 supplemental 与补锚共用同一份当前模板 header-only 快照：
    // 提前解析一次并缓存（惰性），避免每个 operation 重复解析。
    // 解析失败 → null，列重绑退化为无 supplemental（仍 target-first fail closed）。
    headerOnlyTemplate = resolveHeaderOnlyTemplateSnapshot_ACU(chat, isolationKey);
    if (headerOnlyTemplate) headerOnlyTemplateFingerprint = getTableDataFingerprint_ACU(headerOnlyTemplate);
    // 阶段 I：只读 replay 的取消检查点。
    //
    // 只在 updateRuntimeState===false 时生效：副作用路径（replayEventForState_ACU /
    // replayCheckpointSchedule_ACU）会改写全局 schedule state，中途抛出会留下半完成
    // mutation，比让它跑完更危险，因此不接受取消。
    //
    // 只在 frame/entry 边界调用（replay state 完整、未处于单条 SQLite batch 或事务
    // 半执行状态）；runtime 由外层 finally 的 disposeSqlReplayRuntime_ACU 释放，
    // 因此在这两处抛出不会泄漏 Database。
    const throwIfReplayAborted_ACU = (): void => {
      if (options.updateRuntimeState === false && options.signal?.aborted) {
        throw new V2ReplayAbortedError_ACU();
      }
    };
    // 阶段 I：受控主线程让步。只在只读路径（updateRuntimeState:false）生效；
    // 只在 frame/entry 边界调用（replay state 完整、未处于单条 SQLite batch 或
    // 事务半执行状态）。基于时间预算：自上次让出起累计处理超过 yieldBudgetMs 才
    // 真正让出一次，未超时零开销（不产生额外宏任务）。metrics.yieldCount 记录
    // 实际让出次数，供「是否过度调度」观测。
    const yieldBudgetMs = options.updateRuntimeState === false
      ? (Number(options.yieldBudgetMs) > 0 ? Number(options.yieldBudgetMs) : 0)
      : 0;
    let lastYieldAt = Date.now();
    const yieldIfBudgetExceeded_ACU = async (): Promise<void> => {
      if (yieldBudgetMs <= 0) return;
      const now = Date.now();
      if (now - lastYieldAt < yieldBudgetMs) return;
      // 让出事件循环：setTimeout(0) 允许挂起的输入/渲染/其它任务先跑。
      // 恢复后由调用点（frame/entry 边界）的 throwIfReplayAborted_ACU 复查
      // signal——取消在 yield 窗口内到达时，下一个边界立即抛出。
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      lastYieldAt = Date.now();
      metrics.yieldCount += 1;
    };
    for (const ref of frameRefs) {
      if (ref.messageIndex < replayStartMessageIndex) continue;
      throwIfReplayAborted_ACU();
      await yieldIfBudgetExceeded_ACU();
      metrics.frameCount += 1;
      const frameArtifactsAfterCutoff = !transitionRef
        || isFrameArtifactAfterSpv79TransitionCutoff_ACU(ref.messageIndex, transitionRef.checkpoint);
      const checkpoints = frameArtifactsAfterCutoff
        ? getValidatedSheetCheckpoints_ACU(ref.frame, ref.messageIndex) : [];
      const introductions = getValidatedTimelineCheckpointsForFrame_ACU(checkpoints);
      const isAnchorFrame = replacementAnchorCursor?.messageIndex === ref.messageIndex;
      await applySheetCheckpointsForReplay_ACU(
        state,
        // A replacement anchor is a complete state. Untimed checkpoints in
        // that same frame have no ordering marker proving they occurred after
        // it, so replaying them would resurrect superseded data. Timeline
        // checkpoints are retained below and only become due after anchor seq.
        checkpoints.filter(checkpoint => checkpoint.timeline === undefined && !isAnchorFrame),
        runtime,
        metrics,
        aliasContext,
      );
      const entries = getReplayOrderedFrameLogEntries_ACU(ref.frame);
      metrics.logEntryCount += entries.length;
      const pendingIntroductions = isAnchorFrame
        ? introductions.filter(checkpoint => checkpoint.timeline!.afterSeq > replacementAnchorCursor!.seq)
        : [...introductions];
      const applyDueIntroductions = async (nextSeq: number): Promise<void> => {
        const due = pendingIntroductions.filter(checkpoint => checkpoint.timeline!.afterSeq < nextSeq);
        if (due.length === 0) return;
        await applySheetCheckpointsForReplay_ACU(state, due, runtime, metrics, aliasContext);
        for (const checkpoint of due) {
          if (options.updateRuntimeState !== false) {
            replayEventForState_ACU(checkpoint.event, ref.aiFloor);
          }
          pendingIntroductions.splice(pendingIntroductions.indexOf(checkpoint), 1);
        }
      };
      for (const entry of entries) {
        if (isAnchorFrame && entry.seq < replacementAnchorCursor!.seq) continue;
        // 取消检查放在 try 之前：try 的 catch 会把异常包装成「应用日志失败」并上报
        // logError_ACU，取消若落进去就会被误判为回放故障。
        throwIfReplayAborted_ACU();
        // entry 粒度让出：entry 数通常远大于 frame 数，大 fixture 下仅 frame 边界
        // 让出不足以维持响应性；此处与取消检查同点（state 完整、未在 SQL 半执行态）。
        await yieldIfBudgetExceeded_ACU();
        try {
          await applyDueIntroductions(entry.seq);
          if (Array.isArray(entry.operations) && entry.operations.length > 0) {
            metrics.operationCount += entry.operations.length;
            for (const [operationIndex, operation] of entry.operations.entries()) {
              if (transitionRef && !isAfterSpv79TransitionCutoff_ACU(
                ref.messageIndex,
                entry.seq,
                operationIndex,
                transitionRef.checkpoint,
              )) continue;
              if (isAnchorFrame
                && entry.seq === replacementAnchorCursor!.seq
                && operationIndex <= replacementAnchorCursor!.operationIndex) {
                continue;
              }
              try {
                if (options.compatibilityMode !== 'disabled'
                  && operation?.kind === 'sql_sheet_batch'
                  && typeof operation.sheetKey === 'string'
                  && operation.sheetKey.startsWith('sheet_')
                  && !Object.prototype.hasOwnProperty.call(state, operation.sheetKey)) {
                  const templateSheet = headerOnlyTemplate?.[operation.sheetKey];
                  if (templateSheet && typeof templateSheet === 'object' && !Array.isArray(templateSheet)) {
                    // 补锚是 JS 语义（模板 header-only 快照），先退出 SQL 段再合并。
                    await materializeSqlRuntimeToState_ACU(runtime, state);
                    const candidate = deepClone_ACU(state);
                    candidate[operation.sheetKey] = deepClone_ACU(templateSheet) as Sheet_ACU;
                    normalizeHistoricalReplayState_ACU(candidate, 'temporary sheet anchor');
                    replaceState_ACU(state, candidate);
                    if (aliasContext.enabled) invalidateReplayAliasContext_ACU(aliasContext);
                    compatibilityRepairs.push({
                      kind: 'temporary_sheet_anchor',
                      severity: 'provisional',
                      sheetKey: operation.sheetKey,
                      messageIndex: ref.messageIndex,
                      seq: entry.seq,
                      operationIndex,
                      templateFingerprint: headerOnlyTemplateFingerprint,
                      reason: 'missing_at_operation',
                    });
                    logWarn_ACU(`[V2 Replay] operation 执行点缺少目标表，已从当前聊天模板临时补锚：sheetKey=${operation.sheetKey}, messageIndex=${ref.messageIndex}, seq=${entry.seq}, operationIndex=${operationIndex}。该状态需要由 recovery 或 compaction 固化。`);
                  }
                }
                await applyTableOperationV2_ACU(
                  state,
                  operation,
                  runtime,
                  headerOnlyTemplate,
                  metrics,
                  aliasContext,
                );
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw new Error(
                  `[V2 Replay] operation failed: messageIndex=${ref.messageIndex}, seq=${entry.seq}, operationIndex=${operationIndex}, kind=${String((operation as any)?.kind || 'unknown')}: ${message}`,
                );
              }
            }
          } else {
            if (transitionRef && !isEntryAfterSpv79TransitionCutoff_ACU(
              ref.messageIndex, entry.seq, transitionRef.checkpoint,
            )) continue;
            // legacy patches 是 JS 语义：先退出 SQL 段再应用补丁。
            await materializeSqlRuntimeToState_ACU(runtime, state, { metrics });
            // 阶段 B1：legacy patches 中 sheet_replace/meta_update 会改变表/列身份
            // 证据（物理表名、tableAliases、columnAliases、name 等），必须先失效
            // alias registry，否则后续 SQL 会用旧 registry 错误重绑并被持久化。
            // 同一 entry 多个结构 patch 只失效一次（不重复清空计数）。
            const invalidatesAliasContext = (entry.patches || []).some(patchInvalidatesReplayAliasContext_ACU);
            if (invalidatesAliasContext) {
              if (aliasContext.enabled) invalidateReplayAliasContext_ACU(aliasContext);
              else if (metrics) metrics.aliasInvalidateCount += 1;
            }
            const candidate = deepClone_ACU(state);
            // 兼容旧版 derived patch log；新 V2 不再写 patches。
            for (const patch of entry.patches || []) {
              applyTablePatchV2_ACU(candidate, patch);
            }
            normalizeHistoricalReplayState_ACU(candidate, 'legacy patches');
            replaceState_ACU(state, candidate);
          }
          const shouldReplayEntryEvent = !transitionRef || isEntryAfterSpv79TransitionCutoff_ACU(
            ref.messageIndex, entry.seq, transitionRef.checkpoint,
          );
          if (shouldReplayEntryEvent && options.updateRuntimeState !== false) {
            replayEventForState_ACU(entry, ref.aiFloor);
          }
        } catch (error) {
          logError_ACU(`[V2 Replay] 应用日志失败: messageIndex=${ref.messageIndex}, seq=${entry.seq}`, error);
          throw error;
        }
      }
      await applyDueIntroductions(Number.POSITIVE_INFINITY);
      // 阶段 H：多 boundary 前向捕获。命中 captureBoundaries 的消息索引在
      // 该 frame 处理完毕（state 完整、SQLite 已 materialize）后捕获一次快照。
      // 仅只读路径（updateRuntimeState:false）允许：中间 materialize 不会破坏
      // schedule replay（只读路径本就不写 schedule），且捕获的是该 boundary 的
      // canonical 完整状态。同起算 checkpoint 语义下，此快照与「单独 replay 到
      // 该 boundary」完全一致。
      if (captureBoundarySet.size > 0 && captureBoundarySet.has(ref.messageIndex)) {
        if (options.updateRuntimeState !== false) {
          throw new Error('[V2 Replay] captureBoundaries 仅在 updateRuntimeState:false 的只读路径下允许。');
        }
        // captureBoundaries 非空时 capturedBoundaries 恒为实际容器（传入的
        // captureSink 或内部临时 Map），此处直接写入。快照携带该 boundary 的
        // baseKind 与 repair 状态：外层 API 须据此校验（任一 boundary 依赖 repair
        // 即整体失败，不得返回不完整快照）。metrics 为该 boundary 捕获时的累计值
        // 浅拷贝（不共享同一引用，外层可安全持有各快照）。
        await materializeSqlRuntimeToState_ACU(runtime, state, { metrics });
        const snapshotBaseKind = baseKind;
        const snapshotRepairs = compatibilityRepairs.length > 0 ? [...compatibilityRepairs] : undefined;
        capturedBoundaries.set(ref.messageIndex, {
          data: deepClone_ACU(state),
          baseKind: snapshotBaseKind,
          metrics: { ...metrics },
          capturedBoundary: ref.messageIndex,
          ...(snapshotRepairs ? { compatibilityRepairs: snapshotRepairs } : {}),
          ...(snapshotRepairs ? { requiresCheckpointConvergence: true } : {}),
        });
        captureBoundarySet.delete(ref.messageIndex);
      }
    }

    // replay 结束：SQLite 仍为权威状态时最后导出一次并 dispose，保持单 Database 峰值。
    await materializeSqlRuntimeToState_ACU(runtime, state, { metrics });
    // 阶段 H：捕获全部命中后，主结果 data 以最终 state 为准（与单边界语义一致）；
    // capturedBoundaries 由调用方通过 loadTableStatesAtBoundariesFromFramesV2Detailed_ACU
    // 读取。若捕获列表非空（部分 boundary 未命中——例如 boundary 早于起算 checkpoint
    // 或超出 frameRefs 范围），按失败处理：调用方应回退逐次冷 replay。
    return {
      data: state,
      baseKind,
      metrics,
      ...(compatibilityRepairs.length > 0 ? { compatibilityRepairs } : {}),
      ...(compatibilityRepairs.length > 0 ? { requiresCheckpointConvergence: true } : {}),
    };
  } finally {
    disposeSqlReplayRuntime_ACU(runtime);
  }
}

/** Tier-1 兼容结果的 schedule 尽力应用：失败只告警，不阻塞数据可用。 */
function applyScheduleSummaryBestEffort_ACU(
  chat: any[],
  isolationKey: string,
  maxMessageIndex?: number,
): void {
  try {
    const summary = collectScheduleSummaryFromFramesV2_ACU(chat, isolationKey, { maxMessageIndex });
    for (const [sheetKey, state] of Object.entries(summary)) {
      if (state.lastFilledAiFloor === undefined) continue;
      if (!independentTableStates_ACU[sheetKey]) independentTableStates_ACU[sheetKey] = {};
      independentTableStates_ACU[sheetKey].lastUpdatedAiFloor = state.lastFilledAiFloor;
    }
  } catch (error) {
    logWarn_ACU(
      `[V2 Compat Replay] 兼容读取后 schedule 汇总应用失败（不影响表格数据可用）：`
      + `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * C3 自动降级链：严格回放抛出任何回放语义错误（用户取消除外）时，运行
 * Tier-1 兼容回放。成功 → 本次调用直接返回兼容结果（数据立即可用），
 * 宿主当前聊天则异步触发过渡根固化；Tier-1 也失败 → 原错误继续抛出
 * （进入加载失败可见化流程）。
 */
async function recoverWithLegacyTolerantReplay_ACU(
  chat: any[],
  isolationKey: string,
  options: LoadTableStateFromFramesV2Options_ACU,
  originalError: unknown,
): Promise<TableReplayResultV2_ACU> {
  if (originalError instanceof V2ReplayAbortedError_ACU) throw originalError;
  // compatibilityMode:'disabled' 的调用方全部是写路径校验探针（persist 候选校验、
  // 收敛/边界升级、恢复候选、追平锚点预检等），它们依赖"严格回放失败=候选不可
  // 提交"的失败信号。Tier-1 宽容回放也是一种兼容修复，纳入同一开关豁免，
  // 保证写门闸的失败信号不被降级链吞掉（读永远宽容，写才严格）。
  if (options.compatibilityMode === 'disabled') throw originalError;
  const originalMessage = originalError instanceof Error ? originalError.message : String(originalError);
  let tolerant: LegacyTolerantReplayResult_ACU;
  try {
    tolerant = await replayWithLegacyTolerances_ACU(chat, isolationKey, {
      maxMessageIndex: options.maxMessageIndex,
    });
  } catch (tolerantError) {
    logError_ACU(
      `[V2 Compat Replay] Tier-1 兼容回放也失败，保留原始错误。兼容回放错误：`
      + `${tolerantError instanceof Error ? tolerantError.message : String(tolerantError)}`,
    );
    throw originalError;
  }
  const toleranceSummary = summarizeLegacyToleranceReport_ACU(tolerant.toleranceReport);
  logWarn_ACU(
    `[V2 Compat Replay] 严格回放失败，已按 spv7.9 兼容语义读出可用数据。`
    + `原错误=${originalMessage}；容忍项=${toleranceSummary.join(', ')}。`,
  );
  if (options.updateRuntimeState !== false) {
    applyScheduleSummaryBestEffort_ACU(chat, isolationKey, options.maxMessageIndex);
  }
  // 只有宿主当前聊天允许后台固化（候选回放、bounded 验证、导入诊断保持纯函数性质）。
  if (chat === getChatArray_ACU()) {
    scheduleCompatTransitionFixation_ACU(chat, isolationKey);
  }
  // 返回前尽力把行身份归一为新版契约（与固化根使用同一 reindex 纯函数）：
  // 成功则首次加载与固化后的后续加载看到完全一致的 row_id；失败则原样返回
  // 兼容结果（仍可用，只是该历史无法固化）。
  let resultData = tolerant.data;
  try {
    const reindexed = reindexSpv79TransitionState_ACU(tolerant.data);
    const normalization = normalizeCanonicalTableRows_ACU(reindexed);
    if (normalization.errors.length === 0 && normalization.removedRows.length === 0) {
      resultData = reindexed;
    }
  } catch (reindexError) {
    logWarn_ACU(
      `[V2 Compat Replay] 兼容结果行身份重编号失败，按原始兼容结果返回：`
      + `${reindexError instanceof Error ? reindexError.message : String(reindexError)}`,
    );
  }
  return {
    data: resultData,
    baseKind: 'compat_tolerant_replay',
    metrics: createReplayMetrics_ACU(),
  };
}

export async function loadTableStateFromFramesV2Detailed_ACU(
  chatArg?: any[],
  isolationKeyArg?: string,
  options: LoadTableStateFromFramesV2Options_ACU = {},
): Promise<TableReplayResultV2_ACU | null> {
  const chat = chatArg || getChatArray_ACU();
  const isolationKey = isolationKeyArg ?? getCurrentIsolationKey_ACU();
  // 阶段 E：仅内存 evidence 复用。同 chat 引用 + 同 isolationKey + 同 boundary +
  // full_checkpoint 基 + 无结构 repair 时直接复用上次结果（深克隆，不共享引用，
  // 保持纯函数性质）。不满足一律走冷 replay（fail-open）。
  const evidence = options.replayEvidence;
  const currentHeadRevisionDigest = computeReplayHeadRevisionDigest_ACU(chat, isolationKey);
  const currentStructureMappingDigest = (() => {
    const structureMapping = resolveHeaderOnlyTemplateSnapshot_ACU(chat, isolationKey);
    return structureMapping ? getTableDataFingerprint_ACU(structureMapping) : '';
  })();
  const currentReplayOptionsFingerprint = buildReplayOptionsFingerprint_ACU(options);
  // updateRuntimeState:true 时不得复用（需副作用）；此处证据仅由 false 路径写入，
  // 命中必然为 false，但防御性再确认一次。
  // 阶段 H：captureBoundaries 非空（多 boundary 前向捕获）时禁止 evidence 复用与
  // 写入——捕获路径必须真实跑完 core 才能把各 boundary 快照写入 captureSink，
  // 命中 evidence 直接 return 会绕过 core 导致 sink 为空（外层误判全部未命中而
  // 回退冷 replay）；且 capture 最终态（maxMessageIndex:undefined）若被写成
  // evidence，会命中普通加载的复用校验、污染语义。捕获路径与 evidence 严格互斥。
  const captureMode = Array.isArray(options.captureBoundaries) && options.captureBoundaries.length > 0;
  const evidenceReusable = !!evidence
  && !options.updateRuntimeState
    && !captureMode
    && validateV2ReplayEvidenceFresh_ACU(
      evidence, chat, isolationKey,
      { maxMessageIndex: options.maxMessageIndex },
      currentHeadRevisionDigest,
      currentStructureMappingDigest,
      currentReplayOptionsFingerprint,
    );
  if (evidence && evidenceReusable) {
    const data = deepClone_ACU(evidence.data);
    // 复用命中同样上报 span：命中路径直接 return，若不上报则「整轮冷回放被跳过」
    // 在生产中完全不可观测，无法验证快路径是否真的生效，也无法回答收益问题。
    const reuseMetrics = createReplayMetrics_ACU();
    reuseMetrics.replayReuseCount = 1;
    startRuntimePerformanceSpan_ACU('v2-replay', {
      runId: options.performanceRunId,
      parentSpanId: options.performanceParentSpanId,
      settings: settings_ACU,
      metrics: {
        messageCount: Array.isArray(chat) ? chat.length : 0,
        maxMessageIndex: options.maxMessageIndex ?? -1,
      },
    }).end({
      success: true,
      baseKind: evidence.baseKind,
      sheetCount: Object.keys(data || {}).filter(key => key.startsWith('sheet_')).length,
      replayReuseCount: 1,
      replayReuseFallbackCount: 0,
    });
    return {
      data,
      baseKind: evidence.baseKind,
      metrics: reuseMetrics,
    };
  }

  // 阶段 G2：in-flight 去重（evidence 未命中后、core 调用前）。
  // 同 key 的并发/紧邻纯只读调用共享一次全量 replay：第一个调用方启动 core，
  // 后续调用方 await 同一 promise。共享结果深克隆 data（不共享引用，保持纯函数
  // 性质），metrics 标记 replayShareCount=1 以区分 evidence 复用（replayReuseCount）。
  // 仅合并并发窗口内的重复调用：promise settle 后从 Map 删除，不缓存历史。
  const inflightKey = buildInflightReplayKey_ACU(chat, isolationKey, options, currentStructureMappingDigest);
  if (inflightKey) {
    const existing = inflightV2Replays_ACU.get(inflightKey);
    if (existing) {
      try {
        const shared = await existing;
        if (!shared) return null;
        const sharedMetrics = createReplayMetrics_ACU();
        sharedMetrics.replayShareCount = 1;
        startRuntimePerformanceSpan_ACU('v2-replay', {
          runId: options.performanceRunId,
          parentSpanId: options.performanceParentSpanId,
          settings: settings_ACU,
          metrics: {
            messageCount: Array.isArray(chat) ? chat.length : 0,
            maxMessageIndex: options.maxMessageIndex ?? -1,
          },
        }).end({
          success: true,
          baseKind: shared.baseKind,
          sheetCount: Object.keys(shared.data || {}).filter(key => key.startsWith('sheet_')).length,
          replayShareCount: 1,
        });
        return {
          data: deepClone_ACU(shared.data),
          baseKind: shared.baseKind,
          metrics: sharedMetrics,
        };
      } finally {
        // 等待方不负责清理：清理由启动方在 settle 后执行（见下方 finally）。
      }
    }
  }

  const performanceSpan = startRuntimePerformanceSpan_ACU('v2-replay', {
    runId: options.performanceRunId,
    parentSpanId: options.performanceParentSpanId,
    settings: settings_ACU,
    metrics: {
      messageCount: Array.isArray(chat) ? chat.length : 0,
      maxMessageIndex: options.maxMessageIndex ?? -1,
    },
  });
  try {
    // 阶段 G2：in-flight 启动方。若 key 存在（且此前未被并发方占用），把 core 调用
    // 包成共享 promise 存入 Map，让同 key 的并发调用等待同一结果；settle 后清理。
    // 共享 promise 必须包含 Tier-1 兼容恢复逻辑（等待方不应拿到原始失败），
    // 因此把「core 调用 + 恢复」整体包入，任何路径 settle 后删除。
    const inflightStarted = inflightKey
      ? (() => {
        const sharedPromise = (async (): Promise<TableReplayResultV2_ACU | null> => {
          try {
            return await loadTableStateFromFramesV2DetailedCore_ACU(chatArg, isolationKeyArg, options);
          } catch (error) {
            return await recoverWithLegacyTolerantReplay_ACU(chat, isolationKey, options, error);
          } finally {
            inflightV2Replays_ACU.delete(inflightKey);
          }
        })();
        inflightV2Replays_ACU.set(inflightKey, sharedPromise);
        return sharedPromise;
      })()
      : null;
    const result = inflightStarted
      ? await inflightStarted
      : await loadTableStateFromFramesV2DetailedCore_ACU(chatArg, isolationKeyArg, options);
    // 传入了 evidence 却走到这里 = 判定失配并回退冷回放（fail-open）。
    // 首次调用（空 evidence 对象）同样计入失配，命中率才有分母意义。
    if (evidence && !evidenceReusable && result?.metrics) {
      result.metrics.replayReuseFallbackCount = 1;
    }
    performanceSpan.end({
      success: result !== null,
      baseKind: result?.baseKind || 'none',
      sheetCount: result?.data
        ? Object.keys(result.data).filter(key => key.startsWith('sheet_')).length
        : 0,
      ...(result?.metrics ? {
        frameCount: result.metrics.frameCount,
        logEntryCount: result.metrics.logEntryCount,
        operationCount: result.metrics.operationCount,
        sqlOperationCount: result.metrics.sqlOperationCount,
        columnRebindCount: result.metrics.columnRebindCount,
        tableAliasBuildCount: result.metrics.tableAliasBuildCount,
        columnAliasBuildCount: result.metrics.columnAliasBuildCount,
        aliasInvalidateCount: result.metrics.aliasInvalidateCount,
        aliasCacheHitCount: result.metrics.aliasCacheHitCount,
        sqliteHydrateCount: result.metrics.sqliteHydrateCount,
        sqliteMaterializeCount: result.metrics.sqliteMaterializeCount,
        replayReuseCount: result.metrics.replayReuseCount,
        replayReuseFallbackCount: result.metrics.replayReuseFallbackCount,
        yieldCount: result.metrics.yieldCount,
      } : {}),
    });
    // 阶段 E：只对满足严格条件的成功结果写 evidence（供后续同边界调用复用）。
    // 副作用路径（updateRuntimeState:true、mayCreateTransition、结构性 repair、
    // 非 full_checkpoint 基）一律不写，杜绝把带副作用的中间态当复用证据。
    if (evidence
      && result
      && !options.updateRuntimeState
      && !captureMode
      && result.baseKind === 'full_checkpoint'
      && !result.compatibilityRepairs?.length
      && !result.requiresCheckpointConvergence) {
      evidence.data = deepClone_ACU(result.data);
      evidence.chatIdentity = chat;
      evidence.isolationKey = isolationKey;
      evidence.maxMessageIndex = options.maxMessageIndex;
      evidence.baseKind = result.baseKind;
      evidence.compatibilityRepairs = null;
      evidence.requiresCheckpointConvergence = false;
      evidence.headRevisionDigest = currentHeadRevisionDigest;
      evidence.structureMappingDigest = currentStructureMappingDigest;
      evidence.replayOptionsFingerprint = currentReplayOptionsFingerprint;
      evidence.createdAt = Date.now();
    }
    return result;
  } catch (error) {
    // Tier-1 兼容恢复已在共享 promise 内处理（启动方与等待方一致拿到恢复结果）。
    // 非 in-flight 路径（inflightKey 为 null）的恢复仍由外层处理：保持与既有语义一致。
    if (!inflightKey) {
      try {
        const recovered = await recoverWithLegacyTolerantReplay_ACU(chat, isolationKey, options, error);
        performanceSpan.end({ success: true, baseKind: recovered.baseKind, recoveredWithLegacyTolerances: true });
        return recovered;
      } catch (finalError) {
        performanceSpan.end({ success: false, recoveredWithLegacyTolerances: false });
        throw finalError;
      }
    }
    performanceSpan.end({ success: false });
    throw error;
  }
}

/**
 * 阶段 H：多 boundary 一次前向 replay（简化版）。
 *
 * 对同一 candidateChat/isolationKey 上的多个递增 boundary 捕获 canonical 快照。
 * 仅当**所有 boundary 共享同一起算 full checkpoint**（从各自 frameRefs 反向查找
 * 的最后一个 full checkpoint 完全相同）时走前向捕获：从该 checkpoint 起算、沿
 * frame 顺序推进，在每个命中 boundary 处 materialize 并深克隆快照。此语义与
 * 「分别冷 replay 到每个 boundary」完全一致（同一 state/aliasContext/runtime
 * 生命周期，alias registry 推导不丢），但 frame 扫描与 SQL 执行只发生一次。
 *
 * 任一起算 checkpoint 不同（跨 checkpoint 段）时回退**逐次冷 replay**（与当前
 * 行为完全一致），不做部分前向捕获——避免在共享前缀不完整时产生错误快照。
 *
 * 仅支持 updateRuntimeState:false（只读路径）；副作用路径拒绝多 boundary 捕获。
 * 任一 boundary 的 replay 失败（baseKind 非 full_checkpoint / 依赖 repair /
 * 抛错）时整体失败并抛出，调用方保持原有逐边界校验语义。
 *
 * @returns Map<boundary, TableReplayResultV2_ACU>，key 严格递增，每个结果的
 *   capturedBoundary 标记对应 boundary。
 */
export async function loadTableStatesAtBoundariesFromFramesV2Detailed_ACU(
  chatArg: any[] | null | undefined,
  isolationKeyArg: string,
  boundaries: readonly number[],
  options: Omit<LoadTableStateFromFramesV2Options_ACU, 'captureBoundaries' | 'maxMessageIndex'> = {},
): Promise<Map<number, TableReplayResultV2_ACU>> {
  const chat = chatArg || getChatArray_ACU();
  if (!Array.isArray(chat) || chat.length === 0) return new Map();
  if (options.updateRuntimeState !== false) {
    throw new Error('[V2 Replay] loadTableStatesAtBoundariesFromFramesV2Detailed_ACU 仅支持 updateRuntimeState:false 只读路径。');
  }
  if (!Array.isArray(boundaries) || boundaries.length === 0) return new Map();

  const isolationKey = isolationKeyArg ?? getCurrentIsolationKey_ACU();
  // 注意 boundary 语义：maxMessageIndex 是「处理 messageIndex ≤ boundary 的所有
  // 帧」的上界，而非「boundary 处必须有帧」。聊天末尾可能是无 storage frame 的
  // 消息（例如末尾 AI 楼层未落盘），boundary=chat.length-1 依然合法：replay 到
  // 不晚于它的最后一个帧。因此**不做**越界拒绝——超出最大帧的 boundary 等价于
  // 不设上限（处理全量），与既有 maxMessageIndex 语义完全一致。
  const allFrameRefs = getV2FrameRefs_ACU(chat, isolationKey);
  // 每个 boundary 的起算 checkpoint：该 boundary 的 frameRefs 中最后一个 full checkpoint。
  // 全部相同才允许前向捕获；否则回退逐次冷 replay。
  const roots = new Map<number, number | null>();
  for (const boundary of boundaries) {
    const frameRefs = allFrameRefs
      .filter(ref => ref.messageIndex <= boundary);
    const checkpointRef = [...frameRefs].reverse().find(ref => ref.frame.checkpoint?.kind === 'full');
    roots.set(boundary, checkpointRef?.messageIndex ?? null);
  }
  const firstRoot = roots.values().next().value as number | null;
  const allShareRoot = [...roots.values()].every(root => root === firstRoot && root !== null);

  if (allShareRoot) {
    // 前向捕获：单次 replay，captureBoundaries 驱动中间快照。
    const sorted = [...boundaries].sort((a, b) => a - b);
    // 调用方传入的可写容器：core 在捕获时写入，此处读回各 boundary 快照。
    // 若不传容器，core 使用内部临时 Map（结果随调用结束丢弃），本函数将读不到
    // 中间快照——因此必须显式传入，杜绝「静默只返回最终态」的错误语义。
    const captureSink = new Map<number, TableReplayResultV2_ACU>();
    const result = await loadTableStateFromFramesV2Detailed_ACU(chat, isolationKey, {
      ...options,
      updateRuntimeState: false,
      captureBoundaries: sorted,
      captureSink,
    });
    if (!result || result.baseKind !== 'full_checkpoint') {
      throw new Error('[V2 Replay] 多 boundary 前向捕获未建立正式 full checkpoint 基底。');
    }
    // 主结果只反映最终 boundary 的 state；各 boundary 快照从 sink 读回。校验：
    // 1) 每个 boundary 都命中（sink 覆盖全部传入值）——部分未命中说明该 boundary
    //    早于起算 checkpoint 或超出 frameRefs 范围，返回不完整 Map 会误导调用方；
    // 2) 任一快照依赖 repair 或非 full_checkpoint 基——拒绝返回不完整快照。
    // 任一校验失败都回退逐次冷 replay（与既有逐边界语义一致，保证正确性优先）。
    const missing = sorted.filter(boundary => !captureSink.has(boundary));
    const invalid = [...captureSink.entries()].filter(
      ([, snap]) => snap.baseKind !== 'full_checkpoint'
        || snap.compatibilityRepairs?.length
        || snap.requiresCheckpointConvergence,
    );
    if (missing.length === 0 && invalid.length === 0) {
      const results = new Map<number, TableReplayResultV2_ACU>();
      for (const boundary of sorted) results.set(boundary, captureSink.get(boundary)!);
      return results;
    }
    // 覆盖不全或有 repair：回退逐次冷 replay（下方共用回退路径）。
  }

  // 回退路径：逐次冷 replay（与既有逐边界语义完全一致）。
  const results = new Map<number, TableReplayResultV2_ACU>();
  for (const boundary of [...boundaries].sort((a, b) => a - b)) {
    const replay = await loadTableStateFromFramesV2Detailed_ACU(chat, isolationKey, {
      ...options,
      updateRuntimeState: false,
      maxMessageIndex: boundary,
    });
    if (!replay || replay.baseKind !== 'full_checkpoint') {
      throw new Error(`[V2 Replay] 多 boundary 回退 replay 未建立正式基底：boundary=${boundary}。`);
    }
    if (replay.compatibilityRepairs?.length || replay.requiresCheckpointConvergence) {
      throw new Error(`[V2 Replay] 多 boundary 回退 replay 依赖兼容修复：boundary=${boundary}。`);
    }
    results.set(boundary, { ...replay, capturedBoundary: boundary });
  }
  return results;
}


export async function loadTableStateFromFramesV2_ACU(
  chatArg?: any[],
  isolationKeyArg?: string,
  options: LoadTableStateFromFramesV2Options_ACU = {},
): Promise<TableDataObject_ACU | null> {
  const result = await loadTableStateFromFramesV2Detailed_ACU(chatArg, isolationKeyArg, options);
  return result?.data ?? null;
}

export interface LegacyTolerantReplayResult_ACU {
  data: TableDataObject_ACU;
  cutoff: { messageIndex: number; seq: number; operationIndex: number };
  toleranceReport: LegacyToleranceReport_ACU;
}

/**
 * Tier-1 兼容回放的帧内日志排序：spv7.9 按 seq 排序回放（稳定排序，
 * seq 相等/缺失时保持物理顺序），与严格路径的"物理顺序重建临时 seq"不同。
 * 仅当全部 entry 都带整数 seq 时按 seq 排序；否则退回严格路径的物理顺序修复。
 */
function getLegacyTolerantOrderedEntries_ACU(
  frame: TableStorageFrameV2_ACU,
  report: LegacyToleranceReport_ACU,
): TableMutationLogEntryV2_ACU[] {
  const rawEntries = frame.logEntries;
  if (rawEntries === undefined) return [];
  const list = Array.isArray(rawEntries)
    ? rawEntries
    : (rawEntries && typeof rawEntries === 'object' ? [rawEntries] : null);
  if (!list) throw new Error('logEntries 必须是数组或旧版单条日志对象');
  const allHaveSeq = list.every(entry => Number.isInteger((entry as any)?.seq) && (entry as any).seq >= 0);
  if (!allHaveSeq) return getReplayOrderedFrameLogEntries_ACU(frame, { warnOnRepair: false });
  const sorted = [...list].sort((left, right) => (left as any).seq - (right as any).seq);
  if (sorted.some((entry, index) => entry !== list[index])) {
    report.outOfOrderSeqSorted += 1;
    logWarn_ACU(`[V2 Compat Replay] 帧内 logEntries seq 乱序，已按 spv7.9 语义排序回放：entries=${list.length}。`);
  }
  return sorted as TableMutationLogEntryV2_ACU[];
}

/**
 * Tier-1 通用宽容回放器：以 spv7.9 读取器语义全集重建可见状态。
 *
 * 容忍集合一次性全开（行为 = spv7.9 读取器）：重复 row_id、乱序/重复 seq、
 * legacy meta_update（含 sourceData.ddl）、未知 operation kind 跳过、宽松
 * row_upsert、旧 DSL 行号算法、两代 sheetKey 身份归并。不修改 storageFrame，
 * 也不会成为新写入路径；返回结果供直接使用与（可选的）过渡根固化。
 */
export async function replayWithLegacyTolerances_ACU(
  chatArg: any[] | null | undefined,
  isolationKey: string,
  options: { maxMessageIndex?: number } = {},
): Promise<LegacyTolerantReplayResult_ACU> {
  const chat = Array.isArray(chatArg) ? chatArg : [];
  const toleranceReport = createLegacyToleranceReport_ACU();
  const frameRefs = getV2FrameRefs_ACU(chat, isolationKey)
    .filter(ref => options.maxMessageIndex === undefined || ref.messageIndex <= options.maxMessageIndex);
  if (frameRefs.length === 0) throw new Error('SPv7.9 兼容回放缺少 V2 storage frame。');

  const baseIndex = findLastFullCheckpointFrameIndex_ACU(frameRefs);
  if (baseIndex < 0) throw new Error('SPv7.9 兼容回放缺少 full checkpoint 基底。');
  const baseRef = frameRefs[baseIndex];
  const checkpoint = baseRef.frame.checkpoint;
  if (!checkpoint || checkpoint.kind !== 'full') throw new Error('SPv7.9 兼容回放基底不是有效 full checkpoint。');
  // 基底结构校验：data 必须是承载表数据的 plain object（含 sheet_* 或 mate）。
  // 垃圾基底（字符串/数组/空对象等）若不拦截，后续 merge/normalize 对非对象
  // state 全部静默 no-op，会让 Tier-1"成功"返回不可用状态，绕过上游阻塞防线。
  const baseData = checkpoint.data as unknown;
  const baseDataIsPlainObject = !!baseData && typeof baseData === 'object' && !Array.isArray(baseData);
  const baseDataHasTableShape = baseDataIsPlainObject
    && Object.keys(baseData as Record<string, unknown>).some(key => key.startsWith('sheet_') || key === 'mate');
  if (!baseDataHasTableShape) throw new Error('SPv7.9 兼容回放基底 full checkpoint data 结构非法（非表数据对象）。');

  // 身份归并 hint：当前模板/指导表侧的 key 优先保留。
  let headerOnlyTemplate: TableDataObject_ACU | null = null;
  try {
    headerOnlyTemplate = resolveHeaderOnlyTemplateSnapshot_ACU(chat, isolationKey);
  } catch (_) {
    headerOnlyTemplate = null;
  }
  const preferredKeys = headerOnlyTemplate
    ? Object.keys(headerOnlyTemplate).filter(key => key.startsWith('sheet_'))
    : null;
  const state = deepClone_ACU(checkpoint.data);
  const mergeIdentities = (stage: string): void => {
    const merge = mergeLegacySheetIdentities_ACU(state, preferredKeys);
    if (merge.remaps.length === 0) return;
    toleranceReport.identityRemaps.push(...merge.remaps);
    logWarn_ACU(
      `[V2 Compat Replay] 两代 sheetKey 身份归并（${stage}）：`
      + merge.remaps.map(remap => `${remap.fromKey}→${remap.toKey}（覆盖 ${remap.overriddenRows} 行、并入 ${remap.appendedRows} 行）`).join('；')
      + '。原 storage frame 未修改。',
    );
  };
  mergeIdentities('base');

  let cutoff = { messageIndex: baseRef.messageIndex, seq: 0, operationIndex: -1 };
  for (let frameIndex = baseIndex; frameIndex < frameRefs.length; frameIndex += 1) {
    const ref = frameRefs[frameIndex];
    const checkpoints = getValidatedSheetCheckpoints_ACU(ref.frame, ref.messageIndex);
    // 根帧自身的 checkpoint 已作为 base；其余未排序单表快照遵循现有 replay 的帧首语义。
    for (const sheetCheckpoint of checkpoints.filter(item => item.timeline === undefined)) {
      state[sheetCheckpoint.sheetKey] = deepClone_ACU(sheetCheckpoint.data);
    }
    mergeIdentities(`sheet checkpoints@${ref.messageIndex}`);
    const entries = getLegacyTolerantOrderedEntries_ACU(ref.frame, toleranceReport);
    const pendingTimelineCheckpoints = checkpoints.filter(item => item.timeline !== undefined);
    const applyDueTimelineCheckpoints = (nextSeq: number): void => {
      const due = pendingTimelineCheckpoints.filter(item => item.timeline!.afterSeq < nextSeq);
      for (const sheetCheckpoint of due) {
        if (sheetCheckpoint.timeline?.kind === 'sheet_hide') delete state[sheetCheckpoint.sheetKey];
        else state[sheetCheckpoint.sheetKey] = deepClone_ACU(sheetCheckpoint.data);
        pendingTimelineCheckpoints.splice(pendingTimelineCheckpoints.indexOf(sheetCheckpoint), 1);
      }
      if (due.length > 0) mergeIdentities(`timeline checkpoints@${nextSeq}`);
    };
    for (const entry of entries) {
      applyDueTimelineCheckpoints(entry.seq);
      if (Array.isArray(entry.operations) && entry.operations.length > 0) {
        for (const [operationIndex, operation] of entry.operations.entries()) {
          // SQL 段物化前必须先归并身份，否则物理表名解析会因两代 key 同名冲突抛错。
          mergeIdentities(`operation@${ref.messageIndex}/${entry.seq}/${operationIndex}`);
          await applyTableOperationV2Core_ACU(state, operation, undefined, headerOnlyTemplate ?? undefined, {
            legacyDuplicateRowIds: true,
            legacyTolerances: toleranceReport,
          });
          cutoff = { messageIndex: ref.messageIndex, seq: entry.seq, operationIndex };
        }
      } else {
        for (const [operationIndex, patch] of (entry.patches || []).entries()) {
          applyTablePatchLegacyDuplicateRowIds_ACU(state, patch, toleranceReport);
          cutoff = { messageIndex: ref.messageIndex, seq: entry.seq, operationIndex };
        }
        if (!entry.patches?.length) cutoff = { messageIndex: ref.messageIndex, seq: entry.seq, operationIndex: -1 };
      }
    }
    applyDueTimelineCheckpoints(Number.POSITIVE_INFINITY);
  }
  mergeIdentities('final');
  return { data: state, cutoff, toleranceReport };
}

/**
 * SPv7.9 的一次性恢复回放（兼容导出）。现在是 Tier-1 通用宽容回放器的
 * 薄包装：行为是其超集，仅丢弃 toleranceReport。
 */
export async function replaySpv79DuplicateRowIdHistory_ACU(
  chatArg: any[] | null | undefined,
  isolationKey: string,
): Promise<{ data: TableDataObject_ACU; cutoff: { messageIndex: number; seq: number; operationIndex: number } }> {
  const result = await replayWithLegacyTolerances_ACU(chatArg, isolationKey);
  return { data: result.data, cutoff: result.cutoff };
}

/**
 * 把 Tier-1 兼容回放结果固化为通用兼容过渡根 compatTransitionCheckpoint。
 *
 * 固化是尽力而为的后台优化：canonical 校验不过、缺少可写楼层、已有更新
 * 过渡根时**放弃固化并返回 false，不抛错**——本次兼容读取结果的可用性
 * 与固化是否成功完全解耦。固化成功后，后续加载从该根起算走严格快路径。
 */
export async function createCompatTransitionCheckpointFromTolerantReplay_ACU(
  chat: any[],
  isolationKey: string,
): Promise<boolean> {
  const targetMessageIndex = (() => {
    for (let index = chat.length - 1; index >= 0; index -= 1) {
      if (chat[index] && !chat[index].is_user) return index;
    }
    return -1;
  })();
  if (targetMessageIndex < 0) {
    logWarn_ACU('[V2 Compat Replay] 放弃固化兼容过渡根：缺少可写入的 AI 楼层。数据仍按兼容读取结果可用。');
    return false;
  }

  const tolerant = await replayWithLegacyTolerances_ACU(chat, isolationKey);
  const existing = findLatestTransitionCheckpoint_ACU(chat, isolationKey);
  if (existing && compareTransitionCutoffs_ACU(existing.checkpoint.cutoff, tolerant.cutoff) >= 0) {
    // 已有过渡根覆盖了同样或更新的历史，无需重复固化。
    return false;
  }
  const data = reindexSpv79TransitionState_ACU(tolerant.data);
  const normalization = normalizeCanonicalTableRows_ACU(data);
  const issues = [...normalization.errors, ...normalization.removedRows];
  if (issues.length > 0) {
    logWarn_ACU(
      `[V2 Compat Replay] 放弃固化兼容过渡根：重编号结果不满足 canonical 行身份契约：`
      + `${formatCanonicalRowIssues_ACU(issues)}。数据仍按兼容读取结果可用，下次加载将继续走兼容回放。`,
    );
    return false;
  }
  let scheduleSummary: TableScheduleSummaryV2_ACU | undefined;
  try {
    scheduleSummary = collectScheduleSummaryFromFramesV2_ACU(chat, isolationKey);
  } catch (_) {
    scheduleSummary = undefined;
  }
  const tolerances = summarizeLegacyToleranceReport_ACU(tolerant.toleranceReport);

  await runTableWriteTransaction_ACU({
    source: 'system_cleanup',
    reason: 'createCompatTransitionCheckpointFromTolerantReplay',
    isolationKey,
    writeSet: [{ kind: 'all' }],
    maintenanceMode: 'exclusive',
    workingDataMode: 'none',
  }, async ctx => ctx.runCommit(async () => {
    const target = chat[targetMessageIndex];
    if (!target || target.is_user) throw new Error('兼容过渡 checkpoint 的目标 AI 楼层在提交前已变化。');
    const latest = findLatestTransitionCheckpoint_ACU(chat, isolationKey);
    if (latest && compareTransitionCutoffs_ACU(latest.checkpoint.cutoff, tolerant.cutoff) >= 0) return;
    const hadIsolatedData = Object.prototype.hasOwnProperty.call(target, 'TavernDB_ACU_IsolatedData');
    const previousIsolatedData = target.TavernDB_ACU_IsolatedData;
    const hadIdentity = Object.prototype.hasOwnProperty.call(target, 'TavernDB_ACU_Identity');
    const previousIdentity = target.TavernDB_ACU_Identity;
    try {
      const isolatedData = previousIsolatedData && typeof previousIsolatedData === 'object' && !Array.isArray(previousIsolatedData)
        ? deepClone_ACU(previousIsolatedData)
        : {};
      const tagData = isolatedData[isolationKey] && typeof isolatedData[isolationKey] === 'object' && !Array.isArray(isolatedData[isolationKey])
        ? isolatedData[isolationKey]
        : {};
      tagData.compatTransitionCheckpoint = {
        version: 1,
        kind: 'compat_replay_transition',
        createdAt: Date.now(),
        data: deepClone_ACU(data),
        cutoff: tolerant.cutoff,
        ...(scheduleSummary === undefined ? {} : { scheduleSummary }),
        tolerances,
      };
      isolatedData[isolationKey] = tagData;
      target.TavernDB_ACU_IsolatedData = isolatedData;
      writeMessageIdentity_ACU(target, {
        enabled: settings_ACU.dataIsolationEnabled,
        code: settings_ACU.dataIsolationCode,
      });
      await saveChatToHostStrict_ACU();
    } catch (error) {
      if (hadIsolatedData) target.TavernDB_ACU_IsolatedData = previousIsolatedData;
      else delete target.TavernDB_ACU_IsolatedData;
      if (hadIdentity) target.TavernDB_ACU_Identity = previousIdentity;
      else delete target.TavernDB_ACU_Identity;
      throw error;
    }
  }));
  logWarn_ACU(`[V2 Compat Replay] 已把兼容读取结果固化为过渡根：cutoff=${JSON.stringify(tolerant.cutoff)}, tolerances=${tolerances.join(', ')}。后续加载将走严格快路径。`);
  return true;
}

/** 后台固化的 in-flight 去重（isolationKey 维度）。固化失败只告警，不影响已返回的数据。 */
const pendingCompatTransitionFixations_ACU = new Map<string, Promise<void>>();

function scheduleCompatTransitionFixation_ACU(chat: any[], isolationKey: string): void {
  if (pendingCompatTransitionFixations_ACU.has(isolationKey)) return;
  const task = (async () => {
    try {
      await createCompatTransitionCheckpointFromTolerantReplay_ACU(chat, isolationKey);
    } catch (error) {
      logWarn_ACU(
        `[V2 Compat Replay] 兼容过渡根固化失败（不影响当前数据使用，下次加载重试）：`
        + `${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      pendingCompatTransitionFixations_ACU.delete(isolationKey);
    }
  })();
  pendingCompatTransitionFixations_ACU.set(isolationKey, task);
}

/** 测试辅助：等待所有后台固化任务完成（生产代码不调用）。 */
export async function flushPendingCompatTransitionFixations_ACU(): Promise<void> {
  while (pendingCompatTransitionFixations_ACU.size > 0) {
    await Promise.all([...pendingCompatTransitionFixations_ACU.values()]);
  }
}

export async function validateCurrentChatTableRecovery_ACU(
  options: { chat?: any[]; isolationKey?: string } = {},
): Promise<
  | { success: true }
  | { success: false; error: string; diagnosticCode?: 'replay_requires_checkpoint_convergence'; affectedSheetKeys?: string[] }
> {
  const chat = options.chat || getChatArray_ACU();
  if (!Array.isArray(chat) || chat.length === 0) return { success: true };
  try {
    const replay = await loadTableStateFromFramesV2Detailed_ACU(
      chat,
      options.isolationKey ?? getCurrentIsolationKey_ACU(),
      { updateRuntimeState: false },
    );
    if (replay?.requiresCheckpointConvergence || replay?.compatibilityRepairs?.length) {
      const affectedSheetKeys = [...new Set((replay.compatibilityRepairs || []).map(repair => repair.sheetKey))];
      return {
        success: false,
        diagnosticCode: 'replay_requires_checkpoint_convergence',
        affectedSheetKeys,
        error: `当前 V2 历史仍依赖临时 Sheet 补锚：${affectedSheetKeys.join('、') || '未知 Sheet'}。请先在数据管理中完成恢复收敛。`,
      };
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error || '未知错误'),
    };
  }
}
