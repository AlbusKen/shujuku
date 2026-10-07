import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../../src/service/simulation/defaults';
import { buildDirectorOwnedStageRevision_ACU, confirmWorldSimulationStageRevision_ACU, replaceWorldSimulationStagePlan_ACU } from '../../../src/service/simulation/simulation-stage-planner';
import { WorldSimulationStageExecutionEngine_ACU } from '../../../src/service/simulation/simulation-stage-execution-engine';
import { resetWorldSimulationSessionLogForTests_ACU } from '../../../src/service/simulation/agent/agent-session-log';

const plan = { schemaVersion: 1 as const, title: '阶段', objective: '推进世界', impactScope: ['world'], factsToVerify: [], plannedTools: [], plannedSpecialists: [], expectedLedgerChanges: ['clock' as const], convergenceConditions: ['完成'], blockingConditions: [], completedSteps: [], nextStep: '执行' };

describe('格林推演阶段 runtime', () => {
  afterEach(() => { resetWorldSimulationSessionLogForTests_ACU(); });
  it('新建 run 使用确定性 director-owned 阶段计划且不含 chronicler', () => {
    const revision = buildDirectorOwnedStageRevision_ACU({
      instruction: '推进北岭暗流',
      collisions: { playerRegion: '北岭', playerContact: 'open', secludedNote: null, collidedSeeds: ['seed-border'], ripeRumors: ['rumor-bell'] },
      now: 42,
    });
    expect(revision).toMatchObject({ revision: 1, createdAt: 42, frozen: false, reason: 'initial' });
    expect(revision.plan.title).toBe('本轮幕后推演');
    expect(revision.plan.objective).toBe('推进北岭暗流');
    expect(revision.plan.plannedSpecialists).toEqual(['timekeeper', 'undercurrent-analyst', 'dramatis-keeper']);
    expect(revision.plan.plannedSpecialists).not.toContain('chronicler');
    expect(revision.plan.expectedLedgerChanges).toEqual(['clock', 'dimensions', 'seeds', 'actors', 'rumors', 'player']);
    expect(revision.plan.factsToVerify).toEqual(expect.arrayContaining([
      '碰撞暗流：seed-border',
      '成熟传闻：rumor-bell',
      '正文时间跨度',
    ]));
  });
  it('确认后阶段 revision 冻结，不能再替换计划', () => {
    const revision = buildDirectorOwnedStageRevision_ACU({
      instruction: '推进北岭暗流',
      collisions: { playerRegion: null, playerContact: 'open', secludedNote: null, collidedSeeds: [], ripeRumors: [] },
      now: 10,
    });
    expect(revision).toMatchObject({ revision: 1, createdAt: 10, reason: 'initial', frozen: false });
    const frozen = confirmWorldSimulationStageRevision_ACU(revision);
    expect(frozen.frozen).toBe(true);
    expect(() => replaceWorldSimulationStagePlan_ACU(frozen, plan)).toThrow('WORLD_SIMULATION_STAGE_REVISION_FROZEN');
  });

  it('执行引擎在主循环前后复核冻结身份与锚点', async () => {
    const identity = {
      runId: 'run-1', chatIdentity: 'chat-1', triggerKind: 'assistant_completed' as const,
      triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1',
      anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0,
      taskId: 'task-1', stageId: 'stage-1', stageRevision: 1,
    };
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.task = { taskId: 'task-1', originInstruction: '推进', status: 'running', createdAt: 1, updatedAt: 1, activeRun: identity, stopReason: null };
    envelope.activeStageId = 'stage-1';
    envelope.stages = [{ stageId: 'stage-1', stageNumber: 1, status: 'running', activeRevision: 1, revisions: [{ revision: 1, createdAt: 1, reason: 'initial', replanInstruction: '', frozen: true, plan }] }];
    const runMainLoop = vi.fn(async () => ({ outcome: 'blocked' as const, summary: 'done', unresolved: ['x'], outcomes: [] }));
    const assertAnchorCurrent = vi.fn();
    const engine = new WorldSimulationStageExecutionEngine_ACU({ readEnvelope: () => envelope, getChatIdentity: () => 'chat-1', assertAnchorCurrent, runMainLoop });
    await expect(engine.run({ identity })).resolves.toMatchObject({ outcome: 'blocked' });
    expect(runMainLoop).toHaveBeenCalledOnce();
    expect(assertAnchorCurrent).toHaveBeenCalledTimes(2);
  });

  it('身份或 ledger revision 过期时在主循环前 fail-closed', async () => {
    const identity = {
      runId: 'run-1', chatIdentity: 'chat-1', triggerKind: 'assistant_completed' as const,
      triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1',
      anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0,
      taskId: 'task-1', stageId: 'stage-1', stageRevision: 1,
    };
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.ledger.revision = 1;
    envelope.task = { taskId: 'task-1', originInstruction: '推进', status: 'running', createdAt: 1, updatedAt: 1, activeRun: identity, stopReason: null };
    envelope.activeStageId = 'stage-1';
    envelope.stages = [{ stageId: 'stage-1', stageNumber: 1, status: 'running', activeRevision: 1, revisions: [{ revision: 1, createdAt: 1, reason: 'initial', replanInstruction: '', frozen: true, plan }] }];
    const runMainLoop = vi.fn();
    const engine = new WorldSimulationStageExecutionEngine_ACU({ readEnvelope: () => envelope, getChatIdentity: () => 'chat-1', assertAnchorCurrent: vi.fn(), runMainLoop });
    await expect(engine.run({ identity })).rejects.toThrow('WORLD_SIMULATION_LEDGER_STALE');
    expect(runMainLoop).not.toHaveBeenCalled();
  });
});

describe('world simulation stage run write proof', () => {
  it('accepts only the run-owned folded ledger after an in-flight write', async () => {
    const { WorldSimulationRunWriteState_ACU } = await import('../../../src/service/simulation/simulation-run-write-state');
    const identity = {
      runId: 'run-owned', chatIdentity: 'chat-1', triggerKind: 'assistant_completed' as const,
      triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1',
      anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0,
      taskId: 'task-1', stageId: 'stage-1', stageRevision: 1,
    };
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.task = { taskId: identity.taskId, originInstruction: '推进', status: 'running', createdAt: 1, updatedAt: 1, activeRun: identity, stopReason: null };
    envelope.activeStageId = identity.stageId;
    envelope.stages = [{ stageId: identity.stageId, stageNumber: 1, status: 'running', activeRevision: 1,
      revisions: [{ revision: 1, createdAt: 1, reason: 'initial', replanInstruction: '', frozen: true, plan }] }];
    const view = () => ({ ledger: envelope.ledger, fields: undefined, archive: { schemaVersion: 1 as const, records: {} } });
    const proof = new WorldSimulationRunWriteState_ACU(view, 0);
    const nextView = (ledger: typeof envelope.ledger) => ({ ...view(), ledger });
    const runMainLoop = vi.fn(async () => {
      const next = { ...envelope.ledger, revision: 1 };
      proof.confirm(nextView(next), []);
      envelope.ledger = next;
      return { outcome: 'no_change' as const, summary: 'done', outcomes: [] };
    });
    const engine = new WorldSimulationStageExecutionEngine_ACU({ readEnvelope: () => envelope,
      getChatIdentity: () => 'chat-1', assertAnchorCurrent: vi.fn(), runMainLoop, runWrites: proof });
    await expect(engine.run({ identity })).resolves.toMatchObject({ outcome: 'no_change' });
    envelope.ledger = { ...envelope.ledger, revision: 2 };
    await expect(engine.run({ identity })).rejects.toThrow('WORLD_SIMULATION_LEDGER_STALE');
    expect(runMainLoop).toHaveBeenCalledOnce();
  });
});
