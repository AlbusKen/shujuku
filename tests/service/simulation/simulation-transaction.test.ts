import { describe, expect, it } from 'vitest';
import { WorldSimulationValidationError_ACU, type WorldSimulationTransaction_ACU, type WorldStateSnapshot_ACU } from '../../../src/service/simulation/model';
import { applyWorldSimulationTransaction_ACU, normalizeWorldSimulationTransactionVisibility_ACU } from '../../../src/service/simulation/simulation-transaction';

const clock = (index: number) => ({ anchorText: `第${index}日`, elapsedSinceLastRun: '一日', precision: 'approximate' as const, evidenceIndexes: [index], updatedIndex: index });
function entity(id: string, importance: 'core' | 'active' | 'background' = 'active') {
  return { id, kind: 'character' as const, name: id, importance, situation: '待命', agenda: '观察', lastMovedIndex: 1, lastMovedAt: '第一日', visibility: { mode: 'hidden' as const }, retired: false, updatedIndex: 1 };
}
function snapshot(): WorldStateSnapshot_ACU {
  return { anchorMessageIndex: 1, storyClock: clock(1), entities: [entity('e1', 'core'), entity('e2', 'active')], events: [{ id: 'v1', summary: '旧事件', actorIds: ['e1'], occurredIndex: 1, occurredAt: '第一日', visibility: { mode: 'rumored' }, retired: false, updatedIndex: 1 }], threads: [{ id: 't1', title: '旧线索', status: 'active', summary: '持续', visibility: { mode: 'hidden' }, relatedEventIds: ['v1'], retired: false, updatedIndex: 1 }], revisions: { entities: 3, events: 4, threads: 5 } };
}
function transaction(patch: Partial<WorldSimulationTransaction_ACU> = {}): WorldSimulationTransaction_ACU {
  return { anchorMessageIndex: 2, storyClock: clock(2), expectedRevisions: {}, entities: [], events: [], threads: [], ...patch };
}
function expectCode(action: () => unknown, code: string): void {
  try { action(); throw new Error('expected world simulation error'); } catch (error) {
    expect(error).toBeInstanceOf(WorldSimulationValidationError_ACU);
    expect((error as WorldSimulationValidationError_ACU).error.code).toBe(code);
  }
}

describe('world simulation transaction', () => {
  it('merges all modules by stable id and increments only touched revisions', () => {
    const result = applyWorldSimulationTransaction_ACU(snapshot(), transaction({
      expectedRevisions: { entities: 3, events: 4, threads: 5 },
      entities: [{ action: 'upsert', value: { ...entity('e2', 'background'), situation: '已转入背景' } }],
      events: [{ action: 'upsert', value: { id: 'v2', summary: '新事件', actorIds: ['e2'], occurredIndex: 2, occurredAt: '第二日', visibility: { mode: 'hidden' }, retired: false, updatedIndex: 0 } }],
      threads: [{ action: 'upsert', value: { id: 't2', title: '新线索', status: 'brewing', summary: '酝酿', visibility: { mode: 'hidden' }, relatedEventIds: ['v2'], retired: false, updatedIndex: 0 } }],
    }), 2);
    expect(result.entities.find(item => item.id === 'e2')).toMatchObject({ importance: 'background', updatedIndex: 2 });
    expect(result.events.find(item => item.id === 'v2')).toMatchObject({ updatedIndex: 2 });
    expect(result.threads.find(item => item.id === 't2')).toMatchObject({ updatedIndex: 2 });
    expect(result.revisions).toEqual({ entities: 4, events: 5, threads: 6 });
  });

  it('normalizes only non-retired upserts according to the configured visibility policy', () => {
    const raw = transaction({
      expectedRevisions: { entities: 3, events: 4 },
      entities: [{ action: 'upsert', value: { ...entity('e2'), visibility: { mode: 'rumored' } } }],
      events: [{ action: 'upsert', value: { id: 'v2', summary: '新事件', actorIds: ['e2'], occurredIndex: 2, occurredAt: '第二日', visibility: { mode: 'hidden' }, retired: false, updatedIndex: 0 } }],
    });
    const agent = normalizeWorldSimulationTransactionVisibility_ACU(raw, 'agent');
    const hidden = normalizeWorldSimulationTransactionVisibility_ACU(raw, 'always_hidden');
    const revealed = normalizeWorldSimulationTransactionVisibility_ACU(raw, 'always_revealed');
    expect(agent.entities[0]).toMatchObject({ action: 'upsert', value: { visibility: { mode: 'rumored' } } });
    expect(agent.events[0]).toMatchObject({ action: 'upsert', value: { visibility: { mode: 'hidden' } } });
    for (const item of [...hidden.entities, ...hidden.events]) expect(item).toMatchObject({ action: 'upsert', value: { visibility: { mode: 'hidden' } } });
    for (const item of [...revealed.entities, ...revealed.events]) expect(item).toMatchObject({ action: 'upsert', value: { visibility: { mode: 'revealed', revealedIndex: 2 } } });
    expect(raw.entities[0]).toMatchObject({ action: 'upsert', value: { visibility: { mode: 'rumored' } } });

    const retire = transaction({ expectedRevisions: { entities: 3 }, entities: [{ action: 'retire', id: 'e2', reason: '离场' }] });
    expect(normalizeWorldSimulationTransactionVisibility_ACU(retire, 'always_revealed').entities).toEqual(retire.entities);
    expectCode(() => normalizeWorldSimulationTransactionVisibility_ACU(raw, 'invalid' as any), 'WORLD_SIM_PROTOCOL_INVALID');
  });

  it('rejects missing or stale expected revisions without mutating the source', () => {
    const base = snapshot();
    const before = JSON.parse(JSON.stringify(base));
    expectCode(() => applyWorldSimulationTransaction_ACU(base, transaction({ entities: [{ action: 'upsert', value: entity('e3') }] }), 3), 'WORLD_SIM_PROTOCOL_INVALID');
    expectCode(() => applyWorldSimulationTransaction_ACU(base, transaction({ expectedRevisions: { entities: 2 }, entities: [{ action: 'upsert', value: entity('e3') }] }), 3), 'WORLD_SIM_CONFLICT');
    expectCode(() => applyWorldSimulationTransaction_ACU(base, transaction({ expectedRevisions: { entities: 3, events: 4 }, entities: [{ action: 'upsert', value: entity('e3') }] }), 3), 'WORLD_SIM_PROTOCOL_INVALID');
    expectCode(() => applyWorldSimulationTransaction_ACU(base, transaction({
      expectedRevisions: { entities: 3, events: 99 },
      entities: [{ action: 'upsert', value: entity('e3') }],
      events: [{ action: 'upsert', value: { id: 'v2', summary: '不会提交', actorIds: [], occurredIndex: 2, occurredAt: '第二日', visibility: { mode: 'hidden' }, retired: false, updatedIndex: 0 } }],
    }), 3), 'WORLD_SIM_CONFLICT');
    expect(base).toEqual(before);
  });

  it('soft-retires entries and never physically removes them', () => {
    const result = applyWorldSimulationTransaction_ACU(snapshot(), transaction({ expectedRevisions: { entities: 3, events: 4 }, entities: [{ action: 'retire', id: 'e2', reason: '离开主舞台' }], events: [{ action: 'retire', id: 'v1', reason: '证据推翻' }] }), 2);
    expect(result.entities).toHaveLength(2);
    expect(result.entities.find(item => item.id === 'e2')).toMatchObject({ retired: true, retiredReason: '离开主舞台', updatedIndex: 2 });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ retired: true, retiredReason: '证据推翻', updatedIndex: 2 });
    const threadResult = applyWorldSimulationTransaction_ACU(snapshot(), transaction({ expectedRevisions: { threads: 5 }, threads: [{ action: 'retire', id: 't1', reason: '线索闭合' }] }), 2);
    expect(threadResult.threads).toHaveLength(1);
    expect(threadResult.threads[0]).toMatchObject({ id: 't1', retired: true, retiredReason: '线索闭合', updatedIndex: 2, status: 'active' });
  });

  it('rejects capacity overflow atomically but permits a same-transaction demotion', () => {
    const base = snapshot();
    expectCode(() => applyWorldSimulationTransaction_ACU(base, transaction({ expectedRevisions: { entities: 3 }, entities: [{ action: 'upsert', value: entity('e3') }] }), 2), 'WORLD_SIM_CONFLICT');
    expect(base.entities).toHaveLength(2);
    const result = applyWorldSimulationTransaction_ACU(base, transaction({ expectedRevisions: { entities: 3 }, entities: [{ action: 'upsert', value: entity('e2', 'background') }, { action: 'upsert', value: entity('e3') }] }), 2);
    expect(result.entities.filter(item => !item.retired && item.importance !== 'background')).toHaveLength(2);
    expect(result.entities.map(item => item.id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('requires an over-limit base to be reduced to a compliant final entity set', () => {
    const base = snapshot();
    base.entities.push(entity('e3'));
    const before = JSON.parse(JSON.stringify(base));
    expectCode(() => applyWorldSimulationTransaction_ACU(base, transaction({
      expectedRevisions: { entities: 3 },
      entities: [{ action: 'upsert', value: entity('e2', 'background') }, { action: 'upsert', value: entity('e4') }],
    }), 2), 'WORLD_SIM_CONFLICT');
    expectCode(() => applyWorldSimulationTransaction_ACU(base, transaction({
      expectedRevisions: { entities: 3 },
      entities: [{ action: 'retire', id: 'e2', reason: '退场' }, { action: 'upsert', value: entity('e4') }],
    }), 2), 'WORLD_SIM_CONFLICT');
    expect(base).toEqual(before);
  });

  it('rejects duplicate, unknown, and non-canonical stable-id operations as protocol failures', () => {
    expectCode(() => applyWorldSimulationTransaction_ACU(snapshot(), transaction({ expectedRevisions: { entities: 3 }, entities: [{ action: 'retire', id: 'e1', reason: 'a' }, { action: 'retire', id: 'e1', reason: 'b' }] }), 3), 'WORLD_SIM_PROTOCOL_INVALID');
    expectCode(() => applyWorldSimulationTransaction_ACU(snapshot(), transaction({ expectedRevisions: { entities: 3 }, entities: [{ action: 'upsert', value: entity('e3') }, { action: 'retire', id: 'e3', reason: '重复' }] }), 3), 'WORLD_SIM_PROTOCOL_INVALID');
    expectCode(() => applyWorldSimulationTransaction_ACU(snapshot(), transaction({ expectedRevisions: { threads: 5 }, threads: [{ action: 'retire', id: 'missing', reason: '不存在' }] }), 3), 'WORLD_SIM_PROTOCOL_INVALID');
    expectCode(() => applyWorldSimulationTransaction_ACU(snapshot(), transaction({ expectedRevisions: { entities: 3 }, entities: [{ action: 'upsert', value: entity(' e3 ') }] }), 3), 'WORLD_SIM_PROTOCOL_INVALID');
    expectCode(() => applyWorldSimulationTransaction_ACU(snapshot(), transaction({ expectedRevisions: { entities: 3 }, entities: [{ action: 'retire', id: ' e1 ', reason: '不再寻址' }] }), 3), 'WORLD_SIM_PROTOCOL_INVALID');
    const malformedBase = snapshot();
    malformedBase.entities[0] = { ...malformedBase.entities[0], id: ' e1 ' };
    expectCode(() => applyWorldSimulationTransaction_ACU(malformedBase, transaction({ expectedRevisions: { entities: 3 }, entities: [{ action: 'retire', id: 'e2', reason: '无关' }] }), 3), 'WORLD_SIM_PROTOCOL_INVALID');
  });
});