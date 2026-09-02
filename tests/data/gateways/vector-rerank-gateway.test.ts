/**
 * tests/data/gateways/vector-rerank-gateway.test.ts
 * spv9.2：rerank 分批并行请求与跨批 index 合并
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRerankScores_ACU,
  normalizeRerankBatchSize_ACU,
  splitRerankDocumentsIntoBatches_ACU,
  VECTOR_RERANK_DEFAULT_BATCH_SIZE_ACU,
  VECTOR_RERANK_MAX_BATCH_SIZE_ACU,
  VECTOR_RERANK_MIN_BATCH_SIZE_ACU,
} from '../../../src/data/gateways/vector-rerank-gateway';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function documentsOf(call: any): string[] {
  return JSON.parse(String(call[1].body)).documents;
}

describe('normalizeRerankBatchSize_ACU', () => {
  it('缺省 / 非法值回落到默认值，越界值夹到 [min, max]', () => {
    expect(normalizeRerankBatchSize_ACU(undefined)).toBe(VECTOR_RERANK_DEFAULT_BATCH_SIZE_ACU);
    expect(normalizeRerankBatchSize_ACU('abc')).toBe(VECTOR_RERANK_DEFAULT_BATCH_SIZE_ACU);
    expect(normalizeRerankBatchSize_ACU(0)).toBe(VECTOR_RERANK_DEFAULT_BATCH_SIZE_ACU);
    expect(normalizeRerankBatchSize_ACU(-5)).toBe(VECTOR_RERANK_DEFAULT_BATCH_SIZE_ACU);
    expect(normalizeRerankBatchSize_ACU(1)).toBe(VECTOR_RERANK_MIN_BATCH_SIZE_ACU);
    expect(normalizeRerankBatchSize_ACU(99999)).toBe(VECTOR_RERANK_MAX_BATCH_SIZE_ACU);
    expect(normalizeRerankBatchSize_ACU(250.7)).toBe(250);
  });
});

describe('splitRerankDocumentsIntoBatches_ACU', () => {
  it('按批大小切分并记录每批偏移', () => {
    const docs = Array.from({ length: 25 }, (_, i) => `d${i}`);
    const batches = splitRerankDocumentsIntoBatches_ACU(docs, 10);
    expect(batches.map(b => b.offset)).toEqual([0, 10, 20]);
    expect(batches.map(b => b.documents.length)).toEqual([10, 10, 5]);
    expect(batches[2].documents).toEqual(['d20', 'd21', 'd22', 'd23', 'd24']);
  });

  it('文档数不超过批大小时只有一批', () => {
    const batches = splitRerankDocumentsIntoBatches_ACU(['a', 'b'], 300);
    expect(batches).toEqual([{ offset: 0, documents: ['a', 'b'] }]);
  });
});

describe('createRerankScores_ACU 分批', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('文档数不超过批大小时只发一次请求，index 原样返回', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { results: [{ index: 1, relevance_score: 0.9 }, { index: 0, relevance_score: 0.2 }] }));
    vi.stubGlobal('fetch', fetchMock);

    const results = await createRerankScores_ACU({
      endpoint: 'https://rerank.test/v1/rerank/',
      model: 'm',
      query: 'q',
      documents: ['a', 'b'],
      batchSize: 300,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as any)[0]).toBe('https://rerank.test/v1/rerank');
    expect(results).toEqual([{ index: 1, relevanceScore: 0.9 }, { index: 0, relevanceScore: 0.2 }]);
  });

  it('超过批大小时分批并行发送，批内 index 按偏移还原为全局 index', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const documents = JSON.parse(String(init.body)).documents as string[];
      return jsonResponse(200, { results: documents.map((doc, index) => ({ index, relevance_score: Number(doc.slice(1)) / 100 })) });
    });
    vi.stubGlobal('fetch', fetchMock);
    const documents = Array.from({ length: 25 }, (_, i) => `d${i}`);

    const results = await createRerankScores_ACU({ endpoint: 'https://rerank.test', model: 'm', query: 'q', documents, batchSize: 10 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(documentsOf).map(d => d.length)).toEqual([10, 10, 5]);
    expect(results).toHaveLength(25);
    const byIndex = new Map(results.map(r => [r.index, r.relevanceScore]));
    expect(byIndex.get(0)).toBeCloseTo(0);
    expect(byIndex.get(10)).toBeCloseTo(0.1);
    expect(byIndex.get(24)).toBeCloseTo(0.24);
    // 每批请求都带同一个 query 与 model。
    fetchMock.mock.calls.forEach((call: any) => {
      const body = JSON.parse(String(call[1].body));
      expect(body.query).toBe('q');
      expect(body.model).toBe('m');
    });
  });

  it('批内返回越界 index 被丢弃，不会错位到别的批', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const documents = JSON.parse(String(init.body)).documents as string[];
      return jsonResponse(200, { results: [{ index: 0, relevance_score: 0.5 }, { index: documents.length + 3, relevance_score: 0.99 }] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const results = await createRerankScores_ACU({ endpoint: 'https://rerank.test', model: 'm', query: 'q', documents: Array.from({ length: 20 }, (_, i) => `d${i}`), batchSize: 10 });

    expect(results).toEqual([{ index: 0, relevanceScore: 0.5 }, { index: 10, relevanceScore: 0.5 }]);
  });

  it('任一批失败整体抛错，错误里带批次标签', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      calls += 1;
      const documents = JSON.parse(String(init.body)).documents as string[];
      if (calls === 2) return new Response(JSON.stringify({ error: { message: '单次请求提交的条目数量超过限制' } }), { status: 503 });
      return jsonResponse(200, { results: documents.map((_d, index) => ({ index, relevance_score: 0.5 })) });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(createRerankScores_ACU({ endpoint: 'https://rerank.test', model: 'm', query: 'q', documents: Array.from({ length: 20 }, (_, i) => `d${i}`), batchSize: 10 }))
      .rejects.toThrow(/第 2\/2 批.*503/);
  });

  it('单条 document 超长会被截断到上限，请求头只带 Content-Type 与 Authorization', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { results: [{ index: 0, relevance_score: 1 }] }));
    vi.stubGlobal('fetch', fetchMock);

    await createRerankScores_ACU({ endpoint: 'https://rerank.test', apiKey: 'sk-1', model: 'm', query: 'q', documents: ['x'.repeat(5000)] });

    const call = fetchMock.mock.calls[0] as any;
    expect(documentsOf(call)[0].length).toBe(2000);
    expect(call[1].headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer sk-1' });
  });

  it('空 query 或空 documents 不发请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await createRerankScores_ACU({ endpoint: 'https://rerank.test', model: 'm', query: '', documents: ['a'] })).toEqual([]);
    expect(await createRerankScores_ACU({ endpoint: 'https://rerank.test', model: 'm', query: 'q', documents: ['', '  '] })).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
