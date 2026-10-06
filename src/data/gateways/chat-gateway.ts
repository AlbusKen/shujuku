/**
 * data/gateways/chat-gateway.ts — 聊天数组访问网关
 *
 * 封装 SillyTavern_API_ACU.chat、saveChat()、stopGeneration()、
 * deleteLastMessage()、setChatMessages()、eventSource.emit() 等聊天相关操作。
 * service / presentation 层通过本模块访问聊天数组和触发宿主动作，不再直接调用宿主 API。
 *
 * 所有方法内置空值防御，宿主 API 不可用时返回安全默认值或静默跳过。
 */

import { jQuery_API_ACU, SillyTavern_API_ACU } from '../../shared/host-api';
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

/** 仅该错误证明保存尚未调用；其余保存异常均可能已提交到服务器。 */
export class HostChatSaveNotStartedError_ACU extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'HostChatSaveNotStartedError_ACU';
    }
}

function captureHostChatReadContext_ACU() {
    const api = SillyTavern_API_ACU;
    if (!api) throw new HostChatSaveNotStartedError_ACU('宿主聊天 API 不可用。');
    const { chat, chatId, characterId, groupId } = api;
    const group = groupId != null && groupId !== '';
    const character = api.characters?.[Number(characterId)];
    if (!Array.isArray(chat) || !chatId || (!group && !character?.avatar)) {
        throw new HostChatSaveNotStartedError_ACU('聊天保存确认缺少宿主聊天身份。');
    }
    return { api, chat, chatId, characterId, groupId, group, character };
}

function assertHostChatReadContext_ACU(context: ReturnType<typeof captureHostChatReadContext_ACU>): void {
    const { api, chat, chatId, characterId, groupId } = context;
    if (SillyTavern_API_ACU !== api || api.chat !== chat || api.chatId !== chatId
        || api.characterId !== characterId || api.groupId !== groupId) {
        throw new Error('保存或回读期间聊天已切换。');
    }
}

async function readHostChatWithinContext_ACU(context: ReturnType<typeof captureHostChatReadContext_ACU>): Promise<any[]> {
    assertHostChatReadContext_ACU(context);
    const { group, chatId, character } = context;
    const response = await fetch(group ? '/api/chats/group/get' : '/api/chats/get', {
        method: 'POST', cache: 'no-cache',
        headers: { ...getHostRequestHeaders_ACU(), 'Content-Type': 'application/json' },
        body: JSON.stringify(group ? { id: chatId } : {
            ch_name: character.name, file_name: chatId, avatar_url: character.avatar,
        }),
    });
    if (!response.ok) throw new Error(`聊天保存回读失败（HTTP ${response.status}）。`);
    const persisted = await response.json();
    assertHostChatReadContext_ACU(context);
    if (!Array.isArray(persisted)) throw new Error('聊天保存回读返回了无效消息列表。');
    const messages = group ? persisted : persisted.slice(1);
    if (messages.some(message => !message || typeof message !== 'object' || Array.isArray(message))) {
        throw new Error('聊天保存回读包含无效消息。');
    }
    return messages;
}

/** 只读服务器聊天，不保存、不替换宿主数组、不触发消息渲染。 */
export async function readChatFromHostStrict_ACU(): Promise<any[]> {
    return readHostChatWithinContext_ACU(captureHostChatReadContext_ACU());
}

/**
 * 执行必须真实提交到宿主的聊天保存。
 * 仅适用于后续会触发不可逆外置副作用的事务；宿主保存能力缺失时必须失败，不能静默跳过。
 * verify=true 时回读本轮聊天，避免宿主吞掉保存异常后误放行正文生成。
 */
export async function saveChatToHostStrict_ACU({ verify = false } = {}): Promise<void> {
    if (typeof SillyTavern_API_ACU?.saveChat !== 'function') {
        throw new HostChatSaveNotStartedError_ACU('宿主 saveChat 不可用，无法提交破坏性聊天数据变更。');
    }
    const api = SillyTavern_API_ACU;
    const context = verify ? captureHostChatReadContext_ACU() : null;
    await api.saveChat();
    if (context) {
        const messages = await readHostChatWithinContext_ACU(context);
        if (JSON.stringify(messages) !== JSON.stringify(context.chat)) {
            throw new Error('聊天保存未获确认：服务器消息与本轮楼层不一致。');
        }
    }
    notifyPostChatSaveListeners_ACU();
}

/** 撤销楼层后同步后续 DOM 编号，保持宿主按 mesid 定位消息的约定。 */
function removeRenderedUserMessage_ACU(index: number): void {
    jQuery_API_ACU?.(`#chat .mes[mesid="${index}"]`).remove();
    const root = jQuery_API_ACU?.('#chat')?.[0];
    root?.querySelectorAll<HTMLElement>('.mes[mesid]').forEach(node => {
        const id = node.getAttribute('mesid');
        if (!id || !/^\d+$/.test(id)) return;
        const messageIndex = Number(id);
        if (messageIndex > index) {
            node.setAttribute('mesid', String(messageIndex - 1));
        }
    });
}

/**
 * 创建正常用户楼层并渲染；只建楼，不启动 AI 生成。
 * 保存统一放在发送前任务返回后，不在建楼阶段回读或撤楼。
 */
export function createUserMessage_ACU(text: string): { chat: any[]; message: any; index: number } {
    const api = SillyTavern_API_ACU;
    const chat = getChatArray_ACU();
    const message = {
        name: api.name1,
        is_user: true,
        is_system: false,
        send_date: api.humanizedDateTime(),
        mes: text,
        extra: { isSmallSys: false },
    };
    const index = chat.length;
    chat.push(message);
    try {
        api.addOneMessage(message);
    } catch (error) {
        logWarn_ACU('[ChatGateway] 用户楼层渲染失败，保留消息并继续发送前任务:', error);
    }
    return { chat, message, index };
}

/**
 * 创建真实 AI 占位楼层（入 chat 数组并渲染）。
 * 任务成功后由宿主 Generate('regenerate') 自动删除该末楼；失败时随用户楼层一并删除。
 * 独立占位标记用于排除剧情上下文，不复用循环模式的规划层标记。
 */
export function createAiPlaceholderMessage_ACU(): { message: any; index: number } {
    const api = SillyTavern_API_ACU;
    const chat = getChatArray_ACU();
    const message = {
        name: api.name2,
        is_user: false,
        is_system: false,
        send_date: api.humanizedDateTime(),
        mes: '',
        extra: { isSmallSys: false },
        _qrf_plot_pending_placeholder: true,
    };
    const index = chat.length;
    chat.push(message);
    try {
        api.addOneMessage(message);
    } catch (error) {
        logWarn_ACU('[ChatGateway] AI 占位楼层渲染失败，保留消息并继续发送前任务:', error);
    }
    return { message, index };
}

/** 仅撤销本次发送创建的消息，不删除既有 user、历史回复或其他请求的楼层。 */
export async function removePlotSendMessages_ACU(chat: any[], messages: any[]): Promise<void> {
    if (getChatArray_ACU() !== chat) return;
    const indices = messages.map(message => chat.indexOf(message)).filter(index => index >= 0)
        .sort((a, b) => b - a);
    if (!indices.length) return;
    for (const index of indices) {
        chat.splice(index, 1);
        removeRenderedUserMessage_ACU(index);
    }
    await saveChatToHostStrict_ACU();
    await SillyTavern_API_ACU.eventSource.emit(SillyTavern_API_ACU.eventTypes.MESSAGE_DELETED, chat.length);
}

/** 删除本轮用户楼层，按消息对象定位，不影响历史回复。 */
export async function removeUserMessage_ACU(chat: any[], message: any): Promise<void> {
    const index = chat.indexOf(message);
    if (index < 0) return;
    chat.splice(index, 1);
    if (getChatArray_ACU() !== chat) return;
    removeRenderedUserMessage_ACU(index);
    await saveChatToHostStrict_ACU({ verify: true });
    await SillyTavern_API_ACU.eventSource.emit(SillyTavern_API_ACU.eventTypes.MESSAGE_DELETED, index);
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
 * 优先使用 eventTypes.MESSAGE_UPDATED，降级使用宿主事件名 'message_updated'
 * @param messageIndex 更新的消息索引
 */
export async function emitMessageUpdated_ACU(messageIndex: number): Promise<void> {
    if (!SillyTavern_API_ACU?.eventSource?.emit) {
        logWarn_ACU('[ChatGateway] eventSource.emit 不可用，跳过事件通知');
        return;
    }
    if (SillyTavern_API_ACU?.eventTypes?.MESSAGE_UPDATED) {
        await SillyTavern_API_ACU.eventSource.emit(
            SillyTavern_API_ACU.eventTypes.MESSAGE_UPDATED,
            messageIndex
        );
    } else {
        // 降级：直接使用字符串事件名
        await SillyTavern_API_ACU.eventSource.emit('message_updated', messageIndex);
    }
}


/**
 * 更新指定楼层正文后派发 MESSAGE_UPDATED，等待扩展完成本轮渲染通知。
 * 仅做界面刷新，失败不影响已持久化的数据。
 * @param messageIndex 需要重渲染的消息下标
 */
export async function refreshMessageBlock_ACU(messageIndex: number): Promise<void> {
    const message = SillyTavern_API_ACU?.chat?.[messageIndex];
    try {
        if (message && typeof SillyTavern_API_ACU?.updateMessageBlock === 'function') {
            SillyTavern_API_ACU.updateMessageBlock(messageIndex, message, { rerenderMessage: true });
        }
    } catch (error: any) {
        logWarn_ACU(`[ChatGateway] updateMessageBlock 失败，降级为 MESSAGE_UPDATED：${error?.message || error}`);
    }
    try {
        await emitMessageUpdated_ACU(messageIndex);
    } catch (error: any) {
        logWarn_ACU(`[ChatGateway] MESSAGE_UPDATED 渲染通知失败：${error?.message || error}`);
    }
}
