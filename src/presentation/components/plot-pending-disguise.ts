/** 剧情推进等待期的伪装：只替换等待动画，写入流程与解除伪装相同，展示出问题时退回解除伪装的等待方式。 */
import { jQuery_API_ACU, SillyTavern_API_ACU } from '../../shared/host-api';
import { beginHostGenerationUi_ACU, getSendTextareaValue_ACU, setSendTextareaValue_ACU, type HostInputWriteFailureReporter_ACU } from '../../shared/host-input';
import { getHostWindow } from '../../shared/runtime-env';
import { logWarn_ACU } from '../../shared/utils';

const PENDING_CLASS_ACU = 'acu-plot-pending-mes';
const STYLE_ID_ACU = 'acu-plot-pending-disguise-style';
/** 只藏可操作的控件；序号、计时、token 数与时间戳的显隐交给酒馆自身设置。 */
const PENDING_STYLE_ACU = `
.mes.${PENDING_CLASS_ACU} { pointer-events: none; }
.mes.${PENDING_CLASS_ACU} .mes_buttons,
.mes.${PENDING_CLASS_ACU} .mes_edit_buttons,
.mes.${PENDING_CLASS_ACU} .for_checkbox,
.mes.${PENDING_CLASS_ACU} .del_checkbox,
.mes.${PENDING_CLASS_ACU} .swipe_left,
.mes.${PENDING_CLASS_ACU} .swipe_right,
.mes.${PENDING_CLASS_ACU} .swipeRightBlock,
.mes.${PENDING_CLASS_ACU} .mes_reasoning_actions,
.mes.${PENDING_CLASS_ACU} .mes_img_container,
.mes.${PENDING_CLASS_ACU} .mes_file_container,
.mes.${PENDING_CLASS_ACU} .mes_ghost,
.mes.${PENDING_CLASS_ACU} .mes_bias { display: none !important; }
/* 等待面板始终可见（思考内容为空时酒馆默认会藏起整块），布局由酒馆原生样式提供。 */
#chat .mes.${PENDING_CLASS_ACU}.reasoning .mes_reasoning_details { display: block !important; }
`;

export interface PlotPendingDisguiseHandle_ACU {
  /** 清理本次等待展示，保留真实聊天消息。 */
  finish(): void;
}

let activeDisguise_ACU: PlotPendingDisguiseHandle_ACU | null = null;
let activeSendDisguise_ACU: PlotSendDisguiseHandle_ACU | null = null;

export function disposePlotPendingDisguise_ACU(): void {
  activeSendDisguise_ACU?.release(false);
  activeDisguise_ACU?.finish();
  cancelDraftRestore_ACU?.();
}

const NON_SENDING_GENERATION_TYPES_ACU = new Set(['regenerate', 'swipe', 'impersonate', 'quiet']);
export function isPendingDisguiseGenerationType_ACU(type: unknown): boolean {
  return !NON_SENDING_GENERATION_TYPES_ACU.has(String(type ?? ''));
}

/** 样式绑定到已渲染的真实 AI 楼层；展示不可用时不阻断任务。 */
export function beginPlotPendingDisguise_ACU(
  options: { messageIndex: number; visible?: boolean },
): PlotPendingDisguiseHandle_ACU | undefined {
  if (options.visible === false) return;
  const jq = jQuery_API_ACU;
  const chat = jq?.('#chat')?.[0];
  const ai = chat?.querySelector<HTMLElement>(`.mes[mesid="${options.messageIndex}"]`);
  if (!chat || !ai) return;
  const doc = chat.ownerDocument;
  let style = doc.getElementById(STYLE_ID_ACU);
  if (!style) {
    style = doc.createElement('style');
    style.id = STYLE_ID_ACU;
    doc.head.appendChild(style);
  }
  style.textContent = PENDING_STYLE_ACU;
  disposePlotPendingDisguise_ACU();
  ai.classList.add(PENDING_CLASS_ACU);
  // 复用宿主已经渲染的 reasoning 面板，不另建 DOM 占位。
  ai.classList.add('reasoning');
  ai.dataset.reasoningState = 'thinking';
  const details = ai.querySelector<HTMLDetailsElement>('.mes_reasoning_details');
  if (details) {
    details.dataset.state = 'thinking';
    details.open = false;
  }
  const thinking = ai.querySelector<HTMLElement>('.mes_reasoning_header_title');
  if (thinking) {
    thinking.textContent = 'Thinking...';
    thinking.setAttribute('data-i18n', 'Thinking...');
    thinking.setAttribute('role', 'status');
    thinking.setAttribute('aria-live', 'polite');
  }
  chat.scrollTop = chat.scrollHeight;
  const handle: PlotPendingDisguiseHandle_ACU = {
    finish(): void {
      ai.classList.remove(PENDING_CLASS_ACU, 'reasoning');
      delete ai.dataset.reasoningState;
      if (details) delete details.dataset.state;
      if (activeDisguise_ACU === handle) activeDisguise_ACU = null;
    },
  };
  activeDisguise_ACU = handle;
  return handle;
}

const VIRTUAL_CLASS_ACU = 'acu-plot-virtual-mes';
/** 与酒馆流式生成时一样每 0.1 秒刷新计时。 */
const TIMER_TICK_MS_ACU = 100;

/** 宿主 index.html 缺少 #message_template 时使用的同结构模板（类名与酒馆 1.13 一致）。 */
const FALLBACK_MESSAGE_TEMPLATE_ACU = '<div class="mes" is_user="" is_system="">'
  + '<div class="mesAvatarWrapper"><div class="avatar"><img src="" alt=""></div>'
  + '<div class="mesIDDisplay"></div><div class="mes_timer"></div><div class="tokenCounterDisplay"></div></div>'
  + '<div class="mes_block"><div class="ch_name flex-container justifySpaceBetween">'
  + '<div class="flex-container flex1 alignitemscenter"><div class="flex-container alignItemsBaseline">'
  + '<span class="name_text"></span><small class="timestamp"></small></div></div></div>'
  + '<details class="mes_reasoning_details"><summary class="mes_reasoning_summary flex-container">'
  + '<div class="mes_reasoning_header_block flex-container"><div class="mes_reasoning_header flex-container">'
  + '<span class="mes_reasoning_header_title">Thought for some time</span>'
  + '<div class="mes_reasoning_arrow fa-solid fa-chevron-up"></div></div></div></summary>'
  + '<div class="mes_reasoning"></div></details>'
  + '<div class="mes_text"></div></div></div>';

/** 只读用到的宿主上下文字段；任何一项缺失都按「取不到」处理。 */
interface HostChatContext_ACU {
  chat?: unknown[];
  name1?: string;
  name2?: string;
  characters?: Array<{ name?: string; avatar?: string } | undefined>;
  characterId?: string | number;
  groupId?: string | null;
  timestampToMoment?: (timestamp: number) => { isValid?: () => boolean; format: (pattern: string) => string };
  messageFormatting?: (text: string, name: string, isSystem: boolean, isUser: boolean, messageId: number) => string;
  getThumbnailUrl?: (type: string, file: string) => string;
  translate?: (text: string, key?: string | null) => string;
}

/** 优先宿主页 getContext() 的实时值（切角色、换人设后仍准确），取不到再用脚本拿到的 SillyTavern 引用。 */
function readHostChatContext_ACU(): HostChatContext_ACU {
  try {
    const live = (getHostWindow() as any)?.SillyTavern?.getContext?.();
    if (live && typeof live === 'object') return live as HostChatContext_ACU;
  } catch {
    // 继续用脚本侧引用。
  }
  return (SillyTavern_API_ACU ?? {}) as unknown as HostChatContext_ACU;
}

function attempt_ACU<T>(run: () => T, fallback: T): T {
  try {
    return run() ?? fallback;
  } catch {
    return fallback;
  }
}

/** 与酒馆 addOneMessage 相同的时间格式（moment 'LL LT'，随酒馆语言）。 */
function formatHostTime_ACU(context: HostChatContext_ACU, time: number, pattern: string): string {
  return attempt_ACU(() => {
    const moment = context.timestampToMoment?.(time);
    if (moment && moment.isValid?.() !== false) return moment.format(pattern);
    return new Date(time).toLocaleString();
  }, new Date(time).toLocaleString());
}

/** 最近一层同侧真实楼层：宿主已按当前角色 / 人设渲染好名字与头像。 */
function latestRealFloor_ACU(chat: HTMLElement, isUser: boolean): HTMLElement | null {
  const floors = chat.querySelectorAll<HTMLElement>(`.mes[is_user="${isUser}"]:not([is_system="true"]):not([data-acu-virtual-floor])`);
  return floors[floors.length - 1] ?? null;
}

function floorIdentity_ACU(floor: HTMLElement | null): { name: string; avatar: string } {
  return {
    name: floor?.getAttribute('ch_name') || floor?.querySelector('.name_text')?.textContent || '',
    avatar: floor?.querySelector('.avatar img')?.getAttribute('src') || '',
  };
}

function userIdentity_ACU(context: HostChatContext_ACU, chat: HTMLElement): { name: string; avatar: string } {
  const latest = floorIdentity_ACU(latestRealFloor_ACU(chat, true));
  const personaAvatar = chat.ownerDocument.querySelector('#user_avatar_block .avatar-container.selected img')?.getAttribute('src') || '';
  return { name: context.name1 || latest.name, avatar: latest.avatar || personaAvatar };
}

/** 单聊用当前角色名与头像缩略图（同 addOneMessage）；群聊下一位发言者未定，参照最近一层 AI 楼。 */
function assistantIdentity_ACU(context: HostChatContext_ACU, chat: HTMLElement): { name: string; avatar: string } {
  const latest = floorIdentity_ACU(latestRealFloor_ACU(chat, false));
  const id = context.characterId;
  const character = !context.groupId && id !== undefined && id !== null && id !== '' ? context.characters?.[Number(id)] : undefined;
  if (!character) return { name: latest.name || context.name2 || '', avatar: latest.avatar };
  const file = character.avatar;
  const avatar = file && file !== 'none' ? attempt_ACU(() => context.getThumbnailUrl?.('avatar', file) ?? '', '') : '';
  return { name: context.name2 || character.name || latest.name, avatar: avatar || latest.avatar };
}

function createFloorElement_ACU(doc: Document): HTMLElement {
  const template = doc.querySelector('#message_template .mes');
  if (template) return template.cloneNode(true) as HTMLElement;
  const holder = doc.createElement('div');
  holder.innerHTML = FALLBACK_MESSAGE_TEMPLATE_ACU;
  return holder.firstElementChild as HTMLElement;
}

function setText_ACU(root: HTMLElement, selector: string, text: string): HTMLElement | null {
  const element = root.querySelector<HTMLElement>(selector);
  if (element) element.textContent = text;
  return element;
}

/** 正文按酒馆 messageFormatting 渲染（含 Markdown 与显示用正则）；不可用时按空行分段、单换行转 <br>。 */
function renderFloorText_ACU(
  target: HTMLElement | null,
  text: string,
  context: HostChatContext_ACU,
  floor: { name: string; isUser: boolean; index: number },
): void {
  if (!target) return;
  const formatted = attempt_ACU(() => context.messageFormatting?.(text, floor.name, false, floor.isUser, floor.index), undefined);
  if (typeof formatted === 'string') {
    target.innerHTML = formatted;
    return;
  }
  const doc = target.ownerDocument;
  target.replaceChildren(...text.split(/\n{2,}/).map(block => {
    const paragraph = doc.createElement('p');
    block.split('\n').forEach((line, index) => {
      if (index) paragraph.appendChild(doc.createElement('br'));
      paragraph.appendChild(doc.createTextNode(line));
    });
    return paragraph;
  }));
}

function buildVirtualFloor_ACU(
  doc: Document,
  context: HostChatContext_ACU,
  floor: { isUser: boolean; index: number; name: string; avatar: string; timestamp: string; text: string },
): HTMLElement {
  const mes = createFloorElement_ACU(doc);
  // 虚拟楼层不占真实楼号：宿主与其它插件按 mesid 查楼时不能命中它。
  mes.removeAttribute('mesid');
  mes.classList.add(PENDING_CLASS_ACU, VIRTUAL_CLASS_ACU);
  mes.setAttribute('data-acu-virtual-floor', 'true');
  mes.setAttribute('is_user', String(floor.isUser));
  mes.setAttribute('is_system', 'false');
  mes.setAttribute('ch_name', floor.name);
  mes.setAttribute('timestamp', floor.timestamp);
  if (floor.avatar) mes.querySelector('.avatar img')?.setAttribute('src', floor.avatar);
  setText_ACU(mes, '.name_text', floor.name);
  setText_ACU(mes, '.timestamp', floor.timestamp);
  setText_ACU(mes, '.mesIDDisplay', `#${floor.index}`);
  setText_ACU(mes, '.mes_timer', '');
  setText_ACU(mes, '.tokenCounterDisplay', '');
  renderFloorText_ACU(mes.querySelector<HTMLElement>('.mes_text'), floor.text, context, floor);
  return mes;
}

/**
 * 创建虚拟等待楼层：纯 UI 节点，不进 chat 数组、不参与历史与上下文、不触发宿主生成。
 * 楼层克隆自酒馆自己的消息模板，序号、名字、时间、头像与酒馆渲染真实楼层的方式一致；
 * AI 楼呈现流式生成刚开始的样子（Thinking... 与 ... 占位、计时器走秒）。
 * 规划结束或取消时整体移除，真实楼层不受影响。建不出来时不留节点并返回 undefined；
 * 之后被移出聊天区（例如宿主重绘聊天）时自行收尾并调用 onLost。
 */
export function beginPlotVirtualPendingFloor_ACU(
  userInput?: string,
  options: { onLost?: () => void } = {},
): PlotPendingDisguiseHandle_ACU | undefined {
  activeDisguise_ACU?.finish();
  let chat: HTMLElement | null = null;
  let user: HTMLElement | undefined;
  let ai: HTMLElement | undefined;
  let previousLast: HTMLElement | null = null;
  let view: Window | undefined;
  let interval: number | undefined;
  let finished = false;
  const handle: PlotPendingDisguiseHandle_ACU = {
    finish(): void {
      if (finished) return;
      finished = true;
      if (interval !== undefined) view?.clearInterval(interval);
      user?.remove();
      ai?.remove();
      if (previousLast?.isConnected && !chat?.querySelector('.mes.last_mes')) previousLast.classList.add('last_mes');
      if (activeDisguise_ACU === handle) activeDisguise_ACU = null;
    },
  };
  try {
    const doc = getHostWindow().document;
    chat = doc?.getElementById('chat') ?? null;
    if (!chat) return undefined;
    let style = doc.getElementById(STYLE_ID_ACU);
    if (!style) {
      style = doc.createElement('style');
      style.id = STYLE_ID_ACU;
      doc.head.appendChild(style);
    }
    style.textContent = PENDING_STYLE_ACU;
    const context = readHostChatContext_ACU();
    const startedAt = Date.now();
    const timestamp = formatHostTime_ACU(context, startedAt, 'LL LT');
    // 宿主随后入楼的序号：待发送的用户楼占 chat.length，AI 楼紧随其后。
    let nextIndex = Array.isArray(context.chat) ? context.chat.length : chat.querySelectorAll('.mes:not([data-acu-virtual-floor])').length;
    if (userInput !== undefined) {
      user = buildVirtualFloor_ACU(doc, context, { isUser: true, index: nextIndex++, timestamp, text: userInput, ...userIdentity_ACU(context, chat) });
    }
    const aiFloor = buildVirtualFloor_ACU(doc, context, { isUser: false, index: nextIndex, timestamp, text: '...', ...assistantIdentity_ACU(context, chat) });
    ai = aiFloor;
    aiFloor.classList.add('reasoning');
    aiFloor.dataset.reasoningState = 'thinking';
    const details = aiFloor.querySelector<HTMLDetailsElement>('.mes_reasoning_details');
    if (details) {
      details.dataset.state = 'thinking';
      details.open = false;
    }
    const thinking = aiFloor.querySelector<HTMLElement>('.mes_reasoning_header_title');
    if (thinking) {
      thinking.textContent = attempt_ACU(() => context.translate?.('Thinking...'), 'Thinking...') || 'Thinking...';
      thinking.setAttribute('data-i18n', 'Thinking...');
      thinking.setAttribute('role', 'status');
      thinking.setAttribute('aria-live', 'polite');
    }
    // 最后一层带 last_mes（气泡模式靠它贴底）；结束后若没有别的楼层接手就还给原来那层。
    previousLast = chat.querySelector<HTMLElement>('.mes.last_mes');
    previousLast?.classList.remove('last_mes');
    aiFloor.classList.add('last_mes');
    if (user) chat.appendChild(user);
    chat.appendChild(aiFloor);
    chat.scrollTop = chat.scrollHeight;

    const timer = aiFloor.querySelector<HTMLElement>('.mes_timer');
    const timerTitle = `Generation queued: ${formatHostTime_ACU(context, startedAt, 'HH:mm:ss D MMM YYYY')}`;
    const tick = (): void => {
      if (!aiFloor.isConnected) {
        handle.finish();
        options.onLost?.();
        return;
      }
      if (!timer) return;
      timer.textContent = `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
      timer.title = timerTitle;
    };
    tick();
    view = doc.defaultView ?? window;
    interval = view.setInterval(tick, TIMER_TICK_MS_ACU);
    activeDisguise_ACU = handle;
    return handle;
  } catch (error) {
    logWarn_ACU('[剧情推进] 虚拟等待楼层创建失败:', error);
    handle.finish();
    return undefined;
  }
}

/** 宿主读走发送框后等待放回草稿的上限；超时仍未读取说明宿主没有继续这次发送。 */
const DRAFT_RESTORE_TIMEOUT_MS_ACU = 60_000;

let cancelDraftRestore_ACU: (() => void) | null = null;

/** 宿主读取发送框后会清空并派发 input，本轮继续用已读出的文本；下一轮任务再放回伪装期间写的草稿。 */
function restoreDraftAfterHostRead_ACU(draft: string): void {
  cancelDraftRestore_ACU?.();
  const doc = getHostWindow().document;
  const textarea = doc?.getElementById('send_textarea');
  const view = doc?.defaultView;
  if (!textarea || !view) return;
  let timeout = 0;
  const stop = (): void => {
    textarea.removeEventListener('input', onInput);
    view.clearTimeout(timeout);
    if (cancelDraftRestore_ACU === stop) cancelDraftRestore_ACU = null;
  };
  const onInput = (): void => {
    if (getSendTextareaValue_ACU() !== '') return;
    stop();
    view.setTimeout(() => {
      if (!getSendTextareaValue_ACU()) setSendTextareaValue_ACU(draft);
    }, 0);
  };
  textarea.addEventListener('input', onInput);
  timeout = view.setTimeout(() => {
    stop();
    if (!getSendTextareaValue_ACU()) setSendTextareaValue_ACU(draft);
    else logWarn_ACU('[剧情推进] 宿主没有读取发送框，伪装期间写的草稿未放回。');
  }, DRAFT_RESTORE_TIMEOUT_MS_ACU);
  cancelDraftRestore_ACU = stop;
}

/**
 * 伪装期间宿主还没进入生成状态（未置 is_send_press），发送框却是空的：Enter 会空发或续写，
 * Ctrl+Enter 会重新生成并删掉上一条回复。按酒馆生成中的表现拦下这些入口；
 * 露出的停止键交给 onStop，与规划任务的「终止」等效。
 */
function installDisguiseGuards_ACU(doc: Document, onStop?: () => void): () => void {
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' || event.isComposing) return;
    const target = event.target as Element | null;
    // 楼层编辑框里的 Ctrl+Enter 是确认编辑，Shift+Enter 是换行，都照常放行。
    const blocked = event.altKey
      || (event.ctrlKey ? !target?.closest?.('#chat') : target?.id === 'send_textarea' && !event.shiftKey);
    if (!blocked) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onClick = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    if (target?.closest?.('#send_but')) {
      event.preventDefault();
      event.stopImmediatePropagation();
    } else if (target?.closest?.('#mes_stop, .mes_stop')) {
      onStop?.();
    }
  };
  doc.addEventListener('keydown', onKeydown, true);
  doc.addEventListener('click', onClick, true);
  return () => {
    doc.removeEventListener('keydown', onKeydown, true);
    doc.removeEventListener('click', onClick, true);
  };
}

export interface PlotSendDisguiseHandle_ACU {
  /** 写入交给宿主的最终指令；伪装期间新写的草稿先收起，宿主读走发送框后放回。 */
  deliver(text: string, reportFailure?: HostInputWriteFailureReporter_ACU): boolean;
  /**
   * 结束伪装，幂等且不抛错。没有交付最终指令时把原文还给发送框：
   * hostReads 表示宿主随后读取发送框继续本次发送（草稿先收起，读走后放回）；
   * 否则本次发送已停止，发送框里已有新内容时保留新内容。
   */
  release(hostReads: boolean): void;
}

/**
 * 伪装只换等待动画：虚拟楼层 + 宿主生成中外观 + 清空发送框（原文由句柄代管）+ 拦下生成中不该有的入口。
 * 任一步失败都整体撤回并返回 undefined，调用方按解除伪装的方式继续；
 * 虚拟楼层中途失效时自动撤掉外观，发送框空着就放回原文，同样按解除伪装的方式继续。
 */
export function beginPlotSendDisguise_ACU(
  options: { userInput?: string; onStop?: () => void } = {},
): PlotSendDisguiseHandle_ACU | undefined {
  activeSendDisguise_ACU?.release(false);
  // 发送框接下来归本轮伪装管，上一轮还没放回的草稿不再往里写。
  cancelDraftRestore_ACU?.();
  const { userInput, onStop } = options;
  let floor: PlotPendingDisguiseHandle_ACU | undefined;
  let restoreUi: (() => void) | undefined;
  let removeGuards: (() => void) | undefined;
  let showing = false;
  /** 发送框已被伪装清空，原文尚未还回或交付。 */
  let holdsInput = false;
  let released = false;

  const hide = (): void => {
    if (!showing) return;
    showing = false;
    for (const undo of [removeGuards, restoreUi, () => floor?.finish()]) {
      try {
        undo?.();
      } catch (error) {
        logWarn_ACU('[剧情推进] 撤回伪装等待展示异常:', error);
      }
    }
  };
  const fallBack = (): void => {
    if (released || !showing) return;
    logWarn_ACU('[剧情推进] 虚拟等待楼层已被移出聊天区，改用原文留在输入框的等待方式。');
    hide();
    if (holdsInput && !getSendTextareaValue_ACU().trim()) holdsInput = !setSendTextareaValue_ACU(userInput ?? '');
  };

  try {
    floor = beginPlotVirtualPendingFloor_ACU(userInput, { onLost: fallBack });
    if (!floor) return undefined;
    showing = true;
    restoreUi = beginHostGenerationUi_ACU();
    if (userInput !== undefined) {
      if (!setSendTextareaValue_ACU('')) throw new Error('酒馆输入框不可用');
      holdsInput = true;
    }
    removeGuards = installDisguiseGuards_ACU(getHostWindow().document, onStop);
  } catch (error) {
    logWarn_ACU('[剧情推进] 伪装等待没能建立，改用原文留在输入框的等待方式:', error);
    hide();
    if (userInput !== undefined && getSendTextareaValue_ACU() !== userInput) setSendTextareaValue_ACU(userInput);
    return undefined;
  }

  const handle: PlotSendDisguiseHandle_ACU = {
    deliver(text: string, reportFailure?: HostInputWriteFailureReporter_ACU): boolean {
      if (!holdsInput) return setSendTextareaValue_ACU(text, reportFailure, { restoreAfterInput: true });
      const draft = getSendTextareaValue_ACU();
      if (!setSendTextareaValue_ACU(text, reportFailure, { restoreAfterInput: true })) return false;
      holdsInput = false;
      // 最终指令已写入，放回草稿出错不能让调用方当作写入失败而停发。
      if (draft.trim()) {
        try {
          restoreDraftAfterHostRead_ACU(draft);
        } catch (error) {
          logWarn_ACU('[剧情推进] 伪装期间写的草稿没能安排放回:', error);
        }
      }
      return true;
    },
    release(hostReads: boolean): void {
      if (released) return;
      released = true;
      if (activeSendDisguise_ACU === handle) activeSendDisguise_ACU = null;
      hide();
      if (!holdsInput) return;
      holdsInput = false;
      try {
        const draft = getSendTextareaValue_ACU();
        if (!draft.trim()) setSendTextareaValue_ACU(userInput ?? '');
        else if (hostReads && setSendTextareaValue_ACU(userInput ?? '')) restoreDraftAfterHostRead_ACU(draft);
      } catch (error) {
        logWarn_ACU('[剧情推进] 伪装结束时还原发送框异常:', error);
      }
    },
  };
  activeSendDisguise_ACU = handle;
  return handle;
}
