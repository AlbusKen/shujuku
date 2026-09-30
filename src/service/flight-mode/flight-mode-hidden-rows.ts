import type { FlightModeState_ACU } from '../../shared/models/flight-mode-model';

function collectRowIds_ACU(sheet: any): Set<string> {
  const ids = new Set<string>();
  const content = sheet?.content;
  if (!Array.isArray(content)) return ids;
  for (const row of content.slice(1)) {
    if (!Array.isArray(row)) continue;
    const id = String(row[0] ?? '').trim();
    if (id) ids.add(id);
  }
  return ids;
}

function findChronicleSheet_ACU(tableData: Record<string, any> | null | undefined): any | null {
  if (!tableData || typeof tableData !== 'object') return null;
  return Object.values(tableData).find((sheet: any) => sheet?.name === '纪要表') || null;
}

/**
 * 大总结新增行会消耗写入前已可见的纪要。同一轮新写入的纪要没有被本次大总结归纳，保持可见。
 * 返回 null 表示本次无需改 flightMode；
 * 返回数组则是应与本次表格快照一并持久化的完整 hiddenRowIds。
 */
export function getHiddenChronicleRowIdsAfterBigSummaryInsert_ACU(
  beforeData: Record<string, any> | null | undefined,
  afterData: Record<string, any> | null | undefined,
  state: FlightModeState_ACU,
): string[] | null {
  if (!state.enabled) return null;
  const bigSummarySheetKey = String(state.bigSummarySheetKey || '').trim();
  if (!bigSummarySheetKey) return null;

  const beforeBigSummary = beforeData?.[bigSummarySheetKey];
  const afterBigSummary = afterData?.[bigSummarySheetKey];
  if (!afterBigSummary) return null;

  const beforeIds = collectRowIds_ACU(beforeBigSummary);
  const afterIds = collectRowIds_ACU(afterBigSummary);
  const hasInsertedSummaryRow = [...afterIds].some(id => !beforeIds.has(id));
  if (!hasInsertedSummaryRow) return null;

  const afterChronicle = findChronicleSheet_ACU(afterData);
  if (!afterChronicle) return null;
  const afterChronicleIds = collectRowIds_ACU(afterChronicle);

  const hidden = new Set(state.hiddenRowIds.map(id => String(id).trim()).filter(Boolean));
  for (const id of collectRowIds_ACU(findChronicleSheet_ACU(beforeData))) {
    if (afterChronicleIds.has(id)) hidden.add(id);
  }
  return [...hidden].sort();
}

/**
 * 仅为 prompt / 世界书 / 条件表达式创建纪要行可见性投影；绝不修改原始表数据。
 * 调用方负责在关闭态短路，并在异常时记录告警后回退到原数据。
 */
export function projectFlightModeHiddenChronicleRows_ACU<T extends Record<string, any>>(
  tableData: T,
  state: FlightModeState_ACU,
): T {
  if (!state.enabled || state.hiddenRowIds.length === 0) return tableData;

  const hidden = new Set(state.hiddenRowIds.map(id => String(id).trim()).filter(Boolean));
  let chronicleKey: string | null = null;
  for (const [key, sheet] of Object.entries(tableData)) {
    if (key.startsWith('sheet_') && (sheet as any)?.name === '纪要表') {
      chronicleKey = key;
      break;
    }
  }
  if (!chronicleKey) return tableData;

  const chronicle = tableData[chronicleKey];
  if (!Array.isArray(chronicle?.content)) return tableData;
  const visibleRows = chronicle.content.slice(1).filter((row: any) => !Array.isArray(row) || !hidden.has(String(row[0] ?? '').trim()));
  if (visibleRows.length === chronicle.content.length - 1) return tableData;

  return {
    ...tableData,
    [chronicleKey]: {
      ...chronicle,
      content: [chronicle.content[0], ...visibleRows],
    },
  };
}
