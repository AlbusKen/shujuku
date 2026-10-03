/**
 * presentation/components/plot-pending-disguise.ts — 剧情推进期间的伪装发送楼层
 *
 * 宿主 Generate() 要等 GENERATION_AFTER_COMMANDS 的监听全部结束，才读取 #send_textarea 并让用户楼层入楼；
 * 剧情推进在该事件里等待规划，用户消息因此一直停在输入框。规划期间本模块：
 *   - 在 #chat 末尾渲染伪装的用户楼层与“思考中”的 AI 楼层（纯 DOM，不写 chat 数组、不触发保存）；
 *   - 清空发送框并拦截重复发送（宿主此时尚未置 is_send_press，空发送框会被当作空输入直接生成）；
 *   - 成功后写回提取出的发送正文，由宿主原发送流程创建真实用户楼层；
 *     规划期间的新草稿在本次入楼确认后还原。
 */
import { jQuery_API_ACU, SillyTavern_API_ACU } from '../../shared/host-api';
import { getSendTextareaValue_ACU, setSendTextareaValue_ACU } from '../../shared/host-input';
import { getChatArray_ACU, stopGeneration_ACU } from '../../data/gateways/chat-gateway';
import { currentChatFileIdentifier_ACU } from '../../service/runtime/state-manager';
import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { showToastr_ACU } from '../theme/toast';

const PENDING_CLASS_ACU = 'acu-plot-pending-mes';
const STYLE_ID_ACU = 'acu-plot-pending-disguise-style';
const DRAFT_RESTORE_TIMEOUT_MS_ACU = 60_000;
const BLOCK_TOAST_INTERVAL_MS_ACU = 2_000;

// 伪装楼层只用于展示：隐藏操作按钮与编号，禁用指针事件，避免宿主按空 mesid 误操作真实楼层。
const PENDING_STYLE_ACU = `
.mes.${PENDING_CLASS_ACU} { pointer-events: none; }
.mes.${PENDING_CLASS_ACU} .mes_buttons,
.mes.${PENDING_CLASS_ACU} .mes_edit_buttons,
.mes.${PENDING_CLASS_ACU} .for_checkbox,
.mes.${PENDING_CLASS_ACU} .del_checkbox,
.mes.${PENDING_CLASS_ACU} .swipe_left,
.mes.${PENDING_CLASS_ACU} .swipe_right,
.mes.${PENDING_CLASS_ACU} .swipeRightBlock,
.mes.${PENDING_CLASS_ACU} .mesIDDisplay,
.mes.${PENDING_CLASS_ACU} .mes_timer,
.mes.${PENDING_CLASS_ACU} .tokenCounterDisplay,
.mes.${PENDING_CLASS_ACU} .mes_ghost,
.mes.${PENDING_CLASS_ACU} .mes_reasoning_details,
.mes.${PENDING_CLASS_ACU} .mes_bias { display: none !important; }
.acu-plot-pending-thinking { animation: acu-plot-pending-pulse 1.4s ease-in-out infinite; }
@keyframes acu-plot-pending-pulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 0.9; } }
@media (prefers-reduced-motion: reduce) { .acu-plot-pending-thinking { animation: none; opacity: 0.7; } }
`;

/** 伪装期间拦截重复发送时的提示文案；召回与剧情推进共用同一伪装实例，按当前阶段切换。 */
export interface PendingDisguiseNotice_ACU {
  message: string;
  title: string;
}

export const PLOT_PENDING_NOTICE_ACU: PendingDisguiseNotice_ACU = {
  message: '剧情推进中，完成后会自动发送当前消息。',
  title: '剧情推进',
};

export const SUMMARY_RECALL_PENDING_NOTICE_ACU: PendingDisguiseNotice_ACU = {
  message: '正在召回相关纪要，完成后会自动发送当前消息。',
  title: '纪要召回',
};

/**
 * 宿主会在监听结束后读取发送框入楼的生成类型才允许伪装。
 * regenerate / swipe / impersonate / quiet 不把发送框作为用户楼层发送，伪装会凭空多出用户楼层。
 */
const NON_SENDING_GENERATION_TYPES_ACU = new Set(['regenerate', 'swipe', 'impersonate', 'quiet']);

export function isPendingDisguiseGenerationType_ACU(type: unknown): boolean {
  return !NON_SENDING_GENERATION_TYPES_ACU.has(String(type ?? ''));
}

export interface PlotPendingDisguiseHandle_ACU {
  /** 用户点击发送时发送框里的原文 */
  readonly originalText: string;
  /** 切换拦截重复发送时的提示文案（例如召回结束、进入剧情推进）。 */
  setNotice(notice: PendingDisguiseNotice_ACU): void;
  /** 等待已失效时只撤销展示与拦截，不写入当前会话的发送框。 */
  discard(): void;
  /** 写回正文并交还宿主；waitForMessage 在真实入楼后恢复等待期间的草稿；空文本走取消。幂等。 */
  release(textForHost: string, options?: { restoreDraft?: string; waitForMessage?: boolean }): boolean;
}

let activeDisguise_ACU: PlotPendingDisguiseHandle_ACU | null = null;

interface PendingHandoff_ACU {
  element: HTMLElement | undefined;
  chat: any[];
  chatKey: string;
  startIndex: number;
  expected: string;
  draft: string;
  unblock: () => void;
  timer: ReturnType<typeof setTimeout>;
}
let pendingHandoff_ACU: PendingHandoff_ACU | null = null;
const normalizePrompt_ACU = (text: unknown): string => String(text ?? '').replace(/\r\n?/g, '\n').trim();

/** 写回提取出的发送正文；仅保留本轮入楼确认与草稿恢复状态，不改变宿主发送流程。 */
export function handoffPlotPendingSend_ACU(text: string, draft = ''): boolean {
  if (pendingHandoff_ACU || !text.trim()) return false;
  if (!setSendTextareaValue_ACU(text)) return false;
  const element = jQuery_API_ACU?.('#send_textarea')?.[0];
  const chat = getChatArray_ACU();
  const handoff: PendingHandoff_ACU = {
    element, chat, chatKey: currentChatFileIdentifier_ACU, startIndex: chat.length,
    expected: normalizePrompt_ACU(text), draft,
    unblock: element ? installSendBlock_ACU(element.ownerDocument, () => PLOT_PENDING_NOTICE_ACU) : () => {},
    timer: setTimeout(() => {
      if (pendingHandoff_ACU !== handoff) return;
      // 不恢复待发送正文：超时只清空并停止，避免迟到的宿主读到下一轮草稿。
      disposePlotPendingHandoff_ACU(false);
      stopGeneration_ACU();
      logWarn_ACU('[剧情推进] 未收到真实用户楼层确认，已停止发送交接。');
      showToastr_ACU('warning', '未收到用户楼层确认，本次发送已停止。', '剧情推进');
    }, DRAFT_RESTORE_TIMEOUT_MS_ACU),
  };
  pendingHandoff_ACU = handoff;
  return true;
}

/** 同一聊天新增用户楼层的 MESSAGE_SENT 是确认；无事件回退才比较正文，清空 input 不是确认。 */
export function confirmPlotPendingHandoff_ACU(messageId?: unknown): boolean {
  const handoff = pendingHandoff_ACU;
  if (!handoff || getChatArray_ACU() !== handoff.chat || currentChatFileIdentifier_ACU !== handoff.chatKey) return false;
  if (messageId !== undefined) {
    const index = typeof messageId === 'number' && Number.isInteger(messageId) ? messageId : -1;
    // 宿主在入楼前处理用户输入正则、宏与附件，最终正文不一定与 textarea 逐字相同。
    if (index !== handoff.startIndex || !handoff.chat[index]?.is_user || handoff.chat[index]?.is_system) return false;
  } else {
    if (!handoff.chat.slice(handoff.startIndex).some(message => message?.is_user && !message?.is_system
        && normalizePrompt_ACU(message.mes) === handoff.expected)) return false;
  }
  disposePlotPendingHandoff_ACU(true);
  return true;
}

/** 终态或聊天切换清理；恢复草稿仅限已确认入楼的同一输入框。 */
export function disposePlotPendingHandoff_ACU(consumed = false): void {
  if (!consumed) activeDisguise_ACU?.discard();
  const handoff = pendingHandoff_ACU;
  if (!handoff) return;
  pendingHandoff_ACU = null;
  clearTimeout(handoff.timer);
  handoff.unblock();
  const draft = handoff.draft;
  const sameChat = getChatArray_ACU() === handoff.chat && currentChatFileIdentifier_ACU === handoff.chatKey;
  if (sameChat && normalizePrompt_ACU(getSendTextareaValue_ACU()) === handoff.expected) setSendTextareaValue_ACU('');
  if (consumed && draft) {
    const chat = handoff.chat;
    const chatKey = handoff.chatKey;
    // MESSAGE_SENT 后某些宿主仍会清空 textarea，等当前事件分发任务结束再恢复。
    setTimeout(() => {
      if (getChatArray_ACU() === chat && currentChatFileIdentifier_ACU === chatKey
          && jQuery_API_ACU?.('#send_textarea')?.[0] === handoff.element
          && !getSendTextareaValue_ACU()) setSendTextareaValue_ACU(draft);
    }, 0);
  }
}

/** 插件模式下 SillyTavern_API_ACU 是 getContext() 快照的 Proxy；否则尝试调用 getContext()。 */
function getHostContext_ACU(): any {
  const api: any = SillyTavern_API_ACU;
  try {
    return typeof api?.getContext === 'function' ? api.getContext() : api;
  } catch {
    return api;
  }
}

function ensureStyle_ACU(doc: Document): void {
  if (doc.getElementById(STYLE_ID_ACU)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID_ACU;
  style.textContent = PENDING_STYLE_ACU;
  (doc.head || doc.documentElement).appendChild(style);
}

function formatMessageHtml_ACU(ctx: any, text: string, name: string): string | null {
  try {
    if (typeof ctx?.messageFormatting === 'function') {
      // 与宿主 addOneMessage 相同的格式化与净化链路；messageId=-1 表示不关联任何真实楼层。
      return String(ctx.messageFormatting(text, name, false, true, -1));
    }
  } catch (error) {
    logWarn_ACU('[剧情推进] 伪装楼层格式化失败，改用纯文本显示:', error);
  }
  return null;
}

function findLastAvatarSrc_ACU($chat: JQuery<HTMLElement>, isUser: boolean): string {
  const selector = isUser ? '.mes[is_user="true"]' : '.mes[is_user="false"][is_system="false"]';
  return String($chat.children(selector).not(`.${PENDING_CLASS_ACU}`).last().find('.avatar img').attr('src') || '');
}

function buildPendingMessage_ACU(
  jq: JQueryStatic,
  $template: JQuery<HTMLElement>,
  opts: { isUser: boolean; name: string; avatarSrc: string; html?: string | null; text?: string },
): JQuery<HTMLElement> {
  const $mes = $template.clone();
  $mes.addClass(PENDING_CLASS_ACU);
  // 非数字 mesid：宿主按 mesid 选择真实楼层时不会命中，按 Number(mesid) 取 chat 的代码得到 NaN 而非 0 号楼。
  $mes.attr({ mesid: 'acu-plot-pending', ch_name: opts.name, is_user: String(opts.isUser), is_system: 'false' });
  $mes.find('.name_text').text(opts.name);
  const $img = $mes.find('.avatar img');
  if (opts.avatarSrc) $img.attr('src', opts.avatarSrc);
  else $img.css('visibility', 'hidden');
  const $text = $mes.find('.mes_text').empty();
  if (opts.isUser) {
    if (opts.html != null) $text.html(opts.html);
    else $text.text(opts.text || '');
  } else {
    $text.append(jq('<span>', {
      class: 'acu-plot-pending-thinking',
      role: 'status',
      'aria-live': 'polite',
      text: '思考中…',
    }));
  }
  return $mes;
}

/** 规划完成、宿主读走发送框后，还原用户在伪装期间新输入的草稿。 */
function scheduleDraftRestore_ACU(jq: JQueryStatic, draft: string): void {
  const ns = '.acuPlotPendingDraft';
  const $textarea = jq('#send_textarea');
  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finish = (restore: boolean) => {
    if (done) return;
    done = true;
    $textarea.off(ns);
    if (timer) clearTimeout(timer);
    if (!restore) {
      logWarn_ACU('[剧情推进] 宿主未读取发送框，伪装期间输入的草稿未还原。');
      return;
    }
    // 宿主清空发送框后同步继续使用局部变量里的文本，下一轮任务再写回草稿。
    setTimeout(() => {
      if (!getSendTextareaValue_ACU()) setSendTextareaValue_ACU(draft);
    }, 0);
  };
  $textarea.on(`input${ns}`, () => {
    if (getSendTextareaValue_ACU() === '') finish(true);
  });
  timer = setTimeout(() => finish(getSendTextareaValue_ACU() === ''), DRAFT_RESTORE_TIMEOUT_MS_ACU);
}

/** 中止宿主请求并清空本次待发送文本；原文/新草稿只在宿主读走发送框后恢复。 */
export function cancelPlotPendingSend_ACU(
  disguise: PlotPendingDisguiseHandle_ACU | null,
  originalText: string,
): void {
  // 先释放伪装并清空，避免 stopGeneration 同步发出 STOPPED 后使 handle 失效。
  if (disguise) {
    if (!disguise.release('', { restoreDraft: originalText })) {
      logWarn_ACU('[剧情推进] 取消发送时无法清空发送框，请检查宿主输入框状态。');
    }
    try { stopGeneration_ACU(); } catch (error) {
      logWarn_ACU('[剧情推进] 停止宿主生成失败:', error);
    }
    return;
  }
  const draft = getSendTextareaValue_ACU() || originalText;
  disposePlotPendingHandoff_ACU(false);
  try { stopGeneration_ACU(); } catch (error) {
    logWarn_ACU('[剧情推进] 停止宿主生成失败:', error);
  }
  if (!setSendTextareaValue_ACU('')) {
    logWarn_ACU('[剧情推进] 取消发送时无法清空发送框，请检查宿主输入框状态。');
    return;
  }
  if (draft && jQuery_API_ACU) scheduleDraftRestore_ACU(jQuery_API_ACU, draft);
}

function resolveCharacterAvatarSrc_ACU(ctx: any, $chat: JQuery<HTMLElement>): string {
  const fromChat = findLastAvatarSrc_ACU($chat, false);
  if (fromChat) return fromChat;
  try {
    const character = ctx?.characters?.[ctx?.characterId];
    if (character?.avatar && character.avatar !== 'none' && typeof ctx?.getThumbnailUrl === 'function') {
      return String(ctx.getThumbnailUrl('avatar', character.avatar));
    }
  } catch { /* 头像缺失时隐藏头像，不影响伪装楼层 */ }
  return '';
}

/**
 * 伪装期间拦截发送按钮与回车发送。文档捕获阶段先于宿主绑定在元素上的监听执行，
 * stopImmediatePropagation 后宿主 sendTextareaMessage 不会被调用。
 */
function installSendBlock_ACU(doc: Document, getNotice: () => PendingDisguiseNotice_ACU): () => void {
  let lastToastAt = 0;
  const notify = () => {
    const now = Date.now();
    if (now - lastToastAt < BLOCK_TOAST_INTERVAL_MS_ACU) return;
    lastToastAt = now;
    const notice = getNotice();
    showToastr_ACU('info', notice.message, notice.title);
  };
  const onClick = (e: Event) => {
    const target = e.target as Element | null;
    if (!target || typeof target.closest !== 'function' || !target.closest('#send_but')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    notify();
  };
  const onKeydown = (e: KeyboardEvent) => {
    const target = e.target as Element | null;
    if (!target || target.id !== 'send_textarea') return;
    if ((e.key !== 'Enter' && e.key !== 'NumpadEnter') || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    notify();
  };
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('keydown', onKeydown, true);
  return () => {
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('keydown', onKeydown, true);
  };
}

/**
 * 开始伪装：渲染伪装楼层、清空发送框、拦截重复发送。
 * 条件不满足（已有伪装、找不到聊天区或消息模板、发送框不可写）时返回 null，调用方保持原有行为。
 */
export function beginPlotPendingDisguise_ACU(
  originalText: string,
  options: { notice?: PendingDisguiseNotice_ACU } = {},
): PlotPendingDisguiseHandle_ACU | null {
  const jq = jQuery_API_ACU;
  if (activeDisguise_ACU || !jq || !String(originalText || '').trim()) return null;

  let currentNotice: PendingDisguiseNotice_ACU = options.notice || PLOT_PENDING_NOTICE_ACU;
  let $nodes: JQuery<HTMLElement> | null = null;
  let removeBlock: (() => void) | null = null;
  let textareaCleared = false;
  try {
    const $chat = jq('#chat');
    const $template = jq('#message_template .mes').first() as JQuery<HTMLElement>;
    if (!$chat.length || !$template.length) {
      logDebug_ACU('[剧情推进] 未找到 #chat 或消息模板，跳过伪装楼层。');
      return null;
    }
    const doc = $chat[0].ownerDocument || document;
    ensureStyle_ACU(doc);

    const ctx = getHostContext_ACU();
    const userName = String(ctx?.name1 || '');
    const charName = String(ctx?.name2 || '');
    const $user = buildPendingMessage_ACU(jq, $template, {
      isUser: true,
      name: userName,
      avatarSrc: findLastAvatarSrc_ACU($chat, true),
      html: formatMessageHtml_ACU(ctx, originalText, userName),
      text: originalText,
    });
    const $ai = buildPendingMessage_ACU(jq, $template, {
      isUser: false,
      name: charName,
      avatarSrc: resolveCharacterAvatarSrc_ACU(ctx, $chat),
    });
    $nodes = $user.add($ai);
    $chat.append($nodes);
    $chat.scrollTop($chat[0].scrollHeight);

    if (!setSendTextareaValue_ACU('')) {
      $nodes.remove();
      return null;
    }
    textareaCleared = true;
    removeBlock = installSendBlock_ACU(doc, () => currentNotice);

    const nodes = $nodes;
    const unblock = removeBlock;
    let released = false;
    let writeOk = true;
    const handle: PlotPendingDisguiseHandle_ACU = {
      originalText,
      setNotice(notice: PendingDisguiseNotice_ACU): void {
        if (!released && notice) currentNotice = notice;
      },
      discard(): void {
        if (released) return;
        released = true;
        writeOk = false;
        if (activeDisguise_ACU === handle) activeDisguise_ACU = null;
        unblock();
        nodes.remove();
      },
      release(textForHost: string, options: { restoreDraft?: string; waitForMessage?: boolean } = {}): boolean {
        if (released) return writeOk;
        released = true;
        if (activeDisguise_ACU === handle) activeDisguise_ACU = null;
        unblock();
        nodes.remove();
        const draft = getSendTextareaValue_ACU() || options.restoreDraft || '';
        const waitForMessage = options.waitForMessage === true && !!textForHost.trim();
        writeOk = waitForMessage
          ? handoffPlotPendingSend_ACU(textForHost, draft === textForHost ? '' : draft)
          : setSendTextareaValue_ACU(textForHost);
        if (!writeOk) {
          logWarn_ACU('[剧情推进] 伪装结束时发送框写回校验失败。');
        } else if (!waitForMessage && draft && draft !== textForHost) {
          scheduleDraftRestore_ACU(jq, draft);
        }
        return writeOk;
      },
    };
    activeDisguise_ACU = handle;
    return handle;
  } catch (error) {
    logWarn_ACU('[剧情推进] 伪装楼层创建失败，恢复原有发送流程:', error);
    try { removeBlock?.(); } catch { /* ignore */ }
    try { $nodes?.remove(); } catch { /* ignore */ }
    if (textareaCleared) setSendTextareaValue_ACU(originalText);
    return null;
  }
}
