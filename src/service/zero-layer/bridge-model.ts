import type { ZeroLayerContinuationState_ACU, ZeroLayerSimulationState_ACU, ZeroLayerTableInput_ACU } from './model';
import type { ZeroLayerFloorRef_ACU } from './timeline';
import type { TableCheckpointV2_ACU } from '../table/storage-frame-v2-types';
import type { WorldSimulationCompletedAnchor_ACU } from '../simulation/model';
import type { TableDataObject_ACU } from '../../shared/models/table-data';

export const ZERO_LAYER_BRIDGE_PHASES_ACU = ['inventory', 'normalized', 'candidate', 'verified', 'activated', 'reconciled'] as const;
export type ZeroLayerBridgePhase_ACU = typeof ZERO_LAYER_BRIDGE_PHASES_ACU[number];

/** 旧完成记录的源限定证明；不授予宿主锚点逻辑运行资格。 */
export interface ZeroLayerBridgeHostCompletion_ACU {
  taskId: string;
  ref: Extract<ZeroLayerFloorRef_ACU, { kind: 'host' }>;
  anchor: Exclude<WorldSimulationCompletedAnchor_ACU, { kind: 'logical' }>;
}

/** 边界不是新正文楼层；host refs 仅在该物理源指纹内具有只读定位意义。 */
export interface ZeroLayerActivationCut_ACU {
  schemaVersion: 1;
  sourceFingerprint: string;
  messageCount: number;
  completedAiCount: number;
  refs: Extract<ZeroLayerFloorRef_ACU, { kind: 'host' }>[];
}

/** Inventory 冻结的只读输入；只保存回放所需配置，不携带 API 凭据。 */
export interface ZeroLayerBridgeConfig_ACU {
  schemaVersion: 1;
  chatKey: string;
  isolationKey: string;
  storageMode: ZeroLayerTableInput_ACU['storageMode'];
  guideData: Record<string, unknown>;
  templateData: TableDataObject_ACU;
  settings: {
    dataIsolationEnabled: boolean;
    dataIsolationCode: string;
    autoUpdateEnabled: boolean;
    autoUpdateFrequency: number;
    skipUpdateFloors: number;
    autoUpdateThreshold: number;
    updateBatchSize: number;
  };
}

export interface ZeroLayerBridgeCandidate_ACU {
  schemaVersion: 1;
  table: { input: ZeroLayerTableInput_ACU; payload: TableCheckpointV2_ACU };
  continuation: ZeroLayerContinuationState_ACU;
  simulation: ZeroLayerSimulationState_ACU;
  simulationHostCompletion: ZeroLayerBridgeHostCompletion_ACU | null;
  /** 明确缺失与合法空状态分开登记，不以模块开关推测历史。 */
  availability: { table: 'persisted' | 'pristine'; continuation: 'persisted' | 'absent'; simulation: 'persisted' | 'absent' };
  fingerprint: string;
}

export interface ZeroLayerBridgeReceipt_ACU {
  phase: ZeroLayerBridgePhase_ACU;
  sourceRevision: number;
  sourceFingerprint: string;
  normalizedFingerprint: string | null;
}

/** 六阶段均只写 carrier；候选与旧物理资料并存，reconciled 前不开放零层资格。 */
export interface ZeroLayerBridgeState_ACU {
  schemaVersion: 1;
  migrationId: string;
  phase: ZeroLayerBridgePhase_ACU;
  sourceRevision: number;
  sourceFingerprint: string;
  createdAt: number;
  config: ZeroLayerBridgeConfig_ACU;
  configFingerprint: string;
  activationCut: ZeroLayerActivationCut_ACU;
  /** Normalize 只保存可复核指纹，候选载荷在 Candidate 阶段才落盘。 */
  normalizedFingerprint: string | null;
  candidate: ZeroLayerBridgeCandidate_ACU | null;
  receipts: ZeroLayerBridgeReceipt_ACU[];
}
