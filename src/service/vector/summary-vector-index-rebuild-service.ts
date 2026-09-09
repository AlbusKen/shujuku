import { currentJsonTableData_ACU } from '../runtime/state-manager';
import { loadOrCreateJsonTableFromChatHistory_ACU } from '../table/table-service';
import { updateReadableLorebookEntry_ACU } from '../worldbook/pipeline';
import { clearSummaryVectorIndexCredentialCooldowns_ACU } from './summary-vector-index-flush-queue';
import type { SummaryVectorIndexArchiveResult_ACU } from './summary-vector-index-archive-service';
import {
    rebuildSummaryVectorMirror_ACU,
    type SummaryVectorMirrorRebuildReason_ACU,
} from './summary-vector-mirror-rebuild';

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
