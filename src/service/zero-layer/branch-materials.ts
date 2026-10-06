import { ZeroLayerError_ACU, type ZeroLayerEnvelope_ACU, type ZeroLayerTurn_ACU,
  type ZeroLayerPublishedMaterialSnapshot_ACU } from './model';
import { checkpointFingerprint_ACU as fingerprint, checkpointTurnRef_ACU } from './checkpoint-payload';
import { validateZeroLayerContinuationState_ACU, validateZeroLayerTableResult_ACU } from './validation';
import { validateZeroLayerSimulationState_ACU, validateZeroLayerSimulationRefs_ACU } from './simulation-validation';
import { checkpointPath_ACU } from './checkpoint-payload';
import { validateZeroLayerCheckpointState_ACU } from './checkpoint-validation';
import { validateZeroLayerContinuationReceipt_ACU } from './validation';
import { validatePublishedMaterialRefs_ACU } from './branch-material-refs';

export function publishedMaterialFingerprint_ACU(snapshot: ZeroLayerPublishedMaterialSnapshot_ACU): string {
  const { fingerprint: _fingerprint, ...payload } = snapshot;
  return fingerprint(payload);
}

/** 只在发布提交内捕获；不由重载后的当前工作状态补造历史快照。 */
export function capturePublishedMaterials_ACU(source: ZeroLayerEnvelope_ACU,
  turn: ZeroLayerTurn_ACU): ZeroLayerPublishedMaterialSnapshot_ACU {
  const branch = source.branches.find(item => item.branchId === turn.branchId);
  if (!branch?.continuation || !branch.simulation) {
    throw new ZeroLayerError_ACU('history-unavailable', '发布缺少可确认的续写或推演恢复素材。');
  }
  const table = turn.assistantFloor.data.table;
  validateZeroLayerTableResult_ACU(table, turn.assistantFloor.floorId);
  const snapshot: ZeroLayerPublishedMaterialSnapshot_ACU = {
    schemaVersion: 1, ref: checkpointTurnRef_ACU(source, turn), sourceRevision: source.revision,
    table: structuredClone(table),
    continuation: structuredClone(branch.continuation), simulation: structuredClone(branch.simulation),
    checkpoints: structuredClone(branch.checkpoints ?? null), fingerprint: '',
  };
  snapshot.fingerprint = publishedMaterialFingerprint_ACU(snapshot);
  return snapshot;
}

export function validatePublishedMaterials_ACU(raw: ZeroLayerPublishedMaterialSnapshot_ACU,
  source: ZeroLayerEnvelope_ACU, turn: ZeroLayerTurn_ACU): void {
  if (!raw || raw.schemaVersion !== 1 || turn.phase !== 'published'
    || !Number.isSafeInteger(raw.sourceRevision) || raw.sourceRevision < 0 || raw.sourceRevision >= source.revision
    || fingerprint(raw.ref) !== fingerprint(checkpointTurnRef_ACU(source, turn))
    || raw.fingerprint !== publishedMaterialFingerprint_ACU(raw)) {
    throw new ZeroLayerError_ACU('corrupt-data', '发布恢复快照的切点、版本或指纹无效。');
  }
  validateZeroLayerTableResult_ACU(raw.table, turn.assistantFloor.floorId);
  if (fingerprint(raw.table) !== fingerprint(turn.assistantFloor.data.table)) {
    throw new ZeroLayerError_ACU('corrupt-data', '发布恢复快照与目标表格结算不一致。');
  }
  validateZeroLayerContinuationState_ACU(raw.continuation);
  validateZeroLayerSimulationState_ACU(raw.simulation);
  const owner = source.branches.find(branch => branch.branchId === turn.branchId);
  if (!owner) throw new ZeroLayerError_ACU('corrupt-data', '发布恢复快照缺少所属分支。');
  const branch = { ...owner, headTurnId: turn.turnId, continuation: raw.continuation,
    simulation: raw.simulation, ...(raw.checkpoints === null ? {} : { checkpoints: raw.checkpoints }) };
  if (raw.checkpoints === null) delete branch.checkpoints;
  const view = { ...source, activeBranchId: branch.branchId,
    branches: source.branches.map(item => item.branchId === branch.branchId ? branch : item) };
  const path = checkpointPath_ACU(view, branch.branchId);
  const reachable = new Set(path.map(item => item.turnId));
  for (const ref of raw.continuation.confirmed) {
    const confirmed = path.find(item => item.turnId === ref.turnId && item.attemptId === ref.attemptId
      && item.assistantFloor.floorId === ref.floorId && item.continuationIdentity?.attemptId === ref.continuationAttemptId);
    if (!confirmed) throw new ZeroLayerError_ACU('corrupt-data', '发布续写快照包含目标切点之后的确认。');
    validateZeroLayerContinuationReceipt_ACU(confirmed, source.sessionId);
  }
  validateZeroLayerSimulationRefs_ACU(raw.simulation, source.sessionId, branch.branchId,
    new Map(path.map(item => [item.turnId, item])),
    branch.bridge?.phase === 'reconciled' ? branch.bridge.candidate?.simulationHostCompletion : undefined,
    reachable, turn.turnId);
  validateZeroLayerCheckpointState_ACU(view, branch);
  validatePublishedMaterialRefs_ACU(view, branch);
}
