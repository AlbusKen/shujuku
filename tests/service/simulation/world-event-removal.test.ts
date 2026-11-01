import { describe, expect, it } from 'vitest';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../../src/service/simulation/defaults';
import {
  collectLockedGateEventIds_ACU, removeWorldEvent_ACU, removeWorldEventsFromLedgerParts_ACU,
} from '../../../src/service/simulation/world-event-removal';

function fixture() {
  const ledger = buildDefaultWorldSimulationEnvelope_ACU().ledger;
  const event = { id: 'removed', title: '旧事件', state: '幕后', status: 'active' as const,
    actorIds: [], organizationIds: [], locationRefs: [], startedAt: null, deadline: null, nextCheck: null,
    relatedEventIds: [], loreRefs: [], evidenceRefs: [], tags: [], revision: 1, legacy: null };
  ledger.worldEvents = [event, { ...event, id: 'retained', title: '仍在进行', relatedEventIds: ['removed', 'other'], revision: 2 }];
  const fact = { id: 'fact', summary: '真实发生过，不得删除', temporalKind: 'occurrence' as const,
    happenedAt: { day: 2, slot: '' }, validFrom: null, validUntil: null, locationRef: null,
    actorIds: ['actor'], worldEventIds: ['removed', 'other'], projectionPolicy: 'gated' as const,
    revealState: 'locked' as const, revealGate: { worldEventIds: ['removed', 'other'], semanticCondition: '仍然保密' },
    nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 };
  ledger.facts = [fact, { ...fact, id: 'unrelated', worldEventIds: ['other'], revealGate: null }];
  ledger.factArchive = [{ ...fact, id: 'archived', revealState: 'unlocked' }];
  const history = { id: 'history', summary: '历史记载完整', happenedAt: { day: 2, slot: '' },
    actorIds: [], worldEventIds: ['removed', 'other'], locationRef: null, sourceFactIds: ['fact'],
    importance: 2, category: '行动', visibility: 'internal' as const, revision: 1, legacyRefs: [] };
  ledger.historyMilestones = [history];
  ledger.historyArchive = [{ ...history, id: 'archived-history' }];
  ledger.chronicle = [{ id: 'chronicle', at: '第二日', summary: '原文不变', relatedIds: ['removed', 'actor'],
    evidenceRefs: [], missedNote: null }];
  return ledger;
}

describe('removeWorldEvent_ACU', () => {
  it('删除事件及结构化引用，锁定事实不解锁，保留事实历史原文与人物时间', () => {
    const before = fixture();
    const next = removeWorldEvent_ACU(before, 'removed');
    expect(next.revision).toBe(before.revision + 1);
    expect(next.worldEvents).toMatchObject([{ id: 'retained', title: '仍在进行', relatedEventIds: ['other'], revision: 3 }]);
    expect(next.facts[0]).toMatchObject({ summary: '真实发生过，不得删除', worldEventIds: ['other'],
      revealState: 'locked', revealGate: null, revision: 2 });
    expect(next.facts[1]).toBe(before.facts[1]);
    expect(next.factArchive?.[0]).toMatchObject({ worldEventIds: ['other'], revealGate: { worldEventIds: ['other'] }, revision: 2 });
    expect(next.historyMilestones[0]).toMatchObject({ summary: '历史记载完整', worldEventIds: ['other'], revision: 2 });
    expect(next.historyArchive?.[0]).toMatchObject({ worldEventIds: ['other'], revision: 2 });
    expect(next.chronicle[0]).toMatchObject({ relatedIds: ['actor'], summary: '原文不变' });
    expect(next.actors).toBe(before.actors);
    expect(next.clock).toBe(before.clock);
    expect(before.facts[0].worldEventIds).toEqual(['removed', 'other']);
    expect(removeWorldEvent_ACU(before, 'missing')).toBe(before);
  });
});

describe('removeWorldEventsFromLedgerParts_ACU', () => {
  it('轮内版本不动整本账本 revision，引用方仅在与提交前相同时 +1，两种揭示条件字段都处理', () => {
    const previous = fixture();
    previous.facts[0] = { ...previous.facts[0], revealState: 'unlocked', revealGate: { requiredEventIds: ['removed', 'other'], worldEventIds: ['removed'], semanticCondition: 'x' } };
    const current = {
      worldEvents: structuredClone(previous.worldEvents),
      facts: structuredClone(previous.facts).map(fact => fact.id === 'unrelated' ? { ...fact, worldEventIds: ['removed'], revision: 9 } : fact),
      factArchive: structuredClone(previous.factArchive),
      historyMilestones: structuredClone(previous.historyMilestones),
      historyArchive: structuredClone(previous.historyArchive),
      chronicle: structuredClone(previous.chronicle),
    };
    const next = removeWorldEventsFromLedgerParts_ACU(previous, current, new Set(['removed']));
    expect(next.worldEvents.map(event => event.id)).toEqual(['retained']);
    expect(next.worldEvents[0]).toMatchObject({ relatedEventIds: ['other'], revision: 3 });
    expect(next.facts[0]).toMatchObject({ worldEventIds: ['other'], revision: 2,
      revealGate: { requiredEventIds: ['other'], worldEventIds: [], semanticCondition: 'x' } });
    // 本轮已被改写（revision 与提交前不同）的引用方只清 ID，不再 +1。
    expect(next.facts[1]).toMatchObject({ worldEventIds: [], revision: 9 });
    expect(next.historyMilestones[0]).toMatchObject({ worldEventIds: ['other'], revision: 2 });
    expect(next.chronicle[0].relatedIds).toEqual(['actor']);
    expect(current.worldEvents).toHaveLength(2);
  });

  it('collectLockedGateEventIds_ACU 只收集未解锁事实揭示条件里的事件 ID', () => {
    const ledger = fixture();
    expect([...collectLockedGateEventIds_ACU([
      { revealState: 'locked', revealGate: { requiredEventIds: ['a', 3], worldEventIds: ['b'], semanticCondition: 'x' } },
      { revealState: 'unlocked', revealGate: { requiredEventIds: ['c'], semanticCondition: 'x' } },
      { revealState: 'locked', revealGate: null },
      ...ledger.facts.slice(0, 1),
    ])].sort()).toEqual(['a', 'b', 'other', 'removed']);
  });
});
