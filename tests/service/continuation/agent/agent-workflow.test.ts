import { describe, expect, it } from 'vitest';

import { buildEmptyAgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-module-store';
import type { AgentFinalReviewerOutput_ACU, AgentModuleDelta_ACU, AgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-model';
import {
  continuationBeatObligation_ACU,
  continuationContinuityReviewRequired_ACU,
  continuationMajorTurn_ACU,
  runContinuationAgentWorkflow_ACU,
  runContinuationMaterialRepair_ACU,
  type ContinuationWorkflowAgentCall_ACU,
  type ContinuationWorkflowAgentPayload_ACU,
  type ContinuationWorkflowInput_ACU,
} from '../../../../src/service/continuation/agent/agent-workflow';
import { buildDefaultContinuationSettings_ACU } from '../../../../src/service/continuation/defaults';
import { ContinuationValidationError_ACU, createContinuationError_ACU } from '../../../../src/service/continuation/model';

function snapshot_ACU(patch: Partial<AgentModuleSnapshot_ACU> = {}): AgentModuleSnapshot_ACU {
  return { ...buildEmptyAgentModuleSnapshot_ACU(), settledThroughIndex: 4, ...patch };
}

function delta_ACU(patch: Partial<AgentModuleDelta_ACU> = {}): AgentModuleDelta_ACU {
  return { expectedRevisions: {}, hooks: [], hookPatches: [], infoGap: [], infoGapPatches: [], storyArc: [], storyArcPatches: [], chronology: [], constraintProposals: [], ...patch };
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
    majorTurn: false,
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
          readRevisions: snapshot_ACU().revisions,
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
    expect(continuationMajorTurn_ACU({ pacing: 'turn' })).toBe(true);
    expect(continuationContinuityReviewRequired_ACU({ majorTurn: false, recommendations: ['两套方案互相冲突'], risks: [] })).toBe(true);
    expect(continuationContinuityReviewRequired_ACU({ majorTurn: false, recommendations: ['安静地问一句'], risks: [] })).toBe(false);
  });

  it('无伏笔义务且无冲突时跳过 beat 与审查，开局焦点进入结算与 composer', async () => {
    const harness = harness_ACU();
    const result = await harness.run();
    expect(result.outcome).toBe('deliver');
    expect(result.instruction).toBe('从守门人的回避写起');
    expect(harness.calls.map(call => call.agentName)).toEqual(['hook-cognition-maintainer', 'mainline-planner']);
    expect(result.steps.map(step => `${step.agentName}:${step.status}`)).toEqual([
      'hook-cognition-maintainer:ok',
      'beat-planner:skipped',
      'mainline-planner:ok',
      'continuity-reviewer:skipped',
      'instruction-composer:ok',
    ]);
    expect(harness.calls[0].prompt).toContain('守门人的回避');
    expect(harness.composerPrompts[0]).toContain('守门人的回避');
    expect(result.snapshot.revisions.hooks).toBe(1);
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

  it('伏笔义务与大转折会派 beat-planner 和 continuity-reviewer', async () => {
    const harness = harness_ACU({ beatObligation: true, majorTurn: true });
    await harness.run();
    expect(harness.calls.map(call => call.agentName)).toEqual([
      'hook-cognition-maintainer',
      'mainline-planner',
      'beat-planner',
      'continuity-reviewer',
    ]);
  });

  it('自动修复关闭时不派修复，并升级主会话', async () => {
    const settings = buildDefaultContinuationSettings_ACU();
    settings.workflow.autoFixEnabled = false;
    const calls: ContinuationWorkflowAgentCall_ACU[] = [];
    const harness = harness_ACU({
      settings,
      hasUnsettledHistory: false,
      snapshot: snapshot_ACU({
        pendingFixes: [{ module: 'hooks', agentName: 'hook-cognition-maintainer', violations: [{ path: 'hooks', message: 'title 不能为空' }], attempts: 1, firstFailedAtIndex: 4, lastError: 'title 不能为空' }],
      }),
      runAgent: async call => {
        calls.push(call);
        return { ok: true, summary: 'no_change', noChange: true, planner: { summary: '建议', recommendation: '安静地问一句', mustPreserve: [], risks: [] } };
      },
    });
    const result = await harness.run();
    expect(result.outcome).toBe('escalate');
    expect(result.escalationKind).toBe('pending_fix');
    expect(calls.some(call => call.billing === 'repair')).toBe(false);
  });

  it('修复成功后清除 pendingFix；已达 3 次则不再派修复并升级', async () => {
    const broken = snapshot_ACU({
      pendingFixes: [{ module: 'hooks', agentName: 'hook-cognition-maintainer', violations: [{ path: 'hooks', message: 'title 不能为空' }], attempts: 1, firstFailedAtIndex: 4, lastError: 'title 不能为空' }],
    });
    const repairCalls: ContinuationWorkflowAgentCall_ACU[] = [];
    const repaired = harness_ACU({
      hasUnsettledHistory: false,
      snapshot: broken,
      runAgent: async call => {
        repairCalls.push(call);
        if (call.repair) {
          return {
            ok: true,
            summary: '已修复',
            maintainer: {
              summary: '已修复',
              delta: delta_ACU({ hooks: [{ action: 'upsert', id: 'H1', summary: '断裂的封印', status: 'planted', importance: 'mid', plantedIndex: 2, plannedPayoff: '后文回收', reason: '' }] }),
            },
            writes: ['hooks'],
            readRevisions: broken.revisions,
          };
        }
        return { ok: true, summary: 'no_change', noChange: true, planner: { summary: '建议', recommendation: '安静地问一句', mustPreserve: [], risks: [] } };
      },
    });
    const repairedResult = await repaired.run();
    expect(repairCalls.some(call => call.billing === 'repair' && call.agentName === 'hook-cognition-maintainer')).toBe(true);
    expect(repairedResult.outcome).toBe('deliver');
    expect(repairedResult.pendingFixes).toEqual([]);

    const exhausted = snapshot_ACU({
      pendingFixes: [{ ...broken.pendingFixes[0], attempts: 3 }],
    });
    const blocked = harness_ACU({ hasUnsettledHistory: false, snapshot: exhausted });
    const blockedResult = await blocked.run();
    expect(blocked.calls.some(call => call.billing === 'repair')).toBe(false);
    expect(blockedResult.outcome).toBe('escalate');
    expect(blockedResult.escalationKind).toBe('pending_fix');
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

  it('显式补足只提交目标模块并保留其他 pending 与结算水位', async () => {
    const base = snapshot_ACU({
      pendingFixes: [
        { module: 'hooks', agentName: 'hook-cognition-maintainer', violations: [{ path: 'hooks', message: '伏笔截断' }], attempts: 1, firstFailedAtIndex: 3, lastError: '伏笔截断' },
        { module: 'chronology', agentName: 'hook-cognition-maintainer', violations: [{ path: 'chronology', message: '年代学截断' }], attempts: 1, firstFailedAtIndex: 3, lastError: '年代学截断' },
      ],
      materialCompletion: {
        state: 'partial', rangeStartIndex: 3, rangeEndIndex: 4,
        modules: { hooks: 'failed', chronology: 'failed', storyArc: 'complete_no_change' }, updatedAt: 1,
      },
    });
    const calls: ContinuationWorkflowAgentCall_ACU[] = [];
    const result = await runContinuationMaterialRepair_ACU({
      snapshot: base,
      targetModules: ['hooks'],
      settledIndex: 8,
      completedStageNumbers: [],
      runAgent: async call => {
        calls.push(call);
        return {
          ok: true,
          summary: '只补伏笔',
          maintainer: {
            summary: '只补伏笔',
            delta: delta_ACU({
              hooks: [{ action: 'upsert', id: 'H1', summary: '断裂的封印', status: 'planted', importance: 'mid', plantedIndex: 2, plannedPayoff: '后文回收', reason: '' }],
              storyArc: [{
                action: 'upsert', id: 'ARC-OUT-OF-SCOPE', scope: 'volume', title: '越权总纲', direction: '不得写入',
                escalation: '', withheld: '', status: 'planned', stageNumbers: [], completionStageNumber: null,
                completionState: '', continuationRationale: '', reason: '',
              }],
            }),
          },
          writes: ['hooks', 'storyArc'],
          readRevisions: base.revisions,
          completion: 'complete_changed',
          moduleCompletion: { hooks: 'complete_changed', storyArc: 'complete_changed' },
          acceptedKeys: ['hooks:H1'],
        };
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ agentName: 'hook-cognition-maintainer', repair: true, targetModules: ['hooks'] });
    expect(result.snapshot.hooks.map(item => item.id)).toContain('H1');
    expect(result.snapshot.storyArc).toEqual(base.storyArc);
    expect(result.snapshot.revisions.storyArc).toBe(base.revisions.storyArc);
    expect(result.snapshot.pendingFixes.map(item => item.module)).toEqual(['chronology']);
    expect(result.snapshot.settledThroughIndex).toBe(4);
    expect(result.repairedModules).toEqual(['hooks']);
    expect(result.failedModules).toEqual([]);
  });

  it('子代理声称 changed 但没有候选写入时不清除 pending', async () => {
    const base = snapshot_ACU({
      pendingFixes: [{ module: 'hooks', agentName: 'hook-cognition-maintainer', violations: [{ path: 'hooks', message: '仍缺正文依据' }], attempts: 1, firstFailedAtIndex: 4, lastError: '仍缺正文依据' }],
      materialCompletion: { state: 'failed', rangeStartIndex: 4, rangeEndIndex: 4, modules: { hooks: 'failed' }, updatedAt: 1 },
    });
    const result = await runContinuationMaterialRepair_ACU({
      snapshot: base,
      targetModules: ['hooks'],
      settledIndex: 4,
      completedStageNumbers: [],
      runAgent: async () => ({ ok: true, summary: '声称已改', completion: 'complete_changed', moduleCompletion: { hooks: 'complete_changed' } }),
    });

    expect(result.snapshot.pendingFixes.map(item => item.module)).toEqual(['hooks']);
    expect(result.snapshot.materialCompletion.modules.hooks).toBe('failed');
    expect(result.repairedModules).toEqual([]);
    expect(result.failedModules).toEqual(['hooks']);
  });
});
