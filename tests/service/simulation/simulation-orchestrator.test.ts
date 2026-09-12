import { describe, expect, it, vi } from 'vitest';
import type {
  WorldSimulationLedgerRecord_ACU,
  WorldSimulationLeaseSnapshot_ACU,
  WorldSimulationSettlementInput_ACU,
  WorldSimulationSettlementLease_ACU,
  WorldStateSnapshot_ACU,
} from '../../../src/service/simulation/model';
import { WorldSimulationOrchestrator_ACU } from '../../../src/service/simulation/simulation-orchestrator';

function state(anchorMessageIndex: number): WorldStateSnapshot_ACU {
  return {
    anchorMessageIndex,
    storyClock: { anchorText: `第${anchorMessageIndex}日`, elapsedSinceLastRun: '一日', precision: 'approximate', evidenceIndexes: [anchorMessageIndex], updatedIndex: anchorMessageIndex },
    entities: [], events: [], threads: [], revisions: { entities: 0, events: 0, threads: 0 },
  };
}
function candidate(sourceAnchorMessageIndex: number) {
  return { sourceAnchorMessageIndex, state: state(sourceAnchorMessageIndex), sourceTransactions: [] };
}
function record(id: string, anchorMessageIndex: number): WorldSimulationLedgerRecord_ACU {
  return { version: 1, kind: 'checkpoint', id, anchorMessageIndex, state: state(anchorMessageIndex) };
}
function snapshot(
  anchorMessageIndex: number,
  overrides: Partial<WorldSimulationLeaseSnapshot_ACU> = {},
): WorldSimulationLeaseSnapshot_ACU {
  return {
    chatIdentity: 'chat-a',
    lineageKey: 'lineage-a',
    anchorMessageIndex,
    replayDigest: 'digest-a',
    revisions: { entities: 0, events: 0, threads: 0 },
    ...overrides,
  };
}
function settleNormally(input: WorldSimulationSettlementInput_ACU): WorldSimulationLedgerRecord_ACU {
  input.lease.beginCommit();
  return record(`settled-${input.targetAnchorMessageIndex}`, input.targetAnchorMessageIndex);
}
async function flush(): Promise<void> { for (let index = 0; index < 50; index += 1) await Promise.resolve(); }

describe('WorldSimulationOrchestrator_ACU', () => {
  it('does not settle on the candidate floor and only starts checking after a later floor', async () => {
    let leaseSnapshot = snapshot(11);
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const runner = vi.fn(async () => candidate(11));
    const settler = vi.fn(async (input: WorldSimulationSettlementInput_ACU) => { await waiting; return settleNormally(input); });
    const orchestrator = new WorldSimulationOrchestrator_ACU({ readLeaseSnapshot: () => leaseSnapshot, createRunId: () => 'run-a' });
    const completion = orchestrator.trigger(11, runner, settler);
    await flush();

    // The candidate floor itself must stay pending: r6 rebase requires target > source.
    expect(orchestrator.getPhase('chat-a')).toBe('candidate_pending');
    expect(settler).not.toHaveBeenCalled();
    expect(orchestrator.getSettlementPromise('chat-a')).toBeNull();

    // Re-observing the same floor must not start a quick round either.
    expect(orchestrator.trigger(11, vi.fn(), settler)).toBe(completion);
    await flush();
    expect(settler).not.toHaveBeenCalled();

    leaseSnapshot = snapshot(12);
    expect(orchestrator.trigger(12, vi.fn(), settler)).toBe(completion);
    expect(orchestrator.getPhase('chat-a')).toBe('checking');
    expect(orchestrator.getSettlementPromise('chat-a')).not.toBeNull();
    release();
    await expect(completion).resolves.toEqual(record('settled-12', 12));
    expect(settler).toHaveBeenCalledOnce();
    expect(settler.mock.calls[0]![0].targetAnchorMessageIndex).toBe(12);
    expect(orchestrator.getSettledTip('chat-a')).toBe(12);
  });

  it('revokes a checking lease on abandon so the stale receipt cannot commit and a later floor retries', async () => {
    let leaseSnapshot = snapshot(11);
    let capturedLease: WorldSimulationSettlementLease_ACU | null = null;
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const settler = vi.fn(async (input: WorldSimulationSettlementInput_ACU) => {
      if (input.targetAnchorMessageIndex === 12) {
        capturedLease = input.lease;
        await waiting;
      }
      return settleNormally(input);
    });
    const orchestrator = new WorldSimulationOrchestrator_ACU({ readLeaseSnapshot: () => leaseSnapshot, createRunId: () => 'run-a' });
    const completion = orchestrator.trigger(11, async () => candidate(11), settler);
    await flush();

    leaseSnapshot = snapshot(12);
    expect(orchestrator.trigger(12, vi.fn(), settler)).toBe(completion);
    await flush();
    expect(orchestrator.getPhase('chat-a')).toBe('checking');
    expect(capturedLease).not.toBeNull();
    expect(capturedLease!.isCurrent()).toBe(true);

    // Join timeout path: revoke the target before beginCommit so no save is staged.
    expect(orchestrator.abandonSettlement('chat-a')).toBe(true);
    expect(orchestrator.getPhase('chat-a')).toBe('candidate_pending');
    expect(capturedLease!.isCurrent()).toBe(false);
    release();
    await flush();
    expect(orchestrator.getSettledTip('chat-a')).toBeNull();

    // The next AI floor may launch exactly one fresh quick round.
    leaseSnapshot = snapshot(13);
    expect(orchestrator.trigger(13, vi.fn(), settler)).toBe(completion);
    await expect(completion).resolves.toEqual(record('settled-13', 13));
    expect(settler).toHaveBeenCalledTimes(2);
    expect(settler.mock.calls[1]![0].targetAnchorMessageIndex).toBe(13);
    expect(orchestrator.getSettledTip('chat-a')).toBe(13);
  });

  it('refuses to abandon a committing round that already staged a host save', async () => {
    let leaseSnapshot = snapshot(11);
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const settler = vi.fn(async (input: WorldSimulationSettlementInput_ACU) => {
      input.lease.beginCommit();
      if (input.targetAnchorMessageIndex === 12) await waiting;
      return record(`settled-${input.targetAnchorMessageIndex}`, input.targetAnchorMessageIndex);
    });
    const orchestrator = new WorldSimulationOrchestrator_ACU({ readLeaseSnapshot: () => leaseSnapshot, createRunId: () => 'run-a' });
    const completion = orchestrator.trigger(11, async () => candidate(11), settler);
    await flush();
    leaseSnapshot = snapshot(12);
    orchestrator.trigger(12, vi.fn(), settler);
    await flush();
    expect(orchestrator.getPhase('chat-a')).toBe('committing');

    // Past beginCommit the host save is not cancellable: abandon must report false.
    expect(orchestrator.abandonSettlement('chat-a')).toBe(false);
    expect(orchestrator.getPhase('chat-a')).toBe('committing');
    release();
    await expect(completion).resolves.toEqual(record('settled-12', 12));
    expect(orchestrator.getSettledTip('chat-a')).toBe(12);
  });

  it('keeps a failed candidate and retries only after a newer floor', async () => {
    let leaseSnapshot = snapshot(11);
    const settler = vi.fn(async (input: WorldSimulationSettlementInput_ACU) => {
      if (input.targetAnchorMessageIndex === 12) throw new Error('quick failed');
      return settleNormally(input);
    });
    const orchestrator = new WorldSimulationOrchestrator_ACU({ readLeaseSnapshot: () => leaseSnapshot, createRunId: () => 'run-a' });
    const pending = orchestrator.trigger(11, async () => candidate(11), settler);
    await flush();
    leaseSnapshot = snapshot(12);
    orchestrator.trigger(12, vi.fn(), settler);
    await flush();
    expect(orchestrator.getStatus('chat-a')).toMatchObject({ phase: 'candidate_pending', attemptedTargetAnchorMessageIndices: [12] });

    // The same target is never retried.
    expect(orchestrator.trigger(12, vi.fn(), settler)).toBe(pending);
    await flush();
    expect(settler).toHaveBeenCalledTimes(1);

    leaseSnapshot = snapshot(13);
    expect(orchestrator.trigger(13, vi.fn(), settler)).toBe(pending);
    await expect(pending).resolves.toEqual(record('settled-13', 13));
    expect(settler).toHaveBeenCalledTimes(2);
  });

  it('does not preempt a committing target and starts the queued newer flight only after it succeeds', async () => {
    let leaseSnapshot = snapshot(11);
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const runner = vi.fn(async (lease: { getMetadata: () => { initialAnchorMessageIndex: number } }) => candidate(lease.getMetadata().initialAnchorMessageIndex));
    const settler = vi.fn(async (input: WorldSimulationSettlementInput_ACU) => {
      input.lease.beginCommit();
      if (input.targetAnchorMessageIndex === 12) await waiting;
      return record(`settled-${input.targetAnchorMessageIndex}`, input.targetAnchorMessageIndex);
    });
    const orchestrator = new WorldSimulationOrchestrator_ACU({ readLeaseSnapshot: () => leaseSnapshot, createRunId: () => `run-${leaseSnapshot.anchorMessageIndex}` });
    const first = orchestrator.trigger(11, runner, settler);
    await flush();
    leaseSnapshot = snapshot(12);
    orchestrator.trigger(12, runner, settler);
    await flush();
    expect(orchestrator.getPhase('chat-a')).toBe('committing');

    leaseSnapshot = snapshot(13);
    expect(orchestrator.trigger(13, runner, settler)).toBe(first);
    expect(orchestrator.getFlightMetadata('chat-a')).toMatchObject({ targetAnchorMessageIndex: 12, latestObservedAnchorMessageIndex: 13 });
    release();
    await expect(first).resolves.toEqual(record('settled-12', 12));
    await flush();

    // The deferred successor starts at floor 13; its own candidate floor then stays pending.
    expect(runner).toHaveBeenCalledTimes(2);
    expect(orchestrator.getPhase('chat-a')).toBe('candidate_pending');
    leaseSnapshot = snapshot(14);
    const successor = orchestrator.getSettlementPromise('chat-a');
    expect(successor).toBeNull();
    orchestrator.trigger(14, runner, settler);
    await flush();
    expect(settler.mock.calls.map(call => call[0].targetAnchorMessageIndex)).toEqual([12, 14]);
  });

  it('retains an unknown committing flight after an invalid ledger response and refuses an automatic retry', async () => {
    let leaseSnapshot = snapshot(11);
    const orchestrator = new WorldSimulationOrchestrator_ACU({ readLeaseSnapshot: () => leaseSnapshot, createRunId: () => 'run-a' });
    const runner = vi.fn(async () => candidate(11));
    const pending = orchestrator.trigger(11, runner, async (input: WorldSimulationSettlementInput_ACU) => {
      input.lease.beginCommit();
      return { id: 'invalid' } as unknown as WorldSimulationLedgerRecord_ACU;
    });
    await flush();
    leaseSnapshot = snapshot(12);
    orchestrator.trigger(12, vi.fn(), vi.fn());
    await expect(pending).rejects.toMatchObject({ error: { code: 'WORLD_SIM_READ_FAILED' } });
    expect(orchestrator.getStatus('chat-a')).toMatchObject({ phase: 'committing', lastSettlementError: { error: { code: 'WORLD_SIM_READ_FAILED' } } });
    expect(orchestrator.trigger(12, vi.fn(), vi.fn())).toBe(pending);
    expect(runner).toHaveBeenCalledOnce();
    expect(orchestrator.getSettledTip('chat-a')).toBeNull();
  });

  it('keeps the observed settlement promise rejected when a committing host save fails', async () => {
    let leaseSnapshot = snapshot(11);
    const failure = new Error('WORLD_SIM_PERSIST_FAILED: host save rejected');
    const orchestrator = new WorldSimulationOrchestrator_ACU({ readLeaseSnapshot: () => leaseSnapshot, createRunId: () => 'run-a' });
    const completion = orchestrator.trigger(11, async () => candidate(11), async (input: WorldSimulationSettlementInput_ACU) => {
      input.lease.beginCommit();
      throw failure;
    });
    await flush();
    leaseSnapshot = snapshot(12);
    orchestrator.trigger(12, vi.fn(), vi.fn());
    await flush();

    const settlement = orchestrator.getSettlementPromise('chat-a');
    expect(settlement).not.toBeNull();
    await expect(settlement).rejects.toBe(failure);
    await expect(completion).rejects.toBe(failure);
    expect(orchestrator.getStatus('chat-a')).toMatchObject({ phase: 'committing', lastSettlementError: failure });
  });

  it('rejects a structurally valid ledger response whose anchor differs from the frozen target', async () => {
    let leaseSnapshot = snapshot(11);
    const orchestrator = new WorldSimulationOrchestrator_ACU({ readLeaseSnapshot: () => leaseSnapshot, createRunId: () => 'run-a' });
    const pending = orchestrator.trigger(11, async () => candidate(11), async (input: WorldSimulationSettlementInput_ACU) => {
      input.lease.beginCommit();
      return record('wrong-anchor', 10);
    });
    await flush();
    leaseSnapshot = snapshot(12);
    orchestrator.trigger(12, vi.fn(), vi.fn());
    await expect(pending).rejects.toMatchObject({ error: { code: 'WORLD_SIM_CONFLICT' } });
    expect(orchestrator.getSettledTip('chat-a')).toBeNull();
  });

  it('allows a checking target to be superseded before beginCommit and settles only the newer target', async () => {
    let leaseSnapshot = snapshot(11);
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const settler = vi.fn(async (input: WorldSimulationSettlementInput_ACU) => {
      if (input.targetAnchorMessageIndex === 12) await waiting;
      return settleNormally(input);
    });
    const orchestrator = new WorldSimulationOrchestrator_ACU({ readLeaseSnapshot: () => leaseSnapshot, createRunId: () => 'run-a' });
    const pending = orchestrator.trigger(11, async () => candidate(11), settler);
    await flush();
    leaseSnapshot = snapshot(12);
    orchestrator.trigger(12, vi.fn(), settler);
    await flush();
    expect(orchestrator.getPhase('chat-a')).toBe('checking');

    leaseSnapshot = snapshot(13);
    expect(orchestrator.trigger(13, vi.fn(), settler)).toBe(pending);
    release();
    await expect(pending).resolves.toEqual(record('settled-13', 13));
    expect(settler.mock.calls.map(call => call[0].targetAnchorMessageIndex)).toEqual([12, 13]);
  });

  it('fails closed when replay or module revisions change before beginCommit', async () => {
    let leaseSnapshot = snapshot(11);
    const orchestrator = new WorldSimulationOrchestrator_ACU({ readLeaseSnapshot: () => leaseSnapshot, createRunId: () => 'run-a' });
    const replayChanged = orchestrator.trigger(11, async () => candidate(11), async (input: WorldSimulationSettlementInput_ACU) => {
      leaseSnapshot = snapshot(12, { replayDigest: 'digest-b' });
      input.lease.beginCommit();
      return record('must-not-settle-replay', 12);
    });
    await flush();
    leaseSnapshot = snapshot(12);
    orchestrator.trigger(12, vi.fn(), vi.fn());
    await expect(replayChanged).rejects.toMatchObject({ error: { code: 'WORLD_SIM_STALE' } });
    expect(orchestrator.getSettledTip('chat-a')).toBeNull();

    leaseSnapshot = snapshot(21);
    const revisionsChanged = orchestrator.trigger(21, async () => candidate(21), async (input: WorldSimulationSettlementInput_ACU) => {
      leaseSnapshot = snapshot(22, { revisions: { entities: 1, events: 0, threads: 0 } });
      input.lease.beginCommit();
      return record('must-not-settle-revisions', 22);
    });
    await flush();
    leaseSnapshot = snapshot(22);
    orchestrator.trigger(22, vi.fn(), vi.fn());
    await expect(revisionsChanged).rejects.toMatchObject({ error: { code: 'WORLD_SIM_STALE' } });
    expect(orchestrator.getSettledTip('chat-a')).toBeNull();
  });

  it('queues a deferred successor only when the observed lease still matches after a lineage switch', async () => {
    let leaseSnapshot = snapshot(11);
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const runner = vi.fn(async (lease: { getMetadata: () => { initialAnchorMessageIndex: number } }) => candidate(lease.getMetadata().initialAnchorMessageIndex));
    let secondRun = 0;
    const settler = vi.fn(async (input: WorldSimulationSettlementInput_ACU) => {
      input.lease.beginCommit();
      secondRun += 1;
      if (secondRun === 1) await waiting;
      return record(`settled-${input.lease.getMetadata().lineageKey}`, input.targetAnchorMessageIndex);
    });
    const orchestrator = new WorldSimulationOrchestrator_ACU({ readLeaseSnapshot: () => leaseSnapshot, createRunId: () => `run-${leaseSnapshot.lineageKey}` });
    const first = orchestrator.trigger(11, runner, settler);
    await flush();
    leaseSnapshot = snapshot(12);
    orchestrator.trigger(12, runner, settler);
    await flush();
    expect(orchestrator.getPhase('chat-a')).toBe('committing');

    leaseSnapshot = snapshot(12, { lineageKey: 'lineage-b', replayDigest: 'digest-b', revisions: { entities: 1, events: 0, threads: 0 } });
    expect(orchestrator.trigger(12, runner, settler)).toBe(first);
    release();
    await expect(first).resolves.toEqual(record('settled-lineage-a', 12));
    await flush();

    const metadata = orchestrator.getFlightMetadata('chat-a');
    expect(metadata?.lineageKey).toBe('lineage-b');
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('drops a deferred successor when the observed chat lease no longer matches', async () => {
    let leaseSnapshot = snapshot(11);
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const runner = vi.fn(async (lease: { getMetadata: () => { initialAnchorMessageIndex: number } }) => candidate(lease.getMetadata().initialAnchorMessageIndex));
    let firstRun = 0;
    const settler = vi.fn(async (input: WorldSimulationSettlementInput_ACU) => {
      input.lease.beginCommit();
      firstRun += 1;
      if (firstRun === 1) await waiting;
      return record('settled-first', input.targetAnchorMessageIndex);
    });
    const orchestrator = new WorldSimulationOrchestrator_ACU({ readLeaseSnapshot: () => leaseSnapshot, createRunId: () => `run-${leaseSnapshot.anchorMessageIndex}` });
    const first = orchestrator.trigger(11, runner, settler);
    await flush();
    leaseSnapshot = snapshot(12);
    orchestrator.trigger(12, runner, settler);
    await flush();
    leaseSnapshot = snapshot(12, { lineageKey: 'lineage-b', replayDigest: 'digest-b', revisions: { entities: 1, events: 0, threads: 0 } });
    orchestrator.trigger(12, runner, settler);

    // A hard chat switch makes the queued successor ineligible.
    leaseSnapshot = snapshot(12, { chatIdentity: 'chat-b', lineageKey: 'lineage-c', replayDigest: 'digest-c' });
    release();
    await expect(first).resolves.toEqual(record('settled-first', 12));
    await flush();
    expect(runner).toHaveBeenCalledTimes(1);
    expect(settler).toHaveBeenCalledTimes(1);
  });

  it('keeps a committing flight live after new anchor, lineage, replay and revision observations', async () => {
    let leaseSnapshot = snapshot(11);
    let release!: () => void;
    let frozenLease: WorldSimulationSettlementLease_ACU | undefined;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const runner = vi.fn(async (lease: { getMetadata: () => { initialAnchorMessageIndex: number } }) => candidate(lease.getMetadata().initialAnchorMessageIndex));
    const settler = vi.fn(async (input: WorldSimulationSettlementInput_ACU) => {
      input.lease.beginCommit();
      if (input.targetAnchorMessageIndex === 12) {
        frozenLease = input.lease;
        await waiting;
      }
      return record(`settled-${input.targetAnchorMessageIndex}`, input.targetAnchorMessageIndex);
    });
    const orchestrator = new WorldSimulationOrchestrator_ACU({ readLeaseSnapshot: () => leaseSnapshot, createRunId: () => `run-${leaseSnapshot.anchorMessageIndex}` });
    const first = orchestrator.trigger(11, runner, settler);
    await flush();
    leaseSnapshot = snapshot(12);
    orchestrator.trigger(12, runner, settler);
    await flush();
    expect(orchestrator.getPhase('chat-a')).toBe('committing');

    // A frozen commit keeps its own lease even after the chat advances to a new branch.
    leaseSnapshot = snapshot(13, { lineageKey: 'lineage-b', replayDigest: 'digest-b', revisions: { entities: 1, events: 0, threads: 0 } });
    expect(orchestrator.trigger(13, runner, settler)).toBe(first);
    expect(frozenLease?.isCurrent()).toBe(true);
    release();
    await expect(first).resolves.toEqual(record('settled-12', 12));
    await flush();
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('hard-discards an in-flight candidate after a branch mutation so the next floor starts fresh', async () => {
    const leaseSnapshot = snapshot(11);
    const runner = vi.fn(async () => candidate(11));
    const orchestrator = new WorldSimulationOrchestrator_ACU({ readLeaseSnapshot: () => leaseSnapshot, createRunId: () => 'run-a' });
    const pending = orchestrator.trigger(11, runner, vi.fn());
    await flush();
    expect(orchestrator.getPhase('chat-a')).toBe('candidate_pending');

    // The candidate was built from a branch the user just replaced; it must never be re-anchored
    // onto the new one (an empty ledger keeps the same lineage token across a swipe switch).
    expect(orchestrator.discardFlight('chat-a')).toBe(true);
    await expect(pending).rejects.toMatchObject({ error: { code: 'WORLD_SIM_STALE' } });
    expect(orchestrator.getPhase('chat-a')).toBe('idle');

    const successor = orchestrator.trigger(11, runner, vi.fn());
    await flush();
    expect(successor).not.toBe(pending);
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('refuses to discard a committing flight because its host save is already staged', async () => {
    let leaseSnapshot = snapshot(11);
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const settler = vi.fn(async (input: WorldSimulationSettlementInput_ACU) => {
      input.lease.beginCommit();
      if (input.targetAnchorMessageIndex === 12) await waiting;
      return record(`settled-${input.targetAnchorMessageIndex}`, input.targetAnchorMessageIndex);
    });
    const orchestrator = new WorldSimulationOrchestrator_ACU({ readLeaseSnapshot: () => leaseSnapshot, createRunId: () => 'run-a' });
    const completion = orchestrator.trigger(11, async () => candidate(11), settler);
    await flush();
    leaseSnapshot = snapshot(12);
    orchestrator.trigger(12, vi.fn(), settler);
    await flush();
    expect(orchestrator.getPhase('chat-a')).toBe('committing');

    // Past beginCommit the host save is not cancellable, so the discard must report false.
    expect(orchestrator.discardFlight('chat-a')).toBe(false);
    expect(orchestrator.getPhase('chat-a')).toBe('committing');
    release();
    await expect(completion).resolves.toEqual(record('settled-12', 12));
  });

  it('reclaims only other-chat revocable flights and retains every committing flight', async () => {
    let leaseSnapshot = snapshot(11, { chatIdentity: 'chat-current' });
    const orchestrator = new WorldSimulationOrchestrator_ACU({ readLeaseSnapshot: () => leaseSnapshot, createRunId: () => `run-${leaseSnapshot.chatIdentity}` });
    const runner = vi.fn(async (lease: { getMetadata: () => { initialAnchorMessageIndex: number } }) => candidate(lease.getMetadata().initialAnchorMessageIndex));
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const committingSettler = vi.fn(async (input: WorldSimulationSettlementInput_ACU) => {
      input.lease.beginCommit();
      await waiting;
      return record(`settled-${input.targetAnchorMessageIndex}`, input.targetAnchorMessageIndex);
    });

    const current = orchestrator.trigger(11, runner, vi.fn());
    void current.catch(() => undefined);
    await flush();
    leaseSnapshot = snapshot(11, { chatIdentity: 'chat-other' });
    const other = orchestrator.trigger(11, runner, vi.fn());
    void other.catch(() => undefined);
    await flush();
    leaseSnapshot = snapshot(11, { chatIdentity: 'chat-committing' });
    const committing = orchestrator.trigger(11, runner, committingSettler);
    void committing.catch(() => undefined);
    await flush();
    leaseSnapshot = snapshot(12, { chatIdentity: 'chat-committing' });
    orchestrator.trigger(12, runner, committingSettler);
    await flush();
    expect(orchestrator.getPhase('chat-committing')).toBe('committing');

    expect(orchestrator.discardFlightsExcept('chat-current')).toBe(1);
    expect(orchestrator.getPhase('chat-current')).toBe('candidate_pending');
    expect(orchestrator.getPhase('chat-other')).toBe('idle');
    expect(orchestrator.getPhase('chat-committing')).toBe('committing');
    await expect(other).rejects.toMatchObject({ error: { code: 'WORLD_SIM_STALE' } });

    release();
    await expect(committing).resolves.toEqual(record('settled-12', 12));
  });
});
