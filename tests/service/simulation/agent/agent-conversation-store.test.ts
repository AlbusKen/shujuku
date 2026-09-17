import { beforeEach, describe, expect, it, vi } from 'vitest';
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
});
