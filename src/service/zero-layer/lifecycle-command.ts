import { ZeroLayerError_ACU, type ZeroLayerEnvelope_ACU } from './model';
import { transitionZeroLayerTurn_ACU, validateZeroLayerEnvelope_ACU } from './validation';
import { getTableDataFingerprint_ACU } from '../table/table-data-upgrade-audit';

/** 调用者先撤销并等待运行租约；单次 carrier 提交冻结阶段，保留所有恢复素材。 */
export function suspendZeroLayerEnvelope_ACU(source: ZeroLayerEnvelope_ACU,
  apiPresetName?: string): ZeroLayerEnvelope_ACU {
  const next = validateZeroLayerEnvelope_ACU(source);
  const now = Date.now();
  for (const turn of next.turns) {
    if (turn.phase === 'prepared' || turn.phase === 'dispatching') {
      // dispatch 意图已保存也不能证明请求未发送，绝不能升级为确定取消。
      turn.phase = turn.phase === 'prepared' ? 'cancelled' : 'delivery-unknown';
      turn.errorCode = turn.phase === 'cancelled' ? 'mode-disabled' : 'delivery-unknown';
      turn.updatedAt = Math.max(now, turn.updatedAt);
    }
  }
  for (const branch of next.branches) {
    const task = branch.continuation?.envelope?.activeTask;
    if (task && !['completed', 'abandoned', 'failed'].includes(task.status)) {
      if (task.status !== 'paused' || task.stopReason !== 'manual') {
        task.status = 'paused';
        task.stopReason = 'manual';
        task.updatedAt = Math.max(now, task.updatedAt);
      }
      const pending = task.pendingHostTurn;
      const ref = pending?.capture.logicalRef;
      // 只释放同一持久化身份且确定未发送的等待轮；未知/已保存正文保留原引用。
      if (ref && ref.sessionId === next.sessionId && ref.branchId === branch.branchId
        && next.turns.some(turn => turn.branchId === ref.branchId && turn.turnId === ref.turnId
          && turn.attemptId === ref.attemptId && turn.assistantFloor.floorId === ref.floorId
          && ['cancelled', 'failed'].includes(turn.phase))) task.pendingHostTurn = null;
    }
    const simulation = branch.simulation?.envelope;
    const runTask = simulation?.task;
    if (simulation && runTask && ['drafting', 'running', 'stopping_after_inflight'].includes(runTask.status)) {
      runTask.status = 'paused';
      runTask.stopReason = 'manual';
      runTask.updatedAt = Math.max(now, runTask.updatedAt);
      simulation.updatedAt = Math.max(now, simulation.updatedAt);
    }
  }
  next.enabled = false;
  if (apiPresetName !== undefined) next.apiPresetName = apiPresetName;
  if (getTableDataFingerprint_ACU(next) === getTableDataFingerprint_ACU(source)) return next;
  next.revision += 1;
  return validateZeroLayerEnvelope_ACU(next);
}

/** 用户显式放弃正文未保存的回合：只记取消与原因，保留输入；未知发送不被当成确认未发送而自动重发。 */
export function abandonZeroLayerTurn_ACU(source: ZeroLayerEnvelope_ACU, turnId: string, attemptId: string): ZeroLayerEnvelope_ACU {
  const current = validateZeroLayerEnvelope_ACU(source);
  const turn = current.turns.find(item => item.turnId === turnId && item.attemptId === attemptId);
  if (!turn || turn.branchId !== current.activeBranchId
    || !['prepared', 'dispatching', 'delivery-unknown'].includes(turn.phase)) {
    throw new ZeroLayerError_ACU('invalid-transition', '只能放弃当前分支中正文尚未保存的回合。');
  }
  const next = transitionZeroLayerTurn_ACU(current, turnId, 'cancelled', {
    errorCode: turn.phase === 'prepared' ? 'abandoned-before-dispatch' : 'abandoned-delivery-unknown',
  });
  const task = next.branches.find(branch => branch.branchId === turn.branchId)?.continuation?.envelope?.activeTask;
  const ref = task?.pendingHostTurn?.capture.logicalRef;
  if (task && ref && ref.sessionId === next.sessionId && ref.branchId === turn.branchId
    && ref.turnId === turnId && ref.attemptId === attemptId && ref.floorId === turn.assistantFloor.floorId) {
    // 续写等待轮随回合释放并停在手动暂停；由用户显式继续，不自动重发同一指令。
    task.pendingHostTurn = null;
    if (!['completed', 'abandoned', 'failed'].includes(task.status)) {
      task.status = 'paused';
      task.stopReason = 'manual';
      task.updatedAt = Math.max(Date.now(), task.updatedAt);
    }
  }
  return validateZeroLayerEnvelope_ACU(next);
}
