/**
 * data/sqlite/sync-bridge.ts — SQLite ↔ ChatMessage 双向同步桥
 *
 * 加载方向：ChatMessage → mergeAll → JSON → SQLite
 * 保存方向：SQLite → JSON → saveIndependentTable → ChatMessage
 *
 * 关键设计：复用现有的 mergeAllIndependentTables_ACU 和
 *          saveIndependentTableToChatHistory_ACU，不重新实现持久化逻辑
 */

import { SqliteEngine } from './sqlite-engine';
import { buildRuntimeFallbackDDL_ACU, createSheetInsertPlan, generateInserts, resultToContent, parseDDLTableName, parseDDLColumnNames, buildColumnNameMap, resolveEffectiveDDL } from './schema-mapper';
import type { TableDataObject_ACU, Sheet_ACU, Mate_ACU } from '../../shared/models/table-data';
import { hashUserInput_ACU, logDebug_ACU, logError_ACU, logWarn_ACU } from '../../shared/utils';
import { formatCanonicalRowIssues_ACU, normalizeCanonicalTableRows_ACU, repairLegacyAutoMergedRowTails_ACU, repairLegacyOrphanIdentityColumn_ACU } from '../../shared/canonical-row-normalizer';
import { validateCanonicalCheckpointSheet_ACU } from '../../shared/canonical-checkpoint-validator';
import { resolvePhysicalTableNames_ACU } from '../../shared/sheet-identity';
import { downgradeRowIdPrimaryKeyForLegacyReplay_ACU } from '../../shared/ddl-utils';
import { isSqlActiveTemplateSheet_ACU } from '../../shared/sql-active-template';

/** 同步桥的元数据表名（内部使用，对用户和 AI 不可见） */
const META_TABLE_NAME = '_acu_sheet_meta';

/** 元数据表的建表 DDL */
const META_TABLE_DDL = `CREATE TABLE IF NOT EXISTS ${META_TABLE_NAME} (
  sheet_key TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  name TEXT NOT NULL,
  order_no INTEGER DEFAULT 0,
  source_data_json TEXT,
  update_config_json TEXT,
  export_config_json TEXT,
  physical_table_name TEXT
);`;

/** meta 表历史版本没有 physical_table_name 列；老库加载时补列，失败降级不阻断。 */
const META_TABLE_MIGRATIONS_ACU: ReadonlyArray<{ column: string; ddl: string }> = [
  { column: 'physical_table_name', ddl: `ALTER TABLE ${META_TABLE_NAME} ADD COLUMN physical_table_name TEXT;` },
];

export interface RuntimeDdlFallbackDiagnostic_ACU {
  sheetKey: string;
  reason: 'fallback_missing' | 'fallback_invalid';
  failureSummary?: string;
  originalDdlDigest: string;
  effectiveTableName: string;
  phase: 'initial_load' | 'runtime_ddl_retry';
}

export interface RuntimeEffectiveSchema_ACU {
  effectiveDDL: string;
  columnMap: ReturnType<typeof resolveEffectiveDDL>['columnMap'];
  source: ReturnType<typeof resolveEffectiveDDL>['source'];
  diagnostics: readonly string[];
  originalDdlDigest: string;
}

export class SyncBridge {
  private readonly runtimeFallbackDiagnostics = new Map<string, RuntimeDdlFallbackDiagnostic_ACU>();
  private readonly runtimeEffectiveSchemas = new Map<string, RuntimeEffectiveSchema_ACU>();

  constructor(private engine: SqliteEngine) {}

  /** 返回 SyncBridge 实际执行到 runtime SQLite 的 schema 快照（窄读取接口）。 */
  getRuntimeEffectiveSchemas_ACU(): ReadonlyMap<string, RuntimeEffectiveSchema_ACU> {
    return new Map(this.runtimeEffectiveSchemas);
  }

  getRuntimeFallbackDiagnostics_ACU(): readonly RuntimeDdlFallbackDiagnostic_ACU[] {
    return Array.from(this.runtimeFallbackDiagnostics.values());
  }

  /** 老库补齐 meta 新列。ALTER 幂等：已存在的列会报错，捕获后忽略；缺列才补。 */
  private _ensureMetaSchema(): void {
    let existingColumns: Set<string>;
    try {
      existingColumns = new Set(this.engine.getTableInfo(META_TABLE_NAME).map(col => col.name));
    } catch (e: any) {
      logWarn_ACU(`[SyncBridge] 读取 meta 表结构失败，跳过迁移: ${e?.message || e}`);
      return;
    }
    for (const migration of META_TABLE_MIGRATIONS_ACU) {
      if (existingColumns.has(migration.column)) continue;
      try {
        this.engine.run(migration.ddl);
      } catch (e: any) {
        // 补列失败不阻断加载：多路识别会降级为“新算法 + DDL 别名”。
        logWarn_ACU(`[SyncBridge] meta 迁移失败（${migration.column}），降级识别: ${e?.message || e}`);
      }
    }
  }

  /**
   * 从 TableDataObject 加载到 SQLite
   * 1. 创建元数据表
   * 2. 遍历每张 sheet：建表 + 灌数据 + 写元数据
   *
   * @param data 完整的表格数据对象（通常来自 mergeAllIndependentTables_ACU 的结果）
   */
  loadFromTableData(data: TableDataObject_ACU, options: {
    strict?: boolean;
    allowRuntimeDdlFallback?: boolean;
  } = {}): void {
    this._loadFromTableData(data, options, false);
  }

  /**
   * SPv7.9 迁移专用入口。它不是普通 runtime 的可选模式：调用者只能明确选择
   * 这条受限历史 hydrate 路径，导出后必须立即由迁移器统一重编号。
   */
  loadSpv79LegacyDuplicateRowIdHistory(data: TableDataObject_ACU): void {
    this._loadFromTableData(data, { strict: true }, true);
  }

  private _loadFromTableData(
    data: TableDataObject_ACU,
    options: { strict?: boolean; allowRuntimeDdlFallback?: boolean },
    legacyDuplicateRowIds: boolean,
  ): void {
    if (!data || typeof data !== 'object') return;
    if (!this.engine.isReady) {
      throw new Error('SyncBridge: SqliteEngine 未初始化');
    }

    // strict hydrate 必须在副本上校验，失败时不得清洗或改写调用方快照。
    const workingData = options.strict ? JSON.parse(JSON.stringify(data)) as TableDataObject_ACU : data;
    // 仅兼容历史版本错误追加的精确尾标记，其他宽度异常仍由后续 strict 校验拒绝。
    repairLegacyAutoMergedRowTails_ACU(workingData);
    // 孤儿身份列错位（表头 ["row_id", 空占位, …]）与 auto_merged 同点复位：
    // hydrate 前归位列对齐，防止空标签列进入物理表结构。歧义表按原样进入
    // 后续 strict 校验，由校验决定接受或拒绝。
    const orphanRepair = repairLegacyOrphanIdentityColumn_ACU(workingData);
    if (orphanRepair.changedSheetKeys.length > 0) {
      logWarn_ACU(`[SyncBridge] 已复位孤儿身份列错位：${orphanRepair.changedSheetKeys.join('、')}`);
    }
    orphanRepair.warnings.forEach(warning => logWarn_ACU(warning));
    if (!legacyDuplicateRowIds) {
      const normalization = normalizeCanonicalTableRows_ACU(workingData);
      const canonicalIssues = [...normalization.errors, ...normalization.removedRows];
      if (canonicalIssues.length > 0) {
        const message = `[SyncBridge] snapshot 行标识不合法：${formatCanonicalRowIssues_ACU(canonicalIssues)}`;
        if (options.strict) {
          throw new Error(message);
        }
        logWarn_ACU(message);
      }
    }
    if (options.strict && !legacyDuplicateRowIds) {
      const canonicalIssues = Object.entries(workingData)
        .filter(([sheetKey, sheet]) => sheetKey.startsWith('sheet_') && Array.isArray((sheet as any)?.content))
        .flatMap(([sheetKey, sheet]) => validateCanonicalCheckpointSheet_ACU(sheet, sheetKey, 'data').issues);
      if (canonicalIssues.length > 0) {
        throw new Error(`[SyncBridge] snapshot 结构不合法：${canonicalIssues.map(issue => `${issue.type}: ${issue.sheetKey || 'unknown'}${issue.rowIndex === undefined ? '' : ` 第 ${issue.rowIndex} 行`}`).join('；')}`);
      }
    }
    this.engine.run(META_TABLE_DDL);
    this._ensureMetaSchema();

    // 遍历所有 sheet。非首列空业务表头的模板表是 SQL 活动路径中的休眠表：
    // 不建表、不灌数据（既有物理表与历史数据保留，修正表头后由模板恢复参与），
    // 避免坏表头在 resolveEffectiveDDL 触发 fallback DDL 错误导致整个 hydrate 失败。
    const sheetKeys = Object.keys(workingData).filter(k => k.startsWith('sheet_'));
    const physicalTableNames = resolvePhysicalTableNames_ACU(workingData);
    logDebug_ACU(`[SyncBridge] 开始加载 ${sheetKeys.length} 张表到 SQLite`);
    for (const key of sheetKeys) {
      const sheet = workingData[key] as Sheet_ACU;
      if (!sheet || !Array.isArray(sheet.content)) continue;
      if (!isSqlActiveTemplateSheet_ACU(sheet)) {
        logDebug_ACU(`[SyncBridge] 跳过休眠表 ${key} (${sheet.name})：非首列空业务表头，SQL 活动路径中视为不存在。`);
        continue;
      }

      try {
        this._loadSheet(
          key,
          sheet,
          options.allowRuntimeDdlFallback === true,
          physicalTableNames.get(key),
          legacyDuplicateRowIds,
        );
      } catch (e: any) {
        const errorMessage = e?.message || String(e);
        const message = `[SyncBridge] 加载表 ${key} (${sheet.name}) 失败: ${formatSqliteLoadFailure_ACU(errorMessage)}`;
        logError_ACU(message);
        if (options.strict) {
          throw new Error(message);
        }
      }
    }
  }

  /**
   * 从 SQLite 导出为 TableDataObject
   * SELECT * FROM 每张用户表 → 还原为 content 二维数组
   * 元数据从 _acu_sheet_meta 表读取
   *
   * @param originalMate 原始的 mate 对象（SQLite 不存储 mate，需要外部传入）
   * @returns 完整的 TableDataObject
   */
  exportToTableData(
    originalMate: Mate_ACU,
    options: {
      strict?: boolean;
    } = {},
  ): TableDataObject_ACU {
    return this._exportToTableData(originalMate, options, false);
  }

  /** 与 loadSpv79LegacyDuplicateRowIdHistory 成对使用的迁移专用导出入口。 */
  exportSpv79LegacyDuplicateRowIdHistory(originalMate: Mate_ACU): TableDataObject_ACU {
    return this._exportToTableData(originalMate, { strict: true }, true);
  }

  private _exportToTableData(
    originalMate: Mate_ACU,
    options: { strict?: boolean },
    legacyDuplicateRowIds: boolean,
  ): TableDataObject_ACU {
    if (!this.engine.isReady) {
      throw new Error('SyncBridge: SqliteEngine 未初始化');
    }

    const result: TableDataObject_ACU = { mate: originalMate };

    // 读取元数据
    const metaMap = this._loadAllMeta(options.strict === true);

    // 遍历所有用户表
    const tableNames = this.engine.getTableNames();
    logDebug_ACU(`[SyncBridge] 开始导出 ${tableNames.length} 张表从 SQLite`);
    for (const tableName of tableNames) {
      // 查找对应的元数据
      const meta = this._findMetaByTableName(metaMap, tableName);
      if (!meta) {
        if (options.strict) throw new Error(`[SyncBridge] 用户表 ${tableName} 缺少可识别的元数据。`);
        continue;
      }

      try {
        const sheet = this._exportSheet(tableName, meta);
        result[meta.sheetKey] = sheet;
      } catch (e: any) {
        if (options.strict) {
          throw new Error(`[SyncBridge] 导出表 ${tableName} 失败: ${e?.message || String(e)}`);
        }
        logError_ACU(`[SyncBridge] 导出表 ${tableName} 失败:`, e?.message || e);
      }
    }

    if (!legacyDuplicateRowIds) {
      const normalization = normalizeCanonicalTableRows_ACU(result);
      const canonicalIssues = [...normalization.errors, ...normalization.removedRows];
      if (canonicalIssues.length > 0) {
        const message = `[SyncBridge] 导出结果存在行标识问题：${formatCanonicalRowIssues_ACU(canonicalIssues)}`;
        if (options.strict) throw new Error(message);
        logWarn_ACU(message);
      }
    }
    return result;
  }

  /**
   * 仅同步 SQLite → JSON（不写聊天消息）
   * 用于 AI 编辑后立即更新内存视图，但延迟持久化
   *
   * @param originalData 原始的 TableDataObject（提供 mate 和未变更的 sheet 信息）
   * @returns 更新后的 TableDataObject
   */
  syncToJson(originalData: TableDataObject_ACU): TableDataObject_ACU {
    return this.exportToTableData(originalData.mate as Mate_ACU);
  }

  // ═══════════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════════

  /** 加载单张 sheet 到 SQLite */
  private _loadSheet(
    sheetKey: string,
    sheet: Sheet_ACU,
    allowRuntimeDdlFallback: boolean,
    runtimeTableName?: string,
    legacyDuplicateRowIds = false,
  ): void {
    const resolvedDDL = resolveEffectiveDDL(sheet, sheet.uid || sheetKey, runtimeTableName);
    if (resolvedDDL.source === 'fallback_invalid' && !allowRuntimeDdlFallback) {
      throw new Error(resolvedDDL.diagnostics[0]);
    }

    const metaSql = `INSERT OR REPLACE INTO ${META_TABLE_NAME} (sheet_key, uid, name, order_no, source_data_json, update_config_json, export_config_json, physical_table_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`;
    const executeResolvedDDL = (candidate: typeof resolvedDDL) => {
      // SQLite 的 row_id PRIMARY KEY 无法表示历史重复身份。SPv7.9 迁移只在内存中
      // 暂时移除这一唯一约束，让旧 SQL 仍按旧 row_id 值作用；导出后立即统一重编号。
      const effectiveDDL = legacyDuplicateRowIds
        ? downgradeRowIdPrimaryKeyForLegacyReplay_ACU(candidate.effectiveDDL)
        : candidate.effectiveDDL;
      const tableName = parseDDLTableName(effectiveDDL);
      if (!tableName) throw new Error(`无法从 DDL 中解析表名: ${effectiveDDL.substring(0, 100)}`);

      // 映射或行数据错误必须在执行 DDL 前失败，绝不能被 runtime schema fallback 掩盖。
      const plan = createSheetInsertPlan(sheet, candidate.columnMap);
      const inserts = generateInserts(sheet, tableName, plan);
      this.engine.runBatch(
        [effectiveDDL, ...inserts, metaSql],
        [
          undefined,
          ...new Array<undefined>(inserts.length).fill(undefined),
          [
            sheetKey,
            sheet.uid || sheetKey,
            sheet.name || sheetKey,
            sheet.orderNo ?? 0,
            JSON.stringify(sheet.sourceData || {}),
            JSON.stringify(sheet.updateConfig || {}),
            JSON.stringify(sheet.exportConfig || {}),
            tableName,
          ],
        ],
      );
    };

    if (resolvedDDL.source !== 'explicit') {
      this._recordRuntimeFallbackDiagnostic(sheetKey, resolvedDDL, 'initial_load');
    }

    try {
      executeResolvedDDL(resolvedDDL);
      this._recordRuntimeEffectiveSchema(sheetKey, resolvedDDL);
    } catch (error: any) {
      // runBatch 已保证失败事务回滚。仅首条 CREATE TABLE 执行失败才允许一次 runtime fallback；
      // INSERT/约束/映射错误必须原样 fail closed，防止用全 TEXT 表偷偷吞掉数据完整性问题。
      if (resolvedDDL.source !== 'explicit' || !allowRuntimeDdlFallback || !/^第 1 条语句失败:/.test(error?.message || '')) throw error;
      const fallback = buildRuntimeFallbackDDL_ACU(sheet, runtimeTableName || sheet.uid || sheetKey, 'fallback_invalid', '显式 DDL 无法在 runtime SQLite 执行，已使用 fallback schema。');
      this._recordRuntimeFallbackDiagnostic(sheetKey, fallback, 'runtime_ddl_retry', error?.message || String(error));
      executeResolvedDDL(fallback);
      this._recordRuntimeEffectiveSchema(sheetKey, fallback);
    }
  }

  private _recordRuntimeEffectiveSchema(sheetKey: string, resolvedDDL: ReturnType<typeof resolveEffectiveDDL>): void {
    this.runtimeEffectiveSchemas.set(sheetKey, {
      effectiveDDL: resolvedDDL.effectiveDDL,
      columnMap: resolvedDDL.columnMap,
      source: resolvedDDL.source,
      diagnostics: resolvedDDL.diagnostics,
      originalDdlDigest: hashUserInput_ACU(resolvedDDL.originalDDL),
    });
  }

  private _recordRuntimeFallbackDiagnostic(
    sheetKey: string,
    resolvedDDL: ReturnType<typeof resolveEffectiveDDL>,
    phase: RuntimeDdlFallbackDiagnostic_ACU['phase'],
    failureSummary?: string,
  ): void {
    if (this.runtimeFallbackDiagnostics.has(sheetKey)) return;
    const effectiveTableName = parseDDLTableName(resolvedDDL.effectiveDDL) || 'unknown_table';
    const diagnostic: RuntimeDdlFallbackDiagnostic_ACU = {
      sheetKey,
      reason: resolvedDDL.source === 'fallback_missing' ? 'fallback_missing' : 'fallback_invalid',
      originalDdlDigest: hashUserInput_ACU(resolvedDDL.originalDDL),
      effectiveTableName,
      phase,
      failureSummary: failureSummary?.slice(0, 240),
    };
    this.runtimeFallbackDiagnostics.set(sheetKey, diagnostic);
    logWarn_ACU(`[SyncBridge][runtime-ddl-fallback] ${JSON.stringify(diagnostic)} ${resolvedDDL.diagnostics[0]}`);
  }

  /** 从 SQLite 导出单张表为 Sheet_ACU */
  private _exportSheet(tableName: string, meta: SheetMeta): Sheet_ACU {
    // 查询所有数据
    const queryResult = this.engine.query(`SELECT * FROM ${tableName};`);

    // 导出必须以实际创建到 runtime SQLite 的 schema 为准；meta.sourceData.ddl
    // 可能是保留给用户修复的非法原文，不能再拿它反向解释已 fallback 的物理列。
    const ddl = this.engine.getTableDDL(tableName) || '';
    const { sqlToChinese } = buildColumnNameMap(ddl);

    // 转换为 content。
    // sql.js 对空表 SELECT * 可能返回空结果集且不带 columns；此时必须从 DDL 恢复列名，
    // 否则空表会被导出成只有 ['row_id'] 的坏表头，污染后续 checkpoint/可视化编辑器。
    const columns = queryResult.columns.length > 0 ? queryResult.columns : parseDDLColumnNames(ddl);
    const content = resultToContent(columns, queryResult.values, sqlToChinese);

    const sheet: Sheet_ACU & { _acu_runtimeEffectiveSchema?: RuntimeEffectiveSchema_ACU } = {
      uid: meta.uid,
      name: meta.name,
      sourceData: meta.sourceData,
      content,
      updateConfig: meta.updateConfig,
      exportConfig: meta.exportConfig,
      orderNo: meta.orderNo,
    };
    const runtimeSchema = this.runtimeEffectiveSchemas.get(meta.sheetKey);
    if (runtimeSchema) {
      Object.defineProperty(sheet, '_acu_runtimeEffectiveSchema', {
        value: runtimeSchema,
        enumerable: false,
      });
    }
    return sheet;
  }

  /** 读取所有元数据 */
  private _loadAllMeta(strict = false): Map<string, SheetMeta> {
    const map = new Map<string, SheetMeta>();
    try {
      const result = this.engine.query(`SELECT * FROM ${META_TABLE_NAME};`);
      // 按列名取值，避免新增列后位置漂移读错字段。
      const col = new Map(result.columns.map((name, index) => [name, index]));
      const at = (row: SqlJsValueType[], name: string): SqlJsValueType =>
        col.has(name) ? row[col.get(name)!] : null;
      for (const row of result.values) {
        const sheetKey = String(at(row, 'sheet_key'));
        const storedPhysical = at(row, 'physical_table_name');
        map.set(sheetKey, {
          sheetKey,
          uid: String(at(row, 'uid')),
          name: String(at(row, 'name')),
          orderNo: Number(at(row, 'order_no')) || 0,
          sourceData: safeJsonParse(at(row, 'source_data_json')),
          updateConfig: safeJsonParse(at(row, 'update_config_json')),
          exportConfig: safeJsonParse(at(row, 'export_config_json')),
          physicalTableName: storedPhysical != null && String(storedPhysical).trim()
            ? String(storedPhysical)
            : undefined,
        });
      }
    } catch (error) {
      if (strict) throw error;
      // 元数据表不存在时返回空 map
    }
    return map;
  }

  /**
   * 通过 SQLite 实际表名反查元数据（“多方位识别”健全性读取）。
   * 依次尝试三条识别路径，任一唯一命中即认，兼容不同历史命名的存量库：
   *   1. meta 存储的 physical_table_name（历史真实建表名，最高优先）
   *   2. 当前算法 resolvePhysicalTableNames_ACU 的结果（新库主路径）
   *   3. 用户 DDL 内的 CREATE TABLE 名（旧命名别名；多表复用同名时不猜）
   * 命中后把实际表名回填 meta.physicalTableName，供导出与后续识别对齐。
   */
  private _findMetaByTableName(metaMap: Map<string, SheetMeta>, tableName: string): SheetMeta | null {
    // 路径 1：meta 存储的物理名。
    for (const meta of metaMap.values()) {
      if (meta.physicalTableName && meta.physicalTableName === tableName) return meta;
    }

    // 路径 2：当前算法重算。拼音冲突会抛错，此处降级为不命中，交由其它路径兜底。
    try {
      const metadataData: TableDataObject_ACU = { mate: {} as Mate_ACU };
      for (const [sheetKey, meta] of metaMap) {
        metadataData[sheetKey] = {
          uid: meta.uid,
          name: meta.name,
          sourceData: meta.sourceData || {},
          content: [],
          updateConfig: meta.updateConfig || {},
          exportConfig: meta.exportConfig || {},
          orderNo: meta.orderNo,
        } as Sheet_ACU;
      }
      const physicalTableNames = resolvePhysicalTableNames_ACU(metadataData);
      for (const [sheetKey, meta] of metaMap) {
        if (physicalTableNames.get(sheetKey) === tableName) {
          meta.physicalTableName = tableName;
          return meta;
        }
      }
    } catch (e: any) {
      logWarn_ACU(`[SyncBridge] 物理名重算命中冲突，降级 DDL 别名识别: ${e?.message || e}`);
    }

    // 路径 3：DDL 内旧表名作为别名；唯一命中才认，多表复用同名时拒绝猜测。
    const ddlAliasMatches: SheetMeta[] = [];
    for (const meta of metaMap.values()) {
      const ddlName = parseDDLTableName(String(meta.sourceData?.ddl || ''));
      if (ddlName && ddlName === tableName) ddlAliasMatches.push(meta);
    }
    if (ddlAliasMatches.length === 1) {
      ddlAliasMatches[0].physicalTableName = tableName;
      return ddlAliasMatches[0];
    }
    return null;
  }
}

/** 元数据结构 */
interface SheetMeta {
  sheetKey: string;
  uid: string;
  name: string;
  orderNo: number;
  sourceData: any;
  updateConfig: any;
  exportConfig: any;
  /** meta 表存储的历史物理表名（多路识别路径 1）；老库或未回填时为 undefined。 */
  physicalTableName?: string;
}

/**
 * 保留批量写入的可行动诊断，但绝不把 INSERT 的 VALUES（用户业务数据）传播到日志或 UI。
 */
function formatSqliteLoadFailure_ACU(errorMessage: string): string {
  const batchFailure = /^第 (\d+) 条语句失败:\s*([\s\S]*?)\s*→\s*([\s\S]+)$/.exec(errorMessage);
  if (!batchFailure) return errorMessage;

  const [, statementIndex, statement, sqliteError] = batchFailure;
  const operation = /^(INSERT\s+INTO|CREATE\s+TABLE|UPDATE|DELETE\s+FROM)\s+([a-zA-Z_][a-zA-Z0-9_]*)\b/i.exec(statement.trim());
  const statementSummary = operation
    ? `${operation[1].replace(/\s+/g, ' ').toUpperCase()} ${operation[2]}`
    : 'SQLite 语句';
  return `SQLite 写入失败：第 ${statementIndex} 条语句失败（${statementSummary}）：${sqliteError.trim()}`;
}

/** 安全的 JSON 解析 */
function safeJsonParse(val: SqlJsValueType): any {
  if (val === null || val === undefined) return {};
  try {
    return JSON.parse(String(val));
  } catch (_) {
    return {};
  }
}
