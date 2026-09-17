export const WORLD_SIMULATION_AGENT_NAMES_ACU = [
  'world-director',
  'world-stage-planner',
  'macro-dynamics-analyst',
  'seed-lifecycle-analyst',
  'actor-information-analyst',
  'causality-planner',
  'causality-reviewer',
  'guidance-reviewer',
  'lore-researcher',
] as const;

export type WorldSimulationAgentName_ACU = typeof WORLD_SIMULATION_AGENT_NAMES_ACU[number];
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
  { name: 'world-director', kind: 'director', description: '维护目标、取证、派工、部分采用候选并收敛', triggers: ['每个推演阶段'], promptKey: 'world-director', apiRole: 'world-director', writableModules: [] },
  { name: 'world-stage-planner', kind: 'planner', description: '生成或重规划阶段计划', triggers: ['创建阶段', '计划失效'], promptKey: 'world-stage-planner', apiRole: 'world-stage-planner', writableModules: [] },
  { name: 'macro-dynamics-analyst', kind: 'specialist', description: '分析时间、压力、生长、制度、环境与资源', triggers: ['宏观状态变化'], promptKey: 'macro-dynamics-analyst', apiRole: 'macro-dynamics-analyst', writableModules: ['clock', 'dimensions', 'chronicle'] },
  { name: 'seed-lifecycle-analyst', kind: 'specialist', description: '分析暗流、承诺、催化、衰减与收束', triggers: ['种子生命周期变化'], promptKey: 'seed-lifecycle-analyst', apiRole: 'seed-lifecycle-analyst', writableModules: ['seeds', 'chronicle'] },
  { name: 'actor-information-analyst', kind: 'specialist', description: '分析行动者利益、位置、资源、目标与信息边界', triggers: ['行动者或传播变化'], promptKey: 'actor-information-analyst', apiRole: 'actor-information-analyst', writableModules: ['actors', 'chronicle'] },
  { name: 'causality-planner', kind: 'specialist', description: '把已证实变化组织为跨模块候选 patch', triggers: ['需要跨模块候选'], promptKey: 'causality-planner', apiRole: 'causality-planner', writableModules: ['clock', 'dimensions', 'seeds', 'actors', 'chronicle'] },
  { name: 'causality-reviewer', kind: 'reviewer', description: '审核时间、空间、因果、revision、权限与证据', triggers: ['候选形成后'], promptKey: 'causality-reviewer', apiRole: 'causality-reviewer', writableModules: [] },
  { name: 'guidance-reviewer', kind: 'reviewer', description: '把已接受事实压缩为安全 guidance，不新增事实', triggers: ['因果审核通过后'], promptKey: 'guidance-reviewer', apiRole: 'guidance-reviewer', writableModules: ['guidance'] },
  { name: 'lore-researcher', kind: 'researcher', description: '补充外部公开设定资料，不写入世界账本', triggers: ['本地证据不足且允许外部研究'], promptKey: 'lore-researcher', apiRole: 'lore-researcher', writableModules: [] },
];

export function findWorldSimulationAgentDefinition_ACU(name: string): WorldSimulationAgentDefinition_ACU | null {
  return WORLD_SIMULATION_AGENT_CATALOG_ACU.find(item => item.name === name) ?? null;
}
