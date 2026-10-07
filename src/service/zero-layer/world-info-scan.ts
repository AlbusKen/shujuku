import { settings_ACU } from '../runtime/state-manager';
import type { ZeroLayerEnvelope_ACU } from './model';
import { getPublishedZeroLayerPath_ACU } from './timeline';

export const ZERO_LAYER_WORLD_INFO_SCAN_DEFAULT_ROUNDS_ACU = 2;
export const ZERO_LAYER_WORLD_INFO_SCAN_MAX_ROUNDS_ACU = 100;

/** 0 表示关闭；缺失或非法值按默认轮数读取，超过上限按上限。 */
export function normalizeZeroLayerWorldInfoScanRounds_ACU(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ZERO_LAYER_WORLD_INFO_SCAN_DEFAULT_ROUNDS_ACU;
  return Math.min(ZERO_LAYER_WORLD_INFO_SCAN_MAX_ROUNDS_ACU, Math.max(0, Math.trunc(value)));
}

export function readZeroLayerWorldInfoScanRounds_ACU(): number {
  return normalizeZeroLayerWorldInfoScanRounds_ACU(settings_ACU?.zeroLayerWorldInfoScanRounds);
}

/** 一轮 = 一个已发布 AI 回复；两次 AI 回复之间的用户输入计入内容不计轮数，最早一轮之前的输入不在窗口内。 */
export function buildZeroLayerWorldInfoScanText_ACU(envelope: ZeroLayerEnvelope_ACU, rounds: number): string {
  if (rounds <= 0) return '';
  return getPublishedZeroLayerPath_ACU(envelope).slice(-rounds)
    .flatMap((turn, index) => index === 0 ? [turn.body ?? ''] : [turn.input, turn.body ?? ''])
    .filter(text => text.trim()).join('\n');
}
