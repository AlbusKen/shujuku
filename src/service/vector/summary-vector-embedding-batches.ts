import type { VectorEmbeddingResult_ACU } from '../../data/gateways/vector-embedding-gateway';

export interface EmbeddingBatchSource_ACU {
    rowKey: string;
    text: string;
}

export interface PlannedEmbeddingBatch_ACU<T extends EmbeddingBatchSource_ACU> {
    index: number;
    sources: Array<{ source: T; sourceIndex: number }>;
    rowCount: number;
    chunkCount: number;
    inputChars: number;
    singleRowOverBudget: boolean;
}

export interface EmbeddingBatchPlan_ACU<T extends EmbeddingBatchSource_ACU> {
    sources: T[];
    batches: PlannedEmbeddingBatch_ACU<T>[];
}

export interface EmbeddingBatchStats_ACU {
    plannedBatchCount: number;
    completedBatchCount: number;
    successfulBatchCount: number;
    totalRows: number;
    totalChunks: number;
    maxInputChars: number;
    elapsedMs: number;
}

export class EmbeddingBatchExecutionError_ACU extends Error {
    readonly batch: Pick<PlannedEmbeddingBatch_ACU<EmbeddingBatchSource_ACU>, 'index' | 'rowCount' | 'chunkCount' | 'inputChars'>;
    constructor(message: string, batch: PlannedEmbeddingBatch_ACU<EmbeddingBatchSource_ACU>, cause?: unknown) {
        super(message);
        this.name = 'EmbeddingBatchExecutionError_ACU';
        this.batch = { index: batch.index, rowCount: batch.rowCount, chunkCount: batch.chunkCount, inputChars: batch.inputChars };
        if (cause !== undefined) (this as any).cause = cause;
    }
}

export function planEmbeddingBatches_ACU<T extends EmbeddingBatchSource_ACU>(
    sources: T[],
    limits: { maxRowsPerRequest: number; maxInputCharsPerRequest: number },
): EmbeddingBatchPlan_ACU<T> {
    const maxRows = Math.max(1, Math.floor(Number(limits.maxRowsPerRequest) || 1));
    const maxChars = Math.max(1, Math.floor(Number(limits.maxInputCharsPerRequest) || 1));
    const normalized = Array.isArray(sources) ? sources.filter(source => typeof source?.text === 'string') : [];
    const rowGroups: Array<Array<{ source: T; sourceIndex: number }>> = [];
    for (const [sourceIndex, source] of normalized.entries()) {
        const previous = rowGroups[rowGroups.length - 1];
        if (previous && previous[0].source.rowKey === source.rowKey) previous.push({ source, sourceIndex });
        else rowGroups.push([{ source, sourceIndex }]);
    }
    const batches: PlannedEmbeddingBatch_ACU<T>[] = [];
    let current: Array<{ source: T; sourceIndex: number }> = [];
    let chars = 0;
    const push = () => {
        if (!current.length) return;
        const rowCount = new Set(current.map(item => item.source.rowKey)).size;
        batches.push({ index: batches.length, sources: current, rowCount, chunkCount: current.length, inputChars: chars, singleRowOverBudget: rowCount === 1 && chars > maxChars });
        current = []; chars = 0;
    };
    for (const group of rowGroups) {
        const groupChars = group.reduce((sum, item) => sum + item.source.text.length, 0);
        const nextRows = new Set([...current.map(item => item.source.rowKey), group[0].source.rowKey]).size;
        if (current.length && (nextRows > maxRows || chars + groupChars > maxChars)) push();
        current.push(...group); chars += groupChars;
        if (groupChars > maxChars) push();
    }
    push();
    return { sources: normalized, batches };
}

export async function executeEmbeddingBatchPlan_ACU<T extends EmbeddingBatchSource_ACU>(
    plan: EmbeddingBatchPlan_ACU<T>,
    options: {
        maxConcurrentRequests: number;
        requestEmbeddings: (input: string[]) => Promise<VectorEmbeddingResult_ACU[]>;
    },
): Promise<{ embeddings: number[][]; stats: EmbeddingBatchStats_ACU }> {
    const startedAt = Date.now();
    const slots: Array<number[] | null> = new Array(plan.sources.length).fill(null);
    let nextBatch = 0;
    let completedBatchCount = 0;
    let successfulBatchCount = 0;
    let firstFailure: { error: unknown; batch: PlannedEmbeddingBatch_ACU<T> } | null = null;

    const runBatch = async (batch: PlannedEmbeddingBatch_ACU<T>): Promise<void> => {
        try {
            const fill = async (items: Array<{ source: T; sourceIndex: number }>): Promise<void> => {
                const results = await options.requestEmbeddings(items.map(item => item.source.text));
                for (const result of results) {
                    if (!Number.isInteger(result?.index) || result.index < 0 || result.index >= items.length) continue;
                    if (Array.isArray(result.embedding) && result.embedding.length > 0) {
                        slots[items[result.index].sourceIndex] = result.embedding;
                    }
                }
            };
            await fill(batch.sources);
            let missing = batch.sources.filter(item => !slots[item.sourceIndex]);
            if (missing.length > 0 && missing.length < batch.sources.length) {
                const recoverySize = Math.max(1, Math.min(batch.sources.length - missing.length, missing.length));
                for (let index = 0; index < missing.length; index += recoverySize) {
                    await fill(missing.slice(index, index + recoverySize));
                }
                missing = batch.sources.filter(item => !slots[item.sourceIndex]);
            }
            if (missing.length > 0) {
                throw new Error(`Embedding 响应缺失 ${missing.length}/${batch.chunkCount} 条向量。`);
            }
            successfulBatchCount += 1;
        } catch (error) {
            if (!firstFailure) firstFailure = { error, batch };
        } finally {
            completedBatchCount += 1;
        }
    };

    const workers = Array.from({ length: Math.max(1, Math.min(Math.floor(Number(options.maxConcurrentRequests) || 1), plan.batches.length)) }, async () => {
        while (!firstFailure && nextBatch < plan.batches.length) {
            const batch = plan.batches[nextBatch++];
            await runBatch(batch);
        }
    });
    await Promise.allSettled(workers);
    const stats: EmbeddingBatchStats_ACU = {
        plannedBatchCount: plan.batches.length,
        completedBatchCount,
        successfulBatchCount,
        totalRows: new Set(plan.sources.map(source => source.rowKey)).size,
        totalChunks: plan.sources.length,
        maxInputChars: Math.max(0, ...plan.batches.map(batch => batch.inputChars)),
        elapsedMs: Date.now() - startedAt,
    };
    if (firstFailure) {
        const message = firstFailure.error instanceof Error ? firstFailure.error.message : String(firstFailure.error || 'Embedding 批次失败');
        throw new EmbeddingBatchExecutionError_ACU(message, firstFailure.batch, firstFailure.error);
    }
    return { embeddings: slots.map(vector => vector || []), stats };
}
