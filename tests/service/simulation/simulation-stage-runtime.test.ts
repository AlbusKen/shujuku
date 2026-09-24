import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDefaultWorldSimulationEnvelope_ACU, buildDefaultWorldSimulationSettings_ACU } from '../../../src/service/simulation/defaults';
import { buildDefaultWorldSimulationAgentPrompts_ACU } from '../../../src/service/simulation/agent/agent-defaults';
import { buildDirectorOwnedStageRevision_ACU, confirmWorldSimulationStageRevision_ACU, replaceWorldSimulationStagePlan_ACU, WorldSimulationStagePlanner_ACU } from '../../../src/service/simulation/simulation-stage-planner';
import { WorldSimulationStageExecutionEngine_ACU } from '../../../src/service/simulation/simulation-stage-execution-engine';
import { createWorldSimulationEvidenceRegistry_ACU, snapshotWorldSimulationEvidenceRegistry_ACU } from '../../../src/service/simulation/world-simulation-evidence-registry';
import { readWorldSimulationSessionLog_ACU, resetWorldSimulationSessionLogForTests_ACU } from '../../../src/service/simulation/agent/agent-session-log';

const apiPreset = { resolvePreset: () => ({ resolved: true, apiMode: 'openai' as any, apiConfig: {} as any, tavernProfile: '' }) };
const context = () => {
  const registry = createWorldSimulationEvidenceRegistry_ACU('stage');
  return { task: {}, history: [], runtimeContext: {}, agentCatalog: [], toolCatalog: [], evidence: [], userGuidance: '', worldState: {}, anchorMessage: '', anchorIdentity: {}, worldStagePlan: {}, worldChronicle: [], worldCandidates: [], worldCollisions: { playerRegion: null, playerContact: 'open' as const, secludedNote: null, collidedSeeds: [], ripeRumors: [] }, evidenceRegistry: snapshotWorldSimulationEvidenceRegistry_ACU(registry), projectionPreview: {} };
};
const plan = { schemaVersion: 1 as const, title: '阶段', objective: '推进世界', impactScope: ['world'], factsToVerify: [], plannedTools: [], plannedSpecialists: [], expectedLedgerChanges: ['clock' as const], convergenceConditions: ['完成'], blockingConditions: [], completedSteps: [], nextStep: '执行' };

describe('世界推演阶段 runtime', () => {
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
  it('生成、确认并冻结阶段 revision', async () => {
    const settings = { ...buildDefaultWorldSimulationSettings_ACU(), agentPrompts: buildDefaultWorldSimulationAgentPrompts_ACU() };
    const planner = new WorldSimulationStagePlanner_ACU({ apiPreset, countTokens: async () => 1, invoke: async () => JSON.stringify({ action: 'plan', summary: 'ok', plan }) });
    const result = await planner.plan({ settings, promptContext: context(), now: 10 });
    expect(result.revision).toMatchObject({ revision: 1, createdAt: 10, reason: 'initial', frozen: false });
    const frozen = confirmWorldSimulationStageRevision_ACU(result.revision);
    expect(frozen.frozen).toBe(true);
    expect(() => replaceWorldSimulationStagePlan_ACU(frozen, plan)).toThrow('WORLD_SIMULATION_STAGE_REVISION_FROZEN');
  });

  it('planner 请求未完成时立即创建 running 卡片，并在成功后原位更新', async () => {
    const settings = { ...buildDefaultWorldSimulationSettings_ACU(), agentPrompts: buildDefaultWorldSimulationAgentPrompts_ACU() };
    let resolveInvoke!: (value: string) => void;
    const invoke = vi.fn(() => new Promise<string>(resolve => { resolveInvoke = resolve; }));
    const planner = new WorldSimulationStagePlanner_ACU({ apiPreset, countTokens: async () => 1, invoke, chatIdentity: 'chat-planner-live' });

    const pending = planner.plan({ settings, promptContext: context(), now: 10 });
    const running = readWorldSimulationSessionLog_ACU('chat-planner-live');

    expect(running).toHaveLength(1);
    expect(running[0]).toMatchObject({
      kind: 'stage_plan',
      title: '阶段规划正在工作',
      agentName: 'world-stage-planner',
      status: 'running',
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    resolveInvoke(JSON.stringify({ action: 'plan', summary: '规划完成', plan }));
    await pending;

    const completed = readWorldSimulationSessionLog_ACU('chat-planner-live');
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ id: running[0].id, title: '阶段', detail: '规划完成', status: 'done', ok: true });
  });

  it('planner 首次漏掉 plan 时携带协议错误自动修正', async () => {
    const settings = { ...buildDefaultWorldSimulationSettings_ACU(), agentPrompts: buildDefaultWorldSimulationAgentPrompts_ACU() };
    const invoke = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ action: 'plan', summary: '只有摘要' }))
      .mockResolvedValueOnce(JSON.stringify({ action: 'plan', summary: '已补全', plan }));
    const planner = new WorldSimulationStagePlanner_ACU({ apiPreset, countTokens: async () => 1, invoke, chatIdentity: 'chat-planner' });

    const result = await planner.plan({ settings, promptContext: context(), now: 11 });

    expect(result.summary).toBe('已补全');
    expect(result.revision.plan).toEqual(plan);
    expect(invoke).toHaveBeenCalledTimes(2);
    const retryMessages = invoke.mock.calls[1][0] as Array<{ role: string; content: string }>;
    expect(retryMessages.at(-2)).toMatchObject({ role: 'assistant', content: expect.stringContaining('只有摘要') });
    expect(retryMessages.at(-1)).toMatchObject({ role: 'user', content: expect.stringContaining('MISSING_FIELD $.plan') });
    expect(retryMessages.at(-1)?.content).toContain('顶层必须且只能包含 action、summary、plan');
    expect(retryMessages.at(-1)?.content).toContain('schemaVersion、title、objective、impactScope');
    expect(retryMessages.at(-1)?.content).toContain('expectedLedgerChanges 只能使用：clock | dimensions | seeds | actors | chronicle | guidance | rumors | player');
    expect(retryMessages.at(-1)?.content).toContain('"action":"plan"');
    expect(retryMessages.at(-1)?.content).toContain('WORLD_SIMULATION_ENGINE_SEAM');
    const entries = readWorldSimulationSessionLog_ACU('chat-planner');
    expect(entries.map(item => item.kind)).toEqual(['stage_plan', 'protocol_retry']);
    expect(entries[0]).toMatchObject({ title: '阶段', detail: '已补全', status: 'done' });
    expect(entries[1]).toMatchObject({ title: '阶段规划协议修正', ok: false });
    expect(entries[1].detail).toContain('MISSING_FIELD $.plan');
    expect(entries[1].detail).toContain('模型返回片段');
  });

  it('planner 重复返回同一非法协议时保留结构化错误并停止重试', async () => {
    const settings = { ...buildDefaultWorldSimulationSettings_ACU(), agentPrompts: buildDefaultWorldSimulationAgentPrompts_ACU() };
    const invoke = vi.fn().mockResolvedValue(JSON.stringify({ action: 'plan', summary: '仍缺计划' }));
    const planner = new WorldSimulationStagePlanner_ACU({ apiPreset, countTokens: async () => 1, invoke, chatIdentity: 'chat-planner-reject' });

    let caught: any;
    try {
      await planner.plan({ settings, promptContext: context(), now: 12 });
    } catch (error) {
      caught = error;
    }

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(caught?.error).toMatchObject({
      code: 'WORLD_SIMULATION_AGENT_PROTOCOL_INVALID',
      details: { reasonCode: 'MISSING_FIELD', path: '$.plan' },
    });
    const entries = readWorldSimulationSessionLog_ACU('chat-planner-reject');
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({ kind: 'stage_plan', title: '阶段规划失败', status: 'failed', ok: false });
    expect(entries[1]).toMatchObject({ kind: 'protocol_retry', title: '阶段规划协议修正', ok: false });
    expect(entries[2]).toMatchObject({ kind: 'protocol_retry', title: '阶段规划输出被拒绝', ok: false });
    expect(entries[2].detail).toContain('模型返回片段');
  });

  it('阶段计划持久化失败时不误触发模型协议重试', async () => {
    const settings = { ...buildDefaultWorldSimulationSettings_ACU(), agentPrompts: buildDefaultWorldSimulationAgentPrompts_ACU() };
    const invoke = vi.fn(async () => JSON.stringify({ action: 'plan', summary: '规划完成', plan }));
    const persistSessionEvent = vi.fn(async () => { throw new Error('HOST_SAVE_FAILED'); });
    const planner = new WorldSimulationStagePlanner_ACU({
      apiPreset,
      countTokens: async () => 1,
      invoke,
      chatIdentity: 'chat-planner-persist-failed',
      persistSessionEvent,
    });

    await expect(planner.plan({ settings, promptContext: context(), now: 13 })).rejects.toThrow('HOST_SAVE_FAILED');

    expect(invoke).toHaveBeenCalledOnce();
    expect(persistSessionEvent).toHaveBeenCalledTimes(2);
    expect(readWorldSimulationSessionLog_ACU('chat-planner-persist-failed')).toHaveLength(1);
    expect(readWorldSimulationSessionLog_ACU('chat-planner-persist-failed')[0]).toMatchObject({
      kind: 'stage_plan', title: '阶段规划失败', status: 'failed', ok: false,
    });
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
