/**
 * service/continuation/agent/agent-placeholder-resolver.ts — 读写集占位符解析
 *
 * 读集 token 只是资料接口标识符，不是提示词 token：解析结果统一汇成一块材料文本，
 * 通过单个 `$AGENT_READ_MATERIALS` 注入子代理提示词。这样动态表名（$TABLE:xxx）
 * 不需要扩展提示词渲染器的固定 token 表。
 */

import type { StageTurn_ACU, StageTurnPacing_ACU } from '../model';
import { describeStageTempo_ACU } from '../outline-schema';
import type { ContinuationAgentExecutionContext_ACU } from '../stage-execution-engine';
import {
  AGENT_STORY_TAIL_FLOORS_DEFAULT_ACU,
  AGENT_STORY_WINDOW_DEFAULT_ACU,
  type AgentModuleSnapshot_ACU,
} from './agent-model';
import {
  renderAgentChronology_ACU,
  renderAgentChronologyByIds_ACU,
  renderAgentConstraintsByIds_ACU,
  renderAgentHooksByIds_ACU,
  renderAgentInfoGapByIds_ACU,
  renderAgentStoryArcByIds_ACU,
  renderAgentWebRefsByIds_ACU,
} from './agent-module-store';
import { AGENT_TABLE_ALIASES_ACU, findAgentSheetsByAliases_ACU, renderAgentTableByAliases_ACU, renderAgentTableByName_ACU, type AgentTableRowRange_ACU } from './agent-tables';
import {
  buildEmptyAgentWorldbookSnapshot_ACU,
  renderAgentWorldbookEntries_ACU,
  type AgentWorldbookSnapshot_ACU,
} from './agent-worldbook-read';
import { normalizeAmCode_ACU } from '../worldbook-context';
import { applyContextTagFilters_ACU } from '../../runtime/helpers-context-tags';

export const AGENT_TABLE_TOKEN_PREFIX_ACU = '$TABLE:';
export const AGENT_STORY_RANGE_TOKEN_PREFIX_ACU = '$STORY_RANGE:';
export const AGENT_WORLDBOOK_TOKEN_PREFIX_ACU = '$WORLDBOOK:';

/** 每条虚拟/模块/表占位符对应的人类可读标题，进入材料块的分节标题。 */
const READ_TOKEN_TITLES_ACU: Record<string, string> = {
  $STORY_TEXT: '已经发生的小说正文（只含 AI 楼层）',
  $STORY_CATALOG: '正文楼层索引',
  $STORY_OVERVIEW: '事件概览（纪要表逐轮）',
  $STORY_TAIL: '最近正文（尾部全文楼层）',
  $HISTORY_UNSETTLED: '尚未结算的真实历史',
  $OUTLINE_WINDOW: '当前大纲窗口',
  $CURRENT_TURN_GOAL: '本轮目标',
  $CURRENT_TURN_PACING: '本轮节奏',
  $USER_INTENT: '用户的初始要求',
  $STORY_ARC: '故事总纲',
  $HOOKS_LEDGER: '伏笔账本',
  $INFO_GAP: '认知与信息差时间线',
  $ACTIVE_CONSTRAINTS: '长期约束',
  $CHRONOLOGY: '故事年代学账本',
  $WEB_REFS: '百科资料库',
  $TABLE_GLOBAL: '全局数据表',
  $TABLE_CHARACTERS: '角色表',
  $TABLE_CHRONICLES: '纪要表',
};

/** 续写侧的上下文标签提取/排除规则（与剧情推进共用 applyContextTagFilters_ACU 语义）。 */
export interface AgentContextRules_ACU {
  extractRules: { start: string; end: string }[];
  excludeRules: { start: string; end: string }[];
}

export interface AgentResolveContext_ACU {
  chat: any[];
  moduleSnapshot: AgentModuleSnapshot_ACU;
  settledThroughIndex: number;
  execution: ContinuationAgentExecutionContext_ACU;
  originInstruction: string;
  /**
   * Agent 可读/可搜正文窗口：只有最近这么多 AI 楼层可以 read/search，
   * 更早的剧情脉络经事件概览与 $TABLE:纪要表 回溯。缺省用 AGENT_STORY_WINDOW_DEFAULT_ACU。
   */
  storyWindowFloors?: number;
  /** 固定注入全文的末尾 AI 楼层数（$STORY_TAIL）；缺省用 AGENT_STORY_TAIL_FLOORS_DEFAULT_ACU。 */
  storyTailFloors?: number;
  tableData?: unknown;
  /** 运行起点预取的世界书快照；缺省为不可用空快照（如测试环境）。 */
  worldbook?: AgentWorldbookSnapshot_ACU;
  /** 上下文提取/排除规则；缺省不做任何过滤。 */
  contextRules?: AgentContextRules_ACU;
  /** 本轮召回的 AM 码（取自最后一个用户楼层）；缺省为空。 */
  recallCodes?: readonly string[];
}

/** 正文渲染的最小入参：AgentResolveContext 结构性满足，大纲侧可用轻量对象直接调用。 */
export interface AgentStoryFloorSource_ACU {
  chat: any[];
  storyWindowFloors?: number;
  storyTailFloors?: number;
  contextRules?: AgentContextRules_ACU;
}

function applyAgentContextRules_ACU(text: string, rules?: AgentContextRules_ACU): string {
  if (!rules || (!rules.extractRules.length && !rules.excludeRules.length)) return text;
  return applyContextTagFilters_ACU(text, { extractTags: '', extractRules: rules.extractRules, excludeTags: '', excludeRules: rules.excludeRules }).trim();
}

function messageText_ACU(message: any, rules?: AgentContextRules_ACU): string {
  return applyAgentContextRules_ACU(String(message?.mes ?? '').trim(), rules);
}

interface AgentStoryFloor_ACU {
  index: number;
  text: string;
}

function listAgentStoryFloors_ACU(source: AgentStoryFloorSource_ACU): AgentStoryFloor_ACU[] {
  const chat = Array.isArray(source.chat) ? source.chat : [];
  return chat
    .map((message, index) => ({ index, text: messageText_ACU(message, source.contextRules) }))
    .filter(item => chat[item.index] && !chat[item.index].is_user && item.text);
}

function agentStoryWindowSize_ACU(source: AgentStoryFloorSource_ACU): number {
  return Math.max(0, source.storyWindowFloors ?? AGENT_STORY_WINDOW_DEFAULT_ACU);
}

/** Agent 可读/可搜的正文窗口：最近 storyWindowFloors 个 AI 楼层。同时供搜索工具划定 story 域。 */
export function listAgentStoryWindowFloors_ACU(source: AgentStoryFloorSource_ACU): AgentStoryFloor_ACU[] {
  const window = agentStoryWindowSize_ACU(source);
  return window > 0 ? listAgentStoryFloors_ACU(source).slice(-window) : [];
}

/**
 * 从最后一个用户楼层提取本轮召回的 AM 码。
 * 剧情推进 AI 的召回结果（<recall>AMxxxx</recall> 等）就落在这层文本里，直接复用即可，
 * 不需要续写侧再发一次召回调用。取原始文本而非过滤后的文本：召回码可能位于会被规则剥掉的标签内。
 * @param chat 聊天数组
 * @returns 去重后的规范化 AM 码列表；没有用户楼层或无命中时为空数组
 */
export function extractAgentRecallCodesFromChat_ACU(chat: readonly any[]): string[] {
  const list = Array.isArray(chat) ? chat : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index];
    if (!message || !message.is_user) continue;
    const matches = String(message.mes ?? '').match(/AM\d+/gi) ?? [];
    return [...new Set(matches
      .map(code => normalizeAmCode_ACU(code))
      .filter((code): code is string => code !== null))];
  }
  return [];
}

function renderStoryFloors_ACU(floors: readonly AgentStoryFloor_ACU[]): string {
  return floors.map(floor => `【楼层 ${floor.index}】\n${floor.text}`).join('\n\n');
}

function storyOpening_ACU(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= 40 ? flat : `${flat.slice(0, 40)}…`;
}

/** 事件概览的最小入参。 */
export interface AgentStoryOverviewSource_ACU {
  tableData?: unknown;
  recallCodes?: readonly string[];
}

/** 定位纪要表的一列：按表头包含关系匹配候选名，命中第一个。 */
function findColumnIndex_ACU(header: readonly string[], candidates: readonly string[]): number {
  for (const candidate of candidates) {
    const index = header.findIndex(cell => cell.includes(candidate));
    if (index >= 0) return index;
  }
  return -1;
}

/** 事件概览的渲染选项。 */
export interface AgentStoryOverviewOptions_ACU {
  /**
   * 只保留最新的 N 行概览（按纪要表行序取尾部）。窗口外被本轮召回码命中的行不受截断
   * 影响——它们以纪要全文按行序前置展示，保证召回机制在截断下仍然完整。
   * 缺省为不限（主会话/大纲子代理/read 工具路径全量注入）。
   */
  maxRows?: number;
}

/**
 * 渲染事件概览：纪要表逐轮的「概览」列注入，命中本轮召回 AM 码的行升级为「纪要」全文。
 *
 * 这是主会话与策划类子代理掌握全局剧情脉络的固定来源——概览按剧情轮记录（每轮一行），
 * 与楼层号没有一一映射，精确正文要走 $STORY_RANGE 或楼层索引。
 * @param source 表格数据与本轮召回码
 * @param options 渲染选项；maxRows 见 AgentStoryOverviewOptions_ACU
 * @returns 概览文本；纪要表缺失/为空时如实说明
 */
export function renderAgentStoryOverview_ACU(source: AgentStoryOverviewSource_ACU, options?: AgentStoryOverviewOptions_ACU): string {
  const sheets = findAgentSheetsByAliases_ACU(AGENT_TABLE_ALIASES_ACU.chronicles, source.tableData);
  if (!sheets.length) {
    return '当前聊天没有纪要表，无法提供事件概览。剧情脉络只能依靠楼层索引与正文楼层本身。';
  }
  const recall = new Set((source.recallCodes ?? []).map(code => normalizeAmCode_ACU(code)).filter(Boolean));
  const maxRows = options?.maxRows && options.maxRows > 0 ? Math.floor(options.maxRows) : null;
  let anyExpanded = false;
  const sections = sheets.map(sheet => {
    if (!sheet.rows.length) return `表「${sheet.name}」存在但没有数据行。`;
    const codeColumn = findColumnIndex_ACU(sheet.header, ['编码索引', '编码']);
    const overviewColumn = findColumnIndex_ACU(sheet.header, ['概览', '概要']);
    const digestColumn = sheet.header.findIndex(cell => cell.includes('纪要') && !cell.includes('概'));
    const renderRow = (row: readonly string[], rowIndex: number): string => {
      const code = codeColumn >= 0 ? normalizeAmCode_ACU(row[codeColumn]) : null;
      const overview = overviewColumn >= 0 ? row[overviewColumn] : '';
      const digest = digestColumn >= 0 ? row[digestColumn] : '';
      const label = code ?? `第 ${rowIndex + 1} 行`;
      if (code && recall.has(code) && digest) {
        anyExpanded = true;
        return `- ${label}｜【纪要全文】${digest}`;
      }
      return `- ${label}｜${overview || digest || '（空行）'}`;
    };
    const windowStart = maxRows !== null ? Math.max(0, sheet.rows.length - maxRows) : 0;
    const windowLines = sheet.rows.slice(windowStart).map((row, offset) => renderRow(row, windowStart + offset));
    const parts: string[] = [];
    if (windowStart > 0) {
      parts.push(`更早的 ${windowStart} 轮概览已省略（对应「${sheet.name}」第 1-${windowStart} 行），需要时用 $TABLE:${sheet.name}:行区间 精读。`);
      // 窗口外被召回命中的行按行序前置：召回命中说明与本轮直接相关，不能被截断静默丢掉。
      const recalledEarlier = sheet.rows.slice(0, windowStart)
        .map((row, rowIndex) => ({ row, rowIndex }))
        .filter(({ row }) => {
          const code = codeColumn >= 0 ? normalizeAmCode_ACU(row[codeColumn]) : null;
          return code !== null && recall.has(code);
        });
      if (recalledEarlier.length) {
        parts.push(`以下为本轮召回命中的更早轮次（不受截断影响）：\n${recalledEarlier.map(({ row, rowIndex }) => renderRow(row, rowIndex)).join('\n')}`);
      }
    }
    parts.push(windowLines.join('\n'));
    const head = sheets.length > 1 ? `## 表「${sheet.name}」\n` : '';
    return `${head}${parts.join('\n\n')}`;
  });
  const expandedNote = anyExpanded
    ? '带【纪要全文】标记的行已按本轮召回码展开为详细纪要。'
    : '';
  return [
    '以下是纪要表的逐轮事件概览（每行对应一轮剧情，与楼层号无一一映射；需要某轮的详细纪要时用 $TABLE:纪要表:行区间 精读）：',
    ...sections,
    expandedNote,
  ].filter(Boolean).join('\n\n');
}

/**
 * 渲染最近正文：末尾 storyTailFloors 个 AI 楼层的全文（已过上下文提取/排除规则）。
 * 这是承接锚点——续写必须无缝衔接的最新正文。
 * @param source 正文楼层来源
 * @returns 逐楼全文；storyTailFloors=0 或无 AI 楼层时如实标注
 */
export function renderAgentStoryTail_ACU(source: AgentStoryFloorSource_ACU): string {
  const windowFloors = listAgentStoryWindowFloors_ACU(source);
  if (!windowFloors.length) return '当前没有可注入的正文楼层（聊天里还没有 AI 正文，或可读窗口为 0）。';
  const tailCount = Math.max(0, source.storyTailFloors ?? AGENT_STORY_TAIL_FLOORS_DEFAULT_ACU);
  if (tailCount === 0) return '未注入正文楼层全文（尾部楼层数设置为 0）。需要正文时用 $STORY_RANGE:起始楼-结束楼 读取。';
  const tailFloors = windowFloors.slice(-tailCount);
  return `最近 ${tailFloors.length} 楼全文（续写必须无缝衔接这里的结尾）：\n${renderStoryFloors_ACU(tailFloors)}`;
}

/**
 * 渲染正文楼层索引：纯索引，不含任何正文全文（全文见 $STORY_TAIL，脉络见 $STORY_OVERVIEW）。
 * 每楼一行「楼层号 + 约字数 + 读取地址」；纪要表缺失时退回附带开头摘要的形式以保底可导航。
 * @param source 正文楼层来源 + 表格数据（用于判断纪要表是否存在）
 * @returns 索引文本，进入主 Agent 骨架的 $STORY_CATALOG
 */
export function renderAgentStoryCatalog_ACU(source: AgentStoryFloorSource_ACU & { tableData?: unknown }): string {
  const allFloors = listAgentStoryFloors_ACU(source);
  if (!allFloors.length) return '当前聊天还没有 AI 产出的正文楼层。';
  const windowFloors = listAgentStoryWindowFloors_ACU(source);
  if (!windowFloors.length) return '正文可读窗口设置为 0 楼：正文楼层不可直接读取；剧情脉络请依靠事件概览与 $TABLE:纪要表。';
  const hiddenCount = allFloors.length - windowFloors.length;
  const headNote = hiddenCount > 0
    ? `更早的 ${hiddenCount} 个 AI 楼层不在可读窗口内；其剧情脉络请查看事件概览，或用 $TABLE:纪要表:行区间 精读对应纪要。`
    : '当前全部 AI 楼层都在可读窗口内。';
  const hasChronicleRows = findAgentSheetsByAliases_ACU(AGENT_TABLE_ALIASES_ACU.chronicles, source.tableData)
    .some(sheet => sheet.rows.length > 0);
  const lines = windowFloors.map(floor => hasChronicleRows
    ? `- 楼层 ${floor.index}｜约 ${floor.text.length} 字｜读取地址 $STORY_RANGE:${floor.index}-${floor.index}`
    : `- 楼层 ${floor.index}｜约 ${floor.text.length} 字｜开头：${storyOpening_ACU(floor.text)}｜读取地址 $STORY_RANGE:${floor.index}-${floor.index}`);
  return [
    `${headNote}\n可读窗口内的楼层索引（区间读取写 $STORY_RANGE:起始楼-结束楼；按内容找楼层用 search story）：`,
    lines.join('\n'),
    '注意：事件概览按剧情轮记录，与楼层号无一一映射；需要精确正文时按本索引区间读取。',
  ].join('\n');
}

/**
 * 按楼层区间读取窗口内的 AI 正文全文，支撑 `$STORY_RANGE:a-b`。
 * @param context 解析上下文
 * @param startRaw 起始楼层号
 * @param endRaw 结束楼层号
 * @returns 区间内逐楼全文；区间非法/落在窗口外时回灌可修正的错误文本
 */
export function renderAgentStoryRange_ACU(context: AgentResolveContext_ACU, startRaw: string, endRaw: string): string {
  const start = Number.parseInt(startRaw, 10);
  const end = Number.parseInt(endRaw, 10);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    return `楼层区间「${startRaw}-${endRaw}」不合法：写法为 $STORY_RANGE:起始楼-结束楼（两端都是楼层号，起始不大于结束）。可用楼层见正文目录。`;
  }
  const windowFloors = listAgentStoryWindowFloors_ACU(context);
  if (!windowFloors.length) return '正文可读窗口当前为空，无法读取正文；早期剧情脉络请查看事件概览或用 $TABLE:纪要表:行区间 精读。';
  const hit = windowFloors.filter(floor => floor.index >= start && floor.index <= end);
  if (!hit.length) {
    const first = windowFloors[0].index;
    const last = windowFloors[windowFloors.length - 1].index;
    return `区间 ${start}-${end} 内没有可读的 AI 楼层。可读窗口目前覆盖楼层 ${first}-${last}（只含 AI 楼）；更早的剧情脉络请查看事件概览或用 $TABLE:纪要表:行区间 精读。`;
  }
  return renderStoryFloors_ACU(hit);
}

/**
 * 渲染已经发生的小说正文。
 *
 * 只取 AI 楼层——用户楼是操作指令而不是小说内容，把它当正文注入会让模型把指令误读成剧情。
 * 分「已结算」「尚未结算」两段：已结算段按窗口取最近若干楼（更早部分已经沉淀进资料模块与纪要），
 * 未结算段全量注入（它还没被任何资料模块吸收，是本轮必须亲自读的部分）。
 * @param context 解析上下文
 * @returns 分段的逐楼正文；没有 AI 楼层时如实说明
 */
export function renderAgentStoryText_ACU(context: AgentResolveContext_ACU): string {
  const chat = Array.isArray(context.chat) ? context.chat : [];
  const highestIndex = chat.length - 1;
  if (highestIndex < 0) return '当前聊天还没有任何楼层，也就没有已经发生的正文。';
  // 删楼后残留的水位可能指向已不存在的楼层，必须钳制，否则未结算段起点会越过末楼输出空段。
  const settledThrough = Math.min(context.settledThroughIndex, highestIndex);
  const floors = chat
    .map((message, index) => ({ index, text: messageText_ACU(message, context.contextRules) }))
    .filter(item => chat[item.index] && !chat[item.index].is_user && item.text);
  if (!floors.length) return '当前聊天还没有 AI 产出的正文楼层。';

  const window = Math.max(0, context.storyWindowFloors ?? AGENT_STORY_WINDOW_DEFAULT_ACU);
  const settled = floors.filter(item => item.index <= settledThrough);
  const unsettled = floors.filter(item => item.index > settledThrough);
  const shownSettled = window > 0 ? settled.slice(-window) : [];
  const hiddenSettled = settled.length - shownSettled.length;
  const render = (items: Array<{ index: number; text: string }>) => items.map(item => `【楼层 ${item.index}】\n${item.text}`).join('\n\n');

  const sections: string[] = [];
  const settledHead = hiddenSettled > 0
    ? `## 已结算正文（只列最近 ${shownSettled.length} 楼；更早的 ${hiddenSettled} 楼未注入，其事实已沉淀进资料模块与纪要，需要时派工读取）`
    : '## 已结算正文';
  if (shownSettled.length) sections.push(`${settledHead}\n${render(shownSettled)}`);
  else if (settled.length) sections.push(`${settledHead}\n（本次未注入任何已结算正文。）`);
  sections.push(unsettled.length
    ? `## 尚未结算的最新正文（全量）\n${render(unsettled)}`
    : '## 尚未结算的最新正文\n没有尚未结算的正文楼层；上一轮已结算到当前最后一楼。');
  return sections.join('\n\n');
}

/**
 * 渲染尚未结算的真实历史。只含 AI 楼层——正文域永远不含用户楼层，
 * 用户楼层的唯一职责是承载召回码（见 extractAgentRecallCodesFromChat_ACU）。
 * 该区间不做任何截断：结算子代理必须看到全部未结算正文，否则水位推进会吞掉未处理的楼层。
 * @param context 解析上下文
 * @returns 逐楼文本；无未结算楼层时如实标注
 */
export function renderAgentUnsettledHistory_ACU(context: AgentResolveContext_ACU): string {
  const start = context.settledThroughIndex + 1;
  const lines: string[] = [];
  for (let index = start; index < context.chat.length; index += 1) {
    const message = context.chat[index];
    if (!message || message.is_user) continue;
    const text = messageText_ACU(message, context.contextRules);
    if (text) lines.push(`【楼层 ${index}】\n${text}`);
  }
  return lines.length ? lines.join('\n\n') : '没有尚未结算的真实历史；上一轮已结算到当前最后一楼。';
}

/**
 * 拼装世界书关键词命中的扫描文本：本轮目标 + 未结算正文 + 尾部全文楼层 + 用户初始要求。
 * 主循环与子代理运行时共用，保证命中提示在两侧口径一致。
 * @param context 解析上下文
 * @returns 扫描文本
 */
export function buildAgentWorldbookScanText_ACU(context: AgentResolveContext_ACU): string {
  return [
    context.originInstruction,
    context.execution.turn?.goal ?? '',
    renderAgentUnsettledHistory_ACU(context),
    renderAgentStoryTail_ACU(context),
  ].filter(Boolean).join('\n');
}

/** 四档节奏标签的语义与写作指导。低压轮的约束写成禁令，否则模型会习惯性地往每一轮里塞冲突。 */
const TURN_PACING_GUIDANCE_ACU: Record<StageTurnPacing_ACU, string> = {
  setup: '铺垫日常轮：允许主线 hold，通过具体生活动作与人物互动，让关系、习惯、世界理解、资源、身体或认知发生可观察变化；没有必须立即处理的危机时，可隔夜、数日后或更久开始。本轮禁止制造新危机、引入新敌对方或让局势升级，允许安静闭合或留下普通生活期待。',
  pressure: '冲突推进轮：外部压力上升，危机、对抗或追逼向前推进一步。本轮只推进一个冲突，不要同时开新战线。',
  turn: '转折揭示轮：反转、信息揭露或伏笔回收。揭示要落在已经埋过的东西上，不要临时造一个真相。',
  cooldown: '余波消化轮：允许主线 hold，完整处理上一波的伤势、代价、情绪与关系变化；可让恢复所需的一夜或数日自然流逝。本轮禁止制造新危机，让后果被真正看见，并允许安静闭合。',
};

/**
 * 渲染某一轮的节奏指导。
 * @param pacing 轮次节奏标签；无可执行轮次时传 null
 * @returns 标签名与对应的写作指导
 */
export function renderAgentTurnPacingGuidance_ACU(pacing: StageTurnPacing_ACU | null): string {
  if (!pacing) return '本轮节奏：尚无可执行的大纲轮次，节奏待大纲创建或继续后确定。';
  return `本轮节奏：${pacing}。${TURN_PACING_GUIDANCE_ACU[pacing]}`;
}

const TURN_FUNCTION_LABELS_ACU: Record<NonNullable<StageTurn_ACU['function']>, string> = {
  daily_bond: '关系日常',
  daily_world: '世界日常',
  recovery: '恢复余波',
  preparation: '准备',
  training: '训练/成长',
  economy: '经营',
  side_thread: '支线',
  conflict: '冲突',
  reveal: '揭示',
  payoff: '兑现',
  transition: '过渡',
};

const TURN_MAINLINE_LABELS_ACU: Record<NonNullable<StageTurn_ACU['mainlineDelta']>, string> = {
  hold: '主线停驻',
  micro: '主线微推进',
  step: '主线前进一步',
  milestone: '主线里程碑',
};

const TURN_TIME_LABELS_ACU: Record<NonNullable<StageTurn_ACU['timeAdvance']>, string> = {
  continuous: '紧接上一轮',
  same_day: '同日稍后',
  overnight: '隔夜',
  days: '数日后',
  weeks: '数周后',
  months: '数月后',
  years: '数年后',
};

const LONG_TIME_ADVANCES_ACU: ReadonlySet<string> = new Set(['days', 'weeks', 'months', 'years']);

/**
 * 渲染本轮的完整四维标记与由此触发的义务：pacing 指导 + 叙事功能 / 主线增量 / 时间关系 / 时间锚。
 * 时间跨度较大时把 V26 的时间跳跃义务直接写在这里，主 Agent 不必再去大纲窗口的箭头行比对。
 * 系统补全的字段单独点名，避免把推断值当成作者意图。
 * @param turn 当前轮次；无可执行轮次时传 null
 */
export function renderAgentTurnGuidance_ACU(turn: StageTurn_ACU | null): string {
  if (!turn) return renderAgentTurnPacingGuidance_ACU(null);
  const lines = [renderAgentTurnPacingGuidance_ACU(turn.pacing)];
  const marks: string[] = [];
  if (turn.function) marks.push(`叙事功能=${turn.function}（${TURN_FUNCTION_LABELS_ACU[turn.function]}）`);
  if (turn.mainlineDelta) marks.push(`主线增量=${turn.mainlineDelta}（${TURN_MAINLINE_LABELS_ACU[turn.mainlineDelta]}）`);
  if (turn.timeAdvance) marks.push(`时间关系=${turn.timeAdvance}（${TURN_TIME_LABELS_ACU[turn.timeAdvance]}）`);
  if (turn.timeAnchor) marks.push(`时间锚=${turn.timeAnchor}`);
  if (marks.length) lines.push(`本轮标记：${marks.join('；')}。`);
  if (turn.inferred?.length) {
    lines.push(`注意：${turn.inferred.join('、')} 是系统按节奏档保守补全的推断值，不是大纲作者的明确意图；与正文实际情况冲突时以正文为准。`);
  }
  if (turn.timeAdvance && LONG_TIME_ADVANCES_ACU.has(turn.timeAdvance)) {
    lines.push('时间跳跃义务：本轮计划跨越较长故事时间，finalize 的 instruction 必须写明新的相对时间锚、至少两项可感知变化（季节天气、身体伤势、衣着环境、关系熟悉度、资源经营、社会状态等），以及上一紧迫问题为何允许被跨过的连续性桥梁；不得用摘要跳过此前已承诺的关键场景。先 read $CHRONOLOGY 核对累计时间。');
  }
  if (turn.mainlineDelta === 'hold') {
    lines.push('本轮主线允许停驻：不推进核心矛盾、不揭示重大情报、不制造敌方动作，但必须有一项可观察的非危机变化。');
  }
  return lines.join('\n');
}

/**
 * 渲染当前大纲窗口：本阶段目标、当前节点与本节点全部轮次目标。
 * 大纲缺失或当前阶段已完成时如实说明状态，并指出必须先派工大纲子代理。
 * @param context 解析上下文
 * @returns 自然语言文本
 */
function renderTurnSemanticMeta_ACU(turn: StageTurn_ACU): string {
  const parts = [
    `pacing=${turn.pacing}`,
    `function=${turn.function ?? '未标注'}`,
    `mainline=${turn.mainlineDelta ?? '未标注'}`,
    `time=${turn.timeAdvance ?? '未标注'}`,
  ];
  if (turn.timeAnchor) parts.push(`anchor=${turn.timeAnchor}`);
  if (turn.inferred?.length) parts.push(`系统补全=${turn.inferred.join(',')}`);
  return parts.join('｜');
}

export function renderAgentOutlineWindow_ACU(context: AgentResolveContext_ACU): string {
  const { execution } = context;
  if (!execution.stage) {
    return '当前任务还没有阶段大纲。必须先派工 outline-architect 创建首个阶段大纲，才能规划本轮；在大纲创建前 finalize 会被拒绝。';
  }
  if (execution.stage.status === 'completed') {
    return `第 ${execution.stage.stageNumber} 阶段已全部完成（共 ${execution.stage.completedTurns} 轮）。下一阶段大纲尚未创建，需要派工 outline-architect 继续大纲；在此之前 finalize 会被拒绝。`;
  }
  if (!execution.revision || !execution.node || !execution.turn) {
    return `第 ${execution.stage.stageNumber} 阶段的大纲当前不可执行（可能等待用户确认或游标无效）。本轮无法交付写作指导。`;
  }
  // 轮次与节点都带 [ID] 前缀：便于主 Agent 在委派 outline-architect 时精确引用待维护目标。
  const turns = execution.node.turns
    .map((turn, index) => `${index + 1}. [${turn.id}]（${renderTurnSemanticMeta_ACU(turn)}）${turn.goal}${turn.id === execution.turn!.id ? '  ← 本轮' : ''}`)
    .join('\n');
  return [
    `阶段 ${execution.stage.stageNumber}：${execution.revision.outline.title}`,
    `阶段目标：${execution.revision.outline.goal}`,
    `阶段节奏形态：${describeStageTempo_ACU(execution.revision.outline.tempo)}——它决定本阶段低压轮的下限，也决定下一阶段不能选什么形态。`,
    `阶段结构职责：${execution.revision.outline.role ?? '旧快照未标注'}`,
    `阶段时间目标：${execution.revision.outline.timeSpanGoal ?? '未设定'}`,
    `当前节点：[${execution.node.id}] ${execution.node.title}`,
    `节点目标：${execution.node.goal}`,
    `阶段内轮次进度：第 ${execution.turnNumber} / ${execution.revision.outline.totalTurns} 轮`,
    '本节点逐轮目标（括号内依次给出 pacing、function、mainline、time 与可选 anchor）：',
    turns,
    renderAgentTurnPacingGuidance_ACU(execution.turn.pacing),
    '注意：大纲是计划，不是已经发生的事实。',
  ].join('\n');
}

/**
 * 渲染大纲游标的一行状态，进入主 Agent 骨架的 $OUTLINE_STATE。
 * 完整大纲窗口靠 read $OUTLINE_WINDOW 调阅，骨架只保留「现在在哪」。
 * @param context 解析上下文
 * @returns 一行状态文本
 */
export function renderAgentOutlineState_ACU(context: AgentResolveContext_ACU): string {
  const { execution } = context;
  if (!execution.stage) return '大纲状态：尚无阶段大纲（须先派工 outline-architect 创建，之后才能 finalize）。';
  if (execution.stage.status === 'completed') {
    return `大纲状态：第 ${execution.stage.stageNumber} 阶段已全部完成，下一阶段大纲未创建（须派工 outline-architect 继续）。`;
  }
  if (!execution.revision || !execution.node || !execution.turn) {
    return `大纲状态：第 ${execution.stage.stageNumber} 阶段的大纲当前不可执行（可能等待确认或游标无效）。`;
  }
  return `大纲状态：第 ${execution.stage.stageNumber} 阶段「${execution.revision.outline.title}」（节奏形态 ${describeStageTempo_ACU(execution.revision.outline.tempo)}，结构职责 ${execution.revision.outline.role ?? '未标注'}），第 ${execution.turnNumber}/${execution.revision.outline.totalTurns} 轮，当前节点 [${execution.node.id}]，本轮轮次 [${execution.turn.id}]，${renderTurnSemanticMeta_ACU(execution.turn)}。完整大纲窗口用 read $OUTLINE_WINDOW 调阅。`;
}

const ROW_RANGE_PATTERN_ACU = /^(\d+)-(\d+)$/;

function parseRowRange_ACU(raw: string): AgentTableRowRange_ACU | null {
  const matched = ROW_RANGE_PATTERN_ACU.exec(raw.trim());
  if (!matched) return null;
  return { start: Number.parseInt(matched[1], 10), end: Number.parseInt(matched[2], 10) };
}

function splitIdSuffix_ACU(token: string, prefix: string): string[] | null {
  if (token === prefix) return [];
  if (!token.startsWith(`${prefix}:`)) return null;
  return token.slice(prefix.length + 1).split(/[,，]/).map(id => id.trim()).filter(Boolean);
}

function resolveTableToken_ACU(token: string, context: AgentResolveContext_ACU): { title: string; text: string } {
  const body = token.slice(AGENT_TABLE_TOKEN_PREFIX_ACU.length).trim();
  // 末段若形如 a-b 视为行区间，其余部分是表名——表名本身可能含冒号之外的任意字符。
  const lastColon = body.lastIndexOf(':');
  const rangeCandidate = lastColon >= 0 ? parseRowRange_ACU(body.slice(lastColon + 1)) : null;
  const name = rangeCandidate ? body.slice(0, lastColon).trim() : body;
  const title = rangeCandidate ? `表格「${name}」第 ${rangeCandidate.start}-${rangeCandidate.end} 行` : `表格「${name}」`;
  return { title, text: renderAgentTableByName_ACU(name, context.tableData, rangeCandidate ?? undefined) };
}

function resolveWorldbookToken_ACU(token: string, context: AgentResolveContext_ACU): { title: string; text: string } {
  const worldbook = context.worldbook ?? buildEmptyAgentWorldbookSnapshot_ACU(false);
  const body = token.slice(AGENT_WORLDBOOK_TOKEN_PREFIX_ACU.length);
  const lastColon = body.lastIndexOf(':');
  if (lastColon <= 0) {
    return { title: '世界书条目', text: '世界书读取地址不完整：写法为 $WORLDBOOK:书名:uid（逗号分隔多个 uid），地址请从世界书目录复制。' };
  }
  const bookName = body.slice(0, lastColon).trim();
  const uids = body.slice(lastColon + 1).split(/[,，]/).map(uid => uid.trim()).filter(Boolean);
  return { title: `世界书「${bookName}」条目 ${uids.join('、')}`, text: renderAgentWorldbookEntries_ACU(worldbook, bookName, uids) };
}

/**
 * 解析一个读集 token 的内容。
 *
 * 支持的地址体系（与各资料目录里给出的读取地址一一对应）：
 * - `$STORY_RANGE:a-b` 窗口内正文楼层区间；`$STORY_CATALOG` 楼层索引
 * - `$STORY_OVERVIEW` 事件概览；`$STORY_TAIL` 尾部全文楼层
 * - `$TABLE:表名` / `$TABLE:表名:a-b` 整表或行区间
 * - `$STORY_ARC[:ID,ID]` / `$HOOKS_LEDGER[:ID,ID]` / `$INFO_GAP[:ID,ID]` / `$ACTIVE_CONSTRAINTS[:ID,ID]` 模块全量或按 ID 精读
 * - `$WORLDBOOK:书名:uid[,uid]` 已启用世界书条目全文
 * - 旧固定 token（$STORY_TEXT / $OUTLINE_WINDOW 等）保留兼容
 * @param token 读集标识符
 * @param context 解析上下文
 * @returns { title, text } 分节标题与正文；未知 token 的 text 会明确说明不可读
 */
export function resolveAgentReadToken_ACU(token: string, context: AgentResolveContext_ACU): { title: string; text: string } {
  const normalized = String(token ?? '').trim();
  if (normalized.startsWith(AGENT_TABLE_TOKEN_PREFIX_ACU)) return resolveTableToken_ACU(normalized, context);
  if (normalized.startsWith(AGENT_WORLDBOOK_TOKEN_PREFIX_ACU)) return resolveWorldbookToken_ACU(normalized, context);
  if (normalized.startsWith(AGENT_STORY_RANGE_TOKEN_PREFIX_ACU)) {
    const body = normalized.slice(AGENT_STORY_RANGE_TOKEN_PREFIX_ACU.length).trim();
    const matched = /^(\d+)-(\d+)$/.exec(body);
    return {
      title: matched ? `正文楼层 ${matched[1]}-${matched[2]}` : '正文楼层区间',
      text: matched
        ? renderAgentStoryRange_ACU(context, matched[1], matched[2])
        : `楼层区间「${normalized}」不合法：写法为 $STORY_RANGE:起始楼-结束楼。可用楼层见正文目录。`,
    };
  }

  const storyArcIds = splitIdSuffix_ACU(normalized, '$STORY_ARC');
  if (storyArcIds !== null) {
    const completedStageNumbers = context.execution.task.stages
      .filter(stage => stage.status === 'completed')
      .map(stage => stage.stageNumber);
    return { title: storyArcIds.length ? `故事总纲条目 ${storyArcIds.join('、')}` : '故事总纲（全部活跃条目）', text: renderAgentStoryArcByIds_ACU(context.moduleSnapshot, storyArcIds.length ? storyArcIds : undefined, completedStageNumbers) };
  }
  const hookIds = splitIdSuffix_ACU(normalized, '$HOOKS_LEDGER');
  if (hookIds !== null) {
    return { title: hookIds.length ? `伏笔账本条目 ${hookIds.join('、')}` : '伏笔账本（全部活跃条目）', text: renderAgentHooksByIds_ACU(context.moduleSnapshot, hookIds.length ? hookIds : undefined) };
  }
  const infoGapIds = splitIdSuffix_ACU(normalized, '$INFO_GAP');
  if (infoGapIds !== null) {
    return { title: infoGapIds.length ? `信息差条目 ${infoGapIds.join('、')}` : '认知与信息差时间线（全部活跃条目）', text: renderAgentInfoGapByIds_ACU(context.moduleSnapshot, infoGapIds.length ? infoGapIds : undefined) };
  }
  const constraintIds = splitIdSuffix_ACU(normalized, '$ACTIVE_CONSTRAINTS');
  if (constraintIds !== null) {
    return { title: constraintIds.length ? `长期约束条目 ${constraintIds.join('、')}` : '长期约束（全部条目）', text: renderAgentConstraintsByIds_ACU(context.moduleSnapshot, constraintIds.length ? constraintIds : undefined) };
  }
  const chronologyIds = splitIdSuffix_ACU(normalized, '$CHRONOLOGY');
  if (chronologyIds !== null) {
    return chronologyIds.length
      ? { title: `故事年代学条目 ${chronologyIds.join('、')}`, text: renderAgentChronologyByIds_ACU(context.moduleSnapshot, chronologyIds) }
      : { title: '故事年代学账本（已发生正文结算出的时间事实）', text: renderAgentChronology_ACU(context.moduleSnapshot) };
  }
  const webRefIds = splitIdSuffix_ACU(normalized, '$WEB_REFS');
  if (webRefIds !== null) {
    return {
      title: webRefIds.length ? `百科资料库条目 ${webRefIds.join('、')}（外部参考，非本故事事实）` : '百科资料库（全部活跃条目摘要；外部参考，非本故事事实）',
      text: renderAgentWebRefsByIds_ACU(context.moduleSnapshot, webRefIds.length ? webRefIds : undefined),
    };
  }

  const title = READ_TOKEN_TITLES_ACU[normalized] ?? normalized;
  switch (normalized) {
    case '$STORY_TEXT': return { title, text: renderAgentStoryText_ACU(context) };
    case '$STORY_CATALOG': return { title, text: renderAgentStoryCatalog_ACU(context) };
    case '$STORY_OVERVIEW': return { title, text: renderAgentStoryOverview_ACU(context) };
    case '$STORY_TAIL': return { title, text: renderAgentStoryTail_ACU(context) };
    case '$HISTORY_UNSETTLED': return { title, text: renderAgentUnsettledHistory_ACU(context) };
    case '$OUTLINE_WINDOW': return { title, text: renderAgentOutlineWindow_ACU(context) };
    case '$CURRENT_TURN_GOAL': return { title, text: context.execution.turn?.goal || '（尚无可执行的大纲轮次，本轮目标待大纲创建或继续后确定）' };
    case '$CURRENT_TURN_PACING': return { title, text: renderAgentTurnGuidance_ACU(context.execution.turn ?? null) };
    case '$USER_INTENT': return { title, text: context.originInstruction || '（用户未提供初始要求）' };
    case '$TABLE_GLOBAL': return { title, text: renderAgentTableByAliases_ACU('global', context.tableData) };
    case '$TABLE_CHARACTERS': return { title, text: renderAgentTableByAliases_ACU('characters', context.tableData) };
    case '$TABLE_CHRONICLES': return { title, text: renderAgentTableByAliases_ACU('chronicles', context.tableData) };
    default: return { title, text: `占位符 ${normalized || '(空)'} 不是可读资料接口，本次没有为你提供任何内容。请从各资料目录里复制读取地址。` };
  }
}

/**
 * 把一批读集 token 渲染成一整块注入材料。
 * @param tokens 读集标识符列表
 * @param context 解析上下文
 * @returns 分节材料文本；读集为空时如实标注
 */
export function renderAgentReadMaterials_ACU(tokens: readonly string[], context: AgentResolveContext_ACU): string {
  const unique = [...new Set(tokens.map(token => String(token ?? '').trim()).filter(Boolean))];
  if (!unique.length) return '本次没有为你注入任何资料。你只能基于任务描述作答，缺少的信息必须标注「信息不足」。';
  return unique
    .map(token => { const resolved = resolveAgentReadToken_ACU(token, context); return `### ${resolved.title}（${token}）\n${resolved.text}`; })
    .join('\n\n');
}
