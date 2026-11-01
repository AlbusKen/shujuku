import { describe, expect, it } from 'vitest';
import { normalizeWorldEventWrite_ACU, normalizeWorldFactWrite_ACU } from '../../../../src/service/simulation/agent/world-write-normalization';
import type { WorldClock_ACU, WorldEvent_ACU, WorldFact_ACU } from '../../../../src/service/simulation/model';

const clock = (day: number, storyTime: string): WorldClock_ACU => ({ day, storyTime, slot: '上午', precision: 'exact', evidenceRefs: [] });
const context = {
  baseClock: clock(1, '2017年3月6日'), candidateClock: clock(1, '2017-03-06'),
  location: { region: '南师附中', place: '高三理科重点班教室' },
};
const event = (patch: Record<string, unknown> = {}): WorldEvent_ACU => ({
  id: 'event-a', title: '晨间事件', state: '准备', status: 'ACTIVE',
  actorIds: 'actor-a', locationRefs: ['南师附中-高三理科重点班教室'],
  startedAt: '2017-03-06T08:15:00', deadline: '2017-03-07T12:00:00',
  nextCheck: { day: '1', slot: '上午' }, legacy: false, revision: 1, ...patch,
} as unknown as WorldEvent_ACU);
const fact = (patch: Record<string, unknown> = {}): WorldFact_ACU => ({
  id: 'fact-a', summary: '晨间确有动静', temporalKind: 'occurrence', happenedAt: '2017-03-06T08:15:00',
  validFrom: '2017-03-06T08:15:00', locationRef: '南师附中-高三理科重点班教室',
  actorIds: 'actor-a', worldEventIds: 'event-a', projectionPolicy: 'internal', revealState: 'locked',
  sourceRefs: 'source-a', revision: 1, ...patch,
} as unknown as WorldFact_ACU);

describe('世界事件/事实模型写入的合同投影', () => {
  it('归一真实的两个事件与四条事实，不改变业务、引用和权限', () => {
    const first = normalizeWorldEventWrite_ACU(event({ extra: 'discard' }), context);
    const second = normalizeWorldEventWrite_ACU(event({ id: 'event-b', locationRefs: { region: '旧城区', place: '南门' }, nextCheck: undefined }), context);
    expect(first).toEqual({ id: 'event-a', title: '晨间事件', state: '准备', status: 'active',
      actorIds: ['actor-a'], organizationIds: [], locationRefs: [{ region: '南师附中', place: '高三理科重点班教室' }],
      startedAt: { day: 1, slot: '08:15:00' }, deadline: { day: 2, slot: '12:00:00' },
      nextCheck: { day: 1, slot: '上午', reason: '后续复查' }, relatedEventIds: [], loreRefs: [],
      evidenceRefs: [], tags: [], revision: 1, legacy: null });
    expect(second.locationRefs).toEqual([{ region: '旧城区', place: '南门' }]);
    expect(second.nextCheck).toBeNull();
    const facts = [
      fact(),
      fact({ id: 'fact-b', locationRef: '未登记地点', happenedAt: '2017年3月6日' }),
      fact({ id: 'fact-c', temporalKind: 'condition', happenedAt: '2017-03-06', validFrom: '2017-03-06T09:00:00', validUntil: '2017-03-07', nextCheck: { day: '2' } }),
      fact({ id: 'fact-d', temporalKind: 'condition', happenedAt: null, validFrom: '2017-03-06T10:00:00' }),
    ].map(item => normalizeWorldFactWrite_ACU(item, context));
    expect(facts.map(item => item.happenedAt)).toEqual([{ day: 1, slot: '08:15:00' }, { day: 1, slot: '' }, null, null]);
    expect(facts.map(item => item.validFrom)).toEqual([null, null, { day: 1, slot: '09:00:00' }, { day: 1, slot: '10:00:00' }]);
    expect(facts[2].validUntil).toEqual({ day: 2, slot: '' });
    expect(facts[2].nextCheck).toEqual({ day: 2, slot: '', reason: '后续复查' });
    expect(facts[3].nextCheck).toEqual({ day: 2, slot: '上午', reason: '后续复查' });
    expect(normalizeWorldFactWrite_ACU(fact({ nextCheck: { day: '2017-03-13', slot: '傍晚' } }), context).nextCheck)
      .toEqual({ day: 8, slot: '傍晚', reason: '后续复查' });
    expect(facts[1].locationRef).toEqual({ region: '未登记地点' });
    expect(facts[0]).toMatchObject({ actorIds: ['actor-a'], worldEventIds: ['event-a'],
      projectionPolicy: 'internal', revealState: 'locked', revealGate: null, sourceRefs: ['source-a'],
      evidenceRefs: [], supersedesFactIds: [], nextCheck: null });
    expect(Object.keys(first).sort()).toEqual(['id', 'title', 'state', 'status', 'actorIds', 'organizationIds', 'locationRefs', 'startedAt', 'deadline', 'nextCheck', 'relatedEventIds', 'loreRefs', 'evidenceRefs', 'tags', 'revision', 'legacy'].sort());
    expect(Object.keys(facts[0]).sort()).toEqual(['id', 'summary', 'temporalKind', 'happenedAt', 'validFrom', 'validUntil', 'locationRef', 'actorIds', 'worldEventIds', 'projectionPolicy', 'revealState', 'revealGate', 'nextCheck', 'sourceRefs', 'evidenceRefs', 'supersedesFactIds', 'revision'].sort());
  });

  it('跨月及闰年按 UTC 日历差计算，不转换故事当地日期与时刻，优先以候选时钟为锚', () => {
    const anchor = { ...context, baseClock: clock(40, '2024-02-27'), candidateClock: clock(42, '2024年2月29日') };
    expect(normalizeWorldEventWrite_ACU(event({ startedAt: '2024-03-01T00:30:00+02:00', deadline: '2024-03-01T00:00:00Z' }), anchor))
      .toMatchObject({ startedAt: { day: 43, slot: '00:30:00' }, deadline: { day: 43, slot: '00:00:00' } });
    expect(normalizeWorldFactWrite_ACU(fact({ happenedAt: '2024-02-28' }), anchor).happenedAt).toEqual({ day: 41, slot: '' });
    expect(normalizeWorldEventWrite_ACU(event({ nextCheck: { day: '2024-03-01', slot: '傍晚' } }), anchor).nextCheck)
      .toEqual({ day: 43, slot: '傍晚', reason: '后续复查' });
    const previousMonth = { ...context, baseClock: clock(90, '2024-03-01'), candidateClock: clock(91, '上午') };
    expect(normalizeWorldFactWrite_ACU(fact({ happenedAt: '2024-02-29T00:20:00+08:00' }), previousMonth).happenedAt)
      .toEqual({ day: 89, slot: '00:20:00' });
  });

  it('故事时间没有明确日期或输入无效时不猜日期，不以机器当前日期覆盖', () => {
    const unknown = { ...context, baseClock: clock(7, '春天'), candidateClock: clock(9, '上午') };
    expect(normalizeWorldFactWrite_ACU(fact(), unknown).happenedAt).toBe('2017-03-06T08:15:00');
    expect(normalizeWorldEventWrite_ACU(event({ startedAt: '2017-02-30', status: 'maybe', locationRefs: ['任意地方'] }), context))
      .toMatchObject({ startedAt: '2017-02-30', status: 'maybe', locationRefs: [{ region: '任意地方' }] });
    expect(normalizeWorldEventWrite_ACU(event({ status: 'RESOLVED', nextCheck: undefined }), context).nextCheck).toBeNull();
    expect(normalizeWorldEventWrite_ACU(event({ nextCheck: '无法解析' }), context).nextCheck).toBe('无法解析');
    expect(normalizeWorldFactWrite_ACU(fact({ locationRef: '高三理科重点班教室' }), context).locationRef)
      .toEqual({ region: '南师附中', place: '高三理科重点班教室' });
  });

  it('局部坏字段不使 helper 抛错，数组缺省和对象 key 顺序稳定', () => {
    const bad = normalizeWorldEventWrite_ACU(event({ startedAt: 999, actorIds: { unexpected: true }, locationRefs: null, nextCheck: { day: 'oops' } }), context);
    expect(bad.startedAt).toBe(999);
    expect(bad.actorIds).toEqual({ unexpected: true });
    expect(bad.locationRefs).toEqual([]);
    expect(bad.nextCheck).toEqual({ day: 'oops', slot: '', reason: '后续复查' });
    const a = normalizeWorldFactWrite_ACU(fact({ happenedAt: { slot: '午后', day: '1', extra: 'ignored' }, actorIds: null, locationRef: '' }), context);
    expect(a.happenedAt).toEqual({ day: 1, slot: '午后' });
    expect(Object.keys(a.happenedAt!)).toEqual(['day', 'slot']);
    expect(a.actorIds).toEqual([]);
    expect(a.locationRef).toBeNull();
  });
});
