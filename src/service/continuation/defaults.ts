import { CONTINUATION_AGENT_API_PRESET_ROLES_ACU, ContinuationValidationError_ACU, createContinuationError_ACU, type ContinuationAgentApiPresets_ACU, type ContinuationPromptSegment_ACU, type ContinuationSettings_ACU, type ContinuationStageSize_ACU, type ContinuationTurnRange_ACU } from './model';
import { buildDefaultContinuationAgentPrompts_ACU } from './agent/agent-defaults';
import {
  AGENT_HISTORY_TOKEN_BUDGET_DEFAULT_ACU,
  AGENT_READ_FALLBACK_TOKENS_DEFAULT_ACU,
  AGENT_READ_TOKEN_BUDGET_DEFAULT_ACU,
  AGENT_STORY_TAIL_FLOORS_DEFAULT_ACU,
  AGENT_STORY_WINDOW_DEFAULT_ACU,
  DEFAULT_AGENT_RUN_BUDGET_ACU,
} from './agent/agent-model';

/** 酒馆正文短于该 token 数视为截断或出错，触发与报错同构的自动重试。0 表示关闭。 */
export const CONTINUATION_MIN_GENERATION_TOKENS_DEFAULT_ACU = 1000;

export const CONTINUATION_TURN_RANGES_ACU: Readonly<Record<Exclude<ContinuationStageSize_ACU, 'custom'>, ContinuationTurnRange_ACU>> = {
  short: { min: 3, max: 5 },
  standard: { min: 6, max: 10 },
  long: { min: 11, max: 20 },
};

/** V23 默认节奏段原文。V24 迁移只在该段完全未改写时追加长篇日常契约。 */
export const V23_DEFAULT_OUTLINE_PACING_SEGMENT_ACU = '【节奏：先定阶段形态，再排每轮松紧】\n\n第一步，用 <stage_tempo> 定这个阶段整体是什么形态。四档：\n- buildup 铺垫型：低压为主，攒关系、攒信息、攒资源，为后面的爆发蓄力。本阶段低压轮至少占一半。\n- mixed 起伏型：常规推进，松紧交替。本阶段低压轮至少占四分之一。\n- surge 高压型：决战、逃亡、连环变故这类一口气压到底的段落。允许整个阶段一轮低压都没有。\n- aftermath 余波型：消化上一段高压的代价，疗伤、复盘、关系重建、局势重新洗牌。本阶段低压轮至少占六成。\n选哪一档取决于总纲里本卷台阶推进到了哪一步，以及前面刚写完的是什么——当前节奏状态见下方的「节奏状态」段。\n\n第二步，给每个 <turn> 标 pacing 四档之一：\n- setup 铺垫日常：关系推进、生活场景、准备工作、信息沉淀。没有外部危机，价值体现在人物关系变化、读者对角色的理解加深、或为后续埋线。\n- pressure 冲突推进：危机、对抗、外部高压。主角被逼做出选择并付出代价。\n- turn 转折揭示：反转、信息揭露、伏笔回收。局势的性质在这一轮发生改变。\n- cooldown 余波消化：战后疗伤、复盘、情绪落地、关系在事件之后的重新校准。\n\n硬性要求（不满足会被系统打回重排）：\n1. 本阶段低压轮（setup + cooldown）的数量不得低于该形态对应的下限。\n2. 上一阶段是 surge 时，本阶段不能再选 surge，只能选 aftermath 或 mixed。\n3. 连续高压轮（pressure + turn）不得超过给定的上限，该计数跨阶段累计——前一阶段结尾连着三轮高压，本阶段开头就只剩上限减三轮的余量。surge 阶段豁免这一条。\n\n关键：低压轮放在哪里由你决定，不要均匀分散。\n把低压轮每隔三四轮撒一个，读者会感觉到一台节拍器，那比全程高压更假。真实的节奏是波浪：可以开头连着两轮日常把人物关系立住，然后连着四轮高压一口气推到底；也可以前面一路紧绷，最后两轮全用来收拾残局。同一份大纲里，「日常日常高压高压高压高压」和「高压高压高压高压日常日常」是完全不同的两段故事，但它们的低压轮数量一样——你要选的是哪一种叙事，而不是凑够数量。\n\n为什么需要低压轮：读者对紧张的感知是相对的。连续八轮全是危机，第八轮的危机读起来和第一轮一样甚至更钝；前面有一段安静，后面那场危机才重新有分量。同理，重大冲突之后不给余波，人物的代价就没有落点。低压轮不是浪费篇幅，它是让高压轮生效的前提。\nsetup 与 cooldown 轮同样要写具体：写清谁和谁在什么场景做什么、这一轮之后他们之间有什么变化，不要写「日常互动」「气氛缓和」这种空话。';

/** V24 长篇日常契约：给低压轮独立的正向义务，并显式要求规划故事时间。 */
export const V24_OUTLINE_LONGFORM_PACING_CONTRACT_ACU = '【真正日常、主线停驻与故事时间】\n真正日常不是“危机暂时没发生”，而是角色在世界中持续生活。setup 轮至少承担一种独立功能：关系日常（共同生活与相处模式变化）、世界日常（饮食、职业、交通、制度、节庆或交易）、成长日常（训练、学习、劳动或恢复产生积累）、经营日常（资源、生产与消费发生变化）、支线日常（暂不引爆主线但以后会反作用于主线）、时间过渡（让一夜、数日或数周合理流逝）。\n\n战前讨论、等待下一次行动、采购武器或突然发现敌情仍是冲突链的附属间隙，不能冒充真正日常。setup 与 cooldown 允许主线保持不动：不推进核心矛盾、不揭示重大情报、不制造敌方动作，这不是失败；但必须通过具体场景动作与人物互动，让关系、生活状态、世界理解、资源积累、身体恢复或人物认知至少发生一项可观察变化。\n\n连续发生不再是默认答案。规划每轮时必须判断它与上一轮是紧接、同日稍后、隔夜、数日后还是更久；没有必须立即处理的危机时，应主动考虑让故事时间自然流逝。若 buildup 或 aftermath 阶段所有轮都挤在同一天，轮目标必须说明为何不能跨夜或跨日。发生时间跳跃时，在目标里写清新的相对时间锚，并点出环境、身体、关系、资源或社会状态中的两项可感知变化。\n\n低压轮的完成标准是“场景动作 + 人物互动 + 状态变化”，不是流水账；允许安静闭合或留下普通生活期待，不强制制造危机钩子。';

const DEFAULT_OUTLINE_PROMPT_ACU: readonly ContinuationPromptSegment_ACU[] = [
  {
    role: 'system',
    content: '你是专业的小说阶段规划助手。负责根据故事背景与历史进展，为下一阶段规划剧情大纲。\n输出格式：把大纲内容写入下列标签，标签外可以自由书写你的思路与分析，系统只读取标签内的内容。\n<stage_title>阶段标题</stage_title>\n<stage_goal>阶段整体目标</stage_goal>\n<stage_tempo>本阶段节奏形态，取值只能是 buildup / mixed / surge / aftermath 之一，含义见节奏条款</stage_tempo>\n<stage_role>阶段结构职责，取值只能是 setup / development / escalation / turn / payoff / aftermath 之一</stage_role>\n<stage_time_span>可选：本阶段预计覆盖的故事内部时间</stage_time_span>\n<node>\n<node_title>节点标题</node_title>\n<node_goal>节点目标</node_goal>\n<turn pacing="setup" function="daily_bond" mainline="hold" time="days" anchor="入城后的第七天">本轮剧情目标（每轮一个 turn 标签，内容为该轮要发生的具体剧情）</turn>\n</node>\n每个 <turn> 都必须带四个核心属性：pacing 只能是 setup / pressure / turn / cooldown；function 只能是 daily_bond / daily_world / recovery / preparation / training / economy / side_thread / conflict / reveal / payoff / transition；mainline 只能是 hold / micro / step / milestone；time 只能是 continuous / same_day / overnight / days / weeks / months / years。time 为 weeks / months / years 时还必须提供非空 anchor。\n节点数量不限，每个 <node> 内至少一个 <turn>；全部 <turn> 的总数就是本阶段的轮数，必须落在给定的阶段轮数范围内。\n不要输出 JSON，不要输出 id、编号或轮数统计字段——结构编号全部由系统自动生成。',
    enabled: true,
    deletable: true,
  },
  {
    role: 'assistant',
    content: '收到。我会把阶段标题、目标、节奏形态、结构职责和可选时间目标分别写入 <stage_title>、<stage_goal>、<stage_tempo>、<stage_role>、<stage_time_span>，并在每个 <turn> 上完整标注 pacing、function、mainline、time 与必要的 anchor。标签外只写思路分析，不输出 JSON、id 或编号统计字段，并保证全部 <turn> 总数落在给定轮数范围内。',
    enabled: true,
    deletable: true,
  },
  {
    role: 'user',
    content: '【阶段容量：先算清楚这个阶段装得下什么】\n$STAGE_WORD_BUDGET\n\n一个阶段只够讲完一件事的起承转合，不是一段旅程。判断标准很简单：把这个阶段的所有轮目标连起来读，如果它像一部电影的梗概，那就是超载；它应该像一场戏的分镜。\n典型超载反例（禁止照此规划）：一个 8 轮阶段里同时安排「路上遇袭 → 抵达城池 → 赴宴周旋 → 深夜密谈 → 潜入调查 → 追踪可疑者 → 落入陷阱 → 被人所救」。这是三个阶段的量：遇袭与抵达是一个阶段，赴宴与密谈是一个阶段，夜查、追踪、陷阱与获救是一个阶段。硬塞进 8 轮的结果是每轮变成流水账提要，正文模型只能用一千字草草带过一整场戏。\n判断超载时宁可少装：阶段目标定小一点、写深一点，比塞满了写浅要好。剩下的内容会有下一个阶段承接，不会丢。',
    enabled: true,
    deletable: true,
  },
  {
    role: 'user',
    content: V23_DEFAULT_OUTLINE_PACING_SEGMENT_ACU,
    enabled: true,
    deletable: true,
  },
  {
    role: 'user',
    content: V24_OUTLINE_LONGFORM_PACING_CONTRACT_ACU,
    enabled: true,
    deletable: true,
  },
  {
    role: 'user',
    content: '【大纲方法论与强约束】：\n1. 节奏与阶段分摊：严禁在前半卷或当前阶段将主线矛盾“一次性打穿”。早期阶段仅做铺垫或启动，中段必须让风险升级并出现反转/误导，只有高潮阶段才允许收束本卷目标，且必须保留更高层冲突。\n2. 冲突与障碍递进：整个阶段的 pressure / turn 轮连起来看，障碍必须逐步升高，不要让主角应对同一层次的阻碍“换皮重复”；节点 goal 要体现这条递进线。这条要求作用在冲突线上，不要求每一轮都升级——setup 与 cooldown 轮本来就不承载障碍。\n3. 情绪弧线与伏笔操作显式化：注意情绪微弧线的建立，主角面对不利转折必须源于外部高压而非自身降智；压抑后必有加倍反击。涉及伏笔的轮目标要写明本轮做哪种操作（埋设/强化/误导/回收）及操作对象，不要只写“推进伏笔”这类模糊表述。\n4. 动态信息差与悬念：在节点与轮目标中设计局部信息揭露，写明本轮允许揭示到哪一层（需体现开局→中段→结尾的动态变化），并在阶段末留下跨阶段悬念（钩子）。\n5. 实体一致性白名单：参与实体只能从上下文已知角色或场景中选取，绝对禁止凭空自创、捏造新人物或核心组织。动作主体必须明确。\n6. 拒绝空泛与AI味：每个目标都必须落到具体的动作与具体的变化上，禁止使用“大战一触即发”、“深化羁绊”等抽象判词。pressure 与 turn 轮要具备“行动、阻碍、悬念”三要素，并带来地位、资源、情报或关系上的实质改变；setup 与 cooldown 轮不需要外部阻碍，它们的价值体现在关系变化、信息沉淀与情绪落地——但同样要写清具体是什么变化，不能用空话交差。\n7. 轮承载量硬约束：正文模型每轮只输出约 800-1200 字。每个 <turn> 只承载一个场景片段、至多两个情节节拍，写得下“一次冲突 + 一个变化 + 一个钩子”即为满载；严禁把多个场景、多次转折或跨地点的大事件塞进同一轮——装不下的内容拆成多轮，多到一个阶段装不下就留给下一个阶段。',
    enabled: true,
    deletable: true,
  },
  {
    role: 'assistant',
    content: '我已深入理解小说大纲的方法论。在规划每个节点（node）和轮次（turn）的目标时，我会：\n1. 先按阶段容量与【活动卷规划上下文】算清楚本阶段只承载当前 active 卷尚未完成的一段，宁可把阶段目标定小写深，也不把一段旅程压进一个阶段；\n2. 先按总纲台阶与当前节奏状态定 <stage_tempo>，再按该形态的下限安排低压轮——低压轮按叙事需要成段安放，不平均分散成节拍器；\n3. 严格控制节奏分摊，前半段主做铺垫与中点反转，保留底牌，不强行完结主线；\n4. 在 pressure / turn 轮落实“行动、阻碍、悬念”三要素并让冲突线逐级升高；setup / cooldown 轮写具体的关系变化、信息沉淀与情绪落地，不写空话也不硬造危机；\n5. 设计明显的情绪曲线（压抑后必有释放），涉及伏笔的轮目标写明操作种类与对象，信息揭露写明允许揭到哪一层；\n6. 遵守实体白名单，严格从提供的上下文中调用角色与实体，绝不自创幻觉；\n7. 尊重轮承载量：每轮只装一个场景片段、至多两个节拍，绝不把正文模型 800-1200 字写不完的内容塞进一轮；\n8. 让阶段目标只承载故事总纲当前 active 卷尚未完成的一段，不触碰总纲里标注为禁止提前释放的底牌；单个阶段结束只留下跨阶段悬念，不擅自收束整卷。只有活动卷规划上下文显示卷级收束条件已被真实完成阶段满足时，才交由 arc-architect 切卷；所有既有卷完成时先扩充后续 active 卷。\n我会将这些原则落实到各个标签的内容中。',
    enabled: true,
    deletable: true,
  },
  {
    role: 'user',
    content: '初始要求：\n$ORIGIN_INSTRUCTION\n\n【故事总纲】（本阶段必须落在当前 active 卷的台阶之内；标注为禁止提前释放的底牌，本阶段一律不许翻）：\n$STORY_ARC\n\n【节奏状态】（决定本阶段能选哪些形态、开头还剩多少高压余量）：\n$PACING_CONTEXT\n\n阶段轮数范围：\n$TURN_RANGE\n\n当前任务阶段历史：\n$STAGE_HISTORY\n\n当前阶段已完成的部分（仅供衔接参考，严禁在标签中重新输出这些内容，只规划其后的剩余轮次）：\n$COMPLETED_STAGE_PART\n\n重规划补充要求：\n$REPLAN_INSTRUCTION\n\n剩余轮数参考（可按剧情需要增减，只需保证全阶段总轮数在范围内）：\n$REMAINING_TURNS\n\n相关世界书背景：\n$1\n\n【事件概览】（纪要表逐轮概览，命中召回码的轮已展开为纪要全文；概览按轮记录、与楼层无一一映射）：\n$STORY_OVERVIEW\n\n【最近正文】（尾部全文楼层，只含 AI 正文）：\n$STORY_TAIL\n\n上次校验错误：\n$VALIDATION_ERRORS\n\n请严格基于上述上下文，规划当前阶段的后续剧情大纲，并按规定标签输出。',
    enabled: true,
    deletable: true,
  },
];

export const CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_ACU = 'spv1.0-continuation-prompt-pseudo-role-v2';
export const CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V7_ACU = 'spv1.5-continuation-prompt-pseudo-role-v7';
/** Agent 续写链路上线版本。旧版本一律强制刷新为 Agent 提示词组。 */
export const CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V8_ACU = 'spv1.6-continuation-agent-prompt-v8';
/** 大纲标签化版本：大纲提示词改为标签口径并移除 JSON 预填充。旧版本一律强制刷新。 */
export const CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V9_ACU = 'spv1.7-continuation-outline-tags-v9';
/**
 * Agent 会话化版本：正文改由 $STORY_TEXT 独立摘取，$HISTORY_ANCHOR 承载主 Agent 自己的会话，
 * $TOOL_RESULTS 退役。旧提示词描述的上下文排布与运行时不再一致，必须强制刷新。
 */
export const CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V10_ACU = 'spv1.8-continuation-agent-conversation-v10';
/**
 * Agent 工具化版本：固定资料注入改为目录+状态骨架，主/子代理获得 read/search 工具与 token 门禁，
 * needMore 与读写授权退役。旧提示词描述的协议与运行时不再一致，必须强制刷新。
 */
export const CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V11_ACU = 'spv1.9-continuation-agent-tools-v11';
/**
 * 精简轮次版本：大纲轮承载量硬约束（单轮 1000-1500 字）、finalize 紧凑字段化骨架、
 * 长期约束改增量登记（add/retire）。旧提示词描述的约束协议与运行时不再一致，必须强制刷新。
 */
export const CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V12_ACU = 'spv2.0-continuation-lean-turns-v12';
/**
 * 伏笔派工强制化版本：主 Agent 获得 read/search 后出现「主会话直接安排伏笔、跳过派工」的退化，
 * 默认提示词改为结算先行（未结算历史必须先派 hook-cognition-maintainer）与策划派工强制
 * （每轮至少派 mainline-planner、伏笔操作必须来自 beat-planner 建议）。旧提示词缺少这些
 * 约束会让伏笔账本停止更新，必须强制刷新。
 */
export const CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V13_ACU = 'spv2.1-continuation-hook-delegation-v13';
/**
 * 故事总纲与节奏控制版本：新增 $STORY_ARC 总纲模块与 arc-architect 子代理，大纲轮次带 pacing
 * 标签并受配比硬校验，大纲提示词补上阶段容量锚与节奏配比条款。旧提示词既缺新提示词组，
 * 也仍带着「每个节点都必须升级障碍」这类把日常轮结构性排除掉的条款，必须强制刷新。
 */
export const CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V14_ACU = 'spv2.2-continuation-story-arc-pacing-v14';
/**
 * 阶段节奏形态版本：V14 的节奏规则（每阶段固定低压占比 + 连续高压不超过 3 轮）在数学上只有
 * 锯齿解，读者感知到的是每三四轮一次的固定喘息，而且所有阶段同构。改为阶段级 tempo 形态
 * 决定疏密、跨阶段连续高压上限兜底。旧提示词写死了「连续高压不超过三轮」，必须强制刷新。
 */
export const CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V15_ACU = 'spv2.3-continuation-stage-tempo-v15';
/**
 * 缓存前缀布局版本：主 Agent 提示词把每次迭代必变的【本回合运行时数据】段（$BUDGET 等）
 * 从会话历史锚点之前移到之后，让「规则组 + 正文目录 + 会话历史」成为字节级稳定的前缀，
 * 命中厂商的 prompt 缓存。旧提示词的段排布会让缓存在运行时数据段处断开，必须强制刷新。
 */
export const CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V16_ACU = 'spv2.4-continuation-cache-prefix-v16';
/**
 * 三层正文注入版本：正文改为 $STORY_OVERVIEW（事件概览，纪要召回精化）+ $STORY_TAIL（尾部
 * 全文楼层）+ $STORY_CATALOG（纯楼层索引）三正交占位符；世界书目录改 token 标注并新增
 * $WORLDBOOK_HITS 命中提示；子代理按角色矩阵固定注入；$CHRONICLES / $HISTORY_RECENT /
 * $RECENT_STORY / 阶段纪要链全部退役。旧提示词描述的上下文排布与运行时不再一致，必须强制刷新。
 */
export const CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V17_ACU = 'spv2.5-continuation-story-layers-v17';
/**
 * Append-only 会话契约版本：同址重读不再动态投影旧工具消息，最新快照关系由新消息自身说明。
 * 从 V17 升级时只定向替换已知默认句，保留用户定制提示词；更老版本继续整体刷新。
 */
export const CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V18_ACU = 'spv2.6-continuation-append-only-history-v18';
/**
 * System-message cache compatibility version: OpenAI-compatible Codex gateways
 * can lift every system message into the provider instruction prefix. The main
 * Agent therefore retains only a static root system message; all later context
 * remains ordered user/assistant conversation content.
 */
export const CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V19_ACU = 'spv2.7-continuation-single-system-prefix-v19';
/**
 * Append-only runtime snapshot version: the main Agent no longer re-renders
 * 【本回合运行时数据】as a skeleton tail segment. Changing catalogs and
 * $BUDGET are appended as conversation snapshots so Codex-compatible
 * gateways see a strict prefix extension between iterations.
 */
export const CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V20_ACU = 'spv2.8-continuation-runtime-snapshot-v20';
/**
 * Long-form story-arc version: arc-architect now distributes the main conflict
 * across 6-10 causally linked volumes with distinct escalation layers,
 * expectation payoffs, supporting subplots, and protected endgame reserves.
 */
export const CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V21_ACU = 'spv2.9-continuation-longform-story-arc-v21';
/** Story-arc volume plan version: migrated default prompts follow the persisted volume-count setting. */
export const CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V22_ACU = 'spv3.0-continuation-story-arc-volume-plan-v22';
/** Volume lifecycle version: default prompts now distinguish stage progress, volume completion evidence, and post-arc expansion. */
export const CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V23_ACU = 'spv3.1-continuation-volume-lifecycle-v23';
/** Pacing contract version: low-pressure turns can hold the mainline, close quietly, and advance story time. */
export const CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V24_ACU = 'spv3.2-continuation-pacing-contract-v24';
/** Volume-capacity contract version: every new volume declares capacity, time span, ceiling, sustaining threads, and payoffs. */
export const CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V25_ACU = 'spv3.3-continuation-volume-capacity-v25';
/** Chronology ledger version: maintainer settles story-time facts, main agent and final reviewer enforce time-jump obligations. */
export const CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V26_ACU = 'spv3.4-continuation-chronology-v26';

/**
 * 连续高压轮上限的默认值。8 轮约等于 8000 字全程没有喘息——这才是病态；
 * 更小的值会退化成固定节拍，正是这一版要消灭的东西。
 */
export const CONTINUATION_MAX_CONSECUTIVE_PRESSURE_TURNS_DEFAULT_ACU = 8;

/** 连续高压轮上限的可配置上限。再大就等于关闭这条兜底。 */
export const CONTINUATION_MAX_CONSECUTIVE_PRESSURE_TURNS_MAX_ACU = 20;

/** 终审独立读取预算；与主 Agent 预算隔离，按会话总结阈值折算。 */
export const CONTINUATION_FINAL_REVIEW_READ_TOKEN_BUDGET_DEFAULT_ACU = '50%';
/** 终审允许的额外 worldbook read/search 工具轮上限。 */
export const CONTINUATION_FINAL_REVIEW_MAX_EXTRA_READS_DEFAULT_ACU = 6;

function clonePromptSegments_ACU(segments: readonly ContinuationPromptSegment_ACU[]): ContinuationPromptSegment_ACU[] {
  return segments.map(segment => ({ ...segment }));
}

export function buildDefaultContinuationOutlinePrompt_ACU(): ContinuationPromptSegment_ACU[] {
  return clonePromptSegments_ACU(DEFAULT_OUTLINE_PROMPT_ACU);
}

/** 全部渠道角色默认沿用全局渠道配置，保证旧信封无感迁移。 */
export function buildDefaultContinuationAgentApiPresets_ACU(): ContinuationAgentApiPresets_ACU {
  const presets = {} as ContinuationAgentApiPresets_ACU;
  for (const role of CONTINUATION_AGENT_API_PRESET_ROLES_ACU) {
    presets[role] = { mode: 'inherit', presetName: '' };
  }
  return presets;
}

export function buildDefaultContinuationSettings_ACU(): ContinuationSettings_ACU {
  return {
    stageSize: 'standard',
    customTurnMin: null,
    customTurnMax: null,
    storyArcVolumePlan: 'medium',
    customStoryArcVolumeCount: null,
    outlinePreview: false,
    autoNextStage: true,
    maxAutomaticStages: 6,
    loopTags: '',
    loopDelaySeconds: 5,
    totalDurationMinutes: 0,
    retryDelaySeconds: 3,
    generationRetryLimit: 3,
    internalAiRetryLimit: 3,
    minGenerationTokens: CONTINUATION_MIN_GENERATION_TOKENS_DEFAULT_ACU,
    maxConsecutivePressureTurns: CONTINUATION_MAX_CONSECUTIVE_PRESSURE_TURNS_DEFAULT_ACU,
    storyWindowFloors: AGENT_STORY_WINDOW_DEFAULT_ACU,
    agentHistoryTokenBudget: AGENT_HISTORY_TOKEN_BUDGET_DEFAULT_ACU,
    storyTailFloors: AGENT_STORY_TAIL_FLOORS_DEFAULT_ACU,
    agentReadTokenBudget: AGENT_READ_TOKEN_BUDGET_DEFAULT_ACU,
    agentReadFallbackTokens: AGENT_READ_FALLBACK_TOKENS_DEFAULT_ACU,
    finalReview: { enabled: false, readTokenBudget: CONTINUATION_FINAL_REVIEW_READ_TOKEN_BUDGET_DEFAULT_ACU, maxExtraReads: CONTINUATION_FINAL_REVIEW_MAX_EXTRA_READS_DEFAULT_ACU },
    contextExtractRules: [],
    contextExcludeRules: [],
    agentRunBudget: { ...DEFAULT_AGENT_RUN_BUDGET_ACU },
    apiPresetMode: 'current',
    fixedApiPresetName: '',
    // prompt_cache_key 会让部分 Codex 兼容渠道把请求划进独立缓存命名空间，反而打不中前缀缓存。
    promptCacheEnabled: false,
    agentApiPresets: buildDefaultContinuationAgentApiPresets_ACU(),
    outlinePrompt: buildDefaultContinuationOutlinePrompt_ACU(),
    agentPrompts: buildDefaultContinuationAgentPrompts_ACU(),
    promptForceDefaultVersion: CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V26_ACU,
  };
}

function normalizeOptionalInteger_ACU(value: unknown, fallback: number, minimum: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_CONFIG_NOT_INTEGER', 'load', `${field} 必须是整数`, false, { field, valueType: typeof value }));
  }
  if (value < minimum) {
    throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_CONFIG_OUT_OF_RANGE', 'load', `${field} 超出允许范围`, false, { field, minimum, actual: value }));
  }
  return value;
}

/** Missing values receive the supplied default; 0 remains a valid explicit retry limit. */
export function normalizeContinuationInternalAiRetryLimit_ACU(value: unknown, fallback = 3): number {
  return normalizeOptionalInteger_ACU(value, fallback, 0, 'internalAiRetryLimit');
}

/** Missing values receive the supplied default; 0 is rejected because auto-stage limit must be positive. */
export function normalizeContinuationMaxAutomaticStages_ACU(value: unknown, fallback = 6): number {
  return normalizeOptionalInteger_ACU(value, fallback, 1, 'maxAutomaticStages');
}
