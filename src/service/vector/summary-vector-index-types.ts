import type { IsolationTagData_ACU } from '../../data/models/chat-message-data';
import type { SummaryVectorIndexCanonicalScope_ACU } from '../../shared/summary-vector-index-scope';

export type SummaryVectorIndexBackend_ACU = 'embedded' | 'st-files';

export type SummaryVectorIndexManifestStatus_ACU =
    | 'building'
    | 'uploading'
    | 'ready'
    | 'missing'
    | 'corrupt'
    | 'incompatible'
    | 'upload_failed'
    | 'rebuild_required'
    | 'delete_pending'
    | 'delete_failed'
    | 'superseded';

export type SummaryVectorIndexExternalFileRole_ACU =
    | 'manifest'
    | 'row_index'
    | 'tombstone'
    | 'base_shard'
    | 'delta_shard'
    | 'vector_chunk'
    | 'vector_pack'
    | 'registry';

export interface ChatSummaryVectorIndexChunk_ACU {
    chunkId: string;
    rowKey: string;
    rowOrder: number;
    text: string;
    /**
     * 内存表示以 Float32Array 为主（解码路径）；兼容旧 number[]（IDB 缓存、聊天元数据回读）。
     * 磁盘格式（f32b64 字符串 / legacy number[]）保持不变。
     */
    vector: Float32Array | number[];
    sequence: number;
    sourceFingerprint?: string;
    textHash?: string;
    shardId?: string;
    shardRole?: 'base' | 'delta';
    chunkKeys?: string[];
}

export interface SummaryVectorIndexChunkRef_ACU {
    chunkKey: string;
    chunkId: string;
    rowKey: string;
    /**
     * 兼容字段：旧 content_addressed_chunks 下指向单 chunk 文件；
     * content_addressed_packs 下指向所属 pack 文件，不表示 chunk 级文件。
     */
    path: string;
    /** chunk blob 级校验值，不得替换为 pack 文件级 checksum。 */
    checksum: string;
    /** chunk blob 级大小，不得替换为 pack 文件大小。 */
    byteSize: number;
    embeddingModel: string;
    dimension: number;
    sourceFingerprint?: string;
    textHash?: string;
    packKey?: string;
    packPath?: string;
    createdAt: string;
    updatedAt: string;
    status: SummaryVectorIndexManifestStatus_ACU;
}

export interface SummaryVectorIndexPackRef_ACU {
    packKey: string;
    /** P4 新协议：pack 所属 canonical scope（V2 scope token），旧 ref 缺省。 */
    packScope?: string;
    /** P4 新协议：pack schema 版本，旧 ref 缺省。 */
    schemaVersion?: number;
    path: string;
    checksum: string;
    byteSize: number;
    chunkKeys: string[];
    chunkCount: number;
    rowCount: number;
    embeddingModel: string;
    dimension: number;
    createdAt: string;
    updatedAt: string;
    status: SummaryVectorIndexManifestStatus_ACU;
}

export interface SummaryVectorIndexContentAddressedInfo_ACU {
    version: number;
    mode: 'content_addressed_chunks' | 'content_addressed_packs';
    chunkRefs: SummaryVectorIndexChunkRef_ACU[];
    activeChunkKeys: string[];
    packRefs?: SummaryVectorIndexPackRef_ACU[];
}

export interface SummaryVectorIndexCheckpoint_ACU {
    version: number;
    checkpointId: string;
    manifestKey: string;
    sourceTableKey: string;
    snapshotMessageId: string;
    rowCount: number;
    chunkCount: number;
    activeRowKeys: string[];
    createdAt: string;
}


/**
 * P4 内容寻址 pack 协议（T8+）。
 * 设计约束：pack 内容必须与 indexId/revision/时间戳无关，才能跨 revision 复用；
 * chunk 排序与行序由读取端从 manifest.snapshot.activeChunkIds 与 snapshot rows 复原。
 */
export const SUMMARY_VECTOR_INDEX_CONTENT_PACK_SCHEMA_ACU = 'content_addressed_vector_pack';
export const SUMMARY_VECTOR_INDEX_CONTENT_PACK_VERSION_ACU = 1;

export interface SummaryVectorIndexContentPackChunk_ACU {
    chunkKey: string;
    chunkId: string;
    rowKey: string;
    text: string;
    /** f32b64 编码字符串（非 number[]）。 */
    vector: string;
    vectorEncoding: 'f32b64';
    sourceFingerprint?: string;
    textHash?: string;
}

export interface SummaryVectorIndexContentPackBlob_ACU {
    version: number;
    schema: typeof SUMMARY_VECTOR_INDEX_CONTENT_PACK_SCHEMA_ACU;
    packKey: string;
    packScope: string;
    embeddingModel: string;
    dimension: number;
    chunks: SummaryVectorIndexContentPackChunk_ACU[];
}

export interface ChatSummaryVectorIndexRow_ACU {
    rowKey: string;
    rowId: string;
    rowOrder: number;
    timeSpan: string;
    location: string;
    summary: string;
    indexCode: string;
    /**
     * 参与 embedding 的源文本。spv9.2 起源文本含纪要正文，行落盘时只保留 vectorSourceHash，
     * 该字段写空串以免几百字正文随聊天元数据重复存储；旧索引仍带 30 字概览原文。
     */
    vectorSourceText: string;
    /** 源文本哈希（spv9.2+）。缺失即旧格式索引，需要重建。 */
    vectorSourceHash?: string;
    chunkIds: string[];
    sourceFingerprint?: string;
    shardIds?: string[];
    chunkKeys?: string[];
    status?: 'active' | 'removed' | 'replaced';
    updatedAt?: string;
}

export interface ChatSummaryVectorIndexState_ACU {
    version?: number;
    backend?: SummaryVectorIndexBackend_ACU;
    status?: SummaryVectorIndexManifestStatus_ACU;
    indexId?: string;
    snapshotMessageId: string;
    sourceTableKey: string;
    sourceTableName: string;
    indexedAt: string;
    rowCount: number;
    chunkCount: number;
    skippedRowCount: number;
    rows: ChatSummaryVectorIndexRow_ACU[];
    /**
     * 兼容旧版内嵌向量。新外置模式下聊天记录不应再写入该字段。
     */
    chunks?: ChatSummaryVectorIndexChunk_ACU[];
    manifest?: ChatSummaryVectorIndexManifest_ACU;
}

export interface SummaryVectorIndexExternalFileRef_ACU {
    role: SummaryVectorIndexExternalFileRole_ACU;
    path: string;
    /** V2 registry publication lifecycle; missing means historical entry with unknown legacy semantics. */
    publicationState?: 'prepared' | 'published';
    /**
     * 对象所属的 canonical scope。V2 路径里的 scope token 是 SHA-256 指纹、不可逆，
     * registry 条目因此成为 GC 反查"哪些文件属于哪个聊天"的唯一持久化依据。
     * 升级前的旧条目没有此字段，只能从旧版无损路径 token 反解。
     */
    scope?: SummaryVectorIndexCanonicalScope_ACU;
    shardId?: string;
    byteSize: number;
    checksum: string;
    chunkCount?: number;
    rowCount?: number;
    createdAt: string;
    updatedAt: string;
    status: SummaryVectorIndexManifestStatus_ACU;
}

export interface SummaryVectorIndexBatchRef_ACU {
    batchId: string;
    indexId: string;
    role?: 'base' | 'delta';
    baseChunkIds?: string[];
    createdAt: string;
    updatedAt: string;
    rowKeys: string[];
    chunkIds: string[];
    files: SummaryVectorIndexExternalFileRef_ACU[];
    rowCount: number;
    chunkCount: number;
    sourceMessageIndex?: number;
    sourceSnapshotMessageId?: string;
    status: SummaryVectorIndexManifestStatus_ACU;
}

export interface SummaryVectorIndexSnapshotInfo_ACU {
    revision: number;
    mode: 'snapshot' | 'single_file_snapshot' | 'base_rolling_delta';
    parentIndexIds: string[];
    activeRowKeys: string[];
    activeChunkIds?: string[];
    removedRowKeys: string[];
    replacedRowKeys: string[];
    batchIds: string[];
}

/** V2 immutable external snapshot identity. Missing means a legacy layout. */
export interface SummaryVectorIndexStorageIdentity_ACU {
    layoutVersion: 2;
    scopeFingerprint: string;
    writeGeneration: string;
    revision: number;
}

/**
 * 每个可达路径所声明的完整预期身份。
 * 这是 reachability / health / GC 的共同证据，不得在各调用点重新拼缩水字段。
 */
export interface SummaryVectorIndexExpectedFileIdentity_ACU {
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
    indexId: string;
    snapshotRevision?: number;
    storageIdentity?: SummaryVectorIndexStorageIdentity_ACU;
    embeddingModel: string;
    dimension: number;
}

export interface ChatSummaryVectorIndexManifest_ACU {
    version: number;
    backend: 'st-files';
    status: SummaryVectorIndexManifestStatus_ACU;
    indexId: string;
    chatKey: string;
    isolationKey: string;
    snapshotMessageId: string;
    sourceTableKey: string;
    sourceTableName: string;
    indexedAt: string;
    updatedAt: string;
    rowCount: number;
    chunkCount: number;
    skippedRowCount: number;
    embeddingModel: string;
    dimension: number;
    rowsFile: string;
    tombstoneFile: string;
    manifestFile: string;
    files: SummaryVectorIndexExternalFileRef_ACU[];
    baseShardCount: number;
    deltaShardCount: number;
    tombstoneRowCount: number;
    tombstoneChunkCount: number;
    externalTotalBytes: number;
    cacheTotalBytes?: number;
    lastCompactAt?: string;
    error?: string;
    /**
     * v2 快照协议：最新楼层 manifest 可引用多个批次文件，召回时按该列表拼接完整向量库。
     * 旧版 manifest 没有该字段，读取端必须回退到 files 中的 base_shard/delta_shard。
     */
    snapshot?: SummaryVectorIndexSnapshotInfo_ACU;
    storageIdentity?: SummaryVectorIndexStorageIdentity_ACU;
    batchRefs?: SummaryVectorIndexBatchRef_ACU[];
    /**
     * v3 内容寻址协议：聊天楼层保存轻量 checkpoint，manifest 保存 row -> chunkKey 引用，
     * 向量 chunk 按内容 hash 外置去重。旧版读取端忽略该字段，新版读取端优先使用该字段。
     */
    checkpoint?: SummaryVectorIndexCheckpoint_ACU;
    contentAddressed?: SummaryVectorIndexContentAddressedInfo_ACU;
}

export interface SummaryVectorIndexRowIndexEntry_ACU {
    rowKey: string;
    rowId: string;
    rowOrder: number;
    summaryKey: string;
    sourceFingerprint: string;
    indexCode: string;
    chunkIds: string[];
    shardIds: string[];
    chunkKeys?: string[];
    status: 'active' | 'removed' | 'replaced';
    updatedAt: string;
}

export interface SummaryVectorIndexRowIndex_ACU {
    version: number;
    indexId: string;
    updatedAt: string;
    rows: Record<string, SummaryVectorIndexRowIndexEntry_ACU>;
}

export interface SummaryVectorIndexTombstoneEntry_ACU {
    rowKey: string;
    chunkIds: string[];
    reason: 'row_deleted' | 'row_replaced' | 'index_deleted' | 'compact';
    removedAt: string;
}

export interface SummaryVectorIndexTombstone_ACU {
    version: number;
    indexId: string;
    updatedAt: string;
    removedRows: Record<string, SummaryVectorIndexTombstoneEntry_ACU>;
    removedChunks: Record<string, { rowKey: string; removedAt: string }>;
}

export interface SummaryVectorIndexShard_ACU {
    version: number;
    indexId: string;
    shardId: string;
    role: 'base' | 'delta';
    createdAt: string;
    updatedAt: string;
    chunks: ChatSummaryVectorIndexChunk_ACU[];
}

export interface SummaryVectorIndexRegistryFile_ACU {
    version: number;
    updatedAt: string;
    files: SummaryVectorIndexExternalFileRef_ACU[];
}

export interface SummaryVectorIndexSnapshotLayer_ACU {
    messageIndex: number;
    isolationKey: string;
    summaryVectorIndexState: ChatSummaryVectorIndexState_ACU | null;
    tagData: IsolationTagData_ACU | null;
}

export interface SummaryVectorIndexAggregatedSnapshot_ACU {
    summaryVectorIndexState: ChatSummaryVectorIndexState_ACU | null;
    layers: SummaryVectorIndexSnapshotLayer_ACU[];
    rowOwners: Map<string, { messageIndex: number; row: ChatSummaryVectorIndexRow_ACU }>;
}

export interface SummaryVectorIndexStats_ACU {
    status: SummaryVectorIndexManifestStatus_ACU | 'none';
    indexId: string;
    backend: SummaryVectorIndexBackend_ACU | 'none';
    rowCount: number;
    chunkCount: number;
    baseShardCount: number;
    deltaShardCount: number;
    tombstoneRowCount: number;
    tombstoneChunkCount: number;
    externalTotalBytes: number;
    cacheTotalBytes: number;
    tempCacheBytes?: number;
    tempCacheCount?: number;
    hotCacheBytes?: number;
    hotCacheCount?: number;
    flushTaskTotalCount?: number;
    flushTaskDirtyCount?: number;
    flushTaskQueuedCount?: number;
    flushTaskFlushingCount?: number;
    flushTaskFailedCount?: number;
    flushTaskLastError?: string;
    updatedAt: string;
    error?: string;
}

export interface SummaryVectorIndexReachableFile_ACU {
    path: string;
    role?: SummaryVectorIndexExternalFileRole_ACU;
    /**
     * 同一物理对象可能被多个聊天楼层或 tag slot 引用。首个引用仍保留在
     * messageIndex/isolationKey，完整引用集用于诊断与 purge 安全审计。
     */
    references?: Array<{ messageIndex: number; isolationKey: string }>;
    expectedIdentity: SummaryVectorIndexExpectedFileIdentity_ACU;
    manifest: ChatSummaryVectorIndexManifest_ACU;
    indexId?: string;
    messageIndex: number;
    isolationKey: string;
    sourceTableKey: string;
    manifestKey: string;
    checksum?: string;
    chunkKey?: string;
    chunkId?: string;
    rowKey?: string;
}

export interface SummaryVectorIndexReachabilityReport_ACU {
    chatKey: string;
    isolationKey?: string;
    sourceTableKey?: string;
    reachablePaths: string[];
    reachableFiles: SummaryVectorIndexReachableFile_ACU[];
    manifestCount: number;
}

export interface SummaryVectorIndexHealthIssue_ACU {
    severity: 'warning' | 'error';
    code: 'missing_file' | 'checksum_mismatch' | 'identity_mismatch' | 'path_identity_collision' | 'legacy_manifest' | 'unreachable_registered_file' | 'read_error' | 'pack_chunk_missing' | 'pack_chunk_duplicated' | 'pack_chunk_unexpected';
    path: string;
    role?: SummaryVectorIndexExternalFileRole_ACU;
    rowKey?: string;
    chunkId?: string;
    chunkKey?: string;
    messageIndex?: number;
    isolationKey?: string;
    expected?: string;
    actual?: string;
    message: string;
}

export interface SummaryVectorIndexHealthReport_ACU {
    status: 'healthy' | 'degraded' | 'missing' | 'empty';
    checkedAt: string;
    manifestCount: number;
    reachableFileCount: number;
    registeredFileCount: number;
    missingFileCount: number;
    checksumMismatchCount: number;
    identityMismatchCount: number;
    pathIdentityCollisionCount: number;
    legacyManifestCount: number;
    unreachableRegisteredFileCount: number;
    flushTaskTotalCount?: number;
    flushTaskDirtyCount?: number;
    flushTaskQueuedCount?: number;
    flushTaskFlushingCount?: number;
    flushTaskFailedCount?: number;
    flushTaskLastError?: string;
    repairableRowKeys: string[];
    issues: SummaryVectorIndexHealthIssue_ACU[];
}

export interface SummaryVectorIndexSafeGcScopeHint_ACU {
    chatKey?: string;
    isolationKey: string;
    sourceTableKey: string;
}

export interface SummaryVectorIndexSafeGcOptions_ACU {
    scopeHints?: SummaryVectorIndexSafeGcScopeHint_ACU[];
}

export interface SummaryVectorIndexSafeGcResult_ACU {
    scannedRegisteredFileCount: number;
    reachableFileCount: number;
    deletedPaths: string[];
    retainedPaths: string[];
    blockedByReachability: string[];
    failedDeletes: Array<{ path: string; error: string }>;
}

export const SUMMARY_VECTOR_INDEX_MANIFEST_VERSION_ACU = 1;
export const SUMMARY_VECTOR_INDEX_REGISTRY_PATH_ACU = 'TavernDB_ACU_vector_registry';
