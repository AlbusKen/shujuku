/**
 * service/preview/prompt-preview-types.ts — 提示词查看器（只读预览）公共契约
 *
 * 预览服务零副作用：不真发请求、不进入 callCustomOpenAI_ACU 的接管/中止控制器
 * 全局副作用，不触碰任何写路径。这里只定义对外形状与结构化错误。
 */

/** 与预览互斥的功能开关；feature 为稳定标识，reason 为面向用户的中文说明。 */
export interface PromptPreviewBlocker_ACU {
  feature: string;
  reason: string;
}

export interface PromptPreviewScenarioGate_ACU {
  available: boolean;
  blockers: PromptPreviewBlocker_ACU[];
}

export interface PromptPreviewGateResult_ACU {
  tableFill: PromptPreviewScenarioGate_ACU;
  plot: PromptPreviewScenarioGate_ACU;
}

/** 单条提示词分段（role 已按 API 协议归一化）。 */
export interface PromptPreviewSegment_ACU {
  role: string;
  content: string;
  tokens: number;
}

export type PromptPreviewFillScenario_ACU = 'auto' | 'manual_refill' | 'catch_up';

export interface TableFillPromptPreviewMeta_ACU {
  /** resolveCurrentChatFillMode_ACU().mode：classic / llm / crossfire … */
  fillMode: string;
  scenario: PromptPreviewFillScenario_ACU;
  /** 'json' | 'sqlite'，来自 isSqliteMode()。 */
  storageMode: 'json' | 'sqlite';
  /** resolveUpdateMode_ACU 归一后的填表模式。 */
  updateMode: string;
  targetSheetKeys: string[];
  presetName: string;
}

export interface TableFillPromptPreview_ACU {
  segments: PromptPreviewSegment_ACU[];
  /** 已脱敏；宿主 API 路径不使用自定义请求体，返回 null。 */
  requestBody: Record<string, any> | null;
  totalTokens: number;
  meta: TableFillPromptPreviewMeta_ACU;
}

export interface PlotTaskPromptPreview_ACU {
  taskId: string;
  taskName: string;
  stage: number;
  presetName: string;
  segments: PromptPreviewSegment_ACU[];
  totalTokens: number;
}

export interface PlotPromptPreview_ACU {
  tasks: PlotTaskPromptPreview_ACU[];
  /** 预览在第一阶段即以 TaskAbortedByUser 截断，后续阶段不执行。 */
  truncatedToFirstStage: boolean;
  meta: {
    virtualInput: string;
    hasExistingUserMessage: false;
  };
}

/** 门控不通过时抛出：blockers 携带全部互斥原因。 */
export class PromptPreviewGateBlockedError_ACU extends Error {
  readonly code = 'prompt_preview_gate_blocked' as const;
  readonly scenario: 'tableFill' | 'plot';
  readonly blockers: PromptPreviewBlocker_ACU[];

  constructor(scenario: 'tableFill' | 'plot', blockers: PromptPreviewBlocker_ACU[]) {
    const reasons = (blockers || []).map((b) => b.reason).join('；');
    super(`提示词预览暂不可用：${reasons || '当前功能与预览互斥'}。`);
    this.name = 'PromptPreviewGateBlockedError_ACU';
    this.scenario = scenario;
    this.blockers = blockers || [];
  }
}

/** prepareAIInput_ACU 返回结构化失败 / null 时抛出，保留上游 failureCode。 */
export class PromptPreviewPrepareError_ACU extends Error {
  readonly code = 'prompt_preview_prepare_failed' as const;
  readonly failureCode: string | undefined;
  readonly retryable: boolean | undefined;

  constructor(message: string, failureCode?: string, retryable?: boolean) {
    super(message);
    this.name = 'PromptPreviewPrepareError_ACU';
    this.failureCode = failureCode;
    this.retryable = retryable;
  }
}
