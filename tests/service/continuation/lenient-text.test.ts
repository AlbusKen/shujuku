import { describe, expect, it } from 'vitest';

import { parseAgentJsonPayload_ACU, parseAgentJsonPayloadDraft_ACU, parseAgentMainOutput_ACU } from '../../../src/service/continuation/agent/agent-protocol';
import { parseJsonLenient_ACU, salvageTruncatedJson_ACU, sanitizeLooseJson_ACU, stripReasoningBlocks_ACU } from '../../../src/service/continuation/lenient-text';

describe('lenient-text', () => {
  it('剥离闭合的推理块，未闭合时只删标签保留内容', () => {
    expect(stripReasoningBlocks_ACU('<think>先想想 {"a":1}</think>{"action":"read"}')).toBe('{"action":"read"}');
    expect(stripReasoningBlocks_ACU('<thinking>\n多行\n</thinking>\n<reasoning>x</reasoning>正文')).toBe('\n正文');
    expect(stripReasoningBlocks_ACU('<think>没闭合就直接写了 {"action":"finalize"}')).toBe('没闭合就直接写了 {"action":"finalize"}');
  });

  it('宽松 JSON：注释、单引号、无引号键、尾逗号', () => {
    const loose = `{
      // 说明
      action: 'delegate', /* 块注释 */
      delegations: [{ agentName: 'mainline-planner', prompt: '他说"好"，然后走了', reads: [], },],
      ok: true,
    }`;
    expect(parseJsonLenient_ACU(loose)).toEqual({ action: 'delegate', delegations: [{ agentName: 'mainline-planner', prompt: '他说"好"，然后走了', reads: [] }], ok: true });
    // 字符串内部逐字保留：冒号、逗号、斜杠都不被当成语法。
    expect(sanitizeLooseJson_ACU('{"url": "http://a/b, c", n: null}')).toBe('{"url": "http://a/b, c", "n": null}');
    expect(parseJsonLenient_ACU('完全不是 JSON')).toBeUndefined();
  });

  it('抢救截断 JSON：保留写完的条目，丢掉未完成尾部并补括号', () => {
    const truncated = '前言 {"summary":"s","delta":{"hooks":[{"action":"upsert","id":"H1"},{"action":"upsert","id":"H2","summary":"信物"},{"action":"ups';
    const salvaged = salvageTruncatedJson_ACU(truncated);
    expect(salvaged).not.toBeNull();
    expect(JSON.parse(salvaged!.json)).toEqual({ summary: 's', delta: { hooks: [{ action: 'upsert', id: 'H1' }, { action: 'upsert', id: 'H2', summary: '信物' }] } });
    expect(salvageTruncatedJson_ACU('{"a":1}')).toBeNull();
    expect(salvageTruncatedJson_ACU('{"a":[1,2')).toBeNull();
    expect(salvageTruncatedJson_ACU('没有花括号')).toBeNull();
  });
});

describe('agent-protocol 宽容解析', () => {
  it('主 Agent 输出带 <think> 与宽松 JSON 时仍能解析动作', () => {
    const raw = "<think>\n1. 没有总纲\n2. 派 arc-architect\n</think>\n{ thought: '先立总纲', action: 'delegate', delegations: [{ agentName: 'arc-architect', prompt: '立总纲', reads: [] },] }";
    const action = parseAgentMainOutput_ACU(raw, '{\n  "thought": "', true);
    expect(action.kind).toBe('delegate');
  });

  it('契约草稿：截断时抢救外层而不是把内部条目当成契约', () => {
    const truncated = '{"summary":"结算完成","delta":{"hooks":[{"action":"upsert","id":"H1","summary":"晶屑"},{"action":"upsert","id":"H2","summ';
    const draft = parseAgentJsonPayloadDraft_ACU(truncated, '{\n  "summary": "', ['delta', 'summary']);
    expect(draft.truncated).toBe(true);
    expect(draft.payload).toEqual({ summary: '结算完成', delta: { hooks: [{ action: 'upsert', id: 'H1', summary: '晶屑' }] } });
    const complete = parseAgentJsonPayloadDraft_ACU('{"summary":"x","delta":{}}', '', ['delta', 'summary']);
    expect(complete).toEqual({ truncated: false, payload: { summary: 'x', delta: {} } });

    // 回归：完整 JSON 配上以未闭合引号结尾的预填充，绝不能被“预填充 + 原文”的拼接候选误判为截断，
    // 否则子代理返回的整份 delta 会被抢救成一份空载荷——表现为“完成”但一条都没写进账本。
    const prefill = '{\n  "summary": "';
    const full = '{"summary":"结算完成","delta":{"hooks":[{"action":"upsert","id":"H1","summary":"晶屑"}],"storyArc":[{"action":"upsert","id":"ARC-STORY","scope":"story","title":"全书","direction":"谁追求什么"}]}}';
    for (const raw of [full, `<think>先想想</think>\n${full}`, `思路说明。\n\`\`\`json\n${full}\n\`\`\``]) {
      const parsed = parseAgentJsonPayloadDraft_ACU(raw, prefill, ['delta', 'summary']);
      expect(parsed.truncated).toBe(false);
      expect((parsed.payload.delta as any).hooks).toHaveLength(1);
      expect((parsed.payload.delta as any).storyArc).toHaveLength(1);
    }
    // 只续写预填充之后部分的形态也要完整解析。
    const continued = parseAgentJsonPayloadDraft_ACU('结算完成","delta":{"hooks":[{"action":"upsert","id":"H1","summary":"晶屑"}]}}', prefill, ['delta', 'summary']);
    expect(continued.truncated).toBe(false);
    expect((continued.payload.delta as any).hooks).toHaveLength(1);
    expect(() => parseAgentJsonPayload_ACU('<think>只有思考</think>', '', ['delta'])).toThrow();
  });
});
