import { readIsolatedTagData_ACU } from '../../data/repositories/chat-message-data-repo';
import { commitVectorMetadataPatch_ACU, commitVectorMetadataPatchesBatch_ACU } from './summary-vector-index-chat-commit';
import type { ChatSummaryVectorIndexState_ACU } from './summary-vector-index-types';
import {
    clearSummaryVectorFlushTasksByScope_ACU,
    deleteSummaryVectorHotCacheByScope_ACU,
} from '../../data/storage/vector-index-hot-cache';
import {
    buildLegacyVectorIndexSingleSnapshotFilePath_ACU,
    buildVectorIndexSingleSnapshotFilePath_ACU,
    buildVectorIndexSingleSnapshotV2ScopeToken_ACU,
    loadVectorIndexRegistry_ACU,
    readVectorIndexJsonFile_ACU,
} from '../../data/storage/vector-index-st-files-storage';
import { getCurrentCharacterCardName_ACU } from '../../shared/template-preset-utils';
import { isSummaryOrOutlineTable_ACU, logWarn_ACU } from '../../shared/utils';
import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { currentChatFileIdentifier_ACU, currentJsonTableData_ACU, getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import {
    getAggregatedSummaryVectorIndexSnapshot_ACU,
} from './summary-vector-index-state-service';
import {
    cleanupUnreachableSummaryVectorIndexFiles_ACU,
    validateSingleFileSnapshotIdentity_ACU,
    type VectorIndexSingleSnapshotBlob_ACU,
} from './summary-vector-index-storage-service';

function getCurrentSummaryVectorIndexSourceTableKey_ACU(): string {
    const tables = currentJsonTableData_ACU && typeof currentJsonTableData_ACU === 'object'
        ? currentJsonTableData_ACU
        : null;
    if (!tables) return 'summary';
    return Object.keys(tables).find((key) => {
        const table = tables[key];
        return !!table?.name && isSummaryOrOutlineTable_ACU(String(table.name || ''));
    }) || 'summary';
}

/**
 * 当聊天 tag data 缺少索引指针时，从唯一可证明属于当前 canonical scope 的外部快照恢复。
 *
 * 这是聊天/向量持久化逻辑，不属于任何 UI。V2 只接受 registry 中已 durable-published 的
 * 快照；legacy 格式没有可靠的修订序，只接受唯一可信候选，避免用文件名顺序猜测数据新旧。
 */
function getUniqueSummaryVectorIndexSourceTableKeyForRecovery_ACU(): string {
    const tables = currentJsonTableData_ACU && typeof currentJsonTableData_ACU === 'object'
        ? currentJsonTableData_ACU
        : null;
    if (!tables) return '';

    const candidates = Object.keys(tables).filter((key) => {
        const table = tables[key];
        return !!table?.name && isSummaryOrOutlineTable_ACU(String(table.name || ''));
    });
    return candidates.length === 1 ? candidates[0] : '';
}

export async function tryRecoverSummaryVectorIndexFromExternalSnapshot_ACU(): Promise<boolean> {
    const chatKey = String(currentChatFileIdentifier_ACU || '').trim();
    // 标签隔离已退役：未开启时 isolationKey 为 ''，空串是合法默认槽，不能当缺失。
    const isolationKey = String(getCurrentIsolationKey_ACU() ?? '');
    const sourceTableKey = getUniqueSummaryVectorIndexSourceTableKeyForRecovery_ACU();
    if (!chatKey || !sourceTableKey) return false;

    const chatName = getCurrentCharacterCardName_ACU();
    const registeredFiles = await loadVectorIndexRegistry_ACU()
        .then((registry) => Array.isArray(registry.files) ? registry.files : [])
        .catch((error) => {
            logWarn_ACU('[交火模式纪要索引] 自动恢复读取 V2 registry 失败，将继续尝试 legacy 路径:', error);
            return [] as any[];
        });

    const restoreCandidate = async (
        blob: VectorIndexSingleSnapshotBlob_ACU,
        manifest: any,
    ): Promise<boolean> => {
        const chat = getChatArray_ACU();
        if (!Array.isArray(chat) || chat.length === 0) return false;
        const targetIndex = chat.map((message: any, index: number) => message && !message.is_user ? index : -1)
            .filter((index: number) => index >= 0)
            .pop() ?? -1;
        if (targetIndex < 0) return false;

        const message = chat[targetIndex];
        if (readIsolatedTagData_ACU(message, isolationKey)?.summaryVectorIndexState?.manifest?.indexId) return false;
        const rows = Array.isArray(blob.rows) ? blob.rows : [];
        const chunks = Array.isArray(blob.chunks) ? blob.chunks : [];
        const nextState: ChatSummaryVectorIndexState_ACU = {
            version: 1,
            backend: 'st-files',
            status: 'ready',
            indexId: String(manifest.indexId),
            snapshotMessageId: String(manifest.snapshotMessageId || message.mesId || ''),
            sourceTableKey: String(manifest.sourceTableKey || sourceTableKey),
            sourceTableName: String(manifest.sourceTableName || sourceTableKey),
            indexedAt: String(manifest.indexedAt || new Date().toISOString()),
            rowCount: rows.filter((row: any) => row.status !== 'removed').length,
            chunkCount: chunks.length,
            skippedRowCount: 0,
            rows,
            chunks: chunks.map((chunk: any) => ({
                ...chunk,
                // 统一归一为普通 number[]：state.chunks 会随聊天元数据 JSON 序列化，
                // 不能把 Float32Array 落进持久化路径。
                vector: Array.isArray(chunk.vector) || chunk.vector instanceof Float32Array
                    ? Array.from(chunk.vector as any, (item: any) => Number(item)).filter((item: number) => Number.isFinite(item))
                    : [],
            })),
            manifest: JSON.parse(JSON.stringify(manifest)),
        };
        try {
            // CAS：目标槽当前必须不存在有效 indexId，防止外部读取期间已有新 pointer。
            return await commitVectorMetadataPatch_ACU(message, isolationKey, {
                summaryVectorIndexState: nextState,
                summaryVectorIndexManifest: JSON.parse(JSON.stringify(manifest)),
            }, {
                expectedIndexId: '',
            });
        } catch (error) {
            logWarn_ACU('[交火模式纪要索引] 自动恢复持久化失败，已回滚写前 state:', error);
            return false;
        }
    };

    const v2PathPrefix = `TavernDB_ACU_vector_v2_${buildVectorIndexSingleSnapshotV2ScopeToken_ACU({ chatKey, isolationKey, sourceTableKey })}_`;
    const v2Candidates: Array<{ path: string; blob: VectorIndexSingleSnapshotBlob_ACU; manifest: any; revision: number }> = [];
    for (const file of registeredFiles) {
        const path = String(file?.path || '').trim();
        if (!path.startsWith(v2PathPrefix) || file?.publicationState !== 'published') continue;
        try {
            const loaded = await readVectorIndexJsonFile_ACU<VectorIndexSingleSnapshotBlob_ACU>(path);
            const blob = loaded.data;
            const manifest = blob?.manifest;
            if (!loaded.ok || !blob || blob.schema !== 'single_file_snapshot' || !manifest?.indexId || manifest.status !== 'ready') continue;
            if (String(manifest.chatKey || '') !== chatKey || String(manifest.isolationKey || '') !== isolationKey || String(manifest.sourceTableKey || '') !== sourceTableKey) continue;
            validateSingleFileSnapshotIdentity_ACU(manifest, blob, path);
            const revision = Number(manifest.storageIdentity?.revision ?? manifest.snapshot?.revision);
            if (Number.isInteger(revision) && revision >= 1) v2Candidates.push({ path, blob, manifest, revision });
        } catch { /* 单个 registry 对象不可信时继续审阅同 scope 的其他 published 候选。 */ }
    }
    if (v2Candidates.length > 0) {
        const newestRevision = Math.max(...v2Candidates.map((candidate) => candidate.revision));
        const newestCandidates = v2Candidates.filter((candidate) => candidate.revision === newestRevision);
        if (newestCandidates.length !== 1) {
            logWarn_ACU('[交火模式纪要索引] 自动恢复拒绝同 scope 同 revision 的多个 published V2 候选:', {
                scope: v2PathPrefix, revision: newestRevision, paths: newestCandidates.map((candidate) => candidate.path),
            });
            return false;
        }
        return restoreCandidate(newestCandidates[0].blob, newestCandidates[0].manifest);
    }

    const legacyPaths = new Set([
        buildVectorIndexSingleSnapshotFilePath_ACU({ chatKey, isolationKey, sourceTableKey, chatName }),
        buildVectorIndexSingleSnapshotFilePath_ACU({ chatKey, isolationKey, sourceTableKey }),
        buildLegacyVectorIndexSingleSnapshotFilePath_ACU({ chatKey, isolationKey, sourceTableKey }),
    ]);
    const legacyCandidates: Array<{ path: string; blob: VectorIndexSingleSnapshotBlob_ACU; manifest: any }> = [];
    for (const path of legacyPaths) {
        try {
            const loaded = await readVectorIndexJsonFile_ACU<VectorIndexSingleSnapshotBlob_ACU>(path);
            const blob = loaded.data;
            const manifest = blob?.manifest;
            if (!loaded.ok || !blob || blob.schema !== 'single_file_snapshot' || !manifest?.indexId || manifest.status !== 'ready') continue;
            if (String(manifest.chatKey || '') !== chatKey || String(manifest.isolationKey || '') !== isolationKey || String(manifest.sourceTableKey || '') !== sourceTableKey) continue;
            validateSingleFileSnapshotIdentity_ACU(manifest, blob, path);
            legacyCandidates.push({ path, blob, manifest });
        } catch { /* 当前候选不可信，继续同 scope 的下一个候选。 */ }
    }
    if (legacyCandidates.length !== 1) {
        if (legacyCandidates.length > 1) {
            logWarn_ACU('[交火模式纪要索引] 自动恢复拒绝多个可信 legacy 快照候选:', {
                paths: legacyCandidates.map((candidate) => candidate.path),
            });
        }
        return false;
    }
    return restoreCandidate(legacyCandidates[0].blob, legacyCandidates[0].manifest);
}

export async function clearSummaryVectorIndexLayerFromChat_ACU(params: {
    messageIndex: number;
    isolationKey: string;
    indexId: string;
}): Promise<boolean> {
    const chat = getChatArray_ACU();
    const message = Array.isArray(chat) ? chat[params.messageIndex] : null;
    if (!message || message.is_user) return false;

    const tagData = readIsolatedTagData_ACU(message, params.isolationKey);
    if (!tagData || typeof tagData !== 'object') return false;
    const manifest = tagData.summaryVectorIndexManifest || tagData.summaryVectorIndexState?.manifest || null;
    if (!manifest || String(manifest.indexId || '') !== String(params.indexId || '')) return false;

    try {
        return await commitVectorMetadataPatch_ACU(message, params.isolationKey, {
            summaryVectorIndexState: null,
            summaryVectorIndexManifest: null,
        }, {
            expectedIndexId: params.indexId,
        });
    } catch (error) {
        throw error;
    }
}

export async function deleteCurrentSummaryVectorIndexFromChat_ACU(): Promise<boolean> {
    const snapshot = getAggregatedSummaryVectorIndexSnapshot_ACU();
    const chat = getChatArray_ACU();
    const scopeHints = new Map<string, { chatKey?: string; isolationKey: string; sourceTableKey: string }>();
    const entries: Array<{
        message: any;
        isolationKey: string;
        patch: { summaryVectorIndexState: null; summaryVectorIndexManifest: null };
        expectedIndexId?: string;
    }> = [];

    if (snapshot?.layers?.length) {
        for (const layer of snapshot.layers) {
            const message = chat[layer.messageIndex];
            if (!message || message.is_user) continue;
            const tagData = readIsolatedTagData_ACU(message, layer.isolationKey);
            if (!tagData) continue;
            const manifest = tagData.summaryVectorIndexManifest || tagData.summaryVectorIndexState?.manifest || null;
            if (manifest) {
                const hint = {
                    chatKey: manifest.chatKey || currentChatFileIdentifier_ACU,
                    isolationKey: manifest.isolationKey || layer.isolationKey,
                    sourceTableKey: manifest.sourceTableKey || getCurrentSummaryVectorIndexSourceTableKey_ACU(),
                };
                scopeHints.set(`${hint.chatKey || ''}\n${hint.isolationKey}\n${hint.sourceTableKey}`, hint);
            }
            entries.push({
                message,
                isolationKey: layer.isolationKey,
                patch: { summaryVectorIndexState: null, summaryVectorIndexManifest: null },
                expectedIndexId: manifest?.indexId,
            });
        }
    }

    const changed = await commitVectorMetadataPatchesBatch_ACU(entries);

    const scopeHintList = Array.from(scopeHints.values());
    for (const hint of scopeHintList) {
        await deleteSummaryVectorHotCacheByScope_ACU(hint);
        await clearSummaryVectorFlushTasksByScope_ACU(hint);
    }
    const gcResult = await cleanupUnreachableSummaryVectorIndexFiles_ACU({ scopeHints: scopeHintList });
    return changed || gcResult.deletedPaths.length > 0 || gcResult.failedDeletes.length > 0;
}
