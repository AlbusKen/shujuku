import { createWorldSimulationRuntime_ACU, WorldSimulationRuntime_ACU } from './simulation-runtime';

let runtime_ACU: WorldSimulationRuntime_ACU | null = null;

/** Single production coordinator for the whole plugin session. */
export function getWorldSimulationRuntime_ACU(): WorldSimulationRuntime_ACU {
  if (!runtime_ACU) runtime_ACU = createWorldSimulationRuntime_ACU();
  return runtime_ACU;
}

export function resetWorldSimulationRuntimeForTests_ACU(): void {
  runtime_ACU = null;
}
