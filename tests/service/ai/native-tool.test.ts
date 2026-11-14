import { describe, expect, it } from 'vitest';
import { buildCustomApiRequestBody_ACU } from '../../../src/service/ai/api-call';
import {
  absorbChatCompletionEvent_ACU,
  agentNativeTools_ACU,
  chatTurnFromJson_ACU,
  anchorNativeToolCalls_ACU,
  dropTerminalJsonPrefill_ACU,
  NATIVE_TOOL_THINK_PREFILL_ACU,
  withNativeToolThinkPrefill_ACU,
  isModelExchangeSequence_ACU,
  nativeToolCallsToProtocolJson_ACU,
  nativeToolExchange_ACU,
  projectNativeToolHistoryToText_ACU,
  readFetchChatTurn_ACU,
  withJsonTailPrefill_ACU,
} from '../../../src/service/ai/native-tool';

describe('native tool calls', () => {
  describe('JSON 历史投影', () => {
  it('最终请求不携带 tools、tool_calls 或 role=tool，保留正文、顺序和原历史', () => {
    const source = [
      { role: 'system', content: '静态协议' },
      ...nativeToolExchange_ACU('已决定调阅', [{ id: 'history-read', name: 'read', arguments: '{"reads":["anchor:message"]}' }], ['真实回执']),
    ];
    const before = JSON.stringify(source);
    const projected = projectNativeToolHistoryToText_ACU(source);
    expect(projected.map(message => message.role)).toEqual(['system', 'assistant', 'user']);
    expect(projected[1].content).toContain('已决定调阅');
    expect(projected[1].content).toContain('"action":"read"');
    expect(projected[2].content).toBe('真实回执');
    const messages = withJsonTailPrefill_ACU(projected);
    const body = buildCustomApiRequestBody_ACU(messages, { url: 'https://example.invalid', model: 'test' }, { tools: [] });
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('tool_choice');
    for (const message of body.messages) {
      expect(message.role).not.toBe('tool');
      expect(message).not.toHaveProperty('tool_calls');
      expect(message).not.toHaveProperty('tool_call_id');
    }
    expect(JSON.stringify(source)).toBe(before);
  });
});


  it('请求体只在显式传入时带上 tools', () => {
    const plain = buildCustomApiRequestBody_ACU([{ role: 'user', content: 'hi' }], { url: 'https://api.example.com', model: 'gpt' });
    expect(plain).not.toHaveProperty('tools');
    expect(plain).not.toHaveProperty('tool_choice');
    const direct = buildCustomApiRequestBody_ACU([{ role: 'user', content: 'hi' }], {
      url: 'https://api.example.com', model: 'gpt', sendViaTavern: false,
    });
    expect(direct.tool_choice).toBe('none');
    const disabled = buildCustomApiRequestBody_ACU([{ role: 'user', content: 'hi' }], {
      url: 'https://api.example.com', model: 'gpt', sendViaTavern: true,
    }, { generationParameters: { tool_choice: 'none' } });
    expect(disabled.tool_choice).toBe('none');
    expect(buildCustomApiRequestBody_ACU([{ role: 'user', content: 'hi' }], {
      url: 'https://api.example.com', model: 'gpt', sendViaTavern: true,
    })).not.toHaveProperty('tool_choice');
    const body = buildCustomApiRequestBody_ACU([{ role: 'user', content: 'hi' }], { url: 'https://api.example.com', model: 'gpt' }, {
      tools: agentNativeTools_ACU(['read', 'write_sql']),
    });
    expect(body.tool_choice).toBe('auto');
    expect(body.tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual(['read', 'write_sql']);
  });

  it('从 OpenAI 消息和流式分片收集 tool_calls', () => {
    const whole = chatTurnFromJson_ACU({
      choices: [{ message: { content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'read', arguments: '{"reads":["anchor:message"]}' } }] } }],
    });
    expect(whole.turn.toolCalls).toEqual([{ id: 'call-1', name: 'read', arguments: '{"reads":["anchor:message"]}' }]);
    const state = { content: '', calls: new Map(), usage: undefined };
    absorbChatCompletionEvent_ACU(state, { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-2', function: { name: 'search', arguments: '{"query":' } }] } }] });
    absorbChatCompletionEvent_ACU(state, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"山雨"}' } }] } }] });
    expect(chatTurnFromJson_ACU({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-2', function: { name: 'search', arguments: '{"query":"山雨"}' } }] } }] }).turn.toolCalls[0]?.name).toBe('search');
    expect(state.calls.get(0)?.arguments).toBe('{"query":"山雨"}');
  });

  it('工具回执使用 role=tool，未完成预填充不再留在请求末尾', () => {
    expect(nativeToolCallsToProtocolJson_ACU([{ id: 'call-1', name: 'read', arguments: '{"reads":["ledger:current"]}' }])).toContain('"action":"read"');
    const exchange = nativeToolExchange_ACU('', [{ id: 'call-1', name: 'read', arguments: '{"reads":["ledger:current"]}' }], ['{"status":"ok"}']);
    expect(exchange.map(message => message.role)).toEqual(['assistant', 'tool']);
    expect(exchange[1]?.tool_call_id).toBe('call-1');
    expect(dropTerminalJsonPrefill_ACU([
      { role: 'user', content: '任务' },
      { role: 'assistant', content: '<continue>\n{\n  "thought": "' },
    ]).map(message => message.role)).toEqual(['user']);
    const kept = dropTerminalJsonPrefill_ACU([
      { role: 'user', content: '任务' },
      { role: 'assistant', content: '{\n  "summary": "' },
      { role: 'assistant', content: '<think>先读世界书</think>', tool_calls: [{ id: 'call_function_1', type: 'function' as const, function: { name: 'read', arguments: '{"reads":["$WORLDBOOK:书:1"]}' } }] },
      { role: 'tool', tool_call_id: 'call_function_1', content: '已读' },
    ]);
    expect(kept.map(message => message.role)).toEqual(['user', 'assistant', 'tool']);
    expect(kept[1]?.tool_calls?.[0]?.id).toBe('call_function_1');
    const primed = withNativeToolThinkPrefill_ACU(kept);
    expect(primed.map(message => message.role)).toEqual(['user', 'assistant', 'tool']);
    expect(primed[1]?.tool_calls?.[0]?.id).toBe('call_function_1');
    expect(primed).toEqual(kept);
    expect(withNativeToolThinkPrefill_ACU([
      { role: 'user', content: '任务' },
      { role: 'assistant', content: '{\n  "summary": "' },
    ]).map(message => message.content)).toEqual(['任务', '{\n  "summary": "']);
    const anchored = anchorNativeToolCalls_ACU([
      { role: 'assistant', content: '明白。' },
      { role: 'assistant', content: '<think>先查</think>', tool_calls: [{ id: 'call_function_262nzwiknzi6_1', type: 'function' as const, function: { name: 'search', arguments: '{"query":"入府"}' } }] },
      { role: 'tool', tool_call_id: 'call_function_262nzwiknzi6_1', content: '没有命中' },
      { role: 'tool', tool_call_id: 'call_function_262nzwiknzi6_2', content: '已读' },
    ]);
    expect(anchored.map(message => message.role)).toEqual(['assistant', 'tool', 'tool']);
    expect(anchored[0]?.tool_calls?.map(call => call.id)).toEqual(['call_function_262nzwiknzi6_1', 'call_function_262nzwiknzi6_2']);
    expect(anchored[0]?.content).toContain('明白');
    expect(anchored[0]?.content).toContain('先查');
    expect(isModelExchangeSequence_ACU([
      { role: 'assistant' },
      { role: 'tool' },
      { role: 'tool' },
    ])).toBe(true);
    expect(isModelExchangeSequence_ACU([{ role: 'assistant' }, { role: 'user' }])).toBe(true);
    expect(isModelExchangeSequence_ACU([{ role: 'assistant' }, { role: 'assistant' }])).toBe(false);
  });
});

describe('readFetchChatTurn_ACU SSE 事件解析', () => {
  const event = (content: string, finish?: string) => JSON.stringify({ choices: [{ delta: { content }, ...(finish ? { finish_reason: finish } : {}) }] });
  const streamOf = (chunks: Array<string | Uint8Array>) => new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
      controller.close();
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } });
  const read = (raw: string | Array<string | Uint8Array>, requireComplete = false) =>
    readFetchChatTurn_ACU(streamOf(Array.isArray(raw) ? raw : [raw]), true, null, requireComplete);

  it.each([
    ['data 冒号后带空格', `data: ${event('hello', 'stop')}\n\ndata: [DONE]\n\n`],
    ['data 冒号后无空格', `data:${event('hello', 'stop')}\n\ndata:[DONE]\n\n`],
    ['CR 行结束符', `data: ${event('hello', 'stop')}\r\rdata: [DONE]\r\r`],
    ['CRLF 行结束符', `data: ${event('hello', 'stop')}\r\n\r\ndata: [DONE]\r\n\r\n`],
    ['同一事件 JSON 分布于多个 data 字段', 'data: {"choices":[{"delta":\ndata: {"content":"hello"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'],
    ['注释行与 event 字段', `: keep-alive\nevent: message\ndata: ${event('hello', 'stop')}\n\n`],
    ['末尾事件缺少空行', `data: ${event('hello', 'stop')}`],
  ])('%s：普通分支与完整终态分支均恢复正文', async (_name, raw) => {
    expect((await read(raw)).turn.content).toBe('hello');
    expect((await read(raw, true)).turn.content).toBe('hello');
  });

  it('按字节拆分网络 chunk（含多字节字符与跨块 CRLF）仍完整恢复', async () => {
    const bytes = new TextEncoder().encode(`data:${event('你好', 'stop')}\r\n\r\ndata: [DONE]\r\n\r\n`);
    const chunks = Array.from(bytes, byte => Uint8Array.of(byte));
    expect((await read(chunks)).turn.content).toBe('你好');
    expect((await read(Array.from(bytes, byte => Uint8Array.of(byte)), true)).turn.content).toBe('你好');
  });

  it('兼容未以空行分隔、逐行各自完整的 data JSON', async () => {
    const raw = `data: ${event('hel')}\ndata: ${event('lo', 'stop')}\ndata: [DONE]\n\n`;
    expect((await read(raw)).turn.content).toBe('hello');
    expect((await read(raw, true)).turn.content).toBe('hello');
  });

  it('无效 JSON：普通分支跳过，完整终态分支拒绝确认', async () => {
    const raw = `data: {broken\n\ndata: ${event('hello', 'stop')}\n\n`;
    expect((await read(raw)).turn.content).toBe('hello');
    await expect(read(raw, true)).rejects.toThrow('正文流包含无效 JSON');
  });

  it('缺少完整终态时完整终态分支仍拒绝确认', async () => {
    await expect(read(`data: ${event('hello')}\n\n`, true)).rejects.toThrow('完整终态前结束');
  });

  it('工具调用分片与 usage 仍按事件累积', async () => {
    const first = JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search', arguments: '{"q":' } }] } }] });
    const second = JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"x"}' } }] } }], usage: { total_tokens: 3 } });
    const parsed = await read(`data:${first}\r\n\r\ndata:${second}\r\n\r\ndata:[DONE]\r\n\r\n`);
    expect(parsed.turn.toolCalls).toEqual([{ id: 'call_1', name: 'search', arguments: '{"q":"x"}' }]);
    expect(parsed.usage).toEqual({ total_tokens: 3 });
  });
});
