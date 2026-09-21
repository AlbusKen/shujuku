import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../../src/service/simulation/defaults';
import type { WorldSimulationEnvelope_ACU, WorldSimulationStagePlan_ACU, WorldSimulationStageRevision_ACU } from '../../../src/service/simulation/model';
import { WorldSimulationOrchestrator_ACU, resetWorldSimulationOrchestratorStateForTests_ACU, type WorldSimulationPreparedRun_ACU } from '../../../src/service/simulation/simulation-orchestrator';
import { beginWorldSimulationSessionRun_ACU, isWorldSimulationSessionRunning_ACU, resetWorldSimulationSessionLogForTests_ACU } from '../../../src/service/simulation/agent/agent-session-log';

const anchor = (chatIdentity = 'chat-a') => ({
  chatIdentity, messageIndex: 1, messageId: 1, messageKey: 'number:1', swipeId: '0', contentDigest: 'digest',
});
const plan: WorldSimulationStagePlan_ACU = {
  schemaVersion: 1,
  title: '阶段',
  objective: '推进',
  impactScope: [],
  factsToVerify: [],
  plannedTools: [],
  plannedSpecialists: [],
  expectedLedgerChanges: [],
  convergenceConditions: [],
  blockingConditions: [],
  completedSteps: [],
  nextStep: '执行',
};
const revision = (frozen = false): WorldSimulationStageRevision_ACU => ({ revision: 1, createdAt: 2, reason: 'initial', replanInstruction: '', frozen, plan });
const completed = { outcome: 'no_change' as const, summary: '无变化', outcomes: [] };

function fixture(options: {
  prepare?: (signal: AbortSignal) => Promise<WorldSimulationPreparedRun_ACU>;
  appendUserMessage?: (input: { identity: unknown; anchor: unknown; text: string }) => Promise<void>;
} = {}) {
  let envelope: WorldSimulationEnvelope_ACU | null = buildDefaultWorldSimulationEnvelope_ACU();
  const initialLedger = envelope.ledger;
  let id = 0;
  const execute = vi.fn(async () => completed);
  const prepare = vi.fn(async ({ signal }: { signal: AbortSignal }) => options.prepare
    ? options.prepare(signal)
    : { revision: revision(), execute });
  const store = {
    read: () => envelope,
    updateAtomically: vi.fn(async (mutator: (current: WorldSimulationEnvelope_ACU | null) => WorldSimulationEnvelope_ACU) => { envelope = mutator(envelope); }),
  };
  const commitProjection = vi.fn(async () => undefined);
  const orchestrator = new WorldSimulationOrchestrator_ACU({
    store,
    now: () => 10 + id,
    allocateId: kind => `${kind}-${++id}`,
    prepare: prepare as any,
    assertAnchorCurrent: vi.fn(),
    ...(options.appendUserMessage ? { appendUserMessage: options.appendUserMessage as any } : {}),
    commitProjection,
  });
  return { orchestrator, store, prepare, execute, commitProjection, getEnvelope: () => envelope!, initialLedger };
}

/** 构造"首次 prepare 挂起直到 abort、之后正常返回"的 prepare，并暴露首次进入的信号。 */
function abortableFirstPrepare(execute: WorldSimulationPreparedRun_ACU['execute']) {
  let entered!: () => void;
  const prepareEntered = new Promise<void>(resolve => { entered = resolve; });
  let calls = 0;
  const prepare = (signal: AbortSignal): Promise<WorldSimulationPreparedRun_ACU> => {
    calls += 1;
    if (calls > 1) return Promise.resolve({ revision: revision(), execute });
    return new Promise<WorldSimulationPreparedRun_ACU>((_resolve, reject) => {
      entered();
      if (signal.aborted) { reject(new Error('WORLD_SIMULATION_ABORTED')); return; }
      signal.addEventListener('abort', () => reject(new Error('WORLD_SIMULATION_ABORTED')), { once: true });
    });
  };
  return { prepare, prepareEntered };
}

describe('WorldSimulationOrchestrator_ACU', () => {
  beforeEach(() => {
    resetWorldSimulationOrchestratorStateForTests_ACU();
  });

  it('自动触发关闭时不预留任务且模型调用为 0', async () => {
    const f = fixture();
    f.getEnvelope().settings.autoTriggerEnabled = false;
    await expect(f.orchestrator.start({ triggerKind: 'assistant_completed', anchor: anchor(), instruction: '推进' })).resolves.toEqual({ status: 'skipped', reason: 'disabled' });
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.store.updateAtomically).not.toHaveBeenCalled();
  });

  it('触发后直接冻结 revision 并执行一次，不等待人工确认', async () => {
    const f = fixture();
    const result = await f.orchestrator.start({ triggerKind: 'assistant_completed', anchor: anchor(), instruction: '推进' });
    expect(result).toMatchObject({ status: 'completed', result: { outcome: 'no_change' } });
    expect(f.execute).toHaveBeenCalledOnce();
    expect(f.getEnvelope().task).toMatchObject({ status: 'completed', activeRun: null });
    expect(f.getEnvelope().stages[0]).toMatchObject({ status: 'completed', activeRevision: 1, revisions: [{ frozen: true }] });
    expect(f.getEnvelope().ledger).toBe(f.initialLedger);
  });

  it('在途运行期间同锚点触发返回 duplicate、其他触发返回 busy，释放后下一轮触发正常完成', async () => {
    let releasePrepare!: () => void;
    const preparing = new Promise<void>(resolve => { releasePrepare = resolve; });
    let prepareEntered!: () => void;
    const entered = new Promise<void>(resolve => { prepareEntered = resolve; });
    const execute = vi.fn(async () => completed);
    const f = fixture({
      prepare: async () => {
        prepareEntered();
        await preparing;
        return { revision: revision(), execute };
      },
    });
    const running = f.orchestrator.start({ triggerKind: 'assistant_completed', anchor: anchor(), instruction: '推进' });
    await entered;
    await expect(f.orchestrator.start({ triggerKind: 'assistant_completed', anchor: anchor(), instruction: '推进' }))
      .resolves.toEqual({ status: 'skipped', reason: 'duplicate' });
    await expect(f.orchestrator.start({
      triggerKind: 'agent_chat_message',
      anchor: anchor(),
      instruction: '推进',
      triggerConversationMessageId: 'turn-1',
    })).resolves.toEqual({ status: 'skipped', reason: 'busy' });
    expect(f.prepare).toHaveBeenCalledOnce();
    releasePrepare();
    await expect(running).resolves.toMatchObject({ status: 'completed' });
    expect(f.getEnvelope().task).toMatchObject({ status: 'completed', activeRun: null });
    await expect(f.orchestrator.start({ triggerKind: 'assistant_completed', anchor: anchor(), instruction: '推进' }))
      .resolves.toMatchObject({ status: 'completed' });
    expect(f.prepare).toHaveBeenCalledTimes(2);
  });

  it('取消会传播 AbortSignal，任务落为可恢复的 paused/manual 且不修改 ledger', async () => {
    let enteredPrepare!: () => void;
    const preparing = new Promise<void>(resolve => { enteredPrepare = resolve; });
    const f = fixture({
      prepare: signal => new Promise<WorldSimulationPreparedRun_ACU>((_resolve, reject) => {
        enteredPrepare();
        signal.addEventListener('abort', () => reject(new Error('WORLD_SIMULATION_ABORTED')), { once: true });
      }),
    });
    const running = f.orchestrator.start({ triggerKind: 'assistant_completed', anchor: anchor(), instruction: '推进' });
    await preparing;
    expect(f.orchestrator.isInFlight('chat-a')).toBe(true);
    expect(f.orchestrator.cancel('chat-a')).toBe(true);
    await expect(running).resolves.toMatchObject({ status: 'cancelled' });
    expect(f.getEnvelope().task).toMatchObject({ status: 'paused', stopReason: 'manual', activeRun: expect.objectContaining({ runId: 'run-3' }) });
    expect(f.getEnvelope().timeline.at(-1)).toMatchObject({ kind: 'paused', message: 'manual' });
    expect(f.getEnvelope().ledger).toBe(f.initialLedger);
    expect(f.orchestrator.isInFlight('chat-a')).toBe(false);
    expect(f.orchestrator.cancel('chat-a')).toBe(false);
  });

  it('手停在规划阶段后 resume 会重新 prepare 并完成，identity 复用同一 task/run', async () => {
    const execute = vi.fn(async () => completed);
    const { prepare, prepareEntered } = abortableFirstPrepare(execute);
    const f = fixture({ prepare });
    const running = f.orchestrator.start({ triggerKind: 'agent_chat_message', anchor: anchor(), instruction: '推进', triggerConversationMessageId: 'turn-1' });
    await prepareEntered;
    expect(await f.orchestrator.interrupt('chat-a')).toBe(true);
    await expect(running).resolves.toMatchObject({ status: 'cancelled' });
    const pausedRun = f.getEnvelope().task!.activeRun!;
    expect(f.getEnvelope().stages[0]).toMatchObject({ status: 'planning', revisions: [{ frozen: false }] });

    const resumed = await f.orchestrator.resume({ anchor: anchor(), instruction: '补充：优先核实北境' });
    expect(resumed).toMatchObject({ status: 'completed', identity: { taskId: pausedRun.taskId, runId: pausedRun.runId } });
    expect(f.prepare).toHaveBeenCalledTimes(2);
    expect(f.prepare.mock.calls[1][0]).toMatchObject({ instruction: '补充：优先核实北境' });
    expect(execute).toHaveBeenCalledOnce();
    expect(f.getEnvelope().task).toMatchObject({ status: 'completed', activeRun: null, stopReason: null });
    expect(f.getEnvelope().stages[0]).toMatchObject({ status: 'completed', revisions: [{ frozen: true }] });
  });

  it('resume 传入 resetRunBudget 时转发给 prepare', async () => {
    const execute = vi.fn(async () => completed);
    const { prepare, prepareEntered } = abortableFirstPrepare(execute);
    const f = fixture({ prepare });
    const running = f.orchestrator.start({ triggerKind: 'agent_chat_message', anchor: anchor(), instruction: '推进', triggerConversationMessageId: 'turn-1' });
    await prepareEntered;
    await f.orchestrator.interrupt('chat-a');
    await running;
    await f.orchestrator.resume({ anchor: anchor(), instruction: '补充：重置预算', resetRunBudget: true });
    expect(f.prepare.mock.calls[1][0]).toMatchObject({ instruction: '补充：重置预算', resetRunBudget: true });
  });

  it('resume 携带指令时先把用户消息追加到冻结楼层会话', async () => {
    const appendUserMessage = vi.fn(async () => undefined);
    const { prepare, prepareEntered } = abortableFirstPrepare(async () => completed);
    const f = fixture({ prepare, appendUserMessage });
    const running = f.orchestrator.start({ triggerKind: 'assistant_completed', anchor: anchor(), instruction: '推进' });
    await prepareEntered;
    await f.orchestrator.interrupt('chat-a');
    await running;
    expect(appendUserMessage).not.toHaveBeenCalled();
    await f.orchestrator.resume({ anchor: anchor(), instruction: '把边境压力调高' });
    expect(appendUserMessage).toHaveBeenCalledOnce();
    expect(appendUserMessage.mock.calls[0][0]).toMatchObject({ text: '把边境压力调高', anchor: anchor(), idempotent: true });
  });

  it('在途期间到达的自动触发排队为最新一次，结算后自动为该楼层开始运行', async () => {
    let releasePrepare!: () => void;
    const preparing = new Promise<void>(resolve => { releasePrepare = resolve; });
    let entered!: () => void;
    const prepareEntered = new Promise<void>(resolve => { entered = resolve; });
    const f = fixture({
      prepare: async () => {
        if (f.prepare.mock.calls.length === 1) { entered(); await preparing; }
        return { revision: revision(), execute: f.execute };
      },
    });
    const running = f.orchestrator.start({ triggerKind: 'assistant_completed', anchor: anchor(), instruction: '推进 A' });
    await prepareEntered;
    const anchorB = { ...anchor(), messageIndex: 2, messageId: 2, messageKey: 'number:2', contentDigest: 'digest-b' };
    const anchorC = { ...anchor(), messageIndex: 3, messageId: 3, messageKey: 'number:3', contentDigest: 'digest-c' };
    await expect(f.orchestrator.start({ triggerKind: 'assistant_completed', anchor: anchorB, instruction: '推进 B' })).resolves.toEqual({ status: 'skipped', reason: 'queued' });
    await expect(f.orchestrator.start({ triggerKind: 'assistant_completed', anchor: anchorC, instruction: '推进 C' })).resolves.toEqual({ status: 'skipped', reason: 'queued' });
    releasePrepare();
    await expect(running).resolves.toMatchObject({ status: 'completed' });
    // drain 是 fire-and-forget：等待微任务与排队的 store 写入落定。
    for (let index = 0; index < 20 && f.prepare.mock.calls.length < 2; index += 1) await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.prepare).toHaveBeenCalledTimes(2);
    expect(f.prepare.mock.calls[1][0]).toMatchObject({ instruction: '推进 C', anchor: { messageKey: 'number:3' } });
    expect(f.getEnvelope().task).toMatchObject({ status: 'completed', activeRun: null, originInstruction: '推进 C' });
  });

  it('用户主动停止后不排空 pending 自动触发，避免刚停就被自动重启', async () => {
    let entered!: () => void;
    const prepareEntered = new Promise<void>(resolve => { entered = resolve; });
    const f = fixture({
      prepare: signal => new Promise<WorldSimulationPreparedRun_ACU>((_resolve, reject) => {
        entered();
        signal.addEventListener('abort', () => reject(new Error('WORLD_SIMULATION_ABORTED')), { once: true });
      }),
    });
    const running = f.orchestrator.start({ triggerKind: 'assistant_completed', anchor: anchor(), instruction: '推进 A' });
    await prepareEntered;
    const anchorB = { ...anchor(), messageIndex: 2, messageId: 2, messageKey: 'number:2', contentDigest: 'digest-b' };
    await expect(f.orchestrator.start({ triggerKind: 'assistant_completed', anchor: anchorB, instruction: '推进 B' })).resolves.toEqual({ status: 'skipped', reason: 'queued' });
    expect(await f.orchestrator.interrupt('chat-a')).toBe(true);
    await expect(running).resolves.toMatchObject({ status: 'cancelled' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.prepare).toHaveBeenCalledTimes(1);
    expect(f.getEnvelope().task).toMatchObject({ status: 'paused', stopReason: 'manual', originInstruction: '推进 A' });
  });

  it('paused 任务被更新楼层的自动触发取代；同锚点自动触发视为重复', async () => {
    const { prepare, prepareEntered } = abortableFirstPrepare(async () => completed);
    const f = fixture({ prepare });
    const running = f.orchestrator.start({ triggerKind: 'assistant_completed', anchor: anchor(), instruction: '推进 A' });
    await prepareEntered;
    await f.orchestrator.interrupt('chat-a');
    await running;
    const pausedTaskId = f.getEnvelope().task!.taskId;
    await expect(f.orchestrator.start({ triggerKind: 'assistant_completed', anchor: anchor(), instruction: '推进 A 重复' })).resolves.toEqual({ status: 'skipped', reason: 'duplicate' });
    await expect(f.orchestrator.start({ triggerKind: 'agent_chat_message', anchor: anchor(), instruction: '同锚点手动', triggerConversationMessageId: 'turn-x' })).resolves.toEqual({ status: 'skipped', reason: 'busy' });

    const anchorB = { ...anchor(), messageIndex: 2, messageId: 2, messageKey: 'number:2', contentDigest: 'digest-b' };
    const result = await f.orchestrator.start({ triggerKind: 'assistant_completed', anchor: anchorB, instruction: '推进 B' });
    expect(result).toMatchObject({ status: 'completed' });
    expect(f.getEnvelope().task!.taskId).not.toBe(pausedTaskId);
    expect(f.getEnvelope().task).toMatchObject({ status: 'completed', originInstruction: '推进 B', activeRun: null });
    expect(f.getEnvelope().timeline.some(entry => entry.kind === 'stopped' && entry.message === 'superseded' && entry.taskId === pausedTaskId)).toBe(true);
  });

  it('deriveEnvelopeView 把无在途运行的 running 派生为 paused/interrupted，且不修改原对象', () => {
    const f = fixture();
    const envelope = f.getEnvelope();
    const identity = {
      runId: 'run-stale', chatIdentity: 'chat-a', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null,
      anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task-stale', stageId: 'stage-stale', stageRevision: 1,
    };
    envelope.task = { taskId: 'task-stale', originInstruction: '推进', status: 'running', createdAt: 1, updatedAt: 1, activeRun: identity, stopReason: null };
    const view = f.orchestrator.deriveEnvelopeView(envelope);
    expect(view!.task).toMatchObject({ status: 'paused', stopReason: 'interrupted', activeRun: identity });
    expect(envelope.task.status).toBe('running');
    expect(f.orchestrator.deriveEnvelopeView(null)).toBeNull();
  });

  it('僵死 running 任务可被 resume 直接继续', async () => {
    const f = fixture();
    const envelope = f.getEnvelope();
    const identity = {
      runId: 'run-stale', chatIdentity: 'chat-a', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null,
      anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task-stale', stageId: 'stage-stale', stageRevision: 1,
    };
    envelope.task = { taskId: 'task-stale', originInstruction: '推进', status: 'running', createdAt: 1, updatedAt: 1, activeRun: identity, stopReason: null };
    envelope.activeStageId = 'stage-stale';
    envelope.stages = [{ stageId: 'stage-stale', stageNumber: 1, status: 'running', activeRevision: 1, revisions: [revision(true)] }];
    await expect(f.orchestrator.resume({ anchor: anchor() })).resolves.toMatchObject({ status: 'completed', identity: { runId: 'run-stale' } });
    expect(f.getEnvelope().task).toMatchObject({ status: 'completed', activeRun: null });
  });

  it('执行期间 ledger revision 漂移时拒绝完成并保留漂移后的 ledger', async () => {
    let releaseExecute!: () => void;
    const executing = new Promise<void>(resolve => { releaseExecute = resolve; });
    let executionEntered!: () => void;
    const entered = new Promise<void>(resolve => { executionEntered = resolve; });
    const execute = vi.fn(async () => {
      executionEntered();
      await executing;
      return completed;
    });
    const f = fixture({ prepare: async () => ({ revision: revision(), execute }) });
    const running = f.orchestrator.start({ triggerKind: 'assistant_completed', anchor: anchor(), instruction: '推进' });
    await entered;
    const driftedLedger = { ...f.getEnvelope().ledger, revision: 1 };
    f.getEnvelope().ledger = driftedLedger;
    releaseExecute();
    await expect(running).resolves.toMatchObject({ status: 'failed', error: { code: 'WORLD_SIMULATION_REVISION_CONFLICT' } });
    expect(f.getEnvelope().ledger).toBe(driftedLedger);
    expect(f.getEnvelope().task).toMatchObject({ status: 'failed', activeRun: null });
  });

  it('异常失败终局强制关闭会话流 running 标记，UI 停止按钮不再卡死', async () => {
    resetWorldSimulationSessionLogForTests_ACU();
    beginWorldSimulationSessionRun_ACU('chat-a', '世界推演 Agent 运行');
    expect(isWorldSimulationSessionRunning_ACU('chat-a')).toBe(true);
    const f = fixture({ prepare: async () => ({ revision: revision(), execute: async () => { throw new Error('WORLD_SIMULATION_AGENT_PROTOCOL_INVALID'); } }) });
    await expect(f.orchestrator.start({ triggerKind: 'assistant_completed', anchor: anchor(), instruction: '推进' }))
      .resolves.toMatchObject({ status: 'failed' });
    expect(f.getEnvelope().task).toMatchObject({ status: 'failed', activeRun: null });
    expect(isWorldSimulationSessionRunning_ACU('chat-a')).toBe(false);
  });
});
