export const AGENT_FEATURES_ACU = ['continuation', 'world-simulation'] as const;
export type AgentFeature_ACU = typeof AGENT_FEATURES_ACU[number];

export interface AgentMaterialGrantSource_ACU { address: string; revision: string; digest: string; }
export interface AgentMaterialGrant_ACU { grantId: string; source: AgentMaterialGrantSource_ACU; content: string; }
export interface AgentMaterialGrantTable_ACU { feature: AgentFeature_ACU; runId: string; grants: AgentMaterialGrant_ACU[]; }
export type AgentMaterialGrantResolution_ACU =
  | { kind: 'accepted'; grants: AgentMaterialGrant_ACU[] }
  | { kind: 'rejected'; reason: 'scope-mismatch' | 'unknown-grant'; grantId?: string };

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function fail(message: string): never { throw new Error(`AGENT_KERNEL_CONTRACT_INVALID: ${message}`); }
function text(value: unknown, path: string): string { if (typeof value !== 'string' || !value.trim()) fail(`${path} 必须是非空字符串`); return value.trim(); }
function exact(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  if (Object.keys(value).length !== keys.length || !keys.every(key => Object.prototype.hasOwnProperty.call(value, key))) fail(`${path} 包含未知或缺失字段`);
}
export function parseAgentFeature_ACU(value: unknown): AgentFeature_ACU {
  if (typeof value !== 'string' || !(AGENT_FEATURES_ACU as readonly string[]).includes(value)) fail('feature 非法');
  return value as AgentFeature_ACU;
}
function parseGrant(value: unknown, index: number): AgentMaterialGrant_ACU {
  if (!record(value)) fail(`grants[${index}] 必须是对象`);
  exact(value, ['grantId', 'source', 'content'], `grants[${index}]`);
  if (!record(value.source)) fail(`grants[${index}].source 必须是对象`);
  exact(value.source, ['address', 'revision', 'digest'], `grants[${index}].source`);
  return { grantId: text(value.grantId, `grants[${index}].grantId`), source: { address: text(value.source.address, `grants[${index}].source.address`), revision: text(value.source.revision, `grants[${index}].source.revision`), digest: text(value.source.digest, `grants[${index}].source.digest`) }, content: text(value.content, `grants[${index}].content`) };
}
export function parseAgentMaterialGrantTable_ACU(value: unknown): AgentMaterialGrantTable_ACU {
  if (!record(value)) fail('grant table 必须是对象');
  exact(value, ['feature', 'runId', 'grants'], 'grant table');
  if (!Array.isArray(value.grants)) fail('grant table.grants 必须是数组');
  const grants = value.grants.map(parseGrant); const ids = new Set(grants.map(item => item.grantId));
  if (ids.size !== grants.length) fail('grant table 不允许重复 grantId');
  return { feature: parseAgentFeature_ACU(value.feature), runId: text(value.runId, 'runId'), grants };
}
export function resolveAgentMaterialGrants_ACU(table: AgentMaterialGrantTable_ACU, feature: AgentFeature_ACU, runId: string, grantIds: readonly string[]): AgentMaterialGrantResolution_ACU {
  if (table.feature !== feature || table.runId !== runId) return { kind: 'rejected', reason: 'scope-mismatch' };
  const seen = new Set<string>(); const grants: AgentMaterialGrant_ACU[] = [];
  for (const grantId of grantIds) {
    if (!grantId || seen.has(grantId)) return { kind: 'rejected', reason: 'unknown-grant', grantId };
    seen.add(grantId); const grant = table.grants.find(item => item.grantId === grantId);
    if (!grant) return { kind: 'rejected', reason: 'unknown-grant', grantId }; grants.push(grant);
  }
  return { kind: 'accepted', grants };
}