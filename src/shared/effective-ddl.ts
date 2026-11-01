import type { Sheet_ACU } from './models/table-data';
import { logDebug_ACU } from './utils';
import { mapSqlColumnIdentifiers_ACU } from './sql-identifier-mapper';
import { normalizeSqlStructure } from './sql-structure';
import { matchesDDLColumnHeader_ACU, parseDDLColumnInfos_ACU, parseDDLTableName, rebindCreateTableName_ACU } from './ddl-utils';

export interface EffectiveDDLColumnMap_ACU {
  mappings: ReadonlyArray<{ sourceIndex: number; displayName: string; sqlName: string; required: boolean }>;
  sqlToDisplay: Map<string, string>;
}

export interface EffectiveDDLResult_ACU {
  originalDDL: string;
  effectiveDDL: string;
  source: 'explicit' | 'fallback_missing' | 'fallback_invalid';
  diagnostics: string[];
  columnMap: EffectiveDDLColumnMap_ACU;
}

function resolveInsertColumnMappings(sheet: Sheet_ACU, headers: readonly string[], ddlOverride?: string): InsertColumnMapping[] {
  const ddl = ddlOverride || sheet.sourceData?.ddl?.trim();
  if (!ddl) {
    const nullPreservingHeaders = headers.map(header => (header === null || header === undefined ? null : String(header)));
    return createSheetInsertPlan(sheet, buildFallbackColumnMap_ACU(nullPreservingHeaders)).mappings.slice();
  }
  const columns = parseDDLColumnInfos_ACU(ddl);
  const firstColumn = columns[0];
  if (!firstColumn || firstColumn.sqlName !== 'row_id' || firstColumn.declaredType !== 'INTEGER' || !firstColumn.isPrimaryKey) {
    throw new Error('DDL 必须以 row_id INTEGER PRIMARY KEY 作为首列，无法安全 hydrate');
  }
  const normalizedHeaders = headers.map(header => String(header ?? '').trim());
  if (new Set(normalizedHeaders.filter(Boolean)).size !== normalizedHeaders.filter(Boolean).length) {
    throw new Error('snapshot 表头存在重复列，无法安全 hydrate');
  }
  const mappings: InsertColumnMapping[] = [];
  const usedSourceIndexes = new Set<number>();
  for (const column of columns) {
    const candidates = normalizedHeaders.map((header, index) => ({ header, index }))
      .filter(({ header }) => matchesDDLColumnHeader_ACU(column.sqlName, column.comment, header));
    if (candidates.length > 1) throw new Error(`DDL 列「${column.sqlName}」匹配到多个表头，无法安全 hydrate`);
    if (candidates.length === 1) {
      const sourceIndex = candidates[0].index;
      if (usedSourceIndexes.has(sourceIndex)) {
        throw new Error(`表头「${normalizedHeaders[sourceIndex]}」被多个 DDL 列使用，无法安全 hydrate`);
      }
      usedSourceIndexes.add(sourceIndex);
      mappings.push({ sqlName: column.sqlName, sourceIndex,
        required: column.isPrimaryKey || (column.isNotNull && !column.hasDefault) });
    }
  }
  for (const column of columns) {
    const mapped = mappings.some(mapping => mapping.sqlName === column.sqlName);
    const required = column.isPrimaryKey || (column.isNotNull && !column.hasDefault);
    if (!mapped && required) throw new Error(`缺少必需 DDL 列「${column.sqlName}」对应的表头，无法安全 hydrate`);
  }
  const unusedSourceIndexes = normalizedHeaders.map((_, index) => index).filter(index => !usedSourceIndexes.has(index));
  for (const index of unusedSourceIndexes) {
    const hasBusinessValue = (sheet.content || []).slice(1).some(row =>
      Array.isArray(row) && row[index] !== null && row[index] !== undefined && row[index] !== '');
    if (hasBusinessValue) {
      throw new Error(`表头「${normalizedHeaders[index] || `第 ${index + 1} 列`}」没有对应的 DDL 列，拒绝丢弃非空数据`);
    }
  }
  return mappings;
}


/** 表头身份先校验再生成，不以合成列名掩盖非法表头。 */
export function generateFallbackDDL(tableName: string, headers: (string | null)[]): string {
  const lines: string[] = [];
  const rawHeaders = Array.isArray(headers) ? headers : [];
  const normalizedHeaders = rawHeaders.length > 0 ? rawHeaders : ['row_id'];
  const { mappings, diagnostics } = mapSqlColumnIdentifiers_ACU(normalizedHeaders);
  if (diagnostics.length > 0) {
    throw new Error(`fallback DDL 表头不合法：${diagnostics
      .map(diagnostic => `第 ${diagnostic.index + 1} 列「${diagnostic.originalName}」${diagnostic.code}`)
      .join('；')}`);
  }
  if (!mappings[0]?.isRowId) {
    throw new Error('fallback DDL 需要首列表头为 row_id，且所有表头必须唯一且非空');
  }
  for (const mapping of mappings) {
    if (mapping.isRowId) lines.push('  row_id INTEGER PRIMARY KEY -- 行号');
    else lines.push(`  ${mapping.sqlName} TEXT -- ${mapping.displayName}`);
  }
  if (lines.length === 0) lines.push('  row_id INTEGER PRIMARY KEY -- 行号');
  const formattedLines = lines.map((line, idx) => {
    if (idx < lines.length - 1) {
      const commentIdx = line.indexOf('--');
      if (commentIdx > 0) return line.substring(0, commentIdx).trimEnd() + ', ' + line.substring(commentIdx);
      return line + ',';
    }
    return line;
  });
  return `CREATE TABLE ${sanitizeIdentifier(tableName)} (\n${formattedLines.join('\n')}\n);`;
}

function sanitizeIdentifier(name: string): string {
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) return name;
  const cleaned = name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^(\d)/, '_$1');
  return cleaned || '_unknown';
}

export interface InsertColumnMapping {
  sqlName: string;
  sourceIndex: number;
  required: boolean;
}

export interface SheetInsertPlan_ACU {
  mappings: readonly InsertColumnMapping[];
}

export function createSheetInsertPlan(sheet: Sheet_ACU, columnMap?: EffectiveDDLColumnMap_ACU): SheetInsertPlan_ACU {
  const headers = sheet.content?.[0];
  if (!Array.isArray(headers) || headers.length === 0) {
    throw new Error('snapshot 缺少表头，无法安全 hydrate');
  }
  if (columnMap) return { mappings: columnMap.mappings.map(mapping => ({ ...mapping })) };
  return { mappings: resolveInsertColumnMappings(sheet, headers) };
}


export function buildRuntimeFallbackDDL_ACU(
  sheet: Sheet_ACU,
  fallbackTableName?: string,
  source: 'fallback_missing' | 'fallback_invalid' = 'fallback_missing',
  diagnostic = 'DDL 缺失，已使用运行时 fallback schema。',
): EffectiveDDLResult_ACU {
  const headers = Array.isArray(sheet.content?.[0]) && sheet.content[0].length > 0
    ? sheet.content[0].map(header => (header === null || header === undefined ? null : String(header)))
    : ['row_id'];
  const fallbackTable = sanitizeIdentifier(fallbackTableName || sheet.uid || 'unknown_table');
  return {
    originalDDL: typeof sheet.sourceData?.ddl === 'string' ? sheet.sourceData.ddl.trim() : '',
    effectiveDDL: generateFallbackDDL(fallbackTable, headers),
    source,
    diagnostics: [diagnostic],
    columnMap: buildFallbackColumnMap_ACU(headers),
  };
}

function buildFallbackColumnMap_ACU(headers: readonly (string | null)[]): EffectiveDDLColumnMap_ACU {
  const { mappings } = mapSqlColumnIdentifiers_ACU(headers);
  if (!mappings[0]?.isRowId) {
    throw new Error('fallback schema 需要首列表头为 row_id，且所有表头必须可安全映射');
  }
  return {
    mappings: mappings.map(mapping => ({ sourceIndex: mapping.index, displayName: String(mapping.displayName), sqlName: mapping.sqlName, required: mapping.isRowId })),
    sqlToDisplay: new Map(mappings.map(mapping => [mapping.sqlName, String(mapping.displayName)])),
  };
}

function buildExplicitColumnMap_ACU(sheet: Sheet_ACU, ddl: string, headers: readonly string[]): EffectiveDDLColumnMap_ACU {
  const insertMappings = resolveInsertColumnMappings(sheet, headers, ddl);
  const mappings = insertMappings.map(mapping => ({
    sourceIndex: mapping.sourceIndex,
    displayName: headers[mapping.sourceIndex],
    sqlName: mapping.sqlName,
    required: mapping.required,
  }));
  return { mappings, sqlToDisplay: new Map(mappings.map(mapping => [mapping.sqlName, mapping.displayName])) };
}


/** 只解析运行时 schema，不修改源 DDL；持久化调用方仍须拒绝 fallback_invalid。 */
export function resolveEffectiveDDL(sheet: Sheet_ACU, fallbackTableName?: string, runtimeTableName?: string): EffectiveDDLResult_ACU {
  const headers = sheet.content?.[0];
  const safeHeaders = Array.isArray(headers) && headers.length > 0
    ? headers.map(header => String(header ?? '')) : ['row_id'];
  const originalDDL = typeof sheet.sourceData?.ddl === 'string' ? sheet.sourceData.ddl.trim() : '';
  if (!originalDDL) {
    return buildRuntimeFallbackDDL_ACU(sheet, runtimeTableName || fallbackTableName, 'fallback_missing', 'DDL 缺失，已使用运行时 fallback schema。');
  }
  const normalizedDDL = normalizeSqlStructure(originalDDL);
  const columns = parseDDLColumnInfos_ACU(normalizedDDL);
  const firstColumn = columns[0];
  if (parseDDLTableName(normalizedDDL) && firstColumn?.sqlName === 'row_id'
    && firstColumn.declaredType === 'INTEGER' && firstColumn.isPrimaryKey) {
    const effectiveDDL = runtimeTableName ? rebindCreateTableName_ACU(normalizedDDL, runtimeTableName) : normalizedDDL;
    logDebug_ACU(`[Schema] resolveEffectiveDDL: 使用用户定义 DDL, runtime表名=${parseDDLTableName(effectiveDDL) || 'unknown'}`);
    return { originalDDL, effectiveDDL, source: 'explicit', diagnostics: [],
      columnMap: buildExplicitColumnMap_ACU(sheet, normalizedDDL, safeHeaders) };
  }
  return buildRuntimeFallbackDDL_ACU(sheet, runtimeTableName || fallbackTableName, 'fallback_invalid', '显式 DDL 缺少可用的 row_id INTEGER PRIMARY KEY 结构。');
}
