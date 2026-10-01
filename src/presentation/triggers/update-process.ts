// update-process.ts — 表格更新 UI 壳（presentation 层：负责 UI 交互）
// service 层只返回结果，presentation 层根据返回值自行决定 UI 操作。

import { _set_isAutoUpdatingCard_ACU, _set_wasStoppedByUser_ACU, currentJsonTableData_ACU, getCurrentIsolationKey_ACU, settings_ACU } from '../../service/runtime/state-manager';
import { getChatArray_ACU } from '../../service/chat/chat-service';
import { getSelectedManualTableKeys_ACU } from '../../service/settings/settings-readers';
import { showToastr_ACU } from '../theme/toast';
import { showCustomConfirm_ACU } from '../theme/custom-confirm';
import { ACU_TOAST_CATEGORY_ACU } from '../../shared/constants';
import { logDebug_ACU, logError_ACU, logWarn_ACU } from '../../shared/utils';
// re-export 从 service 层搬迁的业务逻辑函数，保持外部调用方兼容
export { saveCurrentDataForTable_ACU } from '../../service/chat/chat-service';
import { $statusMessageSpan_ACU } from '../state/ui-refs';
import { topLevelWindow_ACU } from '../../shared/env';
import { beginNoticeTask_ACU, type NoticeTaskHandle_ACU } from '../../shared/notice-hub';
import { resetManualUpdateButton_ACU, shouldShowVectorMemoryManualUpdateWarning_ACU, syncManualUpdateButtonAvailability_ACU } from '../components/status-display';
import { updateCardUpdateStatusDisplay_ACU } from '../components/update-status-display';
import { collectManualExtraHint_ACU } from './settings-ui-sync';
import { refreshMergedDataAndNotifyWithUI_ACU } from '../components/pipeline-ui-helpers';
import { abortAllActiveRequests_ACU } from '../../service/runtime/state-manager';
import {
    processUpdatesBatch_ACU,
    executeCardUpdateCore_ACU,
    orchestrateManualUpdate_ACU,
    type CardUpdateResult,
    type BatchUpdateResult,
    type CardUpdateProgressEvent,
    type BatchUpdateProgressContext,
} from '../../service/table/update-orchestrator';
import { collectV2CheckpointFloorsFromChat_ACU } from '../../service/table/table-history';

// ============================================================
// UI 辅助函数
// ============================================================

function updateStatusText(text: string, isSilentMode: boolean) {
    if (!isSilentMode && $statusMessageSpan_ACU) $statusMessageSpan_ACU.text(text);
}

function notifyTableFillStart() {
    try { (topLevelWindow_ACU as any).AutoCardUpdaterAPI._notifyTableFillStart(); } catch (_) {}
}

function notifyTableUpdate() {
    try { (topLevelWindow_ACU as any).AutoCardUpdaterAPI._notifyTableUpdate(); } catch (_) {}
}

function updateStatusDisplay() {
    if (typeof updateCardUpdateStatusDisplay_ACU === 'function') updateCardUpdateStatusDisplay_ACU();
}

function buildBatchProgressLabel(event: Partial<CardUpdateProgressEvent>): string {
    if (Number.isFinite(event.currentBatch) && Number.isFinite(event.totalBatches)) {
        return `第 ${event.currentBatch}/${event.totalBatches} 批`;
    }
    return '当前批次';
}

function formatLegacyCheckpointReasonLabel_ACU(reason?: string): string {
    switch (reason) {
        case 'init':
            return '初始基线';
        case 'migration':
            return '迁移基线';
        case 'compaction':
            return '保留边界基线';
        case 'manual':
            return '历史手动基线';
        case 'periodic':
            return '历史周期基线';
        default:
            return reason ? `旧基线:${reason}` : '旧基线';
    }
}

function formatLegacyAiFloorRange_ACU(startAiFloor: number, endAiFloor: number): string {
    return startAiFloor === endAiFloor ? `AI 第 ${startAiFloor} 层` : `AI 第 ${startAiFloor}~${endAiFloor} 层`;
}

function buildLegacySelectedSheetSummary_ACU(targetKeys: string[]): string {
    const tables = currentJsonTableData_ACU && typeof currentJsonTableData_ACU === 'object' ? currentJsonTableData_ACU as Record<string, any> : null;
    return targetKeys.map(key => `${String(tables?.[key]?.name || key)}（${key}）`).join('、');
}

function buildLegacyCheckpointFloorsLabel_ACU(): string {
    try {
        const checkpoints = collectV2CheckpointFloorsFromChat_ACU(getChatArray_ACU(), getCurrentIsolationKey_ACU());
        return checkpoints.length > 0
            ? checkpoints.map(item => `AI 第 ${item.aiFloor} 层（${formatLegacyCheckpointReasonLabel_ACU(item.reason)}）`).join('、')
            : '当前隔离标签暂无 full checkpoint';
    } catch {
        return '当前隔离标签暂无 full checkpoint';
    }
}

function buildLegacyManualRefillRangeLabel_ACU(): string {
    try {
        const chat = getChatArray_ACU();
        if (!Array.isArray(chat) || chat.length === 0) return '暂无可重填 AI 楼层';
        const aiItems = chat
            .map((msg: any, index: number) => msg && !msg.is_user ? { index, aiFloor: 0 } : null)
            .filter((item): item is { index: number; aiFloor: number } => item !== null);
        aiItems.forEach((item, index) => { item.aiFloor = index + 1; });
        const skip = Number.isFinite(Number(settings_ACU.skipUpdateFloors)) ? Math.max(0, Math.floor(Number(settings_ACU.skipUpdateFloors))) : 0;
        const manualDepth = Number.isFinite(Number(settings_ACU.manualUpdateContextDepth)) && Number(settings_ACU.manualUpdateContextDepth) > 0 ? Math.floor(Number(settings_ACU.manualUpdateContextDepth)) : aiItems.length;
        const effectiveAiItems = skip > 0 ? aiItems.slice(0, -skip) : aiItems.slice();
        const contextItems = manualDepth > 0 ? effectiveAiItems.slice(-manualDepth) : effectiveAiItems;
        if (!contextItems.length) return '暂无可重填 AI 楼层';
        return formatLegacyAiFloorRange_ACU(contextItems[0].aiFloor, contextItems[contextItems.length - 1].aiFloor);
    } catch {
        return '暂无可重填 AI 楼层';
    }
}

function buildProgressMessage(event: CardUpdateProgressEvent): string {
    const batchLabel = buildBatchProgressLabel(event);
    switch (event.phase) {
        case 'preparing':
            return `${batchLabel}：准备AI输入...`;
        case 'calling_ai':
            return `${batchLabel}：第 ${event.attempt || 1}/${event.maxRetries || 1} 次调用AI进行增量更新...`;
        case 'parsing':
            return `${batchLabel}：解析并应用AI返回的更新...`;
        case 'saving':
            return `${batchLabel}：正在将更新后的数据库保存到聊天记录...`;
        case 'chunk_done':
            return `${batchLabel}：分块处理成功...`;
        case 'complete':
            return `${batchLabel}：数据库增量更新成功！`;
        case 'retry':
            return `${batchLabel}：第 ${event.attempt || 1}/${event.maxRetries || 1} 次尝试失败，5秒后重试...${event.message ? ` (${event.message})` : ''}`;
        case 'error':
            return `${batchLabel}：错误：更新失败。`;
        default:
            return `${batchLabel}：正在处理...`;
    }
}

/**
 * 登记一个可停止的填表进度任务。停止只作用于填表：标记用户终止、中断在途请求并复位填表状态。
 */
function beginTableFillTask(feature: string, detail: string): NoticeTaskHandle_ACU {
    const task: NoticeTaskHandle_ACU = beginNoticeTask_ACU(feature, {
        detail,
        action: {
            label: '终止',
            variant: 'danger',
            run: () => {
                syncManualUpdateButtonAvailability_ACU();
                _set_wasStoppedByUser_ACU(true);
                abortAllActiveRequests_ACU();
                _set_isAutoUpdatingCard_ACU(false);
                updateStatusText('填表任务已终止，正在停止当前任务与后续批次...', false);
                task.update('填表任务已终止，正在停止当前任务与后续批次...', { action: null });
                showToastr_ACU('warning', '填表任务已由用户终止，当前任务与后续批次将立即停止。');
            },
        },
    });
    return task;
}

/**
 * 根据 service 层返回的进度事件更新 UI
 * presentation 层自己决定"怎么展示"
 */
function handleProgressEvent(event: CardUpdateProgressEvent, isSilentMode: boolean, progressTask?: NoticeTaskHandle_ACU | null) {
    if (isSilentMode) return;
    const message = buildProgressMessage(event);
    updateStatusText(message, false);
    progressTask?.update(message);

    switch (event.phase) {
        case 'complete':
            updateStatusDisplay();
            notifyTableUpdate();
            break;
        case 'retry':
            showToastr_ACU('warning', message, { timeOut: 5000 });
            break;
        default:
            break;
    }
}

// ============================================================
// Presentation 层 UI 壳函数
// ============================================================

/**
 * 执行单次卡片更新：presentation 层负责 toast/停止按钮/状态文本
 * service 层只返回 CardUpdateResult
 */
export async function proceedWithCardUpdate_ACU(
    messagesToUse: any[],
    batchToastMessage = '正在填表，请稍候...',
    saveTargetIndex = -1,
    isImportMode = false,
    updateMode = 'standard',
    isSilentMode = false,
    targetSheetKeys: string[] | null = null,
    requestOptions: Record<string, any> | null = null,
    progressContext: BatchUpdateProgressContext | null = null,
    showFinalErrorToast = true,
): Promise<CardUpdateResult> {
    logDebug_ACU(`[更新流程] proceedWithCardUpdate: 消息数=${messagesToUse.length}, 模式=${updateMode}, 静默=${isSilentMode}, 目标表=${targetSheetKeys?.join(',') || '全部'}`);
    const localAbortController = new AbortController();
    let progressTask: NoticeTaskHandle_ACU | null = null;

    // UI：通知填表开始
    if (!isSilentMode) {
        notifyTableFillStart();

        // UI：登记可停止的填表进度任务
        const initialMessage = progressContext
            ? `${buildBatchProgressLabel(progressContext)}：${batchToastMessage || '正在填表，请稍候...'}`
            : (batchToastMessage || '正在填表，请稍候...');
        progressTask = beginTableFillTask(isImportMode ? '外部导入' : '填表', initialMessage);
    }

    try {
        // 调用 service 层，传入进度回调（只接收纯数据事件）
        const result = await executeCardUpdateCore_ACU(
            messagesToUse,
            saveTargetIndex,
            isImportMode,
            updateMode,
            isSilentMode,
            targetSheetKeys,
            requestOptions,
            localAbortController,
            progressContext,
            (event) => handleProgressEvent(event, isSilentMode, progressTask)
        );

        // UI：根据返回值决定后续 UI 操作
        if (result.success && !isSilentMode) {
            setTimeout(() => {
                notifyTableUpdate();
            }, 250);
        } else if (!result.success && !result.aborted && !isSilentMode && showFinalErrorToast) {
            showToastr_ACU('error', `更新失败: ${result.error || '未知错误'}`);
            updateStatusText('错误：更新失败。', false);
        }

        return result;
    } finally {
        // UI：结束进度任务
        progressTask?.end();
    }
}

/**
 * 批处理更新：presentation 层调用 service 层，根据返回值显示 toast
 */
export async function processUpdates_ACU(indicesToUpdate: number[], mode = 'auto', options: any = {}): Promise<BatchUpdateResult> {
    const result = await processUpdatesBatch_ACU(
        indicesToUpdate,
        mode,
        options,
        // executeUpdate 回调：创建 AbortController 并调用 presentation 层的 proceedWithCardUpdate
        async (
            messagesToUse: any[],
            saveTargetIndex: number,
            updateMode: string,
            isSilentMode: boolean,
            targetSheetKeys: string[] | null,
            requestOptions: Record<string, any> | null,
            progressContext: BatchUpdateProgressContext
        ): Promise<CardUpdateResult> => {
            return proceedWithCardUpdate_ACU(messagesToUse, '', saveTargetIndex, false, updateMode, isSilentMode, targetSheetKeys, requestOptions, progressContext, false);
        }
    );

    // UI：根据返回值显示错误 toast
    if (!result.success && result.error) {
        showToastr_ACU('error', result.error);
    }

    return result;
}

/**
 * 手动更新：presentation 层负责收集 UI 输入、显示确认框、显示 toast、重置按钮
 * service 层只返回 ManualUpdateResult
 */
export async function handleManualUpdate_ACU(options: { skipConfirm?: boolean } = {}): Promise<boolean> {
    logDebug_ACU('[更新流程] handleManualUpdate: 开始手动更新');
    let manualProgressTask: NoticeTaskHandle_ACU | null = null;
    try {
        if (shouldShowVectorMemoryManualUpdateWarning_ACU()) {
            syncManualUpdateButtonAvailability_ACU();
            showToastr_ACU('warning', '向量功能启用时不建议手动更新表格；本次将继续执行。', {
                acuToastCategory: ACU_TOAST_CATEGORY_ACU.MANUAL_TABLE,
            });
        }
 
        // UI：收集手动额外提示
        collectManualExtraHint_ACU();

        // 从持久化设置读取表格选择，不能依赖已移除的 V1 checkbox DOM。
        const targetKeys = getSelectedManualTableKeys_ACU();

        // [前置校验] 在弹出确认框之前，先做基本有效性检查
        // 避免用户确认后又因为"没选表格"或"聊天为空"而报错
        if (!targetKeys || targetKeys.length === 0) {
            showToastr_ACU('warning', '未选择需要更新的表格。');
            return false;
        }

        const selectedSheetSummary = buildLegacySelectedSheetSummary_ACU(targetKeys);
        const checkpointFloorsLabel = buildLegacyCheckpointFloorsLabel_ACU();
        const manualRefillRangeLabel = buildLegacyManualRefillRangeLabel_ACU();
        // 弹出确认框：手动填表会先删除范围内选中表的 checkpoint 与增量，再重新填写
        // 外部 API 调用由调用方负责确认（skipConfirm），不在宿主页面弹出确认遮罩。
        const confirmed = options.skipConfirm === true || await showCustomConfirm_ACU(
            '手动填表确认',
            `即将执行手动填表。\n\n当前 full checkpoint：${checkpointFloorsLabel}\n本次重填范围：${manualRefillRangeLabel}\n选中表：${selectedSheetSummary}\n\n` +
            '高风险操作：系统会先删除本次重填范围内选中表的 checkpoint 与 V2 增量日志，再以清理后的状态作为填表基底重新填写，最后写入新的单表 checkpoint。\n' +
            '如果被删除的 checkpoint 是这些表唯一的数据基线，此前楼层的表格数据将无法恢复。\n' +
            '保留边界 checkpoint 会按 AI 回复楼层计数，在达到保留窗口和 20 个 AI 楼层缓冲后自动滚动建立。\n' +
            '范围外的 checkpoint、范围外聊天记录的表格数据和未选中的表不会被删除。执行失败或终止时会回滚到本次操作前的状态。',
            { confirmLabel: '确认并继续', cancelLabel: '取消' }
        );

        if (!confirmed) {
            logDebug_ACU('[更新流程] 用户取消了手动填表确认框');
            showToastr_ACU('info', '已取消手动填表。');
            return false;
        }

        // 调用 service 层，启用事务式手动重填（兼容沿用 clearBeforeUpdate 参数名）
        _set_wasStoppedByUser_ACU(false);
        notifyTableFillStart();
        manualProgressTask = beginTableFillTask('手动填表', '手动填表开始。');

        const result = await orchestrateManualUpdate_ACU(
            targetKeys,
            // processBatch 回调保留给兼容路径；当前手动填表主路径由 service grouped helper 执行。
            async (indices, batchMode, batchOptions) => {
                return processUpdates_ACU(indices, batchMode, batchOptions);
            },
            // refreshData 回调（纯数据刷新 + UI 刷新）
            async () => {
                await refreshMergedDataAndNotifyWithUI_ACU();
            },
            // [新增] 传入用户确认后的预清空选项
            {
                clearBeforeUpdate: true,
                onProgress: event => handleProgressEvent(event, false, manualProgressTask),
                // 注意：legacy 入口未传 executionSnapshot，不启用确认期 TOCTOU 快照防护
                // （该防护由 V2 UI useManualUpdate 在确认前建立快照并传入 service）。
                // 刻意保持兼容，不把可选参数改为必填。
            }
        );

        manualProgressTask?.end();
        manualProgressTask = null;

        // UI：根据返回值显示 toast
        if (result.success) {
            showToastr_ACU(result.checkpointWarning ? 'warning' : 'success', result.checkpointWarning ? `手动更新完成，但 AI 楼层保留边界 checkpoint 建立失败：${result.checkpointWarning}` : '手动更新完成！');
            updateStatusDisplay();
            notifyTableUpdate();

            if (result.autoMergeTriggered && result.autoMergeSuccess) {
                showToastr_ACU('success', '自动合并纪要完成！');
                notifyTableUpdate();
            }
        } else if (result.error) {
            // 区分 warning 和 error 类型
            const warningMessages = ['正在进行中', '聊天记录为空', '尚未检测到', '未选择', '未找到可用'];
            const isWarning = warningMessages.some(msg => result.error!.includes(msg));
            showToastr_ACU(isWarning ? 'warning' : 'error', result.error);
        }
        return result.success === true;
    } finally {
        manualProgressTask?.end();
        // UI：重置手动更新按钮
        if (typeof resetManualUpdateButton_ACU === 'function') resetManualUpdateButton_ACU();
    }
}

// saveCurrentDataForTable_ACU 已搬迁到 service/chat/chat-service.ts
// 通过文件顶部的 re-export 保持外部调用方兼容
