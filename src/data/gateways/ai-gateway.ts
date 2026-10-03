/**
 * data/gateways/ai-gateway.ts — AI 调用网关
 *
 * 封装 TavernHelper_API_ACU.generateRaw、triggerSlash
 * 以及 SillyTavern_API_ACU.ConnectionManagerRequestService.sendRequest 等 AI 调用方法。
 * service 层通过本模块发起 AI 请求，不再直接调用宿主 API。
 *
 * 所有方法内置存在性检查，宿主 API 不可用时抛出明确错误。
 */

import { TavernHelper_API_ACU, SillyTavern_API_ACU } from '../../shared/host-api';
import { logWarn_ACU } from '../../shared/utils';
import { pristineFetch_ACU } from './pristine-fetch';

// ═══ 可用性检查 ═══

/**
 * 检查 generateRaw 是否可用
 */
export function isGenerateRawAvailable_ACU(): boolean {
    return !!(TavernHelper_API_ACU && typeof TavernHelper_API_ACU.generateRaw === 'function');
}

/**
 * 检查 ConnectionManagerRequestService 是否可用
 */
export function isConnectionManagerAvailable_ACU(): boolean {
    return !!(SillyTavern_API_ACU?.ConnectionManagerRequestService &&
        typeof SillyTavern_API_ACU.ConnectionManagerRequestService.sendRequest === 'function');
}

/**
 * 检查 triggerSlash 是否可用
 */
export function isTriggerSlashAvailable_ACU(): boolean {
    return !!(TavernHelper_API_ACU && typeof TavernHelper_API_ACU.triggerSlash === 'function');
}

// ═══ AI 生成 ═══

/**
 * 通过酒馆主 API 生成文本
 * @param options generateRaw 的参数（ordered_prompts、should_stream 等）
 * @returns 生成的文本
 * @throws 如果 generateRaw 不可用
 */
export async function generateRaw_ACU(options: {
    ordered_prompts: any[];
    should_stream?: boolean;
    [key: string]: any;
}): Promise<string> {
    if (!isGenerateRawAvailable_ACU()) {
        throw new Error('主API生成不可用：未检测到酒馆助手（TavernHelper.generateRaw）。请安装酒馆助手（JS-Slash-Runner），或在设置中改用自定义API。');
    }
    const response = await TavernHelper_API_ACU.generateRaw(options);
    return typeof response === 'string' ? response : String(response ?? '');
}

/**
 * 通过 ConnectionManager 发送请求
 * @param profileId 配置文件 ID
 * @param messages 消息数组
 * @param maxTokens 最大 token 数
 * @returns API 响应结果
 * @throws 如果 ConnectionManagerRequestService 不可用
 */
export async function sendConnectionManagerRequest_ACU(
    profileId: string,
    messages: any[],
    maxTokens: number,
    custom?: Record<string, unknown>,
    overridePayload?: Record<string, unknown>,
): Promise<any> {
    if (!isConnectionManagerAvailable_ACU()) {
        throw new Error('ConnectionManagerRequestService 不可用。请检查酒馆版本或连接管理器配置。');
    }
    const service = SillyTavern_API_ACU.ConnectionManagerRequestService;
    // 未传扩展参数时保持三参调用，旧调用方的请求形态不变。
    if (custom === undefined && overridePayload === undefined) {
        return await service.sendRequest(profileId, messages, maxTokens);
    }
    // 宿主 sendRequest(profileId, prompt, maxTokens, custom, overridePayload)：
    // custom 与默认参数合并（如 extractData:false 返回原始响应）；
    // overridePayload 展开进 Chat Completion 请求体（如 tools、tool_choice）。
    return await service.sendRequest(profileId, messages, maxTokens, custom ?? {}, overridePayload ?? {});
}

/**
 * 判断连接配置是否为 Chat Completion 类型（只有这类配置的请求体能携带原生工具）。
 * 与宿主 ConnectionManagerRequestService.validateProfile 同源：CONNECT_API_MAP[api].selected === 'openai'。
 * 映射表不可用或无法识别时返回 false，调用方回退到不挂工具的正文路径。
 * @param profile 连接配置对象
 * @returns 是否可携带原生工具
 */
export function isConnectionProfileChatCompletion_ACU(profile: any): boolean {
    try {
        const map = (SillyTavern_API_ACU as any)?.CONNECT_API_MAP;
        const entry = map && profile?.api ? map[profile.api] : null;
        return !!entry && entry.selected === 'openai' && !!entry.source;
    } catch {
        return false;
    }
}

/** 这些来源在宿主 sendOpenAIRequest 中才会带上反向代理（openai.js 同名判断）。 */
const MAIN_API_REVERSE_PROXY_SOURCES_ACU = new Set(['claude', 'openai', 'mistralai', 'makersuite', 'vertexai', 'deepseek', 'xai']);

/**
 * 判断酒馆主连接当前是否为 Chat Completion（只有这类连接能携带原生工具并取回 tool_calls）。
 * TavernHelper.generateRaw 只返回文本，且宿主请求服务经被第三方脚本包装的全局 fetch 发送；
 * Chat Completion 主连接的内部请求由本网关组装请求体后直发生成端点。
 * @returns 可用时为 true
 */
export function isMainApiChatCompletionAvailable_ACU(): boolean {
    try {
        const st: any = SillyTavern_API_ACU;
        return !!st && st.mainApi === 'openai' && !!st.chatCompletionSettings;
    } catch {
        return false;
    }
}

/**
 * 读取主连接的来源与提示词后处理，供调用方按工具规则改写后处理变体。
 * @returns 来源标识与后处理值；不可用时均为空串
 */
export function readMainApiChatCompletionRouting_ACU(): { source: string; postProcessing: string } {
    try {
        const oai: any = (SillyTavern_API_ACU as any)?.chatCompletionSettings;
        return { source: String(oai?.chat_completion_source || ''), postProcessing: String(oai?.custom_prompt_post_processing ?? '') };
    } catch {
        return { source: '', postProcessing: '' };
    }
}

function finiteOrUndefined_ACU(value: unknown): number | undefined {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
}

/**
 * 按酒馆主连接当前设置发送一次 Chat Completion 请求，并返回宿主原始响应（含 tool_calls）。
 * 字段取值对齐宿主 sendOpenAIRequest 的 generate_data；overridePayload 最后展开（tools、tool_choice 等）。
 * @param messages 已归一 role 的消息序列
 * @param overridePayload 并入请求体的覆盖字段
 * @param signal 中止信号
 * @returns 宿主返回的原始 JSON
 */
export async function sendMainApiChatCompletionRequest_ACU(
    messages: any[],
    overridePayload: Record<string, unknown>,
    signal?: AbortSignal | null,
): Promise<any> {
    if (!isMainApiChatCompletionAvailable_ACU()) {
        throw new Error('酒馆主 API 当前不是 Chat Completion 连接，无法携带原生工具。');
    }
    const st: any = SillyTavern_API_ACU;
    const oai: any = st.chatCompletionSettings;
    const source = String(oai.chat_completion_source || '');
    const request: Record<string, unknown> = {
        stream: false,
        messages,
        model: typeof st.getChatCompletionModel === 'function' ? st.getChatCompletionModel() : undefined,
        chat_completion_source: source,
        max_tokens: finiteOrUndefined_ACU(oai.openai_max_tokens),
        temperature: finiteOrUndefined_ACU(oai.temp_openai),
        top_p: finiteOrUndefined_ACU(oai.top_p_openai),
        custom_prompt_post_processing: oai.custom_prompt_post_processing,
    };
    if (oai.reverse_proxy && MAIN_API_REVERSE_PROXY_SOURCES_ACU.has(source)) {
        request.reverse_proxy = oai.reverse_proxy;
        request.proxy_password = oai.proxy_password;
    }
    if (source === 'custom') {
        request.custom_url = oai.custom_url;
        request.custom_include_body = oai.custom_include_body;
        request.custom_exclude_body = oai.custom_exclude_body;
        request.custom_include_headers = oai.custom_include_headers;
    }
    if (source === 'claude') request.claude_use_sysprompt = oai.claude_use_sysprompt;
    if (source === 'makersuite' || source === 'vertexai') request.use_makersuite_sysprompt = oai.use_makersuite_sysprompt;
    if (source === 'vertexai') {
        request.vertexai_auth_mode = oai.vertexai_auth_mode;
        request.vertexai_region = oai.vertexai_region;
        request.vertexai_express_project_id = oai.vertexai_express_project_id;
    }
    if (source === 'azure_openai') {
        request.azure_base_url = oai.azure_base_url;
        request.azure_deployment_name = oai.azure_deployment_name;
        request.azure_api_version = oai.azure_api_version;
    }
    return await postChatCompletionDirect_ACU({ ...request, ...overridePayload }, signal);
}

const CHAT_COMPLETION_GENERATE_URL_ACU = '/api/backends/chat-completions/generate';

/**
 * 把组装好的 Chat Completion 请求体直发宿主生成端点，返回原始 JSON（含 tool_calls）。
 * 宿主 ConnectionManagerRequestService / ChatCompletionService 内部经全局 fetch 发送，
 * 会被第三方脚本的生成端点拦截器改写请求体与响应；这里经 pristineFetch 绕过包装。
 * 请求体归一沿用宿主纯函数 ChatCompletionService.createRequestData（不发请求、无副作用）。
 * @param payload 请求体字段
 * @param signal 中止信号
 * @returns 生成端点返回的原始 JSON
 */
export async function postChatCompletionDirect_ACU(payload: Record<string, unknown>, signal?: AbortSignal | null): Promise<any> {
    const service: any = (SillyTavern_API_ACU as any)?.ChatCompletionService;
    const data = typeof service?.createRequestData === 'function' ? service.createRequestData.call(service, payload) : { ...payload };
    // 在宿主归一化之后声明无工具语义，避免默认 auto 让内层 Kemini 接管文本/JSON 请求。
    // 有工具时保留调用方的选择，不强制调用工具，也不剥离未知的宿主发送包装。
    const request = { ...data, stream: false };
    if (!Array.isArray(request.tools) || request.tools.length === 0) request.tool_choice = 'none';
    const response = await pristineFetch_ACU(CHAT_COMPLETION_GENERATE_URL_ACU, {
        method: 'POST',
        headers: { ...getHostRequestHeaders_ACU(), 'Content-Type': 'application/json' },
        cache: 'no-cache',
        body: JSON.stringify(request),
        signal: signal ?? undefined,
    });
    const text = await response.text();
    let json: any = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        throw new Error(`生成端点返回了无法解析的响应（HTTP ${response.status}）。`);
    }
    if (!response.ok || json?.error) {
        const detail = json?.error?.message || (typeof json?.error === 'string' ? json.error : '') || text.slice(0, 300);
        throw new Error(`API 请求失败: HTTP ${response.status}${detail ? ` ${detail}` : ''}`);
    }
    return json;
}

/**
 * 解析连接预设引用的反向代理。宿主代理列表是 openai.js 模块变量，未暴露到 context：
 * 优先读 chatCompletionSettings.proxies；预设正是当前激活连接时，读主连接已应用的代理。
 * 两者都读不到时 fail-closed，避免把请求静默发往默认端点。
 */
function resolveProfileProxy_ACU(profile: any): { url?: string; password?: string } {
    const name = String(profile?.proxy || '');
    if (!name || name === 'None') return {};
    const st: any = SillyTavern_API_ACU;
    const oai: any = st?.chatCompletionSettings;
    const list = Array.isArray(oai?.proxies) ? oai.proxies : [];
    const hit = list.find((preset: any) => preset?.name === name);
    if (hit) return { url: hit.url || undefined, password: hit.password || undefined };
    if (st?.extensionSettings?.connectionManager?.selectedProfile === profile?.id) {
        return { url: oai?.reverse_proxy || undefined, password: oai?.proxy_password || undefined };
    }
    throw new Error(`连接预设 "${profile?.name || profile?.id}" 使用反向代理 "${name}"，但当前无法读取该代理配置；请让该预设处于激活状态后重试，或改用自定义 API。`);
}

/**
 * 按连接预设组装 Chat Completion 请求体并直发生成端点（字段对齐宿主 shared.js 的 sendRequest）。
 * 密钥由后端按当前激活连接读取，调用方需保证目标预设已激活。
 * @param profile 连接预设（须为 Chat Completion 类型）
 * @param messages 已归一 role 的消息序列
 * @param maxTokens 最大输出 token
 * @param overridePayload 并入请求体的覆盖字段（tools、tool_choice 等）
 * @param signal 中止信号
 * @returns 生成端点返回的原始 JSON
 */
export async function sendProfileChatCompletionRequest_ACU(
    profile: any,
    messages: any[],
    maxTokens: number,
    overridePayload: Record<string, unknown>,
    signal?: AbortSignal | null,
): Promise<any> {
    const st: any = SillyTavern_API_ACU;
    const entry = profile?.api ? st?.CONNECT_API_MAP?.[profile.api] : null;
    if (!entry || entry.selected !== 'openai' || !entry.source) {
        throw new Error(`连接预设 "${profile?.name || profile?.id}" 不是 Chat Completion 类型。`);
    }
    const proxy = resolveProfileProxy_ACU(profile);
    let presetPayload: Record<string, unknown> = {};
    try {
        const preset = profile.preset ? st.getPresetManager?.('openai')?.getCompletionPresetByName?.(profile.preset) : null;
        if (preset && typeof st.ChatCompletionService?.presetToGeneratePayload === 'function') {
            presetPayload = st.ChatCompletionService.presetToGeneratePayload(preset, {}) || {};
        }
    } catch (error) {
        logWarn_ACU('[AIGateway] 读取连接预设的生成参数失败，按默认参数发送:', error);
    }
    return await postChatCompletionDirect_ACU({
        ...presetPayload,
        messages,
        max_tokens: maxTokens,
        model: profile.model,
        chat_completion_source: entry.source,
        custom_url: profile['api-url'],
        reverse_proxy: proxy.url,
        proxy_password: proxy.password,
        custom_prompt_post_processing: profile['prompt-post-processing'],
        ...overridePayload,
    }, signal);
}

/**
 * 触发斜杠命令
 * @param command 斜杠命令字符串
 * @returns 命令执行结果
 */
export async function triggerSlash_ACU(command: string): Promise<string> {
    if (!isTriggerSlashAvailable_ACU()) {
        logWarn_ACU('[AIGateway] triggerSlash 不可用，返回空字符串');
        return '';
    }
    return await TavernHelper_API_ACU.triggerSlash(command);
}

// ═══ 配置读取 ═══

/**
 * 获取 ConnectionManager 的配置文件列表
 * @returns 配置文件数组，不可用时返回 []
 */
export function getConnectionManagerProfiles_ACU(): any[] {
    return SillyTavern_API_ACU?.extensionSettings?.connectionManager?.profiles || [];
}

// ═══ 请求认证 ═══

/**
 * 获取宿主平台的 HTTP 请求头（包含 CSRF token 等认证信息）
 * 封装 SillyTavern.getRequestHeaders()，不可用时返回空对象。
 *
 * 注意：主窗口的 window.SillyTavern 只有 {libs, getContext}，
 * getRequestHeaders 在 getContext() 返回的对象里。
 * 所以必须通过 SillyTavern_API_ACU（已被 Proxy 包装）或 getContext() 获取。
 */
export function getHostRequestHeaders_ACU(): Record<string, string> {
    try {
        // 优先通过 SillyTavern_API_ACU（插件模式下已被 Proxy 包装，每次读取走 getContext()）
        if (SillyTavern_API_ACU && typeof (SillyTavern_API_ACU as any).getRequestHeaders === 'function') {
            const headers = (SillyTavern_API_ACU as any).getRequestHeaders();
            if (headers && typeof headers === 'object') return headers;
        }
        // fallback：直接调用 getContext()（覆盖 SillyTavern_API_ACU 尚未初始化的场景）
        const ctx = (globalThis as any).SillyTavern?.getContext?.();
        if (ctx && typeof ctx.getRequestHeaders === 'function') {
            const headers = ctx.getRequestHeaders();
            if (headers && typeof headers === 'object') return headers;
        }
        return {};
    } catch {
        logWarn_ACU('[AIGateway] getRequestHeaders 不可用，返回空对象');
        return {};
    }
}
