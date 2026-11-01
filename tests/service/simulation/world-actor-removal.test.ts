import { describe, expect, it } from 'vitest';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../../src/service/simulation/defaults';
import { removeWorldActor_ACU } from '../../../src/service/simulation/world-actor-removal';

function actor(id: string) {
  return { id, name: id, interests: [], location: '', locationRef: null, life: 'alive' as const,
    diedAtDay: null, deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [],
    knownFacts: [], visibility: 'hidden' as const, currentAction: null, longTermAction: null,
    shortTermAction: null, simulationStatus: 'active' as const, loreRefs: [], experiences: [], revision: 1 };
}

function fixture() {
  const ledger = buildDefaultWorldSimulationEnvelope_ACU().ledger;
  ledger.actors = [actor('removed'), actor('retained')];
  ledger.worldEvents = [{ id: 'event', title: '未完事件', state: '进行中', status: 'active', actorIds: ['removed', 'retained'],
    organizationIds: [], locationRefs: [], startedAt: null, deadline: null, nextCheck: null, relatedEventIds: [],
    loreRefs: [], evidenceRefs: [], tags: [], revision: 2, legacy: null }];
  const fact = { id: 'fact', summary: '原文不删', temporalKind: 'occurrence' as const, happenedAt: null,
    validFrom: null, validUntil: null, locationRef: null, actorIds: ['removed', 'retained'], worldEventIds: ['event'],
    projectionPolicy: 'gated' as const, revealState: 'locked' as const,
    revealGate: { actorIds: ['removed', 'retained'], semanticCondition: '仍须受审' }, nextCheck: null,
    sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 3 };
  ledger.facts = [fact, { ...fact, id: 'unrelated', actorIds: [], revealGate: null },
    { ...fact, id: 'gate-only', actorIds: [], revision: 4 }];
  ledger.factArchive = [{ ...fact, id: 'archive', revealState: 'unlocked', revision: 1 }];
  const history = { id: 'milestone', summary: '历史全文保留', happenedAt: { day: 1, slot: '' },
    actorIds: ['removed', 'retained'], worldEventIds: ['event'], locationRef: null, sourceFactIds: ['fact'],
    importance: 1, category: '事件', visibility: 'internal' as const, revision: 2, legacyRefs: [] };
  ledger.historyMilestones = [history];
  ledger.historyArchive = [{ ...history, id: 'cold', actorIds: ['removed'], revision: 1 }];
  ledger.seeds = [{ id: 'seed', title: '种子不删', status: 'active', level: 1, catalyst: '', visibility: 'hidden',
    actorIds: ['removed'], location: null, expiresAtDay: null, missedOutcome: null, exposePolicy: 'on_collision',
    evidenceRefs: [], retiredReason: null, revision: 5 }];
  ledger.rumors = [{ id: 'rumor', fact: '传闻不删', originDay: 1, earliestRevealDay: 2, channels: [],
    relatedActorIds: ['removed', 'retained'], status: 'ripe', revealedAtDay: null, revision: 2 }];
  ledger.chronicle = [{ id: 'record', at: '第1日', summary: '编年原文保留', relatedIds: ['removed', 'retained'],
    evidenceRefs: [], missedNote: null }];
  return ledger;
}

describe('removeWorldActor_ACU', () => {
  it('只清理人物及结构引用，保留共享、空关联的事实事件历史和叙述', () => {
    const original = fixture();
    const next = removeWorldActor_ACU(original, 'removed');
    expect(next.revision).toBe(original.revision + 1);
    expect(next.actors).toEqual([original.actors[1]]);
    expect(next.worldEvents[0]).toMatchObject({ actorIds: ['retained'], title: '未完事件', revision: 3 });
    expect(next.facts).toHaveLength(3);
    expect(next.facts[0]).toMatchObject({ actorIds: ['retained'], summary: '原文不删', revealState: 'locked',
      revealGate: null, revision: 4 });
    expect(next.facts[1]).toBe(original.facts[1]);
    expect(next.facts[2]).toMatchObject({ actorIds: [], revealGate: null, revealState: 'locked', revision: 5 });
    expect(next.factArchive?.[0]).toMatchObject({ actorIds: ['retained'], revealState: 'unlocked',
      revealGate: { actorIds: ['retained'] }, revision: 2 });
    expect(next.historyMilestones[0]).toMatchObject({ actorIds: ['retained'], summary: '历史全文保留', revision: 3 });
    expect(next.historyArchive?.[0]).toMatchObject({ actorIds: [], revision: 2 });
    expect(next.seeds[0]).toMatchObject({ actorIds: [], title: '种子不删', revision: 6 });
    expect(next.rumors[0]).toMatchObject({ relatedActorIds: ['retained'], fact: '传闻不删', revision: 3 });
    expect(next.chronicle[0]).toMatchObject({ relatedIds: ['retained'], summary: '编年原文保留' });
    expect(original.facts[0].revealGate).not.toBeNull();
    expect(next.clock).toBe(original.clock);
    expect(next.player).toBe(original.player);
  });

  it('人物不存在时保持同一对象，不产生 revision', () => {
    const ledger = fixture();
    expect(removeWorldActor_ACU(ledger, 'missing')).toBe(ledger);
  });
});
