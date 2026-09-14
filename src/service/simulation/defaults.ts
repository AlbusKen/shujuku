import type { WorldSimulationAgentGuidance_ACU, WorldSimulationAgentName_ACU, WorldSimulationAgentPrompts_ACU, WorldSimulationBudget_ACU, WorldSimulationPromptSegment_ACU, WorldSimulationSettings_ACU } from './model';

export const WORLD_SIMULATION_PROMPT_FORCE_DEFAULT_VERSION_ACU = 'spv4.0-world-sim-prompt-placeholders-v3';

/** Whole-segment placeholders for runtime-owned prompt content. */
export const WORLD_SIMULATION_AGENT_PROMPT_PLACEHOLDERS_ACU = [
  '$WORLD_SIMULATION_ROOT', '$WORLD_SIMULATION_SPECIALIST_RULES', '$WORLD_SIMULATION_PROTOCOL', '$WORLD_SIMULATION_TOOL_AVAILABILITY', '$WORLD_SIMULATION_UNTRUSTED_NOTICE',
  '$WORLD_SIMULATION_STORY_CLOCK', '$WORLD_SIMULATION_WORLD_STATE', '$WORLD_SIMULATION_READ_MATERIAL', '$WORLD_SIMULATION_STORY_OVERVIEW', '$WORLD_SIMULATION_STORY_PENDING', '$WORLD_SIMULATION_STORY_BRIDGE', '$WORLD_SIMULATION_STORY_CATALOG', '$WORLD_SIMULATION_USER_REQUEST', '$WORLD_SIMULATION_CURRENT_REQUIREMENTS', '$WORLD_SIMULATION_PENDING_REQUIREMENT_SOURCES', '$WORLD_SIMULATION_WORLDBOOK_CATALOG', '$WORLD_SIMULATION_WORLDBOOK_HITS', '$WORLD_SIMULATION_AGENT_WORLD_BOOK_GRANTS', '$WORLD_SIMULATION_PREVIOUS_SPECIALIST_CANDIDATES', '$WORLD_SIMULATION_TOOL_RESULTS', '$WORLD_SIMULATION_DELEGATION',
] as const;

const DEFAULT_AGENT_GUIDANCE_ACU: WorldSimulationAgentGuidance_ACU = {
  'world-director': '请以证据优先、保守收敛的方式协调本次推演；没有安全变化时如实选择 no_change 或 block。',
  'entity-movement': '只在正文与已验证资料支持时维护实体；信息不足时返回空候选并说明原因。',
  'faction-events': '只记录具备时间与因果依据的外部事件；平静、延迟与无变化都是合法结论。',
  'thread-weaver': '只维护持续性的未决问题与线索；不要把一次性事件机械复制为长期线索。',
};

/** Historical guidance defaults used only when reading pre-placeholder settings. */
export function buildDefaultWorldSimulationAgentGuidance_ACU(): WorldSimulationAgentGuidance_ACU {
  return { ...DEFAULT_AGENT_GUIDANCE_ACU };
}

function promptSegment_ACU(role: WorldSimulationPromptSegment_ACU['role'], content: string): WorldSimulationPromptSegment_ACU {
  return { role, content, enabled: true, deletable: true };
}

/** Creates independent prompt arrays so local drafts cannot mutate subsequent defaults. */
export function buildDefaultWorldSimulationAgentPrompts_ACU(guidance: Partial<WorldSimulationAgentGuidance_ACU> = {}): WorldSimulationAgentPrompts_ACU {
  const build = (agent: WorldSimulationAgentName_ACU): WorldSimulationPromptSegment_ACU[] => [
    promptSegment_ACU('system', '$WORLD_SIMULATION_ROOT'),
    ...(agent === 'world-director' ? [] : [promptSegment_ACU('system', '$WORLD_SIMULATION_SPECIALIST_RULES')]),
    promptSegment_ACU('user', guidance[agent] ?? DEFAULT_AGENT_GUIDANCE_ACU[agent]),
    promptSegment_ACU('user', '$WORLD_SIMULATION_PROTOCOL'),
    promptSegment_ACU('user', '$WORLD_SIMULATION_TOOL_AVAILABILITY'),
    promptSegment_ACU('user', '$WORLD_SIMULATION_UNTRUSTED_NOTICE'),
    promptSegment_ACU('user', '$WORLD_SIMULATION_STORY_CLOCK'),
    promptSegment_ACU('user', '$WORLD_SIMULATION_WORLD_STATE'),
    promptSegment_ACU('user', '$WORLD_SIMULATION_READ_MATERIAL'),
    promptSegment_ACU('user', '$WORLD_SIMULATION_STORY_OVERVIEW'),
    promptSegment_ACU('user', '$WORLD_SIMULATION_STORY_PENDING'),
    promptSegment_ACU('user', '$WORLD_SIMULATION_STORY_BRIDGE'),
    promptSegment_ACU('user', '$WORLD_SIMULATION_STORY_CATALOG'),
    promptSegment_ACU('user', '$WORLD_SIMULATION_USER_REQUEST'),
    promptSegment_ACU('user', '$WORLD_SIMULATION_CURRENT_REQUIREMENTS'),
    ...(agent === 'world-director'
      ? [promptSegment_ACU('user', '$WORLD_SIMULATION_PENDING_REQUIREMENT_SOURCES'), promptSegment_ACU('user', '$WORLD_SIMULATION_WORLDBOOK_CATALOG'), promptSegment_ACU('user', '$WORLD_SIMULATION_WORLDBOOK_HITS')]
      : [promptSegment_ACU('user', '$WORLD_SIMULATION_AGENT_WORLD_BOOK_GRANTS'), promptSegment_ACU('user', '$WORLD_SIMULATION_PREVIOUS_SPECIALIST_CANDIDATES'), promptSegment_ACU('user', '$WORLD_SIMULATION_TOOL_RESULTS'), promptSegment_ACU('user', '$WORLD_SIMULATION_DELEGATION')]),
  ];
  return {
    'world-director': build('world-director'),
    'entity-movement': build('entity-movement'),
    'faction-events': build('faction-events'),
    'thread-weaver': build('thread-weaver'),
  };
}

export const WORLD_SIMULATION_DEFAULT_JOIN_WAIT_MS_ACU = 30_000;
export const WORLD_SIMULATION_MAX_JOIN_WAIT_MS_ACU = 30_000;
export const WORLD_SIMULATION_DEFAULT_MIN_FLOOR_GAP_ACU = 1;
export const WORLD_SIMULATION_DEFAULT_CHECKPOINT_INTERVAL_ACU = 20;
export const WORLD_SIMULATION_DEFAULT_MAX_TRACKED_ENTITIES_ACU = 12;

export const WORLD_SIMULATION_DEFAULT_BUDGETS_ACU: Readonly<Record<'light' | 'normal' | 'deep', WorldSimulationBudget_ACU>> = {
  light: { maxMasterModelTurns: 3, maxSpecialistModelTurns: 2, maxDelegations: 1, readTokenBudget: 'low', legacyReadCount: null },
  normal: { maxMasterModelTurns: 4, maxSpecialistModelTurns: 3, maxDelegations: 2, readTokenBudget: 'medium', legacyReadCount: null },
  deep: { maxMasterModelTurns: 5, maxSpecialistModelTurns: 4, maxDelegations: 4, readTokenBudget: 'high', legacyReadCount: null },
};

export function buildDefaultWorldSimulationSettings_ACU(): WorldSimulationSettings_ACU {
  return {
    enabled: false, joinWaitMs: WORLD_SIMULATION_DEFAULT_JOIN_WAIT_MS_ACU, minFloorGap: WORLD_SIMULATION_DEFAULT_MIN_FLOOR_GAP_ACU,
    checkpointInterval: WORLD_SIMULATION_DEFAULT_CHECKPOINT_INTERVAL_ACU, maxTrackedEntities: WORLD_SIMULATION_DEFAULT_MAX_TRACKED_ENTITIES_ACU,
    visibilityPolicy: 'agent', showHiddenInUi: false, toolsEnabled: true,
    budgets: { light: { ...WORLD_SIMULATION_DEFAULT_BUDGETS_ACU.light }, normal: { ...WORLD_SIMULATION_DEFAULT_BUDGETS_ACU.normal }, deep: { ...WORLD_SIMULATION_DEFAULT_BUDGETS_ACU.deep } },
    agentPrompts: buildDefaultWorldSimulationAgentPrompts_ACU(),
    promptForceDefaultVersion: WORLD_SIMULATION_PROMPT_FORCE_DEFAULT_VERSION_ACU,
  };
}
