import { createWorldSimError_ACU, WorldSimulationValidationError_ACU, type WorldSimulationAgentName_ACU } from './model';
import { parseAgentKernelMainAction_ACU, type AgentKernelMainAction_ACU } from '../agent-kernel/agent-actions';

export interface WorldSimulationDelegation_ACU {
  agent: Exclude<WorldSimulationAgentName_ACU, 'world-director'>;
  instruction: string;
  materialGrants: string[];
  reads: string[];
}

export interface WorldSimulationDelegationPlan_ACU {
  delegations: WorldSimulationDelegation_ACU[];
}

export interface WorldSimulationDelegateAction_ACU {
  kind: 'delegate';
  thought: string;
  plan: WorldSimulationDelegationPlan_ACU;
  /** Old bare {delegations} payloads predate the explicit finalize turn. */
  legacy: boolean;
}

/** The payload stays raw until the session validates it against its frozen user-source set. */
export interface WorldSimulationMaintainRequirementsAction_ACU {
  kind: 'maintain_requirements';
  thought: string;
  payload: Record<string, unknown>;
}

export type WorldSimulationMasterAction_ACU = WorldSimulationDelegateAction_ACU
  | WorldSimulationMaintainRequirementsAction_ACU
  | Extract<AgentKernelMainAction_ACU, { kind: 'tools' | 'finalize' | 'block' }>;

function fail(message: string, details?: Record<string, unknown>): never {
  throw new WorldSimulationValidationError_ACU(createWorldSimError_ACU('WORLD_SIM_PROTOCOL_INVALID', 'protocol', message, true, details));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

const SPECIALISTS: readonly WorldSimulationDelegation_ACU['agent'][] = ['entity-movement', 'faction-events', 'thread-weaver'];
const SPECIALIST_SEED_READ_ADDRESSES_ACU = new Set([
  '$WORLD_STATE',
  '$LEDGER',
  '$STORY_OVERVIEW',
  '$STORY_PENDING',
  '$STORY_BRIDGE',
  '$STORY_CATALOG',
]);

function parseSpecialistSeedReads_ACU(reads: readonly string[]): string[] {
  if (reads.some(address => !SPECIALIST_SEED_READ_ADDRESSES_ACU.has(address))) {
    fail('世界推演子代理种子读取必须是固定目录中的非世界书地址');
  }
  return [...reads];
}

function parseLegacyDelegationPlan_ACU(value: unknown): WorldSimulationDelegationPlan_ACU {
  if (!isRecord(value) || !Array.isArray(value.delegations)) {
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
    return { agent: item.agent as WorldSimulationDelegation_ACU['agent'], instruction: item.instruction.trim(), materialGrants: [] as string[], reads: [] as string[] };
  });
  return { delegations };
}

/** Parses the master decision; legacy bare {delegations} remains a delegate action for stored/custom prompt compatibility. */
export function parseWorldSimulationMasterAction_ACU(raw: string | null | undefined): WorldSimulationMasterAction_ACU {
  if (typeof raw !== 'string' || !raw.trim()) fail('世界推演主 Agent 动作为空');
  let value: unknown;
  try { value = JSON.parse(raw); } catch (_) { fail('世界推演主 Agent 动作不是 JSON'); }
  if (!isRecord(value)) fail('世界推演主 Agent 动作必须是对象');
  if (!Object.prototype.hasOwnProperty.call(value, 'action')) {
    if (Object.keys(value).length !== 1) fail('旧版世界推演派工计划必须且只能包含 delegations');
    return { kind: 'delegate', thought: '', plan: parseLegacyDelegationPlan_ACU(value), legacy: true };
  }
  const thought = typeof value.thought === 'string' && value.thought.trim() ? value.thought.trim() : '';
  if (!thought) fail('世界推演主 Agent 动作必须提供非空 thought');
  if (value.action === 'maintain_requirements') return { kind: 'maintain_requirements', thought, payload: { ...value } };
  try {
    const action = parseAgentKernelMainAction_ACU(value, [], SPECIALISTS);
    if (action.kind === 'maintain_requirements') return { kind: 'maintain_requirements', thought: action.thought, payload: { ...value } };
    if (action.kind !== 'delegate') return action;
    return {
      kind: 'delegate', thought: action.thought, legacy: false,
      plan: { delegations: action.delegations.map(item => ({
        agent: item.agentName as WorldSimulationDelegation_ACU['agent'], instruction: item.task,
        materialGrants: [...item.materialGrants], reads: parseSpecialistSeedReads_ACU(item.reads),
      })) },
    };
  } catch (error) {
    fail(error instanceof Error ? error.message : '世界推演主 Agent 动作非法');
  }
}

/** Compatibility parser for callers that only support delegation. */
export function parseWorldSimulationDelegationPlan_ACU(raw: string | null | undefined): WorldSimulationDelegationPlan_ACU {
  const action = parseWorldSimulationMasterAction_ACU(raw);
  if (action.kind !== 'delegate') fail('当前调用方只接受 delegate，不能执行该主控动作');
  return action.plan;
}
