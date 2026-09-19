import type { WorldSimulationCandidate_ACU } from './agent/agent-model';
import { findWorldSimulationAgentDefinition_ACU } from './agent/agent-catalog';
import { WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU, WorldSimulationValidationError_ACU, createWorldSimulationError_ACU, type WorldSimulationLedger_ACU } from './model';
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

function applyUpserts_ACU<T extends { id: string; revision: number }>(
  current: readonly T[],
  raw: unknown,
  path: string,
  requiredFields: readonly string[],
  onViolation?: (message: string, details?: Record_ACU) => void,
): T[] {
  const reject = (message: string, details?: Record_ACU): boolean => {
    if (onViolation) {
      onViolation(message, details);
      return true;
    }
    fail_ACU(message, details);
  };
  const rejectRevision = (message: string, details?: Record_ACU): boolean => {
    if (onViolation) {
      onViolation(message, details);
      return true;
    }
    revisionFail_ACU(message, details);
  };
  if (!isRecord_ACU(raw)) {
    reject(`${path} 必须是对象`);
    return current.map(item => clone_ACU(item));
  }
  if (onViolation) {
    for (const key of Object.keys(raw)) if (key !== 'upsert') reject(`${path} 存在未知字段`, { path: `${path}.${key}` });
  } else {
    exactKeys_ACU(raw, ['upsert'], path);
  }
  if (!Array.isArray(raw.upsert) || raw.upsert.length === 0) {
    reject(`${path}.upsert 必须是非空数组`);
    return current.map(item => clone_ACU(item));
  }
  const result = current.map(item => clone_ACU(item));
  const seen = new Set<string>();
  for (const [index, item] of raw.upsert.entries()) {
    if (!isRecord_ACU(item) || typeof item.id !== 'string' || !item.id) {
      if (reject(`${path}.upsert[${index}].id 非法`)) continue;
    }
    if (seen.has(item.id)) {
      if (reject(`${path}.upsert 存在重复 ID`, { id: item.id })) continue;
    }
    seen.add(item.id);
    const missing = requiredFields.filter(key => key !== 'revision' && !Object.prototype.hasOwnProperty.call(item, key));
    if (missing.length) {
      if (reject(`${path}.upsert[${index}] 缺少必填字段：${missing.join(',')}`, { path: `${path}.upsert[${index}]`, missingFields: missing })) continue;
    }
    const expectedRevision = item.expectedRevision;
    if (!Number.isInteger(expectedRevision) || (expectedRevision as number) < 0) {
      if (reject(`${path}.upsert[${index}].expectedRevision 非法`)) continue;
    }
    const existingIndex = result.findIndex(entry => entry.id === item.id);
    const actual = existingIndex < 0 ? 0 : result[existingIndex].revision;
    if (actual !== expectedRevision) {
      if (rejectRevision(`${path} 条目 revision 冲突`, { id: item.id, expectedRevision, actualRevision: actual })) continue;
    }
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
        case 'dimensions': next.dimensions = applyUpserts_ACU(next.dimensions, patch, 'patch.dimensions', WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU.dimensions); break;
        case 'seeds': next.seeds = applyUpserts_ACU(next.seeds, patch, 'patch.seeds', WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU.seeds); break;
        case 'actors': next.actors = applyUpserts_ACU(next.actors, patch, 'patch.actors', WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU.actors); break;
        case 'chronicle': next.chronicle = applyChronicle_ACU(next.chronicle, patch); break;
        case 'guidance': next.guidance = applyGuidance_ACU(next.guidance, patch); break;
      }
    }
  }
  next.revision = validatedBase.revision + 1;
  return validateWorldSimulationLedger_ACU(next, 'agent_persist');
}

export interface WorldSimulationCandidateViolation_ACU {
  candidateId: string;
  agentName: string;
  module: string;
  path: string;
  message: string;
  details?: Record<string, unknown>;
}

export function preflightWorldSimulationCandidates_ACU(
  base: WorldSimulationLedger_ACU,
  candidates: readonly WorldSimulationCandidate_ACU[],
  authorizedEvidenceRefs: ReadonlySet<string>,
): WorldSimulationCandidateViolation_ACU[] {
  const violations: WorldSimulationCandidateViolation_ACU[] = [];
  let validatedBase: WorldSimulationLedger_ACU;
  try {
    validatedBase = validateWorldSimulationLedger_ACU(base, 'agent_persist');
  } catch (error) {
    violations.push({ candidateId: '', agentName: '', module: '', path: '$', message: error instanceof Error ? error.message : String(error) });
    return violations;
  }
  if (!candidates.length) {
    violations.push({ candidateId: '', agentName: '', module: '', path: '$', message: 'commit 必须包含至少一个候选' });
    return violations;
  }
  const next = clone_ACU(validatedBase);
  const candidateIds = new Set<string>();
  for (const candidate of candidates) {
    const push = (module: string, path: string, message: string, details?: Record_ACU): void => {
      violations.push({ candidateId: candidate.candidateId, agentName: candidate.agentName, module, path, message, details });
    };
    if (!candidate.candidateId || candidateIds.has(candidate.candidateId)) {
      push('', '$', 'commit candidateId 缺失或重复', { candidateId: candidate.candidateId });
      continue;
    }
    candidateIds.add(candidate.candidateId);
    if (!isRecord_ACU(candidate.patch) || !Object.keys(candidate.patch).length) {
      push('', '$.patch', 'candidate.patch 必须是非空对象');
      continue;
    }
    const declared = new Set(candidate.evidenceRefs);
    for (const ref of declared) if (!authorizedEvidenceRefs.has(ref)) push('', '$.evidenceRefs', `候选声明了未授权 evidenceRef: ${ref}`, { evidenceRef: ref });
    try {
      for (const ref of collectEvidenceRefs_ACU(candidate.patch)) {
        if (!declared.has(ref) || !authorizedEvidenceRefs.has(ref)) push('', '$.patch', `patch 使用了未声明或未授权的 evidenceRef: ${ref}`, { evidenceRef: ref });
      }
    } catch (error) {
      push('', '$.patch', error instanceof Error ? error.message : String(error));
    }
    const definition = findWorldSimulationAgentDefinition_ACU(candidate.agentName);
    if (!definition) {
      push('', '$.agentName', `候选 Agent 不在世界推演角色目录中: ${candidate.agentName}`);
      continue;
    }
    const writable = new Set<string>(definition.writableModules);
    const forgedPermissions = candidate.writableModules.filter(module => !writable.has(module));
    if (forgedPermissions.length) push('', '$.writableModules', `候选声明了角色目录未授权的写入模块: ${forgedPermissions.join(',')}`, { forgedPermissions });
    for (const [module, patch] of Object.entries(candidate.patch)) {
      if (!(MODULES_ACU as readonly string[]).includes(module) || !writable.has(module)) {
        push(module, `$.patch.${module}`, '候选越权写入 ledger 模块');
        continue;
      }
      const collectUpsert = (message: string, details?: Record_ACU): void => {
        push(module, typeof details?.path === 'string' ? details.path : `$.patch.${module}`, message, details);
      };
      try {
        switch (module as Module_ACU) {
          case 'clock': next.clock = applyClock_ACU(next.clock, patch); break;
          case 'dimensions': next.dimensions = applyUpserts_ACU(next.dimensions, patch, 'patch.dimensions', WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU.dimensions, collectUpsert); break;
          case 'seeds': next.seeds = applyUpserts_ACU(next.seeds, patch, 'patch.seeds', WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU.seeds, collectUpsert); break;
          case 'actors': next.actors = applyUpserts_ACU(next.actors, patch, 'patch.actors', WORLD_SIMULATION_LEDGER_REQUIRED_FIELDS_ACU.actors, collectUpsert); break;
          case 'chronicle': next.chronicle = applyChronicle_ACU(next.chronicle, patch); break;
          case 'guidance': next.guidance = applyGuidance_ACU(next.guidance, patch); break;
        }
      } catch (error) {
        push(module, `$.patch.${module}`, error instanceof Error ? error.message : String(error));
      }
    }
  }
  if (!violations.length) {
    try {
      next.revision = validatedBase.revision + 1;
      validateWorldSimulationLedger_ACU(next, 'agent_persist');
    } catch (error) {
      violations.push({ candidateId: '', agentName: '', module: '', path: '$', message: error instanceof Error ? error.message : String(error) });
    }
  }
  return violations;
}
