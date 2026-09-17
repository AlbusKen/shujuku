import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WORLD_SIMULATION_CONVERSATION_FIELD_ACU } from '../../../../src/service/simulation/agent/agent-model';
import { appendWorldSimulationConversationSegment_ACU, readWorldSimulationConversation_ACU } from '../../../../src/service/simulation/agent/agent-conversation-store';
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
});
