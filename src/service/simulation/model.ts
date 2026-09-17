export const WORLD_SIMULATION_SCHEMA_VERSION_ACU = 1 as const;
export const WORLD_LEDGER_SCHEMA_VERSION_ACU = 1 as const;

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
export interface WorldSimulationSettings_ACU { autoTriggerEnabled: boolean; agentHistoryTokenBudget: number; agentReadTokenBudget: number | string; agentReadFallbackTokens: number; agentRunBudget: WorldSimulationRunBudget_ACU; webResearch: WorldSimulationWebResearchSettings_ACU; apiPresetMode: 'current' | 'fixed'; fixedApiPresetName: string; agentApiPresets: Record<string, { mode: 'current' | 'fixed'; presetName: string }>; agentPrompts: Record<string, WorldSimulationPromptSegment_ACU[]>; promptForceDefaultVersion?: string; }

export interface WorldEvidenceRef_ACU { ref: string; source: string; summary: string; }
export interface WorldClock_ACU { storyTime: string; elapsed: string; precision: 'exact' | 'approximate' | 'unknown'; evidenceRefs: string[]; }
export interface WorldDimension_ACU { id: string; name: string; kind: 'pressure' | 'growth'; value: number; trend: 'rising' | 'stable' | 'falling'; rationale: string; evidenceRefs: string[]; revision: number; }
export interface WorldSeed_ACU { id: string; title: string; status: 'established' | 'incubating' | 'active' | 'converging' | 'resolved' | 'retired'; level: number; catalyst: string; visibility: 'hidden' | 'limited' | 'public'; actorIds: string[]; evidenceRefs: string[]; retiredReason: string | null; revision: number; }
export interface WorldActor_ACU { id: string; name: string; interests: string[]; location: string; resources: string[]; goals: string[]; constraints: string[]; informationSources: string[]; knownFacts: string[]; visibility: 'hidden' | 'limited' | 'public'; revision: number; }
export interface WorldChronicleEntry_ACU { id: string; at: string; summary: string; relatedIds: string[]; evidenceRefs: string[]; }
export interface WorldGuidance_ACU { signals: string[]; excludedFacts: string[]; evidenceRefs: string[]; }
export interface WorldSimulationLedger_ACU { schemaVersion: typeof WORLD_LEDGER_SCHEMA_VERSION_ACU; revision: number; clock: WorldClock_ACU; dimensions: WorldDimension_ACU[]; seeds: WorldSeed_ACU[]; actors: WorldActor_ACU[]; chronicle: WorldChronicleEntry_ACU[]; guidance: WorldGuidance_ACU; }

export const WORLD_SIMULATION_LEDGER_MODULES_ACU = ['clock', 'dimensions', 'seeds', 'actors', 'chronicle', 'guidance'] as const;
export type WorldSimulationLedgerModule_ACU = typeof WORLD_SIMULATION_LEDGER_MODULES_ACU[number];

export type WorldSimulationStageRevisionReason_ACU = 'initial' | 'automatic_replan' | 'manual_replan' | 'resume_repair';
export type WorldSimulationTimelineKind_ACU = 'task_created' | 'plan_ready' | 'stage_started' | 'stage_completed' | 'paused' | 'resumed' | 'stopped' | 'committed' | 'no_change' | 'blocked' | 'failed';

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
