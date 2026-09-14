import type { AgentMaterialGrant_ACU } from '../agent-kernel/material-grants';
import type { AgentRequirementSnapshot_ACU } from '../agent-kernel/requirements';
import type { AgentStoryContextSnapshot_ACU } from '../agent-kernel/story-context';
import type { AgentWorldbookSnapshot_ACU } from '../continuation/agent/agent-worldbook-read';
import { parseWorldSimulationSpecialistOutput_ACU, type WorldSimulationSpecialistCandidate_ACU } from './agent/agent-protocol';
import type { WorldSimulationAgentDefinition_ACU } from './agent/agent-catalog';
import { executeWorldSimulationAgentTools_ACU } from './world-simulation-agent-tools';
import { renderWorldSimulationAgentMessages_ACU, renderWorldSimulationUntrustedBlock_ACU, type WorldSimulationPromptMessage_ACU } from './world-simulation-agent-prompts';
import { createWorldSimError_ACU, WorldSimulationValidationError_ACU, type WorldSimulationAgentPrompts_ACU, type WorldStateSnapshot_ACU, type WorldStoryClock_ACU } from './model';

export interface WorldSimulationSpecialistRuntimeInput_ACU {
  agent: WorldSimulationAgentDefinition_ACU; snapshot: WorldStateSnapshot_ACU; anchorMessageIndex: number; storyClock: WorldStoryClock_ACU;
  storyContext?: AgentStoryContextSnapshot_ACU; requirementsSnapshot?: AgentRequirementSnapshot_ACU | null; materialGrants: readonly AgentMaterialGrant_ACU[];
  seedReadRefs: readonly string[]; fixedReads: readonly string[]; worldbook: AgentWorldbookSnapshot_ACU; previousCandidateSummaries: readonly string[];
  maxCalls: number; prompts?: WorldSimulationAgentPrompts_ACU; delegationInstruction?: string; toolsEnabled?: boolean; isCurrent: () => boolean;
}
export interface WorldSimulationSpecialistRuntimeDependencies_ACU {
  runAgent: (request: { messages: readonly WorldSimulationPromptMessage_ACU[]; prompt: string; reads: readonly string[] }) => Promise<string | null>;
}
export interface WorldSimulationSpecialistRuntimeResult_ACU { candidate: WorldSimulationSpecialistCandidate_ACU; callsUsed: number; successfulReadRefs: readonly string[]; }
function fail_ACU(code: 'WORLD_SIM_PROTOCOL_INVALID' | 'WORLD_SIM_BUDGET_EXCEEDED', message: string): never { throw new WorldSimulationValidationError_ACU(createWorldSimError_ACU(code, 'agent', message, false)); }
function flatten_ACU(messages: readonly WorldSimulationPromptMessage_ACU[]): string { return messages.map(message => `[${message.role}]\n${message.content}`).join('\n\n'); }

/** Runs one specialist's only legal loop: frozen reads/search tools followed by a strict C5 candidate. */
export class WorldSimulationSpecialistRuntime_ACU {
  async run(input: WorldSimulationSpecialistRuntimeInput_ACU, dependencies: WorldSimulationSpecialistRuntimeDependencies_ACU): Promise<WorldSimulationSpecialistRuntimeResult_ACU> {
    if (!input.agent.delegated || input.maxCalls < 1 || !input.isCurrent()) fail_ACU('WORLD_SIM_PROTOCOL_INVALID', '世界推演子代理运行身份、角色或预算非法');
    const seed = executeWorldSimulationAgentTools_ACU({ calls: input.seedReadRefs.length ? [{ kind: 'read', reads: [...input.seedReadRefs] }] : [], snapshot: input.snapshot, storyContext: input.storyContext, worldbook: input.worldbook });
    const refs = new Set([...input.materialGrants.map(grant => grant.grantId), ...seed.successfulReadRefs]);
    const materials = [...input.fixedReads, ...(seed.text === '（空工具结果）' ? [] : [seed.text])];
    const history: WorldSimulationPromptMessage_ACU[] = []; let callsUsed = 0;
    while (callsUsed < input.maxCalls) {
      if (!input.isCurrent()) fail_ACU('WORLD_SIM_PROTOCOL_INVALID', '世界推演子代理调用前租约已失效');
      const messages = renderWorldSimulationAgentMessages_ACU({ agent: input.agent, prompts: input.prompts, history, delegationInstruction: input.delegationInstruction, toolsEnabled: input.toolsEnabled, snapshot: input.snapshot, storyClock: input.storyClock, reads: materials, storyContext: input.storyContext, requirementsSnapshot: input.requirementsSnapshot, materialGrants: input.materialGrants, previousCandidateSummaries: input.previousCandidateSummaries });
      const runtimeContext = messages.find(message => message.role === 'user' && message.content.includes('【本次运行上下文】'));
      if (runtimeContext) history.push({ ...runtimeContext });
      callsUsed += 1;
      const raw = await dependencies.runAgent({ messages, prompt: flatten_ACU(messages), reads: materials });
      history.push({ role: 'assistant', content: raw ?? '（模型未返回动作）' });
      const output = parseWorldSimulationSpecialistOutput_ACU({ raw, agent: input.agent, snapshot: input.snapshot, anchorMessageIndex: input.anchorMessageIndex, storyClock: input.storyClock, allowedEvidenceRefs: [...refs] });
      if (!input.isCurrent()) fail_ACU('WORLD_SIM_PROTOCOL_INVALID', '世界推演子代理返回后租约已失效');
      if (output.kind === 'candidate') return { candidate: output, callsUsed, successfulReadRefs: [...refs] };
      if (input.toolsEnabled === false) fail_ACU('WORLD_SIM_PROTOCOL_INVALID', '世界推演子代理工具能力已由设置关闭');
      const result = executeWorldSimulationAgentTools_ACU({ calls: output.calls, snapshot: input.snapshot, storyContext: input.storyContext, worldbook: input.worldbook });
      result.successfulReadRefs.forEach(ref => refs.add(ref));
      history.push({ role: 'user', content: `【工具结果】\n${renderWorldSimulationUntrustedBlock_ACU('UNTRUSTED_TOOL_RESULTS', result.text)}` });
    }
    fail_ACU('WORLD_SIM_BUDGET_EXCEEDED', '世界推演子代理在可用调用预算内未交付候选事务');
  }
}
