/**
 * service/continuation/agent/agent-catalog.ts — 子代理能力目录与资料模块目录
 *
 * 主 Agent 只看到摘要：代理能做什么、何时该用、职责固定写什么。
 * 读集不再有授权概念——所有资料域对主/子代理开放，读多少由 token 门禁管，
 * 因此定义里没有 allowedReads/allowedWrites；写入范围由职责（kind）固定推得。
 * 子代理的完整系统提示词不暴露给主 Agent，避免主 Agent 被无关细节淹没。
 */

import { AGENT_FINAL_REVIEWER_NAME_ACU, AGENT_OUTLINE_AGENT_NAME_ACU, type AgentSubagentKind_ACU, type AgentSubagentName_ACU } from './agent-model';

export interface AgentSubagentDefinition_ACU {
  name: AgentSubagentName_ACU;
  kind: AgentSubagentKind_ACU;
  description: string;
  triggers: string[];
  promptKey: 'arcArchitect' | 'maintainer' | 'mainlinePlanner' | 'beatPlanner' | 'reviewer';
}

export interface AgentModuleDefinition_ACU {
  token: string;
  description: string;
  triggers: string[];
  writableBy: AgentSubagentName_ACU[];
}

/**
 * 终审只允许由 finalize 前的受控运行时入口调用，绝不能出现在主 Agent 的 delegate 目录中。
 */
export const AGENT_FINAL_REVIEWER_DEFINITION_ACU = {
  name: AGENT_FINAL_REVIEWER_NAME_ACU,
  kind: 'review' as const,
  description: '发送前最终审查：核对人物情绪、世界书证据和逻辑边界，只读不写',
  promptKey: 'finalReviewer' as const,
};

export const AGENT_SUBAGENT_DEFINITIONS_ACU: readonly AgentSubagentDefinition_ACU[] = [
  {
    name: 'arc-architect',
    kind: 'arc',
    description: '维护故事总纲：全书方向、卷级台阶（每卷推到什么高度、收在哪）、禁止提前翻的底牌，以及各卷已由哪些阶段承载的进度',
    triggers: ['总纲状态显示「还没有故事总纲」时必须先派它', '一个阶段完成后回写进度、必要时把下一卷切成 active', '真实剧情已明显偏离既定方向、需要修订台阶时', '底牌被正文提前翻开、总纲的禁翻清单需要更新时', '当前卷的目标已实际收束或明显提前/推迟，台阶划分需要调整时'],
    promptKey: 'arcArchitect',
  },
  {
    name: 'hook-cognition-maintainer',
    kind: 'maintain',
    description: '结算已经发生的正文：维护伏笔账本、认知信息差时间线与故事年代学账本，只登记真实历史里已实际发生的变化',
    triggers: ['存在尚未结算的真实历史', '新正文出现异常线索、秘密、反常细节', '已有伏笔被再次触碰', '某个角色的知晓状态发生变化', '正文实际发生了跨夜、数日或更久的时间流逝'],
    promptKey: 'maintainer',
  },
  {
    name: 'mainline-planner',
    kind: 'plan',
    description: '按本轮 pacing 策划场景：pressure/turn 给冲突阶梯、主角选择与实质价值变动；setup/cooldown 给具体生活动作、人物互动与非危机变化，允许主线 hold。输出叙事功能、主线增量与时间关系建议，不写正文、不改资料',
    triggers: ['每轮都需要本轮场景策划建议（派工时写明 pacing）', 'pressure/turn 轮需要冲突升级或价值转移方案', 'setup/cooldown 轮需要具体的日常、恢复或经营内容而非空泛判词'],
    promptKey: 'mainlinePlanner',
  },
  {
    name: 'beat-planner',
    kind: 'plan',
    description: '策划本轮伏笔操作与情绪节拍：给出埋设、强化、误导、回收的具体手法、信息差走到哪一步与收尾方式建议；低压轮允许无操作、安静闭合，不写正文、不改资料',
    triggers: ['本轮计划操作伏笔', '本轮信息差需要设置、使用或揭示（揭示后允许结束，不强制补新谜团）', '情绪节拍需要承接上轮残留'],
    promptKey: 'beatPlanner',
  },
  {
    name: 'continuity-reviewer',
    kind: 'review',
    description: '审查策划结果的连续性与约束合规：输出 pass / revise / block 判词，只读不写',
    triggers: ['策划结果之间存在冲突', '本轮触碰长期约束红线', '大阶段转折或伏笔密集轮次'],
    promptKey: 'reviewer',
  },
];

export const AGENT_MODULE_DEFINITIONS_ACU: readonly AgentModuleDefinition_ACU[] = [
  {
    token: '$STORY_ARC',
    description: '故事总纲：全书方向（唯一一条）与卷级台阶。卷台阶包含结构职责、阶段容量、故事时间、主线进度上限、持续经营线、兑现目标、收束状态与真实阶段进度',
    triggers: ['排新阶段大纲前确认本阶段该落在哪一级台阶上', '判断某张底牌本阶段能不能翻', '一个阶段完成后回写进度'],
    writableBy: ['arc-architect'],
  },
  {
    token: '$HOOKS_LEDGER',
    description: '伏笔账本：已进入真实正文的伏笔及其生命周期状态（埋设/强化/误导/部分回收/回收/放弃）、埋设楼层与重要度',
    triggers: ['正文触碰异常线索', '本轮计划强化、误导或回收伏笔', '判断某条悬念是否已经欠账太久'],
    writableBy: ['hook-cognition-maintainer'],
  },
  {
    token: '$INFO_GAP',
    description: '认知与信息差时间线：客观事实、读者已知、各角色知晓状态与揭示进度',
    triggers: ['设计局部信息揭露', '判断某个角色此刻是否该知道某件事', '避免提前揭穿幕后'],
    writableBy: ['hook-cognition-maintainer'],
  },
  {
    token: '$ACTIVE_CONSTRAINTS',
    description: '长期约束：契约红线、禁止提前释放的底牌、已知连贯性风险。子代理只能提议，由主 Agent 裁决后登记',
    triggers: ['本轮动作可能越过既定红线', '需要确认哪些底牌本轮不能翻'],
    writableBy: [],
  },
  {
    token: '$CHRONOLOGY',
    description: '故事年代学账本：已发生正文结算出的故事时间事实——当前相对时间锚、自故事起点累计经过时间、精度（exact/approximate/unknown）、每次时间转换及其正文证据楼层。大纲里的时间字段是计划，不在此账本内',
    triggers: ['规划或审查跨夜、数日、数周及更久的时间跳跃', '核对伤势恢复、训练/生产周期、旅行耗时、季节天气与关系熟悉度是否与累计时间相容', '最终指导需要给出可靠的相对时间锚'],
    writableBy: ['hook-cognition-maintainer'],
  },
];

/** 子代理目录里的类型中文名。 */
const KIND_DISPLAY_LABELS_ACU: Record<AgentSubagentKind_ACU, string> = {
  arc: '总纲',
  maintain: '结算维护',
  plan: '策划',
  review: '审查',
};

/** 按职责固定的写入说明，进子代理目录的「写入」行。 */
const KIND_WRITE_LABELS_ACU: Record<AgentSubagentKind_ACU, string> = {
  arc: '$STORY_ARC（职责固定；不碰伏笔、信息差与约束）',
  maintain: '$HOOKS_LEDGER、$INFO_GAP、$CHRONOLOGY（职责固定；约束只能提议，由主 Agent 裁决登记）',
  plan: '无（只返回建议）',
  review: '无（只返回判词）',
};

/**
 * 大纲子代理的目录块。它不走通用子代理运行时：运行时会按任务状态自动推断
 * 创建 / 维护 / 继续三种操作，并用独立的大纲提示词与既有资料完成生成与校验，
 * 因此这里手写描述而不进入 AGENT_SUBAGENT_DEFINITIONS_ACU。
 */
const OUTLINE_AGENT_CATALOG_BLOCK_ACU = [
  `- name: ${AGENT_OUTLINE_AGENT_NAME_ACU}`,
  '  类型: 大纲',
  '  职责: 管理阶段大纲的完整生命周期——创建（当前没有任何大纲时）、维护（大纲与真实剧情脱节、需要改写剩余部分时）、继续（当前阶段已全部完成、需要下一阶段时）。具体做哪种操作由运行时按任务状态自动判断，你只需给出要求。',
  '  适用时机: 大纲状态显示「还没有阶段大纲」时必须先派它；真实剧情已经明显偏离大纲计划时派它改写；大纲状态显示「阶段已全部完成」时派它继续。',
  '  读取: 无需指定读集（运行时自动注入故事背景、事件概览、尾部正文、阶段历史与故事总纲）',
  '  写入: 阶段大纲（产出经严格 schema 校验后落盘；改写时已完成的轮次受保护，不会被改掉）',
  '  执行方式: 串行执行且先于同波次其他派工；计入派工预算；prompt 写清你对大纲的要求（走向、节奏、要保留或回收什么）。',
].join('\n');

/**
 * 渲染子代理能力目录。
 * @returns 主 Agent 可见的摘要文本，不含子代理内部提示词
 */
export function renderAgentSubagentCatalog_ACU(): string {
  const blocks = AGENT_SUBAGENT_DEFINITIONS_ACU.map(definition => [
    `- name: ${definition.name}`,
    `  类型: ${KIND_DISPLAY_LABELS_ACU[definition.kind]}`,
    `  职责: ${definition.description}`,
    `  适用时机: ${definition.triggers.join('；')}`,
    '  读取: 全部资料域开放；派工时用 reads 给出种子地址，它还能自己 read/search 补充调阅',
    `  写入: ${KIND_WRITE_LABELS_ACU[definition.kind]}`,
  ].join('\n'));
  return [OUTLINE_AGENT_CATALOG_BLOCK_ACU, ...blocks].join('\n');
}

/**
 * 渲染资料模块目录。
 * @returns 主 Agent 可见的模块摘要文本，只说模块是什么、何时用、谁能写
 */
export function renderAgentModuleCatalog_ACU(): string {
  const blocks = AGENT_MODULE_DEFINITIONS_ACU.map(definition => [
    `- 占位符: ${definition.token}`,
    `  内容: ${definition.description}`,
    `  适用时机: ${definition.triggers.join('；')}`,
    `  可写代理: ${definition.writableBy.length ? definition.writableBy.join('、') : '仅主 Agent 裁决后登记'}`,
  ].join('\n'));
  return blocks.join('\n');
}

/**
 * 渲染读集地址词汇表：read / search 工具能用的全部地址体系。
 * 主 Agent 与子代理共用同一份（$AGENT_READ_CATALOG），保证派工 reads 里写的地址
 * 子代理一定解析得了。各资料的具体可用地址以对应目录（正文/表格/世界书）为准。
 * @returns 词汇表文本
 */
export function renderAgentReadCatalog_ACU(): string {
  return [
    'read 工具的地址体系（reads 数组里可混用多种地址，一次批量取数）：',
    '- $STORY_RANGE:起始楼-结束楼：可读窗口内的 AI 正文楼层区间，逐楼全文。可用楼层与窗口范围见正文目录。',
    '- $TABLE:表名 / $TABLE:表名:起始行-结束行：整表或行区间。可用表名与行数见表格目录。',
    '- $STORY_ARC / $STORY_ARC:ID,ID：故事总纲全部活跃条目（全书方向与卷台阶），或按 ID 精读（含已废止条目）。',
    '- $HOOKS_LEDGER / $HOOKS_LEDGER:ID,ID：伏笔账本全部活跃条目，或按 ID 精读（含已退休条目）。',
    '- $INFO_GAP / $INFO_GAP:ID,ID：认知与信息差时间线全部活跃条目，或按 ID 精读。',
    '- $ACTIVE_CONSTRAINTS / $ACTIVE_CONSTRAINTS:ID,ID：长期约束全部条目，或按 ID 精读。',
    '- $CHRONOLOGY / $CHRONOLOGY:ID,ID：故事年代学账本（已发生正文结算出的时间锚、累计经过时间与转换证据），或按 ID 精读（含已作废条目）。',
    '- $WORLDBOOK:书名:uid,uid：已启用世界书条目全文。地址从世界书目录复制，条目行尾标注了 token 数便于估算预算。',
    '- $STORY_CATALOG / $STORY_OVERVIEW / $STORY_TAIL / $OUTLINE_WINDOW / $HISTORY_UNSETTLED：楼层索引、事件概览、尾部正文全文、完整大纲窗口、未结算正文全量。',
    '- 早期剧情的详细纪要在纪要表里：$TABLE:纪要表:起始行-结束行 按行区间精读（行号见事件概览与表格目录）。',
    'search 工具：{"action":"search","query":"关键词或正则","scope":["story","tables","modules","outline","worldbook"],"isRegex":false,"maxResults":30}。',
    '命中行会带上可直接复制进 read 的地址；先 search 定位、再用窄地址精读，比整读省预算。',
  ].join('\n');
}

/**
 * 按名称查子代理定义。
 * @param name 代理名
 * @returns 命中的定义；未知代理返回 null
 */
export function findAgentSubagentDefinition_ACU(name: string): AgentSubagentDefinition_ACU | null {
  return AGENT_SUBAGENT_DEFINITIONS_ACU.find(definition => definition.name === name) ?? null;
}
