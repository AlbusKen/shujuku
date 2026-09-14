import { createAgentKernelTokenCounter_ACU, type AgentKernelTokenCounter_ACU } from '../../agent-kernel/token-budget';
import { decideAgentKernelReadBatch_ACU, type AgentKernelReadGateConfig_ACU } from '../../agent-kernel/read-gate';
import { parseAgentStoryContextSnapshot_ACU, type AgentStoryContextSnapshot_ACU } from '../../agent-kernel/story-context';
import type { AgentMaterialGrant_ACU } from '../../agent-kernel/material-grants';
import type { AgentRequirementSnapshot_ACU } from '../../agent-kernel/requirements';
import type { AgentWorldbookSnapshot_ACU } from '../../continuation/agent/agent-worldbook-read';
import { applyWorldSimulationTransaction_ACU, normalizeWorldSimulationTransactionVisibility_ACU } from '../simulation-transaction';
import {
  createWorldSimError_ACU,
  isWorldStateSnapshot_ACU,
  isWorldStoryClock_ACU,
  WorldSimulationValidationError_ACU,
  type WorldSimulationBudget_ACU,
  type WorldSimulationAgentPrompts_ACU,
  type WorldSimulationTransaction_ACU,
  type WorldVisibilityPolicy_ACU,
  type WorldStateSnapshot_ACU,
  type WorldStoryClock_ACU,
} from '../model';
import { selectWorldSimulationAgents_ACU, type WorldSimulationAgentDefinition_ACU } from './agent-catalog';
import { parseWorldSimulationAgentOutput_ACU } from './agent-protocol';
import { renderWorldSimulationAgentMessages_ACU, type WorldSimulationPromptMessage_ACU } from '../world-simulation-agent-prompts';
import { WorldSimulationSpecialistRuntime_ACU } from '../world-simulation-specialist-runtime';

export interface WorldSimulationAgentLoopInput_ACU {
  snapshot: WorldStateSnapshot_ACU;
  anchorMessageIndex: number;
  storyClock: WorldStoryClock_ACU;
  /** Step 8 lease hook. Omitted only by pure callers that have no ephemeral flight. */
  isCurrent?: () => boolean;
  scale: 'light' | 'normal' | 'deep';
  budget: WorldSimulationBudget_ACU;
  maxTrackedEntities: number;
  readTexts: readonly string[];
  readGateConfig: AgentKernelReadGateConfig_ACU;
  contextTokens: number;
  toolsEnabled?: boolean;
  agentPrompts?: WorldSimulationAgentPrompts_ACU;
  delegationInstructions?: ReadonlyMap<string, string>;
  storyContext?: AgentStoryContextSnapshot_ACU;
  userInstruction?: string;
  agents?: readonly WorldSimulationAgentDefinition_ACU[];
  materialGrantsByAgent?: ReadonlyMap<string, readonly AgentMaterialGrant_ACU[]>;
  readTextsByAgent?: ReadonlyMap<string, readonly string[]>;
  requirementsSnapshot?: AgentRequirementSnapshot_ACU | null;
  worldbook?: AgentWorldbookSnapshot_ACU;
  specialistRuntime?: WorldSimulationSpecialistRuntime_ACU;
  visibilityPolicy?: WorldVisibilityPolicy_ACU;
}

export interface WorldSimulationAgentLoopDependencies_ACU {
  countTokens: AgentKernelTokenCounter_ACU;
  runAgent: (request: { agent: WorldSimulationAgentDefinition_ACU; prompt: string; messages: readonly WorldSimulationPromptMessage_ACU[]; snapshot: WorldStateSnapshot_ACU; storyClock: WorldStoryClock_ACU; reads: readonly string[]; isCurrent: () => boolean }) => Promise<string | null>;
}

export interface WorldSimulationAgentLoopResult_ACU {
  snapshot: WorldStateSnapshot_ACU;
  agentsRun: string[];
  callsUsed: number;
  readTokens: number;
  transactions: readonly WorldSimulationTransaction_ACU[];
}

const MAX_PROTOCOL_ATTEMPTS_ACU = 2;

function stale_ACU(message: string): never {
  throw new WorldSimulationValidationError_ACU(createWorldSimError_ACU('WORLD_SIM_STALE', 'orchestrate', message, false));
}

function fail_ACU(code: 'WORLD_SIM_BUDGET_EXCEEDED' | 'WORLD_SIM_PROTOCOL_INVALID', message: string, retryable: boolean, details?: Record<string, unknown>): never {
  throw new WorldSimulationValidationError_ACU(createWorldSimError_ACU(code, 'agent', message, retryable, details));
}

function validBudget_ACU(budget: WorldSimulationBudget_ACU): boolean {
  return Number.isInteger(budget.maxMasterModelTurns) && budget.maxMasterModelTurns >= 1
    && Number.isInteger(budget.maxSpecialistModelTurns) && budget.maxSpecialistModelTurns >= 1
    && Number.isInteger(budget.maxDelegations) && budget.maxDelegations >= 0
    && (budget.legacyReadCount === null || (Number.isInteger(budget.legacyReadCount) && budget.legacyReadCount >= 0))
    && ['low', 'medium', 'high'].includes(budget.readTokenBudget);
}

function renderState_ACU(snapshot: WorldStateSnapshot_ACU): string {
  return JSON.stringify({ revisions: snapshot.revisions, entities: snapshot.entities, events: snapshot.events, threads: snapshot.threads });
}

function renderStoryContextForGate_ACU(context: AgentStoryContextSnapshot_ACU | undefined): string[] {
  return context ? [context.overview.text, context.pending.text, context.bridge.text, context.catalog.text] : [];
}

function flattenMessages_ACU(messages: readonly WorldSimulationPromptMessage_ACU[]): string {
  return messages.map(message => `[${message.role}]\n${message.content}`).join('\n\n');
}

/** Executes a pure candidate-building loop. Persistence and leases belong to later orchestration. */
export async function runWorldSimulationAgentLoop_ACU(input: WorldSimulationAgentLoopInput_ACU, dependencies: WorldSimulationAgentLoopDependencies_ACU): Promise<WorldSimulationAgentLoopResult_ACU> {
  const isCurrent = input.isCurrent ?? (() => true);
  if (typeof input.isCurrent === 'function' && !isCurrent()) stale_ACU('世界推演租约在主循环开始前已失效');
  if (!isWorldStateSnapshot_ACU(input.snapshot) || !isWorldStoryClock_ACU(input.storyClock) || !validBudget_ACU(input.budget)
    || !Number.isInteger(input.anchorMessageIndex) || input.anchorMessageIndex < input.snapshot.anchorMessageIndex
    || input.storyClock.updatedIndex !== input.anchorMessageIndex || !Number.isInteger(input.maxTrackedEntities) || input.maxTrackedEntities < 1
    || !Array.isArray(input.readTexts) || !input.readTexts.every(text => typeof text === 'string')
    || !Number.isFinite(input.contextTokens) || input.contextTokens < 0
    || typeof dependencies.countTokens !== 'function' || typeof dependencies.runAgent !== 'function'
    || (input.visibilityPolicy !== undefined && !['agent', 'always_hidden', 'always_revealed'].includes(input.visibilityPolicy))
    || (input.isCurrent !== undefined && typeof input.isCurrent !== 'function')) {
    fail_ACU('WORLD_SIM_PROTOCOL_INVALID', '世界推演 Agent 主循环输入或预算非法', true);
  }
  if (input.storyContext) {
    try { parseAgentStoryContextSnapshot_ACU(input.storyContext); }
    catch (_) { fail_ACU('WORLD_SIM_PROTOCOL_INVALID', '世界推演正文快照非法', true); }
  }
  const countTokens = createAgentKernelTokenCounter_ACU(dependencies.countTokens);
  const storyMaterials = renderStoryContextForGate_ACU(input.storyContext);
  const readGate = await decideAgentKernelReadBatch_ACU([renderState_ACU(input.snapshot), ...storyMaterials, ...input.readTexts], input.readGateConfig, input.contextTokens, countTokens);
  if (!readGate.allowed) fail_ACU('WORLD_SIM_BUDGET_EXCEEDED', '世界推演读取 token 预算超限', false, { reason: readGate.reason, batchTokens: readGate.batchTokens });
  const agents = input.agents ?? selectWorldSimulationAgents_ACU(input.scale);
  const delegations = agents.filter(agent => agent.delegated).length;
  if (delegations > input.budget.maxDelegations) {
    fail_ACU('WORLD_SIM_BUDGET_EXCEEDED', '世界推演角色计划超过派工预算', false, { delegations, maxDelegations: input.budget.maxDelegations });
  }
  let candidate = input.snapshot;
  const agentsRun: string[] = [];
  const transactions: WorldSimulationTransaction_ACU[] = [];
  const candidateSummaries: string[] = [];
  let callsUsed = 0;
  for (const [agentIndex, agent] of agents.entries()) {
    const seedReads = input.readTextsByAgent?.get(agent.name) ?? [];
    if (!Array.isArray(seedReads) || !seedReads.every(text => typeof text === 'string')) {
      fail_ACU('WORLD_SIM_PROTOCOL_INVALID', '世界推演子代理种子读集非法', true, { agent: agent.name });
    }
    const agentReads = [...input.readTexts, ...seedReads];
    const callBudget = input.budget.maxSpecialistModelTurns;
    if (input.specialistRuntime) {
      if (!input.worldbook || callBudget < 1) fail_ACU('WORLD_SIM_BUDGET_EXCEEDED', '世界推演子代理没有可用工具循环预算或冻结世界书快照', false, { agent: agent.name, callBudget });
      const result = await input.specialistRuntime.run({
        agent, snapshot: input.snapshot, anchorMessageIndex: input.anchorMessageIndex, storyClock: input.storyClock,
        storyContext: input.storyContext, requirementsSnapshot: input.requirementsSnapshot, materialGrants: input.materialGrantsByAgent?.get(agent.name) ?? [],
        seedReadRefs: seedReads, fixedReads: input.readTexts, worldbook: input.worldbook, previousCandidateSummaries: candidateSummaries, prompts: input.agentPrompts, delegationInstruction: input.delegationInstructions?.get(agent.name), toolsEnabled: input.toolsEnabled,
        maxCalls: callBudget, isCurrent,
      }, { runAgent: request => dependencies.runAgent({ agent, prompt: request.prompt, messages: request.messages, snapshot: input.snapshot, storyClock: input.storyClock, reads: request.reads, isCurrent }) });
      callsUsed += result.callsUsed;
      const transaction = result.candidate.transaction && normalizeWorldSimulationTransactionVisibility_ACU(result.candidate.transaction, input.visibilityPolicy ?? 'agent');
      if (transaction) { candidate = applyWorldSimulationTransaction_ACU(candidate, transaction, input.maxTrackedEntities); transactions.push(transaction); }
      candidateSummaries.push(JSON.stringify({ agent: agent.name, summary: result.candidate.summary, evidenceRefs: result.candidate.evidenceRefs, uncertainties: result.candidate.uncertainties }));
      agentsRun.push(agent.name);
      continue;
    }
    let lastProtocolError: unknown;
    let succeeded = false;
    const allowedAttempts = Math.min(MAX_PROTOCOL_ATTEMPTS_ACU, input.budget.maxSpecialistModelTurns);
    for (let attempt = 1; attempt <= allowedAttempts; attempt += 1) {
      callsUsed += 1;
      const currentReadGate = await decideAgentKernelReadBatch_ACU([renderState_ACU(candidate), ...storyMaterials, ...agentReads], input.readGateConfig, input.contextTokens, countTokens);
      if (!currentReadGate.allowed) fail_ACU('WORLD_SIM_BUDGET_EXCEEDED', '世界推演候选状态超出读取 token 预算', false, { reason: currentReadGate.reason, batchTokens: currentReadGate.batchTokens });
      if (!isCurrent()) stale_ACU('世界推演租约在 AI 调用前已失效');
      const messages = renderWorldSimulationAgentMessages_ACU({ agent, prompts: input.agentPrompts, delegationInstruction: input.delegationInstructions?.get(agent.name), toolsEnabled: input.toolsEnabled, snapshot: candidate, storyClock: input.storyClock, reads: agentReads, storyContext: input.storyContext, userInstruction: input.userInstruction, materialGrants: input.materialGrantsByAgent?.get(agent.name) });
      const raw = await dependencies.runAgent({ agent, prompt: flattenMessages_ACU(messages), messages, snapshot: candidate, storyClock: input.storyClock, reads: agentReads, isCurrent });
      if (!isCurrent()) stale_ACU('世界推演租约在 AI 响应返回后已失效');
      try {
        const parsed = parseWorldSimulationAgentOutput_ACU({ raw, agent, snapshot: candidate, anchorMessageIndex: input.anchorMessageIndex, storyClock: input.storyClock });
        const transaction = parsed && normalizeWorldSimulationTransactionVisibility_ACU(parsed, input.visibilityPolicy ?? 'agent');
        if (transaction) {
          candidate = applyWorldSimulationTransaction_ACU(candidate, transaction, input.maxTrackedEntities);
          transactions.push(transaction);
        }
        agentsRun.push(agent.name);
        lastProtocolError = undefined;
        succeeded = true;
        break;
      } catch (error) {
        if (!(error instanceof WorldSimulationValidationError_ACU) || error.error.code !== 'WORLD_SIM_PROTOCOL_INVALID') throw error;
        lastProtocolError = error;
      }
    }
    if (succeeded) continue;
    if (lastProtocolError) throw lastProtocolError;
    fail_ACU('WORLD_SIM_BUDGET_EXCEEDED', '世界推演子代理没有剩余模型轮次', false, { agent: agent.name, callsUsed, maxSpecialistModelTurns: input.budget.maxSpecialistModelTurns });
  }
  return { snapshot: candidate, agentsRun, callsUsed, readTokens: readGate.batchTokens, transactions };
}
