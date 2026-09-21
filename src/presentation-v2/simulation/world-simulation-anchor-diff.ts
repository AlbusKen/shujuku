import type { WorldSimulationError_ACU } from '../../service/simulation/model';

const ANCHOR_DIFF_FIELDS_ACU = ['chatIdentity', 'messageKey', 'swipeId', 'contentDigest'] as const;
const DIGEST_DISPLAY_CHARS_ACU = 12;

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function displayAnchorField_ACU(field: typeof ANCHOR_DIFF_FIELDS_ACU[number], value: unknown): string {
  const text = typeof value === 'string' ? value : value == null ? '' : String(value);
  if (field === 'contentDigest' && text.length > DIGEST_DISPLAY_CHARS_ACU) return text.slice(0, DIGEST_DISPLAY_CHARS_ACU);
  return text;
}

/**
 * 把 WORLD_SIMULATION_ANCHOR_STALE 的 expected/actual 收成一行只读差异。
 * details 缺失、结构不对、或四元组完全一致时返回空串，调用方不渲染。
 */
export function formatWorldSimulationAnchorStaleDiff_ACU(error: WorldSimulationError_ACU | null | undefined): string {
  if (!error || error.code !== 'WORLD_SIMULATION_ANCHOR_STALE' || !isRecord_ACU(error.details)) return '';
  const expected = error.details.expected;
  const actual = error.details.actual;
  if (!isRecord_ACU(expected) || !isRecord_ACU(actual)) return '';
  const parts: string[] = [];
  for (const field of ANCHOR_DIFF_FIELDS_ACU) {
    const expectedValue = expected[field];
    const actualValue = actual[field];
    if (expectedValue === actualValue) continue;
    parts.push(`${field} expected=${displayAnchorField_ACU(field, expectedValue)} actual=${displayAnchorField_ACU(field, actualValue)}`);
  }
  return parts.length ? `锚点差异：${parts.join('；')}` : '';
}
