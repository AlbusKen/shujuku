import { describe, expect, it } from 'vitest';
import { measureContinuationFinalRequestCapacity_ACU } from '../../../../src/service/continuation/agent/agent-final-request-gate';

describe('续写最终请求容量门禁', () => {
  const count = async (text: string) => text.length;
  const messages = [{ role: 'user', content: 'hello' }];

  it('默认上围栏预算 =（本地输入限制 - 最终请求已占用）× 60% 向下取整', async () => {
    const capacity = await measureContinuationFinalRequestCapacity_ACU({ messages, inputLimitTokens: 120000, count });
    expect(capacity.occupiedTokens).toBeGreaterThan(0);
    expect(capacity.defaultReadFenceTokens).toBe(Math.floor((120000 - capacity.occupiedTokens) * 0.6));
  });

  it('原生工具定义计入已占用边界', async () => {
    const plain = await measureContinuationFinalRequestCapacity_ACU({ messages, inputLimitTokens: 120000, count });
    const withTools = await measureContinuationFinalRequestCapacity_ACU({
      messages, inputLimitTokens: 120000, count,
      tools: [{ type: 'function', function: { name: 'read', description: 'long tool declaration' } }],
    });
    expect(withTools.occupiedTokens).toBeGreaterThan(plain.occupiedTokens);
    expect(withTools.defaultReadFenceTokens).toBeLessThan(plain.defaultReadFenceTokens);
  });

  it('本地输入限制缺失、非法或非安全整数时在调用前拒绝', async () => {
    for (const inputLimitTokens of [undefined, 0, -1, Number.NaN, 1.5] as unknown as number[]) {
      await expect(measureContinuationFinalRequestCapacity_ACU({ messages, inputLimitTokens, count }))
        .rejects.toThrow('READ_FENCE_CAPACITY_INVALID');
    }
  });

  it('已占用达到本地输入限制时容量耗尽，拒绝发起调用', async () => {
    const occupied = (await measureContinuationFinalRequestCapacity_ACU({ messages, inputLimitTokens: 120000, count })).occupiedTokens;
    await expect(measureContinuationFinalRequestCapacity_ACU({ messages, inputLimitTokens: occupied, count }))
      .rejects.toThrow('READ_FENCE_CAPACITY_EXHAUSTED');
  });
});
