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
import { findAgentSubagentDefinition_ACU, renderAgentReadCatalog_ACU, type AgentSubagentDefinition_ACU } from './agent-catalog';
import { hasActiveStoryArc_ACU } from './agent-module-store';
import {
  compactAgentProtocolError_ACU,
  mergeAgentMaintainerOutputs_ACU,
  parseAgentFinalReviewerOutput_ACU,
  parseAgentJsonPayload_ACU,
  parseAgentJsonPayloadDraft_ACU,
  parseAgentMaintainerOutputDraft_ACU,
  parseAgentPlannerOutput_ACU,
  parseAgentReviewerOutput_ACU,
  parseAgentSubagentToolCalls_ACU,
  renderAgentContractContinuationRequest_ACU,
  type AgentContractRejection_ACU,
} from './agent-protocol';
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
  AgentReviewerOutput_ACU,
  AgentRunBudget_ACU,
  AgentSubagentKind_ACU,
  AgentToolCall_ACU,
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
}

const defaultDependencies_ACU: AgentSubagentRuntimeDependencies_ACU = {
  callInternalAi: callContinuationInternalAi_ACU,
  resolveApiPreset: resolveContinuationApiPreset_ACU,
  resolveAgentApiPreset: resolveContinuationAgentApiPreset_ACU,
};

const PROMPT_KEY_PREFILLS_ACU: Record<AgentSubagentDefinition_ACU['promptKey'], string> = {
  arcArchitect: AGENT_PREFILLS_ACU.arc,
  maintainer: AGENT_PREFILLS_ACU.maintainer,
  mainlinePlanner: AGENT_PREFILLS_ACU.planner,
  beatPlanner: AGENT_PREFILLS_ACU.planner,
  reviewer: AGENT_PREFILLS_ACU.reviewer,
};

/** 各类子代理契约对象的判别键：解析器据此从模型全文中挑出正确的 JSON 对象。 */
const KIND_PAYLOAD_KEYS_ACU: Record<AgentSubagentKind_ACU, readonly string[]> = {
  arc: ['delta', 'summary'],
  maintain: ['delta', 'summary'],
  plan: ['recommendation', 'summary'],
  review: ['verdict'],
};

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
  const labels: Record<AgentWritableModule_ACU, string> = { hooks: '$HOOKS_LEDGER 伏笔账本', infoGap: '$INFO_GAP 认知与信息差时间线', constraints: '$ACTIVE_CONSTRAINTS 长期约束', storyArc: '$STORY_ARC 故事总纲', chronology: '$CHRONOLOGY 故事年代学账本' };
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
    }, 'agent_delegate');

    const prefill = PROMPT_KEY_PREFILLS_ACU[definition.promptKey];
    // 总纲卷数计划是随设置变化的运行时指令，不进提示词模板；但它必须落在尾部预填充之前——
    // 追加在预填充之后会让对话以一条 user 消息收尾，预填充失效，模型会另起一段回复而不是续写 JSON。
    const baseMessages = definition.promptKey === 'arcArchitect'
      ? insertBeforeTrailingPrefill_ACU(rendered.messages, { role: 'user', content: renderStoryArcVolumePlanInstruction_ACU(input.settings) })
      : rendered.messages;
    const retries = normalizeContinuationInternalAiRetryLimit_ACU(input.settings.internalAiRetryLimit);
    const maxToolRounds = Math.max(0, input.budget.maxExtraReads);
    // 小循环的追加消息：子代理自己的输出（assistant）与工具结果/纠正提示（user）。
    const transcript: Array<{ role: string; content: string }> = [];
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
        () => this.dependencies.callInternalAi([...baseMessages, ...transcript], input.preset, identity, input.signal, callOptions),
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
      const toolCalls = parseAgentSubagentToolCalls_ACU(raw, prefill);
      if (toolCalls) {
        transcript.push({ role: 'assistant', content: rawText || '(空输出)' });
        if (toolRoundsUsed >= maxToolRounds) {
          transcript.push({ role: 'user', content: `read/search 轮次已用尽（上限 ${maxToolRounds} 轮）。请基于已有资料输出契约 JSON；确实缺失的信息在结果里标注「信息不足」，不许伪造。` });
          continue;
        }
        toolRoundsUsed += 1;
        transcript.push({ role: 'user', content: await this.executeToolCalls_ACU(toolCalls, input.resolveContext, gate, expandedReads) });
        continue;
      }

      try {
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
    calls: readonly AgentToolCall_ACU[],
    context: AgentResolveContext_ACU,
    gate: SubagentGate_ACU,
    expandedReads: string[],
  ): Promise<string> {
    const fresh: SubagentMaterial_ACU[] = [];
    const duplicated: string[] = [];
    const seenInBatch = new Set<string>();
    for (const call of calls) {
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

    const sections: string[] = [];
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
    } else if (!duplicated.length) {
      sections.push('本次工具批次没有任何有效的读取地址或搜索请求。请检查 read 的 reads 数组与 search 的 query。');
    }
    return `【工具结果】\n${sections.join('\n\n')}`;
  }
}
