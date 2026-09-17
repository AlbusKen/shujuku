import { sha256HexSync_ACU } from '../../../shared/sha256-sync';
import type { WorldSimulationLedger_ACU, WorldSimulationRunIdentity_ACU, WorldSimulationSettings_ACU } from '../model';
import { applyWorldSimulationCandidates_ACU } from '../simulation-transaction';
import type { WorldSimulationEvidenceRegistry_ACU } from '../world-simulation-evidence-registry';
import { snapshotWorldSimulationEvidenceRegistry_ACU } from '../world-simulation-evidence-registry';
import { runWorldSimulationToolBatch_ACU, type WorldSimulationToolDependencies_ACU } from '../world-simulation-agent-tools';
import { resolveWorldSimulationAgentApiPreset_ACU, type WorldSimulationApiPresetDependencies_ACU } from '../api-preset';
import { WORLD_SIMULATION_AGENT_CATALOG_ACU } from './agent-catalog';
import { WORLD_SIMULATION_AGENT_PREFILLS_ACU } from './agent-defaults';
import type { WorldSimulationCandidate_ACU, WorldSimulationMainLoopResult_ACU, WorldSimulationSubagentOutcome_ACU } from './agent-model';
import { createWorldSimulationPlaceholderResolvers_ACU, type WorldSimulationPlaceholderContext_ACU } from './agent-placeholder-resolver';
import { createWorldSimulationProtocolRepairState_ACU, parseWorldSimulationMainOutput_ACU, recordWorldSimulationProtocolFailure_ACU } from './agent-protocol';
import { createWorldSimulationReadGateState_ACU } from './agent-read-gate';
import { clearWorldSimulationRunState_ACU, readWorldSimulationRunState_ACU, saveWorldSimulationRunState_ACU } from './agent-run-cache';
import { beginWorldSimulationSessionRun_ACU, logWorldSimulationSession_ACU } from './agent-session-log';
import { countWorldSimulationTokens_ACU, type WorldSimulationTokenCounter_ACU } from './agent-token-budget';
import { executeWorldSimulationFinalRequest_ACU } from './final-request-token-gate';
import { renderWorldSimulationPrompt_ACU } from './prompt-template';
import type { WorldSimulationAgentInvoker_ACU, WorldSimulationSubagentRuntime_ACU } from './agent-subagent-runtime';

export interface WorldSimulationMainLoopDependencies_ACU {
  invoke: WorldSimulationAgentInvoker_ACU;
  subagents: Pick<WorldSimulationSubagentRuntime_ACU, 'run' | 'runReviewer' | 'runGuidanceReviewer'>;
  countTokens?: WorldSimulationTokenCounter_ACU;
  apiPreset?: WorldSimulationApiPresetDependencies_ACU;
}
export interface WorldSimulationMainLoopInput_ACU {
  identity: WorldSimulationRunIdentity_ACU;
  settings: WorldSimulationSettings_ACU;
  promptContext: WorldSimulationPlaceholderContext_ACU;
  registry: WorldSimulationEvidenceRegistry_ACU;
  tools: WorldSimulationToolDependencies_ACU;
}

const compact_ACU = (error: unknown): string => error instanceof Error ? error.message : String(error);
const cursorKey_ACU = (identity: WorldSimulationRunIdentity_ACU): string => `${identity.stageId}#${identity.stageRevision}#${identity.baseLedgerRevision}`;
const fingerprint_ACU = (outcome: WorldSimulationSubagentOutcome_ACU): string => sha256HexSync_ACU(JSON.stringify([outcome.agentName, outcome.status, outcome.summary, outcome.candidate?.candidateId])).slice(0, 24);


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

export class WorldSimulationMainLoop_ACU {
  constructor(private readonly dependencies: WorldSimulationMainLoopDependencies_ACU) {}

  async run(input: WorldSimulationMainLoopInput_ACU): Promise<WorldSimulationMainLoopResult_ACU> {
    const cursorKey = cursorKey_ACU(input.identity);
    const resumed = readWorldSimulationRunState_ACU(input.identity.chatIdentity, input.identity.taskId, cursorKey);
    const outcomes: WorldSimulationSubagentOutcome_ACU[] = resumed?.subagentOutcomes ? [...resumed.subagentOutcomes] : [];
    const candidates: WorldSimulationCandidate_ACU[] = resumed?.candidates ? [...resumed.candidates] : [];
    const perAgent = new Map<string, number>(Object.entries(resumed?.perAgent ?? {}));
    let delegationsUsed = resumed?.delegationsUsed ?? 0;
    let iteration = Math.max(1, resumed?.nextIteration ?? 1);
    const transcript: Array<{ role: string; content: string }> = [];
    const director = 'world-director' as const;
    const protocolRepair = createWorldSimulationProtocolRepairState_ACU(2);
    const readGateState = createWorldSimulationReadGateState_ACU();
    const toolUsage = { readsUsed: 0 };
    const preset = resolveWorldSimulationAgentApiPreset_ACU(input.settings, director, 'agent_loop', this.dependencies.apiPreset);
    beginWorldSimulationSessionRun_ACU(input.identity.chatIdentity, '世界推演 Agent 运行', resumed ? `从第 ${iteration} 次迭代恢复` : `stage=${input.identity.stageId}`, !!resumed);

    const persist = (nextIteration: number, reviewerFeedback = ''): void => {
      const unique = uniqueCandidates_ACU(candidates);
      saveWorldSimulationRunState_ACU(input.identity.chatIdentity, {
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
      });
    };


    for (; iteration <= input.settings.agentRunBudget.maxIterations; iteration += 1) {
      const requestSnapshot = snapshotWorldSimulationEvidenceRegistry_ACU(input.registry);
      const requestContext = resultContext_ACU(input.promptContext, input.registry, uniqueCandidates_ACU(candidates), outcomes);
      const rendered = await renderWorldSimulationPrompt_ACU(
        input.settings.agentPrompts[director], director,
        createWorldSimulationPlaceholderResolvers_ACU({ ...requestContext, evidenceRegistry: requestSnapshot }),
      );
      const sent = await executeWorldSimulationFinalRequest_ACU({
        messages: [...rendered.messages, ...transcript],
        historyBudgetTokens: input.settings.agentHistoryTokenBudget,
        count: this.dependencies.countTokens ?? countWorldSimulationTokens_ACU,
        invoke: messages => this.dependencies.invoke(director, messages, preset),
      });
      if (sent.status === 'rejected') {
        persist(iteration);
        logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'run_failed', title: '最终请求超出 Token 门禁', detail: sent.reason, agentName: director, ok: false });
        throw new Error(sent.reason);
      }
      const raw = String(sent.response ?? '');
      const allowDelegate = delegationsUsed < input.settings.agentRunBudget.maxDelegations;
      let action;
      try {
        action = parseWorldSimulationMainOutput_ACU(raw, WORLD_SIMULATION_AGENT_PREFILLS_ACU[director], allowDelegate, requestSnapshot);
      } catch (error) {
        const failure = recordWorldSimulationProtocolFailure_ACU(protocolRepair, error);
        if (!failure.retry) {
          persist(iteration, `${failure.issue.reasonCode}:${failure.issue.path}`);
          throw error;
        }
        transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: `主 Agent 输出未通过协议：${failure.issue.reasonCode} ${failure.issue.path}。请只输出修正后的 JSON。` });
        logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'protocol_retry', title: '主 Agent 协议修正', detail: `${failure.issue.reasonCode} ${failure.issue.path}\n模型返回片段：${raw.slice(0, 300) || '(空)'}`, agentName: director, ok: false });
        continue;
      }
      logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'main_action', title: `主 Agent 动作：${action.kind}`, agentName: director });

      if (action.kind === 'read' || action.kind === 'search' || action.kind === 'tools') {
        const calls = action.kind === 'tools' ? action.calls : [action];
        const results = await runWorldSimulationToolBatch_ACU({
          calls, registry: input.registry, dependencies: input.tools,
          gate: {
            state: readGateState,
            config: { historyTokenBudget: input.settings.agentHistoryTokenBudget, readTokenBudget: input.settings.agentReadTokenBudget, fallbackTokens: input.settings.agentReadFallbackTokens },
            usage: toolUsage,
            maxReads: input.settings.agentRunBudget.maxReads,
            count: this.dependencies.countTokens ?? countWorldSimulationTokens_ACU,
          },
        });
        transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: toolResultText_ACU(results) });
        for (const result of results) logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'tool_read', title: `${result.kind}:${result.status}`, detail: `${result.address} ${result.summary}`, agentName: director, ok: result.status === 'ok' || result.status === 'empty' });
        persist(iteration + 1);
        continue;
      }

      if (action.kind === 'delegate') {
        const accepted = [] as typeof action.delegations;
        for (const delegation of action.delegations) {
          const definition = WORLD_SIMULATION_AGENT_CATALOG_ACU.find(item => item.name === delegation.agentName);
          const used = perAgent.get(delegation.agentName) ?? 0;
          const allowedKind = definition && (definition.kind === 'specialist' || definition.kind === 'researcher');
          if (!allowedKind || delegationsUsed + accepted.length >= input.settings.agentRunBudget.maxDelegations || used >= input.settings.agentRunBudget.maxSameAgent || accepted.length >= input.settings.agentRunBudget.maxConcurrent) {
            outcomes.push({ agentName: delegation.agentName, status: 'failed', summary: '派工被预算或角色门禁拒绝', evidenceRefs: [], uncertainties: [], reasonCode: 'WORLD_SIMULATION_DELEGATION_REJECTED' });
            continue;
          }
          accepted.push(delegation);
          logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'delegation', title: `${delegation.agentName} 执行中`, detail: delegation.instruction, agentName: delegation.agentName, status: 'running' });
        }
        const settled = await Promise.all(accepted.map(async delegation => {
          try {
            return await this.dependencies.subagents.run({ delegation, settings: input.settings, promptContext: requestContext, registry: input.registry, tools: input.tools });
          } catch (error) {
            return { agentName: delegation.agentName, status: 'failed' as const, summary: compact_ACU(error), evidenceRefs: [], uncertainties: [], reasonCode: 'WORLD_SIMULATION_SUBAGENT_FAILED' };
          }
        }));
        for (const outcome of settled) {
          delegationsUsed += 1;
          perAgent.set(outcome.agentName, (perAgent.get(outcome.agentName) ?? 0) + 1);
          outcomes.push(outcome);
          if (outcome.candidate) candidates.push(outcome.candidate);
          logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'delegation', title: `${outcome.agentName} ${outcome.status}`, detail: outcome.summary, agentName: outcome.agentName, ok: outcome.status === 'candidate' || outcome.status === 'no_change' });
        }
        transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: JSON.stringify(settled.map(item => ({ agentName: item.agentName, status: item.status, summary: item.summary, candidateId: item.candidate?.candidateId }))) });
        persist(iteration + 1);
        continue;
      }

      if (action.kind === 'block') {
        clearWorldSimulationRunState_ACU(input.identity.chatIdentity);
        logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'block', title: action.reason, detail: action.unresolved.join('；'), agentName: director, ok: false });
        return { outcome: 'blocked', summary: action.reason, unresolved: action.unresolved, outcomes };
      }

      if (action.outcome === 'awaiting_plan_review' || action.outcome === 'stage_replanned') {
        clearWorldSimulationRunState_ACU(input.identity.chatIdentity);
        logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'finalize', title: action.outcome, detail: action.summary, agentName: director });
        return { outcome: action.outcome, summary: action.summary, outcomes };
      }

      if (action.outcome === 'no_change') {
        const insufficient = !action.evidenceRefs.length || !outcomes.length || outcomes.some(item => item.status !== 'no_change') || candidates.length > 0;
        if (insufficient) {
          persist(iteration + 1, 'no_change 缺少完整证据或存在候选/失败结果');
          transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: 'no_change 未满足门禁：必须有授权证据，且已有派工结果全部为 no_change，不得存在候选、失败或 blocked。请继续取证或输出 blocked。' });
          continue;
        }
        clearWorldSimulationRunState_ACU(input.identity.chatIdentity);
        logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'run_completed', title: '世界推演无变化', detail: action.summary, agentName: director });
        return { outcome: 'no_change', summary: action.summary, outcomes };
      }

      const available = uniqueCandidates_ACU(candidates);
      if (!available.length) {
        persist(iteration + 1, 'commit 缺少候选');
        transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: 'commit 没有可审核候选。请继续派工，或在证据不足时输出 blocked。' });
        continue;
      }
      let reviewer;
      try {
        reviewer = await this.dependencies.subagents.runReviewer({ candidates: available, settings: input.settings, promptContext: requestContext, registry: input.registry, tools: input.tools });
      } catch (error) {
        persist(iteration + 1, compact_ACU(error));
        transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: `reviewer 未完成：${compact_ACU(error)}。请继续修正候选或输出 blocked。` });
        continue;
      }
      if (reviewer.verdict === 'revise') {
        persist(iteration + 1, reviewer.summary);
        transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: `reviewer 要求修订：${reviewer.summary}\n${reviewer.findings.map(item => `${item.severity}:${item.reasonCode}:${item.path}`).join('\n')}\n请继续派工修正候选，或在无法修正时输出 blocked。` });
        continue;
      }
      const acceptedIds = new Set(reviewer.acceptedCandidateIds);
      const acceptedCandidates = available.filter(item => acceptedIds.has(item.candidateId));
      if (reviewer.verdict === 'reject' || !acceptedCandidates.length || reviewer.findings.some(item => item.severity === 'blocking')) {
        clearWorldSimulationRunState_ACU(input.identity.chatIdentity);
        const unresolved = reviewer.findings.filter(item => item.severity !== 'minor').map(item => `${item.reasonCode}:${item.path}`);
        logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'block', title: 'reviewer 拒绝候选', detail: reviewer.summary, agentName: 'causality-reviewer', ok: false });
        return { outcome: 'blocked', summary: reviewer.summary, unresolved: unresolved.length ? unresolved : ['reviewer rejected all candidates'], outcomes };
      }
      const causalEvidenceRefs = [...new Set([...action.evidenceRefs, ...acceptedCandidates.flatMap(item => item.evidenceRefs)])];
      let guidanceOutcome: WorldSimulationSubagentOutcome_ACU;
      try {
        const acceptedLedger = applyWorldSimulationCandidates_ACU(
          input.promptContext.worldState as WorldSimulationLedger_ACU,
          acceptedCandidates,
          new Set(causalEvidenceRefs),
        );
        guidanceOutcome = await this.dependencies.subagents.runGuidanceReviewer({
          acceptedLedger,
          candidates: acceptedCandidates,
          settings: input.settings,
          promptContext: requestContext,
          registry: input.registry,
        });
      } catch (error) {
        clearWorldSimulationRunState_ACU(input.identity.chatIdentity);
        const message = compact_ACU(error);
        logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'block', title: 'guidance reviewer 未完成', detail: message, agentName: 'guidance-reviewer', ok: false });
        return { outcome: 'blocked', summary: 'guidance reviewer 未完成', unresolved: [message], outcomes };
      }
      outcomes.push(guidanceOutcome);
      if (guidanceOutcome.status === 'blocked' || guidanceOutcome.status === 'failed') {
        clearWorldSimulationRunState_ACU(input.identity.chatIdentity);
        const unresolved = guidanceOutcome.unresolved?.length ? guidanceOutcome.unresolved : [guidanceOutcome.reasonCode ?? guidanceOutcome.summary];
        logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'block', title: 'guidance reviewer 阻断提交', detail: unresolved.join('；'), agentName: 'guidance-reviewer', ok: false });
        return { outcome: 'blocked', summary: guidanceOutcome.summary, unresolved, outcomes };
      }
      const finalCandidates = guidanceOutcome.candidate ? [...acceptedCandidates, guidanceOutcome.candidate] : acceptedCandidates;
      const evidenceRefs = [...new Set([...causalEvidenceRefs, ...guidanceOutcome.evidenceRefs])];
      clearWorldSimulationRunState_ACU(input.identity.chatIdentity);
      const commitCandidate = { runId: input.identity.runId, taskId: input.identity.taskId, stageId: input.identity.stageId, stageRevision: input.identity.stageRevision, baseLedgerRevision: input.identity.baseLedgerRevision, summary: action.summary, acceptedCandidates: finalCandidates, evidenceRefs, reviewer };
      logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'run_completed', title: `候选通过审核（${finalCandidates.length}/${available.length}+guidance）`, detail: action.summary, agentName: director });
      return { outcome: 'commit', summary: action.summary, commitCandidate, outcomes };
    }

    persist(input.settings.agentRunBudget.maxIterations, 'iteration budget exhausted');
    logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'block', title: '迭代预算耗尽', detail: `maxIterations=${input.settings.agentRunBudget.maxIterations}`, agentName: director, ok: false });
    return { outcome: 'blocked', summary: '世界推演主循环迭代预算耗尽', unresolved: ['iteration budget exhausted'], outcomes };
  }
}
