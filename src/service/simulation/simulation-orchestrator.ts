import {
  createWorldSimError_ACU,
  isWorldModuleRevisions_ACU,
  isWorldStateSnapshot_ACU,
  WorldSimulationValidationError_ACU,
  type WorldSimulationLedgerRecord_ACU,
  type WorldSimulationTransaction_ACU,
  type WorldModuleRevisions_ACU,
  type WorldStateSnapshot_ACU,
} from './model';
import { parseWorldSimulationLedgerRecord_ACU } from './simulation-replay';

export type WorldSimulationPhase_ACU = 'idle' | 'simulating' | 'candidate_pending' | 'checking' | 'committing';

export interface WorldSimulationLeaseSnapshot_ACU {
  chatIdentity: string;
  /** Stable active-swipe lineage token supplied by the runtime Adapter. */
  lineageKey: string;
  anchorMessageIndex: number;
  replayDigest: string | null;
  revisions: WorldModuleRevisions_ACU;
}

export interface WorldSimulationFlightMetadata_ACU {
  runId: string;
  chatIdentity: string;
  lineageKey: string;
  initialAnchorMessageIndex: number;
  targetAnchorMessageIndex: number;
  latestObservedAnchorMessageIndex: number;
  coverageStartMessageIndex: number;
  coverageEndMessageIndex: number;
  replayDigest: string | null;
  revisions: WorldModuleRevisions_ACU;
  foldCount: number;
}

export interface WorldSimulationOrchestrationCandidate_ACU {
  sourceAnchorMessageIndex: number;
  state: WorldStateSnapshot_ACU;
  sourceTransactions: readonly WorldSimulationTransaction_ACU[];
}

export interface WorldSimulationLease_ACU {
  runId: string;
  isCurrent: () => boolean;
  getMetadata: () => WorldSimulationFlightMetadata_ACU;
}

export interface WorldSimulationSettlementLease_ACU extends WorldSimulationLease_ACU {
  beginCommit: () => void;
}

export interface WorldSimulationSettlementInput_ACU {
  candidate: WorldSimulationOrchestrationCandidate_ACU;
  targetAnchorMessageIndex: number;
  metadata: WorldSimulationFlightMetadata_ACU;
  lease: WorldSimulationSettlementLease_ACU;
}

export interface WorldSimulationOrchestratorStatus_ACU {
  phase: WorldSimulationPhase_ACU;
  metadata: WorldSimulationFlightMetadata_ACU;
  attemptedTargetAnchorMessageIndices: readonly number[];
  lastSettlementError: unknown | null;
}

export interface WorldSimulationOrchestratorDependencies_ACU {
  readLeaseSnapshot: () => WorldSimulationLeaseSnapshot_ACU;
  createRunId: () => string;
}

export type WorldSimulationCandidateRunner_ACU = (lease: WorldSimulationLease_ACU) => Promise<WorldSimulationOrchestrationCandidate_ACU>;
export type WorldSimulationCandidateSettler_ACU = (input: WorldSimulationSettlementInput_ACU) => Promise<WorldSimulationLedgerRecord_ACU>;

type DeferredTrigger_ACU = { snapshot: WorldSimulationLeaseSnapshot_ACU; runner: WorldSimulationCandidateRunner_ACU; settler: WorldSimulationCandidateSettler_ACU };

type Flight_ACU = {
  metadata: WorldSimulationFlightMetadata_ACU;
  sourceMetadata: WorldSimulationFlightMetadata_ACU;
  phase: Exclude<WorldSimulationPhase_ACU, 'idle'>;
  runner: WorldSimulationCandidateRunner_ACU;
  settler: WorldSimulationCandidateSettler_ACU;
  candidate: WorldSimulationOrchestrationCandidate_ACU | null;
  attemptedTargets: Set<number>;
  lastSettlementError: unknown | null;
  committingTargetAnchorMessageIndex: number | null;
  commitLeaseSnapshot: WorldSimulationLeaseSnapshot_ACU | null;
  settlementEpoch: number;
  committingSettlementEpoch: number | null;
  deferredTrigger: DeferredTrigger_ACU | null;
  settlement: Promise<void> | null;
  completion: Promise<WorldSimulationLedgerRecord_ACU>;
  resolve: (record: WorldSimulationLedgerRecord_ACU) => void;
  reject: (error: unknown) => void;
};

type SettledTip_ACU = { lineageKey: string; anchorMessageIndex: number };

function cloneMetadata_ACU(metadata: WorldSimulationFlightMetadata_ACU): WorldSimulationFlightMetadata_ACU {
  return { ...metadata, revisions: { ...metadata.revisions } };
}

function cloneLeaseSnapshot_ACU(snapshot: WorldSimulationLeaseSnapshot_ACU): WorldSimulationLeaseSnapshot_ACU {
  return { ...snapshot, revisions: { ...snapshot.revisions } };
}

function stale_ACU(message: string, details?: Record<string, unknown>): never {
  throw new WorldSimulationValidationError_ACU(createWorldSimError_ACU('WORLD_SIM_STALE', 'orchestrate', message, false, details));
}

function validSnapshot_ACU(value: WorldSimulationLeaseSnapshot_ACU): boolean {
  return typeof value?.chatIdentity === 'string' && !!value.chatIdentity.trim()
    && typeof value.lineageKey === 'string' && !!value.lineageKey.trim()
    && Number.isInteger(value.anchorMessageIndex) && value.anchorMessageIndex >= 0
    && (value.replayDigest === null || typeof value.replayDigest === 'string') && isWorldModuleRevisions_ACU(value.revisions);
}

function sameRevisions_ACU(left: WorldModuleRevisions_ACU, right: WorldModuleRevisions_ACU): boolean {
  return left.entities === right.entities && left.events === right.events && left.threads === right.threads;
}

function sameLeaseSnapshot_ACU(left: WorldSimulationLeaseSnapshot_ACU, right: WorldSimulationLeaseSnapshot_ACU): boolean {
  return left.chatIdentity === right.chatIdentity && left.lineageKey === right.lineageKey
    && left.anchorMessageIndex === right.anchorMessageIndex && left.replayDigest === right.replayDigest
    && sameRevisions_ACU(left.revisions, right.revisions);
}

function validCandidate_ACU(candidate: WorldSimulationOrchestrationCandidate_ACU, sourceAnchor: number): boolean {
  return !!candidate && candidate.sourceAnchorMessageIndex === sourceAnchor && candidate.state?.anchorMessageIndex === sourceAnchor
    && Array.isArray(candidate.sourceTransactions) && candidate.sourceTransactions.every(item => item?.anchorMessageIndex === sourceAnchor);
}

/** Per-chat single-candidate coordinator. It owns lifecycle leases, never persistence payloads. */
export class WorldSimulationOrchestrator_ACU {
  private readonly flights = new Map<string, Flight_ACU>();
  private readonly settledTips = new Map<string, SettledTip_ACU>();

  constructor(private readonly dependencies: WorldSimulationOrchestratorDependencies_ACU) {}

  getFlightMetadata(chatIdentity: string): WorldSimulationFlightMetadata_ACU | null {
    const flight = this.flights.get(chatIdentity);
    return flight ? cloneMetadata_ACU(flight.metadata) : null;
  }

  getStatus(chatIdentity: string): WorldSimulationOrchestratorStatus_ACU | null {
    const flight = this.flights.get(chatIdentity);
    return flight ? {
      phase: flight.phase,
      metadata: cloneMetadata_ACU(flight.metadata),
      attemptedTargetAnchorMessageIndices: [...flight.attemptedTargets].sort((left, right) => left - right),
      lastSettlementError: flight.lastSettlementError,
    } : null;
  }

  getSettledTip(chatIdentity: string): number | null {
    return this.settledTips.get(chatIdentity)?.anchorMessageIndex ?? null;
  }

  trigger(targetAnchorMessageIndex: number, runner: WorldSimulationCandidateRunner_ACU, settler: WorldSimulationCandidateSettler_ACU): Promise<WorldSimulationLedgerRecord_ACU> {
    const snapshot = this.dependencies.readLeaseSnapshot();
    return this.triggerWithinSnapshot_ACU(snapshot, targetAnchorMessageIndex, runner, settler);
  }

  private triggerWithinSnapshot_ACU(snapshot: WorldSimulationLeaseSnapshot_ACU, targetAnchorMessageIndex: number, runner: WorldSimulationCandidateRunner_ACU, settler: WorldSimulationCandidateSettler_ACU): Promise<WorldSimulationLedgerRecord_ACU> {
    if (!validSnapshot_ACU(snapshot) || !Number.isInteger(targetAnchorMessageIndex) || targetAnchorMessageIndex < 0
      || targetAnchorMessageIndex !== snapshot.anchorMessageIndex || typeof runner !== 'function' || typeof settler !== 'function') {
      stale_ACU('世界推演触发时聊天身份、锚点或回调非法');
    }
    const settledTip = this.settledTips.get(snapshot.chatIdentity);
    if (settledTip?.lineageKey === snapshot.lineageKey && targetAnchorMessageIndex <= settledTip.anchorMessageIndex) {
      stale_ACU('世界推演触发锚点未晚于当前已结算 tip', { targetAnchorMessageIndex, settledTip: settledTip.anchorMessageIndex });
    }
    const existing = this.flights.get(snapshot.chatIdentity);
    if (existing) {
      if (existing.phase === 'committing') {
        existing.metadata.coverageStartMessageIndex = Math.min(existing.metadata.coverageStartMessageIndex, targetAnchorMessageIndex);
        existing.metadata.coverageEndMessageIndex = Math.max(existing.metadata.coverageEndMessageIndex, targetAnchorMessageIndex);
        existing.metadata.latestObservedAnchorMessageIndex = Math.max(existing.metadata.latestObservedAnchorMessageIndex, targetAnchorMessageIndex);
        existing.metadata.foldCount += 1;
        const commitLease = existing.commitLeaseSnapshot;
        if (existing.lastSettlementError === null && commitLease
          && (targetAnchorMessageIndex > (existing.committingTargetAnchorMessageIndex ?? -1) || !sameLeaseSnapshot_ACU(snapshot, commitLease))) {
          existing.deferredTrigger = { snapshot: cloneLeaseSnapshot_ACU(snapshot), runner, settler };
        }
        return existing.completion;
      }
      if (!this.sourceCurrent_ACU(existing)) {
        this.failFlight_ACU(existing, new WorldSimulationValidationError_ACU(createWorldSimError_ACU('WORLD_SIM_STALE', 'orchestrate', '世界推演分支已变化，丢弃主候选', false)));
      } else {
        existing.metadata.coverageStartMessageIndex = Math.min(existing.metadata.coverageStartMessageIndex, targetAnchorMessageIndex);
        existing.metadata.coverageEndMessageIndex = Math.max(existing.metadata.coverageEndMessageIndex, targetAnchorMessageIndex);
        existing.metadata.latestObservedAnchorMessageIndex = Math.max(existing.metadata.latestObservedAnchorMessageIndex, targetAnchorMessageIndex);
        existing.metadata.foldCount += 1;
        existing.metadata.targetAnchorMessageIndex = Math.max(existing.metadata.targetAnchorMessageIndex, targetAnchorMessageIndex);
        if (existing.phase === 'candidate_pending') this.scheduleSettlement_ACU(existing);
        return existing.completion;
      }
    }

    const runId = this.dependencies.createRunId();
    if (typeof runId !== 'string' || !runId.trim()) stale_ACU('世界推演 runId 非法');
    const metadata: WorldSimulationFlightMetadata_ACU = {
      runId, chatIdentity: snapshot.chatIdentity, lineageKey: snapshot.lineageKey, initialAnchorMessageIndex: targetAnchorMessageIndex,
      targetAnchorMessageIndex, latestObservedAnchorMessageIndex: targetAnchorMessageIndex,
      coverageStartMessageIndex: targetAnchorMessageIndex, coverageEndMessageIndex: targetAnchorMessageIndex,
      replayDigest: snapshot.replayDigest, revisions: { ...snapshot.revisions }, foldCount: 0,
    };
    let resolve!: (record: WorldSimulationLedgerRecord_ACU) => void;
    let reject!: (error: unknown) => void;
    const completion = new Promise<WorldSimulationLedgerRecord_ACU>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
    void completion.catch((): void => undefined);
    const flight: Flight_ACU = {
      metadata, sourceMetadata: cloneMetadata_ACU(metadata), phase: 'simulating', runner, settler, candidate: null,
      attemptedTargets: new Set(), lastSettlementError: null, committingTargetAnchorMessageIndex: null,
      commitLeaseSnapshot: null, settlementEpoch: 0, committingSettlementEpoch: null, deferredTrigger: null,
      settlement: null, completion, resolve, reject,
    };
    this.flights.set(snapshot.chatIdentity, flight);
    void this.runMain_ACU(flight);
    return completion;
  }

  getPhase(chatIdentity: string): WorldSimulationPhase_ACU {
    return this.flights.get(chatIdentity)?.phase ?? 'idle';
  }

  getSettlementPromise(chatIdentity: string): Promise<void> | null {
    return this.flights.get(chatIdentity)?.settlement ?? null;
  }

  /**
   * Invalidates a quick round that has not yet passed `beginCommit()`, so a join
   * timeout can revoke its target before any host save is attempted. A round that
   * already entered `committing` is past the point of no return: the host save is
   * not cancellable, so this returns `false` instead of pretending the staged
   * ledger entry was revoked. A superseded candidate may still be re-checked once
   * a later AI floor arrives.
   */
  abandonSettlement(chatIdentity: string): boolean {
    const flight = this.flights.get(chatIdentity);
    if (!flight || (flight.phase !== 'candidate_pending' && flight.phase !== 'checking')) return false;
    flight.settlementEpoch += 1;
    flight.phase = 'candidate_pending';
    flight.settlement = null;
    flight.lastSettlementError = null;
    return true;
  }

  /**
   * Hard-discards an in-flight flight after an external branch mutation (swipe / message delete /
   * chat switch). Unlike {@link abandonSettlement}, the frozen candidate is not kept for a later
   * retry: the branch it was built from no longer exists, so the next AI floor must start a fresh
   * gate + main flight. A round already inside `committing` is past the point of no return and
   * reports `false` so the caller never claims a revocation that did not happen.
   */
  discardFlight(chatIdentity: string): boolean {
    const flight = this.flights.get(chatIdentity);
    if (!flight || flight.phase === 'committing') return false;
    this.failFlight_ACU(flight, new WorldSimulationValidationError_ACU(createWorldSimError_ACU(
      'WORLD_SIM_STALE', 'orchestrate', '世界推演分支已被外部改写，丢弃在飞候选', false,
      { chatIdentity, phase: flight.phase },
    )));
    return true;
  }

  /**
   * Reclaims every flight whose chat identity is no longer the active one. The identity is derived
   * from the live host chat id, so after a chat switch the previous key can never be observed again;
   * without this sweep that flight would linger for the rest of the session. A `committing` flight
   * is left alone because its host save is already staged.
   */
  discardFlightsExcept(chatIdentity: string): number {
    let discarded = 0;
    for (const [key, flight] of [...this.flights]) {
      if (key === chatIdentity || flight.phase === 'committing') continue;
      this.failFlight_ACU(flight, new WorldSimulationValidationError_ACU(createWorldSimError_ACU(
        'WORLD_SIM_STALE', 'orchestrate', '世界推演聊天已切换，回收上一聊天的在飞候选', false,
        { chatIdentity: key, phase: flight.phase },
      )));
      discarded += 1;
    }
    return discarded;
  }

  private sourceCurrent_ACU(flight: Flight_ACU): boolean {
    try {
      const current = this.dependencies.readLeaseSnapshot();
      const source = flight.sourceMetadata;
      return validSnapshot_ACU(current) && this.flights.get(source.chatIdentity) === flight
        && current.chatIdentity === source.chatIdentity && current.lineageKey === source.lineageKey
        && current.anchorMessageIndex >= source.initialAnchorMessageIndex
        && current.replayDigest === source.replayDigest && sameRevisions_ACU(current.revisions, source.revisions);
    } catch (_) {
      return false;
    }
  }

  private settlementCurrent_ACU(flight: Flight_ACU, targetAnchorMessageIndex: number, epoch: number): boolean {
    return this.sourceCurrent_ACU(flight) && flight.phase === 'checking'
      && flight.metadata.targetAnchorMessageIndex === targetAnchorMessageIndex
      && flight.settlementEpoch === epoch;
  }

  private committingContextCurrent_ACU(flight: Flight_ACU, targetAnchorMessageIndex: number, epoch: number): boolean {
    return flight.commitLeaseSnapshot !== null
      && this.flights.get(flight.metadata.chatIdentity) === flight
      && flight.phase === 'committing'
      && flight.committingTargetAnchorMessageIndex === targetAnchorMessageIndex
      && flight.committingSettlementEpoch === epoch;
  }

  private sourceLease_ACU(flight: Flight_ACU): WorldSimulationLease_ACU {
    return {
      runId: flight.sourceMetadata.runId,
      isCurrent: () => this.sourceCurrent_ACU(flight) && flight.phase === 'simulating',
      getMetadata: () => cloneMetadata_ACU(flight.sourceMetadata),
    };
  }

  private captureCommitLeaseSnapshot_ACU(flight: Flight_ACU, targetAnchorMessageIndex: number, epoch: number): WorldSimulationLeaseSnapshot_ACU {
    if (!this.settlementCurrent_ACU(flight, targetAnchorMessageIndex, epoch)) {
      return stale_ACU('世界推演候选提交租约已失效', { targetAnchorMessageIndex });
    }
    const current = this.dependencies.readLeaseSnapshot();
    const source = flight.sourceMetadata;
    if (!validSnapshot_ACU(current) || current.chatIdentity !== source.chatIdentity || current.lineageKey !== source.lineageKey
      || current.anchorMessageIndex !== targetAnchorMessageIndex || current.replayDigest !== source.replayDigest
      || !sameRevisions_ACU(current.revisions, source.revisions)) {
      return stale_ACU('世界推演候选提交前完整租约已变化', { targetAnchorMessageIndex });
    }
    return cloneLeaseSnapshot_ACU(current);
  }

  private settlementLease_ACU(flight: Flight_ACU, targetAnchorMessageIndex: number): WorldSimulationSettlementLease_ACU {
    const epoch = flight.settlementEpoch;
    return {
      runId: flight.metadata.runId,
      isCurrent: () => this.settlementCurrent_ACU(flight, targetAnchorMessageIndex, epoch)
        || this.committingContextCurrent_ACU(flight, targetAnchorMessageIndex, epoch),
      getMetadata: () => cloneMetadata_ACU(flight.metadata),
      beginCommit: () => {
        flight.commitLeaseSnapshot = this.captureCommitLeaseSnapshot_ACU(flight, targetAnchorMessageIndex, epoch);
        flight.phase = 'committing';
        flight.committingTargetAnchorMessageIndex = targetAnchorMessageIndex;
        flight.committingSettlementEpoch = epoch;
      },
    };
  }

  private async runMain_ACU(flight: Flight_ACU): Promise<void> {
    try {
      const candidate = await flight.runner(this.sourceLease_ACU(flight));
      if (!this.sourceCurrent_ACU(flight)) stale_ACU('世界推演主候选完成时源分支已变化', { runId: flight.metadata.runId });
      if (!validCandidate_ACU(candidate, flight.sourceMetadata.initialAnchorMessageIndex) || !isWorldStateSnapshot_ACU(candidate.state)) {
        stale_ACU('世界推演主候选未与原始锚点或事务对齐', { runId: flight.metadata.runId });
      }
      flight.candidate = candidate;
      flight.phase = 'candidate_pending';
      this.scheduleSettlement_ACU(flight);
    } catch (error) {
      this.failFlight_ACU(flight, error);
    }
  }

  private scheduleSettlement_ACU(flight: Flight_ACU): void {
    if (this.flights.get(flight.metadata.chatIdentity) !== flight || !flight.candidate || flight.phase !== 'candidate_pending') return;
    const targetAnchorMessageIndex = flight.metadata.targetAnchorMessageIndex;
    // r6 rebase is intentionally strict: a candidate cannot be rebased onto the
    // same AI floor that produced it. Keep it pending until a later floor arrives.
    if (targetAnchorMessageIndex <= flight.candidate.sourceAnchorMessageIndex) return;
    if (flight.attemptedTargets.has(targetAnchorMessageIndex)) return;
    flight.attemptedTargets.add(targetAnchorMessageIndex);
    flight.phase = 'checking';
    flight.lastSettlementError = null;
    const settlement = this.runSettlement_ACU(flight, targetAnchorMessageIndex);
    flight.settlement = settlement;
    void settlement.catch((): void => undefined);
  }

  private async runSettlement_ACU(flight: Flight_ACU, targetAnchorMessageIndex: number): Promise<void> {
    const lease = this.settlementLease_ACU(flight, targetAnchorMessageIndex);
    const epoch = flight.settlementEpoch;
    try {
      const record = await flight.settler({
        candidate: flight.candidate!, targetAnchorMessageIndex, metadata: cloneMetadata_ACU(flight.metadata), lease,
      });
      if (flight.settlementEpoch !== epoch) {
        // Abandoned while the settler was still running: it never reached
        // `beginCommit()`, so nothing was staged or persisted. Drop the callback
        // instead of accounting a commit that never happened.
        return;
      }
      if (flight.phase !== 'committing') {
        stale_ACU('世界推演结算回调未声明联合提交阶段', { targetAnchorMessageIndex });
      }
      const parsedRecord = parseWorldSimulationLedgerRecord_ACU(record, targetAnchorMessageIndex);
      if (parsedRecord.anchorMessageIndex !== targetAnchorMessageIndex) {
        throw new WorldSimulationValidationError_ACU(createWorldSimError_ACU('WORLD_SIM_CONFLICT', 'orchestrate', '世界推演结算回执锚点与冻结目标不一致', false, {
          expected: targetAnchorMessageIndex, actual: parsedRecord.anchorMessageIndex,
        }));
      }
      const commitLease = flight.commitLeaseSnapshot;
      if (!commitLease) stale_ACU('世界推演结算缺少冻结提交租约', { targetAnchorMessageIndex });
      this.settledTips.set(flight.metadata.chatIdentity, { lineageKey: commitLease.lineageKey, anchorMessageIndex: targetAnchorMessageIndex });
      if (this.flights.get(flight.metadata.chatIdentity) === flight) this.flights.delete(flight.metadata.chatIdentity);
      flight.resolve(parsedRecord);
      this.startDeferredFlight_ACU(flight);
    } catch (error) {
      if (flight.settlementEpoch !== epoch) {
        // A superseded callback must not mutate flight state that a newer round
        // may already own.
        return;
      }
      if (flight.phase === 'committing' && flight.committingTargetAnchorMessageIndex === targetAnchorMessageIndex) {
        flight.lastSettlementError = error;
        flight.deferredTrigger = null;
        flight.reject(error);
        // `flight.settlement` is what the plot join gate observes. Do not turn a real
        // host-save failure into a resolved settlement merely because completion has
        // already been rejected above.
        throw error;
      }
      if (!this.sourceCurrent_ACU(flight)) {
        this.failFlight_ACU(flight, error instanceof WorldSimulationValidationError_ACU
          ? error
          : new WorldSimulationValidationError_ACU(createWorldSimError_ACU('WORLD_SIM_STALE', 'orchestrate', '世界推演结算失败后源分支已变化', false)));
      } else if (flight.metadata.targetAnchorMessageIndex !== targetAnchorMessageIndex) {
        this.handleObsoleteSettlement_ACU(flight, targetAnchorMessageIndex);
      } else {
        flight.phase = 'candidate_pending';
        flight.lastSettlementError = error;
      }
    }
  }

  private handleObsoleteSettlement_ACU(flight: Flight_ACU, targetAnchorMessageIndex: number): void {
    if (!this.sourceCurrent_ACU(flight)) {
      this.failFlight_ACU(flight, new WorldSimulationValidationError_ACU(createWorldSimError_ACU('WORLD_SIM_STALE', 'orchestrate', '世界推演结算时源分支已变化', false)));
      return;
    }
    if (flight.metadata.targetAnchorMessageIndex === targetAnchorMessageIndex) {
      flight.phase = 'candidate_pending';
      return;
    }
    flight.phase = 'candidate_pending';
    this.scheduleSettlement_ACU(flight);
  }

  private startDeferredFlight_ACU(flight: Flight_ACU): void {
    const deferred = flight.deferredTrigger;
    flight.deferredTrigger = null;
    if (!deferred) return;
    try {
      const current = this.dependencies.readLeaseSnapshot();
      // The preceding Store commit can legitimately advance replay digest and
      // module revisions. A deferred successor is a new main flight, so it is
      // bound to chat + active lineage + observed floor, then reads current state.
      if (!validSnapshot_ACU(current) || current.chatIdentity !== deferred.snapshot.chatIdentity
        || current.lineageKey !== deferred.snapshot.lineageKey || current.anchorMessageIndex < deferred.snapshot.anchorMessageIndex) return;
      const successor = this.triggerWithinSnapshot_ACU(current, current.anchorMessageIndex, deferred.runner, deferred.settler);
      void successor.catch((): void => undefined);
    } catch (_) {
      // The original completion event retains responsibility for retrying a
      // deferred flight when the observed chat or lineage is no longer current.
    }
  }

  private failFlight_ACU(flight: Flight_ACU, error: unknown): void {
    if (this.flights.get(flight.metadata.chatIdentity) === flight) this.flights.delete(flight.metadata.chatIdentity);
    flight.reject(error);
  }
}
