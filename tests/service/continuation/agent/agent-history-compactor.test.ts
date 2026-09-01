import { describe, expect, it } from 'vitest';

import { planAgentHistoryCompaction_ACU } from '../../../../src/service/continuation/agent/agent-history-compactor';
import { appendAgentConversation_ACU, buildEmptyAgentConversation_ACU } from '../../../../src/service/continuation/agent/agent-conversation-store';

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

    expect(result.status).toBe('compacted');
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
});
