import { describe, expect, it } from 'vitest';

import { applyAgentConstraintRegistration_ACU, applyAgentModuleDelta_ACU, mergeAgentDeltaRevisions_ACU } from '../../../../src/service/continuation/agent/agent-transaction';
import { buildEmptyAgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-module-store';
import type { AgentModuleDelta_ACU, AgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-model';

function baseSnapshot_ACU(): AgentModuleSnapshot_ACU {
  return {
    ...buildEmptyAgentModuleSnapshot_ACU(),
    settledThroughIndex: 5,
    revisions: { hooks: 2, infoGap: 3, constraints: 1, storyArc: 4, chronology: 5 },
    hooks: [{ id: 'H1', summary: '断裂的封印', status: 'planted', importance: 'high', plantedIndex: 2, updatedIndex: 2, plannedPayoff: '第三阶段回收', retired: false, retiredReason: '' }],
    infoGap: [{ id: 'E1', topic: '守门人身份', objectiveFact: '内应', readerKnown: '行为反常', characterKnowledge: [], revealStatus: 'unrevealed', revealIndex: null, retired: false, retiredReason: '' }],
    constraints: [{ id: 'C01-1', text: '不得提前揭穿幕后', reason: '既有裁决', createdIndex: 3 }],
    chronology: [{ id: 'T1', anchor: '抵达临川城的当日', elapsed: '自开篇约十日', precision: 'approximate' as const, transition: '从渡口行船三日抵达临川城', evidenceIndexes: [2, 3], updatedIndex: 3, retired: false, retiredReason: '' }],
  };
}

function delta_ACU(patch: Partial<AgentModuleDelta_ACU> = {}): AgentModuleDelta_ACU {
  return { expectedRevisions: {}, hooks: [], hookPatches: [], infoGap: [], infoGapPatches: [], storyArc: [], storyArcPatches: [], chronology: [], constraintProposals: [], ...patch };
}

function chronologyItem_ACU(patch: Record<string, unknown> = {}) {
  return { action: 'upsert' as const, id: 'T2', anchor: '入城后的第七天', elapsed: '自开篇约十七日', precision: 'approximate' as const, transition: '在临川城休整七日', evidenceIndexes: [4, 5], reason: '', ...patch };
}

function hookItem_ACU(patch: Record<string, unknown> = {}) {
  return { action: 'upsert' as const, id: 'H1', summary: '断裂的封印被再次触碰', status: 'reinforced' as const, importance: 'high' as const, plantedIndex: 9, plannedPayoff: '第三阶段回收', reason: '', ...patch };
}

function infoGapItem_ACU(patch: Record<string, unknown> = {}) {
  return { action: 'upsert' as const, id: 'E1', topic: '守门人身份', objectiveFact: '内应', readerKnown: '行为反常', characterKnowledge: [], revealStatus: 'unrevealed' as const, revealIndex: null, reason: '', ...patch };
}

function storyArcItem_ACU(patch: Record<string, unknown> = {}) {
  return {
    action: 'upsert' as const,
    id: 'VOL-01',
    scope: 'volume' as const,
    title: '商行之乱',
    direction: '主角夺回被夺走的商行控制权，对抗表亲与其背后的钱庄',
    escalation: '从账目纠纷抬到人身威胁，收在主角拿回印信但发现账本上有第三方签名',
    withheld: '第三方就是主角生父的旧部',
    status: 'active' as const,
    narrativeRole: 'development' as const,
    targetStageRange: { min: 2, max: 4 },
    targetTimeSpan: '约一个月',
    progressCeiling: '只查明第三方签名存在，不揭示幕后首脑',
    sustainingThreads: ['主角与账房逐步建立信任'],
    payoffTargets: ['兑现主角夺回印信的期待'],
    stageNumbers: [] as number[],
    completionStageNumber: null,
    completionState: '',
    continuationRationale: '',
    completionRationale: '',
    reason: '',
    ...patch,
  };
}

describe('Agent 总纲写集事务', () => {
  it('storyArc 不在授权写集时整份拒绝', () => {
    const input = delta_ACU({ storyArc: [storyArcItem_ACU()] });
    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), input, ['hooks'], 6)).toThrowError(/未授权模块/);
  });

  it('upsert 校验必填字段：title、direction 与卷台阶的 escalation', () => {
    const noTitle = delta_ACU({ storyArc: [storyArcItem_ACU({ title: '  ' })] });
    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), noTitle, ['storyArc'], 6)).toThrowError(/title 不能为空/);

    const noDirection = delta_ACU({ storyArc: [storyArcItem_ACU({ direction: '' })] });
    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), noDirection, ['storyArc'], 6)).toThrowError(/direction 不能为空/);

    const noEscalation = delta_ACU({ storyArc: [storyArcItem_ACU({ escalation: '' })] });
    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), noEscalation, ['storyArc'], 6)).toThrowError(/escalation/);
  });

  it('对既有卷重复 upsert 时，省略或留空的字段沿用原值，status 未明确写出时不回落成 planned', () => {
    const first = applyAgentModuleDelta_ACU(baseSnapshot_ACU(), delta_ACU({ storyArc: [storyArcItem_ACU()] }), ['storyArc'], 6);
    // 模型按惯性“更新总纲”：只带了 title 与 direction，其余留空、status 省略。
    const habitual = delta_ACU({ storyArc: [storyArcItem_ACU({ direction: '主角夺回商行控制权（措辞微调）', escalation: '', withheld: '', status: 'planned', statusProvided: false })] });
    const second = applyAgentModuleDelta_ACU(first, habitual, ['storyArc'], 7);
    const volume = second.storyArc.find(entry => entry.id === 'VOL-01')!;
    expect(volume.direction).toBe('主角夺回商行控制权（措辞微调）');
    expect(volume.escalation).toBe('从账目纠纷抬到人身威胁，收在主角拿回印信但发现账本上有第三方签名');
    expect(volume.withheld).toBe('第三方就是主角生父的旧部');
    expect(volume.status).toBe('active');
    // 明确写了 status 才会进入状态校验：active → planned 是倒退，被生命周期规则拒绝。
    const explicit = delta_ACU({ storyArc: [storyArcItem_ACU({ status: 'planned', statusProvided: true })] });
    expect(() => applyAgentModuleDelta_ACU(second, explicit, ['storyArc'], 8)).toThrowError(/单向推进/);
  });

  it('新卷的 P2 契约必须完整、范围合法，story 条目不得携带卷级字段', () => {
    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), delta_ACU({
      storyArc: [storyArcItem_ACU({ payoffTargets: undefined })],
    }), ['storyArc'], 6)).toThrowError(/至少需要一条 payoffTargets/);
    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), delta_ACU({
      storyArc: [storyArcItem_ACU({ targetStageRange: { min: 0, max: 2 } })],
    }), ['storyArc'], 6)).toThrowError(/targetStageRange/);
    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), delta_ACU({
      storyArc: [storyArcItem_ACU({ sustainingThreads: [''] })],
    }), ['storyArc'], 6)).toThrowError(/sustainingThreads 不得包含空项/);
    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), delta_ACU({
      storyArc: [storyArcItem_ACU({
        id: 'ARC-STORY', scope: 'story', escalation: '', targetStageRange: undefined, targetTimeSpan: undefined,
        progressCeiling: undefined, sustainingThreads: undefined, payoffTargets: undefined, completionRationale: undefined,
      })],
    }), ['storyArc'], 6)).toThrowError(/不得携带卷级容量字段/);
  });

  it('全书方向只能有一条活跃条目，同一份写集里先 retire 再 upsert 放行', () => {
    const twoStories = delta_ACU({
      storyArc: [
        storyArcItem_ACU({ id: 'ARC-STORY', scope: 'story', title: '全书方向', escalation: '', narrativeRole: undefined, targetStageRange: undefined, targetTimeSpan: undefined, progressCeiling: undefined, sustainingThreads: undefined, payoffTargets: undefined, completionRationale: undefined }),
        storyArcItem_ACU({ id: 'ARC-STORY-2', scope: 'story', title: '另一个全书方向', escalation: '', narrativeRole: undefined, targetStageRange: undefined, targetTimeSpan: undefined, progressCeiling: undefined, sustainingThreads: undefined, payoffTargets: undefined, completionRationale: undefined }),
      ],
    });
    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), twoStories, ['storyArc'], 6)).toThrowError(/只能有一条活跃条目/);

    const seeded = applyAgentModuleDelta_ACU(baseSnapshot_ACU(), delta_ACU({ storyArc: [storyArcItem_ACU({ id: 'ARC-STORY', scope: 'story', escalation: '', narrativeRole: undefined, targetStageRange: undefined, targetTimeSpan: undefined, progressCeiling: undefined, sustainingThreads: undefined, payoffTargets: undefined, completionRationale: undefined })] }), ['storyArc'], 6);
    const replaced = applyAgentModuleDelta_ACU(seeded, delta_ACU({
      storyArc: [
        storyArcItem_ACU({ action: 'retire', id: 'ARC-STORY', reason: '方向已被真实剧情推翻' }),
        storyArcItem_ACU({ id: 'ARC-STORY-2', scope: 'story', escalation: '', narrativeRole: undefined, targetStageRange: undefined, targetTimeSpan: undefined, progressCeiling: undefined, sustainingThreads: undefined, payoffTargets: undefined, completionRationale: undefined }),
      ],
    }), ['storyArc'], 6);
    expect(replaced.storyArc.filter(entry => entry.scope === 'story' && !entry.retired)).toHaveLength(1);
  });

  it('retire 必须命中既有条目并给出理由', () => {
    const unknown = delta_ACU({ storyArc: [storyArcItem_ACU({ action: 'retire', id: 'VOL-09', reason: '不再需要' })] });
    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), unknown, ['storyArc'], 6)).toThrowError(/retire 的总纲条目不存在/);

    const seeded = applyAgentModuleDelta_ACU(baseSnapshot_ACU(), delta_ACU({ storyArc: [storyArcItem_ACU()] }), ['storyArc'], 6);
    const noReason = delta_ACU({ storyArc: [storyArcItem_ACU({ action: 'retire', reason: '' })] });
    expect(() => applyAgentModuleDelta_ACU(seeded, noReason, ['storyArc'], 6)).toThrowError(/必须给出理由/);
  });

  it('patch 回写阶段进度只改给定字段，且只给 storyArc 升版本、不动结算水位', () => {
    const seeded = applyAgentModuleDelta_ACU(baseSnapshot_ACU(), delta_ACU({ storyArc: [storyArcItem_ACU({ stageNumbers: [1] })] }), ['storyArc'], 6, [1]);
    expect(seeded.revisions).toEqual({ hooks: 2, infoGap: 3, constraints: 1, storyArc: 5, chronology: 5 });

    const patched = applyAgentModuleDelta_ACU(seeded, delta_ACU({ storyArcPatches: [{ id: 'VOL-01', stageNumbers: [3, 2, 2] }] }), ['storyArc'], 9, [2, 3]);
    expect(patched.storyArc[0].stageNumbers).toEqual([2, 3]);
    expect(patched.storyArc[0].direction).toBe(seeded.storyArc[0].direction);
    expect(patched.revisions).toEqual({ hooks: 2, infoGap: 3, constraints: 1, storyArc: 6, chronology: 5 });
    expect(patched.settledThroughIndex).toBe(seeded.settledThroughIndex);
  });

  it('同一 active 卷可渐进登记多个已完成阶段，不会因单个阶段完成而切卷', () => {
    const seeded = applyAgentModuleDelta_ACU(baseSnapshot_ACU(), delta_ACU({
      storyArc: [
        storyArcItem_ACU({ id: 'VOL-01', status: 'active', stageNumbers: [] }),
        storyArcItem_ACU({ id: 'VOL-02', status: 'planned', title: '第二卷', direction: '追查第三方签名', escalation: '收在第三方主动灭口', withheld: '第三方身份' }),
      ],
    }), ['storyArc'], 6);

    const afterFirstStage = applyAgentModuleDelta_ACU(seeded, delta_ACU({ storyArcPatches: [{ id: 'VOL-01', stageNumbers: [1] }] }), ['storyArc'], 7, [1]);
    const afterSecondStage = applyAgentModuleDelta_ACU(afterFirstStage, delta_ACU({ storyArcPatches: [{ id: 'VOL-01', stageNumbers: [1, 2] }] }), ['storyArc'], 8, [1, 2]);

    expect(afterSecondStage.storyArc.find(item => item.id === 'VOL-01')).toMatchObject({ status: 'active', stageNumbers: [1, 2], completionStageNumber: null });
    expect(afterSecondStage.storyArc.find(item => item.id === 'VOL-02')).toMatchObject({ status: 'planned', stageNumbers: [] });
  });

  it('卷完成必须引用已登记且真实完成的阶段，并原子激活下一卷', () => {
    const seeded = applyAgentModuleDelta_ACU(baseSnapshot_ACU(), delta_ACU({
      storyArc: [
        storyArcItem_ACU({ id: 'VOL-01', status: 'active', stageNumbers: [1, 2] }),
        storyArcItem_ACU({ id: 'VOL-02', status: 'planned', title: '第二卷', direction: '追查第三方签名', escalation: '收在第三方主动灭口', withheld: '第三方身份' }),
      ],
    }), ['storyArc'], 6, [1, 2]);

    expect(() => applyAgentModuleDelta_ACU(seeded, delta_ACU({ storyArcPatches: [{ id: 'VOL-01', status: 'done', completionStageNumber: 2 }] }), ['storyArc'], 8, [1, 2]))
      .toThrowError(/必须说明已达到的卷末状态/);
    expect(() => applyAgentModuleDelta_ACU(seeded, delta_ACU({ storyArcPatches: [{ id: 'VOL-01', status: 'done', completionStageNumber: 3, completionState: '商行控制权已夺回' }] }), ['storyArc'], 8, [1, 2]))
      .toThrowError(/必须已登记进 stageNumbers/);

    expect(() => applyAgentModuleDelta_ACU(seeded, delta_ACU({ storyArcPatches: [
      { id: 'VOL-01', status: 'done', completionStageNumber: 2, completionState: '主角夺回印信，第三方签名浮出水面' },
      { id: 'VOL-02', status: 'active' },
    ] }), ['storyArc'], 8, [1, 2])).toThrowError(/payoffTargets 的兑现证据/);

    const advanced = applyAgentModuleDelta_ACU(seeded, delta_ACU({ storyArcPatches: [
      {
        id: 'VOL-01', status: 'done', completionStageNumber: 2,
        completionState: '主角夺回印信，第三方签名浮出水面；已兑现主角夺回印信的期待；主角与账房逐步建立信任转入下一卷继续经营。',
      },
      { id: 'VOL-02', status: 'active' },
    ] }), ['storyArc'], 8, [1, 2]);

    expect(advanced.storyArc.find(item => item.id === 'VOL-01')).toMatchObject({ status: 'done', completionStageNumber: 2 });
    expect(advanced.storyArc.find(item => item.id === 'VOL-02')).toMatchObject({ status: 'active' });
  });

  it('卷容量偏离目标范围时必须说明原因，旧卷没有 P2 契约时仍按旧生命周期兼容', () => {
    const seeded = applyAgentModuleDelta_ACU(baseSnapshot_ACU(), delta_ACU({ storyArc: [
      storyArcItem_ACU({ id: 'VOL-01', status: 'active', stageNumbers: [1, 2, 3, 4, 5] }),
    ] }), ['storyArc'], 6, [1, 2, 3, 4, 5]);
    expect(() => applyAgentModuleDelta_ACU(seeded, delta_ACU({ storyArcPatches: [{
      id: 'VOL-01', status: 'done', completionStageNumber: 5,
      completionState: '已兑现主角夺回印信的期待；主角与账房逐步建立信任转入下一卷继续经营。',
    }] }), ['storyArc'], 7, [1, 2, 3, 4, 5])).toThrowError(/偏离目标 2–4 时必须给出 completionRationale/);

    const legacy = storyArcItem_ACU({ narrativeRole: undefined, targetStageRange: undefined, targetTimeSpan: undefined, progressCeiling: undefined, sustainingThreads: undefined, payoffTargets: undefined, completionRationale: undefined, stageNumbers: [1] });
    const { action: _legacyAction, reason: _legacyReason, ...legacyEntry } = legacy;
    const legacySeeded = {
      ...baseSnapshot_ACU(),
      storyArc: [{ ...legacyEntry, retired: false, retiredReason: '' }],
    } as AgentModuleSnapshot_ACU;
    const completed = applyAgentModuleDelta_ACU(legacySeeded, delta_ACU({ storyArcPatches: [{
      id: 'VOL-01', status: 'done', completionStageNumber: 1, completionState: '旧卷既定收束状态已由第一阶段完成。',
    }] }), ['storyArc'], 7, [1]);
    expect(completed.storyArc[0]).toMatchObject({ status: 'done', completionStageNumber: 1, targetStageRange: undefined });
  });

  it('已完成卷不能重激活，全部既有卷完成后扩卷必须给出续卷依据', () => {
    const seeded = applyAgentModuleDelta_ACU(baseSnapshot_ACU(), delta_ACU({
      storyArc: [storyArcItem_ACU({ id: 'VOL-01', status: 'active', stageNumbers: [1] })],
    }), ['storyArc'], 6, [1]);
    const completed = applyAgentModuleDelta_ACU(seeded, delta_ACU({ storyArcPatches: [{
      id: 'VOL-01', status: 'done', completionStageNumber: 1, completionState: '商行印信回到主角手中，第三方签名留下新线索；已兑现主角夺回印信的期待；主角与账房逐步建立信任转入下一卷继续经营。',
      completionRationale: '本卷在单个高密度阶段内完成，收束证据完整。',
    }] }), ['storyArc'], 7, [1]);

    expect(() => applyAgentModuleDelta_ACU(completed, delta_ACU({ storyArcPatches: [{ id: 'VOL-01', status: 'active' }] }), ['storyArc'], 8, [1]))
      .toThrowError(/不可重新激活/);
    expect(() => applyAgentModuleDelta_ACU(completed, delta_ACU({ storyArc: [storyArcItem_ACU({
      id: 'VOL-02', title: '第二卷', direction: '追查第三方签名', escalation: '收在第三方主动灭口', withheld: '第三方身份', status: 'active',
    })] }), ['storyArc'], 8, [1]))
      .toThrowError(/必须说明续卷依据/);

    const expanded = applyAgentModuleDelta_ACU(completed, delta_ACU({ storyArc: [storyArcItem_ACU({
      id: 'VOL-02', title: '第二卷', direction: '追查第三方签名', escalation: '收在第三方主动灭口', withheld: '第三方身份', status: 'active',
      continuationRationale: '第一卷留下的第三方签名把商行争夺升级为追查幕后势力。',
    })] }), ['storyArc'], 8, [1]);
    expect(expanded.storyArc.find(item => item.id === 'VOL-02')).toMatchObject({ status: 'active', continuationRationale: '第一卷留下的第三方签名把商行争夺升级为追查幕后势力。' });
  });

  it('已废止的条目不可 patch', () => {
    const seeded = applyAgentModuleDelta_ACU(baseSnapshot_ACU(), delta_ACU({ storyArc: [storyArcItem_ACU()] }), ['storyArc'], 6);
    const retired = applyAgentModuleDelta_ACU(seeded, delta_ACU({ storyArc: [storyArcItem_ACU({ action: 'retire', reason: '本卷取消' })] }), ['storyArc'], 6);
    expect(() => applyAgentModuleDelta_ACU(retired, delta_ACU({ storyArcPatches: [{ id: 'VOL-01', status: 'done' }] }), ['storyArc'], 6)).toThrowError(/已废止/);
  });

  it('upsert 不带 stageNumbers 时保留既有进度锚', () => {
    const seeded = applyAgentModuleDelta_ACU(baseSnapshot_ACU(), delta_ACU({ storyArc: [storyArcItem_ACU({ stageNumbers: [1, 2] })] }), ['storyArc'], 6, [1, 2]);
    const rewritten = applyAgentModuleDelta_ACU(seeded, delta_ACU({ storyArc: [storyArcItem_ACU({ direction: '方向改写为主角主动出击' })] }), ['storyArc'], 6);
    expect(rewritten.storyArc[0].stageNumbers).toEqual([1, 2]);
  });
});

describe('Agent 写集事务', () => {
  it('越权写入被拒绝', () => {
    const input = delta_ACU({ expectedRevisions: { hooks: 2 }, hooks: [hookItem_ACU()] });
    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), input, ['infoGap'], 6)).toThrowError(/未授权模块/);
  });

  it('子代理声明的版本号不匹配时拒绝整份写入', () => {
    const stale = delta_ACU({ expectedRevisions: { hooks: 1 }, hooks: [hookItem_ACU()] });
    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), stale, ['hooks'], 6)).toThrowError(/revision 已变化/);
  });

  it('未声明版本号时不拒绝，并发基准由运行时按读取时刻补齐', () => {
    const missing = delta_ACU({ hooks: [hookItem_ACU()] });
    expect(applyAgentModuleDelta_ACU(baseSnapshot_ACU(), missing, ['hooks'], 6).revisions.hooks).toBe(3);

    const merged = mergeAgentDeltaRevisions_ACU(missing, { hooks: 1, infoGap: 3, constraints: 1 });
    expect(merged.expectedRevisions).toEqual({ hooks: 1 });
    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), merged, ['hooks'], 6)).toThrowError(/revision 已变化/);
  });

  it('补齐不会覆盖子代理已显式声明的版本号，也不给未触碰模块补值', () => {
    const declared = delta_ACU({ expectedRevisions: { hooks: 2 }, hooks: [hookItem_ACU()] });
    const merged = mergeAgentDeltaRevisions_ACU(declared, { hooks: 9, infoGap: 9, constraints: 9 });
    expect(merged.expectedRevisions).toEqual({ hooks: 2 });
    expect(applyAgentModuleDelta_ACU(baseSnapshot_ACU(), merged, ['hooks'], 6).revisions.hooks).toBe(3);
  });

  it('upsert 保留原有埋设楼层并只给被写模块升版本', () => {
    const applied = applyAgentModuleDelta_ACU(baseSnapshot_ACU(), delta_ACU({ expectedRevisions: { hooks: 2 }, hooks: [hookItem_ACU()] }), ['hooks'], 6);

    expect(applied.hooks[0].plantedIndex).toBe(2);
    expect(applied.hooks[0].status).toBe('reinforced');
    expect(applied.hooks[0].updatedIndex).toBe(6);
    expect(applied.revisions).toEqual({ hooks: 3, infoGap: 3, constraints: 1, storyArc: 4, chronology: 5 });
  });

  it('retire 必须命中既有条目并给出理由', () => {
    const unknown = delta_ACU({ expectedRevisions: { hooks: 2 }, hooks: [hookItem_ACU({ action: 'retire', id: 'H9', reason: '完成回收' })] });
    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), unknown, ['hooks'], 6)).toThrowError(/retire 的伏笔不存在/);

    const noReason = delta_ACU({ expectedRevisions: { hooks: 2 }, hooks: [hookItem_ACU({ action: 'retire', reason: '' })] });
    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), noReason, ['hooks'], 6)).toThrowError(/必须给出理由/);

    const applied = applyAgentModuleDelta_ACU(baseSnapshot_ACU(), delta_ACU({ expectedRevisions: { hooks: 2 }, hooks: [hookItem_ACU({ action: 'retire', reason: '完成回收' })] }), ['hooks'], 6);
    expect(applied.hooks[0]).toMatchObject({ retired: true, retiredReason: '完成回收' });
  });

  it('信息差的揭示状态与揭示楼层必须自洽', () => {
    const fakeReveal = delta_ACU({ expectedRevisions: { infoGap: 3 }, infoGap: [infoGapItem_ACU({ revealIndex: 6 })] });
    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), fakeReveal, ['infoGap'], 6)).toThrowError(/揭示楼层必须为空/);

    const missingIndex = delta_ACU({ expectedRevisions: { infoGap: 3 }, infoGap: [infoGapItem_ACU({ revealStatus: 'partial' })] });
    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), missingIndex, ['infoGap'], 6)).toThrowError(/必须给出揭示楼层/);
  });

  it('patch 只改给定字段并保留其余字段，版本号照常递增', () => {
    const applied = applyAgentModuleDelta_ACU(
      baseSnapshot_ACU(),
      delta_ACU({ hookPatches: [{ id: 'H1', summary: '封印裂缝开始渗出黑雾' }] }),
      ['hooks'],
      7,
    );
    expect(applied.hooks[0]).toMatchObject({
      summary: '封印裂缝开始渗出黑雾',
      status: 'planted',
      importance: 'high',
      plannedPayoff: '第三阶段回收',
      updatedIndex: 7,
    });
    expect(applied.revisions.hooks).toBe(3);
  });

  it('patch 不存在或已退役的条目整份拒绝', () => {
    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), delta_ACU({ hookPatches: [{ id: 'H9', summary: '改' }] }), ['hooks'], 7))
      .toThrowError(/patch 的伏笔不存在/);

    const withRetired = baseSnapshot_ACU();
    withRetired.hooks[0] = { ...withRetired.hooks[0], retired: true, retiredReason: '已回收' };
    expect(() => applyAgentModuleDelta_ACU(withRetired, delta_ACU({ hookPatches: [{ id: 'H1', summary: '改' }] }), ['hooks'], 7))
      .toThrowError(/已退役，不可 patch/);
  });

  it('信息差 patch 的合并结果必须满足揭示状态一致性', () => {
    const revealed = baseSnapshot_ACU();
    revealed.infoGap[0] = { ...revealed.infoGap[0], revealStatus: 'partial', revealIndex: 4 };
    expect(() => applyAgentModuleDelta_ACU(revealed, delta_ACU({ infoGapPatches: [{ id: 'E1', revealStatus: 'unrevealed' }] }), ['infoGap'], 7))
      .toThrowError(/揭示楼层必须同时清空/);

    const fixed = applyAgentModuleDelta_ACU(revealed, delta_ACU({ infoGapPatches: [{ id: 'E1', revealStatus: 'unrevealed', revealIndex: null }] }), ['infoGap'], 7);
    expect(fixed.infoGap[0]).toMatchObject({ revealStatus: 'unrevealed', revealIndex: null, topic: '守门人身份' });
  });

  it('空 delta 原样返回同一份快照，不产生无意义的版本递增', () => {
    const snapshot = baseSnapshot_ACU();
    expect(applyAgentModuleDelta_ACU(snapshot, delta_ACU(), ['hooks', 'infoGap'], 6)).toBe(snapshot);
  });
});

describe('Agent 年代学写集事务', () => {
  it('chronology 不在授权写集时整份拒绝', () => {
    const input = delta_ACU({ chronology: [chronologyItem_ACU()] });
    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), input, ['hooks', 'infoGap'], 6)).toThrowError(/未授权模块/);
  });

  it('声明的 chronology 版本号不匹配时拒绝整份写入', () => {
    const stale = delta_ACU({ expectedRevisions: { chronology: 4 }, chronology: [chronologyItem_ACU()] });
    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), stale, ['chronology'], 6)).toThrowError(/revision 已变化/);
  });

  it('合法 upsert 只给 chronology 升版本，并记录本次结算楼层', () => {
    const applied = applyAgentModuleDelta_ACU(baseSnapshot_ACU(), delta_ACU({ expectedRevisions: { chronology: 5 }, chronology: [chronologyItem_ACU()] }), ['chronology'], 6);

    expect(applied.chronology).toHaveLength(2);
    expect(applied.chronology.find(entry => entry.id === 'T2')).toMatchObject({ anchor: '入城后的第七天', evidenceIndexes: [4, 5], updatedIndex: 6, retired: false });
    expect(applied.revisions).toEqual({ hooks: 2, infoGap: 3, constraints: 1, storyArc: 4, chronology: 6 });
  });

  it('证据楼层去重升序，未来楼层或空证据拒绝且无部分提交', () => {
    const normalized = applyAgentModuleDelta_ACU(baseSnapshot_ACU(), delta_ACU({ chronology: [chronologyItem_ACU({ evidenceIndexes: [5, 4, 5] })] }), ['chronology'], 6);
    expect(normalized.chronology.find(entry => entry.id === 'T2')!.evidenceIndexes).toEqual([4, 5]);

    const snapshot = baseSnapshot_ACU();
    const future = delta_ACU({ chronology: [chronologyItem_ACU({ id: 'T2' }), chronologyItem_ACU({ id: 'T3', evidenceIndexes: [9] })] });
    expect(() => applyAgentModuleDelta_ACU(snapshot, future, ['chronology'], 6)).toThrowError(/未来楼层/);
    // 整份 delta 拒绝：前一条合法条目也不得落进快照。
    expect(snapshot.chronology).toHaveLength(1);

    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), delta_ACU({ chronology: [chronologyItem_ACU({ evidenceIndexes: [] })] }), ['chronology'], 6)).toThrowError(/非空的非负整数楼层数组/);
    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), delta_ACU({ chronology: [chronologyItem_ACU({ evidenceIndexes: [1.5] })] }), ['chronology'], 6)).toThrowError(/非空的非负整数楼层数组/);
  });

  it('upsert 的必填文本不能为空', () => {
    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), delta_ACU({ chronology: [chronologyItem_ACU({ anchor: ' ' })] }), ['chronology'], 6)).toThrowError(/anchor 不能为空/);
    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), delta_ACU({ chronology: [chronologyItem_ACU({ elapsed: '' })] }), ['chronology'], 6)).toThrowError(/elapsed 不能为空/);
    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), delta_ACU({ chronology: [chronologyItem_ACU({ transition: '' })] }), ['chronology'], 6)).toThrowError(/transition 不能为空/);
  });

  it('retire 必须命中既有条目并给出理由；合法 retire 保留条目可追溯', () => {
    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), delta_ACU({ chronology: [chronologyItem_ACU({ action: 'retire', id: 'T9', reason: '登记错误' })] }), ['chronology'], 6))
      .toThrowError(/retire 的年代学条目不存在/);
    expect(() => applyAgentModuleDelta_ACU(baseSnapshot_ACU(), delta_ACU({ chronology: [chronologyItem_ACU({ action: 'retire', id: 'T1', reason: '' })] }), ['chronology'], 6))
      .toThrowError(/必须给出理由/);

    const applied = applyAgentModuleDelta_ACU(baseSnapshot_ACU(), delta_ACU({ chronology: [chronologyItem_ACU({ action: 'retire', id: 'T1', reason: '证据楼层被删除，事实不再成立' })] }), ['chronology'], 6);
    expect(applied.chronology[0]).toMatchObject({ id: 'T1', retired: true, retiredReason: '证据楼层被删除，事实不再成立', updatedIndex: 6 });
    expect(applied.revisions.chronology).toBe(6);
  });
});

describe('Agent 长期约束登记（增量语义）', () => {
  it('add 只追加新增条目，漏写既有条目不等于删除', () => {
    const snapshot = baseSnapshot_ACU();
    const applied = applyAgentConstraintRegistration_ACU(snapshot, ['新增红线'], [], 6);

    expect(applied.constraints).toHaveLength(2);
    expect(applied.constraints[0]).toBe(snapshot.constraints[0]);
    expect(applied.constraints[1]).toMatchObject({ text: '新增红线', createdIndex: 6 });
    expect(applied.revisions.constraints).toBe(2);
  });

  it('重复登记既有文本幂等跳过（含旧全量形态重抄整份清单），无变更时原样返回', () => {
    const snapshot = baseSnapshot_ACU();
    expect(applyAgentConstraintRegistration_ACU(snapshot, ['不得提前揭穿幕后'], [], 6)).toBe(snapshot);
    expect(applyAgentConstraintRegistration_ACU(snapshot, [], [], 6)).toBe(snapshot);

    const mixed = applyAgentConstraintRegistration_ACU(snapshot, ['不得提前揭穿幕后', '主角不得使用禁咒', '主角不得使用禁咒'], [], 6);
    expect(mixed.constraints).toHaveLength(2);
    expect(mixed.constraints[1]).toMatchObject({ text: '主角不得使用禁咒', createdIndex: 6 });
    expect(mixed.revisions.constraints).toBe(2);
  });

  it('retire 按 id 或原文精确匹配移除，未命中即拒绝并回显活跃清单', () => {
    const snapshot = baseSnapshot_ACU();
    const removedByText = applyAgentConstraintRegistration_ACU(snapshot, [], ['不得提前揭穿幕后'], 6);
    expect(removedByText.constraints).toHaveLength(0);
    expect(removedByText.revisions.constraints).toBe(2);

    const removedById = applyAgentConstraintRegistration_ACU(snapshot, [], ['C01-1'], 6);
    expect(removedById.constraints).toHaveLength(0);

    expect(() => applyAgentConstraintRegistration_ACU(snapshot, [], ['不存在的约束'], 6))
      .toThrowError(/retire 的约束不存在.*C01-1：不得提前揭穿幕后/);
  });
});
