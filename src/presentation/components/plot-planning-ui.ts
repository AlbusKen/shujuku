/**
 * presentation/components/plot-planning-ui.ts — 剧情规划 UI 层封装
 * 负责：规划进度任务（含中止）、根据 service 层结果弹通知
 */
import { showToastr_ACU } from '../theme/toast';
import { beginNoticeTask_ACU } from '../../shared/notice-hub';
import { abortController_ACU, _set_isProcessing_Plot_ACU } from '../../service/runtime/state-manager';
import { ACU_TOAST_CATEGORY_ACU } from '../../shared/constants';
import { runOptimizationLogic_ACU } from '../../service/runtime/helpers-remaining';
import { logDebug_ACU } from '../../shared/utils';

/**
 * 在 presentation 层调用 runOptimizationLogic_ACU 并处理所有 UI 反馈。
 * 返回值与原 runOptimizationLogic_ACU 兼容：
 *   - string: 规划成功的最终消息
 *   - null: 规划失败/跳过/未启用
 *   - { skipped: true }: 重复触发被跳过
 *   - { aborted: true, manual: true, restoreText: string }: 用户中止
 */
export async function runOptimizationLogicWithUI_ACU(userMessage: any, options: any = {}) {
  // 1. 登记带中止按钮的规划任务；中止只作用于本次规划
  const task = beginNoticeTask_ACU('剧情规划', {
    detail: '正在读取过往的记忆并分析，请稍后...',
    action: {
      label: '终止',
      variant: 'danger',
      run: () => {
        logDebug_ACU('[剧情推进] 用户点击了中止按钮。');
        if (abortController_ACU) {
          abortController_ACU.abort();
          logDebug_ACU('[剧情推进] 用户手动中止了规划任务。');
        }
        _set_isProcessing_Plot_ACU(false);
        task.end({ kind: 'info', text: '规划任务已被用户中止。' });
      },
    },
  });

  // 2. 调用 service 层纯函数
  let result: Awaited<ReturnType<typeof runOptimizationLogic_ACU>>;
  try {
    result = await runOptimizationLogic_ACU(userMessage, options);
  } finally {
    // 3. 结束进度任务
    task.end();
  }

  // 4. 根据结果做 UI 通知
  if (!result) {
    return null;
  }

  // 跳过的情况（retrying / inflight / disabled）—— 不弹 toast，静默返回
  if (result.skipped) {
    return result.reason === 'inflight' ? { skipped: true } : null;
  }

  // 用户中止
  if (result.aborted) {
    return { aborted: true, manual: result.manual, restoreText: result.restoreText };
  }

  // 失败：根据 errorType 弹对应 toast
  if (!result.success) {
    const errorMsg = result.errorMessage || '剧情规划失败。';
    if (result.errorType === 'stage_failure' || result.errorType === 'all_failed' || result.errorType === 'no_tasks') {
      showToastr_ACU('error', errorMsg, '规划失败', {
        acuToastCategory: ACU_TOAST_CATEGORY_ACU.ERROR,
      });
    } else if (result.errorType === 'exception') {
      showToastr_ACU('error', errorMsg, '规划失败', {
        acuToastCategory: ACU_TOAST_CATEGORY_ACU.ERROR,
      });
    }
    return null;
  }

  // 成功：弹结果 toast
  if (result.aggregatedTagNames && result.aggregatedTagNames.length > 0) {
    showToastr_ACU('info', `已成功聚合 [${result.aggregatedTagNames.join(', ')}] 标签内容并注入。`, '标签摘取');
  }

  if (result.hasPartialFailure) {
    showToastr_ACU(
      'warning',
      `剧情规划完成，${result.successCount}/${result.enabledTaskCount} 个任务成功。`,
      '部分成功',
      { acuToastCategory: ACU_TOAST_CATEGORY_ACU.PLAN_OK },
    );
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
