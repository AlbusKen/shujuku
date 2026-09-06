import { getChatArray_ACU } from '../chat/chat-service';
import { currentChatFileIdentifier_ACU, currentJsonTableData_ACU, getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import { loadOrCreateJsonTableFromChatHistory_ACU } from '../table/table-service';
import { getLatestAiMessageIndexFromChat_ACU } from '../table/table-history';
import { runTableUpdateCommit_ACU } from '../table/table-update-commit';
import { updateReadableLorebookEntry_ACU } from '../worldbook/pipeline';
import {
    archiveSummaryVectorIndexNow_ACU,
    findSummaryTable_ACU,
    type SummaryVectorIndexArchiveResult_ACU,
} from './summary-vector-index-archive-service';
import {
    clearSummaryVectorIndexCredentialCooldowns_ACU,
    clearSummaryVectorIndexFlushQueueForCurrentScope_ACU,
} from './summary-vector-index-flush-queue';

/**
 * 立即重建当前聊天的交火纪要索引。
 * 这是“立即构建交火纪要索引”按钮与索引自愈共用的普通构建链路。
 */
export async function rebuildCurrentSummaryVectorIndexNow_ACU(): Promise<SummaryVectorIndexArchiveResult_ACU> {
    if (!currentJsonTableData_ACU) {
        await loadOrCreateJsonTableFromChatHistory_ACU();
    }
    if (!currentJsonTableData_ACU) {
        throw new Error('数据库未加载，无法重建交火索引快照。');
    }

    const selectedSummary = findSummaryTable_ACU();
    if (selectedSummary) {
        const { summaryKey, table } = selectedSummary;
        const chat = Array.isArray(getChatArray_ACU()) ? getChatArray_ACU() : [];
        const targetMessageIndex = getLatestAiMessageIndexFromChat_ACU(chat);
        if (targetMessageIndex < 0 || !chat[targetMessageIndex] || chat[targetMessageIndex].is_user) {
            return {
                success: false,
                skipped: false,
                indexedRowCount: 0,
                skippedRowCount: 0,
                chunkCount: 0,
                reason: 'vector_index_rebuild_no_ai_target',
                errors: ['当前聊天没有可绑定的 AI 目标楼层，已停止纪要索引重建。'],
            };
        }
        const writeSet = [{ kind: 'sheet' as const, sheetKey: summaryKey }];
        const commit = await runTableUpdateCommit_ACU<null>({
            source: 'system',
            reason: 'vector_index_rebuild_snapshot',
            chatKey: currentChatFileIdentifier_ACU,
            isolationKey: getCurrentIsolationKey_ACU(),
            writeSet,
            revisionWriteSet: writeSet,
            initialData: currentJsonTableData_ACU,
            targetMessageIndex,
            targetSheetKeys: [summaryKey],
            updateGroupKeys: null,
            trackingSheetKeys: [],
            trackAsUpdate: false,
            operations: [{ kind: 'sheet_replace', sheetKey: summaryKey, sheet: table, reason: 'system' }],
        }, () => ({
            success: true,
            value: null,
            tableData: currentJsonTableData_ACU,
            mutationResult: { changes: 1, errors: [] },
        }));
        if (!commit.success || commit.saved === false) {
            throw new Error(commit.error || '纪要表快照提交失败。');
        }
        // 手动/自愈重建必须取代同 scope 下已排队或正在等待发布的旧 flush。
        // tombstone 与 archive 共享 FIFO mutation lock；旧 runner 会在 durable publish 前被 generation fence 拒绝。
        await clearSummaryVectorIndexFlushQueueForCurrentScope_ACU({
            isolationKey: getCurrentIsolationKey_ACU(), sourceTableKey: summaryKey,
        });
    }

    const result = await archiveSummaryVectorIndexNow_ACU({ mode: 'sync' });
    if (result.success && !result.skipped) {
        // T4：手动/自愈重建成功 = 显式解除入口，清除 credential cooldown，
        // 避免换 key 或配置修复后仍被旧 cooldown 拦住。
        clearSummaryVectorIndexCredentialCooldowns_ACU();
        try {
            await updateReadableLorebookEntry_ACU(true);
        } catch {
            // 索引已经 durable publish；世界书刷新失败不应把已完成构建报告为失败。
        }
    }
    return result;
}
