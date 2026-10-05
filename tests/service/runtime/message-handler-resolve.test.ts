/**
 * tests/service/runtime/message-handler-resolve.test.ts
 * resolveGeneratedAiMessageIndex_ACU 纯函数表驱动测试
 */
import { describe, expect, it } from 'vitest';
import {
  resolveGeneratedAiMessageIndex_ACU,
  isAiMessage_ACU,
  countAiMessages_ACU,
  type AutoFillIntent_ACU,
} from '../../../src/service/runtime/message-handler';

function makeIntent(partial: Partial<AutoFillIntent_ACU> = {}): AutoFillIntent_ACU {
  return {
    eventMessageId: 1,
    chatKey: 'chat-a',
    isolationKey: '',
    capturedAt: Date.now(),
    capturedChatLength: 2,
    capturedAiFloorCount: 1,
    ...partial,
  };
}

const user = { is_user: true, mes: '用户' };
const ai = { is_user: false, mes: 'AI', name: '角色A' };
const narrator = { is_user: false, mes: '旁白', extra: { type: 'narrator' } };

function chatWith(messages: any[]): any[] {
  return messages;
}

describe('isAiMessage_ACU', () => {
  it('识别 AI 楼层', () => {
    expect(isAiMessage_ACU(ai)).toBe(true);
  });
  it('排除用户楼层', () => {
    expect(isAiMessage_ACU(user)).toBe(false);
  });
  it('排除 narrator 系统旁白', () => {
    expect(isAiMessage_ACU(narrator)).toBe(false);
  });
  it('排除 null/非对象', () => {
    expect(isAiMessage_ACU(null)).toBe(false);
    expect(isAiMessage_ACU(undefined)).toBe(false);
    expect(isAiMessage_ACU('x')).toBe(false);
  });
});

describe('countAiMessages_ACU', () => {
  it('统计 AI 楼层数（排除用户与旁白）', () => {
    expect(countAiMessages_ACU([user, ai, narrator, ai])).toBe(2);
  });
  it('非数组返回 0', () => {
    expect(countAiMessages_ACU(null as any)).toBe(0);
  });
});

describe('resolveGeneratedAiMessageIndex_ACU', () => {
  it('精确命中：eventMessageId 指向 AI 楼层 → resolved', () => {
    const liveChat = chatWith([user, ai]);
    const result = resolveGeneratedAiMessageIndex_ACU({ liveChat, intent: makeIntent({ eventMessageId: 1, capturedChatLength:1, capturedAiFloorCount: 1 }) });
    expect(result).toEqual({ kind: 'resolved', messageIndex: 1 });
  });

  it('按消息对象的稳定 message_id 唯一命中 AI 楼层', () => {
    const liveChat = chatWith([
      { ...user, message_id: 10 },
      { ...ai, message_id: 42 },
    ]);
    const result = resolveGeneratedAiMessageIndex_ACU({
      liveChat,
      intent: makeIntent({ eventMessageId: 42, capturedChatLength: 2, capturedAiFloorCount: 1 }),
    });
    expect(result).toEqual({ kind: 'resolved', messageIndex: 1 });
  });

  it('正文事件明确使用数组下标，不被另一消息的同值稳定 ID 抢先匹配', () => {
    const liveChat = chatWith([
      { ...ai, message_id: 1, mes: '历史消息' },
      { ...ai, message_id: 99, mes: '事件目标' },
    ]);
    const result = resolveGeneratedAiMessageIndex_ACU({
      liveChat,
      intent: makeIntent({ eventMessageId: 1, eventMessageIdKind: 'index' }),
    });
    expect(result).toEqual({ kind: 'resolved', messageIndex: 1 });
  });

  it('正文事件不把已删除目标下标减一映射到历史尾楼', () => {
    const result = resolveGeneratedAiMessageIndex_ACU({
      liveChat: chatWith([user, ai]),
      intent: makeIntent({ eventMessageId: 2, eventMessageIdKind: 'index' }),
    });
    // 保留事件下标，交给已有动作评估判断目标是否仍有效。
    expect(result).toEqual({ kind: 'resolved', messageIndex: 2 });
  });

  it('稳定 message_id 与另一个 AI 的数组索引冲突时，稳定 ID 优先', () => {
    const liveChat = chatWith([
      { ...ai, message_id: 1, mes: '稳定 ID 目标' },
      { ...ai, message_id: 99, mes: '数组索引碰巧等于事件值' },
    ]);
    const result = resolveGeneratedAiMessageIndex_ACU({
      liveChat,
      intent: makeIntent({
        eventMessageId: 1,
        capturedChatLength: 2,
        capturedAiFloorCount: 2,
      }),
    });
    expect(result).toEqual({ kind: 'resolved', messageIndex: 0 });
  });

  it('重复 message_id 命中多个 AI 楼层时返回 ambiguous，不猜', () => {
    const liveChat = chatWith([
      { ...ai, message_id: 42 },
      { ...ai, message_id: 42 },
    ]);
    const result = resolveGeneratedAiMessageIndex_ACU({
      liveChat,
      intent: makeIntent({ eventMessageId: 42, capturedChatLength: 2, capturedAiFloorCount: 2 }),
    });
    expect(result).toEqual({ kind: 'ambiguous', candidates: [0, 1] });
  });

  it('真实宿主场景：eventMessageId 等于 chat.length 且边界未变、尾楼为 AI → 映射到末尾索引', () => {
    const liveChat = chatWith([user, ai]);
    const result = resolveGeneratedAiMessageIndex_ACU({
      liveChat,
      intent: makeIntent({ eventMessageId: 2, capturedChatLength: 2, capturedAiFloorCount: 1 }),
    });
    expect(result).toEqual({ kind: 'resolved', messageIndex: 1 });
  });

  it('eventMessageId 等于 chat.length 但尾楼是用户时不得盲目 -1', () => {
    const liveChat = chatWith([ai, user]);
    const result = resolveGeneratedAiMessageIndex_ACU({
      liveChat,
      intent: makeIntent({ eventMessageId: 2, capturedChatLength: 2, capturedAiFloorCount: 1 }),
    });
    expect(result).toEqual({ kind: 'pending_materialization', candidates: [] });
  });

  it('用户锚点 + 捕获后延迟追加 AI → 从捕获边界解析唯一候选', () => {
    // 捕获时 chat 为 [user, user]，长度为 2，AI 数 0；防抖后追加了 AI
    const liveChat = chatWith([user, user, ai]);
    const result = resolveGeneratedAiMessageIndex_ACU({ liveChat, intent: makeIntent({ eventMessageId: 1, capturedChatLength: 2, capturedAiFloorCount: 0 }) });
    expect(result).toEqual({ kind: 'resolved', messageIndex: 2 });
  });

  it('锚点后区间兜底：捕获长度不可靠但 AI 总数增加时解析', () => {
    // eventMessageId=0 是用户，捕获长度=1 但 liveChat 更长；AI 总数从 0 增至 1
    const liveChat = chatWith([user, ai]);
    const result = resolveGeneratedAiMessageIndex_ACU({ liveChat, intent: makeIntent({ eventMessageId: 0, capturedChatLength: 0, capturedAiFloorCount: 0 }) });
    expect(result).toEqual({ kind: 'resolved', messageIndex: 1 });
  });

  it('系统消息干扰：捕获后追加 narrator + AI → 只解析 AI', () => {
    const liveChat = chatWith([user, user, narrator, ai]);
    const result = resolveGeneratedAiMessageIndex_ACU({ liveChat, intent: makeIntent({ eventMessageId: 1, capturedChatLength: 2, capturedAiFloorCount: 0 }) });
    expect(result).toEqual({ kind: 'resolved', messageIndex: 3 });
  });

  it('双 AI 歧义：捕获后出现两个合格 AI 候选 → ambiguous，不猜', () => {
    const liveChat = chatWith([user, user, ai, ai]);
    const result = resolveGeneratedAiMessageIndex_ACU({ liveChat, intent: makeIntent({ eventMessageId: 1, capturedChatLength: 2, capturedAiFloorCount: 0 }) });
    expect(result.kind).toBe('ambiguous');
    expect(result.kind === 'ambiguous' && result.candidates).toEqual([2, 3]);
  });

  it('尚未物化：AI 楼层始终未出现 → pending_materialization', () => {
    const liveChat = chatWith([user, user]);
    const result = resolveGeneratedAiMessageIndex_ACU({ liveChat, intent: makeIntent({ eventMessageId: 1, capturedChatLength: 2, capturedAiFloorCount: 0 }) });
    expect(result).toEqual({ kind: 'pending_materialization', candidates: [] });
  });

  it('越界 eventMessageId 且无新增候选 → pending', () => {
    const liveChat = chatWith([user, ai]);
    const result = resolveGeneratedAiMessageIndex_ACU({ liveChat, intent: makeIntent({ eventMessageId: 99, capturedChatLength: 2, capturedAiFloorCount: 1 }) });
    expect(result.kind).toBe('pending_materialization');
  });

  it('一基尾楼映射在捕获长度与实时长度不一致且无新增候选时不生效', () => {
    const liveChat = chatWith([user, ai]);
    const result = resolveGeneratedAiMessageIndex_ACU({
      liveChat,
      intent: makeIntent({ eventMessageId: 2, capturedChatLength: 3, capturedAiFloorCount: 1 }),
    });
    expect(result.kind).toBe('pending_materialization');
  });

  it('一基尾楼映射要求捕获与实时 AI 数一致', () => {
    const liveChat = chatWith([user, ai]);
    const result = resolveGeneratedAiMessageIndex_ACU({
      liveChat,
      intent: makeIntent({ eventMessageId: 2, capturedChatLength: 2, capturedAiFloorCount: 0 }),
    });
    // AI 数增加时应由捕获后/锚点后候选规则处理；此例没有捕获后区间，不能冒充一基尾楼命中。
    expect(result.kind).toBe('pending_materialization');
  });

  it('捕获长度超过 liveChat 长度时不越界解析', () => {
    const liveChat = chatWith([user]);
    const result = resolveGeneratedAiMessageIndex_ACU({ liveChat, intent: makeIntent({ eventMessageId: 1, capturedChatLength: 5, capturedAiFloorCount: 1 }) });
    expect(result.kind).toBe('pending_materialization');
  });

  it('liveChat 非数组或 intent 缺失 → invalid_intent', () => {
    expect(resolveGeneratedAiMessageIndex_ACU({ liveChat: null as any, intent: makeIntent() }).kind).toBe('invalid_intent');
    expect(resolveGeneratedAiMessageIndex_ACU({ liveChat: [], intent: null as any }).kind).toBe('invalid_intent');
  });
});
