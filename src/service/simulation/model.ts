export const WORLD_SIMULATION_SCHEMA_VERSION_ACU = 1 as const;
export const WORLD_LEDGER_SCHEMA_VERSION_ACU = 2 as const;

export type WorldSimulationTaskStatus_ACU = 'drafting' | 'paused' | 'running' | 'stopping_after_inflight' | 'completed' | 'abandoned' | 'failed';
export type WorldSimulationStageStatus_ACU = 'planning' | 'running' | 'completed' | 'abandoned' | 'failed';
export type WorldSimulationTriggerKind_ACU = 'assistant_completed' | 'agent_chat_message';
export type WorldSimulationErrorCode_ACU =
  | 'WORLD_SIMULATION_ENVELOPE_INVALID'
  | 'WORLD_SIMULATION_CHAT_UNAVAILABLE'
  | 'WORLD_SIMULATION_CHAT_CHANGED'
  | 'WORLD_SIMULATION_ANCHOR_INVALID'
  | 'WORLD_SIMULATION_ANCHOR_STALE'
  | 'WORLD_SIMULATION_REVISION_CONFLICT'
  | 'WORLD_SIMULATION_PERSIST_FAILED'
  | 'WORLD_SIMULATION_SNAPSHOT_INVALID'
  | 'WORLD_SIMULATION_EVIDENCE_UNAUTHORIZED'
  | 'WORLD_SIMULATION_AGENT_PROTOCOL_INVALID'
  | 'WORLD_SIMULATION_API_PRESET_MISSING'
  | 'WORLD_SIMULATION_CONFIG_INVALID';
export type WorldSimulationErrorPhase_ACU = 'load' | 'persist' | 'anchor' | 'agent_persist' | 'agent_loop' | 'agent_delegate' | 'handoff_summary';

export interface WorldSimulationError_ACU { code: WorldSimulationErrorCode_ACU; phase: WorldSimulationErrorPhase_ACU; message: string; retryable: boolean; details?: Record<string, unknown>; }
export class WorldSimulationValidationError_ACU extends Error { readonly error: WorldSimulationError_ACU; constructor(error: WorldSimulationError_ACU) { super(error.message); this.name = 'WorldSimulationValidationError_ACU'; this.error = error; } }
export function createWorldSimulationError_ACU(code: WorldSimulationErrorCode_ACU, phase: WorldSimulationErrorPhase_ACU, message: string, retryable = false, details?: Record<string, unknown>): WorldSimulationError_ACU { return details ? { code, phase, message, retryable, details } : { code, phase, message, retryable }; }

export interface WorldSimulationPromptSegment_ACU { role: string; content: string; enabled: boolean; deletable: boolean; pinned: boolean; }
export interface WorldSimulationRunBudget_ACU { maxIterations: number; maxDelegations: number; maxSameAgent: number; maxConcurrent: number; maxReads: number; maxExtraReads: number; }
export const WORLD_SIMULATION_WEB_PROVIDERS_ACU = ['duckduckgo', 'serper', 'tavily', 'searxng'] as const;
export type WorldSimulationWebProvider_ACU = typeof WORLD_SIMULATION_WEB_PROVIDERS_ACU[number];
export interface WorldSimulationWebResearchSettings_ACU {
  enabled: boolean;
  sources: { moegirl: boolean; wikipediaZh: boolean; wikipediaEn: boolean };
  searchProvider: WorldSimulationWebProvider_ACU;
  searxngBaseUrl: string;
  pageCharLimit: number;
  blockedDomains: string;
}
export interface WorldSimulationDynamicsSettings_ACU { rumorTTLDays: number; maxClockAdvanceDays: number; collisionEnforcement: 'strict' | 'relaxed'; missedSweepEnabled: boolean; }
export interface WorldSimulationSettings_ACU { autoTriggerEnabled: boolean; agentHistoryTokenBudget: number; agentReadTokenBudget: number | string; agentReadFallbackTokens: number; agentRunBudget: WorldSimulationRunBudget_ACU; webResearch: WorldSimulationWebResearchSettings_ACU; apiPresetMode: 'current' | 'fixed'; fixedApiPresetName: string; agentApiPresets: Record<string, { mode: 'current' | 'fixed'; presetName: string }>; agentPrompts: Record<string, WorldSimulationPromptSegment_ACU[]>; dynamics: WorldSimulationDynamicsSettings_ACU; promptForceDefaultVersion?: string; }

export interface WorldEvidenceRef_ACU { ref: string; source: string; summary: string; }
export function normalizeWorldRegionName_ACU(value: string): string { return value.trim().replace(/\s+/g, ' ').toLowerCase(); }
export interface WorldLocationRef_ACU { region: string; place?: string; }
export const WORLD_GUIDANCE_SIGNAL_VOICES_ACU = ['encounter', 'rumor', 'ambient'] as const;
export type WorldGuidanceSignalVoice_ACU = typeof WORLD_GUIDANCE_SIGNAL_VOICES_ACU[number];
export interface WorldGuidanceSignal_ACU { text: string; voice: WorldGuidanceSignalVoice_ACU; sourceId?: string; }
export const WORLD_SEED_EXPOSE_POLICIES_ACU = ['on_collision', 'gradual', 'public'] as const;
export type WorldSeedExposePolicy_ACU = typeof WORLD_SEED_EXPOSE_POLICIES_ACU[number];
export const WORLD_ACTOR_LIFE_ACU = ['alive', 'missing', 'dead'] as const;
export type WorldActorLife_ACU = typeof WORLD_ACTOR_LIFE_ACU[number];
export const WORLD_RUMOR_STATUSES_ACU = ['latent', 'ripe', 'revealed', 'dead'] as const;
export type WorldRumorStatus_ACU = typeof WORLD_RUMOR_STATUSES_ACU[number];
export const WORLD_PLAYER_CONTACTS_ACU = ['open', 'secluded'] as const;
export type WorldPlayerContact_ACU = typeof WORLD_PLAYER_CONTACTS_ACU[number];
export const WORLD_PLAYER_REGION_VISITS_CAP_ACU = 64 as const;
export interface WorldClockAdvancePatch_ACU { days: number; storyTime?: string; slot?: string; evidenceRefs?: string[]; }
export interface WorldRumor_ACU { id: string; fact: string; originDay: number; earliestRevealDay: number; channels: string[]; relatedActorIds: string[]; status: WorldRumorStatus_ACU; revealedAtDay: number | null; revision: number; }
export interface WorldPlayer_ACU { location: WorldLocationRef_ACU | null; locationUpdatedAtDay: number; regionVisits: Array<{ region: string; day: number }>; contact: WorldPlayerContact_ACU; evidenceRefs: string[]; }
export const WORLD_SIMULATION_PLAYER_REQUIRED_FIELDS_ACU = ['location', 'locationUpdatedAtDay', 'regionVisits', 'contact', 'evidenceRefs'] as const;
export interface WorldCollisionReport_ACU { playerRegion: string | null; playerContact: WorldPlayerContact_ACU; secludedNote: string | null; collidedSeeds: string[]; ripeRumors: string[]; }
export interface WorldClock_ACU { day: number; slot: string; storyTime: string; precision: 'exact' | 'approximate' | 'unknown'; evidenceRefs: string[]; }
export interface WorldDimension_ACU { id: string; name: string; kind: 'pressure' | 'growth'; value: number; trend: 'rising' | 'stable' | 'falling'; rationale: string; evidenceRefs: string[]; revision: number; }
export interface WorldSeed_ACU { id: string; title: string; status: 'established' | 'incubating' | 'active' | 'converging' | 'resolved' | 'retired'; level: number; catalyst: string; visibility: 'hidden' | 'limited' | 'public'; actorIds: string[]; location: WorldLocationRef_ACU | null; expiresAtDay: number | null; missedOutcome: string | null; exposePolicy: WorldSeedExposePolicy_ACU; evidenceRefs: string[]; retiredReason: string | null; revision: number; }
export interface WorldActor_ACU { id: string; name: string; interests: string[]; location: string; locationRef: WorldLocationRef_ACU | null; life: WorldActorLife_ACU; diedAtDay: number | null; deathSummary: string | null; resources: string[]; goals: string[]; constraints: string[]; informationSources: string[]; knownFacts: string[]; visibility: 'hidden' | 'limited' | 'public'; revision: number; }
export interface WorldChronicleEntry_ACU { id: string; at: string; summary: string; relatedIds: string[]; evidenceRefs: string[]; }
export interface WorldGuidance_ACU { signals: WorldGuidanceSignal_ACU[]; excludedFacts: string[]; evidenceRefs: string[]; }
export interface WorldSimulationLedger_ACU { schemaVersion: typeof WORLD_LEDGER_SCHEMA_VERSION_ACU; revision: number; clock: WorldClock_ACU; dimensions: WorldDimension_ACU[]; seeds: WorldSeed_ACU[]; actors: WorldActor_ACU[]; chronicle: WorldChronicleEntry_ACU[]; rumors: WorldRumor_ACU[]; player: WorldPlayer_ACU; guidance: WorldGuidance_ACU; }

export const WORLD_SIMULATION_LEDGER_MODULES_ACU = ['clock', 'dimensions', 'seeds', 'actors', 'chronicle', 'guidance', 'rumors', 'player'] as const;
export type WorldSimulationLedgerModule_ACU = typeof WORLD_SIMULATION_LEDGER_MODULES_ACU[number];

export const WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU = {
  clock: ['day', 'slot', 'storyTime', 'precision', 'evidenceRefs'],
  dimensions: ['id', 'name', 'kind', 'value', 'trend', 'rationale', 'evidenceRefs', 'revision'],
  seeds: ['id', 'title', 'status', 'level', 'catalyst', 'visibility', 'actorIds', 'location', 'expiresAtDay', 'missedOutcome', 'exposePolicy', 'evidenceRefs', 'retiredReason', 'revision'],
  actors: ['id', 'name', 'interests', 'location', 'locationRef', 'life', 'diedAtDay', 'deathSummary', 'resources', 'goals', 'constraints', 'informationSources', 'knownFacts', 'visibility', 'revision'],
  chronicle: ['id', 'at', 'summary', 'relatedIds', 'evidenceRefs'],
  guidance: ['signals', 'excludedFacts', 'evidenceRefs'],
  rumors: ['id', 'fact', 'originDay', 'earliestRevealDay', 'channels', 'relatedActorIds', 'status', 'revealedAtDay', 'revision'],
} as const;

export function formatWorldSimulationLedgerRequiredFields_ACU(): string {
  const modules = Object.keys(WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU) as Array<keyof typeof WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU>;
  return [
    ...modules.map(module => `${module}: ${WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU[module].join(',')}`),
    `player: ${WORLD_SIMULATION_PLAYER_REQUIRED_FIELDS_ACU.join(',')}`,
  ].join('；');
}

export type WorldSimulationStageRevisionReason_ACU = 'initial' | 'automatic_replan' | 'manual_replan' | 'resume_repair';
export type WorldSimulationTimelineKind_ACU = 'task_created' | 'plan_ready' | 'stage_started' | 'stage_completed' | 'paused' | 'resumed' | 'stopped' | 'committed' | 'no_change' | 'blocked' | 'failed' | 'swept';

export interface WorldSimulationStagePlan_ACU {
  schemaVersion: typeof WORLD_SIMULATION_SCHEMA_VERSION_ACU;
  title: string;
  objective: string;
  impactScope: string[];
  factsToVerify: string[];
  plannedTools: string[];
  plannedSpecialists: string[];
  expectedLedgerChanges: Array<WorldSimulationLedgerModule_ACU>;
  convergenceConditions: string[];
  blockingConditions: string[];
  completedSteps: string[];
  nextStep: string;
}

export interface WorldSimulationStageRevision_ACU {
  revision: number;
  createdAt: number;
  reason: WorldSimulationStageRevisionReason_ACU;
  replanInstruction: string;
  frozen: boolean;
  plan: WorldSimulationStagePlan_ACU;
}

export interface WorldSimulationStage_ACU {
  stageId: string;
  stageNumber: number;
  status: WorldSimulationStageStatus_ACU;
  activeRevision: number;
  revisions: WorldSimulationStageRevision_ACU[];
}

export interface WorldSimulationRunIdentity_ACU {
  runId: string;
  chatIdentity: string;
  triggerKind: WorldSimulationTriggerKind_ACU;
  triggerConversationMessageId: string | null;
  anchorMessageId: string | number;
  anchorMessageKey: string;
  anchorSwipeId: string;
  anchorContentDigest: string;
  baseLedgerRevision: number;
  taskId: string;
  stageId: string;
  stageRevision: number;
}

export interface WorldSimulationTask_ACU {
  taskId: string;
  originInstruction: string;
  status: WorldSimulationTaskStatus_ACU;
  createdAt: number;
  updatedAt: number;
  activeRun: WorldSimulationRunIdentity_ACU | null;
  stopReason: string | null;
}

export interface WorldSimulationTimelineEntry_ACU {
  id: string;
  at: number;
  kind: WorldSimulationTimelineKind_ACU;
  taskId: string;
  stageId?: string;
  revision?: number;
  runId?: string;
  message?: string;
  errorCode?: WorldSimulationErrorCode_ACU;
}

export interface WorldSimulationEnvelope_ACU {
  schemaVersion: typeof WORLD_SIMULATION_SCHEMA_VERSION_ACU;
  settings: WorldSimulationSettings_ACU;
  task: WorldSimulationTask_ACU | null;
  stages: WorldSimulationStage_ACU[];
  activeStageId: string | null;
  timeline: WorldSimulationTimelineEntry_ACU[];
  lastError: WorldSimulationError_ACU | null;
  ledger: WorldSimulationLedger_ACU;
  updatedAt: number;
}

export interface WorldSimulationWriteGuard_ACU {
  chatIdentity: string;
  taskId?: string | null;
  stageId?: string | null;
  revision?: number | null;
}
