import { describe, expect, it } from 'vitest';
import { worldModelReplyText_ACU } from '../../../../src/service/simulation/agent/model-reply-text';

const call = (args: string) => ({ id: 'c1', name: 'reply', arguments: args });

describe('格林推演模型回复取文本', () => {
  it('正文有 JSON 时直接用正文', () => {
    expect(worldModelReplyText_ACU({ content: '{"a":1}', toolCalls: [call('{"b":2}')] })).toBe('{"a":1}');
    expect(worldModelReplyText_ACU('{"a":1}')).toBe('{"a":1}');
  });

  it('正文为空或只有说明文字时取工具调用参数', () => {
    expect(worldModelReplyText_ACU({ content: '', toolCalls: [call('{"worldEventWrites":[]}')] })).toBe('{"worldEventWrites":[]}');
    expect(worldModelReplyText_ACU({ content: '已完成。', toolCalls: [call('{"x":1}')] })).toBe('{"x":1}');
    expect(worldModelReplyText_ACU({ content: '', toolCalls: [call('  '), call('{"y":2}')] })).toBe('{"y":2}');
  });

  it('工具参数把回答包成字符串时解开', () => {
    expect(worldModelReplyText_ACU({ content: '', toolCalls: [call(JSON.stringify('{"z":3}'))] })).toBe('{"z":3}');
    expect(worldModelReplyText_ACU({ content: '', toolCalls: [call(JSON.stringify({ content: '{"z":3}' }))] })).toBe('{"z":3}');
    expect(worldModelReplyText_ACU({ content: '', toolCalls: [call('不是 JSON 的回答')] })).toBe('不是 JSON 的回答');
  });

  it('没有正文也没有工具参数时返回空或 null', () => {
    expect(worldModelReplyText_ACU({ content: '', toolCalls: [] })).toBe('');
    expect(worldModelReplyText_ACU({ toolCalls: [] })).toBeNull();
    expect(worldModelReplyText_ACU(null)).toBeNull();
  });
});
