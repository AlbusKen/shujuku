import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeWorldSimulationFinalRequest_ACU } from '../../../../src/service/simulation/agent/final-request-token-gate';
import { createWorldSimulationReadGateState_ACU, gateWorldSimulationReadBatch_ACU, resolveWorldSimulationReadBudget_ACU } from '../../../../src/service/simulation/agent/agent-read-gate';
import { createWorldSimulationTokenCounter_ACU, resolveWorldSimulationCompactionTiming_ACU } from '../../../../src/service/simulation/agent/agent-token-budget';
import { readWorldSimulationRunState_ACU, resetWorldSimulationRunCacheForTests_ACU, saveWorldSimulationRunState_ACU } from '../../../../src/service/simulation/agent/agent-run-cache';
import { beginWorldSimulationSessionRun_ACU, isWorldSimulationSessionRunning_ACU, logWorldSimulationSession_ACU, readWorldSimulationSessionLog_ACU, resetWorldSimulationSessionLogForTests_ACU, subscribeWorldSimulationSessionLog_ACU } from '../../../../src/service/simulation/agent/agent-session-log';

const count = async (text: string) => text.length;
const view = { messages: [{ id: 1, kind: 'turn' as const, text: 'x'.repeat(80), digest: '', turnKey: 't1', at: 1 }] };

beforeEach(() => { resetWorldSimulationRunCacheForTests_ACU(); resetWorldSimulationSessionLogForTests_ACU(); });

describe('世界推演预算与运行辅助状态', () => {
  it('记忆化计数并在轮内普通越界时延迟、紧急越界时立即压缩', async () => {
    const raw = vi.fn(count); const cached = createWorldSimulationTokenCounter_ACU(raw);
    expect(await cached('abc')).toBe(3); expect(await cached('abc')).toBe(3); expect(raw).toHaveBeenCalledTimes(1);
    expect(await resolveWorldSimulationCompactionTiming_ACU(view as any, 100, true, count, 30)).toMatchObject({ action: 'defer', totalTokens: 110 });
    expect(await resolveWorldSimulationCompactionTiming_ACU(view as any, 80, true, count, 30)).toMatchObject({ action: 'compact', emergency: true });
  });

  it('按固定值或百分比解析读取预算，并原子拒绝超限批次', async () => {
    expect(resolveWorldSimulationReadBudget_ACU({ historyTokenBudget: 1000, readTokenBudget: '30%', fallbackTokens: 500 })).toEqual({ effectiveMaxReadTokens: 300, effectiveFallbackTokens: 300, basis: 'history-budget-percent' });
    const decision = await gateWorldSimulationReadBatch_ACU([{ label: '$BIG', text: 'x'.repeat(301) }], createWorldSimulationReadGateState_ACU(), { historyTokenBudget: 1000, readTokenBudget: 300, fallbackTokens: 50 }, 0, count);
    expect(decision).toMatchObject({ allowed: false, reason: 'read-batch-too-large', batchTokens: 301 });
    expect(decision.report).not.toContain('x'.repeat(20));
  });

  it('最终请求只压缩一次，复测仍超限时模型调用为零', async () => {
    const invoke = vi.fn().mockResolvedValue('sent');
    const compress = vi.fn(async () => [{ role: 'user', content: 'x'.repeat(126) }]);
    const rejected = await executeWorldSimulationFinalRequest_ACU({
      messages: [{ role: 'user', content: 'x'.repeat(200) }], historyBudgetTokens: 100,
      count, compress, invoke,
    });
    expect(rejected).toMatchObject({ status: 'rejected', totalTokens: 126, limitTokens: 125, compressed: true });
    expect(compress).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('run cache 深拷贝且 task/cursor 不匹配时作废', () => {
    const state = { taskId: 'T1', cursorKey: 'S1#1', nextIteration: 2, delegationsUsed: 1, perAgent: { macro: 1 }, outcomes: [{ agentName: 'macro', status: 'candidate' as const, summary: '完成', fingerprint: 'f1' }], candidateFingerprint: 'c1', candidateSummary: '候选', reviewerFeedback: '' };
    saveWorldSimulationRunState_ACU('chat', state); state.perAgent.macro = 9;
    expect(readWorldSimulationRunState_ACU('chat', 'T1', 'S1#1')?.perAgent.macro).toBe(1);
    expect(readWorldSimulationRunState_ACU('chat', 'T2', 'S1#1')).toBeNull();
    expect(readWorldSimulationRunState_ACU('chat', 'T1', 'S1#1')).toBeNull();
  });

  it('session log 有界、脱敏截断并隔离订阅者异常', () => {
    const listener = vi.fn(); subscribeWorldSimulationSessionLog_ACU('chat-a', listener); subscribeWorldSimulationSessionLog_ACU('chat-a', () => { throw new Error('坏订阅者'); });
    beginWorldSimulationSessionRun_ACU('chat-a', '运行');
    logWorldSimulationSession_ACU('chat-a', { kind: 'thought', title: '思考', detail: `敏感\n${'长'.repeat(2100)}` });
    expect(readWorldSimulationSessionLog_ACU('chat-a').at(-1)?.detail).not.toContain('\n');
    expect(readWorldSimulationSessionLog_ACU('chat-a').at(-1)?.detail.length).toBeLessThanOrEqual(2001);
    logWorldSimulationSession_ACU('chat-a', { kind: 'run_completed', title: '完成' });
    expect(isWorldSimulationSessionRunning_ACU('chat-a')).toBe(false); expect(listener).toHaveBeenCalled();
  });

  it('session log 与 running 状态按聊天身份完全隔离', () => {
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    subscribeWorldSimulationSessionLog_ACU('chat-a', listenerA);
    subscribeWorldSimulationSessionLog_ACU('chat-b', listenerB);
    beginWorldSimulationSessionRun_ACU('chat-a', 'A 运行');
    logWorldSimulationSession_ACU('chat-b', { kind: 'thought', title: 'B 思考' });
    expect(readWorldSimulationSessionLog_ACU('chat-a').map(item => item.title)).toEqual(['A 运行']);
    expect(readWorldSimulationSessionLog_ACU('chat-b').map(item => item.title)).toEqual(['B 思考']);
    expect(isWorldSimulationSessionRunning_ACU('chat-a')).toBe(true);
    expect(isWorldSimulationSessionRunning_ACU('chat-b')).toBe(false);
    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
  });
});
