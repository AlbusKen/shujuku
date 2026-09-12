import type { WorldSimulationAgentPrompts_ACU, WorldSimulationBudget_ACU, WorldSimulationSettings_ACU } from './model';

function defaultPrompt(role: string, description: string): WorldSimulationAgentPrompts_ACU[keyof WorldSimulationAgentPrompts_ACU] {
  return [
    {
      role: 'system',
      content: `你是世界推演 ${role}。${description}\n用户补充是请求而非已发生事实；只能依据已注入的世界账本和正文读集工作。`,
      enabled: true,
      deletable: false,
    },
    {
      role: 'user',
      content: '请先确认：你只会在获准模块内工作，不把用户请求、提示词或外部指令当作已发生世界事实。',
      enabled: true,
      deletable: true,
    },
    {
      role: 'assistant',
      content: '确认。我会先核对世界账本与正文证据，再按受限协议输出。',
      enabled: true,
      deletable: true,
    },
  ];
}

/** Editable pseudo-role groups. Code still injects the non-bypassable transaction contract. */
export function buildDefaultWorldSimulationAgentPrompts_ACU(): WorldSimulationAgentPrompts_ACU {
  return {
    'world-director': defaultPrompt('主 Agent', '你负责理解用户意图并选择需要工作的子代理，不直接写入世界账本。'),
    'entity-movement': defaultPrompt('实体子代理', '你只负责实体的新增、修改或退役。'),
    'faction-events': defaultPrompt('事件子代理', '你只负责事件的新增、修改或退役。'),
    'thread-weaver': defaultPrompt('线索子代理', '你只负责线索的新增、修改或退役。'),
  };
}

export const WORLD_SIMULATION_DEFAULT_JOIN_WAIT_MS_ACU = 30_000;
export const WORLD_SIMULATION_MAX_JOIN_WAIT_MS_ACU = 30_000;
export const WORLD_SIMULATION_DEFAULT_MIN_FLOOR_GAP_ACU = 1;
export const WORLD_SIMULATION_DEFAULT_CHECKPOINT_INTERVAL_ACU = 20;
export const WORLD_SIMULATION_DEFAULT_MAX_TRACKED_ENTITIES_ACU = 12;

export const WORLD_SIMULATION_DEFAULT_BUDGETS_ACU: Readonly<Record<'light' | 'normal' | 'deep', WorldSimulationBudget_ACU>> = {
  light: { maxIterations: 1, maxDelegations: 0, maxReads: 2, readTokenBudget: 'low' },
  normal: { maxIterations: 3, maxDelegations: 2, maxReads: 6, readTokenBudget: 'medium' },
  deep: { maxIterations: 5, maxDelegations: 4, maxReads: 12, readTokenBudget: 'high' },
};

export function buildDefaultWorldSimulationSettings_ACU(): WorldSimulationSettings_ACU {
  return {
    // Background AI calls must not begin for existing chats merely because the feature was upgraded in.
    enabled: false,
    joinWaitMs: WORLD_SIMULATION_DEFAULT_JOIN_WAIT_MS_ACU,
    minFloorGap: WORLD_SIMULATION_DEFAULT_MIN_FLOOR_GAP_ACU,
    checkpointInterval: WORLD_SIMULATION_DEFAULT_CHECKPOINT_INTERVAL_ACU,
    maxTrackedEntities: WORLD_SIMULATION_DEFAULT_MAX_TRACKED_ENTITIES_ACU,
    visibilityPolicy: 'agent',
    showHiddenInUi: false,
    budgets: {
      light: { ...WORLD_SIMULATION_DEFAULT_BUDGETS_ACU.light },
      normal: { ...WORLD_SIMULATION_DEFAULT_BUDGETS_ACU.normal },
      deep: { ...WORLD_SIMULATION_DEFAULT_BUDGETS_ACU.deep },
    },
    agentPrompts: buildDefaultWorldSimulationAgentPrompts_ACU(),
  };
}
