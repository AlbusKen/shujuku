import type { CustomApiFormat_ACU } from '../settings/api-preset-service';

const text = (value: any): string => typeof value === 'string' ? value : Array.isArray(value)
    ? value.map(part => typeof part === 'string' ? part : part?.text ?? '').join('') : '';
const args = (value: any): any => typeof value === 'string' ? JSON.parse(value || '{}') : value ?? {};

/** 保留正文和原生工具字段；后处理只改变明确选择的角色组织方式。 */
export function processDirectMessages_ACU(input: any[], mode: string): any[] {
    const messages = input.map(message => ({ ...message }));
    if (!mode) return messages;
    const withTools = mode.endsWith('_tools') || messages.some(message => message.tool_calls || message.role === 'tool');
    if (mode === 'single' && !withTools) return [{ role: 'user', content: messages.map(message => text(message.content)).join('\n\n') }];
    const strict = mode.startsWith('strict') || mode === 'single';
    const semi = strict || mode.startsWith('semi');
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
        return { ...rest, input, max_output_tokens: max_tokens,
            ...(tools?.length ? { tools: tools.map((t: any) => ({ type: 'function', ...t.function })), tool_choice } : {}),
            ...(response_format ? { text: { format: response_format.type === 'json_schema' ? { type: 'json_schema', ...response_format.json_schema } : response_format } } : {}) };
    }
    if (format === 'claude_messages') {
        const system = messages.filter((m: any) => m.role === 'system').map((m: any) => ({ type: 'text', text: text(m.content) }));
        const converted = messages.filter((m: any) => m.role !== 'system').map((m: any) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.role === 'tool' ? [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: text(m.content) }]
                : [...(m.content ? [{ type: 'text', text: text(m.content) }] : []), ...(m.tool_calls ?? []).map((c: any) => ({ type: 'tool_use', id: c.id, name: c.function.name, input: args(c.function.arguments) }))],
        }));
        const { top_p, temperature, model, stream } = rest;
        return { model, stream, temperature, top_p, max_tokens, messages: converted, ...(system.length ? { system } : {}),
            ...(tools?.length ? { tools: tools.map((t: any) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters })), tool_choice: { type: 'auto' } } : {}),
            ...(response_format ? { output_config: { format: { type: 'json_schema', schema: response_format.json_schema?.schema ?? { type: 'object' } } } } : {}) };
    }
    const input = messages.filter((m: any) => m.role !== 'system').flatMap((m: any) => {
        if (m.role === 'tool') return [{ type: 'function_result', call_id: m.tool_call_id, result: text(m.content) }];
        return [...(m.content ? [{ type: m.role === 'assistant' ? 'model_output' : 'user_input', content: [{ type: 'text', text: text(m.content) }] }] : []),
            ...(m.tool_calls ?? []).map((c: any) => ({ type: 'function_call', id: c.id, name: c.function.name, arguments: args(c.function.arguments) }))];
    });
    return { model: rest.model, stream: rest.stream, store: false, input,
        system_instruction: messages.filter((m: any) => m.role === 'system').map((m: any) => text(m.content)).join('\n\n'),
        generation_config: { max_output_tokens: max_tokens, ...(tools?.length ? { tool_choice: 'auto' } : {}) },
        ...(tools?.length ? { tools: tools.map((t: any) => ({ type: 'function', ...t.function })) } : {}),
        ...(response_format ? { response_format: { type: 'json', schema: response_format.json_schema?.schema ?? { type: 'object' } } } : {}) };
}

/** 原始非流式回复归一到现有 OpenAI 回复契约，原始 wire 另行完整记录。 */
export function normalizeProviderReply_ACU(data: any, format: CustomApiFormat_ACU): any {
    if (format === 'openai_compat' || data?.choices) return data;
    if (data?.error || data?.errors?.length || ['failed', 'cancelled'].includes(data?.status)) throw new Error('直连 API 返回上游错误。');
    const blocks = format === 'claude_messages' ? data.content ?? []
        : format === 'openai_responses' ? data.output ?? [] : data.steps ?? data.outputs ?? [];
    const content = blocks.map((b: any) => b.type === 'text' ? b.text : text(b.content)).join('');
    const calls = blocks.filter((b: any) => ['function_call', 'tool_use'].includes(b.type)).map((b: any) => ({
        id: b.call_id ?? b.id, type: 'function', function: { name: b.name, arguments: typeof b.arguments === 'string' ? b.arguments : JSON.stringify(b.arguments ?? b.input ?? {}) },
    }));
    const usage = data.usage;
    return { choices: [{ message: { role: 'assistant', content, ...(calls.length ? { tool_calls: calls } : {}) },
        finish_reason: calls.length ? 'tool_calls' : (data.stop_reason === 'max_tokens' || data.status === 'incomplete' ? 'length'
            : format === 'claude_messages' ? (['end_turn', 'stop_sequence'].includes(data.stop_reason) ? 'stop' : null)
            : data.status === 'completed' ? 'stop' : null) }],
        usage: usage ? { ...usage, prompt_tokens: usage.input_tokens ?? usage.total_input_tokens, completion_tokens: usage.output_tokens ?? usage.total_output_tokens } : undefined };
}

/** Responses / Interactions SSE 转为现有消费者使用的 Chat Completion SSE；不伪造缺失的终态。 */
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
