import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  read: vi.fn(),
  upload: vi.fn(),
  register: vi.fn(),
  remove: vi.fn(),
  unregister: vi.fn(),
  getHot: vi.fn(),
  putHot: vi.fn(),
  registry: vi.fn(),
  flush: vi.fn(),
  logDebug: vi.fn(),
  logWarn: vi.fn(),
  decodeScope: vi.fn(),
  config: { value: { summaryIndexRollingDeltaEnabled: false } as any },
  snapshot: { value: null as any },
  isolationKey: 'iso-a',
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  currentChatFileIdentifier_ACU: 'chat-a',
  getCurrentIsolationKey_ACU: () => h.isolationKey,
}));
vi.mock('../../../src/service/vector/summary-vector-index-state-service', () => ({
  getAllSummaryVectorIndexSnapshotLayers_ACU: () => h.snapshot.value?.layers || [],
}));
vi.mock('../../../src/shared/utils', () => ({
  hashUserInput_ACU: (value: string) => `hash-${value}`,
  logDebug_ACU: (...args: any[]) => h.logDebug(...args),
  logWarn_ACU: (...args: any[]) => h.logWarn(...args),
}));
vi.mock('../../../src/data/storage/vector-index-st-files-storage', () => ({
  readVectorIndexJsonFile_ACU: (...args: any[]) => h.read(...args),
  uploadVectorIndexJsonFile_ACU: (...args: any[]) => h.upload(...args),
  registerVectorIndexFiles_ACU: (...args: any[]) => h.register(...args),
  deleteVectorIndexFile_ACU: (...args: any[]) => h.remove(...args),
  unregisterVectorIndexFiles_ACU: (...args: any[]) => h.unregister(...args),
  buildVectorIndexSingleSnapshotV2ScopeToken_ACU: (parts: any) => `scope:${parts.chatKey}|${parts.isolationKey}|${parts.sourceTableKey}`,
  buildLegacyVectorIndexLosslessScopeTokenV2_ACU: (parts: any) => `legacy:${parts.chatKey}|${parts.isolationKey}|${parts.sourceTableKey}`,
  buildVectorIndexSingleSnapshotV2FilePath_ACU: (parts: any) => `TavernDB_ACU_vector_v2_scope:${parts.chatKey}|${parts.isolationKey}|${parts.sourceTableKey}_${parts.indexId}_${parts.writeGeneration}_snapshot`,
  decodeVectorIndexScopeFromPath_ACU: (...args: any[]) => h.decodeScope(...args),
  isVectorIndexContentPackPathV2_ACU: (path: any) => String(path || '').startsWith('TavernDB_ACU_vector_v2pack_'),
  VECTOR_INDEX_SNAPSHOT_PATH_V2_PREFIX_ACU: 'TavernDB_ACU_vector_v2_',
  buildVectorIndexFileName_ACU: vi.fn(), buildVectorIndexSnapshotFilePath_ACU: vi.fn(),
  buildVectorIndexStableDirectory_ACU: vi.fn(), buildVectorIndexStableFilePath_ACU: vi.fn(),
  deleteRegisteredVectorIndexFilesWhere_ACU: vi.fn(), loadVectorIndexRegistry_ACU: (...args: any[]) => h.registry(...args),
  sha256Text_ACU: vi.fn(async (value: string) => `sha:${value.length}`),
}));
vi.mock('../../../src/data/storage/vector-index-hot-cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/data/storage/vector-index-hot-cache')>();
  return {
    ...actual,
    getSummaryVectorHotCacheChunks_ACU: (...args: any[]) => h.getHot(...args),
    putSummaryVectorHotCacheChunks_ACU: (...args: any[]) => h.putHot(...args),
    estimateSummaryVectorFlushTasks_ACU: (...args: any[]) => h.flush(...args),
    estimateSummaryVectorHotCache_ACU: vi.fn(),
    deleteSummaryVectorHotCacheByIndex_ACU: vi.fn(),
  };
});

vi.mock('../../../src/data/storage/vector-index-temp-cache', () => ({
  deleteVectorIndexCacheByIndex_ACU: vi.fn(),
  estimateVectorIndexTempCache_ACU: vi.fn(),
  getVectorIndexCachedShard_ACU: vi.fn(),
  putVectorIndexCachedShard_ACU: vi.fn(),
}));
vi.mock('../../../src/service/vector/vector-memory-config', () => ({
  getEffectiveSummaryVectorIndexConfig_ACU: () => h.config.value,
}));

import {
  abortSummaryVectorIndexSnapshotPublication_ACU,
  collectSummaryVectorIndexReachability_ACU,
  cleanupUnreachableSummaryVectorIndexFiles_ACU,
  finalizeSummaryVectorIndexSnapshotPublication_ACU,
  inspectSummaryVectorIndexHealth_ACU,
  isLegacySummaryVectorIndexManifest_ACU,
  loadSummaryVectorIndexChunksFromManifest_ACU,
  persistSummaryVectorIndexSnapshot_ACU,
} from '../../../src/service/vector/summary-vector-index-storage-service';

function manifest_ACU(): any {
  const storageIdentity = { layoutVersion: 2, scopeFingerprint: 'scope-a', writeGeneration: 'write-a', revision: 3 };
  return {
    version: 1, backend: 'st-files', status: 'ready', indexId: 'snap-a',
    chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary', sourceTableName: '纪要表',
    snapshotMessageId: 'message-a', indexedAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
    rowCount: 1, chunkCount: 1, skippedRowCount: 0, embeddingModel: 'model-a', dimension: 2,
    rowsFile: 'TavernDB_ACU_vector_v2_scope:chat-a|iso-a|summary_snap-a_write-a_snapshot', tombstoneFile: 'TavernDB_ACU_vector_v2_scope:chat-a|iso-a|summary_snap-a_write-a_snapshot', manifestFile: 'TavernDB_ACU_vector_v2_scope:chat-a|iso-a|summary_snap-a_write-a_snapshot', files: [],
    baseShardCount: 0, deltaShardCount: 0, tombstoneRowCount: 0, tombstoneChunkCount: 0, externalTotalBytes: 1,
    snapshot: { revision: 3, mode: 'single_file_snapshot', parentIndexIds: [], activeRowKeys: ['row-a'], activeChunkIds: ['chunk-a'], removedRowKeys: [], replacedRowKeys: [], batchIds: [] },
    storageIdentity, batchRefs: [],
  };
}

function blob_ACU(manifest: any): any {
  return {
    version: 1, schema: 'single_file_snapshot', indexId: manifest.indexId, chatKey: manifest.chatKey,
    isolationKey: manifest.isolationKey, sourceTableKey: manifest.sourceTableKey, sourceTableName: manifest.sourceTableName,
    snapshotMessageId: manifest.snapshotMessageId, embeddingModel: manifest.embeddingModel, dimension: manifest.dimension,
    indexedAt: manifest.indexedAt, updatedAt: manifest.updatedAt, storageIdentity: { ...manifest.storageIdentity },
    manifest: { ...manifest, snapshot: manifest.snapshot ? { ...manifest.snapshot } : undefined, storageIdentity: manifest.storageIdentity ? { ...manifest.storageIdentity } : undefined },
    rows: [], chunks: [{ chunkId: 'chunk-a', rowKey: 'row-a', sequence: 0, text: 'summary', textHash: 'text-a', vector: [1, 2] }], tombstone: { indexId: manifest.indexId, removedRows: {} },
  };
}

// 与源码 encodeVectorToF32B64_ACU 语义一致：Float32LE -> base64（T15 测试用）
function encodeF32B64(values: number[]): string {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}


describe('summary-vector-index-storage-service V2 单文件读取', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.config.value = { summaryIndexRollingDeltaEnabled: false, summaryIndexV2WriteEnabled: true };
    h.getHot.mockResolvedValue(null);
    h.upload.mockImplementation(async (params: any) => ({ ok: true, ref: {
      role: params.role, path: params.path, byteSize: 1, checksum: 'checksum',
      createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z', status: 'ready',
    } }));
    h.register.mockResolvedValue(undefined);
    h.remove.mockResolvedValue({ ok: true });
    h.unregister.mockResolvedValue(undefined);
  });

  it('T4：完整 V2 identity 读取时跳过热缓存查询与回填，只回源一次', async () => {
    const manifest = manifest_ACU();
    h.read.mockResolvedValue({ ok: true, data: blob_ACU(manifest) });

    await expect(loadSummaryVectorIndexChunksFromManifest_ACU(manifest, { preferExternalFiles: true })).resolves.toMatchObject([{ chunkId: 'chunk-a', vector: new Float32Array([1, 2]) }]);
    expect(h.read).toHaveBeenCalledWith(manifest.manifestFile);
    // V2 不可变快照：不查缓存、不回填缓存
    expect(h.getHot).not.toHaveBeenCalled();
    expect(h.putHot).not.toHaveBeenCalled();
  });

  it('T4：V2 默认读取（不带 preferExternalFiles）同样跳过热缓存', async () => {
    const manifest = manifest_ACU();
    h.getHot.mockResolvedValue([{ chunkId: 'cached-chunk', vector: [3, 4] }]);
    h.read.mockResolvedValue({ ok: true, data: blob_ACU(manifest) });

    await expect(loadSummaryVectorIndexChunksFromManifest_ACU(manifest))
      .resolves.toMatchObject([{ chunkId: 'chunk-a', vector: new Float32Array([1, 2]) }]);
    // 即使缓存有数据，V2 不可变快照也直接回源，不查询缓存
    expect(h.getHot).not.toHaveBeenCalled();
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.putHot).not.toHaveBeenCalled();
  });

  it('T4：V2 默认读取回源后不回填热缓存', async () => {
    const manifest = manifest_ACU();
    h.getHot.mockResolvedValue(null);
    h.read.mockResolvedValue({ ok: true, data: blob_ACU(manifest) });

    await expect(loadSummaryVectorIndexChunksFromManifest_ACU(manifest))
      .resolves.toMatchObject([{ chunkId: 'chunk-a', vector: new Float32Array([1, 2]) }]);
    expect(h.getHot).not.toHaveBeenCalled();
    expect(h.read).toHaveBeenCalledWith(manifest.manifestFile);
    expect(h.putHot).not.toHaveBeenCalled();
  });


  it('T8：preferExternalFiles: true 始终跳过热缓存直接回源', async () => {
    const manifest = manifest_ACU();
    h.getHot.mockResolvedValue([{ chunkId: 'cached-chunk', vector: [3, 4] }]);
    h.read.mockResolvedValue({ ok: true, data: blob_ACU(manifest) });

    await expect(loadSummaryVectorIndexChunksFromManifest_ACU(manifest, { preferExternalFiles: true }))
      .resolves.toMatchObject([{ chunkId: 'chunk-a', vector: new Float32Array([1, 2]) }]);
    expect(h.getHot).not.toHaveBeenCalled();
    expect(h.read).toHaveBeenCalledWith(manifest.manifestFile);
  });

  it('V2 writer 紧急关闭时仍可读取已发布的 V2 snapshot', async () => {
    const manifest = manifest_ACU();
    h.config.value = { summaryIndexRollingDeltaEnabled: false, summaryIndexV2WriteEnabled: false };
    h.read.mockResolvedValue({ ok: true, data: blob_ACU(manifest) });

    await expect(loadSummaryVectorIndexChunksFromManifest_ACU(manifest, { preferExternalFiles: true }))
      .resolves.toMatchObject([{ chunkId: 'chunk-a', vector: new Float32Array([1, 2]) }]);

    expect(h.read).toHaveBeenCalledWith(manifest.manifestFile);
  });

  it.each([
    ['chatKey', 'chat-b'],
    ['isolationKey', 'iso-b'],
    ['sourceTableKey', 'other-table'],
    ['embeddingModel', 'model-b'],
    ['dimension', 3],
    ['storageIdentity.writeGeneration', 'write-b'],
    ['storageIdentity.revision', 4],
  ])('拒绝 V2 blob 的身份漂移：%s', async (field, value) => {
    const manifest = manifest_ACU();
    const blob = blob_ACU(manifest);
    const [parent, child] = field.split('.');
    if (child) (blob as any)[parent][child] = value;
    else (blob as any)[parent] = value;
    h.read.mockResolvedValue({ ok: true, data: blob });

    await expect(loadSummaryVectorIndexChunksFromManifest_ACU(manifest, { preferExternalFiles: true }))
      .rejects.toThrow('交火向量单文件快照身份不匹配');
    expect(h.putHot).not.toHaveBeenCalled();
  });

  it('拒绝 V2 manifest 与 blob 的 identity 元数据存在性不一致', async () => {
    const manifest = manifest_ACU();
    const blob = blob_ACU(manifest);
    delete blob.storageIdentity;
    h.read.mockResolvedValue({ ok: true, data: blob });

    await expect(loadSummaryVectorIndexChunksFromManifest_ACU(manifest, { preferExternalFiles: true }))
      .rejects.toThrow('V2 身份元数据不完整');
  });

  it('legacy 单文件快照缺少 storageIdentity 时仍按已有字段兼容读取', async () => {
    const manifest = manifest_ACU();
    delete manifest.storageIdentity;
    const blob = blob_ACU(manifest);
    delete blob.storageIdentity;
    h.read.mockResolvedValue({ ok: true, data: blob });

    await expect(loadSummaryVectorIndexChunksFromManifest_ACU(manifest, { preferExternalFiles: true }))
      .resolves.toMatchObject([{ chunkId: 'chunk-a', vector: new Float32Array([1, 2]) }]);
  });

  it('legacy 默认隔离域兼容 manifest=default 与 blob 空 isolationKey', async () => {
    const manifest = manifest_ACU();
    manifest.isolationKey = 'default';
    delete manifest.storageIdentity;
    const blob = blob_ACU(manifest);
    blob.isolationKey = '';
    delete blob.storageIdentity;
    delete blob.manifest.storageIdentity;
    h.read.mockResolvedValue({ ok: true, data: blob });

    await expect(loadSummaryVectorIndexChunksFromManifest_ACU(manifest, { preferExternalFiles: true }))
      .resolves.toMatchObject([{ chunkId: 'chunk-a', vector: new Float32Array([1, 2]) }]);
    expect(h.putHot).toHaveBeenCalled();
  });

  it('legacy 非默认 isolationKey 仍严格拒绝身份漂移', async () => {
    const manifest = manifest_ACU();
    delete manifest.storageIdentity;
    const blob = blob_ACU(manifest);
    blob.isolationKey = '';
    delete blob.storageIdentity;
    delete blob.manifest.storageIdentity;
    h.read.mockResolvedValue({ ok: true, data: blob });

    await expect(loadSummaryVectorIndexChunksFromManifest_ACU(manifest, { preferExternalFiles: true }))
      .rejects.toThrow(/field=isolationKey expected=iso-a actual=default/);
    expect(h.putHot).not.toHaveBeenCalled();
  });

  it.each([
    ['manifest 空白', ' ', ''],
    ['blob 空白', '', '\t'],
    ['default 前后空白', ' default ', 'default'],
    ['非默认 key 前后空白', ' iso-a ', 'iso-a'],
    ['default 大小写漂移', 'Default', 'default'],
  ])('legacy 不清洗 isolationKey：%s', async (_caseName, manifestIsolationKey, blobIsolationKey) => {
    const manifest = manifest_ACU();
    manifest.isolationKey = manifestIsolationKey;
    delete manifest.storageIdentity;
    const blob = blob_ACU(manifest);
    blob.isolationKey = blobIsolationKey;
    delete blob.storageIdentity;
    delete blob.manifest.storageIdentity;
    h.read.mockResolvedValue({ ok: true, data: blob });

    await expect(loadSummaryVectorIndexChunksFromManifest_ACU(manifest, { preferExternalFiles: true }))
      .rejects.toThrow('field=isolationKey');
    expect(h.putHot).not.toHaveBeenCalled();
  });

  it('V2 默认隔离域仍严格拒绝 default 与空 isolationKey 漂移', async () => {
    const manifest = manifest_ACU();
    manifest.isolationKey = 'default';
    const blob = blob_ACU(manifest);
    blob.isolationKey = '';
    h.read.mockResolvedValue({ ok: true, data: blob });

    await expect(loadSummaryVectorIndexChunksFromManifest_ACU(manifest, { preferExternalFiles: true }))
      .rejects.toThrow(/field=isolationKey expected=default actual=/);
    expect(h.putHot).not.toHaveBeenCalled();
  });

  it.each([
    ['blob 顶层前后空白', ' default ', 'default'],
    ['blob 内嵌 manifest 前后空白', 'default', ' default '],
  ])('V2 拒绝 canonical 等价但原始值非 canonical 的 isolationKey：%s', async (_caseName, blobIsolationKey, embeddedIsolationKey) => {
    const manifest = manifest_ACU();
    manifest.isolationKey = 'default';
    const blob = blob_ACU(manifest);
    blob.isolationKey = blobIsolationKey;
    blob.manifest.isolationKey = embeddedIsolationKey;
    h.read.mockResolvedValue({ ok: true, data: blob });

    await expect(loadSummaryVectorIndexChunksFromManifest_ACU(manifest, { preferExternalFiles: true }))
      .rejects.toThrow('交火向量单文件快照身份不匹配');
    expect(h.putHot).not.toHaveBeenCalled();
  });

  it('拒绝 blob 内嵌 manifest 与外层 V2 manifest 的身份漂移', async () => {
    const manifest = manifest_ACU();
    const blob = blob_ACU(manifest);
    blob.manifest.storageIdentity.writeGeneration = 'write-b';
    h.read.mockResolvedValue({ ok: true, data: blob });

    await expect(loadSummaryVectorIndexChunksFromManifest_ACU(manifest, { preferExternalFiles: true }))
      .rejects.toThrow('blob.manifest.storageIdentity.writeGeneration');
  });

  it('拒绝 blob 内嵌 manifest 的 snapshot revision 漂移', async () => {
    const manifest = manifest_ACU();
    const blob = blob_ACU(manifest);
    blob.manifest.snapshot.revision = 4;
    h.read.mockResolvedValue({ ok: true, data: blob });

    await expect(loadSummaryVectorIndexChunksFromManifest_ACU(manifest, { preferExternalFiles: true }))
      .rejects.toThrow('blob.manifest.snapshot.revision');
    expect(h.putHot).not.toHaveBeenCalled();
  });

  it('拒绝 V2 manifest 指向非 canonical path，即使 blob 内身份自洽', async () => {
    const manifest = manifest_ACU();
    manifest.manifestFile = 'TavernDB_ACU_vector_v2_scope:chat-a|iso-a|summary_snap-a_other-write_snapshot';
    manifest.rowsFile = manifest.manifestFile;
    manifest.tombstoneFile = manifest.manifestFile;
    h.read.mockResolvedValue({ ok: true, data: blob_ACU(manifest) });

    await expect(loadSummaryVectorIndexChunksFromManifest_ACU(manifest, { preferExternalFiles: true }))
      .rejects.toThrow('field=canonicalPath');
  });

});

describe('summary-vector-index-storage-service 安全 GC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.registry.mockResolvedValue({ files: [] });
    h.remove.mockResolvedValue({ ok: true });
    h.unregister.mockResolvedValue(undefined);
    h.snapshot.value = null;
    h.flush.mockResolvedValue({ total: 0, dirty: 0, queued: 0, flushing: 0, failedRetryable: 0, failedTerminal: 0, lastError: '' });
  });

  it('可达性覆盖全部隔离槽，并保留同一身份的多楼层引用证据', async () => {
    const first = manifest_ACU();
    const second = {
      ...manifest_ACU(),
      indexId: 'snap-b',
      isolationKey: 'iso-b',
      storageIdentity: { layoutVersion: 2, scopeFingerprint: 'scope:chat-a|iso-b|summary', writeGeneration: 'write-b', revision: 1 },
      snapshot: { ...manifest_ACU().snapshot, revision: 1 },
    };
    second.manifestFile = 'TavernDB_ACU_vector_v2_scope:chat-a|iso-b|summary_snap-b_write-b_snapshot';
    second.rowsFile = second.manifestFile;
    second.tombstoneFile = second.manifestFile;
    h.snapshot.value = {
      layers: [
        { messageIndex: 0, isolationKey: 'iso-a', summaryVectorIndexState: { manifest: first }, tagData: {} },
        { messageIndex: 1, isolationKey: 'iso-b', summaryVectorIndexState: { manifest: second }, tagData: {} },
        { messageIndex: 2, isolationKey: 'iso-a', summaryVectorIndexState: { manifest: first }, tagData: {} },
      ],
    };

    const report = await collectSummaryVectorIndexReachability_ACU();

    expect(report.manifestCount).toBe(3);
    expect(report.reachablePaths).toEqual(expect.arrayContaining([first.manifestFile, second.manifestFile]));
    const firstFile = report.reachableFiles.find(file => file.path === first.manifestFile);
    expect(firstFile?.references).toEqual(expect.arrayContaining([
      { messageIndex: 0, isolationKey: 'iso-a' },
      { messageIndex: 2, isolationKey: 'iso-a' },
    ]));
  });

  it('同一 tag slot 的 state 与 standalone manifest 不一致时，GC 必须保护两份持久化引用', async () => {
    const stateManifest = manifest_ACU();
    const standaloneManifest = {
      ...manifest_ACU(),
      indexId: 'standalone-index',
      storageIdentity: { layoutVersion: 2, scopeFingerprint: 'scope:chat-a|iso-a|summary', writeGeneration: 'write-standalone', revision: 4 },
      snapshot: { ...manifest_ACU().snapshot, revision: 4 },
    };
    standaloneManifest.manifestFile = 'TavernDB_ACU_vector_v2_scope:chat-a|iso-a|summary_standalone-index_write-standalone_snapshot';
    standaloneManifest.rowsFile = standaloneManifest.manifestFile;
    standaloneManifest.tombstoneFile = standaloneManifest.manifestFile;
    h.snapshot.value = {
      layers: [{
        messageIndex: 0,
        isolationKey: 'iso-a',
        summaryVectorIndexState: { manifest: stateManifest },
        tagData: { summaryVectorIndexManifest: standaloneManifest },
      }],
    };
    h.registry.mockResolvedValue({ files: [
      { path: stateManifest.manifestFile, createdAt: '2020-01-01T00:00:00.000Z' },
      { path: standaloneManifest.manifestFile, createdAt: '2020-01-01T00:00:00.000Z' },
    ] });

    const result = await cleanupUnreachableSummaryVectorIndexFiles_ACU({
      scopeHints: [{ chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary' }],
    });

    expect(result.deletedPaths).toEqual([]);
    expect(result.blockedByReachability).toEqual(expect.arrayContaining([
      stateManifest.manifestFile,
      standaloneManifest.manifestFile,
    ]));
    expect(h.remove).not.toHaveBeenCalled();
  });

  it('legacy 路径即使位于待清理 scope 也必须 quarantine，不能按前缀直接删除', async () => {
    const legacyPath = 'TavernDB_ACU_vector_chat-a_iso-a_summary_old_snapshot';
    h.registry.mockResolvedValue({ files: [{ path: legacyPath }] });

    const result = await cleanupUnreachableSummaryVectorIndexFiles_ACU({
      scopeHints: [{ chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary' }],
    });

    expect(result.deletedPaths).toEqual([]);
    expect(result.blockedByReachability).toContain(legacyPath);
    expect(h.remove).not.toHaveBeenCalled();
  });

  describe('升级前无损 token 路径（scope 指纹永远不匹配，需单独识别回收）', () => {
    const scope = { chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary' };
    const legacyToken = 'legacy:chat-a|iso-a|summary';
    const snapshotPath = `TavernDB_ACU_vector_v2_${legacyToken}_old-index_old-write_snapshot`;
    const packPath = `TavernDB_ACU_vector_v2pack_${legacyToken}_pack_old`;
    const old = '2020-01-01T00:00:00.000Z';

    beforeEach(() => {
      h.decodeScope.mockImplementation((path: string) => (String(path).includes(legacyToken) ? { ...scope } : null));
    });

    it('snapshot：scope 命中、超过 grace、blob 身份与路径一致 -> 删除', async () => {
      h.registry.mockResolvedValue({ files: [{ path: snapshotPath, createdAt: old, publicationState: 'published' }] });
      h.read.mockResolvedValue({ ok: true, data: {
        schema: 'single_file_snapshot', ...scope,
        storageIdentity: { layoutVersion: 2, scopeFingerprint: legacyToken, writeGeneration: 'old-write', revision: 1 },
      } });

      const result = await cleanupUnreachableSummaryVectorIndexFiles_ACU({ scopeHints: [scope] });

      expect(result.deletedPaths).toEqual([snapshotPath]);
      expect(h.remove).toHaveBeenCalledWith(snapshotPath);
      expect(h.unregister).toHaveBeenCalledWith([snapshotPath]);
    });

    it('pack：packScope 等于旧 token -> 删除；不等 -> quarantine', async () => {
      h.registry.mockResolvedValue({ files: [{ path: packPath, createdAt: old, publicationState: 'published' }] });
      h.read.mockResolvedValue({ ok: true, data: { schema: 'content_addressed_vector_pack', version: 1, packScope: legacyToken, packKey: 'pack_old' } });
      const deleted = await cleanupUnreachableSummaryVectorIndexFiles_ACU({ scopeHints: [scope] });
      expect(deleted.deletedPaths).toEqual([packPath]);

      h.remove.mockClear();
      h.read.mockResolvedValue({ ok: true, data: { schema: 'content_addressed_vector_pack', version: 1, packScope: 'legacy:someone-else', packKey: 'pack_old' } });
      const retained = await cleanupUnreachableSummaryVectorIndexFiles_ACU({ scopeHints: [scope] });
      expect(retained.deletedPaths).toEqual([]);
      expect(retained.blockedByReachability).toContain(packPath);
      expect(h.remove).not.toHaveBeenCalled();
    });

    it('路径反解出的 scope 不在 scopeHints 内 -> quarantine，不读 blob', async () => {
      h.registry.mockResolvedValue({ files: [{ path: snapshotPath, createdAt: old }] });
      const result = await cleanupUnreachableSummaryVectorIndexFiles_ACU({
        scopeHints: [{ chatKey: 'chat-b', isolationKey: 'iso-a', sourceTableKey: 'summary' }],
      });
      expect(result.deletedPaths).toEqual([]);
      expect(result.blockedByReachability).toContain(snapshotPath);
      expect(h.read).not.toHaveBeenCalled();
    });

    it('grace 未到 / prepared / blob 身份不符 -> quarantine', async () => {
      h.registry.mockResolvedValue({ files: [{ path: snapshotPath, createdAt: new Date().toISOString() }] });
      expect((await cleanupUnreachableSummaryVectorIndexFiles_ACU({ scopeHints: [scope] })).deletedPaths).toEqual([]);

      h.registry.mockResolvedValue({ files: [{ path: snapshotPath, createdAt: old, publicationState: 'prepared' }] });
      expect((await cleanupUnreachableSummaryVectorIndexFiles_ACU({ scopeHints: [scope] })).deletedPaths).toEqual([]);

      h.registry.mockResolvedValue({ files: [{ path: snapshotPath, createdAt: old }] });
      h.read.mockResolvedValue({ ok: true, data: {
        schema: 'single_file_snapshot', ...scope, sourceTableKey: 'other',
        storageIdentity: { layoutVersion: 2, scopeFingerprint: legacyToken, writeGeneration: 'old-write', revision: 1 },
      } });
      expect((await cleanupUnreachableSummaryVectorIndexFiles_ACU({ scopeHints: [scope] })).deletedPaths).toEqual([]);
      expect(h.remove).not.toHaveBeenCalled();
    });

    it('可达的旧路径仍受 pointer 保护，不进入回收', async () => {
      const manifest = { ...manifest_ACU(), manifestFile: snapshotPath, rowsFile: snapshotPath, tombstoneFile: snapshotPath };
      h.snapshot.value = { layers: [{ messageIndex: 0, isolationKey: 'iso-a', summaryVectorIndexState: { manifest }, tagData: {} }] };
      h.registry.mockResolvedValue({ files: [{ path: snapshotPath, createdAt: old }] });
      const result = await cleanupUnreachableSummaryVectorIndexFiles_ACU({ scopeHints: [scope] });
      expect(result.deletedPaths).toEqual([]);
      expect(result.blockedByReachability).toContain(snapshotPath);
      expect(h.read).not.toHaveBeenCalled();
    });
  });

  it('persist 写出的 registry 条目携带 canonical scope（路径指纹不可逆，GC 需据此归属）', async () => {
    const blobs = new Map<string, any>();
    h.upload.mockImplementation(async (params: any) => {
      blobs.set(params.path, params.data);
      return {
        ok: true,
        ref: {
          role: params.role, path: params.path, byteSize: 1, checksum: `sha:${JSON.stringify(params.data).length}`,
          createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z', status: 'ready',
        },
      };
    });
    h.read.mockImplementation(async (path: string) => ({ ok: true, data: blobs.get(path) }));
    const persisted = await persistSummaryVectorIndexSnapshot_ACU({
      chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary', sourceTableName: '纪要表',
      snapshotMessageId: 'message-a', indexedAt: '2025-01-01T00:00:00.000Z', embeddingModel: 'model-a',
      rows: [{ rowKey: 'row-a', rowId: '1', rowOrder: 0, timeSpan: '', location: '', summary: 'summary', indexCode: 'A', vectorSourceText: 'summary', chunkIds: ['chunk-a'] }],
      chunks: [{ chunkId: 'chunk-a', rowKey: 'row-a', rowOrder: 0, sequence: 0, text: 'summary', vector: [1, 2] }],
      snapshotRevision: 0,
    } as any);
    const expectedScope = { chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary' };
    expect(persisted.uploadedFiles).toHaveLength(1);
    expect(persisted.uploadedFiles[0].scope).toEqual(expectedScope);
    expect(h.register).toHaveBeenCalledWith([expect.objectContaining({ publicationState: 'prepared', scope: expectedScope })]);
  });

  it('durable pointer 可达时幂等修复 registry 中的 prepared 快照为 published', async () => {
    const manifest = manifest_ACU();
    const path = manifest.manifestFile;
    h.snapshot.value = {
      layers: [{ messageIndex: 0, isolationKey: 'iso-a', summaryVectorIndexState: { manifest }, tagData: {} }],
    };
    h.registry.mockResolvedValue({ files: [{
      role: 'manifest', path, byteSize: 1, checksum: 'checksum',
      createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z', status: 'ready', publicationState: 'prepared',
    }] });

    const result = await cleanupUnreachableSummaryVectorIndexFiles_ACU({
      scopeHints: [{ chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary' }],
    });

    expect(h.register).toHaveBeenCalledWith([expect.objectContaining({ path, publicationState: 'published' })]);
    expect(result.deletedPaths).toEqual([]);
    expect(result.blockedByReachability).toContain(path);
    expect(h.remove).not.toHaveBeenCalled();
  });

  it('pending prepared 快照即使运行时 pointer 可达也不能被 GC 升格；保存失败 abort 后仍不是 published', async () => {
    const blobs = new Map<string, any>();
    h.upload.mockImplementation(async (params: any) => {
      blobs.set(params.path, params.data);
      return {
        ok: true,
        ref: {
          role: params.role, path: params.path, byteSize: 1, checksum: `sha:${JSON.stringify(params.data).length}`,
          createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z', status: 'ready',
        },
      };
    });
    h.read.mockImplementation(async (path: string) => ({ ok: true, data: blobs.get(path) }));
    const persisted = await persistSummaryVectorIndexSnapshot_ACU({
      chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary', sourceTableName: '纪要表',
      snapshotMessageId: 'message-a', indexedAt: '2025-01-01T00:00:00.000Z', embeddingModel: 'model-a',
      rows: [{ rowKey: 'row-a', rowId: '1', rowOrder: 0, timeSpan: '', location: '', summary: 'summary', indexCode: 'A', vectorSourceText: 'summary', chunkIds: ['chunk-a'] }],
      chunks: [{ chunkId: 'chunk-a', rowKey: 'row-a', rowOrder: 0, sequence: 0, text: 'summary', vector: [1, 2] }],
      snapshotRevision: 0,
    } as any);
    const [file] = persisted.uploadedFiles;
    h.snapshot.value = {
      layers: [{ messageIndex: 0, isolationKey: 'iso-a', summaryVectorIndexState: { manifest: persisted.manifest }, tagData: {} }],
    };
    h.registry.mockResolvedValue({ files: [{ ...file, publicationState: 'prepared' }] });
    h.register.mockClear();

    const whileStrictSavePending = await cleanupUnreachableSummaryVectorIndexFiles_ACU({
      scopeHints: [{ chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary' }],
    });

    expect(h.register).not.toHaveBeenCalled();
    expect(whileStrictSavePending.deletedPaths).toEqual([]);
    expect(whileStrictSavePending.blockedByReachability).toContain(file.path);
    expect(h.remove).not.toHaveBeenCalled();

    // 模拟 strict save 失败：archive 已恢复内存 pointer，并调用 abort 清除 pending 标记。
    h.snapshot.value = null;
    abortSummaryVectorIndexSnapshotPublication_ACU(persisted.uploadedFiles);
    const afterStrictSaveFailure = await cleanupUnreachableSummaryVectorIndexFiles_ACU({
      scopeHints: [{ chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary' }],
    });

    expect(h.register).not.toHaveBeenCalled();
    expect(afterStrictSaveFailure.deletedPaths).toEqual([file.path]);
    expect(h.remove).toHaveBeenCalledWith(file.path);
  });

  it('仅在 V2 blob 的 canonical scope 与显式 scope hint 一致时删除不可达对象', async () => {
    const manifest = {
      ...manifest_ACU(),
      indexId: 'orphan-index',
      storageIdentity: { layoutVersion: 2, scopeFingerprint: 'scope:chat-a|iso-a|summary', writeGeneration: 'write-orphan', revision: 3 },
    };
    manifest.manifestFile = `TavernDB_ACU_vector_v2_scope:chat-a|iso-a|summary_${manifest.indexId}_${manifest.storageIdentity.writeGeneration}_snapshot`;
    manifest.rowsFile = manifest.manifestFile;
    manifest.tombstoneFile = manifest.manifestFile;
    const path = manifest.manifestFile;
    h.registry.mockResolvedValue({ files: [{ path, createdAt: '2020-01-01T00:00:00.000Z' }] });
    h.read.mockResolvedValue({ ok: true, data: blob_ACU(manifest) });

    const result = await cleanupUnreachableSummaryVectorIndexFiles_ACU({
      scopeHints: [{ chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary' }],
    });

    expect(result.deletedPaths).toEqual([path]);
    expect(h.remove).toHaveBeenCalledWith(path);
    expect(h.unregister).toHaveBeenCalledWith([path]);
  });

  it.each([
    ['scope fingerprint', (blob: any) => { blob.storageIdentity.scopeFingerprint = 'scope:wrong'; }],
    ['canonical path generation', (blob: any) => { blob.storageIdentity.writeGeneration = 'other-write'; }],
    ['embedded manifest scope', (blob: any) => { blob.manifest.sourceTableKey = 'other-summary'; }],
    ['embedded manifest revision', (blob: any) => { blob.manifest.snapshot.revision = 4; }],
  ])('V2 canonical identity 的 %s 不匹配时 quarantine', async (_label, mutate) => {
    const manifest = {
      ...manifest_ACU(),
      storageIdentity: { layoutVersion: 2, scopeFingerprint: 'scope:chat-a|iso-a|summary', writeGeneration: 'write-a', revision: 3 },
    };
    const path = `TavernDB_ACU_vector_v2_scope:chat-a|iso-a|summary_${manifest.indexId}_${manifest.storageIdentity.writeGeneration}_snapshot`;
    h.registry.mockResolvedValue({ files: [{ path, createdAt: '2020-01-01T00:00:00.000Z' }] });
    const blob = blob_ACU(manifest);
    mutate(blob);
    h.read.mockResolvedValue({ ok: true, data: blob });

    const result = await cleanupUnreachableSummaryVectorIndexFiles_ACU({ scopeHints: [{ chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary' }] });
    expect(result.deletedPaths).toEqual([]);
    expect(result.blockedByReachability).toContain(path);
    expect(h.remove).not.toHaveBeenCalled();
  });

  it('V2 不可达对象未超过 grace window 时必须 quarantine', async () => {
    const manifest = {
      ...manifest_ACU(),
      indexId: 'fresh-orphan',
      storageIdentity: { layoutVersion: 2, scopeFingerprint: 'scope:chat-a|iso-a|summary', writeGeneration: 'write-fresh', revision: 3 },
    };
    const path = `TavernDB_ACU_vector_v2_scope:chat-a|iso-a|summary_${manifest.indexId}_${manifest.storageIdentity.writeGeneration}_snapshot`;
    h.registry.mockResolvedValue({ files: [{ path, createdAt: new Date().toISOString() }] });
    h.read.mockResolvedValue({ ok: true, data: blob_ACU(manifest) });

    const result = await cleanupUnreachableSummaryVectorIndexFiles_ACU({
      scopeHints: [{ chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary' }],
    });

    expect(result.deletedPaths).toEqual([]);
    expect(result.blockedByReachability).toContain(path);
    expect(h.remove).not.toHaveBeenCalled();
  });

  it('V2 不可达对象缺少可信 registry 上传时间时必须 quarantine', async () => {
    const manifest = manifest_ACU();
    const path = manifest.manifestFile;
    h.registry.mockResolvedValue({ files: [{ path }] });
    h.read.mockResolvedValue({ ok: true, data: blob_ACU(manifest) });

    const result = await cleanupUnreachableSummaryVectorIndexFiles_ACU({
      scopeHints: [{ chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary' }],
    });
    expect(result.deletedPaths).toEqual([]);
    expect(result.blockedByReachability).toContain(path);
  });

  it('V2 路径前缀命中但 blob canonical scope 不一致时 quarantine', async () => {
    const path = 'TavernDB_ACU_vector_v2_scope:chat-a|iso-a|summary_suspicious';
    h.registry.mockResolvedValue({ files: [{ path }] });
    h.read.mockResolvedValue({ ok: true, data: {
      schema: 'single_file_snapshot', chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'other-summary',
    } });

    const result = await cleanupUnreachableSummaryVectorIndexFiles_ACU({
      scopeHints: [{ chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary' }],
    });

    expect(result.deletedPaths).toEqual([]);
    expect(result.blockedByReachability).toContain(path);
    expect(h.remove).not.toHaveBeenCalled();
  });

  it('legacy single-file snapshot 在 health 中标记为待迁移，但保持兼容可读', async () => {
    const manifest = manifest_ACU();
    delete manifest.storageIdentity;
    const blob = blob_ACU(manifest);
    delete blob.storageIdentity;
    delete blob.manifest.storageIdentity;
    h.snapshot.value = {
      layers: [{ messageIndex: 0, isolationKey: 'iso-a', summaryVectorIndexState: { manifest }, tagData: {} }],
    };
    h.registry.mockResolvedValue({ files: [] });
    h.read.mockResolvedValue({ ok: true, data: blob });

    const report = await inspectSummaryVectorIndexHealth_ACU();

    expect(report.status).toBe('degraded');
    expect(report.legacyManifestCount).toBe(1);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'legacy_manifest', path: manifest.manifestFile }),
    ]));
  });

  it('同一路径即使仅 writeGeneration 不同也必须报告完整 V2 identity collision', async () => {
    const first = manifest_ACU();
    const second = {
      ...manifest_ACU(),
      storageIdentity: { layoutVersion: 2, scopeFingerprint: 'scope-a', writeGeneration: 'write-b', revision: 3 },
    };
    second.manifestFile = first.manifestFile;
    second.rowsFile = first.rowsFile;
    second.tombstoneFile = first.tombstoneFile;
    h.snapshot.value = {
      layers: [
        { messageIndex: 0, isolationKey: 'iso-a', summaryVectorIndexState: { manifest: first }, tagData: {} },
        { messageIndex: 1, isolationKey: 'iso-a', summaryVectorIndexState: { manifest: second }, tagData: {} },
      ],
    };
    h.registry.mockResolvedValue({ files: [] });
    h.read.mockResolvedValue({ ok: true, data: blob_ACU(first) });

    const report = await inspectSummaryVectorIndexHealth_ACU();

    expect(report.status).toBe('degraded');
    expect(report.missingFileCount).toBe(0);
    expect(report.pathIdentityCollisionCount).toBe(1);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'path_identity_collision', path: first.manifestFile }),
    ]));
  });

  it('同一路径即使仅 snapshot revision 不同也必须报告完整 V2 identity collision', async () => {
    const first = manifest_ACU();
    const second = {
      ...manifest_ACU(),
      snapshot: { ...first.snapshot, revision: 4 },
      storageIdentity: { layoutVersion: 2, scopeFingerprint: 'scope-a', writeGeneration: 'write-a', revision: 4 },
    };
    second.manifestFile = first.manifestFile;
    second.rowsFile = first.rowsFile;
    second.tombstoneFile = first.tombstoneFile;
    h.snapshot.value = {
      layers: [
        { messageIndex: 0, isolationKey: 'iso-a', summaryVectorIndexState: { manifest: first }, tagData: {} },
        { messageIndex: 1, isolationKey: 'iso-a', summaryVectorIndexState: { manifest: second }, tagData: {} },
      ],
    };
    h.registry.mockResolvedValue({ files: [] });
    h.read.mockResolvedValue({ ok: true, data: blob_ACU(first) });

    const report = await inspectSummaryVectorIndexHealth_ACU();

    expect(report.pathIdentityCollisionCount).toBe(1);
    expect(report.status).toBe('degraded');
  });

  it('health 对 V2 单文件 manifest 使用正式 identity validator', async () => {
    const manifest = manifest_ACU();
    const blob = blob_ACU(manifest);
    blob.manifest.storageIdentity.writeGeneration = 'write-drifted';
    h.snapshot.value = {
      layers: [{ messageIndex: 0, isolationKey: 'iso-a', summaryVectorIndexState: { manifest }, tagData: {} }],
    };
    h.registry.mockResolvedValue({ files: [] });
    h.read.mockResolvedValue({ ok: true, data: blob });

    const report = await inspectSummaryVectorIndexHealth_ACU();

    expect(report.status).toBe('degraded');
    expect(report.missingFileCount).toBe(0);
    expect(report.identityMismatchCount).toBe(1);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'identity_mismatch',
        path: manifest.manifestFile,
        actual: expect.stringContaining('blob.manifest.storageIdentity.writeGeneration'),
      }),
    ]));
  });

  it('T14：pack 被任一楼层 manifest 引用 -> 保留，不删除', async () => {
    const manifest = manifest_ACU();
    const packPath = 'TavernDB_ACU_vector_v2pack_scope:chat-a|iso-a|summary_pack_abc';
    manifest.contentAddressed = {
      version: 1, mode: 'content_addressed_packs', chunkRefs: [],
      activeChunkKeys: ['key-c1'], packRefs: [{ packKey: 'pack_abc', packScope: 'scope:chat-a|iso-a|summary', schemaVersion: 1, path: packPath, checksum: 'sha:1', byteSize: 1, chunkKeys: ['key-c1'], chunkCount: 1, rowCount: 1, embeddingModel: 'model-a', dimension: 2, createdAt: '', updatedAt: '', status: 'ready' }],
    };
    h.snapshot.value = {
      layers: [{ messageIndex: 0, isolationKey: 'iso-a', summaryVectorIndexState: { manifest }, tagData: {} }],
    };
    h.registry.mockResolvedValue({ files: [{ path: packPath, createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z', checksum: '' }] });

    const result = await cleanupUnreachableSummaryVectorIndexFiles_ACU({
      scopeHints: [{ chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary' }],
    });

    expect(result.deletedPaths).toEqual([]);
    expect(result.blockedByReachability).toContain(packPath);
    expect(h.remove).not.toHaveBeenCalled();
  });

  it('T14：pack 不可达但 grace 未到 -> 保留且不下载 blob（h.read 未被调用）', async () => {
    const packPath = 'TavernDB_ACU_vector_v2pack_scope:chat-a|iso-a|summary_pack_abc';
    h.registry.mockResolvedValue({ files: [{ path: packPath, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), checksum: '' }] });
    h.read.mockClear();

    const result = await cleanupUnreachableSummaryVectorIndexFiles_ACU({
      scopeHints: [{ chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary' }],
    });

    expect(result.deletedPaths).toEqual([]);
    expect(result.blockedByReachability).toContain(packPath);
    expect(h.read).not.toHaveBeenCalled();
  });

  it('T14：pack 不可达、grace 已过且校验通过 -> 删除', async () => {
    const packPath = 'TavernDB_ACU_vector_v2pack_scope:chat-a|iso-a|summary_pack_abc';
    const packBlob = {
      version: 1, schema: 'content_addressed_vector_pack', packKey: 'pack_abc', packScope: 'scope:chat-a|iso-a|summary',
      embeddingModel: 'model-a', dimension: 2, chunks: [],
    };
    h.registry.mockResolvedValue({ files: [{ path: packPath, createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z', checksum: '' }] });
    h.read.mockResolvedValue({ ok: true, data: packBlob });

    const result = await cleanupUnreachableSummaryVectorIndexFiles_ACU({
      scopeHints: [{ chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary' }],
    });

    expect(result.deletedPaths).toContain(packPath);
    expect(h.remove).toHaveBeenCalledWith(packPath);
  });

  it('T14：pack 的 packScope 与 scope 不符 -> quarantine', async () => {
    const packPath = 'TavernDB_ACU_vector_v2pack_scope:chat-a|iso-a|summary_pack_abc';
    const packBlob = {
      version: 1, schema: 'content_addressed_vector_pack', packKey: 'pack_abc', packScope: 'scope:chat-a|iso-b|other',
      embeddingModel: 'model-a', dimension: 2, chunks: [],
    };
    h.registry.mockResolvedValue({ files: [{ path: packPath, createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z', checksum: '' }] });
    h.read.mockResolvedValue({ ok: true, data: packBlob });

    const result = await cleanupUnreachableSummaryVectorIndexFiles_ACU({
      scopeHints: [{ chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary' }],
    });

    expect(result.deletedPaths).toEqual([]);
    expect(result.blockedByReachability).toContain(packPath);
    expect(h.remove).not.toHaveBeenCalled();
  });

  it('T14：registry 无可信时间 -> quarantine，不下载 blob', async () => {
    const packPath = 'TavernDB_ACU_vector_v2pack_scope:chat-a|iso-a|summary_pack_abc';
    h.registry.mockResolvedValue({ files: [{ path: packPath, createdAt: '', updatedAt: '', checksum: '' }] });
    h.read.mockClear();

    const result = await cleanupUnreachableSummaryVectorIndexFiles_ACU({
      scopeHints: [{ chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary' }],
    });

    expect(result.deletedPaths).toEqual([]);
    expect(result.blockedByReachability).toContain(packPath);
    expect(h.read).not.toHaveBeenCalled();
  });

  it('T14：pack 不可达但 registry checksum 与内容不符 -> quarantine', async () => {
    const packPath = 'TavernDB_ACU_vector_v2pack_scope:chat-a|iso-a|summary_pack_abc';
    const packBlob = {
      version: 1, schema: 'content_addressed_vector_pack', packKey: 'pack_abc', packScope: 'scope:chat-a|iso-a|summary',
      embeddingModel: 'model-a', dimension: 2, chunks: [],
    };
    h.registry.mockResolvedValue({ files: [{ path: packPath, createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z', checksum: 'sha:999' }] });
    h.read.mockResolvedValue({ ok: true, data: packBlob });

    const result = await cleanupUnreachableSummaryVectorIndexFiles_ACU({
      scopeHints: [{ chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary' }],
    });

    expect(result.deletedPaths).toEqual([]);
    expect(result.blockedByReachability).toContain(packPath);
    expect(h.remove).not.toHaveBeenCalled();
  });

  it('T14：prepared 未 finalize 的 pack -> 保留', async () => {
    const packPath = 'TavernDB_ACU_vector_v2pack_scope:chat-a|iso-a|summary_pack_abc';
    const packBlob = {
      version: 1, schema: 'content_addressed_vector_pack', packKey: 'pack_abc', packScope: 'scope:chat-a|iso-a|summary',
      embeddingModel: 'model-a', dimension: 2, chunks: [],
    };
    h.registry.mockResolvedValue({ files: [{ path: packPath, createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z', checksum: '', publicationState: 'prepared' }] });
    h.read.mockResolvedValue({ ok: true, data: packBlob });

    const result = await cleanupUnreachableSummaryVectorIndexFiles_ACU({
      scopeHints: [{ chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary' }],
    });

    // pending 发布窗口内的对象不能被 GC 删除（prepared 未 finalize）
    expect(result.deletedPaths).toEqual([]);
    expect(result.blockedByReachability).toContain(packPath);
    expect(h.remove).not.toHaveBeenCalled();
  });


  it('T15：新 content pack 健康 -> identityMismatchCount 为 0', async () => {
    const manifest = manifest_ACU();
    const packPath = 'TavernDB_ACU_vector_v2pack_scope:chat-a|iso-a|summary_pack_abc';
    const packBlob = {
      version: 1, schema: 'content_addressed_vector_pack', packKey: 'pack_abc', packScope: 'scope:chat-a|iso-a|summary',
      embeddingModel: 'model-a', dimension: 2,
      chunks: [
        { chunkKey: 'key-c1', chunkId: 'chunk-a', rowKey: 'row-a', text: 'text1', vector: encodeF32B64([1, 2]), vectorEncoding: 'f32b64' },
      ],
    };
    manifest.contentAddressed = {
      version: 1, mode: 'content_addressed_packs', chunkRefs: [],
      activeChunkKeys: ['key-c1'], packRefs: [{ packKey: 'pack_abc', packScope: 'scope:chat-a|iso-a|summary', schemaVersion: 1, path: packPath, checksum: '', byteSize: 1, chunkKeys: ['key-c1'], chunkCount: 1, rowCount: 1, embeddingModel: 'model-a', dimension: 2, createdAt: '', updatedAt: '', status: 'ready' }],
    };
    h.snapshot.value = {
      layers: [{ messageIndex: 0, isolationKey: 'iso-a', summaryVectorIndexState: { manifest }, tagData: {} }],
    };
    h.registry.mockResolvedValue({ files: [{ path: packPath, role: 'vector_pack', checksum: '' }] });
    h.read.mockImplementation(async (path: string) => path === packPath ? { ok: true, data: packBlob } : { ok: true, data: blob_ACU(manifest) });

    const report = await inspectSummaryVectorIndexHealth_ACU();

    expect(report.identityMismatchCount).toBe(0);
    expect(report.status).toBe('healthy');
    expect(report.issues.filter((issue) => issue.path === packPath)).toEqual([]);
  });

  it('T15：篡改 packScope -> 1 条 identity_mismatch', async () => {
    const manifest = manifest_ACU();
    const packPath = 'TavernDB_ACU_vector_v2pack_scope:chat-a|iso-a|summary_pack_abc';
    const packBlob = {
      version: 1, schema: 'content_addressed_vector_pack', packKey: 'pack_abc', packScope: 'scope:chat-a|iso-b|other',
      embeddingModel: 'model-a', dimension: 2,
      chunks: [{ chunkKey: 'key-c1', chunkId: 'chunk-a', rowKey: 'row-a', text: 'text1', vector: encodeF32B64([1, 2]), vectorEncoding: 'f32b64' }],
    };
    manifest.contentAddressed = {
      version: 1, mode: 'content_addressed_packs', chunkRefs: [],
      activeChunkKeys: ['key-c1'], packRefs: [{ packKey: 'pack_abc', packScope: 'scope:chat-a|iso-a|summary', schemaVersion: 1, path: packPath, checksum: '', byteSize: 1, chunkKeys: ['key-c1'], chunkCount: 1, rowCount: 1, embeddingModel: 'model-a', dimension: 2, createdAt: '', updatedAt: '', status: 'ready' }],
    };
    h.snapshot.value = {
      layers: [{ messageIndex:0, isolationKey: 'iso-a', summaryVectorIndexState: { manifest }, tagData: {} }],
    };
    h.registry.mockResolvedValue({ files: [{ path: packPath, role: 'vector_pack', checksum: '' }] });
    h.read.mockImplementation(async (path: string) => path === packPath ? { ok: true, data: packBlob } : { ok: true, data: blob_ACU(manifest) });

    const report = await inspectSummaryVectorIndexHealth_ACU();

    expect(report.identityMismatchCount).toBe(1);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'identity_mismatch', path: packPath }),
    ]));
  });

  it('T15：删掉一个 chunk -> pack_chunk_missing', async () => {
    const manifest = manifest_ACU();
    const packPath = 'TavernDB_ACU_vector_v2pack_scope:chat-a|iso-a|summary_pack_abc';
    const packBlob = {
      version: 1, schema: 'content_addressed_vector_pack', packKey: 'pack_abc', packScope: 'scope:chat-a|iso-a|summary',
      embeddingModel: 'model-a', dimension: 2,
      chunks: [], // 删掉全部 chunk
    };
    manifest.contentAddressed = {
      version: 1, mode: 'content_addressed_packs', chunkRefs: [],
      activeChunkKeys: ['key-c1'], packRefs: [{ packKey: 'pack_abc', packScope: 'scope:chat-a|iso-a|summary', schemaVersion: 1, path: packPath, checksum: '', byteSize: 1, chunkKeys: ['key-c1'], chunkCount: 1, rowCount: 1, embeddingModel: 'model-a', dimension: 2, createdAt: '', updatedAt: '', status: 'ready' }],
    };
    h.snapshot.value = {
      layers: [{ messageIndex: 0, isolationKey: 'iso-a', summaryVectorIndexState: { manifest }, tagData: {} }],
    };
    h.registry.mockResolvedValue({ files: [{ path: packPath, role: 'vector_pack', checksum: '' }] });
    h.read.mockImplementation(async (path: string) => path === packPath ? { ok: true, data: packBlob } : { ok: true, data: blob_ACU(manifest) });

    const report = await inspectSummaryVectorIndexHealth_ACU();

    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'pack_chunk_missing', path: packPath, chunkId: 'chunk-a' }),
    ]));
  });

  it('T15：重复 chunk -> pack_chunk_duplicated', async () => {
    const manifest = manifest_ACU();
    const packPath = 'TavernDB_ACU_vector_v2pack_scope:chat-a|iso-a|summary_pack_abc';
    const packBlob = {
      version: 1, schema: 'content_addressed_vector_pack', packKey: 'pack_abc', packScope: 'scope:chat-a|iso-a|summary',
      embeddingModel: 'model-a', dimension: 2,
      chunks: [
        { chunkKey: 'key-c1', chunkId: 'chunk-a', rowKey: 'row-a', text: 'text1', vector: encodeF32B64([1, 2]), vectorEncoding: 'f32b64' },
        { chunkKey: 'key-c1b', chunkId: 'chunk-a', rowKey: 'row-a', text: 'text1b', vector: encodeF32B64([1, 2]), vectorEncoding: 'f32b64' },
      ],
    };
    manifest.contentAddressed = {
      version: 1, mode: 'content_addressed_packs', chunkRefs: [],
      activeChunkKeys: ['key-c1'], packRefs: [{ packKey: 'pack_abc', packScope: 'scope:chat-a|iso-a|summary', schemaVersion: 1, path: packPath, checksum: '', byteSize: 1, chunkKeys: ['key-c1'], chunkCount: 1, rowCount: 1, embeddingModel: 'model-a', dimension: 2, createdAt: '', updatedAt: '', status: 'ready' }],
    };
    h.snapshot.value = {
      layers: [{ messageIndex: 0, isolationKey: 'iso-a', summaryVectorIndexState: { manifest }, tagData: {} }],
    };
    h.registry.mockResolvedValue({ files: [{ path: packPath, role: 'vector_pack', checksum: '' }] });
    h.read.mockImplementation(async (path: string) => path === packPath ? { ok: true, data: packBlob } : { ok: true, data: blob_ACU(manifest) });

    const report = await inspectSummaryVectorIndexHealth_ACU();

    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'pack_chunk_duplicated', path: packPath, chunkId: 'chunk-a' }),
    ]));
  });

  it('T15：legacy pack fixture（VectorIndexPackBlob_ACU 形态）仍走旧分支，不误报 identity_mismatch', async () => {
    // 旧协议：pack 有 indexId、chunks[].vector 是数组、无 packScope，无 schema 字段。
    // 新分流只在 schema === 'content_addressed_vector_pack' 时生效（:2720），否则落回 legacy 分支。
    const manifest = manifest_ACU();
    const packPath = 'TavernDB_ACU_vector_v2pack_scope:chat-a|iso-a|summary_pack_abc';
    const legacyPackBlob = {
      version: 1, packKey: 'pack_abc', indexId: 'snap-a', embeddingModel: 'model-a', dimension: 2,
      chunkKeys: ['key-c1'], createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
      chunks: [{ chunkKey: 'key-c1', chunkId: 'chunk-a', rowKey: 'row-a', rowOrder: 0, sequence: 0, text: 'text1', textHash: 'text-a', vector: [1, 2] }],
    };
    manifest.contentAddressed = {
      version: 1, mode: 'content_addressed_packs', chunkRefs: [],
      activeChunkKeys: ['key-c1'], packRefs: [{ packKey: 'pack_abc', packScope: 'scope:chat-a|iso-a|summary', schemaVersion: 1, path: packPath, checksum: '', byteSize: 1, chunkKeys: ['key-c1'], chunkCount: 1, rowCount: 1, embeddingModel: 'model-a', dimension: 2, createdAt: '', updatedAt: '', status: 'ready' }],
    };
    h.snapshot.value = {
      layers: [{ messageIndex: 0, isolationKey: 'iso-a', summaryVectorIndexState: { manifest }, tagData: {} }],
    };
    h.registry.mockResolvedValue({ files: [{ path: packPath, role: 'vector_pack', checksum: '' }] });
    // 旧分支按 indexId 判身份，pack 的 indexId 与 manifest 一致，且 chunk vector 是数组 -> 健康
    h.read.mockImplementation(async (path: string) => path === packPath ? { ok: true, data: legacyPackBlob } : { ok: true, data: blob_ACU(manifest) });

    const report = await inspectSummaryVectorIndexHealth_ACU();

    expect(report.identityMismatchCount).toBe(0);
    expect(report.issues.filter((issue) => issue.path === packPath)).toEqual([]);
  });

});

describe('summary-vector-index-storage-service legacy layout classification', () => {
  it('将无 storageIdentity 的 single-file snapshot 识别为可兼容迁移的 legacy layout', () => {
    const legacyManifest = manifest_ACU();
    delete legacyManifest.storageIdentity;

    expect(isLegacySummaryVectorIndexManifest_ACU(legacyManifest)).toBe(true);
  });

  it('不将已带 V2 storageIdentity 的 single-file snapshot 误判为 legacy layout', () => {
    expect(isLegacySummaryVectorIndexManifest_ACU(manifest_ACU())).toBe(false);
  });
});

describe('summary-vector-index-storage-service V2 单文件写入', () => {
  const options = () => ({
    chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary', sourceTableName: '纪要表',
    snapshotMessageId: 'message-a', indexedAt: '2025-01-01T00:00:00.000Z', embeddingModel: 'model-a',
    rows: [{ rowKey: 'row-a', rowId: '1', rowOrder: 0, timeSpan: '', location: '', summary: 'summary', indexCode: 'A', vectorSourceText: 'summary', chunkIds: ['chunk-a'] }],
    chunks: [{ chunkId: 'chunk-a', rowKey: 'row-a', rowOrder: 0, sequence: 0, text: 'summary', vector: [1, 2] }],
    snapshotRevision: 0,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    h.isolationKey = 'iso-a';
    h.config.value = { summaryIndexRollingDeltaEnabled: false, summaryIndexV2WriteEnabled: true };
    h.getHot.mockResolvedValue(null);
    h.register.mockResolvedValue(undefined);
    h.remove.mockResolvedValue({ ok: true });
    h.unregister.mockResolvedValue(undefined);
  });

  it('相同逻辑输入的两次写入生成不同物理路径，并把完整 scope 写入 identity', async () => {
    let entropy = 0;
    const random = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((array: Uint32Array) => {
      array.fill(++entropy);
      return array;
    });
    const blobs = new Map<string, any>();
    h.upload.mockImplementation(async (params: any) => {
      blobs.set(params.path, params.data);
      return { ok: true, ref: { role: params.role, path: params.path, byteSize: 1, checksum: `sha:${JSON.stringify(params.data).length}`, createdAt: '', updatedAt: '', status: 'ready' } };
    });
    h.read.mockImplementation(async (path: string) => ({ ok: true, data: blobs.get(path) }));

    const first = await persistSummaryVectorIndexSnapshot_ACU(options() as any);
    const second = await persistSummaryVectorIndexSnapshot_ACU(options() as any);

    expect(first.manifest.manifestFile).not.toBe(second.manifest.manifestFile);
    expect(first.manifest.storageIdentity).toMatchObject({
      layoutVersion: 2,
      scopeFingerprint: 'scope:chat-a|iso-a|summary',
      revision: 1,
    });
    expect(first.manifest.files).toHaveLength(1);
    expect(h.register).toHaveBeenCalledTimes(2);
    random.mockRestore();
  });

  it('运行时默认隔离域为空时，V2 path、manifest、blob 与内嵌 manifest 均写入 canonical default', async () => {
    h.isolationKey = '';
    const blobs = new Map<string, any>();
    h.upload.mockImplementation(async (params: any) => {
      blobs.set(params.path, params.data);
      return { ok: true, ref: { role: params.role, path: params.path, byteSize: 1, checksum: `sha:${JSON.stringify(params.data).length}`, createdAt: '', updatedAt: '', status: 'ready' } };
    });
    h.read.mockImplementation(async (path: string) => ({ ok: true, data: blobs.get(path) }));

    const input = options();
    delete (input as any).isolationKey;
    const persisted = await persistSummaryVectorIndexSnapshot_ACU(input as any);
    const blob = blobs.get(persisted.manifest.manifestFile);

    expect(persisted.manifest.isolationKey).toBe('default');
    expect(blob.isolationKey).toBe('default');
    expect(blob.manifest.isolationKey).toBe('default');
    expect(persisted.manifest.storageIdentity?.scopeFingerprint).toBe('scope:chat-a|default|summary');
    await expect(loadSummaryVectorIndexChunksFromManifest_ACU(persisted.manifest, { preferExternalFiles: true }))
      .resolves.toMatchObject([{ chunkId: 'chunk-a' }]);
  });

  it('滚动增量开关开启时仍走不可变 V2 单文件发布路径，不写 legacy rolling 对象', async () => {
    h.config.value = { summaryIndexRollingDeltaEnabled: true, summaryIndexV2WriteEnabled: true };
    const blobs = new Map<string, any>();
    h.upload.mockImplementation(async (params: any) => {
      blobs.set(params.path, params.data);
      return { ok: true, ref: { role: params.role, path: params.path, byteSize: 1, checksum: `sha:${JSON.stringify(params.data).length}`, createdAt: '', updatedAt: '', status: 'ready' } };
    });
    h.read.mockImplementation(async (path: string) => ({ ok: true, data: blobs.get(path) }));

    const persisted = await persistSummaryVectorIndexSnapshot_ACU(options() as any);

    expect(persisted.manifest.storageIdentity).toMatchObject({ layoutVersion: 2, scopeFingerprint: 'scope:chat-a|iso-a|summary' });
    expect(persisted.manifest.manifestFile).toContain('TavernDB_ACU_vector_v2_scope:chat-a|iso-a|summary_');
    expect(persisted.manifest.snapshot?.mode).toBe('single_file_snapshot');
    expect(h.upload).toHaveBeenCalledTimes(1);
    expect(h.register).toHaveBeenCalledWith([expect.objectContaining({ publicationState: 'prepared' })]);
    expect(h.logWarn).toHaveBeenCalledWith('[纪要向量索引] identity event:', expect.objectContaining({
      operation: 'persist',
      outcome: 'rolling_delta_bypassed_for_v2_safety',
      scopeFingerprint: 'scope:chat-a|iso-a|summary',
    }));
  });

  it('紧急关闭 V2 writer 时拒绝写入且不回退覆盖任何旧对象', async () => {
    h.config.value = { summaryIndexRollingDeltaEnabled: false, summaryIndexV2WriteEnabled: false };

    await expect(persistSummaryVectorIndexSnapshot_ACU(options() as any)).rejects.toThrow('V2 写入已关闭');
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.register).not.toHaveBeenCalled();
    expect(h.logWarn).toHaveBeenCalledWith('[纪要向量索引] identity event:', expect.objectContaining({
      operation: 'persist',
      outcome: 'rejected_writer_disabled',
      scopeFingerprint: 'scope:chat-a|iso-a|summary',
      path: '',
      layoutVersion: 'legacy',
    }));
  });

  it('V2 writer 灰度 allowlist 不包含当前 canonical scope 时拒绝写入且不创建对象', async () => {
    h.config.value = {
      summaryIndexRollingDeltaEnabled: false,
      summaryIndexV2WriteEnabled: true,
      summaryIndexV2WriteScopeAllowlist: ['scope:other-chat|iso-a|summary'],
    };

    await expect(persistSummaryVectorIndexSnapshot_ACU(options() as any)).rejects.toThrow('未向当前 scope 灰度开放');
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.register).not.toHaveBeenCalled();
    expect(h.logWarn).toHaveBeenCalledWith('[纪要向量索引] identity event:', expect.objectContaining({
      operation: 'persist',
      outcome: 'rejected_scope_not_allowlisted',
      scopeFingerprint: 'scope:chat-a|iso-a|summary',
    }));
  });

  it('写后身份校验失败时回滚刚上传的对象，且不发布 registry', async () => {
    h.upload.mockImplementation(async (params: any) => ({ ok: true, ref: { role: params.role, path: params.path, byteSize: 1, checksum: `sha:${JSON.stringify(params.data).length}`, createdAt: '', updatedAt: '', status: 'ready' } }));
    h.read.mockResolvedValue({ ok: true, data: { schema: 'single_file_snapshot', indexId: 'wrong' } });

    await expect(persistSummaryVectorIndexSnapshot_ACU(options() as any))
      .rejects.toThrow('V2 快照写后校验失败');
    expect(h.remove).toHaveBeenCalledWith(expect.stringContaining('TavernDB_ACU_vector_v2_scope:chat-a|iso-a|summary_'));
    expect(h.unregister).toHaveBeenCalledTimes(1);
    expect(h.register).not.toHaveBeenCalled();
  });

  it('写后 checksum 不匹配时回滚刚上传的对象，且不发布 registry', async () => {
    h.upload.mockImplementation(async (params: any) => ({ ok: true, ref: { role: params.role, path: params.path, byteSize: 1, checksum: 'wrong-checksum', createdAt: '', updatedAt: '', status: 'ready' } }));
    const persistedBlob = new Map<string, any>();
    h.upload.mockImplementation(async (params: any) => {
      persistedBlob.set(params.path, params.data);
      return { ok: true, ref: { role: params.role, path: params.path, byteSize: 1, checksum: 'wrong-checksum', createdAt: '', updatedAt: '', status: 'ready' } };
    });
    h.read.mockImplementation(async (path: string) => ({ ok: true, data: persistedBlob.get(path) }));
    await expect(persistSummaryVectorIndexSnapshot_ACU(options() as any)).rejects.toThrow('checksum 不匹配');
    expect(h.remove).toHaveBeenCalledTimes(1);
    expect(h.register).not.toHaveBeenCalled();
  });

  it('写入准备阶段不删除 previous manifest，避免宿主 pointer 保存失败时破坏旧快照', async () => {
    const random = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((array: Uint32Array) => {
      array.fill(1);
      return array;
    });
    const blobs = new Map<string, any>();
    h.upload.mockImplementation(async (params: any) => {
      blobs.set(params.path, params.data);
      return { ok: true, ref: { role: params.role, path: params.path, byteSize: 1, checksum: `sha:${JSON.stringify(params.data).length}`, createdAt: '', updatedAt: '', status: 'ready' } };
    });
    h.read.mockImplementation(async (path: string) => ({ ok: true, data: blobs.get(path) }));

    await expect(persistSummaryVectorIndexSnapshot_ACU({ ...options(), previousManifest: { indexId: 'old-index', files: [{ path: 'old-path' }] } } as any)).resolves.toBeDefined();

    expect(h.remove).not.toHaveBeenCalled();
    expect(h.unregister).not.toHaveBeenCalled();
    random.mockRestore();
  });

  it('写后校验失败且删除失败时保留 registry 并报告未回滚对象', async () => {
    h.upload.mockImplementation(async (params: any) => ({ ok: true, ref: { role: params.role, path: params.path, byteSize: 1, checksum: 'checksum', createdAt: '', updatedAt: '', status: 'ready' } }));
    h.read.mockResolvedValue({ ok: true, data: { schema: 'single_file_snapshot', indexId: 'wrong' } });
    h.remove.mockResolvedValue({ ok: false, error: 'remote delete failed' });

    await expect(persistSummaryVectorIndexSnapshot_ACU(options() as any))
      .rejects.toThrow('上传对象回滚不完整');
    expect(h.unregister).not.toHaveBeenCalled();
    expect(h.register).toHaveBeenCalledWith([expect.objectContaining({ path: expect.stringContaining('TavernDB_ACU_vector_v2_scope:chat-a|iso-a|summary_') })]);
  });

  it('回滚 orphan registry 登记失败时把诊断信息附加到最终错误', async () => {
    h.upload.mockImplementation(async (params: any) => ({ ok: true, ref: { role: params.role, path: params.path, byteSize: 1, checksum: 'checksum', createdAt: '', updatedAt: '', status: 'ready' } }));
    h.read.mockResolvedValue({ ok: true, data: { schema: 'single_file_snapshot', indexId: 'wrong' } });
    h.remove.mockResolvedValue({ ok: false, error: 'remote delete failed' });
    h.register.mockRejectedValueOnce(new Error('registry unavailable'));

    await expect(persistSummaryVectorIndexSnapshot_ACU(options() as any))
      .rejects.toThrow('orphanRegistry=registry unavailable');
  });

  it('registry 发布尚未完成时 GC 仍保留 prepared 快照', async () => {
    const blobs = new Map<string, any>();
    h.upload.mockImplementation(async (params: any) => {
      blobs.set(params.path, params.data);
      return { ok: true, ref: { role: params.role, path: params.path, byteSize: 1, checksum: `sha:${JSON.stringify(params.data).length}`, createdAt: '', updatedAt: '', status: 'ready' } };
    });
    h.read.mockImplementation(async (path: string) => ({ ok: true, data: blobs.get(path) }));
    let releaseRegistry!: () => void;
    const registryGate = new Promise<void>((resolve) => { releaseRegistry = resolve; });
    let registeredFiles: any[] = [];
    h.register.mockImplementation(async (files: any[]) => {
      registeredFiles = files;
      await registryGate;
    });

    const persistPromise = persistSummaryVectorIndexSnapshot_ACU(options() as any);
    while (registeredFiles.length === 0) await Promise.resolve();
    h.registry.mockResolvedValue({ files: registeredFiles });

    const duringRegistryPublish = await cleanupUnreachableSummaryVectorIndexFiles_ACU({
      scopeHints: [{ chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary' }],
    });
    expect(duringRegistryPublish.deletedPaths).toEqual([]);
    expect(duringRegistryPublish.blockedByReachability).toContain(registeredFiles[0].path);
    expect(h.remove).not.toHaveBeenCalled();

    releaseRegistry();
    const persisted = await persistPromise;
    await finalizeSummaryVectorIndexSnapshotPublication_ACU(persisted.uploadedFiles);
    expect(h.register).toHaveBeenLastCalledWith([expect.objectContaining({ path: persisted.uploadedFiles[0].path, publicationState: 'published' })]);
  });

  it('prepared 快照在 durable publish 前被 GC 保留，finalize 后才允许删除', async () => {
    const blobs = new Map<string, any>();
    h.upload.mockImplementation(async (params: any) => {
      blobs.set(params.path, params.data);
      return { ok: true, ref: { role: params.role, path: params.path, byteSize: 1, checksum: `sha:${JSON.stringify(params.data).length}`, createdAt: '', updatedAt: '', status: 'ready' } };
    });
    h.read.mockImplementation(async (path: string) => ({ ok: true, data: blobs.get(path) }));

    const persisted = await persistSummaryVectorIndexSnapshot_ACU(options() as any);
    const [file] = persisted.uploadedFiles;
    h.registry.mockResolvedValue({ files: [{ ...file, createdAt: '2020-01-01T00:00:00.000Z' }] });

    const beforeFinalize = await cleanupUnreachableSummaryVectorIndexFiles_ACU({
      scopeHints: [{ chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary' }],
    });
    expect(beforeFinalize.deletedPaths).toEqual([]);
    expect(beforeFinalize.blockedByReachability).toContain(file.path);
    expect(h.remove).not.toHaveBeenCalled();

    await finalizeSummaryVectorIndexSnapshotPublication_ACU(persisted.uploadedFiles);
    const afterFinalize = await cleanupUnreachableSummaryVectorIndexFiles_ACU({
      scopeHints: [{ chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary' }],
    });
    expect(afterFinalize.deletedPaths).toEqual([file.path]);
    expect(h.remove).toHaveBeenCalledWith(file.path);
  });

  it('缺少 crypto.getRandomValues 时拒绝 V2 写入，且不上传对象', async () => {
    vi.stubGlobal('crypto', undefined);
    await expect(persistSummaryVectorIndexSnapshot_ACU(options() as any))
      .rejects.toThrow('需要 crypto.getRandomValues');
    expect(h.upload).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('T2：混维 chunks 被 persist 拒绝，不写入外置文件', async () => {
    const mixed = options();
    mixed.chunks = [
      { chunkId: 'chunk-a', rowKey: 'row-a', rowOrder: 0, sequence: 0, text: 'summary', vector: [1, 2] },
      { chunkId: 'chunk-b', rowKey: 'row-a', rowOrder: 1, sequence: 1, text: 'other', vector: [1, 2, 3] },
    ];
    mixed.rows = [{
      rowKey: 'row-a', rowId: '1', rowOrder: 0, timeSpan: '', location: '', summary: 'summary', indexCode: 'A', vectorSourceText: 'summary', chunkIds: ['chunk-a', 'chunk-b'],
    }];
    await expect(persistSummaryVectorIndexSnapshot_ACU(mixed as any))
      .rejects.toThrow('维度不一致');
    expect(h.upload).not.toHaveBeenCalled();
  });
});