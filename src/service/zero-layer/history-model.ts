import type { ZeroLayerFloorRef_ACU } from './timeline';

export const ZERO_LAYER_HISTORY_VERSION_ACU = 1;
export const ZERO_LAYER_HISTORY_DEFAULT_LIMIT_ACU = 20;
export const ZERO_LAYER_HISTORY_MAX_LIMIT_ACU = 100;
export type ZeroLayerHistoryErrorCode_ACU = 'mode-disabled' | 'loading' | 'not-ready'
  | 'access-denied' | 'unsupported-version' | 'invalid-query' | 'not-found'
  | 'storage-read-failed' | 'corrupt-data' | 'snapshot-stale' | 'scope-changed' | 'history-unavailable';
export type ZeroLayerHistoryResult_ACU<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: ZeroLayerHistoryErrorCode_ACU;
      readonly message: string; readonly retryable: boolean; readonly recoveryAction: string } };
export type ZeroLayerHistoryStatus_ACU = 'preparing' | 'published' | 'busy' | 'recovery-required';
export type ZeroLayerJsonValue_ACU = null | boolean | number | string
  | readonly ZeroLayerJsonValue_ACU[] | { readonly [key: string]: ZeroLayerJsonValue_ACU };
export type ZeroLayerPublicState_ACU =
  | { readonly availability: 'unavailable' | 'invalid'; readonly value: null }
  | { readonly availability: 'available'; readonly value: ZeroLayerJsonValue_ACU };
export interface ZeroLayerSessionSnapshot_ACU {
  readonly protocolVersion: 1;
  readonly sessionId: string;
  readonly branchId: string;
  readonly carrierRef: { readonly carrierId: string; readonly swipeId: number };
  readonly revision: number;
  readonly headTurnId: string | null;
  readonly currentBody: string;
  readonly currentPublicState: ZeroLayerPublicState_ACU;
  readonly status: ZeroLayerHistoryStatus_ACU;
  readonly snapshotToken: string;
}
export interface ZeroLayerHistoryItem_ACU {
  readonly turnId: string;
  readonly parentTurnId: string | null;
  readonly input: string;
  readonly body: string;
  readonly publicState: ZeroLayerPublicState_ACU;
  readonly settlement: readonly { readonly kind: 'plot' | 'table' | 'continuation' | 'simulation';
    readonly status: 'durable' | 'skipped-by-config' }[];
  /** 仅宿主授权诊断读取携带；普通游戏历史始终只有 published。 */
  readonly diagnostic?: { readonly phase: string; readonly errorCode: string | null };
  readonly userRef: ZeroLayerFloorRef_ACU;
  readonly assistantRef: ZeroLayerFloorRef_ACU;
}
export interface ZeroLayerHistoryQuery_ACU {
  readonly version: 1;
  readonly snapshotToken?: string;
  readonly cursor?: string;
  readonly direction?: 'older' | 'newer';
  readonly limit?: number;
  readonly turnId?: string;
}
export interface ZeroLayerHistoryPage_ACU {
  readonly items: readonly ZeroLayerHistoryItem_ACU[];
  readonly snapshotToken: string;
  readonly sourceRevision: number;
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}
export interface ZeroLayerHistoryChange_ACU {
  readonly kind: 'snapshot' | 'changed' | 'scope-invalidated';
  readonly sessionId: string;
  readonly branchId: string;
  readonly revision: number;
  readonly headTurnId: string | null;
}
export interface ZeroLayerHistoryApi_ACU {
  getSnapshot(query: { readonly version: 1 }): Promise<ZeroLayerHistoryResult_ACU<ZeroLayerSessionSnapshot_ACU>>;
  readHistory(query: ZeroLayerHistoryQuery_ACU): Promise<ZeroLayerHistoryResult_ACU<ZeroLayerHistoryPage_ACU>>;
  subscribe(listener: (change: ZeroLayerHistoryChange_ACU) => void): () => void;
}
