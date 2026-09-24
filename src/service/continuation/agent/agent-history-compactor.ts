import { renderAgentConversationMessages_ACU } from './agent-conversation-store';
import { summarizeAgentHandoff_ACU, type AgentHandoffSemanticSummaryAdapter_ACU } from './agent-handoff-summarizer';
import type { AgentConversationCompactionMarkV1_ACU, AgentConversationCompactionMarkV2_ACU, AgentConversationMessage_ACU, AgentConversationSnapshot_ACU, AgentHandoffSummaryStateV2_ACU } from './agent-model';
import type { TokenCounter_ACU } from './agent-token-budget';

export type AgentHistoryCompactionStatus_ACU = 'compacted' | 'compacted_above_target' | 'not_needed' | 'no_progress' | 'incompressible' | 'summary_failed';
export interface AgentHistoryCompactionResult_ACU {
  status: AgentHistoryCompactionStatus_ACU;
  snapshot: AgentConversationSnapshot_ACU;
  mark: AgentConversationCompactionMarkV2_ACU | null;
  beforeTokens: number;
  afterTokens: number;
  targetTokens: number;
  droppedMessages: number;
  droppedTurns: number;
}

export interface AgentHistoryCompactionInput_ACU {
  snapshot: AgentConversationSnapshot_ACU;
  activeMark: AgentConversationCompactionMarkV1_ACU | AgentConversationCompactionMarkV2_ACU | null;
  triggerTokens: number;
  fixedPromptTokens: number;
  preparedMessages?: readonly { role: string; content: string }[];
  countTokens: TokenCounter_ACU;
  semanticAdapter?: AgentHandoffSemanticSummaryAdapter_ACU;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

async function measure_ACU(snapshot: AgentConversationSnapshot_ACU, fixed: number, count: TokenCounter_ACU): Promise<number> {
  let total = fixed;
  for (const message of renderAgentConversationMessages_ACU(snapshot)) total += await count(message.content);
  return total;
}

function groups_ACU(messages: readonly AgentConversationMessage_ACU[]): AgentConversationMessage_ACU[][] {
  const result: AgentConversationMessage_ACU[][] = [];
  for (const message of messages.filter(item => item.kind !== 'handoff')) {
    const previous = result[result.length - 1];
    if (previous?.[0]?.turnKey === message.turnKey) previous.push(message);
    else result.push([message]);
  }
  return result;
}

function replaceHistory_ACU(prepared: readonly { role: string; content: string }[], before: AgentConversationSnapshot_ACU, after: AgentConversationSnapshot_ACU): Array<{ role: string; content: string }> | null {
  const source = renderAgentConversationMessages_ACU(before);
  const replacement = renderAgentConversationMessages_ACU(after);
  if (!source.length) return null;
  for (let start = 0; start <= prepared.length - source.length; start += 1) {
    if (source.every((message, offset) => message.role === prepared[start + offset].role && message.content === prepared[start + offset].content)) {
      return [...prepared.slice(0, start), ...replacement, ...prepared.slice(start + source.length)];
    }
  }
  return null;
}

async function measurePrepared_ACU(messages: readonly { role: string; content: string }[], count: TokenCounter_ACU): Promise<number> {
  let total = 0;
  for (const message of messages) total += await count(message.content);
  return total;
}

export async function planAgentHistoryCompaction_ACU(input: AgentHistoryCompactionInput_ACU): Promise<AgentHistoryCompactionResult_ACU> {
  const unchanged = (status: AgentHistoryCompactionStatus_ACU, beforeTokens: number, targetTokens: number): AgentHistoryCompactionResult_ACU => ({ status, snapshot: input.snapshot, mark: null, beforeTokens, afterTokens: beforeTokens, targetTokens, droppedMessages: 0, droppedTurns: 0 });
  const trigger = Math.floor(input.triggerTokens);
  if (!Number.isFinite(trigger) || trigger <= 0) return unchanged('not_needed', 0, 0);
  const reserve = clamp(Math.floor(trigger * 0.2), 8000, 24000);
  const targetTokens = Math.max(0, trigger - reserve);
  const beforeTokens = input.preparedMessages ? await measurePrepared_ACU(input.preparedMessages, input.countTokens) : await measure_ACU(input.snapshot, input.fixedPromptTokens, input.countTokens);
  if (beforeTokens <= trigger) return unchanged('not_needed', beforeTokens, targetTokens);
  const grouped = groups_ACU(input.snapshot.messages);
  if (grouped.length < 2) return unchanged('incompressible', beforeTokens, targetTokens);
  let lastUser = -1;
  grouped.forEach((group, index) => { if (group.some(message => message.kind === 'user')) lastUser = index; });
  const maxDropped = Math.min(grouped.length - (grouped.length > 2 ? 2 : 1), lastUser < 0 ? grouped.length - 1 : lastUser);
  if (maxDropped < 1) return unchanged('incompressible', beforeTokens, targetTokens);
  const maxHandoffTokens = clamp(Math.floor(trigger * 0.08), 2000, 8000);
  let droppedTurns = 1;
  const currentTokens = async (turns: number): Promise<number> => {
    const candidateSnapshot = { ...input.snapshot, messages: grouped.slice(turns).flat() };
    if (!input.preparedMessages) return measure_ACU(candidateSnapshot, input.fixedPromptTokens, input.countTokens);
    const prepared = replaceHistory_ACU(input.preparedMessages, input.snapshot, candidateSnapshot);
    return prepared ? measurePrepared_ACU(prepared, input.countTokens) : Infinity;
  };
  while (droppedTurns < maxDropped && (await currentTokens(droppedTurns)) + maxHandoffTokens > targetTokens) droppedTurns += 1;
  const kept = grouped.slice(droppedTurns).flat();
  const dropped = grouped.slice(0, droppedTurns).flat();
  // Never summarize a receipt without its initiating action, or an action awaiting a tool result.
  for (const group of grouped.slice(0, droppedTurns)) {
    const hasAction = group.some(message => message.kind === 'agent');
    const hasReceipt = group.some(message => message.kind === 'tool');
    if (hasAction && !hasReceipt && group.some(message => message.kind === 'agent' && /"action"\s*:\s*"(?:read|search|delegate|open_round|tools)"/.test(message.text))) {
      return unchanged('incompressible', beforeTokens, targetTokens);
    }
    if (hasReceipt && !hasAction) return unchanged('incompressible', beforeTokens, targetTokens);
  }
  if (kept[0]?.kind === 'tool' && dropped.some(item => item.kind === 'agent' && item.turnKey === kept[0].turnKey)) return unchanged('incompressible', beforeTokens, targetTokens);
  const compactedThroughId = dropped.reduce((max, item) => Math.max(max, item.id), 0);
  if (compactedThroughId <= (input.activeMark?.compactedThroughId ?? 0)) return unchanged('no_progress', beforeTokens, targetTokens);
  const previous: AgentHandoffSummaryStateV2_ACU | null = input.activeMark && 'summaryState' in input.activeMark
    ? input.activeMark.summaryState
    : input.activeMark
      ? { currentGoal: '', effectiveConstraints: [], decisions: [], completedItems: [], pendingItems: [], blockers: [], continuityFacts: [input.activeMark.report], readKeys: [], recentTurns: [] }
      : null;
  let summary;
  try {
    summary = await summarizeAgentHandoff_ACU({
      previous,
      messages: dropped,
      maxTokens: maxHandoffTokens,
      countTokens: input.countTokens,
      ...(input.semanticAdapter ? { semanticAdapter: input.semanticAdapter } : {}),
    });
  } catch {
    return unchanged('summary_failed', beforeTokens, targetTokens);
  }
  const at = Date.now();
  const handoff: AgentConversationMessage_ACU = {
    id: compactedThroughId,
    kind: 'handoff',
    text: summary.report,
    digest: `交接报告（浓缩 ${droppedTurns} 个轮次）`,
    turnKey: '',
    at,
  };
  const candidateSnapshot: AgentConversationSnapshot_ACU = { ...input.snapshot, messages: [handoff, ...kept] };
  const preparedAfter = input.preparedMessages ? replaceHistory_ACU(input.preparedMessages, input.snapshot, candidateSnapshot) : null;
  if (input.preparedMessages && !preparedAfter) return unchanged('incompressible', beforeTokens, targetTokens);
  const afterTokens = preparedAfter ? await measurePrepared_ACU(preparedAfter, input.countTokens) : await measure_ACU(candidateSnapshot, input.fixedPromptTokens, input.countTokens);
  if (afterTokens >= beforeTokens) return unchanged('no_progress', beforeTokens, targetTokens);
  const mark: AgentConversationCompactionMarkV2_ACU = {
    schemaVersion: 2,
    compactedThroughId,
    report: summary.report,
    summaryState: summary.state,
    at,
    metrics: {
      sourceFromId: dropped[0].id,
      sourceThroughId: compactedThroughId,
      beforeTokens,
      afterTokens,
      fixedPromptTokens: input.fixedPromptTokens,
      reportTokens: summary.reportTokens,
      targetTokens,
      triggerTokens: trigger,
      droppedMessages: dropped.length,
      droppedTurns,
      degraded: summary.degraded,
      ...(summary.degradationReason ? { degradationReason: summary.degradationReason } : {}),
    },
  };
  return {
    status: afterTokens <= targetTokens ? 'compacted' : 'compacted_above_target',
    snapshot: candidateSnapshot,
    mark,
    beforeTokens,
    afterTokens,
    targetTokens,
    droppedMessages: dropped.length,
    droppedTurns,
  };
}
