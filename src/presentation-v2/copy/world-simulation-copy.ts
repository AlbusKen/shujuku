import { WORLD_SIMULATION_AGENT_NAMES_ACU, type WorldSimulationAgentName_ACU } from '../../service/simulation/agent/agent-catalog';

/** 页面（.vue）不能直接引用 service 值，角色顺序经此处中转。 */
export const WORLD_SIMULATION_AGENT_ORDER_ACU: readonly WorldSimulationAgentName_ACU[] = WORLD_SIMULATION_AGENT_NAMES_ACU;

/**
 * 世界推演各 Agent 的中文展示名。会话流、渠道下拉与提示词分组共用同一张表，
 * 内部 agentName 不直接暴露给用户（与智能续写「各 Agent 渠道」的做法一致）。
 * 退役角色保留展示名，避免旧会话卡片回退成英文内部名。
 */
export const WORLD_SIMULATION_AGENT_DISPLAY_LABELS_ACU: Record<string, string> = {
  'world-director': '主 Agent',
  'world-stage-planner': '阶段规划',
  'timekeeper': '时计',
  'undercurrent-analyst': '暗流分析',
  'dramatis-keeper': '人物档案',
  'chronicler': '编年',
  'causality-reviewer': '因果审核',
  'guidance-composer': '投影决定',
  'lore-researcher': '设定研究',
  'requirements-maintainer': '用户要求维护',
  'world-analyst': '世界推演',
};

export function worldSimulationAgentLabel_ACU(agentName: string): string {
  return WORLD_SIMULATION_AGENT_DISPLAY_LABELS_ACU[agentName] ?? agentName;
}
