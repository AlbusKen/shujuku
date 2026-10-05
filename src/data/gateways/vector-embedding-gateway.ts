import { runWithAbortSignal_ACU } from '../../shared/abort-signal';

export type VectorEmbeddingErrorKind_ACU =
    | 'credential' | 'request' | 'provider-contract' | 'retryable' | 'limited-retryable';

export interface VectorEmbeddingRequest_ACU {
    endpoint: string;
    apiKey?: string;
    model: string;
    input: string[];
    signal?: AbortSignal;
}

export interface VectorEmbeddingResult_ACU {
    index: number;
    embedding: number[];
}

export class VectorEmbeddingError_ACU extends Error {
    readonly kind: VectorEmbeddingErrorKind_ACU;
    readonly httpStatus: number | null;
    readonly providerCode: string | null;
    readonly providerMessage: string | null;
    readonly retryAfterMs: number | null;
    readonly endpoint: string;
    readonly model: string;

    constructor(options: {
        kind: VectorEmbeddingErrorKind_ACU;
        message: string;
        httpStatus?: number | null;
        providerCode?: string | null;
        providerMessage?: string | null;
        retryAfterMs?: number | null;
        endpoint: string;
        model: string;
    }) {
        super(options.message);
        this.name = 'VectorEmbeddingError_ACU';
        this.kind = options.kind;
        this.httpStatus = options.httpStatus ?? null;
        this.providerCode = options.providerCode ?? null;
        this.providerMessage = options.providerMessage ?? null;
        this.retryAfterMs = options.retryAfterMs ?? null;
        this.endpoint = options.endpoint;
        this.model = options.model;
    }
}

export function isVectorEmbeddingError_ACU(value: unknown): value is VectorEmbeddingError_ACU {
    return value instanceof VectorEmbeddingError_ACU;
}

function normalizeEmbeddingVector_ACU(value: any): number[] {
    if (!Array.isArray(value)) return [];
    const vector = value
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item));
    return vector.length === value.length ? vector : [];
}

function normalizeEmbeddingResponse_ACU(payload: any): VectorEmbeddingResult_ACU[] {
    const data = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.embeddings)
            ? payload.embeddings
            : [];
    return data
        .map((item: any, fallbackIndex: number): VectorEmbeddingResult_ACU => ({
            index: Number.isInteger(item?.index) ? Number(item.index) : fallbackIndex,
            embedding: normalizeEmbeddingVector_ACU(item?.embedding ?? item),
        }))
        .filter((item: VectorEmbeddingResult_ACU) => item.embedding.length > 0);
}

/** 按分类表决定 HTTP 状态对应的错误种类（T3）。 */
function classifyEmbeddingHttpError_ACU(status: number): VectorEmbeddingErrorKind_ACU {
    switch (status) {
        case 401: return 'credential';
        case 403: return 'credential';
        case 400:
        case 404:
        case 422: return 'request';
        case 413: return 'limited-retryable';
        case 408:
        case 429: return 'retryable';
        default: return status >= 500 ? 'retryable' : 'request';
    }
}

/** 解析 Retry-After：秒（数字或 HTTP-date）→ ms。无法解析返回 null。 */
function parseRetryAfterMs_ACU(value: string | null | undefined): number | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
        const seconds = Number(trimmed);
        return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1000) : null;
    }
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) {
        return Math.max(0, parsed - Date.now());
    }
    return null;
}

/** 解析错误响应体：优先 JSON 的 error.code / error.message，否则取原始文本。 */
function parseEmbeddingErrorBody_ACU(raw: string): { providerCode: string | null; providerMessage: string | null } {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return { providerCode: null, providerMessage: null };
    try {
        const payload = JSON.parse(trimmed);
        const code = payload?.error?.code ?? payload?.code ?? null;
        const message = payload?.error?.message ?? payload?.message ?? null;
        return {
            providerCode: code != null ? String(code) : null,
            providerMessage: message != null ? String(message) : null,
        };
    } catch (_error) {
        return { providerCode: null, providerMessage: trimmed.slice(0, 500) };
    }
}

async function throwEmbeddingHttpErrorAsync_ACU(
    response: Response,
    endpoint: string,
    model: string,
): Promise<never> {
    const raw = await response.text().catch((): string => response.statusText);
    const { providerCode, providerMessage } = parseEmbeddingErrorBody_ACU(raw);
    const kind = classifyEmbeddingHttpError_ACU(response.status);
    const retryAfterMs = parseRetryAfterMs_ACU(response.headers.get('Retry-After'));
    const status = response.status;
    const detail = providerMessage || raw || response.statusText;
    throw new VectorEmbeddingError_ACU({
        kind,
        message: `Embedding 请求失败 ${status}: ${detail}`,
        httpStatus: status,
        providerCode,
        providerMessage: providerMessage || detail,
        retryAfterMs,
        endpoint,
        model,
    });
}

/** 请求超时：查询与归档批次共用。超时/网络中断归类为 retryable，交给上层有限重试。 */
const VECTOR_EMBEDDING_TIMEOUT_MS_ACU = 45_000;
/** 网关内 retryable 类失败的最大请求次数（1 次原始 + 1 次快速重试）。 */
const VECTOR_EMBEDDING_MAX_ATTEMPTS_ACU = 2;
/** 重试前等待 Retry-After 的上界：查询路径在发送前同步阻塞，不允许长等待。 */
const VECTOR_EMBEDDING_RETRY_WAIT_MAX_MS_ACU = 5_000;

async function fetchEmbeddingWithTimeout_ACU(
    endpoint: string,
    init: RequestInit,
    model: string,
): Promise<Response> {
    init.signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(init.signal?.reason);
    init.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(), VECTOR_EMBEDDING_TIMEOUT_MS_ACU);
    try {
        return await fetch(endpoint, { ...init, signal: controller.signal });
    } catch (error: any) {
        init.signal?.throwIfAborted();
        const isAbort = error?.name === 'AbortError';
        throw new VectorEmbeddingError_ACU({
            kind: 'retryable',
            message: isAbort
                ? `Embedding 请求超时（${VECTOR_EMBEDDING_TIMEOUT_MS_ACU}ms），已中断。`
                : `Embedding 请求网络失败：${error?.message || String(error || '未知错误')}`,
            endpoint,
            model,
        });
    } finally {
        init.signal?.removeEventListener('abort', abort);
        clearTimeout(timer);
    }
}

async function requestEmbeddingsOnce_ACU(
    endpoint: string,
    model: string,
    input: string[],
    headers: Record<string, string>,
    signal?: AbortSignal,
): Promise<VectorEmbeddingResult_ACU[]> {
    const response = await fetchEmbeddingWithTimeout_ACU(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, input }),
        signal,
    }, model);
    signal?.throwIfAborted();
    if (!response.ok) {
        await throwEmbeddingHttpErrorAsync_ACU(response, endpoint, model);
    }
    const rawBody = await response.text().catch((): string => '');
    signal?.throwIfAborted();
    let payload: any;
    try {
        payload = JSON.parse(rawBody);
    } catch (_error) {
        throw new VectorEmbeddingError_ACU({
            kind: 'provider-contract',
            message: `Embedding 响应不是合法 JSON（前 200 字符：${rawBody.slice(0, 200)}）。`,
            httpStatus: response.status,
            endpoint,
            model,
        });
    }
    const normalized = normalizeEmbeddingResponse_ACU(payload);
    if (normalized.length === 0) {
        throw new VectorEmbeddingError_ACU({
            kind: 'provider-contract',
            message: 'Embedding 响应中没有可用向量。',
            httpStatus: response.status,
            endpoint,
            model,
        });
    }
    return normalized;
}

export async function createEmbeddings_ACU(request: VectorEmbeddingRequest_ACU): Promise<VectorEmbeddingResult_ACU[]> {
    request.signal?.throwIfAborted();
    const endpoint = String(request.endpoint || '').trim();
    const model = String(request.model || '').trim();
    const input = Array.isArray(request.input) ? request.input.map((item) => String(item ?? '')) : [];
    if (!endpoint) {
        throw new Error('缺少 embeddingEndpoint，无法生成纪要向量索引。');
    }
    if (!model) {
        throw new Error('缺少 embeddingModel，无法生成纪要向量索引。');
    }
    if (input.length === 0) {
        return [];
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const apiKey = String(request.apiKey || '').trim();
    if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
    }
    // 网关内只对 retryable / limited-retryable 做一次快速重试（尊重 Retry-After，
    // 上限 5s）；credential / request / provider-contract 重试不可能成功，直接抛出。
    // 任务级的多次退避重试由 flush 队列负责，这里不叠加长循环。
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= VECTOR_EMBEDDING_MAX_ATTEMPTS_ACU; attempt += 1) {
        try {
            request.signal?.throwIfAborted();
            return await requestEmbeddingsOnce_ACU(endpoint, model, input, headers, request.signal);
        } catch (error) {
            request.signal?.throwIfAborted();
            lastError = error;
            const retryable = isVectorEmbeddingError_ACU(error)
                && (error.kind === 'retryable' || error.kind === 'limited-retryable');
            if (!retryable || attempt >= VECTOR_EMBEDDING_MAX_ATTEMPTS_ACU) {
                throw error;
            }
            const waitMs = Math.min(
                Math.max(0, Number((error as VectorEmbeddingError_ACU).retryAfterMs ?? 1000) || 1000),
                VECTOR_EMBEDDING_RETRY_WAIT_MAX_MS_ACU,
            );
            await runWithAbortSignal_ACU(request.signal, () => new Promise<void>((resolve) => setTimeout(resolve, waitMs)));
        }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError || 'Embedding 请求失败'));
}
