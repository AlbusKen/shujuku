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
  type ContinuationSettings_ACU,
} from '../model';
import { AGENT_PREFILLS_ACU } from './agent-defaults';
import { agentNativeTools_ACU, nativeToolCallsToProtocolJson_ACU, nativeToolExchange_ACU, normalizeAgentModelReply_ACU, synthesizeProtocolToolCalls_ACU, withNativeToolThinkPrefill_ACU, type AiNativeToolCall_ACU } from '../../ai/native-tool';
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
  parseAgentMaintainerOutputDraft_ACU,
  parseAgentPlannerOutput_ACU,
  parseAgentResearcherOutput_ACU,
  parseAgentResearcherToolCalls_ACU,
  parseAgentResearcherWorkingNotes_ACU,
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
import { buildEmptyAgentWorldbookSnapshot_ACU, renderAgentWorldbookCatalog_ACU, renderAgentWorldbookHits_ACU } from './agent-worldbook-read';
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
  writeSql?: (input: { role: AgentSubagentName_ACU; sql: string; resolvePage: (handle: string) => AgentFieldPage_ACU | null; isCurrent?: () => boolean }) => Promise<AgentModuleFieldReceipt_ACU>;
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
  /** 生产路径使用原生 tool_calls。测试缺省关闭，仍走文本 JSON。 */
  nativeTools?: boolean;
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

function selectPromptSegments_ACU(settings: ContinuationSettings_ACU, definition: AgentSubagentDefinition_ACU): unknown {
  return settings.agentPrompts[definition.promptKey];
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
  if (last && last.role === 'assistant') return [...messages.slice(0, -1), extra, last];
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

/** 把写回执里的失败译成下一条 SQL 该怎么写，避免模型改去输出 delta 或整篇说明。 */
function renderWriteSqlRepair_ACU(receipt: AgentModuleFieldReceipt_ACU): string {
  const lines: string[] = [];
  const fatal = receipt.rejected.find(item => item.path === 'host' || item.path === 'sql');
  if (fatal?.reason.includes('字段数与值数量不一致')) {
    lines.push('这条 SQL 没有解析，任何栏目都没写入。字段个数必须等于值的个数；字符串里的单引号写成两个单引号；一次只写一条语句、一个 id。');
  } else if (fatal?.reason.includes('领域快照')) {
    lines.push('这条 SQL 被整句退回，没有写入。下一次只提交一个 id 的一条语句。');
  }
  for (const item of receipt.rejected) {
    if (item.path === 'host' || item.path === 'sql') continue;
    if (item.reason.includes('必须是非空字符串数组')) lines.push(`${item.path} 要写成单引号包裹的 JSON 数组，例如 '["经营线"]'，不要用竖线或一整句中文。`);
    else if (item.reason.startsWith('revision_conflict')) lines.push(`${item.path} 的 expected_revision 改为 ${/actual=(\d+)/.exec(item.reason)?.[1] ?? '回执 revisions 里该模块的当前值'}。`);
    else if (item.reason === 'not_found') lines.push(`${item.path} 还没有记录，用 INSERT，不要 UPDATE。`);
    else if (item.reason === 'id_exists') lines.push(`${item.path} 已有记录，用 UPDATE，不要再 INSERT。`);
    else if (item.reason.includes('SET 不得指定')) lines.push('UPDATE 的 SET 里不要写 id 或 expected_revision，这两项只放在 WHERE。');
  }
  if ((receipt.partials ?? []).some(item => item.promotionError?.includes('active') || item.promotionError?.includes('sustainingThreads'))) {
    lines.push('同一时刻只能有一条 volume 的 status 为 active，其余用 planned。scope=story 不要带卷级栏目。');
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
  if (receipt.partials === null) lines.push('保存状态不确定。先 read $FIELD:模块:ID 读取权威帧，再决定补写。');
  const repair = renderWriteSqlRepair_ACU(receipt);
  if (repair) lines.push(repair);
  lines.push('请调用 write_sql，只提交上面点名的栏目。分栏记录已经存在时用 UPDATE，WHERE 带 id 和当前 expected_revision；还没有记录时才用 INSERT。不要把尚未入库的新行写成 UPDATE。');
  return lines.join('\n');
}

/** 总纲还没建立时，直接要一条 SQL，不再把模型赶回 delta.storyArc。 */
function renderArcSqlBootstrap_ACU(chat: any[], remainingWriteRounds: number): string {
  const lines = [
    '总纲还不能执行。summary、Markdown、delta 和顶层 storyArc 数组都不会入库。',
    remainingWriteRounds > 0
      ? '请调用 write_sql。sql 只能是一条 INSERT 或 UPDATE，一次一个 id。'
      : 'write_sql 轮次已用尽。不要再调用函数。只输出一个 JSON：{"sql":"一条 INSERT 或 UPDATE"}，一次一个 id。',
  ];
  const folded = readAgentModuleFoldState_ACU(chat);
  if (folded.salvaged || folded.candidates.some(item => !item.valid)) {
    lines.push('资料帧状态不确定。先 read $FIELD:storyArc 读取权威帧，再决定补写。');
    return lines.join('\n');
  }
  const revision = folded.snapshot.revisions.storyArc;
  lines.push(`当前 story_arc 修订号是 ${revision}。expected_revision 必须等于 ${revision}。`);
  const records = Object.entries(folded.fields.records.storyArc ?? {});
  if (!records.length) {
    lines.push('现在没有任何总纲记录。先 INSERT 一条 scope=\'story\' 的全书方向，不要带 narrative_role、target_stage_range、sustaining_threads、payoff_targets。再逐条 INSERT volume：只有第一卷 status=\'active\'，其余 \'planned\'。');
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
    const writes = [...KIND_FIXED_WRITES_ACU[definition.kind]];
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
    const rendered = await renderContinuationPrompt_ACU(selectPromptSegments_ACU(input.settings, definition), {
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
      $WORLDBOOK_CATALOG: () => renderAgentWorldbookCatalog_ACU(input.resolveContext.worldbook ?? buildEmptyAgentWorldbookSnapshot_ACU(false)),
      $WORLDBOOK_HITS: () => renderAgentWorldbookHits_ACU(input.resolveContext.worldbook ?? buildEmptyAgentWorldbookSnapshot_ACU(false), buildAgentWorldbookScanText_ACU(input.resolveContext)),
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
    }, 'agent_delegate');

    const prefill = PROMPT_KEY_PREFILLS_ACU[definition.promptKey];
    // 总纲卷数计划是随设置变化的运行时指令，不进提示词模板；但它必须落在尾部预填充之前——
    // 追加在预填充之后会让对话以一条 user 消息收尾，预填充失效，模型会另起一段回复而不是续写 JSON。
    let baseMessages = definition.promptKey === 'arcArchitect'
      ? insertBeforeTrailingPrefill_ACU(rendered.messages, { role: 'user', content: renderStoryArcVolumePlanInstruction_ACU(input.settings) })
      : rendered.messages;
    // 预算状态同样是运行时信息；首轮先给上限，之后随每个工具批次刷新剩余轮次与遥测。
    baseMessages = insertBeforeTrailingPrefill_ACU(baseMessages, { role: 'user', content: renderReadBudgetNote(0) });
    if (input.writeSql && writes.length) baseMessages = insertBeforeTrailingPrefill_ACU(baseMessages, { role: 'system', content: '调用 write_sql 函数逐栏即时提交，参数 sql 为受限 INSERT/UPDATE/DELETE，一次只写一条语句和一个 id。不要写成 JSON、delta、Markdown 或顶层 storyArc 数组。只写职责模块，用回执中的实际 revision 与 $FIELD:模块:ID[:栏目] 补缺栏；仅 status=committed 的 accepted 已保存；partials/revisions=null 表示恢复状态不确定，先重新读权威帧，不得按旧 revision 补写。最终契约不得重复提交已写栏目。sustaining_threads 与 payoff_targets 写成 \'["条目"]\'，target_stage_range 写成 \'{"min":6,"max":10}\'。volume 同时只能有一条 status 为 active，其余 planned。scope=story 不要写卷级栏目。' });
    const retries = normalizeContinuationInternalAiRetryLimit_ACU(input.settings.internalAiRetryLimit);
    // 小循环的追加消息：子代理自己的输出（assistant）与工具结果。原生工具回执使用 role=tool。
    const transcript: Array<{ role: string; content: string; tool_calls?: NonNullable<ReturnType<typeof nativeToolExchange_ACU>[number]['tool_calls']>; tool_call_id?: string }> = [];
    const trailingPrefill = this.dependencies.nativeTools ? undefined : (baseMessages[baseMessages.length - 1]?.role === 'assistant' ? baseMessages.pop() : undefined);
    /**
     * 待消费的网页正文：只临时附在下一次模型调用里，绝不能写入 transcript。
     * 模型借本次输出里的 notes 将有用事实压进历史后，这块正文即被释放。
     */
    let pendingResearchEvidence = '';
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
    // 本次派工的累计用量。只有每次已观测调用都报告某字段时，该字段才具备可求和的完整性。
    let usageTotal: AiUsageMetadata_ACU | null = null;
    const addCompleteCount = (current: number | undefined, incoming: number | undefined): number | undefined => (
      current !== undefined && incoming !== undefined ? current + incoming : undefined
    );
    const callOptions: ContinuationInternalAiCallOptions_ACU = {
      promptCacheEnabled: true,
      // 每次派工的对话全新；命名空间按角色和可用工具稳定划分，不跟随尝试号。
      cacheScope: `sub-${definition.name}`,
      cacheTools: ['read', 'search', ...(input.writeSql && writes.length ? ['write_sql', ...writes.map(module => `module:${module}`)] : [])],
      ...(this.dependencies.nativeTools ? { tools: agentNativeTools_ACU(input.writeSql && writes.length ? ['read', 'search', 'write_sql'] : ['read', 'search']) } : {}),
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
      const raw = await callContinuationInternalAiWithRetry_ACU(
        () => this.dependencies.callInternalAi(
          this.dependencies.nativeTools
            ? withNativeToolThinkPrefill_ACU([...baseMessages, ...transcript, ...(pendingResearchEvidence ? [{ role: 'user', content: pendingResearchEvidence }] : [])])
            : [...baseMessages, ...transcript, ...(pendingResearchEvidence ? [{ role: 'user', content: pendingResearchEvidence }] : []),
              ...(trailingPrefill ? [trailingPrefill] : [])],
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
      const nativeCalls: AiNativeToolCall_ACU[] = this.dependencies.nativeTools ? turn.toolCalls : [];
      let protocolText = typeof raw === 'string' || raw == null ? String(raw ?? '') : turn.content;
      if (nativeCalls.length) {
        try { protocolText = nativeToolCallsToProtocolJson_ACU(nativeCalls); }
        catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          transcript.push(...nativeToolExchange_ACU(turn.content, nativeCalls, nativeCalls.map(() => reason)));
          continue;
        }
      }
      const rawText = protocolText.trim();
      const parseRaw = protocolText;

      // 普通可写角色独享即时写端口；主 Agent、终审和只读角色仍只解析 read/search。
      let toolCalls: ReturnType<typeof parseAgentWritableToolCalls_ACU>;
      try {
        toolCalls = input.writeSql && writes.length
          ? parseAgentWritableToolCalls_ACU(parseRaw, nativeCalls.length ? '' : prefill, isResearch)
          : isResearch ? parseAgentResearcherToolCalls_ACU(parseRaw, nativeCalls.length ? '' : prefill) : parseAgentSubagentToolCalls_ACU(parseRaw, nativeCalls.length ? '' : prefill);
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
        else transcript.push({ role: 'assistant', content: rawText || '(空输出)' }, { role: 'user', content: reason });
        continue;
      }
      if (toolCalls) {
        // 当前输出正是对上一批临时网页正文的归纳机会。只持久保留模型显式给出的短笔记。
        if (isResearch && pendingResearchEvidence) {
          const notes = parseAgentResearcherWorkingNotes_ACU(protocolText, nativeCalls.length ? '' : prefill);
          if (notes.length) {
            transcript.push({
              role: 'user',
              content: `【已归纳的网页检索笔记】\n${notes.map((note, index) => `${index + 1}. ${note}`).join('\n')}\n以上是此前网页的压缩笔记；原网页正文已释放，不能再凭记忆补细节。`,
            });
          } else {
            transcript.push({
              role: 'user',
              content: '你刚读过的网页正文已经释放，但你没有写 notes。后续只能基于已保留的资料与新页面工作；若该网页的事实仍重要，请重新抓取并在下一次工具动作里用 notes 写下精炼要点。',
            });
          }
          pendingResearchEvidence = '';
        }
        const readsAllowed = toolRoundsUsed < maxToolRounds;
        if (!readsAllowed && toolCalls.every(item => item.kind !== 'write_sql')) {
          const exhausted = isResearch
            ? `工具轮次已用尽（上限 ${maxToolRounds} 轮）。请基于已抓到的页面输出契约 JSON；没查到的实体在 summary 里如实列出，不许伪造。\n\n${renderReadBudgetNote(toolRoundsUsed)}`
            : `read/search 轮次已用尽（上限 ${maxToolRounds} 轮）。请基于已有资料输出契约 JSON；确实缺失的信息在结果里标注「信息不足」，不许伪造。\n\n${renderReadBudgetNote(toolRoundsUsed)}`;
          const boundCalls = nativeCalls.length ? nativeCalls : synthesizeProtocolToolCalls_ACU(toolCalls);
          if (boundCalls.length) transcript.push(...nativeToolExchange_ACU(turn.content || rawText, boundCalls, boundCalls.map(() => exhausted)));
          else transcript.push({ role: 'assistant', content: rawText || '(空输出)' }, { role: 'user', content: exhausted });
          continue;
        }
        if (readsAllowed && toolCalls.some(item => item.kind !== 'write_sql')) toolRoundsUsed += 1;
        const toolResultSections: string[] = [];
        const temporaryWebSections: string[] = [];
        for (const call of toolCalls) {
          if (call.kind === 'write_sql') {
            if (writeRoundsUsed >= maxWriteRounds) {
              toolResultSections.push(JSON.stringify({ action: 'write_sql', status: 'rejected', accepted: [], reason: 'write_sql 轮次已用尽',
                remainingToolRounds: maxToolRounds - toolRoundsUsed, remainingWriteRounds: 0 }));
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
                usedFieldWrites = true;
                input.resolveContext.moduleSnapshot = readAgentModuleSnapshot_ACU(input.resolveContext.chat);
                for (const key of gate.granted) if (key.startsWith('$FIELD:') || key.startsWith('$HOOKS_LEDGER') || key.startsWith('$INFO_GAP') || key.startsWith('$CHRONOLOGY') || key.startsWith('$STORY_ARC') || key.startsWith('$WEB_REFS')) gate.granted.delete(key);
              }
              const repair = renderWriteSqlRepair_ACU(receipt);
              const receiptText = JSON.stringify({ action: 'write_sql', ...receipt,
                readAddresses: [...new Set([
                  ...receipt.accepted.map(item => `$FIELD:${item.module}:${item.id}:${item.field}`),
                  ...(receipt.partials ?? []).map(item => `$FIELD:${item.module}:${item.id}`),
                  ...rejectedFieldReadAddresses_ACU(receipt),
                ])],
                remainingToolRounds: maxToolRounds - toolRoundsUsed, remainingWriteRounds: maxWriteRounds - writeRoundsUsed });
              toolResultSections.push(repair ? `${receiptText}\n${repair}` : receiptText);
            } catch (error) {
              if (error instanceof ContinuationValidationError_ACU && error.error.code === 'CONTINUATION_INTERNAL_REQUEST_STALE') throw error;
              writeStateUnknown = true;
              writeProblems.set('host', { module: writes[0], source: 'invoke_failed', path: 'host', message: compactAgentProtocolError_ACU(error) });
              toolResultSections.push(JSON.stringify({ action: 'write_sql', status: 'rejected', accepted: [],
                rejected: [{ path: 'host', reason: compactAgentProtocolError_ACU(error) }], partials: null, revisions: null,
                readAddresses: [], reason: compactAgentProtocolError_ACU(error),
                remainingToolRounds: maxToolRounds - toolRoundsUsed, remainingWriteRounds: maxWriteRounds - writeRoundsUsed }));
            }
          } else {
            if (!readsAllowed) {
              toolResultSections.push(JSON.stringify({ action: call.kind, status: 'rejected', reason: 'read/search 轮次已用尽',
                remainingToolRounds: 0, remainingWriteRounds: maxWriteRounds - writeRoundsUsed }));
              continue;
            }
            const result = await this.executeToolCalls_ACU([call], input.resolveContext, gate, expandedReads,
              isResearch ? { settings: input.settings, cache: pageCache } : undefined);
            if (['encyclopedia_search', 'encyclopedia_read', 'web_search', 'web_read'].includes(call.kind)) temporaryWebSections.push(result);
            else toolResultSections.push(result);
          }
        }
        if (maxWriteRounds) toolResultSections.push(`write_sql 轮次剩余 ${maxWriteRounds - writeRoundsUsed} / ${maxWriteRounds}。`);
        const roundNote = maxWriteRounds ? `write_sql 轮次剩余 ${maxWriteRounds - writeRoundsUsed} / ${maxWriteRounds}。` : '';
        const stableResult = toolResultSections.join('\n\n');
        const boundCalls = nativeCalls.length ? nativeCalls : synthesizeProtocolToolCalls_ACU(toolCalls);
        if (boundCalls.length) {
          const note = renderReadBudgetNote(toolRoundsUsed);
          const results = boundCalls.map((_, index) => [toolResultSections[index] || stableResult || temporaryWebSections.join('\n\n') || '工具没有返回内容', roundNote, note].filter(Boolean).join('\n\n'));
          transcript.push(...nativeToolExchange_ACU(turn.content || rawText, boundCalls, results));
        } else {
          transcript.push({ role: 'assistant', content: rawText || '(空输出)' });
          if (stableResult || !temporaryWebSections.length) transcript.push({ role: 'user', content: `${stableResult}\n\n${renderReadBudgetNote(toolRoundsUsed)}` });
        }
        if (temporaryWebSections.length) {
          pendingResearchEvidence = `【本次临时网页检索结果】\n以下网页正文仅供本次回答归纳。若还要继续调用工具，请把本次保留的事实压缩写入每个工具对象的 notes 字段（字符串或字符串数组，建议每页 1–3 条），系统不会在后续历史中保留网页原文。\n\n${temporaryWebSections.join('\n\n')}\n\n${renderReadBudgetNote(toolRoundsUsed)}`;
        }
        continue;
      }

      const commitContractSql = async (sql: string): Promise<AgentModuleFieldReceipt_ACU> => {
        if (!input.writeSql) throw new Error('没有逐栏写入端口');
        if (!input.isCurrent(identity) || input.signal?.aborted) {
          throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'agent_delegate', '写入请求已失效', false));
        }
        writeAttempted = true;
        const receipt = await input.writeSql({
          role: definition.name, sql,
          isCurrent: () => input.isCurrent(identity) && !input.signal?.aborted,
          resolvePage: handle => {
            const page = pageCache.pages.get(handle.trim().toUpperCase());
            return page?.status === 'ok' && page.text ? { title: page.title, source: page.source, url: page.url, query: page.query, sourceStatus: page.status } : null;
          },
        });
        if (!input.isCurrent(identity) || input.signal?.aborted) {
          throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'agent_delegate', '写入回执已失效', false));
        }
        recordWriteReceipt(receipt);
        if (receipt.status === 'committed') {
          usedFieldWrites = true;
          input.resolveContext.moduleSnapshot = readAgentModuleSnapshot_ACU(input.resolveContext.chat);
          for (const key of gate.granted) if (key.startsWith('$FIELD:') || key.startsWith('$HOOKS_LEDGER') || key.startsWith('$INFO_GAP') || key.startsWith('$CHRONOLOGY') || key.startsWith('$STORY_ARC') || key.startsWith('$WEB_REFS')) gate.granted.delete(key);
        }
        return receipt;
      };
      const continueIncompleteFieldWrite = (receipt: AgentModuleFieldReceipt_ACU): boolean => {
        const follow = renderIncompleteFieldWrite_ACU(receipt);
        if (!follow || continuationsUsed >= maxContinuations) return false;
        continuationsUsed += 1;
        transcript.push({ role: 'assistant', content: rawText || '(空输出)' });
        transcript.push({ role: 'user', content: follow });
        return true;
      };

      try {
        if (isResearch) {
          const payload = parseAgentJsonPayload_ACU(protocolText, nativeCalls.length ? '' : prefill, KIND_PAYLOAD_KEYS_ACU.research);
          if (input.writeSql && writes.length && typeof payload.sql === 'string' && payload.sql.trim()) {
            const receipt = await commitContractSql(payload.sql);
            if (continueIncompleteFieldWrite(receipt)) continue;
            return {
              agentName: definition.name, kind: definition.kind, writes, arc: null, maintainer: null, planner: null, reviewer: null,
              researcher: null, requirements: null, iterations: attempt, usedFieldWrites, attempts: attempt, expandedReads: [...expandedReads], readRevisions, usage: usageTotal,
            };
          }
          const draft = parseAgentResearcherOutput_ACU(payload);
          if (payload.sql !== undefined && draft.expectedRevision !== undefined && draft.expectedRevision !== readRevisions.webRefs) {
            throw new Error(`web_refs SQL expected_revision 与派工读集 revision 不一致：声明 ${draft.expectedRevision}，读集 ${readRevisions.webRefs}`);
          }
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
          if (input.writeSql && writes.length && typeof draft.payload.sql === 'string' && draft.payload.sql.trim()) {
            const receipt = await commitContractSql(draft.payload.sql);
            if (continueIncompleteFieldWrite(receipt)) continue;
            const output = blankMaintainerOutput_ACU(typeof draft.payload.summary === 'string' ? draft.payload.summary : '');
            output.delta.constraintProposals = receipt.constraintProposals ?? [];
            const follow = renderIncompleteFieldWrite_ACU(receipt);
            return deliverContract(output, follow ? [{ module: writes[0] as AgentContractRejection_ACU['module'], index: 0, id: '', reason: follow }] : []);
          }
          const parsed = parseAgentMaintainerOutputDraft_ACU(draft.payload);
          if (draft.payload.sql !== undefined) {
            for (const [module, revision] of Object.entries(parsed.output.delta.expectedRevisions)) {
              const readRevision = readRevisions[module as keyof AgentModuleRevisions_ACU];
              if (revision !== readRevision) {
                throw new Error(`${module} SQL expected_revision 与派工读集 revision 不一致：声明 ${revision}，读集 ${readRevision}`);
              }
            }
          }
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
            && !accumulated.delta.storyArcPatches.length;
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
          ? `你上一次的输出没有被采纳。原因：${lastReason}\n不要写说明、Markdown 或 delta。${maxWriteRounds - writeRoundsUsed > 0 ? '调用 write_sql，sql 是一条 INSERT 或 UPDATE。' : 'write_sql 轮次已用尽，不要再调用函数，只输出 {"sql":"一条 INSERT 或 UPDATE"}。'}一次一个 id。sustaining_threads 与 payoff_targets 写成 '["条目"]'。volume 同时只能有一条 active，其余 planned。`
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

    const rendered = await renderContinuationPrompt_ACU(input.settings.agentPrompts.finalReviewer, {
      $USER_INTENT: () => input.resolveContext.originInstruction || '（用户未提供初始要求）',
      $USER_REQUIREMENTS: () => renderAgentUserRequirements_ACU(input.resolveContext.moduleSnapshot, input.resolveContext.originInstruction),
      $OUTLINE_WINDOW: () => renderAgentOutlineWindow_ACU(input.resolveContext),
      $STORY_ARC: () => resolveAgentReadToken_ACU('$STORY_ARC', input.resolveContext).text,
      $CHRONOLOGY: () => resolveAgentReadToken_ACU('$CHRONOLOGY', input.resolveContext).text,
      $STORY_TAIL: () => renderAgentStoryTail_ACU(input.resolveContext),
      $WORLDBOOK_HITS: () => evidence.worldbookEvidence,
      $AGENT_READ_MATERIALS: () => evidence.supplementalMaterials,
      $AGENT_TASK: () => input.candidateInstruction,
    }, 'agent_delegate');
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
    const baseMessages = insertBeforeTrailingPrefill_ACU(rendered.messages, { role: 'user', content: renderReadBudgetNote(0) });
    const transcript: Array<{ role: string; content: string }> = [];
    const trailingPrefill = this.dependencies.nativeTools ? undefined : (baseMessages[baseMessages.length - 1]?.role === 'assistant' ? baseMessages.pop() : undefined);
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
      ...(this.dependencies.nativeTools ? { tools: agentNativeTools_ACU(['read', 'search']) } : {}),
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
      const raw = await callContinuationInternalAiWithRetry_ACU(
        () => this.dependencies.callInternalAi(this.dependencies.nativeTools
          ? withNativeToolThinkPrefill_ACU([...baseMessages, ...transcript])
          : [...baseMessages, ...transcript, ...(trailingPrefill ? [trailingPrefill] : [])], preset, identity, input.signal, callOptions),
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
      const nativeCalls = this.dependencies.nativeTools ? turn.toolCalls : [];
      let protocolText = typeof raw === 'string' || raw == null ? String(raw ?? '') : turn.content;
      if (nativeCalls.length) {
        try { protocolText = nativeToolCallsToProtocolJson_ACU(nativeCalls); }
        catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          transcript.push(...nativeToolExchange_ACU(turn.content, nativeCalls, nativeCalls.map(() => reason)));
          continue;
        }
      }
      const rawText = protocolText.trim();
      const toolCalls = parseAgentSubagentToolCalls_ACU(protocolText, nativeCalls.length ? '' : prefill);
      if (toolCalls) {
        if (!nativeCalls.length) transcript.push({ role: 'assistant', content: rawText || '(空输出)' });
        if (toolRoundsUsed >= maxToolRounds) {
          const exhausted = `read/search 轮次已用尽（上限 ${maxToolRounds} 轮）。请依据已有证据输出终审 JSON；无法证实的内容写为未验证，不许臆测。\n\n${renderReadBudgetNote(toolRoundsUsed)}`;
          if (nativeCalls.length) transcript.push(...nativeToolExchange_ACU(turn.content, nativeCalls, nativeCalls.map(() => exhausted)));
          else transcript.push({ role: 'user', content: exhausted });
          continue;
        }
        toolRoundsUsed += 1;
        const toolResult = await this.executeToolCalls_ACU(toolCalls, input.resolveContext, gate, expandedReads);
        if (nativeCalls.length) transcript.push(...nativeToolExchange_ACU(turn.content, nativeCalls, nativeCalls.map(() => `${toolResult}\n\n${renderReadBudgetNote(toolRoundsUsed)}`)));
        else transcript.push({ role: 'user', content: `${toolResult}\n\n${renderReadBudgetNote(toolRoundsUsed)}` });
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
    research?: { settings: ContinuationSettings_ACU; cache: ResearcherPageCache_ACU },
  ): Promise<string> {
    const fresh: SubagentMaterial_ACU[] = [];
    const duplicated: string[] = [];
    const failed: SubagentMaterial_ACU[] = [];
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
      if (call.kind === 'read') {
        for (const raw of call.reads) {
          const key = String(raw ?? '').trim();
          if (!key || seenInBatch.has(key)) continue;
          seenInBatch.add(key);
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

    const sections: string[] = [...webSections, ...failed.map(material => JSON.stringify({ action: 'read', address: material.key, status: 'failed', reason: material.text }))];
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
          lines.push(`  · 「${candidate.title}」${candidate.snippet ? `：${candidate.snippet.slice(0, 120)}` : ''}｜精读：{"action":"encyclopedia_read","source":"${candidate.source}","title":"${candidate.title.replace(/"/g, '\\"')}"}`);
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
      const lines = result.hits.map((hit, index) => `${index + 1}. 「${hit.title || '（无标题）'}」${hit.url ? `｜${hit.url}` : ''}${hit.snippet ? `\n   ${hit.snippet.slice(0, 200)}` : ''}${hit.url ? `\n   抓取：{"action":"web_read","url":"${hit.url}"}` : ''}`);
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
