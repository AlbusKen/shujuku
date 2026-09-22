import type { WorldSimulationSettings_ACU } from '../model';
import { resolveWorldSimulationAgentApiPreset_ACU, type WorldSimulationApiPresetDependencies_ACU, type WorldSimulationResolvedApiPreset_ACU } from '../api-preset';
import type { WorldSimulationEvidenceRegistry_ACU, WorldSimulationEvidenceRegistrySnapshot_ACU } from '../world-simulation-evidence-registry';
import { snapshotWorldSimulationEvidenceRegistry_ACU } from '../world-simulation-evidence-registry';
import { runWorldSimulationToolBatch_ACU, type WorldSimulationToolDependencies_ACU } from '../world-simulation-agent-tools';
import { findWorldSimulationAgentDefinition_ACU, WORLD_SIMULATION_REQUIREMENTS_MAINTAINER_NAME_ACU, type WorldSimulationAgentName_ACU } from './agent-catalog';
import { WORLD_SIMULATION_AGENT_PREFILLS_ACU, worldSimulationRequirementsMaintainerProtocolInstruction_ACU, worldSimulationReviewerProtocolInstruction_ACU, worldSimulationSpecialistProtocolInstruction_ACU } from './agent-defaults';
import type { WorldSimulationCandidate_ACU, WorldSimulationDelegation_ACU, WorldSimulationReviewerResult_ACU, WorldSimulationSpecialistResult_ACU, WorldSimulationSubagentOutcome_ACU } from './agent-model';
import { createWorldSimulationPlaceholderResolvers_ACU, type WorldSimulationPlaceholderContext_ACU } from './agent-placeholder-resolver';
import { createWorldSimulationProtocolRepairState_ACU, parseWorldSimulationJsonPayload_ACU, parseWorldSimulationMainOutput_ACU, parseWorldSimulationRequirementsMaintainerOutput_ACU, parseWorldSimulationReviewerResult_ACU, parseWorldSimulationSpecialistResult_ACU, recordWorldSimulationProtocolFailure_ACU, renderWorldSimulationRequirementsMaintainerProtocolRejection_ACU, renderWorldSimulationReviewerProtocolRejection_ACU, renderWorldSimulationSpecialistProtocolRejection_ACU } from './agent-protocol';
import { createWorldSimulationReadGateState_ACU, resolveWorldSimulationReadBudget_ACU } from './agent-read-gate';
import { executeWorldSimulationFinalRequest_ACU } from './final-request-token-gate';
import { renderWorldSimulationPrompt_ACU } from './prompt-template';
import { countWorldSimulationTokens_ACU, type WorldSimulationTokenCounter_ACU } from './agent-token-budget';

export interface WorldSimulationAgentInvoker_ACU { (agentName: WorldSimulationAgentName_ACU, messages: readonly { role: string; content: string }[], preset: WorldSimulationResolvedApiPreset_ACU): Promise<string>; }
export interface WorldSimulationSubagentRuntimeDependencies_ACU { invoke: WorldSimulationAgentInvoker_ACU; countTokens?: WorldSimulationTokenCounter_ACU; apiPreset?: WorldSimulationApiPresetDependencies_ACU; protocolRetries?: number; }
export interface WorldSimulationSubagentRunInput_ACU {
  delegation: WorldSimulationDelegation_ACU;
  settings: WorldSimulationSettings_ACU;
  promptContext: WorldSimulationPlaceholderContext_ACU;
  registry: WorldSimulationEvidenceRegistry_ACU;
  tools: WorldSimulationToolDependencies_ACU;
  runId: string;
  candidateSeq?: number;
}
export interface WorldSimulationReviewInput_ACU { candidates: readonly WorldSimulationCandidate_ACU[]; settings: WorldSimulationSettings_ACU; promptContext: WorldSimulationPlaceholderContext_ACU; registry: WorldSimulationEvidenceRegistry_ACU; tools: WorldSimulationToolDependencies_ACU; }
export interface WorldSimulationRequirementsMaintainerResult_ACU { summary: string; requirements: string[]; }

function candidate_ACU(
  result: Extract<WorldSimulationSpecialistResult_ACU, { status: 'candidate' }>,
  writableModules: readonly string[],
  runId: string,
  candidateSeq: number,
): WorldSimulationCandidate_ACU {
  const keys = Object.keys(result.patch);
  const denied = keys.filter(key => key === 'chronicleArchive' ? !writableModules.includes('chronicle') : !writableModules.includes(key));
  if (denied.length) throw new Error(`WORLD_SIMULATION_PATCH_SCOPE_DENIED:${denied.join(',')}`);
  const candidateId = `${runId}:${result.agentName}:${candidateSeq}`;
  return { candidateId, agentName: result.agentName, patch: result.patch, summary: result.summary, evidenceRefs: result.evidenceRefs, uncertainties: result.uncertainties, writableModules: [...writableModules] };
}


function withTask_ACU(
  context: WorldSimulationPlaceholderContext_ACU,
  task: unknown,
  candidates?: readonly WorldSimulationCandidate_ACU[],
  writableModules?: readonly string[],
): WorldSimulationPlaceholderContext_ACU {
  return {
    ...context,
    task,
    worldCandidates: candidates ?? context.worldCandidates,
    evidenceRegistry: context.evidenceRegistry,
    candidateView: candidates ? 'full' : context.candidateView,
    writableModules: writableModules ?? context.writableModules,
  };
}

function bindSpecialistIdentity_ACU(payload: Record<string, unknown>, agentName: WorldSimulationAgentName_ACU): Record<string, unknown> {
  const supplied = typeof payload.agentName === 'string' ? payload.agentName.trim() : '';
  return supplied ? payload : { ...payload, agentName };
}

function toolCalls_ACU(raw: string, prefill: string, snapshot: WorldSimulationEvidenceRegistrySnapshot_ACU) {
  try {
    const action = parseWorldSimulationMainOutput_ACU(raw, prefill, false, snapshot);
    if (action.kind === 'read' || action.kind === 'search') return [action];
    if (action.kind === 'tools') return action.calls;
  } catch { /* specialist/reviewer output is not a tool action */ }
  return null;
}

function toolText_ACU(results: Awaited<ReturnType<typeof runWorldSimulationToolBatch_ACU>>): string {
  return JSON.stringify(results.map(item => ({ kind: item.kind, address: item.address, status: item.status, summary: item.summary, evidenceRef: item.evidenceRef, content: item.content })));
}

export class WorldSimulationSubagentRuntime_ACU {
  constructor(private readonly dependencies: WorldSimulationSubagentRuntimeDependencies_ACU) {}

  async run(input: WorldSimulationSubagentRunInput_ACU): Promise<WorldSimulationSubagentOutcome_ACU> {
    const definition = findWorldSimulationAgentDefinition_ACU(input.delegation.agentName);
    if (!definition || !['specialist', 'researcher'].includes(definition.kind) || definition.name === WORLD_SIMULATION_REQUIREMENTS_MAINTAINER_NAME_ACU) {
      throw new Error('WORLD_SIMULATION_DELEGATION_AGENT_INVALID');
    }
    const agentName = definition.name;
    const preset = resolveWorldSimulationAgentApiPreset_ACU(input.settings, agentName, 'agent_delegate', this.dependencies.apiPreset);
    const context = withTask_ACU(input.promptContext, { instruction: input.delegation.instruction, reads: input.delegation.reads }, undefined, definition.writableModules);
    const transcript: Array<{ role: string; content: string }> = [];
    const repair = createWorldSimulationProtocolRepairState_ACU(this.dependencies.protocolRetries ?? 2);
    const readGateState = createWorldSimulationReadGateState_ACU();
    const toolUsage = { readsUsed: 0 };
    let toolRounds = 0;

    for (;;) {
      const requestSnapshot = snapshotWorldSimulationEvidenceRegistry_ACU(input.registry);
      const readBudget = resolveWorldSimulationReadBudget_ACU({
        historyTokenBudget: input.settings.agentHistoryTokenBudget,
        readTokenBudget: input.settings.agentReadTokenBudget,
        fallbackTokens: input.settings.agentReadFallbackTokens,
      });
      const remainingTokens = Math.max(0, readBudget.effectiveMaxReadTokens - readGateState.grantedTokens);
      const remainingRounds = Math.max(0, input.settings.agentRunBudget.maxExtraReads - toolRounds);
      const readBudgetText = `本轮剩余阅读预算：约 ${remainingTokens} tokens（上限 ${readBudget.effectiveMaxReadTokens}，已授予 ${readGateState.grantedTokens}）；剩余 read/search 轮次 ${remainingRounds}/${input.settings.agentRunBudget.maxExtraReads}。`;
      const requestContext = { ...context, evidenceRegistry: requestSnapshot, readBudgetText };
      const rendered = await renderWorldSimulationPrompt_ACU(input.settings.agentPrompts[agentName], agentName, createWorldSimulationPlaceholderResolvers_ACU(requestContext));
      const protocolGuard = { role: 'system', content: worldSimulationSpecialistProtocolInstruction_ACU(agentName, definition.writableModules) };
      const messages = [...rendered.messages, protocolGuard, ...transcript];
      const sent = await executeWorldSimulationFinalRequest_ACU({
        messages,
        historyBudgetTokens: input.settings.agentHistoryTokenBudget,
        count: this.dependencies.countTokens ?? countWorldSimulationTokens_ACU,
        invoke: value => this.dependencies.invoke(agentName, value, preset),
      });
      if (sent.status === 'rejected') throw new Error(sent.reason);
      const raw = String(sent.response ?? '');
      const calls = toolCalls_ACU(raw, WORLD_SIMULATION_AGENT_PREFILLS_ACU[agentName], requestSnapshot);
      if (calls) {
        transcript.push({ role: 'assistant', content: raw || '(empty)' });
        if (toolRounds >= input.settings.agentRunBudget.maxExtraReads) {
          transcript.push({ role: 'user', content: 'read/search 轮次已用尽，请依据现有证据输出最终 JSON。' });
          continue;
        }
        toolRounds += 1;
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
        transcript.push({ role: 'user', content: toolText_ACU(results) });
        continue;
      }
      try {
        const payload = parseWorldSimulationJsonPayload_ACU(raw, WORLD_SIMULATION_AGENT_PREFILLS_ACU[agentName], ['status']);
        const result = parseWorldSimulationSpecialistResult_ACU(bindSpecialistIdentity_ACU(payload, agentName), requestSnapshot);
        if (result.agentName !== agentName) throw new Error('WORLD_SIMULATION_AGENT_IDENTITY_MISMATCH');
        if (result.status === 'candidate') return { agentName, status: 'candidate', summary: result.summary, candidate: candidate_ACU(result, definition.writableModules, input.runId, input.candidateSeq ?? 1), evidenceRefs: result.evidenceRefs, uncertainties: result.uncertainties };
        if (result.status === 'no_change') return { agentName, status: 'no_change', summary: result.summary, evidenceRefs: result.evidenceRefs, uncertainties: result.uncertainties };
        if (result.status === 'blocked') return { agentName, status: 'blocked', summary: 'blocked', evidenceRefs: [], uncertainties: [], unresolved: result.unresolved };
        return { agentName, status: 'failed', summary: result.message, evidenceRefs: [], uncertainties: [], reasonCode: result.reasonCode };
      } catch (error) {
        const failure = recordWorldSimulationProtocolFailure_ACU(repair, error);
        if (!failure.retry) throw error;
        transcript.push(
          { role: 'assistant', content: raw || '(empty)' },
          { role: 'user', content: renderWorldSimulationSpecialistProtocolRejection_ACU(failure.issue, agentName, definition.writableModules) },
        );
      }
    }
  }

  async runReviewer(input: WorldSimulationReviewInput_ACU): Promise<WorldSimulationReviewerResult_ACU> {
    if (!input.candidates.length) throw new Error('WORLD_SIMULATION_REVIEW_CANDIDATES_REQUIRED');
    const agentName = 'causality-reviewer' as const;
    const preset = resolveWorldSimulationAgentApiPreset_ACU(input.settings, agentName, 'agent_delegate', this.dependencies.apiPreset);
    const context = withTask_ACU(input.promptContext, { objective: '审核候选的时间、因果、权限、revision 与证据完整性' }, input.candidates, []);
    const transcript: Array<{ role: string; content: string }> = [];
    const repair = createWorldSimulationProtocolRepairState_ACU(this.dependencies.protocolRetries ?? 2);
    const readGateState = createWorldSimulationReadGateState_ACU();
    const toolUsage = { readsUsed: 0 };
    let toolRounds = 0;
    for (;;) {
      const requestSnapshot = snapshotWorldSimulationEvidenceRegistry_ACU(input.registry);
      const requestContext = { ...context, evidenceRegistry: requestSnapshot };
      const rendered = await renderWorldSimulationPrompt_ACU(input.settings.agentPrompts[agentName], agentName, createWorldSimulationPlaceholderResolvers_ACU(requestContext));
      const protocolGuard = { role: 'system', content: worldSimulationReviewerProtocolInstruction_ACU() };
      const sent = await executeWorldSimulationFinalRequest_ACU({
        messages: [...rendered.messages, protocolGuard, ...transcript],
        historyBudgetTokens: input.settings.agentHistoryTokenBudget,
        count: this.dependencies.countTokens ?? countWorldSimulationTokens_ACU,
        invoke: value => this.dependencies.invoke(agentName, value, preset),
      });
      if (sent.status === 'rejected') throw new Error(sent.reason);
      const raw = String(sent.response ?? '');
      const calls = toolCalls_ACU(raw, WORLD_SIMULATION_AGENT_PREFILLS_ACU[agentName], requestSnapshot);
      if (calls) {
        transcript.push({ role: 'assistant', content: raw || '(empty)' });
        if (toolRounds >= input.settings.agentRunBudget.maxExtraReads) {
          transcript.push({ role: 'user', content: 'reviewer 的 read/search 轮次已用尽，请依据现有候选与证据输出终审 JSON。' });
          continue;
        }
        toolRounds += 1;
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
        transcript.push({ role: 'user', content: toolText_ACU(results) });
        continue;
      }
      try {
        const payload = parseWorldSimulationJsonPayload_ACU(raw, WORLD_SIMULATION_AGENT_PREFILLS_ACU[agentName], ['verdict']);
        const result = parseWorldSimulationReviewerResult_ACU(payload);
        const known = new Set(input.candidates.map(item => item.candidateId));
        const unknown = result.acceptedCandidateIds.filter(id => !known.has(id));
        if (unknown.length) throw new Error(`WORLD_SIMULATION_REVIEW_UNKNOWN_CANDIDATE:${unknown.join(',')}`);
        if (result.verdict === 'accept' && !result.acceptedCandidateIds.length) throw new Error('WORLD_SIMULATION_REVIEW_ACCEPTANCE_REQUIRED');
        if (result.verdict === 'reject' && result.acceptedCandidateIds.length) throw new Error('WORLD_SIMULATION_REVIEW_REJECT_WITH_ACCEPTED');
        return result;
      } catch (error) {
        const failure = recordWorldSimulationProtocolFailure_ACU(repair, error);
        if (!failure.retry) throw error;
        transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: renderWorldSimulationReviewerProtocolRejection_ACU(failure.issue) });
      }
    }
  }

  async runRequirementsMaintainer(input: {
    instruction: string;
    settings: WorldSimulationSettings_ACU;
    promptContext: WorldSimulationPlaceholderContext_ACU;
    registry: WorldSimulationEvidenceRegistry_ACU;
    tools: WorldSimulationToolDependencies_ACU;
    runId: string;
  }): Promise<WorldSimulationRequirementsMaintainerResult_ACU> {
    const agentName = WORLD_SIMULATION_REQUIREMENTS_MAINTAINER_NAME_ACU;
    const preset = resolveWorldSimulationAgentApiPreset_ACU(input.settings, agentName, 'agent_delegate', this.dependencies.apiPreset);
    const context = withTask_ACU(input.promptContext, { instruction: input.instruction, reads: [] }, undefined, []);
    const transcript: Array<{ role: string; content: string }> = [];
    const repair = createWorldSimulationProtocolRepairState_ACU(this.dependencies.protocolRetries ?? 2);
    const readGateState = createWorldSimulationReadGateState_ACU();
    const toolUsage = { readsUsed: 0 };
    let toolRounds = 0;
    for (;;) {
      const requestSnapshot = snapshotWorldSimulationEvidenceRegistry_ACU(input.registry);
      const requestContext = { ...context, evidenceRegistry: requestSnapshot };
      const rendered = await renderWorldSimulationPrompt_ACU(input.settings.agentPrompts[agentName], agentName, createWorldSimulationPlaceholderResolvers_ACU(requestContext));
      const protocolGuard = { role: 'system', content: worldSimulationRequirementsMaintainerProtocolInstruction_ACU() };
      const sent = await executeWorldSimulationFinalRequest_ACU({
        messages: [...rendered.messages, protocolGuard, ...transcript],
        historyBudgetTokens: input.settings.agentHistoryTokenBudget,
        count: this.dependencies.countTokens ?? countWorldSimulationTokens_ACU,
        invoke: value => this.dependencies.invoke(agentName, value, preset),
      });
      if (sent.status === 'rejected') throw new Error(sent.reason);
      const raw = String(sent.response ?? '');
      const calls = toolCalls_ACU(raw, WORLD_SIMULATION_AGENT_PREFILLS_ACU[agentName], requestSnapshot);
      if (calls) {
        transcript.push({ role: 'assistant', content: raw || '(empty)' });
        if (toolRounds >= input.settings.agentRunBudget.maxExtraReads) {
          transcript.push({ role: 'user', content: 'read/search 轮次已用尽，请依据现有证据输出最终 JSON。' });
          continue;
        }
        toolRounds += 1;
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
        transcript.push({ role: 'user', content: toolText_ACU(results) });
        continue;
      }
      try {
        const payload = parseWorldSimulationJsonPayload_ACU(raw, WORLD_SIMULATION_AGENT_PREFILLS_ACU[agentName], ['summary', 'requirements']);
        return parseWorldSimulationRequirementsMaintainerOutput_ACU(payload);
      } catch (error) {
        const failure = recordWorldSimulationProtocolFailure_ACU(repair, error);
        if (!failure.retry) throw error;
        transcript.push(
          { role: 'assistant', content: raw || '(empty)' },
          { role: 'user', content: renderWorldSimulationRequirementsMaintainerProtocolRejection_ACU(failure.issue) },
        );
      }
    }
  }

}
