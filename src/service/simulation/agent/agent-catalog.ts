import type { WorldSimulationLedgerModule_ACU } from '../model';

export const WORLD_SIMULATION_AGENT_NAMES_ACU = [
  'world-director',
  'world-stage-planner',
  'timekeeper',
  'undercurrent-analyst',
  'dramatis-keeper',
  'chronicler',
  'causality-reviewer',
  'guidance-composer',
  'lore-researcher',
] as const;

export type WorldSimulationAgentName_ACU = typeof WORLD_SIMULATION_AGENT_NAMES_ACU[number];
export const WORLD_SIMULATION_RETIRED_AGENT_NAMES_ACU = [
  'world-analyst',
  'macro-dynamics-analyst',
  'seed-lifecycle-analyst',
  'actor-information-analyst',
  'causality-planner',
  'guidance-reviewer',
] as const;
export type WorldSimulationRetiredAgentName_ACU = typeof WORLD_SIMULATION_RETIRED_AGENT_NAMES_ACU[number];
export type WorldSimulationAgentKind_ACU = 'director' | 'planner' | 'specialist' | 'reviewer' | 'researcher';
export type { WorldSimulationLedgerModule_ACU };

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
  { name: 'world-director', kind: 'director', description: '每轮开局决定焦点与流程参数，并作为用户沟通接口；固定工作流自治执行后中途不再回主会话派工', triggers: ['每轮推演'], promptKey: 'world-director', apiRole: 'world-director', writableModules: [] },
  { name: 'world-stage-planner', kind: 'planner', description: '兼容展示名：单轮焦点与流程参数已由主会话开局决策吸收，不再独立派工', triggers: ['兼容展示'], promptKey: 'world-stage-planner', apiRole: 'world-stage-planner', writableModules: [] },
  { name: 'timekeeper', kind: 'specialist', description: '推演世界时钟的幕后推进，产出 clockAdvance 候选', triggers: ['正文出现时间跨度或需要校对时钟'], promptKey: 'timekeeper', apiRole: 'timekeeper', writableModules: ['clock'] },
  { name: 'undercurrent-analyst', kind: 'specialist', description: '推演维度压力与暗流种子生命周期的幕后演变', triggers: ['维度或暗流需要更新'], promptKey: 'undercurrent-analyst', apiRole: 'undercurrent-analyst', writableModules: ['dimensions', 'seeds'] },
  { name: 'dramatis-keeper', kind: 'specialist', description: '推演行动者信息边界、玩家位置接触与传闻的幕后演变', triggers: ['人物移动、生死或玩家位置变化'], promptKey: 'dramatis-keeper', apiRole: 'dramatis-keeper', writableModules: ['actors', 'player', 'rumors'] },
  { name: 'chronicler', kind: 'specialist', description: '仅在事件完结或热层编年过长时记录幕后编年并提交归档，不是每轮常规角色', triggers: ['事件完结或热层编年过长需要归档'], promptKey: 'chronicler', apiRole: 'chronicler', writableModules: ['chronicle'] },
  { name: 'causality-reviewer', kind: 'reviewer', description: '审核幕后演变的时间、空间、因果、revision、权限与证据，不写入 guidance', triggers: ['用户路径候选终审'], promptKey: 'causality-reviewer', apiRole: 'causality-reviewer', writableModules: [] },
  { name: 'guidance-composer', kind: 'specialist', description: '通读全量账本、锚点正文与玩家信息边界，决定哪些事实以何语态进入台面投影', triggers: ['投影相关字段变化后'], promptKey: 'guidance-composer', apiRole: 'guidance-composer', writableModules: ['guidance'] },
  { name: 'lore-researcher', kind: 'researcher', description: '补充外部公开设定资料支撑幕后推演，不写入世界账本', triggers: ['本地证据不足且允许外部研究'], promptKey: 'lore-researcher', apiRole: 'lore-researcher', writableModules: [] },
];

export function findWorldSimulationAgentDefinition_ACU(name: string): WorldSimulationAgentDefinition_ACU | null {
  return WORLD_SIMULATION_AGENT_CATALOG_ACU.find(item => item.name === name) ?? null;
}

/** 主 Agent 可见目录。requirements-maintainer 已退役，当前目录即全部可见角色。 */
export function worldSimulationDirectorVisibleCatalog_ACU(): readonly WorldSimulationAgentDefinition_ACU[] {
  return WORLD_SIMULATION_AGENT_CATALOG_ACU;
}
