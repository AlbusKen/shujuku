import { beforeEach, describe, expect, it, vi } from 'vitest';

import { appendAgentConversation_ACU, buildEmptyAgentConversation_ACU } from '../../../../src/service/continuation/agent/agent-conversation-store';
import {
  buildAgentHandoffReport_ACU,
  compactAgentConversation_ACU,
  countAgentTokens_ACU,
  createAgentTokenCounter_ACU,
  measureAgentConversationTokens_ACU,
  measureAgentPromptTokens_ACU,
  resolveAgentCompactionTiming_ACU,
} from '../../../../src/service/continuation/agent/agent-token-budget';
import { _set_SillyTavern_API_ACU } from '../../../../src/shared/host-api';
import type { AgentConversationAppend_ACU, AgentConversationSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-model';

/** 每字 1 token 的计数器，让预算断言可以直接用字符数推算。 */
const countByChar = async (text: string): Promise<number> => text.length;

function build(appends: AgentConversationAppend_ACU[]): AgentConversationSnapshot_ACU {
  return appendAgentConversation_ACU(buildEmptyAgentConversation_ACU(), appends);
}

function threeTurns(): AgentConversationSnapshot_ACU {
  return build([
    { kind: 'user', text: '第一轮：先埋线索', digest: '你的消息', turnKey: 'turn-1' },
    { kind: 'turn', text: '开始新的一轮规划：第 1 轮', digest: '第 1 轮', turnKey: 'turn-1' },
    { kind: 'agent', text: 'A'.repeat(60), digest: '派工 1 项', turnKey: 'turn-1' },
    { kind: 'tool', text: 'B'.repeat(60), digest: 'mainline-planner成功', turnKey: 'turn-1' },
    { kind: 'turn', text: '开始新的一轮规划：第 2 轮', digest: '第 2 轮', turnKey: 'turn-2' },
    { kind: 'agent', text: 'C'.repeat(60), digest: '交付写作指导', turnKey: 'turn-2' },
    { kind: 'turn', text: '开始新的一轮规划：第 3 轮', digest: '第 3 轮', turnKey: 'turn-3' },
    { kind: 'agent', text: 'D'.repeat(10), digest: '交付写作指导', turnKey: 'turn-3' },
  ]);
}

beforeEach(() => { _set_SillyTavern_API_ACU(null as any); });

describe('token 统计', () => {
  it('宿主分词器可用时采用其结果，抛错或缺失时降级为字符估算', async () => {
    _set_SillyTavern_API_ACU({ getTokenCountAsync: async () => 42 } as any);
    expect(await countAgentTokens_ACU('随便一段话')).toBe(42);

    _set_SillyTavern_API_ACU({ getTokenCountAsync: async () => { throw new Error('tokenizer down'); } } as any);
    expect(await countAgentTokens_ACU('12345678')).toBe(Math.ceil(8 / 1.5));

    _set_SillyTavern_API_ACU(null as any);
    expect(await countAgentTokens_ACU('')).toBe(0);
    expect(await countAgentTokens_ACU('123')).toBe(2);
  });
});

describe('交接报告', () => {
  it('按轮次分组浓缩用户要求、动作与结果，并继承此前的交接报告', () => {
    const snapshot = build([
      { kind: 'handoff', text: '更早的交接报告正文', digest: '', turnKey: '' },
      { kind: 'user', text: '  别   揭穿  守门人  ', digest: '', turnKey: 'turn-1' },
      { kind: 'turn', text: '开始新的一轮规划：第 1 轮', digest: '第 1 轮', turnKey: 'turn-1' },
      { kind: 'agent', text: '{}', digest: '派工 2 项', turnKey: 'turn-1' },
      { kind: 'agent', text: '{}', digest: '交付写作指导', turnKey: 'turn-1' },
      { kind: 'tool', text: '结果正文', digest: 'mainline-planner成功', turnKey: 'turn-1' },
      { kind: 'runtime', text: '【本回合运行时数据】', digest: '运行时快照', turnKey: 'turn-1' },
    ]);
    const report = buildAgentHandoffReport_ACU(snapshot.messages);

    expect(report.startsWith('更早的交接报告正文')).toBe(true);
    expect(report).toContain('轮次：第 1 轮');
    // 用户原话的空白被压平，便于在报告里逐条列出。
    expect(report).toContain('用户要求：别 揭穿 守门人');
    expect(report).toContain('我的动作：派工 2 项 → 交付写作指导');
    expect(report).toContain('运行时结果：mainline-planner成功');
    expect(report).toContain('运行时快照：运行时快照');
    expect(buildAgentHandoffReport_ACU([])).toBe('');
  });
});

describe('会话压缩', () => {
  it('预算不限或未超预算时原样返回同一引用', async () => {
    const snapshot = threeTurns();
    expect((await compactAgentConversation_ACU(snapshot, 0, countByChar)).snapshot).toBe(snapshot);
    expect((await compactAgentConversation_ACU(snapshot, 100_000, countByChar))).toMatchObject({ changed: false, withinBudget: true });
    expect(await compactAgentConversation_ACU(buildEmptyAgentConversation_ACU(), 10, countByChar)).toMatchObject({ changed: false });
  });

  it('超预算时从最早的轮次开始整轮丢弃，浓缩成开头的交接报告', async () => {
    const compaction = await compactAgentConversation_ACU(threeTurns(), 120, countByChar);

    expect(compaction.changed).toBe(true);
    expect(compaction.droppedTurns).toBe(1);
    expect(compaction.droppedMessages).toBe(4);
    const messages = compaction.snapshot.messages;
    expect(messages[0].kind).toBe('handoff');
    expect(messages[0].text).toContain('第 1 轮');
    expect(messages.some(message => message.text.includes('A'.repeat(60)))).toBe(false);
    // 后两轮完整保留，且 id 不与交接报告撞号。
    expect(messages.slice(1).map(message => message.turnKey)).toEqual(['turn-2', 'turn-2', 'turn-3', 'turn-3']);
    expect(new Set(messages.map(message => message.id)).size).toBe(messages.length);
  });

  it('最近一轮永远完整保留：单轮本身超预算时如实标注未落进预算', async () => {
    const single = build([
      { kind: 'turn', text: '开始新的一轮规划：第 1 轮', digest: '第 1 轮', turnKey: 'turn-1' },
      { kind: 'agent', text: 'E'.repeat(500), digest: '交付写作指导', turnKey: 'turn-1' },
    ]);
    const compaction = await compactAgentConversation_ACU(single, 50, countByChar);
    expect(compaction).toMatchObject({ changed: false, withinBudget: false });
    expect(compaction.snapshot).toBe(single);

    // 多轮但仅剩最后一轮时仍然超预算：报告已生成，withinBudget 如实为 false。
    const twoTurns = build([
      { kind: 'turn', text: '第 1 轮', digest: '第 1 轮', turnKey: 'turn-1' },
      { kind: 'agent', text: 'F'.repeat(200), digest: '交付写作指导', turnKey: 'turn-1' },
      { kind: 'turn', text: '第 2 轮', digest: '第 2 轮', turnKey: 'turn-2' },
      { kind: 'agent', text: 'G'.repeat(300), digest: '交付写作指导', turnKey: 'turn-2' },
    ]);
    const second = await compactAgentConversation_ACU(twoTurns, 100, countByChar);
    expect(second).toMatchObject({ changed: true, droppedTurns: 1, withinBudget: false });
    expect(second.snapshot.messages[0].kind).toBe('handoff');
  });

  it('记忆化计数器对同一段文本只问宿主一次', async () => {
    const raw = vi.fn(countByChar);
    const counter = createAgentTokenCounter_ACU(raw);
    expect(await counter('AAA')).toBe(3);
    expect(await counter('AAA')).toBe(3);
    expect(await counter('BB')).toBe(2);
    expect(raw).toHaveBeenCalledTimes(2);
  });

  it('统计整份会话的 token 数', async () => {
    // 8 条消息：60 + 60 + 60 + 10 的正文加上 4 条通告/用户消息本身的字数。
    const total = await measureAgentConversationTokens_ACU(threeTurns(), countByChar);
    const expected = threeTurns().messages.reduce((sum, message) => sum + message.text.length, 0);
    expect(total).toBe(expected);
  });
});

describe('压缩时机', () => {
  it('未超预算或不限预算时不压缩', async () => {
    expect(await resolveAgentCompactionTiming_ACU(threeTurns(), 0, false, countByChar)).toMatchObject({ action: 'skip' });
    expect(await resolveAgentCompactionTiming_ACU(threeTurns(), 100_000, false, countByChar)).toMatchObject({ action: 'skip' });
    expect(await resolveAgentCompactionTiming_ACU(buildEmptyAgentConversation_ACU(), 10, true, countByChar)).toMatchObject({ action: 'skip' });
  });

  it('轮次边界上超预算立即压缩', async () => {
    expect(await resolveAgentCompactionTiming_ACU(threeTurns(), 120, false, countByChar)).toMatchObject({ action: 'compact', emergency: false });
  });

  it('同一轮内超预算只登记，等本轮结束再压', async () => {
    const timing = await resolveAgentCompactionTiming_ACU(threeTurns(), 120, true, countByChar);
    expect(timing).toMatchObject({ action: 'defer', emergency: false });
    expect(timing.totalTokens).toBeGreaterThan(120);
  });

  it('同一轮内涨到预算两倍时越界压缩：此时不压缩等于请求必然超长失败', async () => {
    const total = await measureAgentConversationTokens_ACU(threeTurns(), countByChar);
    // 恰好两倍仍然只登记，严格超过两倍才越界。
    expect(await resolveAgentCompactionTiming_ACU(threeTurns(), total / 2, true, countByChar)).toMatchObject({ action: 'defer' });
    expect(await resolveAgentCompactionTiming_ACU(threeTurns(), total / 2 - 1, true, countByChar)).toMatchObject({ action: 'compact', emergency: true });
  });
});

describe('上下文开销计入', () => {
  it('统计一组已渲染提示词消息的 token 总和', async () => {
    const messages = [
      { role: 'system', content: 'AAAA' },
      { role: 'user', content: 'BBBBBB' },
    ];
    expect(await measureAgentPromptTokens_ACU(messages, countByChar)).toBe(10);
    expect(await measureAgentPromptTokens_ACU([], countByChar)).toBe(0);
  });

  it('时机判定把会话之外的开销计入总量：会话本身未超但整体超了同样触发', async () => {
    const snapshot = threeTurns();
    const conversationTokens = await measureAgentConversationTokens_ACU(snapshot, countByChar);
    const budget = conversationTokens + 50;
    expect(await resolveAgentCompactionTiming_ACU(snapshot, budget, false, countByChar, 0)).toMatchObject({ action: 'skip' });
    const triggered = await resolveAgentCompactionTiming_ACU(snapshot, budget, false, countByChar, 100);
    expect(triggered).toMatchObject({ action: 'compact', emergency: false });
    expect(triggered.totalTokens).toBe(conversationTokens + 100);
    // 会话为空时无可压缩：开销再大也只能 skip，压缩改变不了任何东西。
    expect(await resolveAgentCompactionTiming_ACU(buildEmptyAgentConversation_ACU(), 10, false, countByChar, 999)).toMatchObject({ action: 'skip' });
  });

  it('压缩以「会话 + 开销」整体回到预算内为目标', async () => {
    const snapshot = threeTurns();
    const conversationTokens = await measureAgentConversationTokens_ACU(snapshot, countByChar);
    const budget = conversationTokens + 50;
    // 不带开销时未超预算，原样返回；同一预算带上开销后必须真的开始丢轮次。
    expect((await compactAgentConversation_ACU(snapshot, budget, countByChar)).changed).toBe(false);
    const compaction = await compactAgentConversation_ACU(snapshot, budget, countByChar, 100);
    expect(compaction.changed).toBe(true);
    expect(compaction.snapshot.messages[0].kind).toBe('handoff');
    // 报告的总量口径与判定一致：包含开销本身。
    expect(compaction.totalTokens).toBeGreaterThanOrEqual(100);
  });
});

describe('会话压缩（续）', () => {
  it('反复压缩不丢失早期信息：上一次的交接报告被继承进新报告', async () => {
    const first = await compactAgentConversation_ACU(threeTurns(), 120, countByChar);
    const grown = appendAgentConversation_ACU(first.snapshot, [
      { kind: 'turn', text: '开始新的一轮规划：第 4 轮', digest: '第 4 轮', turnKey: 'turn-4' },
      { kind: 'agent', text: 'H'.repeat(80), digest: '交付写作指导', turnKey: 'turn-4' },
    ]);
    const second = await compactAgentConversation_ACU(grown, 100, countByChar);

    expect(second.changed).toBe(true);
    expect(second.snapshot.messages[0].kind).toBe('handoff');
    expect(second.snapshot.messages[0].text).toContain('第 1 轮');
    expect(second.snapshot.messages[0].text).toContain('第 2 轮');
  });
});
