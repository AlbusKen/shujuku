/**
 * service/chat/material-checkpoint-sync.ts — 续写/推演基线跟随表格 checkpoint 楼层
 *
 * 表格在边界、init、bridge 落层时通知这里。监听方把自己的基线折到同一楼。
 * 本模块不读取缓冲层数或 periodic 步长，避免把表格节奏复制成第二份参数。
 */

import { isV2TagData_ACU } from '../table/storage-strategy-resolver';
import { logWarn_ACU } from '../../shared/utils';

/** 随迁时需要和表格保存一起回滚的楼层字段。 */
export const MATERIAL_CHECKPOINT_FIELDS_ACU = [
  '_qrf_continuation_agent',
  '_qrf_world_simulation_state',
  '_qrf_world_simulation_agent_materials',
  '_qrf_world_simulation_chronicle_archive',
] as const;

export interface MaterialFieldSnapshot_ACU {
  field: string;
  existed: boolean;
  value: unknown;
}

export interface MaterialCheckpointChangedField_ACU {
  index: number;
  field: string;
}

export interface MaterialCheckpointSyncHandle_ACU {
  changedFields: MaterialCheckpointChangedField_ACU[];
  rollback: () => void;
}

type MaterialCheckpointSync_ACU = (chat: unknown[], anchorIndex: number) => void;

export interface MaterialCheckpointRecoveryAdapter_ACU {
  capture(message: unknown): {
    continuation: { swipeId: string; snapshot: unknown } | null;
    simulation: { anchor: unknown; ledger: unknown } | null;
  } | null;
  graftContinuation(message: unknown, artifact: { swipeId: string; snapshot: unknown }): boolean;
  graftSimulation(chat: unknown[], message: unknown, artifact: { anchor: unknown; ledger: unknown }): boolean;
  assertContinuation(chat: readonly unknown[]): string | null;
  assertSimulation(chat: readonly unknown[]): string | null;
}

const listeners_ACU: MaterialCheckpointSync_ACU[] = [];
let recoveryAdapter_ACU: MaterialCheckpointRecoveryAdapter_ACU | null = null;

export function registerMaterialCheckpointRecoveryAdapter_ACU(adapter: MaterialCheckpointRecoveryAdapter_ACU): void {
  recoveryAdapter_ACU = adapter;
}

export function captureMaterialCheckpointRecovery_ACU(message: unknown): ReturnType<MaterialCheckpointRecoveryAdapter_ACU['capture']> {
  return recoveryAdapter_ACU?.capture(message) ?? null;
}

export function graftMaterialContinuationCheckpoint_ACU(message: unknown, artifact: { swipeId: string; snapshot: unknown }): boolean {
  return recoveryAdapter_ACU?.graftContinuation(message, artifact) ?? false;
}

export function graftMaterialSimulationCheckpoint_ACU(chat: unknown[], message: unknown, artifact: { anchor: unknown; ledger: unknown }): boolean {
  return recoveryAdapter_ACU?.graftSimulation(chat, message, artifact) ?? false;
}

export function assertMaterialContinuationCheckpoint_ACU(chat: readonly unknown[]): string | null {
  return recoveryAdapter_ACU?.assertContinuation(chat) ?? null;
}

export function assertMaterialSimulationCheckpoint_ACU(chat: readonly unknown[]): string | null {
  return recoveryAdapter_ACU?.assertSimulation(chat) ?? null;
}

export function registerMaterialCheckpointFloorSync_ACU(listener: MaterialCheckpointSync_ACU): void {
  if (!listeners_ACU.includes(listener)) listeners_ACU.push(listener);
}

/** 当前聊天里最后一个 V2 full checkpoint 的楼层。没有表格基线时返回 null。 */
export function findLatestTableFullCheckpointIndex_ACU(chat: readonly unknown[]): number | null {
  let latest: number | null = null;
  for (let index = 0; index < chat.length; index += 1) {
    const message = chat[index];
    if (!message || typeof message !== 'object') continue;
    const container = (message as { TavernDB_ACU_IsolatedData?: unknown }).TavernDB_ACU_IsolatedData;
    if (!container || typeof container !== 'object' || Array.isArray(container)) continue;
    for (const tagData of Object.values(container)) {
      if (!isV2TagData_ACU(tagData)) continue;
      if (tagData.storageFrame.checkpoint?.kind === 'full') {
        latest = index;
        break;
      }
    }
  }
  return latest;
}

export function snapshotMaterialCheckpointFields_ACU(chat: readonly unknown[]): MaterialFieldSnapshot_ACU[][] {
  return chat.map(message => MATERIAL_CHECKPOINT_FIELDS_ACU.map(field => ({
    field,
    existed: !!message && typeof message === 'object' && Object.prototype.hasOwnProperty.call(message, field),
    value: message && typeof message === 'object' ? (message as Record<string, unknown>)[field] : undefined,
  })));
}

export function restoreMaterialCheckpointFields_ACU(chat: unknown[], snapshots: readonly MaterialFieldSnapshot_ACU[][]): void {
  snapshots.forEach((fields, index) => {
    const message = chat[index];
    if (!message || typeof message !== 'object') return;
    const container = message as Record<string, unknown>;
    for (const item of fields) {
      if (item.existed) container[item.field] = item.value;
      else delete container[item.field];
    }
  });
}

export function notifyMaterialCheckpointFloor_ACU(chat: unknown[], anchorIndex: number): void {
  for (const listener of listeners_ACU) {
    try {
      listener(chat, anchorIndex);
    } catch (error) {
      logWarn_ACU(`[资料基线] 跟随表格 checkpoint 楼层 #${anchorIndex} 失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * 先快照资料字段，再通知随迁，并精确追踪实际发生改动的 `(index, field)` 集合。
 * - 若监听方未修改任何资料字段，返回 `null`（调用方无需监视或回滚无关楼层的 `_qrf_*` 字段）；
 * - 若发生改动，返回的 `rollback` 仅还原实际改动的字段，避免覆盖保存窗口内并发提交的无关楼层资料。
 */
export function beginMaterialCheckpointSyncTracked_ACU(
  chat: unknown[],
  anchorIndex: number,
): MaterialCheckpointSyncHandle_ACU | null {
  const before = chat.map((message, index) => MATERIAL_CHECKPOINT_FIELDS_ACU.map(field => {
    const isObj = !!message && typeof message === 'object';
    const existed = isObj && Object.prototype.hasOwnProperty.call(message, field);
    const value = isObj ? (message as Record<string, unknown>)[field] : undefined;
    return {
      index,
      field,
      existed,
      value,
      serialized: JSON.stringify(value),
    };
  }));
  notifyMaterialCheckpointFloor_ACU(chat, anchorIndex);
  const changed: Array<{
    index: number;
    field: string;
    existed: boolean;
    value: unknown;
    serialized: string | undefined;
  }> = [];
  for (let index = 0; index < before.length; index += 1) {
    const message = chat[index];
    const isObj = !!message && typeof message === 'object';
    for (const item of before[index]) {
      const afterExisted = isObj && Object.prototype.hasOwnProperty.call(message, item.field);
      const afterSerialized = isObj ? JSON.stringify((message as Record<string, unknown>)[item.field]) : undefined;
      if (afterExisted !== item.existed || afterSerialized !== item.serialized) {
        changed.push(item);
      }
    }
  }
  if (changed.length === 0) return null;
  return {
    changedFields: changed.map(({ index, field }) => ({ index, field })),
    rollback: () => {
      for (const item of changed) {
        const message = chat[item.index];
        if (!message || typeof message !== 'object') continue;
        const container = message as Record<string, unknown>;
        if (item.existed) {
          container[item.field] = item.serialized === undefined ? item.value : JSON.parse(item.serialized);
        } else {
          delete container[item.field];
        }
      }
    },
  };
}

/** 先快照资料字段，再通知随迁。返回的函数把实际改动过的字段还原到通知前。 */
export function beginMaterialCheckpointSync_ACU(chat: unknown[], anchorIndex: number): () => void {
  const handle = beginMaterialCheckpointSyncTracked_ACU(chat, anchorIndex);
  return handle ? handle.rollback : () => {};
}
