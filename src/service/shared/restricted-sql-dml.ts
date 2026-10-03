export type RestrictedSqlValue_ACU = string | number | null;

export interface RestrictedSqlInsert_ACU {
  kind: 'insert';
  table: string;
  values: Record<string, RestrictedSqlValue_ACU>;
}

export interface RestrictedSqlUpdate_ACU {
  kind: 'update';
  table: string;
  values: Record<string, RestrictedSqlValue_ACU>;
  where: Record<string, RestrictedSqlValue_ACU>;
}

export interface RestrictedSqlDelete_ACU {
  kind: 'delete';
  table: string;
  where: Record<string, RestrictedSqlValue_ACU>;
}

export type RestrictedSqlStatement_ACU = RestrictedSqlInsert_ACU | RestrictedSqlUpdate_ACU | RestrictedSqlDelete_ACU;

function unquoteIdentifier_ACU(value: string): string {
  return value.trim().replace(/^[`"]|[`"]$/g, '').toLowerCase();
}

function splitSqlList_ACU(value: string): string[] {
  const items: string[] = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "'") {
      if (quoted && value[index + 1] === "'") { index += 1; continue; }
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      items.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (quoted) throw new Error('SQL 字符串字面量未闭合');
  items.push(value.slice(start).trim());
  if (items.some(item => !item)) throw new Error('SQL 列表不能包含空项');
  return items;
}

function parseValue_ACU(raw: string): RestrictedSqlValue_ACU {
  const value = raw.trim();
  if (/^null$/i.test(value)) return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value))) return Number(value);
  if (/^'(?:[^']|'')*'$/.test(value)) return value.slice(1, -1).replace(/''/g, "'");
  const lookalike = /[\u2018\u2019\uFF07\u200B-\u200D\uFEFF]|\\'/.test(value) ? '（字符串须用英文半角单引号 \' 包裹，不能用 ‘’、＇、\\\' 或零宽字符）' : '';
  throw new Error(`SQL 值只允许字符串、数字或 NULL：${value}${lookalike}`);
}

/**
 * 模型偶尔用弯引号、全角引号、反斜杠转义或夹带零宽字符包裹字符串，界面上与英文单引号几乎无法区分。
 * 只在一条语句按原文解析失败后使用：零宽字符与 \' 总是可安全改写；弯/全角引号仅在该语句完全没有英文单引号时才当作定界符。
 */
export function normalizeSqlQuoteLookalikes_ACU(text: string): string {
  let next = text.replace(/[\u200B-\u200D\uFEFF]/g, '');
  // 全部单引号都带反斜杠时，\' 是被误用的定界符；否则是字符串内的转义，改成 SQL 的两个单引号。
  const bare = next.replace(/\\'/g, '').includes("'");
  next = next.replace(/\\'/g, bare ? "''" : "'");
  if (!next.includes("'")) next = next.replace(/[\u2018\u2019\uFF07]/g, "'");
  return next;
}

/**
 * 模型偶尔多写一个右括号（VALUES (...)) 或给 JSON 值又套一层括号），症状是最后一个值里残留 ')'。
 * 只在按原文解析失败后使用：仅当引号外的右括号多于左括号时，从尾部逐个去掉多余的右括号。
 */
export function normalizeSqlParenBalance_ACU(text: string): string {
  let depth = 0;
  let surplus = 0;
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "'") {
      if (quoted && text[index + 1] === "'") { index += 1; continue; }
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (char === '(') depth += 1;
    else if (char === ')') { if (depth > 0) depth -= 1; else surplus += 1; }
  }
  let result = text.trimEnd();
  while (surplus > 0 && result.endsWith(')')) {
    result = result.slice(0, -1).trimEnd();
    surplus -= 1;
  }
  return result;
}

function splitSqlAssignments_ACU(raw: string, mode: 'comma' | 'and'): string[] {
  const result: string[] = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "'") {
      if (quoted && raw[index + 1] === "'") { index += 1; continue; }
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (mode === 'comma' && char === ',') {
      result.push(raw.slice(start, index).trim());
      start = index + 1;
      continue;
    }
    if (mode === 'and' && /^\s+AND\s+/i.test(raw.slice(index))) {
      const separator = raw.slice(index).match(/^\s+AND\s+/i)![0];
      result.push(raw.slice(start, index).trim());
      index += separator.length - 1;
      start = index + 1;
    }
  }
  if (quoted) throw new Error('SQL 字符串字面量未闭合');
  result.push(raw.slice(start).trim());
  if (result.some(item => !item)) throw new Error('SQL 赋值或条件不能包含空项');
  return result;
}

function parseAssignments_ACU(raw: string, mode: 'comma' | 'and'): Record<string, RestrictedSqlValue_ACU> {
  const result: Record<string, RestrictedSqlValue_ACU> = {};
  for (const part of splitSqlAssignments_ACU(raw, mode)) {
    const match = part.match(/^([A-Za-z_][\w]*)\s*=\s*([\s\S]+)$/);
    if (!match) throw new Error(`SQL 条件或赋值必须是 column = value：${part}`);
    const key = unquoteIdentifier_ACU(match[1]);
    if (Object.prototype.hasOwnProperty.call(result, key)) throw new Error(`SQL 字段重复：${key}`);
    result[key] = parseValue_ACU(match[2]);
  }
  return result;
}

function splitStatements_ACU(sql: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    if (char === "'") {
      if (quoted && sql[index + 1] === "'") { index += 1; continue; }
      quoted = !quoted;
    } else if (char === ';' && !quoted) {
      const statement = sql.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  const tail = sql.slice(start).trim();
  if (tail) statements.push(tail);
  if (quoted) throw new Error('SQL 字符串字面量未闭合');
  return statements;
}

function parseOneStatement_ACU(statement: string): RestrictedSqlStatement_ACU {
    let match = statement.match(/^INSERT\s+INTO\s+([A-Za-z_][\w]*)\s*\(([^)]+)\)\s*VALUES\s*\(([\s\S]+)\)$/i);
    if (match) {
      const columns = splitSqlList_ACU(match[2]).map(unquoteIdentifier_ACU);
      const values = splitSqlList_ACU(match[3]).map(parseValue_ACU);
      if (new Set(columns).size !== columns.length) throw new Error('INSERT 字段不能重复');
      if (columns.length !== values.length) throw new Error(`INSERT 字段数与值数量不一致（${columns.length} 个字段、${values.length} 个值）。请逐项核对列名列表与 VALUES 一一对应：不要把正文内容写进列名，也不要漏写值；若正文含单引号，应写成两个单引号。id 和 expected_revision 可以不写`);
      return { kind: 'insert', table: unquoteIdentifier_ACU(match[1]), values: Object.fromEntries(columns.map((column, index) => [column, values[index]])) };
    }
    match = statement.match(/^UPDATE\s+([A-Za-z_][\w]*)\s+SET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+)$/i);
    if (match) {
      const values = parseAssignments_ACU(match[2], 'comma');
      const where = parseAssignments_ACU(match[3], 'and');
      if (!Object.keys(values).length || !Object.keys(where).length) throw new Error('UPDATE 必须包含 SET 与 WHERE');
      return { kind: 'update', table: unquoteIdentifier_ACU(match[1]), values, where };
    }
    match = statement.match(/^DELETE\s+FROM\s+([A-Za-z_][\w]*)\s+WHERE\s+([\s\S]+)$/i);
    if (match) {
      const where = parseAssignments_ACU(match[2], 'and');
      if (!Object.keys(where).length) throw new Error('DELETE 必须包含 WHERE');
      return { kind: 'delete', table: unquoteIdentifier_ACU(match[1]), where };
    }
    throw new Error(`只允许 INSERT、UPDATE、DELETE：${statement.slice(0, 80)}`);
}

export function parseRestrictedSqlDml_ACU(sql: string): RestrictedSqlStatement_ACU[] {
  const source = String(sql ?? '').replace(/```sql|```/gi, '').trim();
  if (!source) return [];
  return splitStatements_ACU(source).map(parseOneStatement_ACU);
}

/** 仅供纠错关联，不是可写入的语句；列值不匹配时只信任第一个明确的配对。 */
export interface RestrictedSqlRepairTarget_ACU {
  table: string;
  column: string;
  value: RestrictedSqlValue_ACU;
  columns: string[];
}

function inspectSqlRepairTarget_ACU(text: string): RestrictedSqlRepairTarget_ACU | undefined {
  try {
    const insert = text.match(/^INSERT\s+INTO\s+([A-Za-z_][\w]*)\s*\(([^)]+)\)\s*VALUES\s*\(([\s\S]+)\)$/i);
    if (insert) {
      const columns = splitSqlList_ACU(insert[2]).map(unquoteIdentifier_ACU);
      const values = splitSqlList_ACU(insert[3]);
      if (!/^[A-Za-z_][\w]*$/.test(columns[0] ?? '') || !values.length) return undefined;
      return { table: unquoteIdentifier_ACU(insert[1]), column: columns[0], value: parseValue_ACU(values[0]), columns };
    }
    const update = text.match(/^UPDATE\s+([A-Za-z_][\w]*)\s+SET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+)$/i);
    if (update) {
      const where = parseAssignments_ACU(update[3], 'and');
      if (typeof where.id !== 'string' || !where.id.trim() || Object.keys(where).some(key => !['id', 'expected_revision'].includes(key))) return undefined;
      const columns = splitSqlAssignments_ACU(update[2], 'comma').map(part => /^([A-Za-z_][\w]*)\s*=/.exec(part)?.[1]?.toLowerCase() ?? '');
      if (columns.some(column => !column)) return undefined;
      return { table: unquoteIdentifier_ACU(update[1]), column: 'id', value: where.id, columns };
    }
  } catch { /* 不能可靠识别时保留未关联诊断，不猜测目标。 */ }
  return undefined;
}

export interface RestrictedSqlTolerantResult_ACU {
  statements: RestrictedSqlStatement_ACU[];
  /** 与 statements 一一对应，保留坏语句前后的原始位置。 */
  statementIndexes: number[];
  rejected: Array<{ index: number; text: string; reason: string; repairTarget?: RestrictedSqlRepairTarget_ACU }>;
}

/** 按独立语句保留合法写集；无法确定的语法只报告拒绝，不猜补列或值。 */
export function parseRestrictedSqlDmlTolerant_ACU(sql: string): RestrictedSqlTolerantResult_ACU {
  let source = String(sql ?? '').replace(/```sql|```/gi, '').trim();
  const scan = (value: string): { parts: string[]; tail: string; open: boolean } => {
    const parts: string[] = [];
    let start = 0;
    let open = false;
    for (let index = 0; index < value.length; index += 1) {
      if (value[index] === "'") {
        if (open && value[index + 1] === "'") { index += 1; continue; }
        open = !open;
      } else if (value[index] === ';' && !open) {
        const part = value.slice(start, index).trim();
        if (part) parts.push(part);
        start = index + 1;
      }
    }
    return { parts, tail: value.slice(start).trim(), open };
  };
  let scanned = scan(source);
  if (scanned.open && source.endsWith("'") && !scan(source.slice(0, -1)).open) {
    source = source.slice(0, -1).trimEnd();
    scanned = scan(source);
  }
  // 引号不配平时，常见原因是正文里的 \' 转义或近似引号；归一后能配平才采用，否则保留原文按原规则报错。
  if (scanned.open) {
    const normalized = normalizeSqlQuoteLookalikes_ACU(source);
    const rescanned = scan(normalized);
    if (normalized !== source && !rescanned.open) {
      source = normalized;
      scanned = rescanned;
    }
  }
  const rejected: RestrictedSqlTolerantResult_ACU['rejected'] = [];
  const statements: RestrictedSqlStatement_ACU[] = [];
  const statementIndexes: number[] = [];
  const parts = [...scanned.parts, ...(scanned.tail ? [scanned.tail] : [])];
  parts.forEach((text, index) => {
    if (scanned.open && index === parts.length - 1) {
      rejected.push({ index, text, reason: '字符串字面量未闭合' });
      return;
    }
    try { statements.push(parseOneStatement_ACU(text)); statementIndexes.push(index); }
    catch (error) {
      // 逐个尝试可安全改写的形状：引号近似字符、尾部多余右括号，以及两者叠加。
      const quoteFixed = normalizeSqlQuoteLookalikes_ACU(text);
      const variants = [quoteFixed, normalizeSqlParenBalance_ACU(text), normalizeSqlParenBalance_ACU(quoteFixed)];
      for (const variant of variants) {
        if (variant === text) continue;
        try { statements.push(parseOneStatement_ACU(variant)); statementIndexes.push(index); return; } catch { /* 换下一种改写 */ }
      }
      const repairTarget = inspectSqlRepairTarget_ACU(text);
      rejected.push({ index, text, reason: error instanceof Error ? error.message : String(error), ...(repairTarget ? { repairTarget } : {}) });
    }
  });
  return { statements, statementIndexes, rejected };
}
