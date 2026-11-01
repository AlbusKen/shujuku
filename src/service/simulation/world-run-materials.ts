/**
 * 一次世界推演运行的输入资料指纹。
 *
 * 此指纹只证明本次重新读取到的材料相同：宿主跨书读取并非原子操作，且不能防御
 * 恶意客户端篡改。恢复运行必须重新读取并比较，任何变化均应拒绝恢复。
 */
import { sha256HexSync_ACU } from '../../shared/sha256-sync';
import { resolveWorldRoundPromptSegments_ACU, validateWorldRoundPrompts_ACU } from './agent/world-round-prompts';
import { type WorldSimulationDeliveryTarget_ACU, type WorldSimulationSettings_ACU, type WorldSimulationWorkflowMode_ACU } from './model';
import {
  emptyWorldSimulationUserRequirementsSnapshot_ACU,
  validateWorldSimulationUserRequirementsSnapshot_ACU,
} from './agent/agent-user-requirements';
import type { WorldSimulationUserRequirementsSnapshot_ACU } from './agent/agent-model';
import type { AgentWorldbookSnapshot_ACU } from '../continuation/agent/agent-worldbook-read';

export interface WorldRunMaterials_ACU {
  schemaVersion: 1;
  instructionHash: string;
  requirementsHash: string;
  worldbookHash: string;
  promptsHash?: string;
}

export interface BuildWorldRunMaterialsInput_ACU {
  instruction: string;
  userRequirements?: WorldSimulationUserRequirementsSnapshot_ACU;
  worldbookSnapshot: AgentWorldbookSnapshot_ACU;
  worldRoundPrompts?: WorldSimulationSettings_ACU['worldRoundPrompts'];
  workflowMode?: WorldSimulationWorkflowMode_ACU;
  deliveryTarget?: WorldSimulationDeliveryTarget_ACU;
}

type CanonicalValue_ACU = null | boolean | number | string | readonly CanonicalValue_ACU[] | { readonly [key: string]: CanonicalValue_ACU };

const HASH_PATTERN_ACU = /^[0-9a-f]{64}$/;
const MATERIAL_KEYS_ACU = ['schemaVersion', 'instructionHash', 'requirementsHash', 'worldbookHash'];
const SNAPSHOT_KEYS_ACU = ['available', 'entries'];
const ENTRY_REQUIRED_KEYS_ACU = ['bookName', 'uid', 'title', 'keys', 'constant', 'content', 'tokens'];
const ENTRY_ALLOWED_KEYS_ACU = [...ENTRY_REQUIRED_KEYS_ACU, 'preventRecursion', 'excludeRecursion'];

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function hasOnlyKeys_ACU(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function hasNoUnknownKeys_ACU(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

function hasRequiredKeys_ACU(value: Record<string, unknown>, required: readonly string[]): boolean {
  return required.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function canonicalize_ACU(value: CanonicalValue_ACU): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('WORLD_RUN_MATERIALS_CANONICAL_NUMBER_INVALID');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize_ACU).join(',')}]`;
  const record = value as { readonly [key: string]: CanonicalValue_ACU };
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalize_ACU(record[key])}`).join(',')}}`;
}

function hashCanonical_ACU(value: CanonicalValue_ACU): string {
  return sha256HexSync_ACU(canonicalize_ACU(value));
}

function requiredString_ACU(value: unknown): value is string {
  return typeof value === 'string';
}

function normalizeWorldbookSnapshot_ACU(raw: unknown): CanonicalValue_ACU {
  if (!isRecord_ACU(raw) || !hasOnlyKeys_ACU(raw, SNAPSHOT_KEYS_ACU) || raw.available !== true || !Array.isArray(raw.entries)) {
    throw new Error('WORLD_RUN_MATERIALS_WORLDBOOK_SNAPSHOT_INVALID');
  }

  const identities = new Set<string>();
  const entries: CanonicalValue_ACU[] = raw.entries.map((rawEntry): CanonicalValue_ACU => {
    if (!isRecord_ACU(rawEntry) || !hasNoUnknownKeys_ACU(rawEntry, ENTRY_ALLOWED_KEYS_ACU)
      || !hasRequiredKeys_ACU(rawEntry, ENTRY_REQUIRED_KEYS_ACU)
      || !requiredString_ACU(rawEntry.bookName) || !rawEntry.bookName
      || !requiredString_ACU(rawEntry.uid) || !rawEntry.uid
      || !requiredString_ACU(rawEntry.title) || !Array.isArray(rawEntry.keys)
      || !rawEntry.keys.every(requiredString_ACU) || typeof rawEntry.constant !== 'boolean'
      || (rawEntry.preventRecursion !== undefined && typeof rawEntry.preventRecursion !== 'boolean')
      || (rawEntry.excludeRecursion !== undefined && typeof rawEntry.excludeRecursion !== 'boolean')
      || !requiredString_ACU(rawEntry.content) || typeof rawEntry.tokens !== 'number'
      || !Number.isFinite(rawEntry.tokens) || rawEntry.tokens < 0) {
      throw new Error('WORLD_RUN_MATERIALS_WORLDBOOK_ENTRY_INVALID');
    }
    const identity = JSON.stringify([rawEntry.bookName, rawEntry.uid]);
    if (identities.has(identity)) throw new Error('WORLD_RUN_MATERIALS_WORLDBOOK_ENTRY_DUPLICATE');
    identities.add(identity);
    return {
      bookName: rawEntry.bookName,
      uid: rawEntry.uid,
      title: rawEntry.title,
      keys: [...rawEntry.keys],
      constant: rawEntry.constant,
      preventRecursion: rawEntry.preventRecursion === true,
      excludeRecursion: rawEntry.excludeRecursion === true,
      // tokens 是估算器产物，不代表业务语义；正文与可见规则的变动由 contentHash 覆盖。
      contentHash: sha256HexSync_ACU(rawEntry.content),
    };
  });

  entries.sort((left, right) => {
    const [leftBook, leftUid] = [String((left as Record<string, CanonicalValue_ACU>).bookName), String((left as Record<string, CanonicalValue_ACU>).uid)];
    const [rightBook, rightUid] = [String((right as Record<string, CanonicalValue_ACU>).bookName), String((right as Record<string, CanonicalValue_ACU>).uid)];
    return leftBook.localeCompare(rightBook) || leftUid.localeCompare(rightUid);
  });
  return { available: true, entries };
}

function cloneMaterials_ACU(materials: WorldRunMaterials_ACU): WorldRunMaterials_ACU {
  return {
    schemaVersion: 1,
    instructionHash: materials.instructionHash,
    requirementsHash: materials.requirementsHash,
    worldbookHash: materials.worldbookHash,
    ...(materials.promptsHash === undefined ? {} : { promptsHash: materials.promptsHash }),
  };
}

/** 从首次冻结的 task.originInstruction 传入 instruction；不能用 resume 机械文本替换它。 */
export function buildWorldRunMaterials_ACU(input: BuildWorldRunMaterialsInput_ACU): WorldRunMaterials_ACU {
  if (!isRecord_ACU(input) || !hasNoUnknownKeys_ACU(input, ['instruction', 'userRequirements', 'worldbookSnapshot', 'worldRoundPrompts', 'workflowMode', 'deliveryTarget'])
    || !Object.prototype.hasOwnProperty.call(input, 'instruction')
    || !Object.prototype.hasOwnProperty.call(input, 'worldbookSnapshot')
    || typeof input.instruction !== 'string') {
    throw new Error('WORLD_RUN_MATERIALS_INPUT_INVALID');
  }
  const requirements = validateWorldSimulationUserRequirementsSnapshot_ACU(
    input.userRequirements === undefined ? emptyWorldSimulationUserRequirementsSnapshot_ACU() : input.userRequirements,
  );
  const materials: WorldRunMaterials_ACU = {
    schemaVersion: 1,
    instructionHash: sha256HexSync_ACU(input.instruction),
    requirementsHash: hashCanonical_ACU({ updatedAt: requirements.updatedAt, requirements: [...requirements.requirements] }),
    worldbookHash: hashCanonical_ACU(normalizeWorldbookSnapshot_ACU(input.worldbookSnapshot)),
  };
  const workflowMode = input.workflowMode ?? 'layered';
  if (workflowMode !== 'single' && workflowMode !== 'layered') throw new Error('WORLD_RUN_MATERIALS_WORKFLOW_MODE_INVALID');
  const prompts = input.worldRoundPrompts === undefined ? undefined : validateWorldRoundPrompts_ACU(input.worldRoundPrompts);
  const effectiveTemplates: Array<[string, Parameters<typeof resolveWorldRoundPromptSegments_ACU>[1], string | undefined]> = [
    ['clock-recaller', 'clock-recaller', undefined],
    ['world-page', workflowMode === 'single' ? 'world-simulator' : 'world-event-analyst', 'world-page'],
    ['actor-batch', workflowMode === 'single' ? 'world-simulator' : 'actor-simulator', 'actor-batch'],
    ['world-narrative-review-v1', 'joint-reviewer', 'world-narrative-review-v1'],
  ];
  const enabled: { [key: string]: CanonicalValue_ACU } = {};
  for (const [stage, role, roleStage] of effectiveTemplates) {
    const messages = resolveWorldRoundPromptSegments_ACU({ worldRoundPrompts: prompts, workflowMode }, role, roleStage)
      .filter(segment => segment.enabled && segment.content.trim())
      .map(segment => ({ role: segment.role, content: segment.content }));
    enabled[stage] = messages.length ? messages : 'explicitly-disabled';
  }
  // 仅哈希实际生产阶段解析出的段；旧三项审查和未使用角色不得影响恢复。
  materials.promptsHash = hashCanonical_ACU({
    workflowMode,
    deliveryTarget: input.deliveryTarget ?? null,
    prompts: enabled,
  });
  if (input.deliveryTarget !== undefined && input.deliveryTarget !== 'body' && input.deliveryTarget !== 'plot') {
    throw new Error('WORLD_RUN_MATERIALS_DELIVERY_TARGET_INVALID');
  }
  return cloneMaterials_ACU(materials);
}

function isWorldRunMaterials_ACU(value: unknown): value is WorldRunMaterials_ACU {
  return isRecord_ACU(value) && hasNoUnknownKeys_ACU(value, [...MATERIAL_KEYS_ACU, 'promptsHash'])
    && hasRequiredKeys_ACU(value, MATERIAL_KEYS_ACU) && value.schemaVersion === 1
    && (value.promptsHash === undefined || typeof value.promptsHash === 'string' && HASH_PATTERN_ACU.test(value.promptsHash))
    && typeof value.instructionHash === 'string' && HASH_PATTERN_ACU.test(value.instructionHash)
    && typeof value.requirementsHash === 'string' && HASH_PATTERN_ACU.test(value.requirementsHash)
    && typeof value.worldbookHash === 'string' && HASH_PATTERN_ACU.test(value.worldbookHash);
}

/** 仅接受完整的 v1 四字段结构；未知字段或畸形哈希一律不等。 */
export function sameWorldRunMaterials_ACU(left: WorldRunMaterials_ACU, right: WorldRunMaterials_ACU): boolean {
  return isWorldRunMaterials_ACU(left) && isWorldRunMaterials_ACU(right)
    && left.schemaVersion === right.schemaVersion
    && left.instructionHash === right.instructionHash
    && left.requirementsHash === right.requirementsHash
    && left.worldbookHash === right.worldbookHash
    && left.promptsHash === right.promptsHash;
}
