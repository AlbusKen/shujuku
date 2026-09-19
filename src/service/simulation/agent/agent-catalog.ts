export const WORLD_SIMULATION_AGENT_NAMES_ACU = [
  'world-director',
  'world-stage-planner',
  'world-analyst',
  'causality-reviewer',
  'lore-researcher',
] as const;

export type WorldSimulationAgentName_ACU = typeof WORLD_SIMULATION_AGENT_NAMES_ACU[number];
export const WORLD_SIMULATION_RETIRED_AGENT_NAMES_ACU = [
  'macro-dynamics-analyst',
  'seed-lifecycle-analyst',
  'actor-information-analyst',
  'causality-planner',
  'guidance-reviewer',
] as const;
export type WorldSimulationRetiredAgentName_ACU = typeof WORLD_SIMULATION_RETIRED_AGENT_NAMES_ACU[number];
export type WorldSimulationAgentKind_ACU = 'director' | 'planner' | 'specialist' | 'reviewer' | 'researcher';
export type WorldSimulationLedgerModule_ACU = 'clock' | 'dimensions' | 'seeds' | 'actors' | 'chronicle' | 'guidance';

export interface WorldSimulationAgentDefinition_ACU {
  name: WorldSimulationAgentName_ACU;
  kind: WorldSimulationAgentKind_ACU;
  description: string;
  triggers: readonly string[];
  promptKey: WorldSimulationAgentName_ACU;
  apiRole: WorldSimulationAgentName_ACU;
  writableModules: readonly WorldSimulationLedgerModule_ACU[];
}

export const WORLD_SIMULATION_AGENT_CATALOG_ACU: readonly WorldSimulationAgentDefinition_ACU[] = [
  { name: 'world-director', kind: 'director', description: '每轮剧情后推算幕后世界动态：取证、派工、部分采用候选并直接收敛提交', triggers: ['每轮推演'], promptKey: 'world-director', apiRole: 'world-director', writableModules: [] },
  { name: 'world-stage-planner', kind: 'planner', description: '为单轮幕后推演锁定焦点：本轮要推算的暗流、维度与行动者动向', triggers: ['每轮推演开始'], promptKey: 'world-stage-planner', apiRole: 'world-stage-planner', writableModules: [] },
  { name: 'world-analyst', kind: 'specialist', description: '推演世界时钟、维度压力、暗流种子生命周期与行动者信息边界的幕后演变，一次产出跨模块候选', triggers: ['每轮幕后推演'], promptKey: 'world-analyst', apiRole: 'world-analyst', writableModules: ['clock', 'dimensions', 'seeds', 'actors', 'chronicle'] },
  { name: 'causality-reviewer', kind: 'reviewer', description: '审核幕后演变的时间、空间、因果、revision、权限与证据，并把已接受事实压缩为台面安全 guidance', triggers: ['每轮候选形成后'], promptKey: 'causality-reviewer', apiRole: 'causality-reviewer', writableModules: ['guidance'] },
  { name: 'lore-researcher', kind: 'researcher', description: '补充外部公开设定资料支撑幕后推演，不写入世界账本', triggers: ['本地证据不足且允许外部研究'], promptKey: 'lore-researcher', apiRole: 'lore-researcher', writableModules: [] },
];

export function findWorldSimulationAgentDefinition_ACU(name: string): WorldSimulationAgentDefinition_ACU | null {
  return WORLD_SIMULATION_AGENT_CATALOG_ACU.find(item => item.name === name) ?? null;
}
