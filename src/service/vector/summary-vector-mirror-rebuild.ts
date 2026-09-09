/**
 * service/vector/summary-vector-mirror-rebuild.ts — 统一重建路径
 *
 * replay/checkpoint.data 取 C 时刻 rowId 集合；与当前纪要表对得上则只索引 C。
 * C 为空或对不上时把当前纪要表写入 vector_full（否则没有 table entry 可挂 delta）。
 * 写 checkpoint@C → 清 C..H 旧 delta → strict save → 立刻 flush 补仍未镜像的 C..H。
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
    SummaryVectorPackRef_ACU,
    TableStorageFrameV2_ACU,
} from '../table/storage-frame-v2-types';
import { hashUserInput_ACU, logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { normalizeSummaryVectorIndexScope_ACU } from '../../shared/summary-vector-index-scope';
import { buildPreparedRows_ACU, buildRowChunkTexts_ACU, findSummaryTable_ACU } from './summary-vector-index-archive-service';
import { getEffectiveSummaryVectorIndexConfig_ACU, validateSummaryVectorIndexConfig_ACU } from './vector-memory-config';
import {
    assertSummaryVectorMirrorFrameInvariantsV2_ACU,
    collectSummaryVectorMirrorFrameRefs_ACU,
    computeSummaryVectorMirrorCheckpointRevision_ACU,
    isSummaryVectorEmbeddingIdentity_ACU,
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
import {
    buildCurrentSummaryVectorEmbeddingIdentity_ACU,
    flushSummaryVectorMirrorNow_ACU,
} from './summary-vector-mirror-writer';
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
    const header = Array.isArray(content[0]) ? content[0] : [];
    const indexColIdx = header.findIndex((cell: unknown) => String(cell ?? '').trim() === '编码索引');
    const seen = new Set<string>();
    const rowIds: string[] = [];
    const duplicates: string[] = [];
    let emptyCount = 0;
    for (let index = 1; index < content.length; index += 1) {
        const row = content[index];
        const physicalId = String(row?.[0] ?? '').trim();
        const indexCode = indexColIdx >= 0 ? String(row?.[indexColIdx] ?? '').trim() : '';
        const rowId = physicalId || indexCode;
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

/**
 * 重建纳入 vector_full 的 rowId 集合。
 * C 与当前表能对上时只吃 C（V2 不变量）；对不上或 C 为空时，用当前纪要表 seed，
 * 否则空 C + 看不到 table entry 的 H 行会永远变成 0 行索引。
 */
export function selectRebuildSourceRowIds_ACU(options: {
    checkpointRowIds: string[];
    preparedRowIds: string[];
}): { rowIds: string[]; seededFromLiveTable: boolean } {
    const prepared = options.preparedRowIds
        .map((rowId) => String(rowId || '').trim())
        .filter(Boolean);
    const preparedSet = new Set(prepared);
    const matched = options.checkpointRowIds
        .map((rowId) => String(rowId || '').trim())
        .filter((rowId) => rowId && preparedSet.has(rowId));
    if (matched.length > 0) {
        return { rowIds: matched, seededFromLiveTable: false };
    }
    if (prepared.length > 0) {
        return { rowIds: prepared, seededFromLiveTable: true };
    }
    return { rowIds: [], seededFromLiveTable: false };
}

export type SummaryVectorMirrorRowRemovalSnapshot_ACU =
    | { kind: 'none' }
    | {
        kind: 'ready';
        sourceTableKey: string;
        embedding: SummaryVectorEmbeddingIdentity_ACU;
        rows: Array<{ rowId: string; chunks: SummaryVectorChunkRef_ACU[] }>;
        packRefs: SummaryVectorPackRef_ACU[];
    };

/** 从当前 head 去掉清理范围内的 rowId，保留仍有 chunk 的行。 */
export function selectRetainedVectorMirrorRows_ACU(
    head: Iterable<[string, SummaryVectorChunkRef_ACU[]]>,
    excludedRowIds: Iterable<string>,
): Array<{ rowId: string; chunks: SummaryVectorChunkRef_ACU[] }> {
    const excluded = new Set(
        [...excludedRowIds].map((rowId) => String(rowId || '').trim()).filter(Boolean),
    );
    return [...head]
        .map(([rowId, chunks]) => ({
            rowId: String(rowId || '').trim(),
            chunks: Array.isArray(chunks) ? chunks.map((chunk) => ({ ...chunk })) : [],
        }))
        .filter((row) => row.rowId && !excluded.has(row.rowId) && row.chunks.length > 0)
        .sort((left, right) => left.rowId.localeCompare(right.rowId));
}

/**
 * 清表前拍摄 V2 head。reload / 模板临时根之后旧 fingerprint 对不上，不能再 resolve。
 */
export async function snapshotSummaryVectorMirrorExcludingRows_ACU(options: {
    excludedRowIds: string[];
    sourceTableKey?: string;
}): Promise<SummaryVectorMirrorRowRemovalSnapshot_ACU> {
    const chat = getChatArray_ACU();
    const sourceTableKey = String(options.sourceTableKey || findSummaryTable_ACU()?.summaryKey || '').trim();
    if (!Array.isArray(chat) || !sourceTableKey) return { kind: 'none' };

    const head = await resolveSummaryVectorMirrorHead_ACU({
        chat,
        isolationKey: getCurrentIsolationKey_ACU(),
        sourceTableKey,
        loadManifest: (ref) => loadSummaryVectorMirrorManifest_ACU(ref),
    });
    if (head.status !== 'ok' || !head.checkpoint || !isSummaryVectorEmbeddingIdentity_ACU(head.checkpoint.embedding)) {
        return { kind: 'none' };
    }

    const rows = selectRetainedVectorMirrorRows_ACU(head.head, options.excludedRowIds);
    const usedPackHashes = new Set(rows.flatMap((row) => row.chunks.map((chunk) => chunk.packHash)));
    return {
        kind: 'ready',
        sourceTableKey,
        embedding: { ...head.checkpoint.embedding },
        rows,
        packRefs: head.packRefs.filter((ref) => usedPackHashes.has(ref.packHash)).map((ref) => ({ ...ref })),
    };
}

async function stripSummaryVectorMirrorFrames_ACU(
    chat: any[],
    isolationKey: string,
    sourceTableKey: string,
): Promise<void> {
    await runTableWriteTransaction_ACU({
        source: 'vector_mirror',
        reason: 'summary_vector_mirror_strip',
        isolationKey,
        writeSet: [{ kind: 'sheet', sheetKey: sourceTableKey }],
        workingDataMode: 'none',
    }, async (ctx) => {
        ctx.assertFresh?.('vector_mirror_strip:before_write');
        await ctx.runCommit(async () => {
            for (const ref of collectSummaryVectorMirrorFrameRefs_ACU(chat, isolationKey)) {
                if (ref.frame.summaryVectorIndexFrame) {
                    delete ref.frame.summaryVectorIndexFrame;
                }
            }
            await saveChatToHostStrict_ACU();
        });
    });
}

/**
 * reload 之后把清表前拍下的剩余行发布到当前 C。
 * 剩余可以为空，但必须沿用旧 embedding（dimension>0），禁止写出非法空 checkpoint。
 */
export async function publishSummaryVectorMirrorRowRemovalSnapshot_ACU(
    snapshot: SummaryVectorMirrorRowRemovalSnapshot_ACU | null | undefined,
): Promise<SummaryVectorMirrorRebuildResult_ACU> {
    if (!snapshot || snapshot.kind === 'none') {
        return emptyResult_ACU({ success: true, skipped: true, reason: 'no_mirror' });
    }

    const chat = getChatArray_ACU();
    if (!Array.isArray(chat) || chat.length === 0) {
        return emptyResult_ACU({ success: true, skipped: true, reason: 'chat_empty' });
    }
    const isolationKey = getCurrentIsolationKey_ACU();
    const base = locateSummaryVectorMirrorBase_ACU(chat, isolationKey);
    if (!base || base.frame.checkpoint?.kind !== 'full') {
        return emptyResult_ACU({ reason: 'unsupported_replay_base', errors: ['表格基底不是 full checkpoint。'] });
    }

    if (!isSummaryVectorEmbeddingIdentity_ACU(snapshot.embedding)) {
        try {
            await stripSummaryVectorMirrorFrames_ACU(chat, isolationKey, snapshot.sourceTableKey);
            return emptyResult_ACU({ success: true, skipped: false, reason: 'invalid_embedding_stripped' });
        } catch (error: any) {
            return emptyResult_ACU({
                reason: 'rebuild_commit_failed',
                errors: [error?.message || String(error || '非法 embedding 时清理镜像失败')],
            });
        }
    }

    const scope = normalizeSummaryVectorIndexScope_ACU({
        chatKey: currentChatFileIdentifier_ACU,
        isolationKey,
        sourceTableKey: snapshot.sourceTableKey,
    });
    const rows = snapshot.rows.filter((row) => row.rowId && row.chunks.length > 0);
    let manifestPersist: Awaited<ReturnType<typeof persistSummaryVectorMirrorManifestPrepared_ACU>>;
    try {
        manifestPersist = await persistSummaryVectorMirrorManifestPrepared_ACU({
            chatKey: scope.chatKey,
            isolationKey: scope.isolationKey,
            sourceTableKey: scope.sourceTableKey,
            rows: {
                schema: 'summary_vector_mirror_manifest',
                version: 1,
                sourceTableKey: snapshot.sourceTableKey,
                rows: rows.map((row) => ({ rowId: row.rowId, chunks: row.chunks })),
            },
        });
    } catch (error: any) {
        return emptyResult_ACU({
            reason: 'rebuild_commit_failed',
            errors: [error?.message || String(error || '剩余行 manifest 上传失败')],
        });
    }

    const usedPackHashes = new Set(rows.flatMap((row) => row.chunks.map((chunk) => chunk.packHash)));
    const packRefs = snapshot.packRefs.filter((ref) => (
        usedPackHashes.has(ref.packHash)
        && ref.path
        && Number.isInteger(ref.chunkCount)
        && ref.chunkCount >= 0
        && Number.isFinite(ref.byteLength)
        && ref.byteLength >= 0
    ));
    const checkpoint: SummaryVectorIndexMirrorCheckpointV2_ACU = {
        kind: 'vector_full',
        createdAt: Date.now(),
        reason: 'rebuild_repair',
        sourceTableKey: snapshot.sourceTableKey,
        tableCheckpointFingerprint: getTableDataFingerprint_ACU(base.frame.checkpoint.data),
        embedding: snapshot.embedding,
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
            reason: 'summary_vector_mirror_row_removal',
            isolationKey,
            writeSet: [{ kind: 'sheet', sheetKey: snapshot.sourceTableKey }],
            workingDataMode: 'none',
        }, async (ctx) => {
            ctx.assertFresh?.('vector_mirror_row_removal:before_write');
            await ctx.runCommit(async () => {
                for (const ref of collectSummaryVectorMirrorFrameRefs_ACU(chat, isolationKey)) {
                    if (ref.frame.summaryVectorIndexFrame) {
                        delete ref.frame.summaryVectorIndexFrame;
                    }
                }
                const tagData = chat[base.messageIndex]?.TavernDB_ACU_IsolatedData?.[isolationKey];
                if (!isV2TagData_ACU(tagData)) throw new Error('发布剩余交火索引失败：C 层不是 V2 frame。');
                const frame = tagData.storageFrame as TableStorageFrameV2_ACU;
                const mirror: SummaryVectorIndexMirrorFrameV2_ACU = {
                    version: 3,
                    sourceTableKey: snapshot.sourceTableKey,
                    checkpoint,
                    logEntries: [],
                };
                frame.summaryVectorIndexFrame = mirror;
                const violation = assertSummaryVectorMirrorFrameInvariantsV2_ACU(
                    chat,
                    isolationKey,
                    'publishSummaryVectorMirrorRowRemoval',
                );
                if (violation) throw new Error(violation);
                await saveChatToHostStrict_ACU();
            });
        });
    } catch (error: any) {
        for (const item of snapshots) {
            if (!item.message) continue;
            if (item.existed) item.message.TavernDB_ACU_IsolatedData = item.value;
            else delete item.message.TavernDB_ACU_IsolatedData;
        }
        return emptyResult_ACU({
            reason: 'rebuild_commit_failed',
            errors: [error?.message || String(error || '剩余行镜像落盘失败')],
        });
    }

    try {
        await finalizeSummaryVectorMirrorFiles_ACU([manifestPersist.file]);
    } catch (error: any) {
        logWarn_ACU('[向量镜像] 剩余行镜像已写入聊天，registry published 失败:', error?.message || error);
    }

    logDebug_ACU(`[向量镜像] 清楼层后已按原 head 发布剩余 ${rows.length} 行，未按空表重建。`);
    return {
        success: true,
        skipped: false,
        indexedRowCount: rows.length,
        skippedRowCount: 0,
        chunkCount: rows.reduce((sum, row) => sum + row.chunks.length, 0),
        errors: [],
    };
}

function frameHasUsableVectorMirror_ACU(tagData: unknown): boolean {
    const checkpoint = (tagData as any)?.storageFrame?.summaryVectorIndexFrame?.checkpoint;
    return checkpoint?.kind === 'vector_full' && Number(checkpoint.rowCount) > 0;
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

    let embedding = buildCurrentSummaryVectorEmbeddingIdentity_ACU();
    const prepared = buildPreparedRows_ACU(selected.table, selected.summaryKey);
    if (prepared.error) {
        return emptyResult_ACU({ reason: 'prepared_rows_invalid', errors: [prepared.error] });
    }
    const source = selectRebuildSourceRowIds_ACU({
        checkpointRowIds: inspect.rowIds,
        preparedRowIds: prepared.rows.map((row) => row.rowId),
    });
    if (source.seededFromLiveTable) {
        logDebug_ACU(`[向量镜像] C 时刻纪要表无法对上当前表（C=${inspect.rowIds.length}，当前=${prepared.rows.length}），重建将当前纪要表 ${source.rowIds.length} 行写入 vector_full。`);
    }
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
            for (const rowId of source.rowIds) {
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

    const toEmbed = source.rowIds.filter((rowId) => !reusable.has(rowId) && preparedById.has(rowId));
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

    const rows = source.rowIds.map((rowId) => ({
        rowId,
        chunks: newRefsByRow.get(rowId) || [],
    })).filter((row) => row.chunks.length > 0);

    if (!isSummaryVectorEmbeddingIdentity_ACU(embedding)) {
        const existingHead = await resolveSummaryVectorMirrorHead_ACU({
            chat,
            isolationKey,
            sourceTableKey: selected.summaryKey,
            loadManifest: (ref) => loadSummaryVectorMirrorManifest_ACU(ref),
        });
        if (existingHead.status === 'ok' && existingHead.checkpoint && isSummaryVectorEmbeddingIdentity_ACU(existingHead.checkpoint.embedding)) {
            embedding = { ...existingHead.checkpoint.embedding };
        } else {
            try {
                await stripSummaryVectorMirrorFrames_ACU(chat, isolationKey, selected.summaryKey);
                return emptyResult_ACU({
                    success: true,
                    skipped: false,
                    reason: 'empty_rebuild_stripped_illegal_embedding',
                });
            } catch (error: any) {
                return emptyResult_ACU({
                    reason: 'rebuild_commit_failed',
                    errors: [error?.message || String(error || '空重建清理非法 embedding 失败')],
                });
            }
        }
    }

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
                const violation = assertSummaryVectorMirrorFrameInvariantsV2_ACU(
                    chat,
                    isolationKey,
                    'rebuildSummaryVectorMirror',
                );
                if (violation) throw new Error(violation);
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

    const flushed = await flushSummaryVectorMirrorNow_ACU({
        isolationKey,
        sourceTableKey: selected.summaryKey,
    });
    if (!flushed.success) {
        logWarn_ACU(`[向量镜像] 重建后立刻 flush 失败：${flushed.errors.join('; ') || flushed.reason || 'unknown'}`);
    } else if (!flushed.skipped) {
        logDebug_ACU(`[向量镜像] 重建后立刻 flush 完成：rows=${flushed.indexedRowCount}, chunks=${flushed.chunkCount}`);
    }
    void runScopedRetentionGcAfterFlush_ACU({
        chatKey: scope.chatKey,
        isolationKey: scope.isolationKey,
        sourceTableKey: scope.sourceTableKey,
    }).catch((): void => undefined);

    const flushedRows = flushed.success ? (flushed.indexedRowCount || 0) : 0;
    const flushedChunks = flushed.success ? (flushed.chunkCount || 0) : 0;
    return {
        success: true,
        skipped: false,
        indexedRowCount: rows.length + flushedRows,
        skippedRowCount: inspect.emptyCount + prepared.skippedRowCount + (flushed.skippedRowCount || 0),
        chunkCount: chunkSources.length + flushedChunks,
        errors: flushed.success ? [] : [...flushed.errors],
        reason: flushed.success ? undefined : flushed.reason,
    };
}

export function chatHasSummaryVectorMirror_ACU(chat: any[] | null | undefined): boolean {
    if (!Array.isArray(chat)) return false;
    return chat.some((message) => {
        const isolated = message?.TavernDB_ACU_IsolatedData;
        if (!isolated || typeof isolated !== 'object') return false;
        return Object.values(isolated).some((tagData) => frameHasUsableVectorMirror_ACU(tagData));
    });
}

/** 当前 isolation 槽是否已有带行的 V2 向量 checkpoint。空 vector_full 不算已有数据。 */
export function currentEnvironmentHasSummaryVectorMirror_ACU(
    chat: any[] | null | undefined,
    isolationKey: string,
): boolean {
    if (!Array.isArray(chat)) return false;
    const key = String(isolationKey ?? '');
    return chat.some((message) => {
        const isolated = message?.TavernDB_ACU_IsolatedData;
        if (!isolated || typeof isolated !== 'object') return false;
        return frameHasUsableVectorMirror_ACU((isolated as Record<string, any>)[key]);
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
