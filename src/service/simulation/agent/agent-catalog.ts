import type { WorldSimulationModule_ACU, WorldSimulationScale_ACU, WorldStateSnapshot_ACU } from '../model';
export type { WorldSimulationAgentName_ACU } from '../model';
import type { WorldSimulationAgentName_ACU } from '../model';

export interface WorldSimulationAgentDefinition_ACU {
  name: WorldSimulationAgentName_ACU;
  description: string;
  writableModules: readonly WorldSimulationModule_ACU[];
  delegated: boolean;
}

/** Main-loop-owned direct role. It is not one of the three delegated specialists. */
export const WORLD_SIMULATION_DIRECTOR_DEFINITION_ACU: WorldSimulationAgentDefinition_ACU = {
  name: 'world-director', description: '整合当前世界状态、读取资料、协调受限子代理并收敛候选；不直接写入任何领域模块。', writableModules: [], delegated: false,
};

/** The design's three delegated specialists. */
export const WORLD_SIMULATION_AGENT_CATALOG_ACU: readonly WorldSimulationAgentDefinition_ACU[] = [
  { name: 'entity-movement', description: '推演主视角外 NPC、势力与地点的可行动向，只写实体模块。', writableModules: ['entities'], delegated: true },
  { name: 'faction-events', description: '推演势力反应、外部事件与后果，只写事件模块。', writableModules: ['events'], delegated: true },
  { name: 'thread-weaver', description: '维护暗线、传闻与收束中的线索，只写线索模块。', writableModules: ['threads'], delegated: true },
];

export function findWorldSimulationAgent_ACU(name: string): WorldSimulationAgentDefinition_ACU | null {
  if (name === WORLD_SIMULATION_DIRECTOR_DEFINITION_ACU.name) return WORLD_SIMULATION_DIRECTOR_DEFINITION_ACU;
  return WORLD_SIMULATION_AGENT_CATALOG_ACU.find(agent => agent.name === name) ?? null;
}

/** Light avoids delegation; normal/deep widen the same deterministic responsibility sequence. */
export function selectWorldSimulationAgents_ACU(scale: WorldSimulationScale_ACU): readonly WorldSimulationAgentDefinition_ACU[] {
  if (scale === 'light') return [];
  if (scale === 'normal') return [WORLD_SIMULATION_AGENT_CATALOG_ACU[0], WORLD_SIMULATION_AGENT_CATALOG_ACU[1]];
  return WORLD_SIMULATION_AGENT_CATALOG_ACU;
}

/**
 * A light round may bypass the director only when every gate hint identifies exactly one
 * existing ledger module and all resolved hints agree on that same specialist.
 */
export function selectWorldSimulationLightAgentFromFocusHints_ACU(
  snapshot: Pick<WorldStateSnapshot_ACU, 'entities' | 'events' | 'threads'>,
  focusHints: readonly string[],
): WorldSimulationAgentDefinition_ACU | null {
  if (!Array.isArray(focusHints) || !focusHints.length || !focusHints.every(hint => typeof hint === 'string' && hint.trim())) return null;
  let selectedModule: WorldSimulationModule_ACU | null = null;
  for (const hint of focusHints) {
    const matches = (['entities', 'events', 'threads'] as const).filter(module => snapshot[module].some(item => item.id === hint));
    if (matches.length !== 1) return null;
    if (selectedModule !== null && selectedModule !== matches[0]) return null;
    selectedModule = matches[0];
  }
  return selectedModule === null
    ? null
    : WORLD_SIMULATION_AGENT_CATALOG_ACU.find(agent => agent.writableModules.includes(selectedModule)) ?? null;
}

export function renderWorldSimulationAgentCatalog_ACU(): string {
  return WORLD_SIMULATION_AGENT_CATALOG_ACU.map(agent => `- ${agent.name}：${agent.description} 写入：${agent.writableModules.join('、') || '无'}。`).join('\n');
}
