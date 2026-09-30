/**
 * presentation/triggers/settings-ui-sync/settings-ui-trigger.ts
 */
import { DEFAULT_CHAR_CARD_PROMPT_ACU } from '../../../shared/defaults-json.js';
import { AUTO_UPDATE_FLOOR_INCREASE_DELAY_ACU } from '../../../shared/defaults';
import { syncManualUpdateButtonAvailability_ACU } from '../../components/status-display';
import { beginNoticeTask_ACU, type NoticeTaskHandle_ACU } from '../../../shared/notice-hub';
import { updateCardUpdateStatusDisplay_ACU } from '../../components/update-status-display';
import { getCharCardPromptFromUI_ACU, isAutoUpdatingCard_ACU, renderPromptSegments_ACU, wasStoppedByUser_ACU, _set_isAutoUpdatingCard_ACU } from '../../components/plot-editors';
import { showToastr_ACU } from '../../theme/toast';
import { ACU_TOAST_CATEGORY_ACU } from '../../../shared/constants';
import { SillyTavern_API_ACU, TavernHelper_API_ACU, _set_SillyTavern_API_ACU, _set_TavernHelper_API_ACU, _set_jQuery_API_ACU, _set_toastr_API_ACU } from '../../../shared/host-api';
import { jQuery_API_ACU } from '../../dom-utils';
import { getChatArray_ACU, saveChatToHost_ACU } from '../../../service/chat/chat-service';
import { getConnectionManagerProfiles_ACU } from '../../../service/ai/ai-service';
import { getCurrentCharacterFallback_ACU } from '../../../service/host/host-state-service';
import { NEW_MESSAGE_DEBOUNCE_DELAY_ACU, abortAllActiveRequests_ACU, allChatMessages_ACU, coreApisAreReady_ACU, currentJsonTableData_ACU, getCurrentIsolationKey_ACU, lastTotalAiMessages_ACU, settings_ACU , _set_coreApisAreReady_ACU, _set_lastTotalAiMessages_ACU, _set_manualExtraHint_ACU, _set_wasStoppedByUser_ACU} from '../../../service/runtime/state-manager';
import { $popupInstance_ACU, $customApiUrlInput_ACU, $customApiKeyInput_ACU, $customApiModelInput_ACU, $customApiModelSelect_ACU, $maxTokensInput_ACU, $temperatureInput_ACU, $apiStatusDisplay_ACU, $charCardPromptSegmentsContainer_ACU, $autoUpdateThresholdInput_ACU, $autoUpdateTokenThresholdInput_ACU, $autoUpdateFrequencyInput_ACU, $updateBatchSizeInput_ACU, $maxConcurrentGroupsInput_ACU, $skipUpdateFloorsInput_ACU, $retainRecentLayersInput_ACU, $tableMaxRetriesInput_ACU, $manualExtraHintCheckbox_ACU } from '../../state/ui-refs';
import { processUpdates_ACU } from '../update-process';
import { getSortedSheetKeys_ACU } from '../../../service/template/chat-scope';
import { loadAllChatMessages_ACU, updateReadableLorebookEntry_ACU } from '../../../service/worldbook/pipeline';
import { getStorageProvider } from '../../../service/table/table-storage-strategy';
import { SCRIPT_ID_PREFIX_ACU } from '../../../shared/constants';
import { escapeHtml_ACU, renderStopButton_ACU } from '../../../shared/html-helpers';
import { topLevelWindow_ACU } from '../../../shared/env';
import { isSummaryOrOutlineTable_ACU, logDebug_ACU, logError_ACU, logWarn_ACU } from '../../../shared/utils';
import { executeContentOptimization_ACU } from '../../components/optimization-ui';
import { maybeLiftWorldbookSuppression_ACU } from '../../../service/runtime/helpers-remaining';
import { purgeOldLayerData_ACU } from './settings-ui-config';
import { buildAutoUpdatePlan_ACU, checkAutoUpdatePreConditions_ACU, executeAutoUpdatePlan_ACU, handleFloorIncreaseDelay_ACU } from '../../../service/table/update-scheduler';
import { executeAutoFillStagingGroups_ACU, processGroupedRuntimeChunk_ACU, type CardUpdateProgressEvent } from '../../../service/table/update-orchestrator';
import { isSqliteMode } from '../../../service/table/storage-mode';
import { startRuntimePerformanceSpan_ACU } from '../../../shared/runtime-performance';
import { logAutoFillSkip_ACU } from '../../../shared/trigger-diagnostics';

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

let autoUpdateTriggerInFlight_ACU = false;
let pendingAutoUpdateTrigger_ACU = false;
let pendingAutoUpdatePerformanceContext_ACU: { runId?: string; parentSpanId?: string } | undefined;

  export async function triggerAutomaticUpdateIfNeeded_ACU(
    performanceContext?: { runId?: string; parentSpanId?: string },
  ) {
    logDebug_ACU('ACU Auto-Trigger: Starting independent check...');
    if (autoUpdateTriggerInFlight_ACU) {
      pendingAutoUpdateTrigger_ACU = true;
      pendingAutoUpdatePerformanceContext_ACU = performanceContext;
      logDebug_ACU('ACU Auto-Trigger: trigger already in flight. Coalescing a follow-up run.');
      logAutoFillSkip_ACU('auto_update_coalesced', {
        inFlight: true,
      });
      return;
    }
    autoUpdateTriggerInFlight_ACU = true;
    // 新一轮自动填表开跑前清掉上一轮「终止」残留，避免 isStopped() 立刻把新任务掐死。
    _set_wasStoppedByUser_ACU(false);
    const performanceSpan = startRuntimePerformanceSpan_ACU('auto-update-trigger', {
      ...performanceContext,
      settings: settings_ACU,
    });

    try {
    // [重构] 调用 service 层前置检查
    const preCheck = checkAutoUpdatePreConditions_ACU(
        settings_ACU,
        coreApisAreReady_ACU,
        isAutoUpdatingCard_ACU,
        currentJsonTableData_ACU,
        allChatMessages_ACU.length
    );
    if (!preCheck.canProceed) {
      logDebug_ACU(`ACU Auto-Trigger: ${preCheck.reason} Skipping.`);
      logAutoFillSkip_ACU('preconditions_failed', {
        aiFloorCount: allChatMessages_ACU.filter((message: any) => !message.is_user).length,
        inFlight: isAutoUpdatingCard_ACU,
        preconditionReason: preCheck.code,
      });
      return;
    }

    let liveChat = getChatArray_ACU();
    if (!liveChat || liveChat.length === 0) {
      logAutoFillSkip_ACU('empty_chat');
      return;
    }

    let totalAiMessages = liveChat.filter(m => !m.is_user).length;

    // [重构] 调用 service 层楼层增加延迟逻辑
    const delayResult = await handleFloorIncreaseDelay_ACU(
        totalAiMessages,
        lastTotalAiMessages_ACU,
        AUTO_UPDATE_FLOOR_INCREASE_DELAY_ACU,
        getChatArray_ACU,
        _set_lastTotalAiMessages_ACU
    );
    if (delayResult === null) {
      logAutoFillSkip_ACU('empty_chat');
      return;
    }
    if (delayResult) {
        liveChat = delayResult.liveChat;
        totalAiMessages = delayResult.totalAiMessages;
    }

    // [重构] 调用 service 层构建更新计划
    const triggerIsolationKey = getCurrentIsolationKey_ACU();
    const plan = buildAutoUpdatePlan_ACU(
      liveChat,
      currentJsonTableData_ACU,
      settings_ACU,
      triggerIsolationKey,
      { runId: performanceContext?.runId || performanceSpan.id, parentSpanId: performanceSpan.id },
    );
    if (plan.tablesToUpdate.length === 0) {
      logAutoFillSkip_ACU('no_tables_due', { aiFloorCount: totalAiMessages });
      return;
    }

    // UI：显示开始 toast
    const totalGroups = Object.keys(plan.updateGroups).length;
    const maxConcurrentGroups = Math.max(1, settings_ACU.maxConcurrentGroups || 1);
    const useGroupedAutoUpdates = !isSqliteMode();
    if (totalGroups > maxConcurrentGroups) {
        showToastr_ACU('info', `检测到 ${plan.tablesToUpdate.length} 个表格需要更新，将分批并发处理 ${totalGroups} 组（每批最多 ${maxConcurrentGroups} 组）。`);
    } else {
        showToastr_ACU('info', `检测到 ${plan.tablesToUpdate.length} 个表格需要更新，将并发处理 ${totalGroups} 组。`);
    }

    const autoGroupedAbortController = new AbortController();
    // 进度任务不受静默模式影响：静默只决定气泡是否显示，任务登记照常驱动桌宠。
    let autoProgressTask: NoticeTaskHandle_ACU | null = null;
    if (useGroupedAutoUpdates) {
        autoProgressTask = beginNoticeTask_ACU('自动填表', {
            detail: '自动填表正在准备，请稍候...',
            action: {
                label: '终止',
                variant: 'danger',
                run: () => {
                    syncManualUpdateButtonAvailability_ACU();
                    _set_wasStoppedByUser_ACU(true);
                    autoGroupedAbortController.abort();
                    abortAllActiveRequests_ACU();
                    _set_isAutoUpdatingCard_ACU(false);
                    autoProgressTask?.update('填表任务已终止，正在停止当前任务与后续批次...', { action: null });
                    showToastr_ACU('warning', '填表任务已由用户终止，当前任务与后续批次将立即停止。');
                },
            },
        });
    }

    // 调用 service 层执行更新计划，传入纯业务操作委托（不含 UI 操作）
    let result: Awaited<ReturnType<typeof executeAutoUpdatePlan_ACU>>;
    try {
        result = await executeAutoUpdatePlan_ACU(
            plan,
            settings_ACU,
            _set_isAutoUpdatingCard_ACU,
            {
                processUpdates: (indices, mode, options) => processUpdates_ACU(indices, mode, options),
                ...(useGroupedAutoUpdates
                    ? {
                        processGroupedUpdates: (groups, mode, options) => {
                            const upstreamProgress = options?.onProgress;
                            return processGroupedRuntimeChunk_ACU(groups, mode, {
                                ...options,
                                abortController: autoGroupedAbortController,
                                onProgress: event => {
                                    upstreamProgress?.(event);
                                    handleAutoGroupedProgressEvent_ACU(event, autoProgressTask);
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
                            handleAutoGroupedProgressEvent_ACU(event, autoProgressTask);
                        },
                    });
                },
                refreshData: () => refreshRuntimeDataAndNotifyAfterAutoUpdate_ACU(),
                loadAllChatMessages: () => loadAllChatMessages_ACU(),
                purgeOldLayerData: () => purgeOldLayerData_ACU(),
            },
            { runId: performanceContext?.runId || performanceSpan.id, parentSpanId: performanceSpan.id },
        );
    } finally {
        autoProgressTask?.end();
    }

    // UI：根据返回值显示结果
    if (result.failedGroups > 0) {
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
      autoUpdateTriggerInFlight_ACU = false;
      if (!pendingAutoUpdateTrigger_ACU || wasStoppedByUser_ACU) {
        pendingAutoUpdateTrigger_ACU = false;
        pendingAutoUpdatePerformanceContext_ACU = undefined;
        return;
      }
      const followUpContext = pendingAutoUpdatePerformanceContext_ACU;
      pendingAutoUpdateTrigger_ACU = false;
      pendingAutoUpdatePerformanceContext_ACU = undefined;
      queueMicrotask(() => { void triggerAutomaticUpdateIfNeeded_ACU(followUpContext); });
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

