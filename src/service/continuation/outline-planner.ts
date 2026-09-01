import { callContinuationInternalAi_ACU, CONTINUATION_ROLE_OUTPUT_TOKEN_FLOORS_ACU, type ContinuationInternalAiCallOptions_ACU } from './internal-ai-call';
import { normalizeContinuationInternalAiRetryLimit_ACU } from './defaults';
import { resolveContinuationAgentApiPreset_ACU, type ContinuationApiPresetDependencies_ACU, type ContinuationResolvedApiPreset_ACU } from './api-preset';
import {
  describeStageTempo_ACU,
  listStageOutlineTurns_ACU,
  resolveContinuationTurnRange_ACU,
  validateEditedStageOutline_ACU,
  validateGeneratedStageOutlineDraft_ACU,
  validateReplannedStageOutline_ACU,
  validateReplannedStageOutlineDraft_ACU,
  validateStageOutlinePacing_ACU,
  type OutlineMissingField_ACU,
  type StageOutlinePacingContext_ACU,
  type StageOutlineValidation_ACU,
} from './outline-schema';
import { applyOutlineFixes_ACU, buildStageOutlineFromTags_ACU, parseOutlineFixes_ACU, parseOutlineTags_ACU, spliceOutlineWithCompletedPrefix_ACU } from './outline-tags';
import { renderContinuationPrompt_ACU, type ContinuationPromptPlaceholder_ACU } from './prompt-template';
import {
  ContinuationValidationError_ACU,
  createContinuationError_ACU,
  type ContinuationError_ACU,
  type ContinuationInternalAiRequestIdentity_ACU,
  type ContinuationReplanConstraints_ACU,
  type ContinuationRevisionReason_ACU,
  type ContinuationSettings_ACU,
  type StageOutline_ACU,
  type StageRevision_ACU,
} from './model';

export interface ContinuationOutlinePlanningRequest_ACU {
  settings: ContinuationSettings_ACU;
  reason: ContinuationRevisionReason_ACU;
  createInternalRequestIdentity: (attempt: number) => ContinuationInternalAiRequestIdentity_ACU & { source: 'outline' };
  isInternalRequestCurrent: (identity: ContinuationInternalAiRequestIdentity_ACU) => boolean;
  /** node/turn 的 ID 分配器。模型不再输出 id，结构标识全部由运行时生成。 */
  allocateId: (prefix: string) => string;
  replanInstruction?: string;
  replanConstraints?: ContinuationReplanConstraints_ACU;
  /** 跨阶段节奏上下文。缺省按「第一个阶段、无历史连续高压」处理。 */
  pacingContext?: StageOutlinePacingContext_ACU;
  resolvers?: Partial<Record<ContinuationPromptPlaceholder_ACU, () => string | Promise<string | null | undefined> | null | undefined>>;
}

export interface ContinuationOutlinePlanningResult_ACU {
  outline: StageOutline_ACU;
  attempts: number;
  /** 为补齐缺失标记而额外发起的修补轮次数（不含整份重来）。 */
  repairRounds: number;
  /** 修补轮用尽后仍由运行时按 pacing 补默认的字段数。 */
  inferredFields: number;
  apiPreset: Pick<ContinuationResolvedApiPreset_ACU, 'presetName' | 'source' | 'reason'>;
  requiresReview: boolean;
}

/** 每次整份生成之后最多追加的增量修补轮数。修补轮输出极小，不与整份重来共用重试额度。 */
export const CONTINUATION_OUTLINE_REPAIR_ROUNDS_ACU = 2;

export interface ContinuationOutlinePlannerDependencies_ACU {
  resolveApiPreset: typeof resolveContinuationAgentApiPreset_ACU;
  callInternalAi: (messages: Array<{ role: string; content: string }>, preset: ContinuationResolvedApiPreset_ACU, identity: ContinuationInternalAiRequestIdentity_ACU, signal?: AbortSignal | null, options?: ContinuationInternalAiCallOptions_ACU) => Promise<string | null>;
  /** 传输错误重试前的延时实现。缺省 setTimeout；测试注入假计时器。 */
  wait?: (ms: number) => Promise<void>;
}

const defaultDependencies_ACU: ContinuationOutlinePlannerDependencies_ACU = {
  resolveApiPreset: resolveContinuationAgentApiPreset_ACU,
  callInternalAi: callContinuationInternalAi_ACU,
  wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
};

function toPlannerError_ACU(error: unknown): ContinuationError_ACU {
  if (error instanceof ContinuationValidationError_ACU) return error.error;
  return createContinuationError_ACU('CONTINUATION_INTERNAL_AI_REQUEST_FAILED', 'outline_call', '阶段大纲内部 AI 调用失败', true);
}

function compactValidationError_ACU(error: ContinuationError_ACU): string {
  // 附上 message 与 details：轮数超范围这类错误只有带上具体数字（min/max/actual）模型才能自愈，
  // 光说「超出范围」等于没说。
  const base = `${error.code}@${error.phase}: ${error.message}`;
  if (!error.details || !Object.keys(error.details).length) return base;
  try {
    return `${base}（${JSON.stringify(error.details)}）`;
  } catch {
    return base;
  }
}

/**
 * 渲染 $TURN_RANGE 的权威文案。planner 是唯一同时掌握阶段规模范围与重规划约束的模块，
 * 因此该占位符在这里注入并覆盖外部同名解析器。
 * @param range 阶段总轮数范围
 * @param constraints 重规划约束；提供时模型只规划剩余轮次，需换算剩余轮数允许区间
 * @returns 给大纲 AI 的范围说明；剩余额度不足时如实说明真实约束
 */
export function renderContinuationTurnRange_ACU(range: { min: number; max: number }, constraints?: ContinuationReplanConstraints_ACU): string {
  const total = `本阶段总轮数（全部 <turn> 的数量）必须在 ${range.min} 到 ${range.max} 之间。`;
  if (!constraints || constraints.completedTurns <= 0) return total;
  const completed = constraints.completedTurns;
  const remainingMin = Math.max(1, range.min - completed);
  const remainingMax = range.max - completed;
  if (remainingMax < remainingMin) {
    return `${total}已完成 ${completed} 轮不可改动，剩余轮数额度不足（最多还能规划 ${Math.max(0, remainingMax)} 轮），当前阶段无法在范围内继续扩展。`;
  }
  return `${total}其中已完成 ${completed} 轮不可改动；你只规划剩余轮次，剩余的 <turn> 数量必须在 ${remainingMin} 到 ${remainingMax} 之间（拼接后总轮数才会落在范围内）。`;
}

/** 正文模型单轮的稳定产出量。阶段容量锚按它换算，与大纲提示词里写的单轮承载量口径一致。 */
const CONTINUATION_TURN_WORD_ESTIMATE_ACU = 1000;

/**
 * 渲染阶段字数容量锚。与 $TURN_RANGE 同理，只有 planner 同时知道阶段规模与重规划约束，
 * 因此这个占位符也在这里注入。
 * @param range 阶段总轮数范围
 * @param constraints 重规划约束；提供时按剩余轮数换算
 * @returns 一段说明本次规划实际能写多少字的文案
 */
export function renderContinuationStageWordBudget_ACU(range: { min: number; max: number }, constraints?: ContinuationReplanConstraints_ACU): string {
  const completed = constraints ? Math.max(0, constraints.completedTurns) : 0;
  const planningMin = Math.max(1, range.min - completed);
  const planningMax = Math.max(planningMin, range.max - completed);
  const lowWords = planningMin * CONTINUATION_TURN_WORD_ESTIMATE_ACU;
  const highWords = planningMax * CONTINUATION_TURN_WORD_ESTIMATE_ACU;
  const scope = completed > 0
    ? `本次你要规划 ${planningMin} 到 ${planningMax} 轮剩余轮次`
    : `本阶段有 ${planningMin} 到 ${planningMax} 轮`;
  return `${scope}，正文模型每轮只写 800-1200 字（按 ${CONTINUATION_TURN_WORD_ESTIMATE_ACU} 字估算），也就是说这些轮次加起来一共只有大约 ${lowWords} 到 ${highWords} 字的篇幅。`;
}

/**
 * 渲染 $PACING_CONTEXT。模型必须知道「上一阶段是什么形态、现在已经连着多少轮高压」才能
 * 判断本阶段该选哪一档形态——只给规则不给状态，它只能瞎猜。
 * @param context 跨阶段节奏上下文
 * @param maxConsecutivePressureTurns 连续高压轮上限，0 表示该兜底已关闭
 * @returns 给大纲 AI 的节奏状态说明与本次可选形态
 */
export function renderContinuationPacingContext_ACU(context: StageOutlinePacingContext_ACU, maxConsecutivePressureTurns: number): string {
  const limit = Number.isFinite(maxConsecutivePressureTurns) ? Math.max(0, Math.trunc(maxConsecutivePressureTurns)) : 0;
  const streak = Math.max(0, Math.trunc(context.leadingPressureStreak));
  const lines: string[] = [];
  lines.push(context.previousTempo === null
    ? '这是本次续写任务的第一个阶段，前面没有任何已写剧情。'
    : `上一阶段的节奏形态是 ${describeStageTempo_ACU(context.previousTempo)}。`);
  lines.push(streak > 0
    ? `截至目前，故事已经连续 ${streak} 轮没有出现低压轮（setup / cooldown）。`
    : '截至目前，最近写完的一轮是低压轮，读者刚喘过一口气。');
  if (context.previousTempo === 'surge') {
    lines.push('因为上一阶段是高压型，本阶段的 <stage_tempo> 只能选 aftermath 或 mixed，不能再选 surge——这是上一段整段高压的代价。');
  } else {
    lines.push('本阶段的 <stage_tempo> 四档都可以选，选哪一档取决于总纲里本卷台阶推进到了哪一步。');
  }
  if (limit > 0) {
    const remaining = Math.max(0, limit - streak);
    lines.push(streak >= limit
      ? `连续高压轮上限是 ${limit} 轮，已经用满：除非本阶段选 surge，否则本阶段第一轮必须是 setup 或 cooldown。`
      : `连续高压轮上限是 ${limit} 轮（surge 阶段豁免这条），本阶段开头最多还能接着写 ${remaining} 轮高压。`);
  }
  return lines.join('\n');
}

const MISSING_FIELD_LABELS_ACU: Record<OutlineMissingField_ACU['field'], string> = {
  pacing: 'pacing（setup / pressure / turn / cooldown）',
  function: 'function（daily_bond / daily_world / recovery / preparation / training / economy / side_thread / conflict / reveal / payoff / transition）',
  mainlineDelta: 'mainline（hold / micro / step / milestone）',
  timeAdvance: 'time（continuous / same_day / overnight / days / weeks / months / years）',
  timeAnchor: 'anchor（time 为 weeks / months / years 时的相对时间锚，如「入城后的第七天」）',
  tempo: 'tempo（buildup / mixed / surge / aftermath）',
  role: 'role（setup / development / escalation / turn / payoff / aftermath）',
};

const FIX_ATTRIBUTE_NAMES_ACU: Record<OutlineMissingField_ACU['field'], string> = {
  pacing: 'pacing',
  function: 'function',
  mainlineDelta: 'mainline',
  timeAdvance: 'time',
  timeAnchor: 'anchor',
  tempo: 'tempo',
  role: 'role',
};

/**
 * 渲染增量修补请求：只列缺项，按模型自己输出里的节点/轮次位置引用，并给出最小回复格式。
 * 位置换算：整份大纲里前 prefixNodeCount 个节点是重规划保留的前缀，模型看不到也不需要动。
 * @param missing 草稿校验收集到的缺项
 * @param prefixNodeCount 拼接进来的前缀节点数
 * @returns 回灌给模型的修补请求文本
 */
export function renderOutlineRepairRequest_ACU(missing: readonly OutlineMissingField_ACU[], prefixNodeCount: number): string {
  const grouped = new Map<string, { node: number | null; turn: number | null; goalHead: string; fields: OutlineMissingField_ACU[] }>();
  for (const item of missing) {
    const node = item.nodeIndex === null ? null : item.nodeIndex - prefixNodeCount + 1;
    const turn = item.turnIndex === null ? null : item.turnIndex + 1;
    const key = node === null ? 'stage' : `${node}:${turn}`;
    const bucket = grouped.get(key) ?? { node, turn, goalHead: item.goalHead, fields: [] };
    bucket.fields.push(item);
    grouped.set(key, bucket);
  }
  const lines: string[] = ['你上一份大纲的结构已被接受，只有下列标记缺失或不是合法枚举值。只需补这些标记，不要重发整份大纲，不要改动任何 goal 正文：'];
  const examples: string[] = [];
  for (const bucket of grouped.values()) {
    const fieldText = bucket.fields.map(item => {
      const label = MISSING_FIELD_LABELS_ACU[item.field];
      return item.actual === undefined ? `缺 ${label}` : `${label} 写成了「${String(item.actual)}」`;
    }).join('；');
    if (bucket.node === null) {
      lines.push(`- 阶段级：${fieldText}`);
      examples.push(`<fix stage ${bucket.fields.map(item => `${FIX_ATTRIBUTE_NAMES_ACU[item.field]}="…"`).join(' ')}/>`);
    } else {
      lines.push(`- 节点${bucket.node} 第${bucket.turn}轮（「${bucket.goalHead}」）：${fieldText}`);
      examples.push(`<fix node="${bucket.node}" turn="${bucket.turn}" ${bucket.fields.map(item => `${FIX_ATTRIBUTE_NAMES_ACU[item.field]}="…"`).join(' ')}/>`);
    }
  }
  lines.push('回复格式，每条一行，只填标准枚举值：');
  lines.push(...[...new Set(examples)]);
  lines.push('例：<fix node="1" turn="2" function="daily_bond" time="overnight"/>');
  return lines.join('\n');
}

/**
 * 整份重来时的回灌：错误原因 + 一份最小合法样例。快速模型对“照这个样子写”比对规则描述更服从。
 * @param error 上次校验错误
 */
export function renderOutlineRetryRequest_ACU(error: ContinuationError_ACU): string {
  return [
    '上次输出未通过校验，请按下列错误修正后重新输出完整标签（只输出标签，不要 <think>、不要 JSON）。',
    compactValidationError_ACU(error),
    '每个 <turn> 的写法示例：',
    '<turn pacing="setup" function="daily_bond" mainline="hold" time="overnight">两人在灶前分工做晚饭，她第一次把咸淡交给他决定</turn>',
    '<turn pacing="pressure" function="conflict" mainline="step" time="continuous">守卫在城门盘查信物，主角被迫交出一半银两换取放行</turn>',
    '阶段级标签示例：<stage_tempo>mixed</stage_tempo> <stage_role>development</stage_role>',
  ].join('\n');
}

function missingFieldError_ACU(missing: readonly OutlineMissingField_ACU[]): ContinuationValidationError_ACU {
  const hard = missing.filter(item => !item.defaulted);
  const first = hard[0];
  const where = first.nodeIndex === null ? 'outline' : `nodes[${first.nodeIndex}].turns[${first.turnIndex}]`;
  return new ContinuationValidationError_ACU(createContinuationError_ACU(
    'CONTINUATION_OUTLINE_FIELD_MISSING',
    'outline_validate',
    `${MISSING_FIELD_LABELS_ACU[first.field]} 缺失或非法且无法安全补全：${where}${first.actual === undefined ? '' : `（写成了「${String(first.actual)}」）`}。每个 <turn> 都必须带合法的 pacing，阶段必须带合法的 <stage_tempo>`,
    false,
    { path: `${where}.${first.field}`, actual: first.actual, hardMissing: hard.length },
  ));
}

function isRetryableOutlineError_ACU(error: ContinuationError_ACU): boolean {
  if (error.code === 'CONTINUATION_INTERNAL_AI_REQUEST_FAILED' || error.code === 'CONTINUATION_OUTLINE_JSON_INVALID') return true;
  if (error.phase === 'outline_validate') return true;
  return error.code === 'CONTINUATION_REPLAN_COMPLETED_PREFIX_CHANGED'
    || error.code === 'CONTINUATION_REPLAN_REMAINING_TURNS_MISMATCH';
}


export class ContinuationOutlinePlanner_ACU {
  constructor(private readonly dependencies: ContinuationOutlinePlannerDependencies_ACU = defaultDependencies_ACU) {}

  async plan(request: ContinuationOutlinePlanningRequest_ACU, apiDependencies?: ContinuationApiPresetDependencies_ACU): Promise<ContinuationOutlinePlanningResult_ACU> {
    const range = resolveContinuationTurnRange_ACU(request.settings.stageSize, request.settings.customTurnMin ?? undefined, request.settings.customTurnMax ?? undefined);
    const preset = this.dependencies.resolveApiPreset(request.settings, 'outline', request.reason === 'manual_replan' ? 'replan' : 'outline_call', apiDependencies);
    const retries = normalizeContinuationInternalAiRetryLimit_ACU(request.settings.internalAiRetryLimit);
    const pacingContext: StageOutlinePacingContext_ACU = request.pacingContext ?? { previousTempo: null, leadingPressureStreak: 0 };
    let lastError: ContinuationError_ACU | null = null;
    const resolvers = { ...request.resolvers };
    // $TURN_RANGE 由 planner 权威注入：只有这里同时知道范围与重规划约束。
    resolvers.$TURN_RANGE = () => renderContinuationTurnRange_ACU(range, request.replanConstraints);
    resolvers.$STAGE_WORD_BUDGET = () => renderContinuationStageWordBudget_ACU(range, request.replanConstraints);
    resolvers.$PACING_CONTEXT = () => renderContinuationPacingContext_ACU(pacingContext, request.settings.maxConsecutivePressureTurns);
    // 校验错误不再写回骨架占位符：重试只追加 transcript，前缀保持字节级稳定以便命中缓存。
    const rendered = await renderContinuationPrompt_ACU(request.settings.outlinePrompt, resolvers, request.reason === 'manual_replan' ? 'replan' : 'outline_prompt');
    const transcript: Array<{ role: string; content: string }> = [];
    let lastRaw = '';

    let repairRounds = 0;
    const constraints = request.replanConstraints;
    const callModel = async (attempt: number, messages: Array<{ role: string; content: string }>): Promise<string> => {
      const identity = request.createInternalRequestIdentity(attempt);
      const isCurrent = request.isInternalRequestCurrent;
      if (!isCurrent(identity)) {
        throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'outline_call', '阶段大纲内部请求已失效', false));
      }
      const raw = await this.dependencies.callInternalAi(messages, preset, identity, undefined, {
        promptCacheEnabled: false,
        cacheScope: 'outline',
        minOutputTokens: CONTINUATION_ROLE_OUTPUT_TOKEN_FLOORS_ACU.outline,
      });
      if (!isCurrent(identity)) {
        throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'outline_call', '阶段大纲内部结果已失效', false));
      }
      return String(raw ?? '');
    };
    const buildFromRaw = (raw: string): StageOutline_ACU => buildStageOutlineFromTags_ACU(parseOutlineTags_ACU(raw), request.allocateId, constraints ? {
      title: constraints.previousOutline.title,
      goal: constraints.previousOutline.goal,
      tempo: constraints.previousOutline.tempo,
      role: constraints.previousOutline.role,
      timeSpanGoal: constraints.previousOutline.timeSpanGoal,
    } : undefined);
    // 重规划：模型只规划剩余轮次，已完成前缀由运行时拼回；剩余轮数额度放宽，
    // 只要求拼接后 totalTurns 落在阶段规模范围内（校验按实际拼接结果传额度）。
    const validateDraft = (planned: StageOutline_ACU): { validation: StageOutlineValidation_ACU; prefixNodeCount: number } => {
      const candidate = constraints ? spliceOutlineWithCompletedPrefix_ACU(constraints.previousOutline, constraints.completedTurns, planned) : planned;
      const validation = constraints
        ? validateReplannedStageOutlineDraft_ACU(candidate, range, { ...constraints, expectedRemainingTurns: candidate.totalTurns - constraints.completedTurns })
        : validateGeneratedStageOutlineDraft_ACU(candidate, range);
      return { validation, prefixNodeCount: candidate.nodes.length - planned.nodes.length };
    };

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        lastRaw = await callModel(attempt, [...rendered.messages, ...transcript]);
        let planned = buildFromRaw(lastRaw);
        let { validation, prefixNodeCount } = validateDraft(planned);
        // 增量修补：结构已经合法、只差标记时，不整份重来，只向模型索要缺项。
        // 修补轮对话独立于外层 transcript：修好即丢弃，整份重来时模型不需要再看这段。
        const repairTranscript: Array<{ role: string; content: string }> = [{ role: 'assistant', content: lastRaw.trim() || '(空输出)' }];
        for (let round = 0; round < CONTINUATION_OUTLINE_REPAIR_ROUNDS_ACU && validation.missing.length; round += 1) {
          repairTranscript.push({ role: 'user', content: renderOutlineRepairRequest_ACU(validation.missing, prefixNodeCount) });
          repairRounds += 1;
          const reply = await callModel(attempt, [...rendered.messages, ...transcript, ...repairTranscript]);
          repairTranscript.push({ role: 'assistant', content: reply.trim() || '(空输出)' });
          const fixes = parseOutlineFixes_ACU(reply);
          if (fixes.length) {
            planned = applyOutlineFixes_ACU(planned, fixes);
          } else if (/<node(\s[^>]*)?>/i.test(reply)) {
            // 模型没按 <fix> 回复而是重发了整份大纲：接受它，按新输出继续。
            lastRaw = reply;
            planned = buildFromRaw(reply);
          } else {
            break;
          }
          ({ validation, prefixNodeCount } = validateDraft(planned));
        }
        if (validation.missing.some(item => !item.defaulted)) throw missingFieldError_ACU(validation.missing);
        const outline = validation.outline;
        // 低压占比只作用在本次真正规划出来的轮次上：重规划时已完成前缀不可改，其中还混着
        // 迁移回填的 pressure，把它算进占比会让重规划永远无法通过；前缀的连续高压段则由
        // pacingContext.leadingPressureStreak 带入，那部分是真实写过的剧情，必须参与计数。
        validateStageOutlinePacing_ACU(listStageOutlineTurns_ACU(outline), {
          tempo: outline.tempo,
          previousTempo: pacingContext.previousTempo,
          leadingPressureStreak: pacingContext.leadingPressureStreak,
          maxConsecutivePressureTurns: request.settings.maxConsecutivePressureTurns,
          skipTurns: constraints ? constraints.completedTurns : 0,
        });
        return {
          outline,
          attempts: attempt + 1,
          repairRounds,
          inferredFields: validation.missing.length,
          apiPreset: { presetName: preset.presetName, source: preset.source, reason: preset.reason },
          requiresReview: request.settings.outlinePreview,
        };
      } catch (error) {
        lastError = toPlannerError_ACU(error);
        if (!isRetryableOutlineError_ACU(lastError)) throw error;
        // 传输错误（502/网络抖动）按设置延时后再打同一前缀，不伪造 assistant 消息。
        // 大纲结构校验失败把原文和错误追加到 transcript，前缀保持不变。
        if (lastError.code === 'CONTINUATION_INTERNAL_AI_REQUEST_FAILED') {
          if (attempt < retries) {
            const wait = this.dependencies.wait ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
            await wait(Math.max(0, request.settings.retryDelaySeconds) * 1000);
          }
          continue;
        }
        if (attempt < retries) {
          transcript.push({ role: 'assistant', content: lastRaw.trim() || '(空输出)' });
          transcript.push({ role: 'user', content: renderOutlineRetryRequest_ACU(lastError) });
        }
      }
    }

    throw new ContinuationValidationError_ACU(createContinuationError_ACU(
      'CONTINUATION_OUTLINE_RETRY_EXHAUSTED',
      lastError?.phase ?? 'outline_call',
      '阶段大纲生成重试次数已耗尽',
      false,
      { attempts: retries + 1, lastErrorCode: lastError?.code ?? 'CONTINUATION_INTERNAL_AI_REQUEST_FAILED' },
    ));
  }
}

export function createPlannedStageRevision_ACU(outline: StageOutline_ACU, revision: number, reason: ContinuationRevisionReason_ACU, replanInstruction = '', createdAt = Date.now()): StageRevision_ACU {
  return { revision, createdAt, reason, replanInstruction, frozen: false, outline };
}

/** Revalidates a user-edited preview before it becomes eligible for execution. */
export function acceptPlannedStageRevision_ACU(revision: StageRevision_ACU, settings: ContinuationSettings_ACU, replanConstraints?: ContinuationReplanConstraints_ACU): StageRevision_ACU {
  if (revision.frozen) {
    throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_REVISION_FROZEN', 'replan', '已冻结的阶段 revision 不可编辑', false));
  }
  const range = resolveContinuationTurnRange_ACU(settings.stageSize, settings.customTurnMin ?? undefined, settings.customTurnMax ?? undefined);
  // 用户手改的预览：结构必须合法，语义标记缺失按 pacing 补默认并标记 inferred，不因少写一个属性而存不下。
  const outline = replanConstraints
    ? validateReplannedStageOutline_ACU(revision.outline, range, replanConstraints)
    : validateEditedStageOutline_ACU(revision.outline, range);
  return freezePlannedStageRevision_ACU({ ...revision, outline });
}

export function freezePlannedStageRevision_ACU(revision: StageRevision_ACU): StageRevision_ACU {
  return { ...revision, frozen: true, outline: { ...revision.outline, nodes: revision.outline.nodes.map(node => ({ ...node, turns: node.turns.map(turn => ({ ...turn })) })) } };
}
