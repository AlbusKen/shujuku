import { describe, expect, it, vi } from 'vitest';
import { executeWorldSimulationFinalRequest_ACU, measurePreparedReadRequestTokens_ACU, resolveDefaultReadFenceTokens_ACU } from '../../../../src/service/simulation/agent/final-request-token-gate';

describe('默认读取上围栏容量', () => {
  it('按本地输入限制减去完整已占用 TK 的 60% 向下取整', () => {
    expect(resolveDefaultReadFenceTokens_ACU(1000, 101)).toBe(539);
    expect(resolveDefaultReadFenceTokens_ACU(60000, 10000)).toBe(30000);
  });

  it('缺失、非法和耗尽容量时拒绝而非回退到阅读预算', () => {
    expect(() => resolveDefaultReadFenceTokens_ACU(Number.NaN, 0)).toThrow('READ_FENCE_CAPACITY_INVALID');
    expect(() => resolveDefaultReadFenceTokens_ACU(100, -1)).toThrow('READ_FENCE_CAPACITY_INVALID');
    expect(() => resolveDefaultReadFenceTokens_ACU(100, 100)).toThrow('READ_FENCE_CAPACITY_EXHAUSTED');
    expect(() => resolveDefaultReadFenceTokens_ACU(1, 0)).toThrow('READ_FENCE_CAPACITY_EXHAUSTED');
  });

  it('消息的原生工具调用字段及 tools 均参与占用计量', async () => {
    const count = async (text: string) => text.length;
    const messages = [{ role: 'assistant', content: '', tool_calls: [{ id: 'call-1', function: { name: 'read', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call-1', content: 'result' }];
    const plain = await measurePreparedReadRequestTokens_ACU(messages, [], count);
    const withTools = await measurePreparedReadRequestTokens_ACU(messages, [{ type: 'function', function: { name: 'read' } }], count);
    expect(withTools).toBeGreaterThan(plain);
    expect(plain).toBeGreaterThan(await measurePreparedReadRequestTokens_ACU([{ role: 'assistant', content: '' }], [], count));
    await expect(measurePreparedReadRequestTokens_ACU(messages, [], async () => Number.NaN)).rejects.toThrow('READ_FENCE_CAPACITY_INVALID');
    await expect(measurePreparedReadRequestTokens_ACU(messages, [], async () => 0)).rejects.toThrow('READ_FENCE_CAPACITY_INVALID');
  });

  it('最终请求连同工具定义超出本地输入限制时不调用 provider', async () => {
    const messages = [{ role: 'user', content: 'hello' }];
    const tools = [{ type: 'function', function: { name: 'read', description: 'long tool declaration' } }];
    const invoke = vi.fn(async () => 'sent');
    const count = async (text: string) => text.length;
    const occupied = await measurePreparedReadRequestTokens_ACU(messages, tools, count);
    const rejected = await executeWorldSimulationFinalRequest_ACU({ messages, tools, inputLimitTokens: occupied,
      historyBudgetTokens: 10000, count, invoke });
    expect(rejected).toMatchObject({ status: 'rejected', totalTokens: occupied, limitTokens: occupied });
    expect(invoke).not.toHaveBeenCalled();
    const exhausted = await executeWorldSimulationFinalRequest_ACU({ messages, tools, inputLimitTokens: occupied + 1,
      historyBudgetTokens: 10000, count, invoke });
    expect(exhausted).toMatchObject({ status: 'rejected', reason: 'final-request-token-overflow' });
    const accepted = await executeWorldSimulationFinalRequest_ACU({ messages, tools, inputLimitTokens: occupied + 100,
      historyBudgetTokens: 10000, count, invoke });
    expect(accepted.status).toBe('sent');
    expect(accepted).toMatchObject({ defaultReadFenceTokens: 60 });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('本地输入限制缺失或非法时拒绝调用 provider', async () => {
    const invoke = vi.fn(async () => 'sent');
    for (const inputLimitTokens of [undefined, 0, Number.NaN]) {
      await expect(executeWorldSimulationFinalRequest_ACU({ messages: [{ role: 'user', content: 'x' }],
        historyBudgetTokens: 10000, count: async () => 1, inputLimitTokens: inputLimitTokens as number, invoke }))
        .rejects.toThrow('READ_FENCE_CAPACITY_INVALID');
    }
    expect(invoke).not.toHaveBeenCalled();
  });

  it('有效本地输入限制下生成默认读取围栏', async () => {
    const sent = await executeWorldSimulationFinalRequest_ACU({ messages: [{ role: 'user', content: 'x' }],
      historyBudgetTokens: 10000, inputLimitTokens: 120000, count: async () => 1, invoke: async () => 'ok' });
    expect(sent.status).toBe('sent');
    expect(sent).toMatchObject({ defaultReadFenceTokens: Math.floor((120000 - 1) * 0.6) });
  });
});
