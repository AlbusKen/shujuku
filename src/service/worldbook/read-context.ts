/**
 * service/worldbook/read-context.ts
 * 请求级世界书读取上下文：catalog 懒解析、requested→host 双身份映射、
 * 物理书名级 Promise 去重、context 级固定并发调度与一次性统计。
 *
 * 生命周期：一个 context 绑定一个逻辑阶段（如一次填表 bucket attempt、一轮剧情 run）。
 * 同一 hostName 无论由哪个 requestedName 或哪条链路触发，只发起一次物理读取。
 * 失败 Promise 在本 context 内保持一致；下一 context 才允许重试。
 */
import { getLorebookEntries_ACU, listLorebooks_ACU, normalizeLorebookNameForMatch_ACU, resolveLorebookNameFromList_ACU } from '../../data/gateways/worldbook-gateway';

const LOREBOOK_READ_CONCURRENCY_LIMIT_ACU = 4;

/** 逻辑键 → 宿主真实名称。默认退化为自身。 */
export interface LorebookReadTarget_ACU {
  requestedName: string;
  hostName: string;
}

export interface LorebookReadContextStats_ACU {
  catalogCalls: number;
  logicalRequestCount: number;
  physicalReadCount: number;
  cacheHits: number;
  peakConcurrency: number;
  invalidatedCount: number;
  failedCount: number;
  durationMs: number;
}

export interface LorebookReadContext_ACU {
  readonly runId: string;
  readonly source: string;
  get availableBookNamesPromise(): Promise<string[]>;
  /** 按物理 hostName 读取条目；同 context 内同名只发起一次物理读取。 */
  readBookEntries(hostName: string): Promise<any[]>;
  /** 将逻辑名称解析为宿主真实名称（精确优先、归一化唯一、多解 null）。 */
  resolveBookName(requestedName: string): Promise<string | null>;
  invalidateBook(hostName: string): void;
  isActive(): boolean;
  isAborted(): boolean;
  getStats(): LorebookReadContextStats_ACU;
  dispose(): void;
}

function getLorebookListName_ACU(item: unknown): string {
  if (item && typeof item === 'object') return String((item as any).name ?? '').trim();
  return String(item ?? '').trim();
}

function cloneEntriesForRead_ACU(entries: any[], bookName: string): any[] {
  return (Array.isArray(entries) ? entries : []).map(entry => ({ ...entry, book: bookName }));
}

export interface CreateLorebookReadContextOptions_ACU {
  source: string;
  isActive?: () => boolean;
  isAborted?: () => boolean;
  /** context 结束时输出结构化观测摘要；不传则不输出（缺省行为完全不变）。 */
  onDisposeSummary?: (stats: LorebookReadContextStats_ACU, meta: { runId: string; source: string }) => void;
}

export function createLorebookReadContext_ACU(options: CreateLorebookReadContextOptions_ACU): LorebookReadContext_ACU {
  const runId = `wb-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const createdAt = Date.now();
  let disposed = false;
  let availableBookNamesPromise: Promise<string[]> | undefined;
  const bookEntriesPromises = new Map<string, Promise<any[]>>();
  const queue: Array<() => void> = [];
  let activeCount = 0;
  let peakConcurrency = 0;
  let logicalRequestCount = 0;
  let physicalReadCount = 0;
  let cacheHits = 0;
  let catalogCalls = 0;
  let invalidatedCount = 0;
  let failedCount = 0;

  const getIsActive = () => (options.isActive ? options.isActive() : !disposed);
  const getIsAborted = () => (options.isAborted ? options.isAborted() : disposed);

  function acquire(): Promise<void> {
    if (activeCount < LOREBOOK_READ_CONCURRENCY_LIMIT_ACU) {
      activeCount += 1;
      if (activeCount > peakConcurrency) peakConcurrency = activeCount;
      return Promise.resolve();
    }
    return new Promise(resolve => queue.push(resolve));
  }

  function release(): void {
    const next = queue.shift();
    if (next) {
      next();
      return;
    }
    activeCount -= 1;
  }

  async function runPhysicalRead(hostName: string): Promise<any[]> {
    if (disposed || getIsAborted() || !getIsActive()) throw new Error('TaskAbortedByUser');
    await acquire();
    try {
      if (disposed || getIsAborted() || !getIsActive()) throw new Error('TaskAbortedByUser');
      physicalReadCount += 1;
      try {
        return await getLorebookEntries_ACU(hostName);
      } catch (error) {
        failedCount += 1;
        throw error;
      }
    } finally {
      release();
    }
  }

  const context: LorebookReadContext_ACU = {
    runId,
    source: options.source,
    get availableBookNamesPromise() {
      if (!availableBookNamesPromise) {
        catalogCalls += 1;
        availableBookNamesPromise = Promise.resolve().then(() => listLorebooks_ACU());
      }
      return availableBookNamesPromise;
    },
    async readBookEntries(hostName: string) {
      logicalRequestCount += 1;
      const normalizedHost = String(hostName || '').trim();
      if (!normalizedHost) return [];
      const existing = bookEntriesPromises.get(normalizedHost);
      if (existing) {
        cacheHits += 1;
        return existing.then(entries => cloneEntriesForRead_ACU(entries, normalizedHost));
      }
      const promise = runPhysicalRead(normalizedHost);
      bookEntriesPromises.set(normalizedHost, promise);
      return promise.then(entries => cloneEntriesForRead_ACU(entries, normalizedHost));
    },
    async resolveBookName(requestedName: string) {
      const requested = String(requestedName ?? '').trim();
      if (!requested) return null;
      const availableNames = (await this.availableBookNamesPromise)
        .map(getLorebookListName_ACU)
        .filter(Boolean);
      return resolveLorebookNameFromList_ACU(requested, availableNames);
    },
    invalidateBook(hostName: string) {
      const normalizedHost = String(hostName || '').trim();
      if (normalizedHost && bookEntriesPromises.delete(normalizedHost)) {
        invalidatedCount += 1;
      }
    },
    isActive: () => getIsActive(),
    isAborted: () => getIsAborted(),
    getStats: () => ({
      catalogCalls,
      logicalRequestCount,
      physicalReadCount,
      cacheHits,
      peakConcurrency,
      invalidatedCount,
      failedCount,
      durationMs: Date.now() - createdAt,
    }),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      const stats = {
        catalogCalls,
        logicalRequestCount,
        physicalReadCount,
        cacheHits,
        peakConcurrency,
        invalidatedCount,
        failedCount,
        durationMs: Date.now() - createdAt,
      };
      if (typeof options.onDisposeSummary === 'function') {
        options.onDisposeSummary(stats, { runId, source: options.source });
      }
      bookEntriesPromises.clear();
      queue.length = 0;
      availableBookNamesPromise = undefined;
    },
  };

  return context;
}

/**
 * 表格候选作用域：请求级上下文内共享的 requested→host 目标解析缓存。
 * 候选集合只保留本次逻辑阶段的显式目标，禁止用于全库扫描。
 */
export function buildLorebookReadScope_ACU(requestedNames: Iterable<string>): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of requestedNames) {
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

/** 对宿主真实名称按物理身份去重（hostName 去重；归一化别名视为同一物理书）。 */
export function dedupeLorebookHostNames_ACU(hostNames: Iterable<string>): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of hostNames) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    const key = normalizeLorebookNameForMatch_ACU(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}
