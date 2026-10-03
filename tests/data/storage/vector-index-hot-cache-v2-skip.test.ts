// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// 模拟 IndexedDB：记录 open 调用次数；open 抛错使 legacy 分支在 openDb_ACU 处失败，
// 从而可以断言「V2 判定早退时不触碰 IDB」与「legacy 分支仍会触碰 IDB」。
const openSpy = vi.fn(() => {
  throw new Error('indexedDB.open not available in test');
});
(globalThis as any).indexedDB = { open: openSpy };

import {
  isImmutableV2SnapshotManifest_ACU,
  putSummaryVectorHotCacheChunks_ACU,
  getSummaryVectorHotCacheChunks_ACU,
} from '../../../src/data/storage/vector-index-hot-cache';

function baseManifest(): any {
  return {
    version: 1, backend: 'st-files', status: 'ready', indexId: 'snap-a',
    chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary',
    snapshotMessageId: 'message-a', indexedAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
    rowCount: 1, chunkCount: 1, skippedRowCount: 0, embeddingModel: 'model-a', dimension: 2,
    rowsFile: 'r', tombstoneFile: 't', manifestFile: 'm', files: [],
    baseShardCount: 0, deltaShardCount: 0, tombstoneRowCount: 0, tombstoneChunkCount: 0, externalTotalBytes: 1,
    snapshot: { revision: 3, mode: 'single_file_snapshot', parentIndexIds: [], activeRowKeys: ['row-a'], activeChunkIds: ['chunk-a'], removedRowKeys: [], replacedRowKeys: [], batchIds: [] },
  };
}

function v2Manifest() {
  return {
    ...baseManifest(),
    storageIdentity: { layoutVersion: 2, scopeFingerprint: 'scope-a', writeGeneration: 'write-a', revision: 3 },
  };
}

function legacyManifest() {
  // single_file_snapshot 但缺 storageIdentity → legacy
  return baseManifest();
}

function chunk() {
  return { chunkId: 'chunk-a', rowKey: 'row-a', sequence: 0, text: 'summary', vector: [1, 2] };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isImmutableV2SnapshotManifest_ACU 判定', () => {
  it('完整 V2 identity 判定为 true', () => {
    expect(isImmutableV2SnapshotManifest_ACU(v2Manifest())).toBe(true);
  });

  it('null / undefined / 非 single_file_snapshot → false', () => {
    expect(isImmutableV2SnapshotManifest_ACU(null)).toBe(false);
    expect(isImmutableV2SnapshotManifest_ACU(undefined)).toBe(false);
    const otherMode = v2Manifest();
    otherMode.snapshot.mode = 'snapshot';
    expect(isImmutableV2SnapshotManifest_ACU(otherMode)).toBe(false);
  });

  it('single_file_snapshot 但缺 storageIdentity → false（legacy）', () => {
    expect(isImmutableV2SnapshotManifest_ACU(legacyManifest())).toBe(false);
  });

  it.each([
    ['revision 为 0', (m: any) => { m.storageIdentity.revision = 0; }],
    ['revision 非整数', (m: any) => { m.storageIdentity.revision = 1.5; }],
    ['writeGeneration 空白', (m: any) => { m.storageIdentity.writeGeneration = ' '; }],
    ['scopeFingerprint 空白', (m: any) => { m.storageIdentity.scopeFingerprint = ''; }],
    ['layoutVersion 非 2', (m: any) => { m.storageIdentity.layoutVersion = 1; }],
  ])('判定为 false：%s', (_caseName, mutate) => {
    const manifest = v2Manifest();
    mutate(manifest);
    expect(isImmutableV2SnapshotManifest_ACU(manifest)).toBe(false);
  });
});

describe('put 早退', () => {
  it('V2 manifest 不触碰 indexedDB', async () => {
    await putSummaryVectorHotCacheChunks_ACU({ manifest: v2Manifest(), chunks: [chunk()] });
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('legacy manifest 仍走 legacy 写入（触碰 IDB）', async () => {
    await putSummaryVectorHotCacheChunks_ACU({ manifest: legacyManifest(), chunks: [chunk()] });
    // 写入前先按 scope 清理旧缓存（一次 open），再写入新 chunks（一次 open）。
    expect(openSpy).toHaveBeenCalledTimes(2);
  });
});

describe('get 早退', () => {
  it('V2 manifest 返回 null 且不触碰 indexedDB', async () => {
    const result = await getSummaryVectorHotCacheChunks_ACU({ manifest: v2Manifest() });
    expect(result).toBeNull();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('legacy manifest 仍走 legacy 读取（触碰 IDB）', async () => {
    const result = await getSummaryVectorHotCacheChunks_ACU({ manifest: legacyManifest() });
    expect(result).toBeNull(); // open 抛错 → catch 返回 null
    expect(openSpy).toHaveBeenCalledTimes(1);
  });
});
