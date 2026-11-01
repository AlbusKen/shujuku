import { describe, expect, it } from 'vitest';
import { buildEmptyWorldSimulationLedger_ACU } from '../../../src/service/simulation/defaults';
import { checkWorldFactRevealGate_ACU } from '../../../src/service/simulation/world-fact-gate';
import type { WorldActor_ACU, WorldFact_ACU } from '../../../src/service/simulation/model';

const fact: WorldFact_ACU = { id: 'secret-1', summary: '不能直接泄漏的秘密', temporalKind: 'occurrence',
  happenedAt: { day: 1, slot: '' }, validFrom: null, validUntil: null, locationRef: null,
  actorIds: [], worldEventIds: [], projectionPolicy: 'gated', revealState: 'locked',
  revealGate: { semanticCondition: '玩家主动询问当事人', actorIds: ['actor-1'],
    locationRef: { region: '上海', place: '广场' }, notBefore: { day: 2, slot: '' },
    requiredEventIds: ['event-1'], requiredFactIds: ['proof-1'] },
  nextCheck: { day: 2, slot: '', reason: '复核' }, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 };

function actor(id: string): WorldActor_ACU {
  return { id, name: id, interests: [], location: '', locationRef: null, life: 'alive', diedAtDay: null,
    deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [], knownFacts: [],
    visibility: 'hidden', currentAction: null, longTermAction: null, shortTermAction: null,
    simulationStatus: 'active', loreRefs: [], experiences: [], revision: 1 };
}

function setup() {
  const ledger = buildEmptyWorldSimulationLedger_ACU();
  ledger.actors = [actor('actor-1')];
  ledger.facts = [structuredClone(fact), { ...structuredClone(fact), id: 'proof-1', revealGate: null,
    projectionPolicy: 'internal', revealState: 'locked' }];
  ledger.worldEvents = [{ id: 'event-1', title: '谈判', state: '已结束', status: 'resolved', actorIds: [], organizationIds: [],
    locationRefs: [], startedAt: null, deadline: null, nextCheck: null, relatedEventIds: [], loreRefs: [],
    evidenceRefs: [], tags: [], revision: 1, legacy: null }];
  return ledger;
}

const scene = { region: '上海', place: '广场' };
const time = { day: 2, slot: '' };
const check = (ledger = setup(), current = time, location = scene, contacts: readonly string[] = ['actor-1']) =>
  checkWorldFactRevealGate_ACU(ledger, 'secret-1', current, location, contacts);

function expectBlockedForGate(gate: Record<string, unknown>, current = time, location = scene, contacts: readonly string[] = ['actor-1']) {
  const ledger = setup();
  ledger.facts[0].revealGate = gate;
  expect(check(ledger, current, location, contacts).status).toBe('blocked');
}

describe('确定事实结构化揭示门槛', () => {
  it('条件满足也只返回语义复核要求，不读取秘密正文或解锁原账本', () => {
    const ledger = setup();
    const snapshot = structuredClone(ledger);
    const result = check(ledger);
    expect(result).toEqual({ status: 'semantic-review-required', factId: 'secret-1', semanticCondition: '玩家主动询问当事人' });
    expect(JSON.stringify(result)).not.toContain('不能直接泄漏的秘密');
    expect(ledger).toEqual(snapshot);
  });

  it('同城不同地点、未接触人物、时间未到或前置事件未收束均保持阻断', () => {
    const ledger = setup();
    expect(check(ledger, time, { region: '上海', place: '另一条街' }).status).toBe('blocked');
    expect(check(ledger, time, scene, []).status).toBe('blocked');
    expect(check(ledger, { day: 1, slot: '' }).status).toBe('blocked');
    ledger.worldEvents[0].status = 'active';
    expect(check(ledger).status).toBe('blocked');
    ledger.worldEvents[0].status = 'resolved';
    ledger.facts[1].happenedAt = { day: 3, slot: '' };
    expect(check(ledger)).toMatchObject({ status: 'blocked', reason: '前置确定事实尚未成立' });
  });

  it('同一 slot 可证明到达，同日不同或未知 slot 一律不猜测顺序', () => {
    const exact = { day: 2, slot: '午后' };
    expectBlockedForGate({ semanticCondition: '主动寻找', notBefore: { day: 2, slot: '午后' } }, { day: 2, slot: '夜晚' });
    expectBlockedForGate({ semanticCondition: '主动寻找', notBefore: { day: 2, slot: '午后' } }, { day: 2, slot: '' });
    const ledger = setup();
    ledger.facts[0].revealGate = { semanticCondition: '主动寻找', notBefore: exact };
    expect(check(ledger, exact)).toMatchObject({ status: 'semantic-review-required' });
    ledger.facts[0].revealGate = { semanticCondition: '主动寻找', notBefore: { day: 1, slot: '夜晚' } };
    expect(check(ledger, exact)).toMatchObject({ status: 'semantic-review-required' });
  });

  it('事实自身起始与条件有效期应用相同保守时间规则', () => {
    const current = { day: 2, slot: '午后' };
    const ledger = setup();
    ledger.facts[0].revealGate = { semanticCondition: '主动寻找' };
    ledger.facts[0].happenedAt = { day: 2, slot: '夜晚' };
    expect(check(ledger, current).status).toBe('blocked');
    ledger.facts[0].happenedAt = { day: 2, slot: '午后' };
    expect(check(ledger, current)).toMatchObject({ status: 'semantic-review-required' });
    ledger.facts[0].temporalKind = 'condition';
    ledger.facts[0].validFrom = { day: 2, slot: '午后' };
    ledger.facts[0].validUntil = { day: 2, slot: '夜晚' };
    expect(check(ledger, current).status).toBe('blocked');
    ledger.facts[0].validUntil = { day: 2, slot: '' };
    expect(check(ledger, current)).toMatchObject({ status: 'semantic-review-required' });
    ledger.facts[0].validUntil = { day: 2, slot: '午后' };
    expect(check(ledger, { day: 2, slot: '' }).status).toBe('blocked');
    expect(check(ledger, current)).toMatchObject({ status: 'semantic-review-required' });
    ledger.facts[0].validUntil = { day: 1, slot: '' };
    expect(check(ledger, current).status).toBe('blocked');
  });

  it('旧自由格式、无效时间和带额外字段的结构均 fail closed', () => {
    expectBlockedForGate({ condition: '看起来像主动寻找' });
    expectBlockedForGate({ semanticCondition: '主动寻找', notBefore: { day: 0, slot: '' } });
    expectBlockedForGate({ semanticCondition: '主动寻找', notBefore: { day: Number.NaN, slot: '' } });
    expectBlockedForGate({ semanticCondition: '主动寻找', notBefore: { day: 2, slot: '', extra: true } });
    expectBlockedForGate({ semanticCondition: '主动寻找', locationRef: { region: '上海', place: '广场', extra: true } });
    expectBlockedForGate({ semanticCondition: '主动寻找', locationRef: { region: '上海', place: 1 } });
    expect(check(setup(), { day: 0, slot: '' }).status).toBe('blocked');
  });

  it('人物、事件和事实引用必须是无重复的已知 ID，接触输入也不能伪造', () => {
    expectBlockedForGate({ semanticCondition: '主动寻找', actorIds: ['actor-1', 'actor-1'] });
    expectBlockedForGate({ semanticCondition: '主动寻找', actorIds: ['missing'] });
    expectBlockedForGate({ semanticCondition: '主动寻找', actorIds: [''] });
    expectBlockedForGate({ semanticCondition: '主动寻找', requiredEventIds: ['event-1', 'event-1'] });
    expectBlockedForGate({ semanticCondition: '主动寻找', requiredEventIds: ['missing'] });
    expectBlockedForGate({ semanticCondition: '主动寻找', requiredFactIds: ['proof-1', 'proof-1'] });
    expectBlockedForGate({ semanticCondition: '主动寻找', requiredFactIds: ['missing'] });
    const noActor = setup();
    noActor.actors = [];
    expect(check(noActor).status).toBe('blocked');
    expect(check(setup(), time, scene, ['actor-1', 'actor-1']).status).toBe('blocked');
    expect(check(setup(), time, scene, ['unknown']).status).toBe('blocked');
  });

  it('热层 gated 目标可引用已成立的冷层前置事实，但冷层自身不能成为揭示目标', () => {
    const ledger = setup();
    ledger.facts = [ledger.facts[0]];
    ledger.facts[0].revealGate = { semanticCondition: '主动寻找', requiredFactIds: ['cold-proof'] };
    ledger.factArchive = [{ ...structuredClone(fact), id: 'cold-proof', revealGate: null,
      projectionPolicy: 'internal', revealState: 'locked' }];
    expect(check(ledger)).toMatchObject({ status: 'semantic-review-required', factId: 'secret-1' });
    expect(checkWorldFactRevealGate_ACU(ledger, 'cold-proof', time, scene, ['actor-1'])).toMatchObject({ status: 'blocked' });
  });
});
