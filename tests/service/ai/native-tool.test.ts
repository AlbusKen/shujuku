import { describe, expect, it } from 'vitest';
import { buildCustomApiRequestBody_ACU } from '../../../src/service/ai/api-call';
import {
  absorbChatCompletionEvent_ACU,
  agentNativeTools_ACU,
  chatTurnFromJson_ACU,
  dropTerminalJsonPrefill_ACU,
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
    expect(isModelExchangeSequence_ACU([
      { role: 'assistant' },
      { role: 'tool' },
      { role: 'tool' },
    ])).toBe(true);
    expect(isModelExchangeSequence_ACU([{ role: 'assistant' }, { role: 'user' }])).toBe(true);
    expect(isModelExchangeSequence_ACU([{ role: 'assistant' }, { role: 'assistant' }])).toBe(false);
  });
});
