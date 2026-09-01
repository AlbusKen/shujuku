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
 *
 * 解析层对形态宽容：turn 的语义标记除标准属性外，也接受写成子标签
 * （<turn><pacing>setup</pacing>…</turn>）或 goal 开头的方括号前缀（[setup|daily_bond|hold|days]）；
 * 枚举值接受大小写、常见中英文别名并归一化为标准值。归一化不了的原文保留给校验器诊断。
 *
 * 增量修补：校验发现缺项后，运行时只向模型索要 <fix node="1" turn="2" function="…"/> 形式的补丁，
 * 由 applyOutlineFixes_ACU 按位置合并回草稿，而不是整份重来。
 */

import {
  CONTINUATION_SCHEMA_VERSION_ACU,
  ContinuationValidationError_ACU,
  createContinuationError_ACU,
  STAGE_ROLES_ACU,
  STAGE_TEMPOS_ACU,
  STAGE_TURN_FUNCTIONS_ACU,
  STAGE_TURN_MAINLINE_DELTAS_ACU,
  STAGE_TURN_PACINGS_ACU,
  STAGE_TURN_TIME_ADVANCES_ACU,
  type StageNode_ACU,
  type StageOutline_ACU,
  type StageRole_ACU,
  type StageTempo_ACU,
  type StageTurnFunction_ACU,
  type StageTurnMainlineDelta_ACU,
  type StageTurnPacing_ACU,
  type StageTurnTimeAdvance_ACU,
} from './model';
import { stripReasoningBlocks_ACU } from './lenient-text';

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
  /** 枚举标签保留模型原文（已做别名归一化）；合法性只由严格 schema 校验器裁决。 */
  tempo: string | null;
  role: string | null;
  timeSpanGoal: string | null;
  nodes: ParsedOutlineTagNode_ACU[];
}

/** 可归一化的枚举种类。 */
export type OutlineEnumKind_ACU = 'pacing' | 'function' | 'mainline' | 'time' | 'tempo' | 'role';

/**
 * 枚举别名表：键为标准值，值为模型可能写出的同义写法（小写比较；中文按包含匹配）。
 * 只收录语义无歧义的别名——“日常”只映射到 daily_bond 会误伤 daily_world，因此不收。
 */
const ENUM_ALIASES_ACU: Record<OutlineEnumKind_ACU, Record<string, readonly string[]>> = {
  pacing: {
    setup: ['set_up', 'set-up', 'daily', 'low', 'calm', '铺垫', '日常', '低压', '平缓', '铺垫日常'],
    pressure: ['conflict', 'high', 'push', '冲突', '高压', '推进', '冲突推进', '压力'],
    turn: ['twist', 'reveal', 'turning', '转折', '揭示', '反转', '转折揭示'],
    cooldown: ['cool_down', 'cool-down', 'aftermath', 'recovery', 'rest', '余波', '消化', '余波消化', '缓和', '休整'],
  },
  function: {
    daily_bond: ['bond', 'relationship', 'daily-bond', 'dailybond', '关系日常', '关系', '相处', '感情日常'],
    daily_world: ['world', 'daily-world', 'dailyworld', 'slice_of_life', '世界日常', '世界', '风土', '世界侧写', '市井'],
    recovery: ['recover', 'heal', 'healing', 'rest', '恢复', '疗伤', '休养', '余波'],
    preparation: ['prepare', 'prep', '准备', '筹备', '备战'],
    training: ['train', 'practice', 'study', 'cultivation', '训练', '修炼', '学习', '成长', '练功'],
    economy: ['economic', 'business', 'trade', 'resource', '经营', '生产', '资源', '商业', '经济'],
    side_thread: ['side', 'sidethread', 'side-thread', 'subplot', '支线', '副线'],
    conflict: ['fight', 'battle', 'confrontation', '冲突', '对抗', '战斗', '危机'],
    reveal: ['revelation', 'twist', 'disclose', '揭示', '揭露', '反转', '揭秘'],
    payoff: ['pay_off', 'pay-off', 'fulfill', '兑现', '回收', '收束', '回报'],
    transition: ['transit', 'bridge', 'scene_change', '过渡', '转场', '衔接', '跳转'],
  },
  mainline: {
    hold: ['none', 'pause', 'stay', 'no', '不推进', '停驻', '保持', '不动', '停', '维持', '暂停'],
    micro: ['tiny', 'minor', 'small', '微', '微推进', '细微', '轻微'],
    step: ['advance', 'progress', 'forward', 'push', '推进', '前进', '一步', '推进一步'],
    milestone: ['major', 'big', 'climax', '里程碑', '重大', '关键节点', '阶段成果'],
  },
  time: {
    continuous: ['continue', 'immediate', 'immediately', 'now', 'cont', '紧接', '连续', '紧接着', '立刻', '同时', '接续'],
    same_day: ['sameday', 'same-day', 'today', 'later', '当天', '同日', '同一天', '稍后', '当日'],
    overnight: ['next_day', 'nextday', 'next-day', 'tomorrow', 'night', '隔夜', '次日', '第二天', '一夜', '翌日', '过夜'],
    days: ['day', 'few_days', 'several_days', '数日', '几天', '数天', '几日', '日后', '两三天'],
    weeks: ['week', 'few_weeks', '数周', '几周', '一周', '两周', '半月', '数星期'],
    months: ['month', 'few_months', '数月', '几个月', '一月', '一个月', '两月', '半年'],
    years: ['year', 'few_years', '数年', '几年', '一年', '多年', '经年'],
  },
  tempo: {
    buildup: ['build_up', 'build-up', 'setup', 'low', '铺垫', '铺垫型', '蓄力', '低压'],
    mixed: ['mix', 'normal', 'balanced', '起伏', '起伏型', '常规', '交替'],
    surge: ['high', 'climax', 'intense', '高压', '高压型', '决战', '爆发'],
    aftermath: ['after', 'recovery', 'cooldown', '余波', '余波型', '消化', '善后'],
  },
  role: {
    setup: ['opening', 'intro', 'introduction', '铺垫', '开局', '起始', '开篇', '建立'],
    development: ['develop', 'progress', 'middle', '发展', '推进', '展开', '中段'],
    escalation: ['escalate', 'rising', 'build', '升级', '升温', '加压', '激化'],
    turn: ['twist', 'turning', 'turning_point', 'midpoint', '转折', '反转', '中点'],
    payoff: ['climax', 'pay_off', 'resolution', '兑现', '高潮', '收束', '回收'],
    aftermath: ['after', 'cooldown', 'epilogue', 'wrap_up', '余波', '善后', '收尾', '尾声'],
  },
};

const ENUM_VALUES_ACU: Record<OutlineEnumKind_ACU, readonly string[]> = {
  pacing: STAGE_TURN_PACINGS_ACU,
  function: STAGE_TURN_FUNCTIONS_ACU,
  mainline: STAGE_TURN_MAINLINE_DELTAS_ACU,
  time: STAGE_TURN_TIME_ADVANCES_ACU,
  tempo: STAGE_TEMPOS_ACU,
  role: STAGE_ROLES_ACU,
};

function compactEnumText_ACU(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s\-]+/g, '_').replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '').replace(/[。．.,，;；、]+$/g, '');
}

/**
 * 把模型写出的枚举值归一化为标准值。
 * 命中标准值或别名返回标准值；识别不了时返回整理过大小写与空白的原文，让校验器给出带原文的诊断。
 * @param kind 枚举种类
 * @param raw 模型原文
 * @returns 标准值，或无法识别时的原文；空串返回 null
 */
export function normalizeOutlineEnum_ACU(kind: OutlineEnumKind_ACU, raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const compact = compactEnumText_ACU(raw);
  if (!compact) return null;
  const values = ENUM_VALUES_ACU[kind];
  if (values.includes(compact)) return compact;
  const aliases = ENUM_ALIASES_ACU[kind];
  for (const [canonical, list] of Object.entries(aliases)) {
    if (list.some(alias => alias === compact)) return canonical;
  }
  // 中文别名按包含匹配：模型常写「余波消化轮」「关系日常场景」这类带修饰的词。
  const hasCjk = /[\u3400-\u9fff]/.test(compact);
  if (hasCjk) {
    for (const [canonical, list] of Object.entries(aliases)) {
      if (list.some(alias => /[\u3400-\u9fff]/.test(alias) && compact.includes(alias))) return canonical;
    }
    if (values.some(value => compact.includes(value))) return values.find(value => compact.includes(value)) ?? compact;
  }
  return compact;
}

/** 判断归一化后的值是否为该枚举的标准值。 */
export function isOutlineEnumValue_ACU(kind: OutlineEnumKind_ACU, value: string | null | undefined): boolean {
  return typeof value === 'string' && ENUM_VALUES_ACU[kind].includes(value);
}

function failParse_ACU(message: string): never {
  throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_OUTLINE_JSON_INVALID', 'outline_parse', message, true));
}

function readTag_ACU(text: string, tag: string): string {
  const match = text.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}\\s*>`, 'i'));
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

/** 属性名别名：模型可能写 timeAdvance / mainlineDelta / 中文字段名。 */
const ATTRIBUTE_ALIASES_ACU: Record<'pacing' | 'function' | 'mainline' | 'time' | 'anchor', readonly string[]> = {
  pacing: ['pacing', 'pace', 'tempo', '节奏', '压力'],
  function: ['function', 'func', 'fn', 'role', 'type', '功能', '叙事功能'],
  mainline: ['mainline', 'mainlinedelta', 'mainline_delta', 'main', 'delta', '主线', '主线增量'],
  time: ['time', 'timeadvance', 'time_advance', 'advance', 'span', '时间', '时间跨度'],
  anchor: ['anchor', 'timeanchor', 'time_anchor', '时间锚', '锚', '锚点'],
};

/**
 * 读取一个属性值，正确处理带空格的引号值：anchor="抵达临川城后 第七天" 不能在空格处截断。
 * 匹配到的属性名按别名表对照，大小写不敏感。
 */
function readTagAttribute_ACU(attributes: string, names: readonly string[]): string {
  if (!attributes) return '';
  const pattern = /([A-Za-z_\u3400-\u9fff][\w\-\u3400-\u9fff]*)\s*[=：:]\s*(?:"([^"]*)"|“([^”]*)”|'([^']*)'|‘([^’]*)’|([^\s"'“”‘’>]+))/g;
  for (const match of attributes.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    if (!names.includes(name)) continue;
    const value = match[2] ?? match[3] ?? match[4] ?? match[5] ?? match[6] ?? '';
    return value.trim();
  }
  return '';
}

function readOptionalTag_ACU(text: string, tag: string): string | null {
  const raw = readTag_ACU(text, tag);
  return raw ? raw : null;
}

interface TurnMarkers_ACU {
  pacing: string | null;
  function: string | null;
  mainlineDelta: string | null;
  timeAdvance: string | null;
  timeAnchor: string | null;
}

function emptyMarkers_ACU(): TurnMarkers_ACU {
  return { pacing: null, function: null, mainlineDelta: null, timeAdvance: null, timeAnchor: null };
}

function assignMarker_ACU(target: TurnMarkers_ACU, key: keyof TurnMarkers_ACU, raw: string | null): void {
  if (raw === null || raw === '') return;
  if (target[key] !== null) return;
  if (key === 'timeAnchor') { target.timeAnchor = raw.trim(); return; }
  const kind: OutlineEnumKind_ACU = key === 'mainlineDelta' ? 'mainline' : key === 'timeAdvance' ? 'time' : key;
  target[key] = normalizeOutlineEnum_ACU(kind, raw);
}

/** 从 `key=value` 片段列表里读取标记；片段分隔符与键值分隔符都宽容。 */
function assignFromPairs_ACU(target: TurnMarkers_ACU, pairs: readonly string[]): boolean {
  let any = false;
  for (const pair of pairs) {
    const match = pair.match(/^\s*([A-Za-z_\u3400-\u9fff][\w\-\u3400-\u9fff]*)\s*[=：:]\s*(.+?)\s*$/);
    if (!match) continue;
    const name = match[1].toLowerCase();
    const value = match[2].replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
    for (const [key, names] of Object.entries(ATTRIBUTE_ALIASES_ACU) as [keyof typeof ATTRIBUTE_ALIASES_ACU, readonly string[]][]) {
      if (!names.includes(name)) continue;
      assignMarker_ACU(target, key === 'mainline' ? 'mainlineDelta' : key === 'time' ? 'timeAdvance' : key === 'anchor' ? 'timeAnchor' : key, value);
      any = true;
    }
  }
  return any;
}

/**
 * 解析 goal 开头的方括号前缀：[setup|daily_bond|hold|days|入城第七天] 或 [pacing=setup; time=days]。
 * 位置式按 pacing、function、mainline、time、anchor 顺序读取。
 * @returns 去掉前缀后的 goal 与读到的标记
 */
function readBracketPrefix_ACU(goal: string, target: TurnMarkers_ACU): string {
  const match = goal.match(/^\s*[\[【]([^\]】]{1,160})[\]】]\s*/);
  if (!match) return goal;
  const body = match[1];
  const pieces = body.split(/[|｜,，;；\/]/).map(piece => piece.trim()).filter(Boolean);
  if (!pieces.length) return goal;
  const looksLikePairs = pieces.some(piece => /[=：:]/.test(piece));
  if (looksLikePairs) {
    if (!assignFromPairs_ACU(target, pieces)) return goal;
    return goal.slice(match[0].length);
  }
  // 位置式：第一项必须能识别为 pacing，否则这个方括号只是正文的一部分（如【回忆】）。
  const pacing = normalizeOutlineEnum_ACU('pacing', pieces[0]);
  if (!isOutlineEnumValue_ACU('pacing', pacing)) return goal;
  const keys: (keyof TurnMarkers_ACU)[] = ['pacing', 'function', 'mainlineDelta', 'timeAdvance', 'timeAnchor'];
  pieces.slice(0, keys.length).forEach((piece, index) => assignMarker_ACU(target, keys[index], piece));
  return goal.slice(match[0].length);
}

/** 从 turn 正文里剥出 <pacing>…</pacing> 这类子标签形态的标记。 */
function readChildMarkers_ACU(value: string, target: TurnMarkers_ACU): string {
  let rest = value;
  for (const [key, names] of Object.entries(ATTRIBUTE_ALIASES_ACU) as [keyof typeof ATTRIBUTE_ALIASES_ACU, readonly string[]][]) {
    for (const name of names) {
      const pattern = new RegExp(`<${name}\\s*>([\\s\\S]*?)</${name}\\s*>`, 'i');
      const match = rest.match(pattern);
      if (!match) continue;
      assignMarker_ACU(target, key === 'mainline' ? 'mainlineDelta' : key === 'time' ? 'timeAdvance' : key === 'anchor' ? 'timeAnchor' : key, match[1].trim());
      rest = rest.replace(pattern, '');
    }
  }
  // 也接受 <goal>…</goal> 包裹正文的写法。
  const goalMatch = rest.match(/<goal\s*>([\s\S]*?)<\/goal\s*>/i);
  if (goalMatch) rest = goalMatch[1];
  return rest.trim();
}

function parseTurnEntry_ACU(entry: TagEntry_ACU): ParsedOutlineTagTurn_ACU {
  const markers = emptyMarkers_ACU();
  assignMarker_ACU(markers, 'pacing', readTagAttribute_ACU(entry.attributes, ATTRIBUTE_ALIASES_ACU.pacing));
  assignMarker_ACU(markers, 'function', readTagAttribute_ACU(entry.attributes, ATTRIBUTE_ALIASES_ACU.function));
  assignMarker_ACU(markers, 'mainlineDelta', readTagAttribute_ACU(entry.attributes, ATTRIBUTE_ALIASES_ACU.mainline));
  assignMarker_ACU(markers, 'timeAdvance', readTagAttribute_ACU(entry.attributes, ATTRIBUTE_ALIASES_ACU.time));
  assignMarker_ACU(markers, 'timeAnchor', readTagAttribute_ACU(entry.attributes, ATTRIBUTE_ALIASES_ACU.anchor));
  let goal = readChildMarkers_ACU(entry.value, markers);
  goal = readBracketPrefix_ACU(goal, markers).trim();
  return { goal, ...markers };
}

/**
 * 从模型返回原文中宽容提取大纲标签结构。标签外内容（思路、围栏、JSON、推理块）全部忽略。
 * @param raw 模型返回的原始文本
 * @returns 阶段标题/目标与节点列表（节点含标题/目标与逐轮目标文本）
 */
export function parseOutlineTags_ACU(raw: string | null | undefined): ParsedOutlineTags_ACU {
  const text = typeof raw === 'string' ? stripReasoningBlocks_ACU(raw) : '';
  if (!text.trim()) failParse_ACU('大纲返回为空');
  const nodeBlocks = readTagList_ACU(text, 'node');
  if (!nodeBlocks.length) {
    failParse_ACU(`返回内容不包含任何 <node> 标签。模型返回片段：${text.trim().slice(0, 300)}`);
  }
  const nodes = nodeBlocks.map((block, index) => {
    const turns = readTagEntries_ACU(block, 'turn').map(parseTurnEntry_ACU).filter(turn => turn.goal);
    if (!turns.length) failParse_ACU(`第 ${index + 1} 个 <node> 中没有任何非空 <turn> 标签`);
    return { title: readTag_ACU(block, 'node_title'), goal: readTag_ACU(block, 'node_goal'), turns };
  });
  return {
    title: readTag_ACU(text, 'stage_title'),
    goal: readTag_ACU(text, 'stage_goal'),
    tempo: normalizeOutlineEnum_ACU('tempo', readOptionalTag_ACU(text, 'stage_tempo')),
    role: normalizeOutlineEnum_ACU('role', readOptionalTag_ACU(text, 'stage_role')),
    timeSpanGoal: readOptionalTag_ACU(text, 'stage_time_span'),
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
  // 首次生成时阶段标题/目标漏写不该让整份大纲作废：标题退到首节点标题，目标退到各节点目标的拼接。
  // 重规划（有 fallback）时留空，由拼接逻辑沿用旧大纲的标题与目标。
  const derivedTitle = fallback ? '' : (parsed.nodes.find(node => node.title)?.title ?? '') || '未命名阶段';
  const derivedGoal = fallback ? '' : parsed.nodes.map(node => node.goal).filter(Boolean).join('；');
  return {
    schemaVersion: CONTINUATION_SCHEMA_VERSION_ACU,
    title: parsed.title || fallback?.title || derivedTitle,
    goal: parsed.goal || fallback?.goal || derivedGoal,
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

/** 一条增量修补：针对阶段级字段，或针对模型输出里第 node 个节点的第 turn 轮。 */
export interface OutlineFix_ACU {
  /** 'stage' 修阶段字段；否则为模型自身输出中的 1 基节点/轮次位置。 */
  target: 'stage' | { node: number; turn: number };
  pacing?: string;
  function?: string;
  mainlineDelta?: string;
  timeAdvance?: string;
  timeAnchor?: string;
  tempo?: string;
  role?: string;
  timeSpanGoal?: string;
}

/**
 * 解析修补轮回复中的 <fix …/> 条目。自闭合与成对写法都接受；属性名走同一套别名表。
 * 没有任何 <fix> 时返回空数组（由调用方决定是回灌还是放弃修补）。
 * @param raw 修补轮模型原文
 */
export function parseOutlineFixes_ACU(raw: string | null | undefined): OutlineFix_ACU[] {
  const text = typeof raw === 'string' ? stripReasoningBlocks_ACU(raw) : '';
  const fixes: OutlineFix_ACU[] = [];
  const pattern = /<fix(\s[^>]*?)?\s*\/?>/gi;
  for (const match of text.matchAll(pattern)) {
    const attributes = match[1] ?? '';
    if (!attributes.trim()) continue;
    const stageFlag = /(^|\s)(target\s*[=：:]\s*["'“‘]?stage|stage(\s|$|[=：:]))/i.test(attributes);
    const node = Number.parseInt(readTagAttribute_ACU(attributes, ['node', '节点']), 10);
    const turn = Number.parseInt(readTagAttribute_ACU(attributes, ['turn', '轮', '轮次']), 10);
    const fix: OutlineFix_ACU = { target: stageFlag && !(node > 0) ? 'stage' : { node, turn } };
    if (fix.target !== 'stage' && (!(node > 0) || !(turn > 0))) continue;
    const pacing = readTagAttribute_ACU(attributes, ATTRIBUTE_ALIASES_ACU.pacing);
    const fn = readTagAttribute_ACU(attributes, ATTRIBUTE_ALIASES_ACU.function);
    const mainline = readTagAttribute_ACU(attributes, ATTRIBUTE_ALIASES_ACU.mainline);
    const time = readTagAttribute_ACU(attributes, ATTRIBUTE_ALIASES_ACU.time);
    const anchor = readTagAttribute_ACU(attributes, ATTRIBUTE_ALIASES_ACU.anchor);
    const tempo = readTagAttribute_ACU(attributes, ['tempo', 'stage_tempo', '形态', '节奏形态']);
    const role = readTagAttribute_ACU(attributes, ['role', 'stage_role', '职责', '结构职责']);
    const span = readTagAttribute_ACU(attributes, ['time_span', 'timespan', 'stage_time_span', 'span', '时间目标', '时间跨度']);
    if (fix.target === 'stage') {
      if (tempo) fix.tempo = normalizeOutlineEnum_ACU('tempo', tempo) ?? undefined;
      if (role) fix.role = normalizeOutlineEnum_ACU('role', role) ?? undefined;
      if (span) fix.timeSpanGoal = span;
    } else {
      if (pacing) fix.pacing = normalizeOutlineEnum_ACU('pacing', pacing) ?? undefined;
      if (fn) fix.function = normalizeOutlineEnum_ACU('function', fn) ?? undefined;
      if (mainline) fix.mainlineDelta = normalizeOutlineEnum_ACU('mainline', mainline) ?? undefined;
      if (time) fix.timeAdvance = normalizeOutlineEnum_ACU('time', time) ?? undefined;
      if (anchor) fix.timeAnchor = anchor;
    }
    fixes.push(fix);
  }
  return fixes;
}

/**
 * 把修补合并回模型规划的大纲草稿（只作用于模型自己输出的节点，不触碰重规划前缀）。
 * 只有归一化后是标准枚举的值才写入；识别不了的值忽略，留给下一轮校验再报。
 * @param planned buildStageOutlineFromTags_ACU 的产物
 * @param fixes 解析出的修补
 * @returns 应用修补后的新草稿；无任何有效修补时返回原对象
 */
export function applyOutlineFixes_ACU(planned: StageOutline_ACU, fixes: readonly OutlineFix_ACU[]): StageOutline_ACU {
  if (!fixes.length) return planned;
  const draft: StageOutline_ACU = { ...planned, nodes: planned.nodes.map(node => ({ ...node, turns: node.turns.map(turn => ({ ...turn })) })) };
  let changed = false;
  for (const fix of fixes) {
    if (fix.target === 'stage') {
      if (isOutlineEnumValue_ACU('tempo', fix.tempo)) { draft.tempo = fix.tempo as StageTempo_ACU; changed = true; }
      if (isOutlineEnumValue_ACU('role', fix.role)) { draft.role = fix.role as StageRole_ACU; changed = true; }
      if (fix.timeSpanGoal?.trim()) { draft.timeSpanGoal = fix.timeSpanGoal.trim(); changed = true; }
      continue;
    }
    const node = draft.nodes[fix.target.node - 1];
    const turn = node?.turns[fix.target.turn - 1];
    if (!turn) continue;
    if (isOutlineEnumValue_ACU('pacing', fix.pacing)) { turn.pacing = fix.pacing as StageTurnPacing_ACU; changed = true; }
    if (isOutlineEnumValue_ACU('function', fix.function)) { turn.function = fix.function as StageTurnFunction_ACU; changed = true; }
    if (isOutlineEnumValue_ACU('mainline', fix.mainlineDelta)) { turn.mainlineDelta = fix.mainlineDelta as StageTurnMainlineDelta_ACU; changed = true; }
    if (isOutlineEnumValue_ACU('time', fix.timeAdvance)) { turn.timeAdvance = fix.timeAdvance as StageTurnTimeAdvance_ACU; changed = true; }
    if (fix.timeAnchor?.trim()) { turn.timeAnchor = fix.timeAnchor.trim(); changed = true; }
    if (changed && turn.inferred) delete turn.inferred;
  }
  return changed ? draft : planned;
}
