import { AGENT_MODULE_FIELD_ACU } from '../continuation/agent/agent-model';
import type { ZeroLayerEnvelope_ACU, ZeroLayerContinuationState_ACU } from './model';
import type { ZeroLayerTimelineSnapshot_ACU } from './timeline';
import { validateZeroLayerWorkingFrameScope_ACU } from './continuation-working-frame';
import { checkpointFingerprint_ACU as fingerprint, checkpointRecord_ACU as record,
  foldCheckpointContinuation_ACU, requireCheckpoint_ACU as requireValue } from './checkpoint-payload';

/** 回放原帧与工作增量分开；已有 active 不得覆写档案中的原基线。 */
export function checkpointReplayFrames_ACU(source: ZeroLayerEnvelope_ACU,
  timeline: ZeroLayerTimelineSnapshot_ACU, state?: ZeroLayerContinuationState_ACU | null) {
  const branch = source.branches.find(item => item.branchId === timeline.branchId)!;
  const archive = branch.checkpoints?.replayFrames ?? {};
  const frames = state?.moduleFrames ?? branch.continuation?.moduleFrames ?? {};
  return timeline.floors.map(floor => {
    const key = JSON.stringify(floor.ref);
    const original = archive[key];
    const current = frames[key];
    let payload = original ?? current;
    if (original !== undefined && current !== undefined) {
      requireValue(record(original) && record(current) && Array.isArray(original.deltas)
        && Array.isArray(current.deltas), '回放帧不能与旧全量资料叠加。');
      const deltas = [...original.deltas, ...current.deltas];
      const unique = new Map<number, unknown>();
      for (const delta of deltas) {
        requireValue(record(delta) && typeof delta.seq === 'number', '回放操作缺少序号。');
        const previous = unique.get(delta.seq);
        requireValue(previous === undefined || fingerprint(previous) === fingerprint(delta), '回放操作序号冲突。');
        unique.set(delta.seq, delta);
      }
      payload = { ...original, deltas: [...unique.values()] };
    }
    return { payload, swipeId: floor.ref.kind === 'host' ? String(floor.ref.swipeId) : '0' };
  });
}

/** 规划读侧叠加分支工作基底；只改请求投影，不改原帧，也不加入 checkpoint 回放。 */
export function projectWorkingContinuation_ACU(source: ZeroLayerEnvelope_ACU,
  timeline: ZeroLayerTimelineSnapshot_ACU, state?: ZeroLayerContinuationState_ACU | null) {
  const branch = source.branches.find(item => item.branchId === timeline.branchId);
  requireValue(branch && timeline.sessionId === source.sessionId
    && timeline.headTurnId === branch.headTurnId, '续写工作投影前沿已变化。');
  const effective = state === undefined ? branch.continuation : state;
  const projection = projectCheckpointContinuation_ACU(source, timeline, effective);
  const working = effective?.workingFrame;
  if (!working) return projection;
  validateZeroLayerWorkingFrameScope_ACU(source, { ...branch, continuation: effective! });
  const at = timeline.floors.findIndex(floor => fingerprint(floor.ref) === fingerprint(working.anchor));
  requireValue(at >= 0 && at === timeline.floors.length - 1, '续写工作帧来源不在所选前沿。');
  // 工作基底采用固定内存 swipe；宿主 swipe 与来源 FloorRef 保持原样。
  projection[at].swipe_id = 0;
  projection[at][AGENT_MODULE_FIELD_ACU] = structuredClone(working.payload);
  return projection;
}

/** 活动基线替代覆盖前缀，正文投影保留；仅使用明确 FloorRef，不写物理楼层。 */
export function projectCheckpointContinuation_ACU(source: ZeroLayerEnvelope_ACU,
  timeline: ZeroLayerTimelineSnapshot_ACU, state?: ZeroLayerContinuationState_ACU | null) {
  const branch = source.branches.find(item => item.branchId === timeline.branchId)!;
  const frames = state?.moduleFrames ?? branch.continuation?.moduleFrames ?? {};
  const active = branch.checkpoints?.active;
  const cut = active ? timeline.floors.findIndex(floor => fingerprint(floor.ref) === fingerprint(active.position.ref)) : -1;
  requireValue(!active || cut >= 0, '活动 checkpoint 不在当前时间线。');
  return timeline.floors.map((floor, index) => {
    const message: Record<string, unknown> = { ...floor.data, mes: floor.body,
      is_user: floor.role === 'user', is_system: floor.role === 'system',
      swipe_id: floor.ref.kind === 'host' ? floor.ref.swipeId : 0 };
    delete message[AGENT_MODULE_FIELD_ACU];
    const payload = frames[JSON.stringify(floor.ref)];
    if (!active || index > cut) {
      if (payload !== undefined) message[AGENT_MODULE_FIELD_ACU] = structuredClone(payload);
    } else if (index === cut) {
      const baseline = structuredClone(active.continuation);
      if (payload !== undefined) {
        requireValue(record(payload) && Array.isArray(payload.deltas), '活动切点帧无效。');
        baseline.deltas = structuredClone(payload.deltas.filter(delta => record(delta)
          && typeof delta.seq === 'number' && delta.seq > (baseline.checkpoint!.operationSeq ?? 0))) as typeof baseline.deltas;
      }
      message[AGENT_MODULE_FIELD_ACU] = baseline;
    }
    return message;
  });
}
