import type { IsolationConfig_ACU, IsolationTagData_ACU } from '../../data/models/chat-message-data';
import { isLegacyMatchForIsolation_ACU, readIsolatedTagData_ACU } from '../../data/repositories/chat-message-data-repo';
import type { ACUMessage } from '../../shared/host-api';
import type { TableStorageFrameV2_ACU } from './storage-frame-v2-types';

export type TableStorageStrategy_ACU =
  | { mode: 'empty' }
  | { mode: 'legacy-v1'; reason: string; warning?: string }
  | { mode: 'v2' };

function isObjectRecord_ACU(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOwnKey_ACU(value: Record<string, any>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasAnySheetKey_ACU(value: unknown): boolean {
  return isObjectRecord_ACU(value) && Object.keys(value).some(k => k.startsWith('sheet_'));
}

function hasNonEmptyStringArray_ACU(value: unknown): boolean {
  return Array.isArray(value) && value.some(item => typeof item === 'string' && item.startsWith('sheet_'));
}

/**
 * Detects persisted V2 table evidence, including damaged slots whose version markers were lost.
 * Vector-index-only metadata is deliberately excluded: it does not establish a sheet identity.
 */
export function hasV2TableHistoryEvidence_ACU(tagData: unknown): boolean {
  if (!isObjectRecord_ACU(tagData)) return false;
  if (tagData._acu_storage_version === 2) return true;

  const frame = tagData.storageFrame;
  if (!isObjectRecord_ACU(frame)) return false;
  if (frame.version === 2) return true;
  if (frame.checkpoint !== undefined) return true;
  if (frame.perSheetCheckpoints !== undefined) return true;
  if (frame.sheetTimelineEvents !== undefined) return true;
  if (Array.isArray(frame.logEntries) && frame.logEntries.length > 0) return true;
  if (frame.manualRefillProgress !== undefined) return true;
  return frame.headRevision !== undefined
    && frame.headRevision !== null
    && (typeof frame.headRevision !== 'string' || frame.headRevision.length > 0);
}

export function isV2TagData_ACU(tagData: unknown): tagData is IsolationTagData_ACU & { storageFrame: TableStorageFrameV2_ACU } {
  if (!isObjectRecord_ACU(tagData)) return false;
  const frame = tagData.storageFrame;
  return isObjectRecord_ACU(frame)
    && frame.version === 2
    && Array.isArray(frame.logEntries);
}

export function isLegacyV1TagData_ACU(tagData: unknown): boolean {
  if (!isObjectRecord_ACU(tagData)) return false;
  if (isV2TagData_ACU(tagData)) return false;

  if (hasAnySheetKey_ACU(tagData.independentData)) return true;
  if (hasAnySheetKey_ACU(tagData.incrementalData)) return true;
  if (hasNonEmptyStringArray_ACU(tagData.modifiedKeys)) return true;
  if (hasNonEmptyStringArray_ACU(tagData.updateGroupKeys)) return true;

  const storageMode = tagData._acu_storage_mode;
  if ((storageMode === 'checkpoint' || storageMode === 'delta' || storageMode === 'legacy')
      && (hasOwnKey_ACU(tagData, 'independentData') || hasOwnKey_ACU(tagData, 'incrementalData'))) {
    return true;
  }

  const storageVersion = tagData._acu_storage_version;
  if (storageVersion === 1 && (hasOwnKey_ACU(tagData, 'independentData') || hasOwnKey_ACU(tagData, 'incrementalData'))) {
    return true;
  }

  return false;
}

export function hasLegacyTopLevelTableData_ACU(message: any, isolationConfig: IsolationConfig_ACU): boolean {
  if (!message || !isLegacyMatchForIsolation_ACU(message, isolationConfig)) return false;

  return hasAnySheetKey_ACU(message.TavernDB_ACU_IndependentData)
    || hasAnySheetKey_ACU(message.TavernDB_ACU_Data)
    || hasAnySheetKey_ACU(message.TavernDB_ACU_SummaryData)
    || hasNonEmptyStringArray_ACU(message.TavernDB_ACU_ModifiedKeys)
    || hasNonEmptyStringArray_ACU(message.TavernDB_ACU_UpdateGroupKeys);
}

export function resolveTableStorageStrategy_ACU(
  chat: Array<ACUMessage | any> | null | undefined,
  isolationKey: string,
  isolationConfig: IsolationConfig_ACU = { enabled: false, code: '' },
): TableStorageStrategy_ACU {
  if (!Array.isArray(chat) || chat.length === 0) {
    return { mode: 'empty' };
  }

  let hasV2 = false;
  let hasV2Marker = false;
  let hasLegacy = false;
  const legacyReasons = new Set<string>();

  for (let i = 0; i < chat.length; i += 1) {
    const message = chat[i];
    if (!message || message.is_user) continue;

    const tagData = readIsolatedTagData_ACU(message, isolationKey) as any;
    if (tagData) {
      // A malformed/partial V2 slot is still persisted table-history evidence. Treating it as
      // empty would allow callers to enter pristine initialization and reassign stable keys.
      // Downstream replay/commit owns structural validation and must fail closed instead.
      if (hasV2TableHistoryEvidence_ACU(tagData)) hasV2Marker = true;
      if (isV2TagData_ACU(tagData)) {
        hasV2 = true;
      }
      if (isLegacyV1TagData_ACU(tagData)) {
        hasLegacy = true;
        legacyReasons.add(`message#${i}: isolated legacy tag data`);
      }
    }

    if (hasLegacyTopLevelTableData_ACU(message, isolationConfig)) {
      hasLegacy = true;
      legacyReasons.add(`message#${i}: legacy top-level table fields`);
    }
  }

  if (hasLegacy) {
    return {
      mode: 'legacy-v1',
      reason: Array.from(legacyReasons).join('; ') || 'legacy table data detected',
      warning: hasV2 ? 'mixed legacy-v1 and v2 data detected; legacy-v1 wins' : undefined,
    };
  }

  if (hasV2 || hasV2Marker) {
    return { mode: 'v2' };
  }

  return { mode: 'empty' };
}
