import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  chat: [{ is_user: true, mes: 'latest user' } as any],
  config: {} as any,
  rows: [] as any[],
  chunks: [] as any[],
  entries: [] as any[],
  createEmbeddings: vi.fn(),
  callAI: vi.fn(),
  setEntries: vi.fn(),
  createEntries: vi.fn(),
  loadChunks: vi.fn(),
  clearMissing: vi.fn(),
  clearInvalid: vi.fn(),
  enqueueFlush: vi.fn(),
  missingError: false,
  invalidError: false,
  summaryTable: null as any,
  preparedRows: [] as any[],
  snapshot: null as any,
  registry: [] as any[],
  readSnapshot: vi.fn(),
  validateSnapshot: vi.fn(),
  saveChatStrict: vi.fn(),
  tagData: null as any,
  writeTagData: vi.fn(),
}));

vi.mock('../../../src/shared/utils', () => ({ logDebug_ACU: vi.fn(), logWarn_ACU: vi.fn(), logError_ACU: vi.fn() }));
vi.mock('../../../src/service/chat/chat-service', () => ({ getChatArray_ACU: () => h.chat }));
vi.mock('../../../src/data/gateways/chat-gateway', () => ({ saveChatToHostStrict_ACU: (...a: any[]) => h.saveChatStrict(...a) }));
vi.mock('../../../src/data/repositories/chat-message-data-repo', () => ({
  readIsolatedTagData_ACU: () => h.tagData,
  readIsolatedDataContainer_ACU: (msg: any) => {
    if (!msg || typeof msg.TavernDB_ACU_IsolatedData !== 'object' || Array.isArray(msg.TavernDB_ACU_IsolatedData)) return null;
    return msg.TavernDB_ACU_IsolatedData;
  },
  patchIsolatedTagMetadata_ACU: (msg: any, isolationKey: string, patch: Record<string, any>, options?: { expectedIndexId?: string }) => {
    if (!msg) return { changed: false, tagData: null };
    const container = msg.TavernDB_ACU_IsolatedData && typeof msg.TavernDB_ACU_IsolatedData === 'object'
      ? msg.TavernDB_ACU_IsolatedData
      : {};
    const current = container[isolationKey] || {};
    if (options?.expectedIndexId != null) {
      const currentId = current.summaryVectorIndexManifest?.indexId ?? current.summaryVectorIndexState?.manifest?.indexId ?? current.summaryVectorIndexState?.indexId;
      if (String(currentId || '') !== String(options.expectedIndexId)) {
        const error = new Error('ISOLATED_TAG_METADATA_PATCH_CONFLICT_ACU');
        (error as any).code = 'ISOLATED_TAG_METADATA_PATCH_CONFLICT_ACU';
        throw error;
      }
    }
    const next = { ...current };
    for (const [key, value] of Object.entries(patch || {})) {
      if (value === undefined) continue;
      if (value === null) delete next[key];
      else next[key] = value;
    }
    const nextContainer = { ...container, [isolationKey]: next };
    msg.TavernDB_ACU_IsolatedData = nextContainer;
    return { changed: true, tagData: next };
  },
  cloneIsolatedData_ACU: (msg: any) => JSON.parse(JSON.stringify(msg?.TavernDB_ACU_IsolatedData || {})),
  writeIsolatedTagData_ACU: (...a: any[]) => h.writeTagData(...a),
}));
vi.mock('../../../src/data/storage/vector-index-st-files-storage', () => ({
  loadVectorIndexRegistry_ACU: async () => ({ files: h.registry }),
  readVectorIndexJsonFile_ACU: (...a: any[]) => h.readSnapshot(...a),
}));
vi.mock('../../../src/service/ai/api-call', () => ({callAIWithPreset_ACU: (...a: any[]) => h.callAI(...a) }));
vi.mock('../../../src/data/gateways/vector-embedding-gateway', () => ({ createEmbeddings_ACU: (...a: any[]) => h.createEmbeddings(...a) }));
vi.mock('../../../src/service/settings/settings-readers', () => ({ getCurrentWorldbookConfig_ACU: () => ({ zeroTkOccupyMode: false, summaryVectorIndexModeEnabled: true }) }));
vi.mock('../../../src/data/repositories/profile-repo', () => ({ globalMeta_ACU: { summaryVectorIndexModeGlobal: true } }));
vi.mock('../../../src/service/worldbook/injection-engine', () => ({ getInjectionTargetLorebook_ACU: async () => 'book', getIsolationPrefix_ACU: () => '' }));
vi.mock('../../../src/service/worldbook/worldbook-service', () => ({
  isWorldbookApiAvailable_ACU: () => true,
  getLorebookEntries_ACU: async () => h.entries,
  setLorebookEntries_ACU: (...a: any[]) => h.setEntries(...a),
  createLorebookEntries_ACU: (...a: any[]) => h.createEntries(...a),
}));
vi.mock('../../../src/service/vector/vector-memory-config', () => ({
  getEffectiveSummaryVectorIndexConfig_ACU: () => h.config,
  validateSummaryVectorIndexConfig_ACU: () => ({ valid: true, errors: [] }),
}));
vi.mock('../../../src/service/vector/summary-vector-index-state-service', () => ({
  getLatestSummaryVectorIndexSnapshotState_ACU: () => h.snapshot || ({
    summaryVectorIndexState: { rows: h.rows, chunks: h.chunks, manifest: { indexId: 'idx', sourceTableKey: 'summary-source', snapshot: { activeRowKeys: h.rows.map((r) => r.rowKey) } } },
    layers: [{ messageIndex: 0, isolationKey: 'iso-source', summaryVectorIndexState: { manifest: { indexId: 'idx', sourceTableKey: 'summary-source' } } }],
  }),
  assignSummaryVectorIndexStateToTagData_ACU: (tagData: any, state: any, manifest: any) => { tagData.summaryVectorIndexState = state; tagData.summaryVectorIndexManifest = manifest; },
}));
vi.mock('../../../src/service/vector/summary-vector-index-archive-service', () => ({
  findSummaryTable_ACU: () => h.summaryTable,
  // 真实契约返回 { rows, skippedRowCount, error }；此前 mock 直接返回数组导致
  // buildLiveSummaryVectorRows_ACU 取 prepared.rows 恒为 undefined → live 表恒空 →
  // 只要 summaryTable 非 null 就恒判 stale，对账分支从未被真实测试。
  buildPreparedRows_ACU: () => ({ rows: h.preparedRows, skippedRowCount: 0, error: '' }),
}));
vi.mock('../../../src/service/vector/summary-vector-index-storage-service', () => ({
  loadSummaryVectorIndexChunksFromManifest_ACU: (...a: any[]) => h.loadChunks(...a),
  logSummaryVectorIndexIdentityEvent_ACU: vi.fn(),
  validateSingleFileSnapshotIdentity_ACU: (...a: any[]) => h.validateSnapshot(...a),
}));
vi.mock('../../../src/service/vector/summary-vector-index-cache-service', () => ({
  clearLatestSummaryVectorIndexStateForInvalidExternalFiles_ACU: (...a: any[]) => h.clearInvalid(...a),
  clearLatestSummaryVectorIndexStateForMissingExternalFiles_ACU: (...a: any[]) => h.clearMissing(...a),
  isInvalidExternalVectorFileError_ACU: () => h.invalidError,
  isMissingExternalVectorFileError_ACU: () => h.missingError,
}));
vi.mock('../../../src/service/vector/summary-vector-index-flush-queue', () => ({
  enqueueSummaryVectorIndexFlush_ACU: (...a: any[]) => h.enqueueFlush(...a),
}));
// P3：runtime 去重签名使用 currentChatFileIdentifier_ACU，mock 掉 state-manager
// 避免加载真实的重量级运行时状态模块。
vi.mock('../../../src/service/runtime/state-manager', () => ({
  currentChatFileIdentifier_ACU: 'chat-a',
}));

import {
  processSummaryVectorIndexBeforeGeneration_ACU,
  resetSummaryVectorIndexRuntimeDedupeState_ACU,
} from '../../../src/service/vector/summary-vector-index-runtime';


function row_ACU(key: string, order: number, summary: string): any {
  return {
    rowKey: key,
    rowOrder: order,
    timeSpan: `t-${order}`,
    location: `loc-${order}`,
    summary,
    indexCode: `IDX-${order}`,
    status: 'active',
  };
}

function chunk_ACU(row: any, text: string, vector: number[] = [0, 1]): any {
  return {
    chunkId: `chunk-${row.rowKey}`,
    rowKey: row.rowKey,
    sequence: 0,
    text,
    textHash: `hash-${row.rowKey}`,
    vector,
  };
}

function defaultConfig_ACU(overrides: Record<string, any> = {}): any {
  return {
    embeddingEndpoint: 'https://embedding.test',
    embeddingApiKey: 'key',
    embeddingModel: 'model',
    keywordContextPairCount: 1,
    keywordPromptGroup: [],
    keywordGenerationMaxAttempts: 1,
    keywordApiPreset: '',
    summaryIndexKeywordMinRows: 1,
    summaryIndexRecentFixedInjectCount: 0,
    summaryIndexMinScore: 0.95,
    summaryIndexCandidateLimit: 10,
    summaryIndexHybridRetrievalEnabled: true,
    summaryIndexBm25CandidateLimit: 10,
    summaryIndexRrfK: 60,
    topK: 10,
    rerankEndpoint: '',
    rerankModel: '',
    rerankApiKey: '',
    rerankInstruction: '',
    ...overrides,
  };
}

function createdContent_ACU(): string {
  return String(h.createEntries.mock.calls.at(-1)?.[1]?.[0]?.content || '');
}

function setFixture_ACU(overrides: Record<string, any> = {}): void {
  const oldRow = row_ACU('old', 1, 'old sparse summary');
  const denseRow = row_ACU('dense', 2, 'dense summary');
  const recentRow = row_ACU('recent', 3, 'recent fixed summary');
  h.rows = [oldRow, denseRow, recentRow];
  h.chunks = [
    chunk_ACU(oldRow, 'ancient secret relic under bridge', [0, 1]),
    chunk_ACU(denseRow, 'unrelated dense vector row', [1, 0]),
    chunk_ACU(recentRow, 'secret relic but recent row must be fixed only', [0, 1]),
  ];
  h.config = defaultConfig_ACU(overrides);
}


describe('processSummaryVectorIndexBeforeGeneration_ACU hybrid retrieval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSummaryVectorIndexRuntimeDedupeState_ACU();
    h.chat = [{ is_user: true, mes: 'latest user' } as any];
    h.entries = [];
    h.callAI.mockResolvedValue('<keywords>secret relic</keywords>');
    h.createEmbeddings.mockResolvedValue([{ index: 0, embedding: [1, 0] }]);
    h.createEntries.mockResolvedValue(undefined);
    h.setEntries.mockResolvedValue(undefined);
    h.loadChunks.mockImplementation(async () => h.chunks);
    h.clearMissing.mockResolvedValue(true);
    h.clearInvalid.mockResolvedValue({ chatStateCleared: true, cacheCleared: true, flushTaskCountCleared: 1 });
    h.enqueueFlush.mockResolvedValue({ queued: true, scopeKey: 'scope', debounceUntil: Date.now() });
    h.missingError = false;
    h.invalidError = false;
    h.summaryTable = null;
    h.preparedRows = [];
    h.snapshot = null;
    h.registry = [];
    h.readSnapshot.mockReset();
    h.validateSnapshot.mockReset();
    h.saveChatStrict.mockResolvedValue(undefined);
    h.tagData = {};
    h.writeTagData.mockReset();
    vi.stubGlobal('fetch', vi.fn());
    setFixture_ACU();
  });

  it('hybrid 开启时 BM25 能补足 dense 阈值过滤掉的候选', async () => {
    h.config.summaryIndexMinScore = 0.95;
    h.config.summaryIndexRecentFixedInjectCount = 0;

    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'find secret relic', source: 'hybrid-bm25' });

    expect(result.success).toBe(true);
    expect(result.denseCandidateCount).toBe(1);
    expect(result.sparseCandidateCount).toBeGreaterThanOrEqual(1);
    expect(result.fusionCandidateCount).toBeGreaterThanOrEqual(2);
    const content = createdContent_ACU();
    expect(content).toContain('old sparse summary');
    expect(content).toContain('dense summary');
  });

  it('hybrid 关闭时保持纯 dense 路径，不注入 BM25-only 候选', async () => {
    h.config.summaryIndexHybridRetrievalEnabled = false;
    h.config.summaryIndexMinScore = 0.95;

    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'find secret relic', source: 'dense-only' });

    expect(result.success).toBe(true);
    expect(result.sparseCandidateCount).toBe(0);
    expect(result.fusionCandidateCount).toBe(1);
    const content = createdContent_ACU();
    expect(content).not.toContain('old sparse summary');
    expect(content).toContain('dense summary');
  });

  it('dense 为空但 BM25 命中时不跳过并正常注入', async () => {
    h.chunks = h.chunks.map((chunk: any) => ({ ...chunk, vector: [0, 1] }));
    h.config.summaryIndexMinScore = 0.95;

    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'secret relic', source: 'sparse-only' });

    expect(result.success).toBe(true);
    expect(result.denseCandidateCount).toBe(0);
    expect(result.sparseCandidateCount).toBeGreaterThanOrEqual(1);
    expect(createdContent_ACU()).toContain('old sparse summary');
  });

  it('最近固定行不参与候选池，但最终合并进覆盖内容', async () => {
    h.config.summaryIndexRecentFixedInjectCount = 1;
    h.config.topK = 1;
    h.chunks = [
      h.chunks[0],
      { ...h.chunks[1], text: 'plain dense vector row', vector: [0, 1] },
      h.chunks[2],
    ];

    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'secret relic', source: 'recent-fixed' });

    expect(result.success).toBe(true);
    expect(result.injectedCount).toBe(2);
    const content = createdContent_ACU();
    expect(content).toContain('old sparse summary');
    expect(content).toContain('recent fixed summary');
  });

  it('实时纪要表纯新增行时同样判定索引过期，不使用缺行的旧索引', async () => {
    h.summaryTable = { summaryKey: 'summary-source', table: {} };
    h.preparedRows = [
      ...h.rows.map((row: any) => ({ rowKey: row.rowKey })),
      { rowKey: 'new-row', sourceFingerprint: 'new-row-fingerprint' },
    ];

    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'secret relic', source: 'stale-runtime-added-row' });

    expect(result).toMatchObject({
      success: false,
      skipped: true,
      reason: 'runtime_stale_rows_rebuild_required',
    });
    expect(h.createEmbeddings).not.toHaveBeenCalled();
    expect(h.enqueueFlush).not.toHaveBeenCalled();
  });

  it('实时纪要表与索引不一致时交由 UI 走立即构建入口，不再绕过普通重建链路入队', async () => {
    h.summaryTable = { summaryKey: 'summary-source', table: {} };
    h.preparedRows = [
      { rowKey: 'dense', sourceFingerprint: 'changed-dense' },
      { rowKey: 'recent', sourceFingerprint: 'changed-recent' },
    ];

    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'secret relic', source: 'stale-runtime' });

    expect(result).toMatchObject({
      success: false,
      skipped: true,
      reason: 'runtime_stale_rows_rebuild_required',
    });
    expect(h.enqueueFlush).not.toHaveBeenCalled();
  });

  it('rowKey 集合相同但某行内容指纹不同（只改概要文本）时 fail-closed 拒绝注入旧文本', async () => {
    // 修复前该场景被静默放行：索引行不带 sourceFingerprint，对账退化为纯 rowKey 比对。
    h.rows = h.rows.map((row: any) => ({ ...row, sourceFingerprint: `fp-${row.rowKey}` }));
    h.summaryTable = { summaryKey: 'summary-source', table: {} };
    h.preparedRows = h.rows.map((row: any) => ({
      rowKey: row.rowKey,
      sourceFingerprint: row.rowKey === 'dense' ? 'fp-dense-edited' : row.sourceFingerprint,
    }));

    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'secret relic', source: 'fingerprint-mismatch' });

    expect(result).toMatchObject({
      success: false,
      skipped: true,
      reason: 'runtime_stale_rows_rebuild_required',
    });
    expect(h.createEmbeddings).not.toHaveBeenCalled();
  });

  it('rowKey 集合与内容指纹全部一致时对账通过，正常召回注入', async () => {
    h.rows = h.rows.map((row: any) => ({ ...row, sourceFingerprint: `fp-${row.rowKey}` }));
    h.summaryTable = { summaryKey: 'summary-source', table: {} };
    h.preparedRows = h.rows.map((row: any) => ({
      rowKey: row.rowKey,
      sourceFingerprint: row.sourceFingerprint,
    }));

    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'find secret relic', source: 'fingerprint-match' });

    expect(result).toMatchObject({ success: true });
    expect(createdContent_ACU()).toContain('dense summary');
  });

  it('P3：同一次发送经两个钩子（source 不同）触发时，8s 窗口内第二次被去重', async () => {
    const first = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'find secret relic', source: 'tavernhelper' });
    expect(first.success).toBe(true);
    expect(first.skipped).not.toBe(true);
    const callsAfterFirst = h.createEmbeddings.mock.calls.length;

    const second = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'find secret relic', source: 'generation_after_commands' });
    expect(second).toMatchObject({ success: true, skipped: true, reason: 'deduped' });
    // 完整链路（embedding 请求）没有第二次执行。
    expect(h.createEmbeddings.mock.calls.length).toBe(callsAfterFirst);
  });

  it('rerank 失败时回退到原候选排序并继续写入世界书，结果标明 rerank 未应用', async () => {
    h.config.rerankEndpoint = 'https://rerank.test';
    h.config.rerankModel = 'rerank-model';
    h.config.topK = 2;
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('rerank down'); }));

    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'secret relic', source: 'rerank-fallback' });

    expect(result.success).toBe(true);
    expect(result.rerankStatus).toBe('failed');
    expect(result.rerankError).toContain('rerank down');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(createdContent_ACU()).toContain('old sparse summary');
  });

  it('rerank 请求只带 Content-Type 与 Authorization，不夹带酒馆宿主请求头（否则跨域预检被拦、rerank 静默失效）', async () => {
    h.config.rerankEndpoint = 'https://rerank.test/v1/rerank';
    h.config.rerankModel = 'rerank-model';
    h.config.rerankApiKey = 'sk-rerank';
    h.config.topK = 1;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ results: [{ index: 0, relevance_score: 0.9 }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'secret relic', source: 'rerank-headers' });

    expect(result.success).toBe(true);
    expect(result.rerankStatus).toBe('applied');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://rerank.test/v1/rerank');
    const headers = init.headers as Record<string, string>;
    expect(headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer sk-rerank' });
    expect(Object.keys(headers).some(key => /csrf/i.test(key))).toBe(false);
  });

  it('候选行不多于 topK 时跳过 rerank，不发请求（rerank 改变不了谁进目录）', async () => {
    h.config.rerankEndpoint = 'https://rerank.test';
    h.config.rerankModel = 'rerank-model';
    h.config.topK = 10;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'find secret relic', source: 'rerank-skip' });

    expect(result.success).toBe(true);
    expect(result.rerankStatus).toBe('skipped_within_topk');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(createdContent_ACU()).toContain('dense summary');
  });

  it('rerank 的 document 用实时纪要表的"概览 + 纪要正文"而不是 chunk 文本，且按行去重', async () => {
    h.config.rerankEndpoint = 'https://rerank.test';
    h.config.rerankModel = 'rerank-model';
    h.config.topK = 1;
    h.config.rerankBatchSize = 300;
    // 同一行两个 chunk 都命中：rerank 只应为该行发一条 document。
    h.chunks = [
      ...h.chunks,
      { ...chunk_ACU(h.rows[0], 'secret relic second chunk of old row', [1, 0]), chunkId: 'chunk-old-2', textHash: 'hash-old-2' },
    ];
    h.summaryTable = { summaryKey: 'summary-source', table: {} };
    h.preparedRows = h.rows.map((row: any) => ({
      rowKey: row.rowKey,
      summary: row.summary,
      chronicleText: `【正文】${row.rowKey} 的三百字纪要正文`,
    }));
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ results: body.documents.map((_doc: string, index: number) => ({ index, relevance_score: 1 - index * 0.1 })) }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'find secret relic', source: 'rerank-doc' });

    expect(result.rerankStatus).toBe('applied');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as any)[1].body));
    const documents: string[] = body.documents;
    expect(documents.length).toBe(result.rerankDocumentCount);
    expect(new Set(documents).size).toBe(documents.length);
    documents.forEach((doc) => {
      expect(doc).toContain('【正文】');
      expect(doc).not.toContain('second chunk');
    });
  });

  it('候选超过每批条数时分批并行请求并按全局 index 合并分数', async () => {
    h.config.rerankEndpoint = 'https://rerank.test';
    h.config.rerankModel = 'rerank-model';
    h.config.rerankBatchSize = 10;
    h.config.topK = 5;
    h.config.summaryIndexCandidateLimit = 50;
    h.config.summaryIndexBm25CandidateLimit = 50;
    h.config.summaryIndexMinScore = 0;
    const rows = Array.from({ length: 25 }, (_, index) => row_ACU(`row-${index}`, index + 1, `summary ${index}`));
    h.rows = rows;
    h.chunks = rows.map((row, index) => chunk_ACU(row, `relic candidate ${index}`, [1, 0]));
    // 分数与全局 index 反向：只有跨批合并正确时，最后一批的行才会成为 top。
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ results: body.documents.map((doc: string, index: number) => ({ index, relevance_score: Number(doc.match(/(\d+)$/)?.[1] || 0) })) }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'relic candidate', source: 'rerank-batches' });

    expect(result.rerankStatus).toBe('applied');
    expect(result.rerankDocumentCount).toBe(25);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const batchSizes = fetchMock.mock.calls.map((call: any) => JSON.parse(String(call[1].body)).documents.length);
    expect(batchSizes).toEqual([10, 10, 5]);
    const content = createdContent_ACU();
    expect(content).toContain('summary 24');
    expect(content).toContain('summary 20');
    expect(content).not.toContain('| summary 0 |');
  });

  it('关闭 AI 补充关键词后不调用关键词 AI，query 只用用户输入', async () => {
    h.config.keywordPromptGroup = [{ role: 'user', content: '$USER_INPUT' }];
    h.config.keywordGenerationEnabled = false;

    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'find secret relic', source: 'keyword-off' });

    expect(result.success).toBe(true);
    expect(result.keywordCount).toBe(0);
    expect(result.keywordGenerationEnabled).toBe(false);
    expect(h.callAI).not.toHaveBeenCalled();
    expect(h.createEmbeddings).toHaveBeenCalledWith(expect.objectContaining({ input: ['find secret relic'] }));
  });

  it('关键词开关缺省视为开启（与升级前行为一致）', async () => {
    h.config.keywordPromptGroup = [{ role: 'user', content: '$USER_INPUT' }];
    delete h.config.keywordGenerationEnabled;

    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'find secret relic', source: 'keyword-default' });

    expect(result.keywordGenerationEnabled).toBe(true);
    expect(h.callAI).toHaveBeenCalledTimes(1);
    expect(result.keywordCount).toBeGreaterThan(0);
  });

  it('未配置 rerank 时不发请求，结果标明 not_configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'secret relic', source: 'rerank-off' });

    expect(result.success).toBe(true);
    expect(result.rerankStatus).toBe('not_configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('T2：chunk 向量维度与 query 不一致时 cosine 返回 0，混维 chunk 不进入 dense 候选', async () => {
    // query 向量为 2 维（beforeEach: embedding [1, 0]），将 denseRow 的 chunk 改成 3 维。
    // 改动前 cosineSimilarity_ACU 会 Math.min 截断后照常打分；改动后维度不一致直接返回 0，
    // 被 summaryIndexMinScore=0.95 过滤，dense 候选只剩维度一致的 chunk。
    h.chunks = h.chunks.map((chunk: any) =>
      chunk.rowKey === 'dense' ? { ...chunk, vector: [1, 0, 0.5] } : chunk,
    );
    h.config.summaryIndexMinScore = 0.95;

    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'secret relic', source: 'mixed-dimension' });

    expect(result.success).toBe(true);
    // 混维 chunk 被剔除：dense 候选不包含该行。
    // （维度一致的 oldRow [0,1] 与 query [1,0] 正交，得分 0 也被 minScore 过滤，故 dense=0）
    expect(result.denseCandidateCount).toBe(0);
    expect(result.sparseCandidateCount).toBeGreaterThanOrEqual(1);
    const content = createdContent_ACU();
    // 混维 denseRow 不进入内容（余弦 0），BM25 命中的 oldRow 兜底注入。
    expect(content).toContain('old sparse summary');
    expect(content).not.toContain('dense summary');
  });


  it('T5：createEmbeddings 抛异常但有最近固定行时，降级为仅注入固定行，不中断生成', async () => {
    h.config.summaryIndexRecentFixedInjectCount = 1;
    h.createEmbeddings.mockRejectedValueOnce(new Error('Embedding 请求失败 403: insufficient balance'));

    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'find secret relic', source: 't5-degrade' });

    expect(result.success).toBe(true);
    expect(result.reason).toBe('query_embedding_failed_recent_fixed_only');
    expect(result.injectedCount).toBe(1);
    expect(result.keywordCount).toBe(0);
    // 固定行（rowOrder 3 = recent fixed summary）被注入，向量候选为 0。
    const content = createdContent_ACU();
    expect(content).toContain('recent fixed summary');
    expect(content).not.toContain('old sparse summary');
    expect(content).not.toContain('dense summary');
  });

  it('T5：createEmbeddings 抛异常且无最近固定行时，异常穿透（由上层 init.ts try/catch 兜底）', async () => {
    h.config.summaryIndexRecentFixedInjectCount = 0;
    h.createEmbeddings.mockRejectedValueOnce(new Error('Embedding 请求失败 500: boom'));

    await expect(processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'find secret relic', source: 't5-rethrow' }))
      .rejects.toThrow('Embedding 请求失败 500: boom');
    expect(h.createEntries).not.toHaveBeenCalled();
  });

  it('T5：createEmbeddings 返回空向量但有最近固定行时，同样降级注入固定行', async () => {
    h.config.summaryIndexRecentFixedInjectCount = 1;
    h.createEmbeddings.mockResolvedValueOnce([{ index: 0, embedding: [] }]);

    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'find secret relic', source: 't5-empty-vector' });

    expect(result.success).toBe(true);
    expect(result.reason).toBe('query_embedding_failed_recent_fixed_only');
    const content = createdContent_ACU();
    expect(content).toContain('recent fixed summary');
  });

});

describe('processSummaryVectorIndexBeforeGeneration_ACU missing snapshot recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSummaryVectorIndexRuntimeDedupeState_ACU();
    h.chat = [{ is_user: false, mes: 'assistant' } as any];
    h.rows = [row_ACU('r1', 1, 'summary')];
    h.chunks = [];
    h.config = defaultConfig_ACU();
    h.loadChunks.mockRejectedValue(new Error('交火向量单文件快照读取失败: missing 读取失败 404: Not Found'));
    h.clearMissing.mockResolvedValue({ chatStateCleared: true, cacheCleared: true });
    h.enqueueFlush.mockResolvedValue({ queued: true, scopeKey: 'scope', debounceUntil: Date.now() });
    h.missingError = true;
    h.invalidError = false;
    h.clearInvalid.mockResolvedValue({ chatStateCleared: true, cacheCleared: true, flushTaskCountCleared: 1 });
    h.summaryTable = null;
    h.preparedRows = [];
  });

  it('删除匹配的失效指针后交给 UI 走普通即时重建路径', async () => {
    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'recover-one', source: 'missing-test' });

    expect(h.clearMissing).toHaveBeenCalledWith({
      messageIndex: 0,
      isolationKey: 'iso-source',
      indexId: 'idx',
      sourceTableKey: 'summary-source',
    });
    expect(h.enqueueFlush).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, skipped: true, reason: 'external_vector_files_missing_rebuild_required' });
  });

  it('失效指针未安全删除时拒绝盲目重建', async () => {
    h.clearMissing.mockResolvedValue({ chatStateCleared: false, cacheCleared: true });
    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'recover-two', source: 'missing-test' });

    expect(h.enqueueFlush).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, skipped: true, reason: 'external_vector_files_missing_state_clear_failed' });
  });

  it('实时行已变化但严格删除失败时不会提前入队 stale rebuild', async () => {
    h.summaryTable = { summaryKey: 'summary-source', table: {} };
    h.preparedRows = [{ rowKey: 'different-row', sourceFingerprint: 'new' }];
    h.clearMissing.mockResolvedValue({ chatStateCleared: false, cacheCleared: true });

    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'recover-three', source: 'missing-test' });

    expect(h.enqueueFlush).not.toHaveBeenCalled();
    expect(result).toMatchObject({ reason: 'external_vector_files_missing_state_clear_failed' });
  });

  it('严格保存抛错时返回稳定原因且不入队', async () => {
    h.clearMissing.mockRejectedValue(new Error('save failed'));
    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'recover-four', source: 'missing-test' });

    expect(h.enqueueFlush).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, skipped: true, reason: 'external_vector_files_missing_state_clear_save_failed' });
  });
});

function realignManifest_ACU(overrides: Record<string, any> = {}): any {
  const base = {
    indexId: 'idx-current',
    status: 'ready',
    chatKey: 'chat-a',
    isolationKey: 'iso-a',
    sourceTableKey: 'summary-source',
    sourceTableName: '纪要表',
    embeddingModel: 'model',
    dimension: 2,
    manifestFile: 'v2-current',
    rowsFile: 'v2-current',
    tombstoneFile: 'v2-current',
    snapshot: { mode: 'single_file_snapshot', revision: 3, activeRowKeys: [], activeChunkIds: [], parentIndexIds: [], removedRowKeys: [], replacedRowKeys: [], batchIds: [] },
    storageIdentity: { layoutVersion: 2, scopeFingerprint: 'scope:chat-a|iso-a|summary-source', writeGeneration: 'generation-current', revision: 3 },
  };
  return { ...base, ...overrides };
}

function realignBlob_ACU(manifest: any): any {
  return {
    schema: 'single_file_snapshot',
    indexId: manifest.indexId,
    chatKey: manifest.chatKey,
    isolationKey: manifest.isolationKey,
    sourceTableKey: manifest.sourceTableKey,
    sourceTableName: manifest.sourceTableName,
    embeddingModel: manifest.embeddingModel,
    dimension: manifest.dimension,
    manifest,
    storageIdentity: manifest.storageIdentity,
    rows: [],
    chunks: [],
  };
}

describe('processSummaryVectorIndexBeforeGeneration_ACU invalid snapshot recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSummaryVectorIndexRuntimeDedupeState_ACU();
    h.chat = [{ is_user: false, mes: 'assistant' } as any];
    h.rows = [row_ACU('r1', 1, 'summary')];
    h.chunks = [];
    h.config = defaultConfig_ACU();
    h.loadChunks.mockRejectedValue(new Error('交火向量单文件快照身份不匹配: path field=isolationKey expected=default actual='));
    h.missingError = false;
    h.invalidError = true;
    h.clearInvalid.mockResolvedValue({ chatStateCleared: true, cacheCleared: true, flushTaskCountCleared: 1 });
    h.enqueueFlush.mockResolvedValue({ queued: true, scopeKey: 'scope', debounceUntil: Date.now() });
    h.summaryTable = null;
    h.preparedRows = [];
    h.snapshot = null;
    h.registry = [];
    h.readSnapshot.mockReset();
    h.validateSnapshot.mockReset();
    h.saveChatStrict.mockResolvedValue(undefined);
    h.tagData = {};
    h.writeTagData.mockReset();
  });

  it('严格删除身份无效 pointer 后交由 UI 普通重建，不再入 flush 队列', async () => {
    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'recover-invalid', source: 'invalid-test' });

    expect(h.clearInvalid).toHaveBeenCalledWith({
      messageIndex: 0,
      isolationKey: 'iso-source',
      indexId: 'idx',
      sourceTableKey: 'summary-source',
    });
    expect(h.enqueueFlush).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, skipped: true, reason: 'external_vector_identity_invalid_rebuild_required' });
  });

  it('身份无效 pointer 未安全删除时拒绝盲目重建', async () => {
    h.clearInvalid.mockResolvedValue({ chatStateCleared: false, cacheCleared: true, flushTaskCountCleared: 1 });

    await expect(processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'recover-invalid-2', source: 'invalid-test' }))
      .resolves.toMatchObject({ success: false, skipped: true, reason: 'external_vector_identity_invalid_state_clear_failed' });
    expect(h.enqueueFlush).not.toHaveBeenCalled();
  });

  it('从同 canonical scope 的 published 更高 revision 磁盘 pointer 对齐，registry 顺序不构成权威', async () => {
    const current = realignManifest_ACU();
    const disk = realignManifest_ACU({
      indexId: 'idx-newer',
      manifestFile: 'v2-newer',
      rowsFile: 'v2-newer',
      tombstoneFile: 'v2-newer',
      snapshot: { ...current.snapshot, revision: 4 },
      storageIdentity: { ...current.storageIdentity, writeGeneration: 'generation-newer', revision: 4 },
    });
    h.chat = [{ is_user: false, mes: 'assistant' } as any];
    h.snapshot = {
      summaryVectorIndexState: { rows: [], chunks: [], manifest: current },
      layers: [{ messageIndex: 0, isolationKey: 'iso-a', summaryVectorIndexState: { manifest: current } }],
    };
    h.registry = [{ path: 'v2-newer', publicationState: 'published' }];
    h.readSnapshot.mockResolvedValue({ ok: true, data: realignBlob_ACU(disk) });
    h.loadChunks.mockRejectedValueOnce(new Error('交火向量单文件快照身份不匹配: stale pointer'));
    h.loadChunks.mockResolvedValueOnce([]);

    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'recover-realign-newer', source: 'realign-test' });

    expect(h.readSnapshot).toHaveBeenCalledWith('v2-newer');
    // 迁移后：metadata 通过 patch 边界提交，断言 message 上指针已更新。
    expect(h.chat[0].TavernDB_ACU_IsolatedData['iso-a'].summaryVectorIndexState.manifest.indexId).toBe('idx-newer');
    expect(h.saveChatStrict).toHaveBeenCalledTimes(1);
    expect(h.clearInvalid).not.toHaveBeenCalled();
    expect(result.reason).toBe('below_min_rows');
  });

  it('realign 的严格保存失败时恢复消息原字段，不接受未 durable 的磁盘 pointer', async () => {
    const current = realignManifest_ACU();
    const disk = realignManifest_ACU({
      indexId: 'idx-newer', manifestFile: 'v2-newer', rowsFile: 'v2-newer', tombstoneFile: 'v2-newer',
      snapshot: { ...current.snapshot, revision: 4 },
      storageIdentity: { ...current.storageIdentity, writeGeneration: 'generation-newer', revision: 4 },
    });
    const originalIsolatedData = JSON.stringify({ 'iso-a': { preserved: true } });
    h.chat = [{ is_user: false, mes: 'assistant', TavernDB_ACU_IsolatedData: originalIsolatedData } as any];
    h.snapshot = {
      summaryVectorIndexState: { rows: [], chunks: [], manifest: current },
      layers: [{ messageIndex: 0, isolationKey: 'iso-a', summaryVectorIndexState: { manifest: current } }],
    };
    h.registry = [{ path: 'v2-newer', publicationState: 'published' }];
    h.readSnapshot.mockResolvedValue({ ok: true, data: realignBlob_ACU(disk) });
    h.loadChunks.mockRejectedValueOnce(new Error('交火向量单文件快照身份不匹配: stale pointer'));
    h.saveChatStrict.mockRejectedValueOnce(new Error('host save failed'));
    h.writeTagData.mockImplementation((message: any, isolationKey: string, tagData: any) => {
      message.TavernDB_ACU_IsolatedData = { [isolationKey]: tagData };
    });

    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'recover-realign-save-failure', source: 'realign-test' });

    expect(h.saveChatStrict).toHaveBeenCalledTimes(1);
    // commit helper 在 save 失败后回滚：消息回到原始字符串容器。
    expect(h.chat[0].TavernDB_ACU_IsolatedData).toBe(originalIsolatedData);
    expect(h.clearInvalid).toHaveBeenCalledTimes(1);
    expect(result.reason).toBe('external_vector_identity_invalid_rebuild_required');
  });

  it('拒绝 published 磁盘候选的 revision 回退，不写回更旧 pointer', async () => {
    const current = realignManifest_ACU();
    const stale = realignManifest_ACU({
      indexId: 'idx-stale',
      manifestFile: 'v2-stale',
      rowsFile: 'v2-stale',
      tombstoneFile: 'v2-stale',
      snapshot: { ...current.snapshot, revision: 2 },
      storageIdentity: { ...current.storageIdentity, writeGeneration: 'generation-stale', revision: 2 },
    });
    h.snapshot = {
      summaryVectorIndexState: { rows: [], chunks: [], manifest: current },
      layers: [{ messageIndex: 0, isolationKey: 'iso-a', summaryVectorIndexState: { manifest: current } }],
    };
    h.registry = [{ path: 'v2-stale', publicationState: 'published' }];
    h.readSnapshot.mockResolvedValue({ ok: true, data: realignBlob_ACU(stale) });

    const result = await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'recover-realign-stale', source: 'realign-test' });

    expect(h.writeTagData).not.toHaveBeenCalled();
    expect(h.saveChatStrict).not.toHaveBeenCalled();
    expect(h.clearInvalid).toHaveBeenCalledTimes(1);
    expect(result.reason).toBe('external_vector_identity_invalid_rebuild_required');
  });

  it('拒绝同 scope 同 revision 的多个 published writeGeneration，不能靠 registry 顺序猜测', async () => {
    const current = realignManifest_ACU();
    const first = realignManifest_ACU({
      indexId: 'idx-duplicate-a', manifestFile: 'v2-duplicate-a', rowsFile: 'v2-duplicate-a', tombstoneFile: 'v2-duplicate-a',
      storageIdentity: { ...current.storageIdentity, writeGeneration: 'generation-a' },
    });
    const second = realignManifest_ACU({
      indexId: 'idx-duplicate-b', manifestFile: 'v2-duplicate-b', rowsFile: 'v2-duplicate-b', tombstoneFile: 'v2-duplicate-b',
      storageIdentity: { ...current.storageIdentity, writeGeneration: 'generation-b' },
    });
    h.snapshot = {
      summaryVectorIndexState: { rows: [], chunks: [], manifest: current },
      layers: [{ messageIndex: 0, isolationKey: 'iso-a', summaryVectorIndexState: { manifest: current } }],
    };
    h.registry = [
      { path: 'v2-duplicate-b', publicationState: 'published' },
      { path: 'v2-duplicate-a', publicationState: 'published' },
    ];
    h.readSnapshot.mockImplementation(async (path: string) => ({ ok: true, data: realignBlob_ACU(path === 'v2-duplicate-a' ? first : second) }));

    await processSummaryVectorIndexBeforeGeneration_ACU({ userInput: 'recover-realign-duplicate', source: 'realign-test' });

    expect(h.writeTagData).not.toHaveBeenCalled();
    expect(h.saveChatStrict).not.toHaveBeenCalled();
    expect(h.clearInvalid).toHaveBeenCalledTimes(1);
  });

});