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
import { isV2TagData_ACU } from '../table/storage-strategy-resolver';
import { assertSingleActiveFullCheckpointV2_ACU } from '../table/storage-frame-v2-persist';
import { runTableWriteTransaction_ACU } from '../table/table-write-transaction';
import { currentChatFileIdentifier_ACU, getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import { logDebug_ACU, logError_ACU, logWarn_ACU } from '../../shared/utils';
import type {
    TableCheckpointV2_ACU,
    TableSheetCheckpointV2_ACU,
    TableStorageFrameV2_ACU,
} from '../table/storage-frame-v2-types';

interface CheckpointVaultFrameEntry_ACU {
    /** 幸存判定锚：宿主 splice 不改变幸存消息的对象引用。 */
    messageRef: any;
    fullCheckpoint: TableCheckpointV2_ACU | null;
    perSheetCheckpoints: Record<string, TableSheetCheckpointV2_ACU> | null;
    spv79TransitionCheckpoint: any | null;
    compatTransitionCheckpoint: any | null;
}

interface CheckpointVaultState_ACU {
    chatKey: string;
    /** isolationKey → 按楼层序的 frame 条目（含 log-only 信标）。 */
    entriesByIsolationKey: Map<string, CheckpointVaultFrameEntry_ACU[]>;
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
        || !!entry.spv79TransitionCheckpoint
        || !!entry.compatTransitionCheckpoint;
}

/**
 * 以当前聊天为权威重建保管库。
 * 调用时机：聊天加载完成、插件保存成功后、恢复嫁接成功后。
 */
export function captureCheckpointVaultForCurrentChat_ACU(chatArg?: any[]): void {
    const chat = Array.isArray(chatArg) ? chatArg : getChatArray_ACU();
    const chatKey = String(currentChatFileIdentifier_ACU || '');
    const entriesByIsolationKey = new Map<string, CheckpointVaultFrameEntry_ACU[]>();

    for (const message of chat) {
        if (!message || message.is_user) continue;
        const container = readIsolatedDataContainer_ACU(message);
        if (!container) continue;
        for (const [isolationKey, tagData] of Object.entries(container)) {
            if (!tagData || typeof tagData !== 'object') continue;
            const frame = isV2TagData_ACU(tagData) ? tagData.storageFrame : null;
            const spv79 = (tagData as any).spv79TransitionCheckpoint?.kind === 'spv79_duplicate_row_id_transition'
                ? (tagData as any).spv79TransitionCheckpoint : null;
            const compat = (tagData as any).compatTransitionCheckpoint?.kind === 'compat_replay_transition'
                ? (tagData as any).compatTransitionCheckpoint : null;
            if (!frame && !spv79 && !compat) continue;

            const fullCheckpoint = frame?.checkpoint?.kind === 'full' ? deepClone_ACU(frame.checkpoint) : null;
            const perSheetCheckpoints = frame && hasEntries_ACU(frame.perSheetCheckpoints)
                ? deepClone_ACU(frame.perSheetCheckpoints!) : null;
            const entries = entriesByIsolationKey.get(isolationKey) || [];
            entries.push({
                messageRef: message,
                fullCheckpoint,
                perSheetCheckpoints,
                spv79TransitionCheckpoint: spv79 ? deepClone_ACU(spv79) : null,
                compatTransitionCheckpoint: compat ? deepClone_ACU(compat) : null,
            });
            entriesByIsolationKey.set(isolationKey, entries);
        }
    }

    vault_ACU = { chatKey, entriesByIsolationKey };
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

/**
 * MESSAGE_DELETED 后的前移恢复：把被删楼层携带的不可替代产物嫁接到最近的幸存楼层。
 * 在冷回放之前调用；无丢失时零写入零保存。
 */
export async function recoverLostCheckpointsAfterMessageDeletion_ACU(): Promise<CheckpointDeleteRecoveryResult_ACU> {
    const chat = getChatArray_ACU();
    const chatKey = String(currentChatFileIdentifier_ACU || '');
    if (!vault_ACU || vault_ACU.chatKey !== chatKey || !Array.isArray(chat) || chat.length === 0) {
        return { recovered: false, graftedCount: 0 };
    }

    const presentMessages = new Set<any>(chat);
    const lostItems: GraftPlanItem_ACU[] = [];
    for (const [isolationKey, entries] of vault_ACU.entriesByIsolationKey) {
        entries.forEach((entry, vaultIndex) => {
            if (presentMessages.has(entry.messageRef)) return;
            if (!entryHasArtifacts_ACU(entry)) return;
            lostItems.push({ entry, isolationKey, vaultIndex });
        });
    }
    if (lostItems.length === 0) return { recovered: false, graftedCount: 0 };

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
        try {
            // 逆序处理：同 sheetKey 冲突时"原始位置更靠后的产物"先占位，更早的被
            // 目标已有判定跳过——幸存者/更新者优先的语义由同一条规则统一表达。
            for (const item of [...lostItems].reverse()) {
                const { entry, isolationKey, vaultIndex } = item;
                const entries = vault_ACU!.entriesByIsolationKey.get(isolationKey)!;
                const target = findGraftTargetMessage_ACU(chat, presentMessages, entries, vaultIndex, isolationKey);
                if (!target) {
                    logError_ACU(`[删楼守卫] isolationKey=[${isolationKey || '无标签'}] 的丢失 checkpoint 无处嫁接（聊天已无 AI 楼层），保留保管库等待下次机会。`);
                    continue;
                }
                snapshotTarget(target.message);
                const frame = ensureTargetFrame_ACU(target.message, isolationKey);
                const targetIndex = chat.indexOf(target.message);

                if (target.absorbedEarlierFrame && entry.fullCheckpoint && frame.logEntries.length > 0) {
                    logWarn_ACU(`[删楼守卫] 嫁接楼层 #${targetIndex} 携带更早的增量帧；其 logs 已被恢复的 full checkpoint 吸收，清空以保持回放顺序正确。`);
                    frame.logEntries = [];
                }

                if (entry.fullCheckpoint) {
                    if (frame.checkpoint?.kind === 'full') {
                        logDebug_ACU(`[删楼守卫] 楼层 #${targetIndex} 已有 full checkpoint，跳过回放根嫁接。`);
                    } else {
                        frame.checkpoint = deepClone_ACU(entry.fullCheckpoint);
                        graftedCount += 1;
                        logWarn_ACU(`[删楼守卫] 被删楼层携带的回放根（reason=${entry.fullCheckpoint.reason}）已前移嫁接到楼层 #${targetIndex}（isolationKey=[${isolationKey || '无标签'}]）。`);
                    }
                }

                if (hasEntries_ACU(entry.perSheetCheckpoints)) {
                    for (const [sheetKey, checkpoint] of Object.entries(entry.perSheetCheckpoints!)) {
                        if (frame.perSheetCheckpoints?.[sheetKey]) {
                            logDebug_ACU(`[删楼守卫] 楼层 #${targetIndex} 已有 ${sheetKey} 的 per-sheet checkpoint（幸存者优先），跳过嫁接。`);
                            continue;
                        }
                        const cloned = deepClone_ACU(checkpoint);
                        if (cloned.timeline) {
                            cloned.timeline = { ...cloned.timeline, activateAtMessageIndex: targetIndex, afterSeq: 0 };
                        }
                        if (!frame.perSheetCheckpoints) frame.perSheetCheckpoints = {};
                        frame.perSheetCheckpoints[sheetKey] = cloned;
                        graftedCount += 1;
                        logWarn_ACU(`[删楼守卫] 被删楼层携带的 ${sheetKey} per-sheet checkpoint（timeline=${checkpoint.timeline?.kind || 'legacy'}）已前移嫁接到楼层 #${targetIndex}。`);
                    }
                }

                const tagData = target.message.TavernDB_ACU_IsolatedData[isolationKey];
                if (entry.spv79TransitionCheckpoint && !tagData.spv79TransitionCheckpoint) {
                    tagData.spv79TransitionCheckpoint = deepClone_ACU(entry.spv79TransitionCheckpoint);
                    graftedCount += 1;
                    logWarn_ACU(`[删楼守卫] SPv7.9 过渡根已嫁接到楼层 #${targetIndex}；其 cutoff 楼层索引可能因删除漂移，请留意后续回放告警。`);
                }
                if (entry.compatTransitionCheckpoint && !tagData.compatTransitionCheckpoint) {
                    tagData.compatTransitionCheckpoint = deepClone_ACU(entry.compatTransitionCheckpoint);
                    graftedCount += 1;
                    logWarn_ACU(`[删楼守卫] 兼容过渡根已嫁接到楼层 #${targetIndex}；其 cutoff 楼层索引可能因删除漂移，请留意后续回放告警。`);
                }
                affectedIsolationKeys.add(isolationKey);
            }

            if (graftedCount === 0) {
                // 全部被"目标已有"跳过或无处嫁接：无写入即无需保存。
                return { recovered: false, graftedCount: 0 };
            }

            for (const isolationKey of affectedIsolationKeys) {
                const violation = assertSingleActiveFullCheckpointV2_ACU(chat, isolationKey, 'delete_recovery');
                if (violation) throw new Error(violation);
            }

            await saveChatToHostStrict_ACU();
            captureCheckpointVaultForCurrentChat_ACU(chat);
            logWarn_ACU(`[删楼守卫] 删楼 checkpoint 前移恢复完成：共嫁接 ${graftedCount} 个产物。`);
            return { recovered: true, graftedCount };
        } catch (error: any) {
            restoreSnapshots();
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
