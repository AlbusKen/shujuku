import type { WorldSimulationCandidate_ACU } from './agent/agent-model';
import { findWorldSimulationAgentDefinition_ACU } from './agent/agent-catalog';
import { buildDefaultWorldSimulationSettings_ACU } from './defaults';
import { WorldSimulationValidationError_ACU, createWorldSimulationError_ACU, type WorldGuidanceSignal_ACU, type WorldSimulationLedger_ACU, type WorldSimulationSettings_ACU } from './model';
import {
  coerceWorldSimulationContact_ACU,
  coerceWorldSimulationGuidanceVoice_ACU,
  coerceWorldSimulationInteger_ACU,
  coerceWorldSimulationStringArray_ACU,
  normalizeWorldSimulationUpsertItem_ACU,
  type WorldSimulationPatchFixSeverity_ACU,
  type WorldSimulationUpsertModule_ACU,
} from './simulation-patch-normalize';
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
    const existingIndex = isRecord_ACU(item) && typeof item.id === 'string' ? result.findIndex(entry => entry.id === item.id) : -1;
    const existing = existingIndex < 0 ? null : result[existingIndex] as unknown as Record_ACU;
    const normalized = normalizeWorldSimulationUpsertItem_ACU({ module, item, existing, path: itemPath, clockDay });
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

function applyChronicle_ACU(current: WorldSimulationLedger_ACU['chronicle'], raw: unknown): WorldSimulationLedger_ACU['chronicle'] {
  if (!isRecord_ACU(raw)) fail_ACU('patch.chronicle 必须是对象');
  exactKeys_ACU(raw, ['append'], 'patch.chronicle');
  if (!Array.isArray(raw.append) || raw.append.length === 0) fail_ACU('patch.chronicle.append 必须是非空数组');
  return [...clone_ACU(current), ...clone_ACU(raw.append as WorldSimulationLedger_ACU['chronicle'])];
}

export function applyWorldSimulationCandidates_ACU(
  base: WorldSimulationLedger_ACU,
  candidates: readonly WorldSimulationCandidate_ACU[],
  authorizedEvidenceRefs: ReadonlySet<string>,
  settings?: WorldSimulationSettings_ACU,
): WorldSimulationLedger_ACU {
  const dynamics = resolveDynamics_ACU(settings);
  const validatedBase = validateWorldSimulationLedger_ACU(base, 'agent_persist');
  if (!candidates.length) fail_ACU('commit 必须包含至少一个候选');
  const candidateIds = new Set<string>();
  let next = clone_ACU(validatedBase);
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
    for (const [module, patch] of Object.entries(candidate.patch)) {
      if (!(MODULES_ACU as readonly string[]).includes(module) || !writable.has(module)) fail_ACU('候选越权写入 ledger 模块', { candidateId: candidate.candidateId, module });
      switch (module as Module_ACU) {
        case 'clock': next.clock = applyClock_ACU(next.clock, patch, dynamics); break;
        case 'dimensions': next.dimensions = applyUpserts_ACU(next.dimensions, patch, 'patch.dimensions', 'dimensions', next.clock.day); break;
        case 'seeds': next.seeds = applyUpserts_ACU(next.seeds, patch, 'patch.seeds', 'seeds', next.clock.day); break;
        case 'actors': next.actors = applyUpserts_ACU(next.actors, patch, 'patch.actors', 'actors', next.clock.day); break;
        case 'chronicle': next.chronicle = applyChronicle_ACU(next.chronicle, patch); break;
        case 'guidance': next.guidance = applyGuidance_ACU(next.guidance, patch); break;
        case 'rumors': next.rumors = applyUpserts_ACU(next.rumors, patch, 'patch.rumors', 'rumors', next.clock.day); break;
        case 'player': next.player = applyPlayer_ACU(next.player, patch); break;
      }
    }
  }
  checkCrossField_ACU(next);
  next.revision = validatedBase.revision + 1;
  return validateWorldSimulationLedger_ACU(next, 'agent_persist');
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
    for (const [module, patch] of Object.entries(candidate.patch)) {
      if (!(MODULES_ACU as readonly string[]).includes(module) || !writable.has(module)) {
        push(module, `$.patch.${module}`, '候选越权写入 ledger 模块');
        continue;
      }
      const collectUpsert = (message: string, details?: Record_ACU): void => {
        push(module, typeof details?.path === 'string' ? details.path : `$.patch.${module}`, message, details);
      };
      try {
        switch (module as Module_ACU) {
          case 'clock': next.clock = applyClock_ACU(next.clock, patch, dynamics); break;
          case 'dimensions': next.dimensions = applyUpserts_ACU(next.dimensions, patch, 'patch.dimensions', 'dimensions', next.clock.day, collectUpsert); break;
          case 'seeds': next.seeds = applyUpserts_ACU(next.seeds, patch, 'patch.seeds', 'seeds', next.clock.day, collectUpsert); break;
          case 'actors': next.actors = applyUpserts_ACU(next.actors, patch, 'patch.actors', 'actors', next.clock.day, collectUpsert); break;
          case 'chronicle': next.chronicle = applyChronicle_ACU(next.chronicle, patch); break;
          case 'guidance': next.guidance = applyGuidance_ACU(next.guidance, patch); break;
          case 'rumors': next.rumors = applyUpserts_ACU(next.rumors, patch, 'patch.rumors', 'rumors', next.clock.day, collectUpsert); break;
          case 'player': next.player = applyPlayer_ACU(next.player, patch); break;
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
