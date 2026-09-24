import { describe, expect, it } from 'vitest';

import { planAgentHistoryCompaction_ACU } from '../../../../src/service/continuation/agent/agent-history-compactor';
import { appendAgentConversation_ACU, buildEmptyAgentConversation_ACU, renderAgentConversationMessages_ACU } from '../../../../src/service/continuation/agent/agent-conversation-store';

const counter = async (text: string): Promise<number> => text.length;
const weightedCounter = async (text: string): Promise<number> => (
  text.includes('A') ? text.length * 20 : text.includes('B') ? text.length * 10 : text.length
);
const oversizedRecentCounter = async (text: string): Promise<number> => (
  text.includes('A') || text.includes('B') ? text.length * 20 : text.length
);

function conversation(oldSize: number, recentSize: number) {
  return appendAgentConversation_ACU(buildEmptyAgentConversation_ACU(), [
    { kind: 'turn', text: '旧轮', digest: '旧轮', turnKey: 'turn-1' },
    { kind: 'agent', text: 'A'.repeat(oldSize), digest: '旧轮动作', turnKey: 'turn-1' },
    { kind: 'turn', text: '当前轮', digest: '当前轮', turnKey: 'turn-2' },
    { kind: 'agent', text: 'B'.repeat(recentSize), digest: '当前轮动作', turnKey: 'turn-2' },
  ]);
}

describe('planAgentHistoryCompaction_ACU', () => {
  it('uses the 120000 trigger low-water target, writes a V2 mark, and preserves the latest real turn', async () => {
    const snapshot = conversation(150000, 10000);
    const result = await planAgentHistoryCompaction_ACU({ snapshot, activeMark: null, triggerTokens: 120000, fixedPromptTokens: 0, countTokens: weightedCounter });

    expect(result.status).toBe('compacted_above_target');
    // B 的 10000 字现在原样保留而不是被旧 8000 字展示上限截断。
    expect(result.targetTokens).toBe(96000);
    expect(result.mark).toMatchObject({ schemaVersion: 2, compactedThroughId: 2, metrics: { triggerTokens: 120000, targetTokens: 96000, droppedTurns: 1 } });
    expect(result.snapshot.messages.slice(1).map(item => item.turnKey)).toEqual(['turn-2', 'turn-2']);
    expect(result.afterTokens).toBeLessThan(result.beforeTokens);
  });

  it('reports compacted_above_target when only the preserved latest turn exceeds the low-water target', async () => {
    const result = await planAgentHistoryCompaction_ACU({ snapshot: conversation(150000, 100000), activeMark: null, triggerTokens: 120000, fixedPromptTokens: 0, countTokens: oversizedRecentCounter });

    expect(result.status).toBe('compacted_above_target');
    expect(result.mark?.metrics.droppedTurns).toBe(1);
    expect(result.afterTokens).toBeGreaterThan(result.targetTokens);
    expect(result.afterTokens).toBeLessThan(result.beforeTokens);
  });

  it('does not create an equivalent mark when the candidate cutoff does not advance', async () => {
    const snapshot = conversation(150000, 10000);
    const result = await planAgentHistoryCompaction_ACU({ snapshot, activeMark: { compactedThroughId: 2, report: '旧标记', at: 1 }, triggerTokens: 120000, fixedPromptTokens: 0, countTokens: weightedCounter });

    expect(result.status).toBe('no_progress');
    expect(result.mark).toBeNull();
    expect(result.snapshot).toBe(snapshot);
  });
  it('measures the complete prepared request and preserves the current user instruction', async () => {
    const snapshot = appendAgentConversation_ACU(buildEmptyAgentConversation_ACU(), [
      { kind: 'turn', text: '旧轮', turnKey: 't1' },
      { kind: 'agent', text: 'A'.repeat(12000), turnKey: 't1' },
      { kind: 'tool', text: '已读正文', readKey: '$STORY_TAIL', turnKey: 't1' },
      { kind: 'user', text: '当前要求：别揭穿', turnKey: 't2' },
      { kind: 'turn', text: '当前轮', turnKey: 't2' },
      { kind: 'agent', text: 'B'.repeat(100), turnKey: 't2' },
    ]);
    const history = renderAgentConversationMessages_ACU(snapshot);
    const prepared = [{ role: 'system', content: '骨架'.repeat(400) }, ...history, { role: 'assistant', content: '<continue>' }];
    const result = await planAgentHistoryCompaction_ACU({ snapshot, activeMark: null, triggerTokens: 10000, fixedPromptTokens: 0, preparedMessages: prepared, countTokens: counter });
    expect(result.mark).toMatchObject({ compactedThroughId: 3 });
    expect(result.beforeTokens).toBe(prepared.reduce((sum, message) => sum + message.content.length, 0));
    expect(result.afterTokens).toBe(result.beforeTokens - history.slice(0, 3).reduce((sum, message) => sum + message.content.length, 0) + `【早期会话交接报告】
${result.mark!.report}`.length);
    expect(result.snapshot.messages.at(-3)?.text).toBe('当前要求：别揭穿');
    expect(result.mark!.summaryState.readKeys).toContain('$STORY_TAIL');
  });

  it('cannot summarize a receipt without its action or remove a recent instruction', async () => {
    const snapshot = appendAgentConversation_ACU(buildEmptyAgentConversation_ACU(), [
      { kind: 'tool', text: 'A'.repeat(12000), turnKey: 't1' },
      { kind: 'user', text: '当前要求', turnKey: 't2' },
      { kind: 'agent', text: 'B'.repeat(50), turnKey: 't2' },
    ]);
    const result = await planAgentHistoryCompaction_ACU({ snapshot, activeMark: null, triggerTokens: 10000, fixedPromptTokens: 0, countTokens: counter });
    expect(result).toMatchObject({ status: 'incompressible', mark: null });
    const firstUser = appendAgentConversation_ACU(buildEmptyAgentConversation_ACU(), [
      { kind: 'user', text: 'A'.repeat(12000), turnKey: 't1' },
      { kind: 'agent', text: 'B'.repeat(30), turnKey: 't2' },
    ]);
    const recent = await planAgentHistoryCompaction_ACU({ snapshot: firstUser, activeMark: null, triggerTokens: 10000, fixedPromptTokens: 0, countTokens: counter });
    expect(recent.mark).toBeNull();
  });

  it('cannot summarize an action still awaiting its tool receipt', async () => {
    const snapshot = appendAgentConversation_ACU(buildEmptyAgentConversation_ACU(), [
      { kind: 'turn', text: '旧轮', turnKey: 't1' },
      { kind: 'agent', text: '{"action":"read","reads":["$STORY_TAIL"]}' + 'A'.repeat(12000), turnKey: 't1' },
      { kind: 'turn', text: '当前轮', turnKey: 't2' },
      { kind: 'user', text: '当前要求', turnKey: 't2' },
    ]);
    const result = await planAgentHistoryCompaction_ACU({ snapshot, activeMark: null, triggerTokens: 10000, fixedPromptTokens: 0, countTokens: counter });
    expect(result).toMatchObject({ status: 'incompressible', mark: null });
  });

  it('cannot split an action from a late same-turn receipt across the kept boundary', async () => {
    // 中断恢复后回执可能晚到：t1 的动作、t2 的插入轮、然后才落 t1 的回执。
    // 切在中间会让模型看到一条没有动作的工具回执。
    const snapshot = appendAgentConversation_ACU(buildEmptyAgentConversation_ACU(), [
      { kind: 'agent', text: '{"action":"finalize","instruction":"' + 'A'.repeat(12000) + '"}', turnKey: 't1' },
      { kind: 'turn', text: '插入轮', turnKey: 't2' },
      { kind: 'tool', text: '工作流交付回执', turnKey: 't1' },
      { kind: 'user', text: '当前要求', turnKey: 't3' },
      { kind: 'agent', text: 'B'.repeat(30), turnKey: 't3' },
    ]);
    const result = await planAgentHistoryCompaction_ACU({ snapshot, activeMark: null, triggerTokens: 10000, fixedPromptTokens: 0, countTokens: counter });
    expect(result).toMatchObject({ status: 'incompressible', mark: null });
  });

  it('reports summary_failed and keeps the original history when protected fields alone exceed the handoff budget', async () => {
    const snapshot = appendAgentConversation_ACU(buildEmptyAgentConversation_ACU(), [
      { kind: 'user', text: '旧约束' + '约'.repeat(3000), turnKey: 't1' },
      { kind: 'turn', text: '上一轮', turnKey: 't2' },
      { kind: 'user', text: '当前要求', turnKey: 't3' },
      { kind: 'agent', text: 'B'.repeat(8000), turnKey: 't3' },
    ]);
    const result = await planAgentHistoryCompaction_ACU({ snapshot, activeMark: null, triggerTokens: 10000, fixedPromptTokens: 0, countTokens: counter });
    // 有效约束不可裁剪，交接报告装不进预算时宁可不压缩，也不 fallback 截掉内容。
    expect(result).toMatchObject({ status: 'summary_failed', mark: null });
    expect(result.snapshot).toBe(snapshot);
  });

});
