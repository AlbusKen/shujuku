import { CONTINUATION_TURN_RANGES_ACU } from './defaults';
import {
  CONTINUATION_SCHEMA_VERSION_ACU,
  ContinuationValidationError_ACU,
  createContinuationError_ACU,
  STAGE_ROLES_ACU,
  STAGE_TEMPOS_ACU,
  STAGE_TURN_DOWNTIME_PACINGS_ACU,
  STAGE_TURN_FUNCTIONS_ACU,
  STAGE_TURN_MAINLINE_DELTAS_ACU,
  STAGE_TURN_PACINGS_ACU,
  STAGE_TURN_SOFT_FIELDS_ACU,
  STAGE_TURN_TIME_ADVANCES_ACU,
  type ContinuationErrorCode_ACU,
  type ContinuationErrorPhase_ACU,
  type ContinuationReplanConstraints_ACU,
  type ContinuationStage_ACU,
  type ContinuationStageSize_ACU,
  type ContinuationTurnRange_ACU,
  type StageNode_ACU,
  type StageOutline_ACU,
  type StageRole_ACU,
  type StageTempo_ACU,
  type StageTurn_ACU,
  type StageTurnFunction_ACU,
  type StageTurnMainlineDelta_ACU,
  type StageTurnPacing_ACU,
  type StageTurnSoftField_ACU,
  type StageTurnTimeAdvance_ACU,
} from './model';

const OUTLINE_KEYS_ACU = ['schemaVersion', 'title', 'goal', 'totalTurns', 'nodes'] as const;
/** tempo 与 pacing 同理：晚于其余字段加入，写成必填会让存量信封加载即失败。缺失回填 mixed。 */
const OUTLINE_OPTIONAL_KEYS_ACU = ['tempo', 'role', 'timeSpanGoal'] as const;
const DEFAULT_STAGE_TEMPO_ACU: StageTempo_ACU = 'mixed';
const NODE_KEYS_ACU = ['id', 'title', 'goal', 'suggestedTurns', 'turns'] as const;
const TURN_KEYS_ACU = ['id', 'goal'] as const;
/**
 * pacing 晚于 turn 的其余字段加入。信封每次加载都会对所有历史 revision 重跑本校验器，
 * 写成必填会让全部存量任务加载即失败，因此它是可选键：缺失时回填 pressure。
 */
const TURN_OPTIONAL_KEYS_ACU = ['pacing', 'function', 'mainlineDelta', 'timeAdvance', 'timeAnchor', 'inferred'] as const;
const DEFAULT_TURN_PACING_ACU: StageTurnPacing_ACU = 'pressure';

/**
 * 语义字段按 pacing 分档回填。回填值必须与 pacing 自洽：给 pressure 轮填 hold/transition
 * 会让旧阶段在后续编辑时被组合规则打回，也会把“冲突轮”显示成“过渡轮”。
 */
const TURN_SOFT_DEFAULTS_ACU: Record<StageTurnPacing_ACU, { function: StageTurnFunction_ACU; mainlineDelta: StageTurnMainlineDelta_ACU; timeAdvance: StageTurnTimeAdvance_ACU }> = {
  setup: { function: 'transition', mainlineDelta: 'hold', timeAdvance: 'same_day' },
  cooldown: { function: 'recovery', mainlineDelta: 'hold', timeAdvance: 'overnight' },
  pressure: { function: 'conflict', mainlineDelta: 'step', timeAdvance: 'continuous' },
  turn: { function: 'reveal', mainlineDelta: 'step', timeAdvance: 'continuous' },
};

type StageOutlineValidationMode_ACU = 'persisted' | 'generated' | 'replanned';

/**
 * 软字段（function / mainlineDelta / timeAdvance / role，以及新生成时的 pacing / tempo）缺失或非法时的处理策略：
 * - default：按 pacing 分档补默认并打 inferred 标记（旧快照读取、用户手改、Agent 编辑）
 * - collect：同样补默认，但把缺项收集进 missing 列表供调用方向模型索要修补（生成链路）
 * - reject：直接抛出字段错误（保留给需要硬失败的调用方）
 */
export type OutlineSoftFieldPolicy_ACU = 'default' | 'collect' | 'reject';

export type OutlineMissingFieldName_ACU = 'pacing' | 'function' | 'mainlineDelta' | 'timeAdvance' | 'timeAnchor' | 'tempo' | 'role';

/** 一条待修补的缺项。nodeIndex/turnIndex 是整份大纲里的 0 基位置；阶段级字段两者为 null。 */
export interface OutlineMissingField_ACU {
  field: OutlineMissingFieldName_ACU;
  nodeIndex: number | null;
  turnIndex: number | null;
  /** 该轮 goal 的开头，供修补提示引用定位。 */
  goalHead: string;
  /** 模型原文（缺失时为 undefined）。 */
  actual: unknown;
  /** 缺失后是否已被默认值填补（pacing / tempo 不能安全默认，为 false）。 */
  defaulted: boolean;
}

export interface StageOutlineValidation_ACU {
  outline: StageOutline_ACU;
  missing: OutlineMissingField_ACU[];
}

interface ValidationState_ACU {
  mode: StageOutlineValidationMode_ACU;
  policy: OutlineSoftFieldPolicy_ACU;
  strictFromTurn: number;
  missing: OutlineMissingField_ACU[];
}

const LONG_TIME_ADVANCES_ACU: readonly StageTurnTimeAdvance_ACU[] = ['weeks', 'months', 'years'];

/**
 * 各阶段形态的低压轮（setup + cooldown）下限占比。
 *
 * 这张表取代了旧的「全局统一占比 + 阶段内连续上限」。旧规则在数学上只有锯齿解：8 轮阶段
 * 要求 3 轮低压且任意连续 4 轮内必有 1 轮低压，读者感知到的是固定节拍器，而且开篇铺垫与
 * 最终决战被要求同样的配比。分档之后，阶段内不再有任何周期限制——低压轮可以扎堆在开头、
 * 结尾或中段，形态之间的差异才是读者感知到的起伏。
 */
export const STAGE_TEMPO_DOWNTIME_FLOOR_ACU: Readonly<Record<StageTempo_ACU, number>> = {
  buildup: 0.5,
  mixed: 0.25,
  surge: 0,
  aftermath: 0.6,
};

const STAGE_TEMPO_LABELS_ACU: Readonly<Record<StageTempo_ACU, string>> = {
  buildup: '铺垫型',
  mixed: '起伏型',
  surge: '高压型',
  aftermath: '余波型',
};

/** 渲染形态名称，错误信息与提示词共用同一口径。 */
export function describeStageTempo_ACU(tempo: StageTempo_ACU): string {
  return `${tempo}（${STAGE_TEMPO_LABELS_ACU[tempo]}）`;
}

function fail_ACU(code: ContinuationErrorCode_ACU, phase: ContinuationErrorPhase_ACU, message: string, details?: Record<string, unknown>): never {
  throw new ContinuationValidationError_ACU(createContinuationError_ACU(code, phase, message, false, details));
}

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys_ACU(value: Record<string, unknown>, keys: readonly string[], path: string, optionalKeys: readonly string[] = []): void {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      fail_ACU('CONTINUATION_OUTLINE_FIELD_MISSING', 'outline_validate', `缺少必填字段：${path}.${key}`, { path: `${path}.${key}` });
    }
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key) && !optionalKeys.includes(key)) {
      fail_ACU('CONTINUATION_OUTLINE_UNKNOWN_FIELD', 'outline_validate', `存在未知字段：${path}.${key}`, { path: `${path}.${key}` });
    }
  }
}

function requireText_ACU(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    fail_ACU('CONTINUATION_OUTLINE_FIELD_TYPE_INVALID', 'outline_validate', `字段必须是字符串：${path}`, { path });
  }
  if (value.trim().length === 0) {
    fail_ACU('CONTINUATION_OUTLINE_STRING_EMPTY', 'outline_validate', `字段不能为空：${path}`, { path });
  }
  return value;
}

function optionalText_ACU(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;
  return requireText_ACU(value, path);
}

function isEnumValue_ACU<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

function goalHead_ACU(goal: unknown): string {
  const flat = typeof goal === 'string' ? goal.replace(/\s+/g, ' ').trim() : '';
  return flat.length <= 24 ? flat : `${flat.slice(0, 24)}…`;
}

function requirePositiveInteger_ACU(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    fail_ACU('CONTINUATION_OUTLINE_FIELD_TYPE_INVALID', 'outline_validate', `字段必须是整数：${path}`, { path });
  }
  if (value <= 0) {
    fail_ACU('CONTINUATION_OUTLINE_SUGGESTED_TURNS_INVALID', 'outline_validate', `字段必须为正整数：${path}`, { path });
  }
  return value;
}

/**
 * 解析一个软枚举字段。合法直接返回；缺失/非法时按策略处理：reject 抛错，
 * default/collect 返回 fallback 并（collect 时）记录缺项。
 */
function resolveSoftEnum_ACU<T extends string>(
  state: ValidationState_ACU,
  strict: boolean,
  value: unknown,
  values: readonly T[],
  field: OutlineMissingFieldName_ACU,
  label: string,
  path: string,
  fallback: T | null,
  position: { nodeIndex: number | null; turnIndex: number | null; goalHead: string },
): { value: T; inferred: boolean } {
  if (isEnumValue_ACU(value, values)) return { value, inferred: false };
  const missing = value === undefined || value === null || value === '';
  // 非严格（持久化 / 已完成前缀）路径：缺失静默回填；写了非法值仍然是数据损坏，必须报。
  if (!strict) {
    if (missing && fallback !== null) return { value: fallback, inferred: true };
    fail_ACU('CONTINUATION_OUTLINE_FIELD_TYPE_INVALID', 'outline_validate', `${label}必须是 ${values.join(' / ')} 之一：${path}`, { path, actual: value });
  }
  if (state.policy === 'reject' || fallback === null) {
    if (state.policy === 'collect' && fallback === null) {
      // pacing / tempo 没有安全默认：先记缺项，用占位值让结构校验能继续，最终由调用方决定是否硬失败。
      state.missing.push({ field, ...position, actual: value, defaulted: false });
      return { value: values[0], inferred: true };
    }
    fail_ACU('CONTINUATION_OUTLINE_FIELD_TYPE_INVALID', 'outline_validate', `${label}必须是 ${values.join(' / ')} 之一：${path}`, { path, actual: value });
  }
  if (state.policy === 'collect') state.missing.push({ field, ...position, actual: value, defaulted: true });
  return { value: fallback, inferred: true };
}

/**
 * 组合规则只保留与 pacing 直接矛盾、能被机械判定的两条；不再用关键词正则猜测 goal 散文里
 * 有没有“可观察变化”——那类规则在真实语料上误杀率太高，只会逼模型堆关键词。
 * 矛盾组合按策略处理：严格生成时记为缺项（让模型改），其余路径降级到 pacing 默认值并标记 inferred。
 */
function reconcileTurnSemantics_ACU(state: ValidationState_ACU, strict: boolean, turn: StageTurn_ACU, role: StageRole_ACU, position: { nodeIndex: number; turnIndex: number; goalHead: string }): void {
  const inferred = new Set(turn.inferred ?? []);
  const defaults = TURN_SOFT_DEFAULTS_ACU[turn.pacing];
  if (turn.pacing === 'setup' && turn.function === 'conflict') {
    if (strict && state.policy === 'collect') state.missing.push({ field: 'function', nodeIndex: position.nodeIndex, turnIndex: position.turnIndex, goalHead: position.goalHead, actual: 'conflict（setup 轮不能承担 conflict 功能）', defaulted: true });
    else if (strict && state.policy === 'reject') fail_ACU('CONTINUATION_OUTLINE_FIELD_TYPE_INVALID', 'outline_validate', `setup 轮不能承担 conflict 功能：nodes[${position.nodeIndex}].turns[${position.turnIndex}]`, { rule: 'setup_conflict' });
    turn.function = defaults.function;
    inferred.add('function');
  }
  if ((turn.pacing === 'setup' || turn.pacing === 'cooldown') && turn.mainlineDelta === 'milestone' && !(turn.function === 'payoff' && role === 'payoff')) {
    if (strict && state.policy === 'collect') state.missing.push({ field: 'mainlineDelta', nodeIndex: position.nodeIndex, turnIndex: position.turnIndex, goalHead: position.goalHead, actual: 'milestone（低压轮不能推进 milestone，除非 payoff 阶段以 payoff 功能兑现）', defaulted: true });
    else if (strict && state.policy === 'reject') fail_ACU('CONTINUATION_OUTLINE_FIELD_TYPE_INVALID', 'outline_validate', `低压轮不能推进 milestone：nodes[${position.nodeIndex}].turns[${position.turnIndex}]`, { rule: 'downtime_milestone' });
    turn.mainlineDelta = 'micro';
    inferred.add('mainlineDelta');
  }
  if (strict && LONG_TIME_ADVANCES_ACU.includes(turn.timeAdvance!) && !turn.timeAnchor) {
    // anchor 是自然语言，没有可机械补的默认值；严格生成时索要，其余路径放行。
    if (state.policy === 'collect') state.missing.push({ field: 'timeAnchor', nodeIndex: position.nodeIndex, turnIndex: position.turnIndex, goalHead: position.goalHead, actual: undefined, defaulted: true });
    else if (state.policy === 'reject') fail_ACU('CONTINUATION_OUTLINE_FIELD_MISSING', 'outline_validate', `较大时间跨度必须提供 timeAnchor：nodes[${position.nodeIndex}].turns[${position.turnIndex}].timeAnchor`, { rule: 'long_time_anchor' });
  }
  if (inferred.size) turn.inferred = [...inferred] as StageTurn_ACU['inferred'];
  else delete turn.inferred;
}

function validateInferred_ACU(value: unknown, path: string): StageTurn_ACU['inferred'] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some(item => !isEnumValue_ACU(item, STAGE_TURN_SOFT_FIELDS_ACU))) {
    fail_ACU('CONTINUATION_OUTLINE_FIELD_TYPE_INVALID', 'outline_validate', `inferred 必须是 ${STAGE_TURN_SOFT_FIELDS_ACU.join(' / ')} 的数组：${path}`, { path });
  }
  return value.length ? [...new Set(value as StageTurn_ACU['inferred'])] : undefined;
}

function validateTurn_ACU(raw: unknown, path: string, strict: boolean, role: StageRole_ACU, state: ValidationState_ACU, nodeIndex: number, turnIndex: number): StageTurn_ACU {
  if (!isRecord_ACU(raw)) {
    fail_ACU('CONTINUATION_OUTLINE_FIELD_TYPE_INVALID', 'outline_validate', `字段必须是对象：${path}`, { path });
  }
  assertExactKeys_ACU(raw, TURN_KEYS_ACU, path, TURN_OPTIONAL_KEYS_ACU);
  const goal = requireText_ACU(raw.goal, `${path}.goal`);
  const position = { nodeIndex, turnIndex, goalHead: goalHead_ACU(goal) };
  const pacing = resolveSoftEnum_ACU(state, strict, raw.pacing, STAGE_TURN_PACINGS_ACU, 'pacing', '节奏档', `${path}.pacing`, strict ? null : DEFAULT_TURN_PACING_ACU, position);
  const defaults = TURN_SOFT_DEFAULTS_ACU[pacing.value];
  const fn = resolveSoftEnum_ACU(state, strict, raw.function, STAGE_TURN_FUNCTIONS_ACU, 'function', '叙事功能', `${path}.function`, defaults.function, position);
  const mainline = resolveSoftEnum_ACU(state, strict, raw.mainlineDelta, STAGE_TURN_MAINLINE_DELTAS_ACU, 'mainlineDelta', '主线增量', `${path}.mainlineDelta`, defaults.mainlineDelta, position);
  const time = resolveSoftEnum_ACU(state, strict, raw.timeAdvance, STAGE_TURN_TIME_ADVANCES_ACU, 'timeAdvance', '时间跨度', `${path}.timeAdvance`, defaults.timeAdvance, position);
  const persistedInferred = validateInferred_ACU(raw.inferred, `${path}.inferred`) ?? [];
  const inferred = new Set<StageTurnSoftField_ACU>(persistedInferred);
  if (fn.inferred) inferred.add('function'); else inferred.delete('function');
  if (mainline.inferred) inferred.add('mainlineDelta'); else inferred.delete('mainlineDelta');
  if (time.inferred) inferred.add('timeAdvance'); else inferred.delete('timeAdvance');
  const turn: StageTurn_ACU = {
    id: requireText_ACU(raw.id, `${path}.id`),
    goal,
    pacing: pacing.value,
    function: fn.value,
    mainlineDelta: mainline.value,
    timeAdvance: time.value,
    timeAnchor: optionalText_ACU(raw.timeAnchor, `${path}.timeAnchor`),
    ...(inferred.size ? { inferred: [...inferred] } : {}),
  };
  if (turn.timeAnchor === undefined) delete turn.timeAnchor;
  // pacing 本身缺失时它只是占位值，拿它去判组合矛盾没有意义，等模型补上 pacing 再判。
  if (!pacing.inferred) reconcileTurnSemantics_ACU(state, strict, turn, role, position);
  return turn;
}

function validateNode_ACU(
  raw: unknown,
  index: number,
  turnIds: Set<string>,
  role: StageRole_ACU,
  state: ValidationState_ACU,
  turnOffset: number,
): StageNode_ACU {
  const path = `nodes[${index}]`;
  if (!isRecord_ACU(raw)) {
    fail_ACU('CONTINUATION_OUTLINE_FIELD_TYPE_INVALID', 'outline_validate', `字段必须是对象：${path}`, { path });
  }
  assertExactKeys_ACU(raw, NODE_KEYS_ACU, path);
  if (!Array.isArray(raw.turns)) {
    fail_ACU('CONTINUATION_OUTLINE_FIELD_TYPE_INVALID', 'outline_validate', `字段必须是数组：${path}.turns`, { path: `${path}.turns` });
  }
  const suggestedTurns = requirePositiveInteger_ACU(raw.suggestedTurns, `${path}.suggestedTurns`);
  const turns = raw.turns.map((turn, turnIndex) => validateTurn_ACU(
    turn,
    `${path}.turns[${turnIndex}]`,
    state.mode === 'generated' || (state.mode === 'replanned' && turnOffset + turnIndex >= state.strictFromTurn),
    role,
    state,
    index,
    turnIndex,
  ));
  if (turns.length !== suggestedTurns) {
    fail_ACU('CONTINUATION_OUTLINE_NODE_TURN_COUNT_MISMATCH', 'outline_validate', `节点轮次数与 suggestedTurns 不一致：${path}`, { path, expected: suggestedTurns, actual: turns.length });
  }
  for (const turn of turns) {
    if (turnIds.has(turn.id)) {
      fail_ACU('CONTINUATION_OUTLINE_TURN_ID_DUPLICATE', 'outline_validate', `轮次 ID 重复：${turn.id}`, { id: turn.id });
    }
    turnIds.add(turn.id);
  }
  return { id: requireText_ACU(raw.id, `${path}.id`), title: requireText_ACU(raw.title, `${path}.title`), goal: requireText_ACU(raw.goal, `${path}.goal`), suggestedTurns, turns };
}


/** Returns the hard turn range for the selected stage size without coercing raw values. */
export function resolveContinuationTurnRange_ACU(stageSize: unknown, customTurnMin?: unknown, customTurnMax?: unknown): ContinuationTurnRange_ACU {
  if (stageSize === 'short' || stageSize === 'standard' || stageSize === 'long') {
    return { ...CONTINUATION_TURN_RANGES_ACU[stageSize] };
  }
  if (stageSize !== 'custom') {
    fail_ACU('CONTINUATION_STAGE_SIZE_INVALID', 'outline_validate', '阶段规模必须是 short、standard、long 或 custom', { valueType: typeof stageSize });
  }
  if (typeof customTurnMin !== 'number' || !Number.isInteger(customTurnMin) || typeof customTurnMax !== 'number' || !Number.isInteger(customTurnMax)) {
    fail_ACU('CONTINUATION_CUSTOM_RANGE_INVALID', 'outline_validate', '自定义轮数范围必须由两个整数构成');
  }
  if (customTurnMin < 1 || customTurnMax > 50 || customTurnMin > customTurnMax) {
    fail_ACU('CONTINUATION_CUSTOM_RANGE_INVALID', 'outline_validate', '自定义轮数范围必须在 1 到 50 之间且最小值不得大于最大值', { min: customTurnMin, max: customTurnMax });
  }
  return { min: customTurnMin, max: customTurnMax };
}

function defaultStageRoleForTempo_ACU(tempo: StageTempo_ACU): StageRole_ACU {
  if (tempo === 'buildup') return 'setup';
  if (tempo === 'surge') return 'escalation';
  if (tempo === 'aftermath') return 'aftermath';
  return 'development';
}

function validateStageOutlineWithState_ACU(raw: unknown, range: ContinuationTurnRange_ACU, state: ValidationState_ACU): StageOutline_ACU {
  if (!isRecord_ACU(raw)) {
    fail_ACU('CONTINUATION_OUTLINE_NOT_OBJECT', 'outline_validate', '阶段大纲必须是单一 JSON 对象');
  }
  assertExactKeys_ACU(raw, OUTLINE_KEYS_ACU, 'outline', OUTLINE_OPTIONAL_KEYS_ACU);
  if (raw.schemaVersion !== CONTINUATION_SCHEMA_VERSION_ACU) {
    fail_ACU('CONTINUATION_OUTLINE_SCHEMA_VERSION_INVALID', 'outline_validate', '阶段大纲 schemaVersion 必须为 1', { actual: raw.schemaVersion });
  }
  if (typeof raw.totalTurns !== 'number' || !Number.isInteger(raw.totalTurns)) {
    fail_ACU('CONTINUATION_OUTLINE_FIELD_TYPE_INVALID', 'outline_validate', 'totalTurns 必须是整数', { path: 'outline.totalTurns' });
  }
  if (raw.totalTurns < range.min || raw.totalTurns > range.max) {
    fail_ACU('CONTINUATION_OUTLINE_TOTAL_TURNS_OUT_OF_RANGE', 'outline_validate', 'totalTurns 超出当前阶段规模范围', { min: range.min, max: range.max, actual: raw.totalTurns });
  }
  if (!Array.isArray(raw.nodes)) {
    fail_ACU('CONTINUATION_OUTLINE_FIELD_TYPE_INVALID', 'outline_validate', 'nodes 必须是数组', { path: 'outline.nodes' });
  }
  if (raw.nodes.length === 0) {
    fail_ACU('CONTINUATION_OUTLINE_NODES_EMPTY', 'outline_validate', 'nodes 不能为空');
  }
  const strictStage = state.mode !== 'persisted';
  const stagePosition: { nodeIndex: number | null; turnIndex: number | null; goalHead: string } = { nodeIndex: null, turnIndex: null, goalHead: '' };
  const tempo = resolveSoftEnum_ACU(state, strictStage, raw.tempo, STAGE_TEMPOS_ACU, 'tempo', '阶段节奏形态', 'outline.tempo', strictStage ? null : DEFAULT_STAGE_TEMPO_ACU, stagePosition);
  const role = resolveSoftEnum_ACU(state, strictStage, raw.role, STAGE_ROLES_ACU, 'role', '阶段结构角色', 'outline.role', defaultStageRoleForTempo_ACU(tempo.value), stagePosition);
  const nodeIds = new Set<string>();
  const turnIds = new Set<string>();
  let turnOffset = 0;
  const nodes = raw.nodes.map((node, index) => {
    const validated = validateNode_ACU(node, index, turnIds, role.value, state, turnOffset);
    if (nodeIds.has(validated.id)) {
      fail_ACU('CONTINUATION_OUTLINE_NODE_ID_DUPLICATE', 'outline_validate', `节点 ID 重复：${validated.id}`, { id: validated.id });
    }
    nodeIds.add(validated.id);
    turnOffset += validated.turns.length;
    return validated;
  });
  const summedTurns = nodes.reduce((sum, node) => sum + node.suggestedTurns, 0);
  if (summedTurns !== raw.totalTurns) {
    fail_ACU('CONTINUATION_OUTLINE_TOTAL_TURNS_MISMATCH', 'outline_validate', '节点 suggestedTurns 总和必须等于 totalTurns', { expected: raw.totalTurns, actual: summedTurns });
  }
  return {
    schemaVersion: CONTINUATION_SCHEMA_VERSION_ACU,
    title: requireText_ACU(raw.title, 'outline.title'),
    goal: requireText_ACU(raw.goal, 'outline.goal'),
    role: role.value,
    timeSpanGoal: optionalText_ACU(raw.timeSpanGoal, 'outline.timeSpanGoal'),
    tempo: tempo.value,
    totalTurns: raw.totalTurns,
    nodes,
  };
}

function runValidation_ACU(raw: unknown, range: ContinuationTurnRange_ACU, mode: StageOutlineValidationMode_ACU, policy: OutlineSoftFieldPolicy_ACU, strictFromTurn = 0): StageOutlineValidation_ACU {
  const state: ValidationState_ACU = { mode, policy, strictFromTurn, missing: [] };
  const outline = validateStageOutlineWithState_ACU(raw, range, state);
  return { outline, missing: state.missing };
}

/** 兼容读取持久化大纲；缺失的新字段仅在返回值中按 pacing 分档回填并标记 inferred，不改写磁盘。 */
export function validatePersistedStageOutline_ACU(raw: unknown, range: ContinuationTurnRange_ACU): StageOutline_ACU {
  return runValidation_ACU(raw, range, 'persisted', 'default').outline;
}

/** 新生成大纲的硬边界：核心标签缺失、非法枚举和非法组合都直接拒绝（保留给需要硬失败的调用方）。 */
export function validateGeneratedStageOutline_ACU(raw: unknown, range: ContinuationTurnRange_ACU): StageOutline_ACU {
  return runValidation_ACU(raw, range, 'generated', 'reject').outline;
}

/**
 * 新生成大纲的草稿校验：结构错误仍抛出；软字段缺失或非法时补默认并收集到 missing，
 * 由生成链路决定是向模型索要修补还是接受默认值。pacing / tempo 缺失也会进 missing 且 defaulted=false。
 */
export function validateGeneratedStageOutlineDraft_ACU(raw: unknown, range: ContinuationTurnRange_ACU): StageOutlineValidation_ACU {
  return runValidation_ACU(raw, range, 'generated', 'collect');
}

/** 用户手改或运行时编辑后的大纲：结构必须合法，软字段缺失按 pacing 补默认并标记 inferred。 */
export function validateEditedStageOutline_ACU(raw: unknown, range: ContinuationTurnRange_ACU): StageOutline_ACU {
  return runValidation_ACU(raw, range, 'generated', 'default').outline;
}

/** 兼容既有调用方；该名称固定表示持久化/旧快照读取路径。 */
export function validateStageOutline_ACU(raw: unknown, range: ContinuationTurnRange_ACU): StageOutline_ACU {
  return validatePersistedStageOutline_ACU(raw, range);
}

function flattenTurns_ACU(outline: StageOutline_ACU): StageTurn_ACU[] {
  return outline.nodes.flatMap(node => node.turns);
}

/** 展开一份大纲的全部轮次，供节奏校验与外部渲染共用。 */
export function listStageOutlineTurns_ACU(outline: StageOutline_ACU): StageTurn_ACU[] {
  return flattenTurns_ACU(outline);
}

/** 跨阶段的节奏上下文。它让「张弛」发生在卷的尺度上，而不是在每个阶段内部重复同一套配比。 */
export interface StageOutlinePacingContext_ACU {
  /** 上一阶段的节奏形态；null 表示这是任务的第一个阶段。 */
  previousTempo: StageTempo_ACU | null;
  /** 进入本次规划范围时已经连续多少轮高压（跨阶段累计，含本阶段已完成前缀）。 */
  leadingPressureStreak: number;
}

export interface StageOutlinePacingOptions_ACU extends StageOutlinePacingContext_ACU {
  /** 本阶段的节奏形态，决定低压轮下限以及是否豁免连续高压上限。 */
  tempo: StageTempo_ACU;
  /** 连续高压轮的上限，跨阶段累计。0 表示关闭这条兜底。 */
  maxConsecutivePressureTurns: number;
  /**
   * 跳过前 N 轮不参与低压占比统计。重规划时传已完成轮数：已完成前缀不可改，其中还混着
   * 迁移回填的 pressure，把它算进占比会让重规划永远无法通过。注意它不影响连续高压计数，
   * 前缀的连续段由 leadingPressureStreak 带入。
   */
  skipTurns?: number;
}

function isPressureTurn_ACU(pacing: StageTurnPacing_ACU): boolean {
  return !STAGE_TURN_DOWNTIME_PACINGS_ACU.includes(pacing);
}

function describePacingLabels_ACU(turns: readonly StageTurn_ACU[], offset: number): string {
  return turns.map((turn, index) => `第${offset + index + 1}轮=${turn.pacing}`).join('、');
}

/** 从轮次序列尾部往前数连续高压轮数。跨阶段继承计数用它。 */
export function countTrailingPressureTurns_ACU(turns: readonly StageTurn_ACU[]): number {
  let streak = 0;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (!isPressureTurn_ACU(turns[index].pacing)) break;
    streak += 1;
  }
  return streak;
}

function activeOutlineOf_ACU(stage: ContinuationStage_ACU): StageOutline_ACU | null {
  return stage.revisions.find(item => item.revision === stage.activeRevision)?.outline ?? null;
}

/** 一个阶段里真正写出来的那部分轮次。未完成的轮次只是计划，不参与连续高压计数。 */
function completedTurnsOf_ACU(stage: ContinuationStage_ACU): StageTurn_ACU[] {
  const outline = activeOutlineOf_ACU(stage);
  if (!outline) return [];
  return flattenTurns_ACU(outline).slice(0, Math.max(0, stage.completedTurns));
}

/**
 * 从任务的阶段序列推导跨阶段节奏上下文。
 *
 * @param stages 任务的全部阶段（按顺序）
 * @param currentStageId 本次规划所属阶段；传 null 表示正在规划一个尚未创建的新阶段
 * @returns 上一阶段形态与进入本次规划范围时的连续高压轮数
 */
export function resolveStageOutlinePacingContext_ACU(
  stages: readonly ContinuationStage_ACU[],
  currentStageId: string | null,
): StageOutlinePacingContext_ACU {
  const found = currentStageId ? stages.findIndex(stage => stage.stageId === currentStageId) : -1;
  const currentIndex = found >= 0 ? found : stages.length;
  const previousStages = stages.slice(0, currentIndex);
  const current = found >= 0 ? stages[found] : null;
  // 连续段可能横跨多个阶段（上一阶段结尾三轮高压 + 本阶段已完成两轮高压 = 5），
  // 因此把历史已完成轮次首尾相接后统一从尾部数，而不是只看最近一个阶段。
  const history = previousStages.flatMap(stage => completedTurnsOf_ACU(stage));
  if (current) history.push(...completedTurnsOf_ACU(current));
  const previous = previousStages.length ? previousStages[previousStages.length - 1] : null;
  return {
    previousTempo: previous ? activeOutlineOf_ACU(previous)?.tempo ?? null : null,
    leadingPressureStreak: countTrailingPressureTurns_ACU(history),
  };
}

/**
 * 校验一份大纲的节奏。三条规则，全部围绕「长程能量守恒」而不是「短程节拍」：
 *
 * 1. 不允许连续两个 surge 阶段。这是 surge 能整段高压的代价——高压型阶段攒下的连续高压会
 *    带进下一阶段，而下一阶段只能是 mixed 或 aftermath，两者都有低压下限，债务被强制清偿。
 * 2. 低压轮下限按阶段形态查表，阶段内不限制分布位置：低压轮扎堆在开头、结尾还是中段都合法，
 *    读者因此感知不到固定周期。
 * 3. 连续高压轮上限跨阶段累计，只兜底「长时间没有任何喘息」；surge 阶段豁免这条。
 *
 * 与 validateStageOutline_ACU 分开调用而不是并入其中：结构校验在每次信封加载时对所有历史
 * revision 重跑，节奏规则是新增约束，并进去会让存量任务直接加载失败。它只用在生成链路上，
 * 目的是让模型经 $VALIDATION_ERRORS 自愈。
 * @param turns 待校验的全部轮次（按阶段内顺序）
 * @param options 本阶段形态、跨阶段上下文与上限配置
 */
export function validateStageOutlinePacing_ACU(turns: readonly StageTurn_ACU[], options: StageOutlinePacingOptions_ACU): void {
  const { tempo, previousTempo } = options;
  if (tempo === 'surge' && previousTempo === 'surge') {
    fail_ACU(
      'CONTINUATION_OUTLINE_PACING_INVALID',
      'outline_validate',
      `不能连续两个高压型阶段：上一阶段已经是 ${describeStageTempo_ACU('surge')}，读者刚经历完一整段没有喘息的高压，再来一段同样强度的只会钝化。本阶段的 <stage_tempo> 请改成 aftermath（先把上一段的代价落地）或 mixed（松紧交替推进）。`,
      { rule: 'consecutive_surge_stages', tempo, previousTempo },
    );
  }

  const skip = Math.max(0, Math.min(options.skipTurns ?? 0, turns.length));
  const scope = turns.slice(skip);
  if (!scope.length) return;
  const labels = describePacingLabels_ACU(scope, skip);

  const floor = STAGE_TEMPO_DOWNTIME_FLOOR_ACU[tempo];
  const required = Math.ceil(scope.length * floor);
  if (required > 0) {
    const actual = scope.filter(turn => !isPressureTurn_ACU(turn.pacing)).length;
    if (actual < required) {
      fail_ACU(
        'CONTINUATION_OUTLINE_PACING_INVALID',
        'outline_validate',
        `低压轮不足：本阶段形态是 ${describeStageTempo_ACU(tempo)}，本次规划的 ${scope.length} 轮里至少要有 ${required} 轮标为 setup 或 cooldown，实际只有 ${actual} 轮。请把其中 ${required - actual} 轮改成铺垫日常或余波消化——写关系推进、生活场景、情绪落地，不要再安排新的外部危机。这些低压轮放在哪里由你决定，可以连着放，不需要均匀分散。如果这一段剧情本来就该一路高压，那就把 <stage_tempo> 改成 surge（但上一阶段不能也是 surge）。当前各轮节奏：${labels}`,
        { rule: 'downtime_floor', tempo, scopeTurns: scope.length, required, actual, floor, skippedTurns: skip, labels },
      );
    }
  }

  // surge 的整段高压是设计允许的；它欠下的账由「下一阶段不能再是 surge」加下一阶段的低压下限来收。
  const limit = Number.isFinite(options.maxConsecutivePressureTurns) ? Math.max(0, Math.trunc(options.maxConsecutivePressureTurns)) : 0;
  if (tempo === 'surge' || limit <= 0) return;
  let streak = Math.max(0, Math.trunc(options.leadingPressureStreak));
  for (let index = 0; index < scope.length; index += 1) {
    streak = isPressureTurn_ACU(scope[index].pacing) ? streak + 1 : 0;
    if (streak > limit) {
      const turnNumber = skip + index + 1;
      const inherited = Math.max(0, Math.trunc(options.leadingPressureStreak));
      const inheritedNote = inherited > 0 ? `（其中 ${inherited} 轮来自前面已经写完的剧情）` : '';
      fail_ACU(
        'CONTINUATION_OUTLINE_PACING_INVALID',
        'outline_validate',
        `连续高压轮超限：到第 ${turnNumber} 轮为止已经连续 ${streak} 轮都是 pressure 或 turn${inheritedNote}，上限是 ${limit} 轮。请在第 ${turnNumber} 轮之前安排一轮 setup 或 cooldown 让读者喘口气。这不是要求你每隔几轮就插一轮日常——只是这一段已经绷得太久了。当前各轮节奏：${labels}`,
        { rule: 'pressure_streak', turnNumber, streak, limit, leadingPressureStreak: inherited, skippedTurns: skip, labels },
      );
    }
  }
}

/**
 * 重规划核心：前缀逐字保留、剩余轮数符合额度。软字段策略由调用方决定：
 * 生成链路用 collect 收集缺项索要修补；编辑/手改路径用 default 直接补默认。
 */
function validateReplannedWithPolicy_ACU(raw: unknown, range: ContinuationTurnRange_ACU, constraints: ContinuationReplanConstraints_ACU, policy: OutlineSoftFieldPolicy_ACU): StageOutlineValidation_ACU {
  if (!Number.isInteger(constraints.completedTurns) || constraints.completedTurns < 0 || !Number.isInteger(constraints.expectedRemainingTurns) || constraints.expectedRemainingTurns < 0) {
    fail_ACU('CONTINUATION_REPLAN_CONTEXT_INVALID', 'replan', '重新规划约束必须包含非负整数');
  }
  const normalizedPrevious = validatePersistedStageOutline_ACU(constraints.previousOutline, range);
  const previousTurns = flattenTurns_ACU(normalizedPrevious);
  if (constraints.completedTurns > previousTurns.length) {
    fail_ACU('CONTINUATION_REPLAN_CONTEXT_INVALID', 'replan', '已完成轮数超过旧 revision 的轮次总数', { completedTurns: constraints.completedTurns, totalTurns: previousTurns.length });
  }
  const validation = runValidation_ACU(raw, range, 'replanned', policy, constraints.completedTurns);
  const outline = validation.outline;
  const candidateTurns = flattenTurns_ACU(outline);
  const completedPrefix = previousTurns.slice(0, constraints.completedTurns);
  if (candidateTurns.length < completedPrefix.length) {
    fail_ACU('CONTINUATION_REPLAN_COMPLETED_PREFIX_CHANGED', 'replan', '重新规划结果缺少已完成轮次');
  }
  for (let index = 0; index < completedPrefix.length; index += 1) {
    const expected = completedPrefix[index];
    const actual = candidateTurns[index];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      fail_ACU('CONTINUATION_REPLAN_COMPLETED_PREFIX_CHANGED', 'replan', '重新规划不得修改已完成轮次及其节奏、功能或时间元数据', { index, expectedId: expected.id, actualId: actual.id });
    }
  }
  const remainingTurns = candidateTurns.length - completedPrefix.length;
  if (remainingTurns !== constraints.expectedRemainingTurns) {
    fail_ACU('CONTINUATION_REPLAN_REMAINING_TURNS_MISMATCH', 'replan', '重新规划结果的剩余轮数不符合额度', { expected: constraints.expectedRemainingTurns, actual: remainingTurns });
  }
  return validation;
}

/** Ensures a replan preserves completed turns and allocates exactly the remaining quota; soft fields default with inferred marks. */
export function validateReplannedStageOutline_ACU(raw: unknown, range: ContinuationTurnRange_ACU, constraints: ContinuationReplanConstraints_ACU): StageOutline_ACU {
  return validateReplannedWithPolicy_ACU(raw, range, constraints, 'default').outline;
}

/** 重规划草稿校验：结构错误抛出，软字段缺项收集到 missing 供生成链路索要修补。 */
export function validateReplannedStageOutlineDraft_ACU(raw: unknown, range: ContinuationTurnRange_ACU, constraints: ContinuationReplanConstraints_ACU): StageOutlineValidation_ACU {
  return validateReplannedWithPolicy_ACU(raw, range, constraints, 'collect');
}
