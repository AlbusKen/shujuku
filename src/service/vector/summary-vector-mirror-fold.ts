/**
 * service/vector/summary-vector-mirror-fold.ts — compaction 时把 vector head 折到新锚点
 *
 * 纯 I/O：resolver(楼层 < anchor) → 合并 pack + 新 manifest → 写 checkpoint@anchor →
 * 删除旧 checkpoint 与 anchor 前 delta。零 embedding。失败抛错，由 compaction 回滚消息字段。
 */

import { currentChatFileIdentifier_ACU } from '../runtime/state-manager';
import { isV2TagData_ACU } from '../table/storage-strategy-resolver';
import type {
    SummaryVectorChunkRef_ACU,
    SummaryVectorIndexMirrorCheckpointV2_ACU,
    SummaryVectorIndexMirrorFrameV2_ACU,
    TableStorageFrameV2_ACU,
} from '../table/storage-frame-v2-types';
import { normalizeSummaryVectorIndexScope_ACU } from '../../shared/summary-vector-index-scope';
import { isSummaryOrOutlineTable_ACU, logDebug_ACU } from '../../shared/utils';
import { collectSummaryVectorMirrorFrameRefs_ACU, computeSummaryVectorMirrorCheckpointRevision_ACU, resolveSummaryVectorMirrorHead_ACU } from './summary-vector-mirror-resolver';
import {
    finalizeSummaryVectorMirrorFiles_ACU,
    loadSummaryVectorMirrorManifest_ACU,
    loadSummaryVectorMirrorPack_ACU,
    persistSummaryVectorMirrorManifestPrepared_ACU,
    persistSummaryVectorMirrorPackPrepared_ACU,
} from './summary-vector-mirror-storage';
import { buildCurrentSummaryVectorEmbeddingIdentity_ACU } from './summary-vector-mirror-writer';
import type { SummaryVectorIndexContentPackChunk_ACU, SummaryVectorIndexExternalFileRef_ACU } from './summary-vector-index-types';

export interface FoldSummaryVectorMirrorResult_ACU {
    folded: boolean;
    files: SummaryVectorIndexExternalFileRef_ACU[];
}

function findSummarySheetKeyInCheckpoint_ACU(data: Record<string, any> | null | undefined): string | null {
    if (!data || typeof data !== 'object') return null;
    for (const [sheetKey, sheet] of Object.entries(data)) {
        if (!sheetKey.startsWith('sheet_')) continue;
        if (sheet && typeof sheet === 'object' && isSummaryOrOutlineTable_ACU(String((sheet as any).name || ''))) {
            return sheetKey;
        }
    }
    return null;
}

function getFrame_ACU(chat: any[], isolationKey: string, messageIndex: number): TableStorageFrameV2_ACU | null {
    const tagData = chat[messageIndex]?.TavernDB_ACU_IsolatedData?.[isolationKey];
    if (!isV2TagData_ACU(tagData)) return null;
    return tagData.storageFrame as TableStorageFrameV2_ACU;
}

export async function foldSummaryVectorMirrorAtBoundary_ACU(params: {
    chat: any[];
    isolationKey: string;
    boundaryAnchorIndex: number;
    tableCheckpointFingerprint: string;
    sourceTableKey?: string;
}): Promise<FoldSummaryVectorMirrorResult_ACU> {
    const sourceTableKey = params.sourceTableKey
        || findSummarySheetKeyInCheckpoint_ACU(getFrame_ACU(params.chat, params.isolationKey, params.boundaryAnchorIndex)?.checkpoint?.data);
    if (!sourceTableKey) return { folded: false, files: [] };

    const head = await resolveSummaryVectorMirrorHead_ACU({
        chat: params.chat,
        isolationKey: params.isolationKey,
        sourceTableKey,
        maxMessageIndexExclusive: params.boundaryAnchorIndex,
        loadManifest: (ref) => loadSummaryVectorMirrorManifest_ACU(ref),
    });
    if (head.status === 'no_mirror' || head.status === 'unsupported_replay_base') {
        return { folded: false, files: [] };
    }
    if (head.status !== 'ok') {
        throw new Error(`向量镜像折叠失败：resolver status=${head.status}`);
    }

    const embedding = head.checkpoint?.embedding || buildCurrentSummaryVectorEmbeddingIdentity_ACU();
    const packByHash = new Map<string, Awaited<ReturnType<typeof loadSummaryVectorMirrorPack_ACU>>>();
    for (const packRef of head.packRefs) {
        const pack = await loadSummaryVectorMirrorPack_ACU(packRef);
        if (!pack) throw new Error(`向量镜像折叠失败：无法读取 pack ${packRef.packHash}`);
        packByHash.set(packRef.packHash, pack);
    }

    const mergedChunks: SummaryVectorIndexContentPackChunk_ACU[] = [];
    const rows: Array<{ rowId: string; chunks: SummaryVectorChunkRef_ACU[] }> = [];
    for (const [rowId, refs] of [...head.head.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
        const newRefs: SummaryVectorChunkRef_ACU[] = [];
        for (const ref of refs) {
            const pack = packByHash.get(ref.packHash);
            const chunk = pack?.chunks[ref.chunkIndex];
            if (!chunk) throw new Error(`向量镜像折叠失败：rowId=${rowId} 缺少 chunk ${ref.packHash}#${ref.chunkIndex}`);
            newRefs.push({ packHash: '', chunkIndex: mergedChunks.length });
            mergedChunks.push({
                ...chunk,
                chunkKey: `${rowId}:${mergedChunks.length}`,
                chunkId: `${rowId}:${mergedChunks.length}`,
                rowKey: rowId,
            });
        }
        rows.push({ rowId, chunks: newRefs });
    }

    const scope = normalizeSummaryVectorIndexScope_ACU({
        chatKey: currentChatFileIdentifier_ACU,
        isolationKey: params.isolationKey,
        sourceTableKey,
    });
    const files: SummaryVectorIndexExternalFileRef_ACU[] = [];
    let packHash = '';
    if (mergedChunks.length > 0) {
        const packPersist = await persistSummaryVectorMirrorPackPrepared_ACU({
            chatKey: scope.chatKey,
            isolationKey: scope.isolationKey,
            sourceTableKey: scope.sourceTableKey,
            embeddingModel: embedding.model,
            dimension: embedding.dimension,
            chunks: mergedChunks,
        });
        packHash = packPersist.ref.packHash;
        files.push(packPersist.file);
        rows.forEach((row) => {
            row.chunks = row.chunks.map((ref) => ({ packHash, chunkIndex: ref.chunkIndex }));
        });
    }

    const manifestPersist = await persistSummaryVectorMirrorManifestPrepared_ACU({
        chatKey: scope.chatKey,
        isolationKey: scope.isolationKey,
        sourceTableKey: scope.sourceTableKey,
        rows: {
            schema: 'summary_vector_mirror_manifest',
            version: 1,
            sourceTableKey,
            rows: rows.map((row) => ({ rowId: row.rowId, chunks: row.chunks })),
        },
    });
    files.push(manifestPersist.file);

    const checkpoint: SummaryVectorIndexMirrorCheckpointV2_ACU = {
        kind: 'vector_full',
        createdAt: Date.now(),
        reason: 'fold',
        sourceTableKey,
        tableCheckpointFingerprint: params.tableCheckpointFingerprint,
        embedding,
        rowCount: rows.length,
        vectorRevision: computeSummaryVectorMirrorCheckpointRevision_ACU(rows),
        manifestRef: manifestPersist.ref,
        packRefs: packHash ? [{ packHash, path: files[0].path, chunkCount: mergedChunks.length, byteLength: files[0].byteSize }] : [],
    };

    const anchorFrame = getFrame_ACU(params.chat, params.isolationKey, params.boundaryAnchorIndex);
    if (!anchorFrame) throw new Error('向量镜像折叠失败：锚点 frame 不存在。');
    const existing: SummaryVectorIndexMirrorFrameV2_ACU = anchorFrame.summaryVectorIndexFrame && typeof anchorFrame.summaryVectorIndexFrame === 'object'
        ? anchorFrame.summaryVectorIndexFrame
        : { version: 3, sourceTableKey, logEntries: [] };
    existing.checkpoint = checkpoint;
    existing.sourceTableKey = sourceTableKey;
    anchorFrame.summaryVectorIndexFrame = existing;

    for (const ref of collectSummaryVectorMirrorFrameRefs_ACU(params.chat, params.isolationKey, params.boundaryAnchorIndex)) {
        const mirror = ref.frame.summaryVectorIndexFrame;
        if (!mirror) continue;
        if (mirror.checkpoint) delete mirror.checkpoint;
        mirror.logEntries = [];
        if (!mirror.checkpoint && mirror.logEntries.length === 0) {
            delete ref.frame.summaryVectorIndexFrame;
        }
    }

    logDebug_ACU(`[向量镜像] 已折叠到锚点 #${params.boundaryAnchorIndex}：rows=${rows.length}, packs=${packHash ? 1 : 0}`);
    return { folded: true, files };
}

export async function finalizeFoldedSummaryVectorMirrorFiles_ACU(files: SummaryVectorIndexExternalFileRef_ACU[]): Promise<void> {
    if (files.length === 0) return;
    await finalizeSummaryVectorMirrorFiles_ACU(files);
}
