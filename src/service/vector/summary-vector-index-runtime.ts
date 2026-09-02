import { createEmbeddings_ACU } from '../../data/gateways/vector-embedding-gateway';
import { createRerankScores_ACU } from '../../data/gateways/vector-rerank-gateway';
import { currentChatFileIdentifier_ACU } from '../runtime/state-manager';
import { readIsolatedTagData_ACU } from '../../data/repositories/chat-message-data-repo';
import { commitVectorMetadataPatch_ACU } from './summary-vector-index-chat-commit';
import { loadVectorIndexRegistry_ACU, readVectorIndexJsonFile_ACU } from '../../data/storage/vector-index-st-files-storage';
import { logDebug_ACU, logError_ACU, logWarn_ACU } from '../../shared/utils';
import { normalizeSummaryVectorIndexScope_ACU, normalizeSummaryVectorIsolationKey_ACU } from '../../shared/summary-vector-index-scope';
import { getChatArray_ACU } from '../chat/chat-service';
import { callAIWithPreset_ACU } from '../ai/api-call';
import { getCurrentWorldbookConfig_ACU } from '../settings/settings-readers';
import { globalMeta_ACU } from '../../data/repositories/profile-repo';
import { getInjectionTargetLorebook_ACU, getIsolationPrefix_ACU } from '../worldbook/injection-engine';
import {
    createLorebookEntries_ACU,
    getLorebookEntries_ACU,
    isWorldbookApiAvailable_ACU,
    setLorebookEntries_ACU,
} from '../worldbook/worldbook-service';
import { getEffectiveSummaryVectorIndexConfig_ACU, validateSummaryVectorIndexConfig_ACU } from './vector-memory-config';
import {
    getLatestSummaryVectorIndexSnapshotState_ACU,
} from './summary-vector-index-state-service';
import {
    loadSummaryVectorIndexChunksFromManifest_ACU,
    logSummaryVectorIndexIdentityEvent_ACU,
    validateSingleFileSnapshotIdentity_ACU,
    type VectorIndexSingleSnapshotBlob_ACU,
} from './summary-vector-index-storage-service';
import {
    clearLatestSummaryVectorIndexStateForInvalidExternalFiles_ACU,
    clearLatestSummaryVectorIndexStateForMissingExternalFiles_ACU,
    isInvalidExternalVectorFileError_ACU,
    isMissingExternalVectorFileError_ACU,
} from './summary-vector-index-cache-service';
import type {
    ChatSummaryVectorIndexChunk_ACU,
    ChatSummaryVectorIndexManifest_ACU,
    ChatSummaryVectorIndexRow_ACU,
    ChatSummaryVectorIndexState_ACU,
    SummaryVectorIndexSnapshotLayer_ACU,
} from './summary-vector-index-types';
import {
    reciprocalRankFusion_ACU,
    sparseSearchBm25_ACU,
    type SummaryHybridCandidate_ACU,
} from './summary-vector-hybrid-retrieval';
import {
    buildPreparedRows_ACU,
    findSummaryTable_ACU,
    type SummaryVectorArchivePreparedRow_ACU,
} from './summary-vector-index-archive-service';

export interface SummaryVectorIndexRuntimeOptions_ACU {
    userInput?: string;
    source?: string;
    /**
     * 跳过 8s 去重窗口。仅供"索引自愈重建后在同一次发送里补跑召回"使用：
     * 第一次调用已登记签名，不绕过的话补跑会被当作重复钩子触发直接去重掉。
     */
    bypassDedupe?: boolean;
}

export interface SummaryVectorIndexRuntimeResult_ACU {
    success: boolean;
    skipped?: boolean;
    reason?: string;
    keywordCount?: number;
    candidateCount?: number;
    injectedCount?: number;
    denseCandidateCount?: number;
    sparseCandidateCount?: number;
    fusionCandidateCount?: number;
    /** rerank 阶段的实际结果：applied 才代表重排序真正参与了本轮选取。 */
    rerankStatus?: SummaryRerankStatus_ACU;
    rerankError?: string;
    /** 本轮送去 rerank 的 documents 条数（按行去重后）。 */
    rerankDocumentCount?: number;
    /** 关键词 AI 是否参与了本轮 query 构造。 */
    keywordGenerationEnabled?: boolean;
}

interface RankedSummaryCandidate_ACU extends SummaryHybridCandidate_ACU {
    chunk: ChatSummaryVectorIndexChunk_ACU;
    row: ChatSummaryVectorIndexRow_ACU;
    score: number;
    rerankScore?: number;
}

// T12：recent-fixed 注入项与排序候选的判别联合。recent_fixed 项不携带 chunk（无向量，
// 不参与 rerank / 排序），只提供 row 用于覆盖内容输出；ranked 项来自 dense/sparse/fusion。
type SummaryIndexSelectedCandidate_ACU =
    | { kind: 'recent_fixed'; row: ChatSummaryVectorIndexRow_ACU }
    | { kind: 'ranked'; chunk: ChatSummaryVectorIndexChunk_ACU; row: ChatSummaryVectorIndexRow_ACU; score: number; rerankScore?: number };

let lastRuntimeSignature_ACU = '';
let lastRuntimeAt_ACU = 0;
const SUMMARY_VECTOR_INDEX_RUNTIME_DEDUPE_MS_ACU = 8000;

/** 重置去重窗口状态（测试隔离用；生产路径依赖签名中的 chatKey 自然区分聊天）。 */
export function resetSummaryVectorIndexRuntimeDedupeState_ACU(): void {
    lastRuntimeSignature_ACU = '';
    lastRuntimeAt_ACU = 0;
}

function normalizeText_ACU(value: any): string {
    return String(value ?? '').trim();
}

function buildRecentContext_ACU(pairCount: number): string {
    const chat = getChatArray_ACU();
    if (!Array.isArray(chat) || chat.length === 0) return '';
    const limit = Math.max(2, Math.min(chat.length, Math.max(1, pairCount) * 2 + 2));
    return chat.slice(Math.max(0, chat.length - limit))
        .map((message: any) => {
            const role = message?.is_user ? '用户' : 'AI';
            const text = normalizeText_ACU(message?.mes).replace(/<[^>]+>/g, '').trim();
            return text ? `${role}: ${text}` : '';
        })
        .filter(Boolean)
        .join('\n');
}

function renderKeywordPromptMessages_ACU(segments: any[], variables: { recentContext: string; userInput: string }): any[] {
    return (Array.isArray(segments) ? segments : [])
        .map((segment) => ({
            role: ['system', 'assistant', 'user'].includes(String(segment?.role || '').toLowerCase())
                ? String(segment.role).toLowerCase()
                : 'user',
            content: normalizeText_ACU(segment?.content)
                .replace(/\$RECENT_CONTEXT/g, variables.recentContext)
                .replace(/\$USER_INPUT/g, variables.userInput),
        }))
        .filter((segment) => segment.content);
}

function extractTaggedContent_ACU(text: string, tagName: string): string {
    const source = String(text || '');
    const pattern = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
    const match = source.match(pattern);
    return match ? String(match[1] || '').trim() : '';
}

function stripThinkingBlocks_ACU(text: string): string {
    return String(text || '')
        .replace(/<thinking[^>]*>[\s\S]*?<\/thinking>/gi, '')
        .replace(/<thought[^>]*>[\s\S]*?<\/thought>/gi, '')
        .replace(/<\/?(?:thinking|thought)[^>]*>/gi, '')
        .trim();
}

function parseKeywords_ACU(text: string): string[] {
    const normalized = normalizeText_ACU(text);
    // 优先：从 <keywords> 标签提取
    let keywordContent = extractTaggedContent_ACU(normalized, 'keywords');
    // 回退：从 "关键词：" 前缀提取（兼容不遵循 XML 标签的 AI 输出）
    if (!keywordContent) {
        const stripped = stripThinkingBlocks_ACU(normalized);
        const fallbackMatch = stripped.match(/关键词[：:]\s*([\s\S]+?)$/i);
        if (fallbackMatch) {
            keywordContent = fallbackMatch[1].trim();
            logDebug_ACU('[交火模式纪要索引] AI 未使用 <keywords> 标签，已从"关键词："前缀回退提取。');
        }
    }
    if (!keywordContent) {
        logWarn_ACU('[交火模式纪要索引] AI 回复中未找到 <keywords> 标签或"关键词："前缀，跳过关键词提取。');
        return [];
    }
    return Array.from(new Set(keywordContent
        .replace(/<[^>]+>/g, '')
        .split(/[，,、\n;；|]/g)
        .map((item) => item.replace(/^[-*\d.、\s]+/, '').trim())
        .filter((item) => item.length > 0)
        .slice(0, 24)));
}

async function generateKeywords_ACU(config: any, userInput: string): Promise<string[]> {
    // 用户可关闭关键词 AI：query 只用输入本身，省一次 LLM 往返。缺省（老配置无字段）视为开启。
    if (config.keywordGenerationEnabled === false) return [];
    const recentContext = buildRecentContext_ACU(config.keywordContextPairCount || 1);
    const messages = renderKeywordPromptMessages_ACU(config.keywordPromptGroup || [], { recentContext, userInput });
    if (messages.length === 0) return [];
    const attempts = Math.max(1, Number(config.keywordGenerationMaxAttempts) || 1);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            const response = await callAIWithPreset_ACU(messages, config.keywordApiPreset || '');
            const keywords = parseKeywords_ACU(response || '');
            if (keywords.length > 0) return keywords;
        } catch (error) {
            logWarn_ACU(`[交火模式纪要索引] 关键词生成失败 ${attempt}/${attempts}:`, error);
        }
    }
    return [];
}

// T10：query 向量模长预计算。与 cosineSimilarity_ACU 内部的 leftNorm 算法逐位一致，
// 外提后循环内不再重复累加 query 的平方和。
function computeVectorNorm_ACU(vector: number[] | Float32Array): number {
    if ((!Array.isArray(vector) && !(vector instanceof Float32Array)) || vector.length <= 0) return 0;
    let norm = 0;
    for (const value of vector) {
        const num = Number(value) || 0;
        norm += num * num;
    }
    return Math.sqrt(norm);
}

// T10：cosine 相似度，query 模长由调用方预计算传入（循环内只算点积与候选模长）。
// T2：维度不一致直接返回 0，不再截断后照常打分——截断会把混维向量静默当成相似，
// 产生错误召回且难以察觉。维度一致的路径与改动前逐项等价。
function cosineSimilarity_ACU(left: number[] | Float32Array, right: number[] | Float32Array, leftNorm: number): number {
    if ((!Array.isArray(left) && !(left instanceof Float32Array))
        || (!Array.isArray(right) && !(right instanceof Float32Array))
        || left.length !== right.length || left.length <= 0) return 0;
    const length = left.length;
    let dot = 0;
    let rightNorm = 0;
    for (let index = 0; index < length; index += 1) {
        const a = Number(left[index]) || 0;
        const b = Number(right[index]) || 0;
        dot += a * b;
        rightNorm += b * b;
    }
    if (leftNorm <= 0 || rightNorm <= 0) return 0;
    return dot / (leftNorm * Math.sqrt(rightNorm));
}

export type SummaryRerankStatus_ACU = 'applied' | 'not_configured' | 'no_candidates' | 'skipped_within_topk' | 'empty_response' | 'failed';

/** Rerank 阶段的结果：candidates 始终可用；未应用时 status 说明原因，供结果对象与日志透出。 */
interface SummaryRerankOutcome_ACU {
    candidates: RankedSummaryCandidate_ACU[];
    status: SummaryRerankStatus_ACU;
    error?: string;
    /** 实际送去 rerank 的 documents 条数（按行去重后）。 */
    documentCount?: number;
}

/**
 * 融合候选按行去重：一行可能有多个 chunk 命中，选取与注入都以行为单位，
 * rerank 也只需要给每行打一次分。保留每行融合分最高（首次出现）的候选。
 */
function dedupeCandidatesByRow_ACU(candidates: RankedSummaryCandidate_ACU[]): RankedSummaryCandidate_ACU[] {
    const seen = new Set<string>();
    const result: RankedSummaryCandidate_ACU[] = [];
    for (const candidate of candidates) {
        const rowKey = candidate.row.rowKey;
        if (seen.has(rowKey)) continue;
        seen.add(rowKey);
        result.push(candidate);
    }
    return result;
}

/**
 * Rerank 的 document 用实时纪要表的正文（概览 + 纪要）而不是 chunk 文本：
 * 交叉编码器的优势在长文本细粒度匹配，喂它 30 字概览等于把它当 embedding 用。
 * 读不到实时正文（模板无纪要列 / 表未加载）时回退到 chunk 文本。
 */
function buildRerankDocument_ACU(candidate: RankedSummaryCandidate_ACU, live: LiveSummaryVectorRows_ACU | null): string {
    const liveRow = live?.byRowKey.get(candidate.row.rowKey);
    const summary = normalizeText_ACU(liveRow?.summary || candidate.row.summary);
    const chronicle = normalizeText_ACU(liveRow?.chronicleText);
    const combined = [summary, chronicle].filter(Boolean).join('\n');
    return combined || normalizeText_ACU(candidate.chunk.text);
}

// P4：统一走 vector-rerank-gateway 网关（超时可中断、安全 JSON 解析），消除此前内联 fetch 与网关的双实现漂移。
// 失败时保留既有语义：回退 embedding 排序——但用户明确配置了 rerank 却每次都失败，必须以 error 级别透出，
// warn 级别默认关闭时会让「rerank 从未生效」完全不可见。
async function rerankCandidates_ACU(
    config: any,
    query: string,
    candidates: RankedSummaryCandidate_ACU[],
    live: LiveSummaryVectorRows_ACU | null,
): Promise<SummaryRerankOutcome_ACU> {
    const endpoint = normalizeText_ACU(config.rerankEndpoint);
    const model = normalizeText_ACU(config.rerankModel);
    if (!endpoint || !model) return { candidates, status: 'not_configured' };
    if (candidates.length === 0) return { candidates, status: 'no_candidates' };
    const rowCandidates = dedupeCandidatesByRow_ACU(candidates);
    const topK = Math.max(1, Math.floor(Number(config.topK) || 1));
    // 池子不比 topK 大，rerank 改变不了"谁进目录"，只是白花一次请求。
    if (rowCandidates.length <= topK) {
        logDebug_ACU(`[交火模式纪要索引] 候选行 ${rowCandidates.length} ≤ topK ${topK}，跳过 rerank。`);
        return { candidates: rowCandidates, status: 'skipped_within_topk', documentCount: 0 };
    }
    try {
        const documents = rowCandidates.map((candidate) => buildRerankDocument_ACU(candidate, live));
        const results = await createRerankScores_ACU({
            endpoint,
            model,
            apiKey: normalizeText_ACU(config.rerankApiKey) || undefined,
            query,
            documents,
            instruction: normalizeText_ACU(config.rerankInstruction) || undefined,
            batchSize: config.rerankBatchSize,
        });
        const byIndex = new Map<number, number>();
        results.forEach((item) => {
            if (item.index >= 0 && item.index < rowCandidates.length) byIndex.set(item.index, item.relevanceScore);
        });
        if (byIndex.size === 0) {
            logError_ACU(`[交火模式纪要索引] Rerank 响应没有任何可用的评分（endpoint=${endpoint}, model=${model}），本轮回退到 Embedding 排序。请检查服务商返回格式是否为 results[].index / relevance_score。`);
            return { candidates: rowCandidates, status: 'empty_response', error: 'rerank 响应中没有可用评分', documentCount: documents.length };
        }
        return {
            status: 'applied',
            documentCount: documents.length,
            candidates: rowCandidates
                .map((candidate, index) => ({ ...candidate, rerankScore: byIndex.get(index) ?? candidate.score }))
                .sort((left, right) => (right.rerankScore ?? right.score) - (left.rerankScore ?? left.score)),
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logError_ACU(`[交火模式纪要索引] Rerank 调用失败（endpoint=${endpoint}, model=${model}），本轮回退到 Embedding 排序：${message}`);
        return { candidates: rowCandidates, status: 'failed', error: message };
    }
}

function escapeMarkdownTableCell_ACU(value: any): string {
    return normalizeText_ACU(value)
        .replace(/\r?\n+/g, '<br>')
        .replace(/\|/g, '\\|');
}

function buildSummaryIndexOverwriteContent_ACU(candidates: SummaryIndexSelectedCandidate_ACU[]): string {
    const selectedRows = (Array.isArray(candidates) ? candidates : [])
        .map((candidate) => candidate.row)
        .filter((row): row is ChatSummaryVectorIndexRow_ACU => !!row)
        .sort((left, right) => (Number(left.rowOrder) || 0) - (Number(right.rowOrder) || 0));

    const lines = [
        '# 纪要索引',
        '',
        '| 时间 | 地点 | 概要 | 编码索引 |',
        '|---|---|---|---|',
    ];

    selectedRows.forEach((row) => {
        lines.push(`| ${escapeMarkdownTableCell_ACU(row.timeSpan)} | ${escapeMarkdownTableCell_ACU(row.location)} | ${escapeMarkdownTableCell_ACU(row.summary)} | ${escapeMarkdownTableCell_ACU(row.indexCode)} |`);
    });

    if (selectedRows.length === 0) {
        lines.push('|  |  | （无命中纪要） |  |');
    }

    return lines.join('\n');
}

async function upsertOriginalSummaryIndexEntry_ACU(content: string): Promise<void> {
    if (!isWorldbookApiAvailable_ACU()) return;
    const targetLorebook = await getInjectionTargetLorebook_ACU();
    if (!targetLorebook) return;

    const worldbookConfig = getCurrentWorldbookConfig_ACU();
    const comment = `${getIsolationPrefix_ACU()}TavernDB-ACU-CustomExport-纪要索引`;
    const entries = await getLorebookEntries_ACU(targetLorebook);
    const existing = entries.find((entry: any) => entry?.comment === comment);
    const enabled = existing?.enabled ?? (worldbookConfig?.zeroTkOccupyMode !== true);
    const nextEntry = {
        ...(existing || {}),
        comment,
        content,
        keys: Array.isArray(existing?.keys) ? existing.keys : [],
        enabled,
        type: 'constant',
        order: Number.isFinite(Number(existing?.order)) ? Number(existing.order) : 10000,
        prevent_recursion: true,
    };

    if (existing?.uid != null) {
        await setLorebookEntries_ACU(targetLorebook, [{ ...nextEntry, uid: existing.uid }]);
    } else {
        await createLorebookEntries_ACU(targetLorebook, [nextEntry]);
    }
}

interface LiveSummaryVectorRows_ACU {
    summaryKey: string;
    rows: SummaryVectorArchivePreparedRow_ACU[];
    byRowKey: Map<string, SummaryVectorArchivePreparedRow_ACU>;
}

function buildLiveSummaryVectorRows_ACU(): LiveSummaryVectorRows_ACU | null {
    const selected = findSummaryTable_ACU();
    if (!selected?.summaryKey || !selected.table) return null;
    const prepared = buildPreparedRows_ACU(selected.table, selected.summaryKey);
    if (prepared.error) {
        logWarn_ACU('[交火模式纪要索引] 实时纪要表解析失败，跳过发送前对账:', prepared.error);
        return null;
    }
    const rows = Array.isArray(prepared.rows) ? prepared.rows : [];
    return {
        summaryKey: selected.summaryKey,
        rows,
        byRowKey: new Map(rows.map((row) => [row.rowKey, row])),
    };
}

function filterRowsByLiveSummaryTable_ACU(
    rows: ChatSummaryVectorIndexRow_ACU[],
    live: LiveSummaryVectorRows_ACU | null,
): { rows: ChatSummaryVectorIndexRow_ACU[]; changed: boolean } {
    if (!live) return { rows, changed: false };
    const indexedRowKeys = new Set(rows.map((row) => row.rowKey).filter(Boolean));
    const filtered = rows.filter((row) => {
        const liveRow = live.byRowKey.get(row.rowKey);
        if (!liveRow) return false;
        if (row.sourceFingerprint && liveRow.sourceFingerprint && row.sourceFingerprint !== liveRow.sourceFingerprint) return false;
        return true;
    });
    const liveHasUnindexedRows = live.rows.some((row) => !indexedRowKeys.has(row.rowKey));
    return {
        rows: filtered,
        changed: filtered.length !== rows.length || liveHasUnindexedRows,
    };
}

function filterChunksByLiveSummaryTable_ACU(
    chunks: ChatSummaryVectorIndexChunk_ACU[],
    live: LiveSummaryVectorRows_ACU | null,
): { chunks: ChatSummaryVectorIndexChunk_ACU[]; changed: boolean } {
    if (!live) return { chunks, changed: false };
    const filtered = chunks.filter((chunk) => {
        const liveRow = live.byRowKey.get(chunk.rowKey);
        if (!liveRow) return false;
        if (chunk.sourceFingerprint && liveRow.sourceFingerprint && chunk.sourceFingerprint !== liveRow.sourceFingerprint) return false;
        return true;
    });
    return { chunks: filtered, changed: filtered.length !== chunks.length };
}

function isSingleFileSnapshotManifest_ACU(manifest: ChatSummaryVectorIndexManifest_ACU | null | undefined): manifest is ChatSummaryVectorIndexManifest_ACU {
    if (!manifest) return false;
    const explicitMode = manifest.snapshot?.mode;
    if (explicitMode) return explicitMode === 'single_file_snapshot';
    const manifestPath = normalizeText_ACU(manifest.manifestFile);
    return !!manifestPath && manifest.rowsFile === manifestPath && manifest.tombstoneFile === manifestPath;
}

async function selectRealignSnapshotFromDisk_ACU(manifest: ChatSummaryVectorIndexManifest_ACU): Promise<{
    path: string;
    blob: VectorIndexSingleSnapshotBlob_ACU;
} | null> {
    const currentPath = normalizeText_ACU(manifest.manifestFile || manifest.files?.[0]?.path);
    const isV2 = !!manifest.storageIdentity;
    const currentStorageRevision = Number(manifest.storageIdentity?.revision || 0);
    const currentSnapshotRevision = Number(manifest.snapshot?.revision || 0);
    if (isV2 && (!Number.isInteger(currentStorageRevision) || currentStorageRevision < 1
        || currentStorageRevision !== currentSnapshotRevision)) {
        return null;
    }
    const currentRevision = isV2 ? currentStorageRevision : currentSnapshotRevision;
    const expectedScope = normalizeSummaryVectorIndexScope_ACU({
        chatKey: manifest.chatKey,
        isolationKey: manifest.isolationKey,
        sourceTableKey: manifest.sourceTableKey,
    });
    let registeredFiles: Array<{ path?: string; publicationState?: string }> = [{ path: currentPath }];
    if (isV2) {
        try {
            const registry = await loadVectorIndexRegistry_ACU();
            registeredFiles = Array.isArray(registry.files)
                ? registry.files.filter((file) => file?.publicationState === 'published')
                : [];
        } catch {
            return null;
        }
    }
    const candidates: Array<{ path: string; blob: VectorIndexSingleSnapshotBlob_ACU; revision: number; writeGeneration: string }> = [];

    for (const file of registeredFiles) {
        const path = normalizeText_ACU(file?.path);
        if (!path) continue;
        try {
            const loaded = await readVectorIndexJsonFile_ACU<VectorIndexSingleSnapshotBlob_ACU>(path);
            const blob = loaded.data;
            const diskManifest = blob?.manifest;
            if (!loaded.ok || !blob || blob.schema !== 'single_file_snapshot' || !diskManifest || diskManifest.status !== 'ready') continue;
            const diskScope = normalizeSummaryVectorIndexScope_ACU({
                chatKey: diskManifest.chatKey,
                isolationKey: diskManifest.isolationKey,
                sourceTableKey: diskManifest.sourceTableKey,
            });
            if (diskScope.chatKey !== expectedScope.chatKey
                || diskScope.isolationKey !== expectedScope.isolationKey
                || diskScope.sourceTableKey !== expectedScope.sourceTableKey) continue;
            if (isV2 && (diskManifest.chatKey !== expectedScope.chatKey
                || diskManifest.isolationKey !== expectedScope.isolationKey
                || diskManifest.sourceTableKey !== expectedScope.sourceTableKey
                || !blob.storageIdentity)) continue;
            validateSingleFileSnapshotIdentity_ACU(diskManifest, blob, path);
            const revision = Number(diskManifest.storageIdentity?.revision ?? diskManifest.snapshot?.revision);
            const writeGeneration = normalizeText_ACU(diskManifest.storageIdentity?.writeGeneration);
            if (!Number.isInteger(revision) || revision < 1 || revision < currentRevision || (isV2 && !writeGeneration)) continue;
            candidates.push({ path, blob, revision, writeGeneration });
        } catch {
            // 单个 registry 对象不可信时继续审阅同 scope 的其他 published 候选。
        }
    }
    if (candidates.length === 0) return null;
    const newestRevision = Math.max(...candidates.map((candidate) => candidate.revision));
    const newestCandidates = candidates.filter((candidate) => candidate.revision === newestRevision);
    if (newestCandidates.length !== 1) {
        logWarn_ACU('[交火模式纪要索引] realign 拒绝同 canonical scope、同 revision 的多个 writeGeneration 候选:', {
            scope: expectedScope,
            revision: newestRevision,
            paths: newestCandidates.map((candidate) => candidate.path),
        });
        return null;
    }
    return newestCandidates[0];
}

async function tryRealignSummaryVectorIndexPointerFromDisk_ACU(params: {
    state: ChatSummaryVectorIndexState_ACU;
    latestLayer: SummaryVectorIndexSnapshotLayer_ACU | null;
    liveRows: LiveSummaryVectorRows_ACU | null;
}): Promise<ChatSummaryVectorIndexState_ACU | null> {
    const manifest = params.state.manifest || null;
    if (!manifest || !isSingleFileSnapshotManifest_ACU(manifest)) return null;
    const selected = await selectRealignSnapshotFromDisk_ACU(manifest);
    if (!selected) {
        logSummaryVectorIndexIdentityEvent_ACU('warn', 'realign', 'reader_unreadable', {
            manifest,
            path: normalizeText_ACU(manifest.manifestFile || manifest.files?.[0]?.path),
        });
        logWarn_ACU('[交火模式纪要索引] 未找到可验证且不回退 revision 的 single_file_snapshot 对齐候选。');
        return null;
    }
    const { path: snapshotPath, blob } = selected;
    const blobManifest = blob.manifest;
    if (blob.schema !== 'single_file_snapshot' || !blobManifest || blobManifest.snapshot?.mode !== 'single_file_snapshot') {
        logSummaryVectorIndexIdentityEvent_ACU('warn', 'realign', 'snapshot_shape_rejected', {
            manifest,
            path: snapshotPath,
        });
        return null;
    }
    // V2 object identity is immutable. A raw empty key whose canonical scope is
    // default is a known malformed write, not a legacy record that may be repointed.
    const blobScope = normalizeSummaryVectorIndexScope_ACU({
        chatKey: blob.chatKey,
        isolationKey: blob.isolationKey,
        sourceTableKey: blob.sourceTableKey,
    });
    const embeddedScope = normalizeSummaryVectorIndexScope_ACU({
        chatKey: blobManifest.chatKey,
        isolationKey: blobManifest.isolationKey,
        sourceTableKey: blobManifest.sourceTableKey,
    });
    if (blob.storageIdentity && (blob.isolationKey !== blobScope.isolationKey || blobManifest.isolationKey !== embeddedScope.isolationKey)) {
        logSummaryVectorIndexIdentityEvent_ACU('warn', 'realign', 'noncanonical_scope_rejected', {
            manifest: blobManifest,
            path: snapshotPath,
            error: 'V2 单文件快照包含非 canonical isolationKey；拒绝将非 canonical 对象写回聊天指针。',
        });
        return null;
    }
    try {
        // realign 是写 pointer 的自愈入口，不能维护一套缩水校验；必须复用正式 reader 契约。
        validateSingleFileSnapshotIdentity_ACU(blobManifest, blob, snapshotPath);
    } catch (error) {
        logSummaryVectorIndexIdentityEvent_ACU('warn', 'realign', 'identity_validation_failed', {
            manifest: blobManifest,
            path: snapshotPath,
            error,
        });
        logWarn_ACU('[交火模式纪要索引] single_file_snapshot 指针对齐身份校验失败，拒绝 repoint:', error);
        return null;
    }
    const isV2 = !!blob.storageIdentity;
    const scopeMatches = (isV2
        ? blobManifest.sourceTableKey === manifest.sourceTableKey
            && blobManifest.chatKey === manifest.chatKey
            && blobManifest.isolationKey === manifest.isolationKey
        : normalizeText_ACU(blobManifest.sourceTableKey) === normalizeText_ACU(manifest.sourceTableKey)
            && normalizeText_ACU(blobManifest.chatKey) === normalizeText_ACU(manifest.chatKey)
            && normalizeSummaryVectorIsolationKey_ACU(blobManifest.isolationKey) === normalizeSummaryVectorIsolationKey_ACU(manifest.isolationKey))
        && (!params.latestLayer || (isV2
            ? blobManifest.isolationKey === normalizeSummaryVectorIsolationKey_ACU(params.latestLayer.isolationKey)
            : normalizeSummaryVectorIsolationKey_ACU(blobManifest.isolationKey) === normalizeSummaryVectorIsolationKey_ACU(params.latestLayer.isolationKey)))
        && (!params.liveRows || normalizeText_ACU(blob.sourceTableKey) === params.liveRows.summaryKey);
    if (!scopeMatches) {
        logSummaryVectorIndexIdentityEvent_ACU('warn', 'realign', 'scope_mismatch', { manifest: blobManifest, path: snapshotPath });
        return null;
    }
    if (blobManifest.status !== 'ready') {
        logSummaryVectorIndexIdentityEvent_ACU('warn', 'realign', 'not_ready', { manifest: blobManifest, path: snapshotPath });
        return null;
    }
    if (normalizeText_ACU(blobManifest.manifestFile) !== snapshotPath
        || normalizeText_ACU(blobManifest.rowsFile) !== snapshotPath
        || normalizeText_ACU(blobManifest.tombstoneFile) !== snapshotPath) {
        logSummaryVectorIndexIdentityEvent_ACU('warn', 'realign', 'canonical_path_mismatch', { manifest: blobManifest, path: snapshotPath });
        return null;
    }
    const currentRevision = Number(manifest.snapshot?.revision || 0);
    const diskRevision = Number(blobManifest.snapshot?.revision || 0);
    if (diskRevision < currentRevision) {
        logSummaryVectorIndexIdentityEvent_ACU('warn', 'realign', 'revision_stale', { manifest: blobManifest, path: snapshotPath });
        return null;
    }
    const activeRowKeys = new Set(blobManifest.snapshot?.activeRowKeys || []);
    const diskRows = (Array.isArray(blob.rows) ? blob.rows : [])
        .filter((row) => row && row.status !== 'removed' && (activeRowKeys.size === 0 || activeRowKeys.has(row.rowKey)));
    const reconciledDiskRows = filterRowsByLiveSummaryTable_ACU(diskRows, params.liveRows);
    const reconciledRows = reconciledDiskRows.rows;
    const alignedManifest: ChatSummaryVectorIndexManifest_ACU = {
        ...blobManifest,
        manifestFile: snapshotPath,
        rowsFile: snapshotPath,
        tombstoneFile: snapshotPath,
        status: 'ready',
    };
    const alignedState: ChatSummaryVectorIndexState_ACU = {
        ...params.state,
        version: params.state.version || 1,
        backend: 'st-files',
        status: 'ready',
        indexId: alignedManifest.indexId,
        snapshotMessageId: alignedManifest.snapshotMessageId || normalizeText_ACU(blob.snapshotMessageId),
        sourceTableKey: alignedManifest.sourceTableKey,
        sourceTableName: alignedManifest.sourceTableName || normalizeText_ACU(blob.sourceTableName),
        indexedAt: alignedManifest.indexedAt || normalizeText_ACU(blob.indexedAt) || new Date().toISOString(),
        rowCount: reconciledRows.length || alignedManifest.rowCount,
        chunkCount: alignedManifest.chunkCount,
        skippedRowCount: alignedManifest.skippedRowCount,
        rows: reconciledRows,
        manifest: alignedManifest,
    };
    delete alignedState.chunks;
    const layer = params.latestLayer;
    const chat = getChatArray_ACU();
    const message = layer ? chat[layer.messageIndex] : null;
    if (!layer || !message) return null;
    const previousManifest = readIsolatedTagData_ACU(message, layer.isolationKey)
        ?.summaryVectorIndexManifest
        || layer.tagData?.summaryVectorIndexManifest
        || null;
    const expectedIndexId = previousManifest?.indexId || (layer.tagData?.summaryVectorIndexState?.manifest?.indexId) || undefined;
    try {
        await commitVectorMetadataPatch_ACU(message, layer.isolationKey, {
            summaryVectorIndexState: alignedState,
            summaryVectorIndexManifest: alignedManifest,
        }, {
            expectedIndexId,
        });
    } catch (error) {
        logSummaryVectorIndexIdentityEvent_ACU('warn', 'realign', 'strict_save_failed', { manifest: alignedManifest, path: snapshotPath, error });
        logWarn_ACU('[交火模式纪要索引] 磁盘 pointer 对齐严格保存失败，已回滚内存状态:', error);
        return null;
    }
    logSummaryVectorIndexIdentityEvent_ACU('debug', 'realign', 'accepted', { manifest: alignedManifest, path: snapshotPath });
    logWarn_ACU(`[交火模式纪要索引] 已从 single_file_snapshot 磁盘文件对齐索引指针：indexId=${alignedManifest.indexId}, revision=${diskRevision}`);
    return alignedState;
}

// T5：query embedding 失败时的降级路径 —— 仅注入最近固定行，不依赖向量检索。
// 仅在 recentFixedRows 非空时调用；调用方负责确认 recentFixedRows.length > 0。
async function injectRecentFixedRowsOnly_ACU(recentFixedRows: ChatSummaryVectorIndexRow_ACU[]): Promise<SummaryVectorIndexRuntimeResult_ACU> {
    const selected = recentFixedRows
        .map((row): SummaryIndexSelectedCandidate_ACU => ({ kind: 'recent_fixed', row }))
        .sort((left, right) => (Number(left.row.rowOrder) || 0) - (Number(right.row.rowOrder) || 0));
    const content = buildSummaryIndexOverwriteContent_ACU(selected);
    await upsertOriginalSummaryIndexEntry_ACU(content);
    return {
        success: true,
        reason: 'query_embedding_failed_recent_fixed_only',
        keywordCount: 0,
        candidateCount: 0,
        injectedCount: selected.length,
        denseCandidateCount: 0,
        sparseCandidateCount: 0,
        fusionCandidateCount: 0,
    };
}


export async function processSummaryVectorIndexBeforeGeneration_ACU(
    options: SummaryVectorIndexRuntimeOptions_ACU = {},
): Promise<SummaryVectorIndexRuntimeResult_ACU> {
    const worldbookConfig = getCurrentWorldbookConfig_ACU();
    const globalEnabled = globalMeta_ACU?.summaryVectorIndexModeGlobal === true;
    if (!globalEnabled) {
        logDebug_ACU(`[交火模式纪要索引] 全局开关未启用，跳过发送前处理。worldbookProjection=${worldbookConfig.summaryVectorIndexModeEnabled === true}`);
        return { success: false, skipped: true, reason: 'summary_vector_index_disabled' };
    }
    const userInput = normalizeText_ACU(options.userInput);
    if (!userInput) return { success: false, skipped: true, reason: 'empty_user_input' };
    // P3：去重签名不含 source——同一次发送会经由 TavernHelper 包装与
    // GENERATION_AFTER_COMMANDS 两个钩子各触发一次，source 不同导致签名不同、
    // 完整链路（关键词 AI + embedding + rerank + 世界书写回）跑两遍。
    // 加入 chatKey 防止切换聊天后相同文本被跨聊天误去重。
    const signature = `${String(currentChatFileIdentifier_ACU || '')}:${userInput}`;
    if (!options.bypassDedupe && signature === lastRuntimeSignature_ACU && Date.now() - lastRuntimeAt_ACU <= SUMMARY_VECTOR_INDEX_RUNTIME_DEDUPE_MS_ACU) {
        logDebug_ACU(`[交火模式纪要索引] 8s 窗口内重复触发已去重：source=${options.source || 'unknown'}`);
        return { success: true, skipped: true, reason: 'deduped' };
    }
    lastRuntimeSignature_ACU = signature;
    lastRuntimeAt_ACU = Date.now();

    const config = getEffectiveSummaryVectorIndexConfig_ACU();
    const validation = validateSummaryVectorIndexConfig_ACU(config);
    if (!validation.valid) {
        logWarn_ACU('[交火模式纪要索引] 配置无效，跳过发送前注入:', validation.errors.join('; '));
        return { success: false, skipped: true, reason: 'invalid_config' };
    }

    const snapshot = getLatestSummaryVectorIndexSnapshotState_ACU();
    let state = snapshot?.summaryVectorIndexState || null;
    const latestLayer = snapshot?.layers?.[0] || null;
    if (!state) {
        return { success: false, skipped: true, reason: 'no_index_state' };
    }
    const liveRows = buildLiveSummaryVectorRows_ACU();
    const activeRowKeys = new Set(state.manifest?.snapshot?.activeRowKeys || []);
    let rows: ChatSummaryVectorIndexRow_ACU[] = Array.isArray(state.rows)
        ? state.rows.filter((row: ChatSummaryVectorIndexRow_ACU) => row.status !== 'removed' && (activeRowKeys.size === 0 || activeRowKeys.has(row.rowKey)))
        : [];
    const reconciledRows = filterRowsByLiveSummaryTable_ACU(rows, liveRows);
    rows = reconciledRows.rows;
    let staleRealignNeeded = reconciledRows.changed;
    let chunks: ChatSummaryVectorIndexChunk_ACU[] = Array.isArray(state.chunks) ? state.chunks : [];
    if (state.manifest) {
        try {
            chunks = await loadSummaryVectorIndexChunksFromManifest_ACU(state.manifest);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error || '未知错误');
            if (isMissingExternalVectorFileError_ACU(message)) {
                let chatStateCleared = false;
                try {
                    if (latestLayer && state.manifest.indexId) {
                        const clearResult = await clearLatestSummaryVectorIndexStateForMissingExternalFiles_ACU({
                            messageIndex: latestLayer.messageIndex,
                            isolationKey: latestLayer.isolationKey,
                            indexId: state.manifest.indexId,
                            sourceTableKey: state.manifest.sourceTableKey,
                        });
                        chatStateCleared = clearResult.chatStateCleared;
                    }
                } catch (clearError) {
                    logWarn_ACU('[交火模式纪要索引] 外置向量文件缺失，但严格删除失效索引指针失败:', clearError);
                    return { success: false, skipped: true, reason: 'external_vector_files_missing_state_clear_save_failed' };
                }
                if (!chatStateCleared) {
                    logWarn_ACU('[交火模式纪要索引] 外置向量文件缺失，但失效索引指针未能安全删除；拒绝盲目重建:', message);
                    return { success: false, skipped: true, reason: 'external_vector_files_missing_state_clear_failed' };
                }
                logWarn_ACU('[交火模式纪要索引] 外置向量文件缺失，已删除失效索引指针；交由 UI 走“立即构建”普通路径重建:', message);
                return { success: false, skipped: true, reason: 'external_vector_files_missing_rebuild_required' };
            }
            if (isInvalidExternalVectorFileError_ACU(message)) {
                let invalidManifest = state.manifest;
                const alignedState = await tryRealignSummaryVectorIndexPointerFromDisk_ACU({ state, latestLayer, liveRows });
                let realignReloadFailed = false;
                if (alignedState?.manifest) {
                    state = alignedState;
                    rows = Array.isArray(alignedState.rows) ? alignedState.rows : [];
                    invalidManifest = alignedState.manifest;
                    try {
                        chunks = await loadSummaryVectorIndexChunksFromManifest_ACU(alignedState.manifest);
                    } catch (realignLoadError) {
                        const realignMessage = realignLoadError instanceof Error ? realignLoadError.message : String(realignLoadError || '未知错误');
                        logWarn_ACU('[交火模式纪要索引] 指针对齐后重新加载外置向量仍失败，删除失效指针并交由 UI 重建:', realignMessage);
                        realignReloadFailed = true;
                    }
                }
                if (alignedState?.manifest && !realignReloadFailed) {
                    // 对齐后的正式 reader 已通过，继续正常召回；不得再清除刚写回的 pointer。
                } else {
                try {
                    let clearResult = null;
                    if (latestLayer && invalidManifest?.indexId) {
                        clearResult = await clearLatestSummaryVectorIndexStateForInvalidExternalFiles_ACU({
                            messageIndex: latestLayer.messageIndex,
                            isolationKey: latestLayer.isolationKey,
                            indexId: invalidManifest.indexId,
                            sourceTableKey: invalidManifest.sourceTableKey,
                        });
                    }
                    if (!clearResult?.chatStateCleared) {
                        logWarn_ACU('[交火模式纪要索引] 外置向量文件身份校验失败，但失效索引指针未能安全删除；拒绝盲目重建:', message);
                        return { success: false, skipped: true, reason: 'external_vector_identity_invalid_state_clear_failed' };
                    }
                    logSummaryVectorIndexIdentityEvent_ACU('warn', 'rebuild', 'invalid_pointer_cleared', {
                        manifest: invalidManifest,
                        error: message,
                    });
                    return { success: false, skipped: true, reason: 'external_vector_identity_invalid_rebuild_required' };
                } catch (clearError) {
                    logSummaryVectorIndexIdentityEvent_ACU('warn', 'rebuild', 'invalid_pointer_clear_failed', {
                        manifest: invalidManifest,
                        error: clearError,
                    });
                    logWarn_ACU('[交火模式纪要索引] 外置向量文件身份校验失败，严格删除失效索引指针失败:', clearError);
                    return { success: false, skipped: true, reason: 'external_vector_identity_invalid_state_clear_save_failed' };
                }
                }
            } else {
                throw error;
            }
        }
    }
    const reconciledChunks = filterChunksByLiveSummaryTable_ACU(chunks, liveRows);
    chunks = reconciledChunks.chunks;
    staleRealignNeeded = staleRealignNeeded || reconciledChunks.changed;
    if (staleRealignNeeded) {
        logWarn_ACU('[交火模式纪要索引] 实时纪要表与现有索引不一致；停止使用旧快照并交由 UI 走“立即构建”普通路径重建。');
        return { success: false, skipped: true, reason: 'runtime_stale_rows_rebuild_required' };
    }
    if (rows.length < config.summaryIndexKeywordMinRows) {
        return { success: false, skipped: true, reason: 'below_min_rows' };
    }
    if (chunks.length === 0) {
        return { success: false, skipped: true, reason: 'no_chunks' };
    }

    const rowByKey = new Map(rows.map((row) => [row.rowKey, row]));

    // ── 最近 X 条固定注入：按 rowOrder 降序取最近 X 行 ──
    const recentFixedCount = Math.max(0, Math.min(
        config.summaryIndexRecentFixedInjectCount || 0,
        rows.length,
    ));
    const rowsSortedByOrderDesc = [...rows].sort(
        (left, right) => (Number(right.rowOrder) || 0) - (Number(left.rowOrder) || 0),
    );
    const recentFixedRows = rowsSortedByOrderDesc.slice(0, recentFixedCount);
    const recentFixedRowKeys = new Set(recentFixedRows.map((row) => row.rowKey));
    // 较早的行（不参与排序的候选池）
    const olderRows = rows.filter((row) => !recentFixedRowKeys.has(row.rowKey));

    // T5：query embedding 失败不中断宿主生成。generateKeywords/createEmbeddings 抛异常或返回空向量时，
    // 若存在最近固定行（recentFixedRows），降级为仅注入固定行（不依赖向量），继续原始生成；
    // 否则保持原行为（空向量返回 empty_query_embedding；异常穿透给上层 init.ts 的 try/catch 兜底）。
    let keywords: string[] = [];
    let queryText = '';
    let queryVector: number[] | Float32Array = [];
    try {
        keywords = await generateKeywords_ACU(config, userInput);
        queryText = [userInput, keywords.join('，')].filter(Boolean).join('\n关键词：');
        const embeddings = await createEmbeddings_ACU({
            endpoint: config.embeddingEndpoint,
            apiKey: config.embeddingApiKey,
            model: config.embeddingModel,
            input: [queryText],
        });
        queryVector = embeddings[0]?.embedding || [];
        if (queryVector.length === 0) {
            if (recentFixedRows.length > 0) {
                logWarn_ACU('[交火模式纪要索引] query embedding 返回空向量，降级为仅注入最近固定行:', userInput);
                return await injectRecentFixedRowsOnly_ACU(recentFixedRows);
            }
            return { success: false, skipped: true, reason: 'empty_query_embedding' };
        }
    } catch (error) {
        if (recentFixedRows.length > 0) {
            logWarn_ACU('[交火模式纪要索引] query embedding 失败，降级为仅注入最近固定行，继续原始生成:', error);
            return await injectRecentFixedRowsOnly_ACU(recentFixedRows);
        }
        throw error;
    }

    // 只对较早行的 chunks 做向量匹配
    const olderRowKeys = new Set(olderRows.map((row) => row.rowKey));
    const olderChunks = chunks.filter((chunk) => olderRowKeys.has(chunk.rowKey));

    const searchableCandidates: SummaryHybridCandidate_ACU[] = olderChunks
        .map((chunk): RankedSummaryCandidate_ACU | null => {
            const row = rowByKey.get(chunk.rowKey);
            if (!row) return null;
            return { chunk, row, score: 0 };
        })
        .filter((candidate): candidate is RankedSummaryCandidate_ACU => !!candidate);

    // T10：query 模长只算一次，循环内只做点积与候选模长（与原实现逐位等价）。
    const queryNorm = computeVectorNorm_ACU(queryVector);
    const denseCandidates = searchableCandidates
        .map((candidate): RankedSummaryCandidate_ACU | null => {
            const chunk = candidate.chunk;
            if ((!Array.isArray(chunk.vector) && !(chunk.vector instanceof Float32Array)) || chunk.vector.length === 0) return null;
            const score = cosineSimilarity_ACU(queryVector, chunk.vector, queryNorm);
            if (score < config.summaryIndexMinScore) return null;
            return { ...candidate, score, denseScore: score };
        })
        .filter((candidate): candidate is RankedSummaryCandidate_ACU => !!candidate)
        .sort((left, right) => right.score - left.score)
        .slice(0, config.summaryIndexCandidateLimit);

    // T10：BM25 语料缓存键。候选集（searchableCandidates）的 chunk 集合指纹保证
    // recentFixedCount / config 变化导致候选集变化时缓存自然失效；V2 快照的
    // writeGeneration 唯一标识一次归档内容（不可变身份），作为前缀避免跨快照误用。
    const bm25CacheKey = `${state.manifest?.storageIdentity?.writeGeneration || 'legacy'}::${state.manifest?.indexId || ''}::${searchableCandidates
        .map((candidate) => candidate.chunk.textHash || candidate.chunk.chunkId || candidate.chunk.text)
        .join('|')}`;
    const sparseCandidates = config.summaryIndexHybridRetrievalEnabled
        ? sparseSearchBm25_ACU(queryText, searchableCandidates, config.summaryIndexBm25CandidateLimit, bm25CacheKey)
        : [];

    const fusionLimit = Math.max(config.summaryIndexCandidateLimit, config.topK);
    const candidates = config.summaryIndexHybridRetrievalEnabled
        ? reciprocalRankFusion_ACU([denseCandidates, sparseCandidates], config.summaryIndexRrfK, fusionLimit) as RankedSummaryCandidate_ACU[]
        : denseCandidates;

    logDebug_ACU(
        `[交火模式纪要索引] 混合召回候选：dense=${denseCandidates.length}, bm25=${sparseCandidates.length}, fusion=${candidates.length}, hybrid=${config.summaryIndexHybridRetrievalEnabled === true}`,
    );

    if (candidates.length === 0 && recentFixedRows.length === 0) {
        return { success: false, skipped: true, reason: 'no_candidates', keywordCount: keywords.length, denseCandidateCount: denseCandidates.length, sparseCandidateCount: sparseCandidates.length, fusionCandidateCount: candidates.length };
    }

    // Rerank 只处理较早行的候选；document 取实时纪要正文，候选行不多于 topK 时跳过。
    const rerank = await rerankCandidates_ACU(config, queryText, candidates, liveRows);
    const selectedByRow = new Map<string, SummaryIndexSelectedCandidate_ACU>();
    for (const candidate of rerank.candidates) {
        if (!selectedByRow.has(candidate.row.rowKey)) selectedByRow.set(candidate.row.rowKey, { kind: 'ranked', chunk: candidate.chunk, row: candidate.row, score: candidate.score, rerankScore: candidate.rerankScore });
        if (selectedByRow.size >= config.topK) break;
    }

    // 合并：最近固定行 + TopK 排序行（去重，固定行优先）
    for (const row of recentFixedRows) {
        if (!selectedByRow.has(row.rowKey)) {
            selectedByRow.set(row.rowKey, { kind: 'recent_fixed', row });
        }
    }
    const selected = Array.from(selectedByRow.values())
        .sort((left, right) => (Number(left.row.rowOrder) || 0) - (Number(right.row.rowOrder) || 0));
    const keywordGenerationEnabled = config.keywordGenerationEnabled !== false;
    if (selected.length === 0) {
        return { success: false, skipped: true, reason: 'no_selected_rows', keywordCount: keywords.length, candidateCount: candidates.length, denseCandidateCount: denseCandidates.length, sparseCandidateCount: sparseCandidates.length, fusionCandidateCount: candidates.length, rerankStatus: rerank.status, rerankError: rerank.error, rerankDocumentCount: rerank.documentCount, keywordGenerationEnabled };
    }

    const content = buildSummaryIndexOverwriteContent_ACU(selected);
    await upsertOriginalSummaryIndexEntry_ACU(content);
    logDebug_ACU(
        `[交火模式纪要索引] 已覆盖原概要索引条目：${selected.length} 条（其中固定注入 ${recentFixedRows.length} 条，排序选取 ${selected.length - recentFixedRows.length} 条），关键词 ${keywords.length} 个（关键词 AI ${keywordGenerationEnabled ? '开' : '关'}），rerank=${rerank.status}${rerank.documentCount ? `（${rerank.documentCount} 条 documents）` : ''}，输出顺序按纪要表原 rowOrder。`,
    );
    return { success: true, keywordCount: keywords.length, candidateCount: candidates.length, injectedCount: selected.length, denseCandidateCount: denseCandidates.length, sparseCandidateCount: sparseCandidates.length, fusionCandidateCount: candidates.length, rerankStatus: rerank.status, rerankError: rerank.error, rerankDocumentCount: rerank.documentCount, keywordGenerationEnabled };
}
