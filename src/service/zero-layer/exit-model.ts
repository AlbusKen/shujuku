import type { ZeroLayerFloorRef_ACU } from './timeline';
import type { ZeroLayerScope_ACU } from './model';

/** 退出只迁移附属状态，绝不创建或改写物理正文。 */
export interface ZeroLayerExitAssignment_ACU {
  messageIndex: number;
  field: string;
  before: { exists: boolean; value?: unknown };
  after: { exists: boolean; value?: unknown };
}

/** 意图与联合候选留在 carrier；prepared 不能授予普通生成资格。 */
export interface ZeroLayerExitManifest_ACU {
  schemaVersion: 1;
  exitId: string;
  phase: 'prepared' | 'committed';
  scope: ZeroLayerScope_ACU;
  sessionId: string;
  branchId: string;
  head: Extract<ZeroLayerFloorRef_ACU, { kind: 'logical' }>;
  sourceRevision: number;
  activationMessageCount: number;
  activationFingerprint: string;
  /** 冻结的物理正文/swipe 前缀；普通后缀不参与该证明。 */
  physicalPrefixSnapshot: string;
  target: Extract<ZeroLayerFloorRef_ACU, { kind: 'host' }>;
  configFingerprint: string;
  materialFingerprint: string;
  assignments: ZeroLayerExitAssignment_ACU[];
  candidateFingerprint: string;
  createdAt: number;
}

export interface ZeroLayerExitSelection_ACU {
  expectedRevision: number;
  head: Extract<ZeroLayerFloorRef_ACU, { kind: 'logical' }>;
  target: Extract<ZeroLayerFloorRef_ACU, { kind: 'host' }>;
}
