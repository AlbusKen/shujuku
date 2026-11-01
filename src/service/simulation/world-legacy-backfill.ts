import { sha256HexSync_ACU } from '../../shared/sha256-sync';
import type { WorldChronicleArchiveSnapshot_ACU } from './agent/agent-model';
import { normalizeWorldHistoryArchive_ACU } from './history-archive';
import {
  WorldSimulationValidationError_ACU,
  createWorldSimulationError_ACU,
  type WorldEvent_ACU,
  type WorldFact_ACU,
  type WorldHistoryMilestone_ACU,
  type WorldLegacyMigrationIssue_ACU,
  type WorldSimulationLedger_ACU,
} from './model';
import {
  validateWorldSimulationChronicleArchiveSnapshot_ACU,
  validateWorldSimulationLedger_ACU,
} from './simulation-store';
import { planLegacyRumorFacts_ACU } from './world-legacy-rumor-backfill';
import { allWorldFacts_ACU } from './fact-archive';

function canonicalJson_ACU(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson_ACU).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson_ACU(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function legacyBackfillFingerprint_ACU(ledger: unknown, archive: unknown): string {
  return sha256HexSync_ACU(canonicalJson_ACU([ledger, archive]));
}

export interface WorldLegacyBackfillPlan_ACU {
  ledger: WorldSimulationLedger_ACU;
  changed: boolean;
  addedEventIds: string[];
  addedFactIds: string[];
  addedHistoryIds: string[];
  remainingIssues: WorldLegacyMigrationIssue_ACU[];
}

type LegacyEventSource_ACU = 'dimension' | 'seed';

function legacyEventSourceOf_ACU(event: WorldEvent_ACU): { source: LegacyEventSource_ACU; sourceId: string } | null {
  const legacy = event.legacy;
  if (!legacy || (legacy.source !== 'dimension' && legacy.source !== 'seed') || typeof legacy.sourceId !== 'string') return null;
  return { source: legacy.source, sourceId: legacy.sourceId };
}

function hasEventSource_ACU(events: readonly WorldEvent_ACU[], source: LegacyEventSource_ACU, sourceId: string): boolean {
  return events.some(event => {
    const existing = legacyEventSourceOf_ACU(event);
    return existing?.source === source && existing.sourceId === sourceId;
  });
}

function eventCandidateSource_ACU(event: WorldEvent_ACU): { source: LegacyEventSource_ACU; sourceId: string } | null {
  return legacyEventSourceOf_ACU(event);
}

function conflict_ACU(kind: string, id: string): never {
  throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
    'WORLD_SIMULATION_ENVELOPE_INVALID', 'load', `旧资料补迁 ${kind} ID 冲突：${id}`, false, { id, kind },
  ));
}

function primaryFactSourceRef_ACU(fact: WorldFact_ACU): string | null {
  return fact.sourceRefs.find(ref => ref.startsWith('legacy:rumors:') || ref.startsWith('legacy:actors:')) ?? null;
}

function hasSourceRef_ACU(rows: readonly WorldFact_ACU[], sourceRef: string): boolean {
  return rows.some(row => primaryFactSourceRef_ACU(row) === sourceRef);
}

function allHistory_ACU(ledger: WorldSimulationLedger_ACU): WorldHistoryMilestone_ACU[] {
  return [...ledger.historyMilestones, ...(ledger.historyArchive ?? [])];
}

function hasLegacyRef_ACU(rows: readonly WorldHistoryMilestone_ACU[], legacyRef: string): boolean {
  return rows.some(row => row.legacyRefs.includes(legacyRef));
}

// 只重跑旧资料映射，不让已有 v7 领域混入兼容源。
function buildV6CompatibilitySource_ACU(ledger: WorldSimulationLedger_ACU): Record<string, unknown> {
  const raw = structuredClone(ledger) as unknown as Record<string, unknown>;
  raw.schemaVersion = 6;
  delete raw.worldEvents;
  delete raw.facts;
  delete raw.factArchive;
  delete raw.historyMilestones;
  delete raw.historyArchive;
  delete raw.projection;
  delete raw.legacyMigration;
  if (Array.isArray(raw.actors)) {
    raw.actors = raw.actors.map(actor => {
      if (!actor || typeof actor !== 'object' || Array.isArray(actor)) return actor;
      const legacyActor = { ...(actor as Record<string, unknown>) };
      delete legacyActor.shortTermAction;
      delete legacyActor.simulationStatus;
      delete legacyActor.loreRefs;
      return legacyActor;
    });
  }
  return raw;
}

function isSameMappedEvent_ACU(existing: WorldEvent_ACU, candidate: WorldEvent_ACU): boolean {
  const source = eventCandidateSource_ACU(candidate);
  return !!source && hasEventSource_ACU([existing], source.source, source.sourceId);
}

function appendMappedEvents_ACU(
  ledger: WorldSimulationLedger_ACU,
  candidates: readonly WorldEvent_ACU[],
): { ledger: WorldSimulationLedger_ACU; addedIds: string[] } {
  const events = [...ledger.worldEvents];
  const addedIds: string[] = [];
  for (const candidate of candidates) {
    const source = eventCandidateSource_ACU(candidate);
    if (!source) continue;
    if (events.some(event => isSameMappedEvent_ACU(event, candidate))) continue;
    // 同 ID 但未证明为同一旧来源，不可覆盖或静默吞掉。
    if (events.some(event => event.id === candidate.id)) conflict_ACU('worldEvent', candidate.id);
    events.push(structuredClone(candidate));
    addedIds.push(candidate.id);
  }
  return { ledger: addedIds.length ? { ...ledger, worldEvents: events } : ledger, addedIds };
}

function appendMappedFacts_ACU(
  ledger: WorldSimulationLedger_ACU,
  candidates: readonly WorldFact_ACU[],
): { ledger: WorldSimulationLedger_ACU; addedIds: string[] } {
  const facts = [...ledger.facts];
  const existingFacts = allWorldFacts_ACU(ledger);
  const addedIds: string[] = [];
  for (const candidate of candidates) {
    const primarySource = primaryFactSourceRef_ACU(candidate);
    if (primarySource && hasSourceRef_ACU(existingFacts, primarySource)) continue;
    if (existingFacts.some(fact => fact.id === candidate.id)) conflict_ACU('fact', candidate.id);
    const cloned = structuredClone(candidate);
    facts.push(cloned);
    existingFacts.push(cloned);
    addedIds.push(candidate.id);
  }
  return { ledger: addedIds.length ? { ...ledger, facts } : ledger, addedIds };
}

function eligibleCompatibilityHistory_ACU(
  ledger: WorldSimulationLedger_ACU,
  histories: readonly WorldHistoryMilestone_ACU[],
): WorldHistoryMilestone_ACU[] {
  return histories.filter(history => {
    const chronicleIds = history.legacyRefs.filter(ref => ref.startsWith('legacy:chronicle:'))
      .map(ref => ref.slice('legacy:chronicle:'.length));
    if (!chronicleIds.length) return true;
    const chronicles = chronicleIds.map(id => ledger.chronicle.find(entry => entry.id === id));
    return !chronicles.some((entry): entry is undefined => entry === undefined)
      && chronicles.every(entry => resolveLegacyTargets_ACU(ledger, entry.relatedIds) !== null);
  });
}

function remapHistoryEvents_ACU(
  ledger: WorldSimulationLedger_ACU,
  compatibilityEvents: readonly WorldEvent_ACU[],
  histories: readonly WorldHistoryMilestone_ACU[],
): WorldHistoryMilestone_ACU[] {
  const sourceByCandidateId = new Map(compatibilityEvents.map(event => [event.id, legacyEventSourceOf_ACU(event)]));
  return histories.map(history => ({
    ...history,
    worldEventIds: history.worldEventIds.map(candidateId => {
      const source = sourceByCandidateId.get(candidateId);
      if (!source) return candidateId;
      return ledger.worldEvents.find(event => {
        const existing = legacyEventSourceOf_ACU(event);
        return existing?.source === source.source && existing.sourceId === source.sourceId;
      })?.id ?? candidateId;
    }),
  }));
}

function appendMappedHistory_ACU(
  ledger: WorldSimulationLedger_ACU,
  candidates: readonly WorldHistoryMilestone_ACU[],
): { ledger: WorldSimulationLedger_ACU; addedIds: string[] } {
  const historyMilestones = [...ledger.historyMilestones];
  const existing = allHistory_ACU(ledger);
  const addedIds: string[] = [];
  for (const candidate of candidates) {
    const candidateSourceRefs = candidate.legacyRefs.filter(ref => ref.startsWith('legacy:chronicle:'));
    if (candidateSourceRefs.length && existing.some(history => candidateSourceRefs.every(ref => history.legacyRefs.includes(ref)))) continue;
    if (existing.some(history => history.id === candidate.id)) conflict_ACU('history', candidate.id);
    const cloned = structuredClone(candidate);
    historyMilestones.push(cloned);
    existing.push(cloned);
    addedIds.push(candidate.id);
  }
  return { ledger: addedIds.length ? { ...ledger, historyMilestones } : ledger, addedIds };
}

function strictDayOfChronicle_ACU(at: string): number | null {
  const match = at.match(/^(?:第([1-9]\d*)日|d([1-9]\d*))$/);
  if (!match || match[0] !== at) return null;
  const day = Number(match[1] ?? match[2]);
  return Number.isSafeInteger(day) && day >= 1 ? day : null;
}

function resolveLegacyTargets_ACU(ledger: WorldSimulationLedger_ACU, ids: readonly string[]): { actorIds: string[]; worldEventIds: string[] } | null {
  const actorIds = new Set(ledger.actors.map(actor => actor.id));
  const eventByLegacySource = new Map<string, string[]>();
  for (const event of ledger.worldEvents) {
    const source = legacyEventSourceOf_ACU(event);
    if (source) eventByLegacySource.set(source.sourceId, [...(eventByLegacySource.get(source.sourceId) ?? []), event.id]);
  }
  const resolvedActors: string[] = [];
  const resolvedEvents: string[] = [];
  for (const id of ids) {
    const actorMatch = actorIds.has(id);
    const eventMatches = eventByLegacySource.get(id) ?? [];
    // 同一旧 ID 同时指向 actor/event，或多个事件，均不以任意一项冒充确定关联。
    if ((actorMatch ? 1 : 0) + eventMatches.length !== 1) return null;
    if (actorMatch) resolvedActors.push(id);
    else resolvedEvents.push(eventMatches[0]);
  }
  return { actorIds: [...new Set(resolvedActors)], worldEventIds: [...new Set(resolvedEvents)] };
}

function planArchiveHistory_ACU(
  ledger: WorldSimulationLedger_ACU,
  archive: WorldChronicleArchiveSnapshot_ACU,
): { ledger: WorldSimulationLedger_ACU; addedIds: string[] } {
  let working = ledger;
  const addedIds: string[] = [];
  for (const overview of working.chronicleOverview) {
    const detail = archive.records[overview.archiveRef];
    if (!detail || detail.day !== overview.day
      || detail.fingerprints.filter(fingerprint => fingerprint === overview.fingerprint).length !== 1
      || !detail.sourceChronicleIds.length
      || new Set(detail.sourceChronicleIds).size !== detail.sourceChronicleIds.length) continue;

    const chronicles = detail.sourceChronicleIds.map(id => working.chronicle.find(entry => entry.id === id));
    if (chronicles.some((entry): entry is undefined => entry === undefined)) continue;
    const sourceChronicles = chronicles as NonNullable<typeof chronicles[number]>[];
    if (sourceChronicles.some(entry => strictDayOfChronicle_ACU(entry.at) !== detail.day
      || !entry.missedNote?.trim() || !entry.evidenceRefs.length)) continue;

    // detail 和来源纪要的每一条关联均须可解析，防止归档详情把不存在的引用带入新领域。
    const relatedIds = [...new Set([...detail.relatedIds, ...sourceChronicles.flatMap(entry => entry.relatedIds)])];
    const targets = resolveLegacyTargets_ACU(working, relatedIds);
    if (!targets || (targets.actorIds.length + targets.worldEventIds.length) === 0) continue;

    const archiveRef = `legacy:archive:${detail.archiveRef}`;
    const sourceRefs = detail.sourceChronicleIds.map(id => `legacy:chronicle:${id}`);
    const existing = allHistory_ACU(working);
    const sourceHistories = detail.sourceChronicleIds.map(sourceId =>
      existing.find(history => history.legacyRefs.includes(`legacy:chronicle:${sourceId}`)));
    // 每一条来源纪要都必须已有对应历史，才能复用而不生成语义重复节点。
    if (sourceHistories.every((history): history is WorldHistoryMilestone_ACU => history !== undefined)) {
      const affectedIds = new Set(sourceHistories.map(history => history.id));
      const needsTrace = sourceHistories.some(history => !history.legacyRefs.includes(archiveRef));
      if (needsTrace) {
        const update = (history: WorldHistoryMilestone_ACU): WorldHistoryMilestone_ACU => affectedIds.has(history.id)
          ? (history.legacyRefs.includes(archiveRef) ? history : { ...history, legacyRefs: [...history.legacyRefs, archiveRef] })
          : history;
        working = {
          ...working,
          historyMilestones: working.historyMilestones.map(update),
          ...(working.historyArchive === undefined ? {} : { historyArchive: working.historyArchive.map(update) }),
        };
      }
      continue;
    }
    if (hasLegacyRef_ACU(existing, archiveRef)) continue;
    const id = `legacy-archive-${sha256HexSync_ACU(detail.archiveRef).slice(0, 32)}`;
    if (existing.some(history => history.id === id)) conflict_ACU('history', id);
    const history: WorldHistoryMilestone_ACU = {
      id,
      summary: detail.summary,
      happenedAt: { day: detail.day, slot: '' },
      actorIds: targets.actorIds,
      worldEventIds: targets.worldEventIds,
      locationRef: null,
      sourceFactIds: [],
      importance: 1,
      category: '旧归档重要纪要',
      visibility: 'internal',
      revision: 0,
      legacyRefs: [archiveRef, ...sourceRefs],
    };
    working = { ...working, historyMilestones: [...working.historyMilestones, history] };
    addedIds.push(id);
  }
  return { ledger: working, addedIds };
}

function mappedIssueSources_ACU(ledger: WorldSimulationLedger_ACU): Set<string> {
  const mapped = new Set<string>();
  for (const event of ledger.worldEvents) {
    const source = legacyEventSourceOf_ACU(event);
    if (source) mapped.add(`${source.source}:${source.sourceId}`);
  }
  for (const fact of allWorldFacts_ACU(ledger)) {
    for (const sourceRef of fact.sourceRefs) {
      if (sourceRef.startsWith('legacy:rumors:')) mapped.add(`rumor:${sourceRef.slice('legacy:rumors:'.length)}`);
    }
  }
  for (const history of allHistory_ACU(ledger)) {
    for (const legacyRef of history.legacyRefs) {
      if (legacyRef.startsWith('legacy:chronicle:')) mapped.add(`chronicle:${legacyRef.slice('legacy:chronicle:'.length)}`);
      if (legacyRef.startsWith('legacy:archive:')) mapped.add(`chronicleArchive:${legacyRef.slice('legacy:archive:'.length)}`);
    }
  }
  return mapped;
}

export function planWorldLegacyBackfill_ACU(
  ledger: WorldSimulationLedger_ACU,
  archive: WorldChronicleArchiveSnapshot_ACU,
): WorldLegacyBackfillPlan_ACU {
  const validatedLedger = validateWorldSimulationLedger_ACU(ledger, 'load');
  const validatedArchive = validateWorldSimulationChronicleArchiveSnapshot_ACU(archive, 'load');
  const compatibilityLedger = validateWorldSimulationLedger_ACU(buildV6CompatibilitySource_ACU(validatedLedger), 'load');

  let working = validatedLedger;
  const eventResult = appendMappedEvents_ACU(working, compatibilityLedger.worldEvents);
  working = eventResult.ledger;
  const legacyExperienceFacts = compatibilityLedger.facts;
  const factResult = appendMappedFacts_ACU(working, legacyExperienceFacts);
  working = factResult.ledger;
  const historyResult = appendMappedHistory_ACU(
    working,
    remapHistoryEvents_ACU(
      working,
      compatibilityLedger.worldEvents,
      eligibleCompatibilityHistory_ACU(working, compatibilityLedger.historyMilestones),
    ),
  );
  working = historyResult.ledger;

  const rumorResult = appendMappedFacts_ACU(working, planLegacyRumorFacts_ACU(working));
  working = rumorResult.ledger;
  const archiveResult = planArchiveHistory_ACU(working, validatedArchive);
  working = archiveResult.ledger;

  const mappedSources = mappedIssueSources_ACU(working);
  const compatibilityIssues = new Set(compatibilityLedger.legacyMigration.issues
    .filter(issue => issue.source === 'chronicle' && issue.reason === 'requires_review')
    .map(issue => `${issue.source}:${issue.sourceId}`));
  const remainingIssues = working.legacyMigration.issues.filter(issue =>
    compatibilityIssues.has(`${issue.source}:${issue.sourceId}`) || !mappedSources.has(`${issue.source}:${issue.sourceId}`));
  if (remainingIssues.length !== working.legacyMigration.issues.length) working = { ...working, legacyMigration: { issues: remainingIssues } };

  const normalized = normalizeWorldHistoryArchive_ACU(working);
  const changed = JSON.stringify({ ...normalized, revision: 0 }) !== JSON.stringify({ ...validatedLedger, revision: 0 });
  const nextLedger = changed ? { ...normalized, revision: validatedLedger.revision + 1 } : validatedLedger;
  const finalLedger = validateWorldSimulationLedger_ACU(nextLedger, 'load');

  return {
    ledger: finalLedger,
    changed,
    addedEventIds: eventResult.addedIds,
    addedFactIds: [...factResult.addedIds, ...rumorResult.addedIds],
    addedHistoryIds: [...historyResult.addedIds, ...archiveResult.addedIds],
    remainingIssues: finalLedger.legacyMigration.issues,
  };
}
