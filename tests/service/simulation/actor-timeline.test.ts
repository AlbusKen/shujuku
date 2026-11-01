import { describe, expect, it } from 'vitest';
import { stampWorldActorTimelines_ACU } from '../../../src/service/simulation/actor-timeline';
import type { WorldActor_ACU, WorldClock_ACU } from '../../../src/service/simulation/model';

const clock: WorldClock_ACU = { day: 3, slot: '上午', storyTime: '周三上午', precision: 'exact', evidenceRefs: [] };
function actor(patch: Partial<WorldActor_ACU> = {}): WorldActor_ACU {
  return { id: 'a', name: '王老师', interests: [], location: '', locationRef: null, life: 'alive', diedAtDay: null, deathSummary: null,
    resources: [], goals: [], constraints: [], informationSources: [], knownFacts: [], visibility: 'public',
    currentAction: null, longTermAction: null, shortTermAction: null, experiences: [], revision: 1, ...patch };
}
const task = (text: string, expectedDuration: string) =>
  ({ text, expectedDuration, startedAtDay: 1, startedAt: '周一', status: 'ongoing' as const, outcome: null });

describe('人物行动预计时长', () => {
  it('同一行动本轮漏写时长时沿用上一轮记录，当前动作与短期事务都适用', () => {
    const before = actor({ currentAction: { text: '批改试卷', expectedDuration: '约一小时', startedAtDay: 1, startedAt: '周一' },
      longTermAction: task('完成月考讲评', '两天'), shortTermAction: task('完成月考讲评', '两天') });
    const after = actor({ currentAction: { text: '批改试卷', expectedDuration: '', startedAtDay: null, startedAt: '' },
      longTermAction: task('完成月考讲评', '  '), shortTermAction: task('完成月考讲评', '  ') });
    const [stamped] = stampWorldActorTimelines_ACU([before], [after], clock);
    expect(stamped.currentAction).toMatchObject({ expectedDuration: '约一小时', startedAtDay: 1 });
    expect(stamped.shortTermAction?.expectedDuration).toBe('两天');
    expect(stamped.longTermAction?.expectedDuration).toBe('两天');
  });

  it('本轮给出新时长时采用新值；换成新行动时不沿用旧时长', () => {
    const before = actor({ currentAction: { text: '批改试卷', expectedDuration: '约一小时', startedAtDay: 1, startedAt: '周一' } });
    const updated = stampWorldActorTimelines_ACU([before],
      [actor({ currentAction: { text: '批改试卷', expectedDuration: '还要半小时', startedAtDay: null, startedAt: '' } })], clock)[0];
    expect(updated.currentAction?.expectedDuration).toBe('还要半小时');
    const switched = stampWorldActorTimelines_ACU([before],
      [actor({ currentAction: { text: '整理讲评重点', expectedDuration: '', startedAtDay: null, startedAt: '' } })], clock)[0];
    expect(switched.currentAction).toMatchObject({ text: '整理讲评重点', expectedDuration: '', startedAtDay: 3 });
  });
});
