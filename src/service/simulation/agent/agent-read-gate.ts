import type { WorldSimulationTokenCounter_ACU } from './agent-token-budget';
import { countWorldSimulationTokens_ACU } from './agent-token-budget';

export interface WorldSimulationReadGateItem_ACU { label: string; text: string; }
export interface WorldSimulationReadGateConfig_ACU { historyTokenBudget: number; readTokenBudget: number | string; fallbackTokens: number; }
export interface WorldSimulationReadGateState_ACU { grantedTokens: number; }
export type WorldSimulationReadRejectReason_ACU = 'read-batch-too-large' | 'near-compaction-overflow';
export interface WorldSimulationReadDecision_ACU { allowed: boolean; reason?: WorldSimulationReadRejectReason_ACU; batchTokens: number; itemTokens: number[]; report: string; }

export function createWorldSimulationReadGateState_ACU(): WorldSimulationReadGateState_ACU { return { grantedTokens: 0 }; }

export function resolveWorldSimulationReadBudget_ACU(config: WorldSimulationReadGateConfig_ACU): { effectiveMaxReadTokens: number; effectiveFallbackTokens: number; basis: 'fixed' | 'history-budget-percent' } {
  const base = config.historyTokenBudget > 0 ? config.historyTokenBudget : 120000;
  let max = 0;
  let basis: 'fixed' | 'history-budget-percent' = 'history-budget-percent';
  if (typeof config.readTokenBudget === 'number' && Number.isFinite(config.readTokenBudget) && config.readTokenBudget >= 1) { max = Math.floor(config.readTokenBudget); basis = 'fixed'; }
  else if (typeof config.readTokenBudget === 'string' && /%$/.test(config.readTokenBudget.trim())) {
    const percent = Number.parseFloat(config.readTokenBudget);
    if (percent >= 1 && percent <= 100) max = Math.floor(base * percent / 100);
  }
  if (max < 1) max = Math.floor(base * 0.2);
  const fallback = Number.isFinite(config.fallbackTokens) && config.fallbackTokens >= 1 ? Math.floor(config.fallbackTokens) : 6000;
  return { effectiveMaxReadTokens: max, effectiveFallbackTokens: Math.min(fallback, max), basis };
}

export async function gateWorldSimulationReadBatch_ACU(items: readonly WorldSimulationReadGateItem_ACU[], state: WorldSimulationReadGateState_ACU, config: WorldSimulationReadGateConfig_ACU, contextTokens: number, count: WorldSimulationTokenCounter_ACU = countWorldSimulationTokens_ACU): Promise<WorldSimulationReadDecision_ACU> {
  const itemTokens = await Promise.all(items.map(item => count(item.text)));
  const batchTokens = itemTokens.reduce((sum, value) => sum + value, 0);
  if (!items.length) return { allowed: true, batchTokens: 0, itemTokens, report: '' };
  const budget = resolveWorldSimulationReadBudget_ACU(config);
  const projectedGrantedTokens = state.grantedTokens + batchTokens;
  let reason: WorldSimulationReadRejectReason_ACU | undefined;
  if (projectedGrantedTokens > budget.effectiveMaxReadTokens) reason = 'read-batch-too-large';
  else if (config.historyTokenBudget > 0 && contextTokens > 0 && contextTokens + batchTokens > config.historyTokenBudget && batchTokens > budget.effectiveFallbackTokens) reason = 'near-compaction-overflow';
  if (!reason) return { allowed: true, batchTokens, itemTokens, report: '' };
  const limit = reason === 'read-batch-too-large' ? budget.effectiveMaxReadTokens : budget.effectiveFallbackTokens;
  const sizes = items.map((item, index) => `- ${item.label}: ${itemTokens[index]} tokens`).join('\n');
  return { allowed: false, reason, batchTokens, itemTokens, report: `WORLD_SIMULATION_READ_REJECTED\nreason=${reason}\ngranted=${state.grantedTokens}\nbatch=${batchTokens}\nlimit=${limit}\n${sizes}\n请缩小读取范围后重试；本批正文未注入。` };
}
