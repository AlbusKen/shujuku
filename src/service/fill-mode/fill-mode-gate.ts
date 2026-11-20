/**
 * 填表模式运行时门控：剧情推进与向量/交火管线是否运行，统一只按当前对话的模式判定。
 * 模式来自 fill-mode-chat-record（对话记录为唯一权威；无记录时按过渡规则推导）。
 * 飞行开关只是经典方案的内部数据，不参与这里的判定。
 */
import { logWarn_ACU } from '../../shared/utils';
import { settings_ACU } from '../runtime/state-manager';
import {
  resolveCurrentChatFillMode_ACU,
  type ChatFillModeRecordStatus_ACU,
  type ChatFillModeSource_ACU,
} from './fill-mode-chat-record';
import type { FillMode_ACU } from './fill-mode-preferences';
import {
  getFillModeBehavior_ACU,
  resolveFillPlan_ACU,
  type FillModeBehavior_ACU,
  type ResolvedFillPlan_ACU,
  type VectorPipelinePlan_ACU,
} from './fill-mode-resolver';

export interface CurrentChatFillModeBehavior_ACU extends FillModeBehavior_ACU {
  mode: FillMode_ACU;
  source: ChatFillModeSource_ACU;
  recordStatus: ChatFillModeRecordStatus_ACU;
}

export function getCurrentChatFillModeBehavior_ACU(): CurrentChatFillModeBehavior_ACU {
  const current = resolveCurrentChatFillMode_ACU();
  return {
    ...getFillModeBehavior_ACU(current.mode),
    mode: current.mode,
    source: current.source,
    recordStatus: current.recordStatus,
  };
}

export type PlotPermissionReason_ACU = 'allowed' | 'fill_mode_no_plot' | 'plot_disabled';

export interface PlotPermission_ACU {
  allowed: boolean;
  reason: PlotPermissionReason_ACU;
  /** 推导失败时为 null。 */
  behavior: CurrentChatFillModeBehavior_ACU | null;
}

/**
 * 剧情推进许可：模式允许（llm / crossfire）且 plotSettings.enabled。
 * 模式推导失败时 fail-closed（不推进剧情）并记录诊断。
 */
export function evaluatePlotPermissionForCurrentChat_ACU(): PlotPermission_ACU {
  let behavior: CurrentChatFillModeBehavior_ACU;
  try {
    behavior = getCurrentChatFillModeBehavior_ACU();
  } catch (error) {
    logWarn_ACU('[填表模式] 剧情推进门控推导失败，本轮不推进剧情:', error);
    return { allowed: false, reason: 'fill_mode_no_plot', behavior: null };
  }
  if (!behavior.plotAllowed) return { allowed: false, reason: 'fill_mode_no_plot', behavior };
  if (!settings_ACU?.plotSettings?.enabled) return { allowed: false, reason: 'plot_disabled', behavior };
  return { allowed: true, reason: 'allowed', behavior };
}

export function isPlotAllowedForCurrentChat_ACU(): boolean {
  return evaluatePlotPermissionForCurrentChat_ACU().allowed;
}

/** 当前对话是否运行向量管线（向量表格或交火）。推导失败时不运行并记录诊断。 */
export function isVectorPipelineEnabledForCurrentChat_ACU(): boolean {
  try {
    return getCurrentChatFillModeBehavior_ACU().vectorPipeline !== null;
  } catch (error) {
    logWarn_ACU('[填表模式] 向量管线门控推导失败，未启用向量管线:', error);
    return false;
  }
}

/** 按当前对话冻结一份运行计划；调用方应在单次请求内复用同一计划。 */
export function resolveFillPlanForCurrentChat_ACU(): ResolvedFillPlan_ACU {
  const current = resolveCurrentChatFillMode_ACU();
  return resolveFillPlan_ACU(current.preferences.preferences, current.mode);
}

/**
 * 向量管线的请求级计划：向量表格返回带覆写的计划，交火返回沿用 vectorMemoryConfig 的计划，
 * 经典与 LLM 返回 null。
 */
export function getVectorPipelinePlanForCurrentChat_ACU(): VectorPipelinePlan_ACU | null {
  return resolveFillPlanForCurrentChat_ACU().vectorPipeline;
}
