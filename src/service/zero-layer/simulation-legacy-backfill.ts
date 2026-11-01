import { sha256HexSync_ACU } from '../../shared/sha256-sync';
import { reconcileLedgerFieldViewWithLedger_ACU } from '../simulation/simulation-ledger-fold';
import { planWorldLegacyBackfill_ACU, legacyBackfillFingerprint_ACU } from '../simulation/world-legacy-backfill';
import { readCheckpointSimulationView_ACU } from './checkpoint-materials';
import { ZeroLayerError_ACU, type ZeroLayerEnvelope_ACU, type ZeroLayerSimulationState_ACU } from './model';
import { ZeroLayerSimulationStore_ACU } from './simulation-store';
import { getPublishedZeroLayerPath_ACU } from './timeline';

type LegacyBackfillPlan_ACU = ReturnType<typeof planWorldLegacyBackfill_ACU>;
type LegacyBackfillMarker_ACU = NonNullable<ZeroLayerSimulationState_ACU['legacyBackfill']>;

function canonicalJson_ACU(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson_ACU).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map(key =>
      `${JSON.stringify(key)}:${canonicalJson_ACU((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function ledgerFingerprint_ACU(ledger: unknown): string { return sha256HexSync_ACU(canonicalJson_ACU(ledger)); }

function assertBackfillIdle_ACU(source: ZeroLayerEnvelope_ACU, state: ZeroLayerSimulationState_ACU): void {
  if (state.envelope?.task?.activeRun) {
    throw new ZeroLayerError_ACU('effects-pending', '存在活动推演运行，不能补迁旧账本。');
  }
  if (source.turns.some(turn => !['published', 'failed', 'cancelled'].includes(turn.phase))) {
    throw new ZeroLayerError_ACU('pending-turn', '存在在途逻辑回合，不能补迁旧账本。');
  }
}

function sourceForLegacyBackfill_ACU(store: ZeroLayerSimulationStore_ACU) {
  const source = store.readSource();
  const state = store.readState();
  assertBackfillIdle_ACU(source, state);
  const view = store.readView();
  return { ledger: structuredClone(view.ledger), archive: structuredClone(view.archive) };
}

/** 只读预览资料；不迁移、不保存，也不从未确认回合推测基线。 */
export function readZeroLayerLegacyBackfillSource_ACU(store: ZeroLayerSimulationStore_ACU) {
  return sourceForLegacyBackfill_ACU(store);
}

function sameRef_ACU(left: ZeroLayerSimulationState_ACU['confirmed'][number]['ref'], right: ZeroLayerSimulationState_ACU['confirmed'][number]['ref']): boolean {
  return left.sessionId === right.sessionId && left.branchId === right.branchId
    && left.turnId === right.turnId && left.attemptId === right.attemptId && left.floorId === right.floorId;
}

function latestPublishedConfirmation_ACU(source: ZeroLayerEnvelope_ACU, state: ZeroLayerSimulationState_ACU) {
  const path = getPublishedZeroLayerPath_ACU(source);
  for (const turn of [...path].reverse()) {
    const confirmation = [...state.confirmed].reverse().find(item => item.ref.branchId === turn.branchId
      && item.ref.turnId === turn.turnId && item.ref.attemptId === turn.attemptId
      && item.ref.floorId === turn.assistantFloor.floorId && item.ref.sessionId === source.sessionId);
    if (confirmation) return confirmation;
  }
  return null;
}

function legacyBackfillMarker_ACU(
  source: ZeroLayerEnvelope_ACU,
  state: ZeroLayerSimulationState_ACU,
  ledger: { revision: number },
  nextLedger: { revision: number },
): LegacyBackfillMarker_ACU {
  const existing = state.legacyBackfill;
  if (existing && ledger.revision === existing.ledgerRevision
    && ledgerFingerprint_ACU(ledger) === existing.ledgerFingerprint) {
    return {
      sourceRef: existing.sourceRef === null ? null : structuredClone(existing.sourceRef),
      baseLedgerRevision: existing.baseLedgerRevision,
      baseLedgerFingerprint: existing.baseLedgerFingerprint,
      ledgerRevision: nextLedger.revision,
      ledgerFingerprint: ledgerFingerprint_ACU(nextLedger),
    };
  }
  const confirmation = latestPublishedConfirmation_ACU(source, state);
  // 确认回执是未来因果读取的唯一可追溯基底；工作账本已漂移时不能伪造其来源。
  if (confirmation && confirmation.ledgerRevision !== ledger.revision) {
    throw new ZeroLayerError_ACU('revision-conflict', '当前账本已超出最近已确认回执，请先完成一次推演再补迁。');
  }
  return {
    sourceRef: confirmation ? structuredClone(confirmation.ref) : null,
    baseLedgerRevision: ledger.revision,
    baseLedgerFingerprint: ledgerFingerprint_ACU(ledger),
    ledgerRevision: nextLedger.revision,
    ledgerFingerprint: ledgerFingerprint_ACU(nextLedger),
  };
}

/** 在既有 carrier 的 simulation 写队列内重新读取、核对预览指纹并保存补迁账本；不创建模型完成、回执或确认引用，历史回合及冻结资料均保持不变。 */
export async function commitZeroLayerLegacyBackfill_ACU(
  store: ZeroLayerSimulationStore_ACU,
  expectedFingerprint: string,
): Promise<LegacyBackfillPlan_ACU> {
  let result: LegacyBackfillPlan_ACU | null = null;
  await store.updateState((state, source) => {
    if (source.sessionId !== store.sessionId || source.activeBranchId !== store.branchId) {
      throw new ZeroLayerError_ACU('scope-changed', '补迁所属会话或分支已变化。');
    }
    assertBackfillIdle_ACU(source, state);
    if (!state.envelope) throw new ZeroLayerError_ACU('effects-pending', '逻辑推演账本尚未建立。');
    const view = readCheckpointSimulationView_ACU(source, state);
    if (!view.ledger) throw new ZeroLayerError_ACU('corrupt-data', '推演基线回放缺少账本。');
    if (legacyBackfillFingerprint_ACU(view.ledger, view.archive) !== expectedFingerprint) {
      throw new ZeroLayerError_ACU('revision-conflict', '旧账本补迁预览已过期，请重新读取。');
    }

    const planned = planWorldLegacyBackfill_ACU(view.ledger, view.archive);
    result = planned;
    if (!planned.changed) return;

    const now = Date.now();
    const nextEnvelope = { ...state.envelope, ledger: structuredClone(planned.ledger), updatedAt: now };
    if (nextEnvelope.task?.status === 'completed') {
      const task = { ...nextEnvelope.task };
      delete task.completedRun;
      delete task.completedAutoAnchor;
      nextEnvelope.task = task;
    }
    state.envelope = nextEnvelope;
    reconcileLedgerFieldViewWithLedger_ACU(state.fields, planned.ledger, now);
    state.runState = null;
    state.runProof = null;
    state.legacyBackfill = legacyBackfillMarker_ACU(source, state, view.ledger, planned.ledger);
  });
  if (!result) throw new ZeroLayerError_ACU('persist-unknown', '旧账本补迁未得到规划结果。');
  return result;
}
