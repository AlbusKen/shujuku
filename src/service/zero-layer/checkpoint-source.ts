import type { ZeroLayerCheckpointSet_ACU } from './checkpoint-model';
import type { ZeroLayerEnvelope_ACU } from './model';
import type { ZeroLayerTimelineSnapshot_ACU } from './timeline';
import { checkpointReplayFrames_ACU } from './checkpoint-projection';
import { checkpointFingerprint_ACU as fingerprint, checkpointRecord_ACU as record,
  checkpointInteger_ACU as integer, continuationCheckpointPayload_ACU,
  requireCheckpoint_ACU as requireValue } from './checkpoint-payload';

/** 来源指纹覆盖正文附属结果与原帧；操作序号只取载荷，不取楼层 ordinal。 */
export function captureCheckpointSource_ACU(source: ZeroLayerEnvelope_ACU,
  timeline: ZeroLayerTimelineSnapshot_ACU, cut: number) {
  requireValue(cut >= 0 && cut < timeline.floors.length, 'checkpoint 来源切点无效。');
  const frames = checkpointReplayFrames_ACU(source, timeline).slice(0, cut + 1);
  const covered = timeline.floors.slice(0, cut + 1).map((floor, index) => {
    const payload = frames[index].payload;
    const deltas = record(payload) && Array.isArray(payload.deltas) ? payload.deltas : [];
    const operationSeqs = [...new Set(deltas.map(delta => record(delta) ? delta.seq : undefined)
      .filter(integer))].sort((left, right) => left - right);
    return { ref: structuredClone(floor.ref),
      fingerprint: fingerprint({ data: floor.data, payload: payload ?? null }), operationSeqs };
  });
  return { covered, sourceFingerprint: fingerprint(covered),
    continuation: continuationCheckpointPayload_ACU(frames) };
}

/** stage 与 activate 均复核来源；迟到候选不能先激活再靠清理失败兜底。 */
export function assertCheckpointSource_ACU(source: ZeroLayerEnvelope_ACU,
  timeline: ZeroLayerTimelineSnapshot_ACU, set: ZeroLayerCheckpointSet_ACU): void {
  const cut = timeline.floors.findIndex(floor => fingerprint(floor.ref) === fingerprint(set.position.ref));
  const head = timeline.floors.find(floor => floor.ref.kind === 'logical'
    && floor.ref.turnId === set.sourceHeadTurnId && floor.role === 'assistant');
  requireValue(head?.aiOrdinal === set.triggeredAtAiCount
    && timeline.floors[cut]?.aiOrdinal === set.position.aiOrdinal,
  'checkpoint 来源计数或覆盖切点已变化。');
  const captured = captureCheckpointSource_ACU(source, timeline, cut);
  requireValue(fingerprint(captured.covered) === fingerprint(set.covered)
    && captured.sourceFingerprint === set.sourceFingerprint
    && fingerprint(captured.continuation) === fingerprint(set.continuation),
  'checkpoint 来源或无损折叠候选已变化，禁止激活。');
}
