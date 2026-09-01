/**
 * service/continuation/outline-tags.ts — 大纲标签协议
 *
 * 模型不再输出严格 JSON：阶段/节点/轮次内容用标签包裹，标签外的散文、思路、
 * Markdown 围栏一律忽略。id、suggestedTurns、totalTurns、schemaVersion 等
 * 结构字段全部由运行时生成推导，模型只负责创作内容。
 *
 * 标签契约（与 defaults.ts 的默认大纲提示词一一对应）：
 * <stage_title>…</stage_title> <stage_goal>…</stage_goal> <stage_tempo>mixed</stage_tempo>
 * <stage_role>development</stage_role> <stage_time_span>数日</stage_time_span>
 * <node><node_title>…</node_title><node_goal>…</node_goal>
 * <turn pacing="setup" function="daily_bond" mainline="hold" time="days" anchor="入城后的第七天">…</turn></node>
 */

import {
  CONTINUATION_SCHEMA_VERSION_ACU,
  ContinuationValidationError_ACU,
  createContinuationError_ACU,
  type StageNode_ACU,
  type StageOutline_ACU,
  type StageRole_ACU,
  type StageTempo_ACU,
  type StageTurnFunction_ACU,
  type StageTurnMainlineDelta_ACU,
  type StageTurnPacing_ACU,
  type StageTurnTimeAdvance_ACU,
} from './model';

export interface ParsedOutlineTagTurn_ACU {
  goal: string;
  pacing: string | null;
  function: string | null;
  mainlineDelta: string | null;
  timeAdvance: string | null;
  timeAnchor: string | null;
}

export interface ParsedOutlineTagNode_ACU {
  title: string;
  goal: string;
  turns: ParsedOutlineTagTurn_ACU[];
}

export interface ParsedOutlineTags_ACU {
  title: string;
  goal: string;
  /** 枚举标签保留模型原文；合法性只由严格 schema 校验器裁决。 */
  tempo: string | null;
  role: string | null;
  timeSpanGoal: string | null;
  nodes: ParsedOutlineTagNode_ACU[];
}

function failParse_ACU(message: string): never {
  throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_OUTLINE_JSON_INVALID', 'outline_parse', message, true));
}

function readTag_ACU(text: string, tag: string): string {
  const match = text.match(new RegExp(`<${tag}\\s*>([\\s\\S]*?)</${tag}\\s*>`, 'i'));
  return match ? match[1].trim() : '';
}

interface TagEntry_ACU {
  attributes: string;
  value: string;
}

/**
 * 提取同名标签的全部条目，连同开标签上的属性段。
 *
 * 属性段写成 `(\\s[^>]*)?` 而不是 `[^>]*`：后者会让 `<node…>` 直接吃掉 `<node_title>`，
 * 把节点标题当成节点块。要求属性前必须有空白，标签名与后续字符才不会粘连。
 */
function readTagEntries_ACU(text: string, tag: string): TagEntry_ACU[] {
  const pattern = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}\\s*>`, 'gi');
  const entries: TagEntry_ACU[] = [];
  for (const match of text.matchAll(pattern)) {
    const value = match[2].trim();
    if (value) entries.push({ attributes: match[1] ?? '', value });
  }
  return entries;
}

function readTagList_ACU(text: string, tag: string): string[] {
  return readTagEntries_ACU(text, tag).map(entry => entry.value);
}

function readTagAttribute_ACU(attributes: string, name: string): string {
  const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*["']?([^"'\\s>]+)`, 'i'));
  return match ? match[1].trim() : '';
}

function readOptionalAttribute_ACU(attributes: string, name: string, lowerCase = true): string | null {
  const raw = readTagAttribute_ACU(attributes, name);
  if (!raw) return null;
  return lowerCase ? raw.toLowerCase() : raw;
}

function readOptionalTag_ACU(text: string, tag: string, lowerCase = true): string | null {
  const raw = readTag_ACU(text, tag);
  if (!raw) return null;
  return lowerCase ? raw.toLowerCase() : raw;
}

/**
 * 从模型返回原文中宽容提取大纲标签结构。标签外内容（思路、围栏、JSON）全部忽略。
 * @param raw 模型返回的原始文本
 * @returns 阶段标题/目标与节点列表（节点含标题/目标与逐轮目标文本）
 */
export function parseOutlineTags_ACU(raw: string | null | undefined): ParsedOutlineTags_ACU {
  const text = typeof raw === 'string' ? raw : '';
  if (!text.trim()) failParse_ACU('大纲返回为空');
  const nodeBlocks = readTagList_ACU(text, 'node');
  if (!nodeBlocks.length) {
    failParse_ACU(`返回内容不包含任何 <node> 标签。模型返回片段：${text.trim().slice(0, 300)}`);
  }
  const nodes = nodeBlocks.map((block, index) => {
    const turns = readTagEntries_ACU(block, 'turn').map(entry => ({
      goal: entry.value,
      pacing: readOptionalAttribute_ACU(entry.attributes, 'pacing'),
      function: readOptionalAttribute_ACU(entry.attributes, 'function'),
      mainlineDelta: readOptionalAttribute_ACU(entry.attributes, 'mainline'),
      timeAdvance: readOptionalAttribute_ACU(entry.attributes, 'time'),
      timeAnchor: readOptionalAttribute_ACU(entry.attributes, 'anchor', false),
    }));
    if (!turns.length) failParse_ACU(`第 ${index + 1} 个 <node> 中没有任何非空 <turn> 标签`);
    return { title: readTag_ACU(block, 'node_title'), goal: readTag_ACU(block, 'node_goal'), turns };
  });
  return {
    title: readTag_ACU(text, 'stage_title'),
    goal: readTag_ACU(text, 'stage_goal'),
    tempo: readOptionalTag_ACU(text, 'stage_tempo'),
    role: readOptionalTag_ACU(text, 'stage_role'),
    timeSpanGoal: readOptionalTag_ACU(text, 'stage_time_span', false),
    nodes,
  };
}

/**
 * 把标签解析结果构建为标准阶段大纲。全部结构字段在这里生成推导：
 * node/turn id 由 allocateId 分配，suggestedTurns=节点轮数，totalTurns=轮数总和。
 * @param parsed 标签解析结果
 * @param allocateId ID 分配器（与 edit_outline 插入轮次共用同一惯例）
 * @param fallback 重规划时沿用旧大纲的阶段标题、目标、形态与结构角色
 * @returns 未校验的 StageOutline 载体；缺失/非法枚举会原样进入严格 schema 校验
 */
export function buildStageOutlineFromTags_ACU(
  parsed: ParsedOutlineTags_ACU,
  allocateId: (prefix: string) => string,
  fallback?: { title?: string; goal?: string; tempo?: StageTempo_ACU; role?: StageRole_ACU; timeSpanGoal?: string },
): StageOutline_ACU {
  const nodes: StageNode_ACU[] = parsed.nodes.map((node, index) => ({
    id: allocateId('node'),
    title: node.title || `节点${index + 1}`,
    goal: node.goal,
    suggestedTurns: node.turns.length,
    turns: node.turns.map(turn => ({
      id: allocateId('turn'),
      goal: turn.goal,
      ...(turn.pacing !== null ? { pacing: turn.pacing as StageTurnPacing_ACU } : {}),
      ...(turn.function !== null ? { function: turn.function as StageTurnFunction_ACU } : {}),
      ...(turn.mainlineDelta !== null ? { mainlineDelta: turn.mainlineDelta as StageTurnMainlineDelta_ACU } : {}),
      ...(turn.timeAdvance !== null ? { timeAdvance: turn.timeAdvance as StageTurnTimeAdvance_ACU } : {}),
      ...(turn.timeAnchor !== null ? { timeAnchor: turn.timeAnchor } : {}),
    } as StageNode_ACU['turns'][number])),
  }));
  const tempo = parsed.tempo ?? fallback?.tempo;
  const role = parsed.role ?? fallback?.role;
  return {
    schemaVersion: CONTINUATION_SCHEMA_VERSION_ACU,
    title: parsed.title || fallback?.title || '',
    goal: parsed.goal || fallback?.goal || '',
    ...(tempo !== undefined ? { tempo: tempo as StageTempo_ACU } : {}),
    ...(role !== undefined ? { role: role as StageRole_ACU } : {}),
    ...(parsed.timeSpanGoal !== null || fallback?.timeSpanGoal !== undefined
      ? { timeSpanGoal: parsed.timeSpanGoal ?? fallback?.timeSpanGoal }
      : {}),
    totalTurns: nodes.reduce((sum, node) => sum + node.suggestedTurns, 0),
    nodes,
  } as StageOutline_ACU;
}

/**
 * 重规划拼接：截取旧大纲的已完成前缀（保留原 node/turn id 与节点归属，
 * 截断处节点重算 suggestedTurns），其后拼接模型规划的剩余节点。
 * @param previous 旧 revision 的完整大纲
 * @param completedTurns 已完成轮数
 * @param planned 模型只含剩余轮次的新大纲（已由 buildStageOutlineFromTags_ACU 构建）
 * @returns 前缀逐字保留、剩余部分替换后的完整大纲
 */
export function spliceOutlineWithCompletedPrefix_ACU(previous: StageOutline_ACU, completedTurns: number, planned: StageOutline_ACU): StageOutline_ACU {
  if (completedTurns <= 0) return planned;
  let remaining = completedTurns;
  const prefixNodes: StageNode_ACU[] = [];
  for (const node of previous.nodes) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, node.turns.length);
    remaining -= take;
    if (take > 0) {
      prefixNodes.push({ ...node, suggestedTurns: take, turns: node.turns.slice(0, take).map(turn => ({ ...turn })) });
    }
  }
  const nodes = [...prefixNodes, ...planned.nodes];
  return {
    schemaVersion: CONTINUATION_SCHEMA_VERSION_ACU,
    title: planned.title || previous.title,
    goal: planned.goal || previous.goal,
    role: planned.role ?? previous.role,
    timeSpanGoal: planned.timeSpanGoal ?? previous.timeSpanGoal,
    tempo: planned.tempo,
    totalTurns: nodes.reduce((sum, node) => sum + node.suggestedTurns, 0),
    nodes,
  };
}
