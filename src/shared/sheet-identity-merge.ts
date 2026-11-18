import type { Sheet_ACU, TableDataObject_ACU } from './models/table-data';
import { buildStableSheetKeyCandidate_ACU, canonicalizeDisplayName_ACU } from './sheet-identity';
import { reuseSheetColumns_ACU } from './sheet-column-reuse';

export function reuseSheetDataByName_ACU(
  before: Sheet_ACU,
  incoming: Sheet_ACU,
  mode: 'structure' | 'merge' | 'replace' = 'merge',
): Sheet_ACU {
  const reuse = reuseSheetColumns_ACU(incoming, before);
  const rows = new Map<string, Array<string | null>>();
  if (mode !== 'replace') {
    for (const row of (before.content || []).slice(1)) {
      const mapped = reuse.sourceIndices.map(index => index < 0 ? null : row[index] ?? null);
      rows.set(String(row[0] ?? '').trim(), mapped);
    }
  }
  if (mode !== 'structure') {
    for (const row of (incoming.content || []).slice(1)) {
      const id = String(row[0] ?? '').trim();
      const mapped = rows.get(id) || reuse.targetIndices.map((): string | null => null);
      reuse.targetIndices.forEach((sourceIndex, index) => {
        if (sourceIndex >= 0) mapped[index] = row[sourceIndex] ?? null;
      });
      rows.set(id, mapped);
    }
  }
  const sheet = { ...reuse.sheet, uid: before.uid, content: [reuse.sheet.content[0], ...rows.values()] };
  accumulateMergedTableAliases_ACU(sheet, before);
  return sheet;
}

export interface SheetIdentityDataOrder_ACU {
  dataOrderBySheetKey?: ReadonlyMap<string, number>;
  replaceDataFromKeys?: ReadonlySet<string>;
  referenceOrderBySheetKey?: ReadonlyMap<string, number>;
  distinctCurrentNames?: ReadonlySet<string>;
}

export interface SheetIdentityRemap_ACU {
  /** 被并入并删除的旧 key。 */
  fromKey: string;
  /** 归并后保留的 key。 */
  toKey: string;
  /** winner 显示名的 canonical 形式。 */
  canonicalName: string;
  /** 同 row_id 的重复快照数。 */
  overriddenRows: number;
  /** loser 中被追加进 winner 的独有行数。 */
  appendedRows: number;
  /** 同 row_id 的不同快照；没有可信先后时仍保留此诊断。 */
  conflictingRowIds: string[];
  /** 兼容既有诊断接口；按名归并不再丢弃历史列。 */
  droppedColumns: string[];
  supersededRows?: number;
}

function normalizeHeaderCell_ACU(value: unknown): string {
  return String(value ?? '').trim();
}

function rowsEqual_ACU(left: unknown[], right: unknown[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export interface SheetIdentityMergeResult_ACU {
  changed: boolean;
  remaps: SheetIdentityRemap_ACU[];
}

function isSheetLike_ACU(value: unknown): value is Sheet_ACU {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readExplicitTableAliases_ACU(sheet: Sheet_ACU): string[] {
  const raw = (sheet.sourceData as unknown as Record<string, unknown> | undefined)?.tableAliases;
  if (!Array.isArray(raw)) return [];
  return raw.map(value => String(value ?? '').trim()).filter(Boolean);
}

/**
 * 表的显式身份集合（canonical）：显示名 + 显式 tableAliases，去空、去重。
 * 与 chat-template-reconciler 的别名匹配口径一致：任何一侧声明过的名字都是身份。
 */
export function collectSheetIdentityCanonicals_ACU(sheet: Sheet_ACU): string[] {
  const identities = new Set<string>();
  const name = canonicalizeDisplayName_ACU(sheet.name);
  if (name) identities.add(name);
  for (const alias of readExplicitTableAliases_ACU(sheet)) {
    const canonical = canonicalizeDisplayName_ACU(alias);
    if (canonical && !canonical.startsWith('sheet_') && (canonical !== canonicalizeDisplayName_ACU(sheet.uid) || canonical === name)) identities.add(canonical);
  }
  return [...identities];
}

/**
 * 按身份交集把 sheetKey 分组（并查集）：两张表只要有一个身份相同就属于同一组，
 * 身份关系可传递（A~B 同名、B~C 同别名 → A、B、C 一组）。
 * 返回值只包含至少两个 key 的组，组内 key 保持字典序（确定性）。
 */
function groupSheetKeysByIdentity_ACU(sheets: ReadonlyMap<string, Sheet_ACU>, distinctCurrentNames?: ReadonlySet<string>): string[][] {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cursor = key;
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor)!;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  const union = (left: string, right: string): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    const names = new Set([...sheets.keys()]
      .filter(key => find(key) === leftRoot || find(key) === rightRoot)
      .map(key => canonicalizeDisplayName_ACU(sheets.get(key)!.name))
      .filter(name => distinctCurrentNames?.has(name)));
    if (names.size > 1) return;
    // 以字典序较小者为根，保证分组结果与输入顺序无关。
    if (leftRoot < rightRoot) parent.set(rightRoot, leftRoot);
    else parent.set(leftRoot, rightRoot);
  };

  const ownersByIdentity = new Map<string, string[]>();
  const references = new Set([...sheets].flatMap(([key, sheet]) => [
    key, ...(canonicalizeDisplayName_ACU(sheet.uid) !== canonicalizeDisplayName_ACU(sheet.name) ? [sheet.uid] : []),
  ]).map(canonicalizeDisplayName_ACU));
  const keys = [...sheets.keys()].sort();
  keys.forEach(key => parent.set(key, key));
  const ownerByName = new Map<string, string>();
  for (const key of keys) {
    const name = canonicalizeDisplayName_ACU(sheets.get(key)!.name);
    if (!name) continue;
    const owner = ownerByName.get(name);
    if (owner === undefined) ownerByName.set(name, key);
    else union(owner, key);
  }
  for (const sheetKey of keys) {
    for (const identity of collectSheetIdentityCanonicals_ACU(sheets.get(sheetKey)!)) {
      if (references.has(identity) && identity !== canonicalizeDisplayName_ACU(sheets.get(sheetKey)!.name)) continue;
      const owners = ownersByIdentity.get(identity) || [];
      owners.forEach(owner => union(owner, sheetKey));
      owners.push(sheetKey);
      ownersByIdentity.set(identity, owners);
    }
  }

  const groups = new Map<string, string[]>();
  for (const sheetKey of sheets.keys()) {
    const root = find(sheetKey);
    const group = groups.get(root) || [];
    group.push(sheetKey);
    groups.set(root, group);
  }
  return [...groups.values()]
    .filter(group => group.length >= 2)
    .map(group => [...group].sort())
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
}

/**
 * 从同一身份组的候选 key 中选出保留者（确定性）：
 * 1. preferredKeys（当前模板/指导表侧 key）命中者优先；
 * 2. 等于按自身显示名生成的新版稳定 key 候选者次之；
 * 3. 否则按 key 字典序取首位。
 */
function pickWinnerKey_ACU(
  keys: readonly string[],
  sheets: ReadonlyMap<string, Sheet_ACU>,
  preferredKeys: ReadonlySet<string>,
  referenceOrder?: ReadonlyMap<string, number>,
): string {
  const sorted = [...keys].sort();
  const persisted = sorted.filter(key => referenceOrder?.has(key))
    .sort((left, right) => referenceOrder!.get(left)! - referenceOrder!.get(right)!);
  if (persisted.length > 0) return persisted[0];
  const preferred = sorted.find(key => preferredKeys.has(key));
  if (preferred) return preferred;
  const stableCandidate = sorted.find(key => buildStableSheetKeyCandidate_ACU(sheets.get(key)?.name) === key);
  if (stableCandidate) return stableCandidate;
  return sorted[0];
}

/**
 * 把 loser 的显示名与显式别名累积进 winner.sourceData.tableAliases：
 * 归并后 loser key 消失，但它声明过的名字仍是这张表的身份，后续模板协调 /
 * SQL 别名解析要能顺着这些名字认回 winner。排除 winner 当前显示名，按 canonical 去重。
 */
function accumulateMergedTableAliases_ACU(winner: Sheet_ACU, loser: Sheet_ACU): void {
  const winnerName = canonicalizeDisplayName_ACU(winner.name);
  const seen = new Set<string>();
  const merged: string[] = [];
  const push = (alias: unknown): void => {
    const trimmed = String(alias ?? '').trim();
    const canonical = canonicalizeDisplayName_ACU(trimmed);
    if (!canonical || canonical === winnerName || seen.has(canonical)) return;
    seen.add(canonical);
    merged.push(trimmed);
  };
  readExplicitTableAliases_ACU(winner).forEach(push);
  push(loser.name);
  readExplicitTableAliases_ACU(loser).forEach(push);

  const existing = readExplicitTableAliases_ACU(winner);
  const unchanged = existing.length === merged.length && existing.every((alias, index) => alias === merged[index]);
  if (unchanged) return;
  if (!winner.sourceData || typeof winner.sourceData !== 'object') {
    winner.sourceData = {} as Sheet_ACU['sourceData'];
  }
  if (merged.length > 0) {
    (winner.sourceData as unknown as Record<string, unknown>).tableAliases = merged;
  } else {
    delete (winner.sourceData as unknown as Record<string, unknown>).tableAliases;
  }
}

/**
 * 归并 state 中身份集合有交集（显示名或显式别名相同）但 sheetKey 不同的表。
 *
 * 原地修改 state（回放路径持有的都是内存副本），返回 remap 记录。
 * 对没有冲突的数据是纯 no-op（changed=false），可在回放的任意状态
 * 变化点重复调用。
 */
export function mergeLegacySheetIdentities_ACU(
  state: TableDataObject_ACU,
  preferredKeysArg?: readonly string[] | null,
  context: SheetIdentityDataOrder_ACU = {},
): SheetIdentityMergeResult_ACU {
  const remaps: SheetIdentityRemap_ACU[] = [];
  const preferredKeys = new Set(preferredKeysArg || []);
  const sheets = new Map<string, Sheet_ACU>();

  for (const sheetKey of Object.keys(state)) {
    if (!sheetKey.startsWith('sheet_')) continue;
    const sheet = (state as Record<string, unknown>)[sheetKey];
    if (!isSheetLike_ACU(sheet)) continue;
    if (collectSheetIdentityCanonicals_ACU(sheet as Sheet_ACU).length === 0) continue;
    sheets.set(sheetKey, sheet as Sheet_ACU);
  }

  for (const keys of groupSheetKeysByIdentity_ACU(sheets, context.distinctCurrentNames)) {
    const winnerKey = pickWinnerKey_ACU(keys, sheets, preferredKeys, context.referenceOrderBySheetKey);
    let winner = sheets.get(winnerKey)!;
    const canonicalName = canonicalizeDisplayName_ACU(winner.name);
    const ordered = [...keys].sort((left, right) => {
      const difference = (context.dataOrderBySheetKey?.get(left) ?? 0) - (context.dataOrderBySheetKey?.get(right) ?? 0);
      if (difference) return difference;
      // 无操作先后证据的重复快照只作确定性收敛，并由 conflictingRowIds 保留诊断。
      const leftValue = JSON.stringify(sheets.get(left)?.content) || '';
      const rightValue = JSON.stringify(sheets.get(right)?.content) || '';
      return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
    });
    const latestReplacement = [...ordered].reverse().find(key => context.replaceDataFromKeys?.has(key));
    const replacementOrder = latestReplacement === undefined ? -1 : ordered.indexOf(latestReplacement);
    const rows = new Map<string, Array<string | null>>();
    const conflicts = new Set<string>();
    let structure = { ...winner, content: [winner.content?.[0] || []] } as Sheet_ACU;
    for (const [orderIndex, key] of ordered.entries()) {
      const source = sheets.get(key)!;
      if (!source.content?.length) continue;
      const reuse = reuseSheetColumns_ACU(structure, source);
      for (const [id, row] of rows) rows.set(id, reuse.targetIndices.map(index => index < 0 ? '' : row[index] ?? null));
      if (orderIndex === replacementOrder) rows.clear();
      for (const row of source.content.slice(1)) {
        if (!Array.isArray(row)) continue;
        const id = normalizeHeaderCell_ACU(row[0]);
        const previous = rows.get(id);
        const next = previous ? [...previous] : reuse.sourceIndices.map(index => index < 0 ? '' : row[index] ?? null);
        if (previous) {
          for (const [index, sourceIndex] of reuse.sourceIndices.entries()) {
            if (sourceIndex >= 0) next[index] = row[sourceIndex] ?? null;
          }
          if (!rowsEqual_ACU(previous, next)) conflicts.add(id);
        }
        if (orderIndex >= replacementOrder) rows.set(id, next);
      }
      structure = reuse.sheet;
    }
    winner = { ...structure, content: [structure.content[0], ...[...rows.entries()].sort(([left], [right]) => left.localeCompare(right, 'en')).map(([, row]) => row)] };
    if (!winner.sourceData && ordered.length) winner.sourceData = { ...sheets.get(ordered[0])!.sourceData };
    (state as Record<string, unknown>)[winnerKey] = winner;
    const winnerIds = new Set((sheets.get(winnerKey)?.content || []).slice(1).map(row => normalizeHeaderCell_ACU(row[0])));
    for (const loserKey of keys) {
      if (loserKey === winnerKey) continue;
      const loser = sheets.get(loserKey)!;
      let overriddenRows = 0;
      let appendedRows = 0;
      const conflictingRowIds: string[] = [];
      for (const row of (loser.content || []).slice(1)) {
        const id = normalizeHeaderCell_ACU(row[0]);
        if (winnerIds.has(id)) overriddenRows += 1;
        else if (rows.has(id)) { appendedRows += 1; winnerIds.add(id); }
        if (conflicts.has(id)) conflictingRowIds.push(id);
      }

      const winnerSeedRows = (winner as any).seedRows;
      const loserSeedRows = (loser as any).seedRows;
      if ((!Array.isArray(winnerSeedRows) || winnerSeedRows.length === 0)
        && Array.isArray(loserSeedRows) && loserSeedRows.length > 0) {
        (winner as any).seedRows = loserSeedRows;
      }
      const references = [loserKey, loser.uid].filter(value => value && value !== winnerKey && value !== winner.uid
        && canonicalizeDisplayName_ACU(value) !== canonicalizeDisplayName_ACU(loser.name));
      winner.sourceData = { ...winner.sourceData };
      winner.sourceData.tableAliases = [...new Set([...(winner.sourceData.tableAliases || []), ...references])];
      accumulateMergedTableAliases_ACU(winner, loser);

      delete (state as Record<string, unknown>)[loserKey];
      sheets.delete(loserKey);
      remaps.push({
        fromKey: loserKey,
        toKey: winnerKey,
        canonicalName,
        overriddenRows,
        appendedRows,
        conflictingRowIds,
        droppedColumns: [],
      });
    }
  }

  return { changed: remaps.length > 0, remaps };
}

export interface SheetKeyRedirect_ACU {
  requestedKey: string;
  sheetKey: string;
  uid?: string;
}

/** 把模板侧请求 key 的表改挂到实际恢复的历史 key；只返回浅拷贝，不修改输入。 */
export function redirectSheetKeysInData_ACU<T>(data: T, redirects: readonly SheetKeyRedirect_ACU[]): T {
  if (!data || typeof data !== 'object' || Array.isArray(data) || redirects.length === 0) return data;
  const out = { ...(data as Record<string, unknown>) };
  for (const { requestedKey, sheetKey, uid } of redirects) {
    const sheet = out[requestedKey];
    if (requestedKey === sheetKey || !isSheetLike_ACU(sheet) || Object.prototype.hasOwnProperty.call(out, sheetKey)) continue;
    const sourceData = { ...(sheet.sourceData || {}) } as Sheet_ACU['sourceData'];
    sourceData.tableAliases = [...new Set([...(sourceData.tableAliases || []), requestedKey])];
    delete out[requestedKey];
    out[sheetKey] = { ...sheet, uid: uid || sheetKey, sourceData };
  }
  return out as T;
}
