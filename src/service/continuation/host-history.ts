import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import type { ContinuationTask_ACU } from './model';
import { reconcileTaskCursorFromChat_ACU, reconcileTaskCursorFromHistory_ACU } from './stage-cursor';
import { readOrdinaryZeroLayerState_ACU } from '../zero-layer/ordinary-state';
import { checkpointPath_ACU } from '../zero-layer/checkpoint-payload';
import { isReachableBranchAnchor_ACU } from '../zero-layer/branch-path';
import { ZeroLayerError_ACU } from '../zero-layer/model';

/** 普通后缀仍按真实物理范围恢复；归档完成记录只能由原逻辑父链证明。 */
export function reconcileHostContinuationTask_ACU(task: ContinuationTask_ACU): ContinuationTask_ACU {
  const chat = getChatArray_ACU();
  const anchors = [...task.timeline, ...(task.progressSelections ?? []),
    ...task.stages.flatMap(stage => stage.progressAdjustments ?? [])];
  const hasLogical = anchors.some(anchor => 'logicalRef' in anchor && anchor.logicalRef
    || 'logicalAnchor' in anchor && anchor.logicalAnchor);
  if (!hasLogical) return reconcileTaskCursorFromChat_ACU(task, chat.length);
  const state = readOrdinaryZeroLayerState_ACU();
  if (!state) throw new ZeroLayerError_ACU('history-unavailable', '续写逻辑完成记录缺少已确认的退出归档。');
  const { envelope } = state;
  const path = checkpointPath_ACU(envelope, envelope.exitManifest!.branchId);
  return reconcileTaskCursorFromHistory_ACU(task, anchor => {
    if (anchor.logicalRef) {
      const ref = anchor.logicalRef;
      if (ref.sessionId !== envelope.sessionId || !path.some(turn => turn.branchId === ref.branchId
        && turn.turnId === ref.turnId && turn.attemptId === ref.attemptId
        && turn.assistantFloor.floorId === ref.floorId)) {
        throw new ZeroLayerError_ACU('history-unavailable', '续写完成引用不在所选退出归档父链中。');
      }
      return true;
    }
    if (anchor.logicalAnchor) {
      const ref = anchor.logicalAnchor;
      if (ref.sessionId !== envelope.sessionId
        || !isReachableBranchAnchor_ACU(envelope, ref.branchId, ref.headTurnId)) {
        throw new ZeroLayerError_ACU('history-unavailable', '续写进度依据不在所选退出归档中。');
      }
      return true;
    }
    return typeof anchor.messageIndex === 'number' && anchor.messageIndex >= 0 && anchor.messageIndex < chat.length;
  });
}
