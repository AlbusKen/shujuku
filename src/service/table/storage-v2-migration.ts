import { getChatArray_ACU, saveChatToHostStrict_ACU } from '../../data/gateways/chat-gateway';
import type { IsolationConfig_ACU } from '../../data/models/chat-message-data';
import { cloneIsolatedData_ACU, isLegacyMatchForIsolation_ACU, readIsolatedTagData_ACU, readLegacyIndependentData_ACU, readLegacyStandardData_ACU, readLegacySummaryData_ACU, readModifiedKeys_ACU, readUpdateGroupKeys_ACU, writeMessageIdentity_ACU } from '../../data/repositories/chat-message-data-repo';
import { currentChatFileIdentifier_ACU, getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import type { TableDataObject_ACU } from '../../shared/models/table-data';
import { validateMigrationProvenanceV1_ACU } from '../../shared/canonical-checkpoint-validator';
import { resolveHistoricalSheetKeyMigrations_ACU } from '../../shared/sql-read-resolver';
import { canonicalizeDisplayName_ACU } from '../../shared/sheet-identity';
import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { hasV2TableHistoryEvidence_ACU, isV2TagData_ACU, resolveTableStorageStrategy_ACU } from './storage-strategy-resolver';
import type { MixedStorageDecisionBackupV1_ACU, TableCheckpointScheduleSummaryV2_ACU, TableMigrationAuditBackupV1_ACU, TableMigrationProvenanceV1_ACU, TableStorageFrameV2_ACU } from './storage-frame-v2-types';
import { commitMixedStorageDecision_ACU } from './mixed-storage-commit';
import { evaluateMixedStorageDecision_ACU, type MixedStorageDecision_ACU } from './mixed-storage-decision';
import { collectV2SheetKeyEvidenceStatically_ACU, type V2StaticSheetEvidence_ACU } from './mixed-storage-evidence';
import { buildCanonicalFullCheckpoint_ACU } from './canonical-checkpoint-builder';
import { auditTableDataForUpgrade_ACU, getTableDataFingerprint_ACU, type UpgradeAuditResult_ACU } from './table-data-upgrade-audit';
import { repairTableDataFromAudit_ACU, type RepairResult_ACU } from './table-data-repair';
import { loadTableStateFromFramesV2Detailed_ACU } from './storage-frame-v2-replay';

export interface LegacyToV2MigrationOptions_ACU {
  data: Record<string, any> | null;
  isolationKey: string;
  isolationConfig: IsolationConfig_ACU;
  skipUpdateFloors?: number;
  /**
   * 合并读取点登记的源带行表清单（sheetKey → 规范化显示名，来自
   * consumeLastMergeSourceInventory_ACU）。提供时保险闸直接消费该清单，
   * 与合并读取严格同源；缺省时回退为独立扫描（保持 API 兼容）。
   */
  sourceInventory?: Map<string, string> | null;
}

export interface LegacyToV2MigrationResult_ACU {
  migrated: boolean;
  messageIndex?: number;
  data?: TableDataObject_ACU;
  error?: string;
  mixedDecision?: MixedStorageDecision_ACU;
}

type LegacyScheduleSummary_ACU = Record<string, TableCheckpointScheduleSummaryV2_ACU>;

function deepClone_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function sheetKeysOfData_ACU(data: Record<string, any> | null | undefined): string[] {
  if (!data || typeof data !== 'object') return [];
  return Object.keys(data).filter(key => key.startsWith('sheet_') && Boolean((data as any)[key]));
}

function countRealDataRows_ACU(data: Record<string, any> | null | undefined): number {
  let rows = 0;
  for (const sheetKey of sheetKeysOfData_ACU(data)) {
    const content = (data as any)?.[sheetKey]?.content;
    if (Array.isArray(content) && content.length > 1) rows += content.length - 1;
  }
  return rows;
}

/**
 * 迁移破坏保险闸的旧源扫描：收集聊天中将被 cleanupLegacyFieldsAfterV2Write_ACU
 * 删除的旧存储源（隔离槽 V1 数据 + 顶层旧字段）里所有带真实数据行的表
 * （sheetKey → 规范化显示名）。扫描范围与 cleanup 的删除范围使用同一隔离匹配语义，
 * 保护的正是将被删除的内容。
 */
function collectLegacyRowBearingSheets_ACU(chat: any[], isolationKey: string, isolationConfig: IsolationConfig_ACU): Map<string, string> {
  const rowBearing = new Map<string, string>();
  const collect = (data: Record<string, any> | null | undefined): void => {
    for (const sheetKey of sheetKeysOfData_ACU(data)) {
      const sheet = (data as any)[sheetKey];
      const content = sheet?.content;
      if (!Array.isArray(content) || content.length <= 1) continue;
      if (!rowBearing.has(sheetKey)) rowBearing.set(sheetKey, canonicalizeDisplayName_ACU(sheet?.name));
    }
  };
  for (const message of chat) {
    if (!message || message.is_user) continue;
    const tagData = readIsolatedTagData_ACU(message, isolationKey);
    if (tagData && !isV2TagData_ACU(tagData)) {
      collect(tagData.independentData);
      // 增量 delta 的存在同样是"该表有真实数据活动"的证据（旧闸门语义保留）：
      // delta 无表名可取，登记 key、名字留空，比对退化为按 key 匹配。
      const incrementalData = (tagData as any).incrementalData;
      if (incrementalData && typeof incrementalData === 'object') {
        for (const sheetKey of Object.keys(incrementalData)) {
          if (!sheetKey.startsWith('sheet_') || !incrementalData[sheetKey]) continue;
          if (!rowBearing.has(sheetKey)) rowBearing.set(sheetKey, '');
        }
      }
    }
    if (isLegacyMatchForIsolation_ACU(message, isolationConfig)) {
      collect(readLegacyIndependentData_ACU(message));
      collect(readLegacyStandardData_ACU(message) as any);
      collect(readLegacySummaryData_ACU(message) as any);
    }
  }
  return rowBearing;
}

/**
 * 迁移破坏保险闸的逐表比对：旧源中每一张带真实行的表，都必须能在合并结果中按
 * sheetKey 或规范化显示名找到对应（合并可能把历史 key 重映射进 guide key，故双通道）。
 * 返回缺失表的可读描述列表；非空即说明合并读取丢了整表，迁移必须拒绝。
 */
function findLegacyRowBearingSheetsMissingFromMerged_ACU(
  mergedData: Record<string, any> | null,
  legacyRowBearingSheets: Map<string, string>,
): string[] {
  const mergedKeys = new Set(sheetKeysOfData_ACU(mergedData));
  const mergedNames = new Set<string>();
  for (const sheetKey of mergedKeys) {
    const name = canonicalizeDisplayName_ACU((mergedData as any)?.[sheetKey]?.name);
    if (name) mergedNames.add(name);
  }
  const missing: string[] = [];
  for (const [sheetKey, canonicalName] of legacyRowBearingSheets) {
    if (mergedKeys.has(sheetKey)) continue;
    if (canonicalName && mergedNames.has(canonicalName)) continue;
    missing.push(`${canonicalName || '(无名)'}(${sheetKey})`);
  }
  return missing;
}

function countAiFloor_ACU(chat: any[], messageIndex: number): number {
  let count = 0;
  for (let i = 0; i <= messageIndex && i < chat.length; i += 1) {
    if (chat[i] && !chat[i].is_user) count += 1;
  }
  return count;
}

function normalizeSkipUpdateFloors_ACU(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.trunc(num) : 0;
}

function resolveMigrationSkipUpdateFloors_ACU(data: Record<string, any> | null | undefined, inheritedSkip: unknown): number {
  let maxSkip = normalizeSkipUpdateFloors_ACU(inheritedSkip);
  for (const sheetKey of sheetKeysOfData_ACU(data)) {
    const rawSkip = (data as any)?.[sheetKey]?.updateConfig?.skipFloors;
    if (Number.isFinite(rawSkip) && rawSkip >= 0) {
      maxSkip = Math.max(maxSkip, normalizeSkipUpdateFloors_ACU(rawSkip));
    }
  }
  return maxSkip;
}

function findMigrationTargetAiMessage_ACU(chat: any[], skipUpdateFloors: number): { message: any; index: number } | null {
  const aiMessages: { message: any; index: number }[] = [];
  for (let i = 0; i < chat.length; i += 1) {
    if (chat[i] && !chat[i].is_user) aiMessages.push({ message: chat[i], index: i });
  }
  if (aiMessages.length === 0) return null;

  const normalizedSkip = normalizeSkipUpdateFloors_ACU(skipUpdateFloors);
  const targetAiIndex = Math.max(0, aiMessages.length - 1 - normalizedSkip);
  return aiMessages[targetAiIndex];
}

function noteFilled_ACU(summary: LegacyScheduleSummary_ACU, sheetKey: string, aiFloor: number): void {
  if (!summary[sheetKey]) summary[sheetKey] = {};
  summary[sheetKey].lastFilledAiFloor = Math.max(summary[sheetKey].lastFilledAiFloor || 0, aiFloor);
}

function noteChanged_ACU(summary: LegacyScheduleSummary_ACU, sheetKey: string, aiFloor: number): void {
  if (!summary[sheetKey]) summary[sheetKey] = {};
  summary[sheetKey].lastChangedAiFloor = Math.max(summary[sheetKey].lastChangedAiFloor || 0, aiFloor);
}

function noteFilledAndChanged_ACU(summary: LegacyScheduleSummary_ACU, sheetKey: string, aiFloor: number): void {
  noteFilled_ACU(summary, sheetKey, aiFloor);
  noteChanged_ACU(summary, sheetKey, aiFloor);
}

function normalizeSheetKeys_ACU(value: unknown, allowedSheetKeys: Set<string>): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && allowedSheetKeys.has(item)))];
}

function collectContainerSheetKeys_ACU(container: unknown, allowedSheetKeys: Set<string>): string[] {
  if (!container || typeof container !== 'object' || Array.isArray(container)) return [];
  return Object.keys(container as Record<string, unknown>).filter(key => allowedSheetKeys.has(key));
}

function applyLegacyTracking_ACU(
  summary: LegacyScheduleSummary_ACU,
  aiFloor: number,
  allowedSheetKeys: Set<string>,
  options: {
    dataKeys?: string[];
    deltaKeys?: string[];
    modifiedKeys?: string[];
    updateGroupKeys?: string[];
  },
): void {
  const dataKeys = normalizeSheetKeys_ACU(options.dataKeys || [], allowedSheetKeys);
  const deltaKeys = normalizeSheetKeys_ACU(options.deltaKeys || [], allowedSheetKeys);
  const modifiedKeys = normalizeSheetKeys_ACU(options.modifiedKeys || [], allowedSheetKeys);
  const updateGroupKeys = normalizeSheetKeys_ACU(options.updateGroupKeys || [], allowedSheetKeys);

  updateGroupKeys.forEach(sheetKey => noteFilled_ACU(summary, sheetKey, aiFloor));
  modifiedKeys.forEach(sheetKey => noteFilledAndChanged_ACU(summary, sheetKey, aiFloor));
  deltaKeys.forEach(sheetKey => noteFilledAndChanged_ACU(summary, sheetKey, aiFloor));

  if (updateGroupKeys.length === 0 && modifiedKeys.length === 0 && deltaKeys.length === 0) {
    dataKeys.forEach(sheetKey => noteFilledAndChanged_ACU(summary, sheetKey, aiFloor));
  }
}

interface LegacyMigrationSourceEvidence_ACU {
  scheduleSummary: LegacyScheduleSummary_ACU;
  sourceMessageIndices: number[];
  sourceAiFloors: number[];
}

export function collectLegacyScheduleSummaryForMigration_ACU(
  chat: any[] | null | undefined,
  isolationKey: string,
  isolationConfig: IsolationConfig_ACU,
  data: Record<string, any> | null,
  options: { maxMessageIndex?: number } = {},
): LegacyScheduleSummary_ACU {
  return collectLegacyMigrationSourceEvidence_ACU(chat, isolationKey, isolationConfig, data, options).scheduleSummary;
}

function collectLegacyMigrationSourceEvidence_ACU(
  chat: any[] | null | undefined,
  isolationKey: string,
  isolationConfig: IsolationConfig_ACU,
  data: Record<string, any> | null,
  options: { maxMessageIndex?: number } = {},
): LegacyMigrationSourceEvidence_ACU {
  if (!Array.isArray(chat) || chat.length === 0) return { scheduleSummary: {}, sourceMessageIndices: [], sourceAiFloors: [] };
  const allowedSheetKeys = new Set(sheetKeysOfData_ACU(data));
  if (allowedSheetKeys.size === 0) return { scheduleSummary: {}, sourceMessageIndices: [], sourceAiFloors: [] };

  const maxMessageIndex = Number.isInteger(options.maxMessageIndex)
    ? Math.max(0, Math.min(chat.length - 1, options.maxMessageIndex as number))
    : chat.length - 1;
  const summary: LegacyScheduleSummary_ACU = {};
  const sourceMessageIndices: number[] = [];
  const sourceAiFloors: number[] = [];
  for (let i = 0; i <= maxMessageIndex; i += 1) {
    const message = chat[i];
    if (!message || message.is_user) continue;
    const aiFloor = countAiFloor_ACU(chat, i);
    let hasLegacySource = false;

    const tagData = readIsolatedTagData_ACU(message, isolationKey) as any;
    if (tagData && !isV2TagData_ACU(tagData)) {
      const dataKeys = collectContainerSheetKeys_ACU(tagData.independentData, allowedSheetKeys);
      const deltaKeys = collectContainerSheetKeys_ACU(tagData.incrementalData, allowedSheetKeys);
      const modifiedKeys = normalizeSheetKeys_ACU(tagData.modifiedKeys, allowedSheetKeys);
      const updateGroupKeys = normalizeSheetKeys_ACU(tagData.updateGroupKeys, allowedSheetKeys);
      hasLegacySource = hasLegacySource || dataKeys.length > 0 || deltaKeys.length > 0 || modifiedKeys.length > 0 || updateGroupKeys.length > 0;
      applyLegacyTracking_ACU(summary, aiFloor, allowedSheetKeys, {
        dataKeys,
        deltaKeys,
        modifiedKeys,
        updateGroupKeys,
      });
    }

    if (isLegacyMatchForIsolation_ACU(message, isolationConfig)) {
      const dataKeys = [
        ...collectContainerSheetKeys_ACU(readLegacyIndependentData_ACU(message), allowedSheetKeys),
        ...collectContainerSheetKeys_ACU(readLegacyStandardData_ACU(message), allowedSheetKeys),
        ...collectContainerSheetKeys_ACU(readLegacySummaryData_ACU(message), allowedSheetKeys),
      ];
      const modifiedKeys = normalizeSheetKeys_ACU(readModifiedKeys_ACU(message), allowedSheetKeys);
      const updateGroupKeys = normalizeSheetKeys_ACU(readUpdateGroupKeys_ACU(message), allowedSheetKeys);
      hasLegacySource = hasLegacySource || dataKeys.length > 0 || modifiedKeys.length > 0 || updateGroupKeys.length > 0;
      applyLegacyTracking_ACU(summary, aiFloor, allowedSheetKeys, {
        dataKeys,
        modifiedKeys,
        updateGroupKeys,
      });
    }
    if (hasLegacySource) {
      sourceMessageIndices.push(i);
      sourceAiFloors.push(aiFloor);
    }
  }

  return { scheduleSummary: summary, sourceMessageIndices, sourceAiFloors };
}

function removeLegacyIsolatedSlot_ACU(message: any, isolationKey: string): void {
  const isolatedData = cloneIsolatedData_ACU(message) as Record<string, any>;
  if (!isolatedData || typeof isolatedData !== 'object' || !Object.prototype.hasOwnProperty.call(isolatedData, isolationKey)) return;

  if (isV2TagData_ACU(isolatedData[isolationKey])) {
    message.TavernDB_ACU_IsolatedData = isolatedData;
    return;
  }

  delete isolatedData[isolationKey];
  if (Object.keys(isolatedData).length === 0) {
    delete message.TavernDB_ACU_IsolatedData;
  } else {
    message.TavernDB_ACU_IsolatedData = isolatedData;
  }
}

function removeLegacyTopLevelFields_ACU(message: any, isolationConfig: IsolationConfig_ACU): void {
  if (!isLegacyMatchForIsolation_ACU(message, isolationConfig)) return;
  delete message.TavernDB_ACU_IndependentData;
  delete message.TavernDB_ACU_Data;
  delete message.TavernDB_ACU_SummaryData;
  delete message.TavernDB_ACU_ModifiedKeys;
  delete message.TavernDB_ACU_UpdateGroupKeys;
  delete message.TavernDB_ACU_Identity;
}

function cleanupLegacyFieldsAfterV2Write_ACU(chat: any[], isolationKey: string, isolationConfig: IsolationConfig_ACU): void {
  for (const message of chat) {
    if (!message) continue;
    removeLegacyIsolatedSlot_ACU(message, isolationKey);
    removeLegacyTopLevelFields_ACU(message, isolationConfig);
  }
}

function hasV2SuccessorActivityForMigration_ACU(decision: MixedStorageDecision_ACU): boolean {
  const anchorIndex = decision.evidence.v2.anchor.messageIndex;
  return anchorIndex !== null && decision.evidence.v2.frames.some(frame => frame.messageIndex >= anchorIndex
    && (frame.logEntryCount > 0 || frame.perSheetCheckpointKeys.length > 0));
}

function v2ReplayContainsSheetsMissingFromLegacyCandidate_ACU(
  decision: MixedStorageDecision_ACU,
  legacyCandidateData: TableDataObject_ACU,
): boolean {
  const replayedV2Data = decision.evidence.v2.replay.data;
  if (!replayedV2Data) return false;
  const legacySheetKeys = new Set(sheetKeysOfData_ACU(legacyCandidateData));
  return sheetKeysOfData_ACU(replayedV2Data).some(sheetKey => !legacySheetKeys.has(sheetKey));
}

function canSupersedeUpgradeResidualV2_ACU(decision: MixedStorageDecision_ACU, latestLegacySourceIndex: number | undefined, legacyCandidateData: TableDataObject_ACU): boolean {
  const anchorIndex = decision.evidence.v2.anchor.messageIndex;
  if (anchorIndex === null || decision.evidence.v2.provenance.validation?.valid === true) return false;
  if (hasV2SuccessorActivityForMigration_ACU(decision)) return false;
  if (v2ReplayContainsSheetsMissingFromLegacyCandidate_ACU(decision, legacyCandidateData)) return false;
  return latestLegacySourceIndex !== undefined && latestLegacySourceIndex >= anchorIndex;
}

/**
 * V2 侧完全不可读时，判断能否以 legacy 为权威源重建单一 V2。
 *
 * 与 canSupersedeUpgradeResidualV2_ACU 的分工：
 * - 后者处理「V2 可读但只是升级残留」（有 anchor、replay 成功）；
 * - 本函数处理「V2 不可读」（无 anchor 或 replay 失败/不可用）。
 * 两者互斥，不得同时放行。
 */
function canRebuildFromLegacyWhenV2Unreadable_ACU(
  decision: MixedStorageDecision_ACU,
  staticEvidence: V2StaticSheetEvidence_ACU,
  legacyCandidateData: TableDataObject_ACU,
  legacyAudit: UpgradeAuditResult_ACU,
  legacyRepair: RepairResult_ACU,
): boolean {
  // 1. 必须确实不可读。可读的走原有路径，不抢。
  if (decision.evidence.v2.replay.status === 'success') return false;

  // 2. 有合法 provenance 说明 V2 已继承 legacy 并可能有后继，绝不覆盖。
  if (decision.evidence.v2.provenance.validation?.valid === true) return false;

  // 3. legacy 必须可无损使用。
  if (legacyAudit.status !== 'clean' && legacyAudit.status !== 'repairable') return false;
  if (legacyRepair.requiresConfirmation) return false;

  // 4. legacy 必须非空，否则重建等于清库。
  const legacySheetKeys = new Set(sheetKeysOfData_ACU(legacyCandidateData));
  if (legacySheetKeys.size === 0) return false;

  // 5. 表身份归一化：以静态 sheetNames 为目标命名空间做一次归一化尝试。
  //    先按规范显示名把 legacy 侧历史随机 key 迁移到 V2 静态命名空间，
  //    再比对覆盖。resolveHistoricalSheetKeyMigrations_ACU 在歧义时跳过（不迁移），
  //    归一化后仍未覆盖的 key 会落进下方拒绝分支（B7）。
  //    注意：replay 不可用，无法获得 V2 的完整 data 形状，因此只能以静态
  //    sheetKeyToName 构造一个"V2 静态命名空间"用于比对，覆盖判定退化为：
  //    - 每个 V2 静态 sheetKey 要么直接命中 legacy key，要么其规范名唯一对应一个 legacy key。
  const v2NameToKey = new Map<string, string>();
  for (const [sheetKey, name] of Object.entries(staticEvidence.sheetKeyToName)) {
    if (!name || !name.trim()) continue;
    const canonical = String(name).trim().toLocaleLowerCase();
    const existing = v2NameToKey.get(canonical);
    if (existing && existing !== sheetKey) {
      // V2 静态命名空间中同一规范名对应多个 sheet key：多对一歧义，直接拒绝（B7）。
      return false;
    }
    v2NameToKey.set(canonical, sheetKey);
  }
  const legacyNameToKey = new Map<string, string>();
  for (const sheetKey of legacySheetKeys) {
    const sheet = (legacyCandidateData as Record<string, any>)[sheetKey];
    const name = sheet?.name;
    if (typeof name !== 'string' || !name.trim()) continue;
    const canonical = String(name).trim().toLocaleLowerCase();
    const existing = legacyNameToKey.get(canonical);
    if (existing && existing !== sheetKey) {
      // legacy 侧同一规范名对应多个 key：目标命名空间本身歧义，直接拒绝。
      return false;
    }
    legacyNameToKey.set(canonical, sheetKey);
  }
  for (const [sheetKey, name] of Object.entries(staticEvidence.sheetKeyToName)) {
    if (!name || !name.trim()) continue;
    const canonical = String(name).trim().toLocaleLowerCase();
    const legacyKey = legacyNameToKey.get(canonical);
    if (!legacyKey) {
      // V2 静态表在 legacy 中没有同名表：无法证明该表身份与 legacy 对应，拒绝。
      return false;
    }
  }
  // 覆盖判定：V2 静态 sheetKey 必须能被 legacy key 集合覆盖（含规范名归一化后）。
  for (const v2Key of staticEvidence.sheetKeys) {
    if (legacySheetKeys.has(v2Key)) continue;
    const name = staticEvidence.sheetKeyToName[v2Key];
    if (!name || !name.trim()) {
      // 无显示名可归一化且 key 未命中 legacy：无法证明覆盖，拒绝。
      return false;
    }
    const canonical = String(name).trim().toLocaleLowerCase();
    const legacyKey = legacyNameToKey.get(canonical);
    if (!legacyKey || !legacySheetKeys.has(legacyKey)) return false;
  }

  // 6. 存在无法静态解码的区域时，无法证明表清单完整 → 拒绝。
  if (staticEvidence.hasUndecodableRegion) return false;

  return true;
}

function normalizeLegacyCandidateToV2Namespace_ACU(
  data: TableDataObject_ACU,
  replayedV2Data: TableDataObject_ACU | undefined,
): { data: TableDataObject_ACU; migrations: Map<string, string> } {
  if (!replayedV2Data) return { data, migrations: new Map() };
  const migrations = resolveHistoricalSheetKeyMigrations_ACU(data, replayedV2Data);
  if (migrations.size === 0) return { data, migrations };
  const normalized = deepClone_ACU(data);
  for (const [sourceKey, targetKey] of migrations) {
    normalized[targetKey] = normalized[sourceKey];
    const targetSheet = normalized[targetKey] as any;
    if (targetSheet && typeof targetSheet === 'object') targetSheet.uid = targetKey;
    delete normalized[sourceKey];
  }
  return { data: normalized, migrations };
}

function remapLegacyScheduleSummary_ACU(
  summary: LegacyScheduleSummary_ACU,
  migrations: Map<string, string>,
): LegacyScheduleSummary_ACU {
  if (migrations.size === 0) return summary;
  const remapped: LegacyScheduleSummary_ACU = {};
  for (const [sheetKey, value] of Object.entries(summary)) {
    remapped[migrations.get(sheetKey) || sheetKey] = value;
  }
  return remapped;
}

function collectSupersededV2Frames_ACU(chat: any[], isolationKey: string): NonNullable<TableMigrationAuditBackupV1_ACU['supersededV2Frames']> {
  const result: NonNullable<TableMigrationAuditBackupV1_ACU['supersededV2Frames']> = [];
  chat.forEach((message, messageIndex) => {
    if (!message || message.is_user) return;
    const tagData = readIsolatedTagData_ACU(message, isolationKey) as any;
    // 证据判定：畸形槽（结构非法但携带 V2 历史证据）也必须归档，否则清理后
    // 失去回退源，且下次打开仍会命中 mixed 分支（见计划 §2.3 坑二）。
    if (!hasV2TableHistoryEvidence_ACU(tagData)) return;
    const malformed = !isV2TagData_ACU(tagData);
    // 无 storageFrame（仅版本标记残留）时归档整个 tagData，保证可还原；
    // 有 storageFrame 时归档 frame 原样深拷贝，不做任何结构修正。
    const storageFrame = tagData?.storageFrame === undefined
      ? deepClone_ACU(tagData)
      : deepClone_ACU(tagData?.storageFrame);
    result.push({
      messageIndex,
      isolationKey,
      storageFrame,
      ...(malformed ? { malformed: true } : {}),
      // 版本标记本身也是证据，移除后需可还原
      ...(tagData?._acu_storage_version !== undefined ? { storageVersionMarker: tagData._acu_storage_version } : {}),
    });
  });
  return result;
}

function removeSupersededV2Frames_ACU(chat: any[], isolationKey: string): void {
  for (const message of chat) {
    if (!message || message.is_user) continue;
    const isolatedData = cloneIsolatedData_ACU(message) as Record<string, any>;
    const tagData = isolatedData?.[isolationKey];
    if (!hasV2TableHistoryEvidence_ACU(tagData)) continue;
    delete tagData.storageFrame;
    delete tagData._acu_storage_version;
    // 槽内若只剩向量 metadata，则保留该 metadata，不得连带删除
    // summaryVectorIndexState / summaryVectorIndexManifest / vectorMemoryState
    if (Object.keys(tagData).length === 0) delete isolatedData[isolationKey];
    if (Object.keys(isolatedData).length === 0) delete message.TavernDB_ACU_IsolatedData;
    else message.TavernDB_ACU_IsolatedData = isolatedData;
  }
}

function buildMigrationRevision_ACU(): string {
  return `checkpoint:migration:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
}

interface LegacyMigrationScopeSnapshot_ACU {
  chat: any[];
  chatKey: string;
  activeIsolationKey: string;
}

function captureLegacyMigrationScope_ACU(chat: any[]): LegacyMigrationScopeSnapshot_ACU {
  return {
    chat,
    chatKey: String(currentChatFileIdentifier_ACU || '').trim(),
    activeIsolationKey: getCurrentIsolationKey_ACU(),
  };
}

function getLegacyMigrationScopeChangeError_ACU(snapshot: LegacyMigrationScopeSnapshot_ACU): string | null {
  if (getChatArray_ACU() !== snapshot.chat) {
    return 'legacy migration aborted: active chat changed before commit';
  }
  if (String(currentChatFileIdentifier_ACU || '').trim() !== snapshot.chatKey) {
    return 'legacy migration aborted: active chat identifier changed before commit';
  }
  if (getCurrentIsolationKey_ACU() !== snapshot.activeIsolationKey) {
    return 'legacy migration aborted: active isolation changed before commit';
  }
  return null;
}

export async function migrateLegacyStorageToV2OnLoad_ACU(
  options: LegacyToV2MigrationOptions_ACU,
): Promise<LegacyToV2MigrationResult_ACU> {
  const chat = getChatArray_ACU();
  if (!Array.isArray(chat) || chat.length === 0) {
    return { migrated: false, error: 'chat history is empty' };
  }
  const scopeSnapshot = captureLegacyMigrationScope_ACU(chat);

  const sheetKeys = sheetKeysOfData_ACU(options.data);
  if (sheetKeys.length === 0) {
    return { migrated: false, error: 'legacy migration requires non-empty merged table data' };
  }

  // ── 破坏性迁移保险闸 ──
  // 迁移成功后会删除各楼层旧存储字段原件（cleanupLegacyFieldsAfterV2Write_ACU），而
  // migrationAuditBackup 只备份合并结果。合并读取若丢表/丢行（如结构冲突被隔离、
  // 模板/指导表不匹配），执行迁移会造成不可逆数据丢失——拒绝迁移，读路径自动走
  // 直读降级，数据保持原样可用。两层闸门：
  // 1) 逐表存在性：旧源中每张带真实行的表必须在合并结果中有对应（key 或规范名）；
  // 2) 总行数兜底：合并结果一行都没有而旧源有行（表在但行被剥光的场景）。
  // 清单来源优先用合并读取点登记的 sourceInventory（与合并严格同源，杜绝独立扫描
  // 与合并读取语义漂移造成的缺表误报）；未提供时回退独立扫描。
  const legacyRowBearingSheets = options.sourceInventory instanceof Map
    ? options.sourceInventory
    : collectLegacyRowBearingSheets_ACU(chat, options.isolationKey, options.isolationConfig);
  const missingSheets = findLegacyRowBearingSheetsMissingFromMerged_ACU(options.data, legacyRowBearingSheets);
  if (missingSheets.length > 0) {
    const error = `合并结果缺失旧存储中带真实行数据的表：${missingSheets.join('、')}；为防止破坏性迁移丢失原始数据，已拒绝迁移。`;
    logWarn_ACU(`[V2 Migration] ${error}`);
    return { migrated: false, error };
  }
  if (countRealDataRows_ACU(options.data) === 0 && legacyRowBearingSheets.size > 0) {
    const error = '合并结果不含任何数据行，但聊天旧存储中存在真实行数据；为防止破坏性迁移丢失原始数据，已拒绝迁移。';
    logWarn_ACU(`[V2 Migration] ${error}`);
    return { migrated: false, error };
  }

  const strategy = resolveTableStorageStrategy_ACU(chat, options.isolationKey, options.isolationConfig);
  if (strategy.mode !== 'legacy-v1') {
    return { migrated: false };
  }

  const skipUpdateFloors = resolveMigrationSkipUpdateFloors_ACU(options.data, options.skipUpdateFloors);
  const target = findMigrationTargetAiMessage_ACU(chat, skipUpdateFloors);
  if (!target) {
    return { migrated: false, error: 'no AI message found for legacy migration' };
  }

  const audit = auditTableDataForUpgrade_ACU(options.data);
  if (audit.status === 'unrecoverable') {
    return { migrated: false, error: `legacy migration audit failed: ${audit.issues.map(issue => issue.code).join(', ')}` };
  }
  if (audit.status !== 'clean' && audit.status !== 'repairable') {
    return { migrated: false, error: `legacy migration requires confirmation: ${audit.issues.map(issue => issue.code).join(', ')}` };
  }
  const repair = repairTableDataFromAudit_ACU(audit);
  if (repair.requiresConfirmation) {
    return { migrated: false, error: `legacy migration requires confirmation: ${audit.issues.map(issue => issue.code).join(', ')}` };
  }
  let candidateData = repair.candidateData as TableDataObject_ACU;
  const sourceEvidenceBeforeNormalization = collectLegacyMigrationSourceEvidence_ACU(
    chat,
    options.isolationKey,
    options.isolationConfig,
    candidateData,
    { maxMessageIndex: target.index },
  );
  let mixedDecision: MixedStorageDecision_ACU | undefined;
  let keyMigrations = new Map<string, string>();
  let canRebuild = false;
  let selfHealedMixedConflict = false;
  let supersededV2Frames: NonNullable<TableMigrationAuditBackupV1_ACU['supersededV2Frames']> = [];
  const hasV2History = chat.some(message => !message?.is_user
    && hasV2TableHistoryEvidence_ACU(readIsolatedTagData_ACU(message, options.isolationKey)));
  if (hasV2History) {
    mixedDecision = await evaluateMixedStorageDecision_ACU({
      chat,
      isolationKey: options.isolationKey,
      isolationConfig: options.isolationConfig,
      legacyData: candidateData,
    });
    const normalized = normalizeLegacyCandidateToV2Namespace_ACU(candidateData, mixedDecision.evidence.v2.replay.data);
    candidateData = normalized.data;
    keyMigrations = normalized.migrations;
    if (mixedDecision.kind !== 'equivalent_provenance_verified' && mixedDecision.kind !== 'equivalent_projection_verified' && mixedDecision.kind !== 'v2_successor_verified') {
      const sourceIndices = sourceEvidenceBeforeNormalization.sourceMessageIndices;
      const latestLegacySourceIndex = sourceIndices.length > 0 ? sourceIndices[sourceIndices.length - 1] : undefined;
      const staticEvidence = collectV2SheetKeyEvidenceStatically_ACU(chat, options.isolationKey);
      // 坑一修复（计划 §2.3）：replay 不可用时，v2ReplayContainsSheetsMissingFromLegacyCandidate_ACU
      // 会因 replayedV2Data 缺失而误放行（return false）。必须用不依赖 replay 的静态扫描
      // 叠加守卫：静态清单必须被 legacy 完全覆盖且无 undecodable 区域，否则 canSupersede 不成立。
      const replayUsable = mixedDecision.evidence.v2.replay.status === 'success';
      const staticCoverageOk = staticEvidence.sheetKeys.every(key => sheetKeysOfData_ACU(candidateData).includes(key))
        && !staticEvidence.hasUndecodableRegion;
      const canSupersede = canSupersedeUpgradeResidualV2_ACU(mixedDecision, latestLegacySourceIndex, candidateData)
        && (replayUsable || staticCoverageOk);
      // T4 重建分支：V2 完全不可读时以 legacy 为权威源重建。仅当 canSupersede 放行失败时
      // 才评估，两者互斥，不得同时放行（见 canRebuildFromLegacyWhenV2Unreadable_ACU 注释）。
      canRebuild = !canSupersede && staticEvidence !== null
        && canRebuildFromLegacyWhenV2Unreadable_ACU(mixedDecision, staticEvidence, candidateData, audit, repair);
      if (!canSupersede && !canRebuild) {
        // ── 混合存储静默自愈（方向感知）──
        // 旧行为：登记 conflict 决策并阻断迁移。决策 UI 入口已隐藏，写闸依赖迁移成功，
        // 结果是"老前端 API 改数据 → V1V2 混合报错"的写路径死锁。
        // 新契约：按证据判定权威方向后静默处置，仅后台日志，无任何 UI。
        // audit unrecoverable / requiresConfirmation 的硬阻断在上方维持不变。
        //
        // 方向一（V2 更新）：V2 严格可读，且 V2 anchor 写在全部 legacy 源之后、或
        // provenance 完整证明 V2 继承自 legacy——legacy 是残留旧件，用 legacy 覆盖会
        // 回滚用户数据。处置：保 V2 为权威，legacy 原件备份进 anchor tagData 的
        // mixedStorageDecisionBackup 后清理残留字段。
        const provenance = mixedDecision.evidence.v2.provenance;
        const provenanceVerified = provenance.present
          && provenance.validation?.valid === true
          && provenance.targetMatchesAnchor === true
          && provenance.isolationKeyMatches === true
          && provenance.sourceEvidenceMatches === true
          && provenance.legacyFingerprintMatchesCandidate === true;
        const anchorIndex = mixedDecision.evidence.v2.anchor.messageIndex;
        const v2IsNewerDirection = replayUsable && anchorIndex !== null
          && (provenanceVerified || latestLegacySourceIndex === undefined || anchorIndex > latestLegacySourceIndex);
        if (v2IsNewerDirection) {
          const keepV2Chat = deepClone_ACU(chat);
          const anchorMessage = keepV2Chat[anchorIndex!];
          const anchorIsolated = cloneIsolatedData_ACU(anchorMessage) as Record<string, any>;
          const anchorTagData = readIsolatedTagData_ACU(anchorMessage, options.isolationKey) as any;
          anchorIsolated[options.isolationKey] = {
            ...anchorTagData,
            mixedStorageDecisionBackup: {
              version: 1,
              createdAt: Date.now(),
              action: 'keep_v2',
              legacyData: deepClone_ACU(audit.sourceData),
              legacyFingerprint: mixedDecision.legacyFingerprint,
              v2Fingerprint: mixedDecision.v2Fingerprint,
              sourceMessageIndices: [...mixedDecision.evidence.legacy.sourceMessageIndices],
              sourceAiFloors: [...mixedDecision.evidence.legacy.sourceAiFloors],
              decisionId: mixedDecision.decisionId,
              decisionKind: mixedDecision.kind,
            } satisfies MixedStorageDecisionBackupV1_ACU,
          };
          anchorMessage.TavernDB_ACU_IsolatedData = anchorIsolated;
          cleanupLegacyFieldsAfterV2Write_ACU(keepV2Chat, options.isolationKey, options.isolationConfig);
          const keepV2ScopeError = getLegacyMigrationScopeChangeError_ACU(scopeSnapshot);
          if (keepV2ScopeError) return { migrated: false, mixedDecision, error: keepV2ScopeError };
          // 修改全在 keepV2Chat 深拷贝上，原消息对象未被改动；回滚只需保留原引用，不再深拷贝整聊天。
          const chatBeforeKeepV2 = chat.slice();
          chat.splice(0, chat.length, ...keepV2Chat);
          try {
            await saveChatToHostStrict_ACU();
          } catch (error) {
            chat.splice(0, chat.length, ...chatBeforeKeepV2);
            return { migrated: false, mixedDecision, error: `mixed self-heal (keep_v2) save failed: ${error instanceof Error ? error.message : String(error)}` };
          }
          logWarn_ACU(
            `[V2 Migration] 混合存储（${mixedDecision.kind}）静默自愈：V2 anchor（#${anchorIndex}）`
            + `${provenanceVerified ? '带完整迁移 provenance' : '晚于全部 legacy 源'}，判定 V2 为权威；`
            + 'legacy 残留原件已备份至 anchor tagData 的 mixedStorageDecisionBackup 并从各楼层清除。',
          );
          return { migrated: true, messageIndex: anchorIndex!, data: (mixedDecision.evidence.v2.replay.data || candidateData) as TableDataObject_ACU, mixedDecision };
        }
        // 方向二（legacy 更新或方向不可判定）：采纳当前合并结果（legacy repair 候选）
        // 为权威重写迁移根。V2 侧严格可读时，把 legacy 候选缺失的表（key 与规范名双通道
        // 判重，避免同名双表冲突）补进候选，V2-only 数据不离开活动数据；V2 全部原帧随后
        // 由 supersede 主链深拷贝进 migrationAuditBackup.supersededV2Frames 归档兜底。
        const replayedV2Data = replayUsable
          ? mixedDecision.evidence.v2.replay.data as Record<string, any> | null
          : null;
        const backfilledSheetKeys: string[] = [];
        if (replayedV2Data && typeof replayedV2Data === 'object') {
          const candidateNames = new Set(
            sheetKeysOfData_ACU(candidateData)
              .map(key => canonicalizeDisplayName_ACU((candidateData as any)[key]?.name))
              .filter(Boolean),
          );
          for (const sheetKey of Object.keys(replayedV2Data)) {
            if (!sheetKey.startsWith('sheet_') || !replayedV2Data[sheetKey]) continue;
            if ((candidateData as any)[sheetKey]) continue;
            const v2Name = canonicalizeDisplayName_ACU(replayedV2Data[sheetKey]?.name);
            if (v2Name && candidateNames.has(v2Name)) continue;
            (candidateData as any)[sheetKey] = deepClone_ACU(replayedV2Data[sheetKey]);
            if (v2Name) candidateNames.add(v2Name);
            backfilledSheetKeys.push(sheetKey);
          }
        }
        selfHealedMixedConflict = true;
        logWarn_ACU(
          `[V2 Migration] 混合存储（${mixedDecision.kind}）静默自愈：判定 legacy 侧为最近权威（或方向不可判定），`
          + `采纳当前合并结果重写迁移根；V2 侧${replayedV2Data
            ? `严格可读，已把 legacy 候选缺失的 ${backfilledSheetKeys.length} 张表补进候选${backfilledSheetKeys.length > 0 ? `（${backfilledSheetKeys.join('、')}）` : ''}`
            : '不可严格读出，原帧整体进入迁移归档'}；`
          + '全部被替代 V2 帧已深拷贝归档至 migrationAuditBackup.supersededV2Frames。',
        );
      }
      supersededV2Frames = collectSupersededV2Frames_ACU(chat, options.isolationKey);
      if (canRebuild) {
        // 以静态扫描的 V2 sheetKey 命名空间为目标做历史 key 归一化（replay 不可用，
        // 无法依赖 replay.data）。歧义 key 已在 canRebuildFromLegacyWhenV2Unreadable_ACU
        // 中被拒绝，这里只做确定性迁移。
        const staticV2Namespace = Object.fromEntries(
          staticEvidence!.sheetKeys.map(key => {
            const name = staticEvidence!.sheetKeyToName[key];
            const sheet = name ? { name } : {};
            return [key, sheet];
          }),
        ) as TableDataObject_ACU;
        const staticNormalized = normalizeLegacyCandidateToV2Namespace_ACU(candidateData, staticV2Namespace);
        if (staticNormalized.migrations.size > 0) {
          candidateData = staticNormalized.data;
          keyMigrations = staticNormalized.migrations;
        }
        logDebug_ACU(`[V2 Migration] V2 不可读，以 legacy 为权威源重建：isolationKey=[${options.isolationKey || '无标签'}], archivedFrames=${supersededV2Frames.length}, staticSheets=${staticEvidence!.sheetKeys.length}`);
      }
    } else {
      const commit = await commitMixedStorageDecision_ACU({
        decision: mixedDecision,
        action: 'keep_v2',
        isolationConfig: options.isolationConfig,
      });
      if (commit.status !== 'committed') {
        return {
          migrated: false,
          mixedDecision,
          error: `mixed legacy-v1 and V2 verified cleanup failed: ${commit.error || commit.status}`,
        };
      }
      const data = mixedDecision.evidence.v2.replay.data || candidateData;
      return { migrated: true, data, mixedDecision };
    }
  }
  const candidateChat = deepClone_ACU(chat);
  if (supersededV2Frames.length > 0) removeSupersededV2Frames_ACU(candidateChat, options.isolationKey);
  const candidateTarget = candidateChat[target.index];
  const existingTargetTagData = readIsolatedTagData_ACU(candidateTarget, options.isolationKey) as any;
  const legacyEvidence: LegacyMigrationSourceEvidence_ACU = {
    ...sourceEvidenceBeforeNormalization,
    scheduleSummary: remapLegacyScheduleSummary_ACU(sourceEvidenceBeforeNormalization.scheduleSummary, keyMigrations),
  };
  const migratedAt = Date.now();
  const targetAiFloor = countAiFloor_ACU(candidateChat, target.index);
  const migrationProvenance: TableMigrationProvenanceV1_ACU = {
    version: 1,
    legacyDataFingerprint: getTableDataFingerprint_ACU(candidateData),
    legacySourceMessageIndices: legacyEvidence.sourceMessageIndices,
    legacySourceAiFloors: legacyEvidence.sourceAiFloors,
    legacyLastChangedAiFloorBySheet: Object.fromEntries(
      Object.entries(legacyEvidence.scheduleSummary)
        .filter(([, summary]) => Number.isInteger(summary.lastChangedAiFloor) && Number(summary.lastChangedAiFloor) >= 0)
        .map(([sheetKey, summary]) => [sheetKey, Number(summary.lastChangedAiFloor)]),
    ),
    targetMessageIndex: target.index,
    targetAiFloor,
    isolationKey: options.isolationKey,
    migratedAt,
  };
  const provenanceValidation = validateMigrationProvenanceV1_ACU(migrationProvenance);
  if (!provenanceValidation.valid) {
    return { migrated: false, error: `legacy migration provenance is invalid: ${provenanceValidation.issues.join(', ')}` };
  }
  const checkpointResult = buildCanonicalFullCheckpoint_ACU({
    createdAt: migratedAt,
    reason: 'migration',
    data: candidateData,
    scheduleSummary: legacyEvidence.scheduleSummary,
    migrationProvenance,
    context: {
      messageIndex: target.index,
      aiFloor: targetAiFloor,
      isolationKey: options.isolationKey,
    },
  });
  if (!checkpointResult.checkpoint) {
    return { migrated: false, error: checkpointResult.error };
  }
  const revision = buildMigrationRevision_ACU();
  const frame: TableStorageFrameV2_ACU = {
    version: 2,
    headRevision: revision,
    checkpoint: checkpointResult.checkpoint,
    logEntries: [],
  };

  const isolatedData = cloneIsolatedData_ACU(candidateTarget) as Record<string, any>;
  const migrationAuditBackup: TableMigrationAuditBackupV1_ACU = {
    version: 1,
    createdAt: migratedAt,
    sourceData: deepClone_ACU(audit.sourceData),
    dataFingerprintBefore: audit.dataFingerprintBefore,
    dataFingerprintAfter: repair.dataFingerprintAfter,
    auditStatus: audit.status,
    issues: deepClone_ACU(audit.issues),
    repairPlan: deepClone_ACU(audit.repairPlan),
    idRemap: deepClone_ACU(repair.idRemap),
    ...(supersededV2Frames.length > 0 ? { supersededV2Frames: deepClone_ACU(supersededV2Frames) } : {}),
  };
  isolatedData[options.isolationKey] = {
    ...(existingTargetTagData?.summaryVectorIndexState !== undefined ? { summaryVectorIndexState: existingTargetTagData.summaryVectorIndexState } : {}),
    ...(existingTargetTagData?.summaryVectorIndexManifest !== undefined ? { summaryVectorIndexManifest: existingTargetTagData.summaryVectorIndexManifest } : {}),
    storageFrame: frame,
    migrationAuditBackup,
    _acu_storage_version: 2,
  };
  candidateTarget.TavernDB_ACU_IsolatedData = isolatedData;
  cleanupLegacyFieldsAfterV2Write_ACU(candidateChat, options.isolationKey, options.isolationConfig);

  const scopeChangeError = getLegacyMigrationScopeChangeError_ACU(scopeSnapshot);
  if (scopeChangeError) {
    return { migrated: false, error: scopeChangeError };
  }

  // 修改全在 candidateChat 深拷贝上，原消息对象未被改动；回滚只需保留原引用，不再深拷贝整聊天。
  const originalChat = chat.slice();
  chat.splice(0, chat.length, ...candidateChat);
  try {
    // 迁移写入新的 full checkpoint 并清理 legacy 字段，落盘后回读目标楼确认。
    await saveChatToHostStrict_ACU({ verifyFields: [{ messageIndex: target.index, field: 'TavernDB_ACU_IsolatedData' }] });
  } catch (error) {
    chat.splice(0, chat.length, ...originalChat);
    return { migrated: false, error: `legacy migration save failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  logDebug_ACU(`[V2 Migration] legacy-v1 migrated to V2 checkpoint: messageIndex=${target.index}, skipUpdateFloors=${skipUpdateFloors}, isolationKey=[${options.isolationKey || '无标签'}], sheets=${sheetKeys.length}`);

  // T6 收口后置校验：重建/静默自愈路径成功且宿主已持久化后，验证新 checkpoint 可被正常
  // replay。失败时宿主已落盘、backup 已保留，不得谎称已回滚（committed-postcondition 语义）。
  if (canRebuild || selfHealedMixedConflict) {
    const verifyReplay = await loadTableStateFromFramesV2Detailed_ACU(chat, options.isolationKey, {
      updateRuntimeState: false,
    });
    if (!verifyReplay) {
      return {
        migrated: false,
        mixedDecision,
        error: 'legacy 重建已保存但后置 replay 校验失败：请重新加载当前聊天并核对数据（迁移备份已保留）',
      };
    }
  }

  return { migrated: true, messageIndex: target.index, data: candidateData, ...(mixedDecision ? { mixedDecision } : {}) };
}
