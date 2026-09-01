import { describe, expect, it } from 'vitest';

import { createAgentHandoffSemanticSummaryAdapter_ACU, summarizeAgentHandoff_ACU } from '../../../../src/service/continuation/agent/agent-handoff-summarizer';
import type { AgentConversationMessage_ACU, AgentHandoffSummaryStateV2_ACU } from '../../../../src/service/continuation/agent/agent-model';

const count = async (text: string): Promise<number> => text.length;
const message = (id: number, kind: AgentConversationMessage_ACU['kind'], text: string, extra: Partial<AgentConversationMessage_ACU> = {}): AgentConversationMessage_ACU => ({ id, kind, text, digest: '', turnKey: 'turn-a', at: 1, ...extra });

const previous: AgentHandoffSummaryStateV2_ACU = {
  currentGoal: '旧目标', effectiveConstraints: ['旧约束'], decisions: ['旧决定'], completedItems: [], pendingItems: [], blockers: [], continuityFacts: [], readKeys: ['$STORY_RANGE:1-2'], recentTurns: ['旧轮'],
};

describe('summarizeAgentHandoff_ACU', () => {
  it('merges structured state and new messages without recursively copying a legacy report', async () => {
    const result = await summarizeAgentHandoff_ACU({
      previous,
      messages: [message(3, 'turn', '当前轮目标', { digest: '当前轮目标', turnKey: 'turn-b' }), message(4, 'tool', '读取结果', { digest: '已核对门禁', readKey: '$STORY_RANGE:3-4' })],
      maxTokens: 2000,
      countTokens: count,
    });

    expect(result.degraded).toBe(true);
    expect(result.degradationReason).toBe('deterministic_adapter');
    expect(result.state.currentGoal).toBe('当前轮目标');
    expect(result.state.readKeys).toEqual(['$STORY_RANGE:1-2', '$STORY_RANGE:3-4']);
    expect(result.report).toContain('旧决定');
    expect(result.report).not.toContain('旧报告正文');
  });

  it('does not accept read keys invented by the semantic adapter', async () => {
    const result = await summarizeAgentHandoff_ACU({
      previous: null,
      messages: [message(1, 'tool', '资料', { digest: '已读取', readKey: '$TABLE:纪要表:1-2' })],
      maxTokens: 2000,
      countTokens: count,
      semanticAdapter: { summarize: async () => ({ currentGoal: '语义归纳', readKeys: ['$STORY_RANGE:999-1000'] }) },
    });

    expect(result.degraded).toBe(false);
    expect(result.state.currentGoal).toBe('语义归纳');
    expect(result.state.readKeys).toEqual(['$TABLE:纪要表:1-2']);
  });

  it('repairs malformed semantic JSON once and keeps read keys and turn keys sourced from history', async () => {
    const replies = [
      'not json',
      JSON.stringify({ currentGoal: '语义目标', effectiveConstraints: [], decisions: ['语义决策'], completedItems: [], pendingItems: [], blockers: [], continuityFacts: [], readKeys: ['$STORY_RANGE:999-1000'], recentTurns: ['伪造轮次'] }),
    ];
    const calls: Array<Array<{ role: string; content: string }>> = [];
    const adapter = createAgentHandoffSemanticSummaryAdapter_ACU(async messages => {
      calls.push(messages);
      return replies.shift() ?? null;
    });
    const result = await summarizeAgentHandoff_ACU({
      previous: null,
      messages: [message(1, 'turn', '实际轮次', { digest: '实际轮次', turnKey: 'turn-real' }), message(2, 'tool', '资料', { digest: '已读取', readKey: '$TABLE:纪要表:1-2' })],
      maxTokens: 2000,
      countTokens: count,
      semanticAdapter: adapter,
    });

    expect(calls).toHaveLength(2);
    expect(calls[1][1].content).toContain('上一次输出不符合 JSON 契约');
    expect(result.degraded).toBe(false);
    expect(result.state.readKeys).toEqual(['$TABLE:纪要表:1-2']);
    expect(result.state.recentTurns).toEqual(['turn-real']);
  });

  it('falls back to a bounded deterministic report when semantic summarization fails', async () => {
    const result = await summarizeAgentHandoff_ACU({
      previous: null,
      messages: [message(1, 'user', '保留这个约束'), message(2, 'agent', '完成动作', { digest: '完成动作' })],
      maxTokens: 300,
      countTokens: count,
      semanticAdapter: { summarize: async () => { throw new Error('invalid JSON'); } },
    });

    expect(result.degraded).toBe(true);
    expect(result.degradationReason).toBe('semantic_summary_failed');
    expect(result.reportTokens).toBeLessThanOrEqual(300);
    expect(result.report).toContain('摘要降级');
    expect(result.report).toContain('完成动作');
  });
});
