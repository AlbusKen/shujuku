import { getChatArray_ACU, saveChatToHostStrict_ACU } from '../../data/gateways/chat-gateway';
import { getActiveChatStorageIdentity_ACU } from '../../data/storage/chat-history';
import { sha256HexSync_ACU } from '../../shared/sha256-sync';
import { buildDefaultWorldSimulationAgentPrompts_ACU, migrateWorldSimulationAgentPrompts_ACU } from './agent/agent-defaults';
import { buildDefaultWorldSimulationSettings_ACU } from './defaults';
import type { WorldChronicleArchiveDetail_ACU, WorldChronicleArchiveSnapshot_ACU, WorldSimulationAnchorIdentity_ACU, WorldSimulationBucket_ACU } from './agent/agent-model';
import { WORLD_SIMULATION_CHRONICLE_ARCHIVE_SCHEMA_VERSION_ACU } from './agent/agent-model';
import { validateWorldSimulationAgentPrompts_ACU } from './agent/prompt-template';
import {
  WORLD_CHRONICLE_OVERVIEW_CAP_ACU,
  WORLD_CHRONICLE_HOT_WINDOW_ACU,
  WORLD_LEDGER_SCHEMA_VERSION_ACU,
  WORLD_SIMULATION_SCHEMA_VERSION_ACU,
  WORLD_SIMULATION_LEDGER_MODULES_ACU,
  WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU,
  WORLD_SIMULATION_PLAYER_REQUIRED_FIELDS_ACU,
  WORLD_GUIDANCE_SIGNAL_VOICES_ACU,
  WORLD_SEED_EXPOSE_POLICIES_ACU,
  WORLD_ACTOR_LIFE_ACU,
  WORLD_RUMOR_STATUSES_ACU,
  WORLD_PLAYER_CONTACTS_ACU,
  WORLD_PLAYER_REGION_VISITS_CAP_ACU,
  WorldSimulationValidationError_ACU,
  createWorldSimulationError_ACU,
  normalizeWorldRegionName_ACU,
  type WorldSimulationEnvelope_ACU,
  type WorldSimulationErrorPhase_ACU,
  type WorldSimulationLedger_ACU,
  type WorldSimulationPendingFix_ACU,
  type WorldSimulationWriteGuard_ACU,
  type WorldChronicleOverviewRow_ACU,
  type WorldGuidanceSignal_ACU,
  type WorldLocationRef_ACU,
  type WorldPlayer_ACU,
  type WorldRumor_ACU,
  WORLD_SIMULATION_WEB_PROVIDERS_ACU,
} from './model';

export const WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU = '_qrf_world_simulation';

const TASK_STATUSES_ACU = ['drafting', 'paused', 'running', 'stopping_after_inflight', 'completed', 'abandoned', 'failed'] as const;
const STAGE_STATUSES_ACU = ['planning', 'running', 'completed', 'abandoned', 'failed'] as const;
const REVISION_REASONS_ACU = ['initial', 'automatic_replan', 'manual_replan', 'resume_repair'] as const;
const TIMELINE_KINDS_ACU = ['task_created', 'plan_ready', 'stage_started', 'stage_completed', 'paused', 'resumed', 'stopped', 'committed', 'no_change', 'blocked', 'failed', 'swept', 'progressed'] as const;
const LEDGER_EXACT_KEYS_ACU = ['schemaVersion', 'revision', 'clock', 'dimensions', 'seeds', 'actors', 'chronicle', 'rumors', 'player', 'guidance', 'chronicleOverview', 'pendingFixes'] as const;
// 计划确认流程退役后的旧数据归一化：读取历史存量聊天时不再 fail-closed。
const LEGACY_TASK_STATUSES_ACU: Record<string, NonNullable<WorldSimulationEnvelope_ACU['task']>['status']> = { awaiting_plan_review: 'paused' };
const LEGACY_STAGE_STATUSES_ACU: Record<string, WorldSimulationEnvelope_ACU['stages'][number]['status']> = { awaiting_review: 'planning' };
const LEGACY_TIMELINE_KINDS_ACU: Record<string, WorldSimulationEnvelope_ACU['timeline'][number]['kind']> = { plan_confirmed: 'stage_started', stage_replanned: 'stage_completed' };
const normalizeLegacyEnum_ACU = <T extends string>(allowed: readonly T[], legacy: Record<string, T>, value: unknown, path: string, phase: WorldSimulationErrorPhase_ACU): T => {
  const mapped = typeof value === 'string' ? legacy[value] : undefined;
  return mapped ?? enum_ACU(value, allowed, path, phase);
};
const ERROR_CODES_ACU = ['WORLD_SIMULATION_ENVELOPE_INVALID', 'WORLD_SIMULATION_CHAT_UNAVAILABLE', 'WORLD_SIMULATION_CHAT_CHANGED', 'WORLD_SIMULATION_ANCHOR_INVALID', 'WORLD_SIMULATION_ANCHOR_STALE', 'WORLD_SIMULATION_REVISION_CONFLICT', 'WORLD_SIMULATION_PERSIST_FAILED', 'WORLD_SIMULATION_SNAPSHOT_INVALID', 'WORLD_SIMULATION_EVIDENCE_UNAUTHORIZED', 'WORLD_SIMULATION_AGENT_PROTOCOL_INVALID', 'WORLD_SIMULATION_API_PRESET_MISSING', 'WORLD_SIMULATION_CONFIG_INVALID'] as const;
const ERROR_PHASES_ACU = ['load', 'persist', 'anchor', 'agent_persist', 'agent_loop', 'agent_delegate', 'handoff_summary'] as const;

export const WORLD_SIMULATION_STATE_FIELD_ACU = '_qrf_world_simulation_state';

function isRecord_ACU(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function fail_ACU(message: string, phase: WorldSimulationErrorPhase_ACU, details?: Record<string, unknown>): never { throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU('WORLD_SIMULATION_ENVELOPE_INVALID', phase, message, false, details)); }
function exactKeys_ACU(raw: Record<string, unknown>, required: readonly string[], optional: readonly string[], path: string, phase: WorldSimulationErrorPhase_ACU): void {
  const allowed = new Set([...required, ...optional]);
  const missing = required.filter(key => !Object.prototype.hasOwnProperty.call(raw, key));
  if (missing.length) fail_ACU(`${path} 缺少必填字段：${missing.join(',')}`, phase, { path, missingFields: missing });
  const unknown = Object.keys(raw).filter(key => !allowed.has(key));
  if (unknown.length) fail_ACU(`${path} 存在未知持久化字段：${unknown.join(',')}`, phase, { path, unknownFields: unknown });
}
function string_ACU(value: unknown, path: string, phase: WorldSimulationErrorPhase_ACU, allowEmpty = false): string { if (typeof value !== 'string' || (!allowEmpty && !value.trim())) fail_ACU(`${path} 必须是${allowEmpty ? '' : '非空'}字符串`, phase, { path }); return value; }
function integer_ACU(value: unknown, path: string, phase: WorldSimulationErrorPhase_ACU, min = 0, max = Number.MAX_SAFE_INTEGER): number { if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) fail_ACU(`${path} 必须是 ${min}..${max} 的整数`, phase, { path, actual: value }); return value; }
function boolean_ACU(value: unknown, path: string, phase: WorldSimulationErrorPhase_ACU): boolean { if (typeof value !== 'boolean') fail_ACU(`${path} 必须是布尔值`, phase, { path }); return value; }
function enum_ACU<T extends string>(value: unknown, allowed: readonly T[], path: string, phase: WorldSimulationErrorPhase_ACU): T { if (typeof value !== 'string' || !allowed.includes(value as T)) fail_ACU(`${path} 枚举非法`, phase, { path, actual: value }); return value as T; }

function reject_ACU(code: Parameters<typeof createWorldSimulationError_ACU>[0], phase: WorldSimulationErrorPhase_ACU, message: string, details?: Record<string, unknown>): never {
  throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(code, phase, message, false, details));
}

function stringArray_ACU(value: unknown, path: string, phase: WorldSimulationErrorPhase_ACU): string[] {
  if (!Array.isArray(value)) fail_ACU(`${path} 必须是字符串数组`, phase, { path });
  return value.map((item, index) => string_ACU(item, `${path}[${index}]`, phase));
}

function stableId_ACU(value: unknown, path: string, phase: WorldSimulationErrorPhase_ACU): string {
  const id = string_ACU(value, path, phase);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) fail_ACU(`${path} 不是合法稳定 ID`, phase, { path, actual: id });
  return id;
}

function uniqueIds_ACU(items: readonly { id: string }[], path: string, phase: WorldSimulationErrorPhase_ACU): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) fail_ACU(`${path} 存在重复 ID`, phase, { path, id: item.id });
    seen.add(item.id);
  }
}

function nullableString_ACU(value: unknown, path: string, phase: WorldSimulationErrorPhase_ACU): string | null {
  if (value === null) return null;
  return string_ACU(value, path, phase);
}

function nullableInteger_ACU(value: unknown, path: string, phase: WorldSimulationErrorPhase_ACU, min = 0): number | null {
  if (value === null) return null;
  return integer_ACU(value, path, phase, min);
}

function parseClockDay_ACU(elapsed: unknown, storyTime: unknown): number {
  for (const source of [elapsed, storyTime]) {
    if (typeof source !== 'string') continue;
    const match = source.match(/\d+/);
    if (!match) continue;
    const day = Number(match[0]);
    if (Number.isInteger(day) && day >= 1) return day;
  }
  return 1;
}

function validateLocationRef_ACU(value: unknown, path: string, phase: WorldSimulationErrorPhase_ACU): WorldLocationRef_ACU | null {
  if (value === null) return null;
  if (!isRecord_ACU(value)) fail_ACU(`${path} 必须是对象或 null`, phase, { path });
  exactKeys_ACU(value, ['region'], ['place'], path, phase);
  const region = normalizeWorldRegionName_ACU(string_ACU(value.region, `${path}.region`, phase));
  if (!region) fail_ACU(`${path}.region 必须是非空字符串`, phase, { path });
  return value.place === undefined ? { region } : { region, place: string_ACU(value.place, `${path}.place`, phase, true) };
}

function validateGuidanceSignals_ACU(value: unknown, path: string, phase: WorldSimulationErrorPhase_ACU): WorldGuidanceSignal_ACU[] {
  if (!Array.isArray(value)) fail_ACU(`${path} 必须是数组`, phase, { path });
  return value.map((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord_ACU(item)) fail_ACU(`${itemPath} 必须是对象`, phase, { path: itemPath });
    exactKeys_ACU(item, ['text', 'voice'], ['sourceId'], itemPath, phase);
    const signal: WorldGuidanceSignal_ACU = {
      text: string_ACU(item.text, `${itemPath}.text`, phase),
      voice: enum_ACU(item.voice, WORLD_GUIDANCE_SIGNAL_VOICES_ACU, `${itemPath}.voice`, phase),
    };
    if (item.sourceId !== undefined) signal.sourceId = string_ACU(item.sourceId, `${itemPath}.sourceId`, phase);
    return signal;
  });
}

function migrateV1Ledger_ACU(raw: Record<string, unknown>): Record<string, unknown> {
  const clockRaw = isRecord_ACU(raw.clock) ? raw.clock : {};
  const day = Number.isInteger(clockRaw.day) && (clockRaw.day as number) >= 1
    ? clockRaw.day as number
    : parseClockDay_ACU(clockRaw.elapsed, clockRaw.storyTime);
  const fill = (item: unknown, extras: Record<string, unknown>): unknown => isRecord_ACU(item) ? { ...item, ...Object.fromEntries(Object.entries(extras).filter(([key]) => !Object.prototype.hasOwnProperty.call(item, key))) } : item;
  const guidanceRaw = isRecord_ACU(raw.guidance) ? raw.guidance : {};
  const signals = Array.isArray(guidanceRaw.signals)
    ? guidanceRaw.signals.map(item => typeof item === 'string' ? { text: item, voice: 'ambient' } : item)
    : guidanceRaw.signals;
  return {
    ...raw,
    schemaVersion: 2,
    clock: {
      day,
      slot: typeof clockRaw.slot === 'string' ? clockRaw.slot : '',
      storyTime: typeof clockRaw.storyTime === 'string' ? clockRaw.storyTime : '',
      precision: clockRaw.precision,
      evidenceRefs: clockRaw.evidenceRefs,
    },
    seeds: Array.isArray(raw.seeds) ? raw.seeds.map(item => fill(item, { location: null, expiresAtDay: null, missedOutcome: null, exposePolicy: 'on_collision' })) : raw.seeds,
    actors: Array.isArray(raw.actors) ? raw.actors.map(item => fill(item, { locationRef: null, life: 'alive', diedAtDay: null, deathSummary: null })) : raw.actors,
    rumors: Array.isArray(raw.rumors) ? raw.rumors : [],
    player: isRecord_ACU(raw.player) ? raw.player : { location: null, locationUpdatedAtDay: day, regionVisits: [], contact: 'open', evidenceRefs: [] },
    guidance: { ...guidanceRaw, signals },
  };
}

function migrateV2Ledger_ACU(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    ...raw,
    schemaVersion: 3,
    chronicleOverview: Array.isArray(raw.chronicleOverview) ? raw.chronicleOverview : [],
  };
}

function migrateV3Ledger_ACU(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    ...raw,
    schemaVersion: WORLD_LEDGER_SCHEMA_VERSION_ACU,
    pendingFixes: Array.isArray(raw.pendingFixes) ? raw.pendingFixes : [],
  };
}

function migrateLedgerToCurrent_ACU(raw: Record<string, unknown>): Record<string, unknown> {
  let current = raw;
  if (current.schemaVersion === 1) current = migrateV1Ledger_ACU(current);
  if (current.schemaVersion === 2) current = migrateV2Ledger_ACU(current);
  if (current.schemaVersion === 3) current = migrateV3Ledger_ACU(current);
  return current;
}

function validateChronicleOverview_ACU(raw: unknown, phase: WorldSimulationErrorPhase_ACU): WorldChronicleOverviewRow_ACU[] {
  if (!Array.isArray(raw) || raw.length > WORLD_CHRONICLE_OVERVIEW_CAP_ACU) fail_ACU('ledger.chronicleOverview 容量非法', phase);
  const rows = raw.map((item, index) => {
    if (!isRecord_ACU(item)) fail_ACU(`ledger.chronicleOverview[${index}] 必须是对象`, phase);
    exactKeys_ACU(item, ['fingerprint', 'day', 'oneLine', 'archiveRef'], [], `ledger.chronicleOverview[${index}]`, phase);
    return {
      fingerprint: string_ACU(item.fingerprint, `ledger.chronicleOverview[${index}].fingerprint`, phase),
      day: integer_ACU(item.day, `ledger.chronicleOverview[${index}].day`, phase, 1),
      oneLine: string_ACU(item.oneLine, `ledger.chronicleOverview[${index}].oneLine`, phase),
      archiveRef: stableId_ACU(item.archiveRef, `ledger.chronicleOverview[${index}].archiveRef`, phase),
    };
  });
  const seenRefs = new Set<string>();
  for (const row of rows) {
    if (seenRefs.has(row.archiveRef)) fail_ACU('ledger.chronicleOverview 存在重复 archiveRef', phase, { archiveRef: row.archiveRef });
    seenRefs.add(row.archiveRef);
  }
  return rows;
}

function validatePendingFixes_ACU(raw: unknown, phase: WorldSimulationErrorPhase_ACU): WorldSimulationPendingFix_ACU[] {
  if (!Array.isArray(raw)) fail_ACU('ledger.pendingFixes 必须是数组', phase, { path: 'ledger.pendingFixes' });
  if (raw.length > 128) fail_ACU('ledger.pendingFixes 容量非法', phase);
  return raw.map((item, index) => {
    const path = `ledger.pendingFixes[${index}]`;
    if (!isRecord_ACU(item)) fail_ACU(`${path} 必须是对象`, phase);
    exactKeys_ACU(item, ['module', 'candidateId', 'agentName', 'violations', 'attempts', 'firstFailedAtDay', 'lastError'], [], path, phase);
    if (!Array.isArray(item.violations)) fail_ACU(`${path}.violations 必须是数组`, phase);
    const violations = item.violations.map((violation, violationIndex) => {
      const violationPath = `${path}.violations[${violationIndex}]`;
      if (!isRecord_ACU(violation)) fail_ACU(`${violationPath} 必须是对象`, phase);
      exactKeys_ACU(violation, ['path', 'message'], [], violationPath, phase);
      return {
        path: string_ACU(violation.path, `${violationPath}.path`, phase),
        message: string_ACU(violation.message, `${violationPath}.message`, phase),
      };
    });
    return {
      module: enum_ACU(item.module, WORLD_SIMULATION_LEDGER_MODULES_ACU, `${path}.module`, phase),
      candidateId: string_ACU(item.candidateId, `${path}.candidateId`, phase, true),
      agentName: string_ACU(item.agentName, `${path}.agentName`, phase),
      violations,
      attempts: integer_ACU(item.attempts, `${path}.attempts`, phase, 0, 100),
      firstFailedAtDay: integer_ACU(item.firstFailedAtDay, `${path}.firstFailedAtDay`, phase, 1),
      lastError: string_ACU(item.lastError, `${path}.lastError`, phase, true),
    };
  });
}

function validatePlayer_ACU(raw: unknown, phase: WorldSimulationErrorPhase_ACU): WorldPlayer_ACU {
  if (!isRecord_ACU(raw)) fail_ACU('ledger.player 必须是对象', phase, { path: 'ledger.player' });
  exactKeys_ACU(raw, [...WORLD_SIMULATION_PLAYER_REQUIRED_FIELDS_ACU], [], 'ledger.player', phase);
  if (!Array.isArray(raw.regionVisits) || raw.regionVisits.length > WORLD_PLAYER_REGION_VISITS_CAP_ACU) fail_ACU('ledger.player.regionVisits 容量非法', phase);
  const regionVisits = raw.regionVisits.map((item, index) => {
    if (!isRecord_ACU(item)) fail_ACU(`ledger.player.regionVisits[${index}] 必须是对象`, phase);
    exactKeys_ACU(item, ['region', 'day'], [], `ledger.player.regionVisits[${index}]`, phase);
    const region = normalizeWorldRegionName_ACU(string_ACU(item.region, `ledger.player.regionVisits[${index}].region`, phase));
    if (!region) fail_ACU(`ledger.player.regionVisits[${index}].region 必须是非空字符串`, phase);
    return { region, day: integer_ACU(item.day, `ledger.player.regionVisits[${index}].day`, phase, 1) };
  });
  return {
    location: validateLocationRef_ACU(raw.location, 'ledger.player.location', phase),
    locationUpdatedAtDay: integer_ACU(raw.locationUpdatedAtDay, 'ledger.player.locationUpdatedAtDay', phase),
    regionVisits,
    contact: enum_ACU(raw.contact, WORLD_PLAYER_CONTACTS_ACU, 'ledger.player.contact', phase),
    evidenceRefs: stringArray_ACU(raw.evidenceRefs, 'ledger.player.evidenceRefs', phase),
  };
}

function validateRumors_ACU(raw: unknown, actorIds: ReadonlySet<string>, phase: WorldSimulationErrorPhase_ACU): WorldRumor_ACU[] {
  if (!Array.isArray(raw) || raw.length > 128) fail_ACU('ledger.rumors 容量非法', phase);
  const rumors = raw.map((item, index) => {
    if (!isRecord_ACU(item)) fail_ACU(`ledger.rumors[${index}] 必须是对象`, phase);
    exactKeys_ACU(item, WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU.rumors, [], `ledger.rumors[${index}]`, phase);
    const originDay = integer_ACU(item.originDay, `ledger.rumors[${index}].originDay`, phase, 1);
    const earliestRevealDay = integer_ACU(item.earliestRevealDay, `ledger.rumors[${index}].earliestRevealDay`, phase, 1);
    if (earliestRevealDay < originDay) fail_ACU(`ledger.rumors[${index}].earliestRevealDay 不能早于 originDay`, phase);
    const status = enum_ACU(item.status, WORLD_RUMOR_STATUSES_ACU, `ledger.rumors[${index}].status`, phase);
    const revealedAtDay = nullableInteger_ACU(item.revealedAtDay, `ledger.rumors[${index}].revealedAtDay`, phase, 1);
    if (status === 'revealed' && revealedAtDay === null) fail_ACU(`ledger.rumors[${index}] revealed 状态必须提供 revealedAtDay`, phase);
    if (status !== 'revealed' && revealedAtDay !== null) fail_ACU(`ledger.rumors[${index}] 非 revealed 状态不能携带 revealedAtDay`, phase);
    const relatedActorIds = stringArray_ACU(item.relatedActorIds, `ledger.rumors[${index}].relatedActorIds`, phase);
    for (const actorId of relatedActorIds) if (!actorIds.has(actorId)) fail_ACU(`ledger.rumors[${index}] 引用了不存在的 actor`, phase, { actorId });
    const channels = stringArray_ACU(item.channels, `ledger.rumors[${index}].channels`, phase).map((channel, channelIndex) => {
      const region = normalizeWorldRegionName_ACU(channel);
      if (!region) fail_ACU(`ledger.rumors[${index}].channels[${channelIndex}] 必须是非空字符串`, phase);
      return region;
    });
    return {
      id: stableId_ACU(item.id, `ledger.rumors[${index}].id`, phase),
      fact: string_ACU(item.fact, `ledger.rumors[${index}].fact`, phase),
      originDay,
      earliestRevealDay,
      channels,
      relatedActorIds,
      status,
      revealedAtDay,
      revision: integer_ACU(item.revision, `ledger.rumors[${index}].revision`, phase),
    };
  });
  uniqueIds_ACU(rumors, 'ledger.rumors', phase);
  return rumors;
}

function validateSettings_ACU(raw: unknown, phase: WorldSimulationErrorPhase_ACU): WorldSimulationEnvelope_ACU['settings'] {
  if (!isRecord_ACU(raw)) fail_ACU('settings 必须是对象', phase, { path: 'settings' });
  exactKeys_ACU(raw, ['autoTriggerEnabled', 'agentHistoryTokenBudget', 'agentReadTokenBudget', 'agentReadFallbackTokens', 'agentRunBudget', 'apiPresetMode', 'fixedApiPresetName', 'agentApiPresets', 'agentPrompts'], ['webResearch', 'promptForceDefaultVersion', 'planPreview', 'dynamics', 'workflow'], 'settings', phase);
  if (!isRecord_ACU(raw.agentRunBudget)) fail_ACU('settings.agentRunBudget 必须是对象', phase);
  exactKeys_ACU(raw.agentRunBudget, ['maxIterations', 'maxDelegations', 'maxSameAgent', 'maxConcurrent', 'maxReads', 'maxExtraReads'], [], 'settings.agentRunBudget', phase);
  const budget = {
    maxIterations: integer_ACU(raw.agentRunBudget.maxIterations, 'settings.agentRunBudget.maxIterations', phase, 1, 100),
    maxDelegations: integer_ACU(raw.agentRunBudget.maxDelegations, 'settings.agentRunBudget.maxDelegations', phase, 0, 100),
    maxSameAgent: integer_ACU(raw.agentRunBudget.maxSameAgent, 'settings.agentRunBudget.maxSameAgent', phase, 0, 20),
    maxConcurrent: integer_ACU(raw.agentRunBudget.maxConcurrent, 'settings.agentRunBudget.maxConcurrent', phase, 1, 20),
    maxReads: integer_ACU(raw.agentRunBudget.maxReads, 'settings.agentRunBudget.maxReads', phase, 0, 200),
    maxExtraReads: integer_ACU(raw.agentRunBudget.maxExtraReads, 'settings.agentRunBudget.maxExtraReads', phase, 0, 20),
  };
  if (!isRecord_ACU(raw.agentApiPresets) || !isRecord_ACU(raw.agentPrompts)) fail_ACU('settings 的 Agent 配置必须是对象', phase);
  const agentApiPresets: WorldSimulationEnvelope_ACU['settings']['agentApiPresets'] = {};
  for (const [key, value] of Object.entries(raw.agentApiPresets)) {
    stableId_ACU(key, `settings.agentApiPresets.${key}`, phase);
    if (!isRecord_ACU(value)) fail_ACU(`settings.agentApiPresets.${key} 必须是对象`, phase);
    exactKeys_ACU(value, ['mode', 'presetName'], [], `settings.agentApiPresets.${key}`, phase);
    agentApiPresets[key] = { mode: enum_ACU(value.mode, ['current', 'fixed'] as const, `settings.agentApiPresets.${key}.mode`, phase), presetName: string_ACU(value.presetName, `settings.agentApiPresets.${key}.presetName`, phase, true) };
  }
  const validatedPrompts = Object.keys(raw.agentPrompts).length === 0
    ? buildDefaultWorldSimulationAgentPrompts_ACU()
    : validateWorldSimulationAgentPrompts_ACU(raw.agentPrompts, phase);
  const agentPrompts = migrateWorldSimulationAgentPrompts_ACU(validatedPrompts, {});
  const readBudget = typeof raw.agentReadTokenBudget === 'string'
    ? (/^(?:100|[1-9]?\d)%$/.test(raw.agentReadTokenBudget) ? raw.agentReadTokenBudget : fail_ACU('settings.agentReadTokenBudget 百分比非法', phase))
    : integer_ACU(raw.agentReadTokenBudget, 'settings.agentReadTokenBudget', phase, 1, 1000000);
  const webRaw = raw.webResearch === undefined ? buildDefaultWorldSimulationSettings_ACU().webResearch : raw.webResearch;
  if (!isRecord_ACU(webRaw) || !isRecord_ACU(webRaw.sources)) fail_ACU('settings.webResearch 必须是对象', phase);
  exactKeys_ACU(webRaw, ['enabled', 'sources', 'searchProvider', 'searxngBaseUrl', 'pageCharLimit', 'blockedDomains'], [], 'settings.webResearch', phase);
  exactKeys_ACU(webRaw.sources, ['moegirl', 'wikipediaZh', 'wikipediaEn'], [], 'settings.webResearch.sources', phase);
  const webResearch = {
    enabled: boolean_ACU(webRaw.enabled, 'settings.webResearch.enabled', phase),
    sources: {
      moegirl: boolean_ACU(webRaw.sources.moegirl, 'settings.webResearch.sources.moegirl', phase),
      wikipediaZh: boolean_ACU(webRaw.sources.wikipediaZh, 'settings.webResearch.sources.wikipediaZh', phase),
      wikipediaEn: boolean_ACU(webRaw.sources.wikipediaEn, 'settings.webResearch.sources.wikipediaEn', phase),
    },
    searchProvider: enum_ACU(webRaw.searchProvider, WORLD_SIMULATION_WEB_PROVIDERS_ACU, 'settings.webResearch.searchProvider', phase),
    searxngBaseUrl: string_ACU(webRaw.searxngBaseUrl, 'settings.webResearch.searxngBaseUrl', phase, true),
    pageCharLimit: integer_ACU(webRaw.pageCharLimit, 'settings.webResearch.pageCharLimit', phase, 500, 20000),
    blockedDomains: string_ACU(webRaw.blockedDomains, 'settings.webResearch.blockedDomains', phase, true),
  };
  const defaultDynamics = buildDefaultWorldSimulationSettings_ACU().dynamics;
  let dynamics = defaultDynamics;
  if (raw.dynamics !== undefined) {
    if (!isRecord_ACU(raw.dynamics)) {
      dynamics = defaultDynamics;
    } else {
      const rumorTTLDays = Number.isInteger(raw.dynamics.rumorTTLDays) && (raw.dynamics.rumorTTLDays as number) >= 1 && (raw.dynamics.rumorTTLDays as number) <= 3650
        ? raw.dynamics.rumorTTLDays as number : defaultDynamics.rumorTTLDays;
      const maxClockAdvanceDays = Number.isInteger(raw.dynamics.maxClockAdvanceDays) && (raw.dynamics.maxClockAdvanceDays as number) >= 0 && (raw.dynamics.maxClockAdvanceDays as number) <= 3650
        ? raw.dynamics.maxClockAdvanceDays as number : defaultDynamics.maxClockAdvanceDays;
      const collisionEnforcement = raw.dynamics.collisionEnforcement === 'strict' || raw.dynamics.collisionEnforcement === 'relaxed'
        ? raw.dynamics.collisionEnforcement : defaultDynamics.collisionEnforcement;
      const missedSweepEnabled = typeof raw.dynamics.missedSweepEnabled === 'boolean' ? raw.dynamics.missedSweepEnabled : defaultDynamics.missedSweepEnabled;
      dynamics = { rumorTTLDays, maxClockAdvanceDays, collisionEnforcement, missedSweepEnabled };
    }
  }
  const defaultWorkflow = buildDefaultWorldSimulationSettings_ACU().workflow;
  let workflow = defaultWorkflow;
  if (raw.workflow !== undefined) {
    if (!isRecord_ACU(raw.workflow)) {
      workflow = defaultWorkflow;
    } else {
      const autoFixEnabled = typeof raw.workflow.autoFixEnabled === 'boolean' ? raw.workflow.autoFixEnabled : defaultWorkflow.autoFixEnabled;
      const chroniclerHotThreshold = Number.isInteger(raw.workflow.chroniclerHotThreshold)
        && (raw.workflow.chroniclerHotThreshold as number) >= 1
        && (raw.workflow.chroniclerHotThreshold as number) <= WORLD_CHRONICLE_OVERVIEW_CAP_ACU
        ? raw.workflow.chroniclerHotThreshold as number
        : defaultWorkflow.chroniclerHotThreshold;
      workflow = { autoFixEnabled, chroniclerHotThreshold };
    }
  }
  return {
    autoTriggerEnabled: boolean_ACU(raw.autoTriggerEnabled, 'settings.autoTriggerEnabled', phase),
    agentHistoryTokenBudget: integer_ACU(raw.agentHistoryTokenBudget, 'settings.agentHistoryTokenBudget', phase, 0, 1000000),
    agentReadTokenBudget: readBudget,
    agentReadFallbackTokens: integer_ACU(raw.agentReadFallbackTokens, 'settings.agentReadFallbackTokens', phase, 0, 100000),
    agentRunBudget: budget,
    webResearch,
    apiPresetMode: enum_ACU(raw.apiPresetMode, ['current', 'fixed'] as const, 'settings.apiPresetMode', phase),
    fixedApiPresetName: string_ACU(raw.fixedApiPresetName, 'settings.fixedApiPresetName', phase, true),
    agentApiPresets,
    agentPrompts,
    ...(Object.prototype.hasOwnProperty.call(raw, 'promptForceDefaultVersion') ? { promptForceDefaultVersion: string_ACU(raw.promptForceDefaultVersion, 'settings.promptForceDefaultVersion', phase) } : {}),
    dynamics,
    workflow,
  };
}

function validateLedger_ACU(raw: unknown, phase: WorldSimulationErrorPhase_ACU): WorldSimulationLedger_ACU {
  if (!isRecord_ACU(raw)) fail_ACU('ledger 必须是对象', phase);
  const normalized = migrateLedgerToCurrent_ACU(raw);
  exactKeys_ACU(normalized, LEDGER_EXACT_KEYS_ACU, [], 'ledger', phase);
  if (normalized.schemaVersion !== WORLD_LEDGER_SCHEMA_VERSION_ACU) fail_ACU(`ledger.schemaVersion 必须为 ${WORLD_LEDGER_SCHEMA_VERSION_ACU}`, phase);
  if (!isRecord_ACU(normalized.clock)) fail_ACU('ledger.clock 必须是对象', phase);
  exactKeys_ACU(normalized.clock, WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU.clock, [], 'ledger.clock', phase);
  const clock = {
    day: integer_ACU(normalized.clock.day, 'ledger.clock.day', phase, 1),
    slot: string_ACU(normalized.clock.slot, 'ledger.clock.slot', phase, true),
    storyTime: string_ACU(normalized.clock.storyTime, 'ledger.clock.storyTime', phase, true),
    precision: enum_ACU(normalized.clock.precision, ['exact', 'approximate', 'unknown'] as const, 'ledger.clock.precision', phase),
    evidenceRefs: stringArray_ACU(normalized.clock.evidenceRefs, 'ledger.clock.evidenceRefs', phase),
  };
  if (!Array.isArray(normalized.dimensions) || normalized.dimensions.length > 32) fail_ACU('ledger.dimensions 容量非法', phase);
  const dimensions = normalized.dimensions.map((item, index) => {
    if (!isRecord_ACU(item)) fail_ACU(`ledger.dimensions[${index}] 必须是对象`, phase);
    exactKeys_ACU(item, WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU.dimensions, [], `ledger.dimensions[${index}]`, phase);
    return { id: stableId_ACU(item.id, `ledger.dimensions[${index}].id`, phase), name: string_ACU(item.name, `ledger.dimensions[${index}].name`, phase), kind: enum_ACU(item.kind, ['pressure', 'growth'] as const, `ledger.dimensions[${index}].kind`, phase), value: integer_ACU(item.value, `ledger.dimensions[${index}].value`, phase, 0, 100), trend: enum_ACU(item.trend, ['rising', 'stable', 'falling'] as const, `ledger.dimensions[${index}].trend`, phase), rationale: string_ACU(item.rationale, `ledger.dimensions[${index}].rationale`, phase, true), evidenceRefs: stringArray_ACU(item.evidenceRefs, `ledger.dimensions[${index}].evidenceRefs`, phase), revision: integer_ACU(item.revision, `ledger.dimensions[${index}].revision`, phase) };
  });
  if (!Array.isArray(normalized.actors) || normalized.actors.length > 128) fail_ACU('ledger.actors 容量非法', phase);
  const actors = normalized.actors.map((item, index) => {
    if (!isRecord_ACU(item)) fail_ACU(`ledger.actors[${index}] 必须是对象`, phase);
    exactKeys_ACU(item, WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU.actors, [], `ledger.actors[${index}]`, phase);
    const life = enum_ACU(item.life, WORLD_ACTOR_LIFE_ACU, `ledger.actors[${index}].life`, phase);
    const diedAtDay = nullableInteger_ACU(item.diedAtDay, `ledger.actors[${index}].diedAtDay`, phase, 1);
    const deathSummary = nullableString_ACU(item.deathSummary, `ledger.actors[${index}].deathSummary`, phase);
    if (life === 'dead') {
      if (diedAtDay === null) fail_ACU(`ledger.actors[${index}] dead 状态必须提供 diedAtDay`, phase);
      if (!deathSummary) fail_ACU(`ledger.actors[${index}] dead 状态必须提供 deathSummary`, phase);
    } else if (diedAtDay !== null || deathSummary !== null) {
      fail_ACU(`ledger.actors[${index}] 非 dead 状态不能携带死亡字段`, phase);
    }
    return { id: stableId_ACU(item.id, `ledger.actors[${index}].id`, phase), name: string_ACU(item.name, `ledger.actors[${index}].name`, phase), interests: stringArray_ACU(item.interests, `ledger.actors[${index}].interests`, phase), location: string_ACU(item.location, `ledger.actors[${index}].location`, phase, true), locationRef: validateLocationRef_ACU(item.locationRef, `ledger.actors[${index}].locationRef`, phase), life, diedAtDay, deathSummary, resources: stringArray_ACU(item.resources, `ledger.actors[${index}].resources`, phase), goals: stringArray_ACU(item.goals, `ledger.actors[${index}].goals`, phase), constraints: stringArray_ACU(item.constraints, `ledger.actors[${index}].constraints`, phase), informationSources: stringArray_ACU(item.informationSources, `ledger.actors[${index}].informationSources`, phase), knownFacts: stringArray_ACU(item.knownFacts, `ledger.actors[${index}].knownFacts`, phase), visibility: enum_ACU(item.visibility, ['hidden', 'limited', 'public'] as const, `ledger.actors[${index}].visibility`, phase), revision: integer_ACU(item.revision, `ledger.actors[${index}].revision`, phase) };
  });
  uniqueIds_ACU(dimensions, 'ledger.dimensions', phase); uniqueIds_ACU(actors, 'ledger.actors', phase);
  const actorIds = new Set(actors.map(item => item.id));
  if (!Array.isArray(normalized.seeds) || normalized.seeds.length > 128) fail_ACU('ledger.seeds 容量非法', phase);
  const seeds = normalized.seeds.map((item, index) => {
    if (!isRecord_ACU(item)) fail_ACU(`ledger.seeds[${index}] 必须是对象`, phase);
    exactKeys_ACU(item, WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU.seeds, [], `ledger.seeds[${index}]`, phase);
    const linkedActors = stringArray_ACU(item.actorIds, `ledger.seeds[${index}].actorIds`, phase);
    for (const actorId of linkedActors) if (!actorIds.has(actorId)) fail_ACU(`ledger.seeds[${index}] 引用了不存在的 actor`, phase, { actorId });
    const status = enum_ACU(item.status, ['established', 'incubating', 'active', 'converging', 'resolved', 'retired'] as const, `ledger.seeds[${index}].status`, phase);
    const retiredReason = item.retiredReason === null ? null : string_ACU(item.retiredReason, `ledger.seeds[${index}].retiredReason`, phase);
    if (status === 'retired' && !retiredReason) fail_ACU(`ledger.seeds[${index}] 退役时必须提供原因`, phase);
    if (status !== 'retired' && retiredReason !== null) fail_ACU(`ledger.seeds[${index}] 非退役状态不能携带退役原因`, phase);
    return { id: stableId_ACU(item.id, `ledger.seeds[${index}].id`, phase), title: string_ACU(item.title, `ledger.seeds[${index}].title`, phase), status, level: integer_ACU(item.level, `ledger.seeds[${index}].level`, phase, 0, 100), catalyst: string_ACU(item.catalyst, `ledger.seeds[${index}].catalyst`, phase, true), visibility: enum_ACU(item.visibility, ['hidden', 'limited', 'public'] as const, `ledger.seeds[${index}].visibility`, phase), actorIds: linkedActors, location: validateLocationRef_ACU(item.location, `ledger.seeds[${index}].location`, phase), expiresAtDay: nullableInteger_ACU(item.expiresAtDay, `ledger.seeds[${index}].expiresAtDay`, phase, 1), missedOutcome: nullableString_ACU(item.missedOutcome, `ledger.seeds[${index}].missedOutcome`, phase), exposePolicy: enum_ACU(item.exposePolicy, WORLD_SEED_EXPOSE_POLICIES_ACU, `ledger.seeds[${index}].exposePolicy`, phase), evidenceRefs: stringArray_ACU(item.evidenceRefs, `ledger.seeds[${index}].evidenceRefs`, phase), retiredReason, revision: integer_ACU(item.revision, `ledger.seeds[${index}].revision`, phase) };
  });
  uniqueIds_ACU(seeds, 'ledger.seeds', phase);
  if (!Array.isArray(normalized.chronicle) || normalized.chronicle.length > 256) fail_ACU('ledger.chronicle 容量非法', phase);
  const knownIds = new Set([...dimensions.map(item => item.id), ...actors.map(item => item.id), ...seeds.map(item => item.id)]);
  const chronicle = normalized.chronicle.map((item, index) => {
    if (!isRecord_ACU(item)) fail_ACU(`ledger.chronicle[${index}] 必须是对象`, phase);
    exactKeys_ACU(item, WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU.chronicle, [], `ledger.chronicle[${index}]`, phase);
    const related = stringArray_ACU(item.relatedIds, `ledger.chronicle[${index}].relatedIds`, phase);
    for (const relatedId of related) if (!knownIds.has(relatedId)) fail_ACU(`ledger.chronicle[${index}] 引用了不存在的对象`, phase, { relatedId });
    return { id: stableId_ACU(item.id, `ledger.chronicle[${index}].id`, phase), at: string_ACU(item.at, `ledger.chronicle[${index}].at`, phase), summary: string_ACU(item.summary, `ledger.chronicle[${index}].summary`, phase), relatedIds: related, evidenceRefs: stringArray_ACU(item.evidenceRefs, `ledger.chronicle[${index}].evidenceRefs`, phase) };
  });
  uniqueIds_ACU(chronicle, 'ledger.chronicle', phase);
  const rumors = validateRumors_ACU(normalized.rumors, actorIds, phase);
  const player = validatePlayer_ACU(normalized.player, phase);
  if (!isRecord_ACU(normalized.guidance)) fail_ACU('ledger.guidance 必须是对象', phase);
  exactKeys_ACU(normalized.guidance, WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU.guidance, [], 'ledger.guidance', phase);
  const chronicleOverview = validateChronicleOverview_ACU(normalized.chronicleOverview, phase);
  const pendingFixes = validatePendingFixes_ACU(normalized.pendingFixes, phase);
  return { schemaVersion: WORLD_LEDGER_SCHEMA_VERSION_ACU, revision: integer_ACU(normalized.revision, 'ledger.revision', phase), clock, dimensions, seeds, actors, chronicle, rumors, player, guidance: { signals: validateGuidanceSignals_ACU(normalized.guidance.signals, 'ledger.guidance.signals', phase), excludedFacts: stringArray_ACU(normalized.guidance.excludedFacts, 'ledger.guidance.excludedFacts', phase), evidenceRefs: stringArray_ACU(normalized.guidance.evidenceRefs, 'ledger.guidance.evidenceRefs', phase) }, chronicleOverview, pendingFixes };
}

function validatePlan_ACU(raw: unknown, path: string, phase: WorldSimulationErrorPhase_ACU): WorldSimulationEnvelope_ACU['stages'][number]['revisions'][number]['plan'] {
  if (!isRecord_ACU(raw)) fail_ACU(`${path} 必须是对象`, phase);
  exactKeys_ACU(raw, ['schemaVersion', 'title', 'objective', 'impactScope', 'factsToVerify', 'plannedTools', 'plannedSpecialists', 'expectedLedgerChanges', 'convergenceConditions', 'blockingConditions', 'completedSteps', 'nextStep'], [], path, phase);
  if (raw.schemaVersion !== WORLD_SIMULATION_SCHEMA_VERSION_ACU) fail_ACU(`${path}.schemaVersion 必须为 1`, phase);
  if (!Array.isArray(raw.expectedLedgerChanges)) fail_ACU(`${path}.expectedLedgerChanges 必须是数组`, phase);
  return { schemaVersion: WORLD_SIMULATION_SCHEMA_VERSION_ACU, title: string_ACU(raw.title, `${path}.title`, phase), objective: string_ACU(raw.objective, `${path}.objective`, phase), impactScope: stringArray_ACU(raw.impactScope, `${path}.impactScope`, phase), factsToVerify: stringArray_ACU(raw.factsToVerify, `${path}.factsToVerify`, phase), plannedTools: stringArray_ACU(raw.plannedTools, `${path}.plannedTools`, phase), plannedSpecialists: stringArray_ACU(raw.plannedSpecialists, `${path}.plannedSpecialists`, phase), expectedLedgerChanges: raw.expectedLedgerChanges.map((item, index) => enum_ACU(item, WORLD_SIMULATION_LEDGER_MODULES_ACU, `${path}.expectedLedgerChanges[${index}]`, phase)), convergenceConditions: stringArray_ACU(raw.convergenceConditions, `${path}.convergenceConditions`, phase), blockingConditions: stringArray_ACU(raw.blockingConditions, `${path}.blockingConditions`, phase), completedSteps: stringArray_ACU(raw.completedSteps, `${path}.completedSteps`, phase), nextStep: string_ACU(raw.nextStep, `${path}.nextStep`, phase, true) };
}

export function validateWorldSimulationEnvelope_ACU(raw: unknown, phase: WorldSimulationErrorPhase_ACU = 'load'): WorldSimulationEnvelope_ACU {
  if (!isRecord_ACU(raw)) fail_ACU('世界推演状态必须是对象', phase);
  exactKeys_ACU(raw, ['schemaVersion', 'settings', 'task', 'stages', 'activeStageId', 'timeline', 'lastError', 'ledger', 'updatedAt'], [], 'envelope', phase);
  if (raw.schemaVersion !== WORLD_SIMULATION_SCHEMA_VERSION_ACU) fail_ACU('envelope.schemaVersion 必须为 1', phase);
  if (!Array.isArray(raw.stages)) fail_ACU('stages 必须是数组', phase);
  const stages = raw.stages.map((stage, stageIndex) => {
    if (!isRecord_ACU(stage)) fail_ACU(`stages[${stageIndex}] 必须是对象`, phase);
    exactKeys_ACU(stage, ['stageId', 'stageNumber', 'status', 'activeRevision', 'revisions'], [], `stages[${stageIndex}]`, phase);
    if (!Array.isArray(stage.revisions) || !stage.revisions.length) fail_ACU(`stages[${stageIndex}].revisions 不能为空`, phase);
    const revisions = stage.revisions.map((revision, revisionIndex) => {
      if (!isRecord_ACU(revision)) fail_ACU(`stages[${stageIndex}].revisions[${revisionIndex}] 必须是对象`, phase);
      exactKeys_ACU(revision, ['revision', 'createdAt', 'reason', 'replanInstruction', 'frozen', 'plan'], [], `stages[${stageIndex}].revisions[${revisionIndex}]`, phase);
      return { revision: integer_ACU(revision.revision, `stages[${stageIndex}].revisions[${revisionIndex}].revision`, phase, 1), createdAt: integer_ACU(revision.createdAt, `stages[${stageIndex}].revisions[${revisionIndex}].createdAt`, phase), reason: enum_ACU(revision.reason, REVISION_REASONS_ACU, `stages[${stageIndex}].revisions[${revisionIndex}].reason`, phase), replanInstruction: string_ACU(revision.replanInstruction, `stages[${stageIndex}].revisions[${revisionIndex}].replanInstruction`, phase, true), frozen: boolean_ACU(revision.frozen, `stages[${stageIndex}].revisions[${revisionIndex}].frozen`, phase), plan: validatePlan_ACU(revision.plan, `stages[${stageIndex}].revisions[${revisionIndex}].plan`, phase) };
    });
    const activeRevision = integer_ACU(stage.activeRevision, `stages[${stageIndex}].activeRevision`, phase, 1);
    if (!revisions.some(revision => revision.revision === activeRevision)) fail_ACU(`stages[${stageIndex}].activeRevision 不存在`, phase);
    return { stageId: stableId_ACU(stage.stageId, `stages[${stageIndex}].stageId`, phase), stageNumber: integer_ACU(stage.stageNumber, `stages[${stageIndex}].stageNumber`, phase, 1), status: normalizeLegacyEnum_ACU(STAGE_STATUSES_ACU, LEGACY_STAGE_STATUSES_ACU, stage.status, `stages[${stageIndex}].status`, phase), activeRevision, revisions };
  });
  uniqueIds_ACU(stages.map(stage => ({ id: stage.stageId })), 'stages', phase);
  const activeStageId = raw.activeStageId === null ? null : stableId_ACU(raw.activeStageId, 'activeStageId', phase);
  if (activeStageId && !stages.some(stage => stage.stageId === activeStageId)) fail_ACU('activeStageId 不存在', phase);
  let task: WorldSimulationEnvelope_ACU['task'] = null;
  if (raw.task !== null) {
    if (!isRecord_ACU(raw.task)) fail_ACU('task 必须是对象或 null', phase);
    exactKeys_ACU(raw.task, ['taskId', 'originInstruction', 'status', 'createdAt', 'updatedAt', 'activeRun', 'stopReason'], [], 'task', phase);
    task = { taskId: stableId_ACU(raw.task.taskId, 'task.taskId', phase), originInstruction: string_ACU(raw.task.originInstruction, 'task.originInstruction', phase), status: normalizeLegacyEnum_ACU(TASK_STATUSES_ACU, LEGACY_TASK_STATUSES_ACU, raw.task.status, 'task.status', phase), createdAt: integer_ACU(raw.task.createdAt, 'task.createdAt', phase), updatedAt: integer_ACU(raw.task.updatedAt, 'task.updatedAt', phase), activeRun: null, stopReason: raw.task.stopReason === null ? null : string_ACU(raw.task.stopReason, 'task.stopReason', phase) };
    if (raw.task.activeRun !== null) {
      const run = raw.task.activeRun;
      if (!isRecord_ACU(run)) fail_ACU('task.activeRun 必须是对象或 null', phase);
      exactKeys_ACU(run, ['runId', 'chatIdentity', 'triggerKind', 'triggerConversationMessageId', 'anchorMessageId', 'anchorMessageKey', 'anchorSwipeId', 'anchorContentDigest', 'baseLedgerRevision', 'taskId', 'stageId', 'stageRevision'], [], 'task.activeRun', phase);
      const anchorMessageId = typeof run.anchorMessageId === 'number' ? integer_ACU(run.anchorMessageId, 'task.activeRun.anchorMessageId', phase) : string_ACU(run.anchorMessageId, 'task.activeRun.anchorMessageId', phase);
      task.activeRun = { runId: stableId_ACU(run.runId, 'task.activeRun.runId', phase), chatIdentity: string_ACU(run.chatIdentity, 'task.activeRun.chatIdentity', phase), triggerKind: enum_ACU(run.triggerKind, ['assistant_completed', 'agent_chat_message'] as const, 'task.activeRun.triggerKind', phase), triggerConversationMessageId: run.triggerConversationMessageId === null ? null : string_ACU(run.triggerConversationMessageId, 'task.activeRun.triggerConversationMessageId', phase), anchorMessageId, anchorMessageKey: string_ACU(run.anchorMessageKey, 'task.activeRun.anchorMessageKey', phase), anchorSwipeId: string_ACU(run.anchorSwipeId, 'task.activeRun.anchorSwipeId', phase), anchorContentDigest: string_ACU(run.anchorContentDigest, 'task.activeRun.anchorContentDigest', phase), baseLedgerRevision: integer_ACU(run.baseLedgerRevision, 'task.activeRun.baseLedgerRevision', phase), taskId: stableId_ACU(run.taskId, 'task.activeRun.taskId', phase), stageId: stableId_ACU(run.stageId, 'task.activeRun.stageId', phase), stageRevision: integer_ACU(run.stageRevision, 'task.activeRun.stageRevision', phase, 1) };
      if (task.activeRun.taskId !== task.taskId) fail_ACU('task.activeRun.taskId 与 task 不一致', phase);
      const runStage = stages.find(stage => stage.stageId === task!.activeRun!.stageId);
      if (!runStage || runStage.activeRevision !== task.activeRun.stageRevision) fail_ACU('task.activeRun 阶段 revision 不一致', phase);
    }
  } else if (stages.length || activeStageId) fail_ACU('无 task 时不能存在 stages 或 activeStageId', phase);
  if (!Array.isArray(raw.timeline)) fail_ACU('timeline 必须是数组', phase);
  const timeline = raw.timeline.map((entry, index) => {
    if (!isRecord_ACU(entry)) fail_ACU(`timeline[${index}] 必须是对象`, phase);
    exactKeys_ACU(entry, ['id', 'at', 'kind', 'taskId'], ['stageId', 'revision', 'runId', 'message', 'errorCode'], `timeline[${index}]`, phase);
    return { id: stableId_ACU(entry.id, `timeline[${index}].id`, phase), at: integer_ACU(entry.at, `timeline[${index}].at`, phase), kind: normalizeLegacyEnum_ACU(TIMELINE_KINDS_ACU, LEGACY_TIMELINE_KINDS_ACU, entry.kind, `timeline[${index}].kind`, phase), taskId: stableId_ACU(entry.taskId, `timeline[${index}].taskId`, phase), ...(entry.stageId === undefined ? {} : { stageId: stableId_ACU(entry.stageId, `timeline[${index}].stageId`, phase) }), ...(entry.revision === undefined ? {} : { revision: integer_ACU(entry.revision, `timeline[${index}].revision`, phase, 1) }), ...(entry.runId === undefined ? {} : { runId: stableId_ACU(entry.runId, `timeline[${index}].runId`, phase) }), ...(entry.message === undefined ? {} : { message: string_ACU(entry.message, `timeline[${index}].message`, phase, true) }), ...(entry.errorCode === undefined ? {} : { errorCode: enum_ACU(entry.errorCode, ERROR_CODES_ACU, `timeline[${index}].errorCode`, phase) }) };
  });
  let lastError: WorldSimulationEnvelope_ACU['lastError'] = null;
  if (raw.lastError !== null) {
    if (!isRecord_ACU(raw.lastError)) fail_ACU('lastError 必须是对象或 null', phase);
    exactKeys_ACU(raw.lastError, ['code', 'phase', 'message', 'retryable'], ['details'], 'lastError', phase);
    const details = raw.lastError.details;
    if (details !== undefined && !isRecord_ACU(details)) fail_ACU('lastError.details 必须是对象', phase);
    lastError = {
      code: enum_ACU(raw.lastError.code, ERROR_CODES_ACU, 'lastError.code', phase),
      phase: enum_ACU(raw.lastError.phase, ERROR_PHASES_ACU, 'lastError.phase', phase),
      message: string_ACU(raw.lastError.message, 'lastError.message', phase),
      retryable: boolean_ACU(raw.lastError.retryable, 'lastError.retryable', phase),
    };
    if (isRecord_ACU(details)) {
      lastError.details = { ...details };
    }
  }
  return { schemaVersion: WORLD_SIMULATION_SCHEMA_VERSION_ACU, settings: validateSettings_ACU(raw.settings, phase), task, stages, activeStageId, timeline, lastError, ledger: validateLedger_ACU(raw.ledger, phase), updatedAt: integer_ACU(raw.updatedAt, 'updatedAt', phase) };
}

function activeRevision_ACU(envelope: WorldSimulationEnvelope_ACU | null): number | null {
  if (!envelope?.activeStageId) return null;
  return envelope.stages.find(stage => stage.stageId === envelope.activeStageId)?.activeRevision ?? null;
}

function assertGuard_ACU(envelope: WorldSimulationEnvelope_ACU | null, guard?: WorldSimulationWriteGuard_ACU): void {
  if (!guard) return;
  if (guard.taskId !== undefined && (envelope?.task?.taskId ?? null) !== guard.taskId) reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', 'persist', '任务身份已变化');
  if (guard.stageId !== undefined && (envelope?.activeStageId ?? null) !== guard.stageId) reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', 'persist', '阶段身份已变化');
  if (guard.revision !== undefined && activeRevision_ACU(envelope) !== guard.revision) reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', 'persist', '阶段 revision 已变化');
}

function captureContext_ACU(guard?: WorldSimulationWriteGuard_ACU) {
  const chat = getChatArray_ACU();
  const firstMessage = Array.isArray(chat) && isRecord_ACU(chat[0]) ? chat[0] : null;
  const chatIdentity = getActiveChatStorageIdentity_ACU(chat);
  if (!firstMessage || !chatIdentity) reject_ACU('WORLD_SIMULATION_CHAT_UNAVAILABLE', 'persist', '当前聊天首楼不可用');
  if (guard?.chatIdentity && guard.chatIdentity !== chatIdentity) reject_ACU('WORLD_SIMULATION_CHAT_CHANGED', 'persist', '目标聊天已变化');
  return { chat, firstMessage, chatIdentity };
}

function assertContext_ACU(context: ReturnType<typeof captureContext_ACU>): void {
  const active = getChatArray_ACU();
  if (active !== context.chat || active[0] !== context.firstMessage || getActiveChatStorageIdentity_ACU(active) !== context.chatIdentity) reject_ACU('WORLD_SIMULATION_CHAT_CHANGED', 'persist', '目标聊天已切换，拒绝写入');
}

function readRaw_ACU(firstMessage: Record<string, unknown>): WorldSimulationEnvelope_ACU | null {
  const raw = firstMessage[WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU];
  return raw === undefined ? null : validateWorldSimulationEnvelope_ACU(raw);
}

export class FirstFloorWorldSimulationStore_ACU {
  private static tailsByChat_ACU = new Map<string, Promise<void>>();

  read(): WorldSimulationEnvelope_ACU | null { return readRaw_ACU(captureContext_ACU().firstMessage); }
  readPersisted(): WorldSimulationEnvelope_ACU | null { return this.read(); }

  replaceAtomically(candidate: WorldSimulationEnvelope_ACU, guard?: WorldSimulationWriteGuard_ACU): Promise<void> {
    return this.enqueue_ACU(context => this.replaceWithinQueue_ACU(candidate, guard, context), guard);
  }

  updateAtomically(mutator: (current: WorldSimulationEnvelope_ACU | null) => WorldSimulationEnvelope_ACU, guard?: WorldSimulationWriteGuard_ACU): Promise<void> {
    return this.enqueue_ACU(async context => {
      assertContext_ACU(context);
      const current = readRaw_ACU(context.firstMessage);
      assertGuard_ACU(current, guard);
      await this.replaceWithinQueue_ACU(mutator(current), guard, context);
    }, guard);
  }

  private async replaceWithinQueue_ACU(candidate: WorldSimulationEnvelope_ACU, guard: WorldSimulationWriteGuard_ACU | undefined, context: ReturnType<typeof captureContext_ACU>): Promise<void> {
    assertContext_ACU(context);
    assertGuard_ACU(readRaw_ACU(context.firstMessage), guard);
    const validated = validateWorldSimulationEnvelope_ACU(candidate, 'persist');
    const existed = Object.prototype.hasOwnProperty.call(context.firstMessage, WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU);
    const previous = context.firstMessage[WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU];
    let saveAttempted = false;
    try {
      context.firstMessage[WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU] = validated;
      assertContext_ACU(context);
      saveAttempted = true;
      await saveChatToHostStrict_ACU();
      assertContext_ACU(context);
    } catch (error) {
      if (existed) context.firstMessage[WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU] = previous;
      else delete context.firstMessage[WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU];
      const stillActive = getChatArray_ACU() === context.chat && getChatArray_ACU()[0] === context.firstMessage && getActiveChatStorageIdentity_ACU(context.chat) === context.chatIdentity;
      if (saveAttempted && stillActive) {
        try { await saveChatToHostStrict_ACU(); }
        catch (rollbackError) { reject_ACU('WORLD_SIMULATION_PERSIST_FAILED', 'persist', '世界推演状态保存与回滚均失败', { primaryMessage: error instanceof Error ? error.message : String(error), rollbackMessage: rollbackError instanceof Error ? rollbackError.message : String(rollbackError) }); }
      }
      if (error instanceof WorldSimulationValidationError_ACU) throw error;
      reject_ACU('WORLD_SIMULATION_PERSIST_FAILED', 'persist', '世界推演状态保存失败', { message: error instanceof Error ? error.message : String(error) });
    }
  }

  private enqueue_ACU(operation: (context: ReturnType<typeof captureContext_ACU>) => Promise<void>, guard?: WorldSimulationWriteGuard_ACU): Promise<void> {
    const context = captureContext_ACU(guard);
    const previous = FirstFloorWorldSimulationStore_ACU.tailsByChat_ACU.get(context.chatIdentity) ?? Promise.resolve();
    const result = previous.then(() => operation(context), () => operation(context));
    const settled = result.catch((): void => undefined);
    FirstFloorWorldSimulationStore_ACU.tailsByChat_ACU.set(context.chatIdentity, settled);
    void settled.finally(() => { if (FirstFloorWorldSimulationStore_ACU.tailsByChat_ACU.get(context.chatIdentity) === settled) FirstFloorWorldSimulationStore_ACU.tailsByChat_ACU.delete(context.chatIdentity); });
    return result;
  }
}

function readMessageContent_ACU(message: Record<string, unknown>): string {
  return typeof message.mes === 'string' ? message.mes : typeof message.message === 'string' ? message.message : '';
}

function isAssistantMessage_ACU(message: Record<string, unknown>): boolean {
  return message.is_user !== true && message.is_system !== true;
}

export function buildWorldSimulationBucketKey_ACU(anchor: WorldSimulationAnchorIdentity_ACU): string {
  return sha256HexSync_ACU([anchor.chatIdentity, anchor.messageKey, anchor.swipeId, anchor.contentDigest].join('\n'));
}

export function resolveWorldSimulationAnchor_ACU(messageIndex: number, chat?: any[]): WorldSimulationAnchorIdentity_ACU {
  const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
  const chatIdentity = getActiveChatStorageIdentity_ACU(messages);
  const message = Number.isInteger(messageIndex) && messageIndex >= 0 && isRecord_ACU(messages[messageIndex])
    ? messages[messageIndex]
    : null;
  if (!chatIdentity || !message || !isAssistantMessage_ACU(message)) {
    reject_ACU('WORLD_SIMULATION_ANCHOR_INVALID', 'anchor', '世界推演锚点必须是当前聊天中的 assistant 楼层', { messageIndex });
  }
  const rawMessageId = message.message_id;
  const messageId = typeof rawMessageId === 'string' || typeof rawMessageId === 'number' ? rawMessageId : messageIndex;
  const swipeId = typeof message.swipe_id === 'number' && Number.isInteger(message.swipe_id) && message.swipe_id >= 0
    ? String(message.swipe_id)
    : '0';
  const content = readMessageContent_ACU(message);
  const contentDigest = sha256HexSync_ACU(content);
  const messageKey = `${typeof messageId}:${String(messageId)}`;
  return { chatIdentity, messageIndex, messageId, messageKey, swipeId, contentDigest };
}

export function assertWorldSimulationAnchorCurrent_ACU(anchor: WorldSimulationAnchorIdentity_ACU, chat?: any[]): WorldSimulationAnchorIdentity_ACU {
  const current = resolveWorldSimulationAnchor_ACU(anchor.messageIndex, chat);
  if (current.chatIdentity !== anchor.chatIdentity
    || current.messageKey !== anchor.messageKey
    || current.swipeId !== anchor.swipeId
    || current.contentDigest !== anchor.contentDigest) {
    reject_ACU('WORLD_SIMULATION_ANCHOR_STALE', 'anchor', '世界推演冻结锚点已变化，拒绝继续写入', {
      expected: anchor,
      actual: current,
    });
  }
  return current;
}

/** 按身份四元组重扫当前下标；正文 digest / swipe 变化时仍 fail-closed。 */
export function resolveCurrentWorldSimulationAnchor_ACU(anchor: WorldSimulationAnchorIdentity_ACU, chat?: any[]): WorldSimulationAnchorIdentity_ACU {
  const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
  const chatIdentity = getActiveChatStorageIdentity_ACU(messages);
  if (!chatIdentity) {
    reject_ACU('WORLD_SIMULATION_ANCHOR_INVALID', 'anchor', '世界推演锚点必须是当前聊天中的 assistant 楼层', { messageIndex: anchor.messageIndex });
  }
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!isRecord_ACU(message) || !isAssistantMessage_ACU(message)) continue;
    const current = resolveWorldSimulationAnchor_ACU(index, messages);
    if (current.chatIdentity === anchor.chatIdentity
      && current.messageKey === anchor.messageKey
      && current.swipeId === anchor.swipeId
      && current.contentDigest === anchor.contentDigest) {
      return current;
    }
  }
  reject_ACU('WORLD_SIMULATION_ANCHOR_STALE', 'anchor', '世界推演冻结锚点已变化，拒绝继续写入', { expected: anchor });
}

export function readWorldSimulationBucketEntry_ACU<T>(
  field: string,
  anchor: WorldSimulationAnchorIdentity_ACU,
  validateValue: (raw: unknown) => T,
  chat?: any[],
): T | null {
  const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
  const currentAnchor = resolveCurrentWorldSimulationAnchor_ACU(anchor, messages);
  const message = messages[currentAnchor.messageIndex] as Record<string, unknown>;
  const rawBucket = message[field];
  if (rawBucket === undefined) return null;
  if (!isRecord_ACU(rawBucket) || rawBucket.schemaVersion !== 1 || !isRecord_ACU(rawBucket.entries)) {
    reject_ACU('WORLD_SIMULATION_SNAPSHOT_INVALID', 'load', `${field} 分桶结构损坏`);
  }
  const rawEntry = rawBucket.entries[buildWorldSimulationBucketKey_ACU(currentAnchor)];
  if (rawEntry === undefined) return null;
  if (!isRecord_ACU(rawEntry) || !isRecord_ACU(rawEntry.anchor) || !Object.prototype.hasOwnProperty.call(rawEntry, 'value')) {
    reject_ACU('WORLD_SIMULATION_SNAPSHOT_INVALID', 'load', `${field} 当前 swipe 条目损坏`);
  }
  const storedAnchor = rawEntry.anchor as unknown as WorldSimulationAnchorIdentity_ACU;
  if (storedAnchor.chatIdentity !== currentAnchor.chatIdentity || storedAnchor.messageKey !== currentAnchor.messageKey
    || storedAnchor.swipeId !== currentAnchor.swipeId || storedAnchor.contentDigest !== currentAnchor.contentDigest) {
    reject_ACU('WORLD_SIMULATION_SNAPSHOT_INVALID', 'load', `${field} 当前 swipe 身份不一致`);
  }
  return validateValue(rawEntry.value);
}

export async function writeWorldSimulationBucketEntry_ACU<T>(
  field: string,
  anchor: WorldSimulationAnchorIdentity_ACU,
  value: T,
  chat?: any[],
): Promise<void> {
  const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
  const currentAnchor = resolveCurrentWorldSimulationAnchor_ACU(anchor, messages);
  const message = messages[currentAnchor.messageIndex] as Record<string, unknown>;
  const previous = message[field];
  const previousBucket = isRecord_ACU(previous) && previous.schemaVersion === 1 && isRecord_ACU(previous.entries)
    ? previous as unknown as WorldSimulationBucket_ACU<T>
    : { schemaVersion: 1 as const, entries: {} };
  const key = buildWorldSimulationBucketKey_ACU(currentAnchor);
  const candidate: WorldSimulationBucket_ACU<T> = {
    schemaVersion: 1,
    entries: { ...previousBucket.entries, [key]: { anchor: { ...currentAnchor }, value, updatedAt: Date.now() } },
  };
  try {
    message[field] = candidate;
    await saveChatToHostStrict_ACU();
    resolveCurrentWorldSimulationAnchor_ACU(currentAnchor, messages);
  } catch (error) {
    if (previous === undefined) delete message[field];
    else message[field] = previous;
    if (error instanceof WorldSimulationValidationError_ACU) throw error;
    reject_ACU('WORLD_SIMULATION_PERSIST_FAILED', 'agent_persist', `${field} 保存失败，已还原楼层字段`, {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export function validateWorldSimulationLedger_ACU(raw: unknown, phase: WorldSimulationErrorPhase_ACU = 'load'): WorldSimulationLedger_ACU {
  return validateLedger_ACU(raw, phase);
}

/**
 * 预检专用聚合诊断：对模拟应用后的账本逐模块、逐条目体检，收集全部违规一次性返回。
 * 只用于候选入库预检的诊断回灌；正式提交路径仍由 validateWorldSimulationLedger_ACU 首错 fail-closed。
 */
export function collectWorldSimulationLedgerViolations_ACU(raw: unknown): string[] {
  const violations: string[] = [];
  const probe = (check: () => void): void => {
    try { check(); } catch (error) { violations.push(error instanceof Error ? error.message : String(error)); }
  };
  const phase: WorldSimulationErrorPhase_ACU = 'agent_persist';
  if (!isRecord_ACU(raw)) return ['ledger 必须是对象'];
  const normalized = migrateLedgerToCurrent_ACU(raw);
  if (!isRecord_ACU(normalized)) return ['ledger 必须是对象'];
  probe(() => {
    exactKeys_ACU(normalized, LEDGER_EXACT_KEYS_ACU, [], 'ledger', phase);
    if (normalized.schemaVersion !== WORLD_LEDGER_SCHEMA_VERSION_ACU) fail_ACU(`ledger.schemaVersion 必须为 ${WORLD_LEDGER_SCHEMA_VERSION_ACU}`, phase);
    integer_ACU(normalized.revision, 'ledger.revision', phase);
  });
  probe(() => {
    if (!isRecord_ACU(normalized.clock)) fail_ACU('ledger.clock 必须是对象', phase);
    exactKeys_ACU(normalized.clock, WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU.clock, [], 'ledger.clock', phase);
    integer_ACU(normalized.clock.day, 'ledger.clock.day', phase, 1);
    string_ACU(normalized.clock.slot, 'ledger.clock.slot', phase, true);
    string_ACU(normalized.clock.storyTime, 'ledger.clock.storyTime', phase, true);
    enum_ACU(normalized.clock.precision, ['exact', 'approximate', 'unknown'] as const, 'ledger.clock.precision', phase);
    stringArray_ACU(normalized.clock.evidenceRefs, 'ledger.clock.evidenceRefs', phase);
  });
  const dimensions: Array<{ id: string }> = [];
  if (!Array.isArray(normalized.dimensions) || normalized.dimensions.length > 32) probe(() => fail_ACU('ledger.dimensions 容量非法', phase));
  else {
    for (const [index, item] of normalized.dimensions.entries()) {
      probe(() => {
        if (!isRecord_ACU(item)) fail_ACU(`ledger.dimensions[${index}] 必须是对象`, phase);
        exactKeys_ACU(item, WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU.dimensions, [], `ledger.dimensions[${index}]`, phase);
        dimensions.push({ id: stableId_ACU(item.id, `ledger.dimensions[${index}].id`, phase) });
        string_ACU(item.name, `ledger.dimensions[${index}].name`, phase);
        enum_ACU(item.kind, ['pressure', 'growth'] as const, `ledger.dimensions[${index}].kind`, phase);
        integer_ACU(item.value, `ledger.dimensions[${index}].value`, phase, 0, 100);
        enum_ACU(item.trend, ['rising', 'stable', 'falling'] as const, `ledger.dimensions[${index}].trend`, phase);
        string_ACU(item.rationale, `ledger.dimensions[${index}].rationale`, phase, true);
        stringArray_ACU(item.evidenceRefs, `ledger.dimensions[${index}].evidenceRefs`, phase);
        integer_ACU(item.revision, `ledger.dimensions[${index}].revision`, phase);
      });
    }
    probe(() => uniqueIds_ACU(dimensions, 'ledger.dimensions', phase));
  }
  const actors: Array<{ id: string }> = [];
  const actorIds = new Set<string>();
  if (!Array.isArray(normalized.actors) || normalized.actors.length > 128) probe(() => fail_ACU('ledger.actors 容量非法', phase));
  else {
    for (const [index, item] of normalized.actors.entries()) {
      probe(() => {
        if (!isRecord_ACU(item)) fail_ACU(`ledger.actors[${index}] 必须是对象`, phase);
        exactKeys_ACU(item, WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU.actors, [], `ledger.actors[${index}]`, phase);
        const life = enum_ACU(item.life, WORLD_ACTOR_LIFE_ACU, `ledger.actors[${index}].life`, phase);
        const diedAtDay = nullableInteger_ACU(item.diedAtDay, `ledger.actors[${index}].diedAtDay`, phase, 1);
        const deathSummary = nullableString_ACU(item.deathSummary, `ledger.actors[${index}].deathSummary`, phase);
        if (life === 'dead') {
          if (diedAtDay === null) fail_ACU(`ledger.actors[${index}] dead 状态必须提供 diedAtDay`, phase);
          if (!deathSummary) fail_ACU(`ledger.actors[${index}] dead 状态必须提供 deathSummary`, phase);
        } else if (diedAtDay !== null || deathSummary !== null) {
          fail_ACU(`ledger.actors[${index}] 非 dead 状态不能携带死亡字段`, phase);
        }
        const id = stableId_ACU(item.id, `ledger.actors[${index}].id`, phase);
        string_ACU(item.name, `ledger.actors[${index}].name`, phase);
        stringArray_ACU(item.interests, `ledger.actors[${index}].interests`, phase);
        string_ACU(item.location, `ledger.actors[${index}].location`, phase, true);
        validateLocationRef_ACU(item.locationRef, `ledger.actors[${index}].locationRef`, phase);
        stringArray_ACU(item.resources, `ledger.actors[${index}].resources`, phase);
        stringArray_ACU(item.goals, `ledger.actors[${index}].goals`, phase);
        stringArray_ACU(item.constraints, `ledger.actors[${index}].constraints`, phase);
        stringArray_ACU(item.informationSources, `ledger.actors[${index}].informationSources`, phase);
        stringArray_ACU(item.knownFacts, `ledger.actors[${index}].knownFacts`, phase);
        enum_ACU(item.visibility, ['hidden', 'limited', 'public'] as const, `ledger.actors[${index}].visibility`, phase);
        integer_ACU(item.revision, `ledger.actors[${index}].revision`, phase);
        actors.push({ id });
        actorIds.add(id);
      });
    }
    probe(() => uniqueIds_ACU(actors, 'ledger.actors', phase));
  }
  const seeds: Array<{ id: string }> = [];
  if (!Array.isArray(normalized.seeds) || normalized.seeds.length > 128) probe(() => fail_ACU('ledger.seeds 容量非法', phase));
  else {
    for (const [index, item] of normalized.seeds.entries()) {
      probe(() => {
        if (!isRecord_ACU(item)) fail_ACU(`ledger.seeds[${index}] 必须是对象`, phase);
        exactKeys_ACU(item, WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU.seeds, [], `ledger.seeds[${index}]`, phase);
        const linkedActors = stringArray_ACU(item.actorIds, `ledger.seeds[${index}].actorIds`, phase);
        for (const actorId of linkedActors) if (!actorIds.has(actorId)) fail_ACU(`ledger.seeds[${index}] 引用了不存在的 actor`, phase, { actorId });
        const status = enum_ACU(item.status, ['established', 'incubating', 'active', 'converging', 'resolved', 'retired'] as const, `ledger.seeds[${index}].status`, phase);
        const retiredReason = item.retiredReason === null ? null : string_ACU(item.retiredReason, `ledger.seeds[${index}].retiredReason`, phase);
        if (status === 'retired' && !retiredReason) fail_ACU(`ledger.seeds[${index}] 退役时必须提供原因`, phase);
        if (status !== 'retired' && retiredReason !== null) fail_ACU(`ledger.seeds[${index}] 非退役状态不能携带退役原因`, phase);
        seeds.push({ id: stableId_ACU(item.id, `ledger.seeds[${index}].id`, phase) });
        string_ACU(item.title, `ledger.seeds[${index}].title`, phase);
        integer_ACU(item.level, `ledger.seeds[${index}].level`, phase, 0, 100);
        string_ACU(item.catalyst, `ledger.seeds[${index}].catalyst`, phase, true);
        enum_ACU(item.visibility, ['hidden', 'limited', 'public'] as const, `ledger.seeds[${index}].visibility`, phase);
        validateLocationRef_ACU(item.location, `ledger.seeds[${index}].location`, phase);
        nullableInteger_ACU(item.expiresAtDay, `ledger.seeds[${index}].expiresAtDay`, phase, 1);
        nullableString_ACU(item.missedOutcome, `ledger.seeds[${index}].missedOutcome`, phase);
        enum_ACU(item.exposePolicy, WORLD_SEED_EXPOSE_POLICIES_ACU, `ledger.seeds[${index}].exposePolicy`, phase);
        stringArray_ACU(item.evidenceRefs, `ledger.seeds[${index}].evidenceRefs`, phase);
        integer_ACU(item.revision, `ledger.seeds[${index}].revision`, phase);
      });
    }
    probe(() => uniqueIds_ACU(seeds, 'ledger.seeds', phase));
  }
  const chronicle: Array<{ id: string }> = [];
  const knownIds = new Set([...dimensions.map(item => item.id), ...actors.map(item => item.id), ...seeds.map(item => item.id)]);
  if (!Array.isArray(normalized.chronicle) || normalized.chronicle.length > 256) probe(() => fail_ACU('ledger.chronicle 容量非法', phase));
  else {
    for (const [index, item] of normalized.chronicle.entries()) {
      probe(() => {
        if (!isRecord_ACU(item)) fail_ACU(`ledger.chronicle[${index}] 必须是对象`, phase);
        exactKeys_ACU(item, WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU.chronicle, [], `ledger.chronicle[${index}]`, phase);
        const related = stringArray_ACU(item.relatedIds, `ledger.chronicle[${index}].relatedIds`, phase);
        for (const relatedId of related) if (!knownIds.has(relatedId)) fail_ACU(`ledger.chronicle[${index}] 引用了不存在的对象`, phase, { relatedId });
        chronicle.push({ id: stableId_ACU(item.id, `ledger.chronicle[${index}].id`, phase) });
        string_ACU(item.at, `ledger.chronicle[${index}].at`, phase);
        string_ACU(item.summary, `ledger.chronicle[${index}].summary`, phase);
        stringArray_ACU(item.evidenceRefs, `ledger.chronicle[${index}].evidenceRefs`, phase);
      });
    }
    probe(() => uniqueIds_ACU(chronicle, 'ledger.chronicle', phase));
  }
  probe(() => { validateRumors_ACU(normalized.rumors, actorIds, phase); });
  probe(() => { validatePlayer_ACU(normalized.player, phase); });
  probe(() => {
    if (!isRecord_ACU(normalized.guidance)) fail_ACU('ledger.guidance 必须是对象', phase);
    exactKeys_ACU(normalized.guidance, WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU.guidance, [], 'ledger.guidance', phase);
    validateGuidanceSignals_ACU(normalized.guidance.signals, 'ledger.guidance.signals', phase);
    stringArray_ACU(normalized.guidance.excludedFacts, 'ledger.guidance.excludedFacts', phase);
    stringArray_ACU(normalized.guidance.evidenceRefs, 'ledger.guidance.evidenceRefs', phase);
  });
  probe(() => { validateChronicleOverview_ACU(normalized.chronicleOverview, phase); });
  probe(() => { validatePendingFixes_ACU(normalized.pendingFixes, phase); });
  return violations;
}

export function buildEmptyWorldChronicleArchiveSnapshot_ACU(): WorldChronicleArchiveSnapshot_ACU {
  return { schemaVersion: WORLD_SIMULATION_CHRONICLE_ARCHIVE_SCHEMA_VERSION_ACU, records: {} };
}

export function validateWorldSimulationChronicleArchiveSnapshot_ACU(raw: unknown, phase: WorldSimulationErrorPhase_ACU = 'load'): WorldChronicleArchiveSnapshot_ACU {
  if (!isRecord_ACU(raw)) fail_ACU('chronicle archive 必须是对象', phase);
  exactKeys_ACU(raw, ['schemaVersion', 'records'], [], 'chronicleArchive', phase);
  if (raw.schemaVersion !== WORLD_SIMULATION_CHRONICLE_ARCHIVE_SCHEMA_VERSION_ACU) fail_ACU('chronicleArchive.schemaVersion 必须为 1', phase);
  if (!isRecord_ACU(raw.records)) fail_ACU('chronicleArchive.records 必须是对象', phase);
  const records: Record<string, WorldChronicleArchiveDetail_ACU> = {};
  for (const [archiveRef, item] of Object.entries(raw.records)) {
    const path = `chronicleArchive.records.${archiveRef}`;
    if (!isRecord_ACU(item)) fail_ACU(`${path} 必须是对象`, phase);
    exactKeys_ACU(item, ['archiveRef', 'day', 'summary', 'fingerprints', 'relatedIds', 'sourceChronicleIds'], [], path, phase);
    const validatedRef = stableId_ACU(item.archiveRef, `${path}.archiveRef`, phase);
    if (validatedRef !== archiveRef) fail_ACU(`${path}.archiveRef 必须与键一致`, phase);
    records[archiveRef] = {
      archiveRef: validatedRef,
      day: integer_ACU(item.day, `${path}.day`, phase, 1),
      summary: string_ACU(item.summary, `${path}.summary`, phase),
      fingerprints: stringArray_ACU(item.fingerprints, `${path}.fingerprints`, phase),
      relatedIds: stringArray_ACU(item.relatedIds, `${path}.relatedIds`, phase),
      sourceChronicleIds: stringArray_ACU(item.sourceChronicleIds, `${path}.sourceChronicleIds`, phase),
    };
  }
  return { schemaVersion: WORLD_SIMULATION_CHRONICLE_ARCHIVE_SCHEMA_VERSION_ACU, records };
}

function cloneJson_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function getWorldSimulationFirstFloorMessage_ACU(): Record<string, unknown> | null {
  try {
    const chat = getChatArray_ACU();
    const first = Array.isArray(chat) && isRecord_ACU(chat[0]) ? chat[0] : null;
    return first;
  } catch {
    return null;
  }
}

export function renameApiPresetReferencesInWorldSimulationSettings_ACU(
  settings: WorldSimulationEnvelope_ACU['settings'],
  oldName: string,
  newName: string,
): WorldSimulationEnvelope_ACU['settings'] {
  const oldN = String(oldName || '').trim();
  const newN = String(newName || '').trim();
  if (!settings || typeof settings !== 'object' || !oldN || !newN || oldN === newN) return settings;
  let changed = false;
  const nextFixed = settings.fixedApiPresetName === oldN ? newN : settings.fixedApiPresetName;
  if (nextFixed !== settings.fixedApiPresetName) changed = true;
  const sourcePresets = settings.agentApiPresets && typeof settings.agentApiPresets === 'object' ? settings.agentApiPresets : {};
  const agentApiPresets: WorldSimulationEnvelope_ACU['settings']['agentApiPresets'] = {};
  for (const [role, choice] of Object.entries(sourcePresets)) {
    if (choice && typeof choice === 'object' && choice.presetName === oldN) {
      agentApiPresets[role] = { ...choice, presetName: newN };
      changed = true;
    } else {
      agentApiPresets[role] = choice;
    }
  }
  return changed ? { ...settings, fixedApiPresetName: nextFixed, agentApiPresets } : settings;
}

export function clearApiPresetReferencesInWorldSimulationSettings_ACU(
  settings: WorldSimulationEnvelope_ACU['settings'],
  name: string,
): WorldSimulationEnvelope_ACU['settings'] {
  const target = String(name || '').trim();
  if (!settings || typeof settings !== 'object' || !target) return settings;
  let changed = false;
  const clearFixed = settings.fixedApiPresetName === target;
  const sourcePresets = settings.agentApiPresets && typeof settings.agentApiPresets === 'object' ? settings.agentApiPresets : {};
  const agentApiPresets: WorldSimulationEnvelope_ACU['settings']['agentApiPresets'] = {};
  for (const [role, choice] of Object.entries(sourcePresets)) {
    if (choice && typeof choice === 'object' && choice.presetName === target) {
      agentApiPresets[role] = {
        mode: choice.mode === 'fixed' ? 'current' : choice.mode,
        presetName: '',
      };
      changed = true;
    } else {
      agentApiPresets[role] = choice;
    }
  }
  if (!clearFixed && !changed) return settings;
  return {
    ...settings,
    ...(clearFixed ? { apiPresetMode: 'current' as const, fixedApiPresetName: '' } : {}),
    agentApiPresets,
  };
}

export function snapshotCurrentWorldSimulationApiPresetSettings_ACU(): unknown {
  const first = getWorldSimulationFirstFloorMessage_ACU();
  if (!first || !Object.prototype.hasOwnProperty.call(first, WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU)) return undefined;
  try {
    return cloneJson_ACU(first[WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU]);
  } catch {
    return undefined;
  }
}

export function restoreCurrentWorldSimulationApiPresetSettings_ACU(snapshot: unknown): void {
  if (snapshot === undefined) return;
  const first = getWorldSimulationFirstFloorMessage_ACU();
  if (!first) return;
  if (snapshot === null) {
    delete first[WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU];
    return;
  }
  first[WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU] = snapshot;
}

export function mutateCurrentWorldSimulationApiPresetSettings_ACU(
  mutator: (settings: WorldSimulationEnvelope_ACU['settings']) => WorldSimulationEnvelope_ACU['settings'],
): boolean {
  const first = getWorldSimulationFirstFloorMessage_ACU();
  if (!first || !Object.prototype.hasOwnProperty.call(first, WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU)) return false;
  try {
    const envelope = validateWorldSimulationEnvelope_ACU(first[WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU]);
    const nextSettings = mutator(envelope.settings);
    if (nextSettings === envelope.settings) return false;
    first[WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU] = { ...envelope, settings: nextSettings };
    return true;
  } catch {
    return false;
  }
}

export async function persistCurrentWorldSimulationEnvelope_ACU(): Promise<void> {
  const first = getWorldSimulationFirstFloorMessage_ACU();
  if (!first || !Object.prototype.hasOwnProperty.call(first, WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU)) return;
  const store = new FirstFloorWorldSimulationStore_ACU();
  const current = store.readPersisted();
  if (!current) return;
  await store.replaceAtomically(current);
}
