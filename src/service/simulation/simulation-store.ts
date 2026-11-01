import { getChatArray_ACU, saveChatToHostStrict_ACU } from '../../data/gateways/chat-gateway';
import { getActiveChatStorageIdentity_ACU } from '../../data/storage/chat-history';
import { sha256HexSync_ACU } from '../../shared/sha256-sync';
import { buildDefaultWorldSimulationSettings_ACU } from './defaults';
import type { WorldChronicleArchiveDetail_ACU, WorldChronicleArchiveSnapshot_ACU, WorldSimulationAnchorIdentity_ACU, WorldSimulationBucket_ACU } from './agent/agent-model';
import { WORLD_SIMULATION_CHRONICLE_ARCHIVE_SCHEMA_VERSION_ACU } from './agent/agent-model';
import { validateWorldRoundPrompts_ACU } from './agent/world-round-prompts';
import {
  WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU,
  WORLD_CHRONICLE_OVERVIEW_CAP_ACU,
  WORLD_CHRONICLE_HOT_WINDOW_ACU,
  WORLD_LEDGER_SCHEMA_VERSION_ACU,
  WORLD_SIMULATION_SCHEMA_VERSION_ACU,
  WORLD_SIMULATION_LEDGER_MODULES_ACU,
  WORLD_SIMULATION_MATERIAL_COMPLETION_STATES_ACU,
  WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU,
  WORLD_SIMULATION_LEDGER_ACTOR_OPTIONAL_FIELDS_ACU,
  WORLD_SIMULATION_PENDING_FIX_SOURCES_ACU,
  WORLD_SIMULATION_PLAYER_REQUIRED_FIELDS_ACU,
  WORLD_GUIDANCE_SIGNAL_VOICES_ACU,
  WORLD_SEED_EXPOSE_POLICIES_ACU,
  WORLD_ACTOR_LIFE_ACU,
  WORLD_ACTOR_LEDGER_CAP_ACU,
  WORLD_RUMOR_STATUSES_ACU,
  WORLD_PLAYER_CONTACTS_ACU,
  WORLD_PLAYER_REGION_VISITS_CAP_ACU,
  WorldSimulationValidationError_ACU,
  createWorldSimulationError_ACU,
  normalizeWorldRegionName_ACU,
  type WorldSimulationEnvelope_ACU,
  type WorldSimulationErrorPhase_ACU,
  type WorldSimulationLedger_ACU,
  type WorldSimulationMaterialCompletionRecord_ACU,
  type WorldSimulationLogicalRef_ACU,
  type WorldSimulationPendingFix_ACU,
  type WorldSimulationWriteGuard_ACU,
  type WorldChronicleOverviewRow_ACU,
  type WorldGuidanceSignal_ACU,
  type WorldEvent_ACU,
  type WorldFact_ACU,
  type WorldHistoryMilestone_ACU,
  type WorldProjection_ACU,
  type WorldLegacyMigration_ACU,
  type WorldTime_ACU,
  type WorldNextCheck_ACU,
  type WorldLocationRef_ACU,
  type WorldPlayer_ACU,
  type WorldRumor_ACU,
  WORLD_SIMULATION_WEB_PROVIDERS_ACU,
} from './model';
import { WORLD_ACTOR_EXPERIENCE_CAP_ACU, WORLD_ACTOR_LONG_TERM_STATUSES_ACU, type WorldActorAction_ACU, type WorldActorExperience_ACU, type WorldActorLongTermAction_ACU } from './model';
import { assertWorldSimulationHostEnvelope_ACU, requireWorldSimulationHostAnchor_ACU, sameWorldSimulationTargetRef_ACU } from './simulation-identity';
import { worldSimulationProjectionTemplateError_ACU } from './simulation-projection';
import { WORLD_PROJECTION_MAX_DELIVERIES_ACU } from './world-projection-delivery';
import type { WorldRunMaterials_ACU } from './world-run-materials';

export { WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU } from './model';

const TASK_STATUSES_ACU = ['drafting', 'paused', 'running', 'stopping_after_inflight', 'completed', 'abandoned', 'failed'] as const;
const STAGE_STATUSES_ACU = ['planning', 'running', 'completed', 'abandoned', 'failed'] as const;
const REVISION_REASONS_ACU = ['initial', 'automatic_replan', 'manual_replan', 'resume_repair'] as const;
const TIMELINE_KINDS_ACU = ['task_created', 'plan_ready', 'stage_started', 'stage_completed', 'paused', 'resumed', 'stopped', 'committed', 'no_change', 'blocked', 'failed', 'swept', 'progressed'] as const;
const LEDGER_EXACT_KEYS_ACU = ['schemaVersion', 'revision', 'clock', 'dimensions', 'seeds', 'actors', 'worldEvents', 'facts', 'historyMilestones', 'projection', 'legacyMigration', 'chronicle', 'rumors', 'player', 'guidance', 'chronicleOverview', 'materialCompletion', 'pendingFixes'] as const;
const LEDGER_OPTIONAL_KEYS_ACU = ['historyArchive', 'factArchive', 'factArchiveRetention'] as const;
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

function validateSha256Digest_ACU(value: unknown, path: string, phase: WorldSimulationErrorPhase_ACU): string {
  const normalized = string_ACU(value, path, phase);
  if (!/^[a-f0-9]{64}$/.test(normalized)) fail_ACU(`${path} 必须是小写 SHA-256 哈希`, phase, { path });
  return normalized;
}

function validateWorldRunMaterials_ACU(raw: unknown, path: string, phase: WorldSimulationErrorPhase_ACU): WorldRunMaterials_ACU {
  if (!isRecord_ACU(raw)) fail_ACU(`${path} 必须是对象`, phase);
  if (Object.getOwnPropertySymbols(raw).length) fail_ACU(`${path} 存在 symbol 持久化字段`, phase, { path });
  exactKeys_ACU(raw, ['schemaVersion', 'instructionHash', 'requirementsHash', 'worldbookHash'], ['promptsHash'], path, phase);
  if (raw.schemaVersion !== 1) fail_ACU(`${path}.schemaVersion 必须为 1`, phase);
  return {
    schemaVersion: 1,
    instructionHash: validateSha256Digest_ACU(raw.instructionHash, `${path}.instructionHash`, phase),
    requirementsHash: validateSha256Digest_ACU(raw.requirementsHash, `${path}.requirementsHash`, phase),
    worldbookHash: validateSha256Digest_ACU(raw.worldbookHash, `${path}.worldbookHash`, phase),
    ...(raw.promptsHash === undefined ? {} : { promptsHash: validateSha256Digest_ACU(raw.promptsHash, `${path}.promptsHash`, phase) }),
  };
}

/** 仅校验引用形状；真实回合归属由 carrier Adapter 在同一写队列内核验。 */
export function validateWorldSimulationLogicalRef_ACU(raw: unknown, path: string, phase: WorldSimulationErrorPhase_ACU): WorldSimulationLogicalRef_ACU {
  if (!isRecord_ACU(raw)) fail_ACU(`${path} 必须是对象`, phase);
  exactKeys_ACU(raw, ['sessionId', 'branchId', 'turnId', 'attemptId', 'floorId'], [], path, phase);
  return {
    sessionId: string_ACU(raw.sessionId, `${path}.sessionId`, phase),
    branchId: string_ACU(raw.branchId, `${path}.branchId`, phase),
    turnId: string_ACU(raw.turnId, `${path}.turnId`, phase),
    attemptId: string_ACU(raw.attemptId, `${path}.attemptId`, phase),
    floorId: string_ACU(raw.floorId, `${path}.floorId`, phase),
  };
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

/** v6 人物时间线栏目与幕后纪要错过标记：读取时缺失按空值归一（不伪造时间），写入由派生层补齐。 */
const ACTOR_TIMELINE_KEYS_ACU: readonly string[] = ['currentAction', 'longTermAction', 'shortTermAction', 'simulationStatus', 'loreRefs', 'experiences'];
const ACTOR_BASE_KEYS_ACU: readonly string[] = WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU.actors.filter(key => !ACTOR_TIMELINE_KEYS_ACU.includes(key));
const CHRONICLE_OPTIONAL_KEYS_ACU: readonly string[] = ['missedNote'];
const CHRONICLE_BASE_KEYS_ACU: readonly string[] = WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU.chronicle.filter(key => !CHRONICLE_OPTIONAL_KEYS_ACU.includes(key));

function validateActorAction_ACU(value: unknown, path: string, phase: WorldSimulationErrorPhase_ACU): WorldActorAction_ACU | null {
  if (value === null || value === undefined) return null;
  if (!isRecord_ACU(value)) fail_ACU(`${path} 必须是对象或 null`, phase, { path });
  exactKeys_ACU(value, ['text', 'expectedDuration', 'startedAtDay', 'startedAt'], [], path, phase);
  return {
    text: string_ACU(value.text, `${path}.text`, phase),
    expectedDuration: string_ACU(value.expectedDuration, `${path}.expectedDuration`, phase, true),
    startedAtDay: nullableInteger_ACU(value.startedAtDay, `${path}.startedAtDay`, phase, 1),
    startedAt: string_ACU(value.startedAt, `${path}.startedAt`, phase, true),
  };
}

function sameActorAction_ACU(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown): string | undefined => JSON.stringify(value, (_, item) =>
    isRecord_ACU(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
  return canonical(left) === canonical(right);
}

function validateActorLongTermAction_ACU(value: unknown, path: string, phase: WorldSimulationErrorPhase_ACU): WorldActorLongTermAction_ACU | null {
  if (value === null || value === undefined) return null;
  if (!isRecord_ACU(value)) fail_ACU(`${path} 必须是对象或 null`, phase, { path });
  exactKeys_ACU(value, ['text', 'expectedDuration', 'startedAtDay', 'startedAt', 'status', 'outcome'], [], path, phase);
  const action = validateActorAction_ACU({ text: value.text, expectedDuration: value.expectedDuration, startedAtDay: value.startedAtDay, startedAt: value.startedAt }, path, phase)!;
  return {
    ...action,
    status: enum_ACU(value.status, WORLD_ACTOR_LONG_TERM_STATUSES_ACU, `${path}.status`, phase),
    outcome: nullableString_ACU(value.outcome, `${path}.outcome`, phase),
  };
}

function validateActorExperiences_ACU(value: unknown, path: string, phase: WorldSimulationErrorPhase_ACU): WorldActorExperience_ACU[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > WORLD_ACTOR_EXPERIENCE_CAP_ACU) fail_ACU(`${path} 必须是不超过 ${WORLD_ACTOR_EXPERIENCE_CAP_ACU} 条的数组`, phase, { path });
  return value.map((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord_ACU(item)) fail_ACU(`${itemPath} 必须是对象`, phase, { path: itemPath });
    exactKeys_ACU(item, ['text', 'expectedDuration', 'startedAtDay', 'startedAt', 'endedAtDay', 'endedAt', 'status', 'outcome'], [], itemPath, phase);
    return {
      text: string_ACU(item.text, `${itemPath}.text`, phase),
      expectedDuration: string_ACU(item.expectedDuration, `${itemPath}.expectedDuration`, phase, true),
      startedAtDay: nullableInteger_ACU(item.startedAtDay, `${itemPath}.startedAtDay`, phase, 1),
      startedAt: string_ACU(item.startedAt, `${itemPath}.startedAt`, phase, true),
      endedAtDay: integer_ACU(item.endedAtDay, `${itemPath}.endedAtDay`, phase, 1),
      endedAt: string_ACU(item.endedAt, `${itemPath}.endedAt`, phase, true),
      status: enum_ACU(item.status, ['done', 'abandoned'] as const, `${itemPath}.status`, phase),
      outcome: nullableString_ACU(item.outcome, `${itemPath}.outcome`, phase),
    };
  });
}

function validateActorTimelineFields_ACU(item: Record<string, unknown>, path: string, phase: WorldSimulationErrorPhase_ACU): Pick<import('./model').WorldActor_ACU, 'currentAction' | 'longTermAction' | 'experiences'> {
  return {
    currentAction: validateActorAction_ACU(item.currentAction, `${path}.currentAction`, phase),
    longTermAction: validateActorLongTermAction_ACU(item.longTermAction, `${path}.longTermAction`, phase),
    experiences: validateActorExperiences_ACU(item.experiences, `${path}.experiences`, phase),
  };
}

function validateChronicleMissedNote_ACU(value: unknown, path: string, phase: WorldSimulationErrorPhase_ACU): string | null {
  return value === undefined ? null : nullableString_ACU(value, path, phase);
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
    schemaVersion: 4,
    pendingFixes: Array.isArray(raw.pendingFixes) ? raw.pendingFixes : [],
  };
}

function migrateV4Ledger_ACU(raw: Record<string, unknown>): Record<string, unknown> {
  const pendingFixes = Array.isArray(raw.pendingFixes)
    ? raw.pendingFixes.map(item => isRecord_ACU(item) ? {
        ...item,
        source: WORLD_SIMULATION_PENDING_FIX_SOURCES_ACU.includes(item.source as any) ? item.source : 'transaction_rejected',
        completion: item.completion === 'partial' || item.completion === 'failed' ? item.completion : 'failed',
        acceptedKeys: Array.isArray(item.acceptedKeys) ? item.acceptedKeys : [],
        anchor: item.anchor === undefined ? null : item.anchor,
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : 0,
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : 0,
      } : item)
    : [];
  return {
    ...raw,
    schemaVersion: 5,
    materialCompletion: isRecord_ACU(raw.materialCompletion)
      ? raw.materialCompletion
      : { state: 'legacy_unknown', expectedModules: [], modules: {}, sourceRunId: '', updatedAt: 0 },
    pendingFixes,
  };
}

function migrateV5Ledger_ACU(raw: Record<string, unknown>): Record<string, unknown> {
  // v6：人物补齐短期/长期行为与经历，幕后纪要补齐主角错过标记；旧值一律缺省为空，不伪造时间。
  const fill = (item: unknown, extras: Record<string, unknown>): unknown => isRecord_ACU(item) ? { ...item, ...Object.fromEntries(Object.entries(extras).filter(([key]) => !Object.prototype.hasOwnProperty.call(item, key))) } : item;
  return {
    ...raw,
    schemaVersion: 6,
    actors: Array.isArray(raw.actors) ? raw.actors.map(item => fill(item, { currentAction: null, longTermAction: null, experiences: [] })) : raw.actors,
    chronicle: Array.isArray(raw.chronicle) ? raw.chronicle.map(item => fill(item, { missedNote: null })) : raw.chronicle,
  };
}

function migrateV6Ledger_ACU(raw: Record<string, unknown>, phase: WorldSimulationErrorPhase_ACU): Record<string, unknown> {
  // 旧业务资料保留原样；不把局势、引信、建议或未经核实的纪要伪装为确定事实。
  for (const key of ['worldEvents', 'facts', 'factArchive', 'factArchiveRetention', 'historyMilestones', 'historyArchive', 'projection', 'legacyMigration']) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) fail_ACU(`v6 ledger 存在未知持久化字段：${key}`, phase);
  }
  const actors = Array.isArray(raw.actors) ? raw.actors.map((item, index) => {
    if (!isRecord_ACU(item)) return item;
    for (const key of ['shortTermAction', 'simulationStatus', 'loreRefs']) {
      if (Object.prototype.hasOwnProperty.call(item, key)) fail_ACU(`v6 ledger.actors[${index}] 存在未知持久化字段：${key}`, phase);
    }
    return {
      ...item,
      shortTermAction: item.longTermAction === undefined ? null : structuredClone(item.longTermAction),
      simulationStatus: 'active',
      loreRefs: [],
    };
  }) : raw.actors;
  const facts: WorldFact_ACU[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw.actors)) {
    for (const [actorIndex, actor] of raw.actors.entries()) {
      if (!isRecord_ACU(actor) || !Array.isArray(actor.experiences)) continue;
      const actorId = stableId_ACU(actor.id, `ledger.actors[${actorIndex}].id`, phase);
      for (const [experienceIndex, experience] of actor.experiences.entries()) {
        const path = `ledger.actors[${actorIndex}].experiences[${experienceIndex}]`;
        if (!isRecord_ACU(experience)) fail_ACU(`${path} 必须是对象`, phase);
        const status = enum_ACU(experience.status, ['done', 'abandoned'] as const, `${path}.status`, phase);
        const text = string_ACU(experience.text, `${path}.text`, phase);
        const endedAtDay = integer_ACU(experience.endedAtDay, `${path}.endedAtDay`, phase, 1);
        const outcome = experience.outcome === null ? null : string_ACU(experience.outcome, `${path}.outcome`, phase);
        const fingerprint = sha256HexSync_ACU(JSON.stringify([
          actorId, text, experience.expectedDuration, experience.startedAtDay, experience.startedAt,
          endedAtDay, experience.endedAt, status, outcome,
        ]));
        if (seen.has(fingerprint)) continue;
        seen.add(fingerprint);
        facts.push({
          id: `legacy-exp-${fingerprint.slice(0, 32)}`,
          summary: `${status === 'done' ? '完成' : '放弃'}阶段事务：${text}${outcome ? `；结果：${outcome}` : ''}`,
          temporalKind: 'occurrence', happenedAt: { day: endedAtDay, slot: '' },
          validFrom: null, validUntil: null, locationRef: null, actorIds: [actorId], worldEventIds: [],
          projectionPolicy: 'internal', revealState: 'locked', revealGate: null, nextCheck: null,
          sourceRefs: [`legacy:actors:${actorId}:experiences:${fingerprint}`], evidenceRefs: [],
          supersedesFactIds: [], revision: 0,
        });
      }
    }
  }
  const issues: WorldLegacyMigration_ACU['issues'] = [];
  const historyMilestones: WorldHistoryMilestone_ACU[] = [];
  const addIssue = (source: WorldLegacyMigration_ACU['issues'][number]['source'], sourceId: string,
    reason: WorldLegacyMigration_ACU['issues'][number]['reason']): void => { issues.push({ source, sourceId, reason }); };
  const clockRaw = isRecord_ACU(raw.clock) ? raw.clock : fail_ACU('ledger.clock 必须是对象', phase);
  const migrationClock: WorldTime_ACU = {
    day: integer_ACU(clockRaw.day, 'ledger.clock.day', phase, 1),
    slot: string_ACU(clockRaw.slot, 'ledger.clock.slot', phase, true),
  };
  const activeNextCheck = (): WorldNextCheck_ACU => ({
    ...migrationClock,
    // 这是迁移后的调度时点，不是对旧事件发生时间的补写。
    reason: '旧资料迁移后复核',
  });
  const legacyEventId = (source: 'dimension' | 'seed', sourceId: string): string =>
    `legacy-${source}-${sha256HexSync_ACU(sourceId).slice(0, 32)}`;
  const sourceTargets = new Map<string, Array<{ kind: 'actor' | 'event'; id: string }>>();
  const addSourceTarget = (sourceId: string, target: { kind: 'actor' | 'event'; id: string }): void => {
    const targets = sourceTargets.get(sourceId) ?? [];
    targets.push(target);
    sourceTargets.set(sourceId, targets);
  };
  if (Array.isArray(raw.actors)) raw.actors.forEach((actor, index) => {
    if (!isRecord_ACU(actor)) return;
    const actorId = stableId_ACU(actor.id, `ledger.actors[${index}].id`, phase);
    addSourceTarget(actorId, { kind: 'actor', id: actorId });
  });
  const worldEvents: WorldEvent_ACU[] = [];
  if (Array.isArray(raw.dimensions)) raw.dimensions.forEach((item, index) => {
    if (!isRecord_ACU(item)) return;
    const path = `ledger.dimensions[${index}]`;
    const sourceId = stableId_ACU(item.id, `${path}.id`, phase);
    enum_ACU(item.kind, ['pressure', 'growth'] as const, `${path}.kind`, phase);
    const rationale = string_ACU(item.rationale, `${path}.rationale`, phase, true);
    const eventId = legacyEventId('dimension', sourceId);
    worldEvents.push({
      id: eventId,
      title: string_ACU(item.name, `${path}.name`, phase),
      state: rationale || '旧局势待复核',
      status: 'active',
      actorIds: [], organizationIds: [], locationRefs: [], startedAt: null, deadline: null,
      nextCheck: activeNextCheck(), relatedEventIds: [], loreRefs: [],
      evidenceRefs: stringArray_ACU(item.evidenceRefs, `${path}.evidenceRefs`, phase), tags: [],
      revision: integer_ACU(item.revision, `${path}.revision`, phase),
      legacy: { source: 'dimension', sourceId, payload: structuredClone(item) },
    });
    addSourceTarget(sourceId, { kind: 'event', id: eventId });
  });
  if (Array.isArray(raw.seeds)) raw.seeds.forEach((item, index) => {
    if (!isRecord_ACU(item)) return;
    const path = `ledger.seeds[${index}]`;
    const sourceId = stableId_ACU(item.id, `${path}.id`, phase);
    const legacyStatus = enum_ACU(item.status, ['established', 'incubating', 'active', 'converging', 'resolved', 'retired'] as const, `${path}.status`, phase);
    const catalyst = string_ACU(item.catalyst, `${path}.catalyst`, phase, true);
    const eventId = legacyEventId('seed', sourceId);
    const status = legacyStatus === 'established' || legacyStatus === 'incubating' ? 'scheduled'
      : legacyStatus === 'active' || legacyStatus === 'converging' ? 'active'
        : legacyStatus === 'resolved' ? 'resolved' : 'cancelled';
    const location = validateLocationRef_ACU(item.location, `${path}.location`, phase);
    worldEvents.push({
      id: eventId,
      title: string_ACU(item.title, `${path}.title`, phase),
      state: catalyst || '旧引信待复核',
      status,
      actorIds: stringArray_ACU(item.actorIds, `${path}.actorIds`, phase), organizationIds: [],
      locationRefs: location === null ? [] : [location], startedAt: null,
      deadline: nullableInteger_ACU(item.expiresAtDay, `${path}.expiresAtDay`, phase, 1) === null
        ? null : { day: item.expiresAtDay as number, slot: '' },
      nextCheck: status === 'resolved' || status === 'cancelled' ? null : activeNextCheck(),
      relatedEventIds: [], loreRefs: [], evidenceRefs: stringArray_ACU(item.evidenceRefs, `${path}.evidenceRefs`, phase), tags: [],
      revision: integer_ACU(item.revision, `${path}.revision`, phase),
      legacy: { source: 'seed', sourceId, payload: structuredClone(item) },
    });
    addSourceTarget(sourceId, { kind: 'event', id: eventId });
  });
  if (Array.isArray(raw.chronicle)) raw.chronicle.forEach((item, index) => {
    if (!isRecord_ACU(item)) return;
    const path = `ledger.chronicle[${index}]`;
    const id = stableId_ACU(item.id, `${path}.id`, phase);
    const at = typeof item.at === 'string' ? item.at : '';
    const dayMatch = at.match(/^(?:第([1-9]\d*)日|d([1-9]\d*))$/);
    const day = dayMatch && dayMatch[0] === at ? Number(dayMatch[1] ?? dayMatch[2]) : NaN;
    const summary = typeof item.summary === 'string' && item.summary.trim() ? item.summary : null;
    const evidenceRefs = Array.isArray(item.evidenceRefs) && item.evidenceRefs.length > 0
      && item.evidenceRefs.every(ref => typeof ref === 'string' && ref.trim()) ? item.evidenceRefs as string[] : null;
    const relatedIds = Array.isArray(item.relatedIds) && item.relatedIds.every(ref => typeof ref === 'string')
      ? item.relatedIds as string[] : null;
    const targetsByRelatedId = relatedIds?.map(ref => sourceTargets.get(ref) ?? []) ?? [];
    const mappedTargets = targetsByRelatedId.flat();
    const linkedActorIds = [...new Set(mappedTargets.filter((target): target is { kind: 'actor'; id: string } => target.kind === 'actor').map(target => target.id))];
    const linkedEventIds = [...new Set(mappedTargets.filter((target): target is { kind: 'event'; id: string } => target.kind === 'event').map(target => target.id))];
    const unresolvedRelatedIds = relatedIds?.filter((_, relatedIndex) => targetsByRelatedId[relatedIndex].length === 0) ?? [];
    const ambiguousRelatedIds = relatedIds?.filter((_, relatedIndex) => targetsByRelatedId[relatedIndex].length > 1) ?? [];
    const important = typeof item.missedNote === 'string' && !!item.missedNote.trim();
    const canMigrate = important && Number.isSafeInteger(day) && day >= 1 && day <= migrationClock.day
      && summary !== null && evidenceRefs !== null && (linkedActorIds.length + linkedEventIds.length) > 0;
    if (canMigrate) {
      const fingerprint = sha256HexSync_ACU(JSON.stringify([id, at, summary, relatedIds, evidenceRefs, item.missedNote]));
      historyMilestones.push({
        id: `legacy-history-${fingerprint.slice(0, 32)}`, summary, happenedAt: { day, slot: '' }, actorIds: linkedActorIds,
        worldEventIds: linkedEventIds, locationRef: null, sourceFactIds: [], importance: 1, category: '旧重要纪要',
        visibility: 'internal', revision: 0,
        legacyRefs: [
          `legacy:chronicle:${id}`,
          ...unresolvedRelatedIds.map(ref => `legacy:chronicle:${id}:related:${ref}`),
          ...ambiguousRelatedIds.map(ref => `legacy:chronicle:${id}:ambiguous-related:${ref}`),
        ],
      });
    }
    if (!canMigrate || unresolvedRelatedIds.length || ambiguousRelatedIds.length) {
      addIssue('chronicle', id,
        /^第[一二三四五六七八九十百千万\d]+日(?:$|[·\s])|^d\d+$/u.test(String(item.at)) ? 'requires_review' : 'unparseable_time');
    }
  });
  if (Array.isArray(raw.rumors)) raw.rumors.forEach((item, index) => {
    if (isRecord_ACU(item)) addIssue('rumor', stableId_ACU(item.id, `ledger.rumors[${index}].id`, phase), 'missing_evidence');
  });
  if (Array.isArray(raw.chronicleOverview)) raw.chronicleOverview.forEach((item, index) => {
    if (isRecord_ACU(item)) addIssue('chronicleArchive', stableId_ACU(item.archiveRef, `ledger.chronicleOverview[${index}].archiveRef`, phase), 'archive_detail_unavailable');
  });
  return {
    ...raw,
    schemaVersion: WORLD_LEDGER_SCHEMA_VERSION_ACU,
    actors,
    worldEvents,
    facts,
    historyMilestones,
    projection: { anchor: null, deliveries: [] },
    legacyMigration: { issues },
  };
}

function migrateLedgerToCurrent_ACU(raw: Record<string, unknown>, phase: WorldSimulationErrorPhase_ACU): Record<string, unknown> {
  let current = raw;
  if (current.schemaVersion === 1) current = migrateV1Ledger_ACU(current);
  if (current.schemaVersion === 2) current = migrateV2Ledger_ACU(current);
  if (current.schemaVersion === 3) current = migrateV3Ledger_ACU(current);
  if (current.schemaVersion === 4) current = migrateV4Ledger_ACU(current);
  if (current.schemaVersion === 5) current = migrateV5Ledger_ACU(current);
  if (current.schemaVersion === 6) current = migrateV6Ledger_ACU(current, phase);
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
    exactKeys_ACU(item, ['module', 'candidateId', 'agentName', 'violations', 'attempts', 'firstFailedAtDay', 'lastError', 'source', 'completion', 'acceptedKeys', 'anchor', 'createdAt', 'updatedAt'], [], path, phase);
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
    let anchor: WorldSimulationPendingFix_ACU['anchor'] = null;
    if (item.anchor !== null) {
      if (!isRecord_ACU(item.anchor)) fail_ACU(`${path}.anchor 必须是对象或 null`, phase);
      if (Object.prototype.hasOwnProperty.call(item.anchor, 'logicalRef')) {
        exactKeys_ACU(item.anchor, ['logicalRef', 'contentDigest', 'baseLedgerRevision'], [], `${path}.anchor`, phase);
        anchor = {
          logicalRef: validateWorldSimulationLogicalRef_ACU(item.anchor.logicalRef, `${path}.anchor.logicalRef`, phase),
          contentDigest: string_ACU(item.anchor.contentDigest, `${path}.anchor.contentDigest`, phase),
          baseLedgerRevision: integer_ACU(item.anchor.baseLedgerRevision, `${path}.anchor.baseLedgerRevision`, phase),
        };
      } else {
        exactKeys_ACU(item.anchor, ['messageKey', 'swipeId', 'contentDigest', 'baseLedgerRevision'], [], `${path}.anchor`, phase);
        anchor = {
          messageKey: string_ACU(item.anchor.messageKey, `${path}.anchor.messageKey`, phase),
          swipeId: string_ACU(item.anchor.swipeId, `${path}.anchor.swipeId`, phase),
          contentDigest: string_ACU(item.anchor.contentDigest, `${path}.anchor.contentDigest`, phase),
          baseLedgerRevision: integer_ACU(item.anchor.baseLedgerRevision, `${path}.anchor.baseLedgerRevision`, phase),
        };
      }
    }
    const createdAt = integer_ACU(item.createdAt, `${path}.createdAt`, phase);
    const updatedAt = integer_ACU(item.updatedAt, `${path}.updatedAt`, phase);
    if (updatedAt < createdAt) fail_ACU(`${path}.updatedAt 不能早于 createdAt`, phase);
    return {
      module: enum_ACU(item.module, WORLD_SIMULATION_LEDGER_MODULES_ACU, `${path}.module`, phase),
      candidateId: string_ACU(item.candidateId, `${path}.candidateId`, phase, true),
      agentName: string_ACU(item.agentName, `${path}.agentName`, phase),
      violations,
      attempts: integer_ACU(item.attempts, `${path}.attempts`, phase, 0, 100),
      firstFailedAtDay: integer_ACU(item.firstFailedAtDay, `${path}.firstFailedAtDay`, phase, 1),
      lastError: string_ACU(item.lastError, `${path}.lastError`, phase, true),
      source: enum_ACU(item.source, WORLD_SIMULATION_PENDING_FIX_SOURCES_ACU, `${path}.source`, phase),
      completion: enum_ACU(item.completion, ['partial', 'failed'] as const, `${path}.completion`, phase),
      acceptedKeys: stringArray_ACU(item.acceptedKeys, `${path}.acceptedKeys`, phase),
      anchor,
      createdAt,
      updatedAt,
    };
  });
}

function validateMaterialCompletion_ACU(raw: unknown, phase: WorldSimulationErrorPhase_ACU): WorldSimulationMaterialCompletionRecord_ACU {
  if (!isRecord_ACU(raw)) fail_ACU('ledger.materialCompletion 必须是对象', phase);
  exactKeys_ACU(raw, ['state', 'expectedModules', 'modules', 'sourceRunId', 'updatedAt'], [], 'ledger.materialCompletion', phase);
  if (!Array.isArray(raw.expectedModules)) fail_ACU('ledger.materialCompletion.expectedModules 必须是数组', phase);
  const expectedModules = raw.expectedModules.map((module, index) =>
    enum_ACU(module, WORLD_SIMULATION_LEDGER_MODULES_ACU, `ledger.materialCompletion.expectedModules[${index}]`, phase));
  if (new Set(expectedModules).size !== expectedModules.length) fail_ACU('ledger.materialCompletion.expectedModules 存在重复模块', phase);
  if (!isRecord_ACU(raw.modules)) fail_ACU('ledger.materialCompletion.modules 必须是对象', phase);
  const modules: WorldSimulationMaterialCompletionRecord_ACU['modules'] = {};
  for (const [module, state] of Object.entries(raw.modules)) {
    const validatedModule = enum_ACU(module, WORLD_SIMULATION_LEDGER_MODULES_ACU, `ledger.materialCompletion.modules.${module}`, phase);
    modules[validatedModule] = enum_ACU(state, WORLD_SIMULATION_MATERIAL_COMPLETION_STATES_ACU, `ledger.materialCompletion.modules.${module}`, phase);
  }
  return {
    state: enum_ACU(raw.state, WORLD_SIMULATION_MATERIAL_COMPLETION_STATES_ACU, 'ledger.materialCompletion.state', phase),
    expectedModules,
    modules,
    sourceRunId: string_ACU(raw.sourceRunId, 'ledger.materialCompletion.sourceRunId', phase, true),
    updatedAt: integer_ACU(raw.updatedAt, 'ledger.materialCompletion.updatedAt', phase),
  };
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
  exactKeys_ACU(raw, ['autoTriggerEnabled', 'agentHistoryTokenBudget', 'agentReadTokenBudget', 'agentReadFallbackTokens', 'agentRunBudget', 'apiPresetMode', 'fixedApiPresetName', 'agentApiPresets'], ['agentPrompts', 'webResearch', 'promptForceDefaultVersion', 'planPreview', 'dynamics', 'workflow', 'projection', 'deliveryTarget', 'workflowMode', 'worldRoundPrompts', 'contentSafetyPromptBackup'], 'settings', phase);
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
  if (!isRecord_ACU(raw.agentApiPresets)) fail_ACU('settings.agentApiPresets 必须是对象', phase);
  // 历史提示词字段仅兼容输入；新读取与持久化都不再重建或保留退役正文。
  const agentPrompts: WorldSimulationEnvelope_ACU['settings']['agentPrompts'] = {};
  const agentApiPresets: WorldSimulationEnvelope_ACU['settings']['agentApiPresets'] = {};
  for (const [key, value] of Object.entries(raw.agentApiPresets)) {
    // 退役角色不再公开配置；旧运行仍由运行时兼容路径处理。
    if (key === 'requirements-maintainer' || key === 'chronicler' || key === 'world-stage-planner') continue;
    stableId_ACU(key, `settings.agentApiPresets.${key}`, phase);
    if (!isRecord_ACU(value)) fail_ACU(`settings.agentApiPresets.${key} 必须是对象`, phase);
    exactKeys_ACU(value, ['mode', 'presetName'], [], `settings.agentApiPresets.${key}`, phase);
    agentApiPresets[key] = { mode: enum_ACU(value.mode, ['current', 'fixed'] as const, `settings.agentApiPresets.${key}.mode`, phase), presetName: string_ACU(value.presetName, `settings.agentApiPresets.${key}.presetName`, phase, true) };
  }
  // 整轮角色提示词独立持久化，不使用旧 prompt 版本或 agentPrompts 迁移规则。
  const validatedWorldRoundPrompts = raw.worldRoundPrompts === undefined
    ? undefined
    : validateWorldRoundPrompts_ACU(raw.worldRoundPrompts, phase);
  const worldRoundPrompts = validatedWorldRoundPrompts === undefined ? undefined
    : Object.fromEntries(Object.entries(validatedWorldRoundPrompts).filter(([role]) =>
      ['clock-recaller', 'world-simulator', 'world-event-analyst', 'actor-simulator', 'joint-reviewer'].includes(role))) as typeof validatedWorldRoundPrompts;
  if (raw.contentSafetyPromptBackup !== undefined && typeof raw.contentSafetyPromptBackup !== 'string') {
    fail_ACU('settings.contentSafetyPromptBackup 必须是字符串', phase);
  }
  // 本版不再读取 agentPrompts；存档里确有旧提示词时，丢弃前先留存原文。
  const contentSafetyPromptBackup = raw.contentSafetyPromptBackup ?? (
    isRecord_ACU(raw.agentPrompts) && Object.keys(raw.agentPrompts).length
      ? JSON.stringify({ previousVersion: raw.promptForceDefaultVersion, agentPrompts: raw.agentPrompts })
      : undefined
  );
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
      const chroniclerHotThreshold = Number.isInteger(raw.workflow.chroniclerHotThreshold)
        && (raw.workflow.chroniclerHotThreshold as number) >= 1
        && (raw.workflow.chroniclerHotThreshold as number) <= WORLD_CHRONICLE_OVERVIEW_CAP_ACU
        ? raw.workflow.chroniclerHotThreshold as number
        : defaultWorkflow.chroniclerHotThreshold;
      workflow = { chroniclerHotThreshold };
    }
  }
  // 插入格式晚于其它设置加入：缺键或格式不合法时回默认，不拒绝整包。
  const rawProjection = isRecord_ACU(raw.projection) ? raw.projection : {};
  const projection = {
    template: worldSimulationProjectionTemplateError_ACU(rawProjection.template)
      ? buildDefaultWorldSimulationSettings_ACU().projection.template
      : rawProjection.template as string,
  };
  return {
    autoTriggerEnabled: boolean_ACU(raw.autoTriggerEnabled, 'settings.autoTriggerEnabled', phase),
    deliveryTarget: raw.deliveryTarget === undefined ? 'body' : enum_ACU(raw.deliveryTarget, ['body', 'plot'] as const, 'settings.deliveryTarget', phase),
    workflowMode: raw.workflowMode === undefined ? 'layered' : enum_ACU(raw.workflowMode, ['single', 'layered'] as const, 'settings.workflowMode', phase),
    agentHistoryTokenBudget: integer_ACU(raw.agentHistoryTokenBudget, 'settings.agentHistoryTokenBudget', phase, 0, 1000000),
    agentReadTokenBudget: readBudget,
    agentReadFallbackTokens: integer_ACU(raw.agentReadFallbackTokens, 'settings.agentReadFallbackTokens', phase, 0, 100000),
    agentRunBudget: budget,
    webResearch,
    apiPresetMode: enum_ACU(raw.apiPresetMode, ['current', 'fixed'] as const, 'settings.apiPresetMode', phase),
    fixedApiPresetName: string_ACU(raw.fixedApiPresetName, 'settings.fixedApiPresetName', phase, true),
    agentApiPresets,
    agentPrompts,
    ...(worldRoundPrompts === undefined ? {} : { worldRoundPrompts }),
    ...(contentSafetyPromptBackup !== undefined ? { contentSafetyPromptBackup: contentSafetyPromptBackup as string } : {}),
    dynamics,
    workflow,
    projection,
  };
}

function validateWorldTime_ACU(value: unknown, path: string, phase: WorldSimulationErrorPhase_ACU): WorldTime_ACU {
  if (!isRecord_ACU(value)) fail_ACU(`${path} 必须是对象`, phase);
  exactKeys_ACU(value, ['day', 'slot'], [], path, phase);
  return { day: integer_ACU(value.day, `${path}.day`, phase, 1), slot: string_ACU(value.slot, `${path}.slot`, phase, true) };
}

function validateNextCheck_ACU(value: unknown, path: string, phase: WorldSimulationErrorPhase_ACU): WorldNextCheck_ACU | null {
  if (value === null) return null;
  if (!isRecord_ACU(value)) fail_ACU(`${path} 必须是对象或 null`, phase);
  exactKeys_ACU(value, ['day', 'slot', 'reason'], [], path, phase);
  return { ...validateWorldTime_ACU({ day: value.day, slot: value.slot }, path, phase), reason: string_ACU(value.reason, `${path}.reason`, phase) };
}

function validateWorldEvents_ACU(raw: unknown, phase: WorldSimulationErrorPhase_ACU): WorldEvent_ACU[] {
  if (!Array.isArray(raw)) fail_ACU('ledger.worldEvents 必须是数组', phase);
  const rows = raw.map((item, index): WorldEvent_ACU => {
    const path = `ledger.worldEvents[${index}]`;
    if (!isRecord_ACU(item)) fail_ACU(`${path} 必须是对象`, phase);
    exactKeys_ACU(item, ['id', 'title', 'state', 'status', 'actorIds', 'organizationIds', 'locationRefs', 'startedAt', 'deadline', 'nextCheck', 'relatedEventIds', 'loreRefs', 'evidenceRefs', 'tags', 'revision', 'legacy'], [], path, phase);
    if (!Array.isArray(item.locationRefs)) fail_ACU(`${path}.locationRefs 必须是数组`, phase);
    if (item.legacy !== null && !isRecord_ACU(item.legacy)) fail_ACU(`${path}.legacy 必须是对象或 null`, phase);
    return {
      id: stableId_ACU(item.id, `${path}.id`, phase), title: string_ACU(item.title, `${path}.title`, phase),
      state: string_ACU(item.state, `${path}.state`, phase), status: enum_ACU(item.status, ['scheduled', 'active', 'paused', 'resolved', 'cancelled'] as const, `${path}.status`, phase),
      actorIds: stringArray_ACU(item.actorIds, `${path}.actorIds`, phase), organizationIds: stringArray_ACU(item.organizationIds, `${path}.organizationIds`, phase),
      locationRefs: item.locationRefs.map((location, locationIndex) => {
        const ref = validateLocationRef_ACU(location, `${path}.locationRefs[${locationIndex}]`, phase);
        if (!ref) fail_ACU(`${path}.locationRefs[${locationIndex}] 不能为 null`, phase);
        return ref;
      }),
      startedAt: item.startedAt === null ? null : validateWorldTime_ACU(item.startedAt, `${path}.startedAt`, phase),
      deadline: item.deadline === null ? null : validateWorldTime_ACU(item.deadline, `${path}.deadline`, phase),
      nextCheck: validateNextCheck_ACU(item.nextCheck, `${path}.nextCheck`, phase),
      relatedEventIds: stringArray_ACU(item.relatedEventIds, `${path}.relatedEventIds`, phase),
      loreRefs: stringArray_ACU(item.loreRefs, `${path}.loreRefs`, phase), evidenceRefs: stringArray_ACU(item.evidenceRefs, `${path}.evidenceRefs`, phase),
      tags: stringArray_ACU(item.tags, `${path}.tags`, phase), revision: integer_ACU(item.revision, `${path}.revision`, phase),
      legacy: item.legacy === null ? null : { ...item.legacy as Record<string, unknown> },
    };
  });
  uniqueIds_ACU(rows, 'ledger.worldEvents', phase);
  return rows;
}

function validateFacts_ACU(raw: unknown, phase: WorldSimulationErrorPhase_ACU, collectionPath = 'ledger.facts'): WorldFact_ACU[] {
  if (!Array.isArray(raw)) fail_ACU(`${collectionPath} 必须是数组`, phase);
  const rows = raw.map((item, index): WorldFact_ACU => {
    const path = `${collectionPath}[${index}]`;
    if (!isRecord_ACU(item)) fail_ACU(`${path} 必须是对象`, phase);
    exactKeys_ACU(item, ['id', 'summary', 'temporalKind', 'happenedAt', 'validFrom', 'validUntil', 'locationRef', 'actorIds', 'worldEventIds', 'projectionPolicy', 'revealState', 'revealGate', 'nextCheck', 'sourceRefs', 'evidenceRefs', 'supersedesFactIds', 'revision'], [], path, phase);
    if (item.revealGate !== null && !isRecord_ACU(item.revealGate)) fail_ACU(`${path}.revealGate 必须是对象或 null`, phase);
    const temporalKind = enum_ACU(item.temporalKind, ['occurrence', 'condition'] as const, `${path}.temporalKind`, phase);
    const happenedAt = item.happenedAt === null ? null : validateWorldTime_ACU(item.happenedAt, `${path}.happenedAt`, phase);
    const validFrom = item.validFrom === null ? null : validateWorldTime_ACU(item.validFrom, `${path}.validFrom`, phase);
    const validUntil = item.validUntil === null ? null : validateWorldTime_ACU(item.validUntil, `${path}.validUntil`, phase);
    const nextCheck = validateNextCheck_ACU(item.nextCheck, `${path}.nextCheck`, phase);
    if (temporalKind === 'occurrence' ? !happenedAt || validFrom || validUntil : happenedAt || !validFrom || (!validUntil && !nextCheck)) {
      fail_ACU(`${path} 时间形态非法`, phase);
    }
    return {
      id: stableId_ACU(item.id, `${path}.id`, phase), summary: string_ACU(item.summary, `${path}.summary`, phase),
      temporalKind, happenedAt, validFrom, validUntil,
      locationRef: validateLocationRef_ACU(item.locationRef, `${path}.locationRef`, phase),
      actorIds: stringArray_ACU(item.actorIds, `${path}.actorIds`, phase), worldEventIds: stringArray_ACU(item.worldEventIds, `${path}.worldEventIds`, phase),
      projectionPolicy: enum_ACU(item.projectionPolicy, ['scene', 'gated', 'internal'] as const, `${path}.projectionPolicy`, phase),
      revealState: enum_ACU(item.revealState, ['locked', 'unlocked'] as const, `${path}.revealState`, phase),
      revealGate: item.revealGate === null ? null : { ...item.revealGate as Record<string, unknown> }, nextCheck,
      sourceRefs: stringArray_ACU(item.sourceRefs, `${path}.sourceRefs`, phase), evidenceRefs: stringArray_ACU(item.evidenceRefs, `${path}.evidenceRefs`, phase),
      supersedesFactIds: stringArray_ACU(item.supersedesFactIds, `${path}.supersedesFactIds`, phase), revision: integer_ACU(item.revision, `${path}.revision`, phase),
    };
  });
  uniqueIds_ACU(rows, collectionPath, phase);
  return rows;
}

function validateFactArchiveRetention_ACU(raw: unknown, coldFactIds: ReadonlySet<string>, phase: WorldSimulationErrorPhase_ACU): NonNullable<WorldSimulationLedger_ACU['factArchiveRetention']> {
  const path = 'ledger.factArchiveRetention';
  if (!isRecord_ACU(raw) || (Object.getPrototypeOf(raw) !== Object.prototype && Object.getPrototypeOf(raw) !== null)) fail_ACU(`${path} 必须是普通对象`, phase, { path });
  if (Object.getOwnPropertySymbols(raw).length) fail_ACU(`${path} 存在 symbol 持久化字段`, phase, { path });
  exactKeys_ACU(raw, ['completedRounds', 'enteredAtRound'], [], path, phase);
  const completedRounds = integer_ACU(raw.completedRounds, `${path}.completedRounds`, phase);
  const enteredRaw = raw.enteredAtRound;
  if (!isRecord_ACU(enteredRaw) || (Object.getPrototypeOf(enteredRaw) !== Object.prototype && Object.getPrototypeOf(enteredRaw) !== null)) {
    fail_ACU(`${path}.enteredAtRound 必须是普通对象`, phase, { path: `${path}.enteredAtRound` });
  }
  if (Object.getOwnPropertySymbols(enteredRaw).length) fail_ACU(`${path}.enteredAtRound 存在 symbol 持久化字段`, phase, { path: `${path}.enteredAtRound` });
  const enteredAtRound: Record<string, number> = {};
  for (const [id, round] of Object.entries(enteredRaw)) {
    if (!coldFactIds.has(id)) fail_ACU(`${path}.enteredAtRound 引用了不存在的冷事实 ${id}`, phase, { path: `${path}.enteredAtRound.${id}`, id });
    enteredAtRound[id] = integer_ACU(round, `${path}.enteredAtRound.${id}`, phase, 0, completedRounds);
  }
  return { completedRounds, enteredAtRound };
}

function validateHistoryMilestones_ACU(raw: unknown, phase: WorldSimulationErrorPhase_ACU): WorldHistoryMilestone_ACU[] {
  if (!Array.isArray(raw)) fail_ACU('ledger.historyMilestones 必须是数组', phase);
  const rows = raw.map((item, index): WorldHistoryMilestone_ACU => {
    const path = `ledger.historyMilestones[${index}]`;
    if (!isRecord_ACU(item)) fail_ACU(`${path} 必须是对象`, phase);
    exactKeys_ACU(item, ['id', 'summary', 'happenedAt', 'actorIds', 'worldEventIds', 'locationRef', 'sourceFactIds', 'importance', 'category', 'visibility', 'revision', 'legacyRefs'], ['narrativeRecord'], path, phase);
    let narrativeRecord: WorldHistoryMilestone_ACU['narrativeRecord'];
    if (Object.prototype.hasOwnProperty.call(item, 'narrativeRecord')) {
      const recordPath = `${path}.narrativeRecord`;
      const record = item.narrativeRecord;
      if (!isRecord_ACU(record)) fail_ACU(`${recordPath} 必须是对象`, phase);
      exactKeys_ACU(record, ['status', 'recordedAt', 'anchorDigest', 'deliveryQuote', 'evidenceQuote'], [], recordPath, phase);
      narrativeRecord = {
        status: enum_ACU(record.status, ['recorded'] as const, `${recordPath}.status`, phase),
        recordedAt: validateWorldTime_ACU(record.recordedAt, `${recordPath}.recordedAt`, phase),
        anchorDigest: validateSha256Digest_ACU(record.anchorDigest, `${recordPath}.anchorDigest`, phase),
        deliveryQuote: string_ACU(record.deliveryQuote, `${recordPath}.deliveryQuote`, phase),
        evidenceQuote: string_ACU(record.evidenceQuote, `${recordPath}.evidenceQuote`, phase),
      };
    }
    return {
      id: stableId_ACU(item.id, `${path}.id`, phase), summary: string_ACU(item.summary, `${path}.summary`, phase),
      happenedAt: validateWorldTime_ACU(item.happenedAt, `${path}.happenedAt`, phase),
      actorIds: stringArray_ACU(item.actorIds, `${path}.actorIds`, phase), worldEventIds: stringArray_ACU(item.worldEventIds, `${path}.worldEventIds`, phase),
      locationRef: validateLocationRef_ACU(item.locationRef, `${path}.locationRef`, phase), sourceFactIds: stringArray_ACU(item.sourceFactIds, `${path}.sourceFactIds`, phase),
      importance: integer_ACU(item.importance, `${path}.importance`, phase, 1, 5), category: string_ACU(item.category, `${path}.category`, phase),
      visibility: enum_ACU(item.visibility, ['internal'] as const, `${path}.visibility`, phase), revision: integer_ACU(item.revision, `${path}.revision`, phase),
      legacyRefs: stringArray_ACU(item.legacyRefs, `${path}.legacyRefs`, phase),
      ...(narrativeRecord === undefined ? {} : { narrativeRecord }),
    };
  });
  uniqueIds_ACU(rows, 'ledger.historyMilestones', phase);
  return rows;
}

function validateProjection_ACU(raw: unknown, phase: WorldSimulationErrorPhase_ACU): WorldProjection_ACU {
  if (!isRecord_ACU(raw)) fail_ACU('ledger.projection 必须是对象', phase);
  exactKeys_ACU(raw, ['anchor', 'deliveries'], [], 'ledger.projection', phase);
  if (!Array.isArray(raw.deliveries)) fail_ACU('ledger.projection.deliveries 必须是数组', phase);
  if (raw.deliveries.length && (typeof raw.anchor !== 'string' || !raw.anchor.trim())) {
    fail_ACU('ledger.projection 有投送记录时必须有非空锚点', phase);
  }
  const deliveries = raw.deliveries.map((item, index) => {
    const path = `ledger.projection.deliveries[${index}]`;
    if (!isRecord_ACU(item)) fail_ACU(`${path} 必须是对象`, phase);
    exactKeys_ACU(item, ['factId', 'status', 'attempts'], [], path, phase);
    return { factId: stableId_ACU(item.factId, `${path}.factId`, phase), status: enum_ACU(item.status, ['delivered', 'acknowledged', 'expired'] as const, `${path}.status`, phase), attempts: integer_ACU(item.attempts, `${path}.attempts`, phase, 1, WORLD_PROJECTION_MAX_DELIVERIES_ACU) };
  });
  uniqueIds_ACU(deliveries.map(item => ({ id: item.factId })), 'ledger.projection.deliveries', phase);
  return { anchor: raw.anchor === null ? null : string_ACU(raw.anchor, 'ledger.projection.anchor', phase), deliveries };
}

function validateLegacyMigration_ACU(raw: unknown, phase: WorldSimulationErrorPhase_ACU): WorldLegacyMigration_ACU {
  if (!isRecord_ACU(raw)) fail_ACU('ledger.legacyMigration 必须是对象', phase);
  exactKeys_ACU(raw, ['issues'], [], 'ledger.legacyMigration', phase);
  if (!Array.isArray(raw.issues)) fail_ACU('ledger.legacyMigration.issues 必须是数组', phase);
  const issues = raw.issues.map((item, index) => {
    const path = `ledger.legacyMigration.issues[${index}]`;
    if (!isRecord_ACU(item)) fail_ACU(`${path} 必须是对象`, phase);
    exactKeys_ACU(item, ['source', 'sourceId', 'reason'], [], path, phase);
    return {
      source: enum_ACU(item.source, ['dimension', 'seed', 'chronicle', 'rumor', 'chronicleArchive'] as const, `${path}.source`, phase),
      sourceId: stableId_ACU(item.sourceId, `${path}.sourceId`, phase),
      reason: enum_ACU(item.reason, ['requires_review', 'missing_evidence', 'unparseable_time', 'archive_detail_unavailable'] as const, `${path}.reason`, phase),
    };
  });
  uniqueIds_ACU(issues.map(item => ({ id: `${item.source}:${item.sourceId}` })), 'ledger.legacyMigration.issues', phase);
  return { issues };
}

function validateLedger_ACU(raw: unknown, phase: WorldSimulationErrorPhase_ACU): WorldSimulationLedger_ACU {
  if (!isRecord_ACU(raw)) fail_ACU('ledger 必须是对象', phase);
  const normalized = migrateLedgerToCurrent_ACU(raw, phase);
  exactKeys_ACU(normalized, LEDGER_EXACT_KEYS_ACU, LEDGER_OPTIONAL_KEYS_ACU, 'ledger', phase);
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
  if (!Array.isArray(normalized.actors) || normalized.actors.length > WORLD_ACTOR_LEDGER_CAP_ACU) fail_ACU('ledger.actors 容量非法', phase);
  const actors = normalized.actors.map((item, index) => {
    if (!isRecord_ACU(item)) fail_ACU(`ledger.actors[${index}] 必须是对象`, phase);
    exactKeys_ACU(item, ACTOR_BASE_KEYS_ACU, [...ACTOR_TIMELINE_KEYS_ACU, ...WORLD_SIMULATION_LEDGER_ACTOR_OPTIONAL_FIELDS_ACU], `ledger.actors[${index}]`, phase);
    const life = enum_ACU(item.life, WORLD_ACTOR_LIFE_ACU, `ledger.actors[${index}].life`, phase);
    const diedAtDay = nullableInteger_ACU(item.diedAtDay, `ledger.actors[${index}].diedAtDay`, phase, 1);
    const deathSummary = nullableString_ACU(item.deathSummary, `ledger.actors[${index}].deathSummary`, phase);
    if (life === 'dead') {
      if (diedAtDay === null) fail_ACU(`ledger.actors[${index}] dead 状态必须提供 diedAtDay`, phase);
      if (!deathSummary) fail_ACU(`ledger.actors[${index}] dead 状态必须提供 deathSummary`, phase);
    } else if (diedAtDay !== null || deathSummary !== null) {
      fail_ACU(`ledger.actors[${index}] 非 dead 状态不能携带死亡字段`, phase);
    }
    if (item.shortTermAction !== undefined && !sameActorAction_ACU(item.shortTermAction, item.longTermAction)) {
      fail_ACU(`ledger.actors[${index}] shortTermAction 与旧长期事务不一致`, phase);
    }
    return { id: stableId_ACU(item.id, `ledger.actors[${index}].id`, phase), name: string_ACU(item.name, `ledger.actors[${index}].name`, phase), interests: stringArray_ACU(item.interests, `ledger.actors[${index}].interests`, phase), location: string_ACU(item.location, `ledger.actors[${index}].location`, phase, true), locationRef: validateLocationRef_ACU(item.locationRef, `ledger.actors[${index}].locationRef`, phase), life, diedAtDay, deathSummary, resources: stringArray_ACU(item.resources, `ledger.actors[${index}].resources`, phase), goals: stringArray_ACU(item.goals, `ledger.actors[${index}].goals`, phase), constraints: stringArray_ACU(item.constraints, `ledger.actors[${index}].constraints`, phase), informationSources: stringArray_ACU(item.informationSources, `ledger.actors[${index}].informationSources`, phase), knownFacts: stringArray_ACU(item.knownFacts, `ledger.actors[${index}].knownFacts`, phase), visibility: enum_ACU(item.visibility, ['hidden', 'limited', 'public'] as const, `ledger.actors[${index}].visibility`, phase), ...validateActorTimelineFields_ACU(item, `ledger.actors[${index}]`, phase),
      ...(item.shortTermAction === undefined ? {} : { shortTermAction: validateActorLongTermAction_ACU(item.shortTermAction, `ledger.actors[${index}].shortTermAction`, phase) }),
      ...(item.simulationStatus === undefined ? {} : { simulationStatus: enum_ACU(item.simulationStatus, ['active', 'archived'] as const, `ledger.actors[${index}].simulationStatus`, phase) }),
      ...(item.loreRefs === undefined ? {} : { loreRefs: stringArray_ACU(item.loreRefs, `ledger.actors[${index}].loreRefs`, phase) }),
      ...(item.previousActionResult === undefined ? {} : { previousActionResult: string_ACU(item.previousActionResult, `ledger.actors[${index}].previousActionResult`, phase, true) }),
      revision: integer_ACU(item.revision, `ledger.actors[${index}].revision`, phase) };
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
    exactKeys_ACU(item, CHRONICLE_BASE_KEYS_ACU, CHRONICLE_OPTIONAL_KEYS_ACU, `ledger.chronicle[${index}]`, phase);
    const related = stringArray_ACU(item.relatedIds, `ledger.chronicle[${index}].relatedIds`, phase);
    for (const relatedId of related) if (!knownIds.has(relatedId)) fail_ACU(`ledger.chronicle[${index}] 引用了不存在的对象`, phase, { relatedId });
    return { id: stableId_ACU(item.id, `ledger.chronicle[${index}].id`, phase), at: string_ACU(item.at, `ledger.chronicle[${index}].at`, phase), summary: string_ACU(item.summary, `ledger.chronicle[${index}].summary`, phase), relatedIds: related, evidenceRefs: stringArray_ACU(item.evidenceRefs, `ledger.chronicle[${index}].evidenceRefs`, phase), missedNote: validateChronicleMissedNote_ACU(item.missedNote, `ledger.chronicle[${index}].missedNote`, phase) };
  });
  uniqueIds_ACU(chronicle, 'ledger.chronicle', phase);
  const rumors = validateRumors_ACU(normalized.rumors, actorIds, phase);
  const player = validatePlayer_ACU(normalized.player, phase);
  if (!isRecord_ACU(normalized.guidance)) fail_ACU('ledger.guidance 必须是对象', phase);
  exactKeys_ACU(normalized.guidance, WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU.guidance, [], 'ledger.guidance', phase);
  const chronicleOverview = validateChronicleOverview_ACU(normalized.chronicleOverview, phase);
  const materialCompletion = validateMaterialCompletion_ACU(normalized.materialCompletion, phase);
  const pendingFixes = validatePendingFixes_ACU(normalized.pendingFixes, phase);
  const worldEvents = validateWorldEvents_ACU(normalized.worldEvents, phase);
  const facts = validateFacts_ACU(normalized.facts, phase);
  const factArchive = normalized.factArchive === undefined ? undefined : validateFacts_ACU(normalized.factArchive, phase, 'ledger.factArchive');
  const factArchiveRetention = normalized.factArchiveRetention === undefined ? undefined
    : validateFactArchiveRetention_ACU(normalized.factArchiveRetention, new Set((factArchive ?? []).map(fact => fact.id)), phase);
  const historyMilestones = validateHistoryMilestones_ACU(normalized.historyMilestones, phase);
  const historyArchive = normalized.historyArchive === undefined ? undefined : validateHistoryMilestones_ACU(normalized.historyArchive, phase);
  const projection = validateProjection_ACU(normalized.projection, phase);
  const legacyMigration = validateLegacyMigration_ACU(normalized.legacyMigration, phase);
  const eventIds = new Set(worldEvents.map(item => item.id));
  const factIds = new Set(facts.map(item => item.id));
  for (const fact of factArchive ?? []) {
    if (factIds.has(fact.id)) fail_ACU(`ledger.factArchive 与 facts 存在重复 ID ${fact.id}`, phase, { id: fact.id });
    factIds.add(fact.id);
  }
  const historyMilestoneIds = new Set(historyMilestones.map(item => item.id));
  for (const milestone of historyArchive ?? []) {
    if (historyMilestoneIds.has(milestone.id)) fail_ACU(`ledger.historyArchive 与 historyMilestones 存在重复 ID ${milestone.id}`, phase, { id: milestone.id });
    historyMilestoneIds.add(milestone.id);
  }
  for (const event of worldEvents) {
    for (const id of event.actorIds) if (!actorIds.has(id)) fail_ACU(`ledger.worldEvents ${event.id} 引用了不存在的 actor`, phase);
    for (const id of event.relatedEventIds) if (!eventIds.has(id)) fail_ACU(`ledger.worldEvents ${event.id} 引用了不存在的 event`, phase);
  }
  for (const fact of [...facts, ...(factArchive ?? [])]) {
    for (const id of fact.actorIds) if (!actorIds.has(id)) fail_ACU(`ledger.facts ${fact.id} 引用了不存在的 actor`, phase);
    for (const id of fact.worldEventIds) if (!eventIds.has(id)) fail_ACU(`ledger.facts ${fact.id} 引用了不存在的 event`, phase);
    for (const id of fact.supersedesFactIds) if (!factIds.has(id) || id === fact.id) fail_ACU(`ledger.facts ${fact.id} 的 supersedesFactIds 非法`, phase);
  }
  for (const milestone of [...historyMilestones, ...(historyArchive ?? [])]) {
    for (const id of milestone.actorIds) if (!actorIds.has(id)) fail_ACU(`ledger.historyMilestones ${milestone.id} 引用了不存在的 actor`, phase);
    for (const id of milestone.worldEventIds) if (!eventIds.has(id)) fail_ACU(`ledger.historyMilestones ${milestone.id} 引用了不存在的 event`, phase);
    for (const id of milestone.sourceFactIds) if (!factIds.has(id)) fail_ACU(`ledger.historyMilestones ${milestone.id} 引用了不存在的 fact`, phase);
  }
  for (const delivery of projection.deliveries) {
    const fact = facts.find(item => item.id === delivery.factId);
    if (!fact || fact.revealState !== 'unlocked' || fact.projectionPolicy === 'internal') fail_ACU(`ledger.projection 引用了不可投送的 fact ${delivery.factId}`, phase);
  }
  return { schemaVersion: WORLD_LEDGER_SCHEMA_VERSION_ACU, revision: integer_ACU(normalized.revision, 'ledger.revision', phase), clock, dimensions, seeds, actors, worldEvents, facts,
    ...(factArchive === undefined ? {} : { factArchive }),
    ...(factArchiveRetention === undefined ? {} : { factArchiveRetention }), historyMilestones,
    ...(historyArchive === undefined ? {} : { historyArchive }), projection, legacyMigration, chronicle, rumors, player, guidance: { signals: validateGuidanceSignals_ACU(normalized.guidance.signals, 'ledger.guidance.signals', phase), excludedFacts: stringArray_ACU(normalized.guidance.excludedFacts, 'ledger.guidance.excludedFacts', phase), evidenceRefs: stringArray_ACU(normalized.guidance.evidenceRefs, 'ledger.guidance.evidenceRefs', phase) }, chronicleOverview, materialCompletion, pendingFixes };
}

function validatePlan_ACU(raw: unknown, path: string, phase: WorldSimulationErrorPhase_ACU): WorldSimulationEnvelope_ACU['stages'][number]['revisions'][number]['plan'] {
  if (!isRecord_ACU(raw)) fail_ACU(`${path} 必须是对象`, phase);
  exactKeys_ACU(raw, ['schemaVersion', 'title', 'objective', 'impactScope', 'factsToVerify', 'plannedTools', 'plannedSpecialists', 'expectedLedgerChanges', 'convergenceConditions', 'blockingConditions', 'completedSteps', 'nextStep'], [], path, phase);
  if (raw.schemaVersion !== WORLD_SIMULATION_SCHEMA_VERSION_ACU) fail_ACU(`${path}.schemaVersion 必须为 1`, phase);
  if (!Array.isArray(raw.expectedLedgerChanges)) fail_ACU(`${path}.expectedLedgerChanges 必须是数组`, phase);
  return { schemaVersion: WORLD_SIMULATION_SCHEMA_VERSION_ACU, title: string_ACU(raw.title, `${path}.title`, phase), objective: string_ACU(raw.objective, `${path}.objective`, phase), impactScope: stringArray_ACU(raw.impactScope, `${path}.impactScope`, phase), factsToVerify: stringArray_ACU(raw.factsToVerify, `${path}.factsToVerify`, phase), plannedTools: stringArray_ACU(raw.plannedTools, `${path}.plannedTools`, phase), plannedSpecialists: stringArray_ACU(raw.plannedSpecialists, `${path}.plannedSpecialists`, phase), expectedLedgerChanges: raw.expectedLedgerChanges.map((item, index) => enum_ACU(item, WORLD_SIMULATION_LEDGER_MODULES_ACU, `${path}.expectedLedgerChanges[${index}]`, phase)), convergenceConditions: stringArray_ACU(raw.convergenceConditions, `${path}.convergenceConditions`, phase), blockingConditions: stringArray_ACU(raw.blockingConditions, `${path}.blockingConditions`, phase), completedSteps: stringArray_ACU(raw.completedSteps, `${path}.completedSteps`, phase), nextStep: string_ACU(raw.nextStep, `${path}.nextStep`, phase, true) };
}

export function validateWorldSimulationEnvelope_ACU(raw: unknown, phase: WorldSimulationErrorPhase_ACU = 'load'): WorldSimulationEnvelope_ACU {
  if (!isRecord_ACU(raw)) fail_ACU('格林推演状态必须是对象', phase);
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
    exactKeys_ACU(raw.task, ['taskId', 'originInstruction', 'status', 'createdAt', 'updatedAt', 'activeRun', 'stopReason'], ['completedAutoAnchor', 'runMaterials', 'completedRun'], 'task', phase);
    task = { taskId: stableId_ACU(raw.task.taskId, 'task.taskId', phase), originInstruction: string_ACU(raw.task.originInstruction, 'task.originInstruction', phase), status: normalizeLegacyEnum_ACU(TASK_STATUSES_ACU, LEGACY_TASK_STATUSES_ACU, raw.task.status, 'task.status', phase), createdAt: integer_ACU(raw.task.createdAt, 'task.createdAt', phase), updatedAt: integer_ACU(raw.task.updatedAt, 'task.updatedAt', phase), activeRun: null, stopReason: raw.task.stopReason === null ? null : string_ACU(raw.task.stopReason, 'task.stopReason', phase) };
    if (raw.task.completedAutoAnchor !== undefined) {
      const completed = raw.task.completedAutoAnchor;
      if (!isRecord_ACU(completed)) fail_ACU('task.completedAutoAnchor 必须是对象', phase);
      if (completed.kind === 'logical') {
        exactKeys_ACU(completed, ['kind', 'chatIdentity', 'logicalRef', 'contentDigest'], [], 'task.completedAutoAnchor', phase);
        task.completedAutoAnchor = {
          kind: 'logical',
          chatIdentity: string_ACU(completed.chatIdentity, 'task.completedAutoAnchor.chatIdentity', phase),
          logicalRef: validateWorldSimulationLogicalRef_ACU(completed.logicalRef, 'task.completedAutoAnchor.logicalRef', phase),
          contentDigest: string_ACU(completed.contentDigest, 'task.completedAutoAnchor.contentDigest', phase),
        };
      } else {
        exactKeys_ACU(completed, ['chatIdentity', 'messageKey', 'swipeId', 'contentDigest'], ['kind'], 'task.completedAutoAnchor', phase);
        task.completedAutoAnchor = {
          ...(completed.kind === undefined ? {} : { kind: enum_ACU(completed.kind, ['host'] as const, 'task.completedAutoAnchor.kind', phase) }),
          chatIdentity: string_ACU(completed.chatIdentity, 'task.completedAutoAnchor.chatIdentity', phase),
          messageKey: string_ACU(completed.messageKey, 'task.completedAutoAnchor.messageKey', phase),
          swipeId: string_ACU(completed.swipeId, 'task.completedAutoAnchor.swipeId', phase),
          contentDigest: string_ACU(completed.contentDigest, 'task.completedAutoAnchor.contentDigest', phase),
        };
      }
    }
    for (const runKey of ['activeRun', 'completedRun'] as const) {
      const run = raw.task[runKey];
      if (run === null || run === undefined) continue;
      const activeRun = task.activeRun;
      if (!isRecord_ACU(run)) fail_ACU('task.activeRun 必须是对象或 null', phase);
      const commonKeys = ['runId', 'chatIdentity', 'triggerKind', 'triggerConversationMessageId', 'anchorContentDigest', 'baseLedgerRevision', 'taskId', 'stageId', 'stageRevision'];
      const logical = run.kind === 'logical';
      exactKeys_ACU(run, [...commonKeys, ...(logical ? ['kind', 'logicalRef'] : ['anchorMessageId', 'anchorMessageKey', 'anchorSwipeId'])], logical ? ['deliveryTarget', 'workflowMode', 'workflowProtocol'] : ['kind', 'deliveryTarget', 'workflowMode', 'workflowProtocol'], 'task.activeRun', phase);
      const common = {
        runId: stableId_ACU(run.runId, 'task.activeRun.runId', phase),
        chatIdentity: string_ACU(run.chatIdentity, 'task.activeRun.chatIdentity', phase),
        triggerKind: enum_ACU(run.triggerKind, ['assistant_completed', 'agent_chat_message'] as const, 'task.activeRun.triggerKind', phase),
        triggerConversationMessageId: run.triggerConversationMessageId === null ? null : string_ACU(run.triggerConversationMessageId, 'task.activeRun.triggerConversationMessageId', phase),
        anchorContentDigest: string_ACU(run.anchorContentDigest, 'task.activeRun.anchorContentDigest', phase),
        baseLedgerRevision: integer_ACU(run.baseLedgerRevision, 'task.activeRun.baseLedgerRevision', phase),
        taskId: stableId_ACU(run.taskId, 'task.activeRun.taskId', phase),
        stageId: stableId_ACU(run.stageId, 'task.activeRun.stageId', phase),
        stageRevision: integer_ACU(run.stageRevision, 'task.activeRun.stageRevision', phase, 1),
        ...(run.deliveryTarget === undefined ? {} : { deliveryTarget: enum_ACU(run.deliveryTarget, ['body', 'plot'] as const, 'task.activeRun.deliveryTarget', phase) }),
        ...(run.workflowMode === undefined ? {} : { workflowMode: enum_ACU(run.workflowMode, ['single', 'layered'] as const, 'task.activeRun.workflowMode', phase) }),
        ...(run.workflowProtocol === undefined ? {} : { workflowProtocol: enum_ACU(run.workflowProtocol, ['world-round-v1'] as const, 'task.activeRun.workflowProtocol', phase) }),
      };
      if (common.workflowProtocol !== undefined
        && (common.deliveryTarget === undefined || common.workflowMode === undefined)) {
        fail_ACU('task.activeRun 新工作流协议必须冻结 deliveryTarget 与 workflowMode', phase);
      }
      task.activeRun = logical ? { ...common, kind: 'logical',
        logicalRef: validateWorldSimulationLogicalRef_ACU(run.logicalRef, 'task.activeRun.logicalRef', phase),
      } : { ...common,
        ...(run.kind === undefined ? {} : { kind: enum_ACU(run.kind, ['host'] as const, 'task.activeRun.kind', phase) }),
        anchorMessageId: typeof run.anchorMessageId === 'number' ? integer_ACU(run.anchorMessageId, 'task.activeRun.anchorMessageId', phase) : string_ACU(run.anchorMessageId, 'task.activeRun.anchorMessageId', phase),
        anchorMessageKey: string_ACU(run.anchorMessageKey, 'task.activeRun.anchorMessageKey', phase),
        anchorSwipeId: string_ACU(run.anchorSwipeId, 'task.activeRun.anchorSwipeId', phase),
      };
      if (task.activeRun.taskId !== task.taskId) fail_ACU('task.activeRun.taskId 与 task 不一致', phase);
      const runStage = stages.find(stage => stage.stageId === task!.activeRun!.stageId);
      if (!runStage || runStage.activeRevision !== task.activeRun.stageRevision) fail_ACU('task.activeRun 阶段 revision 不一致', phase);
      if (runKey === 'completedRun') {
        task.completedRun = task.activeRun;
        task.activeRun = activeRun;
      }
    }
    if (raw.task.runMaterials !== undefined) {
      const historicalStatus = task.status === 'paused' || task.status === 'completed' || task.status === 'failed';
      if (task.activeRun !== null && task.activeRun.workflowProtocol !== 'world-round-v1') {
        fail_ACU('task.runMaterials 仅允许 world-round-v1 运行携带', phase);
      }
      if (task.activeRun === null && !historicalStatus) {
        fail_ACU('task.runMaterials 仅允许保留在暂停、完成或失败的历史任务', phase);
      }
      task.runMaterials = validateWorldRunMaterials_ACU(raw.task.runMaterials, 'task.runMaterials', phase);
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
  if (raw === undefined) return null;
  const envelope = validateWorldSimulationEnvelope_ACU(raw);
  assertWorldSimulationHostEnvelope_ACU(envelope);
  return envelope;
}

type WorldSimulationLedgerOverlay_ACU = (envelope: WorldSimulationEnvelope_ACU, chat: any[]) => WorldSimulationEnvelope_ACU;
let ledgerOverlay_ACU: WorldSimulationLedgerOverlay_ACU | null = null;

/** 由账本折叠模块注册。read() 用折叠结果覆盖 envelope.ledger，磁盘上的 envelope 仍是缓存。 */
export function registerWorldSimulationLedgerOverlay_ACU(overlay: WorldSimulationLedgerOverlay_ACU): void {
  ledgerOverlay_ACU = overlay;
}

export class FirstFloorWorldSimulationStore_ACU {
  private static tailsByChat_ACU = new Map<string, Promise<void>>();

  read(): WorldSimulationEnvelope_ACU | null {
    const context = captureContext_ACU();
    const envelope = readRaw_ACU(context.firstMessage);
    if (!envelope || !ledgerOverlay_ACU) return envelope;
    return ledgerOverlay_ACU(envelope, context.chat);
  }
  readPersisted(): WorldSimulationEnvelope_ACU | null { return this.read(); }

  replaceAtomically(candidate: WorldSimulationEnvelope_ACU, guard?: WorldSimulationWriteGuard_ACU): Promise<void> {
    return this.enqueue_ACU(context => this.replaceWithinQueue_ACU(candidate, guard, context), guard);
  }

  updateAtomically(mutator: (current: WorldSimulationEnvelope_ACU | null) => WorldSimulationEnvelope_ACU, guard?: WorldSimulationWriteGuard_ACU): Promise<void> {
    return this.enqueue_ACU(async context => {
      assertContext_ACU(context);
      const persisted = readRaw_ACU(context.firstMessage);
      const current = persisted && ledgerOverlay_ACU
        ? ledgerOverlay_ACU(persisted, context.chat)
        : persisted;
      assertGuard_ACU(current, guard);
      await this.replaceWithinQueue_ACU(mutator(current), guard, context);
    }, guard);
  }

  private async replaceWithinQueue_ACU(candidate: WorldSimulationEnvelope_ACU, guard: WorldSimulationWriteGuard_ACU | undefined, context: ReturnType<typeof captureContext_ACU>): Promise<void> {
    assertContext_ACU(context);
    assertGuard_ACU(readRaw_ACU(context.firstMessage), guard);
    const validated = validateWorldSimulationEnvelope_ACU(candidate, 'persist');
    assertWorldSimulationHostEnvelope_ACU(validated);
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
        catch (rollbackError) { reject_ACU('WORLD_SIMULATION_PERSIST_FAILED', 'persist', '格林推演状态保存与回滚均失败', { primaryMessage: error instanceof Error ? error.message : String(error), rollbackMessage: rollbackError instanceof Error ? rollbackError.message : String(rollbackError) }); }
      }
      if (error instanceof WorldSimulationValidationError_ACU) throw error;
      reject_ACU('WORLD_SIMULATION_PERSIST_FAILED', 'persist', '格林推演状态保存失败', { message: error instanceof Error ? error.message : String(error) });
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

/**
 * 锚点楼层判定必须与挑选最新 AI 楼层的 isAiMessage_ACU 完全一致，否则会出现
 * 「选中一层、随即被拒」：那边按宿主语义只排除 narrator 旁白，这里却额外拒绝
 * is_system。宿主用 is_system 标记「不进提示词」，与 role 无关，于是被隐藏的
 * AI 楼层选得出来却解析不了，抛 WORLD_SIMULATION_ANCHOR_INVALID。
 * 宿主语义：assistant <=> !is_user 且 extra?.type !== 'narrator'。
 */
function isAssistantMessage_ACU(message: Record<string, unknown>): boolean {
  if (message.is_user === true) return false;
  const extra = message.extra;
  return !(isRecord_ACU(extra) && extra.type === 'narrator');
}

export function buildWorldSimulationBucketKey_ACU(anchor: WorldSimulationAnchorIdentity_ACU): string {
  requireWorldSimulationHostAnchor_ACU(anchor);
  return sha256HexSync_ACU([anchor.chatIdentity, anchor.messageKey, anchor.swipeId].join('\n'));
}

/** 只兼容已存储的正文摘要键，不再用它标识当前楼层。 */
export function isWorldSimulationBucketKey_ACU(key: string, anchor: WorldSimulationAnchorIdentity_ACU): boolean {
  return key === buildWorldSimulationBucketKey_ACU(anchor)
    || key === sha256HexSync_ACU([anchor.chatIdentity, anchor.messageKey, anchor.swipeId, anchor.contentDigest].join('\n'));
}

/** 新楼层键优先；旧摘要桶按最后保存时间只读恢复，不猜测同时间的冲突值。 */
export function resolveWorldSimulationBucketEntry_ACU<T>(
  entries: Record<string, unknown>, anchor: WorldSimulationAnchorIdentity_ACU, field: string,
): WorldSimulationBucket_ACU<T>['entries'][string] | undefined {
  const key = buildWorldSimulationBucketKey_ACU(anchor);
  const validate = (raw: unknown, entryKey: string) => {
    if (!isRecord_ACU(raw) || !isRecord_ACU(raw.anchor) || !Object.prototype.hasOwnProperty.call(raw, 'value')
      || !sameWorldSimulationTargetRef_ACU(raw.anchor as unknown as WorldSimulationAnchorIdentity_ACU, anchor)
      || !isWorldSimulationBucketKey_ACU(entryKey, raw.anchor as unknown as WorldSimulationAnchorIdentity_ACU)
      || !Number.isInteger(raw.updatedAt) || (raw.updatedAt as number) < 0) {
      reject_ACU('WORLD_SIMULATION_SNAPSHOT_INVALID', 'load', `${field} 当前 swipe 条目或身份损坏`);
    }
    return raw as unknown as WorldSimulationBucket_ACU<T>['entries'][string];
  };
  if (Object.prototype.hasOwnProperty.call(entries, key)) return validate(entries[key], key);
  let selected: WorldSimulationBucket_ACU<T>['entries'][string] | undefined;
  for (const [entryKey, raw] of Object.entries(entries)) {
    if (!isRecord_ACU(raw) || !isRecord_ACU(raw.anchor)
      || !sameWorldSimulationTargetRef_ACU(raw.anchor as unknown as WorldSimulationAnchorIdentity_ACU, anchor)) continue;
    const candidate = validate(raw, entryKey);
    if (!selected || candidate.updatedAt > selected.updatedAt) selected = candidate;
    else if (candidate.updatedAt === selected.updatedAt && JSON.stringify(candidate.value) !== JSON.stringify(selected.value)) {
      reject_ACU('WORLD_SIMULATION_SNAPSHOT_INVALID', 'load', `${field} 同楼层旧摘要桶存在冲突，不能确定权威条目`);
    }
  }
  return selected;
}

/** 仅在正常保存中归并当前楼层旧键；调用方保留原容器以便失败回滚。 */
export function buildWorldSimulationBucketEntries_ACU<T>(
  previous: Record<string, unknown>, anchor: WorldSimulationAnchorIdentity_ACU, value: T, updatedAt: number,
): WorldSimulationBucket_ACU<T>['entries'] {
  resolveWorldSimulationBucketEntry_ACU(previous, anchor, '格林推演分桶');
  const entries = { ...previous } as WorldSimulationBucket_ACU<T>['entries'];
  for (const [key, entry] of Object.entries(entries)) {
    if (isRecord_ACU(entry) && isRecord_ACU(entry.anchor)
      && sameWorldSimulationTargetRef_ACU(entry.anchor as unknown as WorldSimulationAnchorIdentity_ACU, anchor)) delete entries[key];
  }
  entries[buildWorldSimulationBucketKey_ACU(anchor)] = { anchor: { ...anchor }, value, updatedAt };
  return entries;
}

export function resolveWorldSimulationAnchor_ACU(messageIndex: number, chat?: any[]): WorldSimulationAnchorIdentity_ACU {
  const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
  const chatIdentity = getActiveChatStorageIdentity_ACU(messages);
  const message = Number.isInteger(messageIndex) && messageIndex >= 0 && isRecord_ACU(messages[messageIndex])
    ? messages[messageIndex]
    : null;
  if (!chatIdentity || !message || !isAssistantMessage_ACU(message)) {
    reject_ACU('WORLD_SIMULATION_ANCHOR_INVALID', 'anchor', '格林推演锚点必须是当前聊天中的 assistant 楼层', { messageIndex });
  }
  const rawMessageId = message.message_id;
  const messageId = typeof rawMessageId === 'string' || typeof rawMessageId === 'number' ? rawMessageId : messageIndex;
  const swipeId = typeof message.swipe_id === 'number' && Number.isInteger(message.swipe_id) && message.swipe_id >= 0
    ? String(message.swipe_id)
    : '0';
  const contentDigest = sha256HexSync_ACU(readMessageContent_ACU(message));
  const messageKey = `${typeof messageId}:${String(messageId)}`;
  return { chatIdentity, messageIndex, messageId, messageKey, swipeId, contentDigest };
}

export function assertWorldSimulationAnchorCurrent_ACU(anchor: WorldSimulationAnchorIdentity_ACU, chat?: any[]): WorldSimulationAnchorIdentity_ACU {
  requireWorldSimulationHostAnchor_ACU(anchor);
  const current = resolveWorldSimulationAnchor_ACU(anchor.messageIndex, chat);
  if (!sameWorldSimulationTargetRef_ACU(current, anchor)) {
    reject_ACU('WORLD_SIMULATION_ANCHOR_STALE', 'anchor', '格林推演冻结锚点已变化，拒绝继续写入', {
      expected: anchor,
      actual: current,
    });
  }
  return current;
}

/** 楼层位置是定位提示；消息键和 swipe 才是身份，正文后处理不使锚点失效。 */
export function resolveCurrentWorldSimulationAnchor_ACU(anchor: WorldSimulationAnchorIdentity_ACU, chat?: any[]): WorldSimulationAnchorIdentity_ACU {
  requireWorldSimulationHostAnchor_ACU(anchor);
  const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
  const chatIdentity = getActiveChatStorageIdentity_ACU(messages);
  let matchedIndex: number | undefined;
  if (!chatIdentity) {
    reject_ACU('WORLD_SIMULATION_ANCHOR_INVALID', 'anchor', '格林推演锚点必须是当前聊天中的 assistant 楼层', { messageIndex: anchor.messageIndex });
  }
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!isRecord_ACU(message) || !isAssistantMessage_ACU(message)) continue;
    const messageId = typeof message.message_id === 'string' || typeof message.message_id === 'number' ? message.message_id : index;
    const swipeId = typeof message.swipe_id === 'number' && Number.isInteger(message.swipe_id) && message.swipe_id >= 0 ? String(message.swipe_id) : '0';
    if (chatIdentity === anchor.chatIdentity && `${typeof messageId}:${String(messageId)}` === anchor.messageKey && swipeId === anchor.swipeId) {
      if (matchedIndex !== undefined) {
        reject_ACU('WORLD_SIMULATION_ANCHOR_STALE', 'anchor', '格林推演冻结锚点无法唯一定位，拒绝继续写入', { expected: anchor });
      }
      matchedIndex = index;
    }
  }
  if (matchedIndex !== undefined) return resolveWorldSimulationAnchor_ACU(matchedIndex, messages);
  reject_ACU('WORLD_SIMULATION_ANCHOR_STALE', 'anchor', '格林推演冻结锚点已变化，拒绝继续写入', { expected: anchor });
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
  const rawEntry = resolveWorldSimulationBucketEntry_ACU<T>(rawBucket.entries, currentAnchor, field);
  if (rawEntry === undefined) return null;
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
  const candidate: WorldSimulationBucket_ACU<T> = {
    schemaVersion: 1,
    entries: buildWorldSimulationBucketEntries_ACU(previousBucket.entries, currentAnchor, value, Date.now()),
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
  let normalized: Record<string, unknown>;
  try { normalized = migrateLedgerToCurrent_ACU(raw, phase); }
  catch (error) { return [error instanceof Error ? error.message : String(error)]; }
  if (!isRecord_ACU(normalized)) return ['ledger 必须是对象'];
  probe(() => {
    exactKeys_ACU(normalized, LEDGER_EXACT_KEYS_ACU, LEDGER_OPTIONAL_KEYS_ACU, 'ledger', phase);
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
  if (!Array.isArray(normalized.actors) || normalized.actors.length > WORLD_ACTOR_LEDGER_CAP_ACU) probe(() => fail_ACU('ledger.actors 容量非法', phase));
  else {
    for (const [index, item] of normalized.actors.entries()) {
      probe(() => {
        if (!isRecord_ACU(item)) fail_ACU(`ledger.actors[${index}] 必须是对象`, phase);
        exactKeys_ACU(item, ACTOR_BASE_KEYS_ACU, [...ACTOR_TIMELINE_KEYS_ACU, ...WORLD_SIMULATION_LEDGER_ACTOR_OPTIONAL_FIELDS_ACU], `ledger.actors[${index}]`, phase);
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
        validateActorTimelineFields_ACU(item, `ledger.actors[${index}]`, phase);
        if (item.shortTermAction !== undefined) {
          validateActorLongTermAction_ACU(item.shortTermAction, `ledger.actors[${index}].shortTermAction`, phase);
          if (!sameActorAction_ACU(item.shortTermAction, item.longTermAction)) fail_ACU(`ledger.actors[${index}] shortTermAction 与旧长期事务不一致`, phase);
        }
        if (item.simulationStatus !== undefined) enum_ACU(item.simulationStatus, ['active', 'archived'] as const, `ledger.actors[${index}].simulationStatus`, phase);
        if (item.loreRefs !== undefined) stringArray_ACU(item.loreRefs, `ledger.actors[${index}].loreRefs`, phase);
        if (item.previousActionResult !== undefined) string_ACU(item.previousActionResult, `ledger.actors[${index}].previousActionResult`, phase, true);
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
        exactKeys_ACU(item, CHRONICLE_BASE_KEYS_ACU, CHRONICLE_OPTIONAL_KEYS_ACU, `ledger.chronicle[${index}]`, phase);
        const related = stringArray_ACU(item.relatedIds, `ledger.chronicle[${index}].relatedIds`, phase);
        for (const relatedId of related) if (!knownIds.has(relatedId)) fail_ACU(`ledger.chronicle[${index}] 引用了不存在的对象`, phase, { relatedId });
        chronicle.push({ id: stableId_ACU(item.id, `ledger.chronicle[${index}].id`, phase) });
        string_ACU(item.at, `ledger.chronicle[${index}].at`, phase);
        string_ACU(item.summary, `ledger.chronicle[${index}].summary`, phase);
        stringArray_ACU(item.evidenceRefs, `ledger.chronicle[${index}].evidenceRefs`, phase);
        validateChronicleMissedNote_ACU(item.missedNote, `ledger.chronicle[${index}].missedNote`, phase);
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
  probe(() => { validateMaterialCompletion_ACU(normalized.materialCompletion, phase); });
  probe(() => { validatePendingFixes_ACU(normalized.pendingFixes, phase); });
  probe(() => { validateWorldEvents_ACU(normalized.worldEvents, phase); });
  probe(() => { validateFacts_ACU(normalized.facts, phase); });
  probe(() => { validateHistoryMilestones_ACU(normalized.historyMilestones, phase); });
  if (normalized.factArchive !== undefined) probe(() => { validateFacts_ACU(normalized.factArchive, phase, 'ledger.factArchive'); });
  if (normalized.factArchiveRetention !== undefined) probe(() => {
    const cold = validateFacts_ACU(normalized.factArchive ?? [], phase, 'ledger.factArchive');
    validateFactArchiveRetention_ACU(normalized.factArchiveRetention, new Set(cold.map(fact => fact.id)), phase);
  });
  if (normalized.historyArchive !== undefined) probe(() => { validateHistoryMilestones_ACU(normalized.historyArchive, phase); });
  probe(() => { validateProjection_ACU(normalized.projection, phase); });
  probe(() => { validateLegacyMigration_ACU(normalized.legacyMigration, phase); });
  // 新领域的引用约束与正式入库路径共用校验，避免预检遗漏悬空对象和锁定投影。
  probe(() => { validateLedger_ACU(normalized, phase); });
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
