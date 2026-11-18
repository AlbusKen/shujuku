import type { IsolationConfig_ACU } from '../../data/models/chat-message-data';
import {
  isLegacyMatchForIsolation_ACU,
  readIsolatedTagData_ACU,
  readLegacyIndependentData_ACU,
  readLegacyStandardData_ACU,
  readLegacySummaryData_ACU,
  readModifiedKeys_ACU,
  readUpdateGroupKeys_ACU,
} from '../../data/repositories/chat-message-data-repo';
import { validateMigrationProvenanceV1_ACU } from '../../shared/canonical-checkpoint-validator';
import type { TableDataObject_ACU } from '../../shared/models/table-data';
import { hasV2TableHistoryEvidence_ACU, isV2TagData_ACU } from './storage-strategy-resolver';
import type { TableMigrationProvenanceV1_ACU, TableStorageFrameV2_ACU } from './storage-frame-v2-types';
import { loadTableStateFromFramesV2Detailed_ACU, type TableReplayCompatibilityRepairV2_ACU } from './storage-frame-v2-replay';
import { getTableDataFingerprint_ACU } from './table-data-upgrade-audit';
import { frameHasSheetTimelineArtifacts_ACU, getFrameSheetCheckpointRecords_ACU, getLatestFrameSheetCheckpoint_ACU } from './storage-frame-v2-sheet-events';

export type MixedStorageLegacyLocation_ACU =
  | 'isolated_independent'
  | 'isolated_incremental'
  | 'isolated_tracking_only'
  | 'top_level_independent'
  | 'top_level_standard'
  | 'top_level_summary'
  | 'top_level_tracking_only';

export interface MixedStorageLegacyMessageEvidence_ACU {
  messageIndex: number;
  aiFloor: number;
  locations: MixedStorageLegacyLocation_ACU[];
  sheetKeys: string[];
  modifiedKeys: string[];
  updateGroupKeys: string[];
  identityMatchedForTopLevel: boolean;
}

export interface MixedStorageSheetCoverageEvidence_ACU {
  sheetKey: string;
  lastReplayMessageIndex: number | null;
  lastReplayAiFloor: number | null;
  lastChangedAiFloor: number;
}

export interface MixedStorageV2FrameEvidence_ACU {
  messageIndex: number;
  aiFloor: number;
  hasFullCheckpoint: boolean;
  fullCheckpointReason?: string;
  fullCheckpointCreatedAt?: number;
  perSheetCheckpointKeys: string[];
  logEntryCount: number;
  headRevision?: string | null;
}

export interface MixedStorageEvidence_ACU {
  isolationKey: string;
  legacy: {
    messages: MixedStorageLegacyMessageEvidence_ACU[];
    sourceMessageIndices: number[];
    sourceAiFloors: number[];
    candidateFingerprint: string | null;
    sourceFingerprint: string;
    lastFilledAiFloorBySheet: Record<string, number>;
    lastChangedAiFloorBySheet: Record<string, number>;
  };
  v2: {
    frames: MixedStorageV2FrameEvidence_ACU[];
    anchor: {
      status: 'anchored' | 'missing_with_artifacts' | 'missing_without_artifacts';
      messageIndex: number | null;
      aiFloor: number | null;
      reason?: string;
      createdAt?: number;
      headRevision?: string | null;
    };
    sheetCoverage: MixedStorageSheetCoverageEvidence_ACU[];
    replay: {
      status: 'not_present' | 'unavailable' | 'success' | 'failed';
      fingerprint: string | null;
      data?: TableDataObject_ACU;
      error?: string;
      requiresCheckpointConvergence?: boolean;
      compatibilityRepairs?: TableReplayCompatibilityRepairV2_ACU[];
    };
    provenance: {
      present: boolean;
      value?: TableMigrationProvenanceV1_ACU;
      validation?: ReturnType<typeof validateMigrationProvenanceV1_ACU>;
      targetMatchesAnchor?: boolean;
      isolationKeyMatches?: boolean;
      sourceEvidenceMatches?: boolean;
      legacyFingerprintMatchesCandidate?: boolean | null;
    };
  };
  comparison: { fingerprintsComparable: boolean; fingerprintsEqual: boolean | null };
}

export interface CollectMixedStorageEvidenceOptions_ACU {
  chat: readonly any[];
  isolationKey: string;
  isolationConfig: Readonly<IsolationConfig_ACU>;
  legacyCandidateData?: TableDataObject_ACU | null;
}

const LOCATION_ORDER: MixedStorageLegacyLocation_ACU[] = [
  'isolated_independent', 'isolated_incremental', 'isolated_tracking_only',
  'top_level_independent', 'top_level_standard', 'top_level_summary', 'top_level_tracking_only',
];

function clone_ACU<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function sortedUnique_ACU(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.startsWith('sheet_')))].sort((a, b) => a.localeCompare(b));
}
function allowedSheetKeys_ACU(values: unknown[], allowed: Set<string>): string[] {
  return sortedUnique_ACU(values).filter(key => allowed.has(key));
}
function containerKeys_ACU(value: unknown, allowed: Set<string>): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return sortedUnique_ACU(Object.keys(value as Record<string, unknown>).filter(key => allowed.has(key)));
}

function pickSheetValues_ACU(value: unknown, sheetKeys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(sheetKeys.map(sheetKey => [sheetKey, (value as Record<string, unknown>)[sheetKey]]));
}

function legacySourceFingerprintPayload_ACU(
  message: any,
  evidence: MixedStorageLegacyMessageEvidence_ACU,
  isolationKey: string,
): Record<string, unknown> {
  const locations = new Set(evidence.locations);
  const payload: Record<string, unknown> = { messageIndex: evidence.messageIndex, locations: evidence.locations };
  const isolated = readIsolatedTagData_ACU(message, isolationKey) as any;
  if (locations.has('isolated_independent') || locations.has('isolated_incremental') || locations.has('isolated_tracking_only')) {
    payload.isolated = {
      independentData: pickSheetValues_ACU(isolated?.independentData, evidence.sheetKeys),
      incrementalData: pickSheetValues_ACU(isolated?.incrementalData, evidence.sheetKeys),
      modifiedKeys: evidence.modifiedKeys,
      updateGroupKeys: evidence.updateGroupKeys,
    };
  }
  if (locations.has('top_level_independent') || locations.has('top_level_standard') || locations.has('top_level_summary') || locations.has('top_level_tracking_only')) {
    payload.topLevel = {
      independentData: pickSheetValues_ACU(readLegacyIndependentData_ACU(message), evidence.sheetKeys),
      data: pickSheetValues_ACU(readLegacyStandardData_ACU(message), evidence.sheetKeys),
      summaryData: pickSheetValues_ACU(readLegacySummaryData_ACU(message), evidence.sheetKeys),
      modifiedKeys: evidence.modifiedKeys,
      updateGroupKeys: evidence.updateGroupKeys,
      identity: message?.TavernDB_ACU_Identity,
    };
  }
  return payload;
}

function updateLegacyFloors_ACU(
  lastFilledAiFloorBySheet: Record<string, number>,
  lastChangedAiFloorBySheet: Record<string, number>,
  aiFloor: number,
  dataKeys: string[],
  deltaKeys: string[],
  modifiedKeys: string[],
  updateGroupKeys: string[],
): void {
  const noteFilled = (sheetKey: string): void => { lastFilledAiFloorBySheet[sheetKey] = Math.max(lastFilledAiFloorBySheet[sheetKey] || 0, aiFloor); };
  const noteChanged = (sheetKey: string): void => { lastChangedAiFloorBySheet[sheetKey] = Math.max(lastChangedAiFloorBySheet[sheetKey] || 0, aiFloor); };
  updateGroupKeys.forEach(noteFilled);
  [...modifiedKeys, ...deltaKeys].forEach(sheetKey => { noteFilled(sheetKey); noteChanged(sheetKey); });
  if (updateGroupKeys.length === 0 && modifiedKeys.length === 0 && deltaKeys.length === 0) {
    dataKeys.forEach(sheetKey => { noteFilled(sheetKey); noteChanged(sheetKey); });
  }
}

function eventTouchesSheet_ACU(event: any, sheetKey: string): boolean {
  return ['filledSheetKeys', 'changedSheetKeys', 'groupKeys'].some(key => Array.isArray(event?.[key]) && event[key].includes(sheetKey));
}

function operationTouchesSheet_ACU(operation: any, sheetKey: string): boolean {
  if (!operation || typeof operation !== 'object') return false;
  if (operation.kind === 'sheet_replace' || operation.kind === 'sheet_schema_migrate' || operation.kind === 'row_upsert' || operation.kind === 'row_delete' || operation.kind === 'meta_update' || operation.kind === 'sql_sheet_batch') return operation.sheetKey === sheetKey;
  if (operation.kind === 'data_replace') return !!operation.data?.[sheetKey];
  return operation.kind === 'sql_batch' || operation.kind === 'table_edit_dsl';
}

function frameTouchesSheet_ACU(frame: TableStorageFrameV2_ACU, sheetKey: string): boolean {
  if (getLatestFrameSheetCheckpoint_ACU(frame, sheetKey)?.kind === 'sheet_full') return true;
  return (frame.logEntries || []).some(entry => eventTouchesSheet_ACU(entry, sheetKey)
    || (Array.isArray(entry.operations) && entry.operations.some(operation => operationTouchesSheet_ACU(operation, sheetKey)))
    || (Array.isArray(entry.patches) && entry.patches.some(patch => patch?.sheetKey === sheetKey)));
}

function eventChangedFloor_ACU(event: any, fallbackAiFloor: number, sheetKey: string): number {
  if (!eventTouchesSheet_ACU(event, sheetKey)) return 0;
  return Number.isInteger(event?.aiFloor) && event.aiFloor > 0 ? event.aiFloor : fallbackAiFloor;
}

function entryChangedFloor_ACU(entry: any, fallbackAiFloor: number, sheetKey: string): number {
  const eventFloor = eventChangedFloor_ACU(entry, fallbackAiFloor, sheetKey);
  if (eventFloor > 0) return eventFloor;
  const operationTouched = Array.isArray(entry?.operations)
    && entry.operations.some((operation: unknown) => operationTouchesSheet_ACU(operation, sheetKey));
  const patchTouched = Array.isArray(entry?.patches)
    && entry.patches.some((patch: any) => patch?.sheetKey === sheetKey);
  return operationTouched || patchTouched ? fallbackAiFloor : 0;
}

function frameHasUnanchoredArtifacts_ACU(frame: TableStorageFrameV2_ACU): boolean {
  const raw = frame as unknown as Record<string, unknown>;
  const perSheetCheckpoints = raw.perSheetCheckpoints;
  const hasPerSheetCheckpointArtifact = perSheetCheckpoints !== undefined
    && (perSheetCheckpoints === null
      || typeof perSheetCheckpoints !== 'object'
      || Array.isArray(perSheetCheckpoints)
      || Object.keys(perSheetCheckpoints).length > 0);
  const headRevision = raw.headRevision;
  const hasHeadRevisionArtifact = headRevision !== undefined
    && headRevision !== null
    && (typeof headRevision !== 'string' || headRevision.length > 0);
  return frame.logEntries.length > 0
    || hasPerSheetCheckpointArtifact
    || frameHasSheetTimelineArtifacts_ACU(frame)
    || raw.manualRefillProgress !== undefined
    || hasHeadRevisionArtifact;
}

function collectLegacyMessageEvidence_ACU(
  message: any,
  messageIndex: number,
  aiFloor: number,
  isolationKey: string,
  isolationConfig: Readonly<IsolationConfig_ACU>,
  allowedSheetKeys: Set<string>,
  lastFilledAiFloorBySheet: Record<string, number>,
  lastChangedAiFloorBySheet: Record<string, number>,
): MixedStorageLegacyMessageEvidence_ACU | null {
  const locations = new Set<MixedStorageLegacyLocation_ACU>();
  const sheetKeys = new Set<string>();
  const modifiedKeys = new Set<string>();
  const updateGroupKeys = new Set<string>();
  const addKeys = (keys: string[]): void => keys.forEach(key => sheetKeys.add(key));
  const isolated = readIsolatedTagData_ACU(message, isolationKey) as any;
  if (isolated && !isV2TagData_ACU(isolated)) {
    const independentKeys = containerKeys_ACU(isolated.independentData, allowedSheetKeys);
    const incrementalKeys = containerKeys_ACU(isolated.incrementalData, allowedSheetKeys);
    const isolatedModifiedKeys = allowedSheetKeys_ACU(Array.isArray(isolated.modifiedKeys) ? isolated.modifiedKeys : [], allowedSheetKeys);
    const isolatedUpdateGroupKeys = allowedSheetKeys_ACU(Array.isArray(isolated.updateGroupKeys) ? isolated.updateGroupKeys : [], allowedSheetKeys);
    if (independentKeys.length > 0) locations.add('isolated_independent');
    if (incrementalKeys.length > 0) locations.add('isolated_incremental');
    if (independentKeys.length === 0 && incrementalKeys.length === 0 && (isolatedModifiedKeys.length > 0 || isolatedUpdateGroupKeys.length > 0)) locations.add('isolated_tracking_only');
    addKeys([...independentKeys, ...incrementalKeys, ...isolatedModifiedKeys, ...isolatedUpdateGroupKeys]);
    updateLegacyFloors_ACU(lastFilledAiFloorBySheet, lastChangedAiFloorBySheet, aiFloor, independentKeys, incrementalKeys, isolatedModifiedKeys, isolatedUpdateGroupKeys);
    isolatedModifiedKeys.forEach(key => modifiedKeys.add(key));
    isolatedUpdateGroupKeys.forEach(key => updateGroupKeys.add(key));
  }
  const identityMatchedForTopLevel = isLegacyMatchForIsolation_ACU(message, isolationConfig);
  if (identityMatchedForTopLevel) {
    const independentKeys = containerKeys_ACU(readLegacyIndependentData_ACU(message), allowedSheetKeys);
    const standardKeys = containerKeys_ACU(readLegacyStandardData_ACU(message), allowedSheetKeys);
    const summaryKeys = containerKeys_ACU(readLegacySummaryData_ACU(message), allowedSheetKeys);
    const topLevelModifiedKeys = allowedSheetKeys_ACU(readModifiedKeys_ACU(message), allowedSheetKeys);
    const topLevelUpdateGroupKeys = allowedSheetKeys_ACU(readUpdateGroupKeys_ACU(message), allowedSheetKeys);
    if (independentKeys.length > 0) locations.add('top_level_independent');
    if (standardKeys.length > 0) locations.add('top_level_standard');
    if (summaryKeys.length > 0) locations.add('top_level_summary');
    if (independentKeys.length === 0 && standardKeys.length === 0 && summaryKeys.length === 0 && (topLevelModifiedKeys.length > 0 || topLevelUpdateGroupKeys.length > 0)) locations.add('top_level_tracking_only');
    addKeys([...independentKeys, ...standardKeys, ...summaryKeys, ...topLevelModifiedKeys, ...topLevelUpdateGroupKeys]);
    updateLegacyFloors_ACU(lastFilledAiFloorBySheet, lastChangedAiFloorBySheet, aiFloor, [...independentKeys, ...standardKeys, ...summaryKeys], [], topLevelModifiedKeys, topLevelUpdateGroupKeys);
    topLevelModifiedKeys.forEach(key => modifiedKeys.add(key));
    topLevelUpdateGroupKeys.forEach(key => updateGroupKeys.add(key));
  }
  if (locations.size === 0) return null;
  return {
    messageIndex,
    aiFloor,
    locations: LOCATION_ORDER.filter(location => locations.has(location)),
    sheetKeys: [...sheetKeys].sort((a, b) => a.localeCompare(b)),
    modifiedKeys: [...modifiedKeys].sort((a, b) => a.localeCompare(b)),
    updateGroupKeys: [...updateGroupKeys].sort((a, b) => a.localeCompare(b)),
    identityMatchedForTopLevel,
  };
}

export async function collectMixedStorageEvidence_ACU(
  options: CollectMixedStorageEvidenceOptions_ACU,
): Promise<MixedStorageEvidence_ACU> {
  const chat = Array.isArray(options.chat) ? options.chat : [];
  const candidateFingerprint = options.legacyCandidateData ? getTableDataFingerprint_ACU(options.legacyCandidateData) : null;
  const allowedSheetKeys = new Set(Object.keys(options.legacyCandidateData || {}).filter(key => key.startsWith('sheet_')));
  const legacyMessages: MixedStorageLegacyMessageEvidence_ACU[] = [];
  const legacySourcePayloads: Record<string, unknown>[] = [];
  const frames: Array<{ messageIndex: number; aiFloor: number; frame: TableStorageFrameV2_ACU }> = [];
  const lastFilledAiFloorBySheet: Record<string, number> = {};
  const lastChangedAiFloorBySheet: Record<string, number> = {};
  let aiFloor = 0;
  for (let messageIndex = 0; messageIndex < chat.length; messageIndex += 1) {
    const message = chat[messageIndex];
    if (!message || message.is_user) continue;
    aiFloor += 1;
    const legacy = collectLegacyMessageEvidence_ACU(message, messageIndex, aiFloor, options.isolationKey, options.isolationConfig, allowedSheetKeys, lastFilledAiFloorBySheet, lastChangedAiFloorBySheet);
    if (legacy) {
      legacyMessages.push(legacy);
      legacySourcePayloads.push(legacySourceFingerprintPayload_ACU(message, legacy, options.isolationKey));
    }
    const tagData = readIsolatedTagData_ACU(message, options.isolationKey) as any;
    if (isV2TagData_ACU(tagData)) frames.push({ messageIndex, aiFloor, frame: tagData.storageFrame });
  }
  const sourceMessageIndices = legacyMessages.map(message => message.messageIndex);
  const sourceAiFloors = legacyMessages.map(message => message.aiFloor);
  const anchor = [...frames].reverse().find(ref => ref.frame.checkpoint?.kind === 'full');
  const anchorStatus = anchor ? 'anchored' : (frames.some(ref => frameHasUnanchoredArtifacts_ACU(ref.frame)) ? 'missing_with_artifacts' : 'missing_without_artifacts');
  const frameEvidence = frames.map(ref => ({
    messageIndex: ref.messageIndex,
    aiFloor: ref.aiFloor,
    hasFullCheckpoint: ref.frame.checkpoint?.kind === 'full',
    ...(ref.frame.checkpoint?.kind === 'full' ? { fullCheckpointReason: ref.frame.checkpoint.reason, fullCheckpointCreatedAt: ref.frame.checkpoint.createdAt } : {}),
    perSheetCheckpointKeys: [...new Set(getFrameSheetCheckpointRecords_ACU(ref.frame).map(record => record.recordKey).filter(key => typeof key === 'string' && key.startsWith('sheet_')))].sort((a, b) => a.localeCompare(b)),
    logEntryCount: Array.isArray(ref.frame.logEntries) ? ref.frame.logEntries.length : 0,
    ...(ref.frame.headRevision !== undefined ? { headRevision: ref.frame.headRevision } : {}),
  }));
  const sheetCoverage = [...allowedSheetKeys].sort((a, b) => a.localeCompare(b)).map(sheetKey => {
    let lastReplayMessageIndex: number | null = anchor?.frame.checkpoint?.data?.[sheetKey] ? anchor.messageIndex : null;
    let lastReplayAiFloor: number | null = lastReplayMessageIndex === null ? null : anchor!.aiFloor;
    let lastChangedAiFloor = Math.max(
      Number(anchor?.frame.checkpoint?.scheduleSummary?.[sheetKey]?.lastChangedAiFloor) || 0,
      anchor ? eventChangedFloor_ACU(anchor.frame.checkpoint?.event, anchor.aiFloor, sheetKey) : 0,
    );
    for (const ref of frames) {
      if (!anchor || ref.messageIndex < anchor.messageIndex) continue;
      if (ref.messageIndex !== anchor.messageIndex && frameTouchesSheet_ACU(ref.frame, sheetKey)) {
        lastReplayMessageIndex = ref.messageIndex;
        lastReplayAiFloor = ref.aiFloor;
      }
      const sheetCheckpoint = getLatestFrameSheetCheckpoint_ACU(ref.frame, sheetKey);
      if (sheetCheckpoint) {
        lastChangedAiFloor = Math.max(lastChangedAiFloor, Number(sheetCheckpoint.scheduleSummary?.lastChangedAiFloor) || 0, eventChangedFloor_ACU(sheetCheckpoint.event, ref.aiFloor, sheetKey));
      }
      for (const entry of ref.frame.logEntries || []) {
        lastChangedAiFloor = Math.max(lastChangedAiFloor, entryChangedFloor_ACU(entry, ref.aiFloor, sheetKey));
      }
    }
    return { sheetKey, lastReplayMessageIndex, lastReplayAiFloor, lastChangedAiFloor };
  });
  let replay: MixedStorageEvidence_ACU['v2']['replay'] = { status: frames.length === 0 ? 'not_present' : 'unavailable', fingerprint: null };
  if (anchor) {
    try {
      const detailed = await loadTableStateFromFramesV2Detailed_ACU(chat, options.isolationKey, { updateRuntimeState: false });
      // Tier-1 宽容回放（compat_tolerant_replay 基）只保障读可用性，不构成
      // "V2 严格可读=可信权威"的写决策证据：宽容数据可能含重复 row_id 与身份
      // 归并副作用，喂给 fingerprint/merge candidate 会产生错误等价判定。此处
      // 按 T8 矩阵既有语义归类为 failed，让 legacy 权威重建/阻塞分支照常工作。
      if (detailed && detailed.baseKind === 'compat_tolerant_replay') {
        replay = { status: 'failed', fingerprint: null, error: 'V2 帧仅可经兼容宽容回放读出（严格回放失败），不作为混合存储写决策的可信证据' };
      } else replay = detailed ? {
        status: 'success',
        fingerprint: getTableDataFingerprint_ACU(detailed.data),
        data: clone_ACU(detailed.data),
        ...(detailed.requiresCheckpointConvergence ? { requiresCheckpointConvergence: true } : {}),
        ...(detailed.compatibilityRepairs?.length ? { compatibilityRepairs: clone_ACU(detailed.compatibilityRepairs) } : {}),
      } : { status: 'unavailable', fingerprint: null };
    } catch (error) {
      replay = { status: 'failed', fingerprint: null, error: error instanceof Error ? error.message : String(error) };
    }
  }
  const rawProvenance = anchor?.frame.checkpoint?.migrationProvenance;
  const provenance = rawProvenance === undefined
    ? { present: false }
    : {
      present: true,
      value: clone_ACU(rawProvenance),
      validation: validateMigrationProvenanceV1_ACU(rawProvenance),
      targetMatchesAnchor: rawProvenance.targetMessageIndex === anchor!.messageIndex && rawProvenance.targetAiFloor === anchor!.aiFloor,
      isolationKeyMatches: rawProvenance.isolationKey === options.isolationKey,
      sourceEvidenceMatches: JSON.stringify(rawProvenance.legacySourceMessageIndices) === JSON.stringify(sourceMessageIndices)
        && JSON.stringify(rawProvenance.legacySourceAiFloors) === JSON.stringify(sourceAiFloors),
      legacyFingerprintMatchesCandidate: candidateFingerprint === null ? null : rawProvenance.legacyDataFingerprint === candidateFingerprint,
    };
  const fingerprintsComparable = candidateFingerprint !== null && replay.fingerprint !== null;
  return {
    isolationKey: options.isolationKey,
    legacy: { messages: legacyMessages, sourceMessageIndices, sourceAiFloors, candidateFingerprint, sourceFingerprint: getTableDataFingerprint_ACU(legacySourcePayloads), lastFilledAiFloorBySheet, lastChangedAiFloorBySheet },
    v2: {
      frames: frameEvidence,
      anchor: {
        status: anchorStatus,
        messageIndex: anchor?.messageIndex ?? null,
        aiFloor: anchor?.aiFloor ?? null,
        ...(anchor ? { reason: anchor.frame.checkpoint!.reason, createdAt: anchor.frame.checkpoint!.createdAt, ...(anchor.frame.headRevision !== undefined ? { headRevision: anchor.frame.headRevision } : {}) } : {}),
      },
      sheetCoverage,
      replay,
      provenance,
    },
    comparison: { fingerprintsComparable, fingerprintsEqual: fingerprintsComparable ? candidateFingerprint === replay.fingerprint : null },
  };
}


export interface V2StaticSheetEvidence_ACU {
  /** V2 侧静态可见的全部 sheet key（升序去重）。 */
  sheetKeys: string[];
  /** V2 侧静态可见的显示名（sheet.name），供表身份归一化比对使用。 */
  sheetNames: string[];
  /** sheetKey → 静态可见的显示名；用于按规范名做历史 key 迁移后再比对覆盖。 */
  sheetKeyToName: Record<string, string>;
  /** 存在无法静态解码的区域（畸形 frame、非法 checkpoint.data 等）。 */
  hasUndecodableRegion: boolean;
  /** 携带 V2 历史证据但结构非法的槽位坐标，供归档与诊断使用。 */
  malformedSlots: Array<{ messageIndex: number; reason: string }>;
}

const SHEET_OPERATION_KINDS_WITH_SHEET_KEY_ACU = new Set([
  'sql_sheet_batch',
  'sheet_replace',
  'meta_update',
  'sheet_schema_migrate',
  'row_upsert',
  'row_delete',
]);

function addSheetIdentitiesFromContainer_ACU(
  container: unknown,
  sheetKeys: Set<string>,
  sheetKeyToName: Record<string, string>,
): boolean {
  if (container === undefined || container === null) return true;
  if (!container || typeof container !== 'object' || Array.isArray(container)) return false;
  for (const key of Object.keys(container as Record<string, unknown>)) {
    if (key.startsWith('sheet_')) sheetKeys.add(key);
    const value = (container as Record<string, unknown>)[key];
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof (value as any).name === 'string') {
      const name = (value as any).name as string;
      if (name.trim()) sheetKeyToName[key] = name;
    }
  }
  return true;
}

function collectSheetKeysFromLogEntry_ACU(
  entry: unknown,
  sheetKeys: Set<string>,
  sheetKeyToName: Record<string, string>,
): boolean {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const raw = entry as Record<string, unknown>;

  // patches[].sheetKey
  if (raw.patches !== undefined) {
    if (!Array.isArray(raw.patches)) return false;
    for (const patch of raw.patches) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return false;
      const patchKey = (patch as Record<string, unknown>).sheetKey;
      if (typeof patchKey === 'string' && patchKey.startsWith('sheet_')) sheetKeys.add(patchKey);
      const patchName = (patch as Record<string, unknown>).sheet
        ? ((patch as Record<string, unknown>).sheet as any)?.name
        : undefined;
      if (typeof patchName === 'string' && patchName.trim() && typeof patchKey === 'string') sheetKeyToName[patchKey] = patchName;
    }
  }

  // operations[]：带 sheetKey 的 operation，或 data_replace.data 的键
  if (raw.operations !== undefined) {
    if (!Array.isArray(raw.operations)) return false;
    for (const operation of raw.operations) {
      if (!operation || typeof operation !== 'object' || Array.isArray(operation)) return false;
      const op = operation as Record<string, unknown>;
      if (op.kind === 'data_replace') {
        if (!addSheetIdentitiesFromContainer_ACU(op.data, sheetKeys, sheetKeyToName)) return false;
      } else if (typeof op.kind === 'string' && SHEET_OPERATION_KINDS_WITH_SHEET_KEY_ACU.has(op.kind)) {
        const opKey = op.sheetKey;
        if (typeof opKey === 'string' && opKey.startsWith('sheet_')) sheetKeys.add(opKey);
        const opName = (op as Record<string, unknown>).sheet
          ? ((op as Record<string, unknown>).sheet as any)?.name
          : undefined;
        if (typeof opName === 'string' && opName.trim() && typeof opKey === 'string') sheetKeyToName[opKey] = opName;
      }
    }
  }

  return true;
}

/**
 * 从原始 tagData 静态枚举 V2 侧全部 sheet key，不执行任何 operation、不调 replay。
 *
 * 判定入口用宽判定 hasV2TableHistoryEvidence_ACU（含畸形槽），不用 isV2TagData_ACU。
 * 语义契约：sheetKeys 是「V2 侧至少曾经出现过的表」的上界估计。宁可多报（拒绝重建），
 * 不可少报（覆盖丢数据）。任何无法静态解码的区域记入 malformedSlots 并使
 * hasUndecodableRegion=true（不抛错）。纯函数，不修改输入。
 */
export function collectV2SheetKeyEvidenceStatically_ACU(
  chat: readonly any[],
  isolationKey: string,
): V2StaticSheetEvidence_ACU {
  const sheetKeys = new Set<string>();
  const sheetNames = new Set<string>();
  const sheetKeyToName: Record<string, string> = {};
  const malformedSlots: Array<{ messageIndex: number; reason: string }> = [];
  let hasUndecodableRegion = false;

  const messages = Array.isArray(chat) ? chat : [];
  messages.forEach((message, messageIndex) => {
    if (!message || message.is_user) return;
    const tagData = readIsolatedTagData_ACU(message, isolationKey) as any;
    if (!hasV2TableHistoryEvidence_ACU(tagData)) return;

    const frame = tagData?.storageFrame;
    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) {
      // 仅版本标记残留（无 storageFrame）：没有任何表清单需要覆盖，legacy 全权重建。
      // 不视为 undecodable（无清单即无覆盖风险），记 malformed 供归档诊断。
      malformedSlots.push({ messageIndex, reason: 'storageFrame 缺失或非对象' });
      return;
    }

    // 语义（计划 §3.1 第 4 条 / §6 风险表首条 / §9 自我复查三处一致）：
    // 表清单必须可完整枚举，任何枚举路径失败一律 undecodable → 上层拒绝重建。
    //
    // 为什么 logEntries 非数组也必须 fail-closed：日志区域可能存在只由 operation
    // 引入的表（data_replace.data 的键、sheet_replace / sql_sheet_batch 的 sheetKey）。
    // checkpoint.data 只能证明「这些表存在」，不能证明「没有别的表」。放行等于用
    // 数据安全换通过率。
    //
    // malformed 只用于「键已确定拿到、仅单表内容不可读」的局部损坏，它不影响
    // 清单完整性，仅作归档诊断。
    let undecodable = false;
    let malformed = false;
    // checkpoint.data
    if (frame.checkpoint !== undefined) {
      if (!frame.checkpoint || typeof frame.checkpoint !== 'object' || Array.isArray(frame.checkpoint)) {
        undecodable = true;
      } else if (!addSheetIdentitiesFromContainer_ACU((frame.checkpoint as Record<string, unknown>).data, sheetKeys, sheetKeyToName)) {
        undecodable = true;
      }
    }
    // perSheetCheckpoints：键即 sheetKey；sheet_full.data 是单表 Sheet_ACU（不是
    // sheet_ 容器），因此 key 取自容器键与 sheetKey 字段，显示名取自 data.name。
    if (frame.perSheetCheckpoints !== undefined) {
      if (!frame.perSheetCheckpoints || typeof frame.perSheetCheckpoints !== 'object' || Array.isArray(frame.perSheetCheckpoints)) {
        // 容器不可枚举 → 无法证明其中有哪些表 → fail-closed。
        undecodable = true;
      } else {
        for (const [key, sheetCheckpoint] of Object.entries(frame.perSheetCheckpoints as Record<string, unknown>)) {
          if (key.startsWith('sheet_')) sheetKeys.add(key);
          if (!sheetCheckpoint || typeof sheetCheckpoint !== 'object' || Array.isArray(sheetCheckpoint)) {
            // 键已拿到，仅单表内容不可读：不影响清单完整性。
            malformed = true;
            continue;
          }
          const checkpointRecord = sheetCheckpoint as Record<string, unknown>;
          const declaredSheetKey = checkpointRecord.sheetKey;
          if (typeof declaredSheetKey === 'string' && declaredSheetKey.startsWith('sheet_')) sheetKeys.add(declaredSheetKey);
          const sheetName = (checkpointRecord.data as Record<string, unknown> | undefined)?.name;
          if (typeof sheetName === 'string' && sheetName.trim()) {
            const targetKey = typeof declaredSheetKey === 'string' && declaredSheetKey ? declaredSheetKey : key;
            sheetKeyToName[targetKey] = sheetName;
          }
        }
      }
    }
    if (frame.sheetTimelineEvents !== undefined) {
      if (!Array.isArray(frame.sheetTimelineEvents)) {
        undecodable = true;
      } else {
        for (const event of frame.sheetTimelineEvents) {
          const checkpoint = event?.checkpoint;
          const key = checkpoint?.sheetKey;
          if (typeof key !== 'string' || !key.startsWith('sheet_')) {
            undecodable = true;
            continue;
          }
          sheetKeys.add(key);
          const name = checkpoint?.data?.name;
          if (typeof name === 'string' && name.trim()) sheetKeyToName[key] = name;
          else malformed = true;
        }
      }
    }
    // logEntries
    if (frame.logEntries !== undefined) {
      if (!Array.isArray(frame.logEntries)) {
        // 日志不可枚举：无法排除只在 operation 中出现过的表 → fail-closed。
        undecodable = true;
      } else {
        for (const entry of frame.logEntries) {
          if (!collectSheetKeysFromLogEntry_ACU(entry, sheetKeys, sheetKeyToName)) {
            undecodable = true;
            break;
          }
        }
      }
    }

    if (undecodable) {
      hasUndecodableRegion = true;
      malformedSlots.push({ messageIndex, reason: 'V2 frame 结构非法或包含无法解码区域' });
    } else if (malformed) {
      malformedSlots.push({ messageIndex, reason: 'V2 frame 局部内容不可读但表清单可枚举' });
    }
  });

  // 汇总静态可见显示名（全部槽扫描完成后统一收敛）。
  for (const name of Object.values(sheetKeyToName)) {
    if (name && name.trim()) sheetNames.add(name);
  }

  return {
    sheetKeys: [...sheetKeys].sort((a, b) => a.localeCompare(b)),
    sheetNames: [...sheetNames].sort((a, b) => a.localeCompare(b)),
    sheetKeyToName,
    hasUndecodableRegion,
    malformedSlots,
  };
}
