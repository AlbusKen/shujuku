import { AGENT_MODULE_FIELD_ACU, AGENT_MODULE_FRAME_SCHEMA_VERSION_ACU, type AgentModuleFloorFrame_ACU } from '../continuation/agent/agent-model';
import { foldAgentModuleSnapshot_ACU, validateAgentModuleFieldSnapshot_ACU } from '../continuation/agent/agent-module-frame';
import { agentModuleFrameDeps_ACU } from '../continuation/agent/agent-module-store';
import { getTableDataFingerprint_ACU } from '../table/table-data-upgrade-audit';
import { ZeroLayerError_ACU, type ZeroLayerEnvelope_ACU, type ZeroLayerTurn_ACU } from './model';
import type { ZeroLayerFloorRef_ACU } from './timeline';

export const checkpointFingerprint_ACU = getTableDataFingerprint_ACU;
export function requireCheckpoint_ACU(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ZeroLayerError_ACU('corrupt-data', message);
}
export const checkpointRecord_ACU = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export const checkpointInteger_ACU = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** 只沿指定分支的已发布父链；供校验器使用，不能递归调用 envelope 校验。 */
export function checkpointPath_ACU(source: ZeroLayerEnvelope_ACU, branchId: string): ZeroLayerTurn_ACU[] {
  const branch = source.branches.find(item => item.branchId === branchId);
  requireCheckpoint_ACU(branch, 'checkpoint 分支不存在。');
  const turns = new Map(source.turns.map(turn => [turn.turnId, turn]));
  const path: ZeroLayerTurn_ACU[] = [];
  const seen = new Set<string>();
  let cursor = branch.headTurnId;
  while (cursor !== null) {
    const turn = turns.get(cursor);
    requireCheckpoint_ACU(turn?.phase === 'published' && !seen.has(cursor), 'checkpoint 父链无效。');
    seen.add(cursor);
    path.push(turn);
    cursor = turn.parentTurnId;
  }
  return path.reverse();
}
export function checkpointTurnRef_ACU(source: ZeroLayerEnvelope_ACU, turn: ZeroLayerTurn_ACU): Extract<ZeroLayerFloorRef_ACU, { kind: 'logical' }> {
  return { kind: 'logical', sessionId: source.sessionId, branchId: turn.branchId,
    turnId: turn.turnId, floorId: turn.assistantFloor.floorId, role: 'assistant' };
}


/** 无损折叠边界只接受载荷与原 swipe，不赋予数组位置任何宿主写权限。 */
export function foldCheckpointContinuation_ACU(frames: readonly { payload: unknown; swipeId: string }[]) {
  const deps = agentModuleFrameDeps_ACU();
  let folded = foldAgentModuleSnapshot_ACU(frames.map(frame => ({
    [AGENT_MODULE_FIELD_ACU]: structuredClone(frame.payload), swipe_id: Number(frame.swipeId),
  })), deps);
  requireCheckpoint_ACU(!folded.salvaged && folded.candidates.every(item => item.valid), 'checkpoint 续写源帧未通过严格折叠。');
  if (!folded.contributed) {
    // 首基线的合法空载荷由既有折叠器建出规范栏目；水位不承担逻辑身份。
    const snapshot = { ...folded.snapshot, settledThroughIndex: 0 };
    requireCheckpoint_ACU(deps.validateSnapshot(snapshot), 'checkpoint 空资料基底无效。');
    folded = foldAgentModuleSnapshot_ACU([{ swipe_id: 0, [AGENT_MODULE_FIELD_ACU]: {
      schemaVersion: AGENT_MODULE_FRAME_SCHEMA_VERSION_ACU,
      checkpoint: { swipeId: '0', snapshot }, deltas: [],
    } }], deps);
  }
  return folded;
}

export function continuationCheckpointPayload_ACU(frames: readonly { payload: unknown; swipeId: string }[]): AgentModuleFloorFrame_ACU {
  const folded = foldCheckpointContinuation_ACU(frames);
  // 沿用资料帧的首基线契约；0 仅为未结算空载荷的合法水位，不代表任何逻辑楼层身份。
  if (!folded.contributed) folded.snapshot.settledThroughIndex = 0;
  requireCheckpoint_ACU(agentModuleFrameDeps_ACU().validateSnapshot(folded.snapshot),
    'checkpoint 资料基底未通过领域校验。');
  requireCheckpoint_ACU(validateAgentModuleFieldSnapshot_ACU(folded.fields, folded.snapshot), 'checkpoint 分栏基底无效。');
  const operationSeq = Math.max(0, ...frames.flatMap(({ payload }) => {
    if (!checkpointRecord_ACU(payload)) return [];
    const checkpoint = checkpointRecord_ACU(payload.checkpoint) ? payload.checkpoint : null;
    const deltas = Array.isArray(payload.deltas) ? payload.deltas : [];
    return [checkpoint?.operationSeq ?? 0, ...deltas.map(delta => checkpointRecord_ACU(delta) ? delta.seq : 0)]
      .filter(checkpointInteger_ACU);
  }));
  const payload: AgentModuleFloorFrame_ACU = { schemaVersion: AGENT_MODULE_FRAME_SCHEMA_VERSION_ACU,
    checkpoint: { swipeId: '0', snapshot: folded.snapshot, fieldSnapshot: folded.fields, operationSeq }, deltas: [] };
  const replay = foldCheckpointContinuation_ACU([{ payload, swipeId: '0' }]);
  requireCheckpoint_ACU(checkpointFingerprint_ACU([folded.snapshot, folded.fields])
    === checkpointFingerprint_ACU([replay.snapshot, replay.fields]), 'checkpoint 续写重建不等价。');
  return payload;
}
