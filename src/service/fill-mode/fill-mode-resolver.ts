/**
 * FillModeResolver：把当前对话的填表模式映射为行为与本次运行计划。
 * 纯函数，不读写存储；模式是唯一输入，飞行开关等经典方案内部数据不参与判定。
 */
import type { FillMode_ACU, FillModePreferences_ACU } from './fill-mode-preferences';

export type VectorPipelineKind_ACU = 'vector' | 'crossfire';

export interface FillModeBehavior_ACU {
  /** 模式允许剧情推进；实际运行还需 plotSettings.enabled。 */
  plotAllowed: boolean;
  vectorPipeline: VectorPipelineKind_ACU | null;
}

const FILL_MODE_BEHAVIORS_ACU: Readonly<Record<FillMode_ACU, Readonly<FillModeBehavior_ACU>>> = {
  classic: { plotAllowed: false, vectorPipeline: null },
  vector: { plotAllowed: false, vectorPipeline: 'vector' },
  llm: { plotAllowed: true, vectorPipeline: null },
  crossfire: { plotAllowed: true, vectorPipeline: 'crossfire' },
};

export function getFillModeBehavior_ACU(mode: FillMode_ACU): FillModeBehavior_ACU {
  return { ...FILL_MODE_BEHAVIORS_ACU[mode] };
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
  kind: VectorPipelineKind_ACU;
  /** 请求级覆写；null 表示沿用 vectorMemoryConfig 现值。 */
  overrides: VectorPipelineOverrides_ACU | null;
  /** true 时 rerank 未配置或失败必须 fail-closed，不得回退 embedding 排序。 */
  rerankRequired: boolean;
}

export interface ResolvedFillPlan_ACU {
  mode: FillMode_ACU;
  vectorPipeline: VectorPipelinePlan_ACU | null;
  /** 纪要已作为世界书常量条目注入时，续写需临时解除对纪要条目的屏蔽。 */
  unmaskChronicleEntriesForContinuation: boolean;
}

export function resolveFillPlan_ACU(preferences: FillModePreferences_ACU, mode: FillMode_ACU): ResolvedFillPlan_ACU {
  const kind = getFillModeBehavior_ACU(mode).vectorPipeline;
  let vectorPipeline: VectorPipelinePlan_ACU | null = null;
  if (kind === 'vector') {
    vectorPipeline = {
      kind,
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
  } else if (kind === 'crossfire') {
    vectorPipeline = { kind, overrides: null, rerankRequired: false };
  }
  return {
    mode,
    vectorPipeline,
    // 经典模式的纪要表与大总结以世界书常驻条目注入，续写沿用默认屏蔽（纪要索引仍屏蔽）；只有向量表格模式解除屏蔽。
    unmaskChronicleEntriesForContinuation: mode === 'vector',
  };
}
