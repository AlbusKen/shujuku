import { WORLD_SIMULATION_HISTORY_EMERGENCY_FACTOR_ACU, measureWorldSimulationPrompt_ACU, type WorldSimulationTokenCounter_ACU } from './agent-token-budget';

export interface WorldSimulationPreparedMessage_ACU { role: string; content: string; }
export type WorldSimulationFinalRequestResult_ACU<T> =
  | { status: 'sent'; response: T; messages: readonly WorldSimulationPreparedMessage_ACU[]; totalTokens: number; compressed: boolean; defaultReadFenceTokens?: number }
  | { status: 'rejected'; reason: 'final-request-token-overflow'; messages: readonly WorldSimulationPreparedMessage_ACU[]; totalTokens: number; limitTokens: number; compressed: boolean };

export async function executeWorldSimulationFinalRequest_ACU<T>(input: {
  messages: readonly WorldSimulationPreparedMessage_ACU[];
  historyBudgetTokens: number;
  count: WorldSimulationTokenCounter_ACU;
  /** 本角色最终 provider 请求中的原生工具定义。 */
  tools?: readonly unknown[];
  /** 本地输入上下文限制；与输出 max_tokens 无关。 */
  inputLimitTokens: number;
  compress?: (messages: readonly WorldSimulationPreparedMessage_ACU[]) => Promise<readonly WorldSimulationPreparedMessage_ACU[]>;
  invoke: (messages: readonly WorldSimulationPreparedMessage_ACU[]) => Promise<T>;
}): Promise<WorldSimulationFinalRequestResult_ACU<T>> {
  if (!Number.isFinite(input.historyBudgetTokens) || input.historyBudgetTokens <= 0) throw new Error('WORLD_SIMULATION_HISTORY_BUDGET_INVALID');
  if (!Number.isSafeInteger(input.inputLimitTokens) || input.inputLimitTokens <= 0) throw new Error('READ_FENCE_CAPACITY_INVALID');
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
  const occupied = await measurePreparedReadRequestTokens_ACU(messages, input.tools ?? [], input.count);
  if (Math.floor((input.inputLimitTokens - occupied) * 0.6) <= 0) return { status: 'rejected', reason: 'final-request-token-overflow', messages, totalTokens: occupied, limitTokens: input.inputLimitTokens, compressed };
  const defaultReadFenceTokens = resolveDefaultReadFenceTokens_ACU(input.inputLimitTokens, occupied);
  return { status: 'sent', response: await input.invoke(messages), messages, totalTokens, compressed, defaultReadFenceTokens };
}

/** 统计实际发送的消息与原生工具定义；不允许将未知分词结果视作零占用。 */
export async function measurePreparedReadRequestTokens_ACU(
  messages: readonly { role: string; content: string }[],
  tools: readonly unknown[],
  count: WorldSimulationTokenCounter_ACU,
): Promise<number> {
  const payload = JSON.stringify({ messages, ...(tools.length ? { tools, tool_choice: 'auto' } : {}) });
  if (!payload) throw new Error('READ_FENCE_CAPACITY_INVALID');
  const measured = await count(payload);
  if (!Number.isFinite(measured) || measured <= 0) throw new Error('READ_FENCE_CAPACITY_INVALID');
  return Math.ceil(measured);
}

/** 默认读取上围栏：以本地输入限制减去最终请求的完整占用量计算。 */
export function resolveDefaultReadFenceTokens_ACU(inputLimitTokens: number, occupiedTokens: number): number {
  if (!Number.isSafeInteger(inputLimitTokens) || inputLimitTokens <= 0 || !Number.isSafeInteger(occupiedTokens) || occupiedTokens < 0) {
    throw new Error('READ_FENCE_CAPACITY_INVALID');
  }
  const available = inputLimitTokens - occupiedTokens;
  if (available <= 0) throw new Error('READ_FENCE_CAPACITY_EXHAUSTED');
  const limit = Math.floor(available * 0.6);
  if (limit <= 0) throw new Error('READ_FENCE_CAPACITY_EXHAUSTED');
  return limit;
}
