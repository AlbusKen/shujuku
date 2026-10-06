import type { CustomApiFormat_ACU } from '../settings/api-preset-service';

const text = (value: any): string => typeof value === 'string' ? value : Array.isArray(value)
    ? value.map(part => typeof part === 'string' ? part : part?.text ?? '').join('') : '';
const args = (value: any): any => typeof value === 'string' ? JSON.parse(value || '{}') : value ?? {};

/** 保留正文和原生工具字段；后处理只改变明确选择的角色组织方式。 */
export function processDirectMessages_ACU(input: any[], mode: string, preserveMultipleSystem = true): any[] {
    const messages = input.map(message => ({ ...message }));
    if (!mode) return messages;
    const withTools = mode.endsWith('_tools') || messages.some(message => message.tool_calls || message.role === 'tool');
    if (mode === 'single' && !withTools) return [{ role: 'user', content: messages.map(message => text(message.content)).join('\n\n') }];
    // preserveMultipleSystem 保护多个 system 消息不降级为 user（默认开启）
    const strict = mode.startsWith('strict') || mode === 'single';
    const semi = (strict || mode.startsWith('semi')) && !preserveMultipleSystem;
    const result: any[] = [];
    for (const original of messages) {
        const message = { ...original };
        if (semi && message.role === 'system' && result.length) message.role = 'user';
        const previous = result[result.length - 1];
        if (previous && previous.role === message.role && message.role !== 'tool'
            && typeof previous.content === 'string' && typeof message.content === 'string') {
            previous.content += '\n\n' + message.content;
            if (message.tool_calls) previous.tool_calls = [...(previous.tool_calls ?? []), ...message.tool_calls];
        } else result.push(message);
    }
    const first = result.find(message => message.role !== 'system');
    if (strict && first?.role === 'assistant' && !first.tool_calls) first.role = 'user';
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
        return { modalities: ['text'], ...rest, input, max_output_tokens: max_tokens };
    }
    if (format === 'claude_messages') {
        let system: string | undefined;
        const cleaned = messages.filter((m: any) => {
            if (m.role !== 'system') return true;
            system = (system ? system + '\n\n' : '') + text(m.content);
            return false;
        });
        const body: any = { ...rest, messages: cleaned.map((m: any) => ({ role: m.role, content: text(m.content) })), max_tokens };
        if (system) body.system = system;
        if (tools?.length) body.tools = tools.map((tool: any) => ({ name: tool.function.name, description: tool.function.description, input_schema: tool.function.parameters }));
        if (tool_choice === 'required') body.tool_choice = { type: 'any' };
        return body;
    }
    if (format === 'gemini_interactions') {
        const systemInstruction = messages.find((m: any) => m.role === 'system');
        const contents = messages
            .filter((m: any) => m.role !== 'system')
            .flatMap((m: any) => {
                const parts: any[] = m.content ? [{ text: text(m.content) }] : [];
                for (const call of m.tool_calls ?? []) {
                    parts.push({ functionCall: { name: call.function.name, args: args(call.function.arguments) } });
                }
                if (m.role === 'tool') parts.push({ functionResponse: { name: '', response: { output: text(m.content) } } });
                return [{ role: m.role === 'assistant' ? 'model' : 'user', parts }];
            });
        const body: any = { ...rest, contents, generationConfig: { maxOutputTokens: max_tokens, responseModalities: ['TEXT'] } };
        if (systemInstruction) body.systemInstruction = { parts: [{ text: text(systemInstruction.content) }] };
        if (tools?.length) body.tools = [{ functionDeclarations: tools.map((tool: any) => ({ name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters })) }];
        if (tool_choice === 'required') body.toolConfig = { functionCallingConfig: { mode: 'ANY' } };
        return body;
    }
    return body;
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
    if (format === 'openai_compat' || format === 'openai_responses') return response;
    if (format === 'claude_messages') {
        return {
            id: response.id,
            model: response.model,
            choices: [{ message: { role: 'assistant', content: response.content?.map((block: any) => block.text ?? '').join('') ?? '' }, finish_reason: response.stop_reason }],
            usage: { prompt_tokens: response.usage?.input_tokens, completion_tokens: response.usage?.output_tokens },
        };
    }
    if (format === 'gemini_interactions') {
        return {
            id: '',
            model: response.modelVersion ?? '',
            choices: [{ message: { role: 'assistant', content: response.candidates?.[0]?.content?.parts?.map((part: any) => part.text ?? '').join('') ?? '' }, finish_reason: response.candidates?.[0]?.finishReason }],
            usage: { prompt_tokens: response.usageMetadata?.promptTokenCount, completion_tokens: response.usageMetadata?.candidatesTokenCount },
        };
    }
    return response;
}
