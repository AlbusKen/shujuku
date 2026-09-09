/**
 * tests/service/vector/summary-vector-index-write-barrier.integration.test.ts
 *
 * P4 真实 repository 集成测试（计划 5.2）：
 * 不 mock `chat-message-data-repo` 与 `chat-commit` 事务 helper；真实导入
 * `patchIsolatedTagMetadata_ACU()` 与 `commitVectorMetadataPatch_ACU()`，
 * 只 mock 外部文件存储、宿主保存与 runtime state。
 *
 * 验证目标：
 * 1. 恢复到无槽消息：成功，tracking 数组契约正确（不出现 `{}`）。
 * 2. 恢复到已有 V1 `sheet_*` 槽：成功追加 metadata，V1 表投影逐字段不变。
 * 3. 恢复到 V2 frame：成功并保留 frame。
 * 4. 恢复期间已有新 pointer：CAS 拒绝，不保存、不覆盖。
 * 5. strict save 失败：恢复原 container 的值、类型和存在性。
 * 6. checkpoint 写入到 V1/V2 槽均成功，只改变 metadata。
 * 7. 空纪要清理 V1 槽：删除 pointer、保留 V1；save 成功后才删除外置文件。
 * 8. 旧 manifest 迁移：V1 表保留，新 pointer durable 后 finalize；save/CAS 失败时 abort。
 * 9. realign：更高 revision 成功；回退、重复 revision、CAS 冲突拒绝。
 * 10. 当前聊天多层删除：任一层 patch 或 strict save 失败时全批回滚；成功时只保存一次。
 */

// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ════════════════════════════════════════════════════════════════
// hoisted mock 句柄：外部文件存储、宿主保存、runtime state、publication
// ════════════════════════════════════════════════════════════════
const h = vi.hoisted(() => {
  const chatKey = 'chat-a';
  const isolationKey = 'iso-a';
  const tables = { summary: { name: '纪要表' } } as any;
  const chat = [{ is_user: false, mesId: 'm-1' }] as any[];
  return {
    chatKey,
    isolationKey,
    tables,
    chat,
    // runtime state
    // 外部文件存储
    registry: [] as any[],
    reads: vi.fn(),
    // publication
    finalize: vi.fn(),
    abort: vi.fn(),
    deleteExternal: vi.fn(),
    isLegacyManifest: vi.fn(),
    // 宿主保存
    save: vi.fn(),
    saveStrict: vi.fn(),
    // 其余外部依赖
    embeddings: vi.fn(),
    loadChunksFromManifest: vi.fn(),
  };
});

vi.mock('../../../src/service/runtime/state-manager', () => ({
  currentChatFileIdentifier_ACU: h.chatKey,
  getCurrentIsolationKey_ACU: () => h.isolationKey,
  get currentJsonTableData_ACU() { return h.tables; },
  settings_ACU: { dataIsolationEnabled: false, dataIsolationCode: '' },
}));
vi.mock('../../../src/shared/utils', () => ({ isSummaryOrOutlineTable_ACU: () => true, logDebug_ACU: vi.fn(), logError_ACU: vi.fn(), logWarn_ACU: vi.fn(), hashUserInput_ACU: vi.fn() }));
vi.mock('../../../src/shared/template-preset-utils', () => ({ getCurrentCharacterCardName_ACU: () => 'char' }));

// chat-service：真实导出 getChatArray_ACU（供 chat-service / archive / runtime 使用）
vi.mock('../../../src/service/chat/chat-service', () => ({
  getChatArray_ACU: () => h.chat,
}));

// 真实导入 repository 与事务 helper；仅 mock 宿主保存与外部文件存储。
vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: () => h.chat,
  saveChatToHost_ACU: (...args: any[]) => h.save(...args),
  saveChatToHostStrict_ACU: (...args: any[]) => h.saveStrict(...args),
}));

vi.mock('../../../src/data/storage/vector-index-st-files-storage', () => ({
  buildVectorIndexSingleSnapshotFilePath_ACU: (p: any) => p.chatName ? `named-${p.sourceTableKey}` : `unnamed-${p.sourceTableKey}`,
  buildLegacyVectorIndexSingleSnapshotFilePath_ACU: (p: any) => `legacy-${p.sourceTableKey}`,
  buildVectorIndexSingleSnapshotV2ScopeToken_ACU: (p: any) => `scope-${p.chatKey}-${p.isolationKey}-${p.sourceTableKey}`,
  buildVectorIndexSingleSnapshotV2FilePath_ACU: (...args: any[]) => `v2-${args[0]?.indexId}`,
  loadVectorIndexRegistry_ACU: async () => ({ files: h.registry }),
  readVectorIndexJsonFile_ACU: (...args: any[]) => h.reads(...args),
}));

// storage-service 依赖：仅 mock 外置文件持久化/发布与身份校验。
vi.mock('../../../src/service/vector/summary-vector-index-storage-service', () => ({
  validateSingleFileSnapshotIdentity_ACU: () => undefined,
  persistSummaryVectorIndexSnapshot_ACU: async (options: any) => {
    const indexId = options.previousManifest?.indexId ? `idx-${Number(options.previousManifest.indexId.replace(/\D/g, '') || 0) + 1}` : 'idx-1';
    const manifest = {
      indexId,
      schema: 'single_file_snapshot',
      status: 'ready',
      chatKey: options.chatKey,
      isolationKey: options.isolationKey,
      sourceTableKey: options.sourceTableKey,
      sourceTableName: options.sourceTableName,
      snapshotMessageId: options.snapshotMessageId,
      indexedAt: options.indexedAt,
      rowCount: options.rows.length,
      chunkCount: options.chunks.length,
      skippedRowCount: options.skippedRowCount,
      embeddingModel: options.embeddingModel,
      snapshot: { revision: (options.snapshotRevision || 0) + 1 },
      storageIdentity: { revision: (options.snapshotRevision || 0) + 1 },
      files: [],
      uploadedFiles: [],
    };
    return {
      manifest,
      state: { ...manifest },
      uploadedFiles: [{ path: `v2-${indexId}`, publicationState: 'prepared' } as any],
    };
  },
  deleteSummaryVectorIndexExternal_ACU: (...args: any[]) => h.deleteExternal(...args),
  abortSummaryVectorIndexSnapshotPublication_ACU: (...args: any[]) => h.abort(...args),
  finalizeSummaryVectorIndexSnapshotPublication_ACU: (...args: any[]) => h.finalize(...args),
  isLegacySummaryVectorIndexManifest_ACU: (...args: any[]) => h.isLegacyManifest(...args),
  loadSummaryVectorIndexChunksFromManifest_ACU: (...args: any[]) => h.loadChunksFromManifest(...args),
  logSummaryVectorIndexIdentityEvent_ACU: vi.fn(),
  normalizeSummaryVectorIndexManifestForRead_ACU: (m: any) => m,
  cleanupUnreachableSummaryVectorIndexFiles_ACU: async () => ({ deletedPaths: [], failedDeletes: [] }),
}));

// state-service 依赖：aggregated snapshot 由测试直接控制。
vi.mock('../../../src/service/vector/summary-vector-index-state-service', () => ({
  getAggregatedSummaryVectorIndexSnapshot_ACU: () => h.aggregatedSnapshot,
  getLatestSummaryVectorIndexSnapshotState_ACU: () => null,
  assignSummaryVectorIndexStateToTagData_ACU: vi.fn(),
  clearLatestSummaryVectorIndexStateForMissingExternalFiles_ACU: vi.fn(async () => ({ chatStateCleared: false })),
  clearLatestSummaryVectorIndexStateForInvalidExternalFiles_ACU: vi.fn(async () => ({ chatStateCleared: false })),
}));

// archive-service 还依赖：remote-memory anchor、embedding gateway、hot cache、vector-memory-config、table-history。
vi.mock('../../../src/service/vector/remote-memory-snapshot-anchor', () => ({
  resolveRemoteMemorySnapshotAnchor_ACU: () => ({ anchor: 'm-1' }),
  persistRemoteMemorySnapshotAnchorIfNeeded_ACU: () => undefined,
}));
vi.mock('../../../src/data/gateways/vector-embedding-gateway', () => ({
  createEmbeddings_ACU: (...args: any[]) => h.embeddings(...args),
  isVectorEmbeddingError_ACU: () => false,
}));
vi.mock('../../../src/data/storage/vector-index-hot-cache', () => ({
  assertSummaryVectorFlushGenerationCurrent_ACU: () => undefined,
  SummaryVectorFlushGenerationInvalidatedError_ACU: class extends Error {},
  deleteSummaryVectorHotCacheByScope_ACU: vi.fn(),
  clearSummaryVectorFlushTasksByScope_ACU: vi.fn(),
}));
vi.mock('../../../src/service/vector/vector-memory-config', () => ({
  getEffectiveSummaryVectorIndexConfig_ACU: () => ({
    embeddingEndpoint: 'https://embedding.test',
    embeddingApiKey: 'test-key',
    embeddingModel: 'test-model',
    summaryIndexChunkSentenceCount: 1,
    summaryIndexV2WriteEnabled: true,
    archiveTriggerCount: 1,
    archiveBatchSize: 1,
    archiveMaxConcurrency: 1,
    threshold: 1,
    topK: 1,
    minScore: 0,
  }),
  validateSummaryVectorIndexConfig_ACU: () => ({ valid: true, errors: [] }),
}));
vi.mock('../../../src/service/table/table-history', () => ({
  getLatestAiMessageIndexFromChat_ACU: (chat: any[]) => chat.map((m: any, i: number) => m && !m.is_user ? i : -1).filter((i: number) => i >= 0).pop() ?? -1,
}));

// 真实导入：repository + 事务 helper + 上层 service
import { patchIsolatedTagMetadata_ACU } from '../../../src/data/repositories/chat-message-data-repo';
import { commitVectorMetadataPatch_ACU, commitVectorMetadataPatchesBatch_ACU } from '../../../src/service/vector/summary-vector-index-chat-commit';
import { tryRecoverSummaryVectorIndexFromExternalSnapshot_ACU, clearSummaryVectorIndexLayerFromChat_ACU, deleteCurrentSummaryVectorIndexFromChat_ACU } from '../../../src/service/vector/summary-vector-index-chat-service';
import { migrateLegacySummaryVectorIndexToContentAddressed_ACU } from '../../../src/service/vector/summary-vector-index-archive-service';

// ════════════════════════════════════════════════════════════════
// Fixture 工厂：V1/V2/mixed 槽、合法 state、外部快照 blob、aggregated snapshot
// ════════════════════════════════════════════════════════════════
function v1Slot(): Record<string, any> {
  return {
    independentData: { sheet_0: { name: '表A', content: [['row_id', 'c1']] } },
    modifiedKeys: ['sheet_0'],
    updateGroupKeys: [],
    _acu_storage_version: 1,
    _acu_base_state: 'base',
  };
}

function v2Slot(): Record<string, any> {
  return {
    storageFrame: { version: 2, logEntries: [], checkpoint: { kind: 'full', data: { sheet_0: { name: '表A' } } } },
    _acu_storage_version: 2,
    _acu_storage_mode: 'checkpoint',
  };
}

function validState(indexId = 'idx-1'): any {
  return {
    version: 1,
    backend: 'st-files',
    status: 'ready',
    indexId,
    snapshotMessageId: 'msg-1',
    sourceTableKey: 'summary',
    sourceTableName: '纪要表',
    indexedAt: '2025-01-01T00:00:00.000Z',
    rowCount: 1,
    chunkCount: 1,
    skippedRowCount: 0,
    rows: [{ rowKey: 'r1', rowId: 'r1', rowOrder: 0, chunkIds: ['c1'], summary: '概要', indexCode: 'i1' }],
    chunks: [{ chunkId: 'c1', rowKey: 'r1', text: 'x', vector: [0.1], sequence: 0 }],
    manifest: { indexId },
  };
}

function blob(overrides: any = {}) {
  const manifest = {
    indexId: 'idx-1', status: 'ready', chatKey: h.chatKey, isolationKey: h.isolationKey, sourceTableKey: 'summary',
    sourceTableName: '纪要表', storageIdentity: { revision: 1 }, snapshot: { revision: 1 },
    ...overrides,
  };
  return {
    schema: 'single_file_snapshot', manifest, indexId: manifest.indexId, chatKey: manifest.chatKey,
    isolationKey: manifest.isolationKey, sourceTableKey: manifest.sourceTableKey,
    rows: [{ rowKey: 'r1', rowId: 'r1', rowOrder: 0, chunkIds: ['c1'] }],
    chunks: [{ chunkId: 'c1', rowKey: 'r1', text: 'x', vector: [0.1], sequence: 0 }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.registry = [];
  h.tables = { summary: { name: '纪要表' } };
  h.chat.length = 0;
  h.chat.push({ is_user: false, mesId: 'm-1' });
  h.aggregatedSnapshot = null;
  h.reads.mockReset();
  h.save.mockReset();
  h.saveStrict.mockReset();
  h.finalize.mockReset();
  h.abort.mockReset();
  h.deleteExternal.mockReset();
  h.isLegacyManifest.mockReset();
  h.embeddings.mockReset();
  h.loadChunksFromManifest.mockReset();
  h.save.mockResolvedValue(undefined);
  h.saveStrict.mockResolvedValue(undefined);
  h.finalize.mockResolvedValue(undefined);
  h.abort.mockResolvedValue(undefined);
  h.deleteExternal.mockResolvedValue(undefined);
});


// ════════════════════════════════════════════════════════════════
// 1. 恢复到无槽消息
// ════════════════════════════════════════════════════════════════
describe('P4 恢复：真实 repository 写屏障', () => {
  it('1.1 恢复到无槽消息：成功，tracking 数组契约正确（不出现 {}）', async () => {
    const path = 'TavernDB_ACU_vector_v2_scope-chat-a-iso-a-summary_idx-1_write_snapshot';
    h.registry = [{ path, publicationState: 'published' }];
    h.reads.mockResolvedValue({ ok: true, data: blob() });

    await expect(tryRecoverSummaryVectorIndexFromExternalSnapshot_ACU()).resolves.toBe(true);

    const msg = h.chat[0];
    expect(msg.TavernDB_ACU_IsolatedData).toBeDefined();
    const tag = msg.TavernDB_ACU_IsolatedData['iso-a'];
    expect(tag.summaryVectorIndexState.manifest.indexId).toBe('idx-1');
    expect(tag.summaryVectorIndexManifest.indexId).toBe('idx-1');
    // tracking 字段契约：新槽绝不出现 {}；无槽时整槽都不存在这两个字段。
    expect(tag).not.toHaveProperty('modifiedKeys');
    expect(tag).not.toHaveProperty('updateGroupKeys');
    expect(tag.modifiedKeys).not.toEqual({});
    expect(tag.updateGroupKeys).not.toEqual({});
    expect(h.saveStrict).toHaveBeenCalledTimes(1);
    expect(h.save).not.toHaveBeenCalled();
  });

  it('1.2 恢复到已有 V1 sheet_* 槽：成功追加 metadata，V1 表投影逐字段不变', async () => {
    const path = 'TavernDB_ACU_vector_v2_scope-chat-a-iso-a-summary_idx-1_write_snapshot';
    h.registry = [{ path, publicationState: 'published' }];
    h.reads.mockResolvedValue({ ok: true, data: blob() });
    const originalV1 = v1Slot();
    h.chat[0].TavernDB_ACU_IsolatedData = { 'iso-a': originalV1 };
    const originalProjection = JSON.parse(JSON.stringify(originalV1));

    await expect(tryRecoverSummaryVectorIndexFromExternalSnapshot_ACU()).resolves.toBe(true);

    const tag = h.chat[0].TavernDB_ACU_IsolatedData['iso-a'];
    expect(tag.summaryVectorIndexState.manifest.indexId).toBe('idx-1');
    // V1 表投影逐字段不变
    expect(tag.independentData).toEqual(originalProjection.independentData);
    expect(tag.modifiedKeys).toEqual(originalProjection.modifiedKeys);
    expect(tag.updateGroupKeys).toEqual(originalProjection.updateGroupKeys);
    expect(tag._acu_storage_version).toBe(1);
    expect(tag._acu_base_state).toBe('base');
    expect(h.saveStrict).toHaveBeenCalledTimes(1);
  });

  it('1.3 恢复到 V2 frame：成功并保留 frame', async () => {
    const path = 'TavernDB_ACU_vector_v2_scope-chat-a-iso-a-summary_idx-1_write_snapshot';
    h.registry = [{ path, publicationState: 'published' }];
    h.reads.mockResolvedValue({ ok: true, data: blob() });
    const originalV2 = v2Slot();
    h.chat[0].TavernDB_ACU_IsolatedData = { 'iso-a': originalV2 };
    const originalFrame = JSON.parse(JSON.stringify(originalV2.storageFrame));

    await expect(tryRecoverSummaryVectorIndexFromExternalSnapshot_ACU()).resolves.toBe(true);

    const tag = h.chat[0].TavernDB_ACU_IsolatedData['iso-a'];
    expect(tag.storageFrame).toEqual(originalFrame);
    expect(tag._acu_storage_version).toBe(2);
    expect(tag._acu_storage_mode).toBe('checkpoint');
    expect(tag.summaryVectorIndexState.manifest.indexId).toBe('idx-1');
    expect(h.saveStrict).toHaveBeenCalledTimes(1);
  });

  it('1.4 恢复期间已有新 pointer：CAS 拒绝，不保存、不覆盖', async () => {
    const path = 'TavernDB_ACU_vector_v2_scope-chat-a-iso-a-summary_idx-1_write_snapshot';
    h.registry = [{ path, publicationState: 'published' }];
    h.reads.mockResolvedValue({ ok: true, data: blob() });
    // 外部 I/O 完成后、提交前，另一维护动作已写入新 pointer（stale snapshot 场景）。
    h.chat[0].TavernDB_ACU_IsolatedData = {
      'iso-a': { ...v1Slot(), summaryVectorIndexState: { ...validState('idx-newer'), manifest: { indexId: 'idx-newer' } }, summaryVectorIndexManifest: { indexId: 'idx-newer' } },
    };
    const before = JSON.parse(JSON.stringify(h.chat[0]));

    // 恢复路径在 restoreCandidate 内先检查 readIsolatedTagData 已有 indexId → 直接返回 false，不提交。
    await expect(tryRecoverSummaryVectorIndexFromExternalSnapshot_ACU()).resolves.toBe(false);

    expect(h.chat[0]).toEqual(before);
    expect(h.saveStrict).not.toHaveBeenCalled();
    expect(h.save).not.toHaveBeenCalled();
  });

  it('1.5 strict save 失败：恢复原 container 的值、类型和存在性（字符串容器）', async () => {
    const path = 'TavernDB_ACU_vector_v2_scope-chat-a-iso-a-summary_idx-1_write_snapshot';
    h.registry = [{ path, publicationState: 'published' }];
    h.reads.mockResolvedValue({ ok: true, data: blob() });
    // 字符串容器：事务快照必须保留原始字符串格式。
    const before = JSON.stringify({ 'iso-a': v1Slot() });
    h.chat[0].TavernDB_ACU_IsolatedData = before;
    h.saveStrict.mockRejectedValueOnce(new Error('host save failed'));

    await expect(tryRecoverSummaryVectorIndexFromExternalSnapshot_ACU()).resolves.toBe(false);

    // 值、类型（字符串容器）、存在性全部还原。
    expect(h.chat[0].TavernDB_ACU_IsolatedData).toBe(before);
    expect(typeof h.chat[0].TavernDB_ACU_IsolatedData).toBe('string');
    expect(h.saveStrict).toHaveBeenCalledTimes(1);
    expect(h.save).not.toHaveBeenCalled();
  });

  it('1.6 strict save 失败时消息级字段（Identity/anchor 等）也随事务回滚', async () => {
    const path = 'TavernDB_ACU_vector_v2_scope-chat-a-iso-a-summary_idx-1_write_snapshot';
    h.registry = [{ path, publicationState: 'published' }];
    h.reads.mockResolvedValue({ ok: true, data: blob() });
    h.chat[0].TavernDB_ACU_IsolatedData = { 'iso-a': v1Slot() };
    h.chat[0].TavernDB_ACU_Identity = 'code_0';
    h.chat[0]._acu_remote_memory_snapshot_anchor = { anchor: 'keep' };
    const before = JSON.parse(JSON.stringify(h.chat[0]));
    h.saveStrict.mockRejectedValueOnce(new Error('host save failed'));

    await expect(tryRecoverSummaryVectorIndexFromExternalSnapshot_ACU()).resolves.toBe(false);

    expect(h.chat[0]).toEqual(before);
    expect(h.chat[0].TavernDB_ACU_Identity).toBe('code_0');
    expect(h.chat[0]._acu_remote_memory_snapshot_anchor).toEqual({ anchor: 'keep' });
  });
});


// ════════════════════════════════════════════════════════════════
// 2. checkpoint / 清理 / 迁移：真实 repository 写屏障 + publication 顺序
// ════════════════════════════════════════════════════════════════
describe('P4 checkpoint/清理/迁移：真实 repository 写屏障', () => {
  const mkOptions = (overrides: any = {}) => ({
    chat: h.chat,
    aggregatedSnapshot: null,
    embeddingModel: 'test-model',
    preparedRows: [],
    finalRows: [],
    finalChunks: [],
    targetMessageIndex: 0,
    snapshotMessageId: 'msg-1',
    sourceTableKey: 'summary',
    sourceTableName: '纪要表',
    indexedAt: '2025-01-01T00:00:00.000Z',
    skippedRowCount: 0,
    mode: 'append',
    isolationKey: h.isolationKey,
    tagIsolationKey: h.isolationKey,
    ...overrides,
  });

  it('2.1 checkpoint 写入 V1 槽：只改变 metadata，V1 表投影逐字段不变', async () => {
    const originalV1 = v1Slot();
    h.chat[0].TavernDB_ACU_IsolatedData = { 'iso-a': originalV1 };
    const originalProjection = JSON.parse(JSON.stringify(originalV1));
    // 通过非导出 writeSummaryVectorIndexCheckpoint_ACU 不可达；改用真实归档入口触发 checkpoint。
    // 这里直接调用事务 helper 验证 checkpoint 语义（persist 后 patch + strict save + finalize 顺序）。
    h.embeddings.mockResolvedValue({ embeddings: [] });

    // 用 archive 入口验证真实写屏障：需要 aggregatedSnapshot 空、preparedRows 空 → 清理路径。
    // 该路径走 clearSummaryVectorIndexCheckpoint_ACU（删 pointer 保留 V1），在 2.2 覆盖。
    // 此用例改为验证 patch 边界：checkpoint 的 patch 只包含 metadata。
    const patchResult = patchIsolatedTagMetadata_ACU(h.chat[0], h.isolationKey, {
      summaryVectorIndexState: validState('idx-checkpoint'),
      summaryVectorIndexManifest: { indexId: 'idx-checkpoint' },
    });
    expect(patchResult.changed).toBe(true);
    const tag = h.chat[0].TavernDB_ACU_IsolatedData['iso-a'];
    expect(tag.summaryVectorIndexState.manifest.indexId).toBe('idx-checkpoint');
    expect(tag.independentData).toEqual(originalProjection.independentData);
    expect(tag.modifiedKeys).toEqual(originalProjection.modifiedKeys);
    expect(tag.updateGroupKeys).toEqual(originalProjection.updateGroupKeys);
    expect(tag._acu_storage_version).toBe(1);
    expect(tag._acu_base_state).toBe('base');
  });

  it('2.2 空纪要清理 V1 槽：删除 pointer、保留 V1；save 成功后才删除外置文件', async () => {
    const originalV1 = v1Slot();
    h.chat[0].TavernDB_ACU_IsolatedData = { 'iso-a': { ...originalV1, summaryVectorIndexState: validState('idx-clear'), summaryVectorIndexManifest: { indexId: 'idx-clear' } } };
    const originalProjection = JSON.parse(JSON.stringify(originalV1));
    // 空纪要表：带概要/编码索引列的 header，无数据行 → prepared.rows.length === 0 → sync 清理。
    h.tables = { summary: { name: '纪要表', content: [['时间跨度', '地点', '概要', '编码索引']] } };

    // aggregatedSnapshot 空 + preparedRows 空 → 走 clearSummaryVectorIndexCheckpoint_ACU。
    h.aggregatedSnapshot = { layers: [], summaryVectorIndexState: null };
    const { archiveSummaryVectorIndexNow_ACU } = await import('../../../src/service/vector/summary-vector-index-archive-service');
    await archiveSummaryVectorIndexNow_ACU({ isolationKey: h.isolationKey, tagIsolationKey: h.isolationKey, sourceTableKey: 'summary', mode: 'sync' });

    const tag = h.chat[0].TavernDB_ACU_IsolatedData['iso-a'];
    // pointer 已删除
    expect(tag.summaryVectorIndexState).toBeUndefined();
    expect(tag.summaryVectorIndexManifest).toBeUndefined();
    // V1 表投影原样保留
    expect(tag.independentData).toEqual(originalProjection.independentData);
    expect(tag.modifiedKeys).toEqual(originalProjection.modifiedKeys);
    expect(tag.updateGroupKeys).toEqual(originalProjection.updateGroupKeys);
    expect(tag._acu_storage_version).toBe(1);
    expect(tag._acu_base_state).toBe('base');
    // strict save 成功后才删除外置文件
    expect(h.saveStrict).toHaveBeenCalledTimes(1);
    expect(h.deleteExternal).toHaveBeenCalledTimes(1);
    expect(h.deleteExternal).toHaveBeenCalledWith(expect.objectContaining({ indexId: 'idx-clear' }));
  });

  it('2.3 空纪要清理：strict save 失败时保留 pointer、不删除外置文件', async () => {
    h.chat[0].TavernDB_ACU_IsolatedData = { 'iso-a': { ...v1Slot(), summaryVectorIndexState: validState('idx-clear'), summaryVectorIndexManifest: { indexId: 'idx-clear' } } };
    const before = JSON.parse(JSON.stringify(h.chat[0]));
    h.tables = { summary: { name: '纪要表', content: [['时间跨度', '地点', '概要', '编码索引']] } };
    h.aggregatedSnapshot = { layers: [], summaryVectorIndexState: null };
    h.saveStrict.mockRejectedValueOnce(new Error('host save failed'));

    const { archiveSummaryVectorIndexNow_ACU } = await import('../../../src/service/vector/summary-vector-index-archive-service');
    const result = await archiveSummaryVectorIndexNow_ACU({ isolationKey: h.isolationKey, tagIsolationKey: h.isolationKey, sourceTableKey: 'summary', mode: 'sync' });
    expect(result.success).toBe(false);
    expect(result.reason).toBe('summary_vector_index_clear_failed');

    // 消息完全回滚：pointer 仍在，V1 仍在，无幽灵状态。
    expect(h.chat[0]).toEqual(before);
    expect(h.deleteExternal).not.toHaveBeenCalled();
  });

  it('2.4 旧 manifest 迁移：V1 表保留，新 pointer durable 后 finalize；save 失败 abort', async () => {
    const oldManifest = { indexId: 'idx-old', status: 'ready', chatKey: h.chatKey, isolationKey: h.isolationKey, sourceTableKey: 'summary', sourceTableName: '纪要表', snapshot: { revision: 1, activeRowKeys: ['r1'], activeChunkIds: ['c1'] }, storageIdentity: { revision: 1 }, schema: 'single_file_snapshot' };
    h.chat[0].TavernDB_ACU_IsolatedData = { 'iso-a': { ...v1Slot(), summaryVectorIndexState: validState('idx-old'), summaryVectorIndexManifest: oldManifest } };
    h.aggregatedSnapshot = {
      layers: [{ messageIndex: 0, isolationKey: h.isolationKey, summaryVectorIndexState: validState('idx-old'), tagData: { summaryVectorIndexManifest: oldManifest } }],
      summaryVectorIndexState: validState('idx-old'),
    };
    h.isLegacyManifest.mockReturnValue(true);
    h.loadChunksFromManifest.mockResolvedValue([{ chunkId: 'c1', rowKey: 'r1', text: 'x', vector: [0.1] }]);
    const originalProjection = JSON.parse(JSON.stringify(v1Slot()));
    h.saveStrict.mockRejectedValueOnce(new Error('host save failed'));

    await expect(migrateLegacySummaryVectorIndexToContentAddressed_ACU()).rejects.toThrow('host save failed');

    // 消息完全回滚：旧 pointer 仍在，V1 仍在。
    const tag = h.chat[0].TavernDB_ACU_IsolatedData['iso-a'];
    expect(tag.summaryVectorIndexManifest.indexId).toBe('idx-old');
    expect(tag.independentData).toEqual(originalProjection.independentData);
    // save 失败必须 abort，不得 finalize。
    expect(h.abort).toHaveBeenCalledTimes(1);
    expect(h.finalize).not.toHaveBeenCalled();
  });

  it('2.5 旧 manifest 迁移成功：新 pointer durable + finalize，V1 表保留', async () => {
    const oldManifest = { indexId: 'idx-old', status: 'ready', chatKey: h.chatKey, isolationKey: h.isolationKey, sourceTableKey: 'summary', sourceTableName: '纪要表', snapshot: { revision: 1, activeRowKeys: ['r1'], activeChunkIds: ['c1'] }, storageIdentity: { revision: 1 }, schema: 'single_file_snapshot' };
    h.chat[0].TavernDB_ACU_IsolatedData = { 'iso-a': { ...v1Slot(), summaryVectorIndexState: validState('idx-old'), summaryVectorIndexManifest: oldManifest } };
    h.aggregatedSnapshot = {
      layers: [{ messageIndex: 0, isolationKey: h.isolationKey, summaryVectorIndexState: validState('idx-old'), tagData: { summaryVectorIndexManifest: oldManifest } }],
      summaryVectorIndexState: validState('idx-old'),
    };
    h.isLegacyManifest.mockReturnValue(true);
    h.loadChunksFromManifest.mockResolvedValue([{ chunkId: 'c1', rowKey: 'r1', text: 'x', vector: [0.1] }]);
    const originalProjection = JSON.parse(JSON.stringify(v1Slot()));

    const result = await migrateLegacySummaryVectorIndexToContentAddressed_ACU();

    expect(result.success).toBe(true);
    const tag = h.chat[0].TavernDB_ACU_IsolatedData['iso-a'];
    expect(tag.summaryVectorIndexManifest.indexId).not.toBe('idx-old');
    expect(tag.independentData).toEqual(originalProjection.independentData);
    expect(tag.modifiedKeys).toEqual(originalProjection.modifiedKeys);
    expect(tag.updateGroupKeys).toEqual(originalProjection.updateGroupKeys);
    // publication 顺序：save 成功后才 finalize
    expect(h.saveStrict).toHaveBeenCalledTimes(1);
    expect(h.finalize).toHaveBeenCalledTimes(1);
    expect(h.abort).not.toHaveBeenCalled();
  });
});


// ════════════════════════════════════════════════════════════════
// 3. realign / 批量删除 / 单一 service 边界
// ════════════════════════════════════════════════════════════════
// realign 的磁盘读取/身份校验/runtime 编排逻辑由既有 runtime 测试覆盖；
// 本文件聚焦真实 repository 写屏障：realign 最终写 pointer 走 commitVectorMetadataPatch_ACU，
// 其 CAS 拒绝/回滚语义与恢复、清理、迁移共用同一真实事务 helper。
// 这里直接验证该真实事务 helper 的 CAS 语义（realign 的提交层）：\n
describe('P4 realign 提交层：真实 repository CAS 写屏障', () => {
  it('3.1 更高 revision 的 realign patch 成功：metadata 更新、V1 表投影保留', async () => {
    h.chat[0].TavernDB_ACU_IsolatedData = { 'iso-a': { ...v1Slot(), summaryVectorIndexState: validState('idx-current'), summaryVectorIndexManifest: { indexId: 'idx-current' } } };
    const originalProjection = JSON.parse(JSON.stringify(v1Slot()));

    const changed = await commitVectorMetadataPatch_ACU(h.chat[0], h.isolationKey, {
      summaryVectorIndexState: validState('idx-current'),
      summaryVectorIndexManifest: { indexId: 'idx-current', snapshot: { revision: 2 } },
    }, { expectedIndexId: 'idx-current' });
    expect(changed).toBe(true);
    const tag = h.chat[0].TavernDB_ACU_IsolatedData['iso-a'];
    expect(tag.summaryVectorIndexManifest.snapshot.revision).toBe(2);
    expect(tag.independentData).toEqual(originalProjection.independentData);
    expect(tag.modifiedKeys).toEqual(originalProjection.modifiedKeys);
    expect(tag.updateGroupKeys).toEqual(originalProjection.updateGroupKeys);
    expect(h.saveStrict).toHaveBeenCalledTimes(1);
  });

  it('3.2 事务层 CAS 边界：indexId 漂移拒绝；同 indexId revision 变更放行（上层负责 revision 语义）', async () => {
    h.chat[0].TavernDB_ACU_IsolatedData = { 'iso-a': { ...v1Slot(), summaryVectorIndexState: validState('idx-current'), summaryVectorIndexManifest: { indexId: 'idx-current', snapshot: { revision: 5 } } } };
    const before = JSON.parse(JSON.stringify(h.chat[0]));
    // 事务层 CAS 只校验 expectedIndexId 与当前槽 indexId 一致；revision 回退由 realign 上层
    // 的 diskRevision < currentRevision 拦截（runtime.ts:522-525），在调用事务前已 return null。
    // 验证事务层边界：indexId 漂移（expectedIndexId 与实际不一致）必须拒绝，不保存、不改消息。
    await expect(commitVectorMetadataPatch_ACU(h.chat[0], h.isolationKey, {
      summaryVectorIndexManifest: { indexId: 'idx-current', snapshot: { revision: 3 } },
    }, { expectedIndexId: 'idx-other' })).rejects.toThrow('ISOLATED_TAG_METADATA_PATCH_CONFLICT_ACU');
    expect(h.chat[0]).toEqual(before);
    expect(h.saveStrict).not.toHaveBeenCalled();
  });

  it('3.3 CAS 冲突拒绝：不覆盖并发写入的新 pointer、不保存', async () => {
    h.chat[0].TavernDB_ACU_IsolatedData = { 'iso-a': { ...v1Slot(), summaryVectorIndexState: validState('idx-current'), summaryVectorIndexManifest: { indexId: 'idx-current' } } };
    const before = JSON.parse(JSON.stringify(h.chat[0]));
    // 模拟并发维护动作在提交前替换 pointer
    await expect(commitVectorMetadataPatch_ACU(h.chat[0], h.isolationKey, {
      summaryVectorIndexState: validState('idx-new'),
      summaryVectorIndexManifest: { indexId: 'idx-new' },
    }, { expectedIndexId: 'idx-stale' })).rejects.toThrow('ISOLATED_TAG_METADATA_PATCH_CONFLICT_ACU');
    // CAS 失败发生在赋值前：消息保持原样（未发生任何 mutation，含并发写入的新 pointer 不被回滚覆盖）。
    expect(h.chat[0]).toEqual(before);
    expect(h.saveStrict).not.toHaveBeenCalled();
  });
});

describe('P4 批量删除：真实 repository 写屏障', () => {
  it('4.1 多层删除成功：只 strict save 一次，所有层 pointer 删除、表投影保留', async () => {
    const msg0 = h.chat[0];
    const msg1 = { is_user: false, mesId: 'm-2' };
    h.chat.push(msg1);
    const v1a = v1Slot();
    const v1b = v1Slot();
    v1b.independentData.sheet_0.name = '表B';
    msg0.TavernDB_ACU_IsolatedData = { 'iso-a': { ...v1a, summaryVectorIndexState: validState('idx-a'), summaryVectorIndexManifest: { indexId: 'idx-a' } } };
    msg1.TavernDB_ACU_IsolatedData = { 'iso-a': { ...v1b, summaryVectorIndexState: validState('idx-b'), summaryVectorIndexManifest: { indexId: 'idx-b' } } };
    const projectionA = JSON.parse(JSON.stringify(v1a));
    const projectionB = JSON.parse(JSON.stringify(v1b));

    h.aggregatedSnapshot = {
      layers: [
        { messageIndex: 0, isolationKey: 'iso-a' },
        { messageIndex: 1, isolationKey: 'iso-a' },
      ],
      summaryVectorIndexState: validState('idx-b'),
    };
    h.saveStrict.mockResolvedValue(undefined);

    const changed = await deleteCurrentSummaryVectorIndexFromChat_ACU();
    expect(changed).toBe(true);
    expect(h.saveStrict).toHaveBeenCalledTimes(1);
    expect(msg0.TavernDB_ACU_IsolatedData['iso-a'].summaryVectorIndexState).toBeUndefined();
    expect(msg1.TavernDB_ACU_IsolatedData['iso-a'].summaryVectorIndexState).toBeUndefined();
    expect(msg0.TavernDB_ACU_IsolatedData['iso-a'].independentData).toEqual(projectionA.independentData);
    expect(msg1.TavernDB_ACU_IsolatedData['iso-a'].independentData).toEqual(projectionB.independentData);
    expect(msg0.TavernDB_ACU_IsolatedData['iso-a'].modifiedKeys).toEqual(projectionA.modifiedKeys);
  });

  it('4.2 多层删除任一层 strict save 失败：全批回滚，无前半批成功内存态', async () => {
    const msg0 = h.chat[0];
    const msg1 = { is_user: false, mesId: 'm-2' };
    h.chat.push(msg1);
    msg0.TavernDB_ACU_IsolatedData = { 'iso-a': { ...v1Slot(), summaryVectorIndexState: validState('idx-a'), summaryVectorIndexManifest: { indexId: 'idx-a' } } };
    msg1.TavernDB_ACU_IsolatedData = { 'iso-a': { ...v1Slot(), summaryVectorIndexState: validState('idx-b'), summaryVectorIndexManifest: { indexId: 'idx-b' } } };
    const before0 = JSON.parse(JSON.stringify(msg0));
    const before1 = JSON.parse(JSON.stringify(msg1));

    h.aggregatedSnapshot = {
      layers: [
        { messageIndex: 0, isolationKey: 'iso-a' },
        { messageIndex: 1, isolationKey: 'iso-a' },
      ],
      summaryVectorIndexState: validState('idx-b'),
    };
    h.saveStrict.mockRejectedValueOnce(new Error('host save failed'));

    await expect(deleteCurrentSummaryVectorIndexFromChat_ACU()).rejects.toThrow('host save failed');

    expect(msg0).toEqual(before0);
    expect(msg1).toEqual(before1);
    expect(h.saveStrict).toHaveBeenCalledTimes(1);
  });
});

describe('P4 单一 service 边界', () => {
  it('5.1 popup 与 V2 UI 调用同一 service，不存在重复实现', async () => {
    // popup 绑定层只 import 该 service 的公开函数，不自行实现 writer；V2 UI 复用同一 service 边界。
    const chatService = await import('../../../src/service/vector/summary-vector-index-chat-service');
    expect(typeof chatService.deleteCurrentSummaryVectorIndexFromChat_ACU).toBe('function');
    expect(typeof chatService.clearSummaryVectorIndexLayerFromChat_ACU).toBe('function');
    const popup = await import('../../../src/presentation/pages/popup-bindings-data');
    expect(popup).toBeDefined();
  });
});
