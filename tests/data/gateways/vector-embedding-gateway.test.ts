/**
 * tests/data/gateways/vector-embedding-gateway.test.ts
 * T3：embedding 错误结构化分类验收
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmbeddings_ACU,
  isVectorEmbeddingError_ACU,
} from '../../../src/data/gateways/vector-embedding-gateway';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function errorBody(code: string | null, message: string): unknown {
  return code != null
    ? { error: { code, message } }
    : { error: { message } };
}

describe('createEmbeddings_ACU 错误结构化分类（T3）', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('401 → credential，且 apiKey 不出现在错误消息', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, errorBody('invalid_key', 'bad key'))));

    await expect(createEmbeddings_ACU({
      endpoint: 'https://embedding.test/v1',
      apiKey: 'sk-secret-abc123',
      model: 'test-model',
      input: ['hello'],
    })).rejects.toMatchObject({
      name: 'VectorEmbeddingError_ACU',
      kind: 'credential',
      httpStatus: 401,
      providerCode: 'invalid_key',
      endpoint: 'https://embedding.test/v1',
      model: 'test-model',
    });

    try {
      await createEmbeddings_ACU({
        endpoint: 'https://embedding.test/v1',
        apiKey: 'sk-secret-abc123',
        model: 'test-model',
        input: ['hello'],
      });
      expect.unreachable('应抛出 VectorEmbeddingError_ACU');
    } catch (error) {
      expect(isVectorEmbeddingError_ACU(error)).toBe(true);
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain('sk-secret-abc123');
    }
  });

  it('403 code 30001 → credential（insufficient_balance），providerCode 保留供上层细分', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(403, errorBody('30001', 'insufficient balance'))));

    await expect(createEmbeddings_ACU({
      endpoint: 'https://embedding.test/v1',
      apiKey: 'sk-1',
      model: 'm',
      input: ['x'],
    })).rejects.toMatchObject({
      kind: 'credential',
      httpStatus: 403,
      providerCode: '30001',
      providerMessage: 'insufficient balance',
    });
  });

  it('403 普通 → credential', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(403, errorBody('forbidden', 'forbidden'))));

    await expect(createEmbeddings_ACU({
      endpoint: 'https://embedding.test/v1',
      apiKey: 'sk-1',
      model: 'm',
      input: ['x'],
    })).rejects.toMatchObject({ kind: 'credential', httpStatus: 403, providerCode: 'forbidden' });
  });

  it('400 / 404 / 422 → request（terminal）', async () => {
    for (const status of [400, 404, 422]) {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(status, errorBody('bad_request', `err-${status}`))));

      await expect(createEmbeddings_ACU({
        endpoint: 'https://embedding.test/v1',
        apiKey: 'sk-1',
        model: 'm',
        input: ['x'],
      })).rejects.toMatchObject({ kind: 'request', httpStatus: status, providerCode: 'bad_request' });
    }
  });

  it('413 → limited-retryable（自动重试一次）', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async () => jsonResponse(413, errorBody(null, 'payload too large')));
      vi.stubGlobal('fetch', fetchMock);
      const promise = createEmbeddings_ACU({
        endpoint: 'https://embedding.test/v1',
        apiKey: 'sk-1',
        model: 'm',
        input: ['x'],
      });
      const assertion = expect(promise).rejects.toMatchObject({ kind: 'limited-retryable', httpStatus: 413 });
      await vi.runAllTimersAsync();
      await assertion;
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  // P4：retryable 类失败在网关内自动快速重试一次（尊重 Retry-After，上限 5s），
  // 重试等待用假定时器推进，避免测试真实阻塞。
  async function expectWithRetryTimers(promise: Promise<unknown>, matcher: Record<string, unknown>): Promise<void> {
    const assertion = expect(promise).rejects.toMatchObject(matcher);
    await vi.runAllTimersAsync();
    await assertion;
  }

  it('408 / 429 → retryable，自动重试一次后仍失败则抛出，并解析 Retry-After 头', async () => {
    vi.useFakeTimers();
    try {
      const fetch429 = vi.fn(async () => jsonResponse(429, errorBody('rate_limit', 'slow down'), { 'Retry-After': '5' }));
      vi.stubGlobal('fetch', fetch429);
      await expectWithRetryTimers(createEmbeddings_ACU({
        endpoint: 'https://embedding.test/v1',
        apiKey: 'sk-1',
        model: 'm',
        input: ['x'],
      }), { kind: 'retryable', httpStatus: 429, retryAfterMs: 5000 });
      expect(fetch429).toHaveBeenCalledTimes(2);

      const fetch408 = vi.fn(async () => jsonResponse(408, errorBody(null, 'timeout')));
      vi.stubGlobal('fetch', fetch408);
      await expectWithRetryTimers(createEmbeddings_ACU({
        endpoint: 'https://embedding.test/v1',
        apiKey: 'sk-1',
        model: 'm',
        input: ['x'],
      }), { kind: 'retryable', httpStatus: 408 });
      expect(fetch408).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('5xx → retryable（自动重试一次）', async () => {
    vi.useFakeTimers();
    try {
      for (const status of [500, 502, 503]) {
        const fetchMock = vi.fn(async () => jsonResponse(status, errorBody(null, 'server error')));
        vi.stubGlobal('fetch', fetchMock);
        await expectWithRetryTimers(createEmbeddings_ACU({
          endpoint: 'https://embedding.test/v1',
          apiKey: 'sk-1',
          model: 'm',
          input: ['x'],
        }), { kind: 'retryable', httpStatus: status });
        expect(fetchMock).toHaveBeenCalledTimes(2);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('网络异常（fetch reject）→ 归类为 retryable 结构化错误，消息保留原因', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
      vi.stubGlobal('fetch', fetchMock);
      const promise = createEmbeddings_ACU({
        endpoint: 'https://embedding.test/v1',
        apiKey: 'sk-1',
        model: 'm',
        input: ['x'],
      });
      const assertion = expect(promise).rejects.toThrow('Failed to fetch');
      await vi.runAllTimersAsync();
      await assertion;
      await expect(promise.catch((error) => error)).resolves.toMatchObject({
        name: 'VectorEmbeddingError_ACU',
        kind: 'retryable',
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('P4：请求超时（AbortController 触发）→ retryable，且消息标注超时', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn((_url: unknown, init: any) => new Promise<Response>((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
        });
      }));
      vi.stubGlobal('fetch', fetchMock);
      const promise = createEmbeddings_ACU({
        endpoint: 'https://embedding.test/v1',
        apiKey: 'sk-1',
        model: 'm',
        input: ['x'],
      });
      const assertion = expect(promise).rejects.toMatchObject({
        name: 'VectorEmbeddingError_ACU',
        kind: 'retryable',
      });
      await vi.runAllTimersAsync();
      await assertion;
      await expect(promise.catch((error) => error.message)).resolves.toContain('超时');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('P4：retryable 失败一次后重试成功，返回正常结果', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse(500, errorBody(null, 'server error')))
        .mockResolvedValueOnce(jsonResponse(200, { data: [{ index: 0, embedding: [0.1, 0.2] }] }));
      vi.stubGlobal('fetch', fetchMock);
      const promise = createEmbeddings_ACU({
        endpoint: 'https://embedding.test/v1',
        apiKey: 'sk-1',
        model: 'm',
        input: ['x'],
      });
      await vi.runAllTimersAsync();
      await expect(promise).resolves.toEqual([{ index: 0, embedding: [0.1, 0.2] }]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('P4：200 但响应体不是 JSON → provider-contract（terminal，不重试）', async () => {
    const fetchMock = vi.fn(async () => new Response('<html>gateway error</html>', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createEmbeddings_ACU({
      endpoint: 'https://embedding.test/v1',
      apiKey: 'sk-1',
      model: 'm',
      input: ['x'],
    })).rejects.toMatchObject({
      name: 'VectorEmbeddingError_ACU',
      kind: 'provider-contract',
      httpStatus: 200,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('响应中无可用向量（空/非法维度）→ provider-contract', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { data: [{ index: 0, embedding: [] }] })));

    await expect(createEmbeddings_ACU({
      endpoint: 'https://embedding.test/v1',
      apiKey: 'sk-1',
      model: 'm',
      input: ['x'],
    })).rejects.toMatchObject({
      name: 'VectorEmbeddingError_ACU',
      kind: 'provider-contract',
      httpStatus: 200,
    });
  });
  it('主动停止中断请求且不按超时错误重试', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url: unknown, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const request = createEmbeddings_ACU({ endpoint: 'https://embedding.test', model: 'm', input: ['x'], signal: controller.signal });
    const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].signal!.aborted).toBe(true);
  });


});
