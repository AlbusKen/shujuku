import { describe, expect, it } from 'vitest';
import { planWorldSimulationHistoryCompaction_ACU } from '../../../../src/service/simulation/agent/agent-history-compactor';
import { summarizeWorldSimulationHandoff_ACU } from '../../../../src/service/simulation/agent/agent-handoff-summarizer';

const count = async (text: string) => text.length;
function view(oldSize = 150000, recentSize = 10000) {
  return { nextId: 5, compaction: null, diagnostics: [], messages: [
    { id: 1, kind: 'turn' as const, text: '旧轮', digest: '旧目标', turnKey: 't1', at: 1 },
    { id: 2, kind: 'agent' as const, text: 'A'.repeat(oldSize), digest: '旧决策', turnKey: 't1', at: 1, readKey: '$OLD' },
    { id: 3, kind: 'turn' as const, text: '当前轮', digest: '当前目标', turnKey: 't2', at: 2 },
    { id: 4, kind: 'agent' as const, text: 'B'.repeat(recentSize), digest: '当前决策', turnKey: 't2', at: 2 },
  ] };
}

describe('世界推演 handoff 与非破坏压缩', () => {
  it('语义 adapter 失败时显式降级并保留确定性事实', async () => {
    const result = await summarizeWorldSimulationHandoff_ACU({ previous: null, messages: view(10, 10).messages.slice(0, 2), maxTokens: 2000, countTokens: count, semanticAdapter: { summarize: async () => { throw new Error('bad'); } } });
    expect(result).toMatchObject({ degraded: true, degradationReason: 'semantic_summary_failed' });
    expect(result.report).toContain('旧决策'); expect(result.state.readKeys).toEqual(['$OLD']);
  });

  it('按完整 turn 压缩，保留最新真实轮次并只返回待保存标记', async () => {
    const result = await planWorldSimulationHistoryCompaction_ACU({ view: view(), triggerTokens: 120000, fixedPromptTokens: 0, countTokens: count });
    expect(result.status).toBe('compacted');
    expect(result.targetTokens).toBe(96000);
    expect(result.mark).toMatchObject({ compactedThroughId: 2 });
    expect(result.view.messages.slice(1).map(item => item.turnKey)).toEqual(['t2', 't2']);
    expect(result.view).not.toBe(view());
  });

  it('相同或更旧 cutoff 不生成重复标记', async () => {
    const current = view(); current.compaction = { compactedThroughId: 2, report: '旧交接', at: 1 };
    const result = await planWorldSimulationHistoryCompaction_ACU({ view: current, triggerTokens: 120000, fixedPromptTokens: 0, countTokens: count });
    expect(result).toMatchObject({ status: 'no_progress', mark: null });
    expect(result.view).toBe(current);
  });
});
