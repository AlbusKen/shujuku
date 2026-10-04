import type { ACUMessage } from '../../shared/host-api';
import { hasAnyTableData_ACU, readIsolatedTagData_ACU } from '../../data/repositories/chat-message-data-repo';
import { isV2TagData_ACU } from './storage-strategy-resolver';
import { getV2ImportBaselineAiFloor_ACU } from './table-import-baseline';

export interface TableHistoryState_ACU {
    latestAiMessageIndex: number;
    latestDataMessageIndex: number;
    lastTrackedUpdateMessageIndex: number;
    latestDataAiFloor: number;
    lastTrackedUpdateAiFloor: number;
    /** 导入快照覆盖的楼层，与实际填表完成记录分开。 */
    lastImportBaselineAiFloor: number;
    /** 自动填表与追平共用的已覆盖前沿。 */
    lastCompletedAiFloor: number;
    hasAnyData: boolean;
    hasTrackedUpdate: boolean;
}

export interface TableCheckpointFloor_ACU {
    messageIndex: number;
    aiFloor: number;
    reason?: string;
    createdAt?: number;
}

interface ResolveTableHistoryOptions_ACU {
    sheetKey: string;
    isSummaryTable: boolean;
    isolationKey: string;
    settings: any;
}

interface MutableTableHistoryState_ACU {
    latestDataMessageIndex: number;
    lastTrackedUpdateMessageIndex: number;
    lastTrackedUpdateAiFloor: number;
}

function isLegacyMatchForMessage_ACU(msg: any, settings: any): boolean {
    const msgIdentity = msg?.TavernDB_ACU_Identity;
    if (settings?.dataIsolationEnabled) {
        return msgIdentity === settings.dataIsolationCode;
    }
    return !msgIdentity;
}

function keyListHasSheet_ACU(value: unknown, sheetKey: string): boolean {
    return Array.isArray(value) && value.includes(sheetKey);
}

function v2EventTouchesSheetData_ACU(event: any, sheetKey: string): boolean {
    return keyListHasSheet_ACU(event?.changedSheetKeys, sheetKey)
        || keyListHasSheet_ACU(event?.filledSheetKeys, sheetKey)
        || keyListHasSheet_ACU(event?.groupKeys, sheetKey);
}

function v2EventTracksFill_ACU(event: any, sheetKey: string): boolean {
    return keyListHasSheet_ACU(event?.filledSheetKeys, sheetKey)
        || keyListHasSheet_ACU(event?.groupKeys, sheetKey);
}

function v2ScheduleFilledFloor_ACU(tagData: any, sheetKey: string): number {
    const fullValue = tagData?.storageFrame?.checkpoint?.scheduleSummary?.[sheetKey]?.lastFilledAiFloor;
    const sheetValue = tagData?.storageFrame?.perSheetCheckpoints?.[sheetKey]?.scheduleSummary?.lastFilledAiFloor;
    const fullFloor = Number.isFinite(fullValue) && fullValue > 0 ? Number(fullValue) : 0;
    const sheetFloor = Number.isFinite(sheetValue) && sheetValue > 0 ? Number(sheetValue) : 0;
    return Math.max(fullFloor, sheetFloor);
}

function v2EntryAiFloor_ACU(entry: any, fallbackAiFloor: number): number {
    const value = Number(entry?.aiFloor);
    return Number.isFinite(value) && value > 0 ? value : fallbackAiFloor;
}

/**
 * 判断 V2 operation 是否可能修改某个 sheet。
 *
 * sql_batch 和 table_edit_dsl 缺少可靠的 sheet 归属信息。对于保存路由，
 * 将其视为命中所有 sheet，宁可把新增量追加到更晚层，也不能插到未知 SQL 前面。
 */
export function v2OperationTouchesSheet_ACU(operation: any, sheetKey: string): boolean {
    if (!operation || typeof operation !== 'object') return false;
    if (operation.kind === 'sheet_replace') return operation.sheetKey === sheetKey;
    if (operation.kind === 'sheet_schema_migrate') return operation.sheetKey === sheetKey;
    if (operation.kind === 'row_upsert' || operation.kind === 'row_delete' || operation.kind === 'meta_update') return operation.sheetKey === sheetKey;
    if (operation.kind === 'data_replace') return !!operation.data?.[sheetKey];
    if (operation.kind === 'sql_sheet_batch') return operation.sheetKey === sheetKey;
    return operation.kind === 'sql_batch' || operation.kind === 'table_edit_dsl';
}

function v2EntryTouchesSheet_ACU(entry: any, sheetKey: string): boolean {
    return v2EventTouchesSheetData_ACU(entry, sheetKey)
        || (Array.isArray(entry?.operations) && entry.operations.some((operation: any) => v2OperationTouchesSheet_ACU(operation, sheetKey)))
        || (Array.isArray(entry?.patches) && entry.patches.some((patch: any) => patch?.sheetKey === sheetKey));
}

/** 返回当前 replay anchor（最新 full checkpoint）所在消息层，没有则返回 -1。 */
export function getLatestV2FullCheckpointMessageIndex_ACU(chat: ACUMessage[] | any[], isolationKey: string): number {
    if (!Array.isArray(chat)) return -1;
    for (let index = chat.length - 1; index >= 0; index -= 1) {
        const tagData = readIsolatedTagData_ACU(chat[index], isolationKey) as any;
        if (isV2TagData_ACU(tagData) && tagData.storageFrame.checkpoint?.kind === 'full') return index;
    }
    return -1;
}

/**
 * 返回某个 sheet 在当前 replay 区间最后一次拥有显式增量/单表 checkpoint 的消息层。
 * full checkpoint 是基底而不是增量记录，因此不会作为返回值；调用方据此决定追加日志或直接更新基底。
 */
export function getLatestV2SheetReplayMessageIndex_ACU(chat: ACUMessage[] | any[], isolationKey: string, sheetKey: string): number {
    const checkpointIndex = getLatestV2FullCheckpointMessageIndex_ACU(chat, isolationKey);
    if (checkpointIndex < 0 || !sheetKey.startsWith('sheet_')) return -1;
    for (let index = chat.length - 1; index >= checkpointIndex; index -= 1) {
        const tagData = readIsolatedTagData_ACU(chat[index], isolationKey) as any;
        if (!isV2TagData_ACU(tagData)) continue;
        const frame = tagData.storageFrame;
        if (frame.perSheetCheckpoints?.[sheetKey]?.kind === 'sheet_full') return index;
        if ((frame.logEntries || []).some((entry: any) => v2EntryTouchesSheet_ACU(entry, sheetKey))) return index;
    }
    return -1;
}

function v2FrameHasSheetData_ACU(tagData: any, sheetKey: string): boolean {
    if (!isV2TagData_ACU(tagData)) return false;
    if (tagData.storageFrame.checkpoint?.kind === 'full' && tagData.storageFrame.checkpoint.data?.[sheetKey]) {
        return true;
    }
    if (tagData.storageFrame.perSheetCheckpoints?.[sheetKey]?.kind === 'sheet_full') {
        return true;
    }
    return (tagData.storageFrame.logEntries || []).some((entry: any) => v2EntryTouchesSheet_ACU(entry, sheetKey));
}

function v2FrameTrackedUpdateFloor_ACU(tagData: any, sheetKey: string, messageAiFloor: number): number {
    if (!isV2TagData_ACU(tagData)) return 0;
    let latestFloor = v2ScheduleFilledFloor_ACU(tagData, sheetKey);
    const checkpointEvent = tagData.storageFrame.checkpoint?.event;
    if (v2EventTracksFill_ACU(checkpointEvent, sheetKey)) {
        latestFloor = Math.max(latestFloor, messageAiFloor);
    }
    const sheetCheckpointEvent = tagData.storageFrame.perSheetCheckpoints?.[sheetKey]?.event;
    if (v2EventTracksFill_ACU(sheetCheckpointEvent, sheetKey)) {
        latestFloor = Math.max(latestFloor, messageAiFloor);
    }
    for (const entry of tagData.storageFrame.logEntries || []) {
        if (v2EventTracksFill_ACU(entry, sheetKey)) {
            latestFloor = Math.max(latestFloor, v2EntryAiFloor_ACU(entry, messageAiFloor));
        }
    }
    return latestFloor;
}

function hasTableDataInMessage_ACU(msg: any, options: ResolveTableHistoryOptions_ACU): boolean {
    const { sheetKey, isSummaryTable, isolationKey, settings } = options;
    const tagData = readIsolatedTagData_ACU(msg, isolationKey) as any;

    if (v2FrameHasSheetData_ACU(tagData, sheetKey)) {
        return true;
    }

    if (tagData?.independentData?.[sheetKey]) {
        return true;
    }

    if (!isLegacyMatchForMessage_ACU(msg, settings)) {
        return false;
    }

    return !!(
        msg?.TavernDB_ACU_IndependentData?.[sheetKey]
        || (isSummaryTable
            ? msg?.TavernDB_ACU_SummaryData?.[sheetKey]
            : msg?.TavernDB_ACU_Data?.[sheetKey])
    );
}

function getTrackedUpdateFloorInMessage_ACU(msg: any, options: ResolveTableHistoryOptions_ACU, messageAiFloor: number): number {
    const { sheetKey, isolationKey, settings } = options;
    const tagData = readIsolatedTagData_ACU(msg, isolationKey) as any;

    const v2Floor = v2FrameTrackedUpdateFloor_ACU(tagData, sheetKey, messageAiFloor);
    if (v2Floor > 0) {
        return v2Floor;
    }

    const isolatedModifiedKeys = Array.isArray(tagData?.modifiedKeys) ? tagData.modifiedKeys : [];
    const isolatedUpdateGroupKeys = Array.isArray(tagData?.updateGroupKeys) ? tagData.updateGroupKeys : [];

    if (isolatedUpdateGroupKeys.includes(sheetKey) || isolatedModifiedKeys.includes(sheetKey)) {
        return messageAiFloor;
    }

    if (!isLegacyMatchForMessage_ACU(msg, settings)) {
        return 0;
    }

    const legacyModifiedKeys = Array.isArray(msg?.TavernDB_ACU_ModifiedKeys) ? msg.TavernDB_ACU_ModifiedKeys : [];
    const legacyUpdateGroupKeys = Array.isArray(msg?.TavernDB_ACU_UpdateGroupKeys) ? msg.TavernDB_ACU_UpdateGroupKeys : [];
    return legacyUpdateGroupKeys.includes(sheetKey) || legacyModifiedKeys.includes(sheetKey) ? messageAiFloor : 0;
}

export function getLatestAiMessageIndexFromChat_ACU(chat: ACUMessage[] | any[]): number {
    if (!Array.isArray(chat)) return -1;
    for (let i = chat.length - 1; i >= 0; i -= 1) {
        if (chat[i] && !chat[i].is_user) return i;
    }
    return -1;
}

function hasAppendableTableDataFrame_ACU(msg: any, isolationKey: string, settings: any): boolean {
    const tagData = readIsolatedTagData_ACU(msg, isolationKey) as any;
    if (isV2TagData_ACU(tagData) && tagData.storageFrame) return true;
    return hasAnyTableData_ACU(msg, isolationKey, {
        enabled: !!settings?.dataIsolationEnabled,
        code: String(settings?.dataIsolationCode || ''),
    });
}

export function getLatestTableAppendMessageIndexFromChat_ACU(
    chat: ACUMessage[] | any[],
    isolationKey: string,
    settings: any,
): number {
    if (!Array.isArray(chat)) return -1;
    const latestAiMessageIndex = getLatestAiMessageIndexFromChat_ACU(chat);
    for (let i = chat.length - 1; i >= 0; i -= 1) {
        const msg = chat[i];
        if (!msg || msg.is_user) continue;
        if (hasAppendableTableDataFrame_ACU(msg, isolationKey, settings)) return i;
    }
    return latestAiMessageIndex;
}

export function countAiMessagesUpToIndex_ACU(chat: ACUMessage[] | any[], messageIndex: number): number {
    if (!Array.isArray(chat) || messageIndex < 0) return 0;
    let count = 0;
    for (let i = 0; i <= messageIndex && i < chat.length; i += 1) {
        if (chat[i] && !chat[i].is_user) count += 1;
    }
    return count;
}

export function collectV2CheckpointFloorsFromChat_ACU(
    chat: ACUMessage[] | any[] | null | undefined,
    isolationKey: string,
): TableCheckpointFloor_ACU[] {
    if (!Array.isArray(chat)) return [];
    const checkpoints: TableCheckpointFloor_ACU[] = [];
    let aiFloor = 0;
    for (let i = 0; i < chat.length; i += 1) {
        const msg = chat[i];
        if (!msg || msg.is_user) continue;
        aiFloor += 1;
        const tagData = readIsolatedTagData_ACU(msg, isolationKey) as any;
        if (!isV2TagData_ACU(tagData)) continue;
        const checkpoint = tagData.storageFrame.checkpoint;
        if (checkpoint?.kind !== 'full') continue;
        checkpoints.push({
            messageIndex: i,
            aiFloor,
            reason: checkpoint.reason,
            createdAt: checkpoint.createdAt,
        });
    }
    return checkpoints;
}

export function resolveTableHistoryStateFromChat_ACU(
    chat: ACUMessage[] | any[],
    options: ResolveTableHistoryOptions_ACU,
): TableHistoryState_ACU {
    return resolveTableHistoryStatesFromChat_ACU(chat, [options]).get(options.sheetKey) || {
        latestAiMessageIndex: getLatestAiMessageIndexFromChat_ACU(chat),
        latestDataMessageIndex: -1,
        lastTrackedUpdateMessageIndex: -1,
        latestDataAiFloor: 0,
        lastTrackedUpdateAiFloor: 0,
        lastImportBaselineAiFloor: 0,
        lastCompletedAiFloor: 0,
        hasAnyData: false,
        hasTrackedUpdate: false,
    };
}

/**
 * 单次扫描聊天记录，批量解析多张表的历史状态。
 *
 * 旧调用路径会为每张表分别逆序扫描聊天，并在扫描中的每个 AI 楼层再次从头计数，
 * 最坏形成 O(sheetCount * messageCount²)。这里先构建 AI 楼层前缀，再用一次逆序扫描
 * 同时解析所有请求，使调度主路径收敛为 O(messageCount * sheetCount)。
 */
export function resolveTableHistoryStatesFromChat_ACU(
    chat: ACUMessage[] | any[],
    optionsList: ResolveTableHistoryOptions_ACU[],
): Map<string, TableHistoryState_ACU> {
    const safeChat = Array.isArray(chat) ? chat : [];
    const uniqueOptions = new Map<string, ResolveTableHistoryOptions_ACU>();
    for (const options of optionsList || []) {
        if (!options?.sheetKey || uniqueOptions.has(options.sheetKey)) continue;
        uniqueOptions.set(options.sheetKey, options);
    }

    const aiFloorByMessageIndex = new Array<number>(safeChat.length).fill(0);
    const importBaselineBySheetKey = new Map<string, number>();
    let aiFloor = 0;
    let latestAiMessageIndex = -1;
    for (let index = 0; index < safeChat.length; index += 1) {
        if (safeChat[index] && !safeChat[index].is_user) {
            aiFloor += 1;
            latestAiMessageIndex = index;
            const tagsByIsolationKey = new Map<string, any>();
            for (const [sheetKey, options] of uniqueOptions) {
                if (!tagsByIsolationKey.has(options.isolationKey)) {
                    tagsByIsolationKey.set(options.isolationKey, readIsolatedTagData_ACU(safeChat[index], options.isolationKey));
                }
                const tagData = tagsByIsolationKey.get(options.isolationKey);
                if (!isV2TagData_ACU(tagData)) continue;
                const baseline = getV2ImportBaselineAiFloor_ACU(tagData.storageFrame, sheetKey, aiFloor);
                importBaselineBySheetKey.set(sheetKey, Math.max(importBaselineBySheetKey.get(sheetKey) || 0, baseline));
            }
        }
        aiFloorByMessageIndex[index] = aiFloor;
    }

    const mutable = new Map<string, MutableTableHistoryState_ACU>();
    for (const sheetKey of uniqueOptions.keys()) {
        mutable.set(sheetKey, {
            latestDataMessageIndex: -1,
            lastTrackedUpdateMessageIndex: -1,
            lastTrackedUpdateAiFloor: 0,
        });
    }

    let unresolvedCount = mutable.size;
    for (let index = safeChat.length - 1; index >= 0 && unresolvedCount > 0; index -= 1) {
        const message = safeChat[index];
        if (!message || message.is_user) continue;
        const messageAiFloor = aiFloorByMessageIndex[index];

        for (const [sheetKey, options] of uniqueOptions) {
            const state = mutable.get(sheetKey)!;
            const wasResolved = state.latestDataMessageIndex !== -1 && state.lastTrackedUpdateMessageIndex !== -1;
            if (wasResolved) continue;

            if (state.latestDataMessageIndex === -1 && hasTableDataInMessage_ACU(message, options)) {
                state.latestDataMessageIndex = index;
            }
            if (state.lastTrackedUpdateMessageIndex === -1) {
                const trackedFloor = getTrackedUpdateFloorInMessage_ACU(message, options, messageAiFloor);
                if (trackedFloor > 0) {
                    state.lastTrackedUpdateMessageIndex = index;
                    state.lastTrackedUpdateAiFloor = trackedFloor;
                }
            }
            if (state.latestDataMessageIndex !== -1 && state.lastTrackedUpdateMessageIndex !== -1) {
                unresolvedCount -= 1;
            }
        }
    }

    const result = new Map<string, TableHistoryState_ACU>();
    for (const [sheetKey, state] of mutable) {
        result.set(sheetKey, {
            latestAiMessageIndex,
            latestDataMessageIndex: state.latestDataMessageIndex,
            lastTrackedUpdateMessageIndex: state.lastTrackedUpdateMessageIndex,
            latestDataAiFloor: state.latestDataMessageIndex >= 0 ? aiFloorByMessageIndex[state.latestDataMessageIndex] : 0,
            lastTrackedUpdateAiFloor: state.lastTrackedUpdateAiFloor,
            lastImportBaselineAiFloor: importBaselineBySheetKey.get(sheetKey) || 0,
            lastCompletedAiFloor: Math.max(state.lastTrackedUpdateAiFloor, importBaselineBySheetKey.get(sheetKey) || 0),
            hasAnyData: state.latestDataMessageIndex !== -1,
            hasTrackedUpdate: state.lastTrackedUpdateAiFloor > 0,
        });
    }
    return result;
}
