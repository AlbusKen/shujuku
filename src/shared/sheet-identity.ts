import { pinyin } from 'pinyin-pro';
import type { Sheet_ACU, TableDataObject_ACU } from './models/table-data';

export const SHEET_KEY_ALGORITHM_VERSION_ACU = 1;
export const MAX_SHEET_SLUG_LENGTH_ACU = 48;
export const PHYSICAL_TABLE_NAME_ALGORITHM_VERSION_ACU = 1;
const MAX_PHYSICAL_TABLE_NAME_LENGTH_ACU = 48;
const SQLITE_RESERVED_TABLE_PREFIXES_ACU = ['sqlite_', '_acu_'];

export interface SheetNameDiagnostic_ACU {
  code: 'empty_name' | 'duplicate_canonical_name' | 'duplicate_sheet_key';
  index: number;
  originalName: string;
  canonicalName: string;
  candidateKey: string | null;
  conflictsWithIndex?: number;
}

export interface ExistingSheetIdentity_ACU {
  canonicalName: string;
  sheetKey: string;
}

export interface StableSheetKeyAllocationOptions_ACU {
  /** Persisted identities are immutable: allocation may not rewrite their keys. */
  existing?: readonly ExistingSheetIdentity_ACU[];
}

export interface StableSheetKeyAllocation_ACU {
  keys: Array<string | null>;
  diagnostics: SheetNameDiagnostic_ACU[];
}

/** One physical-table-name collision: distinct sheetKeys resolving to the same slug. */
export interface PhysicalTableNameCollision_ACU {
  physicalTableName: string;
  sheetKeys: string[];
  sheetNames: string[];
  reason: 'identity_merge_failed' | 'homophone_distinct_names';
}

/**
 * Thrown when two distinct sheets resolve to the same physical table name.
 * This is a fail-loud signal: the user must rename one of the colliding tables.
 * It is never recovered from by silently mutating a name, because that would
 * reintroduce set-dependent drift.
 */
export class PhysicalTableNameCollisionError_ACU extends Error {
  readonly collisions: PhysicalTableNameCollision_ACU[];
  constructor(collisions: PhysicalTableNameCollision_ACU[]) {
    const detail = collisions
      .map(c => `「${c.physicalTableName}」← ${c.sheetNames.map((name, index) => `「${name}」(${c.sheetKeys[index]})`).join(' / ')}`)
      .join('；');
    const hasIdentityMergeFailure = collisions.some(collision => collision.reason === 'identity_merge_failed');
    super(hasIdentityMergeFailure
      ? `SQLite 物理表名冲突：相同规范表名被保留为多个 key，说明身份归并未完成；请检查历史数据与指导表的 key 对齐，并核对完整 sheetKey（大写 I、小写 l、数字 1 等字符在普通字体下极易混淆）。冲突：${detail}`
      : `SQLite 物理表名冲突：不同表的名称拼音相同，请重命名其中一张表。冲突：${detail}`);
    this.name = 'PhysicalTableNameCollisionError_ACU';
    this.collisions = collisions;
  }
}

/** Comparison-only normalization. Never write this value back to the display name. */
export function canonicalizeDisplayName_ACU(value: unknown): string {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

/** Converts a display value to an ASCII slug using the locked pinyin-pro dictionary. */
export function toAsciiSlug_ACU(value: unknown, maxLength = MAX_SHEET_SLUG_LENGTH_ACU): string {
  const canonical = canonicalizeDisplayName_ACU(value);
  if (!canonical) return '';
  const romanized = pinyin(canonical, {
    toneType: 'none',
    traditional: true,
    v: true,
    separator: '_',
    nonZh: 'consecutive',
  });
  return romanized.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, Math.max(1, maxLength))
    .replace(/_+$/g, '');
}

/** Returns an unreserved candidate only; callers must allocate before persisting it. */
export function buildStableSheetKeyCandidate_ACU(displayName: unknown): string | null {
  const slug = toAsciiSlug_ACU(displayName);
  return slug ? `sheet_${slug}` : null;
}

/**
 * Runtime SQLite names are derived from the display name, not from a legacy
 * CREATE TABLE identifier embedded in user-authored DDL. Each name is a
 * deterministic pure function of the sheet's own display name and is
 * independent of which other sheets are present, so building/filling/exporting
 * always agree. Duplicate slugs are a hard error (see the fail-loud note below).
 */
export function resolvePhysicalTableNames_ACU(data: TableDataObject_ACU | Record<string, unknown>): Map<string, string> {
  const entries = Object.keys(data || {})
    .filter(sheetKey => sheetKey.startsWith('sheet_'))
    .sort()
    .map(sheetKey => ({ sheetKey, sheet: (data as Record<string, Sheet_ACU>)[sheetKey] }));
  // 物理表名是 sheetKey 的确定性纯函数（仅由该 sheet 的显示名 slug 决定），
  // 绝不依赖“当前还有哪些别的表在场”。这样建表、填表、导出三处对同一 sheetKey
  // 永远解析出同一个名字，从根上消除集合漂移导致的 no such table。
  //
  // 拼音 slug 相同但 sheetKey 不同 = 真实物理表名冲突。此处 fail-loud 抛出，
  // 而不是静默追加 hash 令两表分叉——静默重命名会随入参集合变化重新产生漂移。
  // 冲突应由启动自检提前拦截并提示用户改名（见 assertNoPhysicalTableNameCollision_ACU）。
  const result = new Map<string, string>();
  const ownerBySlug = new Map<string, { sheetKey: string; sheet: Sheet_ACU | null | undefined }>();
  const collisions: PhysicalTableNameCollision_ACU[] = [];
  for (const { sheetKey, sheet } of entries) {
    const base = physicalTableNameBase_ACU(sheet, sheetKey);
    const normalized = base.toLowerCase();
    const owner = ownerBySlug.get(normalized);
    if (owner && owner.sheetKey !== sheetKey) {
      collisions.push(buildPhysicalTableNameCollision_ACU(base, [owner.sheetKey, sheetKey], [owner.sheet, sheet]));
      continue;
    }
    ownerBySlug.set(normalized, { sheetKey, sheet });
    result.set(sheetKey, base);
  }
  if (collisions.length > 0) {
    throw new PhysicalTableNameCollisionError_ACU(collisions);
  }
  return result;
}

/**
 * Reads a sheetKey out of an already-resolved physical-name map (see
 * resolvePhysicalTableNames_ACU). Throws the same error as
 * getPhysicalTableNameForSheet_ACU when the sheetKey is absent.
 * Hot loops that hold a resolved map MUST use this instead of re-resolving
 * the whole table data per sheet (O(S^2) pinyin slug work).
 */
export function getPhysicalTableNameFromResolvedMap_ACU(
  resolved: ReadonlyMap<string, string>,
  sheetKey: string,
): string {
  const physicalName = resolved.get(sheetKey);
  if (!physicalName) throw new Error(`无法为 Sheet 分配 SQLite runtime 表名：${sheetKey}`);
  return physicalName;
}

export function getPhysicalTableNameForSheet_ACU(data: TableDataObject_ACU | Record<string, unknown>, sheetKey: string): string {
  return getPhysicalTableNameFromResolvedMap_ACU(resolvePhysicalTableNames_ACU(data), sheetKey);
}

/** Use resolvePhysicalTableNames_ACU whenever collision arbitration is possible. */
export function resolvePhysicalTableName_ACU(sheet: Sheet_ACU | null | undefined, sheetKey: string): string {
  return physicalTableNameBase_ACU(sheet, sheetKey);
}

function physicalTableNameBase_ACU(sheet: Sheet_ACU | null | undefined, sheetKey: string): string {
  const displaySlug = toAsciiSlug_ACU(sheet?.name).replace(/_/g, '');
  const keySlug = toAsciiSlug_ACU(String(sheetKey || '').replace(/^sheet_/, '')).replace(/_/g, '');
  let candidate = (displaySlug || keySlug || 'sheet').slice(0, MAX_PHYSICAL_TABLE_NAME_LENGTH_ACU);
  if (/^[0-9]/.test(candidate) || SQLITE_RESERVED_TABLE_PREFIXES_ACU.some(prefix => candidate.toLowerCase().startsWith(prefix))) {
    candidate = `table_${candidate}`;
  }
  return candidate.slice(0, MAX_PHYSICAL_TABLE_NAME_LENGTH_ACU) || 'table_sheet';
}

/**
 * Detects physical-table-name collisions without throwing. Startup self-check
 * uses this to fail loud before any DDL runs. Returns [] when every sheet maps
 * to a unique physical name.
 */
export function detectPhysicalTableNameCollisions_ACU(
  data: TableDataObject_ACU | Record<string, unknown>,
): PhysicalTableNameCollision_ACU[] {
  const ownerBySlug = new Map<string, { sheetKey: string; base: string; sheet: Sheet_ACU | null | undefined }>();
  const grouped = new Map<string, { physicalTableName: string; sheetKeys: string[]; sheets: Array<Sheet_ACU | null | undefined> }>();
  const entries = Object.keys(data || {})
    .filter(sheetKey => sheetKey.startsWith('sheet_'))
    .sort()
    .map(sheetKey => ({ sheetKey, sheet: (data as Record<string, Sheet_ACU>)[sheetKey] }));
  for (const { sheetKey, sheet } of entries) {
    const base = physicalTableNameBase_ACU(sheet, sheetKey);
    const normalized = base.toLowerCase();
    const owner = ownerBySlug.get(normalized);
    if (!owner) {
      ownerBySlug.set(normalized, { sheetKey, base, sheet });
      continue;
    }
    if (owner.sheetKey === sheetKey) continue;
    const collision = grouped.get(normalized) || { physicalTableName: owner.base, sheetKeys: [owner.sheetKey], sheets: [owner.sheet] };
    collision.sheetKeys.push(sheetKey);
    collision.sheets.push(sheet);
    grouped.set(normalized, collision);
  }
  return [...grouped.values()].map(collision => buildPhysicalTableNameCollision_ACU(collision.physicalTableName, collision.sheetKeys, collision.sheets));
}

function buildPhysicalTableNameCollision_ACU(
  physicalTableName: string,
  sheetKeys: string[],
  sheets: Array<Sheet_ACU | null | undefined>,
): PhysicalTableNameCollision_ACU {
  const sheetNames = sheets.map((sheet, index) => String(sheet?.name || sheetKeys[index]));
  const canonicalNames = sheetNames.map(canonicalizeDisplayName_ACU);
  return {
    physicalTableName,
    sheetKeys,
    sheetNames,
    reason: canonicalNames.length > 0 && canonicalNames.every(name => name === canonicalNames[0])
      ? 'identity_merge_failed'
      : 'homophone_distinct_names',
  };
}

/** Startup guard: throws PhysicalTableNameCollisionError_ACU when any collision exists. */
export function assertNoPhysicalTableNameCollision_ACU(
  data: TableDataObject_ACU | Record<string, unknown>,
): void {
  const collisions = detectPhysicalTableNameCollisions_ACU(data);
  if (collisions.length > 0) {
    throw new PhysicalTableNameCollisionError_ACU(collisions);
  }
}

/**
 * Allocates identities for a new batch while preserving supplied persisted identities verbatim.
 * Colliding slugs receive a canonical-name hash, so new-key selection is input-order independent.
 */
export function allocateStableSheetKeys_ACU(
  displayNames: readonly unknown[],
  options: StableSheetKeyAllocationOptions_ACU = {},
): StableSheetKeyAllocation_ACU {
  const canonicalNames = displayNames.map(canonicalizeDisplayName_ACU);
  const slugs = displayNames.map(name => toAsciiSlug_ACU(name));
  const diagnostics: SheetNameDiagnostic_ACU[] = [];
  const firstCanonicalIndex = new Map<string, number>();
  const slugGroups = new Map<string, number[]>();
  const existingByCanonicalName = new Map<string, string>();
  const reservedKeys = new Set<string>();
  for (const existing of options.existing || []) {
    const canonicalName = canonicalizeDisplayName_ACU(existing.canonicalName);
    const sheetKey = String(existing.sheetKey || '');
    if (canonicalName && sheetKey) existingByCanonicalName.set(canonicalName, sheetKey);
    if (sheetKey) reservedKeys.add(sheetKey.toLowerCase());
  }

  canonicalNames.forEach((canonicalName, index) => {
    const originalName = String(displayNames[index] ?? '');
    if (!canonicalName || !slugs[index]) {
      diagnostics.push({ code: 'empty_name', index, originalName, canonicalName, candidateKey: null });
      return;
    }
    const firstIndex = firstCanonicalIndex.get(canonicalName);
    if (firstIndex === undefined) firstCanonicalIndex.set(canonicalName, index);
    else diagnostics.push({ code: 'duplicate_canonical_name', index, originalName, canonicalName, candidateKey: null, conflictsWithIndex: firstIndex });
    const group = slugGroups.get(slugs[index]) || [];
    group.push(index);
    slugGroups.set(slugs[index], group);
  });

  const keys: Array<string | null> = slugs.map((slug, index) => {
    if (!slug || !canonicalNames[index]) return null;
    const existingKey = existingByCanonicalName.get(canonicalNames[index]);
    if (existingKey) return existingKey;
    const group = slugGroups.get(slug) || [];
    const bareKey = `sheet_${slug}`;
    if (group.length === 1 && !reservedKeys.has(bareKey.toLowerCase())) return bareKey;
    return `sheet_${truncateForHash_ACU(slug)}_${stableHash_ACU(canonicalNames[index])}`;
  });
  const firstKeyIndex = new Map<string, number>();
  keys.forEach((key, index) => {
    if (!key) return;
    const firstIndex = firstKeyIndex.get(key);
    if (firstIndex === undefined) {
      firstKeyIndex.set(key, index);
    } else {
      diagnostics.push({ code: 'duplicate_sheet_key', index, originalName: String(displayNames[index] ?? ''), canonicalName: canonicalNames[index], candidateKey: key, conflictsWithIndex: firstIndex });
    }
    if (!existingByCanonicalName.has(canonicalNames[index]) && reservedKeys.has(key.toLowerCase())) {
      diagnostics.push({ code: 'duplicate_sheet_key', index, originalName: String(displayNames[index] ?? ''), canonicalName: canonicalNames[index], candidateKey: key });
    }
  });
  return { keys, diagnostics };
}

function truncateForHash_ACU(slug: string): string {
  return slug.slice(0, Math.max(1, MAX_SHEET_SLUG_LENGTH_ACU - 11)).replace(/_+$/g, '') || 'sheet';
}

function stableHash_ACU(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const char of value) {
    hash ^= BigInt(char.codePointAt(0)!);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0').slice(0, 10);
}
