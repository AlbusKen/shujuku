/**
 * presentation/components/summary-vector-index-ui.ts — 交火模式纪要索引 UI 层封装
 *
 * 负责：交火发送前召回过程的进度任务与结果提示。
 * 不负责：关键词生成、向量召回、rerank、世界书覆盖等业务逻辑。
 */
import { ACU_TOAST_CATEGORY_ACU } from '../../shared/constants';
import { logDebug_ACU } from '../../shared/utils';
import { beginNoticeTask_ACU } from '../../shared/notice-hub';
import { processSummaryVectorIndexBeforeGeneration_ACU, type SummaryVectorIndexRuntimeResult_ACU } from '../../service/vector/summary-vector-index-runtime';
import { useToastStore } from '../../presentation-v2/stores/toast-store';
import { rebuildCurrentSummaryVectorIndexNow_ACU } from '../../service/vector/summary-vector-index-rebuild-service';
import { isSummaryVectorIndexSourceTextOutdated_ACU, type SummaryVectorIndexArchiveResult_ACU } from '../../service/vector/summary-vector-index-archive-service';
import { getLatestSummaryVectorIndexSnapshotState_ACU } from '../../service/vector/summary-vector-index-state-service';
import { validateSummaryVectorIndexConfig_ACU } from '../../service/vector/vector-memory-config';
import { isVectorPipelineEnabledForCurrentChat_ACU } from '../../service/fill-mode/fill-mode-gate';
import { showToastr_ACU } from '../theme/toast';

const SUMMARY_VECTOR_REBUILD_REQUIRED_REASONS_ACU = new Set([
  'legacy_vector_scheme_rebuild_required',
  'embedding_identity_changed_rebuild_required',
]);

const SUMMARY_VECTOR_SCHEME_REBUILD_CONFIRM_ACU = '向量方案已优化，需要重建';
const SUMMARY_VECTOR_INDEX_FEATURE_ACU = '交火索引';
const SUMMARY_VECTOR_RECALL_FEATURE_ACU = '交火召回';

function shouldShowSummaryVectorResultToast_ACU(result: SummaryVectorIndexRuntimeResult_ACU): boolean {
  if (!result || result.skipped) return false;
  return result.success === true && Number(result.injectedCount || 0) > 0;
}

function shouldNotifySummaryVectorRecallFailure_ACU(result: SummaryVectorIndexRuntimeResult_ACU): boolean {
  return !!result && result.success === false && result.skipped !== true;
}

function notifySummaryVectorRecallFailure_ACU(result: SummaryVectorIndexRuntimeResult_ACU): void {
  const reason = String(result?.reason || 'unknown');
  const detail = String(result?.error || '').trim();
  const isVectorTable = result?.mode === 'vector';
  const title = isVectorTable ? '向量表格记忆召回失败' : '交火记忆召回失败';
  const recovery = isVectorTable ? '已撤回本轮纪要蓝灯' : '已恢复纪要索引全量概览';
  const text = detail
    ? `${title}（${reason}）：${detail}。${recovery}。请检查 Embedding / Rerank 接口、额度与模型配置。`
    : `${title}（${reason}）。${recovery}。请检查 Embedding / Rerank 接口、额度与模型配置。`;
  try {
    useToastStore().error(text, { muteable: false });
    return;
  } catch {
    showToastr_ACU('error', text);
  }
}

function showSummaryVectorRecallSuccessToast_ACU(result: SummaryVectorIndexRuntimeResult_ACU, rebuilt = false): void {
  const count = result.injectedCount || 0;
  const text = result.mode === 'vector'
    ? `${rebuilt ? '向量索引已重建并完成召回' : '向量记忆召回完成'}，已将 ${count} 条纪要切为蓝灯。`
    : `${rebuilt ? '交火索引已重建并完成召回' : '交火记忆召回完成'}，已覆盖纪要索引 ${count} 条。`;
  showToastr_ACU('success', text, result.mode === 'vector' ? '向量召回完成' : '交火召回完成', {
    acuToastCategory: ACU_TOAST_CATEGORY_ACU.PLAN_OK,
  });
}

export function shouldRebuildSummaryVectorIndexWithUI_ACU(reason: string | undefined): boolean {
  return SUMMARY_VECTOR_REBUILD_REQUIRED_REASONS_ACU.has(String(reason || ''));
}

/** 复用“立即构建交火纪要索引”的普通业务链路，并登记进度任务。 */
export async function rebuildCurrentSummaryVectorIndexWithUI_ACU(): Promise<SummaryVectorIndexArchiveResult_ACU> {
  const task = beginNoticeTask_ACU(SUMMARY_VECTOR_INDEX_FEATURE_ACU, { detail: '正在重建交火索引快照...' });
  try {
    const result = await rebuildCurrentSummaryVectorIndexNow_ACU();
    if (result.success && !result.skipped) {
      showToastr_ACU(
        'success',
        `交火索引快照重建完成：${result.indexedRowCount || 0} 行，${result.chunkCount || 0} 个 chunks。`,
        { acuToastCategory: ACU_TOAST_CATEGORY_ACU.PLAN_OK },
      );
      return result;
    }
    const reason = result.errors?.length
      ? result.errors.join('；')
      : (result.reason || '无可重建内容');
    showToastr_ACU(result.success ? 'info' : 'error', `交火索引快照未完成：${reason}`);
    return result;
  } catch (error: any) {
    showToastr_ACU('error', `交火索引快照重建失败：${error?.message || '未知错误'}`);
    throw error;
  } finally {
    task.end();
  }
}

let backgroundSourceTextRebuildInFlight_ACU = false;

/**
 * 聊天加载时检查当前索引是否还是旧源文本格式（spv9.2 之前只 embedding 概览）。
 * 是则在后台静默重建，避免用户更新后第一次发送被全量 embedding 阻塞几十秒。
 * 发送时的自愈重建仍保留作为兜底（用户在重建完成前就发送时会走那条路径）。
 *
 * @returns 是否触发了后台重建
 */
export async function rebuildOutdatedSummaryVectorIndexInBackground_ACU(): Promise<boolean> {
  if (backgroundSourceTextRebuildInFlight_ACU) return false;
  if (!isVectorPipelineEnabledForCurrentChat_ACU()) return false;
  const snapshot = getLatestSummaryVectorIndexSnapshotState_ACU();
  const state = snapshot?.summaryVectorIndexState || null;
  if (!state || !isSummaryVectorIndexSourceTextOutdated_ACU(state)) return false;
  if (!validateSummaryVectorIndexConfig_ACU().valid) {
    logDebug_ACU('[交火模式纪要索引] 发现旧源文本格式索引，但向量配置无效，跳过后台重建。');
    return false;
  }

  backgroundSourceTextRebuildInFlight_ACU = true;
  const rowCount = Array.isArray(state.rows) ? state.rows.filter(row => row?.status !== 'removed').length : 0;
  const task = beginNoticeTask_ACU(SUMMARY_VECTOR_INDEX_FEATURE_ACU, {
    detail: `交火索引源文本已升级为"概览 + 纪要正文"，正在后台重建当前聊天的索引（${rowCount} 行）…`,
  });
  try {
    const result = await rebuildCurrentSummaryVectorIndexNow_ACU();
    if (result.success && !result.skipped) {
      showToastr_ACU('success', `交火索引已按新源文本重建：${result.indexedRowCount || 0} 行，${result.chunkCount || 0} 个 chunks。`, '交火索引升级完成', {
        acuToastCategory: ACU_TOAST_CATEGORY_ACU.PLAN_OK,
      });
    } else {
      const reason = result.errors?.length ? result.errors.join('；') : (result.reason || '无可重建内容');
      logDebug_ACU(`[交火模式纪要索引] 旧源文本索引后台重建未完成：${reason}`);
    }
    return true;
  } catch (error) {
    logDebug_ACU(`[交火模式纪要索引] 旧源文本索引后台重建失败，发送时将走自愈重建兜底：${error instanceof Error ? error.message : String(error)}`);
    return true;
  } finally {
    task.end();
    backgroundSourceTextRebuildInFlight_ACU = false;
  }
}

/**
 * 包装交火发送前处理，登记“正在召回记忆”进度任务。
 */
export async function processSummaryVectorIndexBeforeGenerationWithUI_ACU(
  options: { userInput?: string; source?: string } = {},
): Promise<SummaryVectorIndexRuntimeResult_ACU> {
  const task = beginNoticeTask_ACU(SUMMARY_VECTOR_RECALL_FEATURE_ACU, {
    detail: '正在召回交火记忆并重排纪要索引，请稍后...',
  });

  let result: SummaryVectorIndexRuntimeResult_ACU;
  try {
    result = await processSummaryVectorIndexBeforeGeneration_ACU(options);
    if (shouldShowSummaryVectorResultToast_ACU(result)) {
      showSummaryVectorRecallSuccessToast_ACU(result);
    } else if (shouldNotifySummaryVectorRecallFailure_ACU(result)) {
      notifySummaryVectorRecallFailure_ACU(result);
    } else {
      logDebug_ACU(`[交火模式纪要索引] UI 包装完成：success=${result?.success === true}, skipped=${result?.skipped === true}, reason=${result?.reason || 'none'}`);
    }
  } finally {
    task.end();
  }

  if (shouldRebuildSummaryVectorIndexWithUI_ACU(result.reason)) {
    const confirmed = typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm(SUMMARY_VECTOR_SCHEME_REBUILD_CONFIRM_ACU)
      : true;
    if (!confirmed) return result;
    let rebuilt = false;
    try {
      const rebuildResult = await rebuildCurrentSummaryVectorIndexWithUI_ACU();
      rebuilt = rebuildResult.success && !rebuildResult.skipped;
    } catch (error) {
      logDebug_ACU(`[交火模式纪要索引] 失效索引已删除，但普通重建路径执行失败；继续原始生成：${error instanceof Error ? error.message : String(error)}`);
    }
    // 重建成功后在同一次发送里补跑一次召回，否则这一轮目录沿用上一轮的内容。
    if (rebuilt) {
      try {
        const retried = await processSummaryVectorIndexBeforeGeneration_ACU({ ...options, bypassDedupe: true });
        logDebug_ACU(`[交火模式纪要索引] 自愈重建后补跑召回：success=${retried.success}, skipped=${retried.skipped === true}, reason=${retried.reason || 'none'}, injected=${retried.injectedCount ?? 0}`);
        if (shouldShowSummaryVectorResultToast_ACU(retried)) {
          showSummaryVectorRecallSuccessToast_ACU(retried, true);
        } else if (shouldNotifySummaryVectorRecallFailure_ACU(retried)) {
          notifySummaryVectorRecallFailure_ACU(retried);
        }
        return retried;
      } catch (error) {
        logDebug_ACU(`[交火模式纪要索引] 自愈重建后补跑召回失败；继续原始生成：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return result;
}
