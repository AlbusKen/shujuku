/**
 * presentation/triggers/settings-ui-sync/settings-ui-trigger.ts
 */
import { syncManualUpdateButtonAvailability_ACU } from '../../components/status-display';
import { beginNoticeTask_ACU, type NoticeTaskHandle_ACU } from '../../../shared/notice-hub';
import { updateCardUpdateStatusDisplay_ACU } from '../../components/update-status-display';
import { isAutoUpdatingCard_ACU, _set_isAutoUpdatingCard_ACU } from '../../components/plot-editors';
import { showToastr_ACU } from '../../theme/toast';
import { getChatArray_ACU } from '../../../service/chat/chat-service';
import { abortAllActiveRequests_ACU, currentChatFileIdentifier_ACU, currentJsonTableData_ACU, getCurrentIsolationKey_ACU, hasActiveContentGeneration_ACU, settings_ACU, _set_manualExtraHint_ACU, _set_wasStoppedByUser_ACU } from '../../../service/runtime/state-manager';
import { $manualExtraHintCheckbox_ACU } from '../../state/ui-refs';
import { processUpdates_ACU } from '../update-process';
import { getSortedSheetKeys_ACU } from '../../../service/template/chat-scope';
import { loadAllChatMessages_ACU, updateReadableLorebookEntry_ACU } from '../../../service/worldbook/pipeline';
import { getStorageProvider } from '../../../service/table/table-storage-strategy';
import { topLevelWindow_ACU } from '../../../shared/env';
import { logDebug_ACU } from '../../../shared/utils';
import { purgeOldLayerData_ACU } from './settings-ui-config';
import { buildAutoUpdatePlan_ACU, checkAutoUpdatePreConditions_ACU, executeAutoUpdatePlan_ACU } from '../../../service/table/update-scheduler';
import { executeAutoFillStagingGroups_ACU, processGroupedRuntimeChunk_ACU, type CardUpdateProgressEvent } from '../../../service/table/update-orchestrator';
import { isSqliteMode } from '../../../service/table/storage-mode';
import { startRuntimePerformanceSpan_ACU } from '../../../shared/runtime-performance';
import { logAutoFillSkip_ACU, logAutoFillStage_ACU, type AutoFillSkipContext_ACU } from '../../../shared/trigger-diagnostics';

function buildAutoUpdateProgressLabel_ACU(event: Partial<CardUpdateProgressEvent>): string {
    if (Number.isFinite(event.currentBatch) && Number.isFinite(event.totalBatches)) {
        return `第 ${event.currentBatch}/${event.totalBatches} 批`;
    }
    return '当前批次';
}

function buildAutoUpdateProgressMessage_ACU(event: CardUpdateProgressEvent): string {
    const batchLabel = buildAutoUpdateProgressLabel_ACU(event);
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

async function refreshRuntimeDataAndNotifyAfterAutoUpdate_ACU(): Promise<void> {
    const data = getStorageProvider().getCurrentData() || currentJsonTableData_ACU;
    if (data) {
        await updateReadableLorebookEntry_ACU(true, false, null, data);
    }
    try {
        (topLevelWindow_ACU as any).AutoCardUpdaterAPI?._notifyTableUpdate?.();
    } catch (_) {}
}

function handleAutoGroupedProgressEvent_ACU(event: CardUpdateProgressEvent, progressTask?: NoticeTaskHandle_ACU | null) {
    const message = buildAutoUpdateProgressMessage_ACU(event);
    progressTask?.update(message);

    switch (event.phase) {
        case 'complete':
            if (typeof updateCardUpdateStatusDisplay_ACU === 'function') updateCardUpdateStatusDisplay_ACU();
            break;
        case 'retry':
            showToastr_ACU('warning', message, { timeOut: 5000 });
            break;
        default:
            break;
    }
}

let autoUpdateQueueTail_ACU: Promise<void> = Promise.resolve();
let autoUpdateQueueId_ACU = 0;
let autoFillEventEpoch_ACU = 0;

/** 接收时绑定事件代次，与聊天作用域及生成资格分别校验。 */
export function captureAutoFillEventScope_ACU(): () => boolean {
    const epoch = autoFillEventEpoch_ACU;
    return () => epoch === autoFillEventEpoch_ACU;
}

/** 作废旧通知和排队任务；不调用全局取消，也不撤销已经发出的请求。 */
export function cancelPendingAutoFillEvent_ACU(): void {
    ++autoFillEventEpoch_ACU;
}

  // 每次调用独立排队；失败只回报当前调用，不中断后续信号。
  export function triggerAutomaticUpdateIfNeeded_ACU(
    performanceContext?: { runId?: string; parentSpanId?: string },
    triggerContext: AutoFillSkipContext_ACU & {
      /** 捕获事件时的宿主身份与聊天代次，在排队等待后再次验证。 */
      isCurrentChat?: () => boolean;
      /** 捕获事件时的任务代次，重生成、停止或删楼后失效。 */
      isCurrentEvent?: () => boolean;
    } = {},
  ): Promise<void> {
    const queueId = ++autoUpdateQueueId_ACU;
    const runId = performanceContext?.runId || `autofill-${queueId}`;
    const { isCurrentChat, isCurrentEvent, ...diagnosticContext } = triggerContext;
    const context = { ...diagnosticContext, runId, queueId };
    const scoped = context.chatKey !== undefined || context.isolationKey !== undefined;
    const chatAtEnqueue = scoped ? getChatArray_ACU() : undefined;
    const isEnqueuedEventCurrent = captureAutoFillEventScope_ACU();
    const canProcessEvent = (stage: string): boolean => {
      if (!isEnqueuedEventCurrent() || (isCurrentEvent && !isCurrentEvent())) {
        logAutoFillSkip_ACU('generation_changed', { ...context, stage });
        return false;
      }
      if ((isCurrentChat && !isCurrentChat()) || scoped && (getChatArray_ACU() !== chatAtEnqueue
        || context.chatKey !== undefined && context.chatKey !== currentChatFileIdentifier_ACU
        || context.isolationKey !== undefined && context.isolationKey !== getCurrentIsolationKey_ACU())) {
        logAutoFillSkip_ACU('chat_changed', { ...context, stage });
        return false;
      }
      if (hasActiveContentGeneration_ACU()) {
        logAutoFillSkip_ACU('generation_in_progress', { ...context, stage });
        return false;
      }
      return true;
    };
    if (!canProcessEvent('enqueue')) return Promise.resolve();
    logAutoFillStage_ACU('queued', context);
    const request = autoUpdateQueueTail_ACU.then(async () => {
      logAutoFillStage_ACU('dequeued', context);
      try {
        if (!canProcessEvent('dequeue')) return;
        await runAutomaticUpdateIfNeeded_ACU({ ...performanceContext, runId }, context, canProcessEvent);
        logAutoFillStage_ACU('queue_completed', context);
      } catch (error) {
        logAutoFillSkip_ACU('execution_failed', { ...context, stage: 'dispatch' });
        throw error;
      }
    });
    autoUpdateQueueTail_ACU = request.catch(() => {});
    return request;
  }

  async function runAutomaticUpdateIfNeeded_ACU(
    performanceContext?: { runId?: string; parentSpanId?: string },
    context: AutoFillSkipContext_ACU = {},
    canProcessEvent: (stage: string) => boolean = () => true,
  ): Promise<void> {
    logDebug_ACU('ACU Auto-Trigger: Starting independent check...');
    // 新一轮自动填表开跑前清掉上一轮「终止」残留，避免 isStopped() 立刻把新任务掐死。
    _set_wasStoppedByUser_ACU(false);
    const performanceSpan = startRuntimePerformanceSpan_ACU('auto-update-trigger', {
      ...performanceContext,
      settings: settings_ACU,
    });

    try {
    // 前置检查与更新计划使用同一宿主聊天，不依赖世界书消息投影的加载状态。
    const liveChat = getChatArray_ACU();
    const preCheck = checkAutoUpdatePreConditions_ACU(settings_ACU);
    logAutoFillStage_ACU('preconditions', { ...context, success: preCheck.canProceed });
    if (!preCheck.canProceed) {
      logDebug_ACU(`ACU Auto-Trigger: ${preCheck.reason} Skipping.`);
      logAutoFillSkip_ACU('preconditions_failed', {
        ...context,
        aiFloorCount: liveChat?.filter((message: any) => !message.is_user).length || 0,
        inFlight: isAutoUpdatingCard_ACU,
        preconditionReason: preCheck.code,
      });
      return;
    }

    const totalAiMessages = liveChat.filter(m => !m.is_user).length;

    // [重构] 调用 service 层构建更新计划
    const triggerIsolationKey = getCurrentIsolationKey_ACU();
    const plan = buildAutoUpdatePlan_ACU(
      liveChat,
      currentJsonTableData_ACU,
      settings_ACU,
      triggerIsolationKey,
      { runId: performanceContext?.runId || performanceSpan.id, parentSpanId: performanceSpan.id },
    );
    logAutoFillStage_ACU('plan', {
      ...context, aiFloorCount: totalAiMessages, sheetCount: plan.tablesToUpdate.length,
      groupCount: Object.keys(plan.updateGroups).length,
    });
    if (plan.tablesToUpdate.length === 0) {
      logAutoFillSkip_ACU('no_tables_due', { ...context, aiFloorCount: totalAiMessages });
      return;
    }

    const useGroupedAutoUpdates = !isSqliteMode();
    const autoGroupedAbortController = new AbortController();
    const canExecuteAutoFill = (stage: string): boolean => {
      if (autoGroupedAbortController.signal.aborted) return false;
      if (canProcessEvent(stage)) return true;
      // 只停止当前调度的后续执行委托，不影响其他功能或已经发出的请求。
      autoGroupedAbortController.abort();
      return false;
    };
    if (!canExecuteAutoFill('execute')) return;
    // 实际开始填表请求后才登记任务；同一调度的分组与批次共用一个进度框。
    let autoProgressTask: NoticeTaskHandle_ACU | null = null;
    const onAutoGroupedProgress = (event: CardUpdateProgressEvent): void => {
      if (autoGroupedAbortController.signal.aborted) return;
      logAutoFillStage_ACU(event.phase, {
        ...context, batchNumber: event.currentBatch, attempt: event.attempt,
      });
      if (event.phase === 'retry' || event.phase === 'error') {
        logAutoFillSkip_ACU('execution_failed', {
          ...context, stage: event.phase, batchNumber: event.currentBatch, attempt: event.attempt,
        });
      }
      if (!autoProgressTask && event.phase === 'calling_ai') {
        autoProgressTask = beginNoticeTask_ACU('自动填表', {
            detail: buildAutoUpdateProgressMessage_ACU(event),
            action: {
                label: '终止',
                variant: 'danger',
                run: () => {
                    syncManualUpdateButtonAvailability_ACU();
                    _set_wasStoppedByUser_ACU(true);
                    autoGroupedAbortController.abort();
                    abortAllActiveRequests_ACU();
                    autoProgressTask?.update('填表任务已终止，正在停止当前任务与后续批次...', { action: null });
                    showToastr_ACU('warning', '填表任务已由用户终止，当前任务与后续批次将立即停止。');
                },
            },
        });
      }
      handleAutoGroupedProgressEvent_ACU(event, autoProgressTask);
    };

    // 调用 service 层执行更新计划，传入纯业务操作委托（不含 UI 操作）
    let result: Awaited<ReturnType<typeof executeAutoUpdatePlan_ACU>>;
    try {
        result = await executeAutoUpdatePlan_ACU(
            plan,
            settings_ACU,
            _set_isAutoUpdatingCard_ACU,
            {
                processUpdates: (indices, mode, options) => {
                    if (!canExecuteAutoFill('process_updates')) return Promise.resolve(false);
                    return processUpdates_ACU(indices, mode, {
                       ...options, abortController: autoGroupedAbortController, onProgress: onAutoGroupedProgress, planManaged: true,
                    });
                },
                ...(useGroupedAutoUpdates
                    ? {
                        processGroupedUpdates: (groups, mode, options) => {
                            if (!canExecuteAutoFill('process_grouped_updates')) {
                                return Promise.resolve({ success: false, aborted: true, failedGroups: [] });
                            }
                            const upstreamProgress = options?.onProgress;
                            return processGroupedRuntimeChunk_ACU(groups, mode, {
                                ...options,
                                abortController: autoGroupedAbortController,
                                onProgress: event => {
                                    upstreamProgress?.(event);
                                    onAutoGroupedProgress(event);
                                },
                            });
                        },
                    }
                    : {}),
                // spv8.9：跨 replay 根（requiresBoundaryStaging）的组必须走 staging runner，
                // 与 SQLite/non-SQLite 的 normal 组选择无关。SQLite 下 normal 组继续走
                // legacy processUpdates_ACU，但跨根 staging 组必须有可用的 staging runner，
                // 否则 scheduler 会以 staging_runner_unavailable 稳定失败（不再降级到
                // processUpdates —— 那会让写目标早于 full checkpoint 的 bucket 在 AI 消耗
                // token 后才被 persist 层 fail-fast）。
                processStagingGroupedUpdates: (groups, mode, options) => {
                    if (!canExecuteAutoFill('process_staging_updates')) {
                        return Promise.resolve({ success: false, aborted: true, failedGroups: [] });
                    }
                    // 跨 full checkpoint 边界组：共享 staging runner（pre 段 stage_only、
                    // 边界原子汇合、post 段普通持久化）。boundary 元数据来自计划构建层。
                    const upstreamProgress = options?.onProgress;
                    return executeAutoFillStagingGroups_ACU(groups, mode, {
                        ...options,
                        boundary: {
                            fullCheckpointIndices: plan.boundary?.fullCheckpointIndices || [],
                            requiresBoundaryStaging: plan.boundary?.requiresBoundaryStaging || false,
                        },
                        abortController: autoGroupedAbortController,
                        onProgress: event => {
                            upstreamProgress?.(event);
                            onAutoGroupedProgress(event);
                        },
                    });
                },
                refreshData: () => refreshRuntimeDataAndNotifyAfterAutoUpdate_ACU(),
                loadAllChatMessages: () => loadAllChatMessages_ACU(),
                purgeOldLayerData: () => purgeOldLayerData_ACU(),
            },
            { runId: performanceContext?.runId || performanceSpan.id, parentSpanId: performanceSpan.id },
            autoGroupedAbortController,
        );
    } finally {
        autoProgressTask?.end();
        _set_wasStoppedByUser_ACU(false);
        syncManualUpdateButtonAvailability_ACU();
    }

    // UI：根据返回值显示结果
    logAutoFillStage_ACU('execution_result', {
      ...context, success: result.success, groupCount: result.totalGroups,
      failedGroupCount: result.failedGroups, diagnosticCode: result.diagnosticCode,
    });
    if (result.success === false || result.failedGroups > 0) {
      logAutoFillSkip_ACU(result.diagnosticCode === 'staging_runner_unavailable'
        ? 'staging_runner_unavailable' : 'execution_failed', {
        ...context, stage: 'execute', groupCount: result.totalGroups,
        failedGroupCount: result.failedGroups, diagnosticCode: result.diagnosticCode,
      });
    }
    if (!result.aborted && result.failedGroups > 0) {
        const firstError = Array.isArray(result.errors) && result.errors.length > 0 ? result.errors[0] : '';
        showToastr_ACU('warning', firstError
            ? `并发分组更新有 ${result.failedGroups} 组失败：${firstError}`
            : `并发分组更新有 ${result.failedGroups} 组失败，请查看日志。`);
    }
    if (result.autoMergeTriggered && result.autoMergeSuccess) {
        showToastr_ACU('success', '自动合并纪要完成！');
        try { (topLevelWindow_ACU as any).AutoCardUpdaterAPI._notifyTableUpdate(); } catch (_) {}
    }
    if (typeof updateCardUpdateStatusDisplay_ACU === 'function') updateCardUpdateStatusDisplay_ACU();
    } finally {
      performanceSpan.end({
        messageCount: getChatArray_ACU()?.length || 0,
        sheetCount: currentJsonTableData_ACU ? getSortedSheetKeys_ACU(currentJsonTableData_ACU).length : 0,
        sqlite: isSqliteMode(),
      });
    }
  }

  export function collectManualExtraHint_ACU() {
      _set_manualExtraHint_ACU('');
      if (!$manualExtraHintCheckbox_ACU || !$manualExtraHintCheckbox_ACU.length) return;
      if (!$manualExtraHintCheckbox_ACU.is(':checked')) return;

      const userInput = prompt('请输入本次手动填表的额外提示词（可留空）：', '');
      const trimmed = (userInput || '').trim();
      if (!trimmed) return;

      _set_manualExtraHint_ACU(`以下为用户的额外填表要求，请严格遵守：${trimmed}`);
  }

  // [新增] 获取当前选中的手动更新表格列表（无效或为空则回退为全部表）
  export function getSelectedManualSheetKeys_ACU() {
      if (!currentJsonTableData_ACU) return [];
      const availableKeys = getSortedSheetKeys_ACU(currentJsonTableData_ACU);
      const saved = Array.isArray(settings_ACU.manualSelectedTables) ? settings_ACU.manualSelectedTables : [];

      // 未曾手动选择过：默认全选
      if (!settings_ACU.hasManualSelection) return availableKeys;

      const validSaved = saved.filter((k: string) => availableKeys.includes(k));

      // 已手动选择过：严格按保存的交集，不再自动补全新表，防止回退全选
      return validSaved;
  }

