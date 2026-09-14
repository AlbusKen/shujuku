import { parseAgentRequirementsReplacement_ACU, type AgentRequirementsReplacement_ACU } from './requirements';
import { parseAgentKernelToolsAction_ACU, type AgentKernelToolCall_ACU } from './agent-tools';

export interface AgentKernelDelegation_ACU { agentName: string; task: string; materialGrants: string[]; reads: string[]; }
export type AgentKernelMainAction_ACU =
  | { kind: 'maintain_requirements'; thought: string; replacement: AgentRequirementsReplacement_ACU }
  | { kind: 'tools'; thought: string; calls: AgentKernelToolCall_ACU[] }
  | { kind: 'delegate'; thought: string; delegations: AgentKernelDelegation_ACU[] }
  | { kind: 'finalize'; thought: string; decision: 'commit' | 'no_change'; acceptedAgents: string[]; summary: string; unresolved: string[] }
  | { kind: 'block'; thought: string; reason: string; unresolved: string[] };
export interface AgentExplicitControlRequest_ACU { kind: 'interrupt_and_maintain'; instruction: string; }

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function fail(message: string): never { throw new Error(`AGENT_KERNEL_CONTRACT_INVALID: ${message}`); }
function text(value: unknown, path: string): string { if (typeof value !== 'string' || !value.trim()) fail(`${path} 必须是非空字符串`); return value.trim(); }
function exact(value: Record<string, unknown>, keys: readonly string[], path: string): void { if (Object.keys(value).length !== keys.length || !keys.every(key => Object.prototype.hasOwnProperty.call(value, key))) fail(`${path} 包含未知或缺失字段`); }
function strings(value: unknown, path: string, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && !value.length) || !value.every(item => typeof item === 'string' && item.trim())) fail(`${path} 必须是${allowEmpty ? '' : '非空'}字符串数组`);
  const list = value.map(item => item.trim()); if (new Set(list).size !== list.length) fail(`${path} 不允许重复`); return list;
}
function parseDelegation(value: unknown, index: number, allowed: ReadonlySet<string>): AgentKernelDelegation_ACU {
  if (!record(value)) fail(`delegations[${index}] 必须是对象`); exact(value, ['agentName', 'task', 'materialGrants', 'reads'], `delegations[${index}]`);
  const agentName = text(value.agentName, `delegations[${index}].agentName`); if (!allowed.has(agentName)) fail(`delegations[${index}].agentName 未获授权`);
  const materialGrants = strings(value.materialGrants, `delegations[${index}].materialGrants`, true);
  if (!materialGrants.every(item => /^W[1-9]\d*$/.test(item))) fail(`delegations[${index}].materialGrants 只能使用 W 编码`);
  const reads = strings(value.reads, `delegations[${index}].reads`, true);
  if (reads.some(item => item.startsWith('$WORLDBOOK:'))) fail(`delegations[${index}].reads 不得绕过 materialGrants 注入世界书`);
  return { agentName, task: text(value.task, `delegations[${index}].task`), materialGrants, reads };
}
export function parseAgentKernelMainAction_ACU(value: unknown, knownUserMessageIds: readonly string[], allowedAgents: readonly string[]): AgentKernelMainAction_ACU {
  if (!record(value)) fail('主动作必须是对象'); const action = text(value.action, 'action');
  if (action === 'maintain_requirements') return { kind: action, thought: text(value.thought, 'thought'), replacement: parseAgentRequirementsReplacement_ACU(value, knownUserMessageIds) };
  if (action === 'tools') return parseAgentKernelToolsAction_ACU(value);
  if (action === 'delegate') { exact(value, ['action', 'thought', 'delegations'], 'delegate'); if (!Array.isArray(value.delegations) || !value.delegations.length) fail('delegations 必须为非空数组'); const delegations = value.delegations.map((item, index) => parseDelegation(item, index, new Set(allowedAgents))); if (new Set(delegations.map(item => item.agentName)).size !== delegations.length) fail('同一动作不能重复派遣代理'); return { kind: action, thought: text(value.thought, 'thought'), delegations }; }
  if (action === 'finalize') { exact(value, ['action', 'thought', 'decision', 'acceptedAgents', 'summary', 'unresolved'], 'finalize'); const decision = text(value.decision, 'decision'); if (decision !== 'commit' && decision !== 'no_change') fail('finalize.decision 非法'); return { kind: action, thought: text(value.thought, 'thought'), decision, acceptedAgents: strings(value.acceptedAgents, 'acceptedAgents', true), summary: text(value.summary, 'summary'), unresolved: strings(value.unresolved, 'unresolved', true) }; }
  if (action === 'block') { exact(value, ['action', 'thought', 'reason', 'unresolved'], 'block'); return { kind: action, thought: text(value.thought, 'thought'), reason: text(value.reason, 'reason'), unresolved: strings(value.unresolved, 'unresolved', true) }; }
  fail(`action 非法：${action}`);
}
export function parseAgentExplicitControlRequest_ACU(value: unknown): AgentExplicitControlRequest_ACU {
  if (!record(value)) fail('控制请求必须是对象'); exact(value, ['action', 'instruction'], '控制请求'); if (value.action !== 'interrupt_and_maintain') fail('控制请求 action 非法'); return { kind: 'interrupt_and_maintain', instruction: text(value.instruction, 'instruction') };
}