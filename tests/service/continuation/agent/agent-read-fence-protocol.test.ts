import { describe, expect, it } from 'vitest';
import { agentNativeTools_ACU, nativeToolCallsToProtocolJson_ACU, synthesizeProtocolToolCalls_ACU } from '../../../../src/service/ai/native-tool';
import { parseAgentToolCall_ACU } from '../../../../src/service/continuation/agent/agent-protocol';

describe('continuation read fence protocol', () => {
  it('解析并保留 requestedFence', () => {
    expect(parseAgentToolCall_ACU({
      action: 'read',
      reads: ['$STORY_RANGE:1-2'],
      requestedFence: { lower: 1, upper: 'tail' },
    })).toEqual({
      kind: 'read',
      reads: ['$STORY_RANGE:1-2'],
      requestedFence: { lower: 1, upper: 'tail' },
    });
  });

  it('对空围栏、坏边界和数字倒序 fail-closed', () => {
    expect(() => parseAgentToolCall_ACU({ action: 'read', reads: ['$A'], requestedFence: {} }))
      .toThrow('requestedFence');
    expect(() => parseAgentToolCall_ACU({ action: 'read', reads: ['$A'], requestedFence: { lower: 1.5 } }))
      .toThrow('requestedFence');
    expect(() => parseAgentToolCall_ACU({ action: 'read', reads: ['$A'], requestedFence: { lower: 9, upper: 2 } }))
      .toThrow('requestedFence');
  });

  it('原生 provider schema 与文本协议转换均不丢围栏', () => {
    const definition = agentNativeTools_ACU(['read'])[0];
    expect(definition.function.parameters).toMatchObject({
      properties: { requestedFence: { type: 'object', minProperties: 1 } },
    });
    const calls = synthesizeProtocolToolCalls_ACU([{
      kind: 'read',
      reads: ['$TABLE:角色表:1-2'],
      requestedFence: { lower: 1, upper: 2 },
    }]);
    expect(JSON.parse(calls[0].arguments)).toEqual({
      reads: ['$TABLE:角色表:1-2'],
      requestedFence: { lower: 1, upper: 2 },
    });
    expect(JSON.parse(nativeToolCallsToProtocolJson_ACU(calls))).toEqual({
      action: 'read',
      reads: ['$TABLE:角色表:1-2'],
      requestedFence: { lower: 1, upper: 2 },
    });
  });
});
