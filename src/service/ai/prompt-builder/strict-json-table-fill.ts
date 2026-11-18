import { getSortedSheetKeys_ACU } from '../../template/chat-scope';
import { getSheetColumnProjection_ACU } from '../../../shared/ddl-utils';
import { rebindSheetKeysThroughTableAliases_ACU, SheetTableAliasResolutionError_ACU } from '../../../shared/sql-read-resolver';

export type StrictJsonTableFillFormat_ACU = 'table_edit_ops_v1' | 'table_edit_sql_v1';

export interface StrictJsonTableFillExtraction_ACU {
  ok: boolean;
  format?: StrictJsonTableFillFormat_ACU;
  normalizedResponse?: string;
  tableEditText?: string;
  rawJson?: any;
  error?: string;
  retryHint?: string;
  modifiedKeys?: string[];
}

export interface StrictJsonSchemaStats_ACU {
  sheetCount: number;
  maxFieldCount: number;
  totalFieldCount: number;
  oneOfBranchCount: number;
  responseFormatBytes: number;
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function stripCodeFence(text: string): string {
  const trimmed = String(text || '').trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fence ? fence[1].trim() : trimmed;
}

function tryParseJsonObject(text: string): any {
  const cleaned = stripCodeFence(text);
  try {
    return JSON.parse(cleaned);
  } catch {}
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return JSON.parse(cleaned.slice(start, end + 1));
  }
  throw new Error('回复不是合法 JSON 对象。');
}

function isPlainObject(value: any): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function buildSheetLookup(tableData: any, targetSheetKeys?: string[] | null) {
  const sortedKeys = getSortedSheetKeys_ACU(tableData || {});
  const allowed = Array.isArray(targetSheetKeys) && targetSheetKeys.length > 0 ? new Set(targetSheetKeys) : null;
  const entries = sortedKeys
    .filter((sheetKey) => !allowed || allowed.has(sheetKey))
    .map((sheetKey, index) => ({ sheetKey, index: sortedKeys.indexOf(sheetKey), table: tableData[sheetKey] }))
    .filter((entry) => entry.table && Array.isArray(entry.table.content));
  return { sortedKeys, entries };
}

function resolveSheet(sheet: any, tableData: any, targetSheetKeys?: string[] | null) {
  const name = String(sheet ?? '').trim();
  if (!name) throw new Error('sheet 不能为空。');
  const { sortedKeys, entries } = buildSheetLookup(tableData);
  let sheetKey: string;
  try {
    [sheetKey] = rebindSheetKeysThroughTableAliases_ACU([name], null, tableData);
  } catch (error) {
    if (error instanceof SheetTableAliasResolutionError_ACU) {
      throw new Error(`sheet 名称无效：${error.message}`);
    }
    throw error;
  }
  if (!sheetKey) throw new Error(`sheet 未匹配到可编辑表格：${name}`);
  const entry = entries.find(candidate => candidate.sheetKey === sheetKey);
  if (!entry) throw new Error(`sheet 未匹配到可编辑表格：${name}`);
  if (Array.isArray(targetSheetKeys) && targetSheetKeys.length > 0 && !targetSheetKeys.includes(sheetKey)) {
    throw new Error(`sheet 越权：${name} 解析为非目标表 ${sheetKey}。`);
  }
  return { ...entry, index: sortedKeys.indexOf(sheetKey) };
}

function getHeaderMap(table: any) {
  // 值为 -1 表示该可见表头不唯一：不能静默取最后一列，否则会把值写进错误的物理列。
  const map = new Map<string, number>();
  getSheetColumnProjection_ACU(table).visibleColumns.forEach((column) => {
    if (column.sourceIndex === 0) return;
    const key = String(column.header ?? '').trim();
    if (key) map.set(key, map.has(key) ? -1 : column.sourceIndex - 1);
  });
  return map;
}

function getWritableFields(headerMap: Map<string, number>): string[] {
  return Array.from(headerMap.entries()).filter(([, index]) => index >= 0).map(([field]) => field);
}

function normalizeValueObject(value: any, headerMap: Map<string, number>, label: string): Record<string, string> {
  if (!isPlainObject(value)) throw new Error(`${label} 必须是对象。`);
  const result: Record<string, string> = {};
  for (const [field, raw] of Object.entries(value)) {
    if (!headerMap.has(field)) throw new Error(`字段名不存在：${field}`);
    if (headerMap.get(field)! < 0) throw new Error(`字段名不唯一：${field}，同一表存在多个同名可见列。`);
    if (raw === undefined || raw === null) result[field] = '';
    else result[field] = String(raw);
  }
  return result;
}

function findUniqueRowIndex(table: any, where: Record<string, string>, headerMap: Map<string, number>): number {
  const whereKeys = Object.keys(where);
  if (whereKeys.length === 0) throw new Error('where 必须至少包含一个字段。');
  const rows = Array.isArray(table.content) ? table.content.slice(1) : [];
  const matches: number[] = [];
  rows.forEach((row: any[], rowIndex: number) => {
    const ok = whereKeys.every((field) => {
      const col = headerMap.get(field);
      return col !== undefined && String(row[col + 1] ?? '') === where[field];
    });
    if (ok) matches.push(rowIndex);
  });
  if (matches.length === 0) throw new Error('where 未匹配到任何行。');
  if (matches.length > 1) throw new Error('where 匹配到多行，请增加定位条件。');
  return matches[0];
}

function valuesToColumnObject(values: Record<string, string>, headerMap: Map<string, number>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, value] of Object.entries(values)) {
    const idx = headerMap.get(field);
    if (idx === undefined) throw new Error(`字段名不存在：${field}`);
    out[String(idx)] = value;
  }
  return out;
}

function assertOnlyKeys(value: Record<string, any>, allowed: string[], label: string) {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) throw new Error(`${label} 包含不允许的字段：${key}`);
  }
}

export function convertStrictOpsToTableEdit_ACU(ops: any[], tableData: any, targetSheetKeys?: string[] | null) {
  if (!Array.isArray(ops)) throw new Error('ops 必须是数组。');
  const lines: string[] = [];
  const modifiedKeys = new Set<string>();
  for (const op of ops) {
    if (!isPlainObject(op)) throw new Error('ops 中的每一项都必须是对象。');
    const kind = String(op.op || '').trim();
    const entry = resolveSheet(op.sheet, tableData, targetSheetKeys);
    const headerMap = getHeaderMap(entry.table);
    if (kind === 'insert') {
      assertOnlyKeys(op, ['op', 'sheet', 'row'], 'insert');
      const row = normalizeValueObject(op.row, headerMap, 'row');
      lines.push(`insertRow(${entry.index}, ${JSON.stringify(valuesToColumnObject(row, headerMap))})`);
      modifiedKeys.add(entry.sheetKey);
    } else if (kind === 'update') {
      assertOnlyKeys(op, ['op', 'sheet', 'where', 'set'], 'update');
      const where = normalizeValueObject(op.where, headerMap, 'where');
      const set = normalizeValueObject(op.set, headerMap, 'set');
      if (Object.keys(set).length === 0) throw new Error('set 必须至少包含一个字段。');
      const rowIndex = findUniqueRowIndex(entry.table, where, headerMap);
      lines.push(`updateRow(${entry.index}, ${rowIndex}, ${JSON.stringify(valuesToColumnObject(set, headerMap))})`);
      modifiedKeys.add(entry.sheetKey);
    } else if (kind === 'delete') {
      assertOnlyKeys(op, ['op', 'sheet', 'where'], 'delete');
      const where = normalizeValueObject(op.where, headerMap, 'where');
      const rowIndex = findUniqueRowIndex(entry.table, where, headerMap);
      lines.push(`deleteRow(${entry.index}, ${rowIndex})`);
      modifiedKeys.add(entry.sheetKey);
    } else {
      throw new Error(`不支持的 op：${kind}`);
    }
  }
  const tableEditText = lines.join('\n');
  return {
    tableEditText,
    normalizedResponse: `<tableEdit>\n${tableEditText}\n</tableEdit>`,
    modifiedKeys: Array.from(modifiedKeys),
  };
}

export function extractStrictJsonTableFillResponse_ACU(text: string, options: { sqlite?: boolean; tableData?: any; targetSheetKeys?: string[] | null } = {}): StrictJsonTableFillExtraction_ACU {
  try {
    const parsed = tryParseJsonObject(text);
    if (!isPlainObject(parsed)) throw new Error('回复 JSON 根节点必须是对象。');
    const expected = options.sqlite ? 'table_edit_sql_v1' : 'table_edit_ops_v1';
    if (parsed.format !== expected) throw new Error(`format 必须是 ${expected}。`);
    if (expected === 'table_edit_sql_v1') {
      if (typeof parsed.sql !== 'string') throw new Error('sql 必须是字符串。');
      const tableEditText = parsed.sql.trim();
      return { ok: true, format: expected, rawJson: parsed, tableEditText, normalizedResponse: `<tableEdit>\n${tableEditText}\n</tableEdit>` };
    }
    const converted = convertStrictOpsToTableEdit_ACU(parsed.ops, options.tableData, options.targetSheetKeys);
    return { ok: true, format: expected, rawJson: parsed, ...converted };
  } catch (error: any) {
    const message = error?.message || '严格 JSON 填表响应解析失败。';
    return { ok: false, error: message, retryHint: message };
  }
}

export function buildStrictJsonTableFillResponseFormat_ACU(sqlite: boolean): any {
  if (sqlite) {
    return {
      type: 'json_schema',
      json_schema: {
        name: 'table_edit_sql_response',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['format', 'sql'],
          properties: {
            format: { type: 'string', enum: ['table_edit_sql_v1'] },
            sql: { type: 'string' },
          },
        },
      },
    };
  }
  return buildWideNativeResponseFormat();
}

function buildWideNativeResponseFormat() {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'table_edit_ops_response',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['format', 'ops'],
        properties: {
          format: { type: 'string', enum: ['table_edit_ops_v1'] },
          ops: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              required: ['op', 'sheet'],
              properties: {
                op: { type: 'string', enum: ['insert', 'update', 'delete'] },
                sheet: { type: 'string' },
                row: { type: 'object', additionalProperties: { type: 'string' } },
                where: { type: 'object', additionalProperties: { type: 'string' } },
                set: { type: 'object', additionalProperties: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  };
}

function fieldObjectSchema(fields: string[], minProperties = 0) {
  const properties: Record<string, any> = {};
  fields.forEach((field) => { properties[field] = { type: 'string' }; });
  return { type: 'object', additionalProperties: false, minProperties, properties };
}

export function shouldUseWideStrictJsonSchema_ACU(stats: StrictJsonSchemaStats_ACU): boolean {
  return stats.sheetCount > 8
    || stats.maxFieldCount > 32
    || stats.totalFieldCount > 120
    || stats.oneOfBranchCount > 48
    || stats.responseFormatBytes > 24 * 1024;
}

export function buildStrictJsonTableFillResponseFormatForData_ACU(sqlite: boolean, tableData?: any, targetSheetKeys?: string[] | null): { responseFormat: any; stats: StrictJsonSchemaStats_ACU | null; wide: boolean } {
  if (sqlite) return { responseFormat: buildStrictJsonTableFillResponseFormat_ACU(true), stats: null, wide: false };
  const { entries } = buildSheetLookup(tableData || {}, targetSheetKeys);
  const branches: any[] = [];
  let totalFieldCount = 0;
  let maxFieldCount = 0;
  entries.forEach((entry) => {
    const fields = getWritableFields(getHeaderMap(entry.table));
    totalFieldCount += fields.length;
    maxFieldCount = Math.max(maxFieldCount, fields.length);
    const sheetConst = String(entry.table?.name || entry.sheetKey);
    branches.push({
      type: 'object',
      additionalProperties: false,
      required: ['op', 'sheet', 'row'],
      properties: { op: { type: 'string', enum: ['insert'] }, sheet: { type: 'string', enum: [sheetConst] }, row: fieldObjectSchema(fields, 1) },
    });
    branches.push({
      type: 'object',
      additionalProperties: false,
      required: ['op', 'sheet', 'where', 'set'],
      properties: { op: { type: 'string', enum: ['update'] }, sheet: { type: 'string', enum: [sheetConst] }, where: fieldObjectSchema(fields, 1), set: fieldObjectSchema(fields, 1) },
    });
    branches.push({
      type: 'object',
      additionalProperties: false,
      required: ['op', 'sheet', 'where'],
      properties: { op: { type: 'string', enum: ['delete'] }, sheet: { type: 'string', enum: [sheetConst] }, where: fieldObjectSchema(fields, 1) },
    });
  });
  if (branches.length === 0) return { responseFormat: buildWideNativeResponseFormat(), stats: { sheetCount: 0, maxFieldCount: 0, totalFieldCount: 0, oneOfBranchCount: 0, responseFormatBytes: 0 }, wide: true };
  const strong = {
    type: 'json_schema',
    json_schema: {
      name: 'table_edit_ops_response',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['format', 'ops'],
        properties: {
          format: { type: 'string', enum: ['table_edit_ops_v1'] },
          ops: { type: 'array', items: { oneOf: branches } },
        },
      },
    },
  };
  const stats: StrictJsonSchemaStats_ACU = {
    sheetCount: entries.length,
    maxFieldCount,
    totalFieldCount,
    oneOfBranchCount: branches.length,
    responseFormatBytes: JSON.stringify(strong).length,
  };
  if (shouldUseWideStrictJsonSchema_ACU(stats)) return { responseFormat: buildWideNativeResponseFormat(), stats, wide: true };
  return { responseFormat: strong, stats, wide: false };
}

export function cloneStrictPromptSegments_ACU(value: any, fallback: any) {
  const source = Array.isArray(value) && value.length > 0 ? value : fallback;
  return jsonClone(source || []);
}
