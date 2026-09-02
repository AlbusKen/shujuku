/**
 * service/continuation/agent/agent-model.ts — Agent 续写运行时的类型层
 *
 * 只放类型、常量与判定谓词，不含任何 IO 或宿主调用。
 * 叙事资料模块只覆盖表格系统没有的三项：伏笔账本、认知与信息差、长期约束。
 */

import type { ContinuationAgentExecutionContext_ACU } from '../stage-execution-engine';
import type {
  ContinuationInternalAiRequestIdentity_ACU,
  ContinuationPromptSegment_ACU,
  ContinuationSettings_ACU,
  StageTurnFunction_ACU,
  StageTurnMainlineDelta_ACU,
  StageTurnPacing_ACU,
  StageTurnTimeAdvance_ACU,
} from '../model';

/** 楼层锚定快照挂在消息对象上的独立字段名，与首楼 `_qrf_continuation` 并列、互不干扰。 */
export const AGENT_MODULE_FIELD_ACU = '_qrf_continuation_agent';

export const AGENT_MODULE_SCHEMA_VERSION_ACU = 1 as const;

/** 主 Agent 自身会话记录挂在消息对象上的字段名。与资料快照同楼不同字段，互不干扰。 */
export const AGENT_CONVERSATION_FIELD_ACU = '_qrf_continuation_agent_chat';

/** v1：末楼全量快照（历史遗留，读取时兼容为基线段）。 */
export const AGENT_CONVERSATION_SCHEMA_VERSION_ACU = 1 as const;

/** v2：会话按楼层分段增量存储，读取时全楼拼接，删楼即自动回退该楼产生的消息。 */
export const AGENT_CONVERSATION_SEGMENT_SCHEMA_VERSION_ACU = 2 as const;

/**
 * 会话消息种类。API 角色由种类推导，UI 展示样式也由种类决定：
 * - user：人类在 Agent 会话里的输入（初始要求、中途插话、重规划说明）
 * - agent：主 Agent 某次迭代的原始输出（含 thought 与动作 JSON）
 * - tool：运行时回灌给主 Agent 的结果或拒绝原因
 * - runtime：目录与状态快照（只在内容相对上一条快照变化时追加，不替换旧快照）
 * - turn：新轮次开始通告（相当于人类下发新任务）
 * - handoff：token 预算压缩时生成的交接报告
 */
export const AGENT_CONVERSATION_MESSAGE_KINDS_ACU = ['user', 'agent', 'tool', 'runtime', 'turn', 'handoff'] as const;
export type AgentConversationMessageKind_ACU = typeof AGENT_CONVERSATION_MESSAGE_KINDS_ACU[number];

/** 单条会话消息。digest 是短标签，供 UI 标题与交接报告使用，避免二次解析 text。 */
export interface AgentConversationMessage_ACU {
  id: number;
  kind: AgentConversationMessageKind_ACU;
  text: string;
  digest: string;
  /** 产生该消息时的大纲游标指纹（stageId#revision#turnId），用于按轮分组与压缩。 */
  turnKey: string;
  at: number;
  /** 工具消息专用：本条承载的读取地址（如 $STORY_RANGE:12-15），用于本轮读取去重、重读识别与压缩元数据。 */
  readKey?: string;
}

/**
 * 由各楼层段拼接出的会话视图。nextId 取所有段内消息最大 id + 1；
 * messages 已应用压缩标记投影（合成交接报告在最前，marker 之前的原始消息不出现）。
 */
export interface AgentConversationSnapshot_ACU {
  schemaVersion: typeof AGENT_CONVERSATION_SCHEMA_VERSION_ACU;
  nextId: number;
  updatedAt: number;
  messages: AgentConversationMessage_ACU[];
}

/**
 * 非破坏压缩标记。存在楼层记录里而不进消息段：拼接时取 compactedThroughId 最大的标记，
 * id ≤ 该值的消息被投影掉、report 合成为最前的交接消息。删掉承载楼层即自动撤销压缩。
 */
export interface AgentConversationCompactionMarkV1_ACU {
  /** V1 历史标记没有 schemaVersion；仅在下一次成功压缩时升级。 */
  schemaVersion?: undefined;
  compactedThroughId: number;
  report: string;
  at: number;
}

/** V2 handoff 的结构化连续性状态；报告正文由该状态确定性渲染。 */
export interface AgentHandoffSummaryStateV2_ACU {
  currentGoal: string;
  effectiveConstraints: string[];
  decisions: string[];
  completedItems: string[];
  pendingItems: string[];
  blockers: string[];
  continuityFacts: string[];
  readKeys: string[];
  recentTurns: string[];
}

export interface AgentConversationCompactionMetricsV2_ACU {
  sourceFromId: number;
  sourceThroughId: number;
  beforeTokens: number;
  afterTokens: number;
  fixedPromptTokens: number;
  reportTokens: number;
  targetTokens: number;
  triggerTokens: number;
  droppedMessages: number;
  droppedTurns: number;
  degraded: boolean;
  degradationReason?: string;
}

export interface AgentConversationCompactionMarkV2_ACU {
  schemaVersion: 2;
  compactedThroughId: number;
  report: string;
  summaryState: AgentHandoffSummaryStateV2_ACU;
  at: number;
  metrics: AgentConversationCompactionMetricsV2_ACU;
}

export type AgentConversationCompactionMark_ACU =
  | AgentConversationCompactionMarkV1_ACU
  | AgentConversationCompactionMarkV2_ACU;

/** 单楼层的会话段记录。segment 是该楼层期间产生的消息增量；compaction 是可选的压缩标记。 */
export interface AgentConversationFloorRecord_ACU {
  schemaVersion: typeof AGENT_CONVERSATION_SEGMENT_SCHEMA_VERSION_ACU;
  updatedAt: number;
  segment: AgentConversationMessage_ACU[];
  compaction?: AgentConversationCompactionMark_ACU;
}

/** 追加一条会话消息的输入。id 与 at 由存储层分配。 */
export interface AgentConversationAppend_ACU {
  kind: AgentConversationMessageKind_ACU;
  text: string;
  digest?: string;
  turnKey?: string;
  readKey?: string;
}

/** Agent 可读/可搜正文窗口的默认楼数。未结算楼层始终在窗口内，不受此值限制。 */
export const AGENT_STORY_WINDOW_DEFAULT_ACU = 20;

/** 骨架里固定注入全文的末尾 AI 楼层数默认值（承接锚点）。 */
export const AGENT_STORY_TAIL_FLOORS_DEFAULT_ACU = 2;

/** read/search 累计 token 预算默认值：按 agentHistoryTokenBudget 的百分比折算。 */
export const AGENT_READ_TOKEN_BUDGET_DEFAULT_ACU = '30%';

/** 临近历史预算阈值时仍放行的精读兜底额度默认值（token）。 */
export const AGENT_READ_FALLBACK_TOKENS_DEFAULT_ACU = 6000;

/**
 * 主 Agent 上下文自动总结阈值的默认值。统计口径是主 Agent 每次请求实际读取的完整上下文：
 * 提示词骨架（子代理目录、模块目录、表格目录、大纲窗口、正文摘取）加上跨轮会话历史
 * （含用户输入、迭代输出、工具结果与子代理报告）。取 120000 使 128k 级模型在阈值内
 * 仍留有输出余量；超出后在下一轮开始前把最早轮次压缩为交接报告。
 */
export const AGENT_HISTORY_TOKEN_BUDGET_DEFAULT_ACU = 120000;

/**
 * 轮次进行中允许超出预算的倍数。
 *
 * 压缩只在轮次边界发生，因此一轮内到达阈值只登记不执行。但若同一轮反复失败重跑（游标不变、
 * 每次重跑又追加迭代记录），历史会一直长下去；到这个倍数时改为立即压缩——此时的替代方案是
 * 请求因超长而必然失败，用户除了一键清空别无出路，那比一次轮内压缩更糟。
 */
export const AGENT_HISTORY_EMERGENCY_FACTOR_ACU = 2;

/** 热上下文里最多展示的活跃伏笔条数，超出部分如实标注不静默丢弃。 */
export const AGENT_HOT_HOOK_LIMIT_ACU = 8;

/** 单个资料块渲染字符上限，超出即截断并标注。 */
export const AGENT_BLOCK_CHAR_LIMIT_ACU = 4000;

export const AGENT_HOOK_STATUSES_ACU = ['planted', 'reinforced', 'misled', 'partially_paid', 'paid', 'abandoned'] as const;
export type AgentHookStatus_ACU = typeof AGENT_HOOK_STATUSES_ACU[number];

export const AGENT_HOOK_IMPORTANCES_ACU = ['high', 'mid', 'low'] as const;
export type AgentHookImportance_ACU = typeof AGENT_HOOK_IMPORTANCES_ACU[number];

export const AGENT_REVEAL_STATUSES_ACU = ['unrevealed', 'partial', 'revealed'] as const;
export type AgentRevealStatus_ACU = typeof AGENT_REVEAL_STATUSES_ACU[number];

/** 已进入真实正文的一条伏笔。retired 的条目退出热上下文但保留在快照里可追溯。 */
export interface AgentHookEntry_ACU {
  id: string;
  summary: string;
  status: AgentHookStatus_ACU;
  importance: AgentHookImportance_ACU;
  plantedIndex: number;
  updatedIndex: number;
  plannedPayoff: string;
  retired: boolean;
  retiredReason: string;
}

/** 某个角色对某条信息的知晓状态。 */
export interface AgentCharacterKnowledge_ACU {
  name: string;
  knows: string;
}

/** 一条客观事实与各方认知的差值。未揭示的条目 revealIndex 必须为 null。 */
export interface AgentInfoGapEntry_ACU {
  id: string;
  topic: string;
  objectiveFact: string;
  readerKnown: string;
  characterKnowledge: AgentCharacterKnowledge_ACU[];
  revealStatus: AgentRevealStatus_ACU;
  revealIndex: number | null;
  retired: boolean;
  retiredReason: string;
}

/** 一条长期约束。只能由主 Agent 裁决后登记，子代理只能提议。 */
export interface AgentConstraintEntry_ACU {
  id: string;
  text: string;
  reason: string;
  createdIndex: number;
}

/** 总纲条目的层级：story=全书方向（全局唯一一条活跃条目）；volume=卷/幕台阶。 */
export const AGENT_STORY_ARC_SCOPES_ACU = ['story', 'volume'] as const;
export type AgentStoryArcScope_ACU = typeof AGENT_STORY_ARC_SCOPES_ACU[number];

export const AGENT_STORY_ARC_STATUSES_ACU = ['planned', 'active', 'done'] as const;
export type AgentStoryArcStatus_ACU = typeof AGENT_STORY_ARC_STATUSES_ACU[number];

/** 卷在全书长程结构中的职责；与阶段职责同词但作用域独立。 */
export const AGENT_VOLUME_NARRATIVE_ROLES_ACU = ['setup', 'development', 'escalation', 'turn', 'payoff', 'aftermath'] as const;
export type AgentVolumeNarrativeRole_ACU = typeof AGENT_VOLUME_NARRATIVE_ROLES_ACU[number];

/**
 * 一条故事总纲。它是跨阶段的方向锚：阶段大纲只规划 6-10 轮，没有它每个阶段都会
 * 倾向一次性用光手上的料。withheld 是「本层禁止提前翻的底牌」，stageNumbers 是
 * 已由哪些阶段承载的进度记录——两者共同防止一次性打穿。
 */
export interface AgentStoryArcEntry_ACU {
  id: string;
  scope: AgentStoryArcScope_ACU;
  title: string;
  /** 谁追求什么、对抗什么（story）；本卷主推线（volume）。 */
  direction: string;
  /** 本层冲突要抬到什么高度，收在哪。 */
  escalation: string;
  /** 禁止提前释放的底牌。 */
  withheld: string;
  status: AgentStoryArcStatus_ACU;
  /** 已由哪些阶段承载，作为进度锚。 */
  stageNumbers: number[];
  /** 卷完成时引用的真实完成阶段；未完成卷为 null。 */
  completionStageNumber: number | null;
  /** 卷末实际达到的状态；未完成卷为空字符串。 */
  completionState: string;
  /** 在所有既有卷完成后追加本卷时，由既有结果推出的依据。 */
  continuationRationale: string;
  /** 本卷在全书结构中的职责；旧快照可缺失。 */
  narrativeRole?: AgentVolumeNarrativeRole_ACU;
  /** 本卷预计承载的阶段数量范围；容量锚，不是机械完成条件。 */
  targetStageRange?: { min: number; max: number };
  /** 本卷预计覆盖的故事内部时间。 */
  targetTimeSpan?: string;
  /** 本卷主线最多推进到的边界，防止提前打穿后续卷。 */
  progressCeiling?: string;
  /** 跨阶段持续经营的关系、利益、认知或生活副线。 */
  sustainingThreads?: string[];
  /** 本卷应兑现的既有期待或承诺。 */
  payoffTargets?: string[];
  /** 阶段容量偏离目标范围时的完成说明；不得与续卷依据混用。 */
  completionRationale?: string;
  retired: boolean;
  retiredReason: string;
}

export const AGENT_CHRONOLOGY_PRECISIONS_ACU = ['exact', 'approximate', 'unknown'] as const;
export type AgentChronologyPrecision_ACU = typeof AGENT_CHRONOLOGY_PRECISIONS_ACU[number];

/** 已发生正文结算出的故事年代学记录；大纲时间计划不得写入。 */
export interface AgentChronologyEntry_ACU {
  id: string;
  /** 该次转换后可用于正文定位的相对时间锚。 */
  anchor: string;
  /** 自故事起点累计经过时间；无法可靠量化时明确写 unknown。 */
  elapsed: string;
  precision: AgentChronologyPrecision_ACU;
  /** 从上一锚点到本锚点实际发生的时间转换。 */
  transition: string;
  /** 支撑该事实的真实正文楼层；不得引用大纲或运行时 timeline。 */
  evidenceIndexes: number[];
  updatedIndex: number;
  retired: boolean;
  retiredReason: string;
}

export interface AgentModuleRevisions_ACU {
  hooks: number;
  infoGap: number;
  constraints: number;
  storyArc: number;
  chronology: number;
}

/** 楼层锚定的全量快照。读取=从尾向前找最近的合法快照，删楼即自动回退。 */
export interface AgentModuleSnapshot_ACU {
  schemaVersion: typeof AGENT_MODULE_SCHEMA_VERSION_ACU;
  settledThroughIndex: number;
  updatedAt: number;
  revisions: AgentModuleRevisions_ACU;
  hooks: AgentHookEntry_ACU[];
  infoGap: AgentInfoGapEntry_ACU[];
  constraints: AgentConstraintEntry_ACU[];
  storyArc: AgentStoryArcEntry_ACU[];
  chronology: AgentChronologyEntry_ACU[];
}

export const AGENT_WRITABLE_MODULES_ACU = ['hooks', 'infoGap', 'constraints', 'storyArc', 'chronology'] as const;
export type AgentWritableModule_ACU = typeof AGENT_WRITABLE_MODULES_ACU[number];

export const AGENT_SUBAGENT_NAMES_ACU = ['arc-architect', 'hook-cognition-maintainer', 'mainline-planner', 'beat-planner', 'continuity-reviewer'] as const;
export type AgentSubagentName_ACU = typeof AGENT_SUBAGENT_NAMES_ACU[number];

export type AgentSubagentKind_ACU = 'arc' | 'maintain' | 'plan' | 'review';

/** 最终审查是 finalize 前由运行时受控触发的内部代理，不进入主 Agent 可委派名称集合。 */
export const AGENT_FINAL_REVIEWER_NAME_ACU = 'final-reviewer';

/**
 * 大纲子代理的目录名。它不走通用子代理运行时：主循环拦截对它的派工，
 * 调用编排器注入的租约内事务回调，由既有大纲规划器完成生成与校验。
 */
export const AGENT_OUTLINE_AGENT_NAME_ACU = 'outline-architect';

/** 大纲操作种类。由运行时按 envelope 状态推断，主 Agent 不需要也不允许指定。 */
export type AgentOutlineOpKind_ACU = 'create' | 'revise' | 'continue';

/** 一次大纲操作的结果。stopped 非空表示任务已被停止（阶段上限/总时长），循环必须中止。 */
export interface AgentOutlineOpResult_ACU {
  op: AgentOutlineOpKind_ACU;
  requiresReview: boolean;
  stopped: 'stage_limit_reached' | 'duration_reached' | null;
  summary: string;
}

/** 主 Agent 一次派工的完整输入。读集用占位符 token 表达，不暴露存储路径；写入范围由子代理职责固定决定。 */
export interface AgentDelegation_ACU {
  agentName: string;
  prompt: string;
  reads: string[];
}

/** search 工具可检索的资料域。 */
export const AGENT_SEARCH_SCOPES_ACU = ['story', 'tables', 'modules', 'outline', 'worldbook'] as const;
export type AgentSearchScope_ACU = typeof AGENT_SEARCH_SCOPES_ACU[number];

/** 一次 read 工具调用：按地址 token 批量取数。 */
export interface AgentReadCall_ACU {
  kind: 'read';
  reads: string[];
}

/** 一次 search 工具调用：grep 式跨域检索。 */
export interface AgentSearchCall_ACU {
  kind: 'search';
  query: string;
  scope: AgentSearchScope_ACU[];
  isRegex: boolean;
  maxResults: number;
}

export type AgentToolCall_ACU = AgentReadCall_ACU | AgentSearchCall_ACU;

/** 主/子代理一次输出里的工具并发批次。多个 read/search JSON 对象组成一批同时执行。 */
export interface AgentToolsAction_ACU {
  kind: 'tools';
  thought: string;
  calls: AgentToolCall_ACU[];
}

export interface AgentFinalizeAction_ACU {
  kind: 'finalize';
  thought: string;
  instruction: string;
  summary: string;
  /** 长期约束的增量登记：add 只写新增，retire 只写废除（id 或原文）。漏写既有条目不等于删除。 */
  constraints: { add: string[]; retire: string[] } | null;
}

export interface AgentDelegateAction_ACU {
  kind: 'delegate';
  thought: string;
  delegations: AgentDelegation_ACU[];
}

export interface AgentBlockAction_ACU {
  kind: 'block';
  thought: string;
  reason: string;
  unresolved: string[];
}

/**
 * 大纲句级编辑操作。运行时替模型收尾结构一致性（重算 suggestedTurns/totalTurns），
 * 模型只表达意图；已完成轮次与当前轮的保护由校验层强制。
 */
export type AgentOutlineEditOp_ACU =
  | {
      op: 'set_turn_goal';
      turnId: string;
      goal: string;
      pacing?: StageTurnPacing_ACU;
      function?: StageTurnFunction_ACU;
      mainlineDelta?: StageTurnMainlineDelta_ACU;
      timeAdvance?: StageTurnTimeAdvance_ACU;
      timeAnchor?: string | null;
    }
  | {
      op: 'insert_turn';
      nodeId: string;
      afterTurnId: string | null;
      goal: string;
      pacing?: StageTurnPacing_ACU;
      function?: StageTurnFunction_ACU;
      mainlineDelta?: StageTurnMainlineDelta_ACU;
      timeAdvance?: StageTurnTimeAdvance_ACU;
      timeAnchor?: string | null;
    }
  | { op: 'remove_turn'; turnId: string }
  | { op: 'set_node_goal'; nodeId: string; goal: string };

export type AgentMainAction_ACU = AgentFinalizeAction_ACU | AgentDelegateAction_ACU | AgentBlockAction_ACU | AgentToolsAction_ACU;

/** 运行时硬边界。预留最后一轮让主 Agent 有机会正常交付而不是被突然掐断。 */
export interface AgentRunBudget_ACU {
  maxIterations: number;
  maxDelegations: number;
  maxSameAgent: number;
  maxConcurrent: number;
  /** 主 Agent 一次运行内 read/search 工具批次的次数上限。 */
  maxReads: number;
  /** 子代理小循环里工具轮次上限（首轮之外还允许几轮 read/search）。 */
  maxExtraReads: number;
}

export const DEFAULT_AGENT_RUN_BUDGET_ACU: AgentRunBudget_ACU = {
  maxIterations: 8,
  maxDelegations: 6,
  maxSameAgent: 2,
  maxConcurrent: 3,
  maxReads: 8,
  maxExtraReads: 3,
};

/** 一次派工的执行结果。被运行时拒绝的委派也走这里回灌给主 Agent。 */
export interface AgentDelegationOutcome_ACU {
  agentName: string;
  ok: boolean;
  summary: string;
  detail: string;
  rejectedReason: string;
}

/** 子代理维护类输出解析后的写集事务。patch 只带要改的字段，合并结果仍过全量一致性校验。 */
export interface AgentModuleDelta_ACU {
  expectedRevisions: Partial<AgentModuleRevisions_ACU>;
  hooks: AgentHookDeltaItem_ACU[];
  hookPatches: AgentHookPatch_ACU[];
  infoGap: AgentInfoGapDeltaItem_ACU[];
  infoGapPatches: AgentInfoGapPatch_ACU[];
  storyArc: AgentStoryArcDeltaItem_ACU[];
  storyArcPatches: AgentStoryArcPatch_ACU[];
  chronology: AgentChronologyDeltaItem_ACU[];
  constraintProposals: string[];
}

/** 总纲条目的句级修补：只有显式出现的字段会被修改。阶段进度回写通常只需 patch stageNumbers + status。 */
export interface AgentStoryArcPatch_ACU {
  id: string;
  title?: string;
  direction?: string;
  escalation?: string;
  withheld?: string;
  status?: AgentStoryArcStatus_ACU;
  stageNumbers?: number[];
  completionStageNumber?: number | null;
  completionState?: string;
  continuationRationale?: string;
  narrativeRole?: AgentVolumeNarrativeRole_ACU;
  targetStageRange?: { min: number; max: number };
  targetTimeSpan?: string;
  progressCeiling?: string;
  sustainingThreads?: string[];
  payoffTargets?: string[];
  completionRationale?: string;
}

export interface AgentStoryArcDeltaItem_ACU {
  action: 'upsert' | 'retire';
  id: string;
  scope: AgentStoryArcScope_ACU;
  title: string;
  direction: string;
  escalation: string;
  withheld: string;
  status: AgentStoryArcStatus_ACU;
  /** upsert 时模型是否明确写了 status；省略时对既有条目保留原状态，而不是回落成 planned。 */
  statusProvided?: boolean;
  stageNumbers: number[];
  completionStageNumber: number | null;
  completionState: string;
  continuationRationale: string;
  narrativeRole?: AgentVolumeNarrativeRole_ACU;
  targetStageRange?: { min: number; max: number };
  targetTimeSpan?: string;
  progressCeiling?: string;
  sustainingThreads?: string[];
  payoffTargets?: string[];
  completionRationale?: string;
  reason: string;
}

/** 伏笔条目的句级修补：只有显式出现的字段会被修改。 */
export interface AgentHookPatch_ACU {
  id: string;
  summary?: string;
  status?: AgentHookStatus_ACU;
  importance?: AgentHookImportance_ACU;
  plannedPayoff?: string;
}

/** 信息差条目的句级修补：只有显式出现的字段会被修改。 */
export interface AgentInfoGapPatch_ACU {
  id: string;
  topic?: string;
  objectiveFact?: string;
  readerKnown?: string;
  characterKnowledge?: AgentCharacterKnowledge_ACU[];
  revealStatus?: AgentRevealStatus_ACU;
  revealIndex?: number | null;
}

export interface AgentHookDeltaItem_ACU {
  action: 'upsert' | 'retire';
  id: string;
  summary: string;
  status: AgentHookStatus_ACU;
  importance: AgentHookImportance_ACU;
  plantedIndex: number;
  plannedPayoff: string;
  reason: string;
}

export interface AgentInfoGapDeltaItem_ACU {
  action: 'upsert' | 'retire';
  id: string;
  topic: string;
  objectiveFact: string;
  readerKnown: string;
  characterKnowledge: AgentCharacterKnowledge_ACU[];
  revealStatus: AgentRevealStatus_ACU;
  revealIndex: number | null;
  reason: string;
}

export interface AgentChronologyDeltaItem_ACU {
  action: 'upsert' | 'retire';
  id: string;
  anchor: string;
  elapsed: string;
  precision: AgentChronologyPrecision_ACU;
  transition: string;
  evidenceIndexes: number[];
  reason: string;
}

/** 子代理维护类的完整输出。资料不足时不再用 needMore 申请重跑，而是在小循环里直接输出 read 工具调用。 */
export interface AgentMaintainerOutput_ACU {
  summary: string;
  delta: AgentModuleDelta_ACU;
}

/** 子代理策划类的完整输出。外层结构化便于运行时识别，创作内容保持自然语言。 */
export interface AgentPlannerOutput_ACU {
  summary: string;
  recommendation: string;
  mustPreserve: string[];
  risks: string[];
}

export const AGENT_REVIEW_VERDICTS_ACU = ['pass', 'revise', 'block'] as const;
export type AgentReviewVerdict_ACU = typeof AGENT_REVIEW_VERDICTS_ACU[number];

/** 子代理审查类的完整输出。 */
export interface AgentReviewerOutput_ACU {
  verdict: AgentReviewVerdict_ACU;
  reason: string;
  fixes: string[];
}

/** 发送前最终审查的完整输出；只读反馈由 #p5 状态机回灌主 Agent。 */
export interface AgentFinalReviewerOutput_ACU {
  verdict: AgentReviewVerdict_ACU;
  summary: string;
  emotionFindings: string[];
  worldFindings: string[];
  logicFindings: string[];
  requiredFixes: string[];
  preserve: string[];
}

/** 主 Agent 循环最终交付给宿主装配器的结果，字段形状与旧生成器保持一致。 */
export interface ContinuationAgentTurnPlanResult_ACU {
  instruction: string;
  attempts: number;
  apiPreset: { presetName: string; source: 'current' | 'fixed'; reason: 'fixed_preset' | 'current_configuration' };
}

/** 一次轮次准备所需的全部外部输入。 */
export interface ContinuationAgentTurnPlanRequest_ACU {
  settings: ContinuationSettings_ACU;
  /** 宽松执行上下文供应器。大纲操作会改变游标，循环每次迭代都要重新读取。 */
  readContext: () => ContinuationAgentExecutionContext_ACU;
  createInternalRequestIdentity: (attempt: number) => ContinuationInternalAiRequestIdentity_ACU & { source: 'turn_instruction' };
  isInternalRequestCurrent: (identity: ContinuationInternalAiRequestIdentity_ACU) => boolean;
  /** 大纲操作回调，由编排器在租约内执行。正文重试轮不注入，此时大纲派工被拒绝回灌。 */
  applyOutline?: (instruction: string) => Promise<AgentOutlineOpResult_ACU>;
  signal?: AbortSignal | null;
}

export function isAgentSubagentName_ACU(value: unknown): value is AgentSubagentName_ACU {
  return typeof value === 'string' && (AGENT_SUBAGENT_NAMES_ACU as readonly string[]).includes(value);
}

export function isAgentWritableModule_ACU(value: unknown): value is AgentWritableModule_ACU {
  return typeof value === 'string' && (AGENT_WRITABLE_MODULES_ACU as readonly string[]).includes(value);
}

export function cloneAgentPromptSegments_ACU(segments: readonly ContinuationPromptSegment_ACU[]): ContinuationPromptSegment_ACU[] {
  return segments.map(segment => ({ ...segment }));
}
