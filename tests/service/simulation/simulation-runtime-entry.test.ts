import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDefaultWorldSimulationEnvelope_ACU, buildDefaultWorldSimulationSettings_ACU } from '../../../src/service/simulation/defaults';
import { beginWorldSimulationSessionRun_ACU, logWorldSimulationSession_ACU, resetWorldSimulationSessionLogForTests_ACU } from '../../../src/service/simulation/agent/agent-session-log';
import { WorldSimulationRuntime_ACU } from '../../../src/service/simulation/simulation-runtime';
import { resolveWorldSimulationAnchor_ACU } from '../../../src/service/simulation/simulation-store';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';

const start = vi.fn(async () => ({ status: 'skipped' as const, reason: 'disabled' as const }));
const resume = vi.fn(async () => ({ status: 'skipped' as const, reason: 'duplicate' as const }));
const replan = vi.fn(async () => ({ status: 'awaiting_plan_review' as const, identity: {} as any }));
const cancel = vi.fn(() => true);
const orchestrator = { start, resume, replan, cancel } as any;

beforeEach(() => {
  vi.clearAllMocks();
  resetWorldSimulationSessionLogForTests_ACU();
  _set_SillyTavern_API_ACU(undefined);
});

describe('WorldSimulationRuntime_ACU 公共入口', () => {
  it('自动与手动入口统一调用同一 orchestrator，手动入口锚定 user 上方 assistant', async () => {
    const chat: any[] = [
      { is_user: true, mes: 'user' },
      { is_user: false, message_id: 42, mes: 'assistant', swipe_id: 0 },
      { is_user: true, mes: 'latest user' },
    ];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a' } as any);
    const runtime = new WorldSimulationRuntime_ACU(orchestrator, () => chat);
    const intent = { eventMessageId: 42, chatKey: 'chat-a', isolationKey: '', capturedAt: 1, capturedChatLength: 3, capturedAiFloorCount: 1 };

    await runtime.handleAssistantCompletion(intent);
    await runtime.sendAgentMessage('手动推进', 'conversation-1');

    expect(start).toHaveBeenCalledTimes(2);
    expect(start.mock.calls[0][0]).toMatchObject({ triggerKind: 'assistant_completed', anchor: { messageIndex: 1, messageId: 42 } });
    expect(start.mock.calls[1][0]).toMatchObject({ triggerKind: 'agent_chat_message', instruction: '手动推进', triggerConversationMessageId: 'conversation-1', anchor: { messageIndex: 1, messageId: 42 } });
  });

  it('无 assistant 或空指令时模型/orchestrator 调用为 0', async () => {
    const chat: any[] = [{ is_user: true, mes: 'user' }, { is_user: false, mes: 'system', extra: { type: 'narrator' } }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a' } as any);
    const runtime = new WorldSimulationRuntime_ACU(orchestrator, () => chat);

    await expect(runtime.sendAgentMessage('')).resolves.toBeNull();
    await expect(runtime.sendAgentMessage('推进')).resolves.toBeNull();
    expect(start).not.toHaveBeenCalled();
  });

  it('恢复和取消也使用同一 orchestrator 与冻结身份', async () => {
    const chat: any[] = [{ is_user: false, message_id: 7, mes: 'anchor', swipe_id: 0 }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    const identity = {
      runId: 'run', chatIdentity: 'chat-a', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null,
      anchorMessageId: anchor.messageId, anchorMessageKey: anchor.messageKey, anchorSwipeId: anchor.swipeId,
      anchorContentDigest: anchor.contentDigest, baseLedgerRevision: 0, taskId: 'task', stageId: 'stage', stageRevision: 1,
    };
    envelope.task = { taskId: 'task', originInstruction: '推进', status: 'paused', createdAt: 1, updatedAt: 1, activeRun: identity, stopReason: null };
    envelope.activeStageId = 'stage';
    envelope.stages = [{ stageId: 'stage', stageNumber: 1, status: 'running', activeRevision: 1, revisions: [{ revision: 1, createdAt: 1, reason: 'initial', replanInstruction: '', frozen: true, plan: { schemaVersion: 1, title: 'p', objective: 'o', impactScope: [], factsToVerify: [], plannedTools: [], plannedSpecialists: [], expectedLedgerChanges: [], convergenceConditions: [], blockingConditions: [], completedSteps: [], nextStep: '' } }] }];
    chat[0]._qrf_world_simulation = envelope;
    const runtime = new WorldSimulationRuntime_ACU(orchestrator, () => chat);

    await runtime.resume();
    expect(resume).toHaveBeenCalledWith({ anchor });
    expect(runtime.cancel()).toBe(true);
    expect(cancel).toHaveBeenCalledWith('chat-a');
  });

  it('UI 快照严格只读，无 envelope 时不创建默认状态也不保存', () => {
    const saveChat = vi.fn();
    const chat: any[] = [{ is_user: false, message_id: 7, mes: 'anchor', swipe_id: 0 }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
    const runtime = new WorldSimulationRuntime_ACU(orchestrator, () => chat);

    const snapshot = runtime.readUiSnapshot();

    expect(snapshot).toMatchObject({ envelope: null, anchor: { messageIndex: 0, messageId: 7 }, projectionPreview: null });
    expect(snapshot.conversation.messages).toEqual([]);
    expect(snapshot.materials.snapshot).toBeNull();
    expect(chat[0]._qrf_world_simulation).toBeUndefined();
    expect(saveChat).not.toHaveBeenCalled();
  });

  it('UI 快照按当前聊天身份隔离 session entries 与 running 状态', () => {
    const chats: Record<string, any[]> = {
      'chat-a': [{ is_user: false, message_id: 1, mes: 'anchor-a', swipe_id: 0 }],
      'chat-b': [{ is_user: false, message_id: 2, mes: 'anchor-b', swipe_id: 0 }],
    };
    let currentChatId = 'chat-a';
    _set_SillyTavern_API_ACU({
      get chat() { return chats[currentChatId]; },
      getCurrentChatId: () => currentChatId,
    } as any);
    const runtime = new WorldSimulationRuntime_ACU(orchestrator, () => chats[currentChatId]);
    beginWorldSimulationSessionRun_ACU('chat-a', 'A 运行');
    logWorldSimulationSession_ACU('chat-b', { kind: 'thought', title: 'B 思考' });

    expect(runtime.readUiSnapshot().session).toMatchObject({
      chatIdentity: 'chat-a', running: true, entries: [{ title: 'A 运行' }],
    });
    currentChatId = 'chat-b';
    expect(runtime.readUiSnapshot().session).toMatchObject({
      chatIdentity: 'chat-b', running: false, entries: [{ title: 'B 思考' }],
    });
  });

  it('计划确认与重规划只通过 orchestrator 并复用冻结锚点', async () => {
    const chat: any[] = [{ is_user: false, message_id: 7, mes: 'anchor', swipe_id: 0 }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    const identity = {
      runId: 'run', chatIdentity: 'chat-a', triggerKind: 'agent_chat_message' as const, triggerConversationMessageId: 'turn-1',
      anchorMessageId: anchor.messageId, anchorMessageKey: anchor.messageKey, anchorSwipeId: anchor.swipeId,
      anchorContentDigest: anchor.contentDigest, baseLedgerRevision: 0, taskId: 'task', stageId: 'stage', stageRevision: 1,
    };
    envelope.task = { taskId: 'task', originInstruction: '推进', status: 'awaiting_plan_review', createdAt: 1, updatedAt: 1, activeRun: identity, stopReason: null };
    envelope.activeStageId = 'stage';
    envelope.stages = [{ stageId: 'stage', stageNumber: 1, status: 'awaiting_review', activeRevision: 1, revisions: [{ revision: 1, createdAt: 1, reason: 'initial', replanInstruction: '', frozen: false, plan: { schemaVersion: 1, title: 'p', objective: 'o', impactScope: [], factsToVerify: [], plannedTools: [], plannedSpecialists: [], expectedLedgerChanges: [], convergenceConditions: [], blockingConditions: [], completedSteps: [], nextStep: '' } }] }];
    chat[0]._qrf_world_simulation = envelope;
    const runtime = new WorldSimulationRuntime_ACU(orchestrator, () => chat);

    await runtime.confirmPlan();
    await runtime.replan('缩小影响范围');

    expect(resume).toHaveBeenCalledWith({ anchor });
    expect(replan).toHaveBeenCalledWith({ anchor, instruction: '缩小影响范围' });
  });

  it('只有显式保存设置才创建 envelope，并经过严格宿主保存', async () => {
    const saveChat = vi.fn().mockResolvedValue(undefined);
    const chat: any[] = [{ is_user: false, message_id: 7, mes: 'anchor', swipe_id: 0 }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
    const runtime = new WorldSimulationRuntime_ACU(orchestrator, () => chat);
    const settings = buildDefaultWorldSimulationSettings_ACU();
    settings.autoTriggerEnabled = false;

    await runtime.saveSettings(settings);

    expect(saveChat).toHaveBeenCalledTimes(1);
    expect(chat[0]._qrf_world_simulation).toMatchObject({ settings: { autoTriggerEnabled: false }, task: null, ledger: { revision: 0 } });
  });
});
