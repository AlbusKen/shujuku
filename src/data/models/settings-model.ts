/**
 * data/models/settings-model.ts — 设置数据结构定义
 *
 * 定义 settings_ACU 对象的 TypeScript 接口。
 */

import type {
  AgentWorldbookPromptTemplates_ACU,
  AgentWorldbookControl_ACU,
  AgentWorldbookControlSnapshot_ACU,
} from '../../shared/models/agent-worldbook-model';

export type {
  AgentWorldbookPromptTemplates_ACU,
  AgentContextSettings_ACU,
  AgentPlotExecutionMode_ACU,
  AgentSkillMetadataPolicy_ACU,
  AgentWorldbookCardConfigMeta_ACU,
  AgentWorldbookControl_ACU,
  AgentWorldbookControlMode_ACU,
  AgentWorldbookControlSnapshot_ACU,
  AgentWorldbookControlSnapshotEntry_ACU,
  AgentWorldbookStateIdentity_ACU,
  AgentWorldbookStateMeta_ACU,
  PromptSegment_ACU,
  WorldbookSkillMeta_ACU,
  WorldbookSkillMetaUpdatedBy_ACU,
} from '../../shared/models/agent-worldbook-model';

/** 世界书注入配置 */

export interface WorldbookConfig_ACU {
  source: 'character' | 'manual';
  manualSelection: string[];
  injectionTarget: string;
  entryBlockList: string[];
}

/** 设置对象的核心接口 */
export interface Settings_ACU {
  charCardPrompt: Array<{
    role: string;
    content: string;
    deletable: boolean;
    mainSlot?: string;
    isMain?: boolean;
    isMain2?: boolean;
  }>;
  tableTemplate: string;
  autoUpdateEnabled: boolean;
  autoUpdateThresholdNewMessages: number;
  autoUpdateThresholdInterval: number;
  tableMaxRetries: number;
  /** 丢弃可证明仅影响非目标表的 SQL 语句；混合/无法归属写入仍保持失败。 */
  discardUnauthorizedTableEditsEnabled: boolean;
  /** 填表走原生工具调用（table_edit / table_sql）；默认关闭，部分渠道带 tools 字段会直接报错。 */
  tableFillNativeToolEnabled: boolean;
  /** 智能续写走纯工具方案（决策与交付都用函数调用）；全局开关，不随对话保存，默认关闭即纯 JSON。 */
  continuationNativeToolEnabled: boolean;
  /** 格林推演走纯工具方案（决策与交付都用函数调用）；全局开关，不随对话保存，默认关闭即纯 JSON。 */
  worldSimulationNativeToolEnabled: boolean;
  worldbookConfig: WorldbookConfig_ACU;
  /** 解除剧情推进发送伪装，原文留在输入框等待结果；默认关闭，不随预设切换。 */
  plotSendDisguiseDisabled?: boolean;
  /** 桌宠直接显示现有通知与任务进度的真实内容；默认关闭。 */
  deskPetShowRealWork?: boolean;
  plotSettings: PlotSettings_ACU;
  /**
   * 剧情推进世界书选择的权威副本，按角色卡作用域键（char:<avatar> / group:<id>）存储。
   * plotSettings.plotWorldbookConfig 只是当前角色卡的运行时投影。
   */
  plotWorldbookConfigByCharacter?: Record<string, Pick<WorldbookConfig_ACU, 'source' | 'manualSelection'> & { enabledEntries?: Record<string, unknown> }>;
  mergeSummaryPrompt: string;
  hasImportTableSelection: boolean;
  /** presentation-v2 智能续写页可见性；缺失按开启处理。 */
  continuationPageEnabled?: boolean;
  /** 格林推演总开关（含自动后台触发）；缺失按关闭处理。 */
  worldSimulationPageEnabled?: boolean;
  /** 存储模式：'native' 原生 JSON 模式 | 'sqlite' SQLite 运行时数据库模式 */
  storageMode: 'native' | 'sqlite';
  /** 输出低于慢阶段阈值的详细性能 span；默认关闭。 */
  performanceDiagnosticsEnabled?: boolean;
  /** 慢阶段摘要阈值，默认 50ms。 */
  performanceSlowThresholdMs?: number;
  /** 长任务级摘要阈值，默认 200ms。 */
  performanceLongTaskThresholdMs?: number;
  /** 角色专属设置键映射 */
  [key: string]: unknown;
}

/** 剧情推进设置 */
export interface PlotSettings_ACU {
  enabled: boolean;
  prompts: Array<{
    id: string;
    name: string;
    role: string;
    content: string;
    deletable: boolean;
  }>;
  rateMain: number;
  ratePersonal: number;
  rateErotic: number;
  rateCuckold: number;
  recallCount: number;
  extractTags: string;
  contextExtractTags: string;
  contextExtractRules: unknown[];
  plotWorldbookConfig?: WorldbookConfig_ACU;
  agentPromptTemplates?: AgentWorldbookPromptTemplates_ACU;
  agentWorldbookControl?: AgentWorldbookControl_ACU;
  agentWorldbookControlSnapshot?: AgentWorldbookControlSnapshot_ACU;
  [key: string]: unknown;
}
