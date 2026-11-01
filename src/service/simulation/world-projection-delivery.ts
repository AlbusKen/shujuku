import type { WorldFact_ACU, WorldProjection_ACU } from './model';

export const WORLD_PROJECTION_MAX_DELIVERIES_ACU = 2;

/** 记录本轮实际入 prompt 的事实 ID；重复提交同一锚点不得重复增加尝试次数。 */
export function recordWorldProjectionDelivery_ACU(
  projection: WorldProjection_ACU, anchor: string, factIds: readonly string[],
): WorldProjection_ACU {
  if (!anchor.trim()) throw new Error('正文投送锚点不能为空');
  if (new Set(factIds).size !== factIds.length) throw new Error('正文投送事实 ID 重复');
  const next = structuredClone(projection);
  if (next.anchor === anchor) {
    const delivered = new Set(next.deliveries.filter(item => item.status === 'delivered').map(item => item.factId));
    if (factIds.length === delivered.size && factIds.every(id => delivered.has(id))) return next;
    throw new Error('同一正文锚点不能替换已记录的投送集合');
  }
  next.anchor = anchor;
  for (const id of factIds) {
    const previous = next.deliveries.find(item => item.factId === id);
    if (!previous) next.deliveries.push({ factId: id, status: 'delivered', attempts: 1 });
    else {
      if (previous.status !== 'delivered' || previous.attempts >= WORLD_PROJECTION_MAX_DELIVERIES_ACU) {
        throw new Error(`事实 ${id} 已确认或达到投送上限`);
      }
      previous.attempts += 1;
    }
  }
  return next;
}

/** 下一条稳定正文之后，按明确采用证明更新投送状态；不从“已放入 prompt”推断采用。 */
export function reconcileWorldProjectionDelivery_ACU(
  projection: WorldProjection_ACU, facts: readonly WorldFact_ACU[],
  acknowledgedFactIds: readonly string[], validFactIds: readonly string[],
): WorldProjection_ACU {
  const acknowledged = new Set(acknowledgedFactIds);
  const valid = new Set(validFactIds);
  if (acknowledged.size !== acknowledgedFactIds.length || valid.size !== validFactIds.length) throw new Error('投送状态确认 ID 重复');
  const byId = new Map(facts.map(item => [item.id, item]));
  if ([...acknowledged, ...valid].some(id => !byId.has(id))) throw new Error('投送确认引用了不存在的事实');
  if ([...acknowledged, ...valid].some(id => {
    const fact = byId.get(id)!;
    return fact.revealState !== 'unlocked' || fact.projectionPolicy === 'internal';
  })) throw new Error('锁定或内部事实不能作为正文投送确认');
  const next = structuredClone(projection);
  const pending = new Set(next.deliveries.filter(item => item.status === 'delivered').map(item => item.factId));
  const alreadyAcknowledged = new Set(next.deliveries.filter(item => item.status === 'acknowledged').map(item => item.factId));
  if ([...acknowledged].some(id => !pending.has(id) && !alreadyAcknowledged.has(id))) {
    throw new Error('仅已投送事实可确认采用');
  }
  for (const delivery of next.deliveries) {
    if (delivery.status !== 'delivered') continue;
    if (acknowledged.has(delivery.factId)) delivery.status = 'acknowledged';
    else if (!valid.has(delivery.factId) || delivery.attempts >= WORLD_PROJECTION_MAX_DELIVERIES_ACU) delivery.status = 'expired';
  }
  return next;
}
