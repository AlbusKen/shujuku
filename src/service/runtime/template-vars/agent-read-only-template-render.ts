import { logDebug_ACU, logWarn_ACU } from '../../../shared/utils';
import { evaluateRawSqlExpression, TableQueryBuilder, withSqlTemplateReadContext_ACU, type SqlTemplateReadContext_ACU } from './sql-query-var';
import { isSqliteMode } from '../../table/storage-mode';
import { validateReadOnlySql_ACU } from './read-only-sql-validation';
import { currentJsonTableData_ACU } from '../state-manager';
import { getNameMapper } from './name-mapper';
import { resolveReadQuerySql_ACU } from '../../../shared/sql-read-resolver';

export interface AgentTemplatePart_ACU {
  kind: 'text' | 'query';
  value: string;
}

export interface AgentReadOnlyRenderResult_ACU {
  content: string;
  tagCount: number;
  executedCount: number;
  rejectedCount: number;
}

const ORM_CHAIN_METHODS_ACU = new Set([
  'where', 'orWhere', 'whereIn', 'whereBetween', 'groupBy', 'distinct', 'whereNotIn',
  'whereNull', 'whereNotNull', 'whereLike', 'orderBy', 'limit', 'offset', 'get', 'first',
  'list', 'all', 'count', 'sum', 'avg', 'max', 'min', 'exists',
]);
const ORM_TERMINAL_METHODS_ACU = new Set(['get', 'first', 'list', 'all', 'count', 'sum', 'avg', 'max', 'min', 'exists']);

export function splitAgentQueryTemplateParts_ACU(content: string): AgentTemplatePart_ACU[] {
  const source = String(content || '');
  const parts: AgentTemplatePart_ACU[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const dbIndex = source.indexOf('{[db.', cursor);
    const sqlIndex = source.indexOf('{[sql ', cursor);
    const candidates = [dbIndex, sqlIndex].filter(index => index >= 0);
    if (candidates.length === 0) {
      parts.push({ kind: 'text', value: source.slice(cursor) });
      break;
    }
    const start = Math.min(...candidates);
    if (start > cursor) parts.push({ kind: 'text', value: source.slice(cursor, start) });
    let quote = '';
    let bracketDepth = 1;
    let end = -1;
    for (let index = start + 2; index < source.length; index++) {
      const char = source[index];
      if (quote) {
        if (char === quote && source[index - 1] !== '\\') quote = '';
        continue;
      }
      if (char === "'" || char === '"' || char === '`') {
        quote = char;
        continue;
      }
      if (char === '[') bracketDepth++;
      if (char === ']') {
        bracketDepth--;
        if (bracketDepth === 0 && source[index + 1] === '}') {
          end = index + 2;
          break;
        }
      }
    }
    if (end < 0) {
      parts.push({ kind: 'text', value: source.slice(start) });
      break;
    }
    parts.push({ kind: 'query', value: source.slice(start, end) });
    cursor = end;
  }
  return parts.length > 0 ? parts : [{ kind: 'text', value: source }];
}

function splitAlias_ACU(expression: string): { expression: string; alias: string | null } {
  const match = expression.match(/^([\s\S]*?)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i);
  return match ? { expression: match[1].trim(), alias: match[2] } : { expression: expression.trim(), alias: null };
}

function replaceLocalAliasesInExpression_ACU(expression: string, aliases: Map<string, string>): string {
  return expression.replace(/\$v:([A-Za-z_][A-Za-z0-9_]*)/g, (raw, name) => (
    aliases.has(name) ? JSON.stringify(aliases.get(name)) : raw
  ));
}

function replaceLocalAliasesInText_ACU(content: string, aliases: Map<string, string>): string {
  return content.replace(/\$v:([A-Za-z_][A-Za-z0-9_]*)/g, (raw, name) => (
    aliases.has(name) ? String(aliases.get(name)) : raw
  ));
}

function splitTopLevelArguments_ACU(source: string): string[] {
  const trimmed = source.trim();
  if (!trimmed) return [];
  const result: string[] = [];
  let start = 0;
  let quote = '';
  let depth = 0;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (char === quote && source[index - 1] !== '\\') quote = '';
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '[') depth++;
    if (char === ']') depth--;
    if (char === ',' && depth === 0) {
      result.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (quote || depth !== 0) throw new Error('orm_argument_syntax_invalid');
  result.push(source.slice(start).trim());
  return result;
}

function parseOrmLiteral_ACU(source: string): unknown {
  const value = source.trim();
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) return Number(value);
  if (/^(?:true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  if (/^null$/i.test(value)) return null;
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    const quote = value[0];
    return value.slice(1, -1)
      .replace(new RegExp(`\\\\${quote}`, 'g'), quote)
      .replace(/\\\\n/g, '\n')
      .replace(/\\\\r/g, '\r')
      .replace(/\\\\t/g, '\t')
      .replace(/\\\\\\\\/g, '\\');
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    return splitTopLevelArguments_ACU(value.slice(1, -1)).map(parseOrmLiteral_ACU);
  }
  throw new Error('orm_literal_not_allowed');
}

function parseOrmChain_ACU(expression: string): { tableName: string; calls: Array<{ method: string; args: unknown[] }> } {
  const tableMatch = expression.match(/^db\.([^\s.()[\]{};]+)/u);
  if (!tableMatch) throw new Error('orm_table_invalid');
  const tableName = tableMatch[1];
  const calls: Array<{ method: string; args: unknown[] }> = [];
  let cursor = tableMatch[0].length;
  while (cursor < expression.length) {
    const methodMatch = expression.slice(cursor).match(/^\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (!methodMatch) throw new Error('orm_chain_invalid');
    const method = methodMatch[1];
    if (!ORM_CHAIN_METHODS_ACU.has(method)) throw new Error('orm_method_not_allowed');
    const argsStart = cursor + methodMatch[0].length;
    let quote = '';
    let arrayDepth = 0;
    let parenDepth = 1;
    let end = -1;
    for (let index = argsStart; index < expression.length; index++) {
      const char = expression[index];
      if (quote) {
        if (char === quote && expression[index - 1] !== '\\') quote = '';
        continue;
      }
      if (char === "'" || char === '"') {
        quote = char;
        continue;
      }
      if (char === '[') arrayDepth++;
      if (char === ']') arrayDepth--;
      if (arrayDepth === 0 && char === '(') parenDepth++;
      if (arrayDepth === 0 && char === ')') {
        parenDepth--;
        if (parenDepth === 0) {
          end = index;
          break;
        }
      }
    }
    if (end < 0) throw new Error('orm_parenthesis_unclosed');
    const args = splitTopLevelArguments_ACU(expression.slice(argsStart, end)).map(parseOrmLiteral_ACU);
    calls.push({ method, args });
    cursor = end + 1;
  }
  if (calls.length === 0 || !ORM_TERMINAL_METHODS_ACU.has(calls[calls.length - 1].method)) {
    throw new Error('orm_terminal_required');
  }
  if (calls.slice(0, -1).some(call => ORM_TERMINAL_METHODS_ACU.has(call.method))) {
    throw new Error('orm_terminal_must_be_last');
  }
  return { tableName, calls };
}

function evaluateAgentOrmExpression_ACU(expression: string): string {
  const parsed = parseOrmChain_ACU(expression);
  let current: unknown = new TableQueryBuilder(parsed.tableName, {
    throwOnQueryError: true,
    suppressQueryErrorLog: true,
  });
  for (const call of parsed.calls) {
    const method = (current as Record<string, unknown>)?.[call.method];
    if (typeof method !== 'function') throw new Error('orm_method_unavailable');
    current = method.apply(current, call.args);
  }
  if (current === null || typeof current === 'undefined') return '';
  if (typeof current === 'string' || typeof current === 'number' || typeof current === 'boolean') return String(current);
  return JSON.stringify(current);
}

function extractRawSql_ACU(expression: string): string | null {
  const match = expression.match(/^sql\s+(["'])([\s\S]*)\1$/i);
  return match ? match[2] : null;
}

export function renderAgentReadOnlyQueryTemplates_ACU(content: string, sqlReadContext?: SqlTemplateReadContext_ACU | null): AgentReadOnlyRenderResult_ACU {
  return withSqlTemplateReadContext_ACU(sqlReadContext, () => renderScopedAgentQueries_ACU(content, sqlReadContext));
}

function renderScopedAgentQueries_ACU(content: string, sqlReadContext?: SqlTemplateReadContext_ACU | null): AgentReadOnlyRenderResult_ACU {
  const parts = splitAgentQueryTemplateParts_ACU(content);
  const aliases = new Map<string, string>();
  let tagCount = 0;
  let executedCount = 0;
  let rejectedCount = 0;
  const rendered = parts.map(part => {
    if (part.kind === 'text') {
      return replaceLocalAliasesInText_ACU(part.value, aliases);
    }
    tagCount++;
    if (!(sqlReadContext === undefined ? isSqliteMode() : sqlReadContext !== null) || part.value.includes('{{')) {
      rejectedCount++;
      return part.value;
    }
    const inner = part.value.slice(2, -2).trim();
    const { expression, alias } = splitAlias_ACU(inner);
    try {
      let value: string;
      if (expression.startsWith('db.')) {
        const resolved = replaceLocalAliasesInExpression_ACU(expression, aliases);
        value = evaluateAgentOrmExpression_ACU(resolved);
      } else {
        const rawSql = extractRawSql_ACU(expression);
        if (rawSql === null) throw new Error('query_tag_not_supported');
        const before = validateReadOnlySql_ACU(rawSql);
        const mapper = sqlReadContext?.mapper ?? getNameMapper();
        const translated = resolveReadQuerySql_ACU(rawSql, sqlReadContext?.tableData ?? currentJsonTableData_ACU as any, mapper.translateSql.bind(mapper)).sql;
        const after = validateReadOnlySql_ACU(translated);
        if (!before.valid || !after.valid) throw new Error(before.reason || after.reason || 'sql_not_allowed');
        value = evaluateRawSqlExpression(`sql ${JSON.stringify(rawSql)}`, {
          throwOnError: true,
          suppressQueryErrorLog: true,
        });
      }
      executedCount++;
      if (alias) {
        aliases.set(alias, value);
        return '';
      }
      return value;
    } catch (error: any) {
      rejectedCount++;
      logWarn_ACU(`[AgentPromptSQL] query rejected; reason=${String(error?.message || 'unknown')}`);
      return part.value;
    }
  }).join('');
  logDebug_ACU(`[AgentPromptSQL] tags=${tagCount}; executed=${executedCount}; rejected=${rejectedCount}`);
  return { content: rendered, tagCount, executedCount, rejectedCount };
}
