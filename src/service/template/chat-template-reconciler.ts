import type { Sheet_ACU, TableDataObject_ACU } from '../../shared/models/table-data';
import { buildStableSheetKeyCandidate_ACU, canonicalizeDisplayName_ACU } from '../../shared/sheet-identity';
import { allocateStableRowId_ACU, createStableRowIdReservation_ACU } from '../../shared/stable-row-id-allocator';
import { getSheetColumnProjection_ACU, parseDDLColumnInfos_ACU, parseDDLTableConstraints_ACU, parseDDLTableName, parseDDLTableSuffix_ACU, parseDDLSafeDefaultLiteral_ACU, validateDDLTextAgainstHeaders_ACU } from '../../shared/ddl-utils';
import { generateDDL } from '../../data/sqlite/schema-mapper';
import type { TemplateSheetChange_ACU } from '../table/storage-frame-v2-persist';
import { hydrateTableDataStrict_ACU } from '../table/sqlite-template-validation';
import { normalizeTemplateRowIds_ACU } from './template-row-id-normalizer';
import type { StorageMode } from '../../shared/table-storage-provider';
import type { TableSheetLifecycleProjectionV2_ACU } from '../table/storage-frame-v2-types';

export interface ChatTemplateReconcileInput_ACU {
  baselineData: TableDataObject_ACU;
  templateData: TableDataObject_ACU;
  /**
   * 只读生命周期派生结果（V2 timeline 的 active/hidden/never_seen/indeterminate）。
   * 可选：未提供时退回当前基于 baseline 的猜测行为（兼容旧调用方与纯数据测试）。
   * 提供时协调层显式消费：
   * - status hidden → 模板重新包含该表时生成 reveal（恢复历史 key 与数据），不再伪装 introduction；
   * - status indeterminate → 目标生命周期无法判定，阻止计划提交（fail-closed）；
   * - status active/never_seen → 维持既有 introduction/rebase 语义。
   */
  lifecycle?: TableSheetLifecycleProjectionV2_ACU;
  destructiveChangeConfirmed: boolean;
  /**
   * 目标模板缺失的既有表如何处理：
   * false（默认，语义1）= 隐藏保留（产出 hide change，数据不删）；
   * true = 彻底硬删除（进 deletedSheetKeys，需 destructiveChangeConfirmed）。
   */
  hardDeleteMissingSheets?: boolean;
  /** 当前运行模式决定结构协调契约；native 路径不得解析或 hydrate SQLite DDL。 */
  storageMode?: StorageMode;
}

export interface ChatTemplateReconcileAudit_ACU {
  sheetKey: string;
  match: 'matched' | 'introduced' | 'deleted';
  baselineSheetKey?: string;
  templateSheetKey?: string;
  resolvedSheetKey: string;
  baselineName?: string;
  templateName?: string;
  canonicalName?: string;
  inheritedColumns: string[];
  addedColumns: string[];
  deletedColumns: string[];
  hiddenColumns: string[];
  physicalColumnMappings: Array<{ fromPhysicalName: string; toPhysicalName: string }>;
  fills: Array<{ physicalName: string; kind: string; literal: unknown }>;
  affectedRowCount: number;
  metadataChanged: boolean;
  metadataChangedFields: string[];
  destructiveChangeConfirmed: boolean;
  operations: Array<{ kind: string; contractVersion?: number; beforeSchemaDigest?: string; targetSchemaDigest?: string }>;
}

export interface ChatTemplateReconcilePlan_ACU {
  candidateData: TableDataObject_ACU;
  sheetChanges: TemplateSheetChange_ACU[];
  deletedSheetKeys: string[];
  hiddenSheetKeys: string[];
  audit: ChatTemplateReconcileAudit_ACU[];
  blockers: string[];
}

/**
 * Builds a read-only V2 change plan. Runtime writes, guide persistence and locking remain
 * owned by commitCurrentFloorTemplateChanges_ACU; this function deliberately has no I/O.
 */
export async function reconcileChatTemplate_ACU(input: ChatTemplateReconcileInput_ACU): Promise<ChatTemplateReconcilePlan_ACU> {
  const baselineData = clone_ACU(input.baselineData);
  const rawTemplateData = clone_ACU(input.templateData);
  const blockers: string[] = [];
  const deletedSheetKeys: string[] = [];
  const hiddenSheetKeys: string[] = [];
  const audit: ChatTemplateReconcileAudit_ACU[] = [];
  const normalization = normalizeTemplateRowIds_ACU(rawTemplateData, {
    syncDdl: input.storageMode !== 'native',
    rejectCrossSourceDuplicateRowIds: false,
    validateExistingDdl: false,
  });
  if (normalization.blockers.length > 0) {
    return emptyPlan_ACU(baselineData, audit, normalization.blockers.map(item => item.message));
  }

  const templateData = normalization.templateData;
  if (input.storageMode !== 'native') {
    // SQLite 模式下，已有数据的聊天表可能没有持久化 DDL（运行时依赖 fallback）。
    // 协调层是唯一没有接入缺失 DDL fallback 的入口，导致空 DDL 被解析为零列、
    // 与含 row_id 的表头必然不等，所有匹配表都被误判为“DDL 与表头列数不一致”。
    // 在进入表身份匹配与 schema 协调前，为 baseline 与规范化后的 template 补齐
    // 缺失 DDL（仅缺失/全空白，绝不覆盖非空 DDL），使后续逻辑看到同一份合法契约。
    const baselineFallback = applyMissingDdlFallback_ACU(baselineData, '当前聊天基线');
    if (baselineFallback.blockers.length > 0) {
      return emptyPlan_ACU(baselineData, audit, baselineFallback.blockers);
    }
    const templateFallback = applyMissingDdlFallback_ACU(templateData, '目标模板');
    if (templateFallback.blockers.length > 0) {
      return emptyPlan_ACU(baselineData, audit, templateFallback.blockers);
    }
  }

  const candidateData = stripRuntimeSeedRows_ACU(baselineData);
  candidateData.mate = clone_ACU(templateData.mate || baselineData.mate);
  for (const [key, sheet] of listSheets_ACU(baselineData)) {
    try { validateBaselineSheetRows_ACU(sheet); } catch (error: any) { blockers.push(`当前聊天表「${sheet.name || key}」历史数据无效：${error?.message || String(error)}`); }
  }
  // 旧随机 key 迁移到稳定 key 后，历史 checkpoint 里可能残留零数据行的旧身份
  // （与被模板认领的新 key 同名或互为别名）。它们不是「两张不同的表」，而是同一逻辑表
  // 未收敛的旧 identity：不作为重复身份 blocker，而是排除出身份索引，让下方
  // 「目标模板缺失的既有表」循环按既有 hide 语义把它们隐藏收敛。
  const staleLegacyBaselineKeys = resolveStaleLegacyBaselineSheetKeys_ACU(baselineData, templateData);
  const baselineByName = indexSheetsByName_ACU(baselineData, '当前聊天', blockers, staleLegacyBaselineKeys);
  const templateByName = indexSheetsByName_ACU(templateData, '导入模板', blockers);
  validateTableAliasDeclarations_ACU(baselineData, '当前聊天', blockers, staleLegacyBaselineKeys);
  validateTableAliasDeclarations_ACU(templateData, '导入模板', blockers);
  if (blockers.length > 0) return emptyPlan_ACU(baselineData, audit, blockers);

  const matchedKeys = new Set<string>();
  const rebaseKeys = new Set<string>();
  const revealKeys = new Set<string>();
  // 被任一模板表按当前名精确匹配占用的 baseline key：别名认回必须跳过这些表，
  // 否则「模板同时含新旧两个名字」会因迭代顺序产生歧义匹配或误报重复。
  // 陈旧旧 identity 同样不参与别名认回（它们的身份已由被认领的新 key 持有）。
  const nameClaimedBaselineKeys = new Set<string>(staleLegacyBaselineKeys);
  for (const [canonicalName] of templateByName) {
    const claimed = baselineByName.get(canonicalName);
    if (claimed) nameClaimedBaselineKeys.add(claimed.key);
  }
  for (const [canonicalName, templateEntry] of templateByName) {
    const matchedByName = baselineByName.get(canonicalName);
    const occupiedByKey = baselineData[templateEntry.key] as Sheet_ACU | undefined;
    if (matchedByName && occupiedByKey && matchedByName.key !== templateEntry.key) {
      blockers.push(`表「${templateEntry.sheet.name || templateEntry.key}」的名称匹配当前聊天 key「${matchedByName.key}」，但模板 key「${templateEntry.key}」已被表「${occupiedByKey.name || templateEntry.key}」占用，无法唯一协调。`);
      continue;
    }
    let previous = matchedByName;
    if (!previous) {
      const aliasMatches = findExplicitTableAliasMatches_ACU(templateEntry.sheet, baselineData, nameClaimedBaselineKeys);
      if (aliasMatches.length > 1) {
        blockers.push(`表「${templateEntry.sheet.name || templateEntry.key}」的显式历史别名同时匹配多张当前聊天表，无法唯一协调。`);
        continue;
      }
      previous = aliasMatches[0];
    }
    if (!previous) {
      const introducedKey = buildStableSheetKeyCandidate_ACU(templateEntry.sheet.name);
      if (!introducedKey) {
        blockers.push(`新增表「${templateEntry.sheet.name || templateEntry.key}」缺少可用于派生 key 的有效显示名。`);
        continue;
      }
      // 生命周期感知：派生 key 在历史中曾存在（hidden / indeterminate / active）时，
      // 这不是"新增表"。协调层显式消费唯一生命周期事实，不再靠 baseline 缺席猜测。
      const lifecycleEntry = input.lifecycle?.statusBySheetKey?.[introducedKey];
      if (lifecycleEntry) {
        if (lifecycleEntry.status === 'hidden') {
          // hidden → 显式 reveal：恢复历史 key（稳定 sheetKey），数据由 persist 层
          // resolveRevealSource_ACU 恢复"离开时最新状态"。协调层只带模板结构，不伪装 introduction。
          const revealed = asIntroducedSheet_ACU(templateEntry.sheet, introducedKey);
          candidateData[introducedKey] = revealed;
          audit.push({ sheetKey: introducedKey, resolvedSheetKey: introducedKey, match: 'introduced', templateSheetKey: templateEntry.key, templateName: templateEntry.sheet.name, canonicalName, inheritedColumns: [], addedColumns: headers_ACU(revealed).slice(1), deletedColumns: [], hiddenColumns: [], physicalColumnMappings: [], fills: [], affectedRowCount: Math.max(0, revealed.content.length - 1), metadataChanged: false, metadataChangedFields: [], destructiveChangeConfirmed: false, operations: [] });
          revealKeys.add(introducedKey);
          continue;
        }
        if (lifecycleEntry.status === 'indeterminate') {
          blockers.push(`表「${templateEntry.sheet.name || templateEntry.key}」(${introducedKey}) 的历史生命周期无法判定（indeterminate），已阻止模板提交。请先在数据管理中检查并恢复 V2 历史。`);
          continue;
        }
        // status === 'active' 但基线不含该表：这里刻意不 fail-closed。
        //
        // 「是否仍活跃」的权威来源只有 replay 后的 active state，不是 lifecycle 派生结论；
        // lifecycle 是历史 timeline 归并，遇到无 full-checkpoint 基底（replacement_anchor /
        // temporary baseline）等场景仍可能与同一时点的基线不一致。在协调层按这个非权威结论
        // 拒绝，会把「模板重新包含一张历史痕迹表」变成用户无法自救的死局：重新读取表格不会
        // 改变任何历史事实，错误必然复现。
        //
        // 因此这里按 introduction 继续，真正的覆盖风险由提交层用权威事实判定：
        // storage-frame-v2-persist.ts 的 activeHas → active_introduction_conflict（活数据保护），
        // introductionHistoryEvidence_ACU → reveal / indeterminate（历史存在则唤醒而非覆盖）。
        // never_seen 同样落到 introduction。
      }
      const occupiedByIntroducedKey = candidateData[introducedKey] as Sheet_ACU | undefined;
      if (occupiedByIntroducedKey) {
        blockers.push(`新增表「${templateEntry.sheet.name || templateEntry.key}」派生 key「${introducedKey}」与当前表「${occupiedByIntroducedKey.name || introducedKey}」冲突；两张不同名称的表不能共享同一 key。`);
        continue;
      }
      try {
        const introduced = asIntroducedSheet_ACU(templateEntry.sheet, introducedKey);
        candidateData[introducedKey] = introduced;
        audit.push({ sheetKey: introducedKey, resolvedSheetKey: introducedKey, match: 'introduced', templateSheetKey: templateEntry.key, templateName: templateEntry.sheet.name, canonicalName, inheritedColumns: [], addedColumns: headers_ACU(introduced).slice(1), deletedColumns: [], hiddenColumns: [], physicalColumnMappings: [], fills: [], affectedRowCount: Math.max(0, introduced.content.length - 1), metadataChanged: false, metadataChangedFields: [], destructiveChangeConfirmed: false, operations: [] });
      } catch (error: any) {
        blockers.push(`新增表「${templateEntry.sheet.name || templateEntry.key}」(${introducedKey}) 无法引入：${error?.message || String(error)}`);
      }
      continue;
    }
    if (matchedKeys.has(previous.key)) {
      blockers.push(`导入模板中的多个表同时匹配当前聊天表「${previous.sheet.name || previous.key}」（key=${previous.key}），无法唯一协调。`);
      continue;
    }
    matchedKeys.add(previous.key);
    try {
      const reconciled = reconcileMatchedSheet_ACU(
        previous.sheet,
        templateEntry.sheet,
        previous.key,
        templateEntry.key,
        input.storageMode === 'native' ? 'native' : 'sqlite',
      );
      candidateData[previous.key] = reconciled.sheet;
      if (reconciled.changed) rebaseKeys.add(previous.key);
      audit.push(reconciled.audit);
    } catch (error: any) {
      blockers.push(`表「${templateEntry.sheet.name || templateEntry.key}」无法协调（baselineKey=${previous.key} → templateKey=${templateEntry.key}）：${error?.message || String(error)}`);
    }
  }
  for (const [key, sheet] of listSheets_ACU(baselineData)) {
    if (matchedKeys.has(key)) continue;
    // 目标模板缺失的既有表：默认隐藏保留（语义1），仅在显式硬删除时才进 deletedSheetKeys。
    if (input.hardDeleteMissingSheets === true) {
      if (!input.destructiveChangeConfirmed) blockers.push(`删除表「${sheet.name || key}」需要显式确认。`);
      deletedSheetKeys.push(key);
      delete (candidateData as any)[key];
      audit.push({ sheetKey: key, resolvedSheetKey: key, match: 'deleted', baselineSheetKey: key, baselineName: sheet.name, canonicalName: canonicalizeDisplayName_ACU(sheet.name), inheritedColumns: [], addedColumns: [], deletedColumns: headers_ACU(sheet).slice(1), hiddenColumns: [], physicalColumnMappings: [], fills: [], affectedRowCount: Math.max(0, sheet.content.length - 1), metadataChanged: false, metadataChangedFields: [], destructiveChangeConfirmed: input.destructiveChangeConfirmed, operations: [] });
    } else {
      // 生命周期感知：目标表历史生命周期无法判定时，隐藏操作也属于"不知道它在哪"，
      // 不能静默隐藏（可能误伤 indeterminate 历史）。fail-closed 阻止提交。
      const lifecycleEntry = input.lifecycle?.statusBySheetKey?.[key];
      if (lifecycleEntry?.status === 'indeterminate') {
        blockers.push(`表「${sheet.name || key}」(${key}) 的历史生命周期无法判定（indeterminate），已阻止隐藏操作。请先在数据管理中检查并恢复 V2 历史。`);
        continue;
      }
      hiddenSheetKeys.push(key);
      delete (candidateData as any)[key];
      audit.push({ sheetKey: key, resolvedSheetKey: key, match: 'deleted', baselineSheetKey: key, baselineName: sheet.name, canonicalName: canonicalizeDisplayName_ACU(sheet.name), inheritedColumns: [], addedColumns: [], deletedColumns: [], hiddenColumns: headers_ACU(sheet).slice(1), physicalColumnMappings: [], fills: [], affectedRowCount: Math.max(0, sheet.content.length - 1), metadataChanged: false, metadataChangedFields: [], destructiveChangeConfirmed: input.destructiveChangeConfirmed, operations: [] });
    }
  }
  if (blockers.length > 0) return emptyPlan_ACU(baselineData, audit, blockers);

  // checkpoint.data 就是协调器算好的目标全量；结构变更统一表达为数据边界上的 per-sheet checkpoint。
  const sheetChanges: TemplateSheetChange_ACU[] = [];
  for (const [key, sheet] of listSheets_ACU(candidateData)) {
    if (revealKeys.has(key)) {
      sheetChanges.push({ kind: 'reveal', sheetKey: key, sheetData: sheet });
      audit.find(item => item.sheetKey === key)?.operations.push({ kind: 'reveal' });
    } else if (!baselineData[key]) {
      sheetChanges.push({ kind: 'introduction', sheetKey: key, sheetData: sheet });
      audit.find(item => item.sheetKey === key)?.operations.push({ kind: 'introduction' });
    } else if (rebaseKeys.has(key)) {
      sheetChanges.push({ kind: 'rebase', sheetKey: key, sheetData: sheet });
      audit.find(item => item.sheetKey === key)?.operations.push({ kind: 'rebase' });
    }
  }
  // 隐藏表：产出 hide change（sheetData 携带 baseline 结构，persist 层据此定位并保留数据）。
  for (const key of hiddenSheetKeys) {
    sheetChanges.push({ kind: 'hide', sheetKey: key, sheetData: clone_ACU(baselineData[key]) as Sheet_ACU });
    audit.find(item => item.sheetKey === key)?.operations.push({ kind: 'hide' });
  }
  candidateData.mate = clone_ACU(candidateData.mate);
  if (input.storageMode !== 'native') {
    for (const [key, sheet] of listSheets_ACU(candidateData)) {
      try {
        const validation = validateDDLTextAgainstHeaders_ACU(String(sheet.sourceData?.ddl || ''), headers_ACU(sheet));
        if (validation.valid) continue;
        return emptyPlan_ACU(baselineData, audit, [
          `完整 replay candidate DDL/表头预检失败: ${key}: ${validation.message}`,
        ]);
      } catch (error: any) {
        return emptyPlan_ACU(baselineData, audit, [
          `完整 replay candidate DDL/表头预检失败: ${key}: ${error?.message || String(error)}`,
        ]);
      }
    }
  }

  // 列投影预检双模式执行（S0-3）：native 的 hiddenPhysicalColumns 以表头名为身份，
  // 与 SQLite 的 physical 名一样必须能被 getSheetColumnProjection_ACU 解析。
  // 非法隐藏集在协调期变 blocker（fail-closed），而不是留到运行时投影抛错。
  for (const [key, sheet] of listSheets_ACU(candidateData)) {
    try {
      getSheetColumnProjection_ACU(sheet);
    } catch (error: any) {
      return emptyPlan_ACU(baselineData, audit, [
        `完整 replay candidate 列投影预检失败: ${key}: ${error?.message || String(error)}`,
      ]);
    }
  }

  if (input.storageMode !== 'native') {
    try {
      // 运行时协调路径：与 template-state-reset.ts（initGameSession）同为运行时注入/协调，
      // 非法显式 DDL 允许降级为 fallback schema（:242 已存在 native 门禁，此处只作用于 sqlite）。
      // 持久化契约校验（storage-frame-v2-persist.ts:3190）保持严格，不在此处放宽。
      await hydrateTableDataStrict_ACU(candidateData, { allowRuntimeDdlFallback: true });
    } catch (error: any) {
      return emptyPlan_ACU(baselineData, audit, [
        `完整 replay candidate SQLite hydrate 失败: ${error?.message || String(error)}`,
      ]);
    }
  }
  for (const key of deletedSheetKeys) audit.find(item => item.sheetKey === key)?.operations.push({ kind: 'delete' });
  return { candidateData, sheetChanges, deletedSheetKeys, hiddenSheetKeys, audit, blockers: [] };
}


interface SheetEntry_ACU { key: string; sheet: Sheet_ACU; }

function stripRuntimeSeedRows_ACU(data: TableDataObject_ACU): TableDataObject_ACU {
  const clone = clone_ACU(data);
  for (const [, sheet] of listSheets_ACU(clone)) delete sheet.seedRows;
  return clone;
}

function emptyPlan_ACU(candidateData: TableDataObject_ACU, audit: ChatTemplateReconcileAudit_ACU[], blockers: string[]): ChatTemplateReconcilePlan_ACU {
  return {
    candidateData: stripRuntimeSeedRows_ACU(candidateData),
    sheetChanges: [],
    deletedSheetKeys: [],
    hiddenSheetKeys: [],
    audit: audit.map(item => ({ ...item, operations: [] as ChatTemplateReconcileAudit_ACU['operations'] })),
    blockers,
  };
}

function clone_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function listSheets_ACU(data: TableDataObject_ACU): Array<[string, Sheet_ACU]> {
  return Object.keys(data || {}).filter(key => key.startsWith('sheet_'))
    .map(key => [key, (data as any)[key]] as [string, Sheet_ACU])
    .filter(([, sheet]) => !!sheet && typeof sheet === 'object' && !Array.isArray(sheet));
}

const SHEET_KEY_CONFUSABLE_HINT_ACU = '请核对完整 sheetKey（大写 I、小写 l、数字 1 等字符在普通字体下极易混淆）';

function describeSheetForDiagnostic_ACU(entry: SheetEntry_ACU): string {
  return `「${entry.sheet.name || entry.key}」(${entry.key}, ${sheetDataRowCount_ACU(entry.sheet)} 行)`;
}

function indexSheetsByName_ACU(
  data: TableDataObject_ACU,
  label: string,
  blockers: string[],
  excludedKeys: ReadonlySet<string> = new Set(),
): Map<string, SheetEntry_ACU> {
  const entries = new Map<string, SheetEntry_ACU>();
  for (const [key, sheet] of listSheets_ACU(data)) {
    if (excludedKeys.has(key)) continue;
    const canonicalName = canonicalizeDisplayName_ACU(sheet.name);
    if (!canonicalName) {
      blockers.push(`${label}存在空表名：${key}。`);
      continue;
    }
    const existing = entries.get(canonicalName);
    if (existing) {
      blockers.push(`${label}表名规范化重复：${describeSheetForDiagnostic_ACU(existing)}与${describeSheetForDiagnostic_ACU({ key, sheet })}规范化后同名「${canonicalName}」，同一逻辑表被两个 sheetKey 同时持有。${SHEET_KEY_CONFUSABLE_HINT_ACU}。`);
      continue;
    }
    entries.set(canonicalName, { key, sheet });
  }
  return entries;
}

/**
 * tableAliases 是显式身份声明。它可以和同表的当前名称重合，但不能被另一张
 * 表的当前名称或历史别名占用；否则后续 SQL/AI 路由会扩大写入目标。
 */
function validateTableAliasDeclarations_ACU(
  data: TableDataObject_ACU,
  label: string,
  blockers: string[],
  excludedKeys: ReadonlySet<string> = new Set(),
): void {
  const ownerByIdentity = new Map<string, SheetEntry_ACU>();
  for (const entry of listSheets_ACU(data).map(([key, sheet]) => ({ key, sheet }))) {
    if (excludedKeys.has(entry.key)) continue;
    const identities = [entry.sheet.name, ...getExplicitTableAliases_ACU(entry.sheet)];
    for (const identity of identities) {
      const canonical = canonicalizeDisplayName_ACU(identity);
      if (!canonical) continue;
      const owner = ownerByIdentity.get(canonical);
      if (!owner) {
        ownerByIdentity.set(canonical, entry);
        continue;
      }
      if (owner.key !== entry.key) {
        blockers.push(`${label}表别名规范化重复：${describeSheetForDiagnostic_ACU(owner)}与${describeSheetForDiagnostic_ACU(entry)}都声明了「${String(identity).trim()}」。${SHEET_KEY_CONFUSABLE_HINT_ACU}。`);
      }
    }
  }
}

function getExplicitTableAliases_ACU(sheet: Sheet_ACU): string[] {
  const raw = (sheet.sourceData as unknown as Record<string, unknown> | undefined)?.tableAliases;
  if (!Array.isArray(raw)) return [];
  return raw.map(value => String(value ?? '').trim()).filter(Boolean);
}

function sheetDataRowCount_ACU(sheet: Sheet_ACU): number {
  return Array.isArray(sheet?.content) ? Math.max(0, sheet.content.length - 1) : 0;
}

function sheetIdentityCanonicals_ACU(sheet: Sheet_ACU): Set<string> {
  return new Set(
    [sheet.name, ...getExplicitTableAliases_ACU(sheet)]
      .map(canonicalizeDisplayName_ACU)
      .filter(Boolean),
  );
}

function identitySetsIntersect_ACU(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  for (const identity of left) if (right.has(identity)) return true;
  return false;
}

/**
 * 识别 baseline 中可证明陈旧的旧 identity（旧随机 key → 稳定 key 迁移未收敛的残留）。
 *
 * 判定必须同时满足，任何歧义都不判定（保留原有 blocker，fail-closed）：
 * - 与另一张 baseline 表身份重合（显示名或显式别名的 canonical 有交集）；
 * - 自身零数据行（合法的空新表也可能零行，所以零行本身不是充分条件）；
 * - 幸存者唯一可判，按优先级逐级比较，恰有一方满足即判定：
 *   1. key 被模板直接持有；2. 当前显示名被模板认领（同名双方会并列，落到下一级）；
 *   3. key 等于自身显示名派生的稳定 key（旧随机 key 永远不满足）；
 * - 幸存者不能同时也被判为陈旧（多张表互相指认 → 歧义，整体回退为 blocker）。
 */
function resolveStaleLegacyBaselineSheetKeys_ACU(baselineData: TableDataObject_ACU, templateData: TableDataObject_ACU): Set<string> {
  const baselineEntries = listSheets_ACU(baselineData).map(([key, sheet]) => ({
    key,
    sheet,
    identities: sheetIdentityCanonicals_ACU(sheet),
    rowCount: sheetDataRowCount_ACU(sheet),
  }));
  type BaselineEntry = typeof baselineEntries[number];
  const templateEntries = listSheets_ACU(templateData).map(([key, sheet]) => ({ key, name: canonicalizeDisplayName_ACU(sheet.name) }));
  const templateKeys = new Set(templateEntries.map(entry => entry.key));
  const templateNames = new Set(templateEntries.map(entry => entry.name).filter(Boolean));
  // 认领该 baseline 表的模板表 key 集合（按 key 相等或当前显示名相等）。
  const templateClaimers = (entry: BaselineEntry): Set<string> => {
    const name = canonicalizeDisplayName_ACU(entry.sheet.name);
    return new Set(templateEntries.filter(template => template.key === entry.key || (!!name && template.name === name)).map(template => template.key));
  };
  const survivorCriteria: Array<(entry: BaselineEntry) => boolean> = [
    entry => templateKeys.has(entry.key),
    entry => templateNames.has(canonicalizeDisplayName_ACU(entry.sheet.name)),
    entry => buildStableSheetKeyCandidate_ACU(entry.sheet.name) === entry.key,
  ];
  const pickSurvivor = (a: BaselineEntry, b: BaselineEntry): { survivor: BaselineEntry; candidate: BaselineEntry } | null => {
    // 双方分别被不同的模板表认领 → 模板确实想要两张表，身份重合是模板/历史层面的真实冲突，
    // 不是可收敛的陈旧 identity；保留 blocker。同一模板表认领双方（典型：同名两代 key）才继续判定。
    const aClaimers = templateClaimers(a);
    const bClaimers = templateClaimers(b);
    if (aClaimers.size > 0 && bClaimers.size > 0 && ![...aClaimers].some(key => bClaimers.has(key))) return null;
    for (const criterion of survivorCriteria) {
      const aMatches = criterion(a);
      const bMatches = criterion(b);
      if (aMatches === bMatches) continue;
      return aMatches ? { survivor: a, candidate: b } : { survivor: b, candidate: a };
    }
    return null;
  };

  const stale = new Set<string>();
  const survivors = new Set<string>();
  for (let left = 0; left < baselineEntries.length; left += 1) {
    for (let right = left + 1; right < baselineEntries.length; right += 1) {
      const a = baselineEntries[left];
      const b = baselineEntries[right];
      if (!identitySetsIntersect_ACU(a.identities, b.identities)) continue;
      const decision = pickSurvivor(a, b);
      if (!decision) continue;
      if (decision.candidate.rowCount > 0) continue;
      stale.add(decision.candidate.key);
      survivors.add(decision.survivor.key);
    }
  }
  for (const key of survivors) {
    // 同一 key 既是幸存者又被判陈旧 → 身份关系有歧义，全部回退为 blocker。
    if (stale.has(key)) return new Set();
  }
  return stale;
}

/**
 * 双向显式身份交集匹配（S1-5）：模板身份集（当前名 + 声明别名）与 baseline 身份集
 * （当前名 + 累积别名）有交集即认回。覆盖两个方向：
 * - 模板改名并声明旧名别名（既有语义，矩阵③b）；
 * - 用户在可视化编辑器改了聊天表名（renameSheet 自动累积旧名别名），模板仍用原名。
 * 仍是显式声明驱动：任何一侧都没有记录过的名字不猜。
 *
 * excludedBaselineKeys：已被其他模板表按当前名精确匹配占用的 baseline 表不参与
 * 别名认回——模板同时含新旧两个名字时，旧名表应走 introduction 而不是歧义匹配。
 * （名↔名交集在这里不可能命中：精确名匹配已在调用方先行查找并落空。）
 */
function findExplicitTableAliasMatches_ACU(template: Sheet_ACU, baselineData: TableDataObject_ACU, excludedBaselineKeys: ReadonlySet<string>): SheetEntry_ACU[] {
  const identities = new Set([
    canonicalizeDisplayName_ACU(template.name),
    ...getExplicitTableAliases_ACU(template).map(canonicalizeDisplayName_ACU),
  ].filter(Boolean));
  if (identities.size === 0) return [];
  return listSheets_ACU(baselineData)
    .map(([key, sheet]) => ({ key, sheet }))
    .filter(entry => !excludedBaselineKeys.has(entry.key))
    .filter(entry => {
      const baselineIdentities = [entry.sheet.name, ...getExplicitTableAliases_ACU(entry.sheet)]
        .map(canonicalizeDisplayName_ACU);
      return baselineIdentities.some(identity => identities.has(identity));
    });
}

function accumulateTableAliases_ACU(sheet: Sheet_ACU, before: Sheet_ACU, template: Sheet_ACU): void {
  if (!sheet.sourceData || typeof sheet.sourceData !== 'object') sheet.sourceData = {} as Sheet_ACU['sourceData'];
  const currentName = canonicalizeDisplayName_ACU(sheet.name);
  const aliases = [
    ...getExplicitTableAliases_ACU(before),
    ...getExplicitTableAliases_ACU(template),
    before.name,
  ];
  const seen = new Set<string>();
  const normalized = aliases.filter(alias => {
    const canonical = canonicalizeDisplayName_ACU(alias);
    if (!canonical || canonical === currentName || seen.has(canonical)) return false;
    seen.add(canonical);
    return true;
  });
  if (normalized.length > 0) sheet.sourceData.tableAliases = normalized;
  else delete sheet.sourceData.tableAliases;
}

/**
 * SQLite 协调输入的缺失 DDL fallback（方案 A）。
 * 只处理缺失或全空白 DDL 的 Sheet；非空 DDL 保持原值，绝不覆盖。
 * 只在调用方传入的克隆对象上运行，不修改外部输入。
 */
function applyMissingDdlFallback_ACU(data: TableDataObject_ACU, sourceLabel: string): { blockers: string[] } {
  const blockers: string[] = [];
  for (const [key, sheet] of listSheets_ACU(data)) {
    if (!sheet || typeof sheet !== 'object') continue;
    const rawDdl = (sheet as any).sourceData?.ddl;
    const hasNonEmptyDdl = typeof rawDdl === 'string' && rawDdl.trim().length > 0;
    if (hasNonEmptyDdl) continue;
    if (!(sheet as any).sourceData || typeof (sheet as any).sourceData !== 'object') {
      (sheet as any).sourceData = {};
    }
    try {
      const tableName = (sheet as any).uid || key;
      (sheet as any).sourceData.ddl = generateDDL(sheet, tableName);
      const headers = Array.isArray((sheet as any).content?.[0])
        ? (sheet as any).content[0].map((value: unknown) => String(value ?? ''))
        : [];
      const validation = validateDDLTextAgainstHeaders_ACU((sheet as any).sourceData.ddl, headers);
      if (!validation.valid) {
        blockers.push(`${sourceLabel} 表「${(sheet as any).name || key}」（${key}）生成的 fallback DDL 校验失败：${validation.message}`);
      }
    } catch (error: any) {
      blockers.push(`${sourceLabel} 表「${(sheet as any).name || key}」（${key}）缺失 DDL fallback 失败：${error?.message || String(error)}`);
    }
  }
  return { blockers };
}

function headers_ACU(sheet: Sheet_ACU): string[] {
  const headers = sheet?.content?.[0];
  if (!Array.isArray(headers) || headers[0] !== 'row_id') throw new Error('缺少 row_id 首列表头。');
  return headers.map(value => String(value ?? ''));
}

/**
 * 新增表的引入形态按“模板是否自带数据”分流：
 * - 自带数据：作者已定义初始格式，原样保留数据行，引入时即落盘建表。
 * - 不带数据：保持 header-only 空壳，保留“首次填表前可自由修改表结构”的能力。
 * 两种形态都要求 uid 等于 key，且 seedRows 不随 sheet 落盘（数据已在 content 中）。
 */
function asIntroducedSheet_ACU(sheet: Sheet_ACU, sheetKey: string): Sheet_ACU {
  const clone = clone_ACU(sheet);
  clone.uid = sheetKey;
  const headers = headers_ACU(clone);
  const templateRows = Array.isArray(clone.content) ? clone.content.slice(1) : [];
  const seedRows = Array.isArray(clone.seedRows) ? clone.seedRows : [];
  // content 数据行优先；仅 seedRows 提供数据时也视为“自带数据”。
  const dataRows = templateRows.length > 0 ? templateRows : seedRows;
  clone.content = dataRows.length > 0
    ? [headers, ...assignMissingRowIds_ACU(dataRows.map(row => normalizeIntroducedRow_ACU(row, headers.length, sheetKey)))]
    : [headers];
  delete clone.seedRows;
  if (dataRows.length > 0) validateBaselineSheetRows_ACU(clone);
  return clone;
}

/**
 * 模板作者通常不手写 row_id，首列多为空。引入前按现有稳定分配器补齐缺失 row_id，
 * 已显式给出的 row_id 一律保留原值，绝不重写。
 */
function assignMissingRowIds_ACU(rows: string[][]): string[][] {
  const reserved = createStableRowIdReservation_ACU(rows);
  for (const row of rows) {
    const rowId = row[0] === null || row[0] === undefined ? '' : String(row[0]).trim();
    row[0] = rowId || allocateStableRowId_ACU(reserved);
  }
  return rows;
}

/**
 * 模板行末尾省略单元格是常见写法，按表头宽度补 null 即可。
 * 但行宽超过表头说明模板结构本身不一致，必须 fail-loud，不能静默截断丢数据。
 */
function normalizeIntroducedRow_ACU(row: unknown, headerWidth: number, sheetKey: string): string[] {
  const cells: string[] = (Array.isArray(row) ? row : [row]).map(cell => (cell === null || cell === undefined ? '' : String(cell)));
  if (cells.length > headerWidth) {
    throw new Error(`模板数据行宽度为 ${cells.length}，超过表头 ${headerWidth} 列（${sheetKey}）。`);
  }
  while (cells.length < headerWidth) cells.push('');
  return cells;
}


function validateBaselineSheetRows_ACU(sheet: Sheet_ACU): void {
  const headers = headers_ACU(sheet);
  const rowIds = new Set<string>();
  for (let index = 1; index < sheet.content.length; index += 1) {
    const row = sheet.content[index];
    if (!Array.isArray(row)) throw new Error(`第 ${index + 1} 行不是数组。`);
    if (row.length !== headers.length) throw new Error(`第 ${index + 1} 行宽度为 ${row.length}，应为 ${headers.length}。`);
    const rowId = String(row[0] ?? '').trim();
    if (!rowId) throw new Error(`第 ${index + 1} 行 row_id 为空。`);
    if (rowIds.has(rowId)) throw new Error(`row_id 重复：${rowId}。`);
    rowIds.add(rowId);
  }
}

/**
 * reveal 恢复数据与当前模板结构的列级再协调（S1-4）。
 *
 * reveal 的数据由 persist 层从历史恢复（"离开时最新状态"），协调层只产出模板结构壳；
 * 若休眠期间模板演进（加列/减列/改名），恢复数据的列集会落后于当前模板。本函数在
 * checkpoint 落盘前把恢复数据 rebase 到模板列集上：匹配列继承数据、模板新增列按契约
 * 填充（sqlite 按 DDL DEFAULT/NOT NULL，native 恒 null）、模板缺失列进入尾部隐藏列
 * （列级休眠，数据不删）。语义与 matched 表切模板的列级协调完全一致
 * （同一实现 reconcileMatchedSheet_ACU，双模式同一契约）。
 *
 * fail-loud：恢复数据行畸形（row_id 空/重复/行宽不一致）、DDL 无法回退或解析、
 * 协调结果投影不合法时直接抛错，由 persist 层事务回滚兜底，绝不落盘半协调数据。
 */
export function reconcileRevealedSheetWithTemplate_ACU(
  restoredSheet: Sheet_ACU,
  templateSheet: Sheet_ACU,
  sheetKey: string,
  contract: 'native' | 'sqlite',
): { sheet: Sheet_ACU; audit: ChatTemplateReconcileAudit_ACU; changed: boolean } {
  const restored = clone_ACU(restoredSheet);
  const template = clone_ACU(templateSheet);
  try {
    validateBaselineSheetRows_ACU(restored);
  } catch (error: any) {
    throw new Error(`reveal 恢复数据不合法（${sheetKey}）：${error?.message || String(error)}`);
  }
  if (contract === 'sqlite') {
    // 旧历史 hide checkpoint 可能没有持久化 DDL（运行时依赖 fallback）。
    // 与顶层协调器对 baseline/template 的处理一致：仅补缺失/全空白 DDL，绝不覆盖非空 DDL。
    for (const [label, sheet] of [['reveal 恢复数据', restored], ['reveal 目标模板结构', template]] as const) {
      const fallback = applyMissingDdlFallback_ACU({ [sheetKey]: sheet } as unknown as TableDataObject_ACU, label);
      if (fallback.blockers.length > 0) throw new Error(fallback.blockers.join('；'));
    }
  }
  const reconciled = reconcileMatchedSheet_ACU(restored, template, sheetKey, sheetKey, contract);
  // 协调结果必须能被投影层解析（隐藏集合法）；sqlite 下 DDL 与表头必须严格一致。
  getSheetColumnProjection_ACU(reconciled.sheet);
  if (contract === 'sqlite') {
    const validation = validateDDLTextAgainstHeaders_ACU(String(reconciled.sheet.sourceData?.ddl || ''), headers_ACU(reconciled.sheet));
    if (!validation.valid) {
      throw new Error(`reveal 再协调结果 DDL 校验失败（${sheetKey}）：${validation.message}`);
    }
  }
  return { sheet: reconciled.sheet, audit: reconciled.audit, changed: reconciled.changed };
}

/**
 * matched 表的统一列级协调（S0-3+S3-1：单函数双契约）。
 *
 * 列身份（canonical 显示名）、匹配链（canonical → 同 key physical 复用 → columnAliases）、
 * 列级休眠（未匹配旧列保留为尾部隐藏列，数据不删；零数据表同走休眠，S1-6，
 * 撞名旧列因零单元格而无损丢弃、audit 记 deletedColumns）、行迁移、别名累积与
 * audit 双模式共享；存储差异收敛为四个契约分支：
 * - 列条目构造：sqlite 从 DDL 取 physical 列名；native 的 physical 就是表头字符串，
 *   不解析、不校验 DDL（native 路径不得解析或 hydrate SQLite DDL）。
 * - 同 key physical 复用匹配：仅 sqlite（native 无独立于表头的物理身份可复用）。
 * - 新列填充：sqlite 按 DDL DEFAULT/NOT NULL 决定；native 恒 null。
 * - 物化收尾：sqlite 重建含保留列的 DDL 并沁用旧物理名；native 不生成 DDL
 *   （保留模板 sourceData.ddl 原值），hiddenPhysicalColumns 以表头名落地——
 *   投影层（getSheetColumnProjection_ACU）在无匹配 DDL 时按表头名解析隐藏列。
 *
 * 隐藏列尾部不变式：迁移后 content 头恒为 [...目标表头, ...隐藏表头]。
 * DSL 填表的可见列索引与物理列索引的一致性依赖此不变式（双模式同一契约）。
 */
function reconcileMatchedSheet_ACU(before: Sheet_ACU, template: Sheet_ACU, sheetKey: string, templateSheetKey: string, contract: 'native' | 'sqlite'): {
  sheet: Sheet_ACU;
  changed: boolean;
  audit: ChatTemplateReconcileAudit_ACU;
  meta?: Record<string, any>;
} {
  const sqlite = contract === 'sqlite';
  const beforeHeaders = headers_ACU(before);
  const targetHeaders = headers_ACU(template);
  const beforeColumns = sqlite ? parseDDLColumnInfos_ACU(String(before.sourceData?.ddl || '')) : [];
  const targetColumns = sqlite ? parseDDLColumnInfos_ACU(String(template.sourceData?.ddl || '')) : [];
  if (sqlite && (beforeColumns.length !== beforeHeaders.length || targetColumns.length !== targetHeaders.length)) throw new Error('DDL 与表头列数不一致。');
  const beforeEntries = beforeHeaders.slice(1).map((name, index) => ({
    canonical: canonicalizeDisplayName_ACU(name), index: index + 1, physical: sqlite ? beforeColumns[index + 1].sqlName : name, header: name,
  }));
  const targetEntries = targetHeaders.slice(1).map((name, index) => ({
    canonical: canonicalizeDisplayName_ACU(name), index: index + 1, physical: sqlite ? targetColumns[index + 1].sqlName : name, header: name, column: sqlite ? targetColumns[index + 1] : null,
  }));
  const beforeByCanonical = new Map(beforeEntries.map(column => [column.canonical, column]));
  const targetByCanonical = new Map(targetEntries.map(column => [column.canonical, column]));
  if (beforeByCanonical.size !== beforeHeaders.length - 1 || targetByCanonical.size !== targetHeaders.length - 1
    || (!sqlite && (beforeEntries.some(entry => !entry.canonical) || targetEntries.some(entry => !entry.canonical)))) {
    throw new Error(`表「${before.name || sheetKey}」(${sheetKey}) → 模板表「${template.name || templateSheetKey}」(${templateSheetKey}) 存在空列或规范化重复列。`);
  }
  const beforeByPhysical = new Map(beforeEntries.map(column => [column.physical.toLowerCase(), column]));
  const targetByPhysical = new Map(targetEntries.map(column => [column.physical.toLowerCase(), column]));
  if (beforeByPhysical.size !== beforeEntries.length || targetByPhysical.size !== targetEntries.length) throw new Error(`表「${before.name || sheetKey}」(${sheetKey}) → 模板表「${template.name || templateSheetKey}」(${templateSheetKey}) ${sqlite ? 'DDL 存在重复 physical column' : '存在大小写不敏感的重复表头'}。`);

  // === 零数据表语义（S1-6：统一走列级休眠，撞名列无损丢弃）===
  // 逐表判定：before.content.length > 1 才认为有数据行。零数据表不再走整表覆盖特例
  //（原计划 3.1/3.2 的覆盖语义已删除）：sheet key 在 introduction 时按表名派生，
  // 与模板作者键几乎恒不相等，key 无法区分「用户结构演化」与「预设替换」；而覆盖
  // 会把用户刚建好还没填数据的自定义列静默丢弃。统一休眠后，零数据表与有数据表
  // 语义一致：未匹配旧列进尾部隐藏列，模板再含该列时唤醒。覆盖特例原本要防的
  // 两个问题由下述机制承接：2.3 撞名阻断 → 零数据撞名列无损丢弃（见 hiddenEntries
  // 撞名分流）；幽灵隐藏项投影残留 → 零数据容错读取 + live 过滤（见 previousHidden）。
  const hasBaselineRows = before.content.length > 1;

  const matchedBeforeCanonical = new Set<string>();
  const matchedTargetCanonical = new Set<string>();
  const targetSourceByCanonical = new Map<string, typeof beforeEntries[number]>();
  const mappings: Array<{ fromPhysicalName: string; toPhysicalName: string }> = [];
  const inheritedColumns: string[] = [];
  for (const [canonicalName, target] of targetByCanonical) {
    const source = beforeByCanonical.get(canonicalName);
    if (!source) continue;
    matchedBeforeCanonical.add(source.canonical);
    matchedTargetCanonical.add(target.canonical);
    targetSourceByCanonical.set(target.canonical, source);
    inheritedColumns.push(target.header);
    if (source.physical !== target.physical) mappings.push({ fromPhysicalName: source.physical, toPhysicalName: target.physical });
  }

  // 同一稳定 Sheet key 下，physical column 才是持久化数据身份；表头只是可变显示名。
  // 不同 key 的导入模板仍禁止依赖 physical 同名推断，以免把无关字段重新解释为旧数据。
  // native 无独立于表头的物理身份（physical=表头），canonical 匹配已覆盖，跳过。
  if (sqlite && sheetKey === templateSheetKey) {
    for (const target of targetEntries) {
      if (matchedTargetCanonical.has(target.canonical)) continue;
      const source = beforeByPhysical.get(target.physical.toLowerCase());
      if (!source || matchedBeforeCanonical.has(source.canonical)) continue;
      matchedBeforeCanonical.add(source.canonical);
      matchedTargetCanonical.add(target.canonical);
      targetSourceByCanonical.set(target.canonical, source);
      inheritedColumns.push(target.header);
      if (source.physical !== target.physical) {
        mappings.push({ fromPhysicalName: source.physical, toPhysicalName: target.physical });
      }
    }
  }

  // 列改名后 canonical 不再相等，靠 columnAliases 的历史显示名声明认回同一列，
  // 使数据继续继承。这是显式声明驱动，不做启发式推断：
  // 一个别名必须唯一命中一个未匹配的旧列，否则宁可不继承，也不把无关字段混进来。
  const aliasCanonicalToPhysical = buildColumnAliasIndex_ACU(before, template);
  for (const target of targetEntries) {
    if (matchedTargetCanonical.has(target.canonical)) continue;
    const aliasCanonicals = aliasCanonicalToPhysical.get(target.physical.toLowerCase());
    if (!aliasCanonicals) continue;
    const candidates = [...new Set(aliasCanonicals)]
      .map(alias => beforeByCanonical.get(alias))
      .filter((entry): entry is typeof beforeEntries[number] => !!entry && !matchedBeforeCanonical.has(entry.canonical));
    const unique = [...new Map(candidates.map(entry => [entry.canonical, entry])).values()];
    if (unique.length !== 1) continue;
    const source = unique[0];
    matchedBeforeCanonical.add(source.canonical);
    matchedTargetCanonical.add(target.canonical);
    targetSourceByCanonical.set(target.canonical, source);
    inheritedColumns.push(target.header);
    if (source.physical !== target.physical) {
      mappings.push({ fromPhysicalName: source.physical, toPhysicalName: target.physical });
    }
  }

  // native 反向别名匹配：native 的 physical 随显示名变化（physical=表头），改名后
  // 别名链累积在旧列的当前表头键下，正向索引（按目标表头查）必然落空，需反查——
  // 旧列自身的 columnAliases 中包含目标显示名时认回同一列。仍是显式声明驱动：
  // 必须唯一命中一个未匹配旧列，否则不继承。sqlite 不需要此分支：物理列名跨改名
  // 稳定，正向键恒命中。
  if (!sqlite) {
    const beforeAliasMap = (before.sourceData as Record<string, any> | undefined)?.columnAliases;
    for (const target of targetEntries) {
      if (matchedTargetCanonical.has(target.canonical)) continue;
      if (!beforeAliasMap || typeof beforeAliasMap !== 'object' || Array.isArray(beforeAliasMap)) break;
      const candidates = beforeEntries.filter(entry => {
        if (matchedBeforeCanonical.has(entry.canonical)) return false;
        const aliases = beforeAliasMap[entry.physical];
        if (!Array.isArray(aliases)) return false;
        return aliases.some(alias => canonicalizeDisplayName_ACU(alias) === target.canonical);
      });
      if (candidates.length !== 1) continue;
      const source = candidates[0];
      matchedBeforeCanonical.add(source.canonical);
      matchedTargetCanonical.add(target.canonical);
      targetSourceByCanonical.set(target.canonical, source);
      inheritedColumns.push(target.header);
      if (source.physical !== target.physical) {
        mappings.push({ fromPhysicalName: source.physical, toPhysicalName: target.physical });
      }
    }
  }

  let hiddenEntries = beforeEntries.filter(column => !matchedBeforeCanonical.has(column.canonical));
  const addedColumns = targetEntries.filter(column => !matchedTargetCanonical.has(column.canonical)).map(column => column.header);
  const hiddenPhysicalNames = new Set(hiddenEntries.map(column => column.physical.toLowerCase()));
  const reusedPhysicalNames = targetEntries
    .filter(column => !matchedTargetCanonical.has(column.canonical) && hiddenPhysicalNames.has(column.physical.toLowerCase()))
    .map(column => column.physical);
  const droppedColumns: string[] = [];
  if (reusedPhysicalNames.length > 0) {
    if (hasBaselineRows) {
      // 真实原因（sqlite）：隐藏旧列与目标可见列产生重复列名 DDL，SQLite 建表必然失败。
      // native 下 physical=表头，canonical 相等即匹配，此冲突理论上不可达，仍 fail-loud 兜底。
      // 列出 key 对、冲突 physical 名、两侧显示名与 baseline 行数，便于定位。
      const conflictDetails = reusedPhysicalNames.map(physical => {
        const hidden = hiddenEntries.find(entry => entry.physical.toLowerCase() === physical.toLowerCase());
        const target = targetEntries.find(entry => entry.physical.toLowerCase() === physical.toLowerCase());
        return `physical=${physical}（休眠列「${hidden?.header}」→ 目标列「${target?.header}」）`;
      }).join('；');
      throw new Error(`表「${before.name || sheetKey}」(${sheetKey}) → 模板表「${template.name || templateSheetKey}」(${templateSheetKey})：休眠列与目标可见列存在同名 physical column${sqlite ? '，产出重复列名 DDL，SQLite 建表会失败' : ''}。冲突：${conflictDetails}。baseline 行数=${before.content.length - 1}。`);
    }
    // 零数据表的撞名分流（S1-6，承接计划 2.3）：旧表无任何单元格，丢弃撞名旧列
    // 不损失数据；保留则必然产出重复列名 DDL 而阻断切换。audit 以 deletedColumns
    // 如实记录，非撞名的未匹配旧列仍进休眠。
    const collidingPhysical = new Set(reusedPhysicalNames.map(name => name.toLowerCase()));
    droppedColumns.push(...hiddenEntries.filter(entry => collidingPhysical.has(entry.physical.toLowerCase())).map(entry => entry.header));
    hiddenEntries = hiddenEntries.filter(entry => !collidingPhysical.has(entry.physical.toLowerCase()));
  }
  const hiddenColumns = hiddenEntries.map(column => column.header);
  // 新列填充决策（替代 fills 静态契约）：
  // sqlite——可解析 literal DEFAULT → 该值；NOT NULL 无 DEFAULT → 空串；nullable → null。
  // native——无 DDL 契约，恒 null。
  const fillAudit: Array<{ physicalName: string; kind: string; literal: unknown }> = [];
  const fillByTargetCanonical = new Map<string, string | null>();
  for (const target of targetEntries) {
    if (matchedTargetCanonical.has(target.canonical)) continue;
    let value: string | null = null;
    let kind = 'null';
    if (sqlite) {
      const literal = parseDDLSafeDefaultLiteral_ACU(target.column!.defaultExpression);
      if (literal) { value = literalToCellValue_ACU(literal); kind = 'literal_default'; }
      else if (target.column!.isNotNull) { value = ''; kind = 'empty_not_null'; }
    }
    fillByTargetCanonical.set(target.canonical, value);
    fillAudit.push({ physicalName: target.physical, kind, literal: value });
  }
  const sheet = clone_ACU(template);
  sheet.uid = before.uid;
  const retainedHiddenHeaders = hiddenEntries.map(entry => entry.header);
  // 迁移后数据行（纯 JS 直通，替代契约驱动迁移）：匹配列原值直通，新列取填充值，隐藏列原值保留。
  const migratedRows: Array<Array<string | null>> = [];
  for (let rowIndex = 1; rowIndex < before.content.length; rowIndex += 1) {
    const beforeRow = before.content[rowIndex];
    const targetRow: Array<string | null> = [beforeRow[0] ?? null];
    for (const target of targetEntries) {
      const source = targetSourceByCanonical.get(target.canonical);
      if (source) targetRow.push(beforeRow[source.index] ?? null);
      else targetRow.push(fillByTargetCanonical.get(target.canonical) ?? null);
    }
    for (const hidden of hiddenEntries) targetRow.push(beforeRow[hidden.index] ?? null);
    migratedRows.push(targetRow);
  }
  const nextHeaders = [...targetHeaders, ...retainedHiddenHeaders];
  // 数据归属规则：
  // - 旧表已有数据 → 以旧表为主，忽略模板自带数据（避免覆盖用户/AI 写过的内容）。
  // - 旧表无数据且模板自带数据 → 采用模板数据（作者定义的初始格式必须落地），
  //   与「是否首楼、是否首次初始化」无关。
  // - 两边都无数据 → 表头空表。
  const templateRows = Array.isArray(template.content) ? template.content.slice(1) : [];
  const useTemplateRows = migratedRows.length === 0 && templateRows.length > 0;
  const adoptedRows: Array<Array<string | null>> = useTemplateRows
    ? adoptTemplateRowsForMatchedSheet_ACU(templateRows, targetEntries.length, retainedHiddenHeaders.length)
    : migratedRows;
  sheet.content = [nextHeaders, ...adoptedRows];
  sheet.sourceData = clone_ACU(template.sourceData || ({} as Sheet_ACU['sourceData']));
  // 物化收尾契约分支：sqlite 重建 DDL 并沁用旧物理名；native 不生成/不解析 DDL，
  // 保留模板 sourceData.ddl 原值（结构变更后旧 DDL 与新表头列数必然不一致，
  // 投影层会退回按表头名解析隐藏列——这正是 native 隐藏集的身份契约）。
  let activePhysicalNames: string[];
  let retainedHiddenPhysicalNames: string[];
  if (sqlite) {
    const retainedHiddenColumns = hiddenEntries.map(entry => beforeColumns[entry.index]);
    // 列身份由 canonical 显示名决定，物理列名一旦确立就不再随模板 DDL 文本变动。
    // 若采用模板的物理名，同一显示名会在切模板时被改名（如 last_round_time → prev_scene_time），
    // 而历史 log 里的 SQL 仍按旧物理名书写，回放时必然撞 "has no column named ..."。
    const effectiveTargetColumns = targetColumns.map((column, index) => {
      if (index === 0) return column;
      const target = targetEntries[index - 1];
      const source = target ? targetSourceByCanonical.get(target.canonical) : undefined;
      if (!source || source.physical === column.sqlName) return column;
      return renamePhysicalColumn_ACU(column, source.physical);
    });
    sheet.sourceData.ddl = buildRetainedColumnDDL_ACU(before, template, effectiveTargetColumns, targetHeaders, retainedHiddenColumns, retainedHiddenHeaders);
    activePhysicalNames = effectiveTargetColumns.map(column => column.sqlName);
    retainedHiddenPhysicalNames = retainedHiddenColumns.map(column => column.sqlName);
  } else {
    activePhysicalNames = [...targetHeaders];
    retainedHiddenPhysicalNames = retainedHiddenHeaders;
  }
  const activePhysical = new Set(activePhysicalNames.map(name => name.toLowerCase()));
  // 有数据表：投影 fail-loud 校验 baseline 隐藏集一致性（幽灵项属数据损坏，必须暴露）。
  // 零数据表：容错读取（S1-6）——幽灵隐藏项不指向任何单元格，丢弃无损；
  // 下方 candidatePhysical live 过滤会把不在候选结构中的项清掉，不残留幽灵投影。
  const previousHidden = hasBaselineRows
    ? getSheetColumnProjection_ACU(before).hiddenPhysicalColumns
    : (Array.isArray(before.sourceData?.hiddenPhysicalColumns) ? before.sourceData.hiddenPhysicalColumns : [])
      .map(value => String(value ?? '').trim())
      .filter(Boolean);
  const candidatePhysical = new Map([...activePhysicalNames, ...retainedHiddenPhysicalNames].map(name => [name.toLowerCase(), name]));
  const hiddenPhysicalColumns = [...previousHidden, ...retainedHiddenPhysicalNames]
    .filter(name => !activePhysical.has(name.toLowerCase()) && candidatePhysical.has(name.toLowerCase()))
    .filter((name, index, values) => values.findIndex(value => value.toLowerCase() === name.toLowerCase()) === index)
    .map(name => candidatePhysical.get(name.toLowerCase())!);
  if (previousHidden.length > 0 || hiddenPhysicalColumns.length > 0) sheet.sourceData.hiddenPhysicalColumns = hiddenPhysicalColumns;
  else delete sheet.sourceData.hiddenPhysicalColumns;
  // 记下本次发生的显示名变更，使后续切换仍能顺着别名链认回同一列。
  // 键取该列改名后的存活 physical：sqlite 物理列名跨改名稳定（沁用旧名），
  // native 的 physical 就是新表头（旧表头键已死，挂在其下的别名会被 live 过滤丢弃）。
  const renamedColumns = targetEntries
    .map(target => {
      const source = targetSourceByCanonical.get(target.canonical);
      if (!source || source.canonical === target.canonical) return null;
      const physicalName = sqlite ? source.physical : target.physical;
      return { physicalName, previousHeader: source.header, nextHeader: target.header };
    })
    .filter((entry): entry is { physicalName: string; previousHeader: string; nextHeader: string } => !!entry);
  accumulateColumnAliases_ACU(
    sheet,
    before,
    template,
    renamedColumns,
    new Set(candidatePhysical.keys()),
  );
  accumulateTableAliases_ACU(sheet, before, template);
  delete sheet.seedRows;
  const meta = buildPersistentMetadataUpdate_ACU(before, sheet);
  const beforeProjection = clone_ACU(before); delete beforeProjection.seedRows;
  const changed = JSON.stringify(beforeProjection) !== JSON.stringify(sheet);
  return { sheet, changed, meta, audit: { sheetKey, resolvedSheetKey: sheetKey, match: 'matched', baselineSheetKey: sheetKey, templateSheetKey, baselineName: before.name,
    templateName: template.name, canonicalName: canonicalizeDisplayName_ACU(before.name), inheritedColumns, addedColumns, deletedColumns: droppedColumns, hiddenColumns,
    physicalColumnMappings: mappings, fills: fillAudit,
    affectedRowCount: before.content.length - 1, metadataChanged: !!meta, metadataChangedFields: meta ? Object.keys(meta) : [], destructiveChangeConfirmed: false, operations: [] } };
}

/**
 * 把列定义的物理列名换成已存在的名字，保留类型、约束与 DEFAULT 不变。
 * 只替换 normalizedDefinition 开头的标识符（解析保证它以列名起头），
 * 不做全文替换，避免误伤 DEFAULT 字面量或约束中的同名片段。
 */
function renamePhysicalColumn_ACU(
  column: ReturnType<typeof parseDDLColumnInfos_ACU>[number],
  nextSqlName: string,
): ReturnType<typeof parseDDLColumnInfos_ACU>[number] {
  const definition = column.normalizedDefinition;
  const remainder = definition.slice(column.sqlName.length);
  if (!definition.startsWith(column.sqlName)) {
    throw new Error(`无法重绑定物理列名：列定义未以列名起头（${column.sqlName}）。`);
  }
  return { ...column, sqlName: nextSqlName, normalizedDefinition: `${nextSqlName}${remainder}` };
}

/**
 * 把模板自带数据行整形成当前目标结构：按目标列数对齐，为保留的隐藏列补 null，
 * 并为缺失的 row_id 分配稳定值（模板作者通常不写 row_id，首列常为 null）。
 * 行宽超过目标可见列时 fail-loud，不静默截断丢数据。
 */
function adoptTemplateRowsForMatchedSheet_ACU(
  templateRows: unknown[],
  visibleColumnCount: number,
  hiddenColumnCount: number,
): Array<Array<string | null>> {
  const rows = templateRows.map(row => {
    const cells: Array<string | null> = (Array.isArray(row) ? row : [row])
      .map(cell => (cell === null || cell === undefined ? null : String(cell)));
    // cells[0] 是 row_id，其后是可见列。
    const expected = visibleColumnCount + 1;
    if (cells.length > expected) {
      throw new Error(`模板数据行宽度为 ${cells.length}，超过目标可见列 ${expected} 列。`);
    }
    while (cells.length < expected) cells.push(null);
    // 隐藏列在新数据下无值。
    for (let index = 0; index < hiddenColumnCount; index += 1) cells.push(null);
    return cells;
  });
  const reserved = createStableRowIdReservation_ACU(rows);
  for (const row of rows) {
    const rowId = row[0] === null ? '' : String(row[0]).trim();
    row[0] = rowId || allocateStableRowId_ACU(reserved);
  }
  return rows;
}


/**
 * 汇总旧表与模板声明的 columnAliases，得到 physical column name(lowercase) → canonical 历史显示名列表。
 * 两侧都参与：模板作者可声明“新列对应哪个旧名”，旧表则携带历史累积的别名。
 */
function buildColumnAliasIndex_ACU(before: Sheet_ACU, template: Sheet_ACU): Map<string, string[]> {
  const index = new Map<string, string[]>();
  const absorb = (sheet: Sheet_ACU): void => {
    const raw = (sheet.sourceData as Record<string, any> | undefined)?.columnAliases;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    for (const [physicalName, aliases] of Object.entries(raw)) {
      const key = String(physicalName || '').trim().toLowerCase();
      if (!key || !Array.isArray(aliases)) continue;
      const canonicals = (aliases as unknown[])
        .map(alias => canonicalizeDisplayName_ACU(alias))
        .filter(Boolean);
      if (canonicals.length === 0) continue;
      index.set(key, [...(index.get(key) || []), ...canonicals]);
    }
  };
  absorb(before);
  absorb(template);
  return index;
}

/**
 * 累积列别名：已确认同一身份但显示名变了的列，把旧显示名记入该物理列的别名。
 * 仅保留当前 DDL 中仍存在的物理列，避免别名无限膨胀。
 */
function accumulateColumnAliases_ACU(
  sheet: Sheet_ACU,
  before: Sheet_ACU,
  template: Sheet_ACU,
  renamed: Array<{ physicalName: string; previousHeader: string; nextHeader: string }>,
  livePhysicalNames: Set<string>,
): void {
  const merged = new Map<string, string[]>();
  const absorb = (source: Sheet_ACU): void => {
    const raw = (source.sourceData as Record<string, any> | undefined)?.columnAliases;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    for (const [physicalName, aliases] of Object.entries(raw)) {
      const key = String(physicalName || '').trim();
      if (!key || !Array.isArray(aliases)) continue;
      merged.set(key, [
        ...(merged.get(key) || []),
        ...(aliases as unknown[]).map(alias => String(alias || '')).filter(Boolean),
      ]);
    }
  };
  absorb(before);
  absorb(template);
  for (const entry of renamed) {
    merged.set(entry.physicalName, [
      ...(merged.get(entry.physicalName) || []),
      entry.previousHeader,
      entry.nextHeader,
    ]);
  }

  const normalized: Record<string, string[]> = {};
  for (const [physicalName, aliases] of merged) {
    if (!livePhysicalNames.has(physicalName.toLowerCase())) continue;
    // 保留该物理列用过的全部历史显示名（含变更前后两侧），别名链才不会在
    // 「A→B 之后再 B→A」这类往复改名中断开。当前显示名一并留下是有意的：
    // 它是下一次协调时 before 侧的名字，必须能被查到。
    const unique = [...new Set(aliases.map(alias => alias.trim()).filter(Boolean))];
    if (unique.length > 0) normalized[physicalName] = unique;
  }

  if (Object.keys(normalized).length > 0) (sheet.sourceData as Record<string, any>).columnAliases = normalized;
  else delete (sheet.sourceData as Record<string, any>).columnAliases;
}





function buildRetainedColumnDDL_ACU(before: Sheet_ACU, template: Sheet_ACU, targetColumns: ReturnType<typeof parseDDLColumnInfos_ACU>, targetHeaders: string[], retainedColumns: ReturnType<typeof parseDDLColumnInfos_ACU>, retainedHeaders: string[]): string {
  const templateDDL = String(template.sourceData?.ddl || '');
  const tableName = parseDDLTableName(templateDDL);
  if (!tableName) throw new Error('模板 DDL 缺少可解析的物理表名。');
  const allColumns = [...targetColumns, ...retainedColumns];
  const definitions = allColumns.map((column, index) => {
    const header = index < targetColumns.length ? targetHeaders[index] : retainedHeaders[index - targetColumns.length];
    const comment = header && header !== column.sqlName ? ` -- ${header}` : '';
    return { definition: column.normalizedDefinition, comment };
  });
  const constraints = Array.from(new Set([
    ...parseDDLTableConstraints_ACU(String(before.sourceData?.ddl || '')),
    ...parseDDLTableConstraints_ACU(templateDDL),
  ]));
  const suffix = parseDDLTableSuffix_ACU(templateDDL);
  const entries = [...definitions, ...constraints.map(definition => ({ definition, comment: '' }))];
  return `CREATE TABLE ${tableName} (\n${entries.map((entry, index) => `  ${entry.definition}${index < entries.length - 1 ? ',' : ''}${entry.comment}`).join('\n')}\n)${suffix ? ` ${suffix}` : ''};`;
}

function buildPersistentMetadataUpdate_ACU(before: Sheet_ACU, template: Sheet_ACU): Record<string, any> | undefined {
  const beforeSourceData: Record<string, any> = clone_ACU(before.sourceData || {});
  const targetSourceData: Record<string, any> = clone_ACU(template.sourceData || {});
  delete beforeSourceData.ddl;
  delete targetSourceData.ddl;
  const removedSourceDataKeys = Object.keys(beforeSourceData).filter(key => !Object.prototype.hasOwnProperty.call(targetSourceData, key));
  const sourceDataDelta = Object.fromEntries(Object.entries(targetSourceData).filter(([key, value]) => !sameValue_ACU(beforeSourceData[key], value)));
  const meta: Record<string, any> = {};
  if (before.name !== template.name) meta.name = template.name;
  if (before.orderNo !== template.orderNo) meta.orderNo = template.orderNo;
  if (Object.keys(sourceDataDelta).length > 0 || removedSourceDataKeys.length > 0) meta.sourceData = clone_ACU(targetSourceData);
  if (!sameValue_ACU(before.updateConfig, template.updateConfig)) meta.updateConfig = clone_ACU(template.updateConfig);
  if (!sameValue_ACU(before.exportConfig, template.exportConfig)) meta.exportConfig = clone_ACU(template.exportConfig);
  return Object.keys(meta).length > 0 ? meta : undefined;
}

function sameValue_ACU(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function literalToCellValue_ACU(literal: NonNullable<ReturnType<typeof parseDDLSafeDefaultLiteral_ACU>>): string | null {
  if (literal.kind === 'null') return null;
  if (literal.kind === 'boolean') return literal.value ? '1' : '0';
  return String(literal.value);
}
