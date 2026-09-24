import type {
  WorldSimulationAnchorIdentity_ACU,
  WorldSimulationCandidate_ACU,
  WorldSimulationRunResumeState_ACU,
  WorldSimulationRunStateRecord_ACU,
  WorldSimulationSubagentOutcome_ACU,
} from './agent-model';
import type { WorldSimulationEvidenceRegistrySnapshot_ACU } from '../world-simulation-evidence-registry';
import { WORLD_SIMULATION_RUN_STATE_FIELD_ACU, WORLD_SIMULATION_RUN_STATE_SCHEMA_VERSION_ACU } from './agent-model';
import {
  WorldSimulationValidationError_ACU,
  createWorldSimulationError_ACU,
} from '../model';
import {
  readWorldSimulationBucketEntry_ACU,
  resolveWorldSimulationAnchor_ACU,
  writeWorldSimulationBucketEntry_ACU,
} from '../simulation-store';

const RUN_STATE_FIELD_ACU = WORLD_SIMULATION_RUN_STATE_FIELD_ACU;

interface RuntimeStateMeta_ACU {
  taskId: string;
  cursorKey: string;
  updatedAt: number;
}

const meta_ACU = new Map<string, RuntimeStateMeta_ACU>();

function record_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function reject_ACU(message: string, details?: Record<string, unknown>): never {
  throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
    'WORLD_SIMULATION_SNAPSHOT_INVALID', 'agent_persist', message, false, details,
  ));
}

function nonNegativeInteger_ACU(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) reject_ACU(`${path} 必须是非负整数`, { path, actual: value });
  return value;
}

function text_ACU(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) reject_ACU(`${path} 必须是非空字符串`, { path });
  return value;
}

function textOrEmpty_ACU(value: unknown, path: string): string {
  if (typeof value !== 'string') reject_ACU(`${path} 必须是字符串`, { path });
  return value;
}

function numberRecord_ACU(value:unknown, path: string): Record<string, number> {
  if (!record_ACU(value)) reject_ACU(`${path} 必须是对象`, { path });
  for (const [key, item] of Object.entries(value)) {
    nonNegativeInteger_ACU(item, `${path}.${key}`);
  }
  return value as Record<string, number>;
}

function outcomes_ACU(value: unknown, path: string): WorldSimulationRunResumeState_ACU['outcomes'] {
  if (!Array.isArray(value)) reject_ACU(`${path} 必须是数组`, { path });
  return value.map((item, index): WorldSimulationRunResumeState_ACU['outcomes'][number] => {
    if (!record_ACU(item)) reject_ACU(`${path}[${index}] 必须是对象`, { path: `${path}[${index}]` });
    const allowed = new Set(['agentName', 'status', 'summary', 'fingerprint']);
    for (const key of ['agentName', 'status', 'summary', 'fingerprint']) {
      if (!Object.prototype.hasOwnProperty.call(item, key)) reject_ACU(`${path}[${index}].${key} 缺失`, { path: `${path}[${index}].${key}` });
    }
    for (const key of Object.keys(item)) {
      if (!allowed.has(key)) reject_ACU(`${path}[${index}].${key} 是未知字段`, { path: `${path}[${index}].${key}` });
    }
    return {
      agentName: text_ACU(item.agentName, `${path}[${index}].agentName`),
      status: enum_ACU(item.status, ['candidate', 'no_change', 'failed', 'blocked'], `${path}[${index}].status`),
      summary: text_ACU(item.summary, `${path}[${index}].summary`),
      fingerprint: text_ACU(item.fingerprint, `${path}[${index}].fingerprint`),
    };
  });
}

function enum_ACU<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) reject_ACU(`${path} 枚举非法`, { path, actual: value });
  return value as T;
}

function candidates_ACU(value: unknown, path: string): WorldSimulationCandidate_ACU[] {
  if (!Array.isArray(value)) reject_ACU(`${path} 必须是数组`, { path });
  return value.map((item, index): WorldSimulationCandidate_ACU => {
    if (!record_ACU(item)) reject_ACU(`${path}[${index}] 必须是对象`, { path: `${path}[${index}]` });
    const allowed = new Set(['candidateId', 'agentName', 'patch', 'summary', 'evidenceRefs', 'uncertainties', 'writableModules']);
    for (const key of ['candidateId', 'agentName', 'patch', 'summary', 'evidenceRefs', 'uncertainties', 'writableModules']) {
      if (!Object.prototype.hasOwnProperty.call(item, key)) reject_ACU(`${path}[${index}].${key} 缺失`, { path: `${path}[${index}].${key}` });
    }
    for (const key of Object.keys(item)) {
      if (!allowed.has(key)) reject_ACU(`${path}[${index}].${key} 是未知字段`, { path: `${path}[${index}].${key}` });
    }
    if (!record_ACU(item.patch)) {
      reject_ACU(`${path}[${index}].patch 必须是对象`, { path: `${path}[${index}].patch` });
    }
    return {
      candidateId: text_ACU(item.candidateId, `${path}[${index}].candidateId`),
      agentName: text_ACU(item.agentName, `${path}[${index}].agentName`),
      patch: item.patch,
      summary: text_ACU(item.summary, `${path}[${index}].summary`),
      evidenceRefs: textArray_ACU(item.evidenceRefs, `${path}[${index}].evidenceRefs`),
      uncertainties: textArray_ACU(item.uncertainties, `${path}[${index}].uncertainties`),
      writableModules: textArray_ACU(item.writableModules, `${path}[${index}].writableModules`),
    };
  });
}

function subagentOutcomes_ACU(value: unknown, path: string): WorldSimulationSubagentOutcome_ACU[] {
  if (!Array.isArray(value)) reject_ACU(`${path} 必须是数组`, { path });
  return value.map((item, index): WorldSimulationSubagentOutcome_ACU => {
    if (!record_ACU(item)) reject_ACU(`${path}[${index}] 必须是对象`, { path: `${path}[${index}]` });
    const allowed = new Set(['agentName', 'status', 'summary', 'candidate', 'evidenceRefs', 'uncertainties', 'reasonCode', 'unresolved']);
    for (const key of ['agentName', 'status', 'summary', 'evidenceRefs', 'uncertainties']) {
      if (!Object.prototype.hasOwnProperty.call(item, key)) reject_ACU(`${path}[${index}].${key} 缺失`, { path: `${path}[${index}].${key}` });
    }
    for(const key of Object.keys(item)) {
      if (!allowed.has(key)) reject_ACU(`${path}[${index}].${key} 是未知字段`, { path: `${path}[${index}].${key}` });
    }
    return {
      agentName: text_ACU(item.agentName, `${path}[${index}].agentName`),
      status: enum_ACU(item.status, ['candidate', 'no_change', 'failed', 'blocked'], `${path}[${index}].status`),
      summary: text_ACU(item.summary, `${path}[${index}].summary`),
      ...(item.candidate === undefined ? {} : { candidate: candidates_ACU([item.candidate], `${path}[${index}].candidate`)[0] }),
      evidenceRefs: textArray_ACU(item.evidenceRefs, `${path}[${index}].evidenceRefs`),
      uncertainties: textArray_ACU(item.uncertainties, `${path}[${index}].uncertainties`),
      ...(item.reasonCode === undefined ? {} : { reasonCode: text_ACU(item.reasonCode, `${path}[${index}].reasonCode`) }),
      ...(item.unresolved === undefined ? {} : { unresolved: textArray_ACU(item.unresolved, `${path}[${index}].unresolved`) }),
    };
  });
}

function textArray_ACU(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) reject_ACU(`${path} 必须是非空字符串数组`, { path });
  return [...value] as string[];
}

function evidenceSnapshot_ACU(value: unknown, path: string): WorldSimulationEvidenceRegistrySnapshot_ACU {
  if (!record_ACU(value)) reject_ACU(`${path} 必须是对象`, { path });
  const allowed = new Set(['runId', 'entries']);
  for (const key of ['runId', 'entries']) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) reject_ACU(`${path}.${key} 缺失`, { path: `${path}.${key}` });
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) reject_ACU(`${path}.${key} 是未知字段`, { path: `${path}.${key}` });
  }
  if (!Array.isArray(value.entries)) reject_ACU(`${path}.entries 必须是数组`, { path: `${path}.entries` });
  const operations = ['initial', 'read', 'search', 'directory'] as const;
  const statuses = ['ok', 'empty', 'failed', 'truncated', 'dependency_unavailable'] as const;
  return {
    runId: text_ACU(value.runId, `${path}.runId`),
    entries: value.entries.map((entry, index) => {
      if (!record_ACU(entry)) reject_ACU(`${path}.entries[${index}] 必须是对象`, { path: `${path}.entries[${index}]` });
      const entryAllowed = new Set(['evidenceRef', 'operation', 'address', 'status', 'summary', 'exact']);
      for (const key of ['operation', 'address', 'status', 'summary', 'exact']) {
        if (!Object.prototype.hasOwnProperty.call(entry, key)) reject_ACU(`${path}.entries[${index}].${key} 缺失`, { path: `${path}.entries[${index}].${key}` });
      }
      for (const key of Object.keys(entry)) {
        if (!entryAllowed.has(key)) reject_ACU(`${path}.entries[${index}].${key} 是未知字段`, { path: `${path}.entries[${index}].${key}` });
      }
      const evidenceRef = entry.evidenceRef === undefined || entry.evidenceRef === null ? undefined : text_ACU(entry.evidenceRef, `${path}.entries[${index}].evidenceRef`);
      if (typeof entry.exact !== 'boolean') reject_ACU(`${path}.entries[${index}].exact 必须是布尔值`, { path: `${path}.entries[${index}].exact` });
      return {
        ...(evidenceRef === undefined ? {} : { evidenceRef }),
        operation: enum_ACU(entry.operation, operations, `${path}.entries[${index}].operation`),
        address: text_ACU(entry.address, `${path}.entries[${index}].address`),
        status: enum_ACU(entry.status, statuses, `${path}.entries[${index}].status`),
        summary: text_ACU(entry.summary, `${path}.entries[${index}].summary`),
        exact: entry.exact,
      };
    }),
  };
}

function state_ACU(raw: unknown, path: string): WorldSimulationRunResumeState_ACU {
  if (!record_ACU(raw)) reject_ACU(`${path} 必须是对象`, { path });
  const allowed = new Set(['taskId', 'cursorKey', 'nextIteration', 'delegationsUsed', 'perAgent', 'outcomes', 'candidateFingerprint', 'candidateSummary', 'reviewerFeedback', 'candidates', 'subagentOutcomes', 'evidenceSnapshot', 'transcript', 'budgetExhausted', 'handoffSummary']);
  // transcript 为新增可选字段：旧楼层记录没有它，属合法存量；新记录带它时须逐条校验。
  if (raw.transcript !== undefined) {
    if (!Array.isArray(raw.transcript)) reject_ACU(`${path}.transcript 必须是数组`, { path: `${path}.transcript` });
    raw.transcript.forEach((item, index) => {
      if (!record_ACU(item) || (item.role !== 'assistant' && item.role !== 'user' && item.role !== 'tool') || typeof item.content !== 'string') {
        reject_ACU(`${path}.transcript[${index}] 必须是 { role: 'assistant'|'user'|'tool', content: string }`, { path: `${path}.transcript[${index}]` });
      }
    });
  }
  for (const key of ['taskId', 'cursorKey', 'nextIteration', 'delegationsUsed', 'perAgent', 'outcomes', 'candidateFingerprint', 'candidateSummary', 'reviewerFeedback']) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) reject_ACU(`${path}.${key} 缺失`, { path: `${path}.${key}` });
  }
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) reject_ACU(`${path}.${key} 是未知字段`, { path: `${path}.${key}` });
  }
  return {
    taskId: text_ACU(raw.taskId, `${path}.taskId`),
    cursorKey: text_ACU(raw.cursorKey, `${path}.cursorKey`),
    nextIteration: nonNegativeInteger_ACU(raw.nextIteration, `${path}.nextIteration`),
    delegationsUsed: nonNegativeInteger_ACU(raw.delegationsUsed, `${path}.delegationsUsed`),
    perAgent: numberRecord_ACU(raw.perAgent, `${path}.perAgent`),
    outcomes: outcomes_ACU(raw.outcomes, `${path}.outcomes`),
    candidateFingerprint: text_ACU(raw.candidateFingerprint, `${path}.candidateFingerprint`),
    candidateSummary: textOrEmpty_ACU(raw.candidateSummary, `${path}.candidateSummary`),
    reviewerFeedback: textOrEmpty_ACU(raw.reviewerFeedback, `${path}.reviewerFeedback`),
    ...(raw.candidates === undefined ? {} : { candidates: candidates_ACU(raw.candidates, `${path}.candidates`) }),
    ...(raw.subagentOutcomes === undefined ? {} : { subagentOutcomes: subagentOutcomes_ACU(raw.subagentOutcomes, `${path}.subagentOutcomes`) }),
    ...(raw.evidenceSnapshot === undefined ? {} : { evidenceSnapshot: evidenceSnapshot_ACU(raw.evidenceSnapshot, `${path}.evidenceSnapshot`) }),
    ...(raw.transcript === undefined ? {} : { transcript: (raw.transcript as Array<{ role: string; content: string }>).map(item => ({ role: item.role, content: item.content })) }),
    ...(raw.budgetExhausted === undefined ? {} : { budgetExhausted: raw.budgetExhausted === true ? true : (typeof raw.budgetExhausted === 'boolean' ? false : reject_ACU(`${path}.budgetExhausted 必须是布尔值`, { path: `${path}.budgetExhausted`, actual: raw.budgetExhausted })) }),
    ...(raw.handoffSummary === undefined ? {} : { handoffSummary: typeof raw.handoffSummary === 'string' ? raw.handoffSummary : reject_ACU(`${path}.handoffSummary 必须是字符串`, { path: `${path}.handoffSummary` }) }),
  };
}

export function validateWorldSimulationRunStateRecord_ACU(raw: unknown): WorldSimulationRunStateRecord_ACU {
  if (!record_ACU(raw)) reject_ACU('世界推演 run 恢复状态必须是对象');
  const allowed = new Set(['schemaVersion', 'taskId', 'cursorKey', 'updatedAt', 'state']);
  for (const key of ['schemaVersion', 'taskId', 'cursorKey', 'updatedAt', 'state']) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) reject_ACU(`run 恢复状态缺少字段：${key}`, { path: key });
  }
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) reject_ACU(`run 恢复状态存在未知字段：${key}`, { path: key });
  }
  if (raw.schemaVersion !== WORLD_SIMULATION_RUN_STATE_SCHEMA_VERSION_ACU) reject_ACU('run 恢复状态 schemaVersion 非法');
  const taskId = text_ACU(raw.taskId, 'taskId');
  const cursorKey = text_ACU(raw.cursorKey, 'cursorKey');
  const updatedAt = nonNegativeInteger_ACU(raw.updatedAt, 'updatedAt');
  const state = state_ACU(raw.state, 'state');
  if (state.taskId !== taskId || state.cursorKey !== cursorKey) reject_ACU('run 恢复状态身份与外层不一致', { taskId, cursorKey });
  return { schemaVersion: WORLD_SIMULATION_RUN_STATE_SCHEMA_VERSION_ACU, taskId, cursorKey, updatedAt, state };
}

export async function persistWorldSimulationRunState_ACU(
  anchor: WorldSimulationAnchorIdentity_ACU,
  state: WorldSimulationRunResumeState_ACU,
  chat?: any[],
): Promise<void> {
  const record: WorldSimulationRunStateRecord_ACU = {
    schemaVersion: WORLD_SIMULATION_RUN_STATE_SCHEMA_VERSION_ACU,
    taskId: state.taskId,
    cursorKey: state.cursorKey,
    updatedAt: Date.now(),
    state,
  };
  await writeWorldSimulationBucketEntry_ACU(RUN_STATE_FIELD_ACU, anchor, record, chat);
  meta_ACU.set(anchor.chatIdentity, { taskId: state.taskId, cursorKey: state.cursorKey, updatedAt: record.updatedAt });
}

export async function restoreWorldSimulationRunState_ACU(
  anchor: WorldSimulationAnchorIdentity_ACU,
  taskId: string,
  cursorKey: string,
  chat?: any[],
): Promise<WorldSimulationRunResumeState_ACU | null> {
  // 信任 persist 时校验过的锚点身份；恢复时不重复解析宿主楼层，避免宿主消息对象
  // 差异导致合法楼层记录被静默丢弃（fail-closed 语义由外层 cursorKey/taskId 校验兜底）。
  const record = readWorldSimulationBucketEntry_ACU(RUN_STATE_FIELD_ACU, anchor, validateWorldSimulationRunStateRecord_ACU, chat);
  if (!record) return null;
  if (record.taskId !== taskId || record.cursorKey !== cursorKey) return null;
  return record.state;
}

export async function clearWorldSimulationRunStateAtAnchor_ACU(
  anchor: WorldSimulationAnchorIdentity_ACU | undefined,
  chat?: any[],
): Promise<void> {
  if (!anchor) return;
  meta_ACU.delete(anchor.chatIdentity);
}
