import type { WorldSimulationLedgerModule_ACU } from '../model';
import type { AgentNativeToolName_ACU } from '../../ai/native-tool';
import { WORLD_RELATED_READONLY_MODULES_ACU } from '../world-catalog';

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
  { name: 'dramatis-keeper', kind: 'specialist', description: '推演行动者信息边界与玩家位置接触的幕后演变', triggers: ['人物移动、生死或玩家位置变化'], promptKey: 'dramatis-keeper', apiRole: 'dramatis-keeper', writableModules: ['actors', 'player'] },
  { name: 'chronicler', kind: 'specialist', description: '综合暗流完结、人物结局与错过清扫，记录台面下重大事件并维护世界里正在传播的传闻', triggers: ['每轮编年与传闻维护'], promptKey: 'chronicler', apiRole: 'chronicler', writableModules: ['chronicle', 'rumors'] },
  { name: 'causality-reviewer', kind: 'reviewer', description: '审核幕后演变的时间、空间、因果、revision、权限与证据，不写入 guidance', triggers: ['用户路径候选终审'], promptKey: 'causality-reviewer', apiRole: 'causality-reviewer', writableModules: [] },
  { name: 'guidance-composer', kind: 'specialist', description: '通读全量账本、锚点正文与玩家信息边界，决定哪些事实以何语态进入台面投影', triggers: ['投影相关字段变化后'], promptKey: 'guidance-composer', apiRole: 'guidance-composer', writableModules: ['guidance'] },
  { name: 'lore-researcher', kind: 'researcher', description: '补充外部公开设定资料支撑幕后推演，不写入世界账本', triggers: ['本地证据不足且允许外部研究'], promptKey: 'lore-researcher', apiRole: 'lore-researcher', writableModules: [] },
];

export type WorldSimulationAgentNativeToolName_ACU = Extract<AgentNativeToolName_ACU, 'read' | 'search' | 'write_sql'>;

/**
 * 角色的 provider 工具白名单。这里是最终 body.tools 的唯一策略来源；
 * 普通角色不因共享 schema 获得 search，能写入账本的角色才获得 write_sql。
 */
export function worldSimulationAgentNativeTools_ACU(
  name: WorldSimulationAgentName_ACU,
): readonly WorldSimulationAgentNativeToolName_ACU[] {
  const definition = WORLD_SIMULATION_AGENT_CATALOG_ACU.find(item => item.name === name);
  if (!definition) throw new Error('WORLD_SIMULATION_AGENT_INVALID');
  const tools: WorldSimulationAgentNativeToolName_ACU[] = ['read'];
  if (definition.kind === 'director' || definition.kind === 'researcher') tools.push('search');
  if (definition.writableModules.length) tools.push('write_sql');
  return tools;
}

/** 只接受完整的条目地址；目录提示与派工 reads 均不能提升角色权限。 */
export function worldSimulationCanReadAddress_ACU(name: WorldSimulationAgentName_ACU, address: string): boolean {
  const definition = findWorldSimulationAgentDefinition_ACU(name);
  if (!definition) return false;
  if (definition.kind === 'director' || definition.kind === 'researcher') return true;
  if (address === 'anchor:message') return true;
  if (name === 'causality-reviewer') {
    return address === 'ledger:current' || address === 'candidates:current'
      || address === 'stage-plan:current' || address === 'chronicle:current'
      || /^(?:dimensions|seeds|actors|rumors|chronicle):[^:]+$/.test(address)
      || /^field:(?:clock|dimensions|seeds|actors|player|rumors|chronicle|guidance):[^:]+(?::[^:]+)?$/.test(address);
  }
  if (definition.kind !== 'specialist') return false;
  if (name === 'guidance-composer') {
    if (address === 'ledger:current' || address === 'player:current' || address === 'projection:preview') return true;
  }
  if (name === 'chronicler' && /^chronicle-archive:[^:]+$/.test(address)) return true;
  const modules = new Set<string>(definition.writableModules);
  for (const module of definition.writableModules) {
    for (const related of WORLD_RELATED_READONLY_MODULES_ACU[module] ?? []) modules.add(related);
  }
  if (name === 'guidance-composer') {
    for (const module of ['clock', 'dimensions', 'seeds', 'actors', 'player', 'rumors', 'chronicle']) modules.add(module);
  }
  const item = /^(dimensions|seeds|actors|rumors|chronicle):([^:]+)$/.exec(address);
  if (item) return modules.has(item[1]);
  const field = /^field:([a-z]+):([^:]+)(?::([^:]+))?$/.exec(address);
  return !!field && modules.has(field[1]);
}

export function findWorldSimulationAgentDefinition_ACU(name: string): WorldSimulationAgentDefinition_ACU | null {
  return WORLD_SIMULATION_AGENT_CATALOG_ACU.find(item => item.name === name) ?? null;
}

/** 主 Agent 可见目录。requirements-maintainer 已退役，当前目录即全部可见角色。 */
export function worldSimulationDirectorVisibleCatalog_ACU(): readonly WorldSimulationAgentDefinition_ACU[] {
  return WORLD_SIMULATION_AGENT_CATALOG_ACU;
}
