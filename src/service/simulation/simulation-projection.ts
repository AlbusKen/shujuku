import type { WorldSimulationLedger_ACU } from './model';

const START_ACU = '<!-- qrf-world-simulation-projection:v1:start -->';
const END_ACU = '<!-- qrf-world-simulation-projection:v1:end -->';
const OWNED_BLOCK_ACU = new RegExp(`(?:\\r?\\n)*${START_ACU.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}[\\s\\S]*?${END_ACU.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}(?:\\r?\\n)*`, 'g');

export function buildWorldSimulationProjection_ACU(ledger: WorldSimulationLedger_ACU): string | null {
  const signals = ledger.guidance.signals.map(item => item.trim()).filter(Boolean);
  if (!signals.length) return null;
  return `${START_ACU}\n<与此同时>\n${signals.map(item => `- ${item}`).join('\n')}\n</与此同时>\n${END_ACU}`;
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
