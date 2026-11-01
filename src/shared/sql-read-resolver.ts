import type { TableDataObject_ACU } from './models/table-data';
import { getRuntimeEffectiveSchema_ACU, parseDDLColumnInfos_ACU, parseDDLTableName } from './ddl-utils';
import { canonicalizeDisplayName_ACU, getPhysicalTableNameFromResolvedMap_ACU, resolvePhysicalTableNames_ACU } from './sheet-identity';
import { resolveEffectiveDDL } from './effective-ddl';
import { rebindSqlReadIdentifiers_ACU } from './sql-mutation-table-rebind';
import { mapSqlColumnIdentifiers_ACU } from './sql-identifier-mapper';
import { logWarn_ACU } from './utils';

/**
 * 列别名的证据来源。用于 replay 侧记录「这次列重绑凭什么证据成立」，
 * 便于误重绑事后取证。只列可证明的三种：
 * - display_name：别名是该列的显示名（表头）；
 * - authored_ddl：别名来自作者原 DDL 的列名（fallback 场景下的桥）；
 * - fallback_slug：别名是目标完整表头经 mapSqlColumnIdentifiers_ACU 得到的确定性拼音列名；
 * - declared_display_alias：别名来自 sourceData.columnAliases 声明的历史显示名（身份证据）。
 *
 * 不设 current_physical：物理列名（target）自身不构成重绑，不会作为别名 key 出现。
 */
export type SheetColumnAliasEvidence_ACU = 'display_name' | 'authored_ddl' | 'fallback_slug' | 'declared_display_alias';

/** 歧义别名的候选目标列：一个别名曾映射到的全部目标列及其证据来源。 */
export interface SheetColumnAliasConflictCandidate_ACU {
  /** 冲突时该别名指向的真实列名。 */
  target: string;
  /** 该指向的证据来源。 */
  evidence: SheetColumnAliasEvidence_ACU;
}

export interface SheetColumnAliasMapResult_ACU {
  aliases: Map<string, Map<string, string>>;
  conflicts: Map<string, Set<string>>;
  /**
   * 物理表名 → 歧义别名 → 候选目标列列表。仅用于写路径歧义拒绝时
   * 给出「全部候选与各自证据来源」的结构化诊断；读路径不消费。
   * 与 conflicts 同步：conflicts 里的别名在此必有条目（至少两个候选）。
   */
  conflictCandidates: Map<string, Map<string, SheetColumnAliasConflictCandidate_ACU[]>>;
  /**
   * 物理表名 → (别名 → 证据来源)。仅供诊断/取证，读路径不消费。
   * 与 aliases 同步维护：冲突删除别名时一并删除其证据。
   */
  sourceByAlias: Map<string, Map<string, SheetColumnAliasEvidence_ACU>>;
}

export interface SheetAliasMapResult_ACU {
  aliases: Map<string, string>;
  conflicts: Set<string>;
}

export class SheetTableAliasResolutionError_ACU extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SheetTableAliasResolutionError_ACU';
  }
}

export interface ReadQueryResolveResult_ACU {
  sql: string;
  tableRebindCount: number;
  columnRebindCount: number;
  tableConflicts?: string[];
  columnConflicts?: string[];
  conflicts?: string[];
}

function canonicalizeSheetTableAlias_ACU(alias: unknown): string {
  return canonicalizeDisplayName_ACU(alias);
}

function addAlias_ACU(aliases: Map<string, string>, conflicts: Set<string>, alias: unknown, physicalName: string): void {
  const key = canonicalizeSheetTableAlias_ACU(alias);
  if (!key || conflicts.has(key)) return;
  const existing = aliases.get(key);
  if (existing && existing !== physicalName) {
    aliases.delete(key);
    conflicts.add(key);
    return;
  }
  aliases.set(key, physicalName);
}

/** Builds the shared, conflict-safe table alias registry used by SQL readers and writers. */
export function buildSheetTableAliasMap_ACU(
  sources: Iterable<TableDataObject_ACU | Record<string, unknown> | null | undefined>,
  options: {
    includeExtendedAliases?: boolean;
    skipInvalidSources?: boolean;
    /**
     * Caller-supplied pre-resolved physical-name maps (one entry per source,
     * indexed by iteration order). When present, the corresponding source is
     * NOT re-resolved: each sheetKey is read straight out of the map. This lets
     * hot loops (replay registry build) resolve the whole table data once per
     * epoch instead of once per sheet. Absent entries fall back to resolving
     * the source inline, so existing callers keep identical behavior.
     */
    preResolvedPhysicalNames?: Iterable<ReadonlyMap<string, string> | null | undefined>;
  } = {},
): SheetAliasMapResult_ACU {
  const aliases = new Map<string, string>();
  const conflicts = new Set<string>();
  const preResolved = options.preResolvedPhysicalNames ? [...options.preResolvedPhysicalNames] : [];
  let sourceIndex = 0;
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    let physicalNames: Map<string, string>;
    const pre = preResolved[sourceIndex];
    if (pre) {
      physicalNames = pre as Map<string, string>;
    } else {
      try {
        physicalNames = resolvePhysicalTableNames_ACU(source);
      } catch (error) {
        if (options.skipInvalidSources) continue;
        throw error;
      }
    }
    for (const [sheetKey, physicalName] of physicalNames) {
      const sheet = (source as Record<string, any>)[sheetKey];
      const declaredAliases = Array.isArray(sheet?.sourceData?.tableAliases) ? sheet.sourceData.tableAliases : [];
      const sourceAliases = [parseDDLTableName(String(sheet?.sourceData?.ddl || '')), physicalName, ...declaredAliases];
      if (options.includeExtendedAliases !== false) {
        sourceAliases.push(sheetKey, sheet?.uid, sheet?.name);
      }
      sourceAliases.forEach(alias => addAlias_ACU(aliases, conflicts, alias, physicalName));
    }
    sourceIndex += 1;
  }
  return { aliases, conflicts };
}

/**
 * Resolves historical runtime sheet keys that may be safely moved to keys from a
 * newer guide/template snapshot. Canonical display names are the sole automatic
 * identity signal: they are user-visible, available to legacy snapshots and are
 * stricter than the lossy pinyin physical name. Ambiguous mappings are skipped.
 */
export function resolveHistoricalSheetKeyMigrations_ACU(
  sourceData: TableDataObject_ACU | Record<string, unknown> | null | undefined,
  targetData: TableDataObject_ACU | Record<string, unknown> | null | undefined,
): Map<string, string> {
  if (!sourceData || typeof sourceData !== 'object' || !targetData || typeof targetData !== 'object') {
    return new Map();
  }

  const indexByCanonicalName = (data: TableDataObject_ACU | Record<string, unknown>, label: string): Map<string, string> => {
    const indexed = new Map<string, string>();
    const ambiguous = new Set<string>();
    for (const [sheetKey, rawSheet] of Object.entries(data)) {
      if (!sheetKey.startsWith('sheet_') || !rawSheet || typeof rawSheet !== 'object') continue;
      const canonicalName = canonicalizeDisplayName_ACU((rawSheet as any).name);
      if (!canonicalName) {
        logWarn_ACU(`[SheetIdentity] ${label} sheet ${sheetKey} 缺少有效显示名，跳过历史 key 对齐。`);
        continue;
      }
      if (ambiguous.has(canonicalName)) continue;
      const existing = indexed.get(canonicalName);
      if (existing && existing !== sheetKey) {
        indexed.delete(canonicalName);
        ambiguous.add(canonicalName);
        logWarn_ACU(`[SheetIdentity] ${label} 中规范表名「${canonicalName}」对应多个 sheet，跳过历史 key 对齐。`);
        continue;
      }
      indexed.set(canonicalName, sheetKey);
    }
    return indexed;
  };

  const sourceByCanonicalName = indexByCanonicalName(sourceData, '历史数据');
  const targetByCanonicalName = indexByCanonicalName(targetData, '目标快照');
  const migrations = new Map<string, string>();
  for (const [canonicalName, sourceKey] of sourceByCanonicalName) {
    const targetKey = targetByCanonicalName.get(canonicalName);
    if (!targetKey || sourceKey === targetKey) continue;
    if (Object.prototype.hasOwnProperty.call(sourceData, targetKey)) {
      logWarn_ACU(`[SheetIdentity] 历史 sheet ${sourceKey} 与目标 ${targetKey} 同名，但历史数据已存在目标 key；跳过归并。`);
      continue;
    }
    migrations.set(sourceKey, targetKey);
  }
  return migrations;
}

/**
 * Rebinds scheduling-time table selectors to sheet keys in a later snapshot by
 * using the same conflict-safe alias registry as SQL readers and writers.
 * Selectors may be sheet keys, uid values, display names, pinyin physical names,
 * or author DDL table names. Ambiguous and unprovable aliases fail closed.
 */
export function rebindSheetKeysThroughTableAliases_ACU(
  selectors: readonly string[],
  sourceData: TableDataObject_ACU | Record<string, unknown> | null | undefined,
  targetData: TableDataObject_ACU | Record<string, unknown> | null | undefined,
): string[] {
  if (!targetData || typeof targetData !== 'object') {
    throw new SheetTableAliasResolutionError_ACU('表身份重绑定失败：当前基底不可用。');
  }
  const sourcePhysicalNames = sourceData && typeof sourceData === 'object'
    ? resolvePhysicalTableNames_ACU(sourceData)
    : new Map<string, string>();
  const targetPhysicalNames = resolvePhysicalTableNames_ACU(targetData);
  const targetSheetKeyByPhysicalName = new Map<string, string>();
  for (const [sheetKey, physicalName] of targetPhysicalNames) {
    targetSheetKeyByPhysicalName.set(canonicalizeSheetTableAlias_ACU(physicalName), sheetKey);
  }
  const sourceRegistry = buildSheetTableAliasMap_ACU([sourceData], { includeExtendedAliases: true });
  const targetRegistry = buildSheetTableAliasMap_ACU([targetData], { includeExtendedAliases: true });
  const rebound: string[] = [];
  const sourceOwnerByTargetKey = new Map<string, string>();
  for (const rawSelector of selectors || []) {
    const selector = String(rawSelector || '').trim();
    if (!selector) continue;
    const normalized = canonicalizeSheetTableAlias_ACU(selector);
    const sourcePhysicalNameForSelector = sourceRegistry.conflicts.has(normalized)
      ? undefined
      : sourceRegistry.aliases.get(normalized);
    const sourceOwner = sourcePhysicalNameForSelector
      ? ([...sourcePhysicalNames].find(([, physicalName]) => canonicalizeSheetTableAlias_ACU(physicalName) === canonicalizeSheetTableAlias_ACU(sourcePhysicalNameForSelector))?.[0] || normalized)
      : normalized;

    if (targetRegistry.conflicts.has(normalized)) {
      throw new SheetTableAliasResolutionError_ACU(`表身份重绑定存在歧义：别名「${selector}」同时指向多张物理表。`);
    }
    const directTargetPhysicalName = targetRegistry.aliases.get(normalized);
    if (directTargetPhysicalName) {
      const directTargetSheetKey = targetSheetKeyByPhysicalName.get(canonicalizeSheetTableAlias_ACU(directTargetPhysicalName));
      if (!directTargetSheetKey) {
        throw new SheetTableAliasResolutionError_ACU(`表身份重绑定失败：别名「${selector}」对应的物理表不在当前基底中。`);
      }
      const directOwner = sourceOwnerByTargetKey.get(directTargetSheetKey);
      if (directOwner && directOwner !== sourceOwner) {
        throw new SheetTableAliasResolutionError_ACU(`表身份重绑定存在多对一冲突：${directOwner}、${sourceOwner} 同时指向 ${directTargetSheetKey}。`);
      }
      sourceOwnerByTargetKey.set(directTargetSheetKey, sourceOwner);
      if (!rebound.includes(directTargetSheetKey)) rebound.push(directTargetSheetKey);
      continue;
    }

    if (sourceRegistry.conflicts.has(normalized)) {
      throw new SheetTableAliasResolutionError_ACU(`表身份重绑定存在歧义：调度快照中的别名「${selector}」同时指向多张物理表。`);
    }
    const sourcePhysicalName = sourceRegistry.aliases.get(normalized);
    if (!sourcePhysicalName) {
      throw new SheetTableAliasResolutionError_ACU(`表身份重绑定失败：无法解析别名「${selector}」。`);
    }
    const sourceAliases = [...sourceRegistry.aliases.entries()]
      .filter(([, physicalName]) => canonicalizeSheetTableAlias_ACU(physicalName) === canonicalizeSheetTableAlias_ACU(sourcePhysicalName))
      .map(([alias]) => alias);
    const ambiguousAliases = sourceAliases.filter(alias => targetRegistry.conflicts.has(alias));
    if (ambiguousAliases.length > 0) {
      throw new SheetTableAliasResolutionError_ACU(`表身份重绑定存在歧义：别名「${ambiguousAliases[0]}」在当前基底中同时指向多张物理表。`);
    }
    const targetCandidates = new Set(
      sourceAliases
        .map(alias => targetRegistry.aliases.get(alias) && canonicalizeSheetTableAlias_ACU(targetRegistry.aliases.get(alias)))
        .filter((physicalName): physicalName is string => Boolean(physicalName)),
    );
    if (targetCandidates.size !== 1) {
      const reason = targetCandidates.size === 0 ? '无法证明其在当前基底中的对应表' : '多个别名证据指向不同物理表';
      throw new SheetTableAliasResolutionError_ACU(`表身份重绑定失败：别名「${selector}」${reason}。`);
    }
    const targetPhysicalName = [...targetCandidates][0];
    const targetSheetKey = targetSheetKeyByPhysicalName.get(targetPhysicalName);
    if (!targetSheetKey) throw new SheetTableAliasResolutionError_ACU(`表身份重绑定失败：别名「${selector}」对应的物理表不在当前基底中。`);
    const sourceSheetKey = [...sourcePhysicalNames].find(([, physicalName]) => canonicalizeSheetTableAlias_ACU(physicalName) === canonicalizeSheetTableAlias_ACU(sourcePhysicalName))?.[0] || normalized;
    const existingOwner = sourceOwnerByTargetKey.get(targetSheetKey);
    if (existingOwner && existingOwner !== sourceSheetKey) {
      throw new SheetTableAliasResolutionError_ACU(`表身份重绑定存在多对一冲突：${existingOwner}、${sourceSheetKey} 同时指向 ${targetSheetKey}。`);
    }
    sourceOwnerByTargetKey.set(targetSheetKey, sourceSheetKey);
    if (!rebound.includes(targetSheetKey)) rebound.push(targetSheetKey);
  }
  return rebound;
}

/**
 * Builds the target-first, conflict-safe column alias registry shared by SQL
 * readers and writers.
 *
 * 单一目标原则（计划 3.1）：第一个参数是当前 SQLite/runtime/replay state 的
 * 权威目标 schema；所有别名只能指向目标 schema 中真实存在的物理列。
 * supplementalSources 只提供别名证据，绝不提供目标列——模板中存在但目标中
 * 不存在的列不得注册（保持 SQLite 原始 no such column，防止把已删除列误写
 * 到别处）。
 *
 * 每列允许的别名来源（计划 3.2）：
 * - current_physical：resolveEffectiveDDL 的 mapping.sqlName（自身，不构成重绑）；
 * - display_name：当前表头显示名；
 * - fallback_slug：对目标完整表头调用一次 mapSqlColumnIdentifiers_ACU 得到的
 *   确定性拼音列名（按 sourceIndex 对齐，绝不逐列 slug 造成碰撞错误）；
 * - authored_ddl：当前显式 DDL 的作者列名；若当前 runtime 是 fallback，则从可信
 *   supplemental template 的 DDL 按唯一 canonical 显示名映射到目标列；
 * - declared_display_alias：sourceData.columnAliases 中声明的历史显示名。
 *
 * 冲突语义：同一别名指向多个目标列 → 删除该别名并记录 conflicts 与全部候选
 * 证据；supplemental 中独有、目标不存在的列 → 不注册；禁止相似度/编辑距离/
 * 模糊拼音/列序号兜底。
 */
export function buildSheetColumnAliasMap_ACU(
  targetData: TableDataObject_ACU | Record<string, unknown> | null | undefined,
  options: {
    supplementalSources?: Iterable<TableDataObject_ACU | Record<string, unknown> | null | undefined>;
    skipInvalidSupplementalSources?: boolean;
    /**
     * 只构建这些 sheetKey 的列别名（其余 sheet 不参与 target 注册、也不进入
     * targetSheetByCanonicalName 索引）。replay 惰性 registry 用它把整库构建
     * 收敛为「每 epoch 只构建被 sql_sheet_batch 命中的表」。不传 = 全量构建
     * （与旧行为完全一致）。物理名冲突仍由 resolvePhysicalTableNames_ACU
     * fail-loud 抛错（与全量路径同语义）。
     */
    targetSheetKeys?: ReadonlySet<string>;
  } = {},
): SheetColumnAliasMapResult_ACU {
  const aliases = new Map<string, Map<string, string>>();
  const conflicts = new Map<string, Set<string>>();
  const sourceByAlias = new Map<string, Map<string, SheetColumnAliasEvidence_ACU>>();
  const conflictCandidates = new Map<string, Map<string, SheetColumnAliasConflictCandidate_ACU[]>>();
  const wantsSheetKey = (sheetKey: string): boolean => (
    !options.targetSheetKeys || options.targetSheetKeys.has(sheetKey)
  );
  const recordConflictCandidate = (
    columnConflictCandidates: Map<string, SheetColumnAliasConflictCandidate_ACU[]>,
    aliasKey: string,
    target: string,
    evidence: SheetColumnAliasEvidence_ACU,
  ): void => {
    const list = columnConflictCandidates.get(aliasKey) || [];
    if (!list.some(candidate => candidate.target.toLowerCase() === target.toLowerCase() && candidate.evidence === evidence)) {
      list.push({ target, evidence });
    }
    columnConflictCandidates.set(aliasKey, list);
  };
  const addColumnAlias = (
    tableColumns: Map<string, string>,
    tableEvidence: Map<string, SheetColumnAliasEvidence_ACU>,
    tableConflictCandidates: Map<string, SheetColumnAliasConflictCandidate_ACU[]>,
    tableConflicts: Set<string>,
    source: string,
    target: string,
    evidence: SheetColumnAliasEvidence_ACU,
  ): void => {
    const sourceKey = String(source).toLowerCase();
    const targetKey = String(target).toLowerCase();
    if (!sourceKey || sourceKey === targetKey) return;
    const existing = tableColumns.get(sourceKey);
    if (existing && existing.toLowerCase() !== targetKey) {
      // 同一别名指向不同真实列 → 双向删除并记冲突（与表别名同语义）。
      recordConflictCandidate(tableConflictCandidates, sourceKey, existing, tableEvidence.get(existing.toLowerCase()) || evidence);
      recordConflictCandidate(tableConflictCandidates, sourceKey, target, evidence);
      if (tableColumns.get(existing.toLowerCase()) === existing) tableColumns.delete(existing.toLowerCase());
      tableColumns.delete(sourceKey);
      tableEvidence.delete(existing.toLowerCase());
      tableEvidence.delete(sourceKey);
      tableConflicts.add(sourceKey);
      return;
    }
    if (tableColumns.has(sourceKey)) return;
    tableColumns.set(sourceKey, target);
    tableEvidence.set(sourceKey, evidence);
  };

  if (!targetData || typeof targetData !== 'object') {
    return { aliases, conflicts, sourceByAlias, conflictCandidates };
  }
  // 单次解析 target 物理名：per-sheet 循环全部查 Map，不再每 sheet 全表重解析
  // （O(S^2) pinyin slug 计算）。抛错传播语义与旧 per-sheet 首次调用一致
  // （冲突 fail-loud，绝不静默改名）。
  const targetPhysicalNames = resolvePhysicalTableNames_ACU(targetData as TableDataObject_ACU);

  // ── 目标 schema 注册：current physical / display / fallback slug ──
  for (const [sheetKey, value] of Object.entries(targetData)) {
    if (!sheetKey.startsWith('sheet_') || !value || typeof value !== 'object') continue;
    if (!wantsSheetKey(sheetKey)) continue;
    const sheet = value as any;
    const physicalName = getPhysicalTableNameFromResolvedMap_ACU(targetPhysicalNames, sheetKey);
    const columns = aliases.get(physicalName) || new Map<string, string>();
    const tableConflicts = conflicts.get(physicalName) || new Set<string>();
    const tableConflictCandidates = conflictCandidates.get(physicalName) || new Map<string, SheetColumnAliasConflictCandidate_ACU[]>();
    const tableEvidence = sourceByAlias.get(physicalName) || new Map<string, SheetColumnAliasEvidence_ACU>();
    // runtime descriptor 优先：SyncBridge 导出的 non-enumerable `_acu_runtimeEffectiveSchema`
    // 是 SQLite 实际建表 schema 的唯一权威。冻结的 live runtime 数据作为 targetData 时
    // 必须直接消费 descriptor 的 columnMap，禁止对 sheet 重新 resolveEffectiveDDL——
    // 否则会因「DDL 英文列名无法与中文表头对齐」重算 fallback，制造列身份漂移（test31 双权威）。
    // 历史 replay/baseSnapshot 无 descriptor 时维持原 resolve 路径，行为完全兼容。
    const descriptor = getRuntimeEffectiveSchema_ACU(sheet) as {
      effectiveDDL?: string;
      columnMap?: {
        mappings?: Array<{ sourceIndex?: number; displayName?: string; sqlName?: string; required?: boolean }>;
        sqlToDisplay?: unknown;
      } | null | undefined;
    } | null | undefined;
    const resolved = resolveSheetColumns_ACU(sheet, sheet.uid || sheetKey, physicalName, descriptor);
    for (const mapping of resolved.columnMap.mappings) {
      // 自身物理名（target）不构成重绑，但注册 key 使读/写能识别它。
      columns.set(String(mapping.sqlName).toLowerCase(), mapping.sqlName);
      // display_name 证据
      addColumnAlias(columns, tableEvidence, tableConflictCandidates, tableConflicts,
        mapping.displayName, mapping.sqlName, 'display_name');
    }
    // fallback_slug：对目标完整表头调用一次 mapSqlColumnIdentifiers_ACU，
    // 按 sourceIndex 对齐（计划 6.1：必须批量计算，碰撞后缀 _2/_3 由映射器保证）。
    const headers = Array.isArray(sheet.content?.[0]) ? sheet.content[0].map((h: unknown) => String(h ?? '')) : [];
    if (headers.length > 0) {
      const { mappings: slugMappings } = mapSqlColumnIdentifiers_ACU(headers);
      const resolvedBySourceIndex = new Map(resolved.columnMap.mappings.map(mapping => [mapping.sourceIndex, mapping.sqlName]));
      for (const slugMapping of slugMappings) {
        const targetSqlName = resolvedBySourceIndex.get(slugMapping.index);
        if (!targetSqlName) continue;
        addColumnAlias(columns, tableEvidence, tableConflictCandidates, tableConflicts,
          slugMapping.sqlName, targetSqlName, 'fallback_slug');
      }
    }
    aliases.set(physicalName, columns);
    if (tableConflicts.size > 0) conflicts.set(physicalName, tableConflicts);
    if (tableEvidence.size > 0) sourceByAlias.set(physicalName, tableEvidence);
    if (tableConflictCandidates.size > 0) conflictCandidates.set(physicalName, tableConflictCandidates);
  }

  // ── supplemental 别名证据：authored_ddl（唯一 canonical 显示名映射）──
  const targetSheetByCanonicalName = new Map<string, { sheetKey: string; physicalName: string }>();
  for (const [sheetKey, value] of Object.entries(targetData)) {
    if (!sheetKey.startsWith('sheet_') || !value || typeof value !== 'object') continue;
    if (!wantsSheetKey(sheetKey)) continue;
    const sheet = value as any;
    const canonicalName = canonicalizeDisplayName_ACU(sheet?.name);
    if (!canonicalName) continue;
    if (targetSheetByCanonicalName.has(canonicalName)) continue;
    targetSheetByCanonicalName.set(canonicalName, { sheetKey, physicalName: getPhysicalTableNameFromResolvedMap_ACU(targetPhysicalNames, sheetKey) });
  }
  for (const rawSupplement of options.supplementalSources || []) {
    if (!rawSupplement || typeof rawSupplement !== 'object') continue;
    let supplement: TableDataObject_ACU | Record<string, unknown>;
    try {
      supplement = rawSupplement;
      // 校验表身份可解析（同表名/别名冲突会让身份定位失败，跳过该源）。
      resolvePhysicalTableNames_ACU(rawSupplement as TableDataObject_ACU);
    } catch (error) {
      if (options.skipInvalidSupplementalSources) continue;
      throw error;
    }
    for (const [sheetKey, value] of Object.entries(supplement)) {
      if (!sheetKey.startsWith('sheet_') || !value || typeof value !== 'object') continue;
      const sheet = value as any;
      const canonicalName = canonicalizeDisplayName_ACU(sheet?.name);
      const target = canonicalName ? targetSheetByCanonicalName.get(canonicalName) : undefined;
      if (!target) continue; // 表身份未唯一命中目标 sheet → 不提供任何列证据
 const tableColumns = aliases.get(target.physicalName) || new Map<string, string>();
      const tableConflicts = conflicts.get(target.physicalName) || new Set<string>();
      const tableConflictCandidates = conflictCandidates.get(target.physicalName) || new Map<string, SheetColumnAliasConflictCandidate_ACU[]>();
      const tableEvidence = sourceByAlias.get(target.physicalName) || new Map<string, SheetColumnAliasEvidence_ACU>();
      const supplementalDDL = String(sheet?.sourceData?.ddl || '');
      if (supplementalDDL) {
        // 目标列的 canonical 显示名 → 物理名索引（唯一映射）。
        // mapping.displayName 来自目标 content[0] 表头，统一按 canonical 显示名索引；
        // fallback 的 sqlName（拼音 slug）也一并登记，作为补充英文列名的确定性桥。
        const targetCanonicalToSql = new Map<string, string>();
        // 与主 target 注册同一权威：带 runtime descriptor 的 target 直接消费
        // descriptor 的 columnMap，禁止对冻结的 live runtime 数据重新
        // resolveEffectiveDDL（中文表头 + 英文无注释 DDL 会再次抛「表头没有对应
        // DDL 列」，即 test31 双权威漏网）。无 descriptor 的历史路径保持原 resolve。
        const targetSheet = (targetData as any)[target.sheetKey];
        const targetDescriptor = getRuntimeEffectiveSchema_ACU(targetSheet) as {
          columnMap?: {
            mappings?: Array<{ sourceIndex?: number; displayName?: string; sqlName?: string; required?: boolean }>;
          } | null | undefined;
        } | null | undefined;
        for (const mapping of resolveSheetColumns_ACU(
          targetSheet,
          targetSheet?.uid || target.sheetKey,
          target.physicalName,
          targetDescriptor,
        ).columnMap.mappings) {
          const canonicalDisplay = canonicalizeDisplayName_ACU(mapping.displayName);
          const canonicalSql = canonicalizeDisplayName_ACU(mapping.sqlName);
          if (canonicalDisplay) {
            // 同一 canonical 显示名指向不同目标列 → 不再作为唯一索引，删除防误配。
            if (targetCanonicalToSql.has(canonicalDisplay) && targetCanonicalToSql.get(canonicalDisplay) !== mapping.sqlName) targetCanonicalToSql.delete(canonicalDisplay);
            else targetCanonicalToSql.set(canonicalDisplay, mapping.sqlName);
          }
          if (canonicalSql) {
            if (targetCanonicalToSql.has(canonicalSql) && targetCanonicalToSql.get(canonicalSql) !== mapping.sqlName) targetCanonicalToSql.delete(canonicalSql);
            else targetCanonicalToSql.set(canonicalSql, mapping.sqlName);
          }
        }
        // 补充模板的「作者 DDL 列名 → 补充表头显示名」是模板内部的结构对齐：
        // DDL 列序与 content[0] 表头序一致（与 resolveEffectiveDDL 的 sourceIndex
        // 对齐同源，非位置猜测）。补充表头（如「当前详细地点」）canonical 唯一命中
        // 目标列，则该补充 DDL 列名（如 current_location）注册为指向目标物理列的别名。
        // 列数不一致或表头无法唯一命中 → 不注册，保持 SQLite 原始 no such column。
        // 注意：不能对补充 sheet 调用 resolveEffectiveDDL —— 英文无注释 DDL + 中文
        // 表头的模板会被 resolveInsertColumnMappings 判定「表头没有对应 DDL 列」而抛错，
        // 这会破坏 skipInvalidSupplementalSources 的容错语义。
        const supplementalColumns = parseDDLColumnInfos_ACU(supplementalDDL);
        const supplementalHeaders = Array.isArray(sheet?.content?.[0])
          ? sheet.content[0].map((h: unknown) => String(h ?? ''))
          : [];
        if (supplementalColumns.length > 0
          && supplementalColumns.length === supplementalHeaders.length) {
          for (let index = 0; index < supplementalColumns.length; index +=1) {
            const column = supplementalColumns[index];
            const headerCanonical = canonicalizeDisplayName_ACU(supplementalHeaders[index]);
            if (!headerCanonical) continue;
            const targetSqlName = targetCanonicalToSql.get(headerCanonical);
            if (!targetSqlName) continue; // 补充表头显示名未唯一命中目标列 → 不注册
            addColumnAlias(tableColumns, tableEvidence, tableConflictCandidates, tableConflicts,
              column.sqlName, targetSqlName, 'authored_ddl');
          }
        }
      }
      // declared_display_alias：sourceData.columnAliases 声明的历史显示名。
      const rawColumnAliases = (sheet?.sourceData as Record<string, any> | undefined)?.columnAliases;
      if (rawColumnAliases && typeof rawColumnAliases === 'object' && !Array.isArray(rawColumnAliases)) {
        const targetCanonicalToSql = new Map<string, string>();
        const targetSheet = (targetData as any)[target.sheetKey];
        const targetDescriptor = getRuntimeEffectiveSchema_ACU(targetSheet) as {
          columnMap?: {
            mappings?: Array<{ sourceIndex?: number; displayName?: string; sqlName?: string; required?: boolean }>;
          } | null | undefined;
        } | null | undefined;
        for (const mapping of resolveSheetColumns_ACU(
          targetSheet,
          targetSheet?.uid || target.sheetKey,
          target.physicalName,
          targetDescriptor,
        ).columnMap.mappings) {
          const canonical = canonicalizeDisplayName_ACU(mapping.displayName);
          if (canonical && !targetCanonicalToSql.has(canonical)) targetCanonicalToSql.set(canonical, mapping.sqlName);
        }
        for (const [physicalName, aliases] of Object.entries(rawColumnAliases)) {
          const physicalCanonical = canonicalizeDisplayName_ACU(physicalName);
          const targetSqlName = physicalCanonical ? targetCanonicalToSql.get(physicalCanonical) : undefined;
          if (!targetSqlName) continue; // 物理名未唯一命中目标列 → 不注册
          for (const alias of Array.isArray(aliases) ? aliases : []) {
            addColumnAlias(tableColumns, tableEvidence, tableConflictCandidates, tableConflicts,
              String(alias ?? ''), targetSqlName, 'declared_display_alias');
          }
        }
      }
      aliases.set(target.physicalName, tableColumns);
      if (tableConflicts.size > 0) conflicts.set(target.physicalName, tableConflicts);
      if (tableEvidence.size > 0) sourceByAlias.set(target.physicalName, tableEvidence);
      if (tableConflictCandidates.size > 0) conflictCandidates.set(target.physicalName, tableConflictCandidates);
    }
  }
  return { aliases, conflicts, sourceByAlias, conflictCandidates };
}


function isSqlWordStart_ACU(char: string): boolean {
  return /^[A-Za-z_\u0080-\uFFFF]$/.test(char);
}

function isSqlWordPart_ACU(char: string): boolean {
  return /^[A-Za-z0-9_$\u0080-\uFFFF]$/.test(char);
}

/**
 * 解析目标 sheet 的列映射，优先消费 runtime descriptor（SQLite 实际建表 schema 的
 * 唯一权威），回退到 resolveEffectiveDDL（历史 replay / 无 descriptor 路径，行为兼容）。
 *
 * 禁止对冻结的 live runtime 数据重新 resolveEffectiveDDL：中文表头 + 英文无注释 DDL
 * 会被 resolveInsertColumnMappings 判定「表头没有对应 DDL 列」而抛错（test31 双权威
 * 漏网）。descriptor 缺失或 columnMap 不完整时才走原 resolve 路径。
 */
function resolveSheetColumns_ACU(
  sheet: unknown,
  fallbackTableName: string,
  runtimeTableName: string,
  descriptor: {
    columnMap?: {
      mappings?: Array<{ sourceIndex?: number; displayName?: string; sqlName?: string; required?: boolean }>;
    } | null | undefined;
  } | null | undefined,
): { columnMap: { mappings: ReadonlyArray<{ sourceIndex: number; displayName: string; sqlName: string; required: boolean }> } } {
  if (descriptor && typeof descriptor === 'object' && descriptor.columnMap) {
    return {
      columnMap: {
        mappings: Array.isArray(descriptor.columnMap.mappings)
          ? descriptor.columnMap.mappings.map(mapping => ({
              sourceIndex: mapping.sourceIndex ?? 0,
              displayName: String(mapping.displayName ?? ''),
              sqlName: String(mapping.sqlName ?? ''),
              required: mapping.required === true,
            }))
          : [],
      },
    };
  }
  const resolved = resolveEffectiveDDL(
    sheet as any,
    fallbackTableName,
    runtimeTableName,
  );
  return { columnMap: resolved.columnMap };
}


function protectImplicitSelectAliases_ACU(masked: string, mask: (value: string) => string): string {
  const selectScopes: Array<{ start: number; depth: number }> = [];
  let depth = 0;
  for (let index = 0; index < masked.length;) {
    if (masked[index] === '(') { depth += 1; index += 1; continue; }

    if (masked[index] === ')') { depth = Math.max(0, depth - 1); index += 1; continue; }
    if (!isSqlWordStart_ACU(masked[index])) { index += 1; continue; }
    const start = index;
    index += 1;
    while (index < masked.length && isSqlWordPart_ACU(masked[index])) index += 1;
    if (masked.slice(start, index).toUpperCase() === 'SELECT') selectScopes.push({ start: index, depth });
  }

  const aliases = new Map<number, number>();
  const stopWords = new Set(['END', 'ASC', 'DESC', 'NULLS', 'FIRST', 'LAST', 'COLLATE']);
  const projectionTerminators = new Set(['FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'OFFSET', 'WINDOW', 'UNION', 'EXCEPT', 'INTERSECT']);
  const projectionModifiers = new Set(['DISTINCT', 'ALL']);
  const operandPrefixes = /(?:\b(?:AND|OR|IN|IS|LIKE|GLOB|MATCH|REGEXP|BETWEEN|ESCAPE|COLLATE)\s*|[+*/%<>=|&~-]\s*)$/i;
  const recordProjectionAlias = (start: number, end: number): void => {
    while (end > start && /\s/.test(masked[end - 1])) end -= 1;
    let aliasStart = end;
    while (aliasStart > start && isSqlWordPart_ACU(masked[aliasStart - 1])) aliasStart -= 1;
    if (aliasStart === end || !isSqlWordStart_ACU(masked[aliasStart]) || aliasStart === start || !/\s/.test(masked[aliasStart - 1])) return;
    const alias = masked.slice(aliasStart, end);
    if (stopWords.has(alias.toUpperCase()) || /^__ACU_SQL_PROTECTED_\d+__$/.test(alias)) return;
    const expression = masked.slice(start, aliasStart).trim();
    const expressionWithoutModifiers = expression.replace(/^(?:DISTINCT|ALL)\s+/i, '').trim();
    if (!expressionWithoutModifiers || projectionModifiers.has(expression.toUpperCase()) || operandPrefixes.test(expressionWithoutModifiers)) return;
    aliases.set(aliasStart, end);
  };

  for (const scope of selectScopes) {
    let projectionStart = scope.start;
    let currentDepth = scope.depth;
    let projectionClosed = false;
    for (let index = scope.start; index < masked.length;) {
      const char = masked[index];
      if (char === '(') { currentDepth += 1; index += 1; continue; }
      if (char === ')') {
        if (currentDepth === scope.depth) {
          recordProjectionAlias(projectionStart, index);
          projectionClosed = true;
          break;
        }
        if (currentDepth < scope.depth) break;
        currentDepth = Math.max(0, currentDepth - 1);
        index += 1;
        continue;
      }
      if (currentDepth === scope.depth && char === ',') {
        recordProjectionAlias(projectionStart, index);
        projectionStart = index + 1;
        index += 1;
        continue;
      }
      if (!isSqlWordStart_ACU(char)) { index += 1; continue; }
      const start = index;
      index += 1;
      while (index < masked.length && isSqlWordPart_ACU(masked[index])) index += 1;
      if (currentDepth === scope.depth && projectionTerminators.has(masked.slice(start, index).toUpperCase())) {
        recordProjectionAlias(projectionStart, start);
        projectionClosed = true;
        break;
      }
    }
    if (!projectionClosed) recordProjectionAlias(projectionStart, masked.length);
  }
  let result = masked;
  for (const [start, end] of [...aliases.entries()].sort(([left], [right]) => right - left)) {
    result = `${result.slice(0, start)}${mask(result.slice(start, end))}${result.slice(end)}`;
  }
  return result;
}

function translateLegacyReadSqlSafely_ACU(sql: string, translateSql: (sql: string) => string, protectedIdentifierSpans: ReadonlyArray<{ start: number; end: number }> = []): string {
  const protectedParts: string[] = [];
  let masked = '';
  let index = 0;
  const mask = (value: string): string => {
    const marker = `__ACU_SQL_PROTECTED_${protectedParts.length}__`;
    protectedParts.push(value);
    return marker;
  };
  const protectedByStart = new Map(protectedIdentifierSpans.map(span => [span.start, span]));
  while (index < sql.length) {
    const protectedSpan = protectedByStart.get(index);
    if (protectedSpan && protectedSpan.end > index) {
      masked += mask(sql.slice(index, protectedSpan.end));
      index = protectedSpan.end;
      continue;
    }
    const char = sql[index];
    const next = sql[index + 1];
    if (char === '-' && next === '-') {
      const lineFeed = sql.indexOf('\n', index + 2);
      const carriageReturn = sql.indexOf('\r', index + 2);
      const stop = [lineFeed, carriageReturn].filter(value => value >= 0).sort((left, right) => left - right)[0] ?? sql.length;
      masked += mask(sql.slice(index, stop));
      index = stop;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = sql.indexOf('*/', index + 2);
      const stop = end < 0 ? sql.length : end + 2;
      masked += mask(sql.slice(index, stop));
      index = stop;
      continue;
    }
    if (char === "'" || char === '"' || char === '`' || char === '[') {
      const close = char === '[' ? ']' : char;
      let cursor = index + 1;
      while (cursor < sql.length) {
        if (sql[cursor] !== close) cursor += 1;
        else if (sql[cursor + 1] === close) cursor += 2;
        else { cursor += 1; break; }
      }
      masked += mask(sql.slice(index, cursor));
      index = cursor;
      continue;
    }
    masked += char;
    index += 1;
  }
  // NameMapper predates token rebind and performs broad replacement. Protect
  // output aliases before invoking it so a presentation-only name cannot turn
  // into a physical column merely because no table/column token was rebound.
  const identifier = '[A-Za-z_\\u0080-\\uFFFF][A-Za-z0-9_$\\u0080-\\uFFFF]*';
  const protectedAliases = masked
    .replace(new RegExp(`(\\bAS\\s+)(${identifier})`, 'gi'), (_match, prefix, alias) => `${prefix}${mask(alias)}`)
    ;
  const protectedOutputAliases = protectImplicitSelectAliases_ACU(protectedAliases, mask);
  const translated = translateSql(protectedOutputAliases);
  let restored = translated;
  // Quoted identifiers are masked before explicit AS aliases are masked. The
  // latter can therefore contain an earlier marker; restore to a fixed point.
  for (let pass = 0; pass < protectedParts.length; pass += 1) {
    const next = restored.replace(/__ACU_SQL_PROTECTED_(\d+)__/g, (_match, value) => protectedParts[Number(value)] || '');
    if (next === restored) break;
    restored = next;
  }
  return restored;
}

export function resolveReadQuerySql_ACU(
  sql: string,
  tableData: TableDataObject_ACU | null | undefined,
  translateSql: (sql: string) => string,
): ReadQueryResolveResult_ACU {
  // PRAGMA arguments are SQLite grammar rather than SELECT identifiers.
  // Do not run a broad legacy translation over them.
  if (/^\s*PRAGMA\b/i.test(sql)) return { sql, tableRebindCount: 0, columnRebindCount: 0 };
  if (!tableData) {
    // Even without runtime table data, the legacy mapper must still respect
    // derived/CTE output scope. Run the structural pass with no aliases solely
    // to collect protected virtual-output spans.
    const rebound = rebindSqlReadIdentifiers_ACU(sql, new Map(), new Map(), { lenient: true });
    return { ...rebound, sql: translateLegacyReadSqlSafely_ACU(rebound.sql, translateSql, rebound.protectedIdentifierSpans) };
  }
  const { aliases: tableAliases, conflicts: tableConflicts } = buildSheetTableAliasMap_ACU([tableData]);
  const { aliases: columnAliases, conflicts: columnConflicts } = buildSheetColumnAliasMap_ACU(tableData);

  const referencedTableAliases = new Set<string>();
  const referencedColumnConflicts = new Set<string>();
  const rebound = rebindSqlReadIdentifiers_ACU(sql, tableAliases, columnAliases, {
    lenient: true,
    onTableReference: alias => referencedTableAliases.add(alias),
    onColumnReference: (alias, tableNames) => {
      if (tableNames.some(tableName => columnConflicts.get(tableName)?.has(alias))) referencedColumnConflicts.add(alias);
    },
  });
  const referencedTableConflicts = [...tableConflicts].filter(conflict => referencedTableAliases.has(conflict));
  return {
    ...rebound,
    sql: translateLegacyReadSqlSafely_ACU(rebound.sql, translateSql, rebound.protectedIdentifierSpans),
    tableConflicts: referencedTableConflicts,
    columnConflicts: [...referencedColumnConflicts],
    conflicts: [...referencedTableConflicts, ...referencedColumnConflicts],
  };
}
