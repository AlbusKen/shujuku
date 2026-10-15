/**
 * data/sqlite/schema-mapper.ts — Sheet ↔ SQL 双向映射
 *
 * 职责：
 * - Sheet → SQL：生成 DDL + INSERT 语句
 * - SQL → Sheet：SELECT 结果 → content 二维数组
 * - 处理类型亲和性转换（content 全是 string，SQL 有类型）
 * - DDL 解析（表名、中文名、列信息）
 */

import type { Sheet_ACU } from '../../shared/models/table-data';
import { logDebug_ACU } from '../../shared/utils';
import { normalizeSqlStructure, normalizeConstrainedValue } from './sql-normalizer';
import { generateFallbackDDL, createSheetInsertPlan, type SheetInsertPlan_ACU } from '../../shared/effective-ddl';

// 保持既有数据层入口；读写路径共用同一份纯 schema 解析契约。
export {
  resolveEffectiveDDL,
  buildRuntimeFallbackDDL_ACU,
  generateFallbackDDL,
  createSheetInsertPlan,
  type EffectiveDDLColumnMap_ACU, type EffectiveDDLResult_ACU, type SheetInsertPlan_ACU,
} from '../../shared/effective-ddl';

// DDL 纯解析函数已移至 shared/ddl-utils.ts，此处 re-export 保持 data 层内部调用不变
export {
  parseDDLTableName,
  parseDDLChineseName,
  parseDDLColumnNames,
  parseDDLColumnComments,
  buildColumnNameMap,
  getDDLColumnNameByIndex,
  updateDDLColumnComment,
  parseDDLColumnInfos_ACU,
  validateDDLTextAgainstHeaders_ACU,
  rebindCreateTableName_ACU,
} from '../../shared/ddl-utils';
import {
  parseDDLTableName,
  validateDDLTextAgainstHeaders_ACU,
} from '../../shared/ddl-utils';

// ═══════════════════════════════════════════════════════════════
// DDL 生成
// ═══════════════════════════════════════════════════════════════

/**
 * 从 Sheet 生成建表 DDL
 * 优先使用 sourceData.ddl，fallback 为全 TEXT 的自动生成 DDL
 *
 * @param sheet Sheet 对象
 * @param fallbackTableName fallback 时使用的英文表名（默认用 sheet.uid）
 * @returns CREATE TABLE 语句
 */
export function generateDDL(sheet: Sheet_ACU, fallbackTableName?: string): string {
  const ddl = sheet.sourceData?.ddl?.trim();
  if (ddl) {
    const normalizedDdl = normalizeSqlStructure(ddl);
    logDebug_ACU(`[Schema] generateDDL: 使用用户定义 DDL, 表名=${parseDDLTableName(normalizedDdl) || 'unknown'}`);
    return normalizedDdl;
  }

  const headers = sheet.content?.[0];
  if (!Array.isArray(headers) || headers.length === 0) {
    const tblName = fallbackTableName || sheet.uid || 'unknown_table';
    return `CREATE TABLE ${sanitizeIdentifier(tblName)} (\n  row_id INTEGER PRIMARY KEY -- 行号\n);`;
  }

  const tblName = fallbackTableName || sheet.uid || 'unknown_table';
  return generateFallbackDDL(sanitizeIdentifier(tblName), headers);
}


// ═══════════════════════════════════════════════════════════════
// INSERT 生成
// ═══════════════════════════════════════════════════════════════

/**
 * 从 Sheet 生成 INSERT 语句（灌入 content 数据）
 * content[0] 是表头，content[1:] 是数据行
 *
 * @param sheet Sheet 对象
 * @param tableName SQL 表名（如果不传，从 DDL 解析或用 sheet.uid）
 * @returns INSERT 语句数组（每行一条）
 */
export function generateInserts(sheet: Sheet_ACU, tableName?: string, plan?: SheetInsertPlan_ACU): string[] {
  const content = sheet.content;
  if (!Array.isArray(content) || content.length < 2) return [];

  const headers = content[0];
  if (!Array.isArray(headers) || headers.length === 0) return [];

  // 确定表名
  const tblName = tableName
    || parseDDLTableName(sheet.sourceData?.ddl || '')
    || sheet.uid
    || 'unknown_table';

  logDebug_ACU(`[Schema] generateInserts: 表=${tblName}, 数据行数=${content.length - 1}`);

  const resolvedPlan = plan || createSheetInsertPlan(sheet);
  const columnNames = resolvedPlan.mappings.map(mapping => mapping.sqlName);

  const statements: string[] = [];

  for (let r = 1; r < content.length; r++) {
    const row = content[r];
    if (!Array.isArray(row)) continue;

    const values: string[] = [];
    for (const mapping of resolvedPlan.mappings) {
      const val = mapping.sourceIndex < row.length ? row[mapping.sourceIndex] : null;
      if (mapping.required && (val === null || val === undefined)) {
        throw new Error(`第 ${r} 行缺少必需列「${mapping.sqlName}」的值`);
      }
      // 对白名单约束字段做值规范化（如 code_index 的大小写/全角数字）
      const normalizedVal = normalizeConstrainedValue(mapping.sqlName, val);
      values.push(escapeValue(normalizedVal));
    }

    // Snapshot row_id is a persistent identity. Duplicates must fail instead of
    // overwriting an earlier row and silently losing historical data.
    statements.push(`INSERT INTO ${sanitizeIdentifier(tblName)} (${columnNames.map(sanitizeIdentifier).join(', ')}) VALUES (${values.join(', ')});`);
  }

  return statements;
}


// ═══════════════════════════════════════════════════════════════
// SQL 结果 → content 转换
// ═══════════════════════════════════════════════════════════════

/**
 * 从 SQL 查询结果还原为 content 二维数组
 * 自动将 SQL 类型值转为 string（content 的存储格式）
 *
 * @param columns SQL 结果的列名数组
 * @param values SQL 结果的值数组
 * @param chineseHeaders 中文表头映射（列名 → 中文名），用于还原 content[0]
 * @returns content 二维数组（第一行是表头，后续是数据行）
 */
export function resultToContent(
  columns: string[],
  values: SqlJsValueType[][],
  chineseHeaders?: Map<string, string>
): (string | null)[][] {
  if (columns.length === 0) return [['row_id']];

  // 构建表头行：用中文名（如果有映射），否则用 SQL 列名
  const headerRow: (string | null)[] = columns.map(col => {
    if (col === 'row_id') return 'row_id';
    return chineseHeaders?.get(col) || col;
  });

  // 构建数据行：所有值转为 string
  const dataRows: (string | null)[][] = values.map(row =>
    row.map(val => valueToString(val))
  );

  return [headerRow, ...dataRows];
}

// ═══════════════════════════════════════════════════════════════
// DDL 校验
// ═══════════════════════════════════════════════════════════════

/**
 * 校验 DDL 列名与 content[0] 表头是否匹配
 * 比较的是列数和列的对应关系（通过 DDL 注释中的中文名匹配）
 *
 * @param ddl CREATE TABLE 语句
 * @param headers content[0] 表头行
 * @returns 校验结果
 */
export function validateDDLAgainstHeaders(
  ddl: string,
  headers: (string | null)[]
): { valid: boolean; mismatches: string[] } {
  // 保序传给统一契约校验；不再 filter 剔除 null，避免改变列位置
  // （中间空列由 validator 按“第 N 列为空”fail-closed）。
  // 首列 null 占位（visualizer 不可编辑 row_id）必须原样传递给统一契约，
  // 不能拍扁成空串——否则会被误判为“空表头”fail-closed。
  const normalizedHeaders = Array.isArray(headers) ? headers.map(h => (h === null || h === undefined ? null : String(h))) : [];
  const result = validateDDLTextAgainstHeaders_ACU(ddl, normalizedHeaders);
  return {
    valid: result.valid,
    mismatches: result.valid ? [] : [result.message],
  };
}



// ═══════════════════════════════════════════════════════════════
// 内部工具函数
// ═══════════════════════════════════════════════════════════════

/**
 * 将 SQL 值转为 content 中的 string 格式
 * null → null, number → string, Uint8Array → "[BLOB]", string → string
 */
function valueToString(val: SqlJsValueType): string | null {
  if (val === null || val === undefined) return null;
  if (val instanceof Uint8Array) return '[BLOB]';
  return String(val);
}

/**
 * 将 content 中的值转为 SQL 字面量
 * null/undefined → NULL, 数字字符串 → 数字, 其他 → 带引号的字符串
 */
function escapeValue(val: string | null | undefined): string {
  if (val === null || val === undefined) return 'NULL';
  // 纯数字（整数或浮点数）直接输出
  if (/^-?\d+(\.\d+)?$/.test(val)) return val;
  // 字符串：单引号转义
  return `'${val.replace(/'/g, "''")}'`;
}

/**
 * 清理 SQL 标识符（防止注入）
 * 只保留字母、数字、下划线
 */
function sanitizeIdentifier(name: string): string {
  // 如果已经是合法标识符，直接返回
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) return name;
  // 否则去掉非法字符
  const cleaned = name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^(\d)/, '_$1');
  return cleaned || '_unknown';
}
