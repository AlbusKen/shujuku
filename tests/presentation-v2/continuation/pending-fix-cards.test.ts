import { describe, expect, it } from 'vitest';

import { buildContinuationPendingFixCards_ACU } from '../../../src/presentation-v2/continuation/pending-fix-cards';

describe('续写待修复卡片', () => {
  it('空队列不产生卡片', () => {
    expect(buildContinuationPendingFixCards_ACU([])).toEqual([]);
    expect(buildContinuationPendingFixCards_ACU(undefined)).toEqual([]);
  });

  it('展示模块名、违规摘要与失败次数', () => {
    const cards = buildContinuationPendingFixCards_ACU([{
      module: 'hooks',
      agentName: 'hook-cognition-maintainer',
      violations: [{ path: 'hooks', message: 'title 不能为空' }],
      attempts: 2,
      firstFailedAtIndex: 6,
      lastError: 'title 不能为空',
    }]);
    expect(cards).toEqual([{
      module: 'hooks',
      title: '伏笔账本',
      attempts: 2,
      detail: 'title 不能为空',
      meta: 'hook-cognition-maintainer · 第 2 次 · 自楼层 6 · title 不能为空',
    }]);
  });
});
