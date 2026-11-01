import { sha256HexSync_ACU } from '../../shared/sha256-sync';
import { validateWorldSimulationLedger_ACU, validateWorldSimulationLogicalRef_ACU } from '../simulation/simulation-store';
import {
  WORLD_LEDGER_SCHEMA_VERSION_ACU,
  type WorldActor_ACU,
  type WorldEvent_ACU,
  type WorldFact_ACU,
  type WorldHistoryMilestone_ACU,
  type WorldSimulationLogicalRef_ACU,
} from '../simulation/model';
import { ZeroLayerError_ACU, type ZeroLayerSimulationState_ACU } from './model';

export interface ConfirmedSimulationCausalView_ACU {
  revision: number;
  source: WorldSimulationLogicalRef_ACU;
  worldEvents: WorldEvent_ACU[];
  actors: WorldActor_ACU[];
  historyMilestones: WorldHistoryMilestone_ACU[];
  facts: WorldFact_ACU[];
  fingerprint: string;
}

type ConfirmedRecord_ACU = { ref: WorldSimulationLogicalRef_ACU; ledgerRevision: number };

const REF_KEYS_ACU = ['sessionId', 'branchId', 'turnId', 'attemptId', 'floorId'] as const;

function record_ACU(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sameRef_ACU(left: WorldSimulationLogicalRef_ACU, right: WorldSimulationLogicalRef_ACU): boolean {
  return REF_KEYS_ACU.every(key => left[key] === right[key]);
}

function canonicalJson_ACU(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson_ACU).join(',')}]`;
  if (record_ACU(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson_ACU(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function reject_ACU(code: 'corrupt-data' | 'revision-conflict', message: string): never {
  throw new ZeroLayerError_ACU(code, message);
}

function validateConfirmed_ACU(raw: unknown): ConfirmedRecord_ACU[] {
  if (!Array.isArray(raw)) return reject_ACU('corrupt-data', '推演确认记录无效。');
  const refs = new Set<string>();
  const turnIds = new Set<string>();
  return raw.map(item => {
    if (!record_ACU(item) || Object.keys(item).length !== 2
      || !Object.prototype.hasOwnProperty.call(item, 'ref')
      || !Object.prototype.hasOwnProperty.call(item, 'ledgerRevision')) {
      return reject_ACU('corrupt-data', '推演确认记录无效。');
    }
    const ledgerRevision = item.ledgerRevision;
    if (typeof ledgerRevision !== 'number' || !Number.isSafeInteger(ledgerRevision) || ledgerRevision < 0) {
      return reject_ACU('corrupt-data', '推演确认记录无效。');
    }
    let ref: WorldSimulationLogicalRef_ACU;
    try {
      ref = validateWorldSimulationLogicalRef_ACU(item.ref, 'causalView.confirmed.ref', 'load');
    } catch {
      return reject_ACU('corrupt-data', '推演确认引用无效。');
    }
    const refKey = canonicalJson_ACU(ref);
    if (refs.has(refKey) || turnIds.has(ref.turnId)) {
      return reject_ACU('corrupt-data', '推演确认记录重复或冲突。');
    }
    refs.add(refKey);
    turnIds.add(ref.turnId);
    return { ref, ledgerRevision };
  });
}

/**
 * 为未来剧情 Agent 提供已确认账本的纯内部因果视图。
 * 不读取正文、projection 或任何 UI 状态，也不写入 state。
 */
export function buildConfirmedSimulationCausalView_ACU(
  state: ZeroLayerSimulationState_ACU,
  ref: WorldSimulationLogicalRef_ACU,
  ledgerRevision: number,
): ConfirmedSimulationCausalView_ACU {
  if (!Number.isSafeInteger(ledgerRevision) || ledgerRevision < 0) {
    return reject_ACU('revision-conflict', '请求的推演账本 revision 无效。');
  }
  let sourceRef: WorldSimulationLogicalRef_ACU;
  try {
    sourceRef = validateWorldSimulationLogicalRef_ACU(ref, 'causalView.ref', 'load');
  } catch {
    return reject_ACU('corrupt-data', '请求的逻辑引用无效。');
  }
  const confirmed = validateConfirmed_ACU(state.confirmed);
  const backfill = state.legacyBackfill;
  const maintained = backfill?.sourceRef && sameRef_ACU(backfill.sourceRef, sourceRef)
    && backfill.ledgerRevision === ledgerRevision
    && state.envelope?.ledger.revision === ledgerRevision
    && sha256HexSync_ACU(canonicalJson_ACU(state.envelope.ledger)) === backfill.ledgerFingerprint;
  const removal = state.actorRemoval;
  const removed = removal?.sourceRef && sameRef_ACU(removal.sourceRef, sourceRef)
    && removal.ledgerRevision === ledgerRevision
    && state.envelope?.ledger.revision === ledgerRevision
    && sha256HexSync_ACU(canonicalJson_ACU(state.envelope.ledger)) === removal.ledgerFingerprint;
  const imported = state.actorImport;
  const appended = imported?.sourceRef && sameRef_ACU(imported.sourceRef, sourceRef)
    && imported.ledgerRevision === ledgerRevision
    && state.envelope?.ledger.revision === ledgerRevision
    && sha256HexSync_ACU(canonicalJson_ACU(state.envelope.ledger)) === imported.ledgerFingerprint;
  const eventRemoval = state.eventRemoval;
  const eventRemoved = eventRemoval?.sourceRef && sameRef_ACU(eventRemoval.sourceRef, sourceRef)
    && eventRemoval.ledgerRevision === ledgerRevision
    && state.envelope?.ledger.revision === ledgerRevision
    && sha256HexSync_ACU(canonicalJson_ACU(state.envelope.ledger)) === eventRemoval.ledgerFingerprint;
  const historyRemoval = state.historyRemoval;
  const historyRemoved = historyRemoval?.sourceRef && sameRef_ACU(historyRemoval.sourceRef, sourceRef)
    && historyRemoval.ledgerRevision === ledgerRevision
    && state.envelope?.ledger.revision === ledgerRevision
    && sha256HexSync_ACU(canonicalJson_ACU(state.envelope.ledger)) === historyRemoval.ledgerFingerprint;
  const matches = confirmed.filter(item => item.ledgerRevision === (historyRemoved ? historyRemoval.baseLedgerRevision
    : eventRemoved ? eventRemoval.baseLedgerRevision
    : appended ? imported.baseLedgerRevision
    : removed ? removal.baseLedgerRevision
    : maintained ? backfill.baseLedgerRevision : ledgerRevision)
    && sameRef_ACU(item.ref, sourceRef));
  if (matches.length !== 1) {
    return reject_ACU(matches.length === 0 ? 'revision-conflict' : 'corrupt-data', '请求的逻辑引用没有唯一已确认账本。');
  }
  const envelope = state.envelope;
  if (!envelope || !record_ACU(envelope.ledger) || envelope.ledger.schemaVersion !== WORLD_LEDGER_SCHEMA_VERSION_ACU) {
    return reject_ACU('corrupt-data', '已确认账本版本或结构无效。');
  }
  if (envelope.ledger.revision !== ledgerRevision) {
    return reject_ACU('revision-conflict', '已确认逻辑引用不对应当前权威账本 revision。');
  }
  if (envelope.task?.status !== 'completed' || envelope.task.activeRun !== null) {
    return reject_ACU('revision-conflict', '推演任务尚未完成或仍有活动运行。');
  }

  let ledger;
  try {
    ledger = validateWorldSimulationLedger_ACU(envelope.ledger, 'load');
  } catch {
    return reject_ACU('corrupt-data', '已确认账本校验失败。');
  }

  const source = structuredClone(matches[0].ref);
  const worldEvents = structuredClone(ledger.worldEvents);
  const actors = structuredClone(ledger.actors);
  const historyMilestones = structuredClone([...ledger.historyMilestones, ...(ledger.historyArchive ?? [])]);
  const facts = structuredClone([...ledger.facts, ...(ledger.factArchive ?? [])]);
  const fingerprint = sha256HexSync_ACU(canonicalJson_ACU({
    revision: ledgerRevision,
    ref: source,
    worldEvents,
    actors,
    historyMilestones,
    facts,
  }));
  return { revision: ledgerRevision, source, worldEvents, actors, historyMilestones, facts, fingerprint };
}
