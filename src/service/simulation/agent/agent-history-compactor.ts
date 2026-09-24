import type { WorldSimulationConversationCompaction_ACU, WorldSimulationConversationMessage_ACU, WorldSimulationConversationView_ACU, WorldSimulationHandoffState_ACU } from './agent-model';
import { summarizeWorldSimulationHandoff_ACU, type WorldSimulationHandoffSemanticAdapter_ACU } from './agent-handoff-summarizer';
import type { WorldSimulationTokenCounter_ACU } from './agent-token-budget';
import { measureWorldSimulationPrompt_ACU } from './agent-token-budget';

export type WorldSimulationCompactionStatus_ACU = 'compacted' | 'compacted_above_target' | 'not_needed' | 'no_progress' | 'incompressible' | 'summary_failed';
export interface WorldSimulationCompactionResult_ACU { status: WorldSimulationCompactionStatus_ACU; view: WorldSimulationConversationView_ACU; mark: WorldSimulationConversationCompaction_ACU | null; handoffState: WorldSimulationHandoffState_ACU | null; beforeTokens: number; afterTokens: number; targetTokens: number; droppedMessages: number; droppedTurns: number; }
const clamp_ACU = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

async function measure_ACU(messages: readonly WorldSimulationConversationMessage_ACU[], fixed: number, count: WorldSimulationTokenCounter_ACU): Promise<number> {
  let total = fixed; for (const message of messages) total += await count(message.text); return total;
}
function groups_ACU(messages: readonly WorldSimulationConversationMessage_ACU[]): WorldSimulationConversationMessage_ACU[][] {
  const groups: WorldSimulationConversationMessage_ACU[][] = [];
  let current: WorldSimulationConversationMessage_ACU[] = [];
  for (const message of messages.filter(item => item.kind !== 'handoff')) {
    if (current.length && (message.kind === 'model_agent' || message.kind === 'user')) {
      groups.push(current);
      current = [];
    }
    current.push(message);
    if (message.kind === 'model_feedback') {
      groups.push(current);
      current = [];
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

function closed_ACU(group: readonly WorldSimulationConversationMessage_ACU[]): boolean {
  if (group.some(item => item.kind === 'model_agent' || item.kind === 'model_feedback')) {
    return group.length === 2 && group[0].kind === 'model_agent' && group[1].kind === 'model_feedback';
  }
  return group.every(item => item.kind === 'user' && !item.eventKind);
}

/** 与 readWorldSimulationDirectorHistory_ACU 同一投影：模型可见楼层消息 → 请求消息。 */
function renderView_ACU(messages: readonly WorldSimulationConversationMessage_ACU[]): Array<{ role: string; content: string }> {
  return messages.map(message => ({ role: message.kind === 'model_agent' ? 'assistant' : 'user', content: message.text }));
}

/** 在最终准备发送的消息里逐条定位当前历史投影并替换为压缩后投影；找不到时返回 null，调用方不得用算术差值冒充实测。 */
function replaceHistory_ACU(prepared: readonly { role: string; content: string }[], before: readonly { role: string; content: string }[], after: readonly { role: string; content: string }[]): Array<{ role: string; content: string }> | null {
  if (!before.length) return null;
  for (let start = 0; start <= prepared.length - before.length; start += 1) {
    if (before.every((message, offset) => message.role === prepared[start + offset].role && message.content === prepared[start + offset].content)) {
      return [...prepared.slice(0, start), ...after, ...prepared.slice(start + before.length)];
    }
  }
  return null;
}

export async function planWorldSimulationHistoryCompaction_ACU(input: { view: WorldSimulationConversationView_ACU; triggerTokens: number; fixedPromptTokens: number; countTokens: WorldSimulationTokenCounter_ACU; preparedMessages?: readonly { role: string; content: string }[]; previousState?: WorldSimulationHandoffState_ACU | null; semanticAdapter?: WorldSimulationHandoffSemanticAdapter_ACU }): Promise<WorldSimulationCompactionResult_ACU> {
  const unchanged = (status: WorldSimulationCompactionStatus_ACU, before: number, target: number): WorldSimulationCompactionResult_ACU => ({ status, view: input.view, mark: null, handoffState: null, beforeTokens: before, afterTokens: before, targetTokens: target, droppedMessages: 0, droppedTurns: 0 });
  const trigger = Math.floor(input.triggerTokens);
  if (!Number.isFinite(trigger) || trigger <= 0) return unchanged('not_needed', 0, 0);
  const target = Math.max(0, trigger - clamp_ACU(Math.floor(trigger * 0.2), 8000, 24000));
  const before = input.preparedMessages
    ? await measureWorldSimulationPrompt_ACU(input.preparedMessages, input.countTokens)
    : await measure_ACU(input.view.messages, input.fixedPromptTokens, input.countTokens);
  if (before <= trigger) return unchanged('not_needed', before, target);
  const grouped = groups_ACU(input.view.messages);
  // Only older complete pairs may be summarized. The current user instruction and
  // the last four groups remain verbatim even when the latter cannot fit the budget.
  const protectedStart = Math.max(0, grouped.length - 4);
  let latestUserGroup = -1;
  grouped.forEach((group, index) => { if (group.some(item => item.kind === 'user' && !item.eventKind)) latestUserGroup = index; });
  const maxDropped = Math.min(protectedStart, latestUserGroup < 0 ? protectedStart : latestUserGroup);
  if (!maxDropped) return unchanged('incompressible', before, target);
  let droppedTurns = 0;
  while (droppedTurns < maxDropped && closed_ACU(grouped[droppedTurns])) droppedTurns += 1;
  if (!droppedTurns) return unchanged('incompressible', before, target);
  const dropped = grouped.slice(0, droppedTurns).flat();
  const kept = grouped.slice(droppedTurns).flat();
  const through = dropped.reduce((max, item) => Math.max(max, item.id), 0);
  if (through <= (input.view.compaction?.compactedThroughId ?? 0)) return unchanged('no_progress', before, target);
  const handoffBudget = clamp_ACU(Math.floor(trigger * 0.08), 2000, 8000);
  let summary;
  try { summary = await summarizeWorldSimulationHandoff_ACU({ previous: input.previousState ?? (input.view.compaction ? { currentGoal: '', effectiveConstraints: [], decisions: [], completedItems: [], pendingItems: [], blockers: [], continuityFacts: [input.view.compaction.report], readKeys: [], recentTurns: [] } : null), messages: dropped, maxTokens: handoffBudget, countTokens: input.countTokens, ...(input.semanticAdapter ? { semanticAdapter: input.semanticAdapter } : {}) }); } catch { return unchanged('summary_failed', before, target); }
  const at = Date.now();
  const handoff: WorldSimulationConversationMessage_ACU = { id: 0, kind: 'handoff', text: summary.report, digest: `交接报告（浓缩 ${droppedTurns} 个轮次）`, turnKey: '', at };
  const messages = [handoff, ...kept];
  const preparedAfter = input.preparedMessages ? replaceHistory_ACU(input.preparedMessages, renderView_ACU(input.view.messages), renderView_ACU(messages)) : null;
  // 最终请求里的历史块必须与权威投影逐条一致才谈得上实测压缩后体量；
  // 对不上时不压缩，绝不把「before − 被浓缩原文 + 报告」的算术估算当成最终请求计量。
  if (input.preparedMessages && !preparedAfter) return unchanged('incompressible', before, target);
  const after = preparedAfter
    ? await measureWorldSimulationPrompt_ACU(preparedAfter, input.countTokens)
    : await measure_ACU(messages, input.fixedPromptTokens, input.countTokens);
  if (after >= before) return unchanged('no_progress', before, target);
  const mark = { compactedThroughId: through, report: summary.report, at };
  return { status: after <= target ? 'compacted' : 'compacted_above_target', view: { ...input.view, messages, compaction: mark }, mark, handoffState: summary.state, beforeTokens: before, afterTokens: after, targetTokens: target, droppedMessages: dropped.length, droppedTurns };
}
