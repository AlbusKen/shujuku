/** Rerank 请求超时上界；超时抛错由调用方回退到 embedding 排序。 */
const VECTOR_RERANK_TIMEOUT_MS_ACU = 30_000;

/**
 * 单次 rerank 请求的 documents 条数默认上限。
 * 主流 Qwen3/gte 系列服务商单请求最多 500 条、总量 120k token；300 条 × 纪要正文（≈200 token）
 * 加上 query 复制项仍在限额内。交叉编码器逐对打分，分数与同批其他文档无关，跨批合并等价于一次请求。
 */
export const VECTOR_RERANK_DEFAULT_BATCH_SIZE_ACU = 300;
export const VECTOR_RERANK_MIN_BATCH_SIZE_ACU = 10;
export const VECTOR_RERANK_MAX_BATCH_SIZE_ACU = 500;
/** 单条 document 的字符上限：服务商按 4k token 截断，这里提前截断以控制请求体积。 */
const VECTOR_RERANK_DOCUMENT_MAX_CHARS_ACU = 2000;
/** 分批并行的并发上限：候选池 ≤1000 时最多 4 批，同时发出即可；更大的池子分轮发送避免触发限流。 */
const VECTOR_RERANK_BATCH_CONCURRENCY_ACU = 4;

export interface VectorRerankResult_ACU {
    index: number;
    relevanceScore: number;
}

export interface VectorRerankRequest_ACU {
    endpoint: string;
    apiKey?: string;
    model: string;
    query: string;
    documents: string[];
    instruction?: string;
    /** 每批 documents 条数；缺省 VECTOR_RERANK_DEFAULT_BATCH_SIZE_ACU，夹在 [10, 500]。 */
    batchSize?: number;
}

export function normalizeRerankBatchSize_ACU(value: unknown, fallback = VECTOR_RERANK_DEFAULT_BATCH_SIZE_ACU): number {
    const num = Math.floor(Number(value));
    if (!Number.isFinite(num) || num <= 0) return fallback;
    return Math.min(VECTOR_RERANK_MAX_BATCH_SIZE_ACU, Math.max(VECTOR_RERANK_MIN_BATCH_SIZE_ACU, num));
}

/** 把 documents 切成等长批次，返回每批的起始偏移与内容；调用方按偏移把批内 index 还原为全局 index。 */
export function splitRerankDocumentsIntoBatches_ACU(documents: string[], batchSize: number): Array<{ offset: number; documents: string[] }> {
    const size = normalizeRerankBatchSize_ACU(batchSize);
    const batches: Array<{ offset: number; documents: string[] }> = [];
    for (let offset = 0; offset < documents.length; offset += size) {
        batches.push({ offset, documents: documents.slice(offset, offset + size) });
    }
    return batches;
}

function normalizeEndpoint_ACU(endpoint: string): string {
    return String(endpoint || '').trim().replace(/\/+$/, '');
}

/**
 * Rerank 是浏览器直连第三方服务商的跨域请求，与 embedding 网关同一口径：只带 Content-Type 与 Authorization。
 * 绝不能混入酒馆宿主请求头（X-CSRF-Token 等）——自定义头会触发 CORS 预检，服务商的
 * Access-Control-Allow-Headers 不放行它就整条请求被浏览器拦下，rerank 静默退化成 embedding 排序，
 * 同时还把酒馆的 CSRF 令牌泄露给第三方。
 */
export function buildRerankHeaders_ACU(apiKey?: string): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
    }
    return headers;
}

function normalizeRerankItem_ACU(item: any, fallbackIndex: number): VectorRerankResult_ACU | null {
    if (!item || typeof item !== 'object') {
        return null;
    }

    const rawIndex = item.index ?? item.document_index ?? item.documentIndex;
    const rawScore = item.relevance_score ?? item.relevanceScore ?? item.score ?? item.rerank_score;
    const index = Number.isFinite(Number(rawIndex)) ? Math.floor(Number(rawIndex)) : fallbackIndex;
    const relevanceScore = Number(rawScore);


    if (!Number.isFinite(index) || index < 0 || !Number.isFinite(relevanceScore)) {
        return null;
    }

    return {
        index,
        relevanceScore,
    };
}

function extractRerankResults_ACU(payload: any): VectorRerankResult_ACU[] {
    const rawResults = Array.isArray(payload?.results)
        ? payload.results
        : Array.isArray(payload?.data?.results)
            ? payload.data.results
            : Array.isArray(payload?.data)
                ? payload.data
                : [];

    return rawResults
        .map((item: any, index: number) => normalizeRerankItem_ACU(item, index))
        .filter((item: VectorRerankResult_ACU | null): item is VectorRerankResult_ACU => !!item);
}

interface RerankBatchRequest_ACU {
    endpoint: string;
    apiKey?: string;
    model: string;
    query: string;
    instruction: string;
    documents: string[];
    batchLabel: string;
}

async function requestRerankBatch_ACU(request: RerankBatchRequest_ACU): Promise<VectorRerankResult_ACU[]> {
    const payload: Record<string, any> = { model: request.model, query: request.query, documents: request.documents };
    if (request.instruction) payload.instruction = request.instruction;

    // 超时可中断：rerank 在发送前同步链路上，挂起的上游不允许无限阻塞生成。
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VECTOR_RERANK_TIMEOUT_MS_ACU);
    let response: Response;
    try {
        response = await fetch(request.endpoint, {
            method: 'POST',
            headers: buildRerankHeaders_ACU(request.apiKey),
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
    } catch (error: any) {
        throw new Error(error?.name === 'AbortError'
            ? `Rerank 请求超时（${VECTOR_RERANK_TIMEOUT_MS_ACU}ms，${request.batchLabel}），已中断。`
            : `Rerank 请求网络失败（${request.batchLabel}）：${error?.message || String(error || '未知错误')}`);
    } finally {
        clearTimeout(timer);
    }

    if (!response.ok) {
        const detail = await response.text().catch(() => response.statusText);
        throw new Error(`Rerank 请求失败（${request.batchLabel}）: ${response.status} ${detail}`);
    }

    const rawBody = await response.text().catch((): string => '');
    let responsePayload: any;
    try {
        responsePayload = JSON.parse(rawBody);
    } catch (_error) {
        throw new Error(`Rerank 响应不是合法 JSON（${request.batchLabel}，前 200 字符：${rawBody.slice(0, 200)}）。`);
    }
    return extractRerankResults_ACU(responsePayload);
}

/**
 * 对 documents 做 rerank，返回全局 index 上的评分。
 * documents 超过 batchSize 时自动分批并行请求并把批内 index 还原为全局 index；
 * 任一批失败整体抛错，由调用方回退到 embedding 排序（不接受"半批有分、半批无分"的混合排序）。
 */
export async function createRerankScores_ACU(request: VectorRerankRequest_ACU): Promise<VectorRerankResult_ACU[]> {
    const endpoint = normalizeEndpoint_ACU(request.endpoint);
    const model = String(request.model || '').trim();
    const query = String(request.query || '').trim();
    const documents = Array.isArray(request.documents)
        ? request.documents.map((item) => String(item ?? '').trim().slice(0, VECTOR_RERANK_DOCUMENT_MAX_CHARS_ACU))
        : [];

    if (!endpoint) {
        throw new Error('Rerank endpoint 为空。');
    }
    if (!model) {
        throw new Error('Rerank model 为空。');
    }
    if (!query) {
        return [];
    }
    if (documents.length === 0 || documents.every((item) => !item)) {
        return [];
    }

    const instruction = String(request.instruction ?? '').trim();
    const batches = splitRerankDocumentsIntoBatches_ACU(documents, normalizeRerankBatchSize_ACU(request.batchSize));
    const merged: VectorRerankResult_ACU[] = [];

    for (let round = 0; round < batches.length; round += VECTOR_RERANK_BATCH_CONCURRENCY_ACU) {
        const wave = batches.slice(round, round + VECTOR_RERANK_BATCH_CONCURRENCY_ACU);
        const waveResults = await Promise.all(wave.map((batch, waveIndex) => requestRerankBatch_ACU({
            endpoint,
            apiKey: request.apiKey,
            model,
            query,
            instruction,
            documents: batch.documents,
            batchLabel: `第 ${round + waveIndex + 1}/${batches.length} 批，${batch.documents.length} 条`,
        })));
        waveResults.forEach((results, waveIndex) => {
            const offset = wave[waveIndex].offset;
            const batchLength = wave[waveIndex].documents.length;
            results.forEach((item) => {
                if (item.index < 0 || item.index >= batchLength) return;
                merged.push({ index: offset + item.index, relevanceScore: item.relevanceScore });
            });
        });
    }
    return merged;
}
