import type { WorldSimulationCandidate_ACU } from './agent/agent-model';
import type { WorldChronicleArchiveDetail_ACU, WorldChronicleArchiveSnapshot_ACU } from './agent/agent-model';
import { findWorldSimulationAgentDefinition_ACU } from './agent/agent-catalog';
import { buildDefaultWorldSimulationSettings_ACU } from './defaults';
import { WorldSimulationValidationError_ACU, createWorldSimulationError_ACU, WORLD_CHRONICLE_OVERVIEW_CAP_ACU, type WorldChronicleOverviewRow_ACU, type WorldGuidanceSignal_ACU, type WorldSimulationLedger_ACU, type WorldSimulationLedgerModule_ACU, type WorldSimulationPendingFix_ACU, type WorldSimulationSettings_ACU } from './model';
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
import { validateWorldSimulationGuidanceComposerSignals_ACU } from './agent/agent-protocol';
import { WorldSimulationSqlViewError_ACU, materializeWorldSimulationLedgerSqlView_ACU, type WorldSimulationSqlArrayModule_ACU, type WorldSimulationSqlSingleton_ACU } from './simulation-ledger-sql-view';

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

function singletonPatch_ACU(raw: unknown, revision: number, module: string): unknown {
  if (!isRecord_ACU(raw) || !Object.prototype.hasOwnProperty.call(raw, 'expectedRevision')) return raw;
  const expected = raw.expectedRevision;
  if (typeof expected !== 'number' || !Number.isInteger(expected) || expected < 0) {
    fail_ACU(`patch.${module}.expectedRevision 必须是非负整数`, { path: `patch.${module}.expectedRevision` });
  }
  if (expected !== revision) revisionFail_ACU(`patch.${module} 账本 revision 冲突`, { expectedRevision: expected, actualRevision: revision, revisionConflict: true });
  const { expectedRevision: _expectedRevision, ...patch } = raw;
  return patch;
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
    for (const key of Object.keys(raw)) if (key !== 'upsert' && key !== 'remove') reject(`${path} 存在未知字段`, { path: `${path}.${key}`, severity: 'blocking' });
  } else {
    exactKeys_ACU(raw, ['upsert', 'remove'], path);
  }
  const upserts = raw.upsert === undefined ? [] : raw.upsert;
  const removals = raw.remove === undefined ? [] : raw.remove;
  if (!Array.isArray(upserts) || !Array.isArray(removals) || (!upserts.length && !removals.length)) {
    reject(`${path} 必须包含非空 upsert 或 remove 数组`);
    return current.map(item => clone_ACU(item));
  }
  const result = current.map(item => clone_ACU(item));
  const seen = new Set<string>();
  for (const [index, removal] of removals.entries()) {
    const itemPath = `${path}.remove[${index}]`;
    if (!isRecord_ACU(removal)) {
      reject(`${itemPath} 必须是对象`, { path: itemPath, severity: 'blocking' });
      continue;
    }
    const id = typeof removal.id === 'string' ? removal.id.trim() : '';
    const reason = typeof removal.reason === 'string' ? removal.reason.trim() : '';
    const expected = coerceWorldSimulationInteger_ACU(removal.expectedRevision);
    const existingIndex = id ? result.findIndex(entry => entry.id === id) : -1;
    if (!id || !reason || !expected.ok || expected.value < 0) {
      reject(`${itemPath} 必须包含非空 id/reason 与非负整数 expectedRevision`, { path: itemPath, severity: 'blocking' });
      continue;
    }
    if (seen.has(id)) {
      reject(`${path} 对同一 ID 重复写入`, { id, path: itemPath, severity: 'blocking' });
      continue;
    }
    if (existingIndex < 0) {
      reject(`${itemPath}.id 不存在`, { id, path: `${itemPath}.id`, severity: 'blocking' });
      continue;
    }
    if (result[existingIndex].revision !== expected.value) {
      reject(`${itemPath} 条目 revision 冲突`, { id, expectedRevision: expected.value, actualRevision: result[existingIndex].revision, revisionConflict: true, path: itemPath, severity: 'blocking' });
      continue;
    }
    seen.add(id);
    result.splice(existingIndex, 1);
  }
  for (const [index, item] of upserts.entries()) {
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
      if (reject(`${path} 对同一 ID 重复写入`, { id, path: itemPath, severity: 'blocking' })) continue;
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
    if (typeof item.sourceId !== 'string' || !item.sourceId.trim()) fail_ACU(`${path}[${index}].sourceId 必须是非空字符串`);
    const signal: WorldGuidanceSignal_ACU = { text: item.text, voice: voice.value, sourceId: item.sourceId.trim() };
    return signal;
  });
}

function applyGuidance_ACU(current: WorldSimulationLedger_ACU['guidance'], raw: unknown, ledger: WorldSimulationLedger_ACU, anchorMessage = ''): WorldSimulationLedger_ACU['guidance'] {
  if (!isRecord_ACU(raw)) fail_ACU('patch.guidance 必须是对象');
  exactKeys_ACU(raw, ['signals', 'excludedFacts', 'evidenceRefs'], 'patch.guidance');
  if (!Object.keys(raw).length) fail_ACU('patch.guidance 不能为空');
  const signals = raw.signals === undefined ? [...current.signals] : guidanceSignals_ACU(raw.signals, 'patch.guidance.signals');
  if (raw.signals !== undefined) validateWorldSimulationGuidanceComposerSignals_ACU(signals, ledger, anchorMessage);
  return {
    signals,
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
  exactKeys_ACU(raw, ['append', 'remove'], 'patch.chronicle');
  const append = raw.append === undefined ? [] : raw.append;
  const remove = raw.remove === undefined ? [] : raw.remove;
  if (!Array.isArray(append) || !Array.isArray(remove) || (!append.length && !remove.length)) fail_ACU('patch.chronicle 必须包含非空 append 或 remove 数组');
  const removedIds = new Set<string>();
  for (const [index, item] of remove.entries()) {
    const path = `patch.chronicle.remove[${index}]`;
    if (!isRecord_ACU(item)) fail_ACU(`${path} 必须是对象`);
    exactKeys_ACU(item, ['id', 'reason'], path);
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const reason = typeof item.reason === 'string' ? item.reason.trim() : '';
    if (!id || !reason) fail_ACU(`${path} 必须包含非空 id 与 reason`);
    if (removedIds.has(id)) fail_ACU(`${path}.id 重复`, { id });
    if (!current.some(entry => entry.id === id)) fail_ACU(`${path}.id 不存在`, { id });
    removedIds.add(id);
  }
  const retained = current.filter(item => !removedIds.has(item.id));
  const taken = new Set(retained.map(item => item.id));
  const appended = append.map((item, index) => {
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
  return [...clone_ACU(retained), ...appended];
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
  const rank = (key: string): number => ({
    clock: 0, rumors: 1, dimensions: 2, seeds: 3, actors: 4, player: 5, chronicle: 6, chronicleArchive: 7, guidance: 8,
  }[key] ?? 99);
  entries.sort((left, right) => rank(left[0]) - rank(right[0]));
  return entries;
}

function pendingModuleOf_ACU(module: string): WorldSimulationLedgerModule_ACU {
  return module === 'chronicleArchive' ? 'chronicle' : module as WorldSimulationLedgerModule_ACU;
}

function recordPendingFix_ACU(
  pending: WorldSimulationPendingFix_ACU[],
  module: WorldSimulationLedgerModule_ACU,
  candidateId: string,
  agentName: string,
  violations: Array<{ path: string; message: string }>,
  day: number,
): void {
  const now = Date.now();
  const lastError = violations.map(item => item.message).join('；') || '模块入库失败';
  const index = pending.findIndex(item => item.module === module);
  if (index >= 0) {
    const previous = pending[index];
    pending[index] = {
      module,
      candidateId: candidateId || previous.candidateId,
      agentName: agentName || previous.agentName,
      violations: violations.length ? violations : previous.violations,
      attempts: previous.attempts + 1,
      firstFailedAtDay: previous.firstFailedAtDay,
      lastError,
      source: 'transaction_rejected',
      completion: previous.acceptedKeys.length ? 'partial' : 'failed',
      acceptedKeys: previous.acceptedKeys,
      anchor: previous.anchor,
      createdAt: previous.createdAt,
      updatedAt: now,
    };
    return;
  }
  pending.push({
    module,
    candidateId,
    agentName,
    violations,
    attempts: 1,
    firstFailedAtDay: day,
    lastError,
    source: 'transaction_rejected',
    completion: 'failed',
    acceptedKeys: [],
    anchor: null,
    createdAt: now,
    updatedAt: now,
  });
}

function violationModule_ACU(message: string): WorldSimulationLedgerModule_ACU | null {
  if (message.includes('缺少伴随 rumor') || message.includes('ledger.actors')) return 'actors';
  if (message.includes('ledger.rumors') || message.includes('earliestRevealDay')) return 'rumors';
  if (message.includes('ledger.seeds')) return 'seeds';
  if (message.includes('ledger.dimensions')) return 'dimensions';
  if (message.includes('ledger.player')) return 'player';
  if (message.includes('ledger.clock')) return 'clock';
  if (message.includes('ledger.guidance')) return 'guidance';
  if (message.includes('ledger.chronicle')) return 'chronicle';
  return null;
}

function restoreLedgerModule_ACU(next: WorldSimulationLedger_ACU, base: WorldSimulationLedger_ACU, module: WorldSimulationLedgerModule_ACU): void {
  switch (module) {
    case 'clock': next.clock = clone_ACU(base.clock); break;
    case 'dimensions': next.dimensions = clone_ACU(base.dimensions); break;
    case 'seeds': next.seeds = clone_ACU(base.seeds); break;
    case 'actors': next.actors = clone_ACU(base.actors); break;
    case 'chronicle':
      next.chronicle = clone_ACU(base.chronicle);
      next.chronicleOverview = clone_ACU(base.chronicleOverview);
      break;
    case 'guidance': next.guidance = clone_ACU(base.guidance); break;
    case 'rumors': next.rumors = clone_ACU(base.rumors); break;
    case 'player': next.player = clone_ACU(base.player); break;
    default: break;
  }
}

function crossFieldProblems_ACU(next: WorldSimulationLedger_ACU): Array<{ module: WorldSimulationLedgerModule_ACU; message: string }> {
  const problems: Array<{ module: WorldSimulationLedgerModule_ACU; message: string }> = [];
  const push = (message: string): void => {
    const module = violationModule_ACU(message);
    if (module) problems.push({ module, message });
  };
  checkCrossField_ACU(next, push);
  for (const message of collectWorldSimulationLedgerViolations_ACU(next)) push(message);
  return problems;
}

function clearPendingModule_ACU(pending: WorldSimulationPendingFix_ACU[], module: WorldSimulationLedgerModule_ACU): void {
  for (let index = pending.length - 1; index >= 0; index -= 1) {
    if (pending[index].module === module) pending.splice(index, 1);
  }
}

export interface WorldSimulationSqlDiagnostic_ACU {
  code: 'WORLD_SIMULATION_SQL_VIEW_FAILED';
  message: string;
  module?: string;
}

export interface WorldSimulationApplyResult_ACU {
  ledger: WorldSimulationLedger_ACU;
  chronicleArchiveWrites: WorldChronicleArchiveDetail_ACU[];
  pendingFixes: WorldSimulationPendingFix_ACU[];
  appliedModules: WorldSimulationLedgerModule_ACU[];
  sqlDiagnostics: WorldSimulationSqlDiagnostic_ACU[];
}

export interface WorldSimulationApplyContext_ACU {
  anchorMessage?: string;
  chronicleArchive?: WorldChronicleArchiveSnapshot_ACU;
}

export function applyWorldSimulationCandidatesDetailed_ACU(
  base: WorldSimulationLedger_ACU,
  candidates: readonly WorldSimulationCandidate_ACU[],
  authorizedEvidenceRefs: ReadonlySet<string>,
  settings?: WorldSimulationSettings_ACU,
  context?: WorldSimulationApplyContext_ACU,
): WorldSimulationApplyResult_ACU {
  const dynamics = resolveDynamics_ACU(settings);
  const validatedBase = validateWorldSimulationLedger_ACU(base, 'agent_persist');
  if (!candidates.length) fail_ACU('commit 必须包含至少一个候选');
  const candidateIds = new Set<string>();
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
    for (const [module] of orderedPatchEntries_ACU(candidate.patch)) {
      if (!canWritePatchModule_ACU(module, writable)) fail_ACU('候选越权写入 ledger 模块', { candidateId: candidate.candidateId, module });
    }
  }

  let next = clone_ACU(validatedBase);
  const chronicleArchiveWrites: WorldChronicleArchiveDetail_ACU[] = [];
  const pendingFixes = clone_ACU(validatedBase.pendingFixes);
  const appliedModules = new Set<WorldSimulationLedgerModule_ACU>();
  const moduleWriters = new Map<WorldSimulationLedgerModule_ACU, { candidateId: string; agentName: string }>();

  for (const candidate of candidates) {
    for (const [module, patch] of orderedPatchEntries_ACU(candidate.patch)) {
      const ledgerModule = pendingModuleOf_ACU(module);
      const snapshot = clone_ACU(next);
      const blocking: Array<{ path: string; message: string }> = [];
      const collect = (message: string, details?: Record_ACU): void => {
        const severity = details?.severity === 'autoFixed' ? 'autoFixed' : 'blocking';
        if (severity === 'blocking') {
          blocking.push({ path: typeof details?.path === 'string' ? details.path : `$.patch.${module}`, message });
        }
      };
      try {
        switch (module) {
          case 'clock': next.clock = applyClock_ACU(next.clock, singletonPatch_ACU(patch, validatedBase.revision, module), dynamics); break;
          case 'dimensions': next.dimensions = applyUpserts_ACU(next.dimensions, patch, 'patch.dimensions', 'dimensions', next.clock.day, collect); break;
          case 'seeds': next.seeds = applyUpserts_ACU(next.seeds, patch, 'patch.seeds', 'seeds', next.clock.day, collect); break;
          case 'actors': next.actors = applyUpserts_ACU(next.actors, patch, 'patch.actors', 'actors', next.clock.day, collect); break;
          case 'chronicle': next.chronicle = applyChronicle_ACU(next.chronicle, patch, next.clock); break;
          case 'guidance': next.guidance = applyGuidance_ACU(next.guidance, singletonPatch_ACU(patch, validatedBase.revision, module), next, context?.anchorMessage ?? ''); break;
          case 'rumors': next.rumors = applyUpserts_ACU(next.rumors, patch, 'patch.rumors', 'rumors', next.clock.day, collect); break;
          case 'player': next.player = applyPlayer_ACU(next.player, singletonPatch_ACU(patch, validatedBase.revision, module)); break;
          case 'chronicleArchive': {
            const archived = applyChronicleArchive_ACU(next.chronicleOverview, patch, next.clock.day);
            next.chronicleOverview = archived.overview;
            chronicleArchiveWrites.push(...archived.writes);
            break;
          }
        }
        if (blocking.length) {
          const changed = JSON.stringify(next[ledgerModule === 'chronicle' && module === 'chronicleArchive' ? 'chronicleOverview' : ledgerModule])
            !== JSON.stringify(snapshot[ledgerModule === 'chronicle' && module === 'chronicleArchive' ? 'chronicleOverview' : ledgerModule]);
          if (!changed) {
            next = snapshot;
            if (module === 'chronicleArchive') {
              const snapshotRefs = new Set(snapshot.chronicleOverview.map(row => row.archiveRef));
              for (let index = chronicleArchiveWrites.length - 1; index >= 0; index -= 1) {
                if (!snapshotRefs.has(chronicleArchiveWrites[index].archiveRef)) chronicleArchiveWrites.splice(index, 1);
              }
            }
          }
          recordPendingFix_ACU(pendingFixes, ledgerModule, candidate.candidateId, candidate.agentName, blocking, next.clock.day);
          continue;
        }
        clearPendingModule_ACU(pendingFixes, ledgerModule);
        appliedModules.add(ledgerModule);
        moduleWriters.set(ledgerModule, { candidateId: candidate.candidateId, agentName: candidate.agentName });
      } catch (error) {
        next = snapshot;
        recordPendingFix_ACU(
          pendingFixes,
          ledgerModule,
          candidate.candidateId,
          candidate.agentName,
          [{ path: `$.patch.${module}`, message: error instanceof Error ? error.message : String(error) }],
          snapshot.clock.day,
        );
      }
    }
  }

  const problems = crossFieldProblems_ACU(next);
  const grouped = new Map<WorldSimulationLedgerModule_ACU, string[]>();
  for (const problem of problems) {
    const messages = grouped.get(problem.module) ?? [];
    messages.push(problem.message);
    grouped.set(problem.module, messages);
  }
  for (const [module, messages] of grouped) {
    const writer = moduleWriters.get(module);
    const owner = writer ?? {
      candidateId: candidates.find(item => Object.prototype.hasOwnProperty.call(item.patch, module))?.candidateId || candidates[0]?.candidateId || 'commit',
      agentName: candidates.find(item => Object.prototype.hasOwnProperty.call(item.patch, module))?.agentName || candidates[0]?.agentName || 'world-director',
    };
    restoreLedgerModule_ACU(next, validatedBase, module);
    appliedModules.delete(module);
    moduleWriters.delete(module);
    if (module === 'chronicle') {
      const refs = new Set(next.chronicleOverview.map(row => row.archiveRef));
      for (let index = chronicleArchiveWrites.length - 1; index >= 0; index -= 1) {
        if (!refs.has(chronicleArchiveWrites[index].archiveRef)) chronicleArchiveWrites.splice(index, 1);
      }
    }
    recordPendingFix_ACU(
      pendingFixes,
      module,
      owner.candidateId,
      owner.agentName,
      messages.map(message => ({ path: `$.${module}`, message })),
      next.clock.day,
    );
  }
  const remaining = crossFieldProblems_ACU(next);
  if (remaining.length) fail_ACU(remaining.map(item => item.message).join('；'));
  next.pendingFixes = pendingFixes;
  next.revision = validatedBase.revision + 1;
  const ledger = validateWorldSimulationLedger_ACU(next, 'agent_persist');
  return { ledger, chronicleArchiveWrites, pendingFixes: ledger.pendingFixes, appliedModules: [...appliedModules], sqlDiagnostics: [] };
}

export function applyWorldSimulationCandidates_ACU(
  base: WorldSimulationLedger_ACU,
  candidates: readonly WorldSimulationCandidate_ACU[],
  authorizedEvidenceRefs: ReadonlySet<string>,
  settings?: WorldSimulationSettings_ACU,
  context?: WorldSimulationApplyContext_ACU,
): WorldSimulationLedger_ACU {
  return applyWorldSimulationCandidatesDetailed_ACU(base, candidates, authorizedEvidenceRefs, settings, context).ledger;
}

/* ===================== SQL 易失视图校验变体 =====================
 * 计划 D3/D4：候选应用结果在既有 JSON 事务链产出后，再经 SQL 易失视图行级复算：
 * 物化应用前账本 → 逐模块 diff 出 upsert/remove 行 → SQL 层 revision 乐观锁链式推进 →
 * 读回比对。物化或执行失败 fail-closed 回退既有 JSON 链结果，不产生空资料。
 * 注意：账本 revision 语义是「每次 commit +1」而非每模块 +1，因此复算只比对行内容，
 * revision 期望值按视图内写入次数链式推进，不与账本 revision 直接比对。
 */

const SQL_VERIFY_ARRAY_MODULES_ACU = [
  ['dimensions', 'id'],
  ['seeds', 'id'],
  ['actors', 'id'],
  ['chronicle', 'id'],
  ['rumors', 'id'],
  ['chronicleOverview', 'fingerprint'],
] as const;

const SQL_VERIFY_SINGLETONS_ACU = ['clock', 'player', 'guidance'] as const;

function diffLedgerRows_ACU(
  before: readonly Record_ACU[],
  after: readonly Record_ACU[],
  idKey: string,
): { upserts: Record_ACU[]; removedIds: string[] } {
  const keyOf = (item: Record_ACU): string => (typeof item[idKey] === 'string' ? item[idKey] as string : '');
  const previousById = new Map(before.map(item => [keyOf(item), item]));
  const nextIds = new Set(after.map(item => keyOf(item)));
  const upserts = after.filter(item => {
    const prior = previousById.get(keyOf(item));
    return !prior || JSON.stringify(prior) !== JSON.stringify(item);
  });
  const removedIds = before.map(item => keyOf(item)).filter(id =>id && !nextIds.has(id));
  return { upserts, removedIds };
}

async function verifyWorldSimulationRowsViaSql_ACU(
  base: WorldSimulationLedger_ACU,
  after: WorldSimulationLedger_ACU,
  archiveWrites: readonly WorldChronicleArchiveDetail_ACU[],
  archive?: WorldChronicleArchiveSnapshot_ACU,
): Promise<void> {
  const view = await materializeWorldSimulationLedgerSqlView_ACU(base, archive);
  try {
    let expected = base.revision;
    for (const [module, idKey] of SQL_VERIFY_ARRAY_MODULES_ACU) {
      const diff = diffLedgerRows_ACU(
        base[module] as unknown as readonly Record_ACU[],
        after[module] as unknown as readonly Record_ACU[],
        idKey,
      );
      if (!diff.upserts.length && !diff.removedIds.length) continue;
      expected = view.applyArrayWrite({ module: module as WorldSimulationSqlArrayModule_ACU, upserts: diff.upserts, removedIds: diff.removedIds, expectedRevision: expected });
    }
    for (const module of SQL_VERIFY_SINGLETONS_ACU) {
      if (JSON.stringify(base[module]) === JSON.stringify(after[module])) continue;
      expected = view.applySingletonWrite({ module: module as WorldSimulationSqlSingleton_ACU, value: after[module], expectedRevision: expected });
    }
    if (archiveWrites.length) {
      view.applyArchiveWrite({ upserts: archiveWrites });
    }
    const verified = view.readLedger();
    for (const [module] of SQL_VERIFY_ARRAY_MODULES_ACU) {
      if (JSON.stringify(after[module]) !== JSON.stringify(verified[module])) {
        throw new WorldSimulationSqlViewError_ACU(`模块 ${module} SQL 复算结果与事务结果不一致`, { module });
      }
    }
    for (const module of SQL_VERIFY_SINGLETONS_ACU) {
      if (JSON.stringify(after[module]) !== JSON.stringify(verified[module])) {
        throw new WorldSimulationSqlViewError_ACU(`模块 ${module} SQL 复算结果与事务结果不一致`, { module });
      }
    }
    if (archiveWrites.length) {
      const exported = view.exportArchiveRecords();
      const expectedArchive = Object.fromEntries(archiveWrites.map(item => [item.archiveRef, item]));
      if (JSON.stringify(exported) !== JSON.stringify(expectedArchive)) {
        throw new WorldSimulationSqlViewError_ACU('模块 chronicleArchive SQL 复算结果与事务结果不一致', {
          module: 'chronicleArchive',
        });
      }
    }
  } finally {
    view.dispose();
  }
}

/**
 * applyWorldSimulationCandidatesDetailed_ACU 的 SQL 视图变体。
 * 业务合并仍由既有 JSON 事务链完成（保留全部领域校验与 pendingFixes 语义），
 * 结果账本再经 SQL 易失视图按元素行级复算校验；SQL 物化或执行失败时
 * fail-closed 回退 JSON 链结果。chronicleArchiveWrites 与 commit 链输入形态不变。
 */
export async function applyWorldSimulationCandidatesDetailedViaSql_ACU(
  base: WorldSimulationLedger_ACU,
  candidates: readonly WorldSimulationCandidate_ACU[],
  authorizedEvidenceRefs: ReadonlySet<string>,
  settings?: WorldSimulationSettings_ACU,
  context?: WorldSimulationApplyContext_ACU,
): Promise<WorldSimulationApplyResult_ACU> {
  const applied = applyWorldSimulationCandidatesDetailed_ACU(base, candidates, authorizedEvidenceRefs, settings, context);
  try {
    await verifyWorldSimulationRowsViaSql_ACU(base, applied.ledger, applied.chronicleArchiveWrites, context?.chronicleArchive);
  } catch (error) {
    const diagnostic: WorldSimulationSqlDiagnostic_ACU = {
      code: 'WORLD_SIMULATION_SQL_VIEW_FAILED',
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof WorldSimulationSqlViewError_ACU && error.module
        ? { module: error.module }
        : {}),
    };
    return { ...applied, sqlDiagnostics: [diagnostic] };
  }
  return applied;
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
          case 'clock': next.clock = applyClock_ACU(next.clock, singletonPatch_ACU(patch, validatedBase.revision, module), dynamics); break;
          case 'dimensions': next.dimensions = applyUpserts_ACU(next.dimensions, patch, 'patch.dimensions', 'dimensions', next.clock.day, collectUpsert); break;
          case 'seeds': next.seeds = applyUpserts_ACU(next.seeds, patch, 'patch.seeds', 'seeds', next.clock.day, collectUpsert); break;
          case 'actors': next.actors = applyUpserts_ACU(next.actors, patch, 'patch.actors', 'actors', next.clock.day, collectUpsert); break;
          case 'chronicle': next.chronicle = applyChronicle_ACU(next.chronicle, patch, next.clock); break;
          case 'guidance': next.guidance = applyGuidance_ACU(next.guidance, singletonPatch_ACU(patch, validatedBase.revision, module), next); break;
          case 'rumors': next.rumors = applyUpserts_ACU(next.rumors, patch, 'patch.rumors', 'rumors', next.clock.day, collectUpsert); break;
          case 'player': next.player = applyPlayer_ACU(next.player, singletonPatch_ACU(patch, validatedBase.revision, module)); break;
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

/** 逐栏提交的领域检查：复用单例应用、条目归一化与跨模块一致性，不隐式创建 partial 完整行。 */
export function applyWorldSimulationFieldDomain_ACU(
  ledger: WorldSimulationLedger_ACU,
  module: WorldSimulationLedgerModule_ACU,
  id: string,
  values: Record<string, unknown>,
  action: 'insert' | 'update' | 'delete',
  settings?: WorldSimulationSettings_ACU,
  anchorMessage = '',
  deferCrossValidation = false,
): WorldSimulationLedger_ACU {
  const next = clone_ACU(ledger);
  if (module === 'clock') next.clock = applyClock_ACU(next.clock, values, resolveDynamics_ACU(settings));
  else if (module === 'player') next.player = applyPlayer_ACU(next.player, values);
  else if (module === 'guidance') next.guidance = applyGuidance_ACU(next.guidance, values, next, anchorMessage);
  else if (module === 'chronicle') next.chronicle = applyChronicle_ACU(next.chronicle,
    action === 'delete' ? { remove: [{ id, reason: values.reason }] } : { append: [{ id, ...values }] }, next.clock);
  else {
    const current = next[module] as Array<{ id: string; revision: number }>;
    next[module] = applyUpserts_ACU(current,
      action === 'delete' ? { remove: [{ id, expectedRevision: values.expectedRevision, reason: values.reason }] }
        : { upsert: [{ id, ...values, expectedRevision: values.expectedRevision }] },
      `patch.${module}`, module, next.clock.day) as never;
  }
  if (!deferCrossValidation) {
    const problems = crossFieldProblems_ACU(next);
    if (problems.length) fail_ACU(problems.map(item => item.message).join('；'));
  }
  next.revision = ledger.revision + 1;
  return deferCrossValidation ? next : validateWorldSimulationLedger_ACU(next, 'agent_persist');
}
