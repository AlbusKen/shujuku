import { USER_PREFILL_CONTENT_ACU } from '../../../shared/user-prefill.js';
/**
 * service/continuation/agent/agent-subagent-runtime.ts — 子代理运行时
 *
 * 子代理不是一次性问答，而是一个受限的小循环：主 Agent 派工时给出种子读集，
 * 子代理拿到材料后还可以自己输出 read / search 工具批次补充调阅，运行时执行工具、
 * 把结果作为 user 消息追加进本次派工的对话，再让它继续，直到交出契约 JSON。
 *
 * 免授权：读集不再做白名单校验——所有资料域对所有子代理开放，读多少由 token 门禁管。
 * 种子读集在注入前记入本次派工自己的门禁账本；种子本身就超预算时整次派工拒回主 Agent。
 *
 * 只读契约仍由主循环结算；write_sql 通过受控生产端口即时保存并回读。
 */

import { normalizeContinuationInternalAiRetryLimit_ACU } from '../defaults';
import { callContinuationInternalAi_ACU, callContinuationInternalAiWithRetry_ACU, CONTINUATION_ROLE_OUTPUT_TOKEN_FLOORS_ACU, type AiUsageMetadata_ACU, type ContinuationInternalAiCallOptions_ACU } from '../internal-ai-call';
import { resolveContinuationAgentApiPreset_ACU, resolveContinuationApiPreset_ACU, type ContinuationResolvedApiPreset_ACU } from '../api-preset';
import { renderContinuationPrompt_ACU } from '../prompt-template';
import {
  ContinuationValidationError_ACU,
  createContinuationError_ACU,
  type ContinuationInternalAiRequestIdentity_ACU,
  type ContinuationPromptSegment_ACU,
  type ContinuationSettings_ACU,
} from '../model';
import { AGENT_PREFILLS_ACU, buildDefaultContinuationAgentPrompts_ACU } from './agent-defaults';
import { keptSubagentMaterialTokens_ACU, omitSnapshotSectionsForSubagent_ACU, renderFallbackAgentSnapshot_ACU, stripUnownedSubagentPrompt_ACU } from './agent-shared-materials';
import { agentNativeTools_ACU, nativeToolArguments_ACU, nativeToolExchange_ACU, normalizeAgentModelReply_ACU, withNativeToolThinkPrefill_ACU, type AiNativeToolCall_ACU } from '../../ai/native-tool';
import { hasActiveStoryArc_ACU, readAgentModuleFoldState_ACU, readAgentModuleSnapshot_ACU } from './agent-module-store';
import type { AgentFieldPage_ACU, AgentModuleFieldReceipt_ACU } from './agent-module-field-commit';
import { findAgentSubagentDefinition_ACU, renderAgentReadCatalog_ACU, renderAgentWebToolCatalog_ACU, type AgentSubagentDefinition_ACU } from './agent-catalog';
import { renderAgentUserRequirements_ACU } from './agent-user-requirements';
import {
  compactAgentProtocolError_ACU,
  mergeAgentMaintainerOutputs_ACU,
  parseAgentComposerOutput_ACU,
  parseAgentFinalReviewerOutput_ACU,
  parseAgentJsonPayload_ACU,
  parseAgentJsonPayloadDraft_ACU,
  parseAgentToolCall_ACU,
  parseAgentWebToolCall_ACU,
  parseAgentMaintainerOutputDraft_ACU,
  parseAgentPlannerOutput_ACU,
  parseAgentResearcherOutput_ACU,
  parseAgentResearcherToolCalls_ACU,
  parseAgentReviewerOutput_ACU,
  parseAgentSubagentToolCalls_ACU,
  parseAgentWritableToolCalls_ACU,
  renderAgentContractContinuationRequest_ACU,
  type AgentContractRejection_ACU,
} from './agent-protocol';
import {
  AGENT_ENCYCLOPEDIA_SOURCE_LABELS_ACU,
  AgentWebClient_ACU,
  enabledEncyclopediaSources_ACU,
  type AgentFetchedPage_ACU,
} from './agent-web-client';
import { buildAgentFinalReviewEvidence_ACU, type AgentFinalReviewEvidence_ACU } from './agent-final-review-context';
import {
  buildAgentWorldbookScanText_ACU,
  renderAgentStoryCatalog_ACU,
  renderAgentStoryOverview_ACU,
  renderAgentStoryTail_ACU,
  renderAgentOutlineWindow_ACU,
  renderAgentUnsettledHistory_ACU,
  resolveAgentReadToken_ACU,
  type AgentResolveContext_ACU,
} from './agent-placeholder-resolver';
import { buildEmptyAgentWorldbookSnapshot_ACU, renderAgentWorldbookBrowseCatalog_ACU, renderAgentWorldbookTriggeredInjection_ACU } from './agent-worldbook-read';
import { renderAgentTableCatalog_ACU } from './agent-tables';
import { runAgentSearch_ACU } from './agent-search';
import {
  createAgentReadGateState_ACU,
  gateAgentReadBatch_ACU,
  resolveAgentReadBudget_ACU,
  type AgentGateItem_ACU,
  type AgentReadGateConfig_ACU,
  type AgentReadGateState_ACU,
} from './agent-read-gate';
import { AGENT_FINAL_REVIEWER_NAME_ACU } from './agent-model';
import type {
  AgentComposerOutput_ACU,
  AgentMaterialCompletionState_ACU,
  AgentPendingFixSource_ACU,
  AgentDelegation_ACU,
  AgentFinalReviewerOutput_ACU,
  AgentMaintainerOutput_ACU,
  AgentModuleRevisions_ACU,
  AgentPlannerOutput_ACU,
  AgentResearcherOutput_ACU,
  AgentReviewerOutput_ACU,
  AgentRunBudget_ACU,
  AgentSubagentKind_ACU,
  AgentToolCall_ACU,
  AgentWebRefResolvedItem_ACU,
  AgentWebRefResolvedPatch_ACU,
  AgentWebRefSource_ACU,
  AgentWebRefStatus_ACU,
  AgentWebToolCall_ACU,
  AgentWritableModule_ACU,
  AgentSubagentName_ACU,
} from './agent-model';

/**
 * 子代理事件概览的行数上限（按角色）。子代理每次派工都是全新上下文、无提示词缓存，
 * 概览随纪要表线性增长会让长对话里每次派工的固定成本失控，因此按尾部窗口截断。
 * 召回命中的更早轮次不受截断影响（渲染器会将其前置展示），窗口外脉络可用
 * $TABLE:纪要表:行区间 精读，截断说明里带有回溯地址。
 */
export const AGENT_SUBAGENT_OVERVIEW_ROWS_ACU = {
  /** mainline-planner 每轮必派，只需近期脉络与召回命中的关键旧轮。 */
  mainlinePlanner: 50,
  /** 其余子代理（含 arc-architect 的全局校准）给更宽的窗口。 */
  default: 100,
} as const;

export interface AgentSubagentUnresolvedIssue_ACU {
  module: AgentWritableModule_ACU;
  source: AgentPendingFixSource_ACU;
  path: string;
  message: string;
  id?: string;
}

/** 一次子代理执行的结果。写集事务留给主循环应用，这里只交出解析后的输出。 */
export interface AgentSubagentRunResult_ACU {
  agentName: string;
  kind: AgentSubagentKind_ACU;
  /** 该子代理职责固定对应的可写模块（arc → storyArc，maintain → hooks+infoGap，其余为空）。 */
  writes: AgentWritableModule_ACU[];
  /**
   * 总纲子代理的输出。它与 maintainer 共用一份写集契约，但必须分成两个字段：
   * 主循环对 maintainer 结果会把结算水位推到末楼，总纲写入不代表历史已结算，
   * 复用同一字段会让未结算区间被误判为已处理。
   */
  arc: AgentMaintainerOutput_ACU | null;
  maintainer: AgentMaintainerOutput_ACU | null;
  planner: AgentPlannerOutput_ACU | null;
  reviewer: AgentReviewerOutput_ACU | null;
  /** web-researcher 的输出：pageRef 已回填成完整条目，主循环用 applyAgentWebRefsDelta_ACU 落库。 */
  researcher: AgentResearcherOutput_ACU | null;
  /** 用户要求维护子代理的全量替换清单；其它角色为 null。 */
  requirements: string[] | null;
  /** instruction-composer 的写作指令；其它角色省略。 */
  composer?: AgentComposerOutput_ACU | null;
  /** 契约类子代理的结构化完成状态；其它角色省略。 */
  completion?: Exclude<AgentMaterialCompletionState_ACU, 'legacy_unknown'>;
  /** 契约类子代理按职责模块给出的完成状态。 */
  moduleCompletion?: Partial<Record<AgentWritableModule_ACU, Exclude<AgentMaterialCompletionState_ACU, 'legacy_unknown'>>>;
  /** 补足额度耗尽后仍未清偿的问题。 */
  unresolvedIssues?: AgentSubagentUnresolvedIssue_ACU[];
  /** 已通过解析并暂存的稳定条目键，供后续补足去重。 */
  acceptedKeys?: string[];
  /** 本次派工实际发出的模型调用次数（read/search、write_sql 与协议修正均计入）。 */
  iterations: number;
  attempts: number;
  /** 小循环里通过 read/search 补充调阅的地址（读 token 与搜索指纹），进主 Agent 的结果摘要。 */
  expandedReads: string[];
  /** 渲染读集材料那一刻的模块修订号。主循环用它做写入并发校验，不依赖子代理自报。 */
  readRevisions: AgentModuleRevisions_ACU;
  /**
   * 本次派工全部 AI 调用的累计 token 用量；完全没有 usage 回调时为 null。
   * 任一次已观测调用未报告某字段时，该累计字段保持 undefined。
   */
  usage: AiUsageMetadata_ACU | null;
  /** 即时写工具已执行；旧最终写集不得再覆盖本次保存的栏目。 */
  usedFieldWrites?: boolean;
}

export interface AgentSubagentRunInput_ACU {
  delegation: AgentDelegation_ACU;
  settings: ContinuationSettings_ACU;
  resolveContext: AgentResolveContext_ACU;
  budget: AgentRunBudget_ACU;
  preset: ContinuationResolvedApiPreset_ACU;
  createIdentity: (agentName: string, attempt: number) => ContinuationInternalAiRequestIdentity_ACU;
  isCurrent: (identity: ContinuationInternalAiRequestIdentity_ACU) => boolean;
  signal?: AbortSignal | null;
  /** 修正轮只允许维护员触碰仍待修复的模块；首轮不传则使用职责固定写集。 */
  targetModules?: readonly AgentWritableModule_ACU[];
  writeSql?: (input: { role: AgentSubagentName_ACU; sql: string; resolvePage: (handle: string) => AgentFieldPage_ACU | null; isCurrent?: () => boolean }) => Promise<AgentModuleFieldReceipt_ACU>;
  /** 主会话为本轮备好的世界书全文和已有检索。传入后子代理不能再读这些范围。 */
  sharedMaterials?: string;
  /** 主会话当前运行时快照。附在子代理末尾，与主会话看到的是同一份。 */
  mainSnapshot?: string;
}

/** 终审由 finalize 前的受控状态机调用，不接受普通 delegation。 */
export interface AgentFinalReviewRunInput_ACU {
  settings: ContinuationSettings_ACU;
  resolveContext: AgentResolveContext_ACU;
  candidateInstruction: string;
  currentUserInput: string;
  planningSummary?: string;
  createIdentity: (agentName: string, attempt: number) => ContinuationInternalAiRequestIdentity_ACU;
  isCurrent: (identity: ContinuationInternalAiRequestIdentity_ACU) => boolean;
  signal?: AbortSignal | null;
  sharedMaterials?: string;
  mainSnapshot?: string;
}

export interface AgentFinalReviewRunResult_ACU {
  output: AgentFinalReviewerOutput_ACU;
  evidence: AgentFinalReviewEvidence_ACU;
  iterations: number;
  attempts: number;
  toolRounds: number;
  readTokens: number;
  expandedReads: string[];
  readRevisions: AgentModuleRevisions_ACU;
  usage: AiUsageMetadata_ACU | null;
}

export interface AgentSubagentRuntimeDependencies_ACU {
  callInternalAi: (
    messages: Array<{ role: string; content: string }>,
    preset: ContinuationResolvedApiPreset_ACU,
    identity: ContinuationInternalAiRequestIdentity_ACU,
    signal?: AbortSignal | null,
    options?: ContinuationInternalAiCallOptions_ACU,
  ) => Promise<string | import('../../ai/native-tool').AiChatTurn_ACU | null>;
  resolveApiPreset: typeof resolveContinuationApiPreset_ACU;
  resolveAgentApiPreset?: typeof resolveContinuationAgentApiPreset_ACU;
  /** web-researcher 的出网客户端；测试注入假客户端以摆脱网络。 */
  webClient?: AgentWebClient_ACU;
  /** 酒馆自身 origin，用于拒绝 web_read 抓自己；缺省取 location.origin。 */
  hostOrigin?: () => string;
}

const defaultDependencies_ACU: AgentSubagentRuntimeDependencies_ACU = {
  callInternalAi: callContinuationInternalAi_ACU,
  resolveApiPreset: resolveContinuationApiPreset_ACU,
  resolveAgentApiPreset: resolveContinuationAgentApiPreset_ACU,
  hostOrigin: () => (typeof location !== 'undefined' ? location.origin : ''),
};

const PROMPT_KEY_PREFILLS_ACU: Record<AgentSubagentDefinition_ACU['promptKey'], string> = {
  arcArchitect: AGENT_PREFILLS_ACU.arc,
  maintainer: AGENT_PREFILLS_ACU.maintainer,
  mainlinePlanner: AGENT_PREFILLS_ACU.planner,
  beatPlanner: AGENT_PREFILLS_ACU.planner,
  reviewer: AGENT_PREFILLS_ACU.reviewer,
  webResearcher: AGENT_PREFILLS_ACU.researcher,
  instructionComposer: AGENT_PREFILLS_ACU.composer,
};

/** 各类子代理契约对象的判别键：解析器据此从模型全文中挑出正确的 JSON 对象。 */
const KIND_PAYLOAD_KEYS_ACU: Record<AgentSubagentKind_ACU, readonly string[]> = {
  arc: ['delta', 'summary'],
  maintain: ['delta', 'summary'],
  plan: ['recommendation', 'summary'],
  review: ['verdict'],
  research: ['delta', 'summary'],
  compose: ['instruction', 'summary'],
};

/** 一次派工内已抓取页面的句柄缓存：网页正文只在本次派工用于归纳，契约仅回填来源元数据。 */
interface ResearcherPageCache_ACU {
  pages: Map<string, AgentFetchedPage_ACU & { query: string }>;
  /** 已抓取过的 URL → 句柄，同页重抓直接返回旧句柄不计页数。 */
  byUrl: Map<string, string>;
  pagesUsed: number;
}

/**
 * 契约类子代理（总纲/维护）在一次派工里最多追加的续写/修补轮数。
 * 输出被截断或个别条目非法时，只索要剩余或修正条目，不整份重来；这两轮不占协议重试额度。
 */
export const AGENT_CONTRACT_CONTINUATION_ROUNDS_ACU = 2;

/** 维护类子代理固定作用的模块。写入范围由职责决定，不再经派工写集协商。 */
function ownReadPrefixes_ACU(writes: readonly AgentWritableModule_ACU[]): string[] {
  const prefixes: Record<AgentWritableModule_ACU, readonly string[]> = {
    storyArc: ['$STORY_ARC', '$FIELD:storyArc'],
    hooks: ['$HOOKS_LEDGER', '$FIELD:hooks'],
    infoGap: ['$INFO_GAP', '$FIELD:infoGap'],
    chronology: ['$CHRONOLOGY', '$FIELD:chronology'],
    constraints: ['$ACTIVE_CONSTRAINTS', '$FIELD:constraints'],
    webRefs: ['$WEB_REFS', '$FIELD:webRefs'],
    userRequirements: ['$USER_REQUIREMENTS'],
  };
  return writes.flatMap(module => [...prefixes[module]]);
}

function readStaysWithOwner_ACU(key: string, prefixes: readonly string[]): boolean {
  return prefixes.some(prefix => key === prefix || key.startsWith(`${prefix}:`));
}

const KIND_FIXED_WRITES_ACU: Record<AgentSubagentKind_ACU, readonly AgentWritableModule_ACU[]> = {
  arc: ['storyArc'],
  maintain: ['hooks', 'infoGap', 'chronology'],
  plan: [],
  review: [],
  research: ['webRefs'],
  compose: [],
};

function rejectDelegation_ACU(message: string, details?: Record<string, unknown>): never {
  throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_WRITE_REJECTED', 'agent_delegate', message, false, details));
}

function subagentFailed_ACU(message: string, retryable: boolean, details?: Record<string, unknown>): ContinuationValidationError_ACU {
  return new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_SUBAGENT_FAILED', 'agent_delegate', message, retryable, details));
}

function selectPromptSegments_ACU(settings: ContinuationSettings_ACU, definition: AgentSubagentDefinition_ACU): readonly ContinuationPromptSegment_ACU[] {
  return settings.agentPrompts[definition.promptKey];
}

function splitDefaultSubagentMaterials_ACU(
  segments: readonly ContinuationPromptSegment_ACU[],
  key: keyof ContinuationSettings_ACU['agentPrompts'],
): { segments: ContinuationPromptSegment_ACU[]; taskTemplate: string } {
  const defaults = buildDefaultContinuationAgentPrompts_ACU()[key];
  const taskIndex = defaults.findIndex(segment => segment.content.includes('$AGENT_TASK'));
  const candidate = taskIndex >= 0 ? segments[taskIndex] : undefined;
  if (!candidate?.enabled || !candidate.content.includes('$AGENT_TASK') || candidate.content !== defaults[taskIndex].content) {
    return { segments: segments.map(segment => ({ ...segment })), taskTemplate: '' };
  }
  return {
    segments: segments.map((segment, index) => index === taskIndex ? { ...segment, content: '本次任务、写入范围、资料与自检清单均在每次请求末尾的最新快照。' } : { ...segment }),
    taskTemplate: candidate.content,
  };
}

export function renderStoryArcVolumePlanInstruction_ACU(settings: ContinuationSettings_ACU): string {
  const plan = settings.storyArcVolumePlan;
  const capacity = '每个新 volume 必须声明 narrativeRole、targetStageRange、targetTimeSpan、progressCeiling、至少一条 sustainingThreads 和至少一条 payoffTargets。targetStageRange 是解释性容量锚：按单轮约 800–1200 字、标准阶段 6–10 轮校准；60 万字仅对应约 500–750 轮的数量级检查，不承诺固定字数或章节数。';
  if (plan === 'short') return `【总纲卷数计划】短线：新建或全量重构总纲时规划 7–8 卷。${capacity}`;
  if (plan === 'medium') return `【总纲卷数计划】中线：新建或全量重构总纲时规划 10–14 卷。${capacity}`;
  if (plan === 'long') return `【总纲卷数计划】长线：新建或全量重构总纲时规划 20 卷。${capacity}`;
  const count = settings.customStoryArcVolumeCount;
  return `【总纲卷数计划】自定义：新建或全量重构总纲时规划 ${count ?? '未配置'} 卷。${capacity}`;
}

function describeWriteScope_ACU(writes: readonly AgentWritableModule_ACU[]): string {
  if (!writes.length) return '你的职责不含写入。你只需返回建议或判词，不要输出 delta。';
  const labels: Record<AgentWritableModule_ACU, string> = { hooks: '$HOOKS_LEDGER 伏笔账本', infoGap: '$INFO_GAP 认知与信息差时间线', constraints: '$ACTIVE_CONSTRAINTS 长期约束', storyArc: '$STORY_ARC 故事总纲', chronology: '$CHRONOLOGY 故事年代学账本', webRefs: '$WEB_REFS 百科资料库', userRequirements: '$USER_REQUIREMENTS 用户要求' };
  return `你的职责固定写入：${writes.map(item => labels[item]).join('、')}。职责之外的模块一律不许出现在 delta 里。`;
}

interface SubagentGate_ACU {
  state: AgentReadGateState_ACU;
  config: AgentReadGateConfig_ACU;
  /** 本次派工已放行的读取地址（含种子）。重复调阅返回一行提示、不重注、不计账。 */
  granted: Set<string>;
}

interface SubagentMaterial_ACU {
  key: string;
  label: string;
  text: string;
  status?: 'failed';
}

/**
 * 把一条运行时消息插到尾部预填充之前。渲染后的消息序列若以 assistant 预填充收尾，
 * 追加内容必须放在它前面，否则预填充不再是最后一条消息、失去续写引导作用。
 */
export function insertBeforeTrailingPrefill_ACU(
  messages: ReadonlyArray<{ role: string; content: string }>,
  extra: { role: string; content: string },
): Array<{ role: string; content: string }> {
  const last = messages[messages.length - 1];
  if (last && (last.role === 'assistant' || (last.role === 'user' && last.content === USER_PREFILL_CONTENT_ACU))) return [...messages.slice(0, -1), extra, last];
  return [...messages, extra];
}

/**
 * 子代理读取预算状态文本。子代理提示词一次渲染即固定，预算这类随工具轮变化的实时状态
 * 由运行时在首轮注入、并在每次工具批次后追加刷新；本侧门禁是单批次独立判定，额度不跨批累计。
 */
function renderSubagentReadBudgetNote_ACU(params: {
  maxReadTokens: number; fallbackTokens: number; maxToolRounds: number; toolRoundsUsed: number; grantedTokens: number;
}): string {
  const remaining = Math.max(0, params.maxToolRounds - params.toolRoundsUsed);
  return [
    `【读取预算状态】单批次读取上限约 ${params.maxReadTokens} tokens；临近总结阈值时只有不超过 ${params.fallbackTokens} tokens 的精读批次会被放行。`,
    `工具轮次剩余 ${remaining} / ${params.maxToolRounds}（本次派工已累计放行读取约 ${params.grantedTokens} tokens，仅遥测、不扣减后续批次额度）。`,
    '按预算分配调阅：先 search 定位，再用窄地址（楼层区间/表格行区间/模块 ID）精读；轮次见底就基于已有资料交付，缺口如实标注「信息不足」，不许硬编。',
  ].join('\n');
}

function researcherProtocolError_ACU(message: string): never {
  throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_PROTOCOL_INVALID', 'agent_delegate', message, true));
}

/**
 * 用页面缓存回填 web-researcher 契约里的 pageRef。句柄不存在按协议错误处理并回灌可用句柄清单，
 * 让模型改正而不是让运行时猜；pageRef 指向抓取失败的页面同样拒绝——没有可靠来源就不能入库。
 */
function resolveResearcherDraft_ACU(draft: ReturnType<typeof parseAgentResearcherOutput_ACU>, cache: ResearcherPageCache_ACU): AgentResearcherOutput_ACU {
  const available = [...cache.pages.keys()];
  const resolvePage_ACU = (pageRef: string): { title: string; source: AgentWebRefSource_ACU; url: string; query: string; sourceStatus: AgentWebRefStatus_ACU } => {
    const key = pageRef.trim().toUpperCase();
    const page = cache.pages.get(key);
    if (!page) {
      researcherProtocolError_ACU(`pageRef「${pageRef}」不在本次派工的工具结果里。可用句柄：${available.length ? available.join('、') : '（尚未抓取任何页面，先用 encyclopedia_read / web_read 抓取）'}`);
    }
    if (page.status !== 'ok' || !page.text) {
      researcherProtocolError_ACU(`pageRef「${pageRef}」对应的页面抓取失败（${page.note || page.status}），不能入库；换来源或换词重抓，或从契约里去掉这一条`);
    }
    return { title: page.title, source: page.source, url: page.url, query: page.query, sourceStatus: page.status };
  };
  const items = draft.items.map((item): AgentWebRefResolvedItem_ACU => {
    if (item.action === 'retire') {
      return { action: 'retire', id: item.id, title: '', source: 'web', url: '', query: '', tags: [], brief: '', summary: '', sourceStatus: 'ok', reason: item.reason };
    }
    const page = resolvePage_ACU(item.pageRef);
    return {
      action: 'upsert',
      id: item.id,
      title: item.title || page.title,
      source: page.source,
      url: page.url,
      query: page.query,
      tags: item.tags,
      brief: item.brief,
      summary: item.summary,
      sourceStatus: page.sourceStatus,
      reason: '',
    };
  });
  const patches = (draft.patches ?? []).map((patch): AgentWebRefResolvedPatch_ACU => {
    const resolved: AgentWebRefResolvedPatch_ACU = { id: patch.id };
    if (patch.pageRef) {
      const page = resolvePage_ACU(patch.pageRef);
      resolved.source = page.source;
      resolved.url = page.url;
      resolved.query = page.query;
      resolved.sourceStatus = page.sourceStatus;
      if (!patch.title && page.title) resolved.title = page.title;
    }
    if (patch.title) resolved.title = patch.title;
    if (patch.tags) resolved.tags = patch.tags;
    if (patch.brief) resolved.brief = patch.brief;
    if (patch.summary !== undefined) resolved.summary = patch.summary;
    return resolved;
  });
  return { summary: draft.summary, expectedRevision: draft.expectedRevision, items, patches };
}

/** 把一个读地址解析成材料条目。text 已带分节标题，可直接拼接注入。 */
function resolveMaterial_ACU(token: string, context: AgentResolveContext_ACU): SubagentMaterial_ACU {
  const resolved = resolveAgentReadToken_ACU(token, context);
  return { key: token, label: token, text: `### ${resolved.title}（${token}）\n${resolved.text}`,
    ...(resolved.status === 'failed' ? { status: 'failed' as const } : {}) };
}

/** 只有定位到合法模块和安全 ID 的领域拒绝路径才可转为权威读取地址。 */
function blankMaintainerOutput_ACU(summary: string): AgentMaintainerOutput_ACU {
  return {
    summary,
    delta: {
      expectedRevisions: {},
      hooks: [], hookPatches: [], infoGap: [], infoGapPatches: [],
      storyArc: [], storyArcPatches: [], chronology: [], chronologyPatches: [],
      constraintProposals: [],
    },
  };
}

const SQL_QUOTING_ACU = '字符串用单引号，正文里的单引号写成两个单引号。数组和对象用单引号包裹的 JSON 文本，例如 \'["条目"]\'、\'{"min":1,"max":2}\'。列名用 snake_case。新行可以不写 id 和 expected_revision；若写 expected_revision，必须是 0。已有行的 UPDATE/DELETE 在 WHERE 里写 id 和回执给出的当前修订号，SET 里不要写这两项。';

/** 各维护角色的 write_sql 格式、范例和使用时机。运行时注入，不依赖提示词模板是否已迁移。 */
function renderMaintenanceSqlGuide_ACU(name: string): string {
  const head = [
    '调用 write_sql 函数提交。一次调用的 sql 可以包含多条语句，用分号隔开，不要拆成多次调用，也不要写成 JSON、delta 或 Markdown。',
    SQL_QUOTING_ACU,
    '只在资料确实要新增、修改或删除时调用。没有变化就不要调用，直接交最终 JSON 的 summary。status=committed 的 accepted 已保存；有 partials 时按 missingFields 仅 UPDATE 补未保存栏目，不要重发整行。保存状态不确定时先 read 权威帧。',
  ];
  if (name === 'arc-architect') {
    return [
      ...head,
      '只写 story_arc。scope=story 全局只能有一条活跃记录，不要写卷级栏目。volume 在 story 必填栏之外，还必须写 narrative_role、target_stage_range、target_time_span、progress_ceiling、sustaining_threads、payoff_targets。同一时刻只能有一条 volume 的 status 为 active，其余 planned。',
      '何时使用：还没有总纲时 INSERT 全书和各卷；阶段完成后只 UPDATE 当前卷的 stage_numbers；卷收束时再 UPDATE status 和完成依据；废弃一卷用 DELETE 并写 reason。',
      '范例（全书加第一卷，新行修订号为 0）：',
      'INSERT INTO story_arc (scope, title, direction, escalation, withheld, status) VALUES (\'story\', \'追查真相\', \'主角要查清禁区来历，失败就会失去进城资格\', \'从门外怀疑到确认守门人知情\', \'终局身份\', \'active\');',
      'INSERT INTO story_arc (scope, title, direction, escalation, withheld, status, narrative_role, target_stage_range, target_time_span, progress_ceiling, sustaining_threads, payoff_targets) VALUES (\'volume\', \'入城\', \'主角选择进城并结识守门人\', \'从门外观察进入到获得第一块线索\', \'守门人真实身份\', \'active\', \'setup\', \'{"min":1,"max":2}\', \'数日\', \'只确认入口，不揭开禁区核心\', \'["与守门人的信任"]\', \'["拿到第一块晶屑线索"]\');',
      '改已有卷：UPDATE story_arc SET stage_numbers = \'[1]\' WHERE id = \'VOL-01\' AND expected_revision = 0;',
      '删除：DELETE FROM story_arc WHERE id = \'VOL-02\' AND reason = \'与正文冲突\' AND expected_revision = 0;',
    ].join('\n');
  }
  if (name === 'hook-cognition-maintainer') {
    return [
      ...head,
      '只写 hooks、info_gap、chronology，以及建议登记的 constraint_proposals。只登记真实正文里已经发生的变化。大纲里的时间字段是计划，不能写进 chronology。',
      '何时使用：新正文出现线索、伏笔被再次触碰、角色知晓变化、或正文实际跨夜/跨日时调用。没有可证实的变化就不要调用。',
      '伏笔范例：INSERT INTO hooks (summary, status, importance, planted_index, planned_payoff) VALUES (\'守门人右手藏着晶屑\', \'planted\', \'mid\', 3, \'入城后由守门人自己交出\');',
      'status 只能是 planted、reinforced、misled、partially_paid、paid、abandoned。importance 只能是 high、mid、low。',
      '信息差范例：INSERT INTO info_gap (topic, objective_fact, reader_known, character_knowledge, reveal_status) VALUES (\'晶屑来历\', \'晶屑来自禁区核心\', \'读者只看见守门人藏起晶屑\', \'[{"name":"守门人","knows":"亲身保管晶屑"}]\', \'partial\');',
      'reveal_status 为 revealed 时必须同时写 reveal_index；未揭示时 reveal_index 写 NULL。角色知道的内容必须能追溯到亲历、目击、听闻、阅读或转述。',
      '年代学范例：INSERT INTO chronology (anchor, elapsed, precision, transition, evidence_indexes) VALUES (\'入城后的第二天清晨\', \'自开篇约两日\', \'approximate\', \'在城门口守了一夜\', \'[3,4]\');',
      'precision 只能是 exact、approximate、unknown。evidence_indexes 必须是已经出现的正文楼层号。',
      "约束建议：只有真实正文暴露出需要长期遵守的新边界时才登记提议；这不会直接修改长期约束，须由主 Agent 裁决。constraint_proposals 只能 INSERT，只有 text 一列，不写 id、UPDATE 或 DELETE。范例：INSERT INTO constraint_proposals (text) VALUES ('伏笔回收前不要提前揭露守门人身份');",
      '改已有伏笔：UPDATE hooks SET status = \'reinforced\' WHERE id = \'H001\' AND expected_revision = 0;',
      '作废：DELETE FROM hooks WHERE id = \'H001\' AND reason = \'正文已经明示回收\' AND expected_revision = 0;',
    ].join('\n');
  }
  if (name === 'web-researcher') {
    return [
      ...head,
      '只写 web_refs。page_ref 必须是本轮 encyclopedia_read 或 web_read 返回的页面句柄，例如 P1。不要编造 URL，原文不入库。',
      '何时使用：抓到可用页面后 INSERT；确认旧条目过时或错误时 UPDATE 或 DELETE。没有抓到页面就不要 INSERT。',
      '范例：INSERT INTO web_refs (page_ref, name, brief, tags, detail) VALUES (\'P1\', \'守门人\', \'禁区入口的常驻看守\', \'["人物"]\', \'页面写明其只知道铁门前的事\');',
      '修订已有条目：UPDATE web_refs SET name = \'守门人\', brief = \'禁区入口的常驻看守\', page_ref = \'P1\' WHERE id = \'WR-001\' AND expected_revision = 0;',
      '删除：DELETE FROM web_refs WHERE id = \'WR-001\' AND reason = \'页面已不存在\' AND expected_revision = 0;',
    ].join('\n');
  }
  return head.join('\n');
}

/** 回执给出已保存草稿的缺栏时，只示范补齐这些栏目，不重写已接受栏目。 */
function renderMissingAgentSql_ACU(
  item: NonNullable<AgentModuleFieldReceipt_ACU['partials']>[number],
  revision: number,
): string | null {
  const table = { hooks: 'hooks', infoGap: 'info_gap', storyArc: 'story_arc', chronology: 'chronology', webRefs: 'web_refs' }[item.module];
  const samples: Record<string, Record<string, string>> = {
    hooks: { summary: "'守门人藏起晶屑'", status: "'planted'", importance: "'mid'", plantedIndex: '3', plannedPayoff: "'入城后由守门人交出'" },
    infoGap: { topic: "'晶屑来历'", objectiveFact: "'来自禁区核心'", readerKnown: "'读者只见守门人藏起晶屑'", characterKnowledge: `'[{"name":"守门人","knows":"亲身保管晶屑"}]'`, revealStatus: "'unrevealed'" },
    storyArc: { scope: item.id.startsWith('VOL-') ? "'volume'" : "'story'", title: "'入城追查'", direction: "'主角查明晶屑来历'", escalation: "'从守门人隐瞒推进到线索显现'", withheld: "'晶屑真正用途'", status: item.id.startsWith('VOL-') ? "'planned'" : "'active'", narrativeRole: "'setup'", targetStageRange: `'{"min":1,"max":2}'`, targetTimeSpan: "'数日'", progressCeiling: "'仅确认禁区入口'", sustainingThreads: `'["与守门人的信任"]'`, payoffTargets: `'["取得第一块线索"]'` },
    chronology: { anchor: "'入城后的次日'", elapsed: "'约两日'", precision: "'approximate'", transition: "'守了一夜'", evidenceIndexes: "'[3]'" },
    webRefs: { title: "'守门人'", brief: "'禁区入口的看守'", url: "'P1'" },
  };
  // web_refs.url 只能由本次成功读取的页面句柄 page_ref 颁发，不能直接写 URL。
  const assignments = item.missingFields.map(field => {
    const sample = samples[item.module]?.[field];
    if (!sample) return null;
    const column = field === 'url' && item.module === 'webRefs' ? 'page_ref' : field === 'title' && item.module === 'webRefs' ? 'name'
      : field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    return `${column} = ${sample}`;
  });
  if (!table || !assignments.length || assignments.some(value => value === null)) return null;
  return `UPDATE ${table} SET ${assignments.join(', ')} WHERE id = '${item.id.replace(/'/g, "''")}' AND expected_revision = ${revision};`;
}

/** 写回执以已落库的栏目为基线；保存不确定时不能根据旧号建议写入。 */
function renderWriteSqlRepair_ACU(receipt: AgentModuleFieldReceipt_ACU): string {
  if (receipt.partials === null || receipt.revisions === null) {
    return '【write_sql 补栏】保存或恢复状态不确定。先按上一次回执的 ID read $FIELD:模块:ID 权威栏目，核实已存栏目与当前 revisions；不要重发原 SQL 或猜测修订号。';
  }
  const lines: string[] = [];
  const drafts = receipt.partials.filter(item => item.missingFields.length || item.promotionError);
  if (drafts.length || receipt.rejected.length) {
    lines.push('字段对照示例：原 INSERT 拟写 A/B/C/D，若回执 accepted 确认 A/C 已保存而 missingFields 或 rejected 指出 B/D 未保存，下次只按回执给出的真实 ID 和当前 revision 执行 UPDATE B/D；不得重发 INSERT 或 A/C。');
  }
  for (const item of drafts) {
    const revision = receipt.revisions[item.module];
    lines.push(`${item.module}#${item.id} 已有草稿；只缺 ${item.missingFields.join('、') || '领域校验所需的修正'}。当前模块修订号 ${revision}。`);
    if (item.missingFields.length) {
      const sql = renderMissingAgentSql_ACU(item, revision);
      if (sql) lines.push(`仅补缺栏范例：${sql}`);
      else lines.push('先 read 对应 $FIELD:模块:ID，按 missingFields 核对可写列，再仅补未保存的栏目。');
    }
    if (item.module === 'webRefs' && item.missingFields.includes('url')) lines.push('page_ref 必须来自本轮成功的 encyclopedia_read 或 web_read 页面句柄；没有句柄时先读取页面，不要把 P1 当作实际句柄。');
    if (item.promotionError) lines.push(`未能提升：${item.promotionError}。如 missingFields 为空，先 read 核对已存栏目，再只修正领域校验失败的栏目；不能照搬缺栏范例。`);
  }
  for (const item of receipt.rejected) {
    lines.push(`${item.path}：${item.reason}。被拒栏目尚未保存；按报错核对类型、枚举和正文证据，只补拒绝的栏目，不重发 accepted。`);
    if (item.reason === 'not_found') lines.push('先 read 对应 $FIELD:模块:ID 确认记录确实不存在；只有确认为新记录时才用 INSERT，已有草稿必须用 UPDATE。');
    if (item.reason === 'id_exists' || item.reason.startsWith('revision_conflict')) lines.push('先 read 对应 $FIELD:模块:ID 核实已存栏目，再用回执 revisions 或权威快照中的当前模块修订号补写；不要使用旧号或示例的 0。');
    if (item.reason.includes('字段数与值数量不一致') || item.reason.includes('字符串字面量未闭合')) lines.push('正文里的单引号写成两个单引号；检查每个值与列一一对应。');
    if (item.reason.includes('必须是非空字符串数组')) lines.push("数组必须写成单引号包裹的 JSON 文本，例如 '[\"与守门人的信任\"]'，不能用逗号或竖线代替。");
  }
  return lines.join('\n');
}

/** 契约 SQL 已经按栏目落库时，只追缺栏和被拒栏目，不再把整行收成会失败的 patch。 */
function renderIncompleteFieldWrite_ACU(receipt: AgentModuleFieldReceipt_ACU): string | null {
  const rejected = receipt.rejected.filter(item => item.path !== 'host');
  const missing = (receipt.partials ?? []).filter(item => item.missingFields.length || item.promotionError);
  if (!rejected.length && !missing.length && receipt.partials !== null && !renderWriteSqlRepair_ACU(receipt)) return null;
  const lines: string[] = [];
  if (receipt.accepted.length) lines.push(`已写入并保留 ${receipt.accepted.length} 个栏目。不要重发这些栏目。`);
  if (rejected.length) {
    lines.push('下列栏目没有写入：');
    for (const item of rejected) lines.push(`- ${item.path}：${item.reason}`);
  }
  if (missing.length) {
    lines.push('下列条目还缺必填栏目，补齐后才会成为正式资料：');
    for (const item of missing) lines.push(`- ${item.module}#${item.id}：${item.missingFields.join('、') || '提升失败'}${item.promotionError ? `（${item.promotionError}）` : ''}`);
  }
  if (receipt.partials === null || receipt.revisions === null) lines.push('保存状态不确定。先 read $FIELD:模块:ID 读取权威帧，再决定补写。');
  const repair = renderWriteSqlRepair_ACU(receipt);
  if (repair) lines.push(repair);
  lines.push(receipt.partials === null || receipt.revisions === null
    ? '保存状态不确定时先 read 权威帧确认已存栏目和修订号，不要继续写入。'
    : '请只补尚未保存的栏目；已有草稿用 UPDATE，WHERE 带 id 和当前模块 expected_revision。只有权威读取确认不存在的全新行才用 INSERT。不要拆成多次调用。');
  return lines.join('\n');
}

/** 总纲还没建立时，直接要一条 SQL，不再把模型赶回 delta.storyArc。 */
function renderArcSqlBootstrap_ACU(chat: any[], remainingWriteRounds: number): string {
  const lines = [
    '总纲还不能执行。summary、Markdown、delta 和顶层 storyArc 数组都不会入库。',
    remainingWriteRounds > 0
      ? '请调用 write_sql。新行 INSERT 的 expected_revision 固定写 0。补已有行用当前模块修订号，同一条 sql 里的多条 UPDATE 都用这个号。'
      : 'write_sql 轮次已用尽。不要再调用函数。只输出一个 JSON：{"sql":"INSERT 或 UPDATE"}。新行 INSERT 的 expected_revision 写 0；补已有行用当前模块修订号。',
  ];
  const folded = readAgentModuleFoldState_ACU(chat);
  if (folded.salvaged || folded.candidates.some(item => !item.valid)) {
    lines.push('资料帧状态不确定。先 read $FIELD:storyArc 读取权威帧，再决定补写。');
    return lines.join('\n');
  }
  const revision = folded.snapshot.revisions.storyArc;
  lines.push(`当前 story_arc 修订号是 ${revision}。新行 INSERT 的 expected_revision 固定写 0；补已有行才写 ${revision}。每条 INSERT 都必须带 withheld。`);
  const records = Object.entries(folded.fields.records.storyArc ?? {});
  if (!records.length) {
    lines.push('现在没有任何总纲记录。把一条 scope=\'story\' 的全书方向和全部 volume 放进同一条 sql 一次写入，不要拆成多次调用。story 不要带 narrative_role、target_stage_range、sustaining_threads、payoff_targets。只有第一卷 status=\'active\'，其余 \'planned\'。');
  } else {
    lines.push('已有分栏记录，不要重发已保存栏目：');
    for (const [id, record] of records) {
      const saved = Object.keys(record.fields);
      lines.push(`- ${id}（${record.status === 'complete' ? '已是正式条目' : '尚未成为正式条目'}）：已有 ${saved.join('、') || '无'}；缺 ${record.missingFields.join('、') || '无'}。`);
    }
    lines.push('缺栏用 UPDATE，WHERE 带 id 和上面的修订号。还没有的 id 才用 INSERT。');
  }
  lines.push('sustaining_threads 与 payoff_targets 必须是单引号包裹的 JSON 数组，例如 \'["经营线"]\'。target_stage_range 例如 \'{"min":6,"max":10}\'。字符串里的单引号写成两个单引号。');
  return lines.join('\n');
}

function rejectedFieldReadAddresses_ACU(receipt: AgentModuleFieldReceipt_ACU): string[] {
  if (receipt.partials === null || receipt.revisions === null) return [];
  return receipt.rejected.flatMap(({ path }) => {
    const match = /^(storyArc|hooks|infoGap|chronology|webRefs)#([A-Za-z0-9_-]{1,128})(?:\.[A-Za-z][A-Za-z0-9]*|$)$/.exec(path);
    return match && !['__proto__', 'prototype', 'constructor'].includes(match[2]) ? [`$FIELD:${match[1]}:${match[2]}`] : [];
  });
}

/** 子代理运行时。一个实例可服务多次派工，自身不持有任何本轮状态。 */
export class AgentSubagentRuntime_ACU {
  private readonly dependencies: AgentSubagentRuntimeDependencies_ACU;
  constructor(dependencies: Partial<AgentSubagentRuntimeDependencies_ACU> = {}) {
    this.dependencies = { ...defaultDependencies_ACU, ...dependencies };
  }

  /**
   * 执行一次派工。
   * @param input 派工内容、设置、解析上下文、预算与身份工厂
   * @returns 解析后的子代理输出；种子超预算或重试耗尽时抛错
   */
  async run(input: AgentSubagentRunInput_ACU): Promise<AgentSubagentRunResult_ACU> {
    const definition = findAgentSubagentDefinition_ACU(input.delegation.agentName);
    if (!definition) {
      rejectDelegation_ACU(`目录里没有名为 ${input.delegation.agentName} 的子代理`, { agentName: input.delegation.agentName });
    }
    const writes = definition.kind === 'maintain' && input.targetModules?.length
      ? [...KIND_FIXED_WRITES_ACU[definition.kind]].filter((module): module is AgentWritableModule_ACU => input.targetModules!.includes(module))
      : [...KIND_FIXED_WRITES_ACU[definition.kind]];
    const gate: SubagentGate_ACU = {
      state: createAgentReadGateState_ACU(),
      config: {
        historyTokenBudget: input.settings.agentHistoryTokenBudget,
        readTokenBudget: input.settings.agentReadTokenBudget,
        fallbackTokens: input.settings.agentReadFallbackTokens,
      },
      granted: new Set(),
    };

    // 种子读集：免授权，直接解析；注入前整批记入本次派工自己的门禁账本。
    const seedTokens = [...new Set(input.delegation.reads.map(raw => String(raw ?? '').trim()).filter(Boolean))];
    const seeds = seedTokens.map(token => resolveMaterial_ACU(token, input.resolveContext));
    const failedSeed = seeds.find(seed => seed.status === 'failed');
    if (failedSeed) throw subagentFailed_ACU(`派工种子读取失败：${failedSeed.key}`, false, { address: failedSeed.key, reason: failedSeed.text });
    const seedDecision = await gateAgentReadBatch_ACU(seeds.map(seed => ({ label: seed.label, text: seed.text })), gate.state, gate.config, 0);
    if (!seedDecision.allowed) {
      rejectDelegation_ACU(
        `派工种子读集超出读取预算，整次派工未执行。请缩小 reads——正文用更窄的 $STORY_RANGE 区间、表格用 $TABLE:表名:行区间、模块按 ID 精读。\n${seedDecision.report}`,
        { agentName: definition.name, seedTokens, batchTokens: seedDecision.batchTokens },
      );
    }
    gate.state.grantedTokens += seedDecision.batchTokens;
    for (const seed of seeds) gate.granted.add(seed.key);
    const materials = seeds.length
      ? seeds.map(seed => seed.text).join('\n\n')
      : '本次没有为你注入任何种子资料。需要的信息用 read / search 工具按各目录的地址调阅。';

    // 捕获与渲染必须同一时刻取自同一份快照，否则并发校验的基准就不是子代理真正读到的版本。
    const readRevisions: AgentModuleRevisions_ACU = { ...input.resolveContext.moduleSnapshot.revisions };
    // 概览行数按角色裁剪：mainline-planner 每轮必派、只需近期脉络，取最近 50 轮；其余子代理
    // （含 arc-architect）取最近 100 轮。召回命中的更早轮次不受截断影响（前置展示纪要全文）。
    const overviewMaxRows = definition.promptKey === 'mainlinePlanner'
      ? AGENT_SUBAGENT_OVERVIEW_ROWS_ACU.mainlinePlanner
      : AGENT_SUBAGENT_OVERVIEW_ROWS_ACU.default;
    const isResearch = definition.kind === 'research';
    const webSettings = input.settings.webResearch;
    const pageCache: ResearcherPageCache_ACU = { pages: new Map(), byUrl: new Map(), pagesUsed: 0 };
    // 网页检索天然要多轮「搜 → 读 → 补搜」，工具轮上限独立于普通子代理的 maxExtraReads。
    const maxToolRounds = Math.max(0, isResearch ? webSettings.maxToolRounds : input.budget.maxExtraReads);
    const readBudget = resolveAgentReadBudget_ACU(gate.config);
    const renderReadBudgetNote = (roundsUsed: number): string => renderSubagentReadBudgetNote_ACU({
      maxReadTokens: readBudget.effectiveMaxReadTokens,
      fallbackTokens: readBudget.effectiveFallbackTokens,
      maxToolRounds,
      toolRoundsUsed: roundsUsed,
      grantedTokens: gate.state.grantedTokens,
    });
    const keptTokens = keptSubagentMaterialTokens_ACU(definition.kind, writes);
    const split = splitDefaultSubagentMaterials_ACU(selectPromptSegments_ACU(input.settings, definition), definition.promptKey);
    const promptSegments = stripUnownedSubagentPrompt_ACU(split.segments, keptTokens);
    const resolvers = {
      $AGENT_READ_MATERIALS: () => materials,
      $AGENT_TASK: () => input.delegation.prompt,
      $AGENT_WRITE_SCOPE: () => describeWriteScope_ACU(writes),
      $USER_INTENT: () => input.resolveContext.originInstruction || '（用户未提供初始要求）',
      $USER_REQUIREMENTS: () => renderAgentUserRequirements_ACU(input.resolveContext.moduleSnapshot, input.resolveContext.originInstruction),
      $OUTLINE_WINDOW: () => renderAgentOutlineWindow_ACU(input.resolveContext),
      // 资料目录与固定注入：默认提示词按角色矩阵引用；未引用的占位符不产生开销（惰性渲染）。
      $AGENT_READ_CATALOG: () => renderAgentReadCatalog_ACU(),
      $STORY_CATALOG: () => renderAgentStoryCatalog_ACU(input.resolveContext),
      $TABLE_CATALOG: () => renderAgentTableCatalog_ACU(input.resolveContext.tableData),
      $WORLDBOOK_CATALOG: () => renderAgentWorldbookBrowseCatalog_ACU(input.resolveContext.worldbook ?? buildEmptyAgentWorldbookSnapshot_ACU(false)),
      $WORLDBOOK_HITS: () => {
        const worldbook = input.resolveContext.worldbook ?? buildEmptyAgentWorldbookSnapshot_ACU(false);
        if (definition.kind === 'arc') return '总纲不注入命中条目全文。请用已启用世界书目录自行选择 read，或用 search 的 worldbook 域按关键词检索。';
        return renderAgentWorldbookTriggeredInjection_ACU(worldbook, buildAgentWorldbookScanText_ACU(input.resolveContext));
      },
      $STORY_OVERVIEW: () => renderAgentStoryOverview_ACU({ tableData: input.resolveContext.tableData, recallCodes: input.resolveContext.recallCodes }, { maxRows: overviewMaxRows }),
      $STORY_TAIL: () => renderAgentStoryTail_ACU(input.resolveContext),
      $HISTORY_UNSETTLED: () => renderAgentUnsettledHistory_ACU(input.resolveContext),
      $HOOKS_LEDGER: () => resolveAgentReadToken_ACU('$HOOKS_LEDGER', input.resolveContext).text,
      $INFO_GAP: () => resolveAgentReadToken_ACU('$INFO_GAP', input.resolveContext).text,
      $ACTIVE_CONSTRAINTS: () => resolveAgentReadToken_ACU('$ACTIVE_CONSTRAINTS', input.resolveContext).text,
      $STORY_ARC: () => resolveAgentReadToken_ACU('$STORY_ARC', input.resolveContext).text,
      $CHRONOLOGY: () => resolveAgentReadToken_ACU('$CHRONOLOGY', input.resolveContext).text,
      $WEB_REFS: () => resolveAgentReadToken_ACU('$WEB_REFS', input.resolveContext).text,
      $WEB_TOOL_CATALOG: () => renderAgentWebToolCatalog_ACU({
        sources: enabledEncyclopediaSources_ACU(webSettings).map(source => `${source}（${AGENT_ENCYCLOPEDIA_SOURCE_LABELS_ACU[source]}）`),
        provider: webSettings.searchProvider,
        maxPages: webSettings.maxPages,
        pageCharLimit: webSettings.pageCharLimit,
        pagesUsed: pageCache.pagesUsed,
      }),
    };
    const rendered = await renderContinuationPrompt_ACU(promptSegments, resolvers, 'agent_delegate');
    const renderTaskMaterial = async (): Promise<string> => split.taskTemplate
      ? (await renderContinuationPrompt_ACU([{ role: 'user', content: split.taskTemplate }], resolvers, 'agent_delegate')).messages[0].content
      : '';

    const prefill = PROMPT_KEY_PREFILLS_ACU[definition.promptKey];
    // 总纲卷数计划是随设置变化的运行时指令，不进提示词模板；但它必须落在尾部预填充之前——
    // 追加在预填充之后会让对话以一条 user 消息收尾，预填充失效，模型会另起一段回复而不是续写 JSON。
    let baseMessages = rendered.messages;
    const presentTokens = new Set([...promptSegments, ...(split.taskTemplate ? [{ content: split.taskTemplate }] : [])].flatMap(segment => segment.content.match(/\$[A-Z][A-Z0-9_]*/g) ?? [] as string[]));
    const renderRequestSnapshot = async (): Promise<string> => {
      const originalSnapshot = input.mainSnapshot?.trim() ?? '';
      const mainReadsAt = originalSnapshot.indexOf('\n\n【主会话已调阅】');
      const latestSnapshot = usedFieldWrites
        ? [await renderFallbackAgentSnapshot_ACU(input.settings, input.resolveContext), ...(mainReadsAt >= 0 ? [originalSnapshot.slice(mainReadsAt + 2)] : [])].join('\n\n')
        : originalSnapshot || await renderFallbackAgentSnapshot_ACU(input.settings, input.resolveContext);
      const snapshotText = omitSnapshotSectionsForSubagent_ACU(latestSnapshot, presentTokens, { dropTriggeredWorldbook: definition.kind === 'arc' });
      const taskMaterial = await renderTaskMaterial();
      return [snapshotText, taskMaterial || `【本次派工任务】\n${input.delegation.prompt}`, ...(taskMaterial ? [] : [`【本轮种子资料】\n${materials}`]), definition.promptKey === 'arcArchitect' ? renderStoryArcVolumePlanInstruction_ACU(input.settings) : '', input.sharedMaterials ?? ''].filter(Boolean).join('\n\n');
    };
    // 预算状态随每次请求尾部快照刷新。
    const ownReads = input.sharedMaterials !== undefined ? ownReadPrefixes_ACU(writes) : null;
    if (input.writeSql && writes.length) baseMessages = insertBeforeTrailingPrefill_ACU(baseMessages, { role: 'system', content: renderMaintenanceSqlGuide_ACU(definition.name) });
    if (ownReads) baseMessages = insertBeforeTrailingPrefill_ACU(baseMessages, { role: 'system', content: ownReads.length ? `世界书全文和各资料库已在【本轮已备资料】。不要再读世界书、正文、大纲或做跨库搜索。你只能 read 自己维护的详细资料：${ownReads.join('、')}。` : '世界书全文和各资料库已在【本轮已备资料】。你没有调阅工具，直接根据这些资料交付。' });
    const retries = normalizeContinuationInternalAiRetryLimit_ACU(input.settings.internalAiRetryLimit);
    // 小循环的追加消息：子代理自己的输出（assistant）与工具结果。原生工具回执使用 role=tool。
    const transcript: Array<{ role: string; content: string; tool_calls?: NonNullable<ReturnType<typeof nativeToolExchange_ACU>[number]['tool_calls']>; tool_call_id?: string }> = [];
    const trailingPrefill = (baseMessages[baseMessages.length - 1]?.role === 'assistant' || baseMessages[baseMessages.length - 1]?.content === USER_PREFILL_CONTENT_ACU) ? baseMessages.pop() : undefined;
    const expandedReads: string[] = [];
    let toolRoundsUsed = 0;
    let writeRoundsUsed = 0;
    const maxWriteRounds = input.writeSql && writes.length ? Math.max(1, input.budget.maxIterations) : 0;
    let usedFieldWrites = false;
    const confirmedFields = new Set<string>();
    const writeProblems = new Map<string, AgentSubagentUnresolvedIssue_ACU>();
    let writeAttempted = false;
    let writeStateUnknown = false;
    const recordWriteReceipt = (receipt: AgentModuleFieldReceipt_ACU): void => {
      if (receipt.partials === null || receipt.revisions === null) writeStateUnknown = true;
      for (const item of receipt.accepted) {
        const key = `${item.module}#${item.id}.${item.field}`;
        confirmedFields.add(`${item.module}:${item.id}:${item.field}`);
        writeProblems.delete(key);
      }
      for (const item of receipt.rejected) {
        const match = /^(hooks|infoGap|storyArc|chronology|webRefs)#([^.#]+)\.([A-Za-z][A-Za-z0-9]*)$/.exec(item.path);
        const module = match?.[1] as AgentWritableModule_ACU | undefined;
        writeProblems.set(item.path, { module: module && writes.includes(module) ? module : writes[0],
          source: 'transaction_rejected', path: item.path, message: item.reason,
          ...(match ? { id: match[2] } : {}) });
      }
      const settledIds = new Set([
        ...receipt.accepted.map(item => `${item.module}#${item.id}`),
        ...(receipt.partials ?? []).map(item => `${item.module}#${item.id}`),
      ]);
      for (const [key, issue] of writeProblems) {
        if (settledIds.has(key) && issue.message.startsWith('revision_conflict')) writeProblems.delete(key);
      }
    };
    const terminalIssues = (): AgentSubagentUnresolvedIssue_ACU[] => {
      if (!writeAttempted) return [];
      const issues = new Map(writeProblems);
      if (writeStateUnknown) {
        issues.set('write_state', { module: writes[0], source: 'invoke_failed', path: 'write_state',
          message: '逐栏保存或补偿状态未确认，必须重新读取权威资料' });
      }
      const folded = readAgentModuleFoldState_ACU(input.resolveContext.chat);
      if (folded.salvaged || folded.candidates.some(item => !item.valid)) {
        issues.set('frame', { module: writes[0], source: 'invoke_failed', path: 'frame', message: '资料帧损坏，无法确认逐栏完成' });
      } else {
        for (const module of writes) for (const record of Object.values(folded.fields.records[module] ?? {})) {
          if (record.status !== 'partial') continue;
          for (const field of record.missingFields) issues.set(`${module}#${record.id}.${field}`, { module,
            source: 'transaction_rejected', id: record.id, path: `${module}#${record.id}.${field}`, message: `必填栏目 ${field} 尚未提交` });
        }
        for (const key of confirmedFields) {
          const [module, id, field] = key.split(':') as [AgentWritableModule_ACU, string, string];
          const record = folded.fields.records[module]?.[id];
          if (!record?.fields[field]) issues.set(`${module}#${id}.${field}`, { module, id, source: 'invoke_failed',
            path: `${module}#${id}.${field}`, message: '写入回执未在当前权威资料中得到确认' });
        }
      }
      return [...issues.values()];
    };
    let protocolRejections = 0;
    let attempt = 0;
    let lastReason = '';
    let committedWriteObserved = false;
    // 本次派工的累计用量。只有每次已观测调用都报告某字段时，该字段才具备可求和的完整性。
    let usageTotal: AiUsageMetadata_ACU | null = null;
    const addCompleteCount = (current: number | undefined, incoming: number | undefined): number | undefined => (
      current !== undefined && incoming !== undefined ? current + incoming : undefined
    );
    const callOptions: ContinuationInternalAiCallOptions_ACU = {
      promptCacheEnabled: true,
      // 每次派工的对话全新；命名空间按角色和可用工具稳定划分，不跟随尝试号。
      cacheScope: `sub-${definition.name}`,
      cacheTools: ['read', 'search', ...(isResearch ? ['encyclopedia_search', 'encyclopedia_read', 'web_search', 'web_read'] : []), ...(input.writeSql && writes.length ? ['write_sql', ...writes.map(module => `module:${module}`)] : [])],
      tools: agentNativeTools_ACU([
        ...(ownReads ? [...(ownReads.length ? ['read' as const] : []), ...(input.writeSql && writes.length ? ['write_sql' as const] : [])] : (input.writeSql && writes.length ? ['read' as const, 'search' as const, 'write_sql' as const] : ['read' as const, 'search' as const])),
        ...(isResearch ? ['encyclopedia_search' as const, 'encyclopedia_read' as const, 'web_search' as const, 'web_read' as const] : []),
      ]),
      minOutputTokens: CONTINUATION_ROLE_OUTPUT_TOKEN_FLOORS_ACU[definition.promptKey],
      onUsage: usage => {
        usageTotal = usageTotal
          ? {
            promptTokens: addCompleteCount(usageTotal.promptTokens, usage.promptTokens),
            completionTokens: addCompleteCount(usageTotal.completionTokens, usage.completionTokens),
            cachedTokens: addCompleteCount(usageTotal.cachedTokens, usage.cachedTokens),
            cacheWriteTokens: addCompleteCount(usageTotal.cacheWriteTokens, usage.cacheWriteTokens),
          }
          : {
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            cachedTokens: usage.cachedTokens,
            cacheWriteTokens: usage.cacheWriteTokens,
          };
      },
    };
    // 调用总数上界 = 首轮 + 读取轮 + 写轮 + 协议重试 + 额度用尽后的最后通牒轮 + 契约续写/修补轮。到界仍未交付即失败。
    const contractKind = definition.kind === 'arc' || definition.kind === 'maintain';
    const maxContinuations = contractKind ? AGENT_CONTRACT_CONTINUATION_ROUNDS_ACU : 0;
    const maxCalls = 1 + maxToolRounds + maxWriteRounds + retries + 1 + maxContinuations;
    // 契约草稿累积：截断或单条非法时不整份重来，先收下合法条目，再只向模型索要剩余/修正条目。
    let accumulated: AgentMaintainerOutput_ACU | null = null;
    let continuationsUsed = 0;
    // 跨轮未清偿的被拒条目：模型在续写里没有重发修正版就不能算完成，否则条目会被静默丢掉。
    let outstanding: AgentContractRejection_ACU[] = [];
    const acceptedKeys = (output: AgentMaintainerOutput_ACU): Set<string> => new Set([
      ...[...output.delta.hooks, ...output.delta.hookPatches].map(item => `hooks:${item.id}`),
      ...[...output.delta.infoGap, ...output.delta.infoGapPatches].map(item => `infoGap:${item.id}`),
      ...[...output.delta.storyArc, ...output.delta.storyArcPatches].map(item => `storyArc:${item.id}`),
      ...[...output.delta.chronology, ...output.delta.chronologyPatches].map(item => `chronology:${item.id}`),
    ]);
    const deliverContract = (
      output: AgentMaintainerOutput_ACU,
      rejected: readonly AgentContractRejection_ACU[] = [],
      truncated = false,
    ): AgentSubagentRunResult_ACU => {
      const accepted = [...new Set([...acceptedKeys(output), ...confirmedFields])];
      const unresolvedIssues: AgentSubagentUnresolvedIssue_ACU[] = [...terminalIssues(), ...rejected.map(item => ({
        module: item.module,
        source: 'contract_rejected' as const,
        path: `${item.module}[${item.index}]`,
        message: item.reason,
        ...(item.id ? { id: item.id } : {}),
      }))];
      if (truncated) {
        for (const module of writes) {
          unresolvedIssues.push({
            module,
            source: 'truncated',
            path: module,
            message: '契约输出在 JSON 中途截断，尾部条目尚未确认完整',
          });
        }
      }
      const issueModules = new Set(unresolvedIssues.map(item => item.module));
      const moduleCompletion: AgentSubagentRunResult_ACU['moduleCompletion'] = {};
      for (const module of writes) {
        const hasAccepted = accepted.some(key => key.startsWith(`${module}:`));
        moduleCompletion[module] = issueModules.has(module)
          ? (hasAccepted ? 'partial' : 'failed')
          : (hasAccepted ? 'complete_changed' : 'complete_no_change');
      }
      const changed = accepted.length > 0 || output.delta.constraintProposals.length > 0;
      const completion: NonNullable<AgentSubagentRunResult_ACU['completion']> = unresolvedIssues.length
        ? (writeAttempted ? 'failed' : changed ? 'partial' : 'failed')
        : (changed ? 'complete_changed' : 'complete_no_change');
      if (writeAttempted && unresolvedIssues.length) for (const module of writes) {
        if (moduleCompletion[module] === 'partial') moduleCompletion[module] = 'failed';
      }
      return {
      agentName: definition.name,
      kind: definition.kind,
      writes,
      arc: definition.kind === 'arc' && completion !== 'failed' ? output : null,
      maintainer: definition.kind === 'maintain' && completion !== 'failed' ? output : null,
      planner: null,
      reviewer: null,
      researcher: null,
      requirements: null,
      completion,
      moduleCompletion,
      unresolvedIssues,
      acceptedKeys: accepted,
      iterations: attempt,
      attempts: attempt,
      expandedReads: [...expandedReads],
      readRevisions,
      usage: usageTotal,
      usedFieldWrites,
      };
    };

    for (let call = 0; call < maxCalls; call += 1) {
      const identity = input.createIdentity(definition.name, attempt);
      attempt += 1;
      if (!input.isCurrent(identity)) {
        throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'agent_delegate', '子代理请求已失效', false));
      }
      // 传输错误（502/网络抖动）按设置延时重试；协议/契约拒绝仍走小循环内的对话级立即重试。
      const requestSnapshot = await renderRequestSnapshot();
      const raw = await callContinuationInternalAiWithRetry_ACU(
        () => this.dependencies.callInternalAi(
          withNativeToolThinkPrefill_ACU([...baseMessages, ...transcript, { role: 'user', content: `${requestSnapshot}\n\n${renderReadBudgetNote(toolRoundsUsed)}` }, ...(trailingPrefill?.content === USER_PREFILL_CONTENT_ACU ? [trailingPrefill] : [])]),
          input.preset,
          identity,
          input.signal,
          callOptions,
        ),
        {
          transportRetries: retries,
          retryDelaySeconds: input.settings.retryDelaySeconds,
          isCurrent: () => input.isCurrent(identity) && !input.signal?.aborted,
        },
      );
      if (!input.isCurrent(identity)) {
        throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'agent_delegate', '子代理结果已失效', false));
      }
      const turn = normalizeAgentModelReply_ACU(raw);
      const nativeCalls: AiNativeToolCall_ACU[] = turn.toolCalls;
      const protocolText = typeof raw === 'string' || raw == null ? String(raw ?? '') : turn.content;
      const rawText = protocolText.trim();

      // 函数调用参数保留原生 ID；权限和领域校验仍由对应的解析器执行。
      let toolCalls: ReturnType<typeof parseAgentWritableToolCalls_ACU>;
      try {
        toolCalls = nativeCalls.length ? nativeToolArguments_ACU(nativeCalls).map(({ call, payload }) => {
          if (call.name === 'write_sql') {
            if (!input.writeSql || !writes.length || typeof payload.sql !== 'string' || !payload.sql.trim()
              || Object.keys(payload).some(key => key !== 'action' && key !== 'sql')) throw new Error('write_sql 未授权或参数非法');
            return { kind: 'write_sql' as const, sql: payload.sql.trim() };
          }
          const { notes: _notes, ...argumentsWithoutNotes } = payload;
          if (['encyclopedia_search', 'encyclopedia_read', 'web_search', 'web_read'].includes(call.name)) {
            if (!isResearch) throw new Error(`出网工具 ${call.name} 未授权`);
            return parseAgentWebToolCall_ACU(argumentsWithoutNotes);
          }
          if (call.name !== 'read' && call.name !== 'search') throw new Error(`未知工具 ${call.name}`);
          if (_notes !== undefined && !isResearch) throw new Error('非研究角色不得传 notes');
          return parseAgentToolCall_ACU(argumentsWithoutNotes);
        }) : null;
        if (!nativeCalls.length && (input.writeSql && writes.length
          ? parseAgentWritableToolCalls_ACU(protocolText, prefill, isResearch)
          : isResearch ? parseAgentResearcherToolCalls_ACU(protocolText, prefill) : parseAgentSubagentToolCalls_ACU(protocolText, prefill))) {
          throw new Error('工具必须通过原生函数调用，不能作为 JSON 文本输出');
        }
      } catch (error) {
        protocolRejections += 1;
        if (protocolRejections > retries) {
          if (writeAttempted) throw subagentFailed_ACU('写入后工具协议重试耗尽，逐栏维护未完成', false, {
            agentName: definition.name, acceptedKeys: [...confirmedFields], unresolvedIssues: [
              ...terminalIssues(), { module: writes[0], source: 'protocol_failed', path: 'write_sql', message: compactAgentProtocolError_ACU(error) },
            ],
          });
          throw error;
        }
        const reason = `工具动作未执行：${compactAgentProtocolError_ACU(error)}。请修正 action / sql 后重试。`;
        if (nativeCalls.length) transcript.push(...nativeToolExchange_ACU(turn.content, nativeCalls, nativeCalls.map(() => reason)));
        else transcript.push({ role: 'assistant', content: rawText || '(空输出)' }, { role: 'user', content: reason }); // 非工具协议纠错，不是工具回执
        continue;
      }
      if (toolCalls) {
        const readsAllowed = toolRoundsUsed < maxToolRounds;
        if (!readsAllowed && toolCalls.every(item => item.kind !== 'write_sql')) {
          const exhausted = isResearch
            ? `工具轮次已用尽（上限 ${maxToolRounds} 轮）。请基于已抓到的页面输出契约 JSON；没查到的实体在 summary 里如实列出，不许伪造。\n\n${renderReadBudgetNote(toolRoundsUsed)}`
            : `read/search 轮次已用尽（上限 ${maxToolRounds} 轮）。请基于已有资料输出契约 JSON；确实缺失的信息在结果里标注「信息不足」，不许伪造。\n\n${renderReadBudgetNote(toolRoundsUsed)}`;
          transcript.push(...nativeToolExchange_ACU(turn.content, nativeCalls, nativeCalls.map(() => exhausted)));
          continue;
        }
        if (readsAllowed && toolCalls.some(item => item.kind !== 'write_sql')) toolRoundsUsed += 1;
        const perCallResults: string[] = [];
        for (const call of toolCalls) {
          if (call.kind === 'write_sql') {
            if (writeRoundsUsed >= maxWriteRounds) {
              const exhausted = JSON.stringify({ action: 'write_sql', originalSql: call.sql, status: 'rejected', accepted: [], reason: 'write_sql 轮次已用尽',
                remainingToolRounds: maxToolRounds - toolRoundsUsed, remainingWriteRounds: 0 });
              perCallResults.push(exhausted);
              continue;
            }
            writeRoundsUsed += 1;
            writeAttempted = true;
            if (!input.isCurrent(identity) || input.signal?.aborted) {
              throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'agent_delegate', '写入请求已失效', false));
            }
            try {
              const receipt = await input.writeSql!({ role: definition.name, sql: call.sql,
                isCurrent: () => input.isCurrent(identity) && !input.signal?.aborted, resolvePage: handle => {
                const page = pageCache.pages.get(handle.trim().toUpperCase());
                return page?.status === 'ok' && page.text ? { title: page.title, source: page.source, url: page.url, query: page.query, sourceStatus: page.status } : null;
              } });
              if (!input.isCurrent(identity) || input.signal?.aborted) throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'agent_delegate', '写入回执已失效', false));
              recordWriteReceipt(receipt);
              if (receipt.status === 'committed') {
                committedWriteObserved = true;
                usedFieldWrites = true;
                input.resolveContext.moduleSnapshot = readAgentModuleSnapshot_ACU(input.resolveContext.chat);
                for (const key of gate.granted) if (key.startsWith('$FIELD:') || key.startsWith('$HOOKS_LEDGER') || key.startsWith('$INFO_GAP') || key.startsWith('$CHRONOLOGY') || key.startsWith('$STORY_ARC') || key.startsWith('$WEB_REFS')) gate.granted.delete(key);
              }
              const repair = renderWriteSqlRepair_ACU(receipt);
              const receiptText = JSON.stringify({ action: 'write_sql', originalSql: call.sql, ...receipt,
                fieldOutcome: receipt.partials === null || receipt.revisions === null ? '保存状态不明；先读取权威字段' : {
                  saved: receipt.accepted.map(item => ({ module: item.module, id: item.id, field: item.field, revision: item.revision, ...('value' in item ? { value: item.value } : {}) })),
                  notSaved: [...receipt.partials.flatMap(item => item.missingFields.map(field => `${item.module}#${item.id}.${field}`)), ...receipt.rejected.map(item => item.path)],
                  generatedIds: [...new Set(receipt.accepted.map(item => `${item.module}#${item.id}`))],
                },
                readAddresses: [...new Set([
                  ...receipt.accepted.map(item => `$FIELD:${item.module}:${item.id}:${item.field}`),
                  ...(receipt.partials ?? []).map(item => `$FIELD:${item.module}:${item.id}`),
                  ...rejectedFieldReadAddresses_ACU(receipt),
                ])],
                remainingToolRounds: maxToolRounds - toolRoundsUsed, remainingWriteRounds: maxWriteRounds - writeRoundsUsed });
              const writeResult = repair ? `${receiptText}\n${repair}` : receiptText;
              perCallResults.push(writeResult);
            } catch (error) {
              if (error instanceof ContinuationValidationError_ACU && error.error.code === 'CONTINUATION_INTERNAL_REQUEST_STALE') throw error;
              writeStateUnknown = true;
              writeProblems.set('host', { module: writes[0], source: 'invoke_failed', path: 'host', message: compactAgentProtocolError_ACU(error) });
              const unknownResult = `${JSON.stringify({ action: 'write_sql', originalSql: call.sql, status: 'rejected', accepted: [],
                rejected: [{ path: 'host', reason: compactAgentProtocolError_ACU(error) }], partials: null, revisions: null,
                readAddresses: [], reason: compactAgentProtocolError_ACU(error),
                remainingToolRounds: maxToolRounds - toolRoundsUsed, remainingWriteRounds: maxWriteRounds - writeRoundsUsed })}\n【write_sql 补栏】保存状态无法确认。先 read 对应 $FIELD:模块:ID 权威帧与当前修订号，不要重发原 SQL。`;
              perCallResults.push(unknownResult);
            }
          } else {
            if (!readsAllowed) {
              const denied = JSON.stringify({ action: call.kind, status: 'rejected', reason: 'read/search 轮次已用尽',
                remainingToolRounds: 0, remainingWriteRounds: maxWriteRounds - writeRoundsUsed });
              perCallResults.push(denied);
              continue;
            }
            const result = await this.executeToolCalls_ACU([call], input.resolveContext, gate, expandedReads, ownReads,
              isResearch ? { settings: input.settings, cache: pageCache } : undefined);
            perCallResults.push(result);
          }
        }
        const roundNote = maxWriteRounds ? `write_sql 轮次剩余 ${maxWriteRounds - writeRoundsUsed} / ${maxWriteRounds}。` : '';
        const note = renderReadBudgetNote(toolRoundsUsed);
        const results = nativeCalls.map((_, index) => [perCallResults[index] || '工具没有返回内容', roundNote, note].filter(Boolean).join('\n\n'));
        transcript.push(...nativeToolExchange_ACU(turn.content, nativeCalls, results));
        continue;
      }

      try {
        if (isResearch) {
          const payload = parseAgentJsonPayload_ACU(protocolText, nativeCalls.length ? '' : prefill, KIND_PAYLOAD_KEYS_ACU.research);
          if (payload.sql !== undefined) throw new Error('文本契约中的 sql 不会执行；请调用原生 write_sql 函数提交写入');
          const draft = parseAgentResearcherOutput_ACU(payload);
          const researcher = resolveResearcherDraft_ACU(draft, pageCache);
          return {
            agentName: definition.name,
            kind: definition.kind,
            writes,
            arc: null,
            maintainer: null,
            planner: null,
            reviewer: null,
            researcher,
            requirements: null,
            iterations: attempt,
            usedFieldWrites,
            attempts: attempt,
            expandedReads: [...expandedReads],
            readRevisions,
            usage: usageTotal,
          };
        }
        if (contractKind) {
          const draft = parseAgentJsonPayloadDraft_ACU(protocolText, nativeCalls.length ? '' : prefill, KIND_PAYLOAD_KEYS_ACU[definition.kind]);
          if (draft.payload.sql !== undefined) throw new Error('文本契约中的 sql 不会执行；请调用原生 write_sql 函数提交写入');
          const parsed = parseAgentMaintainerOutputDraft_ACU(draft.payload);
          accumulated = accumulated ? mergeAgentMaintainerOutputs_ACU(accumulated, parsed.output) : parsed.output;
          // 上一轮被拒的条目：本轮重发了合法版本即清偿；没有 id 的条目无法匹配，本轮过后不再追讨。
          const nowAccepted = acceptedKeys(parsed.output);
          outstanding = outstanding.filter(item => item.id && !nowAccepted.has(`${item.module}:${item.id}`));
          const pending: AgentContractRejection_ACU[] = [...outstanding, ...parsed.rejected];
          outstanding = pending;
          // 总纲尚未建立时，一份没有任何 storyArc 写入的“成功”输出等于什么都没做——模型常把卷台阶写进 summary。
          // 这种空写入不能交回主 Agent 白耗它的派工上限，先在这里索要真正的条目。
          const emptyArcBootstrap = definition.kind === 'arc'
            && !hasActiveStoryArc_ACU(input.resolveContext.moduleSnapshot)
            && !accumulated.delta.storyArc.length
            && !accumulated.delta.storyArcPatches.length
            && !committedWriteObserved;
          if (emptyArcBootstrap && !pending.length && !draft.truncated && input.writeSql) {
            const request = renderArcSqlBootstrap_ACU(input.resolveContext.chat, maxWriteRounds - writeRoundsUsed);
            if (continuationsUsed >= maxContinuations) {
              return deliverContract(accumulated, [{ module: 'storyArc', index: 0, id: '', reason: request }]);
            }
            continuationsUsed += 1;
            transcript.push({ role: 'assistant', content: rawText || '(空输出)' });
            transcript.push({ role: 'user', content: request });
            continue;
          }
          if (emptyArcBootstrap && !pending.length && !draft.truncated) {
            pending.push({ module: 'storyArc', index: 0, id: '', reason: '总纲尚未建立，但 delta.storyArc 为空。summary 里的文字不会写入任何东西：必须在 delta.storyArc 里给出 1 条 scope=story 的 upsert 与按【总纲卷数计划】数量的 scope=volume upsert，每条都带 id / title / direction / escalation / withheld / status 与卷级契约字段' });
          }
          if (!draft.truncated && !pending.length) return deliverContract(accumulated);
          if (continuationsUsed >= maxContinuations) {
            if (pending.length) {
              return deliverContract(accumulated, pending, draft.truncated);
            }
            // 只剩截断：保留已验证条目，但显式返回 partial/failed，不能冒充完整交付。
            return deliverContract(accumulated, [], true);
          }
          continuationsUsed += 1;
          transcript.push({ role: 'assistant', content: rawText || '(空输出)' });
          transcript.push({ role: 'user', content: renderAgentContractContinuationRequest_ACU(accumulated, pending, draft.truncated) });
          continue;
        }
        const payload = parseAgentJsonPayload_ACU(protocolText, nativeCalls.length ? '' : prefill, KIND_PAYLOAD_KEYS_ACU[definition.kind]);
        return {
          agentName: definition.name,
          kind: definition.kind,
          writes,
          arc: null,
          maintainer: null,
          planner: definition.kind === 'plan' ? parseAgentPlannerOutput_ACU(payload) : null,
          reviewer: definition.kind === 'review' ? parseAgentReviewerOutput_ACU(payload) : null,
          researcher: null,
          requirements: null,
          composer: definition.kind === 'compose' ? parseAgentComposerOutput_ACU(payload) : null,
          iterations: attempt,
          usedFieldWrites,
          attempts: attempt,
          expandedReads: [...expandedReads],
          readRevisions,
          usage: usageTotal,
        };
      } catch (error) {
        if (error instanceof ContinuationValidationError_ACU && (error.error.code === 'CONTINUATION_AGENT_SUBAGENT_FAILED' || error.error.code === 'CONTINUATION_INTERNAL_REQUEST_STALE')) throw error;
        lastReason = compactAgentProtocolError_ACU(error);
        protocolRejections += 1;
        if (protocolRejections > retries) {
          throw subagentFailed_ACU(`${definition.name} 连续 ${retries + 1} 次返回不符合契约`, false, {
            agentName: definition.name, lastReason,
            ...(writeAttempted ? { acceptedKeys: [...confirmedFields], unresolvedIssues: [
              ...terminalIssues(), { module: writes[0], source: 'protocol_failed', path: 'contract', message: lastReason },
            ] } : {}),
          });
        }
        // 被拒原文也要留在小循环对话里：模型必须看到自己上一次写了什么才能真正修正。
        transcript.push({ role: 'assistant', content: rawText || '(空输出)' });
        const protocolRepair = input.writeSql && writes.length
          ? `你上一次的输出没有被采纳。原因：${lastReason}\n不要写说明、Markdown 或 delta。${maxWriteRounds - writeRoundsUsed > 0 ? '调用一次 write_sql，把全部语句放进同一个 sql 参数。' : 'write_sql 轮次已用尽，不要再调用函数；如实报告未完成的缺口。'}新行 expected_revision 写 0，补已有行共用回执里的模块修订号。sustaining_threads 与 payoff_targets 写成 '["条目"]'。volume 同时只能有一条 active，其余 planned。`
          : `你上一次的输出没有被采纳。原因：${lastReason}\n请修正后重新输出符合契约的 JSON 对象。`;
        transcript.push({ role: 'user', content: protocolRepair });
      }
    }

    if (writeAttempted) {
      const issues = terminalIssues();
      throw subagentFailed_ACU(`${definition.name} 工具/模型预算耗尽，逐栏维护未完成`, false, {
        agentName: definition.name, acceptedKeys: [...confirmedFields], unresolvedIssues: issues,
        remainingToolRounds: Math.max(0, maxToolRounds - toolRoundsUsed), remainingWriteRounds: Math.max(0, maxWriteRounds - writeRoundsUsed), lastReason,
      });
    }
    throw subagentFailed_ACU(`${definition.name} 在 ${maxCalls} 次调用内没有交付契约输出`, false, { agentName: definition.name, lastReason, toolRoundsUsed });
  }

  /**
   * 运行一次发送前最终审查。它不接受普通 delegation，且固定证据与补充读取共用 finalReview 独立门禁。
   */
  async runFinalReview(input: AgentFinalReviewRunInput_ACU): Promise<AgentFinalReviewRunResult_ACU> {
    const evidence = buildAgentFinalReviewEvidence_ACU(input);
    const gate: SubagentGate_ACU = {
      state: createAgentReadGateState_ACU(),
      config: {
        historyTokenBudget: input.settings.agentHistoryTokenBudget,
        readTokenBudget: input.settings.finalReview.readTokenBudget,
        fallbackTokens: input.settings.agentReadFallbackTokens,
      },
      granted: new Set(),
    };
    const fixedDecision = await gateAgentReadBatch_ACU(evidence.gateItems, gate.state, gate.config, 0);
    if (!fixedDecision.allowed) {
      throw subagentFailed_ACU('终审固定证据超出独立读取预算，终审未执行。', false, {
        reason: fixedDecision.reason,
        report: fixedDecision.report,
        batchTokens: fixedDecision.batchTokens,
      });
    }
    gate.state.grantedTokens += fixedDecision.batchTokens;
    for (const key of evidence.fixedReadKeys) gate.granted.add(key);

    const reviewKept = keptSubagentMaterialTokens_ACU('review', []);
    const reviewSplit = splitDefaultSubagentMaterials_ACU(input.settings.agentPrompts.finalReviewer, 'finalReviewer');
    const reviewSegments = stripUnownedSubagentPrompt_ACU(reviewSplit.segments, reviewKept);
    const reviewResolvers = {
      $USER_INTENT: () => input.resolveContext.originInstruction || '（用户未提供初始要求）',
      $USER_REQUIREMENTS: () => renderAgentUserRequirements_ACU(input.resolveContext.moduleSnapshot, input.resolveContext.originInstruction),
      $OUTLINE_WINDOW: () => renderAgentOutlineWindow_ACU(input.resolveContext),
      $STORY_ARC: () => resolveAgentReadToken_ACU('$STORY_ARC', input.resolveContext).text,
      $CHRONOLOGY: () => resolveAgentReadToken_ACU('$CHRONOLOGY', input.resolveContext).text,
      $STORY_TAIL: () => renderAgentStoryTail_ACU(input.resolveContext),
      $WORLDBOOK_HITS: () => evidence.worldbookEvidence,
      $AGENT_READ_MATERIALS: () => evidence.supplementalMaterials,
      $AGENT_TASK: () => input.candidateInstruction,
    };
    const rendered = await renderContinuationPrompt_ACU(reviewSegments, reviewResolvers, 'agent_delegate');
    const reviewTaskMaterial = reviewSplit.taskTemplate
      ? (await renderContinuationPrompt_ACU([{ role: 'user', content: reviewSplit.taskTemplate }], reviewResolvers, 'agent_delegate')).messages[0].content
      : '';
    const resolveAgentPreset = this.dependencies.resolveAgentApiPreset ?? resolveContinuationAgentApiPreset_ACU;
    const preset = resolveAgentPreset(input.settings, 'finalReviewer', 'agent_delegate');
    const readRevisions: AgentModuleRevisions_ACU = { ...input.resolveContext.moduleSnapshot.revisions };
    const prefill = AGENT_PREFILLS_ACU.reviewer;
    const retries = normalizeContinuationInternalAiRetryLimit_ACU(input.settings.internalAiRetryLimit);
    const maxToolRounds = Math.max(0, input.settings.finalReview.maxExtraReads);
    const readBudget = resolveAgentReadBudget_ACU(gate.config);
    const renderReadBudgetNote = (roundsUsed: number): string => renderSubagentReadBudgetNote_ACU({
      maxReadTokens: readBudget.effectiveMaxReadTokens,
      fallbackTokens: readBudget.effectiveFallbackTokens,
      maxToolRounds,
      toolRoundsUsed: roundsUsed,
      grantedTokens: gate.state.grantedTokens,
    });
    // 终审与普通派工同一预算语义：首轮给出上限，每个工具批次后刷新剩余轮次与遥测；注入点必须在尾部预填充之前。
    const reviewPresent = new Set([...reviewSegments, ...(reviewSplit.taskTemplate ? [{ content: reviewSplit.taskTemplate }] : [])].flatMap(segment => segment.content.match(/\$[A-Z][A-Z0-9_]*/g) ?? [] as string[]));
    const renderReviewTail = async (): Promise<string> => {
      const originalSnapshot = input.mainSnapshot?.trim() ?? '';
      const mainReadsAt = originalSnapshot.indexOf('\n\n【主会话已调阅】');
      const latestSnapshot = [await renderFallbackAgentSnapshot_ACU(input.settings, input.resolveContext), ...(mainReadsAt >= 0 ? [originalSnapshot.slice(mainReadsAt + 2)] : [])].join('\n\n');
      const reviewSnapshot = omitSnapshotSectionsForSubagent_ACU(latestSnapshot, reviewPresent);
      return [reviewSnapshot, reviewTaskMaterial || `【本次终审任务】\n${input.candidateInstruction}`, ...(reviewTaskMaterial ? [] : [evidence.worldbookEvidence, evidence.supplementalMaterials]), input.sharedMaterials ?? ''].filter(Boolean).join('\n\n');
    };
    let baseMessages = rendered.messages;
    if (input.sharedMaterials !== undefined) {
      baseMessages = insertBeforeTrailingPrefill_ACU(baseMessages, { role: 'system', content: '世界书全文和各资料库已在【本轮已备资料】。终审没有调阅工具，直接根据这些资料给出判词。' });
    }
    const transcript: Array<{ role: string; content: string }> = [];
    const trailingPrefill = (baseMessages[baseMessages.length - 1]?.role === 'assistant' || baseMessages[baseMessages.length - 1]?.content === USER_PREFILL_CONTENT_ACU) ? baseMessages.pop() : undefined;
    const expandedReads: string[] = [];
    let toolRoundsUsed = 0;
    let protocolRejections = 0;
    let attempt = 0;
    let lastReason = '';
    let usageTotal: AiUsageMetadata_ACU | null = null;
    const addCompleteCount = (current: number | undefined, incoming: number | undefined): number | undefined => (
      current !== undefined && incoming !== undefined ? current + incoming : undefined
    );
    const callOptions: ContinuationInternalAiCallOptions_ACU = {
      promptCacheEnabled: true,
      cacheScope: 'final-reviewer',
      cacheTools: ['read', 'search', 'review'],
      tools: input.sharedMaterials === undefined ? agentNativeTools_ACU(['read', 'search']) : [],
      minOutputTokens: CONTINUATION_ROLE_OUTPUT_TOKEN_FLOORS_ACU.finalReviewer,
      onUsage: usage => {
        usageTotal = usageTotal
          ? {
            promptTokens: addCompleteCount(usageTotal.promptTokens, usage.promptTokens),
            completionTokens: addCompleteCount(usageTotal.completionTokens, usage.completionTokens),
            cachedTokens: addCompleteCount(usageTotal.cachedTokens, usage.cachedTokens),
            cacheWriteTokens: addCompleteCount(usageTotal.cacheWriteTokens, usage.cacheWriteTokens),
          }
          : { ...usage };
      },
    };
    const maxCalls = 1 + maxToolRounds + retries + 1;
    for (let call = 0; call < maxCalls; call += 1) {
      const identity = input.createIdentity(AGENT_FINAL_REVIEWER_NAME_ACU, attempt);
      attempt += 1;
      if (!input.isCurrent(identity)) {
        throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'agent_delegate', '终审请求已失效', false));
      }
      const reviewTail = await renderReviewTail();
      const raw = await callContinuationInternalAiWithRetry_ACU(
        () => this.dependencies.callInternalAi(withNativeToolThinkPrefill_ACU([...baseMessages, ...transcript, { role: 'user', content: `${reviewTail}\n\n${renderReadBudgetNote(toolRoundsUsed)}` }, ...(trailingPrefill?.content === USER_PREFILL_CONTENT_ACU ? [trailingPrefill] : [])]), preset, identity, input.signal, callOptions),
        {
          transportRetries: retries,
          retryDelaySeconds: input.settings.retryDelaySeconds,
          isCurrent: () => input.isCurrent(identity) && !input.signal?.aborted,
        },
      );
      if (!input.isCurrent(identity)) {
        throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'agent_delegate', '终审结果已失效', false));
      }
      const turn = normalizeAgentModelReply_ACU(raw);
      const nativeCalls = turn.toolCalls;
      const protocolText = typeof raw === 'string' || raw == null ? String(raw ?? '') : turn.content;
      const rawText = protocolText.trim();
      let toolCalls: ReturnType<typeof parseAgentSubagentToolCalls_ACU>;
      try {
        toolCalls = nativeCalls.length
          ? nativeToolArguments_ACU(nativeCalls).map(({ payload }) => parseAgentToolCall_ACU(payload))
          : parseAgentSubagentToolCalls_ACU(protocolText, prefill);
        if (!nativeCalls.length && toolCalls) {
          protocolRejections += 1;
          if (protocolRejections > retries) throw new Error('read/search 必须使用原生函数调用');
          transcript.push(
            { role: 'assistant', content: rawText || '(空输出)' },
            { role: 'user', content: 'read/search 必须使用原生函数调用，不能作为 JSON 文本输出。请改用原生函数后重试。' },
          );
          continue;
        }
      } catch (error) {
        if (!nativeCalls.length) throw error;
        const reason = compactAgentProtocolError_ACU(error);
        transcript.push(...nativeToolExchange_ACU(turn.content, nativeCalls, nativeCalls.map(() => reason)));
        continue;
      }
      if (toolCalls) {
        if (toolRoundsUsed >= maxToolRounds) {
          const exhausted = `read/search 轮次已用尽（上限 ${maxToolRounds} 轮）。请依据已有证据输出终审 JSON；无法证实的内容写为未验证，不许臆测。\n\n${renderReadBudgetNote(toolRoundsUsed)}`;
          transcript.push(...nativeToolExchange_ACU(turn.content, nativeCalls, nativeCalls.map(() => exhausted)));
          continue;
        }
        toolRoundsUsed += 1;
        const perCallResults: string[] = [];
        for (const toolCall of toolCalls) perCallResults.push(await this.executeToolCalls_ACU([toolCall], input.resolveContext, gate, expandedReads, input.sharedMaterials !== undefined ? [] : null));
        transcript.push(...nativeToolExchange_ACU(turn.content, nativeCalls, perCallResults.map(result => `${result}\n\n${renderReadBudgetNote(toolRoundsUsed)}`)));
        continue;
      }
      try {
        const payload = parseAgentJsonPayload_ACU(protocolText, nativeCalls.length ? '' : prefill, ['verdict', 'summary', 'emotionFindings', 'worldFindings', 'logicFindings', 'requiredFixes', 'preserve']);
        return {
          output: parseAgentFinalReviewerOutput_ACU(payload),
          evidence,
          iterations: 1 + toolRoundsUsed,
          attempts: attempt,
          toolRounds: toolRoundsUsed,
          readTokens: gate.state.grantedTokens,
          expandedReads: [...expandedReads],
          readRevisions,
          usage: usageTotal,
        };
      } catch (error) {
        lastReason = compactAgentProtocolError_ACU(error);
        protocolRejections += 1;
        if (protocolRejections > retries) {
          throw subagentFailed_ACU(`最终审查连续 ${retries + 1} 次返回不符合契约`, false, { lastReason });
        }
        transcript.push({ role: 'assistant', content: rawText || '(空输出)' });
        transcript.push({ role: 'user', content: `你上一次的输出没有被采纳。原因：${lastReason}\n请修正后重新输出符合终审契约的 JSON 对象。` });
      }
    }
    throw subagentFailed_ACU(`最终审查在 ${maxCalls} 次调用内没有交付契约输出`, false, { lastReason, toolRoundsUsed });
  }

  /**
   * 执行子代理的一个工具批次并渲染结果文本。
   * 与主循环同一门禁语义：批内去重与已放行地址拆分、整批过门禁、打回报告直接作为结果回灌。
   */
  private async executeToolCalls_ACU(
    calls: ReadonlyArray<AgentToolCall_ACU | AgentWebToolCall_ACU>,
    context: AgentResolveContext_ACU,
    gate: SubagentGate_ACU,
    expandedReads: string[],
    ownReads: readonly string[] | null,
    research?: { settings: ContinuationSettings_ACU; cache: ResearcherPageCache_ACU },
  ): Promise<string> {
    const fresh: SubagentMaterial_ACU[] = [];
    const duplicated: string[] = [];
    const failed: SubagentMaterial_ACU[] = [];
    const refused: string[] = [];
    const seenInBatch = new Set<string>();
    // 出网工具不过读取门禁：它们的成本由页数与字数上限约束，结果直接回灌。
    const webSections: string[] = [];
    for (const call of calls) {
      if (call.kind === 'encyclopedia_search' || call.kind === 'encyclopedia_read' || call.kind === 'web_search' || call.kind === 'web_read') {
        if (!research) {
          webSections.push(`出网工具 ${call.kind} 只有 web-researcher 可用，本次未执行。`);
          continue;
        }
        webSections.push(await this.executeWebToolCall_ACU(call, research.settings, research.cache, expandedReads));
        continue;
      }
      if (call.kind === 'search' && ownReads) {
        refused.push('子代理不能做跨域搜索。请直接使用【本轮已备资料】。');
        continue;
      }
      if (call.kind === 'read') {
        for (const raw of call.reads) {
          const key = String(raw ?? '').trim();
          if (!key || seenInBatch.has(key)) continue;
          seenInBatch.add(key);
          if (ownReads && !readStaysWithOwner_ACU(key, ownReads)) {
            refused.push(`${key} 不在你的维护范围。世界书、正文和其它模块已在【本轮已备资料】，不要再读。`);
            continue;
          }
          if (gate.granted.has(key)) { duplicated.push(key); continue; }
          const material = resolveMaterial_ACU(key, context);
          if (material.status === 'failed') failed.push(material);
          else fresh.push(material);
        }
        continue;
      }
      const key = `search|${call.isRegex ? 're' : 'kw'}|${[...call.scope].sort().join('+')}|${call.maxResults}|${call.query}`;
      if (seenInBatch.has(key)) continue;
      seenInBatch.add(key);
      const label = `search "${call.query}"（域：${call.scope.join('、')}）`;
      if (gate.granted.has(key)) { duplicated.push(label); continue; }
      fresh.push({ key, label, text: `### 搜索「${call.query}」\n${runAgentSearch_ACU(call, context)}` });
    }

    const sections: string[] = [...refused, ...webSections, ...failed.map(material => JSON.stringify({ action: 'read', address: material.key, status: 'failed', reason: material.text }))];
    if (duplicated.length) {
      sections.push(`以下调阅本次派工已放行，完整内容见上文，不再重注：${duplicated.join('、')}。`);
    }
    if (fresh.length) {
      const items: AgentGateItem_ACU[] = fresh.map(material => ({ label: material.label, text: material.text }));
      const decision = await gateAgentReadBatch_ACU(items, gate.state, gate.config, 0);
      if (decision.allowed) {
        gate.state.grantedTokens += decision.batchTokens;
        for (const material of fresh) {
          gate.granted.add(material.key);
          expandedReads.push(material.label);
        }
        sections.push(...fresh.map(material => material.text));
      } else {
        sections.push(decision.report);
      }
    } else if (!duplicated.length && !webSections.length && !failed.length) {
      sections.push('本次工具批次没有任何有效的读取地址或搜索请求。请检查 read 的 reads 数组与 search 的 query。');
    }
    return `【工具结果】\n${sections.join('\n\n')}`;
  }

  /**
   * 执行一个出网工具调用并渲染结果。每个抓到的页面登记进句柄缓存（P1、P2…），
   * 结果文本带句柄，契约里的 pageRef 据此回填。同一 URL 重抓复用旧句柄、不计页数。
   */
  private async executeWebToolCall_ACU(
    call: AgentWebToolCall_ACU,
    settings: ContinuationSettings_ACU,
    cache: ResearcherPageCache_ACU,
    expandedReads: string[],
  ): Promise<string> {
    const client = this.dependencies.webClient ?? (this.dependencies.webClient = new AgentWebClient_ACU());
    const webSettings = settings.webResearch;
    const registerPage = (page: AgentFetchedPage_ACU, query: string): string => {
      const existing = cache.byUrl.get(page.url);
      if (existing) return existing;
      const handle = `P${cache.pages.size + 1}`;
      cache.pages.set(handle, { ...page, query });
      cache.byUrl.set(page.url, handle);
      if (page.status === 'ok') cache.pagesUsed += 1;
      return handle;
    };
    const renderPage = (handle: string, page: AgentFetchedPage_ACU, reused: boolean): string => {
      const head = `### [页面句柄 ${handle}]「${page.title || '（无标题）'}」来源=${page.source === 'web' ? '网页' : AGENT_ENCYCLOPEDIA_SOURCE_LABELS_ACU[page.source]}｜${page.url}`;
      if (page.status !== 'ok') return `${head}\n抓取失败（${page.status}）：${page.note}`;
      if (reused) return `${head}\n（该页面本次派工已抓取过，原文见上文，不再重注）`;
      return `${head}\n${page.text}`;
    };
    const pagesExhausted = (): string | null => (cache.pagesUsed >= webSettings.maxPages
      ? `本次派工的页面配额已用尽（${webSettings.maxPages} 页）。请基于已抓到的页面交付契约 JSON。`
      : null);

    if (call.kind === 'encyclopedia_search') {
      const sources = call.sources.length ? call.sources : enabledEncyclopediaSources_ACU(webSettings);
      if (!sources.length) return `### 百科检索「${call.query}」\n没有可用的百科来源（设置里全部关闭）。请改用 web_search。`;
      const disabled = call.sources.filter(source => !enabledEncyclopediaSources_ACU(webSettings).includes(source));
      const results = await Promise.all(sources.filter(source => !disabled.includes(source)).map(async source => ({ source, ...(await client.searchEncyclopedia(source, call.query)) })));
      expandedReads.push(`encyclopedia_search "${call.query}"`);
      const lines: string[] = [];
      for (const result of results) {
        const label = AGENT_ENCYCLOPEDIA_SOURCE_LABELS_ACU[result.source];
        if (!result.candidates.length) { lines.push(`- ${label}：无候选${result.note ? `（${result.note}）` : ''}`); continue; }
        lines.push(`- ${label}：`);
        for (const candidate of result.candidates) {
          lines.push(`  · 「${candidate.title}」${candidate.snippet ? `：${candidate.snippet.slice(0, 120)}` : ''}｜精读：调用 encyclopedia_read，source=${candidate.source}，title=${candidate.title}`);
        }
      }
      if (disabled.length) lines.push(`- 以下来源在设置里已关闭，未检索：${disabled.map(source => AGENT_ENCYCLOPEDIA_SOURCE_LABELS_ACU[source]).join('、')}`);
      return `### 百科检索「${call.query}」\n${lines.join('\n')}`;
    }
    if (call.kind === 'encyclopedia_read') {
      if (!enabledEncyclopediaSources_ACU(webSettings).includes(call.source)) {
        return `### 百科精读「${call.title}」\n来源 ${AGENT_ENCYCLOPEDIA_SOURCE_LABELS_ACU[call.source]} 在设置里已关闭，未执行。`;
      }
      const exhausted = pagesExhausted();
      if (exhausted) return `### 百科精读「${call.title}」\n${exhausted}`;
      const page = await client.readEncyclopedia(call.source, call.title, webSettings.pageCharLimit);
      const reused = cache.byUrl.has(page.url);
      const handle = registerPage(page, call.title);
      expandedReads.push(`encyclopedia_read ${call.source}:${call.title}`);
      return renderPage(handle, page, reused);
    }
    if (call.kind === 'web_search') {
      const result = await client.webSearch(call.query, webSettings);
      expandedReads.push(`web_search "${call.query}"`);
      if (!result.hits.length) return `### 网页搜索「${call.query}」\n无结果${result.note ? `：${result.note}` : ''}。换更短的关键词、加上作品名，或改用 encyclopedia_search。`;
      const lines = result.hits.map((hit, index) => `${index + 1}. 「${hit.title || '（无标题）'}」${hit.url ? `｜${hit.url}` : ''}${hit.snippet ? `\n   ${hit.snippet.slice(0, 200)}` : ''}${hit.url ? `\n   抓取：调用 web_read，url=${hit.url}` : ''}`);
      return `### 网页搜索「${call.query}」（提供方：${webSettings.searchProvider}）\n${lines.join('\n')}`;
    }
    const exhausted = pagesExhausted();
    if (exhausted) return `### 网页抓取 ${call.url}\n${exhausted}`;
    const page = await client.webRead(call.url, webSettings, this.dependencies.hostOrigin?.());
    const reused = cache.byUrl.has(page.url);
    const handle = registerPage(page, call.url);
    expandedReads.push(`web_read ${call.url}`);
    return renderPage(handle, page, reused);
  }
}
