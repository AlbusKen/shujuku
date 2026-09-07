import type { Sheet_ACU, TableDataObject_ACU } from '../../shared/models/table-data';

export type TableMutationSourceV2_ACU =
  | 'auto_fill'
  | 'manual_fill'
  | 'group_fill'
  | 'manual_crud'
  | 'raw_sql_mutation'
  | 'raw_sql_batch'
  | 'import'
  | 'merge_summary'
  | 'template_assistant'
  | 'system';

export interface TableMutationEventV2_ACU {
  filledSheetKeys: string[];
  changedSheetKeys: string[];
  groupKeys?: string[];
  requestId?: string;
  batchId?: string;
  error?: string;
}

export interface TableCheckpointScheduleSummaryV2_ACU {
  lastFilledAiFloor?: number;
  lastChangedAiFloor?: number;
}

export type ManualRefillProgressStatusV2_ACU =
  | 'in_progress'
  | 'complete'
  | 'planned'
  | 'collecting'
  | 'committing'
  | 'committed'
  | 'stopped'
  | 'failed'
  | 'sync_pending';

export interface ManualRefillProgressV2_ACU {
  kind: 'manual_refill';
  /** 未带 version 的历史进度继续按旧契约读取。 */
  version?: 2;
  status: ManualRefillProgressStatusV2_ACU;
  selectedSheetKeys: string[];
  contextMessageIndices: number[];
  originalStartMessageIndex: number;
  targetMessageIndex: number;
  batchSize: number;
  completedUntilMessageIndex: number;
  completedSheetMessageIndexByKey?: Record<string, number>;
  runId?: string;
  mode?: 'refill' | 'catch_up';
  targetAiFloor?: number;
  planSignature?: string;
  waveIndex?: number;
  bucketIndex?: number;
  totalWaves?: number;
  totalBuckets?: number;
  lastError?: string;
  updatedAt: number;
}

/**
 * 一键追平后置 Full Checkpoint 的临时锚点桥（provisional bridge）。
 *
 * 场景：追平目标早于现有正式 full checkpoint，且所选表需要从开头补齐。
 * 此时为本次 run 建立临时 full checkpoint，一路填到原 full 边界后原子汇合。
 *
 * 该元数据是 run-scoped 的恢复证据，不是普通 mutation：它只存在于 isolation tag 的
 * 非 replay 字段（storageFrame 之外），绝不参与 V2 replay，因此旧版本读取不受影响。
 *
 * 状态机：
 *   preparing          候选构造临时根与原根备份，尚未严格落盘
 *   provisional_active 临时根已落盘，原 full frame 已暂存，允许同 runId bucket 写入
 *   bridging           正在恢复原根并写 selected-sheet rebase（仅存在于候选/事务内）
 *   finalized          原根恢复、rebase 生效、临时根与 provisional 前缀已清理
 *   rollback_required  拓扑漂移或无法安全自动 finalize，阻止普通写入并引导恢复
 */
export interface ManualCatchUpProvisionalBridgeV1_ACU {
  version: 1;
  kind: 'manual_catch_up_provisional_bridge';
  runId: string;
  chatKey: string;
  isolationKey: string;
  selectedSheetKeys: string[];
  /** 追平范围首个有效 AI 楼层（临时根所在楼层）。 */
  rangeStartMessageIndex: number;
  /** 原正式 full checkpoint 所在楼层。 */
  originalFullCheckpointIndex: number;
  phase:
    | 'preparing'
    | 'provisional_active'
    | 'bridging'
    | 'finalized'
    | 'rollback_required';
  /** 原正式 full frame 的指纹，用于零猜测恢复校验。 */
  originalFullFrameFingerprint: string;
  /** 临时根（provisional full checkpoint）所在楼层。 */
  provisionalRootIndex: number;
  /** 最后一个已严格提交的 bucket 目标楼层。 */
  lastCommittedTargetIndex: number;
  createdAt: number;
  updatedAt: number;
  /** 原 full frame 的完整深拷贝备份（仅受影响 isolation slot/frame）。 */
  originalFullFrame: TableStorageFrameV2_ACU;
}

export type ManualCatchUpProvisionalBridgePhase_ACU =
  ManualCatchUpProvisionalBridgeV1_ACU['phase'];

/** 新 migration checkpoint 对 legacy-v1 来源的声明性证据；历史 V2 checkpoint 可以缺失。 */
export interface TableMigrationProvenanceV1_ACU {
  version: 1;
  legacyDataFingerprint: string;
  legacySourceMessageIndices: number[];
  legacySourceAiFloors: number[];
  legacyLastChangedAiFloorBySheet: Record<string, number>;
  targetMessageIndex: number;
  targetAiFloor: number;
  isolationKey: string;
  migratedAt: number;
}

/** 手动重填在历史缺少正式根时写入的可升级临时根来源。 */
export interface ManualRefillTemplateRootProvenanceV1_ACU {
  version: 1;
  kind: 'manual_refill_template_root';
  runId: string;
  isolationKey: string;
  targetSheetKeys: string[];
  rangeStartMessageIndex: number;
  rangeEndMessageIndex: number;
  templateFingerprint: string;
  createdAt: number;
}

/**
 * SPv7.9 duplicate-row-id 过渡根。它存放在 isolation tag 的私有字段，
 * 旧版只读取 storageFrame，因此不会把该根误当成普通 V2 checkpoint。
 */
export interface Spv79TransitionCheckpointV1_ACU {
  version: 1;
  kind: 'spv79_duplicate_row_id_transition';
  createdAt: number;
  data: TableDataObject_ACU;
  /** 该快照已经吸收的最后一个旧历史 operation。 */
  cutoff: {
    messageIndex: number;
    seq: number;
    operationIndex: number;
  };
  scheduleSummary?: Record<string, TableCheckpointScheduleSummaryV2_ACU>;
}

/**
 * 通用兼容过渡根：严格回放失败、Tier-1 宽容回放成功后，把兼容结果固化为
 * 新的回放基座（下次加载走严格快路径）。是 spv79TransitionCheckpoint 的
 * 泛化：不限于 duplicate_row_id，覆盖 spv7.9 语义全集（乱序 seq、legacy
 * meta_update ddl、未知 operation kind、宽松 row_upsert、旧 DSL 行号、
 * 两代 sheetKey 身份归并）。
 */
export interface CompatTransitionCheckpointV1_ACU {
  version: 1;
  kind: 'compat_replay_transition';
  createdAt: number;
  data: TableDataObject_ACU;
  /** 该快照已经吸收的最后一个旧历史 operation。 */
  cutoff: {
    messageIndex: number;
    seq: number;
    operationIndex: number;
  };
  scheduleSummary?: Record<string, TableCheckpointScheduleSummaryV2_ACU>;
  /** 固化时命中的容忍项摘要（provenance，用于日志与事故复盘）。 */
  tolerances: string[];
}

export interface TableCheckpointV2_ACU {
  kind: 'full';
  createdAt: number;
  reason: 'init' | 'periodic' | 'manual' | 'schema_change' | 'compaction' | 'import' | 'migration' | 'integrity_repair';
  data: TableDataObject_ACU;
  /** compaction 的触发计数，用于避免缓冲阈值满足后每层重复滚动。 */
  compactionProvenance?: {
    version: 1;
    triggeredAtAiCount: number;
    retainCount: number;
    bufferLayers: number;
  };
  scheduleSummary?: Record<string, TableCheckpointScheduleSummaryV2_ACU>;
  event?: TableMutationEventV2_ACU;
  manualRefillProgress?: ManualRefillProgressV2_ACU;
  migrationProvenance?: TableMigrationProvenanceV1_ACU;
  fallbackProvenance?: ManualRefillTemplateRootProvenanceV1_ACU;
}

/** 同一 V2 frame 内的单表恢复基底；不承担 mate 或其他根级元数据。 */
export interface TableSheetIntroductionTimelineV2_ACU {
  kind: 'sheet_introduction';
  /** introduction shard 所在的 AI message index。 */
  activateAtMessageIndex: number;
  /** 同一 frame 中在该 seq 之后才将新表加入 replay state。 */
  afterSeq: number;
}

/**
 * 既有表在数据边界（最新 AI 楼层）上的结构 rebase 基底：模板切换产生的新列/列定义变化/
 * 隐藏列保留，统一表达为该楼层的 per-sheet full checkpoint，在 afterSeq 之后整表替换 replay state。
 * 与 introduction 的区别仅在写入守卫方向（表必须已存在），回放调度语义完全一致。
 */
export interface TableSheetRebaseTimelineV2_ACU {
  kind: 'sheet_rebase';
  /** rebase shard 所在的 AI message index。 */
  activateAtMessageIndex: number;
  /** 同一 frame 中在该 seq 之后才用 checkpoint.data 整表替换 replay state。 */
  afterSeq: number;
}

/**
 * 表级恢复（reveal）基底：将被隐藏（active state 已无）的表重新显示。
 * 回放语义与 rebase 完全一致（afterSeq 之后用 checkpoint.data 整表替换 replay state），
 * 区别仅在写入守卫方向：该表必须“历史存在但 active 不存在”。checkpoint.data 为离开时的最新状态。
 */
export interface TableSheetRevealTimelineV2_ACU {
  kind: 'sheet_reveal';
  /** reveal shard 所在的 AI message index。 */
  activateAtMessageIndex: number;
  /** 同一 frame 中在该 seq 之后才用 checkpoint.data 整表恢复 replay state。 */
  afterSeq: number;
}

/**
 * 表级隐藏（hide）标记：将一个当前可见的表从 active replay state 移除可见性，但数据完整保留。
 * 回放时在 afterSeq 之后从 state 删除该 sheetKey；数据仍存于此 checkpoint.data 供后续 reveal 恢复。
 */
export interface TableSheetHideTimelineV2_ACU {
  kind: 'sheet_hide';
  /** hide shard 所在的 AI message index。 */
  activateAtMessageIndex: number;
  /** 同一 frame 中在该 seq 之后才从 replay state 移除该表。 */
  afterSeq: number;
}

export interface TableSheetCheckpointV2_ACU {
  kind: 'sheet_full';
  createdAt: number;
  reason: TableCheckpointV2_ACU['reason'];
  sheetKey: string;
  data: Sheet_ACU;
  scheduleSummary?: TableCheckpointScheduleSummaryV2_ACU;
  event?: TableMutationEventV2_ACU;
  manualRefillProgress?: ManualRefillProgressV2_ACU;
  baseRevision?: string | null;
  /**
   * 休眠溯源（S3-4）：仅 timeline.kind === 'sheet_hide' 的 checkpoint 可携带，
   * 记录休眠前活跃的模板预设名。展示性可选字段，回放与校验不依赖它。
   */
  hideSourcePresetName?: string;
  timeline?: TableSheetIntroductionTimelineV2_ACU | TableSheetRebaseTimelineV2_ACU | TableSheetRevealTimelineV2_ACU | TableSheetHideTimelineV2_ACU;
}

export type TableMutationOperationV2_ACU =
  | TableSqlBatchOperationV2_ACU
  | TableSqlSheetBatchOperationV2_ACU
  | TableEditDslOperationV2_ACU
  | TableRowUpsertPatchV2_ACU
  | TableRowDeletePatchV2_ACU
  | TableMetaPatchV2_ACU
  | TableSheetSchemaMigrateOperation_ACU
  | TableSheetReplaceOperationV2_ACU
  | TableDataReplaceOperationV2_ACU;

export type TableSqlBindValueV2_ACU = string | number | null;

/** 旧整批 SQL 结构：用于历史兼容和 raw/cross-table SQL；新填表写入应优先使用 sql_sheet_batch。 */
export interface TableSqlBatchOperationV2_ACU {
  kind: 'sql_batch';
  statements: string[];
  /** 与 statements 同索引的参数绑定；无参数语句可省略对应项或传空数组。 */
  params?: TableSqlBindValueV2_ACU[][];
}

/** 新单表 SQL 结构：保留 SQL replay 语义，同时提供可按 sheetKey 清理的结构化归属。 */
export interface TableSqlSheetBatchOperationV2_ACU {
  kind: 'sql_sheet_batch';
  sheetKey: string;
  statements: string[];
  /** 与 statements 同索引的参数绑定；无参数语句可省略对应项或传空数组。 */
  params?: TableSqlBindValueV2_ACU[][];
  tableName?: string;
  reason?: 'manual_crud' | 'import' | 'system';
}

export interface TableEditDslOperationV2_ACU {
  kind: 'table_edit_dsl';
  text: string;
  updateMode?: string;
}

export interface TableSheetReplaceOperationV2_ACU {
  kind: 'sheet_replace';
  sheetKey: string;
  sheet: Sheet_ACU;
  reason: 'manual_crud' | 'import' | 'system';
}

export interface TableDataReplaceOperationV2_ACU {
  kind: 'data_replace';
  data: TableDataObject_ACU;
  reason: 'checkpoint_fallback' | 'manual_crud' | 'import' | 'system';
}

// 旧 patch 结构仅用于兼容历史 V2 数据；新 V2 日志不再写 patches。
export type TablePatchV2_ACU =
  | TableRowUpsertPatchV2_ACU
  | TableRowDeletePatchV2_ACU
  | TableSheetReplacePatchV2_ACU
  | TableMetaPatchV2_ACU;

export interface TableRowUpsertPatchV2_ACU {
  kind: 'row_upsert';
  sheetKey: string;
  rowId: string;
  cells: (string | null)[];
}

export interface TableRowDeletePatchV2_ACU {
  kind: 'row_delete';
  sheetKey: string;
  rowId: string;
}

export interface TableSheetReplacePatchV2_ACU {
  kind: 'sheet_replace';
  sheetKey: string;
  sheet: Sheet_ACU;
  reason: 'schema_change' | 'unstable_row_id' | 'raw_sql_export' | 'import' | 'fallback';
}

export interface TableMetaPatchV2_ACU {
  kind: 'meta_update';
  sheetKey: string;
  /** 仅限非结构元数据；content、uid 与 sourceData.ddl 不得通过此 operation 修改。 */
  meta: Partial<Pick<Sheet_ACU, 'name' | 'orderNo' | 'updateConfig' | 'exportConfig'>>
    & { sourceData?: Partial<Omit<Sheet_ACU['sourceData'], 'ddl'>> };
}

export type TableSchemaColumnChangeV2_ACU =
  | { kind: 'rename_display'; physicalName: string; fromHeader: string; toHeader: string }
  | { kind: 'add'; physicalName: string; header: string; index: number }
  | { kind: 'drop'; physicalName: string; header: string; index: number };

/**
 * V1 reader contract uses the normalized original column definition as its
 * semantic boundary. P2 may decompose definitions for conversion, but V1
 * must reject any definition change rather than pretend to understand it.
 */
export interface TableSchemaColumnDescriptorV2_ACU {
  index: number;
  physicalName: string;
  displayHeader: string;
  normalizedDefinition: string;
}

export interface TableSheetSchemaDescriptorV2_ACU {
  descriptorVersion: 1;
  uid: string;
  tableName: string;
  headers: (string | null)[];
  ddl: string;
  normalizedSql: string;
  columns: TableSchemaColumnDescriptorV2_ACU[];
  tableConstraints: string[];
  tableSuffix: string;
}

/** P2 descriptor is deliberately separate from descriptorVersion: 1 because
 * both descriptor bodies are hashed as persisted replay contracts. */
export interface TableSchemaColumnDescriptorV2Contract_ACU {
  index: number;
  physicalName: string;
  displayHeader: string;
  normalizedDefinition: string;
  defaultExpression: string | null;
}

export interface TableSheetSchemaDescriptorV2Contract_ACU {
  descriptorVersion: 2;
  uid: string;
  tableName: string;
  headers: (string | null)[];
  ddl: string;
  normalizedSql: string;
  columns: TableSchemaColumnDescriptorV2Contract_ACU[];
  tableConstraints: string[];
  tableSuffix: string;
}

export type TableSchemaDefaultLiteralV2_ACU =
  | { kind: 'null'; sql: 'NULL'; value: null }
  | { kind: 'integer'; sql: string; value: number }
  | { kind: 'real'; sql: string; value: number }
  | { kind: 'string'; sql: string; value: string }
  | { kind: 'blob'; sql: string; value: string }
  | { kind: 'boolean'; sql: 'TRUE' | 'FALSE'; value: boolean };

export type TableSchemaFillStrategyV2_ACU =
  | { kind: 'literal'; literal: TableSchemaDefaultLiteralV2_ACU }
  | { kind: 'ddl_literal_default'; literal: TableSchemaDefaultLiteralV2_ACU };

export interface TableSchemaPhysicalColumnMappingV2_ACU {
  fromPhysicalName: string;
  toPhysicalName: string;
}

/** Deliberately finite: persisted migrations must never execute arbitrary code. */
export type TableSchemaConversionPolicyV2_ACU =
  | { kind: 'identity' }
  | { kind: 'stringify' }
  | { kind: 'integer_strict' }
  | { kind: 'real_strict' };

export interface TableSchemaColumnConversionV2_ACU {
  fromPhysicalName: string;
  toPhysicalName: string;
  policy: TableSchemaConversionPolicyV2_ACU;
}

export interface TableSchemaDryRunSummaryV2_ACU {
  convertedRowCount: number;
  failedRowCount: number;
  lossyRowCount: number;
}

export interface TableSchemaMigrationPolicyV2Contract_ACU {
  destructiveChangeConfirmed: boolean;
  lossyConversionConfirmed: boolean;
}

export interface TableSchemaMigrationPolicyV2_ACU {
  /** V1 中 drop 是唯一允许的破坏性变更，且必须显式确认。 */
  destructiveChangeConfirmed: boolean;
}

export interface TableSheetSchemaMigrateOperationV1_ACU {
  kind: 'sheet_schema_migrate';
  contractVersion: 1;
  sheetKey: string;
  beforeSchemaDigest: string;
  targetSchemaDigest: string;
  beforeSchema: TableSheetSchemaDescriptorV2_ACU;
  targetSchema: TableSheetSchemaDescriptorV2_ACU;
  columnChanges: TableSchemaColumnChangeV2_ACU[];
  migrationPolicy: TableSchemaMigrationPolicyV2_ACU;
}

export interface TableSheetSchemaMigrateOperationV2Contract_ACU {
  kind: 'sheet_schema_migrate';
  contractVersion: 2;
  sheetKey: string;
  beforeSchemaDigest: string;
  targetSchemaDigest: string;
  beforeSchema: TableSheetSchemaDescriptorV2Contract_ACU;
  targetSchema: TableSheetSchemaDescriptorV2Contract_ACU;
  physicalColumnMappings: TableSchemaPhysicalColumnMappingV2_ACU[];
  fills: Record<string, TableSchemaFillStrategyV2_ACU>;
  conversions: TableSchemaColumnConversionV2_ACU[];
  dryRun: TableSchemaDryRunSummaryV2_ACU;
  migrationPolicy: TableSchemaMigrationPolicyV2Contract_ACU;
}

/** Historical exported name is retained for the contractVersion: 1 reader. */
export type TableSheetSchemaMigrateOperationV2_ACU = TableSheetSchemaMigrateOperationV1_ACU;

export type TableSheetSchemaMigrateOperation_ACU =
  | TableSheetSchemaMigrateOperationV1_ACU
  | TableSheetSchemaMigrateOperationV2Contract_ACU;

export type TableWriteConflictUnitV2_ACU =
  | { kind: 'sheet'; sheetKey: string }
  | { kind: 'row'; sheetKey: string; rowId: string }
  | { kind: 'cell'; sheetKey: string; rowId: string; columnKey: string }
  | { kind: 'schema'; sheetKey: string }
  | { kind: 'all' };

export type TableMutationWriteSetV2_ACU = TableWriteConflictUnitV2_ACU[];

export interface TableMutationLogEntryV2_ACU extends TableMutationEventV2_ACU {
  seq: number;
  entryId: string;
  createdAt: number;
  source: TableMutationSourceV2_ACU;
  targetMessageIndex: number;
  aiFloor: number;
  operations: TableMutationOperationV2_ACU[];
  /** 兼容旧 V2 derived patch log；新写入不再使用。 */
  patches?: TablePatchV2_ACU[];
  baseRevision?: string | null;
  parentRevision?: string | null;
  commitRevision?: string;
  writeSet?: TableMutationWriteSetV2_ACU;
}

/**
 * Legacy-V1 自动迁移时保留的审计证据与原始业务数据。
 * 它不参与 V2 replay；用途是让无损修复后的 migration 仍可导出原始输入并复核 repair plan。
 */
export interface TableMigrationAuditBackupV1_ACU {
  version: 1;
  createdAt: number;
  sourceData: unknown;
  dataFingerprintBefore: string;
  dataFingerprintAfter: string;
  auditStatus: 'clean' | 'repairable';
  issues: unknown[];
  repairPlan: unknown[];
  idRemap: unknown[];
  /** Mixed 升级收敛时被新 migration checkpoint 取代的旧 V2 帧；仅用于恢复与审计。 */
  supersededV2Frames?: Array<{
    messageIndex: number;
    isolationKey: string;
    /** 畸形 frame 无法满足 V2 结构契约，按 unknown 原样保存以保证可回退。 */
    storageFrame: TableStorageFrameV2_ACU | unknown;
    /** 该槽携带 V2 历史证据但结构非法。 */
    malformed?: boolean;
    /** 移除前的 _acu_storage_version 原值。 */
    storageVersionMarker?: unknown;
  }>;
}

/** 显式恢复在覆盖目标 V2 frame 前保留的原始持久化证据。 */
export interface TableV2RecoveryBackup_ACU {
  version: 1;
  createdAt: number;
  recoveryKind: 'repaired_full_checkpoint' | 'confirmed_orphan_data_replace' | 'temporary_template_baseline_upgrade' | 'temporary_sheet_anchor_convergence' | 'relocated_checkpoint_discarded_prefix' | 'manual_catch_up_provisional_bridge' | 'redundant_full_checkpoint_convergence' | 'demoted_template_only_root' | 'restored_from_recovery_backup' | 'compat_tolerant_replay_fixation';
  sourceMessageIndex: number | null;
  failedMessageIndex?: number;
  failedSeq?: number;
  failure?: string;
  storageFrame: TableStorageFrameV2_ACU;
  /** 将错误落在较晚楼层的 full checkpoint 前移时，被 replay 忽略的前缀证据。 */
  discardedPrefixFrames?: Array<{
    messageIndex: number;
    storageFrame: TableStorageFrameV2_ACU;
  }>;
}

/** 混合 legacy/V2 决议提交前保留的 legacy 输入与决议证据，不参与 replay。 */
export interface MixedStorageDecisionBackupV1_ACU {
  version: 1;
  createdAt: number;
  action: 'keep_v2' | 'commit_merge_candidate';
  legacyData: unknown;
  legacyFingerprint: string | null;
  v2Fingerprint: string | null;
  sourceMessageIndices: number[];
  sourceAiFloors: number[];
  decisionId: string;
  decisionKind: string;
}

export interface TableStorageFrameV2_ACU {
  version: 2;
  headRevision?: string | null;
  checkpoint?: TableCheckpointV2_ACU;
  perSheetCheckpoints?: Record<string, TableSheetCheckpointV2_ACU>;
  manualRefillProgress?: ManualRefillProgressV2_ACU;
  logEntries: TableMutationLogEntryV2_ACU[];
}

/**
 * 表级可见性生命周期状态。
 *
 * 唯一持久化历史权威是 per-sheet timeline（sheet_introduction / sheet_rebase /
 * sheet_reveal / sheet_hide）；本类型是只读派生结果，不落盘、不构成第二事实源。
 *
 * - active：当前可见，可进入 prompt / 填表 / SQL / 写集。
 * - hidden：曾被 hide 移出 active 投影，数据仍留存于 checkpoint.data，可恢复。
 * - never_seen：历史无目标相关证据，只允许作为 introduction 引入。
 * - indeterminate：目标归属或顺序无法判定，必须 fail-closed。
 */
export type TableSheetLifecycleStatusV2_ACU =
  | 'active'
  | 'hidden'
  | 'never_seen'
  | 'indeterminate';

export interface TableSheetLifecycleEntryV2_ACU {
  /** 状态：active / hidden / never_seen / indeterminate。 */
  status: TableSheetLifecycleStatusV2_ACU;
  /** 最后一条可验证的可见性 timeline 事件 kind。 */
  lastTimelineKind?: 'sheet_introduction' | 'sheet_rebase' | 'sheet_reveal' | 'sheet_hide';
  /** 最后一条可见性 timeline 事件所在楼层。 */
  lastTimelineMessageIndex?: number;
  /** 最后一条可见性 timeline 事件的 afterSeq（frame 内排序）。 */
  lastTimelineAfterSeq?: number;
  /**
   * 最后一条 hide timeline checkpoint 的 createdAt（毫秒时间戳；S3-4 休眠时间展示）。
   * 仅 hide 归并时从 checkpoint.createdAt 附带；历史 checkpoint 缺失时不填充。
   */
  lastTimelineCreatedAt?: number;
  /**
   * 休眠前活跃的模板预设名（S3-4 来源模板展示）。仅 hide 归并时从 hide checkpoint 的
   * 可选 hideSourcePresetName 字段附带；该字段自 S3-4 起由提交层前向记录，历史数据无此信息。
   */
  hideSourcePresetName?: string;
  /** 最近一次可见（introduction / rebase / reveal）后、hide 前的可信数据快照；仅 hidden 时存在。 */
  restoreSourceData?: Sheet_ACU;
}

/** 只读生命周期派生结果：同一历史输入只产生一份确定结论。 */
export interface TableSheetLifecycleProjectionV2_ACU {
  statusBySheetKey: Record<string, TableSheetLifecycleEntryV2_ACU>;
  /** 当前 active 的 sheetKey 集合。 */
  activeSheetKeys: string[];
  /** 当前 hidden 的 sheetKey 集合。 */
  hiddenSheetKeys: string[];
  /** 目标归属或顺序无法判定的 sheetKey 集合（fail-closed）。 */
  indeterminateSheetKeys: string[];
  /** 历史无目标相关证据的 sheetKey 集合（仅允许 introduction 引入）。 */
  neverSeenSheetKeys: string[];
}
