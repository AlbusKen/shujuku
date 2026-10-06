import type { CustomApiFormat_ACU } from '../settings/api-preset-service';

const text = (value: any): string => typeof value === 'string' ? value : Array.isArray(value)
    ? value.map(part => typeof part === 'string' ? part : part?.text ?? '').join('') : '';
const args = (value: any): any => typeof value === 'string' ? JSON.parse(value || '{}') : value ?? {};

const DIRECT_PROMPT_PLACEHOLDER_ACU = "Let's get started.";

function mergeConsecutiveDirectMessages_ACU(messages: any[]): any[] {
    const result: any[] = [];
    for (const original of messages) {
        const message = { ...original };
        const previous = result[result.length - 1];
        if (previous
            && previous.role === message.role
            && message.role !== 'tool'
            && typeof previous.content === 'string'
            && typeof message.content === 'string') {
            previous.content += `\n\n${message.content}`;
            if (message.tool_calls) previous.tool_calls = [...(previous.tool_calls ?? []), ...message.tool_calls];
        } else {
            result.push(message);
        }
    }
    return result;
}

function demoteNonLeadingSystemMessages_ACU(messages: any[]): any[] {
    return messages.map((message, index) => (
        index > 0 && message.role === 'system' ? { ...message, role: 'user' } : message
    ));
}

/**
 * 直连接口的提示词后处理，语义对齐 SillyTavern mergeMessages：
 * - 空模式原样保留；merge 仅合并连续同角色；
 * - semi/strict 先合并、再把非开头 system 转为 user 并重合并；
 * - strict 额外保证 system 后首先出现 user；
 * - single 在无工具流量时压成一条 user。
 * 原生 tool_calls 与 role=tool 始终保留，工具变体只影响角色整理方式。
 */
export function processDirectMessages_ACU(input: any[], mode: string): any[] {
    const messages = input.map(message => ({ ...message }));
    if (!mode) return messages;

    const withTools = mode.endsWith('_tools')
        || messages.some(message => message.tool_calls || message.role === 'tool');
    if (mode === 'single' && !withTools) {
        return [{ role: 'user', content: messages.map(message => text(message.content)).join('\n\n') }];
    }

    let result = mergeConsecutiveDirectMessages_ACU(messages);
    const semiOrStrict = mode.startsWith('strict') || mode === 'single' || mode.startsWith('semi');
    if (semiOrStrict) {
        result = mergeConsecutiveDirectMessages_ACU(demoteNonLeadingSystemMessages_ACU(result));
    }

    if (mode.startsWith('strict') || (mode === 'single' && withTools)) {
        const firstNonSystemIndex = result.findIndex(message => message.role !== 'system');
        if (firstNonSystemIndex < 0) {
            result.push({ role: 'user', content: DIRECT_PROMPT_PLACEHOLDER_ACU });
        } else if (result[firstNonSystemIndex].role !== 'user') {
            result.splice(firstNonSystemIndex, 0, { role: 'user', content: DIRECT_PROMPT_PLACEHOLDER_ACU });
        }
        result = mergeConsecutiveDirectMessages_ACU(result);
    }
    return result;
}

export function providerEndpoint_ACU(raw: string, format: CustomApiFormat_ACU): string {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('API 端点必须是 HTTP 或 HTTPS 地址。');
    let path = url.pathname.replace(/\/+$/, '').replace(/\/(chat\/completions|responses|messages|interactions)$/, '');
    if (!path && format !== 'openai_compat' && format !== 'openai_responses') path = format === 'claude_messages' ? '/v1' : '/v1beta';
    url.pathname = path + ({ openai_compat: '/chat/completions', openai_responses: '/responses', claude_messages: '/messages', gemini_interactions: '/interactions' }[format]);
    return url.toString();
}


/** 把通用消息转换为协议请求；附加主体参数由发送层在转换后合并。 */
export function buildProviderRequest_ACU(body: Record<string, any>, format: CustomApiFormat_ACU): Record<string, any> {
    if (format === 'openai_compat') return { ...body };
    const { messages, max_tokens, tools, tool_choice, response_format, ...rest } = body;
    if (format === 'openai_responses') {
        const input = messages.flatMap((m: any) => {
            if (m.role === 'tool') return [{ type: 'function_call_output', call_id: m.tool_call_id, output: text(m.content) }];
            const items: any[] = m.content ? [{ role: m.role, content: m.content }] : [];
            for (const call of m.tool_calls ?? []) items.push({ type: 'function_call', call_id: call.id, ...call.function });
            return items;
        });
        return {
            modalities: ['text'],
            ...rest,
            ...(tools?.length ? { tools } : {}),
            input,
            max_output_tokens: max_tokens,
        };
    }
    if (format === 'claude_messages') {
        let system: string | undefined;
        const toolNamesById = new Map<string, string>();
        for (const message of messages) {
            for (const call of message.tool_calls ?? []) toolNamesById.set(call.id, call.function.name);
        }
        const cleaned = messages.flatMap((m: any) => {
            if (m.role === 'system') {
                system = (system ? system + '\n\n' : '') + text(m.content);
                return [];
            }
            if (m.role === 'tool') {
                return [{
                    role: 'user',
                    content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: text(m.content) }],
                }];
            }
            const content: any[] = text(m.content) ? [{ type: 'text', text: text(m.content) }] : [];
            for (const call of m.tool_calls ?? []) {
                content.push({ type: 'tool_use', id: call.id, name: call.function.name, input: args(call.function.arguments) });
            }
            return [{ role: m.role, content }];
        });
        const requestBody: any = { ...rest, messages: cleaned, max_tokens };
        if (system) requestBody.system = system;
        if (tools?.length) requestBody.tools = tools.map((tool: any) => ({ name: tool.function.name, description: tool.function.description, input_schema: tool.function.parameters }));
        if (tool_choice === 'required') requestBody.tool_choice = { type: 'any' };
        return requestBody;
    }
    if (format === 'gemini_interactions') {
        const systemText = messages
            .filter((m: any) => m.role === 'system')
            .map((m: any) => text(m.content))
            .join('\n\n');
        const toolNamesById = new Map<string, string>();
        for (const message of messages) {
            for (const call of message.tool_calls ?? []) toolNamesById.set(call.id, call.function.name);
        }
        const contents = messages
            .filter((m: any) => m.role !== 'system')
            .flatMap((m: any) => {
                if (m.role === 'tool') {
                    return [{
                        role: 'user',
                        parts: [{
                            functionResponse: {
                                name: toolNamesById.get(m.tool_call_id) ?? '',
                                response: { callId: m.tool_call_id, output: text(m.content) },
                            },
                        }],
                    }];
                }
                const parts: any[] = m.content ? [{ text: text(m.content) }] : [];
                for (const call of m.tool_calls ?? []) {
                    parts.push({ functionCall: { name: call.function.name, args: args(call.function.arguments) } });
                }
                return [{ role: m.role === 'assistant' ? 'model' : 'user', parts }];
            });
        const requestBody: any = { ...rest, contents, generationConfig: { maxOutputTokens: max_tokens, responseModalities: ['TEXT'] } };
        if (systemText) requestBody.systemInstruction = { parts: [{ text: systemText }] };
        if (tools?.length) requestBody.tools = [{ functionDeclarations: tools.map((tool: any) => ({ name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters })) }];
        if (tool_choice === 'required') requestBody.toolConfig = { functionCallingConfig: { mode: 'ANY' } };
        return requestBody;
    }
    return body;
}

function normalizedProviderChoice_ACU(content: string, finishReason: unknown) {
    return {
        choices: [{
            message: { role: 'assistant', content },
            finish_reason: finishReason === undefined || finishReason === null ? null : finishReason,
        }],
    };
}

export function normalizeProviderStream_ACU(raw: string, format: CustomApiFormat_ACU): string {
    if (format === 'openai_compat' || format === 'claude_messages') return raw;
    const packets: string[] = [];
    const emit = (delta: any, finish_reason: string | null = null, usage?: any) => packets.push(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}) })}\n\n`);
    let completed = false;
    for (const event of raw.replace(/\r\n/g, '\n').split('\n\n')) {
        const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data) continue;
        if (data === '[DONE]') { completed = true; continue; }
        const json = JSON.parse(data);
        if (json.error || json.type === 'error' || json.type === 'response.failed' || json.event_type === 'error') throw new Error('直连 API 流返回上游错误。');
        if (format === 'openai_responses') {
            if (json.type === 'response.output_text.delta') emit({ content: json.delta });
            if (json.type === 'response.output_item.added' && json.item?.type === 'function_call') emit({ tool_calls: [{ index: json.output_index ?? 0, id: json.item.call_id ?? json.item.id, type: 'function', function: { name: json.item.name, arguments: '' } }] });
            if (json.type === 'response.function_call_arguments.delta') emit({ tool_calls: [{ index: json.output_index ?? 0, function: { arguments: json.delta } }] });
            if (json.type === 'response.completed' || json.type === 'response.incomplete') {
                const reply = normalizeProviderReply_ACU(json.response, format);
                emit({}, reply.choices[0].finish_reason, reply.usage); completed = true;
            }
        } else {
            const type = json.event_type ?? json.type;
            if (type === 'content.delta' && json.delta?.type === 'text') emit({ content: json.delta.text ?? '' });
            if (type === 'step.delta' && json.delta?.type === 'text') emit({ content: json.delta.text ?? '' });
            if (type === 'content.start' && json.content?.type === 'function_call') emit({ tool_calls: [{ index: json.index ?? 0, id: json.content.id, type: 'function', function: { name: json.content.name, arguments: JSON.stringify(json.content.arguments ?? {}) } }] });
            if (type === 'interaction.complete' || type === 'interaction.completed') {
                const reply = normalizeProviderReply_ACU(json.interaction ?? json, format);
                emit({}, reply.choices[0].finish_reason, reply.usage); completed = true;
            }
        }
    }
    if (completed) packets.push('data: [DONE]\n\n');
    return packets.join('');
}

export function normalizeProviderReply_ACU(response: any, format: CustomApiFormat_ACU): any {
    if (format === 'openai_compat') return response;
    if (format === 'openai_responses') {
        const output = Array.isArray(response?.output) ? response.output : [];
        const content = output
            .flatMap((item: any) => item?.type === 'message' && Array.isArray(item.content) ? item.content : [])
            .map((part: any) => part?.text ?? '')
            .join('');
        const toolCalls = output
            .filter((item: any) => item?.type === 'function_call')
            .map((item: any, index: number) => ({
                index,
                id: item.call_id ?? item.id,
                type: 'function',
                function: { name: item.name, arguments: JSON.stringify(item.arguments ?? {}) },
            }));
        const finishReason = response?.status === 'completed'
            ? 'stop'
            : response?.status === 'incomplete'
                ? 'length'
                : null;
        const message: any = { role: 'assistant', content };
        if (toolCalls.length) message.tool_calls = toolCalls;
        return {
            id: response?.id,
            model: response?.model,
            choices: [{ message, finish_reason: finishReason }],
            usage: {
                prompt_tokens: response?.usage?.input_tokens,
                completion_tokens: response?.usage?.output_tokens,
            },
        };
    }
    if (format === 'claude_messages') {
        return {
            id: response?.id,
            model: response?.model,
            ...normalizedProviderChoice_ACU(response?.content?.map((block: any) => block?.text ?? '').join('') ?? '', response?.stop_reason),
            usage: {
                prompt_tokens: response?.usage?.input_tokens,
                completion_tokens: response?.usage?.output_tokens,
            },
        };
    }
    if (format === 'gemini_interactions') {
        const stepText = Array.isArray(response?.steps)
            ? response.steps.flatMap((step: any) => Array.isArray(step?.content) ? step.content : []).map((part: any) => part?.text ?? '').join('')
            : '';
        const candidateText = response?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text ?? '').join('') ?? '';
        const finishReason = response?.status === 'completed' || response?.interaction?.status === 'completed' ? 'stop' : null;
        return {
            id: '',
            model: response?.modelVersion ?? '',
            ...normalizedProviderChoice_ACU(stepText || candidateText, finishReason),
            usage: {
                prompt_tokens: response?.usageMetadata?.promptTokenCount,
                completion_tokens: response?.usageMetadata?.candidatesTokenCount,
            },
        };
    }
    return response;
}
