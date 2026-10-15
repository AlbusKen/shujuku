/**
 * tests/data/gateways/vector-rerank-gateway.test.ts
 * spv9.2：rerank 分批并行请求与跨批 index 合并
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  it('主动停止中断当前全部批次，不继续下一波请求', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url: unknown, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const request = createRerankScores_ACU({
      endpoint: 'https://rerank.test', model: 'm', query: 'q',
      documents: Array.from({ length: 50 }, (_, i) => `d${i}`), batchSize: 10, signal: controller.signal,
    });
    const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.every(call => call[1].signal!.aborted)).toBe(true);
  });


});

describe('Rerank 正文阶段的期限与取消', () => {
  const request = { endpoint: 'https://rerank.test', model: 'm', query: 'q', documents: ['x'] };
  const validBody = JSON.stringify({ results: [{ index: 0, relevance_score: 0.8 }] });

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([200, 503])('HTTP %i 正文挂起仍受同一 30 秒期限保护', async (status) => {
    let finishBody!: (value: string) => void;
    const text = vi.fn(() => new Promise<string>(resolve => { finishBody = resolve; }));
    const fetchMock = vi.fn((_url: unknown, _init: RequestInit) => new Promise<Response>(resolve => {
      setTimeout(() => resolve({ ok: status === 200, status, text } as unknown as Response), 5_000);
    }));
    vi.stubGlobal('fetch', fetchMock);
    let settled = false;
    const outcome = createRerankScores_ACU(request).then(
      value => { settled = true; return value; },
      error => { settled = true; return error; },
    );
    await vi.advanceTimersByTimeAsync(5_000);
    expect(text).toHaveBeenCalledOnce();
    const signal = fetchMock.mock.calls[0][1].signal!;
    await vi.advanceTimersByTimeAsync(24_999);
    expect(signal.aborted).toBe(false);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal.aborted).toBe(true);
    expect(settled).toBe(true);
    expect(await outcome).toMatchObject({ message: expect.stringMatching(/超时.*30000ms.*第 1\/1 批/) });
    expect(vi.getTimerCount()).toBe(0);
    finishBody(validBody);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([200, 503])('HTTP %i 正文期间取消全部当前批次，不发送下一波', async (status) => {
    const parent = new AbortController();
    const finishBodies: Array<(value: string) => void> = [];
    const text = vi.fn(() => new Promise<string>(resolve => finishBodies.push(resolve)));
    const fetchMock = vi.fn(async (_url: unknown, _init: RequestInit) => ({ ok: status === 200, status, text }));
    vi.stubGlobal('fetch', fetchMock);
    const reason = new DOMException('用户停止', 'AbortError');
    const rejected = expect(createRerankScores_ACU({
      ...request, documents: Array.from({ length: 50 }, (_, i) => `d${i}`), batchSize: 10, signal: parent.signal,
    })).rejects.toBe(reason);
    await vi.advanceTimersByTimeAsync(0);
    expect(text).toHaveBeenCalledTimes(4);
    parent.abort(reason);
    expect(fetchMock.mock.calls.every(call => call[1].signal!.aborted)).toBe(true);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    finishBodies.forEach(finish => finish(validBody));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each(['success', 'http-error', 'invalid-json'])('%s 完成后移除父监听和计时器', async (kind) => {
    const parent = new AbortController();
    const add = vi.spyOn(parent.signal, 'addEventListener');
    const remove = vi.spyOn(parent.signal, 'removeEventListener');
    const response = new Response(kind === 'success' ? validBody : 'bad response', { status: kind === 'http-error' ? 401 : 200 });
    const fetchMock = vi.fn(async (_url: unknown, _init: RequestInit) => response);
    vi.stubGlobal('fetch', fetchMock);
    const outcome = await createRerankScores_ACU({ ...request, signal: parent.signal }).catch(error => error);
    if (kind === 'success') expect(outcome).toEqual([{ index: 0, relevanceScore: 0.8 }]);
    else expect(outcome.message).toContain(kind === 'http-error' ? '401' : '不是合法 JSON');
    expect(add).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0][1]);
    expect(vi.getTimerCount()).toBe(0);
    parent.abort();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock.mock.calls[0][1].signal!.aborted).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('正文传输异常保留网络失败分类及批次信息', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200,
      text: async () => { throw new TypeError('body connection reset'); },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(createRerankScores_ACU(request)).rejects.toThrow(/网络失败.*第 1\/1 批.*body connection reset/);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
