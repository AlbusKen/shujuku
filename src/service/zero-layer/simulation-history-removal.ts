import { sha256HexSync_ACU } from '../../shared/sha256-sync';
import { reconcileLedgerFieldViewWithLedger_ACU } from '../simulation/simulation-ledger-fold';
import { removeWorldHistoryMilestone_ACU } from '../simulation/world-history-removal';
import { readCheckpointSimulationView_ACU } from './checkpoint-materials';
import { ZeroLayerError_ACU, type ZeroLayerEnvelope_ACU, type ZeroLayerSimulationState_ACU } from './model';
import { ZeroLayerSimulationStore_ACU } from './simulation-store';
import { getPublishedZeroLayerPath_ACU } from './timeline';

function canonical_ACU(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical_ACU).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical_ACU(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
const fingerprint_ACU = (value: unknown): string => sha256HexSync_ACU(canonical_ACU(value));

function assertIdle_ACU(source: ZeroLayerEnvelope_ACU, branchId: string, state: ZeroLayerSimulationState_ACU): void {
  if (source.turns.some(turn => turn.branchId === branchId && !['published', 'failed', 'cancelled'].includes(turn.phase))) {
    throw new ZeroLayerError_ACU('pending-turn', '当前回合正在进行，请结束后删除重要历史。');
  }
  if (state.envelope?.task?.activeRun && state.envelope.task.status !== 'paused') {
    throw new ZeroLayerError_ACU('effects-pending', '存在活动推演运行，不能删除重要历史。');
  }
}

function removalSource_ACU(source: ZeroLayerEnvelope_ACU, state: ZeroLayerSimulationState_ACU,
  ledger: NonNullable<ZeroLayerSimulationState_ACU['envelope']>['ledger']) {
  const confirmation = [...getPublishedZeroLayerPath_ACU(source)].reverse().map(turn => state.confirmed.find(item =>
    item.ref.sessionId === source.sessionId && item.ref.branchId === turn.branchId && item.ref.turnId === turn.turnId
    && item.ref.attemptId === turn.attemptId && item.ref.floorId === turn.assistantFloor.floorId)).find(Boolean);
  const digest = fingerprint_ACU(ledger);
  if (confirmation) {
    const turn = source.turns.find(item => item.turnId === confirmation.ref.turnId)!;
    const receipt = (turn.assistantFloor.data.simulation as { ledger?: unknown } | undefined)?.ledger;
    if (receipt && confirmation.ledgerRevision === ledger.revision && fingerprint_ACU(receipt) === digest) {
      return { sourceRef: structuredClone(confirmation.ref), baseLedgerRevision: ledger.revision, baseLedgerFingerprint: digest };
    }
  }
  const previous = [state.historyRemoval, state.eventRemoval, state.actorRemoval, state.actorImport, state.legacyBackfill].find(marker =>
    marker?.ledgerRevision === ledger.revision && marker.ledgerFingerprint === digest);
  if (previous) return { sourceRef: previous.sourceRef && structuredClone(previous.sourceRef),
    baseLedgerRevision: previous.baseLedgerRevision, baseLedgerFingerprint: previous.baseLedgerFingerprint };
  if (confirmation || state.confirmed.length) {
    throw new ZeroLayerError_ACU('revision-conflict', '当前账本与已确认推演来源不一致，不能删除重要历史。');
  }
  return { sourceRef: null, baseLedgerRevision: ledger.revision, baseLedgerFingerprint: digest };
}

/** 在 carrier 原有保存队列中删除重要历史，不改写已发布回执、正文及其他分支。 */
export async function deleteZeroLayerSimulationHistory_ACU(store: ZeroLayerSimulationStore_ACU, historyId: string): Promise<void> {
  if (!historyId.trim()) throw new ZeroLayerError_ACU('invalid-transition', '删除重要历史需要有效身份。');
  const source = store.readSource();
  const state = store.readState();
  assertIdle_ACU(source, store.branchId, state);
  const before = store.readView().ledger;
  if (![...before.historyMilestones, ...(before.historyArchive ?? [])].some(item => item.id === historyId)) {
    throw new ZeroLayerError_ACU('invalid-transition', '当前账本中没有该重要历史。');
  }
  const beforeFingerprint = fingerprint_ACU(before);
  await store.updateState((current, live) => {
    assertIdle_ACU(live, store.branchId, current);
    if (!current.envelope) throw new ZeroLayerError_ACU('effects-pending', '逻辑推演账本尚未建立。');
    const view = readCheckpointSimulationView_ACU(live, current);
    if (!view.ledger || fingerprint_ACU(view.ledger) !== beforeFingerprint) {
      throw new ZeroLayerError_ACU('revision-conflict', '删除期间推演账本已变化。');
    }
    const base = removalSource_ACU(live, current, view.ledger);
    const next = removeWorldHistoryMilestone_ACU(view.ledger, historyId);
    const now = Date.now();
    const fields = structuredClone(current.fields);
    reconcileLedgerFieldViewWithLedger_ACU(fields, next, now);
    const task = current.envelope.task && { ...current.envelope.task };
    if (task?.status === 'paused') {
      task.status = 'abandoned';
      task.activeRun = null;
      task.updatedAt = now;
      task.stopReason = '重要历史已删除，旧推演运行作废';
      delete task.runMaterials;
    }
    current.envelope = { ...current.envelope, ledger: next, updatedAt: now, task };
    current.fields = fields;
    current.runState = null;
    current.runProof = null;
    current.historyRemoval = { ...base, ledgerRevision: next.revision, ledgerFingerprint: fingerprint_ACU(next) };
  });
}
