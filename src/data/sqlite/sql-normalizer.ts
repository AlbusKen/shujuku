/**
 * data/sqlite/sql-normalizer.ts — SQL 输入规范化模块
 *
 * 职责：
 * - normalizeSqlStructure: 将 SQL 结构位置上的全角兼容字符转换为 ASCII
 *   （不修改字符串字面量和注释中的内容）
 * - normalizeConstrainedValue: 对白名单约束字段的值做规范化
 *   （当前白名单：code_index）
 *
 * 设计原则：
 * - 只做可安全判断语义的转换，不猜测业务含义
 * - 规范化后仍非法的值，不做伪装，保留失败
 * - 不对正文文本做无差别替换
 */

import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';
export { normalizeSqlStructure } from '../../shared/sql-structure';


// ═══════════════════════════════════════════════════════════════
// 受约束字段值规范化
// ═══════════════════════════════════════════════════════════════

/**
 * Unicode NFKC 兼容归一化
 * 将全角字母数字转换为半角，统一兼容形式
 *
 * 优先使用 String.prototype.normalize('NFKC')，
 * 如果运行时不支持（极端情况），fallback 到手动全角数字/字母映射
 */
function nfkcNormalize(str: string): string {
  if (typeof str.normalize === 'function') {
    return str.normalize('NFKC');
  }
  // Fallback：手动转换全角数字和基本全角拉丁字母
  return manualFullwidthToAscii(str);
}

/**
 * 手动全角→半角转换（fallback）
 * 覆盖全角数字 ０-９ 和全角大写/小写拉丁字母 Ａ-Ｚ ａ-ｚ
 */
function manualFullwidthToAscii(str: string): string {
  let result = '';
  for (const ch of str) {
    const code = ch.codePointAt(0)!;
    // 全角数字 U+FF10-U+FF19 → 半角 0-9
    if (code >= 0xFF10 && code <= 0xFF19) {
      result += String.fromCodePoint(code - 0xFF10 + 0x30);
    }
    // 全角大写字母 U+FF21-U+FF3A → 半角 A-Z
    else if (code >= 0xFF21 && code <= 0xFF3A) {
      result += String.fromCodePoint(code - 0xFF21 + 0x41);
    }
    // 全角小写字母 U+FF41-U+FF5A → 半角 a-z
    else if (code >= 0xFF41 && code <= 0xFF5A) {
      result += String.fromCodePoint(code - 0xFF41 + 0x61);
    }
    // 全角空格 U+3000 → 半角空格
    else if (code === 0x3000) {
      result += ' ';
    } else {
      result += ch;
    }
  }
  return result;
}

/**
 * 受约束字段规范化器类型
 * 每个规范化器接收原始值，返回规范化后的值
 */
type ValueNormalizer = (value: string) => string;

/**
 * 字段级规范化器注册表
 * key = 列名（小写，匹配时不区分大小写）
 * value = 规范化函数
 *
 * 扩展方式：在此注册表中添加新的列名和对应的规范化函数
 */
const FIELD_NORMALIZERS: Record<string, ValueNormalizer> = {
  /**
   * code_index 规范化
   * 目标模式：AM[0-9][0-9][0-9][0-9]（如 AM0001, AM0002...）
   *
   * 处理内容：
   * 1. trim() — 去除首尾空白
   * 2. NFKC 归一化 — 全角字母数字 → 半角
   * 3. 转大写 — am0001 → AM0001
   *
   * 不做的事：
   * - 不补零（AM1 不会变成 AM0001，语义不确定）
   * - 不截断（AM00001 不会变成 AM0001，会保留失败）
   * - 不改前缀（AX0001 不会变成 AM0001，语义不同）
   */
  code_index: (value: string): string => {
    return nfkcNormalize(value.trim()).toUpperCase();
  },
};

/**
 * 对受约束字段的值做规范化
 *
 * 仅对白名单中的列名生效，其他列直接返回原值。
 * 规范化后仍不满足约束的值不会被强制篡改，保留由 SQLite CHECK 约束来拒绝。
 *
 * @param columnName 列名（不区分大小写）
 * @param value 原始值
 * @returns 规范化后的值（如果该列在白名单中），或原值（如果不在白名单中）
 */
export function normalizeConstrainedValue(columnName: string, value: string | null | undefined): string | null {
  if (value === null || value === undefined) return value ?? null;
  if (!columnName) return value;

  const normalizer = FIELD_NORMALIZERS[columnName.toLowerCase()];
  if (!normalizer) return value;

  const normalized = normalizer(value);
  if (normalized !== value) {
    logDebug_ACU(`[SqlNormalizer] 字段 ${columnName} 值已规范化: "${value}" → "${normalized}"`);
  }
  return normalized;
}

/**
 * 获取所有已注册的规范化列名（小写）
 * 用于外部判断哪些列需要做值规范化
 */
export function getNormalizedColumnNames(): string[] {
  return Object.keys(FIELD_NORMALIZERS);
}

/**
 * 规范化 SQL 语句中 INSERT/UPDATE 语句里受约束字段的值
 *
 * 这是一个更高层的函数，用于运行时 SQL 写入链路。
 * 它会解析 SQL 语句中的列名列表和对应的值，对白名单字段做值规范化。
 *
 * 注意：此函数在 normalizeSqlStructure 之后调用，
 * 此时 SQL 已经是 ASCII 兼容的，可以安全地用正则提取列名和值。
 *
 * @param sql 单条 SQL 语句
 * @returns 值已规范化的 SQL 语句（如果发生了修改），或原语句
 */
export function normalizeStatementValues(sql: string): string {
  if (!sql || typeof sql !== 'string') return sql;

  const normalizedCols = getNormalizedColumnNames();
  if (normalizedCols.length === 0) return sql;

  // 尝试匹配 INSERT INTO table (col1, col2, ...) VALUES (val1, val2, ...);
  let result = tryNormalizeInsertValues(sql, normalizedCols);

  // 尝试匹配 UPDATE table SET col1 = val1, col2 = val2 WHERE ...
  if (result === sql) {
    result = tryNormalizeUpdateValues(sql, normalizedCols);
  }

  return result;
}

/**
 * 规范化 INSERT 语句中受约束字段的值
 *
 * 匹配格式：INSERT INTO table (col1, col2, ...) VALUES (val1, val2, ...)
 * 对白名单列对应的值做规范化
 */
function tryNormalizeInsertValues(sql: string, normalizedCols: string[]): string {
  // 匹配 INSERT INTO table (columns) VALUES (values)
  const insertMatch = sql.match(
    /^(INSERT\s+INTO\s+\w+\s*)\(([^)]+)\)(\s*VALUES\s*)\((.+)\)\s*;?\s*$/is
  );
  if (!insertMatch) return sql;

  const prefix = insertMatch[1];
  const columnsStr = insertMatch[2];
  const valuesKeyword = insertMatch[3];
  const valuesStr = insertMatch[4];

  // 解析列名
  const columns = splitColumnList(columnsStr);
  if (columns.length === 0) return sql;

  // 解析值列表（需要处理字符串内的逗号）
  const values = splitValueList(valuesStr);
  if (values.length !== columns.length) return sql;

  // 检查是否有任何列需要规范化
  let hasChange = false;
  const normalizedValues: string[] = [];

  for (let i = 0; i < columns.length; i++) {
    const colName = columns[i].trim();
    const rawValue = values[i].trim();

    if (normalizedCols.includes(colName.toLowerCase()) && isQuotedString(rawValue)) {
      // 提取引号内的值
      const innerValue = rawValue.slice(1, -1).replace(/''/g, "'");
      const normalizedInner = normalizeConstrainedValue(colName, innerValue);
      if (normalizedInner !== innerValue) {
        hasChange = true;
        normalizedValues.push(`'${normalizedInner.replace(/'/g, "''")}'`);
      } else {
        normalizedValues.push(rawValue);
      }
    } else {
      normalizedValues.push(rawValue);
    }
  }

  if (!hasChange) return sql;

  const suffix = sql.trimEnd().endsWith(';') ? ';' : '';
  return `${prefix}(${columns.join(', ')})${valuesKeyword}(${normalizedValues.join(', ')})${suffix}`;
}

/**
 * 规范化 UPDATE 语句中受约束字段的值
 *
 * 匹配格式：UPDATE table SET col1 = val1, col2 = val2 WHERE ...
 * 对白名单列对应的值做规范化
 */
function tryNormalizeUpdateValues(sql: string, normalizedCols: string[]): string {
  // 匹配 UPDATE table SET col1 = val1, col2 = val2 ...
  const updateMatch = sql.match(
    /^(UPDATE\s+\w+\s+SET\s+)(.+?)(\s+WHERE\s+.+)?$/is
  );
  if (!updateMatch) return sql;

  const prefix = updateMatch[1];
  const setClauses = updateMatch[2];
  const whereClause = updateMatch[3] || '';

  // 按 SET 子句中的逗号拆分（需要跳过字符串内的逗号）
  const assignments = splitSetClauses(setClauses);
  let hasChange = false;
  const normalizedAssignments: string[] = [];

  for (const assignment of assignments) {
    // 匹配 col = value
    const assignMatch = assignment.match(/^(\s*\w+\s*)=\s*(.+)$/s);
    if (!assignMatch) {
      normalizedAssignments.push(assignment);
      continue;
    }

    const colName = assignMatch[1].trim();
    const rawValue = assignMatch[2].trim();

    if (normalizedCols.includes(colName.toLowerCase()) && isQuotedString(rawValue)) {
      const innerValue = rawValue.slice(1, -1).replace(/''/g, "'");
      const normalizedInner = normalizeConstrainedValue(colName, innerValue);
      if (normalizedInner !== innerValue) {
        hasChange = true;
        normalizedAssignments.push(`${assignMatch[1]}= '${normalizedInner.replace(/'/g, "''")}'`);
      } else {
        normalizedAssignments.push(assignment);
      }
    } else {
      normalizedAssignments.push(assignment);
    }
  }

  if (!hasChange) return sql;

  return `${prefix}${normalizedAssignments.join(', ')}${whereClause}`;
}

// ═══════════════════════════════════════════════════════════════
// 内部工具函数
// ═══════════════════════════════════════════════════════════════

/**
 * 拆分列名列表（逗号分隔）
 * "col1, col2, col3" → ["col1", "col2", "col3"]
 */
function splitColumnList(str: string): string[] {
  return str.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

/**
 * 拆分值列表（逗号分隔，但跳过字符串内的逗号）
 * "'val1', 'val,2', 3" → ["'val1'", "'val,2'", "3"]
 */
function splitValueList(str: string): string[] {
  const values: string[] = [];
  let current = '';
  let inStr = false;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];

    if (inStr) {
      current += ch;
      if (ch === "'") {
        if (i + 1 < str.length && str[i + 1] === "'") {
          current += str[i + 1];
          i++;
        } else {
          inStr = false;
        }
      }
    } else if (ch === "'") {
      inStr = true;
      current += ch;
    } else if (ch === ',') {
      values.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.trim()) {
    values.push(current);
  }

  return values;
}

/**
 * 拆分 SET 子句（逗号分隔，跳过字符串内的逗号）
 */
function splitSetClauses(str: string): string[] {
  const clauses: string[] = [];
  let current = '';
  let inStr = false;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];

    if (inStr) {
      current += ch;
      if (ch === "'") {
        if (i + 1 < str.length && str[i + 1] === "'") {
          current += str[i + 1];
          i++;
        } else {
          inStr = false;
        }
      }
    } else if (ch === "'") {
      inStr = true;
      current += ch;
    } else if (ch === ',') {
      clauses.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.trim()) {
    clauses.push(current);
  }

  return clauses;
}

/**
 * 判断值是否是引号包裹的字符串
 * "'hello'" → true, "123" → false, "NULL" → false
 */
function isQuotedString(value: string): boolean {
  return value.startsWith("'") && value.endsWith("'") && value.length >= 2;
}
