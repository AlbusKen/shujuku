import { isTauriTavernHost_ACU } from '../../shared/host-detect';
import { sha256HexSync_ACU } from '../../shared/sha256-sync';
import { parse as parseYaml_ACU } from 'yaml';
import type { ApiPresetApiConfig_ACU, ApiPresetApiMode_ACU } from '../settings/api-preset-service';

/**
 * Capability matrix for the plugin-owned request body. Tavern profiles and generateRaw do not expose
 * the provider wire body. TT's custom_api_format bridge has no verified wire contract here. In ST's
 * custom chat-completions branch (1.12.13), custom_include_body is merged into the final JSON body,
 * before custom_exclude_body. Only the official OpenAI endpoint/model is known to accept this hint;
 * an arbitrary OpenAI-compatible gateway is not evidence of support.
 */
export function supportsExplicitOpenAiCacheKey_ACU(preset: {
  apiMode: ApiPresetApiMode_ACU;
  apiConfig: ApiPresetApiConfig_ACU;
}): boolean {
  if (preset.apiMode !== 'custom' || preset.apiConfig.useMainApi || isTauriTavernHost_ACU()) return false;
  if (preset.apiConfig.customApiFormat && preset.apiConfig.customApiFormat !== 'openai_compat') return false;
  // ST 的 custom_exclude_body 可在合并后移除字段；无法确认排除列表时宁可不用显式键。
  const exclusions = preset.apiConfig.excludeBodyParams?.trim();
  if (exclusions) {
    let parsed: unknown;
    try { parsed = parseYaml_ACU(exclusions); } catch { return false; }
    if (Array.isArray(parsed) && parsed.includes('prompt_cache_key')) return false;
    if (parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, 'prompt_cache_key')) return false;
    if (parsed === 'prompt_cache_key' || exclusions.split(/[\s,]+/).includes('prompt_cache_key')) return false;
  }
  let url: URL;
  try { url = new URL(preset.apiConfig.url); } catch { return false; }
  if (url.protocol !== 'https:' || url.hostname !== 'api.openai.com' || url.port || url.username || url.password
    || !/^\/v1\/?$/.test(url.pathname) || url.search || url.hash) return false;
  return /^(?:gpt-4o(?:-|$)|gpt-4\.1(?:-|$)|gpt-5(?:[-.]|$)|o[134](?:-|$))/.test(preset.apiConfig.model);
}

function fingerprint_ACU(input: string): string {
  return sha256HexSync_ACU(input).slice(0, 10);
}

/** A stable namespace, not a cache-hit claim. Never hash the growing transcript or a request ID. */
export function buildOpenAiPromptCacheKey_ACU(input: {
  chatIdentity: string;
  role: string;
  tools: readonly string[];
  boundary?: string;
  preset: { apiMode: ApiPresetApiMode_ACU; apiConfig: ApiPresetApiConfig_ACU };
}): string {
  const { preset } = input;
  const chat = fingerprint_ACU(input.chatIdentity);
  const role = fingerprint_ACU(input.role);
  const route = fingerprint_ACU(JSON.stringify([
    preset.apiMode, preset.apiConfig.customApiFormat || 'openai_compat',
    preset.apiConfig.model, preset.apiConfig.url,
  ]));
  const tools = fingerprint_ACU(JSON.stringify([...new Set(input.tools)].sort()));
  const boundary = fingerprint_ACU(input.boundary || 'uncompacted');
  return `acu-v3-${chat}-${role}-${route}-${tools}-${boundary}`;
}
