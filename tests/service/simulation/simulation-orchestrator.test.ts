import { describe, expect, it, vi } from 'vitest';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../../src/service/simulation/defaults';
import type { WorldSimulationEnvelope_ACU, WorldSimulationStagePlan_ACU, WorldSimulationStageRevision_ACU } from '../../../src/service/simulation/model';
import { WorldSimulationOrchestrator_ACU, type WorldSimulationPreparedRun_ACU } from '../../../src/service/simulation/simulation-orchestrator';

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

function fixture(options: { prepare?: (signal: AbortSignal) => Promise<WorldSimulationPreparedRun_ACU> } = {}) {
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
    commitProjection,
  });
  return { orchestrator, store, prepare, execute, commitProjection, getEnvelope: () => envelope!, initialLedger };
}

describe('WorldSimulationOrchestrator_ACU', () => {
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

  it('取消会传播 AbortSignal、停止本次运行且不修改 ledger', async () => {
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
    expect(f.orchestrator.cancel('chat-a')).toBe(true);
    await expect(running).resolves.toMatchObject({ status: 'cancelled' });
    expect(f.getEnvelope().task).toMatchObject({ status: 'abandoned', activeRun: null, stopReason: 'cancelled' });
    expect(f.getEnvelope().ledger).toBe(f.initialLedger);
    expect(f.orchestrator.cancel('chat-a')).toBe(false);
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
});
