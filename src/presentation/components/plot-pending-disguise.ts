/** 为真实 AI 占位楼层附加酒馆原生 reasoning 等待样式，不增删消息。 */
import { jQuery_API_ACU } from '../../shared/host-api';

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
  /** 仅撤销等待样式，不删除真实楼层。 */
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
