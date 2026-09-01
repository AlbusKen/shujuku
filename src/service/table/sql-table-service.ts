/**
 * service/table/sql-table-service.ts — SQLite 模式的 ITableStorageProvider 实现
 *
 * 核心职责：
 * - 管理 SqliteEngine 和 SyncBridge 的生命周期
 * - 将 AI 返回的 SQL 语句路由到引擎执行
 * - 维护 currentJsonTableData_ACU 的同步
 * - 提供 SQL 查询和变更的入口
 */

import type {
  ITableStorageProvider,
  SqlTableApplyScope_ACU,
  RuntimeSchemaFreeze_ACU,
  FrozenSheetRuntimeSchema_ACU,
  SqlQueryResult,
  SqlMutationResult,
  ApplyEditsWithRowIdMaterializationResult_ACU,
  ApplyEditsResult,
  SqlQueryExecutionOptions_ACU,
} from '../../shared/table-storage-provider';
import type { TableDataObject_ACU, Mate_ACU } from '../../shared/models/table-data';
import type { TableMutationOperationV2_ACU, TableSqlBindValueV2_ACU } from './storage-frame-v2-types';
import { SqliteEngine } from '../../data/sqlite/sqlite-engine';
import { SyncBridge } from '../../data/sqlite/sync-bridge';
import {
  currentJsonTableData_ACU,
  _set_currentJsonTableData_ACU,
} from '../runtime/state-manager';
import { mergeAllIndependentTables_ACU } from '../runtime/helpers-data-merge';
import { hashUserInput_ACU, logDebug_ACU, logError_ACU, logWarn_ACU, parseTableTemplateJson_ACU, stripSeedRowsFromTemplate_ACU } from '../../shared/utils';
import {
  createNameMapperOwnerToken_ACU,
  publishGlobalNameMapperEmptySchema_ACU,
  publishGlobalNameMapperForDDLs_ACU,
  releaseGlobalNameMapperForOwner_ACU,
  type NameMapperOwnerToken_ACU,
} from '../runtime/template-vars/name-mapper';
import { parseDDLTableName, generateDDL, generateInserts, resolveEffectiveDDL } from '../../data/sqlite/schema-mapper';
import { normalizeSqlStructure, normalizeStatementValues } from '../../data/sqlite/sql-normalizer';
import { ensureStableRowIdsForSheetContent_ACU, getEffectiveSeedRowsForSheet_ACU, getCurrentChatTemplateScopeState_ACU, sanitizeTemplateSnapshotForChat_ACU, shouldUseInitialSeedRows_ACU } from '../template/chat-scope';
import { isSqlActiveTemplateSheet_ACU, projectSqlActiveTemplateData_ACU } from '../../shared/sql-active-template';
import { getTemplatePreset_ACU } from '../template/template-preset-service';
import { safeJsonParse_ACU } from '../../shared/json-helpers';
import { assertNoPhysicalTableNameCollision_ACU, getPhysicalTableNameForSheet_ACU, PhysicalTableNameCollisionError_ACU, resolvePhysicalTableNames_ACU } from '../../shared/sheet-identity';
import { buildColumnNameMap, getRuntimeEffectiveSchema_ACU, getSheetColumnProjection_ACU, parseDDLColumnInfos_ACU } from '../../shared/ddl-utils';
import { rebindSqlMutationTableReferences_ACU, rebindSqlMutationColumnsByTarget_ACU, decodeSqlIdentifier_ACU } from '../../shared/sql-mutation-table-rebind';
import { buildSheetTableAliasMap_ACU, buildSheetColumnAliasMap_ACU } from '../../shared/sql-read-resolver';
import { allocateStableRowId_ACU, createStableRowIdReservation_ACU } from '../../shared/stable-row-id-allocator';
import { extractBusinessKeyColumns_ACU } from '../template/template-data-preflight';
import { getTableLockIdentitiesForSheet_ACU } from '../runtime/helpers-table-lock';
import { buildLockRevertPlanForSheet_ACU, formatLockRevertSummary_ACU, type LockRevertItem_ACU } from './table-lock-enforcement';

export interface SnapshotSqlApplyResult_ACU extends ApplyEditsResult {
  workingData?: TableDataObject_ACU;
  changes?: number;
  operations?: TableMutationOperationV2_ACU[];
  /** SQL 模式锁定保护回滚的目标清单（空数组/缺省 = 无回滚）。 */
  revertedByLocks?: LockRevertItem_ACU[];
}

export interface SqlSheetBatchBuildResult_ACU {
  operations: TableMutationOperationV2_ACU[];
  classifiedSheetKeys: string[];
  unknownStatements: string[];
  ambiguousStatements: string[];
}

export interface SqlSheetBatchBuildOptions_ACU {
  params?: TableSqlBindValueV2_ACU[][];
  fallbackTargetSheetKeys?: string[];
  allowSingleTargetFallback?: boolean;
  keepLegacyForUnclassified?: boolean;
  reason?: 'manual_crud' | 'import' | 'system';
}

export interface SnapshotSqlOperationOptions_ACU {
  targetSheetKeys?: string[];
  requireSheetScopedOperations?: boolean;
  allowSingleTargetFallback?: boolean;
  keepLegacyForUnclassified?: boolean;
}

const DEFAULT_MATE_ACU: Mate_ACU = {
  type: 'acu',
  version: 1,
  updateConfigUiSentinel: 0,
  globalInjectionConfig: {
    readableEntryPlacement: { position: '', depth: 0, order: 0 },
    wrapperPlacement: { position: '', depth: 0, order: 0 },
  },
};

function resolveSnapshotMate_ACU(tableData: TableDataObject_ACU): Mate_ACU {
  const mate = tableData?.mate;
  if (mate && typeof mate === 'object') {
    return mate as Mate_ACU;
  }
  return JSON.parse(JSON.stringify(DEFAULT_MATE_ACU));
}

export function normalizeSqlStatementsForRuntimeLog_ACU(sqlStatements: string): string[] {
  const cleaned = String(sqlStatements || '').replace(/<!--|-->/g, '').trim();
  if (!cleaned) return [];
  return splitSqlStatements(cleaned)
    .map(stmt => normalizeStatementValues(normalizeSqlStructure(stmt)))
    .filter(Boolean);
}

interface SqlMutationIdentifierToken_ACU {
  start: number;
  end: number;
  value: string;
  quote: '"' | '`' | '[' | null;
  depth: number;
  commaBefore: boolean;
}

function isSqlMutationIdentifierStart_ACU(char: string): boolean {
  return /^[A-Za-z_\u0080-\uFFFF]$/.test(char);
}

function isSqlMutationIdentifierPart_ACU(char: string): boolean {
  if (char.length !== 1) return false;
  const code = char.charCodeAt(0);
  return isSqlMutationIdentifierStart_ACU(char) || char === '$' || (code >= 48 && code <= 57);
}

/** Tokenizes identifiers while deliberately skipping SQL strings and comments. */
function tokenizeSqlMutationIdentifiers_ACU(statement: string): SqlMutationIdentifierToken_ACU[] {
  const tokens: SqlMutationIdentifierToken_ACU[] = [];
  let index = 0;
  let depth = 0;
  const commaBeforeDepths = new Set<number>();
  while (index < statement.length) {
    const char = statement[index];
    const next = statement[index + 1];
    if (char === '-' && next === '-') {
      index += 2;
      while (index < statement.length && statement[index] !== '\n' && statement[index] !== '\r') index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < statement.length && !(statement[index] === '*' && statement[index + 1] === '/')) index += 1;
      if (index >= statement.length) throw new Error('SQL 块注释未闭合，无法安全重绑定表名。');
      index += 2;
      continue;
    }
    if (char === "'") {
      index += 1;
      while (index < statement.length) {
        if (statement[index] !== "'") {
          index += 1;
        } else if (statement[index + 1] === "'") {
          index += 2;
        } else {
          index += 1;
          break;
        }
      }
      if (index > statement.length || statement[index - 1] !== "'") throw new Error('SQL 字符串未闭合，无法安全重绑定表名。');
      continue;
    }
    if (char === ',') {
      commaBeforeDepths.add(depth);
      index += 1;
      continue;
    }
    if (char === '(') {
      commaBeforeDepths.delete(depth);
      depth += 1;
      index += 1;
      continue;
    }
    if (char === ')') {
      depth = Math.max(0, depth - 1);
      index += 1;
      continue;
    }
    if (char === '"' || char === '`' || char === '[') {
      const closing = char === '[' ? ']' : char;
      const start = index;
      let value = '';
      index += 1;
      let closed = false;
      while (index < statement.length) {
        if (statement[index] !== closing) {
          value += statement[index++];
        } else if (statement[index + 1] === closing) {
          value += closing;
          index += 2;
        } else {
          index += 1;
          closed = true;
          break;
        }
      }
      if (!closed) throw new Error('SQL 引号标识符未闭合，无法安全重绑定表名。');
      tokens.push({ start, end: index, value, quote: char, depth, commaBefore: commaBeforeDepths.delete(depth) });
      continue;
    }
    if (isSqlMutationIdentifierStart_ACU(char)) {
      const start = index;
      index += 1;
      while (index < statement.length && isSqlMutationIdentifierPart_ACU(statement[index])) index += 1;
      tokens.push({ start, end: index, value: statement.slice(start, index), quote: null, depth, commaBefore: commaBeforeDepths.delete(depth) });
      continue;
    }
    index += 1;
  }
  return tokens;
}

function isSqlMutationKeyword_ACU(token: SqlMutationIdentifierToken_ACU | undefined, keyword: string): boolean {
  return !!token && token.quote === null && token.value.toUpperCase() === keyword;
}

function getSqlMutationActionIndex_ACU(tokens: SqlMutationIdentifierToken_ACU[]): number {
  const first = tokens[0];
  if (!first) throw new Error('SQL 语句为空或缺少可验证的写入动作。');
  if (!isSqlMutationKeyword_ACU(first, 'WITH')) return 0;
  const actionIndex = tokens.findIndex((token, index) => index > 0 && token.depth === 0 && (
    isSqlMutationKeyword_ACU(token, 'INSERT')
    || isSqlMutationKeyword_ACU(token, 'REPLACE')
    || isSqlMutationKeyword_ACU(token, 'UPDATE')
    || isSqlMutationKeyword_ACU(token, 'DELETE')
  ));
  if (actionIndex < 0) throw new Error('WITH SQL 缺少可验证的写入语句。');
  return actionIndex;
}

function getQualifiedSqlIdentifierTail_ACU(
  statement: string,
  tokens: SqlMutationIdentifierToken_ACU[],
  startIndex: number,
): SqlMutationIdentifierToken_ACU | undefined {
  let token = tokens[startIndex];
  if (!token) return undefined;
  let index = startIndex;
  while (tokens[index + 1]
    && tokens[index + 1].depth === token.depth
    && /^\s*\.\s*$/.test(statement.slice(token.end, tokens[index + 1].start))) {
    index += 1;
    token = tokens[index];
  }
  return token;
}

function getSqlMutationTargetToken_ACU(statement: string, tokens: SqlMutationIdentifierToken_ACU[]): SqlMutationIdentifierToken_ACU {
  const actionIndex = getSqlMutationActionIndex_ACU(tokens);
  const action = tokens[actionIndex];
  if (isSqlMutationKeyword_ACU(action, 'INSERT') || isSqlMutationKeyword_ACU(action, 'REPLACE')) {
    let index = actionIndex + 1;
    if (isSqlMutationKeyword_ACU(action, 'INSERT') && isSqlMutationKeyword_ACU(tokens[index], 'OR')) {
      const action = tokens[index + 1];
      if (!action || action.quote !== null || !new Set(['ROLLBACK', 'ABORT', 'REPLACE', 'FAIL', 'IGNORE']).has(action.value.toUpperCase())) {
        throw new Error('INSERT OR 子句非法，无法安全重绑定表名。');
      }
      index += 2;
    }
    const target = getQualifiedSqlIdentifierTail_ACU(statement, tokens, index + 1);
    if (!isSqlMutationKeyword_ACU(tokens[index], 'INTO') || !target) {
      throw new Error('INSERT/REPLACE SQL 缺少可验证的目标表。');
    }
    return target;
  }
  if (isSqlMutationKeyword_ACU(action, 'UPDATE')) {
    let index = actionIndex + 1;
    if (isSqlMutationKeyword_ACU(tokens[index], 'OR')) {
      const action = tokens[index + 1];
      if (!action || action.quote !== null || !new Set(['ROLLBACK', 'ABORT', 'REPLACE', 'FAIL', 'IGNORE']).has(action.value.toUpperCase())) {
        throw new Error('UPDATE OR 子句非法，无法安全重绑定表名。');
      }
      index += 2;
    }
    const target = getQualifiedSqlIdentifierTail_ACU(statement, tokens, index);
    if (!target) throw new Error('UPDATE SQL 缺少可验证的目标表。');
    return target;
  }
  if (isSqlMutationKeyword_ACU(action, 'DELETE')) {
    const target = getQualifiedSqlIdentifierTail_ACU(statement, tokens, actionIndex + 2);
    if (!isSqlMutationKeyword_ACU(tokens[actionIndex + 1], 'FROM') || !target) throw new Error('DELETE SQL 缺少可验证的目标表。');
    return target;
  }
  throw new Error(`SQLite 填表仅允许 INSERT、REPLACE、UPDATE、DELETE 数据变更语句，收到：${action?.value || 'empty'}。禁止输出 CREATE、ALTER、DROP、事务或查询语句。`);
}

function collectSqlMutationTableReferenceTokens_ACU(
  statement: string,
  tokens: SqlMutationIdentifierToken_ACU[],
  mutationTarget: SqlMutationIdentifierToken_ACU,
): SqlMutationIdentifierToken_ACU[] {
  const fromClauseTerminators = new Set([
    'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'UNION', 'EXCEPT', 'INTERSECT', 'WINDOW', 'RETURNING', 'VALUES', 'SET',
  ]);
  const references = new Map<number, SqlMutationIdentifierToken_ACU>([[mutationTarget.start, mutationTarget]]);
  const cteNames = new Set<string>();
  for (let index = 0; index + 2 < tokens.length; index += 1) {
    if (isSqlMutationKeyword_ACU(tokens[index], 'WITH') && isSqlMutationKeyword_ACU(tokens[index + 2], 'AS')) {
      cteNames.add(tokens[index + 1].value.toLowerCase());
    }
  }
  const activeFromDepths = new Set<number>();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const keyword = token.quote === null ? token.value.toUpperCase() : '';
    if (fromClauseTerminators.has(keyword)) activeFromDepths.delete(token.depth);
    if (keyword === 'FROM') activeFromDepths.add(token.depth);

    if (keyword === 'FROM' || keyword === 'JOIN') {
      const reference = getQualifiedSqlIdentifierTail_ACU(statement, tokens, index + 1);
      if (reference && reference.depth === token.depth && !cteNames.has(reference.value.toLowerCase())) {
        references.set(reference.start, reference);
      }
      continue;
    }
    if (token.commaBefore && activeFromDepths.has(token.depth) && !cteNames.has(token.value.toLowerCase())) {
      references.set(token.start, token);
    }
  }
  return [...references.values()];
}

function applySqlMutationIdentifierReplacements_ACU(
  statement: string,
  replacements: Array<{ token: SqlMutationIdentifierToken_ACU; physicalName: string }>,
): string {
  let result = statement;
  for (const { token, physicalName } of [...replacements].sort((a, b) => b.token.start - a.token.start)) {
    result = `${result.slice(0, token.start)}${formatSqlMutationIdentifier_ACU(physicalName, token.quote)}${result.slice(token.end)}`;
  }
  return result;
}

function formatSqlMutationIdentifier_ACU(value: string, quote: SqlMutationIdentifierToken_ACU['quote']): string {
  if (quote === '"') return `"${value.replace(/"/g, '""')}"`;
  if (quote === '`') return `\`${value.replace(/`/g, '``')}\``;
  if (quote === '[') return `[${value.replace(/]/g, ']]')}]`;
  return value;
}

/**
 * Rebinds mutation table identifiers from unique DDL/runtime aliases to their
 * authoritative runtime physical names for SQL generation.
 *
 * 别名来源必须与建表来源一致。建表走 _ensureTablesFromTemplate（模板权威），
 * 而 tableData 常是运行时/聊天合并快照：新卡首次填表时快照里还没有该表，
 * 只用快照建别名会漏掉 DDL 旧名，导致 rebind 原样放行并撞上 no such table。
 * 因此额外接收 supplementalData（通常为当前聊天模板）参与别名解析。
 */
export function rebindSqlMutationTableIdentifiers_ACU(
  statements: string[],
  tableData: TableDataObject_ACU,
  supplementalData?: TableDataObject_ACU | Record<string, unknown> | null,
  options: { requireKnownTables?: boolean } = {},
): string[] {
  // 建表权威是模板（_ensureTablesFromTemplate），运行时快照在新卡首次填表时还没有该表。
  // 未显式传入补充源时默认取当前聊天模板，保证别名覆盖与实际建表一致。
  const templateSource = supplementalData === undefined
    ? resolveCurrentChatTemplateForAliases_ACU()
    : supplementalData;
  // 生成路径和 Strict JSON/调度使用同一份显式身份别名契约。SQL token 一旦
  // 被唯一解析，必须立即替换为物理名；不能因 AI 使用显示名或历史名称而
  // 原样交给 SQLite，再在提交阶段误判为未知/跨表。
  const { aliases, conflicts } = buildSheetTableAliasMap_ACU(
    [templateSource, tableData],
    { includeExtendedAliases: true, skipInvalidSources: true },
  );
  return rebindSqlMutationTableReferences_ACU(statements, aliases, {
    ...options,
    ambiguousAliases: conflicts,
  });
}


/**
 * 统一表名 + 列名重绑入口（计划 4.1）。顺序固定：
 * 1. 表名重绑到运行时物理表（沿用既有 rebindSqlMutationTableIdentifiers_ACU）；
 * 2. 以 targetData 构建 target-first 列 registry，以当前聊天模板作为 supplemental；
 * 3. 按重绑后的目标表名进行列重绑（按语句 mutation target 自动选列 map）。
 *
 * 返回最终 runtime SQL；日志与持久化 operation 必须使用最终 SQL，
 * 避免每次 replay 重复纠正。
 */
export function rebindSqlMutationIdentifiers_ACU(
  statements: string[],
  targetData: TableDataObject_ACU,
  supplementalData?: TableDataObject_ACU | Record<string, unknown> | null,
  options: {
    requireKnownTables?: boolean;
    /** 只构建这些 sheetKey 的列别名 registry（其余表不注册）。缺省 = 全量（旧行为）。 */
    targetSheetKeys?: ReadonlySet<string>;
    /** 实时 AI 写路径 opt-in：INSERT/REPLACE 显式列清单命中 registry 未知列时抛 SQL_INSERT_UNKNOWN_COLUMN_ACU。 */
    requireKnownInsertColumns?: boolean;
  } = {},
): string[] {
  // 有运行时目标 schema 时，表名只能由它（或调用方显式提供的补充源）判定。
  // 不能让隐式当前模板参与表重绑：快照级 API 可能在与当前聊天模板无关的历史
  // 数据上运行，模板恰好含同名作者 DDL 时会制造虚假的表歧义。目标为空时仍保留
  // 既有模板补充能力，供首次建表等无运行时表场景使用。
  const hasTargetSheets = Object.keys(targetData || {}).some(key => key.startsWith('sheet_'));
  const tableSupplemental = supplementalData === undefined && hasTargetSheets ? null : supplementalData;
  const tableRebound = rebindSqlMutationTableIdentifiers_ACU(statements, targetData, tableSupplemental, options);
  const templateSource = supplementalData === undefined
    ? resolveCurrentChatTemplateForAliases_ACU()
    : supplementalData;
  const { aliases: columnAliases, conflicts: columnConflicts, conflictCandidates } = buildSheetColumnAliasMap_ACU(
    targetData,
    {
      supplementalSources: [templateSource],
      skipInvalidSupplementalSources: true,
      targetSheetKeys: options.targetSheetKeys,
    },
  );
  // 冲突别名 → 目标表 → 冲突集：命中即结构化拒绝（fail closed），不原样放行。
  const ambiguousByTarget = new Map<string, Set<string>>();
  for (const [tableName, tableConflicts] of columnConflicts) {
    ambiguousByTarget.set(tableName.toLowerCase(), new Set(tableConflicts));
  }
  return rebindSqlMutationColumnsByTarget_ACU(tableRebound, columnAliases, {
    ambiguousColumns: ambiguousByTarget,
    requireKnownInsertColumns: options.requireKnownInsertColumns,
    resolveAmbiguity: (targetTable, alias) => {
      const candidates = conflictCandidates.get(targetTable.toLowerCase())?.get(alias.toLowerCase());
      return candidates || [];
    },
  });
}

/**
 * 解析当前聊天生效模板，仅用于 rebind 别名补充。
 * 解析失败时返回 null：别名补充是增强项，绝不能因此让 rebind 整体失败。
 */
function resolveCurrentChatTemplateForAliases_ACU(): TableDataObject_ACU | null {
  try {
    const scopeState = getCurrentChatTemplateScopeState_ACU();
    let templateStr: string | null = null;
    if (scopeState?.mode === 'chat_override' && scopeState.templateStr) {
      templateStr = scopeState.templateStr;
    } else if (scopeState?.mode === 'preset_link' && scopeState.presetName) {
      templateStr = getTemplatePreset_ACU(scopeState.presetName)?.templateStr || null;
    }
    if (templateStr) {
      const parsed = safeJsonParse_ACU(templateStr, null);
      if (parsed && typeof parsed === 'object') {
        return stripSeedRowsFromTemplate_ACU(JSON.parse(JSON.stringify(parsed))) as TableDataObject_ACU;
      }
    }
    return parseTableTemplateJson_ACU({ stripSeedRows: true }) as TableDataObject_ACU | null;
  } catch (e: any) {
    logWarn_ACU(`[SqlTableService] rebind 别名模板解析失败，仅用运行时快照: ${e?.message || e}`);
    return null;
  }
}

function resolveChatTemplateData_ACU(
  options: { chat?: any[]; isolationKey?: string; stripSeedRows?: boolean } = {},
): TableDataObject_ACU | null {
  const stripSeedRows = options.stripSeedRows !== false;
  const scopeState = getCurrentChatTemplateScopeState_ACU({
    ...(options.chat ? { chat: options.chat } : {}),
    ...(options.isolationKey !== undefined ? { isolationKey: options.isolationKey } : {}),
  });
  let templateStr: string | null = null;
  if (scopeState?.mode === 'chat_override' && scopeState.templateStr) {
    templateStr = scopeState.templateStr;
  } else if (scopeState?.mode === 'preset_link' && scopeState.presetName) {
    templateStr = getTemplatePreset_ACU(scopeState.presetName)?.templateStr || null;
  }
  if (templateStr) {
    const parsed = safeJsonParse_ACU(templateStr, null);
    if (parsed && typeof parsed === 'object') {
      const cloned = JSON.parse(JSON.stringify(parsed));
      return (stripSeedRows ? stripSeedRowsFromTemplate_ACU(cloned) : cloned) as TableDataObject_ACU;
    }
  }
  const globalTemplate = parseTableTemplateJson_ACU({ stripSeedRows });
  return globalTemplate && typeof globalTemplate === 'object'
    ? JSON.parse(JSON.stringify(globalTemplate)) as TableDataObject_ACU
    : null;
}

/** 在 AI 请求前捕获建表与别名解析所需的不可变模板快照。 */
export function captureSqlTableApplyScope_ACU(options: {
  chat: any[];
  isolationKey: string;
  /** 请求前从 live SQLite provider 冻结的完整运行时数据（含 non-enumerable descriptor）。 */
  runtimeData?: TableDataObject_ACU | null;
}): SqlTableApplyScope_ACU {
  const rawTemplateData = resolveChatTemplateData_ACU({ ...options, stripSeedRows: true });
  const rawTemplateDataWithRows = resolveChatTemplateData_ACU({ ...options, stripSeedRows: false });
  if (!rawTemplateData || !rawTemplateDataWithRows) {
    throw new Error(`[SqlTableService] 无法捕获提交模板上下文 (isolationKey=${options.isolationKey || 'default'})。`);
  }

  // 非首列空业务表头的模板表在 SQL 活动路径中休眠跳过：
  // stripped 与 unstripped 两份快照必须共享同一有效 key 集合（带行版本只能多数据行，
  // 不能多出被跳过的表），使 Prompt、调度与提交使用同一份表集合，避免请求期间模板变化竞态。
  const projected = projectSqlActiveTemplateData_ACU(rawTemplateData);
  const projectedWithRows = projectSqlActiveTemplateData_ACU(rawTemplateDataWithRows);
  const templateData = projected.data;
  const templateDataWithRows = projectedWithRows.data;

  const activeSheetKeys = Object.keys(templateData).filter(key => key.startsWith('sheet_')).sort();
  const skippedSheets = projected.skippedSheets.length >= projectedWithRows.skippedSheets.length
    ? projected.skippedSheets
    : projectedWithRows.skippedSheets;
  if (skippedSheets.length > 0) {
    // 脱敏诊断：只记录 sheetKey / 显示名 / 空列序号，不记录数据行、DDL 或聊天正文。
    // 术语（S3-7）：这是「结构跳过」而非「休眠」——不产生 hide 记录、不进休眠清单，修正表头即自动恢复。
    logWarn_ACU(`[SqlTableService] 模板存在非首列空业务表头的表，SQL 填表中将结构跳过（不产生休眠记录）: ${
      skippedSheets
        .map(skip => `${skip.sheetKey}(${skip.name}) 空列[${skip.emptyHeaderIndexes.join(',')}]`)
        .join('；')
    }。修正表头后可在下次请求自动恢复参与。`);
  }

  // 物理表名冲突检查在投影后执行：被判定为不存在的无效表不阻塞有效表；
  // 但有效表之间的冲突仍 fail-loud。
  assertNoPhysicalTableNameCollision_ACU(templateData);

  // 请求级 runtime schema 冻结：只允许来自调用方显式传入的 live provider 导出数据。
  // 绝不在这里隐式回退到 baseSnapshot / currentJsonTableData_ACU —— 那会把历史基底
  // 冒充 live schema 权威（test31 根因）。provider 未 ready 时由调用方（orchestrator）
  // 决定是返回 infrastructure failure 还是走旧模板捕获路径。
  const runtimeSchema = freezeRuntimeSchemaFromData_ACU(
    options.runtimeData || null,
    new Set(activeSheetKeys),
  );
  return {
    isolationKey: options.isolationKey,
    templateData,
    templateDataWithRows,
    activeSheetKeys,
    skippedSheets,
    runtimeSchema: runtimeSchema ?? undefined,
    runtimeData: options.runtimeData || undefined,
  };
}

function splitTopLevelSqlList_ACU(value: string, context: string): string[] {
  const items: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === quote) {
        if (value[index + 1] === quote) index += 1;
        else quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
    } else if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth < 0) throw new Error(`${context} 的括号不匹配。`);
    } else if (char === ',' && depth === 0) {
      const item = value.slice(start, index).trim();
      if (!item) throw new Error(`${context} 包含空项。`);
      items.push(item);
      start = index + 1;
    }
  }
  if (quote || depth !== 0) throw new Error(`${context} 的字符串或括号未闭合。`);
  const item = value.slice(start).trim();
  if (!item) throw new Error(`${context} 包含空项。`);
  items.push(item);
  return items;
}

function findSqlClosingParen_ACU(value: string, openingIndex: number, context: string): number {
  let depth = 0;
  let quote: "'" | '"' | null = null;
  for (let index = openingIndex; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === quote) {
        if (value[index + 1] === quote) index += 1;
        else quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return index;
      if (depth < 0) break;
    }
  }
  throw new Error(`${context} 的括号未闭合。`);
}

function buildRowIdReservationsByRuntimeTable_ACU(
  tableData: TableDataObject_ACU,
  additionalReservations?: Map<string, Set<string>>,
): Map<string, Set<string>> {
  const reservations = new Map<string, Set<string>>();
  for (const [sheetKey, value] of Object.entries(tableData || {})) {
    if (!sheetKey.startsWith('sheet_')) continue;
    const content = (value as any)?.content;
    reservations.set(getPhysicalTableNameForSheet_ACU(tableData, sheetKey).toLowerCase(), createStableRowIdReservation_ACU(
      Array.isArray(content) ? content.slice(1) : [],
    ));
  }
  for (const [tableName, rowIds] of additionalReservations || []) {
    const reservation = reservations.get(tableName.toLowerCase()) || new Set<string>();
    for (const rowId of rowIds) reservation.add(rowId);
    reservations.set(tableName.toLowerCase(), reservation);
  }
  return reservations;
}

export class SqlRowIdMaterializationError_ACU extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlRowIdMaterializationError_ACU';
  }
}

export class SqlRuntimeSnapshotError_ACU extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlRuntimeSnapshotError_ACU';
  }
}

/**
 * 请求前冻结的 runtime schema 无法建立（provider 未 ready / 导出失败 / schema 解析失败）。
 * 属于本地前置条件失败：模型无法通过重试修复，必须分类为 infrastructure/precondition，
 * 不得进入 UNIFIED_GROUP_ERROR_FEEDBACK 模型重试链。
 */
export class SqlRuntimeSchemaInvalidError_ACU extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlRuntimeSchemaInvalidError_ACU';
    Object.defineProperty(this, 'code', { value: 'SQL_RUNTIME_SCHEMA_INVALID_ACU', enumerable: false });
  }
}

/**
 * 提交时检测到 live SQLite runtime schema 与请求前冻结 schema 不一致。
 * 必须在任何 SQLite mutation 前中止（零写入），并分类为 infrastructure/precondition。
 */
export class SqlRuntimeSchemaStaleError_ACU extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlRuntimeSchemaStaleError_ACU';
    Object.defineProperty(this, 'code', { value: 'SQL_RUNTIME_SCHEMA_STALE_ACU', enumerable: false });
  }
}

/**
 * 计算请求级 runtime schema 的稳定 digest。
 *
 * 输入只取 effectiveDDL（规范化空白）与 columnMap（稳定排序），不包含业务行、
 * diagnostics、聊天正文或 SQL。返回空串表示无可参与 digest 的表（调用方必须
 * 结合自身状态 fail-closed，不能把空 digest 当作“已一致”）。
 */
export function computeRuntimeSchemaDigest_ACU(
  bySheetKey: ReadonlyMap<string, { effectiveDDL: string; columnMap: unknown }>,
): string {
  const sheetKeys = Array.from(bySheetKey.keys()).sort();
  if (sheetKeys.length === 0) return '';
  const lines = sheetKeys.map(sheetKey => {
    const schema = bySheetKey.get(sheetKey)!;
    const normalizedDDL = String(schema.effectiveDDL || '').replace(/\s+/g, ' ').trim();
    const columnMap = schema.columnMap as {
      mappings?: Array<{ sourceIndex?: number; displayName?: string; sqlName?: string; required?: boolean }>;
      sqlToDisplay?: unknown;
    } | null | undefined;
    const mappings = Array.isArray(columnMap?.mappings) ? [...columnMap!.mappings].sort((a, b) => (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0)) : [];
    const mapLines = mappings.map(mapping => `${mapping.sourceIndex ?? ''}|${String(mapping.displayName ?? '').toLowerCase()}|${String(mapping.sqlName ?? '').toLowerCase()}`).join(',');
    return `${sheetKey}\u0000${normalizedDDL}\u0000${mapLines}`;
  });
  return hashUserInput_ACU(lines.join('\n'));
}

/** 从冻结的完整 runtimeData 中构建窄 schema 视图（只保留 schema 证据，不复制业务行）。 */
export function freezeRuntimeSchemaFromData_ACU(
  runtimeData: TableDataObject_ACU | null | undefined,
  activeSheetKeys: ReadonlySet<string> | null | undefined,
): RuntimeSchemaFreeze_ACU | null {
  if (!runtimeData || typeof runtimeData !== 'object') return null;
  const bySheetKey = new Map<string, FrozenSheetRuntimeSchema_ACU>();
  const activeKeys = activeSheetKeys ? activeSheetKeys : new Set(Object.keys(runtimeData).filter(key => key.startsWith('sheet_')));
  for (const sheetKey of Object.keys(runtimeData).filter(key => key.startsWith('sheet_'))) {
    if (activeKeys.size > 0 && !activeKeys.has(sheetKey)) continue;
    const sheet = (runtimeData as any)[sheetKey];
    if (!sheet || typeof sheet !== 'object') continue;
    const descriptor = getRuntimeEffectiveSchema_ACU(sheet) as {
      effectiveDDL?: string; columnMap?: unknown; source?: string; diagnostics?: readonly string[];
    } | null | undefined;
    if (!descriptor || typeof descriptor !== 'object') {
      // 运行时表必须携带 descriptor；缺失视为 schema 契约损坏（fail-closed）。
      return null;
    }
    const physicalTableName = getPhysicalTableNameForSheet_ACU(runtimeData, sheetKey);
    bySheetKey.set(sheetKey, {
      sheetKey,
      physicalTableName,
      effectiveDDL: String(descriptor.effectiveDDL || ''),
      columnMap: descriptor.columnMap,
      source: String(descriptor.source || ''),
      diagnostics: Array.isArray(descriptor.diagnostics) ? descriptor.diagnostics : [],
    });
  }
  if (bySheetKey.size === 0) return null;
  return { bySheetKey, sheetKeys: Array.from(bySheetKey.keys()).sort(), digest: computeRuntimeSchemaDigest_ACU(bySheetKey) };
}

interface SqlInsertColumnToken_ACU {
  token: SqlMutationIdentifierToken_ACU;
  /** 原始写法（含引号风格原样保留，供重建 SQL 时使用）。 */
  raw: string;
  /** 大小写不敏感规范化后的列名。 */
  normalized: string;
}

interface SqlInsertColumnList_ACU {
  columns: SqlInsertColumnToken_ACU[];
  /** 列清单闭括号在原始语句中的位置（用于定位 VALUES）。 */
  closingParenEnd: number;
}
/** INSERT 列清单中不允许出现的 SQL 关键字（fail-closed：宁可拒绝也不猜测）。 */
const INSERT_COLUMN_KEYWORDS_ACU = new Set([
  'SELECT', 'FROM', 'WHERE', 'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET',
  'UNION', 'EXCEPT', 'INTERSECT', 'VALUES', 'SET', 'JOIN', 'ON', 'AS',
  'WITH', 'RECURSIVE', 'DISTINCT', 'BY', 'AND', 'OR', 'NOT', 'IN', 'IS',
  'NULL', 'LIKE', 'BETWEEN', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'ASC',
  'DESC', 'COLLATE', 'USING', 'PRIMARY', 'KEY', 'UNIQUE', 'CHECK', 'DEFAULT',
  'REFERENCES', 'FOREIGN', 'CONSTRAINT', 'INDEX', 'CREATE', 'TABLE', 'ALTER',
  'DROP', 'INSERT', 'REPLACE', 'UPDATE', 'DELETE', 'INTO', 'RETURNING',
  'WINDOW', 'OVER', 'PARTITION', 'ROW', 'ROWS', 'RANGE', 'CROSS', 'NATURAL',
  'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER',
]);

/**
 * 收集 statement[from,to) 区间内除空白与 SQL 注释之外的所有有效字符。
 * 行注释/块注释被完整跳过（注释里的逗号/括号/标识符不作数），
 * 用于校验列清单的合法分隔：首列前只能有一个 `(`，列间只能有一个 `,`。
 */
function collectSignificantCharsBetween_ACU(
  statement: string,
  from: number,
  to: number,
  context: string,
): Array<{ char: string; index: number }> {
  const found: Array<{ char: string; index: number }> = [];
  let index = from;
  while (index < to) {
    const char = statement[index];
    const next = statement[index + 1];
    if (char === '-' && next === '-') {
      index += 2;
      while (index < to && statement[index] !== '\n' && statement[index] !== '\r') index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = statement.indexOf('*/', index + 2);
      if (end < 0 || end + 2 > to) throw new Error(`${context} 的 SQL 块注释未闭合或跨越边界，无法安全解析。`);
      index = end + 2;
      continue;
    }
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    found.push({ char, index });
    index += 1;
  }
  return found;
}


/**
 * 基于 tokenizer（天然跳过行注释/块注释/字符串）提取 INSERT 列清单。
 *
 * 只接受普通 `INSERT INTO target (identifier, ...)`：
 * - 逐 token 校验，拒绝表达式、限定名、空项、重复列；
 * - token 间隙必须是合法分隔（逗号或括号），列间缺失逗号即拒绝；
 * - 注释位于列间/列后时被 tokenizer 跳过，不会残留在列项中（test31 根因 3.3）。
 *
 * @returns 规范列名（token 语义）、原始 token 范围、VALUES 起点。
 * @throws 非法列清单（表达式/空项/重复列/未闭合注释）时 fail-closed。
 */
function extractSqlInsertColumns_ACU(
  statement: string,
  tokens: SqlMutationIdentifierToken_ACU[],
  target: SqlMutationIdentifierToken_ACU,
  context: string,
): SqlInsertColumnList_ACU {
  const targetIndex = tokens.indexOf(target);
  if (targetIndex < 0) {
    throw new Error(`${context} 无法定位目标表 token。`);
  }
  // 目标表后第一个 depth+1 的 token 即列清单首列。
  let openIndex = -1;
  for (let index = targetIndex + 1; index < tokens.length; index += 1) {
    if (tokens[index].depth === target.depth + 1) {
      openIndex = index;
      break;
    }
    // 目标表后出现 depth 回落或 VALUES/SELECT 等终止词且未进入列清单 → 无显式列。
    if (tokens[index].depth === target.depth) {
      const upper = tokens[index].value.toUpperCase();
      if (upper === 'VALUES' || upper === 'SELECT' || upper === 'DEFAULT') break;
    }
  }
  if (openIndex < 0) {
    // 无列清单：调用方（materialize）要求显式列，这里抛错保持 fail-closed。
    throw new Error(`${context} 必须显式列出业务列，系统才能分配 row_id。`);
  }

  const columns: SqlInsertColumnToken_ACU[] = [];
  let closingParenEnd = -1;
  const seen = new Set<string>();
  let cursor = openIndex;
  let previousColumn: SqlInsertColumnToken_ACU | null = null;
  while (cursor < tokens.length) {
    const token = tokens[cursor];
    if (token.depth < target.depth + 1) {
      break;
    }
    if (token.depth > target.depth + 1) {
      throw new Error(`${context} 的列清单包含表达式或限定名，无法安全解析。`);
    }
    if (token.depth === target.depth + 1) {
      // 合法列 token：非关键字、非空、非重复；分隔由 token 间有效字符精确校验。
      const isKeyword = token.quote === null && INSERT_COLUMN_KEYWORDS_ACU.has(token.value.toUpperCase());
      if (isKeyword) {
        throw new Error(`${context} 的列清单包含非法标识符「${token.value}」。`);
      }
      const normalized = decodeSqlIdentifier_ACU(token.value).toLowerCase();
      if (!normalized || !/^[a-z_][a-z0-9_$]*$/i.test(normalized)) {
        throw new Error(`${context} 的列名无法安全解析：「${token.value}」。`);
      }
      if (seen.has(normalized)) {
        throw new Error(`${context} 的列名重复：「${token.value}」。`);
      }
      seen.add(normalized);
      if (previousColumn === null) {
        // 首列前必须恰好一个 `(`（注释/空白被跳过）。
        const between = collectSignificantCharsBetween_ACU(statement, target.end, token.start, context);
        if (between.length !== 1 || between[0].char !== '(') {
          throw new Error(`${context} 的列清单必须以括号开头，无法安全解析。`);
        }
      } else if (token.commaBefore) {
        // tokenizer 只记录「此 token 前有逗号」；`a,,b` 的连续逗号会被 Set 去重，
        // commaBefore 仍为 true，必须用区段扫描确认 token 间恰好一个 `,`（拒绝空项）。
        const between = collectSignificantCharsBetween_ACU(statement, previousColumn.token.end, token.start, context);
        if (between.length !== 1 || between[0].char !== ',') {
          throw new Error(`${context} 的列清单包含空项或多余逗号，无法安全解析。`);
        }
      } else {
        throw new Error(`${context} 的列清单缺少逗号分隔，无法安全解析。`);
      }
      columns.push({
        token,
        raw: statement.slice(token.start, token.end),
        normalized,
      });
      previousColumn = columns[columns.length - 1];
    }
    cursor += 1;
  }

  if (columns.length === 0) {
    throw new Error(`${context} 的列清单为空，无法安全解析。`);
  }
  // 闭括号定位：最后一个列 token 之后第一个有效字符必须是 `)`（允许行/块注释与空白），
  // 尾逗号（第一个有效字符为 `,`）直接拒绝；`--` 行注释会把同一行的 `)` 吞掉 → 抛未闭合。
  const lastColumn = columns[columns.length - 1].token;
  const afterLast = collectSignificantCharsBetween_ACU(statement, lastColumn.end, statement.length, context);
  if (afterLast.length === 0 || afterLast[0].char !== ')') {
    throw new Error(`${context} 的列清单括号未闭合，无法安全解析。`);
  }
  closingParenEnd = afterLast[0].index + 1;

  return { columns, closingParenEnd };
}

/** INSERT ... SELECT 先执行后物化的结果行数上限：防止 AI 生成笛卡尔积把日志撑爆。 */
const SQL_INSERT_SELECT_MATERIALIZE_ROW_CAP_ACU = 500;

/** SELECT 预执行器：由持有 SQLite 引擎的调用方注入（live runtime 或快照 hydrate 后的引擎）。 */
export interface SqlMaterializeSelectQueryRunner_ACU {
  (sql: string): { columns: string[]; values: unknown[][] };
}

/** 把 SELECT 预执行的结果值转成可回放的 SQL 字面量。物化文本即回放事实来源。 */
function literalizeSqlValueForMaterialization_ACU(value: unknown, context: string): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${context} 的查询结果包含非有限数值，无法物化。`);
    return String(value);
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
  throw new Error(`${context} 的查询结果包含无法物化的值类型，无法安全转为 SQL 字面量。`);
}

/**
 * 值数量与列数量不一致的可判定形态自动修复（AI 高频笔误）：
 * - 值比列多 1 且列清单未含 row_id → 视首值为 AI 自带 row_id，剔除（row_id 由系统重分配）；
 * - 值比列少 → 尾部补 NULL（AI 漏写尾部可选列）。
 * 其余形态维持拒绝，交给既有重试反馈机制。
 */
function repairSqlInsertValueCountMismatch_ACU(
  values: string[],
  columnCount: number,
  suppliedRowIdIndex: number,
  context: string,
): string[] {
  if (values.length === columnCount) return values;
  if (values.length === columnCount + 1 && suppliedRowIdIndex < 0) {
    logWarn_ACU(`[SqlTableService] ${context} 的值比列多 1 且列清单未含 row_id：已按"首值为 AI 自带 row_id"剔除首值（row_id 由系统重新分配）。`);
    return values.slice(1);
  }
  if (values.length < columnCount) {
    logWarn_ACU(`[SqlTableService] ${context} 的值比列少 ${columnCount - values.length} 个：已按 AI 漏写尾部可选列处理，尾部补 NULL。`);
    return [...values, ...new Array(columnCount - values.length).fill('NULL')];
  }
  throw new Error(`${context} 的值数量与列数量不一致。`);
}

/**
 * Makes ordinary AI-authored INSERT statements self-describing before execution and V2 logging.
 * SQLite REPLACE / INSERT OR REPLACE forms retain their native semantics and are persisted unchanged.
 *
 * 宽容形态（全部保持回放确定性——物化后的 VALUES 文本就是回放事实）：
 * - `INSERT OR IGNORE/ABORT/FAIL/ROLLBACK`：保留冲突子句前缀，照常物化系统 row_id
 *   （row_id 由系统新分配不会撞 rowid，业务列冲突语义由前缀原样保留）；
 * - `INSERT ... SELECT` / `WITH ... INSERT ... SELECT`：静态改写无法预知插入行数，
 *   改为先在当前引擎快照上执行 SELECT 取回结果行，再物化成显式 VALUES 插入
 *   （需调用方注入 selectQueryRunner；无引擎的调用方维持拒绝）。结果为空时物化为
 *   空语句（''，调用方过滤），超过行数上限拒绝；
 * - 值数不一致的可判定形态自动修复（见 repairSqlInsertValueCountMismatch_ACU）。
 */
export function materializeSystemRowIdsForSqlInserts_ACU(
  statements: string[],
  tableData: TableDataObject_ACU,
  additionalReservations?: Map<string, Set<string>>,
  options?: { selectQueryRunner?: SqlMaterializeSelectQueryRunner_ACU },
): string[] {
  const reservations = buildRowIdReservationsByRuntimeTable_ACU(tableData, additionalReservations);
  return statements.map((statement, statementIndex) => {
    const context = `AI INSERT 第 ${statementIndex + 1} 条`;
    const tokens = tokenizeSqlMutationIdentifiers_ACU(statement);
    const actionIndex = getSqlMutationActionIndex_ACU(tokens);
    const action = tokens[actionIndex];
    if (isSqlMutationKeyword_ACU(action, 'REPLACE')) return statement;
    if (!isSqlMutationKeyword_ACU(action, 'INSERT')) return statement;
    if (isSqlMutationKeyword_ACU(tokens[actionIndex + 1], 'OR') && isSqlMutationKeyword_ACU(tokens[actionIndex + 2], 'REPLACE')) return statement;
    // WITH 前缀：只支持"先执行后物化"的 INSERT…SELECT 形态（payload 分支统一处理）。
    const withPrefix = actionIndex !== 0 ? statement.slice(0, action.start) : '';
    const target = getSqlMutationTargetToken_ACU(statement, tokens);
    const reservation = reservations.get(target.value.toLowerCase());
    if (!reservation) {
      throw new Error(`${context} 无法识别目标表：${target.value}。`);
    }
    const suffix = statement.slice(target.end).trim();
    if (!suffix.startsWith('(')) {
      // 无显式列清单一律拒绝（含 INSERT SELECT）：系统无法确定 row_id 之外的列对应关系。
      throw new Error(`${context} 必须显式列出业务列，系统才能分配 row_id。`);
    }
    // [阶段 D] 统一为 token 语义：tokenizer 天然跳过列间/列后注释，杜绝注释残留在
    // 列项中导致「列名无法安全解析」（test31 根因 3.3）。
    const columnList = extractSqlInsertColumns_ACU(statement, tokens, target, context);
    const normalizedColumns = columnList.columns.map(column => column.normalized);
    const suppliedRowIdIndex = normalizedColumns.indexOf('row_id');
    const businessColumns = columnList.columns
      .filter((_, index) => index !== suppliedRowIdIndex)
      .map(column => column.raw);
    if (businessColumns.length === 0) {
      throw new Error(`${context} 剔除 row_id 后没有业务列，无法执行插入。`);
    }
    const payloadText = statement.slice(columnList.closingParenEnd).trim();
    // 重建头部：WITH 前缀不进入物化结果（SELECT 已被预执行消化），冲突子句前缀
    // （INSERT OR IGNORE 等）位于 action.start..target.end 区间内，天然保留。
    const insertHead = statement.slice(actionIndex === 0 ? 0 : action.start, target.end);

    let tuples: string[][];
    if (/^VALUES\b/i.test(payloadText)) {
      if (withPrefix) {
        throw new Error(`${context} 不支持 WITH 前缀的 VALUES 插入；请使用标准 INSERT INTO ... (列名) VALUES (...).`);
      }
      const tupleText = payloadText.slice('VALUES'.length).trim();
      const rawTuples = splitTopLevelSqlList_ACU(tupleText, `${context} VALUES`);
      tuples = rawTuples.map((tuple, tupleIndex) => {
        if (!tuple.startsWith('(') || findSqlClosingParen_ACU(tuple, 0, `${context} 第 ${tupleIndex + 1} 个 VALUES`) !== tuple.length - 1) {
          throw new Error(`${context} 只支持括号包裹的 VALUES 行。`);
        }
        const values = splitTopLevelSqlList_ACU(tuple.slice(1, -1), `${context} 第 ${tupleIndex + 1} 个 VALUES`);
        return repairSqlInsertValueCountMismatch_ACU(values, columnList.columns.length, suppliedRowIdIndex, `${context} 第 ${tupleIndex + 1} 行`);
      });
    } else if (/^SELECT\b/i.test(payloadText)) {
      const runner = options?.selectQueryRunner;
      if (!runner) {
        throw new Error(`${context} 在当前执行路径不支持 INSERT SELECT；请改为显式业务列的 VALUES 插入。`);
      }
      let queryResult: { columns: string[]; values: unknown[][] };
      try {
        // 预执行发生在本批任何 mutation 之前：SELECT 看到的是批前快照。物化后的
        // VALUES 文本同时是 live 执行与回放的输入，两侧结果按构造一致。
        queryResult = runner(`${withPrefix}${payloadText}`);
      } catch (error: any) {
        throw new Error(`${context} 的 SELECT 预执行失败：${error?.message || String(error)}`);
      }
      if (queryResult.values.length > SQL_INSERT_SELECT_MATERIALIZE_ROW_CAP_ACU) {
        throw new Error(`${context} 的 SELECT 结果 ${queryResult.values.length} 行，超过物化上限 ${SQL_INSERT_SELECT_MATERIALIZE_ROW_CAP_ACU} 行，已拒绝。`);
      }
      if (queryResult.values.length === 0) {
        logWarn_ACU(`[SqlTableService] ${context} 的 INSERT SELECT 结果为空，已物化为无操作。`);
        return '';
      }
      if (queryResult.columns.length !== columnList.columns.length) {
        throw new Error(`${context} 的 SELECT 结果列数（${queryResult.columns.length}）与插入列清单（${columnList.columns.length}）不一致。`);
      }
      tuples = queryResult.values.map(row =>
        row.map(value => literalizeSqlValueForMaterialization_ACU(value, context)));
    } else {
      throw new Error(`${context} 只支持 VALUES 插入或显式列清单的 INSERT SELECT。`);
    }

    const materializedTuples = tuples.map(values => {
      const businessValues = values.filter((_, index) => index !== suppliedRowIdIndex);
      return `(${allocateStableRowId_ACU(reservation)}, ${businessValues.join(', ')})`;
    });
    // 重建 SQL：保留业务 VALUES 原文/预执行字面量；显式 row_id 由系统重分配。
    return `${insertHead} (row_id, ${businessColumns.join(', ')}) VALUES ${materializedTuples.join(', ')}`;
  });
}

/**
 * Rejects AI-authored INSERT/UPDATE assignments that target hidden physical
 * columns. It deliberately reuses the mutation tokenizer so strings and
 * comments cannot masquerade as identifiers.
 */
export function assertNoHiddenPhysicalColumnMutations_ACU(
  statements: string[],
  tableData: Record<string, any>,
): void {
  // 与 rebind/调度共享同一表身份规范化与冲突结论（canonicalizeDisplayName_ACU），
  // 避免隐藏列保护与执行层对英文名唯一性的判断不一致。
  const { aliases, conflicts } = buildSheetTableAliasMap_ACU(
    [tableData as TableDataObject_ACU],
    { includeExtendedAliases: false },
  );
  const sheetKeyByPhysicalName = new Map<string, string>();
  for (const [sheetKey, physicalName] of resolvePhysicalTableNames_ACU(tableData as TableDataObject_ACU)) {
    sheetKeyByPhysicalName.set(canonicalizeTableAliasForHiddenProtection_ACU(physicalName), sheetKey);
  }
  const sheetsByAlias = new Map<string, { sheetKey: string; sheet: any } | null>();
  for (const [alias, physicalName] of aliases) {
    const normalized = canonicalizeTableAliasForHiddenProtection_ACU(alias);
    if (conflicts.has(normalized) || !normalized) continue;
    const sheetKey = sheetKeyByPhysicalName.get(canonicalizeTableAliasForHiddenProtection_ACU(physicalName));
    if (!sheetKey) continue;
    sheetsByAlias.set(normalized, { sheetKey, sheet: tableData[sheetKey] });
  }
  for (const conflictKey of conflicts) {
    sheetsByAlias.set(canonicalizeTableAliasForHiddenProtection_ACU(conflictKey), null);
  }

  for (const statement of statements) {
    const tokens = tokenizeSqlMutationIdentifiers_ACU(statement);
    const actionIndex = getSqlMutationActionIndex_ACU(tokens);
    const action = tokens[actionIndex];
    const actionKeyword = action?.quote === null ? action.value.toUpperCase() : '';
    if (!new Set(['INSERT', 'REPLACE', 'UPDATE', 'DELETE']).has(actionKeyword)) {
      throw new Error(`SQLite 填表仅允许 INSERT、REPLACE、UPDATE、DELETE 数据变更语句，收到：${action?.value || 'empty'}。禁止输出 CREATE、ALTER、DROP、事务或查询语句。`);
    }
    const target = getSqlMutationTargetToken_ACU(statement, tokens);
    const resolved = sheetsByAlias.get(canonicalizeTableAliasForHiddenProtection_ACU(target.value));
    if (resolved === undefined) continue;
    if (resolved === null) {
      const error = new Error(`无法唯一解析隐藏列保护的 SQL 目标表：${target.value}。该名称同时指向多张物理表。`);
      Object.defineProperty(error, 'code', { value: 'SQL_ALIAS_AMBIGUOUS_ACU', enumerable: false });
      throw error;
    }
    const hidden = new Set(getSheetColumnProjection_ACU(resolved.sheet).hiddenPhysicalColumns.map(name => name.toLowerCase()));
    if (hidden.size === 0) continue;

    const hiddenReferences = tokens.filter(token => token !== target && hidden.has(token.value.toLowerCase()));
    if (hiddenReferences.length > 0) {
      throw new Error(`SQL mutation 不允许引用隐藏物理列：${[...new Set(hiddenReferences.map(token => token.value))].join('、')}。`);
    }

    const isInsert = actionKeyword === 'INSERT' || actionKeyword === 'REPLACE';
    if (isInsert) {
      const targetIndex = tokens.indexOf(target);
      const clauseIndex = tokens.findIndex((token, index) => index > targetIndex
        && token.depth === target.depth
        && token.quote === null
        && new Set(['VALUES', 'SELECT', 'DEFAULT']).has(token.value.toUpperCase()));
      const beforeClause = clauseIndex === -1 ? tokens.slice(targetIndex + 1) : tokens.slice(targetIndex + 1, clauseIndex);
      const columnTokens = beforeClause.filter(token => token.depth === target.depth + 1);
      if (columnTokens.length === 0) {
        throw new Error(`存在隐藏物理列时，INSERT/REPLACE 必须显式列出可见目标列：${target.value}。`);
      }
    }
  }
}

function canonicalizeTableAliasForHiddenProtection_ACU(value: unknown): string {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

export function mapSqlTableNamesToSheetKeys_ACU(tableData: TableDataObject_ACU | null | undefined, tableNames: string[]): string[] {
  if (!tableData || !Array.isArray(tableNames) || tableNames.length === 0) return [];
  const { aliases, conflicts } = buildSheetTableAliasMap_ACU([tableData], { includeExtendedAliases: true });
  const sheetKeyByPhysicalName = new Map(
    [...resolvePhysicalTableNames_ACU(tableData)].map(([sheetKey, physicalName]) => [physicalName.toLowerCase(), sheetKey]),
  );
  const matchedKeys = new Set<string>();
  for (const rawName of tableNames) {
    const normalized = String(rawName || '').normalize('NFKC').trim().toLocaleLowerCase('en-US');
    if (!normalized || conflicts.has(normalized)) continue;
    const physicalName = aliases.get(normalized);
    const sheetKey = physicalName ? sheetKeyByPhysicalName.get(physicalName.toLowerCase()) : undefined;
    if (sheetKey) matchedKeys.add(sheetKey);
  }
  return [...matchedKeys];
}

function appendSqlSheetBatchOperation_ACU(
  operations: TableMutationOperationV2_ACU[],
  sheetKey: string,
  statement: string,
  param: TableSqlBindValueV2_ACU[] | undefined,
  reason: 'manual_crud' | 'import' | 'system',
  tableName: string,
): void {
  const last = operations[operations.length - 1] as any;
  if (last?.kind === 'sql_sheet_batch' && last.sheetKey === sheetKey) {
    if (last.tableName !== tableName) throw new Error(`sql_sheet_batch 合并时发现 runtime 表名不一致：${sheetKey}。`);
    last.statements.push(statement);
    if (param !== undefined || Array.isArray(last.params)) {
      if (!Array.isArray(last.params)) last.params = [];
      last.params.push(param || []);
    }
    return;
  }
  operations.push({
    kind: 'sql_sheet_batch',
    sheetKey,
    statements: [statement],
    ...(param !== undefined ? { params: [param] } : {}),
    tableName,
    reason,
  });
}

function appendLegacySqlBatchOperation_ACU(
  operations: TableMutationOperationV2_ACU[],
  statement: string,
  param: TableSqlBindValueV2_ACU[] | undefined,
): void {
  const last = operations[operations.length - 1] as any;
  if (last?.kind === 'sql_batch') {
    last.statements.push(statement);
    if (param !== undefined || Array.isArray(last.params)) {
      if (!Array.isArray(last.params)) last.params = [];
      last.params.push(param || []);
    }
    return;
  }
  operations.push({
    kind: 'sql_batch',
    statements: [statement],
    ...(param !== undefined ? { params: [param] } : {}),
  });
}

export function buildSqlSheetBatchOperations_ACU(
  statements: string[],
  tableData: TableDataObject_ACU,
  options: SqlSheetBatchBuildOptions_ACU = {},
): SqlSheetBatchBuildResult_ACU {
  const operations: TableMutationOperationV2_ACU[] = [];
  const classifiedSheetKeys = new Set<string>();
  const unknownStatements: string[] = [];
  const ambiguousStatements: string[] = [];
  const fallbackTargetSheetKeys = Array.isArray(options.fallbackTargetSheetKeys)
    ? options.fallbackTargetSheetKeys.filter(key => typeof key === 'string' && key.startsWith('sheet_'))
    : [];
  const allowFallback = options.allowSingleTargetFallback === true && fallbackTargetSheetKeys.length === 1;
  const keepLegacy = options.keepLegacyForUnclassified === true;
  const reason = options.reason || 'system';

  (Array.isArray(statements) ? statements : []).forEach((statement, index) => {
    if (typeof statement !== 'string' || !statement.trim()) return;
    const param = Array.isArray(options.params) ? options.params[index] : undefined;
    const tableNames = extractTableNamesFromStatements([statement]);
    const sheetKeys = mapSqlTableNamesToSheetKeys_ACU(tableData, tableNames);
    if (sheetKeys.length === 1) {
      const sheetKey = sheetKeys[0];
      classifiedSheetKeys.add(sheetKey);
      appendSqlSheetBatchOperation_ACU(operations, sheetKey, statement, param, reason, getPhysicalTableNameForSheet_ACU(tableData, sheetKey));
      return;
    }
    if (sheetKeys.length === 0 && tableNames.length === 0 && allowFallback) {
      const sheetKey = fallbackTargetSheetKeys[0];
      classifiedSheetKeys.add(sheetKey);
      unknownStatements.push(statement);
      appendSqlSheetBatchOperation_ACU(operations, sheetKey, statement, param, reason, getPhysicalTableNameForSheet_ACU(tableData, sheetKey));
      return;
    }
    if (sheetKeys.length > 1) {
      ambiguousStatements.push(statement);
    } else {
      unknownStatements.push(statement);
    }
    if (keepLegacy) appendLegacySqlBatchOperation_ACU(operations, statement, param);
  });

  return {
    operations,
    classifiedSheetKeys: [...classifiedSheetKeys],
    unknownStatements,
    ambiguousStatements,
  };
}

export class SqlTableService implements ITableStorageProvider {
  readonly mode = 'sqlite' as const;
  private engine: SqliteEngine;
  private syncBridge: SyncBridge;
  private _initialized = false;
  private _existingTableSet?: Set<string>;
  /**
   * 本实例的全局 NameMapper 发布凭证。
   *
   * 切聊/重载会出现「新实例已发布映射 → 旧实例才 dispose」的置换顺序，
   * 因此清理必须按所有权判定，否则旧实例会把新 runtime 的映射清成 unbound。
   */
  private readonly nameMapperOwner_ACU: NameMapperOwnerToken_ACU;
  private readonly isolatedRuntime_ACU: boolean;
  private isolatedJsonView_ACU: TableDataObject_ACU | null = null;

  constructor(options?: { isolatedRuntime?: boolean }) {
    this.isolatedRuntime_ACU = options?.isolatedRuntime === true;
    this.engine = new SqliteEngine();
    this.syncBridge = new SyncBridge(this.engine);
    this.nameMapperOwner_ACU = createNameMapperOwnerToken_ACU(
      this.isolatedRuntime_ACU ? 'sql-table-service-isolated' : 'sql-table-service',
    );
  }

  private _readCanonicalView_ACU(): TableDataObject_ACU | null {
    return this.isolatedRuntime_ACU ? this.isolatedJsonView_ACU : currentJsonTableData_ACU;
  }

  private _publishCanonicalView_ACU(data: TableDataObject_ACU | null): void {
    if (this.isolatedRuntime_ACU) {
      this.isolatedJsonView_ACU = data;
      return;
    }
    _set_currentJsonTableData_ACU(data);
  }

  private _tryPublishNameMapper_ACU(data: TableDataObject_ACU | null): boolean {
    if (this.isolatedRuntime_ACU) return true;
    if (!data) return this._buildNameMapper({ mate: DEFAULT_MATE_ACU } as TableDataObject_ACU);
    return this._buildNameMapper(data);
  }

  private _releaseNameMapperIfShared_ACU(): void {
    if (this.isolatedRuntime_ACU) return;
    releaseGlobalNameMapperForOwner_ACU(this.nameMapperOwner_ACU);
  }

  isReady(): boolean {
    return this._initialized && this.engine.isReady;
  }

  /**
   * 以本实例身份按给定 canonical 快照刷新映射。
   * 外部 CRUD 与回滚路径不持有发布凭证，必须经活跃 provider 刷新，
   * 否则会出现「owner 是本实例、内容却由无所有权入口改写」的脱节。
   */
  refreshNameMapperForData_ACU(data: TableDataObject_ACU): boolean {
    return this._tryPublishNameMapper_ACU(data);
  }

  createRuntimeSnapshot(): Uint8Array | null {
    if (!this._initialized || !this.engine.isReady) return null;
    return this.engine.exportBinary();
  }

  async restoreRuntimeSnapshot(snapshot: unknown): Promise<void> {
    if (!(snapshot instanceof Uint8Array)) throw new Error('SQLite 运行时快照无效，无法恢复。');
    // 失败时要撤回本实例写入的共享 canonical 视图，避免半成功状态污染其他读者。
    const previousJsonView = this._readCanonicalView_ACU();
    this._releaseNameMapperIfShared_ACU();
    await this.engine.loadFromBinary(snapshot);
    this._existingTableSet = undefined;
    // 映射必须基于「刚从恢复后 engine 成功导出」的视图构建。
    // 导出失败时残留的旧 JSON 与新 engine 不同源，绝不能拿它发布映射。
    // ownView 只能取自本次真实写入的返回值：读取全局值会把其他实例在
    // loadFromBinary 等待期间发布的视图误认成本实例的写入。
    const restoredView = this._syncToJson();
    if (!restoredView) {
      this._initialized = false;
      throw new Error('sqlite_snapshot_restore_failed: 快照恢复后无法导出 canonical 视图。');
    }
    if (!this._tryPublishNameMapper_ACU(restoredView)) {
      this._initialized = false;
      this._revertOwnJsonView_ACU(restoredView, previousJsonView);
      throw new Error('name_mapper_publish_rejected: 快照恢复后未能发布中英文名映射。');
    }
    this._initialized = true;
  }

  /**
   * 从聊天消息加载表格数据到 SQLite
   * 仅保留兼容入口：回放后委托 loadFromData() 初始化 runtime，
   * 防止聊天回放和 SQLite hydrate 拥有两套不同逻辑。
   */
  async loadFromChat(): Promise<{
    loaded: boolean;
    source: 'merged' | 'initialized' | 'empty';
    error?: string;
  }> {
    try {
      const mergedData = await mergeAllIndependentTables_ACU();
      return await this.loadFromData(mergedData as TableDataObject_ACU | null);
    } catch (e: any) {
      const errMsg = e?.message || String(e);
      logError_ACU(`[SqlTableService] 回放聊天数据失败: ${errMsg}`);
      return { loaded: false, source: 'empty', error: `replay_failed: ${errMsg}` };
    }
  }

  /**
   * 从调用方刚刚恢复的当前聊天 JSON 快照初始化 SQLite runtime。
   * 调用方必须保证 data 与当前聊天/isolationKey 属于同一次回放；本方法绝不自行回放聊天，
   * 从而避免 legacy→V2 迁移与 SQLite 初始化重复产生副作用。
   *
   * 返回契约：`loaded` 表示数据存在性而非 readiness——
   * `loaded: false, source: 'empty', error: undefined` 是正常空 schema
   * （引擎已初始化、empty-schema mapper 已发布、`isReady() === true`）；
   * 仅当 `error` 存在时才表示加载失败，此时 runtime 被重置为 not-ready。
   */
  async loadFromData(data: TableDataObject_ACU | null): Promise<{
    loaded: boolean;
    source: 'merged' | 'initialized' | 'empty';
    error?: string;
  }> {
    const mergedData = data ? JSON.parse(JSON.stringify(data)) as TableDataObject_ACU : null;
    this._resetRuntimeForLoad_ACU();

    // 启动自检（fail-loud）：拼音物理名冲突必须在建表前拦截，给出可读的改名指引，
    // 而不是等到 hydrate 时被 generic catch 吞成 sqlite_hydrate_failed。
    if (mergedData) {
      try {
        assertNoPhysicalTableNameCollision_ACU(mergedData);
      } catch (e: any) {
        if (e instanceof PhysicalTableNameCollisionError_ACU) {
          this._resetRuntimeForLoad_ACU();
          logError_ACU(`[SqlTableService] ${e.message}`);
          return { loaded: false, source: 'empty', error: `physical_table_name_collision: ${e.message}` };
        }
        throw e;
      }
    }

    try {
      await this.engine.init();
    } catch (e: any) {
      const errMsg = e?.message || String(e);
      this._resetRuntimeForLoad_ACU();
      logError_ACU(`[SqlTableService] SQLite 引擎初始化失败: ${errMsg}`);
      return { loaded: false, source: 'empty', error: `sqlite_engine_init_failed: ${errMsg}` };
    }

    try {
      // 判断 mergedData 是否包含真正的用户/AI 写入的数据行，还是仅有模板空壳。
      const hasRealDataRows = mergedData && Object.keys(mergedData)
        .filter(k => k.startsWith('sheet_'))
        .some(k => {
          const sheet = (mergedData as any)[k];
          if (!sheet?.content || !Array.isArray(sheet.content) || sheet.content.length <= 1) return false;
          if (sheet._acu_from_base_state) return false;
          return true;
        });

      if (!mergedData || !hasRealDataRows) {
        const runtimeSeedSource = mergedData;
        const runtimeSeedData = this._buildInitialRuntimeTableData_ACU(runtimeSeedSource);
        if (runtimeSeedData) {
          this.syncBridge.loadFromTableData(runtimeSeedData, { strict: true, allowRuntimeDdlFallback: true });
          this._validateRuntimeSchema_ACU(runtimeSeedData);
          this._publishCanonicalView_ACU(runtimeSeedData);
          if (!this._tryPublishNameMapper_ACU(runtimeSeedData)) {
            throw new Error('name_mapper_publish_rejected: 未能发布当前 runtime 的中英文名映射。');
          }
          this._initialized = true;
          this._existingTableSet = undefined;
          const hasSeedRows = Object.keys(runtimeSeedData)
            .filter(k => k.startsWith('sheet_'))
            .some(k => Array.isArray((runtimeSeedData as any)[k]?.content) && (runtimeSeedData as any)[k].content.length > 1);
          logDebug_ACU(`[SqlTableService] 初始 seedRows 已写入运行时 SQLite: hasSeedRows=${hasSeedRows}`);
          return { loaded: hasSeedRows, source: hasSeedRows ? 'initialized' : 'empty' };
        }

        // 正常空状态：无 error，loaded=false/source=empty，但 Provider 已 ready。
        logDebug_ACU('[SqlTableService] 没有找到表格数据，引擎已就绪，等待第一次填表时从模板建表');
        // runtime 没有任何表可映射。显式标记空 schema，避免同步读门禁把它
        // 误判成「mapper 意外丢失」并按异常反复告警。
        if (!publishGlobalNameMapperEmptySchema_ACU(this.nameMapperOwner_ACU)) {
          throw new Error('name_mapper_publish_rejected: 未能发布空 schema 标记。');
        }
        this._initialized = true;
        this._existingTableSet = undefined;
        return { loaded: false, source: 'empty' };
      }

      this.syncBridge.loadFromTableData(mergedData as TableDataObject_ACU, { strict: true, allowRuntimeDdlFallback: true });
      this._validateRuntimeSchema_ACU(mergedData as TableDataObject_ACU);
      this._publishCanonicalView_ACU(mergedData as TableDataObject_ACU);
      if (!this._tryPublishNameMapper_ACU(mergedData as TableDataObject_ACU)) {
        throw new Error('name_mapper_publish_rejected: 未能发布当前 runtime 的中英文名映射。');
      }
      this._initialized = true;
      this._existingTableSet = undefined;
      logDebug_ACU('[SqlTableService] SQLite 数据库加载完成');
      return { loaded: true, source: 'merged' };
    } catch (e: any) {
      const errMsg = e?.message || String(e);
      this._resetRuntimeForLoad_ACU();
      logError_ACU(`[SqlTableService] SQLite 快照加载失败: ${errMsg}`);
      return { loaded: false, source: 'empty', error: `sqlite_hydrate_failed: ${errMsg}` };
    }
  }

  /**
   * 禁止 provider 自行把运行时数据写入聊天记录。
   * 所有写入必须通过 table-update-commit 公共提交模型完成。
   */
  async saveToChat(
    _targetSheetKeys?: string[] | null,
    _updateGroupKeys?: string[] | null,
    _trackingSheetKeys?: string[] | null,
    _options?: { source?: string; requestId?: string; batchId?: string; operations?: unknown[]; transactionContext?: unknown },
  ): Promise<{ saved: boolean; messageIndex?: number; error?: string }> {
    const message = 'SqlTableService.saveToChat is disabled; use table update commit model.';
    logError_ACU(`[SqlTableService] ${message}`);
    return { saved: false, error: message };
  }

  async replaceAllData(data: TableDataObject_ACU): Promise<ApplyEditsResult> {
    // 替换失败不得把本实例数据永久留在共享 canonical 视图里。
    const previousJsonView = this._readCanonicalView_ACU();
    let ownJsonView: TableDataObject_ACU | null = null;
    try {
      const cloned = JSON.parse(JSON.stringify(data || {})) as TableDataObject_ACU;
      this._releaseNameMapperIfShared_ACU();
      this.engine.dispose();
      this.engine = new SqliteEngine();
      this.syncBridge = new SyncBridge(this.engine);
      await this.engine.init();
      this.syncBridge.loadFromTableData(cloned, { strict: true });
      this._publishCanonicalView_ACU(cloned);
      ownJsonView = cloned;
      if (!this._tryPublishNameMapper_ACU(cloned)) {
        throw new Error('name_mapper_publish_rejected: 未能发布替换后 runtime 的中英文名映射。');
      }
      this._initialized = true;
      this._existingTableSet = undefined;
      const modifiedKeys = Object.keys(cloned).filter(key => key.startsWith('sheet_'));
      logDebug_ACU(`[SqlTableService] 运行时全量替换完成: tables=${modifiedKeys.length}`);
      return { success: true, modifiedKeys, appliedEdits: modifiedKeys.length };
    } catch (e: any) {
      const message = e?.message || String(e);
      // 替换失败后本实例没有可信 runtime；不得保留旧的 initialized 标志冒充可用。
      this._initialized = false;
      this._existingTableSet = undefined;
      this._revertOwnJsonView_ACU(ownJsonView, previousJsonView);
      this._releaseNameMapperIfShared_ACU();
      logError_ACU(`[SqlTableService] 运行时全量替换失败: ${message}`);
      return { success: false, modifiedKeys: [], appliedEdits: 0, error: message };
    }
  }

  clearRuntimeData(): void {
    this.engine.dispose();
    this.engine = new SqliteEngine();
    this.syncBridge = new SyncBridge(this.engine);
    this._initialized = false;
    this._existingTableSet = undefined;
    this._publishCanonicalView_ACU(null);
    this._releaseNameMapperIfShared_ACU();
  }

  /**
   * 获取当前运行时的完整表格数据
   * 从 SQLite 导出最新状态，同步更新 JSON 视图后返回
   */
  getCurrentData(): TableDataObject_ACU | null {
    if (!this._initialized || !this.engine.isReady) {
      return this._readCanonicalView_ACU();
    }

    try {
      const mate = (this._readCanonicalView_ACU()?.mate as Mate_ACU) || { type: 'acu', version: 1, updateConfigUiSentinel: 0, globalInjectionConfig: { readableEntryPlacement: { position: '', depth: 0, order: 0 }, wrapperPlacement: { position: '', depth: 0, order: 0 } } };
      const exportedData = this.syncBridge.exportToTableData(mate);
      this._publishCanonicalView_ACU(exportedData);
      return exportedData;
    } catch (e: any) {
      logError_ACU(`[SqlTableService] getCurrentData 失败: ${e?.message}`);
      return this._readCanonicalView_ACU();
    }
  }

  /**
   * 应用 AI 返回的 SQL 编辑指令
   * 1. 拆分多条 SQL 语句
   * 2. 事务包裹执行（runBatch）
   * 3. 同步到 JSON 视图
   * 4. 返回结果
   *
   * 失败时抛出包含详细报错的 Error，供上层重试循环捕获
   */
  applyEdits(sqlStatements: string, _updateMode?: string): ApplyEditsResult {
    return this.applyEditsBatch([sqlStatements], _updateMode);
  }

  applyEditsBatch(sqlTexts: string[], _updateMode?: string, paramsList?: (string | number | null)[][]): ApplyEditsResult {
    this._ensureInitialized();
    this._ensureTablesFromTemplate();

    const userStatements: string[] = [];
    const userParams: ((string | number | null)[] | undefined)[] = [];
    (Array.isArray(sqlTexts) ? sqlTexts : []).forEach((sqlText, index) => {
      const normalizedStatements = normalizeSqlStatementsForRuntimeLog_ACU(sqlText);
      const runtimeStatements = rebindSqlMutationIdentifiers_ACU(
        normalizedStatements,
        (this._readCanonicalView_ACU() || { mate: DEFAULT_MATE_ACU }) as TableDataObject_ACU,
      );
      runtimeStatements.forEach(statement => {
        userStatements.push(statement);
        userParams.push(runtimeStatements.length === 1 ? paramsList?.[index] : undefined);
      });
    });
    if (userStatements.length === 0) {
      return { success: true, modifiedKeys: [], appliedEdits: 0 };
    }

    // [阶段 E] 不再在 AI 写路径前置 reseed：seed 数据已在 loadFromData →
    // _buildInitialRuntimeTableData_ACU 建表时物化；此处再补种会与 AI INSERT 双写 UNIQUE 业务键。
    const statements = userStatements;
    const statementParams = userParams;

    try {
      const result = this.engine.runBatch(statements, statementParams);
      this._syncToJson();

      const modifiedTables = extractTableNamesFromStatements(statements);
      const modifiedKeys = this._tableNamesToSheetKeys(modifiedTables);

      logDebug_ACU(`[SqlTableService] SQL 批量执行成功: ${statements.length} 条语句, ${result.totalChanges} 行受影响`);

      return {
        success: true,
        modifiedKeys,
        appliedEdits: userStatements.length,
      };
    } catch (e: any) {
      const errMsg = e?.message || String(e);
      logError_ACU(`[SqlTableService] SQL 批量执行失败: ${errMsg}`);
      throw e;
    }
  }

  applyEditsWithSystemRowIds(
    sqlTexts: string[],
    _updateMode?: string,
    scope?: SqlTableApplyScope_ACU,
  ): ApplyEditsWithRowIdMaterializationResult_ACU {
    // 请求级冻结 runtime schema 是本轮写路径的 schema 权威；提交前必须确认
    // live SQLite 与其一致。若 AI 等待期间 schema 漂移，零 mutation 中止。
    this._assertRuntimeSchemaCurrent(scope);
    this._ensureInitialized();
    this._ensureTablesFromTemplate(scope);

    const normalizedGroups = (Array.isArray(sqlTexts) ? sqlTexts : []).map(sqlText => {
      const normalizedStatements = normalizeSqlStatementsForRuntimeLog_ACU(sqlText);
      return rebindSqlMutationIdentifiers_ACU(
        normalizedStatements,
        (scope?.runtimeData || this._readCanonicalView_ACU() || { mate: DEFAULT_MATE_ACU }) as TableDataObject_ACU,
        scope?.templateData,
        { requireKnownTables: Boolean(scope?.templateData), requireKnownInsertColumns: true },
      );
    });
    const userStatements = normalizedGroups.flat();
    if (userStatements.length === 0) {
      return {
        success: true,
        modifiedKeys: [],
        appliedEdits: 0,
        materializedSqlTexts: normalizedGroups.map(() => ''),
        tableData: this._exportCurrentDataStrict(),
      };
    }

    // [阶段 E] AI 写路径不再 reseed（seed 已在 loadFromData 建表时物化）。
    // 保留空 row_id 预留 Map：materializeSystemRowIdsForSqlInserts_ACU 仍会从
    // runtimeData 自身构建预留，此处无新增预留。
    const reseedPlan: { inserts: string[]; rowIdsByTable: Map<string, Set<string>> } = { inserts: [], rowIdsByTable: new Map<string, Set<string>>() };
    const runtimeData = this._exportCurrentDataStrict();
    let materializedStatements: string[];
    try {
      materializedStatements = materializeSystemRowIdsForSqlInserts_ACU(
        userStatements,
        runtimeData,
        reseedPlan.rowIdsByTable,
        // INSERT…SELECT/WITH 先执行后物化：SELECT 在当前 live 引擎（本批 mutation
        // 执行前的快照）上预执行，物化文本即回放事实来源。
        { selectQueryRunner: (sql: string) => this.engine.query(sql) },
      );
    } catch (error: any) {
      throw new SqlRowIdMaterializationError_ACU(error?.message || String(error));
    }

    const materializedSqlTexts: string[] = [];
    let cursor = 0;
    for (const group of normalizedGroups) {
      // 空串 = INSERT SELECT 结果为空被物化成无操作，不进日志文本。
      materializedSqlTexts.push(materializedStatements.slice(cursor, cursor + group.length).filter(Boolean).join(';\n'));
      cursor += group.length;
    }

    const statements = [...reseedPlan.inserts, ...materializedStatements.filter(Boolean)];
    try {
      const result = this.engine.runBatchWithFinalize(
        statements,
        statements.map((): undefined => undefined),
        () => this._exportCurrentDataStrict(),
      );
      const tableData = result.finalizeResult!;
      this._publishCanonicalView_ACU(tableData);
      const modifiedTables = extractTableNamesFromStatements(statements);
      const modifiedKeys = this._tableNamesToSheetKeys(modifiedTables);
      logDebug_ACU(`[SqlTableService] 系统 row_id 批量执行成功: ${statements.length} 条语句, ${result.totalChanges} 行受影响`);
      return {
        success: true,
        modifiedKeys,
        appliedEdits: materializedStatements.length,
        materializedSqlTexts,
        tableData,
      };
    } catch (e: any) {
      logError_ACU(`[SqlTableService] 系统 row_id 批量执行失败: ${e?.message || String(e)}`);
      throw e;
    }
  }

  /**
   * 执行 SQL 查询（SELECT）
   *
   * 注意：不触发 _ensureTablesFromTemplate()。
   * 新开卡场景下表尚未创建，查询会抛出 "no such table" 错误——这是预期行为。
   * 建表只在写操作（applyEdits/executeMutation）时触发，确保用户有机会在首次填表前修改表结构。
   */
  executeQuery(
    sql: string,
    params?: (string | number | null)[],
    options?: SqlQueryExecutionOptions_ACU,
  ): SqlQueryResult {
    this._ensureInitialized();
    const result = this.engine.query(sql, params, options);
    return {
      columns: result.columns,
      values: result.values,
      rowCount: result.values.length,
    };
  }

  /**
   * 执行 SQL 变更语句（INSERT/UPDATE/DELETE）
   * 执行后自动同步到 JSON 视图
   */
  executeMutation(sql: string, params?: (string | number | null)[]): SqlMutationResult {
    this._ensureInitialized();
    this._ensureTablesFromTemplate();
    try {
      // 对 SQL 做规范化：结构字符兼容化 + 受约束字段值规范化
      const normalizedSql = normalizeStatementValues(normalizeSqlStructure(sql));
      const runtimeSql = rebindSqlMutationIdentifiers_ACU(
        [normalizedSql],
        (this._readCanonicalView_ACU() || { mate: DEFAULT_MATE_ACU }) as TableDataObject_ACU,
      )[0];
      const result = this.engine.run(runtimeSql, params);
      this._syncToJson();
      return { changes: result.changes, errors: [] };
    } catch (e: any) {
      // 同步 JSON 视图避免 SQLite/JSON 状态分裂
      this._syncToJson();
      return { changes: 0, errors: [e?.message || String(e)] };
    }
  }

  /**
   * 销毁数据库实例，释放内存
   */
  dispose(): void {
    this.engine.dispose();
    // 本实例可能已被更新的 runtime 置换。只释放自己发布的映射，
    // 否则会把新 runtime 刚发布的 schema 映射清成 unbound。
    this._releaseNameMapperIfShared_ACU();
    this._initialized = false;
    this._existingTableSet = undefined;
    logDebug_ACU('[SqlTableService] SQLite 引擎已销毁');
  }

  // ═══════════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════════

  /**
   * 撤回本实例写入共享 canonical 视图的内容。
   *
   * 只有当共享视图仍是本实例写入的那一份时才回退：等待期间其他实例可能已经
   * 合法发布了新视图，无条件写回旧值会把它们的更新覆盖掉。
   */
  private _revertOwnJsonView_ACU(
    ownView: TableDataObject_ACU | null,
    previousView: TableDataObject_ACU | null,
  ): void {
    if (!ownView || this._readCanonicalView_ACU() !== ownView) return;
    this._publishCanonicalView_ACU(previousView);
  }


  /** 重置本实例的 SQLite runtime；不触碰调用方持有的 canonical JSON 快照。 */
  private _resetRuntimeForLoad_ACU(): void {
    // 新 runtime 在成功 hydrate 前没有可证明匹配的 schema；保留旧 mapper
    // 会让并发/重载后的外部 CRUD 把展示列解析到上一份 SQLite schema。
    // 只撤销本实例发布的映射：其他实例的映射由其自身生命周期负责。
    this._releaseNameMapperIfShared_ACU();
    this.engine.dispose();
    this.engine = new SqliteEngine();
    this.syncBridge = new SyncBridge(this.engine);
    this._initialized = false;
    this._existingTableSet = undefined;
  }

  private _buildInitialRuntimeTableData_ACU(sourceData: TableDataObject_ACU | null): TableDataObject_ACU | null {
    const shouldIncludeSeedRows = shouldUseInitialSeedRows_ACU();
    const templateData = this._resolveCurrentChatTemplate(!shouldIncludeSeedRows);
    const baseData = sourceData
      ? JSON.parse(JSON.stringify(sourceData)) as TableDataObject_ACU
      : templateData;
    if (!baseData || typeof baseData !== 'object') return null;

    if (templateData && typeof templateData === 'object') {
      for (const key of Object.keys(templateData).filter(k => k.startsWith('sheet_'))) {
        const templateSheet = (templateData as any)[key];
        if (!templateSheet || typeof templateSheet !== 'object') continue;
        // 非首列空业务表头的模板表在 SQL 活动路径中休眠跳过：不复制进初始运行时数据，
        // 避免建表/校验阶段对坏表头触发 fallback DDL 报错；既有同 key 运行时数据保留。
        if (!isSqlActiveTemplateSheet_ACU(templateSheet)) continue;
        const targetSheet = (baseData as any)[key];
        if (!targetSheet || typeof targetSheet !== 'object') continue;
        if (templateSheet.uid) targetSheet.uid = templateSheet.uid;
        if (templateSheet.name) targetSheet.name = templateSheet.name;
        if (templateSheet.sourceData && typeof templateSheet.sourceData === 'object') targetSheet.sourceData = JSON.parse(JSON.stringify(templateSheet.sourceData));
        if (templateSheet.updateConfig && typeof templateSheet.updateConfig === 'object') targetSheet.updateConfig = JSON.parse(JSON.stringify(templateSheet.updateConfig));
        if (templateSheet.exportConfig && typeof templateSheet.exportConfig === 'object') targetSheet.exportConfig = JSON.parse(JSON.stringify(templateSheet.exportConfig));
        if (templateSheet.orderNo !== undefined) targetSheet.orderNo = templateSheet.orderNo;
        if (Array.isArray(templateSheet.content?.[0])) {
          if (!Array.isArray(targetSheet.content)) targetSheet.content = [];
          targetSheet.content[0] = JSON.parse(JSON.stringify(templateSheet.content[0]));
        }
      }
    }

    let hasSheet = false;
    for (const key of Object.keys(baseData).filter(k => k.startsWith('sheet_'))) {
      const sheet = (baseData as any)[key];
      if (!sheet || typeof sheet !== 'object') continue;
      // 初始运行时数据同样不携带休眠表：坏表头表不进入 runtimeData，
      // 既不会被 _validateRuntimeSchema_ACU 校验，也不会在 _buildNameMapper 引爆。
      if (!isSqlActiveTemplateSheet_ACU(sheet)) continue;
      hasSheet = true;
      delete sheet._acu_from_base_state;

      const headerRow = Array.isArray(sheet.content?.[0]) ? sheet.content[0] : ['row_id'];
      if (!Array.isArray(sheet.content) || sheet.content.length <= 1) {
        const seedRows = getEffectiveSeedRowsForSheet_ACU(key, { allowTemplateFallback: true });
        // [阶段 E] seed 物化前唯一键预检：从 DDL 提取业务 UNIQUE 组，剔除与
        // 既有数据（baseData 已携带的行）重复的 seedRows，避免建表时双写同一业务键。
        // 不允许依赖 SQLite 失败后再由 AI 猜测。
        let materializedSeedRows = Array.isArray(seedRows) ? seedRows : [];
        const existingContent = Array.isArray(sheet.content) ? sheet.content : [];
        const existingDataRows = existingContent.length > 1 ? existingContent.slice(1) : [];
        const ddl = String(sheet?.sourceData?.ddl || '');
        const businessKeyGroups = ddl ? extractBusinessKeyColumns_ACU(ddl) : [];
        if (businessKeyGroups.length > 0 && existingDataRows.length > 0) {
          const headerIndex = new Map<string, number>();
          headerRow.forEach((cell: unknown, index: number) => {
            const name = String(cell ?? '').trim().toLowerCase();
            if (name && !headerIndex.has(name)) headerIndex.set(name, index);
          });
          const rowKey = (row: unknown[], group: string[]): string | null => {
            if (!Array.isArray(row)) return null;
            const parts: string[] = [];
            for (const col of group) {
              const idx = headerIndex.get(col.toLowerCase());
              if (idx === undefined || idx >= row.length) return null;
              parts.push(String(row[idx] ?? ''));
            }
            return parts.join('\u0001');
          };
          const existingKeySet = new Set<string>();
          for (const row of existingDataRows) {
            for (const group of businessKeyGroups) {
              const key = rowKey(row, group);
              if (key !== null) existingKeySet.add(key);
            }
          }
          if (existingKeySet.size > 0) {
            const unique = materializedSeedRows.filter((row: unknown[]) => {
              for (const group of businessKeyGroups) {
                const key = rowKey(row, group);
                if (key !== null && existingKeySet.has(key)) return false;
              }
              return true;
            });
            if (unique.length !== materializedSeedRows.length) {
              logWarn_ACU(`[SqlTableService] 表 ${key} (${sheet.name}) seed 物化预检剔除 ${materializedSeedRows.length - unique.length} 行与既有数据重复的 UNIQUE 业务键行`);
            }
            materializedSeedRows = unique;
          }
        }
        sheet.content = [headerRow, ...materializedSeedRows];
      }
      sheet.content = ensureStableRowIdsForSheetContent_ACU(sheet.content);
    }

    return hasSheet ? baseData : null;
  }


  private _exportCurrentDataStrict(): TableDataObject_ACU {
    try {
      const mate = (this._readCanonicalView_ACU()?.mate as Mate_ACU) || DEFAULT_MATE_ACU;
      return this.syncBridge.exportToTableData(mate, { strict: true });
    } catch (error: any) {
      throw new SqlRuntimeSnapshotError_ACU(error?.message || String(error));
    }
  }


  /**
   * hydrate 成功不等于 runtime 可用：必须确认当前数据对应的物理表和有效列都已真正落入 SQLite。
   * 这里不修复、不建表；缺表/缺列说明 hydrate 或模板契约已损坏，应在发布 ready 前 fail-closed。
   */
  private _validateRuntimeSchema_ACU(data: TableDataObject_ACU): void {
    const actualTables = new Set(this.engine.getTableNames());
    for (const key of Object.keys(data).filter(key => key.startsWith('sheet_'))) {
      const sheet = (data as any)[key];
      if (!sheet || typeof sheet !== 'object') continue;
      // 休眠表（非首列空业务表头）不参与 runtime schema 校验：它们不建表、不进 SQLite，
      // 校验它们只会误报 schema_missing_table。
      if (!isSqlActiveTemplateSheet_ACU(sheet)) continue;
      const runtimeTableName = getPhysicalTableNameForSheet_ACU(data, key);
      if (!actualTables.has(runtimeTableName)) {
        throw new Error(`schema_missing_table: ${key} (${runtimeTableName}) 未在 SQLite runtime 中创建。`);
      }
      const effectiveDDL = resolveEffectiveDDL(sheet, sheet.uid || key, runtimeTableName);
      const actualColumns = new Set(this.engine.getTableInfo(runtimeTableName).map(column => column.name));
      for (const mapping of effectiveDDL.columnMap.mappings) {
        if (!actualColumns.has(mapping.sqlName)) {
          throw new Error(`schema_missing_column: ${key} (${runtimeTableName}).${mapping.sqlName} 未在 SQLite runtime 中创建。`);
        }
      }
    }
  }

  /**
   * 从 TableDataObject 中提取所有 DDL，以本实例身份发布全局 NameMapper。
   *
   * @returns 是否已发布可信映射。false 表示本实例不得对外宣称 ready：
   * 没有可信映射时中文表名/列名会被原样下发给 SQLite。
   */
  private _buildNameMapper(data: TableDataObject_ACU): boolean {
    try {
      const ddlMap = new Map<string, string>();
      for (const [key, value] of Object.entries(data)) {
        if (!key.startsWith('sheet_')) continue;
        const sheet = value as any;
        if (!sheet || typeof sheet !== 'object') continue;
        // 休眠表（非首列空业务表头）不参与 NameMapper：它们不在 SQLite runtime 中，
        // 构建映射会对坏表头触发 fallback DDL 报错。
        if (!isSqlActiveTemplateSheet_ACU(sheet)) continue;
        // NameMapper 必须和 SQLite 实际采用的 schema 一致。直接读取 sourceData.ddl
        // 会在 fallback_invalid 场景留下无法映射运行时物理列名的陈旧映射。
        const runtimeTableName = getPhysicalTableNameForSheet_ACU(data, key);
        const effectiveDDL = resolveEffectiveDDL(sheet, sheet.uid || key, runtimeTableName).effectiveDDL;
        ddlMap.set(runtimeTableName, effectiveDDL);
      }
      return publishGlobalNameMapperForDDLs_ACU(ddlMap, this.nameMapperOwner_ACU);
    } catch (e: any) {
      logWarn_ACU(`[SqlTableService] 构建 NameMapper 失败: ${e?.message}`);
      return false;
    }
  }

  /**
   * 同步 SQLite → JSON 视图。
   *
   * @returns 本次实际写入共享视图的对象；导出失败时返回 null。
   * 多数调用点把它当尽力而为的视图刷新，但快照恢复必须据此判断能否发布映射，
   * 并据此确认「共享视图是否由本次调用写入」。不能改为读取全局值反推所有权：
   * 等待期间其他实例可能已经发布了自己的视图。
   */
  private _syncToJson(): TableDataObject_ACU | null {
    try {
      const mate = (this._readCanonicalView_ACU()?.mate as Mate_ACU) || { type: 'acu', version: 1, updateConfigUiSentinel: 0, globalInjectionConfig: { readableEntryPlacement: { position: '', depth: 0, order: 0 }, wrapperPlacement: { position: '', depth: 0, order: 0 } } };
      const exportedData = this.syncBridge.exportToTableData(mate);
      this._publishCanonicalView_ACU(exportedData);
      return exportedData;
    } catch (e: any) {
      logError_ACU(`[SqlTableService] syncToJson 失败: ${e?.message}`);
      return null;
    }
  }

  /** 将 SQL 表名映射为 sheetKey */
  private _tableNamesToSheetKeys(tableNames: string[]): string[] {
    const view = this._readCanonicalView_ACU();
    if (!view) return [];
    const keys: string[] = [];
    for (const key of Object.keys(view)) {
      if (!key.startsWith('sheet_')) continue;
      const runtimeTableName = getPhysicalTableNameForSheet_ACU(view, key);
      if (tableNames.includes(runtimeTableName)) keys.push(key);
    }
    return keys;
  }

  /** 确保引擎已初始化 */
  private _ensureInitialized(): void {
    if (!this._initialized || !this.engine.isReady) {
      throw new Error('[SqlTableService] SQLite 引擎未初始化，请先调用 loadFromChat()');
    }
  }

  /**
   * 提交前 schema 一致性 gate：live SQLite runtime 与请求前冻结的 runtime schema
   * 必须一致，否则任何 SQLite mutation 都不得执行（fail-closed，零写入）。
   *
   * 比较依据是冻结 digest 与当前实时导出（仅 activeSheetKeys 参与）的 digest。
   * 无冻结 scope 时跳过（旧调用方/低层工具路径），不收紧 Native 与历史 replay。
   */
  private _assertRuntimeSchemaCurrent(scope?: SqlTableApplyScope_ACU): void {
    const frozenDigest = scope?.runtimeSchema?.digest;
    if (!frozenDigest) return; // 无冻结 schema：兼容旧调用方，不做 gate。
    if (!this._initialized || !this.engine.isReady) {
      throw new SqlRuntimeSchemaInvalidError_ACU('SQLite 运行时未就绪，无法验证冻结 schema 一致性，已阻止本轮写入。');
    }
    let currentData: TableDataObject_ACU | null;
    try {
      const mate = (this._readCanonicalView_ACU()?.mate as Mate_ACU) || DEFAULT_MATE_ACU;
      currentData = this.syncBridge.exportToTableData(mate);
    } catch (error: any) {
      throw new SqlRuntimeSchemaInvalidError_ACU(`无法导出当前 SQLite schema 用于一致性验证：${String(error?.message || error)}`);
    }
    const activeSheetKeys = scope?.activeSheetKeys ? new Set(scope.activeSheetKeys) : undefined;
    const current = freezeRuntimeSchemaFromData_ACU(currentData, activeSheetKeys);
    if (!current || current.digest !== frozenDigest) {
      throw new SqlRuntimeSchemaStaleError_ACU(
        'SQLite runtime schema 在 AI 请求等待期间发生变化，与请求前冻结的 schema 不一致，已阻止本轮写入（零 mutation）。请重新发起本轮填表。',
      );
    }
  }

  /**
   * 按需建表：在写操作（applyEdits/executeMutation）前，检查当前聊天模板中的表是否都已存在于 SQLite。
   *
   * 仅在写操作时调用，不在只读查询（executeQuery）时调用。
   * 这样新开卡场景下，用户可以在首次填表前自由修改表结构（DDL），
   * 直到 AI 真正往表里写数据时才锁定表结构并建表。
   *
   * 三种场景：
   * 1. 新卡第一次填表：SQLite 中无任何用户表 → 全量建表
   * 2. 老卡正常运行：所有表都已存在 → 直接返回（幂等）
   * 3. 中途加表：模板中新增了一张表，但 SQLite 中没有 → 只建缺失的表
   *
    * 模板来源优先级：
    * 1. 当前聊天的 chat_override 模板快照
    * 2. 全局模板（inherit_global 或无聊天级模板时的 fallback）
    *
    * 旧版 preset_link 会在 getCurrentChatTemplateScopeState_ACU() 读取时物化为 chat_override。
   *
   * DDL 来源优先级：
   * 1. currentJsonTableData_ACU 中的 sourceData.ddl（可能来自指导表，包含用户在可视化编辑器中的修改）
   * 2. 当前聊天模板中的 sourceData.ddl（fallback）
   */
  private _ensureTablesFromTemplate(scope?: SqlTableApplyScope_ACU): void {
    const existingTables = new Set(this.engine.getTableNames());

    // [修复] 优先从当前聊天模板预设获取模板，而不是依赖全局变量 TABLE_TEMPLATE_ACU
    // 这样确保建表时只使用当前聊天模板预设的内容，不会混入全局模板的表
    const templateData = scope?.templateData || this._resolveCurrentChatTemplate();
    if (!templateData) {
      if (existingTables.size > 0) return;
      throw new Error('[SqlTableService] 模板解析失败，无法建表。请检查模板格式。');
    }

    // 建表前自检：模板内拼音物理名冲突直接 fail-loud，避免建表途中报晦涩的 SQL 错误。
    assertNoPhysicalTableNameCollision_ACU(templateData);

    // 收集当前聊天模板中所有有效表的 sheetKey 和表名，找出 SQLite 中缺失的。
    // 非首列空业务表头的模板表在 SQL 活动路径中休眠跳过：不建表、不注入 seedRows、
    // 不合并进 currentJsonTableData_ACU；既有同 key 运行时数据保留，修正表头后可恢复。
    const sheetKeys = Object.keys(templateData).filter(k => {
        if (!k.startsWith('sheet_')) return false;
        const sheet = (templateData as any)[k];
        return isSqlActiveTemplateSheet_ACU(sheet);
    });
    const missingSheets: Record<string, any> = {};

    for (const key of sheetKeys) {
      // 当前聊天模板是建表结构权威；currentJsonTableData_ACU 可能是旧运行时快照，不能让旧 DDL/CHECK 覆盖模板。
      const liveSheet = (this._readCanonicalView_ACU() as any)?.[key];
      const sheet = (templateData[key] as any) || liveSheet;
      if (!sheet) continue;
      const runtimeTableName = getPhysicalTableNameForSheet_ACU(templateData, key);
      if (!existingTables.has(runtimeTableName)) {
        missingSheets[key] = sheet;
      }
    }

    // 所有表都已存在，无需建表
    if (Object.keys(missingSheets).length === 0) {
      // 不能因物理表已存在就跳过映射同步：删楼回滚/模板切换可重建
      // SQLite runtime，却不会制造缺表；此时外部 CRUD 仍需当前 schema 的列映射。
      if (!this._tryPublishNameMapper_ACU(this._readCanonicalView_ACU() || templateData)) {
        throw new Error('name_mapper_publish_rejected: 未能发布当前 schema 的中英文名映射，已阻止后续写入。');
      }
      return;
    }

    logDebug_ACU(`[SqlTableService] 发现 ${Object.keys(missingSheets).length} 张缺失表，按需建表: ${Object.keys(missingSheets).join(', ')}`);

    // 构造只包含缺失表的数据子集，交给 syncBridge 建表
    // [修复] 同时为缺失表注入 seedRows（初始数据），使建表后 SQLite 中包含初版快照
    // 设计文档 Q9 确认：seedRows 是初版快照，应写入 SQLite 作为真实数据
    const partialData: TableDataObject_ACU = { mate: templateData.mate };
    // 建表用的 templateData 已被 stripSeedRows 剥掉数据行，需要一份保留数据行的模板，
    // 用来还原「模板自带数据」的表。作者在模板里写了数据就代表要保留这个格式，
    // 不能只在「首次填表」时才生效（shouldUseInitialSeedRows_ACU 的限定）。
    const templateWithRows = scope?.templateDataWithRows || this._resolveCurrentChatTemplate(false);
    for (const [key, sheet] of Object.entries(missingSheets)) {
      const sheetCopy = JSON.parse(JSON.stringify(sheet));

      // content 只有表头时补数据：模板作者自带的数据行优先，其次才是 guide/seedRows。
      // templateData 已被 stripSeedRows 剥掉数据行，所以必须回到未 strip 的模板取。
      const templateRows = (templateWithRows as any)?.[key]?.content;
      const authoredRows = Array.isArray(templateRows) && templateRows.length > 1
        ? templateRows.slice(1)
        : [];
      const needsRows = !Array.isArray(sheetCopy.content) || sheetCopy.content.length <= 1;
      if (needsRows) {
        const seedRows = authoredRows.length > 0
          ? authoredRows
          : getEffectiveSeedRowsForSheet_ACU(key, { allowTemplateFallback: true });
        if (Array.isArray(seedRows) && seedRows.length > 0) {
          // seedRows 是不含表头的纯数据行，拼接到表头后面
          sheetCopy.content = [sheetCopy.content[0] || [], ...seedRows];
          sheetCopy.content = ensureStableRowIdsForSheetContent_ACU(sheetCopy.content);
          logDebug_ACU(`[SqlTableService] 表 ${key} (${sheetCopy.name}) 注入 ${seedRows.length} 行 seedRows 作为初版快照`);
        }
      } else {
        // content 已带数据行（未被 strip 的路径）：确保 row_id 稳定后直接使用。
        sheetCopy.content = ensureStableRowIdsForSheetContent_ACU(sheetCopy.content);
      }

      (partialData as any)[key] = sheetCopy;
    }
    this.syncBridge.loadFromTableData(partialData, { strict: true, allowRuntimeDdlFallback: true });

    // 合并新建的表到当前 JSON 视图
    const currentView = this._readCanonicalView_ACU();
    if (currentView) {
      for (const [key, sheet] of Object.entries(missingSheets)) {
        (currentView as any)[key] = sheet;
      }
      if (this.isolatedRuntime_ACU) this.isolatedJsonView_ACU = currentView;
    } else {
      this._publishCanonicalView_ACU(templateData);
    }
    if (!this._tryPublishNameMapper_ACU(this._readCanonicalView_ACU() || templateData)) {
      throw new Error('name_mapper_publish_rejected: 建表后未能发布中英文名映射，已阻止后续写入。');
    }

    logDebug_ACU(`[SqlTableService] 按需建表完成，当前共 ${this.engine.getTableNames().length} 张表`);
  }

  /**
   * 解析当前聊天模板预设，返回 stripSeedRows 后的模板对象。
   *
   * 优先级：
   * 1. chat_override —— 当前聊天的专属模板快照
   * 2. inherit_global / 无聊天级模板 —— fallback 到 parseTableTemplateJson_ACU（全局模板）
   *
   * 旧版 preset_link 会在 getCurrentChatTemplateScopeState_ACU() 读取时物化为 chat_override；
   * 这里保留 preset_link 分支只是兼容异常情况下未能写回迁移的旧存档。
   */
  private _resolveCurrentChatTemplate(stripSeedRows = true): TableDataObject_ACU | null {
    try {
      const scopeState = getCurrentChatTemplateScopeState_ACU();

      if (scopeState) {
        let templateStr: string | null = null;

        if (scopeState.mode === 'chat_override' && scopeState.templateStr) {
          // 场景 1：当前聊天有专属模板快照
          templateStr = scopeState.templateStr;
        } else if (scopeState.mode === 'preset_link' && scopeState.presetName) {
          // 旧版兼容兜底：正常读取时已物化为 chat_override。
          const preset = getTemplatePreset_ACU(scopeState.presetName);
          if (preset?.templateStr) {
            templateStr = preset.templateStr;
          }
        }

        if (templateStr) {
          const parsed = safeJsonParse_ACU(templateStr, null);
          if (parsed && typeof parsed === 'object') {
                  const cloned = JSON.parse(JSON.stringify(parsed));
                  const resolved = stripSeedRows ? stripSeedRowsFromTemplate_ACU(cloned) : cloned;
                  logDebug_ACU(`[SqlTableService] 使用当前聊天模板预设 (mode=${scopeState.mode})`);
                  return resolved as TableDataObject_ACU;
          }
        }
      }
    } catch (e: any) {
      logWarn_ACU(`[SqlTableService] 获取当前聊天模板快照失败，fallback 到全局模板: ${e?.message}`);
    }

    // 场景 3：inherit_global 或无聊天级模板，fallback 到全局模板
    logDebug_ACU('[SqlTableService] 使用全局模板 (inherit_global)');
    return parseTableTemplateJson_ACU({ stripSeedRows }) as TableDataObject_ACU | null;
  }
}

// ═══════════════════════════════════════════════════════════════
// 快照级 SQL 应用（用于 grouped unified commit）
// ═══════════════════════════════════════════════════════════════

/**
 * SQL 执行后的锁定差异回滚：对比执行前后快照，锁定目标被改则生成补偿 SQL，
 * 在同一引擎会话内执行并返回补偿语句（调用方必须把它们追加进持久化语句集，
 * 否则 storage frame V2 冷回放重放原始 SQL 时锁定目标会再次被改）。
 */
function enforceTableLocksAfterSqlApply_ACU(
  engine: SqliteEngine,
  syncBridge: SyncBridge,
  beforeData: TableDataObject_ACU,
  interimData: TableDataObject_ACU,
  modifiedKeys: readonly string[],
): { workingData: TableDataObject_ACU; statements: string[]; reverted: LockRevertItem_ACU[] } {
  const allStatements: string[] = [];
  const allReverted: LockRevertItem_ACU[] = [];
  let physicalNames: ReadonlyMap<string, string> | null = null;

  for (const sheetKey of modifiedKeys) {
    const beforeSheet = (beforeData as any)?.[sheetKey];
    const beforeContent = beforeSheet?.content;
    if (!Array.isArray(beforeContent) || !Array.isArray(beforeContent[0])) continue;
    // 身份锁按执行前快照解析：legacy 索引锁在此处按前像内容完成惰性迁移。
    const identities = getTableLockIdentitiesForSheet_ACU(sheetKey, beforeContent);
    if (!identities.hasAny) continue;

    if (!physicalNames) physicalNames = resolvePhysicalTableNames_ACU(beforeData);
    const physicalTableName = physicalNames.get(sheetKey);
    if (!physicalTableName) {
      logWarn_ACU(`[SqlTableService] 锁定回滚跳过表 ${sheetKey}：无法解析物理表名。`);
      continue;
    }
    // 列映射用执行前快照的 effective DDL 重算（与 hydrate 使用同一函数同一输入），
    // 被 DROP 的锁定列也能取到物理列名与声明类型。
    const resolvedDdl = resolveEffectiveDDL(beforeSheet, beforeSheet.uid || sheetKey, physicalTableName);
    const { chineseToSql } = buildColumnNameMap(resolvedDdl.effectiveDDL);
    const physicalColTypes = new Map<string, string | null>(
      parseDDLColumnInfos_ACU(resolvedDdl.effectiveDDL).map(info => [info.sqlName, info.declaredType]),
    );
    const afterContent = (interimData as any)?.[sheetKey]?.content;
    const plan = buildLockRevertPlanForSheet_ACU({
      sheetKey,
      displayTableName: String(beforeSheet.name || sheetKey),
      physicalTableName,
      beforeContent,
      afterContent: Array.isArray(afterContent) ? afterContent : null,
      identities,
      displayToPhysicalCol: chineseToSql,
      physicalColTypes,
    });
    allStatements.push(...plan.statements);
    allReverted.push(...plan.reverted);
  }

  if (allStatements.length === 0) {
    return { workingData: interimData, statements: [], reverted: [] };
  }
  engine.runBatch(allStatements);
  const workingData = syncBridge.exportToTableData(resolveSnapshotMate_ACU(beforeData), { strict: true });
  logWarn_ACU(`[SqlTableService] ${formatLockRevertSummary_ACU(allReverted)}`);
  return { workingData, statements: allStatements, reverted: allReverted };
}

export async function applyParameterizedSqlMutationToTableDataSnapshot_ACU(
  sql: string,
  params: (string | number | null)[] | undefined,
  tableData: TableDataObject_ACU,
  operationOptions: SnapshotSqlOperationOptions_ACU = {},
): Promise<SnapshotSqlApplyResult_ACU> {
  const engine = new SqliteEngine();
  const syncBridge = new SyncBridge(engine);
  try {
    const normalizedSql = normalizeStatementValues(normalizeSqlStructure(sql));
    const snapshotCopy = JSON.parse(JSON.stringify(tableData || {})) as TableDataObject_ACU;
    const runtimeSql = rebindSqlMutationIdentifiers_ACU([normalizedSql], snapshotCopy)[0];
    await engine.init();
    syncBridge.loadFromTableData(snapshotCopy, { strict: true });
    const result = engine.run(runtimeSql, params);
    const workingData = syncBridge.exportToTableData(resolveSnapshotMate_ACU(snapshotCopy), { strict: true });
    const modifiedTableNames = extractTableNamesFromStatements([runtimeSql]);
    const modifiedKeys = mapSqlTableNamesToSheetKeys_ACU(workingData, modifiedTableNames);
    const normalizedParams = Array.isArray(params) && params.length > 0 ? params.map(value => value ?? null) : undefined;
    const operationBuild = buildSqlSheetBatchOperations_ACU([runtimeSql], workingData, {
      params: normalizedParams ? [normalizedParams] : undefined,
      fallbackTargetSheetKeys: operationOptions.targetSheetKeys,
      allowSingleTargetFallback: operationOptions.allowSingleTargetFallback === true,
      keepLegacyForUnclassified: true,
      reason: 'system',
    });

    logDebug_ACU(`[SqlTableService] 参数化快照 SQL 执行成功: changes=${result.changes}, modifiedKeys=${modifiedKeys.join(',')}`);
    return {
      success: true,
      modifiedKeys,
      appliedEdits: 1,
      changes: result.changes,
      workingData,
      operations: operationBuild.operations,
    };
  } catch (e: any) {
    const errMsg = e?.message || String(e);
    logError_ACU(`[SqlTableService] 参数化快照 SQL 执行失败: ${errMsg}`);
    return { success: false, modifiedKeys: [], appliedEdits: 0, changes: 0, error: errMsg };
  } finally {
    engine.dispose();
  }
}

export async function applySqlEditsToTableDataSnapshot_ACU(
  sqlStatements: string,
  tableData: TableDataObject_ACU,
  _updateMode?: string,
  operationOptions: SnapshotSqlOperationOptions_ACU = {},
): Promise<SnapshotSqlApplyResult_ACU> {
  const engine = new SqliteEngine();
  const syncBridge = new SyncBridge(engine);
  try {
    const cleaned = sqlStatements.replace(/<!--|-->/g, '').trim();
    if (!cleaned) {
      return { success: true, modifiedKeys: [], appliedEdits: 0, workingData: JSON.parse(JSON.stringify(tableData || {})) };
    }

    const rawStatements = splitSqlStatements(cleaned);
    if (rawStatements.length === 0) {
      return { success: true, modifiedKeys: [], appliedEdits: 0, workingData: JSON.parse(JSON.stringify(tableData || {})) };
    }

    const snapshotCopy = JSON.parse(JSON.stringify(tableData || {})) as TableDataObject_ACU;
    const requireKnownTables = operationOptions.requireSheetScopedOperations === true;
    const reboundStatements = rebindSqlMutationIdentifiers_ACU(
      rawStatements.map(stmt => normalizeStatementValues(normalizeSqlStructure(stmt))),
      snapshotCopy,
      undefined,
      { requireKnownTables, requireKnownInsertColumns: true },
    );
    // 先 hydrate 再物化：INSERT…SELECT/WITH 的 SELECT 预执行需要一个已载入快照的引擎。
    await engine.init();
    syncBridge.loadFromTableData(snapshotCopy, { strict: true });
    const statements = materializeSystemRowIdsForSqlInserts_ACU(reboundStatements, snapshotCopy, undefined, {
      selectQueryRunner: (sql: string) => engine.query(sql),
    }).filter(Boolean);
    engine.runBatch(statements);

    const interimData = syncBridge.exportToTableData(resolveSnapshotMate_ACU(snapshotCopy), { strict: true });
    const modifiedTableNames = extractTableNamesFromStatements(statements);
    const modifiedKeys = mapSqlTableNamesToSheetKeys_ACU(interimData, modifiedTableNames);
    // 锁定差异回滚：前像用调用方传入的 tableData（snapshotCopy 在 rebind/物化中可能
    // 被写入 row_id 预留），补偿语句必须与原始语句一起持久化以保证冷回放一致。
    const lockEnforcement = enforceTableLocksAfterSqlApply_ACU(
      engine,
      syncBridge,
      JSON.parse(JSON.stringify(tableData || {})) as TableDataObject_ACU,
      interimData,
      modifiedKeys,
    );
    const workingData = lockEnforcement.workingData;
    const persistedStatements = lockEnforcement.statements.length > 0
      ? [...statements, ...lockEnforcement.statements]
      : statements;
    const operationBuild = buildSqlSheetBatchOperations_ACU(persistedStatements, workingData, {
      fallbackTargetSheetKeys: operationOptions.targetSheetKeys,
      allowSingleTargetFallback: operationOptions.allowSingleTargetFallback === true,
      keepLegacyForUnclassified: true,
      reason: 'system',
    });


    logDebug_ACU(`[SqlTableService] 快照 SQL 执行成功: ${statements.length} 条语句, modifiedKeys=${modifiedKeys.join(',')}${lockEnforcement.reverted.length > 0 ? `, 锁定回滚 ${lockEnforcement.reverted.length} 处` : ''}`);
    return {
      success: true,
      modifiedKeys,
      appliedEdits: statements.length,
      workingData,
      operations: operationBuild.operations,
      ...(lockEnforcement.reverted.length > 0 ? { revertedByLocks: lockEnforcement.reverted } : {}),
    };
  } catch (e: any) {
    const errMsg = e?.message || String(e);
    logError_ACU(`[SqlTableService] 快照 SQL 执行失败: ${errMsg}`);
    return { success: false, modifiedKeys: [], appliedEdits: 0, error: errMsg };
  } finally {
    engine.dispose();
  }
}

// ═══════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════

/**
 * 按分号拆分 SQL 语句（跳过字符串内的分号）
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];

    if (inString) {
      current += char;
      // 检查字符串结束（处理转义的引号 ''）
      if (char === stringChar) {
        if (i + 1 < sql.length && sql[i + 1] === stringChar) {
          // 转义的引号，跳过
          current += sql[i + 1];
          i++;
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

  // 最后一条语句（可能没有分号结尾）
  const trimmed = current.trim();
  if (trimmed) statements.push(trimmed);

  return statements;
}


/**
 * 从 SQL 语句中提取实际 mutation 目标表。
 * 复用执行边界的 tokenizer，避免字符串、注释或 schema 前缀误导归属。
 */
export function extractTableNamesFromStatements(statements: string[]): string[] {
  const tableNames = new Set<string>();

  for (const stmt of statements) {
    if (typeof stmt !== 'string' || !stmt.trim()) continue;
    try {
      const tokens = tokenizeSqlMutationIdentifiers_ACU(stmt);
      const first = tokens[0];
      if (isSqlMutationKeyword_ACU(first, 'ALTER') && isSqlMutationKeyword_ACU(tokens[1], 'TABLE')) {
        const target = getQualifiedSqlIdentifierTail_ACU(stmt, tokens, 2);
        if (target) tableNames.add(target.value);
        continue;
      }

      const target = getSqlMutationTargetToken_ACU(stmt, tokens);
      tableNames.add(target.value);
    } catch {
      // 本函数只负责归属提取；非法 SQL 由 collect/执行边界给出确定错误。
    }
  }

  return Array.from(tableNames);
}
