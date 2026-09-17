import { WORLD_SIMULATION_HISTORY_EMERGENCY_FACTOR_ACU, measureWorldSimulationPrompt_ACU, type WorldSimulationTokenCounter_ACU } from './agent-token-budget';

export interface WorldSimulationPreparedMessage_ACU { role: string; content: string; }
export type WorldSimulationFinalRequestResult_ACU<T> =
  | { status: 'sent'; response: T; messages: readonly WorldSimulationPreparedMessage_ACU[]; totalTokens: number; compressed: boolean }
  | { status: 'rejected'; reason: 'final-request-token-overflow'; messages: readonly WorldSimulationPreparedMessage_ACU[]; totalTokens: number; limitTokens: number; compressed: boolean };

export async function executeWorldSimulationFinalRequest_ACU<T>(input: {
  messages: readonly WorldSimulationPreparedMessage_ACU[];
  historyBudgetTokens: number;
  count: WorldSimulationTokenCounter_ACU;
  compress?: (messages: readonly WorldSimulationPreparedMessage_ACU[]) => Promise<readonly WorldSimulationPreparedMessage_ACU[]>;
  invoke: (messages: readonly WorldSimulationPreparedMessage_ACU[]) => Promise<T>;
}): Promise<WorldSimulationFinalRequestResult_ACU<T>> {
  if (!Number.isFinite(input.historyBudgetTokens) || input.historyBudgetTokens <= 0) throw new Error('WORLD_SIMULATION_HISTORY_BUDGET_INVALID');
  const limitTokens = Math.floor(input.historyBudgetTokens * WORLD_SIMULATION_HISTORY_EMERGENCY_FACTOR_ACU);
  let messages = input.messages.map(message => ({ ...message }));
  let totalTokens = await measureWorldSimulationPrompt_ACU(messages, input.count);
  let compressed = false;
  if (totalTokens > limitTokens && input.compress) {
    messages = (await input.compress(messages)).map(message => ({ ...message }));
    compressed = true;
    totalTokens = await measureWorldSimulationPrompt_ACU(messages, input.count);
  }
  if (totalTokens > limitTokens) return { status: 'rejected', reason: 'final-request-token-overflow', messages, totalTokens, limitTokens, compressed };
  return { status: 'sent', response: await input.invoke(messages), messages, totalTokens, compressed };
}
