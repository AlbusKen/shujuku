import { beforeEach, describe, expect, it } from 'vitest';
import { createWorldSimulationCompletionIntent_ACU, resolveLatestWorldSimulationAssistant_ACU, resolveWorldSimulationAssistantCompletion_ACU } from '../../../src/service/simulation/simulation-trigger-adapter';
import { resolveWorldSimulationAnchor_ACU } from '../../../src/service/simulation/simulation-store';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';

const user = (mes = 'user') => ({ is_user: true, mes });
const narrator = (mes = 'system') => ({ is_user: false, mes, extra: { type: 'narrator' } });
const assistant = (message_id: number, mes: string, swipe_id = 0, extra: Record<string, unknown> = {}) =>
  ({ is_user: false, message_id, mes, swipe_id, ...extra });

function bind(chat: any[]): void {
  _set_SillyTavern_API_ACU({ chat, getCurrentChatId: () => 'chat-anchor' } as any);
}

describe('格林推演锚点解析与重新生成接续', () => {
  beforeEach(() => { bind([]); });

  it('被宿主标记 is_system 的 AI 楼层仍可锚定：挑选与解析使用同一判定', () => {
    // is_system 只表示「不进提示词」，与 role 无关。挑选侧用 isAiMessage_ACU 能选中它，
    // 解析侧若额外拒绝 is_system 就会抛 WORLD_SIMULATION_ANCHOR_INVALID。
    const chat: any[] = [user(), assistant(7, '被隐藏的正文', 0, { is_system: true })];
    bind(chat);
    const resolved = resolveLatestWorldSimulationAssistant_ACU(chat);
    expect(resolved).toMatchObject({ kind: 'resolved', anchor: { messageIndex: 1, messageId: 7 } });
    expect(() => resolveWorldSimulationAnchor_ACU(1, chat)).not.toThrow();
  });

  it('narrator 旁白仍不是锚点，user 楼层同样被拒', () => {
    const chat: any[] = [user(), narrator()];
    bind(chat);
    expect(resolveLatestWorldSimulationAssistant_ACU(chat)).toEqual({ kind: 'blocked', reason: 'no_assistant' });
    expect(() => resolveWorldSimulationAnchor_ACU(1, chat)).toThrow();
    expect(() => resolveWorldSimulationAnchor_ACU(0, chat)).toThrow();
  });

  it('原地重新生成时回退到最新 assistant 楼层，让新正文能接着推演', async () => {
    // 重新生成不新增楼层：捕获长度与 AI 数都不变，intent 的候选区间必然为空；
    // 宿主再换掉 message_id，事件携带的旧 id 也命中不了，逐轮只能拿到 pending。
    const before: any[] = [user(), assistant(11, '旧正文', 0)];
    const intent = createWorldSimulationCompletionIntent_ACU(11, 'chat-anchor', '', before);
    const after: any[] = [user(), assistant(12, '重新生成后的正文', 0)];
    bind(after);
    const resolved = await resolveWorldSimulationAssistantCompletion_ACU(intent, {
      getChat: () => after, delay: async () => undefined, maxRetries: 0, settleRetries: 1, settleDelayMs: 0,
    });
    expect(resolved).toMatchObject({ kind: 'resolved', anchor: { messageIndex: 1, messageId: 12 } });
  });

  it('回退仍要求有已稳定的 assistant 楼层：没有 AI 楼层或楼层未稳定都不冻结', async () => {
    const before: any[] = [user(), assistant(11, '旧正文', 0)];
    const intent = createWorldSimulationCompletionIntent_ACU(11, 'chat-anchor', '', before);
    const onlyUser: any[] = [user(), narrator()];
    bind(onlyUser);
    expect(await resolveWorldSimulationAssistantCompletion_ACU(intent, {
      getChat: () => onlyUser, delay: async () => undefined, maxRetries: 0, settleRetries: 0, settleDelayMs: 0,
    })).toEqual({ kind: 'blocked', reason: 'not_materialized' });
    // 正文还在生成、swipe_id 尚未赋值：回退也必须等它稳定下来，不能就地冻结。
    const unsettled: any[] = [user(), { is_user: false, message_id: 12, mes: '正在生成' }];
    bind(unsettled);
    expect(await resolveWorldSimulationAssistantCompletion_ACU(intent, {
      getChat: () => unsettled, delay: async () => undefined, maxRetries: 0, settleRetries: 1, settleDelayMs: 0,
    })).toEqual({ kind: 'blocked', reason: 'not_materialized' });
  });

  it('正常追加新楼层时按 intent 区间唯一命中，不走回退', async () => {
    const before: any[] = [user(), assistant(11, '旧正文', 0)];
    const intent = createWorldSimulationCompletionIntent_ACU(13, 'chat-anchor', '', before);
    const appended: any[] = [user(), assistant(11, '旧正文', 0), user(), assistant(13, '追加', 0)];
    bind(appended);
    const resolved = await resolveWorldSimulationAssistantCompletion_ACU(intent, {
      getChat: () => appended, delay: async () => undefined, maxRetries: 0, settleRetries: 1, settleDelayMs: 0,
    });
    expect(resolved).toMatchObject({ kind: 'resolved', anchor: { messageIndex: 3, messageId: 13 } });
  });

});
