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
 * 这里只负责「调用 + 解析 + 门禁」，不落盘。写集事务由主循环串行应用，
 * 避免同一波次里多个子代理并发改同一份快照造成互相覆盖。
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
import { findAgentSubagentDefinition_ACU, renderAgentReadCatalog_ACU, renderAgentWebToolCatalog_ACU, type AgentSubagentDefinition_ACU } from './agent-catalog';
import { hasActiveStoryArc_ACU } from './agent-module-store';
import {
  compactAgentProtocolError_ACU,
  mergeAgentMaintainerOutputs_ACU,
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
  type AgentGateItem_ACU,
  type AgentReadGateConfig_ACU,
  type AgentReadGateState_ACU,
} from './agent-read-gate';
import { AGENT_FINAL_REVIEWER_NAME_ACU } from './agent-model';
import type {
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
  AgentWebToolCall_ACU,
  AgentWritableModule_ACU,
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
  /** 有效轮次数：1（首轮）+ 实际用掉的工具轮次。 */
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
  ) => Promise<string | null>;
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
};

/** 各类子代理契约对象的判别键：解析器据此从模型全文中挑出正确的 JSON 对象。 */
const KIND_PAYLOAD_KEYS_ACU: Record<AgentSubagentKind_ACU, readonly string[]> = {
  arc: ['delta', 'summary'],
  maintain: ['delta', 'summary'],
  plan: ['recommendation', 'summary'],
  review: ['verdict'],
  research: ['delta', 'summary'],
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
  const labels: Record<AgentWritableModule_ACU, string> = { hooks: '$HOOKS_LEDGER 伏笔账本', infoGap: '$INFO_GAP 认知与信息差时间线', constraints: '$ACTIVE_CONSTRAINTS 长期约束', storyArc: '$STORY_ARC 故事总纲', chronology: '$CHRONOLOGY 故事年代学账本', webRefs: '$WEB_REFS 百科资料库' };
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

function researcherProtocolError_ACU(message: string): never {
  throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_PROTOCOL_INVALID', 'agent_delegate', message, true));
}

/**
 * 用页面缓存回填 web-researcher 契约里的 pageRef。句柄不存在按协议错误处理并回灌可用句柄清单，
 * 让模型改正而不是让运行时猜；pageRef 指向抓取失败的页面同样拒绝——没有可靠来源就不能入库。
 */
function resolveResearcherDraft_ACU(draft: ReturnType<typeof parseAgentResearcherOutput_ACU>, cache: ResearcherPageCache_ACU): AgentResearcherOutput_ACU {
  const available = [...cache.pages.keys()];
  const items = draft.items.map((item): AgentWebRefResolvedItem_ACU => {
    if (item.action === 'retire') {
      return { action: 'retire', id: item.id, title: '', source: 'web', url: '', query: '', tags: [], brief: '', summary: '', sourceStatus: 'ok', reason: item.reason };
    }
    const key = item.pageRef.trim().toUpperCase();
    const page = cache.pages.get(key);
    if (!page) {
      researcherProtocolError_ACU(`pageRef「${item.pageRef}」不在本次派工的工具结果里。可用句柄：${available.length ? available.join('、') : '（尚未抓取任何页面，先用 encyclopedia_read / web_read 抓取）'}`);
    }
    if (page.status !== 'ok' || !page.text) {
      researcherProtocolError_ACU(`pageRef「${item.pageRef}」对应的页面抓取失败（${page.note || page.status}），不能入库；换来源或换词重抓，或从契约里去掉这一条`);
    }
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
      sourceStatus: page.status,
      reason: '',
    };
  });
  return { summary: draft.summary, expectedRevision: draft.expectedRevision, items };
}

/** 把一个读地址解析成材料条目。text 已带分节标题，可直接拼接注入。 */
function resolveMaterial_ACU(token: string, context: AgentResolveContext_ACU): SubagentMaterial_ACU {
  const resolved = resolveAgentReadToken_ACU(token, context);
  return { key: token, label: token, text: `### ${resolved.title}（${token}）\n${resolved.text}` };
}

/** 子代理运行时。一个实例可服务多次派工，自身不持有任何本轮状态。 */
export class AgentSubagentRuntime_ACU {
  constructor(private readonly dependencies: AgentSubagentRuntimeDependencies_ACU = defaultDependencies_ACU) {}

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
    const rendered = await renderContinuationPrompt_ACU(selectPromptSegments_ACU(input.settings, definition), {
      $AGENT_READ_MATERIALS: () => materials,
      $AGENT_TASK: () => input.delegation.prompt,
      $AGENT_WRITE_SCOPE: () => describeWriteScope_ACU(writes),
      $USER_INTENT: () => input.resolveContext.originInstruction || '（用户未提供初始要求）',
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
    const baseMessages = definition.promptKey === 'arcArchitect'
      ? insertBeforeTrailingPrefill_ACU(rendered.messages, { role: 'user', content: renderStoryArcVolumePlanInstruction_ACU(input.settings) })
      : rendered.messages;
    const retries = normalizeContinuationInternalAiRetryLimit_ACU(input.settings.internalAiRetryLimit);
    // 网页检索天然要多轮「搜 → 读 → 补搜」，工具轮上限独立于普通子代理的 maxExtraReads。
    const maxToolRounds = Math.max(0, isResearch ? webSettings.maxToolRounds : input.budget.maxExtraReads);
    // 小循环的追加消息：子代理自己的输出（assistant）与工具结果/纠正提示（user）。
    const transcript: Array<{ role: string; content: string }> = [];
    /**
     * 待消费的网页正文：只临时附在下一次模型调用里，绝不能写入 transcript。
     * 模型借本次输出里的 notes 将有用事实压进历史后，这块正文即被释放。
     */
    let pendingResearchEvidence = '';
    const expandedReads: string[] = [];
    let toolRoundsUsed = 0;
    let protocolRejections = 0;
    let attempt = 0;
    let lastReason = '';
    // 本次派工的累计用量。只有每次已观测调用都报告某字段时，该字段才具备可求和的完整性。
    let usageTotal: AiUsageMetadata_ACU | null = null;
    const addCompleteCount = (current: number | undefined, incoming: number | undefined): number | undefined => (
      current !== undefined && incoming !== undefined ? current + incoming : undefined
    );
    const callOptions: ContinuationInternalAiCallOptions_ACU = {
      promptCacheEnabled: false,
      // 每个子代理的提示词前缀不同，独立缓存命名空间避免互相挤占路由。
      cacheScope: `sub-${definition.name}`,
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
    // 调用总数上界 = 首轮 + 工具轮 + 协议重试 + 工具轮用尽后的最后通牒轮 + 契约续写/修补轮。到界仍未交付即失败。
    const contractKind = definition.kind === 'arc' || definition.kind === 'maintain';
    const maxContinuations = contractKind ? AGENT_CONTRACT_CONTINUATION_ROUNDS_ACU : 0;
    const maxCalls = 1 + maxToolRounds + retries + 1 + maxContinuations;
    // 契约草稿累积：截断或单条非法时不整份重来，先收下合法条目，再只向模型索要剩余/修正条目。
    let accumulated: AgentMaintainerOutput_ACU | null = null;
    let continuationsUsed = 0;
    // 跨轮未清偿的被拒条目：模型在续写里没有重发修正版就不能算完成，否则条目会被静默丢掉。
    let outstanding: AgentContractRejection_ACU[] = [];
    const acceptedKeys = (output: AgentMaintainerOutput_ACU): Set<string> => new Set([
      ...[...output.delta.hooks, ...output.delta.hookPatches].map(item => `hooks:${item.id}`),
      ...[...output.delta.infoGap, ...output.delta.infoGapPatches].map(item => `infoGap:${item.id}`),
      ...[...output.delta.storyArc, ...output.delta.storyArcPatches].map(item => `storyArc:${item.id}`),
      ...output.delta.chronology.map(item => `chronology:${item.id}`),
    ]);
    const deliverContract = (output: AgentMaintainerOutput_ACU): AgentSubagentRunResult_ACU => ({
      agentName: definition.name,
      kind: definition.kind,
      writes,
      arc: definition.kind === 'arc' ? output : null,
      maintainer: definition.kind === 'maintain' ? output : null,
      planner: null,
      reviewer: null,
      researcher: null,
      iterations: 1 + toolRoundsUsed,
      attempts: attempt,
      expandedReads: [...expandedReads],
      readRevisions,
      usage: usageTotal,
    });

    for (let call = 0; call < maxCalls; call += 1) {
      const identity = input.createIdentity(definition.name, attempt);
      attempt += 1;
      if (!input.isCurrent(identity)) {
        throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'agent_delegate', '子代理请求已失效', false));
      }
      // 传输错误（502/网络抖动）按设置延时重试；协议/契约拒绝仍走小循环内的对话级立即重试。
      const raw = await callContinuationInternalAiWithRetry_ACU(
        () => this.dependencies.callInternalAi(
          pendingResearchEvidence
            ? insertBeforeTrailingPrefill_ACU([...baseMessages, ...transcript], { role: 'user', content: pendingResearchEvidence })
            : [...baseMessages, ...transcript],
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
      const rawText = String(raw ?? '').trim();

      // 工具批次优先于契约解析：输出里出现任意 read/search 对象即视为继续调阅。
      const toolCalls = isResearch ? parseAgentResearcherToolCalls_ACU(raw, prefill) : parseAgentSubagentToolCalls_ACU(raw, prefill);
      if (toolCalls) {
        // 当前输出正是对上一批临时网页正文的归纳机会。只持久保留模型显式给出的短笔记。
        if (isResearch && pendingResearchEvidence) {
          const notes = parseAgentResearcherWorkingNotes_ACU(raw, prefill);
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
        transcript.push({ role: 'assistant', content: rawText || '(空输出)' });
        if (toolRoundsUsed >= maxToolRounds) {
          transcript.push({ role: 'user', content: isResearch
            ? `工具轮次已用尽（上限 ${maxToolRounds} 轮）。请基于已抓到的页面输出契约 JSON；没查到的实体在 summary 里如实列出，不许伪造。`
            : `read/search 轮次已用尽（上限 ${maxToolRounds} 轮）。请基于已有资料输出契约 JSON；确实缺失的信息在结果里标注「信息不足」，不许伪造。` });
          continue;
        }
        toolRoundsUsed += 1;
        const toolResult = await this.executeToolCalls_ACU(toolCalls, input.resolveContext, gate, expandedReads, isResearch ? { settings: input.settings, cache: pageCache } : undefined);
        if (isResearch) {
          pendingResearchEvidence = `【本次临时网页检索结果】\n以下网页正文仅供本次回答归纳。若还要继续调用工具，请把本次保留的事实压缩写入每个工具对象的 notes 字段（字符串或字符串数组，建议每页 1–3 条），系统不会在后续历史中保留网页原文。\n\n${toolResult}`;
        } else {
          transcript.push({ role: 'user', content: toolResult });
        }
        continue;
      }

      try {
        if (isResearch) {
          const payload = parseAgentJsonPayload_ACU(raw, prefill, KIND_PAYLOAD_KEYS_ACU.research);
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
            iterations: 1 + toolRoundsUsed,
            attempts: attempt,
            expandedReads: [...expandedReads],
            readRevisions,
            usage: usageTotal,
          };
        }
        if (contractKind) {
          const draft = parseAgentJsonPayloadDraft_ACU(raw, prefill, KIND_PAYLOAD_KEYS_ACU[definition.kind]);
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
            && !accumulated.delta.storyArcPatches.length;
          if (emptyArcBootstrap && !pending.length && !draft.truncated) {
            pending.push({ module: 'storyArc', index: 0, id: '', reason: '总纲尚未建立，但 delta.storyArc 为空。summary 里的文字不会写入任何东西：必须在 delta.storyArc 里给出 1 条 scope=story 的 upsert 与按【总纲卷数计划】数量的 scope=volume upsert，每条都带 id / title / direction / escalation / withheld / status 与卷级契约字段' });
          }
          if (!draft.truncated && !pending.length) return deliverContract(accumulated);
          if (continuationsUsed >= maxContinuations) {
            if (pending.length) {
              throw subagentFailed_ACU(`${definition.name} 仍有 ${pending.length} 条条目不符合契约（续写/修补 ${continuationsUsed} 轮后）`, false, { agentName: definition.name, lastReason: pending[0].reason, rejected: pending });
            }
            // 只剩截断：已收下的条目本身都完整，接受它们，未写出的部分留给下一轮派工。
            return deliverContract(accumulated);
          }
          continuationsUsed += 1;
          transcript.push({ role: 'assistant', content: rawText || '(空输出)' });
          transcript.push({ role: 'user', content: renderAgentContractContinuationRequest_ACU(accumulated, pending, draft.truncated) });
          continue;
        }
        const payload = parseAgentJsonPayload_ACU(raw, prefill, KIND_PAYLOAD_KEYS_ACU[definition.kind]);
        return {
          agentName: definition.name,
          kind: definition.kind,
          writes,
          arc: null,
          maintainer: null,
          planner: definition.kind === 'plan' ? parseAgentPlannerOutput_ACU(payload) : null,
          reviewer: definition.kind === 'review' ? parseAgentReviewerOutput_ACU(payload) : null,
          researcher: null,
          iterations: 1 + toolRoundsUsed,
          attempts: attempt,
          expandedReads: [...expandedReads],
          readRevisions,
          usage: usageTotal,
        };
      } catch (error) {
        if (error instanceof ContinuationValidationError_ACU && error.error.code === 'CONTINUATION_AGENT_SUBAGENT_FAILED') throw error;
        lastReason = compactAgentProtocolError_ACU(error);
        protocolRejections += 1;
        if (protocolRejections > retries) {
          throw subagentFailed_ACU(`${definition.name} 连续 ${retries + 1} 次返回不符合契约`, false, { agentName: definition.name, lastReason });
        }
        // 被拒原文也要留在小循环对话里：模型必须看到自己上一次写了什么才能真正修正。
        transcript.push({ role: 'assistant', content: rawText || '(空输出)' });
        transcript.push({ role: 'user', content: `你上一次的输出没有被采纳。原因：${lastReason}\n请修正后重新输出符合契约的 JSON 对象。` });
      }
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
    const transcript: Array<{ role: string; content: string }> = [];
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
      promptCacheEnabled: false,
      cacheScope: 'final-reviewer',
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
        () => this.dependencies.callInternalAi([...rendered.messages, ...transcript], preset, identity, input.signal, callOptions),
        {
          transportRetries: retries,
          retryDelaySeconds: input.settings.retryDelaySeconds,
          isCurrent: () => input.isCurrent(identity) && !input.signal?.aborted,
        },
      );
      if (!input.isCurrent(identity)) {
        throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'agent_delegate', '终审结果已失效', false));
      }
      const rawText = String(raw ?? '').trim();
      const toolCalls = parseAgentSubagentToolCalls_ACU(raw, prefill);
      if (toolCalls) {
        transcript.push({ role: 'assistant', content: rawText || '(空输出)' });
        if (toolRoundsUsed >= maxToolRounds) {
          transcript.push({ role: 'user', content: `read/search 轮次已用尽（上限 ${maxToolRounds} 轮）。请依据已有证据输出终审 JSON；无法证实的内容写为未验证，不许臆测。` });
          continue;
        }
        toolRoundsUsed += 1;
        transcript.push({ role: 'user', content: await this.executeToolCalls_ACU(toolCalls, input.resolveContext, gate, expandedReads) });
        continue;
      }
      try {
        const payload = parseAgentJsonPayload_ACU(raw, prefill, ['verdict', 'summary', 'emotionFindings', 'worldFindings', 'logicFindings', 'requiredFixes', 'preserve']);
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
          fresh.push(resolveMaterial_ACU(key, context));
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

    const sections: string[] = [...webSections];
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
    } else if (!duplicated.length && !webSections.length) {
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
