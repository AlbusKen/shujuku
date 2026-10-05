/**
 * presentation/components/optimization-ui/optimization-ui-overlay.ts
 * 正文优化进度任务（原遮罩与进度 Toast）与正文替换
 */
import { DEFAULT_PLOT_SETTINGS_ACU } from '../../../shared/defaults-json.js';
import { activePlotEditorSettings_ACU, buildDefaultPlotPromptGroup_ACU, currentEditablePlotPresetState_ACU, currentPlotTaskEditorId_ACU, ensurePlotPromptGroup_ACU , _set_currentEditablePlotPresetState_ACU, _set_activePlotEditorSettings_ACU, _set_currentPlotTaskEditorId_ACU} from '../../../service/plot/plot-state';
import { showToastr_ACU } from '../../theme/toast';
import { getChatArray_ACU, saveChatToHost_ACU, setChatMessages_ACU, emitMessageUpdated_ACU } from '../../../service/chat/chat-service';
import { jQuery_API_ACU } from '../../dom-utils';
import { beginNoticeTask_ACU, type NoticeTaskHandle_ACU } from '../../../shared/notice-hub';
import { currentChatFileIdentifier_ACU, settings_ACU } from '../../../service/runtime/state-manager';
import { $popupInstance_ACU } from '../../state/ui-refs';
import { saveSettingsAndNotify_ACU } from '../settings-ui-helpers';
import { buildChatPlotScopeStateFromSettings_ACU, clearCurrentChatPlotScopeState_ACU, getCurrentChatPlotScopeState_ACU, sanitizePlotSettingsSnapshotForChat_ACU, setCurrentChatPlotScopeState_ACU } from '../../../service/template/chat-scope';
import { SCRIPT_ID_PREFIX_ACU } from '../../../shared/constants';
import { escapeHtml_ACU, renderStopButton_ACU } from '../../../shared/html-helpers';
import { cleanChatName_ACU, logDebug_ACU, logError_ACU, logWarn_ACU, normalizeExcludeRules_ACU, normalizeExtractRules_ACU, normalizeNonNegativeInteger_ACU, normalizePositiveInteger_ACU } from '../../../shared/utils';
import { cancelContentOptimization_ACU, contentOptimizationAbortRequested_ACU, ensureOptimizationNotCancelled_ACU, getLastOptimizationBase_ACU, optimizationProgressToast_ACU, performContentOptimization_ACU, setLastOptimizationBase_ACU, _set_optimizationProgressToast_ACU, _set_contentOptimizationAbortRequested_ACU } from '../../../service/optimization/content-optimization';
import { applyContextTagFilters_ACU } from '../../../service/runtime/helpers-remaining';
import { getActivePlotEditorSettings_ACU, getPlotPromptContentByIdFromSettings_ACU, setPlotPromptContentByIdForSettings_ACU } from '../../../service/plot/plot-logic';

  /**
   * 正文优化进度：原全屏遮罩与进度提示框合并为一个可取消的气泡任务。
   * 同一时刻只有一个正文优化任务；重复调用只更新进度文本。
   * @param {string} message - 提示消息
   */
  function showOptimizationTask_ACU(message: string) {
    const current = optimizationProgressToast_ACU as NoticeTaskHandle_ACU | null;
    if (current && !current.ended) {
      current.update(message);
      return;
    }
    const task = beginNoticeTask_ACU('正文优化', {
      detail: message,
      action: {
        label: '取消优化',
        variant: 'danger',
        run: () => {
          const cancelResult = cancelContentOptimization_ACU('正文优化已取消。');
          if (cancelResult.cancelled) showToastr_ACU('warning', cancelResult.reason);
          hideOptimizationProgressToast_ACU();
        },
      },
    });
    _set_optimizationProgressToast_ACU(task);
  }

  /** 无感替换模式的进度入口；遮罩已退役，与普通模式共用同一个气泡任务。 */
  export function showOptimizationOverlay_ACU(message = '正在优化正文...') {
    showOptimizationTask_ACU(message);
  }

  /**
   * 显示正文优化进度任务（非无感替换模式）
   * @param {string} message - 提示消息
   */
  export function showOptimizationProgressToast_ACU(message = '正在进行正文优化...') {
    showOptimizationTask_ACU(message);
  }

  /**
   * 结束正文优化进度任务
   */
  export function hideOptimizationProgressToast_ACU() {
    const current = optimizationProgressToast_ACU as NoticeTaskHandle_ACU | null;
    current?.end?.();
    _set_optimizationProgressToast_ACU(null);
  }

  /**
   * 结束正文优化进度任务（原无感替换遮罩入口）
   */
  export function hideOptimizationOverlay_ACU() {
    hideOptimizationProgressToast_ACU();
  }

  /**
   * 替换酒馆消息内容
   * @param {number} messageIndex - 消息索引
   * @param {string} newContent - 新内容
   */
