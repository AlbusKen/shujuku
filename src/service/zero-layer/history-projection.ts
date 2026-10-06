import type { ZeroLayerEnvelope_ACU } from './model';
import { getPublishedZeroLayerPath_ACU } from './timeline';
import type { ZeroLayerHistoryItem_ACU, ZeroLayerHistoryStatus_ACU } from './history-model';

/** 仅显式公开字段；不得透传 floor.data、请求、模板或 Agent 素材。 */
export function projectZeroLayerHistory_ACU(envelope: ZeroLayerEnvelope_ACU): ZeroLayerHistoryItem_ACU[] {
  return getPublishedZeroLayerPath_ACU(envelope).map((turn): ZeroLayerHistoryItem_ACU => {
    const ref = { kind: 'logical' as const, sessionId: envelope.sessionId,
      branchId: turn.branchId, turnId: turn.turnId };
    return {
      turnId: turn.turnId, parentTurnId: turn.parentTurnId, input: turn.input, body: turn.body!,
      publicState: { availability: 'unavailable' as const, value: null },
      settlement: turn.effectReceipts.map(receipt => ({ kind: receipt.kind, status: receipt.status })),
      userRef: { ...ref, floorId: turn.userFloor.floorId, role: 'user' as const },
      assistantRef: { ...ref, floorId: turn.assistantFloor.floorId, role: 'assistant' as const },
    };
  });
}

export function zeroLayerHistoryStatus_ACU(envelope: ZeroLayerEnvelope_ACU): ZeroLayerHistoryStatus_ACU {
  const branch = envelope.branches.find(item => item.branchId === envelope.activeBranchId)!;
  if (branch.bridge?.phase !== 'reconciled') return 'preparing';
  const pending = envelope.turns.find(turn => turn.branchId === branch.branchId
    && !['published', 'cancelled', 'failed'].includes(turn.phase));
  if (!pending) return 'published';
  return pending.phase === 'prepared' || pending.phase === 'dispatching'
    ? 'busy' : 'recovery-required';
}

/** 比较白名单副本，旧快照不因新回合发布而漂移，也不容忍原记录被删除/改写。 */
export function isZeroLayerHistoryRetained_ACU(
  previous: readonly ZeroLayerHistoryItem_ACU[], current: readonly ZeroLayerHistoryItem_ACU[],
): boolean {
  return previous.length <= current.length && previous.every((item, index) =>
    JSON.stringify(item) === JSON.stringify(current[index]));
}
