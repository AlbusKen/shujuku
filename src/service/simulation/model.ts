export const WORLD_SIMULATION_LEGACY_SCHEMA_VERSION_ACU = 1 as const;
export const WORLD_SIMULATION_SCHEMA_VERSION_ACU = 2 as const;

export type WorldSimulationScale_ACU = 'light' | 'normal' | 'deep';
export type WorldReadBudgetTier_ACU = 'low' | 'medium' | 'high';
export type WorldVisibilityPolicy_ACU = 'agent' | 'always_hidden' | 'always_revealed';
export type WorldClockPrecision_ACU = 'exact' | 'approximate' | 'unknown';
export type WorldEntityImportance_ACU = 'core' | 'active' | 'background';
export type WorldSimulationAgentName_ACU = 'world-director' | 'entity-movement' | 'faction-events' | 'thread-weaver';
export type WorldSimulationPromptRole_ACU = 'system' | 'user' | 'assistant';
export interface WorldSimulationPromptSegment_ACU { role: WorldSimulationPromptRole_ACU; content: string; enabled: boolean; deletable: boolean; }
export type WorldSimulationAgentPrompts_ACU = Record<WorldSimulationAgentName_ACU, WorldSimulationPromptSegment_ACU[]>;

export interface WorldSimulationBudget_ACU {
  maxIterations: number;
  maxDelegations: number;
  maxReads: number;
  readTokenBudget: WorldReadBudgetTier_ACU;
}

export interface WorldStoryClock_ACU {
  anchorText: string;
  elapsedSinceLastRun: string;
  precision: WorldClockPrecision_ACU;
  evidenceIndexes: number[];
  updatedIndex: number;
}

export type WorldVisibility_ACU =
  | { mode: 'hidden'; reason?: string }
  | { mode: 'rumored'; reason?: string }
  | { mode: 'revealed'; revealedIndex?: number; reason?: string };

interface WorldEntityBase_ACU {
  id: string;
  name: string;
  importance: WorldEntityImportance_ACU;
  situation: string;
  agenda: string;
  lastMovedIndex: number;
  lastMovedAt: string;
  visibility: WorldVisibility_ACU;
  retired: boolean;
  retiredReason?: string;
  updatedIndex: number;
}

export type WorldEntity_ACU =
  | (WorldEntityBase_ACU & { kind: 'character' })
  | (WorldEntityBase_ACU & { kind: 'faction' })
  | (WorldEntityBase_ACU & { kind: 'location' });

export type WorldEntityKind_ACU = WorldEntity_ACU['kind'];

export interface WorldEvent_ACU {
  id: string;
  summary: string;
  actorIds: string[];
  occurredIndex: number;
  occurredAt: string;
  durationHint?: string;
  visibility: WorldVisibility_ACU;
  consequenceHint?: string;
  retired: boolean;
  retiredReason?: string;
  updatedIndex: number;
}

interface WorldThreadBase_ACU {
  id: string;
  title: string;
  summary: string;
  visibility: WorldVisibility_ACU;
  expectedSurfaceHint?: string;
  relatedEventIds: string[];
  retired: boolean;
  retiredReason?: string;
  updatedIndex: number;
}

export type WorldThread_ACU =
  | (WorldThreadBase_ACU & { status: 'brewing' })
  | (WorldThreadBase_ACU & { status: 'active' })
  | (WorldThreadBase_ACU & { status: 'converging' })
  | (WorldThreadBase_ACU & { status: 'closed' });

export type WorldThreadStatus_ACU = WorldThread_ACU['status'];

/** Stable identity of the active AI page that owns a per-swipe ledger entry. */
export interface WorldSimulationSwipeIdentity_ACU {
  messageIndex: number;
  messageKey: string;
  swipeIndex: number;
  baseTextHash: string;
}

export interface WorldModuleRevisions_ACU {
  entities: number;
  events: number;
  threads: number;
}

export interface WorldStateSnapshot_ACU {
  anchorMessageIndex: number;
  storyClock: WorldStoryClock_ACU;
  entities: WorldEntity_ACU[];
  events: WorldEvent_ACU[];
  threads: WorldThread_ACU[];
  revisions: WorldModuleRevisions_ACU;
}

export type WorldSimulationRealtimePacing_ACU = 'normal' | 'fast';

/** Runtime facts supplied by the future orchestrator before paying for the AI gate. */
export interface WorldSimulationGateLocalState_ACU {
  enabled: boolean;
  flightModeActive: boolean;
  isSimulating: boolean;
  chatIdentity: string;
  lastSimulationChatIdentity?: string | null;
  branchReparsed: boolean;
  newAiFloorCount: number;
  minFloorGap: number;
}

export interface WorldSimulationGateInput_ACU {
  anchorMessageIndex: number;
  local: WorldSimulationGateLocalState_ACU;
  realtimePacing: WorldSimulationRealtimePacing_ACU;
  recentStoryTail: string;
  activeEntitySummaries: readonly string[];
  lastSimulation?: {
    anchorMessageIndex: number;
    conclusionSummary: string;
    storyClock: WorldStoryClock_ACU;
  } | null;
}

export type WorldSimulationGateDecision_ACU =
  | {
    worthUpdating: false;
    source: 'local' | 'gate' | 'time-policy';
    reason: string;
    storyTime?: WorldStoryClock_ACU;
    focusHints: string[];
  }
  | {
    worthUpdating: true;
    source: 'gate';
    reason: string;
    storyTime: WorldStoryClock_ACU;
    focusHints: string[];
    scale: WorldSimulationScale_ACU;
  };



export interface WorldSimulationSettings_ACU {
  enabled: boolean;
  joinWaitMs: number;
  minFloorGap: number;
  checkpointInterval: number;
  maxTrackedEntities: number;
  visibilityPolicy: WorldVisibilityPolicy_ACU;
  showHiddenInUi: boolean;
  budgets: Record<WorldSimulationScale_ACU, WorldSimulationBudget_ACU>;
  agentPrompts: WorldSimulationAgentPrompts_ACU;
}

export interface WorldSimulationEnvelope_ACU {
  schemaVersion: number;
  settings: WorldSimulationSettings_ACU;
  state: WorldStateSnapshot_ACU;
}

/** Persisted extension key within one IsolationTagData slot. */
export const WORLD_SIMULATION_FIELD_ACU = 'worldSimulation' as const;

/** A module-level state delta: only supplied module arrays replace their prior replay value. */
export interface WorldStateDelta_ACU {
  anchorMessageIndex: number;
  storyClock: WorldStoryClock_ACU;
  entities?: WorldEntity_ACU[];
  events?: WorldEvent_ACU[];
  threads?: WorldThread_ACU[];
  revisions: WorldModuleRevisions_ACU;
}

export type WorldSimulationModule_ACU = keyof WorldModuleRevisions_ACU;

export type WorldEntityTransactionItem_ACU =
  | { action: 'upsert'; value: WorldEntity_ACU }
  | { action: 'retire'; id: string; reason: string };
export type WorldEventTransactionItem_ACU =
  | { action: 'upsert'; value: WorldEvent_ACU }
  | { action: 'retire'; id: string; reason: string };
export type WorldThreadTransactionItem_ACU =
  | { action: 'upsert'; value: WorldThread_ACU }
  | { action: 'retire'; id: string; reason: string };

/** Explicit write set. Every non-empty module requires its exact read revision. */
export interface WorldSimulationTransaction_ACU {
  anchorMessageIndex: number;
  storyClock: WorldStoryClock_ACU;
  expectedRevisions: Partial<WorldModuleRevisions_ACU>;
  entities: WorldEntityTransactionItem_ACU[];
  events: WorldEventTransactionItem_ACU[];
  threads: WorldThreadTransactionItem_ACU[];
}

export interface WorldSimulationCheckpointRecord_ACU {
  version: typeof WORLD_SIMULATION_LEGACY_SCHEMA_VERSION_ACU;
  kind: 'checkpoint';
  id: string;
  anchorMessageIndex: number;
  state: WorldStateSnapshot_ACU;
}

export interface WorldSimulationDeltaRecord_ACU {
  version: typeof WORLD_SIMULATION_LEGACY_SCHEMA_VERSION_ACU;
  kind: 'delta';
  id: string;
  anchorMessageIndex: number;
  delta: WorldStateDelta_ACU;
}

export type WorldSimulationLedgerRecord_ACU = WorldSimulationCheckpointRecord_ACU | WorldSimulationDeltaRecord_ACU;

/** Metadata binding a user-visible trailing projection to its authoritative ledger entry. */
export interface WorldSimulationProjectionMetadata_ACU {
  version: 1;
  blockHash: string;
  baseTextHash: string;
  publicEntryIds: string[];
}

/** One selected swipe's record at its physical AI message location. */
export interface WorldSimulationSwipeLedgerEntry_ACU {
  swipe: WorldSimulationSwipeIdentity_ACU;
  parentReplayDigest: string | null;
  sourceAnchorMessageIndex: number;
  coverageStartMessageIndex: number;
  coverageEndMessageIndex: number;
  /** null means a hidden-only ledger commit deliberately owns no terminal public block. */
  projection: WorldSimulationProjectionMetadata_ACU | null;
  record: WorldSimulationLedgerRecord_ACU;
}

/** Version 2 allows multiple independent active/inactive swipe branches per message. */
export interface WorldSimulationPerSwipeEnvelope_ACU {
  version: typeof WORLD_SIMULATION_SCHEMA_VERSION_ACU;
  kind: 'per_swipe';
  entries: WorldSimulationSwipeLedgerEntry_ACU[];
}

export type WorldSimulationPersistedValue_ACU = WorldSimulationLedgerRecord_ACU | WorldSimulationPerSwipeEnvelope_ACU;

export type WorldSimulationErrorCode_ACU =
  | 'WORLD_SIM_GATE_FAILED'
  | 'WORLD_SIM_PROTOCOL_INVALID'
  | 'WORLD_SIM_STALE'
  | 'WORLD_SIM_CONFLICT'
  | 'WORLD_SIM_REBASE_REQUIRED'
  | 'WORLD_SIM_REBASE_REJECTED'
  | 'WORLD_SIM_JOIN_TIMEOUT'
  | 'WORLD_SIM_BUDGET_EXCEEDED'
  | 'WORLD_SIM_PERSIST_FAILED'
  | 'WORLD_SIM_INJECTION_FAILED'
  | 'WORLD_SIM_READ_FAILED';

export type WorldSimulationErrorPhase_ACU = 'gate' | 'protocol' | 'agent' | 'replay' | 'transaction' | 'persist' | 'orchestrate' | 'rebase' | 'injection';

export interface WorldSimulationError_ACU {
  code: WorldSimulationErrorCode_ACU;
  phase: WorldSimulationErrorPhase_ACU;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export function createWorldSimError_ACU(
  code: WorldSimulationErrorCode_ACU,
  phase: WorldSimulationErrorPhase_ACU,
  message: string,
  retryable = false,
  details?: Record<string, unknown>,
): WorldSimulationError_ACU {
  return details === undefined ? { code, phase, message, retryable } : { code, phase, message, retryable, details };
}

export class WorldSimulationValidationError_ACU extends Error {
  readonly error: WorldSimulationError_ACU;

  constructor(error: WorldSimulationError_ACU) {
    super(error.message);
    this.name = 'WorldSimulationValidationError_ACU';
    this.error = error;
  }
}

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeInteger_ACU(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function isWorldStoryClock_ACU(value: unknown): value is WorldStoryClock_ACU {
  if (!isRecord_ACU(value)
    || typeof value.anchorText !== 'string'
    || typeof value.elapsedSinceLastRun !== 'string'
    || !Array.isArray(value.evidenceIndexes)
    || !value.evidenceIndexes.every(isNonNegativeInteger_ACU)
    || !isNonNegativeInteger_ACU(value.updatedIndex)) return false;
  return value.precision === 'exact' || value.precision === 'approximate' || value.precision === 'unknown';
}

export function isWorldVisibility_ACU(value: unknown): value is WorldVisibility_ACU {
  if (!isRecord_ACU(value) || typeof value.mode !== 'string') return false;
  if (value.reason !== undefined && typeof value.reason !== 'string') return false;
  switch (value.mode) {
    case 'hidden':
    case 'rumored':
      return true;
    case 'revealed':
      return value.revealedIndex === undefined || isNonNegativeInteger_ACU(value.revealedIndex);
    default:
      return false;
  }
}

export function isWorldStableId_ACU(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

export function isWorldModuleRevisions_ACU(value: unknown): value is WorldModuleRevisions_ACU {
  return isRecord_ACU(value)
    && isNonNegativeInteger_ACU(value.entities)
    && isNonNegativeInteger_ACU(value.events)
    && isNonNegativeInteger_ACU(value.threads);
}

export function isWorldEntity_ACU(value: unknown): value is WorldEntity_ACU {
  if (!isRecord_ACU(value) || !['character', 'faction', 'location'].includes(String(value.kind))) return false;
  return isWorldStableId_ACU(value.id) && typeof value.name === 'string'
    && ['core', 'active', 'background'].includes(String(value.importance))
    && typeof value.situation === 'string' && typeof value.agenda === 'string'
    && isNonNegativeInteger_ACU(value.lastMovedIndex) && typeof value.lastMovedAt === 'string'
    && isWorldVisibility_ACU(value.visibility) && typeof value.retired === 'boolean'
    && (value.retiredReason === undefined || typeof value.retiredReason === 'string')
    && isNonNegativeInteger_ACU(value.updatedIndex);
}

export function isWorldEvent_ACU(value: unknown): value is WorldEvent_ACU {
  return isRecord_ACU(value) && isWorldStableId_ACU(value.id) && typeof value.summary === 'string'
    && Array.isArray(value.actorIds) && value.actorIds.every(isWorldStableId_ACU)
    && isNonNegativeInteger_ACU(value.occurredIndex) && typeof value.occurredAt === 'string'
    && (value.durationHint === undefined || typeof value.durationHint === 'string')
    && isWorldVisibility_ACU(value.visibility)
    && (value.consequenceHint === undefined || typeof value.consequenceHint === 'string')
    && typeof value.retired === 'boolean' && (value.retiredReason === undefined || typeof value.retiredReason === 'string')
    && isNonNegativeInteger_ACU(value.updatedIndex);
}

export function isWorldThread_ACU(value: unknown): value is WorldThread_ACU {
  return isRecord_ACU(value) && isWorldStableId_ACU(value.id) && typeof value.title === 'string'
    && ['brewing', 'active', 'converging', 'closed'].includes(String(value.status))
    && typeof value.summary === 'string' && (value.expectedSurfaceHint === undefined || typeof value.expectedSurfaceHint === 'string')
    && Array.isArray(value.relatedEventIds) && value.relatedEventIds.every(isWorldStableId_ACU)
    && isWorldVisibility_ACU(value.visibility)
    && typeof value.retired === 'boolean' && (value.retiredReason === undefined || typeof value.retiredReason === 'string')
    && isNonNegativeInteger_ACU(value.updatedIndex);
}

export function isWorldStateSnapshot_ACU(value: unknown): value is WorldStateSnapshot_ACU {
  return isRecord_ACU(value) && isNonNegativeInteger_ACU(value.anchorMessageIndex)
    && isWorldStoryClock_ACU(value.storyClock)
    && Array.isArray(value.entities) && value.entities.every(isWorldEntity_ACU)
    && Array.isArray(value.events) && value.events.every(isWorldEvent_ACU)
    && Array.isArray(value.threads) && value.threads.every(isWorldThread_ACU)
    && isWorldModuleRevisions_ACU(value.revisions);
}

function assertNever_ACU(value: never): never {
  throw new Error(`Unhandled world simulation discriminant: ${String(value)}`);
}

export function describeWorldVisibility_ACU(visibility: WorldVisibility_ACU): string {
  switch (visibility.mode) {
    case 'hidden': return '暗线';
    case 'rumored': return '传闻层';
    case 'revealed': return '已揭示';
    default: return assertNever_ACU(visibility);
  }
}

export function describeWorldEntityKind_ACU(kind: WorldEntityKind_ACU): string {
  switch (kind) {
    case 'character': return '角色';
    case 'faction': return '势力';
    case 'location': return '地点';
    default: return assertNever_ACU(kind);
  }
}

export function describeWorldThreadStatus_ACU(status: WorldThreadStatus_ACU): string {
  switch (status) {
    case 'brewing': return '酝酿中';
    case 'active': return '推进中';
    case 'converging': return '收束中';
    case 'closed': return '已结束';
    default: return assertNever_ACU(status);
  }
}
