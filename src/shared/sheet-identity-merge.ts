/**
 * shared/sheet-identity-merge.ts — 两代 sheetKey 身份归并（纯函数）
 *
 * spv7.9 及更早版本使用随机 hash 风格的 sheetKey；spv8.4+ 使用按显示名
 * 拼音生成的稳定 key。同一张表在旧 checkpoint 与新模板/指导表中各持有一个
 * key 时，SQLite 物理表名解析会抛 PhysicalTableNameCollisionError_ACU
 * （reason=identity_merge_failed），模板协调器也会报「表名/表别名规范化重复」。
 *
 * 「同一张表」的判定依据是身份集合的交集，而不只是显示名相等：
 * 每张表的身份集合 = canonical(显示名) ∪ canonical(sourceData.tableAliases)。
 * tableAliases 是显式身份声明（改名时累积旧名、模板作者声明历史别名），
 * 旧 key 的显示名恰好是新 key 的历史别名时（例如旧「主角技能表」→ 新「主角技能」
 * 并声明别名「主角技能表」）同样属于同一逻辑表。身份交集按并查集传递归并。
 *
 * 本模块在**内存回放副本**上把同一身份组的多个 key 归并为一个：优先保留当前
 * 模板/指导表侧 key，旧 key 的数据按 row_id 并入（winner 同 id 胜出、
 * loser 独有行追加，与旧版逐楼覆盖语义一致），loser 的显示名与别名累积进
 * winner 的 tableAliases 以保留身份。纯函数、幂等、无 IO，不修改任何持久化 storage frame。
 */
import type { Sheet_ACU, TableDataObject_ACU } from './models/table-data';
import { buildStableSheetKeyCandidate_ACU, canonicalizeDisplayName_ACU } from './sheet-identity';

export interface SheetIdentityRemap_ACU {
  /** 被并入并删除的旧 key。 */
  fromKey: string;
  /** 归并后保留的 key。 */
  toKey: string;
  /** winner 显示名的 canonical 形式。 */
  canonicalName: string;
  /** loser 中与 winner 同 row_id 的行数（winner 胜出，loser 行被覆盖语义丢弃）。 */
  overriddenRows: number;
  /** loser 中被追加进 winner 的独有行数。 */
  appendedRows: number;
}

export interface SheetIdentityMergeResult_ACU {
  changed: boolean;
  remaps: SheetIdentityRemap_ACU[];
}

function isSheetLike_ACU(value: unknown): value is Sheet_ACU {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function collectRowIds_ACU(content: unknown[]): Set<string> {
  const ids = new Set<string>();
  for (let index = 1; index < content.length; index += 1) {
    const row = content[index];
    if (!Array.isArray(row)) continue;
    const id = String(row[0] ?? '').trim();
    if (id) ids.add(id);
  }
  return ids;
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
    if (canonical) identities.add(canonical);
  }
  return [...identities];
}

/**
 * 按身份交集把 sheetKey 分组（并查集）：两张表只要有一个身份相同就属于同一组，
 * 身份关系可传递（A~B 同名、B~C 同别名 → A、B、C 一组）。
 * 返回值只包含至少两个 key 的组，组内 key 保持字典序（确定性）。
 */
function groupSheetKeysByIdentity_ACU(sheets: ReadonlyMap<string, Sheet_ACU>): string[][] {
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
    // 以字典序较小者为根，保证分组结果与输入顺序无关。
    if (leftRoot < rightRoot) parent.set(rightRoot, leftRoot);
    else parent.set(leftRoot, rightRoot);
  };

  const ownerByIdentity = new Map<string, string>();
  for (const sheetKey of [...sheets.keys()].sort()) {
    parent.set(sheetKey, sheetKey);
    for (const identity of collectSheetIdentityCanonicals_ACU(sheets.get(sheetKey)!)) {
      const owner = ownerByIdentity.get(identity);
      if (owner === undefined) ownerByIdentity.set(identity, sheetKey);
      else union(owner, sheetKey);
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
): string {
  const sorted = [...keys].sort();
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

  for (const keys of groupSheetKeysByIdentity_ACU(sheets)) {
    const winnerKey = pickWinnerKey_ACU(keys, sheets, preferredKeys);
    const winner = sheets.get(winnerKey)!;
    const canonicalName = canonicalizeDisplayName_ACU(winner.name);
    for (const loserKey of keys) {
      if (loserKey === winnerKey) continue;
      const loser = sheets.get(loserKey)!;
      let overriddenRows = 0;
      let appendedRows = 0;

      const winnerHasContent = Array.isArray(winner.content) && winner.content.length > 0;
      const loserHasContent = Array.isArray(loser.content) && loser.content.length > 0;
      if (!winnerHasContent && loserHasContent) {
        // winner 侧无可用 content（如 header 丢失）：整体采纳 loser 的 content。
        winner.content = loser.content;
        appendedRows = loser.content.length > 0 ? loser.content.length - 1 : 0;
      } else if (winnerHasContent && loserHasContent) {
        const winnerIds = collectRowIds_ACU(winner.content);
        for (let index = 1; index < loser.content.length; index += 1) {
          const row = loser.content[index];
          if (!Array.isArray(row)) continue;
          const rowId = String(row[0] ?? '').trim();
          if (rowId && winnerIds.has(rowId)) {
            // 同 row_id：winner（当前/模板侧，写入更晚）胜出。
            overriddenRows += 1;
            continue;
          }
          winner.content.push(row);
          if (rowId) winnerIds.add(rowId);
          appendedRows += 1;
        }
      }

      const winnerSeedRows = (winner as any).seedRows;
      const loserSeedRows = (loser as any).seedRows;
      if ((!Array.isArray(winnerSeedRows) || winnerSeedRows.length === 0)
        && Array.isArray(loserSeedRows) && loserSeedRows.length > 0) {
        (winner as any).seedRows = loserSeedRows;
      }
      if ((winner as any).sourceData === undefined && (loser as any).sourceData !== undefined) {
        (winner as any).sourceData = (loser as any).sourceData;
      }
      accumulateMergedTableAliases_ACU(winner, loser);

      delete (state as Record<string, unknown>)[loserKey];
      sheets.delete(loserKey);
      remaps.push({ fromKey: loserKey, toKey: winnerKey, canonicalName, overriddenRows, appendedRows });
    }
  }

  return { changed: remaps.length > 0, remaps };
}
