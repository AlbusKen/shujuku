import { ZeroLayerError_ACU, type ZeroLayerEnvelope_ACU, type ZeroLayerBranch_ACU } from './model';
import type { ZeroLayerFloorRef_ACU } from './timeline';
import { checkpointPath_ACU, checkpointTurnRef_ACU, checkpointFingerprint_ACU as fingerprint } from './checkpoint-payload';
import { validatePublishedMaterials_ACU } from './branch-materials';
import { checkpointSetFingerprint_ACU } from './checkpoint-validation';

export type ZeroLayerBranchCommand_ACU =
  | { type: 'fork-branch'; branchId: string; head: Extract<ZeroLayerFloorRef_ACU, { kind: 'logical' }> | null }
  | { type: 'select-branch'; branchId: string };

/** 受控分支切换不覆盖原分支；阶段未收尾时不能带着工作候选分叉。 */
export function applyZeroLayerBranchCommand_ACU(source: ZeroLayerEnvelope_ACU,
  command: ZeroLayerBranchCommand_ACU): ZeroLayerEnvelope_ACU {
  if (!source.enabled) throw new ZeroLayerError_ACU('mode-disabled', '逻辑分支操作需要已启用的载体。');
  if (source.turns.some(turn => !['published', 'failed', 'cancelled'].includes(turn.phase))) {
    throw new ZeroLayerError_ACU('pending-turn', '请先停止或恢复未结算回合，再切换逻辑分支。');
  }
  const branch = source.branches.find(item => item.branchId === source.activeBranchId)!;
  if (branch.checkpoints?.pending || branch.checkpoints?.cleanupPending) {
    throw new ZeroLayerError_ACU('effects-pending', '请先恢复 checkpoint 提交阶段，再切换分支。');
  }
  if (typeof command.branchId !== 'string' || !command.branchId.trim()) {
    throw new ZeroLayerError_ACU('corrupt-data', '逻辑分支身份无效。');
  }
  const next = structuredClone(source);
  if (command.type === 'select-branch') {
    const target = next.branches.find(item => item.branchId === command.branchId);
    if (!target || target.bridge?.phase !== 'reconciled' || target.checkpoints?.pending || target.checkpoints?.cleanupPending) {
      throw new ZeroLayerError_ACU('history-unavailable', '所选分支不存在或恢复阶段尚未确认。');
    }
    if (target.branchId === next.activeBranchId) return next;
    next.activeBranchId = target.branchId;
  } else {
    if (next.branches.some(item => item.branchId === command.branchId)) {
      throw new ZeroLayerError_ACU('revision-conflict', '分支身份已存在，禁止覆盖。');
    }
    next.branches.push(restoreForkBranch_ACU(source, branch, command));
    next.activeBranchId = command.branchId;
  }
  next.revision += 1;
  return next;
}

function restoreForkBranch_ACU(source: ZeroLayerEnvelope_ACU, branch: ZeroLayerBranch_ACU,
  command: Extract<ZeroLayerBranchCommand_ACU, { type: 'fork-branch' }>): ZeroLayerBranch_ACU {
  const unavailable = (): never => {
    throw new ZeroLayerError_ACU('history-unavailable', '目标切点缺少已确认的三类恢复素材，请恢复状态或继续原分支。');
  };
  const bridge = branch.bridge;
  if (bridge?.phase !== 'reconciled' || !bridge.candidate) unavailable();
  const path = checkpointPath_ACU(source, branch.branchId);
  const turn = command.head === null ? null : path.find(item =>
    fingerprint(checkpointTurnRef_ACU(source, item)) === fingerprint(command.head));
  if (command.head !== null && !turn) unavailable();
  const snapshot = turn?.publishedMaterials;
  if (turn && !snapshot) unavailable();
  if (turn && snapshot) validatePublishedMaterials_ACU(snapshot, source, turn);
  const continuation = structuredClone(snapshot ? snapshot.continuation : bridge!.candidate!.continuation);
  const simulation = structuredClone(snapshot ? snapshot.simulation : bridge!.candidate!.simulation);
  // 已完成历史锚点保留原身份；在途运行不能被复制成另一分支的运行租约。
  if (continuation.envelope?.activeTask?.pendingHostTurn || simulation.envelope?.task?.activeRun
    || simulation.runState) unavailable();
  if (continuation.envelope?.activeTask?.status === 'running') {
    continuation.envelope.activeTask.status = 'paused';
  }
  const checkpoints = snapshot?.checkpoints ? structuredClone(snapshot.checkpoints) : undefined;
  if (checkpoints) {
    if (checkpoints.pending || checkpoints.cleanupPending) unavailable();
    if (checkpoints.active) {
      const prefix = path.slice(0, path.findIndex(item => item.turnId === turn!.turnId) + 1);
      if (!prefix.some(item => item.turnId === checkpoints.active!.sourceHeadTurnId)
        || !prefix.some(item => fingerprint(checkpointTurnRef_ACU(source, item))
          === fingerprint(checkpoints.active!.position.ref))) unavailable();
      // manifest 属于新分支，成员 FloorRef 仍属于不可变共享前缀。
      checkpoints.active.branchId = command.branchId;
      checkpoints.active.checkpointId = crypto.randomUUID();
      checkpoints.active.fingerprint = checkpointSetFingerprint_ACU(checkpoints.active);
    }
  }
  return { branchId: command.branchId, headTurnId: turn?.turnId ?? null,
    fork: { sourceBranchId: branch.branchId, headTurnId: turn?.turnId ?? null, sourceRevision: source.revision },
    bridge: structuredClone(bridge!), continuation, simulation,
    ...(checkpoints ? { checkpoints } : {}) };
}
