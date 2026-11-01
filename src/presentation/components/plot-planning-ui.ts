/**
 * presentation/components/plot-planning-ui.ts — 剧情规划 UI 层封装
 * 负责：规划进度任务（含中止）、根据 service 层结果弹通知
 */
import { showToastr_ACU } from '../theme/toast';
import { beginNoticeTask_ACU } from '../../shared/notice-hub';
import { abortController_ACU } from '../../service/runtime/state-manager';
import { ACU_TOAST_CATEGORY_ACU } from '../../shared/constants';
import { runOptimizationLogic_ACU } from '../../service/runtime/helpers-remaining';
import { logDebug_ACU } from '../../shared/utils';

type PlotPlanningAbortSource_ACU = 'task_action' | 'host_stop' | 'takeover_paused';

let abortActivePlanning_ACU: ((source: PlotPlanningAbortSource_ACU) => void) | null = null;

/** 与规划任务的「终止」按钮相同，只中止进行中的这次规划；source 记录中止来源（宿主停止键或接管暂停）。没有进行中的规划时返回 false。 */
export function abortActivePlotPlanning_ACU(source: Exclude<PlotPlanningAbortSource_ACU, 'task_action'> = 'host_stop'): boolean {
  if (!abortActivePlanning_ACU) return false;
  abortActivePlanning_ACU(source);
  return true;
}

/**
 * 在 presentation 层调用 runOptimizationLogic_ACU 并处理所有 UI 反馈。
 * 返回值与原 runOptimizationLogic_ACU 兼容：
 *   - string: 规划成功的最终消息
 *   - { blocked: true, apiRetriesExhausted?: boolean }: 任务失败，停止正文发送
 *   - { skipped: true, reason: string }: 未执行规划，保留不适用与忙碌的区别
 *   - { aborted: true, manual: true, restoreText: string }: 用户中止
 */
export async function runOptimizationLogicWithUI_ACU(userMessage: any, options: any = {}) {
  let manuallyAborted = false;
  let finished = false;
  const abort = (source: PlotPlanningAbortSource_ACU) => {
    if (manuallyAborted || finished) return;
    manuallyAborted = true;
    logDebug_ACU('[剧情推进] 收到规划中止请求。', { source });
    if (abortController_ACU) {
      abortController_ACU.abort();
    }
    task.end({ kind: 'info', text: '规划任务已中止。' });
  };
  // 1. 登记带中止按钮的规划任务；中止只作用于本次规划
  const task = beginNoticeTask_ACU('剧情规划', {
    detail: '正在读取过往的记忆并分析，请稍后...',
    action: { label: '终止', variant: 'danger', run: () => abort('task_action') },
  });
  abortActivePlanning_ACU = abort;

  // 2. 调用 service 层纯函数
  let result: Awaited<ReturnType<typeof runOptimizationLogic_ACU>>;
  try {
    result = await runOptimizationLogic_ACU(userMessage, {
      ...options,
      reportWarning: (text: string) => showToastr_ACU('warning', text, '剧情推进'),
    });
  } catch {
    if (manuallyAborted) {
      return { aborted: true, manual: true, restoreText: String(userMessage || '') };
    }
    showToastr_ACU('error', '剧情任务处理异常，正文发送已停止。', '剧情推进');
    return { blocked: true };
  } finally {
    // 3. 结束进度任务
    finished = true;
    task.end();
    if (abortActivePlanning_ACU === abort) abortActivePlanning_ACU = null;
  }

  // 4. 根据结果做 UI 通知
  if (manuallyAborted) return { aborted: true, manual: true, restoreText: String(userMessage || '') };
  if (!result) {
    return { blocked: true };
  }

  // 跳过的情况（retrying / inflight / disabled）—— 不弹 toast，静默返回
  if (result.skipped) {
    return { skipped: true, reason: result.reason };
  }

  // 用户中止
  if (result.aborted) {
    return { aborted: true, manual: result.manual, restoreText: result.restoreText };
  }

  // 任务失败统一阻断正文，等待外观不改变发送资格。
  if (!result.success) {
    if (result.errorType === 'no_tasks') return { skipped: true, reason: 'no_tasks' };
    const errorMsg = result.errorMessage || '剧情任务未返回有效结果，正文发送已停止。';
    showToastr_ACU('error', errorMsg, '规划失败', { acuToastCategory: ACU_TOAST_CATEGORY_ACU.ERROR });
    return { blocked: true, apiRetriesExhausted: result.apiRetriesExhausted === true };
  }

  // 成功：弹结果 toast
  if (result.aggregatedTagNames && result.aggregatedTagNames.length > 0) {
    showToastr_ACU('info', `已成功聚合 [${result.aggregatedTagNames.join(', ')}] 标签内容并注入。`, '标签摘取');
  }

  if (result.hasPartialFailure) {
    showToastr_ACU('error', '剧情任务未全部通过验收，正文发送已停止。', '规划失败');
    return { blocked: true };
  } else {
    showToastr_ACU(
      'success',
      `剧情规划成功，共完成 ${result.successCount} 个任务。`,
      '规划成功',
      { acuToastCategory: ACU_TOAST_CATEGORY_ACU.PLAN_OK },
    );
  }

  return result.finalMessage;
}
