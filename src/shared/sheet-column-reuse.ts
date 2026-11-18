import type { Sheet_ACU } from './models/table-data';
import { canonicalizeDisplayName_ACU } from './sheet-identity';
import { parseDDLColumnInfos_ACU, parseDDLTableConstraints_ACU, parseDDLTableName, parseDDLTableSuffix_ACU } from './ddl-utils';

export interface SheetColumnReuse_ACU {
  sheet: Sheet_ACU;
  sourceIndices: number[];
  targetIndices: number[];
}

export function matchSheetColumnsByName_ACU(
  target: Sheet_ACU,
  source: Sheet_ACU,
  targetPhysical: readonly string[],
  sourcePhysical: readonly string[],
  allowPhysicalMatch = false,
): number[] {
  const targetHeaders = target.content?.[0] || [];
  const sourceHeaders = source.content?.[0] || [];
  const aliases = (sheet: Sheet_ACU, physical: string): string[] => Object.entries(sheet.sourceData?.columnAliases || {})
    .filter(([key]) => key.toLowerCase() === physical.toLowerCase())
    .flatMap(([, values]) => Array.isArray(values) ? values.map(canonicalizeDisplayName_ACU) : []);
  const exact = targetHeaders.map((name, index) => index === 0 ? 0 : sourceHeaders.findIndex((header, sourceIndex) =>
    sourceIndex > 0 && canonicalizeDisplayName_ACU(header) === canonicalizeDisplayName_ACU(name)));
  const reserved = new Set(exact.filter(index => index >= 0));
  const used = new Set<number>([0]);
  return targetHeaders.map((header, index) => {
    if (index === 0) return sourceHeaders.length ? 0 : -1;
    if (exact[index] >= 0 && !used.has(exact[index])) {
      used.add(exact[index]);
      return exact[index];
    }
    const available = sourceHeaders.map((_, sourceIndex) => sourceIndex)
      .filter(sourceIndex => sourceIndex > 0 && !used.has(sourceIndex) && !reserved.has(sourceIndex));
    const physical = targetPhysical[index] || String(header ?? '');
    if (allowPhysicalMatch) {
      const samePhysical = available.filter(sourceIndex => sourcePhysical[sourceIndex]?.toLowerCase() === physical.toLowerCase());
      if (samePhysical.length === 1) { used.add(samePhysical[0]); return samePhysical[0]; }
    }
    const declared = [...aliases(target, physical), ...aliases(source, physical)];
    const canonical = canonicalizeDisplayName_ACU(header);
    const candidates = available.filter(sourceIndex => declared.includes(canonicalizeDisplayName_ACU(sourceHeaders[sourceIndex]))
      || aliases(source, sourcePhysical[sourceIndex] || String(sourceHeaders[sourceIndex] ?? '')).includes(canonical));
    if (candidates.length !== 1) return -1;
    used.add(candidates[0]);
    return candidates[0];
  });
}

export function reuseSheetColumns_ACU(target: Sheet_ACU, source: Sheet_ACU): SheetColumnReuse_ACU {
  const targetHeaders = target.content?.[0] || [];
  const sourceHeaders = source.content?.[0] || [];
  if (targetHeaders.length === 0) {
    return {
      sheet: { ...target, sourceData: { ...(source.sourceData || {}), ...(target.sourceData || {}) }, content: [[...sourceHeaders]] } as Sheet_ACU,
      sourceIndices: sourceHeaders.map((_, index) => index),
      targetIndices: sourceHeaders.map(() => -1),
    };
  }
  if (sourceHeaders.length === 0) {
    return { sheet: { ...target, sourceData: { ...target.sourceData }, content: [[...targetHeaders]] }, sourceIndices: targetHeaders.map(() => -1), targetIndices: targetHeaders.map((_, index) => index) };
  }
  const targetDDL = parseDDLColumnInfos_ACU(String(target.sourceData?.ddl || ''));
  const sourceDDL = parseDDLColumnInfos_ACU(String(source.sourceData?.ddl || ''));
  const targetPhysical = targetHeaders.map((name, index) => targetDDL.length === targetHeaders.length ? targetDDL[index].sqlName : String(name ?? ''));
  const sourcePhysical = sourceHeaders.map((name, index) => sourceDDL.length === sourceHeaders.length ? sourceDDL[index].sqlName : String(name ?? ''));
  const sourceIndices = matchSheetColumnsByName_ACU(target, source, targetPhysical, sourcePhysical);
  const retained = sourceHeaders.map((_, index) => index).filter(index => index > 0 && !sourceIndices.includes(index));
  const headers = [...targetHeaders, ...retained.map(index => sourceHeaders[index])];
  const targetIndices = headers.map((_, index) => index < targetHeaders.length ? index : -1);
  sourceIndices.push(...retained);
  const sheet = { ...target, sourceData: { ...(target.sourceData || {}) }, content: [headers] } as Sheet_ACU;
  const physical = [...targetPhysical];
  for (const index of retained) {
    const base = sourcePhysical[index];
    let name = base;
    let suffix = 2;
    while (physical.some(value => value.toLowerCase() === name.toLowerCase())) name = `${base}_${suffix++}`;
    physical.push(name);
  }
  const hidden = new Set((target.sourceData?.hiddenPhysicalColumns || []).map(value => value.toLowerCase()));
  const hiddenNames = physical.filter((name, index) => index > 0 && (index >= targetHeaders.length || hidden.has(name.toLowerCase())));
  if (hiddenNames.length > 0 || target.sourceData?.hiddenPhysicalColumns) sheet.sourceData.hiddenPhysicalColumns = hiddenNames;
  const columnAliases: Record<string, string[]> = {};
  physical.forEach((name, index) => {
    const targetIndex = targetIndices[index];
    const sourceIndex = sourceIndices[index];
    const values = [
      ...(targetIndex >= 0 ? target.sourceData?.columnAliases?.[targetPhysical[targetIndex]] || [] : []),
      ...(sourceIndex >= 0 ? source.sourceData?.columnAliases?.[sourcePhysical[sourceIndex]] || [] : []),
    ];
    if (sourceIndex >= 0 && sourcePhysical[sourceIndex] !== name) values.push(sourcePhysical[sourceIndex]);
    if (sourceIndex >= 0 && sourceHeaders[sourceIndex] !== headers[index]) values.push(String(sourceHeaders[sourceIndex] ?? ''));
    if (values.length > 0) columnAliases[name] = [...new Set(values)];
  });
  if (Object.keys(columnAliases).length > 0) sheet.sourceData.columnAliases = columnAliases;
  if (retained.length > 0 && targetDDL.length === targetHeaders.length && targetDDL.length > 0 && sourceDDL.length === sourceHeaders.length) {
    const columns = [...targetDDL, ...retained.map(index => sourceDDL[index])];
    const definitions = columns.map((column, index) => {
      const definition = `${physical[index]}${column.normalizedDefinition.slice(column.sqlName.length)}`;
      const comment = String(headers[index] ?? '').replace(/[\r\n]+/g, ' ');
      return { definition, comment: comment && comment !== physical[index] ? ` -- ${comment}` : '' };
    });
    // 与模板协调的 DDL 重建口径一致：保留来源侧表级约束；只搬运所引用列在新表中仍保持同一物理名的约束，避免指错列。
    const finalBySource = new Map<string, string>();
    sourceIndices.forEach((sourceIndex, index) => {
      if (sourceIndex > 0 && sourcePhysical[sourceIndex]) finalBySource.set(sourcePhysical[sourceIndex].toLowerCase(), physical[index]);
    });
    const sourcePhysicalNames = new Set(sourcePhysical.slice(1).map(name => name.toLowerCase()));
    const sourceConstraintIsPortable = (constraint: string): boolean => (constraint.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [])
      .every(token => {
        const lower = token.toLowerCase();
        if (!sourcePhysicalNames.has(lower)) return true;
        return finalBySource.get(lower)?.toLowerCase() === lower;
      });
    const constraints = Array.from(new Set([
      ...parseDDLTableConstraints_ACU(String(source.sourceData?.ddl || '')).filter(sourceConstraintIsPortable),
      ...parseDDLTableConstraints_ACU(String(target.sourceData?.ddl || '')),
    ]));
    const entries = [...definitions, ...constraints.map(definition => ({ definition, comment: '' }))];
    const suffix = parseDDLTableSuffix_ACU(String(target.sourceData?.ddl || ''));
    sheet.sourceData.ddl = `CREATE TABLE ${parseDDLTableName(String(target.sourceData?.ddl || ''))} (\n${entries.map((entry, index) => `  ${entry.definition}${index < entries.length - 1 ? ',' : ''}${entry.comment}`).join('\n')}\n)${suffix ? ` ${suffix}` : ''};`;
  }
  return { sheet, sourceIndices, targetIndices };
}

