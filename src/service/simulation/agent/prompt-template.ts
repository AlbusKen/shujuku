import { WorldSimulationValidationError_ACU, createWorldSimulationError_ACU, type WorldSimulationErrorPhase_ACU, type WorldSimulationPromptSegment_ACU, type WorldSimulationSettings_ACU } from '../model';
import { WORLD_SIMULATION_AGENT_NAMES_ACU, WORLD_SIMULATION_RETIRED_AGENT_NAMES_ACU, type WorldSimulationAgentName_ACU } from './agent-catalog';
import { WORLD_SIMULATION_ENGINE_SEAMS_ACU, WORLD_SIMULATION_PROMPT_PLACEHOLDERS_ACU, buildDefaultWorldSimulationAgentPrompt_ACU, buildDefaultWorldSimulationAgentPrompts_ACU, worldSimulationSeamMarker_ACU, type WorldSimulationAgentPrompts_ACU, type WorldSimulationEngineSeam_ACU, type WorldSimulationPromptPlaceholder_ACU } from './agent-defaults';

const SEAM_ROLES_ACU: Record<WorldSimulationEngineSeam_ACU, string> = { ROOT: 'system', ROLE_RULES: 'system', PROTOCOL: 'system', WORKFLOW: 'system', HISTORY: 'user', RUNTIME_CONTEXT: 'user', ACKNOWLEDGEMENT: 'assistant', EXECUTION_BOUNDARY: 'user' };
const PLACEHOLDER_PATTERN_ACU = /\$[A-Z][A-Z0-9_]*/g;
type PlaceholderResolver_ACU = () => string | Promise<string>;
function fail_ACU(message: string, details?: Record<string, unknown>, phase: WorldSimulationErrorPhase_ACU = 'load'): never {
  throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU('WORLD_SIMULATION_CONFIG_INVALID', phase, message, false, details));
}

export function validateWorldSimulationPromptSegments_ACU(value: unknown, agentName: WorldSimulationAgentName_ACU, phase: WorldSimulationErrorPhase_ACU = 'load'): WorldSimulationPromptSegment_ACU[] {
  if (!Array.isArray(value) || !value.length) fail_ACU('提示词必须是非空数组', { agentName }, phase);
  const result = value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail_ACU('提示词段必须是对象', { agentName, index }, phase);
    const raw = item as Record<string, unknown>;
    if (Object.keys(raw).some(key => !['role', 'content', 'enabled', 'deletable', 'pinned'].includes(key))) fail_ACU('提示词段包含未知字段', { agentName, index }, phase);
    if (!['system', 'user', 'assistant'].includes(String(raw.role)) || typeof raw.content !== 'string' || !raw.content.trim()) fail_ACU('提示词段角色或内容非法', { agentName, index }, phase);
    if (typeof raw.enabled !== 'boolean' || typeof raw.deletable !== 'boolean' || typeof raw.pinned !== 'boolean') fail_ACU('提示词段开关非法', { agentName, index }, phase);
    return { role: raw.role as string, content: raw.content, enabled: raw.enabled, deletable: raw.deletable, pinned: raw.pinned };
  });
  let cursor = -1;
  for (const seam of WORLD_SIMULATION_ENGINE_SEAMS_ACU) {
    const marker = worldSimulationSeamMarker_ACU(seam);
    const matches = result.map((segment, index) => segment.content.includes(marker) ? index : -1).filter(index => index >= 0);
    if (matches.length !== 1 || matches[0] <= cursor) fail_ACU('engine seam 缺失、重复或错序', { agentName, seam }, phase);
    const segment = result[matches[0]];
    if (segment.role !== SEAM_ROLES_ACU[seam] || !segment.enabled || segment.deletable || !segment.pinned) fail_ACU('engine seam 属性非法', { agentName, seam }, phase);
    cursor = matches[0];
  }
  const guidance = result.filter(segment => segment.content.includes('$WORLD_USER_GUIDANCE'));
  if (guidance.length !== 1 || !guidance[0].enabled || !guidance[0].deletable || guidance[0].pinned) fail_ACU('guidance 段必须唯一、启用且可编辑', { agentName }, phase);
  for (const segment of result) for (const token of segment.content.match(PLACEHOLDER_PATTERN_ACU) ?? []) if (!(WORLD_SIMULATION_PROMPT_PLACEHOLDERS_ACU as readonly string[]).includes(token)) fail_ACU('提示词包含未知占位符', { agentName, token }, phase);
  return result;
}

export function validateWorldSimulationAgentPrompts_ACU(value: unknown, phase: WorldSimulationErrorPhase_ACU = 'load'): WorldSimulationAgentPrompts_ACU {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail_ACU('agentPrompts 必须是对象', undefined, phase);
  const raw = value as Record<string, unknown>;
  const retired = new Set<string>(WORLD_SIMULATION_RETIRED_AGENT_NAMES_ACU);
  if (Object.keys(raw).some(key => !(WORLD_SIMULATION_AGENT_NAMES_ACU as readonly string[]).includes(key) && !retired.has(key))) fail_ACU('agentPrompts 包含未知角色', undefined, phase);
  const hasRetired = Object.keys(raw).some(key => retired.has(key));
  const result = {} as WorldSimulationAgentPrompts_ACU;
  for (const name of WORLD_SIMULATION_AGENT_NAMES_ACU) {
    if (raw[name] === undefined) {
      if (!hasRetired) fail_ACU('提示词必须是非空数组', { agentName: name }, phase);
      result[name] = buildDefaultWorldSimulationAgentPrompt_ACU(name);
      continue;
    }
    result[name] = validateWorldSimulationPromptSegments_ACU(raw[name], name, phase);
  }
  return result;
}

function escapeUntrusted_ACU(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function untrustedBlock_ACU(token: WorldSimulationPromptPlaceholder_ACU, value: string): string {
  const label = `UNTRUSTED_${token.slice(1)}`;
  return `<${label}>\n${escapeUntrusted_ACU(value)}\n</${label}>`;
}

export async function renderWorldSimulationPrompt_ACU(
  segments: unknown,
  agentName: WorldSimulationAgentName_ACU,
  resolvers: Partial<Record<WorldSimulationPromptPlaceholder_ACU, PlaceholderResolver_ACU>>,
): Promise<{ messages: Array<{ role: string; content: string }>; usedPlaceholders: WorldSimulationPromptPlaceholder_ACU[] }> {
  const validated = validateWorldSimulationPromptSegments_ACU(segments, agentName);
  const enabled = validated.filter(segment => segment.enabled);
  const used = new Set<WorldSimulationPromptPlaceholder_ACU>();
  for (const segment of enabled) {
    for (const token of segment.content.match(PLACEHOLDER_PATTERN_ACU) ?? []) used.add(token as WorldSimulationPromptPlaceholder_ACU);
  }
  const values = new Map<WorldSimulationPromptPlaceholder_ACU, string>();
  for (const token of used) {
    if (!Object.prototype.hasOwnProperty.call(resolvers, token) || typeof resolvers[token] !== 'function') fail_ACU('缺少已使用占位符的授权 resolver', { agentName, token });
    values.set(token, untrustedBlock_ACU(token, String(await resolvers[token]!())));
  }
  const messages = enabled.map(segment => ({
    role: segment.role,
    content: segment.content.replace(PLACEHOLDER_PATTERN_ACU, token => values.get(token as WorldSimulationPromptPlaceholder_ACU) ?? token),
  }));
  if (messages.some(message => (message.content.match(PLACEHOLDER_PATTERN_ACU) ?? []).length > 0)) fail_ACU('渲染后仍有残留占位符', { agentName });
  return { messages, usedPlaceholders: [...used] };
}

export function restoreWorldSimulationPromptDefault_ACU(settings: WorldSimulationSettings_ACU, agentName: WorldSimulationAgentName_ACU): WorldSimulationSettings_ACU {
  return { ...settings, agentPrompts: { ...settings.agentPrompts, [agentName]: buildDefaultWorldSimulationAgentPrompt_ACU(agentName) } };
}

export function exportWorldSimulationPrompts_ACU(prompts: unknown): string {
  return JSON.stringify(validateWorldSimulationAgentPrompts_ACU(prompts));
}

export function importWorldSimulationPrompts_ACU(serialized: string): WorldSimulationAgentPrompts_ACU {
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); } catch { fail_ACU('提示词导入 JSON 非法'); }
  return validateWorldSimulationAgentPrompts_ACU(parsed);
}

export function fallbackWorldSimulationAgentPrompts_ACU(value: unknown): WorldSimulationAgentPrompts_ACU {
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0) return validateWorldSimulationAgentPrompts_ACU(value);
  return buildDefaultWorldSimulationAgentPrompts_ACU();
}
