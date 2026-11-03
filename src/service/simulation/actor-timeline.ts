/**
 * service/simulation/actor-timeline.ts — 人物行为时间线的程序派生
 *
 * 模型只写行为内容与预计持续时间；开始/结束时间一律按本次提交的最终 clock 盖戳：
 * - 短期行为 text 变化才重新盖开始时间，内容不变保留原开始时间；
 * - 长期行为只在从无到有时盖开始时间，改写措辞视为同一行为，保留原开始时间；
 * - 长期行为只有显式 status=done/abandoned 才归档为经历，并清空当前长期行为；
 * - 经历超过上限时从最早的开始覆盖。
 * 批次一中写 clock 的角色与人物谱角色并发推演，所以时间不能由模型自己写。
 */
import {
  WORLD_ACTOR_EXPERIENCE_CAP_ACU,
  WORLD_ACTOR_EXPERIENCE_INJECT_ACU,
  type WorldActor_ACU,
  type WorldActorExperience_ACU,
  type WorldClock_ACU,
} from './model';

function stampActor_ACU(prev: WorldActor_ACU | null, actor: WorldActor_ACU, clock: WorldClock_ACU): WorldActor_ACU {
  const next: WorldActor_ACU = { ...actor, experiences: [...(actor.experiences ?? [])] };

  const current = actor.currentAction ?? null;
  const priorCurrent = prev?.currentAction ?? null;
  if (!current) next.currentAction = null;
  else if (priorCurrent && priorCurrent.text === current.text) {
    next.currentAction = { ...current, startedAtDay: priorCurrent.startedAtDay, startedAt: priorCurrent.startedAt };
  } else {
    next.currentAction = { ...current, startedAtDay: clock.day, startedAt: clock.storyTime };
  }

  const long = actor.longTermAction ?? null;
  const priorLong = prev?.longTermAction ?? null;
  if (!long) {
    // 清空但没有显式结束：不归档，避免把改写或误删当成经历。
    next.longTermAction = null;
    return next;
  }
  const started = priorLong
    ? { startedAtDay: priorLong.startedAtDay, startedAt: priorLong.startedAt }
    : { startedAtDay: clock.day, startedAt: clock.storyTime };
  if (long.status === 'ongoing') {
    next.longTermAction = { ...long, ...started };
    return next;
  }
  const experience: WorldActorExperience_ACU = {
    text: long.text,
    expectedDuration: long.expectedDuration,
    ...started,
    endedAtDay: clock.day,
    endedAt: clock.storyTime,
    status: long.status as WorldActorExperience_ACU['status'],
    outcome: long.outcome,
  };
  next.experiences = [...next.experiences, experience].slice(-WORLD_ACTOR_EXPERIENCE_CAP_ACU);
  next.longTermAction = null;
  return next;
}

/** 对比提交前后的人物谱，为行为补齐时间戳并把显式结束的长期行为归档为经历。 */
export function stampWorldActorTimelines_ACU(
  before: readonly WorldActor_ACU[],
  after: readonly WorldActor_ACU[],
  clock: WorldClock_ACU,
): WorldActor_ACU[] {
  const previous = new Map(before.map(actor => [actor.id, actor]));
  return after.map(actor => stampActor_ACU(previous.get(actor.id) ?? null, actor, clock));
}

/** 注入子代理时只带最近若干条经历，时间顺序保持从早到晚。 */
export function recentWorldActorExperiences_ACU(
  actor: Pick<WorldActor_ACU, 'experiences'>,
  limit: number = WORLD_ACTOR_EXPERIENCE_INJECT_ACU,
): WorldActorExperience_ACU[] {
  return (actor.experiences ?? []).slice(-limit);
}
