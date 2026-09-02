// init.ts — 初始化编排（presentation 层：负责事件绑定、UI 初始化、模块串联）
// 从 05_core_tail.js 迁入

import { cancelPendingChatMutationRefresh_ACU, scheduleChatMutationRefresh_ACU } from './chat-mutation-scheduler';
import { showToastr_ACU } from '../theme/toast';
import { attemptToLoadCoreApis_ACU } from '../triggers/settings-ui-sync/settings-ui-connect';
import { formatHostCapabilities_ACU, getLastHostCapabilities_ACU } from '../../shared/host-compat/tavern-helper-compat';
import { ensureInitialSeedCheckpoint_ACU, handleChatCompletionReady_ACU, loadPresetAndCleanCharacterData_ACU } from '../../service/runtime/helpers-remaining';
import { SillyTavern_API_ACU } from '../../shared/host-api';
import { consumeGenerationContextForEnded_ACU, currentChatFileIdentifier_ACU, discardLatestGenerationContext_ACU, generationGate_ACU, getCurrentIsolationKey_ACU, markUserSendIntent_ACU, isProcessing_Plot_ACU, isQuietLikeGeneration_ACU, isRecentUserSendIntent_ACU, recordGenerationContext_ACU, recordLastUserSend_ACU, settings_ACU, shouldProcessAutoTableUpdateForGenerationEnded_ACU, shouldProcessPlotForGeneration_ACU, shouldProcessSummaryVectorIndexForGeneration_ACU, _set_allChatMessages_ACU, _set_currentChatFileIdentifier_ACU, _set_currentJsonTableData_ACU, _set_independentTableStates_ACU, _set_isProcessing_Plot_ACU, _set_lastTotalAiMessages_ACU, _set_wasStoppedByUser_ACU} from '../../service/runtime/state-manager';
import { applyTemplateScopeForCurrentChat_ACU, loadSettings_ACU } from '../../service/settings/settings-service';
import { resetScriptStateForNewChat_ACU } from '../../service/worldbook/injection-engine';
import { resetPlotAgentWorldbookSessionSnapshot_ACU } from '../../service/agent/agent-worldbook-takeover';
import { captureCheckpointVaultForCurrentChat_ACU, installCheckpointDeleteGuard_ACU } from '../../service/chat/checkpoint-delete-guard';
import { auditDormantDataIntegrity_ACU } from '../../service/template/dormant-data-service';
import { reloadStorageProvider, disposeStorageProvider, getRuntimeLifecycleEpoch_ACU, hydrateStorageProviderFromSnapshot_ACU } from '../../service/table/table-storage-strategy';
import { createCanonicalSnapshotEnvelope_ACU } from '../../service/table/canonical-snapshot-envelope';
import { isSqliteMode } from '../../service/table/storage-mode';
import { flushRuntimeOnlyPendingChanges_ACU } from '../../service/table/runtime-only-pending-flush';
import { ensureNoActiveProvisionalBridgeForCurrentScope_ACU } from '../../service/table/manual-catch-up-provisional-bridge';
import { loadAllChatMessages_ACU } from '../../service/worldbook/pipeline';
import { refreshMergedDataAndNotifyWithUI_ACU } from '../components/pipeline-ui-helpers';
import { cleanChatName_ACU, logDebug_ACU, logError_ACU, logWarn_ACU } from '../../shared/utils';
import { shouldSkipPlotIntercept_ACU } from '../../service/plot/plot-logic';
import { orchestrateTavernHelperHook_ACU, orchestrateAfterCommandsStrategy1_ACU, orchestrateAfterCommandsStrategy2_ACU } from '../../service/plot/plot-orchestrator';
import { getSendTextareaValue_ACU, setSendTextareaValue_ACU } from '../../shared/host-input';
import { handleNewMessageDebounced_ACU } from '../triggers/settings-ui-sync/settings-ui-connect';
import { runOptimizationLogicWithUI_ACU } from '../components/plot-planning-ui';
import { processSummaryVectorIndexBeforeGenerationWithUI_ACU, rebuildCurrentSummaryVectorIndexWithUI_ACU, shouldRebuildSummaryVectorIndexWithUI_ACU } from '../components/summary-vector-index-ui';
import { preloadSummaryVectorIndexCacheForCurrentChat_ACU } from '../../service/vector/summary-vector-index-cache-service';
import { restoreSummaryVectorIndexFlushQueueForCurrentChat_ACU } from '../../service/vector/summary-vector-index-flush-queue';
import {
  cleanupSummaryVectorIndexForDeletedChat_ACU,
  sweepOrphanSummaryVectorIndexFiles_ACU,
} from '../../service/vector/summary-vector-index-chat-deletion-gc';
import { topLevelWindow_ACU } from '../../shared/env';
import { getUiSurface_ACU, showUiSurfaceToast_ACU } from '../../shared/ui-surface-registry';
import { logAutoFillSkip_ACU } from '../../shared/trigger-diagnostics';
import { bindContinuationInternalAiGenerationStarted_ACU, consumeContinuationInternalAiGenerationEnded_ACU } from '../../service/continuation/internal-ai-events';
import { getContinuationHostGenerationBridge_ACU } from '../../service/continuation/host-generation-bridge-registry';
import { getContinuationRuntime_ACU } from '../../service/continuation/continuation-runtime';

// [从 state-manager.ts 搬入 presentation 层] 安装发送意图捕捉钩子（DOM 事件绑定）
async function ensureInitialSeedCheckpointBeforeGeneration_ACU(reason: string, { allowPendingFirstUserMessage = true } = {}) {
  try {
    // 开局脚本可能只把行写进了运行时（skipChatSave/isImportMode）。seed checkpoint 建立后会
    // 从聊天重载运行时，这些行会被直接丢弃；先写回聊天，聊天有数据时 seed 自然跳过。
    try {
      await flushRuntimeOnlyPendingChanges_ACU(reason);
    } catch (flushError) {
      logWarn_ACU(`[InitialSeed] ${reason} 写回运行时未落盘变更失败，继续初始化 checkpoint:`, flushError);
    }
    const result = await ensureInitialSeedCheckpoint_ACU({ reason, allowPendingFirstUserMessage });
    if ((result as any)?.success && isSqliteMode()) {
      await reloadStorageProvider();
    }
    return result;
  } catch (error) {
    logWarn_ACU(`[InitialSeed] ${reason} 初始化 checkpoint 失败，继续生成流程:`, error);
    return false;
  }
}

function isValidChatFileName_ACU(chatFileName: unknown): boolean {
  return typeof chatFileName === 'string' && chatFileName.trim() !== '' && chatFileName.trim() !== 'null';
}

function hasActiveChatMessages_ACU(): boolean {
  return Array.isArray((SillyTavern_API_ACU as any)?.chat) && ((SillyTavern_API_ACU as any).chat as any[]).length > 0;
}

function notifyRuntimeTableCleared_ACU(): void {
  try {
    (topLevelWindow_ACU as any).AutoCardUpdaterAPI?._notifyTableUpdate?.();
  } catch (_) {}
}

function clearDerivedRuntimeState_ACU(): void {
  disposeStorageProvider();
  _set_currentJsonTableData_ACU(null);
  _set_independentTableStates_ACU({});
  _set_allChatMessages_ACU([]);
  _set_lastTotalAiMessages_ACU(0);
}

function clearRuntimeForNoActiveChat_ACU(chatFileName: unknown): void {
  resetPlotAgentWorldbookSessionSnapshot_ACU();
  clearDerivedRuntimeState_ACU();
  _set_currentChatFileIdentifier_ACU('');
  generationGate_ACU.lastUserMessageId = null;
  generationGate_ACU.lastUserMessageText = '';
  generationGate_ACU.lastUserMessageAt = 0;
  generationGate_ACU.lastUserSendIntentAt = 0;
  generationGate_ACU.lastGeneration = null;
  generationGate_ACU.generationSeq = 0;
  generationGate_ACU.activeGenerations = [];
  notifyRuntimeTableCleared_ACU();
  logDebug_ACU(`ACU: No active chat after CHAT_CHANGED (${String(chatFileName)}), runtime table state cleared.`);
}

/**
 * S3-3 休眠完整性自检：聊天加载完成后校验每个 hidden 表的恢复来源可达，
 * 发现孤儿即 logWarn + warning toast（带跳转数据管理入口）。
 * 纯只读且全降级——审计自身故障绝不影响加载主链路；
 * 生命周期派生失败只记日志（加载失败已有 C5 error toast，休眠面板另有 listError），不重复弹报。
 */
function runDormantIntegrityAuditQuietly_ACU(stage: string): void {
  try {
    const audit = auditDormantDataIntegrity_ACU();
    if (!audit.ok) {
      logWarn_ACU(`[休眠自检] ${stage} 审计不可用：${audit.error || '未知错误'}`);
      return;
    }
    if (audit.issues.length === 0) return;
    for (const issue of audit.issues) {
      logWarn_ACU(`[休眠自检] ${stage} 发现问题（${issue.kind}）：${issue.message}`);
    }
    showUiSurfaceToast_ACU({
      kind: 'warning',
      text: `检测到 ${audit.issues.length} 项休眠数据完整性问题（涉及恢复来源缺失或损坏），相关表暂时无法唤醒。详情见数据管理页的「休眠数据」面板。`,
      action: {
        label: '打开数据管理',
        onClick: async () => { await getUiSurface_ACU()?.openSettings?.(); },
      },
    });
  } catch (e: any) {
    logWarn_ACU(`[休眠自检] ${stage} 审计执行失败: ${e?.message}`);
  }
}

function installSendIntentCaptureHooks_ACU() {
  try {
    const parentDoc = (window.parent || window).document;
    const doc = parentDoc || document;

    if (!(window as any).__ACU_sendIntentHooksInstalled) {
      (window as any).__ACU_sendIntentHooksInstalled = { send: false, enter: false };
    }

    const sendBtn = doc.getElementById('send_but');
    if (sendBtn && !(window as any).__ACU_sendIntentHooksInstalled.send) {
      sendBtn.addEventListener('click', () => markUserSendIntent_ACU(), true);
      sendBtn.addEventListener('pointerup', () => markUserSendIntent_ACU(), true);
      sendBtn.addEventListener('touchend', () => markUserSendIntent_ACU(), true);
      (window as any).__ACU_sendIntentHooksInstalled.send = true;
    }

    const ta = doc.getElementById('send_textarea');
    if (ta && !(window as any).__ACU_sendIntentHooksInstalled.enter) {
      ta.addEventListener('keydown', (e: Event) => {
        try {
          const key = (e as KeyboardEvent).key || (e as KeyboardEvent).code;
          if ((key === 'Enter' || key === 'NumpadEnter') && !(e as KeyboardEvent).shiftKey) {
            markUserSendIntent_ACU();
          }
        } catch (err) {}
      }, true);
      (window as any).__ACU_sendIntentHooksInstalled.enter = true;
    }

    if ((!sendBtn || !ta) && !(window as any).__ACU_sendIntentHooksRetryScheduled) {
      (window as any).__ACU_sendIntentHooksRetryScheduled = true;
      setTimeout(() => {
        (window as any).__ACU_sendIntentHooksRetryScheduled = false;
        installSendIntentCaptureHooks_ACU();
      }, 1200);
    }
  } catch (e) {
    // ignore
  }
}

export   function mainInitialize_ACU() {

    console.log('ACU_INIT_DEBUG: mainInitialize_ACU called.');
    if (attemptToLoadCoreApis_ACU()) {
      logDebug_ACU('AutoCardUpdater Initialization successful! Core APIs loaded.');
      showToastr_ACU('success', '数据库自动更新脚本已加载！', '脚本启动');

      loadSettings_ACU();
      // S0-4：注册插件保存后的 checkpoint 保管库同步（删楼恢复的影子基线）。
      installCheckpointDeleteGuard_ACU();
      // Register the bridge before generation events are subscribed. Runtime
      // migration remains page-owned so no chat persistence is touched at startup.
      getContinuationRuntime_ACU();
      if (
        SillyTavern_API_ACU &&
        SillyTavern_API_ACU.eventSource &&
        typeof SillyTavern_API_ACU.eventSource.on === 'function' &&
        SillyTavern_API_ACU.eventTypes
      ) {
        // [调试] 检查可用的事件类型
        logDebug_ACU('[提示词模板] 可用的事件类型:', Object.keys(SillyTavern_API_ACU.eventTypes));
        // [提示词模板] 监听 CHAT_COMPLETION_SETTINGS_READY 事件，使用 makeLast 确保在 st-prompt-template 之后执行
        if (SillyTavern_API_ACU.eventTypes.CHAT_COMPLETION_SETTINGS_READY) {
          // 检查是否有 makeLast 方法
          if (typeof SillyTavern_API_ACU.eventSource.makeLast === 'function') {
            SillyTavern_API_ACU.eventSource.makeLast(
              SillyTavern_API_ACU.eventTypes.CHAT_COMPLETION_SETTINGS_READY,
              handleChatCompletionReady_ACU
            );
            logDebug_ACU('[提示词模板] 已注册 CHAT_COMPLETION_SETTINGS_READY 事件监听（makeLast）');
          } else {
            // 如果没有 makeLast，使用普通 on
            SillyTavern_API_ACU.eventSource.on(
              SillyTavern_API_ACU.eventTypes.CHAT_COMPLETION_SETTINGS_READY,
              handleChatCompletionReady_ACU
            );
            logDebug_ACU('[提示词模板] 已注册 CHAT_COMPLETION_SETTINGS_READY 事件监听（on）');
          }
        }
        // P7：聊天被删除时清理其向量外置存档 / IDB 缓存 / flush 任务。
        // 延迟 5s 执行：等宿主完成删除后的状态收敛（characters[].chats、当前聊天切换）再枚举校验。
        const handleChatDeletedForVectorCleanup_ACU = (deletedChatName: unknown): void => {
          const name = String(deletedChatName || '').trim();
          if (!name) return;
          setTimeout(() => {
            void cleanupSummaryVectorIndexForDeletedChat_ACU(name).catch((error: any) => {
              logWarn_ACU('[交火向量索引] 聊天删除清理失败（将由孤儿清扫兜底）:', error?.message || error);
            });
          }, 5000);
        };
        if (SillyTavern_API_ACU.eventTypes.CHAT_DELETED) {
          SillyTavern_API_ACU.eventSource.on(SillyTavern_API_ACU.eventTypes.CHAT_DELETED, handleChatDeletedForVectorCleanup_ACU);
          logDebug_ACU('[交火向量索引] 已注册 CHAT_DELETED 向量清理监听');
        }
        // GROUP_CHAT_DELETED 在本地 eventTypes 类型声明快照中缺失（运行时存在），用索引访问。
        const groupChatDeletedEventType = (SillyTavern_API_ACU.eventTypes as Record<string, string>)['GROUP_CHAT_DELETED'];
        if (groupChatDeletedEventType) {
          SillyTavern_API_ACU.eventSource.on(groupChatDeletedEventType, handleChatDeletedForVectorCleanup_ACU);
          logDebug_ACU('[交火向量索引] 已注册 GROUP_CHAT_DELETED 向量清理监听');
        }
        // P7：启动 60s 后执行孤儿清扫（内部 localStorage 节流 24h），
        // 兜住插件未加载期间被删除的聊天遗留的向量存档。
        setTimeout(() => {
          void sweepOrphanSummaryVectorIndexFiles_ACU().catch((error: any) => {
            logWarn_ACU('[交火向量索引] 孤儿清扫失败:', error?.message || error);
          });
        }, 60_000);

        SillyTavern_API_ACU.eventSource.on(SillyTavern_API_ACU.eventTypes.CHAT_CHANGED, async (chatFileName: string) => {
          logDebug_ACU(`ACU CHAT_CHANGED event: ${chatFileName}`);

          const hasValidChatFileName_ACU = isValidChatFileName_ACU(chatFileName);
          if (!hasValidChatFileName_ACU && !hasActiveChatMessages_ACU()) {
            clearRuntimeForNoActiveChat_ACU(chatFileName);
            return;
          }

          // [修复] 换卡/换聊天时立即丢弃所有派生缓存。
          // 后续延迟阶段只从当前聊天持久化 metadata / 消息日志重建，避免旧表和旧模板在窗口期继续显示。
          if (hasValidChatFileName_ACU) {
            clearDerivedRuntimeState_ACU();
            notifyRuntimeTableCleared_ACU();
            cancelPendingChatMutationRefresh_ACU();
            if (isSqliteMode()) logDebug_ACU('[SQLite] CHAT_CHANGED: 立即销毁旧数据库实例');
          }

          await resetScriptStateForNewChat_ACU(chatFileName, { reason: 'chat_changed' });

          // [触发门控] generationGate 重置已搬到 service 层的 resetScriptStateForNewChat_ACU 中

          // [触发门控] 每次切换聊天都尝试安装一次 capture 钩子（防止 DOM 重新渲染导致丢失）          installSendIntentCaptureHooks_ACU();

          await loadPresetAndCleanCharacterData_ACU();

          // [剧情推进] TavernHelper钩子：拦截直接的JS调用
          if (!(window as any).original_TavernHelper_generate_ACU) {
            if ((window as any).TavernHelper && typeof (window as any).TavernHelper.generate === 'function') {
              (window as any).original_TavernHelper_generate_ACU = (window as any).TavernHelper.generate;
              (window as any).TavernHelper.generate = async function (...args: any[]) {
                const options = args[0] || {};

                // quiet/automatic_trigger 直接透传
                if (isQuietLikeGeneration_ACU('tavernhelper', { quiet_prompt: options.quiet_prompt }) || options.automatic_trigger) {
                  return (window as any).original_TavernHelper_generate_ACU.apply(this, args);
                }

                const userInputForInitialSeed = String(options.user_input || options.prompt || getSendTextareaValue_ACU() || '').trim();
                if (userInputForInitialSeed) {
                  await ensureInitialSeedCheckpointBeforeGeneration_ACU('tavernhelper_generate_before_ai', { allowPendingFirstUserMessage: true });
                }

                if (shouldProcessSummaryVectorIndexForGeneration_ACU('tavernhelper', { quiet_prompt: options.quiet_prompt, automatic_trigger: options.automatic_trigger }, false)) {
                  const userInput = String(options.user_input || options.prompt || getSendTextareaValue_ACU() || '').trim();
                  try {
                    const summaryVectorResult = await processSummaryVectorIndexBeforeGenerationWithUI_ACU({ userInput, source: 'tavernhelper' });
                    logDebug_ACU(`[交火模式纪要索引] TavernHelper.generate 发送前处理完成：success=${summaryVectorResult.success}, skipped=${summaryVectorResult.skipped === true}, reason=${summaryVectorResult.reason || 'none'}, keywords=${summaryVectorResult.keywordCount ?? 0}, injected=${summaryVectorResult.injectedCount ?? 0}`);
                  } catch (error) {
                    // T5：发送前注入失败不得中断宿主生成（与 GENERATION_AFTER_COMMANDS 的降级一致）。
                    logWarn_ACU('[交火模式纪要索引] TavernHelper.generate 发送前注入失败，继续原始生成:', error);
                  }
                }

                // [重构] 调用 service 层编排函数，传入 UI 规划回调
                const result = await orchestrateTavernHelperHook_ACU(options, runOptimizationLogicWithUI_ACU);

                switch (result.action) {
                  case 'planned': {
                    // UI 操作：写回 options
                    if (result.writeBack) {
                      if (result.writeBack.target === 'injects') {
                        options.injects[0].content = result.writeBack.value;
                      } else if (result.writeBack.target === 'prompt') {
                        options.prompt = result.writeBack.value;
                      } else {
                        options.user_input = result.writeBack.value;
                      }
                    }
                    options._qrf_processed_by_hook = true;
                    break;
                  }
                  // 'passthrough', 'skipped', 'aborted' — 不做额外操作，直接透传
                }

                return await (window as any).original_TavernHelper_generate_ACU.apply(this, args);
              };
              logDebug_ACU('[剧情推进] TavernHelper.generate hook registered.');
            }
          }
          // [新增] 切换角色卡（聊天）时，强制从新聊天记录的本地数据读取最新的表格并刷新UI
          logDebug_ACU('ACU: Chat changed, forcing reload of table data from new chat history.');
          const scheduledChatIdentifier_ACU = cleanChatName_ACU(chatFileName);

          // 稍作延迟以确保SillyTavern已完全加载新聊天的消息列表
          setTimeout(async () => {
           // C5 加载失败可见化：三层兼容读取全部失败的真损坏数据才会走到这里的
           // catch——不再静默空表，弹可操作的错误提示。
           try {
             if (scheduledChatIdentifier_ACU && currentChatFileIdentifier_ACU !== scheduledChatIdentifier_ACU) {
                 logDebug_ACU(`ACU: Skip delayed chat refresh because active chat already changed to "${currentChatFileIdentifier_ACU || '未知'}".`);
                 return;
             }

             if (!hasActiveChatMessages_ACU()) {
                 clearRuntimeForNoActiveChat_ACU(chatFileName);
                 return;
             }

             // 先重新读取当前聊天持久化消息，再应用 chat_metadata 中的聊天模板快照。
             // 此处是“持久化 → 派生缓存”的唯一重建入口，不能依赖切换前遗留的 TABLE_TEMPLATE/currentJsonTableData。
             await loadAllChatMessages_ACU();
             applyTemplateScopeForCurrentChat_ACU();

            // 阶段 D：合并刷新（一轮 V2 replay，产出 canonical）与 provider hydrate 收敛。
            // 先执行 merged refresh 拿到最终 canonical 数据，SQLite 模式下用 envelope
            // hydrate provider（零 replay）；refresh 失败/degraded/身份漂移时回退冷
            // reloadStorageProvider（保持既有两轮链路的完整语义与 fallback 状态机）。
            // UI 通知由 refreshMergedDataAndNotifyWithUI_ACU 内部完成。
            const refreshResult = await refreshMergedDataAndNotifyWithUI_ACU();
            if (isSqliteMode()) {
                const envelope = refreshResult
                    && !refreshResult.degraded
                    && refreshResult.mergedData
                    ? createCanonicalSnapshotEnvelope_ACU({
                        data: refreshResult.mergedData,
                        chatIdentity: String(currentChatFileIdentifier_ACU || ''),
                        isolationKey: getCurrentIsolationKey_ACU(),
                        storageMode: 'sqlite',
                        lifecycleEpoch: getRuntimeLifecycleEpoch_ACU(),
                        source: 'merged_refresh',
                    })
                    : null;
                if (envelope) {
                    logDebug_ACU('[SQLite] CHAT_CHANGED: 用 canonical snapshot hydrate 内存数据库...');
                    const hydrated = await hydrateStorageProviderFromSnapshot_ACU(envelope);
                    if (hydrated.ok) {
                        logDebug_ACU('[SQLite] CHAT_CHANGED: snapshot hydrate 完成');
                    } else if (hydrated.failureCode === 'stale_load_discarded') {
                        logDebug_ACU(`[SQLite] CHAT_CHANGED: snapshot 身份漂移（${hydrated.failureCode}），回退冷 reload。`);
                        try {
                            await reloadStorageProvider();
                        } catch (e: any) {
                            logError_ACU(`[SQLite] CHAT_CHANGED: 冷 reload 失败: ${e?.message}`);
                        }
                    } else {
                        // provider_fallback（SQLite hydrate 失败已自动回退 native）或
                        // provider_load_failed：保持 hydrate 返回的 fallback 状态机。
                        logError_ACU(`[SQLite] CHAT_CHANGED: snapshot hydrate 失败: ${hydrated.failureCode || 'unknown'}${hydrated.error ? `: ${hydrated.error}` : ''}`);
                    }
                } else {
                    logDebug_ACU('[SQLite] CHAT_CHANGED: merged refresh 未产出可用 canonical（degraded/空数据），回退冷 reload。');
                    try {
                        await reloadStorageProvider();
                    } catch (e: any) {
                        logError_ACU(`[SQLite] CHAT_CHANGED: 数据库重建失败: ${e?.message}`);
                    }
                }
            }

            // [交火向量索引] 聊天数据刷新完成后，预热当前聊天对应的外置分片缓存。
            // 注意：必须放在 refreshMergedDataAndNotifyWithUI_ACU 之后，否则可能读取到旧聊天的 manifest。
            const vectorCacheResult = await preloadSummaryVectorIndexCacheForCurrentChat_ACU();
            logDebug_ACU(`[交火向量索引] CHAT_CHANGED 缓存预热结果：success=${vectorCacheResult.success}, skipped=${vectorCacheResult.skipped === true}, reason=${vectorCacheResult.reason || 'none'}, chunks=${vectorCacheResult.chunkCount}, indexId=${vectorCacheResult.indexId || 'none'}`);
            if (shouldRebuildSummaryVectorIndexWithUI_ACU(vectorCacheResult.reason)) {
                try {
                    await rebuildCurrentSummaryVectorIndexWithUI_ACU();
                } catch (rebuildError) {
                    logWarn_ACU('[交火向量索引] 失效索引已删除，但普通重建路径执行失败:', rebuildError);
                }
            }
            const shouldRestoreFlushQueue = !String(vectorCacheResult.reason || '').startsWith('external_files_missing_state_clear');
            if (!shouldRestoreFlushQueue) {
                logWarn_ACU(
                    `[交火向量索引] CHAT_CHANGED 跳过 flush 队列恢复：missing-file 状态清理未完成或已进入重建恢复，reason=${vectorCacheResult.reason || 'unknown'}`,
                );
            }
            if (shouldRestoreFlushQueue) try {
                const restoredFlushCount = await restoreSummaryVectorIndexFlushQueueForCurrentChat_ACU();
                if (restoredFlushCount > 0) {
                    logDebug_ACU(`[交火向量索引] CHAT_CHANGED 已恢复防抖归档队列：count=${restoredFlushCount}`);
                }
            } catch (restoreFlushError) {
                logWarn_ACU('[交火向量索引] CHAT_CHANGED 恢复防抖归档队列失败:', restoreFlushError);
            }
            // S0-4：聊天切换加载完成后捕获 checkpoint 保管库（删楼恢复的影子基线）。
            try {
                captureCheckpointVaultForCurrentChat_ACU();
            } catch (vaultError: any) {
                logWarn_ACU(`[删楼守卫] CHAT_CHANGED 保管库捕获失败: ${vaultError?.message}`);
            }

            // S3-3：加载完成后做休眠完整性自检（只读，发现孤儿即警告）。
            runDormantIntegrityAuditQuietly_ACU('CHAT_CHANGED');

            logDebug_ACU('ACU: Chat data reload and UI refresh triggered after chat change (Delayed).');
           } catch (chatChangedError) {
             const message = chatChangedError instanceof Error ? chatChangedError.message : String(chatChangedError);
             logError_ACU('ACU: CHAT_CHANGED 延迟刷新失败（已尝试全部兼容读取层）:', chatChangedError);
             showUiSurfaceToast_ACU({
               kind: 'error',
               text: `表格数据加载失败：${message}`,
               action: {
                 label: '打开数据管理',
                 onClick: async () => { await getUiSurface_ACU()?.openSettings?.(); },
               },
             });
           }
         }, 1200); // 增加延迟到1200ms，给SillyTavern更多的DOM渲染和上下文切换时间
        });

        // [触发门控] 记录“用户真实发送”的消息ID，用于剧情推进触发判定
        if (SillyTavern_API_ACU.eventTypes.MESSAGE_SENT) {
          SillyTavern_API_ACU.eventSource.on(SillyTavern_API_ACU.eventTypes.MESSAGE_SENT, (messageId: any) => {
            try {
              recordLastUserSend_ACU(messageId);
            } catch (e) {}
          });
        }

        // [触发门控] 捕捉“用户发送意图”：使用 capture 钩子，确保先于酒馆自身发送逻辑执行
        installSendIntentCaptureHooks_ACU();

        // [触发门控] 记录最近一次生成的上下文（用于过滤 quiet/后台生成导致的误触发）
        if (SillyTavern_API_ACU.eventTypes.GENERATION_STARTED) {
          SillyTavern_API_ACU.eventSource.on(SillyTavern_API_ACU.eventTypes.GENERATION_STARTED, (type: any, params: any, dryRun: any) => {
            try {
              // 终止只作用于当次填表。新一轮宿主生成必须清掉残留，否则评估闸永久 user_aborted。
              _set_wasStoppedByUser_ACU(false);
              const context = recordGenerationContext_ACU(type, params, dryRun);
              bindContinuationInternalAiGenerationStarted_ACU(context.seq);
              // 宿主的 GENERATION_STARTED 通常在发送点击返回后的微任务里才送达，同步配对必然错过；
              // 对非 quiet/非 dryRun/非自动触发的生成开放宽松认领（spv8.9.2 状态法），桥内部只在
              // 存在未绑定序列号的等待轮时才会认领。
              const quietLike = isQuietLikeGeneration_ACU(type, params);
              getContinuationHostGenerationBridge_ACU()?.onGenerationStarted(context.seq, {
                allowOrdinaryLooseClaim: !dryRun && !quietLike && !params?.automatic_trigger,
                automaticTrigger: Boolean(params?.automatic_trigger),
                quietLike,
                dryRun: Boolean(dryRun),
              });
            } catch (e) {}
          });
        }
        if (SillyTavern_API_ACU.eventTypes.GENERATION_STOPPED) {
          SillyTavern_API_ACU.eventSource.on(SillyTavern_API_ACU.eventTypes.GENERATION_STOPPED, () => {
            try {
              const discarded = discardLatestGenerationContext_ACU();
              // 被中止的生成不会再有 GENERATION_ENDED；通知桥把等待中的续写轮转为可重试，避免卡死。
              void getContinuationHostGenerationBridge_ACU()?.onGenerationStopped(discarded?.seq);
            } catch (e) {}
          });
        }
        if (SillyTavern_API_ACU.eventTypes.GENERATION_ENDED) {
            const onGenerationEnded = (message_id: any) => {
                logDebug_ACU(`ACU GENERATION_ENDED event for message_id: ${message_id}`);
                const generationContext = consumeGenerationContextForEnded_ACU();
                const internalRequest = consumeContinuationInternalAiGenerationEnded_ACU(generationContext?.seq);
                if (internalRequest) {
                  logDebug_ACU(`ACU 忽略 continuation 内部 ${internalRequest.source} GENERATION_ENDED: ${internalRequest.requestId}`);
                  return;
                }
                const continuationBridge = getContinuationHostGenerationBridge_ACU();
                // 宽松认领只对"会产生正文楼层"的生成开放：quiet/dryRun/自动触发生成不许认领，
                // 否则会误杀等待中的续写轮。判定复用自动填表的生成门控。
                const quietLike = generationContext ? isQuietLikeGeneration_ACU(generationContext.type, generationContext.params) : false;
                const automaticTrigger = Boolean(generationContext?.params?.automatic_trigger);
                const continuationEventContext = {
                  allowOrdinaryLooseClaim: !generationContext || (!generationContext.dryRun && !quietLike && !automaticTrigger),
                  automaticTrigger,
                  quietLike,
                  dryRun: Boolean(generationContext?.dryRun),
                };
                if (continuationBridge?.claimsGenerationEnded(generationContext?.seq, continuationEventContext)) {
                  // 桥只负责续写轮次的归属确认/循环标签校验/自动续下一轮，不再短路后续管线：
                  // 填表与正文优化由下方常规意图派发按各自的判定独立触发（解耦，见 spv 讨论）。
                  // 桥因标签缺失删楼重试时，常规管线的楼层解析（唯一候选 + 有界物化等待）与
                  // evaluateNewMessageAction 的 resolved_message_not_ai 防御会自然跳过该楼。
                  void continuationBridge.onGenerationEnded(message_id, generationContext?.seq, continuationEventContext);
                }
                // [触发修复] 原子捕获完整意图快照：事件参数只作为锚点，不承诺是 AI 数组下标。
                // makeFirst 可能早于宿主把本轮 AI 回复追加进 chat，因此必须记录捕获时边界，
                // 由 resolveGeneratedAiMessageIndex_ACU 在防抖回调中按唯一候选规则解析。
                const chatAtCapture = SillyTavern_API_ACU?.chat || [];
                const eventMessageId = typeof message_id === 'number' && Number.isInteger(message_id)
                  ? message_id
                  : undefined;
                const autoFillIntent = eventMessageId !== undefined
                  ? {
                      eventMessageId,
                      chatKey: currentChatFileIdentifier_ACU,
                      isolationKey: getCurrentIsolationKey_ACU(),
                      capturedAt: Date.now(),
                      capturedChatLength: chatAtCapture.length,
                      capturedAiFloorCount: chatAtCapture.filter((m: any) => m && !m.is_user && m?.extra?.type !== 'narrator').length,
                      // generationSeq 仅在 generationGate 已产生过生成上下文时可靠；否则不假造。
                      generationSeq: generationGate_ACU.generationSeq > 0 ? generationGate_ACU.generationSeq : undefined,
                  }
                  : undefined;
                if (shouldProcessAutoTableUpdateForGenerationEnded_ACU(generationContext)) {
                  handleNewMessageDebounced_ACU('GENERATION_ENDED', autoFillIntent);
                } else {
                  logDebug_ACU('ACU: Skip auto table update due to quiet/background generation.');
                  logAutoFillSkip_ACU('quiet_or_background_generation', {
                    eventType: 'GENERATION_ENDED',
                    messageId: message_id,
                    eventMessageId: message_id,
                    chatKey: currentChatFileIdentifier_ACU,
                    isolationKey: getCurrentIsolationKey_ACU(),
                    capturedChatLength: chatAtCapture.length,
                    capturedAiFloorCount: chatAtCapture.filter((m: any) => m && !m.is_user && m?.extra?.type !== 'narrator').length,
                    lastGenerationType: generationGate_ACU.lastGeneration?.type,
                  });
                }
            };
            if (typeof SillyTavern_API_ACU.eventSource.makeFirst === 'function') {
              SillyTavern_API_ACU.eventSource.makeFirst(SillyTavern_API_ACU.eventTypes.GENERATION_ENDED, onGenerationEnded);
            } else {
              SillyTavern_API_ACU.eventSource.on(SillyTavern_API_ACU.eventTypes.GENERATION_ENDED, onGenerationEnded);
            }
        }

        // [剧情推进] 拦截用户输入进行剧情规划
        if (SillyTavern_API_ACU.eventTypes.GENERATION_AFTER_COMMANDS) {
          SillyTavern_API_ACU.eventSource.on(SillyTavern_API_ACU.eventTypes.GENERATION_AFTER_COMMANDS, async (type: any, params: any, dryRun: any) => {
            // 前置过滤（纯 UI/宿主层判断）
            if (params?._qrf_processed_by_hook) return;
            const shouldProcessSummaryVectorIndex = shouldProcessSummaryVectorIndexForGeneration_ACU(type, params, dryRun);
            const shouldProcessPlot = shouldProcessPlotForGeneration_ACU(type, params, dryRun);
            const shouldEnsureInitialSeed = !dryRun
              && type !== 'regenerate'
              && !params?.automatic_trigger
              && !isQuietLikeGeneration_ACU(type, params)
              && (isRecentUserSendIntent_ACU() || shouldProcessSummaryVectorIndex || shouldProcessPlot);
            if (shouldEnsureInitialSeed) {
              await ensureInitialSeedCheckpointBeforeGeneration_ACU('generation_after_commands_before_ai', { allowPendingFirstUserMessage: true });
            }
            if (!shouldProcessSummaryVectorIndex && !shouldProcessPlot) return;
            if (shouldProcessSummaryVectorIndex) {
              try {
                const chatForSummaryIndex = SillyTavern_API_ACU.chat;
                const lastUserText = (chatForSummaryIndex?.length && (chatForSummaryIndex as any)[chatForSummaryIndex.length - 1]?.is_user)
                  ? String((chatForSummaryIndex as any)[chatForSummaryIndex.length - 1].mes || '')
                  : String(getSendTextareaValue_ACU() || params?.prompt || '');
                const summaryVectorResult = await processSummaryVectorIndexBeforeGenerationWithUI_ACU({ userInput: lastUserText, source: 'generation_after_commands' });
                logDebug_ACU(`[交火模式纪要索引] GENERATION_AFTER_COMMANDS 发送前处理完成：success=${summaryVectorResult.success}, skipped=${summaryVectorResult.skipped === true}, reason=${summaryVectorResult.reason || 'none'}, keywords=${summaryVectorResult.keywordCount ?? 0}, injected=${summaryVectorResult.injectedCount ?? 0}`);
              } catch (error) {
                logWarn_ACU('[交火模式纪要索引] 发送前注入失败，继续原始生成:', error);
              }
            }
            if (!shouldProcessPlot) return;
            if (type === 'regenerate' || isProcessing_Plot_ACU) return;

            // [去重] 若同一文本刚被 TavernHelper.generate 钩子处理过，跳过
            try {
              const lastMsgText = (SillyTavern_API_ACU.chat?.length && (SillyTavern_API_ACU.chat as any)[SillyTavern_API_ACU.chat.length - 1]?.is_user)
                ? ((SillyTavern_API_ACU.chat as any)[SillyTavern_API_ACU.chat.length - 1].mes || '')
                : '';
              const boxText = String(getSendTextareaValue_ACU() || '');
              if (shouldSkipPlotIntercept_ACU(String(lastMsgText)) || shouldSkipPlotIntercept_ACU(boxText)) {
                logDebug_ACU('[剧情推进] Skip GENERATION_AFTER_COMMANDS due to recent TavernHelper.generate interception.');
                return;
              }
            } catch (e) {}

            const chat = SillyTavern_API_ACU.chat;
            if (!chat || chat.length === 0) return;

            // ── 策略1：已有用户消息 ──
            const lastMessageIndex = chat.length - 1;
            const lastMessage = chat[lastMessageIndex];

            // [重构] 调用 service 层策略1编排
            const s1 = await orchestrateAfterCommandsStrategy1_ACU(lastMessage, lastMessageIndex, runOptimizationLogicWithUI_ACU);

            if (s1.action !== 'no_match') {
              // 策略1匹配，根据结果做 UI 操作
              switch (s1.action) {
                case 'aborted':
                  if (s1.manual) {
                    // 停止生成
                    try {
                      if (SillyTavern_API_ACU && typeof SillyTavern_API_ACU.stopGeneration === 'function') SillyTavern_API_ACU.stopGeneration();
                      else if ((window as any).SillyTavern?.stopGeneration) (window as any).SillyTavern.stopGeneration();
                    } catch (e) {}
                    // 删除刚创建的用户消息
                    try {
                      const chatNow = SillyTavern_API_ACU.chat;
                      const lastNow = chatNow?.length ? chatNow[chatNow.length - 1] : null;
                      if (lastNow && lastNow.is_user && String(lastNow.mes || '') === String(s1.originalMessage || '')) {
                        if (typeof SillyTavern_API_ACU.deleteLastMessage === 'function') await SillyTavern_API_ACU.deleteLastMessage();
                        else if ((window as any).SillyTavern?.deleteLastMessage) await (window as any).SillyTavern.deleteLastMessage();
                      }
                    } catch (e) {}
                    // 恢复输入框
                    try { setSendTextareaValue_ACU(s1.restoreText || ''); } catch (e) {}
                  }
                  break;

                case 'planned':
                  // 写回 params 和消息对象
                  params.prompt = s1.finalMessage;
                  lastMessage.mes = s1.finalMessage;
                  SillyTavern_API_ACU.eventSource.emit(SillyTavern_API_ACU.eventTypes.MESSAGE_UPDATED, lastMessageIndex);
                  if (getSendTextareaValue_ACU() === s1.originalMessage) setSendTextareaValue_ACU('');
                  break;

                // 'skipped' — 不做额外操作
              }
              return; // 策略1匹配，不再执行策略2
            }

            // ── 策略2：输入框文本 ──
            // shouldProcessPlot 是本次 GENERATION_AFTER_COMMANDS 事件开始时捕获的授权。
            // 交火召回可能耗时超过 USER_SEND_TRIGGER_TTL_MS_ACU；这里不能再用 TTL 二次否决，
            // 否则会出现“交火已覆盖纪要索引，但剧情推进被跳过并直接正文生成”的断链。
            if (!shouldProcessPlot && !isRecentUserSendIntent_ACU()) return;
            const textInBox = getSendTextareaValue_ACU();

            // [重构] 调用 service 层策略2编排
            const s2 = await orchestrateAfterCommandsStrategy2_ACU(String(textInBox || ''), runOptimizationLogicWithUI_ACU);

            switch (s2.action) {
              case 'aborted':
                if (s2.manual) {
                  try {
                    if (SillyTavern_API_ACU && typeof SillyTavern_API_ACU.stopGeneration === 'function') SillyTavern_API_ACU.stopGeneration();
                    else if ((window as any).SillyTavern?.stopGeneration) (window as any).SillyTavern.stopGeneration();
                  } catch (e) {}
                }
                break;

              case 'planned':
                setSendTextareaValue_ACU(s2.finalMessage!);
                try { params.prompt = s2.finalMessage; } catch (e) {}
                break;
            }

            // 消费掉本次发送意图
            generationGate_ACU.lastUserSendIntentAt = 0;
          });
        }
        const chatModificationEvents = ['MESSAGE_DELETED', 'MESSAGE_SWIPED'] as const;
        chatModificationEvents.forEach(evName => {
            if (SillyTavern_API_ACU.eventTypes[evName as keyof typeof SillyTavern_API_ACU.eventTypes]) {
                SillyTavern_API_ACU.eventSource.on(SillyTavern_API_ACU.eventTypes[evName as keyof typeof SillyTavern_API_ACU.eventTypes], async (data: any) => {
                    logDebug_ACU(`ACU ${evName} event detected. Triggering data reload and merge from chat history.`);
                    scheduleChatMutationRefresh_ACU(evName === 'MESSAGE_DELETED' ? 'chat_modified_deleted' : 'chat_modified_swiped');
                });
            }
        });
        logDebug_ACU('ACU: All event listeners attached using eventSource.');
      } else {
        logWarn_ACU('ACU: Could not attach event listeners because eventSource or eventTypes are missing.');
      }
      // [新增] 移除公用的手动更新按钮，改为两个独立的手动更新按钮
      // if (typeof eventOnButton === 'function') {
      //     eventOnButton('更新数据库', handleManualUpdateCard_ACU);
      //     logDebug_ACU(
      //         "ACU: '更新数据库' button event registered with global eventOnButton.",
      //     );
      // } else {
      //     logWarn_ACU("ACU: Global eventOnButton function is not available.");
      // }
      // 修复：移除启动时的状态重置调用。现在完全依赖于SillyTavern加载后触发的第一个CHAT_CHANGED事件来初始化，避免了竞态条件。
      // [新增修复]：为了解决作为角色脚本加载时可能错过初始CHAT_CHANGED事件的问题，
      // 我们在初始化时主动获取一次当前聊天信息并进行设置。
      // 这确保了无论脚本何时加载，都能正确初始化。
      // [修复] 添加轮询重试机制：如果 chatId 暂时不可用，持续轮询直到可用
      const initWithChatId = async (chatId: string) => {
          logDebug_ACU(`ACU: Initializing with current chat on load: ${chatId}`);
          await resetScriptStateForNewChat_ACU(chatId, { reason: 'startup_restore' });
          await loadPresetAndCleanCharacterData_ACU();
          // 再次强制刷新数据和UI，确保初始加载时表格显示正确
          await loadAllChatMessages_ACU();

          // [provisional bridge] 启动加载当前聊天后统一恢复门：
          // 若上次运行崩溃留下 active provisional bridge（原 full 被暂存、临时根在链上），
          // 在首次读写前自动 finalize（有已提交 bucket）或 rollback（零提交）；
          // 无法证明安全时记录错误并 fail-closed，避免在残留拓扑上继续写入。
          const bridgeGate = await ensureNoActiveProvisionalBridgeForCurrentScope_ACU();
          if (!bridgeGate.ok) {
            logError_ACU(`[ManualCatchUpBridge] 启动恢复残留 provisional bridge 失败：${(bridgeGate as { ok: false; error: string }).error}`);
          }

          // 阶段 D：启动补偿同样收敛为“一轮 merged refresh → snapshot hydrate”。
          // 老卡（有聊天历史）从聊天记录合并数据建表；新卡（无数据）由 refresh
          // 走 guide/模板基底，hydrate 失败或 degraded 时回退冷 reload。
          const refreshResult = await refreshMergedDataAndNotifyWithUI_ACU();
          if (isSqliteMode()) {
              const envelope = refreshResult
                  && !refreshResult.degraded
                  && refreshResult.mergedData
                  ? createCanonicalSnapshotEnvelope_ACU({
                      data: refreshResult.mergedData,
                      chatIdentity: String(currentChatFileIdentifier_ACU || ''),
                      isolationKey: getCurrentIsolationKey_ACU(),
                      storageMode: 'sqlite',
                      lifecycleEpoch: getRuntimeLifecycleEpoch_ACU(),
                      source: 'merged_refresh',
                  })
                  : null;
              if (envelope) {
                  logDebug_ACU('[SQLite] initWithChatId: 用 canonical snapshot hydrate 内存数据库...');
                  const hydrated = await hydrateStorageProviderFromSnapshot_ACU(envelope);
                  if (hydrated.ok) {
                      logDebug_ACU('[SQLite] initWithChatId: snapshot hydrate 完成');
                  } else if (hydrated.failureCode === 'stale_load_discarded') {
                      logDebug_ACU('[SQLite] initWithChatId: snapshot 身份漂移，回退冷 reload。');
                      try {
                          await reloadStorageProvider();
                      } catch (e: any) {
                          logError_ACU(`[SQLite] initWithChatId: 冷 reload 失败: ${e?.message}`);
                      }
                  } else {
                      logError_ACU(`[SQLite] initWithChatId: snapshot hydrate 失败: ${hydrated.failureCode || 'unknown'}${hydrated.error ? `: ${hydrated.error}` : ''}`);
                  }
              } else {
                  logDebug_ACU('[SQLite] initWithChatId: merged refresh 未产出可用 canonical（degraded/空数据），回退冷 reload。');
                  try {
                      await reloadStorageProvider();
                  } catch (e: any) {
                      logError_ACU(`[SQLite] initWithChatId: 数据库初始化失败: ${e?.message}`);
                  }
              }
          }

          // S0-4：初始加载完成后捕获 checkpoint 保管库（删楼恢复的影子基线）。
          try {
              captureCheckpointVaultForCurrentChat_ACU();
          } catch (e: any) {
              logWarn_ACU(`[删楼守卫] initWithChatId 保管库捕获失败: ${e?.message}`);
          }

          // S3-3：初始加载完成后做休眠完整性自检（只读，发现孤儿即警告）。
          runDormantIntegrityAuditQuietly_ACU('initWithChatId');
      };

      // C5 加载失败可见化：初始加载与 CHAT_CHANGED 同级兜底，不允许静默空表。
      const initWithChatIdSafely = async (chatId: string) => {
          try {
              await initWithChatId(chatId);
          } catch (initError) {
              const message = initError instanceof Error ? initError.message : String(initError);
              logError_ACU('ACU: 初始加载表格数据失败（已尝试全部兼容读取层）:', initError);
              showUiSurfaceToast_ACU({
                  kind: 'error',
                  text: `表格数据加载失败：${message}`,
                  action: {
                      label: '打开数据管理',
                      onClick: async () => { await getUiSurface_ACU()?.openSettings?.(); },
                  },
              });
          }
      };

      if (SillyTavern_API_ACU && SillyTavern_API_ACU.chatId) {
          // chatId 已可用，延迟初始化
          setTimeout(async () => {
              await initWithChatIdSafely(SillyTavern_API_ACU!.chatId);
          }, 1000);
      } else {
          // chatId 暂时不可用，启动轮询重试（每200ms检查一次，最多等15秒）
          logWarn_ACU('ACU: chatId not available on initial load. Starting polling...');
          let pollCount = 0;
          const maxPolls = 75; // 200ms × 75 = 15秒
          const pollTimer = setInterval(async () => {
              pollCount++;
              const chatId = SillyTavern_API_ACU?.chatId;
              if (chatId) {
                  clearInterval(pollTimer);
                  logDebug_ACU(`ACU: chatId became available after ${pollCount * 200}ms polling: ${chatId}`);
                  await initWithChatIdSafely(chatId);
              } else if (pollCount >= maxPolls) {
                  clearInterval(pollTimer);
                  logWarn_ACU(`ACU: chatId still not available after ${maxPolls * 200}ms polling. Waiting for CHAT_CHANGED event.`);
              }
          }, 200);
      }
    } else {
      const capabilityDiagnostics = formatHostCapabilities_ACU(getLastHostCapabilities_ACU());
      logError_ACU(`ACU: Failed to initialize. Core APIs not available on DOM ready. 宿主能力: ${capabilityDiagnostics}`);
      console.error(`数据库自动更新脚本初始化失败：核心API加载失败。宿主能力: ${capabilityDiagnostics}`);
    }
  }
