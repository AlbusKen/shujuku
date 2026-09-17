import type { WorldSimulationCandidate_ACU } from './agent/agent-model';
import { findWorldSimulationAgentDefinition_ACU } from './agent/agent-catalog';
import type { WorldSimulationLedger_ACU } from './model';
import { WorldSimulationValidationError_ACU, createWorldSimulationError_ACU } from './model';
import { validateWorldSimulationLedger_ACU } from './simulation-store';

const MODULES_ACU = ['clock', 'dimensions', 'seeds', 'actors', 'chronicle', 'guidance'] as const;
type Module_ACU = typeof MODULES_ACU[number];
type Record_ACU = Record<string, unknown>;

function isRecord_ACU(value: unknown): value is Record_ACU { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function fail_ACU(message: string, details?: Record_ACU): never {
  throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU('WORLD_SIMULATION_AGENT_PROTOCOL_INVALID', 'agent_persist', message, false, details));
}
function revisionFail_ACU(message: string, details?: Record_ACU): never {
  throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU('WORLD_SIMULATION_REVISION_CONFLICT', 'agent_persist', message, false, details));
}
function exactKeys_ACU(raw: Record_ACU, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(raw)) if (!allowed.includes(key)) fail_ACU(`${path} 存在未知字段`, { path: `${path}.${key}` });
}
function clone_ACU<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function refs_ACU(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) fail_ACU(`${path} 必须是字符串数组且元素不能为空`);
  return [...value] as string[];
}

function applyUpserts_ACU<T extends { id: string; revision: number }>(current: readonly T[], raw: unknown, path: string): T[] {
  if (!isRecord_ACU(raw)) fail_ACU(`${path} 必须是对象`);
  exactKeys_ACU(raw, ['upsert'], path);
  if (!Array.isArray(raw.upsert) || raw.upsert.length === 0) fail_ACU(`${path}.upsert 必须是非空数组`);
  const result = current.map(item => clone_ACU(item));
  const seen = new Set<string>();
  for (const [index, item] of raw.upsert.entries()) {
    if (!isRecord_ACU(item) || typeof item.id !== 'string' || !item.id) fail_ACU(`${path}.upsert[${index}].id 非法`);
    if (seen.has(item.id)) fail_ACU(`${path}.upsert 存在重复 ID`, { id: item.id });
    seen.add(item.id);
    const expectedRevision = item.expectedRevision;
    if (!Number.isInteger(expectedRevision) || (expectedRevision as number) < 0) fail_ACU(`${path}.upsert[${index}].expectedRevision 非法`);
    const existingIndex = result.findIndex(entry => entry.id === item.id);
    const actual = existingIndex < 0 ? 0 : result[existingIndex].revision;
    if (actual !== expectedRevision) revisionFail_ACU(`${path} 条目 revision 冲突`, { id: item.id, expectedRevision, actualRevision: actual });
    const next = { ...item, revision: actual + 1 } as Record_ACU;
    delete next.expectedRevision;
    if (existingIndex < 0) result.push(next as T); else result[existingIndex] = next as T;
  }
  return result;
}

function collectEvidenceRefs_ACU(value: unknown, output: string[] = []): string[] {
  if (Array.isArray(value)) { for (const item of value) collectEvidenceRefs_ACU(item, output); return output; }
  if (!isRecord_ACU(value)) return output;
  for (const [key, item] of Object.entries(value)) {
    if (key === 'evidenceRefs') output.push(...refs_ACU(item, 'patch.evidenceRefs'));
    else collectEvidenceRefs_ACU(item, output);
  }
  return output;
}

function applyClock_ACU(current: WorldSimulationLedger_ACU['clock'], raw: unknown): WorldSimulationLedger_ACU['clock'] {
  if (!isRecord_ACU(raw)) fail_ACU('patch.clock 必须是对象');
  exactKeys_ACU(raw, ['storyTime', 'elapsed', 'precision', 'evidenceRefs'], 'patch.clock');
  if (!Object.keys(raw).length) fail_ACU('patch.clock 不能为空');
  return {
    storyTime: raw.storyTime === undefined ? current.storyTime
      : typeof raw.storyTime === 'string' ? raw.storyTime : fail_ACU('patch.clock.storyTime 必须是字符串'),
    elapsed: raw.elapsed === undefined ? current.elapsed
      : typeof raw.elapsed === 'string' ? raw.elapsed : fail_ACU('patch.clock.elapsed 必须是字符串'),
    precision: raw.precision === undefined ? current.precision
      : ['exact', 'approximate', 'unknown'].includes(String(raw.precision)) ? raw.precision as WorldSimulationLedger_ACU['clock']['precision'] : fail_ACU('patch.clock.precision 非法'),
    evidenceRefs: raw.evidenceRefs === undefined ? [...current.evidenceRefs] : refs_ACU(raw.evidenceRefs, 'patch.clock.evidenceRefs'),
  };
}

function applyGuidance_ACU(current: WorldSimulationLedger_ACU['guidance'], raw: unknown): WorldSimulationLedger_ACU['guidance'] {
  if (!isRecord_ACU(raw)) fail_ACU('patch.guidance 必须是对象');
  exactKeys_ACU(raw, ['signals', 'excludedFacts', 'evidenceRefs'], 'patch.guidance');
  if (!Object.keys(raw).length) fail_ACU('patch.guidance 不能为空');
  return {
    signals: raw.signals === undefined ? [...current.signals] : refs_ACU(raw.signals, 'patch.guidance.signals'),
    excludedFacts: raw.excludedFacts === undefined ? [...current.excludedFacts] : refs_ACU(raw.excludedFacts, 'patch.guidance.excludedFacts'),
    evidenceRefs: raw.evidenceRefs === undefined ? [...current.evidenceRefs] : refs_ACU(raw.evidenceRefs, 'patch.guidance.evidenceRefs'),
  };
}

function applyChronicle_ACU(current: WorldSimulationLedger_ACU['chronicle'], raw: unknown): WorldSimulationLedger_ACU['chronicle'] {
  if (!isRecord_ACU(raw)) fail_ACU('patch.chronicle 必须是对象');
  exactKeys_ACU(raw, ['append'], 'patch.chronicle');
  if (!Array.isArray(raw.append) || raw.append.length === 0) fail_ACU('patch.chronicle.append 必须是非空数组');
  return [...clone_ACU(current), ...clone_ACU(raw.append as WorldSimulationLedger_ACU['chronicle'])];
}

export function applyWorldSimulationCandidates_ACU(
  base: WorldSimulationLedger_ACU,
  candidates: readonly WorldSimulationCandidate_ACU[],
  authorizedEvidenceRefs: ReadonlySet<string>,
): WorldSimulationLedger_ACU {
  const validatedBase = validateWorldSimulationLedger_ACU(base, 'agent_persist');
  if (!candidates.length) fail_ACU('commit 必须包含至少一个候选');
  const candidateIds = new Set<string>();
  let next = clone_ACU(validatedBase);
  for (const candidate of candidates) {
    if (!candidate.candidateId || candidateIds.has(candidate.candidateId)) fail_ACU('commit candidateId 缺失或重复', { candidateId: candidate.candidateId });
    candidateIds.add(candidate.candidateId);
    if (!isRecord_ACU(candidate.patch) || !Object.keys(candidate.patch).length) fail_ACU('candidate.patch 必须是非空对象', { candidateId: candidate.candidateId });
    const declared = new Set(candidate.evidenceRefs);
    for (const ref of declared) if (!authorizedEvidenceRefs.has(ref)) fail_ACU('候选声明了未授权 evidenceRef', { candidateId: candidate.candidateId, evidenceRef: ref });
    for (const ref of collectEvidenceRefs_ACU(candidate.patch)) {
      if (!declared.has(ref) || !authorizedEvidenceRefs.has(ref)) fail_ACU('patch 使用了未由候选声明并授权的 evidenceRef', { candidateId: candidate.candidateId, evidenceRef: ref });
    }
    const definition = findWorldSimulationAgentDefinition_ACU(candidate.agentName);
    if (!definition) fail_ACU('候选 Agent 不在世界推演角色目录中', { candidateId: candidate.candidateId, agentName: candidate.agentName });
    const writable = new Set<string>(definition.writableModules);
    const forgedPermissions = candidate.writableModules.filter(module => !writable.has(module));
    if (forgedPermissions.length) fail_ACU('候选声明了角色目录未授权的写入模块', { candidateId: candidate.candidateId, forgedPermissions });
    for (const [module, patch] of Object.entries(candidate.patch)) {
      if (!(MODULES_ACU as readonly string[]).includes(module) || !writable.has(module)) fail_ACU('候选越权写入 ledger 模块', { candidateId: candidate.candidateId, module });
      switch (module as Module_ACU) {
        case 'clock': next.clock = applyClock_ACU(next.clock, patch); break;
        case 'dimensions': next.dimensions = applyUpserts_ACU(next.dimensions, patch, 'patch.dimensions'); break;
        case 'seeds': next.seeds = applyUpserts_ACU(next.seeds, patch, 'patch.seeds'); break;
        case 'actors': next.actors = applyUpserts_ACU(next.actors, patch, 'patch.actors'); break;
        case 'chronicle': next.chronicle = applyChronicle_ACU(next.chronicle, patch); break;
        case 'guidance': next.guidance = applyGuidance_ACU(next.guidance, patch); break;
      }
    }
  }
  next.revision = validatedBase.revision + 1;
  return validateWorldSimulationLedger_ACU(next, 'agent_persist');
}
