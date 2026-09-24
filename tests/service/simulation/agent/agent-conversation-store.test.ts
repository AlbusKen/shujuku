import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WORLD_SIMULATION_CONVERSATION_FIELD_ACU } from '../../../../src/service/simulation/agent/agent-model';
import {
  appendWorldSimulationConversationSegment_ACU,
  appendWorldSimulationDirectorHistory_ACU,
  readWorldSimulationDirectorCompactionSource_ACU,
  readWorldSimulationDirectorHistory_ACU,
  appendWorldSimulationSessionEvent_ACU,
  appendWorldSimulationUserInstruction_ACU,
  nextWorldSimulationUserInstructionSegmentId_ACU,
  readWorldSimulationConversation_ACU,
  writeWorldSimulationConversationCompaction_ACU,
} from '../../../../src/service/simulation/agent/agent-conversation-store';
import { resolveWorldSimulationAnchor_ACU } from '../../../../src/service/simulation/simulation-store';
import { _set_SillyTavern_API_ACU } from '../../../../src/shared/host-api';

describe('world simulation conversation segments', () => {
  const saveChat = vi.fn().mockResolvedValue(undefined);
  beforeEach(() => { saveChat.mockClear(); _set_SillyTavern_API_ACU(undefined); });

  it('appends one segment per save and follows active swipe rollback', async () => {
    const chat: any[] = [
      { message_id: 10, mes: 'first', swipe_id: 0 },
      { message_id: 20, mes: 'second-a', swipe_id: 0, swipes: ['second-a', 'second-b'] },
    ];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
    const first = resolveWorldSimulationAnchor_ACU(0, chat);
    const second = resolveWorldSimulationAnchor_ACU(1, chat);
    await appendWorldSimulationConversationSegment_ACU({ anchor: first, segmentId: 'seg-1', runId: 'run-1', taskId: 'task-1', stageId: 'stage-1', stageRevision: 1, appends: [{ kind: 'user', text: 'u1' }] }, chat);
    await appendWorldSimulationConversationSegment_ACU({ anchor: second, segmentId: 'seg-2', runId: 'run-1', taskId: 'task-1', stageId: 'stage-1', stageRevision: 1, appends: [{ kind: 'agent', text: 'a1' }] }, chat);
    expect(readWorldSimulationConversation_ACU(chat).messages.map(item => item.text)).toEqual(['u1', 'a1']);
    expect(saveChat).toHaveBeenCalledTimes(2);

    chat[1].swipe_id = 1;
    chat[1].mes = 'second-b';
    expect(readWorldSimulationConversation_ACU(chat).messages.map(item => item.text)).toEqual(['u1']);

    chat[1].swipe_id = 0;
    chat[1].mes = 'second-a';
    expect(readWorldSimulationConversation_ACU(chat).messages.map(item => item.text)).toEqual(['u1', 'a1']);
    expect(chat[0]._qrf_continuation_agent_chat).toBeUndefined();
  });

  it('读取母版 version=1 会话并在首次追加时原子升级为当前 bucket', async () => {
    const chat: any[] = [{
      message_id: 2,
      mes: 'legacy body',
      swipe_id: 0,
      swipes: ['legacy body'],
      [WORLD_SIMULATION_CONVERSATION_FIELD_ACU]: {
        version: 1,
        entries: [{
          swipe: { messageIndex: 0, messageKey: 'number:2', swipeIndex: 0, baseTextHash: 'legacy-hash' },
          nextId: 2,
          messages: [{ id: 1, at: 10, kind: 'user', status: 'done', title: '你的补充', detail: '推进港口局势' }],
        }],
      },
    }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);

    expect(readWorldSimulationConversation_ACU(chat)).toMatchObject({
      diagnostics: [],
      messages: [{ id: 1, kind: 'user', text: '推进港口局势', digest: '你的补充' }],
    });
    expect(saveChat).not.toHaveBeenCalled();

    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    await appendWorldSimulationConversationSegment_ACU({
      anchor,
      segmentId: 'seg-current',
      runId: 'run-current',
      taskId: 'task-current',
      stageId: 'stage-current',
      stageRevision: 1,
      appends: [{ kind: 'agent', text: '已接收并开始核验' }],
    }, chat);

    const upgraded = chat[0][WORLD_SIMULATION_CONVERSATION_FIELD_ACU];
    expect(upgraded).toMatchObject({ schemaVersion: 1, entries: expect.any(Object) });
    expect(upgraded.version).toBeUndefined();
    expect(readWorldSimulationConversation_ACU(chat).messages.map(item => item.text)).toEqual([
      '推进港口局势',
      '已接收并开始核验',
    ]);
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it('未知损坏格式 fail-closed，追加时不覆盖原字段且不保存', async () => {
    const damaged = { version: 1, entries: [], unexpected: true };
    const chat: any[] = [{
      message_id: 2,
      mes: 'body',
      swipe_id: 0,
      [WORLD_SIMULATION_CONVERSATION_FIELD_ACU]: damaged,
    }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);

    expect(readWorldSimulationConversation_ACU(chat).diagnostics).toHaveLength(1);
    await expect(appendWorldSimulationConversationSegment_ACU({
      anchor,
      segmentId: 'seg-rejected',
      runId: 'run-rejected',
      taskId: 'task-rejected',
      stageId: 'stage-rejected',
      stageRevision: 1,
      appends: [{ kind: 'user', text: '不得覆盖' }],
    }, chat)).rejects.toMatchObject({ error: { code: 'WORLD_SIMULATION_SNAPSHOT_INVALID' } });
    expect(chat[0][WORLD_SIMULATION_CONVERSATION_FIELD_ACU]).toBe(damaged);
    expect(saveChat).not.toHaveBeenCalled();
  });

  it('持久化会话事件元数据并可完整读取', async () => {
    const chat: any[] = [{ message_id: 7, mes: 'anchor', swipe_id: 0 }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-events', getCurrentChatId: () => 'chat-events', saveChat } as any);
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);

    await appendWorldSimulationSessionEvent_ACU({
      anchor,
      runId: 'run-events',
      taskId: 'task-events',
      stageId: 'stage-events',
      stageRevision: 2,
      eventKey: 'tool-1',
      event: {
        kind: 'tool_read',
        title: '资料读取部分失败',
        detail: 'ledger:current unavailable',
        agentName: 'world-director',
        ok: false,
        status: 'failed',
      },
    }, chat);

    expect(readWorldSimulationConversation_ACU(chat).messages).toMatchObject([{
      kind: 'tool',
      text: 'ledger:current unavailable',
      digest: '资料读取部分失败',
      eventKind: 'tool_read',
      title: '资料读取部分失败',
      agentName: 'world-director',
      ok: false,
      status: 'failed',
    }]);
  });

  it('同一聊天的并发追加被串行化且不会丢段或复用消息 ID', async () => {
    const chat: any[] = [{ message_id: 8, mes: 'anchor', swipe_id: 0 }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-serial', getCurrentChatId: () => 'chat-serial', saveChat } as any);
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    const append = (index: number) => appendWorldSimulationConversationSegment_ACU({
      anchor,
      segmentId: `seg-${index}`,
      runId: 'run-serial',
      taskId: 'task-serial',
      stageId: 'stage-serial',
      stageRevision: 1,
      appends: [{ kind: 'agent' as const, text: `event-${index}` }],
    }, chat);

    await Promise.all([append(1), append(2), append(3)]);

    const messages = readWorldSimulationConversation_ACU(chat).messages;
    expect(messages.map(item => item.text)).toEqual(['event-1', 'event-2', 'event-3']);
    expect(new Set(messages.map(item => item.id)).size).toBe(3);
    expect(saveChat).toHaveBeenCalledTimes(3);
  });

  it('楼层位移后会话段追加仍命中原楼层', async () => {
    const chat: any[] = [
      { message_id: 1, mes: 'first-floor', swipe_id: 0 },
      { message_id: 20, mes: 'anchor-body', swipe_id: 0 },
    ];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
    const staleAnchor = resolveWorldSimulationAnchor_ACU(1, chat);
    await appendWorldSimulationConversationSegment_ACU({
      anchor: staleAnchor,
      segmentId: 'seg-kept',
      runId: 'run-shift',
      taskId: 'task-shift',
      stageId: 'stage-shift',
      stageRevision: 1,
      appends: [{ kind: 'user', text: 'kept-instruction' }],
    }, chat);

    chat.splice(1, 0, { is_user: true, mes: 'inserted-floor' });

    await appendWorldSimulationConversationSegment_ACU({
      anchor: staleAnchor,
      segmentId: 'seg-after-shift',
      runId: 'run-shift',
      taskId: 'task-shift',
      stageId: 'stage-shift',
      stageRevision: 1,
      appends: [{ kind: 'user', text: 'after-shift' }],
    }, chat);

    expect(readWorldSimulationConversation_ACU(chat).messages.map(item => item.text)).toEqual([
      'kept-instruction',
      'after-shift',
    ]);
    expect(chat[2][WORLD_SIMULATION_CONVERSATION_FIELD_ACU]).toBeDefined();
    expect(chat[1][WORLD_SIMULATION_CONVERSATION_FIELD_ACU]).toBeUndefined();
  });

  it('锚点楼层 digest 变化时会话段追加 fail-closed', async () => {
    const chat: any[] = [
      { message_id: 1, mes: 'first-floor', swipe_id: 0 },
      { message_id: 20, mes: 'anchor-body', swipe_id: 0 },
    ];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
    const staleAnchor = resolveWorldSimulationAnchor_ACU(1, chat);
    await appendWorldSimulationConversationSegment_ACU({
      anchor: staleAnchor,
      segmentId: 'seg-kept',
      runId: 'run-digest',
      taskId: 'task-digest',
      stageId: 'stage-digest',
      stageRevision: 1,
      appends: [{ kind: 'user', text: 'kept-instruction' }],
    }, chat);
    const previous = chat[1][WORLD_SIMULATION_CONVERSATION_FIELD_ACU];
    saveChat.mockClear();
    chat[1].mes = 'anchor-body-edited';

    await expect(appendWorldSimulationConversationSegment_ACU({
      anchor: staleAnchor,
      segmentId: 'seg-after-edit',
      runId: 'run-digest',
      taskId: 'task-digest',
      stageId: 'stage-digest',
      stageRevision: 1,
      appends: [{ kind: 'user', text: 'must-not-write' }],
    }, chat)).rejects.toMatchObject({ error: { code: 'WORLD_SIMULATION_ANCHOR_STALE' } });
    expect(chat[1][WORLD_SIMULATION_CONVERSATION_FIELD_ACU]).toBe(previous);
    expect(saveChat).not.toHaveBeenCalled();
  });

  it('同一 runId 连续三次用户指令生成独立段', async () => {
    const chat: any[] = [
      { message_id: 1, mes: 'first-floor', swipe_id: 0 },
      { message_id: 20, mes: 'anchor-body', swipe_id: 0 },
    ];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
    const anchor = resolveWorldSimulationAnchor_ACU(1, chat);
    const base = { runId: 'run-c', taskId: 'task-c', stageId: 'stage-c', stageRevision: 1, anchor };
    await appendWorldSimulationUserInstruction_ACU({ ...base, text: '继续' }, chat);
    await appendWorldSimulationUserInstruction_ACU({ ...base, text: '修正' }, chat);
    await appendWorldSimulationUserInstruction_ACU({ ...base, text: '再改 X' }, chat);

    expect(readWorldSimulationConversation_ACU(chat).messages.map(item => item.text)).toEqual(['继续', '修正', '再改 X']);
    const entry = Object.values(chat[1][WORLD_SIMULATION_CONVERSATION_FIELD_ACU].entries)[0] as { value: { segments: { segmentId: string }[] } };
    expect(entry.value.segments.map(segment => segment.segmentId)).toEqual(['user:run-c:0', 'user:run-c:1', 'user:run-c:2']);
    expect(nextWorldSimulationUserInstructionSegmentId_ACU('run-c', entry.value.segments)).toBe('user:run-c:3');
    expect(nextWorldSimulationUserInstructionSegmentId_ACU('run-c', [{ segmentId: 'user:run-c' }])).toBe('user:run-c:1');
  });

  it('resume 路径重复同一指令幂等成功且不产生重复段', async () => {
    const chat: any[] = [
      { message_id: 1, mes: 'first-floor', swipe_id: 0 },
      { message_id: 20, mes: 'anchor-body', swipe_id: 0 },
    ];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
    const anchor = resolveWorldSimulationAnchor_ACU(1, chat);
    const input = {
      runId: 'run-d',
      taskId: 'task-d',
      stageId: 'stage-d',
      stageRevision: 1,
      anchor,
      text: '继续',
      triggerConversationMessageId: 'turn-d',
      idempotent: true,
    };
    await appendWorldSimulationUserInstruction_ACU(input, chat);
    saveChat.mockClear();
    await expect(appendWorldSimulationUserInstruction_ACU(input, chat)).resolves.toBe(true);
    expect(readWorldSimulationConversation_ACU(chat).messages.map(item => item.text)).toEqual(['继续']);
    const entry = Object.values(chat[1][WORLD_SIMULATION_CONVERSATION_FIELD_ACU].entries)[0] as { value: { segments: unknown[] } };
    expect(entry.value.segments).toHaveLength(1);
    expect(saveChat).not.toHaveBeenCalled();
  });

  it('start 路径重复同 segmentId 仍硬拒绝', async () => {
    const chat: any[] = [
      { message_id: 1, mes: 'first-floor', swipe_id: 0 },
      { message_id: 20, mes: 'anchor-body', swipe_id: 0 },
    ];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
    const anchor = resolveWorldSimulationAnchor_ACU(1, chat);
    const input = {
      anchor,
      segmentId: 'user:run-e:0',
      runId: 'run-e',
      taskId: 'task-e',
      stageId: 'stage-e',
      stageRevision: 1,
      appends: [{ kind: 'user' as const, text: '启动指令' }],
    };
    await appendWorldSimulationConversationSegment_ACU(input, chat);
    const previous = chat[1][WORLD_SIMULATION_CONVERSATION_FIELD_ACU];
    saveChat.mockClear();
    await expect(appendWorldSimulationConversationSegment_ACU(input, chat)).rejects.toMatchObject({
      error: { code: 'WORLD_SIMULATION_SNAPSHOT_INVALID' },
    });
    expect(chat[1][WORLD_SIMULATION_CONVERSATION_FIELD_ACU]).toBe(previous);
    expect(readWorldSimulationConversation_ACU(chat).messages).toHaveLength(1);
    expect(saveChat).not.toHaveBeenCalled();
  });


  it('导演历史只读取存活的动作与反馈，不把展示事件或其它 swipe 混入请求', async () => {
    const chat: any[] = [{ message_id: 1, mes: 'start', swipe_id: 0 }, { message_id: 2, mes: '正文 A', swipe_id: 0, swipes: ['正文 A', '正文 B'] }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-history', getCurrentChatId: () => 'chat-history', saveChat } as any);
    const first = resolveWorldSimulationAnchor_ACU(0, chat);
    const second = resolveWorldSimulationAnchor_ACU(1, chat);
    await appendWorldSimulationUserInstruction_ACU({ anchor: first, runId: 'run-a', taskId: 'task-a', stageId: 'stage-a', stageRevision: 1, text: '先调查', idempotent: true }, chat);
    await appendWorldSimulationSessionEvent_ACU({ anchor: second, runId: 'run-a', taskId: 'task-a', stageId: 'stage-a', stageRevision: 1, eventKey: 'read', event: { kind: 'tool_read', title: '展示卡片', detail: '不进入模型历史' } }, chat);
    await appendWorldSimulationDirectorHistory_ACU({ anchor: second, runId: 'run-a', taskId: 'task-a', stageId: 'stage-a', stageRevision: 1,
      messages: [{ role: 'assistant', content: '原始 read 动作' }, { role: 'user', content: '原始工具回执' }] }, chat);
    expect(readWorldSimulationDirectorHistory_ACU(chat)).toEqual([
      { role: 'user', content: '先调查' }, { role: 'assistant', content: '原始 read 动作' }, { role: 'user', content: '原始工具回执' },
    ]);
    expect(saveChat).toHaveBeenCalledTimes(3);
    chat[1].swipe_id = 1;
    chat[1].mes = '正文 B';
    expect(readWorldSimulationDirectorHistory_ACU(chat)).toEqual([{ role: 'user', content: '先调查' }]);
    chat.splice(1, 1);
    expect(readWorldSimulationDirectorHistory_ACU(chat)).toEqual([{ role: 'user', content: '先调查' }]);
  });

  it('导演楼层保存失败回滚；聊天切换和过期正文均不污染新聊天', async () => {
    const chat: any[] = [{ message_id: 1, mes: '正文', swipe_id: 0 }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-history-fail', getCurrentChatId: () => 'chat-history-fail', saveChat } as any);
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    const input = { anchor, runId: 'run-a', taskId: 'task-a', stageId: 'stage-a', stageRevision: 1,
      messages: [{ role: 'assistant' as const, content: 'read' }, { role: 'user' as const, content: 'read result' }] };
    saveChat.mockRejectedValueOnce(new Error('HOST_SAVE_FAILED'));
    await expect(appendWorldSimulationDirectorHistory_ACU(input, chat)).rejects.toThrow('HOST_SAVE_FAILED');
    expect(readWorldSimulationDirectorHistory_ACU(chat)).toEqual([]);
    expect(chat[0][WORLD_SIMULATION_CONVERSATION_FIELD_ACU]).toBeUndefined();
    await expect(appendWorldSimulationDirectorHistory_ACU(input, chat)).resolves.toBe(true);
    expect(readWorldSimulationDirectorHistory_ACU(chat)).toHaveLength(2);
    const otherChat: any[] = [{ message_id: 1, mes: '另一聊天', swipe_id: 0 }];
    _set_SillyTavern_API_ACU({ chat: otherChat, chatId: 'other-chat', getCurrentChatId: () => 'other-chat', saveChat } as any);
    await expect(appendWorldSimulationDirectorHistory_ACU(input, chat)).rejects.toMatchObject({ error: { code: 'WORLD_SIMULATION_SNAPSHOT_INVALID' } });
    expect(otherChat[0][WORLD_SIMULATION_CONVERSATION_FIELD_ACU]).toBeUndefined();
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-history-fail', getCurrentChatId: () => 'chat-history-fail', saveChat } as any);
    chat[0].mes = '被编辑的正文';
    await expect(appendWorldSimulationDirectorHistory_ACU(input, chat)).rejects.toMatchObject({ error: { code: 'WORLD_SIMULATION_ANCHOR_STALE' } });
    expect(saveChat).toHaveBeenCalledTimes(2);
  });

  it('压缩标记核对源快照，遇并发追加和宿主保存失败不覆盖历史', async () => {
    const chat: any[] = [{ message_id: 1, mes: 'old', swipe_id: 0 }, { message_id: 2, mes: 'now', swipe_id: 0 }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-compaction-conflict', getCurrentChatId: () => 'chat-compaction-conflict', saveChat } as any);
    const oldAnchor = resolveWorldSimulationAnchor_ACU(0, chat);
    const anchor = resolveWorldSimulationAnchor_ACU(1, chat);
    const first = [{ role: 'assistant' as const, content: 'old action' }, { role: 'user' as const, content: 'old result' }];
    await appendWorldSimulationDirectorHistory_ACU({ anchor: oldAnchor, runId: 'r1', taskId: 't1', stageId: 's1', stageRevision: 1, messages: first }, chat);
    await appendWorldSimulationSessionEvent_ACU({ anchor, runId: 'r2', taskId: 't2', stageId: 's2', stageRevision: 2, eventKey: 'start',
      event: { kind: 'run_started', title: 'started', detail: 'pending' } }, chat);
    const original = readWorldSimulationDirectorCompactionSource_ACU(chat);
    const mark = { compactedThroughId: 2, report: 'handoff', at: 10 };
    await appendWorldSimulationUserInstruction_ACU({ anchor, runId: 'r2', taskId: 't2', stageId: 's2', stageRevision: 2, text: 'newer instruction' }, chat);
    const before = chat[1][WORLD_SIMULATION_CONVERSATION_FIELD_ACU];
    saveChat.mockClear();
    await expect(writeWorldSimulationConversationCompaction_ACU({ anchor, compaction: mark, expectedFingerprint: original.fingerprint }, chat))
      .rejects.toMatchObject({ error: { code: 'WORLD_SIMULATION_SNAPSHOT_INVALID' } });
    expect(saveChat).not.toHaveBeenCalled();
    expect(chat[1][WORLD_SIMULATION_CONVERSATION_FIELD_ACU]).toBe(before);
    const fresh = readWorldSimulationDirectorCompactionSource_ACU(chat);
    saveChat.mockRejectedValueOnce(new Error('HOST_MARK_FAILED'));
    await expect(writeWorldSimulationConversationCompaction_ACU({ anchor, compaction: mark, expectedFingerprint: fresh.fingerprint }, chat))
      .rejects.toThrow('HOST_MARK_FAILED');
    expect(chat[1][WORLD_SIMULATION_CONVERSATION_FIELD_ACU]).toBe(before);
    expect(readWorldSimulationDirectorHistory_ACU(chat)).toEqual([
      ...first, { role: 'user', content: 'newer instruction' },
    ]);
    expect(readWorldSimulationDirectorCompactionSource_ACU(chat).view.compaction).toBeNull();
  });

  it('楼层没有会话段时压缩标记拒绝落盘，不造空消息段', async () => {
    const chat: any[] = [{ message_id: 1, mes: 'one', swipe_id: 0 }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    await expect(writeWorldSimulationConversationCompaction_ACU({
      anchor,
      compaction: { compactedThroughId: 1, report: '早期会话交接报告', at: 1 },
    }, chat)).resolves.toBe(false);
    expect(chat[0][WORLD_SIMULATION_CONVERSATION_FIELD_ACU]).toBeUndefined();
    expect(saveChat).not.toHaveBeenCalled();
  });

});
