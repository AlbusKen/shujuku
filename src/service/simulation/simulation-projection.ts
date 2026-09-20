import type { WorldGuidanceSignalVoice_ACU, WorldSimulationLedger_ACU } from './model';

const START_V1_ACU = '<!-- qrf-world-simulation-projection:v1:start -->';
const END_V1_ACU = '<!-- qrf-world-simulation-projection:v1:end -->';
const START_ACU = '<!-- qrf-world-simulation-projection:v2:start -->';
const END_ACU = '<!-- qrf-world-simulation-projection:v2:end -->';
const escape_ACU = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const OWNED_BLOCK_ACU = new RegExp(`(?:\\r?\\n)*(?:${escape_ACU(START_V1_ACU)}[\\s\\S]*?${escape_ACU(END_V1_ACU)}|${escape_ACU(START_ACU)}[\\s\\S]*?${escape_ACU(END_ACU)})(?:\\r?\\n)*`, 'g');
const SECTION_ORDER_ACU: WorldGuidanceSignalVoice_ACU[] = ['encounter', 'rumor', 'ambient'];
const SECTION_LABELS_ACU: Record<WorldGuidanceSignalVoice_ACU, string> = {
  encounter: '【此地此刻】',
  rumor: '【风闻轶事】',
  ambient: '【世界暗流】',
};

export function buildWorldSimulationProjection_ACU(ledger: WorldSimulationLedger_ACU): string | null {
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
  return `${START_ACU}\n<与此同时>\n${sections.join('\n')}\n</与此同时>\n${END_ACU}`;
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
