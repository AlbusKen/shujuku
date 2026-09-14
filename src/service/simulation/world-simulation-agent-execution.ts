import { findWorldSimulationAgent_ACU } from './agent/agent-catalog';
import { runWorldSimulationAgentLoop_ACU, type WorldSimulationAgentLoopResult_ACU } from './agent/agent-main-loop';
import type { WorldSimulationDelegationPlan_ACU, WorldSimulationMasterAction_ACU } from './world-simulation-agent-interaction';
import { WorldSimulationDirectorRuntime_ACU } from './world-simulation-director-runtime';
import { WorldSimulationSpecialistRuntime_ACU } from './world-simulation-specialist-runtime';
import type { AgentWorldbookSnapshot_ACU } from '../continuation/agent/agent-worldbook-read';
import type { WorldSimulationPromptMessage_ACU } from './world-simulation-agent-prompts';
import type { AgentStoryContextSnapshot_ACU } from '../agent-kernel/story-context';
import type { AgentRequirementSnapshot_ACU } from '../agent-kernel/requirements';
import type { AgentMaterialGrant_ACU } from '../agent-kernel/material-grants';
import { createWorldSimError_ACU, WorldSimulationValidationError_ACU, type WorldSimulationSettings_ACU, type WorldStateSnapshot_ACU, type WorldStoryClock_ACU } from './model';
import type { AgentKernelReadGateConfig_ACU } from '../agent-kernel/read-gate';

export interface WorldSimulationManualAgentExecutionInput_ACU {
  runId: string; snapshot: WorldStateSnapshot_ACU; anchorMessageIndex: number; storyClock: WorldStoryClock_ACU;
  settings: WorldSimulationSettings_ACU; reads: readonly string[]; storyContext?: AgentStoryContextSnapshot_ACU;
  /** 冻结表格快照（共享上下文产出）。 */
  tableData?: unknown;
  /** 冻结纪要概览文本（共享上下文产出）。 */
  summaryOverview?: string;
  requirementsSnapshot?: AgentRequirementSnapshot_ACU | null; pendingRequirementSourceIds?: readonly string[];
  masterCallsUsed?: number; history?: readonly WorldSimulationPromptMessage_ACU[]; isCurrent: () => boolean; userInstruction: string; readGateConfig: AgentKernelReadGateConfig_ACU;
}
export interface WorldSimulationManualAgentExecutionDependencies_ACU {
  countTokens: (text: string) => Promise<number>;
  runAgent: (request: { source: string; messages: readonly WorldSimulationPromptMessage_ACU[]; prompt: string }) => Promise<string | null>;
}
export interface WorldSimulationManualAgentExecutionResult_ACU { action: WorldSimulationMasterAction_ACU; plan: WorldSimulationDelegationPlan_ACU; loop: WorldSimulationAgentLoopResult_ACU | null; grants: readonly AgentMaterialGrant_ACU[]; history: readonly WorldSimulationPromptMessage_ACU[]; }
function fail_ACU(code: 'WORLD_SIM_PROTOCOL_INVALID' | 'WORLD_SIM_BUDGET_EXCEEDED', message: string): never { throw new WorldSimulationValidationError_ACU(createWorldSimError_ACU(code, 'agent', message, false)); }

/** Main Agent selects specialists; only selected role-bound specialists may produce transactions. */
export async function runWorldSimulationManualAgentExecution_ACU(input: WorldSimulationManualAgentExecutionInput_ACU, dependencies: WorldSimulationManualAgentExecutionDependencies_ACU): Promise<WorldSimulationManualAgentExecutionResult_ACU> {
  const runSpecialists = async (plan: WorldSimulationDelegationPlan_ACU, grantsByAgent: ReadonlyMap<string, readonly AgentMaterialGrant_ACU[]>, specialistModelTurns: number, worldbook: AgentWorldbookSnapshot_ACU, legacy: boolean, shared: { tableData?: unknown; summaryOverview?: string }): Promise<WorldSimulationAgentLoopResult_ACU> => {
    const agents = plan.delegations.map(item => findWorldSimulationAgent_ACU(item.agent)!);
    if (!agents.length) return { snapshot: input.snapshot, agentsRun: [], callsUsed: 0, readTokens: 0, transactions: [] };
    const instructions = new Map(plan.delegations.map(item => [item.agent, item.instruction]));
    const readsByAgent = new Map(plan.delegations.map(item => [item.agent, item.reads]));
    return runWorldSimulationAgentLoop_ACU({
      snapshot: input.snapshot, anchorMessageIndex: input.anchorMessageIndex, storyClock: input.storyClock, isCurrent: input.isCurrent,
      scale: 'deep', budget: { ...input.settings.budgets.deep, maxSpecialistModelTurns: specialistModelTurns, maxDelegations: plan.delegations.length }, maxTrackedEntities: input.settings.maxTrackedEntities,
      readTexts: input.reads, readGateConfig: input.readGateConfig, contextTokens: 0, toolsEnabled: input.settings.toolsEnabled, agentPrompts: input.settings.agentPrompts, delegationInstructions: instructions,
      storyContext: input.storyContext, tableData: shared.tableData, summaryOverview: shared.summaryOverview, userInstruction: input.userInstruction, agents, materialGrantsByAgent: grantsByAgent, readTextsByAgent: readsByAgent, requirementsSnapshot: input.requirementsSnapshot, worldbook, ...(legacy ? {} : { specialistRuntime: new WorldSimulationSpecialistRuntime_ACU() }), visibilityPolicy: input.settings.visibilityPolicy,
    }, { countTokens: dependencies.countTokens, runAgent: request => dependencies.runAgent({ source: `world-sim-agent:${request.agent.name}`, messages: request.messages, prompt: request.prompt }) });
  };
  const result = await new WorldSimulationDirectorRuntime_ACU().run({
    runId: input.runId, snapshot: input.snapshot, storyClock: input.storyClock, settings: input.settings, reads: input.reads,
    storyContext: input.storyContext, requirementsSnapshot: input.requirementsSnapshot, pendingRequirementSourceIds: input.pendingRequirementSourceIds,
    masterCallsUsed: input.masterCallsUsed, history: input.history, isCurrent: input.isCurrent, userInstruction: input.userInstruction, tableData: input.tableData, summaryOverview: input.summaryOverview,
  }, { runMaster: dependencies.runAgent, runSpecialists });
  if (result.action.kind === 'block') fail_ACU('WORLD_SIM_PROTOCOL_INVALID', `world-director 阻断本轮：${result.action.reason}`);
  return { action: result.action, plan: result.plan, loop: result.loop, grants: result.grants, history: result.history };
}
