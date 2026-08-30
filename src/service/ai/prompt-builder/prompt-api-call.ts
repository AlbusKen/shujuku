/**
 * service/ai/prompt-builder/prompt-api-call.ts
 * AI API 调用 — prompt 组装 + API 调用 + 流式/非流式响应处理
 * 从 prompt-builder.ts 拆出（L195-L501 + L1519-L1604）
 */
import { currentAbortController_ACU, trackAbortController_ACU, untrackAbortController_ACU, _set_currentAbortController_ACU } from '../../runtime/state-manager';
import { getApiConfigByPreset_ACU, buildCustomApiRequestBody_ACU } from '../api-call';
import { currentJsonTableData_ACU, settings_ACU } from '../../runtime/state-manager';
import { getPersonaDescription_ACU, getCharDescription_ACU } from '../../../data/gateways/host-state-gateway';
import { isGenerateRawAvailable_ACU, generateRaw_ACU, sendConnectionManagerRequest_ACU, triggerSlash_ACU, getConnectionManagerProfiles_ACU, getHostRequestHeaders_ACU } from '../../../data/gateways/ai-gateway';
import { logDebug_ACU, logError_ACU, logWarn_ACU, normalizeExcludeRules_ACU } from '../../../shared/utils';
import { applyExcludeRulesToText_ACU, getLatestAIMessageContent_ACU, getPlotFromHistory_ACU, parseIfBlocksInContent_ACU, parseRandomTags_ACU, replaceRandomVariables_ACU } from '../../runtime/helpers-remaining';
import { replaceDbSqlVariables } from '../../runtime/template-vars/sql-query-var';
import { DEFAULT_CHAR_CARD_PROMPT_STRICT_JSON_ACU, DEFAULT_CHAR_CARD_PROMPT_SQL_STRICT_JSON_ACU } from '../../../shared/defaults-json.js';
import { isSqliteMode } from '../../table/storage-mode';
import { buildStrictJsonTableFillResponseFormatForData_ACU, cloneStrictPromptSegments_ACU } from './strict-json-table-fill';

/**
 * The request reached a provider successfully, but its body contained no
 * usable model output. This is retryable without treating configuration,
 * authentication, or transport failures as model-output failures.
 */
export class RetryableAiResponseError_ACU extends Error {
  readonly code = 'empty_or_invalid_api_response';

  constructor(message = 'API响应格式不正确或内容为空。') {
    super(message);
    this.name = 'RetryableAiResponseError';
  }
}

  function normalizeRoleForApi_ACU(role: any) {
    const ru = String(role || '').toUpperCase();
    const rl = String(role || '').toLowerCase();
    if (ru === 'AI' || ru === 'ASSISTANT' || rl === 'assistant') return 'assistant';
    if (ru === 'SYSTEM' || rl === 'system') return 'system';
    if (ru === 'USER' || rl === 'user') return 'user';
    return 'user';
  }

  const STRICT_JSON_PROMPT_LEGACY_TOKEN_DENYLIST_ACU = [
    'insertRow',
    'updateRow',
    'deleteRow',
    'tableId',
    'rowIndex',
  ];

  function warnIfStrictJsonPromptPolluted_ACU(messages: Array<{ role: string; content: string }>) {
    const hits = new Set<string>();
    messages.forEach((message) => {
      const content = String(message?.content || '');
      STRICT_JSON_PROMPT_LEGACY_TOKEN_DENYLIST_ACU.forEach((token) => {
        if (content.includes(token)) hits.add(token);
      });
    });
    if (hits.size > 0) {
      logWarn_ACU(`[严格JSON填表] strict prompt 中检测到 legacy 协议关键词污染：${Array.from(hits).join(', ')}`);
    }
  }

  export async function callCustomOpenAI_ACU(dynamicContent: any, abortController: AbortController | null = null, options: any = null) {
    const localAbortController = abortController || new AbortController();
    _set_currentAbortController_ACU(localAbortController);
    trackAbortController_ACU(localAbortController);
    const abortSignal = localAbortController.signal;
    const skipProfileSwitch = !!options?.skipProfileSwitch;
    const forceDirectApi = !!options?.forceDirectApi;

    const effectiveTableApiPreset = options?.tableApiPreset !== undefined
        ? String(options.tableApiPreset)
        : (settings_ACU.tableApiPreset || '');
    const apiPresetConfig = getApiConfigByPreset_ACU(effectiveTableApiPreset);
    const effectiveApiMode = apiPresetConfig.apiMode;
    const effectiveApiConfig = apiPresetConfig.apiConfig;
    const effectiveTavernProfile = apiPresetConfig.tavernProfile;

    const messages: Array<{ role: string; content: string }> = [];
    const strictJsonFillEnabled = settings_ACU.strictJsonTableFillEnabled === true;
    const sqliteMode = isSqliteMode();
    const charCardPromptSetting = strictJsonFillEnabled
        ? (sqliteMode
            ? cloneStrictPromptSegments_ACU(settings_ACU.strictJsonSqlCharCardPrompt, DEFAULT_CHAR_CARD_PROMPT_SQL_STRICT_JSON_ACU)
            : cloneStrictPromptSegments_ACU(settings_ACU.strictJsonCharCardPrompt, DEFAULT_CHAR_CARD_PROMPT_STRICT_JSON_ACU))
        : settings_ACU.charCardPrompt;

    let promptSegments = [];
    if (Array.isArray(charCardPromptSetting)) {
        promptSegments = charCardPromptSetting;
    } else if (typeof charCardPromptSetting === 'string') {
        promptSegments = [{ role: 'USER', content: charCardPromptSetting }];
    }

    let userInfoContent_Table = '';
    try {
      userInfoContent_Table = getPersonaDescription_ACU();
      logDebug_ACU(`[填表] $U (persona_description) 获取结果: ${userInfoContent_Table ? '成功' : '为空'}`);
    } catch (e) {
      logWarn_ACU('[填表] 获取用户设定描述时出错:', e);
      userInfoContent_Table = '';
    }

    let charInfoContent_Table = '';
    try {
      charInfoContent_Table = getCharDescription_ACU();
      logDebug_ACU(`[填表] $C (char_description) 获取结果: ${charInfoContent_Table ? '成功，长度=' + charInfoContent_Table.length : '为空'}`);
    } catch (e) {
      logWarn_ACU('[填表] 获取角色描述时出错:', e);
      charInfoContent_Table = '';
    }

    const lastPlotContent = getPlotFromHistory_ACU();
    logDebug_ACU('[填表] $6 上轮规划数据:', lastPlotContent ? `长度=${lastPlotContent.length}` : '(空)');

    const tableExcludeTags = (settings_ACU.tableContextExcludeTags || '').trim();
    const tableExcludeRules = normalizeExcludeRules_ACU(settings_ACU.tableContextExcludeRules, tableExcludeTags);
    const filterTableInjectedContent = (value: any, placeholderKey = '') => {
        const text = value !== undefined && value !== null ? String(value) : '';
        if (!['$0', '$1', '$4', '$6', '$8', '$9', '$U', '$C'].includes(placeholderKey)) return text;
        return applyExcludeRulesToText_ACU(text, { excludeRules: tableExcludeRules, excludeTags: tableExcludeTags });
    };

    for (const segment of promptSegments) {
        let finalContent = segment.content;
        finalContent = finalContent.replace('$0', filterTableInjectedContent(dynamicContent.tableDataText, '$0'));
        finalContent = finalContent.replace('$1', filterTableInjectedContent(dynamicContent.messagesText, '$1'));
        finalContent = finalContent.replace('$4', filterTableInjectedContent(dynamicContent.worldbookContent, '$4'));
        finalContent = finalContent.replace(/\$6/g, filterTableInjectedContent(lastPlotContent || '', '$6'));
        finalContent = finalContent.replace('$8', filterTableInjectedContent(dynamicContent.manualExtraHint || '', '$8'));
        finalContent = finalContent.replace(/\$9/g, filterTableInjectedContent(dynamicContent.worldbookDatabaseExcludedContent || '', '$9'));
        finalContent = finalContent.replace(/\$U/g, filterTableInjectedContent(userInfoContent_Table, '$U'));
        finalContent = finalContent.replace(/\$C/g, filterTableInjectedContent(charInfoContent_Table, '$C'));

        if (typeof dynamicContent?.resolveTableWorldbookContent === 'function') {
          const tableTokens: Array<{ raw: string; tableName: string }> = [];
          const seenTableTokens = new Set<string>();
          for (const match of finalContent.matchAll(/\{\{([^{}]+)\}\}/g)) {
            const raw = String(match[0] || '');
            if (!raw || seenTableTokens.has(raw)) continue;
            seenTableTokens.add(raw);
            tableTokens.push({ raw, tableName: String(match[1] || '') });
          }
          for (const token of tableTokens) {
            try {
              const resolvedContent = await dynamicContent.resolveTableWorldbookContent(token.tableName);
              if (typeof resolvedContent === 'string') {
                finalContent = finalContent.split(token.raw).join(resolvedContent);
              }
            } catch (error) {
              logWarn_ACU(`[填表] 无法解析表名占位符 "${token.tableName}"，保留原 token。`, error);
            }
          }
        }

        if (typeof (globalThis as any).EjsTemplate?.evalTemplate === 'function') {
          try {
            finalContent = await (globalThis as any).EjsTemplate.evalTemplate(finalContent);
            logDebug_ACU('[填表] 已通过 st-prompt-template 处理提示词');
          } catch (e) {
            logWarn_ACU('[填表] st-prompt-template 处理失败，使用原始内容:', e);
          }
        }

        finalContent = parseRandomTags_ACU(finalContent);
        finalContent = replaceRandomVariables_ACU(finalContent);

        // [P4] {[db...]}/{[sql...]} 值替换（SQLite 模式下，在 <if> 之前执行）
        finalContent = replaceDbSqlVariables(finalContent);

        if (settings_ACU.promptTemplateSettings?.enabled !== false) {
          // 填表条件必须与本次 $1 实际读取的 AI 上下文一致，不能越过批次边界读取聊天最新层。
          const conditionalSeedContent = typeof dynamicContent?.conditionalSeedContent === 'string'
            ? dynamicContent.conditionalSeedContent
            : getLatestAIMessageContent_ACU();
          const templateContext = {
            seedContent: conditionalSeedContent,
            allTablesJson: currentJsonTableData_ACU,
            plotContent: lastPlotContent || ''
          };
          finalContent = parseIfBlocksInContent_ACU(finalContent, templateContext, 0);
        }
        
        messages.push({ role: normalizeRoleForApi_ACU(segment.role), content: finalContent });
    }

    if (strictJsonFillEnabled) {
        warnIfStrictJsonPromptPolluted_ACU(messages);
    }

    // 严格 JSON 填表：构建 json_schema response_format，让支持 structured outputs 的后端
    // 在协议层强制输出结构，而不是只靠提示词软约束。
    // 仅自定义 chat-completions 直连路径能携带（经 custom_include_body 合并进上游请求体）；
    // tavern 连接预设与主 API（generateRaw）无请求体扩展通道，维持提示词约束。
    // 后端不支持 response_format 时，用户可在 excludeBodyParams 中填 response_format 剔除。
    let strictJsonResponseFormat: Record<string, any> | undefined;
    if (strictJsonFillEnabled) {
        try {
            strictJsonResponseFormat = buildStrictJsonTableFillResponseFormatForData_ACU(
                sqliteMode,
                options?.tableData,
                options?.targetSheetKeys,
            ).responseFormat;
        } catch (error) {
            // schema 构建失败不阻断填表：回退到纯提示词约束。
            logWarn_ACU('[严格JSON填表] response_format schema 构建失败，本次请求不附加：', error);
        }
    }

    logDebug_ACU('Final messages array being sent to API:', messages);
    logDebug_ACU(`使用API预设: ${effectiveTableApiPreset || '当前配置'}, 模式: ${effectiveApiMode}`);

    try {
        if (effectiveApiMode === 'tavern') {
        if (strictJsonResponseFormat) {
            logDebug_ACU('[严格JSON填表] 酒馆连接预设路径无请求体扩展通道，response_format 未附加，仅靠提示词约束。');
        }
        const profileId = effectiveTavernProfile;
        if (!profileId) {
            throw new Error('未选择酒馆连接预设。');
        }
            if (skipProfileSwitch) {
                logDebug_ACU('ACU: 并发模式启用，跳过酒馆预设切换。');
            }

        let originalProfile = '';
        let responsePromise;
        let rawResult;

        try {
            if (!skipProfileSwitch) {
                originalProfile = await triggerSlash_ACU('/profile');
            }
            const targetProfile = getConnectionManagerProfiles_ACU().find(p => p.id === profileId);

            if (!targetProfile) {
                throw new Error(`无法找到ID为 "${profileId}" 的连接预设。`);
            }
            if (!targetProfile.api) {
                throw new Error(`预设 "${targetProfile.name || targetProfile.id}" 没有配置API。`);
            }
            if (!targetProfile.preset) {
                throw new Error(`预设 "${targetProfile.name || targetProfile.id}" 没有选择预设。`);
            }

            const targetProfileName = targetProfile.name || targetProfile.id;
            if (!skipProfileSwitch) {
                const currentProfile = await triggerSlash_ACU('/profile');

                if (currentProfile !== targetProfileName) {
                    const escapedProfileName = targetProfileName.replace(/"/g, '\\"');
                    await triggerSlash_ACU(`/profile await=true "${escapedProfileName}"`);
                }
            }
            
            logDebug_ACU(`ACU: 通过酒馆连接预设 (ID: ${profileId}, Name: ${targetProfileName}) 发送请求...`);

            responsePromise = sendConnectionManagerRequest_ACU(
                profileId, 
                messages, 
                effectiveApiConfig.max_tokens ?? effectiveApiConfig.maxTokens ?? 4096
            );

            rawResult = await responsePromise;

        } catch (error) {
            logError_ACU(`ACU: 调用酒馆连接预设时出错:`, error);
            try {
                if (originalProfile && !skipProfileSwitch) {
                    const currentProfileAfterCall = await triggerSlash_ACU('/profile');
                    if (originalProfile !== currentProfileAfterCall) {
                        const escapedOriginalProfile = originalProfile.replace(/"/g, '\\"');
                        await triggerSlash_ACU(`/profile await=true "${escapedOriginalProfile}"`);
                        logDebug_ACU(`ACU: 已恢复原酒馆连接预设: "${originalProfile}"`);
                    }
                }
            } catch (restoreError) {
                logError_ACU(`ACU: 恢复原预设时出错:`, restoreError);
            }
            throw new Error(`API请求失败 (酒馆预设): ${error.message}`);
        } finally {
            if (rawResult !== undefined) {
                try {
                    if (!skipProfileSwitch) {
                        const currentProfileAfterCall = await triggerSlash_ACU('/profile');
                        if (originalProfile && originalProfile !== currentProfileAfterCall) {
                            const escapedOriginalProfile = originalProfile.replace(/"/g, '\\"');
                            await triggerSlash_ACU(`/profile await=true "${escapedOriginalProfile}"`);
                            logDebug_ACU(`ACU: 已恢复原酒馆连接预设: "${originalProfile}"`);
                        }
                    }
                } catch (restoreError) {
                    logError_ACU(`ACU: 恢复原预设时出错:`, restoreError);
                }
            }
        }

        if (rawResult && rawResult.ok && rawResult.result?.choices?.[0]?.message?.content) {
            return rawResult.result.choices[0].message.content.trim();
        } else if (rawResult && typeof rawResult.content === 'string') {
            return rawResult.content.trim();
        } else {
            const errorMsg = rawResult?.error || JSON.stringify(rawResult);
            throw new Error(`酒馆预设API调用返回无效响应: ${errorMsg}`);
        }

    } else {
        if (effectiveApiConfig.useMainApi && !forceDirectApi) {
            logDebug_ACU('ACU: 通过酒馆主API发送请求（流式传输）...');
            if (strictJsonResponseFormat) {
                logDebug_ACU('[严格JSON填表] 主 API（generateRaw）路径无请求体扩展通道，response_format 未附加，仅靠提示词约束。');
            }
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
            if (forceDirectApi && effectiveApiConfig.useMainApi) {
                if (effectiveApiConfig.url && effectiveApiConfig.model) {
                    logDebug_ACU('ACU: 并发模式启用，强制使用独立API路径。');
                } else {
                    logWarn_ACU('ACU: 并发模式要求独立API，但URL或模型未配置，回退主API。');
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
                }
            }
            if (!effectiveApiConfig.url || !effectiveApiConfig.model) {
                throw new Error('自定义API的URL或模型未配置。');
            }
            const generateUrl = `/api/backends/chat-completions/generate`;
            
            const headers = { ...getHostRequestHeaders_ACU(), 'Content-Type': 'application/json' };
            
            const body = JSON.stringify(buildCustomApiRequestBody_ACU(messages, effectiveApiConfig, {
                stripModelPrefix: false,
                responseFormat: strictJsonResponseFormat,
            }));
            if (strictJsonResponseFormat) {
                logDebug_ACU('[严格JSON填表] 已在请求体附加 json_schema response_format。');
            }
            
            logDebug_ACU('ACU: 调用新的后端生成API:', generateUrl, 'Model:', effectiveApiConfig.model);
            const response = await fetch(generateUrl, { method: 'POST', headers, body, signal: abortSignal });
            
            if (!response.ok) {
              const errTxt = await response.text();
              throw new Error(`API请求失败: ${response.status} ${errTxt}`);
            }
            
            const content = await handleApiResponse_ACU(response, abortSignal);
            if (content) {
                return content.trim();
            }
            throw new RetryableAiResponseError_ACU();
        }
        }
    } finally {
        untrackAbortController_ACU(localAbortController);
        if (currentAbortController_ACU === localAbortController) {
            _set_currentAbortController_ACU(null);
        }
    }
  }

  // ═══ 流式/非流式响应处理 ═══

  /**
   * 一次 AI 调用实际报告的 token 用量。
   * 字段缺失表示提供商未报告，明确的 0 表示提供商报告该项为 0。
   */
  export interface AiUsageMetadata_ACU {
    promptTokens?: number;
    completionTokens?: number;
    /** 命中厂商 prompt 缓存的输入 token 数，通常包含在 promptTokens 内。 */
    cachedTokens?: number;
    /** 厂商报告的缓存写入 token 数。 */
    cacheWriteTokens?: number;
  }

  function toUsageCount_ACU(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0
      ? value
      : undefined;
  }

  function firstUsageCount_ACU(...values: unknown[]): number | undefined {
    for (const value of values) {
      const count = toUsageCount_ACU(value);
      if (count !== undefined) return count;
    }
    return undefined;
  }

  /** 后出现的已定义字段覆盖先前值；缺失字段不得擦除已经报告的计数。 */
  function mergeAiUsageMetadata_ACU(
    current: AiUsageMetadata_ACU | null,
    incoming: AiUsageMetadata_ACU | null,
  ): AiUsageMetadata_ACU | null {
    if (!incoming) return current;
    const merged: AiUsageMetadata_ACU = current ? { ...current } : {};
    if (incoming.promptTokens !== undefined) merged.promptTokens = incoming.promptTokens;
    if (incoming.completionTokens !== undefined) merged.completionTokens = incoming.completionTokens;
    if (incoming.cachedTokens !== undefined) merged.cachedTokens = incoming.cachedTokens;
    if (incoming.cacheWriteTokens !== undefined) merged.cacheWriteTokens = incoming.cacheWriteTokens;
    return merged;
  }

  /** 同一响应中先合并 usage，再由 usageMetadata 的已定义字段覆盖。 */
  function extractResponseUsageMetadata_ACU(raw: any): AiUsageMetadata_ACU | null {
    return mergeAiUsageMetadata_ACU(
      extractAiUsageMetadata_ACU(raw?.usage),
      extractAiUsageMetadata_ACU(raw?.usageMetadata),
    );
  }

  /**
   * 从 OpenAI、Anthropic、DeepSeek 或 Gemini 兼容 usage 对象提取统一用量。
   * 只接受非负有限整数；字段缺失或非法时保持未报告，显式 0 会被保留。
   * @param raw 响应里的 usage 或 usageMetadata 对象
   * @returns 统一用量；raw 不含任何有效计数时返回 null
   */
  export function extractAiUsageMetadata_ACU(raw: any): AiUsageMetadata_ACU | null {
    if (!raw || typeof raw !== 'object') return null;
    const promptTokens = firstUsageCount_ACU(raw.prompt_tokens, raw.input_tokens, raw.promptTokenCount);
    const completionTokens = firstUsageCount_ACU(raw.completion_tokens, raw.output_tokens, raw.candidatesTokenCount);
    const cachedTokens = firstUsageCount_ACU(
      raw.prompt_tokens_details?.cached_tokens,
      raw.input_tokens_details?.cached_tokens,
      raw.cache_read_input_tokens,
      raw.prompt_cache_hit_tokens,
      raw.cachedContentTokenCount,
    );
    const cacheWriteTokens = firstUsageCount_ACU(
      raw.cache_creation_input_tokens,
      raw.cache_write_input_tokens,
      raw.cache_write_tokens,
    );

    const usage: AiUsageMetadata_ACU = {};
    if (promptTokens !== undefined) usage.promptTokens = promptTokens;
    if (completionTokens !== undefined) usage.completionTokens = completionTokens;
    if (cachedTokens !== undefined) usage.cachedTokens = cachedTokens;
    if (cacheWriteTokens !== undefined) usage.cacheWriteTokens = cacheWriteTokens;
    return Object.keys(usage).length ? usage : null;
  }

  async function streamToText_ACU(response: any, signal: AbortSignal | null = null, onUsage?: (usage: AiUsageMetadata_ACU) => void) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let buffer = '';
    // usage 出现在流末尾的独立 chunk（choices 为空数组），需开启 stream_options.include_usage 才会下发。
    let capturedUsage: AiUsageMetadata_ACU | null = null;

    try {
        while (true) {
            if (signal?.aborted) {
                throw new Error('Request aborted');
            }
            
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') continue;
                    
                    try {
                        const json = JSON.parse(data);
                        const content = json?.choices?.[0]?.delta?.content;
                        if (content) {
                            fullContent += content;
                        }
                        // Anthropic SSE 分支（接口协议=claude_messages 时后端原样透传 Anthropic 流，不归一化）：
                        // content_block_delta(text_delta).delta.text 拼内容；message_stop 视为流结束（等价 [DONE]）。
                        if (json?.type === 'content_block_delta' && json?.delta?.type === 'text_delta' && typeof json?.delta?.text === 'string') {
                            fullContent += json.delta.text;
                        }
                        // Gemini SSE 分支（接口协议=gemini_interactions 时后端原样透传 generateContent 流）：
                        // candidates[0].content.parts[].text 拼接（跳过 thought 段）；流结束由连接关闭界定。
                        const geminiParts = json?.candidates?.[0]?.content?.parts;
                        if (Array.isArray(geminiParts)) {
                            for (const part of geminiParts) {
                                if (part && typeof part.text === 'string' && part.thought !== true) {
                                    fullContent += part.text;
                                }
                            }
                        }
                        const usage = extractResponseUsageMetadata_ACU(json);
                        capturedUsage = mergeAiUsageMetadata_ACU(capturedUsage, usage);
                    } catch (e) {
                        // 忽略解析错误
                    }
                }
            }
        }
    } finally {
        reader.releaseLock();
    }

    if (capturedUsage && onUsage) {
        try { onUsage(capturedUsage); } catch { /* 用量回调异常不允许影响响应主流程。 */ }
    }
    return fullContent;
  }

  async function parseNonStreamResponse_ACU(response: any, onUsage?: (usage: AiUsageMetadata_ACU) => void) {
    try {
        const data = await response.json();
        const usage = extractResponseUsageMetadata_ACU(data);
        if (usage && onUsage) {
            try { onUsage(usage); } catch { /* 用量回调异常不允许影响响应主流程。 */ }
        }
        if (data?.choices?.[0]?.message?.content) {
            return data.choices[0].message.content;
        }
        if (data?.content) {
            return data.content;
        }
        if (typeof data === 'string') {
            return data;
        }
        logError_ACU('[parseNonStreamResponse] Unknown response format:', data);
        return null;
    } catch (e) {
        logError_ACU('[parseNonStreamResponse] Failed to parse response:', e);
        return null;
    }
  }

  export async function handleApiResponse_ACU(response: any, signal: AbortSignal | null = null, onUsage?: (usage: AiUsageMetadata_ACU) => void) {
    if (settings_ACU.streamingEnabled) {
        return await streamToText_ACU(response, signal, onUsage);
    } else {
        return await parseNonStreamResponse_ACU(response, onUsage);
    }
  }
