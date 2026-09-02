import { getChatArray_ACU } from '../chat/chat-service';
import { getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import { readIsolatedDataContainer_ACU, readIsolatedTagData_ACU } from '../../data/repositories/chat-message-data-repo';
import type { IsolationTagData_ACU } from '../../data/models/chat-message-data';
import type {
    ChatSummaryVectorIndexChunk_ACU,
    ChatSummaryVectorIndexManifest_ACU,
    ChatSummaryVectorIndexRow_ACU,
    ChatSummaryVectorIndexState_ACU,
    SummaryVectorIndexAggregatedSnapshot_ACU,
    SummaryVectorIndexSnapshotLayer_ACU,
} from './summary-vector-index-types';

function cloneJson_ACU<T>(value: T): T {
    if (value == null) return value;
    try {
        return JSON.parse(JSON.stringify(value)) as T;
    } catch {
        return value;
    }
}

function normalizeRows_ACU(rows: any): ChatSummaryVectorIndexRow_ACU[] {
    if (!Array.isArray(rows)) return [];
    return rows.filter((row) => row && typeof row === 'object' && typeof row.rowKey === 'string')
        .map((row) => ({
            rowKey: String(row.rowKey),
            rowId: String(row.rowId || ''),
            rowOrder: Number.isFinite(Number(row.rowOrder)) ? Number(row.rowOrder) : 0,
            timeSpan: String(row.timeSpan || ''),
            location: String(row.location || ''),
            summary: String(row.summary || ''),
            indexCode: String(row.indexCode || ''),
            vectorSourceText: String(row.vectorSourceText || ''),
            ...(typeof row.vectorSourceHash === 'string' && row.vectorSourceHash ? { vectorSourceHash: row.vectorSourceHash } : {}),
            chunkIds: Array.isArray(row.chunkIds) ? row.chunkIds.map((item: any) => String(item)) : [],
            sourceFingerprint: typeof row.sourceFingerprint === 'string' ? row.sourceFingerprint : undefined,
            shardIds: Array.isArray(row.shardIds) ? row.shardIds.map((item: any) => String(item)) : undefined,
            chunkKeys: Array.isArray(row.chunkKeys) ? row.chunkKeys.map((item: any) => String(item)) : undefined,
            status: row.status === 'removed' || row.status === 'replaced' ? row.status : 'active',
            updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : undefined,
        }));
}

function normalizeChunks_ACU(chunks: any): ChatSummaryVectorIndexChunk_ACU[] {
    if (!Array.isArray(chunks)) return [];
    return chunks.filter((chunk) => chunk && typeof chunk === 'object' && typeof chunk.chunkId === 'string')
        .map((chunk): ChatSummaryVectorIndexChunk_ACU => {
            const shardRole: ChatSummaryVectorIndexChunk_ACU['shardRole'] = chunk.shardRole === 'delta'
                ? 'delta'
                : chunk.shardRole === 'base'
                    ? 'base'
                    : undefined;
            return {
                chunkId: String(chunk.chunkId),
                rowKey: String(chunk.rowKey || ''),
                rowOrder: Number.isFinite(Number(chunk.rowOrder)) ? Number(chunk.rowOrder) : 0,
                text: String(chunk.text || ''),
                // 统一归一为普通 number[]：state.chunks 会随聊天元数据 JSON 序列化，
                // 不能把 Float32Array 落进持久化路径。
                vector: Array.isArray(chunk.vector) || chunk.vector instanceof Float32Array
                    ? Array.from(chunk.vector as any, (item: any) => Number(item)).filter((item: number) => Number.isFinite(item))
                    : [],
                sequence: Number.isFinite(Number(chunk.sequence)) ? Number(chunk.sequence) : 0,
                sourceFingerprint: typeof chunk.sourceFingerprint === 'string' ? chunk.sourceFingerprint : undefined,
                textHash: typeof chunk.textHash === 'string' ? chunk.textHash : undefined,
                shardId: typeof chunk.shardId === 'string' ? chunk.shardId : undefined,
                shardRole,
                chunkKeys: Array.isArray(chunk.chunkKeys) ? chunk.chunkKeys.map((item: any) => String(item)) : undefined,
            };
        })
        .filter((chunk) => chunk.rowKey && chunk.text);
}

export function cloneSummaryVectorIndexState_ACU(state: any): ChatSummaryVectorIndexState_ACU | null {
    if (!state || typeof state !== 'object') return null;
    const rows = normalizeRows_ACU(state.rows);
    const chunks = normalizeChunks_ACU(state.chunks);
    const manifest = state.manifest && typeof state.manifest === 'object'
        ? cloneJson_ACU(state.manifest as ChatSummaryVectorIndexManifest_ACU)
        : undefined;
    if (rows.length === 0 && !manifest) return null;
    return {
        version: Number.isFinite(Number(state.version)) ? Number(state.version) : 1,
        backend: state.backend === 'st-files' ? 'st-files' : state.backend === 'embedded' ? 'embedded' : manifest ? 'st-files' : 'embedded',
        status: state.status || manifest?.status || 'ready',
        indexId: typeof state.indexId === 'string' ? state.indexId : manifest?.indexId,
        snapshotMessageId: String(state.snapshotMessageId || manifest?.snapshotMessageId || ''),
        sourceTableKey: String(state.sourceTableKey || manifest?.sourceTableKey || ''),
        sourceTableName: String(state.sourceTableName || manifest?.sourceTableName || ''),
        indexedAt: String(state.indexedAt || manifest?.indexedAt || new Date().toISOString()),
        rowCount: Number.isFinite(Number(state.rowCount)) ? Number(state.rowCount) : rows.length,
        chunkCount: Number.isFinite(Number(state.chunkCount)) ? Number(state.chunkCount) : chunks.length,
        skippedRowCount: Number.isFinite(Number(state.skippedRowCount)) ? Number(state.skippedRowCount) : 0,
        rows,
        ...(chunks.length > 0 ? { chunks } : {}),
        ...(manifest ? { manifest } : {}),
    };
}

export function assignSummaryVectorIndexStateToTagData_ACU(
    tagData: IsolationTagData_ACU & Record<string, any>,
    state: ChatSummaryVectorIndexState_ACU | null,
    manifest?: ChatSummaryVectorIndexManifest_ACU | null,
): void {
    if (!tagData || typeof tagData !== 'object') return;
    if (!state) {
        delete tagData.summaryVectorIndexState;
        delete tagData.summaryVectorIndexManifest;
        return;
    }
    const nextState = cloneSummaryVectorIndexState_ACU(state) || state;
    if (manifest) {
        nextState.backend = 'st-files';
        nextState.status = manifest.status;
        nextState.indexId = manifest.indexId;
        nextState.manifest = cloneJson_ACU(manifest);
        delete nextState.chunks;
        tagData.summaryVectorIndexManifest = cloneJson_ACU(manifest);
    } else if (nextState.manifest) {
        nextState.backend = 'st-files';
        delete nextState.chunks;
        tagData.summaryVectorIndexManifest = cloneJson_ACU(nextState.manifest);
    } else {
        tagData.summaryVectorIndexManifest = null;
    }
    tagData.summaryVectorIndexState = nextState;
}

export function readSummaryVectorIndexStateFromTagData_ACU(tagData: IsolationTagData_ACU | null): ChatSummaryVectorIndexState_ACU | null {
    if (!tagData) return null;
    const state = cloneSummaryVectorIndexState_ACU(tagData.summaryVectorIndexState);
    const manifest = tagData.summaryVectorIndexManifest;
    if (state && manifest && !state.manifest) {
        state.manifest = cloneJson_ACU(manifest);
        state.backend = 'st-files';
        state.status = manifest.status;
        state.indexId = manifest.indexId;
    }
    if (!state && manifest) {
        return {
            version: 1,
            backend: 'st-files',
            status: manifest.status,
            indexId: manifest.indexId,
            snapshotMessageId: manifest.snapshotMessageId,
            sourceTableKey: manifest.sourceTableKey,
            sourceTableName: manifest.sourceTableName,
            indexedAt: manifest.indexedAt,
            rowCount: manifest.rowCount,
            chunkCount: manifest.chunkCount,
            skippedRowCount: manifest.skippedRowCount,
            rows: [],
            manifest: cloneJson_ACU(manifest),
        };
    }
    return state;
}

/**
 * 枚举聊天中全部 tag slot 的向量索引层。
 *
 * 这里返回的是聊天槽位 isolationKey（默认槽可能是空字符串），而 manifest 内
 * isolationKey 是外置存储 canonical scope（默认值为 default）。两者不得混用。
 */
export function getAllSummaryVectorIndexSnapshotLayers_ACU(): SummaryVectorIndexSnapshotLayer_ACU[] {
    const chat = getChatArray_ACU();
    if (!Array.isArray(chat) || chat.length === 0) return [];
    const layers: SummaryVectorIndexSnapshotLayer_ACU[] = [];
    chat.forEach((message: any, messageIndex: number): void => {
        if (!message || message.is_user) return;
        const isolatedData = readIsolatedDataContainer_ACU(message);
        if (!isolatedData) return;
        Object.entries(isolatedData).forEach(([isolationKey, tagData]) => {
            const state = readSummaryVectorIndexStateFromTagData_ACU(tagData);
            if (!state) return;
            layers.push({ messageIndex, isolationKey, summaryVectorIndexState: state, tagData });
        });
    });
    return layers;
}

export function getAggregatedSummaryVectorIndexSnapshot_ACU(): SummaryVectorIndexAggregatedSnapshot_ACU | null {
    const chat = getChatArray_ACU();
    if (!Array.isArray(chat) || chat.length === 0) return null;
    const isolationKey = getCurrentIsolationKey_ACU();
    const layers: SummaryVectorIndexSnapshotLayer_ACU[] = [];
    const rowOwners = new Map<string, { messageIndex: number; row: ChatSummaryVectorIndexRow_ACU }>();
    const mergedRows = new Map<string, ChatSummaryVectorIndexRow_ACU>();
    const mergedChunks = new Map<string, ChatSummaryVectorIndexChunk_ACU>();
    let latestState: ChatSummaryVectorIndexState_ACU | null = null;

    chat.forEach((message: any, messageIndex: number): void => {
        if (!message || message.is_user) return;
        const tagData = readIsolatedTagData_ACU(message, isolationKey);
        const state = readSummaryVectorIndexStateFromTagData_ACU(tagData);
        if (!state) return;
        layers.push({ messageIndex, isolationKey, summaryVectorIndexState: state, tagData });
        latestState = state;
        state.rows.forEach((row) => {
            if (row.status === 'removed') {
                mergedRows.delete(row.rowKey);
                rowOwners.delete(row.rowKey);
                return;
            }
            mergedRows.set(row.rowKey, row);
            rowOwners.set(row.rowKey, { messageIndex, row });
        });
        (state.chunks || []).forEach((chunk) => mergedChunks.set(chunk.chunkId, chunk));
    });

    if (layers.length === 0 || !latestState) return null;
    const rows = Array.from(mergedRows.values());
    const chunks = Array.from(mergedChunks.values()).filter((chunk) => mergedRows.has(chunk.rowKey));
    const summaryVectorIndexState: ChatSummaryVectorIndexState_ACU = {
        ...latestState,
        rows,
        ...(chunks.length > 0 ? { chunks } : {}),
        rowCount: rows.length || latestState.rowCount,
        chunkCount: chunks.length || latestState.chunkCount,
    };
    return { summaryVectorIndexState, layers, rowOwners };
}

export function getLatestSummaryVectorIndexSnapshotState_ACU(): SummaryVectorIndexAggregatedSnapshot_ACU | null {
    const chat = getChatArray_ACU();
    if (!Array.isArray(chat) || chat.length === 0) return null;
    const isolationKey = getCurrentIsolationKey_ACU();
    for (let messageIndex = chat.length - 1; messageIndex >= 0; messageIndex -= 1) {
        const message = chat[messageIndex];
        if (!message || message.is_user) continue;
        const tagData = readIsolatedTagData_ACU(message, isolationKey);
        const state = readSummaryVectorIndexStateFromTagData_ACU(tagData);
        if (!state) continue;
        const activeRowKeys = new Set(state.manifest?.snapshot?.activeRowKeys || []);
        const rows = activeRowKeys.size > 0
            ? state.rows.filter((row) => activeRowKeys.has(row.rowKey) && row.status !== 'removed')
            : state.rows.filter((row) => row.status !== 'removed');
        const summaryVectorIndexState: ChatSummaryVectorIndexState_ACU = {
            ...state,
            rows,
            rowCount: rows.length || state.rowCount,
        };
        const rowOwners = new Map<string, { messageIndex: number; row: ChatSummaryVectorIndexRow_ACU }>();
        rows.forEach((row) => rowOwners.set(row.rowKey, { messageIndex, row }));
        return {
            summaryVectorIndexState,
            layers: [{ messageIndex, isolationKey, summaryVectorIndexState, tagData }],
            rowOwners,
        };
    }
    return null;
}
