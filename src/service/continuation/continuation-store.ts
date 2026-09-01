import { getChatArray_ACU, saveChatToHostStrict_ACU } from '../../data/gateways/chat-gateway';
import { getActiveChatStorageIdentity_ACU } from '../../data/storage/chat-history';
import { buildDefaultContinuationSettings_ACU, buildDefaultContinuationOutlinePrompt_ACU, buildDefaultContinuationAgentApiPresets_ACU, CONTINUATION_FINAL_REVIEW_MAX_EXTRA_READS_DEFAULT_ACU, CONTINUATION_FINAL_REVIEW_READ_TOKEN_BUDGET_DEFAULT_ACU, CONTINUATION_MAX_CONSECUTIVE_PRESSURE_TURNS_DEFAULT_ACU, CONTINUATION_MAX_CONSECUTIVE_PRESSURE_TURNS_MAX_ACU, CONTINUATION_MIN_GENERATION_TOKENS_DEFAULT_ACU, CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V17_ACU, CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V18_ACU, CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V19_ACU, CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V20_ACU, CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V21_ACU, CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V22_ACU, CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V23_ACU } from './defaults';
import { reconcileContinuationEnvelopeCursor_ACU } from './stage-cursor';
import { AGENT_HISTORY_READ_RULE_V17_ACU, AGENT_HISTORY_READ_RULE_V18_ACU, buildDefaultAgentArcArchitectPrompt_ACU, buildDefaultContinuationAgentPrompts_ACU, currentDefaultMainAgentHistoryGuide_ACU, currentDefaultMainAgentLayoutAnswer_ACU, isV18DefaultMainAgentNonRootSystemSegment_ACU, isV19DefaultMainAgentHistoryGuide_ACU, isV19DefaultMainAgentLayoutAnswer_ACU, isV19DefaultMainAgentRuntimeSegment_ACU, V20_DEFAULT_ARC_ARCHITECT_CONTRACT_ACU, V20_DEFAULT_ARC_ARCHITECT_EPISTEMOLOGY_ACU, V20_DEFAULT_ARC_ARCHITECT_PURPOSE_ACU, V20_DEFAULT_ARC_ARCHITECT_SYSTEM_ACU, V20_DEFAULT_ARC_ARCHITECT_TASK_ACU } from './agent/agent-defaults';
import {
  AGENT_HISTORY_TOKEN_BUDGET_DEFAULT_ACU,
  AGENT_READ_FALLBACK_TOKENS_DEFAULT_ACU,
  AGENT_READ_TOKEN_BUDGET_DEFAULT_ACU,
  AGENT_STORY_TAIL_FLOORS_DEFAULT_ACU,
  AGENT_STORY_WINDOW_DEFAULT_ACU,
  DEFAULT_AGENT_RUN_BUDGET_ACU,
} from './agent/agent-model';
import { CONTINUATION_AGENT_API_PRESET_ROLES_ACU, CONTINUATION_AGENT_PROMPT_KEYS_ACU } from './model';
import { resolveContinuationTurnRange_ACU, validateStageOutline_ACU } from './outline-schema';
import { validateContinuationPromptSegments_ACU } from './prompt-template';
import {
  CONTINUATION_SCHEMA_VERSION_ACU,
  ContinuationValidationError_ACU,
  createContinuationError_ACU,
  type ContinuationEnvelope_ACU,
  type ContinuationErrorCode_ACU,
  type ContinuationErrorPhase_ACU,
  type ContinuationSettings_ACU,
  type ContinuationWriteGuard_ACU,
} from './model';
import { stripLegacyLoopPromptFields_ACU } from '../../shared/legacy-loop-fields';

export const CONTINUATION_FIRST_FLOOR_FIELD_ACU = '_qrf_continuation';

const TASK_STATUSES_ACU = ['drafting', 'awaiting_outline_review', 'paused', 'running', 'stopping_after_inflight', 'completed', 'abandoned', 'failed'] as const;
const STAGE_STATUSES_ACU = ['planning', 'awaiting_review', 'running', 'completed', 'abandoned', 'failed'] as const;
const REVISION_REASONS_ACU = ['initial', 'auto_next_stage', 'manual_replan'] as const;
const STOP_REASONS_ACU = ['manual', 'duration_reached', 'stage_limit_reached', 'outline_validation_failed', 'internal_ai_retry_exhausted', 'generation_retry_exhausted', 'host_input_unavailable', 'api_preset_missing', 'state_invalid', 'chat_changed', 'completed'] as const;
const ERROR_PHASES_ACU = ['load', 'persist', 'outline_prompt', 'outline_call', 'outline_parse', 'outline_validate', 'turn_prompt', 'turn_call', 'host_send', 'generation_evaluate', 'replan', 'agent_loop', 'agent_delegate', 'agent_persist'] as const;
const ERROR_CODES_ACU = ['CONTINUATION_CONFIG_MISSING', 'CONTINUATION_CONFIG_NOT_INTEGER', 'CONTINUATION_CONFIG_OUT_OF_RANGE', 'CONTINUATION_STAGE_SIZE_INVALID', 'CONTINUATION_CUSTOM_RANGE_INVALID', 'CONTINUATION_ENVELOPE_INVALID', 'CONTINUATION_CHAT_UNAVAILABLE', 'CONTINUATION_CHAT_CHANGED', 'CONTINUATION_WRITE_GUARD_MISMATCH', 'CONTINUATION_PERSIST_FAILED', 'CONTINUATION_PROMPT_INVALID', 'CONTINUATION_PROMPT_EMPTY', 'CONTINUATION_API_PRESET_MISSING', 'CONTINUATION_MIGRATION_INVALID', 'CONTINUATION_OUTLINE_NOT_OBJECT', 'CONTINUATION_OUTLINE_UNKNOWN_FIELD', 'CONTINUATION_OUTLINE_FIELD_MISSING', 'CONTINUATION_OUTLINE_FIELD_TYPE_INVALID', 'CONTINUATION_OUTLINE_STRING_EMPTY', 'CONTINUATION_OUTLINE_SCHEMA_VERSION_INVALID', 'CONTINUATION_OUTLINE_TOTAL_TURNS_OUT_OF_RANGE', 'CONTINUATION_OUTLINE_NODES_EMPTY', 'CONTINUATION_OUTLINE_NODE_ID_DUPLICATE', 'CONTINUATION_OUTLINE_TURN_ID_DUPLICATE', 'CONTINUATION_OUTLINE_SUGGESTED_TURNS_INVALID', 'CONTINUATION_OUTLINE_NODE_TURN_COUNT_MISMATCH', 'CONTINUATION_OUTLINE_TOTAL_TURNS_MISMATCH', 'CONTINUATION_OUTLINE_PACING_INVALID', 'CONTINUATION_REPLAN_CONTEXT_INVALID', 'CONTINUATION_REPLAN_COMPLETED_PREFIX_CHANGED', 'CONTINUATION_OUTLINE_JSON_INVALID', 'CONTINUATION_INTERNAL_AI_REQUEST_FAILED', 'CONTINUATION_OUTLINE_RETRY_EXHAUSTED', 'CONTINUATION_REVISION_FROZEN', 'CONTINUATION_TURN_INSTRUCTION_EMPTY', 'CONTINUATION_TURN_INSTRUCTION_RETRY_EXHAUSTED', 'CONTINUATION_INTERNAL_REQUEST_STALE', 'CONTINUATION_OPERATION_BUSY', 'CONTINUATION_ORIGIN_INSTRUCTION_EMPTY', 'CONTINUATION_TASK_NOT_FOUND', 'CONTINUATION_TASK_STATE_INVALID', 'CONTINUATION_HOST_INPUT_UNAVAILABLE', 'CONTINUATION_GENERATION_TAGS_MISSING', 'CONTINUATION_GENERATION_FAILED', 'CONTINUATION_GENERATION_TOO_SHORT', 'CONTINUATION_AGENT_PROTOCOL_INVALID', 'CONTINUATION_AGENT_ITERATIONS_EXHAUSTED', 'CONTINUATION_AGENT_BLOCKED', 'CONTINUATION_AGENT_SUBAGENT_FAILED', 'CONTINUATION_AGENT_WRITE_REJECTED', 'CONTINUATION_AGENT_OUTLINE_REPLANNED', 'CONTINUATION_AGENT_SNAPSHOT_INVALID'] as const;
const TIMELINE_KINDS_ACU = ['task_created', 'outline_ready', 'turn_sent', 'turn_completed', 'turn_retry', 'stage_completed', 'paused', 'stopped', 'failed'] as const;

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail_ACU(code: ContinuationErrorCode_ACU, message: string, details?: Record<string, unknown>, phase: ContinuationErrorPhase_ACU = 'persist'): never {
  throw new ContinuationValidationError_ACU(createContinuationError_ACU(code, phase, message, false, details));
}

function requireKeys_ACU(value: Record<string, unknown>, keys: readonly string[], path: string, optionalKeys: readonly string[] = []): void {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', `缺少持久化字段：${path}.${key}`, { path: `${path}.${key}` });
  }
  const allKeys = [...keys, ...optionalKeys];
  for (const key of Object.keys(value)) {
    if (!allKeys.includes(key)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', `存在未知持久化字段：${path}.${key}`, { path: `${path}.${key}` });
  }
}

function requireString_ACU(value: unknown, path: string): string {
  if (typeof value !== 'string') fail_ACU('CONTINUATION_ENVELOPE_INVALID', `字段必须是字符串：${path}`, { path });
  return value;
}

function requireBoolean_ACU(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail_ACU('CONTINUATION_ENVELOPE_INVALID', `字段必须是布尔值：${path}`, { path });
  return value;
}

function requireInteger_ACU(value: unknown, path: string, minimum?: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || (minimum !== undefined && value < minimum)) {
    fail_ACU('CONTINUATION_ENVELOPE_INVALID', `字段必须是${minimum === undefined ? '' : `不小于 ${minimum} 的`}整数：${path}`, { path });
  }
  return value;
}

/** 校验 0 到 maximum 之间的整数。上界存在的意义是：设得过大等于关闭兜底，应显式选 0 而不是靠大数糊弄。 */
function requireBoundedInteger_ACU(value: unknown, path: string, maximum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > maximum) {
    fail_ACU('CONTINUATION_ENVELOPE_INVALID', `字段必须是 0 到 ${maximum} 之间的整数：${path}`, { path });
  }
  return value;
}

function requireEnum_ACU<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail_ACU('CONTINUATION_ENVELOPE_INVALID', `字段枚举值非法：${path}`, { path });
  }
  return value as T;
}


function validateRules_ACU(value: unknown, path: string): { start: string; end: string }[] {
  if (!Array.isArray(value)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', `字段必须是数组：${path}`, { path });
  return value.map((rule, index) => {
    if (!isRecord_ACU(rule)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', `规则必须是对象：${path}[${index}]`, { path: `${path}[${index}]` });
    requireKeys_ACU(rule, ['start', 'end'], `${path}[${index}]`);
    return { start: requireString_ACU(rule.start, `${path}[${index}].start`), end: requireString_ACU(rule.end, `${path}[${index}].end`) };
  });
}

/**
 * 校验六组 Agent 提示词。
 * @param raw 持久化里的 agentPrompts 字段
 * @returns 逐组校验后的提示词集合
 */
function validateAgentPrompts_ACU(raw: unknown): ContinuationSettings_ACU['agentPrompts'] {
  if (!isRecord_ACU(raw)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', 'settings.agentPrompts 必须是对象');
  requireKeys_ACU(raw, CONTINUATION_AGENT_PROMPT_KEYS_ACU, 'settings.agentPrompts');
  return {
    main: validateContinuationPromptSegments_ACU(raw.main, 'load', 'CONTINUATION_ENVELOPE_INVALID'),
    arcArchitect: validateContinuationPromptSegments_ACU(raw.arcArchitect, 'load', 'CONTINUATION_ENVELOPE_INVALID'),
    maintainer: validateContinuationPromptSegments_ACU(raw.maintainer, 'load', 'CONTINUATION_ENVELOPE_INVALID'),
    mainlinePlanner: validateContinuationPromptSegments_ACU(raw.mainlinePlanner, 'load', 'CONTINUATION_ENVELOPE_INVALID'),
    beatPlanner: validateContinuationPromptSegments_ACU(raw.beatPlanner, 'load', 'CONTINUATION_ENVELOPE_INVALID'),
    reviewer: validateContinuationPromptSegments_ACU(raw.reviewer, 'load', 'CONTINUATION_ENVELOPE_INVALID'),
    finalReviewer: validateContinuationPromptSegments_ACU(raw.finalReviewer, 'load', 'CONTINUATION_ENVELOPE_INVALID'),
  };
}

/**
 * V17 → V18 只迁移已知的默认会话规则句。无法识别的结构或用户文本保持原样，
 * 随后仍由 validateAgentPrompts_ACU 执行完整持久化校验。
 */
function migrateV17AgentPromptsToV18_ACU(raw: unknown): unknown {
  if (!isRecord_ACU(raw)) return raw;
  const currentMain = raw.main;
  if (!Array.isArray(currentMain)) return raw;
  let changed = false;
  const main = currentMain.map(segment => {
    if (!isRecord_ACU(segment) || typeof segment.content !== 'string' || !segment.content.includes(AGENT_HISTORY_READ_RULE_V17_ACU)) {
      return segment;
    }
    changed = true;
    return {
      ...segment,
      content: segment.content.split(AGENT_HISTORY_READ_RULE_V17_ACU).join(AGENT_HISTORY_READ_RULE_V18_ACU),
    };
  });
  return changed ? { ...raw, main } : raw;
}

/**
 * V18 → V19 converts only unchanged default non-root system segments to user.
 * Some Codex-compatible gateways consolidate system messages ahead of chat
 * history; retaining one static root system segment protects the cache prefix.
 */
function migrateV18AgentPromptsToV19_ACU(raw: unknown): unknown {
  if (!isRecord_ACU(raw) || !Array.isArray(raw.main)) return raw;
  let changed = false;
  const main = raw.main.map(segment => {
    if (
      !isRecord_ACU(segment)
      || segment.role !== 'system'
      || !isV18DefaultMainAgentNonRootSystemSegment_ACU(segment.content)
    ) {
      return segment;
    }
    changed = true;
    return { ...segment, role: 'user' };
  });
  return changed ? { ...raw, main } : raw;
}

/**
 * V19 → V20 把未改写的运行时骨架段挪出提示词（改由会话追加快照），
 * 并定向更新未改写的排布问答与历史导语。用户定制正文保持原样。
 */
function migrateV19AgentPromptsToV20_ACU(raw: unknown): unknown {
  if (!isRecord_ACU(raw) || !Array.isArray(raw.main)) return raw;
  let changed = false;
  const layoutAnswer = currentDefaultMainAgentLayoutAnswer_ACU();
  const historyGuide = currentDefaultMainAgentHistoryGuide_ACU();
  const main = raw.main.flatMap(segment => {
    if (!isRecord_ACU(segment) || typeof segment.content !== 'string') return [segment];
    if (isV19DefaultMainAgentRuntimeSegment_ACU(segment.content)) {
      changed = true;
      return [];
    }
    if (isV19DefaultMainAgentLayoutAnswer_ACU(segment.content) && segment.content !== layoutAnswer) {
      changed = true;
      return [{ ...segment, content: layoutAnswer }];
    }
    if (isV19DefaultMainAgentHistoryGuide_ACU(segment.content) && segment.content !== historyGuide) {
      changed = true;
      return [{ ...segment, content: historyGuide }];
    }
    return [segment];
  });
  return changed ? { ...raw, main } : raw;
}

/**
 * V20 → V21 只替换总纲子代理中未改写的五个默认段。
 * 其他角色、用户新增段与用户定制正文保持原样。
 */
function migrateV20AgentPromptsToV21_ACU(raw: unknown): unknown {
  if (!isRecord_ACU(raw) || !Array.isArray(raw.arcArchitect)) return raw;
  const current = buildDefaultAgentArcArchitectPrompt_ACU();
  const replacements = new Map<string, string>([
    [V20_DEFAULT_ARC_ARCHITECT_SYSTEM_ACU, current[0].content],
    [V20_DEFAULT_ARC_ARCHITECT_PURPOSE_ACU, current[2].content],
    [V20_DEFAULT_ARC_ARCHITECT_EPISTEMOLOGY_ACU, current[4].content],
    [V20_DEFAULT_ARC_ARCHITECT_CONTRACT_ACU, current[6].content],
    [V20_DEFAULT_ARC_ARCHITECT_TASK_ACU, current[7].content],
  ]);
  let changed = false;
  const arcArchitect = raw.arcArchitect.map(segment => {
    if (!isRecord_ACU(segment) || typeof segment.content !== 'string') return segment;
    const content = replacements.get(segment.content);
    if (content === undefined || content === segment.content) return segment;
    changed = true;
    return { ...segment, content };
  });
  return changed ? { ...raw, arcArchitect } : raw;
}

/** V21 → V22 只替换已知默认段中的卷数规则，保留用户其余提示词定制。 */
function migrateV21AgentPromptsToV22_ACU(raw: unknown): unknown {
  if (!isRecord_ACU(raw) || !Array.isArray(raw.arcArchitect)) return raw;
  const replacements = new Map<string, string>([
    ['开局立长篇总纲时，默认给出一条 story 条目和 6-10 条 volume 条目；只有用户明确要求短篇或素材容量明显不足时才可少于 6 卷，并在 summary 说明依据。禁止为了省事把完整长篇压成 3-5 个笼统部分。第一卷 status 设 active，其余 planned。', '开局立总纲或全量重构时，卷数必须严格遵守本次请求末尾注入的【总纲卷数计划】：短线 7–8 卷、中线 10–14 卷、长线 20 卷，或自定义的精确卷数。资料不足时可以把远期卷标为待定方向，但不得缩减卷数；第一卷 status 设 active，其余 planned。'],
    ['长篇默认有 6-10 个功能不重复的卷台阶', '卷数严格符合本次【总纲卷数计划】且各卷功能不重复'],
  ]);
  let changed = false;
  const arcArchitect = raw.arcArchitect.map(segment => {
    if (!isRecord_ACU(segment) || typeof segment.content !== 'string') return segment;
    let content = segment.content;
    for (const [from, to] of replacements) content = content.replace(from, to);
    if (content === segment.content) return segment;
    changed = true;
    return { ...segment, content };
  });
  return changed ? { ...raw, arcArchitect } : raw;
}

/** V22 → V23 对齐卷生命周期契约，只替换未改写的默认规则片段。 */
function migrateV22AgentPromptsToV23_ACU(raw: unknown): unknown {
  if (!isRecord_ACU(raw)) return raw;
  const replaceDefaults = (segments: unknown, replacements: ReadonlyMap<string, string>): unknown => {
    if (!Array.isArray(segments)) return segments;
    let changed = false;
    const next = segments.map(segment => {
      if (!isRecord_ACU(segment) || typeof segment.content !== 'string') return segment;
      let content = segment.content;
      for (const [from, to] of replacements) content = content.replace(from, to);
      if (content === segment.content) return segment;
      changed = true;
      return { ...segment, content };
    });
    return changed ? next : segments;
  };
  const arcArchitect = replaceDefaults(raw.arcArchitect, new Map<string, string>([
    ['"stageNumbers":[已承载的阶段编号],"reason":"retire 时必填"', '"stageNumbers":[已承载的阶段编号],"completionStageNumber":"done 时为已完成阶段编号，否则 null","completionState":"done 时达到的卷末状态，否则空字符串","continuationRationale":"续卷时由前卷后果推出的依据，否则空字符串","reason":"retire 时必填"'],
    ['7. 阶段完成后回写进度用 patch：{"action":"patch","id":"VOL-01","stageNumbers":[1,2,3]}。当前卷台阶走完时，把它 patch 成 done，同时把下一卷 patch 成 active。\n8. patch 只带要改的字段，其余字段保持原样；新增或整条重写才用 upsert。', '7. stage 是阶段大纲，volume 是长程卷台阶；一个 active 卷可由多份阶段大纲渐进承载。每完成一份阶段只 patch 当前 active 卷的 stageNumbers，不能因单个阶段完成就把卷设为 done。\n8. 仅当真实正文已达到本卷 escalation 的可判定收束状态时，才可把 active 卷 patch 为 done；同一 patch 必须给 completionStageNumber、completionState，且该阶段已真实完成并已登记在 stageNumbers。状态只能 planned→active→done；done 卷不可重激活。\n9. 所有既有卷 done 而用户继续写作时，先在末尾 upsert 一个 active 新卷，并以 continuationRationale 说明它如何由最后一卷的结果、代价、关系变化或未解决问题推出；之后才由 outline-architect 创建阶段大纲。\n10. patch 只带要改的字段，其余字段保持原样；新增或整条重写才用 upsert。'],
  ]));
  const main = replaceDefaults(raw.main, new Map<string, string>([
    ['此外，剧情实际走向已越出总纲台阶、底牌被正文提前翻开、或当前卷目标事实上已收束/明显提前推迟时，同样必须派它维护总纲，不要拖到下一阶段。', '此外，剧情实际走向已越出总纲台阶、底牌被正文提前翻开、或当前卷已经由真实完成阶段达到可判定收束状态时，同样必须派它维护总纲。单个阶段完成只回写当前 active 卷的 stageNumbers；所有既有卷完成而用户继续写时，先派 arc-architect 依据最后一卷的后果扩充一个 active 新卷，再派 outline-architect，不要拖到下一阶段。'],
  ]));
  return arcArchitect === raw.arcArchitect && main === raw.main ? raw : { ...raw, arcArchitect, main };
}

function migrateV22OutlinePromptToV23_ACU(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  const oldRule = '8. 让阶段目标落在故事总纲当前推进中的那一级台阶内，不触碰总纲里标注为禁止提前释放的底牌，并在阶段末留下跨阶段悬念。';
  const nextRule = '8. 让阶段目标只承载故事总纲当前 active 卷尚未完成的一段，不触碰总纲里标注为禁止提前释放的底牌；单个阶段结束只留下跨阶段悬念，不擅自收束整卷。只有活动卷规划上下文显示卷级收束条件已被真实完成阶段满足时，才交由 arc-architect 切卷；所有既有卷完成时先扩充后续 active 卷。';
  let changed = false;
  const outlinePrompt = raw.map(segment => {
    if (!isRecord_ACU(segment) || typeof segment.content !== 'string') return segment;
    const content = segment.content.replace(oldRule, nextRule);
    if (content === segment.content) return segment;
    changed = true;
    return { ...segment, content };
  });
  return changed ? outlinePrompt : raw;
}

/**
 * 校验七个角色的 AI 渠道配置。
 * @param raw 持久化里的 agentApiPresets 字段
 * @returns 逐角色校验后的渠道配置
 */
function validateAgentApiPresets_ACU(raw: unknown): ContinuationSettings_ACU['agentApiPresets'] {
  if (!isRecord_ACU(raw)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', 'settings.agentApiPresets 必须是对象');
  // 新增渠道角色时存量信封必然缺键。提示词组有版本强刷兜底，渠道配置没有——不在这里补默认
  // 就会让所有旧信封报「缺少持久化字段」而整体加载失败。缺失即 inherit，与新建默认一致。
  for (const role of CONTINUATION_AGENT_API_PRESET_ROLES_ACU) {
    if (!Object.prototype.hasOwnProperty.call(raw, role)) raw[role] = { mode: 'inherit', presetName: '' };
  }
  requireKeys_ACU(raw, CONTINUATION_AGENT_API_PRESET_ROLES_ACU, 'settings.agentApiPresets');
  const result = {} as ContinuationSettings_ACU['agentApiPresets'];
  for (const role of CONTINUATION_AGENT_API_PRESET_ROLES_ACU) {
    const choice = raw[role];
    if (!isRecord_ACU(choice)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', `settings.agentApiPresets.${role} 必须是对象`);
    requireKeys_ACU(choice, ['mode', 'presetName'], `settings.agentApiPresets.${role}`);
    if (!['inherit', 'current', 'fixed'].includes(choice.mode as string)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', `settings.agentApiPresets.${role}.mode 非法`);
    result[role] = { mode: choice.mode as 'inherit' | 'current' | 'fixed', presetName: requireString_ACU(choice.presetName, `settings.agentApiPresets.${role}.presetName`) };
  }
  return result;
}

/**
 * 校验 read/search 累计预算配置。接受正整数（固定 token 数）或 "1%"-"100%" 百分比串
 * （按 agentHistoryTokenBudget 折算）；非法值直接拒绝而不是静默回退，与信封其余字段同构。
 */
function validateReadTokenBudget_ACU(raw: unknown): number | string {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1) return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (/^\d+(\.\d+)?%$/.test(trimmed)) {
      const percent = parseFloat(trimmed);
      if (percent >= 1 && percent <= 100) return trimmed;
    }
    const numeric = Number(trimmed);
    if (Number.isInteger(numeric) && numeric >= 1) return numeric;
  }
  fail_ACU('CONTINUATION_ENVELOPE_INVALID', 'settings.agentReadTokenBudget 必须是正整数或 1%-100% 百分比');
}

function validateFinalReviewSettings_ACU(raw: unknown): ContinuationSettings_ACU['finalReview'] {
  if (!isRecord_ACU(raw)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', 'settings.finalReview 必须是对象');
  requireKeys_ACU(raw, ['enabled', 'readTokenBudget', 'maxExtraReads'], 'settings.finalReview');
  return {
    enabled: requireBoolean_ACU(raw.enabled, 'settings.finalReview.enabled'),
    readTokenBudget: validateReadTokenBudget_ACU(raw.readTokenBudget),
    maxExtraReads: requireBoundedInteger_ACU(raw.maxExtraReads, 'settings.finalReview.maxExtraReads', 10),
  };
}

/**
 * 校验 Agent 运行预算。六项各有边界：上界防止「设个大数等于关闭护栏」，
 * 下界区分「必须至少一次」（迭代/同代理/并发）与「0 即显式关闭」（派工/读取/工具轮）。
 */
function validateAgentRunBudget_ACU(raw: unknown): ContinuationSettings_ACU['agentRunBudget'] {
  if (!isRecord_ACU(raw)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', 'settings.agentRunBudget 必须是对象');
  requireKeys_ACU(raw, ['maxIterations', 'maxDelegations', 'maxSameAgent', 'maxConcurrent', 'maxReads', 'maxExtraReads'], 'settings.agentRunBudget');
  const bounded = (value: unknown, path: string, minimum: number, maximum: number): number => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
      fail_ACU('CONTINUATION_ENVELOPE_INVALID', `字段必须是 ${minimum} 到 ${maximum} 之间的整数：${path}`, { path });
    }
    return value;
  };
  return {
    maxIterations: bounded(raw.maxIterations, 'settings.agentRunBudget.maxIterations', 1, 30),
    maxDelegations: bounded(raw.maxDelegations, 'settings.agentRunBudget.maxDelegations', 0, 20),
    maxSameAgent: bounded(raw.maxSameAgent, 'settings.agentRunBudget.maxSameAgent', 1, 10),
    maxConcurrent: bounded(raw.maxConcurrent, 'settings.agentRunBudget.maxConcurrent', 1, 6),
    maxReads: bounded(raw.maxReads, 'settings.agentRunBudget.maxReads', 0, 30),
    maxExtraReads: bounded(raw.maxExtraReads, 'settings.agentRunBudget.maxExtraReads', 0, 10),
  };
}

/**
 * 校验一份独立的续写设置（信封之外的来源，如全局设置副本）。
 * 复用信封同一套校验：含历史字段无感迁移与提示词版本强刷，旧格式副本读出来即是当前版本。
 * @param raw 待校验的设置对象（会被就地迁移，调用方应传入深拷贝）
 * @returns 校验通过的完整设置
 */
export function validateContinuationSettings_ACU(raw: unknown): ContinuationSettings_ACU {
  return validateSettings_ACU(raw);
}

function validateSettings_ACU(raw: unknown): ContinuationSettings_ACU {
  if (!isRecord_ACU(raw)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', 'settings 必须是对象');
  // V7 及更早的信封带 turnInstructionPrompt 且没有 agentPrompts。严格键校验会把它判成未知字段，
  // 所以先就地迁移：丢掉退役字段、补上 Agent 提示词，再进入正常校验。
  if (Object.prototype.hasOwnProperty.call(raw, 'turnInstructionPrompt')) delete raw.turnInstructionPrompt;
  if (!Object.prototype.hasOwnProperty.call(raw, 'agentPrompts')) raw.agentPrompts = buildDefaultContinuationAgentPrompts_ACU();
  if (isRecord_ACU(raw.agentPrompts) && !Object.prototype.hasOwnProperty.call(raw.agentPrompts, 'finalReviewer')) {
    raw.agentPrompts.finalReviewer = buildDefaultContinuationAgentPrompts_ACU().finalReviewer;
  }
  // 渠道按角色拆分之前的信封没有 agentApiPresets；就地补默认（全 inherit）即无感迁移。
  if (!Object.prototype.hasOwnProperty.call(raw, 'agentApiPresets')) raw.agentApiPresets = buildDefaultContinuationAgentApiPresets_ACU();
  // 主 Agent 会话改造之前的信封没有这两项；补默认即无感迁移，不必让用户重建配置。
  if (!Object.prototype.hasOwnProperty.call(raw, 'storyWindowFloors')) raw.storyWindowFloors = AGENT_STORY_WINDOW_DEFAULT_ACU;
  if (!Object.prototype.hasOwnProperty.call(raw, 'agentHistoryTokenBudget')) raw.agentHistoryTokenBudget = AGENT_HISTORY_TOKEN_BUDGET_DEFAULT_ACU;
  // 旧默认 24000 的统计口径只算会话历史；口径改为「实际读取的完整上下文」后，24000 连提示词
  // 骨架都容不下，会导致每轮都触发压缩。该值从未是有效的主动选择，无条件迁到新默认。
  if (raw.agentHistoryTokenBudget === 24000) raw.agentHistoryTokenBudget = AGENT_HISTORY_TOKEN_BUDGET_DEFAULT_ACU;
  // Agent 工具化改造之前的信封没有这三项；补默认即无感迁移。
  if (!Object.prototype.hasOwnProperty.call(raw, 'storyTailFloors')) raw.storyTailFloors = AGENT_STORY_TAIL_FLOORS_DEFAULT_ACU;
  if (!Object.prototype.hasOwnProperty.call(raw, 'agentReadTokenBudget')) raw.agentReadTokenBudget = AGENT_READ_TOKEN_BUDGET_DEFAULT_ACU;
  if (!Object.prototype.hasOwnProperty.call(raw, 'agentReadFallbackTokens')) raw.agentReadFallbackTokens = AGENT_READ_FALLBACK_TOKENS_DEFAULT_ACU;
  if (!Object.prototype.hasOwnProperty.call(raw, 'finalReview')) {
    raw.finalReview = { enabled: false, readTokenBudget: CONTINUATION_FINAL_REVIEW_READ_TOKEN_BUDGET_DEFAULT_ACU, maxExtraReads: CONTINUATION_FINAL_REVIEW_MAX_EXTRA_READS_DEFAULT_ACU };
  }
  // 节奏规则从「每阶段固定低压占比」改为「阶段形态 + 跨阶段连续高压上限」，旧键已无对应语义：
  // 直接丢掉并补新键的默认值，保留旧值反而会把用户配过的比例误当成新语义使用。
  if (Object.prototype.hasOwnProperty.call(raw, 'downtimeTurnRatio')) delete raw.downtimeTurnRatio;
  if (!Object.prototype.hasOwnProperty.call(raw, 'maxConsecutivePressureTurns')) raw.maxConsecutivePressureTurns = CONTINUATION_MAX_CONSECUTIVE_PRESSURE_TURNS_DEFAULT_ACU;
  // prompt_cache_key 会干扰部分 Codex 兼容渠道的前缀缓存。开关已退役：缺键补 false，
  // 存量 true 也在下面无条件改成 false，避免旧信封继续往请求体里塞 key。
  raw.promptCacheEnabled = false;
  // contextTurnCount 在续写链路里从未被任何渲染消费（V17 起彻底退役）；直接丢掉即无感迁移。
  if (Object.prototype.hasOwnProperty.call(raw, 'contextTurnCount')) delete raw.contextTurnCount;
  // Agent 运行预算开放为设置（V17）之前的信封没有该字段；补默认即无感迁移。
  if (!Object.prototype.hasOwnProperty.call(raw, 'agentRunBudget')) raw.agentRunBudget = { ...DEFAULT_AGENT_RUN_BUDGET_ACU };
  if (!Object.prototype.hasOwnProperty.call(raw, 'minGenerationTokens')) raw.minGenerationTokens = CONTINUATION_MIN_GENERATION_TOKENS_DEFAULT_ACU;
  // 总纲卷数与阶段轮次是两条独立的尺度。旧信封没有卷数计划时默认采用中线档。
  if (!Object.prototype.hasOwnProperty.call(raw, 'storyArcVolumePlan')) raw.storyArcVolumePlan = 'medium';
  if (!Object.prototype.hasOwnProperty.call(raw, 'customStoryArcVolumeCount')) raw.customStoryArcVolumeCount = null;
  const keys = ['stageSize', 'customTurnMin', 'customTurnMax', 'storyArcVolumePlan', 'customStoryArcVolumeCount', 'outlinePreview', 'autoNextStage', 'maxAutomaticStages', 'loopTags', 'loopDelaySeconds', 'totalDurationMinutes', 'retryDelaySeconds', 'generationRetryLimit', 'internalAiRetryLimit', 'minGenerationTokens', 'maxConsecutivePressureTurns', 'storyWindowFloors', 'agentHistoryTokenBudget', 'storyTailFloors', 'agentReadTokenBudget', 'agentReadFallbackTokens', 'finalReview', 'contextExtractRules', 'contextExcludeRules', 'agentRunBudget', 'apiPresetMode', 'fixedApiPresetName', 'promptCacheEnabled', 'agentApiPresets', 'outlinePrompt', 'agentPrompts'];
  requireKeys_ACU(raw, keys, 'settings', ['promptForceDefaultVersion']);
  if (!['short', 'standard', 'long', 'custom'].includes(raw.stageSize as string)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', 'stageSize 非法');
  const customTurnMin = raw.customTurnMin === null ? null : requireInteger_ACU(raw.customTurnMin, 'settings.customTurnMin', 1);
  const customTurnMax = raw.customTurnMax === null ? null : requireInteger_ACU(raw.customTurnMax, 'settings.customTurnMax', 1);
  if (raw.stageSize === 'custom' && (customTurnMin === null || customTurnMax === null || customTurnMin > customTurnMax || customTurnMax > 50)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', '自定义轮数范围非法');
  if (!['short', 'medium', 'long', 'custom'].includes(raw.storyArcVolumePlan as string)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', 'storyArcVolumePlan 非法');
  const customStoryArcVolumeCount = raw.customStoryArcVolumeCount === null ? null : requireInteger_ACU(raw.customStoryArcVolumeCount, 'settings.customStoryArcVolumeCount', 1);
  if (raw.storyArcVolumePlan === 'custom' && (customStoryArcVolumeCount === null || customStoryArcVolumeCount > 50)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', '自定义总纲卷数必须在 1 到 50 之间');
  if (raw.apiPresetMode === 'follow_plot') raw.apiPresetMode = 'current';
  if (!['current', 'fixed'].includes(raw.apiPresetMode as string)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', 'apiPresetMode 非法');

  let outlinePrompt = raw.outlinePrompt;
  let agentPrompts = raw.agentPrompts;
  let promptForceDefaultVersion = typeof raw.promptForceDefaultVersion === 'string' ? raw.promptForceDefaultVersion : undefined;
  if (promptForceDefaultVersion === CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V17_ACU) {
    agentPrompts = migrateV17AgentPromptsToV18_ACU(agentPrompts);
    agentPrompts = migrateV18AgentPromptsToV19_ACU(agentPrompts);
    agentPrompts = migrateV19AgentPromptsToV20_ACU(agentPrompts);
    agentPrompts = migrateV20AgentPromptsToV21_ACU(agentPrompts);
    agentPrompts = migrateV21AgentPromptsToV22_ACU(agentPrompts);
    agentPrompts = migrateV22AgentPromptsToV23_ACU(agentPrompts);
    outlinePrompt = migrateV22OutlinePromptToV23_ACU(outlinePrompt);
    promptForceDefaultVersion = CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V23_ACU;
  } else if (promptForceDefaultVersion === CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V18_ACU) {
    agentPrompts = migrateV18AgentPromptsToV19_ACU(agentPrompts);
    agentPrompts = migrateV19AgentPromptsToV20_ACU(agentPrompts);
    agentPrompts = migrateV20AgentPromptsToV21_ACU(agentPrompts);
    agentPrompts = migrateV21AgentPromptsToV22_ACU(agentPrompts);
    agentPrompts = migrateV22AgentPromptsToV23_ACU(agentPrompts);
    outlinePrompt = migrateV22OutlinePromptToV23_ACU(outlinePrompt);
    promptForceDefaultVersion = CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V23_ACU;
  } else if (promptForceDefaultVersion === CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V19_ACU) {
    agentPrompts = migrateV19AgentPromptsToV20_ACU(agentPrompts);
    agentPrompts = migrateV20AgentPromptsToV21_ACU(agentPrompts);
    agentPrompts = migrateV21AgentPromptsToV22_ACU(agentPrompts);
    agentPrompts = migrateV22AgentPromptsToV23_ACU(agentPrompts);
    outlinePrompt = migrateV22OutlinePromptToV23_ACU(outlinePrompt);
    promptForceDefaultVersion = CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V23_ACU;
  } else if (promptForceDefaultVersion === CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V20_ACU) {
    agentPrompts = migrateV20AgentPromptsToV21_ACU(agentPrompts);
    agentPrompts = migrateV21AgentPromptsToV22_ACU(agentPrompts);
    agentPrompts = migrateV22AgentPromptsToV23_ACU(agentPrompts);
    outlinePrompt = migrateV22OutlinePromptToV23_ACU(outlinePrompt);
    promptForceDefaultVersion = CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V23_ACU;
  } else if (promptForceDefaultVersion === CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V21_ACU) {
    agentPrompts = migrateV21AgentPromptsToV22_ACU(agentPrompts);
    agentPrompts = migrateV22AgentPromptsToV23_ACU(agentPrompts);
    outlinePrompt = migrateV22OutlinePromptToV23_ACU(outlinePrompt);
    promptForceDefaultVersion = CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V23_ACU;
  } else if (promptForceDefaultVersion === CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V22_ACU) {
    agentPrompts = migrateV22AgentPromptsToV23_ACU(agentPrompts);
    outlinePrompt = migrateV22OutlinePromptToV23_ACU(outlinePrompt);
    promptForceDefaultVersion = CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V23_ACU;
  } else if (promptForceDefaultVersion !== CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V23_ACU) {
    outlinePrompt = buildDefaultContinuationOutlinePrompt_ACU();
    agentPrompts = buildDefaultContinuationAgentPrompts_ACU();
    promptForceDefaultVersion = CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V23_ACU;
  }

  return {
    stageSize: raw.stageSize as ContinuationSettings_ACU['stageSize'], customTurnMin, customTurnMax,
    storyArcVolumePlan: raw.storyArcVolumePlan as ContinuationSettings_ACU['storyArcVolumePlan'], customStoryArcVolumeCount,
    outlinePreview: requireBoolean_ACU(raw.outlinePreview, 'settings.outlinePreview'), autoNextStage: requireBoolean_ACU(raw.autoNextStage, 'settings.autoNextStage'),
    maxAutomaticStages: requireInteger_ACU(raw.maxAutomaticStages, 'settings.maxAutomaticStages', 1), loopTags: requireString_ACU(raw.loopTags, 'settings.loopTags'),
    loopDelaySeconds: requireInteger_ACU(raw.loopDelaySeconds, 'settings.loopDelaySeconds', 0), totalDurationMinutes: requireInteger_ACU(raw.totalDurationMinutes, 'settings.totalDurationMinutes', 0), retryDelaySeconds: requireInteger_ACU(raw.retryDelaySeconds, 'settings.retryDelaySeconds', 0),
    generationRetryLimit: requireInteger_ACU(raw.generationRetryLimit, 'settings.generationRetryLimit', 0), internalAiRetryLimit: requireInteger_ACU(raw.internalAiRetryLimit, 'settings.internalAiRetryLimit', 0), minGenerationTokens: requireInteger_ACU(raw.minGenerationTokens, 'settings.minGenerationTokens', 0), maxConsecutivePressureTurns: requireBoundedInteger_ACU(raw.maxConsecutivePressureTurns, 'settings.maxConsecutivePressureTurns', CONTINUATION_MAX_CONSECUTIVE_PRESSURE_TURNS_MAX_ACU),
    storyWindowFloors: requireInteger_ACU(raw.storyWindowFloors, 'settings.storyWindowFloors', 0), agentHistoryTokenBudget: requireInteger_ACU(raw.agentHistoryTokenBudget, 'settings.agentHistoryTokenBudget', 0),
    storyTailFloors: requireInteger_ACU(raw.storyTailFloors, 'settings.storyTailFloors', 0), agentReadTokenBudget: validateReadTokenBudget_ACU(raw.agentReadTokenBudget), agentReadFallbackTokens: requireInteger_ACU(raw.agentReadFallbackTokens, 'settings.agentReadFallbackTokens', 1),
    finalReview: validateFinalReviewSettings_ACU(raw.finalReview),
    contextExtractRules: validateRules_ACU(raw.contextExtractRules, 'settings.contextExtractRules'), contextExcludeRules: validateRules_ACU(raw.contextExcludeRules, 'settings.contextExcludeRules'),
    agentRunBudget: validateAgentRunBudget_ACU(raw.agentRunBudget),
    apiPresetMode: raw.apiPresetMode as ContinuationSettings_ACU['apiPresetMode'], fixedApiPresetName: requireString_ACU(raw.fixedApiPresetName, 'settings.fixedApiPresetName'),
    promptCacheEnabled: false,
    agentApiPresets: validateAgentApiPresets_ACU(raw.agentApiPresets),
    outlinePrompt: validateContinuationPromptSegments_ACU(outlinePrompt, 'load', 'CONTINUATION_ENVELOPE_INVALID'), agentPrompts: validateAgentPrompts_ACU(agentPrompts),
    promptForceDefaultVersion,
  };
}

function validateOutline_ACU(raw: unknown, settings: ContinuationSettings_ACU) {
  const range = resolveContinuationTurnRange_ACU(settings.stageSize, settings.customTurnMin ?? undefined, settings.customTurnMax ?? undefined);
  try {
    return validateStageOutline_ACU(raw, range);
  } catch (error) {
    if (error instanceof ContinuationValidationError_ACU) throw error;
    fail_ACU('CONTINUATION_ENVELOPE_INVALID', '阶段大纲无效');
  }
}

function validateTimeline_ACU(raw: unknown): any[] {
  if (!Array.isArray(raw)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', 'timeline 必须是数组');
  return raw.map((entry, index) => {
    const path = `activeTask.timeline[${index}]`;
    if (!isRecord_ACU(entry)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', `时间线条目必须是对象：${path}`);
    for (const key of Object.keys(entry)) if (!['id', 'at', 'kind', 'stageId', 'revision', 'nodeId', 'turnId', 'attemptId', 'messageIndex', 'errorCode'].includes(key)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', `时间线存在未知字段：${path}.${key}`);
    const result: Record<string, unknown> = { id: requireString_ACU(entry.id, `${path}.id`), at: requireInteger_ACU(entry.at, `${path}.at`, 0), kind: requireEnum_ACU(entry.kind, TIMELINE_KINDS_ACU, `${path}.kind`) };
    for (const key of ['stageId', 'nodeId', 'turnId', 'attemptId'] as const) if (key in entry) result[key] = requireString_ACU(entry[key], `${path}.${key}`);
    for (const key of ['revision', 'messageIndex'] as const) if (key in entry) result[key] = requireInteger_ACU(entry[key], `${path}.${key}`, 0);
    if ('errorCode' in entry) result.errorCode = requireString_ACU(entry.errorCode, `${path}.errorCode`);
    return result;
  });
}

function validatePendingHostTurn_ACU(raw: unknown): ContinuationEnvelope_ACU['activeTask'] extends infer T ? T extends { pendingHostTurn?: infer P } ? P : never : never {
  if (raw === null || raw === undefined) return null as any;
  if (!isRecord_ACU(raw)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', 'pendingHostTurn 必须是对象或 null');
  requireKeys_ACU(raw, ['identity', 'capture', 'retryCount', 'status'], 'activeTask.pendingHostTurn');
  if (!isRecord_ACU(raw.identity)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', 'pendingHostTurn.identity 必须是对象');
  requireKeys_ACU(raw.identity, ['chatIdentity', 'taskId', 'stageId', 'revision', 'nodeId', 'turnId', 'attemptId'], 'activeTask.pendingHostTurn.identity');
  if (!isRecord_ACU(raw.capture)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', 'pendingHostTurn.capture 必须是对象');
  requireKeys_ACU(raw.capture, ['capturedAt', 'capturedChatLength', 'capturedAiFloorCount', 'generationSeq'], 'activeTask.pendingHostTurn.capture');
  return {
    identity: {
      chatIdentity: requireString_ACU(raw.identity.chatIdentity, 'pendingHostTurn.identity.chatIdentity'),
      taskId: requireString_ACU(raw.identity.taskId, 'pendingHostTurn.identity.taskId'),
      stageId: requireString_ACU(raw.identity.stageId, 'pendingHostTurn.identity.stageId'),
      revision: requireInteger_ACU(raw.identity.revision, 'pendingHostTurn.identity.revision', 1),
      nodeId: requireString_ACU(raw.identity.nodeId, 'pendingHostTurn.identity.nodeId'),
      turnId: requireString_ACU(raw.identity.turnId, 'pendingHostTurn.identity.turnId'),
      attemptId: requireString_ACU(raw.identity.attemptId, 'pendingHostTurn.identity.attemptId'),
    },
    capture: {
      capturedAt: requireInteger_ACU(raw.capture.capturedAt, 'pendingHostTurn.capture.capturedAt', 0),
      capturedChatLength: requireInteger_ACU(raw.capture.capturedChatLength, 'pendingHostTurn.capture.capturedChatLength', 0),
      capturedAiFloorCount: requireInteger_ACU(raw.capture.capturedAiFloorCount, 'pendingHostTurn.capture.capturedAiFloorCount', 0),
      generationSeq: raw.capture.generationSeq === null ? null : requireInteger_ACU(raw.capture.generationSeq, 'pendingHostTurn.capture.generationSeq', 1),
    },
    retryCount: requireInteger_ACU(raw.retryCount, 'pendingHostTurn.retryCount', 0),
    status: requireEnum_ACU(raw.status, ['awaiting_generation', 'retry_ready', 'exhausted'] as const, 'pendingHostTurn.status'),
  } as any;
}

function validateTask_ACU(raw: unknown, settings: ContinuationSettings_ACU): ContinuationEnvelope_ACU['activeTask'] {
  if (!isRecord_ACU(raw)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', 'activeTask 必须是对象或 null');
  const requiredKeys = ['taskId', 'originInstruction', 'status', 'createdAt', 'updatedAt', 'runStartedAt', 'deadlineAt', 'runStageCount', 'activeStageId', 'stages', 'timeline', 'stopReason', 'lastError'];
  const allowedKeys = [...requiredKeys, 'pendingHostTurn', 'stageBudgetBaseCount'];
  for (const key of requiredKeys) if (!Object.prototype.hasOwnProperty.call(raw, key)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', `缺少持久化字段：activeTask.${key}`, { path: `activeTask.${key}` });
  for (const key of Object.keys(raw)) if (!allowedKeys.includes(key)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', `存在未知持久化字段：activeTask.${key}`, { path: `activeTask.${key}` });
  const runStageCount = requireInteger_ACU(raw.runStageCount, 'activeTask.runStageCount', 0);
  const stageBudgetBaseCount = 'stageBudgetBaseCount' in raw ? requireInteger_ACU(raw.stageBudgetBaseCount, 'activeTask.stageBudgetBaseCount', 0) : 0;
  if (stageBudgetBaseCount > runStageCount) {
    fail_ACU('CONTINUATION_ENVELOPE_INVALID', 'stageBudgetBaseCount 不能大于 runStageCount', { path: 'activeTask.stageBudgetBaseCount' });
  }
  const status = requireEnum_ACU(raw.status, TASK_STATUSES_ACU, 'activeTask.status');
  if (!Array.isArray(raw.stages)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', 'activeTask.stages 必须是数组');
  const stageIds = new Set<string>();
  const stages = raw.stages.map((stage, index) => {
    const path = `activeTask.stages[${index}]`;
    if (!isRecord_ACU(stage)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', `阶段必须是对象：${path}`);
    // 阶段纪要统计链（chronicle*）在 V17 彻底退役；旧信封先就地丢弃再进入严格键校验。
    for (const legacyKey of ['chronicleStartCount', 'chronicleEndCount', 'chronicleAddedCount', 'chronicleRange']) {
      if (Object.prototype.hasOwnProperty.call(stage, legacyKey)) delete stage[legacyKey];
    }
    const stageKeys = ['stageId', 'stageNumber', 'status', 'activeRevision', 'revisions', 'activeNodeIndex', 'activeTurnIndex', 'completedTurns'];
    requireKeys_ACU(stage, stageKeys, path);
    const stageId = requireString_ACU(stage.stageId, `${path}.stageId`);
    if (stageIds.has(stageId)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', `阶段 ID 重复：${stageId}`);
    stageIds.add(stageId);
    const stageStatus = requireEnum_ACU(stage.status, STAGE_STATUSES_ACU, `${path}.status`);
    if (!Array.isArray(stage.revisions) || stage.revisions.length === 0) fail_ACU('CONTINUATION_ENVELOPE_INVALID', `阶段 revisions 必须是非空数组：${path}`);
    const revisionNumbers = new Set<number>();
    const revisions = stage.revisions.map((revision, revisionIndex) => {
      const revisionPath = `${path}.revisions[${revisionIndex}]`;
      if (!isRecord_ACU(revision)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', `revision 必须是对象：${revisionPath}`);
      requireKeys_ACU(revision, ['revision', 'createdAt', 'reason', 'replanInstruction', 'frozen', 'outline'], revisionPath);
      const number = requireInteger_ACU(revision.revision, `${revisionPath}.revision`, 1);
      if (revisionNumbers.has(number)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', `revision 重复：${revisionPath}.revision`);
      revisionNumbers.add(number);
      return { revision: number, createdAt: requireInteger_ACU(revision.createdAt, `${revisionPath}.createdAt`, 0), reason: requireEnum_ACU(revision.reason, REVISION_REASONS_ACU, `${revisionPath}.reason`), replanInstruction: requireString_ACU(revision.replanInstruction, `${revisionPath}.replanInstruction`), frozen: requireBoolean_ACU(revision.frozen, `${revisionPath}.frozen`), outline: validateOutline_ACU(revision.outline, settings) };
    });
    const activeRevision = requireInteger_ACU(stage.activeRevision, `${path}.activeRevision`, 1);
    if (!revisionNumbers.has(activeRevision)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', `activeRevision 未指向现有 revision：${path}`);
    return { stageId, stageNumber: requireInteger_ACU(stage.stageNumber, `${path}.stageNumber`, 1), status: stageStatus, activeRevision, revisions, activeNodeIndex: requireInteger_ACU(stage.activeNodeIndex, `${path}.activeNodeIndex`, 0), activeTurnIndex: requireInteger_ACU(stage.activeTurnIndex, `${path}.activeTurnIndex`, 0), completedTurns: requireInteger_ACU(stage.completedTurns, `${path}.completedTurns`, 0) };
  });
  const activeStageId = raw.activeStageId === null ? null : requireString_ACU(raw.activeStageId, 'activeTask.activeStageId');
  if (activeStageId !== null && !stageIds.has(activeStageId)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', 'activeStageId 未指向现有阶段');
  const stopReason = raw.stopReason === null ? null : requireEnum_ACU(raw.stopReason, STOP_REASONS_ACU, 'activeTask.stopReason');
  const lastError = raw.lastError === null ? null : (() => {
    if (!isRecord_ACU(raw.lastError)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', 'lastError 必须是对象');
    const requiredErrorKeys = ['code', 'message', 'phase', 'retryable'];
    for (const key of requiredErrorKeys) if (!Object.prototype.hasOwnProperty.call(raw.lastError, key)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', `缺少持久化字段：activeTask.lastError.${key}`, { path: `activeTask.lastError.${key}` });
    for (const key of Object.keys(raw.lastError)) if (![...requiredErrorKeys, 'details'].includes(key)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', `存在未知持久化字段：activeTask.lastError.${key}`, { path: `activeTask.lastError.${key}` });
    const error: Record<string, unknown> = {
      code: requireEnum_ACU(raw.lastError.code, ERROR_CODES_ACU, 'activeTask.lastError.code'),
      message: requireString_ACU(raw.lastError.message, 'activeTask.lastError.message'),
      phase: requireEnum_ACU(raw.lastError.phase, ERROR_PHASES_ACU, 'activeTask.lastError.phase'),
      retryable: requireBoolean_ACU(raw.lastError.retryable, 'activeTask.lastError.retryable'),
    };
    if ('details' in raw.lastError) { if (!isRecord_ACU(raw.lastError.details)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', 'lastError.details 必须是对象'); error.details = { ...raw.lastError.details }; }
    return error;
  })();
  return { taskId: requireString_ACU(raw.taskId, 'activeTask.taskId'), originInstruction: requireString_ACU(raw.originInstruction, 'activeTask.originInstruction'), status, createdAt: requireInteger_ACU(raw.createdAt, 'activeTask.createdAt', 0), updatedAt: requireInteger_ACU(raw.updatedAt, 'activeTask.updatedAt', 0), runStartedAt: raw.runStartedAt === null ? null : requireInteger_ACU(raw.runStartedAt, 'activeTask.runStartedAt', 0), deadlineAt: raw.deadlineAt === null ? null : requireInteger_ACU(raw.deadlineAt, 'activeTask.deadlineAt', 0), runStageCount, stageBudgetBaseCount, activeStageId, stages, timeline: validateTimeline_ACU(raw.timeline), stopReason, lastError: lastError as any, ...('pendingHostTurn' in raw ? { pendingHostTurn: validatePendingHostTurn_ACU(raw.pendingHostTurn) } : {}) } as ContinuationEnvelope_ACU['activeTask'];
}

export function validateContinuationEnvelope_ACU(raw: unknown, phase: ContinuationErrorPhase_ACU = 'load'): ContinuationEnvelope_ACU {
  try {
    if (!isRecord_ACU(raw)) fail_ACU('CONTINUATION_ENVELOPE_INVALID', '智能续写状态必须是对象');
    requireKeys_ACU(raw, ['schemaVersion', 'settings', 'activeTask'], 'envelope');
    if (raw.schemaVersion !== CONTINUATION_SCHEMA_VERSION_ACU) fail_ACU('CONTINUATION_ENVELOPE_INVALID', '智能续写 schemaVersion 必须为 1', { actual: raw.schemaVersion });
    const settings = validateSettings_ACU(raw.settings);
    const activeTask = raw.activeTask === null ? null : validateTask_ACU(raw.activeTask, settings);
    return { schemaVersion: CONTINUATION_SCHEMA_VERSION_ACU, settings, activeTask };
  } catch (error) {
    if (error instanceof ContinuationValidationError_ACU && error.error.phase !== phase) {
      throw new ContinuationValidationError_ACU(createContinuationError_ACU(error.error.code, phase, error.error.message, error.error.retryable, error.error.details));
    }
    throw error;
  }
}

function getActiveRevision_ACU(envelope: ContinuationEnvelope_ACU | null): number | null {
  const task = envelope?.activeTask ?? null;
  if (!task || !task.activeStageId) return null;
  return task.stages.find(stage => stage.stageId === task.activeStageId)?.activeRevision ?? null;
}

function assertWriteGuard_ACU(envelope: ContinuationEnvelope_ACU | null, guard: ContinuationWriteGuard_ACU | undefined): void {
  if (!guard) return;
  const task = envelope?.activeTask ?? null;
  if (guard.taskId !== undefined && (task?.taskId ?? null) !== guard.taskId) fail_ACU('CONTINUATION_WRITE_GUARD_MISMATCH', '任务身份已变化');
  if (guard.stageId !== undefined && (task?.activeStageId ?? null) !== guard.stageId) fail_ACU('CONTINUATION_WRITE_GUARD_MISMATCH', '阶段身份已变化');
  if (guard.revision !== undefined && getActiveRevision_ACU(envelope) !== guard.revision) fail_ACU('CONTINUATION_WRITE_GUARD_MISMATCH', 'revision 已变化');
}

function captureChatContext_ACU(guard?: ContinuationWriteGuard_ACU) {
  const chat = getChatArray_ACU();
  const firstMessage = Array.isArray(chat) && chat[0] && typeof chat[0] === 'object' ? chat[0] as Record<string, unknown> : null;
  const chatIdentity = getActiveChatStorageIdentity_ACU(chat);
  if (!firstMessage || !chatIdentity) fail_ACU('CONTINUATION_CHAT_UNAVAILABLE', '当前聊天首楼不可用');
  if (guard?.chatIdentity !== undefined && guard.chatIdentity !== chatIdentity) fail_ACU('CONTINUATION_CHAT_CHANGED', '写入身份所属聊天已变化');
  return { chat, firstMessage, chatIdentity };
}

function assertChatContext_ACU(context: ReturnType<typeof captureChatContext_ACU>): void {
  const activeChat = getChatArray_ACU();
  if (activeChat !== context.chat || activeChat[0] !== context.firstMessage || getActiveChatStorageIdentity_ACU(activeChat) !== context.chatIdentity) {
    fail_ACU('CONTINUATION_CHAT_CHANGED', '目标聊天已切换，拒绝写入');
  }
}

function readRawEnvelope_ACU(firstMessage: Record<string, unknown>): ContinuationEnvelope_ACU | null {
  const raw = firstMessage[CONTINUATION_FIRST_FLOOR_FIELD_ACU];
  return raw === undefined ? null : validateContinuationEnvelope_ACU(raw);
}

function restoreFirstFloorField_ACU(firstMessage: Record<string, unknown>, hadPreviousValue: boolean, previousValue: unknown): void {
  if (hadPreviousValue) firstMessage[CONTINUATION_FIRST_FLOOR_FIELD_ACU] = previousValue;
  else delete firstMessage[CONTINUATION_FIRST_FLOOR_FIELD_ACU];
}

/**
 * First-floor-only persistence. This module deliberately does not call any chatMetadata helper.
 */
export class FirstFloorContinuationStore_ACU {
  private static writeTailsByChatIdentity_ACU = new Map<string, Promise<void>>();

  read(): ContinuationEnvelope_ACU | null {
    const context = captureChatContext_ACU();
    const envelope = readRawEnvelope_ACU(context.firstMessage);
    return envelope === null ? null : reconcileContinuationEnvelopeCursor_ACU(
      derivePausedContinuationEnvelopeAfterReload_ACU(envelope),
      Array.isArray(context.chat) ? context.chat.length : 0,
    );
  }

  /** Reads the validated persisted snapshot without applying reload recovery. Runtime state machines must use this. */
  readPersisted(): ContinuationEnvelope_ACU | null {
    const context = captureChatContext_ACU();
    return readRawEnvelope_ACU(context.firstMessage);
  }

  async replaceAtomically(candidate: ContinuationEnvelope_ACU, guard?: ContinuationWriteGuard_ACU): Promise<void> {
    return this.enqueueWrite_ACU(context => this.replaceWithinQueue_ACU(candidate, guard, context), guard);
  }

  async updateAtomically(mutator: (current: ContinuationEnvelope_ACU | null) => ContinuationEnvelope_ACU, guard?: ContinuationWriteGuard_ACU): Promise<void> {
    return this.enqueueWrite_ACU(async context => {
      assertChatContext_ACU(context);
      const persisted = readRawEnvelope_ACU(context.firstMessage);
      assertWriteGuard_ACU(persisted, guard);
      const current = persisted === null ? null : derivePausedContinuationEnvelopeAfterReload_ACU(persisted);
      const candidate = mutator(current);
      await this.replaceWithinQueue_ACU(candidate, guard, context);
    }, guard);
  }

  /** Updates the persisted snapshot without deriving a reload pause transition. */
  async updatePersistedAtomically(mutator: (current: ContinuationEnvelope_ACU | null) => ContinuationEnvelope_ACU, guard?: ContinuationWriteGuard_ACU): Promise<void> {
    return this.enqueueWrite_ACU(async context => {
      assertChatContext_ACU(context);
      const current = readRawEnvelope_ACU(context.firstMessage);
      assertWriteGuard_ACU(current, guard);
      const candidate = mutator(current);
      await this.replaceWithinQueue_ACU(candidate, guard, context);
    }, guard);
  }

  private async replaceWithinQueue_ACU(candidate: ContinuationEnvelope_ACU, guard: ContinuationWriteGuard_ACU | undefined, context: ReturnType<typeof captureChatContext_ACU>): Promise<void> {
    assertChatContext_ACU(context);
    const current = readRawEnvelope_ACU(context.firstMessage);
    assertWriteGuard_ACU(current, guard);
    const validatedCandidate = validateContinuationEnvelope_ACU(candidate, 'persist');
    const hadPreviousValue = Object.prototype.hasOwnProperty.call(context.firstMessage, CONTINUATION_FIRST_FLOOR_FIELD_ACU);
    const previousValue = context.firstMessage[CONTINUATION_FIRST_FLOOR_FIELD_ACU];
    let primarySaveAttempted = false;
    try {
      context.firstMessage[CONTINUATION_FIRST_FLOOR_FIELD_ACU] = validatedCandidate;
      assertChatContext_ACU(context);
      primarySaveAttempted = true;
      await saveChatToHostStrict_ACU();
      assertChatContext_ACU(context);
    } catch (error) {
      restoreFirstFloorField_ACU(context.firstMessage, hadPreviousValue, previousValue);
      const chatStillActive = getChatArray_ACU() === context.chat && getChatArray_ACU()[0] === context.firstMessage && getActiveChatStorageIdentity_ACU(context.chat) === context.chatIdentity;
      if (primarySaveAttempted && chatStillActive) {
        try { await saveChatToHostStrict_ACU(); }
        catch (rollbackError) { fail_ACU('CONTINUATION_PERSIST_FAILED', '智能续写状态保存与回滚均失败', { primaryMessage: error instanceof Error ? error.message : String(error), rollbackMessage: rollbackError instanceof Error ? rollbackError.message : String(rollbackError) }); }
      }
      if (error instanceof ContinuationValidationError_ACU) throw error;
      fail_ACU('CONTINUATION_PERSIST_FAILED', '智能续写状态保存失败', { message: error instanceof Error ? error.message : String(error) });
    }
  }

  private enqueueWrite_ACU(operation: (context: ReturnType<typeof captureChatContext_ACU>) => Promise<void>, guard?: ContinuationWriteGuard_ACU): Promise<void> {
    const context = captureChatContext_ACU(guard);
    const previous = FirstFloorContinuationStore_ACU.writeTailsByChatIdentity_ACU.get(context.chatIdentity) ?? Promise.resolve();
    const result = previous.then(() => operation(context), () => operation(context));
    const settled: Promise<void> = result.catch((): void => undefined);
    FirstFloorContinuationStore_ACU.writeTailsByChatIdentity_ACU.set(context.chatIdentity, settled);
    void settled.finally(() => {
      if (FirstFloorContinuationStore_ACU.writeTailsByChatIdentity_ACU.get(context.chatIdentity) === settled) {
        FirstFloorContinuationStore_ACU.writeTailsByChatIdentity_ACU.delete(context.chatIdentity);
      }
    });
    return result;
  }
}

export function derivePausedContinuationEnvelopeAfterReload_ACU(envelope: ContinuationEnvelope_ACU): ContinuationEnvelope_ACU {
  const validated = validateContinuationEnvelope_ACU(envelope);
  const task = validated.activeTask;
  if (!task) return validated;
  const activeStage = task.activeStageId ? task.stages.find(stage => stage.stageId === task.activeStageId) : undefined;
  const interruptedPlanning = activeStage?.status === 'planning';
  if (!interruptedPlanning && !['running', 'stopping_after_inflight', 'drafting'].includes(task.status)) return validated;
  const stages = interruptedPlanning
    ? task.stages.map(stage => stage.stageId === activeStage!.stageId ? { ...stage, status: 'failed' as const } : stage)
    : task.stages;
  const lastError = interruptedPlanning
    ? createContinuationError_ACU('CONTINUATION_TASK_STATE_INVALID', 'load', '重载中断了阶段规划；请手动重新规划剩余阶段', false)
    : task.lastError;
  // 重载后桥的内存认领已丢失，等待中的宿主生成永远无法再被归属；
  // 清掉等待轮，让任务回到可以直接点继续的暂停态。
  const pendingHostTurn = task.pendingHostTurn?.status === 'awaiting_generation' ? null : task.pendingHostTurn;
  return { ...validated, activeTask: { ...task, status: 'paused', updatedAt: Date.now(), stages, lastError, ...(pendingHostTurn !== task.pendingHostTurn ? { pendingHostTurn } : {}) } };
}

function readLegacyNonNegativeInteger_ACU(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function readLegacyRules_ACU(value: unknown): { start: string; end: string }[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord_ACU).flatMap(rule => typeof rule.start === 'string' && typeof rule.end === 'string' ? [{ start: rule.start, end: rule.end }] : []);
}

/** One-way migration: retained settings only; prompt rotation fields are intentionally excluded. */
export function buildLegacyContinuationMigration_ACU(legacyPlotSettings: unknown, baseSettings?: ContinuationSettings_ACU): { settings: ContinuationSettings_ACU; didMigrate: boolean } {
  const settings = baseSettings ?? buildDefaultContinuationSettings_ACU();
  if (!isRecord_ACU(legacyPlotSettings)) return { settings, didMigrate: false };
  const loopSettings = isRecord_ACU(legacyPlotSettings.loopSettings) ? legacyPlotSettings.loopSettings : {};
  settings.loopTags = typeof loopSettings.loopTags === 'string' ? loopSettings.loopTags : settings.loopTags;
  settings.loopDelaySeconds = readLegacyNonNegativeInteger_ACU(loopSettings.loopDelay, settings.loopDelaySeconds);
  settings.retryDelaySeconds = readLegacyNonNegativeInteger_ACU(loopSettings.retryDelay, settings.retryDelaySeconds);
  settings.totalDurationMinutes = readLegacyNonNegativeInteger_ACU(loopSettings.loopTotalDuration, settings.totalDurationMinutes);
  settings.generationRetryLimit = readLegacyNonNegativeInteger_ACU(loopSettings.maxRetries, settings.generationRetryLimit);
  settings.contextExtractRules = readLegacyRules_ACU(legacyPlotSettings.contextExtractRules);
  settings.contextExcludeRules = readLegacyRules_ACU(legacyPlotSettings.contextExcludeRules);
  return { settings, didMigrate: true };
}

/** Builds a first-floor candidate from the explicitly supplied legacy plot settings. */
export function buildMigratedContinuationEnvelope_ACU(legacyPlotSettings: unknown, baseSettings?: ContinuationSettings_ACU): { envelope: ContinuationEnvelope_ACU; didMigrate: boolean } {
  const migration = buildLegacyContinuationMigration_ACU(legacyPlotSettings, baseSettings);
  return {
    envelope: { schemaVersion: CONTINUATION_SCHEMA_VERSION_ACU, settings: migration.settings, activeTask: null },
    didMigrate: migration.didMigrate,
  };
}

export function stripLegacyContinuationLoopFields_ACU(source: unknown): unknown {
  return stripLegacyLoopPromptFields_ACU(source);
}
