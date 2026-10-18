/**
 * tests/service/worldbook/read-context.test.ts
 * 请求级世界书读取上下文：物理去重、受限并发、abort/scope 失效、invalidate 与统计。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockGetLorebookEntries, mockListLorebooks, mockReadGuard } = vi.hoisted(() => ({
  mockReadGuard: vi.fn(async (_names?: string[]) => {}),
  mockGetLorebookEntries: vi.fn(),
  mockListLorebooks: vi.fn(),
}));

vi.mock('../../../src/data/gateways/worldbook-gateway', async () => {
  const actual = await vi.importActual('../../../src/data/gateways/worldbook-gateway');
  return {
    ...actual,
    createLorebookReadGuard_ACU: vi.fn(async () => mockReadGuard),
    getLorebookEntries_ACU: mockGetLorebookEntries,
    listLorebooks_ACU: mockListLorebooks,
  };
});

import {
  buildLorebookReadScope_ACU,
  createLorebookReadContext_ACU,
  dedupeLorebookHostNames_ACU,
} from '../../../src/service/worldbook/read-context';

beforeEach(() => {
  vi.clearAllMocks();
  mockReadGuard.mockReset().mockResolvedValue(undefined);
  mockListLorebooks.mockResolvedValue(['书A', '书B', '书C']);
});

function createContext(overrides: { isActive?: () => boolean; isAborted?: () => boolean } = {}) {
  return createLorebookReadContext_ACU({
    source: 'test',
    isActive: overrides.isActive,
    isAborted: overrides.isAborted,
  });
}

describe('物理书名级去重', () => {
  it('视觉等价 requestedName 解析到同一 hostName 时只发起一次物理读取，逻辑键仍兼容', async () => {
    mockGetLorebookEntries.mockImplementation(async (name: string) => [{ uid: 1, content: `${name}正文` }]);
    const context = createContext();

    const hostName = await context.resolveBookName('书A');
    expect(hostName).toBe('书A');
    const [first, second] = await Promise.all([
      context.readBookEntries(hostName!),
      context.readBookEntries(hostName!),
    ]);

    expect(mockGetLorebookEntries).toHaveBeenCalledTimes(1);
    expect(first).toEqual([{ uid: 1, content: '书A正文', book: '书A' }]);
    expect(second).toEqual([{ uid: 1, content: '书A正文', book: '书A' }]);
    first[0].content = '派生修改';
    expect(second[0].content).toBe('书A正文');
    expect(context.getStats()).toMatchObject({ logicalRequestCount: 2, physicalReadCount: 1, cacheHits: 1 });
  });

  it('resolveBookName 精确匹配优先，归一化多解返回 null', async () => {
    mockListLorebooks.mockResolvedValue(['书⚔', '书⚔\uFE0E', 'ＡＢ\u200BＣ']);
    const context = createContext();

    expect(await context.resolveBookName('书⚔')).toBe('书⚔'); // 列表存在精确项：精确匹配优先
    // 请求名带 FE0F，列表无严格相等项（只有 FE0E 变体），且归一化后与两项都同键 → 多解拒绝
    expect(await context.resolveBookName('书⚔\uFE0F')).toBeNull();
    expect(await context.resolveBookName('ABC')).toBe('ＡＢ\u200BＣ'); // 归一化唯一
    expect(await context.resolveBookName('')).toBeNull();
  });

  it('invalidateBook 后同 hostName 可重新读取，并计入失效统计', async () => {
    mockGetLorebookEntries.mockResolvedValue([{ uid: 1, content: 'v1' }]);
    const context = createContext();

    await context.readBookEntries('书A');
    context.invalidateBook('书A');
    await context.readBookEntries('书A');

    expect(mockGetLorebookEntries).toHaveBeenCalledTimes(2);
    expect(context.getStats()).toMatchObject({ physicalReadCount: 2, invalidatedCount: 1 });
  });
});

describe('context 级受限并发', () => {
  it('多个并发请求共享同一 limiter，总峰值不超过 4', async () => {
    const active: number[] = [];
    let maxActive = 0;
    mockGetLorebookEntries.mockImplementation(async () => {
      active.push(1);
      maxActive = Math.max(maxActive, active.length);
      await new Promise(resolve => setTimeout(resolve, 10));
      active.pop();
      return [{ uid: 1 }];
    });
    const context = createContext();

    await Promise.all(Array.from({ length: 10 }, (_, i) => context.readBookEntries(`书${i}`)));

    expect(maxActive).toBeLessThanOrEqual(4);
    expect(context.getStats().peakConcurrency).toBeLessThanOrEqual(4);
    expect(mockGetLorebookEntries).toHaveBeenCalledTimes(10);
  });
});

describe('abort / scope_changed / dispose', () => {
  it('abort 后排队任务不再启动，在途结果不交给已失效 context', async () => {
    let aborted = false;
    const releases: Array<() => void> = [];
    mockGetLorebookEntries.mockImplementation(() => new Promise(resolve => {
      releases.push(() => resolve([{ uid: 1 }]));
    }));
    const context = createContext({ isAborted: () => aborted });

    const firstFour = Array.from({ length: 4 }, (_, i) => context.readBookEntries(`书${i}`));
    const queued = context.readBookEntries('书X');
    await vi.waitFor(() => expect(mockGetLorebookEntries).toHaveBeenCalledTimes(4));

    aborted = true;
    const settled = Promise.allSettled([...firstFour, queued]);
    releases.forEach(release => release());
    const results = await settled;
    expect(results.every(result => result.status === 'rejected'
      && result.reason.message === 'TaskAbortedByUser')).toBe(true);
    expect(mockGetLorebookEntries).toHaveBeenCalledTimes(4);
  });

  it('scope_changed 后新读取与缓存命中均拒绝交付', async () => {
    let active = true;
    mockGetLorebookEntries.mockResolvedValue([{ uid: 1 }]);
    const context = createContext({ isActive: () => active });

    await context.readBookEntries('书A');
    active = false;
    await expect(context.readBookEntries('书B')).rejects.toMatchObject({ category: 'scope_changed' });
    await expect(context.readBookEntries('书A')).rejects.toMatchObject({ category: 'scope_changed' });
    expect(context.getStats().physicalReadCount).toBe(1);
  });

  it('dispose 后不允许新读取；下一 context 可重新读取', async () => {
    mockGetLorebookEntries.mockResolvedValue([{ uid: 1 }]);
    const first = createContext();
    await first.readBookEntries('书A');
    first.dispose();
    await expect(first.readBookEntries('书B')).rejects.toThrow();

    const second = createContext();
    await second.readBookEntries('书A');
    expect(mockGetLorebookEntries).toHaveBeenCalledTimes(2);
    expect(second.getStats().physicalReadCount).toBe(1);
  });
});

  it('T8-1 dispose 输出结构化摘要：包含 runId/source/各计数/durationMs，且幂等', async () => {
    mockGetLorebookEntries.mockResolvedValue([{ uid: 1 }]);
    const summaries: Array<{ stats: any; meta: any }> = [];
    const context = createLorebookReadContext_ACU({
      source: 'test_dispose_summary',
      onDisposeSummary: (stats, meta) => summaries.push({ stats, meta }),
    });

    await context.readBookEntries('书A');
    await context.resolveBookName('书B');
    context.dispose();
    context.dispose();

    expect(summaries).toHaveLength(1);
    expect(summaries[0].meta).toEqual({ runId: context.runId, source: 'test_dispose_summary' });
    expect(summaries[0].stats).toMatchObject({
      catalogCalls: 1,
      logicalRequestCount: 1,
      physicalReadCount: 1,
      cacheHits: 0,
      peakConcurrency: 1,
      invalidatedCount: 0,
      failedCount: 0,
    });
    expect(typeof summaries[0].stats.durationMs).toBe('number');
    expect(summaries[0].stats.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('未传 onDisposeSummary 时 dispose 正常清理且不抛错', () => {
    const context = createContext();
    expect(() => context.dispose()).not.toThrow();
    expect(context.getStats().durationMs).toBeGreaterThanOrEqual(0);
  });

describe('候选作用域工具', () => {
  it('buildLorebookReadScope_ACU 保序去重并跳过空值', () => {
    expect(buildLorebookReadScope_ACU([' 书A ', '书B', '书A', '', null as any, 1 as any])).toEqual([' 书A ', '书B', '书A']);
  });

  it('dedupeLorebookHostNames_ACU 保留视觉相似但身份不同的世界书', () => {
    expect(dedupeLorebookHostNames_ACU(['书⚔', '书⚔\uFE0F', '书⚔\uFE0E', '书B'])).toEqual(['书⚔', '书⚔\uFE0F', '书⚔\uFE0E', '书B']);
  });
});