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

/**
 * ═══ 宿主存盘合并调度（自动填表运行期节流）═══
 *
 * 病灶：自动填表每批都 await saveChatToHost_ACU()，每次 = 宿主全量序列化整个聊天并排进
 * 宿主全局串行保存队列；90MB 级大聊天每次数十秒，一轮填表 N 批 = N 次全量存盘，
 * 队列被占满期间用户发送链（宿主 sendMessageAsUser→saveChatConditional 同队列）冻结。
 * 批间是串行的（AI 等待 ≫ 存盘时长），纯 in-flight 合并命中不了，因此做
 * 「运行期延迟 + 尾随补存 + 强制冲洗点」：
 * - 运行期（openChatSaveCoalescing 窗口内）调用只置脏、立即返回，不占调用方批间隙；
 * - 真实存盘一旦在途，后续调用合并进尾随环（do/while 脏标记），不重复排宿主队列；
 * - 运行窗口结束由调用方 close + forceFlushChatSave_ACU() 显式收敛；
 * - DEFER_MAX 安全定时器兜底：运行期超过该时长没有真存盘就强制补存一次，
 *   防止运行迟迟不结束导致永不落盘；
 * - strict 全量存盘成功即超集覆盖（同一聊天数组的整体序列化），直接清脏并重置节流时钟；
 * - 失败保脏：真存盘抛错时脏标记回填（本轮未落盘），留给下一触发点
 *   （coalesced 调用 / forceFlush / DEFER_MAX 定时器）重试；首调 await 仍感知本次失败；
 * - 脏归属比对：脏标记与兜底定时器各只有一份全局单例，而宿主 saveChat 只能存当前聊天——
 *   置脏时登记当时的聊天 key，真存 / 强制冲洗 / 定时器触发前比对当前聊天：异聊天的旧脏
 *   直接作废（logWarn，宿主切聊天自带保存兜底），既不冒领到新聊天头上也不排宿主队列；
 *   聊天身份不可判定（宿主未暴露 id）时按同聊天处理，宁保守不误弃。
 * 白名单制：默认不合并，仅自动填表热路径接入；其余约百个存盘点维持逐次真存盘语义。
 */

/** 运行期延迟上限：超过该时长没有真存盘，安全定时器强制真存一次（防运行不结束永不落盘）。 */
const CHAT_SAVE_COALESCE_DEFER_MAX_MS_ACU = 120000;
/** 合并运行窗口深度（open/close 计数，允许嵌套运行；close 到 0 不自动冲洗）。 */
let _saveCoalesceDepth = 0;
/** 有已被延迟或在途期间新产生的改动等待补存。 */
let _saveDirty = false;
/** _saveDirty 归属的聊天标识（置脏时登记）；null=脏未登记归属或无脏，按同聊天处理。 */
let _saveDirtyChatKey: string | null = null;
/** 正在执行的合并真存盘环（含尾随补存），null=空闲。 */
let _saveInFlight: Promise<void> | null = null;
/** 最近一次真存盘（含 strict 成功）完成的时刻，用于 DEFER_MAX 节流判定。 */
let _lastRealSaveAt = 0;
/** DEFER_MAX 兜底定时器（一次性，挂起中非 null）。 */
let _saveDeferTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 当前聊天标识（脏归属比对用）。宿主 getCurrentChatId 优先，退回 api.chatId / api.this_chid；
 * 全缺失返回 null=不可判定，按同聊天处理（保持旧行为，宁保守不误弃）。
 */
function currentChatKey_ACU(): string | null {
    const api = SillyTavern_API_ACU;
    if (!api) return null;
    const viaGetter = typeof api.getCurrentChatId === 'function' ? api.getCurrentChatId() : null;
    const key = viaGetter ?? api.chatId ?? api.this_chid;
    return key == null ? null : String(key);
}

/**
 * 置脏并登记归属聊天。已有异聊天的脏时：宿主 saveChat 只能存当前聊天，旧聊天脏本来就
 * 存不了——弃旧记新并 logWarn（宿主切聊天自带保存兜底），不冒领。
 */
function markSaveDirty_ACU(): void {
    const key = currentChatKey_ACU();
    if (_saveDirty && _saveDirtyChatKey !== null && key !== null && key !== _saveDirtyChatKey) {
        logWarn_ACU('[ChatGateway] 存盘合并：切换聊天，前一聊天的合并存盘作废（宿主切聊天自带保存兜底）。');
        _saveDirtyChatKey = key;
    } else if (!_saveDirty || _saveDirtyChatKey === null) {
        _saveDirtyChatKey = key;
    }
    _saveDirty = true;
}

/**
 * 脏归属是否仍属当前聊天。未登记（null=不可判定）按同聊天放行；
 * 异聊天时作废旧脏（丢弃归属，不排宿主队列），返回 false。
 */
function discardDirtyIfForeign_ACU(scene: string): boolean {
    if (_saveDirtyChatKey === null) return true;
    const key = currentChatKey_ACU();
    if (key === null || key === _saveDirtyChatKey) return true;
    logWarn_ACU(`[ChatGateway] 存盘合并：${scene}时聊天已切换，旧聊天脏标记作废（宿主切聊天自带保存兜底）。`);
    _saveDirty = false;
    _saveDirtyChatKey = null;
    return false;
}

/** 开启存盘合并运行窗口（可嵌套）。窗口内 saveChatToHostCoalesced_ACU 只延迟不排队。 */
export function openChatSaveCoalescing_ACU(): void {
    _saveCoalesceDepth += 1;
}

/** 关闭存盘合并运行窗口（深度-1）。冲洗由调用方显式 forceFlushChatSave_ACU() 完成。 */
export function closeChatSaveCoalescing_ACU(): void {
    if (_saveCoalesceDepth > 0) _saveCoalesceDepth -= 1;
}

/**
 * 启动一次合并真存盘环：清脏→真存→若存盘期间又脏则续存，直到不脏。
 * 整个环挂 _saveInFlight；重复调用直接复用已在途的环（不重复排宿主队列）。
 * 首个调用方的 await 会感知 saveChat 抛错（保持 saveChatToHost_ACU 的失败语义供回滚）。
 * 失败保脏：saveChat 抛错时本轮并未落盘，先把刚清掉的脏回填再重抛——留给下一触发点
 * （coalesced 调用 / forceFlush / DEFER_MAX 定时器）重试；定时器路径本就 catch 吞错+logWarn，
 * 失败保脏后其下次触发还会再试，语义自洽。
 * 归属比对：真存（含尾随环每一轮）前脏若已属异聊天则直接作废并结束本轮，
 * 不冒领到新聊天头上；全部真存成功后清除脏归属。
 */
function startCoalescedRealSave_ACU(): Promise<void> {
    if (_saveInFlight) return _saveInFlight;
    const run: Promise<void> = (async () => {
        do {
            if (!discardDirtyIfForeign_ACU('合并真存盘')) break;
            _saveDirty = false;
            try {
                await saveChatToHost_ACU();
                _lastRealSaveAt = Date.now();
            } catch (error) {
                _saveDirty = true;   // 本轮未落盘，脏留给下一触发点/forceFlush 重试
                throw error;         // 首个调用方的失败感知语义不变
            }
        } while (_saveDirty);
        _saveDirtyChatKey = null;
    })().finally(() => {
        if (_saveInFlight === run) _saveInFlight = null;
    });
    _saveInFlight = run;
    return run;
}

/**
 * 存盘合并版 saveChatToHost_ACU（白名单热路径专用）：
 * 1. 宿主 saveChat 不可用 → 与 saveChatToHost_ACU 同款静默跳过 + logWarn；
 * 2. 在途 → 置脏并 await 在途环即返回（尾随环会补存，不重复排宿主队列）；
 * 3. 运行期且距上次真存盘未达 DEFER_MAX → 置脏、挂兜底定时器、立即返回（不 await，
 *    这是不占调用方批间隙的关键）；
 * 4. 其余情况（非运行期，或运行期已超过 DEFER_MAX）→ 同步执行真存盘环并等待完成。
 */
export async function saveChatToHostCoalesced_ACU(): Promise<void> {
    if (typeof SillyTavern_API_ACU?.saveChat !== 'function') {
        logWarn_ACU('[ChatGateway] saveChat 不可用，跳过保存');
        return;
    }
    if (_saveInFlight) {
        markSaveDirty_ACU();
        await _saveInFlight;
        return;
    }
    if (_saveCoalesceDepth > 0 && Date.now() - _lastRealSaveAt < CHAT_SAVE_COALESCE_DEFER_MAX_MS_ACU) {
        markSaveDirty_ACU();
        if (_saveDeferTimer === null) {
            _saveDeferTimer = setTimeout(() => {
                // 定时器自清；若脏已被 forceFlush 或 strict 清掉，则不空转一次全量存盘。
                // 归属比对：脏属异聊天时直接作废不排队列（宿主切聊天自带保存兜底）。
                // 失败保脏：真存失败时脏留驻，但一次性定时器已清——下一次 coalesced 调用
                // 重新挂定时器再试，无新调用则等 forceFlush 收敛。
                _saveDeferTimer = null;
                if (!_saveDirty || _saveInFlight) return;
                if (!discardDirtyIfForeign_ACU('兜底定时器')) return;
                void startCoalescedRealSave_ACU().catch((error: any) => {
                    logWarn_ACU('[ChatGateway] 存盘合并兜底定时器补存失败:', error?.message || error);
                });
            }, CHAT_SAVE_COALESCE_DEFER_MAX_MS_ACU - (Date.now() - _lastRealSaveAt));
        }
        return;
    }
    await startCoalescedRealSave_ACU();
}

/**
 * 强制冲洗点：在途 → await 在途环（尾随环自然清脏）；空闲且有脏 → 真存；无脏 → no-op。
 * 永不抛——冲洗点位于用户路径（聊天切换、页面卸载、运行收尾），不能炸宿主链路，
 * 失败只 logWarn，脏状态留给下一个触发点。
 * 异聊天 no-op：本函数不跨聊天补存（宿主 saveChat 只能存当前聊天，旧聊天脏存不了；
 * 宿主切聊天自带保存兜底），归属不符时作废旧脏直接返回。
 */
export async function forceFlushChatSave_ACU(): Promise<void> {
    try {
        if (_saveDeferTimer !== null) {
            clearTimeout(_saveDeferTimer);
            _saveDeferTimer = null;
        }
        if (_saveInFlight) {
            // 尾随环会顺带清脏；但若调用方恰在环的最后一次脏检查与环清理之间置脏
            // （微任务边界的窄竞态），脏会漏在环外——下面对脏的复检把这轮漏脏补掉。
            await _saveInFlight;
        }
        if (_saveDirty && discardDirtyIfForeign_ACU('强制冲洗')) await startCoalescedRealSave_ACU();
    } catch (error: any) {
        logWarn_ACU('[ChatGateway] 存盘合并强制冲洗失败:', error?.message || error);
    }
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
    // strict 全量落盘成功 = 对当前聊天数组的超集覆盖：合并调度器的脏标记可安全清除，
    // 并重置节流时钟（运行期内的 strict 存盘同样算作一次真存盘）。
    // 归属比对：strict 存的是当前聊天——同聊天（或未登记归属）才清脏；
    // 异聊天的旧脏 strict 覆盖不到（宿主只能存当前聊天），直接作废并 logWarn，
    // 不留脏标记与归属（不变量：无脏必无归属 key，否则后续触发点会误比对告警）。
    discardDirtyIfForeign_ACU('strict 存盘成功');
    _saveDirty = false;
    _saveDirtyChatKey = null;
    _lastRealSaveAt = Date.now();
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
    try {
        const characters = SillyTavern_API_ACU?.characters;
        if (!Array.isArray(characters)) throw new Error('角色列表不可用');
        const names = new Set<string>();
        const headers = { ...getHostRequestHeaders_ACU() };
        if (!headers['Content-Type'] && !headers['content-type']) {
            headers['Content-Type'] = 'application/json';
        }
        for (const character of characters) {
            const avatar = typeof character?.avatar === 'string' ? character.avatar.trim() : '';
            if (!avatar) throw new Error('角色条目缺少有效身份');
            const response = await fetch('/api/characters/chats', {
                method: 'POST',
                headers,
                body: JSON.stringify({ avatar_url: avatar, simple: true }),
            });
            if (!response.ok) throw new Error('角色聊天请求失败');
            const payload = await response.json();
            // 宿主 simple 成功契约为数组；{error:true} 也用于服务端异常，不能证明为空。
            if (!Array.isArray(payload)) throw new Error('角色聊天响应格式无效');
            for (const entry of payload) {
                const fileName = typeof entry?.file_name === 'string' ? entry.file_name.trim() : '';
                if (!fileName) throw new Error('聊天条目缺少文件名');
                const normalized = cleanChatName_ACU(fileName);
                if (!normalized) throw new Error('聊天名称无效');
                names.add(normalized);
            }
        }
        const groups = (globalThis as any).SillyTavern?.getContext?.()?.groups
            ?? (SillyTavern_API_ACU as any)?.groups;
        if (!Array.isArray(groups)) throw new Error('群组列表不可用');
        for (const group of groups) {
            if (!Array.isArray(group?.chats)) throw new Error('群组聊天列表无效');
            for (const chatId of group.chats) {
                // 兼容宿主历史数字 ID，但不把对象、布尔值或空值强制转换为名称。
                if (typeof chatId !== 'string' && !(typeof chatId === 'number' && Number.isFinite(chatId))) {
                    throw new Error('群组聊天身份无效');
                }
                const normalized = cleanChatName_ACU(String(chatId).trim());
                if (!normalized) throw new Error('群组聊天名称无效');
                names.add(normalized);
            }
        }
        return names;
    } catch {
        logWarn_ACU('[ChatGateway] 无法完整枚举角色与群组聊天，本轮禁止孤儿清理。');
        return null;
    }
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
 * 更新指定楼层正文后通知扩展，等待本轮渲染通知完成。
 * 仅做界面刷新，失败不影响已持久化的数据。
 * @param messageIndex 需要重渲染的消息下标
 * @param options.notify 为 false 时只重渲染，不广播刷新事件
 * @param options.event 默认为 updated；rendered 用于正文重画后重建 HTML 前端，
 * 与宿主的扩展消息刷新约定一致，不伪造消息交付或用户编辑事件。
 */
export async function refreshMessageBlock_ACU(messageIndex: number, options: { notify?: boolean; event?: 'updated' | 'rendered' } = {}): Promise<void> {
    const message = SillyTavern_API_ACU?.chat?.[messageIndex];
    try {
        if (message && typeof SillyTavern_API_ACU?.updateMessageBlock === 'function') {
            SillyTavern_API_ACU.updateMessageBlock(messageIndex, message, { rerenderMessage: true });
        }
    } catch (error: any) {
        logWarn_ACU(`[ChatGateway] updateMessageBlock 失败，尝试派发消息刷新通知：${error?.message || error}`);
    }
    if (options.notify === false) return;
    try {
        if (options.event === 'rendered') {
            if (!message || !SillyTavern_API_ACU?.eventSource?.emit) return;
            const eventName = message.is_user
                ? (SillyTavern_API_ACU.eventTypes?.USER_MESSAGE_RENDERED || 'user_message_rendered')
                : (SillyTavern_API_ACU.eventTypes?.CHARACTER_MESSAGE_RENDERED || 'character_message_rendered');
            await SillyTavern_API_ACU.eventSource.emit(eventName, messageIndex, 'extension');
        } else {
            await emitMessageUpdated_ACU(messageIndex);
        }
    } catch (error: any) {
        logWarn_ACU(`[ChatGateway] 消息刷新通知失败：${error?.message || error}`);
    }
}
