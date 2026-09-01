import { CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU } from '../../../data/storage/chat-history';
import { allocateStableRowId_ACU, createStableRowIdReservation_ACU } from '../../../shared/stable-row-id-allocator';
import { logWarn_ACU } from '../../../shared/utils';

export interface SheetGuideRowIdNormalizationResult_ACU<T> {
  guideData: T;
  changed: boolean;
  blockers: string[];
}

const ROW_ID_ALIASES = new Set(['id', 'rowid', 'row-id', 'row_id', '行号']);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function isRowIdAlias(value: unknown): boolean {
  return ROW_ID_ALIASES.has(String(value ?? '').trim().toLowerCase());
}

function label(sheet: any, key: string): string {
  return `表「${String(sheet?.name ?? '') || key}」(${key})`;
}

function normalizeSeedRowWidth_ACU(row: any[], width: number): boolean {
  if (!Array.isArray(row) || width < 0) return false;
  if (row.length === width) return false;
  if (row.length > width) {
    row.length = width;
    return true;
  }
  while (row.length < width) row.push(null);
  return true;
}

export function normalizeSheetGuideRowIds_ACU<T>(guideData: T): SheetGuideRowIdNormalizationResult_ACU<T> {
  if (!guideData || typeof guideData !== 'object' || Array.isArray(guideData)) {
    return { guideData, changed: false, blockers: ['Sheet Guide 必须是对象。'] };
  }
  const candidate: any = clone(guideData);
  const blockers: string[] = [];
  let changed = false;
  for (const [key, sheet] of Object.entries(candidate)) {
    if (!key.startsWith('sheet_')) continue;
    if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet)) {
      blockers.push(`Sheet Guide ${key} 不是对象。`);
      continue;
    }
    const content = (sheet as any).content;
    const header = Array.isArray(content) ? content[0] : null;
    const name = label(sheet, key);
    if (!Array.isArray(header) || header.length === 0) {
      blockers.push(`${name} 缺少有效表头，无法规范化 row_id。`);
      continue;
    }
    const aliases = header.map(isRowIdAlias);
    const identityIndexes = aliases.map((matched, index) => matched ? index : -1).filter(index => index >= 0);
    if (identityIndexes.some(index => index > 0)) {
      blockers.push(`${name} 的身份列位于第 ${identityIndexes[0] + 1} 列，无法安全移动。`);
      continue;
    }
    // `_seedRows` existed in early guide payloads and remains in older chat
    // snapshots. Preserve its field spelling while normalizing its row shape.
    const seedRowsField = Object.prototype.hasOwnProperty.call(sheet, CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU)
      ? CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU : '_seedRows';
    const seedRows = (sheet as any)[seedRowsField];
    if (seedRows !== undefined && !Array.isArray(seedRows)) {
      blockers.push(`${name} 的种子行不是数组。`);
      continue;
    }
    if (Array.isArray(seedRows) && seedRows.some(row => !Array.isArray(row))) {
      blockers.push(`${name} 存在非数组种子行，无法安全规范化。`);
      continue;
    }
    const businessWidth = header.length;
    const rows = Array.isArray(seedRows) ? seedRows : [];
    let trimmedCellCount = 0;
    let convergedRowCount = 0;
    if (header[0] === 'row_id') {
      // Canonical header; converge seed rows to the final header width below.
    } else if (isRowIdAlias(header[0])) {
      header[0] = 'row_id';
      changed = true;
    } else {
      for (const row of rows) {
        const before = row.length;
        if (normalizeSeedRowWidth_ACU(row, businessWidth)) {
          changed = true;
          convergedRowCount += 1;
          if (before > businessWidth) trimmedCellCount += before - businessWidth;
        }
        row.unshift(null);
        changed = true;
      }
      header.unshift('row_id');
      changed = true;
    }
    for (const row of rows) {
      const before = row.length;
      if (normalizeSeedRowWidth_ACU(row, header.length)) {
        changed = true;
        if (before !== header.length) convergedRowCount += 1;
        if (before > header.length) trimmedCellCount += before - header.length;
      }
    }
    if (trimmedCellCount > 0) {
      logWarn_ACU(`[SheetGuide] 超宽种子行已按最终表头收敛：sheetKey=${key}, headerWidth=${header.length}, convergedRows=${convergedRowCount}, removedCells=${trimmedCellCount}`);
    }
    const reserved = createStableRowIdReservation_ACU(rows);
    const seen = new Set<string>();
    for (const row of rows) {
      const id = String(row[0] ?? '').trim();
      if (!id) { row[0] = allocateStableRowId_ACU(reserved); changed = true; }
      else if (seen.has(id)) blockers.push(`${name} 存在重复 row_id「${id}」，不能自动重写。`);
      else { if (row[0] !== id) changed = true; row[0] = id; seen.add(id); }
    }
  }
  return { guideData: candidate as T, changed: blockers.length === 0 && changed, blockers };
}
