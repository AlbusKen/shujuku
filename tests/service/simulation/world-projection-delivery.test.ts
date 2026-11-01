import { describe, expect, it } from 'vitest';
import { recordWorldProjectionDelivery_ACU, reconcileWorldProjectionDelivery_ACU } from '../../../src/service/simulation/world-projection-delivery';
import type { WorldFact_ACU } from '../../../src/service/simulation/model';

const fact: WorldFact_ACU = { id: 'fact-1', summary: '广场有舞台', temporalKind: 'condition',
  happenedAt: null, validFrom: { day: 1, slot: '' }, validUntil: { day: 4, slot: '' },
  locationRef: { region: '上海', place: '广场' }, actorIds: [], worldEventIds: [],
  projectionPolicy: 'scene', revealState: 'unlocked', revealGate: null, nextCheck: null,
  sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 };

describe('格林推演正文事实投送状态', () => {
  it('首次入 prompt 是 delivered，不等于正文已采用；同一锚点重试幂等', () => {
    const empty = { anchor: null, deliveries: [] };
    const first = recordWorldProjectionDelivery_ACU(empty, 'anchor-1', ['fact-1']);
    expect(first).toEqual({ anchor: 'anchor-1', deliveries: [{ factId: 'fact-1', status: 'delivered', attempts: 1 }] });
    expect(recordWorldProjectionDelivery_ACU(first, 'anchor-1', ['fact-1'])).toEqual(first);
    expect(() => recordWorldProjectionDelivery_ACU(first, 'anchor-1', [])).toThrow(/不能替换/);
    expect(empty.deliveries).toEqual([]);
  });

  it('下一条稳定正文确认采用后标记 acknowledged，不改写事实真伪', () => {
    const delivered = recordWorldProjectionDelivery_ACU({ anchor: null, deliveries: [] }, 'anchor-1', ['fact-1']);
    const acknowledged = reconcileWorldProjectionDelivery_ACU(delivered, [fact], ['fact-1'], ['fact-1']);
    expect(acknowledged.deliveries[0]).toMatchObject({ status: 'acknowledged', attempts: 1 });
    expect(reconcileWorldProjectionDelivery_ACU(acknowledged, [fact], ['fact-1'], ['fact-1'])).toEqual(acknowledged);
    expect(fact.revealState).toBe('unlocked');
    expect(delivered.deliveries[0].status).toBe('delivered');
    expect(() => recordWorldProjectionDelivery_ACU(acknowledged, 'anchor-2', ['fact-1'])).toThrow(/已确认或达到投送上限/);
  });

  it('未采用且有效仅允许一次重投，二次未采用或事实失效时 expired', () => {
    const first = recordWorldProjectionDelivery_ACU({ anchor: null, deliveries: [] }, 'anchor-1', ['fact-1']);
    const pending = reconcileWorldProjectionDelivery_ACU(first, [fact], [], ['fact-1']);
    expect(pending.deliveries[0].status).toBe('delivered');
    const second = recordWorldProjectionDelivery_ACU(pending, 'anchor-2', ['fact-1']);
    expect(second.deliveries[0].attempts).toBe(2);
    const stopped = reconcileWorldProjectionDelivery_ACU(second, [fact], [], ['fact-1']);
    expect(stopped.deliveries[0].status).toBe('expired');
    expect(() => recordWorldProjectionDelivery_ACU(stopped, 'anchor-3', ['fact-1'])).toThrow(/已确认或达到投送上限/);
    const invalidated = reconcileWorldProjectionDelivery_ACU(first, [fact], [], []);
    expect(invalidated.deliveries[0].status).toBe('expired');
  });

  it('重复事实 ID、未投送事实确认以及同锚点不同集合均拒绝', () => {
    const first = recordWorldProjectionDelivery_ACU({ anchor: null, deliveries: [] }, 'anchor-1', ['fact-1']);
    expect(() => recordWorldProjectionDelivery_ACU(first, 'anchor-1', ['other'])).toThrow(/不能替换/);
    expect(() => recordWorldProjectionDelivery_ACU(first, 'anchor-2', ['fact-1', 'fact-1'])).toThrow(/事实 ID 重复/);
    expect(() => reconcileWorldProjectionDelivery_ACU(first, [fact], ['fact-1', 'fact-1'], ['fact-1'])).toThrow(/ID 重复/);
    expect(() => reconcileWorldProjectionDelivery_ACU(first, [fact], ['not-delivered'], ['fact-1'])).toThrow(/不存在的事实/);
    expect(() => reconcileWorldProjectionDelivery_ACU(first, [{ ...fact, revealState: 'locked' }], [], ['fact-1']))
      .toThrow(/锁定或内部事实不能作为正文投送确认/);
  });
});
