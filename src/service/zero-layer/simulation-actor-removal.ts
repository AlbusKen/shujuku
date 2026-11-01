import { sha256HexSync_ACU } from '../../shared/sha256-sync';
import { reconcileLedgerFieldViewWithLedger_ACU } from '../simulation/simulation-ledger-fold';
import { removeWorldActor_ACU } from '../simulation/world-actor-removal';
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

const fingerprint_ACU = (ledger: unknown): string => sha256HexSync_ACU(canonical_ACU(ledger));

function assertIdle_ACU(source: ZeroLayerEnvelope_ACU, branchId: string, state: ZeroLayerSimulationState_ACU): void {
  if (source.turns.some(turn => turn.branchId === branchId
    && !['published', 'failed', 'cancelled'].includes(turn.phase))) {
    throw new ZeroLayerError_ACU('pending-turn', '当前回合正在进行，请结束后删除人物。');
  }
  if (state.envelope?.task?.activeRun && state.envelope.task.status !== 'paused') {
    throw new ZeroLayerError_ACU('effects-pending', '存在活动推演运行，不能删除人物。');
  }
}

function latestConfirmation_ACU(source: ZeroLayerEnvelope_ACU, state: ZeroLayerSimulationState_ACU) {
  for (const turn of [...getPublishedZeroLayerPath_ACU(source)].reverse()) {
    const item = state.confirmed.find(confirmed => confirmed.ref.sessionId === source.sessionId
      && confirmed.ref.branchId === turn.branchId && confirmed.ref.turnId === turn.turnId
      && confirmed.ref.attemptId === turn.attemptId && confirmed.ref.floorId === turn.assistantFloor.floorId);
    if (item) return item;
  }
  return null;
}

function removalSource_ACU(source: ZeroLayerEnvelope_ACU, state: ZeroLayerSimulationState_ACU,
  ledger: NonNullable<ZeroLayerSimulationState_ACU['envelope']>['ledger']) {
  const confirmation = latestConfirmation_ACU(source, state);
  if (confirmation) {
    const turn = source.turns.find(item => item.turnId === confirmation.ref.turnId)!;
    const receiptLedger = (turn.assistantFloor.data.simulation as { ledger?: unknown } | undefined)?.ledger;
    if (receiptLedger && confirmation.ledgerRevision === ledger.revision
      && fingerprint_ACU(receiptLedger) === fingerprint_ACU(ledger)) {
      return { sourceRef: structuredClone(confirmation.ref), baseLedgerRevision: ledger.revision,
        baseLedgerFingerprint: fingerprint_ACU(ledger) };
    }
  }
  const existing = [state.actorRemoval, state.actorImport, state.eventRemoval, state.historyRemoval, state.legacyBackfill].find(marker => marker
    && ledger.revision === marker.ledgerRevision && fingerprint_ACU(ledger) === marker.ledgerFingerprint);
  if (existing) {
    return { sourceRef: existing.sourceRef && structuredClone(existing.sourceRef),
      baseLedgerRevision: existing.baseLedgerRevision, baseLedgerFingerprint: existing.baseLedgerFingerprint };
  }
  const confirmed = confirmation;
  if (confirmed) {
    const turn = source.turns.find(item => item.turnId === confirmed.ref.turnId)!;
    const result = turn.assistantFloor.data.simulation as { ledger?: unknown } | undefined;
    const previous = state.legacyBackfill;
    const backfilled = previous?.sourceRef && canonical_ACU(previous.sourceRef) === canonical_ACU(confirmed.ref)
      && previous.baseLedgerRevision === confirmed.ledgerRevision
      && previous.baseLedgerFingerprint === fingerprint_ACU(result?.ledger)
      && previous.ledgerRevision === ledger.revision && previous.ledgerFingerprint === fingerprint_ACU(ledger);
    if (!result?.ledger || !backfilled && (confirmed.ledgerRevision !== ledger.revision
      || fingerprint_ACU(result.ledger) !== fingerprint_ACU(ledger))) {
      throw new ZeroLayerError_ACU('revision-conflict', '当前账本与最近已确认推演回执不一致，不能建立删除来源。');
    }
    if (backfilled) return { sourceRef: structuredClone(confirmed.ref),
      baseLedgerRevision: previous.baseLedgerRevision, baseLedgerFingerprint: previous.baseLedgerFingerprint };
  } else if (state.confirmed.length) {
    throw new ZeroLayerError_ACU('revision-conflict', '当前分支不存在可达的已确认删除来源。');
  }
  return { sourceRef: confirmed ? structuredClone(confirmed.ref) : null,
    baseLedgerRevision: ledger.revision, baseLedgerFingerprint: fingerprint_ACU(ledger) };
}

/** 在 carrier 原有保存队列内更新权威工作账本，不改写已发布回执或正文。 */
export async function deleteZeroLayerSimulationActor_ACU(
  store: ZeroLayerSimulationStore_ACU, actorId: string,
): Promise<void> {
  if (!actorId.trim()) throw new ZeroLayerError_ACU('invalid-transition', '删除人物需要有效身份。');
  const source = store.readSource();
  const state = store.readState();
  assertIdle_ACU(source, store.branchId, state);
  const before = store.readView().ledger;
  if (!before.actors.some(actor => actor.id === actorId)) {
    throw new ZeroLayerError_ACU('invalid-transition', '当前账本中没有该人物。');
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
    const nextLedger = removeWorldActor_ACU(view.ledger, actorId);
    const now = Date.now();
    const fields = structuredClone(current.fields);
    // 对账会保留非账本内仍有栏目的 partial 草稿，须只清掉被删人物的 ID 引用。
    delete fields.records.actors?.[actorId];
    for (const bucket of Object.values(fields.records)) {
      for (const row of Object.values(bucket ?? {})) {
        if (row.status !== 'partial') continue;
        for (const name of ['actorIds', 'relatedActorIds', 'relatedIds']) {
          const field = row.fields[name];
          if (!field || !Array.isArray(field.value) || !field.value.includes(actorId)) continue;
          field.value = field.value.filter(id => id !== actorId);
          field.revision += 1;
          field.updatedAt = now;
          row.updatedAt = now;
        }
      }
    }
    reconcileLedgerFieldViewWithLedger_ACU(fields, nextLedger, now);
    const task = current.envelope.task && { ...current.envelope.task };
    if (task?.status === 'paused') {
      task.status = 'abandoned';
      task.activeRun = null;
      task.updatedAt = now;
      task.stopReason = '人物已删除，旧推演运行作废';
      delete task.runMaterials;
    }
    current.envelope = { ...current.envelope, ledger: nextLedger, updatedAt: now, task };
    current.fields = fields;
    current.runState = null;
    current.runProof = null;
    current.actorRemoval = { ...base, ledgerRevision: nextLedger.revision,
      ledgerFingerprint: fingerprint_ACU(nextLedger) };
  });
}
