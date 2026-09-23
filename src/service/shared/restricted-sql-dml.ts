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
  throw new Error(`SQL 值只允许字符串、数字或 NULL：${value}`);
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

export function parseRestrictedSqlDml_ACU(sql: string): RestrictedSqlStatement_ACU[] {
  const source = String(sql ?? '').replace(/```sql|```/gi, '').trim();
  if (!source) return [];
  return splitStatements_ACU(source).map(statement => {
    let match = statement.match(/^INSERT\s+INTO\s+([A-Za-z_][\w]*)\s*\(([^)]+)\)\s*VALUES\s*\(([\s\S]+)\)$/i);
    if (match) {
      const columns = splitSqlList_ACU(match[2]).map(unquoteIdentifier_ACU);
      const values = splitSqlList_ACU(match[3]).map(parseValue_ACU);
      if (new Set(columns).size !== columns.length) throw new Error('INSERT 字段不能重复');
      if (columns.length !== values.length) throw new Error('INSERT 字段数与值数量不一致');
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
  });
}
