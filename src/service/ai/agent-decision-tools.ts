/**
 * 工具模式下的决策函数与交付函数。
 * 主 Agent 用 open_round / delegate / finalize / block 做决策，子代理用 submit 交付契约。
 * 参数字段与 JSON 模式的契约对象一致，解析仍交给原有领域解析器，不放宽校验。
 */
import type { AiNativeToolCall_ACU, AiNativeToolDefinition_ACU } from './native-tool';

export type AgentDecisionToolName_ACU = 'open_round' | 'delegate' | 'finalize' | 'block';
export const AGENT_DECISION_TOOL_NAMES_ACU: readonly AgentDecisionToolName_ACU[] = ['open_round', 'delegate', 'finalize', 'block'];
export const AGENT_SUBMIT_TOOL_NAME_ACU = 'submit';

const closed_ACU = (properties: Record<string, unknown>, required: readonly string[] = []): Record<string, unknown> => ({
  type: 'object',
  properties,
  required: [...required],
  additionalProperties: false,
});
const text_ACU = (description?: string): Record<string, unknown> => (description ? { type: 'string', description } : { type: 'string' });
const texts_ACU = (description?: string): Record<string, unknown> => ({ type: 'array', items: { type: 'string' }, ...(description ? { description } : {}) });
const freeObject_ACU = (description: string): Record<string, unknown> => ({ type: 'object', description });
const fn_ACU = (name: string, description: string, parameters: Record<string, unknown>): AiNativeToolDefinition_ACU => ({
  type: 'function',
  function: { name, description, parameters },
});

const thought_ACU = text_ACU('可选：一两句说明这次决定的理由。');

/** 续写主 Agent 的决策函数；字段与 parseAgentMainAction_ACU 读取的键一一对应。 */
export function continuationDecisionTools_ACU(names: readonly AgentDecisionToolName_ACU[] = AGENT_DECISION_TOOL_NAMES_ACU): AiNativeToolDefinition_ACU[] {
  const catalog: Record<AgentDecisionToolName_ACU, AiNativeToolDefinition_ACU> = {
    open_round: fn_ACU('open_round', '开启本轮续写规划，进入固定工作流。何时使用：本轮还没有开启，资料已经足够确定本轮焦点时。调用后本次回复结束，等待工作流结果。focus 必填，写本轮要推进的核心；summary 可写当前局面一句话；需要联网补资料时 dispatchWebResearcher 设为 true。', closed_ACU({
      focus: text_ACU('本轮推进焦点，不能为空。'),
      summary: text_ACU(),
      dispatchWebResearcher: { type: 'boolean' },
      thought: thought_ACU,
    }, ['focus'])),
    delegate: fn_ACU('delegate', '把任务派给目录里的子代理。何时使用：需要子代理补资料、维护账本或给出建议时。调用后本次回复结束，等待子代理交付。delegations 至少一项，agentName 必须从子代理目录复制，prompt 写清要它做什么，reads 可附上它需要先读的地址。', closed_ACU({
      delegations: {
        type: 'array',
        minItems: 1,
        items: closed_ACU({ agentName: text_ACU(), prompt: text_ACU(), reads: texts_ACU() }, ['agentName', 'prompt']),
      },
      thought: thought_ACU,
    }, ['delegations'])),
    finalize: fn_ACU('finalize', '结束规划，交付本次续写指令。何时使用：资料与子代理结果已经足够写出续写指令时。调用后规划结束。instruction 必填，是交给正文写作的完整指令；summary 写本轮结论；constraints 可增补或退役长期约束。', closed_ACU({
      instruction: text_ACU('交给正文写作的完整指令，不能为空。'),
      summary: text_ACU(),
      constraints: closed_ACU({ add: texts_ACU('新增的长期约束。'), retire: texts_ACU('要退役的长期约束原文。') }),
      thought: thought_ACU,
    }, ['instruction'])),
    block: fn_ACU('block', '无法继续时停止本次续写。何时使用：关键资料缺失或冲突，无法写出可靠指令时。reason 必填，unresolved 列出未解决的问题。', closed_ACU({
      reason: text_ACU('停止的原因，不能为空。'),
      unresolved: texts_ACU(),
      thought: thought_ACU,
    }, ['reason'])),
  };
  return names.map(name => catalog[name]);
}

/** 续写子代理 submit 的契约种类：与 KIND_PAYLOAD_KEYS_ACU 的 kind 对齐，终审单列。 */
export type ContinuationSubmitContract_ACU = 'arc' | 'maintain' | 'plan' | 'review' | 'research' | 'compose' | 'finalReview';

const SUBMIT_DESCRIPTION_ACU = '交付本次结果；调用后本次任务结束。资料不足时先调用读取类工具，确认无误后再调用 submit。';

function continuationSubmitParameters_ACU(contract: ContinuationSubmitContract_ACU): Record<string, unknown> {
  switch (contract) {
    case 'arc':
    case 'maintain':
    case 'research':
      return closed_ACU({
        summary: text_ACU('本次工作的简短总结。'),
        delta: freeObject_ACU('可选：按你的角色说明给出的结构化补充；写入资料请使用 write_sql。'),
      });
    case 'plan':
      return closed_ACU({
        summary: text_ACU(),
        recommendation: text_ACU('建议正文，不能为空。'),
        mustPreserve: texts_ACU(),
        risks: texts_ACU(),
      }, ['recommendation']);
    case 'review':
      return closed_ACU({
        verdict: { type: 'string', enum: ['pass', 'revise', 'block'] },
        reason: text_ACU(),
        fixes: texts_ACU(),
      }, ['verdict']);
    case 'compose':
      return closed_ACU({
        instruction: text_ACU('完整的续写指令，不能为空。'),
        summary: text_ACU(),
        constraints: closed_ACU({ add: texts_ACU(), retire: texts_ACU() }),
      }, ['instruction']);
    case 'finalReview':
      return closed_ACU({
        verdict: { type: 'string', enum: ['pass', 'revise', 'block'] },
        summary: text_ACU(),
        emotionFindings: texts_ACU(),
        worldFindings: texts_ACU(),
        logicFindings: texts_ACU(),
        requiredFixes: texts_ACU(),
        preserve: texts_ACU(),
      }, ['verdict']);
  }
}

export function continuationSubmitTool_ACU(contract: ContinuationSubmitContract_ACU): AiNativeToolDefinition_ACU {
  return fn_ACU(AGENT_SUBMIT_TOOL_NAME_ACU, SUBMIT_DESCRIPTION_ACU, continuationSubmitParameters_ACU(contract));
}

/** 推演导演的决策函数；字段与 parseWorldSimulationMainAction_ACU 的封闭对象一一对应（不收额外键）。 */
export function worldSimulationDecisionTools_ACU(names: readonly AgentDecisionToolName_ACU[] = AGENT_DECISION_TOOL_NAMES_ACU): AiNativeToolDefinition_ACU[] {
  const catalog: Record<AgentDecisionToolName_ACU, AiNativeToolDefinition_ACU> = {
    open_round: fn_ACU('open_round', '开启本轮世界推演，进入固定工作流。何时使用：本轮还没有开启，已经确定本轮推演焦点时。调用后本次回复结束。summary 写当前局面，focus 写本轮焦点，dispatchChronicler 表示是否派出编年记录；skipModules 可列出本轮无需处理的账本模块。', closed_ACU({
      summary: text_ACU(),
      focus: text_ACU(),
      dispatchChronicler: { type: 'boolean' },
      skipModules: texts_ACU(),
    }, ['summary', 'focus', 'dispatchChronicler'])),
    delegate: fn_ACU('delegate', '把任务派给目录里的推演子代理。调用后本次回复结束，等待交付。delegations 至少一项，agentName 必须从子代理目录复制，instruction 写清任务，reads 可附上它需要先读的地址。', closed_ACU({
      delegations: {
        type: 'array',
        minItems: 1,
        items: closed_ACU({ agentName: text_ACU(), instruction: text_ACU(), reads: texts_ACU() }, ['agentName', 'instruction']),
      },
    }, ['delegations'])),
    finalize: fn_ACU('finalize', '结束本次推演。outcome 取 commit（提交已审定的变更）、no_change（本次无变化）或 blocked（无法推进）；summary 写结论；evidenceRefs 只能填工具回执里颁发过的引用。', closed_ACU({
      outcome: { type: 'string', enum: ['commit', 'no_change', 'blocked'] },
      summary: text_ACU(),
      evidenceRefs: texts_ACU(),
    }, ['outcome', 'summary'])),
    block: fn_ACU('block', '无法继续时停止本次推演。reason 写原因，unresolved 列出未解决的问题（至少一项）。', closed_ACU({
      reason: text_ACU(),
      unresolved: { type: 'array', items: { type: 'string' }, minItems: 1 },
    }, ['reason', 'unresolved'])),
  };
  return names.map(name => catalog[name]);
}

/** 推演 specialist 的交付函数：字段对齐 parseWorldSimulationSpecialistResult_ACU，按 status 决定必填字段。 */
export function worldSimulationSpecialistSubmitTool_ACU(): AiNativeToolDefinition_ACU {
  return fn_ACU(AGENT_SUBMIT_TOOL_NAME_ACU, `${SUBMIT_DESCRIPTION_ACU} status=candidate 时给 agentName、patch、summary、evidenceRefs、uncertainties；no_change 时给 agentName、summary、evidenceRefs、uncertainties；failed 时给 agentName、reasonCode、message；blocked 时给 agentName、unresolved。不要附带其它字段。`, closed_ACU({
    status: { type: 'string', enum: ['candidate', 'no_change', 'failed', 'blocked'] },
    agentName: text_ACU('你自己的子代理名称。'),
    patch: freeObject_ACU('候选账本补丁，结构按你的角色说明。'),
    summary: text_ACU(),
    evidenceRefs: texts_ACU('只能填工具回执里颁发过的引用。'),
    uncertainties: texts_ACU(),
    reasonCode: text_ACU(),
    message: text_ACU(),
    unresolved: texts_ACU(),
  }, ['status', 'agentName']));
}

/** 一次性推演交付：candidate 只确认已由 write_sql 校验的候选，不重新提交写集。 */
export function worldSimulationOneShotSubmitTool_ACU(): AiNativeToolDefinition_ACU {
  return fn_ACU(AGENT_SUBMIT_TOOL_NAME_ACU, '交付本次结果；调用后本次任务结束。candidate 仅确认上次 write_sql 回执中的候选；没有变更用 no_change，无法完成用 failed 或 blocked。单独调用，不与 read 或 write_sql 同回复。', closed_ACU({
    status: { type: 'string', enum: ['candidate', 'no_change', 'failed', 'blocked'] },
    agentName: text_ACU('当前角色名。'),
    summary: text_ACU(),
    evidenceRefs: texts_ACU(),
    uncertainties: texts_ACU(),
    reasonCode: text_ACU(),
    message: text_ACU(),
    unresolved: texts_ACU(),
  }, ['status', 'agentName']));
}

/** 阶段规划交付；action=plan 由调用边界注入，不交给模型填写。 */
export function worldSimulationPlannerSubmitTool_ACU(): AiNativeToolDefinition_ACU {
  return fn_ACU(AGENT_SUBMIT_TOOL_NAME_ACU, '交付本次完整阶段计划；单独调用，调用后本次任务结束。', closed_ACU({
    summary: text_ACU('阶段规划摘要，不能为空。'),
    plan: freeObject_ACU('完整阶段计划，字段遵守当前规划协议。'),
  }, ['summary', 'plan']));
}

/** 推演 reviewer 的交付函数：字段对齐 parseWorldSimulationReviewerResult_ACU。 */
export function worldSimulationReviewerSubmitTool_ACU(): AiNativeToolDefinition_ACU {
  return fn_ACU(AGENT_SUBMIT_TOOL_NAME_ACU, SUBMIT_DESCRIPTION_ACU, closed_ACU({
    verdict: { type: 'string', enum: ['accept', 'revise', 'reject'] },
    summary: text_ACU(),
    findings: {
      type: 'array',
      items: closed_ACU({
        severity: { type: 'string', enum: ['blocking', 'major', 'minor'] },
        reasonCode: text_ACU(),
        path: text_ACU(),
        expected: text_ACU(),
        actual: {},
      }, ['severity', 'reasonCode', 'path', 'expected', 'actual']),
    },
    acceptedCandidateIds: texts_ACU(),
  }, ['verdict', 'summary', 'findings', 'acceptedCandidateIds']));
}

export interface NativeToolEntry_ACU {
  call: AiNativeToolCall_ACU;
  payload: Record<string, unknown>;
}

export interface NativeDecisionSplit_ACU {
  /** 唯一的决策或 submit 调用；payload 已由 nativeToolArguments_ACU 注入 action=函数名。 */
  decision: NativeToolEntry_ACU | null;
  /** 读取、搜索、写入等工具调用。 */
  tools: NativeToolEntry_ACU[];
}

/**
 * 把一次回复里的原生调用拆成「决策」和「工具」两类。
 * 决策函数多于一个，或决策与工具混在同一次回复里，都按协议错误抛出，由调用方回灌。
 * @param entries nativeToolArguments_ACU 的结果
 * @param decisionNames 当前角色允许的决策或交付函数名
 */
export function splitNativeDecisionCalls_ACU(entries: readonly NativeToolEntry_ACU[], decisionNames: readonly string[]): NativeDecisionSplit_ACU {
  const decisions = entries.filter(entry => decisionNames.includes(entry.call.name));
  const tools = entries.filter(entry => !decisionNames.includes(entry.call.name));
  if (decisions.length > 1) throw new Error(`一次回复只能调用一个 ${decisionNames.join(' / ')} 函数，实际调用了 ${decisions.map(entry => entry.call.name).join('、')}`);
  if (decisions.length && tools.length) {
    throw new Error(`${decisions[0].call.name} 不能与 ${tools.map(entry => entry.call.name).join('、')} 在同一次回复里调用；先完成工具调用，拿到结果后再单独调用 ${decisions[0].call.name}`);
  }
  return { decision: decisions[0] ?? null, tools };
}

/** submit 的参数去掉注入的 action 后序列化，交给原契约解析器按 JSON 模式同一路径解析。 */
export function submitPayloadText_ACU(payload: Record<string, unknown>): string {
  const { action: _action, ...rest } = payload;
  return JSON.stringify(rest);
}

/** 不含 action 的 submit 参数对象，供直接接收对象的解析器使用。 */
export function submitPayloadObject_ACU(payload: Record<string, unknown>): Record<string, unknown> {
  const { action: _action, ...rest } = payload;
  return rest;
}
