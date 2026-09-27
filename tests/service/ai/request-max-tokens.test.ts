import { describe, expect, it } from 'vitest';
import { resolveRequestMaxTokens_ACU } from '../../../src/service/ai/request-max-tokens';

describe('请求 max_tokens 唯一解析点', () => {
  it('优先 max_tokens，兼容历史 maxTokens，缺省 4096', () => {
    expect(resolveRequestMaxTokens_ACU({ max_tokens: 60000, maxTokens: 8000 })).toBe(60000);
    expect(resolveRequestMaxTokens_ACU({ maxTokens: 8000 })).toBe(8000);
    expect(resolveRequestMaxTokens_ACU({})).toBe(4096);
  });

  it('调用方输出下限只抬高、不压低预设值', () => {
    expect(resolveRequestMaxTokens_ACU({ max_tokens: 2000 }, 6000)).toBe(6000);
    expect(resolveRequestMaxTokens_ACU({ max_tokens: 60000 }, 6000)).toBe(60000);
    expect(resolveRequestMaxTokens_ACU({}, 6000.9)).toBe(6000);
    expect(resolveRequestMaxTokens_ACU({ max_tokens: 2000 }, Number.NaN)).toBe(2000);
    expect(resolveRequestMaxTokens_ACU({ max_tokens: 2000 }, -50)).toBe(2000);
  });

  it('非法预设值原样透出，由容量门禁 fail-closed 而非静默回退', () => {
    expect(resolveRequestMaxTokens_ACU({ max_tokens: 0 })).toBe(0);
    expect(Number.isNaN(resolveRequestMaxTokens_ACU({ max_tokens: Number.NaN }))).toBe(true);
  });
});
