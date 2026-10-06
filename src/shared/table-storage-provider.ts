/**
 * shared/table-storage-provider.ts — 统一的表格存储提供者接口
 *
 * 定义 ITableStorageProvider 接口，原生模式和 SQLite 模式各自实现。
 * 上层代码通过策略选择器获取 Provider，不直接依赖具体实现。
 */

import type { TableDataObject_ACU } from './models/table-data';

/** 存储模式 */
export type StorageMode = 'native' | 'sqlite';

/** SQL 查询结果（SELECT） */
export interface SqlQueryResult {
  /** 列名数组 */
  columns: string[];
  /** 结果行（每行是一个值数组） */
  values: (string | number | Uint8Array | null)[][];
  /** 结果行数 */
  rowCount: number;
}

/** SQL 查询执行选项 */
export interface SqlQueryExecutionOptions_ACU {
  suppressErrorLog?: boolean;
}

/** SQL 变更结果（INSERT/UPDATE/DELETE） */
export interface SqlMutationResult {
  /** 受影响的行数 */
  changes: number;
  /** 错误信息列表（如果有） */
  errors: string[];
}

/** AI 编辑应用结果 */
export interface ApplyEditsResult {
  /** 是否成功 */
  success: boolean;
  /** 受影响的 sheetKey 列表 */
  modifiedKeys: string[];
  /** 成功应用的编辑数量 */
  appliedEdits: number;
  /** 错误信息（失败时） */
  error?: string;
}

/** SQLite 原子行身份分配与批量执行结果。 */
export interface ApplyEditsWithRowIdMaterializationResult_ACU extends ApplyEditsResult {
  /** 与输入 editsList 一一对应的、实际执行并用于 V2 记录的 SQL。 */
  materializedSqlTexts: string[];
  /** 执行完成后从 SQLite 严格导出的真实运行时数据。 */
  tableData: TableDataObject_ACU;
}

/** AI 请求发起前捕获的 SQLite 模板上下文。提交阶段不得重新读取当前聊天模板。 */
export interface SqlTableApplyScope_ACU {
  readonly isolationKey: string;
  /** 去除模板数据行后的建表/别名权威快照。 */
  readonly templateData: TableDataObject_ACU;
  /** 保留作者数据行的模板快照，仅供首次建表补种。 */
  readonly templateDataWithRows: TableDataObject_ACU;
  /**
   * 请求级 SQL 活动表集合（非首列空业务表头已剔除）。缺省时调用方必须
   * 回退到 templateData 的全部 sheet_* 键（兼容旧调用方）。
   */
  readonly activeSheetKeys?: readonly string[];
  /**
   * 因非首列空业务表头而在 SQL 活动路径中休眠跳过的模板表诊断。
   * 只包含 sheetKey / 显示名 / 空列序号，不包含数据行、DDL 或聊天正文。
   */
  readonly skippedSheets?: ReadonlyArray<{
    sheetKey: string;
    name: string;
    emptyHeaderIndexes: readonly number[];
  }>;
  /**
   * 请求前从 live SQLite provider 冻结的 runtime schema 证据（请求级，不持久化）。
   *
   * 它是 AI Prompt、提交前表/列重绑、未知 INSERT 列 gate 与 applyEditsWithSystemRowIds()
   * 共同消费的 schema 权威；baseSnapshot（历史 replay/merge）只保留数据/CAS/操作基底，
   * 不得再充当 live 列 schema registry。
   *
   * 设计约束（与计划阶段 B/C 对齐）：
   * - 只保留窄 schema 视图（物理表名 / effectiveDDL / columnMap / descriptor 源 / digest），
   *   不复制业务行；
   * - 不进入 JSON stringify / frame / chat / checkpoint；
   * - 仅在单次 AI 请求生命周期内使用。
   */
  readonly runtimeSchema?: RuntimeSchemaFreeze_ACU;
  /**
   * 请求前冻结的完整 live SQLite 导出数据（仅供 Prompt 行数据与单请求内消费；
   * 保留 non-enumerable `_acu_runtimeEffectiveSchema`，绝不 JSON 序列化）。
   */
  readonly runtimeData?: TableDataObject_ACU;
  /**
   * 请求前冻结 runtime schema 失败的结构化标记（provider 未 ready / 导出失败 /
   * schema 解析失败）。消费方必须先检查并 fail-closed：不进入 UNIFIED_GROUP_ERROR_FEEDBACK、
   * 不触发第二次模型调用、不等待 5 秒重试。
   */
  readonly runtimeSchemaFailure?: { code: 'SQL_RUNTIME_SCHEMA_INVALID_ACU' | 'provider_unavailable'; message: string };
}

/**
 * 请求前冻结 runtime schema 失败的结构化标记（provider 未 ready / 导出失败 / schema 解析失败）。
 *
 * 语义：属于本地前置条件/infrastructure 失败，模型无法通过重试修复。消费方必须在
 * 使用 scope 前检查该字段并 fail-closed：不进入 UNIFIED_GROUP_ERROR_FEEDBACK、
 * 不触发第二次模型调用、不等待 5 秒重试。
 */
export interface SqlTableApplyScopeRuntimeSchemaFailure_ACU {
  code: 'SQL_RUNTIME_SCHEMA_INVALID_ACU' | 'provider_unavailable';
  message: string;
}

/**
 * 请求级 SQLite runtime schema 冻结视图（窄 schema，不携带业务行）。
 *
 * digest 由 stable 排序的 effectiveDDL + columnMap 计算，用于提交前一致性 gate。
 * descriptor 源来自 SyncBridge 导出的 non-enumerable `_acu_runtimeEffectiveSchema`，
 * 以值拷贝保留在快照内（该字段本身只含 schema 证据，无业务行）。
 */
export interface RuntimeSchemaFreeze_ACU {
  /** 按 sheetKey 排序的冻结 schema 表集合。 */
  readonly bySheetKey: ReadonlyMap<string, FrozenSheetRuntimeSchema_ACU>;
  /** 参与冻结的表集合（sheetKey 排序）。 */
  readonly sheetKeys: readonly string[];
  /** 稳定 schema digest：effectiveDDL + columnMap 排序后计算。 */
  readonly digest: string;
}

export interface FrozenSheetRuntimeSchema_ACU {
  readonly sheetKey: string;
  readonly physicalTableName: string;
  readonly effectiveDDL: string;
  /** 与 SyncBridge descriptor 一致的列映射（列名权威）。 */
  readonly columnMap: unknown;
  /** descriptor 来源：explicit（作者 DDL）/ fallback_missing / fallback_invalid。 */
  readonly source: string;
  readonly diagnostics: readonly string[];
}

/**
 * 统一的表格存储提供者接口
 *
 * 原生模式（NativeTableServiceAdapter）和 SQLite 模式（SqlTableService）
 * 各自实现此接口。上层代码通过 getStorageProvider() 获取当前 Provider，
 * 不需要知道底层是 JSON 操作还是 SQL 操作。
 */
export interface ITableStorageProvider {
  /** 模式标识 */
  readonly mode: StorageMode;

  /**
   * 从聊天消息加载表格数据到运行时
   * - native：调用 loadOrCreateJsonTableFromChatHistory_ACU
   * - sqlite：mergeAll → loadFromTableData → 建表灌数据
   *
   * 返回契约（loaded 表示数据存在性，不等价于 Provider readiness）：
   * - `loaded: true`：已载入真实数据或 seed rows；
   * - `loaded: false, source: 'empty', error: undefined`：正常空状态，
   *   Provider 仍可通过 `isReady()` 正常 ready；
   * - `error` 存在：加载失败；不得仅凭 `source` 或 `loaded` 猜测成功，
   *   是否可发布还必须通过 `isReady()` 后置条件确认。
   */
  loadFromChat(): Promise<{
    loaded: boolean;
    source: 'merged' | 'initialized' | 'empty';
    error?: string;
  }>;

  /**
   * 从调用方已恢复的当前聊天快照初始化运行时。
   *
   * SQLite 实现用它避免重复回放/迁移同一聊天；native 无需实现，
   * 因为它直接使用全局 JSON 运行时视图。
   *
   * 返回契约与 loadFromChat 一致：`loaded: false, source: 'empty'` 且无
   * `error` 是正常空 schema（empty-schema mapper 已发布、引擎已就绪），
   * 不是失败；只有 `error` 存在才表示加载失败。
   */
  loadFromData?(data: TableDataObject_ACU | null): Promise<{
    loaded: boolean;
    source: 'merged' | 'initialized' | 'empty';
    error?: string;
  }>;

  /** 当前运行时是否已经可用（Provider readiness 契约）。native 恒为 true；sqlite 需引擎已初始化且映射已发布。 */
  isReady(): boolean;

  /**
   * 保存当前运行时数据到聊天消息
   * - native：调用 saveIndependentTableToChatHistory_ACU
   * - sqlite：exportToTableData → 更新 JSON 视图 → saveIndependentTable
   */
  saveToChat(
    targetSheetKeys?: string[] | null,
    updateGroupKeys?: string[] | null,
    trackingSheetKeys?: string[] | null,
    options?: { source?: string; requestId?: string; batchId?: string; operations?: unknown[]; transactionContext?: unknown },
  ): Promise<{ saved: boolean; messageIndex?: number; error?: string }>;

  /**
   * 获取当前运行时的完整表格数据（JSON 格式）
   * 两种模式都返回 TableDataObject_ACU，保证上层代码零改动
   */
  getCurrentData(): TableDataObject_ACU | null;
  /** 严格导出；失败抛错，不返回旧运行时视图。 */
  getCurrentDataStrict_ACU?(): TableDataObject_ACU;


  /**
   * 在公共提交模型内替换完整运行时数据。
   * 注意：只负责运行时更新，不负责持久化聊天记录。
   */
  replaceAllData?(data: TableDataObject_ACU): Promise<ApplyEditsResult> | ApplyEditsResult;

  /**
   * 应用 AI 返回的编辑指令
   * - native：解析 DSL（insertRow/updateRow/deleteRow）
   * - sqlite：执行 SQL 语句（事务包裹，失败回滚）
   *
   * @param edits AI 返回的编辑内容（DSL 或 SQL）
   * @param updateMode 更新模式（standard/summary/unified）
   * @returns 应用结果
   */
  applyEdits(edits: string, updateMode?: string): ApplyEditsResult;

  /**
   * 批量应用多段 AI SQL/编辑内容。
   * sqlite 模式必须把所有 SQL 放进同一个运行时事务；native 可不实现。
   */
  applyEditsBatch?(editsList: string[], updateMode?: string, paramsList?: (string | number | null)[][]): ApplyEditsResult;

  /**
   * 在 provider 内原子完成模板建表、空表补种、系统 row_id 分配和批量执行。
   * 仅 SQLite provider 实现；调用方不得在 provider 外预分配 row_id。
   */
  applyEditsWithSystemRowIds?(
    editsList: string[],
    updateMode?: string,
    scope?: SqlTableApplyScope_ACU,
  ): ApplyEditsWithRowIdMaterializationResult_ACU;

  /** 创建运行时快照，用于提交失败或重试前回滚。sqlite 返回二进制 DB 快照；native 可不实现。 */
  createRuntimeSnapshot?(): unknown;

  /** 恢复 createRuntimeSnapshot 创建的运行时快照。 */
  restoreRuntimeSnapshot?(snapshot: unknown): Promise<void>;

  /**
   * 按给定 canonical 快照刷新本 provider 发布的中英文名映射。
   * 供 provider 常规 hydrate 之外的入口（回滚、外部 CRUD）在活跃 runtime 上同步映射，
   * 使映射的所有权、内容与 schema 始终来自同一次合法发布。native 可不实现。
   *
   * @returns 是否已发布可信映射。
   */
  refreshNameMapperForData_ACU?(data: TableDataObject_ACU): boolean;

  /**
   * 精确清空运行时表格状态，不读取聊天记录也不创建模板数据。
   * 失败补偿依赖此方法恢复“旧运行时为空”的状态，因此所有 provider 必须实现。
   */
  clearRuntimeData(): void;

  /**
   * 执行 SQL 查询（仅 sqlite 模式支持）
   * native 模式调用时抛出 Error
   */
  executeQuery(
    sql: string,
    params?: (string | number | null)[],
    options?: SqlQueryExecutionOptions_ACU,
  ): SqlQueryResult;

  /**
   * 执行 SQL 变更语句（仅 sqlite 模式支持）
   * native 模式调用时抛出 Error
   */
  executeMutation(sql: string, params?: (string | number | null)[]): SqlMutationResult;

  /**
   * 销毁/清理资源
   * - native：无操作
   * - sqlite：关闭数据库实例
   */
  dispose(): void;
}
