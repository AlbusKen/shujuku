import { describe, expect, it } from 'vitest';

import { buildEmptyAgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-module-store';
import type { AgentFinalReviewerOutput_ACU, AgentModuleDelta_ACU, AgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-model';
import {
  continuationBeatObligation_ACU,
  runContinuationAgentWorkflow_ACU,
  type ContinuationWorkflowAgentCall_ACU,
  type ContinuationWorkflowAgentPayload_ACU,
  type ContinuationWorkflowInput_ACU,
} from '../../../../src/service/continuation/agent/agent-workflow';
import { buildDefaultContinuationSettings_ACU } from '../../../../src/service/continuation/defaults';
import { AGENT_OPERATION_ONLY_PENDING_MESSAGE_ACU } from '../../../../src/service/continuation/agent/agent-module-field-commit';
import { ContinuationValidationError_ACU, createContinuationError_ACU } from '../../../../src/service/continuation/model';

function snapshot_ACU(patch: Partial<AgentModuleSnapshot_ACU> = {}): AgentModuleSnapshot_ACU {
  return { ...buildEmptyAgentModuleSnapshot_ACU(), settledThroughIndex: 4, ...patch };
}

function delta_ACU(patch: Partial<AgentModuleDelta_ACU> = {}): AgentModuleDelta_ACU {
  return { expectedRevisions: {}, hooks: [], hookPatches: [], infoGap: [], infoGapPatches: [], storyArc: [], storyArcPatches: [], chronology: [], chronologyPatches: [], constraintProposals: [], ...patch };
}

function review_ACU(verdict: AgentFinalReviewerOutput_ACU['verdict'], requiredFixes: string[] = []): AgentFinalReviewerOutput_ACU {
  return { verdict, summary: verdict, emotionFindings: [], worldFindings: [], logicFindings: [], requiredFixes, preserve: [] };
}

function harness_ACU(patch: Partial<ContinuationWorkflowInput_ACU> = {}) {
  const calls: ContinuationWorkflowAgentCall_ACU[] = [];
  const composerPrompts: string[] = [];
  const reviews: AgentFinalReviewerOutput_ACU[] = [];
  const input: ContinuationWorkflowInput_ACU = {
    settings: buildDefaultContinuationSettings_ACU(),
    snapshot: snapshot_ACU(),
    opening: { focus: '守门人的回避', summary: '试探', dispatchWebResearcher: false },
    hasUnsettledHistory: true,
    beatObligation: false,
    turnNumber: 1,
    settledIndex: 6,
    completedStageNumbers: [],
    runAgent: async call => {
      calls.push(call);
      if (call.agentName === 'hook-cognition-maintainer') {
        return {
          ok: true,
          summary: '结算完成',
          maintainer: {
            summary: '结算完成',
            delta: delta_ACU({ hooks: [{ action: 'upsert', id: 'H1', summary: '断裂的封印', status: 'planted', importance: 'mid', plantedIndex: 2, plannedPayoff: '后文回收', reason: '' }] }),
          },
          writes: ['hooks'],
          readRevisions: input.snapshot.revisions,
        } satisfies ContinuationWorkflowAgentPayload_ACU;
      }
      return {
        ok: true,
        summary: call.agentName,
        planner: { summary: '建议', recommendation: '安静地问一句', mustPreserve: [], risks: [] },
        reviewer: { verdict: 'pass', reason: '无冲突', fixes: [] },
      };
    },
    runComposer: async call => {
      composerPrompts.push(call.prompt + call.revisionFeedback);
      return { instruction: '从守门人的回避写起', summary: '试探', constraints: null };
    },
    runFinalReview: async () => review_ACU('pass'),
    ...patch,
  };
  return { input, calls, composerPrompts, reviews, run: () => runContinuationAgentWorkflow_ACU(input) };
}

describe('续写固定工作流', () => {
  it('伏笔义务与大转折由程序判定', () => {
    expect(continuationBeatObligation_ACU({ function: 'payoff', goal: '喝茶' })).toBe(true);
    expect(continuationBeatObligation_ACU({ goal: '回收旧伏笔' })).toBe(true);
    expect(continuationBeatObligation_ACU({ function: 'daily_bond', goal: '喝茶' })).toBe(false);
  });

  it('首轮无伏笔义务时跳过 beat，开局焦点进入结算与 composer', async () => {
    const harness = harness_ACU();
    const result = await harness.run();
    expect(result.outcome).toBe('deliver');
    expect(result.instruction).toBe('从守门人的回避写起');
    expect(harness.calls.map(call => call.agentName)).toEqual(['hook-cognition-maintainer', 'mainline-planner']);
    expect(result.steps.map(step => `${step.agentName}:${step.status}`)).toEqual([
      'hook-cognition-maintainer:ok',
      'beat-planner:skipped',
      'mainline-planner:ok',
      'instruction-composer:ok',
    ]);
    expect(harness.calls[0].prompt).toContain('守门人的回避');
    expect(harness.calls[0].prompt).toContain('不调用 write_sql');
    expect(harness.calls[0].prompt).not.toContain('delta 留空');
    expect(harness.composerPrompts[0]).toContain('守门人的回避');
    expect(result.snapshot.revisions.hooks).toBe(1);
    const windowed = harness_ACU({
      snapshot: snapshot_ACU({ settledThroughIndex: -1 }),
      settledIndex: 999,
      settlementStartIndex: 997,
      canAdvanceSettlement: false,
    });
    const windowedResult = await windowed.run();
    expect(windowedResult.outcome).toBe('deliver');
    expect(windowedResult.snapshot.settledThroughIndex).toBe(-1);
    expect(windowedResult.snapshot.materialCompletion).toMatchObject({
      state: 'complete_changed', rangeStartIndex: 997, rangeEndIndex: 999,
    });
    const resumed = harness_ACU({
      snapshot: windowedResult.snapshot,
      settledIndex: 1001,
      settlementStartIndex: 1000,
      canAdvanceSettlement: false,
    });
    const resumedResult = await resumed.run();
    expect(resumedResult.snapshot.settledThroughIndex).toBe(-1);
    expect(resumedResult.snapshot.materialCompletion).toMatchObject({ rangeStartIndex: 997, rangeEndIndex: 1001 });
    const afterGap = harness_ACU({
      snapshot: resumedResult.snapshot,
      settledIndex: 1009,
      settlementStartIndex: 1007,
      canAdvanceSettlement: false,
    });
    const afterGapResult = await afterGap.run();
    expect(afterGapResult.outcome).toBe('deliver');
    expect(afterGapResult.snapshot.settledThroughIndex).toBe(-1);
    expect(afterGapResult.snapshot.materialCompletion).toMatchObject({ rangeStartIndex: 1007, rangeEndIndex: 1009 });
  });

  it('部分契约保留合法资料、挂账缺失模块且不推进结算水位', async () => {
    const base = snapshot_ACU();
    const harness = harness_ACU({
      snapshot: base,
      runAgent: async call => {
        if (call.agentName === 'hook-cognition-maintainer') {
          return {
            ok: true,
            summary: '伏笔已结算，年代学尾部截断',
            maintainer: {
              summary: '伏笔已结算，年代学尾部截断',
              delta: delta_ACU({ hooks: [{ action: 'upsert', id: 'H1', summary: '断裂的封印', status: 'planted', importance: 'mid', plantedIndex: 2, plannedPayoff: '后文回收', reason: '' }] }),
            },
            writes: ['hooks', 'infoGap', 'chronology'],
            readRevisions: base.revisions,
            completion: 'partial',
            moduleCompletion: { hooks: 'complete_changed', infoGap: 'complete_no_change', chronology: 'failed' },
            unresolvedIssues: [{ module: 'chronology', source: 'truncated', path: 'chronology', message: '年代学尾部尚未确认完整' }],
            acceptedKeys: ['hooks:H1'],
          };
        }
        return {
          ok: true,
          summary: call.agentName,
          planner: { summary: '建议', recommendation: '安静地问一句', mustPreserve: [], risks: [] },
          reviewer: { verdict: 'pass', reason: '无冲突', fixes: [] },
        };
      },
    });

    const result = await harness.run();
    expect(result.snapshot.hooks.map(item => item.id)).toContain('H1');
    expect(result.snapshot.settledThroughIndex).toBe(4);
    expect(result.snapshot.materialCompletion).toMatchObject({
      state: 'partial', rangeStartIndex: 5, rangeEndIndex: 6,
      modules: { hooks: 'complete_changed', infoGap: 'complete_no_change', chronology: 'failed' },
    });
    expect(result.pendingFixes).toEqual([expect.objectContaining({
      module: 'chronology', source: 'truncated', completion: 'failed', rangeStartIndex: 5, rangeEndIndex: 6,
    })]);
  });

  it('没有未结算正文时 maintainer 短路，不调用模型', async () => {
    const harness = harness_ACU({ hasUnsettledHistory: false });
    const result = await harness.run();
    expect(result.steps[0]).toMatchObject({ agentName: 'hook-cognition-maintainer', status: 'no_change' });
    expect(harness.calls.map(call => call.agentName)).toEqual(['mainline-planner']);
  });

  it('第二轮起即使没有伏笔义务也会保底派 beat-planner', async () => {
    const harness = harness_ACU({ beatObligation: false, turnNumber: 2 });
    await harness.run();
    expect(harness.calls.map(call => call.agentName)).toEqual([
      'hook-cognition-maintainer',
      'mainline-planner',
      'beat-planner',
    ]);
  });

  it('旧 pending 在正常结算内补齐，失败不额外派修复且直报主会话', async () => {
    const broken = snapshot_ACU({
      pendingFixes: [{ module: 'hooks', agentName: 'hook-cognition-maintainer', violations: [{ path: 'hooks#H1.status', message: '缺栏' }], attempts: 3, firstFailedAtIndex: 4, lastError: '缺栏' }],
    });
    const calls: ContinuationWorkflowAgentCall_ACU[] = [];
    const repaired = harness_ACU({
      hasUnsettledHistory: false,
      snapshot: broken,
      runAgent: async call => {
        calls.push(call);
        if (call.agentName === 'hook-cognition-maintainer') {
          return { ok: true, summary: '补齐伏笔', maintainer: { summary: '补齐伏笔', delta: delta_ACU({ hooks: [{ action: 'upsert', id: 'H1', summary: '断裂的封印', status: 'planted', importance: 'mid', plantedIndex: 2, plannedPayoff: '后文回收', reason: '' }] }) }, writes: ['hooks'], readRevisions: broken.revisions };
        }
        return { ok: true, summary: '建议', planner: { summary: '建议', recommendation: '安静地问一句', mustPreserve: [], risks: [] } };
      },
    });
    const repairedResult = await repaired.run();
    expect(calls.filter(call => call.agentName === 'hook-cognition-maintainer')).toHaveLength(1);
    expect(calls.every(call => call.billing !== 'repair')).toBe(true);
    expect(repairedResult.outcome).toBe('deliver');
    expect(repairedResult.pendingFixes).toEqual([]);

    const failedCalls: ContinuationWorkflowAgentCall_ACU[] = [];
    const failed = harness_ACU({
      hasUnsettledHistory: false,
      snapshot: broken,
      runAgent: async call => {
        failedCalls.push(call);
        if (call.agentName === 'hook-cognition-maintainer') return { ok: false, summary: '仍缺栏', writes: ['hooks'], unresolvedIssues: [{ module: 'hooks', source: 'missing_field', path: 'hooks#H1.status', message: '缺栏' }] };
        return { ok: true, summary: '建议', planner: { summary: '建议', recommendation: '安静地问一句', mustPreserve: [], risks: [] } };
      },
    });
    const failedResult = await failed.run();
    const failedMaintainerCalls = failedCalls.filter(call => call.agentName === 'hook-cognition-maintainer');
    expect(failedMaintainerCalls).toHaveLength(4);
    expect(failedMaintainerCalls.slice(1).every(call => call.targetModules)).toBe(true);
    expect(failedMaintainerCalls.slice(1).every(call => call.targetModules?.includes('hooks'))).toBe(true);
    expect(failedMaintainerCalls[1].prompt).toContain('hooks#H1.status: 缺栏');
    expect(failedCalls.every(call => call.billing !== 'repair')).toBe(true);
    expect(failedResult).toMatchObject({ outcome: 'escalate', escalationKind: 'pending_fix' });
    expect(failedResult.pendingFixes[0].violations).toContainEqual({ path: 'hooks#H1.status', message: '缺栏', source: 'missing_field' });
    expect(failedMaintainerCalls[1].prompt).toContain('额度已用尽时不重复 read');
    expect(failedCalls).toEqual(failedMaintainerCalls);
    expect(failed.composerPrompts).toEqual([]);
  });

  it('策划完整交接进入初次编排和终审修订，失败策划不作为建议', async () => {
    const settings = buildDefaultContinuationSettings_ACU();
    settings.finalReview.enabled = true;
    const verdicts = ['revise', 'pass'] as const;
    let count = 0;
    const h = harness_ACU({ settings, hasUnsettledHistory: false, turnNumber: 2,
      runAgent: async call => ({ ok: call.agentName !== 'beat-planner', summary: '节拍不可用',
        planner: call.agentName === 'mainline-planner'
          ? { summary: '主线独有摘要', recommendation: '主线独有建议', mustPreserve: ['角色尚不知密信'], risks: ['避免提前揭示'] }
          : { summary: '失败摘要', recommendation: '不能采纳的建议', mustPreserve: [], risks: [] } }),
      runFinalReview: async () => ({ ...review_ACU(verdicts[count++] ?? 'pass', ['补上时间锚']), preserve: ['保留安静收尾'] }),
    });
    expect((await h.run()).outcome).toBe('deliver');
    expect(h.composerPrompts).toHaveLength(2);
    for (const prompt of h.composerPrompts) {
      for (const text of ['mainline-planner', 'beat-planner', '主线独有摘要', '主线独有建议', '角色尚不知密信', '避免提前揭示', '节拍不可用']) expect(prompt).toContain(text);
      expect(prompt).toContain('"status":"failed"');
      expect(prompt).not.toContain('不能采纳的建议');
    }
    expect(h.composerPrompts[1]).toContain('保留安静收尾');
  });

  it('无变化仅清同一条目同版本的操作问题，真实缺栏和窗口外问题保留', async () => {
    for (const scenario of ['same', 'other-id', 'stale', 'missing', 'outside', 'no-proof'] as const) {
      const fix = { module: 'hooks' as const, agentName: 'hook-cognition-maintainer', source: 'transaction_rejected' as const,
        completion: 'failed' as const, attempts: 1, firstFailedAtIndex: 5, lastError: AGENT_OPERATION_ONLY_PENDING_MESSAGE_ACU,
        rangeStartIndex: scenario === 'outside' ? 1 : 5, rangeEndIndex: scenario === 'outside' ? 2 : 6,
        violations: [{ path: 'hooks#H1.operationOnly', message: AGENT_OPERATION_ONLY_PENDING_MESSAGE_ACU },
          ...(scenario === 'missing' ? [{ path: 'hooks#H1.status', message: '缺栏' }] : [])] };
      const base = snapshot_ACU({ pendingFixes: [fix] });
      const h = harness_ACU({ snapshot: base, settlementStartIndex: 5, hasUnsettledHistory: true,
        runAgent: async call => call.agentName === 'hook-cognition-maintainer'
          ? { ok: true, summary: '逐项核对无业务变化', writes: ['hooks'], completion: 'complete_no_change',
            moduleCompletion: { hooks: 'complete_no_change' },
            operationOnlyConfirmed: scenario === 'no-proof' ? undefined : [{ module: 'hooks', id: scenario === 'other-id' ? 'H2' : 'H1',
              revision: scenario === 'stale' ? 1 : 0, rejectedPaths: [] }] }
          : { ok: true, summary: '建议', planner: { summary: '建议', recommendation: '安静交谈', mustPreserve: [], risks: [] } },
      });
      const result = await h.run();
      if (scenario === 'same') {
        expect(result.outcome).toBe('deliver');
        expect(result.pendingFixes).toEqual([]);
        expect(result.snapshot.revisions.hooks).toBe(0);
      } else {
        expect(result.outcome).toBe('escalate');
        expect(result.pendingFixes).not.toEqual([]);
        if (scenario === 'missing') expect(result.pendingFixes[0].violations).toEqual([{ path: 'hooks#H1.status', message: '缺栏' }]);
        else expect(result.pendingFixes[0].violations).toContainEqual(fix.violations[0]);
        expect(result.snapshot.settledThroughIndex).toBe(4);
      }
    }
  });

  it('逐栏成功只清同字段旧拒绝，保留历史诊断、版本冲突和窗口外缺口', async () => {
    for (const scenario of ['same', 'other-field', 'stale', 'outside', 'legacy', 'new-issue'] as const) {
      const fix = { module: 'hooks' as const, agentName: 'hook-cognition-maintainer', source: 'transaction_rejected' as const,
        completion: 'failed' as const, attempts: 1, firstFailedAtIndex: 5, lastError: '旧字段拒绝',
        rangeStartIndex: scenario === 'outside' ? 1 : 5, rangeEndIndex: scenario === 'outside' ? 2 : 6,
        violations: [{ path: 'hooks#H1.summary', message: '旧字段拒绝' },
          ...(scenario === 'legacy' ? [{ path: 'sql[0].hooks', message: '旧诊断无条目身份' }] : [])] };
      const base = snapshot_ACU({ pendingFixes: [fix] });
      const settings = buildDefaultContinuationSettings_ACU(); settings.workflow.reviseLimit = 0;
      const h = harness_ACU({ settings, snapshot: base, settlementStartIndex: 5, hasUnsettledHistory: true,
        runAgent: async call => call.agentName === 'hook-cognition-maintainer'
          ? { ok: scenario !== 'new-issue', summary: '业务字段已确认', usedFieldWrites: true, writes: ['hooks'],
            completion: scenario === 'new-issue' ? 'failed' : 'complete_changed', acceptedKeys: ['hooks:H1:summary'],
            moduleCompletion: { hooks: scenario === 'new-issue' ? 'failed' : 'complete_changed' },
            fieldConfirmation: { keys: [scenario === 'other-field' ? 'hooks:H1:status' : 'hooks:H1:summary'],
              revisions: { ...base.revisions, hooks: scenario === 'stale' ? 1 : 0 } },
            unresolvedIssues: scenario === 'new-issue' ? [{ module: 'hooks', source: 'transaction_rejected', path: 'hooks#H1.status', message: '新缺栏' }] : [] }
          : { ok: true, summary: '建议', planner: { summary: '建议', recommendation: '安静交谈', mustPreserve: [], risks: [] } },
      });
      const result = await h.run();
      if (scenario === 'same') {
        expect(result.outcome).toBe('deliver'); expect(result.pendingFixes).toEqual([]);
      } else {
        expect(result.outcome).toBe('escalate'); expect(result.snapshot.settledThroughIndex).toBe(4);
        if (scenario === 'legacy') expect(result.pendingFixes[0].violations).toEqual([fix.violations[1]]);
        else if (scenario === 'new-issue') expect(result.pendingFixes[0].violations).toEqual([{ path: 'hooks#H1.status', message: '新缺栏', source: 'transaction_rejected' }]);
        else expect(result.pendingFixes[0].violations).toEqual(fix.violations);
      }
    }
    const seed = snapshot_ACU({ pendingFixes: [{ module: 'hooks', agentName: 'hook-cognition-maintainer',
      source: 'transaction_rejected', completion: 'failed', attempts: 1, firstFailedAtIndex: 5,
      lastError: '旧字段拒绝', rangeStartIndex: 5, rangeEndIndex: 6, acceptedKeys: [], createdAt: 1, updatedAt: 1,
      violations: [{ path: 'hooks#H1.summary', message: '旧字段拒绝', source: 'transaction_rejected' }] }] });
    let committed = seed;
    const repairCalls: ContinuationWorkflowAgentCall_ACU[] = [];
    const settings = buildDefaultContinuationSettings_ACU(); settings.workflow.reviseLimit = 2;
    const h = harness_ACU({ settings, snapshot: seed, settlementStartIndex: 5,
      readCommittedSnapshot: () => committed,
      runAgent: async call => {
        if (call.agentName !== 'hook-cognition-maintainer') return { ok: true, summary: '建议' };
        repairCalls.push(call);
        if (repairCalls.length === 1) return { ok: false, summary: '新状态拒绝', writes: ['hooks'],
          unresolvedIssues: [{ module: 'hooks', source: 'contract_rejected', id: 'H1',
            path: 'hooks#H1.status', message: '新状态拒绝', revision: 0 }] };
        if (repairCalls.length === 2) {
          // 回读含新拒绝，同时仍带着尚未持久化清偿的旧 summary 拒绝。
          committed = { ...committed, pendingFixes: [{ ...seed.pendingFixes[0],
            violations: [...seed.pendingFixes[0].violations,
              { path: 'hooks#H2.importance', message: '其他条目新拒绝', source: 'transaction_rejected' }] }] };
        }
        return { ok: true, summary: 'summary 已确认', writes: ['hooks'], usedFieldWrites: true,
          completion: 'complete_changed', moduleCompletion: { hooks: 'complete_changed' },
          acceptedKeys: ['hooks:H1:summary'],
          fieldConfirmation: { keys: ['hooks:H1:summary'], revisions: committed.revisions }, unresolvedIssues: [] };
      } });
    const result = await h.run();
    expect(repairCalls).toHaveLength(3);
    expect(repairCalls[1].pendingFixes?.[0].violations).toContainEqual(expect.objectContaining({
      path: 'hooks#H1.status', id: 'H1', source: 'contract_rejected', revision: 0,
    }));
    expect(result.outcome).toBe('escalate');
    expect(result.snapshot.settledThroughIndex).toBe(4);
    expect(result.pendingFixes[0].violations).toEqual([
      { path: 'hooks#H1.status', message: '新状态拒绝', id: 'H1', source: 'contract_rejected', revision: 0 },
      { path: 'hooks#H2.importance', message: '其他条目新拒绝', source: 'transaction_rejected' },
    ]);

  });


  it('终审 pass 直接交付；revise 打回后修订交付；连续 3 次失败升级', async () => {
    const settings = buildDefaultContinuationSettings_ACU();
    settings.finalReview.enabled = true;
    settings.workflow.reviseLimit = 3;
    const verdicts: AgentFinalReviewerOutput_ACU['verdict'][] = ['revise', 'pass'];
    const revised = harness_ACU({
      settings,
      hasUnsettledHistory: false,
      runFinalReview: async () => review_ACU(verdicts.shift() ?? 'pass', ['补上时间锚']),
    });
    const revisedResult = await revised.run();
    expect(revisedResult.outcome).toBe('deliver');
    expect(revised.composerPrompts.some(prompt => prompt.includes('补上时间锚'))).toBe(true);

    let reviewCount = 0;
    const failed = harness_ACU({
      settings,
      hasUnsettledHistory: false,
      runFinalReview: async () => {
        reviewCount += 1;
        return review_ACU('block', ['硬冲突']);
      },
    });
    const failedResult = await failed.run();
    expect(reviewCount).toBe(3);
    expect(failedResult.outcome).toBe('escalate');
    expect(failedResult.escalationKind).toBe('final_review');
    expect(failedResult.instruction).toBe('');
  });

  it('终审请求失效时原样重抛，空 instruction 升级', async () => {
    const settings = buildDefaultContinuationSettings_ACU();
    settings.finalReview.enabled = true;
    const stale = harness_ACU({
      settings,
      hasUnsettledHistory: false,
      runFinalReview: async () => {
        throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'agent_delegate', '请求已失效', false));
      },
    });
    await expect(stale.run()).rejects.toMatchObject({ error: { code: 'CONTINUATION_INTERNAL_REQUEST_STALE' } });

    const empty = harness_ACU({
      hasUnsettledHistory: false,
      runComposer: async () => ({ instruction: '  ', summary: '空', constraints: null }),
    });
    const emptyResult = await empty.run();
    expect(emptyResult.outcome).toBe('escalate');
    expect(emptyResult.instruction).toBe('');
  });

});
