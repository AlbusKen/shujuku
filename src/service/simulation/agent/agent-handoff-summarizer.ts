import { WorldSimulationValidationError_ACU, createWorldSimulationError_ACU } from '../model';
import type { WorldSimulationConversationMessage_ACU, WorldSimulationHandoffState_ACU } from './agent-model';
import type { WorldSimulationTokenCounter_ACU } from './agent-token-budget';

const LIST_FIELDS_ACU: Array<keyof Omit<WorldSimulationHandoffState_ACU, 'currentGoal'>> = ['effectiveConstraints', 'decisions', 'completedItems', 'pendingItems', 'blockers', 'continuityFacts', 'readKeys', 'recentTurns'];
const clean_ACU = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const list_ACU = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.map(clean_ACU).filter(Boolean))] : [];
const empty_ACU = (): WorldSimulationHandoffState_ACU => ({ currentGoal: '', effectiveConstraints: [], decisions: [], completedItems: [], pendingItems: [], blockers: [], continuityFacts: [], readKeys: [], recentTurns: [] });

export interface WorldSimulationHandoffSemanticAdapter_ACU {
  summarize(input: { previous: WorldSimulationHandoffState_ACU | null; messages: readonly WorldSimulationConversationMessage_ACU[]; allowedReadKeys: readonly string[] }): Promise<Partial<WorldSimulationHandoffState_ACU>>;
}

function deterministic_ACU(previous: WorldSimulationHandoffState_ACU | null, messages: readonly WorldSimulationConversationMessage_ACU[]): WorldSimulationHandoffState_ACU {
 const state: WorldSimulationHandoffState_ACU = previous
    ? {
        currentGoal: previous.currentGoal,
        effectiveConstraints: [...previous.effectiveConstraints],
        decisions: [...previous.decisions],
        completedItems: [...previous.completedItems],
        pendingItems: [...previous.pendingItems],
        blockers: [...previous.blockers],
        continuityFacts: [...previous.continuityFacts],
        readKeys: [...previous.readKeys],
        recentTurns: [...previous.recentTurns],
      }
    : empty_ACU();
  for (const message of messages) {
    const summary = clean_ACU(message.digest) || clean_ACU(message.text);
    if (message.kind === 'user') state.effectiveConstraints.push(summary);
    else if (message.kind === 'agent') state.decisions.push(summary);
    else if (message.kind === 'tool' || message.kind === 'runtime') state.continuityFacts.push(summary);
    else if (message.kind === 'turn') { state.currentGoal = summary; state.recentTurns.push(clean_ACU(message.turnKey) || summary); }
    if (message.readKey) state.readKeys.push(message.readKey);
  }
  for (const field of LIST_FIELDS_ACU) state[field] = list_ACU(state[field]).slice(-8) as never;
  return state;
}

export function renderWorldSimulationHandoff_ACU(state: WorldSimulationHandoffState_ACU, degradationReason = ''): string {
  const sections: Array<[string, string[]]> = [['当前目标', state.currentGoal ? [state.currentGoal] : []], ['有效约束', state.effectiveConstraints], ['已执行决策', state.decisions], ['已完成', state.completedItems], ['待办', state.pendingItems], ['阻塞', state.blockers], ['连续性事实', state.continuityFacts], ['资料地址', state.readKeys], ['近期轮次', state.recentTurns]];
  const body = sections.filter(([, items]) => items.length).map(([title, items]) => `【${title}】\n${items.map(item => `- ${item}`).join('\n')}`).join('\n');
  return `${degradationReason ? `【摘要降级】${degradationReason}\n` : ''}【更早世界推演会话交接】\n${body || '没有可保留的早期事项。'}`;
}

export async function summarizeWorldSimulationHandoff_ACU(input: { previous: WorldSimulationHandoffState_ACU | null; messages: readonly WorldSimulationConversationMessage_ACU[]; maxTokens: number; countTokens: WorldSimulationTokenCounter_ACU; semanticAdapter?: WorldSimulationHandoffSemanticAdapter_ACU }): Promise<{ state: WorldSimulationHandoffState_ACU; report: string; reportTokens: number; degraded: boolean; degradationReason?: string }> {
  let state = deterministic_ACU(input.previous, input.messages);
  let degradationReason = input.semanticAdapter ? '' : 'deterministic_adapter';
  if (input.semanticAdapter) try {
    const proposed = await input.semanticAdapter.summarize({ previous: input.previous, messages: input.messages, allowedReadKeys: state.readKeys });
    state.currentGoal = clean_ACU(proposed.currentGoal) || state.currentGoal;
    for (const field of LIST_FIELDS_ACU) if (field !== 'readKeys' && field !== 'recentTurns') state[field] = list_ACU(proposed[field]).length ? list_ACU(proposed[field]) : state[field] as never;
  } catch { degradationReason = 'semantic_summary_failed'; }
  let report = renderWorldSimulationHandoff_ACU(state, degradationReason);
  for (const field of [...LIST_FIELDS_ACU].reverse()) while (await input.countTokens(report) > input.maxTokens && state[field].length) { state[field] = state[field].slice(1) as never; report = renderWorldSimulationHandoff_ACU(state, degradationReason); }
  const reportTokens = await input.countTokens(report);
  if (reportTokens > input.maxTokens) throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU('WORLD_SIMULATION_CONFIG_INVALID', 'handoff_summary', '交接摘要无法压缩到预算内', false, { reportTokens, maxTokens: input.maxTokens }));
  return { state, report, reportTokens, degraded: Boolean(degradationReason), ...(degradationReason ? { degradationReason } : {}) };
}
