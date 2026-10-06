/**
 * service/runtime/message-handler.ts — 新消息处理核心逻辑
 * 从 presentation/triggers/settings-ui-sync/settings-ui-connect.ts 的 handleNewMessageDebounced_ACU 中提取
 * 
 * 只负责「验证新消息是否应该触发更新 + 决定执行模式」，不涉及 UI（toast/防抖定时器）。
 */

import { logDebug_ACU } from '../../shared/utils';
import type { AutoFillSkipReason_ACU } from '../../shared/trigger-diagnostics';
import { getCurrentCharacterFallback_ACU } from '../host/host-state-service';

export type MessageAction = 'skip' | 'update_only' | 'optimize_parallel' | 'optimize_then_update' | 'optimize_manual';

/**
 * 生成结束或正文消息事件的触发意图快照。
 *
 * 正文消息事件明确提供数组下标；GENERATION_ENDED 的参数仅作为锚点，
 * 两者由 eventMessageIdKind 区分。捕获边界供旧结束事件的兼容解析使用。
 */
export interface AutoFillIntent_ACU {
    /** 宿主事件参数；未声明 index 语义时沿用结束事件的锚点解析 */
    eventMessageId: number;
    /** MESSAGE_RECEIVED / CHARACTER_MESSAGE_RENDERED 明确携带零基数组下标 */
    eventMessageIdKind?: 'index';
    /** 捕获时聊天文件标识，用于防抖期间切聊天校验 */
    chatKey: string;
    /** 捕获时数据隔离键；空字符串表示未启用隔离 */
    isolationKey: string;
    /** 捕获时间戳 */
    capturedAt: number;
    /** 捕获时聊天数组长度 */
    capturedChatLength: number;
    /** 捕获时 AI 楼层数（!is_user 且非 narrator 的楼层） */
    capturedAiFloorCount: number;
    /** 捕获时对应的生成序号；状态接口不可靠时为 undefined，不假造 */
    generationSeq?: number;
}

/**
 * 解析结果判别联合。
 * - resolved: 唯一候选，直接使用
 * - pending_materialization: 本轮 AI 尚未物化，交给有界等待层重试
 * - ambiguous: 捕获后出现多个合格 AI 候选，fail loud，不猜
 * - invalid_intent: 快照本身不可用（chatKey 不匹配 / 捕获边界非法）
 */
export type ResolveGeneratedAiResult_ACU =
    | { kind: 'resolved'; messageIndex: number }
    | { kind: 'pending_materialization'; candidates: number[] }
    | { kind: 'ambiguous'; candidates: number[] }
    | { kind: 'invalid_intent'; reason: string };

export interface MessageActionResult {
    action: MessageAction;
    reason: string;
    lastMessageIndex?: number;
    skipReason?: AutoFillSkipReason_ACU;
}

/**
 * 判断一条消息是否属于「AI 楼层」。
 * 宿主语义（@types/iframe/exported.sillytavern.d.ts）：
 *   - role === 'user'  <=> is_user
 *   - role === 'system' <=> extra?.type === 'narrator' && !is_user
 *   - role === 'assistant' <=> extra?.type !== 'narrator' && !is_user
 * 因此 AI 楼层 = !is_user 且非 narrator 系统旁白。仅凭 !is_user 会把系统消息误当 AI。
 */
export function isAiMessage_ACU(message: any): boolean {
    if (!message || typeof message !== 'object') return false;
    if (message.is_user) return false;
    const extraType = message?.extra?.type;
    if (extraType === 'narrator') return false;
    return true;
}

export function countAiMessages_ACU(liveChat: any[]): number {
    if (!Array.isArray(liveChat)) return 0;
    let count = 0;
    for (const message of liveChat) {
        if (isAiMessage_ACU(message)) count += 1;
    }
    return count;
}

export interface ResolveGeneratedAiOptions_ACU {
    liveChat: any[];
    intent: AutoFillIntent_ACU;
}

/**
 * 解析本轮 AI 楼层（纯函数，不依赖 timer / 宿主状态）。
 *
 * 顺序：
 * 1. 稳定消息 ID 命中：按消息对象的 message_id 唯一匹配 AI 楼层。
 * 2. 兼容数组索引命中：eventMessageId 在范围内且是 AI 楼层 → 使用它。
 * 3. 一基尾楼命中：仅当 eventMessageId === chat.length，捕获/实时边界完全未变，
 *    且尾楼为 AI 时，将事件楼层号映射为数组末尾索引。该分支由真实宿主日志证实，
 *    但条件必须严格，禁止泛化为无条件 messageId - 1。
 * 4. 捕获后新增区间 [capturedChatLength, liveChat.length)：只接受 AI 楼层候选。
 * 5. 锚点后区间 (eventMessageId, liveChat.length)：当捕获长度因宿主异步视图不可靠时，
 *    用 capturedAiFloorCount 约束——候选必须使 AI 总数相对捕获时增加（至少 +1）。
 * 6. 唯一性：候选恰好一个才绑定；多个候选返回 ambiguous，绝不猜最新一个。
 * 7. 没有候选：返回 pending_materialization，交给有界等待层重试。
 */
export function resolveGeneratedAiMessageIndex_ACU(options: ResolveGeneratedAiOptions_ACU): ResolveGeneratedAiResult_ACU {
    const { liveChat, intent } = options;
    if (!Array.isArray(liveChat) || !intent) {
        return { kind: 'invalid_intent', reason: 'missing_chat_or_intent' };
    }

    const isAi = (index: number): boolean => {
        if (index < 0 || index >= liveChat.length) return false;
        return isAiMessage_ACU(liveChat[index]);
    };

    // 正文事件提供的是数组下标，不允许被其他消息的同值 message_id 抢先匹配。
    // 目标是否仍为 AI 由既有 evaluateNewMessageAction_ACU 判断。
    if (intent.eventMessageIdKind === 'index') {
        return { kind: 'resolved', messageIndex: intent.eventMessageId };
    }

    const capturedLength = Number.isInteger(intent.capturedChatLength) ? (intent.capturedChatLength as number) : -1;
    const capturedAiCount = Number.isInteger(intent.capturedAiFloorCount) ? (intent.capturedAiFloorCount as number) : -1;
    const liveAiCount = countAiMessages_ACU(liveChat);

    // 1. 消息对象的稳定 message_id 与数组索引不是同一概念。仓库既有逻辑同样通过
    //    message_id 反查 runtime index（chat-service.ts / plot-logic.ts）。只接受唯一 AI 命中。
    if (Number.isInteger(intent.eventMessageId)) {
        const messageIdMatches: number[] = [];
        for (let index = 0; index < liveChat.length; index += 1) {
            if (liveChat[index]?.message_id === intent.eventMessageId && isAi(index)) {
                messageIdMatches.push(index);
            }
        }
        if (messageIdMatches.length === 1) {
            return { kind: 'resolved', messageIndex: messageIdMatches[0] };
        }
        if (messageIdMatches.length > 1) {
            return { kind: 'ambiguous', candidates: messageIdMatches };
        }
    }

    // 2. 没有稳定 message_id 命中时，兼容事件值直接作为零基数组索引的宿主版本。
    if (Number.isInteger(intent.eventMessageId)) {
        const exact = intent.eventMessageId as number;
        if (exact >= 0 && exact < liveChat.length && isAi(exact)) {
            return { kind: 'resolved', messageIndex: exact };
        }
    }

    // 3. 真实宿主日志已观测到 eventMessageId === capturedChatLength === liveChat.length，
    //    且捕获/实时 AI 数量相同：目标 AI 在事件时已物化于尾楼，但事件值使用一基楼层号。
    //    仅在所有边界均未变化且尾楼确为 AI 时接受该映射，避免把普通越界 ID 盲目 -1。
    if (
        Number.isInteger(intent.eventMessageId)
        && intent.eventMessageId === liveChat.length
        && capturedLength === liveChat.length
        && capturedAiCount === liveAiCount
        && isAi(liveChat.length - 1)
    ) {
        return { kind: 'resolved', messageIndex: liveChat.length - 1 };
    }

    const candidates: number[] = [];
    const consider = (index: number) => {
        if (isAi(index) && !candidates.includes(index)) candidates.push(index);
    };

    // 4. 捕获后新增区间
    if (capturedLength >= 0 && capturedLength <= liveChat.length) {
        for (let index = capturedLength; index < liveChat.length; index += 1) {
            consider(index);
        }
    }

    // 5. 锚点后受约束区间（仅当捕获长度不可靠或步骤 4 无候选时兜底）
    if (candidates.length === 0 && Number.isInteger(intent.eventMessageId) && capturedAiCount >= 0) {
        const anchor = intent.eventMessageId as number;
        if (liveAiCount > capturedAiCount) {
            for (let index = anchor + 1; index < liveChat.length; index += 1) {
                consider(index);
            }
        }
    }

    if (candidates.length === 1) {
        return { kind: 'resolved', messageIndex: candidates[0] };
    }
    if (candidates.length > 1) {
        return { kind: 'ambiguous', candidates };
    }
    return { kind: 'pending_materialization', candidates: [] };
}

/**
 * 评估新消息事件，决定应该执行什么操作
 * 
 * @param liveChat - 当前聊天记录数组
 * @param isAutoUpdating - 是否正在自动更新
 * @param coreApisReady - 核心 API 是否就绪
 * @param wasStoppedByUser - 是否被用户终止
 * @param contentOptimizationSettings - 正文优化设置
 * @param resolvedMessageIndex - 调度层已解析的本轮 AI 楼层索引；无 intent 的历史调用不传，保持"最后一条 AI 消息"旧语义
 * @returns MessageActionResult 包含 action 和 reason
 */
export function evaluateNewMessageAction_ACU(
    liveChat: any[],
    isAutoUpdating: boolean,
    coreApisReady: boolean,
    wasStoppedByUser: boolean,
    contentOptimizationSettings: any,
    resolvedMessageIndex?: number,
): MessageActionResult {
    if (wasStoppedByUser) {
        return { action: 'skip', reason: 'Skipping update check after user abort', skipReason: 'user_aborted' };
    }

    if (!coreApisReady) {
        return { action: 'skip', reason: 'Core APIs not ready', skipReason: 'core_apis_not_ready' };
    }

    if (!liveChat || liveChat.length === 0) {
        return { action: 'skip', reason: 'No chat data available', skipReason: 'empty_chat' };
    }

    const lastMessageIndex = resolvedMessageIndex !== undefined ? resolvedMessageIndex : liveChat.length - 1;
    const lastMessage = liveChat[lastMessageIndex];

    // 显式索引无效：调度层已解析出索引，但楼层已被删除/越界 → 专用原因，不笼统复用 last_message_not_ai。
    if (resolvedMessageIndex !== undefined && (!lastMessage || lastMessage.is_user || !isAiMessage_ACU(lastMessage))) {
        return { action: 'skip', reason: 'Resolved message is not an AI reply', skipReason: 'resolved_message_not_ai' };
    }

    // 无 intent 的历史路径：保持"最后一条 AI 消息"语义（若尾部不是 AI 则跳过）。
    if (resolvedMessageIndex === undefined && (!lastMessage || lastMessage.is_user)) {
        return { action: 'skip', reason: 'Last message is not an AI reply', skipReason: 'last_message_not_ai' };
    }

    // 当前角色只限定正文优化对象；聊天中的其他作者仍可唤醒按需填表。
    const activeChar = getCurrentCharacterFallback_ACU();
    const activeCharName = activeChar?.name;
    if (activeCharName && lastMessage.name && lastMessage.name !== activeCharName) {
        return { action: 'update_only', reason: 'Message author differs from the active character; checking table updates without content optimization', lastMessageIndex };
    }

    // 决定执行模式
    const config = contentOptimizationSettings || {};
    if (config.enabled) {
        if (config.parallelMode) {
            return { action: 'optimize_parallel', reason: 'Parallel mode enabled', lastMessageIndex };
        } else if (!config.autoApply && !config.seamlessMode) {
            return { action: 'optimize_manual', reason: 'Manual confirmation mode', lastMessageIndex };
        } else {
            return { action: 'optimize_then_update', reason: 'Sequential mode', lastMessageIndex };
        }
    }

    return { action: 'update_only', reason: 'No content optimization configured', lastMessageIndex };
}
