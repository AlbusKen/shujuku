import { sha256HexSync_ACU } from '../../../shared/sha256-sync';
import { formatWorldSimulationLedgerRequiredFields_ACU, type WorldCollisionReport_ACU, type WorldSimulationLedger_ACU, type WorldSimulationLedgerModule_ACU, type WorldSimulationRunIdentity_ACU, type WorldSimulationSettings_ACU } from '../model';
import { applyWorldSimulationCandidatesDetailedViaSql_ACU, preflightWorldSimulationCandidates_ACU } from '../simulation-transaction';
import type { WorldSimulationRunWriteState_ACU } from '../simulation-run-write-state';
import type { WorldSimulationEvidenceRegistry_ACU } from '../world-simulation-evidence-registry';
import { mergeWorldSimulationEvidenceRegistrySnapshot_ACU, snapshotWorldSimulationEvidenceRegistry_ACU } from '../world-simulation-evidence-registry';
import { runWorldSimulationToolBatch_ACU, type WorldSimulationToolDependencies_ACU } from '../world-simulation-agent-tools';
import { resolveWorldSimulationAgentApiPreset_ACU, type WorldSimulationApiPresetDependencies_ACU } from '../api-preset';
import { WORLD_SIMULATION_AGENT_CATALOG_ACU } from './agent-catalog';
import { WORLD_SIMULATION_AGENT_PREFILLS_ACU, worldSimulationDirectorRuntimeProtocolInstruction_ACU } from './agent-defaults';
import type { WorldSimulationCandidate_ACU, WorldSimulationConversationMessage_ACU, WorldSimulationMainLoopResult_ACU, WorldSimulationReviewerResult_ACU, WorldSimulationRunResumeState_ACU, WorldSimulationSubagentOutcome_ACU } from './agent-model';
import type { WorldSimulationAnchorIdentity_ACU } from './agent-model';
import { summarizeWorldSimulationHandoff_ACU } from './agent-handoff-summarizer';
import type { WorldSimulationSessionInput_ACU } from './agent-session-log';
import { createWorldSimulationPlaceholderResolvers_ACU, type WorldSimulationPlaceholderContext_ACU } from './agent-placeholder-resolver';
import { compactWorldSimulationProtocolError_ACU, createWorldSimulationProtocolRepairState_ACU, parseWorldSimulationMainOutput_ACU, recordWorldSimulationProtocolFailure_ACU, renderWorldSimulationDirectorProtocolRejection_ACU } from './agent-protocol';
import { createWorldSimulationReadGateState_ACU } from './agent-read-gate';
import { clearWorldSimulationRunState_ACU, readWorldSimulationRunState_ACU, saveWorldSimulationRunState_ACU } from './agent-run-cache';
import { persistWorldSimulationRunState_ACU, restoreWorldSimulationRunState_ACU, clearWorldSimulationRunStateAtAnchor_ACU } from './agent-run-state-store';
import { beginWorldSimulationSessionRun_ACU, endWorldSimulationSessionRun_ACU, logWorldSimulationSession_ACU, readWorldSimulationSessionLog_ACU, updateWorldSimulationSession_ACU } from './agent-session-log';
import { countWorldSimulationTokens_ACU, measureWorldSimulationPrompt_ACU, type WorldSimulationTokenCounter_ACU } from './agent-token-budget';
import { executeWorldSimulationFinalRequest_ACU } from './final-request-token-gate';
import { renderWorldSimulationPrompt_ACU } from './prompt-template';
import { runWorldSimulationWorkflow_ACU } from './agent-workflow';
import { appendWorldSimulationDirectorHistory_ACU, readWorldSimulationDirectorCompactionSource_ACU, readWorldSimulationDirectorHistory_ACU, readWorldSimulationDirectorRunHistory_ACU, writeWorldSimulationConversationCompaction_ACU } from './agent-conversation-store';
import { planWorldSimulationHistoryCompaction_ACU } from './agent-history-compactor';
import type { WorldSimulationAgentInvoker_ACU, WorldSimulationSubagentRuntime_ACU } from './agent-subagent-runtime';
import { dropTerminalJsonPrefill_ACU, isModelExchangeSequence_ACU, nativeToolCallsToProtocolJson_ACU, nativeToolExchange_ACU, normalizeAgentModelReply_ACU, synthesizeProtocolToolCalls_ACU, type AiNativeToolCall_ACU, type AiWireMessage_ACU } from '../../ai/native-tool';

export interface WorldSimulationMainLoopDependencies_ACU {
  invoke: WorldSimulationAgentInvoker_ACU;
  subagents: Pick<WorldSimulationSubagentRuntime_ACU, 'run' | 'runReviewer'>;
  countTokens?: WorldSimulationTokenCounter_ACU;
  apiPreset?: WorldSimulationApiPresetDependencies_ACU;
  /** 生产路径使用原生 tool_calls。测试缺省关闭。 */
  nativeTools?: boolean;
}
export interface WorldSimulationMainLoopInput_ACU {
  identity: WorldSimulationRunIdentity_ACU;
  settings: WorldSimulationSettings_ACU;
  promptContext: WorldSimulationPlaceholderContext_ACU;
  registry: WorldSimulationEvidenceRegistry_ACU;
  tools: WorldSimulationToolDependencies_ACU;
  writeSql?: import('./agent-subagent-runtime').WorldSimulationSubagentRunInput_ACU['writeSql'];
  readCurrent?: import('./agent-subagent-runtime').WorldSimulationSubagentRunInput_ACU['readCurrent'];
  readFieldSnapshot?: import('./agent-subagent-runtime').WorldSimulationSubagentRunInput_ACU['readFieldSnapshot'];
  runWrites?: WorldSimulationRunWriteState_ACU;
  isCurrent?: () => boolean;
  persistSessionEvent?: (eventKey: string, event: WorldSimulationSessionInput_ACU) => Promise<unknown>;
  anchor?: WorldSimulationAnchorIdentity_ACU;
  chat?: any[];
  resetRunBudget?: boolean;
  /** 当前锚点正文已经有结算快照时为 true；pendingFixes 非空时工作流仍会向主会话报告缺口。 */
  anchorMaterialsCommitted?: boolean;
  /** 显式补足入口传入的程序级目标写集。 */
  targetModules?: readonly WorldSimulationLedgerModule_ACU[];
}

const compact_ACU = (error: unknown): string => error instanceof Error ? error.message : String(error);
const LEGACY_BUDGET_FEEDBACK_ACU = new Set(['iteration budget exhausted', 'delegation gate exhausted']);
const cursorKey_ACU = (identity: WorldSimulationRunIdentity_ACU): string => `${identity.stageId}#${identity.stageRevision}#${identity.baseLedgerRevision}`;
const fingerprint_ACU = (outcome: WorldSimulationSubagentOutcome_ACU): string => sha256HexSync_ACU(JSON.stringify([outcome.agentName, outcome.status, outcome.summary, outcome.candidate?.candidateId])).slice(0, 24);

function upsertLatestOutcome_ACU(items: WorldSimulationSubagentOutcome_ACU[], outcome: WorldSimulationSubagentOutcome_ACU): void {
  const previous = items.findIndex(item => item.agentName === outcome.agentName);
  if (previous >= 0) items.splice(previous, 1);
  items.push(outcome);
}

function latestOutcomes_ACU(items: readonly WorldSimulationSubagentOutcome_ACU[]): WorldSimulationSubagentOutcome_ACU[] {
  const latest: WorldSimulationSubagentOutcome_ACU[] = [];
  for (const item of items) upsertLatestOutcome_ACU(latest, item);
  return latest;
}


function rounds_ACU(transcript: readonly { role: string; content: string }[]): Array<Array<{ role: string; content: string }>> {
  const rounds: Array<Array<{ role: string; content: string }>> = [];
  let current: Array<{ role: string; content: string }> = [];
  for (const message of transcript) {
    if (message.role === 'assistant' && current.length) {
      rounds.push(current);
      current = [message];
    } else {
      current.push(message);
    }
  }
  if (current.length) rounds.push(current);
  return rounds;
}

export const WORLD_SIMULATION_TRANSCRIPT_COMPACTION_KEEP_ROUNDS_ACU = 4;
export const WORLD_SIMULATION_TRANSCRIPT_COMPACTION_RATIO_ACU = 0.8;

export async function compactWorldSimulationTranscriptIfNeeded_ACU(input: {
  transcript: Array<{ role: string; content: string }>;
  unsettledCandidates: number;
  historyTokenBudget: number;
  countTokens: WorldSimulationTokenCounter_ACU;
  /** 调用方已按最终完整请求判定需要压缩时传 0；缺省按 transcript 自身的预算比例触发线。 */
  transcriptTriggerTokens?: number;
}): Promise<{ compacted: boolean; transcript: Array<{ role: string; content: string }> }> {
  if (input.unsettledCandidates > 0 || input.historyTokenBudget <= 0 || input.transcript.length === 0) {
    return { compacted: false, transcript: input.transcript };
  }
  const trigger = input.transcriptTriggerTokens ?? Math.floor(input.historyTokenBudget * WORLD_SIMULATION_TRANSCRIPT_COMPACTION_RATIO_ACU);
  let tokens = 0;
  for (const message of input.transcript) tokens += await input.countTokens(message.content);
  if (tokens <= trigger) return { compacted: false, transcript: input.transcript };
  const grouped = rounds_ACU(input.transcript);
  if (grouped.length <= WORLD_SIMULATION_TRANSCRIPT_COMPACTION_KEEP_ROUNDS_ACU) {
    return { compacted: false, transcript: input.transcript };
  }
  const dropped = grouped.slice(0, grouped.length - WORLD_SIMULATION_TRANSCRIPT_COMPACTION_KEEP_ROUNDS_ACU).flat();
  const kept = grouped.slice(-WORLD_SIMULATION_TRANSCRIPT_COMPACTION_KEEP_ROUNDS_ACU).flat();
  const messages: WorldSimulationConversationMessage_ACU[] = dropped.map((item, index) => ({
    id: index + 1,
    kind: item.role === 'assistant' ? 'agent' : 'user',
    text: item.content,
    digest: item.content.slice(0, 240),
    turnKey: `compact-${index + 1}`,
    at: 0,
  }));
  try {
    const summary = await summarizeWorldSimulationHandoff_ACU({
      previous: null,
      messages,
      maxTokens: 2000,
      countTokens: input.countTokens,
    });
    return { compacted: true, transcript: [{ role: 'user', content: summary.report }, ...kept] };
  } catch {
    return { compacted: false, transcript: input.transcript };
  }
}

function resultContext_ACU(
  base: WorldSimulationPlaceholderContext_ACU,
  registry: WorldSimulationEvidenceRegistry_ACU,
  candidates: readonly WorldSimulationCandidate_ACU[],
  outcomes: readonly WorldSimulationSubagentOutcome_ACU[],
): WorldSimulationPlaceholderContext_ACU {
  return {
    ...base,
    runtimeContext: { ...((base.runtimeContext && typeof base.runtimeContext === 'object') ? base.runtimeContext as Record<string, unknown> : {}), outcomes },
    worldCandidates: candidates,
    evidenceRegistry: snapshotWorldSimulationEvidenceRegistry_ACU(registry),
  };
}

function toolResultText_ACU(results: Awaited<ReturnType<typeof runWorldSimulationToolBatch_ACU>>): string {
  return JSON.stringify(results.map(item => ({ kind: item.kind, address: item.address, status: item.status, summary: item.summary, evidenceRef: item.evidenceRef, content: item.content })));
}

function uniqueCandidates_ACU(items: readonly WorldSimulationCandidate_ACU[]): WorldSimulationCandidate_ACU[] {
  const byId = new Map<string, WorldSimulationCandidate_ACU>();
  for (const item of items) byId.set(item.candidateId, item);
  return [...byId.values()];
}

function record_ACU(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function candidateResourceKeys_ACU(candidate: WorldSimulationCandidate_ACU): Set<string> {
  const keys = new Set<string>();
  for (const [module, patch] of Object.entries(candidate.patch)) {
    const collection = record_ACU(patch);
    const upsert = collection?.upsert;
    const remove = collection?.remove;
    if (Array.isArray(upsert)) {
      for (const item of upsert) {
        const entry = record_ACU(item);
        if (typeof entry?.id === 'string' && entry.id.trim()) keys.add(`${module}:${entry.id.trim()}`);
      }
    }
    if (Array.isArray(remove)) {
      for (const item of remove) {
        const entry = record_ACU(item);
        if (typeof entry?.id === 'string' && entry.id.trim()) keys.add(`${module}:${entry.id.trim()}`);
      }
    }
    if (Array.isArray(upsert) || Array.isArray(remove)) continue;
    keys.add(module);
  }
  return keys;
}

function withoutCandidateResources_ACU(candidate: WorldSimulationCandidate_ACU, resources: ReadonlySet<string>): WorldSimulationCandidate_ACU | null {
  if (candidate.agentName === '' || !resources.size) return candidate;
  const patch: Record<string, unknown> = {};
  for (const [module, value] of Object.entries(candidate.patch)) {
    const collection = record_ACU(value);
    const upsert = collection?.upsert;
    const remove = collection?.remove;
    if (Array.isArray(upsert) || Array.isArray(remove)) {
      const remainingUpserts = Array.isArray(upsert) ? upsert.filter(item => {
        const entry = record_ACU(item);
        return typeof entry?.id !== 'string' || !resources.has(`${module}:${entry.id.trim()}`);
      }) : [];
      const remainingRemovals = Array.isArray(remove) ? remove.filter(item => {
        const entry = record_ACU(item);
        return typeof entry?.id !== 'string' || !resources.has(`${module}:${entry.id.trim()}`);
      }) : [];
      if (remainingUpserts.length || remainingRemovals.length) {
        patch[module] = { ...collection, upsert: remainingUpserts, remove: remainingRemovals };
      }
      continue;
    }
    if (!resources.has(module)) patch[module] = value;
  }
  return Object.keys(patch).length ? { ...candidate, patch } : null;
}

function upsertCandidateRevision_ACU(items: WorldSimulationCandidate_ACU[], candidate: WorldSimulationCandidate_ACU): void {
  const resources = candidateResourceKeys_ACU(candidate);
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const existing = items[index];
    if (existing.agentName !== candidate.agentName) continue;
    const retained = withoutCandidateResources_ACU(existing, resources);
    if (retained) items[index] = retained;
    else items.splice(index, 1);
  }
  items.push(candidate);
}

export class WorldSimulationMainLoop_ACU {
  constructor(private readonly dependencies: WorldSimulationMainLoopDependencies_ACU) {}

  async run(input: WorldSimulationMainLoopInput_ACU): Promise<WorldSimulationMainLoopResult_ACU> {
    const cursorKey = cursorKey_ACU(input.identity);
    const resumed = readWorldSimulationRunState_ACU(input.identity.chatIdentity, input.identity.taskId, cursorKey);
    const anchorState = input.anchor && !resumed
      ? await restoreWorldSimulationRunState_ACU(input.anchor, input.identity.taskId, cursorKey, input.chat)
      : null;
    // 楼层记录与内存缓存语义等价：优先内存（活跃 run），楼层回退覆盖重启恢复。
    const resumedState = resumed ?? anchorState;
    if (resumedState?.evidenceSnapshot) {
      mergeWorldSimulationEvidenceRegistrySnapshot_ACU(input.registry, resumedState.evidenceSnapshot);
    }
    // 预算窗口重置：结构化 budgetExhausted 或旧字面值命中时，迭代/派工/同角色窗口重新起算。
    // 候选与证据全量保留；交接摘要仅作为下次请求的临时提示。
    // 末轮 persist(iteration+1) 会使 nextIteration 越过 maxIterations；这不是预算终局，
    // 只把迭代游标拉回第 1 轮，保留派工/同角色计数，避免「继续」直接掉进迭代耗尽。
    const resetRunBudget = input.resetRunBudget === true;
    const budgetExhausted = !!resumedState
      && (resumedState.budgetExhausted === true || LEGACY_BUDGET_FEEDBACK_ACU.has(resumedState.reviewerFeedback));
    const overflowed = !!resumedState
      && resumedState.nextIteration > input.settings.agentRunBudget.maxIterations;
    const iterationStart = resetRunBudget || budgetExhausted || overflowed ? 1 : Math.max(1, resumedState?.nextIteration ?? 1);
    const delegationsStart = resetRunBudget || budgetExhausted ? 0 : resumedState?.delegationsUsed ?? 0;
    const outcomes = latestOutcomes_ACU(resumedState?.subagentOutcomes ?? []);
    const candidates: WorldSimulationCandidate_ACU[] = resumedState?.candidates ? [...resumedState.candidates] : [];
    const perAgent = new Map<string, number>(resetRunBudget || budgetExhausted ? [] : Object.entries(resumedState?.perAgent ?? {}));
    let delegationsUsed = delegationsStart;
    let iteration = iterationStart;

    const persistedHistory = input.anchor ? readWorldSimulationDirectorHistory_ACU(input.chat) : [];
    // The floor projection owns confirmed turns. Only migrate the still-missing suffix of a
    // legacy run-state transcript when the current run's persisted prefix matches exactly.
    const legacyTranscript = resumedState?.transcript ?? [];
    const activeMark = input.anchor ? readWorldSimulationDirectorCompactionSource_ACU(input.chat).view.compaction : null;
    const runHistory = input.anchor && !activeMark
      ? readWorldSimulationDirectorRunHistory_ACU(input.identity.runId, input.chat) : [];
    const legacyPairs = legacyTranscript[0]?.role === 'user'
      && legacyTranscript[0].content === resumedState?.handoffSummary
      ? legacyTranscript.slice(1) : legacyTranscript;
    const isPairSequence = (messages: readonly { role: string; content: string }[]): boolean => isModelExchangeSequence_ACU(messages);
    const matchingRunPrefix = runHistory.length <= legacyPairs.length && runHistory.every((item, index) =>
      item.role === legacyPairs[index].role && item.content === legacyPairs[index].content);
    // A confirmed compaction mark supersedes both older and newer run-state transcript copies.
    // persist() flushes paired messages before saving run-state, so the floor projection owns
    // all acknowledged turns. Comparing a post-mark copy against just its new run suffix
    // would falsely report a conflict after the second resume.
    const missingLegacy = input.anchor && !activeMark && isPairSequence(legacyPairs) && matchingRunPrefix
      ? legacyPairs.slice(runHistory.length) : [];
    if (input.anchor && !activeMark && legacyPairs.length > runHistory.length && isPairSequence(legacyPairs) && !matchingRunPrefix) {
      throw new Error('WORLD_SIMULATION_LEGACY_TRANSCRIPT_CONFLICT');
    }
    if (input.anchor && !activeMark && resumedState?.transcript?.length && !persistedHistory.length && !isPairSequence(legacyPairs)) {
      throw new Error('WORLD_SIMULATION_LEGACY_TRANSCRIPT_UNPAIRED');
    }
    const transcript: AiWireMessage_ACU[] = input.anchor
      ? [...persistedHistory, ...missingLegacy]
      : [...legacyTranscript];
    const handoffHint = resumedState?.handoffSummary && !activeMark && !transcript.some(item => item.content === resumedState.handoffSummary)
      ? { role: 'user', content: resumedState.handoffSummary } : null;
    if (!input.anchor && handoffHint) transcript.unshift(handoffHint);
    let persistedTranscriptLength = input.anchor ? persistedHistory.length : 0;
    const flushDirectorHistory = async (): Promise<void> => {
      if (!input.anchor || transcript.length <= persistedTranscriptLength) return;
      const pending = transcript.slice(persistedTranscriptLength);
      if (!isPairSequence(pending)) throw new Error('WORLD_SIMULATION_DIRECTOR_HISTORY_UNPAIRED');
      await appendWorldSimulationDirectorHistory_ACU({
        anchor: input.anchor,
        runId: input.identity.runId,
        taskId: input.identity.taskId,
        stageId: input.identity.stageId,
        stageRevision: input.identity.stageRevision,
        messages: pending.map(item => ({
          role: item.role as 'assistant' | 'user' | 'tool',
          content: item.content,
          ...(item.tool_calls ? { tool_calls: item.tool_calls } : {}),
          ...(item.tool_call_id ? { tool_call_id: item.tool_call_id } : {}),
        })),
      }, input.chat);
      persistedTranscriptLength = transcript.length;
    };
    const director = 'world-director' as const;
    // Director may correct several different mechanical fields in sequence; repeated identical
    // failures remain capped by the repair state's per-fingerprint guard.
    const protocolRepair = createWorldSimulationProtocolRepairState_ACU(2);
    let pendingReview: { fingerprint: string; promise: Promise<WorldSimulationReviewerResult_ACU> } | null = null;
    let workflowEscalation: { summary: string; pendingFixes: WorldSimulationLedger_ACU['pendingFixes'] } | null = null;
    const currentLedger = (): WorldSimulationLedger_ACU => {
      input.runWrites?.assertCurrent();
      const current = input.readCurrent?.() ?? input.promptContext.worldState;
      if (!current || typeof current !== 'object' || Array.isArray(current)) throw new Error('WORLD_SIMULATION_LEDGER_UNAVAILABLE');
      if (input.readCurrent && !input.runWrites && (current as WorldSimulationLedger_ACU).revision !== input.identity.baseLedgerRevision) throw new Error('WORLD_SIMULATION_LEDGER_STALE');
      return current as WorldSimulationLedger_ACU;
    };
    const currentContext = (): WorldSimulationPlaceholderContext_ACU => ({ ...input.promptContext, worldState: currentLedger() });
    const candidateReviewFingerprint_ACU = (items: readonly WorldSimulationCandidate_ACU[]): string =>
      sha256HexSync_ACU(JSON.stringify([input.runWrites?.confirmedWrites ?? 0, uniqueCandidates_ACU(items).map(item => item.candidateId)]));
    const startPendingReview_ACU = (): void => {
      const available = uniqueCandidates_ACU(candidates);
      if (!available.length) {
        pendingReview = null;
        return;
      }
      try { input.runWrites?.assertCandidatesDisjoint(available); }
      catch { pendingReview = null; return; }
      const fingerprint = candidateReviewFingerprint_ACU(available);
      if (pendingReview?.fingerprint === fingerprint) return;
      pendingReview = {
        fingerprint,
        promise: this.dependencies.subagents.runReviewer({
          candidates: available,
          settings: input.settings,
          promptContext: resultContext_ACU(currentContext(), input.registry, available, outcomes),
          registry: input.registry,
          tools: input.tools,
          isCurrent: input.isCurrent,
        }),
      };
    };
    const readGateState = createWorldSimulationReadGateState_ACU();
    const toolUsage = { readsUsed: 0 };
    const preset = resolveWorldSimulationAgentApiPreset_ACU(input.settings, director, 'agent_loop', this.dependencies.apiPreset);
    const persistEntry = async (entryId: number, eventKey: string): Promise<void> => {
      if (!input.persistSessionEvent) return;
      const entry = readWorldSimulationSessionLog_ACU(input.identity.chatIdentity).find(item => item.id === entryId);
      if (!entry) return;
      await input.persistSessionEvent(eventKey, {
        kind: entry.kind, title: entry.title, detail: entry.detail,
        agentName: entry.agentName, ok: entry.ok, status: entry.status,
      });
    };
    const runEntryId = beginWorldSimulationSessionRun_ACU(
      input.identity.chatIdentity, '世界推演 Agent 运行',
      resetRunBudget ? `用户指令续跑，预算窗口重置（保留 ${candidates.length} 个候选）` : budgetExhausted ? `预算窗口重置，从第 1 轮继续（保留 ${candidates.length} 个候选）` : resumedState ? `从第 ${iteration} 次迭代恢复` : `stage=${input.identity.stageId}`,
      !!resumedState,
    );
    await persistEntry(runEntryId, resumedState ? 'run-resumed' : 'run-started');


    const persist = async (nextIteration: number, reviewerFeedback = '', extras: { budgetExhausted?: boolean; handoffSummary?: string } = {}): Promise<void> => {
      await flushDirectorHistory();
      const unique = uniqueCandidates_ACU(candidates);
      const state: WorldSimulationRunResumeState_ACU = {
        taskId: input.identity.taskId,
        cursorKey,
        nextIteration,
        delegationsUsed,
        perAgent: Object.fromEntries(perAgent),
        outcomes: outcomes.map(item => ({ agentName: item.agentName, status: item.status, summary: item.summary, fingerprint: fingerprint_ACU(item) })),
        candidateFingerprint: sha256HexSync_ACU(JSON.stringify(unique.map(item => item.candidateId))),
        candidateSummary: unique.map(item => item.summary).join('；').slice(0, 1000),
        reviewerFeedback,
        candidates: unique,
        subagentOutcomes: outcomes,
        evidenceSnapshot: snapshotWorldSimulationEvidenceRegistry_ACU(input.registry),
        transcript: [...transcript],
        ...(extras.budgetExhausted ? { budgetExhausted: true } : {}),
        ...(extras.handoffSummary ? { handoffSummary: extras.handoffSummary } : {}),
      };
      if (input.anchor) await persistWorldSimulationRunState_ACU(input.anchor, state, input.chat);
      saveWorldSimulationRunState_ACU(input.identity.chatIdentity, state);
    };

    const summarizeHandoff_ACU = async (): Promise<string | undefined> => {
      try {
        const messages: WorldSimulationConversationMessage_ACU[] = transcript.map((item, index) => ({
          id: index + 1,
          kind: item.role === 'assistant' ? 'agent' : 'user',
          text: item.content,
          digest: item.content.slice(0, 240),
          turnKey: `turn-${index + 1}`,
          at: 0,
        }));
        const result = await summarizeWorldSimulationHandoff_ACU({
          previous: null,
          messages,
          maxTokens: 2000,
          countTokens: this.dependencies.countTokens ?? countWorldSimulationTokens_ACU,
        });
        return result.report;
      } catch {
        return undefined;
      }
    };

    const blockOnBudget_ACU = async (
      nextIteration: number,
      reviewerFeedback: string,
      title: string,
      detail: string,
      unresolved: string[],
      eventKey: string,
    ): Promise<WorldSimulationMainLoopResult_ACU> => {
      await flushDirectorHistory();
      const handoffSummary = await summarizeHandoff_ACU();
      await persist(nextIteration, reviewerFeedback, { budgetExhausted: true, ...(handoffSummary ? { handoffSummary } : {}) });
      const blockId = logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'block', title, detail, agentName: director, ok: false });
      await persistEntry(blockId, eventKey);
      return { outcome: 'blocked', summary: title, unresolved, outcomes };
    };

    for (; iteration <= input.settings.agentRunBudget.maxIterations; iteration += 1) {
      await flushDirectorHistory();
      const requestSnapshot = snapshotWorldSimulationEvidenceRegistry_ACU(input.registry);
      const requestContext = resultContext_ACU(currentContext(), input.registry, uniqueCandidates_ACU(candidates), outcomes);
      if (input.anchor) requestContext.history = { note: '主会话历史已按模型消息顺序提供；此处不重复展示卡片' };
      if (workflowEscalation) {
        const runtimeContext = requestContext.runtimeContext && typeof requestContext.runtimeContext === 'object'
          ? requestContext.runtimeContext as Record<string, unknown>
          : {};
        requestContext.runtimeContext = { ...runtimeContext, pendingFixes: workflowEscalation.pendingFixes, escalation: workflowEscalation.summary };
      }
      const mainEntryId = logWorldSimulationSession_ACU(input.identity.chatIdentity, {
        kind: 'main_action',
        title: `主 Agent 第 ${iteration} 轮正在工作`,
        detail: iteration === 1 ? `正在分析本轮幕后推演：${input.promptContext.userGuidance || input.identity.stageId}` : '正在结合上一轮取证与派工结果决定下一步动作…',
        agentName: director,
        status: 'running',
      });
      let sent: Awaited<ReturnType<typeof executeWorldSimulationFinalRequest_ACU>>;
      try {
        const rendered = await renderWorldSimulationPrompt_ACU(
          input.settings.agentPrompts[director], director,
          createWorldSimulationPlaceholderResolvers_ACU({ ...requestContext, evidenceRegistry: requestSnapshot }),
        );
        const fixed = [{ role: 'system', content: worldSimulationDirectorRuntimeProtocolInstruction_ACU() }, ...rendered.messages];
        const tail = [...(input.anchor && handoffHint ? [handoffHint] : []),
          ...(this.dependencies.nativeTools ? [] : [{ role: 'assistant', content: WORLD_SIMULATION_AGENT_PREFILLS_ACU[director] }])];
        const count = this.dependencies.countTokens ?? countWorldSimulationTokens_ACU;
        let prepared = this.dependencies.nativeTools ? dropTerminalJsonPrefill_ACU([...fixed, ...transcript, ...tail]) : [...fixed, ...transcript, ...tail];
        // 无锚点路径与锚定路径同一口径：用最终准备发送的完整请求判定是否压缩，
        // 不再只按 transcript 估算——骨架与尾部的开销同样会把请求顶过阈值。
        if (!input.anchor) {
          const threshold = input.settings.agentHistoryTokenBudget;
          if (threshold > 0 && await measureWorldSimulationPrompt_ACU(prepared, count) > threshold) {
            const compacted = await compactWorldSimulationTranscriptIfNeeded_ACU({
              transcript,
              unsettledCandidates: uniqueCandidates_ACU(candidates).length,
              historyTokenBudget: threshold,
              countTokens: count,
              // 是否需要压缩已经用完整请求判定过；这里只保留轮数与闭合保护。
              transcriptTriggerTokens: 0,
            });
            if (compacted.compacted) {
              transcript.splice(0, transcript.length, ...compacted.transcript);
              prepared = [...fixed, ...transcript, ...tail];
            }
          }
        }
        if (input.anchor && input.chat) {
          const threshold = input.settings.agentHistoryTokenBudget;
          if (threshold > 0 && await measureWorldSimulationPrompt_ACU(prepared, count) > threshold) {
            await flushDirectorHistory();
            const confirmed = readWorldSimulationDirectorCompactionSource_ACU(input.chat);
            const confirmedHistory = confirmed.view.messages.map(message => ({
              role: message.kind === 'model_agent' ? 'assistant' : 'user', content: message.text,
            }));
            if (JSON.stringify(confirmedHistory) !== JSON.stringify(transcript)) {
              // Another confirmed floor event may arrive while the summary is prepared. Build
              // the candidate and the final request from the same authoritative projection.
              transcript.splice(0, transcript.length, ...confirmedHistory);
              persistedTranscriptLength = transcript.length;
              prepared = [...fixed, ...transcript, ...tail];
            }
            const planned = confirmedHistory.length && await measureWorldSimulationPrompt_ACU(prepared, count) > threshold
              ? await planWorldSimulationHistoryCompaction_ACU({
                view: confirmed.view, triggerTokens: threshold, fixedPromptTokens: 0, preparedMessages: prepared, countTokens: count,
              }) : null;
            if (planned?.mark) {
              input.runWrites?.assertCurrent();
              if (input.isCurrent?.() === false) throw new Error('WORLD_SIMULATION_COMPACTION_RUN_STALE');
            }
            if (planned?.mark && await writeWorldSimulationConversationCompaction_ACU({
              anchor: input.anchor, compaction: planned.mark, expectedFingerprint: confirmed.fingerprint,
              expectedStageId: input.identity.stageId, expectedStageRevision: input.identity.stageRevision,
            }, input.chat)) {
              const reloaded = readWorldSimulationDirectorCompactionSource_ACU(input.chat);
              if (reloaded.view.compaction?.report !== planned.mark.report
                || reloaded.view.compaction.compactedThroughId !== planned.mark.compactedThroughId) {
                throw new Error('WORLD_SIMULATION_COMPACTION_READBACK_FAILED');
              }
              transcript.splice(0, transcript.length, ...readWorldSimulationDirectorHistory_ACU(input.chat));
              persistedTranscriptLength = transcript.length;
              prepared = [...fixed, ...transcript, ...tail];
            }
          }
        }
        sent = await executeWorldSimulationFinalRequest_ACU({
          messages: prepared,
          historyBudgetTokens: input.settings.agentHistoryTokenBudget,
          count,
          invoke: messages => this.dependencies.invoke(director, messages, preset),
        });
      } catch (error) {
        updateWorldSimulationSession_ACU(input.identity.chatIdentity, mainEntryId, { title: `主 Agent 第 ${iteration} 轮失败`, detail: compact_ACU(error), ok: false, status: 'failed' });
        await persistEntry(mainEntryId, `main-${iteration}-failed`);
        const failedId = logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'run_failed', title: '主 Agent 请求失败', detail: compact_ACU(error), agentName: director, ok: false });
        await persistEntry(failedId, `run-failed-main-${iteration}`);
        throw error;
      }
      if (sent.status === 'rejected') {
        updateWorldSimulationSession_ACU(input.identity.chatIdentity, mainEntryId, { title: `主 Agent 第 ${iteration} 轮失败`, detail: sent.reason, ok: false, status: 'failed' });
        await persistEntry(mainEntryId, `main-${iteration}-rejected`);
        await persist(iteration);
        const failedId = logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'run_failed', title: '最终请求超出 Token 门禁', detail: sent.reason, agentName: director, ok: false });
        await persistEntry(failedId, `run-failed-token-${iteration}`);
        throw new Error(sent.reason);
      }
      const turn = normalizeAgentModelReply_ACU(sent.response);
      const nativeCalls: AiNativeToolCall_ACU[] = this.dependencies.nativeTools ? turn.toolCalls : [];
      let raw = typeof sent.response === 'string' ? sent.response : turn.content;
      if (nativeCalls.length) {
        try { raw = nativeToolCallsToProtocolJson_ACU(nativeCalls); }
        catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          transcript.push(...nativeToolExchange_ACU(turn.content, nativeCalls, nativeCalls.map(() => reason)));
          await persist(iteration + 1, reason);
          continue;
        }
      }
      const allowDelegate = delegationsUsed < input.settings.agentRunBudget.maxDelegations;
      let action;
      try {
        action = parseWorldSimulationMainOutput_ACU(raw, WORLD_SIMULATION_AGENT_PREFILLS_ACU[director], allowDelegate, requestSnapshot);
      } catch (error) {
        const exhausted = compactWorldSimulationProtocolError_ACU(error);
        if (exhausted.reasonCode === 'DELEGATION_BUDGET_EXHAUSTED') {
          updateWorldSimulationSession_ACU(input.identity.chatIdentity, mainEntryId, { title: `主 Agent 第 ${iteration} 轮派工预算耗尽`, detail: `${exhausted.reasonCode} ${exhausted.path}`, ok: false, status: 'failed' });
          await persistEntry(mainEntryId, `main-${iteration}-delegation-budget`);
          transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: '派工预算已耗尽，当轮终止。' });
          return blockOnBudget_ACU(
            iteration,
            'delegation budget exhausted',
            '派工预算已耗尽',
            `${exhausted.reasonCode} ${exhausted.path}`,
            ['delegation budget exhausted'],
            'block-delegation-budget',
          );
        }
        const failure = recordWorldSimulationProtocolFailure_ACU(protocolRepair, error);
        updateWorldSimulationSession_ACU(input.identity.chatIdentity, mainEntryId, { title: `主 Agent 第 ${iteration} 轮协议未通过`, detail: `${failure.issue.reasonCode} ${failure.issue.path}`, ok: false, status: 'failed' });
        await persistEntry(mainEntryId, `main-${iteration}-protocol-failed`);
        if (!failure.retry) {
          await persist(iteration, `${failure.issue.reasonCode}:${failure.issue.path}`);
          throw error;
        }
        const rejection = renderWorldSimulationDirectorProtocolRejection_ACU(failure.issue, allowDelegate);
        if (nativeCalls.length) transcript.push(...nativeToolExchange_ACU(turn.content, nativeCalls, nativeCalls.map(() => rejection)));
        else transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: rejection });
        const retryId = logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'protocol_retry', title: '主 Agent 协议修正', detail: `${failure.issue.reasonCode} ${failure.issue.path}\n模型返回片段：${raw.slice(0, 300) || '(空)'}`, agentName: director, ok: false });
        await persistEntry(retryId, `main-${iteration}-protocol-retry`);
        continue;
      }
      updateWorldSimulationSession_ACU(input.identity.chatIdentity, mainEntryId, { title: `主 Agent 动作：${action.kind}`, detail: `第 ${iteration} 轮决策完成`, ok: true, status: 'done' });
      await persistEntry(mainEntryId, `main-${iteration}-done`);

      if (action.kind === 'read' || action.kind === 'search' || action.kind === 'tools') {
        const calls = action.kind === 'tools' ? action.calls : [action];
        const toolEntryId = logWorldSimulationSession_ACU(input.identity.chatIdentity, {
          kind: 'tool_read', title: '主 Agent 正在读取资料',
          detail: calls.map(call => call.kind === 'read' ? `read: ${call.reads.join(', ')}` : `search: ${call.query}`).join('；'),
          agentName: director, status: 'running',
        });
        let results: Awaited<ReturnType<typeof runWorldSimulationToolBatch_ACU>>;
        try {
          results = await runWorldSimulationToolBatch_ACU({
            calls, registry: input.registry, dependencies: input.tools,
            gate: {
              state: readGateState,
              config: { historyTokenBudget: input.settings.agentHistoryTokenBudget, readTokenBudget: input.settings.agentReadTokenBudget, fallbackTokens: input.settings.agentReadFallbackTokens },
              usage: toolUsage,
              maxReads: input.settings.agentRunBudget.maxReads,
              count: this.dependencies.countTokens ?? countWorldSimulationTokens_ACU,
            },
          });
          const toolOk = results.every(result => result.status === 'ok' || result.status === 'empty');
          updateWorldSimulationSession_ACU(input.identity.chatIdentity, toolEntryId, {
            title: toolOk ? `资料读取完成（${results.length} 项）` : '资料读取部分失败',
            detail: results.map(result => `${result.kind}:${result.status} ${result.address} ${result.summary}`).join('；'),
            ok: toolOk, status: toolOk ? 'done' : 'failed',
          });
          await persistEntry(toolEntryId, `tool-${iteration}`);
        } catch (error) {
          updateWorldSimulationSession_ACU(input.identity.chatIdentity, toolEntryId, { title: '资料读取失败', detail: compact_ACU(error), ok: false, status: 'failed' });
          await persistEntry(toolEntryId, `tool-${iteration}-failed`);
          throw error;
        }
        const boundCalls = nativeCalls.length ? nativeCalls : synthesizeProtocolToolCalls_ACU(calls);
        const receipt = toolResultText_ACU(results);
        if (boundCalls.length) transcript.push(...nativeToolExchange_ACU(turn.content || raw, boundCalls, boundCalls.map(() => receipt)));
        else transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: receipt });
        pendingReview = null;
        await persist(iteration + 1);
        continue;
      }

      if (action.kind === 'open_round') {
        const workflowEntryId = logWorldSimulationSession_ACU(input.identity.chatIdentity, {
          kind: 'delegation',
          title: '固定工作流正在执行',
          detail: action.focus,
          agentName: director,
          status: 'running',
        });
        let workflow: Awaited<ReturnType<typeof runWorldSimulationWorkflow_ACU>>;
        try {
          workflow = await runWorldSimulationWorkflow_ACU({
            identity: input.identity,
            settings: input.settings,
            promptContext: requestContext,
            registry: input.registry,
            tools: input.tools,
            writeSql: input.writeSql,
            readCurrent: input.readCurrent,
            readFieldSnapshot: input.readFieldSnapshot,
            runWrites: input.runWrites,
            isCurrent: input.isCurrent,
            opening: {
              summary: action.summary,
              focus: action.focus,
              dispatchChronicler: action.dispatchChronicler,
              skipModules: action.skipModules,
            },
            anchorMaterialsCommitted: input.anchorMaterialsCommitted === true,
            targetModules: input.targetModules,
            subagents: this.dependencies.subagents,
          });
        } catch (error) {
          updateWorldSimulationSession_ACU(input.identity.chatIdentity, workflowEntryId, { title: '固定工作流失败', detail: compact_ACU(error), ok: false, status: 'failed' });
          await persistEntry(workflowEntryId, `workflow-${iteration}-failed`);
          throw error;
        }
        for (const outcome of workflow.outcomes) upsertLatestOutcome_ACU(outcomes, outcome);
        updateWorldSimulationSession_ACU(input.identity.chatIdentity, workflowEntryId, {
          title: `固定工作流：${workflow.outcome}`,
          detail: workflow.summary,
          ok: workflow.outcome !== 'escalate',
          status: workflow.outcome === 'escalate' ? 'failed' : 'done',
        });
        await persistEntry(workflowEntryId, `workflow-${iteration}`);
        const workflowFeedback = JSON.stringify({ outcome: workflow.outcome === 'escalate' ? 'escalate' : 'prepared', pendingFixes: workflow.pendingFixes, agents: workflow.outcomes.map(item => ({ agentName: item.agentName, status: item.status })) });
        transcript.push({ role: 'assistant', content: raw || '(empty)' }, {
          role: 'user', content: workflow.outcome === 'escalate'
            ? `${workflowFeedback}
${workflow.summary}
资料维护未合格。请向用户说明缺口，或在用户要求维护资料时 delegate 对应角色。不要再次 open_round 同一批已升级的待修复项。`
            : workflowFeedback,
        });
        await flushDirectorHistory();
        if (workflow.outcome === 'escalate') {
          workflowEscalation = { summary: workflow.summary, pendingFixes: workflow.pendingFixes };
          await persist(iteration + 1, workflow.summary);
          continue;
        }
        await clearWorldSimulationRunStateAtAnchor_ACU(input.anchor, input.chat);
        if (workflow.outcome === 'no_change' || !workflow.commitCandidate) {
          return { outcome: 'no_change', summary: workflow.summary, outcomes };
        }
        return { outcome: 'commit', summary: workflow.summary, commitCandidate: workflow.commitCandidate, outcomes };
      }

      if (action.kind === 'delegate') {
        const accepted = [] as typeof action.delegations;
        const rejected = [] as Array<{ agentName: string; reason: string }>;
        const runningEntries = new Map<(typeof action.delegations)[number], number>();
        for (const delegation of action.delegations) {
          const definition = WORLD_SIMULATION_AGENT_CATALOG_ACU.find(item => item.name === delegation.agentName);
          const used = perAgent.get(delegation.agentName) ?? 0;
          const allowedKind = definition
            && (definition.kind === 'specialist' || definition.kind === 'researcher');
          const reason = !allowedKind ? `角色 ${delegation.agentName} 不可派工`
            : delegationsUsed + accepted.length >= input.settings.agentRunBudget.maxDelegations ? `总派工预算已耗尽（${delegationsUsed + accepted.length}/${input.settings.agentRunBudget.maxDelegations}）`
            : used >= input.settings.agentRunBudget.maxSameAgent ? `同角色派工预算已耗尽（${used}/${input.settings.agentRunBudget.maxSameAgent}）`
            : accepted.length >= input.settings.agentRunBudget.maxConcurrent ? `并行派工预算已耗尽（${accepted.length}/${input.settings.agentRunBudget.maxConcurrent}）`
            : '';
          // 预算/角色门禁拦截：不调用被拦子代理、不出会话卡片、不记 outcome，原因回灌 transcript。
          if (reason) {
            rejected.push({ agentName: delegation.agentName, reason });
            continue;
          }
          accepted.push(delegation);
          runningEntries.set(delegation, logWorldSimulationSession_ACU(input.identity.chatIdentity, {
            kind: 'delegation', title: `${delegation.agentName} 正在工作`, detail: delegation.instruction, agentName: delegation.agentName, status: 'running',
          }));
        }
        const budgetUsageText = `当前用量：总派工 ${delegationsUsed}/${input.settings.agentRunBudget.maxDelegations}${[...perAgent.entries()].map(([name, count]) => `；${name} ${count}/${input.settings.agentRunBudget.maxSameAgent}`).join('')}`;
        const rejectionText = `派工被预算门禁拦截（未调用被拦子代理）：\n${rejected.map(item => `- ${item.agentName}：${item.reason}`).join('\n')}\n${budgetUsageText}\n预算耗尽即终止。请改派仍有预算的角色、基于现有候选 finalize，或在证据不足时输出 block。`;
        if (!accepted.length) {
          transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: rejectionText });
          return blockOnBudget_ACU(
            iteration,
            'delegation gate exhausted',
            '派工被预算门禁拦截，无可派工角色',
            rejectionText,
            rejected.map(item => `${item.agentName}: ${item.reason}`),
            'block-delegation-gate',
          );
        }
        const candidateSeqByAgent = new Map<string, number>();
        for (const item of candidates) {
          candidateSeqByAgent.set(item.agentName, (candidateSeqByAgent.get(item.agentName) ?? 0) + 1);
        }
        const settled = await Promise.all(accepted.map(async delegation => {
          const nextSeq = (candidateSeqByAgent.get(delegation.agentName) ?? 0) + 1;
          candidateSeqByAgent.set(delegation.agentName, nextSeq);
          try {
            return await this.dependencies.subagents.run({
              delegation,
              settings: input.settings,
              promptContext: requestContext,
              registry: input.registry,
              tools: input.tools,
              writeSql: input.writeSql,
              readCurrent: input.readCurrent,
            readFieldSnapshot: input.readFieldSnapshot,
              isCurrent: input.isCurrent,
              runId: input.identity.runId,
              candidateSeq: nextSeq,
            });
          } catch (error) {
            const issue = compactWorldSimulationProtocolError_ACU(error);
            const reasonCode = issue.reasonCode === 'PROTOCOL_UNKNOWN_ERROR' ? 'WORLD_SIMULATION_SUBAGENT_FAILED' : issue.reasonCode;
            return { agentName: delegation.agentName, status: 'failed' as const, summary: compact_ACU(error), evidenceRefs: [], uncertainties: [], reasonCode };
          }
        }));
        for (let index = 0; index < settled.length; index += 1) {
          const outcome = settled[index];
          if (outcome.candidate) {
            upsertCandidateRevision_ACU(candidates, outcome.candidate);
            const authorized = new Set(snapshotWorldSimulationEvidenceRegistry_ACU(input.registry).entries.flatMap(entry => entry.evidenceRef ? [entry.evidenceRef] : []));
            const report = preflightWorldSimulationCandidates_ACU(currentLedger(), [outcome.candidate], authorized, input.settings);
            if (!report.blocking.length) {
              delegationsUsed += 1;
              perAgent.set(outcome.agentName, (perAgent.get(outcome.agentName) ?? 0) + 1);
            }
          } else {
            delegationsUsed += 1;
            perAgent.set(outcome.agentName, (perAgent.get(outcome.agentName) ?? 0) + 1);
          }
          upsertLatestOutcome_ACU(outcomes, outcome);
          const ok = (outcome.status === 'candidate' || outcome.status === 'no_change') && outcome.completion !== 'failed' && outcome.completion !== 'partial';
          const entryId = runningEntries.get(accepted[index])!;
          updateWorldSimulationSession_ACU(input.identity.chatIdentity, entryId, { title: `${outcome.agentName} ${outcome.status}`, detail: outcome.summary, ok, status: ok ? 'done' : 'failed' });
          await persistEntry(entryId, `delegation-${iteration}-${index + 1}`);
        }
        const delegationFeedback = JSON.stringify(settled.map(item => ({ agentName: item.agentName, status: item.status, summary: item.summary, candidateId: item.candidate?.candidateId,
          unresolvedIssues: item.unresolvedIssues?.map(issue => ({ path: issue.path, message: issue.message })), acceptedKeys: item.acceptedKeys })));
        transcript.push({ role: 'assistant', content: raw || '(empty)' }, {
          role: 'user', content: rejected.length ? `${delegationFeedback}
${rejectionText}` : delegationFeedback,
        });
        if (iteration < input.settings.agentRunBudget.maxIterations) {
          startPendingReview_ACU();
        }
        await persist(iteration + 1);
        continue;
      }

      if (action.kind === 'block') {
        transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: JSON.stringify({ outcome: 'blocked', summary: action.reason, unresolved: action.unresolved }) });
        await flushDirectorHistory();
        await persist(iteration + 1, action.reason);
        const blockId = logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'block', title: action.reason, detail: action.unresolved.join('；'), agentName: director, ok: false });
        await persistEntry(blockId, `block-${iteration}`);
        return { outcome: 'blocked', summary: action.reason, unresolved: action.unresolved, outcomes };
      }


      if (action.outcome === 'no_change') {
        const insufficient = !action.evidenceRefs.length || !outcomes.length || outcomes.some(item => item.status !== 'no_change') || candidates.length > 0;
        if (insufficient) {
          await persist(iteration + 1, 'no_change 缺少完整证据或存在候选/失败结果');
          transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: 'no_change 未满足门禁：必须有授权证据，且已有派工结果全部为 no_change，不得存在候选、失败或 blocked。请继续取证或输出 blocked。' });
          continue;
        }
        transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: JSON.stringify({ outcome: 'prepared_no_change', summary: action.summary }) });
        await flushDirectorHistory();
        await clearWorldSimulationRunStateAtAnchor_ACU(input.anchor, input.chat);
        return { outcome: 'no_change', summary: action.summary, outcomes };
      }

      const available = uniqueCandidates_ACU(candidates);
      if (outcomes.some(item => item.completion === 'failed' && (item.acceptedKeys?.length || item.unresolvedIssues?.length))) {
        const unresolved = outcomes.flatMap(item => item.completion === 'failed'
          ? (item.unresolvedIssues ?? []).map(issue => `${issue.path}: ${issue.message}`) : []);
        await persist(iteration + 1, '逐栏维护仍有未解决缺口');
        transcript.push({ role: 'assistant', content: raw || '(empty)' },
          { role: 'user', content: `逐栏写入尚未合格：${unresolved.join('；')}。不能提交成功；请修正后再完成，或输出 blocked。` });
        continue;
      }
      if (!available.length && input.runWrites?.hasConfirmedWrites) {
        input.runWrites.assertCurrent();
        transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: JSON.stringify({ outcome: 'prepared', summary: action.summary, confirmedWrites: input.runWrites.confirmedWrites }) });
        await flushDirectorHistory();
        await clearWorldSimulationRunStateAtAnchor_ACU(input.anchor, input.chat);
        const commitCandidate = { runId: input.identity.runId, taskId: input.identity.taskId, stageId: input.identity.stageId,
          stageRevision: input.identity.stageRevision, baseLedgerRevision: input.identity.baseLedgerRevision,
          summary: action.summary, acceptedCandidates: [] as WorldSimulationCandidate_ACU[], evidenceRefs: [...new Set([...action.evidenceRefs, ...input.runWrites.evidenceRefs])],
          collisionReport: input.promptContext.worldCollisions as WorldCollisionReport_ACU };
        return { outcome: 'commit', summary: action.summary, commitCandidate, outcomes };
      }
      if (!available.length) {
        await persist(iteration + 1, 'commit 缺少候选');
        transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: 'commit 没有可审核候选。请继续派工，或在证据不足时输出 blocked。' });
        continue;
      }
      try {
        input.runWrites?.assertCandidatesDisjoint(available);
      } catch (error) {
        const message = compact_ACU(error);
        pendingReview = null;
        await persist(iteration + 1, message);
        transcript.push({ role: 'assistant', content: raw || '(empty)' },
          { role: 'user', content: `${message}：候选覆盖了本次运行已确认的逐栏写入。不得重复提交；请修订为只包含尚未落盘的写集。` });
        continue;
      }
      let reviewer;
      const reviewFingerprint = candidateReviewFingerprint_ACU(available);
      const reviewerEntryId = logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'delegation', title: '因果审核正在工作', detail: `正在审核 ${available.length} 个候选的时间、因果、权限与证据完整性`, agentName: 'causality-reviewer', status: 'running' });
      try {
        reviewer = pendingReview?.fingerprint === reviewFingerprint
          ? await pendingReview.promise
          : await this.dependencies.subagents.runReviewer({ candidates: available, settings: input.settings, promptContext: requestContext, registry: input.registry, tools: input.tools, isCurrent: input.isCurrent });
        pendingReview = null;
        updateWorldSimulationSession_ACU(input.identity.chatIdentity, reviewerEntryId, { title: `因果审核：${reviewer.verdict}`, detail: reviewer.summary, ok: reviewer.verdict !== 'reject', status: reviewer.verdict === 'reject' ? 'failed' : 'done' });
        await persistEntry(reviewerEntryId, `causality-review-${iteration}`);
      } catch (error) {
        pendingReview = null;
        updateWorldSimulationSession_ACU(input.identity.chatIdentity, reviewerEntryId, { title: '因果审核失败', detail: compact_ACU(error), ok: false, status: 'failed' });
        await persistEntry(reviewerEntryId, `causality-review-${iteration}-failed`);
        await persist(iteration + 1, compact_ACU(error));
        transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: `reviewer 未完成：${compact_ACU(error)}。请继续修正候选或输出 blocked。` });
        continue;
      }
      const acceptedIds = new Set(reviewer.acceptedCandidateIds);
      const acceptedCandidates = available.filter(item => acceptedIds.has(item.candidateId));
      const blockingFindings = reviewer.findings.filter(item => item.severity === 'blocking');
      if (reviewer.verdict !== 'accept' || !acceptedCandidates.length || blockingFindings.length) {
        await persist(iteration + 1, reviewer.summary);
        const findings = reviewer.findings.filter(item => item.severity !== 'minor');
        const feedback = findings.length
          ? findings.map(item => `${item.severity}:${item.reasonCode}:${item.path}；期望=${item.expected}；实际=${String(item.actual)}`).join('\n')
          : 'reviewer 未接受任何候选';
        transcript.push(
          { role: 'assistant', content: raw || '(empty)' },
          { role: 'user', content: `reviewer 驳回或要求修订候选：${reviewer.summary}\n${feedback}\n请根据审核意见重新派工修正候选；不得把本次驳回当作任务终局。只有确实无法补足证据或修正时才输出 blocked。` },
        );
        continue;
      }
      const causalEvidenceRefs = [...new Set([...action.evidenceRefs, ...acceptedCandidates.flatMap(item => item.evidenceRefs)])];
      const anchorMessage = typeof input.promptContext.anchorMessage === 'string' ? input.promptContext.anchorMessage : '';
      const baseLedger = currentLedger();
      try {
        input.runWrites?.assertCandidatesDisjoint(acceptedCandidates);
      } catch (error) {
        const message = compact_ACU(error);
        pendingReview = null;
        await persist(iteration + 1, message);
        transcript.push({ role: 'assistant', content: raw || '(empty)' },
          { role: 'user', content: `${message}：候选覆盖了本次运行已确认的逐栏写入。不得重复提交；请修订为只包含尚未落盘的写集。` });
        continue;
      }
      let finalCandidates = acceptedCandidates;
      const preview = await applyWorldSimulationCandidatesDetailedViaSql_ACU(baseLedger, acceptedCandidates, new Set(causalEvidenceRefs), input.settings, { anchorMessage });
      if (!preview.appliedModules.length) {
        const message = preview.pendingFixes.map(item => item.lastError).join('；') || '没有模块入库';
        await persist(iteration + 1, message);
        const failedId = logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'main_action', title: '候选事务应用失败，等待修订', detail: message, agentName: director, ok: false, status: 'failed' });
        await persistEntry(failedId, `candidate-transaction-failed-${iteration}`);
        transcript.push(
          { role: 'assistant', content: raw || '(empty)' },
          { role: 'user', content: `已接受候选在账本事务应用阶段失败：${message}\n请把该错误作为修订约束重新派工。若为 revision 冲突，必须基于当前账本 revision 重建受影响条目；若为字段缺失，必须一次性补齐该模块全部持久化必填字段。完整必填字段模板：${formatWorldSimulationLedgerRequiredFields_ACU()}。不得把本次事务失败当作任务终局，只有确实无法修正时才输出 blocked。` },
        );
        continue;
      }
      finalCandidates = acceptedCandidates;
      try {
        const commitEvidenceRefs = [...new Set([...causalEvidenceRefs, ...finalCandidates.flatMap(item => item.evidenceRefs)])];
        input.runWrites?.assertCurrent();
        transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: JSON.stringify({ outcome: 'prepared', summary: action.summary, acceptedCandidates: finalCandidates.map(item => ({ candidateId: item.candidateId, agentName: item.agentName })) }) });
        await flushDirectorHistory();
        await clearWorldSimulationRunStateAtAnchor_ACU(input.anchor, input.chat);
        const commitCandidate = { runId: input.identity.runId, taskId: input.identity.taskId, stageId: input.identity.stageId, stageRevision: input.identity.stageRevision, baseLedgerRevision: input.identity.baseLedgerRevision, summary: action.summary, acceptedCandidates: finalCandidates, evidenceRefs: commitEvidenceRefs, reviewer, collisionReport: input.promptContext.worldCollisions as WorldCollisionReport_ACU };
        return { outcome: 'commit', summary: action.summary, commitCandidate, outcomes };
      } catch (error) {
        const message = compact_ACU(error);
        await persist(iteration + 1, message);
        const failedId = logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'main_action', title: '候选事务应用失败，等待修订', detail: message, agentName: director, ok: false, status: 'failed' });
        await persistEntry(failedId, `candidate-transaction-failed-${iteration}`);
        transcript.push(
          { role: 'assistant', content: raw || '(empty)' },
          { role: 'user', content: `已接受候选在账本事务应用阶段失败：${message}\n请把该错误作为修订约束重新派工。若为 revision 冲突，必须基于当前账本 revision 重建受影响条目；若为字段缺失，必须一次性补齐该模块全部持久化必填字段。完整必填字段模板：${formatWorldSimulationLedgerRequiredFields_ACU()}。不得把本次事务失败当作任务终局，只有确实无法修正时才输出 blocked。` },
        );
        continue;
      }
    }

    return blockOnBudget_ACU(
      input.settings.agentRunBudget.maxIterations,
      'iteration budget exhausted',
      '世界推演主循环迭代预算耗尽',
      `maxIterations=${input.settings.agentRunBudget.maxIterations}`,
      ['iteration budget exhausted'],
      'block-iteration-budget',
    );
  }
}
