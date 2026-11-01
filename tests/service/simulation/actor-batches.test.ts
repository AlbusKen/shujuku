import { describe, expect, it } from 'vitest';
import { buildEmptyWorldSimulationLedger_ACU } from '../../../src/service/simulation/defaults';
import { materializeWorldActorBatches_ACU, type WorldActorBatch_ACU } from '../../../src/service/simulation/actor-batches';
import { pageActiveWorldActors_ACU } from '../../../src/service/simulation/actor-completions';
import type { WorldActor_ACU, WorldSimulationLedger_ACU } from '../../../src/service/simulation/model';
import type { WorldRoundCandidate_ACU } from '../../../src/service/simulation/world-candidate';

function actor(id: string, patch: Partial<WorldActor_ACU> = {}): WorldActor_ACU {
  return { id, name: id, interests: [], location: '', locationRef: null, life: 'alive', diedAtDay: null,
    deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [], knownFacts: [],
    visibility: 'hidden', currentAction: null, longTermAction: null, shortTermAction: null,
    simulationStatus: 'active', loreRefs: [], experiences: [], revision: 1, ...patch };
}
function round(base: WorldSimulationLedger_ACU, patch: Partial<Omit<WorldRoundCandidate_ACU, 'actorWrites' | 'actorCompletions'>> = {}) {
  return { baseRevision: base.revision, candidateClock: structuredClone(base.clock), worldEventWrites: [], factWrites: [],
    historyMilestoneWrites: [], projection: structuredClone(base.projection), completion: 'no_change' as const, ...patch };
}
function pages(base: WorldSimulationLedger_ACU, size: number): WorldActorBatch_ACU[] {
  return pageActiveWorldActors_ACU(base.actors, size).map(actorIds => ({
    actorIds, status: 'complete', actorWrites: [], actorCompletions: actorIds.map(actorId => ({
      actorId, completion: 'no_change', expectedRevision: 1,
    })),
  }));
}

describe('格林推演人物批次内存装配', () => {
  it('稳定 ID 分页全部完成后才返回候选账本，基本状态不变', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.actors = [actor('c'), actor('a'), actor('b')];
    const snapshot = structuredClone(base);
    const result = materializeWorldActorBatches_ACU(base, round(base), 2, pages(base, 2));
    expect(result.actors).toEqual(base.actors);
    expect(result.revision).toBe(1);
    expect(base).toEqual(snapshot);
  });

  it('漏页、重复页、失败页或页内漏人均拒绝，时钟不单独推进', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.actors = [actor('c'), actor('a'), actor('b')];
    const all = pages(base, 2);
    const progressing = round(base, { candidateClock: { ...base.clock, day: 2 }, completion: 'changed' });
    expect(() => materializeWorldActorBatches_ACU(base, progressing, 2, all.slice(0, 1))).toThrow(/完整覆盖/);
    expect(() => materializeWorldActorBatches_ACU(base, progressing, 2, [all[0], all[0], all[1]])).toThrow(/完整覆盖/);
    expect(() => materializeWorldActorBatches_ACU(base, progressing, 2, [{ ...all[0], status: 'failed' }, all[1]])).toThrow(/未完成/);
    expect(() => materializeWorldActorBatches_ACU(base, progressing, 2, [{ ...all[0], actorCompletions: all[0].actorCompletions.slice(0, 1) }, all[1]])).toThrow(/缺少逐人覆盖证明/);
    expect(base.clock.day).toBe(1);
  });

  it('批次越界写入或重复人物证明拒绝；同轮新增 active 另行 changed 纳入覆盖', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.actors = [actor('a'), actor('b')];
    const all = pages(base, 1);
    const updated = actor('b', { revision: 2, location: '码头' });
    expect(() => materializeWorldActorBatches_ACU(base, round(base, { completion: 'changed' }), 1,
      [{ ...all[0], actorWrites: [{ value: updated, expectedRevision: 1 }] }, all[1]])).toThrow(/页外人物/);
    const newcomer = actor('new');
    const next = materializeWorldActorBatches_ACU(base, round(base, { completion: 'changed' }), 1, all,
      [{ value: newcomer, expectedRevision: 0 }]);
    expect(next.actors.map(item => item.id)).toEqual(['a', 'b', 'new']);
    expect(base.actors.map(item => item.id)).toEqual(['a', 'b']);
  });

  it('大人物谱每页固定上限，单个失败批次阻断全轮结果', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.actors = Array.from({ length: 260 }, (_, index) => actor(`actor-${index}`));
    const all = pages(base, 24);
    expect(all).toHaveLength(11);
    expect(all.every(item => item.actorIds.length <= 24)).toBe(true);
    expect(materializeWorldActorBatches_ACU(base, round(base), 24, all).actors).toHaveLength(260);
    all[9] = { ...all[9], status: 'failed' };
    expect(() => materializeWorldActorBatches_ACU(base, round(base), 24, all)).toThrow(/批次 10 未完成/);
  });
});
