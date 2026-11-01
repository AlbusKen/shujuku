import { describe, expect, it } from 'vitest';
import { activeWorldActorRoster_ACU, pageActiveWorldActors_ACU, validateWorldActorPages_ACU, validateWorldActorCompletions_ACU } from '../../../src/service/simulation/actor-completions';
import type { WorldActor_ACU } from '../../../src/service/simulation/model';

function actor(id: string, changes: Partial<WorldActor_ACU> = {}): WorldActor_ACU {
  return {
    id, name: id, interests: [], location: '', locationRef: null, life: 'alive', diedAtDay: null,
    deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [],
    knownFacts: [], visibility: 'hidden', currentAction: null, longTermAction: null,
    shortTermAction: null, simulationStatus: 'active', loreRefs: [], experiences: [], revision: 1, ...changes,
  };
}

describe('格林推演人物逐轮覆盖', () => {
  it('大人物谱按稳定 ID 切成固定大小批次，任何漏页或重复页拒绝执行', () => {
    const actors = Array.from({ length: 260 }, (_, index) => actor(`actor-${String(259 - index).padStart(3, '0')}`));
    actors.push(actor('archived', { simulationStatus: 'archived' }));
    const pages = pageActiveWorldActors_ACU(actors, 24);
    expect(pages).toHaveLength(11);
    expect(pages.every(page => page.length <= 24)).toBe(true);
    expect(validateWorldActorPages_ACU(actors, pages)).toEqual([]);
    expect(validateWorldActorPages_ACU(actors, pages.slice(1))).toContain('人物召回页未按稳定 ID 完整覆盖 active roster');
    expect(validateWorldActorPages_ACU(actors, [pages[0], pages[0], ...pages.slice(1)])).toContain('人物召回页含重复 ID');
    expect(() => pageActiveWorldActors_ACU(actors, 0)).toThrow(/正整数/);
  });

  it('按稳定 ID 覆盖全部 active，失踪或死亡并不自动归档', () => {
    const actors = [actor('z', { life: 'missing' }), actor('b', { simulationStatus: 'archived' }),
      actor('a', { life: 'dead', diedAtDay: 1, deathSummary: '已故' })];
    expect(activeWorldActorRoster_ACU(actors)).toEqual(['a', 'z']);
    expect(validateWorldActorCompletions_ACU(actors, actors, [
      { actorId: 'z', completion: 'no_change', expectedRevision: 1 },
      { actorId: 'a', completion: 'no_change', expectedRevision: 1 },
    ])).toEqual([]);
  });

  it('未在正文出现、未到 next-check 的 active 仍必须返回结果', () => {
    const before = [actor('unmentioned'), actor('present')];
    expect(validateWorldActorCompletions_ACU(before, before, [
      { actorId: 'present', completion: 'no_change', expectedRevision: 1 },
    ])).toEqual(['人物 unmentioned 缺少本轮覆盖证明']);
  });

  it('同轮归档仍完成覆盖，下一轮才退出；新 active 人物必须 changed', () => {
    const before = [actor('old')];
    const after = [actor('old', { simulationStatus: 'archived', revision: 2 }), actor('new', { revision: 1 })];
    expect(validateWorldActorCompletions_ACU(before, after, [
      { actorId: 'old', completion: 'changed', expectedRevision: 1 },
      { actorId: 'new', completion: 'changed', expectedRevision: 0 },
    ])).toEqual([]);
    expect(activeWorldActorRoster_ACU(after)).toEqual(['new']);
    expect(validateWorldActorCompletions_ACU(before, after, [
      { actorId: 'old', completion: 'changed', expectedRevision: 1 },
      { actorId: 'new', completion: 'no_change', expectedRevision: 0 },
    ])).toContain('新人物 new 必须标记 changed');
  });

  it('重复、非法完成状态、错误 revision 和未覆盖均使整轮校验失败', () => {
    const before = [actor('a'), actor('b')];
    const falseChanged = validateWorldActorCompletions_ACU(before, before, [
      { actorId: 'a', completion: 'changed', expectedRevision: 1 },
      { actorId: 'b', completion: 'no_change', expectedRevision: 1 },
    ]);
    expect(falseChanged).toContain('人物 a 未变化却标记 changed');
    const revisionOnly = [actor('a', { revision: 2 }), actor('b')];
    expect(validateWorldActorCompletions_ACU(before, revisionOnly, [
      { actorId: 'a', completion: 'changed', expectedRevision: 1 },
      { actorId: 'b', completion: 'no_change', expectedRevision: 1 },
    ])).toContain('人物 a 未变化却标记 changed');
    const errors = validateWorldActorCompletions_ACU(before, before, [
      { actorId: 'a', completion: 'changed', expectedRevision: 0 },
      { actorId: 'a', completion: 'partial' as never, expectedRevision: 1 },
    ]);
    expect(errors.join('\n')).toMatch(/重复提交|完成状态非法|revision 冲突|b 缺少/);
  });

  it('no_change 人物不能偷偷修改资料或删除；路人 archived 不自动加入 roster', () => {
    const before = [actor('a')];
    const changed = [actor('a', { location: '新地点', revision: 2 }), actor('passing', { simulationStatus: 'archived' })];
    const errors = validateWorldActorCompletions_ACU(before, changed, [
      { actorId: 'a', completion: 'no_change', expectedRevision: 1 },
    ]);
    expect(errors).toContain('人物 a 发生变化却标记 no_change');
    expect(errors.some(error => error.includes('passing'))).toBe(false);
    expect(validateWorldActorCompletions_ACU(before, [], [
      { actorId: 'a', completion: 'changed', expectedRevision: 1 },
    ])).toContain('人物 a 不能从候选账本删除');
  });
});
