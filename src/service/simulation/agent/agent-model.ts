import type { WorldSimulationLedger_ACU } from '../model';

export const WORLD_SIMULATION_STATE_FIELD_ACU = '_qrf_world_simulation_state';
export const WORLD_SIMULATION_CONVERSATION_FIELD_ACU = '_qrf_world_simulation_agent_chat';
export const WORLD_SIMULATION_MATERIALS_FIELD_ACU = '_qrf_world_simulation_agent_materials';
export const WORLD_SIMULATION_BUCKET_SCHEMA_VERSION_ACU = 1 as const;
export const WORLD_SIMULATION_CONVERSATION_SCHEMA_VERSION_ACU = 1 as const;
export const WORLD_SIMULATION_MATERIALS_SCHEMA_VERSION_ACU = 1 as const;

export interface WorldSimulationAnchorIdentity_ACU { chatIdentity: string; messageIndex: number; messageId: string | number; messageKey: string; swipeId: string; contentDigest: string; }
export interface WorldSimulationBucketEntry_ACU<T> { anchor: WorldSimulationAnchorIdentity_ACU; value: T; updatedAt: number; }
export const WORLD_SIMULATION_RUN_STATE_FIELD_ACU = '_qrf_world_simulation_agent_run';
export const WORLD_SIMULATION_RUN_STATE_SCHEMA_VERSION_ACU = 1 as const;
export interface WorldSimulationRunResumeState_ACU {
  taskId: string;
  cursorKey: string;
  nextIteration: number;
  delegationsUsed: number;
  perAgent: Record<string, number>;
  outcomes: WorldSimulationRunOutcome_ACU[];
  candidateFingerprint: string;
  candidateSummary: string;
  reviewerFeedback: string;
  candidates?: WorldSimulationCandidate_ACU[];
  subagentOutcomes?: WorldSimulationSubagentOutcome_ACU[];
  evidenceSnapshot?: import('../world-simulation-evidence-registry').WorldSimulationEvidenceRegistrySnapshot_ACU;
  /** 主 Agent 对话 transcript（assistant 原始输出与 user 反馈）。随 persist 增量落楼层，恢复时回填。 */
  transcript?: Array<{ role: string; content: string }>;
}
export interface WorldSimulationRunStateRecord_ACU {
  schemaVersion: typeof WORLD_SIMULATION_RUN_STATE_SCHEMA_VERSION_ACU;
  taskId: string;
  cursorKey: string;
  updatedAt: number;
  state: WorldSimulationRunResumeState_ACU;
}

export interface WorldSimulationBucket_ACU<T> { schemaVersion: typeof WORLD_SIMULATION_BUCKET_SCHEMA_VERSION_ACU; entries: Record<string, WorldSimulationBucketEntry_ACU<T>>; }

export const WORLD_SIMULATION_MESSAGE_KINDS_ACU = ['user', 'agent', 'tool', 'runtime', 'turn', 'handoff'] as const;
export type WorldSimulationMessageKind_ACU = typeof WORLD_SIMULATION_MESSAGE_KINDS_ACU[number];
export type WorldSimulationConversationEventStatus_ACU = 'running' | 'done' | 'failed';
export interface WorldSimulationConversationEventMetadata_ACU {
  eventKind?: string;
  title?: string;
  status?: WorldSimulationConversationEventStatus_ACU;
  agentName?: string;
  ok?: boolean;
}
export interface WorldSimulationConversationMessage_ACU extends WorldSimulationConversationEventMetadata_ACU {
  id: number; kind: WorldSimulationMessageKind_ACU; text: string; digest: string; turnKey: string; at: number; readKey?: string;
}
export interface WorldSimulationConversationCompaction_ACU { compactedThroughId: number; report: string; at: number; }
export interface WorldSimulationConversationSegment_ACU { schemaVersion: typeof WORLD_SIMULATION_CONVERSATION_SCHEMA_VERSION_ACU; segmentId: string; runId: string; taskId: string; stageId: string; stageRevision: number; messages: WorldSimulationConversationMessage_ACU[]; compaction?: WorldSimulationConversationCompaction_ACU; updatedAt: number; }
export interface WorldSimulationConversationFloorRecord_ACU { schemaVersion: typeof WORLD_SIMULATION_CONVERSATION_SCHEMA_VERSION_ACU; segments: WorldSimulationConversationSegment_ACU[]; updatedAt: number; }
export interface WorldSimulationConversationAppend_ACU extends WorldSimulationConversationEventMetadata_ACU {
  kind: WorldSimulationMessageKind_ACU; text: string; digest?: string; turnKey?: string; readKey?: string;
}

export interface WorldSimulationMaterialsSnapshot_ACU { schemaVersion: typeof WORLD_SIMULATION_MATERIALS_SCHEMA_VERSION_ACU; ledgerRevision: number; ledger: WorldSimulationLedger_ACU; evidenceRefs: string[]; updatedAt: number; }
export interface WorldSimulationConversationView_ACU { nextId: number; messages: WorldSimulationConversationMessage_ACU[]; compaction: WorldSimulationConversationCompaction_ACU | null; diagnostics: string[]; }
export interface WorldSimulationMaterialsReadResult_ACU { snapshot: WorldSimulationMaterialsSnapshot_ACU | null; diagnostics: string[]; adoptedIndex: number | null; }


export interface WorldSimulationProtocolIssue_ACU { reasonCode: string; path: string; expected: string; actual: unknown; }
export interface WorldSimulationDelegation_ACU { agentName: string; instruction: string; reads: string[]; }
export type WorldSimulationTerminalOutcome_ACU = 'commit' | 'no_change' | 'blocked';
export type WorldSimulationToolCall_ACU =
  | { kind: 'read'; reads: string[] }
  | { kind: 'search'; query: string; scope: string[]; maxResults: number; isRegex: boolean };
export type WorldSimulationMainAction_ACU =
  | WorldSimulationToolCall_ACU
  | { kind: 'tools'; calls: WorldSimulationToolCall_ACU[] }
  | { kind: 'delegate'; delegations: WorldSimulationDelegation_ACU[] }
  | { kind: 'finalize'; outcome: WorldSimulationTerminalOutcome_ACU; summary: string; evidenceRefs: string[] }
  | { kind: 'block'; reason: string; unresolved: string[] };
export interface WorldSimulationPlannerOutput_ACU { action: 'plan' | 'replan'; summary: string; plan: import('../model').WorldSimulationStagePlan_ACU; }
export interface WorldSimulationCandidate_ACU {
  candidateId: string;
  agentName: string;
  patch: Record<string, unknown>;
  summary: string;
  evidenceRefs: string[];
  uncertainties: string[];
  writableModules: string[];
}
export type WorldSimulationSpecialistResult_ACU =
  | { status: 'candidate'; agentName: string; patch: Record<string, unknown>; summary: string; evidenceRefs: string[]; uncertainties: string[] }
  | { status: 'no_change'; agentName: string; summary: string; evidenceRefs: string[]; uncertainties: string[] }
  | { status: 'failed'; agentName: string; reasonCode: string; message: string }
  | { status: 'blocked'; agentName: string; unresolved: string[] };
export interface WorldSimulationReviewerFinding_ACU extends WorldSimulationProtocolIssue_ACU { severity: 'blocking' | 'major' | 'minor'; }
export interface WorldSimulationReviewerResult_ACU { verdict: 'accept' | 'revise' | 'reject'; summary: string; findings: WorldSimulationReviewerFinding_ACU[]; acceptedCandidateIds: string[]; }
export interface WorldSimulationSubagentOutcome_ACU {
  agentName: string;
  status: WorldSimulationSpecialistResult_ACU['status'];
  summary: string;
  candidate?: WorldSimulationCandidate_ACU;
  evidenceRefs: string[];
  uncertainties: string[];
  reasonCode?: string;
  unresolved?: string[];
}
export interface WorldSimulationCommitCandidate_ACU {
  runId: string;
  taskId: string;
  stageId: string;
  stageRevision: number;
  baseLedgerRevision: number;
  summary: string;
  acceptedCandidates: WorldSimulationCandidate_ACU[];
  evidenceRefs: string[];
  reviewer: WorldSimulationReviewerResult_ACU;
}
export type WorldSimulationMainLoopResult_ACU =
  | { outcome: 'commit'; summary: string; commitCandidate: WorldSimulationCommitCandidate_ACU; outcomes: WorldSimulationSubagentOutcome_ACU[] }
  | { outcome: 'no_change'; summary: string; outcomes: WorldSimulationSubagentOutcome_ACU[] }
  | { outcome: 'blocked'; summary: string; unresolved: string[]; outcomes: WorldSimulationSubagentOutcome_ACU[] }
;
export interface WorldSimulationHandoffState_ACU { currentGoal: string; effectiveConstraints: string[]; decisions: string[]; completedItems: string[]; pendingItems: string[]; blockers: string[]; continuityFacts: string[]; readKeys: string[]; recentTurns: string[]; }
export interface WorldSimulationRunOutcome_ACU { agentName: string; status: 'candidate' | 'no_change' | 'failed' | 'blocked'; summary: string; fingerprint: string; }
