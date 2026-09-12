import { createWorldSimError_ACU, WorldSimulationValidationError_ACU, type WorldSimulationAgentName_ACU } from './model';

export interface WorldSimulationDelegation_ACU {
  agent: Exclude<WorldSimulationAgentName_ACU, 'world-director'>;
  instruction: string;
}

export interface WorldSimulationDelegationPlan_ACU {
  delegations: WorldSimulationDelegation_ACU[];
}

function fail(message: string, details?: Record<string, unknown>): never {
  throw new WorldSimulationValidationError_ACU(createWorldSimError_ACU('WORLD_SIM_PROTOCOL_INVALID', 'protocol', message, true, details));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

const SPECIALISTS: readonly WorldSimulationDelegation_ACU['agent'][] = ['entity-movement', 'faction-events', 'thread-weaver'];

/** Parses the main Agent's plan. It may select specialists, never write a world module itself. */
export function parseWorldSimulationDelegationPlan_ACU(raw: string | null | undefined): WorldSimulationDelegationPlan_ACU {
  if (typeof raw !== 'string' || !raw.trim()) fail('世界推演主 Agent 派工计划为空');
  let value: unknown;
  try { value = JSON.parse(raw); } catch (_) { fail('世界推演主 Agent 派工计划不是 JSON'); }
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Array.isArray(value.delegations)) {
    fail('世界推演主 Agent 派工计划必须且只能包含 delegations');
  }
  const seen = new Set<string>();
  const delegations = value.delegations.map((item, index) => {
    if (!isRecord(item) || Object.keys(item).sort().join(',') !== 'agent,instruction'
      || !SPECIALISTS.includes(item.agent as WorldSimulationDelegation_ACU['agent'])
      || typeof item.instruction !== 'string' || !item.instruction.trim()) {
      fail('世界推演主 Agent 派工条目非法', { index });
    }
    if (seen.has(item.agent as string)) fail('世界推演主 Agent 不得重复派同一子代理', { agent: item.agent });
    seen.add(item.agent as string);
    return { agent: item.agent as WorldSimulationDelegation_ACU['agent'], instruction: item.instruction.trim() };
  });
  return { delegations };
}
