import { parseAgentFeature_ACU, type AgentFeature_ACU } from './material-grants';

export const AGENT_STORY_ROLE_PROFILES_ACU = ['main', 'maintainer', 'planner', 'reviewer', 'world-director', 'world-specialist'] as const;
export type AgentStoryRoleProfile_ACU = typeof AGENT_STORY_ROLE_PROFILES_ACU[number];
export const AGENT_STORY_OVERVIEW_STATES_ACU = ['ready', 'empty', 'missing', 'failed', 'invalid'] as const;
export interface AgentStoryContextSegment_ACU { text: string; digest: string; }
export interface AgentStoryOverviewSegment_ACU extends AgentStoryContextSegment_ACU { state: typeof AGENT_STORY_OVERVIEW_STATES_ACU[number]; diagnostic: string; }
export interface AgentStoryContextSnapshot_ACU {
  feature: AgentFeature_ACU; runId: string; chatIdentity: string; branchIdentity: string; sourceRevision: string; sourceDigest: string; profile: AgentStoryRoleProfile_ACU;
  overview: AgentStoryOverviewSegment_ACU; pending: AgentStoryContextSegment_ACU; bridge: AgentStoryContextSegment_ACU; catalog: AgentStoryContextSegment_ACU;
}
export interface AgentStoryContextFloor_ACU { index: number; text: string; }
export interface AgentStoryContextBuildInput_ACU {
  feature: AgentFeature_ACU; runId: string; chatIdentity: string; branchIdentity: string; sourceRevision: string; profile: AgentStoryRoleProfile_ACU;
  overview: AgentStoryOverviewSegment_ACU; settledThroughIndex: number; bridgeFloorCount: number; floors: readonly AgentStoryContextFloor_ACU[];
}
function fingerprint_ACU(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
function renderFloors_ACU(floors: readonly AgentStoryContextFloor_ACU[]): string {
  return floors.map(floor => `【楼层 ${floor.index}】\n${floor.text}`).join('\n\n');
}
function renderCatalog_ACU(floors: readonly AgentStoryContextFloor_ACU[]): string {
  return floors.length ? floors.map(floor => `- 楼层 ${floor.index}｜约 ${floor.text.length} 字`).join('\n') : '当前 active branch 没有可用的 AI 正文楼层。';
}
/** Builds a host-agnostic, fully covered snapshot from validated active-branch AI floors. */
export function buildAgentStoryContextSnapshot_ACU(input: AgentStoryContextBuildInput_ACU): AgentStoryContextSnapshot_ACU {
  if (!Number.isInteger(input.settledThroughIndex) || input.settledThroughIndex < -1 || !Number.isInteger(input.bridgeFloorCount) || input.bridgeFloorCount < 0) fail('story context 的结算水位或 bridge 数量非法');
  const floors = input.floors.map(floor => ({ index: floor.index, text: floor.text.trim() }));
  let previous = -1;
  for (const floor of floors) {
    if (!Number.isInteger(floor.index) || floor.index < 0 || !floor.text || floor.index <= previous) fail('story context floors 必须按唯一递增 AI 楼层提供');
    previous = floor.index;
  }
  const pendingFloors = floors.filter(floor => floor.index > input.settledThroughIndex);
  const bridgeFloors = input.bridgeFloorCount === 0 ? [] : floors.filter(floor => floor.index <= input.settledThroughIndex).slice(-input.bridgeFloorCount);
  const sourceDigest = fingerprint_ACU(JSON.stringify({ sourceRevision: input.sourceRevision, branchIdentity: input.branchIdentity, overview: input.overview.digest, floors }));
  return {
    feature: input.feature, runId: input.runId, chatIdentity: input.chatIdentity, branchIdentity: input.branchIdentity, sourceRevision: input.sourceRevision, sourceDigest, profile: input.profile,
    overview: { ...input.overview },
    pending: { text: renderFloors_ACU(pendingFloors), digest: fingerprint_ACU(JSON.stringify(pendingFloors)) },
    bridge: { text: renderFloors_ACU(bridgeFloors), digest: fingerprint_ACU(JSON.stringify(bridgeFloors)) },
    catalog: { text: renderCatalog_ACU(floors), digest: fingerprint_ACU(JSON.stringify(floors.map(floor => [floor.index, floor.text.length]))) },
  };
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function fail(message: string): never { throw new Error(`AGENT_KERNEL_CONTRACT_INVALID: ${message}`); }
export function renderAgentStoryOverviewSegment_ACU(segment: AgentStoryOverviewSegment_ACU | null | undefined): string {
  if (!segment) return '事件概览尚未在本次运行起点装配，不能回退读取纪要表。';
  if (segment.state === 'ready') return segment.text;
  if (segment.state === 'empty') return '当前纪要索引为空：尚无可用的事件概要。';
  return `事件概览不可用（${segment.state}）：${segment.diagnostic}`;
}
function text(value: unknown, path: string, allowEmpty = false): string { if (typeof value !== 'string' || (!allowEmpty && !value.trim())) fail(`${path} 必须是${allowEmpty ? '' : '非空'}字符串`); return value.trim(); }
function exact(value: Record<string, unknown>, keys: readonly string[], path: string): void { if (Object.keys(value).length !== keys.length || !keys.every(key => Object.prototype.hasOwnProperty.call(value, key))) fail(`${path} 包含未知或缺失字段`); }
function segment(value: unknown, path: string): AgentStoryContextSegment_ACU { if (!record(value)) fail(`${path} 必须是对象`); exact(value, ['text', 'digest'], path); return { text: text(value.text, `${path}.text`, true), digest: text(value.digest, `${path}.digest`) }; }
export function parseAgentStoryContextSnapshot_ACU(value: unknown): AgentStoryContextSnapshot_ACU {
  if (!record(value)) fail('story context 必须是对象');
  exact(value, ['feature', 'runId', 'chatIdentity', 'branchIdentity', 'sourceRevision', 'sourceDigest', 'profile', 'overview', 'pending', 'bridge', 'catalog'], 'story context');
  if (typeof value.profile !== 'string' || !(AGENT_STORY_ROLE_PROFILES_ACU as readonly string[]).includes(value.profile)) fail('profile 非法');
  if (!record(value.overview)) fail('overview 必须是对象'); exact(value.overview, ['state', 'text', 'digest', 'diagnostic'], 'overview');
  if (typeof value.overview.state !== 'string' || !(AGENT_STORY_OVERVIEW_STATES_ACU as readonly string[]).includes(value.overview.state)) fail('overview.state 非法');
  return { feature: parseAgentFeature_ACU(value.feature), runId: text(value.runId, 'runId'), chatIdentity: text(value.chatIdentity, 'chatIdentity'), branchIdentity: text(value.branchIdentity, 'branchIdentity'), sourceRevision: text(value.sourceRevision, 'sourceRevision'), sourceDigest: text(value.sourceDigest, 'sourceDigest'), profile: value.profile as AgentStoryRoleProfile_ACU, overview: { text: text(value.overview.text, 'overview.text', true), digest: text(value.overview.digest, 'overview.digest'), state: value.overview.state as AgentStoryOverviewSegment_ACU['state'], diagnostic: text(value.overview.diagnostic, 'overview.diagnostic', true) }, pending: segment(value.pending, 'pending'), bridge: segment(value.bridge, 'bridge'), catalog: segment(value.catalog, 'catalog') };
}
function escapeUntrustedContext_ACU(value: string): string {
  return value.replace(/【UNTRUSTED_/g, '【\u200bUNTRUSTED_').replace(/\[\[\/UNTRUSTED_/g, '[[\u200b/UNTRUSTED_');
}
export function renderAgentStoryContextUntrustedBlocks_ACU(snapshot: AgentStoryContextSnapshot_ACU):Array<{ role: 'user'; content: string }> {
  return [{ role: 'user', content: `【UNTRUSTED_STORY_OVERVIEW】\n${escapeUntrustedContext_ACU(snapshot.overview.text)}\n\n【UNTRUSTED_STORY_PENDING】\n${escapeUntrustedContext_ACU(snapshot.pending.text)}\n\n【UNTRUSTED_STORY_BRIDGE】\n${escapeUntrustedContext_ACU(snapshot.bridge.text)}\n\n【UNTRUSTED_STORY_CATALOG】\n${escapeUntrustedContext_ACU(snapshot.catalog.text)}` }];
}