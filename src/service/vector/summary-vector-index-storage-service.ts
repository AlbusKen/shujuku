import { getCurrentIsolationKey_ACU, currentChatFileIdentifier_ACU } from '../runtime/state-manager';
import { hashUserInput_ACU, logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { normalizeSummaryVectorIndexScope_ACU, normalizeSummaryVectorIsolationKey_ACU } from '../../shared/summary-vector-index-scope';
import {
    buildLegacyVectorIndexLosslessScopeTokenV2_ACU,
    buildVectorIndexFileName_ACU,
    buildVectorIndexContentPackPathV2_ACU,
    buildVectorIndexSingleSnapshotV2ScopeToken_ACU,
    buildVectorIndexSingleSnapshotV2FilePath_ACU,
    buildVectorIndexStableDirectory_ACU,
    buildVectorIndexSnapshotFilePath_ACU,
    decodeVectorIndexScopeFromPath_ACU,
    deleteVectorIndexFile_ACU,
    isVectorIndexContentPackPathV2_ACU,
    loadVectorIndexRegistry_ACU,
    readVectorIndexJsonFile_ACU,
    registerVectorIndexFiles_ACU,
    sha256Text_ACU,
    unregisterVectorIndexFiles_ACU,
    uploadVectorIndexJsonFile_ACU,
} from '../../data/storage/vector-index-st-files-storage';
import {
    buildContentPackBlob_ACU,
    buildContentPackKey_ACU,
    planContentPackGroups_ACU,
    serializeContentPackForHash_ACU,
} from './summary-vector-index-content-pack';
import {
    deleteVectorIndexCacheByIndex_ACU,
    estimateVectorIndexTempCache_ACU,
    getVectorIndexCachedShard_ACU,
    putVectorIndexCachedShard_ACU,
} from '../../data/storage/vector-index-temp-cache';
import {
    deleteSummaryVectorHotCacheByIndex_ACU,
    estimateSummaryVectorFlushTasks_ACU,
    estimateSummaryVectorHotCache_ACU,
    getSummaryVectorHotCacheChunks_ACU,
    isImmutableV2SnapshotManifest_ACU,
    putSummaryVectorHotCacheChunks_ACU,
} from '../../data/storage/vector-index-hot-cache';
import type {
    ChatSummaryVectorIndexChunk_ACU,
    ChatSummaryVectorIndexManifest_ACU,
    ChatSummaryVectorIndexRow_ACU,
    ChatSummaryVectorIndexState_ACU,
    SummaryVectorIndexBatchRef_ACU,
    SummaryVectorIndexChunkRef_ACU,
    SummaryVectorIndexContentPackBlob_ACU,
    SummaryVectorIndexContentPackChunk_ACU,
    SummaryVectorIndexExternalFileRef_ACU,
    SummaryVectorIndexHealthReport_ACU,
    SummaryVectorIndexPackRef_ACU,
    SummaryVectorIndexReachabilityReport_ACU,
    SummaryVectorIndexReachableFile_ACU,
    SummaryVectorIndexRowIndex_ACU,
    SummaryVectorIndexRowIndexEntry_ACU,
    SummaryVectorIndexSafeGcOptions_ACU,
    SummaryVectorIndexSafeGcResult_ACU,
    SummaryVectorIndexShard_ACU,
    SummaryVectorIndexStats_ACU,
    SummaryVectorIndexStorageIdentity_ACU,
    SummaryVectorIndexTombstone_ACU,
} from './summary-vector-index-types';
import {
    SUMMARY_VECTOR_INDEX_CONTENT_PACK_SCHEMA_ACU,
    SUMMARY_VECTOR_INDEX_CONTENT_PACK_VERSION_ACU,
    SUMMARY_VECTOR_INDEX_MANIFEST_VERSION_ACU,
} from './summary-vector-index-types';
import { getAllSummaryVectorIndexSnapshotLayers_ACU } from './summary-vector-index-state-service';
import { getEffectiveSummaryVectorIndexConfig_ACU } from './vector-memory-config';
import { buildSummaryRowFingerprint_ACU } from './summary-vector-row-fingerprint';

const DEFAULT_SHARD_CHUNK_LIMIT_ACU = 128;
const SUMMARY_VECTOR_INDEX_PACK_CHUNK_LIMIT_ACU = 64;
// 第一版保守止血：不再按 retention 删除历史快照，避免回退到旧楼层时找不到外置文件。
const SUMMARY_VECTOR_INDEX_SNAPSHOT_RETENTION_LIMIT_ACU = 0;
// Prepare 已完成、但聊天 pointer 尚未 durable publish 的对象绝不能被 GC 删除。
// 该集合只覆盖当前运行期并发窗口；重启后的未知对象仍由保守 quarantine 策略保护。
const pendingSummaryVectorIndexPublicationPaths_ACU = new Set<string>();
// Registry/pending 状态不是跨重启事务日志。GC 必须给予新对象足够的 durable publish 观察窗口；
// 无可信时间戳时宁可 quarantine，不能把未知对象当作可回收垃圾。
const SUMMARY_VECTOR_INDEX_SAFE_GC_GRACE_PERIOD_MS_ACU = 10 * 60 * 1000;

export function logSummaryVectorIndexIdentityEvent_ACU(
    level: 'debug' | 'warn',
    operation: string,
    outcome: string,
    details: {
        manifest?: ChatSummaryVectorIndexManifest_ACU;
        path?: string;
        scopeFingerprint?: string;
        error?: unknown;
    } = {},
): void {
    const manifest = details.manifest;
    const identity = manifest?.storageIdentity;
    const payload = {
        scopeFingerprint: details.scopeFingerprint || identity?.scopeFingerprint || '',
        chatKeyHash: manifest?.chatKey ? hashUserInput_ACU(manifest.chatKey) : '',
        isolationKeyHash: manifest?.isolationKey ? hashUserInput_ACU(manifest.isolationKey) : '',
        sourceTableKey: manifest?.sourceTableKey || '',
        indexId: manifest?.indexId || '',
        revision: identity?.revision ?? manifest?.snapshot?.revision ?? null,
        writeGeneration: identity?.writeGeneration || '',
        path: details.path || '',
        layoutVersion: identity?.layoutVersion ?? 'legacy',
        embeddingModel: manifest?.embeddingModel || '',
        dimension: manifest?.dimension ?? null,
        operation,
        outcome,
        ...(details.error == null ? {} : { error: String((details.error as Error)?.message || details.error) }),
    };
    if (level === 'warn') logWarn_ACU('[纪要向量索引] identity event:', payload);
    else logDebug_ACU('[纪要向量索引] identity event:', payload);
}

export interface PersistSummaryVectorIndexExternalOptions_ACU {
    chatKey?: string;
    isolationKey?: string;
    previousManifest?: ChatSummaryVectorIndexManifest_ACU | null;
    rows: ChatSummaryVectorIndexRow_ACU[];
    chunks: ChatSummaryVectorIndexChunk_ACU[];
    snapshotMessageId: string;
    sourceTableKey: string;
    sourceTableName: string;
    indexedAt: string;
    skippedRowCount: number;
    embeddingModel: string;
    shardChunkLimit?: number;
}

export interface PersistSummaryVectorIndexSnapshotOptions_ACU extends PersistSummaryVectorIndexExternalOptions_ACU {
    activeRowKeys?: string[];
    activeChunkIds?: string[];
    removedRowKeys?: string[];
    replacedRowKeys?: string[];
    parentIndexIds?: string[];
    snapshotRevision?: number;
    sourceMessageIndex?: number;
}

export interface PersistSummaryVectorIndexExternalResult_ACU {
    state: ChatSummaryVectorIndexState_ACU;
    manifest: ChatSummaryVectorIndexManifest_ACU;
    uploadedFiles: SummaryVectorIndexExternalFileRef_ACU[];
}

interface SummaryVectorIndexRollbackResult_ACU {
    deletedPaths: string[];
    failedPaths: Array<{ path: string; error: string }>;
    unregisterError?: string;
    orphanRegistrationError?: string;
}

export interface LoadSummaryVectorIndexChunksOptions_ACU {
    preferExternalFiles?: boolean;
    shardReadConcurrency?: number;
}

function markSummaryVectorIndexSnapshotPrepared_ACU(files: SummaryVectorIndexExternalFileRef_ACU[]): void {
    files.forEach((file) => {
        if (file?.path) pendingSummaryVectorIndexPublicationPaths_ACU.add(file.path);
    });
}

/** 仅能在包含新 pointer 的聊天数据已成功保存到宿主后调用。 */
export async function finalizeSummaryVectorIndexSnapshotPublication_ACU(files: SummaryVectorIndexExternalFileRef_ACU[]): Promise<boolean> {
    files.forEach((file) => {
        if (file?.path) pendingSummaryVectorIndexPublicationPaths_ACU.delete(file.path);
    });
    const publishedFiles = files
        .filter((file) => !!file?.path)
        .map((file) => ({ ...file, publicationState: 'published' as const }));
    if (publishedFiles.length === 0) return true;
    try {
        await registerVectorIndexFiles_ACU(publishedFiles);
        return true;
    } catch (error) {
        // 聊天 pointer 已经 durable publish；此处失败不能把调用方带回回滚分支。
        // 保留 prepared registry 条目使 GC 仍可观测，后续 pointer reachability 仍阻止误删。
        logSummaryVectorIndexIdentityEvent_ACU('warn', 'publish', 'registry_finalize_failed', {
            path: publishedFiles[0].path,
            error,
        });
        return false;
    }
}

/** 已确认聊天 pointer 未持久化且已恢复运行时状态时调用，使对象回到可由安全 GC 处置的 registry 候选集。 */
export function abortSummaryVectorIndexSnapshotPublication_ACU(files: SummaryVectorIndexExternalFileRef_ACU[]): void {
    files.forEach((file) => {
        if (file?.path) pendingSummaryVectorIndexPublicationPaths_ACU.delete(file.path);
    });
}

function normalizeChatKey_ACU(chatKey?: string): string {
    const raw = String(chatKey || currentChatFileIdentifier_ACU || 'current-chat').trim();
    return raw || 'current-chat';
}

function buildIndexId_ACU(params: { chatKey: string; isolationKey: string; sourceTableKey: string; snapshotMessageId: string; indexedAt: string }): string {
    return `idx_${hashUserInput_ACU(`${params.chatKey}\n${params.isolationKey}\n${params.sourceTableKey}\n${params.snapshotMessageId}\n${params.indexedAt}`)}`;
}

function buildVersionedSnapshotIndexId_ACU(params: { chatKey: string; isolationKey: string; sourceTableKey: string; snapshotRevision: number }): string {
    const revision = Math.max(1, Math.floor(Number(params.snapshotRevision) || 0));
    return `snap_${hashUserInput_ACU(`${params.chatKey}\n${params.isolationKey}\n${params.sourceTableKey}\n${revision}`)}`;
}

/**
 * [T0a] 生成 V2 单文件快照的 writeGeneration（紧凑格式）。
 * 格式：时间戳base36 + 2×Uint32 定宽 base36（无分隔符）。
 * - 时间戳 base36 通常 8 字符（毫秒级），2×Uint32 定宽各 7 字符 → 总长约 22，上限 24。
 * - 字符集 [a-zA-Z0-9]，不会被 normalizeFileNamePart_ACU 改写。
 * - 熵 64 位：唯一职责是"同 scope 同 revision 同毫秒内两次写入不撞路径"，毫秒时间戳已兜底。
 * - Uint32 最大值 4294967295 的 base36 恰好 7 位，padStart(7, '0') 保证无分隔符亦可无歧义解析。
 */
export function buildVectorIndexSnapshotWriteGeneration_ACU(now: number = Date.now(), entropySource: Uint32Array = new Uint32Array(2)): string {
    const entropy = entropySource;
    if (entropy.length < 2) {
        throw new Error('交火向量 V2 writeGeneration 需要至少 2 个 Uint32 熵值。');
    }
    return `${now.toString(36)}${Array.from(entropy.slice(0, 2), (value) => value.toString(36).padStart(7, '0')).join('')}`;
}


function buildVersionedSnapshotScopePrefix_ACU(chatKey: string, isolationKey: string, sourceTableKey: string): string {
    return `${buildVectorIndexStableDirectory_ACU({ chatKey, isolationKey, sourceTableKey })}_`;
}

function extractVersionedSnapshotIndexIdFromPath_ACU(path: string, scopePrefix: string): string | null {
    const normalizedPath = String(path || '');
    if (!normalizedPath.startsWith(scopePrefix)) return null;
    const remainder = normalizedPath.slice(scopePrefix.length);
    const match = remainder.match(/^(snap_[^_]+)_/);
    return match?.[1] || null;
}

function getVectorIndexFileTimestamp_ACU(file: SummaryVectorIndexExternalFileRef_ACU | null | undefined): string {
    return String(file?.updatedAt || file?.createdAt || '');
}

function sumUniqueVectorIndexFileBytes_ACU(files: Array<SummaryVectorIndexExternalFileRef_ACU | null | undefined>): number {
    const byPath = new Map<string, SummaryVectorIndexExternalFileRef_ACU>();
    files.forEach((file) => {
        const path = String(file?.path || '').trim();
        if (!path) return;
        byPath.set(path, file as SummaryVectorIndexExternalFileRef_ACU);
    });
    return Array.from(byPath.values()).reduce((sum, file) => sum + Math.max(0, Number(file.byteSize) || 0), 0);
}

function normalizeRows_ACU(rows: ChatSummaryVectorIndexRow_ACU[]): ChatSummaryVectorIndexRow_ACU[] {
    return (Array.isArray(rows) ? rows : [])
        .filter((row) => row?.rowKey && Array.isArray(row.chunkIds) && row.chunkIds.length > 0)
        .map((row): ChatSummaryVectorIndexRow_ACU => {
            const status: ChatSummaryVectorIndexRow_ACU['status'] = row.status === 'removed' || row.status === 'replaced'
                ? row.status
                : 'active';
            const chunkKeys = Array.isArray(row.chunkKeys) ? row.chunkKeys.map((item) => String(item)).filter(Boolean) : undefined;
            return {
                ...row,
                chunkIds: row.chunkIds.filter(Boolean),
                ...(chunkKeys && chunkKeys.length > 0 ? { chunkKeys } : {}),
                status,
                updatedAt: row.updatedAt || new Date().toISOString(),
            };
        })
        .sort((left, right) => left.rowOrder - right.rowOrder || left.rowKey.localeCompare(right.rowKey));
}

function normalizeChunks_ACU(chunks: ChatSummaryVectorIndexChunk_ACU[]): ChatSummaryVectorIndexChunk_ACU[] {
    return (Array.isArray(chunks) ? chunks : [])
        .filter((chunk) => chunk?.chunkId && chunk?.rowKey && chunk?.text && isVectorLike_ACU(chunk.vector) && chunk.vector.length > 0)
        .map((chunk, index) => ({ ...chunk, sequence: index }));
}

const VECTOR_ENCODING_F32B64_ACU = 'f32b64' as const;

type StoredVectorIndexChunk_ACU = Omit<ChatSummaryVectorIndexChunk_ACU, 'vector'> & {
    vector: ChatSummaryVectorIndexChunk_ACU['vector'] | string;
    vectorEncoding?: typeof VECTOR_ENCODING_F32B64_ACU;
};

type StoredVectorIndexChunkBlob_ACU = Omit<VectorIndexChunkBlob_ACU, 'vector'> & {
    vector: ChatSummaryVectorIndexChunk_ACU['vector'] | string;
    vectorEncoding?: typeof VECTOR_ENCODING_F32B64_ACU;
};

/** 摘要向量内存表示：Float32Array（解码）或 number[]（兼容旧内存数据）。 */
function isVectorLike_ACU(value: unknown): value is number[] | Float32Array {
    return Array.isArray(value) || value instanceof Float32Array;
}

/** 序列化边界用：把内存向量归一为普通 number[]，不改变落盘/IDB 数组格式。 */
function vectorToFiniteNumberArray_ACU(vector: number[] | Float32Array | null | undefined): number[] {
    if (!isVectorLike_ACU(vector)) return [];
    return Array.from(vector, (value) => Number(value)).filter((value) => Number.isFinite(value));
}

function encodeVectorToF32B64_ACU(vector: number[] | Float32Array): string {
    if (!isVectorLike_ACU(vector)) return '';
    const bytes = new Uint8Array(vector.length * 4);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < vector.length; index += 1) {
        const numeric = Number(vector[index]);
        if (!Number.isFinite(numeric)) {
            throw new Error(`交火向量包含非有限数值，拒绝编码: index=${index}`);
        }
        view.setFloat32(index * 4, numeric, true);
    }
    let binary = '';
    const blockSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += blockSize) {
        const block = bytes.subarray(offset, offset + blockSize);
        for (let i = 0; i < block.length; i += 1) binary += String.fromCharCode(block[i]);
    }
    const encoder = globalThis.btoa;
    if (typeof encoder !== 'function') throw new Error('当前环境缺少 btoa，无法编码交火向量。');
    return encoder(binary);
}

function decodeF32B64ToVector_ACU(encoded: string): Float32Array {
    const decoder = globalThis.atob;
    if (typeof decoder !== 'function') throw new Error('当前环境缺少 atob，无法解码交火向量。');
    const binary = decoder(String(encoded || ''));
    if (binary.length % 4 !== 0) {
        throw new Error(`交火向量 f32b64 字节长度非法: bytes=${binary.length}`);
    }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i) & 0xff;
    const view = new DataView(bytes.buffer);
    const vector = new Float32Array(bytes.length / 4);
    for (let offset = 0; offset < bytes.length; offset += 4) vector[offset / 4] = view.getFloat32(offset, true);
    return vector;
}

function encodeChunkVectorForStorage_ACU<T extends ChatSummaryVectorIndexChunk_ACU>(chunk: T): Omit<T, 'vector'> & { vector: string; vectorEncoding: typeof VECTOR_ENCODING_F32B64_ACU } {
    return { ...chunk, vector: encodeVectorToF32B64_ACU(chunk.vector), vectorEncoding: VECTOR_ENCODING_F32B64_ACU };
}

function decodeChunkVectorInPlace_ACU(chunk: StoredVectorIndexChunk_ACU): ChatSummaryVectorIndexChunk_ACU {
    if (chunk.vectorEncoding === VECTOR_ENCODING_F32B64_ACU || typeof chunk.vector === 'string') {
        chunk.vector = decodeF32B64ToVector_ACU(String(chunk.vector || ''));
        delete chunk.vectorEncoding;
    } else if (isVectorLike_ACU(chunk.vector)) {
        // 旧内存 number[] → 统一为 Float32Array（内存表示迁移）。
        chunk.vector = Float32Array.from(vectorToFiniteNumberArray_ACU(chunk.vector));
    }
    return chunk as ChatSummaryVectorIndexChunk_ACU;
}

function decodeChunkVectorsInPlace_ACU(chunks: StoredVectorIndexChunk_ACU[]): ChatSummaryVectorIndexChunk_ACU[] {
    return (Array.isArray(chunks) ? chunks : []).map((chunk) => decodeChunkVectorInPlace_ACU(chunk));
}

interface VectorIndexChunkBlob_ACU {
    version: number;
    chunkKey: string;
    chunkId: string;
    rowKey: string;
    rowOrder: number;
    text: string;
    vector: number[];
    vectorEncoding?: typeof VECTOR_ENCODING_F32B64_ACU;
    sequence: number;
    embeddingModel: string;
    dimension: number;
    sourceFingerprint?: string;
    textHash?: string;
    createdAt: string;
    updatedAt: string;
}

interface VectorIndexPackBlob_ACU {
    version: number;
    packKey: string;
    indexId: string;
    embeddingModel: string;
    dimension: number;
    chunkKeys: string[];
    chunks: VectorIndexChunkBlob_ACU[];
    createdAt: string;
    updatedAt: string;
}

export interface VectorIndexSingleSnapshotBlob_ACU {
    version: number;
    schema: 'single_file_snapshot';
    indexId: string;
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
    sourceTableName: string;
    snapshotMessageId: string;
    embeddingModel: string;
    dimension: number;
    indexedAt: string;
    updatedAt: string;
    storageIdentity?: SummaryVectorIndexStorageIdentity_ACU;
    manifest: ChatSummaryVectorIndexManifest_ACU;
    rows: ChatSummaryVectorIndexRow_ACU[];
    chunks: StoredVectorIndexChunk_ACU[];
    tombstone: SummaryVectorIndexTombstone_ACU;
}

interface PreparedVectorChunkBlob_ACU {
    chunk: ChatSummaryVectorIndexChunk_ACU;
    blob: VectorIndexChunkBlob_ACU;
    chunkKey: string;
    chunkChecksum: string;
    chunkByteSize: number;
    rowKey: string;
    chunkId: string;
    sourceFingerprint?: string;
    textHash?: string;
}

function buildVectorChunkKey_ACU(params: {
    embeddingModel: string;
    dimension: number;
    rowKey: string;
    sourceFingerprint?: string;
    text: string;
}): string {
    return `chunk_${hashUserInput_ACU([
        params.embeddingModel,
        String(Math.max(0, Math.floor(Number(params.dimension) || 0))),
        params.rowKey,
        params.sourceFingerprint || '',
        params.text,
    ].join('\n'))}`;
}

function buildVectorChunkPath_ACU(parts: {
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
    chunkKey: string;
}): string {
    return buildVectorIndexSnapshotFilePath_ACU({
        chatKey: parts.chatKey,
        isolationKey: parts.isolationKey,
        sourceTableKey: parts.sourceTableKey,
        indexId: parts.chunkKey,
        role: 'vector_chunk',
    });
}

function buildVectorPackKey_ACU(params: {
    indexId: string;
    embeddingModel: string;
    dimension: number;
    chunkKeys: string[];
}): string {
    return `pack_${hashUserInput_ACU([
        params.indexId,
        params.embeddingModel,
        String(Math.max(0, Math.floor(Number(params.dimension) || 0))),
        ...params.chunkKeys.slice().sort(),
    ].join('\n'))}`;
}

function buildVectorPackPath_ACU(parts: {
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
    indexId: string;
    packKey: string;
}): string {
    return buildVectorIndexSnapshotFilePath_ACU({
        chatKey: parts.chatKey,
        isolationKey: parts.isolationKey,
        sourceTableKey: parts.sourceTableKey,
        indexId: parts.indexId,
        role: 'vector_pack',
        shardId: parts.packKey,
    });
}

function buildVectorChunkBlob_ACU(chunk: ChatSummaryVectorIndexChunk_ACU, options: {
    chunkKey: string;
    embeddingModel: string;
    dimension: number;
    sourceFingerprint?: string;
}): VectorIndexChunkBlob_ACU {
    const now = new Date().toISOString();
    return {
        version: SUMMARY_VECTOR_INDEX_MANIFEST_VERSION_ACU,
        chunkKey: options.chunkKey,
        chunkId: chunk.chunkId,
        rowKey: chunk.rowKey,
        rowOrder: Number.isFinite(Number((chunk as any).rowOrder)) ? Number((chunk as any).rowOrder) : 0,
        text: chunk.text,
        vector: vectorToFiniteNumberArray_ACU(chunk.vector),
        sequence: Number.isFinite(Number(chunk.sequence)) ? Number(chunk.sequence) : 0,
        embeddingModel: options.embeddingModel,
        dimension: Math.max(0, Math.floor(Number(options.dimension) || 0)),
        sourceFingerprint: options.sourceFingerprint,
        textHash: hashUserInput_ACU(chunk.text),
        createdAt: now,
        updatedAt: now,
    };
}

async function prepareVectorChunkBlob_ACU(chunk: ChatSummaryVectorIndexChunk_ACU, options: {
    embeddingModel: string;
    dimension: number;
    sourceFingerprint?: string;
}): Promise<PreparedVectorChunkBlob_ACU> {
    const chunkKey = buildVectorChunkKey_ACU({
        embeddingModel: options.embeddingModel,
        dimension: options.dimension,
        rowKey: chunk.rowKey,
        sourceFingerprint: options.sourceFingerprint,
        text: chunk.text,
    });
    const blob = buildVectorChunkBlob_ACU(chunk, {
        chunkKey,
        embeddingModel: options.embeddingModel,
        dimension: options.dimension,
        sourceFingerprint: options.sourceFingerprint,
    });
    const chunkJson = JSON.stringify(blob);
    return {
        chunk,
        blob,
        chunkKey,
        chunkChecksum: await sha256Text_ACU(chunkJson),
        chunkByteSize: new Blob([chunkJson]).size,
        rowKey: chunk.rowKey,
        chunkId: chunk.chunkId,
        sourceFingerprint: options.sourceFingerprint,
        textHash: blob.textHash,
    };
}

function chunkArray_ACU<T>(items: T[], limit: number): T[][] {
    const size = Math.max(1, Math.floor(Number(limit) || DEFAULT_SHARD_CHUNK_LIMIT_ACU));
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
}

function dedupeByPath_ACU<T extends { path?: string }>(items: T[]): T[] {
    const seen = new Set<string>();
    const result: T[] = [];
    for (const item of Array.isArray(items) ? items : []) {
        const path = String(item?.path || '').trim();
        if (!path || seen.has(path)) continue;
        seen.add(path);
        result.push(item);
    }
    return result;
}

function dedupeChunkRefs_ACU<T extends { chunkKey?: string; chunkId?: string; rowKey?: string; path?: string }>(items: T[]): T[] {
    const seen = new Set<string>();
    const result: T[] = [];
    for (const item of Array.isArray(items) ? items : []) {
        const chunkKey = String(item?.chunkKey || '').trim();
        const chunkId = String(item?.chunkId || '').trim();
        const rowKey = String(item?.rowKey || '').trim();
        const path = String(item?.path || '').trim();
        if (!chunkKey || !path) continue;
        const key = `${chunkKey}::${chunkId}::${rowKey}::${path}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(item);
    }
    return result;
}

function buildRowIndex_ACU(indexId: string, rows: ChatSummaryVectorIndexRow_ACU[], shardIdsByChunkId: Map<string, string>, updatedAt: string): SummaryVectorIndexRowIndex_ACU {
    const entries: Record<string, SummaryVectorIndexRowIndexEntry_ACU> = {};
    rows.forEach((row) => {
        const shardIds = Array.from(new Set(row.chunkIds.map((chunkId) => shardIdsByChunkId.get(chunkId)).filter((value): value is string => !!value)));
        entries[row.rowKey] = {
            rowKey: row.rowKey,
            rowId: row.rowId,
            rowOrder: row.rowOrder,
            summaryKey: row.rowKey,
            // 兜底仅对无指纹的 legacy 行触发；必须用权威公式（不含 rowOrder），
            // 与 archive-service 的行指纹保持同一来源，防止公式漂移造成对账永久 mismatch。
            sourceFingerprint: row.sourceFingerprint || buildSummaryRowFingerprint_ACU(row),
            indexCode: row.indexCode,
            chunkIds: [...row.chunkIds],
            shardIds,
            status: row.status === 'removed' || row.status === 'replaced' ? row.status : 'active',
            updatedAt,
        };
    });
    return { version: SUMMARY_VECTOR_INDEX_MANIFEST_VERSION_ACU, indexId, updatedAt, rows: entries };
}

function buildTombstone_ACU(indexId: string, previousManifest: ChatSummaryVectorIndexManifest_ACU | null | undefined, updatedAt: string): SummaryVectorIndexTombstone_ACU {
    return {
        version: SUMMARY_VECTOR_INDEX_MANIFEST_VERSION_ACU,
        indexId,
        updatedAt,
        removedRows: {},
        removedChunks: {},
        ...(previousManifest?.indexId ? { previousIndexId: previousManifest.indexId } as any : {}),
    };
}

export function normalizeSummaryVectorIndexManifestForRead_ACU(
    manifest: ChatSummaryVectorIndexManifest_ACU | null | undefined,
): ChatSummaryVectorIndexManifest_ACU | null {
    if (!manifest || typeof manifest !== 'object') return null;
    const files = Array.isArray(manifest.files)
        ? manifest.files.filter((file) => file && typeof file === 'object' && String(file.path || '').trim())
        : [];
    const batchRefs = Array.isArray(manifest.batchRefs)
        ? manifest.batchRefs.map((batch) => ({
            ...batch,
            files: Array.isArray(batch?.files)
                ? batch.files.filter((file) => file && typeof file === 'object' && String(file.path || '').trim())
                : [],
            rowKeys: Array.isArray(batch?.rowKeys) ? batch.rowKeys.map((item) => String(item || '')).filter(Boolean) : [],
            chunkIds: Array.isArray(batch?.chunkIds) ? batch.chunkIds.map((item) => String(item || '')).filter(Boolean) : [],
            status: batch?.status || 'ready',
        }))
        : [];
    const contentAddressed = manifest.contentAddressed && typeof manifest.contentAddressed === 'object'
        ? {
            ...manifest.contentAddressed,
            mode: manifest.contentAddressed.packRefs?.length ? 'content_addressed_packs' : (manifest.contentAddressed.mode || 'content_addressed_chunks'),
            chunkRefs: Array.isArray(manifest.contentAddressed.chunkRefs)
                ? dedupeChunkRefs_ACU(manifest.contentAddressed.chunkRefs.filter((ref) => ref && String(ref.path || '').trim() && String(ref.chunkKey || '').trim()).map((ref) => ({
                    ...ref,
                    path: String(ref.path || '').trim(),
                    packKey: String((ref as any).packKey || '').trim() || undefined,
                    packPath: String((ref as any).packPath || '').trim() || undefined,
                })))
                : [],
            activeChunkKeys: Array.isArray(manifest.contentAddressed.activeChunkKeys)
                ? manifest.contentAddressed.activeChunkKeys.map((item) => String(item || '')).filter(Boolean)
                : [],
            packRefs: Array.isArray(manifest.contentAddressed.packRefs)
                ? dedupeByPath_ACU(manifest.contentAddressed.packRefs.filter((ref) => ref && String(ref.path || '').trim() && String(ref.packKey || '').trim()).map((ref) => ({
                    ...ref,
                    path: String(ref.path || '').trim(),
                    chunkKeys: Array.isArray(ref.chunkKeys) ? Array.from(new Set(ref.chunkKeys.map((item) => String(item || '')).filter(Boolean))) : [],
                })))
                : [],
        }
        : undefined;
    const activeRowKeys = Array.isArray(manifest.snapshot?.activeRowKeys)
        ? manifest.snapshot!.activeRowKeys.map((item) => String(item || '')).filter(Boolean)
        : [];
    const activeChunkIds = Array.isArray(manifest.snapshot?.activeChunkIds)
        ? manifest.snapshot!.activeChunkIds.map((item) => String(item || '')).filter(Boolean)
        : undefined;
    const removedRowKeys = Array.isArray(manifest.snapshot?.removedRowKeys)
        ? manifest.snapshot!.removedRowKeys.map((item) => String(item || '')).filter(Boolean)
        : [];
    const replacedRowKeys = Array.isArray(manifest.snapshot?.replacedRowKeys)
        ? manifest.snapshot!.replacedRowKeys.map((item) => String(item || '')).filter(Boolean)
        : [];
    const batchIds = Array.isArray(manifest.snapshot?.batchIds)
        ? manifest.snapshot!.batchIds.map((item) => String(item || '')).filter(Boolean)
        : batchRefs.map((batch) => String(batch.batchId || '')).filter(Boolean);
    const normalized: ChatSummaryVectorIndexManifest_ACU = {
        ...manifest,
        version: Number.isFinite(Number(manifest.version)) ? Number(manifest.version) : 1,
        backend: 'st-files',
        status: manifest.status || 'ready',
        indexId: String(manifest.indexId || ''),
        chatKey: String(manifest.chatKey || currentChatFileIdentifier_ACU || 'current-chat'),
        // 仅把真正缺失的默认域补齐。不要 trim 或大小写折叠已存身份：
        // legacy/V2 validator 仍需能识别空白和大小写漂移，而不是被 reader 静默修复。
        isolationKey: manifest.storageIdentity
            ? String(manifest.isolationKey ?? '')
            : manifest.isolationKey === '' || manifest.isolationKey == null
                ? normalizeSummaryVectorIsolationKey_ACU(manifest.isolationKey == null ? getCurrentIsolationKey_ACU() : manifest.isolationKey)
                : String(manifest.isolationKey),
        snapshotMessageId: String(manifest.snapshotMessageId || ''),
        sourceTableKey: String(manifest.sourceTableKey || 'summary'),
        sourceTableName: String(manifest.sourceTableName || '纪要表'),
        indexedAt: String(manifest.indexedAt || manifest.updatedAt || new Date().toISOString()),
        updatedAt: String(manifest.updatedAt || manifest.indexedAt || new Date().toISOString()),
        rowCount: Math.max(0, Math.floor(Number(manifest.rowCount) || 0)),
        chunkCount: Math.max(0, Math.floor(Number(manifest.chunkCount) || 0)),
        skippedRowCount: Math.max(0, Math.floor(Number(manifest.skippedRowCount) || 0)),
        embeddingModel: String(manifest.embeddingModel || ''),
        dimension: Math.max(0, Math.floor(Number(manifest.dimension) || 0)),
        rowsFile: String(manifest.rowsFile || ''),
        tombstoneFile: String(manifest.tombstoneFile || ''),
        manifestFile: String(manifest.manifestFile || ''),
        files,
        baseShardCount: Math.max(0, Math.floor(Number(manifest.baseShardCount) || files.filter((file) => file.role === 'base_shard').length)),
        deltaShardCount: Math.max(0, Math.floor(Number(manifest.deltaShardCount) || files.filter((file) => file.role === 'delta_shard').length)),
        tombstoneRowCount: Math.max(0, Math.floor(Number(manifest.tombstoneRowCount) || 0)),
        tombstoneChunkCount: Math.max(0, Math.floor(Number(manifest.tombstoneChunkCount) || 0)),
        externalTotalBytes: Math.max(0, Math.floor(Number(manifest.externalTotalBytes) || sumUniqueVectorIndexFileBytes_ACU(files))),
        snapshot: manifest.snapshot ? {
            revision: Math.max(1, Math.floor(Number(manifest.snapshot.revision) || 1)),
            mode: manifest.snapshot.mode === 'single_file_snapshot'
                ? 'single_file_snapshot'
                : manifest.snapshot.mode === 'base_rolling_delta'
                    ? 'base_rolling_delta'
                    : 'snapshot',
            parentIndexIds: Array.isArray(manifest.snapshot.parentIndexIds) ? manifest.snapshot.parentIndexIds.map((item) => String(item || '')).filter(Boolean) : [],
            activeRowKeys,
            activeChunkIds,
            removedRowKeys,
            replacedRowKeys,
            batchIds,
        } : undefined,
        batchRefs,
        ...(contentAddressed ? { contentAddressed } : {}),
    };
    return normalized.indexId ? normalized : null;
}

function collectManifestFilePaths_ACU(manifest: ChatSummaryVectorIndexManifest_ACU | null | undefined): Set<string> {
    manifest = normalizeSummaryVectorIndexManifestForRead_ACU(manifest);
    const paths = new Set<string>();
    const addPath = (path: any): void => {
        const normalizedPath = String(path || '').trim();
        if (normalizedPath) paths.add(normalizedPath);
    };
    const addFile = (file: SummaryVectorIndexExternalFileRef_ACU | null | undefined): void => {
        addPath(file?.path);
    };
    addPath(manifest?.manifestFile);
    addPath(manifest?.rowsFile);
    addPath(manifest?.tombstoneFile);
    (manifest?.files || []).forEach(addFile);
    (manifest?.batchRefs || []).forEach((batch) => (batch.files || []).forEach(addFile));
    (manifest?.contentAddressed?.chunkRefs || []).forEach((ref) => addPath(ref.path));
    (manifest?.contentAddressed?.packRefs || []).forEach((ref) => addPath(ref.path));
    return paths;
}

async function cleanupManifestFilesExcept_ACU(
    previousManifest: ChatSummaryVectorIndexManifest_ACU | null | undefined,
    retainedPaths: Set<string>,
): Promise<void> {
    const previousPaths = collectManifestFilePaths_ACU(previousManifest);
    if (previousPaths.size === 0) return;
    // T14：pack 跨 revision 共享，按单 manifest 清理会误删其它楼层仍引用的对象；
    // 物理删除只归安全 GC（cleanupUnreachableSummaryVectorIndexFiles_ACU 的 pack 分支）。
    const removablePaths = Array.from(previousPaths).filter((path) => path
        && !retainedPaths.has(path)
        && !isVectorIndexContentPackPathV2_ACU(path));
    const deletedPaths: string[] = [];
    for (const path of removablePaths) {
        const result = await deleteVectorIndexFile_ACU(path);
        if (result.ok) {
            deletedPaths.push(result.path || path);
        } else {
            logWarn_ACU('[交火向量索引] 清理未复用外置文件失败:', path, result.error);
        }
    }
    await unregisterVectorIndexFiles_ACU(deletedPaths);
    if (previousManifest.indexId && !Array.from(retainedPaths).some((path) => path.includes(previousManifest.indexId))) {
        await deleteVectorIndexCacheByIndex_ACU(previousManifest.indexId);
    }
}

function collectManifestReachableFiles_ACU(
    rawManifest: ChatSummaryVectorIndexManifest_ACU,
    context: { messageIndex: number; isolationKey: string },
): SummaryVectorIndexReachableFile_ACU[] {
    const manifest = normalizeSummaryVectorIndexManifestForRead_ACU(rawManifest);
    if (!manifest) return [];
    const reachableFiles: SummaryVectorIndexReachableFile_ACU[] = [];
    const seen = new Set<string>();
    const expectedIdentity = {
        chatKey: manifest.chatKey,
        isolationKey: manifest.isolationKey,
        sourceTableKey: manifest.sourceTableKey,
        indexId: manifest.indexId,
        snapshotRevision: manifest.snapshot?.revision,
        storageIdentity: manifest.storageIdentity ? { ...manifest.storageIdentity } : undefined,
        embeddingModel: manifest.embeddingModel,
        dimension: manifest.dimension,
    };
    const pushFile = (file: Partial<SummaryVectorIndexReachableFile_ACU> & { path?: string }): void => {
        const path = String(file.path || '').trim();
        if (!path || seen.has(path)) return;
        seen.add(path);
        reachableFiles.push({
            path,
            references: [{ messageIndex: context.messageIndex, isolationKey: context.isolationKey }],
            role: file.role,
            expectedIdentity,
            manifest,
            indexId: file.indexId || manifest.indexId,
            messageIndex: context.messageIndex,
            isolationKey: context.isolationKey,
            sourceTableKey: manifest.sourceTableKey,
            manifestKey: manifest.indexId,
            checksum: file.checksum,
            chunkKey: file.chunkKey,
            chunkId: file.chunkId,
            rowKey: file.rowKey,
        });
    };

    pushFile({ path: manifest.manifestFile, role: 'manifest' });
    pushFile({ path: manifest.rowsFile, role: 'row_index' });
    pushFile({ path: manifest.tombstoneFile, role: 'tombstone' });
    (manifest.files || []).forEach((file) => pushFile({ ...file, indexId: manifest.indexId }));
    (manifest.batchRefs || []).forEach((batch) => (batch.files || []).forEach((file) => pushFile({ ...file, indexId: batch.indexId || manifest.indexId })));
    const contentInfo = manifest.contentAddressed;
    if (contentInfo?.mode === 'content_addressed_packs' && Array.isArray(contentInfo.packRefs) && contentInfo.packRefs.length > 0) {
        contentInfo.packRefs.forEach((ref) => pushFile({
            path: ref.path,
            role: 'vector_pack',
            indexId: manifest.indexId,
            checksum: ref.checksum,
        }));
    } else {
        (contentInfo?.chunkRefs || []).forEach((ref) => pushFile({
            path: ref.path,
            role: 'vector_chunk',
            indexId: manifest.indexId,
            checksum: ref.checksum,
            chunkKey: ref.chunkKey,
            chunkId: ref.chunkId,
            rowKey: ref.rowKey,
        }));
    }
    return reachableFiles;
}

function buildReachableFileIdentityKey_ACU(file: SummaryVectorIndexReachableFile_ACU): string {
    return JSON.stringify([
        file.path,
        file.role || '',
        file.expectedIdentity,
        file.checksum || '',
        file.chunkKey || '',
        file.chunkId || '',
        file.rowKey || '',
    ]);
}

export async function collectSummaryVectorIndexReachability_ACU(): Promise<SummaryVectorIndexReachabilityReport_ACU> {
    const layers = getAllSummaryVectorIndexSnapshotLayers_ACU();
    const chatKey = normalizeChatKey_ACU();
    const reachabilityByIdentity = new Map<string, SummaryVectorIndexReachableFile_ACU>();
    let manifestCount = 0;
    layers.forEach((layer) => {
        // state.manifest 与 standalone manifest 都是持久化引用。正常 writer 会令二者一致，
        // 但历史中断或外部污染导致不一致时，GC 必须保护两者，不能擅自挑一份当权威。
        const manifests = [
            layer.summaryVectorIndexState?.manifest,
            layer.tagData?.summaryVectorIndexManifest,
        ].filter((manifest): manifest is ChatSummaryVectorIndexManifest_ACU => !!manifest);
        manifests.forEach((manifest) => {
            manifestCount += 1;
            collectManifestReachableFiles_ACU(manifest, {
                messageIndex: layer.messageIndex,
                isolationKey: layer.isolationKey,
            }).forEach((file) => {
                const identityKey = buildReachableFileIdentityKey_ACU(file);
                const existing = reachabilityByIdentity.get(identityKey);
                if (!existing) {
                    reachabilityByIdentity.set(identityKey, file);
                    return;
                }
                const references = [...(existing.references || [{ messageIndex: existing.messageIndex, isolationKey: existing.isolationKey }])];
                (file.references || []).forEach((reference) => {
                    if (!references.some((item) => item.messageIndex === reference.messageIndex && item.isolationKey === reference.isolationKey)) references.push(reference);
                });
                existing.references = references;
            });
        });
    });
    const reachableFiles = Array.from(reachabilityByIdentity.values());
    return {
        chatKey,
        reachablePaths: Array.from(new Set(reachableFiles.map((file) => file.path))),
        reachableFiles,
        manifestCount,
    };
}

type LegacyLosslessV2GcVerdict_ACU = 'not_legacy' | 'retain' | 'delete';

/**
 * 升级前写出的 V2 对象把三元组无损 base64 进了路径。它们的 token 与现行 SHA-256 指纹
 * 永远不相等，若不单独处理会被 quarantine 永久占盘。此处从路径反解 scope，
 * 要求与某个 eligible scope 精确相等、超过 grace、且 blob 内身份与路径一致，三者齐备才判删。
 */
async function judgeLegacyLosslessV2Orphan_ACU(
    file: SummaryVectorIndexExternalFileRef_ACU,
    eligibleScopes: Array<{ chatKey: string; isolationKey: string; sourceTableKey: string }>,
): Promise<LegacyLosslessV2GcVerdict_ACU> {
    const path = String(file?.path || '').trim();
    const decoded = decodeVectorIndexScopeFromPath_ACU(path);
    if (!decoded) return 'not_legacy';
    const scope = normalizeSummaryVectorIndexScope_ACU(decoded);
    const matched = eligibleScopes.some((candidate) => candidate.chatKey === scope.chatKey
        && candidate.isolationKey === scope.isolationKey
        && candidate.sourceTableKey === scope.sourceTableKey);
    if (!matched) return 'retain';
    if (String(file.publicationState || '') === 'prepared') return 'retain';
    const registeredAt = Date.parse(String(file.createdAt || file.updatedAt || ''));
    if (!Number.isFinite(registeredAt) || Date.now() - registeredAt < SUMMARY_VECTOR_INDEX_SAFE_GC_GRACE_PERIOD_MS_ACU) {
        return 'retain';
    }
    const legacyToken = buildLegacyVectorIndexLosslessScopeTokenV2_ACU(scope);
    if (isVectorIndexContentPackPathV2_ACU(path)) {
        const loaded = await readVectorIndexJsonFile_ACU<SummaryVectorIndexContentPackBlob_ACU>(path);
        const pack = loaded.ok ? loaded.data : null;
        const verified = !!pack
            && pack.schema === SUMMARY_VECTOR_INDEX_CONTENT_PACK_SCHEMA_ACU
            && String(pack.packScope || '') === legacyToken;
        return verified ? 'delete' : 'retain';
    }
    const loaded = await readVectorIndexJsonFile_ACU<VectorIndexSingleSnapshotBlob_ACU>(path);
    const blob = loaded.ok ? loaded.data : null;
    const verified = !!blob
        && blob.schema === 'single_file_snapshot'
        && String(blob.chatKey || '') === scope.chatKey
        && String(blob.isolationKey || '') === scope.isolationKey
        && String(blob.sourceTableKey || '') === scope.sourceTableKey
        && String(blob.storageIdentity?.scopeFingerprint || '') === legacyToken;
    return verified ? 'delete' : 'retain';
}

export async function cleanupUnreachableSummaryVectorIndexFiles_ACU(options: SummaryVectorIndexSafeGcOptions_ACU = {}): Promise<SummaryVectorIndexSafeGcResult_ACU> {
    const reachability = await collectSummaryVectorIndexReachability_ACU();
    const registry = await loadVectorIndexRegistry_ACU();
    const reachablePathSet = new Set(reachability.reachablePaths);
    // finalize 的 registry 写入可能在 durable pointer 已提交后失败。此时不能回滚 pointer，
    // 但 GC 已能用 pointer 证明对象可达；在这里幂等修复 prepared → published，避免恢复能力永久降级。
    // pending 路径的 pointer 可能只存在于运行时，尚未 durable 保存；绝不能据此升格。
    const publishablePreparedFiles = registry.files
        .filter((file) => {
            const path = String(file?.path || '').trim();
            return file?.publicationState === 'prepared'
                && !!path
                && !pendingSummaryVectorIndexPublicationPaths_ACU.has(path)
                && reachablePathSet.has(path);
        })
        .map((file) => ({ ...file, publicationState: 'published' as const }));
    if (publishablePreparedFiles.length > 0) {
        try {
            await registerVectorIndexFiles_ACU(publishablePreparedFiles);
        } catch (error) {
            logSummaryVectorIndexIdentityEvent_ACU('warn', 'publish', 'registry_reconcile_failed', {
                path: publishablePreparedFiles[0].path,
                error,
            });
        }
    }
    const scopeHints = Array.isArray(options.scopeHints) ? options.scopeHints : [];
    const eligibleScopes = scopeHints.map((hint) => ({
        chatKey: String(hint.chatKey || reachability.chatKey),
        isolationKey: String(hint.isolationKey || ''),
        sourceTableKey: String(hint.sourceTableKey || ''),
    })).filter((scope) => scope.isolationKey && scope.sourceTableKey);
    const deletedPaths: string[] = [];
    const retainedPaths: string[] = [];
    const blockedByReachability: string[] = [];
    const failedDeletes: Array<{ path: string; error: string }> = [];
    const scannedRegisteredFileCount = registry.files.length;
    let reachableFileCount = 0;
    for (const file of registry.files) {
        const path = String(file?.path || '').trim();
        if (!path) continue;
        if (pendingSummaryVectorIndexPublicationPaths_ACU.has(path)) {
            retainedPaths.push(path);
            blockedByReachability.push(path);
            continue;
        }
        if (reachablePathSet.has(path)) {
            reachableFileCount += 1;
            retainedPaths.push(path);
            blockedByReachability.push(path);
            continue;
        }
        // 升级前的无损 token 路径：现行指纹前缀永远匹配不上，必须先于 pack / snapshot 分支处理。
        const legacyVerdict = eligibleScopes.length > 0
            ? await judgeLegacyLosslessV2Orphan_ACU(file, eligibleScopes)
            : 'not_legacy';
        if (legacyVerdict !== 'not_legacy') {
            if (legacyVerdict === 'retain') {
                retainedPaths.push(path);
                blockedByReachability.push(path);
                continue;
            }
            const legacyDelete = await deleteVectorIndexFile_ACU(path);
            if (legacyDelete.ok) {
                logSummaryVectorIndexIdentityEvent_ACU('debug', 'gc', 'deleted_verified_orphan', { path });
                pendingSummaryVectorIndexPublicationPaths_ACU.delete(path);
                deletedPaths.push(legacyDelete.path || path);
            } else {
                failedDeletes.push({ path, error: legacyDelete.error || '删除失败' });
            }
            continue;
        }
        // T14：P4 内容寻址 pack 独立 GC 流程。
        // pack 跨 revision 共享（路径不含 indexId/revision），绝不能被单 manifest 清理
        // （cleanupManifestFilesExcept_ACU 已排除）；此处只处理不可达对象：
        // 1) scope 前缀筛选（不匹配任何 eligible scope -> quarantine）
        // 2) grace 判定前置：不可信/未超时 -> quarantine 且不下载 blob（34MB 快照场景避免浪费）
        // 3) 回读校验 schema/version/packScope/packKey/checksum -> 全通过才删除
        if (isVectorIndexContentPackPathV2_ACU(path)) {
            if (eligibleScopes.length === 0) {
                retainedPaths.push(path);
                blockedByReachability.push(path);
                continue;
            }
            // prepared 未 finalize 的 pack 无论是否可达都必须保留：
            // finalize 前的 registry 发布窗口内，pointer 可能尚未 durable 落盘，
            // 删除会让上层 finalize 时找不到对象（计划 §T14）。
            if (String(file.publicationState || '') === 'prepared') {
                retainedPaths.push(path);
                blockedByReachability.push(path);
                continue;
            }
            // scopeToken 的 base64url 字母表含 `_`（base64 的 `/` 替换而来），
            // split('_')[0] 会截断此类 token 导致永远失配（CJK 聊天名大概率命中）。
            // 改为用候选 scope 构造完整 token 做前缀匹配。
            const candidatePackScopes = eligibleScopes.filter((scope) => path.startsWith(
                `TavernDB_ACU_vector_v2pack_${buildVectorIndexSingleSnapshotV2ScopeToken_ACU(scope)}_`,
            ));
            if (candidatePackScopes.length === 0) {
                retainedPaths.push(path);
                blockedByReachability.push(path);
                continue;
            }
            // grace 前置：registry 上传时间不可信或未超窗口 -> quarantine，不下载 blob。
            const registeredAt = Date.parse(String(file.createdAt || file.updatedAt || ''));
            if (!Number.isFinite(registeredAt) || Date.now() - registeredAt < SUMMARY_VECTOR_INDEX_SAFE_GC_GRACE_PERIOD_MS_ACU) {
                retainedPaths.push(path);
                blockedByReachability.push(path);
                continue;
            }
            const packLoaded = await readVectorIndexJsonFile_ACU<SummaryVectorIndexContentPackBlob_ACU>(path);
            const packData = packLoaded.ok ? packLoaded.data : null;
            const scope = candidatePackScopes[0];
            const matchedScopeToken = buildVectorIndexSingleSnapshotV2ScopeToken_ACU(scope);
            const packKeyFromPath = path.slice(`TavernDB_ACU_vector_v2pack_${matchedScopeToken}_`.length);
            const packMatches = !!packData
                && packData.schema === SUMMARY_VECTOR_INDEX_CONTENT_PACK_SCHEMA_ACU
                && Number(packData.version) === SUMMARY_VECTOR_INDEX_CONTENT_PACK_VERSION_ACU
                && String(packData.packScope || '') === buildVectorIndexSingleSnapshotV2ScopeToken_ACU(scope)
                && String(packData.packKey || '') === packKeyFromPath
                && (!file.checksum || (await sha256Text_ACU(JSON.stringify(packData))) === file.checksum);
            if (!packMatches) {
                retainedPaths.push(path);
                blockedByReachability.push(path);
                logSummaryVectorIndexIdentityEvent_ACU('warn', 'gc', 'quarantined_identity_unverified', {
                    path,
                    scopeFingerprint: buildVectorIndexSingleSnapshotV2ScopeToken_ACU(scope),
                });
                continue;
            }
            const packDelete = await deleteVectorIndexFile_ACU(path);
            if (packDelete.ok) {
                pendingSummaryVectorIndexPublicationPaths_ACU.delete(path);
                deletedPaths.push(packDelete.path || path);
            } else {
                failedDeletes.push({ path, error: packDelete.error || '删除失败' });
            }
            continue;
        }
        // 旧路径没有足够的持久化 identity 可供 GC 验证。仅凭历史文件名前缀删除，
        // 会把 legacy collision 当成 orphan；因此一律 quarantine，等待显式迁移或人工处置。
        if (!path.startsWith('TavernDB_ACU_vector_v2_') || eligibleScopes.length === 0) {
            retainedPaths.push(path);
            blockedByReachability.push(path);
            continue;
        }
        const candidateScopes = eligibleScopes.filter((scope) => path.startsWith(
            `TavernDB_ACU_vector_v2_${buildVectorIndexSingleSnapshotV2ScopeToken_ACU(scope)}_`,
        ));
        if (candidateScopes.length === 0) {
            retainedPaths.push(path);
            blockedByReachability.push(path);
            continue;
        }
        // Prefix 仅用于筛选。删除前必须从 blob 读取 canonical scope，避免截断、legacy
        // 格式或被污染 registry 导致跨 scope 误删。
        const loaded = await readVectorIndexJsonFile_ACU<VectorIndexSingleSnapshotBlob_ACU>(path);
        const matchesScope = loaded.ok && !!loaded.data && candidateScopes.some((scope) => (
            (() => {
                const blob = loaded.data!;
                const registeredAt = Date.parse(String(file.createdAt || file.updatedAt || ''));
                // grace window 只信任 registry 的上传时间；blob 内 indexedAt 是业务字段，不能作为 GC 删除时钟。
                if (!Number.isFinite(registeredAt) || Date.now() - registeredAt < SUMMARY_VECTOR_INDEX_SAFE_GC_GRACE_PERIOD_MS_ACU) {
                    return false;
                }
                const identity = blob.storageIdentity;
                const manifest = blob.manifest;
                const expectedScopeFingerprint = buildVectorIndexSingleSnapshotV2ScopeToken_ACU(scope);
                let expectedPath = '';
                try {
                    expectedPath = identity?.writeGeneration
                        ? buildVectorIndexSingleSnapshotV2FilePath_ACU({
                            chatKey: scope.chatKey,
                            isolationKey: scope.isolationKey,
                            sourceTableKey: scope.sourceTableKey,
                            indexId: String(blob.indexId || ''),
                            writeGeneration: identity.writeGeneration,
                        })
                        : '';
                } catch {
                    return false;
                }
                return blob.schema === 'single_file_snapshot'
                    && path === expectedPath
                    && String(blob.chatKey || '') === scope.chatKey
                    && String(blob.isolationKey || '') === scope.isolationKey
                    && String(blob.sourceTableKey || '') === scope.sourceTableKey
                    && identity?.layoutVersion === 2
                    && identity.scopeFingerprint === expectedScopeFingerprint
                    && !!identity.writeGeneration
                    && Number.isInteger(identity.revision)
                    && Number(identity.revision) > 0
                    && !!manifest
                    && String(manifest.indexId || '') === String(blob.indexId || '')
                    && String(manifest.chatKey || '') === scope.chatKey
                    && String(manifest.isolationKey || '') === scope.isolationKey
                    && String(manifest.sourceTableKey || '') === scope.sourceTableKey
                    && String(manifest.embeddingModel || '') === String(blob.embeddingModel || '')
                    && Number(manifest.dimension) === Number(blob.dimension)
                    && manifest.storageIdentity?.layoutVersion === 2
                    && String(manifest.storageIdentity.scopeFingerprint || '') === identity.scopeFingerprint
                    && String(manifest.storageIdentity.writeGeneration || '') === identity.writeGeneration
                    && Number(manifest.storageIdentity.revision) === Number(identity.revision)
                    && Number(manifest.snapshot?.revision) === Number(identity.revision);
            })()
        ));
        if (!matchesScope) {
            retainedPaths.push(path);
            blockedByReachability.push(path);
            logSummaryVectorIndexIdentityEvent_ACU('warn', 'gc', 'quarantined_identity_unverified', {
                path,
                scopeFingerprint: candidateScopes.length === 1
                    ? buildVectorIndexSingleSnapshotV2ScopeToken_ACU(candidateScopes[0])
                    : '',
            });
            continue;
        }
        const result = await deleteVectorIndexFile_ACU(path);
        if (result.ok) {
            logSummaryVectorIndexIdentityEvent_ACU('debug', 'gc', 'deleted_verified_orphan', {
                manifest: loaded.data!.manifest,
                path,
            });
            pendingSummaryVectorIndexPublicationPaths_ACU.delete(path);
            deletedPaths.push(result.path || path);
        } else {
            failedDeletes.push({ path, error: result.error || '删除失败' });
        }
    }
    if (deletedPaths.length > 0) {
        await unregisterVectorIndexFiles_ACU(deletedPaths);
    }
    return {
        scannedRegisteredFileCount,
        reachableFileCount,
        deletedPaths,
        retainedPaths,
        blockedByReachability,
        failedDeletes,
    };
}

async function cleanupVersionedSnapshotRetention_ACU(manifest: ChatSummaryVectorIndexManifest_ACU): Promise<number> {
    const scopePrefix = buildVersionedSnapshotScopePrefix_ACU(manifest.chatKey, manifest.isolationKey, manifest.sourceTableKey);
    if (SUMMARY_VECTOR_INDEX_SNAPSHOT_RETENTION_LIMIT_ACU <= 0) {
        logDebug_ACU(`[纪要向量索引] 已跳过版本化快照 retention 清理，保留可回退楼层引用: scope=${scopePrefix}, indexId=${manifest.indexId}`);
        return 0;
    }
    return 0;
}

export async function deleteSummaryVectorIndexExternalByScope_ACU(options: {
    chatKey?: string;
    isolationKey?: string;
    sourceTableKey?: string;
} = {}): Promise<string[]> {
    const chatKey = normalizeChatKey_ACU(options.chatKey);
    const isolationKey = normalizeSummaryVectorIsolationKey_ACU(options.isolationKey || getCurrentIsolationKey_ACU());
    const sourceTableKey = options.sourceTableKey || 'summary';
    const result = await cleanupUnreachableSummaryVectorIndexFiles_ACU({
        scopeHints: [{ chatKey, isolationKey, sourceTableKey }],
    });
    if (result.deletedPaths.length > 0) {
        logDebug_ACU(`[交火向量索引] 已安全清理当前作用域不可达 V2 外置文件: count=${result.deletedPaths.length}`);
    }
    return result.deletedPaths;
}

function buildBatchRef_ACU(params: {
    batchId: string;
    indexId: string;
    createdAt: string;
    updatedAt: string;
    rows: ChatSummaryVectorIndexRow_ACU[];
    chunks: ChatSummaryVectorIndexChunk_ACU[];
    files: SummaryVectorIndexExternalFileRef_ACU[];
    sourceMessageIndex?: number;
    sourceSnapshotMessageId?: string;
}): SummaryVectorIndexBatchRef_ACU {
    return {
        batchId: params.batchId,
        indexId: params.indexId,
        createdAt: params.createdAt,
        updatedAt: params.updatedAt,
        rowKeys: Array.from(new Set(params.rows.map((row) => row.rowKey).filter(Boolean))),
        chunkIds: Array.from(new Set(params.chunks.map((chunk) => chunk.chunkId).filter(Boolean))),
        files: [...params.files],
        rowCount: params.rows.length,
        chunkCount: params.chunks.length,
        sourceMessageIndex: params.sourceMessageIndex,
        sourceSnapshotMessageId: params.sourceSnapshotMessageId,
        status: 'ready',
    };
}

async function rollbackUploadedFiles_ACU(files: SummaryVectorIndexExternalFileRef_ACU[]): Promise<SummaryVectorIndexRollbackResult_ACU> {
    const paths = files.map((file) => file.path).filter(Boolean);
    const deletedPaths: string[] = [];
    const failedPaths: Array<{ path: string; error: string }> = [];
    for (const path of paths) {
        try {
            const result = await deleteVectorIndexFile_ACU(path);
            if (result.ok) {
                deletedPaths.push(result.path || path);
                pendingSummaryVectorIndexPublicationPaths_ACU.delete(path);
            } else {
                failedPaths.push({ path, error: result.error || '未知删除失败' });
            }
        } catch (error) {
            failedPaths.push({ path, error: String((error as Error)?.message || error) });
        }
    }
    let unregisterError: string | undefined;
    let orphanRegistrationError: string | undefined;
    if (deletedPaths.length > 0) {
        try {
            await unregisterVectorIndexFiles_ACU(deletedPaths);
        } catch (error) {
            unregisterError = String((error as Error)?.message || error);
        }
    }
    if (failedPaths.length > 0) {
        const orphanFiles = files.filter((file) => failedPaths.some((failure) => failure.path === file.path));
        try {
            // 写后校验失败发生在普通 registry 发布前。删除失败对象必须显式登记，
            // 否则既不在 pointer 也不在 registry，后续无法诊断或隔离。
            await registerVectorIndexFiles_ACU(orphanFiles);
        } catch (error) {
            orphanRegistrationError = String((error as Error)?.message || error);
        }
    }
    if (failedPaths.length > 0 || unregisterError || orphanRegistrationError) {
        logWarn_ACU('[纪要向量索引] 上传对象回滚不完整，已登记或需人工处置:', {
            deletedPaths,
            failedPaths,
            unregisterError,
            orphanRegistrationError,
        });
    }
    return { deletedPaths, failedPaths, unregisterError, orphanRegistrationError };
}

function buildRollbackAwareError_ACU(error: unknown, rollback: SummaryVectorIndexRollbackResult_ACU): Error {
    if (rollback.failedPaths.length === 0 && !rollback.unregisterError && !rollback.orphanRegistrationError) {
        return error instanceof Error ? error : new Error(String(error));
    }
    const failedPaths = rollback.failedPaths.map(({ path, error: failure }) => `${path}: ${failure}`).join('; ');
    const unregisterFailure = rollback.unregisterError ? `; registry=${rollback.unregisterError}` : '';
    const orphanRegistrationFailure = rollback.orphanRegistrationError ? `; orphanRegistry=${rollback.orphanRegistrationError}` : '';
    return new Error(`${String((error as Error)?.message || error)}；上传对象回滚不完整，待诊断路径：${failedPaths || '无'}${unregisterFailure}${orphanRegistrationFailure}`);
}

function getReusableRollingBaseBatch_ACU(manifest: ChatSummaryVectorIndexManifest_ACU | null | undefined): SummaryVectorIndexBatchRef_ACU | null {
    if (manifest?.snapshot?.mode !== 'base_rolling_delta' || !Array.isArray(manifest.batchRefs)) return null;
    return manifest.batchRefs.find((batch) => (
        batch?.role === 'base'
        && (batch.files || []).some((file) => file.role === 'base_shard')
        && Array.isArray(batch.chunkIds) && batch.chunkIds.length > 0
    )) || null;
}

function collectRollingDeltaChangedRowKeys_ACU(params: {
    rows: ChatSummaryVectorIndexRow_ACU[];
    activeRowKeys: string[];
    removedRowKeys: string[];
    replacedRowKeys: string[];
    previousManifest?: ChatSummaryVectorIndexManifest_ACU | null;
}): Set<string> {
    const changedRowKeys = new Set<string>([...params.removedRowKeys, ...params.replacedRowKeys].filter(Boolean));
    const previousActiveRowKeys = new Set(params.previousManifest?.snapshot?.activeRowKeys || []);
    const previousActiveChunkIds = new Set(params.previousManifest?.snapshot?.activeChunkIds || []);
    const activeRowKeySet = new Set(params.activeRowKeys);
    params.rows.forEach((row) => {
        if (!activeRowKeySet.has(row.rowKey)) return;
        if (!previousActiveRowKeys.has(row.rowKey)) {
            changedRowKeys.add(row.rowKey);
            return;
        }
        const rowChunkIds = (row.chunkIds || []).filter(Boolean);
        if (rowChunkIds.some((chunkId) => !previousActiveChunkIds.has(chunkId))) {
            changedRowKeys.add(row.rowKey);
        }
    });
    return changedRowKeys;
}

async function persistSummaryVectorIndexSnapshotAsRollingDelta_ACU(params: {
    options: PersistSummaryVectorIndexSnapshotOptions_ACU;
    chatKey: string;
    isolationKey: string;
    indexedAt: string;
    snapshotRevision: number;
    indexId: string;
    rows: ChatSummaryVectorIndexRow_ACU[];
    chunks: ChatSummaryVectorIndexChunk_ACU[];
    activeRowKeys: string[];
    activeChunkIds: string[];
    dimension: number;
    foldThreshold: number;
}): Promise<PersistSummaryVectorIndexExternalResult_ACU> {
    const { options, chatKey, isolationKey, indexedAt, snapshotRevision, indexId, rows, chunks, activeRowKeys, activeChunkIds, dimension } = params;
    const uploadedFiles: SummaryVectorIndexExternalFileRef_ACU[] = [];
    try {
        const rowsByKey = new Map(rows.map((row) => [row.rowKey, row]));
        const chunkKeysByChunkId = new Map<string, string>();
        for (const chunk of chunks) {
            const row = rowsByKey.get(chunk.rowKey);
            const prepared = await prepareVectorChunkBlob_ACU(chunk, {
                embeddingModel: options.embeddingModel,
                dimension,
                sourceFingerprint: row?.sourceFingerprint,
            });
            chunkKeysByChunkId.set(chunk.chunkId, prepared.chunkKey);
        }

        const removedRowKeys = Array.from(new Set(options.removedRowKeys || []));
        const replacedRowKeys = Array.from(new Set(options.replacedRowKeys || []));
        const reusableBaseBatch = getReusableRollingBaseBatch_ACU(options.previousManifest);
        const changedRowKeys = collectRollingDeltaChangedRowKeys_ACU({
            rows,
            activeRowKeys,
            removedRowKeys,
            replacedRowKeys,
            previousManifest: options.previousManifest,
        });
        const reusableBaseChunkIds = new Set(reusableBaseBatch?.chunkIds || []);
        const foldThreshold = Math.max(1, Math.floor(Number(params.foldThreshold) || 1));
        const shouldFold = !reusableBaseBatch || reusableBaseChunkIds.size === 0 || changedRowKeys.size >= foldThreshold;
        const activeRowKeySet = new Set(activeRowKeys);
        const changedActiveRowKeys = new Set(Array.from(changedRowKeys).filter((rowKey) => activeRowKeySet.has(rowKey)));
        const baseChunks = shouldFold ? chunks : [];
        const deltaChunks = shouldFold ? [] : chunks.filter((chunk) => !reusableBaseChunkIds.has(chunk.chunkId) || changedActiveRowKeys.has(chunk.rowKey));
        const baseRows = shouldFold ? rows.filter((row) => activeRowKeySet.has(row.rowKey)) : [];
        const deltaRowKeys = new Set(deltaChunks.map((chunk) => chunk.rowKey).filter(Boolean));
        changedActiveRowKeys.forEach((rowKey) => deltaRowKeys.add(rowKey));
        const deltaRows = shouldFold ? [] : rows.filter((row) => activeRowKeySet.has(row.rowKey) && deltaRowKeys.has(row.rowKey));
        const shardIdsByChunkId = new Map<string, string>();

        const writeShard = async (role: 'base' | 'delta', shardId: string, shardChunks: ChatSummaryVectorIndexChunk_ACU[]): Promise<SummaryVectorIndexExternalFileRef_ACU | null> => {
            if (shardChunks.length === 0) return null;
            const chunksWithShard = shardChunks.map((chunk) => ({
                ...chunk,
                shardId,
                shardRole: role,
                chunkKeys: chunkKeysByChunkId.get(chunk.chunkId) ? [chunkKeysByChunkId.get(chunk.chunkId)!] : chunk.chunkKeys,
            }));
            chunksWithShard.forEach((chunk) => shardIdsByChunkId.set(chunk.chunkId, shardId));
            const cacheShard: SummaryVectorIndexShard_ACU = {
                version: SUMMARY_VECTOR_INDEX_MANIFEST_VERSION_ACU,
                indexId,
                shardId,
                role,
                createdAt: indexedAt,
                updatedAt: indexedAt,
                chunks: chunksWithShard,
            };
            const storedShard = {
                ...cacheShard,
                chunks: chunksWithShard.map((chunk) => encodeChunkVectorForStorage_ACU({ ...chunk })),
            };
            const path = buildVectorIndexFileName_ACU({ chatKey, isolationKey, indexId, role: role === 'base' ? 'base_shard' : 'delta_shard', shardId });
            const written = await uploadVectorIndexJsonFile_ACU({
                path,
                role: role === 'base' ? 'base_shard' : 'delta_shard',
                shardId,
                data: storedShard,
                chunkCount: chunksWithShard.length,
                status: 'ready',
            });
            if (!written.ok || !written.ref) throw new Error(written.error || `${role === 'base' ? 'base' : 'delta'} 分片 ${shardId} 上传失败`);
            uploadedFiles.push(written.ref);
            await putVectorIndexCachedShard_ACU(indexId, shardId, cacheShard, written.ref.checksum);
            return written.ref;
        };

        const baseShardRef = shouldFold ? await writeShard('base', 'base_0001', baseChunks) : null;
        const deltaShardRef = await writeShard('delta', 'delta_0001', deltaChunks);
        const baseBatch: SummaryVectorIndexBatchRef_ACU = shouldFold
            ? {
                ...buildBatchRef_ACU({
                    batchId: `base_${snapshotRevision}`,
                    indexId,
                    createdAt: indexedAt,
                    updatedAt: indexedAt,
                    rows: baseRows,
                    chunks: baseChunks,
                    files: baseShardRef ? [baseShardRef] : [],
                    sourceMessageIndex: options.sourceMessageIndex,
                    sourceSnapshotMessageId: options.snapshotMessageId,
                }),
                role: 'base',
            }
            : { ...reusableBaseBatch!, role: 'base' };
        const deltaBatch: SummaryVectorIndexBatchRef_ACU = {
            ...buildBatchRef_ACU({
                batchId: `delta_${snapshotRevision}`,
                indexId,
                createdAt: indexedAt,
                updatedAt: indexedAt,
                rows: deltaRows,
                chunks: deltaChunks,
                files: deltaShardRef ? [deltaShardRef] : [],
                sourceMessageIndex: options.sourceMessageIndex,
                sourceSnapshotMessageId: options.snapshotMessageId,
            }),
            role: 'delta',
            baseChunkIds: [...baseBatch.chunkIds],
        };
        const batchRefs = deltaBatch.files.length > 0 || removedRowKeys.length > 0 || replacedRowKeys.length > 0
            ? [baseBatch, deltaBatch]
            : [baseBatch];
        const parentIndexIds = Array.from(new Set([...(options.parentIndexIds || []), ...(options.previousManifest?.indexId ? [options.previousManifest.indexId] : [])].filter(Boolean)));
        const tombstone = buildTombstone_ACU(indexId, options.previousManifest, indexedAt);
        removedRowKeys.forEach((rowKey) => {
            tombstone.removedRows[rowKey] = { rowKey, chunkIds: [], reason: 'row_deleted', removedAt: indexedAt };
        });
        const manifestPath = buildVectorIndexFileName_ACU({ chatKey, isolationKey, indexId, role: 'manifest' });
        const baseShardIdsByChunkId = new Map<string, string[]>();
        if (!shouldFold && reusableBaseBatch) {
            const baseShardIds = Array.from(new Set((reusableBaseBatch.files || []).map((file) => file.shardId).filter((value): value is string => !!value)));
            reusableBaseChunkIds.forEach((chunkId) => baseShardIdsByChunkId.set(chunkId, baseShardIds));
        }
        const rowsWithShardIds = rows.map((row) => ({
            ...row,
            shardIds: Array.from(new Set(row.chunkIds.flatMap((chunkId) => [
                ...(baseShardIdsByChunkId.get(chunkId) || []),
                ...(shardIdsByChunkId.get(chunkId) ? [shardIdsByChunkId.get(chunkId)!] : []),
            ]))),
            chunkKeys: Array.from(new Set(row.chunkIds.map((chunkId) => chunkKeysByChunkId.get(chunkId)).filter((value): value is string => !!value))),
        }));
        const checkpoint = {
            version: SUMMARY_VECTOR_INDEX_MANIFEST_VERSION_ACU,
            checkpointId: `checkpoint_${hashUserInput_ACU(`${indexId}\n${options.snapshotMessageId}\n${indexedAt}`)}`,
            manifestKey: indexId,
            sourceTableKey: options.sourceTableKey,
            snapshotMessageId: options.snapshotMessageId,
            rowCount: rowsWithShardIds.length,
            chunkCount: chunks.length,
            activeRowKeys,
            createdAt: indexedAt,
        };
        const manifestDraft: ChatSummaryVectorIndexManifest_ACU = {
            version: SUMMARY_VECTOR_INDEX_MANIFEST_VERSION_ACU,
            backend: 'st-files',
            status: 'ready',
            indexId,
            chatKey,
            isolationKey,
            snapshotMessageId: options.snapshotMessageId,
            sourceTableKey: options.sourceTableKey,
            sourceTableName: options.sourceTableName,
            indexedAt,
            updatedAt: indexedAt,
            rowCount: rowsWithShardIds.length,
            chunkCount: chunks.length,
            skippedRowCount: Math.max(0, Math.floor(Number(options.skippedRowCount) || 0)),
            embeddingModel: options.embeddingModel,
            dimension,
            rowsFile: manifestPath,
            tombstoneFile: manifestPath,
            manifestFile: manifestPath,
            files: [],
            baseShardCount: baseBatch.files.filter((file) => file.role === 'base_shard').length,
            deltaShardCount: deltaBatch.files.filter((file) => file.role === 'delta_shard').length,
            tombstoneRowCount: removedRowKeys.length,
            tombstoneChunkCount: 0,
            externalTotalBytes: uploadedFiles.reduce((sum, file) => sum + Math.max(0, Number(file.byteSize) || 0), 0),
            snapshot: {
                revision: snapshotRevision,
                mode: 'base_rolling_delta',
                parentIndexIds,
                activeRowKeys,
                activeChunkIds: chunks.map((chunk) => chunk.chunkId),
                removedRowKeys,
                replacedRowKeys,
                batchIds: batchRefs.map((batch) => batch.batchId),
            },
            batchRefs,
            checkpoint,
        };
        const manifestWritten = await uploadVectorIndexJsonFile_ACU({ path: manifestPath, role: 'manifest', data: manifestDraft, rowCount: rowsWithShardIds.length, chunkCount: chunks.length, status: 'ready' });
        if (!manifestWritten.ok || !manifestWritten.ref) throw new Error(manifestWritten.error || 'rolling delta manifest 上传失败');
        uploadedFiles.push(manifestWritten.ref);
        const finalManifest: ChatSummaryVectorIndexManifest_ACU = {
            ...manifestDraft,
            files: [manifestWritten.ref, ...uploadedFiles.filter((file) => file.path !== manifestWritten.ref!.path)],
            externalTotalBytes: sumUniqueVectorIndexFileBytes_ACU([
                manifestWritten.ref,
                ...batchRefs.flatMap((batch) => batch.files || []),
            ]),
        };
        const state: ChatSummaryVectorIndexState_ACU = {
            version: SUMMARY_VECTOR_INDEX_MANIFEST_VERSION_ACU,
            backend: 'st-files',
            status: 'ready',
            indexId,
            snapshotMessageId: options.snapshotMessageId,
            sourceTableKey: options.sourceTableKey,
            sourceTableName: options.sourceTableName,
            indexedAt,
            rowCount: rowsWithShardIds.length,
            chunkCount: chunks.length,
            skippedRowCount: Math.max(0, Math.floor(Number(options.skippedRowCount) || 0)),
            rows: rowsWithShardIds,
            manifest: finalManifest,
        };
        await putSummaryVectorHotCacheChunks_ACU({ manifest: finalManifest, chunks });
        markSummaryVectorIndexSnapshotPrepared_ACU(uploadedFiles);
        await registerVectorIndexFiles_ACU(uploadedFiles);
        // 聊天 pointer 由 archive service 在本函数返回后才持久化。此处若清理 previousManifest，
        // 宿主保存失败会让旧 pointer 指向已删除对象；历史快照改由显式删除和安全 GC 回收。
        logDebug_ACU(`[交火向量索引] 已写入 rolling delta 快照：operation=write_rolling_delta, indexId=${finalManifest?.indexId || ''}, revision=${finalManifest?.storageIdentity?.revision ?? finalManifest?.snapshot?.revision ?? ''}, fold=${shouldFold ? 'yes' : 'no'}, changed=true`);
        return { state, manifest: finalManifest, uploadedFiles };
    } catch (error) {
        throw buildRollbackAwareError_ACU(error, await rollbackUploadedFiles_ACU(uploadedFiles));
    }
}

export async function persistSummaryVectorIndexExternal_ACU(
    options: PersistSummaryVectorIndexExternalOptions_ACU,
): Promise<PersistSummaryVectorIndexExternalResult_ACU> {
    const chatKey = normalizeChatKey_ACU(options.chatKey);
    const isolationKey = normalizeSummaryVectorIsolationKey_ACU(options.isolationKey || getCurrentIsolationKey_ACU());
    const indexedAt = options.indexedAt || new Date().toISOString();
    const indexId = buildIndexId_ACU({ chatKey, isolationKey, sourceTableKey: options.sourceTableKey, snapshotMessageId: options.snapshotMessageId, indexedAt });
    const rows = normalizeRows_ACU(options.rows);
    const chunks = normalizeChunks_ACU(options.chunks);
    if (rows.length === 0 || chunks.length === 0) {
        throw new Error('交火向量索引为空，拒绝写入外置文件。');
    }
    const dimension = chunks[0]?.vector?.length || 0;
    if (dimension <= 0) {
        throw new Error('交火向量索引缺少有效向量维度。');
    }
    const uploadedFiles: SummaryVectorIndexExternalFileRef_ACU[] = [];
    try {
        const shardIdsByChunkId = new Map<string, string>();
        const shardRefs: SummaryVectorIndexExternalFileRef_ACU[] = [];
        const shardGroups = chunkArray_ACU(chunks, options.shardChunkLimit || DEFAULT_SHARD_CHUNK_LIMIT_ACU);
        for (let shardIndex = 0; shardIndex < shardGroups.length; shardIndex += 1) {
            const shardId = `base_${String(shardIndex + 1).padStart(4, '0')}`;
            const shardChunks = shardGroups[shardIndex].map((chunk) => ({ ...chunk, shardId, shardRole: 'base' as const }));
            shardChunks.forEach((chunk) => shardIdsByChunkId.set(chunk.chunkId, shardId));
            const shard: SummaryVectorIndexShard_ACU = {
                version: SUMMARY_VECTOR_INDEX_MANIFEST_VERSION_ACU,
                indexId,
                shardId,
                role: 'base',
                createdAt: indexedAt,
                updatedAt: indexedAt,
                chunks: shardChunks,
            };
            const path = buildVectorIndexFileName_ACU({ chatKey, isolationKey, indexId, role: 'base_shard', shardId });
            const written = await uploadVectorIndexJsonFile_ACU({ path, role: 'base_shard', shardId, data: shard, chunkCount: shardChunks.length, status: 'ready' });
            if (!written.ok || !written.ref) throw new Error(written.error || `分片 ${shardId} 上传失败`);
            uploadedFiles.push(written.ref);
            shardRefs.push(written.ref);
            await putVectorIndexCachedShard_ACU(indexId, shardId, shard, written.ref.checksum);
        }

        const rowIndex = buildRowIndex_ACU(indexId, rows.map((row) => ({
            ...row,
            shardIds: Array.from(new Set(row.chunkIds.map((chunkId) => shardIdsByChunkId.get(chunkId)).filter((value): value is string => !!value))),
        })), shardIdsByChunkId, indexedAt);
        const tombstone = buildTombstone_ACU(indexId, options.previousManifest, indexedAt);
        const rowIndexPath = buildVectorIndexFileName_ACU({ chatKey, isolationKey, indexId, role: 'row_index' });
        const rowIndexWritten = await uploadVectorIndexJsonFile_ACU({ path: rowIndexPath, role: 'row_index', data: rowIndex, rowCount: rows.length, status: 'ready' });
        if (!rowIndexWritten.ok || !rowIndexWritten.ref) throw new Error(rowIndexWritten.error || 'rowIndex 上传失败');
        uploadedFiles.push(rowIndexWritten.ref);

        const tombstonePath = buildVectorIndexFileName_ACU({ chatKey, isolationKey, indexId, role: 'tombstone' });
        const tombstoneWritten = await uploadVectorIndexJsonFile_ACU({ path: tombstonePath, role: 'tombstone', data: tombstone, status: 'ready' });
        if (!tombstoneWritten.ok || !tombstoneWritten.ref) throw new Error(tombstoneWritten.error || 'tombstone 上传失败');
        uploadedFiles.push(tombstoneWritten.ref);

        const manifestPath = buildVectorIndexFileName_ACU({ chatKey, isolationKey, indexId, role: 'manifest' });
        const externalTotalBytesWithoutManifest = uploadedFiles.reduce((sum, file) => sum + Math.max(0, Number(file.byteSize) || 0), 0);
        const manifestDraft: ChatSummaryVectorIndexManifest_ACU = {
            version: SUMMARY_VECTOR_INDEX_MANIFEST_VERSION_ACU,
            backend: 'st-files',
            status: 'ready',
            indexId,
            chatKey,
            isolationKey,
            snapshotMessageId: options.snapshotMessageId,
            sourceTableKey: options.sourceTableKey,
            sourceTableName: options.sourceTableName,
            indexedAt,
            updatedAt: indexedAt,
            rowCount: rows.length,
            chunkCount: chunks.length,
            skippedRowCount: Math.max(0, Math.floor(Number(options.skippedRowCount) || 0)),
            embeddingModel: options.embeddingModel,
            dimension,
            rowsFile: rowIndexPath,
            tombstoneFile: tombstonePath,
            manifestFile: manifestPath,
            files: [],
            baseShardCount: shardRefs.length,
            deltaShardCount: 0,
            tombstoneRowCount: 0,
            tombstoneChunkCount: 0,
            externalTotalBytes: externalTotalBytesWithoutManifest,
        };
        const manifestWritten = await uploadVectorIndexJsonFile_ACU({ path: manifestPath, role: 'manifest', data: { ...manifestDraft, files: uploadedFiles }, status: 'ready' });
        if (!manifestWritten.ok || !manifestWritten.ref) throw new Error(manifestWritten.error || 'manifest 上传失败');
        uploadedFiles.push(manifestWritten.ref);
        const manifest: ChatSummaryVectorIndexManifest_ACU = {
            ...manifestDraft,
            files: [...uploadedFiles],
            externalTotalBytes: uploadedFiles.reduce((sum, file) => sum + Math.max(0, Number(file.byteSize) || 0), 0),
        };
        await registerVectorIndexFiles_ACU(uploadedFiles);
        const lightweightRows = rows.map((row) => ({
            ...row,
            shardIds: Array.from(new Set(row.chunkIds.map((chunkId) => shardIdsByChunkId.get(chunkId)).filter((value): value is string => !!value))),
        }));
        const state: ChatSummaryVectorIndexState_ACU = {
            version: SUMMARY_VECTOR_INDEX_MANIFEST_VERSION_ACU,
            backend: 'st-files',
            status: 'ready',
            indexId,
            snapshotMessageId: options.snapshotMessageId,
            sourceTableKey: options.sourceTableKey,
            sourceTableName: options.sourceTableName,
            indexedAt,
            rowCount: rows.length,
            chunkCount: chunks.length,
            skippedRowCount: Math.max(0, Math.floor(Number(options.skippedRowCount) || 0)),
            rows: lightweightRows,
            manifest,
        };
        return { state, manifest, uploadedFiles };
    } catch (error) {
        throw buildRollbackAwareError_ACU(error, await rollbackUploadedFiles_ACU(uploadedFiles));
    }
}

export async function persistSummaryVectorIndexSnapshot_ACU(
    options: PersistSummaryVectorIndexSnapshotOptions_ACU,
): Promise<PersistSummaryVectorIndexExternalResult_ACU> {
    const summaryVectorIndexConfig = getEffectiveSummaryVectorIndexConfig_ACU();
    // V2 身份在写入开始时冻结为唯一 canonical 三元组；后续不得重新解释 runtime scope。
    const scope = normalizeSummaryVectorIndexScope_ACU({
        chatKey: options.chatKey || currentChatFileIdentifier_ACU,
        isolationKey: options.isolationKey ?? getCurrentIsolationKey_ACU(),
        sourceTableKey: options.sourceTableKey,
    });
    const chatKey = scope.chatKey;
    const isolationKey = scope.isolationKey;
    const sourceTableKey = scope.sourceTableKey;
    const scopeFingerprint = buildVectorIndexSingleSnapshotV2ScopeToken_ACU({
        chatKey,
        isolationKey,
        sourceTableKey,
    });
    if (summaryVectorIndexConfig.summaryIndexV2WriteEnabled === false) {
        logSummaryVectorIndexIdentityEvent_ACU('warn', 'persist', 'rejected_writer_disabled', { scopeFingerprint });
        throw new Error('交火向量索引 V2 写入已关闭；为避免回滚时覆盖旧快照，本次归档未写入任何外置对象。');
    }
    const writeScopeAllowlist = Array.isArray(summaryVectorIndexConfig.summaryIndexV2WriteScopeAllowlist)
        ? summaryVectorIndexConfig.summaryIndexV2WriteScopeAllowlist
        : [];
    if (writeScopeAllowlist.length > 0 && !writeScopeAllowlist.includes(scopeFingerprint)) {
        logSummaryVectorIndexIdentityEvent_ACU('warn', 'persist', 'rejected_scope_not_allowlisted', { scopeFingerprint });
        throw new Error(`交火向量索引 V2 写入未向当前 scope 灰度开放：scope=${scopeFingerprint}`);
    }
    // P4 内容寻址 pack 写入开关（T11）。默认关闭；当显式开启且命中 allowlist 时才走 pack 链路，
    // 否则保持现路径逐字节不变。
    const contentPackWriteAllowlist = Array.isArray(summaryVectorIndexConfig.summaryIndexContentPackWriteScopeAllowlist)
        ? summaryVectorIndexConfig.summaryIndexContentPackWriteScopeAllowlist
        : [];
    const contentPackWriteEnabled = summaryVectorIndexConfig.summaryIndexContentPackWriteEnabled === true
        && (contentPackWriteAllowlist.length === 0 || contentPackWriteAllowlist.includes(scopeFingerprint));
    if (summaryVectorIndexConfig.summaryIndexContentPackWriteEnabled === true && !contentPackWriteEnabled) {
        logSummaryVectorIndexIdentityEvent_ACU('warn', 'persist', 'content_pack_scope_not_allowlisted', { scopeFingerprint });
    }
    const indexedAt = options.indexedAt || new Date().toISOString();
    const snapshotRevision = Math.max(1, Math.floor(Number(options.snapshotRevision) || 0) + 1);
    const indexId = buildVersionedSnapshotIndexId_ACU({ chatKey, isolationKey, sourceTableKey, snapshotRevision });
    const rows = normalizeRows_ACU(options.rows);
    const allChunks = normalizeChunks_ACU(options.chunks);
    const activeRowKeys = Array.from(new Set(options.activeRowKeys?.length ? options.activeRowKeys : rows.map((row) => row.rowKey)));
    const activeChunkIds = Array.from(new Set(options.activeChunkIds?.length ? options.activeChunkIds : rows.flatMap((row) => row.chunkIds || [])));
    const activeRowKeySet = new Set(activeRowKeys);
    const activeChunkIdSet = new Set(activeChunkIds);
    const chunks = allChunks.filter((chunk) => activeRowKeySet.has(chunk.rowKey) && activeChunkIdSet.has(chunk.chunkId));
    if (rows.length === 0 || chunks.length === 0 || activeChunkIds.length === 0) {
        throw new Error('交火向量快照索引为空，拒绝写入外置文件。');
    }
    const dimension = chunks[0]?.vector?.length || 0;
    if (dimension <= 0) {
        throw new Error('交火向量快照索引缺少有效向量维度。');
    }
    // T2：收紧——校验全部 chunk 的向量维度与首 chunk 一致，拒绝混维写入。
    // 混维快照在召回时会被 cosineSimilarity_ACU 判 0 分（静默召回失败），必须在写入前拦住。
    const mixedDimensionChunk = chunks.find((chunk) => (chunk.vector?.length || 0) !== dimension);
    if (mixedDimensionChunk) {
        throw new Error(`交火向量快照索引存在维度不一致的 chunk（期望 ${dimension}，实际 ${mixedDimensionChunk.vector?.length || 0}），拒绝写入外置文件。`);
    }
    // rolling-delta 仍使用可覆盖的 legacy 物理路径，尚未具备 V2 的 immutable identity
    // 与 prepared/published 生命周期。不得让实验开关绕过本函数后续的安全发布流程。
    if (summaryVectorIndexConfig.summaryIndexRollingDeltaEnabled) {
        logSummaryVectorIndexIdentityEvent_ACU('warn', 'persist', 'rolling_delta_bypassed_for_v2_safety', { scopeFingerprint });
    }

    const rowsByKey = new Map(rows.map((row) => [row.rowKey, row]));
    const chunkKeysByChunkId = new Map<string, string>();
    const chunkKeyToChunkId = new Map<string, string>();
    // T6：仅需 chunkKey，不再序列化 blob / 计算 SHA256 / 分配 Blob（结果全部被丢弃）。
    // 输入与 prepareVectorChunkBlob_ACU 的 chunkKey 计算完全一致，写出的 manifest/blob 逐字节不变。
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
        const chunk = chunks[chunkIndex];
        const row = rowsByKey.get(chunk.rowKey);
        const chunkKey = buildVectorChunkKey_ACU({
            embeddingModel: options.embeddingModel,
            dimension,
            sourceFingerprint: row?.sourceFingerprint,
            rowKey: chunk.rowKey,
            text: chunk.text,
        });
        // T12：唯一性校验——同 chunkKey 对应不同 chunkId、或 chunkId 重复，直接拒绝。
        // 旧代码用 chunkKeysByChunkId 单向映射，重复不会被发现，pack 复用时会读到歧义内容。
        const existingChunkId = chunkKeyToChunkId.get(chunkKey);
        if (existingChunkId !== undefined && existingChunkId !== chunk.chunkId) {
            throw new Error(`交火向量快照 chunkKey 冲突：chunkKey=${chunkKey} 同时映射到 chunkId=${existingChunkId} 与 ${chunk.chunkId}，拒绝写入外置文件。`);
        }
        if (chunkKeysByChunkId.has(chunk.chunkId)) {
            throw new Error(`交火向量快照 chunkId 重复：chunkId=${chunk.chunkId} 出现多次，拒绝写入外置文件。`);
        }
        chunkKeyToChunkId.set(chunkKey, chunk.chunkId);
        chunkKeysByChunkId.set(chunk.chunkId, chunkKey);
    }

    const rowsWithShardIds = rows.map((row) => ({
        ...row,
        shardIds: [] as string[],
        chunkKeys: Array.from(new Set(row.chunkIds.map((chunkId) => chunkKeysByChunkId.get(chunkId)).filter((value): value is string => !!value))),
    }));
    const tombstone = buildTombstone_ACU(indexId, options.previousManifest, indexedAt);
    const removedRowKeys = Array.from(new Set(options.removedRowKeys || []));
    removedRowKeys.forEach((rowKey) => {
        tombstone.removedRows[rowKey] = {
            rowKey,
            chunkIds: [],
            reason: 'row_deleted',
            removedAt: indexedAt,
        };
    });
    const replacedRowKeys = Array.from(new Set(options.replacedRowKeys || []));
    const parentIndexIds = Array.from(new Set([...(options.parentIndexIds || []), ...(options.previousManifest?.indexId ? [options.previousManifest.indexId] : [])].filter(Boolean)));
    const entropy = new Uint32Array(2);
    if (!globalThis.crypto?.getRandomValues) {
        throw new Error('交火向量 V2 快照写入需要 crypto.getRandomValues，以避免物理路径覆盖。');
    }
    globalThis.crypto.getRandomValues(entropy);
    const writeGeneration = buildVectorIndexSnapshotWriteGeneration_ACU(Date.now(), entropy);
    const storageIdentity: SummaryVectorIndexStorageIdentity_ACU = {
        layoutVersion: 2,
        scopeFingerprint,
        writeGeneration,
        revision: snapshotRevision,
    };
    const snapshotPath = buildVectorIndexSingleSnapshotV2FilePath_ACU({
        chatKey, isolationKey, sourceTableKey, indexId, writeGeneration,
    });
    const checkpoint = {
        version: SUMMARY_VECTOR_INDEX_MANIFEST_VERSION_ACU,
        checkpointId: `checkpoint_${hashUserInput_ACU(`${indexId}\n${options.snapshotMessageId}\n${indexedAt}`)}`,
        manifestKey: indexId,
        sourceTableKey,
        snapshotMessageId: options.snapshotMessageId,
        rowCount: rowsWithShardIds.length,
        chunkCount: chunks.length,
        activeRowKeys,
        createdAt: indexedAt,
    };
    const manifestDraft: ChatSummaryVectorIndexManifest_ACU = {
        version: SUMMARY_VECTOR_INDEX_MANIFEST_VERSION_ACU,
        backend: 'st-files',
        status: 'ready',
        indexId,
        chatKey,
        isolationKey,
        snapshotMessageId: options.snapshotMessageId,
        sourceTableKey,
        sourceTableName: options.sourceTableName,
        indexedAt,
        updatedAt: indexedAt,
        rowCount: rowsWithShardIds.length,
        chunkCount: chunks.length,
        skippedRowCount: Math.max(0, Math.floor(Number(options.skippedRowCount) || 0)),
        embeddingModel: options.embeddingModel,
        dimension,
        rowsFile: snapshotPath,
        tombstoneFile: snapshotPath,
        manifestFile: snapshotPath,
        files: [],
        baseShardCount: 0,
        deltaShardCount: 0,
        tombstoneRowCount: removedRowKeys.length,
        tombstoneChunkCount: 0,
        externalTotalBytes: 0,
        snapshot: {
            revision: snapshotRevision,
            mode: 'single_file_snapshot',
            parentIndexIds,
            activeRowKeys,
            activeChunkIds: chunks.map((chunk) => chunk.chunkId),
            removedRowKeys,
            replacedRowKeys,
            batchIds: [],
        },
        storageIdentity,
        batchRefs: [],
        checkpoint,
    };
    // ═══ P4 内容寻址 pack（T12）：开关关闭时下方所有逻辑不执行，保持现路径逐字节不变 ═══
    let contentPackPlan: Array<{
        packKey: string;
        path: string;
        blob: SummaryVectorIndexContentPackBlob_ACU;
        checksum: string;
        byteSize: number;
        chunkKeys: string[];
        chunkIds: string[];
        reused: boolean;
    }> = [];
    const contentPackRefs: SummaryVectorIndexPackRef_ACU[] = [];
    let contentPackTotalBytes = 0;
    let contentPackReusedBytes = 0;
    let contentPackUploadedBytes = 0;
    const newlyUploadedFiles: SummaryVectorIndexExternalFileRef_ACU[] = [];
    try {
        if (contentPackWriteEnabled) {
        // 1) 按 chunks 顺序取 chunkKey 列表 -> 分组
        const chunkKeyList = chunks.map((chunk) => chunkKeysByChunkId.get(chunk.chunkId) || `chunk_${chunk.chunkId}`);
        const groups = planContentPackGroups_ACU(chunkKeyList);
        const previousPackRefs = Array.isArray(options.previousManifest?.contentAddressed?.packRefs)
            ? options.previousManifest!.contentAddressed!.packRefs!
            : [];
        // 2) 为每组构造 pack blob（packKey 暂为空，hash 后再回填）
        for (const group of groups) {
            const groupChunks: SummaryVectorIndexContentPackChunk_ACU[] = group.map((chunkKey) => {
                const chunkId = chunkKeyToChunkId.get(chunkKey) || '';
                const chunk = chunks.find((item) => item.chunkId === chunkId);
                const row = rowsByKey.get(chunk?.rowKey || '');
                return {
                    chunkKey,
                    chunkId,
                    rowKey: chunk?.rowKey || '',
                    text: chunk?.text || '',
                    vector: encodeVectorToF32B64_ACU(chunk?.vector || []),
                    vectorEncoding: 'f32b64',
                    ...(row?.sourceFingerprint ? { sourceFingerprint: row.sourceFingerprint } : {}),
                    ...(chunk?.textHash ? { textHash: chunk.textHash } : {}),
                };
            });
            const blobDraft = buildContentPackBlob_ACU({
                packKey: '',
                packScope: scopeFingerprint,
                embeddingModel: options.embeddingModel,
                dimension,
                chunks: groupChunks,
            });
            const packHash = await sha256Text_ACU(serializeContentPackForHash_ACU(blobDraft));
            const packKey = buildContentPackKey_ACU(packHash);
            const packPath = buildVectorIndexContentPackPathV2_ACU({
                chatKey, isolationKey, sourceTableKey, packKey,
            });
            const finalBlob = buildContentPackBlob_ACU({
                packKey,
                packScope: scopeFingerprint,
                embeddingModel: options.embeddingModel,
                dimension,
                chunks: groupChunks,
            });
            const json = JSON.stringify(finalBlob);
            const checksum = await sha256Text_ACU(json);
            const byteSize = json.length;

            // 3) 复用判定：previous packRefs 命中全部条件才复用
            const reusableRef = previousPackRefs.find((ref) => (
                ref.packKey === packKey
                && String(ref.packScope || '') === scopeFingerprint
                && Number(ref.schemaVersion) === SUMMARY_VECTOR_INDEX_CONTENT_PACK_VERSION_ACU
                && String(ref.embeddingModel || '') === options.embeddingModel
                && Number(ref.dimension) === dimension
                && ref.path === packPath
                && !!ref.checksum
                && ref.checksum === checksum
            ));
            if (reusableRef) {
                contentPackRefs.push({ ...reusableRef, status: 'ready' });
                contentPackTotalBytes += byteSize;
                contentPackReusedBytes += byteSize;
                contentPackPlan.push({ packKey, path: packPath, blob: finalBlob, checksum, byteSize, chunkKeys: group, chunkIds: group.map((key) => chunkKeyToChunkId.get(key) || ''), reused: true });
                continue;
            }

            // 4) 幂等冲突处理：目标 path 已存在且内容一致 -> 视为已存在（不计入本次新建）
            const existing = await readVectorIndexJsonFile_ACU<SummaryVectorIndexContentPackBlob_ACU>(packPath);
            if (existing.ok && existing.data) {
                const existingPackKey = String(existing.data.packKey || '');
                const existingChecksum = await sha256Text_ACU(JSON.stringify(existing.data));
                if (existingPackKey === packKey && existingChecksum === checksum) {
                    const existingRef: SummaryVectorIndexPackRef_ACU = {
                        packKey,
                        packScope: scopeFingerprint,
                        schemaVersion: SUMMARY_VECTOR_INDEX_CONTENT_PACK_VERSION_ACU,
                        path: packPath,
                        checksum,
                        byteSize,
                        chunkKeys: group,
                        chunkCount: group.length,
                        rowCount: group.length,
                        embeddingModel: options.embeddingModel,
                        dimension,
                        createdAt: indexedAt,
                        updatedAt: indexedAt,
                        status: 'ready',
                    };
                    contentPackRefs.push(existingRef);
                    contentPackTotalBytes += byteSize;
                    contentPackReusedBytes += byteSize;
                    contentPackPlan.push({ packKey, path: packPath, blob: finalBlob, checksum, byteSize, chunkKeys: group, chunkIds: group.map((key) => chunkKeyToChunkId.get(key) || ''), reused: true });
                    continue;
                }
                // 存在但内容不一致 -> collision，禁止覆盖
                throw new Error(`交火向量内容寻址 pack 路径冲突：path=${packPath} 已存在但内容与本次 packKey=${packKey} 不一致，拒绝覆盖。`);
            }

            // 5) 上传 pack（新对象）
            const uploadResult = await uploadVectorIndexJsonFile_ACU({
                path: packPath,
                role: 'vector_pack',
                data: finalBlob,
                chunkCount: group.length,
                rowCount: group.length,
                status: 'ready',
            });
            if (!uploadResult.ok || !uploadResult.ref) {
                throw new Error(uploadResult.error || `内容寻址 pack 上传失败: ${packPath}`);
            }
            // 路径里的 scope token 不可逆，registry 条目必须自带 scope 才能被 GC 归属到聊天。
            uploadResult.ref.scope = { chatKey, isolationKey, sourceTableKey };
            // 先登记再校验：若 checksum 不一致需回滚本对象，必须已进入 newlyUploadedFiles，
            // 否则物理写入的对象不在回滚集合内会泄漏为孤儿（计划 §T12.4）。
            newlyUploadedFiles.push(uploadResult.ref);
            if (uploadResult.ref.checksum && uploadResult.ref.checksum !== checksum) {
                throw new Error(`内容寻址 pack 上传后 checksum 不一致: expected=${checksum} actual=${uploadResult.ref.checksum}`);
            }
            const packRef: SummaryVectorIndexPackRef_ACU = {
                packKey,
                packScope: scopeFingerprint,
                schemaVersion: SUMMARY_VECTOR_INDEX_CONTENT_PACK_VERSION_ACU,
                path: packPath,
                checksum,
                byteSize,
                chunkKeys: group,
                chunkCount: group.length,
                rowCount: group.length,
                embeddingModel: options.embeddingModel,
                dimension,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                status: 'ready',
            };
            contentPackRefs.push(packRef);
            contentPackTotalBytes += byteSize;
            contentPackUploadedBytes += byteSize;
            contentPackPlan.push({ packKey, path: packPath, blob: finalBlob, checksum, byteSize, chunkKeys: group, chunkIds: group.map((key) => chunkKeyToChunkId.get(key) || ''), reused: false });
        }
        // 结构化日志：packTotal / packReused / packUploaded / bytesUploaded / bytesReused
        logSummaryVectorIndexIdentityEvent_ACU('debug', 'persist', 'content_pack_planned', {
            manifest: manifestDraft,
            path: snapshotPath,
            scopeFingerprint,
        });
        logDebug_ACU(`[纪要向量索引] content pack 计划: packTotal=${contentPackRefs.length} packReused=${contentPackRefs.length - newlyUploadedFiles.length} packUploaded=${newlyUploadedFiles.length} bytesUploaded=${contentPackUploadedBytes} bytesReused=${contentPackReusedBytes}`);
        }
    } catch (error) {
        // pack 阶段任何失败（上传失败 / checksum 不一致 / collision / 幂等读取异常）
        // 都必须回滚已上传的 pack，否则多 pack 场景下先成功的 pack 会泄漏为孤儿对象。
        throw buildRollbackAwareError_ACU(
            error,
            await rollbackUploadedFiles_ACU(newlyUploadedFiles),
        );
    }
    // 6) 开关开启时：manifest 携带 contentAddressed 引用，snapshot 不再内联 chunks。
    //    chunkRefs 留空是有意的：新协议的 chunk 级定位由 pack 内 chunkKey + manifest.activeChunkIds 完成。
    if (contentPackWriteEnabled) {
        manifestDraft.contentAddressed = {
            version: SUMMARY_VECTOR_INDEX_CONTENT_PACK_VERSION_ACU,
            mode: 'content_addressed_packs',
            chunkRefs: [],
            activeChunkKeys: chunks.map((chunk) => chunkKeysByChunkId.get(chunk.chunkId) || `chunk_${chunk.chunkId}`),
            packRefs: contentPackRefs,
        };
    }


    const snapshotBlob: VectorIndexSingleSnapshotBlob_ACU = {
        version: SUMMARY_VECTOR_INDEX_MANIFEST_VERSION_ACU,
        schema: 'single_file_snapshot',
        indexId,
        chatKey,
        isolationKey,
        sourceTableKey,
        sourceTableName: options.sourceTableName,
        snapshotMessageId: options.snapshotMessageId,
        embeddingModel: options.embeddingModel,
        dimension,
        indexedAt,
        updatedAt: indexedAt,
        storageIdentity,
        manifest: manifestDraft,
        rows: rowsWithShardIds,
        chunks: contentPackWriteEnabled
            ? []
            : chunks.map((chunk) => encodeChunkVectorForStorage_ACU({ ...chunk, chunkKeys: chunkKeysByChunkId.get(chunk.chunkId) ? [chunkKeysByChunkId.get(chunk.chunkId)!] : chunk.chunkKeys })),
        tombstone,
    };
    const written = await uploadVectorIndexJsonFile_ACU({
        path: snapshotPath,
        role: 'manifest',
        data: snapshotBlob,
        chunkCount: chunks.length,
        rowCount: rowsWithShardIds.length,
        status: 'ready',
    });
    if (!written.ok || !written.ref) throw new Error(written.error || '单文件交火向量快照写入失败');
    written.ref.scope = { chatKey, isolationKey, sourceTableKey };

    const verified = await readVectorIndexJsonFile_ACU<VectorIndexSingleSnapshotBlob_ACU>(snapshotPath);
    let verificationError: unknown = null;
    try {
        if (!verified.ok || !verified.data || verified.data.schema !== 'single_file_snapshot') {
            throw new Error('快照对象不可读取或协议不匹配');
        }
        validateSingleFileSnapshotIdentity_ACU(manifestDraft, verified.data, snapshotPath);
        const verifiedChecksum = await sha256Text_ACU(JSON.stringify(verified.data));
        if (verifiedChecksum !== written.ref.checksum) {
            throw new Error(`checksum 不匹配: expected=${written.ref.checksum} actual=${verifiedChecksum}`);
        }
    } catch (error) {
        verificationError = error;
    }
    if (verificationError) {
        const rollback = await rollbackUploadedFiles_ACU([...newlyUploadedFiles, written.ref]);
        logSummaryVectorIndexIdentityEvent_ACU('warn', 'persist', 'read_after_write_identity_rejected', {
            manifest: manifestDraft,
            path: snapshotPath,
            error: verificationError,
        });
        throw buildRollbackAwareError_ACU(
            new Error(`[纪要向量索引] V2 快照写后校验失败: scope=${storageIdentity.scopeFingerprint}, indexId=${indexId}, path=${snapshotPath}, error=${String((verificationError as Error)?.message || verificationError)}`),
            rollback,
        );
    }

    const finalManifest: ChatSummaryVectorIndexManifest_ACU = {
        ...manifestDraft,
        files: [...newlyUploadedFiles, written.ref],
        externalTotalBytes: written.ref.byteSize + contentPackTotalBytes,
    };
    // prepared / register 必须覆盖 snapshot + 本次新建 pack：
    // pendingSummaryVectorIndexPublicationPaths_ACU 只覆盖这些对象时，GC 才不会在发布窗口内删除 pack。
    const publicationFiles = [...newlyUploadedFiles, written.ref];
    logSummaryVectorIndexIdentityEvent_ACU('debug', 'persist', 'canonical_scope_written', {
        manifest: finalManifest,
        path: snapshotPath,
    });
    const state: ChatSummaryVectorIndexState_ACU = {
        version: SUMMARY_VECTOR_INDEX_MANIFEST_VERSION_ACU,
        backend: 'st-files',
        status: 'ready',
        indexId,
        snapshotMessageId: options.snapshotMessageId,
        sourceTableKey,
        sourceTableName: options.sourceTableName,
        indexedAt,
        rowCount: rowsWithShardIds.length,
        chunkCount: chunks.length,
        skippedRowCount: Math.max(0, Math.floor(Number(options.skippedRowCount) || 0)),
        rows: rowsWithShardIds,
        manifest: finalManifest,
    };
    // 热缓存写入口已对不可变 V2 快照内部早退（vector-index-hot-cache.ts 的
    // isImmutableV2SnapshotManifest_ACU），此处保持统一调用即可，避免各调用方
    // 各自复制 V2 判定逻辑导致判定漂移。
    await putSummaryVectorHotCacheChunks_ACU({ manifest: finalManifest, chunks });
    markSummaryVectorIndexSnapshotPrepared_ACU(publicationFiles);
    try {
        await registerVectorIndexFiles_ACU(publicationFiles.map((file) => ({ ...file, publicationState: 'prepared' })));
    } catch (error) {
        throw buildRollbackAwareError_ACU(
            error,
            await rollbackUploadedFiles_ACU(publicationFiles),
        );
    }
    logSummaryVectorIndexIdentityEvent_ACU('debug', 'persist', 'prepared', {
        manifest: finalManifest,
        path: snapshotPath,
    });
    return { state, manifest: finalManifest, uploadedFiles: publicationFiles };
}

async function loadOneShardChunks_ACU(
    indexId: string,
    ref: SummaryVectorIndexExternalFileRef_ACU,
    options: LoadSummaryVectorIndexChunksOptions_ACU = {},
): Promise<ChatSummaryVectorIndexChunk_ACU[]> {
    if (!ref.shardId) return [];
    let shard: SummaryVectorIndexShard_ACU | null = null;
    if (options.preferExternalFiles !== true) {
        shard = await getVectorIndexCachedShard_ACU(indexId, ref.shardId, ref.checksum || '');
    }
    if (!shard) {
        const loaded = await readVectorIndexJsonFile_ACU<SummaryVectorIndexShard_ACU>(ref.path);
        if (!loaded.ok || !loaded.data) {
            throw new Error(`交火向量索引分片读取失败: ${ref.path} ${loaded.error || ''}`.trim());
        }
        const loadedShard = loaded.data;
        const loadedShardId = String(loadedShard?.shardId || '');
        const loadedIndexId = String(loadedShard?.indexId || '');
        const shardMatchesManifest = loadedIndexId === indexId && loadedShardId === ref.shardId;
        if (!shardMatchesManifest) {
            throw new Error(`交火向量索引分片身份不匹配: ${ref.path} expectedIndex=${indexId} actualIndex=${loadedIndexId || 'empty'} expectedShard=${ref.shardId} actualShard=${loadedShardId || 'empty'}`);
        }
        const json = JSON.stringify(loadedShard);
        const checksum = await sha256Text_ACU(json);
        if (ref.checksum && checksum !== ref.checksum) {
            throw new Error(`交火向量索引分片校验失败: ${ref.path} expected=${ref.checksum} actual=${checksum}`);
        }
        shard = {
            ...loadedShard,
            chunks: decodeChunkVectorsInPlace_ACU((loadedShard.chunks || []).map((chunk) => ({ ...chunk }) as StoredVectorIndexChunk_ACU)),
        };
        await putVectorIndexCachedShard_ACU(indexId, ref.shardId, shard, checksum || ref.checksum);
    }
    return (shard.chunks || [])
        .map((chunk) => ({ ...chunk, vector: Array.isArray(chunk.vector) ? [...chunk.vector] : chunk.vector } as StoredVectorIndexChunk_ACU))
        .map((chunk) => decodeChunkVectorInPlace_ACU(chunk))
        .filter((chunk) => isVectorLike_ACU(chunk.vector) && chunk.vector.length > 0);
}

async function loadChunksFromShardRefs_ACU(
    indexId: string,
    shardRefs: SummaryVectorIndexExternalFileRef_ACU[],
    options: LoadSummaryVectorIndexChunksOptions_ACU = {},
): Promise<ChatSummaryVectorIndexChunk_ACU[]> {
    const refs = (Array.isArray(shardRefs) ? shardRefs : []).filter((ref) => !!ref?.shardId);
    if (refs.length === 0) return [];
    const concurrency = Math.max(1, Math.min(24, Math.floor(Number(options.shardReadConcurrency) || 6)));
    const orderedResults: ChatSummaryVectorIndexChunk_ACU[][] = Array.from({ length: refs.length }, (): ChatSummaryVectorIndexChunk_ACU[] => []);
    for (let offset = 0; offset < refs.length; offset += concurrency) {
        const batch = refs.slice(offset, offset + concurrency);
        await Promise.all(batch.map(async (ref, batchIndex) => {
            orderedResults[offset + batchIndex] = await loadOneShardChunks_ACU(indexId, ref, options);
        }));
    }
    return orderedResults.flat();
}

async function loadChunksFromContentAddressedRefs_ACU(
    manifest: ChatSummaryVectorIndexManifest_ACU,
    options: LoadSummaryVectorIndexChunksOptions_ACU = {},
): Promise<ChatSummaryVectorIndexChunk_ACU[]> {
    // T13 注：这是旧 content_addressed_chunks 协议分支（按 indexId 校验、逐 chunk 单独 hash），
    // 不支持跨 revision 内容复用。P4 新协议（content_addressed_packs）走独立的
    // loadChunksFromContentPackRefs_ACU 分支：pack 级 checksum 已覆盖整包、packScope 用
    // canonical scope token（非 indexId）、按 manifest.snapshot.activeChunkIds 复原顺序。
    // 本分支保持不动，保证旧格式（chunkRefs 非空）继续可读。
    const info = manifest.contentAddressed;
    if (!info?.chunkRefs?.length) return [];
    const activeChunkKeys = new Set((info.activeChunkKeys || []).map((item) => String(item)));
    const chunks: ChatSummaryVectorIndexChunk_ACU[] = [];

    const decodeContentAddressedChunkBlob_ACU = (
        blob: VectorIndexChunkBlob_ACU,
        ref: SummaryVectorIndexChunkRef_ACU,
        sourcePath: string,
    ): ChatSummaryVectorIndexChunk_ACU => {
        let decoded: ChatSummaryVectorIndexChunk_ACU;
        try {
            decoded = decodeChunkVectorInPlace_ACU({
                ...blob,
                chunkId: String(blob.chunkId || ref.chunkId),
                rowKey: String(blob.rowKey || ref.rowKey),
                rowOrder: Number(blob.rowOrder || 0),
                text: String(blob.text || ''),
                sequence: Number(blob.sequence || 0),
                sourceFingerprint: blob.sourceFingerprint || ref.sourceFingerprint,
                textHash: blob.textHash || ref.textHash,
                shardId: undefined,
                shardRole: undefined,
                chunkKeys: [ref.chunkKey],
            } as StoredVectorIndexChunk_ACU);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error || '未知错误');
            throw new Error(`交火向量索引内容块校验失败: ${sourcePath} chunk=${ref.chunkKey} ${message}`.trim());
        }
        if (!isVectorLike_ACU(decoded.vector) || decoded.vector.length === 0) {
            throw new Error(`交火向量索引内容块校验失败: ${sourcePath} chunk=${ref.chunkKey} vector_empty`);
        }
        return decoded;
    };

    if (info.mode === 'content_addressed_packs' && Array.isArray(info.packRefs) && info.packRefs.length > 0) {
        const packRefsByKey = new Map<string, SummaryVectorIndexPackRef_ACU>();
        info.packRefs.forEach((packRef) => {
            const packKey = String(packRef.packKey || '').trim();
            if (packKey && packRef.path) packRefsByKey.set(packKey, packRef);
        });
        const chunkRefsByPackKey = new Map<string, typeof info.chunkRefs>();
        for (const ref of info.chunkRefs) {
            if (activeChunkKeys.size > 0 && !activeChunkKeys.has(ref.chunkKey)) continue;
            const packKey = String(ref.packKey || '').trim();
            if (!packKey) throw new Error(`交火向量索引内容包引用缺少 packKey: ${ref.path}`);
            const refs = chunkRefsByPackKey.get(packKey) || [];
            refs.push(ref);
            chunkRefsByPackKey.set(packKey, refs);
        }
        for (const [packKey, refs] of chunkRefsByPackKey.entries()) {
            const packRef = packRefsByKey.get(packKey);
            if (!packRef) throw new Error(`交火向量索引内容包缺少 manifest 引用: packKey=${packKey}`);
            const loaded = await readVectorIndexJsonFile_ACU<VectorIndexPackBlob_ACU>(packRef.path);
            if (!loaded.ok || !loaded.data) {
                throw new Error(`交火向量索引内容包读取失败: ${packRef.path} ${loaded.error || ''}`.trim());
            }
            const packBlob = loaded.data;
            if (String(packBlob.packKey || '') !== packKey || String(packBlob.indexId || '') !== manifest.indexId) {
                throw new Error(`交火向量索引内容包身份不匹配: ${packRef.path} expectedPack=${packKey} actualPack=${String(packBlob.packKey || 'empty')} expectedIndex=${manifest.indexId} actualIndex=${String(packBlob.indexId || 'empty')}`);
            }
            const packChecksum = await sha256Text_ACU(JSON.stringify(packBlob));
            if (packRef.checksum && packChecksum !== packRef.checksum) {
                throw new Error(`交火向量索引内容包校验失败: ${packRef.path} expected=${packRef.checksum} actual=${packChecksum}`);
            }
            const blobsByChunkKey = new Map<string, VectorIndexChunkBlob_ACU>();
            (packBlob.chunks || []).forEach((blob) => {
                const chunkKey = String(blob?.chunkKey || '').trim();
                if (chunkKey && !blobsByChunkKey.has(chunkKey)) blobsByChunkKey.set(chunkKey, blob);
            });
            for (const ref of refs) {
                const blob = blobsByChunkKey.get(ref.chunkKey);
                if (!blob) throw new Error(`交火向量索引内容包缺少 chunk: pack=${packKey} chunk=${ref.chunkKey}`);
                if (String(blob.chunkKey || '') !== ref.chunkKey || String(blob.chunkId || '') !== ref.chunkId || String(blob.rowKey || '') !== ref.rowKey) {
                    throw new Error(`交火向量索引内容块身份不匹配: ${packRef.path} expectedChunk=${ref.chunkKey} actualChunk=${String(blob.chunkKey || 'empty')} expectedRow=${ref.rowKey} actualRow=${String(blob.rowKey || 'empty')}`);
                }
                const chunkChecksum = await sha256Text_ACU(JSON.stringify(blob));
                if (ref.checksum && chunkChecksum !== ref.checksum) {
                    throw new Error(`交火向量索引内容块校验失败: ${packRef.path} expected=${ref.checksum} actual=${chunkChecksum}`);
                }
                chunks.push(decodeContentAddressedChunkBlob_ACU(blob, ref, packRef.path));
            }
        }
        return chunks.sort((left, right) => left.sequence - right.sequence || left.chunkId.localeCompare(right.chunkId));
    }

    for (const ref of info.chunkRefs) {
        if (activeChunkKeys.size > 0 && !activeChunkKeys.has(ref.chunkKey)) continue;
        const loaded = await readVectorIndexJsonFile_ACU<VectorIndexChunkBlob_ACU>(ref.path);
        if (!loaded.ok || !loaded.data) {
            throw new Error(`交火向量索引内容块读取失败: ${ref.path} ${loaded.error || ''}`.trim());
        }
        const blob = loaded.data;
        if (String(blob.chunkKey || '') !== ref.chunkKey || String(blob.chunkId || '') !== ref.chunkId || String(blob.rowKey || '') !== ref.rowKey) {
            throw new Error(`交火向量索引内容块身份不匹配: ${ref.path} expectedChunk=${ref.chunkKey} actualChunk=${String(blob.chunkKey || 'empty')} expectedRow=${ref.rowKey} actualRow=${String(blob.rowKey || 'empty')}`);
        }
        const checksum = await sha256Text_ACU(JSON.stringify(blob));
        if (ref.checksum && checksum !== ref.checksum) {
            throw new Error(`交火向量索引内容块校验失败: ${ref.path} expected=${ref.checksum} actual=${checksum}`);
        }
        chunks.push(decodeContentAddressedChunkBlob_ACU(blob, ref, ref.path));
    }
    return chunks.sort((left, right) => left.sequence - right.sequence || left.chunkId.localeCompare(right.chunkId));
}

function sortAndDedupeVectorChunks_ACU(chunks: ChatSummaryVectorIndexChunk_ACU[]): ChatSummaryVectorIndexChunk_ACU[] {
    const byChunkId = new Map<string, ChatSummaryVectorIndexChunk_ACU>();
    (Array.isArray(chunks) ? chunks : []).forEach((chunk) => {
        if (!chunk?.chunkId || !chunk.rowKey || !isVectorLike_ACU(chunk.vector) || chunk.vector.length === 0) return;
        byChunkId.set(chunk.chunkId, { ...chunk });
    });
    // batchRefs 按 base -> delta 读取；相同 chunkId 必须让后出现的 delta 覆盖 base。
    return Array.from(byChunkId.values()).sort((left, right) => left.sequence - right.sequence || left.chunkId.localeCompare(right.chunkId));
}

function normalizeLegacyIsolationKey_ACU(value: unknown): string {
    const raw = String(value ?? '');
    return raw === '' || raw === 'default' ? 'default' : raw;
}

function assertSingleSnapshotFieldMatches_ACU(
    path: string,
    field: string,
    expected: unknown,
    actual: unknown,
): void {
    if (String(actual ?? '') === String(expected ?? '')) return;
    throw new Error(`交火向量单文件快照身份不匹配: ${path} field=${field} expected=${String(expected ?? 'empty')} actual=${String(actual ?? 'empty')}`);
}

/**
 * V2 snapshot 的 path 只是定位器，最终必须由 blob 内的完整身份约束。
 * 旧 single-file snapshot 没有 storageIdentity 时保留兼容读取，但仍校验其可用的 scope 与向量兼容字段。
 */
export function validateSingleFileSnapshotIdentity_ACU(
    manifest: ChatSummaryVectorIndexManifest_ACU,
    blob: VectorIndexSingleSnapshotBlob_ACU,
    snapshotPath: string,
): void {
    const expectedIdentity = manifest.storageIdentity;
    const actualIdentity = blob.storageIdentity;
    assertSingleSnapshotFieldMatches_ACU(snapshotPath, 'indexId', manifest.indexId, blob.indexId);
    assertSingleSnapshotFieldMatches_ACU(snapshotPath, 'chatKey', manifest.chatKey, blob.chatKey);
    if (!expectedIdentity && !actualIdentity) {
        assertSingleSnapshotFieldMatches_ACU(snapshotPath, 'isolationKey',
            normalizeLegacyIsolationKey_ACU(manifest.isolationKey),
            normalizeLegacyIsolationKey_ACU(blob.isolationKey));
    } else {
        assertSingleSnapshotFieldMatches_ACU(snapshotPath, 'isolationKey', manifest.isolationKey, blob.isolationKey);
    }
    assertSingleSnapshotFieldMatches_ACU(snapshotPath, 'sourceTableKey', manifest.sourceTableKey, blob.sourceTableKey);
    assertSingleSnapshotFieldMatches_ACU(snapshotPath, 'embeddingModel', manifest.embeddingModel, blob.embeddingModel);
    assertSingleSnapshotFieldMatches_ACU(snapshotPath, 'dimension', manifest.dimension, blob.dimension);

    if (!expectedIdentity && !actualIdentity) return;
    if (!expectedIdentity || !actualIdentity) {
        throw new Error(`交火向量单文件快照 V2 身份元数据不完整: ${snapshotPath} expectedLayout=${expectedIdentity?.layoutVersion || 'legacy'} actualLayout=${actualIdentity?.layoutVersion || 'legacy'}`);
    }
    if (String(manifest.isolationKey ?? '') !== normalizeSummaryVectorIsolationKey_ACU(manifest.isolationKey)
        || String(blob.isolationKey ?? '') !== normalizeSummaryVectorIsolationKey_ACU(blob.isolationKey)) {
        throw new Error(`交火向量单文件快照身份不匹配: ${snapshotPath} field=isolationKey V2 对象必须保存 canonical 值`);
    }
    if (!manifest.snapshot) {
        throw new Error(`交火向量单文件快照 V2 manifest 缺少 snapshot 元数据: ${snapshotPath}`);
    }
    assertSingleSnapshotFieldMatches_ACU(snapshotPath, 'storageIdentity.layoutVersion', expectedIdentity.layoutVersion, actualIdentity.layoutVersion);
    assertSingleSnapshotFieldMatches_ACU(snapshotPath, 'storageIdentity.scopeFingerprint', expectedIdentity.scopeFingerprint, actualIdentity.scopeFingerprint);
    assertSingleSnapshotFieldMatches_ACU(snapshotPath, 'storageIdentity.writeGeneration', expectedIdentity.writeGeneration, actualIdentity.writeGeneration);
    assertSingleSnapshotFieldMatches_ACU(snapshotPath, 'storageIdentity.revision', expectedIdentity.revision, actualIdentity.revision);
    assertSingleSnapshotFieldMatches_ACU(snapshotPath, 'snapshot.revision', manifest.snapshot.revision, actualIdentity.revision);
    assertSingleSnapshotFieldMatches_ACU(
        snapshotPath,
        'canonicalPath',
        buildVectorIndexSingleSnapshotV2FilePath_ACU({
            chatKey: manifest.chatKey,
            isolationKey: manifest.isolationKey,
            sourceTableKey: manifest.sourceTableKey,
            indexId: manifest.indexId,
            writeGeneration: expectedIdentity.writeGeneration,
        }),
        snapshotPath,
    );

    const embeddedManifest = blob.manifest;
    if (!embeddedManifest || typeof embeddedManifest !== 'object') {
        throw new Error(`交火向量单文件快照 V2 内嵌 manifest 缺失: ${snapshotPath}`);
    }
    assertSingleSnapshotFieldMatches_ACU(snapshotPath, 'blob.manifest.indexId', manifest.indexId, embeddedManifest.indexId);
    assertSingleSnapshotFieldMatches_ACU(snapshotPath, 'blob.manifest.chatKey', manifest.chatKey, embeddedManifest.chatKey);
    assertSingleSnapshotFieldMatches_ACU(snapshotPath, 'blob.manifest.isolationKey', manifest.isolationKey, embeddedManifest.isolationKey);
    if (String(embeddedManifest.isolationKey ?? '') !== normalizeSummaryVectorIsolationKey_ACU(embeddedManifest.isolationKey)) {
        throw new Error(`交火向量单文件快照身份不匹配: ${snapshotPath} field=blob.manifest.isolationKey V2 对象必须保存 canonical 值`);
    }
    assertSingleSnapshotFieldMatches_ACU(snapshotPath, 'blob.manifest.sourceTableKey', manifest.sourceTableKey, embeddedManifest.sourceTableKey);
    assertSingleSnapshotFieldMatches_ACU(snapshotPath, 'blob.manifest.embeddingModel', manifest.embeddingModel, embeddedManifest.embeddingModel);
    assertSingleSnapshotFieldMatches_ACU(snapshotPath, 'blob.manifest.dimension', manifest.dimension, embeddedManifest.dimension);
    assertSingleSnapshotFieldMatches_ACU(snapshotPath, 'blob.manifest.storageIdentity.scopeFingerprint', expectedIdentity.scopeFingerprint, embeddedManifest.storageIdentity?.scopeFingerprint);
    assertSingleSnapshotFieldMatches_ACU(snapshotPath, 'blob.manifest.storageIdentity.writeGeneration', expectedIdentity.writeGeneration, embeddedManifest.storageIdentity?.writeGeneration);
    assertSingleSnapshotFieldMatches_ACU(snapshotPath, 'blob.manifest.storageIdentity.revision', expectedIdentity.revision, embeddedManifest.storageIdentity?.revision);
    assertSingleSnapshotFieldMatches_ACU(snapshotPath, 'blob.manifest.snapshot.revision', manifest.snapshot.revision, embeddedManifest.snapshot?.revision);
    assertSingleSnapshotFieldMatches_ACU(snapshotPath, 'blob.manifest.snapshot.revision/storageIdentity.revision', expectedIdentity.revision, embeddedManifest.snapshot?.revision);
}

function isSingleFileSnapshotManifest_ACU(manifest: ChatSummaryVectorIndexManifest_ACU): boolean {
    const explicitMode = manifest.snapshot?.mode;
    if (explicitMode) return explicitMode === 'single_file_snapshot';
    const manifestPath = String(manifest.manifestFile || '').trim();
    return !!manifestPath && manifest.rowsFile === manifestPath && manifest.tombstoneFile === manifestPath;
}

async function loadChunksFromSingleFileSnapshot_ACU(
    manifest: ChatSummaryVectorIndexManifest_ACU,
    options: LoadSummaryVectorIndexChunksOptions_ACU = {},
): Promise<ChatSummaryVectorIndexChunk_ACU[]> {
    const snapshotPath = String(manifest.manifestFile || manifest.files?.[0]?.path || '').trim();
    if (!snapshotPath) throw new Error('交火向量单文件快照缺少 manifestFile 路径。');
    const loaded = await readVectorIndexJsonFile_ACU<VectorIndexSingleSnapshotBlob_ACU>(snapshotPath);
    if (!loaded.ok || !loaded.data) {
        throw new Error(`交火向量单文件快照读取失败: ${snapshotPath} ${loaded.error || ''}`.trim());
    }
    const blob = loaded.data;
    if (blob.schema !== 'single_file_snapshot') {
        throw new Error(`交火向量单文件快照协议不匹配: ${snapshotPath}`);
    }
    try {
        validateSingleFileSnapshotIdentity_ACU(manifest, blob, snapshotPath);
    } catch (error) {
        logSummaryVectorIndexIdentityEvent_ACU('warn', 'load', 'identity_rejected', {
            manifest,
            path: snapshotPath,
            error,
        });
        throw error;
    }
    // T13：P4 内容寻址 pack 分流——snapshot 不再内联 chunks，chunk 由 packRefs 提供。
    // 判定：blob.chunks 为空数组 且 manifest.contentAddressed.mode === 'content_addressed_packs'
    // 且 packRefs 非空 → 走新分支；blob.chunks 非空 → 现有内联分支；
    // 两者皆无而 chunkCount > 0 → 协议损坏（下方统一抛错）。
    const contentAddressed = manifest.contentAddressed;
    const packRefs = Array.isArray(contentAddressed?.packRefs) ? contentAddressed!.packRefs! : [];
    const useContentPackRefs = (Array.isArray(blob.chunks) ? blob.chunks : []).length === 0
        && contentAddressed?.mode === 'content_addressed_packs'
        && packRefs.length > 0;
    const chunks = useContentPackRefs
        ? await loadChunksFromContentPackRefs_ACU(manifest, blob, packRefs, options)
        : sortAndDedupeVectorChunks_ACU(decodeChunkVectorsInPlace_ACU(Array.isArray(blob.chunks) ? blob.chunks : []));
    if (manifest.chunkCount > 0 && chunks.length === 0) {
        throw new Error(`交火向量单文件快照缺少有效 chunks: ${snapshotPath}`);
    }
    logSummaryVectorIndexIdentityEvent_ACU('debug', 'load', manifest.storageIdentity
        ? 'verified_v2_snapshot'
        : 'legacy_compatible_snapshot', {
        manifest,
        path: snapshotPath,
    });
    return chunks;
}

/**
 * T13：P4 内容寻址 pack 读取分支。
 * snapshot 不再内联 chunks，chunk 由 manifest.contentAddressed.packRefs 提供的 pack 恢复。
 * 逐 pack 校验（schema/version/packScope/packKey/checksum/embeddingModel/dimension）后
 * 按 manifest.snapshot.activeChunkIds 复原 sequence 与 rowOrder。
 * 任意一项校验失败即整体抛错，绝不返回部分结果（计划 §T13.4）。
 */
async function loadChunksFromContentPackRefs_ACU(
    manifest: ChatSummaryVectorIndexManifest_ACU,
    blob: VectorIndexSingleSnapshotBlob_ACU,
    packRefs: SummaryVectorIndexPackRef_ACU[],
    options: LoadSummaryVectorIndexChunksOptions_ACU = {},
): Promise<ChatSummaryVectorIndexChunk_ACU[]> {
    // 缺 activeChunkIds 时直接 incompatible：静默猜序会改变召回顺序，属于难以察觉的正确性事故。
    const activeChunkIds = Array.isArray(manifest.snapshot?.activeChunkIds) ? manifest.snapshot.activeChunkIds : [];
    if (activeChunkIds.length === 0) {
        throw new Error('交火向量内容寻址 pack 快照缺少 snapshot.activeChunkIds，协议不兼容，拒绝猜测 chunk 顺序。');
    }
    const expectedScope = buildVectorIndexSingleSnapshotV2ScopeToken_ACU({
        chatKey: manifest.chatKey,
        isolationKey: manifest.isolationKey,
        sourceTableKey: manifest.sourceTableKey,
    });
    const rows = Array.isArray(blob.rows) ? blob.rows : [];
    const rowOrderByRowKey = new Map<string, number>();
    for (const row of rows) {
        const rowKey = String(row?.rowKey || '');
        if (!rowKey) continue;
        rowOrderByRowKey.set(rowKey, Number(row.rowOrder) || 0);
    }
    const sequenceByChunkId = new Map<string, number>();
    activeChunkIds.forEach((chunkId, index) => sequenceByChunkId.set(chunkId, index));

    const concurrency = Math.max(1, Math.min(24, Math.floor(Number(options.shardReadConcurrency) || 6)));
    const collected: Array<{ chunk: SummaryVectorIndexContentPackChunk_ACU }> = [];
    const seenChunkIds = new Set<string>();
    const seenChunkKeys = new Set<string>();

    for (let offset = 0; offset < packRefs.length; offset += concurrency) {
        const batch = packRefs.slice(offset, offset + concurrency);
        const results = await Promise.all(batch.map(async (ref) => {
            const loaded = await readVectorIndexJsonFile_ACU<SummaryVectorIndexContentPackBlob_ACU>(ref.path);
            if (!loaded.ok || !loaded.data) {
                throw new Error(`交火向量内容寻址 pack 读取失败: ${ref.path} ${loaded.error || ''}`.trim());
            }
            const pack = loaded.data;
            if (pack.schema !== SUMMARY_VECTOR_INDEX_CONTENT_PACK_SCHEMA_ACU) {
                throw new Error(`交火向量内容寻址 pack 协议不匹配: ${ref.path} schema=${pack.schema}`);
            }
            if (Number(pack.version) !== SUMMARY_VECTOR_INDEX_CONTENT_PACK_VERSION_ACU) {
                throw new Error(`交火向量内容寻址 pack 版本不受支持: ${ref.path} version=${pack.version}`);
            }
            if (String(pack.packScope || '') !== expectedScope) {
                throw new Error(`交火向量内容寻址 pack 所属 scope 不匹配: ${ref.path} expected=${expectedScope} actual=${pack.packScope}`);
            }
            if (String(pack.packKey || '') !== String(ref.packKey || '')) {
                throw new Error(`交火向量内容寻址 pack packKey 不匹配: ${ref.path} expected=${ref.packKey} actual=${pack.packKey}`);
            }
            const actualChecksum = await sha256Text_ACU(JSON.stringify(pack));
            if (!ref.checksum || actualChecksum !== ref.checksum) {
                throw new Error(`交火向量内容寻址 pack checksum 不匹配: ${ref.path} expected=${ref.checksum} actual=${actualChecksum}`);
            }
            if (String(pack.embeddingModel || '') !== String(manifest.embeddingModel || '')) {
                throw new Error(`交火向量内容寻址 pack 模型不匹配: ${ref.path} expected=${manifest.embeddingModel} actual=${pack.embeddingModel}`);
            }
            if (Number(pack.dimension) !== Number(manifest.dimension)) {
                throw new Error(`交火向量内容寻址 pack 维度不匹配: ${ref.path} expected=${manifest.dimension} actual=${pack.dimension}`);
            }
            return { pack, ref };
        }));
        for (const { pack, ref } of results) {
            for (const chunk of Array.isArray(pack.chunks) ? pack.chunks : []) {
                const chunkId = String(chunk.chunkId || '');
                const chunkKey = String(chunk.chunkKey || '');
                if (!chunkId || !chunkKey) {
                    throw new Error(`交火向量内容寻址 pack 缺少 chunkId/chunkKey: ${ref.path}`);
                }
                if (seenChunkIds.has(chunkId)) {
                    throw new Error(`交火向量内容寻址 pack chunkId 重复: ${chunkId}`);
                }
                if (seenChunkKeys.has(chunkKey)) {
                    throw new Error(`交火向量内容寻址 pack chunkKey 重复: ${chunkKey}`);
                }
                seenChunkIds.add(chunkId);
                seenChunkKeys.add(chunkKey);
                collected.push({ chunk });
            }
        }
    }

    // 组装校验：activeChunkIds 每项恰好命中一次；不接受之外的 chunk；rowKey 必须存在于 blob.rows。
    const byChunkId = new Map<string, ChatSummaryVectorIndexChunk_ACU>();
    for (const { chunk } of collected) {
        const chunkId = String(chunk.chunkId || '');
        if (!sequenceByChunkId.has(chunkId)) {
            throw new Error(`交火向量内容寻址 pack 含 activeChunkIds 之外的 chunk: ${chunkId}`);
        }
        const rowKey = String(chunk.rowKey || '');
        if (!rowOrderByRowKey.has(rowKey)) {
            throw new Error(`交火向量内容寻址 pack chunk 的 rowKey 不存在于快照 rows: ${rowKey}`);
        }
        const vector = decodeF32B64ToVector_ACU(String(chunk.vector || ''));
        if (vector.length !== Number(manifest.dimension)) {
            throw new Error(`交火向量内容寻址 pack chunk 维度不符: ${chunkId} expected=${manifest.dimension} actual=${vector.length}`);
        }
        if (!vector.every((value) => Number.isFinite(value))) {
            throw new Error(`交火向量内容寻址 pack chunk 含非有限数值: ${chunkId}`);
        }
        byChunkId.set(chunkId, {
            chunkId,
            rowKey,
            rowOrder: rowOrderByRowKey.get(rowKey) || 0,
            text: String(chunk.text || ''),
            vector,
            sequence: sequenceByChunkId.get(chunkId) || 0,
            ...(chunk.sourceFingerprint ? { sourceFingerprint: chunk.sourceFingerprint } : {}),
            ...(chunk.textHash ? { textHash: chunk.textHash } : {}),
        });
    }
    for (const chunkId of activeChunkIds) {
        if (!byChunkId.has(chunkId)) {
            throw new Error(`交火向量内容寻址 pack 缺少 activeChunkIds 中的 chunk: ${chunkId}`);
        }
    }
    // 按 activeChunkIds 顺序输出，保证召回顺序稳定。
    return activeChunkIds.map((chunkId) => byChunkId.get(chunkId)!);
}



export function isLegacySummaryVectorIndexManifest_ACU(manifest: ChatSummaryVectorIndexManifest_ACU | null | undefined): boolean {
    const normalized = normalizeSummaryVectorIndexManifestForRead_ACU(manifest);
    if (!normalized) return false;
    if (isSingleFileSnapshotManifest_ACU(normalized)) {
        return !normalized.storageIdentity;
    }
    if (normalized.contentAddressed?.chunkRefs?.length) return false;
    return normalized.files.some((file) => file.role === 'base_shard' || file.role === 'delta_shard')
        || normalized.batchRefs.some((batch) => (batch.files || []).some((file) => file.role === 'base_shard' || file.role === 'delta_shard'));
}

export async function loadSummaryVectorIndexChunksFromManifest_ACU(
    manifest: ChatSummaryVectorIndexManifest_ACU | null | undefined,
    options: LoadSummaryVectorIndexChunksOptions_ACU = {},
): Promise<ChatSummaryVectorIndexChunk_ACU[]> {
    manifest = normalizeSummaryVectorIndexManifestForRead_ACU(manifest);
    if (!manifest) return [];
    if (isSingleFileSnapshotManifest_ACU(manifest)) {
        // V2 immutable snapshot 的 authority 是外置 blob：存储内容逐字节不可变，
        // 外部文件本身就是权威，热缓存查询与回填只会产生无效 IDB 扫描与虚假日志。
        const immutableV2 = isImmutableV2SnapshotManifest_ACU(manifest);
        if (!immutableV2 && options.preferExternalFiles !== true) {
            const cachedChunks = await getSummaryVectorHotCacheChunks_ACU({ manifest });
            if (cachedChunks?.length) {
                logSummaryVectorIndexIdentityEvent_ACU('debug', 'load', 'legacy_hot_cache_fallback', {
                    manifest,
                    path: manifest.manifestFile,
                });
                logDebug_ACU('[交火向量索引] 已从 IndexedDB 热缓存加载单文件快照向量块。');
                return cachedChunks;
            }
        }
        const chunks = await loadChunksFromSingleFileSnapshot_ACU(manifest, options);
        if (!immutableV2) {
            await putSummaryVectorHotCacheChunks_ACU({ manifest, chunks });
            logDebug_ACU('[交火向量索引] 已按单文件快照加载向量块并回填热缓存。');
        } else {
            logDebug_ACU('[交火向量索引] 已按不可变 V2 快照加载向量块（跳过热缓存）。');
        }
        return chunks;
    }
    if (manifest.contentAddressed?.chunkRefs?.length) {
        if (options.preferExternalFiles !== true) {
            const cachedChunks = await getSummaryVectorHotCacheChunks_ACU({ manifest });
            if (cachedChunks?.length) {
                logDebug_ACU('[交火向量索引] 已从 IndexedDB 热缓存加载内容寻址向量块。');
                return cachedChunks;
            }
        }
        const chunks = await loadChunksFromContentAddressedRefs_ACU(manifest, options);
        await putSummaryVectorHotCacheChunks_ACU({ manifest, chunks });
        logDebug_ACU('[交火向量索引] 已按内容寻址 manifest 加载向量块并回填热缓存。');
        return chunks;
    }
    if (Array.isArray(manifest.batchRefs) && manifest.batchRefs.length > 0) {
        const activeRowKeys = new Set(manifest.snapshot?.activeRowKeys || []);
        const activeChunkIds = new Set(manifest.snapshot?.activeChunkIds || []);
        const removedRowKeys = new Set(manifest.snapshot?.removedRowKeys || []);
        const chunks: ChatSummaryVectorIndexChunk_ACU[] = [];
        for (const batch of manifest.batchRefs) {
            const shardRefs = (batch.files || []).filter((file) => file.role === 'base_shard' || file.role === 'delta_shard');
            const batchChunks = await loadChunksFromShardRefs_ACU(batch.indexId || manifest.indexId, shardRefs, options);
            batchChunks.forEach((chunk) => {
                if (removedRowKeys.has(chunk.rowKey)) return;
                if (activeRowKeys.size > 0 && !activeRowKeys.has(chunk.rowKey)) return;
                if (activeChunkIds.size > 0 && !activeChunkIds.has(chunk.chunkId)) return;
                chunks.push(chunk);
            });
        }
        logDebug_ACU('[交火向量索引] 已按最新快照 manifest 拼接批次向量库。');
        return sortAndDedupeVectorChunks_ACU(chunks);
    }
    if (!manifest.files?.length) return [];
    const shardRefs = manifest.files.filter((file) => file.role === 'base_shard' || file.role === 'delta_shard');
    return sortAndDedupeVectorChunks_ACU(await loadChunksFromShardRefs_ACU(manifest.indexId, shardRefs, options));
}

export async function deleteSummaryVectorIndexExternal_ACU(manifest: ChatSummaryVectorIndexManifest_ACU | null | undefined): Promise<void> {
    if (!manifest) return;
    const retainedPaths = new Set<string>();
    await cleanupManifestFilesExcept_ACU(manifest, retainedPaths);
    if (manifest.indexId) {
        await deleteVectorIndexCacheByIndex_ACU(manifest.indexId);
        await deleteSummaryVectorHotCacheByIndex_ACU(manifest.indexId);
    }
}

function collectManifestRowsForRepair_ACU(manifest: ChatSummaryVectorIndexManifest_ACU): Map<string, string[]> {
    const rowsByChunkKey = new Map<string, string[]>();
    (manifest.contentAddressed?.chunkRefs || []).forEach((ref) => {
        if (!ref.chunkKey || !ref.rowKey) return;
        const rowKeys = rowsByChunkKey.get(ref.chunkKey) || [];
        rowKeys.push(ref.rowKey);
        rowsByChunkKey.set(ref.chunkKey, rowKeys);
    });
    return rowsByChunkKey;
}

export async function inspectSummaryVectorIndexHealth_ACU(): Promise<SummaryVectorIndexHealthReport_ACU> {
    const checkedAt = new Date().toISOString();
    const reachability = await collectSummaryVectorIndexReachability_ACU();
    const registry = await loadVectorIndexRegistry_ACU();
    const flushTasks = await estimateSummaryVectorFlushTasks_ACU();
    const reachablePathSet = new Set(reachability.reachablePaths);
    const issues: SummaryVectorIndexHealthReport_ACU['issues'] = [];
    const repairableRowKeys = new Set<string>();
    const seenLegacyManifestIndexes = new Set<string>();

    // 同一路径若被多个不同 scope/index/chunk 身份引用，不能把它当作普通可达文件。
    // 这通常意味着 legacy 覆盖遗留或被污染 pointer；只报告并隔离，绝不自动 repoint。
    const reachableFilesByPath = new Map<string, SummaryVectorIndexReachableFile_ACU[]>();
    reachability.reachableFiles.forEach((file) => {
        const files = reachableFilesByPath.get(file.path) || [];
        files.push(file);
        reachableFilesByPath.set(file.path, files);
    });
    reachableFilesByPath.forEach((files, path) => {
        const expectedIdentities = new Set(files.map((file) => JSON.stringify([
            file.expectedIdentity,
            file.checksum || '',
            file.chunkKey || '',
            file.chunkId || '',
            file.rowKey || '',
        ])));
        if (expectedIdentities.size < 2) return;
        const representative = files[0];
        issues.push({
            severity: 'error',
            code: 'path_identity_collision',
            path,
            role: representative.role,
            messageIndex: representative.messageIndex,
            isolationKey: representative.isolationKey,
            expected: Array.from(expectedIdentities).join(' | '),
            message: '同一路径被多个不同预期身份引用，已禁止自动迁移、repoint 与删除。',
        });
        logSummaryVectorIndexIdentityEvent_ACU('warn', 'health', 'path_identity_collision', {
            manifest: representative.manifest,
            path,
        });
    });

    for (const file of reachability.reachableFiles) {
        const loaded = await readVectorIndexJsonFile_ACU<any>(file.path);
        if (!loaded.ok || !loaded.data) {
            issues.push({
                severity: 'error',
                code: 'missing_file',
                path: file.path,
                role: file.role,
                messageIndex: file.messageIndex,
                isolationKey: file.isolationKey,
                message: loaded.error || '外置文件不存在或无法读取',
            });
            continue;
        }
        const json = JSON.stringify(loaded.data);
        const checksum = await sha256Text_ACU(json);
        const registryRef = registry.files.find((item) => item.path === file.path);
        if (registryRef?.checksum && registryRef.checksum !== checksum) {
            issues.push({
                severity: 'error',
                code: 'checksum_mismatch',
                path: file.path,
                role: file.role,
                messageIndex: file.messageIndex,
                isolationKey: file.isolationKey,
                expected: registryRef.checksum,
                actual: checksum,
                message: 'registry checksum 与实际文件内容不一致',
            });
        }
        if (file.role === 'manifest' && isSingleFileSnapshotManifest_ACU(file.manifest) && !file.manifest.storageIdentity
            && !seenLegacyManifestIndexes.has(file.manifest.indexId)) {
            seenLegacyManifestIndexes.add(file.manifest.indexId);
            issues.push({
                severity: 'warning',
                code: 'legacy_manifest',
                path: file.path,
                role: file.role,
                messageIndex: file.messageIndex,
                isolationKey: file.isolationKey,
                message: '旧 single-file 快照仍可读取，但尚未具备 V2 immutable identity，等待显式迁移或重建。',
            });
        }
        if (file.role === 'manifest' && isSingleFileSnapshotManifest_ACU(file.manifest)) {
            const snapshot = loaded.data as VectorIndexSingleSnapshotBlob_ACU;
            try {
                if (snapshot.schema !== 'single_file_snapshot') {
                    throw new Error(`交火向量单文件快照协议不匹配: ${file.path}`);
                }
                validateSingleFileSnapshotIdentity_ACU(file.manifest, snapshot, file.path);
            } catch (error) {
                issues.push({
                    severity: 'error',
                    code: 'identity_mismatch',
                    path: file.path,
                    role: file.role,
                    messageIndex: file.messageIndex,
                    isolationKey: file.isolationKey,
                    expected: JSON.stringify(file.expectedIdentity),
                    actual: String((error as Error)?.message || error),
                    message: '单文件快照未通过正式读取身份校验，已禁止将其视为可信对象。',
                });
                logSummaryVectorIndexIdentityEvent_ACU('warn', 'health', 'identity_mismatch', {
                    manifest: file.manifest,
                    path: file.path,
                    error,
                });
            }
        }
        if (file.role === 'vector_pack') {
            // T15：P4 内容寻址 pack（content_addressed_vector_pack）与 legacy pack 分流。
            // 新 pack 无 indexId、vector 是 f32b64 字符串，legacy 校验会逐个误报 identity_mismatch。
            const rawPack = loaded.data as any;
            if (rawPack?.schema === SUMMARY_VECTOR_INDEX_CONTENT_PACK_SCHEMA_ACU) {
                const pack = rawPack as SummaryVectorIndexContentPackBlob_ACU;
                const packChunks = Array.isArray(pack.chunks) ? pack.chunks : [];
                const expectedScope = buildVectorIndexSingleSnapshotV2ScopeToken_ACU({
                    chatKey: file.expectedIdentity?.chatKey || file.manifest?.chatKey || '',
                    isolationKey: file.expectedIdentity?.isolationKey || file.manifest?.isolationKey || '',
                    sourceTableKey: file.expectedIdentity?.sourceTableKey || file.manifest?.sourceTableKey || '',
                });
                const expectedEmbeddingModel = file.manifest?.embeddingModel || '';
                const expectedDimension = Number(file.manifest?.dimension || 0);
                const activeChunkIds = Array.isArray(file.manifest?.snapshot?.activeChunkIds) ? file.manifest!.snapshot!.activeChunkIds.map((item) => String(item)) : [];
                const packKeyFromPath = String(rawPack.packKey || '');
                const identityMismatch = Number(pack.version) !== SUMMARY_VECTOR_INDEX_CONTENT_PACK_VERSION_ACU
                    || !packKeyFromPath
                    || String(pack.packScope || '') !== expectedScope
                    || String(pack.embeddingModel || '') !== expectedEmbeddingModel
                    || Number(pack.dimension) !== expectedDimension
                    || packChunks.length === 0
                    || packChunks.some((chunk) => !chunk?.chunkKey || !chunk.chunkId || !chunk.rowKey
                        || chunk.vectorEncoding !== 'f32b64'
                        || typeof chunk.vector !== 'string'
                        || chunk.vector.length === 0);
                if (identityMismatch) {
                    issues.push({
                        severity: 'error',
                        code: 'identity_mismatch',
                        path: file.path,
                        role: file.role,
                        messageIndex: file.messageIndex,
                        isolationKey: file.isolationKey,
                        expected: `${expectedScope}/${expectedEmbeddingModel}/${expectedDimension}`,
                        actual: `${String(pack.packScope || '')}/${String(pack.embeddingModel || '')}/${Number(pack.dimension || 0)}`,
                        message: '内容寻址 pack 身份与 manifest 引用不一致，或包内缺少有效向量',
                    });
                }
                // 缺块 / 重复 / 多余 chunk 检查：activeChunkIds 每项必须恰好命中一次。
                const chunkIdsInPack = new Set(packChunks.map((chunk) => String(chunk.chunkId || '')));
                if (activeChunkIds.length > 0) {
                    const chunkIdCount = new Map<string, number>();
                    packChunks.forEach((chunk) => {
                        const id = String(chunk.chunkId || '');
                        chunkIdCount.set(id, (chunkIdCount.get(id) || 0) + 1);
                    });
                    for (const chunkId of chunkIdCount.keys()) {
                        if ((chunkIdCount.get(chunkId) || 0) > 1) {
                            issues.push({
                                severity: 'error',
                                code: 'pack_chunk_duplicated',
                                path: file.path,
                                role: 'vector_pack',
                                messageIndex: file.messageIndex,
                                isolationKey: file.isolationKey,
                                chunkKey: String(packChunks.find((c) => String(c.chunkId || '') === chunkId)?.chunkKey || ''),
                                chunkId,
                                rowKey: String(packChunks.find((c) => String(c.chunkId || '') === chunkId)?.rowKey || ''),
                                expected: 'unique',
                                actual: String(chunkIdCount.get(chunkId) || 0),
                                message: '内容寻址 pack 内出现重复 chunkId',
                            });
                        }
                    }
                    for (const chunkId of activeChunkIds) {
                        if (!chunkIdsInPack.has(chunkId)) {
                            issues.push({
                                severity: 'error',
                                code: 'pack_chunk_missing',
                                path: file.path,
                                role: 'vector_pack',
                                messageIndex: file.messageIndex,
                                isolationKey: file.isolationKey,
                                chunkId,
                                expected: chunkId,
                                actual: 'missing_in_pack',
                                message: 'manifest activeChunkIds 指向的内容块在内容寻址 pack 内不存在',
                            });
                        }
                    }
                    for (const chunkId of chunkIdsInPack.keys()) {
                        if (!activeChunkIds.includes(chunkId)) {
                            issues.push({
                                severity: 'error',
                                code: 'pack_chunk_unexpected',
                                path: file.path,
                                role: 'vector_pack',
                                messageIndex: file.messageIndex,
                                isolationKey: file.isolationKey,
                                chunkId,
                                expected: 'not_in_active',
                                actual: chunkId,
                                message: '内容寻址 pack 含 activeChunkIds 之外的 chunk',
                            });
                        }
                    }
                }
                // 注释（计划 §T15）：新协议 chunkRefs 为空，chunkRefsForPack 循环自然跳过。
                if (file.checksum) {
                    const actualChecksum = await sha256Text_ACU(JSON.stringify(pack));
                    if (actualChecksum !== file.checksum) {
                        issues.push({
                            severity: 'error',
                            code: 'checksum_mismatch',
                            path: file.path,
                            role: file.role,
                            messageIndex: file.messageIndex,
                            isolationKey: file.isolationKey,
                            expected: file.checksum,
                            actual: actualChecksum,
                            message: '内容寻址 pack checksum 与实际内容不一致',
                        });
                    }
                }
                continue;
            }
            const pack = loaded.data as VectorIndexPackBlob_ACU;
            const chunks = Array.isArray(pack.chunks) ? pack.chunks : [];
            const chunksByKey = new Map(chunks.map((chunk) => [String(chunk?.chunkKey || ''), chunk]));
            const vectorPackIdentityMismatch = !pack.packKey
                || String(pack.indexId || '') !== String(file.indexId || '')
                || chunks.length === 0
                || chunks.some((chunk) => !chunk?.chunkKey || !chunk.chunkId || !chunk.rowKey || !Array.isArray(chunk.vector) || chunk.vector.length === 0);
            if (vectorPackIdentityMismatch) {
                issues.push({
                    severity: 'error',
                    code: 'identity_mismatch',
                    path: file.path,
                    role: file.role,
                    messageIndex: file.messageIndex,
                    isolationKey: file.isolationKey,
                    expected: String(file.indexId || ''),
                    actual: `${String(pack.indexId || '')}/${String(pack.packKey || '')}`,
                    message: '内容寻址向量包身份与 manifest 引用不一致，或包内缺少有效向量',
                });
            }
            const chunkRefsForPack = reachability.reachableFiles.filter((item) => item.path === file.path && item.role === 'vector_chunk');
            for (const ref of chunkRefsForPack) {
                const chunk = chunksByKey.get(String(ref.chunkKey || ''));
                if (!chunk) {
                    issues.push({
                        severity: 'error',
                        code: 'pack_chunk_missing',
                        path: file.path,
                        role: 'vector_pack',
                        messageIndex: ref.messageIndex,
                        isolationKey: ref.isolationKey,
                        chunkKey: ref.chunkKey,
                        chunkId: ref.chunkId,
                        rowKey: ref.rowKey,
                        expected: String(ref.chunkKey || ''),
                        actual: 'missing_in_pack',
                        message: 'manifest chunkRef 指向的内容块在 vector_pack 内不存在',
                    });
                    if (ref.rowKey) repairableRowKeys.add(ref.rowKey);
                    continue;
                }
                const chunkIdentityMismatch = String(chunk.chunkId || '') !== String(ref.chunkId || '')
                    || String(chunk.rowKey || '') !== String(ref.rowKey || '')
                    || !Array.isArray(chunk.vector)
                    || chunk.vector.length === 0;
                if (chunkIdentityMismatch) {
                    issues.push({
                        severity: 'error',
                        code: 'identity_mismatch',
                        path: file.path,
                        role: 'vector_pack',
                        messageIndex: ref.messageIndex,
                        isolationKey: ref.isolationKey,
                        chunkKey: ref.chunkKey,
                        chunkId: ref.chunkId,
                        rowKey: ref.rowKey,
                        expected: `${ref.chunkKey || ''}/${ref.chunkId || ''}/${ref.rowKey || ''}`,
                        actual: `${String(chunk.chunkKey || '')}/${String(chunk.chunkId || '')}/${String(chunk.rowKey || '')}`,
                        message: 'vector_pack 内 chunk 身份与 manifest chunkRef 不一致',
                    });
                    if (ref.rowKey) repairableRowKeys.add(ref.rowKey);
                }
                if (ref.checksum) {
                    const chunkChecksum = await sha256Text_ACU(JSON.stringify(chunk));
                    if (chunkChecksum !== ref.checksum) {
                        issues.push({
                            severity: 'error',
                            code: 'checksum_mismatch',
                            path: file.path,
                            role: 'vector_pack',
                            messageIndex: ref.messageIndex,
                            isolationKey: ref.isolationKey,
                            chunkKey: ref.chunkKey,
                            chunkId: ref.chunkId,
                            rowKey: ref.rowKey,
                            expected: ref.checksum,
                            actual: chunkChecksum,
                            message: 'vector_pack 内 chunk checksum 与 manifest chunkRef 不一致',
                        });
                        if (ref.rowKey) repairableRowKeys.add(ref.rowKey);
                    }
                }
            }
            if (file.checksum && checksum !== file.checksum) {
                issues.push({
                    severity: 'error',
                    code: 'checksum_mismatch',
                    path: file.path,
                    role: file.role,
                    messageIndex: file.messageIndex,
                    isolationKey: file.isolationKey,
                    expected: file.checksum,
                    actual: checksum,
                    message: 'manifest packRef checksum 与实际内容不一致',
                });
            }
        } else if (file.role === 'vector_chunk') {
            const blob = loaded.data as VectorIndexChunkBlob_ACU;
            let decodedChunk: ChatSummaryVectorIndexChunk_ACU | null = null;
            try {
                decodedChunk = decodeChunkVectorInPlace_ACU({
                    ...blob,
                    chunkId: String(blob.chunkId || ''),
                    rowKey: String(blob.rowKey || ''),
                    rowOrder: Number(blob.rowOrder || 0),
                    text: String(blob.text || ''),
                    sequence: Number(blob.sequence || 0),
                } as StoredVectorIndexChunk_ACU);
            } catch {
                decodedChunk = null;
            }
            const identityMismatch = !blob.chunkKey
                || !blob.chunkId
                || !blob.rowKey
                || !decodedChunk?.vector?.length
                || String(blob.chunkKey || '') !== String(file.chunkKey || '')
                || String(blob.chunkId || '') !== String(file.chunkId || '')
                || String(blob.rowKey || '') !== String(file.rowKey || '');
            if (identityMismatch) {
                issues.push({
                    severity: 'error',
                    code: 'identity_mismatch',
                    path: file.path,
                    role: file.role,
                    messageIndex: file.messageIndex,
                    isolationKey: file.isolationKey,
                    chunkKey: file.chunkKey || blob.chunkKey,
                    chunkId: file.chunkId || blob.chunkId,
                    rowKey: file.rowKey || blob.rowKey,
                    expected: `${file.chunkKey || ''}/${file.chunkId || ''}/${file.rowKey || ''}`,
                    actual: `${String(blob.chunkKey || '')}/${String(blob.chunkId || '')}/${String(blob.rowKey || '')}`,
                    message: '内容寻址向量块身份与 manifest 引用不一致，或缺少有效向量',
                });
                if (file.rowKey || blob.rowKey) repairableRowKeys.add(String(file.rowKey || blob.rowKey));
            }
            if (file.checksum && checksum !== file.checksum) {
                issues.push({
                    severity: 'error',
                    code: 'checksum_mismatch',
                    path: file.path,
                    role: file.role,
                    messageIndex: file.messageIndex,
                    isolationKey: file.isolationKey,
                    chunkKey: file.chunkKey,
                    chunkId: file.chunkId,
                    rowKey: file.rowKey,
                    expected: file.checksum,
                    actual: checksum,
                    message: 'manifest chunkRef checksum 与实际内容不一致',
                });
                if (file.rowKey) repairableRowKeys.add(file.rowKey);
            }
        } else if ((file.role === 'base_shard' || file.role === 'delta_shard') && !seenLegacyManifestIndexes.has(file.indexId || file.manifestKey)) {
            seenLegacyManifestIndexes.add(file.indexId || file.manifestKey);
            issues.push({
                severity: 'warning',
                code: 'legacy_manifest',
                path: file.path,
                role: file.role,
                messageIndex: file.messageIndex,
                isolationKey: file.isolationKey,
                message: '旧 shard 协议仍可读，但建议迁移到内容寻址 chunk 协议',
            });
        }
    }

    registry.files.forEach((file) => {
        const path = String(file?.path || '').trim();
        if (!path || reachablePathSet.has(path) || path === 'TavernDB_ACU_vector_registry') return;
        issues.push({
            severity: 'warning',
            code: 'unreachable_registered_file',
            path,
            role: file.role,
            message: 'registry 中存在当前聊天快照不可达的外置文件，可由安全 GC 清理',
        });
    });

    const missingFileCount = issues.filter((issue) => issue.code === 'missing_file').length;
    const checksumMismatchCount = issues.filter((issue) => issue.code === 'checksum_mismatch').length;
    const identityMismatchCount = issues.filter((issue) => issue.code === 'identity_mismatch').length;
    const pathIdentityCollisionCount = issues.filter((issue) => issue.code === 'path_identity_collision').length;
    const legacyManifestCount = issues.filter((issue) => issue.code === 'legacy_manifest').length;
    const unreachableRegisteredFileCount = issues.filter((issue) => issue.code === 'unreachable_registered_file').length;
    const status: SummaryVectorIndexHealthReport_ACU['status'] = reachability.manifestCount === 0
        ? 'empty'
        : missingFileCount > 0
            ? 'missing'
            : checksumMismatchCount > 0 || identityMismatchCount > 0 || pathIdentityCollisionCount > 0 || issues.length > 0
                ? 'degraded'
                : 'healthy';

    return {
        status,
        checkedAt,
        manifestCount: reachability.manifestCount,
        reachableFileCount: reachability.reachableFiles.length,
        registeredFileCount: registry.files.length,
        missingFileCount,
        checksumMismatchCount,
        identityMismatchCount,
        pathIdentityCollisionCount,
        legacyManifestCount,
        unreachableRegisteredFileCount,
        flushTaskTotalCount: flushTasks.total,
        flushTaskDirtyCount: flushTasks.dirty,
        flushTaskQueuedCount: flushTasks.queued,
        flushTaskFlushingCount: flushTasks.flushing,
        flushTaskFailedCount: flushTasks.failedRetryable + flushTasks.failedTerminal,
        flushTaskLastError: flushTasks.lastError,
        repairableRowKeys: Array.from(repairableRowKeys),
        issues,
    };
}

export async function getSummaryVectorIndexStats_ACU(manifest: ChatSummaryVectorIndexManifest_ACU | null | undefined): Promise<SummaryVectorIndexStats_ACU> {
    manifest = normalizeSummaryVectorIndexManifestForRead_ACU(manifest);
    const tempCache = await estimateVectorIndexTempCache_ACU(manifest?.indexId);
    const hotCache = await estimateSummaryVectorHotCache_ACU(manifest?.indexId);
    const flushTasks = await estimateSummaryVectorFlushTasks_ACU(manifest ? {
        chatKey: manifest.chatKey,
        isolationKey: manifest.isolationKey,
        sourceTableKey: manifest.sourceTableKey,
    } : undefined);
    const cacheTotalBytes = tempCache.bytes + hotCache.bytes;
    const flushTaskFields = {
        flushTaskTotalCount: flushTasks.total,
        flushTaskDirtyCount: flushTasks.dirty,
        flushTaskQueuedCount: flushTasks.queued,
        flushTaskFlushingCount: flushTasks.flushing,
        flushTaskFailedCount: flushTasks.failedRetryable + flushTasks.failedTerminal,
        flushTaskLastError: flushTasks.lastError,
    };
    if (!manifest) {
        return {
            status: 'none',
            indexId: '',
            backend: 'none',
            rowCount: 0,
            chunkCount: 0,
            baseShardCount: 0,
            deltaShardCount: 0,
            tombstoneRowCount: 0,
            tombstoneChunkCount: 0,
            externalTotalBytes: 0,
            cacheTotalBytes,
            tempCacheBytes: tempCache.bytes,
            tempCacheCount: tempCache.count,
            hotCacheBytes: hotCache.bytes,
            hotCacheCount: hotCache.count,
            ...flushTaskFields,
            updatedAt: '',
        };
    }
    return {
        status: manifest.status,
        indexId: manifest.indexId,
        backend: manifest.backend,
        rowCount: manifest.rowCount,
        chunkCount: manifest.chunkCount,
        baseShardCount: manifest.baseShardCount,
        deltaShardCount: manifest.deltaShardCount,
        tombstoneRowCount: manifest.tombstoneRowCount,
        tombstoneChunkCount: manifest.tombstoneChunkCount,
        externalTotalBytes: manifest.externalTotalBytes,
        cacheTotalBytes,
        tempCacheBytes: tempCache.bytes,
        tempCacheCount: tempCache.count,
        hotCacheBytes: hotCache.bytes,
        hotCacheCount: hotCache.count,
        ...flushTaskFields,
        updatedAt: manifest.updatedAt,
        error: manifest.error,
    };
}
