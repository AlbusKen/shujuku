import { describe, expect, it } from 'vitest';
import { planWorldSimulationHistoryCompaction_ACU } from '../../../../src/service/simulation/agent/agent-history-compactor';
import { summarizeWorldSimulationHandoff_ACU } from '../../../../src/service/simulation/agent/agent-handoff-summarizer';

const count = async (text: string) => text.length;
function view(oldSize = 150000, recentSize = 10000) {
  return { nextId: 13, compaction: null, diagnostics: [], messages: [
    { id: 1, kind: 'model_agent' as const, text: 'A'.repeat(oldSize), digest: '旧决策', turnKey: 't1', at: 1, readKey: '$OLD' },
    { id: 2, kind: 'model_feedback' as const, text: '旧回执', digest: '', turnKey: 't1', at: 1 },
    ...Array.from({ length: 4 }, (_, index) => [
      { id: index * 2 + 3, kind: 'model_agent' as const, text: `A${index}`, digest: `决策 ${index}`, turnKey: `t${index + 2}`, at: index + 2 },
      { id: index * 2 + 4, kind: 'model_feedback' as const, text: index === 3 ? 'B'.repeat(recentSize) : `回执 ${index}`, digest: '', turnKey: `t${index + 2}`, at: index + 2 },
    ]).flat(),
  ] };
}

describe('世界推演 handoff 与非破坏压缩', () => {
  it('语义 adapter 失败时显式降级并保留确定性事实', async () => {
    const result = await summarizeWorldSimulationHandoff_ACU({ previous: null, messages: [{ id: 1, kind: 'agent', text: '旧决策', digest: '旧决策', turnKey: 't1', at: 1, readKey: '$OLD' }], maxTokens: 2000, countTokens: count, semanticAdapter: { summarize: async () => { throw new Error('bad'); } } });
    expect(result).toMatchObject({ degraded: true, degradationReason: 'semantic_summary_failed' });
    expect(result.report).toContain('旧决策'); expect(result.state.readKeys).toEqual(['$OLD']);
  });

  it('语义 adapter 不能覆盖确定性提取的有效约束', async () => {
    const result = await summarizeWorldSimulationHandoff_ACU({
      previous: null,
      messages: [{ id: 1, kind: 'user', text: '推演不得改变既定人设', digest: '', turnKey: 't1', at: 1 }],
      maxTokens: 2000,
      countTokens: count,
      semanticAdapter: { summarize: async () => ({ currentGoal: '语义目标', effectiveConstraints: ['编造的约束'], decisions: [], completedItems: [], pendingItems: [], blockers: [], continuityFacts: [], readKeys: [], recentTurns: [] }) },
    });
    expect(result).toMatchObject({ degraded: false });
    expect(result.state.currentGoal).toBe('语义目标');
    expect(result.state.effectiveConstraints).toEqual(['推演不得改变既定人设']);
  });

  it('按完整 turn 压缩，保留最新真实轮次并只返回待保存标记', async () => {
    const result = await planWorldSimulationHistoryCompaction_ACU({ view: view(), triggerTokens: 120000, fixedPromptTokens: 0, countTokens: count });
    expect(result.status).toBe('compacted');
    expect(result.targetTokens).toBe(96000);
    expect(result.mark).toMatchObject({ compactedThroughId: 2 });
    expect(result.view.messages.slice(1).map(item => item.turnKey)).toEqual(['t2', 't2', 't3', 't3', 't4', 't4', 't5', 't5']);
    expect(result.view).not.toBe(view());
  });

  it('未闭合动作、插入的用户要求和无法安全缩短的历史均不被压掉', async () => {
    const interrupted = view();
    interrupted.messages.splice(1, 1);
    const result = await planWorldSimulationHistoryCompaction_ACU({ view: interrupted, triggerTokens: 120000,
      fixedPromptTokens: 0, countTokens: count });
    expect(result).toMatchObject({ status: 'incompressible', mark: null });
    const user = view();
    user.messages.splice(1, 0, { id: 13, kind: 'user', text: '最新要求：停止旧动作', digest: '', turnKey: 'new', at: 10 });
    const latest = await planWorldSimulationHistoryCompaction_ACU({ view: user, triggerTokens: 120000,
      fixedPromptTokens: 0, countTokens: count });
    expect(latest.mark?.compactedThroughId).toBeUndefined();
    const tooShort = await planWorldSimulationHistoryCompaction_ACU({ view: view(50, 10000),
      triggerTokens: 120000, fixedPromptTokens: 130000, countTokens: count });
    expect(tooShort).toMatchObject({ status: 'no_progress', mark: null });
  });

  it('完整待发送请求计入固定内容和已有 handoff，报告替换旧报告而不叠加', async () => {
    const current = view(150000, 10000);
    current.compaction = { compactedThroughId: 0, report: 'OLD_HANDOFF', at: 1 };
    current.messages.unshift({ id: 0, kind: 'handoff', text: 'OLD_HANDOFF', digest: '', turnKey: '', at: 1 });
    const prepared = [{ role: 'system', content: 'F'.repeat(1200) }, ...current.messages.map(item => ({ role: item.kind === 'model_agent' ? 'assistant' : 'user', content: item.text }))];
    const result = await planWorldSimulationHistoryCompaction_ACU({ view: current, triggerTokens: 120000,
      fixedPromptTokens: 0, preparedMessages: prepared, countTokens: count });
    expect(result.mark).toMatchObject({ compactedThroughId: 2 });
    expect(result.beforeTokens).toBe(prepared.reduce((total, item) => total + item.content.length, 0));
    expect(result.afterTokens).toBe(result.beforeTokens - 150000 - 3 - 'OLD_HANDOFF'.length + result.mark!.report.length);
  });

  it('压缩真实原生工具历史时保持调用与回执配对，并拒绝元数据不一致的待发请求', async () => {
    const current = view(150000, 10000);
    const call = { id: 'call_read_1', type: 'function' as const, function: { name: 'read', arguments: '{"reads":["ledger:current"]}' } };
    current.messages[2].toolCalls = [{ id: call.id, name: call.function.name, arguments: call.function.arguments }];
    current.messages[3].toolCallId = call.id;
    const prepared = [{ role: 'system', content: 'F'.repeat(1200) }, ...current.messages.map(item => item.kind === 'model_agent'
      ? { role: 'assistant', content: item.text, ...(item.toolCalls?.length ? { tool_calls: [call] } : {}) }
      : item.toolCallId ? { role: 'tool', content: item.text, tool_call_id: item.toolCallId }
        : { role: 'user', content: item.text })];
    const result = await planWorldSimulationHistoryCompaction_ACU({ view: current, triggerTokens: 120000,
      fixedPromptTokens: 0, preparedMessages: prepared, countTokens: count });
    expect(result.mark).toMatchObject({ compactedThroughId: 2 });
    expect(result.view.messages[1].toolCalls).toEqual([{ id: call.id, name: call.function.name, arguments: call.function.arguments }]);
    expect(result.view.messages[2].toolCallId).toBe(call.id);
    const corrupted = prepared.map(item => ({ ...item }));
    const receipt = corrupted.find(item => 'tool_call_id' in item);
    if (!receipt) throw new Error('test fixture has no tool receipt');
    receipt.tool_call_id = 'unknown-call';
    const rejected = await planWorldSimulationHistoryCompaction_ACU({ view: current, triggerTokens: 120000,
      fixedPromptTokens: 0, preparedMessages: corrupted, countTokens: count });
    expect(rejected).toMatchObject({ status: 'incompressible', mark: null });
  });

  it('待发送请求与权威投影逐条不一致时不压缩，不用算术差值冒充计量', async () => {
    const current = view(150000, 10000);
    // 全按 user 渲染的伪历史块：真实投影里 model_agent 是 assistant，替换定位必须失败。
    const prepared = [{ role: 'system', content: 'F'.repeat(1200) }, ...current.messages.map(item => ({ role: 'user', content: item.text }))];
    const result = await planWorldSimulationHistoryCompaction_ACU({ view: current, triggerTokens: 120000,
      fixedPromptTokens: 0, preparedMessages: prepared, countTokens: count });
    expect(result).toMatchObject({ status: 'incompressible', mark: null });
    expect(result.view).toBe(current);
  });

  it('相同或更旧 cutoff 不生成重复标记', async () => {
    const current = view(); current.compaction = { compactedThroughId: 2, report: '旧交接', at: 1 };
    const result = await planWorldSimulationHistoryCompaction_ACU({ view: current, triggerTokens: 120000, fixedPromptTokens: 0, countTokens: count });
    expect(result).toMatchObject({ status: 'no_progress', mark: null });
    expect(result.view).toBe(current);
  });
});
