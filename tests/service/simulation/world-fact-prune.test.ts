import { describe, expect, it } from 'vitest';
import { buildEmptyWorldSimulationLedger_ACU } from '../../../src/service/simulation/defaults';
import { materializeWorldRoundCandidate_ACU, type WorldRoundCandidate_ACU } from '../../../src/service/simulation/world-candidate';
import {
  buildWorldEventPruneCatalog_ACU, buildWorldFactPruneCatalog_ACU, isInternalManagedWorldFact_ACU, parseWorldEventPruneIds_ACU,
  parseWorldFactPruneIds_ACU, selectRemovableWorldEventIds_ACU, selectRemovableWorldFactIds_ACU,
} from '../../../src/service/simulation/world-fact-prune';
import type { WorldEvent_ACU, WorldFact_ACU, WorldSimulationLedger_ACU } from '../../../src/service/simulation/model';

function fact(id: string, patch: Partial<WorldFact_ACU> = {}): WorldFact_ACU {
  return { id, summary: `事实 ${id}`, temporalKind: 'occurrence', happenedAt: { day: 1, slot: '' }, validFrom: null, validUntil: null,
    locationRef: null, actorIds: [], worldEventIds: [], projectionPolicy: 'internal', revealState: 'locked', revealGate: null,
    nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1, ...patch };
}
function round(base: WorldSimulationLedger_ACU, patch: Partial<WorldRoundCandidate_ACU> = {}): WorldRoundCandidate_ACU {
  return { baseRevision: base.revision, candidateClock: structuredClone(base.clock), worldEventWrites: [], actorWrites: [],
    factWrites: [], historyMilestoneWrites: [], actorCompletions: [], projection: structuredClone(base.projection),
    completion: 'no_change', ...patch };
}
function seeded(): WorldSimulationLedger_ACU {
  const base = buildEmptyWorldSimulationLedger_ACU();
  base.clock = { day: 3, slot: '', storyTime: '第三日', precision: 'exact', evidenceRefs: [] };
  base.facts = [
    fact('stale-internal'),
    fact('keep-secret', { projectionPolicy: 'gated', revealState: 'locked', revealGate: { semanticCondition: '提问' } }),
    fact('delivered-gated', { projectionPolicy: 'gated', revealState: 'unlocked' }),
    fact('scene-open', { projectionPolicy: 'scene', revealState: 'unlocked' }),
    fact('newer', { supersedesFactIds: ['stale-internal'], revision: 4 }),
  ];
  base.factArchive = [fact('cold-internal'), fact('cold-ref', { supersedesFactIds: ['stale-internal'], revision: 2 })];
  base.historyMilestones = [{ id: 'hot-history', summary: '重要历史原文', happenedAt: { day: 1, slot: '' }, actorIds: [], worldEventIds: [],
    locationRef: null, sourceFactIds: ['stale-internal', 'keep-secret'], importance: 2, category: '历史', visibility: 'internal', revision: 3, legacyRefs: [] }];
  base.historyArchive = [{ id: 'cold-history', summary: '冷层历史原文', happenedAt: { day: 1, slot: '' }, actorIds: [], worldEventIds: [],
    locationRef: null, sourceFactIds: ['stale-internal'], importance: 2, category: '历史', visibility: 'internal', revision: 5, legacyRefs: [] }];
  base.projection = { anchor: 'anchor-1', deliveries: [
    { factId: 'delivered-gated', status: 'delivered', attempts: 1 }, { factId: 'scene-open', status: 'acknowledged', attempts: 2 },
  ] };
  return base;
}

describe('内部管理事实清理', () => {
  it('内部管理事实判定与界面一致：只有 scene 且 unlocked 的事实不算', () => {
    expect(isInternalManagedWorldFact_ACU(fact('a'))).toBe(true);
    expect(isInternalManagedWorldFact_ACU(fact('a', { projectionPolicy: 'gated', revealState: 'unlocked' }))).toBe(true);
    expect(isInternalManagedWorldFact_ACU(fact('a', { projectionPolicy: 'scene', revealState: 'locked' }))).toBe(true);
    expect(isInternalManagedWorldFact_ACU(fact('a', { projectionPolicy: 'scene', revealState: 'unlocked' }))).toBe(false);
  });

  it('物化时删除本体并只清理结构化 ID 引用，不改叙述文字；纯删除也算 changed', () => {
    const base = seeded();
    const snapshot = structuredClone(base);
    const next = materializeWorldRoundCandidate_ACU(base, round(base, {
      factRemovals: ['stale-internal', 'delivered-gated'], completion: 'changed',
    }));
    expect(base).toEqual(snapshot);
    expect(next.facts.map(item => item.id)).toEqual(['keep-secret', 'scene-open', 'newer']);
    expect(next.facts.find(item => item.id === 'newer')).toMatchObject({ supersedesFactIds: [], revision: 5 });
    expect(next.factArchive!.find(item => item.id === 'cold-ref')).toMatchObject({ supersedesFactIds: [], revision: 3 });
    expect([...next.facts, ...next.factArchive!].some(item => item.id === 'stale-internal' || item.id === 'delivered-gated')).toBe(false);
    const histories = [...next.historyMilestones, ...(next.historyArchive ?? [])];
    expect(histories.find(item => item.id === 'hot-history')).toMatchObject({ summary: '重要历史原文', sourceFactIds: ['keep-secret'], revision: 4 });
    expect(histories.find(item => item.id === 'cold-history')).toMatchObject({ summary: '冷层历史原文', sourceFactIds: [], revision: 6 });
    expect(next.projection.deliveries).toEqual([{ factId: 'scene-open', status: 'acknowledged', attempts: 2 }]);
    expect(next.revision).toBe(base.revision + 1);
  });

  it('纯删除必须声明 changed，声明 no_change 的整轮被拒绝', () => {
    const base = seeded();
    expect(() => materializeWorldRoundCandidate_ACU(base, round(base, { factRemovals: ['stale-internal'] })))
      .toThrow(/整轮完成状态与候选变化不一致/);
  });

  it('场景事实、冷层事实、本轮新写事实和不存在 ID 一律静默跳过，且不制造 changed', () => {
    const base = seeded();
    const written = fact('fresh', { happenedAt: { day: 3, slot: '' } });
    const withWrite = materializeWorldRoundCandidate_ACU(base, round(base, {
      factWrites: [{ value: { ...written, revision: 1 }, expectedRevision: 0 }],
      factRemovals: ['scene-open', 'cold-internal', 'fresh', 'ghost'], completion: 'changed',
    }));
    const allIds = (ledger: WorldSimulationLedger_ACU): string[] => [...ledger.facts, ...(ledger.factArchive ?? [])].map(item => item.id).sort();
    // 被 newer 取代的 stale-internal 由程序性冷热整理移入冷层；这里只确认没有任何事实被清理删除。
    expect(allIds(withWrite)).toEqual([...allIds(base), 'fresh'].sort());
    expect(withWrite.facts.map(item => item.id)).toContain('scene-open');
    expect(withWrite.factArchive!.map(item => item.id)).toContain('cold-internal');
    const onlyUnsafe = materializeWorldRoundCandidate_ACU(base, round(base, { factRemovals: ['scene-open', 'cold-internal', 'ghost'] }));
    expect(allIds(onlyUnsafe)).toEqual(allIds(base));
    expect(onlyUnsafe.projection).toEqual(base.projection);
  });

  it('本轮新事实取代被删事实时，新事实的取代引用被清掉而不触发校验失败', () => {
    const base = seeded();
    const replacement = fact('replacement', { happenedAt: { day: 3, slot: '' }, supersedesFactIds: ['stale-internal'] });
    const next = materializeWorldRoundCandidate_ACU(base, round(base, {
      factWrites: [{ value: replacement, expectedRevision: 0 }], factRemovals: ['stale-internal'], completion: 'changed',
    }));
    expect(next.facts.find(item => item.id === 'replacement')).toMatchObject({ supersedesFactIds: [], revision: 1 });
    expect(next.facts.some(item => item.id === 'stale-internal')).toBe(false);
  });

  it('选择器去重排序，目录只含提交前内部管理事实并排除本轮写入', () => {
    const base = seeded();
    expect(selectRemovableWorldFactIds_ACU(base, [], ['stale-internal', 'stale-internal', 'keep-secret', 'scene-open', 'x', 7]))
      .toEqual(['keep-secret', 'stale-internal']);
    expect(selectRemovableWorldFactIds_ACU(base, [], 'stale-internal')).toEqual([]);
    const catalog = buildWorldFactPruneCatalog_ACU(base, {
      eligibleIds: new Set(base.facts.map(item => item.id)), excludeIds: new Set(['keep-secret']),
    });
    expect(catalog.map(item => item.id)).toEqual(['stale-internal', 'delivered-gated', 'newer']);
    expect(catalog[0]).toMatchObject({ projectionPolicy: 'internal', revealState: 'locked', temporalKind: 'occurrence',
      supersededByFactIds: ['newer', 'cold-ref'], citedByHistoryIds: ['hot-history', 'cold-history'] });
  });

  it('回复解析宽容：别名、对象数组、保留标记与大小写，畸形输入返回空数组', () => {
    const offered = ['fact-a', 'Fact-B', 'fact-c'];
    expect(parseWorldFactPruneIds_ACU({ pruneFactIds: ['fact-a', ' fact-c ', 'unknown'] }, offered)).toEqual(['fact-a', 'fact-c']);
    expect(parseWorldFactPruneIds_ACU({ prune_fact_ids: [{ factId: 'fact-b', reason: '重复' }, { id: 'fact-a', keep: true }, { id: 'fact-c', reason: '过期' }] }, offered))
      .toEqual(['Fact-B', 'fact-c']);
    expect(parseWorldFactPruneIds_ACU({ pruneFactIds: 'fact-a' }, offered)).toEqual([]);
    expect(parseWorldFactPruneIds_ACU({ pruneFactIds: [null, 3, {}] }, offered)).toEqual([]);
    expect(parseWorldFactPruneIds_ACU(null, offered)).toEqual([]);
    expect(parseWorldFactPruneIds_ACU({ pruneFactIds: ['fact-a'] }, [])).toEqual([]);
  });
});

function event(id: string, status: WorldEvent_ACU['status'], patch: Partial<WorldEvent_ACU> = {}): WorldEvent_ACU {
  return { id, title: `事件 ${id}`, state: `状态 ${id}`, status, actorIds: [], organizationIds: [], locationRefs: [],
    startedAt: { day: 1, slot: '' }, deadline: null, nextCheck: null, relatedEventIds: [], loreRefs: [], evidenceRefs: [], tags: [],
    revision: 2, legacy: null, ...patch };
}
function seededEvents(): WorldSimulationLedger_ACU {
  const base = buildEmptyWorldSimulationLedger_ACU();
  base.clock = { day: 3, slot: '', storyTime: '第三日', precision: 'exact', evidenceRefs: [] };
  base.worldEvents = [
    event('ended-a', 'resolved', { locationRefs: [{ region: '城区', place: '钟楼' }] }),
    event('ended-b', 'cancelled', { startedAt: null }),
    event('active-1', 'active', { relatedEventIds: ['ended-a', 'ended-b'] }),
    event('paused-1', 'paused'),
    event('planned-1', 'scheduled'),
    event('gate-required', 'resolved'),
    event('gate-world', 'resolved'),
    event('gate-open', 'resolved'),
  ];
  base.facts = [
    fact('result-a', { worldEventIds: ['ended-a', 'planned-1'], revision: 3 }),
    fact('secret-1', { projectionPolicy: 'gated', revealState: 'locked', worldEventIds: ['gate-required'],
      revealGate: { requiredEventIds: ['gate-required'], semanticCondition: '提问' } }),
    fact('secret-2', { projectionPolicy: 'gated', revealState: 'locked',
      revealGate: { worldEventIds: ['gate-world'], semanticCondition: '提问' } }),
    fact('opened', { projectionPolicy: 'gated', revealState: 'unlocked', revision: 4,
      revealGate: { requiredEventIds: ['gate-open', 'planned-1'], semanticCondition: '已提问' } }),
  ];
  base.factArchive = [fact('cold-result', { worldEventIds: ['ended-a', 'ended-b'], revision: 5 })];
  base.historyMilestones = [{ id: 'history-a', summary: '重要历史原文', happenedAt: { day: 1, slot: '' }, actorIds: [], worldEventIds: ['ended-a', 'active-1'],
    locationRef: null, sourceFactIds: ['result-a'], importance: 3, category: '历史', visibility: 'internal', revision: 6, legacyRefs: [] }];
  base.historyArchive = [{ id: 'cold-history', summary: '冷层历史原文', happenedAt: { day: 1, slot: '' }, actorIds: [], worldEventIds: ['ended-a'],
    locationRef: null, sourceFactIds: [], importance: 2, category: '历史', visibility: 'internal', revision: 7, legacyRefs: [] }];
  return base;
}

describe('已结束世界事件清理', () => {
  it('物化时删除已结束事件并只清 ID 引用：事实、历史、其他事件的文字与本体保留，纯删除算 changed', () => {
    const base = seededEvents();
    const snapshot = structuredClone(base);
    const next = materializeWorldRoundCandidate_ACU(base, round(base, { eventRemovals: ['ended-a', 'ended-b'], completion: 'changed' }));
    expect(base).toEqual(snapshot);
    expect(next.revision).toBe(base.revision + 1);
    expect(next.worldEvents.map(item => item.id)).toEqual(['active-1', 'paused-1', 'planned-1', 'gate-required', 'gate-world', 'gate-open']);
    expect(next.worldEvents[0]).toMatchObject({ relatedEventIds: [], title: '事件 active-1', state: '状态 active-1', revision: 3 });
    expect(next.worldEvents[1]).toEqual(base.worldEvents[3]);
    expect(next.facts.find(item => item.id === 'result-a')).toMatchObject({ summary: '事实 result-a', worldEventIds: ['planned-1'], revision: 4 });
    expect(next.factArchive!.find(item => item.id === 'cold-result')).toMatchObject({ summary: '事实 cold-result', worldEventIds: [], revision: 6 });
    const histories = [...next.historyMilestones, ...(next.historyArchive ?? [])];
    expect(histories.find(item => item.id === 'history-a')).toMatchObject({ summary: '重要历史原文', worldEventIds: ['active-1'], sourceFactIds: ['result-a'], revision: 7 });
    expect(histories.find(item => item.id === 'cold-history')).toMatchObject({ summary: '冷层历史原文', worldEventIds: [], revision: 8 });
    expect(next.actors).toEqual(base.actors);
  });

  it('纯删除必须声明 changed，声明 no_change 的整轮被拒绝', () => {
    const base = seededEvents();
    expect(() => materializeWorldRoundCandidate_ACU(base, round(base, { eventRemovals: ['ended-a'] })))
      .toThrow(/整轮完成状态与候选变化不一致/);
  });

  it('进行中、暂停、计划中事件、被未解锁揭示条件引用的事件和不存在的 ID 一律静默跳过，且不制造 changed', () => {
    const base = seededEvents();
    const ids = ['active-1', 'paused-1', 'planned-1', 'gate-required', 'gate-world', 'ghost', 7];
    expect(selectRemovableWorldEventIds_ACU(base, [], [], ids)).toEqual([]);
    const next = materializeWorldRoundCandidate_ACU(base, round(base, { eventRemovals: ids as string[] }));
    expect(next.worldEvents).toEqual(base.worldEvents);
    expect(next.facts).toEqual(base.facts);
    expect(next.revision).toBe(base.revision + 1);
    expect(selectRemovableWorldEventIds_ACU(base, [], [], 'ended-a')).toEqual([]);
  });

  it('已解锁事实的揭示条件不再阻止删除，只从条件数组里去掉该事件 ID', () => {
    const base = seededEvents();
    const next = materializeWorldRoundCandidate_ACU(base, round(base, { eventRemovals: ['gate-open'], completion: 'changed' }));
    expect(next.worldEvents.some(item => item.id === 'gate-open')).toBe(false);
    expect(next.facts.find(item => item.id === 'opened')).toMatchObject({
      revealState: 'unlocked', revealGate: { requiredEventIds: ['planned-1'], semanticCondition: '已提问' }, revision: 5,
    });
    expect(next.facts.find(item => item.id === 'secret-1')!.revealGate).toEqual({ requiredEventIds: ['gate-required'], semanticCondition: '提问' });
  });

  it('本轮新写入的未解锁事实的揭示条件同样保护被引用的事件', () => {
    const base = seededEvents();
    const written = fact('new-secret', { happenedAt: { day: 3, slot: '' }, projectionPolicy: 'gated', revealState: 'locked',
      revealGate: { requiredEventIds: ['ended-b'], semanticCondition: '提问' } });
    const writes = [{ value: written, expectedRevision: 0 }];
    expect(selectRemovableWorldEventIds_ACU(base, [], writes, ['ended-a', 'ended-b'])).toEqual(['ended-a']);
    const next = materializeWorldRoundCandidate_ACU(base, round(base, {
      factWrites: writes, eventRemovals: ['ended-a', 'ended-b'], completion: 'changed',
    }));
    expect(next.worldEvents.map(item => item.id)).toContain('ended-b');
    expect(next.worldEvents.map(item => item.id)).not.toContain('ended-a');
  });

  it('本轮刚写入的事件不被删，本轮写入方的 revision 不与清理冲突', () => {
    const base = seededEvents();
    const rewritten = event('ended-a', 'resolved', { state: '本轮补充收束细节', revision: 3 });
    const result = fact('fresh-result', { happenedAt: { day: 3, slot: '' }, worldEventIds: ['ended-a'] });
    const next = materializeWorldRoundCandidate_ACU(base, round(base, {
      worldEventWrites: [{ value: rewritten, expectedRevision: 2 }], factWrites: [{ value: result, expectedRevision: 0 }],
      eventRemovals: ['ended-a', 'ended-b'], completion: 'changed',
    }));
    expect(next.worldEvents.find(item => item.id === 'ended-a')).toMatchObject({ state: '本轮补充收束细节', revision: 3 });
    expect(next.worldEvents.some(item => item.id === 'ended-b')).toBe(false);
    // 本轮写入的进行中事件引用被删事件时，引用被清掉但 revision 保持本轮写入值。
    const active = event('active-1', 'active', { relatedEventIds: ['ended-b'], state: '本轮改写', revision: 3 });
    const activeResult = fact('active-result', { happenedAt: { day: 3, slot: '' }, worldEventIds: ['active-1'] });
    const second = materializeWorldRoundCandidate_ACU(base, round(base, {
      worldEventWrites: [{ value: active, expectedRevision: 2 }], factWrites: [{ value: activeResult, expectedRevision: 0 }],
      eventRemovals: ['ended-b'], completion: 'changed',
    }));
    expect(second.worldEvents.find(item => item.id === 'active-1')).toMatchObject({ relatedEventIds: [], state: '本轮改写', revision: 3 });
  });

  it('事件目录只含提交前已结束、非本轮写入、未被未解锁揭示条件引用的事件，并带紧凑关联字段', () => {
    const base = seededEvents();
    const catalog = buildWorldEventPruneCatalog_ACU(base, base, { worldEventWrites: [], factWrites: [] });
    expect(catalog.map(item => item.id)).toEqual(['gate-open', 'ended-b', 'ended-a']);
    expect(catalog.find(item => item.id === 'ended-a')).toEqual({
      id: 'ended-a', title: '事件 ended-a', state: '状态 ended-a', status: 'resolved', startedAt: { day: 1, slot: '' },
      locationRefs: [{ region: '城区', place: '钟楼' }],
      referencedByActiveEvents: [{ id: 'active-1', status: 'active' }],
      relatedFactIds: ['result-a', 'cold-result'], citedByHistoryIds: ['history-a', 'cold-history'],
    });
    const written = buildWorldEventPruneCatalog_ACU(base, base, { worldEventWrites: [{ value: { id: 'ended-a' } }], factWrites: [] });
    expect(written.map(item => item.id)).toEqual(['gate-open', 'ended-b']);
    const guarded = fact('guard', { projectionPolicy: 'gated', revealState: 'locked', revealGate: { requiredEventIds: ['gate-open'], semanticCondition: '提问' } });
    expect(buildWorldEventPruneCatalog_ACU(base, base, { worldEventWrites: [], factWrites: [{ value: guarded }] }).map(item => item.id))
      .toEqual(['ended-b', 'ended-a']);
  });

  it('事件目录有数量上限', () => {
    const base = seededEvents();
    base.worldEvents = Array.from({ length: 80 }, (_, index) => event(`e${String(index).padStart(2, '0')}`, 'resolved'));
    base.facts = [];
    base.factArchive = [];
    base.historyMilestones = [];
    base.historyArchive = [];
    expect(buildWorldEventPruneCatalog_ACU(base, base, { worldEventWrites: [], factWrites: [] })).toHaveLength(60);
  });

  it('回复解析宽容：pruneEventIds 只接受目录内 id，别名、对象数组与畸形输入', () => {
    const offered = ['ended-a', 'Ended-B', 'ended-c'];
    expect(parseWorldEventPruneIds_ACU({ pruneEventIds: ['ended-a', ' ended-c ', 'active-1'] }, offered)).toEqual(['ended-a', 'ended-c']);
    expect(parseWorldEventPruneIds_ACU({ prune_event_ids: [{ eventId: 'ended-b', reason: '正文写过' }, { id: 'ended-a', keep: true }] }, offered)).toEqual(['Ended-B']);
    expect(parseWorldEventPruneIds_ACU({ pruneFactIds: ['ended-a'] }, offered)).toEqual([]);
    expect(parseWorldEventPruneIds_ACU({ pruneEventIds: '全部' }, offered)).toEqual([]);
    expect(parseWorldEventPruneIds_ACU({ pruneEventIds: [null, 3, {}] }, offered)).toEqual([]);
    expect(parseWorldEventPruneIds_ACU({ pruneEventIds: ['ended-a'] }, [])).toEqual([]);
    expect(parseWorldEventPruneIds_ACU(undefined, offered)).toEqual([]);
  });
});
