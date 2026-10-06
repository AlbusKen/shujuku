import type { ZeroLayerEnvelope_ACU } from './model';
import { validateZeroLayerEnvelope_ACU } from './validation';
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
