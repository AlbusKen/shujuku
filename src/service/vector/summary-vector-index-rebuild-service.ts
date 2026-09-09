import { currentJsonTableData_ACU, getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { loadOrCreateJsonTableFromChatHistory_ACU } from '../table/table-service';
import { updateReadableLorebookEntry_ACU } from '../worldbook/pipeline';
import { getCurrentWorldbookConfig_ACU } from '../settings/settings-readers';
import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { clearSummaryVectorIndexCredentialCooldowns_ACU } from './summary-vector-index-flush-queue';
import type { SummaryVectorIndexArchiveResult_ACU } from './summary-vector-index-archive-service';
import {
    currentEnvironmentHasSummaryVectorMirror_ACU,
    publishSummaryVectorMirrorRowRemovalSnapshot_ACU,
    rebuildSummaryVectorMirror_ACU,
    snapshotSummaryVectorMirrorExcludingRows_ACU,
    type SummaryVectorMirrorRebuildReason_ACU,
    type SummaryVectorMirrorRowRemovalSnapshot_ACU,
} from './summary-vector-mirror-rebuild';

export type { SummaryVectorMirrorRowRemovalSnapshot_ACU };

export interface EnsureSummaryVectorMirrorAfterTableFillResult_ACU {
    attempted: boolean;
    skipped: boolean;
    reason: string;
    result?: SummaryVectorIndexArchiveResult_ACU;
}

/**
 * 立即重建当前聊天的纪要向量镜像。
 * 显式按钮走 rebuild_user；发送前自愈走 rebuild_repair；legacy / 首次构建走 initial。
 */
export async function rebuildCurrentSummaryVectorIndexNow_ACU(
    options: { reason?: SummaryVectorMirrorRebuildReason_ACU } = {},
): Promise<SummaryVectorIndexArchiveResult_ACU> {
    if (!currentJsonTableData_ACU) {
        await loadOrCreateJsonTableFromChatHistory_ACU();
    }
    if (!currentJsonTableData_ACU) {
        throw new Error('数据库未加载，无法重建交火索引快照。');
    }

    const result = await rebuildSummaryVectorMirror_ACU({
        reason: options.reason || 'rebuild_user',
    });
    if (result.success && !result.skipped) {
        clearSummaryVectorIndexCredentialCooldowns_ACU();
        try {
            await updateReadableLorebookEntry_ACU(true);
        } catch {
            // 镜像已经 durable publish；世界书刷新失败不应把已完成构建报告为失败。
        }
    }
    return result;
}

export async function snapshotSummaryVectorMirrorExcludingRowsNow_ACU(options: {
    excludedRowIds: string[];
    sourceTableKey?: string;
}): Promise<SummaryVectorMirrorRowRemovalSnapshot_ACU> {
    return snapshotSummaryVectorMirrorExcludingRows_ACU(options);
}

export async function publishSummaryVectorMirrorRowRemovalSnapshotNow_ACU(
    snapshot: SummaryVectorMirrorRowRemovalSnapshot_ACU | null | undefined,
): Promise<SummaryVectorIndexArchiveResult_ACU> {
    const result = await publishSummaryVectorMirrorRowRemovalSnapshot_ACU(snapshot);
    if (result.success && !result.skipped) {
        clearSummaryVectorIndexCredentialCooldowns_ACU();
        try {
            await updateReadableLorebookEntry_ACU(true);
        } catch {
            // 镜像已经 durable publish；世界书刷新失败不应把已完成发布报告为失败。
        }
    }
    return result;
}

/**
 * 填表完成后：功能开启且当前 isolation 没有任何 V2 向量镜像时，立刻 initial 重建。
 * 不依赖 modifiedKeys 是否包含纪要表。失败只返回结果，不抛给填表主流程。
 */
export async function ensureSummaryVectorMirrorAfterTableFill_ACU(): Promise<EnsureSummaryVectorMirrorAfterTableFillResult_ACU> {
    const worldbook = getCurrentWorldbookConfig_ACU();
    if (worldbook.summaryVectorIndexModeEnabled !== true) {
        return { attempted: false, skipped: true, reason: 'feature_disabled' };
    }
    if (worldbook.summaryVectorMirrorEnabled === false) {
        return { attempted: false, skipped: true, reason: 'mirror_disabled' };
    }
    const isolationKey = getCurrentIsolationKey_ACU();
    if (currentEnvironmentHasSummaryVectorMirror_ACU(getChatArray_ACU(), isolationKey)) {
        return { attempted: false, skipped: true, reason: 'vector_data_present' };
    }
    try {
        const result = await rebuildCurrentSummaryVectorIndexNow_ACU({ reason: 'initial' });
        if (result.success) {
            logDebug_ACU(`[交火模式纪要索引] 填表完成后已执行首次向量重建：reason=${result.reason || 'initial'}, skipped=${result.skipped}`);
        } else {
            logWarn_ACU(`[交火模式纪要索引] 填表完成后首次向量重建失败：${result.errors.join('; ') || result.reason || 'unknown'}`);
        }
        return {
            attempted: true,
            skipped: result.skipped,
            reason: result.reason || 'initial',
            result,
        };
    } catch (error: any) {
        const message = error?.message || String(error || '首次向量重建异常');
        logWarn_ACU('[交火模式纪要索引] 填表完成后首次向量重建异常:', message);
        return { attempted: true, skipped: false, reason: 'rebuild_exception' };
    }
}
