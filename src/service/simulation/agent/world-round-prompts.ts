import {
  WORLD_ROUND_PROMPT_ROLES_ACU,
  WorldSimulationValidationError_ACU,
  createWorldSimulationError_ACU,
  type WorldRoundPlaceholder_ACU,
  type WorldRoundPromptContext_ACU,
  type WorldRoundPromptRole_ACU,
  type WorldSimulationErrorPhase_ACU,
  type WorldSimulationPromptSegment_ACU,
  type WorldSimulationSettings_ACU,
} from '../model';
import { getDefaultWorldRoundPromptSegments_ACU } from './world-round-prompt-defaults';
import { isAgentSnapshotSlot_ACU } from '../../../shared/agent-prompt-layout';

export { WORLD_ROUND_PROMPT_ROLES_ACU, type WorldRoundPromptRole_ACU } from '../model';
export type { WorldRoundPlaceholder_ACU, WorldRoundPromptContext_ACU } from '../model';

type PromptMessage_ACU = { role: string; content: string };

const WORLD_ROUND_PLACEHOLDERS_ACU = [
  'WORLD_TASK',
  'WORLD_USER_REQUIREMENTS',
  'ANCHOR_MESSAGE',
  'WORLD_RUNTIME_CONTEXT',
  'WORLD_CHRONICLE',
  'WORLD_TABLES',
  'WORLDBOOK_CATALOG',
  'WORLDBOOK_HITS',
  'READ_BUDGET',
] as const satisfies readonly WorldRoundPlaceholder_ACU[];
const WORLD_ROUND_PLACEHOLDER_SET_ACU = new Set<string>(WORLD_ROUND_PLACEHOLDERS_ACU);
const MATERIAL_ALREADY_PROVIDED_ACU = '资料已提供，请勿重复请求。';
const MATERIAL_UNAVAILABLE_ACU = '资料未提供。';

function fail_ACU(message: string, details?: Record<string, unknown>, phase: WorldSimulationErrorPhase_ACU = 'load'): never {
  throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
    'WORLD_SIMULATION_CONFIG_INVALID', phase, message, false, details,
  ));
}

function cloneSegments_ACU(segments: readonly WorldSimulationPromptSegment_ACU[]): WorldSimulationPromptSegment_ACU[] {
  return segments.map(segment => ({ ...segment }));
}

/** 独立于旧 agentPrompts 的整轮角色提示词校验；不强加旧 seam、段序或 pinned 迁移，用户段落原样保留。 */
export function validateWorldRoundPromptSegments_ACU(
  value: unknown,
  role: WorldRoundPromptRole_ACU,
  phase: WorldSimulationErrorPhase_ACU = 'load',
): WorldSimulationPromptSegment_ACU[] {
  if (!Array.isArray(value)) fail_ACU('worldRoundPrompts 角色提示词必须是数组', { role }, phase);
  return value.map((item, index) => {
    const path = `settings.worldRoundPrompts.${role}[${index}]`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      fail_ACU('worldRoundPrompts 提示词段必须是对象', { role, index, path }, phase);
    }
    const raw = item as Record<string, unknown>;
    const allowed = ['role', 'content', 'snapshotTemplate', 'enabled', 'deletable', 'pinned'];
    const unknownFields = Object.keys(raw).filter(key => !allowed.includes(key));
    if (unknownFields.length) fail_ACU('worldRoundPrompts 提示词段包含未知字段', { role, index, path, unknownFields }, phase);
    const missingFields = ['role', 'content', 'enabled', 'deletable', 'pinned']
      .filter(key => !Object.prototype.hasOwnProperty.call(raw, key));
    if (missingFields.length) fail_ACU('worldRoundPrompts 提示词段缺少必填字段', { role, index, path, missingFields }, phase);
    if (!['system', 'user', 'assistant'].includes(String(raw.role)) || typeof raw.content !== 'string') {
      fail_ACU('worldRoundPrompts 提示词段角色或内容非法', { role, index, path }, phase);
    }
    if (typeof raw.enabled !== 'boolean' || typeof raw.deletable !== 'boolean' || typeof raw.pinned !== 'boolean') {
      fail_ACU('worldRoundPrompts 提示词段开关非法', { role, index, path }, phase);
    }
    if (raw.snapshotTemplate !== undefined && (typeof raw.snapshotTemplate !== 'string'
      || !isAgentSnapshotSlot_ACU({ content: raw.content })
      || /\$(?:HISTORY_ANCHOR|RUNTIME_SNAPSHOT)\b/.test(raw.snapshotTemplate))) {
      fail_ACU('worldRoundPrompts 快照模板必须属于快照卡，且不能嵌套历史或快照插入点', { role, index, path }, phase);
    }
    return {
      role: raw.role as 'system' | 'user' | 'assistant', content: raw.content as string,
      ...(raw.snapshotTemplate === undefined ? {} : { snapshotTemplate: raw.snapshotTemplate as string }),
      enabled: raw.enabled as boolean, deletable: raw.deletable as boolean, pinned: raw.pinned as boolean,
    };
  });
}

/** 仅接受已登记的整轮角色；缺失字段保持缺失，不生成默认段落。 */
export function validateWorldRoundPrompts_ACU(
  value: unknown,
  phase: WorldSimulationErrorPhase_ACU = 'load',
): Partial<Record<WorldRoundPromptRole_ACU, WorldSimulationPromptSegment_ACU[]>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail_ACU('settings.worldRoundPrompts 必须是对象', { path: 'settings.worldRoundPrompts' }, phase);
  }
  const raw = value as Record<string, unknown>;
  const unknownRoles = Object.keys(raw).filter(role => !(WORLD_ROUND_PROMPT_ROLES_ACU as readonly string[]).includes(role));
  if (unknownRoles.length) fail_ACU('settings.worldRoundPrompts 包含未知角色', { path: 'settings.worldRoundPrompts', unknownRoles }, phase);
  const result: Partial<Record<WorldRoundPromptRole_ACU, WorldSimulationPromptSegment_ACU[]>> = {};
  for (const role of WORLD_ROUND_PROMPT_ROLES_ACU) {
    if (raw[role] !== undefined) result[role] = validateWorldRoundPromptSegments_ACU(raw[role], role, phase);
  }
  return result;
}

function stageBusinessRole_ACU(stage?: string): 'world-event-analyst' | 'actor-simulator' | null {
  if (!stage) return null;
  if (stage === 'world-page' || stage.startsWith('world-page-')) return 'world-event-analyst';
  if (stage === 'actor-batch' || stage.startsWith('actor-batch-')) return 'actor-simulator';
  return null;
}

type WorldRoundPromptSettings_ACU = Pick<WorldSimulationSettings_ACU, 'worldRoundPrompts'>
  & Partial<Pick<WorldSimulationSettings_ACU, 'workflowMode'>>;

function resolveRoleSegments_ACU(
  settings: WorldRoundPromptSettings_ACU,
  role: WorldRoundPromptRole_ACU,
): WorldSimulationPromptSegment_ACU[] {
  // hasOwnProperty 区分“未设置，派生默认”与用户明确的 []/全禁用。
  if (Object.prototype.hasOwnProperty.call(settings.worldRoundPrompts ?? {}, role)) {
    return cloneSegments_ACU(settings.worldRoundPrompts?.[role] ?? []);
  }
  return cloneSegments_ACU(getDefaultWorldRoundPromptSegments_ACU(role));
}

/**
 * 返回本次实际生效的业务段。single 在两个业务阶段使用对应分层业务稿，
 * 并仅把原 world-simulator 配置作为附加自定义；不会把两套业务稿同时塞入请求。
 */
export function resolveWorldRoundPromptSegments_ACU(
  settings: WorldRoundPromptSettings_ACU,
  role: WorldRoundPromptRole_ACU,
  stage?: string,
): WorldSimulationPromptSegment_ACU[] {
  const businessRole = role === 'world-simulator' && settings.workflowMode === 'single' ? stageBusinessRole_ACU(stage) : null;
  if (!businessRole) return resolveRoleSegments_ACU(settings, role);
  return [
    ...resolveRoleSegments_ACU(settings, businessRole),
    // single 历史配置没有默认正文；这里仅附加显式用户段，缺失时绝不注入不可见默认。
    ...(Object.prototype.hasOwnProperty.call(settings.worldRoundPrompts ?? {}, 'world-simulator')
      ? cloneSegments_ACU(settings.worldRoundPrompts?.['world-simulator'] ?? []) : []),
  ];
}

function literalMaterialBlock_ACU(name: WorldRoundPlaceholder_ACU, value: unknown): string {
  return JSON.stringify({ [name]: value });
}

function appendSupplementalMaterials_ACU(
  messages: readonly PromptMessage_ACU[],
  materials: Partial<Record<WorldRoundPlaceholder_ACU, unknown>> | undefined,
  used: ReadonlySet<WorldRoundPlaceholder_ACU>,
): PromptMessage_ACU[] {
  if (!materials) return [...messages];
  const missing: Partial<Record<WorldRoundPlaceholder_ACU, unknown>> = {};
  for (const name of WORLD_ROUND_PLACEHOLDERS_ACU) {
    if (Object.prototype.hasOwnProperty.call(materials, name) && !used.has(name)) missing[name] = materials[name];
  }
  return Object.keys(missing).length
    ? [...messages, { role: 'user', content: JSON.stringify(missing) }]
    : [...messages];
}

/**
 * 业务段中的资料占位符只作一次字面替换；资料自身绝不递归展开，也不执行 EJS/SQL。
 * 每个动态块拆为独立 user JSON 消息，保证调用方无需从业务文字中提取 JSON；用户编辑的静态文字顺序不变。
 */
export function appendWorldRoundPromptMessages_ACU(
  messages: readonly PromptMessage_ACU[],
  settings: WorldRoundPromptSettings_ACU,
  role: WorldRoundPromptRole_ACU,
  context?: WorldRoundPromptContext_ACU,
): PromptMessage_ACU[] {
  const segments = resolveWorldRoundPromptSegments_ACU(settings, role, context?.stage)
    .filter(segment => segment.enabled && segment.content.trim());
  if (messages[0]?.role !== 'system') return [...messages];
  if (!segments.length) return appendSupplementalMaterials_ACU(messages, context?.materials, new Set());

  const supplied = context?.materials ?? {};
  const used = new Set<WorldRoundPlaceholder_ACU>();
  const expanded: PromptMessage_ACU[] = [];
  for (const segment of segments) {
    let offset = 0;
    const pattern = /\$(WORLD_TASK|WORLD_USER_REQUIREMENTS|ANCHOR_MESSAGE|WORLD_RUNTIME_CONTEXT|WORLD_CHRONICLE|WORLD_TABLES|WORLDBOOK_CATALOG|WORLDBOOK_HITS|READ_BUDGET)\b/g;
    for (const match of segment.content.matchAll(pattern)) {
      const index = match.index ?? 0;
      const staticText = segment.content.slice(offset, index);
      if (staticText) expanded.push({ role: segment.role, content: staticText });
      const name = match[1] as WorldRoundPlaceholder_ACU;
      const firstUse = !used.has(name);
      used.add(name);
      expanded.push({
        role: 'user',
        content: literalMaterialBlock_ACU(name, firstUse
          ? (Object.prototype.hasOwnProperty.call(supplied, name) ? supplied[name] : MATERIAL_UNAVAILABLE_ACU)
          : MATERIAL_ALREADY_PROVIDED_ACU),
      });
      offset = index + match[0].length;
    }
    const trailing = segment.content.slice(offset);
    if (trailing) expanded.push({ role: segment.role, content: trailing });
  }
  return appendSupplementalMaterials_ACU([
    messages[0],
    ...expanded,
    ...messages.slice(1),
  ], supplied, used);
}

/** 公开白名单，供调用方/测试对资料消息做严格识别，不接受未知动态键。 */
export function isWorldRoundPlaceholder_ACU(value: string): value is WorldRoundPlaceholder_ACU {
  return WORLD_ROUND_PLACEHOLDER_SET_ACU.has(value);
}
