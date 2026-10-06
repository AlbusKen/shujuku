import type { ZeroLayerBranch_ACU, ZeroLayerEnvelope_ACU } from './model';
import type { ZeroLayerCheckpointSet_ACU } from './checkpoint-model';
import { validateCanonicalCheckpoint_ACU } from '../../shared/canonical-checkpoint-validator';
import { validateZeroLayerTableResult_ACU } from './validation';
import { validateZeroLayerSimulationResult_ACU } from './simulation-validation';
import { checkpointFingerprint_ACU as fingerprint, checkpointInteger_ACU as integer,
  checkpointRecord_ACU as record, checkpointPath_ACU, checkpointTurnRef_ACU,
  foldCheckpointContinuation_ACU, requireCheckpoint_ACU as requireValue } from './checkpoint-payload';

export function checkpointSetFingerprint_ACU(set: ZeroLayerCheckpointSet_ACU): string {
  const { fingerprint: _fingerprint, ...payload } = set;
  return fingerprint(payload);
}

/** 读取不补默认值，不激活 pending，不触发宿主保存。 */
export function validateZeroLayerCheckpointSet_ACU(
  raw: unknown, source: ZeroLayerEnvelope_ACU, branch: ZeroLayerBranch_ACU,
): asserts raw is ZeroLayerCheckpointSet_ACU {
  requireValue(record(raw) && raw.schemaVersion === 1 && typeof raw.checkpointId === 'string'
    && raw.checkpointId.trim() && raw.sessionId === source.sessionId && raw.branchId === branch.branchId
    && typeof raw.isolationKey === 'string'
    && integer(raw.sourceRevision) && raw.sourceRevision < source.revision
    && integer(raw.triggeredAtAiCount) && record(raw.position) && raw.position.schemaVersion === 1
    && integer(raw.position.aiOrdinal) && record(raw.position.ref), '逻辑 checkpoint 身份或版本无效。');
  const path = checkpointPath_ACU(source, branch.branchId);
  const target = path.findIndex(turn => turn.turnId === (raw.position as { ref: { turnId?: unknown } }).ref.turnId);
  const head = path.findIndex(turn => turn.turnId === raw.sourceHeadTurnId);
  requireValue(target >= 0 && head >= target && fingerprint(raw.position.ref)
    === fingerprint(checkpointTurnRef_ACU(source, path[target])), 'checkpoint 切点不在已发布父链。');
  const hostAiCount = raw.triggeredAtAiCount - head - 1;
  requireValue(hostAiCount >= 0 && hostAiCount <= source.activationMessageCount
    && raw.position.aiOrdinal === hostAiCount + target + 1, 'checkpoint AI 计数与切点不一致。');
  requireValue(record(raw.cadence) && ['retainRecentLayers', 'bufferLayers', 'periodicStepLayers']
    .every(key => integer((raw.cadence as Record<string, unknown>)[key]))
    && ['compaction', 'periodic'].includes(String(raw.reason)), 'checkpoint 节奏无效。');

  requireValue(record(raw.table) && record(raw.table.payload) && raw.table.payload.kind === 'full'
    && validateCanonicalCheckpoint_ACU(raw.table.payload).valid, 'checkpoint 表格 canonical 校验失败。');
  validateZeroLayerTableResult_ACU(raw.table.result, path[target].assistantFloor.floorId);
  requireValue(fingerprint(raw.table.payload.data) === fingerprint(raw.table.result.tableData)
    && fingerprint(raw.table.result) === fingerprint(path[target].assistantFloor.data.table)
    && path[target].tableInput?.isolationKey === raw.isolationKey, 'checkpoint 表格切点或 isolation 不一致。');
  validateZeroLayerSimulationResult_ACU(raw.simulation);
  requireValue(fingerprint(raw.simulation) === fingerprint(path[target].assistantFloor.data.simulation),
    'checkpoint 推演成员不属于同一切点。');
  requireValue(record(raw.continuation) && record(raw.continuation.checkpoint)
    && raw.continuation.checkpoint.swipeId === '0' && integer(raw.continuation.checkpoint.operationSeq)
    && record(raw.continuation.checkpoint.fieldSnapshot)
    && Array.isArray(raw.continuation.deltas) && raw.continuation.deltas.length === 0,
  'checkpoint 续写成员缺少无损基底或操作水位。');
  foldCheckpointContinuation_ACU([{ payload: raw.continuation, swipeId: '0' }]);
  requireValue(Array.isArray(raw.covered) && raw.covered.length > 0, 'checkpoint 来源引用缺失。');
  const refs = new Set<string>();
  for (const member of raw.covered) {
    requireValue(record(member) && record(member.ref) && typeof member.fingerprint === 'string'
      && member.fingerprint.trim() && Array.isArray(member.operationSeqs)
      && member.operationSeqs.every(integer),
    'checkpoint 来源覆盖无效。');
    const operationSeqs = member.operationSeqs;
    requireValue(operationSeqs.every((seq: number, index: number) => index === 0 || seq > operationSeqs[index - 1]),
      'checkpoint 来源操作序号必须递增。');
    const key = fingerprint(member.ref);
    requireValue(!refs.has(key), 'checkpoint 来源引用重复。');
    refs.add(key);
    const ref = member.ref;
    if (ref.kind === 'logical') {
      const turn = path.slice(0, target + 1).find(item => item.turnId === ref.turnId);
      requireValue(turn && ref.sessionId === source.sessionId && ref.branchId === turn.branchId
        && ['user', 'assistant'].includes(String(ref.role))
        && ref.floorId === (ref.role === 'user' ? turn.userFloor : turn.assistantFloor).floorId,
      'checkpoint 来源跨越切点或分支。');
    } else {
      requireValue(ref.kind === 'host' && integer(ref.messageIndex) && ref.messageIndex < source.activationMessageCount
        && integer(ref.swipeId) && fingerprint(ref.scope) === fingerprint(source.scope)
        && ref.sourceFingerprint === source.activationFingerprint, 'checkpoint 宿主来源身份无效。');
    }
  }
  requireValue(typeof raw.sourceFingerprint === 'string' && raw.sourceFingerprint.trim()
    && raw.fingerprint === checkpointSetFingerprint_ACU(raw as unknown as ZeroLayerCheckpointSet_ACU),
  'checkpoint 成员指纹不一致。');
}

/** pending 不参与读取，active 至多一组；档案仅保存被覆盖的原始续写帧。 */
export function validateZeroLayerCheckpointState_ACU(source: ZeroLayerEnvelope_ACU, branch: ZeroLayerBranch_ACU): void {
  const state = branch.checkpoints;
  if (state === undefined) return;
  requireValue(record(state) && state.schemaVersion === 1 && typeof state.cleanupPending === 'boolean'
    && record(state.replayFrames) && Object.keys(state).every(key =>
      ['schemaVersion', 'active', 'pending', 'cleanupPending', 'replayFrames'].includes(key)), 'checkpoint manifest 无效。');
  requireValue(state.active !== undefined && state.pending !== undefined
    && (!state.cleanupPending || state.active !== null && state.pending === null), 'checkpoint 提交阶段无效。');
  if (state.active !== null) validateZeroLayerCheckpointSet_ACU(state.active, source, branch);
  if (state.pending !== null) {
    validateZeroLayerCheckpointSet_ACU(state.pending, source, branch);
    requireValue(!state.cleanupPending && (!state.active
      || state.pending.position.aiOrdinal > state.active.position.aiOrdinal), 'checkpoint 候选不能回退或重叠清理。');
  }
  const path = checkpointPath_ACU(source, branch.branchId);
  const permitted = new Set(path.flatMap(turn => [turn.userFloor, turn.assistantFloor].map(floor =>
    JSON.stringify({ kind: 'logical', sessionId: source.sessionId, branchId: turn.branchId,
      turnId: turn.turnId, floorId: floor.floorId, role: floor.role }))));
  for (const [key, payload] of Object.entries(state.replayFrames)) {
    let ref: unknown;
    try { ref = JSON.parse(key); } catch { requireValue(false, 'checkpoint 档案引用不可解析。'); }
    requireValue(record(ref), 'checkpoint 档案引用无效。');
    if (ref.kind === 'host') {
      requireValue(integer(ref.messageIndex) && ref.messageIndex < source.activationMessageCount
        && integer(ref.swipeId) && fingerprint(ref.scope) === fingerprint(source.scope)
        && ref.sourceFingerprint === source.activationFingerprint, 'checkpoint 档案宿主引用无效。');
    } else requireValue(permitted.has(key), 'checkpoint 档案引用不在选中父链。');
    foldCheckpointContinuation_ACU([{ payload, swipeId: ref.kind === 'host' ? String(ref.swipeId) : '0' }]);
  }
}

