import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';
import { sha256HexSync_ACU } from '../../../src/shared/sha256-sync';
import {
  createWorldSimulationCompletionIntent_ACU,
  resolveLatestWorldSimulationAssistant_ACU,
  resolveWorldSimulationAssistantCompletion_ACU,
  restoreWorldSimulationAnchor_ACU,
} from '../../../src/service/simulation/simulation-trigger-adapter';

const user = (mes = 'user') => ({ is_user: true, mes });
const narrator = (mes = 'system') => ({ is_user: false, mes, extra: { type: 'narrator' } });
const assistant = (message_id: number, mes = 'assistant') => ({ is_user: false, message_id, mes, swipe_id: 0 });

function bindChat_ACU(chat: any[], getChatId: () => string = () => 'chat-a'): void {
  _set_SillyTavern_API_ACU({ chat, getCurrentChatId: getChatId } as any);
}

beforeEach(() => _set_SillyTavern_API_ACU(undefined));

describe('世界推演触发适配器', () => {
  it('有界等待后只解析唯一物化 assistant，user/system 不会成为锚点', async () => {
    const chat: any[] = [user(), narrator()];
    bindChat_ACU(chat);
    const intent = createWorldSimulationCompletionIntent_ACU(42, 'chat-a', '', chat, 7);
    const delay = vi.fn(async () => {
      if (!chat.some(item => item.message_id === 42)) chat.push(assistant(42, 'late assistant'));
    });

    const resolved = await resolveWorldSimulationAssistantCompletion_ACU(intent, {
      getChat: () => chat, delay, maxRetries: 1, retryDelayMs: 0, settleDelayMs: 0,
    });

    expect(delay).toHaveBeenCalledTimes(2);
    expect(resolved).toMatchObject({ kind: 'resolved', anchor: { messageIndex: 2, messageId: 42, chatIdentity: 'chat-a' } });
  });

  it('手动入口在尾楼为 user 时向上锚定最近 assistant，无 assistant 时 fail-closed', () => {
    const chat = [assistant(8, 'older'), user('latest')];
    bindChat_ACU(chat);
    expect(resolveLatestWorldSimulationAssistant_ACU(chat)).toMatchObject({ kind: 'resolved', anchor: { messageIndex: 0, messageId: 8 } });
    expect(resolveLatestWorldSimulationAssistant_ACU([user(), narrator()])).toEqual({ kind: 'blocked', reason: 'no_assistant' });
  });

  it('冻结锚点不受新增楼层影响，但正文或 active swipe 变化会 stale', () => {
    const chat: any[] = [user(), assistant(9, 'frozen')];
    bindChat_ACU(chat);
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

  it('解析 resolved 但 mes 为空时落定窗口内不冻结，耗尽后 not_materialized', async () => {
    const chat: any[] = [user(), assistant(42, '')];
    bindChat_ACU(chat);
    const intent = createWorldSimulationCompletionIntent_ACU(42, 'chat-a', '', chat);
    const delay = vi.fn(async () => undefined);

    const resolved = await resolveWorldSimulationAssistantCompletion_ACU(intent, {
      getChat: () => chat, delay, maxRetries: 0, retryDelayMs: 0, settleDelayMs: 0,
    });

    expect(resolved).toEqual({ kind: 'blocked', reason: 'not_materialized' });
    expect(delay).toHaveBeenCalledTimes(4);
  });

  it('两次采样间 mes 变化则继续等待，稳定后冻结的 digest 等于稳定正文', async () => {
    const floor = assistant(42, 'draft-a');
    const chat: any[] = [user(), floor];
    bindChat_ACU(chat);
    const intent = createWorldSimulationCompletionIntent_ACU(42, 'chat-a', '', chat);
    let delayCount = 0;
    const delay = vi.fn(async () => {
      delayCount += 1;
      if (delayCount === 1) floor.mes = 'draft-b';
    });

    const resolved = await resolveWorldSimulationAssistantCompletion_ACU(intent, {
      getChat: () => chat, delay, maxRetries: 0, retryDelayMs: 0, settleRetries: 3, settleDelayMs: 0,
    });

    expect(resolved).toMatchObject({ kind: 'resolved', anchor: { messageIndex: 1, messageId: 42 } });
    if (resolved.kind !== 'resolved') throw new Error('expected resolved anchor');
    expect(resolved.anchor.contentDigest).toBe(sha256HexSync_ACU('draft-b'));
    expect(resolved.anchor.contentDigest).not.toBe(sha256HexSync_ACU('draft-a'));
  });

  it('swipe_id 未赋整数时不走 0 兜底、不冻结', async () => {
    const chat: any[] = [user(), { is_user: false, message_id: 42, mes: 'assistant ready' }];
    bindChat_ACU(chat);
    const intent = createWorldSimulationCompletionIntent_ACU(42, 'chat-a', '', chat);
    const delay = vi.fn(async () => undefined);

    const resolved = await resolveWorldSimulationAssistantCompletion_ACU(intent, {
      getChat: () => chat, delay, maxRetries: 0, retryDelayMs: 0, settleRetries: 2, settleDelayMs: 0,
    });

    expect(resolved).toEqual({ kind: 'blocked', reason: 'not_materialized' });
    expect(delay).toHaveBeenCalledTimes(2);
  });

  it('落定窗口内聊天切换返回 chat_changed', async () => {
    const chat: any[] = [user(), assistant(42, 'stable body')];
    let chatId = 'chat-a';
    bindChat_ACU(chat, () => chatId);
    const intent = createWorldSimulationCompletionIntent_ACU(42, 'chat-a', '', chat);
    const delay = vi.fn(async () => { chatId = 'chat-b'; });

    const resolved = await resolveWorldSimulationAssistantCompletion_ACU(intent, {
      getChat: () => chat, delay, maxRetries: 0, retryDelayMs: 0, settleRetries: 2, settleDelayMs: 0,
    });

    expect(resolved).toEqual({ kind: 'blocked', reason: 'chat_changed' });
  });
});
