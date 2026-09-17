import { sha256HexSync_ACU } from '../../../shared/sha256-sync';
import type { WorldSimulationLedger_ACU, WorldSimulationRunIdentity_ACU, WorldSimulationSettings_ACU } from '../model';
import { applyWorldSimulationCandidates_ACU } from '../simulation-transaction';
import type { WorldSimulationEvidenceRegistry_ACU } from '../world-simulation-evidence-registry';
import { snapshotWorldSimulationEvidenceRegistry_ACU } from '../world-simulation-evidence-registry';
import { runWorldSimulationToolBatch_ACU, type WorldSimulationToolDependencies_ACU } from '../world-simulation-agent-tools';
import { resolveWorldSimulationAgentApiPreset_ACU, type WorldSimulationApiPresetDependencies_ACU } from '../api-preset';
import { WORLD_SIMULATION_AGENT_CATALOG_ACU } from './agent-catalog';
import { WORLD_SIMULATION_AGENT_PREFILLS_ACU, worldSimulationDirectorProtocolInstruction_ACU } from './agent-defaults';
import type { WorldSimulationCandidate_ACU, WorldSimulationMainLoopResult_ACU, WorldSimulationSubagentOutcome_ACU } from './agent-model';
import { createWorldSimulationPlaceholderResolvers_ACU, type WorldSimulationPlaceholderContext_ACU } from './agent-placeholder-resolver';
import { createWorldSimulationProtocolRepairState_ACU, parseWorldSimulationMainOutput_ACU, recordWorldSimulationProtocolFailure_ACU, renderWorldSimulationDirectorProtocolRejection_ACU } from './agent-protocol';
import { createWorldSimulationReadGateState_ACU } from './agent-read-gate';
import { clearWorldSimulationRunState_ACU, readWorldSimulationRunState_ACU, saveWorldSimulationRunState_ACU } from './agent-run-cache';
import { beginWorldSimulationSessionRun_ACU, endWorldSimulationSessionRun_ACU, logWorldSimulationSession_ACU, updateWorldSimulationSession_ACU } from './agent-session-log';
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
        sent = await executeWorldSimulationFinalRequest_ACU({
          messages: [...rendered.messages, { role: 'system', content: worldSimulationDirectorProtocolInstruction_ACU() }, ...transcript],
          historyBudgetTokens: input.settings.agentHistoryTokenBudget,
          count: this.dependencies.countTokens ?? countWorldSimulationTokens_ACU,
          invoke: messages => this.dependencies.invoke(director, messages, preset),
        });
      } catch (error) {
        updateWorldSimulationSession_ACU(input.identity.chatIdentity, mainEntryId, { title: `主 Agent 第 ${iteration} 轮失败`, detail: compact_ACU(error), ok: false, status: 'failed' });
        throw error;
      }
      if (sent.status === 'rejected') {
        updateWorldSimulationSession_ACU(input.identity.chatIdentity, mainEntryId, { title: `主 Agent 第 ${iteration} 轮失败`, detail: sent.reason, ok: false, status: 'failed' });
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
        updateWorldSimulationSession_ACU(input.identity.chatIdentity, mainEntryId, { title: `主 Agent 第 ${iteration} 轮协议未通过`, detail: `${failure.issue.reasonCode} ${failure.issue.path}`, ok: false, status: 'failed' });
        if (!failure.retry) {
          persist(iteration, `${failure.issue.reasonCode}:${failure.issue.path}`);
          throw error;
        }
        transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: renderWorldSimulationDirectorProtocolRejection_ACU(failure.issue, allowDelegate) });
        logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'protocol_retry', title: '主 Agent 协议修正', detail: `${failure.issue.reasonCode} ${failure.issue.path}\n模型返回片段：${raw.slice(0, 300) || '(空)'}`, agentName: director, ok: false });
        continue;
      }
      updateWorldSimulationSession_ACU(input.identity.chatIdentity, mainEntryId, { title: `主 Agent 动作：${action.kind}`, detail: `第 ${iteration} 轮决策完成`, ok: true, status: 'done' });

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
        } catch (error) {
          updateWorldSimulationSession_ACU(input.identity.chatIdentity, toolEntryId, { title: '资料读取失败', detail: compact_ACU(error), ok: false, status: 'failed' });
          throw error;
        }
        transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: toolResultText_ACU(results) });
        persist(iteration + 1);
        continue;
      }

      if (action.kind === 'delegate') {
        const accepted = [] as typeof action.delegations;
        const runningEntries = new Map<(typeof action.delegations)[number], number>();
        for (const delegation of action.delegations) {
          const definition = WORLD_SIMULATION_AGENT_CATALOG_ACU.find(item => item.name === delegation.agentName);
          const used = perAgent.get(delegation.agentName) ?? 0;
          const allowedKind = definition && (definition.kind === 'specialist' || definition.kind === 'researcher');
          if (!allowedKind || delegationsUsed + accepted.length >= input.settings.agentRunBudget.maxDelegations || used >= input.settings.agentRunBudget.maxSameAgent || accepted.length >= input.settings.agentRunBudget.maxConcurrent) {
            outcomes.push({ agentName: delegation.agentName, status: 'failed', summary: '派工被预算或角色门禁拒绝', evidenceRefs: [], uncertainties: [], reasonCode: 'WORLD_SIMULATION_DELEGATION_REJECTED' });
            continue;
          }
          accepted.push(delegation);
          runningEntries.set(delegation, logWorldSimulationSession_ACU(input.identity.chatIdentity, {
            kind: 'delegation', title: `${delegation.agentName} 正在工作`, detail: delegation.instruction, agentName: delegation.agentName, status: 'running',
          }));
        }
        const settled = await Promise.all(accepted.map(async delegation => {
          try {
            return await this.dependencies.subagents.run({ delegation, settings: input.settings, promptContext: requestContext, registry: input.registry, tools: input.tools });
          } catch (error) {
            return { agentName: delegation.agentName, status: 'failed' as const, summary: compact_ACU(error), evidenceRefs: [], uncertainties: [], reasonCode: 'WORLD_SIMULATION_SUBAGENT_FAILED' };
          }
        }));
        for (let index = 0; index < settled.length; index += 1) {
          const outcome = settled[index];
          delegationsUsed += 1;
          perAgent.set(outcome.agentName, (perAgent.get(outcome.agentName) ?? 0) + 1);
          outcomes.push(outcome);
          if (outcome.candidate) candidates.push(outcome.candidate);
          const ok = outcome.status === 'candidate' || outcome.status === 'no_change';
          updateWorldSimulationSession_ACU(input.identity.chatIdentity, runningEntries.get(accepted[index])!, { title: `${outcome.agentName} ${outcome.status}`, detail: outcome.summary, ok, status: ok ? 'done' : 'failed' });
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
      const reviewerEntryId = logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'delegation', title: '因果审核正在工作', detail: `正在审核 ${available.length} 个候选的时间、因果、权限与证据完整性`, agentName: 'causality-reviewer', status: 'running' });
      try {
        reviewer = await this.dependencies.subagents.runReviewer({ candidates: available, settings: input.settings, promptContext: requestContext, registry: input.registry, tools: input.tools });
        updateWorldSimulationSession_ACU(input.identity.chatIdentity, reviewerEntryId, { title: `因果审核：${reviewer.verdict}`, detail: reviewer.summary, ok: reviewer.verdict !== 'reject', status: reviewer.verdict === 'reject' ? 'failed' : 'done' });
      } catch (error) {
        updateWorldSimulationSession_ACU(input.identity.chatIdentity, reviewerEntryId, { title: '因果审核失败', detail: compact_ACU(error), ok: false, status: 'failed' });
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
      const guidanceEntryId = logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'delegation', title: '可感知 guidance 审核正在工作', detail: '正在将已接受的幕后账本压缩为角色可感知信号，不新增事实', agentName: 'guidance-reviewer', status: 'running' });
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
        const guidanceOk = guidanceOutcome.status === 'candidate' || guidanceOutcome.status === 'no_change';
        updateWorldSimulationSession_ACU(input.identity.chatIdentity, guidanceEntryId, { title: `guidance 审核：${guidanceOutcome.status}`, detail: guidanceOutcome.summary, ok: guidanceOk, status: guidanceOk ? 'done' : 'failed' });
      } catch (error) {
        updateWorldSimulationSession_ACU(input.identity.chatIdentity, guidanceEntryId, { title: 'guidance 审核失败', detail: compact_ACU(error), ok: false, status: 'failed' });
        clearWorldSimulationRunState_ACU(input.identity.chatIdentity);
        endWorldSimulationSessionRun_ACU(input.identity.chatIdentity);
        const message = compact_ACU(error);
        return { outcome: 'blocked', summary: 'guidance reviewer 未完成', unresolved: [message], outcomes };
      }
      outcomes.push(guidanceOutcome);
      if (guidanceOutcome.status === 'blocked' || guidanceOutcome.status === 'failed') {
        clearWorldSimulationRunState_ACU(input.identity.chatIdentity);
        endWorldSimulationSessionRun_ACU(input.identity.chatIdentity);
        const unresolved = guidanceOutcome.unresolved?.length ? guidanceOutcome.unresolved : [guidanceOutcome.reasonCode ?? guidanceOutcome.summary];
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
