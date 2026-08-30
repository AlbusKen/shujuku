// service/ai/api-call.ts — AI 调用编排（剧情推进用）
// 从 04_shared_helpers.js 迁入

import { parse as parseYaml_ACU } from 'yaml';
import { handleApiResponse_ACU, extractAiUsageMetadata_ACU, type AiUsageMetadata_ACU } from './prompt-builder';
export type { AiUsageMetadata_ACU };
import { settings_ACU } from '../runtime/state-manager';
import { isGenerateRawAvailable_ACU, generateRaw_ACU, sendConnectionManagerRequest_ACU, getHostRequestHeaders_ACU, getConnectionManagerProfiles_ACU, triggerSlash_ACU } from '../../data/gateways/ai-gateway';
import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { isTauriTavernHost_ACU } from '../../shared/host-detect';
import { resolveApiConfigByPreset_ACU, type ApiPresetApiConfig_ACU, type ApiPresetApiMode_ACU } from '../settings/api-preset-service';

type CustomIncludeBodyRootType_ACU = 'empty' | 'mapping' | 'sequence' | 'scalar' | 'invalid';

export interface CustomIncludeBodyDiagnostic_ACU {
  reason: 'none' | 'parse_error' | 'unsupported_root' | 'stream_options_replaced';
  rootType: CustomIncludeBodyRootType_ACU;
}

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function copyRecordWithoutPrototype_ACU(value: Record<string, unknown>): Record<string, unknown> {
  const copy = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value)) copy[key] = value[key];
  return copy;
}

/**
 * 组合 SillyTavern 的 custom_include_body。JSON 是合法 YAML；输出 JSON 可避免把对象字段
 * 再拼成不合法的混合 YAML，同时与宿主 yaml.parse 后的浅合并语义保持一致。
 */
export function composeCustomIncludeBody_ACU(
  userBodyParams: string,
  pluginFields: Record<string, unknown>,
): { value: string; diagnostic: CustomIncludeBodyDiagnostic_ACU } {
  const pluginKeys = Object.keys(pluginFields);
  if (pluginKeys.length === 0) {
    return { value: userBodyParams, diagnostic: { reason: 'none', rootType: userBodyParams.trim() ? 'scalar' : 'empty' } };
  }

  const trimmed = userBodyParams.trim();
  if (!trimmed) {
    return {
      value: JSON.stringify(copyRecordWithoutPrototype_ACU(pluginFields)),
      diagnostic: { reason: 'none', rootType: 'empty' },
    };
  }

  let parsed: unknown;
  try {
    parsed = parseYaml_ACU(userBodyParams);
  } catch {
    return { value: userBodyParams, diagnostic: { reason: 'parse_error', rootType: 'invalid' } };
  }

  const merged = Object.create(null) as Record<string, unknown>;
  let rootType: CustomIncludeBodyRootType_ACU;
  if (Array.isArray(parsed)) {
    rootType = 'sequence';
    for (const item of parsed) {
      if (!isRecord_ACU(item)) continue;
      for (const key of Object.keys(item)) merged[key] = item[key];
    }
  } else if (isRecord_ACU(parsed)) {
    rootType = 'mapping';
    for (const key of Object.keys(parsed)) merged[key] = parsed[key];
  } else {
    return { value: userBodyParams, diagnostic: { reason: 'unsupported_root', rootType: 'scalar' } };
  }

  let diagnostic: CustomIncludeBodyDiagnostic_ACU = { reason: 'none', rootType };
  for (const key of pluginKeys) {
    if (key === 'stream_options' && isRecord_ACU(pluginFields[key])) {
      const current = merged[key];
      if (current !== undefined && !isRecord_ACU(current)) {
        diagnostic = { reason: 'stream_options_replaced', rootType };
      }
      merged[key] = {
        ...(isRecord_ACU(current) ? copyRecordWithoutPrototype_ACU(current) : {}),
        ...copyRecordWithoutPrototype_ACU(pluginFields[key]),
      };
      continue;
    }
    merged[key] = pluginFields[key];
  }
  return { value: JSON.stringify(merged), diagnostic };
}

function normalizeExcludeBodyParamsForSillyTavern_ACU(raw: any): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('- ') || trimmed.startsWith('[') || trimmed.startsWith('{')) return trimmed;
  const keys = trimmed.split(/[,\n]/).map((s: string) => s.trim()).filter(Boolean);
  return keys.map((key: string) => `- ${key}`).join('\n');
}

/**
 * 构建 Chat Completions 自定义 API 请求体（支持 bodyParams / excludeBodyParams / requestHeaders）
 */
export function buildCustomApiRequestBody_ACU(
  messages: any[],
  effectiveApiConfig: any,
  overrides?: {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    stripModelPrefix?: boolean;
    /** 注入上游请求体的 prompt_cache_key（OpenAI 兼容缓存路由）。仅允许 [A-Za-z0-9_-]，防止破坏 YAML 注入通道。 */
    promptCacheKey?: string;
    /** 流式请求时注入 stream_options.include_usage，让流末尾下发 usage 统计 chunk。非流式请求忽略。 */
    includeStreamUsage?: boolean;
    /**
     * 注入上游请求体的 response_format（如严格 JSON 填表的 json_schema）。
     * JSON 是 YAML 的子集，序列化为单行后走 custom_include_body 合并进上游请求体；
     * 后端不支持时用户可通过 excludeBodyParams 填 response_format 剔除。
     */
    responseFormat?: Record<string, any>;
  }
): Record<string, any> {
  const opts = overrides || {};
  const model = opts.stripModelPrefix !== false
    ? (effectiveApiConfig.model || '').replace(/^models\//, '')
    : (effectiveApiConfig.model || '');
  const maxTokens = opts.maxTokens ?? effectiveApiConfig.max_tokens ?? effectiveApiConfig.maxTokens ?? 20000;
  const temperature = opts.temperature ?? effectiveApiConfig.temperature ?? 1.0;
  const topP = opts.topP ?? effectiveApiConfig.top_p ?? effectiveApiConfig.topP ?? 0.95;

  // 基础 Authorization 头
  let headers = effectiveApiConfig.apiKey ? `Authorization: Bearer ${effectiveApiConfig.apiKey}` : '';
  // 追加 requestHeaders
  if (effectiveApiConfig.requestHeaders) {
    const extra = effectiveApiConfig.requestHeaders.trim();
    if (extra) {
      headers = headers ? `${headers}\n${extra}` : extra;
    }
  }

  // 插件字段与用户 bodyParams 先按 SillyTavern 的 YAML 解析规则结构化组合，再作为
  // custom_include_body 交给宿主合并。无法安全解析时保留用户原文并跳过插件字段。
  const streaming = settings_ACU.streamingEnabled || false;
  const userBodyParams = String(effectiveApiConfig.bodyParams || '');
  const pluginFields = Object.create(null) as Record<string, unknown>;
  if (opts.promptCacheKey && /^[A-Za-z0-9_-]+$/.test(opts.promptCacheKey)) {
    pluginFields.prompt_cache_key = opts.promptCacheKey;
  }
  if (opts.includeStreamUsage && streaming) {
    pluginFields.stream_options = { include_usage: true };
  }
  if (opts.responseFormat && typeof opts.responseFormat === 'object') {
    pluginFields.response_format = opts.responseFormat;
  }
  const composedIncludeBody = composeCustomIncludeBody_ACU(userBodyParams, pluginFields);
  if (composedIncludeBody.diagnostic.reason === 'parse_error' || composedIncludeBody.diagnostic.reason === 'unsupported_root') {
    logWarn_ACU('[buildCustomApiRequestBody] 跳过插件请求体字段', composedIncludeBody.diagnostic);
  } else if (composedIncludeBody.diagnostic.reason === 'stream_options_replaced') {
    logWarn_ACU('[buildCustomApiRequestBody] 用户 stream_options 不是对象，已由插件对象替换', composedIncludeBody.diagnostic);
  }

  // 接口协议按宿主后端形态分流（同一预设字段 customApiFormat，两种落地方式）：
  // - TauriTavern（Rust 后端）：透传 custom_api_format 契约，按其分流上游端点与请求/响应变形
  //   （openai_compat→/chat/completions、openai_responses→/responses、claude_messages→/messages、
  //   gemini_interactions→/interactions）；非流式响应归一化为 OpenAI 形态，流式 Claude 为原样 Anthropic SSE。
  // - 原版 SillyTavern（Node 后端）：不识别 custom_api_format，改为映射到其内置的原生协议源
  //   （claude_messages→chat_completion_source:'claude'，服务端做 Anthropic 变形并透传原生 SSE，
  //   gemini_interactions→'makersuite'）；openai_compat 维持 custom；
  //   openai_responses 在 ST 无对应后端，回退 custom（/chat/completions）。
  // 白名单兜底：调用点可能传未归一化的 config，非法值回退 openai_compat。
  const CUSTOM_API_FORMATS_ACU = ['openai_compat', 'openai_responses', 'claude_messages', 'gemini_interactions'] as const;
  const customApiFormat = CUSTOM_API_FORMATS_ACU.includes(effectiveApiConfig.customApiFormat)
    ? effectiveApiConfig.customApiFormat
    : 'openai_compat';
  const isTauriTavern_ACU = isTauriTavernHost_ACU();
  const ST_NATIVE_SOURCE_BY_FORMAT: Record<string, string> = { claude_messages: 'claude', gemini_interactions: 'makersuite' };
  const chatCompletionSource = isTauriTavern_ACU || !ST_NATIVE_SOURCE_BY_FORMAT[customApiFormat]
    ? 'custom'
    : ST_NATIVE_SOURCE_BY_FORMAT[customApiFormat];

  const body: Record<string, any> = {
    // 统一将 messages 的 role 归一为小写（system / user / assistant）。
    //
    // 背景：改表助手等伪 role 提示词组（buildPseudoRoleTemplateAssistantPromptSegments_ACU）
    // 产出的 role 为大写 SYSTEM / USER，而自定义 chat-completions 后端（本函数构建的 body）
    // 只接受小写 role。此前 messages 被原样透传，导致后端报
    // `unknown variant SYSTEM`，改表助手 AI 调用失败。
    //
    // 本项目既有约定（merge-logic.ts:198 / merge-executor.ts:126 / content-optimization.ts:183）
    // 均在发送前对 role 做 toLowerCase；此处是自定义 chat-completions 的统一出口，
    // 对已是小写的输入（merge / plot / 存量路径）为无操作，不破坏既有行为。
    // tavern / 主 API（generateRaw）路径不经过本函数，不受影响。
    //
    // 边界契约：仅当 role 是字符串时才归一为小写；缺失 role、非字符串 role、
    // 数组/原始值等异常消息一律原样保留，交由后端校验，绝不把缺失 role 静默
    // 改造成 "undefined" / "null"。
    messages: Array.isArray(messages)
        ? messages.map((m) =>
              m && typeof m === 'object' && !Array.isArray(m) && typeof m.role === 'string'
                  ? { ...m, role: m.role.toLowerCase() }
                  : m,
          )
        : messages,
    model,
    max_tokens: maxTokens,
    temperature,
    top_p: topP,
    stream: streaming,
    chat_completion_source: chatCompletionSource,
    // custom_api_format 为 TT 契约字段，仅在 TT 宿主下携带（ST 后端不识别，由上方映射到原生源）。
    ...(isTauriTavern_ACU ? { custom_api_format: customApiFormat } : {}),
    group_names: [],
    include_reasoning: false,
    reasoning_effort: 'medium',
    enable_web_search: false,
    request_images: false,
    custom_prompt_post_processing: 'strict',
    reverse_proxy: effectiveApiConfig.url,
    // 原版 ST 原生协议源（claude/makersuite）从 reverse_proxy+proxy_password 取预设地址与密钥；
    // custom 源与 TT 不使用该字段，保持空串。
    proxy_password: (!isTauriTavern_ACU && chatCompletionSource !== 'custom')
      ? String(effectiveApiConfig.apiKey || '')
      : '',
    custom_url: effectiveApiConfig.url,
    custom_include_headers: headers,
    custom_include_body: composedIncludeBody.value,
    custom_exclude_body: normalizeExcludeBodyParamsForSillyTavern_ACU(effectiveApiConfig.excludeBodyParams),
  };

  return body;
}

/**
 * 剧情推进任务级 API 调用 — 接受显式预设名称
 * 调用优先级：presetName 参数 > 全局 plotApiPreset > 当前 API 配置
 */
export async function callApiWithPlotPreset_ACU(messages: any[], presetName: string, abortSignal: AbortSignal | null = null) {
    const effectivePresetName = presetName || settings_ACU.plotApiPreset || '';
    const apiPresetConfig = getApiConfigByPreset_ACU(effectivePresetName);
    const effectiveApiMode = apiPresetConfig.apiMode ?? settings_ACU.apiMode;
    const effectiveApiConfig = apiPresetConfig.apiConfig || settings_ACU.apiConfig || {};


    logDebug_ACU(`[剧情推进] 任务级API调用，预设: ${effectivePresetName || '当前配置'}, 模式: ${effectiveApiMode}`);


    if (effectiveApiMode === 'tavern' || effectiveApiConfig.useMainApi) {
      logDebug_ACU('[剧情推进] 通过酒馆主API发送请求（流式传输）...');
      if (!isGenerateRawAvailable_ACU()) {
        throw new Error('TavernHelper.generateRaw 函数不存在。请检查酒馆版本。');
      }
      const response = await generateRaw_ACU({
        ordered_prompts: messages,
        should_stream: settings_ACU.streamingEnabled || false,
      });
      if (typeof response !== 'string') {
        throw new Error('主API调用未返回预期的文本响应。');
      }
      return response.trim();
    } else {
      if (!effectiveApiConfig.url || !effectiveApiConfig.model) {
        throw new Error('自定义API的URL或模型未配置。');
      }

      const requestBody = buildCustomApiRequestBody_ACU(messages, effectiveApiConfig);


      const response = await fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: { ...getHostRequestHeaders_ACU(), 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: abortSignal,
      });

      if (!response.ok) {
        const errTxt = await response.text();
        throw new Error(`API请求失败: ${response.status} ${errTxt}`);
      }

      const content = await handleApiResponse_ACU(response, abortSignal);
      if (content) {
        return content.trim();
      }

      throw new Error(`API调用返回无效响应`);
    }
}

export async function callApi_ACU(messages: any[], apiSettings: any, abortSignal: AbortSignal | null = null) {
    // [新增] 获取剧情推进使用的API配置（支持API预设）
    const apiPresetConfig = getApiConfigByPreset_ACU(settings_ACU.plotApiPreset);
    const effectiveApiMode = apiPresetConfig.apiMode;
    const effectiveApiConfig = apiPresetConfig.apiConfig;


    logDebug_ACU(`[剧情推进] 使用API预设: ${settings_ACU.plotApiPreset || '当前配置'}, 模式: ${effectiveApiMode}`);

    if (effectiveApiMode === 'tavern' || effectiveApiConfig.useMainApi) {
      // 使用主API或酒馆预设（流式传输）
      logDebug_ACU('[剧情推进] 通过酒馆主API发送请求（流式传输）...');
      if (!isGenerateRawAvailable_ACU()) {
        throw new Error('TavernHelper.generateRaw 函数不存在。请检查酒馆版本。');
      }
      const response = await generateRaw_ACU({
        ordered_prompts: messages,
        should_stream: settings_ACU.streamingEnabled || false,
      });
      if (typeof response !== 'string') {
        throw new Error('主API调用未返回预期的文本响应。');
      }
      return response.trim();
    } else {
      // 使用自定义API（流式传输）
      if (!effectiveApiConfig.url || !effectiveApiConfig.model) {
        throw new Error('自定义API的URL或模型未配置。');
      }

      const requestBody = buildCustomApiRequestBody_ACU(messages, effectiveApiConfig);

      const response = await fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: { ...getHostRequestHeaders_ACU(), 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: abortSignal,
      });


      if (!response.ok) {
        const errTxt = await response.text();
        throw new Error(`API请求失败: ${response.status} ${errTxt}`);
      }

      // 根据streamingEnabled设置选择响应处理方式
      const content = await handleApiResponse_ACU(response, abortSignal);
      if (content) {
        return content.trim();
      }


      throw new Error(`API调用返回无效响应`);
    }
}


export function getApiConfigByPreset_ACU(presetName: string) {
    // 委托 service 单一权威解析：空名返回当前配置；悬挂引用返回 resolved=false 并告警。
    const resolved = resolveApiConfigByPreset_ACU(presetName);
    return {
      apiMode: resolved.apiMode,
      apiConfig: resolved.apiConfig,
      tavernProfile: resolved.tavernProfile,
    };
}


export async function callCustomOpenAI_ACU_Direct(messages: any[]) {
      // Reuse the logic from callCustomOpenAI_ACU but bypass the prompt replacement part
      // ... For brevity, I will just call callCustomOpenAI_ACU with a hacked dynamicContent?
      // No, callCustomOpenAI_ACU relies on settings_ACU.charCardPrompt.
      // I should refactor callCustomOpenAI_ACU to accept direct messages, or duplicate the API calling part.

      // Duplicating API calling logic for safety and isolation
      if (settings_ACU.apiMode === 'tavern') {
          const profileId = settings_ACU.tavernProfile;
          return await sendConnectionManagerRequest_ACU(
                profileId, messages, settings_ACU.apiConfig.max_tokens ?? settings_ACU.apiConfig.maxTokens ?? 4096
          ).then(r => r.result.choices[0].message.content);
      } else {
          // Custom API（流式传输）
          if (settings_ACU.apiConfig.useMainApi) {
             return await generateRaw_ACU({ ordered_prompts: messages, should_stream: settings_ACU.streamingEnabled || false });
          } else {
             const requestBody = buildCustomApiRequestBody_ACU(messages, settings_ACU.apiConfig, { stripModelPrefix: false });
             const res = await fetch('/api/backends/chat-completions/generate', { method: 'POST', headers: {...getHostRequestHeaders_ACU(), 'Content-Type': 'application/json'}, body: JSON.stringify(requestBody) });
             // 根据streamingEnabled设置选择响应处理方式
             const content = await handleApiResponse_ACU(res);
             return content;
          }
      }
  }


/**
 * 通用 AI 调用（支持指定 API 预设名称）
 * 供 service 层内部使用，替代通过 topLevelWindow_ACU.AutoCardUpdaterAPI.callAI 的循环调用。
 * @param messages 消息数组 [{ role, content }]
 * @param presetName API 预设名称（空字符串表示使用当前配置）
 * @param maxTokensOverride 可选的最大 token 数覆盖，仅允许公开层传入经校验的安全值
 * @returns AI 响应文本，失败返回 null
 */
export async function callAIWithPreset_ACU(messages: any[], presetName: string = '', maxTokensOverride?: number, signal?: AbortSignal | null): Promise<string | null> {
    if (!Array.isArray(messages) || messages.length === 0) {
        logWarn_ACU('[callAIWithPreset] messages 必须是非空数组');
        return null;
    }

    const apiPresetConfig = getApiConfigByPreset_ACU(presetName);
    const effectiveApiMode = apiPresetConfig.apiMode;
    const effectiveApiConfig = apiPresetConfig.apiConfig || {} as any;
    const effectiveTavernProfile = apiPresetConfig.tavernProfile;
    const maxTokens = maxTokensOverride ?? effectiveApiConfig.max_tokens ?? effectiveApiConfig.maxTokens ?? 4096;


    logDebug_ACU(`[callAIWithPreset] 调用 AI，消息数=${messages.length}，预设=${presetName || '当前配置'}，模式=${effectiveApiMode}`);

    if (effectiveApiMode === 'tavern') {
        const profileId = effectiveTavernProfile || settings_ACU.tavernProfile;
        const response = await sendConnectionManagerRequest_ACU(profileId, messages, maxTokens);
        assertNotAborted_ACU(signal);
        if (response?.result?.choices?.[0]?.message?.content) {
            return response.result.choices[0].message.content;
        }
        if (response && typeof response.content === 'string') {
            return response.content;
        }
        logWarn_ACU('[callAIWithPreset] 酒馆 API 返回无效响应');
        return null;
    }

    if (effectiveApiConfig.useMainApi) {
        if (!isGenerateRawAvailable_ACU()) {
            throw new Error('TavernHelper.generateRaw 函数不存在。请检查酒馆版本。');
        }
        const response = await generateRaw_ACU({
            ordered_prompts: messages,
            should_stream: settings_ACU.streamingEnabled || false,
            max_tokens: maxTokens,
        });
        assertNotAborted_ACU(signal);
        return typeof response === 'string' ? response.trim() : null;
    }

    if (!effectiveApiConfig.url || !effectiveApiConfig.model) {
        throw new Error('自定义API的URL或模型未配置。');
    }

    const body = JSON.stringify(buildCustomApiRequestBody_ACU(messages, effectiveApiConfig, { maxTokens, stripModelPrefix: false }));

    const res = await fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: { ...getHostRequestHeaders_ACU(), 'Content-Type': 'application/json' },
        body,
        signal: signal || undefined,
    });

    if (!res.ok) {
        const errTxt = await res.text();
        throw new Error(`API请求失败: ${res.status} ${errTxt}`);
    }

    const content = await handleApiResponse_ACU(res, signal);
    return content ? content.trim() : null;
}

/**
 * Uses a configuration that was already resolved by a caller. This must not look up a preset
 * again, because a fixed preset's fail-closed decision would otherwise race a later fallback.
 */
export interface ResolvedPresetCallLifecycle_ACU {
    beforeMainApiCall?: () => void;
    afterMainApiCall?: () => void;
    /** 响应带回 token 用量时回调（custom 路径解析响应体，tavern 路径机会性解析；useMainApi 路径无用量来源）。 */
    onUsage?: (usage: AiUsageMetadata_ACU) => void;
}

/** callAIWithResolvedPreset_ACU 的请求体附加项。仅 custom（chat-completions）路径生效。 */
export interface ResolvedPresetCallExtras_ACU {
    /** OpenAI 兼容缓存路由 key。稳定的 key 让同一会话的请求落到同一缓存命名空间。 */
    promptCacheKey?: string;
}

/** tavern 模式请求的串行队列尾。/profile 是全局状态，并发切换会互相踩，必须串行「切换→发送→恢复」。 */
let tavernProfileCallTail_ACU: Promise<unknown> = Promise.resolve();

/**
 * 在活动 profile 切换保护下发送一次连接管理器请求，与填表链路（prompt-api-call.ts）行为对齐：
 * 部分宿主后端依赖「当前活动 profile」侧效应，只传 profileId 不切换会落到当前渠道。
 * @param profileId 目标连接预设 ID
 * @param messages 消息序列
 * @param maxTokens 最大输出 token
 * @returns 宿主返回的原始响应
 */
async function sendConnectionManagerRequestWithProfileSwitch_ACU(profileId: string, messages: any[], maxTokens: number): Promise<any> {
    const run = async (): Promise<any> => {
        const targetProfile = getConnectionManagerProfiles_ACU().find(profile => profile.id === profileId);
        if (!targetProfile) throw new Error(`无法找到 ID 为 "${profileId}" 的连接预设。`);
        if (!targetProfile.api) throw new Error(`预设 "${targetProfile.name || targetProfile.id}" 没有配置 API。`);
        const targetProfileName = String(targetProfile.name || targetProfile.id);
        const originalProfile = await triggerSlash_ACU('/profile');
        const needSwitch = !!originalProfile && originalProfile !== targetProfileName;
        try {
            if (needSwitch) {
                await triggerSlash_ACU(`/profile await=true "${targetProfileName.replace(/"/g, '\\"')}"`);
            }
            return await sendConnectionManagerRequest_ACU(profileId, messages, maxTokens);
        } finally {
            if (needSwitch) {
                try {
                    const current = await triggerSlash_ACU('/profile');
                    if (current !== originalProfile) {
                        await triggerSlash_ACU(`/profile await=true "${originalProfile.replace(/"/g, '\\"')}"`);
                    }
                } catch (restoreError) {
                    logWarn_ACU('恢复原酒馆连接预设失败:', restoreError);
                }
            }
        }
    };
    const result = tavernProfileCallTail_ACU.then(run, run);
    tavernProfileCallTail_ACU = result.catch((): undefined => undefined);
    return result;
}

export async function callAIWithResolvedPreset_ACU(
    messages: any[],
    resolved: { apiMode: ApiPresetApiMode_ACU; apiConfig: ApiPresetApiConfig_ACU; tavernProfile: string },
    signal?: AbortSignal | null,
    lifecycle?: ResolvedPresetCallLifecycle_ACU,
    extras?: ResolvedPresetCallExtras_ACU,
): Promise<string | null> {
    if (!Array.isArray(messages) || messages.length === 0) {
        throw new Error('内部 AI 消息必须是非空数组。');
    }
    const reportUsage = (raw: unknown): void => {
        if (!lifecycle?.onUsage) return;
        const usage = extractAiUsageMetadata_ACU(raw);
        if (!usage) return;
        try { lifecycle.onUsage(usage); } catch { /* 用量回调异常不允许影响调用主流程。 */ }
    };
    const maxTokens = resolved.apiConfig.max_tokens ?? resolved.apiConfig.maxTokens ?? 4096;
    if (resolved.apiMode === 'tavern') {
        if (!resolved.tavernProfile) throw new Error('该预设为酒馆连接模式但未选择连接预设。');
        const response = await sendConnectionManagerRequestWithProfileSwitch_ACU(resolved.tavernProfile, messages, maxTokens);
        assertNotAborted_ACU(signal);
        reportUsage(response?.result?.usage);
        if (typeof response?.result?.choices?.[0]?.message?.content === 'string') return response.result.choices[0].message.content.trim();
        if (typeof response?.content === 'string') return response.content.trim();
        return null;
    }
    if (resolved.apiConfig.useMainApi) {
        lifecycle?.beforeMainApiCall?.();
        let operation: Promise<string>;
        try {
            // Only synchronous GENERATION_STARTED delivery can be attributed:
            // the host event has no request ID, so keeping this window open for
            // the whole request would let an unrelated later generation match.
            operation = generateRaw_ACU({ ordered_prompts: messages, should_stream: settings_ACU.streamingEnabled || false, max_tokens: maxTokens });
        } finally {
            lifecycle?.afterMainApiCall?.();
        }
        const response = await operation!;
        assertNotAborted_ACU(signal);
        return typeof response === 'string' ? response.trim() : null;
    }
    if (!resolved.apiConfig.url || !resolved.apiConfig.model) {
        throw new Error('自定义 API 的 URL 或模型未配置。');
    }
    const response = await fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: { ...getHostRequestHeaders_ACU(), 'Content-Type': 'application/json' },
        body: JSON.stringify(buildCustomApiRequestBody_ACU(messages, resolved.apiConfig, {
            maxTokens,
            stripModelPrefix: false,
            promptCacheKey: extras?.promptCacheKey,
            // usage 回调在场时才请求流式 usage chunk：不改变没有订阅方时的请求体。
            includeStreamUsage: !!lifecycle?.onUsage,
        })),
        signal: signal || undefined,
    });
    if (!response.ok) throw new Error(`API 请求失败: ${response.status}`);
    const content = await handleApiResponse_ACU(response, signal, lifecycle?.onUsage);
    return typeof content === 'string' && content.trim() ? content.trim() : null;
}

/**
 * 若 signal 已 abort 则抛出 AbortError，用于宿主 gateway 调用（无法强制中断）返回后立即检查。
 */
function assertNotAborted_ACU(signal?: AbortSignal | null): void {
  if (signal?.aborted) {
    const err = new Error('请求已取消');
    (err as any).name = 'AbortError';
    throw err;
  }
}

