import type { AgentToolMode_ACU } from '../../ai/agent-tool-mode';
import type { WorldSimulationPromptSegment_ACU } from '../model';
import { findWorldSimulationAgentDefinition_ACU, type WorldSimulationAgentName_ACU } from './agent-catalog';
import { buildDefaultWorldSimulationAgentPrompts_ACU, buildV20WorldSimulationAgentPrompt_ACU, type WorldSimulationAgentPrompts_ACU } from './agent-defaults';

const JSON_SWAPS_ACU: ReadonlyArray<readonly [string, string]> = [
  ['read 与 search 使用函数调用，不要写成 JSON。决策只输出一个主动作 JSON：open_round、delegate、finalize 或 block。', '仅输出一个主动作 JSON：read、search、open_round、delegate、finalize 或 block。'],
  ['调用 read 时参数 reads 必须是非空地址数组；调用 search 时参数 query 必填，可选 scope、maxResults、isRegex。不要把 read 或 search 写成 JSON。', 'read 对象包含 action、reads，reads 是非空地址数组；search 对象包含 action、query，可选 scope、maxResults、isRegex。'],
  ['调阅示例：调用 read 函数，参数 {"reads":["ledger:current","summary:current"]}。', '调阅示例：{"action":"read","reads":["ledger:current","summary:current"]}。'],
  ['可先调用 write_sql 函数即时提交职责模块，参数 sql 为受限 DML，可选 evidenceRefs 为已颁发引用。', '可先输出 {"action":"write_sql","sql":"受限 DML","evidenceRefs":["已颁发引用"]} 即时提交职责模块。'],
  ['调用 write_sql 函数提交缺栏', '输出 write_sql 动作对象提交缺栏'],
  ['通过调用 read 函数按地址调阅详细信息', '通过 read 动作对象按地址调阅详细信息'],
  ['推理写在已开始的思维链里，</think> 之后再调用函数或输出 JSON。不要把推理写进 JSON，不要输出 Markdown 围栏或 <WORLD_SIMULATION_ENGINE_SEAM:...> 标签。', '只输出协议 JSON，不附加 Markdown、解释或思考标签。'],
  ['推理写在思维链里，闭合后再输出协议 JSON，不附加 Markdown 或解释。', '不附加 Markdown、解释或思考标签。'],
  ['推理写在思维链里。闭合后不附加 Markdown、解释或其他字段。', '不附加 Markdown、解释、思考标签或其他字段。'],
];

function swap_ACU(text: string, pairs: ReadonlyArray<readonly [string, string]>): string {
  for (const [from, to] of pairs) text = text.split(from).join(to);
  return text;
}

/** 仅供内置正文与动态协议守卫使用；用户正文必须先逐段精确识别。 */
export function worldSimulationProtocolForMode_ACU(name: WorldSimulationAgentName_ACU, content: string, mode: AgentToolMode_ACU): string {
  let next = swap_ACU(content, JSON_SWAPS_ACU).replace(
    /现在只执行当前任务。[^\n。]*使用函数调用；(?:决策输出|最终交付)必须是协议要求的单个 JSON 对象，不附加 Markdown。/g,
    '现在只执行当前任务。输出必须是协议要求的单个 JSON 对象，不附加 Markdown。',
  );
  // 一次性角色的冻结默认使用裸状态行；派生呈现必须与独立交付契约一致。
  if (['undercurrent-analyst', 'dramatis-keeper', 'guidance-composer'].includes(name)) {
    next = swap_ACU(next, [
      ['回复 NO_CHANGE', mode === 'tools' ? '单独调用 submit 交付 no_change，填写 summary、evidenceRefs、uncertainties' : '输出完整 no_change 交付 JSON，填写 status、agentName、summary、evidenceRefs、uncertainties'],
      ['回复 FAILED: 原因', mode === 'tools' ? '单独调用 submit 交付 failed，填写 reasonCode、message' : '输出完整 failed 交付 JSON，填写 status、agentName、reasonCode、message'],
      ['回复 FAILED', mode === 'tools' ? '调用 submit 交付 failed' : '输出 failed 交付 JSON'],
      ['调用原生 write_sql', mode === 'tools' ? '调用 write_sql' : '输出 {"action":"write_sql","sql":"全部受限 SQL"}'],
      ['同一次原生 write_sql 的 sql 参数', mode === 'tools' ? '同一次 write_sql 的 sql 参数' : '同一个 write_sql 动作对象的 sql 字段'],
      ['write_sql 函数的 sql 参数', mode === 'tools' ? 'write_sql 的 sql 参数' : 'write_sql 动作对象的 sql 字段'],
    ]);
    if (content.includes('原生 write_sql')) {
      next += mode === 'tools'
        ? '\nwrite_sql 仅生成候选；收到校验回执后，下一回复单独调用 submit 确认 candidate，填写 agentName、summary、evidenceRefs、uncertainties，不带 sql 或 patch。'
        : '\nwrite_sql 仅生成候选；收到校验回执后，下一回复单独输出 candidate 交付 JSON，填写 status、agentName、summary、evidenceRefs、uncertainties，不带 sql 或 patch。';
    }
  }
  if (mode === 'json') return next;
  if (findWorldSimulationAgentDefinition_ACU(name)?.kind === 'planner') {
    return swap_ACU(next, [
      ['只输出一个 JSON 对象', '单独调用 submit 交付完整阶段计划'],
      ['闭合后再输出一个 JSON 对象', '闭合后单独调用 submit 交付完整阶段计划'],
      ['输出必须是协议要求的单个 JSON 对象', '交付必须单独调用 submit'],
      ['顶层必须且只能包含 action、summary、plan；action 只能是 plan，', 'submit 参数必须且只能包含 summary、plan；'],
      ['顶层必须且只能包含 action、summary、plan；action 必须精确为 plan，', 'submit 参数必须且只能包含 summary、plan；'],
      ['严格遵循此结构示例：', '调用 submit，参数遵循此结构示例：'],
    ]).replace(/"action":"plan",/g, '');
  }
  const director = name === 'world-director';
  next = swap_ACU(next, [
    ['仅输出一个主动作 JSON：read、search、open_round、delegate、finalize 或 block。', '调阅调用 read / search；决策单独调用 open_round / delegate / finalize / block 中的一个。调阅与决策不能在同一回复调用。'],
    ['read 对象包含 action、reads，reads 是非空地址数组；search 对象包含 action、query，可选 scope、maxResults、isRegex。', 'read 参数 reads 是非空地址数组；search 参数 query 必填，可选 scope、maxResults、isRegex。'],
    ['只输出一个 specialist JSON 对象', '单独调用 submit 交付 specialist 结果'],
    ['只输出一个审核 JSON 对象', '单独调用 submit 交付审核结果'],
    ['输出必须是协议要求的单个 JSON 对象', director ? '决策必须单独调用 open_round / delegate / finalize / block 中的一个' : '交付必须单独调用 submit'],
    ['只输出协议 JSON，不附加 Markdown、解释或思考标签。', '推理闭合后再调用函数，不在正文交付，不附加 Markdown。'],
    ['顶层必须且只能包含', 'submit 参数必须且只能包含'],
    ['finalize 顶层只能包含 action、outcome、summary、evidenceRefs', 'finalize 参数只能包含 outcome、summary、evidenceRefs'],
    ['open_round 必须包含 action、summary、focus、dispatchChronicler', 'open_round 参数必须包含 summary、focus、dispatchChronicler'],
    ['delegate 只能包含 action、delegations', 'delegate 参数只能包含 delegations'],
    ['block 只能包含 action、reason、unresolved', 'block 参数只能包含 reason、unresolved'],
    ['evidenceRefs 只允许出现在 finalize 顶层', 'evidenceRefs 只允许出现在 finalize 参数'],
    ['通过 read 动作对象按地址调阅详细信息', '通过调用 read 按地址调阅详细信息'],
    ['通过 read 工具按地址调阅详细信息', '通过调用 read 按地址调阅详细信息'],
    ['输出 write_sql 动作对象提交缺栏', '调用 write_sql 提交缺栏'],
    ['输出 open_round', '调用 open_round'],
    ['输出 block', '调用 block'],
    ['输出 failed 或 blocked', '调用 submit 交付 failed 或 blocked'],
    ['输出 no_change', '调用 submit 交付 no_change'],
    ['输出 candidate', '调用 submit 交付 candidate'],
  ]);
  // 示例是函数参数，不再让模型把 action 字段作为正文动作提交。
  next = next.replace(/\{"action":"(read|search|write_sql|open_round|delegate|finalize|block)",/g, '调用 $1，参数 {');
  next = next.replace(/(示例：)(\{"(?:status|verdict)":)/g, '$1调用 submit，参数 $2');
  return next;
}

type ModeDefaults_ACU = Record<'mixed' | AgentToolMode_ACU, WorldSimulationAgentPrompts_ACU>;
let defaults_ACU: ModeDefaults_ACU | undefined;

function modeDefaults_ACU(): ModeDefaults_ACU {
  if (!defaults_ACU) {
    const mixed = buildDefaultWorldSimulationAgentPrompts_ACU();
    const build = (mode: AgentToolMode_ACU): WorldSimulationAgentPrompts_ACU => {
      const result = { ...mixed };
      for (const name of Object.keys(mixed) as Array<keyof WorldSimulationAgentPrompts_ACU>) {
        result[name] = mixed[name].map(segment => ({ ...segment,
          content: worldSimulationProtocolForMode_ACU(name, segment.content, mode) }));
      }
      return result;
    };
    defaults_ACU = { mixed, json: build('json'), tools: build('tools') };
  }
  return defaults_ACU;
}

export function buildWorldSimulationAgentPromptsForMode_ACU(mode: AgentToolMode_ACU): WorldSimulationAgentPrompts_ACU {
  const source = modeDefaults_ACU()[mode];
  const result = { ...source };
  for (const name of Object.keys(source) as Array<keyof WorldSimulationAgentPrompts_ACU>) {
    result[name] = source[name].map(segment => ({ ...segment }));
  }
  return result;
}

/** 默认正文可重排，段元数据与用户改写原样保留；旧逐栏恢复用其冻结 V20 基线。 */
export function adaptWorldSimulationPromptSegmentsToToolMode_ACU(
  name: WorldSimulationAgentName_ACU, segments: readonly WorldSimulationPromptSegment_ACU[], mode: AgentToolMode_ACU,
): WorldSimulationPromptSegment_ACU[] {
  const defaults = modeDefaults_ACU();
  const sources = [defaults.mixed[name], defaults.json[name], defaults.tools[name]].filter(Boolean);
  const legacy = buildV20WorldSimulationAgentPrompt_ACU(name);
  return segments.map(segment => {
    for (const source of sources) {
      const index = source.findIndex(item => item.role === segment.role && item.content === segment.content);
      if (index >= 0) return { ...segment, content: defaults[mode][name][index].content };
    }
    if (legacy.some(item => item.role === segment.role && item.content === segment.content)) {
      return { ...segment, content: worldSimulationProtocolForMode_ACU(name, segment.content, mode) };
    }
    return { ...segment };
  });
}

export function adaptWorldSimulationAgentPromptsToToolMode_ACU(prompts: WorldSimulationAgentPrompts_ACU, mode: AgentToolMode_ACU): WorldSimulationAgentPrompts_ACU {
  const result = { ...prompts };
  for (const name of Object.keys(prompts) as Array<keyof WorldSimulationAgentPrompts_ACU>) {
    result[name] = adaptWorldSimulationPromptSegmentsToToolMode_ACU(name, prompts[name], mode);
  }
  return result;
}
