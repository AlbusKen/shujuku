import { parseAgentFeature_ACU, type AgentFeature_ACU } from './material-grants';

export const AGENT_REQUIREMENT_CATEGORIES_ACU = ['goal', 'preference', 'prohibition', 'canon', 'process'] as const;
export const AGENT_REQUIREMENT_PRIORITIES_ACU = ['normal', 'hard'] as const;
export type AgentRequirementCategory_ACU = typeof AGENT_REQUIREMENT_CATEGORIES_ACU[number];
export type AgentRequirementPriority_ACU = typeof AGENT_REQUIREMENT_PRIORITIES_ACU[number];
export interface AgentRequirement_ACU { id: string; category: AgentRequirementCategory_ACU; priority: AgentRequirementPriority_ACU; text: string; sourceRefs: string[]; }
export interface AgentRequirementSnapshot_ACU { feature: AgentFeature_ACU; revision: number; lastAppliedUserMessageId: string | null; requirements: AgentRequirement_ACU[]; }
export interface AgentRequirementsReplacement_ACU { expectedRevision: number; appliedUserMessageId: string; requirements: AgentRequirement_ACU[]; summary: string; }

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function fail(message: string): never { throw new Error(`AGENT_KERNEL_CONTRACT_INVALID: ${message}`); }
function text(value: unknown, path: string): string { if (typeof value !== 'string' || !value.trim()) fail(`${path} 必须是非空字符串`); return value.trim(); }
function exact(value: Record<string, unknown>, keys: readonly string[], path: string): void { if (Object.keys(value).length !== keys.length || !keys.every(key => Object.prototype.hasOwnProperty.call(value, key))) fail(`${path} 包含未知或缺失字段`); }
function revision(value: unknown, path: string): number { if (!Number.isInteger(value) || (value as number) < 0) fail(`${path} 必须是非负整数`); return value as number; }
function parseRequirement(value: unknown, index: number, known?: ReadonlySet<string>, allowLegacySourceRefObjects = false): AgentRequirement_ACU {
  if (!record(value)) fail(`requirements[${index}] 必须是对象`); exact(value, ['id', 'category', 'priority', 'text', 'sourceRefs'], `requirements[${index}]`);
  if (!Array.isArray(value.sourceRefs) || !value.sourceRefs.length) fail(`requirements[${index}].sourceRefs 必须是非空数组`);
  const sourceRefs = value.sourceRefs.map((source, sourceIndex) => {
    const path = `requirements[${index}].sourceRefs[${sourceIndex}]`;
    // 旧实现曾把来源包成对象；读取历史时只取其消息 id，不保留或解释额外包装字段。
    const legacyMessageId = allowLegacySourceRefObjects && record(source) ? source.messageId : source;
    const messageId = text(legacyMessageId, path);
    if (known && !known.has(messageId)) fail(`requirements[${index}].sourceRefs[${sourceIndex}] 引用了不存在的用户输入`);
    return messageId;
  });
  if (new Set(sourceRefs).size !== sourceRefs.length) fail(`requirements[${index}].sourceRefs 不允许重复`);
  const category = text(value.category, `requirements[${index}].category`); const priority = text(value.priority, `requirements[${index}].priority`);
  if (!(AGENT_REQUIREMENT_CATEGORIES_ACU as readonly string[]).includes(category) || !(AGENT_REQUIREMENT_PRIORITIES_ACU as readonly string[]).includes(priority)) fail(`requirements[${index}] 的分类或优先级非法`);
  return { id: text(value.id, `requirements[${index}].id`), category: category as AgentRequirementCategory_ACU, priority: priority as AgentRequirementPriority_ACU, text: text(value.text, `requirements[${index}].text`), sourceRefs };
}
export function parseAgentRequirementSnapshot_ACU(value: unknown): AgentRequirementSnapshot_ACU {
  if (!record(value)) fail('requirements snapshot 必须是对象'); exact(value, ['feature', 'revision', 'lastAppliedUserMessageId', 'requirements'], 'requirements snapshot');
  if (!Array.isArray(value.requirements)) fail('requirements snapshot.requirements 必须是数组');
  const requirements = value.requirements.map((item, index) => parseRequirement(item, index, undefined, true));
  if (new Set(requirements.map(item => item.id)).size !== requirements.length) fail('requirements snapshot 不允许重复 id');
  const lastAppliedUserMessageId = value.lastAppliedUserMessageId === null ? null : text(value.lastAppliedUserMessageId, 'lastAppliedUserMessageId');
  return { feature: parseAgentFeature_ACU(value.feature), revision: revision(value.revision, 'revision'), lastAppliedUserMessageId, requirements };
}
export function parseAgentRequirementsReplacement_ACU(value: unknown, knownUserMessageIds: readonly string[]): AgentRequirementsReplacement_ACU {
  if (!record(value)) fail('maintain_requirements 必须是对象'); exact(value, ['action', 'thought', 'expectedRevision', 'appliedUserMessageId', 'requirements', 'summary'], 'maintain_requirements');
  if (value.action !== 'maintain_requirements') fail('action 必须是 maintain_requirements'); text(value.thought, 'thought'); if (!Array.isArray(value.requirements)) fail('requirements 必须是数组');
  const known = new Set(knownUserMessageIds); const appliedUserMessageId = text(value.appliedUserMessageId, 'appliedUserMessageId');
  if (!known.has(appliedUserMessageId)) fail('appliedUserMessageId 引用了不存在的用户输入');
  const requirements = value.requirements.map((item, index) => parseRequirement(item, index, known));
  if (new Set(requirements.map(item => item.id)).size !== requirements.length) fail('requirements 不允许重复 id');
  return { expectedRevision: revision(value.expectedRevision, 'expectedRevision'), appliedUserMessageId, requirements, summary: text(value.summary, 'summary') };
}