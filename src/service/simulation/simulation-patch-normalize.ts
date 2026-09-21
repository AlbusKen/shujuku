import {
  WORLD_ACTOR_LIFE_ACU,
  WORLD_GUIDANCE_SIGNAL_VOICES_ACU,
  WORLD_PLAYER_CONTACTS_ACU,
  WORLD_RUMOR_STATUSES_ACU,
  WORLD_SEED_EXPOSE_POLICIES_ACU,
  WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU,
  type WorldLocationRef_ACU,
} from './model';

export type WorldSimulationUpsertModule_ACU = 'dimensions' | 'seeds' | 'actors' | 'rumors';
export type WorldSimulationPatchFixSeverity_ACU = 'autoFixed' | 'blocking';

export interface WorldSimulationPatchNormalizationNote_ACU {
  severity: WorldSimulationPatchFixSeverity_ACU;
  path: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface WorldSimulationNormalizeUpsertResult_ACU {
  item: Record<string, unknown> | null;
  notes: WorldSimulationPatchNormalizationNote_ACU[];
}

const isRecord_ACU = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

export function coerceWorldSimulationStringArray_ACU(value: unknown): { ok: true; value: string[]; autoFixed: boolean } | { ok: false } {
  if (Array.isArray(value)) {
    if (!value.every(item => typeof item === 'string')) return { ok: false };
    const cleaned = value.map(item => item.trim()).filter(Boolean);
    return { ok: true, value: cleaned, autoFixed: cleaned.length !== value.length || value.some((item, index) => item !== cleaned[index] && cleaned.includes(item.trim())) };
  }
  if (typeof value === 'string') {
    return { ok: true, value: value.split(',').map(item => item.trim()).filter(Boolean), autoFixed: true };
  }
  return { ok: false };
}

export function coerceWorldSimulationInteger_ACU(value: unknown): { ok: true; value: number; autoFixed: boolean } | { ok: false } {
  if (typeof value === 'number' && Number.isInteger(value)) return { ok: true, value, autoFixed: false };
  if (typeof value === 'string' && /^[+-]?\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isInteger(parsed)) return { ok: true, value: parsed, autoFixed: true };
  }
  return { ok: false };
}

export function coerceWorldSimulationEnum_ACU<T extends string>(value: unknown, allowed: readonly T[]): { ok: true; value: T; autoFixed: boolean } | { ok: false } {
  if (typeof value !== 'string') return { ok: false };
  const trimmed = value.trim();
  if ((allowed as readonly string[]).includes(trimmed)) return { ok: true, value: trimmed as T, autoFixed: trimmed !== value };
  const lowered = trimmed.toLowerCase();
  const matched = allowed.find(item => item === lowered);
  return matched ? { ok: true, value: matched, autoFixed: true } : { ok: false };
}

function note_ACU(notes: WorldSimulationPatchNormalizationNote_ACU[], severity: WorldSimulationPatchFixSeverity_ACU, path: string, message: string, details?: Record<string, unknown>): void {
  notes.push(details ? { severity, path, message, details } : { severity, path, message });
}

function takeText_ACU(value: unknown, allowEmpty: boolean): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed && !allowEmpty) return undefined;
  return allowEmpty ? value : trimmed;
}

function applyString_ACU(target: Record<string, unknown>, key: string, raw: unknown, path: string, notes: WorldSimulationPatchNormalizationNote_ACU[], allowEmpty: boolean): boolean {
  if (raw === undefined) return true;
  if (typeof raw !== 'string') {
    note_ACU(notes, 'blocking', `${path}.${key}`, `${path}.${key} 必须是字符串`);
    return false;
  }
  const next = allowEmpty ? raw : raw.trim();
  if (!allowEmpty && !next) {
    note_ACU(notes, 'blocking', `${path}.${key}`, `${path}.${key} 必须是非空字符串`);
    return false;
  }
  if (next !== raw) note_ACU(notes, 'autoFixed', `${path}.${key}`, `${path}.${key} 已去除首尾空白`);
  target[key] = next;
  return true;
}

function applyInteger_ACU(target: Record<string, unknown>, key: string, raw: unknown, path: string, notes: WorldSimulationPatchNormalizationNote_ACU[], min: number, max = Number.MAX_SAFE_INTEGER): boolean {
  if (raw === undefined) return true;
  const coerced = coerceWorldSimulationInteger_ACU(raw);
  if (!coerced.ok || coerced.value < min || coerced.value > max) {
    note_ACU(notes, 'blocking', `${path}.${key}`, `${path}.${key} 必须是 ${min}..${max} 的整数`, { actual: raw });
    return false;
  }
  if (coerced.autoFixed) note_ACU(notes, 'autoFixed', `${path}.${key}`, `${path}.${key} 已从数字字符串归一为整数`);
  target[key] = coerced.value;
  return true;
}

function applyEnum_ACU<T extends string>(target: Record<string, unknown>, key: string, raw: unknown, path: string, notes: WorldSimulationPatchNormalizationNote_ACU[], allowed: readonly T[]): boolean {
  if (raw === undefined) return true;
  const coerced = coerceWorldSimulationEnum_ACU(raw, allowed);
  if (!coerced.ok) {
    note_ACU(notes, 'blocking', `${path}.${key}`, `${path}.${key} 枚举非法`, { actual: raw, expected: allowed.join(' | ') });
    return false;
  }
  if (coerced.autoFixed) note_ACU(notes, 'autoFixed', `${path}.${key}`, `${path}.${key} 已按 trim/大小写归一`);
  target[key] = coerced.value;
  return true;
}

function applyStringArray_ACU(target: Record<string, unknown>, key: string, raw: unknown, path: string, notes: WorldSimulationPatchNormalizationNote_ACU[]): boolean {
  if (raw === undefined) return true;
  const coerced = coerceWorldSimulationStringArray_ACU(raw);
  if (!coerced.ok) {
    note_ACU(notes, 'blocking', `${path}.${key}`, `${path}.${key} 必须是字符串数组`);
    return false;
  }
  if (coerced.autoFixed) note_ACU(notes, 'autoFixed', `${path}.${key}`, `${path}.${key} 已归一为字符串数组`);
  target[key] = coerced.value;
  return true;
}

function applyNullableInteger_ACU(target: Record<string, unknown>, key: string, raw: unknown, path: string, notes: WorldSimulationPatchNormalizationNote_ACU[], min: number): boolean {
  if (raw === undefined) return true;
  if (raw === null) {
    target[key] = null;
    return true;
  }
  if (raw === '') {
    note_ACU(notes, 'autoFixed', `${path}.${key}`, `${path}.${key} 空字符串已归一为 null`);
    target[key] = null;
    return true;
  }
  return applyInteger_ACU(target, key, raw, path, notes, min);
}

function applyNullableString_ACU(target: Record<string, unknown>, key: string, raw: unknown, path: string, notes: WorldSimulationPatchNormalizationNote_ACU[]): boolean {
  if (raw === undefined) return true;
  if (raw === null) {
    target[key] = null;
    return true;
  }
  if (typeof raw !== 'string') {
    note_ACU(notes, 'blocking', `${path}.${key}`, `${path}.${key} 必须是字符串或 null`);
    return false;
  }
  if (!raw.trim()) {
    note_ACU(notes, 'autoFixed', `${path}.${key}`, `${path}.${key} 空字符串已归一为 null`);
    target[key] = null;
    return true;
  }
  target[key] = raw;
  return true;
}

function applyLocation_ACU(target: Record<string, unknown>, key: string, raw: unknown, path: string, notes: WorldSimulationPatchNormalizationNote_ACU[]): boolean {
  if (raw === undefined) return true;
  if (raw === null) {
    target[key] = null;
    return true;
  }
  if (!isRecord_ACU(raw)) {
    note_ACU(notes, 'blocking', `${path}.${key}`, `${path}.${key} 必须是对象或 null`);
    return false;
  }
  const unknown = Object.keys(raw).filter(item => item !== 'region' && item !== 'place');
  if (unknown.length) note_ACU(notes, 'autoFixed', `${path}.${key}`, `${path}.${key} 已丢弃未知字段：${unknown.join(',')}`, { unknownFields: unknown });
  const region = takeText_ACU(raw.region, false);
  if (!region) {
    note_ACU(notes, 'blocking', `${path}.${key}.region`, `${path}.${key}.region 必须是非空字符串`);
    return false;
  }
  const location: WorldLocationRef_ACU = { region };
  if (raw.place !== undefined) {
    if (typeof raw.place !== 'string') {
      note_ACU(notes, 'blocking', `${path}.${key}.place`, `${path}.${key}.place 必须是字符串`);
      return false;
    }
    location.place = raw.place;
  }
  target[key] = location;
  return true;
}

function fillMissing_ACU(target: Record<string, unknown>, defaults: Record<string, unknown>, path: string, notes: WorldSimulationPatchNormalizationNote_ACU[]): void {
  for (const [key, value] of Object.entries(defaults)) {
    if (!Object.prototype.hasOwnProperty.call(target, key)) {
      target[key] = value;
      note_ACU(notes, 'autoFixed', `${path}.${key}`, `${path}.${key} 已按缺省补齐`);
    }
  }
}

function stripUnknown_ACU(target: Record<string, unknown>, allowed: readonly string[], path: string, notes: WorldSimulationPatchNormalizationNote_ACU[]): void {
  const unknown = Object.keys(target).filter(key => !allowed.includes(key));
  if (!unknown.length) return;
  for (const key of unknown) delete target[key];
  note_ACU(notes, 'autoFixed', path, `${path} 已丢弃未知字段：${unknown.join(',')}`, { unknownFields: unknown });
}

function resolveExpectedRevision_ACU(raw: unknown, actual: number, path: string, notes: WorldSimulationPatchNormalizationNote_ACU[]): number | null {
  if (raw === undefined) {
    note_ACU(notes, 'autoFixed', `${path}.expectedRevision`, `${path}.expectedRevision 已按${actual === 0 ? '新建 0' : '当前 revision'}补齐`);
    return actual;
  }
  const coerced = coerceWorldSimulationInteger_ACU(raw);
  if (!coerced.ok || coerced.value < 0) {
    note_ACU(notes, 'blocking', `${path}.expectedRevision`, `${path}.expectedRevision 非法`, { actual: raw });
    return null;
  }
  if (coerced.autoFixed) note_ACU(notes, 'autoFixed', `${path}.expectedRevision`, `${path}.expectedRevision 已从数字字符串归一为整数`);
  if (coerced.value !== actual) {
    note_ACU(notes, 'blocking', path, `${path} 条目 revision 冲突`, { expectedRevision: coerced.value, actualRevision: actual, revisionConflict: true });
    return null;
  }
  return coerced.value;
}

export const WORLD_SIMULATION_UPSERT_ID_PREFIX_ACU: Record<WorldSimulationUpsertModule_ACU, string> = {
  dimensions: 'dim',
  seeds: 'seed',
  actors: 'actor',
  rumors: 'rumor',
};

/** 按 prefix-n 分配未被 taken 占用的编号；n 从 1 起跳过碰撞。 */
export function allocateWorldSimulationPrefixedId_ACU(prefix: string, taken: Iterable<string>): string {
  const occupied = taken instanceof Set ? taken : new Set(taken);
  let serial = 1;
  let next = `${prefix}-${serial}`;
  while (occupied.has(next)) {
    serial += 1;
    next = `${prefix}-${serial}`;
  }
  return next;
}

function beginItem_ACU(
  item: Record<string, unknown>,
  existing: Record<string, unknown> | null,
  path: string,
  notes: WorldSimulationPatchNormalizationNote_ACU[],
  labelField: 'name' | 'title' | 'fact',
  allocateNewId?: () => string,
): Record<string, unknown> | null {
  let id = takeText_ACU(item.id, false);
  if (!id) {
    if (existing) {
      note_ACU(notes, 'blocking', `${path}.id`, `${path}.id 非法`);
      return null;
    }
    if (!allocateNewId) {
      note_ACU(notes, 'blocking', `${path}.id`, `${path}.id 非法`);
      return null;
    }
    id = allocateNewId();
    note_ACU(notes, 'autoFixed', `${path}.id`, `${path}.id 已按缺省编号补齐`);
  }
  if (!existing) {
    const label = takeText_ACU(item[labelField], false);
    if (!label) {
      note_ACU(notes, 'blocking', `${path}.${labelField}`, `${path}.${labelField} 必须是非空字符串`);
      return null;
    }
    return { id, [labelField]: label };
  }
  const next = { ...existing, id };
  if (item[labelField] !== undefined && !applyString_ACU(next, labelField, item[labelField], path, notes, false)) return null;
  return next;
}

function finishItem_ACU(next: Record<string, unknown>, allowed: readonly string[], actual: number, path: string, notes: WorldSimulationPatchNormalizationNote_ACU[]): Record<string, unknown> {
  stripUnknown_ACU(next, allowed, path, notes);
  next.revision = actual + 1;
  return next;
}

const DIMENSION_KIND_ACU = ['pressure', 'growth'] as const;
const DIMENSION_TREND_ACU = ['rising', 'stable', 'falling'] as const;
const SEED_STATUS_ACU = ['established', 'incubating', 'active', 'converging', 'resolved', 'retired'] as const;
const VISIBILITY_ACU = ['hidden', 'limited', 'public'] as const;

function normalizeDimension_ACU(
  item: Record<string, unknown>,
  existing: Record<string, unknown> | null,
  path: string,
  notes: WorldSimulationPatchNormalizationNote_ACU[],
  allocateNewId?: () => string,
): Record<string, unknown> | null {
  const next = beginItem_ACU(item, existing, path, notes, 'name', allocateNewId);
  if (!next) return null;
  if (!applyEnum_ACU(next, 'kind', item.kind, path, notes, DIMENSION_KIND_ACU)) return null;
  if (!applyInteger_ACU(next, 'value', item.value, path, notes, 0, 100)) return null;
  if (!applyEnum_ACU(next, 'trend', item.trend, path, notes, DIMENSION_TREND_ACU)) return null;
  if (!applyString_ACU(next, 'rationale', item.rationale, path, notes, true)) return null;
  if (!applyStringArray_ACU(next, 'evidenceRefs', item.evidenceRefs, path, notes)) return null;
  if (!existing) fillMissing_ACU(next, { kind: 'pressure', value: 0, trend: 'stable', rationale: '', evidenceRefs: [] }, path, notes);
  return finishItem_ACU(next, WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU.dimensions, existing ? Number(existing.revision) : 0, path, notes);
}

function normalizeSeed_ACU(
  item: Record<string, unknown>,
  existing: Record<string, unknown> | null,
  path: string,
  notes: WorldSimulationPatchNormalizationNote_ACU[],
  allocateNewId?: () => string,
): Record<string, unknown> | null {
  const next = beginItem_ACU(item, existing, path, notes, 'title', allocateNewId);
  if (!next) return null;
  if (!applyEnum_ACU(next, 'status', item.status, path, notes, SEED_STATUS_ACU)) return null;
  if (!applyInteger_ACU(next, 'level', item.level, path, notes, 0, 100)) return null;
  if (!applyString_ACU(next, 'catalyst', item.catalyst, path, notes, true)) return null;
  if (!applyEnum_ACU(next, 'visibility', item.visibility, path, notes, VISIBILITY_ACU)) return null;
  if (!applyStringArray_ACU(next, 'actorIds', item.actorIds, path, notes)) return null;
  if (!applyLocation_ACU(next, 'location', item.location, path, notes)) return null;
  if (!applyNullableInteger_ACU(next, 'expiresAtDay', item.expiresAtDay, path, notes, 1)) return null;
  if (!applyNullableString_ACU(next, 'missedOutcome', item.missedOutcome, path, notes)) return null;
  if (!applyEnum_ACU(next, 'exposePolicy', item.exposePolicy, path, notes, WORLD_SEED_EXPOSE_POLICIES_ACU)) return null;
  if (!applyStringArray_ACU(next, 'evidenceRefs', item.evidenceRefs, path, notes)) return null;
  if (!applyNullableString_ACU(next, 'retiredReason', item.retiredReason, path, notes)) return null;
  if (!existing) fillMissing_ACU(next, { status: 'established', level: 0, catalyst: '', visibility: 'hidden', actorIds: [], location: null, expiresAtDay: null, missedOutcome: null, exposePolicy: 'on_collision', evidenceRefs: [], retiredReason: null }, path, notes);
  if (next.status !== 'retired' && next.retiredReason === '') {
    next.retiredReason = null;
    note_ACU(notes, 'autoFixed', `${path}.retiredReason`, `${path}.retiredReason 非退役空字符串已归一为 null`);
  }
  if (next.status === 'retired' && (next.retiredReason === null || next.retiredReason === '')) {
    note_ACU(notes, 'blocking', `${path}.retiredReason`, `${path} 退役时必须提供原因`);
    return null;
  }
  if (next.status !== 'retired' && next.retiredReason !== null) {
    note_ACU(notes, 'blocking', path, `${path} 非退役状态不能携带退役原因`);
    return null;
  }
  return finishItem_ACU(next, WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU.seeds, existing ? Number(existing.revision) : 0, path, notes);
}

function normalizeActor_ACU(
  item: Record<string, unknown>,
  existing: Record<string, unknown> | null,
  path: string,
  notes: WorldSimulationPatchNormalizationNote_ACU[],
  allocateNewId?: () => string,
): Record<string, unknown> | null {
  const next = beginItem_ACU(item, existing, path, notes, 'name', allocateNewId);
  if (!next) return null;
  if (!applyStringArray_ACU(next, 'interests', item.interests, path, notes)) return null;
  if (!applyString_ACU(next, 'location', item.location, path, notes, true)) return null;
  if (!applyLocation_ACU(next, 'locationRef', item.locationRef, path, notes)) return null;
  if (!applyEnum_ACU(next, 'life', item.life, path, notes, WORLD_ACTOR_LIFE_ACU)) return null;
  if (!applyNullableInteger_ACU(next, 'diedAtDay', item.diedAtDay, path, notes, 1)) return null;
  if (!applyNullableString_ACU(next, 'deathSummary', item.deathSummary, path, notes)) return null;
  if (!applyStringArray_ACU(next, 'resources', item.resources, path, notes)) return null;
  if (!applyStringArray_ACU(next, 'goals', item.goals, path, notes)) return null;
  if (!applyStringArray_ACU(next, 'constraints', item.constraints, path, notes)) return null;
  if (!applyStringArray_ACU(next, 'informationSources', item.informationSources, path, notes)) return null;
  if (!applyStringArray_ACU(next, 'knownFacts', item.knownFacts, path, notes)) return null;
  if (!applyEnum_ACU(next, 'visibility', item.visibility, path, notes, VISIBILITY_ACU)) return null;
  if (!existing) fillMissing_ACU(next, { interests: [], location: '', locationRef: null, life: 'alive', diedAtDay: null, deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [], knownFacts: [], visibility: 'hidden' }, path, notes);
  if (next.life === 'dead') {
    if (next.diedAtDay === null || !next.deathSummary) {
      note_ACU(notes, 'blocking', path, `${path} dead 状态必须提供 diedAtDay 与 deathSummary`);
      return null;
    }
  } else if (next.diedAtDay !== null || next.deathSummary !== null) {
    note_ACU(notes, 'blocking', path, `${path} 非 dead 状态不能携带死亡字段`);
    return null;
  }
  return finishItem_ACU(next, WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU.actors, existing ? Number(existing.revision) : 0, path, notes);
}

function normalizeRumor_ACU(
  item: Record<string, unknown>,
  existing: Record<string, unknown> | null,
  path: string,
  notes: WorldSimulationPatchNormalizationNote_ACU[],
  clockDay: number,
  allocateNewId?: () => string,
): Record<string, unknown> | null {
  const next = beginItem_ACU(item, existing, path, notes, 'fact', allocateNewId);
  if (!next) return null;
  if (!applyInteger_ACU(next, 'originDay', item.originDay, path, notes, 1)) return null;
  if (!applyInteger_ACU(next, 'earliestRevealDay', item.earliestRevealDay, path, notes, 1)) return null;
  if (!applyStringArray_ACU(next, 'channels', item.channels, path, notes)) return null;
  if (!applyStringArray_ACU(next, 'relatedActorIds', item.relatedActorIds, path, notes)) return null;
  if (!applyEnum_ACU(next, 'status', item.status, path, notes, WORLD_RUMOR_STATUSES_ACU)) return null;
  if (!applyNullableInteger_ACU(next, 'revealedAtDay', item.revealedAtDay, path, notes, 1)) return null;
  if (!existing) {
    const originDay = typeof next.originDay === 'number' ? next.originDay : clockDay;
    fillMissing_ACU(next, { originDay, earliestRevealDay: originDay, channels: [], relatedActorIds: [], status: 'latent', revealedAtDay: null }, path, notes);
  }
  if (typeof next.earliestRevealDay === 'number' && typeof next.originDay === 'number' && next.earliestRevealDay < next.originDay) {
    note_ACU(notes, 'blocking', path, `${path} earliestRevealDay 必须 >= originDay`, { originDay: next.originDay, earliestRevealDay: next.earliestRevealDay });
    return null;
  }
  if (next.status === 'revealed' && next.revealedAtDay === null) {
    note_ACU(notes, 'blocking', `${path}.revealedAtDay`, `${path} revealed 状态必须提供 revealedAtDay`);
    return null;
  }
  if (next.status !== 'revealed' && next.revealedAtDay !== null) {
    note_ACU(notes, 'blocking', `${path}.revealedAtDay`, `${path} 非 revealed 状态不能携带 revealedAtDay`);
    return null;
  }
  return finishItem_ACU(next, WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU.rumors, existing ? Number(existing.revision) : 0, path, notes);
}

export function normalizeWorldSimulationUpsertItem_ACU(input: {
  module: WorldSimulationUpsertModule_ACU;
  item: unknown;
  existing: Record<string, unknown> | null;
  path: string;
  clockDay: number;
  allocateNewId?: () => string;
}): WorldSimulationNormalizeUpsertResult_ACU {
  const notes: WorldSimulationPatchNormalizationNote_ACU[] = [];
  if (!isRecord_ACU(input.item)) {
    note_ACU(notes, 'blocking', `${input.path}`, `${input.path} 必须是对象`);
    return { item: null, notes };
  }
  const actual = input.existing && typeof input.existing.revision === 'number' ? input.existing.revision : 0;
  if (resolveExpectedRevision_ACU(input.item.expectedRevision, actual, input.path, notes) === null) {
    return { item: null, notes };
  }
  const item = input.module === 'dimensions' ? normalizeDimension_ACU(input.item, input.existing, input.path, notes, input.allocateNewId)
    : input.module === 'seeds' ? normalizeSeed_ACU(input.item, input.existing, input.path, notes, input.allocateNewId)
      : input.module === 'actors' ? normalizeActor_ACU(input.item, input.existing, input.path, notes, input.allocateNewId)
        : normalizeRumor_ACU(input.item, input.existing, input.path, notes, input.clockDay, input.allocateNewId);
  return { item, notes };
}

export function coerceWorldSimulationContact_ACU(value: unknown): { ok: true; value: typeof WORLD_PLAYER_CONTACTS_ACU[number]; autoFixed: boolean } | { ok: false } {
  return coerceWorldSimulationEnum_ACU(value, WORLD_PLAYER_CONTACTS_ACU);
}

export function coerceWorldSimulationGuidanceVoice_ACU(value: unknown): { ok: true; value: typeof WORLD_GUIDANCE_SIGNAL_VOICES_ACU[number]; autoFixed: boolean } | { ok: false } {
  return coerceWorldSimulationEnum_ACU(value, WORLD_GUIDANCE_SIGNAL_VOICES_ACU);
}
