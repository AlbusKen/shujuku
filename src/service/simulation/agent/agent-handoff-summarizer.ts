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

function directorReadKeys_ACU(text: string): string[] {
  try {
    const action: unknown = JSON.parse(text);
    if (!action || typeof action !== 'object' || Array.isArray(action)) return [];
    const value = action as Record<string, unknown>;
    const calls = value.action === 'read' ? [value] : value.action === 'tools' && Array.isArray(value.calls) ? value.calls : [];
    return calls.flatMap(call => {
      if (!call || typeof call !== 'object' || Array.isArray(call)) return [];
      const read = call as Record<string, unknown>;
      return read.action === 'read' && Array.isArray(read.reads)
        ? read.reads.filter((key): key is string => typeof key === 'string' && !!key.trim()).slice(0, 32)
        : [];
    });
  } catch { return []; }
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
    if (message.kind === 'model_agent') {
      const keys = directorReadKeys_ACU(message.text);
      state.readKeys.push(...keys);
      state.decisions.push(keys.length ? `已调用 read：${keys.join('、')}` : '早期主会话动作已结束；必要时重新调阅权威资料');
    }
    if (message.kind === 'model_feedback') state.continuityFacts.push('早期主会话工具/工作流回执已折叠；详情需通过资料地址重新读取，未据此认定记录完整');
    if (message.readKey) state.readKeys.push(message.readKey);
  }
  for (const field of LIST_FIELDS_ACU) state[field] = (field === 'effectiveConstraints' || field === 'readKeys'
    ? list_ACU(state[field]) : list_ACU(state[field]).slice(-8)) as never;
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
    for (const field of LIST_FIELDS_ACU) if (field !== 'readKeys' && field !== 'recentTurns' && field !== 'effectiveConstraints') state[field] = list_ACU(proposed[field]).length ? list_ACU(proposed[field]) : state[field] as never;
  } catch { degradationReason = 'semantic_summary_failed'; }
  let report = renderWorldSimulationHandoff_ACU(state, degradationReason);
  for (const field of [...LIST_FIELDS_ACU].reverse()) {
    if (field === 'effectiveConstraints' || field === 'readKeys') continue;
    while (await input.countTokens(report) > input.maxTokens && state[field].length) { state[field] = state[field].slice(1) as never; report = renderWorldSimulationHandoff_ACU(state, degradationReason); }
  }
  const reportTokens = await input.countTokens(report);
  if (reportTokens > input.maxTokens) throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU('WORLD_SIMULATION_CONFIG_INVALID', 'handoff_summary', '交接摘要无法压缩到预算内', false, { reportTokens, maxTokens: input.maxTokens }));
  return { state, report, reportTokens, degraded: Boolean(degradationReason), ...(degradationReason ? { degradationReason } : {}) };
}
