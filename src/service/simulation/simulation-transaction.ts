import type { WorldSimulationCandidate_ACU } from './agent/agent-model';
import type { WorldChronicleArchiveDetail_ACU } from './agent/agent-model';
import { findWorldSimulationAgentDefinition_ACU } from './agent/agent-catalog';
import { buildDefaultWorldSimulationSettings_ACU } from './defaults';
import { WorldSimulationValidationError_ACU, createWorldSimulationError_ACU, WORLD_CHRONICLE_OVERVIEW_CAP_ACU, type WorldChronicleOverviewRow_ACU, type WorldGuidanceSignal_ACU, type WorldSimulationLedger_ACU, type WorldSimulationSettings_ACU } from './model';
import {
  coerceWorldSimulationContact_ACU,
  coerceWorldSimulationGuidanceVoice_ACU,
  coerceWorldSimulationInteger_ACU,
  coerceWorldSimulationStringArray_ACU,
  allocateWorldSimulationPrefixedId_ACU,
  WORLD_SIMULATION_UPSERT_ID_PREFIX_ACU,
  normalizeWorldSimulationUpsertItem_ACU,
  type WorldSimulationPatchFixSeverity_ACU,
  type WorldSimulationUpsertModule_ACU,
} from './simulation-patch-normalize';
import { eventFingerprint_ACU } from './event-similarity';
import { collectWorldSimulationLedgerViolations_ACU, validateWorldSimulationLedger_ACU } from './simulation-store';

const MODULES_ACU = ['clock', 'dimensions', 'seeds', 'actors', 'chronicle', 'guidance', 'rumors', 'player'] as const;
type Module_ACU = typeof MODULES_ACU[number];
type Record_ACU = Record<string, unknown>;

function isRecord_ACU(value: unknown): value is Record_ACU { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function fail_ACU(message: string, details?: Record_ACU): never {
  throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU('WORLD_SIMULATION_AGENT_PROTOCOL_INVALID', 'agent_persist', message, false, details));
}
function revisionFail_ACU(message: string, details?: Record_ACU): never {
  throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU('WORLD_SIMULATION_REVISION_CONFLICT', 'agent_persist', message, false, details));
}
function exactKeys_ACU(raw: Record_ACU, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(raw)) if (!allowed.includes(key)) fail_ACU(`${path} 存在未知字段`, { path: `${path}.${key}` });
}
function clone_ACU<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function refs_ACU(value: unknown, path: string): string[] {
  const coerced = coerceWorldSimulationStringArray_ACU(value);
  if (!coerced.ok) fail_ACU(`${path} 必须是字符串数组且元素不能为空`);
  return coerced.value;
}

function resolveDynamics_ACU(settings?: WorldSimulationSettings_ACU): WorldSimulationSettings_ACU['dynamics'] {
  return settings?.dynamics ?? buildDefaultWorldSimulationSettings_ACU().dynamics;
}

function applyUpserts_ACU<T extends { id: string; revision: number }>(
  current: readonly T[],
  raw: unknown,
  path: string,
  module: WorldSimulationUpsertModule_ACU,
  clockDay: number,
  onViolation?: (message: string, details?: Record_ACU) => void,
): T[] {
  const reject = (message: string, details?: Record_ACU): boolean => {
    if (onViolation) {
      onViolation(message, details);
      return true;
    }
    if (details?.revisionConflict) revisionFail_ACU(message, details);
    fail_ACU(message, details);
  };
  if (!isRecord_ACU(raw)) {
    reject(`${path} 必须是对象`);
    return current.map(item => clone_ACU(item));
  }
  if (onViolation) {
    for (const key of Object.keys(raw)) if (key !== 'upsert') reject(`${path} 存在未知字段`, { path: `${path}.${key}`, severity: 'blocking' });
  } else {
    exactKeys_ACU(raw, ['upsert'], path);
  }
  if (!Array.isArray(raw.upsert) || raw.upsert.length === 0) {
    reject(`${path}.upsert 必须是非空数组`);
    return current.map(item => clone_ACU(item));
  }
  const result = current.map(item => clone_ACU(item));
  const seen = new Set<string>();
  for (const [index, item] of raw.upsert.entries()) {
    const itemPath = `${path}.upsert[${index}]`;
    const existingIndex = isRecord_ACU(item) && typeof item.id === 'string' && item.id.trim() ? result.findIndex(entry => entry.id === item.id) : -1;
    const existing = existingIndex < 0 ? null : result[existingIndex] as unknown as Record_ACU;
    const allocateNewId = existing ? undefined : () => {
      const taken = [...result.map(entry => entry.id), ...seen];
      return allocateWorldSimulationPrefixedId_ACU(WORLD_SIMULATION_UPSERT_ID_PREFIX_ACU[module], taken);
    };
    const normalized = normalizeWorldSimulationUpsertItem_ACU({ module, item, existing, path: itemPath, clockDay, allocateNewId });
    let blocked = false;
    for (const note of normalized.notes) {
      if (onViolation) {
        onViolation(note.message, { path: note.path, severity: note.severity, ...note.details });
        if (note.severity === 'blocking') blocked = true;
        continue;
      }
      if (note.severity === 'blocking') {
        reject(note.message, { path: note.path, ...note.details });
      }
    }
    if (blocked || !normalized.item) continue;
    const id = String(normalized.item.id);
    if (seen.has(id)) {
      if (reject(`${path}.upsert 存在重复 ID`, { id, severity: 'blocking' })) continue;
    }
    seen.add(id);
    if (existingIndex < 0) result.push(normalized.item as T);
    else result[existingIndex] = normalized.item as T;
  }
  return result;
}

function collectEvidenceRefs_ACU(value: unknown, output: string[] = []): string[] {
  if (Array.isArray(value)) { for (const item of value) collectEvidenceRefs_ACU(item, output); return output; }
  if (!isRecord_ACU(value)) return output;
  for (const [key, item] of Object.entries(value)) {
    if (key === 'evidenceRefs') output.push(...refs_ACU(item, 'patch.evidenceRefs'));
    else collectEvidenceRefs_ACU(item, output);
  }
  return output;
}

function applyClock_ACU(current: WorldSimulationLedger_ACU['clock'], raw: unknown, dynamics: WorldSimulationSettings_ACU['dynamics']): WorldSimulationLedger_ACU['clock'] {
  if (!isRecord_ACU(raw)) fail_ACU('patch.clock 必须是对象');
  exactKeys_ACU(raw, ['days', 'storyTime', 'slot', 'evidenceRefs'], 'patch.clock');
  if (!Object.keys(raw).length) fail_ACU('patch.clock 不能为空');
  let days = 0;
  if (raw.days !== undefined) {
    const coerced = coerceWorldSimulationInteger_ACU(raw.days);
    if (!coerced.ok || coerced.value < 0) fail_ACU('patch.clock.days 必须是非负整数（clockAdvance 只允许单调向前推进，禁止直接写 day）');
    days = coerced.value;
  }
  if (days > dynamics.maxClockAdvanceDays) {
    const advanceRefs = raw.evidenceRefs;
    if (!Array.isArray(advanceRefs) || !advanceRefs.length || advanceRefs.some(item => typeof item !== 'string' || !item.trim())) {
      fail_ACU(`patch.clock.days 超过 maxClockAdvanceDays=${dynamics.maxClockAdvanceDays}，必须提供非空 evidenceRefs`);
    }
  }
  return {
    day: current.day + days,
    slot: raw.slot === undefined ? current.slot
      : typeof raw.slot === 'string' ? raw.slot : fail_ACU('patch.clock.slot 必须是字符串'),
    storyTime: raw.storyTime === undefined ? current.storyTime
      : typeof raw.storyTime === 'string' ? raw.storyTime : fail_ACU('patch.clock.storyTime 必须是字符串'),
    precision: current.precision,
    evidenceRefs: raw.evidenceRefs === undefined ? [...current.evidenceRefs] : refs_ACU(raw.evidenceRefs, 'patch.clock.evidenceRefs'),
  };
}

function guidanceSignals_ACU(value: unknown, path: string): WorldGuidanceSignal_ACU[] {
  if (!Array.isArray(value)) fail_ACU(`${path} 必须是数组`);
  return value.map((item, index) => {
    if (!isRecord_ACU(item)) fail_ACU(`${path}[${index}] 必须是对象`);
    exactKeys_ACU(item, ['text', 'voice', 'sourceId'], `${path}[${index}]`);
    if (typeof item.text !== 'string' || !item.text.trim()) fail_ACU(`${path}[${index}].text 必须是非空字符串`);
    const voice = coerceWorldSimulationGuidanceVoice_ACU(item.voice);
    if (!voice.ok) fail_ACU(`${path}[${index}].voice 非法`, { actual: item.voice });
    const signal: WorldGuidanceSignal_ACU = { text: item.text, voice: voice.value };
    if (item.sourceId !== undefined) {
      if (typeof item.sourceId !== 'string' || !item.sourceId.trim()) fail_ACU(`${path}[${index}].sourceId 必须是非空字符串`);
      signal.sourceId = item.sourceId;
    }
    return signal;
  });
}

function applyGuidance_ACU(current: WorldSimulationLedger_ACU['guidance'], raw: unknown): WorldSimulationLedger_ACU['guidance'] {
  if (!isRecord_ACU(raw)) fail_ACU('patch.guidance 必须是对象');
  exactKeys_ACU(raw, ['signals', 'excludedFacts', 'evidenceRefs'], 'patch.guidance');
  if (!Object.keys(raw).length) fail_ACU('patch.guidance 不能为空');
  return {
    signals: raw.signals === undefined ? [...current.signals] : guidanceSignals_ACU(raw.signals, 'patch.guidance.signals'),
    excludedFacts: raw.excludedFacts === undefined ? [...current.excludedFacts] : refs_ACU(raw.excludedFacts, 'patch.guidance.excludedFacts'),
    evidenceRefs: raw.evidenceRefs === undefined ? [...current.evidenceRefs] : refs_ACU(raw.evidenceRefs, 'patch.guidance.evidenceRefs'),
  };
}

function applyPlayer_ACU(current: WorldSimulationLedger_ACU['player'], raw: unknown): WorldSimulationLedger_ACU['player'] {
  if (!isRecord_ACU(raw)) fail_ACU('patch.player 必须是对象');
  exactKeys_ACU(raw, ['location', 'contact', 'evidenceRefs'], 'patch.player');
  if (!Object.keys(raw).length) fail_ACU('patch.player 不能为空');
  let location: WorldSimulationLedger_ACU['player']['location'] = current.location ? { ...current.location } : null;
  if (raw.location !== undefined) {
    if (raw.location === null) {
      location = null;
    } else {
      if (!isRecord_ACU(raw.location)) fail_ACU('patch.player.location 必须是对象或 null');
      exactKeys_ACU(raw.location, ['region', 'place'], 'patch.player.location');
      if (typeof raw.location.region !== 'string' || !raw.location.region.trim()) fail_ACU('patch.player.location.region 必须是非空字符串');
      const nextLocation: NonNullable<WorldSimulationLedger_ACU['player']['location']> = { region: raw.location.region };
      if (raw.location.place !== undefined) {
        if (typeof raw.location.place !== 'string') fail_ACU('patch.player.location.place 必须是字符串');
        nextLocation.place = raw.location.place;
      }
      location = nextLocation;
    }
  }
  return {
    location,
    locationUpdatedAtDay: current.locationUpdatedAtDay,
    regionVisits: clone_ACU(current.regionVisits),
    contact: raw.contact === undefined ? current.contact
      : (() => {
        const contact = coerceWorldSimulationContact_ACU(raw.contact);
        return contact.ok ? contact.value : fail_ACU('patch.player.contact 非法');
      })(),
    evidenceRefs: raw.evidenceRefs === undefined ? [...current.evidenceRefs] : refs_ACU(raw.evidenceRefs, 'patch.player.evidenceRefs'),
  };
}

function checkCrossField_ACU(next: WorldSimulationLedger_ACU, onViolation?: (message: string, details?: Record_ACU) => void): void {
  const reject = (message: string, details?: Record_ACU): void => {
    if (onViolation) onViolation(message, details);
    else fail_ACU(message, details);
  };
  for (const rumor of next.rumors) {
    if (rumor.earliestRevealDay < rumor.originDay) reject('rumors 条目 earliestRevealDay 必须 >= originDay', { id: rumor.id, originDay: rumor.originDay, earliestRevealDay: rumor.earliestRevealDay });
    if (rumor.status === 'revealed' && !Number.isInteger(rumor.revealedAtDay)) reject('rumors 条目 status=revealed 必须携带整数 revealedAtDay', { id: rumor.id });
  }
  for (const actor of next.actors) {
    if (actor.life !== 'dead') continue;
    const companion = next.rumors.find(rumor => rumor.relatedActorIds.includes(actor.id) && rumor.channels.length > 0 && (actor.diedAtDay === null || rumor.earliestRevealDay >= actor.diedAtDay));
    if (!companion) reject('actors 条目 life=dead 缺少伴随 rumor（relatedActorIds 含该 actor、channels 非空、earliestRevealDay >= diedAtDay）', { id: actor.id, diedAtDay: actor.diedAtDay });
  }
}

function applyChronicle_ACU(
  current: WorldSimulationLedger_ACU['chronicle'],
  raw: unknown,
  clock: WorldSimulationLedger_ACU['clock'],
): WorldSimulationLedger_ACU['chronicle'] {
  if (!isRecord_ACU(raw)) fail_ACU('patch.chronicle 必须是对象');
  exactKeys_ACU(raw, ['append'], 'patch.chronicle');
  if (!Array.isArray(raw.append) || raw.append.length === 0) fail_ACU('patch.chronicle.append 必须是非空数组');
  const taken = new Set(current.map(item => item.id));
  const appended = raw.append.map((item, index) => {
    const path = `patch.chronicle.append[${index}]`;
    if (!isRecord_ACU(item)) fail_ACU(`${path} 必须是对象`);
    const summary = typeof item.summary === 'string' ? item.summary.trim() : '';
    if (!summary) fail_ACU(`${path}.summary 必须是非空字符串`);
    let id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!id) {
      id = allocateWorldSimulationPrefixedId_ACU(`chr-${clock.day}`, taken);
    }
    if (taken.has(id)) fail_ACU(`${path}.id 与现有或本批编年冲突`, { id });
    taken.add(id);
    const at = typeof item.at === 'string' && item.at.trim()
      ? item.at.trim()
      : (clock.storyTime.trim() || `第${clock.day}日`);
    const related = coerceWorldSimulationStringArray_ACU(item.relatedIds === undefined ? [] : item.relatedIds);
    if (!related.ok) fail_ACU(`${path}.relatedIds 必须是字符串数组`);
    const evidence = coerceWorldSimulationStringArray_ACU(item.evidenceRefs === undefined ? [] : item.evidenceRefs);
    if (!evidence.ok) fail_ACU(`${path}.evidenceRefs 必须是字符串数组`);
    return { id, at, summary, relatedIds: related.value, evidenceRefs: evidence.value };
  });
  return [...clone_ACU(current), ...appended];
}

const ARCHIVE_REF_RE_ACU = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function archiveRef_ACU(value: unknown, path: string): string {
  if (typeof value !== 'string' || !ARCHIVE_REF_RE_ACU.test(value)) fail_ACU(`${path} 不是合法 archiveRef`);
  return value;
}

function overviewRow_ACU(raw: unknown, path: string): WorldChronicleOverviewRow_ACU {
  if (!isRecord_ACU(raw)) fail_ACU(`${path} 必须是对象`);
  exactKeys_ACU(raw, ['fingerprint', 'day', 'oneLine', 'archiveRef'], path);
  if (typeof raw.fingerprint !== 'string' || !raw.fingerprint.trim()) fail_ACU(`${path}.fingerprint 必须是非空字符串`);
  if (typeof raw.oneLine !== 'string' || !raw.oneLine.trim()) fail_ACU(`${path}.oneLine 必须是非空字符串`);
  const day = typeof raw.day === 'number' && Number.isInteger(raw.day) ? raw.day : NaN;
  if (!Number.isInteger(day) || day < 1) fail_ACU(`${path}.day 必须是 >= 1 的整数`);
  return { fingerprint: raw.fingerprint, day, oneLine: raw.oneLine, archiveRef: archiveRef_ACU(raw.archiveRef, `${path}.archiveRef`) };
}

function archiveDetail_ACU(raw: unknown, path: string): WorldChronicleArchiveDetail_ACU {
  if (!isRecord_ACU(raw)) fail_ACU(`${path} 必须是对象`);
  exactKeys_ACU(raw, ['archiveRef', 'day', 'summary', 'fingerprints', 'relatedIds', 'sourceChronicleIds'], path);
  const stringList = (value: unknown, field: string): string[] => {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) fail_ACU(`${path}.${field} 必须是字符串数组`);
    return value as string[];
  };
  const day = typeof raw.day === 'number' && Number.isInteger(raw.day) ? raw.day : NaN;
  if (!Number.isInteger(day) || day < 1) fail_ACU(`${path}.day 必须是 >= 1 的整数`);
  if (typeof raw.summary !== 'string' || !raw.summary.trim()) fail_ACU(`${path}.summary 必须是非空字符串`);
  return {
    archiveRef: archiveRef_ACU(raw.archiveRef, `${path}.archiveRef`),
    day,
    summary: raw.summary,
    fingerprints: stringList(raw.fingerprints, 'fingerprints'),
    relatedIds: stringList(raw.relatedIds, 'relatedIds'),
    sourceChronicleIds: stringList(raw.sourceChronicleIds, 'sourceChronicleIds'),
  };
}

export interface WorldSimulationChronicleArchiveApply_ACU {
  overview: WorldChronicleOverviewRow_ACU[];
  writes: WorldChronicleArchiveDetail_ACU[];
}

export function applyChronicleArchive_ACU(
  current: readonly WorldChronicleOverviewRow_ACU[],
  raw: unknown,
  clockDay: number,
): WorldSimulationChronicleArchiveApply_ACU {
  if (!isRecord_ACU(raw)) fail_ACU('patch.chronicleArchive 必须是对象');
  exactKeys_ACU(raw, ['archiveEntries', 'overviewRows', 'collapseRefs'], 'patch.chronicleArchive');
  if (!Array.isArray(raw.archiveEntries) || raw.archiveEntries.length === 0) fail_ACU('patch.chronicleArchive.archiveEntries 必须是非空数组');
  if (!Array.isArray(raw.overviewRows) || raw.overviewRows.length === 0) fail_ACU('patch.chronicleArchive.overviewRows 必须是非空数组');
  const collapseRefs = raw.collapseRefs === undefined
    ? []
    : Array.isArray(raw.collapseRefs) && raw.collapseRefs.every(item => typeof item === 'string')
      ? raw.collapseRefs as string[]
      : fail_ACU('patch.chronicleArchive.collapseRefs 必须是字符串数组');
  const takenRefs = new Set(current.map(row => row.archiveRef));
  const filledEntries = raw.archiveEntries.map((item, index) => {
    const path = `patch.chronicleArchive.archiveEntries[${index}]`;
    if (!isRecord_ACU(item)) fail_ACU(`${path} 必须是对象`);
    const next = { ...item };
    const suppliedRef = typeof next.archiveRef === 'string' ? next.archiveRef.trim() : '';
    if (!suppliedRef) {
      const allocated = allocateWorldSimulationPrefixedId_ACU(`archive-${clockDay}`, takenRefs);
      next.archiveRef = allocated;
    }
    takenRefs.add(String(next.archiveRef));
    const relatedIds = Array.isArray(next.relatedIds) && next.relatedIds.every(value => typeof value === 'string')
      ? next.relatedIds as string[]
      : [];
    const fingerprints = Array.isArray(next.fingerprints) && next.fingerprints.every(value => typeof value === 'string')
      ? (next.fingerprints as string[]).map(value => value.trim()).filter(Boolean)
      : [];
    const day = typeof next.day === 'number' && Number.isInteger(next.day) ? next.day : clockDay;
    const summary = typeof next.summary === 'string' ? next.summary : '';
    if (!fingerprints.length) {
      next.fingerprints = [eventFingerprint_ACU(summary, String(day), relatedIds)];
    } else {
      next.fingerprints = fingerprints;
    }
    if (next.relatedIds === undefined) next.relatedIds = relatedIds;
    if (next.sourceChronicleIds === undefined) next.sourceChronicleIds = [];
    if (next.day === undefined) next.day = day;
    return next;
  });
  const writes = filledEntries.map((item, index) => archiveDetail_ACU(item, `patch.chronicleArchive.archiveEntries[${index}]`));
  const filledRows = raw.overviewRows.map((item, index) => {
    const path = `patch.chronicleArchive.overviewRows[${index}]`;
    if (!isRecord_ACU(item)) fail_ACU(`${path} 必须是对象`);
    const next = { ...item };
    const paired = writes[index];
    const suppliedRef = typeof next.archiveRef === 'string' ? next.archiveRef.trim() : '';
    if (!suppliedRef) {
      next.archiveRef = paired ? paired.archiveRef : allocateWorldSimulationPrefixedId_ACU(`archive-${clockDay}`, takenRefs);
      takenRefs.add(String(next.archiveRef));
    }
    const day = typeof next.day === 'number' && Number.isInteger(next.day) ? next.day : (paired?.day ?? clockDay);
    if (next.day === undefined) next.day = day;
    const oneLine = typeof next.oneLine === 'string' ? next.oneLine : '';
    const fingerprint = typeof next.fingerprint === 'string' ? next.fingerprint.trim() : '';
    if (!fingerprint) {
      next.fingerprint = paired?.fingerprints[0] || eventFingerprint_ACU(oneLine, String(day), paired?.relatedIds ?? []);
    }
    return next;
  });
  const overviewRows = filledRows.map((item, index) => overviewRow_ACU(item, `patch.chronicleArchive.overviewRows[${index}]`));
  const writeRefs = new Set(writes.map(item => item.archiveRef));
  if (writeRefs.size !== writes.length) fail_ACU('patch.chronicleArchive.archiveEntries archiveRef 必须唯一');
  const overviewRefs = new Set(overviewRows.map(item => item.archiveRef));
  if (overviewRefs.size !== overviewRows.length) fail_ACU('patch.chronicleArchive.overviewRows archiveRef 必须唯一');
  for (const row of overviewRows) {
    if (!writeRefs.has(row.archiveRef)) fail_ACU('overviewRows.archiveRef 必须对应 archiveEntries', { archiveRef: row.archiveRef });
  }
  const collapse = new Set(collapseRefs);
  const retained = current.filter(row => !collapse.has(row.archiveRef));
  const remainingRefs = new Set(retained.map(row => row.archiveRef));
  for (const row of overviewRows) {
    if (remainingRefs.has(row.archiveRef)) fail_ACU('archiveRef 与现有概览目录冲突', { archiveRef: row.archiveRef });
    remainingRefs.add(row.archiveRef);
  }
  const overview = [...retained, ...overviewRows];
  if (overview.length > WORLD_CHRONICLE_OVERVIEW_CAP_ACU) {
    fail_ACU(`chronicleOverview 追加后超过 ${WORLD_CHRONICLE_OVERVIEW_CAP_ACU} 行，必须自带 collapseRefs 合并旧行`, {
      nextCount: overview.length,
      cap: WORLD_CHRONICLE_OVERVIEW_CAP_ACU,
    });
  }
  return { overview, writes };
}

function canWritePatchModule_ACU(module: string, writable: ReadonlySet<string>): boolean {
  if (module === 'chronicleArchive') return writable.has('chronicle');
  return (MODULES_ACU as readonly string[]).includes(module) && writable.has(module);
}

function orderedPatchEntries_ACU(patch: Record<string, unknown>): Array<[string, unknown]> {
  const entries = Object.entries(patch);
  entries.sort((left, right) => (left[0] === 'clock' ? -1 : right[0] === 'clock' ? 1 : 0));
  return entries;
}

export interface WorldSimulationApplyResult_ACU {
  ledger: WorldSimulationLedger_ACU;
  chronicleArchiveWrites: WorldChronicleArchiveDetail_ACU[];
}

export function applyWorldSimulationCandidatesDetailed_ACU(
  base: WorldSimulationLedger_ACU,
  candidates: readonly WorldSimulationCandidate_ACU[],
  authorizedEvidenceRefs: ReadonlySet<string>,
  settings?: WorldSimulationSettings_ACU,
): WorldSimulationApplyResult_ACU {
  const dynamics = resolveDynamics_ACU(settings);
  const validatedBase = validateWorldSimulationLedger_ACU(base, 'agent_persist');
  if (!candidates.length) fail_ACU('commit 必须包含至少一个候选');
  const candidateIds = new Set<string>();
  let next = clone_ACU(validatedBase);
  const chronicleArchiveWrites: WorldChronicleArchiveDetail_ACU[] = [];
  for (const candidate of candidates) {
    if (!candidate.candidateId || candidateIds.has(candidate.candidateId)) fail_ACU('commit candidateId 缺失或重复', { candidateId: candidate.candidateId });
    candidateIds.add(candidate.candidateId);
    if (!isRecord_ACU(candidate.patch) || !Object.keys(candidate.patch).length) fail_ACU('candidate.patch 必须是非空对象', { candidateId: candidate.candidateId });
    const declared = new Set(candidate.evidenceRefs);
    for (const ref of declared) if (!authorizedEvidenceRefs.has(ref)) fail_ACU('候选声明了未授权 evidenceRef', { candidateId: candidate.candidateId, evidenceRef: ref });
    for (const ref of collectEvidenceRefs_ACU(candidate.patch)) {
      if (!declared.has(ref) || !authorizedEvidenceRefs.has(ref)) fail_ACU('patch 使用了未由候选声明并授权的 evidenceRef', { candidateId: candidate.candidateId, evidenceRef: ref });
    }
    const definition = findWorldSimulationAgentDefinition_ACU(candidate.agentName);
    if (!definition) fail_ACU('候选 Agent 不在世界推演角色目录中', { candidateId: candidate.candidateId, agentName: candidate.agentName });
    const writable = new Set<string>(definition.writableModules);
    const forgedPermissions = candidate.writableModules.filter(module => !writable.has(module));
    if (forgedPermissions.length) fail_ACU('候选声明了角色目录未授权的写入模块', { candidateId: candidate.candidateId, forgedPermissions });
    for (const [module, patch] of orderedPatchEntries_ACU(candidate.patch)) {
      if (!canWritePatchModule_ACU(module, writable)) fail_ACU('候选越权写入 ledger 模块', { candidateId: candidate.candidateId, module });
      switch (module) {
        case 'clock': next.clock = applyClock_ACU(next.clock, patch, dynamics); break;
        case 'dimensions': next.dimensions = applyUpserts_ACU(next.dimensions, patch, 'patch.dimensions', 'dimensions', next.clock.day); break;
        case 'seeds': next.seeds = applyUpserts_ACU(next.seeds, patch, 'patch.seeds', 'seeds', next.clock.day); break;
        case 'actors': next.actors = applyUpserts_ACU(next.actors, patch, 'patch.actors', 'actors', next.clock.day); break;
        case 'chronicle': next.chronicle = applyChronicle_ACU(next.chronicle, patch, next.clock); break;
        case 'guidance': next.guidance = applyGuidance_ACU(next.guidance, patch); break;
        case 'rumors': next.rumors = applyUpserts_ACU(next.rumors, patch, 'patch.rumors', 'rumors', next.clock.day); break;
        case 'player': next.player = applyPlayer_ACU(next.player, patch); break;
        case 'chronicleArchive': {
          const archived = applyChronicleArchive_ACU(next.chronicleOverview, patch, next.clock.day);
          next.chronicleOverview = archived.overview;
          chronicleArchiveWrites.push(...archived.writes);
          break;
        }
      }
    }
  }
  checkCrossField_ACU(next);
  next.revision = validatedBase.revision + 1;
  return { ledger: validateWorldSimulationLedger_ACU(next, 'agent_persist'), chronicleArchiveWrites };
}

export function applyWorldSimulationCandidates_ACU(
  base: WorldSimulationLedger_ACU,
  candidates: readonly WorldSimulationCandidate_ACU[],
  authorizedEvidenceRefs: ReadonlySet<string>,
  settings?: WorldSimulationSettings_ACU,
): WorldSimulationLedger_ACU {
  return applyWorldSimulationCandidatesDetailed_ACU(base, candidates, authorizedEvidenceRefs, settings).ledger;
}

export interface WorldSimulationCandidateViolation_ACU {
  candidateId: string;
  agentName: string;
  module: string;
  path: string;
  message: string;
  severity: WorldSimulationPatchFixSeverity_ACU;
  details?: Record<string, unknown>;
}

export interface WorldSimulationCandidatePreflightReport_ACU {
  blocking: WorldSimulationCandidateViolation_ACU[];
  autoFixed: WorldSimulationCandidateViolation_ACU[];
}

export function preflightWorldSimulationCandidates_ACU(
  base: WorldSimulationLedger_ACU,
  candidates: readonly WorldSimulationCandidate_ACU[],
  authorizedEvidenceRefs: ReadonlySet<string>,
  settings?: WorldSimulationSettings_ACU,
): WorldSimulationCandidatePreflightReport_ACU {
  const dynamics = resolveDynamics_ACU(settings);
  const blocking: WorldSimulationCandidateViolation_ACU[] = [];
  const autoFixed: WorldSimulationCandidateViolation_ACU[] = [];
  let validatedBase: WorldSimulationLedger_ACU;
  try {
    validatedBase = validateWorldSimulationLedger_ACU(base, 'agent_persist');
  } catch (error) {
    blocking.push({ candidateId: '', agentName: '', module: '', path: '$', message: error instanceof Error ? error.message : String(error), severity: 'blocking' });
    return { blocking, autoFixed };
  }
  if (!candidates.length) {
    blocking.push({ candidateId: '', agentName: '', module: '', path: '$', message: 'commit 必须包含至少一个候选', severity: 'blocking' });
    return { blocking, autoFixed };
  }
  const next = clone_ACU(validatedBase);
  const candidateIds = new Set<string>();
  for (const candidate of candidates) {
    const push = (module: string, path: string, message: string, details?: Record_ACU): void => {
      const severity: WorldSimulationPatchFixSeverity_ACU = details?.severity === 'autoFixed' ? 'autoFixed' : 'blocking';
      const bucket = severity === 'autoFixed' ? autoFixed : blocking;
      bucket.push({ candidateId: candidate.candidateId, agentName: candidate.agentName, module, path, message, severity, details });
    };
    if (!candidate.candidateId || candidateIds.has(candidate.candidateId)) {
      push('', '$', 'commit candidateId 缺失或重复', { candidateId: candidate.candidateId });
      continue;
    }
    candidateIds.add(candidate.candidateId);
    if (!isRecord_ACU(candidate.patch) || !Object.keys(candidate.patch).length) {
      push('', '$.patch', 'candidate.patch 必须是非空对象');
      continue;
    }
    const declared = new Set(candidate.evidenceRefs);
    for (const ref of declared) if (!authorizedEvidenceRefs.has(ref)) push('', '$.evidenceRefs', `候选声明了未授权 evidenceRef: ${ref}`, { evidenceRef: ref });
    try {
      for (const ref of collectEvidenceRefs_ACU(candidate.patch)) {
        if (!declared.has(ref) || !authorizedEvidenceRefs.has(ref)) push('', '$.patch', `patch 使用了未声明或未授权的 evidenceRef: ${ref}`, { evidenceRef: ref });
      }
    } catch (error) {
      push('', '$.patch', error instanceof Error ? error.message : String(error));
    }
    const definition = findWorldSimulationAgentDefinition_ACU(candidate.agentName);
    if (!definition) {
      push('', '$.agentName', `候选 Agent 不在世界推演角色目录中: ${candidate.agentName}`);
      continue;
    }
    const writable = new Set<string>(definition.writableModules);
    const forgedPermissions = candidate.writableModules.filter(module => !writable.has(module));
    if (forgedPermissions.length) push('', '$.writableModules', `候选声明了角色目录未授权的写入模块: ${forgedPermissions.join(',')}`, { forgedPermissions });
    for (const [module, patch] of orderedPatchEntries_ACU(candidate.patch)) {
      if (!canWritePatchModule_ACU(module, writable)) {
        push(module, `$.patch.${module}`, '候选越权写入 ledger 模块');
        continue;
      }
      const collectUpsert = (message: string, details?: Record_ACU): void => {
        push(module, typeof details?.path === 'string' ? details.path : `$.patch.${module}`, message, details);
      };
      try {
        switch (module) {
          case 'clock': next.clock = applyClock_ACU(next.clock, patch, dynamics); break;
          case 'dimensions': next.dimensions = applyUpserts_ACU(next.dimensions, patch, 'patch.dimensions', 'dimensions', next.clock.day, collectUpsert); break;
          case 'seeds': next.seeds = applyUpserts_ACU(next.seeds, patch, 'patch.seeds', 'seeds', next.clock.day, collectUpsert); break;
          case 'actors': next.actors = applyUpserts_ACU(next.actors, patch, 'patch.actors', 'actors', next.clock.day, collectUpsert); break;
          case 'chronicle': next.chronicle = applyChronicle_ACU(next.chronicle, patch, next.clock); break;
          case 'guidance': next.guidance = applyGuidance_ACU(next.guidance, patch); break;
          case 'rumors': next.rumors = applyUpserts_ACU(next.rumors, patch, 'patch.rumors', 'rumors', next.clock.day, collectUpsert); break;
          case 'player': next.player = applyPlayer_ACU(next.player, patch); break;
          case 'chronicleArchive': next.chronicleOverview = applyChronicleArchive_ACU(next.chronicleOverview, patch, next.clock.day).overview; break;
        }
      } catch (error) {
        push(module, `$.patch.${module}`, error instanceof Error ? error.message : String(error));
      }
    }
  }
  checkCrossField_ACU(next, (message, details) => blocking.push({ candidateId: '', agentName: '', module: '', path: '$.patch', message, severity: 'blocking', details }));
  next.revision = validatedBase.revision + 1;
  for (const message of collectWorldSimulationLedgerViolations_ACU(next)) {
    blocking.push({ candidateId: '', agentName: '', module: '', path: '$', message, severity: 'blocking' });
  }
  return { blocking, autoFixed };
}
