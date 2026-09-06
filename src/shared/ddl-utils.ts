/**
 * shared/ddl-utils.ts — DDL 纯解析/操作工具函数
 *
 * 这些函数只做字符串解析，不访问数据库、不读写存储、不依赖任何 data 层基础设施。
 * 所有层（data / service / presentation）均可直接 import。
 */

import { logWarn_ACU } from './utils';
import type { Sheet_ACU } from './models/table-data';

// ═══════════════════════════════════════════════════════════════
// DDL 解析
// ═══════════════════════════════════════════════════════════════

/**
 * 从 DDL 中解析英文表名
 * @param ddl CREATE TABLE 语句
 * @returns 表名，解析失败返回 null
 */
export function parseDDLTableName(ddl: string): string | null {
  const bounds = findCreateTableDefinitionBounds_ACU(String(ddl || ''));
  return bounds?.tableName || null;
}

/**
 * Rebinds only the CREATE TABLE identifier in a parsed DDL statement.
 * It deliberately does not use a broad replacement: literals, comments,
 * constraints and nested expressions must remain byte-for-byte untouched.
 */
export function rebindCreateTableName_ACU(ddl: string, tableName: string): string {
  const value = String(ddl || '');
  const replacement = String(tableName || '').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(replacement)) {
    throw new Error(`无效的 SQLite runtime 表名：${replacement || '(empty)'}`);
  }
  const bounds = findCreateTableDefinitionBounds_ACU(value);
  if (!bounds) throw new Error('无法解析 CREATE TABLE 语句，不能重绑定 runtime 表名。');
  return `${value.slice(0, bounds.tableNameStart)}${replacement}${value.slice(bounds.tableNameEnd)}`;
}

/**
 * 从 DDL 第一行注释中解析中文表名
 * 格式：CREATE TABLE table_name ( -- 中文表名
 * @param ddl CREATE TABLE 语句
 * @returns 中文表名，解析失败返回 null
 */
export function parseDDLChineseName(ddl: string): string | null {
  if (!ddl) return null;
  // 匹配第一行的 -- 注释
  const firstLine = ddl.split('\n')[0];
  const match = firstLine.match(/--\s*(.+?)\s*$/);
  return match ? match[1].trim() : null;
}

/**
 * 从 DDL 中解析所有列名（按顺序）
 * @param ddl CREATE TABLE 语句
 * @returns 列名数组
 */
export function parseDDLColumnNames(ddl: string): string[] {
  if (!ddl) return [];
  const columns: string[] = [];

  const body = getCreateTableDefinitionBody_ACU(ddl);
  if (body === null) return [];
  // 按逗号分割（但要注意括号内和注释内的逗号）
  const lines = splitColumnDefinitions(body);

  for (const line of lines) {
    // 去掉行注释和块注释（保留 SQL 字面量），然后取第一个非注释内容；
    // 不能只替换 --，否则首列前置 /* ... */ 会被误当成列名。
    const withoutComments = stripSqlLineComments_ACU(line).trim();
    if (!withoutComments) continue;
    // 跳过表级约束（PRIMARY KEY、FOREIGN KEY、UNIQUE、CHECK、CONSTRAINT）
    if (/^(?:PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|CONSTRAINT)\b/i.test(withoutComments)) continue;
    // 提取列名（第一个标识符）
    const colMatch = withoutComments.match(/^([^\s,()]+)/);
    if (colMatch) {
      columns.push(colMatch[1]);
    }
  }

  return columns;
}

/**
 * 从 DDL 中解析列名 → 注释的映射
 * 格式：column_name TYPE ... -- 注释
 * @param ddl CREATE TABLE 语句
 * @returns Map<列名, 注释>
 */
export function parseDDLColumnComments(ddl: string): Map<string, string> {
  const comments = new Map<string, string>();
  if (!ddl) return comments;

  const body = getCreateTableDefinitionBody_ACU(ddl);
  if (body === null) return comments;
  // 按行分割（注释是行级概念，标准 SQL 中 `-- 注释` 到行尾）
  // 而非按 splitColumnDefinitions 分割（逗号在注释之前，会截断注释）
  const lines = body.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // 匹配 column_name ... -- 注释（行内可能有逗号、CHECK 约束等）
    const match = trimmed.match(/^([^\s,()]+)\s+.*?--\s*(.+?)\s*,?\s*$/);
    if (match) {
      comments.set(match[1], match[2]);
    }
  }

  return comments;
}

/**
 * 构建 DDL 列名 → 中文名的双向映射
 * @param ddl CREATE TABLE 语句
 * @returns { sqlToChinese: Map<英文列名, 中文名>, chineseToSql: Map<中文名, 英文列名> }
 */
export function buildColumnNameMap(ddl: string): {
  sqlToChinese: Map<string, string>;
  chineseToSql: Map<string, string>;
} {
  const comments = parseDDLColumnComments(ddl);
  const sqlToChinese = new Map<string, string>();
  const chineseToSql = new Map<string, string>();

  for (const [colName, comment] of comments) {
    sqlToChinese.set(colName, comment);
    chineseToSql.set(comment, colName);
  }

  return { sqlToChinese, chineseToSql };
}

export type DDLSafeDefaultLiteral_ACU =
  | { kind: 'null'; sql: 'NULL'; value: null }
  | { kind: 'integer'; sql: string; value: number }
  | { kind: 'real'; sql: string; value: number }
  | { kind: 'string'; sql: string; value: string }
  | { kind: 'blob'; sql: string; value: string }
  | { kind: 'boolean'; sql: 'TRUE' | 'FALSE'; value: boolean };

export interface DDLColumnInfo_ACU {
  index: number;
  sqlName: string;
  declaredType: string | null;
  comment: string | null;
  /** 移除注释并压缩空白后的完整列定义，用于 schema contract 比较。 */
  normalizedDefinition: string;
  isPrimaryKey: boolean;
  isNotNull: boolean;
  hasDefault: boolean;
  /** Exact DEFAULT expression, or null when the definition has no DEFAULT. */
  defaultExpression: string | null;
}

export function parseDDLColumnInfos_ACU(ddl: string): DDLColumnInfo_ACU[] {
  const columnNames = parseDDLColumnNames(ddl);
  const comments = parseDDLColumnComments(ddl);
  const body = getCreateTableDefinitionBody_ACU(ddl);
  const definitions = body === null ? [] : splitColumnDefinitions(body);
  const definitionsByName = new Map<string, string>();
  for (const definition of definitions) {
    const withoutComments = stripSqlLineComments_ACU(definition).trim();
    const nameMatch = withoutComments.match(/^([^\s,()]+)/);
    if (nameMatch) definitionsByName.set(nameMatch[1], withoutComments);
  }
  return columnNames.map((sqlName, index) => {
    const rawComment = comments.get(sqlName);
    const comment = typeof rawComment === 'string' && rawComment.trim() ? rawComment.trim() : null;
    const definition = definitionsByName.get(sqlName) || '';
    const tokens = extractTopLevelSqlTokens_ACU(definition);
    const defaultExpression = extractDDLDefaultExpression_ACU(definition);
    return {
      index,
      sqlName,
      declaredType: tokens[1] || null,
      comment,
      normalizedDefinition: definition.replace(/\s+/g, ' ').trim(),
      isPrimaryKey: hasSequentialTokens_ACU(tokens, 'PRIMARY', 'KEY'),
      isNotNull: hasSequentialTokens_ACU(tokens, 'NOT', 'NULL'),
      hasDefault: defaultExpression !== null,
      defaultExpression,
    };
  });
}

export interface SheetColumnProjectionItem_ACU {
  sourceIndex: number;
  physicalName: string;
  header: string;
  hidden: boolean;
}

export const RUNTIME_EFFECTIVE_SCHEMA_KEY_ACU = '_acu_runtimeEffectiveSchema';

/**
 * 把源对象的 non-enumerable `_acu_runtimeEffectiveSchema` descriptor 复制到目标对象，
 * 供投影副本（如 TemplateScope 隐藏列投影）保留 SQLite 实际 schema 证据。
 *
 * 语义约束：
 * - 只复制 descriptor，不复制实现类型：本模块不反向依赖 data 层，
 *   因此不 import RuntimeEffectiveSchema_ACU；值类型由调用方保证一致。
 * - 保持 non-enumerable：runtime schema 不得进入 JSON 序列化 / V2 持久化边界。
 * - 保持源 descriptor 的 writable/configurable 属性。
 * - 不修改源对象；源对象无该字段时目标对象也不添加。
 */
export function copyRuntimeEffectiveSchemaDescriptor_ACU(
  source: unknown,
  target: Record<string, unknown>,
): void {
  if (!source || (typeof source !== 'object' && typeof source !== 'function')) return;
  const sourceObject = source as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(sourceObject, RUNTIME_EFFECTIVE_SCHEMA_KEY_ACU)) return;
  const descriptor = Object.getOwnPropertyDescriptor(sourceObject, RUNTIME_EFFECTIVE_SCHEMA_KEY_ACU);
  if (!descriptor) return;
  // 复制必须保留 non-enumerable（禁止泄漏进 JSON/persist）；
  // 若源 descriptor 意外是 enumerable，仍强制 non-enumerable 以避免持久化泄漏。
  Object.defineProperty(target, RUNTIME_EFFECTIVE_SCHEMA_KEY_ACU, {
    ...descriptor,
    enumerable: false,
  });
}

/** 读取（只读访问）投影对象上的 runtime effective schema descriptor 值；无则返回 undefined。 */
export function getRuntimeEffectiveSchema_ACU(sheet: unknown): unknown {
  if (!sheet || (typeof sheet !== 'object' && typeof sheet !== 'function')) return undefined;
  const value = (sheet as Record<string, unknown>)[RUNTIME_EFFECTIVE_SCHEMA_KEY_ACU];
  return value;
}

/**
 * Resolves the persisted physical-column visibility contract without changing
 * the sheet's schema or row layout. Consumers must keep sourceIndex when they
 * project rows; a visible array index is not a physical column index.
 */
export function getSheetColumnProjection_ACU(sheet: Sheet_ACU): {
  columns: SheetColumnProjectionItem_ACU[];
  visibleColumns: SheetColumnProjectionItem_ACU[];
  hiddenPhysicalColumns: string[];
} {
  const headers = Array.isArray(sheet?.content?.[0])
    ? sheet.content[0].map(value => String(value ?? ''))
    : [];
  const ddlColumns = parseDDLColumnInfos_ACU(String(sheet?.sourceData?.ddl || ''));
  const rawHidden = sheet?.sourceData?.hiddenPhysicalColumns;
  if (rawHidden !== undefined && !Array.isArray(rawHidden)) {
    throw new Error('hiddenPhysicalColumns 必须是 physical column 字符串数组。');
  }
  const hidden = (rawHidden || []).map(value => String(value ?? '').trim()).filter(Boolean);
  const hiddenCanonical = hidden.map(value => value.toLowerCase());
  if (new Set(hiddenCanonical).size !== hiddenCanonical.length) {
    throw new Error('hiddenPhysicalColumns 包含大小写不敏感的重复 physical column。');
  }
  if (hiddenCanonical.includes('row_id')) throw new Error('row_id 不允许隐藏。');
  // DDL 与 content[0] 列数不一致时无法按下标推出物理列名，只能退化为按表头名判定隐藏。
  // 这不是错误：模板范围投影会在「模板列少于运行时列」时构造这种形态；
  // native 模式（无 DDL）的隐藏列本就以表头名为身份（S0-3），属契约行为，静默处理。
  const canMapByIndex = ddlColumns.length === headers.length;
  if (hidden.length > 0 && !canMapByIndex && ddlColumns.length > 0) {
    logWarn_ACU('[SheetProjection] DDL 与 content[0] 列数不一致，隐藏列按表头名匹配。');
  }
  const physicalNames = canMapByIndex
    ? ddlColumns.map(column => column.sqlName)
    : headers;
  // 无法按下标对齐时，隐藏名可能来自 DDL 物理名也可能来自表头名，两者都算已知，
  // 否则模板范围投影传入的物理列名会被误判为「不存在的 physical column」。
  const physicalCanonical = new Set([
    ...physicalNames.map(value => value.toLowerCase()),
    ...(canMapByIndex ? [] : ddlColumns.map(column => column.sqlName.toLowerCase())),
  ]);
  const unknown = hidden.filter(value => !physicalCanonical.has(value.toLowerCase()));
  if (unknown.length > 0) {
    throw new Error(`hiddenPhysicalColumns 指向不存在的 physical column「${unknown.join('、')}」。`);
  }
  const hiddenSet = new Set(hiddenCanonical);
  const columns = headers.map((header, sourceIndex): SheetColumnProjectionItem_ACU => {
    const physicalName = physicalNames[sourceIndex] || header;
    // 无法按下标对齐时，同一列既可能以 DDL 物理名也可能以表头名被列入隐藏集合。
    const ddlName = canMapByIndex ? '' : (ddlColumns[sourceIndex]?.sqlName || '');
    const hidden = hiddenSet.has(physicalName.toLowerCase())
      || (!!ddlName && hiddenSet.has(ddlName.toLowerCase()))
      || (!!header && hiddenSet.has(String(header).toLowerCase()));
    return { sourceIndex, physicalName, header, hidden };
  });
  return {
    columns,
    visibleColumns: columns.filter(column => !column.hidden),
    hiddenPhysicalColumns: hidden,
  };
}

/** Builds a prompt-only DDL view. It never mutates or replaces persisted DDL. */
export function projectSheetDDLForVisibleColumns_ACU(sheet: Sheet_ACU, ddlOverride?: string): string {
  const ddl = String(ddlOverride || sheet?.sourceData?.ddl || '');
  const projection = getSheetColumnProjection_ACU(sheet);
  if (projection.hiddenPhysicalColumns.length === 0) return ddl;
  const bounds = findCreateTableDefinitionBounds_ACU(ddl);
  const infos = parseDDLColumnInfos_ACU(ddl);
  if (!bounds || infos.length !== projection.columns.length) {
    throw new Error('无法为隐藏列构建安全的可见 DDL 投影。');
  }
  const visibleIndexes = new Set(projection.visibleColumns.map(column => column.sourceIndex));
  const visible = infos.filter(info => visibleIndexes.has(info.index));
  if (visible.length === 0 || infos[0]?.sqlName.toLowerCase() !== 'row_id') {
    throw new Error('可见 DDL 投影必须保留 row_id。');
  }
  // 必须把列注释带回投影结果：注释是中文表头与 SQL 列名的唯一映射依据。
  // 丢掉它会让 resolveInsertColumnMappings 无法把中文表头匹配到任何 DDL 列，
  // 进而以「表头没有对应的 DDL 列」拒绝写入；prompt 里的 AI 也会失去列语义。
  const body = visible
    .map((info, index) => {
      const comma = index < visible.length - 1 ? ',' : '';
      const comment = info.comment ? ` -- ${info.comment}` : '';
      return `  ${info.normalizedDefinition}${comma}${comment}`;
    })
    .join('\n');
  return `${ddl.slice(0, bounds.openingIndex + 1)}\n${body}\n${ddl.slice(bounds.closingIndex)}`;
}

/**
 * Builds a runtime-only DDL variant for SPv7.9 duplicate-row migration.
 * The persisted DDL is never modified. The normal schema contract already
 * requires an inline first `row_id INTEGER PRIMARY KEY` column.
 */
export function downgradeRowIdPrimaryKeyForLegacyReplay_ACU(ddl: string): string {
  const value = String(ddl || '');
  const bounds = findCreateTableDefinitionBounds_ACU(value);
  if (!bounds) throw new Error('无法解析 CREATE TABLE 语句，不能降级 row_id 主键。');
  if (/\bWITHOUT\s+ROWID\b/i.test(parseDDLTableSuffix_ACU(value))) {
    throw new Error('SPv7.9 旧语义 SQL 回放不支持 WITHOUT ROWID 表。');
  }
  const body = value.slice(bounds.openingIndex + 1, bounds.closingIndex);
  const definitions = splitColumnDefinitions(body);
  if (definitions.length === 0) throw new Error('DDL 缺少可降级的 row_id 列。');

  const first = definitions[0];
  // 首列可能带前置空白、`--` 行注释或 `/* ... */` 块注释。
  // 这些 trivia 不能进入列名/类型正则，否则会把注释当成列名开头而误报“缺少 row_id”。
  const leadingTriviaEnd = skipSqlTrivia_ACU(first, 0);
  const leadingTrivia = first.slice(0, leadingTriviaEnd);
  const firstBody = first.slice(leadingTriviaEnd);
  const commentIndex = findSqlLineCommentStart_ACU(firstBody);
  const definition = (commentIndex < 0 ? firstBody : firstBody.slice(0, commentIndex));
  const comment = commentIndex < 0 ? '' : firstBody.slice(commentIndex);
  const match = definition.match(/^(\s*)((?:"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[(?:[^\]]|\]\])*\]|[A-Za-z_][A-Za-z0-9_]*))(\s+INTEGER\b)([\s\S]*)$/i);
  if (!match || canonicalSqlIdentifier_ACU(match[2]) !== 'row_id') {
    throw new Error('SPv7.9 旧语义 SQL 回放缺少首列 row_id INTEGER PRIMARY KEY。');
  }
  const tail = match[4];
  if (!/\bPRIMARY\s+KEY\b/i.test(tail)) {
    throw new Error('SPv7.9 旧语义 SQL 回放缺少可降级的 row_id PRIMARY KEY 约束。');
  }
  const downgradedTail = tail
    .replace(/\s+PRIMARY\s+KEY\b/i, '')
    .replace(/\s+AUTOINCREMENT\b/i, '');
  if (/\b(?:PRIMARY\s+KEY|AUTOINCREMENT)\b/i.test(downgradedTail)) {
    throw new Error('SPv7.9 旧语义 SQL 回放无法安全降级 row_id 约束。');
  }
  definitions[0] = `${leadingTrivia}${match[1]}${match[2]}${match[3]}${downgradedTail}${comment}`;
  const next = `${value.slice(0, bounds.openingIndex + 1)}${definitions.join(',')}${value.slice(bounds.closingIndex)}`;
  const columns = parseDDLColumnInfos_ACU(next);
  const firstColumn = columns[0];
  if (!firstColumn || canonicalSqlIdentifier_ACU(firstColumn.sqlName) !== 'row_id'
    || firstColumn.declaredType !== 'INTEGER' || firstColumn.isPrimaryKey
    || parseDDLTableName(next) !== bounds.tableName) {
    throw new Error('SPv7.9 旧语义 SQL 回放生成的降级 DDL 未通过结构校验。');
  }
  return next;
}

export function projectSheetRowToVisibleColumns_ACU(sheet: Sheet_ACU, row: readonly unknown[]): unknown[] {
  return getSheetColumnProjection_ACU(sheet).visibleColumns.map(column => row[column.sourceIndex]);
}

export function projectSheetHeadersToVisibleColumns_ACU(sheet: Sheet_ACU): string[] {
  return getSheetColumnProjection_ACU(sheet).visibleColumns.map(column => column.header);
}

/**
 * Parses only literal defaults that can be replayed without evaluating SQL.
 * SQLite expressions, parenthesized values and CURRENT_* are intentionally
 * rejected by returning null.
 */
export function parseDDLSafeDefaultLiteral_ACU(expression: string | null | undefined): DDLSafeDefaultLiteral_ACU | null {
  const value = String(expression || '').trim();
  if (!value) return null;
  if (/^NULL$/i.test(value)) return { kind: 'null', sql: 'NULL', value: null };
  if (/^TRUE$/i.test(value)) return { kind: 'boolean', sql: 'TRUE', value: true };
  if (/^FALSE$/i.test(value)) return { kind: 'boolean', sql: 'FALSE', value: false };
  if (/^X'(?:[0-9A-F]{2})*'$/i.test(value)) return { kind: 'blob', sql: value.toUpperCase(), value: value.slice(2, -1).toUpperCase() };
  if (/^[+-]?\d+$/.test(value)) {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) ? { kind: 'integer', sql: value, value: numeric } : null;
  }
  if (/^[+-]?(?:\d+\.\d*|\d*\.\d+)(?:[eE][+-]?\d+)?$|^[+-]?\d+[eE][+-]?\d+$/.test(value)) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? { kind: 'real', sql: value, value: numeric } : null;
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    const inner = value.slice(1, -1);
    if (!/(^|[^'])'(?!')/.test(inner)) return { kind: 'string', sql: value, value: inner.replace(/''/g, "'") };
  }
  return null;
}

function extractDDLDefaultExpression_ACU(definition: string): string | null {
  const value = stripSqlLineComments_ACU(definition);
  let quote: "'" | '"' | '`' | '[' | null = null;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === (quote === '[' ? ']' : quote)) {
        if (quote !== '[' && value[index + 1] === quote) index += 1;
        else quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === '`' || char === '[') { quote = char; continue; }
    if (char === '(') { depth += 1; continue; }
    if (char === ')') { depth = Math.max(0, depth - 1); continue; }
    if (depth !== 0 || value.slice(index, index + 7).toUpperCase() !== 'DEFAULT') continue;
    if (/[A-Z0-9_$]/i.test(value[index - 1] || '') || /[A-Z0-9_$]/i.test(value[index + 7] || '')) continue;
    const start = skipSqlTrivia_ACU(value, index + 7);
    const parsed = consumeDefaultLiteralToken_ACU(value, start);
    return parsed?.token || value.slice(start).trim() || null;
  }
  return null;
}

function consumeDefaultLiteralToken_ACU(value: string, start: number): { token: string; end: number } | null {
  if (value[start] === "'") {
    let index = start + 1;
    while (index < value.length) {
      if (value[index] === "'") {
        if (value[index + 1] === "'") { index += 2; continue; }
        return { token: value.slice(start, index + 1), end: index + 1 };
      }
      index += 1;
    }
    return null;
  }
  const blob = value.slice(start).match(/^X'(?:[0-9A-F]{2})*'/i);
  if (blob) return { token: blob[0], end: start + blob[0].length };
  const scalar = value.slice(start).match(/^(?:NULL|TRUE|FALSE|[+-]?(?:\d+\.\d*|\d*\.\d+|\d+)(?:[eE][+-]?\d+)?)/i);
  return scalar ? { token: scalar[0], end: start + scalar[0].length } : null;
}

function hasSequentialTokens_ACU(tokens: string[], first: string, second: string): boolean {
  return tokens.some((token, index) => token === first && tokens[index + 1] === second);
}

/** Removes comments and insignificant whitespace while preserving SQL literals. */
export function normalizeDDLForSchemaDescriptor_ACU(ddl: string): string {
  return stripSqlLineComments_ACU(String(ddl || '')).replace(/\s+/g, ' ').trim();
}

/**
 * Returns normalized table-level constraints without attempting to interpret
 * them. Schema migration V1 compares them verbatim and rejects any change.
 */
export function parseDDLTableConstraints_ACU(ddl: string): string[] {
  const body = getCreateTableDefinitionBody_ACU(ddl);
  if (body === null) return [];
  return splitColumnDefinitions(body)
    .map(definition => stripSqlLineComments_ACU(definition).replace(/\s+/g, ' ').trim())
    .filter(definition => /^(?:PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|CONSTRAINT)\b/i.test(definition));
}

/** Returns normalized CREATE TABLE options following the closing definition bracket. */
export function parseDDLTableSuffix_ACU(ddl: string): string {
  const value = String(ddl || '');
  const bounds = findCreateTableDefinitionBounds_ACU(value);
  return bounds
    ? stripSqlLineComments_ACU(value.slice(bounds.closingIndex + 1)).replace(/;\s*$/, '').replace(/\s+/g, ' ').trim()
    : '';
}

function getCreateTableDefinitionBody_ACU(ddl: string): string | null {
  const value = String(ddl || '');
  const bounds = findCreateTableDefinitionBounds_ACU(value);
  return bounds ? value.slice(bounds.openingIndex + 1, bounds.closingIndex) : null;
}

function findCreateTableDefinitionBounds_ACU(value: string): {
  tableName: string;
  tableNameStart: number;
  tableNameEnd: number;
  openingIndex: number;
  closingIndex: number;
} | null {
  let index = skipSqlTrivia_ACU(value, 0);
  index = consumeSqlKeyword_ACU(value, index, 'CREATE');
  if (index < 0) return null;
  index = consumeSqlKeyword_ACU(value, skipSqlTrivia_ACU(value, index), 'TABLE');
  if (index < 0) return null;
  index = skipSqlTrivia_ACU(value, index);
  const afterIf = consumeSqlKeyword_ACU(value, index, 'IF');
  if (afterIf >= 0) {
    const afterNot = consumeSqlKeyword_ACU(value, skipSqlTrivia_ACU(value, afterIf), 'NOT');
    const afterExists = afterNot < 0 ? -1 : consumeSqlKeyword_ACU(value, skipSqlTrivia_ACU(value, afterNot), 'EXISTS');
    if (afterExists < 0) return null;
    index = skipSqlTrivia_ACU(value, afterExists);
  }
  const tableNameStart = index;
  const tableNameEnd = skipSqlIdentifier_ACU(value, index);
  if (tableNameEnd <= tableNameStart) return null;
  index = tableNameEnd;
  index = skipSqlTrivia_ACU(value, index);
  if (value[index] !== '(') return null;
  const openingIndex = index;
  let depth = 0;
  let quote: "'" | '"' | '`' | '[' | null = null;
  for (; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (quote === '[') {
        if (char === ']') {
          if (value[index + 1] === ']') index += 1;
          else quote = null;
        }
      } else if (char === quote) {
        if (value[index + 1] === quote) index += 1;
        else quote = null;
      }
      continue;
    }
    if (char === '-' && value[index + 1] === '-') {
      index = skipSqlTrivia_ACU(value, index);
      index -= 1;
      continue;
    }
    if (char === '/' && value[index + 1] === '*') {
      index = skipSqlTrivia_ACU(value, index);
      index -= 1;
      continue;
    }
    if (char === "'" || char === '"' || char === '`' || char === '[') {
      quote = char;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')' && --depth === 0) {
      return { tableName: value.slice(tableNameStart, tableNameEnd), tableNameStart, tableNameEnd, openingIndex, closingIndex: index };
    }
  }
  return null;
}

function skipSqlTrivia_ACU(value: string, start: number): number {
  let index = start;
  while (index < value.length) {
    if (/\s/.test(value[index])) { index += 1; continue; }
    if (value[index] === '-' && value[index + 1] === '-') {
      index += 2;
      while (index < value.length && value[index] !== '\n' && value[index] !== '\r') index += 1;
      continue;
    }
    if (value[index] === '/' && value[index + 1] === '*') {
      const end = value.indexOf('*/', index + 2);
      if (end < 0) return value.length;
      index = end + 2;
      continue;
    }
    break;
  }
  return index;
}

function consumeSqlKeyword_ACU(value: string, start: number, keyword: string): number {
  const end = start + keyword.length;
  return value.slice(start, end).toUpperCase() === keyword && !/[A-Z0-9_$]/i.test(value[start - 1] || '') && !/[A-Z0-9_$]/i.test(value[end] || '') ? end : -1;
}

function skipSqlIdentifier_ACU(value: string, start: number): number {
  const quote = value[start];
  if (quote === '"' || quote === '`' || quote === '[') {
    const close = quote === '[' ? ']' : quote;
    let index = start + 1;
    while (index < value.length) {
      if (value[index] === close) {
        if (value[index + 1] === close) { index += 2; continue; }
        return index + 1;
      }
      index += 1;
    }
    return value.length;
  }
  let index = start;
  while (index < value.length && !/\s|\(/.test(value[index])) index += 1;
  return index;
}

function stripSqlLineComments_ACU(value: string): string {
  let result = '';
  let quote: "'" | '"' | '`' | '[' | null = null;
  let inBlockComment = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (inBlockComment) {
      if (char === '*' && value[index + 1] === '/') {
        inBlockComment = false;
        index += 1;
      } else if (char === '\n') {
        result += '\n';
      }
      continue;
    }
    if (quote) {
      result += char;
      if (quote === '[' ? char === ']' : char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`' || char === '[') {
      quote = char;
      result += char;
      continue;
    }
    if (char === '/' && value[index + 1] === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }
    if (char === '-' && value[index + 1] === '-') {
      while (index < value.length && value[index] !== '\n') index += 1;
      if (index < value.length) result += '\n';
      continue;
    }
    result += char;
  }
  return result;
}

function extractTopLevelSqlTokens_ACU(definition: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let depth = 0;
  let quote: "'" | '"' | '`' | '[' | null = null;
  let inBlockComment = false;
  const flush = () => {
    if (current) tokens.push(current.toUpperCase());
    current = '';
  };
  for (let index = 0; index < definition.length; index += 1) {
    const char = definition[index];
    if (inBlockComment) {
      if (char === '*' && definition[index + 1] === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (quote === '[' ? char === ']' : char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`' || char === '[') {
      flush();
      quote = char;
      continue;
    }
    if (char === '/' && definition[index + 1] === '*') {
      flush();
      inBlockComment = true;
      index += 1;
      continue;
    }
    if (char === '(') {
      flush();
      depth += 1;
      continue;
    }
    if (char === ')') {
      flush();
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0 && /[A-Za-z0-9_]/.test(char)) {
      current += char;
    } else {
      flush();
    }
  }
  flush();
  return tokens;
}

function isAsciiOnly_ACU(value: string): boolean {
  return /^[\x00-\x7F]+$/.test(String(value || ''));
}

/**
 * DDL 物理列与 snapshot 展示表头的唯一匹配契约。
 * 比较保持精确，不做大小写、拼音或位置兜底；展示名必须由物理名或 DDL 注释明确声明。
 */
export function matchesDDLColumnHeader_ACU(sqlName: string, comment: string | null, header: string): boolean {
  if (!header) return false;
  return header === sqlName || (sqlName === 'row_id' && header === '行号') || (!!comment && header === comment);
}

function buildDDLHeaderMismatchMessage_ACU(index: number, ddlColumn: DDLColumnInfo_ACU, header: string): string {
  return ddlColumn.comment
    ? `第 ${index + 1} 列不匹配：DDL 列名为「${ddlColumn.sqlName}」，注释为「${ddlColumn.comment}」，表头为「${header}」`
    : `第 ${index + 1} 列不匹配：DDL 列名为「${ddlColumn.sqlName}」，表头为「${header}」`;
}


/**
 * Injects a canonical `row_id INTEGER PRIMARY KEY` column right after the opening
 * parenthesis of the first CREATE TABLE definition. It only inserts at the exact
 * definition boundary parsed by the SQL scanner, so literals, comments and other
 * parentheses remain untouched. Callers must validate column-count and header
 * mapping afterwards (e.g. via validateDDLTextAgainstHeaders_ACU).
 */
export function injectRowIdPrimaryKeyColumn_ACU(ddl: string): string {
  const value = String(ddl || '').trim();
  if (!value) throw new Error('无法在空 DDL 中注入 row_id。');
  const bounds = findCreateTableDefinitionBounds_ACU(value);
  if (!bounds) throw new Error('无法解析 CREATE TABLE 语句，不能注入 row_id。');
  const after = value.slice(bounds.openingIndex + 1);
  const injected = `\n  row_id INTEGER PRIMARY KEY, -- 行号`;
  const separator = after.startsWith('\n') || after.startsWith('\r') ? '' : '\n  ';
  return `${value.slice(0, bounds.openingIndex + 1)}${injected}${separator}${after}`;
}

export function validateDDLTextAgainstHeaders_ACU(
  ddlText: string,
  tableHeaders: string[],
): { valid: boolean; message: string } {
  const rawHeaders = Array.isArray(tableHeaders) ? tableHeaders : [];
  const trimmed = String(ddlText || '').trim();
  if (!trimmed) {
    return { valid: false, message: '⚠ DDL 为空' };
  }
  if (!/CREATE\s+TABLE/i.test(trimmed)) {
    return { valid: false, message: '✗ 不是有效的 CREATE TABLE 语句' };
  }

  const columnInfos = parseDDLColumnInfos_ACU(trimmed);
  const firstColumn = columnInfos[0];
  if (!firstColumn || firstColumn.sqlName.toLowerCase() !== 'row_id'
    || firstColumn.declaredType !== 'INTEGER' || !firstColumn.isPrimaryKey) {
    return { valid: false, message: '✗ 缺少 row_id INTEGER PRIMARY KEY 列（必须作为第一列）' };
  }

  // 统一列身份契约：tableHeaders 必须是「完整表头」（首列为 row_id 位置）。
  // 首列允许 row_id / 行号 / null 占位（visualizer 用 null 表示不可编辑的
  // row_id 列）；除此之外的首列一律 fail-closed（无可靠身份不得放行）。
  // 表头规范化（NFKC/trim）后保留全部列（保序），业务列空/空白/重复
  // fail-closed，绝不通过 filter 剔除空列来“对齐”列数。
  if (rawHeaders.length === 0) {
    return { valid: false, message: '✗ 表头为空，无法校验 DDL' };
  }
  // 真实 visualizer 的不可编辑 row_id 占位是 null（不是空串）。`String(item ?? '')`
  // 会把 null 也拍扁成空串，导致无法区分「null 占位」与「空串/空白表头」，
  // 因此这里必须基于原始首列类型判断：仅 null 占位放行，空串/空白一律 fail-closed。
  const firstRawHeader = rawHeaders[0];
  const isNullRowIdPlaceholder = firstRawHeader === null || firstRawHeader === undefined;
  const normalizedHeaders = rawHeaders.map((item) => String(item ?? '').normalize('NFKC').trim());
  const firstHeader = normalizedHeaders[0];
  const isRowIdHeader = firstHeader === 'row_id' || firstHeader === '行号' || isNullRowIdPlaceholder;
  if (!isRowIdHeader) {
    return { valid: false, message: '✗ 表头第一列必须为 row_id（或 行号 / 不可编辑的 row_id 占位）' };
  }
  const comparableHeaders = normalizedHeaders.slice(1);
  const seenCanonical = new Set<string>();
  const headerIssues: string[] = [];
  normalizedHeaders.forEach((header, index) => {
    if (index === 0) {
      if (header) seenCanonical.add(header.toLocaleLowerCase('en-US').replace(/\s+/g, ' '));
      return;
    }
    if (!header) {
      headerIssues.push(`第 ${index + 1} 列表头为空`);
      return;
    }
    const canonical = header.toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
    if (seenCanonical.has(canonical)) {
      headerIssues.push(`第 ${index + 1} 列表头「${header}」重复`);
    }
    seenCanonical.add(canonical);
  });
  if (headerIssues.length > 0) {
    return { valid: false, message: `⚠ DDL 表头不合法：${headerIssues.join('；')}` };
  }

  const comparableColumns = columnInfos.filter((item) => item.sqlName.toLowerCase() !== 'row_id');
  const issues: string[] = [];

  if (comparableColumns.length !== comparableHeaders.length) {
    issues.push(`列数不匹配：DDL 有 ${comparableColumns.length} 列，表头有 ${comparableHeaders.length} 列`);
  }

  const compareLength = Math.min(comparableColumns.length, comparableHeaders.length);
  for (let index = 0; index < compareLength; index += 1) {
    const ddlColumn = comparableColumns[index];
    const header = comparableHeaders[index];
    const sqlNameIsAscii = isAsciiOnly_ACU(ddlColumn.sqlName);

    if (!matchesDDLColumnHeader_ACU(ddlColumn.sqlName, ddlColumn.comment, header)) {
      issues.push(buildDDLHeaderMismatchMessage_ACU(index, ddlColumn, header));
      continue;
    }

    if (!isAsciiOnly_ACU(header) && !sqlNameIsAscii) {
      issues.push(
        `第 ${index + 1} 列不匹配：表头为「${header}」时，DDL 物理列名必须使用英文/ASCII，当前 DDL 列名为「${ddlColumn.sqlName}」，注释为「${ddlColumn.comment}」`,
      );
    }
  }

  if (issues.length > 0) {
    return { valid: false, message: `⚠ DDL 列名与表头不完全匹配：${issues.join('；')}` };
  }

  return { valid: true, message: '✓ DDL 格式正确，列名与表头匹配' };
}

/**
 * 根据列在 DDL 中的位置索引获取英文列名
 * 索引从 0 开始，对应 content[0] 中的位置（包含 row_id）
 *
 * @param ddl CREATE TABLE 语句
 * @param index 列索引（对应 content[0] 的位置，0 通常是 row_id）
 * @returns 英文列名，找不到返回 null
 */
export function getDDLColumnNameByIndex(ddl: string, index: number): string | null {
  const columns = parseDDLColumnNames(ddl);
  if (index < 0 || index >= columns.length) return null;
  return columns[index];
}

/**
 * Removes one business-column definition from a CREATE TABLE statement without
 * regenerating the surrounding schema. Ambiguous or dependent definitions fail
 * closed: callers must leave the editor draft untouched on error.
 */
export function removeDDLColumnAtIndex_ACU(ddl: string, sourceIndex: number): string {
  const value = String(ddl || '');
  const targetIndex = Math.trunc(Number(sourceIndex));
  const bounds = findCreateTableDefinitionBounds_ACU(value);
  if (!bounds) throw new Error('无法解析 CREATE TABLE 语句，不能安全删除列。');
  const columns = parseDDLColumnInfos_ACU(value);
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= columns.length) {
    throw new Error('目标列不在可解析的 DDL 列定义中。');
  }
  const target = columns[targetIndex];
  if (!target || target.sqlName.toLowerCase() === 'row_id') throw new Error('row_id 不允许删除。');

  const body = value.slice(bounds.openingIndex + 1, bounds.closingIndex);
  const hasTableConstraint = splitColumnDefinitions(body).some(definition =>
    /^(?:PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|CONSTRAINT)\b/i.test(stripSqlLineComments_ACU(definition).trim()),
  );
  if (hasTableConstraint) throw new Error('DDL 含表级约束，不能安全自动删除列。');
  const lines = body.split('\n');
  const columnLines = lines.map((line, index) => {
    const withoutLineComment = stripSqlLineComments_ACU(line).trim();
    const name = withoutLineComment.match(/^([^\s,()]+)/)?.[1];
    return name ? { index, name } : null;
  }).filter((item): item is { index: number; name: string } => item !== null);
  if (columnLines.length !== columns.length) {
    throw new Error('DDL 含多行列定义或表级约束，不能安全自动删除列。');
  }
  const targetName = canonicalSqlIdentifier_ACU(target.sqlName);
  const targetLinePosition = columnLines.findIndex(item => canonicalSqlIdentifier_ACU(item.name) === targetName);
  if (targetLinePosition < 0) throw new Error(`无法定位 DDL 列定义「${target.sqlName}」。`);
  const targetLine = lines[columnLines[targetLinePosition].index];
  if (/\b(?:PRIMARY\s+KEY|UNIQUE|REFERENCES|CHECK|CONSTRAINT)\b/i.test(stripSqlLineComments_ACU(targetLine))) {
    throw new Error(`列「${target.sqlName}」带有约束，不能安全自动删除。`);
  }

  // This transformer deliberately accepts only one-column-per-line DDL. That
  // lets it remove exactly one original line, preserving every other byte of
  // authored column definitions (including block comments and defaults).
  if (targetLinePosition === columnLines.length - 1 && targetLinePosition > 0) {
    const previousLineIndex = columnLines[targetLinePosition - 1].index;
    lines[previousLineIndex] = lines[previousLineIndex].replace(/,(\s*(?:--.*)?)$/, '$1');
  }
  lines.splice(columnLines[targetLinePosition].index, 1);
  const next = `${value.slice(0, bounds.openingIndex + 1)}${lines.join('\n')}${value.slice(bounds.closingIndex)}`;
  const validation = validateDDLTextAgainstHeaders_ACU(next, columns
    .filter((_, index) => index !== targetIndex)
    .map(column => column.sqlName.toLowerCase() === 'row_id' ? 'row_id' : (column.comment || column.sqlName)));
  if (!validation.valid) throw new Error(`删除列后的 DDL 非法：${validation.message}`);
  return next;
}

function canonicalSqlIdentifier_ACU(value: string): string {
  const raw = String(value || '').trim();
  if (raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1).replace(/""/g, '"').toLowerCase();
  if (raw.startsWith('`') && raw.endsWith('`')) return raw.slice(1, -1).replace(/``/g, '`').toLowerCase();
  if (raw.startsWith('[') && raw.endsWith(']')) return raw.slice(1, -1).replace(/]]/g, ']').toLowerCase();
  return raw.toLowerCase();
}

/**
 * 更新 DDL 中指定列的注释（中文名）
 * 按行扫描 DDL，找到指定列名的行，替换其 `-- 注释` 部分。
 * 如果该行没有注释，则在行尾添加 `-- 新注释`。
 *
 * @param ddl 原始 CREATE TABLE 语句
 * @param columnName 要更新注释的英文列名
 * @param newComment 新的注释内容（中文名）
 * @returns 更新后的 DDL 字符串；如果找不到列名则返回原 DDL
 */
export function updateDDLColumnComment(ddl: string, columnName: string, newComment: string): string {
  if (!ddl || !columnName || !newComment) return ddl;

  const lines = ddl.split('\n');
  let found = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;

    // 检查该行是否以目标列名开头（列定义行）
    const colMatch = trimmed.match(/^([^\s,()]+)\s+/);
    if (!colMatch || colMatch[1] !== columnName) continue;

    // 找到目标列，替换或添加注释
    found = true;
    const line = lines[i];

    // 情况 1：行内已有 `-- 注释`，替换注释内容
    const commentMatch = line.match(/^(.*?)(--\s*).+?(,?\s*)$/);
    if (commentMatch) {
      lines[i] = `${commentMatch[1]}-- ${newComment}${commentMatch[3]}`;
      break;
    }

    // 情况 2：行内没有注释，需要添加
    // 先检查行尾是否有逗号
    const trailingCommaMatch = line.match(/^(.*?)(,\s*)$/);
    if (trailingCommaMatch) {
      // 有逗号：在逗号前插入注释 → `  col TEXT, -- 注释`
      // 按照项目约定格式：逗号在注释前 → `  col TEXT, -- 注释`
      lines[i] = `${trailingCommaMatch[1]}, -- ${newComment}`;
    } else {
      // 无逗号（最后一列）：直接在行尾添加注释
      lines[i] = `${line.trimEnd()} -- ${newComment}`;
    }
    break;
  }

  if (!found) {
    logWarn_ACU(`[Schema] updateDDLColumnComment: 未找到列 "${columnName}"，DDL 未修改`);
  }

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════
// 内部工具函数
// ═══════════════════════════════════════════════════════════════

function findSqlLineCommentStart_ACU(value: string): number {
  let quote: "'" | '"' | '`' | '[' | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (quote === '[' ? char === ']' : char === quote) {
        if (quote !== '[' && value[index + 1] === quote) index += 1;
        else quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === '`' || char === '[') quote = char;
    else if (char === '-' && value[index + 1] === '-') return index;
  }
  return -1;
}

/**
 * 分割 DDL 括号内的列定义（处理嵌套括号）
 */
function splitColumnDefinitions(body: string): string[] {
  const results: string[] = [];
  let current = '';
  let depth = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let quote: "'" | '"' | '`' | '[' | null = null;

  for (let i = 0; i < body.length; i++) {
    const char = body[i];

    if (quote) {
      current += char;
      if (quote === '[') {
        if (char === ']') quote = null;
        continue;
      }
      if (char === quote) {
        if (i + 1 < body.length && body[i + 1] === quote) {
          current += body[i + 1];
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (inBlockComment) {
      current += char;
      if (char === '*' && i + 1 < body.length && body[i + 1] === '/') {
        current += body[i + 1];
        i += 1;
        inBlockComment = false;
      }
      continue;
    }

    if (char === '/' && i + 1 < body.length && body[i + 1] === '*') {
      inBlockComment = true;
      current += char;
      continue;
    }

    // 检测 -- 行注释开始
    if (!inLineComment && char === '-' && i + 1 < body.length && body[i + 1] === '-') {
      inLineComment = true;
      current += char;
      continue;
    }

    // 换行符结束行注释
    if (inLineComment && char === '\n') {
      inLineComment = false;
      current += char;
      continue;
    }

    // 在行注释内，所有字符直接追加（包括逗号）
    if (inLineComment) {
      current += char;
      continue;
    }

    if (char === "'" || char === '"' || char === '`' || char === '[') {
      quote = char;
      current += char;
      continue;
    }

    if (char === '(') {
      depth++;
      current += char;
    } else if (char === ')') {
      depth--;
      current += char;
    } else if (char === ',' && depth === 0) {
      results.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    results.push(current);
  }

  return results;
}
