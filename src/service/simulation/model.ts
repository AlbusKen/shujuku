export const WORLD_SIMULATION_SCHEMA_VERSION_ACU = 1 as const;
export const WORLD_LEDGER_SCHEMA_VERSION_ACU = 5 as const;
export const WORLD_CHRONICLE_OVERVIEW_CAP_ACU = 512 as const;
export const WORLD_CHRONICLE_HOT_WINDOW_ACU = 32 as const;
export const WORLD_GUIDANCE_SIGNAL_MAX_CHARS_ACU = 80 as const;

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
export interface WorldSimulationWorkflowSettings_ACU { chroniclerHotThreshold: number; }
export interface WorldSimulationSettings_ACU { autoTriggerEnabled: boolean; agentHistoryTokenBudget: number; agentReadTokenBudget: number | string; agentReadFallbackTokens: number; agentRunBudget: WorldSimulationRunBudget_ACU; webResearch: WorldSimulationWebResearchSettings_ACU; apiPresetMode: 'current' | 'fixed'; fixedApiPresetName: string; agentApiPresets: Record<string, { mode: 'current' | 'fixed'; presetName: string }>; agentPrompts: Record<string, WorldSimulationPromptSegment_ACU[]>; dynamics: WorldSimulationDynamicsSettings_ACU; workflow: WorldSimulationWorkflowSettings_ACU; promptForceDefaultVersion?: string; }

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
export interface WorldChronicleOverviewRow_ACU { fingerprint: string; day: number; oneLine: string; archiveRef: string; }
export interface WorldGuidance_ACU { signals: WorldGuidanceSignal_ACU[]; excludedFacts: string[]; evidenceRefs: string[]; }

export const WORLD_SIMULATION_LEDGER_MODULES_ACU = ['clock', 'dimensions', 'seeds', 'actors', 'chronicle', 'guidance', 'rumors', 'player'] as const;
export type WorldSimulationLedgerModule_ACU = typeof WORLD_SIMULATION_LEDGER_MODULES_ACU[number];
export const WORLD_SIMULATION_MATERIAL_COMPLETION_STATES_ACU = [
  'complete_changed',
  'complete_no_change',
  'partial',
  'failed',
  'legacy_unknown',
] as const;
export type WorldSimulationMaterialCompletionState_ACU = typeof WORLD_SIMULATION_MATERIAL_COMPLETION_STATES_ACU[number];

export const WORLD_SIMULATION_PENDING_FIX_SOURCES_ACU = [
  'truncated',
  'contract_rejected',
  'protocol_failed',
  'invoke_failed',
  'transaction_rejected',
] as const;
export type WorldSimulationPendingFixSource_ACU = typeof WORLD_SIMULATION_PENDING_FIX_SOURCES_ACU[number];

export interface WorldSimulationMaterialCompletionRecord_ACU {
  state: WorldSimulationMaterialCompletionState_ACU;
  expectedModules: WorldSimulationLedgerModule_ACU[];
  modules: Partial<Record<WorldSimulationLedgerModule_ACU, WorldSimulationMaterialCompletionState_ACU>>;
  sourceRunId: string;
  updatedAt: number;
}

export interface WorldSimulationPendingAnchor_ACU {
  messageKey: string;
  swipeId: string;
  contentDigest: string;
  baseLedgerRevision: number;
}

export interface WorldSimulationPendingFixViolation_ACU { path: string; message: string; }
export interface WorldSimulationPendingFix_ACU {
  module: WorldSimulationLedgerModule_ACU;
  candidateId: string;
  agentName: string;
  violations: WorldSimulationPendingFixViolation_ACU[];
  attempts: number;
  firstFailedAtDay: number;
  lastError: string;
  source: WorldSimulationPendingFixSource_ACU;
  completion: 'partial' | 'failed';
  acceptedKeys: string[];
  anchor: WorldSimulationPendingAnchor_ACU | null;
  createdAt: number;
  updatedAt: number;
}
export interface WorldSimulationLedger_ACU {
  schemaVersion: typeof WORLD_LEDGER_SCHEMA_VERSION_ACU;
  revision: number;
  clock: WorldClock_ACU; dimensions: WorldDimension_ACU[]; seeds: WorldSeed_ACU[]; actors: WorldActor_ACU[];
  chronicle: WorldChronicleEntry_ACU[]; rumors: WorldRumor_ACU[]; player: WorldPlayer_ACU; guidance: WorldGuidance_ACU;
  chronicleOverview: WorldChronicleOverviewRow_ACU[];
  materialCompletion: WorldSimulationMaterialCompletionRecord_ACU;
  pendingFixes: WorldSimulationPendingFix_ACU[];
}

export const WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU = {
  clock: ['day', 'slot', 'storyTime', 'precision', 'evidenceRefs'],
  dimensions: ['id', 'name', 'kind', 'value', 'trend', 'rationale', 'evidenceRefs', 'revision'],
  seeds: ['id', 'title', 'status', 'level', 'catalyst', 'visibility', 'actorIds', 'location', 'expiresAtDay', 'missedOutcome', 'exposePolicy', 'evidenceRefs', 'retiredReason', 'revision'],
  actors: ['id', 'name', 'interests', 'location', 'locationRef', 'life', 'diedAtDay', 'deathSummary', 'resources', 'goals', 'constraints', 'informationSources', 'knownFacts', 'visibility', 'revision'],
  chronicle: ['id', 'at', 'summary', 'relatedIds', 'evidenceRefs'],
  guidance: ['signals', 'excludedFacts', 'evidenceRefs'],
  rumors: ['id', 'fact', 'originDay', 'earliestRevealDay', 'channels', 'relatedActorIds', 'status', 'revealedAtDay', 'revision'],
} as const;

/** 推演单例模块（clock/player/guidance）在分栏视图中的固定 ID。 */
export const WORLD_SIMULATION_SINGLETON_ID_ACU = '_' as const;

/** 推演逐栏写入值。unset 为 true 表示撤销该栏；否则 value 必须是该模块栏目矩阵允许的 JSON 值。 */
export interface WorldSimulationLedgerFieldWrite_ACU {
  value?: unknown;
  unset?: boolean;
}

/** 推演逐栏写集：模块 → ID → 栏目 → 写入值。单例模块使用固定 ID '_'；只点名本次提交的栏目。 */
export type WorldSimulationLedgerFieldUpserts_ACU = Partial<Record<WorldSimulationLedgerModule_ACU, Record<string, Record<string, WorldSimulationLedgerFieldWrite_ACU>>>>;

/**
 * 推演分栏条目状态：complete 是经逐栏写入提升（或逐栏更新过）的账本条目；partial 仅在受控分栏视图可见，
 * 不并入完整账本；legacy_unknown 是来自旧整条账本或整条提交的条目。complete 与 legacy_unknown 都在账本里。
 */
export const WORLD_SIMULATION_LEDGER_FIELD_STATUSES_ACU = ['complete', 'partial', 'legacy_unknown'] as const;
export type WorldSimulationLedgerFieldStatus_ACU = typeof WORLD_SIMULATION_LEDGER_FIELD_STATUSES_ACU[number];

/** 单条已接受的推演分栏栏目值及其修订身份。 */
export interface WorldSimulationLedgerFieldValue_ACU {
  value: unknown;
  revision: number;
  updatedAt: number;
}

/** 一个 (module, ID) 的推演分栏记录。 */
export interface WorldSimulationLedgerFieldRecord_ACU {
  module: WorldSimulationLedgerModule_ACU;
  id: string;
  status: WorldSimulationLedgerFieldStatus_ACU;
  fields: Record<string, WorldSimulationLedgerFieldValue_ACU>;
  missingFields: string[];
  updatedAt: number;
}

/** 折叠派生的推演分栏视图：只读，绝不写回持久帧。 */
export interface WorldSimulationLedgerFieldSnapshot_ACU {
  records: Partial<Record<WorldSimulationLedgerModule_ACU, Record<string, WorldSimulationLedgerFieldRecord_ACU>>>;
}

/**
 * 推演模块的栏目矩阵：fields 是分栏视图可见的栏目（含机器栏 revision）；required 是提升为完整账本条目前
 * 模型必须写过的栏目（与字段纪律一致，合法空值也算写过）；consistencyGroups 是不可拆开校验的跨字段组。
 */
export interface WorldSimulationLedgerFieldMatrixEntry_ACU {
  fields: readonly string[];
  required: readonly string[];
  consistencyGroups: ReadonlyArray<readonly string[]>;
}

/**
 * 各推演模块的栏目矩阵。required 列出逐栏提交提升完整条目所需的业务栏目；
 * 可空/可缺省栏（actorIds、expiresAtDay、exposePolicy、locationRef、earliestRevealDay 等）提升时按领域缺省补齐，
 * revision 由入库层接管。单例（clock/player/guidance）恒为完整记录，逐栏更新按 patch 语义合并。
 */
export const WORLD_SIMULATION_LEDGER_FIELD_MATRIX_ACU: Record<WorldSimulationLedgerModule_ACU, WorldSimulationLedgerFieldMatrixEntry_ACU> = {
  clock: { fields: ['day', 'slot', 'storyTime', 'precision', 'evidenceRefs'], required: ['day', 'slot', 'storyTime', 'precision', 'evidenceRefs'], consistencyGroups: [] },
  dimensions: { fields: ['name', 'kind', 'value', 'trend', 'rationale', 'evidenceRefs', 'revision'], required: ['name', 'kind', 'value', 'trend', 'rationale', 'evidenceRefs'], consistencyGroups: [] },
  seeds: { fields: ['title', 'status', 'level', 'catalyst', 'visibility', 'actorIds', 'location', 'expiresAtDay', 'missedOutcome', 'exposePolicy', 'evidenceRefs', 'retiredReason', 'revision'], required: ['title', 'status', 'level', 'catalyst', 'visibility', 'location', 'evidenceRefs'], consistencyGroups: [['status', 'retiredReason']] },
  actors: { fields: ['name', 'interests', 'location', 'locationRef', 'life', 'diedAtDay', 'deathSummary', 'resources', 'goals', 'constraints', 'informationSources', 'knownFacts', 'visibility', 'revision'], required: ['name', 'interests', 'location', 'goals', 'informationSources', 'knownFacts'], consistencyGroups: [['life', 'diedAtDay', 'deathSummary']] },
  chronicle: { fields: ['at', 'summary', 'relatedIds', 'evidenceRefs'], required: ['summary'], consistencyGroups: [] },
  guidance: { fields: ['signals', 'excludedFacts', 'evidenceRefs'], required: ['signals', 'excludedFacts', 'evidenceRefs'], consistencyGroups: [] },
  rumors: { fields: ['fact', 'originDay', 'earliestRevealDay', 'channels', 'relatedActorIds', 'status', 'revealedAtDay', 'revision'], required: ['fact', 'originDay', 'channels'], consistencyGroups: [['originDay', 'earliestRevealDay'], ['status', 'revealedAtDay']] },
  player: { fields: ['location', 'locationUpdatedAtDay', 'regionVisits', 'contact', 'evidenceRefs'], required: ['location', 'locationUpdatedAtDay', 'regionVisits', 'contact', 'evidenceRefs'], consistencyGroups: [] },
};


export function formatWorldSimulationLedgerRequiredFieldsLegacy_ACU(): string {
  return '字段纪律：dimensions 必须给 id,name,kind,value,trend,rationale,evidenceRefs；seeds 必须给 id,title,status,level,catalyst,visibility,location,evidenceRefs；actors 必须给 id,name,interests,location,goals,informationSources,knownFacts,evidenceRefs；rumors 必须给 id,fact,originDay,channels,evidenceRefs。rationale（依据摘要）、catalyst（催化条件）、interests/goals/knownFacts 等说明性字段必须给出有内容的非空值，禁止留空或写"暂无/未知"凑数；证据不足时不要新建该条目，把缺口写进 uncertainties。仅机器字段可省略：revision 由入库层接管，expiresAtDay/missedOutcome/locationRef 等可空项按缺省补齐；更新已有条目可只提交变更字段';
}

export function formatWorldSimulationLedgerRequiredFields_ACU(): string {
  return '字段纪律（逐栏 SQL）：dimensions 新行需 name,kind,value,trend,rationale,evidence_refs；seeds 新行需 title,status,level,catalyst,visibility,location,evidence_refs；actors 新行需 name,interests,location,goals,information_sources,known_facts；rumors 新行需 fact,origin_day,channels。数组行 INSERT 的 id 可省略，由系统生成；dimensions/seeds/actors/rumors 的 INSERT 仍须显式给 expected_revision=0，chronicle INSERT 不带修订号。actors/rumors 不写 evidence_refs；其他需要该栏的模块只使用真实已颁发证据。rationale、catalyst、interests/goals/known_facts 等说明性字段必须给出真实内容，不写"暂无/未知"凑数；缺少事实依据时把缺口写进 uncertainties。revision 由保存层接管；actor_ids、expires_at_day、missed_outcome、location_ref 等可缺省栏目按领域规则补齐；已保存草稿按 missingFields 仅 UPDATE 缺栏，不重发 accepted。';
}

export type WorldSimulationStageRevisionReason_ACU = 'initial' | 'automatic_replan' | 'manual_replan' | 'resume_repair';
export type WorldSimulationTimelineKind_ACU = 'task_created' | 'plan_ready' | 'stage_started' | 'stage_completed' | 'paused' | 'resumed' | 'stopped' | 'committed' | 'no_change' | 'blocked' | 'failed' | 'swept' | 'progressed';

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
  /** 已结算的自动触发锚点；提交改写正文时记录改写后的摘要，防止完成事件重放。 */
  completedAutoAnchor?: Pick<import('./agent/agent-model').WorldSimulationAnchorIdentity_ACU, 'chatIdentity' | 'messageKey' | 'swipeId' | 'contentDigest'>;
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
