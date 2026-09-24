import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AGENT_CONVERSATION_TEXT_LIMIT_ACU,
  appendAgentConversation_ACU,
  appendAgentConversationToChat_ACU,
  appendConfirmedAgentTurn_ACU,
  appendPreparedAgentConversationMessages_ACU,
  buildEmptyAgentConversation_ACU,
  clearAgentConversationField_ACU,
  lastAnnouncedTurnKey_ACU,
  lastRuntimeSnapshotText_ACU,
  readActiveAgentConversationCompactionMark_ACU,
  readAgentConversation_ACU,
  readAgentConversationCompactionSource_ACU,
  readAgentConversationTimeline_ACU,
  renderAgentConversationMessages_ACU,
  validateAgentConversationSnapshot_ACU,
  writeAgentConversationCompactionMark_ACU,
} from '../../../../src/service/continuation/agent/agent-conversation-store';
import {
  AGENT_CONVERSATION_FIELD_ACU,
  AGENT_CONVERSATION_SCHEMA_VERSION_ACU,
  AGENT_CONVERSATION_SEGMENT_SCHEMA_VERSION_ACU,
  type AgentConversationMessage_ACU,
} from '../../../../src/service/continuation/agent/agent-model';
import { ContinuationValidationError_ACU } from '../../../../src/service/continuation/model';
import { _set_SillyTavern_API_ACU } from '../../../../src/shared/host-api';
import { getActiveChatStorageIdentity_ACU } from '../../../../src/data/storage/chat-history';

const saveChat = vi.fn(async () => undefined);

function useChat(chat: any[]): void {
  _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
}

function snapshotWith(messages: unknown[], overrides: Record<string, unknown> = {}): unknown {
  return { schemaVersion: AGENT_CONVERSATION_SCHEMA_VERSION_ACU, nextId: 1, updatedAt: 0, messages, ...overrides };
}

function floorRecordWith(segment: unknown[], overrides: Record<string, unknown> = {}): unknown {
  return { schemaVersion: AGENT_CONVERSATION_SEGMENT_SCHEMA_VERSION_ACU, updatedAt: 0, segment, ...overrides };
}

function message_ACU(id: number, kind: AgentConversationMessage_ACU['kind'], text: string, extra: Partial<AgentConversationMessage_ACU> = {}): AgentConversationMessage_ACU {
  return { id, kind, text, digest: '', turnKey: '', at: 0, ...extra };
}

function v2Mark_ACU(compactedThroughId = 2): any {
  return { schemaVersion: 2, compactedThroughId, report: 'V2 交接报告', summaryState: { currentGoal: '推进禁区谜团', effectiveConstraints: [], decisions: [], completedItems: [], pendingItems: [], blockers: [], continuityFacts: [], readKeys: [], recentTurns: [] }, at: 1, metrics: { sourceFromId: 1, sourceThroughId: compactedThroughId, beforeTokens: 120, afterTokens: 80, fixedPromptTokens: 20, reportTokens: 10, targetTokens: 96, triggerTokens: 120, droppedMessages: compactedThroughId, droppedTurns: 1, degraded: false } };
}

// mockReset 而不是 mockClear：once 队列里的失败实现必须一并清掉，否则会泄漏到下一个用例。
beforeEach(() => { saveChat.mockReset(); saveChat.mockResolvedValue(undefined); });

describe('会话快照校验', () => {
  it('结构或条目非法整份作废，不把损坏的旧记录伪装成有效历史', () => {
    expect(validateAgentConversationSnapshot_ACU(null)).toBeNull();
    expect(validateAgentConversationSnapshot_ACU({ schemaVersion: 99, messages: [] })).toBeNull();
    expect(validateAgentConversationSnapshot_ACU(snapshotWith('not-an-array' as any))).toBeNull();

    expect(validateAgentConversationSnapshot_ACU(snapshotWith([
      { id: 1, kind: 'user', text: '有效', digest: '你的消息', turnKey: 't1', at: 5 },
      { id: 2, kind: 'unknown-kind', text: '种类非法' },
      { id: 3, kind: 'agent', text: '   ' },
      { id: 0, kind: 'agent', text: 'id 非法' },
      { id: 7, kind: 'agent', text: '也有效' },
    ]))).toBeNull();
    // 仍可兼容旧快照里过低的 nextId，但不得丢弃合法消息。
    const snapshot = validateAgentConversationSnapshot_ACU(snapshotWith([{ id: 7, kind: 'agent', text: '有效' }]));
    expect(snapshot!.nextId).toBe(8);
  });
});

describe('会话分段读取', () => {
  it('按楼层顺序拼接各段，删掉楼层即自动回退', () => {
    const chat = [
      { mes: 'a', [AGENT_CONVERSATION_FIELD_ACU]: floorRecordWith([message_ACU(1, 'user', '第一句')]) },
      { mes: 'b' },
      { mes: 'c', [AGENT_CONVERSATION_FIELD_ACU]: floorRecordWith([message_ACU(2, 'agent', '第二句')]) },
    ];
    const full = readAgentConversation_ACU(chat);
    expect(full.messages.map(item => item.text)).toEqual(['第一句', '第二句']);
    expect(full.nextId).toBe(3);

    // 末楼被删（Swipe/删楼）后该段消失，会话回退到更早状态。
    const rolledBack = readAgentConversation_ACU(chat.slice(0, 2));
    expect(rolledBack.messages.map(item => item.text)).toEqual(['第一句']);
  });

  it('v1 全量快照充当基线段：之前的段被替换，其后楼层的段继续拼接', () => {
    const chat = [
      { mes: 'a', [AGENT_CONVERSATION_FIELD_ACU]: floorRecordWith([message_ACU(1, 'user', '旧段')]) },
      { mes: 'b', [AGENT_CONVERSATION_FIELD_ACU]: snapshotWith([message_ACU(5, 'user', 'v1 基线')]) },
      { mes: 'c', [AGENT_CONVERSATION_FIELD_ACU]: floorRecordWith([message_ACU(6, 'agent', '后续段')]) },
    ];
    const snapshot = readAgentConversation_ACU(chat);
    expect(snapshot.messages.map(item => item.text)).toEqual(['v1 基线', '后续段']);
    expect(snapshot.nextId).toBe(7);
  });

  it('压缩标记做非破坏投影：交接消息置前，删掉承载楼即撤销压缩', () => {
    const early = { mes: 'a', [AGENT_CONVERSATION_FIELD_ACU]: floorRecordWith([message_ACU(1, 'turn', '早期通告', { turnKey: 't1' }), message_ACU(2, 'agent', '早期输出', { turnKey: 't1' })]) };
    const late = { mes: 'b', [AGENT_CONVERSATION_FIELD_ACU]: floorRecordWith([message_ACU(3, 'agent', '最近输出')], { compaction: { compactedThroughId: 2, report: '交接报告内容', at: 1 } }) };

    const projected = readAgentConversation_ACU([early, late]);
    expect(projected.messages.map(item => item.kind)).toEqual(['handoff', 'agent']);
    expect(projected.messages[0].text).toBe('交接报告内容');
    expect(projected.nextId).toBe(4);

    // 标记只存在于被删掉的楼层上时，原始消息原样回来。
    const restored = readAgentConversation_ACU([early]);
    expect(restored.messages.map(item => item.text)).toEqual(['早期通告', '早期输出']);
  });

  it('V2 标记以结构化摘要状态投影，允许没有 blocker、待办或 readKey 的空类别', () => {
    const chat = [
      { mes: 'a', [AGENT_CONVERSATION_FIELD_ACU]: floorRecordWith([message_ACU(1, 'turn', '早期通告'), message_ACU(2, 'agent', '早期输出')]) },
      { mes: 'b', [AGENT_CONVERSATION_FIELD_ACU]: floorRecordWith([message_ACU(3, 'agent', '最近输出')], { compaction: v2Mark_ACU(2) }) },
    ];

    const projected = readAgentConversation_ACU(chat);
    expect(projected.messages.map(item => [item.kind, item.text])).toEqual([['handoff', 'V2 交接报告'], ['agent', '最近输出']]);
    expect(chat[1][AGENT_CONVERSATION_FIELD_ACU].compaction.summaryState.blockers).toEqual([]);
  });

  it('权威回读选择截止 id 最大的标记，并为 V2 返回独立的结构化状态副本', () => {
    const chat = [
      { mes: 'a', [AGENT_CONVERSATION_FIELD_ACU]: floorRecordWith([], { compaction: { compactedThroughId: 1, report: 'V1', at: 1 } }) },
      { mes: 'b', [AGENT_CONVERSATION_FIELD_ACU]: floorRecordWith([], { compaction: v2Mark_ACU(2) }) },
    ];

    const active = readActiveAgentConversationCompactionMark_ACU(chat);
    expect(active).toMatchObject({ schemaVersion: 2, compactedThroughId: 2, report: 'V2 交接报告' });
    if (!active || active.schemaVersion !== 2) throw new Error('expected V2 mark');
    active.summaryState.currentGoal = '篡改副本';
    active.metrics.beforeTokens = 0;
    expect(chat[1][AGENT_CONVERSATION_FIELD_ACU].compaction.summaryState.currentGoal).toBe('推进禁区谜团');
    expect(chat[1][AGENT_CONVERSATION_FIELD_ACU].compaction.metrics.beforeTokens).toBe(120);
  });

  it('拒绝未知或损坏的 V2 压缩标记，而不是把它当作没有压缩', () => {
    const unknownVersion = [{ mes: 'a', [AGENT_CONVERSATION_FIELD_ACU]: floorRecordWith([], { compaction: { ...v2Mark_ACU(), schemaVersion: 3 } }) }];
    const blankArrayItem = [{ mes: 'a', [AGENT_CONVERSATION_FIELD_ACU]: floorRecordWith([], { compaction: { ...v2Mark_ACU(), summaryState: { ...v2Mark_ACU().summaryState, blockers: ['   '] } } }) }];

    expect(() => readAgentConversation_ACU(unknownVersion)).toThrow(ContinuationValidationError_ACU);
    expect(() => readAgentConversation_ACU(blankArrayItem)).toThrow(ContinuationValidationError_ACU);
  });

  it('全程无命中时返回空会话', () => {
    useChat([{ mes: 'a' }, { mes: 'b' }]);
    expect(readAgentConversation_ACU()).toMatchObject({ messages: [], nextId: 1 });
  });
});

describe('会话时间线（展示通道）', () => {
  it('保留全部原始消息，交接报告按截止位置插入且最新一份标注 AI 可见性边界', () => {
    const chat = [
      { mes: 'a', [AGENT_CONVERSATION_FIELD_ACU]: floorRecordWith([message_ACU(1, 'turn', '早期通告'), message_ACU(2, 'agent', '早期输出')]) },
      { mes: 'b', [AGENT_CONVERSATION_FIELD_ACU]: floorRecordWith([message_ACU(3, 'agent', '最近输出')], { compaction: { compactedThroughId: 2, report: '交接报告内容', at: 1 } }) },
    ];
    const timeline = readAgentConversationTimeline_ACU(chat);
    expect(timeline.map(item => [item.kind, item.text])).toEqual([
      ['turn', '早期通告'],
      ['agent', '早期输出'],
      ['handoff', '交接报告内容'],
      ['agent', '最近输出'],
    ]);
    expect(timeline[2].digest).toBe('早期会话交接报告（此前内容对当前 AI 不可见）');

    // 同一份数据在模型通道里只剩交接报告之后的内容——两个通道语义不同。
    expect(readAgentConversation_ACU(chat).messages.map(item => item.kind)).toEqual(['handoff', 'agent']);
  });

  it('多份标记各插一次：更早的标注被取代；删掉末楼后时间线退回上一份标记', () => {
    const chat = [
      { mes: 'a', [AGENT_CONVERSATION_FIELD_ACU]: floorRecordWith([message_ACU(1, 'agent', '第一段')]) },
      { mes: 'b', [AGENT_CONVERSATION_FIELD_ACU]: floorRecordWith([message_ACU(2, 'agent', '第二段')], { compaction: { compactedThroughId: 1, report: '第一份交接', at: 1 } }) },
      { mes: 'c', [AGENT_CONVERSATION_FIELD_ACU]: floorRecordWith([message_ACU(3, 'agent', '第三段')], { compaction: { compactedThroughId: 2, report: '第二份交接', at: 2 } }) },
    ];
    const timeline = readAgentConversationTimeline_ACU(chat);
    expect(timeline.map(item => item.text)).toEqual(['第一段', '第一份交接', '第二段', '第二份交接', '第三段']);
    expect(timeline[1].digest).toBe('早期会话交接报告（已被更晚的总结取代）');
    expect(timeline[3].digest).toBe('早期会话交接报告（此前内容对当前 AI 不可见）');

    // 删掉承载第二份标记的楼层：时间线退回只有第一份交接，且它重新成为可见性边界。
    const rolledBack = readAgentConversationTimeline_ACU(chat.slice(0, 2));
    expect(rolledBack.map(item => item.text)).toEqual(['第一段', '第一份交接', '第二段']);
    expect(rolledBack[1].digest).toBe('早期会话交接报告（此前内容对当前 AI 不可见）');
  });

  it('只剩标记没有消息段时仍输出交接条目；截止值不小于全部消息 id 时挂在末尾', () => {
    const markOnly = [{ mes: 'a', [AGENT_CONVERSATION_FIELD_ACU]: floorRecordWith([], { compaction: { compactedThroughId: 9, report: '孤立交接', at: 1 } }) }];
    expect(readAgentConversationTimeline_ACU(markOnly).map(item => [item.kind, item.text])).toEqual([['handoff', '孤立交接']]);

    const trailing = [
      { mes: 'a', [AGENT_CONVERSATION_FIELD_ACU]: floorRecordWith([message_ACU(1, 'agent', '唯一消息')], { compaction: { compactedThroughId: 1, report: '覆盖全部的交接', at: 1 } }) },
    ];
    expect(readAgentConversationTimeline_ACU(trailing).map(item => item.text)).toEqual(['唯一消息', '覆盖全部的交接']);
  });

  it('没有任何标记时与拼接视图一致，全程无命中时为空数组', () => {
    const chat = [
      { mes: 'a', [AGENT_CONVERSATION_FIELD_ACU]: floorRecordWith([message_ACU(1, 'user', '第一句')]) },
      { mes: 'b', [AGENT_CONVERSATION_FIELD_ACU]: floorRecordWith([message_ACU(2, 'agent', '第二句')]) },
    ];
    expect(readAgentConversationTimeline_ACU(chat).map(item => item.text)).toEqual(['第一句', '第二句']);
    expect(readAgentConversationTimeline_ACU([{ mes: 'a' }])).toEqual([]);
  });

  it('maxMessages 只解析末尾窗口，不读取更早楼层', () => {
    const chat = Array.from({ length: 6 }, (_, index) => ({
      mes: `floor-${index}`,
      [AGENT_CONVERSATION_FIELD_ACU]: floorRecordWith([message_ACU(index + 1, 'agent', `消息${index + 1}`)]),
    }));
    expect(readAgentConversationTimeline_ACU(chat, { maxMessages: 2 }).map(item => item.text)).toEqual(['消息5', '消息6']);
    expect(readAgentConversationTimeline_ACU(chat).map(item => item.text)).toHaveLength(6);
  });
});

describe('会话落盘', () => {
  it('段追加写入末楼并跳过已存在的 id；空聊天不写盘', async () => {
    const chat: any[] = [{ mes: 'a' }, { mes: 'b' }];
    useChat(chat);
    expect(await appendPreparedAgentConversationMessages_ACU(chat, [message_ACU(1, 'user', '第一句')])).toBe(true);
    expect(chat[1][AGENT_CONVERSATION_FIELD_ACU].segment).toHaveLength(1);
    expect(saveChat).toHaveBeenCalledOnce();

    // 同 id 重复追加不写盘（重复 flush 幂等）。
    expect(await appendPreparedAgentConversationMessages_ACU(chat, [message_ACU(1, 'user', '第一句')])).toBe(false);
    expect(saveChat).toHaveBeenCalledOnce();

    expect(await appendPreparedAgentConversationMessages_ACU([], [message_ACU(2, 'user', '无处可放')])).toBe(false);
  });

  it('首楼 read 原文跨正文楼仍在模型历史里；确认通告只写对应正文楼且去重', async () => {
    const chat: any[] = [{ mes: '开场' }];
    useChat(chat);
    await appendAgentConversationToChat_ACU([{ kind: 'tool', text: '### 原文（$STORY_TAIL）\n首次读到的守门人手势', digest: '调阅 $STORY_TAIL', readKey: '$STORY_TAIL', turnKey: 's#1#t1' }], chat);
    chat.push({ mes: '第一轮正文', is_user: false });
    expect(await appendConfirmedAgentTurn_ACU(chat, 1, 's#1#t2', '正文已确认，继续第二轮')).toBe(true);
    expect(await appendConfirmedAgentTurn_ACU(chat, 1, 's#1#t2', '重复的结束事件')).toBe(false);
    const rendered = renderAgentConversationMessages_ACU(readAgentConversation_ACU(chat));
    expect(rendered.map(item => item.content).join('\n')).toContain('首次读到的守门人手势');
    expect(rendered.map(item => item.content).join('\n')).toContain('正文已确认，继续第二轮');
    expect(chat[0][AGENT_CONVERSATION_FIELD_ACU].segment).toHaveLength(1);
    expect(chat[1][AGENT_CONVERSATION_FIELD_ACU].segment).toHaveLength(1);
    expect(readAgentConversation_ACU(chat.slice(0, 1)).messages.map(item => item.kind)).toEqual(['tool']);
    chat.push({ mes: '用户新消息', is_user: true });
    expect(await appendConfirmedAgentTurn_ACU(chat, 1, 's#1#t3', '迟到事件')).toBe(false);
    expect(chat[2][AGENT_CONVERSATION_FIELD_ACU]).toBeUndefined();
  });

  it('压缩标记写入末楼；已有更大的标记时保持不动', async () => {
    const chat: any[] = [{ mes: 'a' }];
    useChat(chat);
    expect(await writeAgentConversationCompactionMark_ACU(chat, { compactedThroughId: 5, report: '报告一', at: 1 })).toBe(true);
    expect(chat[0][AGENT_CONVERSATION_FIELD_ACU].compaction.compactedThroughId).toBe(5);
    expect(await writeAgentConversationCompactionMark_ACU(chat, { compactedThroughId: 3, report: '更小的标记', at: 2 })).toBe(false);
    expect(chat[0][AGENT_CONVERSATION_FIELD_ACU].compaction.report).toBe('报告一');
  });

  it('并发追加、Swipe 和更换末楼时拒绝过期标记且不写盘', async () => {
    const early = { mes: '正文 1', [AGENT_CONVERSATION_FIELD_ACU]: floorRecordWith([message_ACU(1, 'agent', '旧动作', { turnKey: 't1' })]) };
    const anchor: any = { mes: '正文 2', swipe_id: 0, [AGENT_CONVERSATION_FIELD_ACU]: floorRecordWith([message_ACU(2, 'tool', '旧回执', { turnKey: 't1' })]) };
    const chat: any[] = [early, anchor];
    useChat(chat);
    const mark = v2Mark_ACU(2);
    const expected = { fingerprint: readAgentConversationCompactionSource_ACU(chat).fingerprint, anchor, swipeId: '0', chatIdentity: getActiveChatStorageIdentity_ACU(chat) };
    anchor[AGENT_CONVERSATION_FIELD_ACU] = floorRecordWith([message_ACU(2, 'tool', '旧回执', { turnKey: 't1' }), message_ACU(3, 'user', '中途新指令', { turnKey: 't2' })]);
    expect(await writeAgentConversationCompactionMark_ACU(chat, mark, expected)).toBe(false);
    expect(saveChat).not.toHaveBeenCalled();
    anchor[AGENT_CONVERSATION_FIELD_ACU] = floorRecordWith([message_ACU(2, 'tool', '旧回执', { turnKey: 't1' })]);
    anchor.swipe_id = 1;
    expect(await writeAgentConversationCompactionMark_ACU(chat, mark, expected)).toBe(false);
    anchor.swipe_id = 0;
    chat.push({ mes: '新末楼' });
    expect(await writeAgentConversationCompactionMark_ACU(chat, mark, expected)).toBe(false);
    expect(readAgentConversation_ACU(chat).messages.map(item => item.text)).toEqual(['旧动作', '旧回执']);
  });

  it('标记保存失败仍保留原始消息与原楼层字段', async () => {
    const chat: any[] = [{ mes: '正文 1', [AGENT_CONVERSATION_FIELD_ACU]: floorRecordWith([message_ACU(1, 'agent', '旧动作')]) }, { mes: '正文 2' }];
    useChat(chat);
    const anchor = chat[1];
    const expected = { fingerprint: readAgentConversationCompactionSource_ACU(chat).fingerprint, anchor, swipeId: '0', chatIdentity: getActiveChatStorageIdentity_ACU(chat) };
    saveChat.mockRejectedValueOnce(new Error('host refused'));
    await expect(writeAgentConversationCompactionMark_ACU(chat, { compactedThroughId: 1, report: '摘要', at: 1 }, expected)).rejects.toBeInstanceOf(ContinuationValidationError_ACU);
    expect(chat[1][AGENT_CONVERSATION_FIELD_ACU]).toBeUndefined();
    expect(readAgentConversation_ACU(chat).messages.map(item => item.text)).toEqual(['旧动作']);
  });

  it('损坏楼层、损坏旧快照和冲突消息 ID 均在读取时明确失败', () => {
    const brokenSegment = [{ mes: '正文', [AGENT_CONVERSATION_FIELD_ACU]: floorRecordWith([message_ACU(1, 'agent', '原文'), { id: 2, kind: 'invalid' }]) }];
    expect(() => readAgentConversation_ACU(brokenSegment)).toThrow(ContinuationValidationError_ACU);
    const brokenLegacy = [{ mes: '正文', [AGENT_CONVERSATION_FIELD_ACU]: snapshotWith([{ id: 1, kind: 'agent', text: '原文' }, { id: 0, kind: 'agent', text: '坏记录' }]) }];
    expect(() => readAgentConversation_ACU(brokenLegacy)).toThrow(ContinuationValidationError_ACU);
    const duplicates = [
      { mes: '正文 1', [AGENT_CONVERSATION_FIELD_ACU]: floorRecordWith([message_ACU(1, 'agent', '原文')]) },
      { mes: '正文 2', [AGENT_CONVERSATION_FIELD_ACU]: floorRecordWith([message_ACU(1, 'tool', '冲突')]) },
    ];
    expect(() => readAgentConversation_ACU(duplicates)).toThrow(ContinuationValidationError_ACU);
  });

  it('写盘失败时还原楼层字段，不留半成品', async () => {
    const chat: any[] = [{ mes: 'a' }];
    useChat(chat);
    saveChat.mockRejectedValueOnce(new Error('host refused'));
    await expect(appendPreparedAgentConversationMessages_ACU(chat, [message_ACU(1, 'user', '第一句')])).rejects.toBeInstanceOf(ContinuationValidationError_ACU);
    expect(Object.prototype.hasOwnProperty.call(chat[0], AGENT_CONVERSATION_FIELD_ACU)).toBe(false);
  });

  it('追加到当前聊天时写入末楼；空条目与空聊天都不写盘', async () => {
    const chat: any[] = [{ mes: 'a' }, { mes: 'b' }];
    useChat(chat);
    expect(await appendAgentConversationToChat_ACU([{ kind: 'user', text: '别揭穿守门人', digest: '你的消息', turnKey: '' }])).toBe(true);
    expect(chat[1][AGENT_CONVERSATION_FIELD_ACU].segment[0].text).toBe('别揭穿守门人');
    expect(saveChat).toHaveBeenCalledOnce();

    expect(await appendAgentConversationToChat_ACU([{ kind: 'user', text: '   ', digest: '', turnKey: '' }])).toBe(false);
    expect(saveChat).toHaveBeenCalledOnce();

    useChat([]);
    expect(await appendAgentConversationToChat_ACU([{ kind: 'user', text: '无处可放', digest: '', turnKey: '' }])).toBe(false);
  });

  it('一键清空只删会话字段，正文与其他字段保持原样', async () => {
    const chat: any[] = [
      { mes: '正文一', [AGENT_CONVERSATION_FIELD_ACU]: snapshotWith([]), other: 'keep' },
      { mes: '正文二' },
    ];
    useChat(chat);
    expect(await clearAgentConversationField_ACU()).toBe(true);
    expect(chat[0]).toEqual({ mes: '正文一', other: 'keep' });
    expect(chat[1]).toEqual({ mes: '正文二' });
    // 没有字段可删时不写盘。
    saveChat.mockClear();
    expect(await clearAgentConversationField_ACU()).toBe(false);
    expect(saveChat).not.toHaveBeenCalled();
  });
});

describe('会话追加与渲染', () => {
  it('追加分配递增 id，空文本被忽略且返回原引用', () => {
    const empty = buildEmptyAgentConversation_ACU();
    expect(appendAgentConversation_ACU(empty, [{ kind: 'user', text: '  ', digest: '', turnKey: '' }])).toBe(empty);

    const next = appendAgentConversation_ACU(empty, [
      { kind: 'turn', text: '新的一轮', digest: '第 1 轮', turnKey: 't1' },
      { kind: 'agent', text: '我的输出', digest: '交付写作指导', turnKey: 't1' },
    ]);
    expect(next.messages.map(message => message.id)).toEqual([1, 2]);
    expect(next.nextId).toBe(3);
  });

  it('展示通告过长时截断标注，不截断模型动作、工具结果及用户要求', () => {
    const long = 'x'.repeat(AGENT_CONVERSATION_TEXT_LIMIT_ACU + 500);
    const next = appendAgentConversation_ACU(buildEmptyAgentConversation_ACU(), [
      { kind: 'turn', text: long, digest: '', turnKey: '' },
      { kind: 'agent', text: long, digest: '', turnKey: '' },
      { kind: 'tool', text: long, digest: '', turnKey: '' },
      { kind: 'user', text: long, digest: '', turnKey: '' },
    ]);
    expect(next.messages[0].text.length).toBeLessThan(long.length);
    expect(next.messages[0].text).toContain('已截断');
    expect(next.messages.slice(1).every(message => message.text === long)).toBe(true);
  });

  it('运行时快照不截断，目录正文必须完整到达模型', () => {
    const long = '目录'.repeat(AGENT_CONVERSATION_TEXT_LIMIT_ACU);
    const next = appendAgentConversation_ACU(buildEmptyAgentConversation_ACU(), [{ kind: 'runtime', text: long, digest: '运行时快照', turnKey: 't1' }]);
    expect(next.messages[0].text).toBe(long);
    expect(next.messages[0].text).not.toContain('已截断');
  });

  it('渲染时只有主 Agent 自己的输出是 assistant，其余带来源前缀走 user', () => {
    const snapshot = appendAgentConversation_ACU(buildEmptyAgentConversation_ACU(), [
      { kind: 'user', text: '别揭穿', digest: '', turnKey: 't1' },
      { kind: 'turn', text: '开始新的一轮', digest: '', turnKey: 't1' },
      { kind: 'agent', text: '{"action":"finalize"}', digest: '', turnKey: 't1' },
      { kind: 'tool', text: '派工成功', digest: '', turnKey: 't1' },
      { kind: 'runtime', text: '【本回合运行时数据】\n预算充足', digest: '运行时快照', turnKey: 't1' },
      { kind: 'handoff', text: '早期浓缩', digest: '', turnKey: '' },
    ]);
    expect(renderAgentConversationMessages_ACU(snapshot)).toEqual([
      { role: 'user', content: '【用户】\n别揭穿' },
      { role: 'user', content: '【新的一轮】\n开始新的一轮' },
      { role: 'assistant', content: '{"action":"finalize"}' },
      { role: 'user', content: '【工具结果】\n派工成功' },
      { role: 'user', content: '【运行时快照】\n【本回合运行时数据】\n预算充足' },
      { role: 'user', content: '【早期会话交接报告】\n早期浓缩' },
    ]);
  });

  it('追加同一 readKey 的新快照后，既有渲染前缀保持逐字不变', () => {
    const before = appendAgentConversation_ACU(buildEmptyAgentConversation_ACU(), [
      { kind: 'tool', text: '旧版角色表内容', digest: '', turnKey: 't1', readKey: '$TABLE:角色表' },
      { kind: 'agent', text: '中间输出', digest: '', turnKey: 't1' },
    ]);
    const renderedBefore = renderAgentConversationMessages_ACU(before);
    const after = appendAgentConversation_ACU(before, [
      { kind: 'tool', text: '新版角色表内容', digest: '', turnKey: 't2', readKey: '$TABLE:角色表' },
    ]);
    const renderedAfter = renderAgentConversationMessages_ACU(after);

    expect(renderedAfter.slice(0, renderedBefore.length)).toEqual(renderedBefore);
    expect(renderedBefore[0].content).toBe('【工具结果】\n旧版角色表内容');
    expect(renderedAfter[2].content).toBe('【工具结果】\n新版角色表内容');
  });

  it('最后一次换轮通告的游标可被查出，没有通告时为空串', () => {
    expect(lastAnnouncedTurnKey_ACU(buildEmptyAgentConversation_ACU())).toBe('');
    const snapshot = appendAgentConversation_ACU(buildEmptyAgentConversation_ACU(), [
      { kind: 'turn', text: '第一轮', digest: '', turnKey: 't1' },
      { kind: 'turn', text: '第二轮', digest: '', turnKey: 't2' },
      { kind: 'agent', text: '输出', digest: '', turnKey: 't2' },
    ]);
    expect(lastAnnouncedTurnKey_ACU(snapshot)).toBe('t2');
  });

  it('最近一条运行时快照取投影视图里最后出现的正文，没有则为空串', () => {
    expect(lastRuntimeSnapshotText_ACU(buildEmptyAgentConversation_ACU())).toBe('');
    const snapshot = appendAgentConversation_ACU(buildEmptyAgentConversation_ACU(), [
      { kind: 'runtime', text: '旧快照', digest: '运行时快照', turnKey: 't1' },
      { kind: 'agent', text: '输出', digest: '', turnKey: 't1' },
      { kind: 'runtime', text: '新快照', digest: '运行时快照', turnKey: 't1' },
    ]);
    expect(lastRuntimeSnapshotText_ACU(snapshot)).toBe('新快照');
  });
});
