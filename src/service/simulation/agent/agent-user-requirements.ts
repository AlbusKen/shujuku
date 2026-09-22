/**
 * service/simulation/agent/agent-user-requirements.ts — 世界推演用户要求资料区
 *
 * 独立持久化字段 `_qrf_world_user_requirements`，与材料快照 / 账本分桶隔离。
 * AI 维护子代理已退役：清单由用户在资料面板手动维护；本文件负责空快照回退、
 * 楼层锚定读写与用户编辑的 fail-closed 校验。
 */

import { getChatArray_ACU } from '../../../data/gateways/chat-gateway';
import { WorldSimulationValidationError_ACU, createWorldSimulationError_ACU } from '../model';
import {
  readWorldSimulationBucketEntry_ACU,
  resolveCurrentWorldSimulationAnchor_ACU,
  resolveWorldSimulationAnchor_ACU,
  writeWorldSimulationBucketEntry_ACU,
} from '../simulation-store';
import {
  WORLD_SIMULATION_USER_REQUIREMENTS_FIELD_ACU,
  WORLD_SIMULATION_USER_REQUIREMENTS_SCHEMA_VERSION_ACU,
  type WorldSimulationAnchorIdentity_ACU,
  type WorldSimulationConversationMessage_ACU,
  type WorldSimulationUserRequirementsReadResult_ACU,
  type WorldSimulationUserRequirementsSnapshot_ACU,
} from './agent-model';

/** 与续写 `AGENT_RESUME_KEYWORD_ACU` 对齐，并包含验收要求的「开始」。 */
export const WORLD_SIMULATION_RESUME_KEYWORD_ACU = /^(继续|开始|恢复(?:任务)?|resume|continue)$/i;
const LINE_CHAR_LIMIT_ACU = 8000;

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function reject_ACU(message: string, details?: Record<string, unknown>, phase: 'load' | 'persist' | 'agent_persist' = 'load'): never {
  throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
    'WORLD_SIMULATION_SNAPSHOT_INVALID', phase, message, false, details,
  ));
}

export function isMechanicalWorldSimulationResumeText_ACU(text: string): boolean {
  const trimmed = text.trim();
  return !trimmed || WORLD_SIMULATION_RESUME_KEYWORD_ACU.test(trimmed);
}

export function normalizeWorldSimulationUserRequirementLines_ACU(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') return null;
    const text = item.trim();
    if (!text || text.length > LINE_CHAR_LIMIT_ACU) return null;
    if (seen.has(text)) continue;
    seen.add(text);
    lines.push(text);
  }
  return lines;
}

export function emptyWorldSimulationUserRequirementsSnapshot_ACU(): WorldSimulationUserRequirementsSnapshot_ACU {
  return {
    schemaVersion: WORLD_SIMULATION_USER_REQUIREMENTS_SCHEMA_VERSION_ACU,
    requirements: [],
    updatedAt: 0,
  };
}

export function validateWorldSimulationUserRequirementsSnapshot_ACU(raw: unknown): WorldSimulationUserRequirementsSnapshot_ACU {
  if (!isRecord_ACU(raw)) reject_ACU('用户要求快照必须是对象');
  const allowed = new Set(['schemaVersion', 'requirements', 'updatedAt']);
  for (const key of allowed) if (!Object.prototype.hasOwnProperty.call(raw, key)) reject_ACU(`用户要求快照缺少字段：${key}`);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) reject_ACU(`用户要求快照存在未知字段：${key}`);
  if (raw.schemaVersion !== WORLD_SIMULATION_USER_REQUIREMENTS_SCHEMA_VERSION_ACU) reject_ACU('用户要求快照 schemaVersion 非法');
  if (typeof raw.updatedAt !== 'number' || !Number.isInteger(raw.updatedAt) || raw.updatedAt < 0) reject_ACU('用户要求快照 updatedAt 非法');
  const requirements = normalizeWorldSimulationUserRequirementLines_ACU(raw.requirements);
  if (requirements === null) reject_ACU('用户要求必须是字符串数组，且每条 trim 后非空、不超过字数上限');
  return {
    schemaVersion: WORLD_SIMULATION_USER_REQUIREMENTS_SCHEMA_VERSION_ACU,
    requirements,
    updatedAt: raw.updatedAt,
  };
}

export function renderWorldSimulationUserRequirements_ACU(
  snapshot: WorldSimulationUserRequirementsSnapshot_ACU | null,
  originInstruction: string,
): string {
  const fallback = originInstruction.trim();
  const lines = snapshot?.requirements.length
    ? snapshot.requirements
    : (fallback && !isMechanicalWorldSimulationResumeText_ACU(fallback) ? [fallback] : []);
  if (!lines.length) return '（用户尚未提出任务要求）';
  return lines.map(line => `- ${line}`).join('\n');
}

export function readLatestWorldSimulationUserRequirements_ACU(chat?: any[]): WorldSimulationUserRequirementsReadResult_ACU {
  const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
  const diagnostics: string[] = [];
  let sawBrokenSnapshot = false;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isRecord_ACU(message) || message.is_user === true || message.is_system === true) continue;
    let anchor: WorldSimulationAnchorIdentity_ACU;
    try {
      anchor = resolveWorldSimulationAnchor_ACU(index, messages);
    } catch (error) {
      diagnostics.push(`楼层 ${index}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    try {
      const snapshot = readWorldSimulationBucketEntry_ACU(
        WORLD_SIMULATION_USER_REQUIREMENTS_FIELD_ACU,
        anchor,
        validateWorldSimulationUserRequirementsSnapshot_ACU,
        messages,
      );
      if (snapshot) return { snapshot, diagnostics, adoptedIndex: index };
    } catch (error) {
      sawBrokenSnapshot = true;
      diagnostics.push(`楼层 ${index}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (sawBrokenSnapshot) {
    diagnostics.push('当前有效分支存在用户要求字段，但没有任何候选通过严格校验。');
  }
  return { snapshot: null, diagnostics, adoptedIndex: null };
}

export async function writeWorldSimulationUserRequirementsSnapshot_ACU(
  anchor: WorldSimulationAnchorIdentity_ACU,
  requirements: readonly string[],
  chat?: any[],
): Promise<WorldSimulationUserRequirementsSnapshot_ACU> {
  const normalized = normalizeWorldSimulationUserRequirementLines_ACU([...requirements]);
  if (normalized === null) reject_ACU('用户要求必须是字符串数组，且每条 trim 后非空、不超过字数上限', undefined, 'persist');
  const snapshot: WorldSimulationUserRequirementsSnapshot_ACU = {
    schemaVersion: WORLD_SIMULATION_USER_REQUIREMENTS_SCHEMA_VERSION_ACU,
    requirements: normalized,
    updatedAt: Date.now(),
  };
  await writeWorldSimulationBucketEntry_ACU(
    WORLD_SIMULATION_USER_REQUIREMENTS_FIELD_ACU,
    anchor,
    validateWorldSimulationUserRequirementsSnapshot_ACU(snapshot),
    chat,
  );
  return snapshot;
}

export async function seedWorldSimulationUserRequirementsIfEmpty_ACU(
  originInstruction: string,
  anchor: WorldSimulationAnchorIdentity_ACU,
  chat?: any[],
): Promise<void> {
  const text = originInstruction.trim();
  if (!text || isMechanicalWorldSimulationResumeText_ACU(text)) return;
  const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
  const latest = readLatestWorldSimulationUserRequirements_ACU(messages);
  if (latest.snapshot?.requirements.length) return;
  try {
    resolveCurrentWorldSimulationAnchor_ACU(anchor, messages);
  } catch {
    return;
  }
  await writeWorldSimulationUserRequirementsSnapshot_ACU(anchor, [text], messages);
}

export async function replaceWorldSimulationUserRequirementsByUser_ACU(
  raw: unknown,
  chat?: any[],
): Promise<WorldSimulationUserRequirementsSnapshot_ACU> {
  const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
  const resolved = (() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!isRecord_ACU(message) || message.is_user === true || message.is_system === true) continue;
      try {
        return resolveWorldSimulationAnchor_ACU(index, messages);
      } catch {
        continue;
      }
    }
    return null;
  })();
  if (!resolved) reject_ACU('当前聊天没有可承载用户要求快照的 assistant 楼层', undefined, 'persist');
  const normalized = normalizeWorldSimulationUserRequirementLines_ACU(raw);
  if (normalized === null) {
    reject_ACU('用户要求必须是字符串数组，例如 ["不要提前揭底牌","继续用第一人称"]；空串或非字符串条目会整份拒绝', undefined, 'persist');
  }
  return writeWorldSimulationUserRequirementsSnapshot_ACU(resolved, normalized, messages);
}
