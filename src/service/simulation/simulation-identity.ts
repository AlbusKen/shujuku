import { WorldSimulationValidationError_ACU, createWorldSimulationError_ACU,
  type WorldSimulationCompletedAnchor_ACU, type WorldSimulationHostRunIdentity_ACU,
  type WorldSimulationLogicalRef_ACU, type WorldSimulationRunIdentity_ACU, type WorldSimulationEnvelope_ACU } from './model';
import type { WorldSimulationAnchorIdentity_ACU, WorldSimulationTargetAnchor_ACU } from './agent/agent-model';

export function sameWorldSimulationLogicalRef_ACU(left: WorldSimulationLogicalRef_ACU, right: WorldSimulationLogicalRef_ACU): boolean {
  return (['sessionId', 'branchId', 'turnId', 'attemptId', 'floorId'] as const).every(key => left[key] === right[key]);
}

export function worldSimulationTargetRef_ACU(anchor: WorldSimulationTargetAnchor_ACU): WorldSimulationCompletedAnchor_ACU {
  if ('kind' in anchor && anchor.kind === 'logical') return structuredClone(anchor);
  const host = requireWorldSimulationHostAnchor_ACU(anchor);
  return { chatIdentity: host.chatIdentity, messageKey: host.messageKey, swipeId: host.swipeId, contentDigest: host.contentDigest };
}

export function worldSimulationRunTargetRef_ACU(run: WorldSimulationRunIdentity_ACU): WorldSimulationCompletedAnchor_ACU {
  if (run.kind === 'logical') return { kind: 'logical', chatIdentity: run.chatIdentity,
    logicalRef: structuredClone(run.logicalRef), contentDigest: run.anchorContentDigest };
  return { chatIdentity: run.chatIdentity, messageKey: run.anchorMessageKey,
    swipeId: run.anchorSwipeId, contentDigest: run.anchorContentDigest };
}

export function sameWorldSimulationTargetRef_ACU(left: WorldSimulationCompletedAnchor_ACU, right: WorldSimulationCompletedAnchor_ACU): boolean {
  if (left.chatIdentity !== right.chatIdentity) return false;
  if (left.kind === 'logical') return right.kind === 'logical'
    && left.contentDigest === right.contentDigest
    && sameWorldSimulationLogicalRef_ACU(left.logicalRef, right.logicalRef);
  // 宿主正文允许后处理；逻辑楼层仍按冻结的内容版本验证。
  return right.kind !== 'logical' && left.messageKey === right.messageKey && left.swipeId === right.swipeId;
}

export function requireWorldSimulationHostAnchor_ACU(anchor: WorldSimulationTargetAnchor_ACU): WorldSimulationAnchorIdentity_ACU {
  if ('logicalRef' in anchor || ('kind' in anchor && anchor.kind !== undefined && anchor.kind !== 'host')) {
    throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
      'WORLD_SIMULATION_ANCHOR_INVALID', 'anchor', '宿主楼层入口不接受逻辑锚点', false));
  }
  return anchor as WorldSimulationAnchorIdentity_ACU;
}

export function assertWorldSimulationHostRun_ACU(run: WorldSimulationRunIdentity_ACU): asserts run is WorldSimulationHostRunIdentity_ACU {
  if ('logicalRef' in run || (run.kind !== undefined && run.kind !== 'host')) {
    throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
      'WORLD_SIMULATION_ANCHOR_INVALID', 'anchor', '宿主推演入口不接受逻辑运行身份', false));
  }
}

/** 共享校验器接受两种身份，但普通模式私有字段不能承载逻辑状态。 */
export function assertWorldSimulationHostEnvelope_ACU(envelope: WorldSimulationEnvelope_ACU): void {
  if (envelope.task?.activeRun) assertWorldSimulationHostRun_ACU(envelope.task.activeRun);
  const completed = envelope.task?.completedAutoAnchor;
  if (completed?.kind === 'logical' || (completed && 'logicalRef' in completed)
    || envelope.ledger.pendingFixes.some(item => item.anchor && 'logicalRef' in item.anchor)) {
    throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
      'WORLD_SIMULATION_ANCHOR_INVALID', 'anchor', '宿主推演存储不接受逻辑状态', false));
  }
}
