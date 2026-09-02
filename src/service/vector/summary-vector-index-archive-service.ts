import {
    readIsolatedTagData_ACU,
    writeMessageIdentity_ACU,
} from '../../data/repositories/chat-message-data-repo';
import { commitVectorMetadataPatch_ACU } from './summary-vector-index-chat-commit';
import type {
    ChatSummaryVectorIndexChunk_ACU,
    ChatSummaryVectorIndexRow_ACU,
    ChatSummaryVectorIndexState_ACU,
} from '../../data/models/chat-message-data';
import type { SummaryVectorIndexExternalFileRef_ACU } from './summary-vector-index-types';
import {
    assertSummaryVectorFlushGenerationCurrent_ACU,
    SummaryVectorFlushGenerationInvalidatedError_ACU,
} from '../../data/storage/vector-index-hot-cache';
import { createEmbeddings_ACU, isVectorEmbeddingError_ACU, VectorEmbeddingError_ACU } from '../../data/gateways/vector-embedding-gateway';
import type { VectorEmbeddingResult_ACU } from '../../data/gateways/vector-embedding-gateway';
import { buildVectorIndexSingleSnapshotV2FilePath_ACU } from '../../data/storage/vector-index-st-files-storage';
import { currentChatFileIdentifier_ACU, currentJsonTableData_ACU, getCurrentIsolationKey_ACU, settings_ACU } from '../runtime/state-manager';
import { getChatArray_ACU } from '../chat/chat-service';
import { getLatestAiMessageIndexFromChat_ACU } from '../table/table-history';
import {
    persistRemoteMemorySnapshotAnchorIfNeeded_ACU,
    resolveRemoteMemorySnapshotAnchor_ACU,
} from './remote-memory-snapshot-anchor';
import {
    getEffectiveSummaryVectorIndexConfig_ACU,
    validateSummaryVectorIndexConfig_ACU,
} from './vector-memory-config';
import {
    getAggregatedSummaryVectorIndexSnapshot_ACU,
} from './summary-vector-index-state-service';
import {
    abortSummaryVectorIndexSnapshotPublication_ACU,
    deleteSummaryVectorIndexExternal_ACU,
    isLegacySummaryVectorIndexManifest_ACU,
    loadSummaryVectorIndexChunksFromManifest_ACU,
    logSummaryVectorIndexIdentityEvent_ACU,
    normalizeSummaryVectorIndexManifestForRead_ACU,
    finalizeSummaryVectorIndexSnapshotPublication_ACU,
    persistSummaryVectorIndexSnapshot_ACU,
} from './summary-vector-index-storage-service';
import { hashUserInput_ACU, isSummaryOrOutlineTable_ACU, logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { normalizeSummaryVectorIndexScope_ACU, serializeSummaryVectorIndexScope_ACU } from '../../shared/summary-vector-index-scope';
import { buildSummaryRowFingerprint_ACU, hashSummaryVectorSourceText_ACU } from './summary-vector-row-fingerprint';

type SummaryVectorIndexArchiveMode_ACU = 'append' | 'sync';

export type SummaryVectorIndexArchiveOptions_ACU = {
    targetMessageIndex?: number;
    mode?: SummaryVectorIndexArchiveMode_ACU;
    /** 仅允许 durable publish；延迟保存没有 publication handle，不能安全暴露。 */
    saveChatAfterWrite?: boolean;
    /** 为 true 时跳过 "无变更" 检测，强制执行归档写入（含外置文件上传） */
    force?: boolean;
    /**
     * 为 true 时只执行向量化阶段（embedding），不立即写入外置文件。
     * 向量化结果存入 pending state，由防抖定时器触发归档。
     * 这实现了"纪要表变动→增量向量化→向量数据变动→防抖→本地归档"的正确触发链。
     */
    vectorizeOnly?: boolean;
    /** Flush 恢复时必须使用入队时捕获的 scope，不能在执行时静默漂移到当前 isolation。 */
    isolationKey?: string;
    /** 聊天隔离容器的真实槽位；它与 V2 持久化 identity 的 canonical isolationKey 不同。 */
    tagIsolationKey?: string;
    /** Flush 恢复时必须使用入队时捕获的纪要表。 */
    sourceTableKey?: string;
    /** Flush runner 捕获的 canonical scope；仅 flush 队列路径传入。 */
    expectedFlushScopeKey?: string;
    /** Flush runner 捕获的持久化代次；发布聊天 pointer 前必须严格校验。 */
    expectedFlushGeneration?: number;
};

export interface SummaryVectorIndexArchiveResult_ACU {
    success: boolean;
    skipped: boolean;
    indexedRowCount: number;
    skippedRowCount: number;
    chunkCount: number;
    messageIndex?: number;
    summaryKey?: string;
    reason?: string;
    /**
     * T0c：结构化重试性分类。'terminal' 表示重试不可能成功（如路径超长），
     * 调用方（flush runner）必须停止重排并标记 failed_terminal，不再重复扣费。
     */
    retryability?: 'retryable' | 'terminal';
    /**
     * T4：credential 类失败（401/403）时，按 endpoint + model + apiKey 计算的哈希指纹。
     * 仅存哈希不存明文，供 flush runner 做跨 scope cooldown（同一凭据在其他聊天也停止重试）。
     */
    credentialFingerprint?: string;
    errors: string[];
}

export interface SummaryTableSelection_ACU {
    summaryKey: string;
    table: any;
}

export interface SummaryVectorArchivePreparedRow_ACU {
    rowKey: string;
    rowId: string;
    rowOrder: number;
    timeSpan: string;
    location: string;
    summary: string;
    indexCode: string;
    /** 纪要正文列原文（可为空：模板没有该列时）。发送前 rerank 用它作 document。 */
    chronicleText: string;
    /** 参与 embedding/BM25 的源文本：概览 + 纪要正文（截断到上限）。 */
    vectorSourceText: string;
    vectorSourceHash: string;
    sourceFingerprint: string;
}

/**
 * 源文本字符上限。默认模板纪要 300–400 字，自定义模板可能更长；主流 embedding 模型 8k token
 * 窗口远够，这里的上限只是防止极端长文本把单行 embedding/rerank 成本拉爆。
 */
export const SUMMARY_VECTOR_SOURCE_TEXT_MAX_CHARS_ACU = 1600;

const SUMMARY_CHRONICLE_COLUMN_ALIASES_ACU = ['纪要', '纪要内容', '纪要正文', '事件纪要', '详细纪要', '正文'];

/**
 * 概览在前保住高密度摘要信号，纪要正文补充实体与细节；两者都为空的行由调用方跳过。
 */
export function buildSummaryVectorSourceText_ACU(summary: string, chronicleText: string): string {
    const parts = [normalizeText_ACU(summary), normalizeText_ACU(chronicleText)].filter(Boolean);
    const combined = parts.join('\n');
    return combined.length > SUMMARY_VECTOR_SOURCE_TEXT_MAX_CHARS_ACU
        ? combined.slice(0, SUMMARY_VECTOR_SOURCE_TEXT_MAX_CHARS_ACU)
        : combined;
}

const summaryVectorIndexArchiveLocks_ACU = new Map<string, Promise<void>>();

// ============================================================
// 向量化→防抖归档 pipeline（参考 Engram 数据层 hook 触发模式）
// 向量化阶段立即执行，归档阶段由向量数据变更触发防抖
// ============================================================

const VECTOR_INDEX_PERSIST_DEBOUNCE_MS_ACU = 2500;

interface SummaryVectorIndexPendingArchive_ACU {
    chat: any[];
    aggregatedSnapshot: ReturnType<typeof getAggregatedSummaryVectorIndexSnapshot_ACU>;
    embeddingModel: string;
    preparedRows: SummaryVectorArchivePreparedRow_ACU[];
    finalRows: ChatSummaryVectorIndexRow_ACU[];
    finalChunks: ChatSummaryVectorIndexChunk_ACU[];
    targetMessageIndex: number;
    snapshotMessageId: string;
    isolationKey: string;
    tagIsolationKey: string;
    sourceTableKey: string;
    sourceTableName: string;
    indexedAt: string;
    skippedRowCount: number;
    mode: SummaryVectorIndexArchiveMode_ACU;
    expectedFlushScopeKey?: string;
    expectedFlushGeneration?: number;
}

const pendingVectorIndexArchives_ACU = new Map<string, SummaryVectorIndexPendingArchive_ACU>();
const vectorIndexPersistTimers_ACU = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleDebouncedVectorIndexPersist_ACU(scopeKey: string): void {
    const existing = vectorIndexPersistTimers_ACU.get(scopeKey);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
        vectorIndexPersistTimers_ACU.delete(scopeKey);
        void persistPendingVectorIndexArchive_ACU(scopeKey);
    }, VECTOR_INDEX_PERSIST_DEBOUNCE_MS_ACU);
    vectorIndexPersistTimers_ACU.set(scopeKey, timer);
    logDebug_ACU(`[纪要向量索引] 防抖归档已调度：scope=${scopeKey}, debounceMs=${VECTOR_INDEX_PERSIST_DEBOUNCE_MS_ACU}`);
}

async function persistPendingVectorIndexArchive_ACU(scopeKey: string): Promise<void> {
    const pending = pendingVectorIndexArchives_ACU.get(scopeKey);
    if (!pending) {
        logDebug_ACU(`[纪要向量索引] 防抖归档触发但无 pending 数据：scope=${scopeKey}`);
        return;
    }
    pendingVectorIndexArchives_ACU.delete(scopeKey);
    try {
        logDebug_ACU(`[纪要向量索引] 防抖归档开始：operation=persist_pending_archive, scope=${scopeKey}, changed=${pending.finalRows.length > 0 || pending.finalChunks.length > 0}`);
        await runSummaryVectorIndexScopeExclusive_ACU(scopeKey, async () => {
            const latestAggregatedSnapshot = await hydrateAggregatedSummaryVectorIndexSnapshot_ACU(getAggregatedSummaryVectorIndexSnapshot_ACU());
            await writeSummaryVectorIndexCheckpoint_ACU({
            chat: pending.chat,
            aggregatedSnapshot: latestAggregatedSnapshot || pending.aggregatedSnapshot,
            embeddingModel: pending.embeddingModel,
            preparedRows: pending.preparedRows,
            finalRows: pending.finalRows,
            finalChunks: pending.finalChunks,
            targetMessageIndex: pending.targetMessageIndex,
            snapshotMessageId: pending.snapshotMessageId,
            isolationKey: pending.isolationKey,
            tagIsolationKey: pending.tagIsolationKey,
            sourceTableKey: pending.sourceTableKey,
            sourceTableName: pending.sourceTableName,
            indexedAt: pending.indexedAt,
            skippedRowCount: pending.skippedRowCount,
            mode: pending.mode,
            expectedFlushScopeKey: pending.expectedFlushScopeKey,
            expectedFlushGeneration: pending.expectedFlushGeneration,
            saveChatAfterWrite: true,
            });
        });
        logDebug_ACU(`[纪要向量索引] 防抖归档完成：operation=persist_pending_archive, scope=${scopeKey}, changed=true`);
    } catch (error) {
        logWarn_ACU('[纪要向量索引] 防抖归档失败:', error);
    }
}

export function flushPendingVectorIndexArchives_ACU(): void {
    for (const [scopeKey] of pendingVectorIndexArchives_ACU) {
        const timer = vectorIndexPersistTimers_ACU.get(scopeKey);
        if (timer) clearTimeout(timer);
        vectorIndexPersistTimers_ACU.delete(scopeKey);
        void persistPendingVectorIndexArchive_ACU(scopeKey);
    }
}

export function buildSummaryVectorIndexArchiveScopeKey_ACU(parts: {
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
}): string {
    return serializeSummaryVectorIndexScope_ACU(parts);
}

async function runSummaryVectorIndexArchiveWithScopeLock_ACU<T>(
    scopeKey: string,
    task: () => Promise<T>,
): Promise<T> {
    return runSummaryVectorIndexScopeExclusive_ACU(scopeKey, task);
}

function runSummaryVectorIndexScopeExclusive_ACU<T>(scopeKey: string, task: () => Promise<T>): Promise<T> {
    const previous = summaryVectorIndexArchiveLocks_ACU.get(scopeKey) || Promise.resolve();
    let releaseLock!: () => void;
    const current = new Promise<void>((resolve) => {
        releaseLock = resolve;
    });
    // 必须在 await previous 前登记 current，才能形成不可穿透的 FIFO 链。
    summaryVectorIndexArchiveLocks_ACU.set(scopeKey, current);
    return (async () => {
        await previous.catch((error) => {
            logWarn_ACU('[纪要向量索引] 前序 scope 操作失败，继续执行后续操作:', error);
        });
        try {
            return await task();
        } finally {
            releaseLock();
            if (summaryVectorIndexArchiveLocks_ACU.get(scopeKey) === current) {
                summaryVectorIndexArchiveLocks_ACU.delete(scopeKey);
            }
        }
    })();
}

/**
 * 为非归档 mutation 保留同一 scope 的串行边界。
 * 与归档入口的“合并补跑”不同，清理/失效操作绝不能被合并为一次归档。
 */
export async function runSummaryVectorIndexArchiveScopeMutationExclusive_ACU<T>(
    scopeKey: string,
    task: () => Promise<T>,
): Promise<T> {
    return runSummaryVectorIndexScopeExclusive_ACU(scopeKey, task);
}

function buildResult_ACU(partial: Partial<SummaryVectorIndexArchiveResult_ACU> = {}): SummaryVectorIndexArchiveResult_ACU {
    return {
        success: false,
        skipped: false,
        indexedRowCount: 0,
        skippedRowCount: 0,
        chunkCount: 0,
        retryability: 'retryable' as const,
        errors: [],
        ...partial,
    };
}

/**
 * T0b：归档入口路径 preflight。
 * 在发起任何 embedding 请求之前，用长度上界占位值试算 V2 快照对象路径的可构造性。
 * 真实 indexId / writeGeneration 在 persist 内部生成，这里无法取得，因此占位必须取上界：
 *   - indexId：`snap_`(5) + hashUserInput_ACU 输出最长 8 字符 = 13。
 *     hashUserInput_ACU（utils.ts:91）末轮不再 `^=` 截回 32 位，返回值可能为负，
 *     `toString(36)` 会带 `-` 号（实测 20 万样本：50.3% 为负、21.1% 长度为 8，最坏如 `-10tp0s0`）。
 *     而 normalizeFileNamePart_ACU 的字符集 [a-zA-Z0-9_-] 保留 `-`，不会被吃掉。
 *     取 12 会让临界 scope 通过 preflight 后在 persist 抛错（先烧 embedding 再失败），故必须取 13。
 *   - writeGeneration：T0a 后最大长度 24（时间戳 base36 8 + 7 + 7 = 22，留 2 字符余量）
 * preflight 通过 ⇒ 真实构造必通过（不允许 preflight 放过、persist 再抛）。
 * 返回 { ok: true } 或 { ok: false, error }，不 throw。
 */
function preflightVectorIndexSnapshotPath_ACU(parts: {
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
}): { ok: boolean; error?: string } {
    const indexIdPlaceholder = 'snap_' + 'z'.repeat(8);
    const writeGenerationPlaceholder = 'z'.repeat(24);
    try {
        buildVectorIndexSingleSnapshotV2FilePath_ACU({
            chatKey: parts.chatKey,
            isolationKey: parts.isolationKey,
            sourceTableKey: parts.sourceTableKey,
            indexId: indexIdPlaceholder,
            writeGeneration: writeGenerationPlaceholder,
        });
        return { ok: true };
    } catch (error: any) {
        return { ok: false, error: String(error?.message || error || '快照路径长度超出宿主安全上限') };
    }
}

function normalizeText_ACU(value: any): string {
    return String(value ?? '').trim();
}

function resolveColumnIndexByAliases_ACU(headerRow: any[], aliases: string[], fallbackIndex = -1): number {
    const normalizedAliases = aliases.map((item) => normalizeText_ACU(item).replace(/\s+/g, ''));
    const index = (Array.isArray(headerRow) ? headerRow : []).findIndex((header) => normalizedAliases.includes(normalizeText_ACU(header).replace(/\s+/g, '')));
    return index >= 0 ? index : fallbackIndex;
}

function buildStableSummaryRowKey_ACU(summaryKey: string, rowId: string, indexCode: string): string {
    const source = `${summaryKey}:${rowId}:${indexCode}`;
    return `summary-row:${hashUserInput_ACU(source)}`;
}

// 单一指纹公式已抽至 summary-vector-row-fingerprint.ts（storage-service 也需引用，
// 留在本文件会与既有 archive → storage 依赖成环）。
function buildPreparedRowFingerprint_ACU(row: SummaryVectorArchivePreparedRow_ACU): string {
    return buildSummaryRowFingerprint_ACU(row);
}

export function findSummaryTable_ACU(sourceTableKey?: string): SummaryTableSelection_ACU | null {
    if (!currentJsonTableData_ACU || typeof currentJsonTableData_ACU !== 'object') {
        return null;
    }

    const requestedKey = normalizeText_ACU(sourceTableKey);
    const candidateKeys = requestedKey ? [requestedKey] : Object.keys(currentJsonTableData_ACU);
    const summaryKey = candidateKeys.find((key) => {
        const table = currentJsonTableData_ACU[key];
        return !!table?.name && isSummaryOrOutlineTable_ACU(String(table.name || ''));
    });

    if (!summaryKey) return null;
    const table = currentJsonTableData_ACU[summaryKey];
    if (!table || !Array.isArray(table.content)) return null;

    return {
        summaryKey,
        table,
    };
}

function splitSentences_ACU(text: string): string[] {
    const normalized = normalizeText_ACU(text);
    if (!normalized) return [];
    const matches = normalized.match(/[^。！？!?；;\n]+[。！？!?；;]?/g);
    const sentences = Array.isArray(matches)
        ? matches.map((item) => normalizeText_ACU(item)).filter(Boolean)
        : [normalized];
    return sentences.length > 0 ? sentences : [normalized];
}

function chunkTextBySentenceCount_ACU(text: string, sentenceCount: number): string[] {
    const sentences = splitSentences_ACU(text);
    const normalizedSentenceCount = Math.max(1, Math.floor(Number(sentenceCount) || 2));
    const chunks: string[] = [];
    for (let index = 0; index < sentences.length; index += normalizedSentenceCount) {
        const chunkText = normalizeText_ACU(sentences.slice(index, index + normalizedSentenceCount).join(''));
        if (chunkText) chunks.push(chunkText);
    }
    return chunks;
}

/**
 * 一行源文本 → 待 embedding 的 chunk 文本。
 * 默认整行一个 chunk（向量数 = 行数，索引体积不随正文长度膨胀）；
 * 只有显式开启按句切分时才用 sentenceCount 切纪要正文。
 */
export function buildRowChunkTexts_ACU(
    vectorSourceText: string,
    options: { sentenceCount: number; chunkBySentence: boolean },
): string[] {
    const normalized = normalizeText_ACU(vectorSourceText);
    if (!normalized) return [];
    if (!options.chunkBySentence) return [normalized];
    return chunkTextBySentenceCount_ACU(normalized, options.sentenceCount);
}

export function buildPreparedRows_ACU(table: any, summaryKey: string): {
    rows: SummaryVectorArchivePreparedRow_ACU[];
    skippedRowCount: number;
    error: string;
} {
    const content = Array.isArray(table?.content) ? table.content : [];
    const headerRow = Array.isArray(content[0]) ? content[0] : [];
    const timeSpanColIdx = resolveColumnIndexByAliases_ACU(headerRow, ['时间跨度', '时间', '阶段', '时段'], 0);
    const locationColIdx = resolveColumnIndexByAliases_ACU(headerRow, ['地点', '位置', '场景', '场所'], 1);
    const summaryColIdx = resolveColumnIndexByAliases_ACU(headerRow, ['概要', '概览', '概述', '摘要']);
    const indexColIdx = resolveColumnIndexByAliases_ACU(headerRow, ['编码索引']);
    const chronicleColIdx = resolveColumnIndexByAliases_ACU(headerRow, SUMMARY_CHRONICLE_COLUMN_ALIASES_ACU);
    if (summaryColIdx < 0) {
        return { rows: [], skippedRowCount: 0, error: '纪要表缺少概要列，无法构建纪要向量索引。' };
    }
    if (indexColIdx < 0) {
        return { rows: [], skippedRowCount: 0, error: '纪要表缺少编码索引列，无法构建纪要向量索引。' };
    }

    const dataRows = content.slice(1).filter((row: any) => Array.isArray(row));
    const preparedRows: SummaryVectorArchivePreparedRow_ACU[] = [];
    let skippedRowCount = 0;
    dataRows.forEach((row: any[], rowIndex: number) => {
        const rowId = normalizeText_ACU(row?.[0]) || String(rowIndex + 1);
        const timeSpan = timeSpanColIdx >= 0 ? normalizeText_ACU(row?.[timeSpanColIdx]) : '';
        const location = locationColIdx >= 0 ? normalizeText_ACU(row?.[locationColIdx]) : '';
        const summary = normalizeText_ACU(row?.[summaryColIdx]);
        const indexCode = normalizeText_ACU(row?.[indexColIdx]);
        const chronicleText = chronicleColIdx >= 0 && chronicleColIdx !== summaryColIdx ? normalizeText_ACU(row?.[chronicleColIdx]) : '';
        const vectorSourceText = buildSummaryVectorSourceText_ACU(summary, chronicleText);
        if (!summary || !indexCode || !vectorSourceText) {
            skippedRowCount += 1;
            return;
        }
        const preparedRow: SummaryVectorArchivePreparedRow_ACU = {
            rowKey: buildStableSummaryRowKey_ACU(summaryKey, rowId, indexCode),
            rowId,
            rowOrder: rowIndex,
            timeSpan,
            location,
            summary,
            indexCode,
            chronicleText,
            vectorSourceText,
            vectorSourceHash: hashSummaryVectorSourceText_ACU(vectorSourceText),
            sourceFingerprint: '',
        };
        preparedRow.sourceFingerprint = buildPreparedRowFingerprint_ACU(preparedRow);
        preparedRows.push(preparedRow);
    });

    return { rows: preparedRows, skippedRowCount, error: '' };
}

function resolveTargetMessageIndex_ACU(preferredIndex?: number): number {
    const chat = getChatArray_ACU();
    if (!Array.isArray(chat) || chat.length === 0) {
        return -1;
    }

    const normalizedPreferredIndex = Math.floor(Number(preferredIndex));
    if (Number.isFinite(normalizedPreferredIndex)) {
        const preferredMessage = chat[normalizedPreferredIndex];
        if (preferredMessage && !preferredMessage.is_user) {
            return normalizedPreferredIndex;
        }
        logWarn_ACU('[纪要向量索引] 指定归档目标楼层无效，回退到最新 AI 楼层:', preferredIndex);
    }

    return getLatestAiMessageIndexFromChat_ACU(chat);
}

function cloneSummaryVectorIndexState_ACU(state: ChatSummaryVectorIndexState_ACU | null | undefined): ChatSummaryVectorIndexState_ACU | null {
    if (!state) return null;
    try {
        return JSON.parse(JSON.stringify(state));
    } catch (_error) {
        return null;
    }
}

function getSummaryRowFingerprintFromStateRow_ACU(row: ChatSummaryVectorIndexRow_ACU): string {
    return buildSummaryRowFingerprint_ACU({
        rowId: row.rowId,
        timeSpan: row.timeSpan,
        location: row.location,
        summary: row.summary,
        indexCode: row.indexCode,
        vectorSourceText: row.vectorSourceText,
        vectorSourceHash: row.vectorSourceHash,
    });
}

/**
 * 判断已落盘索引是否仍是 spv9.2 之前的源文本格式（只用概览、行内无 vectorSourceHash）。
 * 旧格式索引在下一次发送/填表时会因指纹全量 mismatch 自动重建；聊天加载时提前发现可以后台先建。
 */
export function isSummaryVectorIndexSourceTextOutdated_ACU(state: ChatSummaryVectorIndexState_ACU | null | undefined): boolean {
    if (!state || !Array.isArray(state.rows)) return false;
    const activeRows = state.rows.filter((row) => row && row.status !== 'removed');
    if (activeRows.length === 0) return false;
    return activeRows.some((row) => !row.vectorSourceHash);
}

function buildLayerStateWithRows_ACU(
    baseState: ChatSummaryVectorIndexState_ACU | null | undefined,
    rows: ChatSummaryVectorIndexRow_ACU[],
    chunks: ChatSummaryVectorIndexChunk_ACU[],
    options: {
        snapshotMessageId: string;
        sourceTableKey: string;
        sourceTableName: string;
        indexedAt: string;
        skippedRowCount?: number;
    },
): ChatSummaryVectorIndexState_ACU | null {
    const normalizedRows = (Array.isArray(rows) ? rows : [])
        .map((row) => ({
            ...row,
            chunkIds: Array.isArray(row.chunkIds) ? row.chunkIds.filter(Boolean) : [],
        }))
        .filter((row) => row.rowKey && row.rowId && row.summary && row.indexCode && row.chunkIds.length > 0)
        .sort((left, right) => left.rowOrder - right.rowOrder || left.rowKey.localeCompare(right.rowKey));
    const validRowKeys = new Set(normalizedRows.map((row) => row.rowKey));
    const validChunkIds = new Set(normalizedRows.flatMap((row) => row.chunkIds));
    const normalizedChunks = (Array.isArray(chunks) ? chunks : [])
        .filter((chunk) => chunk?.chunkId && chunk?.rowKey && validRowKeys.has(chunk.rowKey) && validChunkIds.has(chunk.chunkId))
        .map((chunk, index) => ({ ...chunk, sequence: index }));
    if (normalizedRows.length === 0 || normalizedChunks.length === 0) {
        return null;
    }
    return {
        version: 1,
        snapshotMessageId: options.snapshotMessageId || baseState?.snapshotMessageId || '',
        sourceTableKey: options.sourceTableKey || baseState?.sourceTableKey || '',
        sourceTableName: options.sourceTableName || baseState?.sourceTableName || '纪要表',
        indexedAt: options.indexedAt || baseState?.indexedAt || new Date().toISOString(),
        rowCount: normalizedRows.length,
        chunkCount: normalizedChunks.length,
        skippedRowCount: Math.max(0, Math.floor(Number(options.skippedRowCount ?? baseState?.skippedRowCount ?? 0) || 0)),
        rows: normalizedRows,
        chunks: normalizedChunks,
    };
}

function getSummaryVectorIndexActiveRowKeys_ACU(state: ChatSummaryVectorIndexState_ACU | null | undefined): string[] {
    if (!state) return [];
    const manifestActiveRowKeys = Array.isArray(state.manifest?.snapshot?.activeRowKeys)
        ? state.manifest!.snapshot!.activeRowKeys
        : [];
    if (manifestActiveRowKeys.length > 0) {
        return Array.from(new Set(manifestActiveRowKeys.map((rowKey) => String(rowKey || '')).filter(Boolean)));
    }
    return Array.isArray(state.rows)
        ? Array.from(new Set(state.rows.filter((row) => row && row.status !== 'removed').map((row) => String(row.rowKey || '')).filter(Boolean)))
        : [];
}

function areSummaryVectorActiveRowKeysSame_ACU(
    preparedRows: SummaryVectorArchivePreparedRow_ACU[],
    existingState: ChatSummaryVectorIndexState_ACU | null,
): boolean {
    const preparedKeys = Array.from(new Set((Array.isArray(preparedRows) ? preparedRows : []).map((row) => String(row?.rowKey || '')).filter(Boolean))).sort();
    const existingKeys = getSummaryVectorIndexActiveRowKeys_ACU(existingState).sort();
    if (preparedKeys.length !== existingKeys.length) return false;
    for (let index = 0; index < preparedKeys.length; index += 1) {
        if (preparedKeys[index] !== existingKeys[index]) return false;
    }
    return true;
}

function buildExistingReusableRows_ACU(
    preparedRows: SummaryVectorArchivePreparedRow_ACU[],
    existingState: ChatSummaryVectorIndexState_ACU | null,
): { reusableRows: ChatSummaryVectorIndexRow_ACU[]; reusableChunks: ChatSummaryVectorIndexChunk_ACU[]; rowsNeedingEmbedding: SummaryVectorArchivePreparedRow_ACU[] } {
    const preparedByKey = new Map(preparedRows.map((row) => [row.rowKey, row]));
    const existingRows = Array.isArray(existingState?.rows) ? existingState!.rows : [];
    const existingChunks = Array.isArray(existingState?.chunks) ? existingState!.chunks : [];
    const existingChunksByRowKey = new Map<string, ChatSummaryVectorIndexChunk_ACU[]>();
    existingChunks.forEach((chunk) => {
        if (!chunk?.rowKey || !chunk?.chunkId
            || (!Array.isArray(chunk.vector) && !(chunk.vector instanceof Float32Array))
            || chunk.vector.length === 0) return;
        const list = existingChunksByRowKey.get(chunk.rowKey) || [];
        list.push({ ...chunk });
        existingChunksByRowKey.set(chunk.rowKey, list);
    });

    const reusableRows: ChatSummaryVectorIndexRow_ACU[] = [];
    const reusableChunks: ChatSummaryVectorIndexChunk_ACU[] = [];
    const reusableKeySet = new Set<string>();
    existingRows.forEach((existingRow) => {
        const prepared = preparedByKey.get(existingRow.rowKey);
        const chunks = existingChunksByRowKey.get(existingRow.rowKey) || [];
        const existingFingerprint = getSummaryRowFingerprintFromStateRow_ACU(existingRow);
        if (!prepared || chunks.length === 0 || existingFingerprint !== prepared.sourceFingerprint) {
            return;
        }
        const chunkIds = chunks.map((chunk) => chunk.chunkId).filter(Boolean);
        if (chunkIds.length === 0) return;
        reusableRows.push({
            rowKey: prepared.rowKey,
            rowId: prepared.rowId,
            rowOrder: prepared.rowOrder,
            timeSpan: prepared.timeSpan,
            location: prepared.location,
            summary: prepared.summary,
            indexCode: prepared.indexCode,
            // 行只落哈希不落原文：源文本含纪要正文，原文随 chunk 进外置文件即可。
            vectorSourceText: '',
            vectorSourceHash: prepared.vectorSourceHash,
            // 复用前提是现存内容重算指纹 === prepared.sourceFingerprint（上方判等），
            // 落盘指纹供查询时与实时纪要表对账（filterRowsByLiveSummaryTable_ACU）。
            sourceFingerprint: prepared.sourceFingerprint,
            chunkIds,
        });
        chunks.forEach((chunk) => reusableChunks.push({ ...chunk }));
        reusableKeySet.add(prepared.rowKey);
    });

    const rowsNeedingEmbedding = preparedRows.filter((row) => !reusableKeySet.has(row.rowKey));
    return { reusableRows, reusableChunks, rowsNeedingEmbedding };
}

async function buildChunksWithEmbeddings_ACU(
    rows: SummaryVectorArchivePreparedRow_ACU[],
    options: {
        snapshotMessageId: string;
        sentenceCount: number;
        chunkBySentence: boolean;
        embeddingEndpoint: string;
        embeddingApiKey: string;
        embeddingModel: string;
        existingSequenceBase?: number;
    },
): Promise<{ rows: ChatSummaryVectorIndexRow_ACU[]; chunks: ChatSummaryVectorIndexChunk_ACU[] }> {
    const sequenceBase = Math.max(0, Math.floor(Number(options.existingSequenceBase) || 0));
    const chunkSources: Array<{ chunkId: string; rowKey: string; rowIndex: number; text: string; sequence: number }> = [];
    rows.forEach((row, rowIndex) => {
        const rowChunkTexts = buildRowChunkTexts_ACU(row.vectorSourceText, { sentenceCount: options.sentenceCount, chunkBySentence: options.chunkBySentence });
        rowChunkTexts.forEach((text, chunkIndex) => {
            chunkSources.push({
                chunkId: `${row.rowKey}:chunk:${chunkIndex}`,
                rowKey: row.rowKey,
                rowIndex,
                text,
                sequence: sequenceBase + chunkSources.length,
            });
        });
    });

    if (chunkSources.length === 0) {
        return { rows: [], chunks: [] };
    }

    const embeddings: VectorEmbeddingResult_ACU[] = await createEmbeddings_ACU({
        endpoint: options.embeddingEndpoint,
        apiKey: options.embeddingApiKey,
        model: options.embeddingModel,
        input: chunkSources.map((item) => item.text),
    });

    const embeddingMap = new Map<number, number[]>();
    embeddings.forEach((item: VectorEmbeddingResult_ACU): void => {
        if (Number.isInteger(item.index) && item.index >= 0 && item.index < chunkSources.length
            && Array.isArray(item.embedding) && item.embedding.length > 0) {
            embeddingMap.set(item.index, item.embedding);
        }
    });

    let missingIndexes = chunkSources
        .map((_source, index) => index)
        .filter((index) => !embeddingMap.has(index));

    // 首次响应已有部分有效向量时，只补齐缺失项；首次无有效向量仍按既有失败路径处理。
    if (embeddingMap.size > 0 && missingIndexes.length > 0) {
        const recoveryBatchSize = Math.min(embeddingMap.size, missingIndexes.length);
        for (let start = 0; start < missingIndexes.length; start += recoveryBatchSize) {
            const recoveryOriginalIndexes = missingIndexes.slice(start, start + recoveryBatchSize);
            const recoveredEmbeddings = await createEmbeddings_ACU({
                endpoint: options.embeddingEndpoint,
                apiKey: options.embeddingApiKey,
                model: options.embeddingModel,
                input: recoveryOriginalIndexes.map((originalIndex) => chunkSources[originalIndex].text),
            });
            recoveredEmbeddings.forEach((item: VectorEmbeddingResult_ACU): void => {
                if (!Number.isInteger(item.index) || item.index < 0 || item.index >= recoveryOriginalIndexes.length) return;
                const originalIndex = recoveryOriginalIndexes[item.index];
                if (!embeddingMap.has(originalIndex) && Array.isArray(item.embedding) && item.embedding.length > 0) {
                    embeddingMap.set(originalIndex, item.embedding);
                }
            });
        }
        missingIndexes = chunkSources
            .map((_source, index) => index)
            .filter((index) => !embeddingMap.has(index));
    }

    // 全部原始 chunk 均取得向量前不得构造结果，确保外层不发布部分索引。
    if (missingIndexes.length > 0) {
        throw new VectorEmbeddingError_ACU({
            kind: 'retryable',
            message: `Embedding 响应缺失 ${missingIndexes.length}/${chunkSources.length} 条向量（首个缺失原始索引 ${missingIndexes[0]}），为避免索引缺行已中止本批归档。`,
            endpoint: options.embeddingEndpoint,
            model: options.embeddingModel,
        });
    }

    const chunks: ChatSummaryVectorIndexChunk_ACU[] = [];
    const rowChunkIds = new Map<string, string[]>();
    chunkSources.forEach((source, index) => {
        const vector = embeddingMap.get(index) || [];
        if (vector.length === 0) return;
        chunks.push({
            chunkId: source.chunkId,
            rowKey: source.rowKey,
            rowOrder: source.rowIndex,
            text: source.text,
            vector,
            sequence: source.sequence,
        });
        const ids = rowChunkIds.get(source.rowKey) || [];
        ids.push(source.chunkId);
        rowChunkIds.set(source.rowKey, ids);
    });

    const indexedRows: ChatSummaryVectorIndexRow_ACU[] = rows
        .map((row) => ({
            rowKey: row.rowKey,
            rowId: row.rowId,
            rowOrder: row.rowOrder,
            timeSpan: row.timeSpan,
            location: row.location,
            summary: row.summary,
            indexCode: row.indexCode,
            vectorSourceText: '',
            vectorSourceHash: row.vectorSourceHash,
            // 落盘指纹供查询时与实时纪要表对账（filterRowsByLiveSummaryTable_ACU）；
            // 缺失时对账退化为纯 rowKey 比对，"只改概要文本"的编辑会注入旧文本。
            sourceFingerprint: row.sourceFingerprint,
            chunkIds: rowChunkIds.get(row.rowKey) || [],
        }))
        .filter((row) => row.chunkIds.length > 0);

    return { rows: indexedRows, chunks };
}

function buildFinalSummaryVectorIndexRowsAndChunks_ACU(
    rows: ChatSummaryVectorIndexRow_ACU[],
    chunks: ChatSummaryVectorIndexChunk_ACU[],
): { rows: ChatSummaryVectorIndexRow_ACU[]; chunks: ChatSummaryVectorIndexChunk_ACU[] } {
    const finalRows = (Array.isArray(rows) ? rows : [])
        .filter((row) => row?.rowKey && Array.isArray(row.chunkIds) && row.chunkIds.length > 0)
        .sort((a, b) => a.rowOrder - b.rowOrder || a.rowKey.localeCompare(b.rowKey));
    const validRowChunkPairs = new Set<string>();
    finalRows.forEach((row) => {
        row.chunkIds.forEach((chunkId) => validRowChunkPairs.add(`${row.rowKey}:${chunkId}`));
    });
    const finalChunks = (Array.isArray(chunks) ? chunks : [])
        .filter((chunk) => chunk?.rowKey && chunk?.chunkId && validRowChunkPairs.has(`${chunk.rowKey}:${chunk.chunkId}`))
        .map((chunk, index) => ({ ...chunk, sequence: index }));
    return { rows: finalRows, chunks: finalChunks };
}

async function hydrateAggregatedSummaryVectorIndexSnapshot_ACU(
    snapshot: ReturnType<typeof getAggregatedSummaryVectorIndexSnapshot_ACU>,
): Promise<ReturnType<typeof getAggregatedSummaryVectorIndexSnapshot_ACU>> {
    if (!snapshot) return snapshot;
    const hydratedLayers = [] as NonNullable<typeof snapshot>['layers'];
    const rowOwners = new Map<string, { messageIndex: number; row: ChatSummaryVectorIndexRow_ACU }>();
    const mergedRows = new Map<string, ChatSummaryVectorIndexRow_ACU>();
    const mergedChunks = new Map<string, ChatSummaryVectorIndexChunk_ACU>();
    let latestState: ChatSummaryVectorIndexState_ACU | null = null;

    for (const layer of snapshot.layers) {
        const state = cloneSummaryVectorIndexState_ACU(layer.summaryVectorIndexState);
        if (!state) continue;
        if (state.manifest && (!Array.isArray(state.chunks) || state.chunks.length === 0)) {
            try {
                const externalChunks = await loadSummaryVectorIndexChunksFromManifest_ACU(state.manifest);
                if (externalChunks.length > 0) {
                    state.chunks = externalChunks;
                }
            } catch (error) {
                logWarn_ACU('[纪要向量索引] 加载历史外置分片失败，保留该层 manifest，禁止因缺失 chunks 清理旧层:', error);
            }
        }
        hydratedLayers.push({ ...layer, summaryVectorIndexState: state });
        latestState = state;
        state.rows.forEach((row) => {
            if (row.status === 'removed') {
                mergedRows.delete(row.rowKey);
                rowOwners.delete(row.rowKey);
                return;
            }
            mergedRows.set(row.rowKey, row);
            rowOwners.set(row.rowKey, { messageIndex: layer.messageIndex, row });
        });
        (state.chunks || []).forEach((chunk) => mergedChunks.set(chunk.chunkId, chunk));
    }

    if (hydratedLayers.length === 0 || !latestState) return snapshot;
    const rows = Array.from(mergedRows.values());
    const chunks = Array.from(mergedChunks.values()).filter((chunk) => mergedRows.has(chunk.rowKey));
    return {
        summaryVectorIndexState: {
            ...latestState,
            rows,
            ...(chunks.length > 0 ? { chunks } : {}),
            rowCount: rows.length || latestState.rowCount,
            chunkCount: chunks.length || latestState.chunkCount,
        },
        layers: hydratedLayers,
        rowOwners,
    };
}

async function writeSummaryVectorIndexCheckpoint_ACU(options: {
    chat: any[];
    aggregatedSnapshot: ReturnType<typeof getAggregatedSummaryVectorIndexSnapshot_ACU>;
    embeddingModel: string;
    preparedRows: SummaryVectorArchivePreparedRow_ACU[];
    finalRows: ChatSummaryVectorIndexRow_ACU[];
    finalChunks: ChatSummaryVectorIndexChunk_ACU[];
    targetMessageIndex: number;
    snapshotMessageId: string;
    sourceTableKey: string;
    sourceTableName: string;
    indexedAt: string;
    skippedRowCount: number;
    mode: SummaryVectorIndexArchiveMode_ACU;
    isolationKey: string;
    tagIsolationKey: string;
    saveChatAfterWrite?: boolean;
    expectedFlushScopeKey?: string;
    expectedFlushGeneration?: number;
}): Promise<void> {
    const message = options.chat[options.targetMessageIndex];
    if (!message || message.is_user) return;

    const preparedByKey = new Map(options.preparedRows.map((row) => [row.rowKey, row]));
    const finalRowsByKey = new Map(options.finalRows.map((row) => [row.rowKey, row]));
    const previousState = cloneSummaryVectorIndexState_ACU(options.aggregatedSnapshot?.summaryVectorIndexState);
    const previousRows = Array.isArray(previousState?.rows) ? previousState!.rows.filter((row) => row.status !== 'removed') : [];
    const previousChunks = Array.isArray(previousState?.chunks) ? previousState!.chunks : [];
    const previousChunksByRowKey = new Map<string, ChatSummaryVectorIndexChunk_ACU[]>();
    previousChunks.forEach((chunk) => {
        const list = previousChunksByRowKey.get(chunk.rowKey) || [];
        list.push({ ...chunk });
        previousChunksByRowKey.set(chunk.rowKey, list);
    });

    const nextRowsByKey = new Map<string, ChatSummaryVectorIndexRow_ACU>();
    const nextChunksById = new Map<string, ChatSummaryVectorIndexChunk_ACU>();
    if (options.mode === 'append') {
        previousRows.forEach((row) => nextRowsByKey.set(row.rowKey, { ...row }));
        previousChunks.forEach((chunk) => nextChunksById.set(chunk.chunkId, { ...chunk }));
    } else {
        previousRows.forEach((row) => {
            if (preparedByKey.has(row.rowKey)) nextRowsByKey.set(row.rowKey, { ...row });
        });
        previousChunks.forEach((chunk) => {
            if (preparedByKey.has(chunk.rowKey)) nextChunksById.set(chunk.chunkId, { ...chunk });
        });
    }

    options.finalRows.forEach((row) => {
        nextRowsByKey.set(row.rowKey, { ...row });
        const validChunkIds = new Set(row.chunkIds || []);
        Array.from(nextChunksById.values()).forEach((chunk) => {
            if (chunk.rowKey === row.rowKey && !validChunkIds.has(chunk.chunkId)) nextChunksById.delete(chunk.chunkId);
        });
    });
    options.finalChunks.forEach((chunk) => nextChunksById.set(chunk.chunkId, { ...chunk }));

    const removedRowKeys: string[] = [];
    if (options.mode === 'sync') {
        previousRows.forEach((row) => {
            if (!preparedByKey.has(row.rowKey)) {
                removedRowKeys.push(row.rowKey);
                nextRowsByKey.delete(row.rowKey);
                (previousChunksByRowKey.get(row.rowKey) || []).forEach((chunk) => nextChunksById.delete(chunk.chunkId));
            }
        });
    }
    const replacedRowKeys = options.finalRows
        .filter((row) => {
            const previous = previousRows.find((item) => item.rowKey === row.rowKey);
            return !!previous && getSummaryRowFingerprintFromStateRow_ACU(previous) !== getSummaryRowFingerprintFromStateRow_ACU(row);
        })
        .map((row) => row.rowKey);

    const nextRows = Array.from(nextRowsByKey.values())
        .filter((row) => row.rowKey && row.rowId && row.summary && row.indexCode && Array.isArray(row.chunkIds) && row.chunkIds.length > 0)
        .sort((left, right) => left.rowOrder - right.rowOrder || left.rowKey.localeCompare(right.rowKey));
    const validRowKeys = new Set(nextRows.map((row) => row.rowKey));
    const validChunkIds = new Set(nextRows.flatMap((row) => row.chunkIds));
    const nextChunks = Array.from(nextChunksById.values())
        .filter((chunk) => validRowKeys.has(chunk.rowKey) && validChunkIds.has(chunk.chunkId)
            && (Array.isArray(chunk.vector) || chunk.vector instanceof Float32Array)
            && chunk.vector.length > 0)
        .map((chunk, index) => ({ ...chunk, sequence: index }));
    const nextState = buildLayerStateWithRows_ACU(previousState, nextRows, nextChunks, {
        snapshotMessageId: options.snapshotMessageId,
        sourceTableKey: options.sourceTableKey,
        sourceTableName: options.sourceTableName,
        indexedAt: options.indexedAt,
        skippedRowCount: options.skippedRowCount,
    });
    const tagIsolationKey = options.tagIsolationKey;
    const existingTagData = readIsolatedTagData_ACU(message, tagIsolationKey) || {
        independentData: {},
        modifiedKeys: [],
        updateGroupKeys: [],
    };
    let uploadedFiles: SummaryVectorIndexExternalFileRef_ACU[] = [];
    let publishedManifest: any = null;
    let patchState: { summaryVectorIndexState: ChatSummaryVectorIndexState_ACU | null; summaryVectorIndexManifest: any } | null = null;
    if (nextState) {
        const previousManifest = existingTagData.summaryVectorIndexManifest || previousState?.manifest || null;
        const persisted = await persistSummaryVectorIndexSnapshot_ACU({
            chatKey: currentChatFileIdentifier_ACU,
            isolationKey: options.isolationKey,
            previousManifest,
            rows: nextState.rows,
            chunks: nextChunks,
            snapshotMessageId: options.snapshotMessageId,
            sourceTableKey: options.sourceTableKey,
            sourceTableName: options.sourceTableName,
            indexedAt: options.indexedAt,
            skippedRowCount: nextState.skippedRowCount,
            embeddingModel: options.embeddingModel,
            activeRowKeys: nextState.rows.map((row) => row.rowKey),
            activeChunkIds: nextChunks.map((chunk) => chunk.chunkId),
            removedRowKeys,
            replacedRowKeys,
            parentIndexIds: previousManifest?.indexId ? [previousManifest.indexId] : [],
            snapshotRevision: previousManifest?.snapshot?.revision || 0,
            sourceMessageIndex: options.targetMessageIndex,
        });
        uploadedFiles = persisted.uploadedFiles;
        publishedManifest = persisted.manifest;
        patchState = { summaryVectorIndexState: persisted.state, summaryVectorIndexManifest: persisted.manifest };
        logDebug_ACU(`[纪要向量索引] 已写入最新层内容寻址 manifest：operation=write_checkpoint, indexId=${persisted.manifest.indexId || ''}, revision=${persisted.manifest.storageIdentity?.revision ?? persisted.manifest.snapshot?.revision ?? ''}, changed=true`);
    } else {
        patchState = { summaryVectorIndexState: null, summaryVectorIndexManifest: null };
    }
    try {
        // generation fence 必须在最终 metadata mutation 前再次检查。
        if (options.expectedFlushScopeKey && options.expectedFlushGeneration != null) {
            await assertSummaryVectorFlushGenerationCurrent_ACU(
                options.expectedFlushScopeKey,
                options.expectedFlushGeneration,
            );
        }
        await commitVectorMetadataPatch_ACU(message, tagIsolationKey, {
            summaryVectorIndexState: patchState.summaryVectorIndexState,
            summaryVectorIndexManifest: patchState.summaryVectorIndexManifest,
        }, {
            additionalMutate: (targetMessage) => {
                const anchorForMessage = resolveRemoteMemorySnapshotAnchor_ACU(options.chat, options.targetMessageIndex);
                if (anchorForMessage?.anchor) {
                    persistRemoteMemorySnapshotAnchorIfNeeded_ACU(targetMessage, anchorForMessage);
                }
                writeMessageIdentity_ACU(targetMessage, {
                    enabled: settings_ACU.dataIsolationEnabled,
                    code: settings_ACU.dataIsolationCode,
                });
            },
        });
        await finalizeSummaryVectorIndexSnapshotPublication_ACU(uploadedFiles);
    } catch (error) {
        abortSummaryVectorIndexSnapshotPublication_ACU(uploadedFiles);
        if (publishedManifest) {
            logSummaryVectorIndexIdentityEvent_ACU('warn', 'publish', 'orphan_retained', {
                manifest: publishedManifest,
                error,
            });
        }
        throw error;
    }
}

async function clearSummaryVectorIndexCheckpoint_ACU(params: {
    chat: any[];
    targetMessageIndex: number;
    isolationKey: string;
    expectedFlushScopeKey?: string;
    expectedFlushGeneration?: number;
}): Promise<boolean> {
    const message = params.chat?.[params.targetMessageIndex];
    if (!message || message.is_user) return false;
    const isolationKey = params.isolationKey;
    const existingTagData = readIsolatedTagData_ACU(message, isolationKey);
    const manifest = existingTagData?.summaryVectorIndexManifest || existingTagData?.summaryVectorIndexState?.manifest || null;
    if (!existingTagData?.summaryVectorIndexState && !existingTagData?.summaryVectorIndexManifest) return !!manifest;

    try {
        // generation fence 必须在最终 metadata mutation 前再次检查。
        if (params.expectedFlushScopeKey && params.expectedFlushGeneration != null) {
            await assertSummaryVectorFlushGenerationCurrent_ACU(
                params.expectedFlushScopeKey,
                params.expectedFlushGeneration,
            );
        }
        await commitVectorMetadataPatch_ACU(message, isolationKey, {
            summaryVectorIndexState: null,
            summaryVectorIndexManifest: null,
        }, {
            additionalMutate: (targetMessage) => {
                writeMessageIdentity_ACU(targetMessage, {
                    enabled: settings_ACU.dataIsolationEnabled,
                    code: settings_ACU.dataIsolationCode,
                });
            },
        });
    } catch (error) {
        throw error;
    }
    // strict save 成功后才删除旧外置文件；失败时旧 pointer 与文件保持可达。
    if (manifest) {
        try {
            await deleteSummaryVectorIndexExternal_ACU(manifest);
        } catch (error) {
            logWarn_ACU('[纪要向量索引] 空纪要表指针已提交，但旧外置文件延后清理:', error);
        }
    }
    logDebug_ACU(`[纪要向量索引] 当前纪要表无有效条目，已清理目标楼层交火索引 manifest: messageIndex=${params.targetMessageIndex}`);
    return true;
}

export async function migrateLegacySummaryVectorIndexToContentAddressed_ACU(options: { saveChatAfterWrite?: boolean } = {}): Promise<SummaryVectorIndexArchiveResult_ACU> {
    if (options.saveChatAfterWrite === false) {
        return buildResult_ACU({
            success: false,
            reason: 'summary_vector_index_delayed_publish_unsupported',
            errors: ['纪要向量索引不支持延迟保存：没有可跨调用边界确认 durable publish 的安全句柄。'],
        });
    }
    const config = getEffectiveSummaryVectorIndexConfig_ACU();
    const validation = validateSummaryVectorIndexConfig_ACU(config);
    if (!validation.valid) {
        return buildResult_ACU({
            success: false,
            reason: 'summary_vector_index_config_invalid',
            errors: validation.errors,
        });
    }

    const aggregatedSnapshot = await hydrateAggregatedSummaryVectorIndexSnapshot_ACU(getAggregatedSummaryVectorIndexSnapshot_ACU());
    const latestLayer = aggregatedSnapshot?.layers?.[aggregatedSnapshot.layers.length - 1] || null;
    const latestState = cloneSummaryVectorIndexState_ACU(latestLayer?.summaryVectorIndexState || aggregatedSnapshot?.summaryVectorIndexState);
    const manifest = normalizeSummaryVectorIndexManifestForRead_ACU(latestState?.manifest || latestLayer?.tagData?.summaryVectorIndexManifest || null);
    if (!latestLayer || !latestState || !manifest) {
        return buildResult_ACU({
            success: true,
            skipped: true,
            reason: 'no_manifest',
        });
    }
    if (!isLegacySummaryVectorIndexManifest_ACU(manifest)) {
        return buildResult_ACU({
            success: true,
            skipped: true,
            indexedRowCount: latestState.rowCount || 0,
            chunkCount: latestState.chunkCount || 0,
            messageIndex: latestLayer.messageIndex,
            summaryKey: manifest.sourceTableKey,
            reason: 'already_content_addressed',
        });
    }

    const chunks = await loadSummaryVectorIndexChunksFromManifest_ACU(manifest, { preferExternalFiles: true });
    const chunksById = new Map(chunks.map((chunk) => [chunk.chunkId, chunk]));
    const activeRowKeys = new Set(manifest.snapshot?.activeRowKeys || []);
    const activeChunkIds = new Set(manifest.snapshot?.activeChunkIds || []);
    const rows = (Array.isArray(latestState.rows) ? latestState.rows : [])
        .filter((row) => row && row.status !== 'removed')
        .filter((row) => activeRowKeys.size === 0 || activeRowKeys.has(row.rowKey))
        .map((row) => {
            const chunkIds = (Array.isArray(row.chunkIds) ? row.chunkIds : [])
                .filter((chunkId) => chunksById.has(chunkId))
                .filter((chunkId) => activeChunkIds.size === 0 || activeChunkIds.has(chunkId));
            return { ...row, chunkIds };
        })
        .filter((row) => row.rowKey && row.rowId && row.summary && row.indexCode && row.chunkIds.length > 0);
    const validChunkIds = new Set(rows.flatMap((row) => row.chunkIds));
    const finalChunks = chunks
        .filter((chunk) => validChunkIds.has(chunk.chunkId))
        .map((chunk, index) => ({ ...chunk, sequence: index }));

    if (rows.length === 0 || finalChunks.length === 0) {
        return buildResult_ACU({
            success: false,
            messageIndex: latestLayer.messageIndex,
            summaryKey: manifest.sourceTableKey,
            reason: 'legacy_manifest_missing_rows_or_chunks',
            errors: ['旧交火索引可读取外置分片，但楼层缺少可迁移的行状态；为避免破坏旧数据，已拒绝半迁移。'],
        });
    }

    const chat = getChatArray_ACU();
    const message = chat?.[latestLayer.messageIndex];
    if (!message || message.is_user) {
        return buildResult_ACU({
            success: false,
            reason: 'target_message_invalid',
            errors: ['旧交火索引所在楼层不存在或不是 AI 楼层，无法安全写入迁移 manifest。'],
        });
    }

    // 聊天容器槽与 V2 持久化 identity 不是同一个概念：空槽必须保留，
    // 但新 V2 对象必须使用 canonical default identity。
    const tagIsolationKey = latestLayer.isolationKey;
    const isolationKey = normalizeSummaryVectorIndexScope_ACU({ isolationKey: tagIsolationKey }).isolationKey;
    const existingTagData = readIsolatedTagData_ACU(message, tagIsolationKey) || {
        independentData: {},
        modifiedKeys: [],
        updateGroupKeys: [],
    };
    const indexedAt = new Date().toISOString();
    const persisted = await persistSummaryVectorIndexSnapshot_ACU({
        chatKey: manifest.chatKey || currentChatFileIdentifier_ACU,
        isolationKey,
        previousManifest: manifest,
        rows,
        chunks: finalChunks,
        snapshotMessageId: manifest.snapshotMessageId || latestState.snapshotMessageId || String(latestLayer.messageIndex),
        sourceTableKey: manifest.sourceTableKey || latestState.sourceTableKey || 'summary',
        sourceTableName: manifest.sourceTableName || latestState.sourceTableName || '纪要表',
        indexedAt,
        skippedRowCount: latestState.skippedRowCount || manifest.skippedRowCount || 0,
        embeddingModel: manifest.embeddingModel || config.embeddingModel,
        activeRowKeys: rows.map((row) => row.rowKey),
        activeChunkIds: finalChunks.map((chunk) => chunk.chunkId),
        removedRowKeys: manifest.snapshot?.removedRowKeys || [],
        replacedRowKeys: [],
        parentIndexIds: manifest.indexId ? [manifest.indexId] : [],
        snapshotRevision: manifest.snapshot?.revision || 0,
        sourceMessageIndex: latestLayer.messageIndex,
    });

    try {
        // CAS：expected indexId 必须仍为旧 manifest 的 indexId；CAS 冲突不得覆盖较新的 pointer。
        await commitVectorMetadataPatch_ACU(message, tagIsolationKey, {
            summaryVectorIndexState: persisted.state,
            summaryVectorIndexManifest: persisted.manifest,
        }, {
            expectedIndexId: manifest.indexId,
            additionalMutate: (targetMessage) => {
                writeMessageIdentity_ACU(targetMessage, {
                    enabled: settings_ACU.dataIsolationEnabled,
                    code: settings_ACU.dataIsolationCode,
                });
            },
        });
        await finalizeSummaryVectorIndexSnapshotPublication_ACU(persisted.uploadedFiles);
    } catch (error) {
        abortSummaryVectorIndexSnapshotPublication_ACU(persisted.uploadedFiles);
        logSummaryVectorIndexIdentityEvent_ACU('warn', 'publish', 'orphan_retained', {
            manifest: persisted.manifest,
            error,
        });
        throw error;
    }
    logDebug_ACU(`[纪要向量索引] 已非破坏迁移旧 shard manifest 到内容寻址协议：operation=migrate_legacy_manifest, old=${manifest.indexId}, new=${persisted.manifest.indexId}, revision=${persisted.manifest.storageIdentity?.revision ?? persisted.manifest.snapshot?.revision ?? ''}, changed=true`);
    return buildResult_ACU({
        success: true,
        skipped: false,
        indexedRowCount: persisted.manifest.rowCount,
        skippedRowCount: persisted.manifest.skippedRowCount,
        chunkCount: persisted.manifest.chunkCount,
        messageIndex: latestLayer.messageIndex,
        summaryKey: persisted.manifest.sourceTableKey,
        reason: 'legacy_manifest_migrated_non_destructive',
    });
}

export async function archiveSummaryVectorIndexNow_ACU(options: SummaryVectorIndexArchiveOptions_ACU = {}): Promise<SummaryVectorIndexArchiveResult_ACU> {
    if (options.saveChatAfterWrite === false) {
        return buildResult_ACU({
            success: false,
            reason: 'summary_vector_index_delayed_publish_unsupported',
            errors: ['纪要向量索引不支持延迟保存：没有可跨调用边界确认 durable publish 的安全句柄。'],
        });
    }
    const config = getEffectiveSummaryVectorIndexConfig_ACU();
    const validation = validateSummaryVectorIndexConfig_ACU(config);
    if (!validation.valid) {
        return buildResult_ACU({
            success: false,
            reason: 'summary_vector_index_config_invalid',
            errors: validation.errors,
        });
    }

    const activeTagIsolationKey = getCurrentIsolationKey_ACU();
    const activeIsolationKey = normalizeSummaryVectorIndexScope_ACU({ isolationKey: activeTagIsolationKey }).isolationKey;
    const requestedIsolationKey = options.isolationKey == null
        ? activeIsolationKey
        : normalizeSummaryVectorIndexScope_ACU({ isolationKey: options.isolationKey }).isolationKey;
    if (requestedIsolationKey !== activeIsolationKey) {
        return buildResult_ACU({ success: false, reason: 'archive_scope_not_active', errors: ['归档只能处理当前激活的 isolation scope。'] });
    }
    const isolationKey = requestedIsolationKey;
    const tagIsolationKey = options.tagIsolationKey ?? activeTagIsolationKey;
    const selectedSummary = findSummaryTable_ACU(options.sourceTableKey);
    if (!selectedSummary) {
        return buildResult_ACU({
            success: true,
            skipped: true,
            reason: 'summary_table_not_found',
        });
    }

    const targetMessageIndex = resolveTargetMessageIndex_ACU(options.targetMessageIndex);
    if (targetMessageIndex < 0) {
        return buildResult_ACU({
            success: false,
            reason: 'target_message_not_found',
            errors: ['未找到可写入纪要向量索引的 AI 楼层。'],
        });
    }

    const chat = getChatArray_ACU();
    const targetMessage = chat[targetMessageIndex];
    if (!targetMessage || targetMessage.is_user) {
        return buildResult_ACU({
            success: false,
            reason: 'target_message_invalid',
            errors: ['目标楼层不是可写入的 AI 消息。'],
        });
    }

    const archiveScopeKey = buildSummaryVectorIndexArchiveScopeKey_ACU({
        chatKey: currentChatFileIdentifier_ACU,
        isolationKey,
        sourceTableKey: selectedSummary.summaryKey,
    });
    return runSummaryVectorIndexArchiveWithScopeLock_ACU(archiveScopeKey, () => archiveSummaryVectorIndexNowUnlocked_ACU({
        ...options,
        isolationKey,
        tagIsolationKey,
        sourceTableKey: selectedSummary.summaryKey,
    }));
}

async function archiveSummaryVectorIndexNowUnlocked_ACU(options: SummaryVectorIndexArchiveOptions_ACU = {}): Promise<SummaryVectorIndexArchiveResult_ACU> {
    const config = getEffectiveSummaryVectorIndexConfig_ACU();
    const validation = validateSummaryVectorIndexConfig_ACU(config);
    if (!validation.valid) {
        return buildResult_ACU({
            success: false,
            reason: 'summary_vector_index_config_invalid',
            errors: validation.errors,
        });
    }

    const activeTagIsolationKey = getCurrentIsolationKey_ACU();
    const activeIsolationKey = normalizeSummaryVectorIndexScope_ACU({ isolationKey: activeTagIsolationKey }).isolationKey;
    const requestedIsolationKey = options.isolationKey == null
        ? activeIsolationKey
        : normalizeSummaryVectorIndexScope_ACU({ isolationKey: options.isolationKey }).isolationKey;
    if (requestedIsolationKey !== activeIsolationKey) {
        return buildResult_ACU({ success: false, reason: 'archive_scope_not_active', errors: ['归档只能处理当前激活的 isolation scope。'] });
    }
    const isolationKey = requestedIsolationKey;
    const tagIsolationKey = options.tagIsolationKey ?? activeTagIsolationKey;
    const selectedSummary = findSummaryTable_ACU(options.sourceTableKey);
    if (!selectedSummary) {
        return buildResult_ACU({
            success: true,
            skipped: true,
            reason: 'summary_table_not_found',
        });
    }

    const targetMessageIndex = resolveTargetMessageIndex_ACU(options.targetMessageIndex);
    if (targetMessageIndex < 0) {
        return buildResult_ACU({
            success: false,
            reason: 'target_message_not_found',
            errors: ['未找到可写入纪要向量索引的 AI 楼层。'],
        });
    }

    const chat = getChatArray_ACU();
    const targetMessage = chat[targetMessageIndex];
    if (!targetMessage || targetMessage.is_user) {
        return buildResult_ACU({
            success: false,
            reason: 'target_message_invalid',
            errors: ['目标楼层不是可写入的 AI 消息。'],
        });
    }

    const snapshotAnchor = resolveRemoteMemorySnapshotAnchor_ACU(chat, targetMessageIndex);
    if (!snapshotAnchor?.anchor) {
        return buildResult_ACU({
            success: false,
            reason: 'snapshot_anchor_unresolved',
            errors: ['目标楼层缺少可用的本地聊天记录锚点，无法写入纪要向量索引。'],
        });
    }
    const snapshotMessageId = snapshotAnchor.anchor;

    const prepared = buildPreparedRows_ACU(selectedSummary.table, selectedSummary.summaryKey);
    if (prepared.error) {
        return buildResult_ACU({
            success: false,
            summaryKey: selectedSummary.summaryKey,
            messageIndex: targetMessageIndex,
            reason: 'summary_vector_index_prepare_failed',
            errors: [prepared.error],
        });
    }
    if (prepared.rows.length === 0) {
        const archiveMode: SummaryVectorIndexArchiveMode_ACU = options.mode === 'append' ? 'append' : 'sync';
        if (archiveMode === 'sync') {
            try {
                const cleared = await clearSummaryVectorIndexCheckpoint_ACU({
                    chat,
                    targetMessageIndex,
                    isolationKey: tagIsolationKey,
                    expectedFlushScopeKey: options.expectedFlushScopeKey,
                    expectedFlushGeneration: options.expectedFlushGeneration,
                });
                return buildResult_ACU({
                    success: true,
                    skipped: !cleared,
                    summaryKey: selectedSummary.summaryKey,
                    messageIndex: targetMessageIndex,
                    skippedRowCount: prepared.skippedRowCount,
                    reason: cleared ? 'summary_vector_index_cleared_no_effective_rows' : 'no_effective_rows',
                });
            } catch (error: any) {
                logWarn_ACU('[纪要向量索引] 清理空纪要表索引失败:', error);
                return buildResult_ACU({
                    success: false,
                    skipped: false,
                    summaryKey: selectedSummary.summaryKey,
                    messageIndex: targetMessageIndex,
                    skippedRowCount: prepared.skippedRowCount,
                    reason: 'summary_vector_index_clear_failed',
                    errors: [normalizeText_ACU(error?.message) || '纪要向量索引清理失败'],
                });
            }
        }
        return buildResult_ACU({
            success: true,
            skipped: true,
            summaryKey: selectedSummary.summaryKey,
            messageIndex: targetMessageIndex,
            skippedRowCount: prepared.skippedRowCount,
            reason: 'no_effective_rows',
        });
    }

    try {
        const archiveMode: SummaryVectorIndexArchiveMode_ACU = options.mode === 'append' ? 'append' : 'sync';
        logDebug_ACU(`[纪要向量索引] 本次归档模式: ${archiveMode}`);
        const aggregatedSnapshot = await hydrateAggregatedSummaryVectorIndexSnapshot_ACU(getAggregatedSummaryVectorIndexSnapshot_ACU());
        const existingState = cloneSummaryVectorIndexState_ACU(aggregatedSnapshot?.summaryVectorIndexState);
        // T2：embedding 模型失效闸门。
        // 指纹公式不含模型身份（D1），若模型已变而静默复用旧行，召回会用旧模型向量打分。
        // 比对 existingState.manifest.embeddingModel 与当前 config；不一致则整个 scope 判不可复用、全量重算。
        // 旧 manifest 缺 embeddingModel 字段时视为相同，避免历史索引误判全量重算。
        // 维度一致性由 persist 在写入前收紧校验（混维拒绝写入）。
        const existingManifestModel = existingState?.manifest?.embeddingModel;
        const embeddingIdentityChanged = existingManifestModel != null
            && String(existingManifestModel).trim() !== String(config.embeddingModel).trim();
        if (embeddingIdentityChanged) {
            logSummaryVectorIndexIdentityEvent_ACU('warn', 'archive', 'embedding_identity_changed_full_rebuild', {
                scopeFingerprint: buildSummaryVectorIndexArchiveScopeKey_ACU({
                    chatKey: currentChatFileIdentifier_ACU,
                    isolationKey,
                    sourceTableKey: selectedSummary.summaryKey,
                }),
                error: `model=${String(existingManifestModel).trim()} → ${String(config.embeddingModel).trim()}`,
            });
        }
        const reusable = embeddingIdentityChanged
            ? { reusableRows: [] as ChatSummaryVectorIndexRow_ACU[], reusableChunks: [] as ChatSummaryVectorIndexChunk_ACU[], rowsNeedingEmbedding: prepared.rows }
            : buildExistingReusableRows_ACU(prepared.rows, existingState);
        const rowsNeedingEmbedding = reusable.rowsNeedingEmbedding;
        const activeRowKeysUnchanged = areSummaryVectorActiveRowKeysSame_ACU(prepared.rows, existingState);
        const existingActiveRowCount = existingState?.manifest?.snapshot?.activeRowKeys?.length || existingState?.rows?.length || 0;
        logDebug_ACU(`[纪要向量索引] 增量归档判定：operation=incremental_archive_eval, scope=${selectedSummary.summaryKey}, indexId=${existingState?.manifest?.indexId || ''}, changed=${!activeRowKeysUnchanged || rowsNeedingEmbedding.length > 0 || prepared.skippedRowCount > 0}`);
        if (!options.force && rowsNeedingEmbedding.length === 0 && existingState?.manifest && activeRowKeysUnchanged) {
            logDebug_ACU('[纪要向量索引] 当前纪要表未发现新增、变更或删除条目，跳过重复覆盖上传。');
            return buildResult_ACU({
                success: true,
                skipped: true,
                summaryKey: selectedSummary.summaryKey,
                messageIndex: targetMessageIndex,
                skippedRowCount: prepared.skippedRowCount,
                reason: 'no_changes_skip_snapshot_upload',
            });
        }
        if (options.force) {
            logDebug_ACU('[纪要向量索引] force=true，强制执行归档写入（跳过无变更检测）。');
        }
        const indexedAt = new Date().toISOString();
        const sourceTableName = normalizeText_ACU(selectedSummary.table?.name) || '纪要表';
        const maxRowsPerBatch = Math.max(1, Math.floor(Number(config.summaryIndexArchiveMaxConcurrency) || 30));
        // T0b：在任何 embedding 请求之前做路径 preflight，用长度上界占位值试算。
        // 若失败（scope 本身超长），立即返回结构化失败，不发起任何 embedding 请求。
        const pathPreflight = preflightVectorIndexSnapshotPath_ACU({
            chatKey: currentChatFileIdentifier_ACU,
            isolationKey,
            sourceTableKey: selectedSummary.summaryKey,
        });
        if (!pathPreflight.ok) {
            logWarn_ACU(`[纪要向量索引] 归档前路径 preflight 失败，未发起 embedding：${pathPreflight.error}`);
            return buildResult_ACU({
                success: false,
                skipped: false,
                summaryKey: selectedSummary.summaryKey,
                messageIndex: targetMessageIndex,
                reason: 'vector_index_path_too_long',
                retryability: 'terminal',
                errors: [pathPreflight.error || '快照路径长度超出宿主安全上限'],
            });
        }
        const embeddedRows: ChatSummaryVectorIndexRow_ACU[] = [];
        const embeddedChunks: ChatSummaryVectorIndexChunk_ACU[] = [];

        // T9：归档 embedding 批次有界并发。
        // 串行时批次 k 的 existingSequenceBase = 前 k 批的 chunk 总数；并发下无法等前批完成再算，
        // 因此按批预分配 sequence 区间：批次 k 的 base = sum(前 k 批的 chunk 数)。
        // chunk 切分是确定性函数（chunkTextBySentenceCount_ACU），可精确预计算每批 chunk 数，
        // 保证并发下最终 chunks 的 sequence 序与串行完全一致。
        const batchConcurrency = Math.max(1, Math.floor(Number(config.summaryIndexArchiveEmbeddingConcurrency) || 3));
        const chunkOptions = {
            sentenceCount: config.summaryIndexChunkSentenceCount,
            chunkBySentence: config.summaryIndexChunkChronicleBySentence === true,
        };
        const batchChunkCounts: number[] = [];
        const batchRowGroups: SummaryVectorArchivePreparedRow_ACU[][] = [];
        for (let startIndex = 0; startIndex < rowsNeedingEmbedding.length; startIndex += maxRowsPerBatch) {
            const rowBatch = rowsNeedingEmbedding.slice(startIndex, startIndex + maxRowsPerBatch);
            if (rowBatch.length === 0) continue;
            batchRowGroups.push(rowBatch);
            let chunkCount = 0;
            for (const row of rowBatch) {
                chunkCount += buildRowChunkTexts_ACU(row.vectorSourceText, chunkOptions).length;
            }
            batchChunkCounts.push(chunkCount);
        }
        // 有界并发：同时最多 batchConcurrency 个批次在飞。取批次 + 分配 sequence base 在同一同步块内完成
        // （JS 单线程，nextBatchIndex++ / sequenceBase 读改写之间无 await），无竞争。
        const batchResults: Array<{ rows: ChatSummaryVectorIndexRow_ACU[]; chunks: ChatSummaryVectorIndexChunk_ACU[] } | null> =
            new Array(batchRowGroups.length).fill(null);
        let nextBatchIndex = 0;
        let sequenceBase = 0;
        const workerCount = Math.max(1, Math.min(batchConcurrency, batchRowGroups.length));
        const workers = Array.from({ length: workerCount }, async () => {
            while (true) {
                const batchIndex = nextBatchIndex;
                if (batchIndex >= batchRowGroups.length) break;
                nextBatchIndex += 1;
                const mySequenceBase = sequenceBase;
                sequenceBase += batchChunkCounts[batchIndex];
                const batchResult = await buildChunksWithEmbeddings_ACU(batchRowGroups[batchIndex], {
                    snapshotMessageId,
                    sentenceCount: chunkOptions.sentenceCount,
                    chunkBySentence: chunkOptions.chunkBySentence,
                    embeddingEndpoint: config.embeddingEndpoint,
                    embeddingApiKey: config.embeddingApiKey,
                    embeddingModel: config.embeddingModel,
                    existingSequenceBase: mySequenceBase,
                });
                batchResults[batchIndex] = batchResult;
            }
        });
        await Promise.all(workers);
        // 按批号顺序合并，保证 embeddedRows / embeddedChunks 顺序与串行一致。
        for (const batchResult of batchResults) {
            if (!batchResult) continue;
            embeddedRows.push(...batchResult.rows);
            embeddedChunks.push(...batchResult.chunks);
        }

        const finalResult = buildFinalSummaryVectorIndexRowsAndChunks_ACU(
            [...reusable.reusableRows, ...embeddedRows],
            [...reusable.reusableChunks, ...embeddedChunks],
        );
        if (finalResult.rows.length === 0 || finalResult.chunks.length === 0) {
            return buildResult_ACU({
                success: false,
                summaryKey: selectedSummary.summaryKey,
                messageIndex: targetMessageIndex,
                reason: 'embedding_empty',
                errors: ['纪要向量索引 embedding 结果为空。'],
            });
        }

        // ── vectorizeOnly 模式：只向量化，归档由防抖触发 ──
        if (options.vectorizeOnly) {
            const scopeKey = buildSummaryVectorIndexArchiveScopeKey_ACU({
                chatKey: currentChatFileIdentifier_ACU,
                isolationKey,
                sourceTableKey: selectedSummary.summaryKey,
            });
            pendingVectorIndexArchives_ACU.set(scopeKey, {
                chat,
                aggregatedSnapshot,
                embeddingModel: config.embeddingModel,
                preparedRows: prepared.rows,
                finalRows: finalResult.rows,
                finalChunks: finalResult.chunks,
                targetMessageIndex,
                snapshotMessageId,
                isolationKey,
                tagIsolationKey,
                sourceTableKey: selectedSummary.summaryKey,
                sourceTableName,
                indexedAt,
                skippedRowCount: prepared.skippedRowCount,
                mode: archiveMode,
                expectedFlushScopeKey: options.expectedFlushScopeKey,
                expectedFlushGeneration: options.expectedFlushGeneration,
            });
            scheduleDebouncedVectorIndexPersist_ACU(scopeKey);
            logDebug_ACU(`[纪要向量索引] 向量化完成，已存入待归档队列：operation=queue_archive, scope=${scopeKey}, changed=true`);
            return buildResult_ACU({
                success: true,
                skipped: false,
                indexedRowCount: finalResult.rows.length,
                skippedRowCount: prepared.skippedRowCount + (prepared.rows.length - finalResult.rows.length),
                chunkCount: finalResult.chunks.length,
                messageIndex: targetMessageIndex,
                summaryKey: selectedSummary.summaryKey,
                reason: 'vectorized_pending_debounced_archive',
            });
        }

        // ── 立即归档模式：向量化后直接写入外置文件 ──
        await writeSummaryVectorIndexCheckpoint_ACU({
            chat,
            aggregatedSnapshot,
            embeddingModel: config.embeddingModel,
            preparedRows: prepared.rows,
            finalRows: finalResult.rows,
            finalChunks: finalResult.chunks,
            targetMessageIndex,
            snapshotMessageId,
            sourceTableKey: selectedSummary.summaryKey,
            sourceTableName,
            indexedAt,
            skippedRowCount: prepared.skippedRowCount,
            mode: archiveMode,
            isolationKey,
            tagIsolationKey,
            expectedFlushScopeKey: options.expectedFlushScopeKey,
            expectedFlushGeneration: options.expectedFlushGeneration,
            saveChatAfterWrite: true,
        });

        return buildResult_ACU({
            success: true,
            skipped: false,
            indexedRowCount: finalResult.rows.length,
            skippedRowCount: prepared.skippedRowCount + (prepared.rows.length - finalResult.rows.length),
            chunkCount: finalResult.chunks.length,
            messageIndex: targetMessageIndex,
            summaryKey: selectedSummary.summaryKey,
            reason: 'archived_summary_vector_index',
        });
    } catch (error: any) {
        logWarn_ACU('[纪要向量索引] 归档失败，未修改纪要表原条目:', error);
        if (error instanceof SummaryVectorFlushGenerationInvalidatedError_ACU) {
            return buildResult_ACU({
                success: false,
                skipped: true,
                summaryKey: selectedSummary.summaryKey,
                messageIndex: targetMessageIndex,
                reason: 'flush_scope_invalidated',
                errors: [],
            });
        }
        // T4：识别结构化 embedding 错误，把 terminal / retryable 分类传导给 flush runner。
        // terminal（credential / request / provider-contract）→ 停止重排；retryable → 继续有限重试。
        if (isVectorEmbeddingError_ACU(error)) {
            const terminalKinds = new Set(['credential', 'request', 'provider-contract']);
            const embeddingRetryability: 'retryable' | 'terminal' = terminalKinds.has(error.kind) ? 'terminal' : 'retryable';
            const detail = error.providerMessage || error.message;
            const credentialFingerprint = error.kind === 'credential'
                ? hashUserInput_ACU([
                    String(config.embeddingEndpoint || '').trim(),
                    String(config.embeddingModel || '').trim(),
         String(config.embeddingApiKey || '').trim(),
                ].join('|'))
                : undefined;
            return buildResult_ACU({
                success: false,
                skipped: false,
                summaryKey: selectedSummary.summaryKey,
                messageIndex: targetMessageIndex,
                reason: 'embedding_request_failed',
                retryability: embeddingRetryability,
                ...(credentialFingerprint ? { credentialFingerprint } : {}),
                errors: [`Embedding 请求失败（${error.kind}${error.httpStatus != null ? `, HTTP ${error.httpStatus}` : ''}）: ${detail}`],
            });
        }
        return buildResult_ACU({
            success: false,
            skipped: false,
            summaryKey: selectedSummary.summaryKey,
            messageIndex: targetMessageIndex,
            reason: 'summary_vector_index_archive_failed',
            errors: [normalizeText_ACU(error?.message) || '纪要向量索引归档失败'],
        });
    }
}

export function buildSummaryVectorIndexBatchId_ACU(state: ChatSummaryVectorIndexState_ACU): string {
    const source = `${state.snapshotMessageId}:${state.sourceTableKey}:${state.indexedAt}:${state.rowCount}:${state.chunkCount}`;
    return `summary-vector-index:${hashUserInput_ACU(source)}`;
}
