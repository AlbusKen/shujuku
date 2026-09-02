/**
 * service/table/manual-update-settings.ts — 手动填表 / 一键追平的独立参数解析
 *
 * 手动面板上的「手动处理最近 N 层」与「每 N 层合并为一次填表」是手动路径自己的设置，
 * 与自动填表的 autoUpdateThreshold / updateBatchSize 独立。手动更新与追平都只从这里取值，
 * 不再由 UI 层临时改写自动填表的全局设置来“桥接”。
 */

import { settings_ACU } from '../runtime/state-manager';

function normalizePositiveInteger_ACU(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

function normalizeNonNegativeInteger_ACU(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

/** 手动面板的显示默认；未设置过时用它，而不是自动填表的批大小。 */
export const MANUAL_UPDATE_BATCH_SIZE_DEFAULT_ACU = 3;

/**
 * 「每 N 层合并为一次填表」：手动更新与一键追平共用。
 * 未设置时回落 3，不回落到自动填表的 updateBatchSize。
 */
export function resolveManualUpdateBatchSize_ACU(): number {
  return settings_ACU.manualUpdateBatchSize == null
    ? MANUAL_UPDATE_BATCH_SIZE_DEFAULT_ACU
    : normalizePositiveInteger_ACU(settings_ACU.manualUpdateBatchSize, MANUAL_UPDATE_BATCH_SIZE_DEFAULT_ACU);
}

/**
 * 「手动处理最近 N 层」。未设置过时沿用自动填表阈值作为初始默认（历史行为）；
 * 用户在手动面板设置过之后只认手动值。
 */
export function resolveManualUpdateContextDepth_ACU(): number {
  const fallback = normalizeNonNegativeInteger_ACU(settings_ACU.autoUpdateThreshold, 3);
  return settings_ACU.manualUpdateContextDepth == null
    ? fallback
    : normalizeNonNegativeInteger_ACU(settings_ACU.manualUpdateContextDepth, fallback);
}
