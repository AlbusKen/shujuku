import { WORLD_SIMULATION_DIRECTOR_DEFINITION_ACU, findWorldSimulationAgent_ACU } from './agent/agent-catalog';
import { runWorldSimulationAgentLoop_ACU, type WorldSimulationAgentLoopResult_ACU } from './agent/agent-main-loop';
import { parseWorldSimulationDelegationPlan_ACU, type WorldSimulationDelegationPlan_ACU } from './world-simulation-agent-interaction';
import { renderWorldSimulationMasterMessages_ACU, renderWorldSimulationUntrustedBlock_ACU, type WorldSimulationPromptMessage_ACU } from './world-simulation-agent-prompts';
import type { WorldSimulationAgentPrompts_ACU, WorldSimulationSettings_ACU, WorldStateSnapshot_ACU, WorldStoryClock_ACU } from './model';
import type { AgentKernelReadGateConfig_ACU } from '../agent-kernel/read-gate';

export interface WorldSimulationManualAgentExecutionInput_ACU {
  snapshot: WorldStateSnapshot_ACU;
  anchorMessageIndex: number;
  storyClock: WorldStoryClock_ACU;
  settings: WorldSimulationSettings_ACU;
  reads: readonly string[];
  isCurrent: () => boolean;
  userInstruction: string;
  readGateConfig: AgentKernelReadGateConfig_ACU;
}
export interface WorldSimulationManualAgentExecutionDependencies_ACU {
  countTokens: (text: string) => Promise<number>;
  runAgent: (request: { source: string; messages: readonly WorldSimulationPromptMessage_ACU[]; prompt: string }) => Promise<string | null>;
}
export interface WorldSimulationManualAgentExecutionResult_ACU { plan: WorldSimulationDelegationPlan_ACU; loop: WorldSimulationAgentLoopResult_ACU | null; }
function flatten(messages: readonly WorldSimulationPromptMessage_ACU[]): string { return messages.map(message => `[${message.role}]\n${message.content}`).join('\n\n'); }

/** Main Agent selects specialists; only selected role-bound specialists may produce transactions. */
export async function runWorldSimulationManualAgentExecution_ACU(input: WorldSimulationManualAgentExecutionInput_ACU, dependencies: WorldSimulationManualAgentExecutionDependencies_ACU): Promise<WorldSimulationManualAgentExecutionResult_ACU> {
  const budget = input.settings.budgets.deep;
  if (budget.maxIterations < 1) throw new Error('世界推演 deep 预算无法执行主 Agent');
  const masterMessages = renderWorldSimulationMasterMessages_ACU({ agent: WORLD_SIMULATION_DIRECTOR_DEFINITION_ACU, prompts: input.settings.agentPrompts, snapshot: input.snapshot, storyClock: input.storyClock, reads: input.reads, userInstruction: input.userInstruction });
  const plan = parseWorldSimulationDelegationPlan_ACU(await dependencies.runAgent({ source: 'world-sim-master', messages: masterMessages, prompt: flatten(masterMessages) }));
  if (!plan.delegations.length) return { plan, loop: null };
  const agents = plan.delegations.map(item => findWorldSimulationAgent_ACU(item.agent)!);
  const instructions = new Map(plan.delegations.map(item => [item.agent, item.instruction]));
  const loop = await runWorldSimulationAgentLoop_ACU({
    snapshot: input.snapshot, anchorMessageIndex: input.anchorMessageIndex, storyClock: input.storyClock, isCurrent: input.isCurrent,
    scale: 'deep', budget: { ...budget, maxIterations: budget.maxIterations - 1 }, maxTrackedEntities: input.settings.maxTrackedEntities,
    readTexts: input.reads, readGateConfig: input.readGateConfig, contextTokens: 0, agentPrompts: input.settings.agentPrompts,
    userInstruction: input.userInstruction, agents, visibilityPolicy: input.settings.visibilityPolicy,
  }, { countTokens: dependencies.countTokens, runAgent: request => {
    const instruction = instructions.get(request.agent.name as WorldSimulationDelegationPlan_ACU['delegations'][number]['agent']) ?? '';
    const messages = request.messages.map(message => ({ ...message }));
    const tail = messages[messages.length - 1];
    if (tail?.role === 'user') tail.content = `${tail.content}\n\n${renderWorldSimulationUntrustedBlock_ACU('UNTRUSTED_DELEGATION', instruction)}`;
    // Keep the legacy flattened prompt semantically identical to the role-preserving messages:
    // delegation remains untrusted on both transport shapes.
    return dependencies.runAgent({ source: `world-sim-agent:${request.agent.name}`, messages, prompt: flatten(messages) });
  } });
  return { plan, loop };
}
