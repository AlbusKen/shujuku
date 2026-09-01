/**
 * data/gateways/chat-gateway.ts — 聊天数组访问网关
 *
 * 封装 SillyTavern_API_ACU.chat、saveChat()、stopGeneration()、
 * deleteLastMessage()、setChatMessages()、eventSource.emit() 等聊天相关操作。
 * service / presentation 层通过本模块访问聊天数组和触发宿主动作，不再直接调用宿主 API。
 *
 * 所有方法内置空值防御，宿主 API 不可用时返回安全默认值或静默跳过。
 */

import { SillyTavern_API_ACU } from '../../shared/host-api';
import { cleanChatName_ACU, logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { getHostRequestHeaders_ACU } from './ai-gateway';

/**
 * 获取当前聊天数组的引用
 * @returns 聊天消息数组，不可用时返回 []
 */
export function getChatArray_ACU(): any[] {
    return SillyTavern_API_ACU?.chat || [];
}

/**
 * 获取当前聊天数组的长度
 * @returns 消息数量
 */
export function getChatLength_ACU(): number {
    return SillyTavern_API_ACU?.chat?.length || 0;
}

/**
 * 获取最后一条消息的索引
 * @returns 最后消息索引，空聊天返回 0
 */
export function getLastMessageIndex_ACU(): number {
    return Math.max(0, getChatLength_ACU() - 1);
}

/** 插件保存成功后的监听回调（如删楼守卫的保管库同步）。 */
const postChatSaveListeners_ACU: Array<() => void> = [];

/**
 * 注册插件聊天保存成功后的回调。
 * 回调同步执行，异常被吞掉并记录，不影响保存契约本身。
 */
export function registerPostChatSaveListener_ACU(listener: () => void): void {
    postChatSaveListeners_ACU.push(listener);
}

function notifyPostChatSaveListeners_ACU(): void {
    for (const listener of postChatSaveListeners_ACU) {
        try {
            listener();
        } catch (error: any) {
            logWarn_ACU('[ChatGateway] post-save 监听回调异常:', error?.message || error);
        }
    }
}

/**
 * 触发聊天保存到宿主平台
 * 内置存在性检查，saveChat 不可用时静默跳过
 */
export async function saveChatToHost_ACU(): Promise<void> {
    if (typeof SillyTavern_API_ACU?.saveChat !== 'function') {
        logWarn_ACU('[ChatGateway] saveChat 不可用，跳过保存');
        return;
    }
    await SillyTavern_API_ACU.saveChat();
    notifyPostChatSaveListeners_ACU();
}

/**
 * 执行必须真实提交到宿主的聊天保存。
 * 仅适用于后续会触发不可逆外置副作用的事务；宿主保存能力缺失时必须失败，不能静默跳过。
 */
export async function saveChatToHostStrict_ACU(): Promise<void> {
    if (typeof SillyTavern_API_ACU?.saveChat !== 'function') {
        throw new Error('宿主 saveChat 不可用，无法提交破坏性聊天数据变更。');
    }
    await SillyTavern_API_ACU.saveChat();
    notifyPostChatSaveListeners_ACU();
}

// ═══ 宿主动作 ═══

/**
 * 停止当前正在进行的 AI 生成
 * 内置存在性检查，stopGeneration 不可用时静默跳过
 */
export function stopGeneration_ACU(): void {
    if (typeof SillyTavern_API_ACU?.stopGeneration !== 'function') {
        logWarn_ACU('[ChatGateway] stopGeneration 不可用，跳过');
        return;
    }
    SillyTavern_API_ACU.stopGeneration();
    logDebug_ACU('[ChatGateway] 已调用 stopGeneration');
}

/**
 * 删除最后一条聊天消息
 * 内置存在性检查，deleteLastMessage 不可用时静默跳过
 */
export async function deleteLastMessage_ACU(): Promise<void> {
    if (typeof SillyTavern_API_ACU?.deleteLastMessage !== 'function') {
        logWarn_ACU('[ChatGateway] deleteLastMessage 不可用，跳过');
        return;
    }
    await SillyTavern_API_ACU.deleteLastMessage();
}

/**
 * 通过宿主 API 更新聊天消息内容
 * @param messages 要更新的消息数组（包含 message_id、mes、extra 等字段）
 * @param options 更新选项（如 { refresh: 'affected' }）
 * 内置存在性检查，setChatMessages 不可用时返回 false
 * @returns 是否成功调用了 setChatMessages
 */
export async function setChatMessages_ACU(
    messages: any[],
    options?: { refresh?: string; [key: string]: any }
): Promise<boolean> {
    if (typeof SillyTavern_API_ACU?.setChatMessages !== 'function') {
        logWarn_ACU('[ChatGateway] setChatMessages 不可用');
        return false;
    }
    await SillyTavern_API_ACU.setChatMessages(messages, options);
    return true;
}

// ═══ 全量聊天枚举 ═══

/**
 * 枚举宿主上全部存活聊天的归一化名称（角色聊天 + 群组聊天）。
 *
 * 用于向量存档孤儿判定：只有确认某个 chatKey 在全酒馆范围内不存在同名存活聊天
 * （聊天文件名不含角色作用域，跨角色可重名），才允许删除其向量数据。
 *
 * fail-safe 契约：任一环节无法保证枚举完整性（characters 列表不可用、任一角色的
 * 聊天列表请求失败、响应形状非预期）时返回 null，调用方必须视为"无法判定"并跳过
 * 删除，绝不能把残缺枚举当成完整集合使用。
 */
export async function listAllHostChatNames_ACU(): Promise<Set<string> | null> {
    const characters = SillyTavern_API_ACU?.characters;
    if (!Array.isArray(characters)) {
        logWarn_ACU('[ChatGateway] characters 列表不可用，无法枚举全部聊天');
        return null;
    }
    const names = new Set<string>();
    const headers = getHostRequestHeaders_ACU();
    if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
    }
    for (const character of characters) {
        const avatar = String(character?.avatar || '').trim();
        if (!avatar) continue;
        try {
            const response = await fetch('/api/characters/chats', {
                method: 'POST',
                headers,
                body: JSON.stringify({ avatar_url: avatar, simple: true }),
            });
            if (!response.ok) {
                logWarn_ACU(`[ChatGateway] 枚举角色聊天失败（HTTP ${response.status}）：${avatar}`);
                return null;
            }
            const payload = await response.json();
            // 无聊天时部分版本返回 {error: true}，视为空集而非失败。
            if (payload && typeof payload === 'object' && !Array.isArray(payload) && (payload as any).error) {
                continue;
            }
            const entries = Array.isArray(payload) ? payload : Object.values(payload || {});
            for (const entry of entries) {
                const fileName = String((entry as any)?.file_name || '').trim();
                if (!fileName) continue;
                const normalized = cleanChatName_ACU(fileName);
                if (normalized) names.add(normalized);
            }
        } catch (error: any) {
            logWarn_ACU(`[ChatGateway] 枚举角色聊天异常：${avatar}: ${error?.message || error}`);
            return null;
        }
    }
    try {
        const groups = (globalThis as any).SillyTavern?.getContext?.()?.groups
            ?? (SillyTavern_API_ACU as any)?.groups;
        if (Array.isArray(groups)) {
            for (const group of groups) {
                const groupChats = Array.isArray(group?.chats) ? group.chats : [];
                for (const chatId of groupChats) {
                    const normalized = cleanChatName_ACU(String(chatId || ''));
                    if (normalized) names.add(normalized);
                }
            }
        }
    } catch (error: any) {
        logWarn_ACU(`[ChatGateway] 枚举群组聊天异常：${error?.message || error}`);
        return null;
    }
    return names;
}

/**
 * 触发消息更新事件通知宿主平台
 * 优先使用 eventTypes.MESSAGE_UPDATED，降级使用字符串 'MESSAGE_UPDATED'
 * @param messageIndex 更新的消息索引
 */
export function emitMessageUpdated_ACU(messageIndex: number): void {
    if (!SillyTavern_API_ACU?.eventSource?.emit) {
        logWarn_ACU('[ChatGateway] eventSource.emit 不可用，跳过事件通知');
        return;
    }
    if (SillyTavern_API_ACU?.eventTypes?.MESSAGE_UPDATED) {
        SillyTavern_API_ACU.eventSource.emit(
            SillyTavern_API_ACU.eventTypes.MESSAGE_UPDATED,
            messageIndex
        );
    } else {
        // 降级：直接使用字符串事件名
        SillyTavern_API_ACU.eventSource.emit('MESSAGE_UPDATED', messageIndex);
    }
}
