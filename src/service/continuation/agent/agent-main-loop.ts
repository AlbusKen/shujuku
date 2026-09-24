/**
 * service/continuation/agent/agent-main-loop.ts — 主 Agent 文本协议循环
 *
 * 主 Agent 每次迭代只做一件事：读证据、输出一个协议动作。运行时执行该动作后把结果
 * 回灌成新的证据，再进入下一次迭代，直到 finalize / block / 预算耗尽。
 *
 * 装配顺序：伪 role 提示词 → Agent 自己的会话记录（含运行时快照）→ 尾部预填充。
 * 会话记录插在 `$HISTORY_ANCHOR` 段的位置上，该段本身不发送。
 * 目录与预算不再作为骨架尾段重算，只在内容变化时追加为 runtime 会话消息，
 * 保证相邻请求对 Codex 兼容渠道是严格的前缀延伸。
 *
 * 正文经三个正交占位符注入骨架：`$STORY_OVERVIEW`（纪要表事件概览，召回行升级纪要全文）、
 * `$STORY_TAIL`（尾部若干 AI 楼层全文）、`$STORY_CATALOG`（纯楼层索引）；`$HISTORY_ANCHOR`
 * 承载主 Agent 自己的对话——用户输入、它历次迭代的原始输出、运行时回灌的工具结果与
 * 运行时快照，按真实 role 跨轮持久累积。这样它才看得见自己走到哪了。
 */

import { getChatArray_ACU } from '../../../data/gateways/chat-gateway';
import { getActiveChatStorageIdentity_ACU } from '../../../data/storage/chat-history';
import { normalizeContinuationInternalAiRetryLimit_ACU } from '../defaults';
import { callContinuationInternalAi_ACU, callContinuationInternalAiWithRetry_ACU, CONTINUATION_ROLE_OUTPUT_TOKEN_FLOORS_ACU, formatAgentUsageLabel_ACU, type AiUsageMetadata_ACU, type ContinuationInternalAiCallOptions_ACU } from '../internal-ai-call';
import { agentNativeTools_ACU, nativeToolCallsToProtocolJson_ACU, normalizeAgentModelReply_ACU, synthesizeProtocolToolCalls_ACU, withNativeToolThinkPrefill_ACU, type AiNativeToolCall_ACU } from '../../ai/native-tool';
import { effectiveAgentApiPresetMode_ACU, resolveContinuationAgentApiPreset_ACU, type ContinuationApiPresetDependencies_ACU, type ContinuationResolvedApiPreset_ACU } from '../api-preset';
import { renderContinuationPrompt_ACU } from '../prompt-template';
import type { ContinuationAgentExecutionContext_ACU } from '../stage-execution-engine';
import {
  ContinuationValidationError_ACU,
  createContinuationError_ACU,
  type ContinuationInternalAiRequestIdentity_ACU,
  type ContinuationSettings_ACU,
} from '../model';
import { AGENT_PREFILLS_ACU, AGENT_RUNTIME_SNAPSHOT_TEMPLATE_ACU } from './agent-defaults';
import { renderMainSessionReadAppendix_ACU } from './agent-shared-materials';
import {
  applyAgentUserRequirementsReplace_ACU,
  renderAgentUserRequirements_ACU,
} from './agent-user-requirements';
import { beginAgentSessionRun_ACU, logAgentSession_ACU, updateAgentSession_ACU } from './agent-session-log';
import { AGENT_FINAL_REVIEW_STATUSES_ACU, clearAgentRunState_ACU, readAgentRunState_ACU, saveAgentRunState_ACU, type AgentFinalReviewResumeState_ACU } from './agent-run-cache';
import { findAgentSubagentDefinition_ACU, renderAgentModuleCatalog_ACU, renderAgentReadCatalog_ACU, renderAgentSubagentCatalog_ACU } from './agent-catalog';
import { findUnregisteredStageNumbers_ACU, hasActiveStoryArc_ACU, hasActiveStoryArcVolume_ACU, readAgentModuleSnapshot_ACU, renderAgentConstraints_ACU, renderAgentWebRefsCatalog_ACU, writeAgentModuleSnapshot_ACU } from './agent-module-store';
import {
  appendAgentConversation_ACU,
  appendPreparedAgentConversationMessages_ACU,
  fingerprintAgentConversationSource_ACU,
  lastAnnouncedTurnKey_ACU,
  lastRuntimeSnapshotText_ACU,
  readActiveAgentConversationCompactionMark_ACU,
  readAgentConversation_ACU,
  readAgentConversationCompactionSource_ACU,
  renderAgentConversationMessages_ACU,
  writeAgentConversationCompactionMark_ACU,
} from './agent-conversation-store';
import { createAgentHandoffSemanticSummaryAdapter_ACU, type AgentHandoffSemanticSummaryAdapter_ACU } from './agent-handoff-summarizer';
import {
  countAgentTokens_ACU,
  createAgentTokenCounter_ACU,
  measureAgentPromptTokens_ACU,
  type TokenCounter_ACU,
} from './agent-token-budget';
import { planAgentHistoryCompaction_ACU } from './agent-history-compactor';
import type { AgentConversationCompactionMarkV2_ACU } from './agent-model';
import { renderAgentTableCatalog_ACU } from './agent-tables';
import { applyAgentConstraintRegistrationViaSql_ACU, applyAgentModuleDeltaViaSql_ACU, applyAgentWebRefsDeltaViaSql_ACU, mergeAgentDeltaRevisions_ACU } from './agent-transaction';
import { commitAgentModuleFieldWrites_ACU, type AgentFieldPage_ACU } from './agent-module-field-commit';
import { readMessageSwipeId_ACU } from './agent-module-frame';
import { compactAgentProtocolError_ACU, parseAgentMainOutput_ACU } from './agent-protocol';
import {
  buildAgentWorldbookScanText_ACU,
  extractAgentRecallCodesFromChat_ACU,
  renderAgentOutlineState_ACU,
  renderAgentOutlineWindow_ACU,
  renderAgentStoryCatalog_ACU,
  renderAgentStoryOverview_ACU,
  renderAgentStoryTail_ACU,
  renderAgentStoryText_ACU,
  renderAgentTurnGuidance_ACU,
  renderAgentUnsettledHistory_ACU,
  resolveAgentReadToken_ACU,
  type AgentResolveContext_ACU,
} from './agent-placeholder-resolver';
import { buildEmptyAgentWorldbookSnapshot_ACU, loadAgentWorldbookSnapshot_ACU, renderAgentWorldbookTriggeredInjection_ACU, WORLDBOOK_READ_REFUSAL_ACU, type AgentWorldbookSnapshot_ACU } from './agent-worldbook-read';
import { runAgentSearch_ACU } from './agent-search';
import {
  createAgentReadGateState_ACU,
  gateAgentReadBatch_ACU,
  resolveAgentReadBudget_ACU,
  type AgentGateItem_ACU,
  type AgentReadGateConfig_ACU,
  type AgentReadGateState_ACU,
} from './agent-read-gate';
import { AgentSubagentRuntime_ACU, type AgentSubagentRunResult_ACU } from './agent-subagent-runtime';
import {
  continuationBeatObligation_ACU,
  continuationMajorTurn_ACU,
  runContinuationAgentWorkflow_ACU,
  type ContinuationWorkflowAgentPayload_ACU,
  type ContinuationWorkflowResult_ACU,
} from './agent-workflow';
import { trackAgentPromptDrift_ACU } from './agent-prompt-drift';
import {
  AGENT_HISTORY_EMERGENCY_FACTOR_ACU,
  AGENT_INSTRUCTION_COMPOSER_NAME_ACU,
  AGENT_OUTLINE_AGENT_NAME_ACU,
  AGENT_WEB_RESEARCHER_NAME_ACU,
  DEFAULT_AGENT_RUN_BUDGET_ACU,
  type AgentConversationAppend_ACU,
  type AgentConversationSnapshot_ACU,
  type AgentDelegateAction_ACU,
  type AgentDelegation_ACU,
  type AgentDelegationOutcome_ACU,
  type AgentMainAction_ACU,
  type AgentModuleSnapshot_ACU,
  type AgentOpenRoundAction_ACU,
  type AgentOutlineOpResult_ACU,
  type AgentRunBudget_ACU,
  type AgentSubagentName_ACU,
  type AgentToolCall_ACU,
  type ContinuationAgentTurnPlanRequest_ACU,
  type ContinuationAgentTurnPlanResult_ACU,
} from './agent-model';

/** 会话记录插入位置的内部哨兵。用不可见字符避免与提示词正文撞车。 */
const HISTORY_SENTINEL_ACU = '\u0000__QRF_AGENT_HISTORY__\u0000';

export interface ContinuationAgentTurnPlannerDependencies_ACU {
  resolveApiPreset: typeof resolveContinuationAgentApiPreset_ACU;
  callInternalAi: (
    messages: Array<{ role: string; content: string }>,
    preset: ContinuationResolvedApiPreset_ACU,
    identity: ContinuationInternalAiRequestIdentity_ACU,
    signal?: AbortSignal | null,
    options?: ContinuationInternalAiCallOptions_ACU,
  ) => Promise<string | import('../../ai/native-tool').AiChatTurn_ACU | null>;
  subagentRuntime: AgentSubagentRuntime_ACU;
  /** 生产路径打开后，工具走原生 tool_calls，回执用 role=tool。测试缺省关闭。 */
  nativeTools?: boolean;
  readChat: () => any[];
  readModuleSnapshot: (chat: any[]) => AgentModuleSnapshot_ACU;
  writeModuleSnapshot: (chat: any[], targetIndex: number, snapshot: AgentModuleSnapshot_ACU) => Promise<void>;
  readConversation: (chat: any[]) => AgentConversationSnapshot_ACU;
  /** 读取当前持久化的压缩标记；候选提交必须以该权威回读为准。 */
  readCompactionMark: typeof readActiveAgentConversationCompactionMark_ACU;
  /** 把新产生的会话消息作为段追加到末楼。分段存储下不再整体重写快照。 */
  appendConversationMessages: typeof appendPreparedAgentConversationMessages_ACU;
  /** 在末楼记录非破坏压缩标记。 */
  writeCompactionMark: typeof writeAgentConversationCompactionMark_ACU;
  /** 运行起点预取已启用世界书快照。测试注入空快照以摆脱宿主依赖。 */
  loadWorldbook: () => Promise<AgentWorldbookSnapshot_ACU>;
  budget: AgentRunBudget_ACU;
  /** token 统计函数。缺省走宿主分词器；测试注入确定性计数以摆脱对默认提示词长度的依赖。 */
  countTokens?: TokenCounter_ACU;
}

const defaultDependencies_ACU: ContinuationAgentTurnPlannerDependencies_ACU = {
  resolveApiPreset: resolveContinuationAgentApiPreset_ACU,
  callInternalAi: callContinuationInternalAi_ACU,
  subagentRuntime: new AgentSubagentRuntime_ACU(),
  readChat: getChatArray_ACU,
  readModuleSnapshot: readAgentModuleSnapshot_ACU,
  writeModuleSnapshot: writeAgentModuleSnapshot_ACU,
  readConversation: readAgentConversation_ACU,
  readCompactionMark: readActiveAgentConversationCompactionMark_ACU,
  appendConversationMessages: appendPreparedAgentConversationMessages_ACU,
  writeCompactionMark: writeAgentConversationCompactionMark_ACU,
  loadWorldbook: loadAgentWorldbookSnapshot_ACU,
  budget: DEFAULT_AGENT_RUN_BUDGET_ACU,
};

/** 一次运行内的会话读写句柄。把「历史怎么来、消息往哪追加、什么时候落盘」收在一处。 */
interface AgentConversationHandle_ACU {
  snapshot: () => AgentConversationSnapshot_ACU;
  /** 当前会话渲染成的消息序列，每次迭代重新取（会话在迭代间会增长）。 */
  history: () => Array<{ role: string; content: string }>;
  record: (appends: readonly AgentConversationAppend_ACU[]) => void;
  /** 有未落盘变更时写入末楼；无楼层可承载时保持内存态。 */
  flush: () => Promise<void>;
  /**
   * 运行中途按 token 阈值压缩历史（越界压缩）。先落盘未持久化的消息再压，成功则替换本运行的会话视图。
   * @returns 是否真的压缩并提交了
   */
  compact: (emergency: boolean, preparedMessages?: readonly { role: string; content: string }[]) => Promise<boolean>;
  /** 新一轮开始时丢掉上一轮的会话、工具调用和快照，不调用总结。 */
  discardPreviousRound: () => Promise<boolean>;
  /** 本次运行是否已经向用户通告过「上下文超过阈值但本轮内继续」，避免每次迭代重复刷屏。 */
  overBudgetNotified: boolean;
  continuingSameTurn: boolean;
  turnKey: string;
}

interface AgentRunLedger_ACU {
  delegationsUsed: number;
  perAgent: Map<string, number>;
  outcomes: AgentDelegationOutcome_ACU[];
}

/** 一次运行内 read/search 工具的累计状态：批次计数、门禁账本、放行地址与失效地址集合。 */
interface AgentToolUsage_ACU {
  batchesUsed: number;
  gateState: AgentReadGateState_ACU;
  /**
   * 本次运行已放行的读取地址（read token 或 search 指纹）。重复调阅返回一行提示而不重注内容、
   * 不计门禁账。资料可能变化的节点（派工结算、大纲变更）整体清空，允许重读最新版。
   */
  granted: Set<string>;
  /** 已放行但随后可能因资料变化而失效的地址；成功重读时消费并在新消息自身标记最新快照。 */
  invalidated: Set<string>;
}

function failLoop_ACU(
  code: 'CONTINUATION_AGENT_ITERATIONS_EXHAUSTED' | 'CONTINUATION_AGENT_BLOCKED' | 'CONTINUATION_AGENT_OUTLINE_REPLANNED' | 'CONTINUATION_AGENT_PROTOCOL_INVALID' | 'CONTINUATION_TASK_STATE_INVALID',
  message: string,
  details?: Record<string, unknown>,
): never {
  throw new ContinuationValidationError_ACU(createContinuationError_ACU(code, 'agent_loop', message, false, details));
}

const ARC_MAINTENANCE_TRIGGER_PATTERN_ACU = /(偏离|越出|偏差|脱节|底牌|提前(翻|释放|揭)|收束|完结|收尾|done|续卷|扩充|新卷|追加.*卷|切卷|台阶|patch|回写|登记|进度)/i;
const ARC_EVIDENCE_PATTERN_ACU = /(楼层\s*\d+|第\s*\d+\s*楼|\$STORY_RANGE:\d+|第\s*\d+\s*阶段|阶段\s*\d+|stage\s*\d+|VOL-\d+)/i;

/**
 * arc-architect 派工门禁。总纲一旦建立，每轮都派它“更新总纲”只会让卷台阶被反复重写、派工额度被白白吃掉。
 * 结构性事件（总纲为空、没有 active 卷、已完成阶段未登记、当前阶段刚完成）直接放行；
 * 其余维护必须在 prompt 里写明触发事由并引用依据（楼层 / 阶段 / 卷号），否则拒绝且不消耗派工额度。
 * @param context 解析上下文
 * @param prompt 主 Agent 给 arc-architect 的任务描述
 */
export function evaluateArcArchitectDispatch_ACU(context: AgentResolveContext_ACU, prompt: string): { allowed: boolean; reason: string } {
  if (!hasActiveStoryArc_ACU(context.moduleSnapshot)) return { allowed: true, reason: '' };
  if (!hasActiveStoryArcVolume_ACU(context.moduleSnapshot)) return { allowed: true, reason: '' };
  const completed = context.execution.task.stages.filter(stage => stage.status === 'completed').map(stage => stage.stageNumber);
  if (findUnregisteredStageNumbers_ACU(context.moduleSnapshot, completed).length) return { allowed: true, reason: '' };
  if (context.execution.stage?.status === 'completed') return { allowed: true, reason: '' };
  const text = String(prompt ?? '');
  if (ARC_MAINTENANCE_TRIGGER_PATTERN_ACU.test(text) && ARC_EVIDENCE_PATTERN_ACU.test(text)) return { allowed: true, reason: '' };
  return {
    allowed: false,
    reason: '总纲已建立、没有待登记的已完成阶段、当前阶段仍在进行，本轮没有需要维护总纲的结构事件，arc-architect 未执行（不消耗派工额度）。只有剧情越出台阶、底牌被正文提前翻开、当前卷已可判定收束或需要追加新卷时才派它，并在 prompt 里写明事由与依据（如「楼层 12-14 主角提前翻出身世，VOL-01 的 withheld 需要更新」）。常规轮次请直接进入结算与策划。',
  };
}

/**
 * 主 Agent 输出被协议层拒绝时的回灌文本：错误原因 + 按当前状态给出的最可能合法动作样例。
 * 快速模型对“照这个样子写”远比对“请修正”服从；样例按状态选择，避免把不合时宜的动作推给它。
 */
export function renderMainProtocolRejection_ACU(reason: string, execution: ContinuationAgentExecutionContext_ACU, allowDelegate: boolean): string {
  const lines = [
    `你上一次的输出没有被采纳。原因：${reason}`,
    'read 与 search 使用函数调用，不要写成 JSON。推理写在思维链里，闭合后再输出一个决策 JSON（不要 Markdown 围栏），格式必须是下面之一：',
  ];
  const hasTurn = !!execution.turn;
  if (!hasTurn && allowDelegate) {
    lines.push('{"thought":"先建立大纲","action":"delegate","delegations":[{"agentName":"outline-architect","prompt":"按总纲当前 active 卷规划本阶段","reads":[]}]}');
  }
  lines.push('核对资料时调用 read 函数，参数 {"reads":["$STORY_TAIL","$HOOKS_LEDGER"]}。');
  if (allowDelegate) {
    lines.push('{"thought":"先结算再策划","action":"delegate","delegations":[{"agentName":"hook-cognition-maintainer","prompt":"结算未结算正文，对照上一轮目标评估达成度","reads":[]},{"agentName":"mainline-planner","prompt":"本轮 pacing=setup，允许主线 hold","reads":[]}]}');
  }
  if (hasTurn) {
    lines.push('{"thought":"证据已足够","action":"finalize","instruction":"承接：……\\n本轮场景任务：……\\n必须发生的变化：……","summary":"一句话要点"}');
  }
  lines.push('{"thought":"关键资料缺失","action":"block","reason":"……","unresolved":["……"]}');
  return lines.join('\n');
}

/**
 * 生成本次运行的会话标题。
 * @param context 解析上下文
 * @returns 形如「第 2 阶段 · 第 3/6 轮」或「大纲待创建」的标题
 */
function describeRunLabel_ACU(context: AgentResolveContext_ACU): string {
  const execution = context.execution;
  if (!execution.stage) return '大纲待创建';
  if (execution.stage.status === 'completed') return `第 ${execution.stage.stageNumber} 阶段已完成 · 待继续大纲`;
  if (!execution.revision || execution.turnNumber === null) return `第 ${execution.stage.stageNumber} 阶段 · 大纲待确认`;
  return `第 ${execution.stage.stageNumber} 阶段 · 第 ${execution.turnNumber}/${execution.revision.outline.totalTurns} 轮`;
}

/**
 * 描述一个协议动作，用作会话流标题与会话记录的 digest。
 * @param action 已解析的主 Agent 动作
 * @returns 一句话动作标签
 */
export function describeAgentActionLabel_ACU(action: AgentMainAction_ACU): string {
  if (action.kind === 'tools') return `调用 ${action.calls.length} 个 read/search 工具`;
  if (action.kind === 'delegate') return `派工 ${action.delegations.length} 项`;
  if (action.kind === 'open_round') return '开局并交给固定工作流';
  if (action.kind === 'finalize') return '交付写作指导';
  return '阻断本轮';
}

/** 只把可回读的资料版本、待修复模块及受控步骤状态回灌主会话，不回灌子代理输出。 */
function renderWorkflowReceipt_ACU(workflow: ContinuationWorkflowResult_ACU): string {
  return JSON.stringify({
    outcome: workflow.outcome,
    revisions: workflow.snapshot.revisions,
    pending: workflow.pendingFixes.map(item => ({ module: item.module, completion: item.completion, acceptedKeys: item.acceptedKeys, violations: item.violations, lastError: item.lastError })),
    steps: workflow.steps.map(item => ({ agentName: item.agentName, status: item.status })),
  });
}

/**
 * 生成新轮次的开场通告。相当于人类在会话里下发一个新任务，让主 Agent 明确知道换轮了。
 * @param context 解析上下文
 * @returns 通告正文
 */
export function buildAgentTurnAnnouncement_ACU(context: AgentResolveContext_ACU, previousRoundDiscarded = false): string {
  return [
    `开始新的一轮规划：${describeRunLabel_ACU(context)}`,
    `本轮目标：${context.execution.turn?.goal || '（尚无可执行的大纲轮次，需先创建或继续大纲）'}`,
    previousRoundDiscarded
      ? '请按协议输出一个动作。上一轮已在工作流结束时收束，不要确认或续接上一轮对话。'
      : '请按协议输出一个动作。上文中我们此前的对话仍然有效，不要重复已经完成的工作。',
  ].join('\n');
}

/**
 * 渲染本轮预算状态。
 * @param budget 预算配置
 * @param iteration 当前迭代序号，从 1 开始
 * @param ledger 运行账本
 * @param waveLimit 本轮实际可用的同波次并发上限
 * @param tool 可选的 read/search 用量（批次数、累计遥测、单批次上限 M）
 * @returns 自然语言文本；进入最后一轮时明确禁止继续派工
 */
export function renderAgentBudget_ACU(
  budget: AgentRunBudget_ACU,
  iteration: number,
  ledger: AgentRunLedger_ACU,
  waveLimit: number,
  tool?: { batchesUsed: number; grantedTokens: number; maxReadTokens: number },
  lifecycle?: { outlineMaintenanceReserveAvailable: boolean; convergenceOnly: boolean },
): string {
  const isFinal = iteration >= budget.maxIterations;
  const lines = [
    `迭代：第 ${iteration} / ${budget.maxIterations} 次（read/search 工具批次不计入迭代，放心读取）`,
    `派工：已用 ${ledger.delegationsUsed} / ${budget.maxDelegations} 次`,
    `单代理上限：同一代理最多 ${budget.maxSameAgent} 次`,
    `并发上限：同一波次最多 ${waveLimit} 个子代理`,
  ];
  if (tool) {
    lines.push(`read/search：已用 ${tool.batchesUsed} / ${budget.maxReads} 个工具批次；单批次上限约 ${tool.maxReadTokens} tokens（本次累计已读取约 ${tool.grantedTokens} tokens，仅作遥测，不扣减后续批次额度）`);
    lines.push('单批次读取过大时，先用 search 定位、再缩小到正文楼层区间、表格行区间或模块 ID；不同批次不共享 token 额度。临近总结阈值时，只有不超过精读兜底额度的小批次会被放行，随后由总结机制处理。世界书目录与命中提示里每条都标注了 token 估算，按本轮需求精读。');
  }
  if (lifecycle?.convergenceOnly) {
    lines.push('CONVERGENCE_ONLY：必要的大纲维护已完成，本次只允许输出 finalize 或 block；不得继续派工。');
  } else if (lifecycle?.outlineMaintenanceReserveAvailable) {
    lines.push('FINAL_MAINTENANCE_RESERVE：当前没有可执行大纲。仅可委派一次 outline-architect 创建、继续或维护阶段大纲；其他代理仍被禁用。维护完成后必须 finalize 或 block。');
  } else {
    lines.push(isFinal
      ? 'FINAL_ITERATION：本轮已是最后一次迭代，delegate 已被禁用。请基于现有证据输出 finalize；关键信息确实缺失时输出 block，不许伪造。'
      : '预算充足，可以继续派工。读取与派工每轮的正常开销，不算浪费；证据与建议都齐了就立刻 finalize，不要为「或许还能更好」反复加派。');
  }
  return lines.join('\n');
}

/**
 * 渲染一批工具结果。作为工具消息追加进会话记录，也用于兼容自定义提示词里的 `$TOOL_RESULTS`。
 * @param outcomes 待渲染的派工结论
 * @returns 自然语言文本；列表为空时如实标注
 */
export function renderAgentToolResults_ACU(outcomes: readonly AgentDelegationOutcome_ACU[]): string {
  if (!outcomes.length) return '本轮尚未派工，还没有任何子代理结果。';
  return outcomes
    .map((outcome, index) => {
      const head = `【结果 ${index + 1}｜${outcome.agentName}｜${outcome.ok ? '成功' : '失败'}】`;
      const body = outcome.ok
        ? [outcome.summary ? `摘要：${outcome.summary}` : '', outcome.detail].filter(Boolean).join('\n')
        : `未采用，原因：${outcome.rejectedReason}`;
      return `${head}\n${body}`;
    })
    .join('\n\n');
}

/** 参与波次并发判定的四个派工子代理渠道角色。 */
const SUBAGENT_PRESET_ROLES_ACU = ['maintainer', 'mainlinePlanner', 'beatPlanner', 'reviewer'] as const;

/** 参与波次并发判定的子代理渠道角色：网页检索未启用时不派它，其渠道也就不该拖累并发。 */
function subagentPresetRoles_ACU(settings: ContinuationSettings_ACU): ReadonlyArray<typeof SUBAGENT_PRESET_ROLES_ACU[number] | 'webResearcher'> {
  return settings.webResearch?.enabled ? [...SUBAGENT_PRESET_ROLES_ACU, 'webResearcher'] : SUBAGENT_PRESET_ROLES_ACU;
}

/**
 * 开场检索的派工文案：只在任务刚创建、资料库为空时由运行时自动发起。
 * 检索清单的来源（用户初始要求、世界书目录、角色表）已固定注入子代理提示词，这里只交代范围与边界。
 */
function buildOpeningResearchPrompt_ACU(originInstruction: string): string {
  return [
    '开场检索：这是一个新续写任务的第一次规划，百科资料库还是空的。',
    '请从用户初始要求、世界书目录、角色表与最近正文里识别这个故事依托的原作与已登场的原作实体（人物、组织、地点、能力、术语），按对开篇写作的重要度排序，优先把主角、核心配角、核心设定与世界规则查清并入库。',
    '只登记原作/公开设定常识，不把本故事正文写成原作事实；世界书已详细覆盖的条目不必重复查。',
    '查不到的实体在 summary 里如实列出，不要硬凑。',
    originInstruction ? `用户初始要求原文：${originInstruction}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * 计算同波次实际可用的并发上限。
 * @param settings 续写设置
 * @param budget 预算配置
 * @returns 并发上限；任一子代理角色的生效渠道为「跟随当前活动 API」时为 1，
 *          因为主 API 的归因机制不支持并发内部请求
 */
function resolveWaveLimit_ACU(settings: ContinuationSettings_ACU, budget: AgentRunBudget_ACU): number {
  const hasCurrentChannel = subagentPresetRoles_ACU(settings).some(role => effectiveAgentApiPresetMode_ACU(settings, role) === 'current');
  return hasCurrentChannel ? 1 : Math.max(1, budget.maxConcurrent);
}

function describePlannerOutcome_ACU(summary: string, recommendation: string, mustPreserve: readonly string[], risks: readonly string[]): string {
  return [
    recommendation ? `建议：${recommendation}` : '',
    mustPreserve.length ? `必须保留：${mustPreserve.join('；')}` : '',
    risks.length ? `风险：${risks.join('；')}` : '',
    summary && !recommendation ? `摘要：${summary}` : '',
  ].filter(Boolean).join('\n');
}

function fingerprintFinalReviewCandidate_ACU(instruction: string): string {
  let hash = 2166136261;
  for (let index = 0; index < instruction.length; index += 1) {
    hash ^= instruction.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${instruction.length}:${(hash >>> 0).toString(16)}`;
}

function renderFinalReviewFeedback_ACU(
  status: 'completed' | 'failed' | 'interrupted',
  candidateFingerprint: string,
  candidateSummary: string,
  detail: string,
): string {
  const title = status === 'completed' ? '【发送前终审反馈】' : '【发送前终审未完成】';
  return [
    title,
    `候选标识：${candidateFingerprint}`,
    `候选摘要：${candidateSummary}`,
    detail,
    '这是一次性终审的最终回灌。请据此修订指导、派责任代理维护权威计划，或 block；本轮后续 finalize 不会再次触发终审。',
  ].join('\n');
}

const FINAL_REVIEW_STATE_DIGEST_ACU = '发送前终审状态';

function normalizeFinalReviewState_ACU(value: unknown): AgentFinalReviewResumeState_ACU | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const status = raw.status;
  if (typeof status !== 'string' || !(AGENT_FINAL_REVIEW_STATUSES_ACU as readonly string[]).includes(status)) return null;
  if (typeof raw.candidateFingerprint !== 'string' || typeof raw.candidateSummary !== 'string' || typeof raw.feedback !== 'string') return null;
  return {
    status: status as AgentFinalReviewResumeState_ACU['status'],
    candidateFingerprint: raw.candidateFingerprint,
    candidateSummary: raw.candidateSummary,
    feedback: raw.feedback,
  };
}

function renderFinalReviewStateRecord_ACU(taskId: string, state: AgentFinalReviewResumeState_ACU): string {
  return `【发送前终审状态】\n${JSON.stringify({ schemaVersion: 1, taskId, ...state })}`;
}

function readFinalReviewStateFromConversation_ACU(snapshot: AgentConversationSnapshot_ACU, taskId: string, turnKey: string): AgentFinalReviewResumeState_ACU | null {
  for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
    const message = snapshot.messages[index];
    if (!message || message.turnKey !== turnKey || message.digest !== FINAL_REVIEW_STATE_DIGEST_ACU) continue;
    const separator = message.text.indexOf('\n');
    if (separator < 0) continue;
    try {
      const raw = JSON.parse(message.text.slice(separator + 1));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || (raw as Record<string, unknown>).taskId !== taskId) continue;
      const state = normalizeFinalReviewState_ACU(raw);
      if (state) return state;
    } catch {
      // 损坏的历史状态记录不能阻断新轮次；继续寻找更早的合法记录。
    }
  }
  return null;
}

/**
 * 读取当前阶段游标（stageId + revision）。任务被删除或信封损坏时返回 null：
 * 调用方把它当作「无法确认游标」，而不是猜测一个游标继续。
 */
const readCurrentStageCursor_ACU = (request: ContinuationAgentTurnPlanRequest_ACU): { stageId: string | null; revision: number | null } | null => {
  try {
    const execution = request.readContext();
    return { stageId: execution.stage?.stageId ?? null, revision: execution.revision?.revision ?? null };
  } catch {
    return null;
  }
};

/** 主 Agent 轮次规划器。替代 V7 的一次性指令生成器，对外只暴露 plan 一个入口。 */
export class ContinuationAgentTurnPlanner_ACU {
  private readonly dependencies: ContinuationAgentTurnPlannerDependencies_ACU;
  constructor(dependencies: Partial<ContinuationAgentTurnPlannerDependencies_ACU> = {}) {
    const nativeTools = dependencies.nativeTools === true;
    this.dependencies = {
      ...defaultDependencies_ACU,
      ...dependencies,
      nativeTools,
      subagentRuntime: dependencies.subagentRuntime ?? (nativeTools
        ? new AgentSubagentRuntime_ACU({ nativeTools: true })
        : defaultDependencies_ACU.subagentRuntime),
    };
  }

  /**
   * 跑完一轮 Agent 循环，产出最终写作指导。
   * @param request 设置、执行快照、身份工厂与大纲改写回调
   * @param apiDependencies 可选的 API 预设依赖，用于测试注入
   * @returns 最终指导与本轮使用的 API 预设信息
   */
  async plan(request: ContinuationAgentTurnPlanRequest_ACU, apiDependencies?: ContinuationApiPresetDependencies_ACU): Promise<ContinuationAgentTurnPlanResult_ACU> {
    const preset = this.dependencies.resolveApiPreset(request.settings, 'main', 'turn_call', apiDependencies);
    // 运行预算优先取用户设置（UI 可调），测试注入的 dependencies.budget 与旧信封回落默认值。
    const budget: AgentRunBudget_ACU = request.settings.agentRunBudget ?? this.dependencies.budget;
    const chat = this.dependencies.readChat();
    let snapshot = this.dependencies.readModuleSnapshot(chat);
    const context: AgentResolveContext_ACU = {
      chat,
      moduleSnapshot: snapshot,
      settledThroughIndex: snapshot.settledThroughIndex,
      execution: request.readContext(),
      originInstruction: '',
      storyWindowFloors: request.settings.storyWindowFloors,
      storyTailFloors: request.settings.storyTailFloors,
      // 提取/排除规则在运行起点归一化一次，所有正文出口（目录/区间/尾楼/未结算/搜索源）统一应用。
      contextRules: { extractRules: request.settings.contextExtractRules, excludeRules: request.settings.contextExcludeRules },
      // 剧情推进 AI 的召回结果落在最后一个用户楼层里，直接抽 AM 码复用，零额外 AI 调用。
      recallCodes: extractAgentRecallCodesFromChat_ACU(chat),
    };
    context.originInstruction = context.execution.task.originInstruction;
    // 世界书快照在运行起点预取一次：read/search 是同步寻址，而宿主世界书接口是异步的。
    // 预取失败降级为「目录不可用」快照，绝不让世界书问题掐断整轮规划。
    try {
      context.worldbook = await this.dependencies.loadWorldbook();
    } catch {
      context.worldbook = buildEmptyAgentWorldbookSnapshot_ACU(false);
    }
    const gateConfig: AgentReadGateConfig_ACU = {
      historyTokenBudget: request.settings.agentHistoryTokenBudget,
      readTokenBudget: request.settings.agentReadTokenBudget,
      fallbackTokens: request.settings.agentReadFallbackTokens,
    };
    // 中断恢复不复播门禁账本：工具结果已持久在会话里，恢复后重读同一地址会被去重挡下，
    // 账本从零起算只是给恢复后的运行一份完整的读取额度。
    const toolUsage: AgentToolUsage_ACU = {
      batchesUsed: 0,
      gateState: createAgentReadGateState_ACU(),
      granted: new Set(),
      invalidated: new Set(),
    };
    const identitySeed = request.createInternalRequestIdentity(0);
    const cursorKeyOf = (): string => {
      const execution = request.readContext();
      const moduleSnapshot = context.moduleSnapshot;
      return `${execution.stage?.stageId ?? 'pre-outline'}#${execution.revision?.revision ?? 0}#${execution.turn?.id ?? ''}#arc:${moduleSnapshot.revisions.storyArc}#settled:${moduleSnapshot.settledThroughIndex}`;
    };
    const conversationTurnKeyOf = (): string => {
      const execution = request.readContext();
      return `${execution.stage?.stageId ?? 'pre-outline'}#${execution.revision?.revision ?? 0}#${execution.turn?.id ?? ''}`;
    };
    // 中断恢复：上次运行在同任务同游标下失败时，带着已获得的证据从中断迭代继续，
    // 而不是丢掉全部派工结论从头重跑。游标或任务变了的旧状态由缓存层作废。
    const resumedState = readAgentRunState_ACU(identitySeed.chatIdentity, identitySeed.taskId, cursorKeyOf());
    const ledger: AgentRunLedger_ACU = resumedState
      ? { delegationsUsed: resumedState.ledger.delegationsUsed, perAgent: new Map(Object.entries(resumedState.ledger.perAgent)), outcomes: resumedState.ledger.outcomes }
      : { delegationsUsed: 0, perAgent: new Map(), outcomes: [] };
    let ledgerCursorKey = cursorKeyOf();
    let finalReview: AgentFinalReviewResumeState_ACU = { status: 'not_started', candidateFingerprint: '', candidateSummary: '', feedback: '' };
    let postReviewDecisionAvailable = false;
    let outlineMaintenanceReserveUsed = false;
    let maintenanceConvergenceAvailable = false;
    // 上次迭代耗尽后恢复时收敛到最后一次迭代：派工被禁用，主 Agent 必须基于已有证据交付或阻断。
    const iterationStart = resumedState ? Math.min(Math.max(1, resumedState.nextIteration), budget.maxIterations) : 1;
    const persistRunState = (nextIteration: number): void => saveAgentRunState_ACU(identitySeed.chatIdentity, {
      taskId: identitySeed.taskId,
      cursorKey: cursorKeyOf(),
      nextIteration,
      ledger: { delegationsUsed: ledger.delegationsUsed, perAgent: Object.fromEntries(ledger.perAgent), outcomes: ledger.outcomes },
      finalReview,
    });
    let totalAttempts = 0;
    let terminalLogged = false;
    let lastConstraintRejection = '';
    let currentIteration = iterationStart;
    const resetLedgerForAuthorityChange = (): void => {
      const currentCursorKey = cursorKeyOf();
      if (currentCursorKey === ledgerCursorKey) return;
      ledger.delegationsUsed = 0;
      ledger.perAgent.clear();
      ledgerCursorKey = currentCursorKey;
    };
    beginAgentSessionRun_ACU(
      describeRunLabel_ACU(context),
      resumedState
        ? `从中断点恢复：继续第 ${iterationStart} 次迭代，已保留 ${ledger.outcomes.length} 条已完成结果`
        : context.execution.turn?.goal ?? '本轮目标待大纲确定',
      resumedState !== null,
    );
    // 阈值统计的是主 Agent 实际读取的完整上下文，而不只是会话历史。开销部分（提示词骨架、
    // 正文摘取、资料目录等）按首次迭代的真实渲染结果实测并记忆化；历史哨兵那条不发送，不计入。
    // 压缩判定与读取门禁共用这一口径，量到的就是发出去的。
    const counter = createAgentTokenCounter_ACU(this.dependencies.countTokens ?? countAgentTokens_ACU);
    let overheadTokensCache: number | null = null;
    const measureOverhead = async (): Promise<number> => {
      if (overheadTokensCache === null) {
        const rendered = await this.renderMainPrompt_ACU(request, context, ledger, budget, iterationStart, toolUsage, gateConfig);
        overheadTokensCache = await measureAgentPromptTokens_ACU(rendered.filter(message => !message.content.includes(HISTORY_SENTINEL_ACU)), counter);
      }
      return overheadTokensCache;
    };
    // 会话在 beginAgentSessionRun_ACU 之后打开：压缩/阈值通知按时间顺序
    // 落在本次运行的分隔条之后，用户能看出它属于哪一次运行。
    const handoffSemanticAdapter = createAgentHandoffSemanticSummaryAdapter_ACU(async (messages): Promise<string | null> => {
      const base = request.createInternalRequestIdentity(0);
      if (!request.isInternalRequestCurrent(base)) throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'agent_loop', '交接摘要请求已失效', false));
      const identity: ContinuationInternalAiRequestIdentity_ACU = {
        ...base,
        requestId: `${base.requestId || base.attemptId || 'turn'}-handoff-summary`,
        source: 'handoff_summary',
      };
      const value = await this.dependencies.callInternalAi(messages, preset, identity, request.signal, { promptCacheEnabled: false, cacheScope: 'handoff-summary' });
      if (typeof value === 'object' && value) return value.content;
      return (value ?? null) as string | null;
    });
    const session = await this.openConversation_ACU(chat, request, context, conversationTurnKeyOf(), counter, measureOverhead, handoffSemanticAdapter, apiDependencies);
    snapshot = context.moduleSnapshot;
    if (request.settings.finalReview.enabled) {
      finalReview = resumedState?.finalReview ?? readFinalReviewStateFromConversation_ACU(session.snapshot(), identitySeed.taskId, session.turnKey) ?? finalReview;
      postReviewDecisionAvailable = finalReview.status === 'feedback_ready';
    } else {
      finalReview = { ...finalReview, status: 'consumed' };
    }
    const recordFinalReviewState = async (): Promise<void> => {
      if (!request.settings.finalReview.enabled) return;
      session.record([{
        kind: 'runtime',
        text: renderFinalReviewStateRecord_ACU(identitySeed.taskId, finalReview),
        digest: FINAL_REVIEW_STATE_DIGEST_ACU,
        turnKey: session.turnKey,
      }]);
      await session.flush();
    };
    /** 门禁的 H：主 Agent 当前实际读取的完整上下文（骨架开销 + 实时会话历史）。 */
    const measureContextTokens = async (): Promise<number> =>
      (await measureOverhead()) + await measureAgentPromptTokens_ACU(session.history(), counter);
    // 换轮通告只在游标真的变了时追加：同一轮内的中断恢复不重复通告，否则模型会以为又开了一轮。
    if (session.turnKey && lastAnnouncedTurnKey_ACU(session.snapshot()) !== session.turnKey) {
      const visible = session.snapshot().messages;
      const previousRoundDiscarded = visible.length === 1 && visible[0].kind === 'handoff' && visible[0].text.includes('已整段丢弃');
      session.record([{ kind: 'turn', text: buildAgentTurnAnnouncement_ACU(context, previousRoundDiscarded), digest: describeRunLabel_ACU(context), turnKey: session.turnKey }]);
      await session.flush();
    }

    // 缓存写入 reviewing 后进程若中断，不能重复付费审查。改为可诊断的反馈，让主 Agent 明确裁决。
    if (request.settings.finalReview.enabled && finalReview.status === 'reviewing') {
      finalReview = {
        ...finalReview,
        status: 'feedback_ready',
        feedback: renderFinalReviewFeedback_ACU('interrupted', finalReview.candidateFingerprint, finalReview.candidateSummary, '终审请求在拿到可用结论前中断，未将其视为通过。请依据现有资料修订、补证或 block。'),
      };
      session.record([{ kind: 'tool', text: finalReview.feedback, digest: '发送前终审中断', turnKey: session.turnKey }]);
      await session.flush();
      await recordFinalReviewState();
      persistRunState(iterationStart);
      postReviewDecisionAvailable = true;
    }

    /** 把本次动作新产生的运行时结论作为工具消息追加进会话，让下一次迭代按真实 role 读到它。 */
    const commitOutcomes = async (before: number): Promise<void> => {
      const fresh = ledger.outcomes.slice(before);
      if (fresh.length) {
        session.record([{
          kind: 'tool',
          text: renderAgentToolResults_ACU(fresh),
          digest: fresh.map(outcome => `${outcome.agentName}${outcome.ok ? '成功' : '未采用'}`).join('、'),
          turnKey: session.turnKey,
        }]);
      }
      await session.flush();
    };

    try {
      await this.ensureRuntimeSnapshot_ACU(request, session, context, ledger, budget, iterationStart, toolUsage, gateConfig);
      // 开场检索：新任务第一次规划、资料库为空时，先把原作设定查进百科资料库再让主 Agent 开跑。
      // 受控入口，不消耗主 Agent 的派工额度；失败只记结果不掐断规划。
      if (this.shouldRunOpeningResearch_ACU(request, context, resumedState !== null)) {
        const outcomesBefore = ledger.outcomes.length;
        snapshot = await this.runOpeningResearch_ACU(request, context, ledger, budget, chat, snapshot, session, apiDependencies);
        await commitOutcomes(outcomesBefore);
      }
      // 工具批次（read/search）不消耗决策迭代：读资料是正常成本，不该挤压派工与交付的空间。
      // totalCalls 是防死循环的硬上限——模型反复发工具批次时由 maxReads 与它双重兜底。
      const totalCallLimit = budget.maxIterations + budget.maxReads + 4;
      let totalCalls = 0;
      let iteration = iterationStart;
      while (iteration <= budget.maxIterations || postReviewDecisionAvailable || maintenanceConvergenceAvailable) {
        if (request.signal?.aborted) {
          throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'agent_loop', '本轮规划已被用户中断', false));
        }
        totalCalls += 1;
        if (totalCalls > totalCallLimit) {
          failLoop_ACU('CONTINUATION_AGENT_ITERATIONS_EXHAUSTED', `主 Agent 总调用数已达硬上限 ${totalCallLimit}（决策迭代 + 工具批次），仍未交付最终指导`, { delegationsUsed: ledger.delegationsUsed, totalCalls });
        }
        // 大纲操作会改变游标，每次迭代都从权威状态重读执行上下文。
        context.execution = request.readContext();
        resetLedgerForAuthorityChange();
        currentIteration = iteration;
        persistRunState(iteration);
        const noExecutableOutline = !context.execution.turn;
        const outlineMaintenanceReserveAvailable = !maintenanceConvergenceAvailable
          && !outlineMaintenanceReserveUsed
          && noExecutableOutline
          && !!request.applyOutline
          && (iteration >= budget.maxIterations || ledger.delegationsUsed >= budget.maxDelegations);
        const allowDelegate = !maintenanceConvergenceAvailable
          && ((iteration < budget.maxIterations && ledger.delegationsUsed < budget.maxDelegations) || outlineMaintenanceReserveAvailable);
        const lifecycle = { outlineMaintenanceReserveAvailable, convergenceOnly: maintenanceConvergenceAvailable };
        await this.ensureRuntimeSnapshot_ACU(request, session, context, ledger, budget, iteration, toolUsage, gateConfig, lifecycle);
        const round = await this.callMainAgent(request, preset, session, counter, context, ledger, budget, iteration, allowDelegate, toolUsage, gateConfig, lifecycle);
        snapshot = context.moduleSnapshot;
        totalAttempts += round.attempts;
        const action = round.action;
        logAgentSession_ACU({
          kind: 'thought',
          title: `迭代 ${iteration} · ${describeAgentActionLabel_ACU(action)}${round.usage ? ` · ${formatAgentUsageLabel_ACU(round.usage)}` : ''}`,
          detail: action.thought,
        });
        const outcomesBefore = ledger.outcomes.length;

        if (maintenanceConvergenceAvailable && action.kind !== 'finalize' && action.kind !== 'block' && action.kind !== 'open_round') {
          failLoop_ACU(
            'CONTINUATION_AGENT_PROTOCOL_INVALID',
            '必要大纲维护完成后只允许 finalize 或 block，不能继续读取或派工。',
            { action: action.kind },
          );
        }

        if (postReviewDecisionAvailable && action.kind !== 'tools') {
          logAgentSession_ACU({
            kind: 'thought',
            title: `迭代 ${iteration} · 终审反馈后的主 Agent 动作`,
            detail: `协议动作：${action.kind}`,
          });
          finalReview = { ...finalReview, status: 'consumed' };
          postReviewDecisionAvailable = false;
          await recordFinalReviewState();
          persistRunState(iteration);
        }

        if (action.kind === 'tools') {
          // 不推进 iteration：工具批次不占决策迭代额度。
          await this.runToolBatch_ACU(action.calls, session, context, toolUsage, gateConfig, budget, counter, measureContextTokens, iteration, round.nativeCalls);
          continue;
        }

        if (action.kind === 'open_round') {
          const workflowEntry = logAgentSession_ACU({ kind: 'delegation', title: '固定工作流正在执行', detail: action.focus, status: 'running' });
          let workflow: ContinuationWorkflowResult_ACU;
          try {
            workflow = await this.runFixedWorkflow_ACU(action, request, context, ledger, budget, chat, session, apiDependencies);
          } catch (error) {
            updateAgentSession_ACU(workflowEntry, { title: '固定工作流失败', detail: error instanceof Error ? error.message : String(error), ok: false });
            throw error;
          }
          snapshot = context.moduleSnapshot;
          updateAgentSession_ACU(workflowEntry, {
            title: `固定工作流：${workflow.outcome}`,
            detail: workflow.summary,
            ok: workflow.outcome === 'deliver',
          });
          session.record([{ kind: 'tool', text: renderWorkflowReceipt_ACU(workflow), digest: '工作流状态回执', turnKey: session.turnKey }]);
          await session.flush();
          if (workflow.outcome === 'deliver') {
            try {
              await request.updateTurnLabel?.(action.focus.trim());
            } catch (error) {
              logAgentSession_ACU({ kind: 'thought', title: '轮次标注未保存', detail: error instanceof Error ? error.message : String(error), ok: false });
            }
            logAgentSession_ACU({ kind: 'finalize', title: '最终写作指导', detail: workflow.instruction });
            logAgentSession_ACU({ kind: 'run_completed', title: '本轮规划完成', detail: workflow.summary });
            terminalLogged = true;
            clearAgentRunState_ACU(identitySeed.chatIdentity);
            await session.flush();
            await session.discardPreviousRound();
            return { instruction: workflow.instruction, attempts: totalAttempts, apiPreset: { presetName: preset.presetName, source: preset.source, reason: preset.reason } };
          }
          session.record([{ kind: 'tool', text: `${workflow.summary}\n资料维护未合格，请向用户说明缺口；总纲与阶段大纲仍由后续 open_round 固定工作流维护，只有网页检索可按需 delegate web-researcher。不要对同一批已升级的待修复项再次 open_round。`, digest: '工作流升级主会话', turnKey: session.turnKey }]);
          await session.flush();
          iteration += 1;
          continue;
        }

        if (action.kind === 'finalize') {
          if (request.settings.finalReview.enabled && finalReview.status !== 'consumed') {
            const candidateFingerprint = fingerprintFinalReviewCandidate_ACU(action.instruction);
            const candidateSummary = action.instruction.slice(0, 500);
            finalReview = { status: 'reviewing', candidateFingerprint, candidateSummary, feedback: '' };
            persistRunState(iteration);
            await recordFinalReviewState();
            try {
              const review = await this.dependencies.subagentRuntime.runFinalReview({
                settings: request.settings,
                resolveContext: context,
                mainSnapshot: this.subagentTail_ACU(session),
                candidateInstruction: action.instruction,
                currentUserInput: context.originInstruction,
                planningSummary: action.summary,
                createIdentity: (_agentName, attempt) => ({ ...request.createInternalRequestIdentity(attempt), source: 'agent_subagent' }),
                isCurrent: identity => request.isInternalRequestCurrent(identity),
                signal: request.signal,
              });
              const output = review.output;
              finalReview = {
                status: 'feedback_ready',
                candidateFingerprint,
                candidateSummary,
                feedback: renderFinalReviewFeedback_ACU(
                  'completed',
                  candidateFingerprint,
                  candidateSummary,
                  [
                    `判词：${output.verdict}`,
                    output.summary ? `摘要：${output.summary}` : '',
                    output.emotionFindings.length ? `人物情绪：${output.emotionFindings.join('；')}` : '',
                    output.worldFindings.length ? `世界书与世界观：${output.worldFindings.join('；')}` : '',
                    output.logicFindings.length ? `逻辑边界：${output.logicFindings.join('；')}` : '',
                    output.requiredFixes.length ? `必须修正：${output.requiredFixes.join('；')}` : '',
                    output.preserve.length ? `必须保留：${output.preserve.join('；')}` : '',
                  ].filter(Boolean).join('\n'),
                ),
              };
              const supplementalSearches = review.expandedReads.filter(label => label.startsWith('search ')).length;
              const supplementalReads = review.expandedReads.length - supplementalSearches;
              logAgentSession_ACU({
                kind: 'thought',
                title: `迭代 ${iteration} · 发送前终审遥测`,
                detail: [`判词：${output.verdict}`, '初始世界书：仅目录与命中预览，不自动精读全文', `补充调阅：read ${supplementalReads} 次，search ${supplementalSearches} 次`, `独立读取：${review.readTokens} tokens`, `工具轮：${review.toolRounds}`, `模型用量：${review.usage ? formatAgentUsageLabel_ACU(review.usage) : '未报告'}`].join('\n'),
              });
            } catch (error) {
              if (error instanceof ContinuationValidationError_ACU && error.error.code === 'CONTINUATION_INTERNAL_REQUEST_STALE') {
                throw error;
              }
              const reason = error instanceof ContinuationValidationError_ACU ? error.error.message : error instanceof Error ? error.message : String(error);
              finalReview = {
                status: 'feedback_ready',
                candidateFingerprint,
                candidateSummary,
                feedback: renderFinalReviewFeedback_ACU('failed', candidateFingerprint, candidateSummary, `终审调用失败：${reason}`),
              };
            }
            session.record([
              { kind: 'tool', text: finalReview.feedback, digest: '发送前终审反馈', turnKey: session.turnKey },
              { kind: 'runtime', text: renderFinalReviewStateRecord_ACU(identitySeed.taskId, finalReview), digest: FINAL_REVIEW_STATE_DIGEST_ACU, turnKey: session.turnKey },
            ]);
            await session.flush();
            persistRunState(iteration);
            postReviewDecisionAvailable = true;
            logAgentSession_ACU({ kind: 'thought', title: `迭代 ${iteration} · 发送前终审完成`, detail: finalReview.feedback });
            iteration += 1;
            continue;
          }
          if (action.constraints) {
            // 约束登记校验失败不终止本轮：把拒绝原因（含活跃约束清单回显）回灌，让主 Agent
            // 在剩余迭代内修正登记，与大纲工具编辑、子代理写集失败的处理同构。只有非校验类异常才上抛。
            // 最后一轮例外：此时回灌已无修正机会，登记降级为警告并照常交付，绝不让约束问题烧掉唯一的交付机会。
            let constraintsApplied = true;
            try {
              snapshot = (await applyAgentConstraintRegistrationViaSql_ACU(snapshot, action.constraints.add, action.constraints.retire, chat.length - 1)).snapshot;
            } catch (error) {
              if (!(error instanceof ContinuationValidationError_ACU) || error.error.code !== 'CONTINUATION_AGENT_WRITE_REJECTED') throw error;
              constraintsApplied = false;
              lastConstraintRejection = error.error.message;
              if (iteration < budget.maxIterations) {
                ledger.outcomes.push({ agentName: 'finalize(约束登记)', ok: false, summary: '', detail: '', rejectedReason: `${error.error.message}。finalize 未被采纳，请修正 constraints 后重新交付` });
                logAgentSession_ACU({ kind: 'protocol_retry', title: `迭代 ${iteration} · 约束登记被拒绝`, detail: error.error.message, ok: false });
                await commitOutcomes(outcomesBefore);
                iteration += 1;
                continue;
              }
              logAgentSession_ACU({ kind: 'protocol_retry', title: `迭代 ${iteration} · 约束登记被拒绝，已跳过登记并照常交付`, detail: error.error.message, ok: false });
            }
            if (constraintsApplied) {
              context.moduleSnapshot = snapshot;
              await this.persistSnapshot_ACU(chat, snapshot);
            }
          }
          logAgentSession_ACU({ kind: 'finalize', title: '最终写作指导', detail: action.instruction });
          logAgentSession_ACU({ kind: 'run_completed', title: '本轮规划完成', detail: action.summary });
          terminalLogged = true;
          clearAgentRunState_ACU(identitySeed.chatIdentity);
          await session.flush();
          return { instruction: action.instruction, attempts: totalAttempts, apiPreset: { presetName: preset.presetName, source: preset.source, reason: preset.reason } };
        }

        if (action.kind === 'block') {
          logAgentSession_ACU({ kind: 'block', title: '主 Agent 阻断本轮', detail: [action.reason, ...action.unresolved].filter(Boolean).join('\n'), ok: false });
          terminalLogged = true;
          // block 是明确的终局判断：重跑应给全新预算重新收集证据，而不是复播旧账本再次阻断。
          clearAgentRunState_ACU(identitySeed.chatIdentity);
          await session.flush();
          failLoop_ACU('CONTINUATION_AGENT_BLOCKED', `主 Agent 阻断本轮：${action.reason}`, { unresolved: action.unresolved });
        }

        const delegationResult = await this.runDelegations(action, request, context, ledger, budget, chat, snapshot, session, apiDependencies, outlineMaintenanceReserveAvailable);
        snapshot = delegationResult.snapshot;
        if (delegationResult.usedOutlineMaintenanceReserve) {
          outlineMaintenanceReserveUsed = true;
          maintenanceConvergenceAvailable = true;
        }
        // 派工可能结算模块或改写大纲：记录既有读取地址后允许重读最新版。
        for (const key of toolUsage.granted) toolUsage.invalidated.add(key);
        toolUsage.granted.clear();
        await commitOutcomes(outcomesBefore);
        iteration += 1;
      }

      failLoop_ACU(
        'CONTINUATION_AGENT_ITERATIONS_EXHAUSTED',
        lastConstraintRejection
          ? `主 Agent 在 ${budget.maxIterations} 次迭代内没有交付最终指导；最后一次约束登记被拒绝：${lastConstraintRejection}`
          : `主 Agent 在 ${budget.maxIterations} 次迭代内没有交付最终指导`,
        { delegationsUsed: ledger.delegationsUsed },
      );
    } catch (error) {
      // 中断即存档（block 除外，其缓存已清）：迭代中途的失败保留已完成的派工结论，
      // 用户再发送时据此从当前迭代恢复而不是从头重跑。
      if (!(error instanceof ContinuationValidationError_ACU && error.error.code === 'CONTINUATION_AGENT_BLOCKED')) {
        persistRunState(Math.min(currentIteration, budget.maxIterations));
      }
      if (!terminalLogged) {
        const message = error instanceof ContinuationValidationError_ACU ? error.error.message : error instanceof Error ? error.message : String(error);
        logAgentSession_ACU({ kind: 'run_failed', title: '本轮已终止', detail: `${message}\n（进度已保留，输入新指令后发送即可继续）`, ok: false });
      }
      throw error;
    }
  }

  /**
   * 打开本次运行的会话句柄：拼接分段持久会话、按 token 阈值做非破坏压缩、提供段追加落盘能力。
   * @param chat 聊天数组
   * @param request 本轮请求（取设置里的 token 阈值）
   * @param turnKey 本次运行的大纲游标指纹
   * @param counter 记忆化 token 计数器（与压缩判定、读取门禁共用）
   * @param measureOverhead 测量会话之外的上下文开销（即将发送的提示词实测值，记忆化）
   * @returns 会话句柄
   */
  private async openConversation_ACU(
    chat: any[],
    request: ContinuationAgentTurnPlanRequest_ACU,
    context: AgentResolveContext_ACU,
    turnKey: string,
    counter: TokenCounter_ACU,
    measureOverhead: () => Promise<number>,
    semanticAdapter: AgentHandoffSemanticSummaryAdapter_ACU,
    apiDependencies?: ContinuationApiPresetDependencies_ACU,
  ): Promise<AgentConversationHandle_ACU> {
    let snapshot = this.dependencies.readConversation(chat);
    // 分段存储下落盘只追加新消息。打开时拼出来的所有消息都已持久，
    // 包括压缩标记合成的 handoff（其 id 等于被浓缩的最大消息 id，不会超过此水位）。
    let persistedThroughId = snapshot.nextId - 1;
    const flush = async (): Promise<void> => {
      const pending = snapshot.messages.filter(message => message.id > persistedThroughId);
      if (!pending.length) return;
      // 没有任何楼层时无处锚定；保持内存态而不是让整轮规划失败——空聊天本身已是退化场景。
      // 末楼由追加函数现取现用，运行中楼层增删后段仍落在真实末楼。
      if (!Array.isArray(chat) || !chat.length) return;
      if (await this.dependencies.appendConversationMessages(chat, pending)) {
        persistedThroughId = pending.reduce((max, message) => Math.max(max, message.id), persistedThroughId);
      }
    };

    const budgetTokens = request.settings.agentHistoryTokenBudget;
    const compact = async (emergency: boolean, preparedMessages?: readonly { role: string; content: string }[]): Promise<boolean> => {
      if (budgetTokens <= 0 || !snapshot.messages.length) return false;
      // 压缩成功后会话视图以持久层回读为准，未落盘的消息必须先写进去，否则会在回读时丢失。
      await flush();
      const overhead = preparedMessages
        ? Math.max(0, (await measureAgentPromptTokens_ACU(preparedMessages, counter)) - (await measureAgentPromptTokens_ACU(renderAgentConversationMessages_ACU(snapshot), counter)))
        : await measureOverhead();
      const next = await this.compactConversation_ACU(chat, snapshot, budgetTokens, overhead, counter, semanticAdapter, emergency, request, context, apiDependencies, preparedMessages);
      if (!next) return false;
      snapshot = next;
      return true;
    };

    const discardPreviousRound = async (): Promise<boolean> => {
      await flush();
      if (!snapshot.messages.length) return false;
      const ids = snapshot.messages.map(message => message.id);
      const throughId = Math.max(...ids);
      const fromId = Math.min(...ids);
      if (throughId <= 0 || fromId <= 0) return false;
      const report = '上一轮主会话已整段丢弃，没有做总结。会话记录、工具调用和运行时快照不带入下一轮。';
      const at = Date.now();
      const turns = new Set(snapshot.messages.map(message => message.turnKey).filter(Boolean));
      const mark: AgentConversationCompactionMarkV2_ACU = {
        schemaVersion: 2,
        compactedThroughId: throughId,
        report,
        summaryState: {
          currentGoal: '', effectiveConstraints: [], decisions: [], completedItems: [], pendingItems: [],
          blockers: [], continuityFacts: [], readKeys: [], recentTurns: [],
        },
        at,
        metrics: {
          sourceFromId: fromId,
          sourceThroughId: throughId,
          beforeTokens: 0,
          afterTokens: 0,
          fixedPromptTokens: 0,
          reportTokens: 0,
          targetTokens: 0,
          triggerTokens: 0,
          droppedMessages: snapshot.messages.length,
          droppedTurns: turns.size,
          degraded: false,
        },
      };
      const expectedMark = this.dependencies.readCompactionMark(chat);
      const source = this.dependencies.readConversation(chat);
      if (fingerprintAgentConversationSource_ACU(source, expectedMark) !== fingerprintAgentConversationSource_ACU(snapshot, expectedMark)) return false;
      const anchor = chat[chat.length - 1];
      if (!anchor || this.dependencies.readChat() !== chat) return false;
      const swipeId = readMessageSwipeId_ACU(anchor);
      const chatIdentity = getActiveChatStorageIdentity_ACU(chat);
      if (!chatIdentity) return false;
      const sourceFingerprint = readAgentConversationCompactionSource_ACU(chat).fingerprint;
      const planCursor = readCurrentStageCursor_ACU(request);
      if (!planCursor) return false;
      if (!request.isInternalRequestCurrent(request.createInternalRequestIdentity(0)) || request.signal?.aborted) return false;
      try {
        if (this.dependencies.readChat() !== chat || getActiveChatStorageIdentity_ACU(chat) !== chatIdentity
          || chat[chat.length - 1] !== anchor || readMessageSwipeId_ACU(anchor) !== swipeId
          || readAgentConversationCompactionSource_ACU(chat).fingerprint !== sourceFingerprint) return false;
        if (!await this.dependencies.writeCompactionMark(chat, mark, { fingerprint: sourceFingerprint, anchor, swipeId, chatIdentity })) return false;
        const persisted = this.dependencies.readCompactionMark(chat);
        if (!persisted || !('summaryState' in persisted) || persisted.compactedThroughId !== throughId || persisted.report !== report) return false;
        const authoritative = this.dependencies.readConversation(chat);
        const discarded = authoritative.messages.length === 1
          && authoritative.messages[0].kind === 'handoff'
          && authoritative.messages[0].text === report;
        if (!discarded) return false;
        snapshot = authoritative;
        logAgentSession_ACU({
          kind: 'handoff',
          title: '上一轮会话已丢弃（此前的会话记录、工具调用和快照对当前 AI 不可见）',
          detail: report,
        });
        return true;
      } catch (error) {
        logAgentSession_ACU({ kind: 'thought', title: '上一轮会话丢弃未提交', detail: error instanceof Error ? error.message : String(error) });
        return false;
      }
    };

    // 开场只保存轮次边界。正常与紧急压缩均在主请求完整渲染后判定，
    // 不再用首次骨架估算替代最终准备发送的消息。
    const continuingSameTurn = !!turnKey && lastAnnouncedTurnKey_ACU(snapshot) === turnKey;
    return {
      snapshot: () => snapshot,
      history: () => renderAgentConversationMessages_ACU(snapshot),
      record: appends => {
        const next = appendAgentConversation_ACU(snapshot, appends);
        if (next === snapshot) return;
        snapshot = next;
      },
      flush,
      compact,
      discardPreviousRound,
      overBudgetNotified: false,
      continuingSameTurn,
      turnKey,
    };
  }

  /**
   * 执行一次非破坏压缩并持久化标记。压缩结果以持久层回读为准：写入后回读不一致视为未提交，
   * 保留旧会话投影而不是拿一份没落盘的视图继续跑。
   * @returns 提交成功时返回回读后的会话视图；无可压缩、写入失败或回读不一致时返回 null
   */
  private async compactConversation_ACU(
    chat: any[],
    snapshot: AgentConversationSnapshot_ACU,
    budgetTokens: number,
    overheadTokens: number,
    counter: TokenCounter_ACU,
    semanticAdapter: AgentHandoffSemanticSummaryAdapter_ACU,
    emergency: boolean,
    request: ContinuationAgentTurnPlanRequest_ACU,
    context: AgentResolveContext_ACU,
    apiDependencies?: ContinuationApiPresetDependencies_ACU,
    preparedMessages?: readonly { role: string; content: string }[],
  ): Promise<AgentConversationSnapshot_ACU | null> {
    const expectedMark = this.dependencies.readCompactionMark(chat);
    const source = this.dependencies.readConversation(chat);
    // No persistent floor may be inferred from an in-memory transcript after a failed flush.
    if (fingerprintAgentConversationSource_ACU(source, expectedMark) !== fingerprintAgentConversationSource_ACU(snapshot, expectedMark)) return null;
    const anchor = chat[chat.length - 1];
    if (!anchor || this.dependencies.readChat() !== chat) return null;
    const swipeId = readMessageSwipeId_ACU(anchor);
    const chatIdentity = getActiveChatStorageIdentity_ACU(chat);
    if (!chatIdentity) return null;
    const sourceFingerprint = readAgentConversationCompactionSource_ACU(chat).fingerprint;
    // 候选只代表规划时刻的阶段游标：摘要生成期间大纲 revision 可能已前进，
    // 提交前必须重新核对，游标无法确认时宁可不压缩也不提交过期候选。
    const planCursor = readCurrentStageCursor_ACU(request);
    if (!planCursor) return null;
    const compaction = await planAgentHistoryCompaction_ACU({
      snapshot: source,
      activeMark: expectedMark,
      triggerTokens: budgetTokens,
      fixedPromptTokens: overheadTokens,
      ...(preparedMessages ? { preparedMessages } : {}),
      countTokens: counter,
      semanticAdapter,
    });
    if (!compaction.mark) return null;
    const candidate = compaction.mark;
    let reread: AgentConversationSnapshot_ACU | null = null;
    try {
      if (!request.isInternalRequestCurrent(request.createInternalRequestIdentity(0)) || request.signal?.aborted) return null;
      const commitCursor = readCurrentStageCursor_ACU(request);
      if (!commitCursor || commitCursor.stageId !== planCursor.stageId || commitCursor.revision !== planCursor.revision) return null;
      if (this.dependencies.readChat() !== chat || getActiveChatStorageIdentity_ACU(chat) !== chatIdentity
        || chat[chat.length - 1] !== anchor || readMessageSwipeId_ACU(anchor) !== swipeId
        || readAgentConversationCompactionSource_ACU(chat).fingerprint !== sourceFingerprint) return null;
      if (await this.dependencies.writeCompactionMark(chat, candidate, { fingerprint: sourceFingerprint, anchor, swipeId, chatIdentity })) {
        const persisted = this.dependencies.readCompactionMark(chat);
        const committed = !!persisted
          && 'summaryState' in persisted
          && persisted.compactedThroughId === candidate.compactedThroughId
          && persisted.report === candidate.report
          && JSON.stringify(persisted.summaryState) === JSON.stringify(candidate.summaryState)
          && JSON.stringify(persisted.metrics) === JSON.stringify(candidate.metrics);
        if (committed) {
          const authoritative = this.dependencies.readConversation(chat);
          const expected = compaction.snapshot.messages.map(item => [item.id, item.kind, item.text]);
          if (JSON.stringify(authoritative.messages.map(item => [item.id, item.kind, item.text])) === JSON.stringify(expected)) reread = authoritative;
        }
      }
    } catch (error) {
      logAgentSession_ACU({ kind: 'thought', title: '会话历史压缩写入失败', detail: error instanceof Error ? error.message : String(error) });
    }
    if (!reread) {
      logAgentSession_ACU({ kind: 'thought', title: '会话历史压缩未提交', detail: '压缩候选未通过持久化回读一致性确认，已保留本次运行的旧会话投影。' });
      return null;
    }
    logAgentSession_ACU({
      kind: 'thought',
      title: `会话历史已压缩（压缩后上下文约 ${compaction.afterTokens} tokens）`,
      detail: [
        `实际读取的完整上下文超出阈值 ${budgetTokens}（其中提示词骨架约 ${overheadTokens} tokens），已把最早的 ${compaction.droppedTurns} 个轮次（${compaction.droppedMessages} 条消息）浓缩成交接报告。`,
        emergency ? `本轮尚未结束，但上下文已达阈值的 ${AGENT_HISTORY_EMERGENCY_FACTOR_ACU} 倍，再不压缩这次请求会因超长直接失败，因此提前压缩。` : '',
        compaction.status === 'compacted_above_target' ? '压缩后仍高于内部低水位：提示词骨架与最近一轮的内容本身较大，最近一轮已完整保留。' : '',
      ].filter(Boolean).join(''),
    });
    // 交接报告正文单独作为一条会话条目插进会话流：用户在界面上直接看到
    // 「AI 的可见历史从这份交接文件开始」，而不是只看到一条统计说明。
    logAgentSession_ACU({ kind: 'handoff', title: '早期会话交接报告（此前内容对当前 AI 不可见）', detail: candidate.report });
    return reread;
  }

  private async callMainAgent(
    request: ContinuationAgentTurnPlanRequest_ACU,
    preset: ContinuationResolvedApiPreset_ACU,
    session: AgentConversationHandle_ACU,
    counter: TokenCounter_ACU,
    context: AgentResolveContext_ACU,
    ledger: AgentRunLedger_ACU,
    budget: AgentRunBudget_ACU,
    iteration: number,
    allowDelegate: boolean,
    toolUsage: AgentToolUsage_ACU,
    gateConfig: AgentReadGateConfig_ACU,
    lifecycle?: { outlineMaintenanceReserveAvailable: boolean; convergenceOnly: boolean },
  ) {
    const retries = normalizeContinuationInternalAiRetryLimit_ACU(request.settings.internalAiRetryLimit);
    let lastReason = '';
    // 每次调用的用量由回调覆盖写入：协议重试时展示的是最终被采纳那次调用的用量。
    let callUsage: AiUsageMetadata_ACU | null = null;
    const callOptions: ContinuationInternalAiCallOptions_ACU = {
      promptCacheEnabled: true,
      cacheScope: 'agent-main',
      cacheTools: ['read', 'search', 'open_round', 'delegate', 'finalize', 'block'],
      minOutputTokens: CONTINUATION_ROLE_OUTPUT_TOKEN_FLOORS_ACU.main,
      onUsage: usage => { callUsage = usage; },
      ...(this.dependencies.nativeTools ? { tools: agentNativeTools_ACU(['read', 'search']) } : {}),
    };

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const base = request.createInternalRequestIdentity(attempt);
      const identity: ContinuationInternalAiRequestIdentity_ACU = { ...base, source: 'agent_main' };
      if (!request.isInternalRequestCurrent(base)) {
        throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'agent_loop', '主 Agent 请求已失效', false));
      }
      const rendered = await this.renderMainPrompt_ACU(request, context, ledger, budget, iteration, toolUsage, gateConfig, lifecycle);
      let messages = this.dependencies.nativeTools
        ? withNativeToolThinkPrefill_ACU(this.spliceHistory_ACU(rendered, session.history()))
        : this.spliceHistory_ACU(rendered, session.history());
      // 发送前只在越过两倍越界线时压缩，避免这次请求因超长失败。
      // 没到两倍不总结；下一轮开始时直接丢弃上一轮的会话、工具调用和快照。
      const budgetTokens = request.settings.agentHistoryTokenBudget;
      if (budgetTokens > 0) {
        const ceilingTokens = budgetTokens * AGENT_HISTORY_EMERGENCY_FACTOR_ACU;
        let promptTokens = await measureAgentPromptTokens_ACU(messages, counter);
        if (promptTokens > ceilingTokens) {
          if (await session.compact(true, messages)) {
            messages = this.dependencies.nativeTools
              ? withNativeToolThinkPrefill_ACU(this.spliceHistory_ACU(rendered, session.history()))
              : this.spliceHistory_ACU(rendered, session.history());
            promptTokens = await measureAgentPromptTokens_ACU(messages, counter);
          }
        }
        if (promptTokens > ceilingTokens) {
          throw new ContinuationValidationError_ACU(createContinuationError_ACU(
            'CONTINUATION_AGENT_SNAPSHOT_INVALID',
            'agent_loop',
            `主 Agent 最终请求约 ${promptTokens} tokens，超过会话 token 阈值 ${budgetTokens} 的 ${AGENT_HISTORY_EMERGENCY_FACTOR_ACU} 倍且已无法再压缩，拒绝发送必然超长的请求。可在设置里提高「会话自动总结阈值」，或清空 Agent 会话历史后重试`,
            false,
          ));
        }
        if (promptTokens > budgetTokens && !session.overBudgetNotified) {
          session.overBudgetNotified = true;
          logAgentSession_ACU({
            kind: 'thought',
            title: `上下文已超过 token 阈值（约 ${promptTokens} tokens）`,
            detail: `阈值 ${budgetTokens}，越界线 ${ceilingTokens}。还没到两倍，本轮结束不总结。本轮规划完成后再丢弃会话记录、工具调用和运行时快照，下一轮不再确认上一轮。`,
          });
        }
      }
      // 轮内紧急总结可能已改变投影；缓存边界必须来自真正待发送的会话历史。
      callOptions.cacheBoundary = session.snapshot().messages.find(item => item.kind === 'handoff')?.text;
      // 缓存前缀诊断：主 Agent 相邻请求应共享大前缀，服务商缓存 0 命中时用这行定位分歧点。
      // 必须无条件输出（logDebug/logWarn 默认关闭），确认问题后可降级或移除。
      console.info('[SP·数据库][缓存诊断][agent-main]', trackAgentPromptDrift_ACU('agent-main', messages));
      // 显式擦除上一次尝试的用量，防止回调未触发时把旧值当成本次调用的用量。
      callUsage = null as AiUsageMetadata_ACU | null;
      // 传输错误（502/网络抖动）按设置延时重试，不再一次失败就停整条自动链；
      // 协议解析失败仍走外层对话级重试（立即回灌修正，非网络问题不加延时）。
      const raw = await callContinuationInternalAiWithRetry_ACU(
        () => this.dependencies.callInternalAi(messages, preset, identity, request.signal, callOptions),
        {
          transportRetries: retries,
          retryDelaySeconds: request.settings.retryDelaySeconds,
          isCurrent: () => request.isInternalRequestCurrent(base) && !request.signal?.aborted,
        },
      );
      if (!request.isInternalRequestCurrent(base)) {
        throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'agent_loop', '主 Agent 结果已失效', false));
      }
      const turn = normalizeAgentModelReply_ACU(raw);
      const nativeCalls = this.dependencies.nativeTools ? turn.toolCalls : [];
      let rawText = turn.content.trim();
      if (nativeCalls.length) {
        try { rawText = nativeToolCallsToProtocolJson_ACU(nativeCalls); }
        catch (error) {
          lastReason = error instanceof Error ? error.message : String(error);
          this.recordNativeToolFailure_ACU(session, turn.content, nativeCalls, lastReason);
          await session.flush();
          continue;
        }
      }
      try {
        // 统一入口：输出里出现任意 read/search 对象即视为工具并发批次，否则按单动作解析。
        const action = parseAgentMainOutput_ACU(rawText, nativeCalls.length ? '' : AGENT_PREFILLS_ACU.main, allowDelegate);
        // 没有可执行的大纲轮次就不存在「本轮」，finalize 无从谈起；拒绝并回灌，让主 Agent 先走大纲子代理。
        if (action.kind === 'finalize' && !request.readContext().turn) {
          throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_PROTOCOL_INVALID', 'agent_loop', '当前没有可执行的大纲轮次，不能 finalize；请先派工 outline-architect 创建或继续大纲', false));
        }
        const boundCalls = nativeCalls.length || action.kind !== 'tools' ? nativeCalls : synthesizeProtocolToolCalls_ACU(action.calls);
        session.record([{
          kind: 'agent',
          text: turn.content.trim() || rawText || '(空输出)',
          digest: describeAgentActionLabel_ACU(action),
          turnKey: session.turnKey,
          ...(boundCalls.length ? { toolCalls: boundCalls.map(call => ({ id: call.id, name: call.name, arguments: call.arguments })) } : {}),
        }]);
        await session.flush();
        return { action, nativeCalls: boundCalls, attempts: attempt + 1, usage: callUsage };
      } catch (error) {
        lastReason = compactAgentProtocolError_ACU(error);
        // 被拒绝的原文也要留在会话里：模型必须看到自己上一次到底写了什么才能真正修正。
        session.record([
          { kind: 'agent', text: rawText || '(空输出)', digest: '输出被协议层拒绝', turnKey: session.turnKey },
          { kind: 'tool', text: renderMainProtocolRejection_ACU(lastReason, request.readContext(), allowDelegate), digest: `协议拒绝：${lastReason}`, turnKey: session.turnKey },
        ]);
        await session.flush();
        // 会话流必须展示模型原文片段：解析被拒不等于模型没输出，用户要能看到它实际返回了什么。
        logAgentSession_ACU({ kind: 'protocol_retry', title: `迭代 ${iteration} · 输出被拒绝`, detail: `${lastReason}\n模型返回片段：${rawText.slice(0, 300) || '(空)'}`, ok: false });
      }
    }

    failLoop_ACU('CONTINUATION_AGENT_PROTOCOL_INVALID', `主 Agent 连续 ${retries + 1} 次返回不符合协议：${lastReason}`, { lastReason });
  }

  /**
   * 主 Agent 骨架与运行时快照共用同一套占位符解析，避免两边目录/预算各算各的。
   */
  private buildMainPromptResolvers_ACU(
    request: ContinuationAgentTurnPlanRequest_ACU,
    context: AgentResolveContext_ACU,
    ledger: AgentRunLedger_ACU,
    budget: AgentRunBudget_ACU,
    iteration: number,
    toolUsage: AgentToolUsage_ACU,
    gateConfig: AgentReadGateConfig_ACU,
    lifecycle?: { outlineMaintenanceReserveAvailable: boolean; convergenceOnly: boolean },
  ) {
    return {
      $HISTORY_ANCHOR: () => HISTORY_SENTINEL_ACU,
      // 三层正文注入（轮内稳定段）：事件概览（召回行升级纪要全文）、尾部全文楼层、纯楼层索引。
      $STORY_OVERVIEW: () => renderAgentStoryOverview_ACU({ tableData: context.tableData, recallCodes: context.recallCodes }),
      $STORY_TAIL: () => renderAgentStoryTail_ACU(context),
      $STORY_CATALOG: () => renderAgentStoryCatalog_ACU(context),
      $OUTLINE_STATE: () => renderAgentOutlineState_ACU(context),
      $WORLDBOOK_CATALOG: () => '主会话不浏览世界书目录。本轮已触发的条目全文见命中区。不够时用 search，scope 设为 ["worldbook"]。不要 read $WORLDBOOK。',
      $WORLDBOOK_HITS: () => renderAgentWorldbookTriggeredInjection_ACU(context.worldbook ?? buildEmptyAgentWorldbookSnapshot_ACU(false), buildAgentWorldbookScanText_ACU(context)),
      $HISTORY_UNSETTLED: () => renderAgentUnsettledHistory_ACU(context),
      $USER_INTENT: () => context.originInstruction || '（用户未提供初始要求）',
      $USER_REQUIREMENTS: () => renderAgentUserRequirements_ACU(context.moduleSnapshot, context.originInstruction),
      $CURRENT_TURN_GOAL: () => context.execution.turn?.goal || '（尚无可执行的大纲轮次，需先创建或继续大纲）',
      $UNSETTLED_RANGE: () => this.renderUnsettledRange_ACU(context),
      $STORY_ARC_STATE: () => this.renderStoryArcState_ACU(context),
      $CURRENT_TURN_PACING: () => renderAgentTurnGuidance_ACU(context.execution.turn ?? null),
      $AGENT_CATALOG: () => renderAgentSubagentCatalog_ACU({ webResearchEnabled: request.settings.webResearch.enabled }),
      $MODULE_CATALOG: () => renderAgentModuleCatalog_ACU({
        webResearchEnabled: request.settings.webResearch.enabled,
        webRefsPresent: context.moduleSnapshot.webRefs.some(entry => !entry.retired),
      }),
      $WEB_REFS_CATALOG: () => renderAgentWebRefsCatalog_ACU(context.moduleSnapshot, request.settings.webResearch.enabled),
      $AGENT_READ_CATALOG: () => renderAgentReadCatalog_ACU(),
      $TABLE_CATALOG: () => renderAgentTableCatalog_ACU(context.tableData),
      $BUDGET: () => renderAgentBudget_ACU(budget, iteration, ledger, resolveWaveLimit_ACU(request.settings, budget), {
        batchesUsed: toolUsage.batchesUsed,
        grantedTokens: toolUsage.gateState.grantedTokens,
        maxReadTokens: resolveAgentReadBudget_ACU(gateConfig).effectiveMaxReadTokens,
      }, lifecycle),
      // 以下占位符默认提示词已不再使用（正文全文改目录、大纲改状态行、结果改走会话消息、
      // 约束改 read 按需调阅）；保留解析以兼容旧的自定义提示词。
      $STORY_TEXT: () => renderAgentStoryText_ACU(context),
      $OUTLINE_WINDOW: () => renderAgentOutlineWindow_ACU(context),
      $ACTIVE_CONSTRAINTS: () => renderAgentConstraints_ACU(context.moduleSnapshot),
      $TOOL_RESULTS: () => renderAgentToolResults_ACU(ledger.outcomes),
    };
  }

  /**
   * 渲染主 Agent 的提示词消息序列（历史锚点仍是哨兵，尚未拼入会话历史）。
   * 每次迭代的实际请求与运行开始时的上下文开销测量共用此路径，保证量到的就是发出去的。
   */
  private async renderMainPrompt_ACU(
    request: ContinuationAgentTurnPlanRequest_ACU,
    context: AgentResolveContext_ACU,
    ledger: AgentRunLedger_ACU,
    budget: AgentRunBudget_ACU,
    iteration: number,
    toolUsage: AgentToolUsage_ACU,
    gateConfig: AgentReadGateConfig_ACU,
    lifecycle?: { outlineMaintenanceReserveAvailable: boolean; convergenceOnly: boolean },
  ): Promise<Array<{ role: string; content: string }>> {
    const rendered = await renderContinuationPrompt_ACU(
      request.settings.agentPrompts.main,
      this.buildMainPromptResolvers_ACU(request, context, ledger, budget, iteration, toolUsage, gateConfig, lifecycle),
      'agent_loop',
    );
    return rendered.messages;
  }

  /**
   * 把当前目录与预算渲染成一条运行时快照。内容相对上一条快照未变则不追加，
   * 保证会话只在尾部增长，已发出的前缀字节级不变。
   */
  /** 子代理末尾：主会话当前快照，再加上主会话本轮已经读到的全文。 */
  private subagentTail_ACU(session: AgentConversationHandle_ACU): string {
    const snapshot = lastRuntimeSnapshotText_ACU(session.snapshot());
    const reads = renderMainSessionReadAppendix_ACU(session.snapshot().messages);
    return [snapshot, reads].filter(Boolean).join('\n\n');
  }

  private async ensureRuntimeSnapshot_ACU(
    request: ContinuationAgentTurnPlanRequest_ACU,
    session: AgentConversationHandle_ACU,
    context: AgentResolveContext_ACU,
    ledger: AgentRunLedger_ACU,
    budget: AgentRunBudget_ACU,
    iteration: number,
    toolUsage: AgentToolUsage_ACU,
    gateConfig: AgentReadGateConfig_ACU,
    lifecycle?: { outlineMaintenanceReserveAvailable: boolean; convergenceOnly: boolean },
  ): Promise<void> {
    const rendered = await renderContinuationPrompt_ACU(
      [{ role: 'user', content: AGENT_RUNTIME_SNAPSHOT_TEMPLATE_ACU, enabled: true, deletable: false, pinned: true }],
      this.buildMainPromptResolvers_ACU(request, context, ledger, budget, iteration, toolUsage, gateConfig, lifecycle),
      'agent_loop',
    );
    const text = rendered.messages[0]?.content?.trim() ?? '';
    if (!text || text === lastRuntimeSnapshotText_ACU(session.snapshot())) return;
    session.record([{ kind: 'runtime', text, digest: '运行时快照', turnKey: session.turnKey }]);
    await session.flush();
  }

  /**
   * 执行一个 read/search 工具并发批次。
   *
   * 流程：批内去重与已放行地址拆分（重复项返回一行提示、不重注内容、不计门禁账）→
   * 解析全部新材料 → 整批过门禁 → 放行则逐条作为带 readKey 的工具消息落会话
   * （之后重读同址时，旧消息由渲染层按 readKey 投影成过期占位），打回则回灌结构化拒绝报告。
   * 任何一步都不中断循环——工具问题让模型看着报告自己纠正。
   */
  private recordNativeToolFailure_ACU(session: AgentConversationHandle_ACU, content: string, calls: readonly AiNativeToolCall_ACU[], reason: string): void {
    session.record([
      { kind: 'agent', text: content || reason, digest: '工具调用未能执行', turnKey: session.turnKey, toolCalls: calls.map(call => ({ id: call.id, name: call.name, arguments: call.arguments })) },
      ...calls.map(call => ({ kind: 'tool' as const, text: reason, digest: call.name, turnKey: session.turnKey, toolCallId: call.id })),
    ]);
  }

  private async runToolBatch_ACU(
    calls: readonly AgentToolCall_ACU[],
    session: AgentConversationHandle_ACU,
    context: AgentResolveContext_ACU,
    toolUsage: AgentToolUsage_ACU,
    gateConfig: AgentReadGateConfig_ACU,
    budget: AgentRunBudget_ACU,
    counter: TokenCounter_ACU,
    measureContextTokens: () => Promise<number>,
    iteration: number,
    nativeCalls: readonly AiNativeToolCall_ACU[] = [],
  ): Promise<void> {
    if (toolUsage.batchesUsed >= budget.maxReads) {
      const text = `read/search 工具批次已用尽（上限 ${budget.maxReads} 个批次）。请基于已有资料输出决策动作（delegate / finalize / block）；大纲调整请委派 outline-architect 或 arc-architect。`;
      session.record([{ kind: 'tool', text, digest: '工具批次已用尽', turnKey: session.turnKey }]);
      logAgentSession_ACU({ kind: 'tool_read', title: `迭代 ${iteration} · 工具批次已用尽`, detail: text, ok: false });
      await session.flush();
      return;
    }
    toolUsage.batchesUsed += 1;

    interface FreshMaterial_ACU { key: string; label: string; title: string; text: string; }
    const fresh: FreshMaterial_ACU[] = [];
    const failed: FreshMaterial_ACU[] = [];
    const duplicated: string[] = [];
    const seenInBatch = new Set<string>();
    const ownerByKey = new Map<string, number>();
    calls.forEach((call, index) => {
      if (call.kind === 'read') {
        for (const raw of call.reads) ownerByKey.set(String(raw ?? '').trim(), index);
      } else {
        ownerByKey.set(`search|${call.isRegex ? 're' : 'kw'}|${[...call.scope].sort().join('+')}|${call.maxResults}|${call.query}`, index);
      }
    });
    for (const call of calls) {
      if (call.kind === 'read') {
        for (const raw of call.reads) {
          const key = String(raw ?? '').trim();
          if (!key || seenInBatch.has(key)) continue;
          seenInBatch.add(key);
          if (key.startsWith('$WORLDBOOK:')) {
            failed.push({ key, label: key, title: '世界书条目', text: WORLDBOOK_READ_REFUSAL_ACU });
            continue;
          }
          if (toolUsage.granted.has(key)) { duplicated.push(key); continue; }
          const resolved = resolveAgentReadToken_ACU(key, context);
          const material = { key, label: key, title: resolved.title, text: resolved.text };
          if (resolved.status === 'failed') failed.push(material);
          else fresh.push(material);
        }
        continue;
      }
      // search 指纹含全部参数：同参重搜必然同结果（资料修订节点会整体清空放行集合）。
      const key = `search|${call.isRegex ? 're' : 'kw'}|${[...call.scope].sort().join('+')}|${call.maxResults}|${call.query}`;
      if (seenInBatch.has(key)) continue;
      seenInBatch.add(key);
      const label = `search "${call.query}"（域：${call.scope.join('、')}）`;
      if (toolUsage.granted.has(key)) { duplicated.push(label); continue; }
      fresh.push({ key, label, title: `搜索「${call.query}」`, text: runAgentSearch_ACU(call, context) });
    }

    const owners: number[] = [];
    const appends: AgentConversationAppend_ACU[] = failed.map(material => {
      owners.push(ownerByKey.get(material.key) ?? 0);
      return {
        kind: 'tool' as const,
        text: JSON.stringify({ action: 'read', address: material.key, status: 'failed', reason: material.text }),
        digest: `调阅失败 ${material.label}`,
        turnKey: session.turnKey,
      };
    });
    if (duplicated.length) {
      owners.push(0);
      appends.push({ kind: 'tool', text: `以下调阅本轮已放行且内容未变，完整内容见上文，不再重注：${duplicated.join('、')}。`, digest: '重复调阅提示', turnKey: session.turnKey });
    }

    if (fresh.length) {
      const items: AgentGateItem_ACU[] = fresh.map(material => ({ label: material.label, text: material.text }));
      const decision = await gateAgentReadBatch_ACU(items, toolUsage.gateState, gateConfig, await measureContextTokens(), counter);
      if (decision.allowed) {
        toolUsage.gateState.grantedTokens += decision.batchTokens;
        for (const material of fresh) {
          const isLatestSnapshot = toolUsage.invalidated.delete(material.key);
          toolUsage.granted.add(material.key);
          const latestSnapshotNotice = isLatestSnapshot
            ? '\n\n【最新快照】该地址的资料在上次调阅后可能已变化；本条是重新调阅所得的最新快照，较早结果仅代表产生时状态。'
            : '';
          owners.push(ownerByKey.get(material.key) ?? 0);
          appends.push({ kind: 'tool', text: `### ${material.title}（${material.label}）\n${material.text}${latestSnapshotNotice}`, digest: `调阅 ${material.label}`, turnKey: session.turnKey, readKey: material.key });
        }
        logAgentSession_ACU({
          kind: 'tool_read',
          title: `迭代 ${iteration} · 调阅 ${fresh.length} 项（约 ${decision.batchTokens} tokens）`,
          detail: fresh.map((material, index) => `${material.label}：${decision.itemTokens[index]} tokens`).join('\n'),
        });
      } else {
        owners.push(0);
        appends.push({ kind: 'tool', text: decision.report, digest: '读取被门禁打回', turnKey: session.turnKey });
        logAgentSession_ACU({ kind: 'tool_read', title: `迭代 ${iteration} · 读取批次被门禁打回（${decision.batchTokens} tokens）`, detail: decision.report, ok: false });
      }
    } else if (!duplicated.length && !failed.length) {
      owners.push(0);
      appends.push({ kind: 'tool', text: '本次工具批次没有任何有效的读取地址或搜索请求。请检查 read 的 reads 数组与 search 的 query。', digest: '空工具批次', turnKey: session.turnKey });
    }

    if (nativeCalls.length) {
      const grouped = nativeCalls.map(() => [] as string[]);
      const readKeys = nativeCalls.map(() => [] as string[]);
      appends.forEach((item, index) => {
        const owner = owners[index] ?? 0;
        grouped[owner]?.push(item.text);
        if (item.readKey) readKeys[owner]?.push(item.readKey);
      });
      session.record(nativeCalls.map((call, index) => ({
        kind: 'tool' as const,
        text: grouped[index]?.join('\n\n') || '工具没有返回内容',
        digest: call.name,
        turnKey: session.turnKey,
        toolCallId: call.id,
        ...(readKeys[index]?.length === 1 ? { readKey: readKeys[index][0] } : {}),
      })));
    } else {
      session.record(appends);
    }
    await session.flush();
  }

  /** 可写子代理共用的逐栏保存口。目标楼在派工时绑定，缺栏留下，已有栏目先入库。 */
  private moduleFieldWrite_ACU(chat: any[], context: AgentResolveContext_ACU) {
    const targetIndex = chat.length - 1;
    const message = chat[targetIndex];
    const dispatchTarget = { message, swipeId: readMessageSwipeId_ACU(message), content: message?.mes };
    const completedStages = context.execution.task.stages.filter(stage => stage.status === 'completed').map(stage => stage.stageNumber);
    return ({ role, sql, resolvePage, isCurrent }: { role: AgentSubagentName_ACU; sql: string; resolvePage: (handle: string) => AgentFieldPage_ACU | null; isCurrent?: () => boolean }) => commitAgentModuleFieldWrites_ACU({
      chat, targetIndex, dispatchTarget, role, sql, resolvePage, isCurrent, completedStages,
    });
  }

  /**
   * 固定工作流的结构前置阶段：程序先维护总纲，再确保存在可执行的阶段大纲。
   * 主 Agent 只负责给出 open_round 的焦点，不再直接派工 arc/outline 角色。
   */
  private async prepareFixedWorkflowStructure_ACU(
    action: AgentOpenRoundAction_ACU,
    request: ContinuationAgentTurnPlanRequest_ACU,
    context: AgentResolveContext_ACU,
    budget: AgentRunBudget_ACU,
    chat: any[],
    session: AgentConversationHandle_ACU,
    apiDependencies?: ContinuationApiPresetDependencies_ACU,
  ): Promise<void> {
    const completedStageNumbers = context.execution.task.stages
      .filter(stage => stage.status === 'completed')
      .map(stage => stage.stageNumber);
    const needsArcMaintenance = !hasActiveStoryArc_ACU(context.moduleSnapshot)
      || !hasActiveStoryArcVolume_ACU(context.moduleSnapshot)
      || findUnregisteredStageNumbers_ACU(context.moduleSnapshot, completedStageNumbers).length > 0;

    if (needsArcMaintenance) {
      const entryId = logAgentSession_ACU({
        kind: 'delegation',
        agentName: 'arc-architect',
        title: '固定工作流维护故事总纲',
        detail: action.focus,
        status: 'running',
      });
      try {
        const preset = this.dependencies.resolveApiPreset(request.settings, 'arcArchitect', 'agent_delegate', apiDependencies);
        const result = await this.dependencies.subagentRuntime.run({
          delegation: { agentName: 'arc-architect', prompt: `固定工作流维护故事总纲。焦点：${action.focus}`, reads: [] },
          settings: request.settings,
          resolveContext: context,
          budget,
          preset,
          createIdentity: (_agentName, attempt) => ({ ...request.createInternalRequestIdentity(attempt), source: 'agent_subagent' }),
          isCurrent: identity => request.isInternalRequestCurrent(identity),
          signal: request.signal,
          writeSql: this.moduleFieldWrite_ACU(chat, context),
          mainSnapshot: this.subagentTail_ACU(session),
        });
        if (result.usedFieldWrites) context.moduleSnapshot = readAgentModuleSnapshot_ACU(chat);
        if (!result.usedFieldWrites && result.arc && (result.arc.delta.storyArc.length || result.arc.delta.storyArcPatches.length)) {
          const delta = mergeAgentDeltaRevisions_ACU(result.arc.delta, result.readRevisions);
          const applied = await applyAgentModuleDeltaViaSql_ACU(
            context.moduleSnapshot,
            delta,
            result.writes,
            Math.max(0, chat.length - 1),
            completedStageNumbers,
            { onViolation: () => undefined, agentName: 'arc-architect' },
          );
          context.moduleSnapshot = applied.snapshot;
          await this.persistSnapshot_ACU(chat, applied.snapshot);
        }
        const arcReady = hasActiveStoryArc_ACU(context.moduleSnapshot) && hasActiveStoryArcVolume_ACU(context.moduleSnapshot)
          && findUnregisteredStageNumbers_ACU(context.moduleSnapshot, completedStageNumbers).length === 0;
        if (!arcReady) {
          const missing = (result.unresolvedIssues ?? []).map(issue => `${issue.path}：${issue.message}`).join('；');
          failLoop_ACU('CONTINUATION_AGENT_PROTOCOL_INVALID', missing
            ? `固定工作流的总纲还缺栏目，已写入的栏目已保留。${missing}`
            : '固定工作流的总纲维护没有形成可执行的活跃总纲和活动卷');
        }
        updateAgentSession_ACU(entryId, { title: '固定工作流已维护故事总纲', detail: result.arc?.summary || '总纲已按栏目写入', ok: true });
      } catch (error) {
        const reason = compactAgentProtocolError_ACU(error);
        updateAgentSession_ACU(entryId, { title: '固定工作流维护故事总纲失败', detail: reason, ok: false });
        throw error;
      }
    }

    context.execution = request.readContext();
    if (context.execution.turn) return;
    if (!request.applyOutline) {
      failLoop_ACU('CONTINUATION_TASK_STATE_INVALID', '当前没有可执行的阶段大纲，且本轮不允许创建或继续大纲');
    }
    const entryId = logAgentSession_ACU({ kind: 'outline_op', agentName: AGENT_OUTLINE_AGENT_NAME_ACU, title: '固定工作流准备阶段大纲', detail: action.focus, status: 'running' });
    const result = await request.applyOutline(`固定工作流根据当前 active 卷准备阶段大纲。焦点：${action.focus}`);
    updateAgentSession_ACU(entryId, {
      title: result.op === 'create' ? '固定工作流已创建阶段大纲' : result.op === 'continue' ? '固定工作流已继续阶段大纲' : '固定工作流已维护阶段大纲',
      detail: result.summary,
      ok: result.stopped === null,
    });
    if (result.stopped) failLoop_ACU('CONTINUATION_TASK_STATE_INVALID', result.summary, { stopped: result.stopped });
    if (result.requiresReview) failLoop_ACU('CONTINUATION_AGENT_OUTLINE_REPLANNED', '固定工作流已产出新大纲，等待你在界面上确认后再继续', { op: result.op, requiresReview: true });
    context.execution = request.readContext();
    if (!context.execution.turn) failLoop_ACU('CONTINUATION_TASK_STATE_INVALID', '阶段大纲操作完成后仍没有可执行轮次');
  }

  private async runFixedWorkflow_ACU(
    action: AgentOpenRoundAction_ACU,
    request: ContinuationAgentTurnPlanRequest_ACU,
    context: AgentResolveContext_ACU,
    ledger: AgentRunLedger_ACU,
    budget: AgentRunBudget_ACU,
    chat: any[],
    session: AgentConversationHandle_ACU,
    apiDependencies?: ContinuationApiPresetDependencies_ACU,
  ): Promise<ContinuationWorkflowResult_ACU> {
    await this.prepareFixedWorkflowStructure_ACU(action, request, context, budget, chat, session, apiDependencies);
    const unsettled = renderAgentUnsettledHistory_ACU(context);
    const mapPayload = (result: AgentSubagentRunResult_ACU): ContinuationWorkflowAgentPayload_ACU => ({
      ok: result.completion !== 'failed' && result.completion !== 'partial',
      summary: result.composer?.summary || result.maintainer?.summary || result.arc?.summary || result.planner?.summary || result.reviewer?.reason || result.researcher?.summary || '',
      maintainer: result.maintainer,
      arc: result.arc,
      planner: result.planner,
      reviewer: result.reviewer,
      researcher: result.researcher,
      readRevisions: result.readRevisions,
      writes: result.writes,
      completion: result.completion,
      moduleCompletion: result.moduleCompletion,
      unresolvedIssues: result.unresolvedIssues,
      acceptedKeys: result.acceptedKeys,
      usedFieldWrites: result.usedFieldWrites,
      noChange: result.completion === 'complete_no_change',
    });
    const workflow = await runContinuationAgentWorkflow_ACU({
      settings: request.settings,
      snapshot: context.moduleSnapshot,
      readCommittedSnapshot: () => readAgentModuleSnapshot_ACU(chat),
      opening: {
        focus: action.focus,
        summary: action.summary,
        dispatchWebResearcher: action.dispatchWebResearcher && request.settings.webResearch.enabled,
      },
      hasUnsettledHistory: !unsettled.startsWith('没有尚未结算的真实历史'),
      beatObligation: continuationBeatObligation_ACU(context.execution.turn),
      majorTurn: continuationMajorTurn_ACU(context.execution.turn),
      settledIndex: Math.max(0, chat.length - 1),
      completedStageNumbers: context.execution.task.stages.filter(stage => stage.status === 'completed').map(stage => stage.stageNumber),
      runAgent: async call => {
        if (call.billing === 'opening') {
          const used = ledger.perAgent.get(call.agentName) ?? 0;
          if (ledger.delegationsUsed >= budget.maxDelegations || used >= budget.maxSameAgent) {
            return { ok: false, summary: '开局派工超出预算，已跳过' };
          }
        }
        const definition = findAgentSubagentDefinition_ACU(call.agentName);
        const role = definition?.promptKey ?? 'main';
        const preset = this.dependencies.resolveApiPreset(request.settings, role, 'agent_delegate', apiDependencies);
        const result = await this.dependencies.subagentRuntime.run({
          delegation: { agentName: call.agentName, prompt: call.prompt, reads: [] },
          settings: request.settings,
          resolveContext: context,
          budget,
          preset,
          createIdentity: (_agentName, attempt) => ({ ...request.createInternalRequestIdentity(attempt), source: 'agent_subagent' }),
          isCurrent: identity => request.isInternalRequestCurrent(identity),
          signal: request.signal,
          writeSql: this.moduleFieldWrite_ACU(chat, context),
          mainSnapshot: this.subagentTail_ACU(session),
        });
        if (call.billing === 'opening') {
          ledger.delegationsUsed += 1;
          ledger.perAgent.set(call.agentName, (ledger.perAgent.get(call.agentName) ?? 0) + 1);
        }
        return mapPayload(result);
      },
      runComposer: async call => {
        const preset = this.dependencies.resolveApiPreset(request.settings, 'instructionComposer', 'agent_delegate', apiDependencies);
        const feedback = call.revisionFeedback ? `\n终审反馈清单（只改这些，不要全量重写）：\n${call.revisionFeedback}` : '';
        const result = await this.dependencies.subagentRuntime.run({
          delegation: { agentName: AGENT_INSTRUCTION_COMPOSER_NAME_ACU, prompt: `${call.prompt}${feedback}`, reads: [] },
          settings: request.settings,
          resolveContext: { ...context, moduleSnapshot: context.moduleSnapshot },
          budget,
          preset,
          createIdentity: (_agentName, attempt) => ({ ...request.createInternalRequestIdentity(attempt), source: 'agent_subagent' }),
          isCurrent: identity => request.isInternalRequestCurrent(identity),
          signal: request.signal,
          mainSnapshot: this.subagentTail_ACU(session),
        });
        if (!result.composer?.instruction.trim()) {
          throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_PROTOCOL_INVALID', 'agent_delegate', 'instruction-composer 必须提供非空 instruction', false));
        }
        return result.composer;
      },
      runFinalReview: async (instruction, summary) => {
        const review = await this.dependencies.subagentRuntime.runFinalReview({
          settings: request.settings,
          resolveContext: context,
          candidateInstruction: instruction,
          currentUserInput: context.originInstruction,
          planningSummary: summary,
          mainSnapshot: this.subagentTail_ACU(session),
          createIdentity: (_agentName, attempt) => ({ ...request.createInternalRequestIdentity(attempt), source: 'agent_subagent' }),
          isCurrent: identity => request.isInternalRequestCurrent(identity),
          signal: request.signal,
        });
        return review.output;
      },
    });
    context.moduleSnapshot = workflow.snapshot;
    await this.persistSnapshot_ACU(chat, workflow.snapshot);
    return workflow;
  }

  /**
   * 渲染未结算楼层区间。只报区间不带正文：未结算正文默认没有注入骨架（尾部全文楼层除外），
   * 主 Agent 要看必须自己 read $HISTORY_UNSETTLED。
   */
  private renderUnsettledRange_ACU(context: AgentResolveContext_ACU): string {
    const start = context.settledThroughIndex + 1;
    const last = context.chat.length - 1;
    if (start > last) return '没有尚未结算的真实历史，无需派工结算维护类代理。';
    return `未结算楼层区间：${start} 到 ${last}（共 ${last - start + 1} 楼）。输出 open_round 后，固定工作流会自动派 hook-cognition-maintainer 结算这些楼层。不要 delegate 结算、策划或审查角色。这些楼层的正文默认没有注入，需要核对时 read $HISTORY_UNSETTLED。`;
  }

  /**
   * 渲染总纲状态证据。只报「有没有、进度登记齐不齐」，总纲正文由 $STORY_ARC 按需调阅——
   * 状态段每轮都发，把整份总纲塞进来是纯浪费。
   */
  private renderStoryArcState_ACU(context: AgentResolveContext_ACU): string {
    if (!hasActiveStoryArc_ACU(context.moduleSnapshot)) {
      return '故事总纲：尚未建立。输出 open_round 后，固定工作流会先调用 arc-architect 建立一条全书方向与若干卷台阶，再准备可执行阶段大纲；主 Agent 不直接 delegate 这些内部角色。';
    }
    const completed = context.execution.task.stages.filter(stage => stage.status === 'completed').map(stage => stage.stageNumber);
    const unregistered = findUnregisteredStageNumbers_ACU(context.moduleSnapshot, completed);
    const head = `故事总纲：已建立（修订号 ${context.moduleSnapshot.revisions.storyArc}），完整内容用 read $STORY_ARC 调阅。`;
    if (!unregistered.length) return `${head}已完成阶段的进度均已登记；如剧情越出台阶、底牌被提前翻开或当前卷可判定收束，把依据写进 open_round.focus，由固定工作流判断并维护总纲。`;
    return `${head}第 ${unregistered.join('、')} 阶段已完成但没有登记进任何卷台阶的 stageNumbers，卷进度因此判断不了「本卷该收了没」。输出 open_round 后，固定工作流会调用 arc-architect 向当前 active 卷回写这些阶段；只有真实正文达到 escalation 的可判定收束状态时，才以完成阶段编号和卷末状态把该卷 patch 成 done 并激活下一卷。所有既有卷都完成而用户继续写时，固定工作流会先根据最后一卷的后果追加带续卷依据的 active 新卷。`;
  }

  private spliceHistory_ACU(
    messages: ReadonlyArray<{ role: string; content: string }>,
    history: ReadonlyArray<{ role: string; content: string }>,
  ): Array<{ role: string; content: string }> {
    const result: Array<{ role: string; content: string }> = [];
    let inserted = false;
    for (const message of messages) {
      if (message.content.includes(HISTORY_SENTINEL_ACU)) {
        result.push(...history.map(item => ({ ...item })));
        inserted = true;
        continue;
      }
      result.push({ ...message });
    }
    // 提示词被用户删掉锚点段时历史无处可插，此时把历史接在最前面而不是静默丢弃。
    if (!inserted && history.length) return [...history.map(item => ({ ...item })), ...result];
    return result;
  }

  /**
   * 开场检索的触发条件：功能开启、任务尚无任何阶段（第一次规划）、资料库没有活跃条目，
   * 且不是中断恢复（恢复运行的证据已在会话里，重跑只会白烧一次）。
   */
  private shouldRunOpeningResearch_ACU(request: ContinuationAgentTurnPlanRequest_ACU, context: AgentResolveContext_ACU, resumed: boolean): boolean {
    if (!request.settings.webResearch.enabled || resumed) return false;
    if (context.execution.task.stages.length > 0) return false;
    return !context.moduleSnapshot.webRefs.some(entry => !entry.retired);
  }

  /**
   * 受控地跑一次 web-researcher 并把结果写进资料快照。与普通派工的区别：不占派工额度、
   * 不受波次并发限制、失败不抛——开场检索是锦上添花，网络不通不该让整轮规划失败。
   */
  private async runOpeningResearch_ACU(
    request: ContinuationAgentTurnPlanRequest_ACU,
    context: AgentResolveContext_ACU,
    ledger: AgentRunLedger_ACU,
    budget: AgentRunBudget_ACU,
    chat: any[],
    snapshot: AgentModuleSnapshot_ACU,
    session: AgentConversationHandle_ACU,
    apiDependencies?: ContinuationApiPresetDependencies_ACU,
  ): Promise<AgentModuleSnapshot_ACU> {
    const delegation: AgentDelegation_ACU = { agentName: AGENT_WEB_RESEARCHER_NAME_ACU, prompt: buildOpeningResearchPrompt_ACU(context.originInstruction), reads: [] };
    const entryId = logAgentSession_ACU({ kind: 'delegation', agentName: delegation.agentName, title: '开场百科检索执行中', detail: delegation.prompt, status: 'running' });
    try {
      const preset = this.dependencies.resolveApiPreset(request.settings, 'webResearcher', 'agent_delegate', apiDependencies);
      const result = await this.dependencies.subagentRuntime.run({
        delegation,
        settings: request.settings,
        resolveContext: context,
        budget,
        preset,
        createIdentity: (_agentName, attempt) => ({ ...request.createInternalRequestIdentity(attempt), source: 'agent_subagent' }),
        isCurrent: identity => request.isInternalRequestCurrent(identity),
        signal: request.signal,
        writeSql: this.moduleFieldWrite_ACU(chat, context),
        mainSnapshot: this.subagentTail_ACU(session),
      });
      const settled = result.usedFieldWrites
        ? { snapshot: readAgentModuleSnapshot_ACU(chat), outcome: { agentName: result.agentName, ok: true, summary: result.researcher?.summary || '百科资料已按栏目写入', detail: '', rejectedReason: '' } }
        : await this.settleResearcherResult_ACU(result, snapshot);
      ledger.outcomes.push(settled.outcome);
      updateAgentSession_ACU(entryId, {
        title: `开场百科检索${settled.outcome.ok ? '完成' : '未采用'}${result.usage ? ` · ${formatAgentUsageLabel_ACU(result.usage)}` : ''}`,
        detail: settled.outcome.ok ? [settled.outcome.summary, settled.outcome.detail].filter(Boolean).join('\n') : settled.outcome.rejectedReason,
        ok: settled.outcome.ok,
      });
      if (settled.snapshot !== snapshot) {
        context.moduleSnapshot = settled.snapshot;
        await this.persistSnapshot_ACU(chat, settled.snapshot);
      }
      return settled.snapshot;
    } catch (error) {
      if (error instanceof ContinuationValidationError_ACU && error.error.code === 'CONTINUATION_INTERNAL_REQUEST_STALE') throw error;
      const reason = compactAgentProtocolError_ACU(error);
      updateAgentSession_ACU(entryId, { title: '开场百科检索失败', detail: `${reason}\n主 Agent 将在没有百科资料库的情况下继续规划；需要时它仍可派工 web-researcher 重试。`, ok: false });
      ledger.outcomes.push({ agentName: delegation.agentName, ok: false, summary: '', detail: '', rejectedReason: `开场百科检索失败：${reason}` });
      return snapshot;
    }
  }

  /**
   * 把 web-researcher 的输出落到快照：pageRef 已由子代理运行时回填，这里只做事务校验与修订号并发校验。
   * 不推进结算水位。
   */
  private async settleResearcherResult_ACU(result: AgentSubagentRunResult_ACU, snapshot: AgentModuleSnapshot_ACU): Promise<{ snapshot: AgentModuleSnapshot_ACU; outcome: AgentDelegationOutcome_ACU }> {
    const researcher = result.researcher;
    if (!researcher) {
      return { snapshot, outcome: { agentName: result.agentName, ok: false, summary: '', detail: '', rejectedReason: '网页检索子代理没有返回可用输出' } };
    }
    try {
      const expected = researcher.expectedRevision ?? result.readRevisions.webRefs;
      const applied = (await applyAgentWebRefsDeltaViaSql_ACU(snapshot, researcher, expected)).snapshot;
      const upserts = researcher.items.filter(item => item.action === 'upsert');
      const retires = researcher.items.filter(item => item.action === 'retire');
      const patches = researcher.patches ?? [];
      const catalog = upserts.map(item => `[${item.id || '新'}]「${item.title}」${item.brief}`).join('；');
      return {
        snapshot: applied,
        outcome: {
          agentName: result.agentName,
          ok: true,
          summary: researcher.summary || `百科资料库更新 ${upserts.length + patches.length} 条`,
          detail: [
            `百科资料库：新增/更新 ${upserts.length} 条${retires.length ? `、退休 ${retires.length} 条` : ''}${patches.length ? `、逐栏修订 ${patches.length} 条` : ''}${catalog ? `：${catalog}` : ''}`,
            upserts.length ? '以上只是预览；详情与原文用 read $WEB_REFS:ID 精读，派工时也可把该地址写进 reads。它们是原作/公开设定的外部参考，不是本故事事实。' : '',
            result.expandedReads.length ? `检索轨迹：${result.expandedReads.slice(0, 12).join('、')}${result.expandedReads.length > 12 ? '…' : ''}` : '',
          ].filter(Boolean).join('\n'),
          rejectedReason: '',
        },
      };
    } catch (error) {
      return { snapshot, outcome: { agentName: result.agentName, ok: false, summary: researcher.summary, detail: '', rejectedReason: compactAgentProtocolError_ACU(error) } };
    }
  }

  private async runDelegations(
    action: AgentDelegateAction_ACU,
    request: ContinuationAgentTurnPlanRequest_ACU,
    context: AgentResolveContext_ACU,
    ledger: AgentRunLedger_ACU,
    budget: AgentRunBudget_ACU,
    chat: any[],
    snapshot: AgentModuleSnapshot_ACU,
    session: AgentConversationHandle_ACU,
    apiDependencies?: ContinuationApiPresetDependencies_ACU,
    outlineMaintenanceReserveAvailable = false,
  ): Promise<{ snapshot: AgentModuleSnapshot_ACU; usedOutlineMaintenanceReserve: boolean }> {
    const waveLimit = resolveWaveLimit_ACU(request.settings, budget);
    const internalWorkflowDelegations = action.delegations.filter(item => item.agentName === AGENT_OUTLINE_AGENT_NAME_ACU || item.agentName === 'arc-architect');
    const normalDelegations = action.delegations.filter(item => item.agentName !== AGENT_OUTLINE_AGENT_NAME_ACU && item.agentName !== 'arc-architect');
    let usedOutlineMaintenanceReserve = false;
    // 未通过预算/波次校验的派工立即记失败条目：这些拒绝是即时判定，没有 running 阶段。
    const rejectImmediately = (agentName: string, reason: string): void => {
      ledger.outcomes.push({ agentName, ok: false, summary: '', detail: '', rejectedReason: reason });
      logAgentSession_ACU({
        kind: agentName === AGENT_OUTLINE_AGENT_NAME_ACU ? 'outline_op' : 'delegation',
        agentName,
        title: `${agentName} 未执行`,
        detail: reason,
        ok: false,
      });
    };

    for (const delegation of internalWorkflowDelegations) {
      rejectImmediately(delegation.agentName, `${delegation.agentName} 已由固定工作流内部调度，主 Agent 不能直接 delegate。请输出 open_round，本次未消耗派工额度。`);
    }

    const accepted: AgentDelegation_ACU[] = [];
    for (const delegation of normalDelegations) {
      if (delegation.agentName === AGENT_INSTRUCTION_COMPOSER_NAME_ACU || delegation.agentName === 'final-reviewer') {
        rejectImmediately(delegation.agentName, '该角色由固定工作流调用，主 Agent 不能 delegate。请输出 open_round。本次未消耗派工额度。');
        continue;
      }
      if (outlineMaintenanceReserveAvailable) {
        rejectImmediately(delegation.agentName, '末轮保留容量只允许 outline-architect 恢复可执行大纲；普通子代理本次未执行。');
        continue;
      }
      const used = ledger.perAgent.get(delegation.agentName) ?? 0;
      if (ledger.delegationsUsed + accepted.length >= budget.maxDelegations) {
        rejectImmediately(delegation.agentName, `派工总数已达上限 ${budget.maxDelegations} 次`);
        continue;
      }
      if (used + accepted.filter(item => item.agentName === delegation.agentName).length >= budget.maxSameAgent) {
        rejectImmediately(delegation.agentName, `同一代理最多派工 ${budget.maxSameAgent} 次`);
        continue;
      }
      if (accepted.length >= waveLimit) {
        const hasCurrentChannel = subagentPresetRoles_ACU(request.settings).some(role => effectiveAgentApiPresetMode_ACU(request.settings, role) === 'current');
        const why = waveLimit === 1 && hasCurrentChannel
          ? '当前跟随活动 API，同一波次只能派工 1 个子代理'
          : `同一波次并发上限为 ${waveLimit} 个`;
        rejectImmediately(delegation.agentName, `${why}，本次未执行，可在下一次迭代重派`);
        continue;
      }
      if (delegation.agentName === AGENT_WEB_RESEARCHER_NAME_ACU && !request.settings.webResearch.enabled) {
        rejectImmediately(delegation.agentName, '网页检索功能未启用（续写设置 → 启用开场百科检索），web-researcher 不可派工。请基于世界书与已有资料继续。');
        continue;
      }
      accepted.push(delegation);
    }

    // 派工发出即记 running 条目，结果回来后原地更新——用户能实时看到哪些子代理在跑。
    const runningEntries = new Map<AgentDelegation_ACU, number>();
    for (const delegation of accepted) {
      runningEntries.set(delegation, logAgentSession_ACU({ kind: 'delegation', agentName: delegation.agentName, title: `${delegation.agentName} 执行中`, detail: delegation.prompt, status: 'running' }));
    }
    const settleOutcome = (delegation: AgentDelegation_ACU, outcome: AgentDelegationOutcome_ACU, usage?: AiUsageMetadata_ACU | null): void => {
      ledger.outcomes.push(outcome);
      const entryId = runningEntries.get(delegation);
      if (entryId === undefined) return;
      const usageSuffix = usage ? ` · ${formatAgentUsageLabel_ACU(usage)}` : '';
      updateAgentSession_ACU(entryId, {
        title: `${outcome.agentName} ${outcome.ok ? '完成' : '未采用'}${usageSuffix}`,
        detail: outcome.ok ? [outcome.summary, outcome.detail].filter(Boolean).join('\n') : outcome.rejectedReason,
        ok: outcome.ok,
      });
    };

    const settled = await Promise.all(accepted.map(async (delegation): Promise<{ delegation: AgentDelegation_ACU; result: AgentSubagentRunResult_ACU | null; error: unknown }> => {
      try {
        // 每个子代理按自己的渠道角色解析；渠道解析失败会成为该派工的拒绝结果回喂给主 Agent。
        const definition = findAgentSubagentDefinition_ACU(delegation.agentName);
        const delegationPreset = this.dependencies.resolveApiPreset(request.settings, definition?.promptKey ?? 'main', 'agent_delegate', apiDependencies);
        const result = await this.dependencies.subagentRuntime.run({
          delegation,
          settings: request.settings,
          resolveContext: context,
          budget,
          preset: delegationPreset,
          // attemptId 必须原样保留：轮次一致性校验按它比对，改写会让所有子代理请求被判失效。
          createIdentity: (_agentName, attempt) => ({ ...request.createInternalRequestIdentity(attempt), source: 'agent_subagent' }),
          isCurrent: identity => request.isInternalRequestCurrent(identity),
          signal: request.signal,
          writeSql: this.moduleFieldWrite_ACU(chat, context),
          mainSnapshot: this.subagentTail_ACU(session),
        });
        return { delegation, result, error: null as unknown };
      } catch (error) {
        return { delegation, result: null, error };
      }
    }));

    let nextSnapshot = settled.some(item => item.result?.usedFieldWrites) ? readAgentModuleSnapshot_ACU(chat) : snapshot;
    let snapshotChanged = false;

    for (const item of settled) {
      ledger.delegationsUsed += 1;
      ledger.perAgent.set(item.delegation.agentName, (ledger.perAgent.get(item.delegation.agentName) ?? 0) + 1);
      if (!item.result) {
        settleOutcome(item.delegation, { agentName: item.delegation.agentName, ok: false, summary: '', detail: '', rejectedReason: compactAgentProtocolError_ACU(item.error) });
        continue;
      }
      const result = item.result;
      if (result.completion === 'failed' || result.completion === 'partial') {
        const issues = result.unresolvedIssues?.map(issue => `${issue.path}: ${issue.message}`).join('；');
        settleOutcome(item.delegation, { agentName: result.agentName, ok: false, summary: '', detail: '',
          rejectedReason: `逐栏维护未完成${issues ? `：${issues}` : ''}；已确认栏目：${result.acceptedKeys?.join('、') || '无'}` }, result.usage);
        continue;
      }
      if (result.maintainer) {
        try {
          const delta = mergeAgentDeltaRevisions_ACU(result.maintainer.delta, result.readRevisions);
          const applied = result.usedFieldWrites ? nextSnapshot : (await applyAgentModuleDeltaViaSql_ACU(nextSnapshot, delta, result.writes, chat.length - 1)).snapshot;
          // 结算派工成功交付契约即推进水位到当轮末楼：空 delta（这段楼层没有新增伏笔/信息差）
          // 同样代表已被处理过，不推水位会让同一区间每轮重复要求结算、白烧派工。
          const settledTarget = chat.length - 1;
          if (applied !== nextSnapshot || applied.settledThroughIndex < settledTarget) {
            nextSnapshot = { ...applied, settledThroughIndex: Math.max(applied.settledThroughIndex, settledTarget) };
            snapshotChanged = true;
          }
          const proposals = result.maintainer.delta.constraintProposals;
          settleOutcome(item.delegation, {
            agentName: result.agentName,
            ok: true,
            summary: result.maintainer.summary,
            detail: [
              `已结算：伏笔 ${result.maintainer.delta.hooks.length} 条、信息差 ${result.maintainer.delta.infoGap.length} 条、故事时间 ${result.maintainer.delta.chronology.length + result.maintainer.delta.chronologyPatches.length} 条`,
              proposals.length ? `约束提议（需你裁决后登记）：${proposals.join('；')}` : '',
              result.expandedReads.length ? `补充读取：${result.expandedReads.join('、')}` : '',
            ].filter(Boolean).join('\n'),
            rejectedReason: '',
          }, result.usage);
        } catch (error) {
          settleOutcome(item.delegation, { agentName: result.agentName, ok: false, summary: result.maintainer.summary, detail: '', rejectedReason: compactAgentProtocolError_ACU(error) }, result.usage);
        }
        continue;
      }
      if (result.arc) {
        try {
          const delta = mergeAgentDeltaRevisions_ACU(result.arc.delta, result.readRevisions);
          const completedStageNumbers = context.execution.task.stages
            .filter(stage => stage.status === 'completed')
            .map(stage => stage.stageNumber);
          const applied = result.usedFieldWrites ? nextSnapshot : (await applyAgentModuleDeltaViaSql_ACU(nextSnapshot, delta, result.writes, chat.length - 1, completedStageNumbers)).snapshot;
          // 与结算分支的区别：只换快照，不推进 settledThroughIndex。
          // 立总纲不等于把未结算正文结算掉，推水位会让伏笔账本永久落后于剧情。
          if (applied !== nextSnapshot) { nextSnapshot = applied; snapshotChanged = true; }
          settleOutcome(item.delegation, {
            agentName: result.agentName,
            ok: true,
            summary: result.arc.summary,
            detail: [
              `总纲已更新：${result.arc.delta.storyArc.length} 条写入、${result.arc.delta.storyArcPatches.length} 处修补`,
              result.expandedReads.length ? `补充读取：${result.expandedReads.join('、')}` : '',
            ].filter(Boolean).join('\n'),
            rejectedReason: '',
          }, result.usage);
        } catch (error) {
          settleOutcome(item.delegation, { agentName: result.agentName, ok: false, summary: result.arc.summary, detail: '', rejectedReason: compactAgentProtocolError_ACU(error) }, result.usage);
        }
        continue;
      }
      if (result.planner) {
        settleOutcome(item.delegation, {
          agentName: result.agentName,
          ok: true,
          summary: result.planner.summary,
          detail: describePlannerOutcome_ACU(result.planner.summary, result.planner.recommendation, result.planner.mustPreserve, result.planner.risks),
          rejectedReason: '',
        }, result.usage);
        continue;
      }
      if (result.reviewer) {
        settleOutcome(item.delegation, {
          agentName: result.agentName,
          ok: true,
          summary: `判词 ${result.reviewer.verdict}`,
          detail: [`判词：${result.reviewer.verdict}`, result.reviewer.reason ? `依据：${result.reviewer.reason}` : '', result.reviewer.fixes.length ? `修正项：${result.reviewer.fixes.join('；')}` : ''].filter(Boolean).join('\n'),
          rejectedReason: '',
        }, result.usage);
        continue;
      }
      if (result.researcher) {
        // 与总纲分支同理：只换快照，不推进结算水位——百科条目不是正文事实。
        const settled = result.usedFieldWrites
          ? { snapshot: nextSnapshot, outcome: { agentName: result.agentName, ok: true, summary: result.researcher.summary, detail: '逐栏写入已独立保存', rejectedReason: '' } }
          : await this.settleResearcherResult_ACU(result, nextSnapshot);
        if (settled.snapshot !== nextSnapshot) { nextSnapshot = settled.snapshot; snapshotChanged = true; }
        settleOutcome(item.delegation, settled.outcome, result.usage);
        continue;
      }
      settleOutcome(item.delegation, { agentName: result.agentName, ok: false, summary: '', detail: '', rejectedReason: '子代理没有返回可用输出' }, result.usage);
    }

    if (snapshotChanged) {
      context.moduleSnapshot = nextSnapshot;
      context.settledThroughIndex = nextSnapshot.settledThroughIndex;
      await this.persistSnapshot_ACU(chat, nextSnapshot);
    }
    return { snapshot: nextSnapshot, usedOutlineMaintenanceReserve };
  }

  private async persistSnapshot_ACU(chat: any[], snapshot: AgentModuleSnapshot_ACU): Promise<void> {
    const targetIndex = chat.length - 1;
    if (targetIndex < 0) {
      throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_SNAPSHOT_INVALID', 'agent_persist', '当前聊天没有可承载资料快照的楼层', false));
    }
    await this.dependencies.writeModuleSnapshot(chat, targetIndex, snapshot);
    // 快照跟着楼层走：该楼被删除、重新生成或 swipe 时资料会随之回退。写到哪一楼必须让用户看得见，
    // 否则“资料突然清零”只能靠猜。
    const active = (list: ReadonlyArray<{ retired: boolean }>) => list.filter(item => !item.retired).length;
    logAgentSession_ACU({
      kind: 'thought',
      title: `资料快照已写入楼层 ${targetIndex}`,
      detail: `伏笔 ${active(snapshot.hooks)} 条 · 信息差 ${active(snapshot.infoGap)} 条 · 总纲 ${active(snapshot.storyArc)} 条 · 年代学 ${active(snapshot.chronology)} 条 · 百科 ${active(snapshot.webRefs)} 条 · 长期约束 ${snapshot.constraints.length} 条 · 结算水位 ${Math.max(snapshot.settledThroughIndex, 0)}。资料按最近基线折叠；该楼增量会随删除或 swipe 一起退出折叠。`,
      ok: true,
    });
  }
}
