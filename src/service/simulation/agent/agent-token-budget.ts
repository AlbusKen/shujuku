import { countTextTokens_ACU } from '../../ai/token-counter';
import type { WorldSimulationConversationMessage_ACU, WorldSimulationConversationView_ACU } from './agent-model';

export const WORLD_SIMULATION_HISTORY_EMERGENCY_FACTOR_ACU = 1.25;
export type WorldSimulationTokenCounter_ACU = (text: string) => Promise<number>;

export async function countWorldSimulationTokens_ACU(text: string): Promise<number> {
  return countTextTokens_ACU(text);
}

export function createWorldSimulationTokenCounter_ACU(count: WorldSimulationTokenCounter_ACU = countWorldSimulationTokens_ACU): WorldSimulationTokenCounter_ACU {
  const cache = new Map<string, number>();
  return async text => {
    const key = String(text ?? '');
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const value = await count(key);
    if (!Number.isFinite(value) || value < 0) throw new Error('WORLD_SIMULATION_TOKEN_COUNT_INVALID');
    const normalized = Math.ceil(value);
    cache.set(key, normalized);
    return normalized;
  };
}

export async function measureWorldSimulationMessages_ACU(messages: readonly WorldSimulationConversationMessage_ACU[], count: WorldSimulationTokenCounter_ACU = countWorldSimulationTokens_ACU): Promise<number> {
  let total = 0;
  for (const message of messages) total += await count(message.text);
  return total;
}

export async function measureWorldSimulationPrompt_ACU(messages: ReadonlyArray<{ role: string; content: string }>, count: WorldSimulationTokenCounter_ACU = countWorldSimulationTokens_ACU): Promise<number> {
  let total = 0;
  for (const message of messages) total += await count(message.content);
  return total;
}

export async function resolveWorldSimulationCompactionTiming_ACU(view: Pick<WorldSimulationConversationView_ACU, 'messages'>, budgetTokens: number, continuingSameTurn: boolean, count: WorldSimulationTokenCounter_ACU = countWorldSimulationTokens_ACU, overheadTokens = 0): Promise<{ action: 'compact' | 'defer' | 'skip'; totalTokens: number; emergency: boolean }> {
  void continuingSameTurn;
  if (!Number.isFinite(budgetTokens) || budgetTokens <= 0) return { action: 'skip', totalTokens: 0, emergency: false };
  if (!view.messages.length) return { action: 'skip', totalTokens: overheadTokens, emergency: false };
  const totalTokens = overheadTokens + await measureWorldSimulationMessages_ACU(view.messages, count);
  if (totalTokens <= budgetTokens) return { action: 'skip', totalTokens, emergency: false };
  const emergency = totalTokens > budgetTokens * WORLD_SIMULATION_HISTORY_EMERGENCY_FACTOR_ACU;
  if (!emergency) return { action: 'defer', totalTokens, emergency: false };
  return { action: 'compact', totalTokens, emergency: true };
}
