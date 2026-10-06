import type { ZeroLayerEnvelope_ACU } from './model';
import { ZeroLayerError_ACU } from './model';
import type { ZeroLayerCheckpointSet_ACU } from './checkpoint-model';
import type { ZeroLayerStore_ACU } from './store';
import { buildZeroLayerTimeline_ACU } from './timeline';
import { captureZeroLayerCarrier_ACU, assertZeroLayerCarrier_ACU } from './carrier-context';
import { readTableCheckpointCadence_ACU } from '../continuation/agent/agent-checkpoint-scheduler';
import { getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import { buildCanonicalFullCheckpoint_ACU } from '../table/canonical-checkpoint-builder';
import { applyTableOperationV2_ACU } from '../table/storage-frame-v2-replay';
import { validateZeroLayerTableResult_ACU } from './validation';
import { validateZeroLayerSimulationResult_ACU } from './simulation-validation';
import { captureCheckpointSource_ACU } from './checkpoint-source';
import { checkpointSetFingerprint_ACU } from './checkpoint-validation';
import { checkpointFingerprint_ACU as fingerprint, checkpointInteger_ACU as integer,
  requireCheckpoint_ACU as requireValue } from './checkpoint-payload';

/** 发布计数驱动；失败尝试不计数，三个阶段均等待 carrier 严格保存确认。 */
export async function synchronizeZeroLayerCheckpoints_ACU(store: ZeroLayerStore_ACU,
  source: ZeroLayerEnvelope_ACU, signal: AbortSignal, assertLease: () => void): Promise<ZeroLayerEnvelope_ACU> {
  const context = captureZeroLayerCarrier_ACU();
  const sessionId = source.sessionId;
  const branchId = source.activeBranchId;
  const isolationKey = getCurrentIsolationKey_ACU();
  const assertCurrent = (value: ZeroLayerEnvelope_ACU | null): ZeroLayerEnvelope_ACU => {
    assertLease();
    assertZeroLayerCarrier_ACU(context);
    if (signal.aborted || getCurrentIsolationKey_ACU() !== isolationKey || !value?.enabled
      || value.sessionId !== sessionId || value.activeBranchId !== branchId) {
      throw new ZeroLayerError_ACU('scope-changed', '逻辑 checkpoint 作用域或租约已变化。');
    }
    return value;
  };
  let current = assertCurrent(await store.read());
  if (current.turns.some(turn => !['published', 'failed', 'cancelled'].includes(turn.phase))) {
    throw new ZeroLayerError_ACU('pending-turn', '逻辑 checkpoint 必须在完整发布后调度。');
  }
  const readState = () => current.branches.find(branch => branch.branchId === branchId)!.checkpoints;
  // 恢复只能续跑已确认的阶段；保存未知由 store.read 阻断，不在此重试保存。
  const pending = readState()?.pending;
  if (pending) current = assertCurrent(await store.commit({ type: 'activate-checkpoint',
    checkpointId: pending.checkpointId }, current.revision));
  const cleanup = readState();
  if (cleanup?.cleanupPending && cleanup.active) {
    current = assertCurrent(await store.commit({ type: 'clean-checkpoint',
      checkpointId: cleanup.active.checkpointId }, current.revision));
    return current;
  }

  const cadence = readTableCheckpointCadence_ACU();
  requireValue(Object.values(cadence).every(integer) && cadence.bufferLayers > 0
    && cadence.periodicStepLayers > 0, 'checkpoint 实时节奏配置无效。');
  const timeline = buildZeroLayerTimeline_ACU(current, context.chat as Record<string, unknown>[]);
  const aiCount = timeline.completedAiCount;
  const active = readState()?.active;
  if (active && active.isolationKey !== isolationKey) {
    throw new ZeroLayerError_ACU('scope-changed', '活动 checkpoint 不属于当前 isolation。');
  }
  const retain = cadence.retainRecentLayers;
  const retainedOrdinal = aiCount - retain + 1;
  const retainedDue = retain > 0 && aiCount >= retain + cadence.bufferLayers
    && (!active || retainedOrdinal > active.position.aiOrdinal
      && aiCount - active.triggeredAtAiCount >= cadence.bufferLayers);
  const periodicBuffer = Math.max(cadence.bufferLayers, retain);
  const rootOrdinal = active?.position.aiOrdinal ?? 1;
  const periodicDue = aiCount - rootOrdinal >= periodicBuffer + cadence.periodicStepLayers;
  if (!retainedDue && !periodicDue) return current;
  const reason = retainedDue ? 'compaction' : 'periodic';
  const targetOrdinal = retainedDue ? retainedOrdinal : aiCount - periodicBuffer;
  const cut = timeline.floors.findIndex(floor => floor.aiOrdinal === targetOrdinal);
  const floor = timeline.floors[cut];
  // 存量桥接由 S07 处理；这里不能将宿主 floor 伪装为逻辑 checkpoint。
  if (!floor || floor.ref.kind !== 'logical' || floor.role !== 'assistant') return current;
  if (active && targetOrdinal <= active.position.aiOrdinal) return current;
  const ref = floor.ref;
  const turn = current.turns.find(item => item.turnId === ref.turnId)!;
  const table = turn.assistantFloor.data.table;
  validateZeroLayerTableResult_ACU(table, floor.ref.floorId);
  const simulation = turn.assistantFloor.data.simulation;
  validateZeroLayerSimulationResult_ACU(simulation);
  requireValue(turn.tableInput?.isolationKey === isolationKey, 'checkpoint 表格切点作用域不一致。');
  const built = buildCanonicalFullCheckpoint_ACU({ createdAt: Date.now(), reason, data: table.tableData });
  requireValue(built.checkpoint, '逻辑表格 checkpoint 未通过 canonical 校验。');
  const replay = structuredClone(built.checkpoint.data);
  await applyTableOperationV2_ACU(replay, { kind: 'data_replace', data: table.tableData, reason: 'checkpoint_fallback' });
  assertCurrent(current);
  requireValue(fingerprint(replay) === fingerprint(built.checkpoint.data), '逻辑表格 checkpoint 纯回放不等价。');

  const captured = captureCheckpointSource_ACU(current, timeline, cut);
  requireValue(timeline.headTurnId, 'checkpoint 缺少已发布的源 head。');
  const set: ZeroLayerCheckpointSet_ACU = {
    schemaVersion: 1, checkpointId: crypto.randomUUID(), sessionId, branchId, isolationKey,
    position: { schemaVersion: 1, ref: structuredClone(floor.ref), aiOrdinal: targetOrdinal },
    sourceRevision: current.revision, sourceHeadTurnId: timeline.headTurnId,
    sourceFingerprint: captured.sourceFingerprint, triggeredAtAiCount: aiCount, cadence, reason,
    table: { payload: built.checkpoint, result: structuredClone(table) },
    continuation: captured.continuation, simulation: structuredClone(simulation),
    covered: captured.covered, fingerprint: '',
  };
  set.fingerprint = checkpointSetFingerprint_ACU(set);
  current = assertCurrent(await store.commit({ type: 'stage-checkpoint', candidate: set }, current.revision));
  current = assertCurrent(await store.commit({ type: 'activate-checkpoint', checkpointId: set.checkpointId }, current.revision));
  return assertCurrent(await store.commit({ type: 'clean-checkpoint', checkpointId: set.checkpointId }, current.revision));
}
