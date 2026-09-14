import { describe, expect, it, vi } from 'vitest';

import { StageExecutionEngine_ACU, currentAgentContext_ACU } from '../../../src/service/continuation/stage-execution-engine';
import { buildDefaultContinuationSettings_ACU } from '../../../src/service/continuation/defaults';

function envelope(patch: { stageStatus?: 'running' | 'completed'; withStage?: boolean } = {}) {
  const withStage = patch.withStage !== false;
  return {
    schemaVersion: 1 as const,
    settings: buildDefaultContinuationSettings_ACU(),
    activeTask: {
      taskId: 'task-a', originInstruction: '推进剧情', status: 'running' as const, createdAt: 1, updatedAt: 1,
      runStartedAt: 1, deadlineAt: null, runStageCount: withStage ? 1 : 0, activeStageId: withStage ? 'stage-a' : null, stopReason: null, lastError: null, timeline: [],
      stages: withStage ? [{
        stageId: 'stage-a', stageNumber: 1, status: (patch.stageStatus ?? 'running') as any, chronicleStartCount: 0, chronicleEndCount: null, chronicleAddedCount: null, chronicleRange: null,
        activeRevision: 1, activeNodeIndex: 0, activeTurnIndex: 0, completedTurns: patch.stageStatus === 'completed' ? 6 : 0,
        revisions: [{ revision: 1, createdAt: 1, reason: 'initial' as const, replanInstruction: '', frozen: true, outline: { schemaVersion: 1 as const, title: '阶段', goal: '目标', totalTurns: 6, nodes: [{ id: 'node-a', title: '节点', goal: '节点目标', suggestedTurns: 6, turns: Array.from({ length: 6 }, (_, index) => ({ id: `turn-${index + 1}`, goal: `轮次 ${index + 1}` })) }] } }],
      }] : [],
    },
  };
}

describe('宽松执行上下文', () => {
  it('无阶段时任务照常进入上下文，游标字段为 null', () => {
    const context = currentAgentContext_ACU(envelope({ withStage: false }) as any);
    expect(context.task.taskId).toBe('task-a');
    expect(context.stage).toBeNull();
    expect(context.turn).toBeNull();
  });

  it('阶段已完成时保留 stage 但游标为 null', () => {
    const context = currentAgentContext_ACU(envelope({ stageStatus: 'completed' }) as any);
    expect(context.stage?.status).toBe('completed');
    expect(context.turn).toBeNull();
  });

  it('游标完整时给出轮次序号', () => {
    const context = currentAgentContext_ACU(envelope() as any);
    expect(context.turn?.goal).toBe('轮次 1');
    expect(context.turnNumber).toBe(1);
  });
});

describe('StageExecutionEngine_ACU', () => {
  it('binds every internal retry to one durable turn attempt identity minted after the loop', async () => {
    const identities: any[] = [];
    const planner = { plan: vi.fn(async (request: any) => {
      const first = request.createInternalRequestIdentity(0);
      const retry = request.createInternalRequestIdentity(1);
      identities.push(first, retry);
      expect(request.isInternalRequestCurrent(first)).toBe(true);
      expect(request.isInternalRequestCurrent(retry)).toBe(true);
      expect(request.readContext().turn.goal).toBe('轮次 1');
      return { instruction: '最终文本', attempts: 2, apiPreset: { presetName: 'preset-a', source: 'fixed', reason: 'fixed_preset' } };
    }) };
    const engine = new StageExecutionEngine_ACU({
      readEnvelope: envelope as any, getChatIdentity: () => 'chat-a', allocateId: prefix => prefix === 'attempt' ? 'attempt-a' : 'request-a',
      planner: planner as any,
    });

    const prepared = await engine.prepareCurrentTurnInstruction();
    expect(prepared.identity).toMatchObject({ chatIdentity: 'chat-a', taskId: 'task-a', stageId: 'stage-a', revision: 1, nodeId: 'node-a', turnId: 'turn-1', attemptId: 'attempt-a' });
    expect(identities.map(identity => identity.attemptId)).toEqual(['attempt-a', 'attempt-a']);
    expect(prepared.instruction.instruction).toBe('最终文本');
  });

  it('无大纲状态可以启动循环；大纲创建后按新游标铸造身份', async () => {
    let current = envelope({ withStage: false });
    const planner = { plan: vi.fn(async (request: any) => {
      expect(request.readContext().stage).toBeNull();
      const identity = request.createInternalRequestIdentity(0);
      expect(identity.stageId).toBe('pre-outline');
      expect(request.isInternalRequestCurrent(identity)).toBe(true);
      // 模拟大纲子代理创建大纲后游标出现。
      const created = await request.applyOutline('创建首个阶段');
      expect(created.op).toBe('create');
      expect(request.readContext().turn.goal).toBe('轮次 1');
      // 循环内旧身份仍然有效：isCurrent 不绑 revision。
      expect(request.isInternalRequestCurrent(identity)).toBe(true);
      return { instruction: '最终文本', attempts: 1, apiPreset: { presetName: '', source: 'current', reason: 'current_configuration' } };
    }) };
    const engine = new StageExecutionEngine_ACU({
      readEnvelope: () => current as any, getChatIdentity: () => 'chat-a', allocateId: prefix => `${prefix}-a`,
      planner: planner as any,
    });

    const prepared = await engine.prepareCurrentTurnInstruction(() => true, undefined, async () => {
      current = envelope();
      return { op: 'create', requiresReview: false, stopped: null, summary: '已创建' };
    });
    expect(prepared.identity).toMatchObject({ stageId: 'stage-a', revision: 1, nodeId: 'node-a', turnId: 'turn-1' });
  });

  it('marks an in-flight instruction stale when the lease is revoked', async () => {
    let current = true;
    const planner = { plan: vi.fn(async (request: any) => {
      const identity = request.createInternalRequestIdentity(0);
      current = false;
      expect(request.isInternalRequestCurrent(identity)).toBe(false);
      throw Object.assign(new Error('stale'), { error: { code: 'CONTINUATION_INTERNAL_REQUEST_STALE' } });
    }) };
    const engine = new StageExecutionEngine_ACU({
      readEnvelope: envelope as any, getChatIdentity: () => 'chat-a', allocateId: prefix => `${prefix}-a`,
      planner: planner as any,
    });

    await expect(engine.prepareCurrentTurnInstruction(() => current)).rejects.toThrow('stale');
  });

  it('普通规划轮注入 plan_control 回调，正文重试轮明确不注入', async () => {
    const planner = { plan: vi.fn(async (request: any) => {
      if (!request.planControl) return { instruction: '重试文本', attempts: 1, apiPreset: { presetName: '', source: 'current', reason: 'current_configuration' } };
      const result = await request.planControl({ kind: 'plan_control', thought: '重做后续大纲', operation: 'regenerate_current_outline', instruction: '按事实重做', volumeIds: [], stageId: 'stage-a', targetMessageIndex: null });
      expect(result).toMatchObject({ ok: true, summary: '已受控重做' });
      return { instruction: '正常规划文本', attempts: 1, apiPreset: { presetName: '', source: 'current', reason: 'current_configuration' } };
    }) };
    const engine = new StageExecutionEngine_ACU({
      readEnvelope: envelope as any, getChatIdentity: () => 'chat-a', allocateId: prefix => `${prefix}-a`, planner: planner as any,
    });
    const planControl = vi.fn(async () => ({ ok: true, summary: '已受控重做', requiresReview: false, stopped: null }));

    await expect(engine.prepareCurrentTurnInstruction(() => true, undefined, undefined, undefined, planControl)).resolves.toMatchObject({ instruction: { instruction: '正常规划文本' } });
    expect(planControl).toHaveBeenCalledOnce();

    const existing = { chatIdentity: 'chat-a', taskId: 'task-a', stageId: 'stage-a', revision: 1, nodeId: 'node-a', turnId: 'turn-1', attemptId: 'attempt-retry' };
    await expect(engine.prepareCurrentTurnInstruction(() => true, existing, undefined, undefined, planControl)).resolves.toMatchObject({ instruction: { instruction: '重试文本' } });
    expect(planControl).toHaveBeenCalledOnce();
  });

  it('正文重试轮沿用既有身份且不注入大纲操作回调', async () => {
    const planner = { plan: vi.fn(async (request: any) => {
      expect(request.applyOutline).toBeUndefined();
      return { instruction: '重试文本', attempts: 1, apiPreset: { presetName: '', source: 'current', reason: 'current_configuration' } };
    }) };
    const engine = new StageExecutionEngine_ACU({
      readEnvelope: envelope as any, getChatIdentity: () => 'chat-a', allocateId: prefix => `${prefix}-a`,
      planner: planner as any,
    });
    const existing = { chatIdentity: 'chat-a', taskId: 'task-a', stageId: 'stage-a', revision: 1, nodeId: 'node-a', turnId: 'turn-1', attemptId: 'attempt-retry' };

    const prepared = await engine.prepareCurrentTurnInstruction(() => true, existing, async () => ({ op: 'revise', requiresReview: false, stopped: null, summary: '' }));
    expect(prepared.identity).toEqual(existing);
  });

  it('正文重试身份与当前游标不符时立即判失效', async () => {
    const planner = { plan: vi.fn() };
    const engine = new StageExecutionEngine_ACU({
      readEnvelope: envelope as any, getChatIdentity: () => 'chat-a', allocateId: prefix => `${prefix}-a`,
      planner: planner as any,
    });
    const stale = { chatIdentity: 'chat-a', taskId: 'task-a', stageId: 'stage-a', revision: 2, nodeId: 'node-a', turnId: 'turn-1', attemptId: 'attempt-old' };

    await expect(engine.prepareCurrentTurnInstruction(() => true, stale)).rejects.toMatchObject({ error: { code: 'CONTINUATION_INTERNAL_REQUEST_STALE' } });
    expect(planner.plan).not.toHaveBeenCalled();
  });
});
