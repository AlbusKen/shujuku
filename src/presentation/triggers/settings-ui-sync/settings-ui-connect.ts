/**
 * presentation/triggers/settings-ui-sync/settings-ui-connect.ts
 */
import { DEFAULT_CHAR_CARD_PROMPT_ACU } from '../../../shared/defaults-json.js';
import { updateCardUpdateStatusDisplay_ACU } from '../../components/update-status-display';
import { contentOptimizationDebounceTimer_ACU, getCharCardPromptFromUI_ACU, isAutoUpdatingCard_ACU, manualExtraHint_ACU, renderPromptSegments_ACU, wasStoppedByUser_ACU, _set_contentOptimizationDebounceTimer_ACU, _set_isAutoUpdatingCard_ACU, _set_manualExtraHint_ACU, _set_wasStoppedByUser_ACU } from '../../components/plot-editors';
import { showToastr_ACU } from '../../theme/toast';
import { ACU_TOAST_CATEGORY_ACU } from '../../../shared/constants';
import { SillyTavern_API_ACU, TavernHelper_API_ACU, toastr_API_ACU, _set_SillyTavern_API_ACU, _set_TavernHelper_API_ACU, _set_jQuery_API_ACU, _set_toastr_API_ACU } from '../../../shared/host-api';
import { jQuery_API_ACU } from '../../dom-utils';
import { isExtensionMode, getHostWindow } from '../../../shared/runtime-env';
import { getChatArray_ACU, saveChatToHost_ACU } from '../../../service/chat/chat-service';
import { getConnectionManagerProfiles_ACU, fetchAvailableModels_ACU } from '../../../service/ai/ai-service';
import { getCurrentCharacterFallback_ACU } from '../../../service/host/host-state-service';
import { AI_MATERIALIZATION_MAX_RETRIES_ACU, AI_MATERIALIZATION_RETRY_DELAY_MS_ACU, NEW_MESSAGE_DEBOUNCE_DELAY_ACU, coreApisAreReady_ACU, currentChatFileIdentifier_ACU, currentJsonTableData_ACU, generationGate_ACU, getCurrentIsolationKey_ACU, isQuietLikeGeneration_ACU, lastTotalAiMessages_ACU, settings_ACU , _set_coreApisAreReady_ACU, _set_lastTotalAiMessages_ACU} from '../../../service/runtime/state-manager';
import { $popupInstance_ACU, $customApiUrlInput_ACU, $customApiKeyInput_ACU, $customApiModelInput_ACU, $customApiModelSelect_ACU, $maxTokensInput_ACU, $temperatureInput_ACU, $apiStatusDisplay_ACU, $charCardPromptSegmentsContainer_ACU, $autoUpdateThresholdInput_ACU, $autoUpdateTokenThresholdInput_ACU, $autoUpdateFrequencyInput_ACU, $updateBatchSizeInput_ACU, $maxConcurrentGroupsInput_ACU, $skipUpdateFloorsInput_ACU, $retainRecentLayersInput_ACU, $tableMaxRetriesInput_ACU, $manualExtraHintCheckbox_ACU } from '../../state/ui-refs';
import { checkAutoMergeTrigger_ACU, prepareAutoMergeBatches_ACU, executeAutoMergeBatch_ACU, finalizeAutoMerge_ACU } from '../../../service/summary/merge-logic';
import { processUpdates_ACU } from '../update-process';
import { getSortedSheetKeys_ACU } from '../../../service/template/chat-scope';
import { refreshMergedDataAndNotifyWithUI_ACU } from '../../components/pipeline-ui-helpers';
import { SCRIPT_ID_PREFIX_ACU } from '../../../shared/constants';
import { escapeHtml_ACU } from '../../../shared/html-helpers';
import { topLevelWindow_ACU } from '../../../shared/env';
import { isSummaryOrOutlineTable_ACU, logDebug_ACU, logError_ACU, logWarn_ACU } from '../../../shared/utils';
import { startRuntimePerformanceSpan_ACU } from '../../../shared/runtime-performance';
import { executeContentOptimization_ACU } from '../../components/optimization-ui';
import { maybeLiftWorldbookSuppression_ACU } from '../../../service/runtime/helpers-remaining';

import { evaluateNewMessageAction_ACU, resolveGeneratedAiMessageIndex_ACU, type AutoFillIntent_ACU } from '../../../service/runtime/message-handler';
import { logContentOptimizationSkip_ACU } from '../../../shared/trigger-diagnostics';
import { buildTavernHelperCompat_ACU, formatHostCapabilities_ACU } from '../../../shared/host-compat/tavern-helper-compat';

  export async function fetchModelsAndConnect_ACU() {
    if (
      !$popupInstance_ACU ||
      !$customApiUrlInput_ACU ||
      !$customApiKeyInput_ACU ||
      !$customApiModelSelect_ACU ||
      !$apiStatusDisplay_ACU
    ) {
      logError_ACU('加载模型列表失败：UI元素未初始化。');
      showToastr_ACU('error', 'UI未就绪。');
      return;
    }
    const apiUrl = String($customApiUrlInput_ACU.val() || '').trim();
    const apiKey = String($customApiKeyInput_ACU.val() || '');
    if (!apiUrl) {
      showToastr_ACU('warning', '请输入API基础URL。');
      $apiStatusDisplay_ACU.text('状态:请输入API基础URL').css('color', 'orange');
      return;
    }
    $apiStatusDisplay_ACU.text('状态: 正在检查API端点状态...').css('color', '#61afef');
    showToastr_ACU('info', '正在检查自定义API端点状态...');

    try {
        // [重构] 调用 service 层获取模型列表
        const result = await fetchAvailableModels_ACU(apiUrl, apiKey);

        if (!result.success) {
            throw new Error(result.error || '未知错误');
        }

        const models = result.models!;
        const currentSelectedModel = settings_ACU.apiConfig.model || '';

        // UI 操作：填充模型下拉列表
        $customApiModelSelect_ACU.empty().append('<option value="">-- 请选择模型 --</option>');
        models.forEach((modelName: string) => {
            const selected = modelName === currentSelectedModel ? ' selected' : '';
            $customApiModelSelect_ACU.append(`<option value="${escapeHtml_ACU(modelName)}"${selected}>${escapeHtml_ACU(modelName)}</option>`);
        });

        // 如果之前保存的模型不在列表中，也添加进去
        if (currentSelectedModel && $customApiModelSelect_ACU.find(`option[value="${escapeHtml_ACU(currentSelectedModel)}"]`).length === 0) {
            $customApiModelSelect_ACU.append(`<option value="${escapeHtml_ACU(currentSelectedModel)}" selected>${escapeHtml_ACU(currentSelectedModel)} (已保存)</option>`);
        }
        showToastr_ACU('success', `模型列表加载成功！共加载 ${models.length} 个模型。`);
    } catch (error) {
      logError_ACU('加载模型列表时出错:', error);
      showToastr_ACU('error', `加载模型列表失败: ${error.message}`);
      $apiStatusDisplay_ACU.text(`状态: 加载模型失败 - ${error.message}`).css('color', '#ff6b6b');
    }
    updateApiStatusDisplay_ACU();
  }
  export function updateApiStatusDisplay_ACU() {
    if (!$popupInstance_ACU || !$apiStatusDisplay_ACU) return;
    if (settings_ACU.apiConfig.url && settings_ACU.apiConfig.model)
      $apiStatusDisplay_ACU.html(
        `当前URL: <span style="color:lightgreen;word-break:break-all;">${escapeHtml_ACU(
          settings_ACU.apiConfig.url,
        )}</span><br>已选模型: <span style="color:lightgreen;">${escapeHtml_ACU(settings_ACU.apiConfig.model)}</span>`,
      );
    else if (settings_ACU.apiConfig.url)
      $apiStatusDisplay_ACU.html(
        `当前URL: ${escapeHtml_ACU(settings_ACU.apiConfig.url)} - <span style="color:orange;">请加载并选择模型</span>`,
      );
    else $apiStatusDisplay_ACU.html(`<span style="color:#ffcc80;">未配置自定义API。数据库更新功能可能不可用。</span>`);
  }
  export function attemptToLoadCoreApis_ACU() {
    // 根据运行模式选择宿主窗口
    const hostWin: any = getHostWindow();
    const mode = isExtensionMode() ? '插件' : '油猴脚本';
    logDebug_ACU(`[CoreAPI] 运行模式: ${mode}, hostWin === window: ${hostWin === window}`);

    // ═══════════════════════════════════════════════════════════════
    // 插件模式特殊处理：主窗口的 window.SillyTavern 只有 {libs, getContext}
    // 所有真正的 API（chatId/eventSource/eventTypes/chat/saveChat 等）必须通过
    // SillyTavern.getContext() 才能拿到，而且 getContext() 返回的是"当前快照"，
    // 属性值会随酒馆状态变化。所以用 Proxy 包装：每次属性读取都重新调用 getContext()
    // 取最新快照，这样既不用改所有消费者代码，又保证读到最新值。
    //
    // 油猴脚本模式下，iframe 的 window.SillyTavern 本身就是扁平化的 API 对象
    // （由酒馆助手封装），保持原样直接赋值。
    // ═══════════════════════════════════════════════════════════════
    let stApi: any;
    if (isExtensionMode()) {
      const rawST = hostWin.SillyTavern || (window as any).SillyTavern;
      if (rawST && typeof rawST.getContext === 'function') {
        // Proxy：每次属性读取都通过 getContext() 拿当前快照
        stApi = new Proxy({}, {
          get(_target, prop: string | symbol) {
            try {
              const ctx = rawST.getContext();
              if (!ctx) return undefined;
              return (ctx as any)[prop as any];
            } catch (e) {
              // getContext 抛异常时静默返回 undefined，让调用方的空值检查生效
              return undefined;
            }
          },
          has(_target, prop: string | symbol) {
            try {
              const ctx = rawST.getContext();
              return !!ctx && (prop as any) in (ctx as any);
            } catch (e) {
              return false;
            }
          },
        });
        logDebug_ACU('[CoreAPI] 插件模式：已用 Proxy 包装 SillyTavern API（每次读取都走 getContext()）');
      } else {
        // getContext 不存在，降级为直接使用 rawST（避免整个系统崩溃）
        stApi = rawST;
        logWarn_ACU('[CoreAPI] 插件模式：SillyTavern.getContext 不可用，降级为直接访问 SillyTavern 对象');
      }
    } else {
      // ═══════════════════════════════════════════════════════════════
      // 油猴脚本模式：运行在酒馆助手创建的 iframe 中。
      //
      // 关键事实：iframe 自身的 window.SillyTavern 是酒馆助手注入的
      // 扁平化 API 对象（包含 chatId/eventSource/eventTypes 等），
      // 而 window.parent（hostWin）上的 SillyTavern 只有
      // {libs, getContext} 骨架，不含业务字段。
      //
      // 因此必须优先使用 iframe 自身的对象，把 parent 作为 fallback。
      // 这与旧版 userscript 的行为一致：
      //   SillyTavern_API_ACU = typeof SillyTavern !== 'undefined'
      //     ? SillyTavern : parentWin.SillyTavern;
      // ═══════════════════════════════════════════════════════════════
      const iframeST = typeof (window as any).SillyTavern !== 'undefined' ? (window as any).SillyTavern : undefined;
      const parentST = typeof hostWin.SillyTavern !== 'undefined' ? hostWin.SillyTavern : undefined;
      // 优先使用 iframe 自身的扁平化 API（含 chatId 等业务字段），
      // fallback 到 parent 的骨架对象
      stApi = iframeST || parentST;
      if (iframeST) {
        logDebug_ACU('[CoreAPI] 油猴脚本模式：使用 iframe 自身的 SillyTavern 扁平 API');
      } else if (parentST) {
        logWarn_ACU('[CoreAPI] 油猴脚本模式：iframe 自身无 SillyTavern，降级使用 parent 的骨架对象（可能缺少 chatId 等字段）');
      }
    }

    _set_SillyTavern_API_ACU(stApi);
    // TavernHelper/jQuery/toastr 同理：优先 iframe 自身，fallback 到 parent
    const iframeTH = typeof (window as any).TavernHelper !== 'undefined' ? (window as any).TavernHelper : undefined;
    const parentTH = typeof hostWin.TavernHelper !== 'undefined' ? hostWin.TavernHelper : undefined;
    // 三级兼容适配：旧版扁平 API 透传 → 新版改名 API 映射 → SillyTavern 原生实现。
    // 覆盖三种宿主形态：油猴脚本 iframe（旧版全量）、插件+新版酒馆助手（改名/部分导出）、
    // 插件独立运行（无酒馆助手）。
    const tavernHelperCompat = buildTavernHelperCompat_ACU(iframeTH || parentTH, () => stApi);
    _set_TavernHelper_API_ACU(tavernHelperCompat.api);

    const iframe$ = typeof (window as any).$ !== 'undefined' ? (window as any).$ : undefined;
    const parent$ = typeof hostWin.$ !== 'undefined' ? hostWin.$ : undefined;
    _set_jQuery_API_ACU(iframe$ || parent$);

    _set_toastr_API_ACU((typeof (window as any).toastr !== 'undefined' ? (window as any).toastr : null) || hostWin.toastr || null);
    _set_coreApisAreReady_ACU(!!(
      SillyTavern_API_ACU &&
      TavernHelper_API_ACU &&
      jQuery_API_ACU &&
      TavernHelper_API_ACU.getChatMessages &&
      TavernHelper_API_ACU.getLastMessageId &&
      TavernHelper_API_ACU.getCurrentCharPrimaryLorebook &&
      TavernHelper_API_ACU.getLorebookEntries &&
      typeof TavernHelper_API_ACU.triggerSlash === 'function'
    ));
    if (!toastr_API_ACU) logWarn_ACU('toastr_API_ACU is MISSING.');
    if (coreApisAreReady_ACU) {
      logDebug_ACU('Core APIs successfully loaded/verified for AutoCardUpdater.');
    } else {
      // 逐项列出缺失能力（不依赖 Debug 开关，console.error 保证在运行日志中可见）
      const missingParts: string[] = [];
      if (!SillyTavern_API_ACU) missingParts.push('SillyTavern API');
      if (!jQuery_API_ACU) missingParts.push('jQuery');
      const th: any = TavernHelper_API_ACU;
      for (const method of ['getChatMessages', 'getLastMessageId', 'getCurrentCharPrimaryLorebook', 'getLorebookEntries', 'triggerSlash'] as const) {
        if (!th || typeof th[method] !== 'function') missingParts.push(`TavernHelper.${method}`);
      }
      const diagnostics = `缺失项: [${missingParts.join(', ')}]；宿主能力: ${formatHostCapabilities_ACU(tavernHelperCompat.capabilities)}`;
      logError_ACU(`Failed to load one or more critical APIs for AutoCardUpdater. ${diagnostics}`);
      console.error(`[龙血玄黄·数据库] 核心API加载失败。${diagnostics}`);
    }
    return coreApisAreReady_ACU;
  }

  let contentOptimizationEventEpoch_ACU = 0;

  /** 接收时捕获代次，防止尚未派发的旧通知在取消后重新建立优化任务。 */
  export function captureContentOptimizationEventScope_ACU(): () => boolean {
    const eventEpoch = contentOptimizationEventEpoch_ACU;
    return () => eventEpoch === contentOptimizationEventEpoch_ACU;
  }

  /** 取消防抖并使已经进入物化等待的旧事件失效；不取消已经发出的优化请求。 */
  export function cancelPendingContentOptimizationEvent_ACU(): void {
    ++contentOptimizationEventEpoch_ACU;
    clearTimeout(contentOptimizationDebounceTimer_ACU);
    _set_contentOptimizationDebounceTimer_ACU(null);
  }

  function hasActiveContentGeneration_ACU(): boolean {
    return generationGate_ACU.activeGenerations.some(context => !context.dryRun
      && !isQuietLikeGeneration_ACU(context.type, context.params)
      && !context.params?.automatic_trigger);
  }

  // 正文优化独立处理消息定位与物化；不参与自动填表派发。
  export async function handleContentOptimizationEvent_ACU(eventType = 'unknown_acu', intent?: AutoFillIntent_ACU) {
    const eventEpoch = contentOptimizationEventEpoch_ACU;
    const canProcessEvent = (): boolean => {
      const reason = eventEpoch !== contentOptimizationEventEpoch_ACU
        ? 'generation_changed'
        : hasActiveContentGeneration_ACU() ? 'generation_in_progress' : null;
      if (!reason) return true;
      logContentOptimizationSkip_ACU(reason, {
        eventType,
        eventMessageId: intent?.eventMessageId,
        chatKey: intent?.chatKey,
        isolationKey: intent?.isolationKey,
      });
      return false;
    };
    if (!canProcessEvent()) return;
    logDebug_ACU(
      `New message event (${eventType}) detected for ACU, debouncing for ${NEW_MESSAGE_DEBOUNCE_DELAY_ACU}ms...`,
    );
    clearTimeout(contentOptimizationDebounceTimer_ACU);
    _set_contentOptimizationDebounceTimer_ACU(setTimeout(async () => {
      if (!canProcessEvent()) return;
      _set_contentOptimizationDebounceTimer_ACU(null);
      const performanceSpan = startRuntimePerformanceSpan_ACU('new-message-pipeline', {
        settings: settings_ACU,
        metrics: { source: eventType },
      });
      try {
      // [健全性] 如果用户已经开始对话，则解除"开场白阶段世界书注入抑制"
      try { maybeLiftWorldbookSuppression_ACU(); } catch (e) {}

      // [触发修复] chatKey / isolationKey 校验：防抖期间切聊天或切隔离必须立即丢弃，不污染新会话。
      if (intent) {
        if (currentChatFileIdentifier_ACU !== intent.chatKey) {
          logContentOptimizationSkip_ACU('chat_changed', {
            eventType,
            eventMessageId: intent.eventMessageId,
            messageId: intent.eventMessageId,
            chatKey: intent.chatKey,
            isolationKey: intent.isolationKey,
            capturedChatLength: intent.capturedChatLength,
            capturedAiFloorCount: intent.capturedAiFloorCount,
          });
          return;
        }
        const liveIsolationKey = getCurrentIsolationKey_ACU();
        if (liveIsolationKey !== intent.isolationKey) {
          logContentOptimizationSkip_ACU('chat_changed', {
            eventType,
            eventMessageId: intent.eventMessageId,
            messageId: intent.eventMessageId,
            chatKey: intent.chatKey,
            isolationKey: intent.isolationKey,
            liveIsolationKey,
            capturedChatLength: intent.capturedChatLength,
            capturedAiFloorCount: intent.capturedAiFloorCount,
          });
          return;
        }
      }

      let liveChat = getChatArray_ACU();

      // [触发修复] 解析本轮 AI 楼层；pending 时进行有界物化等待。
      let resolvedMessageIndex: number | undefined;
      if (intent) {
        let resolution = resolveGeneratedAiMessageIndex_ACU({ liveChat, intent });
        let retries = 0;
        while (resolution.kind === 'pending_materialization' && retries < AI_MATERIALIZATION_MAX_RETRIES_ACU) {
          await new Promise(resolve => setTimeout(resolve, AI_MATERIALIZATION_RETRY_DELAY_MS_ACU));
          if (!canProcessEvent()) return;
          // 每次重试前校验 chatKey / isolationKey：等待中切聊天/切隔离立即终止。
          if (currentChatFileIdentifier_ACU !== intent.chatKey || getCurrentIsolationKey_ACU() !== intent.isolationKey) {
            logContentOptimizationSkip_ACU('chat_changed', {
              eventType,
              eventMessageId: intent.eventMessageId,
              messageId: intent.eventMessageId,
              chatKey: intent.chatKey,
              isolationKey: intent.isolationKey,
              capturedChatLength: intent.capturedChatLength,
              capturedAiFloorCount: intent.capturedAiFloorCount,
            });
            return;
          }
          liveChat = getChatArray_ACU();
          resolution = resolveGeneratedAiMessageIndex_ACU({ liveChat, intent });
          retries += 1;
        }

        if (resolution.kind === 'ambiguous') {
          logContentOptimizationSkip_ACU('ambiguous_generated_ai_message', {
            eventType,
            eventMessageId: intent.eventMessageId,
            messageId: intent.eventMessageId,
            chatKey: intent.chatKey,
            isolationKey: intent.isolationKey,
            capturedChatLength: intent.capturedChatLength,
            capturedAiFloorCount: intent.capturedAiFloorCount,
            liveChatLength: liveChat.length,
            liveAiFloorCount: liveChat.filter((message: any) => message && !message.is_user && message?.extra?.type !== 'narrator').length,
            candidateIndexes: resolution.candidates,
          });
          return;
        }
        if (resolution.kind === 'pending_materialization') {
          logContentOptimizationSkip_ACU('generated_ai_message_not_materialized', {
            eventType,
            eventMessageId: intent.eventMessageId,
            messageId: intent.eventMessageId,
            chatKey: intent.chatKey,
            isolationKey: intent.isolationKey,
            capturedChatLength: intent.capturedChatLength,
            capturedAiFloorCount: intent.capturedAiFloorCount,
            liveChatLength: liveChat.length,
            liveAiFloorCount: liveChat.filter((message: any) => message && !message.is_user && message?.extra?.type !== 'narrator').length,
          });
          return;
        }
        if (resolution.kind === 'invalid_intent') {
          logContentOptimizationSkip_ACU('message_evaluation_skipped', {
            eventType,
            eventMessageId: intent.eventMessageId,
            messageId: intent.eventMessageId,
            chatKey: intent.chatKey,
            isolationKey: intent.isolationKey,
          });
          return;
        }
        resolvedMessageIndex = resolution.messageIndex;
      }

      // [重构] 调用 service 层的 evaluateNewMessageAction_ACU 进行决策
      if (!canProcessEvent()) return;
      const result = evaluateNewMessageAction_ACU(
          liveChat,
          isAutoUpdatingCard_ACU,
          coreApisAreReady_ACU,
          wasStoppedByUser_ACU,
          settings_ACU.contentOptimizationSettings,
          resolvedMessageIndex,
      );

      logDebug_ACU(`[NewMessage] Evaluation result: action=${result.action}, reason=${result.reason}`);

      if (result.action === 'skip') {
          logDebug_ACU(`ACU: ${result.reason}. Skipping.`);
          logContentOptimizationSkip_ACU(result.skipReason || 'message_evaluation_skipped', {
              eventType,
              eventMessageId: intent?.eventMessageId,
              messageId: intent?.eventMessageId,
              aiFloorCount: liveChat.filter((message: any) => message && !message.is_user && message?.extra?.type !== 'narrator').length,
              inFlight: isAutoUpdatingCard_ACU,
          });
          return;
      }

      switch (result.action) {
          case 'optimize_parallel':
          case 'optimize_manual':
          case 'optimize_then_update':
              await executeContentOptimization_ACU(result.lastMessageIndex!);
              break;
          case 'update_only':
              break;
      }
      } catch (error) {
        logError_ACU('ACU 正文事件处理失败:', error);
      } finally {
        performanceSpan.end({ messageCount: getChatArray_ACU()?.length || 0 });
      }
    }, NEW_MESSAGE_DEBOUNCE_DELAY_ACU));
  }