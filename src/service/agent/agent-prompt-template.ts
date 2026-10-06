import type { AgentContextSettings_ACU, PromptSegment_ACU } from '../../shared/models/agent-worldbook-model';
import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import {
  AGENT_CONTEXT_SETTINGS_LIMITS_ACU,
  DEFAULT_AGENT_CONTEXT_SETTINGS_ACU,
  buildDefaultAgentDecisionPromptSegments_ACU,
  buildDefaultAgentSkillifyPromptSegments_ACU,
} from '../../shared/defaults';
import { renderAgentReadOnlyQueryTemplates_ACU, splitAgentQueryTemplateParts_ACU } from '../runtime/template-vars/agent-read-only-template-render';
import type { SqlTemplateReadContext_ACU } from '../runtime/template-vars/sql-query-var';

export type AgentPromptPlaceholderMap_ACU = Record<string, unknown>;

export interface AgentPromptRenderOptions_ACU {
  enableSqlRender?: boolean;
  sqlReadContext?: SqlTemplateReadContext_ACU | null;
  promptKind?: 'decision' | 'skillify' | 'unknown';
}

export function clonePromptSegments_ACU(value: PromptSegment_ACU[]): PromptSegment_ACU[] {
  return JSON.parse(JSON.stringify(value || []));
}

export function normalizeAgentContextSettings_ACU(value: unknown): AgentContextSettings_ACU {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const result: Record<string, number> = {};
  for (const [key, fallback] of Object.entries(DEFAULT_AGENT_CONTEXT_SETTINGS_ACU)) {
    const limits = (AGENT_CONTEXT_SETTINGS_LIMITS_ACU as Record<string, { min: number }>)[key];
    const raw = Number(source[key]);
    const base = Number.isFinite(raw) ? Math.trunc(raw) : fallback;
    result[key] = Math.max(limits.min, Math.min(Number.MAX_SAFE_INTEGER, base));
  }
  return result as unknown as AgentContextSettings_ACU;
}

function normalizeRole_ACU(value: unknown): string {
  const role = String(value || '').trim().toLowerCase();
  return role || 'user';
}

export function normalizeEditablePromptSegments_ACU(value: unknown, fallback: PromptSegment_ACU[]): PromptSegment_ACU[] {
  if (!Array.isArray(value)) return clonePromptSegments_ACU(fallback);
  const raw = value;
  return raw
    .map(item => item && typeof item === 'object' ? item as Record<string, unknown> : null)
    .filter(Boolean)
    .map(item => ({
      role: normalizeRole_ACU(item?.role),
      content: typeof item?.content === 'string' ? item.content : '',
      deletable: item?.deletable !== false,
      ...(typeof item?.mainSlot === 'string' && item.mainSlot ? { mainSlot: item.mainSlot } : {}),
      ...(item?.isMain === true ? { isMain: true } : {}),
      ...(item?.isMain2 === true ? { isMain2: true } : {}),
    }));
}

export function normalizePromptSegments_ACU(value: unknown, fallback: PromptSegment_ACU[]): PromptSegment_ACU[] {
  const normalized = normalizeEditablePromptSegments_ACU(value, [])
    .filter(item => item.content.trim());
  return normalized.length > 0 ? normalized : clonePromptSegments_ACU(fallback);
}

export function getDefaultAgentDecisionPromptSegments_ACU(): PromptSegment_ACU[] {
  return buildDefaultAgentDecisionPromptSegments_ACU();
}

export function getDefaultAgentSkillifyPromptSegments_ACU(): PromptSegment_ACU[] {
  return buildDefaultAgentSkillifyPromptSegments_ACU();
}

function stringifyPlaceholderValue_ACU(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || typeof value === 'undefined') return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function buildPlaceholderToken_ACU(content: string, segmentIndex: number, tokenIndex: number): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    const nonce = Math.random().toString(36).slice(2);
    const token = `__ACU_AGENT_PLACEHOLDER_${segmentIndex}_${tokenIndex}_${nonce}__`;
    if (!content.includes(token)) return token;
  }
  throw new Error('agent_placeholder_token_collision');
}

function renderAgentPromptContent_ACU(
  content: string,
  placeholders: AgentPromptPlaceholderMap_ACU,
  segmentIndex: number,
  options: AgentPromptRenderOptions_ACU,
): string {
  if (options.enableSqlRender !== true) {
    return content.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (raw, key) => (
      Object.prototype.hasOwnProperty.call(placeholders, key) ? stringifyPlaceholderValue_ACU(placeholders[key]) : raw
    ));
  }

  const startedAt = Date.now();
  const tokenValues = new Map<string, string>();
  let tokenIndex = 0;
  try {
    const protectedContent = splitAgentQueryTemplateParts_ACU(content)
      .map(part => {
        if (part.kind === 'query') return part.value;
        return part.value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (raw, key) => {
          if (!Object.prototype.hasOwnProperty.call(placeholders, key)) return raw;
          const token = buildPlaceholderToken_ACU(content, segmentIndex, tokenIndex++);
          tokenValues.set(token, stringifyPlaceholderValue_ACU(placeholders[key]));
          return token;
        });
      })
      .join('');
    const queryResult = options.sqlReadContext === undefined
      ? renderAgentReadOnlyQueryTemplates_ACU(protectedContent)
      : renderAgentReadOnlyQueryTemplates_ACU(protectedContent, options.sqlReadContext);
    let restored = queryResult.content;
    for (const [token, value] of tokenValues) restored = restored.split(token).join(value);
    logDebug_ACU(`[AgentPromptSQL] kind=${options.promptKind || 'unknown'}; segment=${segmentIndex}; tags=${queryResult.tagCount}; durationMs=${Date.now() - startedAt}; status=${queryResult.rejectedCount > 0 ? 'partial' : 'ok'}`);
    return restored;
  } catch (error: any) {
    logWarn_ACU(`[AgentPromptSQL] kind=${options.promptKind || 'unknown'}; segment=${segmentIndex}; tags=unknown; durationMs=${Date.now() - startedAt}; status=failed; reason=${String(error?.message || 'unknown')}`);
    return content.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (raw, key) => (
      Object.prototype.hasOwnProperty.call(placeholders, key) ? stringifyPlaceholderValue_ACU(placeholders[key]) : raw
    ));
  }
}

export function renderAgentPromptSegments_ACU(
  segments: PromptSegment_ACU[],
  placeholders: AgentPromptPlaceholderMap_ACU,
  options: AgentPromptRenderOptions_ACU = {},
): Array<{ role: string; content: string }> {
  return normalizePromptSegments_ACU(segments, [])
    .map((segment, segmentIndex) => ({
      role: normalizeRole_ACU(segment.role),
      content: renderAgentPromptContent_ACU(segment.content, placeholders, segmentIndex, options),
    }))
    .filter(message => message.content.trim());
}
