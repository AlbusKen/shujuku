import type { WorldSimulationModule_ACU, WorldSimulationScale_ACU } from '../model';
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
  name: 'world-director', description: '整合当前世界状态，做最低成本的直接推演；可协调实体、事件与线索，但不得写正文。', writableModules: ['entities', 'events', 'threads'], delegated: false,
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
  if (scale === 'light') return [WORLD_SIMULATION_DIRECTOR_DEFINITION_ACU];
  if (scale === 'normal') return [WORLD_SIMULATION_DIRECTOR_DEFINITION_ACU, WORLD_SIMULATION_AGENT_CATALOG_ACU[0], WORLD_SIMULATION_AGENT_CATALOG_ACU[1]];
  return [WORLD_SIMULATION_DIRECTOR_DEFINITION_ACU, ...WORLD_SIMULATION_AGENT_CATALOG_ACU];
}

export function renderWorldSimulationAgentCatalog_ACU(): string {
  return WORLD_SIMULATION_AGENT_CATALOG_ACU.map(agent => `- ${agent.name}：${agent.description} 写入：${agent.writableModules.join('、') || '无'}。`).join('\n');
}
