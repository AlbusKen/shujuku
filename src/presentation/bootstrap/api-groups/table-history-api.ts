import { getChatArray_ACU } from '../../../data/gateways/chat-gateway';
import { SillyTavern_API_ACU } from '../../../shared/host-api';
import type { TableDataObject_ACU } from '../../../shared/models/table-data';
import { getCurrentIsolationKey_ACU } from '../../../service/runtime/state-manager';
import { loadTableStatesAtBoundariesFromFramesV2Detailed_ACU, V2ReplayOperationError_ACU, type V2ReplayOperationFailurePoint_ACU } from '../../../service/table/storage-frame-v2-replay';
import { computeReplayHeadRevisionDigest_ACU } from '../../../service/table/v2-replay-session';

export type PublicTableHistoryResult_ACU =
    | { success: true; snapshots: Array<{ messageIndex: number; data: TableDataObject_ACU }> }
    | { success: false; code: 'invalid_message_indices' | 'host_unavailable' | 'context_changed' | 'replay_failed'; error: string; failurePoint?: V2ReplayOperationFailurePoint_ACU };

export function createTableHistoryApi(): Record<string, Function> {
    return {
        /**
         * 只读导出当前聊天、当前隔离槽在指定消息处的 V2 完整表格状态。
         * 索引为从 0 开始的绝对消息索引，包含该消息自身的操作；没有帧的消息
         * 继承此前状态。重复索引去重，返回顺序保持请求顺序。
         * 需要正式 full checkpoint；缺失基底、损坏帧或 SQL 失败返回结构化错误，
         * 不以当前表格或空对象替代。不会保存聊天、通知 UI 或发布回放运行时。
         * 空数组返回空结果。异步读取期间聊天、swipe 或存储修订变化会拒绝结果。
         * 返回数据为独立副本；本接口不提供持久缓存。
         *
         * @example
         * const result = await AutoCardUpdaterAPI.exportTableSnapshotsAtMessages([0, 5]);
         * if (result.success) console.log(result.snapshots[0].data);
         */
        exportTableSnapshotsAtMessages: async function(messageIndices: unknown): Promise<PublicTableHistoryResult_ACU> {
            if (!Array.isArray(messageIndices) || Array.from(messageIndices).some(index => !Number.isSafeInteger(index) || index < 0)) {
                return { success: false, code: 'invalid_message_indices', error: 'messageIndices 必须是非负整数消息索引数组。' };
            }
            const indices = [...new Set<number>(messageIndices)];
            if (indices.length === 0) return { success: true, snapshots: [] };

            const host = SillyTavern_API_ACU;
            const chat = getChatArray_ACU();
            if (!host || !Array.isArray(host.chat) || host.chatId == null || host.chatId === '') {
                return { success: false, code: 'host_unavailable', error: '当前聊天尚未就绪。' };
            }
            if (indices.some(index => index >= chat.length)) {
                return { success: false, code: 'invalid_message_indices', error: '消息索引超出当前聊天范围。' };
            }

            const { chatId, characterId, groupId } = host;
            const isolationKey = getCurrentIsolationKey_ACU(); // 空串是合法的默认槽。
            const owners = chat.map(message => ({
                message, swipeId: message?.swipe_id,
                frame: message?.TavernDB_ACU_IsolatedData?.[isolationKey]?.storageFrame,
            }));
            const revision = computeReplayHeadRevisionDigest_ACU(chat, isolationKey);
            const isCurrent = () => SillyTavern_API_ACU === host && getChatArray_ACU() === chat
                && host.chatId === chatId && host.characterId === characterId && host.groupId === groupId
                && getCurrentIsolationKey_ACU() === isolationKey && chat.length === owners.length
                && owners.every((owner, index) => chat[index] === owner.message
                    && chat[index]?.swipe_id === owner.swipeId
                    && chat[index]?.TavernDB_ACU_IsolatedData?.[isolationKey]?.storageFrame === owner.frame)
                && computeReplayHeadRevisionDigest_ACU(chat, isolationKey) === revision;
            const stale = (): PublicTableHistoryResult_ACU => ({
                success: false, code: 'context_changed', error: '历史读取期间聊天或存储修订已变化，请重新读取。',
            });
            try {
                // Batch capture otherwise continues through the entire supplied history.
                // A later invalid frame must not prevent reading an earlier valid floor.
                const lastIndex = indices.reduce((maximum, index) => Math.max(maximum, index), 0);
                const states = await loadTableStatesAtBoundariesFromFramesV2Detailed_ACU(chat.slice(0, lastIndex + 1), isolationKey, indices, {
                    updateRuntimeState: false,
                    compatibilityMode: 'disabled',
                    allowTemporaryTemplateBaseline: false,
                });
                if (!isCurrent()) return stale();
                const snapshots = indices.map(messageIndex => {
                    const state = states.get(messageIndex);
                    if (!state) throw new Error(`未取得消息 ${messageIndex} 的历史快照。`);
                    return { messageIndex, data: structuredClone(state.data) };
                });
                return { success: true, snapshots };
            } catch (error: unknown) {
                if (!isCurrent()) return stale();
                const failurePoint = error instanceof V2ReplayOperationError_ACU ? {
                    messageIndex: error.messageIndex, seq: error.seq,
                    operationIndex: error.operationIndex, kind: error.kind,
                } : undefined;
                return { success: false, code: 'replay_failed', error: error instanceof Error ? error.message : String(error),
                    ...(failurePoint ? { failurePoint } : {}) };
            }
        },
    };
}
