/**
 * data/models/chat-message-data.ts — 消息级表格数据结构定义
 *
 * 定义聊天消息上挂载的 TavernDB_ACU_* 字段的 TypeScript 接口。
 * 这些类型描述了每条消息上存储的表格数据结构。
 */

import type { Sheet_ACU } from '../../shared/models/table-data';
import type { CompatTransitionCheckpointV1_ACU, MixedStorageDecisionBackupV1_ACU, Spv79TransitionCheckpointV1_ACU, TableMigrationAuditBackupV1_ACU, TableStorageFrameV2_ACU, TableV2RecoveryBackup_ACU } from '../../service/table/storage-frame-v2-types';
import type {
    ChatSummaryVectorIndexManifest_ACU,
    ChatSummaryVectorIndexState_ACU,
} from '../../service/vector/summary-vector-index-types';

// ── 新版按标签分组存储 ──

/** 单个隔离标签下的数据槽 */
export interface IsolationTagData_ACU {
    independentData: Record<string, Sheet_ACU>;
    modifiedKeys: string[];
    updateGroupKeys: string[];
    /** V2 checkpoint/log 存储帧。删除单表时必须按 sheetKey 精确清理，不能按楼层误删。 */
    storageFrame?: TableStorageFrameV2_ACU;
    /** 显式 V2 恢复替换当前 frame 前保留的原始帧，用于导出与事故复盘。 */
    recoveryBackup?: TableV2RecoveryBackup_ACU;
    /** Legacy-V1 自动迁移的审计与原始输入备份，不参与 V2 replay。 */
    migrationAuditBackup?: TableMigrationAuditBackupV1_ACU;
    /** Mixed legacy/V2 自动决议提交前保留的输入与证据，不参与 V2 replay。 */
    mixedStorageDecisionBackup?: MixedStorageDecisionBackupV1_ACU;
    /** SPv7.9 duplicate row_id 的新版私有过渡回放根。 */
    spv79TransitionCheckpoint?: Spv79TransitionCheckpointV1_ACU;
    /** 通用兼容过渡回放根（spv7.9 语义全集的固化结果）。与 spv79 槽共存时取 cutoff 更新者。 */
    compatTransitionCheckpoint?: CompatTransitionCheckpointV1_ACU;
    /** 旧版/兼容向量记忆状态。镜像协议不再写入，仅作 legacy 检测。 */
    vectorMemoryState?: any;
    /** 旧版聚合索引状态。镜像协议不再写入，仅作 legacy 检测。 */
    summaryVectorIndexState?: ChatSummaryVectorIndexState_ACU | null;
    /** 旧版外置 manifest。镜像协议不再写入，仅作 legacy 检测。 */
    summaryVectorIndexManifest?: ChatSummaryVectorIndexManifest_ACU | null;
    /** 基底状态标记（首楼初始化时写入） */
    _acu_base_state?: string;
    /** 增量数据：本楼层对各表的行级变更。仅 delta 楼层存在。 */
    incrementalData?: Record<string, TableIncrementalUpdate_ACU>;
    /** 存储模式标记 */
    _acu_storage_mode?: TableStorageMode_ACU;
    /** 存储格式版本号（便于后续升级） */
    _acu_storage_version?: number;
}

// ── 增量存储类型 ──

/** 存储模式枚举 */
export type TableStorageMode_ACU = 'checkpoint' | 'delta' | 'legacy';

/** 单行变更操作 */
export interface TableRowDelta_ACU {
    /** 行标识（取自 content[i][0]） */
    row_id: string;
    /** 操作类型：upsert=新增或更新整行，delete=删除该行 */
    op: 'upsert' | 'delete';
    /** upsert 时的完整行数据（含 row_id 列）；delete 时为 undefined */
    cells?: (string | null)[];
}

/** 单张表的增量更新描述 */
export interface TableIncrementalUpdate_ACU {
    /** 目标表 uid（与 Sheet_ACU.uid 对应） */
    sheetUid: string;
    /** 行级变更列表 */
    rowDeltas: TableRowDelta_ACU[];
    /** 元数据变更（name/orderNo/updateConfig/exportConfig/sourceData 任一变化时记录） */
    metaChanged?: Partial<Pick<Sheet_ACU, 'name' | 'orderNo' | 'updateConfig' | 'exportConfig' | 'sourceData'>>;
    /** 列结构是否发生变化（true 时该表应退化为 checkpoint） */
    structureChanged?: boolean;
}

export type {
    ChatSummaryVectorIndexChunk_ACU,
    ChatSummaryVectorIndexManifest_ACU,
    ChatSummaryVectorIndexRow_ACU,
    ChatSummaryVectorIndexState_ACU,
} from '../../service/vector/summary-vector-index-types';

/** 按标签分组的容器（TavernDB_ACU_IsolatedData 的类型） */
export interface IsolatedDataContainer_ACU {
    [isolationKey: string]: IsolationTagData_ACU;
}

// ── 旧版兼容格式 ──

/** 旧版标准表/摘要表容器（TavernDB_ACU_Data / TavernDB_ACU_SummaryData 的类型） */
export interface LegacyTableContainer_ACU {
    mate?: { type: string; version: number };
    [sheetKey: string]: Sheet_ACU | { type: string; version: number } | undefined;
}

// ── 消息上所有 TavernDB_ACU_* 字段的完整类型 ──

/** 消息对象上所有 TavernDB_ACU_* 字段的类型描述 */
export interface MessageTableFields_ACU {
    /** 新版按标签分组的表格数据（可能是 object 或 JSON 字符串） */
    TavernDB_ACU_IsolatedData?: IsolatedDataContainer_ACU | string;
    /** 旧版独立表格数据 */
    TavernDB_ACU_IndependentData?: Record<string, Sheet_ACU>;
    /** 旧版标准表数据 */
    TavernDB_ACU_Data?: LegacyTableContainer_ACU;
    /** 旧版摘要/大纲表数据 */
    TavernDB_ACU_SummaryData?: LegacyTableContainer_ACU;
    /** 隔离标识代码 */
    TavernDB_ACU_Identity?: string;
    /** 本次修改的表格键列表 */
    TavernDB_ACU_ModifiedKeys?: string[];
    /** 本次更新组的表格键列表 */
    TavernDB_ACU_UpdateGroupKeys?: string[];
    /** 首楼模板基底状态标记（幂等用） */
    _acu_local_template_base_state_seeded?: string;
}

// ── 隔离配置（作为参数传入 repository，不引用 service 层） ──

/**
 * 隔离配置，由 service 层从 settings_ACU 中提取后传入。
 *
 * 标签隔离已退役（见 shared/isolation-policy.ts）。enabled=false 时槽位键是 ''，
 * 调用方必须把空串当默认槽，不能当缺失键。
 */
export interface IsolationConfig_ACU {
    /** 是否启用数据隔离（已退役；仅兼容存量标识码） */
    enabled: boolean;
    /** 隔离标识代码（未启用时为空串，仍是合法槽位键） */
    code: string;
}
