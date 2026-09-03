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
  worldbookConfig: WorldbookConfig_ACU;
  plotSettings: PlotSettings_ACU;
  /**
   * 剧情推进世界书选择的权威副本，按角色卡作用域键（char:<avatar> / group:<id>）存储。
   * plotSettings.plotWorldbookConfig 只是当前角色卡的运行时投影。
   */
  plotWorldbookConfigByCharacter?: Record<string, Pick<WorldbookConfig_ACU, 'source' | 'manualSelection'> & { enabledEntries?: Record<string, unknown> }>;
  mergeSummaryPrompt: string;
  hasImportTableSelection: boolean;
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
