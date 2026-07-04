// init.ts — 初始化编排（presentation 层：负责事件绑定、UI 初始化、模块串联）
// 从 05_core_tail.js 迁入

import { DEFAULT_PLOT_SETTINGS_ACU } from '../../shared/defaults-json.js';
import { addAutoCardMenuItem_ACU } from './startup';
import { newMessageDebounceTimer_ACU, _set_newMessageDebounceTimer_ACU} from '../../service/runtime/state-manager';
import { showToastr_ACU } from '../theme/toast';
import { attemptToLoadCoreApis_ACU } from '../triggers/settings-ui-sync';
import { ensureInitialSeedCheckpoint_ACU, handleChatCompletionReady_ACU, loadPresetAndCleanCharacterData_ACU } from '../../service/runtime/helpers-remaining';
import { SillyTavern_API_ACU } from '../../shared/host-api';
import { currentChatFileIdentifier_ACU, generationGate_ACU, markUserSendIntent_ACU, isProcessing_Plot_ACU, isQuietLikeGeneration_ACU, isRecentUserSendIntent_ACU, loopState_ACU, recordGenerationContext_ACU, recordLastUserSend_ACU, settings_ACU, shouldProcessAutoTableUpdateForGenerationEnded_ACU, shouldProcessPlotForGeneration_ACU, shouldProcessSummaryVectorIndexForGeneration_ACU, _set_allChatMessages_ACU, _set_currentChatFileIdentifier_ACU, _set_currentJsonTableData_ACU, _set_independentTableStates_ACU, _set_isProcessing_Plot_ACU, _set_lastTotalAiMessages_ACU} from '../../service/runtime/state-manager';
import { applyTemplateScopeForCurrentChat_ACU, loadSettings_ACU } from '../../service/settings/settings-service';
import { resetScriptStateForNewChat_ACU } from '../../service/worldbook/injection-engine';
import { reloadStorageProvider, disposeStorageProvider } from '../../service/table/table-storage-strategy';
import { isSqliteMode } from '../../service/table/storage-mode';
import { loadAllChatMessages_ACU } from '../../service/worldbook/pipeline';
import { refreshMergedDataAndNotifyWithUI_ACU } from '../components/pipeline-ui-helpers';
import { cleanChatName_ACU, logDebug_ACU, logError_ACU, logWarn_ACU } from '../../shared/utils';
import { shouldSkipPlotIntercept_ACU } from '../../service/plot/plot-logic';
import { orchestrateTavernHelperHook_ACU, orchestrateAfterCommandsStrategy1_ACU, orchestrateAfterCommandsStrategy2_ACU } from '../../service/plot/plot-orchestrator';
import { getSendTextareaValue_ACU, setSendTextareaValue_ACU } from '../components/status-display';
import { updateCardUpdateStatusDisplay_ACU } from '../components/update-status-display';
import { handleNewMessageDebounced_ACU } from '../triggers/settings-ui-sync';
import { enterLoopRetryFlow_ACU, onLoopGenerationEnded_ACU, stopAutoLoop_ACU } from '../triggers/auto-loop';
import { runOptimizationLogicWithUI_ACU } from '../components/plot-planning-ui';
import { processSummaryVectorIndexBeforeGenerationWithUI_ACU } from '../components/summary-vector-index-ui';
import { preloadSummaryVectorIndexCacheForCurrentChat_ACU } from '../../service/vector/summary-vector-index-cache-service';
import { restoreSummaryVectorIndexFlushQueueForCurrentChat_ACU } from '../../service/vector/summary-vector-index-flush-queue';
import { markSummaryVectorIndexDirtyForRealign_ACU } from '../../service/vector/summary-vector-index-realign-state';
import { topLevelWindow_ACU } from '../../shared/env';

// [从 state-manager.ts 搬入 presentation 层] 安装发送意图捕捉钩子（DOM 事件绑定）
async function ensureInitialSeedCheckpointBeforeGeneration_ACU(reason: string, { allowPendingFirstUserMessage = true } = {}) {
  try {
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
  if (typeof updateCardUpdateStatusDisplay_ACU === 'function') updateCardUpdateStatusDisplay_ACU();
}

function clearDerivedRuntimeState_ACU(): void {
  disposeStorageProvider();
  _set_currentJsonTableData_ACU(null);
  _set_independentTableStates_ACU({});
  _set_allChatMessages_ACU([]);
  _set_lastTotalAiMessages_ACU(0);
}

function clearRuntimeForNoActiveChat_ACU(chatFileName: unknown): void {
  clearDerivedRuntimeState_ACU();
  _set_currentChatFileIdentifier_ACU('');
  generationGate_ACU.lastUserMessageId = null;
  generationGate_ACU.lastUserMessageText = '';
  generationGate_ACU.lastUserMessageAt = 0;
  generationGate_ACU.lastUserSendIntentAt = 0;
  generationGate_ACU.lastGeneration = null;
  notifyRuntimeTableCleared_ACU();
  logDebug_ACU(`ACU: No active chat after CHAT_CHANGED (${String(chatFileName)}), runtime table state cleared.`);
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

      addAutoCardMenuItem_ACU();
      loadSettings_ACU();
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
            if (isSqliteMode()) logDebug_ACU('[SQLite] CHAT_CHANGED: 立即销毁旧数据库实例');
          }

          await resetScriptStateForNewChat_ACU(chatFileName);

          // [触发门控] generationGate 重置已搬到 service 层的 resetScriptStateForNewChat_ACU 中

          // [触发门控] 每次切换聊天都尝试安装一次 capture 钩子（防止 DOM 重新渲染导致丢失）          installSendIntentCaptureHooks_ACU();

          // [剧情推进] 切换聊天时停止循环并加载预设
          if (loopState_ACU.isLooping) {
            stopAutoLoop_ACU();
            showToastr_ACU('info', '切换聊天，自动化循环已停止。');
          }
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
                  const summaryVectorResult = await processSummaryVectorIndexBeforeGenerationWithUI_ACU({ userInput, source: 'tavernhelper' });
                  logDebug_ACU(`[交火模式纪要索引] TavernHelper.generate 发送前处理完成：success=${summaryVectorResult.success}, skipped=${summaryVectorResult.skipped === true}, reason=${summaryVectorResult.reason || 'none'}, keywords=${summaryVectorResult.keywordCount ?? 0}, injected=${summaryVectorResult.injectedCount ?? 0}`);
                }

                // [重构] 调用 service 层编排函数，传入 UI 规划回调
                const result = await orchestrateTavernHelperHook_ACU(options, runOptimizationLogicWithUI_ACU);

                switch (result.action) {
                  case 'loop_retry': {
                    const loopSettings = settings_ACU.plotSettings.loopSettings || DEFAULT_PLOT_SETTINGS_ACU.loopSettings;
                    loopState_ACU.awaitingReply = false;
                    await enterLoopRetryFlow_ACU({ loopSettings, shouldDeleteAiReply: false });
                    return;
                  }
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

            // [6.7.3] SQLite 模式下，切换聊天后需要重建内存数据库（初始化 SQLite 引擎）
            if (isSqliteMode()) {
                logDebug_ACU('[SQLite] CHAT_CHANGED: 重建内存数据库...');
                try {
                    await reloadStorageProvider();
                    logDebug_ACU('[SQLite] CHAT_CHANGED: 内存数据库重建完成');
                } catch (e: any) {
                    logError_ACU(`[SQLite] CHAT_CHANGED: 数据库重建失败: ${e?.message}`);
                }
            }

            // 3. 刷新数据（UI 刷新由 presentation 层负责）
            await refreshMergedDataAndNotifyWithUI_ACU();

            // [交火向量索引] 聊天数据刷新完成后，预热当前聊天对应的外置分片缓存。
            // 注意：必须放在 refreshMergedDataAndNotifyWithUI_ACU 之后，否则可能读取到旧聊天的 manifest。
            const vectorCacheResult = await preloadSummaryVectorIndexCacheForCurrentChat_ACU();
            logDebug_ACU(`[交火向量索引] CHAT_CHANGED 缓存预热结果：success=${vectorCacheResult.success}, skipped=${vectorCacheResult.skipped === true}, reason=${vectorCacheResult.reason || 'none'}, chunks=${vectorCacheResult.chunkCount}, indexId=${vectorCacheResult.indexId || 'none'}`);
            try {
                const restoredFlushCount = await restoreSummaryVectorIndexFlushQueueForCurrentChat_ACU();
                if (restoredFlushCount > 0) {
                    logDebug_ACU(`[交火向量索引] CHAT_CHANGED 已恢复防抖归档队列：count=${restoredFlushCount}`);
                }
            } catch (restoreFlushError) {
                logWarn_ACU('[交火向量索引] CHAT_CHANGED 恢复防抖归档队列失败:', restoreFlushError);
            }
            
            // [新增] 再次强制刷新状态显示，确保UI同步
            if (typeof updateCardUpdateStatusDisplay_ACU === 'function') {
                updateCardUpdateStatusDisplay_ACU();
            }
            
            logDebug_ACU('ACU: Chat data reload and UI refresh triggered after chat change (Delayed).');
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
              recordGenerationContext_ACU(type, params, dryRun);
            } catch (e) {}
          });
        }
        if (SillyTavern_API_ACU.eventTypes.GENERATION_ENDED) {
            SillyTavern_API_ACU.eventSource.on(SillyTavern_API_ACU.eventTypes.GENERATION_ENDED, (message_id: any) => {
                logDebug_ACU(`ACU GENERATION_ENDED event for message_id: ${message_id}`);
                if (shouldProcessAutoTableUpdateForGenerationEnded_ACU(message_id)) {
                  handleNewMessageDebounced_ACU('GENERATION_ENDED');
                } else {
                  logDebug_ACU('ACU: Skip auto table update due to quiet/background generation.');
                }

                // [剧情推进] 保存Plot到消息和循环检测
                // savePlotToLatestMessage_ACU(); // Moved to runOptimizationLogic_ACU
                onLoopGenerationEnded_ACU();
            });
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

                case 'loop_retry': {
                  const loopSettings = settings_ACU.plotSettings.loopSettings || DEFAULT_PLOT_SETTINGS_ACU.loopSettings;
                  loopState_ACU.awaitingReply = false;
                  await enterLoopRetryFlow_ACU({ loopSettings, shouldDeleteAiReply: false });
                  break;
                }
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
                    clearTimeout(newMessageDebounceTimer_ACU);
                    _set_newMessageDebounceTimer_ACU(setTimeout(async () => {
                        // [6.7.3] SQLite 模式下，楼层删除/滑动后需要重建内存数据库
                        if (isSqliteMode()) {
                            logDebug_ACU(`[SQLite] ${evName}: 重建内存数据库...`);
                            try {
                                await reloadStorageProvider();
                                logDebug_ACU(`[SQLite] ${evName}: 内存数据库重建完成`);
                            } catch (e: any) {
                                logError_ACU(`[SQLite] ${evName}: 数据库重建失败: ${e?.message}`);
                            }
                        }
                        // [修复] 重新合并数据并更新UI和世界书
                        await refreshMergedDataAndNotifyWithUI_ACU();
                        const realignDirtyReason = evName === 'MESSAGE_DELETED'
                            ? 'chat_modified_deleted'
                            : 'chat_modified_swiped';
                        markSummaryVectorIndexDirtyForRealign_ACU(realignDirtyReason);
                        logDebug_ACU(`[交火向量索引] ${evName}: 已标记下一次归档后执行懒对齐。`);
                    }, 500)); // 使用防抖处理快速滑动
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
          await resetScriptStateForNewChat_ACU(chatId);
          await loadPresetAndCleanCharacterData_ACU();
          
          // 再次强制刷新数据和UI，确保初始加载时表格显示正确
          await loadAllChatMessages_ACU();

          // [修复] SQLite 模式下，启动时初始化内存数据库
          // 老卡（有聊天历史数据）会从聊天记录合并数据建表
          // 新卡（无数据）只初始化引擎，建表延迟到第一次填表时
          if (isSqliteMode()) {
              logDebug_ACU('[SQLite] initWithChatId: 初始化内存数据库...');
              try {
                  await reloadStorageProvider();
                  logDebug_ACU('[SQLite] initWithChatId: 内存数据库初始化完成');
              } catch (e: any) {
                  logError_ACU(`[SQLite] initWithChatId: 数据库初始化失败: ${e?.message}`);
              }
          }

          await refreshMergedDataAndNotifyWithUI_ACU();
          
          if (typeof updateCardUpdateStatusDisplay_ACU === 'function') {
             updateCardUpdateStatusDisplay_ACU();
          }
      };

      if (SillyTavern_API_ACU && SillyTavern_API_ACU.chatId) {
          // chatId 已可用，延迟初始化
          setTimeout(async () => {
              await initWithChatId(SillyTavern_API_ACU!.chatId);
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
                  await initWithChatId(chatId);
              } else if (pollCount >= maxPolls) {
                  clearInterval(pollTimer);
                  logWarn_ACU(`ACU: chatId still not available after ${maxPolls * 200}ms polling. Waiting for CHAT_CHANGED event.`);
              }
          }, 200);
      }
    } else {
      logError_ACU('ACU: Failed to initialize. Core APIs not available on DOM ready.');
      console.error('数据库自动更新脚本初始化失败：核心API加载失败。');
    }
  }
