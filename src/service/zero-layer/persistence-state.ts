import type { ZeroLayerEnvelope_ACU } from './model';
import type { ZeroLayerExitAssignment_ACU } from './exit-model';

export interface PendingZeroLayerPersistence_ACU {
  assignments?: { values: ZeroLayerExitAssignment_ACU[]; beforeSide: 'before' | 'after' };
  before: ZeroLayerEnvelope_ACU | null;
  candidate: ZeroLayerEnvelope_ACU;
  source: string;
}

/** store 与普通发送门共用唯一未知保存账本；仅显式服务器回读可解除。 */
export const pendingZeroLayerPersistence_ACU = new Map<string, PendingZeroLayerPersistence_ACU>();
