import type { WorldGuidanceSignalVoice_ACU, WorldSimulationLedger_ACU } from './model';

const START_V1_ACU = '<!-- qrf-world-simulation-projection:v1:start -->';
const END_V1_ACU = '<!-- qrf-world-simulation-projection:v1:end -->';
const START_ACU = '<!-- qrf-world-simulation-projection:v2:start -->';
const END_ACU = '<!-- qrf-world-simulation-projection:v2:end -->';
/** 浏览器可渲染的隐藏容器：正文渲染时对读者隐藏，原文仍留在楼层里供后续续写读取。位于 v2 标记之内，剥离逻辑不变。 */
const HIDDEN_OPEN_ACU = '<div hidden class="qrf-world-simulation-projection" style="display:none">';
const HIDDEN_CLOSE_ACU = '</div>';
const escape_ACU = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const OWNED_BLOCK_ACU = new RegExp(`(?:\\r?\\n)*(?:${escape_ACU(START_V1_ACU)}[\\s\\S]*?${escape_ACU(END_V1_ACU)}|${escape_ACU(START_ACU)}[\\s\\S]*?${escape_ACU(END_ACU)})(?:\\r?\\n)*`, 'g');
const SECTION_ORDER_ACU: WorldGuidanceSignalVoice_ACU[] = ['encounter', 'rumor', 'ambient'];
const SECTION_LABELS_ACU: Record<WorldGuidanceSignalVoice_ACU, string> = {
  encounter: '【此地此刻】',
  rumor: '【风闻轶事】',
  ambient: '【世界暗流】',
};

export const WORLD_SIMULATION_PROJECTION_PLACEHOLDER_ACU = '$WORLD_SIGNALS';
export const WORLD_SIMULATION_PROJECTION_TEMPLATE_MAX_CHARS_ACU = 4000;
/** 默认格式即历来的写法：隐藏容器包住〈与此同时〉，再包住分组信号。 */
export const DEFAULT_WORLD_SIMULATION_PROJECTION_TEMPLATE_ACU = `${HIDDEN_OPEN_ACU}\n<与此同时>\n${WORLD_SIMULATION_PROJECTION_PLACEHOLDER_ACU}\n</与此同时>\n${HIDDEN_CLOSE_ACU}`;

/** 起止标记由插件固定加在模板外层，模板里再出现会破坏剥离与替换。 */
export function worldSimulationProjectionTemplateError_ACU(template: unknown): string | null {
  if (typeof template !== 'string' || !template.trim()) return '格式模板不能为空';
  if (template.length > WORLD_SIMULATION_PROJECTION_TEMPLATE_MAX_CHARS_ACU) return `格式模板不能超过 ${WORLD_SIMULATION_PROJECTION_TEMPLATE_MAX_CHARS_ACU} 字`;
  if (template.split(WORLD_SIMULATION_PROJECTION_PLACEHOLDER_ACU).length !== 2) return `格式模板必须恰好包含一次 ${WORLD_SIMULATION_PROJECTION_PLACEHOLDER_ACU}`;
  if (template.includes('qrf-world-simulation-projection:v')) return '格式模板不能包含插件的起止标记，它们会自动加在外层';
  return null;
}

export function buildWorldSimulationProjection_ACU(ledger: WorldSimulationLedger_ACU, template: string = DEFAULT_WORLD_SIMULATION_PROJECTION_TEMPLATE_ACU): string | null {
  const grouped: Record<WorldGuidanceSignalVoice_ACU, string[]> = { encounter: [], rumor: [], ambient: [] };
  for (const signal of ledger.guidance.signals) {
    const text = signal.text.trim();
    if (text) grouped[signal.voice].push(text);
  }
  const sections = SECTION_ORDER_ACU.flatMap(voice => {
    const items = grouped[voice];
    return items.length ? [`${SECTION_LABELS_ACU[voice]}\n${items.map(item => `- ${item}`).join('\n')}`] : [];
  });
  if (!sections.length) return null;
  const format = worldSimulationProjectionTemplateError_ACU(template) ? DEFAULT_WORLD_SIMULATION_PROJECTION_TEMPLATE_ACU : template;
  return `${START_ACU}\n${format.replace(WORLD_SIMULATION_PROJECTION_PLACEHOLDER_ACU, () => sections.join('\n'))}\n${END_ACU}`;
}

/** Prompt-only view: never use this text for anchor identity or persistent content. */
export function stripWritingAnnotations_ACU(text: string): string {
  return String(text ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/(?:\r?\n){3,}/g, '\n\n');
}

export function applyWorldSimulationProjection_ACU(content: string, projection: string | null): string {
  const base = String(content ?? '').replace(OWNED_BLOCK_ACU, '').trimEnd();
  return projection ? `${base}${base ? '\n\n' : ''}${projection}` : base;
}

export function readWorldSimulationMessageContent_ACU(message: Record<string, unknown>): string {
  return typeof message.mes === 'string' ? message.mes : typeof message.message === 'string' ? message.message : '';
}

export function writeWorldSimulationActiveSwipeContent_ACU(message: Record<string, unknown>, content: string): void {
  if (typeof message.mes === 'string' || typeof message.message !== 'string') message.mes = content;
  else message.message = content;
  const swipeId = typeof message.swipe_id === 'number' && Number.isInteger(message.swipe_id) && message.swipe_id >= 0 ? message.swipe_id : 0;
  if (Array.isArray(message.swipes)) {
    if (swipeId >= message.swipes.length) throw new Error('WORLD_SIMULATION_ACTIVE_SWIPE_INVALID');
    message.swipes[swipeId] = content;
  }
}

export const WORLD_SIMULATION_PROJECTION_MARKERS_ACU = { start: START_ACU, end: END_ACU } as const;
