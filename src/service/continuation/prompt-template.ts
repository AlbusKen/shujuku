import {
  ContinuationValidationError_ACU,
  createContinuationError_ACU,
  type ContinuationErrorPhase_ACU,
  type ContinuationPromptSegment_ACU,
  type ContinuationSettings_ACU,
} from './model';
import { buildDefaultContinuationOutlinePrompt_ACU } from './defaults';
import {
  buildDefaultAgentArcArchitectPrompt_ACU,
  buildDefaultAgentBeatPlannerPrompt_ACU,
  buildDefaultAgentMainPrompt_ACU,
  buildDefaultAgentMainlinePlannerPrompt_ACU,
  buildDefaultAgentMaintainerPrompt_ACU,
  buildDefaultAgentReviewerPrompt_ACU,
  buildDefaultAgentFinalReviewerPrompt_ACU,
  buildDefaultAgentWebResearcherPrompt_ACU,
} from './agent/agent-defaults';

export const CONTINUATION_PROMPT_PLACEHOLDERS_ACU = [
  '$ORIGIN_INSTRUCTION', '$1',
  '$STAGE_HISTORY', '$COMPLETED_STAGE_PART', '$REPLAN_INSTRUCTION',
  '$TURN_RANGE', '$REMAINING_TURNS', '$CURRENT_STAGE', '$CURRENT_NODE',
  '$CURRENT_TURN_GOAL', '$TURN_NUMBER', '$NODE_TURN_NUMBER', '$VALIDATION_ERRORS',
  // 以下为 Agent 续写链路专用占位符。$TABLE:<表名> 形式的动态读集不在此列，
  // 它只作为读集标识符，由解析器汇入 $AGENT_READ_MATERIALS。
  '$HISTORY_ANCHOR', '$STORY_TEXT', '$UNSETTLED_RANGE', '$AGENT_CATALOG', '$MODULE_CATALOG',
  '$TABLE_CATALOG', '$TABLE_GLOBAL', '$TABLE_CHARACTERS', '$TABLE_CHRONICLES',
  '$HOOKS_LEDGER', '$INFO_GAP', '$ACTIVE_CONSTRAINTS', '$CHRONOLOGY', '$BUDGET', '$TOOL_RESULTS',
  '$AGENT_READ_MATERIALS', '$AGENT_TASK', '$AGENT_WRITE_SCOPE', '$USER_INTENT', '$OUTLINE_WINDOW',
  // 目录+状态骨架占位符：楼层索引、大纲单行状态、已启用世界书目录、读集词汇表。
  '$STORY_CATALOG', '$OUTLINE_STATE', '$WORLDBOOK_CATALOG', '$AGENT_READ_CATALOG',
  // 三层正文注入与世界书命中：事件概览、尾部全文楼层、未结算正文全量、本轮语境命中条目。
  '$STORY_OVERVIEW', '$STORY_TAIL', '$HISTORY_UNSETTLED', '$WORLDBOOK_HITS',
  // 故事总纲与节奏控制：总纲内容与状态证据、本轮节奏标签、阶段字数容量锚、跨阶段节奏状态。
  '$STORY_ARC', '$STORY_ARC_STATE', '$CURRENT_TURN_PACING', '$STAGE_WORD_BUDGET', '$PACING_CONTEXT',
  // 百科资料库：全量摘要 / 目录行 / web-researcher 专用的出网工具说明。
  '$WEB_REFS', '$WEB_REFS_CATALOG', '$WEB_TOOL_CATALOG',
] as const;

export type ContinuationPromptPlaceholder_ACU = typeof CONTINUATION_PROMPT_PLACEHOLDERS_ACU[number];

/**
 * 占位符替换用的交替式正则。必须按长度降序排列：存在 $STORY_ARC 与 $STORY_ARC_STATE
 * 这类前缀包含关系时，短的排在前面会先命中，把长占位符切成「已替换的短占位符 + 残留后缀」。
 */
const PLACEHOLDER_ALTERNATION_ACU = [...CONTINUATION_PROMPT_PLACEHOLDERS_ACU]
  .sort((left, right) => right.length - left.length)
  .map(token => token.replace(/[$]/g, '\\$'))
  .join('|');
export type ContinuationPromptKind_ACU = 'outline' | 'agent_main' | 'agent_arc' | 'agent_maintainer' | 'agent_mainline' | 'agent_beat' | 'agent_reviewer' | 'agent_final_reviewer' | 'agent_web_researcher';
type PlaceholderResolver_ACU = () => string | Promise<string | null | undefined> | null | undefined;

function failPrompt_ACU(code: 'CONTINUATION_ENVELOPE_INVALID' | 'CONTINUATION_PROMPT_INVALID' | 'CONTINUATION_PROMPT_EMPTY', phase: ContinuationErrorPhase_ACU, message: string, details?: Record<string, unknown>): never {
  throw new ContinuationValidationError_ACU(createContinuationError_ACU(code, phase, message, false, details));
}

export function validateContinuationPromptSegments_ACU(value: unknown, phase: ContinuationErrorPhase_ACU, errorCode: 'CONTINUATION_ENVELOPE_INVALID' | 'CONTINUATION_PROMPT_INVALID' = 'CONTINUATION_PROMPT_INVALID'): ContinuationPromptSegment_ACU[] {
  if (!Array.isArray(value)) failPrompt_ACU(errorCode, phase, '提示词必须是数组');
  const result = value.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) failPrompt_ACU(errorCode, phase, '提示词段必须是对象', { index });
    const segment = raw as Record<string, unknown>;
    if (Object.keys(segment).some(key => !['role', 'content', 'enabled', 'deletable', 'pinned'].includes(key))) failPrompt_ACU(errorCode, phase, '提示词段包含未知字段', { index });
    if (!['system', 'user', 'assistant'].includes(segment.role as string) || typeof segment.content !== 'string') failPrompt_ACU(errorCode, phase, '提示词段角色或内容非法', { index });
    if (segment.enabled !== undefined && typeof segment.enabled !== 'boolean') failPrompt_ACU(errorCode, phase, '提示词段 enabled 非法', { index });
    if (segment.deletable !== undefined && typeof segment.deletable !== 'boolean') failPrompt_ACU(errorCode, phase, '提示词段 deletable 非法', { index });
    if (segment.pinned !== undefined && typeof segment.pinned !== 'boolean') failPrompt_ACU(errorCode, phase, '提示词段 pinned 非法', { index });
    if (!segment.content.trim()) failPrompt_ACU(errorCode, phase, '提示词段内容不能为空', { index });
    return { role: segment.role, content: segment.content, ...(segment.enabled === undefined ? {} : { enabled: segment.enabled }), ...(segment.deletable === undefined ? {} : { deletable: segment.deletable }), ...(segment.pinned === undefined ? {} : { pinned: segment.pinned }) } as ContinuationPromptSegment_ACU;
  });
  if (!result.length) failPrompt_ACU(errorCode, phase, '提示词不能为空');
  return result;
}

export async function renderContinuationPrompt_ACU(segments: unknown, resolvers: Partial<Record<ContinuationPromptPlaceholder_ACU, PlaceholderResolver_ACU>>, phase: ContinuationErrorPhase_ACU): Promise<{ messages: Array<{ role: string; content: string }>; usedPlaceholders: ContinuationPromptPlaceholder_ACU[] }> {
  const validated = validateContinuationPromptSegments_ACU(segments, phase);
  const enabledSegments = validated.filter(segment => segment.enabled !== false);
  if (!enabledSegments.length) failPrompt_ACU('CONTINUATION_PROMPT_EMPTY', phase, '提示词至少需要一个启用段');
  // 按实际匹配结果判定「用到了哪些占位符」，而不是子串包含：否则写了 $STORY_ARC_STATE
  // 的段会被算成同时用了 $STORY_ARC，白跑一次解析器。
  const matched = new Set<string>();
  for (const segment of enabledSegments) {
    for (const hit of segment.content.matchAll(new RegExp(PLACEHOLDER_ALTERNATION_ACU, 'g'))) matched.add(hit[0]);
  }
  const usedPlaceholders = CONTINUATION_PROMPT_PLACEHOLDERS_ACU.filter(token => matched.has(token));
  const values = new Map<ContinuationPromptPlaceholder_ACU, string>();
  for (const token of usedPlaceholders) values.set(token, String(await resolvers[token]?.() ?? ''));
  const tokenPattern = new RegExp(PLACEHOLDER_ALTERNATION_ACU, 'g');
  return { usedPlaceholders, messages: enabledSegments.map(segment => ({ role: segment.role, content: segment.content.replace(tokenPattern, token => values.get(token as ContinuationPromptPlaceholder_ACU) ?? '') })) };
}

/**
 * 把指定提示词组恢复为默认值。
 * @param settings 当前设置草稿
 * @param kind 要恢复的提示词组
 * @returns 新的设置对象，只替换目标提示词组
 */
export function restoreContinuationPromptDefault_ACU(settings: ContinuationSettings_ACU, kind: ContinuationPromptKind_ACU): ContinuationSettings_ACU {
  if (kind === 'outline') return { ...settings, outlinePrompt: buildDefaultContinuationOutlinePrompt_ACU() };
  const agentPrompts = { ...settings.agentPrompts };
  if (kind === 'agent_main') agentPrompts.main = buildDefaultAgentMainPrompt_ACU();
  if (kind === 'agent_arc') agentPrompts.arcArchitect = buildDefaultAgentArcArchitectPrompt_ACU();
  if (kind === 'agent_maintainer') agentPrompts.maintainer = buildDefaultAgentMaintainerPrompt_ACU();
  if (kind === 'agent_mainline') agentPrompts.mainlinePlanner = buildDefaultAgentMainlinePlannerPrompt_ACU();
  if (kind === 'agent_beat') agentPrompts.beatPlanner = buildDefaultAgentBeatPlannerPrompt_ACU();
  if (kind === 'agent_reviewer') agentPrompts.reviewer = buildDefaultAgentReviewerPrompt_ACU();
  if (kind === 'agent_final_reviewer') agentPrompts.finalReviewer = buildDefaultAgentFinalReviewerPrompt_ACU();
  if (kind === 'agent_web_researcher') agentPrompts.webResearcher = buildDefaultAgentWebResearcherPrompt_ACU();
  return { ...settings, agentPrompts };
}
