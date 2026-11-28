/**
 * service/chat/checkpoint-delete-guard.ts — 删楼 checkpoint 保管库与前移恢复（S0-4）
 *
 * 背景：宿主的 MESSAGE_DELETED 在消息已从 chat 数组 splice 并保存之后才触发。
 * 被删楼层携带的 full checkpoint（回放根）、perSheetCheckpoints（休眠表恢复数据 /
 * 结构 shard）、过渡根在事件到达时已经从数组中消失，冷回放会直接判定"无根 / 休眠
 * 数据丢失"。补救只能依赖删除发生前捕获的影子副本（保管库 vault）。
 *
 * 设计：
 * - vault 按 chatKey 隔离，逐 isolationKey 按楼层序记录每个 V2 frame 的消息对象引用
 *   与不可替代产物的深克隆；log-only 帧只存引用作后继信标（零克隆成本）。
 *   宿主删楼对同一数组 splice，幸存消息对象引用不变——用对象引用判"楼层是否被删"
 *   零误报，无需内容指纹。
 * - 捕获点：聊天加载完成 + 每次插件保存成功后（chat-gateway post-save 监听）。插件
 *   自身的 purge / 清空 / compaction 删楼都以插件保存收尾，保存同步会以当前聊天为
 *   权威重建 vault，因此插件侧的删除天然不会被本模块复活（防"删了重生"语义保持）。
 * - 恢复点：MESSAGE_DELETED 调度轮开头（冷回放之前）。丢失产物嫁接到其原位置之后
 *   第一个幸存 frame 楼层：帧内 checkpoint 先于 logEntries 回放，嫁接后顺序与原
 *   语义完全一致；被删楼层自身的 logEntries 不恢复（删楼 = 撤销该楼编辑）。
 *
 * 残余竞态（接受并记录）：删楼后调度防抖窗口（1.2s）内若插件恰好完成一次保存，
 * post-save 同步会先丢弃待恢复产物。生成 / 填表落盘耗时远大于该窗口，实际不可达。
 */
import {
    getChatArray_ACU,
    registerPostChatSaveListener_ACU,
    saveChatToHostStrict_ACU,
} from '../../data/gateways/chat-gateway';
import { readIsolatedDataContainer_ACU, readIsolatedTagData_ACU } from '../../data/repositories/chat-message-data-repo';
import { readDeletedReplyRollback_ACU } from '../table/native-swipe-table';
import { isV2TagData_ACU } from '../table/storage-strategy-resolver';
import { assertSingleActiveFullCheckpointV2_ACU } from '../table/storage-frame-v2-persist';
import {
  assertMaterialContinuationCheckpoint_ACU,
  assertMaterialSimulationCheckpoint_ACU,
  captureMaterialCheckpointRecovery_ACU,
  graftMaterialContinuationCheckpoint_ACU,
  graftMaterialSimulationCheckpoint_ACU,
  restoreMaterialCheckpointFields_ACU,
  snapshotMaterialCheckpointFields_ACU,
} from './material-checkpoint-sync';
import { runTableWriteTransaction_ACU } from '../table/table-write-transaction';
import { currentChatFileIdentifier_ACU, getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import { logDebug_ACU, logError_ACU, logWarn_ACU } from '../../shared/utils';
import { appendFrameSheetTimelineEvents_ACU, getLatestFrameSheetCheckpoint_ACU, getOrderedFrameSheetCheckpointRecords_ACU } from '../table/storage-frame-v2-sheet-events';
import type {
    TableCheckpointScheduleSummaryV2_ACU,
    TableCheckpointV2_ACU,
    TableSheetTimelineEventV2_ACU,
    TableSheetCheckpointV2_ACU,
    TableStorageFrameV2_ACU,
} from '../table/storage-frame-v2-types';

interface CheckpointVaultFrameEntry_ACU {
    /** 幸存判定锚：宿主 splice 不改变幸存消息的对象引用。 */
    messageRef: any;
    fullCheckpoint: TableCheckpointV2_ACU | null;
    perSheetCheckpoints: Record<string, TableSheetCheckpointV2_ACU> | null;
    sheetTimelineEvents: TableSheetTimelineEventV2_ACU[];
    summaryVectorCheckpoint: {
        sourceTableKey: string;
        checkpoint: import('../table/storage-frame-v2-types').SummaryVectorIndexMirrorCheckpointV2_ACU;
    } | null;
    spv79TransitionCheckpoint: any | null;
    compatTransitionCheckpoint: any | null;
}

interface MaterialCheckpointVaultEntry_ACU {
    messageRef: any;
    continuation: { swipeId: string; snapshot: unknown } | null;
    simulation: { anchor: unknown; ledger: unknown } | null;
}

interface CheckpointVaultState_ACU {
    chatKey: string;
    messageIndices: Map<any, number>;
    /** isolationKey → 按楼层序的 frame 条目（含 log-only 信标）。 */
    entriesByIsolationKey: Map<string, CheckpointVaultFrameEntry_ACU[]>;
    /** 续写/推演基线，按楼层序。与表格产物同一轮嫁接。 */
    materialEntries: MaterialCheckpointVaultEntry_ACU[];
}

export interface CheckpointDeleteRecoveryResult_ACU {
    /** 本轮是否执行了嫁接写入。 */
    recovered: boolean;
    /** 成功嫁接的产物数（full=1、每个 per-sheet checkpoint=1、每个过渡根=1）。 */
    graftedCount: number;
    error?: string;
}

let vault_ACU: CheckpointVaultState_ACU | null = null;
let installed_ACU = false;

function deepClone_ACU<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function hasEntries_ACU(record: Record<string, unknown> | null | undefined): boolean {
    return !!record && typeof record === 'object' && !Array.isArray(record) && Object.keys(record).length > 0;
}

function entryHasArtifacts_ACU(entry: CheckpointVaultFrameEntry_ACU): boolean {
    return !!entry.fullCheckpoint
        || hasEntries_ACU(entry.perSheetCheckpoints)
        || entry.sheetTimelineEvents.length > 0
        || !!entry.summaryVectorCheckpoint
        || !!entry.spv79TransitionCheckpoint
        || !!entry.compatTransitionCheckpoint;
}

function captureFrameEntry_ACU(message: any, tagData: unknown): CheckpointVaultFrameEntry_ACU | null {
    if (!tagData || typeof tagData !== 'object') return null;
    const frame = isV2TagData_ACU(tagData) ? tagData.storageFrame : null;
    const spv79 = (tagData as any).spv79TransitionCheckpoint;
    const compat = (tagData as any).compatTransitionCheckpoint;
    const spv79TransitionCheckpoint = spv79?.kind === 'spv79_duplicate_row_id_transition' ? deepClone_ACU(spv79) : null;
    const compatTransitionCheckpoint = compat?.kind === 'compat_replay_transition' ? deepClone_ACU(compat) : null;
    if (!frame && !spv79TransitionCheckpoint && !compatTransitionCheckpoint) return null;
    return {
        messageRef: message,
        fullCheckpoint: frame?.checkpoint?.kind === 'full' ? deepClone_ACU(frame.checkpoint) : null,
        perSheetCheckpoints: frame && hasEntries_ACU(frame.perSheetCheckpoints) ? deepClone_ACU(frame.perSheetCheckpoints!) : null,
        sheetTimelineEvents: frame?.sheetTimelineEvents ? deepClone_ACU(frame.sheetTimelineEvents) : [],
        summaryVectorCheckpoint: frame?.summaryVectorIndexFrame?.checkpoint?.kind === 'vector_full'
            ? { sourceTableKey: String(frame.summaryVectorIndexFrame.sourceTableKey || ''),
                checkpoint: deepClone_ACU(frame.summaryVectorIndexFrame.checkpoint) }
            : null,
        spv79TransitionCheckpoint,
        compatTransitionCheckpoint,
    };
}

/**
 * 以当前聊天为权威重建保管库。
 * 调用时机：聊天加载完成、插件保存成功后、恢复嫁接成功后。
 */
export function captureCheckpointVaultForCurrentChat_ACU(chatArg?: any[]): void {
    const chat = Array.isArray(chatArg) ? chatArg : getChatArray_ACU();
    const chatKey = String(currentChatFileIdentifier_ACU || '');
    const entriesByIsolationKey = new Map<string, CheckpointVaultFrameEntry_ACU[]>();
    const materialEntries: MaterialCheckpointVaultEntry_ACU[] = [];

    for (const message of chat) {
        if (!message || message.is_user) continue;
        const container = readIsolatedDataContainer_ACU(message);
        if (!container) continue;
        for (const [isolationKey, tagData] of Object.entries(container)) {
            const entry = captureFrameEntry_ACU(message, tagData);
            if (!entry) continue;
            const entries = entriesByIsolationKey.get(isolationKey) || [];
            entries.push(entry);
            entriesByIsolationKey.set(isolationKey, entries);
        }
    }

    for (const message of chat) {
        if (!message || message.is_user) continue;
        const captured = captureMaterialCheckpointRecovery_ACU(message);
        const continuation = captured?.continuation ?? null;
        const simulation = captured?.simulation ?? null;
        if (!continuation && !simulation) continue;
        materialEntries.push({ messageRef: message, continuation, simulation });
    }

    vault_ACU = { chatKey, messageIndices: new Map(chat.map((message, index) => [message, index])), entriesByIsolationKey, materialEntries };
}

/** 切聊 / 测试清理。 */
export function resetCheckpointVault_ACU(): void {
    vault_ACU = null;
}

/** 注册 post-save 捕获监听。幂等，重复调用只注册一次。 */
export function installCheckpointDeleteGuard_ACU(): void {
    if (installed_ACU) return;
    installed_ACU = true;
    registerPostChatSaveListener_ACU(() => {
        try {
            captureCheckpointVaultForCurrentChat_ACU();
        } catch (error: any) {
            logWarn_ACU('[删楼守卫] post-save 保管库同步失败:', error?.message || error);
        }
    });
}

function ensureTargetFrame_ACU(message: any, isolationKey: string): TableStorageFrameV2_ACU {
    if (!message.TavernDB_ACU_IsolatedData
        || typeof message.TavernDB_ACU_IsolatedData !== 'object'
        || Array.isArray(message.TavernDB_ACU_IsolatedData)) {
        message.TavernDB_ACU_IsolatedData = {};
    }
    const container = message.TavernDB_ACU_IsolatedData;
    if (!container[isolationKey] || typeof container[isolationKey] !== 'object') {
        container[isolationKey] = {};
    }
    const tagData = container[isolationKey];
    if (!isV2TagData_ACU(tagData)) {
        tagData.storageFrame = { version: 2, logEntries: [] } satisfies TableStorageFrameV2_ACU;
        tagData._acu_storage_version = 2;
    }
    return tagData.storageFrame;
}

interface GraftPlanItem_ACU {
    entry: CheckpointVaultFrameEntry_ACU;
    isolationKey: string;
    /** vault 序列中的原始位置（用于找后继）。 */
    vaultIndex: number;
}

function findGraftTargetMessage_ACU(
    chat: any[],
    presentMessages: Set<any>,
    entries: CheckpointVaultFrameEntry_ACU[],
    lostIndex: number,
    isolationKey: string,
): { message: any; absorbedEarlierFrame: boolean } | null {
    // 首选：原位置之后第一个幸存且仍携带 V2 frame 的楼层——帧内 checkpoint 先于
    // logEntries 回放，落在后继帧上顺序与删除前完全一致。
    for (let i = lostIndex + 1; i < entries.length; i += 1) {
        const candidate = entries[i];
        if (!presentMessages.has(candidate.messageRef)) continue;
        const tagData = readIsolatedTagData_ACU(candidate.messageRef, isolationKey);
        if (isV2TagData_ACU(tagData)) {
            return { message: candidate.messageRef, absorbedEarlierFrame: false };
        }
    }
    // 无后继帧：落到聊天最后一个 AI 楼层。若该楼层携带的是更早的 frame，其 logs
    // 已被丢失 checkpoint 的 data 吸收（checkpoint 写于其后），由调用方清空并警告。
    for (let i = chat.length - 1; i >= 0; i -= 1) {
        const message = chat[i];
        if (!message || message.is_user) continue;
        const tagData = readIsolatedTagData_ACU(message, isolationKey);
        const hasEarlierFrame = isV2TagData_ACU(tagData) && tagData.storageFrame.logEntries.length > 0;
        return { message, absorbedEarlierFrame: hasEarlierFrame };
    }
    return null;
}

function countAiFloorAtMessageIndex_ACU(chat: any[], messageIndex: number): number {
    let aiFloor = 0;
    for (let i = 0; i <= messageIndex && i < chat.length; i += 1) {
        if (chat[i] && !chat[i].is_user) aiFloor += 1;
    }
    return aiFloor;
}

function clampScheduleSummaryEntryToAiFloor_ACU(
    summary: TableCheckpointScheduleSummaryV2_ACU | undefined,
    maxAiFloor: number,
): TableCheckpointScheduleSummaryV2_ACU | undefined {
    if (!summary || typeof summary !== 'object') return summary;
    let changed = false;
    const next: TableCheckpointScheduleSummaryV2_ACU = { ...summary };
    for (const field of ['lastFilledAiFloor', 'lastChangedAiFloor', 'lastImportBaselineAiFloor'] as const) {
        const value = next[field];
        if (Number.isFinite(value) && Number(value) > maxAiFloor) {
            if (maxAiFloor > 0) next[field] = maxAiFloor;
            else delete next[field];
            changed = true;
        }
    }
    return changed ? next : summary;
}

function clampFullCheckpointScheduleSummary_ACU(
    checkpoint: TableCheckpointV2_ACU,
    maxAiFloor: number,
): TableCheckpointV2_ACU {
    if (!checkpoint.scheduleSummary || typeof checkpoint.scheduleSummary !== 'object') return checkpoint;
    let anyChanged = false;
    const nextMap: Record<string, TableCheckpointScheduleSummaryV2_ACU> = {};
    for (const [sheetKey, entry] of Object.entries(checkpoint.scheduleSummary)) {
        const clamped = clampScheduleSummaryEntryToAiFloor_ACU(entry, maxAiFloor);
        if (clamped !== entry) anyChanged = true;
        if (clamped && Object.keys(clamped).length > 0) nextMap[sheetKey] = clamped;
    }
    if (!anyChanged) return checkpoint;
    return { ...checkpoint, scheduleSummary: nextMap };
}

/**
 * 判断被删楼层的 full checkpoint 是否允许向目标楼层嫁接。
 * 前移（目标在被删楼之后）：维持 S0-4 语义，保护后续增量回放根。
 * 回退（删末尾楼，所有幸存 AI 楼都早于被删楼）：
 * - init / manual 属于该被删楼自身的首次建根或手动重填临时根，不能回退嫁接到更早的开场白/旧楼，
 *   否则删楼后被删楼填写的数据与填表进度会残留到更早楼层，且重生成该楼不会重新填表。
 * - compaction / migration 等压缩边界仍可回退兜底（避免更早的增量帧失根），
 *   同时会将其 scheduleSummary 截断到幸存目标楼层的 AI 楼层号以内。
 */
function shouldGraftFullCheckpoint_ACU(
    checkpoint: TableCheckpointV2_ACU,
    isBackwardGraft: boolean,
): boolean {
    if (!isBackwardGraft) return true;
    return checkpoint.reason !== 'init' && checkpoint.reason !== 'manual';
}

/**
 * 判断被删楼层的单表 checkpoint 是否允许向目标楼层嫁接。
 * 删末尾楼（回退嫁接）时，manual 与 sheet_rebase 快照记录的是被删楼层完成后的表快照及
 * lastFilledAiFloor，若回退嫁接到更早楼层会把被删楼层的填表数据永久固化在旧楼层并锁死重填调度。
 * sheet_hide / sheet_reveal / sheet_introduction 等休眠与表生命周期事件仍可保留。
 */
function shouldGraftSheetCheckpoint_ACU(
    checkpoint: TableSheetCheckpointV2_ACU,
    isBackwardGraft: boolean,
): boolean {
    if (!isBackwardGraft) return true;
    if (checkpoint.reason === 'manual') return false;
    if (checkpoint.timeline?.kind === 'sheet_rebase') return false;
    return true;
}

/**
 * MESSAGE_DELETED 后的前移恢复：把被删楼层携带的不可替代产物嫁接到最近的幸存楼层。
 * 在冷回放之前调用；无丢失时零写入零保存。
 */
export async function recoverLostCheckpointsAfterMessageDeletion_ACU(): Promise<CheckpointDeleteRecoveryResult_ACU> {
    const chat = getChatArray_ACU();
    const chatKey = String(currentChatFileIdentifier_ACU || '');
    if (!vault_ACU || vault_ACU.chatKey !== chatKey || !Array.isArray(chat)) {
        return { recovered: false, graftedCount: 0 };
    }
    if (chat.length === 0) {
        captureCheckpointVaultForCurrentChat_ACU(chat);
        return { recovered: false, graftedCount: 0 };
    }

    const presentMessages = new Set<any>(chat);
    const capturedVault = vault_ACU;
    const rolledIsolationKey = getCurrentIsolationKey_ACU();
    const deletedTail = capturedVault.messageIndices.size === chat.length + 1
        && chat.every((message, index) => capturedVault.messageIndices.get(message) === index)
        ? [...capturedVault.messageIndices].find(([, index]) => index === chat.length)?.[0]
        : undefined;
    const replyRollback = deletedTail && readDeletedReplyRollback_ACU(chat, deletedTail, chatKey, rolledIsolationKey);
    const lostItems: GraftPlanItem_ACU[] = [];
    for (const [isolationKey, entries] of capturedVault.entriesByIsolationKey) {
        entries.forEach((entry, vaultIndex) => {
            if (presentMessages.has(entry.messageRef)) return;
            if (replyRollback && isolationKey === rolledIsolationKey && entry.messageRef === deletedTail) return;
            if (!entryHasArtifacts_ACU(entry)) return;
            lostItems.push({ entry, isolationKey, vaultIndex });
        });
    }
    if (replyRollback) {
        const tailAnchors = captureFrameEntry_ACU(deletedTail, replyRollback.tailTag);
        if (tailAnchors && entryHasArtifacts_ACU(tailAnchors)) {
            lostItems.push({ entry: tailAnchors, isolationKey: rolledIsolationKey,
                vaultIndex: capturedVault.entriesByIsolationKey.get(rolledIsolationKey)?.length ?? 0 });
        }
    }
    const lostReplyMaterial = replyRollback && capturedVault.materialEntries.some(entry => entry.messageRef === deletedTail);
    if (lostItems.length === 0 && !lostReplyMaterial) {
        // 被删回复自身的产物可能已被回滚规则排除；仍须丢弃保管库中的旧条目，
        // 与零嫁接分支保持一致，避免后续删楼重新恢复已撤销的产物。
        captureCheckpointVaultForCurrentChat_ACU(chat);
        return { recovered: false, graftedCount: 0 };
    }

    return runTableWriteTransaction_ACU({
        source: 'system_cleanup',
        reason: 'message_delete_checkpoint_recovery',
        isolationKey: getCurrentIsolationKey_ACU(),
        writeSet: [{ kind: 'all' }],
        maintenanceMode: 'exclusive',
    }, async (): Promise<CheckpointDeleteRecoveryResult_ACU> => {
        // 只快照将被改写的消息的 IsolatedData 字段，失败时整体还原。
        const snapshots = new Map<any, string | undefined>();
        const snapshotTarget = (message: any): void => {
            if (snapshots.has(message)) return;
            const field = message.TavernDB_ACU_IsolatedData;
            snapshots.set(message, field === undefined ? undefined : JSON.stringify(field));
        };
        const restoreSnapshots = (): void => {
            for (const [message, serialized] of snapshots) {
                if (serialized === undefined) delete message.TavernDB_ACU_IsolatedData;
                else message.TavernDB_ACU_IsolatedData = JSON.parse(serialized);
            }
        };

        let graftedCount = 0;
        const affectedIsolationKeys = new Set<string>();
        const materialSnapshots = snapshotMaterialCheckpointFields_ACU(chat);
        const graftTargetByLostMessage = new Map<any, any>();
        const timelineGrafts = new Map<TableStorageFrameV2_ACU, {
            targetMessage: any;
            groups: Array<{ sourceIndex: number; checkpoints: TableSheetCheckpointV2_ACU[] }>;
        }>();
        try {
            if (replyRollback && (vault_ACU !== capturedVault || getCurrentIsolationKey_ACU() !== rolledIsolationKey || !replyRollback.isCurrent())) {
                throw new Error('重生成期间数据库表格已改变。');
            }
            // 无时间的快照保留更新者优先；timeline 按原物理位置收集后统一嫁接。
            for (const item of [...lostItems].reverse()) {
                const { entry, isolationKey, vaultIndex } = item;
                const entries = vault_ACU!.entriesByIsolationKey.get(isolationKey)!;
                const target = findGraftTargetMessage_ACU(chat, presentMessages, entries, vaultIndex, isolationKey);
                if (!target) {
                    logWarn_ACU(`[删楼守卫] isolationKey=[${isolationKey || '无标签'}] 的丢失 checkpoint 无处嫁接（聊天已无 AI 楼层），跳过嫁接并同步保管库。`);
                    continue;
                }
                const targetIndex = chat.indexOf(target.message);
                const originalLostIndex = vault_ACU!.messageIndices.get(entry.messageRef);
                const originalTargetIndex = vault_ACU!.messageIndices.get(target.message);
                const isBackwardGraft = originalLostIndex !== undefined
                    && originalTargetIndex !== undefined
                    && originalTargetIndex < originalLostIndex;
                const targetAiFloor = countAiFloorAtMessageIndex_ACU(chat, targetIndex);
                const existingTagData = readIsolatedTagData_ACU(target.message, isolationKey);
                const existingFrame = isV2TagData_ACU(existingTagData) ? existingTagData.storageFrame : null;

                let fullToGraft: TableCheckpointV2_ACU | null = null;
                if (entry.fullCheckpoint) {
                    if (!shouldGraftFullCheckpoint_ACU(entry.fullCheckpoint, isBackwardGraft)) {
                        logDebug_ACU(`[删楼守卫] 被删末尾楼层的 full checkpoint（reason=${entry.fullCheckpoint.reason}）属于被删楼层状态，跳过向更早楼层 #${targetIndex} 回退嫁接。`);
                    } else if (existingFrame?.checkpoint?.kind === 'full') {
                        logDebug_ACU(`[删楼守卫] 楼层 #${targetIndex} 已有 full checkpoint，跳过回放根嫁接。`);
                    } else {
                        const clonedFull = deepClone_ACU(entry.fullCheckpoint);
                        fullToGraft = isBackwardGraft
                            ? clampFullCheckpointScheduleSummary_ACU(clonedFull, targetAiFloor)
                            : clonedFull;
                    }
                }

                let vectorToGraft: CheckpointVaultFrameEntry_ACU['summaryVectorCheckpoint'] = null;
                if (entry.summaryVectorCheckpoint?.checkpoint) {
                    if (existingFrame?.summaryVectorIndexFrame?.checkpoint) {
                        logDebug_ACU(`[删楼守卫] 楼层 #${targetIndex} 已有向量 checkpoint，跳过嫁接。`);
                    } else if (isBackwardGraft && !existingFrame && !fullToGraft) {
                        logDebug_ACU(`[删楼守卫] 末尾删楼未向更早楼层 #${targetIndex} 回退表格根，跳过孤立向量 checkpoint 嫁接。`);
                    } else {
                        vectorToGraft = deepClone_ACU(entry.summaryVectorCheckpoint);
                    }
                }

                const untimedPerSheetToGraft: Array<[string, TableSheetCheckpointV2_ACU]> = [];
                const lostTimelineCheckpoints: TableSheetCheckpointV2_ACU[] = [];
                if (hasEntries_ACU(entry.perSheetCheckpoints)) {
                    for (const [sheetKey, checkpoint] of Object.entries(entry.perSheetCheckpoints!)) {
                        if (!shouldGraftSheetCheckpoint_ACU(checkpoint, isBackwardGraft)) {
                            logDebug_ACU(`[删楼守卫] 被删末尾楼层的 ${sheetKey} per-sheet checkpoint（reason=${checkpoint.reason}, timeline=${checkpoint.timeline?.kind || 'legacy'}）属于被删楼层状态，跳过向更早楼层 #${targetIndex} 回退嫁接。`);
                            continue;
                        }
                        if (!checkpoint.timeline && existingFrame && getLatestFrameSheetCheckpoint_ACU(existingFrame, sheetKey)) {
                            logDebug_ACU(`[删楼守卫] 楼层 #${targetIndex} 已有 ${sheetKey} 的 per-sheet checkpoint（幸存者优先），跳过嫁接。`);
                            continue;
                        }
                        const cloned = deepClone_ACU(checkpoint);
                        const sanitized = isBackwardGraft && cloned.scheduleSummary
                            ? { ...cloned, scheduleSummary: clampScheduleSummaryEntryToAiFloor_ACU(cloned.scheduleSummary, targetAiFloor) }
                            : cloned;
                        if (sanitized.timeline) {
                            lostTimelineCheckpoints.push(sanitized);
                        } else {
                            untimedPerSheetToGraft.push([sheetKey, sanitized]);
                        }
                    }
                }

                const filteredTimelineEvents: TableSheetTimelineEventV2_ACU[] = [];
                for (const event of entry.sheetTimelineEvents) {
                    if (!shouldGraftSheetCheckpoint_ACU(event.checkpoint, isBackwardGraft)) {
                        logDebug_ACU(`[删楼守卫] 被删末尾楼层的 ${event.checkpoint.sheetKey} timeline checkpoint（reason=${event.checkpoint.reason}, timeline=${event.checkpoint.timeline?.kind || 'legacy'}）属于被删楼层状态，跳过向更早楼层 #${targetIndex} 回退嫁接。`);
                        continue;
                    }
                    const cloned = deepClone_ACU(event);
                    if (isBackwardGraft && cloned.checkpoint.scheduleSummary) {
                        cloned.checkpoint = {
                            ...cloned.checkpoint,
                            scheduleSummary: clampScheduleSummaryEntryToAiFloor_ACU(cloned.checkpoint.scheduleSummary, targetAiFloor),
                        };
                    }
                    filteredTimelineEvents.push(cloned);
                }

                const lostRecords = getOrderedFrameSheetCheckpointRecords_ACU({
                    version: 2, logEntries: [],
                    perSheetCheckpoints: Object.fromEntries(lostTimelineCheckpoints.map(checkpoint => [checkpoint.sheetKey, checkpoint])),
                    sheetTimelineEvents: filteredTimelineEvents,
                });

                const spv79ToGraft = entry.spv79TransitionCheckpoint && !(existingTagData as any)?.spv79TransitionCheckpoint
                    ? deepClone_ACU(entry.spv79TransitionCheckpoint)
                    : null;
                const compatToGraft = entry.compatTransitionCheckpoint && !(existingTagData as any)?.compatTransitionCheckpoint
                    ? deepClone_ACU(entry.compatTransitionCheckpoint)
                    : null;

                const hasAnyGraft = !!fullToGraft
                    || !!vectorToGraft
                    || untimedPerSheetToGraft.length > 0
                    || lostRecords.length > 0
                    || !!spv79ToGraft
                    || !!compatToGraft;
                if (!hasAnyGraft) continue;

                snapshotTarget(target.message);
                graftTargetByLostMessage.set(entry.messageRef, target.message);
                const frame = ensureTargetFrame_ACU(target.message, isolationKey);

                if (target.absorbedEarlierFrame && fullToGraft && frame.logEntries.length > 0) {
                    logWarn_ACU(`[删楼守卫] 嫁接楼层 #${targetIndex} 携带更早的增量帧；其 logs 已被恢复的 full checkpoint 吸收，清空以保持回放顺序正确。`);
                    frame.logEntries = [];
                }

                if (fullToGraft) {
                    frame.checkpoint = fullToGraft;
                    graftedCount += 1;
                    logWarn_ACU(`[删楼守卫] 被删楼层携带的回放根（reason=${fullToGraft.reason}）已前移嫁接到楼层 #${targetIndex}（isolationKey=[${isolationKey || '无标签'}]）。`);
                }

                if (vectorToGraft) {
                    if (!frame.summaryVectorIndexFrame || typeof frame.summaryVectorIndexFrame !== 'object') {
                        frame.summaryVectorIndexFrame = {
                            version: 3,
                            sourceTableKey: vectorToGraft.sourceTableKey,
                            logEntries: [],
                        };
                    }
                    frame.summaryVectorIndexFrame.sourceTableKey = vectorToGraft.sourceTableKey
                        || frame.summaryVectorIndexFrame.sourceTableKey;
                    frame.summaryVectorIndexFrame.checkpoint = vectorToGraft.checkpoint;
                    graftedCount += 1;
                    logWarn_ACU(`[删楼守卫] 被删楼层携带的向量 checkpoint 已前移嫁接到楼层 #${targetIndex}。`);
                }

                for (const [sheetKey, checkpoint] of untimedPerSheetToGraft) {
                    if (!frame.perSheetCheckpoints) frame.perSheetCheckpoints = {};
                    frame.perSheetCheckpoints[sheetKey] = checkpoint;
                    graftedCount += 1;
                    logWarn_ACU(`[删楼守卫] 被删楼层携带的 ${sheetKey} per-sheet checkpoint（timeline=legacy）已前移嫁接到楼层 #${targetIndex}。`);
                }

                if (lostRecords.length > 0) {
                    const graft = timelineGrafts.get(frame) || { targetMessage: target.message, groups: [] };
                    graft.groups.push({
                        sourceIndex: originalLostIndex!,
                        checkpoints: lostRecords.map(record => deepClone_ACU(record.checkpoint)),
                    });
                    timelineGrafts.set(frame, graft);
                    graftedCount += lostRecords.length;
                    for (const record of lostRecords) {
                        logWarn_ACU(`[删楼守卫] 被删楼层携带的 ${record.checkpoint.sheetKey} per-sheet checkpoint（timeline=${record.checkpoint.timeline?.kind || 'legacy'}）已前移嫁接到楼层 #${targetIndex}。`);
                    }
                }

                const tagData = target.message.TavernDB_ACU_IsolatedData[isolationKey];
                if (spv79ToGraft) {
                    tagData.spv79TransitionCheckpoint = spv79ToGraft;
                    graftedCount += 1;
                    logWarn_ACU(`[删楼守卫] SPv7.9 过渡根已嫁接到楼层 #${targetIndex}；其 cutoff 楼层索引可能因删除漂移，请留意后续回放告警。`);
                }
                if (compatToGraft) {
                    tagData.compatTransitionCheckpoint = compatToGraft;
                    graftedCount += 1;
                    logWarn_ACU(`[删楼守卫] 兼容过渡根已嫁接到楼层 #${targetIndex}；其 cutoff 楼层索引可能因删除漂移，请留意后续回放告警。`);
                }
                affectedIsolationKeys.add(isolationKey);
            }

            for (const [frame, { targetMessage, groups }] of timelineGrafts) {
                const targetIndex = chat.indexOf(targetMessage);
                const originalTargetIndex = vault_ACU!.messageIndices.get(targetMessage) ?? Number.POSITIVE_INFINITY;
                const tailSeq = Math.max(0, ...frame.logEntries.map(log => log.seq));
                const before: TableSheetCheckpointV2_ACU[] = [];
                const after: TableSheetCheckpointV2_ACU[] = [];
                for (const group of groups.sort((left, right) => left.sourceIndex - right.sourceIndex)) {
                    const prepend = group.sourceIndex < originalTargetIndex;
                    for (const checkpoint of group.checkpoints) {
                        if (checkpoint.timeline) checkpoint.timeline = {
                            ...checkpoint.timeline, activateAtMessageIndex: targetIndex, afterSeq: prepend ? 0 : tailSeq,
                        };
                        (prepend ? before : after).push(checkpoint);
                    }
                }
                const surviving = getOrderedFrameSheetCheckpointRecords_ACU(frame).filter(record => record.checkpoint.timeline);
                for (const record of surviving) {
                    if (record.ordinal === undefined) delete frame.perSheetCheckpoints![record.recordKey];
                }
                delete frame.sheetTimelineEvents;
                appendFrameSheetTimelineEvents_ACU(frame, [
                    ...before, ...surviving.map(record => record.checkpoint), ...after,
                ]);
            }

            const presentMessagesForMaterial = new Set<any>(chat);
            for (let lostIndex = vault_ACU!.materialEntries.length - 1; lostIndex >= 0; lostIndex -= 1) {
                const material = vault_ACU!.materialEntries[lostIndex];
                if (presentMessagesForMaterial.has(material.messageRef)) continue;
                if (!material.continuation && !material.simulation) continue;
                const preferred = graftTargetByLostMessage.get(material.messageRef);
                let targetMessage = preferred;
                if (!targetMessage) {
                    for (let index = lostIndex + 1; index < vault_ACU!.materialEntries.length; index += 1) {
                        const candidate = vault_ACU!.materialEntries[index];
                        if (presentMessagesForMaterial.has(candidate.messageRef)) {
                            targetMessage = candidate.messageRef;
                            break;
                        }
                    }
                }
                if (!targetMessage) {
                    for (let index = chat.length - 1; index >= 0; index -= 1) {
                        if (chat[index] && !chat[index].is_user) {
                            targetMessage = chat[index];
                            break;
                        }
                    }
                }
                if (!targetMessage) continue;
                if (material.continuation && graftMaterialContinuationCheckpoint_ACU(targetMessage, material.continuation)) graftedCount += 1;
                if (material.simulation && graftMaterialSimulationCheckpoint_ACU(chat, targetMessage, material.simulation)) graftedCount += 1;
            }

            if (graftedCount === 0) {
                // 全部被跳过、属于被删末尾楼层状态或已无幸存 AI 楼层：无写入无需保存，
                // 但必须以当前幸存聊天同步保管库，避免已丢弃的被删楼层产物在后续删楼时复活。
                restoreSnapshots();
                restoreMaterialCheckpointFields_ACU(chat, materialSnapshots);
                captureCheckpointVaultForCurrentChat_ACU(chat);
                return { recovered: false, graftedCount: 0 };
            }

            for (const isolationKey of affectedIsolationKeys) {
                const violation = assertSingleActiveFullCheckpointV2_ACU(chat, isolationKey, 'delete_recovery');
                if (violation) throw new Error(violation);
            }
            const continuationViolation = assertMaterialContinuationCheckpoint_ACU(chat);
            if (continuationViolation) throw new Error(continuationViolation);
            const simulationViolation = assertMaterialSimulationCheckpoint_ACU(chat);
            if (simulationViolation) throw new Error(simulationViolation);

            await saveChatToHostStrict_ACU();
            captureCheckpointVaultForCurrentChat_ACU(chat);
            logWarn_ACU(`[删楼守卫] 删楼 checkpoint 前移恢复完成：共嫁接 ${graftedCount} 个产物。`);
            return { recovered: true, graftedCount };
        } catch (error: any) {
            restoreSnapshots();
            restoreMaterialCheckpointFields_ACU(chat, materialSnapshots);
            const message = error?.message || String(error || '删楼 checkpoint 恢复失败。');
            logError_ACU(`[删楼守卫] 删楼 checkpoint 前移恢复失败，已回滚改动（保管库保留，下次删楼事件重试）：${message}`);
            return { recovered: false, graftedCount: 0, error: message };
        }
    });
}

/** 仅供测试：读取当前保管库形态。 */
export function __getCheckpointVaultForTests_ACU(): { chatKey: string; isolationKeys: string[]; entryCounts: Record<string, number> } | null {
    if (!vault_ACU) return null;
    const entryCounts: Record<string, number> = {};
    for (const [key, entries] of vault_ACU.entriesByIsolationKey) entryCounts[key] = entries.length;
    return { chatKey: vault_ACU.chatKey, isolationKeys: [...vault_ACU.entriesByIsolationKey.keys()], entryCounts };
}

/** 仅供测试：重置安装状态。 */
export function __resetCheckpointDeleteGuardForTests_ACU(): void {
    vault_ACU = null;
    installed_ACU = false;
}
