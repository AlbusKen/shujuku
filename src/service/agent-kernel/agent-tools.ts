export const AGENT_KERNEL_SEARCH_SCOPES_ACU = ['story', 'ledger', 'tables', 'worldbook', 'proposals'] as const;
export type AgentKernelToolCall_ACU = { kind: 'read'; reads: string[] } | { kind: 'search'; query: string; scope: typeof AGENT_KERNEL_SEARCH_SCOPES_ACU[number][]; isRegex: boolean; maxResults: number };
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function fail(message: string): never { throw new Error(`AGENT_KERNEL_CONTRACT_INVALID: ${message}`); }
function text(value: unknown, path: string): string { if (typeof value !== 'string' || !value.trim()) fail(`${path} 必须是非空字符串`); return value.trim(); }
function exact(value: Record<string, unknown>, keys: readonly string[], path: string): void { if (Object.keys(value).length !== keys.length || !keys.every(key => Object.prototype.hasOwnProperty.call(value, key))) fail(`${path} 包含未知或缺失字段`); }
function list(value: unknown, path: string): string[] { if (!Array.isArray(value) || !value.length || !value.every(item => typeof item === 'string' && item.trim())) fail(`${path} 必须是非空字符串数组`); const items = value.map(item => item.trim()); if (new Set(items).size !== items.length) fail(`${path} 不允许重复`); return items; }
export function parseAgentKernelToolCall_ACU(value: unknown, index = 0): AgentKernelToolCall_ACU {
  if (!record(value)) fail(`calls[${index}] 必须是对象`); const kind = text(value.kind, `calls[${index}].kind`);
  if (kind === 'read') { exact(value, ['kind', 'reads'], `calls[${index}]`); return { kind, reads: list(value.reads, `calls[${index}].reads`) }; }
  if (kind !== 'search') fail(`calls[${index}].kind 非法`); exact(value, ['kind', 'query', 'scope', 'isRegex', 'maxResults'], `calls[${index}]`);
  const scope = list(value.scope, `calls[${index}].scope`); if (!scope.every(item => (AGENT_KERNEL_SEARCH_SCOPES_ACU as readonly string[]).includes(item))) fail(`calls[${index}].scope 含非法域`);
  if (typeof value.isRegex !== 'boolean' || !Number.isInteger(value.maxResults) || (value.maxResults as number) < 1 || (value.maxResults as number) > 100) fail(`calls[${index}] 的搜索参数非法`);
  return { kind, query: text(value.query, `calls[${index}].query`), scope: scope as typeof AGENT_KERNEL_SEARCH_SCOPES_ACU[number][], isRegex: value.isRegex, maxResults: value.maxResults as number };
}
export function parseAgentKernelToolsAction_ACU(value: unknown): { kind: 'tools'; thought: string; calls: AgentKernelToolCall_ACU[] } {
  if (!record(value)) fail('tools 必须是对象'); exact(value, ['action', 'thought', 'calls'], 'tools');
  if (value.action !== 'tools' || !Array.isArray(value.calls) || !value.calls.length) fail('tools 动作非法或 calls 为空');
  return { kind: 'tools', thought: text(value.thought, 'thought'), calls: value.calls.map((call, index) => parseAgentKernelToolCall_ACU(call, index)) };
}