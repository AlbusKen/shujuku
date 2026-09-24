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
} from '../../../src/service/ai/native-tool';

describe('native tool calls', () => {
  it('请求体只在显式传入时带上 tools', () => {
    const plain = buildCustomApiRequestBody_ACU([{ role: 'user', content: 'hi' }], { url: 'https://api.example.com', model: 'gpt' });
    expect(plain).not.toHaveProperty('tools');
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
    expect(primed.map(message => message.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(primed[1]?.tool_calls?.[0]?.id).toBe('call_function_1');
    expect(primed.at(-1)?.content).toBe(NATIVE_TOOL_THINK_PREFILL_ACU);
    expect(withNativeToolThinkPrefill_ACU([
      { role: 'user', content: '任务' },
      { role: 'assistant', content: '{\n  "summary": "' },
    ]).map(message => message.content)).toEqual(['任务', NATIVE_TOOL_THINK_PREFILL_ACU]);
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
