import type { ZeroLayerPublicState_ACU, ZeroLayerJsonValue_ACU } from './history-model';

/** 公开状态只能来自已公开正文的显式协议块，绝不从数据库或 Agent 私有字段推断。 */
export function projectZeroLayerPublicState_ACU(body: string): ZeroLayerPublicState_ACU {
  const blocks = [...body.matchAll(/<acu-public-state\s+version="1">([\s\S]*?)<\/acu-public-state>/g)];
  if (!blocks.length) return { availability: 'unavailable', value: null };
  if (blocks.length !== 1) return { availability: 'invalid', value: null };
  try {
    const value: unknown = JSON.parse(blocks[0][1]);
    if (!isPublicJson_ACU(value)) return { availability: 'invalid', value: null };
    return { availability: 'available', value: structuredClone(value) };
  } catch { return { availability: 'invalid', value: null }; }
}

function isPublicJson_ACU(value: unknown): value is ZeroLayerJsonValue_ACU {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isPublicJson_ACU);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).every(([key, item]) =>
    !['__proto__', 'prototype', 'constructor'].includes(key) && isPublicJson_ACU(item));
}
