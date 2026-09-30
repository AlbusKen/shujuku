/**
 * 填表模式运行时门控：所有“是否运行向量/交火管线”的判定统一经由这里推导。
 * 旧交火全局开关 summaryVectorIndexModeGlobal 不再被覆写，只作为旧对话临时默认方案的输入。
 */
import { logWarn_ACU } from '../../shared/utils';
import { currentJsonTableData_ACU } from '../runtime/state-manager';
import { getCurrentFlightModeState_ACU } from '../flight-mode/flight-mode-state';
import { isLegacyCrossfireEnabled_ACU, readFillModePreferences_ACU } from './fill-mode-preferences';
import {
  resolveFillPlan_ACU,
  type FillRuntimeContext_ACU,
  type ResolvedFillPlan_ACU,
  type VectorPipelinePlan_ACU,
} from './fill-mode-resolver';

/**
 * 当前聊天是否已有用户表格数据。运行时表格尚未加载（null）属于“状态未知”，
 * 按已有数据处理：宁可沿用旧方案，也不把旧对话误判为新对话去改写模板。
 */
export function hasExistingTableDataForCurrentChat_ACU(tableData: any = currentJsonTableData_ACU): boolean {
  if (!tableData || typeof tableData !== 'object') return true;
  return Object.entries(tableData).some(([key, sheet]: [string, any]) =>
    key.startsWith('sheet_') && Array.isArray(sheet?.content) && sheet.content.length > 1);
}

export function buildFillRuntimeContext_ACU(): FillRuntimeContext_ACU {
  return {
    flightModeActive: getCurrentFlightModeState_ACU().enabled === true,
    hasExistingTableData: hasExistingTableDataForCurrentChat_ACU(),
    legacyCrossfireEnabled: isLegacyCrossfireEnabled_ACU(),
  };
}

/** 按当前聊天冻结一份运行计划；调用方应在单次请求内复用同一计划。 */
export function resolveFillPlanForCurrentChat_ACU(): ResolvedFillPlan_ACU {
  const { preferences } = readFillModePreferences_ACU();
  return resolveFillPlan_ACU(preferences, buildFillRuntimeContext_ACU());
}

/**
 * 向量管线的请求级计划。只有显式选择向量表格时才返回覆写；
 * 交火、经典（旧对话临时交火）与未保存模式均返回 null，沿用 vectorMemoryConfig 现值。
 * 向量/交火的计划与聊天运行时状态无关，因此不读取表格数据。
 */
export function getVectorPipelinePlanForCurrentChat_ACU(): VectorPipelinePlan_ACU | null {
  const { preferences, source } = readFillModePreferences_ACU();
  if (source === 'default' || preferences.selectedMode !== 'vector') return null;
  return resolveFillPlan_ACU(preferences, {
    flightModeActive: false,
    hasExistingTableData: true,
    legacyCrossfireEnabled: false,
  }).vectorPipeline;
}

/**
 * 当前聊天是否运行向量管线（向量表格或交火）。
 * 推导失败时回退旧交火开关并记录诊断，保持升级前行为，不静默关闭已有交火。
 */
export function isVectorPipelineEnabledForCurrentChat_ACU(): boolean {
  const { preferences, source } = readFillModePreferences_ACU();
  // 从未保存过填表模式：完全沿用旧交火开关，不读取运行时状态，保证升级前后行为一致。
  if (source === 'default') return isLegacyCrossfireEnabled_ACU();
  if (preferences.selectedMode === 'vector' || preferences.selectedMode === 'crossfire') return true;
  if (preferences.selectedMode === 'llm') return false;
  const legacy = isLegacyCrossfireEnabled_ACU();
  if (!legacy) return false;
  try {
    return resolveFillPlan_ACU(preferences, buildFillRuntimeContext_ACU()).vectorPipeline !== null;
  } catch (error) {
    logWarn_ACU('[填表模式] 运行时门控推导失败，回退旧交火开关:', error);
    return legacy;
  }
}
