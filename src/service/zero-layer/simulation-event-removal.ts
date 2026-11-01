import { sha256HexSync_ACU } from '../../shared/sha256-sync';
import { reconcileLedgerFieldViewWithLedger_ACU } from '../simulation/simulation-ledger-fold';
import { removeWorldEvent_ACU } from '../simulation/world-event-removal';
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
    throw new ZeroLayerError_ACU('pending-turn', '当前回合正在进行，请结束后删除事件。');
  }
  if (state.envelope?.task?.activeRun && state.envelope.task.status !== 'paused') {
    throw new ZeroLayerError_ACU('effects-pending', '存在活动推演运行，不能删除事件。');
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
  const previous = [state.eventRemoval, state.historyRemoval, state.actorRemoval, state.actorImport, state.legacyBackfill].find(marker =>
    marker?.ledgerRevision === ledger.revision && marker.ledgerFingerprint === digest);
  if (previous) return { sourceRef: previous.sourceRef && structuredClone(previous.sourceRef),
    baseLedgerRevision: previous.baseLedgerRevision, baseLedgerFingerprint: previous.baseLedgerFingerprint };
  if (confirmation || state.confirmed.length) {
    throw new ZeroLayerError_ACU('revision-conflict', '当前账本与已确认推演来源不一致，不能删除事件。');
  }
  return { sourceRef: null, baseLedgerRevision: ledger.revision, baseLedgerFingerprint: digest };
}

/** 在 carrier 原有保存队列中删除事件，不改写已发布回执、正文及其他分支。 */
export async function deleteZeroLayerSimulationEvent_ACU(store: ZeroLayerSimulationStore_ACU, eventId: string): Promise<void> {
  if (!eventId.trim()) throw new ZeroLayerError_ACU('invalid-transition', '删除事件需要有效身份。');
  const source = store.readSource();
  const state = store.readState();
  assertIdle_ACU(source, store.branchId, state);
  const before = store.readView().ledger;
  if (!before.worldEvents.some(event => event.id === eventId)) {
    throw new ZeroLayerError_ACU('invalid-transition', '当前账本中没有该事件。');
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
    const next = removeWorldEvent_ACU(view.ledger, eventId);
    const now = Date.now();
    const fields = structuredClone(current.fields);
    for (const bucket of Object.values(fields.records)) {
      for (const row of Object.values(bucket ?? {})) {
        if (row.status !== 'partial') continue;
        for (const name of ['worldEventIds', 'relatedEventIds', ...(row.module === 'chronicle' ? ['relatedIds'] : [])]) {
          const field = row.fields[name];
          if (!field || !Array.isArray(field.value) || !field.value.includes(eventId)) continue;
          field.value = field.value.filter(id => id !== eventId);
          field.revision += 1;
          field.updatedAt = now;
          row.updatedAt = now;
        }
      }
    }
    reconcileLedgerFieldViewWithLedger_ACU(fields, next, now);
    const task = current.envelope.task && { ...current.envelope.task };
    if (task?.status === 'paused') {
      task.status = 'abandoned';
      task.activeRun = null;
      task.updatedAt = now;
      task.stopReason = '事件已删除，旧推演运行作废';
      delete task.runMaterials;
    }
    current.envelope = { ...current.envelope, ledger: next, updatedAt: now, task };
    current.fields = fields;
    current.runState = null;
    current.runProof = null;
    current.eventRemoval = { ...base, ledgerRevision: next.revision, ledgerFingerprint: fingerprint_ACU(next) };
  });
}
