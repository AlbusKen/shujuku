/**
 * data/repositories/target-keys-diagnostics.ts — targetKeys 残留只读诊断
 *
 * 只扫描消息中的 ACU V2 storageFrame，报告指定 target sheet 的结构化残留分布。
 * 本模块不修改 msg、不删除字段、不写回 TavernDB_ACU_IsolatedData。
 */
import { safeJsonParse_ACU } from '../../shared/json-helpers';
import { readIsolatedTagData_ACU } from './chat-message-data-repo';

const RUNTIME_REVISION_SNAPSHOT_PREFIX_V2_ACU = 'runtime-v1:';
const MAX_SUBSTRING_ONLY_PATHS_ACU = 8;
export const MAX_CHECKPOINT_RISK_DETAILS_ACU = 8;

export interface TargetKeysCheckpointDataRisk_ACU {
    messageIndex: number;
    tagKey: string;
    targetKey: string;
    reason?: string;
    createdAt?: number;
    kind?: 'full' | 'sheet_full';
}

export interface TargetKeysResidueReport_ACU {
    isolationKeyMatched: boolean;
    entryCount: number;
    matchingEntries: number[];
    exactHits: number;
    runtimeV1Hits: number;
    substringOnlyPaths: string[];
    checkpointDataRisk: boolean;
    checkpointDataRisks: TargetKeysCheckpointDataRisk_ACU[];
    scheduleSummaryRisk: boolean;
}

function createEmptyReport_ACU(): TargetKeysResidueReport_ACU {
    return {
        isolationKeyMatched: false,
        entryCount: 0,
        matchingEntries: [],
        exactHits: 0,
        runtimeV1Hits: 0,
        substringOnlyPaths: [],
        checkpointDataRisk: false,
        checkpointDataRisks: [],
        scheduleSummaryRisk: false,
    };
}

function isObjectRecord_ACU(value: any): value is Record<string, any> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function recordSubstringPath_ACU(report: TargetKeysResidueReport_ACU, path: string): void {
    if (report.substringOnlyPaths.length >= MAX_SUBSTRING_ONLY_PATHS_ACU) return;
    report.substringOnlyPaths.push(path);
}

function hasTargetKey_ACU(record: any, targetKeys: Set<string>): boolean {
    return isObjectRecord_ACU(record) && Array.from(targetKeys).some(key => Object.prototype.hasOwnProperty.call(record, key));
}

function collectCheckpointDataRisks_ACU(checkpoint: Record<string, any>, targetKeys: Set<string>, tagKey: string, messageIndex: number): TargetKeysCheckpointDataRisk_ACU[] {
    const data = checkpoint.data;
    if (!isObjectRecord_ACU(data)) return [];
    const reason = typeof checkpoint.reason === 'string' ? checkpoint.reason : undefined;
    const createdAt = typeof checkpoint.createdAt === 'number' ? checkpoint.createdAt : undefined;
    const risks: TargetKeysCheckpointDataRisk_ACU[] = [];
    targetKeys.forEach(targetKey => {
        if (!Object.prototype.hasOwnProperty.call(data, targetKey)) return;
        const risk: TargetKeysCheckpointDataRisk_ACU = { messageIndex, tagKey, targetKey };
        if (reason !== undefined) risk.reason = reason;
        if (createdAt !== undefined) risk.createdAt = createdAt;
        risks.push(risk);
    });
    return risks;
}

function countTargetKeysInRecord_ACU(record: any, targetKeys: Set<string>): number {
    if (!isObjectRecord_ACU(record)) return 0;
    let count = 0;
    targetKeys.forEach(key => {
        if (Object.prototype.hasOwnProperty.call(record, key)) count++;
    });
    return count;
}

function countTargetKeysInArray_ACU(value: any, targetKeys: Set<string>): number {
    if (!Array.isArray(value)) return 0;
    return value.filter(item => typeof item === 'string' && targetKeys.has(item)).length;
}

function scanRevision_ACU(value: any, targetKeys: Set<string>): number {
    if (typeof value !== 'string' || !value.startsWith(RUNTIME_REVISION_SNAPSHOT_PREFIX_V2_ACU)) return 0;
    const snapshot = safeJsonParse_ACU(value.slice(RUNTIME_REVISION_SNAPSHOT_PREFIX_V2_ACU.length), null);
    if (!isObjectRecord_ACU(snapshot) || !isObjectRecord_ACU(snapshot.sheets)) return 0;
    return countTargetKeysInRecord_ACU(snapshot.sheets, targetKeys);
}


function scanEventLike_ACU(value: any, targetKeys: Set<string>): number {
    if (!isObjectRecord_ACU(value)) return 0;
    return countTargetKeysInArray_ACU(value.filledSheetKeys, targetKeys)
        + countTargetKeysInArray_ACU(value.changedSheetKeys, targetKeys)
        + countTargetKeysInArray_ACU(value.groupKeys, targetKeys);
}

function scanOperations_ACU(value: any, targetKeys: Set<string>): number {
    if (!Array.isArray(value)) return 0;
    let hits = 0;
    value.forEach(operation => {
        if (!isObjectRecord_ACU(operation)) return;
        if (typeof operation.sheetKey === 'string' && targetKeys.has(operation.sheetKey)) hits++;
        if (operation.kind === 'data_replace') {
            hits += countTargetKeysInRecord_ACU(operation.data, targetKeys);
        }
    });
    return hits;
}

function scanPatches_ACU(value: any, targetKeys: Set<string>): number {
    if (!Array.isArray(value)) return 0;
    return value.filter(patch => isObjectRecord_ACU(patch) && typeof patch.sheetKey === 'string' && targetKeys.has(patch.sheetKey)).length;
}

function scanWriteSet_ACU(value: any, targetKeys: Set<string>): number {
    if (!Array.isArray(value)) return 0;
    return value.filter(unit => isObjectRecord_ACU(unit) && unit.kind !== 'all' && typeof unit.sheetKey === 'string' && targetKeys.has(unit.sheetKey)).length;
}

function scanManualRefillProgress_ACU(value: any, targetKeys: Set<string>): number {
    if (!isObjectRecord_ACU(value)) return 0;
    return countTargetKeysInArray_ACU(value.selectedSheetKeys, targetKeys)
        + countTargetKeysInRecord_ACU(value.completedSheetMessageIndexByKey, targetKeys);
}

function scanSubstringOnlyPaths_ACU(value: any, targetKeys: Set<string>, path: string, report: TargetKeysResidueReport_ACU): void {
    if (report.substringOnlyPaths.length >= MAX_SUBSTRING_ONLY_PATHS_ACU) return;
    if (typeof value === 'string') {
        if (value.startsWith(RUNTIME_REVISION_SNAPSHOT_PREFIX_V2_ACU)) return;
        if (Array.from(targetKeys).some(key => value.includes(key))) recordSubstringPath_ACU(report, path);
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((item, index) => scanSubstringOnlyPaths_ACU(item, targetKeys, `${path}[${index}]`, report));
        return;
    }
    if (!isObjectRecord_ACU(value)) return;
    Object.entries(value).forEach(([key, child]) => {
        if (key === 'baseRevision' || key === 'parentRevision' || key === 'sheetKey'
            || key === 'filledSheetKeys' || key === 'changedSheetKeys' || key === 'groupKeys'
            || key === 'selectedSheetKeys' || key === 'writeSet') return;
        scanSubstringOnlyPaths_ACU(child, targetKeys, path ? `${path}.${key}` : key, report);
    });
}

/**
 * 只读扫描指定消息中 targetSheetKeys 的 V2 残留分布。
 *
 * 不修改 msg，不删除字段，不写回 TavernDB_ACU_IsolatedData。
 */
export function scanTargetKeysResidue_ACU(msg: any, isolationKey: string, targetSheetKeys: string[] | null | undefined, messageIndex = -1): TargetKeysResidueReport_ACU {
    const report = createEmptyReport_ACU();
    if (!Array.isArray(targetSheetKeys) || targetSheetKeys.length === 0) return report;
    const targetKeys = new Set(targetSheetKeys.filter(key => typeof key === 'string' && key.length > 0));
    if (targetKeys.size === 0) return report;

    const tagData = readIsolatedTagData_ACU(msg, isolationKey || '');
    if (!tagData) return report;
    report.isolationKeyMatched = true;

    const frame = (tagData as any).storageFrame;
    if (!isObjectRecord_ACU(frame)) return report;

    const checkpoint = frame.checkpoint;
    if (isObjectRecord_ACU(checkpoint)) {
        report.checkpointDataRisk = hasTargetKey_ACU(checkpoint.data, targetKeys);
        report.scheduleSummaryRisk = hasTargetKey_ACU(checkpoint.scheduleSummary, targetKeys);
        report.checkpointDataRisks = collectCheckpointDataRisks_ACU(checkpoint, targetKeys, isolationKey || '', messageIndex);
        report.exactHits += scanEventLike_ACU(checkpoint.event, targetKeys);
        report.exactHits += scanManualRefillProgress_ACU(checkpoint.manualRefillProgress, targetKeys);
    }

    const sheetCheckpoints: Array<{ targetKey: string; checkpoint: any }> = [];
    if (isObjectRecord_ACU(frame.perSheetCheckpoints)) {
        Object.entries(frame.perSheetCheckpoints).forEach(([targetKey, checkpoint]) => sheetCheckpoints.push({ targetKey, checkpoint }));
    }
    if (Array.isArray(frame.sheetTimelineEvents)) {
        frame.sheetTimelineEvents.forEach(event => {
            if (isObjectRecord_ACU(event?.checkpoint)) sheetCheckpoints.push({ targetKey: event.checkpoint.sheetKey, checkpoint: event.checkpoint });
        });
    }
    sheetCheckpoints.forEach(({ targetKey, checkpoint: sheetCheckpoint }) => {
        if (!targetKeys.has(targetKey) || !isObjectRecord_ACU(sheetCheckpoint) || sheetCheckpoint.kind !== 'sheet_full') return;
        report.checkpointDataRisk = true;
        if (isObjectRecord_ACU(sheetCheckpoint.scheduleSummary)) report.scheduleSummaryRisk = true;
        const risk: TargetKeysCheckpointDataRisk_ACU = {
            messageIndex,
            tagKey: isolationKey || '',
            targetKey,
            kind: 'sheet_full',
        };
        if (typeof sheetCheckpoint.reason === 'string') risk.reason = sheetCheckpoint.reason;
        if (typeof sheetCheckpoint.createdAt === 'number') risk.createdAt = sheetCheckpoint.createdAt;
        report.checkpointDataRisks.push(risk);
        report.exactHits += scanEventLike_ACU(sheetCheckpoint.event, targetKeys);
        report.exactHits += scanManualRefillProgress_ACU(sheetCheckpoint.manualRefillProgress, targetKeys);
    });

    report.exactHits += scanManualRefillProgress_ACU(frame.manualRefillProgress, targetKeys);

    const entries = Array.isArray(frame.logEntries) ? frame.logEntries : [];
    report.entryCount = entries.length;
    entries.forEach((entry, index) => {
        if (!isObjectRecord_ACU(entry)) return;
        const exactHits = scanEventLike_ACU(entry, targetKeys)
            + scanEventLike_ACU(entry.event, targetKeys)
            + scanOperations_ACU(entry.operations, targetKeys)
            + scanPatches_ACU(entry.patches, targetKeys)
            + scanWriteSet_ACU(entry.writeSet, targetKeys)
            + scanManualRefillProgress_ACU(entry.manualRefillProgress, targetKeys);
        const runtimeV1Hits = scanRevision_ACU(entry.baseRevision, targetKeys)
            + scanRevision_ACU(entry.parentRevision, targetKeys);
        if (exactHits > 0 || runtimeV1Hits > 0) {
            report.matchingEntries.push(typeof entry.seq === 'number' ? entry.seq : index);
        }
        report.exactHits += exactHits;
        report.runtimeV1Hits += runtimeV1Hits;
        scanSubstringOnlyPaths_ACU(entry, targetKeys, `logEntries[${index}]`, report);
    });

    return report;
}
