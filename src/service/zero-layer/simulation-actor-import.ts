import { sha256HexSync_ACU } from '../../shared/sha256-sync';
import type { WorldActor_ACU } from '../simulation/model';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../simulation/defaults';
import { reconcileLedgerFieldViewWithLedger_ACU } from '../simulation/simulation-ledger-fold';
import { appendWorldActors_ACU } from '../simulation/world-actor-import';
import { readCheckpointSimulationView_ACU } from './checkpoint-materials';
import { ZeroLayerError_ACU, type ZeroLayerEnvelope_ACU, type ZeroLayerSimulationState_ACU } from './model';
import { ZeroLayerSimulationStore_ACU } from './simulation-store';
import { getPublishedZeroLayerPath_ACU } from './timeline';

function canonical_ACU(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical_ACU).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical_ACU(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
const fingerprint_ACU = (value: unknown): string => sha256HexSync_ACU(canonical_ACU(value));

function assertCurrent_ACU(options?: { signal?: AbortSignal; isCurrent?: () => boolean }): void {
  if (options?.signal?.aborted || options?.isCurrent?.() === false) {
    throw new ZeroLayerError_ACU('scope-changed', '人物入册已取消或当前会话已切换。');
  }
}

function assertIdle_ACU(source: ZeroLayerEnvelope_ACU, branchId: string, state: ZeroLayerSimulationState_ACU): void {
  if (source.turns.some(turn => turn.branchId === branchId
    && !['published', 'failed', 'cancelled'].includes(turn.phase))) {
    throw new ZeroLayerError_ACU('pending-turn', '当前回合正在进行，请结束后再入册人物。');
  }
  if (state.envelope?.task?.activeRun && state.envelope.task.status !== 'paused') {
    throw new ZeroLayerError_ACU('effects-pending', '存在活动推演运行，请结束后再入册人物。');
  }
}

function importSource_ACU(source: ZeroLayerEnvelope_ACU, state: ZeroLayerSimulationState_ACU,
  ledger: NonNullable<ZeroLayerSimulationState_ACU['envelope']>['ledger']) {
  const digest = fingerprint_ACU(ledger);
  const confirmation = [...getPublishedZeroLayerPath_ACU(source)].reverse().map(turn => state.confirmed.find(item =>
    item.ref.sessionId === source.sessionId && item.ref.branchId === turn.branchId && item.ref.turnId === turn.turnId
    && item.ref.attemptId === turn.attemptId && item.ref.floorId === turn.assistantFloor.floorId)).find(Boolean);
  if (confirmation) {
    const turn = source.turns.find(item => item.turnId === confirmation.ref.turnId)!;
    const receiptLedger = (turn.assistantFloor.data.simulation as { ledger?: unknown } | undefined)?.ledger;
    if (receiptLedger && confirmation.ledgerRevision === ledger.revision && fingerprint_ACU(receiptLedger) === digest) {
      return { sourceRef: structuredClone(confirmation.ref), baseLedgerRevision: ledger.revision,
        baseLedgerFingerprint: digest };
    }
  }
  const previous = [state.actorImport, state.actorRemoval, state.eventRemoval, state.historyRemoval, state.legacyBackfill].find(marker =>
    marker?.ledgerRevision === ledger.revision && marker.ledgerFingerprint === digest);
  if (previous) return { sourceRef: previous.sourceRef && structuredClone(previous.sourceRef),
    baseLedgerRevision: previous.baseLedgerRevision, baseLedgerFingerprint: previous.baseLedgerFingerprint };
  if (confirmation) {
    throw new ZeroLayerError_ACU('revision-conflict', '当前账本与最近已确认回执不一致，不能建立入册来源。');
  } else if (state.confirmed.length) {
    throw new ZeroLayerError_ACU('revision-conflict', '当前分支不存在可达的已确认入册来源。');
  }
  return { sourceRef: confirmation ? structuredClone(confirmation.ref) : null,
    baseLedgerRevision: ledger.revision, baseLedgerFingerprint: digest };
}

/** 在现有 carrier 保存队列中只追加新人物；不改历史回执、正文及其他分支。 */
export async function appendZeroLayerSimulationActors_ACU(
  store: ZeroLayerSimulationStore_ACU, actors: readonly WorldActor_ACU[],
  options?: { signal?: AbortSignal; isCurrent?: () => boolean },
): Promise<number> {
  assertCurrent_ACU(options);
  if (!actors.length) return 0;
  const input = structuredClone(actors);
  const snapshot = store.readSource();
  const state = store.readState();
  assertIdle_ACU(snapshot, store.branchId, state);
  const before = state.envelope ? store.readView().ledger : buildDefaultWorldSimulationEnvelope_ACU().ledger;
  if (appendWorldActors_ACU(before, input) === before) return 0;
  let added = 0;
  await store.updateState((state, source) => {
    assertCurrent_ACU(options);
    assertIdle_ACU(source, store.branchId, state);
    const envelope = state.envelope ?? buildDefaultWorldSimulationEnvelope_ACU();
    const view = state.envelope ? readCheckpointSimulationView_ACU(source, state) : { ledger: envelope.ledger };
    if (!view.ledger) throw new ZeroLayerError_ACU('corrupt-data', '推演基线回放缺少账本。');
    const next = appendWorldActors_ACU(view.ledger, input);
    added = next.actors.length - view.ledger.actors.length;
    if (!added) return;
    const base = importSource_ACU(source, state, view.ledger);
    const now = Date.now();
    const fields = structuredClone(state.fields);
    reconcileLedgerFieldViewWithLedger_ACU(fields, next, now);
    const task = envelope.task && { ...envelope.task };
    if (task?.status === 'paused') {
      task.status = 'abandoned';
      task.activeRun = null;
      task.updatedAt = now;
      task.stopReason = '人物已入册，旧推演运行作废';
      delete task.runMaterials;
    } else if (task?.status === 'completed') {
      delete task.completedRun;
      delete task.completedAutoAnchor;
    }
    assertCurrent_ACU(options);
    state.envelope = { ...envelope, ledger: next, updatedAt: now, task };
    state.fields = fields;
    state.runState = null;
    state.runProof = null;
    state.actorImport = { ...base, ledgerRevision: next.revision, ledgerFingerprint: fingerprint_ACU(next) };
  });
  return added;
}
