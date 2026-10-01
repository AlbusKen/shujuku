/**
 * service/runtime/plot-runtime/plot-entry.ts
 * 剧情推进 — 规划入口（runOptimizationLogic）
 * 从 helpers-plot-runtime.ts 拆出（L1401-L1512）
 */
import { DEFAULT_PLOT_SETTINGS_ACU } from '../../../shared/defaults-json.js';
import { abortController_ACU, loopState_ACU, planningGuard_ACU, settings_ACU, _set_abortController_ACU } from '../state-manager';
import { logDebug_ACU, logError_ACU } from '../../../shared/utils';
import { runPlotTasksRuntime_ACU } from './plot-task-engine';
import { capturePlotRuntimeScope_ACU, summarizePlotRuntimeError_ACU, summarizePlotRuntimeScope_ACU } from './plot-runtime-scope';
import { isFlightModeActive_ACU } from '../../flight-mode/flight-mode-state';
import { isPlotSuppressedByFillModeForCurrentChat_ACU } from '../../fill-mode/fill-mode-gate';
import { isLorebookReadAbortedError_ACU } from '../../../shared/lorebook-read-error';
import { isPlotStageError_ACU } from './plot-runtime-phase';

const PLOT_RUNTIME_BUILD_VERSION_ACU = (globalThis as any).__ACU_BUILD_VERSION__ || 'unknown';

/**
 * 精确取消判定：只认 AbortError / TaskAbortedByUser / 世界书读取取消分类，
 * 不再用 message.includes('aborted') 误伤普通错误；并对 null/undefined 拒绝值安全。
 */
function isTaskAbortedError_ACU(error: unknown): boolean {
  // PlotStageError 的 cause 已由 clearFinalGenerationGreenlights 透传安全摘要；
  // category='aborted' 必须恢复为取消语义，不伪装成普通预检失败。
  if (isPlotStageError_ACU(error)) {
    const cause = (error as { cause?: unknown }).cause;
    if (cause && typeof cause === 'object') {
      const category = (cause as { category?: unknown }).category;
      if (category === 'aborted') return true;
    }
    return false;
  }
  if (error && typeof error === 'object') {
    const name = (error as { name?: unknown }).name;
    if (name === 'AbortError') return true;
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message === 'TaskAbortedByUser') return true;
  }
  return isLorebookReadAbortedError_ACU(error);
}

  /**
   * 核心优化逻辑（纯 service 层：读数据→业务决策→写数据→构造返回值）。
   */
  export async function runOptimizationLogic_ACU(userMessage: any, options: any = {}) {
    const { originalUserInput, hasExistingUserMessage = false } = options;
    const inputForHash = originalUserInput || userMessage;
    const initialScope = capturePlotRuntimeScope_ACU();

    if (loopState_ACU.isRetrying) {
        logDebug_ACU('[剧情推进] 当前处于重试流程，跳过剧情规划逻辑。');
        return { success: false, skipped: true, reason: 'retrying' };
    }

    if ((runOptimizationLogic_ACU as any).__inFlight) {
      const inflightText = String((runOptimizationLogic_ACU as any).__inFlightText || '');
      const t = String(userMessage || '');
      if (t && inflightText && t === inflightText) {
        logDebug_ACU('[剧情推进] Duplicate planning call skipped (same text, in-flight).');
      } else {
        logDebug_ACU('[剧情推进] Planning skipped (another planning in-flight).');
      }
      return { success: false, skipped: true, reason: 'inflight' };
    }
    (runOptimizationLogic_ACU as any).__inFlight = true;
    (runOptimizationLogic_ACU as any).__inFlightText = String(userMessage || '');

    let originalUserInputForAbort_ACU = userMessage || '';
    try {
      planningGuard_ACU.inProgress = true;

      const currentSettings = settings_ACU.plotSettings || {};
      const plotSettings = {
        ...DEFAULT_PLOT_SETTINGS_ACU,
        ...currentSettings,
      };

      if (!plotSettings.enabled || isFlightModeActive_ACU()) {
        return { success: false, skipped: true, reason: 'disabled' };
      }
      // 向量表格模式只做向量召回，不触发剧情推进（所有调用入口的兜底门控）。
      if (isPlotSuppressedByFillModeForCurrentChat_ACU()) {
        return { success: false, skipped: true, reason: 'fill_mode_vector' };
      }

      _set_abortController_ACU(new AbortController());

      const runtimeResult = await runPlotTasksRuntime_ACU(plotSettings, userMessage, {
        inputForHash,
        hasExistingUserMessage,
      });

      if (!runtimeResult?.finalMessage) {
        if (runtimeResult?.abortedByStageFailure) {
          return {
            success: false,
            errorType: 'stage_failure',
            errorMessage: runtimeResult.errorMessage || `剧情任务阶段 ${runtimeResult.failedStage ?? '?'} 执行失败，后续阶段已停止。`,
            failedStage: runtimeResult.failedStage,
            enabledTaskCount: runtimeResult.enabledTaskCount,
            successCount: runtimeResult.successfulResults?.length ?? 0,
            failCount: runtimeResult.failedResults?.length ?? 0,
          };
        } else if (runtimeResult?.enabledTaskCount > 0) {
          return {
            success: false,
            errorType: 'all_failed',
            errorMessage: `共 ${runtimeResult.enabledTaskCount} 个剧情任务均未返回有效结果，操作已取消。`,
            enabledTaskCount: runtimeResult.enabledTaskCount,
          };
        } else {
          return {
            success: false,
            errorType: 'no_tasks',
            errorMessage: '当前没有可执行的剧情任务。',
            enabledTaskCount: 0,
          };
        }
      }

      const aggregatedTagNames = runtimeResult.aggregatedTags instanceof Map
        ? Array.from(runtimeResult.aggregatedTags.keys())
        : [];
      if (aggregatedTagNames.length > 0) {
        logDebug_ACU(`[剧情推进] 成功聚合标签: ${aggregatedTagNames.join(', ')}`);
      }

      return {
        success: true,
        finalMessage: runtimeResult.finalMessage,
        successCount: runtimeResult.successfulResults.length,
        failCount: runtimeResult.failedResults.length,
        enabledTaskCount: runtimeResult.enabledTaskCount,
        aggregatedTagNames,
        hasPartialFailure: runtimeResult.failedResults.length > 0,
      };
    } catch (error) {
      if (isTaskAbortedError_ACU(error)) {
          return { success: false, aborted: true, manual: true, restoreText: originalUserInputForAbort_ACU };
      }
      if (isPlotStageError_ACU(error) && error.phase === 'clear_final_generation_greenlights') {
        logError_ACU('[剧情推进] 世界书预检失败，本轮已停止。', {
          phase: error.phase,
          build: PLOT_RUNTIME_BUILD_VERSION_ACU,
          error: summarizePlotRuntimeError_ACU(error),
        });
        return {
          success: false,
          errorType: 'worldbook_preflight_failure',
          errorMessage: '剧情推进的世界书预检失败，请检查绑定/选择的世界书。',
        };
      }
      logError_ACU('[剧情推进] 在核心优化逻辑中发生错误:', {
        phase: 'top_level',
        build: PLOT_RUNTIME_BUILD_VERSION_ACU,
        initialScope: summarizePlotRuntimeScope_ACU(initialScope),
        errorScope: summarizePlotRuntimeScope_ACU(capturePlotRuntimeScope_ACU()),
        error: summarizePlotRuntimeError_ACU(error),
      });
      return {
        success: false,
        errorType: 'exception',
        errorMessage: '剧情规划大师在处理时发生错误。',
      };
    } finally {
        planningGuard_ACU.inProgress = false;
        _set_abortController_ACU(null);
        (runOptimizationLogic_ACU as any).__inFlight = false;
        (runOptimizationLogic_ACU as any).__inFlightText = '';
    }
  }
