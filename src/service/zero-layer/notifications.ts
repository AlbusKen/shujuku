import type { ZeroLayerEnvelope_ACU } from './model';
import type { ZeroLayerFloorRef_ACU } from './timeline';

/** 内部只读通知；不携带正文、请求、凭据或 Agent 私有资料。 */
export interface ZeroLayerChange_ACU {
  readonly kind: 'snapshot' | 'stored' | 'LogicalTurnResponseReady' | 'LogicalTurnPublished' | 'scope-invalidated';
  readonly scope: Readonly<ZeroLayerEnvelope_ACU['scope']>;
  readonly sessionId: string;
  readonly branchId: string;
  readonly carrierId: string;
  readonly carrierSwipeId: number;
  readonly revision: number;
  readonly headTurnId: string | null;
  readonly turnId?: string;
  readonly attemptId?: string;
  readonly userFloor?: ZeroLayerFloorRef_ACU;
  readonly assistantFloor?: ZeroLayerFloorRef_ACU;
}

const listeners_ACU = new Set<(change: ZeroLayerChange_ACU) => void>();

/** 仅内部订阅；公开授权与 scope 绑定由历史 Interface 负责。 */
export function subscribeZeroLayerChanges_ACU(listener: (change: ZeroLayerChange_ACU) => void): () => void {
  listeners_ACU.add(listener);
  return () => { listeners_ACU.delete(listener); };
}

export function notifyZeroLayerChanges_ACU(
  before: ZeroLayerEnvelope_ACU | null,
  current: ZeroLayerEnvelope_ACU,
  kind: 'snapshot' | 'stored' | 'scope-invalidated' = 'stored',
): void {
  const branch = current.branches.find(item => item.branchId === current.activeBranchId)!;
  const base: ZeroLayerChange_ACU = {
    kind, scope: { ...current.scope }, sessionId: current.sessionId, branchId: branch.branchId,
    carrierId: current.carrierId, carrierSwipeId: current.carrierSwipeId,
    revision: current.revision, headTurnId: branch.headTurnId,
  };
  const emit = (change: ZeroLayerChange_ACU) => {
    for (const listener of [...listeners_ACU]) {
      try { listener(structuredClone(change)); } catch { /* 消费者失败不改变已确认保存。 */ }
    }
  };
  emit(base);
  if (kind !== 'stored') return;
  for (const turn of current.turns) {
    const previous = before?.turns.find(item => item.turnId === turn.turnId && item.attemptId === turn.attemptId);
    if (previous?.phase === turn.phase || turn.branchId !== branch.branchId) continue;
    const event = turn.phase === 'response-durable' ? 'LogicalTurnResponseReady'
      : turn.phase === 'published' ? 'LogicalTurnPublished' : null;
    if (!event) continue;
    const ref = { kind: 'logical' as const, sessionId: current.sessionId, branchId: turn.branchId, turnId: turn.turnId };
    emit({ ...base, kind: event, turnId: turn.turnId, attemptId: turn.attemptId,
      userFloor: { ...ref, floorId: turn.userFloor.floorId, role: 'user' },
      assistantFloor: { ...ref, floorId: turn.assistantFloor.floorId, role: 'assistant' } });
  }
}
