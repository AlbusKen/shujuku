import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';
import {
  createWorldSimulationCompletionIntent_ACU,
  resolveLatestWorldSimulationAssistant_ACU,
  resolveWorldSimulationAssistantCompletion_ACU,
  restoreWorldSimulationAnchor_ACU,
} from '../../../src/service/simulation/simulation-trigger-adapter';

const user = (mes = 'user') => ({ is_user: true, mes });
const narrator = (mes = 'system') => ({ is_user: false, mes, extra: { type: 'narrator' } });
const assistant = (message_id: number, mes = 'assistant') => ({ is_user: false, message_id, mes, swipe_id: 0 });

beforeEach(() => _set_SillyTavern_API_ACU(undefined));

describe('世界推演触发适配器', () => {
  it('有界等待后只解析唯一物化 assistant，user/system 不会成为锚点', async () => {
    const chat: any[] = [user(), narrator()];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a' } as any);
    const intent = createWorldSimulationCompletionIntent_ACU(42, 'chat-a', '', chat, 7);
    const delay = vi.fn(async () => { chat.push(assistant(42, 'late assistant')); });

    const resolved = await resolveWorldSimulationAssistantCompletion_ACU(intent, { getChat: () => chat, delay, maxRetries: 1, retryDelayMs: 0 });

    expect(delay).toHaveBeenCalledOnce();
    expect(resolved).toMatchObject({ kind: 'resolved', anchor: { messageIndex: 2, messageId: 42, chatIdentity: 'chat-a' } });
  });

  it('手动入口在尾楼为 user 时向上锚定最近 assistant，无 assistant 时 fail-closed', () => {
    const chat = [assistant(8, 'older'), user('latest')];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a' } as any);
    expect(resolveLatestWorldSimulationAssistant_ACU(chat)).toMatchObject({ kind: 'resolved', anchor: { messageIndex: 0, messageId: 8 } });
    expect(resolveLatestWorldSimulationAssistant_ACU([user(), narrator()])).toEqual({ kind: 'blocked', reason: 'no_assistant' });
  });

  it('冻结锚点不受新增楼层影响，但正文或 active swipe 变化会 stale', () => {
    const chat: any[] = [user(), assistant(9, 'frozen')];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a' } as any);
    const resolved = resolveLatestWorldSimulationAssistant_ACU(chat);
    if (resolved.kind !== 'resolved') throw new Error('expected resolved anchor');
    const identity = {
      runId: 'run', taskId: 'task', stageId: 'stage', stageRevision: 1, baseLedgerRevision: 0,
      chatIdentity: resolved.anchor.chatIdentity, triggerKind: 'assistant_completed' as const,
      triggerConversationMessageId: null, anchorMessageId: resolved.anchor.messageId,
      anchorMessageKey: resolved.anchor.messageKey, anchorSwipeId: resolved.anchor.swipeId,
      anchorContentDigest: resolved.anchor.contentDigest,
    };
    chat.push(user('new floor'));
    expect(restoreWorldSimulationAnchor_ACU(identity, chat)).toEqual(resolved.anchor);
    chat[1].mes = 'changed';
    expect(() => restoreWorldSimulationAnchor_ACU(identity, chat)).toThrow('WORLD_SIMULATION_ANCHOR_STALE');
  });
});
