import { describe, expect, it } from 'vitest';

import {
  buildDefaultContinuationSettings_ACU,
  normalizeContinuationInternalAiRetryLimit_ACU,
  normalizeContinuationMaxAutomaticStages_ACU,
} from '../../../src/service/continuation/defaults';
import { ContinuationValidationError_ACU } from '../../../src/service/continuation/model';
import {
  countTrailingPressureTurns_ACU,
  listStageOutlineTurns_ACU,
  resolveContinuationTurnRange_ACU,
  resolveStageOutlinePacingContext_ACU,
  validateEditedStageOutline_ACU,
  validateGeneratedStageOutline_ACU,
  validateGeneratedStageOutlineDraft_ACU,
  validateReplannedStageOutline_ACU,
  validateReplannedStageOutlineDraft_ACU,
  validateStageOutline_ACU,
  validateStageOutlinePacing_ACU,
  type StageOutlinePacingOptions_ACU,
} from '../../../src/service/continuation/outline-schema';
import type { ContinuationStage_ACU, StageTempo_ACU, StageTurnPacing_ACU } from '../../../src/service/continuation/model';

function buildOutline_ACU(totalTurns = 6) {
  return {
    schemaVersion: 1,
    title: '阶段标题',
    goal: '阶段目标',
    tempo: 'mixed' as StageTempo_ACU,
    role: 'development' as const,
    totalTurns,
    nodes: [
      {
        id: 'node-1',
        title: '节点一',
        goal: '节点目标一',
        suggestedTurns: totalTurns,
        turns: Array.from({ length: totalTurns }, (_, index) => ({
          id: `turn-${index + 1}`,
          goal: `轮次目标 ${index + 1}`,
          pacing: 'pressure' as StageTurnPacing_ACU,
          function: 'conflict' as const,
          mainlineDelta: 'step' as const,
          timeAdvance: 'continuous' as const,
        })),
      },
    ],
  };
}

function turns_ACU(pacings: readonly StageTurnPacing_ACU[]) {
  return pacings.map((pacing, index) => ({ id: `turn-${index + 1}`, goal: `轮次目标 ${index + 1}`, pacing }));
}

function expectValidationCode_ACU(action: () => unknown, code: string) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ContinuationValidationError_ACU);
    expect((error as ContinuationValidationError_ACU).error.code).toBe(code);
    return;
  }
  throw new Error(`Expected validation error ${code}`);
}

describe('Continuation outline schema', () => {
  it.each([
    ['short', undefined, undefined, { min: 3, max: 5 }],
    ['standard', undefined, undefined, { min: 6, max: 10 }],
    ['long', undefined, undefined, { min: 11, max: 20 }],
    ['custom', 1, 50, { min: 1, max: 50 }],
  ] as const)('resolves %s turn range strictly', (stageSize, min, max, expected) => {
    expect(resolveContinuationTurnRange_ACU(stageSize, min, max)).toEqual(expected);
  });

  it.each([
    ['short', 3, resolveContinuationTurnRange_ACU('short')],
    ['standard', 6, resolveContinuationTurnRange_ACU('standard')],
    ['long', 11, resolveContinuationTurnRange_ACU('long')],
    ['custom', 1, resolveContinuationTurnRange_ACU('custom', 1, 50)],
  ] as const)('accepts a %s outline at its lower bound', (_stageSize, totalTurns, range) => {
    const outline = validateStageOutline_ACU(buildOutline_ACU(totalTurns), range);

    expect(outline.totalTurns).toBe(totalTurns);
  });

  it('rejects invalid custom ranges instead of coercing them', () => {
    expectValidationCode_ACU(() => resolveContinuationTurnRange_ACU('custom', 0, 5), 'CONTINUATION_CUSTOM_RANGE_INVALID');
    expectValidationCode_ACU(() => resolveContinuationTurnRange_ACU('custom', 3, 2), 'CONTINUATION_CUSTOM_RANGE_INVALID');
    expectValidationCode_ACU(() => resolveContinuationTurnRange_ACU('custom', 1.5, 5), 'CONTINUATION_CUSTOM_RANGE_INVALID');
  });

  it('accepts a complete outline and returns a newly assembled value', () => {
    const raw = buildOutline_ACU();
    const validated = validateStageOutline_ACU(raw, resolveContinuationTurnRange_ACU('standard'));

    expect(validated).toEqual(raw);
    expect(validated).not.toBe(raw);
    expect(validated.nodes).not.toBe(raw.nodes);
  });

  it('rejects undefined required values before a clone could discard them', () => {
    const raw = buildOutline_ACU() as Record<string, unknown>;
    raw.title = undefined;

    expectValidationCode_ACU(() => validateStageOutline_ACU(raw, resolveContinuationTurnRange_ACU('standard')), 'CONTINUATION_OUTLINE_FIELD_TYPE_INVALID');
  });

  it('rejects unknown fields, duplicate ids and inconsistent turn totals', () => {
    const unknownField = buildOutline_ACU() as Record<string, unknown>;
    unknownField.unexpected = true;
    expectValidationCode_ACU(() => validateStageOutline_ACU(unknownField, resolveContinuationTurnRange_ACU('standard')), 'CONTINUATION_OUTLINE_UNKNOWN_FIELD');

    const duplicateNode = buildOutline_ACU();
    duplicateNode.nodes.push({
      id: 'node-1',
      title: '重复节点',
      goal: '重复节点目标',
      suggestedTurns: 1,
      turns: [{ id: 'turn-7', goal: '额外轮次', pacing: 'pressure' as StageTurnPacing_ACU }],
    });
    duplicateNode.totalTurns = 7;
    expectValidationCode_ACU(() => validateStageOutline_ACU(duplicateNode, resolveContinuationTurnRange_ACU('standard')), 'CONTINUATION_OUTLINE_NODE_ID_DUPLICATE');

    const duplicateTurn = buildOutline_ACU();
    duplicateTurn.nodes.push({
      id: 'node-2',
      title: '节点二',
      goal: '节点目标二',
      suggestedTurns: 1,
      turns: [{ id: 'turn-1', goal: '重复轮次', pacing: 'pressure' as StageTurnPacing_ACU }],
    });
    duplicateTurn.totalTurns = 7;
    duplicateTurn.nodes[0].suggestedTurns = 6;
    expectValidationCode_ACU(() => validateStageOutline_ACU(duplicateTurn, resolveContinuationTurnRange_ACU('standard')), 'CONTINUATION_OUTLINE_TURN_ID_DUPLICATE');

    const mismatch = buildOutline_ACU();
    mismatch.nodes[0].suggestedTurns = 5;
    expectValidationCode_ACU(() => validateStageOutline_ACU(mismatch, resolveContinuationTurnRange_ACU('standard')), 'CONTINUATION_OUTLINE_NODE_TURN_COUNT_MISMATCH');
  });

  it('新生成路径严格要求阶段角色与每轮功能、主线增量和时间跨度', () => {
    const range = resolveContinuationTurnRange_ACU('standard');
    expect(validateGeneratedStageOutline_ACU(buildOutline_ACU(), range)).toMatchObject({ role: 'development' });

    const missingRole = buildOutline_ACU() as Record<string, any>;
    delete missingRole.role;
    expectValidationCode_ACU(() => validateGeneratedStageOutline_ACU(missingRole, range), 'CONTINUATION_OUTLINE_FIELD_TYPE_INVALID');

    for (const field of ['function', 'mainlineDelta', 'timeAdvance'] as const) {
      const missingTurnField = buildOutline_ACU() as Record<string, any>;
      delete missingTurnField.nodes[0].turns[0][field];
      expectValidationCode_ACU(() => validateGeneratedStageOutline_ACU(missingTurnField, range), 'CONTINUATION_OUTLINE_FIELD_TYPE_INVALID');
    }
  });

  it('新生成路径拒绝非法组合与缺少锚点的长时间跳跃', () => {
    const range = resolveContinuationTurnRange_ACU('standard');
    const setupConflict = buildOutline_ACU();
    Object.assign(setupConflict.nodes[0].turns[0], { pacing: 'setup', function: 'conflict', mainlineDelta: 'hold' });
    expectValidationCode_ACU(() => validateGeneratedStageOutline_ACU(setupConflict, range), 'CONTINUATION_OUTLINE_FIELD_TYPE_INVALID');

    const longJump = buildOutline_ACU();
    Object.assign(longJump.nodes[0].turns[0], { function: 'transition', timeAdvance: 'weeks' });
    expectValidationCode_ACU(() => validateGeneratedStageOutline_ACU(longJump, range), 'CONTINUATION_OUTLINE_FIELD_MISSING');
  });

  it('草稿校验按 pacing 补默认并收集缺项，pacing 与 tempo 缺失记为不可默认', () => {
    const range = resolveContinuationTurnRange_ACU('standard');
    const draftInput = buildOutline_ACU() as Record<string, any>;
    draftInput.nodes[0].turns[0].pacing = 'setup';
    delete draftInput.nodes[0].turns[0].function;
    delete draftInput.nodes[0].turns[0].timeAdvance;
    draftInput.nodes[0].turns[1].pacing = 'cooldown';
    draftInput.nodes[0].turns[1].mainlineDelta = 'milestone';
    delete draftInput.nodes[0].turns[2].pacing;
    delete draftInput.tempo;

    const draft = validateGeneratedStageOutlineDraft_ACU(draftInput, range);
    expect(draft.outline.nodes[0].turns[0]).toMatchObject({ pacing: 'setup', function: 'transition', timeAdvance: 'same_day', inferred: ['function', 'timeAdvance'] });
    // 低压轮 + milestone 是矛盾组合：降级为 micro 并记缺项让模型改。
    expect(draft.outline.nodes[0].turns[1]).toMatchObject({ mainlineDelta: 'micro', inferred: ['mainlineDelta'] });
    expect(draft.missing.map(item => [item.field, item.nodeIndex, item.turnIndex, item.defaulted])).toEqual([
      ['tempo', null, null, false],
      ['function', 0, 0, true],
      ['timeAdvance', 0, 0, true],
      ['mainlineDelta', 0, 1, true],
      ['pacing', 0, 2, false],
    ]);
    // 硬拒绝路径仍然整份打回。
    expectValidationCode_ACU(() => validateGeneratedStageOutline_ACU(draftInput, range), 'CONTINUATION_OUTLINE_FIELD_TYPE_INVALID');
  });

  it('日常/经营轮的 goal 不再被关键词正则误杀', () => {
    const range = resolveContinuationTurnRange_ACU('standard');
    const outline = buildOutline_ACU();
    Object.assign(outline.nodes[0].turns[0], { pacing: 'setup', function: 'daily_bond', mainlineDelta: 'hold', timeAdvance: 'overnight', goal: '两人第一次一起做晚饭，她默默把咸淡交给他决定，饭后他第一次主动收拾碗筷' });
    Object.assign(outline.nodes[0].turns[1], { pacing: 'pressure', function: 'conflict', mainlineDelta: 'hold', goal: '守军围城已至第五日，主角带人守城头，粮草见底但不肯让出北门' });
    expect(validateGeneratedStageOutline_ACU(outline, range).nodes[0].turns[0].inferred).toBeUndefined();
    expect(validateGeneratedStageOutlineDraft_ACU(outline, range).missing).toEqual([]);
  });

  it('手改路径对旧形态大纲补默认而不拒绝，且 pressure 轮的默认与其节奏自洽', () => {
    const range = resolveContinuationTurnRange_ACU('standard');
    const legacy = buildOutline_ACU() as Record<string, any>;
    delete legacy.role;
    for (const turn of legacy.nodes[0].turns) { delete turn.function; delete turn.mainlineDelta; delete turn.timeAdvance; }
    legacy.nodes[0].turns[1].pacing = 'setup';
    legacy.nodes[0].turns[2].pacing = 'cooldown';
    legacy.nodes[0].turns[3].pacing = 'turn';
    const loaded = validateStageOutline_ACU(legacy, range);
    expect(loaded.role).toBe('development');
    expect(loaded.nodes[0].turns.slice(0, 4).map(turn => [turn.function, turn.mainlineDelta, turn.timeAdvance])).toEqual([
      ['conflict', 'step', 'continuous'],
      ['transition', 'hold', 'same_day'],
      ['recovery', 'hold', 'overnight'],
      ['reveal', 'step', 'continuous'],
    ]);
    expect(loaded.nodes[0].turns[0].inferred).toEqual(['function', 'mainlineDelta', 'timeAdvance']);
    // 加载归一化后再编辑一句 goal，应当直接通过而不是被组合规则打回。
    const edited = JSON.parse(JSON.stringify(loaded));
    edited.nodes[0].turns[2].goal = '改一句';
    expect(() => validateReplannedStageOutline_ACU(edited, range, { previousOutline: loaded, completedTurns: 1, expectedRemainingTurns: 5 })).not.toThrow();
    expect(() => validateEditedStageOutline_ACU(edited, range)).not.toThrow();
  });

  it('把 pacing 当可选键：存量大纲缺字段时回填 pressure，写错枚举值则报错', () => {
    const legacy = buildOutline_ACU(3) as Record<string, any>;
    for (const turn of legacy.nodes[0].turns) delete turn.pacing;

    const migrated = validateStageOutline_ACU(legacy, resolveContinuationTurnRange_ACU('short'));
    expect(migrated.nodes[0].turns.map(turn => turn.pacing)).toEqual(['pressure', 'pressure', 'pressure']);
    expect(migrated.nodes[0].turns.map(turn => turn.function)).toEqual(['conflict', 'conflict', 'conflict']);

    const bogus = buildOutline_ACU(3) as Record<string, any>;
    bogus.nodes[0].turns[0].pacing = 'fast';
    expectValidationCode_ACU(() => validateStageOutline_ACU(bogus, resolveContinuationTurnRange_ACU('short')), 'CONTINUATION_OUTLINE_FIELD_TYPE_INVALID');
  });

  it('把 tempo 当可选键：存量大纲缺字段时回填 mixed，写错枚举值则报错', () => {
    const legacy = buildOutline_ACU(3) as Record<string, any>;
    delete legacy.tempo;

    expect(validateStageOutline_ACU(legacy, resolveContinuationTurnRange_ACU('short')).tempo).toBe('mixed');

    const bogus = buildOutline_ACU(3) as Record<string, any>;
    bogus.tempo = 'fast';
    expectValidationCode_ACU(() => validateStageOutline_ACU(bogus, resolveContinuationTurnRange_ACU('short')), 'CONTINUATION_OUTLINE_FIELD_TYPE_INVALID');
  });

  it('enforces replan completed-prefix and remaining-turn invariants', () => {
    const range = resolveContinuationTurnRange_ACU('standard');
    const previous = validateStageOutline_ACU(buildOutline_ACU(), range);
    const constraints = { previousOutline: previous, completedTurns: 2, expectedRemainingTurns: 4 };

    expect(validateReplannedStageOutline_ACU(buildOutline_ACU(), range, constraints)).toEqual(previous);

    const rewritten = buildOutline_ACU();
    rewritten.nodes[0].turns[1].goal = '篡改已完成目标';
    expectValidationCode_ACU(() => validateReplannedStageOutline_ACU(rewritten, range, constraints), 'CONTINUATION_REPLAN_COMPLETED_PREFIX_CHANGED');

    // 编辑/手改路径：未完成后缀缺语义字段时按 pacing 补默认并标记 inferred，不再整份打回；
    // 草稿路径则把同一缺项收集出来供生成链路向模型索要修补。
    const missingSuffixField = buildOutline_ACU() as Record<string, any>;
    delete missingSuffixField.nodes[0].turns[2].function;
    expect(validateReplannedStageOutline_ACU(missingSuffixField, range, constraints).nodes[0].turns[2]).toMatchObject({ function: 'conflict', inferred: ['function'] });
    const draft = validateReplannedStageOutlineDraft_ACU(missingSuffixField, range, constraints);
    expect(draft.missing).toEqual([{ field: 'function', nodeIndex: 0, turnIndex: 2, goalHead: '轮次目标 3', actual: undefined, defaulted: true }]);
    const missingSuffixPacing = buildOutline_ACU() as Record<string, any>;
    delete missingSuffixPacing.nodes[0].turns[2].pacing;
    expect(validateReplannedStageOutlineDraft_ACU(missingSuffixPacing, range, constraints).missing).toMatchObject([{ field: 'pacing', defaulted: false }]);

    const rewrittenMetadata = buildOutline_ACU();
    rewrittenMetadata.nodes[0].turns[0].mainlineDelta = 'micro';
    expectValidationCode_ACU(() => validateReplannedStageOutline_ACU(rewrittenMetadata, range, constraints), 'CONTINUATION_REPLAN_COMPLETED_PREFIX_CHANGED');

    expectValidationCode_ACU(() => validateReplannedStageOutline_ACU(buildOutline_ACU(), range, { ...constraints, expectedRemainingTurns: 3 }), 'CONTINUATION_REPLAN_REMAINING_TURNS_MISMATCH');
  });
});

describe('validateStageOutlinePacing_ACU', () => {
  function options_ACU(overrides: Partial<StageOutlinePacingOptions_ACU> = {}): StageOutlinePacingOptions_ACU {
    return { tempo: 'mixed', previousTempo: null, leadingPressureStreak: 0, maxConsecutivePressureTurns: 8, ...overrides };
  }

  it('低压轮下限按形态查表并 ceil 取整，刚好满足时放行、差一轮时报错并给出实际数量', () => {
    // mixed 档 0.25：8 轮 → 至少 2 轮低压。
    expect(() => validateStageOutlinePacing_ACU(turns_ACU(['setup', 'cooldown', 'pressure', 'turn', 'pressure', 'pressure', 'turn', 'pressure']), options_ACU())).not.toThrow();

    try {
      validateStageOutlinePacing_ACU(turns_ACU(['setup', 'pressure', 'turn', 'pressure', 'pressure', 'turn']), options_ACU());
      throw new Error('expected pacing rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ContinuationValidationError_ACU);
      const failure = (error as ContinuationValidationError_ACU).error;
      expect(failure.code).toBe('CONTINUATION_OUTLINE_PACING_INVALID');
      expect(failure.phase).toBe('outline_validate');
      expect(failure.details).toMatchObject({ rule: 'downtime_floor', tempo: 'mixed', scopeTurns: 6, required: 2, actual: 1 });
      expect(String(failure.details?.labels)).toContain('第1轮=setup');
    }
  });

  it('形态决定下限：同一份 8 轮大纲在 buildup 下不合格，在 mixed 下合格，在 surge 下零低压也放行', () => {
    const twoDowntime = turns_ACU(['setup', 'cooldown', 'pressure', 'turn', 'pressure', 'pressure', 'turn', 'pressure']);
    expectValidationCode_ACU(() => validateStageOutlinePacing_ACU(twoDowntime, options_ACU({ tempo: 'buildup' })), 'CONTINUATION_OUTLINE_PACING_INVALID');
    expect(() => validateStageOutlinePacing_ACU(twoDowntime, options_ACU({ tempo: 'mixed' }))).not.toThrow();

    const allPressure = turns_ACU(['pressure', 'turn', 'pressure', 'pressure', 'turn', 'pressure', 'pressure', 'turn']);
    expect(() => validateStageOutlinePacing_ACU(allPressure, options_ACU({ tempo: 'surge' }))).not.toThrow();
    expectValidationCode_ACU(() => validateStageOutlinePacing_ACU(allPressure, options_ACU({ tempo: 'aftermath' })), 'CONTINUATION_OUTLINE_PACING_INVALID');
  });

  it('低压轮扎堆放在开头或结尾都合法：阶段内不存在任何周期性要求', () => {
    const front = turns_ACU(['setup', 'setup', 'pressure', 'turn', 'pressure', 'pressure', 'turn', 'pressure']);
    const back = turns_ACU(['pressure', 'turn', 'pressure', 'pressure', 'turn', 'pressure', 'cooldown', 'cooldown']);
    expect(() => validateStageOutlinePacing_ACU(front, options_ACU())).not.toThrow();
    expect(() => validateStageOutlinePacing_ACU(back, options_ACU())).not.toThrow();
  });

  it('不允许连续两个 surge 阶段，改成 aftermath 或 mixed 后放行', () => {
    const allPressure = turns_ACU(['pressure', 'turn', 'pressure', 'pressure']);
    try {
      validateStageOutlinePacing_ACU(allPressure, options_ACU({ tempo: 'surge', previousTempo: 'surge' }));
      throw new Error('expected tempo rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ContinuationValidationError_ACU);
      const failure = (error as ContinuationValidationError_ACU).error;
      expect(failure.details).toMatchObject({ rule: 'consecutive_surge_stages', tempo: 'surge', previousTempo: 'surge' });
    }

    expect(() => validateStageOutlinePacing_ACU(turns_ACU(['cooldown', 'cooldown', 'setup', 'pressure']), options_ACU({ tempo: 'aftermath', previousTempo: 'surge' }))).not.toThrow();
    expect(() => validateStageOutlinePacing_ACU(allPressure, options_ACU({ tempo: 'surge', previousTempo: 'buildup' }))).not.toThrow();
  });

  it('连续高压上限跨阶段累计：继承的连续段计入，超限时报错并说明其中多少来自已写剧情', () => {
    const turns = turns_ACU(['pressure', 'turn', 'pressure', 'cooldown']);
    expect(() => validateStageOutlinePacing_ACU(turns, options_ACU({ leadingPressureStreak: 4, maxConsecutivePressureTurns: 8 }))).not.toThrow();

    try {
      validateStageOutlinePacing_ACU(turns, options_ACU({ leadingPressureStreak: 6, maxConsecutivePressureTurns: 8 }));
      throw new Error('expected pacing rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ContinuationValidationError_ACU);
      const failure = (error as ContinuationValidationError_ACU).error;
      expect(failure.details).toMatchObject({ rule: 'pressure_streak', turnNumber: 3, streak: 9, limit: 8, leadingPressureStreak: 6 });
      expect(String(failure.message)).toContain('其中 6 轮来自前面已经写完的剧情');
    }
  });

  it('surge 阶段豁免连续高压上限：surge 的债由下一阶段的低压下限来还', () => {
    const longSurge = turns_ACU(['pressure', 'turn', 'pressure', 'pressure', 'turn', 'pressure', 'pressure', 'turn', 'pressure', 'pressure']);
    expect(() => validateStageOutlinePacing_ACU(longSurge, options_ACU({ tempo: 'surge', leadingPressureStreak: 5, maxConsecutivePressureTurns: 8 }))).not.toThrow();
    // 紧随其后的 mixed 阶段带着 15 轮的连续高压进来，开头必须立刻给低压轮。
    expectValidationCode_ACU(() => validateStageOutlinePacing_ACU(turns_ACU(['pressure', 'setup', 'cooldown', 'pressure']), options_ACU({ tempo: 'mixed', previousTempo: 'surge', leadingPressureStreak: 15 })), 'CONTINUATION_OUTLINE_PACING_INVALID');
    expect(() => validateStageOutlinePacing_ACU(turns_ACU(['cooldown', 'setup', 'pressure', 'pressure']), options_ACU({ tempo: 'mixed', previousTempo: 'surge', leadingPressureStreak: 15 }))).not.toThrow();
  });

  it('上限为 0 时整条连续高压规则关闭', () => {
    expect(() => validateStageOutlinePacing_ACU(turns_ACU(['pressure', 'pressure', 'pressure', 'setup']), options_ACU({ leadingPressureStreak: 99, maxConsecutivePressureTurns: 0 }))).not.toThrow();
  });

  it('重规划的低压下限只看剩余轮次，但已完成前缀的连续高压仍由上下文带入', () => {
    // 前 4 轮是迁移回填的 pressure，按 aftermath 的六成下限全量算必然违规；跳过后剩余 3 轮自身合规。
    const all = turns_ACU(['pressure', 'pressure', 'pressure', 'pressure', 'setup', 'pressure', 'cooldown']);
    expectValidationCode_ACU(() => validateStageOutlinePacing_ACU(all, options_ACU({ tempo: 'aftermath' })), 'CONTINUATION_OUTLINE_PACING_INVALID');
    expect(() => validateStageOutlinePacing_ACU(all, options_ACU({ tempo: 'aftermath', skipTurns: 4 }))).not.toThrow();
    // 同样跳过前缀，但把前缀的连续高压带进来后，剩余部分的第一轮就已经越界。
    expectValidationCode_ACU(
      () => validateStageOutlinePacing_ACU(turns_ACU(['pressure', 'pressure', 'pressure', 'pressure', 'pressure', 'setup', 'cooldown']), options_ACU({ skipTurns: 4, leadingPressureStreak: 8 })),
      'CONTINUATION_OUTLINE_PACING_INVALID',
    );
  });

  it('剩余轮次为空时直接放行，不做除零判断', () => {
    const all = turns_ACU(['pressure', 'pressure']);
    expect(() => validateStageOutlinePacing_ACU(all, options_ACU({ skipTurns: 2 }))).not.toThrow();
    expect(() => validateStageOutlinePacing_ACU(all, options_ACU({ skipTurns: 99 }))).not.toThrow();
    expect(() => validateStageOutlinePacing_ACU([], options_ACU())).not.toThrow();
  });

  it('listStageOutlineTurns_ACU 按阶段内顺序展开全部轮次', () => {
    const outline = validateStageOutline_ACU(buildOutline_ACU(6), resolveContinuationTurnRange_ACU('standard'));
    expect(listStageOutlineTurns_ACU(outline).map(turn => turn.id)).toEqual(['turn-1', 'turn-2', 'turn-3', 'turn-4', 'turn-5', 'turn-6']);
  });
});

describe('resolveStageOutlinePacingContext_ACU', () => {
  function stage_ACU(stageId: string, stageNumber: number, pacings: readonly StageTurnPacing_ACU[], completedTurns: number, tempo: StageTempo_ACU): ContinuationStage_ACU {
    return {
      stageId,
      stageNumber,
      status: 'completed',
      chronicleStartCount: 0,
      chronicleEndCount: null,
      chronicleAddedCount: null,
      chronicleRange: null,
      activeRevision: 1,
      revisions: [{
        revision: 1,
        createdAt: 0,
        reason: 'initial',
        replanInstruction: '',
        frozen: true,
        outline: {
          schemaVersion: 1,
          title: `阶段${stageNumber}`,
          goal: '目标',
          tempo,
          totalTurns: pacings.length,
          nodes: [{ id: `${stageId}-node`, title: '节点', goal: '节点目标', suggestedTurns: pacings.length, turns: turns_ACU(pacings).map(turn => ({ ...turn, id: `${stageId}-${turn.id}` })) }],
        },
      }],
      activeNodeIndex: 0,
      activeTurnIndex: 0,
      completedTurns,
    };
  }

  it('countTrailingPressureTurns_ACU 从尾部数到第一个低压轮为止', () => {
    expect(countTrailingPressureTurns_ACU(turns_ACU(['setup', 'pressure', 'turn', 'pressure']))).toBe(3);
    expect(countTrailingPressureTurns_ACU(turns_ACU(['pressure', 'cooldown']))).toBe(0);
    expect(countTrailingPressureTurns_ACU([])).toBe(0);
  });

  it('新阶段继承上一阶段的形态与尾部连续高压段', () => {
    const stages = [stage_ACU('stage-1', 1, ['setup', 'pressure', 'turn'], 3, 'surge')];
    expect(resolveStageOutlinePacingContext_ACU(stages, null)).toEqual({ previousTempo: 'surge', leadingPressureStreak: 2 });
  });

  it('连续段横跨多个阶段时首尾相接累计', () => {
    const stages = [
      stage_ACU('stage-1', 1, ['setup', 'pressure', 'pressure'], 3, 'mixed'),
      stage_ACU('stage-2', 2, ['turn', 'pressure', 'cooldown'], 2, 'surge'),
    ];
    // 阶段一尾部 2 轮 + 阶段二已完成的 2 轮（cooldown 还没写到）= 4。
    expect(resolveStageOutlinePacingContext_ACU(stages, null)).toEqual({ previousTempo: 'surge', leadingPressureStreak: 4 });
  });

  it('重规划某个阶段时，上一阶段形态取它前面那个阶段，已完成前缀参与连续计数', () => {
    const stages = [
      stage_ACU('stage-1', 1, ['setup', 'pressure', 'pressure'], 3, 'buildup'),
      stage_ACU('stage-2', 2, ['pressure', 'turn', 'setup'], 2, 'surge'),
    ];
    expect(resolveStageOutlinePacingContext_ACU(stages, 'stage-2')).toEqual({ previousTempo: 'buildup', leadingPressureStreak: 4 });
  });

  it('第一个阶段没有前序：形态为 null、连续段为 0', () => {
    expect(resolveStageOutlinePacingContext_ACU([], null)).toEqual({ previousTempo: null, leadingPressureStreak: 0 });
    const stages = [stage_ACU('stage-1', 1, ['pressure', 'pressure'], 0, 'mixed')];
    expect(resolveStageOutlinePacingContext_ACU(stages, 'stage-1')).toEqual({ previousTempo: null, leadingPressureStreak: 0 });
  });
});

describe('Continuation defaults', () => {
  it('keeps required default settings and independent prompt arrays', () => {
    const first = buildDefaultContinuationSettings_ACU();
    const second = buildDefaultContinuationSettings_ACU();

    expect(first.stageSize).toBe('standard');
    expect(first.outlinePreview).toBe(false);
    expect(first.autoNextStage).toBe(true);
    expect(first.maxAutomaticStages).toBe(6);
    expect(first.internalAiRetryLimit).toBe(3);
    expect(first.apiPresetMode).toBe('current');
    expect(first.promptForceDefaultVersion).toBe('spv3.6-continuation-default-lineage-v28');
    expect(first.outlinePrompt[0].content).toContain('<stage_title>');
    expect(first.maxConsecutivePressureTurns).toBe(8);
    expect(first.agentPrompts.main[0].content).toContain('主控 Agent');
    expect(first.agentPrompts.arcArchitect[0].content).toContain('故事总纲子代理');
    expect(first.agentPrompts.arcArchitect[6].content).toContain('短线 7–8 卷、中线 10–14 卷、长线 20 卷');
    expect(first.agentPrompts.maintainer[0].content).toContain('伏笔与认知维护子代理');
    expect(first.agentPrompts.mainlinePlanner[0].content).toContain('主线推进策划子代理');
    expect(first.agentPrompts.beatPlanner[0].content).toContain('伏笔与节拍策划子代理');
    expect(first.agentPrompts.reviewer[0].content).toContain('连续性审查子代理');

    first.outlinePrompt[0].content = 'modified';
    first.agentPrompts.main[0].content = 'modified';
    expect(second.outlinePrompt[0].content).not.toBe('modified');
    expect(second.agentPrompts.main[0].content).not.toBe('modified');
  });

  it('distinguishes missing settings, explicit zero, and invalid numeric values', () => {
    expect(normalizeContinuationInternalAiRetryLimit_ACU(undefined)).toBe(3);
    expect(normalizeContinuationInternalAiRetryLimit_ACU(0)).toBe(0);
    expectValidationCode_ACU(() => normalizeContinuationInternalAiRetryLimit_ACU(-1), 'CONTINUATION_CONFIG_OUT_OF_RANGE');
    expectValidationCode_ACU(() => normalizeContinuationInternalAiRetryLimit_ACU(1.5), 'CONTINUATION_CONFIG_NOT_INTEGER');

    expect(normalizeContinuationMaxAutomaticStages_ACU(undefined)).toBe(6);
    expect(normalizeContinuationMaxAutomaticStages_ACU(1)).toBe(1);
    expectValidationCode_ACU(() => normalizeContinuationMaxAutomaticStages_ACU(0), 'CONTINUATION_CONFIG_OUT_OF_RANGE');
  });
});
