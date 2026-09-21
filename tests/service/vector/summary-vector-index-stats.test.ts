/**
 * V2 镜像面板统计：externalTotalBytes 必须来自当前 scope 的 registry 累加。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  chat: [] as any[],
  isolationKey: 'iso-a',
  chatKey: 'chat-a',
  registry: vi.fn(),
  base: null as any,
  head: null as any,
  flush: vi.fn(),
  tempCache: vi.fn(),
  hotCache: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  currentChatFileIdentifier_ACU: 'chat-a',
  getCurrentIsolationKey_ACU: () => h.isolationKey,
}));
vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: () => h.chat,
}));
vi.mock('../../../src/shared/utils', () => ({
  hashUserInput_ACU: (value: string) => `hash-${value}`,
  logDebug_ACU: vi.fn(),
  logWarn_ACU: (...args: any[]) => h.logWarn(...args),
}));
vi.mock('../../../src/data/storage/vector-index-st-files-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/data/storage/vector-index-st-files-storage')>();
  return {
    ...actual,
    loadVectorIndexRegistry_ACU: (...args: any[]) => h.registry(...args),
  };
});
vi.mock('../../../src/data/storage/vector-index-temp-cache', () => ({
  deleteVectorIndexCacheByIndex_ACU: vi.fn(),
  estimateVectorIndexTempCache_ACU: (...args: any[]) => h.tempCache(...args),
  getVectorIndexCachedShard_ACU: vi.fn(),
  putVectorIndexCachedShard_ACU: vi.fn(),
}));
vi.mock('../../../src/data/storage/vector-index-hot-cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/data/storage/vector-index-hot-cache')>();
  return {
    ...actual,
    estimateSummaryVectorFlushTasks_ACU: (...args: any[]) => h.flush(...args),
    estimateSummaryVectorHotCache_ACU: (...args: any[]) => h.hotCache(...args),
  };
});
vi.mock('../../../src/service/vector/summary-vector-mirror-resolver', () => ({
  locateSummaryVectorMirrorBase_ACU: () => h.base,
  resolveSummaryVectorMirrorHead_ACU: async () => h.head,
}));
vi.mock('../../../src/service/vector/summary-vector-mirror-storage', () => ({
  loadSummaryVectorMirrorManifest_ACU: vi.fn(),
}));
vi.mock('../../../src/service/vector/summary-vector-index-state-service', () => ({
  getAllSummaryVectorIndexSnapshotLayers_ACU: () => [],
}));
vi.mock('../../../src/service/vector/vector-memory-config', () => ({
  getEffectiveSummaryVectorIndexConfig_ACU: () => ({}),
}));

import { getSummaryVectorIndexStats_ACU } from '../../../src/service/vector/summary-vector-index-storage-service';

describe('getSummaryVectorIndexStats_ACU V2 mirror bytes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.isolationKey = 'iso-a';
    h.chat = [{ is_user: false, TavernDB_ACU_IsolatedData: { 'iso-a': {} } }];
    h.base = {
      messageIndex: 0,
      frame: {
        summaryVectorIndexFrame: {
          sourceTableKey: 'summary',
          checkpoint: { sourceTableKey: 'summary', createdAt: Date.parse('2026-01-01T00:00:00.000Z') },
        },
      },
    };
    h.head = {
      status: 'ok',
      checkpoint: {
        manifestRef: { manifestHash: 'mh-1' },
        createdAt: Date.parse('2026-01-01T00:00:00.000Z'),
      },
      head: new Map([['r1', [{}]], ['r2', [{}, {}]]]),
      packRefs: [{ packHash: 'p1' }, { packHash: 'p2' }],
      appliedDeltaEntryIds: ['d1'],
      vectorRevision: 'rev-1',
    };
    h.tempCache.mockResolvedValue({ bytes: 0, count: 0 });
    h.hotCache.mockResolvedValue({ bytes: 0, count: 0 });
    h.flush.mockResolvedValue({
      total: 0, dirty: 0, queued: 0, flushing: 0, failedRetryable: 0, failedTerminal: 0, lastError: '',
    });
    h.registry.mockResolvedValue({ files: [] });
  });

  it('manifest 为空时累加当前 scope 的 registry byteSize', async () => {
    h.registry.mockResolvedValue({
      files: [
        { path: 'keep', byteSize: 100, scope: { chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary' } },
        { path: 'keep-2', byteSize: 40, scope: { chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary' } },
        { path: 'other-chat', byteSize: 999, scope: { chatKey: 'other', isolationKey: 'iso-a', sourceTableKey: 'summary' } },
        { path: 'no-scope', byteSize: 50 },
      ],
    });

    const stats = await getSummaryVectorIndexStats_ACU(null);
    expect(stats.status).toBe('ready');
    expect(stats.backend).toBe('st-files');
    expect(stats.rowCount).toBe(2);
    expect(stats.chunkCount).toBe(3);
    expect(stats.externalTotalBytes).toBe(140);
  });

  it('registry 读取失败时体积回退 0 且不抛给面板', async () => {
    h.registry.mockRejectedValue(new Error('registry unavailable'));

    const stats = await getSummaryVectorIndexStats_ACU(null);
    expect(stats.status).toBe('ready');
    expect(stats.externalTotalBytes).toBe(0);
    expect(h.logWarn).toHaveBeenCalledWith(
      expect.stringContaining('读取 V2 registry 体积失败'),
      'registry unavailable',
    );
  });
});
