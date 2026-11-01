import { sha256HexSync_ACU } from '../../shared/sha256-sync';
import type { WorldSimulationLogicalRef_ACU } from '../simulation/model';
import type { ZeroLayerEnvelope_ACU, ZeroLayerSimulationResult_ACU, ZeroLayerSimulationState_ACU, ZeroLayerTurn_ACU } from './model';
import { ZeroLayerError_ACU } from './model';
import { checkpointPath_ACU } from './checkpoint-payload';
import { buildConfirmedSimulationCausalView_ACU, type ConfirmedSimulationCausalView_ACU } from './simulation-causal-view';
import { validateZeroLayerSimulationReceipt_ACU } from './simulation-validation';
import { validateZeroLayerEnvelope_ACU } from './validation';

const REF_KEYS_ACU = ['sessionId', 'branchId', 'turnId', 'attemptId', 'floorId'] as const;

function sameRef_ACU(left: WorldSimulationLogicalRef_ACU, right: WorldSimulationLogicalRef_ACU): boolean {
  return REF_KEYS_ACU.every(key => left[key] === right[key]);
}

function canonicalJson_ACU(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson_ACU).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson_ACU(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function reject_ACU(code: 'corrupt-data' | 'revision-conflict' | 'effects-pending', message: string): never {
  throw new ZeroLayerError_ACU(code, message);
}

function turnRef_ACU(source: ZeroLayerEnvelope_ACU, turn: ZeroLayerTurn_ACU): WorldSimulationLogicalRef_ACU {
  return {
    sessionId: source.sessionId,
    branchId: turn.branchId,
    turnId: turn.turnId,
    attemptId: turn.attemptId,
    floorId: turn.assistantFloor.floorId,
  };
}

function validateReceipt_ACU(turn: ZeroLayerTurn_ACU, sessionId: string): ZeroLayerSimulationResult_ACU {
  try {
    validateZeroLayerSimulationReceipt_ACU(turn, sessionId);
  } catch (error) {
    if (error instanceof ZeroLayerError_ACU) throw error;
    return reject_ACU('corrupt-data', '已发布祖先的推演回执损坏。');
  }
  return turn.assistantFloor.data.simulation as ZeroLayerSimulationResult_ACU;
}

/**
 * 仅为 prepared 回合读取开始前冻结的已确认推演资料。
 * 沿已发布可达父链越过合法配置跳过；提交过但不能匹配冻结账本的较近回合绝不回退借用旧资料。
 */
export function readPreparedSimulationCausalView_ACU(
  source: ZeroLayerEnvelope_ACU,
  turnId: string,
  attemptId: string,
): ConfirmedSimulationCausalView_ACU | null {
  const envelope = validateZeroLayerEnvelope_ACU(source);
  const branch = envelope.branches.find(item => item.branchId === envelope.activeBranchId);
  if (!branch) return reject_ACU('corrupt-data', '活动分支不存在。');

  const matches = envelope.turns.filter(turn => turn.turnId === turnId && turn.attemptId === attemptId);
  if (matches.length !== 1 || matches[0].branchId !== branch.branchId) {
    return reject_ACU('revision-conflict', 'prepared 回合、尝试或活动分支身份不匹配。');
  }
  const turn = matches[0];
  if (turn.phase !== 'prepared' || turn.body !== null || turn.parentTurnId !== branch.headTurnId) {
    return reject_ACU('revision-conflict', '目标不是当前活动分支上唯一的 prepared 回合。');
  }
  if (!Object.prototype.hasOwnProperty.call(turn, 'materialBaseline')) {
    return reject_ACU('effects-pending', 'prepared 回合缺少冻结的推演资料基底。');
  }

  const simulation = turn.materialBaseline!.simulation;
  if (simulation === null || simulation.envelope === null || simulation.confirmed.length === 0) return null;

  const reachablePath = checkpointPath_ACU(envelope, branch.branchId);
  const reachable = new Set(reachablePath.map(item => item.turnId));
  const turns = new Map(envelope.turns.map(item => [item.turnId, item]));
  const visited = new Set<string>();
  let ancestorId = turn.parentTurnId;
  while (ancestorId !== null) {
    if (visited.has(ancestorId)) return reject_ACU('corrupt-data', 'prepared 回合的已发布父链存在循环。');
    visited.add(ancestorId);

    const ancestor = turns.get(ancestorId);
    if (!ancestor || ancestor.phase !== 'published' || !reachable.has(ancestorId)) {
      return reject_ACU('corrupt-data', 'prepared 回合的父链不是已发布可达链。');
    }

    const result = validateReceipt_ACU(ancestor, envelope.sessionId);
    if (result.outcome === 'skipped-by-config') {
      ancestorId = ancestor.parentTurnId;
      continue;
    }

    const ref = turnRef_ACU(envelope, ancestor);
    const confirmed = simulation.confirmed.filter(item => sameRef_ACU(item.ref, ref));
    if (confirmed.length !== 1) {
      return reject_ACU(confirmed.length === 0 ? 'revision-conflict' : 'corrupt-data',
        '冻结基底没有唯一匹配的最近已确认推演。');
    }
    const backfill = simulation.legacyBackfill;
    const maintained = backfill?.sourceRef && sameRef_ACU(backfill.sourceRef, ref)
      && backfill.baseLedgerRevision === confirmed[0].ledgerRevision
      && backfill.baseLedgerRevision === result.ledger?.revision
      && backfill.baseLedgerFingerprint === sha256HexSync_ACU(canonicalJson_ACU(result.ledger))
      && backfill.ledgerRevision === simulation.envelope.ledger.revision
      && backfill.ledgerFingerprint === sha256HexSync_ACU(canonicalJson_ACU(simulation.envelope.ledger));
    const removal = simulation.actorRemoval;
    const removed = removal?.sourceRef && sameRef_ACU(removal.sourceRef, ref)
      && removal.baseLedgerRevision === confirmed[0].ledgerRevision
      && removal.baseLedgerRevision === result.ledger?.revision
      && removal.baseLedgerFingerprint === sha256HexSync_ACU(canonicalJson_ACU(result.ledger))
      && removal.ledgerRevision === simulation.envelope.ledger.revision
      && removal.ledgerFingerprint === sha256HexSync_ACU(canonicalJson_ACU(simulation.envelope.ledger));
    const imported = simulation.actorImport;
    const appended = imported?.sourceRef && sameRef_ACU(imported.sourceRef, ref)
      && imported.baseLedgerRevision === confirmed[0].ledgerRevision
      && imported.baseLedgerRevision === result.ledger?.revision
      && imported.baseLedgerFingerprint === sha256HexSync_ACU(canonicalJson_ACU(result.ledger))
      && imported.ledgerRevision === simulation.envelope.ledger.revision
      && imported.ledgerFingerprint === sha256HexSync_ACU(canonicalJson_ACU(simulation.envelope.ledger));
    const eventRemoval = simulation.eventRemoval;
    const eventRemoved = eventRemoval?.sourceRef && sameRef_ACU(eventRemoval.sourceRef, ref)
      && eventRemoval.baseLedgerRevision === confirmed[0].ledgerRevision
      && eventRemoval.baseLedgerRevision === result.ledger?.revision
      && eventRemoval.baseLedgerFingerprint === sha256HexSync_ACU(canonicalJson_ACU(result.ledger))
      && eventRemoval.ledgerRevision === simulation.envelope.ledger.revision
      && eventRemoval.ledgerFingerprint === sha256HexSync_ACU(canonicalJson_ACU(simulation.envelope.ledger));
    const historyRemoval = simulation.historyRemoval;
    const historyRemoved = historyRemoval?.sourceRef && sameRef_ACU(historyRemoval.sourceRef, ref)
      && historyRemoval.baseLedgerRevision === confirmed[0].ledgerRevision
      && historyRemoval.baseLedgerRevision === result.ledger?.revision
      && historyRemoval.baseLedgerFingerprint === sha256HexSync_ACU(canonicalJson_ACU(result.ledger))
      && historyRemoval.ledgerRevision === simulation.envelope.ledger.revision
      && historyRemoval.ledgerFingerprint === sha256HexSync_ACU(canonicalJson_ACU(simulation.envelope.ledger));
    if (!maintained && !removed && !appended && !eventRemoved && !historyRemoved && (simulation.envelope.ledger.revision !== confirmed[0].ledgerRevision
      || canonicalJson_ACU(result.ledger) !== canonicalJson_ACU(simulation.envelope.ledger))) {
      return reject_ACU('revision-conflict', '最近已发布推演回执账本与冻结推演基底不一致。');
    }

    return buildConfirmedSimulationCausalView_ACU(simulation as ZeroLayerSimulationState_ACU, ref, simulation.envelope.ledger.revision);
  }
  return null;
}
