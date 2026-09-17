import type { WorldSimulationConversationCompaction_ACU, WorldSimulationConversationMessage_ACU, WorldSimulationConversationView_ACU, WorldSimulationHandoffState_ACU } from './agent-model';
import { summarizeWorldSimulationHandoff_ACU, type WorldSimulationHandoffSemanticAdapter_ACU } from './agent-handoff-summarizer';
import type { WorldSimulationTokenCounter_ACU } from './agent-token-budget';

export type WorldSimulationCompactionStatus_ACU = 'compacted' | 'compacted_above_target' | 'not_needed' | 'no_progress' | 'incompressible' | 'summary_failed';
export interface WorldSimulationCompactionResult_ACU { status: WorldSimulationCompactionStatus_ACU; view: WorldSimulationConversationView_ACU; mark: WorldSimulationConversationCompaction_ACU | null; handoffState: WorldSimulationHandoffState_ACU | null; beforeTokens: number; afterTokens: number; targetTokens: number; droppedMessages: number; droppedTurns: number; }
const clamp_ACU = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

async function measure_ACU(messages: readonly WorldSimulationConversationMessage_ACU[], fixed: number, count: WorldSimulationTokenCounter_ACU): Promise<number> {
  let total = fixed; for (const message of messages) total += await count(message.text); return total;
}
function groups_ACU(messages: readonly WorldSimulationConversationMessage_ACU[]): WorldSimulationConversationMessage_ACU[][] {
  const groups: WorldSimulationConversationMessage_ACU[][] = [];
  for (const message of messages.filter(item => item.kind !== 'handoff')) {
    const previous = groups[groups.length - 1];
    if (previous && previous[0]?.turnKey === message.turnKey) previous.push(message); else groups.push([message]);
  }
  return groups;
}

export async function planWorldSimulationHistoryCompaction_ACU(input: { view: WorldSimulationConversationView_ACU; triggerTokens: number; fixedPromptTokens: number; countTokens: WorldSimulationTokenCounter_ACU; previousState?: WorldSimulationHandoffState_ACU | null; semanticAdapter?: WorldSimulationHandoffSemanticAdapter_ACU }): Promise<WorldSimulationCompactionResult_ACU> {
  const unchanged = (status: WorldSimulationCompactionStatus_ACU, before: number, target: number): WorldSimulationCompactionResult_ACU => ({ status, view: input.view, mark: null, handoffState: null, beforeTokens: before, afterTokens: before, targetTokens: target, droppedMessages: 0, droppedTurns: 0 });
  const trigger = Math.floor(input.triggerTokens);
  if (!Number.isFinite(trigger) || trigger <= 0) return unchanged('not_needed', 0, 0);
  const target = trigger - clamp_ACU(Math.floor(trigger * 0.2), 8000, 24000);
  const before = await measure_ACU(input.view.messages, input.fixedPromptTokens, input.countTokens);
  if (before <= trigger) return unchanged('not_needed', before, target);
  const grouped = groups_ACU(input.view.messages);
  if (grouped.length < 2) return unchanged('incompressible', before, target);
  const handoffBudget = clamp_ACU(Math.floor(trigger * 0.08), 2000, 8000);
  let droppedTurns = 1; let kept = grouped.slice(1).flat();
  while (droppedTurns < grouped.length - 1) { const candidate = grouped.slice(droppedTurns).flat(); if (await measure_ACU(candidate, input.fixedPromptTokens, input.countTokens) + handoffBudget <= target) { kept = candidate; break; } droppedTurns += 1; kept = grouped.slice(droppedTurns).flat(); }
  const dropped = grouped.slice(0, droppedTurns).flat();
  const through = dropped.reduce((max, item) => Math.max(max, item.id), 0);
  if (through <= (input.view.compaction?.compactedThroughId ?? 0)) return unchanged('no_progress', before, target);
  let summary;
  try { summary = await summarizeWorldSimulationHandoff_ACU({ previous: input.previousState ?? (input.view.compaction ? { currentGoal: '', effectiveConstraints: [], decisions: [], completedItems: [], pendingItems: [], blockers: [], continuityFacts: [input.view.compaction.report], readKeys: [], recentTurns: [] } : null), messages: dropped, maxTokens: handoffBudget, countTokens: input.countTokens, ...(input.semanticAdapter ? { semanticAdapter: input.semanticAdapter } : {}) }); } catch { return unchanged('summary_failed', before, target); }
  const at = Date.now();
  const handoff: WorldSimulationConversationMessage_ACU = { id: 0, kind: 'handoff', text: summary.report, digest: `交接报告（浓缩 ${droppedTurns} 个轮次）`, turnKey: '', at };
  const messages = [handoff, ...kept]; const after = await measure_ACU(messages, input.fixedPromptTokens, input.countTokens);
  if (after >= before) return unchanged('no_progress', before, target);
  const mark = { compactedThroughId: through, report: summary.report, at };
  return { status: after <= target ? 'compacted' : 'compacted_above_target', view: { ...input.view, messages, compaction: mark }, mark, handoffState: summary.state, beforeTokens: before, afterTokens: after, targetTokens: target, droppedMessages: dropped.length, droppedTurns };
}
