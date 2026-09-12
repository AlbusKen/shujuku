import type { AgentKernelTokenCounter_ACU } from './token-budget';

export interface AgentKernelReadGateConfig_ACU {
  historyTokenBudget: number;
  readTokenBudget: number | string;
  fallbackTokens: number;
  defaultHistoryTokenBudget: number;
  defaultFallbackTokens: number;
}

export interface AgentKernelReadBudget_ACU {
  effectiveMaxReadTokens: number;
  effectiveFallbackTokens: number;
  basis: 'fixed' | 'history-budget-percent';
}

export type AgentKernelReadRejectReason_ACU = 'read-batch-too-large' | 'near-compaction-overflow';

export function resolveAgentKernelReadBudget_ACU(config: AgentKernelReadGateConfig_ACU): AgentKernelReadBudget_ACU {
  const base = config.historyTokenBudget > 0 ? config.historyTokenBudget : config.defaultHistoryTokenBudget;
  const raw = config.readTokenBudget;
  let max = 0;
  let basis: AgentKernelReadBudget_ACU['basis'] = 'history-budget-percent';
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1) {
    max = Math.floor(raw);
    basis = 'fixed';
  } else if (typeof raw === 'string' && raw.trim().endsWith('%')) {
    const percent = Number.parseFloat(raw.trim());
    if (Number.isFinite(percent) && percent >= 1 && percent <= 100) max = Math.floor(base * percent / 100);
  }
  if (!Number.isFinite(max) || max < 1) max = Math.floor(base * 0.2);
  const fallback = Number.isFinite(config.fallbackTokens) && config.fallbackTokens >= 1
    ? Math.floor(config.fallbackTokens)
    : config.defaultFallbackTokens;
  return { effectiveMaxReadTokens: max, effectiveFallbackTokens: Math.min(fallback, max), basis };
}

export async function decideAgentKernelReadBatch_ACU(
  texts: readonly string[],
  config: AgentKernelReadGateConfig_ACU,
  contextTokens: number,
  count: AgentKernelTokenCounter_ACU,
): Promise<{ allowed: boolean; reason?: AgentKernelReadRejectReason_ACU; batchTokens: number; itemTokens: number[] }> {
  const itemTokens = await Promise.all(texts.map(text => count(String(text ?? ''))));
  const batchTokens = itemTokens.reduce((sum, value) => sum + value, 0);
  if (!texts.length) return { allowed: true, batchTokens, itemTokens };
  const budget = resolveAgentKernelReadBudget_ACU(config);
  if (batchTokens > budget.effectiveMaxReadTokens) return { allowed: false, reason: 'read-batch-too-large', batchTokens, itemTokens };
  if (config.historyTokenBudget > 0 && contextTokens > 0 && contextTokens + batchTokens > config.historyTokenBudget && batchTokens > budget.effectiveFallbackTokens) {
    return { allowed: false, reason: 'near-compaction-overflow', batchTokens, itemTokens };
  }
  return { allowed: true, batchTokens, itemTokens };
}
