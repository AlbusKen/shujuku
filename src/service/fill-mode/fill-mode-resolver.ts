/**
 * FillModeResolver：把用户选择的填表模式与当前聊天状态解析为本次运行计划。
 * 纯函数，不读写存储；调用方在请求开始时冻结输入，避免 UI 修改与运行时读取之间的 TOCTOU。
 */
import type { FillMode_ACU, FillModePreferences_ACU } from './fill-mode-preferences';

export interface FillRuntimeContext_ACU {
  /** 当前聊天已启用飞行模式（经典表格）。 */
  flightModeActive: boolean;
  /** 当前聊天已有用户表格数据；新对话为 false。 */
  hasExistingTableData: boolean;
  /** 旧交火全局开关，仅用于推导旧对话的临时默认方案。 */
  legacyCrossfireEnabled: boolean;
}

export interface VectorPipelineOverrides_ACU {
  keywordGenerationEnabled: false;
  hybridRetrievalEnabled: false;
  recentFixedInjectCount: 0;
  /** 保留相关纪要条数，同时作为触发门槛（纪要行数不足时不召回）。以下字段均为向量表格独立参数，不读取交火的同名配置。 */
  topK: number;
  minScore: number;
  candidateLimit: number;
}

export interface VectorPipelinePlan_ACU {
  kind: 'vector' | 'crossfire';
  /** 请求级覆写；null 表示沿用 vectorMemoryConfig 现值。 */
  overrides: VectorPipelineOverrides_ACU | null;
  /** true 时 rerank 未配置或失败必须 fail-closed，不得回退 embedding 排序。 */
  rerankRequired: boolean;
}

export interface ResolvedFillPlan_ACU {
  selectedMode: FillMode_ACU;
  effectiveMode: FillMode_ACU;
  /** 旧对话按旧默认方案临时运行：不落盘、不改写模板。 */
  temporaryLegacyMode: boolean;
  /** 新对话需要自动启用飞行模式。 */
  autoEnableFlightMode: boolean;
  recentChronicleRows: number;
  vectorPipeline: VectorPipelinePlan_ACU | null;
  /** 纪要已作为世界书常量条目注入时，续写需临时解除对纪要条目的屏蔽。 */
  unmaskChronicleEntriesForContinuation: boolean;
}

function resolveEffectiveMode_ACU(
  preferences: FillModePreferences_ACU,
  runtime: FillRuntimeContext_ACU,
): { mode: FillMode_ACU; temporary: boolean; autoEnable: boolean } {
  if (preferences.selectedMode !== 'classic' || runtime.flightModeActive) {
    return { mode: preferences.selectedMode, temporary: false, autoEnable: false };
  }
  if (!runtime.hasExistingTableData) return { mode: 'classic', temporary: false, autoEnable: true };
  return { mode: runtime.legacyCrossfireEnabled ? 'crossfire' : 'llm', temporary: true, autoEnable: false };
}

export function resolveFillPlan_ACU(
  preferences: FillModePreferences_ACU,
  runtime: FillRuntimeContext_ACU,
): ResolvedFillPlan_ACU {
  const effective = resolveEffectiveMode_ACU(preferences, runtime);
  let vectorPipeline: VectorPipelinePlan_ACU | null = null;
  if (effective.mode === 'vector') {
    vectorPipeline = {
      kind: 'vector',
      overrides: {
        keywordGenerationEnabled: false,
        hybridRetrievalEnabled: false,
        recentFixedInjectCount: 0,
        topK: preferences.vector.resultCount,
        minScore: preferences.vector.minScore,
        candidateLimit: Math.max(preferences.vector.candidateLimit, preferences.vector.resultCount),
      },
      rerankRequired: true,
    };
  } else if (effective.mode === 'crossfire') {
    vectorPipeline = { kind: 'crossfire', overrides: null, rerankRequired: false };
  }
  return {
    selectedMode: preferences.selectedMode,
    effectiveMode: effective.mode,
    temporaryLegacyMode: effective.temporary,
    autoEnableFlightMode: effective.autoEnable,
    recentChronicleRows: preferences.classic.recentChronicleRows,
    vectorPipeline,
    // 经典模式的纪要表与大总结以世界书常驻条目注入，续写沿用默认屏蔽（纪要索引仍屏蔽）；只有向量表格模式解除屏蔽。
    unmaskChronicleEntriesForContinuation: effective.mode === 'vector',
  };
}
