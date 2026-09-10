import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  chat: [] as any[], table: null as any, isolationKey: 'race',
  embeddingStarted: null as any, releaseEmbedding: null as any,
  saveStrict: vi.fn(), finalize: vi.fn(), persistPack: vi.fn(), persistManifest: vi.fn(),
  resolveHead: vi.fn(), loadPack: vi.fn(),
}));
const deferred = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((done) => { resolve = done; });
  return { promise, resolve };
};

vi.mock('../../../src/service/runtime/state-manager', () => ({
  currentChatFileIdentifier_ACU: 'mirror-race-chat',
  getCurrentIsolationKey_ACU: () => h.isolationKey,
  get currentJsonTableData_ACU() { return { sheet_summary: h.table }; },
}));
vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: () => h.chat,
  saveChatToHostStrict_ACU: (...args: any[]) => h.saveStrict(...args),
}));
vi.mock('../../../src/data/gateways/vector-embedding-gateway', () => ({
  createEmbeddings_ACU: async (request: any) => {
    h.embeddingStarted.resolve();
    await h.releaseEmbedding.promise;
    return request.input.map((_: string, index: number) => ({ index, embedding: [index + 1, 2] }));
  },
  isVectorEmbeddingError_ACU: () => false,
}));
vi.mock('../../../src/shared/utils', () => ({
  hashUserInput_ACU: () => 'fingerprint', isSummaryOrOutlineTable_ACU: () => true,
  logDebug_ACU: vi.fn(), logWarn_ACU: vi.fn(),
}));
vi.mock('../../../src/service/vector/vector-memory-config', () => ({
  getEffectiveSummaryVectorIndexConfig_ACU: () => ({
    embeddingEndpoint: 'https://embedding.test', embeddingApiKey: 'key', embeddingModel: 'model', embeddingDimension: 2,
    summaryIndexChunkSentenceCount: 1, summaryIndexChunkChronicleBySentence: false,
    summaryIndexArchiveMaxConcurrency: 10, summaryIndexArchiveMaxInputChars: 24000, summaryIndexArchiveEmbeddingConcurrency: 1,
  }),
  validateSummaryVectorIndexConfig_ACU: () => ({ valid: true, errors: [] }),
}));
vi.mock('../../../src/service/vector/summary-vector-index-archive-service', () => ({
  findSummaryTable_ACU: () => ({ summaryKey: 'sheet_summary', table: h.table }),
  buildPreparedRows_ACU: () => ({ rows: [{ rowId: 'r1', vectorSourceText: 'race source', vectorSourceHash: 'hash-r1' }], skippedRowCount: 0, error: '' }),
  buildRowChunkTexts_ACU: (text: string) => [text],
}));
vi.mock('../../../src/service/table/summary-sheet-rowid-timeline', () => ({
  collectSummarySheetRowIdTimelineV2_ACU: async () => ({ status: 'ok', rowIdsAtCheckpoint: [], entries: [{ messageIndex: 0, entryId: 'table-entry', commitRevision: 'r1', seq: 1, rowIdsAfter: ['r1'] }], duplicates: [], emptyRowIdCount: 0 }),
}));

vi.mock('../../../src/service/vector/summary-vector-mirror-resolver', () => ({
  resolveSummaryVectorMirrorHead_ACU: (...args: any[]) => h.resolveHead(...args),
  summaryVectorEmbeddingIdentityEquals_ACU: () => true,
  locateSummaryVectorMirrorBase_ACU: () => ({ messageIndex: 0, frame: h.chat[0].TavernDB_ACU_IsolatedData[h.isolationKey].storageFrame }),
  collectSummaryVectorMirrorFrameRefs_ACU: () => [{ frame: h.chat[0].TavernDB_ACU_IsolatedData[h.isolationKey].storageFrame }],
  assertSummaryVectorMirrorFrameInvariantsV2_ACU: () => null,
  isSummaryVectorEmbeddingIdentity_ACU: () => true,
  computeSummaryVectorMirrorCheckpointRevision_ACU: () => 'revision',
}));
vi.mock('../../../src/service/vector/summary-vector-mirror-storage', () => ({
  encodeSummaryVectorMirrorVector_ACU: () => 'encoded',
  finalizeSummaryVectorMirrorFiles_ACU: (...args: any[]) => h.finalize(...args),
  loadSummaryVectorMirrorManifest_ACU: async () => null,
  loadSummaryVectorMirrorPack_ACU: (...args: any[]) => h.loadPack(...args),
  persistSummaryVectorMirrorPackPrepared_ACU: (...args: any[]) => h.persistPack(...args),
  persistSummaryVectorMirrorManifestPrepared_ACU: (...args: any[]) => h.persistManifest(...args),
}));
vi.mock('../../../src/service/vector/summary-vector-index-chat-deletion-gc', () => ({ runScopedRetentionGcAfterFlush_ACU: async () => undefined }));

import { _resetTableWriteTransactionLocksForTest_ACU, runTableWriteTransaction_ACU } from '../../../src/service/table/table-write-transaction';
import { flushSummaryVectorMirrorNow_ACU } from '../../../src/service/vector/summary-vector-mirror-writer';
import {
  publishSummaryVectorMirrorRowRemovalSnapshot_ACU,
  rebuildSummaryVectorMirror_ACU,
} from '../../../src/service/vector/summary-vector-mirror-rebuild';

function resetFixture() {
  _resetTableWriteTransactionLocksForTest_ACU();
  h.embeddingStarted = deferred();
  h.releaseEmbedding = deferred();
  h.table = { name: '纪要表', content: [['row_id', '概要'], ['r1', 'before']] };
  h.chat.length = 0;
  h.chat.push({ is_user: false, TavernDB_ACU_IsolatedData: { [h.isolationKey]: {
    _acu_storage_version: 2,
    storageFrame: { version: 2, checkpoint: { kind: 'full', createdAt: 1, reason: 'test', data: { sheet_summary: h.table } }, logEntries: [{ entryId: 'table-entry' }] },
  } } });
  h.saveStrict.mockReset(); h.saveStrict.mockResolvedValue(undefined);
  h.finalize.mockReset(); h.finalize.mockResolvedValue(undefined);
  h.persistPack.mockReset(); h.persistPack.mockResolvedValue({ ref: { packHash: 'pack', path: 'pack-path', chunkCount: 1, byteLength: 1 }, file: { path: 'pack-path', byteSize: 1 } });
  h.persistManifest.mockReset(); h.persistManifest.mockResolvedValue({ ref: { manifestHash: 'manifest', path: 'manifest-path', byteLength: 1 }, file: { path: 'manifest-path', byteSize: 1 } });
  h.resolveHead.mockReset(); h.resolveHead.mockResolvedValue({ status: 'ok', chainConflict: false, stale: false, head: new Map(), appliedTableEntryIds: [], packRefs: [], checkpoint: { embedding: { endpointFingerprint: 'fingerprint', model: 'model', dimension: 2, sourceTextVersion: 2 } } });
  h.loadPack.mockReset(); h.loadPack.mockResolvedValue(null);
}

async function changeSourceTableDuringEmbedding() {
  await runTableWriteTransaction_ACU({
    source: 'manual_crud', reason: 'race source edit', isolationKey: h.isolationKey,
    writeSet: [{ kind: 'sheet', sheetKey: 'sheet_summary' }], workingDataMode: 'none',
  }, async (ctx) => {
    await ctx.runCommit(() => { h.table.content[1][1] = 'after'; });
  });
}

async function expectStalePublicationBlocked(start: () => Promise<any>, reason: string) {
  const resultPromise = start();
  await h.embeddingStarted.promise;
  await changeSourceTableDuringEmbedding();
  h.releaseEmbedding.resolve();
  const result = await resultPromise;
  expect(result).toMatchObject({ success: false, reason });
  expect(result.errors.join('\n')).toMatch(/runtime revision conflict/i);
  expect(h.saveStrict).not.toHaveBeenCalled();
  expect(h.finalize).not.toHaveBeenCalled();
}

describe('summary vector mirror revision race', () => {
  beforeEach(resetFixture);

  it('flush 在 embedding 等待期间同表源写入后拒绝过期 delta', async () => {
    await expectStalePublicationBlocked(() => flushSummaryVectorMirrorNow_ACU({ isolationKey: h.isolationKey, sourceTableKey: 'sheet_summary' }), 'vector_mirror_commit_failed');
  });

  it('rebuild 在 embedding 等待期间同表源写入后拒绝过期 checkpoint', async () => {
    await expectStalePublicationBlocked(() => rebuildSummaryVectorMirror_ACU({ reason: 'initial' }), 'rebuild_commit_failed');
  });

  it.each([
    ['flush', () => flushSummaryVectorMirrorNow_ACU({ isolationKey: h.isolationKey, sourceTableKey: 'sheet_summary' }), 'vector_mirror_commit_failed'],
    ['rebuild', () => rebuildSummaryVectorMirror_ACU({ reason: 'initial' }), 'rebuild_commit_failed'],
  ])('%s 的 strict save 失败会恢复原始镜像 frame', async (_name, start, reason) => {
    h.releaseEmbedding.resolve();
    const before = JSON.parse(JSON.stringify(h.chat[0].TavernDB_ACU_IsolatedData));
    h.saveStrict.mockRejectedValueOnce(new Error('strict save failed'));

    await expect(start()).resolves.toMatchObject({ success: false, reason });

    expect(h.chat[0].TavernDB_ACU_IsolatedData).toEqual(before);
    expect(h.finalize).not.toHaveBeenCalled();
  });

  it('rebuild_repair 保留实际复用 pack 的 checkpoint 可达引用', async () => {
    const oldPack = { packHash: 'old-pack', path: 'old-pack-path', chunkCount: 1, byteLength: 9 };
    h.resolveHead.mockResolvedValue({
      status: 'ok', chainConflict: false, stale: false,
      head: new Map([['r1', [{ packHash: 'old-pack', chunkIndex: 0 }]]]),
      appliedTableEntryIds: [], packRefs: [oldPack],
      checkpoint: { embedding: { endpointFingerprint: 'fingerprint', model: 'model', dimension: 2, sourceTextVersion: 2 } },
    });
    h.loadPack.mockResolvedValue({ chunks: [{}] });
    const checkpointPackRefs: any[] = [];
    h.saveStrict.mockImplementation(async () => {
      checkpointPackRefs.push(...(h.chat[0].TavernDB_ACU_IsolatedData[h.isolationKey].storageFrame.summaryVectorIndexFrame?.checkpoint?.packRefs || []));
    });

    await expect(rebuildSummaryVectorMirror_ACU({ reason: 'rebuild_repair' })).resolves.toMatchObject({ success: true });

    expect(h.persistPack).not.toHaveBeenCalled();
    expect(checkpointPackRefs).toContainEqual(oldPack);
  });

  it('row-removal publish 的 strict save 失败会恢复已有镜像 frame', async () => {
    h.releaseEmbedding.resolve();
    h.chat[0].TavernDB_ACU_IsolatedData[h.isolationKey].storageFrame.summaryVectorIndexFrame = {
      version: 3, sourceTableKey: 'sheet_summary', checkpoint: { retained: true }, logEntries: [],
    };
    const before = JSON.parse(JSON.stringify(h.chat[0].TavernDB_ACU_IsolatedData));
    h.saveStrict.mockRejectedValueOnce(new Error('strict save failed'));

    await expect(publishSummaryVectorMirrorRowRemovalSnapshot_ACU({
      kind: 'ready', sourceTableKey: 'sheet_summary',
      embedding: { endpointFingerprint: 'fingerprint', model: 'model', dimension: 2, sourceTextVersion: 2 },
      rows: [{ rowId: 'r1', chunks: [{ packHash: 'old-pack', chunkIndex: 0 }] }],
      packRefs: [{ packHash: 'old-pack', path: 'old-pack-path', chunkCount: 1, byteLength: 9 }],
    })).resolves.toMatchObject({ success: false, reason: 'rebuild_commit_failed' });

    expect(h.chat[0].TavernDB_ACU_IsolatedData).toEqual(before);
    expect(h.finalize).not.toHaveBeenCalled();
  });

  it('row-removal publish 在 pack 引用不闭合时不上传 manifest 或改写聊天', async () => {
    const before = JSON.parse(JSON.stringify(h.chat[0].TavernDB_ACU_IsolatedData));

    await expect(publishSummaryVectorMirrorRowRemovalSnapshot_ACU({
      kind: 'ready', sourceTableKey: 'sheet_summary',
      embedding: { endpointFingerprint: 'fingerprint', model: 'model', dimension: 2, sourceTextVersion: 2 },
      rows: [{ rowId: 'r1', chunks: [{ packHash: 'missing-pack', chunkIndex: 0 }] }],
      packRefs: [],
    })).resolves.toMatchObject({ success: false, reason: 'rebuild_repair_pack_reference_missing' });

    expect(h.persistManifest).not.toHaveBeenCalled();
    expect(h.saveStrict).not.toHaveBeenCalled();
    expect(h.chat[0].TavernDB_ACU_IsolatedData).toEqual(before);
  });
});
