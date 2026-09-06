/**
 * service/chat/chat-service.ts — 聊天数据服务
 *
 * 中转 data/gateways/chat-gateway 的所有方法。
 * presentation 层通过本模块访问聊天数据，不再直接调用 gateway。
 * 后续可在此层统一添加日志、埋点、缓存等增值逻辑。
 */

export {
    getChatArray_ACU,
    getChatLength_ACU,
    getLastMessageIndex_ACU,
    saveChatToHost_ACU,
    saveChatToHostStrict_ACU,
    stopGeneration_ACU,
    deleteLastMessage_ACU,
    setChatMessages_ACU,
    emitMessageUpdated_ACU,
} from '../../data/gateways/chat-gateway';
export { purgeCurrentChatDatabaseState_ACU, type ChatDatabasePurgeResult_ACU } from './chat-database-purge';

import { getChatArray_ACU, saveChatToHost_ACU, saveChatToHostStrict_ACU, setChatMessages_ACU, emitMessageUpdated_ACU } from '../../data/gateways/chat-gateway';
import { logDebug_ACU, logError_ACU, logWarn_ACU, isSummaryOrOutlineTable_ACU } from '../../shared/utils';
import { getLastOptimizationBase_ACU, setLastOptimizationBase_ACU } from '../optimization/content-optimization';
import { settings_ACU, currentChatFileIdentifier_ACU, currentJsonTableData_ACU, getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import { sanitizeSheetForStorage_ACU } from '../template/chat-scope';
import { MESSAGE_TABLE_FIELDS_ACU, clearTableFieldsForIsolation_ACU, collectSqlTargetTableNamesFromStorageFrameV2_ACU, purgeManualRefillIncrementalSheetKeysFromMessage_ACU, purgeSheetKeysFromMessage_ACU, purgeSheetKeysFromMessageForIsolation_ACU, readIsolatedDataContainer_ACU, readIsolatedTagData_ACU, writeMessageIdentity_ACU } from '../../data/repositories/chat-message-data-repo';
import { MAX_CHECKPOINT_RISK_DETAILS_ACU, scanTargetKeysResidue_ACU } from '../../data/repositories/target-keys-diagnostics';
import { LEGACY_CHAT_TABLE_HEADER_GUIDE_FIELD_ACU } from '../../data/storage/chat-history';
import { peekChatScopedConfigContainer_ACU, peekChatSheetGuideContainer_ACU, setChatScopedConfigContainer_ACU, setChatSheetGuideContainer_ACU } from '../../data/storage/chat-history';
import { normalizeSummaryVectorIsolationKey_ACU } from '../../shared/summary-vector-index-scope';
import { runTableUpdateCommit_ACU } from '../table/table-update-commit';
import { getLatestAiMessageIndexFromChat_ACU, resolveTableHistoryStateFromChat_ACU } from '../table/table-history';
import { cleanupUnreachableSummaryVectorIndexFiles_ACU, deleteSummaryVectorIndexExternal_ACU } from '../vector/summary-vector-index-storage-service';
import { assignSummaryVectorIndexStateToTagData_ACU, readSummaryVectorIndexStateFromTagData_ACU } from '../vector/summary-vector-index-state-service';
import type { ChatSummaryVectorIndexManifest_ACU, ChatSummaryVectorIndexState_ACU, SummaryVectorIndexSafeGcScopeHint_ACU } from '../vector/summary-vector-index-types';
import { isV2TagData_ACU, resolveTableStorageStrategy_ACU } from '../table/storage-strategy-resolver';
import { collectScheduleSummaryFromFramesV2_ACU, deriveSheetLifecycleFromFramesV2_ACU, loadTableStateFromFramesV2Detailed_ACU } from '../table/storage-frame-v2-replay';
import { assertSingleActiveFullCheckpointV2_ACU, frameHasSuffixReplayArtifact_ACU } from '../table/storage-frame-v2-persist';
import { runTableWriteTransaction_ACU } from '../table/table-write-transaction';
import { findLatestTransitionCheckpoint_ACU } from '../table/compat-transition-checkpoint';
import { hasActiveProvisionalBridgeAnywhere_ACU, recoverProvisionalBridgeSession_ACU } from '../table/manual-catch-up-provisional-bridge';
import type { TableMutationLogEntryV2_ACU, TableMutationOperationV2_ACU, TableSheetCheckpointV2_ACU, TableStorageFrameV2_ACU, TableV2RecoveryBackup_ACU } from '../table/storage-frame-v2-types';
import type { Sheet_ACU, TableDataObject_ACU } from '../../shared/models/table-data';
import { validateCanonicalCheckpoint_ACU } from '../../shared/canonical-checkpoint-validator';
import { buildCanonicalFullCheckpoint_ACU, buildCanonicalSheetCheckpoint_ACU } from '../table/canonical-checkpoint-builder';
import { getTableDataFingerprint_ACU } from '../table/table-data-upgrade-audit';
import { purgeCurrentChatDatabaseState_ACU, type ChatDatabasePurgeResult_ACU } from './chat-database-purge';

// ─── 业务逻辑函数（从 presentation 层搬迁） ───

const RETAIN_RECENT_CHECKPOINT_BUFFER_LAYERS_ACU = 20;

interface RetainedCheckpointBoundary_ACU {
    shouldCompact: boolean;
    shouldRotateCheckpoint: boolean;
    aiMessageIndices: number[];
    dataMessageIndices: number[];
    effectiveRetainCount: number;
    bufferLayers: number;
    cutoffIndex: number;
    indicesToPurge: number[];
    retainedDataIndices: number[];
    retainedAiStartOrdinal?: number;
    retainedAiEndOrdinal?: number;
    bufferAiStartOrdinal?: number;
    bufferAiEndOrdinal?: number;
    checkpointBufferIndices: number[];
    retainedStartIndex?: number;
    retainedEndIndex?: number;
    checkpointBufferStartIndex?: number;
    checkpointBufferEndIndex?: number;
    anchorIndex?: number;
}

export interface BoundaryCheckpointEnsureResult_ACU {
    success: boolean;
    changed: boolean;
    failedIsolationKey?: string;
    skipped?: boolean;
    error?: string;
    anchorIndex?: number;
}

export interface BoundaryCheckpointEnsureOptions_ACU {
    reason?: 'purge' | 'manual_refill' | 'auto_update';
    save?: boolean;
}

export interface ManualRefillSheetBaselineReplaceOptions_ACU {
    isolationKey: string;
    targetMessageIndices: number[];
    targetSheetKeys: string[];
    targetMessageIndex?: number;
    baselineData: Record<string, any>;
}

export interface ManualRefillSheetSnapshotCommitOptions_ACU {
    isolationKey: string;
    targetMessageIndices: number[];
    targetSheetKeys: string[];
    snapshotData: Record<string, any>;
    /** 仅供已有正式根的调用方显式指定；缺根 fallback 不依赖它。 */
    targetMessageIndex?: number;
    /** 当前聊天作用域已冻结的完整模板；只在全局缺少 full checkpoint 时使用。 */
    templateData?: Record<string, any>;
}


export interface ManualRefillSheetBaselineReplaceResult_ACU {
    success: boolean;
    changed: boolean;
    clearedCount: number;
    checkpointCount: number;
    targetMessageIndex?: number;
    cleanupWarnings?: string[];
    error?: string;
}

async function deleteVectorIndexManifestFromTagData_ACU(
    tagData: any,
    options: { deleteExternal?: boolean; onManifest?: (manifest: any) => void } = {},
): Promise<boolean> {
    if (!tagData || typeof tagData !== 'object') return false;
    const deleteExternal = options.deleteExternal !== false;
    const manifest = tagData.summaryVectorIndexManifest || tagData.summaryVectorIndexState?.manifest || null;
    if (manifest) {
        options.onManifest?.(manifest);
        if (deleteExternal) {
            await deleteSummaryVectorIndexExternal_ACU(manifest);
        }
    }
    const hadState = !!tagData.summaryVectorIndexState || !!tagData.summaryVectorIndexManifest;
    if (hadState) {
        assignSummaryVectorIndexStateToTagData_ACU(tagData, null);
    }
    return hadState || !!manifest;
}

async function cleanupVectorIndexManifestsAfterCommit_ACU(manifests: any[]): Promise<string[]> {
    const warnings: string[] = [];
    for (const manifest of manifests) {
        try {
            await deleteSummaryVectorIndexExternal_ACU(manifest);
        } catch (error: any) {
            const warning = `外置向量索引资源清理失败：${error?.message || String(error || '未知错误')}`;
            warnings.push(warning);
            logWarn_ACU(`[手动重填基底替换] ${warning}`, error);
        }
    }
    return warnings;
}

/**
 * 仅供已持有独占表写事务的复合恢复流程使用。
 * 调用方必须在一次严格聊天保存成功后，再调用 cleanupCheckpointVectorIndexManifestsAfterCommit_ACU。
 */
export async function clearAllAiTableDataForCheckpointRestore_ACU(): Promise<{
    clearedCount: number;
    vectorManifestsToDeleteAfterCommit: any[];
}> {
    const chat = getChatArray_ACU();
    if (!Array.isArray(chat) || chat.length === 0) {
        return { clearedCount: 0, vectorManifestsToDeleteAfterCommit: [] };
    }

    let clearedCount = 0;
    const vectorManifestsToDeleteAfterCommit: any[] = [];
    for (const msg of chat) {
        if (!msg || msg.is_user) continue;
        let changed = false;
        if (msg.TavernDB_ACU_Data) { delete msg.TavernDB_ACU_Data; changed = true; }
        if (msg.TavernDB_ACU_SummaryData) { delete msg.TavernDB_ACU_SummaryData; changed = true; }
        if (msg.TavernDB_ACU_IndependentData) { delete msg.TavernDB_ACU_IndependentData; changed = true; }
        if (msg.TavernDB_ACU_Identity !== undefined) { delete msg.TavernDB_ACU_Identity; changed = true; }
        if (msg.TavernDB_ACU_IsolatedData) {
            const isolatedData = msg.TavernDB_ACU_IsolatedData;
            if (isolatedData && typeof isolatedData === 'object' && !Array.isArray(isolatedData)) {
                for (const key of Object.keys(isolatedData)) {
                    await deleteVectorIndexManifestFromTagData_ACU(isolatedData[key], {
                        deleteExternal: false,
                        onManifest: manifest => vectorManifestsToDeleteAfterCommit.push(manifest),
                    });
                }
            }
            delete msg.TavernDB_ACU_IsolatedData;
            changed = true;
        }
        if (msg.TavernDB_ACU_ModifiedKeys) { delete msg.TavernDB_ACU_ModifiedKeys; changed = true; }
        if (msg.TavernDB_ACU_UpdateGroupKeys) { delete msg.TavernDB_ACU_UpdateGroupKeys; changed = true; }
        if (changed) clearedCount += 1;
    }
    return { clearedCount, vectorManifestsToDeleteAfterCommit };
}

/** 仅供 Checkpoint 严格保存成功后的资源回收调用；失败只返回警告，不撤销已提交聊天数据。 */
export async function cleanupCheckpointVectorIndexManifestsAfterCommit_ACU(manifests: any[]): Promise<string[]> {
    return cleanupVectorIndexManifestsAfterCommit_ACU(manifests);
}

function messageHasLocalLayerData_ACU(msg: any): boolean {
    if (!msg || typeof msg !== 'object') return false;
    return !!(
        msg.TavernDB_ACU_Data ||
        msg.TavernDB_ACU_SummaryData ||
        msg.TavernDB_ACU_IndependentData ||
        msg.TavernDB_ACU_ModifiedKeys ||
        msg.TavernDB_ACU_UpdateGroupKeys ||
        msg.TavernDB_ACU_IsolatedData ||
        msg.TavernDB_ACU_Identity ||
        msg.qrf_plot ||
        msg._qrf_plot_round_id ||
        msg.qrf_plot_preset ||
        msg.qrf_plot_tasks
    );
}

function collectVectorIndexGcScopesFromMessage_ACU(
    msg: any,
    scopeHints: Map<string, SummaryVectorIndexSafeGcScopeHint_ACU>,
): number {
    if (!msg || typeof msg !== 'object') return 0;
    const isolatedData = readIsolatedDataContainer_ACU(msg);
    if (!isolatedData) return 0;

    let manifestCount = 0;
    for (const [tagSlotIsolationKey, tagData] of Object.entries(isolatedData)) {
        const state = readSummaryVectorIndexStateFromTagData_ACU(tagData);
        const manifest = state?.manifest || null;
        if (!manifest) continue;
        const isolationKey = normalizeSummaryVectorIsolationKey_ACU(manifest.isolationKey || tagSlotIsolationKey);
        const sourceTableKey = String(manifest.sourceTableKey || state?.sourceTableKey || '').trim();
        if (!sourceTableKey) {
            logWarn_ACU(`[数据清理] 交火向量 manifest 缺少 sourceTableKey，已跳过自动物理清理：indexId=${manifest.indexId || ''}`);
            continue;
        }
        const hint = {
            chatKey: String(manifest.chatKey || currentChatFileIdentifier_ACU || '').trim(),
            isolationKey,
            sourceTableKey,
        };
        scopeHints.set(`${hint.chatKey}\n${hint.isolationKey}\n${hint.sourceTableKey}`, hint);
        manifestCount += 1;
    }
    return manifestCount;
}

function tableListContainsSummaryOrOutline_ACU(targetSheetKeys: string[]): boolean {
    if (!Array.isArray(targetSheetKeys) || targetSheetKeys.length === 0) return false;
    return targetSheetKeys.some((sheetKey) => {
        const table = currentJsonTableData_ACU?.[sheetKey];
        return !!table?.name && isSummaryOrOutlineTable_ACU(String(table.name || ''));
    });
}

function collectIsolationKeysWithV2Frames_ACU(chat: any[], options: { maxMessageIndex?: number } = {}): string[] {
    const keys = new Set<string>();
    const maxMessageIndex = Number.isInteger(options.maxMessageIndex) ? options.maxMessageIndex as number : Number.POSITIVE_INFINITY;
    for (let i = 0; i < chat.length && i <= maxMessageIndex; i++) {
        const msg = chat[i];
        if (!msg || msg.is_user) continue;
        const isolatedData = msg.TavernDB_ACU_IsolatedData;
        if (!isolatedData || typeof isolatedData !== 'object' || Array.isArray(isolatedData)) continue;
        for (const [isolationKey, tagData] of Object.entries(isolatedData)) {
            if (isV2TagData_ACU(tagData)) {
                keys.add(isolationKey);
            }
        }
    }
    return [...keys];
}

/** 边界 full 判定：compaction（保留层清理前滚）与 periodic（S3-2 距离触发前滚）共享同一套单根滚动语义。 */
function isV2BoundaryCheckpointReason_ACU(reason: unknown): reason is 'compaction' | 'periodic' {
    return reason === 'compaction' || reason === 'periodic';
}

function hasV2CompactionCheckpointAtIndex_ACU(chat: any[], isolationKey: string, messageIndex: number): boolean {
    if (!Array.isArray(chat) || messageIndex < 0 || messageIndex >= chat.length) return false;
    const msg = chat[messageIndex];
    if (!msg || msg.is_user) return false;
    const tagData = readIsolatedTagData_ACU(msg, isolationKey);
    return isV2TagData_ACU(tagData)
        && tagData.storageFrame.checkpoint?.kind === 'full'
        && isV2BoundaryCheckpointReason_ACU(tagData.storageFrame.checkpoint.reason);
}

function resolveLatestCompactionTrigger_ACU(
    chat: any[],
    aiMessageIndices: number[],
    retainCount: number,
    maxAnchorIndex: number | undefined,
): { anchorIndex: number; triggeredAtAiCount: number; usedLegacyFallback: boolean } | null {
    let latest: { anchorIndex: number; checkpoint: any } | null = null;
    for (const messageIndex of aiMessageIndices) {
        if (maxAnchorIndex !== undefined && messageIndex > maxAnchorIndex) continue;
        const isolatedData = chat[messageIndex]?.TavernDB_ACU_IsolatedData;
        if (!isolatedData || typeof isolatedData !== 'object' || Array.isArray(isolatedData)) continue;
        for (const tagData of Object.values(isolatedData)) {
            if (!isV2TagData_ACU(tagData)) continue;
            const checkpoint = tagData.storageFrame.checkpoint;
            if (checkpoint?.kind !== 'full' || !isV2BoundaryCheckpointReason_ACU(checkpoint.reason)) continue;
            if (!latest || messageIndex > latest.anchorIndex) latest = { anchorIndex: messageIndex, checkpoint };
        }
    }
    if (!latest) return null;
    const provenanceCount = Number(latest.checkpoint.compactionProvenance?.triggeredAtAiCount);
    if (Number.isInteger(provenanceCount) && provenanceCount > 0) {
        return { anchorIndex: latest.anchorIndex, triggeredAtAiCount: provenanceCount, usedLegacyFallback: false };
    }
    const anchorAiOrdinal = aiMessageIndices.indexOf(latest.anchorIndex) + 1;
    // 旧 checkpoint 没有 provenance：当前锚点是触发时第
    // (aiCount - retainCount + 1) 个 AI 楼层，因此反推当时 aiCount。
    return {
        anchorIndex: latest.anchorIndex,
        triggeredAtAiCount: anchorAiOrdinal + retainCount - 1,
        usedLegacyFallback: true,
    };
}

function resolveRetainedCheckpointBoundary_ACU(chat: any[], retainCount: number): RetainedCheckpointBoundary_ACU {
    const aiMessageIndices: number[] = [];
    const dataMessageIndices: number[] = [];
    for (let i = 0; i < chat.length; i++) {
        const msg = chat[i];
        if (msg && !msg.is_user) {
            aiMessageIndices.push(i);
        }
        if (messageHasLocalLayerData_ACU(msg)) {
            dataMessageIndices.push(i);
        }
    }

    const bufferLayers = RETAIN_RECENT_CHECKPOINT_BUFFER_LAYERS_ACU;
    const effectiveRetainCount = retainCount + bufferLayers;
    const meetsInitialThreshold = retainCount > 0 && aiMessageIndices.length >= effectiveRetainCount;
    const candidateRetainedAiStartOrdinal = meetsInitialThreshold
        ? Math.max(0, aiMessageIndices.length - retainCount)
        : undefined;
    const candidateAnchorIndex = candidateRetainedAiStartOrdinal !== undefined
        ? aiMessageIndices[candidateRetainedAiStartOrdinal]
        : undefined;
    // 仅能以前移到当前候选边界及之前的 compaction 为节流基准。位于候选边界之后的
    // checkpoint 无法证明保留区之前的数据已折叠，不能阻止本轮建立安全边界。
    const latestCompaction = resolveLatestCompactionTrigger_ACU(chat, aiMessageIndices, retainCount, candidateAnchorIndex);
    const elapsedSinceLastTrigger = latestCompaction
        ? aiMessageIndices.length - latestCompaction.triggeredAtAiCount
        : undefined;
    const hasAdvancedAnchor = candidateAnchorIndex !== undefined
        && (!latestCompaction || candidateAnchorIndex >= latestCompaction.anchorIndex);
    const mustRevisitLegacyCurrentBoundary = latestCompaction?.usedLegacyFallback === true
        && latestCompaction.anchorIndex === candidateAnchorIndex;
    const shouldRotateCheckpoint = meetsInitialThreshold
        && hasAdvancedAnchor
        && (!latestCompaction || mustRevisitLegacyCurrentBoundary || (elapsedSinceLastTrigger as number) >= bufferLayers);
    if (latestCompaction?.usedLegacyFallback) {
        logDebug_ACU(`[V2 Compaction] 旧 compaction checkpoint 缺少 provenance，已按 anchor 反推上次触发 AI 楼层=${latestCompaction.triggeredAtAiCount}。`);
    }
    const shouldCompact = shouldRotateCheckpoint;
    const retainedAiStartOrdinal = shouldRotateCheckpoint ? Math.max(0, aiMessageIndices.length - retainCount) : undefined;
    const retainedAiEndOrdinal = shouldRotateCheckpoint ? aiMessageIndices.length - 1 : undefined;
    const bufferAiStartOrdinal = shouldRotateCheckpoint ? Math.max(0, (retainedAiStartOrdinal as number) - bufferLayers) : undefined;
    const bufferAiEndOrdinal = shouldRotateCheckpoint ? (retainedAiStartOrdinal as number) - 1 : undefined;
    const retainedStartIndex = retainedAiStartOrdinal !== undefined ? aiMessageIndices[retainedAiStartOrdinal] : undefined;
    const retainedEndIndex = retainedAiEndOrdinal !== undefined ? aiMessageIndices[retainedAiEndOrdinal] : undefined;
    const anchorIndex = retainedStartIndex;
    const checkpointBufferIndices = shouldRotateCheckpoint && bufferAiStartOrdinal !== undefined && bufferAiEndOrdinal !== undefined
        ? aiMessageIndices.slice(bufferAiStartOrdinal, bufferAiEndOrdinal + 1)
        : [];
    const checkpointBufferStartIndex = checkpointBufferIndices[0];
    const checkpointBufferEndIndex = checkpointBufferIndices[checkpointBufferIndices.length - 1];
    const indicesToPurge = shouldCompact && anchorIndex !== undefined
        ? dataMessageIndices.filter(index => index < anchorIndex)
        : [];
    const cutoffIndex = indicesToPurge.length;
    const retainedDataIndices = shouldCompact && anchorIndex !== undefined
        ? dataMessageIndices.filter(index => index >= anchorIndex)
        : dataMessageIndices.slice();

    return {
        shouldCompact,
        shouldRotateCheckpoint,
        aiMessageIndices,
        dataMessageIndices,
        effectiveRetainCount,
        bufferLayers,
        cutoffIndex,
        indicesToPurge,
        retainedDataIndices,
        retainedAiStartOrdinal,
        retainedAiEndOrdinal,
        bufferAiStartOrdinal,
        bufferAiEndOrdinal,
        checkpointBufferIndices,
        retainedStartIndex,
        retainedEndIndex,
        checkpointBufferStartIndex,
        checkpointBufferEndIndex,
        anchorIndex,
    };
}

/**
 * periodic 前滚步长（S3-2）：根滚动到尾部缓冲线后，每再累积这么多 AI 楼层就触发下一次前滚。
 * 与 cleanup compaction 的缓冲节流（RETAIN_RECENT_CHECKPOINT_BUFFER_LAYERS_ACU）保持同一节奏。
 */
const PERIODIC_V2_FULL_CHECKPOINT_ROLL_STEP_AI_LAYERS_ACU = 20;

/**
 * S3-2 periodic full checkpoint 冗余：当最陈旧隔离键的 replay 根距聊天尾部过远时，
 * 把单根前滚到尾部缓冲线（reason:'periodic'），消除"根远离尾部 + 超长增量链"的单点。
 *
 * 与 cleanup compaction 的关系：
 * - 复用同一套 core（写锚点 full → 无损降级其余 full → 单根断言），不引入第二基线；
 * - 尾部缓冲取 max(20, retainCount)，保证 periodic 锚点永不越过 cleanup 的未来锚点线
 *   （tail − retainCount），否则 hasAdvancedAnchor 会永久阻塞清理滚动；
 * - 本解析器不清除任何楼层：indicesToPurge 仅表示"锚点前已被新根覆盖的数据帧"，
 *   供 core 准入与诊断，购物式清理仍由 cleanup 流程独立负责。
 */
function resolvePeriodicCheckpointBoundary_ACU(chat: any[], retainCount: number): RetainedCheckpointBoundary_ACU {
    const aiMessageIndices: number[] = [];
    const dataMessageIndices: number[] = [];
    for (let i = 0; i < chat.length; i++) {
        const msg = chat[i];
        if (msg && !msg.is_user) {
            aiMessageIndices.push(i);
        }
        if (messageHasLocalLayerData_ACU(msg)) {
            dataMessageIndices.push(i);
        }
    }

    const bufferLayers = Math.max(RETAIN_RECENT_CHECKPOINT_BUFFER_LAYERS_ACU, Math.max(0, retainCount));
    const stepLayers = PERIODIC_V2_FULL_CHECKPOINT_ROLL_STEP_AI_LAYERS_ACU;
    const noRotate: RetainedCheckpointBoundary_ACU = {
        shouldCompact: false,
        shouldRotateCheckpoint: false,
        aiMessageIndices,
        dataMessageIndices,
        effectiveRetainCount: bufferLayers + stepLayers,
        bufferLayers,
        cutoffIndex: 0,
        indicesToPurge: [],
        retainedDataIndices: dataMessageIndices.slice(),
        checkpointBufferIndices: [],
    };

    // 最陈旧根：每个 V2 隔离键取最后一个 full checkpoint 的位置；退化历史（有帧无 full）
    // 取该键首个 V2 帧位置——此时 periodic 写入同时修复该键的根缺失。
    let stalestRootIndex: number | undefined;
    for (const isolationKey of collectIsolationKeysWithV2Frames_ACU(chat)) {
        const fullRefs = collectV2FullCheckpointRefsForIsolation_ACU(chat, isolationKey);
        let rootIndex: number | undefined = fullRefs.length > 0
            ? fullRefs[fullRefs.length - 1].messageIndex
            : undefined;
        if (rootIndex === undefined) {
            for (let i = 0; i < chat.length; i++) {
                const tagData = readIsolatedTagData_ACU(chat[i], isolationKey);
                if (isV2TagData_ACU(tagData)) {
                    rootIndex = i;
                    break;
                }
            }
        }
        if (rootIndex === undefined) continue;
        if (stalestRootIndex === undefined || rootIndex < stalestRootIndex) {
            stalestRootIndex = rootIndex;
        }
    }
    if (stalestRootIndex === undefined) return noRotate;

    const aiTotal = aiMessageIndices.length;
    const rootAiOrdinal = countAiFloorAtMessage_ACU(chat, stalestRootIndex);
    const distanceLayers = aiTotal - rootAiOrdinal;
    const anchorAiOrdinal = aiTotal - bufferLayers;
    if (distanceLayers < bufferLayers + stepLayers || anchorAiOrdinal < 1) return noRotate;

    const anchorIndex = aiMessageIndices[anchorAiOrdinal - 1];
    // 只进不退：锚点必须严格晚于最陈旧根，否则前滚没有意义。
    if (anchorIndex === undefined || anchorIndex <= stalestRootIndex) return noRotate;

    const indicesToPurge = dataMessageIndices.filter(index => index < anchorIndex);
    if (indicesToPurge.length === 0) return noRotate;

    return {
        ...noRotate,
        shouldRotateCheckpoint: true,
        indicesToPurge,
        retainedDataIndices: dataMessageIndices.filter(index => index >= anchorIndex),
        anchorIndex,
    };
}

function countAiFloorAtMessage_ACU(chat: any[], messageIndex: number): number {
    let count = 0;
    for (let i = 0; i <= messageIndex && i < chat.length; i += 1) {
        if (chat[i] && !chat[i].is_user) count += 1;
    }
    return count;
}

function downgradeV2FullCheckpointAtIndex_ACU(chat: any[], isolationKey: string, messageIndex: number): boolean {
    const msg = chat?.[messageIndex];
    if (!msg || msg.is_user) return false;
    const tagData = readIsolatedTagData_ACU(msg, isolationKey);
    if (!isV2TagData_ACU(tagData)) return false;

    const frame = tagData.storageFrame;
    const checkpoint = frame.checkpoint;
    if (checkpoint?.kind !== 'full') return false;

    const existingEntries = Array.isArray(frame.logEntries) ? frame.logEntries : [];
    const finiteSeqs = existingEntries.map(entry => Number(entry.seq)).filter(Number.isFinite);
    const minSeq = finiteSeqs.length > 0 ? Math.min(...finiteSeqs) : 1;
    const seq = Math.min(0, minSeq - 1);
    const fallbackData = JSON.parse(JSON.stringify(checkpoint.data || {}));
    const sheetCheckpoints = frame.perSheetCheckpoints;
    if (sheetCheckpoints && typeof sheetCheckpoints === 'object' && !Array.isArray(sheetCheckpoints)) {
        for (const [sheetKey, sheetCheckpoint] of Object.entries(sheetCheckpoints)) {
            if (
                !sheetKey.startsWith('sheet_')
                || !sheetCheckpoint
                || sheetCheckpoint.kind !== 'sheet_full'
                || sheetCheckpoint.sheetKey !== sheetKey
                || !sheetCheckpoint.data
                || typeof sheetCheckpoint.data !== 'object'
                || Array.isArray(sheetCheckpoint.data)
            ) continue;
            // P5：timed 单表 checkpoint（sheet_rebase / sheet_hide / sheet_reveal /
            // sheet_introduction）必须保留在 perSheetCheckpoints 里由回放按
            // activateAtMessageIndex + afterSeq 调度，不能并入 data_replace 基底，
            // 否则事件会被提前到帧首生效（例如 hide 的表出现在替换状态、rebase
            // 的新结构覆盖了该帧更早的操作）。untimed checkpoint 才是帧首事实。
            if (sheetCheckpoint.timeline !== undefined) continue;
            fallbackData[sheetKey] = JSON.parse(JSON.stringify(sheetCheckpoint.data));
        }
    }
    const sheetKeys = Object.keys(fallbackData).filter(key => key.startsWith('sheet_'));
    const downgradeEntry: TableMutationLogEntryV2_ACU = {
        seq,
        entryId: `downgraded-checkpoint-${messageIndex}-${checkpoint.createdAt || Date.now()}`,
        createdAt: checkpoint.createdAt || Date.now(),
        source: 'system',
        targetMessageIndex: messageIndex,
        aiFloor: countAiFloorAtMessage_ACU(chat, messageIndex),
        filledSheetKeys: sheetKeys,
        changedSheetKeys: sheetKeys,
        groupKeys: [],
        operations: [{ kind: 'data_replace', data: fallbackData, reason: 'checkpoint_fallback' }],
        writeSet: [{ kind: 'all' }],
    };
    frame.logEntries = [downgradeEntry, ...existingEntries];
    delete frame.checkpoint;
    return true;
}


function downgradeCoveredV2FullCheckpointsAfterAnchor_ACU(chat: any[], anchorIndex: number): number {
    if (!Array.isArray(chat) || anchorIndex < 0 || anchorIndex >= chat.length) return 0;

    let downgradedCount = 0;
    const isolationKeys = collectIsolationKeysWithV2Frames_ACU(chat);
    for (const isolationKey of isolationKeys) {
        if (!hasV2CompactionCheckpointAtIndex_ACU(chat, isolationKey, anchorIndex)) continue;

        for (let i = anchorIndex + 1; i < chat.length; i += 1) {
            const msg = chat[i];
            if (!msg || msg.is_user) continue;
            const tagData = readIsolatedTagData_ACU(msg, isolationKey);
            if (!isV2TagData_ACU(tagData) || tagData.storageFrame.checkpoint?.kind !== 'full') continue;
            if (downgradeV2FullCheckpointAtIndex_ACU(chat, isolationKey, i)) downgradedCount += 1;
        }
    }

    return downgradedCount;
}

function downgradeObsoleteInitialV2FullCheckpointsBeforeCompaction_ACU(chat: any[], anchorIndex: number): number {
    if (!Array.isArray(chat) || anchorIndex < 0 || anchorIndex >= chat.length) return 0;

    let downgradedCount = 0;
    const isolationKeys = collectIsolationKeysWithV2Frames_ACU(chat);
    for (const isolationKey of isolationKeys) {
        if (!hasV2CompactionCheckpointAtIndex_ACU(chat, isolationKey, anchorIndex)) continue;
        for (let i = 0; i < anchorIndex; i += 1) {
            const tagData = readIsolatedTagData_ACU(chat[i], isolationKey);
            if (!isV2TagData_ACU(tagData)) continue;
            const checkpoint = tagData.storageFrame.checkpoint;
            // compaction 已在新边界固化真实 replay 结果。anchor 前的任何旧 full
            // （init / periodic / manual / schema_change / compaction / import /
            // migration / integrity_repair / 模板临时根）都必须随之降级，否则同一
            // isolationKey 会遗留两个 full checkpoint：回放只认最后一个 full，
            // 之前增量全部失效，后续手动重填也会 fail closed。
            // 降级是无损的（checkpoint.data → seq ≤ 0 的 data_replace fallback entry），
            // 数学上不改变回放输出，P5-3 用指纹比对实测举证。
            if (checkpoint?.kind !== 'full') continue;
            if (downgradeV2FullCheckpointAtIndex_ACU(chat, isolationKey, i)) downgradedCount += 1;
        }
    }
    return downgradedCount;
}

function collectV2FullCheckpointRefsForIsolation_ACU(chat: any[], isolationKey: string): Array<{ messageIndex: number; checkpoint: any }> {
    const refs: Array<{ messageIndex: number; checkpoint: any }> = [];
    if (!Array.isArray(chat)) return refs;
    for (let i = 0; i < chat.length; i += 1) {
        const tagData = readIsolatedTagData_ACU(chat[i], isolationKey);
        if (!isV2TagData_ACU(tagData)) continue;
        const checkpoint = tagData.storageFrame.checkpoint;
        if (checkpoint?.kind === 'full') refs.push({ messageIndex: i, checkpoint });
    }
    return refs;
}

async function ensureV2BoundaryCheckpointForRetainedBufferCore_ACU(
    chat: any[],
    boundary: RetainedCheckpointBoundary_ACU,
    options: BoundaryCheckpointEnsureOptions_ACU = {},
    checkpointReason: 'compaction' | 'periodic' = 'compaction',
): Promise<BoundaryCheckpointEnsureResult_ACU> {
    if (!boundary.shouldRotateCheckpoint || boundary.indicesToPurge.length === 0) {
        return { success: true, changed: false, skipped: true };
    }

    const anchorIndex = boundary.anchorIndex;
    if (anchorIndex !== undefined && anchorIndex >= 0 && chat[anchorIndex]) {
        const snapshots = new Map<number, ReturnType<typeof messageFieldSnapshot_ACU>>();
        chat.forEach((message, messageIndex) => {
            const isolatedData = message?.TavernDB_ACU_IsolatedData;
            const hasV2Frame = isolatedData
                && typeof isolatedData === 'object'
                && !Array.isArray(isolatedData)
                && Object.values(isolatedData).some(tagData => isV2TagData_ACU(tagData));
            const hasTransitionCheckpoint = isolatedData
                && typeof isolatedData === 'object'
                && !Array.isArray(isolatedData)
                && Object.values(isolatedData).some(tagData => (
                    !!tagData && typeof tagData === 'object'
                    && ((tagData as any).spv79TransitionCheckpoint?.kind === 'spv79_duplicate_row_id_transition'
                        || (tagData as any).compatTransitionCheckpoint?.kind === 'compat_replay_transition')
                ));
            if (messageIndex === anchorIndex || hasV2Frame || hasTransitionCheckpoint) {
                snapshots.set(messageIndex, messageFieldSnapshot_ACU(message));
            }
        });
        try {
            const changed = await writeV2BoundaryCheckpointBeforePurge_ACU(chat, anchorIndex, checkpointReason);
            const downgradedCount = downgradeCoveredV2FullCheckpointsAfterAnchor_ACU(chat, anchorIndex);
            const obsoleteInitDowngradedCount = downgradeObsoleteInitialV2FullCheckpointsBeforeCompaction_ACU(chat, anchorIndex);
            // 单根不变量：降级后同一隔离键必须至多一个 full checkpoint，
            // 否则写新边界基线前就把历史搞成多根，回放只认最后一个，之前增量全部失效。
            for (const isolationKey of collectIsolationKeysWithV2Frames_ACU(chat)) {
                const invariantViolation = assertSingleActiveFullCheckpointV2_ACU(chat, isolationKey, `${checkpointReason}_boundary`);
                if (invariantViolation) {
                    throw new Error(invariantViolation);
                }
            }
            if ((changed || downgradedCount > 0 || obsoleteInitDowngradedCount > 0) && options.save !== false) {
                await saveChatToHostStrict_ACU();
            }
            return { success: true, changed: changed || downgradedCount > 0 || obsoleteInitDowngradedCount > 0, anchorIndex };
        } catch (error: any) {
            snapshots.forEach((snapshot, messageIndex) => restoreMessageFieldSnapshot_ACU(chat[messageIndex], snapshot));
            return {
                success: false,
                changed: false,
                error: error?.message || String(error || '边界 checkpoint 写入失败。'),
                ...(typeof error?.failedIsolationKey === 'string' ? { failedIsolationKey: error.failedIsolationKey } : {}),
                anchorIndex,
            };
        }
    }

    const purgeEndIndex = boundary.indicesToPurge[boundary.indicesToPurge.length - 1];
    if (collectIsolationKeysWithV2Frames_ACU(chat, { maxMessageIndex: purgeEndIndex }).length > 0) {
        return {
            success: false,
            changed: false,
            error: `最新保留 AI 楼层窗口的边界处找不到可写入 checkpoint 的 AI 楼层（保留 ${boundary.effectiveRetainCount - boundary.bufferLayers} 个 AI 楼层，缓冲 ${boundary.bufferLayers} 个 AI 楼层）。`,
        };
    }

    return { success: true, changed: false, skipped: true };
}

export function shouldRotateV2BoundaryCheckpointForRetainedBuffer_ACU(): boolean {
    const retainCount = settings_ACU.retainRecentLayers || 0;

    const chat = getChatArray_ACU();
    if (!chat || !Array.isArray(chat) || chat.length === 0) return false;

    if (retainCount > 0) {
        const boundary = resolveRetainedCheckpointBoundary_ACU(chat, retainCount);
        if (boundary.shouldRotateCheckpoint && boundary.indicesToPurge.length > 0 && boundary.anchorIndex !== undefined) {
            return true;
        }
    }

    // S3-2：cleanup 边界不滚动时，检查 periodic 前滚是否到期（含 retain=0 清理禁用场景）。
    const periodicBoundary = resolvePeriodicCheckpointBoundary_ACU(chat, retainCount);
    return periodicBoundary.shouldRotateCheckpoint && periodicBoundary.anchorIndex !== undefined;
}

export async function ensureV2BoundaryCheckpointForRetainedBuffer_ACU(
    options: BoundaryCheckpointEnsureOptions_ACU = {},
): Promise<BoundaryCheckpointEnsureResult_ACU> {
    // provisional bridge 活跃期间禁止 compaction：compaction 会直接改写帧、绕过
    // persistTableMutationLogV2_ACU 的 bridge 准入，可能把原 full 降级或在新位置写
    // full checkpoint，破坏"原 full 边界前不得推进锚点"的拓扑冻结约束。
    // 崩溃残留 bridge（应用重启后触发 auto_update/manual_refill 的 compaction）必须先
    // 自动恢复（零提交回滚 / 有提交 finalize）；恢复失败则 fail-closed，不进入 compaction。
    // 注意：recover 自身会开启 exclusive write transaction，必须在 compaction 的
    // transaction 之外调用，避免嵌套事务死锁。
    const preflightChat = getChatArray_ACU();
    if (hasActiveProvisionalBridgeAnywhere_ACU(preflightChat)) {
        const recovery = await recoverProvisionalBridgeSession_ACU({ isolationKey: getCurrentIsolationKey_ACU() });
        if (!recovery.ok) {
            return { success: false, changed: false, error: `检测到 active provisional bridge 且自动恢复失败，已阻止边界 compaction：${(recovery as { ok: false; error: string }).error}` };
        }
    }
    return runTableWriteTransaction_ACU({
        source: 'system_cleanup',
        reason: options.reason === 'manual_refill'
            ? 'manual_refill_boundary_checkpoint'
            : (options.reason === 'auto_update' ? 'auto_update_boundary_checkpoint' : 'ensureRetainedBoundaryCheckpoint'),
        isolationKey: getCurrentIsolationKey_ACU(),
        writeSet: [{ kind: 'all' }],
        maintenanceMode: 'exclusive',
    }, async () => {
        const retainCount = settings_ACU.retainRecentLayers || 0;

        const chat = getChatArray_ACU();
        if (!chat || !Array.isArray(chat) || chat.length === 0) {
            logDebug_ACU('[V2 Compaction] 聊天记录为空，跳过边界 checkpoint 建立。');
            return { success: true, changed: false, skipped: true };
        }

        // 保留层清理边界优先：cleanup 可滚动时按原语义写 reason:'compaction'。
        if (retainCount > 0) {
            const boundary = resolveRetainedCheckpointBoundary_ACU(chat, retainCount);
            if (boundary.shouldRotateCheckpoint) {
                return ensureV2BoundaryCheckpointForRetainedBufferCore_ACU(chat, boundary, options, 'compaction');
            }
            logDebug_ACU(`[V2 Compaction] AI 楼层总数(${boundary.aiMessageIndices.length}) < 滚动触发层数(${boundary.effectiveRetainCount}=保留${retainCount}+缓冲${RETAIN_RECENT_CHECKPOINT_BUFFER_LAYERS_ACU})，检查 periodic 前滚。`);
        }

        // S3-2 periodic 前滚：cleanup 不滚动（含 retain=0 清理禁用）时，若 replay 根距
        // 尾部超过缓冲+步长阈值，则把单根前滚到尾部缓冲线并写 reason:'periodic' full。
        const periodicBoundary = resolvePeriodicCheckpointBoundary_ACU(chat, retainCount);
        if (periodicBoundary.shouldRotateCheckpoint) {
            logDebug_ACU(`[V2 Compaction] periodic 前滚触发：锚点楼层 #${periodicBoundary.anchorIndex}，尾部缓冲 ${periodicBoundary.bufferLayers} 层。`);
            return ensureV2BoundaryCheckpointForRetainedBufferCore_ACU(chat, periodicBoundary, options, 'periodic');
        }

        return { success: true, changed: false, skipped: true };
    });
}


interface BoundaryVectorPointerCandidate_ACU {
    messageIndex: number;
    state: ChatSummaryVectorIndexState_ACU;
    manifest: ChatSummaryVectorIndexManifest_ACU;
}

function getBoundaryVectorPointerRevision_ACU(manifest: ChatSummaryVectorIndexManifest_ACU): number {
    const storageRevision = Number(manifest.storageIdentity?.revision || 0);
    const snapshotRevision = Number(manifest.snapshot?.revision || 0);
    if (storageRevision > 0 && snapshotRevision > 0 && storageRevision !== snapshotRevision) {
        throw new Error(`边界向量指针身份不一致：indexId=${manifest.indexId}, storageRevision=${storageRevision}, snapshotRevision=${snapshotRevision}`);
    }
    return Math.max(storageRevision, snapshotRevision, 0);
}

function compareBoundaryVectorPointerCandidate_ACU(
    left: BoundaryVectorPointerCandidate_ACU,
    right: BoundaryVectorPointerCandidate_ACU,
): number {
    const revisionDiff = getBoundaryVectorPointerRevision_ACU(left.manifest) - getBoundaryVectorPointerRevision_ACU(right.manifest);
    if (revisionDiff !== 0) return revisionDiff;
    const leftTime = Date.parse(String(left.manifest.updatedAt || left.manifest.indexedAt || ''));
    const rightTime = Date.parse(String(right.manifest.updatedAt || right.manifest.indexedAt || ''));
    const timeDiff = (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0);
    if (timeDiff !== 0) return timeDiff;
    return left.messageIndex - right.messageIndex;
}

function relocateLatestSummaryVectorPointerToBoundary_ACU(
    chat: any[],
    boundaryAnchorIndex: number,
    isolationKey: string,
): boolean {
    const candidatesBySourceTable = new Map<string, BoundaryVectorPointerCandidate_ACU[]>();
    const canonicalIsolationKey = normalizeSummaryVectorIsolationKey_ACU(isolationKey);
    for (let messageIndex = 0; messageIndex < chat.length; messageIndex += 1) {
        const message = chat[messageIndex];
        if (!message || message.is_user) continue;
        const tagData = readIsolatedTagData_ACU(message, isolationKey);
        const state = readSummaryVectorIndexStateFromTagData_ACU(tagData);
        const manifests = [state?.manifest, tagData?.summaryVectorIndexManifest]
            .filter((manifest): manifest is ChatSummaryVectorIndexManifest_ACU => !!manifest);
        const seenManifestIdentities = new Set<string>();
        for (const manifest of manifests) {
            const identityKey = JSON.stringify([
                manifest.indexId,
                manifest.manifestFile,
                manifest.storageIdentity?.writeGeneration,
                manifest.storageIdentity?.revision ?? manifest.snapshot?.revision,
            ]);
            if (seenManifestIdentities.has(identityKey)) continue;
            seenManifestIdentities.add(identityKey);
            if (!state) continue;
            if (manifest.status !== 'ready') {
                if (messageIndex < boundaryAnchorIndex) {
                    throw new Error(`边界向量指针不可迁移：indexId=${manifest.indexId}, status=${manifest.status}`);
                }
                continue;
            }
            if (normalizeSummaryVectorIsolationKey_ACU(manifest.isolationKey) !== canonicalIsolationKey) {
                throw new Error(`边界向量指针 scope 不匹配：tagSlot=${isolationKey || '(default)'}, manifestIsolation=${manifest.isolationKey || '(empty)'}, indexId=${manifest.indexId}`);
            }
            getBoundaryVectorPointerRevision_ACU(manifest);
            const sourceTableKey = String(manifest.sourceTableKey || state.sourceTableKey || '').trim();
            if (!sourceTableKey) throw new Error(`边界向量指针缺少 sourceTableKey：indexId=${manifest.indexId}`);
            const candidates = candidatesBySourceTable.get(sourceTableKey) || [];
            candidates.push({ messageIndex, state: { ...state, manifest }, manifest });
            candidatesBySourceTable.set(sourceTableKey, candidates);
        }
    }

    const relocations = Array.from(candidatesBySourceTable.values())
        .map((candidates) => {
            const highestRevision = Math.max(...candidates.map((candidate) => getBoundaryVectorPointerRevision_ACU(candidate.manifest)));
            const newestCandidates = candidates.filter((candidate) => getBoundaryVectorPointerRevision_ACU(candidate.manifest) === highestRevision);
            const v2IdentityKeys = new Set(newestCandidates
                .filter((candidate) => !!candidate.manifest.storageIdentity)
                .map((candidate) => JSON.stringify([
                    candidate.manifest.indexId,
                    candidate.manifest.manifestFile,
                    candidate.manifest.storageIdentity?.writeGeneration,
                ])));
            if (v2IdentityKeys.size > 1) {
                throw new Error(`边界向量指针存在同 scope 同 revision 的多个 immutable generation，拒绝猜测迁移：sourceTableKey=${newestCandidates[0].manifest.sourceTableKey}, revision=${highestRevision}`);
            }
            return newestCandidates.reduce((latest, candidate) => (
                compareBoundaryVectorPointerCandidate_ACU(candidate, latest) > 0 ? candidate : latest
            ));
        })
        .filter((candidate) => candidate.messageIndex < boundaryAnchorIndex);
    if (relocations.length === 0) return false;
    if (relocations.length > 1) {
        throw new Error(`边界向量指针存在多个待迁移 sourceTableKey，单一 tag slot 无法安全承载：isolationKey=${isolationKey || '(default)'}`);
    }

    const candidate = relocations[0];
    const anchorMessage = chat[boundaryAnchorIndex];
    const anchorContainer = readIsolatedDataContainer_ACU(anchorMessage);
    const anchorTagData = anchorContainer?.[isolationKey];
    if (!anchorTagData || typeof anchorTagData !== 'object') {
        throw new Error(`边界向量指针迁移失败：anchor 缺少 isolationKey=[${isolationKey || '无标签'}] 的 tag slot`);
    }
    const anchorState = readSummaryVectorIndexStateFromTagData_ACU(anchorTagData);
    if (anchorState?.manifest && anchorState.manifest.sourceTableKey !== candidate.manifest.sourceTableKey) {
        throw new Error(`边界向量指针迁移会覆盖其他 sourceTableKey：anchor=${anchorState.manifest.sourceTableKey}, candidate=${candidate.manifest.sourceTableKey}`);
    }
    assignSummaryVectorIndexStateToTagData_ACU(anchorTagData, candidate.state, candidate.manifest);
    logDebug_ACU(`[V2 Compaction] 已将交火向量 immutable pointer 迁移到边界楼层 #${boundaryAnchorIndex}：isolationKey=[${isolationKey || '无标签'}], indexId=${candidate.manifest.indexId}`);
    return true;
}

async function writeV2BoundaryCheckpointBeforePurge_ACU(
    chat: any[],
    boundaryAnchorIndex: number,
    checkpointReason: 'compaction' | 'periodic' = 'compaction',
): Promise<boolean> {
    if (boundaryAnchorIndex < 0 || !chat[boundaryAnchorIndex] || chat[boundaryAnchorIndex].is_user) {
        throw new Error(`边界 checkpoint 写入失败：boundaryAnchorIndex=${boundaryAnchorIndex} 不是有效 AI 楼层。`);
    }

    let changed = false;
    const isolationConfig = {
        enabled: settings_ACU.dataIsolationEnabled,
        code: settings_ACU.dataIsolationCode,
    };
    const aiCountAtTrigger = chat.reduce((count, message) => count + (message && !message.is_user ? 1 : 0), 0);
    const retainCount = settings_ACU.retainRecentLayers || 0;
    const compactionProvenance = {
        version: 1 as const,
        triggeredAtAiCount: aiCountAtTrigger,
        retainCount,
        bufferLayers: RETAIN_RECENT_CHECKPOINT_BUFFER_LAYERS_ACU,
    };

    // 普通 V2 frame 只需在边界及之前收集；但 SPv7.9 私有过渡根即使位于边界之后，
    // 也必须纳入检查，否则本轮会在完全不知道该根存在的情况下 purge 它之前的历史。
    const isolationKeys = new Set(collectIsolationKeysWithV2Frames_ACU(chat, { maxMessageIndex: boundaryAnchorIndex }));
    for (const message of chat) {
        if (!message || message.is_user) continue;
        const isolatedData = message.TavernDB_ACU_IsolatedData;
        if (!isolatedData || typeof isolatedData !== 'object' || Array.isArray(isolatedData)) continue;
        for (const [isolationKey, tagData] of Object.entries(isolatedData)) {
            if (tagData && typeof tagData === 'object'
                && ((tagData as any).spv79TransitionCheckpoint?.kind === 'spv79_duplicate_row_id_transition'
                    || (tagData as any).compatTransitionCheckpoint?.kind === 'compat_replay_transition')) {
                isolationKeys.add(isolationKey);
            }
        }
    }
    for (const isolationKey of isolationKeys) {
        const strategy = resolveTableStorageStrategy_ACU(chat, isolationKey, isolationConfig);
        if (strategy.mode !== 'v2') continue;

        const transitionRef = findLatestTransitionCheckpoint_ACU(chat, isolationKey);
        if (transitionRef && boundaryAnchorIndex < transitionRef.messageIndex) {
            // 私有根已经是完整 canonical 状态，且位于本轮保留边界之后；旧历史即使被
            // purge 也不能再反向决定该根是否有效。此轮无需为该隔离域另写更早的 full，
            // 直接保留私有根，避免把原本可读取的旧聊天挡在 compaction 准入之外。
            logDebug_ACU(`[V2 Compaction] isolationKey=[${isolationKey || '无标签'}] 的 SPv7.9 过渡根位于保留边界之后，跳过本轮边界 full。`);
            continue;
        }

        const pointerRelocated = relocateLatestSummaryVectorPointerToBoundary_ACU(chat, boundaryAnchorIndex, isolationKey);
        if (pointerRelocated) changed = true;
        const hasExistingBoundaryCheckpoint = hasV2CompactionCheckpointAtIndex_ACU(chat, isolationKey, boundaryAnchorIndex);
        if (hasExistingBoundaryCheckpoint && !transitionRef) {
            logDebug_ACU(`[V2 Compaction] AI 保留边界楼层 #${boundaryAnchorIndex} 已存在 isolationKey=[${isolationKey || '无标签'}] 的 compaction full checkpoint，跳过 frame 重建。`);
            continue;
        }

        // 已有边界 full 不能让 active transition 直接短路：同一楼层时 transition
        // 仍优先于 full 作为 replay root；不同楼层时陈旧私有根也可能在后续拓扑变化后复活。
        // 只有证明现存 full 严格等价于 transition replay，才能在同一次提交中移除私有根。
        if (hasExistingBoundaryCheckpoint && transitionRef) {
            const transitionReplay = await loadTableStateFromFramesV2Detailed_ACU(chat, isolationKey, {
                maxMessageIndex: boundaryAnchorIndex,
                updateRuntimeState: false,
            });
            if (!transitionReplay) {
                const error = new Error(`边界 checkpoint 收敛失败：无法读取 isolationKey=[${isolationKey || '无标签'}] 的过渡根状态。`) as Error & { failedIsolationKey?: string };
                error.failedIsolationKey = isolationKey;
                throw error;
            }
            const candidateChat = structuredClone(chat);
            const candidateTransitionTagData = candidateChat[transitionRef.messageIndex]
                ?.TavernDB_ACU_IsolatedData?.[isolationKey];
            if (candidateTransitionTagData && typeof candidateTransitionTagData === 'object') {
                delete candidateTransitionTagData.spv79TransitionCheckpoint;
                delete candidateTransitionTagData.compatTransitionCheckpoint;
            }
            const strictReplay = await loadTableStateFromFramesV2Detailed_ACU(candidateChat, isolationKey, {
                maxMessageIndex: boundaryAnchorIndex,
                updateRuntimeState: false,
                compatibilityMode: 'disabled',
            });
            if (!strictReplay
                || strictReplay.requiresCheckpointConvergence
                || strictReplay.compatibilityRepairs?.length
                || getTableDataFingerprint_ACU(strictReplay.data) !== getTableDataFingerprint_ACU(transitionReplay.data)) {
                const error = new Error(`边界 checkpoint 收敛失败：已有 compaction full 无法严格替代过渡根（isolationKey=[${isolationKey || '无标签'}]）。`) as Error & { failedIsolationKey?: string };
                error.failedIsolationKey = isolationKey;
                throw error;
            }
            const transitionMessage = chat[transitionRef.messageIndex];
            const transitionTagData = transitionMessage?.TavernDB_ACU_IsolatedData?.[isolationKey];
            if (transitionTagData && typeof transitionTagData === 'object') {
                delete transitionTagData.spv79TransitionCheckpoint;
                delete transitionTagData.compatTransitionCheckpoint;
            }
            changed = true;
            logDebug_ACU(`[V2 Compaction] 已验证既有边界 full 并移除 isolationKey=[${isolationKey || '无标签'}] 的过渡根。`);
            continue;
        }

        let replay: Awaited<ReturnType<typeof loadTableStateFromFramesV2Detailed_ACU>>;
        try {
            replay = await loadTableStateFromFramesV2Detailed_ACU(chat, isolationKey, { maxMessageIndex: boundaryAnchorIndex });
        } catch (error: unknown) {
            const replayError = new Error(error instanceof Error ? error.message : String(error ?? '未知 replay 错误。')) as Error & { cause?: unknown; failedIsolationKey?: string };
            replayError.cause = error;
            replayError.failedIsolationKey = isolationKey;
            throw replayError;
        }
        if (!replay) {
            const error = new Error(`边界 checkpoint 写入失败：无法在 boundaryAnchorIndex=${boundaryAnchorIndex} 前恢复 isolationKey=[${isolationKey || '无标签'}] 的 V2 数据。`) as Error & { failedIsolationKey?: string };
            error.failedIsolationKey = isolationKey;
            throw error;
        }
        const data = replay.data;

        const anchorMsg = chat[boundaryAnchorIndex];
        if (!anchorMsg.TavernDB_ACU_IsolatedData || typeof anchorMsg.TavernDB_ACU_IsolatedData !== 'object' || Array.isArray(anchorMsg.TavernDB_ACU_IsolatedData)) {
            anchorMsg.TavernDB_ACU_IsolatedData = {};
        }

        const existingTagData = anchorMsg.TavernDB_ACU_IsolatedData[isolationKey];
        const checkpoint = {
            kind: 'full' as const,
            createdAt: Date.now(),
            reason: checkpointReason,
            data,
            scheduleSummary: collectScheduleSummaryFromFramesV2_ACU(chat, isolationKey, { maxMessageIndex: boundaryAnchorIndex }),
            compactionProvenance,
        };
        const validation = validateCanonicalCheckpoint_ACU(checkpoint, {
            messageIndex: boundaryAnchorIndex,
            isolationKey,
            reason: checkpointReason,
        });
        if (!validation.valid) {
            const issueSummary = validation.issues
                .slice(0, MAX_CHECKPOINT_RISK_DETAILS_ACU)
                .map(issue => `${issue.sheetKey || 'root'}:${issue.rowIndex ?? '-'}:${issue.type}`)
                .join(', ');
            const error = new Error(`边界 checkpoint 写入失败：replay 结果未满足 canonical 契约（${issueSummary}）。`) as Error & { failedIsolationKey?: string };
            error.failedIsolationKey = isolationKey;
            throw error;
        }

        // 隐藏表不在 replay state 中（replay 遇 hide checkpoint 会 delete 该表），
        // 因此 full checkpoint.data 不含它们。若边界 frame 不带上这些 hide checkpoint，
        // 旧楼层被 purge 后隐藏表数据将永久丢失，后续 reveal 必然 not_found。
        const lifecycle = deriveSheetLifecycleFromFramesV2_ACU(chat, isolationKey, {
            maxMessageIndex: boundaryAnchorIndex,
        });
        const migratedHiddenCheckpoints: Record<string, TableSheetCheckpointV2_ACU> = {};
        for (const hiddenSheetKey of lifecycle.hiddenSheetKeys) {
            const entry = lifecycle.statusBySheetKey[hiddenSheetKey];
            const restoreData = entry?.restoreSourceData;
            if (!restoreData) {
                const error = new Error(
                    `边界 checkpoint 写入失败：隐藏表 ${hiddenSheetKey} 缺少可迁移的 hide checkpoint 数据`
                    + `（isolationKey=[${isolationKey || '无标签'}]）。`,
                ) as Error & { failedIsolationKey?: string };
                error.failedIsolationKey = isolationKey;
                throw error;
            }
            const built = buildCanonicalSheetCheckpoint_ACU({
                createdAt: Date.now(),
                reason: checkpointReason,
                sheetKey: hiddenSheetKey,
                data: JSON.parse(JSON.stringify(restoreData)),
                context: { messageIndex: boundaryAnchorIndex, isolationKey, reason: checkpointReason },
            });
            if (!built.checkpoint) {
                const error = new Error(
                    `边界 checkpoint 写入失败：隐藏表 ${hiddenSheetKey} 的迁移 checkpoint 不合法：${built.error}`,
                ) as Error & { failedIsolationKey?: string };
                error.failedIsolationKey = isolationKey;
                throw error;
            }
            migratedHiddenCheckpoints[hiddenSheetKey] = {
                ...built.checkpoint,
                timeline: {
                    kind: 'sheet_hide',
                    activateAtMessageIndex: boundaryAnchorIndex,
                    afterSeq: 0,
                },
            };
        }

        const frame: TableStorageFrameV2_ACU = {
            version: 2,
            checkpoint,
            logEntries: [],
            ...(Object.keys(migratedHiddenCheckpoints).length > 0
                ? { perSheetCheckpoints: migratedHiddenCheckpoints }
                : {}),
        };

        if (transitionRef || replay.requiresCheckpointConvergence || replay.compatibilityRepairs?.length) {
            const candidateChat = structuredClone(chat);
            const candidateAnchor = candidateChat[boundaryAnchorIndex];
            const candidateExistingTagData = candidateAnchor?.TavernDB_ACU_IsolatedData?.[isolationKey];
            candidateAnchor.TavernDB_ACU_IsolatedData = {
                ...(candidateAnchor.TavernDB_ACU_IsolatedData || {}),
                [isolationKey]: {
                    ...(candidateExistingTagData || {}),
                    storageFrame: frame,
                    _acu_storage_version: 2,
                },
            };
            if (transitionRef) {
                const candidateTransitionTagData = candidateChat[transitionRef.messageIndex]
                    ?.TavernDB_ACU_IsolatedData?.[isolationKey];
                if (candidateTransitionTagData && typeof candidateTransitionTagData === 'object') {
                    delete candidateTransitionTagData.spv79TransitionCheckpoint;
                    delete candidateTransitionTagData.compatTransitionCheckpoint;
                }
            }
            const strictReplay = await loadTableStateFromFramesV2Detailed_ACU(candidateChat, isolationKey, {
                maxMessageIndex: boundaryAnchorIndex,
                updateRuntimeState: false,
                compatibilityMode: 'disabled',
            });
            if (!strictReplay
                || strictReplay.requiresCheckpointConvergence
                || strictReplay.compatibilityRepairs?.length
                || getTableDataFingerprint_ACU(strictReplay.data) !== getTableDataFingerprint_ACU(data)) {
                const error = new Error(`边界 checkpoint 写入失败：兼容回放结果无法收敛为严格可回放 checkpoint（isolationKey=[${isolationKey || '无标签'}]）。`) as Error & { failedIsolationKey?: string };
                error.failedIsolationKey = isolationKey;
                throw error;
            }
        }

        anchorMsg.TavernDB_ACU_IsolatedData[isolationKey] = {
            ...(existingTagData || {}),
            storageFrame: frame,
            _acu_storage_version: 2,
        };
        if (transitionRef) {
            const transitionMessage = chat[transitionRef.messageIndex];
            const transitionTagData = transitionMessage?.TavernDB_ACU_IsolatedData?.[isolationKey];
            if (transitionTagData && typeof transitionTagData === 'object') {
                delete transitionTagData.spv79TransitionCheckpoint;
                delete transitionTagData.compatTransitionCheckpoint;
            }
        }
        changed = true;
        logDebug_ACU(`[V2 Compaction] 已在 AI 保留边界楼层 #${boundaryAnchorIndex} 写入 isolationKey=[${isolationKey || '无标签'}] 的 full checkpoint（reason=${checkpointReason}）。`);
    }

    return changed;
}

/**
 * 替换聊天消息内容（正文优化核心逻辑）
 * 从 presentation/components/optimization-ui/optimization-ui-exec.ts 搬迁
 */
export async function replaceChatMessage_ACU(messageIndex: number, newContent: string, options: any = {}) {
    try {
        logDebug_ACU(`[正文优化] replaceChatMessage_ACU 开始执行, messageIndex=${messageIndex}, newContent长度=${newContent?.length || 0}`);

        const chat = getChatArray_ACU();
        if (!chat || !chat[messageIndex]) {
            logError_ACU('[正文优化] 消息不存在, chat存在=', !!chat, 'messageIndex=', messageIndex);
            throw new Error('消息不存在');
        }

        const oldContent = chat[messageIndex].mes;
        logDebug_ACU(`[正文优化] 原内容长度: ${oldContent?.length || 0}, 新内容长度: ${newContent?.length || 0}`);

        // 保存原始内容到 extra 字段，用于"重新优化"功能
        // 只有当 extra._acu_original_content 不存在时才保存（避免覆盖最初的原始内容）
        const extra = chat[messageIndex].extra || {};
        if (!extra._acu_original_content) {
            extra._acu_original_content = options.originalContent ?? oldContent;
            logDebug_ACU(`[正文优化] 保存原始内容到 extra._acu_original_content，长度: ${extra._acu_original_content?.length || 0}`);
        }
        extra._acu_last_optimized_at = Date.now();
        extra._acu_last_optimized_message_id = chat[messageIndex].message_id;
        setLastOptimizationBase_ACU({
            messageIndex,
            messageId: chat[messageIndex].message_id,
            baseContent: extra._acu_original_content || options.originalContent || oldContent || ''
        });

        // 使用酒馆的 setChatMessages API 来更新消息内容，确保渲染及时生效
        const success = await setChatMessages_ACU(
            [{ message_id: chat[messageIndex].message_id, mes: newContent, extra: extra }],
            { refresh: 'affected' }
        );
        if (success) {
            logDebug_ACU('[正文优化] 消息已通过 setChatMessages API 更新');
        } else {
            // 降级方案：如果 setChatMessages 不可用，使用原有逻辑
            logDebug_ACU('[正文优化] setChatMessages API 不可用，使用降级方案...');

            chat[messageIndex].mes = newContent;
            chat[messageIndex].extra = extra;

            const verifyContent = chat[messageIndex].mes;
            logDebug_ACU(`[正文优化] 修改后验证 - 内容长度: ${verifyContent?.length || 0}, 是否匹配: ${verifyContent === newContent}`);

            await saveChatToHost_ACU();
            logDebug_ACU('[正文优化] 聊天已保存');

            emitMessageUpdated_ACU(messageIndex);
        }

        logDebug_ACU(`[正文优化] 消息 ${messageIndex} 已更新完成`);
        return true;

    } catch (error) {
        logError_ACU('[正文优化] 替换消息失败:', error);
        return false;
    }
}

/**
 * 获取消息的原始内容（用于重新优化）
 * 从 presentation/components/optimization-ui/optimization-ui-exec.ts 搬迁
 */
export function getOriginalContent_ACU(messageIndex: number) {
    const cachedBase = getLastOptimizationBase_ACU();
    if (cachedBase?.baseContent) {
        const chat = getChatArray_ACU();
        if (cachedBase.messageId != null) {
            const matchedIndex = chat.findIndex(msg => msg && !msg.is_user && msg.message_id === cachedBase.messageId);
            if (matchedIndex === messageIndex) {
                return cachedBase.baseContent;
            }
        }
        if (cachedBase.messageIndex === messageIndex) {
            return cachedBase.baseContent;
        }
    }

    const chat = getChatArray_ACU();
    if (!chat || !chat[messageIndex]) {
        return null;
    }
    const extra = chat[messageIndex].extra || {};
    return extra._acu_original_content || null;
}

/**
 * 保存当前表格数据到聊天记录
 * 从 presentation/triggers/update-process.ts 搬迁
 */
export async function saveCurrentDataForTable_ACU(sheetKey: string) {
    try {
        if (!currentJsonTableData_ACU || !currentJsonTableData_ACU[sheetKey]) {
            logWarn_ACU('saveCurrentDataForTable_ACU: No data to save.');
            return;
        }

        const chat = getChatArray_ACU();
        if (!chat || chat.length === 0) {
            logWarn_ACU('saveCurrentDataForTable_ACU: No chat history.');
            return;
        }

        const sheet = currentJsonTableData_ACU[sheetKey];
        const history = resolveTableHistoryStateFromChat_ACU(chat, {
            sheetKey,
            isSummaryTable: isSummaryOrOutlineTable_ACU(sheet.name),
            isolationKey: getCurrentIsolationKey_ACU(),
            settings: settings_ACU,
        });
        const fallbackLatestAiIndex = getLatestAiMessageIndexFromChat_ACU(chat);
        const targetMessageIndex = history.latestDataMessageIndex !== -1
            ? history.latestDataMessageIndex
            : fallbackLatestAiIndex;

        if (targetMessageIndex === -1) {
            logWarn_ACU('saveCurrentDataForTable_ACU: No AI message available for persistence.');
            return;
        }

        const commitResult = await runTableUpdateCommit_ACU<void>({
            source: 'system',
            reason: 'saveCurrentDataForTable',
            isolationKey: getCurrentIsolationKey_ACU(),
            writeSet: [{ kind: 'sheet', sheetKey }],
            revisionWriteSet: [{ kind: 'sheet', sheetKey }],
            initialData: currentJsonTableData_ACU,
            targetMessageIndex,
            targetSheetKeys: [sheetKey],
            updateGroupKeys: null,
            trackingSheetKeys: [sheetKey],
            trackAsUpdate: history.latestDataMessageIndex === -1,
            operations: [{ kind: 'sheet_replace', sheetKey, sheet: (currentJsonTableData_ACU as any)[sheetKey], reason: 'system' }],
        }, () => ({
            success: true,
            tableData: currentJsonTableData_ACU as any,
        }));
        if (!commitResult.success) {
            logWarn_ACU(`saveCurrentDataForTable_ACU: commit failed: ${commitResult.error || 'unknown error'}`);
        }
    } catch (e) {
        logError_ACU('saveCurrentDataForTable_ACU failed:', e);
    }
}

/**
 * 清理超出保留层数的旧本地数据（表格数据 + 剧情推进数据）
 * 从 presentation/triggers/settings-ui-sync/settings-ui-config.ts 搬迁
 * 
 * 按 AI 楼层计数，用户可见语义保留最近 N 个 AI 楼层；额外等待 20 个 AI 楼层缓冲后滚动边界 checkpoint。
 * 仅保护聊天第一层的"空白指导表"（TavernDB_ACU_InternalSheetGuide），不保护整层本地数据。
 */
async function purgeOldLayerDataCore_ACU() {
    const retainCount = settings_ACU.retainRecentLayers || 0;
    if (retainCount <= 0) {
        logDebug_ACU('[数据清理] retainRecentLayers 为 0 或未设置，跳过清理。');
        return;
    }

    const chat = getChatArray_ACU();
    if (!chat || !Array.isArray(chat) || chat.length === 0) {
        logDebug_ACU('[数据清理] 聊天记录为空，跳过清理。');
        return;
    }

    const boundary = resolveRetainedCheckpointBoundary_ACU(chat, retainCount);
    if (!boundary.shouldCompact) {
        logDebug_ACU(`[数据清理] AI 楼层总数(${boundary.aiMessageIndices.length}) < 滚动触发层数(${boundary.effectiveRetainCount}=保留${retainCount}+缓冲${RETAIN_RECENT_CHECKPOINT_BUFFER_LAYERS_ACU})，无需清理。`);
        return;
    }

    const { indicesToPurge, retainedDataIndices, anchorIndex } = boundary;

    if (indicesToPurge.length === 0) {
        logDebug_ACU('[数据清理] 无需清理的楼层。');
        return;
    }

    logDebug_ACU(`[数据清理] 将清理 ${indicesToPurge.length} 层旧消息的本地数据（保留最近 ${retainCount} 个 AI 楼层，缓冲 ${RETAIN_RECENT_CHECKPOINT_BUFFER_LAYERS_ACU} 个 AI 楼层后滚动 checkpoint）...`);

    // ── [V2 边界 checkpoint] 删除旧 frame 前，确保最新保留 AI 窗口首个 AI 楼层有 full checkpoint ──
    const checkpointResult = await ensureV2BoundaryCheckpointForRetainedBufferCore_ACU(chat, boundary, { reason: 'purge', save: true });
    if (!checkpointResult.success) {
        logError_ACU('[V2 Compaction] 写入边界 checkpoint 失败，已中止本次清理以避免恢复链断裂:', checkpointResult.error);
        return;
    }

    // ── [兜底快照] 在删除旧楼层之前，迁移冷表数据到边界保留楼层 ──
    const retainedSet = new Set<number>(retainedDataIndices);

    // 确认边界楼层有效。chat[0] 只保护指导表字段，不再整层保护普通本地数据。
    if (anchorIndex !== undefined && anchorIndex >= 0 && chat[anchorIndex]) {
        const dataIsolationEnabled = settings_ACU.dataIsolationEnabled || false;
        const dataIsolationCode = settings_ACU.dataIsolationCode || null;

        // orphanedData: Map<isolationKey, Map<sheetKey, SheetData>>
        const orphanedData = new Map<string, Map<string, any>>();

        // 按索引从小到大遍历待清理楼层（从旧到新，后面的覆盖前面的 → 取最新版本）
        for (const idx of indicesToPurge) {
            const msg = chat[idx];
            if (!msg || msg.is_user) continue;

            const sheetDataMap = collectAllSheetDataFromMessage_ACU(msg, dataIsolationEnabled, dataIsolationCode);
            if (sheetDataMap.size === 0) continue;

            for (const [isoKey, sheetMap] of sheetDataMap) {
                for (const [sheetKey, sheetData] of sheetMap) {
                    // 检查该表是否在任何保留楼层中已有数据
                    if (isSheetRetainedInAnyFloor_ACU(sheetKey, isoKey, retainedSet, chat, dataIsolationEnabled, dataIsolationCode)) {
                        continue; // 已有保留数据，无需兜底
                    }

                    // 记录到 orphanedData（后面的覆盖前面的，实现取最新版本）
                    if (!orphanedData.has(isoKey)) {
                        orphanedData.set(isoKey, new Map<string, any>());
                    }
                    orphanedData.get(isoKey)!.set(sheetKey, sheetData);
                }
            }
        }

        // ── [兜底快照] 不再把 orphaned 数据复制到边界楼层 ──
        // Legacy-V1 表数据不得复制到新消息/边界层（禁止新增/复制 V1 payload）。
        // 任一 isoKey 存在 orphaned Legacy-V1 数据时，fail-closed 中止清理，保留原楼层。
        if (orphanedData.size > 0) {
            for (const [isoKey, sheetMap] of orphanedData) {
                const strategy = resolveTableStorageStrategy_ACU(chat, isoKey, {
                    enabled: settings_ACU.dataIsolationEnabled,
                    code: settings_ACU.dataIsolationCode,
                });
                if (strategy.mode === 'legacy-v1') {
                    logWarn_ACU(`[数据清理] isolationKey=[${isoKey || '无标签'}] 存在 orphaned Legacy-V1 表数据（${sheetMap.size} 张表），`
                        + `不得复制到边界楼层；迁移完成前中止清理，保留原楼层数据。reason=${strategy.reason}`);
                    return;
                }
            }
            logDebug_ACU(`[数据清理] orphaned 表数据（${orphanedData.size} 个隔离标签）均为非 legacy-v1，已跳过 V1 兜底复制，继续清理。`);
        }
    } else {
        logWarn_ACU(`[数据清理] 边界保留楼层索引无效（anchorIndex=${anchorIndex}），跳过兜底快照。`);
    }

    let purgedCount = 0;
    const keysToDelete = [
        'TavernDB_ACU_Data',
        'TavernDB_ACU_SummaryData',
        'TavernDB_ACU_IndependentData',
        'TavernDB_ACU_ModifiedKeys',
        'TavernDB_ACU_UpdateGroupKeys',
        'TavernDB_ACU_IsolatedData',
        'TavernDB_ACU_Identity',
        'qrf_plot',
        '_qrf_plot_round_id',
        'qrf_plot_preset',
        'qrf_plot_tasks'
    ];

    const purgeSnapshots = new Map<number, ReturnType<typeof messageFieldSnapshot_ACU>>();
    const purgedFieldDescriptors = new Map<number, Map<string, PropertyDescriptor | undefined>>();
    const vectorGcScopes = new Map<string, SummaryVectorIndexSafeGcScopeHint_ACU>();
    let purgedVectorManifestCount = 0;
    for (const idx of indicesToPurge) {
        const msg = chat[idx];
        if (!msg) continue;
        purgeSnapshots.set(idx, messageFieldSnapshot_ACU(msg));
        purgedFieldDescriptors.set(idx, new Map(keysToDelete.map((key) => [
            key,
            Object.getOwnPropertyDescriptor(msg, key),
        ])));
        purgedVectorManifestCount += collectVectorIndexGcScopesFromMessage_ACU(msg, vectorGcScopes);

        let modified = false;
        for (const key of keysToDelete) {
            if (Object.prototype.hasOwnProperty.call(msg, key)) {
                delete msg[key];
                modified = true;
            }
        }

        if (modified) {
            purgedCount++;
        }
    }

    if (purgedCount > 0) {
        try {
            await saveChatToHostStrict_ACU();
            logDebug_ACU(`[数据清理] 已严格保存 ${purgedCount} 层消息的本地数据清理，已移除 ${purgedVectorManifestCount} 组交火向量索引引用。`);
        } catch (e) {
            purgeSnapshots.forEach((snapshot, messageIndex) => {
                restoreMessageFieldSnapshot_ACU(chat[messageIndex], snapshot);
                purgedFieldDescriptors.get(messageIndex)?.forEach((descriptor, key) => {
                    if (descriptor) {
                        Object.defineProperty(chat[messageIndex], key, descriptor);
                    } else {
                        delete chat[messageIndex][key];
                    }
                });
            });
            logError_ACU('[数据清理] 清理后的严格保存失败，已回滚且不执行外置向量 GC:', e);
            return;
        }
        if (vectorGcScopes.size > 0) {
            try {
                const gcResult = await cleanupUnreachableSummaryVectorIndexFiles_ACU({
                    scopeHints: Array.from(vectorGcScopes.values()),
                });
                if (gcResult.failedDeletes.length > 0) {
                    logWarn_ACU(`[数据清理] 交火向量 GC 有 ${gcResult.failedDeletes.length} 个删除失败；聊天引用已提交，将在后续清理重试。`);
                }
                logDebug_ACU(`[数据清理] 交火向量 GC 完成：deleted=${gcResult.deletedPaths.length}, retained=${gcResult.retainedPaths.length}, manifests=${purgedVectorManifestCount}`);
            } catch (error) {
                // 聊天引用已经 durable，不能为 best-effort GC 回滚已提交的删除。
                logWarn_ACU('[数据清理] 交火向量 GC 执行异常；聊天引用已提交，将在后续清理重试:', error);
            }
        }
    } else {
        logDebug_ACU('[数据清理] 目标楼层中未发现需要清理的数据字段。');
    }
}

export async function purgeOldLayerData_ACU() {
    return runTableWriteTransaction_ACU({
        source: 'system_cleanup',
        reason: 'purgeOldLayerData',
        isolationKey: getCurrentIsolationKey_ACU(),
        writeSet: [{ kind: 'all' }],
        maintenanceMode: 'exclusive',
    }, () => purgeOldLayerDataCore_ACU());
}

/**
 * 检查指定表是否在任何保留楼层中存在数据。
 * 同时检查新版 IsolatedData 路径和旧版兼容路径。
 */
function isSheetRetainedInAnyFloor_ACU(
    sheetKey: string,
    isolationKey: string,
    retainedSet: Set<number>,
    chat: any[],
    dataIsolationEnabled: boolean,
    dataIsolationCode: string | null,
): boolean {
    for (const idx of retainedSet) {
        const msg = chat[idx];
        if (!msg || msg.is_user) continue;

        // 新版 IsolatedData 路径
        const tagData = readIsolatedTagData_ACU(msg, isolationKey);
        if (tagData?.independentData?.[sheetKey]) {
            return true;
        }

        // 旧版兼容路径：仅当 isolationKey 与当前隔离配置匹配时检查
        if (!dataIsolationEnabled) {
            // 无隔离模式：检查旧版字段中是否存在
            const legacyIdentity = msg?.TavernDB_ACU_Identity;
            if (!legacyIdentity && (msg?.TavernDB_ACU_IndependentData?.[sheetKey] || msg?.TavernDB_ACU_Data?.[sheetKey] || msg?.TavernDB_ACU_SummaryData?.[sheetKey])) {
                return true;
            }
        } else {
            // 隔离模式：检查 identity 是否匹配
            if (msg?.TavernDB_ACU_Identity === dataIsolationCode) {
                if (msg?.TavernDB_ACU_IndependentData?.[sheetKey] || msg?.TavernDB_ACU_Data?.[sheetKey] || msg?.TavernDB_ACU_SummaryData?.[sheetKey]) {
                    return true;
                }
            }
        }
    }
    return false;
}

/**
 * 从消息中收集所有表数据（新版 IsolatedData + 旧版兼容路径）。
 * 返回按 isolationKey 分组的 Map。
 *
 * @param msg 聊天消息对象
 * @param dataIsolationEnabled 当前隔离配置
 * @param dataIsolationCode 当前隔离码
 * @returns Map<isolationKey, Map<sheetKey, Sheet_ACU>>
 */
function collectAllSheetDataFromMessage_ACU(
    msg: any,
    dataIsolationEnabled: boolean,
    dataIsolationCode: string | null,
): Map<string, Map<string, any>> {
    const result = new Map<string, Map<string, any>>();

    // 新版 IsolatedData 路径：遍历所有 isolationKey
    const isolatedData = msg?.TavernDB_ACU_IsolatedData;
    if (isolatedData && typeof isolatedData === 'object' && !Array.isArray(isolatedData)) {
        for (const [isoKey, tagData] of Object.entries(isolatedData) as [string, any][]) {
            const independentData = tagData?.independentData;
            if (!independentData || typeof independentData !== 'object') continue;
            const sheetMap = new Map<string, any>();
            for (const [sheetKey, sheetData] of Object.entries(independentData)) {
                if (sheetKey.startsWith('sheet_') && sheetData && typeof sheetData === 'object') {
                    sheetMap.set(sheetKey, sheetData);
                }
            }
            if (sheetMap.size > 0) {
                result.set(isoKey, sheetMap);
            }
        }
    }

    // 旧版兼容路径：归入对应的 isolationKey
    const legacyIsoKey = dataIsolationEnabled ? (dataIsolationCode || '') : '';
    // 判断该消息的旧版数据是否属于当前隔离上下文
    const msgLegacyIdentity = msg?.TavernDB_ACU_Identity;
    let legacyBelongsHere = false;
    if (!dataIsolationEnabled) {
        legacyBelongsHere = !msgLegacyIdentity;
    } else {
        legacyBelongsHere = msgLegacyIdentity === dataIsolationCode;
    }

    if (legacyBelongsHere) {
        const legacySheets = new Map<string, any>();

        const legacyIndependent = msg?.TavernDB_ACU_IndependentData;
        if (legacyIndependent && typeof legacyIndependent === 'object') {
            for (const [sheetKey, sheetData] of Object.entries(legacyIndependent)) {
                if (sheetKey.startsWith('sheet_') && sheetData && typeof sheetData === 'object') {
                    legacySheets.set(sheetKey, sheetData);
                }
            }
        }

        const legacyStandard = msg?.TavernDB_ACU_Data;
        if (legacyStandard && typeof legacyStandard === 'object') {
            for (const [sheetKey, sheetData] of Object.entries(legacyStandard)) {
                if (sheetKey.startsWith('sheet_') && sheetData && typeof sheetData === 'object' && !legacySheets.has(sheetKey)) {
                    legacySheets.set(sheetKey, sheetData);
                }
            }
        }

        const legacySummary = msg?.TavernDB_ACU_SummaryData;
        if (legacySummary && typeof legacySummary === 'object') {
            for (const [sheetKey, sheetData] of Object.entries(legacySummary)) {
                if (sheetKey.startsWith('sheet_') && sheetData && typeof sheetData === 'object' && !legacySheets.has(sheetKey)) {
                    legacySheets.set(sheetKey, sheetData);
                }
            }
        }

        if (legacySheets.size > 0) {
            const existing = result.get(legacyIsoKey);
            if (existing) {
                for (const [k, v] of legacySheets) {
                    existing.set(k, v);
                }
            } else {
                result.set(legacyIsoKey, legacySheets);
            }
        }
    }

    return result;
}

/**
 * 清理旧版“表头清单”（TavernDB_ACU_TableHeaderGuide）。
 *
 * 该字段固定挂在 chat[0]，按隔离键分组存储，与 AI 楼层无关，
 * 因此不会被“按楼层遍历 AI 消息”的删除逻辑覆盖到。
 *
 * mode='all' 整个字段删除；mode='current' 只删当前隔离键，
 * 所有隔离键都清空后再删整个字段。
 */
function clearLegacyTableHeaderGuide_ACU(chat: any[], mode: 'current' | 'all', isolationKey: string): boolean {
    const first = Array.isArray(chat) && chat.length > 0 ? chat[0] : null;
    if (!first) return false;
    const raw = first[LEGACY_CHAT_TABLE_HEADER_GUIDE_FIELD_ACU];
    if (raw === undefined || raw === null || raw === '') return false;

    if (mode === 'all') {
        delete first[LEGACY_CHAT_TABLE_HEADER_GUIDE_FIELD_ACU];
        logDebug_ACU('[数据删除] 已清理旧版表头清单（全部隔离标识）。');
        return true;
    }

    let legacyObj: any = null;
    if (typeof raw === 'string') {
        try { legacyObj = JSON.parse(raw); } catch { legacyObj = null; }
    } else {
        legacyObj = raw;
    }
    // 无法解析或不含 tags 分组时不做部分删除，避免误删其他隔离标识的数据。
    if (!legacyObj || typeof legacyObj !== 'object' || Array.isArray(legacyObj)) return false;
    const tags = legacyObj.tags;
    if (!tags || typeof tags !== 'object' || Array.isArray(tags)) return false;
    if (!Object.prototype.hasOwnProperty.call(tags, isolationKey)) return false;

    delete tags[isolationKey];
    if (Object.keys(tags).length === 0) {
        delete first[LEGACY_CHAT_TABLE_HEADER_GUIDE_FIELD_ACU];
    } else {
        legacyObj.tags = tags;
        first[LEGACY_CHAT_TABLE_HEADER_GUIDE_FIELD_ACU] = typeof raw === 'string'
            ? JSON.stringify(legacyObj)
            : legacyObj;
    }
    logDebug_ACU(`[数据删除] 已清理旧版表头清单（隔离标识: ${isolationKey || '无标签'}）。`);
    return true;
}


export type ManualCatchUpAnchorPreflightResult_ACU =
    | { status: 'ready'; checkpointMessageIndex: number | null }
    | { status: 'repaired'; checkpointMessageIndex: number }
    | { status: 'provisional_bridge_required'; checkpointMessageIndex: number }
    | { status: 'blocked'; error: string };

function isSafeHeaderOnlyResetCheckpoint_ACU(frame: any): boolean {
    const checkpoint = frame?.checkpoint;
    if (checkpoint?.kind !== 'full' || !['init', 'migration'].includes(checkpoint.reason)) return false;
    if (!validateCanonicalCheckpoint_ACU(checkpoint).valid) return false;
    // 只允许 header-only：checkpoint 数据不能携带任何真实行数据（除 header 外的数据行）。
    const data = checkpoint.data;
    if (!data || typeof data !== 'object') return false;
    for (const [key, sheetValue] of Object.entries(data)) {
        if (key === 'mate') continue;
        if (!sheetValue || typeof sheetValue !== 'object') return false;
        const content = (sheetValue as any).content;
        if (!Array.isArray(content)) return false;
        // header-only：最多 1 行（header），不允许 seedRows/data 行。
        if (content.length > 1) return false;
    }
    return true;
}

/**
 * 判定 frame 是否携带「不属于自身 checkpoint」的 replay artifact。
 *
 * 判定标准直接复用 persist 层的 frameHasSuffixReplayArtifact_ACU，不在本文件另写
 * 一份：两层若各自实现，会漂移出「persist 认为该 root 可降级、本 preflight 认为
 * blocked」的夹缝，正是本次要修的 F7 同类问题。
 *
 * 与旧实现的差异：旧版把「随根写入、无 timeline 的 per-sheet checkpoint」和
 * 「自有 full checkpoint 下的 headRevision」也算作 artifact。这会让一个仅含
 * header-only init root 的正常 frame 被误判为「携带后缀 artifact」而 blocked
 * （1518），即使它没有任何后续增量。新语义只认真实后缀。
 *
 * 对 1526 / 1551 两个调用点结论不变：那两处只检查非 root 帧，而 1503 已保证
 * 全聊天仅存在一个 full checkpoint，故这些帧必然无自有 full checkpoint，其
 * per-sheet checkpoint 与 headRevision 仍被判为真实后缀。
 */
function hasV2ReplayArtifact_ACU(frame: any): boolean {
    if (!frame || typeof frame !== 'object') return false;
    return frameHasSuffixReplayArtifact_ACU(frame as TableStorageFrameV2_ACU);
}

/**
 * 兼容旧版“全范围删除后仍把 reset checkpoint 留在较晚楼层”的聊天。
 *
 * 只移动通过 canonical 校验的唯一 init/migration checkpoint。checkpoint 之前的 V2
 * artifacts 已被该 checkpoint 忽略；移动时将其完整备份后清空。checkpoint 本身及其后的
 * artifacts 保持原位语义，且移动前后都做严格 replay 指纹比对。任何未知布局、多 checkpoint
 * 或指纹不一致都 fail-closed。调用方必须在发起 AI 请求前调用，避免付出请求成本后才因
 * checkpoint 位于追平范围之后而失败。
 */
export async function ensureManualCatchUpAnchorBeforeTarget_ACU(
    targetMessageIndex: number,
    isolationKey = getCurrentIsolationKey_ACU(),
): Promise<ManualCatchUpAnchorPreflightResult_ACU> {
    return runTableWriteTransaction_ACU({
        source: 'system_cleanup',
        reason: 'ensureManualCatchUpAnchorBeforeTarget',
        isolationKey,
        writeSet: [{ kind: 'all' }],
        maintenanceMode: 'exclusive',
    }, async () => {
        const chat = getChatArray_ACU();
        if (!Array.isArray(chat) || chat.length === 0) {
            logDebug_ACU(`[追平锚点预检] blocked：聊天记录为空（target=${targetMessageIndex}, isolationKey=[${isolationKey || '无标签'}]）。`);
            return { status: 'blocked', error: '聊天记录为空，无法验证手动追平锚点。' };
        }
        const aiMessageIndices = chat.map((message, index) => !message?.is_user ? index : -1).filter(index => index >= 0);
        if (!Number.isInteger(targetMessageIndex) || targetMessageIndex < 0 || !chat[targetMessageIndex] || chat[targetMessageIndex].is_user) {
            logDebug_ACU(`[追平锚点预检] blocked：目标楼层无效（target=${targetMessageIndex}）。`);
            return { status: 'blocked', error: '手动追平目标楼层无效，无法验证 V2 锚点。' };
        }
        const checkpoints = aiMessageIndices.filter(index => {
            const tagData = readIsolatedTagData_ACU(chat[index], isolationKey) as any;
            return isV2TagData_ACU(tagData) && tagData.storageFrame.checkpoint?.kind === 'full';
        });
        if (checkpoints.length === 0) {
            logDebug_ACU(`[追平锚点预检] ready：无 full checkpoint（target=${targetMessageIndex}, aiMessageIndices=${aiMessageIndices.length}）。`);
            return { status: 'ready', checkpointMessageIndex: null };
        }
        const checkpointMessageIndex = checkpoints[checkpoints.length - 1];
        if (checkpointMessageIndex <= targetMessageIndex) {
            logDebug_ACU(`[追平锚点预检] ready：checkpoint 在目标之前（checkpoint=${checkpointMessageIndex}, target=${targetMessageIndex}）。`);
            return { status: 'ready', checkpointMessageIndex };
        }
        if (checkpoints.length !== 1) {
            logDebug_ACU(`[追平锚点预检] blocked：多 full checkpoint（${checkpoints.length} 个：${checkpoints.join('、')}, target=${targetMessageIndex}）。`);
            return { status: 'blocked', error: '手动追平目标早于多个 V2 full checkpoint；无法安全自动重排历史，请先执行 V2 恢复诊断。' };
        }

        const sourceMessage = chat[checkpointMessageIndex];
        const sourceTagData = readIsolatedTagData_ACU(sourceMessage, isolationKey) as any;
        if (!isV2TagData_ACU(sourceTagData)) {
            logDebug_ACU(`[追平锚点预检] blocked：checkpoint 帧不满足 canonical 契约（checkpoint=${checkpointMessageIndex}, target=${targetMessageIndex}）。`);
            return { status: 'blocked', error: '手动追平目标早于不满足 canonical 契约的 V2 checkpoint；已在调用 AI 前阻止写入，请先执行 V2 恢复诊断。' };
        }
        if (!isSafeHeaderOnlyResetCheckpoint_ACU(sourceTagData.storageFrame)) {
            // 含真实行数据 / migration / compaction / fallback provenance 的正式 full checkpoint
            // 不能前移（bounded replay 语义可能被污染）；需要 provisional bridge 在不动原根的
            //前提下从更早楼层建立临时根，追平后再原子汇合回原根。
            logDebug_ACU(`[追平锚点预检] provisional_bridge_required：checkpoint 非 header-only reset（checkpoint=${checkpointMessageIndex}, target=${targetMessageIndex}）。`);
            return { status: 'provisional_bridge_required', checkpointMessageIndex };
        }
        if (hasV2ReplayArtifact_ACU(sourceTagData.storageFrame)) {
            logDebug_ACU(`[追平锚点预检] blocked：checkpoint 帧携带后缀 artifact（checkpoint=${checkpointMessageIndex}, target=${targetMessageIndex}）。`);
            return { status: 'blocked', error: '手动追平目标早于携带后缀 replay artifact 的 V2 checkpoint；请先执行 V2 恢复诊断。' };
        }

        const unsafeArtifactIndex = aiMessageIndices.find(index => {
            if (index <= checkpointMessageIndex) return false;
            const tagData = readIsolatedTagData_ACU(chat[index], isolationKey) as any;
            if (!isV2TagData_ACU(tagData)) return false;
            return hasV2ReplayArtifact_ACU(tagData.storageFrame);
        });
        if (unsafeArtifactIndex !== undefined) {
            logDebug_ACU(`[追平锚点预检] blocked：checkpoint 之后存在后缀 artifact（artifact=${unsafeArtifactIndex}, checkpoint=${checkpointMessageIndex}, target=${targetMessageIndex}）。`);
            return { status: 'blocked', error: `手动追平目标之后存在无法安全重排的 V2 增量 artifact（messageIndex=${unsafeArtifactIndex}）；请先执行 V2 恢复诊断。` };
        }

        let replayBefore;
        try {
            replayBefore = await loadTableStateFromFramesV2Detailed_ACU(chat, isolationKey, {
                updateRuntimeState: false,
                compatibilityMode: 'disabled',
            });
        } catch (error: any) {
            logDebug_ACU(`[追平锚点预检] blocked：移动前 replay 校验异常（checkpoint=${checkpointMessageIndex}, target=${targetMessageIndex}, error=${error?.message || String(error)}）。`);
            return { status: 'blocked', error: `手动追平锚点移动前 replay 校验失败：${error?.message || String(error)}` };
        }
        if (!replayBefore || replayBefore.requiresCheckpointConvergence || replayBefore.compatibilityRepairs?.length) {
            logDebug_ACU(`[追平锚点预检] blocked：移动前 replay 依赖兼容修复（checkpoint=${checkpointMessageIndex}, target=${targetMessageIndex}, convergence=${replayBefore?.requiresCheckpointConvergence}, repairs=${replayBefore?.compatibilityRepairs?.length || 0}）。`);
            return { status: 'blocked', error: '手动追平锚点移动前 V2 replay 仍依赖兼容修复；请先执行 V2 恢复诊断。' };
        }

        const anchorMessageIndex = aiMessageIndices[0];
        const anchorMessage = chat[anchorMessageIndex];
        const discardedPrefixFrames = aiMessageIndices
            .filter(index => index < checkpointMessageIndex)
            .flatMap(index => {
                const tagData = readIsolatedTagData_ACU(chat[index], isolationKey) as any;
                return isV2TagData_ACU(tagData) && hasV2ReplayArtifact_ACU(tagData.storageFrame)
                    ? [{ messageIndex: index, storageFrame: JSON.parse(JSON.stringify(tagData.storageFrame)) }]
                    : [];
            });
        const candidateChat = JSON.parse(JSON.stringify(chat));
        const candidateSource = candidateChat[checkpointMessageIndex];
        const candidateAnchor = candidateChat[anchorMessageIndex];
        const candidateSourceContainer = readIsolatedDataContainer_ACU(candidateSource) || {};
        delete candidateSourceContainer[isolationKey];
        if (Object.keys(candidateSourceContainer).length === 0) delete candidateSource.TavernDB_ACU_IsolatedData;
        else candidateSource.TavernDB_ACU_IsolatedData = candidateSourceContainer;
        for (const prefix of discardedPrefixFrames) {
            const candidateTagData = readIsolatedTagData_ACU(candidateChat[prefix.messageIndex], isolationKey) as any;
            if (isV2TagData_ACU(candidateTagData)) {
                candidateTagData.storageFrame = { version: 2, logEntries: [] };
            }
        }
        const candidateAnchorContainer = readIsolatedDataContainer_ACU(candidateAnchor) || {};
        const recoveryBackup: TableV2RecoveryBackup_ACU = {
            version: 1,
            createdAt: Date.now(),
            recoveryKind: 'relocated_checkpoint_discarded_prefix',
            sourceMessageIndex: checkpointMessageIndex,
            storageFrame: JSON.parse(JSON.stringify(sourceTagData.storageFrame)),
            ...(discardedPrefixFrames.length > 0 ? { discardedPrefixFrames } : {}),
        };
        candidateAnchorContainer[isolationKey] = {
            ...JSON.parse(JSON.stringify(sourceTagData)),
            recoveryBackup,
        };
        candidateAnchor.TavernDB_ACU_IsolatedData = candidateAnchorContainer;

        let replayAfter;
        try {
            replayAfter = await loadTableStateFromFramesV2Detailed_ACU(candidateChat, isolationKey, {
                updateRuntimeState: false,
                compatibilityMode: 'disabled',
            });
        } catch (error: any) {
            logDebug_ACU(`[追平锚点预检] blocked：移动后候选 replay 校验异常（checkpoint=${checkpointMessageIndex}, target=${targetMessageIndex}, error=${error?.message || String(error)}）。`);
            return { status: 'blocked', error: `手动追平锚点移动候选 replay 校验失败：${error?.message || String(error)}` };
        }
        if (!replayAfter || replayAfter.requiresCheckpointConvergence || replayAfter.compatibilityRepairs?.length
            || getTableDataFingerprint_ACU(replayBefore.data) !== getTableDataFingerprint_ACU(replayAfter.data)) {
            logDebug_ACU(`[追平锚点预检] blocked：锚点移动会改变可见表格状态（checkpoint=${checkpointMessageIndex}, target=${targetMessageIndex}, convergence=${replayAfter?.requiresCheckpointConvergence}, repairs=${replayAfter?.compatibilityRepairs?.length || 0}, fingerprintSame=${replayBefore && replayAfter ? getTableDataFingerprint_ACU(replayBefore.data) === getTableDataFingerprint_ACU(replayAfter.data) : 'n/a'}）。`);
            return { status: 'blocked', error: '手动追平锚点移动会改变当前可见表格状态，已拒绝写入；请先执行 V2 恢复诊断。' };
        }
        logDebug_ACU(`[追平锚点预检] repaired：锚点前移 checkpoint=${checkpointMessageIndex} → ${anchorMessageIndex}（target=${targetMessageIndex}, discardedPrefix=${discardedPrefixFrames.length}）。`);

        const affectedMessages = [...new Set([anchorMessageIndex, checkpointMessageIndex, ...discardedPrefixFrames.map(item => item.messageIndex)])].map(index => ({
            messageIndex: index,
            message: chat[index],
            hadIsolatedData: Object.prototype.hasOwnProperty.call(chat[index], 'TavernDB_ACU_IsolatedData'),
            isolatedData: chat[index].TavernDB_ACU_IsolatedData,
            hadIdentity: Object.prototype.hasOwnProperty.call(chat[index], 'TavernDB_ACU_Identity'),
            identity: chat[index].TavernDB_ACU_Identity,
        }));
        try {
            for (const { messageIndex } of affectedMessages) {
                chat[messageIndex].TavernDB_ACU_IsolatedData = candidateChat[messageIndex].TavernDB_ACU_IsolatedData;
            }
            writeMessageIdentity_ACU(anchorMessage, { enabled: settings_ACU.dataIsolationEnabled, code: settings_ACU.dataIsolationCode });
            await saveChatToHostStrict_ACU();
        } catch (error: any) {
            for (const state of affectedMessages) {
                if (state.hadIsolatedData) state.message.TavernDB_ACU_IsolatedData = state.isolatedData;
                else delete state.message.TavernDB_ACU_IsolatedData;
                if (state.hadIdentity) state.message.TavernDB_ACU_Identity = state.identity;
                else delete state.message.TavernDB_ACU_Identity;
            }
            return { status: 'blocked', error: `手动追平 reset checkpoint 前移保存失败：${error?.message || String(error)}` };
        }
        logDebug_ACU(`[手动追平] 已将 canonical ${sourceTagData.storageFrame.checkpoint.reason} checkpoint 从 #${checkpointMessageIndex} 前移到 #${anchorMessageIndex}，并备份了 ${discardedPrefixFrames.length} 个已忽略前缀 artifact。`);
        return { status: 'repaired', checkpointMessageIndex: anchorMessageIndex };
    });
}


/**
 * 判定一次删除请求是否覆盖全部 AI 楼层。
 *
 * 这是「是否触发硬清空」的唯一判定真源：服务层编排入口、v2 UI 预判文案、
 * legacy UI 预判文案三处共用，避免各自实现导致语义漂移。
 *
 * 与 deleteLocalDataInChatCoreInner_ACU 内部原有的 isFullRangeDeletion 表达式
 * 完全等价（该处已改为调用本函数），保证「是否清 guide/scope」与
 * 「是否走 purge」永远基于同一判定。
 *
 * @param startFloor 起始 AI 楼层（1-based）；null 表示从第一层开始
 * @param endFloor   终止 AI 楼层（1-based，含）；null 表示到最后一层
 * @param aiMessageCount 当前聊天的 AI 楼层总数
 */
export function isFullRangeDeletionRequest_ACU(
    startFloor: number | null,
    endFloor: number | null,
    aiMessageCount: number
): boolean {
    return (startFloor === null || startFloor <= 1)
        && (endFloor === null || endFloor >= aiMessageCount);
}

/** 统计当前聊天的 AI 楼层总数（与 deleteLocalDataInChatCoreInner_ACU 的口径一致）。 */
export function countAiMessages_ACU(chat: any[] | null | undefined): number {
    return Array.isArray(chat) ? chat.filter((msg: any) => !msg?.is_user).length : 0;
}

/**
 * 删除聊天记录中的本地数据（核心业务逻辑）
 * 从 presentation/triggers/data-admin-ui.ts 的 deleteLocalDataInChat_ACU 中提取
 * 
 * 只负责数据操作（遍历 chat 删除字段 + saveChatToHost），不涉及 UI（toast/status display）。
 * @returns 删除的消息数量
 */
/**
 * 删除聊天记录中的本地数据（核心业务逻辑）
 * 从 presentation/triggers/data-admin-ui.ts 的 deleteLocalDataInChat_ACU 中提取
 * 
 * 只负责数据操作（遍历 chat 删除字段 + saveChatToHost），不涉及 UI（toast/status display）。
 * @returns 删除的消息数量
 */
async function deleteLocalDataInChatCoreInner_ACU(
    mode: 'current' | 'all' = 'current',
    startFloor: number | null = null,
    endFloor: number | null = null
): Promise<number> {
    const chat = getChatArray_ACU();
    if (!chat || chat.length === 0) {
        return 0;
    }

    let deletedCount = 0;
    const targetIdentity = settings_ACU.dataIsolationEnabled ? settings_ACU.dataIsolationCode : null;
    const currentIsolationKey = getCurrentIsolationKey_ACU();

    // 计算AI消息索引列表（只计算AI楼层）
    const aiMessageIndices = chat
        .map((msg: any, index: number) => (!msg.is_user) ? index : -1)
        .filter((index: number) => index !== -1);

    if (aiMessageIndices.length === 0) {
        return 0;
    }

    // 转换AI楼层范围为AI消息索引范围
    const startAiIndex = startFloor ? Math.max(0, startFloor - 1) : 0;
    const endAiIndex = endFloor ? Math.min(aiMessageIndices.length - 1, endFloor - 1) : aiMessageIndices.length - 1;

    // 获取要处理的AI消息的物理索引
    const targetIndices = aiMessageIndices.slice(startAiIndex, endAiIndex + 1);
    const isFullRangeDeletion = isFullRangeDeletionRequest_ACU(startFloor, endFloor, aiMessageIndices.length);

    for (const physicalIndex of targetIndices) {
        const msg = chat[physicalIndex];
        let shouldDelete = false;

        if (mode === 'all') {
            shouldDelete = true;
        } else {
            const isolatedData = msg.TavernDB_ACU_IsolatedData;
            if (isolatedData && typeof isolatedData === 'object' && !Array.isArray(isolatedData) && isolatedData[currentIsolationKey]) {
                shouldDelete = true;
            } else if (settings_ACU.dataIsolationEnabled) {
                if (msg.TavernDB_ACU_Identity === targetIdentity) {
                    shouldDelete = true;
                }
            } else {
                if (msg.TavernDB_ACU_Data || msg.TavernDB_ACU_SummaryData || msg.TavernDB_ACU_IndependentData || msg.TavernDB_ACU_IsolatedData) {
                    shouldDelete = true;
                }
            }
        }

        if (shouldDelete) {
            let modified = false;

            if (msg.TavernDB_ACU_Data) {
                delete msg.TavernDB_ACU_Data;
                modified = true;
            }
            if (msg.TavernDB_ACU_SummaryData) {
                delete msg.TavernDB_ACU_SummaryData;
                modified = true;
            }
            if (msg.TavernDB_ACU_IndependentData) {
                delete msg.TavernDB_ACU_IndependentData;
                modified = true;
            }
            if (msg.TavernDB_ACU_Identity !== undefined) {
                delete msg.TavernDB_ACU_Identity;
                modified = true;
            }
            // 漏删修复（C 方案步骤 1）：这两个字段在 MESSAGE_TABLE_FIELDS_ACU 权威清单中，
            // 旧路径此前未删。删除后必须回到「从未填表」状态（与 helpers-data-merge.ts:709
            // 的幂等闸门语义一致），因此与 Identity 同级置 modified=true 保证落盘。
            if (msg.TavernDB_ACU_LocalMessageAnchor !== undefined) {
                delete msg.TavernDB_ACU_LocalMessageAnchor;
                modified = true;
            }
            if (msg._acu_local_template_base_state_seeded !== undefined) {
                delete msg._acu_local_template_base_state_seeded;
                modified = true;
            }
            if (msg.TavernDB_ACU_IsolatedData) {
                if (mode === 'all') {
                    const isolatedData = msg.TavernDB_ACU_IsolatedData;
                    for (const key of Object.keys(isolatedData)) {
                        await deleteVectorIndexManifestFromTagData_ACU(isolatedData[key]);
                    }
                    delete msg.TavernDB_ACU_IsolatedData;
                    modified = true;
                } else {
                    if (msg.TavernDB_ACU_IsolatedData[currentIsolationKey]) {
                        await deleteVectorIndexManifestFromTagData_ACU(msg.TavernDB_ACU_IsolatedData[currentIsolationKey]);
                        delete msg.TavernDB_ACU_IsolatedData[currentIsolationKey];
                        if (Object.keys(msg.TavernDB_ACU_IsolatedData).length === 0) {
                            delete msg.TavernDB_ACU_IsolatedData;
                        }
                        modified = true;
                    }
                }
            }
            if (msg.TavernDB_ACU_ModifiedKeys) {
                delete msg.TavernDB_ACU_ModifiedKeys;
            }
            if (msg.TavernDB_ACU_UpdateGroupKeys) {
                delete msg.TavernDB_ACU_UpdateGroupKeys;
            }

            if (modified) {
                deletedCount++;
            }
        }
    }

    // 删除本地数据后必须回到「从未填表」状态：不再保留 init header-only 锚点，
    // 也不再向最新楼层写空 frame。保留它们会让 hasV2TableHistoryEvidence_ACU 判定
    // 该会话仍是 V2（storage-strategy-resolver.ts:33），从而走继承路线并读取残留 guide，
    // 这正是「删光数据后切模板报 guideData 写入失败」的成因。
    // sheetKey 由表名拼音确定性派生，重新分配不会造成身份漂移（已与助手确认）。
    //
    // 旧版“表头清单”固定挂在 chat[0]，与楼层范围无关，因此只在删除覆盖完整范围时清理，
    // 避免局部删除误删仍被其他楼层依赖的兼容指导数据。
    if (isFullRangeDeletion && clearLegacyTableHeaderGuide_ACU(chat, mode, currentIsolationKey)) {
        deletedCount++;
    }

    // 4.2 新版 guide 容器 + scope 容器（聊天级配置）随删除一并清空：
    // - guide 容器是图 2 的污染源，必须清；
    // - scope 容器（模板来源/presetName）也清（D-A 决策选 A）：删光后与全新会话完全等价，
    //   模板选择回到 inherit_global（继承全局模板）。
    if (isFullRangeDeletion) {
        const guideBefore = peekChatSheetGuideContainer_ACU(chat);
        const scopeBefore = peekChatScopedConfigContainer_ACU(chat);
        setChatSheetGuideContainer_ACU(chat, null);
        setChatScopedConfigContainer_ACU(chat, null);
        if (guideBefore !== null || scopeBefore !== null) {
            deletedCount++;
        }
    }

    if (deletedCount > 0) {
        await saveChatToHost_ACU();
    }

    return deletedCount;
}

export async function deleteLocalDataInChatCore_ACU(
    mode: 'current' | 'all' = 'current',
    startFloor: number | null = null,
    endFloor: number | null = null
): Promise<number> {
    return runTableWriteTransaction_ACU({
        source: 'system_cleanup',
        reason: 'deleteLocalDataInChat',
        isolationKey: getCurrentIsolationKey_ACU(),
        writeSet: [{ kind: 'all' }],
        maintenanceMode: 'exclusive',
    }, () => deleteLocalDataInChatCoreInner_ACU(mode, startFloor, endFloor));
}

/** 范围感知删除的分派结果。path 决定调用方必须执行哪套收尾。 */
export type ScopedDeletionOutcome_ACU =
    | { path: 'purge'; result: ChatDatabasePurgeResult_ACU }
    | { path: 'range'; deletedCount: number }
    | { path: 'aborted'; reason: string };

/**
 * 范围感知的本地数据删除编排入口。
 *
 * 判定规则（唯一真源，见 isFullRangeDeletionRequest_ACU）：
 *   mode === 'all' 且删除范围覆盖全部 AI 楼层 → 硬清空 purgeCurrentChatDatabaseState_ACU；
 *   其余一切情况                              → 范围删除 deleteLocalDataInChatCore_ACU。
 *
 * 【绝不在此包裹事务】purgeCurrentChatDatabaseState_ACU 与
 * deleteLocalDataInChatCore_ACU 各自已用 runTableWriteTransaction_ACU 包裹且
 * maintenanceMode='exclusive'；此处再包一层会造成独占事务嵌套（死锁或断言失败）。
 * 本函数只做「读 chat 算判定 + 分派」，自身不写任何数据。
 *
 * @param expectedPath 可选安全闸门。调用方在弹确认框时已按当时的 AI 楼层数预判过路径；
 *   用户停留期间若聊天新增 AI 楼层，实际判定可能翻转（例如原本只删 1-5 层，
 *   新增第 6 层后仍是 range，但原本 end=5 覆盖全部的场景会变成局部）。
 *   传入预判值后，一旦实际判定与预判不一致即返回 aborted，由调用方提示用户重新确认，
 *   避免「用户以为只删部分，实际被硬清空」这类破坏性误判。
 */
export async function deleteLocalDataWithScope_ACU(
    mode: 'current' | 'all' = 'current',
    startFloor: number | null = null,
    endFloor: number | null = null,
    expectedPath?: 'purge' | 'range'
): Promise<ScopedDeletionOutcome_ACU> {
    const chat = getChatArray_ACU();
    const aiMessageCount = countAiMessages_ACU(chat);
    const isFullRange = isFullRangeDeletionRequest_ACU(startFloor, endFloor, aiMessageCount);
    const path: 'purge' | 'range' = (mode === 'all' && isFullRange) ? 'purge' : 'range';

    if (expectedPath && expectedPath !== path) {
        return {
            path: 'aborted',
            reason: `删除范围在确认期间发生变化（预期${expectedPath === 'purge' ? '完全清空' : '按范围删除'}，`
                + `实际为${path === 'purge' ? '完全清空' : '按范围删除'}）。为避免误删已中止，请重新确认。`,
        };
    }

    if (path === 'purge') {
        return { path: 'purge', result: await purgeCurrentChatDatabaseState_ACU() };
    }
    return { path: 'range', deletedCount: await deleteLocalDataInChatCore_ACU(mode, startFloor, endFloor) };
}


/**
 * 使用模板覆盖最新层的表格数据（核心业务逻辑）
 * 从 presentation/triggers/data-admin-ui.ts 的 overrideLatestLayerWithTemplate_ACU 中提取
 * 
 * 只负责数据操作（遍历 chat 用模板覆盖 + saveChatToHost），不涉及 UI（confirm/toast）。
 * @param templateData 解析后的模板数据
 * @returns 覆盖的表格数量，0 表示没有修改
 */
export async function overrideLatestLayerWithTemplateCore_ACU(templateData: any): Promise<number> {
    const chat = getChatArray_ACU();
    if (!chat || chat.length === 0) {
        return 0;
    }

    const currentIsolationKey = getCurrentIsolationKey_ACU();

    // 找到最新的一条AI消息
    let latestAiIndex = -1;
    for (let i = chat.length - 1; i >= 0; i--) {
        if (!chat[i].is_user) {
            latestAiIndex = i;
            break;
        }
    }

    if (latestAiIndex === -1) {
        return 0;
    }

    const overrideSheets: Record<string, any> = {};

    // 遍历模板中的所有表格，使用模板数据覆盖本地数据
    Object.keys(templateData).forEach(sheetKey => {
        if (!sheetKey.startsWith('sheet_')) return;

        const templateTable = templateData[sheetKey];
        if (!templateTable || !templateTable.name) return;

        // 创建覆盖数据：保留表头，清空数据行
        const overrideTable = JSON.parse(JSON.stringify(templateTable));
        if (overrideTable.content && overrideTable.content.length > 1) {
            overrideTable.content = [overrideTable.content[0]]; // 只保留表头
        }

        overrideSheets[sheetKey] = sanitizeSheetForStorage_ACU(overrideTable);
        logDebug_ACU(`Overrode table "${templateTable.name}" (${sheetKey}) in latest layer with template data.`);
    });

    const modifiedSheetKeys = Object.keys(overrideSheets);
    if (modifiedSheetKeys.length === 0) {
        return 0;
    }

    const nextTableData = JSON.parse(JSON.stringify(currentJsonTableData_ACU || {}));
    if (!nextTableData.mate && templateData?.mate) {
        nextTableData.mate = JSON.parse(JSON.stringify(templateData.mate));
    }
    for (const sheetKey of modifiedSheetKeys) {
        nextTableData[sheetKey] = overrideSheets[sheetKey];
    }

    const operations: TableMutationOperationV2_ACU[] = modifiedSheetKeys.map(sheetKey => ({
        kind: 'sheet_replace',
        sheetKey,
        sheet: overrideSheets[sheetKey],
        reason: 'system',
    }));
    const commitResult = await runTableUpdateCommit_ACU<number>({
        source: 'system',
        reason: 'overrideLatestLayerWithTemplate',
        isolationKey: currentIsolationKey,
        writeSet: modifiedSheetKeys.map(sheetKey => ({ kind: 'sheet' as const, sheetKey })),
        revisionWriteSet: modifiedSheetKeys.map(sheetKey => ({ kind: 'sheet' as const, sheetKey })),
        initialData: currentJsonTableData_ACU,
        targetMessageIndex: latestAiIndex,
        targetSheetKeys: modifiedSheetKeys,
        updateGroupKeys: modifiedSheetKeys,
        trackingSheetKeys: modifiedSheetKeys,
        trackAsUpdate: true,
        operations,
    }, () => ({
        success: true,
        value: modifiedSheetKeys.length,
        tableData: nextTableData as any,
    }));
    if (!commitResult.success) {
        logWarn_ACU(`[模板覆盖] 公共提交失败：${commitResult.error || 'unknown error'}`);
        return 0;
    }

    return commitResult.value || 0;
}

/**
 * 按消息索引列表清空指定 AI 楼层上的当前隔离标签表格数据，并保存聊天。
 *
 * 用于手动填表前的"预清空"步骤：先清除目标楼层上的旧表格数据，
 * 再执行新的手动填表，防止 SQL 严格填表逻辑因旧数据残留导致写入失败。
 *
 * 清理范围：当前隔离标签下的新版 IsolatedData 槽 + 旧版兼容字段。
 * 不影响同一消息上其他隔离标签的数据。
 * 不删除消息正文或非表格业务字段。
 *
 * @param targetMessageIndices 需要清空的目标 AI 消息物理索引列表（已去重）
 * @returns 实际被清空的消息数量
 */
async function clearTableDataAtFloorsCore_ACU(targetMessageIndices: number[], targetSheetKeys: string[] | null = null): Promise<number> {
    if (!targetMessageIndices || targetMessageIndices.length === 0) return 0;

    const chat = getChatArray_ACU();
    if (!chat || chat.length === 0) return 0;

    const isolationKey = getCurrentIsolationKey_ACU();
    const isolationConfig = {
        enabled: settings_ACU.dataIsolationEnabled,
        code: settings_ACU.dataIsolationCode,
    };
    const clearsSummaryOrOutline = Array.isArray(targetSheetKeys) && targetSheetKeys.length > 0
        ? tableListContainsSummaryOrOutline_ACU(targetSheetKeys)
        : true;

    let clearedCount = 0;

    for (const idx of targetMessageIndices) {
        if (idx < 0 || idx >= chat.length) continue;
        const msg = chat[idx];
        // 只处理 AI 消息（跳过用户消息）
        if (!msg || msg.is_user) continue;

        const changed = Array.isArray(targetSheetKeys) && targetSheetKeys.length > 0
            ? purgeTargetSheetKeysFromMessage_ACU(msg, targetSheetKeys, idx)
            : clearTableFieldsForIsolation_ACU(msg, isolationKey, isolationConfig);
        if (clearsSummaryOrOutline) {
            const tagData = readIsolatedTagData_ACU(msg, isolationKey);
            if (await deleteVectorIndexManifestFromTagData_ACU(tagData)) {
                logDebug_ACU(`[清空楼层] 已删除消息索引 ${idx} 上的交火向量索引外置文件引用。`);
            }
        }
        if (changed) {
            clearedCount++;
            logDebug_ACU(`[清空楼层] 已清空消息索引 ${idx} 上的表格数据 (标签: ${isolationKey || '无'})`);
        }
    }

    if (clearedCount > 0) {
        await saveChatToHost_ACU();
        logDebug_ACU(`[清空楼层] 共清空 ${clearedCount} 条消息的表格数据，聊天已保存。`);
    }

    return clearedCount;
}

export async function clearTableDataAtFloors_ACU(targetMessageIndices: number[], targetSheetKeys: string[] | null = null): Promise<number> {
    const writeSet = Array.isArray(targetSheetKeys) && targetSheetKeys.length > 0
        ? targetSheetKeys.map(sheetKey => ({ kind: 'sheet' as const, sheetKey }))
        : [{ kind: 'all' as const }];
    return runTableWriteTransaction_ACU({
        source: 'system_cleanup',
        reason: 'clearTableDataAtFloors',
        isolationKey: getCurrentIsolationKey_ACU(),
        writeSet,
        maintenanceMode: 'exclusive',
    }, () => clearTableDataAtFloorsCore_ACU(targetMessageIndices, targetSheetKeys));
}

async function clearManualRefillIncrementalDataInRangeCore_ACU(targetMessageIndices: number[], targetSheetKeys: string[] | null = null): Promise<number> {
    if (!targetMessageIndices || targetMessageIndices.length === 0) return 0;
    if (!Array.isArray(targetSheetKeys) || targetSheetKeys.length === 0) {
        throw new Error('手动重填增量清理必须指定目标表。');
    }

    const chat = getChatArray_ACU();
    if (!chat || chat.length === 0) return 0;

    const isolationKey = getCurrentIsolationKey_ACU();
    const targetSheetKeySet = new Set(targetSheetKeys);
    const maxTargetMessageIndex = targetMessageIndices.reduce(
        (max, index) => Number.isInteger(index) ? Math.max(max, index) : max,
        -1,
    );
    const knownSqlTableNames = new Set<string>();
    for (let index = 0; index <= maxTargetMessageIndex && index < chat.length; index++) {
        const msg = chat[index];
        if (!msg || msg.is_user) continue;
        const tagData = readIsolatedTagData_ACU(msg, isolationKey);
        if (!isV2TagData_ACU(tagData)) continue;
        const names = collectSqlTargetTableNamesFromStorageFrameV2_ACU(tagData.storageFrame, targetSheetKeySet);
        names.forEach(name => knownSqlTableNames.add(name));
    }
    const clearsSummaryOrOutline = tableListContainsSummaryOrOutline_ACU(targetSheetKeys);
    let clearedCount = 0;

    for (const idx of targetMessageIndices) {
        if (idx < 0 || idx >= chat.length) continue;
        const msg = chat[idx];
        if (!msg || msg.is_user) continue;

        const changed = purgeManualRefillIncrementalSheetKeysFromMessage_ACU(msg, isolationKey, targetSheetKeys, knownSqlTableNames);
        if (clearsSummaryOrOutline) {
            const isolatedData = msg?.TavernDB_ACU_IsolatedData;
            const tagData = isolatedData && typeof isolatedData === 'object' && !Array.isArray(isolatedData)
                ? isolatedData[isolationKey]
                : null;
            if (await deleteVectorIndexManifestFromTagData_ACU(tagData)) {
                logDebug_ACU(`[手动重填预清理] 已删除消息索引 ${idx} 上的交火向量索引外置文件引用。`);
            }
        }
        if (changed) {
            clearedCount++;
            logDebug_ACU(`[手动重填预清理] 已清理消息索引 ${idx} 上选中表的增量数据 (标签: ${isolationKey || '无'})`);
        }
    }

    const residueSummary = {
        exactHits: 0,
        runtimeV1Hits: 0,
        substringOnlyPathCount: 0,
        checkpointDataRiskCount: 0,
        scheduleSummaryRiskCount: 0,
        checkpointDataRiskDetailCount: 0,
        checkpointDataRiskDetails: [] as Array<{
            messageIndex: number;
            tagKey: string;
            targetKey: string;
            reason?: string;
            createdAt?: number;
        }>,
    };
    for (const idx of targetMessageIndices) {
        if (idx < 0 || idx >= chat.length) continue;
        const msg = chat[idx];
        if (!msg || msg.is_user) continue;
        const report = scanTargetKeysResidue_ACU(msg, isolationKey, targetSheetKeys, idx);
        residueSummary.exactHits += report.exactHits;
        residueSummary.runtimeV1Hits += report.runtimeV1Hits;
        residueSummary.substringOnlyPathCount += report.substringOnlyPaths.length;
        if (report.checkpointDataRisk) residueSummary.checkpointDataRiskCount++;
        if (report.scheduleSummaryRisk) residueSummary.scheduleSummaryRiskCount++;
        residueSummary.checkpointDataRiskDetailCount += report.checkpointDataRisks.length;
        const remainingDetailSlots = MAX_CHECKPOINT_RISK_DETAILS_ACU - residueSummary.checkpointDataRiskDetails.length;
        if (remainingDetailSlots > 0) {
            residueSummary.checkpointDataRiskDetails.push(...report.checkpointDataRisks.slice(0, remainingDetailSlots));
        }
    }
    const hasResidue = residueSummary.exactHits > 0
        || residueSummary.runtimeV1Hits > 0
        || residueSummary.substringOnlyPathCount > 0
        || residueSummary.checkpointDataRiskCount > 0
        || residueSummary.scheduleSummaryRiskCount > 0;
    if (hasResidue) {
        logDebug_ACU('[手动重填诊断] 选中表清理后残留摘要', {
            clearedCount,
            targetKeys: targetSheetKeys,
            fields: ['event', 'operations', 'patches', 'writeSet', 'revision', 'progress'],
            residue: residueSummary,
        });
    }
    if (clearedCount > 0) {
        await saveChatToHost_ACU();
        logDebug_ACU(`[手动重填预清理] 共清理 ${clearedCount} 条消息的选中表增量数据，聊天已保存。`);
    }

    return clearedCount;
}

export async function clearManualRefillIncrementalDataInRange_ACU(targetMessageIndices: number[], targetSheetKeys: string[] | null = null): Promise<number> {
    if (!Array.isArray(targetSheetKeys) || targetSheetKeys.length === 0) {
        throw new Error('手动重填增量清理必须指定目标表。');
    }
    const writeSet = targetSheetKeys.map(sheetKey => ({ kind: 'sheet' as const, sheetKey }));
    return runTableWriteTransaction_ACU({
        source: 'system_cleanup',
        reason: 'clearIncrementalOnly',
        isolationKey: getCurrentIsolationKey_ACU(),
        writeSet,
        maintenanceMode: 'exclusive',
    }, () => clearManualRefillIncrementalDataInRangeCore_ACU(targetMessageIndices, targetSheetKeys));
}

function cloneMessageFieldValue_ACU<T>(value: T, seen = new WeakMap<object, any>(), originals = new WeakMap<object, any>()): T {
    if (value === null || typeof value !== 'object') return value;
    const existing = seen.get(value);
    if (existing) return existing;
    if (value instanceof Date) {
        const clone = new Date(value.getTime());
        seen.set(value, clone);
        originals.set(clone, value);
        return clone as T;
    }
    if (value instanceof RegExp) {
        const clone = new RegExp(value.source, value.flags);
        seen.set(value, clone);
        originals.set(clone, value);
        return clone as T;
    }

    if (value instanceof Map) {
        const clone = new Map();
        seen.set(value, clone);
        originals.set(clone, value);
        value.forEach((mapValue, mapKey) => clone.set(cloneMessageFieldValue_ACU(mapKey, seen, originals), cloneMessageFieldValue_ACU(mapValue, seen, originals)));
        return clone as T;
    }
    if (value instanceof Set) {
        const clone = new Set();
        seen.set(value, clone);
        originals.set(clone, value);
        value.forEach(setValue => clone.add(cloneMessageFieldValue_ACU(setValue, seen, originals)));
        return clone as T;
    }
    const clone: any = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
    seen.set(value, clone);
    originals.set(clone, value);
    for (const key of Reflect.ownKeys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor) continue;
        if ('value' in descriptor) descriptor.value = cloneMessageFieldValue_ACU(descriptor.value, seen, originals);
        Object.defineProperty(clone, key, descriptor);
    }
    return clone;
}

function getV2FrameForIsolation_ACU(msg: any, isolationKey: string): TableStorageFrameV2_ACU | null {
    const tagData = readIsolatedTagData_ACU(msg, isolationKey);
    return isV2TagData_ACU(tagData) ? tagData.storageFrame : null;
}

interface ManualRefillReplayAnchor_ACU {
    fullCheckpointIndices: number[];
    fallbackRootIndex: number;
}

function resolveManualRefillReplayAnchor_ACU(chat: any[], isolationKey: string, targetMessageIndices: number[]): ManualRefillReplayAnchor_ACU {
    const fullCheckpointIndices: number[] = [];
    let earliestV2FrameIndex = -1;
    for (let index = 0; index < chat.length; index += 1) {
        const message = chat[index];
        if (!message || message.is_user) continue;
        const frame = getV2FrameForIsolation_ACU(message, isolationKey);
        if (!frame) continue;
        if (earliestV2FrameIndex < 0) earliestV2FrameIndex = index;
        if (frame.checkpoint?.kind === 'full') fullCheckpointIndices.push(index);
    }

    const firstTargetAiIndex = [...new Set(targetMessageIndices)]
        .filter((index): index is number => Number.isInteger(index) && index >= 0 && index < chat.length && !chat[index]?.is_user)
        .sort((left, right) => left - right)[0] ?? -1;
    return { fullCheckpointIndices, fallbackRootIndex: earliestV2FrameIndex >= 0 ? earliestV2FrameIndex : firstTargetAiIndex };
}

function findManualRefillSheetBaselineTargetIndex_ACU(chat: any[], isolationKey: string, targetMessageIndices: number[], requestedTargetMessageIndex?: number): number {
    const anchor = resolveManualRefillReplayAnchor_ACU(chat, isolationKey, targetMessageIndices);
    if (anchor.fullCheckpointIndices.length !== 1) return -1;
    const targetMessageIndex = anchor.fullCheckpointIndices[0];
    if (requestedTargetMessageIndex !== undefined && requestedTargetMessageIndex !== targetMessageIndex) return -1;
    return targetMessageIndex;
}

function getMaxFrameSequence_ACU(frame: TableStorageFrameV2_ACU): number {
    if (!Array.isArray(frame.logEntries)) return 0;
    return frame.logEntries.reduce((max, entry: any) => Number.isInteger(entry?.seq) && entry.seq >= 0 ? Math.max(max, entry.seq) : max, 0);
}

function cloneCandidateChat_ACU(chat: any[]): any[] {
    return JSON.parse(JSON.stringify(chat));
}

function applyCandidateMessageFields_ACU(liveMessage: any, candidateMessage: any): void {
    if (Object.prototype.hasOwnProperty.call(candidateMessage, 'TavernDB_ACU_IsolatedData')) {
        liveMessage.TavernDB_ACU_IsolatedData = candidateMessage.TavernDB_ACU_IsolatedData;
    } else {
        delete liveMessage.TavernDB_ACU_IsolatedData;
    }
    if (Object.prototype.hasOwnProperty.call(candidateMessage, 'TavernDB_ACU_Identity')) {
        liveMessage.TavernDB_ACU_Identity = candidateMessage.TavernDB_ACU_Identity;
    } else {
        delete liveMessage.TavernDB_ACU_Identity;
    }
}

function messageFieldSnapshot_ACU(msg: any): {
    hadIsolatedData: boolean;
    originalIsolatedData: any;
    isolatedData: any;
    hadIdentity: boolean;
    originalIdentity: any;
    identity: any;
    originals: WeakMap<object, any>;
} {
    const originals = new WeakMap<object, any>();
    return {
        hadIsolatedData: Object.prototype.hasOwnProperty.call(msg, 'TavernDB_ACU_IsolatedData'),
        originalIsolatedData: msg?.TavernDB_ACU_IsolatedData,
        isolatedData: cloneMessageFieldValue_ACU(msg?.TavernDB_ACU_IsolatedData, new WeakMap<object, any>(), originals),
        hadIdentity: Object.prototype.hasOwnProperty.call(msg, 'TavernDB_ACU_Identity'),
        originalIdentity: msg?.TavernDB_ACU_Identity,
        identity: cloneMessageFieldValue_ACU(msg?.TavernDB_ACU_Identity, new WeakMap<object, any>(), originals),
        originals,
    };
}

function restoreMessageFieldValueInPlace_ACU(target: any, snapshot: any, originals: WeakMap<object, any>, seen = new WeakMap<object, any>()): any {
    if (target === null || snapshot === null || typeof target !== 'object' || typeof snapshot !== 'object') return snapshot;
    const restored = seen.get(snapshot);
    if (restored) return restored;
    const original = originals.get(snapshot);
    const restoreTarget = original && typeof original === 'object' ? original : target;
    seen.set(snapshot, restoreTarget);

    const snapshotKeys = Reflect.ownKeys(snapshot);
    const snapshotKeySet = new Set(snapshotKeys);
    for (const key of Reflect.ownKeys(restoreTarget)) {
        if (key !== 'length' && !snapshotKeySet.has(key)) delete restoreTarget[key];
    }

    const restoreKey = (key: PropertyKey): void => {
        const snapshotDescriptor = Object.getOwnPropertyDescriptor(snapshot, key);
        if (!snapshotDescriptor) return;
        const targetDescriptor = Object.getOwnPropertyDescriptor(restoreTarget, key);
        if (
            'value' in snapshotDescriptor
            && snapshotDescriptor.value !== null
            && typeof snapshotDescriptor.value === 'object'
        ) {
            const originalValue = originals.get(snapshotDescriptor.value);
            const currentValue = 'value' in (targetDescriptor || {}) ? targetDescriptor.value : undefined;
            if (originalValue && typeof originalValue === 'object') {
                snapshotDescriptor.value = restoreMessageFieldValueInPlace_ACU(originalValue, snapshotDescriptor.value, originals, seen);
            } else if (currentValue !== null && typeof currentValue === 'object') {
                snapshotDescriptor.value = restoreMessageFieldValueInPlace_ACU(currentValue, snapshotDescriptor.value, originals, seen);
            }
        }
        Object.defineProperty(restoreTarget, key, snapshotDescriptor);
    };

    snapshotKeys.filter(key => key !== 'length').forEach(restoreKey);
    if (Array.isArray(snapshot)) Object.defineProperty(restoreTarget, 'length', Object.getOwnPropertyDescriptor(snapshot, 'length')!);
    return restoreTarget;
}

function restoreMessageFieldSnapshot_ACU(msg: any, snapshot: ReturnType<typeof messageFieldSnapshot_ACU>): void {
    if (!msg) return;
    if (snapshot.hadIsolatedData) {
        msg.TavernDB_ACU_IsolatedData = snapshot.originalIsolatedData;
        restoreMessageFieldValueInPlace_ACU(snapshot.originalIsolatedData, snapshot.isolatedData, snapshot.originals);
    } else {
        delete msg.TavernDB_ACU_IsolatedData;
    }
    if (snapshot.hadIdentity) {
        msg.TavernDB_ACU_Identity = snapshot.originalIdentity;
        restoreMessageFieldValueInPlace_ACU(snapshot.originalIdentity, snapshot.identity, snapshot.originals);
    } else {
        delete msg.TavernDB_ACU_Identity;
    }
}

/**
 * 在手动重填全部成功后，用完整目标表快照替换范围内的旧数据。
 *
 * 该提交不裁剪历史操作；data_replace 与混合 SQL 均保持其整库语义，目标表以范围末端
 * sheet_rebase 覆盖。全局缺失 full checkpoint 时，在最早 V2 frame 补模板临时根。
 */
export async function commitManualRefillSheetSnapshotInRangeAtomic_ACU(
    options: ManualRefillSheetSnapshotCommitOptions_ACU,
): Promise<ManualRefillSheetBaselineReplaceResult_ACU> {
    if (!Array.isArray(options.targetSheetKeys) || options.targetSheetKeys.length === 0) {
        return { success: false, changed: false, clearedCount: 0, checkpointCount: 0, error: '手动重填最终快照提交必须指定目标表。' };
    }
    if (!Array.isArray(options.targetMessageIndices) || options.targetMessageIndices.length === 0) {
        return { success: false, changed: false, clearedCount: 0, checkpointCount: 0, error: '手动重填最终快照提交必须指定目标消息范围。' };
    }
    const invalidSnapshotSheet = options.targetSheetKeys.find(sheetKey => {
        const sheet = options.snapshotData?.[sheetKey];
        return !sheet || typeof sheet !== 'object' || !Array.isArray(sheet.content);
    });
    if (invalidSnapshotSheet) {
        return { success: false, changed: false, clearedCount: 0, checkpointCount: 0, error: `手动重填最终快照提交失败：目标表 ${invalidSnapshotSheet} 不是可恢复的完整 Sheet。` };
    }

    const writeSet = options.targetSheetKeys.map(sheetKey => ({ kind: 'sheet' as const, sheetKey }));
    return runTableWriteTransaction_ACU({
        source: 'system_cleanup',
        reason: 'commitManualRefillSheetSnapshotInRange',
        isolationKey: options.isolationKey,
        writeSet,
        maintenanceMode: 'exclusive',
    }, async () => {
        const chat = getChatArray_ACU();
        if (!Array.isArray(chat) || chat.length === 0) {
            return { success: false, changed: false, clearedCount: 0, checkpointCount: 0, error: '聊天记录为空，无法提交手动重填最终快照。' };
        }

        const normalizedIndices = [...new Set(options.targetMessageIndices.filter((idx): idx is number => Number.isInteger(idx) && idx >= 0 && idx < chat.length))].sort((a, b) => a - b);
        const completedMessageIndex = [...normalizedIndices].reverse().find(idx => !chat[idx]?.is_user);
        if (completedMessageIndex === undefined) {
            return { success: false, changed: false, clearedCount: 0, checkpointCount: 0, error: '手动重填最终快照提交失败：目标消息范围不含 AI 回复楼层。' };
        }
        const completedAiFloor = chat.slice(0, completedMessageIndex + 1).filter(msg => msg && !msg.is_user).length;
        const anchor = resolveManualRefillReplayAnchor_ACU(chat, options.isolationKey, normalizedIndices);
        if (anchor.fullCheckpointIndices.length > 1) {
            return { success: false, changed: false, clearedCount: 0, checkpointCount: 0, error: `手动重填最终快照提交失败：isolationKey ${options.isolationKey} 存在多个整库 full checkpoint（${anchor.fullCheckpointIndices.join(', ')}），必须先完成完整性修复。` };
        }
        const fallbackRequired = anchor.fullCheckpointIndices.length === 0;
        const rootMessageIndex = fallbackRequired ? anchor.fallbackRootIndex : anchor.fullCheckpointIndices[0];
        if (rootMessageIndex < 0 || chat[rootMessageIndex]?.is_user) {
            return { success: false, changed: false, clearedCount: 0, checkpointCount: 0, error: '手动重填最终快照提交失败：找不到可承载回放根的 AI 楼层。' };
        }
        if (options.targetMessageIndex !== undefined && options.targetMessageIndex !== rootMessageIndex) {
            return { success: false, changed: false, clearedCount: 0, checkpointCount: 0, targetMessageIndex: rootMessageIndex, error: `手动重填最终快照提交失败：指定 anchor #${options.targetMessageIndex} 不等于唯一回放根 #${rootMessageIndex}。` };
        }
        if (fallbackRequired && (!options.templateData || typeof options.templateData !== 'object' || Array.isArray(options.templateData))) {
            return { success: false, changed: false, clearedCount: 0, checkpointCount: 0, targetMessageIndex: rootMessageIndex, error: '手动重填最终快照提交失败：全局缺少整库 full checkpoint，且未提供有效的冻结模板。' };
        }
        const templateFingerprint = options.templateData && typeof options.templateData === 'object' && !Array.isArray(options.templateData)
            ? getTableDataFingerprint_ACU(options.templateData)
            : null;
        const fallbackRunId = templateFingerprint
            ? `manual-refill:${options.isolationKey}:${normalizedIndices.join(',')}:${templateFingerprint}`
            : null;
        if (fallbackRequired) {
            const missingTemplateSheet = options.targetSheetKeys.find(sheetKey => !options.templateData?.[sheetKey] || typeof options.templateData[sheetKey] !== 'object');
            if (!options.templateData?.mate || typeof options.templateData.mate !== 'object' || missingTemplateSheet) {
                return { success: false, changed: false, clearedCount: 0, checkpointCount: 0, targetMessageIndex: rootMessageIndex, error: missingTemplateSheet
                    ? `手动重填最终快照提交失败：冻结模板缺少目标表 ${missingTemplateSheet}。`
                    : '手动重填最终快照提交失败：冻结模板缺少有效 mate 根元数据。' };
            }
        }

        // strict save 的结果不确定时，宿主可能已经落盘而调用方会重试。相同 runId 与
        // 相同末端快照必须成为幂等 no-op，不能仅因 createdAt 改变就再次改写根或 rebase。
        const existingRootFrame = getV2FrameForIsolation_ACU(chat[rootMessageIndex], options.isolationKey);
        const existingFinalFrame = getV2FrameForIsolation_ACU(chat[completedMessageIndex], options.isolationKey);
        const existingFallbackRunId = existingRootFrame?.checkpoint?.fallbackProvenance?.runId;
        const hasEquivalentTerminalRebases = options.targetSheetKeys.every(sheetKey => {
            const checkpoint = existingFinalFrame?.perSheetCheckpoints?.[sheetKey];
            return checkpoint?.kind === 'sheet_full'
                && checkpoint?.timeline?.kind === 'sheet_rebase'
                && checkpoint.timeline.activateAtMessageIndex === completedMessageIndex
                && checkpoint.timeline.afterSeq === getMaxFrameSequence_ACU(existingFinalFrame!)
                && getTableDataFingerprint_ACU(checkpoint.data) === getTableDataFingerprint_ACU(options.snapshotData[sheetKey]);
        });
        if (fallbackRunId && existingFallbackRunId === fallbackRunId && hasEquivalentTerminalRebases) {
            return {
                success: true,
                changed: false,
                clearedCount: 0,
                checkpointCount: options.targetSheetKeys.length,
                targetMessageIndex: rootMessageIndex,
            };
        }

        const snapshotIndices = [...new Set([rootMessageIndex, completedMessageIndex])];
        const snapshots = new Map<number, ReturnType<typeof messageFieldSnapshot_ACU>>();
        snapshotIndices.forEach(idx => snapshots.set(idx, messageFieldSnapshot_ACU(chat[idx])));

        try {
            const candidateChat = cloneCandidateChat_ACU(chat);
            const createdAt = Date.now();
            const rootMessage = candidateChat[rootMessageIndex];
            rootMessage.TavernDB_ACU_IsolatedData = rootMessage.TavernDB_ACU_IsolatedData && typeof rootMessage.TavernDB_ACU_IsolatedData === 'object' && !Array.isArray(rootMessage.TavernDB_ACU_IsolatedData)
                ? rootMessage.TavernDB_ACU_IsolatedData : {};
            const rootTagData = rootMessage.TavernDB_ACU_IsolatedData[options.isolationKey];
            const rootFrame: TableStorageFrameV2_ACU = isV2TagData_ACU(rootTagData)
                ? rootTagData.storageFrame
                : { version: 2, logEntries: [] };
            if (!isV2TagData_ACU(rootTagData)) {
                rootMessage.TavernDB_ACU_IsolatedData[options.isolationKey] = { ...(rootTagData && typeof rootTagData === 'object' ? rootTagData : {}), _acu_storage_version: 2, storageFrame: rootFrame };
            }
            if (fallbackRequired) {
                const checkpointBuild = buildCanonicalFullCheckpoint_ACU({
                    createdAt,
                    reason: 'manual',
                    data: options.templateData as TableDataObject_ACU,
                    fallbackProvenance: {
                        version: 1,
                        kind: 'manual_refill_template_root',
                        runId: fallbackRunId!,
                        isolationKey: options.isolationKey,
                        targetSheetKeys: [...new Set(options.targetSheetKeys)].sort(),
                        rangeStartMessageIndex: normalizedIndices[0],
                        rangeEndMessageIndex: normalizedIndices[normalizedIndices.length - 1],
                        templateFingerprint,
                        createdAt,
                    },
                    context: { messageIndex: rootMessageIndex, isolationKey: options.isolationKey, reason: 'manual' },
                });
                if (!checkpointBuild.checkpoint) throw new Error(`手动重填最终快照提交失败：${checkpointBuild.error}`);
                rootFrame.checkpoint = checkpointBuild.checkpoint;
            }

            const finalMessage = candidateChat[completedMessageIndex];
            finalMessage.TavernDB_ACU_IsolatedData = finalMessage.TavernDB_ACU_IsolatedData && typeof finalMessage.TavernDB_ACU_IsolatedData === 'object' && !Array.isArray(finalMessage.TavernDB_ACU_IsolatedData)
                ? finalMessage.TavernDB_ACU_IsolatedData : {};
            const finalTagData = finalMessage.TavernDB_ACU_IsolatedData[options.isolationKey];
            const finalFrame: TableStorageFrameV2_ACU = isV2TagData_ACU(finalTagData)
                ? finalTagData.storageFrame
                : { version: 2, logEntries: [] };
            if (!isV2TagData_ACU(finalTagData)) {
                finalMessage.TavernDB_ACU_IsolatedData[options.isolationKey] = { ...(finalTagData && typeof finalTagData === 'object' ? finalTagData : {}), _acu_storage_version: 2, storageFrame: finalFrame };
            }
            const perSheetCheckpoints = { ...(finalFrame.perSheetCheckpoints || {}) };
            const afterSeq = getMaxFrameSequence_ACU(finalFrame);
            for (const sheetKey of options.targetSheetKeys) {
                const checkpointBuild = buildCanonicalSheetCheckpoint_ACU({
                    createdAt,
                    reason: 'manual',
                    sheetKey,
                    data: cloneMessageFieldValue_ACU(options.snapshotData[sheetKey]) as Sheet_ACU,
                    scheduleSummary: { lastFilledAiFloor: completedAiFloor },
                    context: { messageIndex: completedMessageIndex, aiFloor: completedAiFloor, isolationKey: options.isolationKey, reason: 'manual' },
                });
                if (!checkpointBuild.checkpoint) {
                    throw new Error(`手动重填最终快照提交失败：${checkpointBuild.error}`);
                }
                perSheetCheckpoints[sheetKey] = {
                    ...checkpointBuild.checkpoint,
                    timeline: { kind: 'sheet_rebase', activateAtMessageIndex: completedMessageIndex, afterSeq },
                };
            }
            finalFrame.perSheetCheckpoints = perSheetCheckpoints;
            writeMessageIdentity_ACU(rootMessage, { enabled: settings_ACU.dataIsolationEnabled, code: settings_ACU.dataIsolationCode });
            writeMessageIdentity_ACU(finalMessage, { enabled: settings_ACU.dataIsolationEnabled, code: settings_ACU.dataIsolationCode });

            const replayed = await loadTableStateFromFramesV2Detailed_ACU(candidateChat, options.isolationKey, {
                updateRuntimeState: false,
                compatibilityMode: 'disabled',
            });
            if (!replayed || replayed.baseKind !== 'full_checkpoint') throw new Error('手动重填最终快照提交失败：候选聊天未能建立持久化 full checkpoint 回放基底。');
            if (replayed.requiresCheckpointConvergence || replayed.compatibilityRepairs?.length) {
                throw new Error('手动重填最终快照提交失败：候选聊天仍依赖临时 Sheet 补锚，必须先完成恢复收敛。');
            }
            for (const sheetKey of options.targetSheetKeys) {
                if (getTableDataFingerprint_ACU(replayed.data[sheetKey]) !== getTableDataFingerprint_ACU(options.snapshotData[sheetKey])) {
                    throw new Error(`手动重填最终快照提交失败：候选回放后的目标表 ${sheetKey} 与最终快照不一致。`);
                }
            }
            snapshotIndices.forEach(index => applyCandidateMessageFields_ACU(chat[index], candidateChat[index]));
            await saveChatToHostStrict_ACU();
            logDebug_ACU(`[手动重填最终快照] 已在 AI 楼层 #${completedMessageIndex} 为 ${options.targetSheetKeys.join(', ')} 写入末端 rebase${fallbackRequired ? '，并建立模板临时根' : ''}。`);
            return { success: true, changed: true, clearedCount: 0, checkpointCount: options.targetSheetKeys.length, targetMessageIndex: rootMessageIndex };
        } catch (error: any) {
            snapshots.forEach((snapshot, idx) => restoreMessageFieldSnapshot_ACU(chat[idx], snapshot));
            return { success: false, changed: false, clearedCount: 0, checkpointCount: 0, targetMessageIndex: rootMessageIndex, error: error?.message || String(error || '手动重填最终快照提交失败。') };
        }
    });
}

/**
 * 手动重填清理删除唯一 full checkpoint 后，立即用冻结模板重建模板临时根。
 *
 * 背景：全范围 + 全选表重填会删除范围内唯一整库 full checkpoint（见
 * purgeSheetKeysFromStorageFrameV2_ACU 的删锚逻辑）。此后任何 bucket 写入都会命中
 * persist 层 usesImplicitMigrationCheckpoint 守卫（storage-frame-v2-persist.ts），
 * 因为状态是「有 V2 空信封、无任何 full checkpoint、无 artifact」——清理方承诺的
 * 「由后续写入按初始 checkpoint 重建」与守卫语义直接冲突。
 *
 * 本函数在清理完成后、第一个 bucket 写入前，把末尾 commit 阶段的
 * fallbackRequired 建根动作提前执行：用冻结模板在同一 run 的起始楼层写入
 * reason='manual' + fallbackProvenance 的模板临时根，让后续 bucket 写入有合法锚点。
 * 末尾 commitManualRefillSheetSnapshotInRangeAtomic_ACU 检测到已有唯一根后，
 * fallbackRequired 为 false，走既有 perSheetCheckpoints rebase 路径，不再重复建根。
 *
 * 与 establishProvisionalBridge_ACU（manual-catch-up-provisional-bridge.ts）不同：
 * 该函数要求原 full checkpoint 存在（fail-closed），本场景恰好是它已被删除，
 * 因此不复用其状态机，只复用其「临时根 → 边界折叠」的设计思想。
 */
export async function establishManualRefillTemplateRoot_ACU(options: {
    isolationKey: string;
    targetSheetKeys: string[];
    targetMessageIndices: number[];
    templateData: Record<string, any> | null;
}): Promise<{ success: boolean; changed: boolean; targetMessageIndex: number; error?: string }> {
    const { isolationKey, targetSheetKeys, targetMessageIndices, templateData } = options;
    if (!Array.isArray(targetSheetKeys) || targetSheetKeys.length === 0) {
        return { success: false, changed: false, targetMessageIndex: -1, error: '手动重填临时根建立必须指定目标表。' };
    }
    if (!templateData || typeof templateData !== 'object' || Array.isArray(templateData)) {
        return { success: false, changed: false, targetMessageIndex: -1, error: '手动重填临时根建立失败：缺少有效的冻结模板。' };
    }
    if (!templateData.mate || typeof templateData.mate !== 'object') {
        return { success: false, changed: false, targetMessageIndex: -1, error: '手动重填临时根建立失败：冻结模板缺少有效 mate 根元数据。' };
    }
    const missingTemplateSheet = targetSheetKeys.find(sheetKey => !templateData[sheetKey] || typeof templateData[sheetKey] !== 'object');
    if (missingTemplateSheet) {
        return { success: false, changed: false, targetMessageIndex: -1, error: `手动重填临时根建立失败：冻结模板缺少目标表 ${missingTemplateSheet}。` };
    }

    const chat = getChatArray_ACU();
    if (!Array.isArray(chat) || chat.length === 0) {
        return { success: false, changed: false, targetMessageIndex: -1, error: '聊天记录为空，无法建立手动重填临时根。' };
    }

    const normalizedIndices = [...new Set(targetMessageIndices.filter((idx): idx is number => Number.isInteger(idx) && idx >= 0 && idx < chat.length))].sort((a, b) => a - b);
    if (normalizedIndices.length === 0) {
        return { success: false, changed: false, targetMessageIndex: -1, error: '手动重填临时根建立失败：目标消息范围不含有效楼层。' };
    }

    // 与末尾 commitManualRefillSheetSnapshotInRangeAtomic_ACU 同一口径：
    // resolveManualRefillReplayAnchor_ACU 的 fullCheckpointIndices（全局唯一 full 根判定）
    // 与 earliestV2FrameIndex（fallback 根落点）必须在此处复用，避免提前建根与末尾
    // 校验对「根在哪」产生分歧。
    const anchor = resolveManualRefillReplayAnchor_ACU(chat, isolationKey, normalizedIndices);
    if (anchor.fullCheckpointIndices.length > 0) {
        // 清理后仍有 full checkpoint（部分选表/范围未覆盖 checkpoint 楼层）：
        // 不需要建根，直接返回 no-op。
        return { success: true, changed: false, targetMessageIndex: -1 };
    }
    const rootMessageIndex = anchor.fallbackRootIndex;
    if (rootMessageIndex < 0 || chat[rootMessageIndex]?.is_user) {
        return { success: false, changed: false, targetMessageIndex: -1, error: `手动重填临时根建立失败：找不到可承载临时根的 AI 楼层（fallbackRootIndex=${rootMessageIndex}）。` };
    }

    // 与末尾 commit 相同的 runId 公式：isolationKey + 范围 + 模板指纹。
    // 提前建根与末尾核对必须命中同一个 runId，否则幂等判定失效。
    const templateFingerprint = getTableDataFingerprint_ACU(templateData);
    const fallbackRunId = `manual-refill:${isolationKey}:${normalizedIndices.join(',')}:${templateFingerprint}`;
    const createdAt = Date.now();
    const checkpointBuild = buildCanonicalFullCheckpoint_ACU({
        createdAt,
        reason: 'manual',
        data: templateData as TableDataObject_ACU,
        fallbackProvenance: {
            version: 1,
            kind: 'manual_refill_template_root',
            runId: fallbackRunId,
            isolationKey,
            targetSheetKeys: [...new Set(targetSheetKeys)].sort(),
            rangeStartMessageIndex: normalizedIndices[0],
            rangeEndMessageIndex: normalizedIndices[normalizedIndices.length - 1],
            templateFingerprint,
            createdAt,
        },
        context: { messageIndex: rootMessageIndex, isolationKey, reason: 'manual' },
    });
    if (!checkpointBuild.checkpoint) {
        return { success: false, changed: false, targetMessageIndex: -1, error: `手动重填临时根建立失败：${checkpointBuild.error}` };
    }

    // 候选克隆上写入临时根，strict save 成功后才 apply 到 live chat（与清理同款原子性）。
    const snapshots = new Map<number, ReturnType<typeof messageFieldSnapshot_ACU>>();
    snapshots.set(rootMessageIndex, messageFieldSnapshot_ACU(chat[rootMessageIndex]));
    try {
        const candidateChat = cloneCandidateChat_ACU(chat);
        const rootMessage = candidateChat[rootMessageIndex];
        rootMessage.TavernDB_ACU_IsolatedData = rootMessage.TavernDB_ACU_IsolatedData && typeof rootMessage.TavernDB_ACU_IsolatedData === 'object' && !Array.isArray(rootMessage.TavernDB_ACU_IsolatedData)
            ? rootMessage.TavernDB_ACU_IsolatedData
            : {};
        const rootTagData = rootMessage.TavernDB_ACU_IsolatedData[isolationKey];
        const rootFrame: TableStorageFrameV2_ACU = isV2TagData_ACU(rootTagData)
            ? rootTagData.storageFrame
            : { version: 2, logEntries: [] };
        if (!isV2TagData_ACU(rootTagData)) {
            rootMessage.TavernDB_ACU_IsolatedData[isolationKey] = { ...(rootTagData && typeof rootTagData === 'object' ? rootTagData : {}), _acu_storage_version: 2, storageFrame: rootFrame };
        }
        rootFrame.checkpoint = checkpointBuild.checkpoint;
        writeMessageIdentity_ACU(rootMessage, { enabled: settings_ACU.dataIsolationEnabled, code: settings_ACU.dataIsolationCode });

        applyCandidateMessageFields_ACU(chat[rootMessageIndex], candidateChat[rootMessageIndex]);
        await saveChatToHostStrict_ACU();
        logDebug_ACU(`[手动重填临时根] 已在 AI 楼层 #${rootMessageIndex} 为 ${targetSheetKeys.join(', ')} 建立模板临时根（runId=${fallbackRunId}）。`);
        return { success: true, changed: true, targetMessageIndex: rootMessageIndex };
    } catch (error: any) {
        snapshots.forEach((snapshot, idx) => restoreMessageFieldSnapshot_ACU(chat[idx], snapshot));
        const failureError = error?.message || String(error || '手动重填临时根建立异常。');
        logError_ACU('[手动重填临时根] 建立 strict save 失败，已原位恢复聊天内存状态:', error);
        return { success: false, changed: false, targetMessageIndex: -1, error: `手动重填临时根建立失败：${failureError}` };
    }
}


export async function replaceManualRefillSheetBaselineInRangeAtomic_ACU(
    options: ManualRefillSheetBaselineReplaceOptions_ACU,
): Promise<ManualRefillSheetBaselineReplaceResult_ACU> {
    if (!Array.isArray(options.targetSheetKeys) || options.targetSheetKeys.length === 0) {
        return { success: false, changed: false, clearedCount: 0, checkpointCount: 0, error: '手动重填基底替换必须指定目标表。' };
    }
    if (!Array.isArray(options.targetMessageIndices) || options.targetMessageIndices.length === 0) {
        return { success: false, changed: false, clearedCount: 0, checkpointCount: 0, error: '手动重填基底替换必须指定目标消息范围。' };
    }
    const missingBaselineSheet = options.targetSheetKeys.find(sheetKey => !options.baselineData || !options.baselineData[sheetKey] || typeof options.baselineData[sheetKey] !== 'object');
    if (missingBaselineSheet) {
        return { success: false, changed: false, clearedCount: 0, checkpointCount: 0, error: `手动重填基底替换失败：缺少目标表 ${missingBaselineSheet} 的重建基底。` };
    }



    const writeSet = options.targetSheetKeys.map(sheetKey => ({ kind: 'sheet' as const, sheetKey }));
    return runTableWriteTransaction_ACU({
        source: 'system_cleanup',
        reason: 'replaceManualRefillSheetBaselineInRange',
        isolationKey: options.isolationKey,
        writeSet,
        maintenanceMode: 'exclusive',
    }, async () => {
        const chat = getChatArray_ACU();
        if (!Array.isArray(chat) || chat.length === 0) {
            return { success: false, changed: false, clearedCount: 0, checkpointCount: 0, error: '聊天记录为空，无法替换手动重填基底。' };
        }

        const normalizedIndices = [...new Set(options.targetMessageIndices.filter((idx): idx is number => Number.isInteger(idx) && idx >= 0 && idx < chat.length))].sort((a, b) => a - b);
        const targetMessageIndex = findManualRefillSheetBaselineTargetIndex_ACU(chat, options.isolationKey, normalizedIndices, options.targetMessageIndex);
        if (targetMessageIndex < 0) {
            return { success: false, changed: false, clearedCount: 0, checkpointCount: 0, error: '手动重填基底替换失败：本次范围内找不到可承载单表 checkpoint 的整库 full checkpoint。' };
        }

        const targetMsg = chat[targetMessageIndex];
        if (!targetMsg || targetMsg.is_user) {
            return { success: false, changed: false, clearedCount: 0, checkpointCount: 0, targetMessageIndex, error: `手动重填基底替换失败：targetMessageIndex=${targetMessageIndex} 不是有效 AI 楼层。` };
        }

        const snapshotIndices = [...new Set([...normalizedIndices, targetMessageIndex])];
        const snapshots = new Map<number, ReturnType<typeof messageFieldSnapshot_ACU>>();
        snapshotIndices.forEach(idx => snapshots.set(idx, messageFieldSnapshot_ACU(chat[idx])));

        try {
            const clearsSummaryOrOutline = tableListContainsSummaryOrOutline_ACU(options.targetSheetKeys);
            const vectorManifestsToDeleteAfterCommit: any[] = [];
            let clearedCount = 0;
            for (const idx of normalizedIndices) {
                const msg = chat[idx];
                if (!msg || msg.is_user) continue;
                const removedBaseline = purgeSheetKeysFromMessageForIsolation_ACU(msg, options.isolationKey, options.targetSheetKeys);
                const removedIncremental = purgeManualRefillIncrementalSheetKeysFromMessage_ACU(msg, options.isolationKey, options.targetSheetKeys);
                if (clearsSummaryOrOutline) {
                    const tagData = readIsolatedTagData_ACU(msg, options.isolationKey);
                    await deleteVectorIndexManifestFromTagData_ACU(tagData, { deleteExternal: false, onManifest: manifest => vectorManifestsToDeleteAfterCommit.push(manifest) });
                }
                if (removedBaseline || removedIncremental) clearedCount += 1;
            }

            if (!targetMsg.TavernDB_ACU_IsolatedData || typeof targetMsg.TavernDB_ACU_IsolatedData !== 'object' || Array.isArray(targetMsg.TavernDB_ACU_IsolatedData)) {
                targetMsg.TavernDB_ACU_IsolatedData = {};
            }
            const existingTagData = targetMsg.TavernDB_ACU_IsolatedData[options.isolationKey];
            const existingFrame = isV2TagData_ACU(existingTagData) ? existingTagData.storageFrame : null;
            if (!existingFrame?.checkpoint || existingFrame.checkpoint.kind !== 'full') {
                throw new Error('手动重填基底替换失败：清理后目标楼层不再包含整库 full checkpoint。');
            }

            const createdAt = Date.now();
            const collectedScheduleSummary = collectScheduleSummaryFromFramesV2_ACU(chat, options.isolationKey, { maxMessageIndex: targetMessageIndex });
            const scheduleSummary = collectedScheduleSummary && typeof collectedScheduleSummary === 'object' && !Array.isArray(collectedScheduleSummary) ? collectedScheduleSummary : {};
            const perSheetCheckpoints = { ...(existingFrame.perSheetCheckpoints || {}) };
            for (const sheetKey of options.targetSheetKeys) {
                const sheetData = cloneMessageFieldValue_ACU(options.baselineData[sheetKey]) as Sheet_ACU;
                perSheetCheckpoints[sheetKey] = {
                    kind: 'sheet_full',
                    createdAt,
                    reason: 'manual',
                    sheetKey,
                    data: sheetData,
                    ...(scheduleSummary[sheetKey] ? { scheduleSummary: cloneMessageFieldValue_ACU(scheduleSummary[sheetKey]) } : {}),
                };
            }
            existingFrame.perSheetCheckpoints = perSheetCheckpoints;
            writeMessageIdentity_ACU(targetMsg, { enabled: settings_ACU.dataIsolationEnabled, code: settings_ACU.dataIsolationCode });

            await saveChatToHostStrict_ACU();
            const cleanupWarnings = await cleanupVectorIndexManifestsAfterCommit_ACU(vectorManifestsToDeleteAfterCommit);
            logDebug_ACU(`[手动重填基底替换] 已在 AI 楼层 #${targetMessageIndex} 为 ${options.targetSheetKeys.join(', ')} 写入单表 checkpoint，并原子清理范围旧数据。`);
            return { success: true, changed: clearedCount > 0 || options.targetSheetKeys.length > 0, clearedCount, checkpointCount: options.targetSheetKeys.length, targetMessageIndex, ...(cleanupWarnings.length ? { cleanupWarnings } : {}) };
        } catch (error: any) {
            snapshots.forEach((snapshot, idx) => restoreMessageFieldSnapshot_ACU(chat[idx], snapshot));
            return { success: false, changed: false, clearedCount: 0, checkpointCount: 0, targetMessageIndex, error: error?.message || String(error || '手动重填基底替换失败。') };
        }
    });
}

async function clearManualRefillSheetDataInRangeCore_ACU(targetMessageIndices: number[], targetSheetKeys: string[] | null = null): Promise<number> {
    if (!targetMessageIndices || targetMessageIndices.length === 0) return 0;
    if (!Array.isArray(targetSheetKeys) || targetSheetKeys.length === 0) {
        throw new Error('手动重填范围清理必须指定目标表。');
    }

    const chat = getChatArray_ACU();
    if (!chat || chat.length === 0) return 0;

    const isolationKey = getCurrentIsolationKey_ACU();
    const clearsSummaryOrOutline = tableListContainsSummaryOrOutline_ACU(targetSheetKeys);
    let clearedCount = 0;

    const normalizedIndices = targetMessageIndices.filter((idx): idx is number => Number.isInteger(idx) && idx >= 0 && idx < chat.length);
    const snapshots = new Map<number, ReturnType<typeof messageFieldSnapshot_ACU>>();
    normalizedIndices.forEach(idx => snapshots.set(idx, messageFieldSnapshot_ACU(chat[idx])));
    // 候选克隆上执行清理：strict save 失败时 live chat 保持原位，不产生半写清理。
    // 计划 §5.5：清理自身失败不半写；只有 strict save 成功才把候选改动 apply 到 live。
    const vectorManifestsToDeleteAfterCommit: any[] = [];

    try {
        const candidateChat = cloneCandidateChat_ACU(chat);
        for (const idx of normalizedIndices) {
            const msg = candidateChat[idx];
            if (!msg || msg.is_user) continue;

            const changed = purgeSheetKeysFromMessageForIsolation_ACU(msg, isolationKey, targetSheetKeys);
            if (clearsSummaryOrOutline) {
                const isolatedData = msg?.TavernDB_ACU_IsolatedData;
                const tagData = isolatedData && typeof isolatedData === 'object' && !Array.isArray(isolatedData)
                    ? isolatedData[isolationKey]
                    : null;
                // 只剥离 tagData 上的引用并收集 manifest，strict save 成功后才删除外置文件。
                if (tagData && await deleteVectorIndexManifestFromTagData_ACU(tagData, { deleteExternal: false, onManifest: manifest => vectorManifestsToDeleteAfterCommit.push(manifest) })) {
                    logDebug_ACU(`[手动重填预清理] 已标记消息索引 ${idx} 上的交火向量索引外置文件引用待删除。`);
                }
            }
            if (changed) {
                clearedCount++;
                logDebug_ACU(`[手动重填预清理] 已清理消息索引 ${idx} 上选中表的范围内旧数据 (标签: ${isolationKey || '无'})`);
            }
        }

        if (clearedCount > 0) {
            // candidate 改动 apply 到 live 后 strict save；失败时原位回滚并抛错，
            // 由调用方（orchestrator）把清理视为失败处理（保留删除语义，不恢复已删数据）。
            normalizedIndices.forEach(idx => applyCandidateMessageFields_ACU(chat[idx], candidateChat[idx]));
            await saveChatToHostStrict_ACU();
            // strict save 成功后才删除外置向量文件；清理失败仅记录警告，不影响已提交清理。
            await cleanupVectorIndexManifestsAfterCommit_ACU(vectorManifestsToDeleteAfterCommit);
            logDebug_ACU(`[手动重填预清理] 共清理 ${clearedCount} 条消息的选中表范围内旧数据，聊天已严格保存。`);
        }
        return clearedCount;
    } catch (error: any) {
        // strict save 失败：live chat 原位恢复（候选未 apply 或已 apply 均恢复），
        // 外置向量文件保持未删除。清理失败由调用方按失败语义处理（不恢复已删业务数据）。
        snapshots.forEach((snapshot, idx) => restoreMessageFieldSnapshot_ACU(chat[idx], snapshot));
        logError_ACU('[手动重填预清理] 清理 strict save 失败，已原位恢复聊天内存状态:', error);
        throw error;
    }
}

export async function clearManualRefillSheetDataInRange_ACU(targetMessageIndices: number[], targetSheetKeys: string[] | null = null): Promise<number> {
    if (!Array.isArray(targetSheetKeys) || targetSheetKeys.length === 0) {
        throw new Error('手动重填范围清理必须指定目标表。');
    }
    const writeSet = targetSheetKeys.map(sheetKey => ({ kind: 'sheet' as const, sheetKey }));
    return runTableWriteTransaction_ACU({
        source: 'system_cleanup',
        reason: 'clearManualRefillSheetDataInRange',
        isolationKey: getCurrentIsolationKey_ACU(),
        writeSet,
        maintenanceMode: 'exclusive',
    }, () => clearManualRefillSheetDataInRangeCore_ACU(targetMessageIndices, targetSheetKeys));
}

function purgeTargetSheetKeysFromMessage_ACU(msg: any, targetSheetKeys: string[], _messageIndex: number): boolean {
    return purgeSheetKeysFromMessage_ACU(msg, targetSheetKeys);
}
