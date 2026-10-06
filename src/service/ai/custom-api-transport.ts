import { parse as parseYaml } from 'yaml';
import { pristineFetch_ACU } from '../../data/gateways/pristine-fetch';
import { getHostRequestHeaders_ACU } from '../../data/gateways/ai-gateway';
import { pushLog } from '../../shared/log-buffer';
import { normalizeCustomApiFormat_ACU } from '../settings/api-preset-service';
import { buildProviderRequest_ACU, normalizeProviderReply_ACU, processDirectMessages_ACU, providerEndpoint_ACU, normalizeProviderStream_ACU } from './custom-api-protocol';

let requestId = 0;
const isRecord = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);

/** 附加参数沿用 YAML 对象/对象数组浅合并，排除项在最终协议转换后应用。 */
function includeBody(raw: string): Record<string, any> {
    if (!raw.trim()) return {};
    const parsed = parseYaml(raw);
    if (isRecord(parsed)) return parsed;
    if (Array.isArray(parsed)) return Object.assign(Object.create(null), ...parsed.filter(isRecord));
    throw new Error('直连 API 的附加主体参数必须是 YAML 对象或对象数组，未发送请求。');
}

function exclusions(raw: string): string[] {
    if (!raw.trim()) return [];
    if (raw.trim().startsWith('- ') || raw.trim().startsWith('[')) {
        const parsed = parseYaml(raw);
        if (!Array.isArray(parsed) || parsed.some(key => typeof key !== 'string')) throw new Error('排除主体参数必须是字段名列表。');
        return parsed;
    }
    return raw.split(/[,\n]/).map(key => key.trim()).filter(Boolean);
}

/** 日志不含认证头、URL 查询参数或已知凭据；提示词和回复正文不做长度截断。 */
function redact(text: string, secrets: readonly string[]): string {
    let result = text;
    for (const secret of secrets) if (secret) {
        result = result.split(secret).join('[已隐藏凭据]');
        const escaped = JSON.stringify(secret).slice(1, -1);
        if (escaped !== secret) result = result.split(escaped).join('[已隐藏凭据]');
    }
    return result;
}

function logWire(id: number, phase: string, text: string, secrets: readonly string[]): void {
    pushLog('debug', ['[ACU]', `[API直连] #${id} ${phase}\n${redact(text, secrets)}`], true);
}

/** 统一自定义发送口；关闭酒馆渠道时只访问预设端点，不作隐式回退。 */
export async function sendCustomApiRequest_ACU(
    config: any, bridgeBody: Record<string, any>, signal?: AbortSignal | null,
): Promise<Response> {
    signal?.throwIfAborted();
    if (config.sendViaTavern === true) return pristineFetch_ACU('/api/backends/chat-completions/generate', {
        method: 'POST', headers: { ...getHostRequestHeaders_ACU(), 'Content-Type': 'application/json' },
        body: JSON.stringify(bridgeBody), signal: signal ?? undefined,
    });
    const format = normalizeCustomApiFormat_ACU(config.customApiFormat);
    const base: Record<string, any> = {};
    const bridgeKeys = new Set(['chat_completion_source', 'custom_api_format', 'group_names', 'include_reasoning',
        'reasoning_effort', 'enable_web_search', 'request_images', 'reverse_proxy', 'proxy_password', 'custom_url',
        'custom_include_headers', 'custom_include_body', 'custom_exclude_body', 'custom_prompt_post_processing']);
    for (const [key, value] of Object.entries(bridgeBody)) {
        if (!bridgeKeys.has(key) && value !== undefined) base[key] = value;
    }
    base.messages = processDirectMessages_ACU(base.messages, String(bridgeBody.custom_prompt_post_processing ?? ''));
    const included = includeBody(String(bridgeBody.custom_include_body ?? config.bodyParams ?? ''));
    const body = buildProviderRequest_ACU({ ...base, ...included }, format);
    // 协议原生附加字段在转换后保留；通用字段只由协议转换器写入，不能重新覆盖为旧协议。
    const convertedKeys = new Set(['messages', 'max_tokens', 'tools', 'tool_choice', 'response_format']);
    for (const [key, value] of Object.entries(included)) if (!convertedKeys.has(key)) body[key] = value;
    for (const key of exclusions(String(config.excludeBodyParams ?? ''))) delete body[key];
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (config.apiKey) {
        if (format === 'claude_messages') headers.set('x-api-key', config.apiKey);
        else if (format === 'gemini_interactions') headers.set('x-goog-api-key', config.apiKey);
        else headers.set('Authorization', `Bearer ${config.apiKey}`);
    }
    if (format === 'claude_messages') {
        headers.set('anthropic-version', '2023-06-01');
        headers.set('anthropic-dangerous-direct-browser-access', 'true');
    }
    for (const line of String(config.requestHeaders ?? '').split('\n')) {
        if (!line.trim()) continue;
        const colon = line.indexOf(':');
        if (colon < 1) throw new Error('附加请求标头须按 Header: Value 填写。');
        headers.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
    }
    const url = providerEndpoint_ACU(config.url, format);
    const safeUrl = new URL(url); safeUrl.search = ''; safeUrl.username = ''; safeUrl.password = '';
    const secrets = [String(config.apiKey ?? ''), ...Array.from(headers.entries())
        .filter(([key]) => /authorization|api[-_]?key|token|secret|password|cookie/i.test(key)).map(([, value]) => value),
        ...Array.from(new URL(url).searchParams.values())];
    const id = ++requestId;
    const wire = JSON.stringify(body);
    logWire(id, `请求 ${safeUrl.toString()}`, wire, secrets);
    const response = await pristineFetch_ACU(url, { method: 'POST', headers, body: wire, credentials: 'omit', signal: signal ?? undefined });
    // 在同一消费流上捕获原始回复，避免 clone/tee 的独立读取脱离超时生命周期。
    return captureProviderResponse_ACU(response, format, id, secrets, signal);
}

async function captureProviderResponse_ACU(response: Response, format: ReturnType<typeof normalizeCustomApiFormat_ACU>, id: number, secrets: string[], signal?: AbortSignal | null): Promise<Response> {
    const raw = await response.text();
    signal?.throwIfAborted();
    logWire(id, `回复 HTTP ${response.status}`, raw, secrets);
    if (!response.ok) return new Response(raw, { status: response.status, headers: response.headers });
    const isSse = response.headers.get('content-type')?.includes('text/event-stream');
    const normalized = isSse ? normalizeProviderStream_ACU(raw, format) : JSON.stringify(normalizeProviderReply_ACU(JSON.parse(raw), format));
    return new Response(normalized, { status: response.status, headers: { 'Content-Type': isSse ? 'text/event-stream' : 'application/json' } });
}
