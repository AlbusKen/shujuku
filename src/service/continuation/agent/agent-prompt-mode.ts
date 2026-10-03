import type { AgentToolMode_ACU } from '../../ai/agent-tool-mode';
import type { ContinuationAgentPrompts_ACU, ContinuationPromptSegment_ACU } from '../model';
import { buildDefaultContinuationAgentPrompts_ACU } from './agent-defaults';

// 只加工内置默认正文；持久化和历史版本构造器保持不变。
const JSON_SWAPS_ACU: ReadonlyArray<readonly [string, string]> = [
  ['先调用 read 或 search 函数补充调阅：read 的参数 reads 是地址数组，search 的参数 query 必填、scope 是范围数组，一次可以并行调用多个函数', '先输出工具批次补充调阅——{"action":"read","reads":["地址"]} 或 {"action":"search","query":"关键词","scope":["story","worldbook"]}，一次输出可含多个工具对象'],
  ['调用 write_sql 函数，参数 sql 为受限 DML，不要写成 JSON', '用 {"action":"write_sql","sql":"受限 DML"}'],
  ['资料不足时我先调阅：本地 read/search 用函数调用，出网工具仍输出 JSON 对象，两者不要放在同一次输出', '资料不足时我先输出工具批次（可混用本地 read/search 与出网工具，一次多个对象）'],
  ['能一次批量取的资料就在同一次回复里并发调用多个 read/search 函数', '能一次批量取的资料就在同一次输出里发多个 read/search 对象'],
  ['read、search、write_sql 使用函数调用；决策动作以完整的协议 JSON 对象表达。JSON 之外最多留少量思路梳理，绝不把决策内容散落在 JSON 外面。', '我的每个动作都以完整的协议 JSON 对象表达；JSON 之外最多留少量思路梳理，绝不把动作内容散落在 JSON 外面。'],
  ['调用 write_sql 函数即时提交', '用 write_sql 即时提交'],
  ['调阅资料时调用 read 或 search 函数；决策时本轮以一个完整的 JSON 对象收尾。', '本轮我的动作以一个完整的 JSON 对象收尾。'],
  ['read 与 search 使用函数调用，不要写成 JSON。决策动作用 JSON 对象表达', '你的每个动作用 JSON 对象表达'],
  ['"action":"open_round|delegate|finalize|block"', '"action":"read|search|open_round|delegate|finalize|block"'],
  ['但决策动作本身必须完整出现在 JSON 对象里。', '但动作本身必须完整出现在 JSON 对象里。'],
  ['调用 read 函数补读：参数 reads 是地址数组', '输出 {"action":"read","reads":["地址"]} 补读：reads 是地址数组'],
];

function swap_ACU(text: string, pairs: ReadonlyArray<readonly [string, string]>): string {
  for (const [from, to] of pairs) text = text.split(from).join(to);
  return text;
}

const JSON_READ_PROTOCOL_ACU = '【工具动作：read / search，可并发】\nread 对象包含 action="read" 与非空 reads 地址数组。search 对象包含 action="search"、query，可选 scope、isRegex、maxResults；scope 是 ["story","tables","modules","outline","worldbook"] 的子集。命中行带有可复制进 read 的地址。\n需要补读时把全部对象放在同一次回复；每次运行只有一个成功读取批次，读完立即决策。工具对象不能与决策对象混在同一次回复。工具结果回来后再决定下一步。';
const TOOL_MAIN_PROTOCOL_ACU = '【工具协议规范】\n所有动作通过当前声明的函数完成，不用正文表达动作。调阅调用 read / search；决策只调用 open_round / delegate / finalize / block 中的一个。函数参数遵守对应字段约束。\n\n【调阅工具】\nread 的 reads 是非空地址数组；search 的 query 必填，可选 scope、isRegex、maxResults。需要补读时在同一次回复并发调用；每次运行只有一个成功读取批次，读完立即决策。调阅不能与决策函数在同一次回复调用。\n';

/** 在冻结的当前默认之上派生呈现文本，不参与存储版本迁移。 */
function jsonContent_ACU(content: string, role?: keyof ContinuationAgentPrompts_ACU): string {
  let next = swap_ACU(content, JSON_SWAPS_ACU);
  next = next.replace(/【工具：read \/ search，使用函数调用，可并发】[\s\S]*?工具结果回来后再决定下一步。/, () => JSON_READ_PROTOCOL_ACU);
  if (role === 'arcArchitect' || role === 'maintainer' || role === 'webResearcher') {
    // 只派生完整命中的默认段；旧默认写集示例移到独立动作，交付只保留摘要。
    const sql = next.match(/,"sql":("(?:\\.|[^"\\])*")/);
    if (sql) {
      next = `写入时单独输出 {"action":"write_sql","sql":${sql[1]}}；收到回执后再单独输出最终交付，写入与交付不得同回复。\n${next.replace(sql[0], '')}`;
    }
    next = next
      .split('只在 sql 字段用受限原生 SQL INSERT/UPDATE/DELETE 表达资料写集').join('只在 write_sql 动作的 sql 字段用受限 SQL INSERT/UPDATE/DELETE 表达资料写集')
      .split('资料写集只能放 sql').join('资料写集只能放 write_sql 动作的 sql 字段')
      .split('未用最终 sql 追加写集时，交 summary 即可').join('写入完成后单独交付 summary，不在最终交付里追加 sql');
  }
  return next;
}

function toolContent_ACU(role: keyof ContinuationAgentPrompts_ACU, content: string): string {
  let next = jsonContent_ACU(content);
  if (role === 'main' && next.startsWith('【文本协议规范】')) {
    const decisionAt = next.indexOf('【决策动作：');
    next = TOOL_MAIN_PROTOCOL_ACU + (decisionAt >= 0 ? next.slice(decisionAt) : '');
    next = next.replace(/action = (delegate|open_round|finalize|block)：/g, '调用 $1：')
      .split('附加字段').join('参数')
      .split('dispatchArcArchitect、').join('');
  }
  next = swap_ACU(next, [
    ['你的每一次输出都必须由符合协议的 JSON 对象构成（工具批次可以是多个对象）', '你的每一次动作都必须通过声明的函数完成（调阅可并发，决策只能调用一个函数）'],
    ['我的每个动作都以完整的协议 JSON 对象表达；JSON 之外最多留少量思路梳理，绝不把动作内容散落在 JSON 外面。', '我的每个动作都通过函数完成；决策只调用 open_round / delegate / finalize / block 中的一个，不把动作散落在正文里。'],
    ['每个动作都是一个完整的 JSON 对象，JSON 之外最多留一点思路梳理，动作本身绝不散落在对象外面。', '每个动作都通过声明的函数完成，决策只调用 open_round / delegate / finalize / block 中的一个，动作本身绝不散落在正文里。'],
    ['本轮我的动作以一个完整的 JSON 对象收尾。', '本轮以一次 open_round / delegate / finalize / block 决策调用收尾。'],
    ['能一次批量取的资料就在同一次输出里发多个 read/search 对象', '能一次批量取的资料就在同一次回复里并发调用 read/search'],
    ['我把多个工具对象写进同一次输出', '我在同一次回复并发调用调阅函数'],
    ['工具对象不与决策动作混在同一次输出', '调阅函数不与决策函数混在同一次回复'],
    ['先输出工具批次补充调阅——{"action":"read","reads":["地址"]} 或 {"action":"search","query":"关键词","scope":["story","worldbook"]}，一次输出可含多个工具对象', '先调用 read / search 补充调阅；reads 使用授权地址，search 的 query 必填，scope 使用授权范围，可并发调阅'],
    ['用 {"action":"write_sql","sql":"受限 DML"}', '调用 write_sql，参数 sql 为受限 DML'],
    ['用 write_sql 即时提交', '调用 write_sql 即时提交'],
    ['输出 {"action":"read","reads":["地址"]} 补读：reads 是地址数组', '调用 read 补读：reads 是地址数组'],
    ['资料不足时我先输出工具批次（可混用本地 read/search 与出网工具，一次多个对象）', '资料不足时我先并发调用已授权的本地或出网工具'],
    ['工具对象必须附 notes', '工具参数必须附 notes'],
    ['每个工具对象里带 notes', '每次工具调用的参数里带 notes'],
    ['输出 open_round', '调用 open_round'],
  ]);
  if (role !== 'main') {
    next = swap_ACU(next, [
      ['我的最终交付是一个 JSON 对象：', '我的最终交付调用 submit，参数为：'],
      ['输出必须是一个 JSON 对象：', '交付必须调用 submit，参数为：'],
      ['输出必须是一个 JSON 对象，字段为', '交付必须调用 submit，参数字段为'],
      ['按系统规则逐项输出 JSON：', '按系统规则逐项填写 submit 参数：'],
      ['契约 JSON 之外我不输出任何文字。', '交付单独调用 submit，不在正文交付，不与调阅或写入同回复调用。'],
      ['再交最终 JSON；JSON 之外不输出解释。', '再单独调用 submit 交付，不输出解释。'],
      ['请输出契约 JSON', '请调用 submit 交付'],
      ['输出契约 JSON', '调用 submit 交付'],
      ['交付契约 JSON', '调用 submit 交付'],
      ['交契约 JSON', '调用 submit 交付'],
      ['最终交契约时', '最终调用 submit 时'],
      ['契约 JSON', 'submit 参数'],
    ]);
    // 维护类的写入只走 write_sql；submit 与文本契约共用只读交付字段。
    if (role === 'arcArchitect' || role === 'maintainer' || role === 'webResearcher') {
      next = next.replace(/,"sql":"(?:\\.|[^"\\])*"/g, '')
        .split('只在 sql 字段用受限原生 SQL INSERT/UPDATE/DELETE 表达资料写集').join('只在 write_sql 的 sql 参数用受限 SQL INSERT/UPDATE/DELETE 表达资料写集')
        .split('资料写集只能放 sql').join('资料写集只能交给 write_sql 的 sql 参数')
        .split('未用最终 sql 追加写集时，交 summary 即可').join('写入完成后单独调用 submit 交付 summary，不在交付参数里追加 sql');
    }
  }
  return next;
}

type PromptRole_ACU = keyof ContinuationAgentPrompts_ACU;
let defaults_ACU: { mixed: ContinuationAgentPrompts_ACU; legacyJson: ContinuationAgentPrompts_ACU; json: ContinuationAgentPrompts_ACU; tools: ContinuationAgentPrompts_ACU } | undefined;

function modeDefaults_ACU(): NonNullable<typeof defaults_ACU> {
  if (!defaults_ACU) {
    const mixed = buildDefaultContinuationAgentPrompts_ACU();
    const build = (mode: AgentToolMode_ACU, legacy = false): ContinuationAgentPrompts_ACU => {
      const result = { ...mixed };
      for (const role of Object.keys(mixed) as PromptRole_ACU[]) {
        result[role] = mixed[role].map(segment => ({
          ...segment, content: mode === 'json' ? jsonContent_ACU(segment.content, legacy ? undefined : role) : toolContent_ACU(role, segment.content),
        }));
      }
      return result;
    };
    defaults_ACU = { mixed, legacyJson: build('json', true), json: build('json'), tools: build('tools') };
  }
  return defaults_ACU;
}

export function buildContinuationAgentPromptsForMode_ACU(mode: AgentToolMode_ACU): ContinuationAgentPrompts_ACU {
  const source = modeDefaults_ACU()[mode];
  const result = { ...source };
  for (const role of Object.keys(source) as PromptRole_ACU[]) {
    result[role] = source[role].map(segment => ({ ...segment }));
  }
  return result;
}

/** 角色、消息身份和完整正文均命中时才映射；支持重排，保留段元数据与自定义正文。 */
export function adaptContinuationPromptSegmentsToToolMode_ACU(
  role: PromptRole_ACU, segments: readonly ContinuationPromptSegment_ACU[], mode: AgentToolMode_ACU,
): ContinuationPromptSegment_ACU[] {
  const defaults = modeDefaults_ACU();
  return segments.map(segment => {
    for (const source of [defaults.mixed[role], defaults.legacyJson[role], defaults.json[role], defaults.tools[role]]) {
      const index = source.findIndex(item => item.role === segment.role && item.content.length === segment.content.length && item.content === segment.content);
      if (index >= 0) return { ...segment, content: defaults[mode][role][index].content };
    }
    return { ...segment };
  });
}

export function adaptContinuationAgentPromptsToToolMode_ACU(prompts: ContinuationAgentPrompts_ACU, mode: AgentToolMode_ACU): ContinuationAgentPrompts_ACU {
  const result = { ...prompts };
  for (const role of Object.keys(prompts) as PromptRole_ACU[]) {
    result[role] = adaptContinuationPromptSegmentsToToolMode_ACU(role, prompts[role], mode);
  }
  return result;
}
