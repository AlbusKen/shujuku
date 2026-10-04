/** 真实用户楼层等待处理期间的 AI 占位，使用酒馆原生 reasoning 样式。 */
import { jQuery_API_ACU, SillyTavern_API_ACU } from '../../shared/host-api';

const PENDING_CLASS_ACU = 'acu-plot-pending-mes';
const STYLE_ID_ACU = 'acu-plot-pending-disguise-style';
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
.mes.${PENDING_CLASS_ACU} .mes_reasoning_actions,
.mes.${PENDING_CLASS_ACU} .mes_ghost,
.mes.${PENDING_CLASS_ACU} .mes_bias { display: none !important; }
/* 等待面板始终可见，布局与动画由酒馆原生样式提供。 */
#chat .mes.${PENDING_CLASS_ACU}.reasoning .mes_reasoning_details { display: block !important; }
`;

export interface PlotPendingDisguiseHandle_ACU {
  /** 仅撤销 AI 等待展示，真实用户楼层由聊天网关管理。 */
  finish(): void;
}

let activeDisguise_ACU: PlotPendingDisguiseHandle_ACU | null = null;

export function disposePlotPendingDisguise_ACU(): void {
  activeDisguise_ACU?.finish();
}

const NON_SENDING_GENERATION_TYPES_ACU = new Set(['regenerate', 'swipe', 'impersonate', 'quiet']);
export function isPendingDisguiseGenerationType_ACU(type: unknown): boolean {
  return !NON_SENDING_GENERATION_TYPES_ACU.has(String(type ?? ''));
}

/** 只添加 AI 等待展示，不改用户楼层，也不写发送框。 */
export function beginPlotPendingDisguise_ACU(
  options: { visible?: boolean } = {},
): PlotPendingDisguiseHandle_ACU | undefined {
  if (options.visible === false) return;
  const jq = jQuery_API_ACU;
  const chat = jq?.('#chat')?.[0];
  const template = jq?.('#message_template .mes')?.[0];
  if (!chat || !template) throw new Error('酒馆消息模板不可用');
  const doc = chat.ownerDocument;
  let style = doc.getElementById(STYLE_ID_ACU);
  if (!style) {
    style = doc.createElement('style');
    style.id = STYLE_ID_ACU;
    doc.head.appendChild(style);
  }
  style.textContent = PENDING_STYLE_ACU;
  const api = SillyTavern_API_ACU;
  const ai = template.cloneNode(true) as HTMLElement;
  const prepare = (node: HTMLElement, isUser: boolean, name: string) => {
    node.classList.add(PENDING_CLASS_ACU);
    node.setAttribute('mesid', 'acu-plot-pending');
    node.setAttribute('is_user', String(isUser));
    node.setAttribute('is_system', 'false');
    node.setAttribute('ch_name', name);
    const title = node.querySelector('.name_text');
    if (title) title.textContent = name;
    const avatar = node.querySelector<HTMLImageElement>('.avatar img');
    const previous = chat.querySelector<HTMLImageElement>(`.mes[is_user="${isUser}"] .avatar img`);
    if (avatar && previous) avatar.src = previous.src;
    node.querySelector('.mes_text')?.replaceChildren();
  };
  prepare(ai, false, api?.name2 || '');
  // 复用酒馆消息模板的原生 reasoning 面板与状态，不另造动画。
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
  chat.append(ai);
  chat.scrollTop = chat.scrollHeight;
  const handle: PlotPendingDisguiseHandle_ACU = {
    finish(): void {
      ai.remove();
      if (activeDisguise_ACU === handle) activeDisguise_ACU = null;
    },
  };
  activeDisguise_ACU = handle;
  return handle;
}
