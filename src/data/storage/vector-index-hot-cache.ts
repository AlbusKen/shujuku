import type { ChatSummaryVectorIndexChunk_ACU, ChatSummaryVectorIndexManifest_ACU } from '../../service/vector/summary-vector-index-types';
import { normalizeSummaryVectorIsolationKey_ACU } from '../../shared/summary-vector-index-scope';

const DB_NAME_ACU = 'TavernDB_ACU_VectorHotCache';
const DB_VERSION_ACU = 3;
const STORE_NAME_ACU = 'chunks';
const FLUSH_TASK_STORE_NAME_ACU = 'flushTasks';

export type SummaryVectorIndexFlushTaskStatus_ACU = 'dirty' | 'queued' | 'flushing' | 'ready' | 'failed_retryable' | 'failed_terminal' | 'invalidated' | 'blocked_needs_rebuild';
export type SummaryVectorIndexFlushTaskMode_ACU = 'append' | 'sync';

export interface VectorIndexHotCacheScope_ACU {
    chatKey?: string;
    isolationKey?: string;
    sourceTableKey?: string;
}

export interface VectorIndexHotCacheWriteOptions_ACU {
    manifest: ChatSummaryVectorIndexManifest_ACU;
    chunks: ChatSummaryVectorIndexChunk_ACU[];
}

export interface VectorIndexHotCacheLoadOptions_ACU {
    manifest: ChatSummaryVectorIndexManifest_ACU;
}

export interface SummaryVectorIndexFlushTaskRecord_ACU {
    scopeKey: string;
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
    targetMessageIndex?: number;
    generation: number;
    mode: SummaryVectorIndexFlushTaskMode_ACU;
    status: SummaryVectorIndexFlushTaskStatus_ACU;
    requestedAt: number;
    debounceUntil: number;
    attemptCount: number;
    lastAttemptAt?: number;
    lastSuccessAt?: number;
    lastError?: string;
    updatedAt: number;
}

export interface SummaryVectorIndexFlushTaskUpsert_ACU {
    scopeKey: string;
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
    targetMessageIndex?: number;
    generation?: number;
    mode: SummaryVectorIndexFlushTaskMode_ACU;
    status: SummaryVectorIndexFlushTaskStatus_ACU;
    requestedAt?: number;
    debounceUntil?: number;
    lastError?: string;
}

export interface SummaryVectorIndexFlushTaskEstimate_ACU {
    total: number;
    dirty: number;
    queued: number;
    flushing: number;
    ready: number;
    failedRetryable: number;
    failedTerminal: number;
    lastError?: string;
}

interface VectorIndexHotCacheChunkRecord_ACU {
    key: string;
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
    indexId: string;
    checkpointId: string;
    writeGeneration: string;
    chunkKey: string;
    chunkId: string;
    rowKey: string;
    embeddingModel: string;
    dimension: number;
    checksum: string;
    chunk: ChatSummaryVectorIndexChunk_ACU;
    byteSize: number;
    createdAt: number;
    updatedAt: number;
    lastAccessAt: number;
}

function isIdbAvailable_ACU(): boolean {
    return typeof indexedDB !== 'undefined';
}

function normalizeKeyPart_ACU(value: any): string {
    return String(value || '').trim();
}

function buildRecordKey_ACU(indexId: string, chunkId: string, chunkKey: string): string {
    return `${normalizeKeyPart_ACU(indexId)}::${normalizeKeyPart_ACU(chunkId)}::${normalizeKeyPart_ACU(chunkKey)}`;
}

function openDb_ACU(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        if (!isIdbAvailable_ACU()) {
            reject(new Error('IndexedDB 不可用'));
            return;
        }
        const request = indexedDB.open(DB_NAME_ACU, DB_VERSION_ACU);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME_ACU)) {
                const store = db.createObjectStore(STORE_NAME_ACU, { keyPath: 'key' });
                store.createIndex('indexId', 'indexId', { unique: false });
                store.createIndex('checkpointId', 'checkpointId', { unique: false });
                store.createIndex('scope', ['chatKey', 'isolationKey', 'sourceTableKey'], { unique: false });
                store.createIndex('lastAccessAt', 'lastAccessAt', { unique: false });
            }
            if (!db.objectStoreNames.contains(FLUSH_TASK_STORE_NAME_ACU)) {
                const taskStore = db.createObjectStore(FLUSH_TASK_STORE_NAME_ACU, { keyPath: 'scopeKey' });
                taskStore.createIndex('scope', ['chatKey', 'isolationKey', 'sourceTableKey'], { unique: true });
                taskStore.createIndex('status', 'status', { unique: false });
                taskStore.createIndex('debounceUntil', 'debounceUntil', { unique: false });
                taskStore.createIndex('updatedAt', 'updatedAt', { unique: false });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('打开交火向量热缓存失败'));
    });
}

// 摘要向量内存可能是 Float32Array（解码路径）或 number[]（IDB/元数据回读）。
// IDB 序列化路径必须保持不变：写库前统一转回普通 number[]，避免结构化克隆把
// Float32Array 落成不同形态，破坏既有缓存读取契约。
function getChunkVector_ACU(chunk: ChatSummaryVectorIndexChunk_ACU | null | undefined): number[] | Float32Array | null {
    if (Array.isArray(chunk?.vector)) return chunk!.vector;
    if (chunk?.vector instanceof Float32Array) return chunk.vector;
    return null;
}

function chunkVectorToNumberArray_ACU(chunk: ChatSummaryVectorIndexChunk_ACU | null | undefined): number[] {
    const vector = getChunkVector_ACU(chunk);
    if (!vector) return [];
    return Array.from(vector, (value) => Number(value) || 0);
}

function cloneChunk_ACU(chunk: ChatSummaryVectorIndexChunk_ACU): ChatSummaryVectorIndexChunk_ACU {
    return {
        ...chunk,
        vector: chunkVectorToNumberArray_ACU(chunk),
        chunkKeys: Array.isArray(chunk.chunkKeys) ? [...chunk.chunkKeys] : chunk.chunkKeys,
    };
}

function getManifestCheckpointId_ACU(manifest: ChatSummaryVectorIndexManifest_ACU): string {
    return normalizeKeyPart_ACU(manifest.checkpoint?.checkpointId || manifest.indexId);
}

function getActiveChunkRefs_ACU(manifest: ChatSummaryVectorIndexManifest_ACU) {
    const refs = Array.isArray(manifest.contentAddressed?.chunkRefs) ? manifest.contentAddressed!.chunkRefs : [];
    const activeChunkKeys = new Set((manifest.contentAddressed?.activeChunkKeys || []).map((item) => normalizeKeyPart_ACU(item)).filter(Boolean));
    return refs.filter((ref) => {
        const chunkKey = normalizeKeyPart_ACU(ref?.chunkKey);
        return chunkKey && (activeChunkKeys.size === 0 || activeChunkKeys.has(chunkKey));
    });
}

function isSingleFileSnapshotManifest_ACU(manifest: ChatSummaryVectorIndexManifest_ACU): boolean {
    return manifest.snapshot?.mode === 'single_file_snapshot';
}

/**
 * 判定是否为「不可变 V2 单文件快照」。
 * 这类快照的存储内容是逐字节不可变的（同一 manifest 内容永远产出同一文件），
 * 外部文件本身就是权威存储，热缓存（IndexedDB 副本）只会增加无效扫描与虚假日志。
 *
 * 判定必须显式要求 snapshot.mode，不能复用 isSingleFileSnapshotManifest_ACU 的
 * 路径推断回退（storage-service:2020-2025），否则 legacy 单文件会被误判为 V2。
 */
export function isImmutableV2SnapshotManifest_ACU(
    manifest: ChatSummaryVectorIndexManifest_ACU | null | undefined,
): boolean {
    if (manifest?.snapshot?.mode !== 'single_file_snapshot') return false;
    const identity = manifest.storageIdentity;
    if (!identity || identity.layoutVersion !== 2) return false;
    if (!String(identity.scopeFingerprint || '').trim()) return false;
    if (!String(identity.writeGeneration || '').trim()) return false;
    return Number.isInteger(identity.revision) && Number(identity.revision) > 0;
}

function isRecordCompatible_ACU(record: VectorIndexHotCacheChunkRecord_ACU | null | undefined, manifest: ChatSummaryVectorIndexManifest_ACU, ref: ReturnType<typeof getActiveChunkRefs_ACU>[number]): boolean {
    if (!record?.chunk) return false;
    if (record.chatKey !== normalizeKeyPart_ACU(manifest.chatKey)) return false;
    if (record.isolationKey !== normalizeSummaryVectorIsolationKey_ACU(manifest.isolationKey)) return false;
    if (record.sourceTableKey !== normalizeKeyPart_ACU(manifest.sourceTableKey)) return false;
    if (record.indexId !== normalizeKeyPart_ACU(manifest.indexId)) return false;
    if (record.checkpointId !== getManifestCheckpointId_ACU(manifest)) return false;
    if (record.writeGeneration !== normalizeKeyPart_ACU(manifest.storageIdentity?.writeGeneration || '')) return false;
    if (record.chunkKey !== normalizeKeyPart_ACU(ref.chunkKey)) return false;
    if (record.chunkId !== normalizeKeyPart_ACU(ref.chunkId)) return false;
    if (record.rowKey !== normalizeKeyPart_ACU(ref.rowKey)) return false;
    if (record.dimension !== Math.max(0, Number(ref.dimension) || 0)) return false;
    if (ref.checksum && record.checksum && record.checksum !== ref.checksum) return false;
    const vector = getChunkVector_ACU(record.chunk);
    return !!vector && vector.length > 0 && (!ref.dimension || vector.length === ref.dimension);
}

/**
 * P7：热缓存字节预算 LRU。超预算时按 lastAccessAt 从最旧开始淘汰。
 * 只作用于 chunk 数据 store，绝不触碰 flush 任务 store（任务是持久化意图，不是缓存）。
 */
const VECTOR_HOT_CACHE_MAX_BYTES_ACU = 64 * 1024 * 1024;
const VECTOR_HOT_CACHE_TRIM_THROTTLE_MS_ACU = 60_000;
let lastHotCacheTrimAt_ACU = 0;

export async function trimSummaryVectorHotCacheToBudget_ACU(
    maxBytes: number = VECTOR_HOT_CACHE_MAX_BYTES_ACU,
): Promise<void> {
    try {
        const db = await openDb_ACU();
        const totalBytes = await new Promise<number>((resolve, reject) => {
            let bytes = 0;
            const tx = db.transaction(STORE_NAME_ACU, 'readonly');
            const request = tx.objectStore(STORE_NAME_ACU).openCursor();
            request.onsuccess = () => {
                const cursor = request.result;
                if (cursor) {
                    bytes += Math.max(0, Number((cursor.value as VectorIndexHotCacheChunkRecord_ACU).byteSize) || 0);
                    cursor.continue();
                }
            };
            request.onerror = () => reject(request.error || new Error('统计交火向量热缓存体积失败'));
            tx.oncomplete = () => { db.close(); resolve(bytes); };
            tx.onerror = () => { db.close(); reject(tx.error || new Error('统计交火向量热缓存体积事务失败')); };
        });
        if (totalBytes <= maxBytes) return;
        let bytesToFree = totalBytes - maxBytes;
        const trimDb = await openDb_ACU();
        await new Promise<void>((resolve, reject) => {
            const tx = trimDb.transaction(STORE_NAME_ACU, 'readwrite');
            const request = tx.objectStore(STORE_NAME_ACU).index('lastAccessAt').openCursor();
            request.onsuccess = () => {
                const cursor = request.result;
                if (cursor && bytesToFree > 0) {
                    bytesToFree -= Math.max(0, Number((cursor.value as VectorIndexHotCacheChunkRecord_ACU).byteSize) || 0);
                    cursor.delete();
                    cursor.continue();
                }
            };
            request.onerror = () => reject(request.error || new Error('交火向量热缓存 LRU 淘汰失败'));
            tx.oncomplete = () => { trimDb.close(); resolve(); };
            tx.onerror = () => { trimDb.close(); reject(tx.error || new Error('交火向量热缓存 LRU 淘汰事务失败')); };
        });
    } catch {
        // 淘汰失败不影响读写链路，下次写入会再次尝试。
    }
}

function maybeScheduleHotCacheTrim_ACU(): void {
    if (Date.now() - lastHotCacheTrimAt_ACU < VECTOR_HOT_CACHE_TRIM_THROTTLE_MS_ACU) return;
    lastHotCacheTrimAt_ACU = Date.now();
    void trimSummaryVectorHotCacheToBudget_ACU().catch((): undefined => undefined);
}

export async function putSummaryVectorHotCacheChunks_ACU(options: VectorIndexHotCacheWriteOptions_ACU): Promise<void> {
    try {
        const manifest = options.manifest;
        if (!manifest?.indexId || manifest.status !== 'ready') return;
        if (!Array.isArray(options.chunks) || options.chunks.length === 0) return;

        // 不可变 V2 快照：外部文件即权威，写入热缓存只会产生无效 IDB 扫描。
        if (isImmutableV2SnapshotManifest_ACU(manifest)) return;

        // ── 单文件快照模式：直接写入所有 chunks，不依赖 contentAddressed.chunkRefs ──
        if (isSingleFileSnapshotManifest_ACU(manifest)) {
            const db = await openDb_ACU();
            await new Promise<void>((resolve, reject) => {
                const tx = db.transaction(STORE_NAME_ACU, 'readwrite');
                const store = tx.objectStore(STORE_NAME_ACU);
                const now = Date.now();
                options.chunks.forEach((chunk) => {
                    const chunkId = normalizeKeyPart_ACU(chunk?.chunkId);
                    const vector = getChunkVector_ACU(chunk);
                    if (!chunkId || !vector || vector.length === 0) return;
                    const chunkKey = normalizeKeyPart_ACU((Array.isArray(chunk.chunkKeys) && chunk.chunkKeys[0]) || chunkId);
                    const normalizedChunk = cloneChunk_ACU({
                        ...chunk,
                        chunkKeys: Array.from(new Set([...(Array.isArray(chunk.chunkKeys) ? chunk.chunkKeys : []), chunkKey].filter(Boolean))),
                    });
                    const json = JSON.stringify(normalizedChunk);
                    const record: VectorIndexHotCacheChunkRecord_ACU = {
                        key: buildRecordKey_ACU(manifest.indexId, chunkId, chunkKey),
                        chatKey: normalizeKeyPart_ACU(manifest.chatKey),
                        isolationKey: normalizeSummaryVectorIsolationKey_ACU(manifest.isolationKey),
                        sourceTableKey: normalizeKeyPart_ACU(manifest.sourceTableKey),
                        indexId: normalizeKeyPart_ACU(manifest.indexId),
                        checkpointId: getManifestCheckpointId_ACU(manifest),
                        writeGeneration: normalizeKeyPart_ACU(manifest.storageIdentity?.writeGeneration || ''),
                        chunkKey,
                        chunkId,
                        rowKey: normalizeKeyPart_ACU(chunk.rowKey),
                        embeddingModel: normalizeKeyPart_ACU(manifest.embeddingModel),
                        dimension: Math.max(0, vector.length),
                        checksum: '',
                        chunk: normalizedChunk,
                        byteSize: new Blob([json]).size,
                        createdAt: now,
                        updatedAt: now,
                        lastAccessAt: now,
                    };
                    store.put(record);
                });
                tx.oncomplete = () => { db.close(); resolve(); };
                tx.onerror = () => { db.close(); reject(tx.error || new Error('写入交火向量热缓存事务失败（单文件快照）')); };
            });
            maybeScheduleHotCacheTrim_ACU();
            return;
        }

        // ── 旧版内容寻址模式：通过 chunkRefs 匹配写入 ──
        const refs = getActiveChunkRefs_ACU(manifest);
        if (refs.length === 0) return;
        const refsByChunkId = new Map(refs.map((ref) => [normalizeKeyPart_ACU(ref.chunkId), ref]));
        const db = await openDb_ACU();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME_ACU, 'readwrite');
            const store = tx.objectStore(STORE_NAME_ACU);
            const now = Date.now();
            options.chunks.forEach((chunk) => {
                const chunkId = normalizeKeyPart_ACU(chunk?.chunkId);
                const ref = refsByChunkId.get(chunkId);
                const vector = getChunkVector_ACU(chunk);
                if (!ref || !vector || vector.length === 0) return;
                const chunkKey = normalizeKeyPart_ACU(ref.chunkKey);
                const normalizedChunk = cloneChunk_ACU({
                    ...chunk,
                    chunkKeys: Array.from(new Set([...(Array.isArray(chunk.chunkKeys) ? chunk.chunkKeys : []), chunkKey].filter(Boolean))),
                });
                const json = JSON.stringify(normalizedChunk);
                const record: VectorIndexHotCacheChunkRecord_ACU = {
                    key: buildRecordKey_ACU(manifest.indexId, ref.chunkId, chunkKey),
                    chatKey: normalizeKeyPart_ACU(manifest.chatKey),
                    isolationKey: normalizeSummaryVectorIsolationKey_ACU(manifest.isolationKey),
                    sourceTableKey: normalizeKeyPart_ACU(manifest.sourceTableKey),
                    indexId: normalizeKeyPart_ACU(manifest.indexId),
                    checkpointId: getManifestCheckpointId_ACU(manifest),
                    writeGeneration: normalizeKeyPart_ACU(manifest.storageIdentity?.writeGeneration || ''),
                    chunkKey,
                    chunkId: normalizeKeyPart_ACU(ref.chunkId),
                    rowKey: normalizeKeyPart_ACU(ref.rowKey),
                    embeddingModel: normalizeKeyPart_ACU(ref.embeddingModel || manifest.embeddingModel),
                    dimension: Math.max(0, Number(ref.dimension || vector.length) || 0),
                    checksum: normalizeKeyPart_ACU(ref.checksum),
                    chunk: normalizedChunk,
                    byteSize: new Blob([json]).size,
                    createdAt: now,
                    updatedAt: now,
                    lastAccessAt: now,
                };
                store.put(record);
            });
            tx.oncomplete = () => {
                db.close();
                resolve();
            };
            tx.onerror = () => {
                db.close();
                reject(tx.error || new Error('写入交火向量热缓存事务失败'));
            };
        });
        maybeScheduleHotCacheTrim_ACU();
    } catch {
        // 热缓存只是可丢失加速层，失败不能影响外置权威链路。
    }
}

export async function getSummaryVectorHotCacheChunks_ACU(options: VectorIndexHotCacheLoadOptions_ACU): Promise<ChatSummaryVectorIndexChunk_ACU[] | null> {
    try {
        const manifest = options.manifest;
        if (!manifest?.indexId || manifest.status !== 'ready') return null;

        // 不可变 V2 快照：直接读外部文件，热缓存命中与否都不需要查询 IDB。
        if (isImmutableV2SnapshotManifest_ACU(manifest)) return null;

        // ── 单文件快照模式：通过 indexId 索引扫描所有匹配记录 ──
        if (isSingleFileSnapshotManifest_ACU(manifest)) {
            const targetIndexId = normalizeKeyPart_ACU(manifest.indexId);
            const targetCheckpointId = getManifestCheckpointId_ACU(manifest);
            const targetChatKey = normalizeKeyPart_ACU(manifest.chatKey);
            const targetIsolationKey = normalizeSummaryVectorIsolationKey_ACU(manifest.isolationKey);
            const targetSourceTableKey = normalizeKeyPart_ACU(manifest.sourceTableKey);
            const db = await openDb_ACU();
            const records = await new Promise<Array<VectorIndexHotCacheChunkRecord_ACU>>((resolve, reject) => {
                const tx = db.transaction(STORE_NAME_ACU, 'readwrite');
                const store = tx.objectStore(STORE_NAME_ACU);
                const index = store.index('indexId');
                const loaded: Array<VectorIndexHotCacheChunkRecord_ACU> = [];
                const now = Date.now();
                const request = index.openCursor(IDBKeyRange.only(targetIndexId));
                request.onsuccess = () => {
                    const cursor = request.result;
                    if (cursor) {
                        const record = cursor.value as VectorIndexHotCacheChunkRecord_ACU;
                        if (record.chatKey === targetChatKey
                            && record.isolationKey === targetIsolationKey
                            && record.sourceTableKey === targetSourceTableKey
                            && record.checkpointId === targetCheckpointId
                            && record.writeGeneration === normalizeKeyPart_ACU(manifest.storageIdentity?.writeGeneration || '')
                            && record.chunk?.vector?.length > 0) {
                            record.lastAccessAt = now;
                            store.put(record);
                            loaded.push(record);
                        }
                        cursor.continue();
                    }
                };
                request.onerror = () => reject(request.error || new Error('读取交火向量热缓存失败（单文件快照）'));
                tx.oncomplete = () => { db.close(); resolve(loaded); };
                tx.onerror = () => { db.close(); reject(tx.error || new Error('读取交火向量热缓存事务失败（单文件快照）')); };
            });
            if (records.length === 0) return null;
            return records
                .map((record) => cloneChunk_ACU(record.chunk))
                .sort((left, right) => left.sequence - right.sequence || left.chunkId.localeCompare(right.chunkId));
        }

        // ── 旧版内容寻址模式：通过 chunkRefs 逐条读取 ──
        const refs = getActiveChunkRefs_ACU(manifest);
        if (refs.length === 0) return null;
        const db = await openDb_ACU();
        const records = await new Promise<Array<VectorIndexHotCacheChunkRecord_ACU | undefined>>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME_ACU, 'readwrite');
            const store = tx.objectStore(STORE_NAME_ACU);
            const loaded: Array<VectorIndexHotCacheChunkRecord_ACU | undefined> = [];
            let pending = refs.length;
            const finishOne = (): void => {
                pending -= 1;
                if (pending === 0) resolve(loaded);
            };
            refs.forEach((ref, index) => {
                const request = store.get(buildRecordKey_ACU(manifest.indexId, ref.chunkId, ref.chunkKey)) as IDBRequest<VectorIndexHotCacheChunkRecord_ACU | undefined>;
                request.onsuccess = () => {
                    const record = request.result;
                    if (record && isRecordCompatible_ACU(record, manifest, ref)) {
                        record.lastAccessAt = Date.now();
                        store.put(record);
                        loaded[index] = record;
                    }
                    finishOne();
                };
                request.onerror = () => reject(request.error || new Error('读取交火向量热缓存失败'));
            });
            tx.oncomplete = () => db.close();
            tx.onerror = () => {
                db.close();
                reject(tx.error || new Error('读取交火向量热缓存事务失败'));
            };
        });
        if (records.length !== refs.length || records.some((record) => !record)) return null;
        return records
            .map((record) => cloneChunk_ACU(record!.chunk))
            .sort((left, right) => left.sequence - right.sequence || left.chunkId.localeCompare(right.chunkId));
    } catch {
        return null;
    }
}

export async function deleteSummaryVectorHotCacheByIndex_ACU(indexId: string): Promise<void> {
    try {
        const targetIndexId = normalizeKeyPart_ACU(indexId);
        if (!targetIndexId) return;
        const db = await openDb_ACU();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME_ACU, 'readwrite');
            const store = tx.objectStore(STORE_NAME_ACU);
            const index = store.index('indexId');
            const request = index.openCursor(IDBKeyRange.only(targetIndexId));
            request.onsuccess = () => {
                const cursor = request.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                }
            };
            request.onerror = () => reject(request.error || new Error('清理交火向量热缓存失败'));
            tx.oncomplete = () => {
                db.close();
                resolve();
            };
            tx.onerror = () => {
                db.close();
                reject(tx.error || new Error('清理交火向量热缓存事务失败'));
            };
        });
    } catch {}
}

export async function deleteSummaryVectorHotCacheByScope_ACU(scope: VectorIndexHotCacheScope_ACU): Promise<void> {
    try {
        const chatKey = normalizeKeyPart_ACU(scope.chatKey);
        const isolationKey = normalizeKeyPart_ACU(scope.isolationKey);
        const sourceTableKey = normalizeKeyPart_ACU(scope.sourceTableKey);
        if (!chatKey && !isolationKey && !sourceTableKey) return;
        const db = await openDb_ACU();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME_ACU, 'readwrite');
            const store = tx.objectStore(STORE_NAME_ACU);
            const request = store.openCursor();
            request.onsuccess = () => {
                const cursor = request.result;
                if (cursor) {
                    const record = cursor.value as VectorIndexHotCacheChunkRecord_ACU;
                    const matches = (!chatKey || record.chatKey === chatKey)
                        && (!isolationKey || record.isolationKey === isolationKey)
                        && (!sourceTableKey || record.sourceTableKey === sourceTableKey);
                    if (matches) cursor.delete();
                    cursor.continue();
                }
            };
            request.onerror = () => reject(request.error || new Error('按作用域清理交火向量热缓存失败'));
            tx.oncomplete = () => {
                db.close();
                resolve();
            };
            tx.onerror = () => {
                db.close();
                reject(tx.error || new Error('按作用域清理交火向量热缓存事务失败'));
            };
        });
    } catch {}
}

export async function clearSummaryVectorHotCache_ACU(): Promise<void> {
    try {
        const db = await openDb_ACU();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME_ACU, 'readwrite');
            const store = tx.objectStore(STORE_NAME_ACU);
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error || new Error('清空交火向量热缓存失败'));
            tx.oncomplete = () => db.close();
            tx.onerror = () => {
                db.close();
                reject(tx.error || new Error('清空交火向量热缓存事务失败'));
            };
        });
    } catch {}
}

export async function estimateSummaryVectorHotCache_ACU(indexId?: string): Promise<{ bytes: number; count: number }> {
    try {
        const targetIndexId = normalizeKeyPart_ACU(indexId);
        const db = await openDb_ACU();
        return await new Promise((resolve, reject) => {
            let bytes = 0;
            let count = 0;
            const tx = db.transaction(STORE_NAME_ACU, 'readonly');
            const store = tx.objectStore(STORE_NAME_ACU);
            const source = targetIndexId ? store.index('indexId') : store;
            const request = targetIndexId
                ? source.openCursor(IDBKeyRange.only(targetIndexId))
                : source.openCursor();
            request.onsuccess = () => {
                const cursor = request.result;
                if (cursor) {
                    const record = cursor.value as VectorIndexHotCacheChunkRecord_ACU;
                    bytes += Math.max(0, Number(record.byteSize) || 0);
                    count += 1;
                    cursor.continue();
                }
            };
            request.onerror = () => reject(request.error || new Error('估算交火向量热缓存失败'));
            tx.oncomplete = () => {
                db.close();
                resolve({ bytes, count });
            };
            tx.onerror = () => {
                db.close();
                reject(tx.error || new Error('估算交火向量热缓存事务失败'));
            };
        });
    } catch {
        return { bytes: 0, count: 0 };
    }
}

function normalizeFlushTaskStatus_ACU(status: any): SummaryVectorIndexFlushTaskStatus_ACU {
    return status === 'queued'
        || status === 'flushing'
        || status === 'ready'
        || status === 'failed_retryable'
        || status === 'failed_terminal'
        || status === 'invalidated'
        || status === 'blocked_needs_rebuild'
        ? status
        : 'dirty';
}

function normalizeFlushTaskMode_ACU(mode: any): SummaryVectorIndexFlushTaskMode_ACU {
    return mode === 'append' ? 'append' : 'sync';
}

function cloneFlushTask_ACU(task: SummaryVectorIndexFlushTaskRecord_ACU): SummaryVectorIndexFlushTaskRecord_ACU {
    return {
        scopeKey: normalizeKeyPart_ACU(task.scopeKey),
        chatKey: normalizeKeyPart_ACU(task.chatKey),
        // 读取旧 task 时必须保留原始空槽，以便 flush queue 完成一次性迁移；
        // 所有新写入仍在 upsert/invalidate 边界 canonicalize 为 default。
        isolationKey: normalizeKeyPart_ACU(task.isolationKey),
        sourceTableKey: normalizeKeyPart_ACU(task.sourceTableKey),
        ...(Number.isFinite(Number(task.targetMessageIndex)) ? { targetMessageIndex: Number(task.targetMessageIndex) } : {}),
        generation: Math.max(0, Number(task.generation) || 0),
        mode: normalizeFlushTaskMode_ACU(task.mode),
        status: normalizeFlushTaskStatus_ACU(task.status),
        requestedAt: Math.max(0, Number(task.requestedAt) || 0),
        debounceUntil: Math.max(0, Number(task.debounceUntil) || 0),
        attemptCount: Math.max(0, Number(task.attemptCount) || 0),
        ...(Number.isFinite(Number(task.lastAttemptAt)) ? { lastAttemptAt: Number(task.lastAttemptAt) } : {}),
        ...(Number.isFinite(Number(task.lastSuccessAt)) ? { lastSuccessAt: Number(task.lastSuccessAt) } : {}),
        ...(task.lastError ? { lastError: String(task.lastError) } : {}),
        updatedAt: Math.max(0, Number(task.updatedAt) || 0),
    };
}

export async function upsertSummaryVectorFlushTask_ACU(input: SummaryVectorIndexFlushTaskUpsert_ACU): Promise<SummaryVectorIndexFlushTaskRecord_ACU | null> {
    try {
        const scopeKey = normalizeKeyPart_ACU(input.scopeKey);
        const chatKey = normalizeKeyPart_ACU(input.chatKey);
        const isolationKey = normalizeSummaryVectorIsolationKey_ACU(input.isolationKey);
        const sourceTableKey = normalizeKeyPart_ACU(input.sourceTableKey);
        if (!scopeKey || !chatKey) return null;
        const now = Date.now();
        const db = await openDb_ACU();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(FLUSH_TASK_STORE_NAME_ACU, 'readwrite');
            const store = tx.objectStore(FLUSH_TASK_STORE_NAME_ACU);
            const getRequest = store.get(scopeKey) as IDBRequest<SummaryVectorIndexFlushTaskRecord_ACU | undefined>;
            let nextRecord: SummaryVectorIndexFlushTaskRecord_ACU | null = null;
            getRequest.onsuccess = () => {
                const previous = getRequest.result ? cloneFlushTask_ACU(getRequest.result) : null;
                const previousAttemptCount = previous?.attemptCount || 0;
                const requestedGeneration = Math.max(0, Number(input.generation) || 0);
                if (previous && requestedGeneration < previous.generation) {
                    // 旧 runner 的 finally/catch 不得覆盖已入队的新代次，也不得复活失效墓碑。
                    nextRecord = previous;
                    return;
                }
                const nextStatus = normalizeFlushTaskStatus_ACU(input.status);
                nextRecord = {
                    scopeKey,
                    chatKey,
                    isolationKey,
                    sourceTableKey,
                    ...(Number.isFinite(Number(input.targetMessageIndex)) ? { targetMessageIndex: Number(input.targetMessageIndex) } : previous?.targetMessageIndex != null ? { targetMessageIndex: previous.targetMessageIndex } : {}),
                    generation: Math.max(previous?.generation || 0, requestedGeneration),
                    mode: normalizeFlushTaskMode_ACU(input.mode),
                    status: nextStatus,
                    requestedAt: Math.max(0, Number(input.requestedAt ?? previous?.requestedAt ?? now) || now),
                    debounceUntil: Math.max(0, Number(input.debounceUntil ?? previous?.debounceUntil ?? now) || now),
                    attemptCount: nextStatus === 'flushing' ? previousAttemptCount + 1 : previousAttemptCount,
                    ...(nextStatus === 'flushing' ? { lastAttemptAt: now } : previous?.lastAttemptAt ? { lastAttemptAt: previous.lastAttemptAt } : {}),
                    ...(nextStatus === 'ready' ? { lastSuccessAt: now } : previous?.lastSuccessAt ? { lastSuccessAt: previous.lastSuccessAt } : {}),
                    ...(input.lastError ? { lastError: String(input.lastError) } : nextStatus === 'ready' ? {} : previous?.lastError ? { lastError: previous.lastError } : {}),
                    updatedAt: now,
                };
                store.put(nextRecord);
            };
            getRequest.onerror = () => reject(getRequest.error || new Error('读取交火向量 flush task 失败'));
            tx.oncomplete = () => {
                db.close();
                resolve(nextRecord ? cloneFlushTask_ACU(nextRecord) : null);
            };
            tx.onerror = () => {
                db.close();
                reject(tx.error || new Error('写入交火向量 flush task 事务失败'));
            };
        });
    } catch {
        return null;
    }
}

export async function invalidateSummaryVectorFlushTaskStrict_ACU(input: {
    scopeKey: string;
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
}): Promise<SummaryVectorIndexFlushTaskRecord_ACU> {
    const scopeKey = normalizeKeyPart_ACU(input.scopeKey);
    const chatKey = normalizeKeyPart_ACU(input.chatKey);
    const isolationKey = normalizeSummaryVectorIsolationKey_ACU(input.isolationKey);
    const sourceTableKey = normalizeKeyPart_ACU(input.sourceTableKey);
    if (!scopeKey || !chatKey || !sourceTableKey) {
        throw new Error('持久化交火向量 flush 失效墓碑失败：scope 不完整');
    }
    const db = await openDb_ACU();
    const record = await new Promise<SummaryVectorIndexFlushTaskRecord_ACU>((resolve, reject) => {
        const tx = db.transaction(FLUSH_TASK_STORE_NAME_ACU, 'readwrite');
        const store = tx.objectStore(FLUSH_TASK_STORE_NAME_ACU);
        const request = store.get(scopeKey) as IDBRequest<SummaryVectorIndexFlushTaskRecord_ACU | undefined>;
        let nextRecord: SummaryVectorIndexFlushTaskRecord_ACU | null = null;
        request.onsuccess = () => {
            const previous = request.result ? cloneFlushTask_ACU(request.result) : null;
            const now = Date.now();
            nextRecord = {
                scopeKey,
                chatKey,
                isolationKey,
                sourceTableKey,
                ...(previous?.targetMessageIndex != null ? { targetMessageIndex: previous.targetMessageIndex } : {}),
                generation: (previous?.generation || 0) + 1,
                mode: previous?.mode || 'sync',
                status: 'invalidated',
                requestedAt: previous?.requestedAt || now,
                debounceUntil: previous?.debounceUntil || now,
                attemptCount: previous?.attemptCount || 0,
                ...(previous?.lastAttemptAt ? { lastAttemptAt: previous.lastAttemptAt } : {}),
                ...(previous?.lastSuccessAt ? { lastSuccessAt: previous.lastSuccessAt } : {}),
                lastError: 'flush_scope_invalidated',
                updatedAt: now,
            };
            store.put(nextRecord);
        };
        request.onerror = () => reject(request.error || new Error('读取交火向量 flush task 以写入失效墓碑失败'));
        tx.oncomplete = () => {
            db.close();
            if (!nextRecord) reject(new Error('持久化交火向量 flush 失效墓碑失败：记录未生成'));
            else resolve(cloneFlushTask_ACU(nextRecord));
        };
        tx.onerror = () => { db.close(); reject(tx.error || new Error('持久化交火向量 flush 失效墓碑事务失败')); };
        tx.onabort = () => { db.close(); reject(tx.error || new Error('持久化交火向量 flush 失效墓碑事务已中止')); };
    });
    const verified = await getSummaryVectorFlushTaskStrict_ACU(scopeKey);
    if (!verified || verified.status !== 'invalidated' || verified.generation !== record.generation) {
        throw new Error(`持久化交火向量 flush 失效墓碑后校验失败：scope=${scopeKey}`);
    }
    return verified;
}

export async function assertSummaryVectorFlushGenerationCurrent_ACU(scopeKey: string, expectedGeneration: number): Promise<void> {
    const task = await getSummaryVectorFlushTaskStrict_ACU(scopeKey);
    if (!task || task.status !== 'flushing' || task.generation !== expectedGeneration) {
        throw new SummaryVectorFlushGenerationInvalidatedError_ACU(scopeKey, expectedGeneration, task?.generation);
    }
}

export class SummaryVectorFlushGenerationInvalidatedError_ACU extends Error {
    constructor(public readonly scopeKey: string, public readonly expectedGeneration: number, public readonly actualGeneration?: number) {
        super(`交火向量 flush 代次已失效：scope=${scopeKey}, expected=${expectedGeneration}, actual=${actualGeneration ?? 'missing'}`);
        this.name = 'SummaryVectorFlushGenerationInvalidatedError_ACU';
    }
}

export type SummaryVectorFlushTaskLegacyReconciliationOutcome_ACU =
    | 'migrated'
    | 'canonical_retained'
    | 'legacy_retained'
    | 'quarantined'
    | 'not_found';

export interface SummaryVectorFlushTaskLegacyReconciliationResult_ACU {
    outcome: SummaryVectorFlushTaskLegacyReconciliationOutcome_ACU;
    task: SummaryVectorIndexFlushTaskRecord_ACU | null;
}

function getFlushTaskReconciliationPriority_ACU(task: SummaryVectorIndexFlushTaskRecord_ACU): number {
    // 同 generation 下，未完成状态优先，避免把仍待归档的 dirty state 静默输给 ready 记录。
    if (task.status === 'flushing') return 6;
    if (task.status === 'queued') return 5;
    if (task.status === 'dirty') return 4;
    if (task.status === 'failed_retryable') return 3;
    if (task.status === 'invalidated') return 2;
    if (task.status === 'ready') return 1;
    return 0;
}

/**
 * 将历史空 isolation task 一次性归并到 canonical scope。整个裁决在同一 IndexedDB
 * 事务内完成，避免“先复制再删除”在崩溃窗口中丢失仍待持久化的 dirty state。
 */
export async function reconcileLegacySummaryVectorFlushTaskStrict_ACU(input: {
    legacyScopeKey: string;
    canonicalScopeKey: string;
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
}): Promise<SummaryVectorFlushTaskLegacyReconciliationResult_ACU> {
    const legacyScopeKey = normalizeKeyPart_ACU(input.legacyScopeKey);
    const canonicalScopeKey = normalizeKeyPart_ACU(input.canonicalScopeKey);
    const chatKey = normalizeKeyPart_ACU(input.chatKey);
    const isolationKey = normalizeSummaryVectorIsolationKey_ACU(input.isolationKey);
    const sourceTableKey = normalizeKeyPart_ACU(input.sourceTableKey);
    if (!legacyScopeKey || !canonicalScopeKey || !chatKey || !sourceTableKey) {
        throw new Error('迁移旧版交火向量 flush task 失败：scope 不完整');
    }
    if (legacyScopeKey === canonicalScopeKey) {
        const db = await openDb_ACU();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(FLUSH_TASK_STORE_NAME_ACU, 'readwrite');
            const store = tx.objectStore(FLUSH_TASK_STORE_NAME_ACU);
            const request = store.get(canonicalScopeKey) as IDBRequest<SummaryVectorIndexFlushTaskRecord_ACU | undefined>;
            let result: SummaryVectorFlushTaskLegacyReconciliationResult_ACU = { outcome: 'not_found', task: null };
            request.onsuccess = () => {
                const existing = request.result ? cloneFlushTask_ACU(request.result) : null;
                if (!existing) return;
                const migrated = { ...existing, scopeKey: canonicalScopeKey, chatKey, isolationKey, sourceTableKey };
                store.put(migrated);
                result = {
                    outcome: String(existing.isolationKey || '').trim() ? 'canonical_retained' : 'migrated',
                    task: migrated,
                };
            };
            request.onerror = () => reject(request.error || new Error('读取同 key 旧版交火向量 flush task 失败'));
            tx.oncomplete = () => { db.close(); resolve(result); };
            tx.onerror = () => { db.close(); reject(tx.error || new Error('迁移同 key 旧版交火向量 flush task 事务失败')); };
            tx.onabort = () => { db.close(); reject(tx.error || new Error('迁移同 key 旧版交火向量 flush task 事务已中止')); };
        });
    }

    const db = await openDb_ACU();
    return await new Promise((resolve, reject) => {
        const tx = db.transaction(FLUSH_TASK_STORE_NAME_ACU, 'readwrite');
        const store = tx.objectStore(FLUSH_TASK_STORE_NAME_ACU);
        const legacyRequest = store.get(legacyScopeKey) as IDBRequest<SummaryVectorIndexFlushTaskRecord_ACU | undefined>;
        const canonicalRequest = store.get(canonicalScopeKey) as IDBRequest<SummaryVectorIndexFlushTaskRecord_ACU | undefined>;
        let legacy: SummaryVectorIndexFlushTaskRecord_ACU | null = null;
        let canonical: SummaryVectorIndexFlushTaskRecord_ACU | null = null;
        let result: SummaryVectorFlushTaskLegacyReconciliationResult_ACU | null = null;
        let processed = false;
        let legacyLoaded = false;
        let canonicalLoaded = false;
        const process = () => {
            if (processed || !legacyLoaded || !canonicalLoaded) return;
            processed = true;
            legacy = legacyRequest.result ? cloneFlushTask_ACU(legacyRequest.result) : null;
            canonical = canonicalRequest.result ? cloneFlushTask_ACU(canonicalRequest.result) : null;
            if (!legacy) {
                result = { outcome: canonical ? 'canonical_retained' : 'not_found', task: canonical };
                return;
            }
            if (!canonical) {
                const migrated = { ...legacy, scopeKey: canonicalScopeKey, chatKey, isolationKey, sourceTableKey };
                store.put(migrated);
                store.delete(legacyScopeKey);
                result = { outcome: 'migrated', task: migrated };
                return;
            }
            if (legacy.status === 'flushing' && canonical.status === 'flushing') {
                const error = 'flush_legacy_scope_conflict_quarantined';
                const quarantinedLegacy = { ...legacy, status: 'failed_terminal' as const, lastError: error, updatedAt: Date.now() };
                const quarantinedCanonical = { ...canonical, status: 'failed_terminal' as const, lastError: error, updatedAt: Date.now() };
                store.put(quarantinedLegacy);
                store.put(quarantinedCanonical);
                result = { outcome: 'quarantined', task: quarantinedCanonical };
                return;
            }
            const legacyWins = legacy.generation > canonical.generation
                || (legacy.generation === canonical.generation && (
                    getFlushTaskReconciliationPriority_ACU(legacy) > getFlushTaskReconciliationPriority_ACU(canonical)
                    || (getFlushTaskReconciliationPriority_ACU(legacy) === getFlushTaskReconciliationPriority_ACU(canonical)
                        && legacy.updatedAt > canonical.updatedAt)
                ));
            if (legacyWins) {
                const migrated = { ...legacy, scopeKey: canonicalScopeKey, chatKey, isolationKey, sourceTableKey };
                store.put(migrated);
                store.delete(legacyScopeKey);
                result = { outcome: 'legacy_retained', task: migrated };
            } else {
                store.delete(legacyScopeKey);
                result = { outcome: 'canonical_retained', task: canonical };
            }
        };
        legacyRequest.onsuccess = () => {
            legacyLoaded = true;
            process();
        };
        canonicalRequest.onsuccess = () => {
            canonicalLoaded = true;
            process();
        };
        legacyRequest.onerror = () => reject(legacyRequest.error || new Error('读取旧版交火向量 flush task 失败'));
        canonicalRequest.onerror = () => reject(canonicalRequest.error || new Error('读取 canonical 交火向量 flush task 失败'));
        tx.oncomplete = () => {
            db.close();
            resolve(result || { outcome: 'not_found', task: null });
        };
        tx.onerror = () => { db.close(); reject(tx.error || new Error('迁移旧版交火向量 flush task 事务失败')); };
        tx.onabort = () => { db.close(); reject(tx.error || new Error('迁移旧版交火向量 flush task 事务已中止')); };
    });
}

export async function getSummaryVectorFlushTaskStrict_ACU(scopeKey: string): Promise<SummaryVectorIndexFlushTaskRecord_ACU | null> {
    const normalizedScopeKey = normalizeKeyPart_ACU(scopeKey);
    if (!normalizedScopeKey) throw new Error('读取交火向量 flush task 失败：scopeKey 为空');
    const db = await openDb_ACU();
    return await new Promise((resolve, reject) => {
        const tx = db.transaction(FLUSH_TASK_STORE_NAME_ACU, 'readonly');
        const store = tx.objectStore(FLUSH_TASK_STORE_NAME_ACU);
        const request = store.get(normalizedScopeKey) as IDBRequest<SummaryVectorIndexFlushTaskRecord_ACU | undefined>;
        let result: SummaryVectorIndexFlushTaskRecord_ACU | null = null;
        request.onsuccess = () => { result = request.result ? cloneFlushTask_ACU(request.result) : null; };
        request.onerror = () => reject(request.error || new Error('读取交火向量 flush task 失败'));
        tx.oncomplete = () => {
            db.close();
            resolve(result);
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error || new Error('读取交火向量 flush task 事务失败'));
        };
        tx.onabort = () => {
            db.close();
            reject(tx.error || new Error('读取交火向量 flush task 事务已中止'));
        };
    });
}

export async function getSummaryVectorFlushTask_ACU(scopeKey: string): Promise<SummaryVectorIndexFlushTaskRecord_ACU | null> {
    try {
        return await getSummaryVectorFlushTaskStrict_ACU(scopeKey);
    } catch {
        return null;
    }
}

export async function listSummaryVectorFlushTasks_ACU(scope?: VectorIndexHotCacheScope_ACU): Promise<SummaryVectorIndexFlushTaskRecord_ACU[]> {
    try {
        const chatKey = normalizeKeyPart_ACU(scope?.chatKey);
        const isolationKey = scope?.isolationKey == null ? '' : normalizeSummaryVectorIsolationKey_ACU(scope.isolationKey);
        const sourceTableKey = normalizeKeyPart_ACU(scope?.sourceTableKey);
        const db = await openDb_ACU();
        return await new Promise((resolve, reject) => {
            const records: SummaryVectorIndexFlushTaskRecord_ACU[] = [];
            const tx = db.transaction(FLUSH_TASK_STORE_NAME_ACU, 'readonly');
            const store = tx.objectStore(FLUSH_TASK_STORE_NAME_ACU);
            const request = store.openCursor();
            request.onsuccess = () => {
                const cursor = request.result;
                if (cursor) {
                    const record = cloneFlushTask_ACU(cursor.value as SummaryVectorIndexFlushTaskRecord_ACU);
                    const recordIsolationKey = normalizeSummaryVectorIsolationKey_ACU(record.isolationKey);
                    const matches = (!chatKey || record.chatKey === chatKey)
                        // 旧的空 isolation task 属于 canonical default scope，必须被列出后迁移，
                        // 不能因过滤条件而永久藏在 IndexedDB 中。
                        && (!isolationKey || recordIsolationKey === isolationKey)
                        && (!sourceTableKey || record.sourceTableKey === sourceTableKey);
                    if (matches) records.push(record);
                    cursor.continue();
                }
            };
            request.onerror = () => reject(request.error || new Error('列出交火向量 flush task 失败'));
            tx.oncomplete = () => {
                db.close();
                resolve(records.sort((left, right) => left.debounceUntil - right.debounceUntil || left.scopeKey.localeCompare(right.scopeKey)));
            };
            tx.onerror = () => {
                db.close();
                reject(tx.error || new Error('列出交火向量 flush task 事务失败'));
            };
        });
    } catch {
        return [];
    }
}

export async function deleteSummaryVectorFlushTaskStrict_ACU(scopeKey: string): Promise<void> {
    const normalizedScopeKey = normalizeKeyPart_ACU(scopeKey);
    if (!normalizedScopeKey) throw new Error('删除交火向量 flush task 失败：scopeKey 为空');
    const db = await openDb_ACU();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(FLUSH_TASK_STORE_NAME_ACU, 'readwrite');
        const store = tx.objectStore(FLUSH_TASK_STORE_NAME_ACU);
        const request = store.delete(normalizedScopeKey);
        request.onerror = () => reject(request.error || new Error('删除交火向量 flush task 失败'));
        tx.oncomplete = () => {
            db.close();
            resolve();
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error || new Error('删除交火向量 flush task 事务失败'));
        };
        tx.onabort = () => {
            db.close();
            reject(tx.error || new Error('删除交火向量 flush task 事务已中止'));
        };
    });
    if (await getSummaryVectorFlushTaskStrict_ACU(normalizedScopeKey)) {
        throw new Error(`删除交火向量 flush task 后校验失败：scope=${normalizedScopeKey}`);
    }
}

/**
 * 仅将仍属于指定 generation 且处于 flushing 的任务标记为 ready。
 * 不删除记录，避免旧 runner 删除 generation 历史后让并发 enqueue 发生 ABA 回退。
 */
export async function markSummaryVectorFlushTaskReadyIfGenerationMatchesStrict_ACU(scopeKey: string, expectedGeneration: number): Promise<boolean> {
    const normalizedScopeKey = normalizeKeyPart_ACU(scopeKey);
    const normalizedGeneration = Math.max(0, Number(expectedGeneration) || 0);
    if (!normalizedScopeKey) throw new Error('按代次完成交火向量 flush task 失败：scopeKey 为空');
    const db = await openDb_ACU();
    const completed = await new Promise<boolean>((resolve, reject) => {
        const tx = db.transaction(FLUSH_TASK_STORE_NAME_ACU, 'readwrite');
        const store = tx.objectStore(FLUSH_TASK_STORE_NAME_ACU);
        const getRequest = store.get(normalizedScopeKey) as IDBRequest<SummaryVectorIndexFlushTaskRecord_ACU | undefined>;
        let shouldComplete = false;
        getRequest.onsuccess = () => {
            const current = getRequest.result ? cloneFlushTask_ACU(getRequest.result) : null;
            shouldComplete = !!current
                && current.generation === normalizedGeneration
                && current.status === 'flushing';
            if (shouldComplete && current) {
                const now = Date.now();
                store.put({
                    ...current,
                    status: 'ready',
                    lastSuccessAt: now,
                    updatedAt: now,
                });
            }
        };
        getRequest.onerror = () => reject(getRequest.error || new Error('按代次完成交火向量 flush task 读取失败'));
        tx.oncomplete = () => {
            db.close();
            resolve(shouldComplete);
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error || new Error('按代次完成交火向量 flush task 事务失败'));
        };
        tx.onabort = () => {
            db.close();
            reject(tx.error || new Error('按代次完成交火向量 flush task 事务已中止'));
        };
    });
    const verified = await getSummaryVectorFlushTaskStrict_ACU(normalizedScopeKey);
    if (completed && (!verified || verified.generation !== normalizedGeneration || verified.status !== 'ready')) {
        throw new Error(`按代次完成交火向量 flush task 后校验失败：scope=${normalizedScopeKey}`);
    }
    return completed;
}

export async function deleteSummaryVectorFlushTask_ACU(scopeKey: string): Promise<void> {
    try {
        await deleteSummaryVectorFlushTaskStrict_ACU(scopeKey);
    } catch {}
}

export async function clearSummaryVectorFlushTasksByScope_ACU(scope: VectorIndexHotCacheScope_ACU): Promise<void> {
    const tasks = await listSummaryVectorFlushTasks_ACU(scope);
    for (const task of tasks) {
        await deleteSummaryVectorFlushTask_ACU(task.scopeKey);
    }
}

export async function estimateSummaryVectorFlushTasks_ACU(scope?: VectorIndexHotCacheScope_ACU): Promise<SummaryVectorIndexFlushTaskEstimate_ACU> {
    const tasks = await listSummaryVectorFlushTasks_ACU(scope);
    const estimate: SummaryVectorIndexFlushTaskEstimate_ACU = {
        total: tasks.length,
        dirty: 0,
        queued: 0,
        flushing: 0,
        ready: 0,
        failedRetryable: 0,
        failedTerminal: 0,
    };
    tasks.forEach((task) => {
        if (task.status === 'dirty') estimate.dirty += 1;
        else if (task.status === 'queued') estimate.queued += 1;
        else if (task.status === 'flushing') estimate.flushing += 1;
        else if (task.status === 'ready') estimate.ready += 1;
        else if (task.status === 'failed_retryable') estimate.failedRetryable += 1;
        else if (task.status === 'failed_terminal') estimate.failedTerminal += 1;
        if (task.lastError) estimate.lastError = task.lastError;
    });
    return estimate;
}
