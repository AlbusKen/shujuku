// service/ai/api-call.ts — AI 调用编排（剧情推进用）
// 从 04_shared_helpers.js 迁入

import { parse as parseYaml_ACU } from 'yaml';
import { handleApiResponse_ACU, extractAiUsageMetadata_ACU, type AiUsageMetadata_ACU } from './prompt-builder';
import { readFetchChatTurn_ACU, chatTurnFromJson_ACU, type AiChatTurn_ACU, type AiNativeToolDefinition_ACU } from './native-tool';
export type { AiUsageMetadata_ACU };
import { settings_ACU } from '../runtime/state-manager';
import { isGenerateRawAvailable_ACU, generateRaw_ACU, sendConnectionManagerRequest_ACU, getHostRequestHeaders_ACU, getConnectionManagerProfiles_ACU, triggerSlash_ACU } from '../../data/gateways/ai-gateway';
import { sendCustomApiRequest_ACU } from './custom-api-transport';
import { withApiRequestTimeout_ACU } from './api-request-timeout';
import { isConnectionProfileChatCompletion_ACU, isMainApiChatCompletionAvailable_ACU, readMainApiChatCompletionRouting_ACU, sendMainApiChatCompletionRequest_ACU, sendProfileChatCompletionRequest_ACU } from '../../data/gateways/ai-gateway';
import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { isTauriTavernHost_ACU } from '../../shared/host-detect';
import { supportsExplicitOpenAiCacheKey_ACU } from './prompt-cache';
import { resolveRequestMaxTokens_ACU } from './request-max-tokens';
import { resolveApiConfigByPreset_ACU, normalizeCustomApiFormat_ACU, normalizePromptPostProcessing_ACU, type ApiPresetApiConfig_ACU, type ApiPresetApiMode_ACU } from '../settings/api-preset-service';
import { resolvePlotApiTransport_ACU } from './plot-api-route';

type CustomIncludeBodyRootType_ACU = 'empty' | 'mapping' | 'sequence' | 'scalar' | 'invalid';

export interface CustomIncludeBodyDiagnostic_ACU {
  reason: 'none' | 'parse_error' | 'unsupported_root' | 'stream_options_replaced';
  rootType: CustomIncludeBodyRootType_ACU;
}

/** HTTP failure from the host chat-completions bridge. Keeps status available to retry owners. */
export class AgentApiHttpError_ACU extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'AgentApiHttpError_ACU';
    this.status = status;
  }
}

/** 非空预设名无法解析到真实预设。调用方必须 fail-closed，不得回退当前渠道发请求。 */
export class ApiPresetUnresolvedError_ACU extends Error {
  readonly code = 'API_PRESET_UNRESOLVED' as const;
  readonly presetName: string;

  constructor(presetName: string) {
    super(`API 预设「${presetName}」不存在，请在设置中重新选择`);
    this.name = 'ApiPresetUnresolvedError_ACU';
    this.presetName = presetName;
  }
}

export function isApiPresetUnresolvedError_ACU(error: unknown): error is ApiPresetUnresolvedError_ACU {
  return !!error && typeof error === 'object' && (error as { name?: unknown }).name === 'ApiPresetUnresolvedError_ACU';
}

/** 空名表示用户显式选择当前配置，即使 resolved=false 也不拒绝。 */
export function requireResolvedApiPreset_ACU(presetName: string, config: { resolved?: boolean }): void {
  const name = String(presetName || '').trim();
  if (!name || config.resolved !== false) return;
  throw new ApiPresetUnresolvedError_ACU(name);
}

/** Only transient request failures are safe to retry. Response-content validation stays with callers. */
export function isRetryableAiRequestError_ACU(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: unknown; message?: unknown; status?: unknown };
  const name = String(candidate.name || '');
  const message = String(candidate.message || '');
  const status = Number(candidate.status);
  if (name === 'AbortError') return false;
  if (Number.isFinite(status)) return status === 429 || (status >= 500 && status <= 599);
  if (name === 'TimeoutError') return true;
  if (error instanceof TypeError) return true;
  return /(?:timeout|timed out|network(?:\s+error)?|connection reset|socket hang up)/i.test(message);
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

export function preserveNativeToolPostProcessing_ACU(value: string, hasNativeToolTraffic: boolean): string {
  if (!hasNativeToolTraffic) return value;
  if (value === 'merge') return 'merge_tools';
  if (value === 'semi') return 'semi_tools';
  if (value === 'strict' || value === 'single') return 'strict_tools';
  return value;
}

/**
 * 原版 ST 原生协议源的 reverse_proxy 基址归一化（对齐 ST 自身的 URL 拼接语义）：
 * - claude 源 fetch(apiUrl + '/messages')：基址须含 /v1（ST 官方常量即 https://api.anthropic.com/v1）；
 * - makersuite 源 fetch(`${apiUrl}/${apiVersion}/models/...`)：基址不得带版本段（服务端自补 /v1beta）。
 * 仅剥显式协议路径段（/messages、/v1beta 等防重复），并按 ST 惯例补 /v1，
 * 不改写用户自建代理的其他子路径段（如 https://gw.example.com/claude 视为用户有意为之）。
 */
export function normalizeSTNativeProxyBase_ACU(rawUrl: unknown, nativeSource: 'claude' | 'makersuite'): string {
  let base = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (!base) return '';
  for (const suffix of ['/chat/completions', '/messages', '/responses', '/interactions']) {
    if (base.endsWith(suffix)) { base = base.slice(0, -suffix.length).replace(/\/+$/, ''); break; }
  }
  if (nativeSource === 'claude') {
    if (base.endsWith('/v1beta')) base = base.slice(0, -'/v1beta'.length).replace(/\/+$/, '');
    let path = '';
    try { path = new URL(base).pathname.replace(/\/+$/, ''); } catch { /* 非法 URL 原样透传，交由后端报错 */ }
    if (path === '' || path === '/') return `${base}/v1`;
    if (!base.endsWith('/v1')) return `${base}/v1`;
    return base;
  }
  for (const suffix of ['/v1beta', '/v1']) {
    if (base.endsWith(suffix)) { base = base.slice(0, -suffix.length).replace(/\/+$/, ''); break; }
  }
  return base;
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
    /** 请求级流式快照；未传时保持既有全局开关行为。 */
    streaming?: boolean;
    /** 已完成装配的生成字段，同时进入 custom 上游透传体，不裁剪扩展字段。 */
    generationParameters?: Record<string, unknown>;
    /** 流式请求时注入 stream_options.include_usage，让流末尾下发 usage 统计 chunk。非流式请求忽略。 */
    includeStreamUsage?: boolean;
    /**
     * 注入上游请求体的 response_format（如严格 JSON 填表的 json_schema）。
     * JSON 是 YAML 的子集，序列化为单行后走 custom_include_body 合并进上游请求体；
     * 后端不支持时用户可通过 excludeBodyParams 填 response_format 剔除。
     */
    responseFormat?: Record<string, any>;
    /** OpenAI 兼容 tools。只在调用方明确传入时写入请求体。 */
    tools?: readonly { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }[];
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
  const streaming = opts.streaming ?? (settings_ACU.streamingEnabled || false);
  const userBodyParams = String(effectiveApiConfig.bodyParams || '');
  const pluginFields = Object.assign(Object.create(null), opts.generationParameters) as Record<string, unknown>;
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
    if (opts.generationParameters) {
      throw new Error('数据库 API 的附加请求体无法合并最终生成字段，未发送请求。');
    }
    logWarn_ACU('[buildCustomApiRequestBody] 跳过插件请求体字段', composedIncludeBody.diagnostic);
  } else if (composedIncludeBody.diagnostic.reason === 'stream_options_replaced') {
    logWarn_ACU('[buildCustomApiRequestBody] 用户 stream_options 不是对象，已由插件对象替换', composedIncludeBody.diagnostic);
  }

  // 提示词后处理（custom_prompt_post_processing）改为 API 预设可配置。
  // 背景：此前写死 'strict'，酒馆后端会把提示词中部的 system 消息强制改成 user
  // （prompt-converters.js mergeMessages strict 模式），导致剧情推进等自定义
  // 提示词组里用户指定的 SYSTEM 段在发送时丢失角色。
  // 现在：默认 merge；预设选择具体语义值时透传；
  // 显式选择「未选择」（''）时不携带该字段，后端原样透传消息，
  // 完整保留用户配置的 system/user/assistant 结构。
  // 带原生工具时必须改用 *_tools 变体。strict/merge/semi/single 会删除 tool_calls、
  // tool_call_id，并把 role:tool 改成 user，模型看到的就不再是这条调用的工具结果。
  const hasNativeToolTraffic = Boolean(opts.tools?.length)
    || (Array.isArray(messages) && messages.some(message => message && typeof message === 'object' && (message.role === 'tool' || message.tool_calls)));
  const promptPostProcessing = preserveNativeToolPostProcessing_ACU(
    normalizePromptPostProcessing_ACU(effectiveApiConfig?.promptPostProcessing),
    hasNativeToolTraffic,
  );

  // 接口协议按宿主后端形态分流（同一预设字段 customApiFormat，两种落地方式）：
  // - TauriTavern（Rust 后端）：透传 custom_api_format 契约，按其分流上游端点与请求/响应变形
  //   （openai_compat→/chat/completions、openai_responses→/responses、claude_messages→/messages、
  //   gemini_interactions→/interactions）；非流式响应归一化为 OpenAI 形态，流式 Claude 为原样 Anthropic SSE。
  // - 原版 SillyTavern（Node 后端）：不识别 custom_api_format，改为映射到其内置的原生协议源
  //   （claude_messages→chat_completion_source:'claude'，服务端做 Anthropic 变形并透传原生 SSE，
  //   gemini_interactions→'makersuite'）；openai_compat 维持 custom；
  //   openai_responses 在 ST 无对应后端，回退 custom（/chat/completions）。
  // 调用点可能传未归一化的 config：统一经 api-preset-service 的四值白名单归一化（非法值回退 openai_compat）。
  const customApiFormat = normalizeCustomApiFormat_ACU(effectiveApiConfig?.customApiFormat);
  const isTauriTavern_ACU = isTauriTavernHost_ACU();
  const ST_NATIVE_SOURCE_BY_FORMAT: Record<string, string> = { claude_messages: 'claude', gemini_interactions: 'makersuite' };
  const chatCompletionSource = isTauriTavern_ACU || !ST_NATIVE_SOURCE_BY_FORMAT[customApiFormat]
    ? 'custom'
    : ST_NATIVE_SOURCE_BY_FORMAT[customApiFormat];
  const stNativeSource = (!isTauriTavern_ACU && chatCompletionSource !== 'custom')
    ? (chatCompletionSource as 'claude' | 'makersuite')
    : null;
  const reverseProxy = stNativeSource
    ? normalizeSTNativeProxyBase_ACU(effectiveApiConfig.url, stNativeSource)
    : effectiveApiConfig.url;

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
    reverse_proxy: reverseProxy,
    // 原版 ST 原生协议源（claude/makersuite）从 reverse_proxy+proxy_password 取预设地址与密钥；
    // reverse_proxy 已按 ST 拼接语义归一化（claude 补 /v1、makersuite 剥版本段）。
    // custom 源与 TT 不使用该字段，proxy_password 保持空串。
    proxy_password: stNativeSource
      ? String(effectiveApiConfig.apiKey || '')
      : '',
    custom_url: effectiveApiConfig.url,
    custom_include_headers: headers,
    custom_include_body: composedIncludeBody.value,
    custom_exclude_body: normalizeExcludeBodyParamsForSillyTavern_ACU(effectiveApiConfig.excludeBodyParams),
    // 酒馆转发不强加无工具策略，允许宿主传输扩展挂载并还原工具。
    // 直连保持无工具语义；带工具时由模型自选，显式生成字段仍在最后覆盖。
    ...(opts.tools?.length ? { tools: opts.tools, tool_choice: 'auto' }
      : effectiveApiConfig.sendViaTavern === false ? { tool_choice: 'none' } : {}),
    ...opts.generationParameters,
  };
  if (promptPostProcessing) {
    // 「未选择」（''）时省略该键，酒馆后端（getPromptPostProcessing）按 none 处理，原样透传消息。
    body.custom_prompt_post_processing = promptPostProcessing;
  }

  return body;
}

/**
 * 剧情推进任务级 API 调用 — 接受显式预设名称
 * 调用优先级：presetName 参数 > 全局 plotApiPreset > 当前 API 配置
 */
export async function callApiWithPlotPreset_ACU(messages: any[], presetName?: string, abortSignal: AbortSignal | null = null) {
    // undefined 继承功能选择；显式空名跟随当前配置，不再被固定预设覆盖。
    const effectivePresetName = String(presetName !== undefined ? presetName : (settings_ACU.plotApiPreset || '')).trim();
    const apiPresetConfig = getApiConfigByPreset_ACU(effectivePresetName);
    requireResolvedApiPreset_ACU(effectivePresetName, apiPresetConfig);
    const effectiveApiMode = apiPresetConfig.apiMode ?? settings_ACU.apiMode;
    const effectiveApiConfig = apiPresetConfig.apiConfig || settings_ACU.apiConfig || {};


    logDebug_ACU(`[剧情推进] 任务级API调用，预设: ${effectivePresetName || '当前配置'}, 模式: ${effectiveApiMode}`);


    return withApiRequestTimeout_ACU(effectiveApiConfig, abortSignal, async (abortSignal) => {
    const transport = resolvePlotApiTransport_ACU(effectiveApiMode, effectiveApiConfig);
    if (transport !== 'custom') {
      if (transport === 'main-chat-completion') {
        // Chat Completion 主连接直发生成端点，避开 generateRaw 经过的第三方脚本 fetch 包装。
        return await callMainApiChatCompletionText_ACU(messages, abortSignal);
      }
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


      const response = await sendCustomApiRequest_ACU(effectiveApiConfig, requestBody, abortSignal);

      if (!response.ok) {
        const errTxt = await response.text();
        throw new AgentApiHttpError_ACU(response.status, `API请求失败: ${response.status} ${errTxt}`);
      }

      const content = await handleApiResponse_ACU(response, abortSignal);
      if (content) {
        return content.trim();
      }

      throw new Error(`API调用返回无效响应`);
    }
    });
}

export async function callApi_ACU(messages: any[], apiSettings: any, abortSignal: AbortSignal | null = null) {
    // [新增] 获取剧情推进使用的API配置（支持API预设）
    const plotPresetName = settings_ACU.plotApiPreset || '';
    const apiPresetConfig = getApiConfigByPreset_ACU(plotPresetName);
    requireResolvedApiPreset_ACU(plotPresetName, apiPresetConfig);
    const effectiveApiMode = apiPresetConfig.apiMode;
    const effectiveApiConfig = apiPresetConfig.apiConfig;


    logDebug_ACU(`[剧情推进] 使用API预设: ${settings_ACU.plotApiPreset || '当前配置'}, 模式: ${effectiveApiMode}`);

    return withApiRequestTimeout_ACU(effectiveApiConfig, abortSignal, async (abortSignal) => {
    const transport = resolvePlotApiTransport_ACU(effectiveApiMode, effectiveApiConfig);
    if (transport !== 'custom') {
      // 使用主API或酒馆预设（流式传输）
      if (transport === 'main-chat-completion') {
        // Chat Completion 主连接直发生成端点，避开 generateRaw 经过的第三方脚本 fetch 包装。
        return await callMainApiChatCompletionText_ACU(messages, abortSignal);
      }
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

      const response = await sendCustomApiRequest_ACU(effectiveApiConfig, requestBody, abortSignal);


      if (!response.ok) {
        const errTxt = await response.text();
        throw new AgentApiHttpError_ACU(response.status, `API请求失败: ${response.status} ${errTxt}`);
      }

      // 根据streamingEnabled设置选择响应处理方式
      const content = await handleApiResponse_ACU(response, abortSignal);
      if (content) {
        return content.trim();
      }


      throw new Error(`API调用返回无效响应`);
    }
    });
}


export function getApiConfigByPreset_ACU(presetName: string) {
    // 委托 service 单一权威解析：空名返回当前配置；悬挂引用返回 resolved=false 并告警。
    const resolved = resolveApiConfigByPreset_ACU(presetName);
    return {
      apiMode: resolved.apiMode,
      apiConfig: resolved.apiConfig,
      tavernProfile: resolved.tavernProfile,
      resolved: resolved.resolved,
    };
}


/** 错误正文沿原消费路径记录；读取失败不替换既有 HTTP 异常及重试分类。 */
async function throwApiHttpError_ACU(response: Response): Promise<never> {
    try { await response.text(); } catch { /* 读取诊断由传输日志保留，仍抛原 HTTP 分类。 */ }
    throw new AgentApiHttpError_ACU(response.status, `API 请求失败: ${response.status}`);
}

export async function callCustomOpenAI_ACU_Direct(messages: any[]) {
      // Reuse the logic from callCustomOpenAI_ACU but bypass the prompt replacement part
      // ... For brevity, I will just call callCustomOpenAI_ACU with a hacked dynamicContent?
      // No, callCustomOpenAI_ACU relies on settings_ACU.charCardPrompt.
      // I should refactor callCustomOpenAI_ACU to accept direct messages, or duplicate the API calling part.

      // Duplicating API calling logic for safety and isolation
      return withApiRequestTimeout_ACU(settings_ACU.apiConfig, undefined, async (signal) => {
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
             const res = await sendCustomApiRequest_ACU(settings_ACU.apiConfig, requestBody, signal);
             if (!res.ok) await throwApiHttpError_ACU(res);
             // 根据streamingEnabled设置选择响应处理方式
             const content = await handleApiResponse_ACU(res, signal);
             return content;
          }
      }
      });

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
    requireResolvedApiPreset_ACU(presetName, apiPresetConfig);
    const effectiveApiMode = apiPresetConfig.apiMode;
    const effectiveApiConfig = apiPresetConfig.apiConfig || {} as any;
    const effectiveTavernProfile = apiPresetConfig.tavernProfile;
    const maxTokens = maxTokensOverride ?? effectiveApiConfig.max_tokens ?? effectiveApiConfig.maxTokens ?? 4096;


    logDebug_ACU(`[callAIWithPreset] 调用 AI，消息数=${messages.length}，预设=${presetName || '当前配置'}，模式=${effectiveApiMode}`);

    return withApiRequestTimeout_ACU(effectiveApiConfig, signal, async (signal) => {
    if (effectiveApiMode === 'tavern') {
        const profileId = effectiveTavernProfile || settings_ACU.tavernProfile;
        const directProfile = getConnectionManagerProfiles_ACU().find(item => item.id === profileId);
        if (directProfile && isConnectionProfileChatCompletion_ACU(directProfile)) {
            // Chat Completion 预设直发生成端点：宿主连接管理器经被第三方脚本包装的全局 fetch 发送。
            const raw = await runWithTavernProfile_ACU(profileId, target => sendProfileChatCompletionRequest_ACU(target, toWireMessages_ACU(messages), maxTokens, {}, signal));
            assertNotAborted_ACU(signal);
            const directContent = chatTurnFromJson_ACU(raw).turn.content;
            return directContent ? directContent : null;
        }
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
        if (isMainApiChatCompletionAvailable_ACU()) {
            // Chat Completion 主连接直发生成端点，避开 generateRaw 经过的第三方脚本 fetch 包装。
            const directText = await callMainApiChatCompletionText_ACU(messages, signal, maxTokens);
            return directText || null;
        }
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

    const body = buildCustomApiRequestBody_ACU(messages, effectiveApiConfig, { maxTokens, stripModelPrefix: false });
    const res = await sendCustomApiRequest_ACU(effectiveApiConfig, body, signal);

    if (!res.ok) {
        const errTxt = await res.text();
        throw new AgentApiHttpError_ACU(res.status, `API请求失败: ${res.status} ${errTxt}`);
    }

    const content = await handleApiResponse_ACU(res, signal);
    return content ? content.trim() : null;
    });
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

/** callAIWithResolvedPreset_ACU 的请求级参数；未传时保留普通调用语义。 */
export interface ResolvedPresetCallExtras_ACU {
    /** 酒馆已装配请求中的生成参数，不含模型、路由和鉴权。 */
    generationParameters?: Record<string, unknown>;
    /** 不允许经宿主生成器回退；零层正文只使用带内部标记的直发端口。 */
    requireDirectTransport?: boolean;
    /** 冻结本次数据库 API 的流式开关，避免返回时读取新设置。 */
    streaming?: boolean;
    /** 可选累计正文预览；不代表完整响应或保存成功，不携带工具或私有推理。 */
    onTextPreview?: (body: string) => void;
    /** OpenAI 兼容缓存路由 key。稳定的 key 让同一会话的请求落到同一缓存命名空间。 */
    promptCacheKey?: string;
    /**
     * 本次调用的最大输出 token 下限：预设里的 max_tokens 小于它时抬到该值，大于时沿用预设。
     * 三条路径（tavern / 主 API / custom）都生效。用于总纲、大纲这类输出体量随任务增长的调用。
     */
    minOutputTokens?: number;
    /** 传入后，自定义 chat-completions 请求体会带上 tools。 */
    tools?: readonly AiNativeToolDefinition_ACU[];
}

/** 只校验可独立发送的渠道，不启动生成、切换 profile 或写入聊天。 */
export function assertResolvedPresetDirectTransport_ACU(
    resolved: { apiMode: ApiPresetApiMode_ACU; apiConfig: ApiPresetApiConfig_ACU; tavernProfile: string },
): void {
    if (resolved.apiMode === 'tavern') {
        const profile = getConnectionManagerProfiles_ACU().find(item => item.id === resolved.tavernProfile);
        if (!profile || !isConnectionProfileChatCompletion_ACU(profile)) {
            throw new Error('零层正文需要有效的 Chat Completion 连接预设，未发送请求。');
        }
        return;
    }
    if (resolved.apiConfig.useMainApi) {
        if (!isMainApiChatCompletionAvailable_ACU()) {
            throw new Error('零层正文不支持当前主 API 的宿主生成回退，请选择 Chat Completion 或自定义 API。');
        }
        return;
    }
    if (!resolved.apiConfig.url || !resolved.apiConfig.model) {
        throw new Error('自定义 API 的 URL 或模型未配置。');
    }
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
async function runWithTavernProfile_ACU<T>(profileId: string, action: (profile: any) => Promise<T>): Promise<T> {
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
            return await action(targetProfile);
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
    return withApiRequestTimeout_ACU(resolved.apiConfig, signal, async (signal) => {
    const reportUsage = (raw: unknown): void => {
        if (!lifecycle?.onUsage) return;
        const usage = extractAiUsageMetadata_ACU(raw);
        if (!usage) return;
        try { lifecycle.onUsage(usage); } catch { /* 用量回调异常不允许影响调用主流程。 */ }
    };
    if (extras?.requireDirectTransport) assertResolvedPresetDirectTransport_ACU(resolved);
    const finalMaxTokens = extras?.requireDirectTransport ? extras.generationParameters?.max_tokens : undefined;
    if (finalMaxTokens !== undefined && (typeof finalMaxTokens !== 'number' || !Number.isFinite(finalMaxTokens) || finalMaxTokens <= 0)) {
        throw new Error('最终生成请求的 max_tokens 无效，未发送请求。');
    }
    const maxTokens = typeof finalMaxTokens === 'number'
        ? finalMaxTokens : resolveRequestMaxTokens_ACU(resolved.apiConfig, extras?.minOutputTokens);
    const directOptions = extras?.requireDirectTransport || extras?.streaming !== undefined
        ? {
            streaming: extras?.streaming ?? false,
            preservePayload: extras?.requireDirectTransport === true,
            readResponse: async (response: Response) => {
                const parsed = await readFetchChatTurn_ACU(response, extras?.streaming ?? false, signal, extras?.requireDirectTransport === true, extras?.onTextPreview);
                return { choices: [{ message: { content: parsed.turn.content } }], usage: parsed.usage };
            },
        }
        : undefined;
    const wireMessages = extras?.requireDirectTransport ? messages : toWireMessages_ACU(messages);
    if (resolved.apiMode === 'tavern') {
        if (!resolved.tavernProfile) throw new Error('该预设为酒馆连接模式但未选择连接预设。');
        const profile = getConnectionManagerProfiles_ACU().find(item => item.id === resolved.tavernProfile);
        if (profile && isConnectionProfileChatCompletion_ACU(profile)) {
            // 宿主连接管理器经被第三方脚本包装的全局 fetch 发送；Chat Completion 预设改为直发生成端点。
            const raw = await runWithTavernProfile_ACU(resolved.tavernProfile, target => {
                if (extras?.requireDirectTransport) assertResolvedPresetDirectTransport_ACU(resolved);
                return sendProfileChatCompletionRequest_ACU(target, wireMessages, maxTokens, extras?.generationParameters ?? {}, signal, directOptions);
            });
            assertNotAborted_ACU(signal);
            const parsed = chatTurnFromJson_ACU(raw);
            reportUsage(parsed.usage ?? raw?.usage);
            return parsed.turn.content ? parsed.turn.content.trim() : null;
        }
        const response = await runWithTavernProfile_ACU(resolved.tavernProfile, () => sendConnectionManagerRequest_ACU(resolved.tavernProfile, messages, maxTokens));
        assertNotAborted_ACU(signal);
        reportUsage(response?.result?.usage);
        if (typeof response?.result?.choices?.[0]?.message?.content === 'string') return response.result.choices[0].message.content.trim();
        if (typeof response?.content === 'string') return response.content.trim();
        return null;
    }
    if (resolved.apiConfig.useMainApi) {
        if (isMainApiChatCompletionAvailable_ACU()) {
            // Chat Completion 主连接直发生成端点，避开 generateRaw 经过的脚本 fetch 包装。
            const raw = await sendMainApiChatCompletionRequest_ACU(wireMessages, { ...extras?.generationParameters, max_tokens: maxTokens }, signal, directOptions);
            assertNotAborted_ACU(signal);
            const parsed = chatTurnFromJson_ACU(raw);
            reportUsage(parsed.usage ?? raw?.usage);
            return parsed.turn.content ? parsed.turn.content.trim() : null;
        }
        lifecycle?.beforeMainApiCall?.();
        let operation: Promise<string>;
        try {
            // Only synchronous GENERATION_STARTED delivery can be attributed:
            // the host event has no request ID, so keeping this window open for
            // the whole request would let an unrelated later generation match.
            operation = generateRaw_ACU({ ordered_prompts: messages, should_stream: extras?.streaming ?? (settings_ACU.streamingEnabled || false), max_tokens: maxTokens });
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
    // 内部续写/推演请求绕过第三方脚本对生成端点的 fetch 包装：脚本注入的传输函数
    // 会与本链路的原生工具协议互相污染（见 data/gateways/pristine-fetch.ts）。
    const response = await sendCustomApiRequest_ACU(resolved.apiConfig, {
            ...extras?.generationParameters,
            ...buildCustomApiRequestBody_ACU(messages, resolved.apiConfig, {
                maxTokens,
                temperature: extras?.generationParameters?.temperature as number | undefined,
                topP: extras?.generationParameters?.top_p as number | undefined,
                stripModelPrefix: false,
                streaming: extras?.streaming,
                generationParameters: extras?.requireDirectTransport ? extras.generationParameters : undefined,
                promptCacheKey: supportsExplicitOpenAiCacheKey_ACU(resolved) ? extras?.promptCacheKey : undefined,
                // usage 回调在场时才请求流式 usage chunk：不改变没有订阅方时的请求体。
                includeStreamUsage: !!lifecycle?.onUsage,
            }),
        }, signal);
    if (!response.ok) await throwApiHttpError_ACU(response);
    if (extras?.requireDirectTransport) {
        const parsed = await readFetchChatTurn_ACU(response, extras.streaming ?? false, signal, true, extras.onTextPreview);
        assertNotAborted_ACU(signal);
        reportUsage(parsed.usage);
        return parsed.turn.content.trim() || null;
    }
    const content = await handleApiResponse_ACU(response, signal, lifecycle?.onUsage, extras?.streaming);
    return typeof content === 'string' && content.trim() ? content.trim() : null;
    });
}

/**
 * 经宿主通道（酒馆连接 / 主连接）携带原生工具时的请求体覆盖字段。
 * Agent 需要在多工具与最终文本之间自选，tool_choice 用 auto；
 * strict/merge/semi/single 后处理会剥掉 tool_calls 与 tool 回执，改用对应 *_tools 变体。
 * @param tools 本次挂载的工具；可为空（仅历史含工具回执时）
 * @param rawPostProcessing 通道原本的提示词后处理值
 * @returns overridePayload
 */
function buildHostNativeToolOverridePayload_ACU(tools: readonly AiNativeToolDefinition_ACU[] | undefined, rawPostProcessing: string): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    if (tools?.length) {
        payload.tools = tools;
        payload.tool_choice = 'auto';
    }
    const toolPostProcessing = preserveNativeToolPostProcessing_ACU(rawPostProcessing, true);
    if (toolPostProcessing !== rawPostProcessing) payload.custom_prompt_post_processing = toolPostProcessing;
    return payload;
}

/** 直发生成端点前把 role 归一为小写；其余字段（tool_calls、tool_call_id）原样保留。 */
function toWireMessages_ACU(messages: any[]): any[] {
    return messages.map(message => (
        message && typeof message === 'object' && typeof message.role === 'string' ? { ...message, role: message.role.toLowerCase() } : message
    ));
}

/**
 * Chat Completion 主连接的纯文本请求直发生成端点。
 * 沿宿主发送链保留传输扩展；扩展还原的正文由统一响应解析器读取。
 * 直发路径不触发宿主生成事件，调用方不得再为其登记 GENERATION_ENDED 忽略计数。
 * @param messages 消息序列
 * @param signal 中止信号
 * @param maxTokens 最大输出 token；省略时沿用主连接设置
 * @returns 去首尾空白的回复正文，可能为空串
 */
export async function callMainApiChatCompletionText_ACU(messages: any[], signal?: AbortSignal | null, maxTokens?: number): Promise<string> {
    const raw = await sendMainApiChatCompletionRequest_ACU(toWireMessages_ACU(messages), maxTokens === undefined ? {} : { max_tokens: maxTokens }, signal);
    assertNotAborted_ACU(signal);
    const content = chatTurnFromJson_ACU(raw).turn.content;
    return typeof content === 'string' ? content.trim() : '';
}

/** 与 callAIWithResolvedPreset_ACU 同一条渠道，但保留原生 tool_calls。 */
export async function callAIChatTurn_ACU(
    messages: any[],
    resolved: { apiMode: ApiPresetApiMode_ACU; apiConfig: ApiPresetApiConfig_ACU; tavernProfile: string },
    signal?: AbortSignal | null,
    lifecycle?: ResolvedPresetCallLifecycle_ACU,
    extras?: ResolvedPresetCallExtras_ACU,
): Promise<AiChatTurn_ACU> {
    if (!Array.isArray(messages) || messages.length === 0) throw new Error('内部 AI 消息必须是非空数组。');
    return withApiRequestTimeout_ACU(resolved.apiConfig, signal, async (signal) => {
    const reportUsage = (raw: unknown): void => {
        if (!lifecycle?.onUsage) return;
        const usage = extractAiUsageMetadata_ACU(raw);
        if (!usage) return;
        try { lifecycle.onUsage(usage); } catch { /* 用量回调异常不允许影响调用主流程。 */ }
    };
    const maxTokens = resolveRequestMaxTokens_ACU(resolved.apiConfig, extras?.minOutputTokens);
    // 历史里的 tool_calls / tool 回执即使本次未挂 tools，也要求通道原样保留原生协议。
    const hasNativeToolTraffic = Boolean(extras?.tools?.length)
        || messages.some(message => message && typeof message === 'object' && (message.role === 'tool' || message.tool_calls));
    if (resolved.apiMode === 'tavern') {
        // Chat Completion 预设直发宿主生成端点，保留原生工具及第三方传输扩展。
        // Text Completion 预设无法承载原生工具，fail-closed。
        const profile = getConnectionManagerProfiles_ACU().find(item => item.id === resolved.tavernProfile);
        if (profile && isConnectionProfileChatCompletion_ACU(profile)) {
            const overridePayload = hasNativeToolTraffic
                ? buildHostNativeToolOverridePayload_ACU(extras?.tools, String(profile['prompt-post-processing'] ?? ''))
                : {};
            const raw = await runWithTavernProfile_ACU(resolved.tavernProfile, target => sendProfileChatCompletionRequest_ACU(target, toWireMessages_ACU(messages), maxTokens, overridePayload, signal));
            assertNotAborted_ACU(signal);
            const parsed = chatTurnFromJson_ACU(raw);
            reportUsage(parsed.usage ?? raw?.usage);
            return parsed.turn;
        }
        if (hasNativeToolTraffic) {
            throw new Error('酒馆连接管理器不支持原生工具调用及回执：所选连接预设不是 Chat Completion 类型；请改用 Chat Completion 连接预设或自定义 API。');
        }
        if (!resolved.tavernProfile) throw new Error('该预设为酒馆连接模式但未选择连接预设。');
        const response = await runWithTavernProfile_ACU(resolved.tavernProfile, () => sendConnectionManagerRequest_ACU(resolved.tavernProfile, messages, maxTokens));
        assertNotAborted_ACU(signal);
        const parsed = chatTurnFromJson_ACU(response?.result ?? response);
        reportUsage(parsed.usage ?? response?.result?.usage);
        return parsed.turn.content || parsed.turn.toolCalls.length ? parsed.turn : { content: typeof response?.content === 'string' ? response.content : '', toolCalls: [] as AiChatTurn_ACU['toolCalls'] };
    }
    if (resolved.apiConfig.useMainApi) {
        if (isMainApiChatCompletionAvailable_ACU()) {
            // generateRaw 只返回文本且经被包装的全局 fetch；Chat Completion 主连接按其设置直发生成端点。
            const routing = readMainApiChatCompletionRouting_ACU();
            const overridePayload = {
                ...(hasNativeToolTraffic ? buildHostNativeToolOverridePayload_ACU(extras?.tools, routing.postProcessing) : {}),
                max_tokens: maxTokens,
            };
            const raw = await sendMainApiChatCompletionRequest_ACU(toWireMessages_ACU(messages), overridePayload, signal);
            assertNotAborted_ACU(signal);
            const parsed = chatTurnFromJson_ACU(raw);
            reportUsage(parsed.usage ?? raw?.usage);
            return parsed.turn;
        }
        if (hasNativeToolTraffic) {
            throw new Error('酒馆主 API 无法保证原生工具调用及回执：当前主连接不是 Chat Completion；请切换为 Chat Completion 连接或为 Agent 选择自定义 API。');
        }
        lifecycle?.beforeMainApiCall?.();
        let operation: Promise<string>;
        try {
            operation = generateRaw_ACU({ ordered_prompts: messages, should_stream: settings_ACU.streamingEnabled || false, max_tokens: maxTokens });
        } finally {
            lifecycle?.afterMainApiCall?.();
        }
        const response = await operation!;
        assertNotAborted_ACU(signal);
        return { content: typeof response === 'string' ? response.trim() : '', toolCalls: [] };
    }
    if (!resolved.apiConfig.url || !resolved.apiConfig.model) throw new Error('自定义 API 的 URL 或模型未配置。');
    // 自定义通道同样使用统一发送口，保留原生工具与宿主传输扩展。
    const response = await sendCustomApiRequest_ACU(resolved.apiConfig, buildCustomApiRequestBody_ACU(messages, resolved.apiConfig, {
            maxTokens,
            stripModelPrefix: false,
            promptCacheKey: supportsExplicitOpenAiCacheKey_ACU(resolved) ? extras?.promptCacheKey : undefined,
            includeStreamUsage: !!lifecycle?.onUsage,
            tools: extras?.tools,
        }), signal);
    if (!response.ok) await throwApiHttpError_ACU(response);
    const parsed = await readFetchChatTurn_ACU(response, settings_ACU.streamingEnabled || false, signal);
    reportUsage(parsed.usage);
    return parsed.turn;
    });
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

