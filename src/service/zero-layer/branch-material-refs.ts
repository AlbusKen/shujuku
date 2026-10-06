import { ZeroLayerError_ACU, type ZeroLayerEnvelope_ACU, type ZeroLayerBranch_ACU } from './model';
import { checkpointPath_ACU, checkpointFingerprint_ACU as fingerprint } from './checkpoint-payload';
import { isReachableBranchAnchor_ACU } from './branch-path';
import { survivesBridgeContinuationAnchor_ACU } from './bridge-continuation';
import { validateZeroLayerWorkingFrameScope_ACU } from './continuation-working-frame';

/** 恢复资料只能引用目标父链及已确认的宿主启用前缀，不授予写租约。 */
export function validatePublishedMaterialRefs_ACU(source: ZeroLayerEnvelope_ACU,
  branch: ZeroLayerBranch_ACU): void {
  const fail = (): never => { throw new ZeroLayerError_ACU('corrupt-data', '恢复资料引用越过所选切点或缺少来源证明。'); };
  validateZeroLayerWorkingFrameScope_ACU(source, branch);
  const path = checkpointPath_ACU(source, branch.branchId);
  const allowed = new Set(path.flatMap(turn => [turn.userFloor, turn.assistantFloor].map(floor =>
    fingerprint({ kind: 'logical', sessionId: source.sessionId, branchId: turn.branchId,
      turnId: turn.turnId, floorId: floor.floorId, role: floor.role }))));
  for (const ref of branch.bridge?.activationCut.refs ?? []) allowed.add(fingerprint(ref));
  for (const key of Object.keys(branch.continuation?.moduleFrames ?? {})) {
    let ref: unknown;
    try { ref = JSON.parse(key); } catch { fail(); }
    if (!allowed.has(fingerprint(ref))) fail();
  }
  const task = branch.continuation?.envelope?.activeTask;
  if (!task) return;
  const anchors = [...task.timeline, ...(task.progressSelections ?? []),
    ...task.stages.flatMap(stage => stage.progressAdjustments ?? [])];
  for (const anchor of anchors) {
    if (anchor.messageIndex !== undefined) {
      if (!survivesBridgeContinuationAnchor_ACU(task, anchor, branch.bridge)) fail();
    } else if ('logicalRef' in anchor && anchor.logicalRef) {
      const ref = anchor.logicalRef;
      if (ref.sessionId !== source.sessionId || !path.some(turn => turn.branchId === ref.branchId
        && turn.turnId === ref.turnId && turn.attemptId === ref.attemptId
        && turn.assistantFloor.floorId === ref.floorId)) fail();
    } else if ('logicalAnchor' in anchor && anchor.logicalAnchor) {
      const ref = anchor.logicalAnchor;
      if (ref.sessionId !== source.sessionId
        || !isReachableBranchAnchor_ACU({ ...source, activeBranchId: branch.branchId }, ref.branchId, ref.headTurnId)) fail();
    }
  }
  const pending = task.pendingHostTurn;
  if (pending) fail();
}
