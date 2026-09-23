import type {
  WorldSimulationLedgerModule_ACU,
  WorldSimulationPendingFixSource_ACU,
  WorldSimulationSettings_ACU,
} from '../model';
import { resolveWorldSimulationAgentApiPreset_ACU, type WorldSimulationApiPresetDependencies_ACU, type WorldSimulationResolvedApiPreset_ACU } from '../api-preset';
import type { WorldSimulationEvidenceRegistry_ACU, WorldSimulationEvidenceRegistrySnapshot_ACU } from '../world-simulation-evidence-registry';
import { snapshotWorldSimulationEvidenceRegistry_ACU } from '../world-simulation-evidence-registry';
import { runWorldSimulationToolBatch_ACU, type WorldSimulationToolDependencies_ACU } from '../world-simulation-agent-tools';
import { findWorldSimulationAgentDefinition_ACU, type WorldSimulationAgentName_ACU } from './agent-catalog';
import { WORLD_SIMULATION_AGENT_PREFILLS_ACU, worldSimulationReviewerProtocolInstruction_ACU, worldSimulationSpecialistProtocolInstruction_ACU } from './agent-defaults';
import type {
  WorldSimulationCandidate_ACU,
  WorldSimulationDelegation_ACU,
  WorldSimulationReviewerResult_ACU,
  WorldSimulationSpecialistResult_ACU,
  WorldSimulationSubagentIssue_ACU,
  WorldSimulationSubagentOutcome_ACU,
} from './agent-model';
import { createWorldSimulationPlaceholderResolvers_ACU, type WorldSimulationPlaceholderContext_ACU } from './agent-placeholder-resolver';
import { createWorldSimulationProtocolRepairState_ACU, parseWorldSimulationJsonDraft_ACU, parseWorldSimulationJsonPayload_ACU, parseWorldSimulationMainOutput_ACU, parseWorldSimulationReviewerResult_ACU, parseWorldSimulationSpecialistResult_ACU, recordWorldSimulationProtocolFailure_ACU, renderWorldSimulationReviewerProtocolRejection_ACU, renderWorldSimulationSpecialistProtocolRejection_ACU } from './agent-protocol';
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

const ITEM_PATCH_MODULES_ACU = new Set<WorldSimulationLedgerModule_ACU>(['dimensions', 'seeds', 'actors', 'rumors']);

function patchModule_ACU(key: string): WorldSimulationLedgerModule_ACU | null {
  if (key === 'chronicleArchive') return 'chronicle';
  return ['clock', 'dimensions', 'seeds', 'actors', 'chronicle', 'guidance', 'rumors', 'player'].includes(key)
    ? key as WorldSimulationLedgerModule_ACU
    : null;
}

function protocolPath_ACU(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;
  const wrapped = error as { error?: { details?: Record<string, unknown> } };
  return typeof wrapped.error?.details?.path === 'string' ? wrapped.error.details.path : fallback;
}

function issue_ACU(
  module: WorldSimulationLedgerModule_ACU,
  source: WorldSimulationPendingFixSource_ACU,
  error: unknown,
  fallbackPath: string,
  id?: string,
): WorldSimulationSubagentIssue_ACU {
  return {
    module,
    source,
    path: protocolPath_ACU(error, fallbackPath),
    message: error instanceof Error ? error.message : String(error),
    ...(id ? { id } : {}),
  };
}

function acceptedPatchKeys_ACU(patch: Record<string, unknown>): string[] {
  const keys: string[] = [];
  for (const [rawModule, value] of Object.entries(patch)) {
    const module = patchModule_ACU(rawModule);
    if (!module) continue;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const items = [...(Array.isArray(record.upsert) ? record.upsert : []), ...(Array.isArray(record.append) ? record.append : []), ...(Array.isArray(record.remove) ? record.remove : [])];
      if (items.length) {
        items.forEach((item, index) => {
          const id = item && typeof item === 'object' && !Array.isArray(item) && typeof (item as Record<string, unknown>).id === 'string'
            ? String((item as Record<string, unknown>).id).trim()
            : '';
          keys.push(`${module}:${id || `index:${index}`}`);
        });
        continue;
      }
    }
    keys.push(`${module}:$`);
  }
  return keys;
}

function outcomeFromSpecialistResult_ACU(
  result: WorldSimulationSpecialistResult_ACU,
  writableModules: readonly WorldSimulationLedgerModule_ACU[],
  runId: string,
  candidateSeq: number,
  truncated: boolean,
): WorldSimulationSubagentOutcome_ACU {
  const moduleCompletion: WorldSimulationSubagentOutcome_ACU['moduleCompletion'] = {};
  const unresolvedIssues: WorldSimulationSubagentIssue_ACU[] = [];
  if (result.status === 'candidate') {
    const candidate = candidate_ACU(result, writableModules, runId, candidateSeq);
    const acceptedKeys = acceptedPatchKeys_ACU(result.patch);
    for (const module of writableModules) {
      const changed = Object.keys(result.patch).some(key => patchModule_ACU(key) === module);
      moduleCompletion[module] = truncated ? (changed ? 'partial' : 'failed') : (changed ? 'complete_changed' : 'complete_no_change');
      if (truncated) unresolvedIssues.push({ module, source: 'truncated', path: `$.patch.${module}`, message: 'specialist JSON 在输出中途截断，尾部写集尚未确认完整' });
    }
    return {
      agentName: result.agentName,
      status: 'candidate',
      summary: result.summary,
      candidate,
      evidenceRefs: result.evidenceRefs,
      uncertainties: result.uncertainties,
      completion: truncated ? 'partial' : 'complete_changed',
      moduleCompletion,
      unresolvedIssues,
      acceptedKeys,
    };
  }
  if (result.status === 'no_change') {
    for (const module of writableModules) {
      moduleCompletion[module] = truncated ? 'failed' : 'complete_no_change';
      if (truncated) unresolvedIssues.push({ module, source: 'truncated', path: module, message: 'no_change 输出被截断，不能据此确认模块完整' });
    }
    return { agentName: result.agentName, status: result.status, summary: result.summary, evidenceRefs: result.evidenceRefs, uncertainties: result.uncertainties, completion: truncated ? 'failed' : 'complete_no_change', moduleCompletion, unresolvedIssues, acceptedKeys: [] };
  }
  for (const module of writableModules) moduleCompletion[module] = 'failed';
  const message = result.status === 'blocked' ? result.unresolved.join('；') : result.message;
  const source: WorldSimulationPendingFixSource_ACU = 'protocol_failed';
  for (const module of writableModules) unresolvedIssues.push({ module, source, path: module, message });
  return result.status === 'blocked'
    ? { agentName: result.agentName, status: result.status, summary: 'blocked', evidenceRefs: [], uncertainties: [], unresolved: result.unresolved, completion: 'failed', moduleCompletion, unresolvedIssues, acceptedKeys: [] }
    : { agentName: result.agentName, status: result.status, summary: result.message, evidenceRefs: [], uncertainties: [], reasonCode: result.reasonCode, completion: 'failed', moduleCompletion, unresolvedIssues, acceptedKeys: [] };
}

function salvageCandidateOutcome_ACU(
  payload: Record<string, unknown>,
  writableModules: readonly WorldSimulationLedgerModule_ACU[],
  snapshot: WorldSimulationEvidenceRegistrySnapshot_ACU,
  runId: string,
  candidateSeq: number,
  truncated: boolean,
): WorldSimulationSubagentOutcome_ACU {
  const patch = payload.patch;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('WORLD_SIMULATION_SPECIALIST_PATCH_REQUIRED');
  const acceptedPatch: Record<string, unknown> = {};
  const issues: WorldSimulationSubagentIssue_ACU[] = [];
  for (const [rawModule, rawPatch] of Object.entries(patch as Record<string, unknown>)) {
    const module = patchModule_ACU(rawModule);
    if (!module || !writableModules.includes(module)) {
      for (const target of writableModules) issues.push({ module: target, source: 'contract_rejected', path: `$.patch.${rawModule}`, message: `Agent 无权写入模块 ${rawModule}` });
      continue;
    }
    const base = { ...payload, patch: { [rawModule]: rawPatch } };
    if (ITEM_PATCH_MODULES_ACU.has(module) && rawPatch && typeof rawPatch === 'object' && !Array.isArray(rawPatch) && (Array.isArray((rawPatch as Record<string, unknown>).upsert) || Array.isArray((rawPatch as Record<string, unknown>).remove))) {
      const record = rawPatch as Record<string, unknown>;
      const acceptedItems: Record<string, unknown[]> = {};
      for (const kind of ['upsert', 'remove'] as const) {
        if (!Array.isArray(record[kind])) continue;
        const accepted: unknown[] = [];
        (record[kind] as unknown[]).forEach((item, index) => {
          const id = item && typeof item === 'object' && !Array.isArray(item) && typeof (item as Record<string, unknown>).id === 'string' ? String((item as Record<string, unknown>).id).trim() : '';
          try {
            parseWorldSimulationSpecialistResult_ACU({ ...payload, patch: { [rawModule]: { [kind]: [item] } } }, snapshot);
            accepted.push(item);
          } catch (error) {
            issues.push(issue_ACU(module, 'contract_rejected', error, `$.patch.${rawModule}.${kind}[${index}]`, id));
          }
        });
        if (accepted.length) acceptedItems[kind] = accepted;
      }
      const extra = Object.keys(record).filter(key => key !== 'upsert' && key !== 'remove');
      if (extra.length) issues.push({ module, source: 'contract_rejected', path: `$.patch.${rawModule}.${extra[0]}`, message: `模块 patch 含未授权字段：${extra.join(',')}` });
      if (Object.keys(acceptedItems).length) acceptedPatch[rawModule] = acceptedItems;
      continue;
    }
    try {
      const parsed = parseWorldSimulationSpecialistResult_ACU(base, snapshot);
      if (parsed.status === 'candidate') acceptedPatch[rawModule] = parsed.patch[rawModule];
    } catch (error) {
      issues.push(issue_ACU(module, 'contract_rejected', error, `$.patch.${rawModule}`));
    }
  }
  if (truncated) {
    for (const module of writableModules) issues.push({ module, source: 'truncated', path: `$.patch.${module}`, message: 'specialist JSON 在输出中途截断，尾部写集尚未确认完整' });
  }
  if (!Object.keys(acceptedPatch).length && !issues.length) throw new Error('WORLD_SIMULATION_SPECIALIST_PATCH_EMPTY');
  const result = parseWorldSimulationSpecialistResult_ACU({ ...payload, patch: acceptedPatch }, snapshot) as Extract<WorldSimulationSpecialistResult_ACU, { status: 'candidate' }>;
  const candidate = candidate_ACU(result, writableModules, runId, candidateSeq);
  const acceptedKeys = acceptedPatchKeys_ACU(acceptedPatch);
  const issueModules = new Set(issues.map(item => item.module));
  const moduleCompletion: WorldSimulationSubagentOutcome_ACU['moduleCompletion'] = {};
  for (const module of writableModules) {
    const changed = Object.keys(acceptedPatch).some(key => patchModule_ACU(key) === module);
    moduleCompletion[module] = issueModules.has(module) ? (changed ? 'partial' : 'failed') : (changed ? 'complete_changed' : 'complete_no_change');
  }
  return { agentName: result.agentName, status: 'candidate', summary: result.summary, candidate, evidenceRefs: result.evidenceRefs, uncertainties: result.uncertainties, completion: issues.length ? 'partial' : 'complete_changed', moduleCompletion, unresolvedIssues: issues, acceptedKeys };
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
    if (!definition || !['specialist', 'researcher'].includes(definition.kind)) {
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
        const draft = parseWorldSimulationJsonDraft_ACU(raw, WORLD_SIMULATION_AGENT_PREFILLS_ACU[agentName], ['status']);
        const payload = bindSpecialistIdentity_ACU(draft.payload, agentName);
        if (String(payload.agentName ?? '').trim() !== agentName) throw new Error('WORLD_SIMULATION_AGENT_IDENTITY_MISMATCH');
        try {
          const result = parseWorldSimulationSpecialistResult_ACU(payload, requestSnapshot);
          return outcomeFromSpecialistResult_ACU(
            result,
            definition.writableModules,
            input.runId,
            input.candidateSeq ?? 1,
            draft.truncated,
          );
        } catch (strictError) {
          try {
            return salvageCandidateOutcome_ACU(
              payload,
              definition.writableModules,
              requestSnapshot,
              input.runId,
              input.candidateSeq ?? 1,
              draft.truncated,
            );
          } catch {
            throw strictError;
          }
        }
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

}
