/**
 * service/vector/summary-vector-mirror-rebuild.ts — 统一重建路径
 *
 * replay/checkpoint.data 取 C 时刻 rowId 集合 → pack+manifest → 写 checkpoint@C →
 * 清 C..H 旧 delta → strict save → 入队 flush 补 C..H。
 * rebuild_repair 复用当前 head 中读回校验通过的 refs；initial / rebuild_user 全量 embedding。
 */

import { createEmbeddings_ACU, isVectorEmbeddingError_ACU } from '../../data/gateways/vector-embedding-gateway';
import { saveChatToHostStrict_ACU } from '../../data/gateways/chat-gateway';
import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { currentChatFileIdentifier_ACU, getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import { isV2TagData_ACU } from '../table/storage-strategy-resolver';
import { runTableWriteTransaction_ACU } from '../table/table-write-transaction';
import { getTableDataFingerprint_ACU } from '../table/table-data-upgrade-audit';
import type {
    SummaryVectorChunkRef_ACU,
    SummaryVectorEmbeddingIdentity_ACU,
    SummaryVectorIndexMirrorCheckpointV2_ACU,
    SummaryVectorIndexMirrorFrameV2_ACU,
    TableStorageFrameV2_ACU,
} from '../table/storage-frame-v2-types';
import { hashUserInput_ACU, logWarn_ACU } from '../../shared/utils';
import { normalizeSummaryVectorIndexScope_ACU } from '../../shared/summary-vector-index-scope';
import { buildPreparedRows_ACU, buildRowChunkTexts_ACU, findSummaryTable_ACU } from './summary-vector-index-archive-service';
import { getEffectiveSummaryVectorIndexConfig_ACU, validateSummaryVectorIndexConfig_ACU } from './vector-memory-config';
import {
    collectSummaryVectorMirrorFrameRefs_ACU,
    computeSummaryVectorMirrorCheckpointRevision_ACU,
    locateSummaryVectorMirrorBase_ACU,
    resolveSummaryVectorMirrorHead_ACU,
} from './summary-vector-mirror-resolver';
import {
    encodeSummaryVectorMirrorVector_ACU,
    finalizeSummaryVectorMirrorFiles_ACU,
    loadSummaryVectorMirrorManifest_ACU,
    loadSummaryVectorMirrorPack_ACU,
    persistSummaryVectorMirrorManifestPrepared_ACU,
    persistSummaryVectorMirrorPackPrepared_ACU,
} from './summary-vector-mirror-storage';
import { buildCurrentSummaryVectorEmbeddingIdentity_ACU } from './summary-vector-mirror-writer';
import { enqueueSummaryVectorIndexFlush_ACU } from './summary-vector-index-flush-queue';
import { runScopedRetentionGcAfterFlush_ACU } from './summary-vector-index-chat-deletion-gc';
import type { SummaryVectorIndexContentPackChunk_ACU, SummaryVectorIndexExternalFileRef_ACU } from './summary-vector-index-types';

export type SummaryVectorMirrorRebuildReason_ACU = 'initial' | 'rebuild_user' | 'rebuild_repair';

export interface SummaryVectorMirrorRebuildResult_ACU {
    success: boolean;
    skipped: boolean;
    indexedRowCount: number;
    skippedRowCount: number;
    chunkCount: number;
    reason?: string;
    errors: string[];
}

function emptyResult_ACU(partial: Partial<SummaryVectorMirrorRebuildResult_ACU>): SummaryVectorMirrorRebuildResult_ACU {
    return {
        success: false,
        skipped: false,
        indexedRowCount: 0,
        skippedRowCount: 0,
        chunkCount: 0,
        errors: [],
        ...partial,
    };
}

function inspectCheckpointRowIds_ACU(sheet: any): { rowIds: string[]; duplicates: string[]; emptyCount: number } {
    const content = Array.isArray(sheet?.content) ? sheet.content : [];
    const seen = new Set<string>();
    const rowIds: string[] = [];
    const duplicates: string[] = [];
    let emptyCount = 0;
    for (let index = 1; index < content.length; index += 1) {
        const rowId = String(content[index]?.[0] ?? '').trim();
        if (!rowId) {
            emptyCount += 1;
            continue;
        }
        if (seen.has(rowId)) {
            if (!duplicates.includes(rowId)) duplicates.push(rowId);
            continue;
        }
        seen.add(rowId);
        rowIds.push(rowId);
    }
    return { rowIds, duplicates, emptyCount };
}

function clearLegacyVectorFields_ACU(chat: any[]): void {
    for (const message of chat) {
        const isolated = message?.TavernDB_ACU_IsolatedData;
        if (!isolated || typeof isolated !== 'object') continue;
        for (const tagData of Object.values(isolated)) {
            if (!tagData || typeof tagData !== 'object') continue;
            delete (tagData as any).summaryVectorIndexState;
            delete (tagData as any).summaryVectorIndexManifest;
            delete (tagData as any).vectorMemoryState;
        }
    }
}

export async function rebuildSummaryVectorMirror_ACU(options: {
    reason: SummaryVectorMirrorRebuildReason_ACU;
}): Promise<SummaryVectorMirrorRebuildResult_ACU> {
    const chat = getChatArray_ACU();
    if (!Array.isArray(chat) || chat.length === 0) {
        return emptyResult_ACU({ success: true, skipped: true, reason: 'chat_empty' });
    }
    const selected = findSummaryTable_ACU();
    if (!selected?.summaryKey) {
        return emptyResult_ACU({ reason: 'summary_table_not_found', errors: ['纪要表不可用'] });
    }
    const isolationKey = getCurrentIsolationKey_ACU();
    const base = locateSummaryVectorMirrorBase_ACU(chat, isolationKey);
    if (!base || base.frame.checkpoint?.kind !== 'full') {
        return emptyResult_ACU({ reason: 'unsupported_replay_base', errors: ['表格基底不是 full checkpoint。'] });
    }

    const sheet = base.frame.checkpoint.data?.[selected.summaryKey];
    const inspect = inspectCheckpointRowIds_ACU(sheet);
    if (inspect.duplicates.length > 0) {
        return emptyResult_ACU({
            reason: 'duplicate_row_id',
            errors: [`checkpoint 存在重复 rowId：${inspect.duplicates.join(',')}`],
        });
    }

    const config = getEffectiveSummaryVectorIndexConfig_ACU();
    const validation = validateSummaryVectorIndexConfig_ACU(config);
    if (!validation.valid) {
        return emptyResult_ACU({ reason: 'summary_vector_index_config_invalid', errors: validation.errors });
    }

    const embedding = buildCurrentSummaryVectorEmbeddingIdentity_ACU();
    const prepared = buildPreparedRows_ACU(sheet, selected.summaryKey);
    const preparedById = new Map(prepared.rows.map((row) => [row.rowId, row]));
    const reusable = new Map<string, SummaryVectorChunkRef_ACU[]>();

    if (options.reason === 'rebuild_repair') {
        const head = await resolveSummaryVectorMirrorHead_ACU({
            chat,
            isolationKey,
            sourceTableKey: selected.summaryKey,
            loadManifest: (ref) => loadSummaryVectorMirrorManifest_ACU(ref),
        });
        if (head.status === 'ok') {
            for (const rowId of inspect.rowIds) {
                const refs = head.head.get(rowId);
                if (!refs || refs.length === 0) continue;
                let valid = true;
                for (const ref of refs) {
                    const pack = await loadSummaryVectorMirrorPack_ACU({ packHash: ref.packHash, path: head.packRefs.find((item) => item.packHash === ref.packHash)?.path || '', chunkCount: 0, byteLength: 0 });
                    if (!pack || !pack.chunks[ref.chunkIndex]) {
                        valid = false;
                        break;
                    }
                }
                if (valid) reusable.set(rowId, refs);
            }
        }
    }

    const toEmbed = inspect.rowIds.filter((rowId) => !reusable.has(rowId) && preparedById.has(rowId));
    const chunkSources: Array<{ rowId: string; text: string; vectorSourceHash: string }> = [];
    for (const rowId of toEmbed) {
        const row = preparedById.get(rowId)!;
        const texts = buildRowChunkTexts_ACU(row.vectorSourceText, {
            sentenceCount: config.summaryChunkSentenceCount,
            chunkBySentence: config.summaryIndexChunkChronicleBySentence === true,
        });
        texts.forEach((text) => chunkSources.push({ rowId, text, vectorSourceHash: row.vectorSourceHash }));
    }

    let embeddings: number[][] = [];
    if (chunkSources.length > 0) {
        try {
            const results = await createEmbeddings_ACU({
                endpoint: config.embeddingEndpoint,
                apiKey: config.embeddingApiKey,
                model: config.embeddingModel,
                input: chunkSources.map((item) => item.text),
            });
            embeddings = chunkSources.map((_item, index) => {
                const hit = results.find((item) => item.index === index);
                return Array.isArray(hit?.embedding) ? hit!.embedding : [];
            });
            if (embeddings.some((vector) => vector.length === 0)) {
                return emptyResult_ACU({ reason: 'embedding_incomplete', errors: ['重建 embedding 结果不完整'] });
            }
            embedding.dimension = embeddings[0].length;
        } catch (error: any) {
            return emptyResult_ACU({
                reason: isVectorEmbeddingError_ACU(error) ? 'embedding_failed' : 'embedding_failed',
                errors: [error?.message || String(error || 'embedding 失败')],
            });
        }
    } else if (reusable.size > 0) {
        const first = [...reusable.values()][0]?.[0];
        if (first) embedding.dimension = embedding.dimension;
    }

    const scope = normalizeSummaryVectorIndexScope_ACU({
        chatKey: currentChatFileIdentifier_ACU,
        isolationKey,
        sourceTableKey: selected.summaryKey,
    });
    const files: SummaryVectorIndexExternalFileRef_ACU[] = [];
    const newRefsByRow = new Map<string, SummaryVectorChunkRef_ACU[]>();
    reusable.forEach((refs, rowId) => newRefsByRow.set(rowId, refs));

    if (chunkSources.length > 0) {
        const packChunks: SummaryVectorIndexContentPackChunk_ACU[] = chunkSources.map((source, index) => ({
            chunkKey: `${source.rowId}:${index}`,
            chunkId: `${source.rowId}:${index}`,
            rowKey: source.rowId,
            text: source.text,
            vector: encodeSummaryVectorMirrorVector_ACU(embeddings[index]),
            vectorEncoding: 'f32b64',
            textHash: source.vectorSourceHash,
        }));
        const packPersist = await persistSummaryVectorMirrorPackPrepared_ACU({
            chatKey: scope.chatKey,
            isolationKey: scope.isolationKey,
            sourceTableKey: scope.sourceTableKey,
            embeddingModel: embedding.model,
            dimension: embedding.dimension,
            chunks: packChunks,
        });
        files.push(packPersist.file);
        chunkSources.forEach((source, index) => {
            const list = newRefsByRow.get(source.rowId) || [];
            list.push({ packHash: packPersist.ref.packHash, chunkIndex: index });
            newRefsByRow.set(source.rowId, list);
        });
    }

    const rows = inspect.rowIds.map((rowId) => ({
        rowId,
        chunks: newRefsByRow.get(rowId) || [],
    })).filter((row) => row.chunks.length > 0);

    const manifestPersist = await persistSummaryVectorMirrorManifestPrepared_ACU({
        chatKey: scope.chatKey,
        isolationKey: scope.isolationKey,
        sourceTableKey: scope.sourceTableKey,
        rows: {
            schema: 'summary_vector_mirror_manifest',
            version: 1,
            sourceTableKey: selected.summaryKey,
            rows: rows.map((row) => ({ rowId: row.rowId, chunks: row.chunks })),
        },
    });
    files.push(manifestPersist.file);

    const packRefs = [...new Map(rows.flatMap((row) => row.chunks.map((chunk) => [chunk.packHash, chunk.packHash]))).keys()]
        .map((packHash) => {
            const file = files.find((item) => item.path.includes(packHash));
            return {
                packHash,
                path: file?.path || '',
                chunkCount: rows.reduce((sum, row) => sum + row.chunks.filter((chunk) => chunk.packHash === packHash).length, 0),
                byteLength: Number(file?.byteSize) || 0,
            };
        })
        .filter((ref) => ref.path);

    const checkpoint: SummaryVectorIndexMirrorCheckpointV2_ACU = {
        kind: 'vector_full',
        createdAt: Date.now(),
        reason: options.reason === 'rebuild_repair' ? 'rebuild_repair' : options.reason === 'rebuild_user' ? 'rebuild_user' : 'initial',
        sourceTableKey: selected.summaryKey,
        tableCheckpointFingerprint: getTableDataFingerprint_ACU(base.frame.checkpoint.data),
        embedding,
        rowCount: rows.length,
        vectorRevision: computeSummaryVectorMirrorCheckpointRevision_ACU(rows),
        manifestRef: manifestPersist.ref,
        packRefs,
    };

    const snapshots = chat.map((message) => ({
        message,
        existed: !!message && Object.prototype.hasOwnProperty.call(message, 'TavernDB_ACU_IsolatedData'),
        value: message?.TavernDB_ACU_IsolatedData,
    }));

    try {
        await runTableWriteTransaction_ACU({
            source: 'vector_mirror',
            reason: `summary_vector_mirror_rebuild:${options.reason}`,
            isolationKey,
            writeSet: [{ kind: 'sheet', sheetKey: selected.summaryKey }],
            workingDataMode: 'none',
        }, async (ctx) => {
            ctx.assertFresh?.('vector_mirror_rebuild:before_write');
            await ctx.runCommit(async () => {
                for (const ref of collectSummaryVectorMirrorFrameRefs_ACU(chat, isolationKey)) {
                    if (ref.frame.summaryVectorIndexFrame) {
                        delete ref.frame.summaryVectorIndexFrame.checkpoint;
                        ref.frame.summaryVectorIndexFrame.logEntries = [];
                        delete ref.frame.summaryVectorIndexFrame;
                    }
                }
                const tagData = chat[base.messageIndex]?.TavernDB_ACU_IsolatedData?.[isolationKey];
                if (!isV2TagData_ACU(tagData)) throw new Error('重建失败：C 层不是 V2 frame。');
                const frame = tagData.storageFrame as TableStorageFrameV2_ACU;
                const mirror: SummaryVectorIndexMirrorFrameV2_ACU = {
                    version: 3,
                    sourceTableKey: selected.summaryKey,
                    checkpoint,
                    logEntries: [],
                };
                frame.summaryVectorIndexFrame = mirror;
                clearLegacyVectorFields_ACU(chat);
                await saveChatToHostStrict_ACU();
            });
        });
    } catch (error: any) {
        for (const snapshot of snapshots) {
            if (!snapshot.message) continue;
            if (snapshot.existed) snapshot.message.TavernDB_ACU_IsolatedData = snapshot.value;
            else delete snapshot.message.TavernDB_ACU_IsolatedData;
        }
        return emptyResult_ACU({
            reason: 'rebuild_commit_failed',
            errors: [error?.message || String(error || '重建落盘失败')],
        });
    }

    try {
        await finalizeSummaryVectorMirrorFiles_ACU(files);
    } catch (error: any) {
        logWarn_ACU('[向量镜像] 重建已写入聊天，registry published 失败:', error?.message || error);
    }

    void enqueueSummaryVectorIndexFlush_ACU({
        sourceTableKey: selected.summaryKey,
        reason: `rebuild_${options.reason}`,
    }).catch((error: any) => {
        logWarn_ACU('[向量镜像] 重建后入队 flush 失败:', error?.message || error);
    });
    void runScopedRetentionGcAfterFlush_ACU({
        chatKey: scope.chatKey,
        isolationKey: scope.isolationKey,
        sourceTableKey: scope.sourceTableKey,
    }).catch((): void => undefined);

    return {
        success: true,
        skipped: false,
        indexedRowCount: rows.length,
        skippedRowCount: inspect.emptyCount + prepared.skippedRowCount,
        chunkCount: chunkSources.length,
        errors: [],
    };
}

export function chatHasSummaryVectorMirror_ACU(chat: any[] | null | undefined): boolean {
    if (!Array.isArray(chat)) return false;
    return chat.some((message) => {
        const isolated = message?.TavernDB_ACU_IsolatedData;
        if (!isolated || typeof isolated !== 'object') return false;
        return Object.values(isolated).some((tagData: any) => (
            tagData?.storageFrame?.summaryVectorIndexFrame?.checkpoint?.kind === 'vector_full'
        ));
    });
}

export function chatHasLegacySummaryVectorFields_ACU(chat: any[] | null | undefined): boolean {
    if (!Array.isArray(chat)) return false;
    return chat.some((message) => {
        const isolated = message?.TavernDB_ACU_IsolatedData;
        if (!isolated || typeof isolated !== 'object') return false;
        return Object.values(isolated).some((tagData: any) => (
            tagData?.summaryVectorIndexState
            || tagData?.summaryVectorIndexManifest
            || tagData?.vectorMemoryState
        ));
    });
}
