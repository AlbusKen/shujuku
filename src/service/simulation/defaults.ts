import type { WorldSimulationBudget_ACU, WorldSimulationSettings_ACU } from './model';

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
  };
}
