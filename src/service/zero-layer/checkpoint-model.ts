import type { ZeroLayerFloorRef_ACU } from './timeline';
import type { ZeroLayerTableResult_ACU, ZeroLayerSimulationResult_ACU } from './model';
import type { AgentModuleFloorFrame_ACU } from '../continuation/agent/agent-model';
import type { TableCheckpointV2_ACU } from '../table/storage-frame-v2-types';

/** 独立位置命名空间；operationSeq 是载荷操作覆盖，不是 AI ordinal。 */
export interface ZeroLayerCheckpointPosition_ACU {
  schemaVersion: 1;
  ref: Extract<ZeroLayerFloorRef_ACU, { kind: 'logical' }>;
  aiOrdinal: number;
}

export interface ZeroLayerCheckpointMember_ACU {
  ref: ZeroLayerFloorRef_ACU;
  fingerprint: string;
  operationSeqs: number[];
}

/** 三类成员只存在同一个 carrier 内；不声称宿主具有跨存储事务。 */
export interface ZeroLayerCheckpointSet_ACU {
  schemaVersion: 1;
  checkpointId: string;
  sessionId: string;
  branchId: string;
  isolationKey: string;
  position: ZeroLayerCheckpointPosition_ACU;
  sourceRevision: number;
  sourceHeadTurnId: string;
  sourceFingerprint: string;
  triggeredAtAiCount: number;
  cadence: { retainRecentLayers: number; bufferLayers: number; periodicStepLayers: number };
  reason: 'compaction' | 'periodic';
  table: { payload: TableCheckpointV2_ACU; result: ZeroLayerTableResult_ACU };
  continuation: AgentModuleFloorFrame_ACU;
  simulation: ZeroLayerSimulationResult_ACU;
  covered: ZeroLayerCheckpointMember_ACU[];
  fingerprint: string;
}

/** 旧 active 与待确认候选并存；成员 immutable，active 是唯一生效选择。 */
export interface ZeroLayerCheckpointState_ACU {
  schemaVersion: 1;
  active: ZeroLayerCheckpointSet_ACU | null;
  pending: ZeroLayerCheckpointSet_ACU | null;
  cleanupPending: boolean;
  /** 已覆盖的原帧仅移入回放档案；正文和回退素材不删除。 */
  replayFrames: Record<string, unknown>;
}
