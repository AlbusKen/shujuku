import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';
import { WorldSimulationValidationError_ACU } from '../../../src/service/simulation/model';
import { appendWorldSimulationConversation_ACU, readWorldSimulationConversationTimeline_ACU, readWorldSimulationConversationTimelineWithDiagnostics_ACU, updateWorldSimulationConversationStatus_ACU, WORLD_SIMULATION_AGENT_CONVERSATION_FIELD_ACU } from '../../../src/service/simulation/world-simulation-agent-conversation';
import { resolveActiveWorldSimulationSwipe_ACU } from '../../../src/service/simulation/simulation-swipe';

const saveChat = vi.fn(async () => undefined);
function chat() { return [{ is_user: false, message_id: 'ai-1', mes: '正文 A', swipe_id: 0, swipes: ['正文 A', '正文 B'] }]; }
function useChat(value: any[]): void { _set_SillyTavern_API_ACU({ chat: value, saveChat } as any); }

beforeEach(() => { saveChat.mockReset(); saveChat.mockResolvedValue(undefined); });

describe('world simulation agent conversation', () => {
  it('keeps a selected swipe timeline readable and writable after its projection changes the body hash', async () => {
    const value = chat(); useChat(value);
    const swipe = resolveActiveWorldSimulationSwipe_ACU(0, value[0]).identity;
    const [added] = await appendWorldSimulationConversation_ACU(0, [{ kind: 'user', status: 'pending', title: '你的补充', detail: '推进港口局势' }], value);
    value[0].mes = '正文 A\n<与此同时>公开增量</与此同时>';
    value[0].swipes[0] = value[0].mes;
    await updateWorldSimulationConversationStatus_ACU({ messageIndex: 0, swipe, id: added.id, text: added.detail }, 'done', '请求已完成', value);
    expect(readWorldSimulationConversationTimeline_ACU(value)).toMatchObject([{ id: added.id, status: 'done', detail: '请求已完成' }]);
    expect(saveChat).toHaveBeenCalledTimes(2);
  });

  it('isolates records by active swipe and rejects malformed envelopes without rewriting them', async () => {
    const value = chat(); useChat(value);
    await appendWorldSimulationConversation_ACU(0, [{ kind: 'user', status: 'pending', title: 'A', detail: '只属于 A' }], value);
    value[0].swipe_id = 1; value[0].mes = '正文 B';
    expect(readWorldSimulationConversationTimeline_ACU(value)).toEqual([]);
    value[0].swipe_id = 0; value[0].mes = '正文 A';
    expect(readWorldSimulationConversationTimeline_ACU(value)).toHaveLength(1);

    const invalid = chat(); invalid[0][WORLD_SIMULATION_AGENT_CONVERSATION_FIELD_ACU] = { version: 1, entries: [], unexpected: true };
    useChat(invalid); saveChat.mockClear();
    await expect(appendWorldSimulationConversation_ACU(0, [{ kind: 'user', status: 'pending', title: 'x', detail: 'y' }], invalid)).rejects.toBeInstanceOf(WorldSimulationValidationError_ACU);
    expect(saveChat).not.toHaveBeenCalled();
  });

  it('isolates a damaged non-authoritative envelope instead of blocking valid conversation records', async () => {
    const value = [
      { is_user: false, message_id: 'bad-ai', mes: '损坏正文', swipe_id: 0, swipes: ['损坏正文'], [WORLD_SIMULATION_AGENT_CONVERSATION_FIELD_ACU]: { version: 1, entries: [], unexpected: true } },
      { is_user: false, message_id: 'good-ai', mes: '有效正文', swipe_id: 0, swipes: ['有效正文'] },
    ];
    useChat(value);
    await appendWorldSimulationConversation_ACU(1, [{ kind: 'user', status: 'pending', title: '有效请求', detail: '继续' }], value);
    const timeline = readWorldSimulationConversationTimelineWithDiagnostics_ACU(value);
    expect(timeline.invalidMessageIndexes).toEqual([0]);
    expect(timeline.messages).toMatchObject([{ title: '有效请求' }]);
  });

  it('restores the exact prior field when strict host save fails', async () => {
    const value = chat(); useChat(value); saveChat.mockRejectedValueOnce(new Error('save failed'));
    await expect(appendWorldSimulationConversation_ACU(0, [{ kind: 'user', status: 'pending', title: 'x', detail: 'y' }], value)).rejects.toThrow('save failed');
    expect(value[0][WORLD_SIMULATION_AGENT_CONVERSATION_FIELD_ACU]).toBeUndefined();
  });
});
