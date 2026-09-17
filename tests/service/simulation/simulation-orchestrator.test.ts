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

function fixture(options: { planPreview?: boolean; prepare?: (signal: AbortSignal) => Promise<WorldSimulationPreparedRun_ACU> } = {}) {
  let envelope: WorldSimulationEnvelope_ACU | null = buildDefaultWorldSimulationEnvelope_ACU();
  envelope.settings.planPreview = options.planPreview ?? true;
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

  it('计划预览持久化冻结锚点身份并等待确认', async () => {
    const f = fixture({ planPreview: true });
    const result = await f.orchestrator.start({ triggerKind: 'assistant_completed', anchor: anchor(), instruction: '推进' });
    expect(result.status).toBe('awaiting_plan_review');
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.getEnvelope().task).toMatchObject({ status: 'awaiting_plan_review', activeRun: { anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest' } });
    expect(f.getEnvelope().stages[0]).toMatchObject({ status: 'awaiting_review', activeRevision: 1 });
    expect(f.getEnvelope().ledger).toBe(f.initialLedger);
  });

  it('关闭计划预览时冻结 revision、执行一次且不修改 ledger', async () => {
    const f = fixture({ planPreview: false });
    const result = await f.orchestrator.start({ triggerKind: 'assistant_completed', anchor: anchor(), instruction: '推进' });
    expect(result).toMatchObject({ status: 'completed', result: { outcome: 'no_change' } });
    expect(f.execute).toHaveBeenCalledOnce();
    expect(f.getEnvelope().task).toMatchObject({ status: 'completed' });
    expect(f.getEnvelope().stages[0]).toMatchObject({ status: 'completed', revisions: [{ frozen: true }] });
    expect(f.getEnvelope().ledger).toBe(f.initialLedger);
    expect(f.getEnvelope().ledger.revision).toBe(0);
  });

  it('同一冻结触发只运行一次，不同触发在活动任务期间返回 busy', async () => {
    const f = fixture({ planPreview: true });
    await f.orchestrator.start({ triggerKind: 'assistant_completed', anchor: anchor(), instruction: '推进' });
    await expect(f.orchestrator.start({ triggerKind: 'assistant_completed', anchor: anchor(), instruction: '推进' }))
      .resolves.toEqual({ status: 'skipped', reason: 'duplicate' });
    await expect(f.orchestrator.start({
      triggerKind: 'assistant_completed',
      anchor: { ...anchor(), messageId: 2, messageKey: 'number:2', contentDigest: 'digest-2' },
      instruction: '推进',
    })).resolves.toEqual({ status: 'skipped', reason: 'busy' });
    expect(f.prepare).toHaveBeenCalledOnce();
  });

  it('取消会传播 AbortSignal、停止本次运行且不修改 ledger', async () => {
    let enteredPrepare!: () => void;
    const preparing = new Promise<void>(resolve => { enteredPrepare = resolve; });
    const f = fixture({
      planPreview: false,
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

  it('待确认计划可带指令重规划为新 revision，且保持待确认不执行', async () => {
    const f = fixture({ planPreview: true });
    await f.orchestrator.start({ triggerKind: 'assistant_completed', anchor: anchor(), instruction: '推进' });
    f.prepare.mockImplementationOnce(async (input: any) => ({
      revision: {
        ...revision(),
        revision: 2,
        reason: 'manual_replan',
        replanInstruction: input.replanInstruction,
      },
      execute: f.execute,
    }));

    const result = await f.orchestrator.replan({ anchor: anchor(), instruction: '缩小影响范围' });

    expect(result).toMatchObject({ status: 'awaiting_plan_review', identity: { stageRevision: 2 } });
    expect(f.prepare.mock.calls[1][0]).toMatchObject({
      previous: { revision: 1 }, reason: 'manual_replan', replanInstruction: '缩小影响范围',
    });
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.getEnvelope().stages[0]).toMatchObject({ status: 'awaiting_review', activeRevision: 2, revisions: [{ revision: 2, reason: 'manual_replan', replanInstruction: '缩小影响范围' }] });
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
    const f = fixture({
      planPreview: false,
      prepare: async () => ({ revision: revision(), execute }),
    });
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
