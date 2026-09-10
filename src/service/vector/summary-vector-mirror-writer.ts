/**
 * service/vector/summary-vector-mirror-writer.ts — 纪要向量镜像 flush runner
 *
 * 流程：resolver → rowId 时间线 → 未镜像 entry 集合差分 → 批量 embedding →
 * 一个 pack（prepared）→ vector_mirror 事务内重读 frame、校验 entryId、写同层 delta →
 * 一次 strict save → pack 转 published。失败回滚 frame 快照，pack 保持 prepared。
 */

import { createEmbeddings_ACU, isVectorEmbeddingError_ACU } from '../../data/gateways/vector-embedding-gateway';
import {
    executeEmbeddingBatchPlan_ACU,
    planEmbeddingBatches_ACU,
} from './summary-vector-embedding-batches';
import { EmbeddingBatchExecutionError_ACU } from './summary-vector-embedding-batches';

import { saveChatToHostStrict_ACU } from '../../data/gateways/chat-gateway';
import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { currentChatFileIdentifier_ACU, currentJsonTableData_ACU, getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import {
    collectSummarySheetRowIdTimelineV2_ACU,
    tableEntryTouchesSheetV2_ACU,
    type SummarySheetRowIdTimelineEntryV2_ACU,
} from '../table/summary-sheet-rowid-timeline';
import { captureTableRuntimeRevisionForWriteSet_ACU, runTableWriteTransaction_ACU } from '../table/table-write-transaction';
import { isV2TagData_ACU } from '../table/storage-strategy-resolver';
import type {
    SummaryVectorChunkRef_ACU,
    SummaryVectorEmbeddingIdentity_ACU,
    SummaryVectorIndexMirrorFrameV2_ACU,
    SummaryVectorIndexMirrorLogEntryV2_ACU,
    SummaryVectorIndexMirrorOperationV2_ACU,
    SummaryVectorPackRef_ACU,
    TableMutationWriteSetV2_ACU,
    TableStorageFrameV2_ACU,
} from '../table/storage-frame-v2-types';
import { hashUserInput_ACU, isSummaryOrOutlineTable_ACU, logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { normalizeSummaryVectorIndexScope_ACU, toChatIsolationSlotKey_ACU } from '../../shared/summary-vector-index-scope';
import { buildPreparedRows_ACU, buildRowChunkTexts_ACU, findSummaryTable_ACU } from './summary-vector-index-archive-service';
import { getEffectiveSummaryVectorIndexConfig_ACU, validateSummaryVectorIndexConfig_ACU } from './vector-memory-config';
import { SUMMARY_VECTOR_SOURCE_TEXT_VERSION_ACU } from './summary-vector-row-fingerprint';
import { resolveSummaryVectorMirrorHead_ACU, summaryVectorEmbeddingIdentityEquals_ACU } from './summary-vector-mirror-resolver';
import {
    encodeSummaryVectorMirrorVector_ACU,
    finalizeSummaryVectorMirrorFiles_ACU,
    loadSummaryVectorMirrorManifest_ACU,
    persistSummaryVectorMirrorPackPrepared_ACU,
} from './summary-vector-mirror-storage';
import type { SummaryVectorIndexContentPackChunk_ACU, SummaryVectorIndexExternalFileRef_ACU } from './summary-vector-index-types';
import type { SummaryVectorMirrorHeadResult_ACU } from './summary-vector-index-types';

export interface SummaryVectorMirrorFlushResult_ACU {
    success: boolean;
    skipped: boolean;
    indexedRowCount: number;
    skippedRowCount: number;
    chunkCount: number;
    reason?: string;
    retryability?: 'retryable' | 'terminal';
    credentialFingerprint?: string;
    errors: string[];
    needsRebuild?: boolean;
    writtenDeltaCount?: number;
}

export interface UnmirroredEntryDeltaPlanV2_ACU {
    messageIndex: number;
    entryId: string;
    commitRevision: string | null;
    added: string[];
    removed: string[];
}

function emptyResult_ACU(partial: Partial<SummaryVectorMirrorFlushResult_ACU>): SummaryVectorMirrorFlushResult_ACU {
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

export function buildCurrentSummaryVectorEmbeddingIdentity_ACU(): SummaryVectorEmbeddingIdentity_ACU {
    const config = getEffectiveSummaryVectorIndexConfig_ACU();
    return {
        endpointFingerprint: hashUserInput_ACU(String(config.embeddingEndpoint || '').trim()),
        model: String(config.embeddingModel || '').trim(),
        dimension: Math.max(0, Math.floor(Number((config as any).embeddingDimension) || 0)),
        sourceTextVersion: SUMMARY_VECTOR_SOURCE_TEXT_VERSION_ACU,
    };
}

export function findTouchedSummarySheetKey_ACU(options: {
    tableData?: Record<string, any> | null;
    changedSheetKeys?: string[];
    writeSet?: TableMutationWriteSetV2_ACU;
}): string | null {
    const tableData = options.tableData || currentJsonTableData_ACU || {};
    const fromKeys = Array.isArray(options.changedSheetKeys) ? options.changedSheetKeys : [];
    const fromWriteSet = Array.isArray(options.writeSet)
        ? options.writeSet.map((unit) => (unit && unit.kind !== 'all' ? String(unit.sheetKey || '').trim() : ''))
        : [];
    const candidates = [...new Set([...fromKeys, ...fromWriteSet].map((key) => String(key || '').trim()).filter(Boolean))];
    if (options.writeSet?.some((unit) => unit?.kind === 'all')) {
        for (const [sheetKey, sheet] of Object.entries(tableData)) {
            if (!sheetKey.startsWith('sheet_')) continue;
            if (sheet && typeof sheet === 'object' && isSummaryOrOutlineTable_ACU(String((sheet as any).name || ''))) {
                return sheetKey;
            }
        }
    }
    for (const sheetKey of candidates) {
        const sheet = tableData[sheetKey];
        if (sheet && typeof sheet === 'object' && isSummaryOrOutlineTable_ACU(String(sheet.name || ''))) {
            return sheetKey;
        }
    }
    return null;
}

export function planUnmirroredEntryDeltasV2_ACU(
    timelineEntries: SummarySheetRowIdTimelineEntryV2_ACU[],
    appliedTableEntryIds: string[],
    rowIdsAtCheckpoint: string[],
    alreadyMirroredRowIds: Iterable<string> = [],
): UnmirroredEntryDeltaPlanV2_ACU[] {
    const mirrored = new Set(appliedTableEntryIds);
    const alreadyInHead = new Set(
        [...alreadyMirroredRowIds].map((rowId) => String(rowId || '').trim()).filter(Boolean),
    );
    const plans: UnmirroredEntryDeltaPlanV2_ACU[] = [];
    let before = new Set(rowIdsAtCheckpoint);
    for (const entry of timelineEntries) {
        const after = new Set(entry.rowIdsAfter);
        if (!mirrored.has(entry.entryId)) {
            const added = [...after].filter((rowId) => !before.has(rowId) && !alreadyInHead.has(rowId)).sort();
            const removed = [...before].filter((rowId) => !after.has(rowId)).sort();
            if (added.length > 0 || removed.length > 0) {
                plans.push({
                    messageIndex: entry.messageIndex,
                    entryId: entry.entryId,
                    commitRevision: entry.commitRevision,
                    added,
                    removed,
                });
            }
        }
        before = after;
    }
    return plans;
}

function getStorageFrame_ACU(chat: any[], isolationKey: string, messageIndex: number): TableStorageFrameV2_ACU | null {
    const message = chat[messageIndex];
    const isolated = message?.TavernDB_ACU_IsolatedData;
    const tagData = isolated && typeof isolated === 'object' ? isolated[isolationKey] : null;
    if (!isV2TagData_ACU(tagData)) return null;
    return tagData.storageFrame as TableStorageFrameV2_ACU;
}

function tableEntryStillExists_ACU(frame: TableStorageFrameV2_ACU | null, entryId: string): boolean {
    if (!frame || !entryId) return false;
    return (frame.logEntries || []).some((entry) => entry?.entryId === entryId);
}

function generateVectorDeltaEntryId_ACU(): string {
    return `vdelta_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function snapshotIsolatedData_ACU(chat: any[], messageIndices: number[]): Array<{
    message: any;
    existed: boolean;
    value: any;
}> {
    return [...new Set(messageIndices)].map((index) => {
        const message = chat[index];
        const existed = !!message && Object.prototype.hasOwnProperty.call(message, 'TavernDB_ACU_IsolatedData');
        return {
            message,
            existed,
            value: existed ? message.TavernDB_ACU_IsolatedData : undefined,
        };
    });
}

function restoreIsolatedData_ACU(snapshots: Array<{ message: any; existed: boolean; value: any }>): void {
    for (const snapshot of snapshots) {
        if (!snapshot.message) continue;
        if (snapshot.existed) snapshot.message.TavernDB_ACU_IsolatedData = snapshot.value;
        else delete snapshot.message.TavernDB_ACU_IsolatedData;
    }
}

export async function flushSummaryVectorMirrorNow_ACU(options: {
    isolationKey?: string;
    sourceTableKey?: string;
    expectedFlushScopeKey?: string;
    expectedFlushGeneration?: number;
} = {}): Promise<SummaryVectorMirrorFlushResult_ACU> {
    const chat = getChatArray_ACU();
    if (!Array.isArray(chat) || chat.length === 0) {
        return emptyResult_ACU({ skipped: true, reason: 'chat_empty', success: true });
    }
    const selected = findSummaryTable_ACU(options.sourceTableKey);
    if (!selected?.summaryKey) {
        return emptyResult_ACU({ reason: 'summary_table_not_found', errors: ['纪要表不可用'], retryability: 'terminal' });
    }
    const isolationKey = toChatIsolationSlotKey_ACU(
        options.isolationKey ?? getCurrentIsolationKey_ACU(),
        getCurrentIsolationKey_ACU(),
    );
    const scope = normalizeSummaryVectorIndexScope_ACU({
        chatKey: currentChatFileIdentifier_ACU,
        isolationKey,
        sourceTableKey: selected.summaryKey,
    });

    const config = getEffectiveSummaryVectorIndexConfig_ACU();
    const configValidation = validateSummaryVectorIndexConfig_ACU(config);
    if (!configValidation.valid) {
        return emptyResult_ACU({
            reason: 'summary_vector_index_config_invalid',
            errors: configValidation.errors,
            retryability: 'terminal',
        });
    }

    const currentEmbedding = buildCurrentSummaryVectorEmbeddingIdentity_ACU();
    let head: SummaryVectorMirrorHeadResult_ACU;
    try {
        head = await resolveSummaryVectorMirrorHead_ACU({
            chat,
            isolationKey,
            sourceTableKey: selected.summaryKey,
            loadManifest: (ref) => loadSummaryVectorMirrorManifest_ACU(ref),
        });
    } catch (error: any) {
        return emptyResult_ACU({
            reason: 'resolver_failed',
            errors: [error?.message || String(error || 'resolver 失败')],
            retryability: 'retryable',
        });
    }

    if (head.status === 'unsupported_replay_base') {
        return emptyResult_ACU({
            reason: 'unsupported_replay_base',
            errors: ['表格基底不是 full checkpoint，无法写向量镜像。'],
            retryability: 'terminal',
        });
    }
    if (
        head.status === 'no_mirror'
        || head.status === 'source_table_changed'
        || head.status === 'embedding_identity_changed'
        || head.status === 'checkpoint_mismatch'
        || head.status === 'manifest_unavailable'
    ) {
        return emptyResult_ACU({
            reason: head.status,
            needsRebuild: true,
            errors: [`向量镜像需要重建：${head.status}`],
            retryability: 'terminal',
        });
    }
    if (head.chainConflict) {
        return emptyResult_ACU({
            reason: 'chain_conflict',
            needsRebuild: true,
            errors: ['向量镜像链冲突，需要自动修复重建。'],
            retryability: 'terminal',
        });
    }
    const checkpointEmbedding = head.checkpoint?.embedding;
    if (
        checkpointEmbedding
        && !summaryVectorEmbeddingIdentityEquals_ACU(currentEmbedding, checkpointEmbedding)
    ) {
        return emptyResult_ACU({
            reason: 'embedding_identity_changed',
            needsRebuild: true,
            errors: ['embedding 身份与 checkpoint 不一致，需要重建。'],
            retryability: 'terminal',
        });
    }
    const embedding: SummaryVectorEmbeddingIdentity_ACU = {
        ...currentEmbedding,
        dimension: checkpointEmbedding?.dimension || currentEmbedding.dimension,
    };

    const timeline = await collectSummarySheetRowIdTimelineV2_ACU({
        chat,
        isolationKey,
        sheetKey: selected.summaryKey,
    });
    if (timeline.status === 'unsupported_replay_base') {
        return emptyResult_ACU({
            reason: 'unsupported_replay_base',
            errors: ['rowId 时间线无法从非 full 基底收集。'],
            retryability: 'terminal',
        });
    }
    if (timeline.status !== 'ok') {
        return emptyResult_ACU({
            reason: 'timeline_failed',
            errors: [timeline.error || 'rowId 时间线收集失败'],
            retryability: 'retryable',
        });
    }

    const plans = planUnmirroredEntryDeltasV2_ACU(
        timeline.entries,
        head.appliedTableEntryIds,
        timeline.rowIdsAtCheckpoint,
        head.head.keys(),
    );
    if (plans.length === 0) {
        return emptyResult_ACU({
            success: true,
            skipped: true,
            reason: 'no_unmirrored_entries',
        });
    }

    const prepared = buildPreparedRows_ACU(selected.table, selected.summaryKey);
    if (prepared.error) {
        return emptyResult_ACU({
            reason: 'prepared_rows_invalid',
            errors: [prepared.error],
            retryability: 'terminal',
        });
    }
    const baseRevision = captureTableRuntimeRevisionForWriteSet_ACU(
        [{ kind: 'sheet', sheetKey: selected.summaryKey }],
        { isolationKey },
    );
    const rowsById = new Map(prepared.rows.map((row) => [row.rowId, row]));
    const addedRowIds = [...new Set(plans.flatMap((plan) => plan.added))];
    const missingAdded = addedRowIds.filter((rowId) => !rowsById.has(rowId));
    if (missingAdded.length > 0) {
        logWarn_ACU(`[向量镜像] 新增 rowId 在实时纪要表中找不到，本轮跳过这些行：${missingAdded.join(',')}`);
    }

    const chunkSources: Array<{ rowId: string; rowKey: string; text: string; vectorSourceHash: string }> = [];
    for (const rowId of addedRowIds) {
        const row = rowsById.get(rowId);
        if (!row) continue;
        const texts = buildRowChunkTexts_ACU(row.vectorSourceText, {
            sentenceCount: config.summaryChunkSentenceCount,
            chunkBySentence: config.summaryIndexChunkChronicleBySentence === true,
        });
        texts.forEach((text) => {
            chunkSources.push({ rowId, rowKey: rowId, text, vectorSourceHash: row.vectorSourceHash });
        });
    }

    let embeddings: number[][] = [];
    if (chunkSources.length > 0) {
        try {
            const plan = planEmbeddingBatches_ACU(chunkSources, {
                maxRowsPerRequest: config.summaryIndexArchiveMaxConcurrency,
                maxInputCharsPerRequest: Number(config.summaryIndexArchiveMaxInputChars) || 24000,
            });
            const executed = await executeEmbeddingBatchPlan_ACU(plan, {
                maxConcurrentRequests: config.summaryIndexArchiveEmbeddingConcurrency,
                requestEmbeddings: (input) => createEmbeddings_ACU({
                    endpoint: config.embeddingEndpoint,
                    apiKey: config.embeddingApiKey,
                    model: config.embeddingModel,
                    input,
                }),
            });
            embeddings = executed.embeddings;
            if (embeddings.some((vector) => vector.length === 0)) {
                return emptyResult_ACU({
                    reason: 'embedding_incomplete',
                    errors: ['批量 embedding 结果不完整'],
                    retryability: 'retryable',
                });
            }
            const actualDimension = embeddings[0].length;
            if (embedding.dimension > 0 && actualDimension !== embedding.dimension) {
                return emptyResult_ACU({
                    reason: 'embedding_identity_changed',
                    needsRebuild: true,
                    errors: [`embedding 维度从 ${embedding.dimension} 变为 ${actualDimension}，需要重建。`],
                    retryability: 'terminal',
                });
            }
            embedding.dimension = actualDimension;
        } catch (error: any) {
            const embeddingError = error instanceof EmbeddingBatchExecutionError_ACU ? (error as any).cause : error;
            const message = error?.message || String(error || 'embedding 失败');
            const credential = isVectorEmbeddingError_ACU(embeddingError)
                && (Number((embeddingError as any).httpStatus) === 401 || Number((embeddingError as any).httpStatus) === 403);
            return emptyResult_ACU({
                reason: credential ? 'embedding_unauthorized' : 'embedding_failed',
                errors: [message],
                retryability: 'retryable',
                ...(credential ? {
                    credentialFingerprint: hashUserInput_ACU([
                        String(config.embeddingEndpoint || '').trim(),
                        String(config.embeddingModel || '').trim(),
                        String(config.embeddingApiKey || '').trim(),
                    ].join('|')),
                } : {}),
            });
        }
    }

    let packPersist: { ref: SummaryVectorPackRef_ACU; file: SummaryVectorIndexExternalFileRef_ACU } | null = null;
    const chunkRefsByRowId = new Map<string, SummaryVectorChunkRef_ACU[]>();
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
        packPersist = await persistSummaryVectorMirrorPackPrepared_ACU({
            chatKey: scope.chatKey,
            isolationKey: scope.isolationKey,
            sourceTableKey: scope.sourceTableKey,
            embeddingModel: embedding.model,
            dimension: embeddings[0]?.length || embedding.dimension,
            chunks: packChunks,
        });
        chunkSources.forEach((source, index) => {
            const list = chunkRefsByRowId.get(source.rowId) || [];
            list.push({ packHash: packPersist!.ref.packHash, chunkIndex: index });
            chunkRefsByRowId.set(source.rowId, list);
        });
    }

    const snapshots = snapshotIsolatedData_ACU(chat, plans.map((plan) => plan.messageIndex));
    let writtenDeltaCount = 0;
    try {
        await runTableWriteTransaction_ACU({
            source: 'vector_mirror',
            reason: 'summary_vector_mirror_flush',
            revisionImpact: 'derived_metadata',
            isolationKey,
            writeSet: [{ kind: 'sheet', sheetKey: selected.summaryKey }],
            baseRevision,
            workingDataMode: 'none',
        }, async (ctx) => {
            ctx.assertFresh?.('vector_mirror:before_delta_write');
            await ctx.runCommit(async () => {
                for (const plan of plans) {
                    const frame = getStorageFrame_ACU(chat, isolationKey, plan.messageIndex);
                    if (!tableEntryStillExists_ACU(frame, plan.entryId) || !frame) {
                        logDebug_ACU(`[向量镜像] 丢弃已失效来源 entry 的 delta：entryId=${plan.entryId}, messageIndex=${plan.messageIndex}`);
                        continue;
                    }
                    const operations: SummaryVectorIndexMirrorOperationV2_ACU[] = [];
                    for (const rowId of plan.removed) {
                        operations.push({ kind: 'row_remove', rowId });
                    }
                    for (const rowId of plan.added) {
                        const chunks = chunkRefsByRowId.get(rowId);
                        if (!chunks || chunks.length === 0) continue;
                        const row = rowsById.get(rowId);
                        operations.push({
                            kind: 'row_add',
                            rowId,
                            chunks,
                            vectorSourceHash: row?.vectorSourceHash || '',
                        });
                    }
                    if (operations.length === 0) continue;
                    const mirror: SummaryVectorIndexMirrorFrameV2_ACU = frame.summaryVectorIndexFrame && typeof frame.summaryVectorIndexFrame === 'object'
                        ? frame.summaryVectorIndexFrame
                        : { version: 3, sourceTableKey: selected.summaryKey, logEntries: [] };
                    const nextSeq = Math.max(0, ...(mirror.logEntries || []).map((entry) => Number(entry.seq) || 0)) + 1;
                    const delta: SummaryVectorIndexMirrorLogEntryV2_ACU = {
                        seq: nextSeq,
                        entryId: generateVectorDeltaEntryId_ACU(),
                        createdAt: Date.now(),
                        sourceTableEntry: {
                            entryId: plan.entryId,
                            commitRevision: plan.commitRevision,
                            messageIndex: plan.messageIndex,
                        },
                        embedding,
                        packRefs: packPersist ? [packPersist.ref] : [],
                        operations,
                        skippedRowCount: plan.added.filter((rowId) => !chunkRefsByRowId.has(rowId)).length || undefined,
                    };
                    frame.summaryVectorIndexFrame = {
                        ...mirror,
                        sourceTableKey: selected.summaryKey,
                        logEntries: [...(mirror.logEntries || []), delta],
                    };
                    writtenDeltaCount += 1;
                }
                if (writtenDeltaCount === 0) return;
                await saveChatToHostStrict_ACU();
            });
        });
    } catch (error: any) {
        restoreIsolatedData_ACU(snapshots);
        return emptyResult_ACU({
            reason: 'vector_mirror_commit_failed',
            errors: [error?.message || String(error || '镜像 delta 落盘失败')],
            retryability: 'retryable',
        });
    }

    if (packPersist) {
        try {
            await finalizeSummaryVectorMirrorFiles_ACU([packPersist.file]);
        } catch (error: any) {
            logWarn_ACU('[向量镜像] pack 已写入聊天引用，但 registry 转 published 失败，保留 prepared 供 GC 观察:', error?.message || error);
        }
    }

    return {
        success: true,
        skipped: writtenDeltaCount === 0,
        indexedRowCount: addedRowIds.filter((rowId) => chunkRefsByRowId.has(rowId)).length,
        skippedRowCount: prepared.skippedRowCount + missingAdded.length,
        chunkCount: chunkSources.length,
        reason: writtenDeltaCount === 0 ? 'source_entries_gone' : undefined,
        errors: [],
        writtenDeltaCount,
    };
}

export function tablePersistTouchesSummarySheet_ACU(
    changedSheetKeys: string[] | undefined,
    writeSet: TableMutationWriteSetV2_ACU | undefined,
): boolean {
    const probe = { changedSheetKeys, writeSet, filledSheetKeys: [] as string[] };
    const sourceTableKey = findTouchedSummarySheetKey_ACU({ changedSheetKeys, writeSet });
    if (!sourceTableKey) return false;
    return tableEntryTouchesSheetV2_ACU(probe as any, sourceTableKey) || Boolean(sourceTableKey);
}
