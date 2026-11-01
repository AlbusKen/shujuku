import { pageActiveWorldActors_ACU, validateWorldActorPages_ACU } from './actor-completions';
import type { WorldActor_ACU, WorldClock_ACU, WorldFact_ACU, WorldHistoryMilestone_ACU,
  WorldEvent_ACU, WorldLocationRef_ACU } from './model';

export type WorldRecallHistoryRow_ACU = Pick<WorldHistoryMilestone_ACU, 'id' | 'happenedAt' | 'actorIds' | 'locationRef'>;
export type WorldRecallEventRow_ACU = Pick<WorldEvent_ACU, 'id' | 'status'> & { nextCheck: { day: number; slot: string } | null };
export type WorldRecallFactRow_ACU = Pick<WorldFact_ACU,
  'id' | 'temporalKind' | 'happenedAt' | 'validFrom' | 'validUntil' | 'locationRef' | 'projectionPolicy' | 'revealState'>
  & { nextCheck: { day: number; slot: string } | null };

export interface WorldRecallDirectory_ACU {
  /** 由调用方按人物索引取出的有限目录；不是完整历史账本。 */
  historyByActor: Readonly<Record<string, readonly WorldRecallHistoryRow_ACU[]>>;
  /** 世界事件分页目录与按时间、地点筛选的事实目录，不携带完整正文。 */
  candidateEvents: readonly WorldRecallEventRow_ACU[];
  candidateFacts: readonly WorldRecallFactRow_ACU[];
}

export interface WorldRecallActor_ACU {
  actorId: string;
  name: string;
  currentAction: string | null;
  shortTermAction: string | null;
  goal: string | null;
  recentHistoryIds: string[];
  relatedHistoryIds: string[];
}

export interface WorldRecallManifestPage_ACU {
  actorIds: string[];
  actors: WorldRecallActor_ACU[];
  dueEventIds: string[];
  dueFactIds: string[];
  sceneFactIds: string[];
  projectionCheckIds: string[];
  deferred: Array<{ kind: 'worldEvent' | 'fact'; id: string; reason: 'budget' }>;
}

export interface WorldRecallLimits_ACU {
  actorsPerPage: number;
  recentHistoryPerActor: number;
  relatedHistoryPerActor: number;
  eventsPerPage: number;
  factsPerPage: number;
}

const DEFAULT_LIMITS_ACU: WorldRecallLimits_ACU = {
  actorsPerPage: 24, recentHistoryPerActor: 3, relatedHistoryPerActor: 2, eventsPerPage: 16, factsPerPage: 16,
};

function bounded_ACU(value: number, key: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 64) throw new Error(`${key} 必须为 1..64 的整数`);
  return value;
}

function compact_ACU(text: string, max = 120): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function due_ACU(next: { day: number } | null, clock: WorldClock_ACU): boolean {
  // 同一天的时段可能是不同历法/自由文本；宁可检查，不凭字典序跳过。
  return next !== null && next.day <= clock.day;
}

function validFactAt_ACU(fact: WorldRecallFactRow_ACU, clock: WorldClock_ACU): boolean {
  if (fact.temporalKind === 'occurrence') return !!fact.happenedAt && fact.happenedAt.day <= clock.day;
  return !!fact.validFrom && fact.validFrom.day <= clock.day
    && (fact.validUntil === null || fact.validUntil.day >= clock.day);
}

function near_ACU(left: WorldLocationRef_ACU | null, right: WorldLocationRef_ACU | null): boolean {
  return !!left && !!right && !!left.place && !!right.place
    && left.region === right.region && left.place === right.place;
}

function relatedRegion_ACU(left: WorldLocationRef_ACU | null, right: WorldLocationRef_ACU | null): boolean {
  return !!left && !!right && left.region === right.region;
}

function actorHistory_ACU(actor: WorldActor_ACU, rows: readonly WorldRecallHistoryRow_ACU[],
  clock: WorldClock_ACU, playerLocation: WorldLocationRef_ACU | null, limits: WorldRecallLimits_ACU) {
  const historyLocation = actor.locationRef ?? playerLocation;
  const relevant = rows.filter(row => row.actorIds.includes(actor.id) && row.happenedAt.day <= clock.day)
    .sort((left, right) => right.happenedAt.day - left.happenedAt.day || left.id.localeCompare(right.id));
  const recent = relevant.slice(0, limits.recentHistoryPerActor);
  const selected = new Set(recent.map(row => row.id));
  const startedAtDay = actor.shortTermAction?.status === 'ongoing' ? actor.shortTermAction.startedAtDay : null;
  const related = relevant.filter(row => !selected.has(row.id)
    && (row.happenedAt.day === startedAtDay || relatedRegion_ACU(row.locationRef, historyLocation)))
    .sort((left, right) => Number(right.happenedAt.day === startedAtDay) - Number(left.happenedAt.day === startedAtDay)
      || right.happenedAt.day - left.happenedAt.day || left.id.localeCompare(right.id))
    .slice(0, limits.relatedHistoryPerActor);
  return { recentHistoryIds: recent.map(row => row.id), relatedHistoryIds: related.map(row => row.id) };
}

/** 仅从调用方已经索引、限额的目录构造召回页；locked fact 永远不携带摘要。 */
export function buildWorldRecallManifestPages_ACU(
  actors: readonly WorldActor_ACU[], clock: WorldClock_ACU, location: WorldLocationRef_ACU | null,
  directory: WorldRecallDirectory_ACU, config: Partial<WorldRecallLimits_ACU> = {},
  actorLocations: readonly WorldLocationRef_ACU[] = actors.filter(actor => actor.simulationStatus !== 'archived')
    .flatMap(actor => actor.locationRef ? [actor.locationRef] : []),
): WorldRecallManifestPage_ACU[] {
  const limits = { ...DEFAULT_LIMITS_ACU, ...config };
  for (const [key, value] of Object.entries(limits)) bounded_ACU(value, key);
  // 目录由上游索引分页取得；不能把无限候选换成无限 deferred ID 注入第一页。
  if (directory.candidateEvents.length > 256 || directory.candidateFacts.length > 256) {
    throw new Error('世界候选目录超出单次上限，须先按索引分页');
  }
  const pages = pageActiveWorldActors_ACU(actors, limits.actorsPerPage);
  if (validateWorldActorPages_ACU(actors, pages).length) throw new Error('人物召回页不完整');
  const byId = new Map(actors.map(actor => [actor.id, actor]));
  const eventCandidates = directory.candidateEvents;
  const relatedToActor = (fact: WorldRecallFactRow_ACU) => actorLocations.some(place => near_ACU(fact.locationRef, place));
  const factCandidates = directory.candidateFacts.filter(fact => validFactAt_ACU(fact, clock) &&
    (due_ACU(fact.nextCheck, clock) || near_ACU(fact.locationRef, location) || relatedToActor(fact)));
  const dueEventIds = eventCandidates.slice(0, limits.eventsPerPage).map(event => event.id);
  const facts = factCandidates.slice(0, limits.factsPerPage);
  const deferred: WorldRecallManifestPage_ACU['deferred'] = [
    ...eventCandidates.slice(limits.eventsPerPage).map(event => ({ kind: 'worldEvent' as const, id: event.id, reason: 'budget' as const })),
    ...factCandidates.slice(limits.factsPerPage).map(fact => ({ kind: 'fact' as const, id: fact.id, reason: 'budget' as const })),
  ];
  // 全局候选只随第一页发送一次；无人时保留一个世界页，避免事件随空 roster 消失。
  return (pages.length ? pages : [[]]).map((actorIds, index) => ({
    actorIds,
    deferred: index === 0 ? deferred : [],
    actors: actorIds.map(actorId => {
      const actor = byId.get(actorId)!;
      return { actorId, name: compact_ACU(actor.name, 64),
        currentAction: actor.currentAction ? compact_ACU(actor.currentAction.text) : null,
        shortTermAction: actor.shortTermAction ? compact_ACU(actor.shortTermAction.text) : null,
        goal: actor.goals[0] ? compact_ACU(actor.goals[0]) : null,
        ...actorHistory_ACU(actor, directory.historyByActor[actorId] ?? [], clock, location, limits),
      };
    }),
    dueEventIds: index === 0 ? dueEventIds : [],
    dueFactIds: index === 0 ? facts.filter(fact => due_ACU(fact.nextCheck, clock) || relatedToActor(fact)).map(fact => fact.id) : [],
    sceneFactIds: index === 0 ? facts.filter(fact => fact.projectionPolicy === 'scene' && fact.revealState === 'unlocked'
      && near_ACU(fact.locationRef, location) && (fact.temporalKind === 'condition' || fact.happenedAt?.day === clock.day))
      .map(fact => fact.id) : [],
    projectionCheckIds: index === 0 ? facts.filter(fact => fact.projectionPolicy === 'gated' && fact.revealState === 'locked')
      .map(fact => fact.id) : [],
  }));
}
