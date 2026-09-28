import { WORLD_SIMULATION_AGENT_NAMES_ACU, type WorldSimulationAgentName_ACU } from '../../service/simulation/agent/agent-catalog';

/** 页面（.vue）不能直接引用 service 值；无真实调用入口的研究员仅保留旧配置迁移，不再暴露为可编辑 Agent。 */
export const WORLD_SIMULATION_AGENT_ORDER_ACU: readonly WorldSimulationAgentName_ACU[] = WORLD_SIMULATION_AGENT_NAMES_ACU
  .filter(agentName => agentName !== 'lore-researcher');

/**
 * 格林推演各 Agent 的中文展示名。会话流、渠道下拉与提示词分组共用同一张表，
 * 内部 agentName 不直接暴露给用户（与智能续写「各 Agent 渠道」的做法一致）。
 * 退役角色保留展示名，避免旧会话卡片回退成英文内部名。
 */
export const WORLD_SIMULATION_AGENT_DISPLAY_LABELS_ACU: Record<string, string> = {
  'world-director': '主 Agent',
  'world-stage-planner': '阶段规划',
  'timekeeper': '旧角色：时计',
  'undercurrent-analyst': '时序与伏线',
  'dramatis-keeper': '人物谱',
  'chronicler': '旧角色：纪要',
  'causality-reviewer': '因果审核',
  'guidance-composer': '纪要、风声与场外信号',
  'lore-researcher': '设定研究',
  'requirements-maintainer': '用户要求维护',
  'world-analyst': '格林推演',
};

export function worldSimulationAgentLabel_ACU(agentName: string): string {
  return WORLD_SIMULATION_AGENT_DISPLAY_LABELS_ACU[agentName] ?? agentName;
}
