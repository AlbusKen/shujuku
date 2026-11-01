import { activeWorldActorRoster_ACU } from './actor-completions';
import { sha256HexSync_ACU } from '../../shared/sha256-sync';
import { isWorldFactEstablishedAt_ACU } from './world-fact-gate';
import type { WorldActor_ACU, WorldClock_ACU, WorldFact_ACU, WorldHistoryMilestone_ACU,
  WorldLocationRef_ACU, WorldSimulationLedger_ACU, WorldEvent_ACU } from './model';
import { buildWorldRecallManifestPages_ACU, type WorldRecallDirectory_ACU, type WorldRecallHistoryRow_ACU,
  type WorldRecallLimits_ACU, type WorldRecallManifestPage_ACU } from './world-recall-manifest';

export interface WorldRecallIndex_ACU {
  revision: number;
  fingerprint: string;
  actorFingerprint: string;
  events: readonly WorldEvent_ACU[];
  facts: readonly WorldFact_ACU[];
  historyByActor: ReadonlyMap<string, readonly WorldHistoryMilestone_ACU[]>;
}

export interface WorldRecallIndexPage_ACU {
  actorIds: string[];
  directory: WorldRecallDirectory_ACU;
  nextCursor: string | null;
}

function sameLocation_ACU(left: WorldLocationRef_ACU | null, right: WorldLocationRef_ACU | null): boolean {
  return left !== null && right !== null && !!left.place && !!right.place
    && left.region === right.region && left.place === right.place;
}

function candidateFact_ACU(fact: WorldFact_ACU, clock: WorldClock_ACU,
  relevantLocations: readonly WorldLocationRef_ACU[]): boolean {
  if (!isWorldFactEstablishedAt_ACU(fact, clock)) return false;
  const due = fact.nextCheck !== null && fact.nextCheck.day <= clock.day;
  return due || relevantLocations.some(location => sameLocation_ACU(fact.locationRef, location));
}

/** 只在程序内构造的索引；不得把索引或 ledger 本身放进 Agent prompt。 */
export function buildWorldRecallIndex_ACU(ledger: WorldSimulationLedger_ACU): WorldRecallIndex_ACU {
  const historyByActor = new Map<string, WorldHistoryMilestone_ACU[]>();
  for (const milestone of [...ledger.historyMilestones, ...(ledger.historyArchive ?? [])]) {
    for (const id of milestone.actorIds) {
      const history = historyByActor.get(id) ?? [];
      history.push(structuredClone(milestone));
      historyByActor.set(id, history);
    }
  }
  for (const history of historyByActor.values()) {
    history.sort((a, b) => b.happenedAt.day - a.happenedAt.day || a.id.localeCompare(b.id));
  }
  return { revision: ledger.revision,
    fingerprint: sha256HexSync_ACU(JSON.stringify([ledger.revision, ledger.worldEvents, ledger.facts, ledger.factArchive, ledger.historyMilestones, ledger.historyArchive, ledger.actors])),
    actorFingerprint: sha256HexSync_ACU(JSON.stringify(ledger.actors)),
    events: structuredClone(ledger.worldEvents).sort((a, b) => (a.nextCheck?.day ?? Number.MAX_SAFE_INTEGER) - (b.nextCheck?.day ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id)),
    facts: structuredClone(ledger.facts).sort((a, b) => (a.nextCheck?.day ?? Number.MAX_SAFE_INTEGER) - (b.nextCheck?.day ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id)),
    historyByActor };
}

/** cursor 绑定 index revision 和候选时间；旧页不得混入另一轮。 */
export function queryWorldRecallIndexPage_ACU(
  index: WorldRecallIndex_ACU, actors: readonly WorldActor_ACU[], clock: WorldClock_ACU,
  location: WorldLocationRef_ACU | null, pageSize: number, cursor: string | null = null,
): WorldRecallIndexPage_ACU {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 256) throw new Error('召回索引页大小必须为 1..256');
  if (sha256HexSync_ACU(JSON.stringify(actors)) !== index.actorFingerprint) {
    throw new Error('召回人物资料与索引快照不一致');
  }
  const activeIds = activeWorldActorRoster_ACU(actors);
  const actorsById = new Map(actors.map(actor => [actor.id, actor]));
  const relevantLocations = [location, ...activeIds.map(id => actorsById.get(id)!.locationRef)]
    .filter((item): item is WorldLocationRef_ACU => item !== null);
  const scope = sha256HexSync_ACU(JSON.stringify([index.fingerprint, clock.day, clock.slot, location, pageSize, activeIds]));
  const signature = `${scope}:`;
  if (cursor !== null && (!cursor.startsWith(signature) || !/^(0|[1-9]\d*)$/.test(cursor.slice(signature.length)))) {
    throw new Error('召回索引游标与账本或候选时间不一致');
  }
  const offset = cursor === null ? 0 : Number(cursor.slice(signature.length));
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('召回索引游标非法');
  const events = index.events;
  const facts = index.facts.filter(fact => candidateFact_ACU(fact, clock, relevantLocations));
  const count = Math.max(events.length, facts.length, activeIds.length);
  if (offset > count) throw new Error('召回索引游标超出范围');
  const actorIds = activeIds.slice(offset, offset + pageSize);
  const historyByActor: Record<string, readonly WorldRecallHistoryRow_ACU[]> = Object.create(null);
  // 每页仅返回该页人物的有限目录；人物有结构化地点时按本人地点取相关旧史，否则沿用玩家场景地点。
  for (const actorId of actorIds) {
    const history = index.historyByActor.get(actorId) ?? [];
    const actor = actorsById.get(actorId)!;
    const historyLocation = actor.locationRef ?? location;
    const startedAtDay = actor.shortTermAction?.status === 'ongoing' ? actor.shortTermAction.startedAtDay : null;
    const recent = history.filter(row => row.happenedAt.day <= clock.day).slice(0, 3);
    const selected = new Set(recent.map(row => row.id));
    const related = history.filter(row => row.happenedAt.day <= clock.day && !selected.has(row.id)
      && (row.happenedAt.day === startedAtDay
        || historyLocation !== null && row.locationRef?.region === historyLocation.region))
      .sort((left, right) => Number(right.happenedAt.day === startedAtDay) - Number(left.happenedAt.day === startedAtDay)
        || right.happenedAt.day - left.happenedAt.day || left.id.localeCompare(right.id)).slice(0, 2);
    historyByActor[actorId] = [...recent, ...related].map(row => ({
      id: row.id, happenedAt: row.happenedAt, actorIds: [actorId], locationRef: row.locationRef,
    }));
  }
  return { actorIds, directory: { historyByActor,
    candidateEvents: events.slice(offset, offset + pageSize).map(event => ({
      id: event.id, status: event.status, nextCheck: event.nextCheck
        ? { day: event.nextCheck.day, slot: event.nextCheck.slot } : null,
    })),
    candidateFacts: facts.slice(offset, offset + pageSize).map(fact => ({
      id: fact.id, temporalKind: fact.temporalKind, happenedAt: fact.happenedAt,
      validFrom: fact.validFrom, validUntil: fact.validUntil, nextCheck: fact.nextCheck
        ? { day: fact.nextCheck.day, slot: fact.nextCheck.slot } : null,
      locationRef: fact.locationRef, projectionPolicy: fact.projectionPolicy, revealState: fact.revealState,
    })) },
  nextCursor: offset + pageSize < count ? `${signature}${offset + pageSize}` : null };
}

/** 按同一游标分别分页人物与世界候选；每页世界对象不超过清单预算。 */
export function queryWorldRecallManifestPage_ACU(
  index: WorldRecallIndex_ACU, actors: readonly WorldActor_ACU[], clock: WorldClock_ACU,
  location: WorldLocationRef_ACU | null, limits: WorldRecallLimits_ACU, cursor: string | null = null,
): { manifest: WorldRecallManifestPage_ACU; nextCursor: string | null } {
  const pageSize = Math.min(limits.actorsPerPage, limits.eventsPerPage, limits.factsPerPage);
  const page = queryWorldRecallIndexPage_ACU(index, actors, clock, location, pageSize, cursor);
  const selected = new Map(actors.map(actor => [actor.id, actor]));
  const pageActors = page.actorIds.map(id => selected.get(id)!);
  const activeLocations = activeWorldActorRoster_ACU(actors).map(id => selected.get(id)!.locationRef)
    .filter((item): item is WorldLocationRef_ACU => item !== null);
  const manifest = buildWorldRecallManifestPages_ACU(pageActors, clock, location, page.directory,
    { ...limits, actorsPerPage: pageSize }, activeLocations)[0];
  if (manifest.deferred.length) throw new Error('召回页超过清单预算，不能跳过延期对象');
  return { manifest, nextCursor: page.nextCursor };
}
