import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDefaultWorldSimulationEnvelope_ACU, buildDefaultWorldSimulationSettings_ACU } from '../../../src/service/simulation/defaults';
import { beginWorldSimulationSessionRun_ACU, logWorldSimulationSession_ACU, resetWorldSimulationSessionLogForTests_ACU } from '../../../src/service/simulation/agent/agent-session-log';
import { WorldSimulationRuntime_ACU } from '../../../src/service/simulation/simulation-runtime';
import type { WorldSimulationLedgerModule_ACU } from '../../../src/service/simulation/model';
import { resolveWorldSimulationAnchor_ACU } from '../../../src/service/simulation/simulation-store';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';

const start = vi.fn(async () => ({ status: 'skipped' as const, reason: 'disabled' as const }));
const resume = vi.fn(async () => ({ status: 'skipped' as const, reason: 'duplicate' as const }));
const cancel = vi.fn(() => true);
let inFlight = false;
const isInFlight = vi.fn(() => inFlight);
const interrupt = vi.fn(async () => { const was = inFlight; inFlight = false; return was; });
const deriveEnvelopeView = vi.fn((envelope: any) => {
  const task = envelope?.task;
  if (!envelope || !task || !['drafting', 'running', 'stopping_after_inflight'].includes(task.status) || inFlight) return envelope;
  return { ...envelope, task: { ...task, status: 'paused', stopReason: 'interrupted' } };
});
const orchestrator = { start, resume, cancel, isInFlight, interrupt, deriveEnvelopeView } as any;

const stagePlan = { schemaVersion: 1 as const, title: 'p', objective: 'o', impactScope: [], factsToVerify: [], plannedTools: [], plannedSpecialists: [], expectedLedgerChanges: [], convergenceConditions: [], blockingConditions: [], completedSteps: [], nextStep: '' };

function pausedEnvelope(anchor: ReturnType<typeof resolveWorldSimulationAnchor_ACU>, status: 'paused' | 'running' = 'paused') {
  const envelope = buildDefaultWorldSimulationEnvelope_ACU();
  const identity = {
    runId: 'run', chatIdentity: 'chat-a', triggerKind: 'agent_chat_message' as const, triggerConversationMessageId: 'turn-1',
    anchorMessageId: anchor.messageId, anchorMessageKey: anchor.messageKey, anchorSwipeId: anchor.swipeId,
    anchorContentDigest: anchor.contentDigest, baseLedgerRevision: 0, taskId: 'task', stageId: 'stage', stageRevision: 1,
  };
  envelope.task = { taskId: 'task', originInstruction: '推进', status, createdAt: 1, updatedAt: 1, activeRun: identity, stopReason: status === 'paused' ? 'manual' : null };
  envelope.activeStageId = 'stage';
  envelope.stages = [{ stageId: 'stage', stageNumber: 1, status: 'running', activeRevision: 1, revisions: [{ revision: 1, createdAt: 1, reason: 'initial', replanInstruction: '', frozen: true, plan: stagePlan }] }];
  return { envelope, identity };
}

function pendingFix(
  module: WorldSimulationLedgerModule_ACU,
  anchor: ReturnType<typeof resolveWorldSimulationAnchor_ACU>,
) {
  return {
    module,
    candidateId: `candidate-${module}`,
    agentName: module === 'actors' ? 'dramatis-keeper' : 'undercurrent-analyst',
    violations: [{ path: module, message: `${module} 输出截断` }],
    attempts: 1,
    firstFailedAtDay: 1,
    lastError: `${module} 输出截断`,
    source: 'truncated' as const,
    completion: 'failed' as const,
    acceptedKeys: [],
    anchor: {
      messageKey: anchor.messageKey,
      swipeId: anchor.swipeId,
      contentDigest: anchor.contentDigest,
      baseLedgerRevision: 0,
    },
    createdAt: 1,
    updatedAt: 1,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  inFlight = false;
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

  it('已暂停任务在快照、恢复按钮和“继续”消息中复用冻结身份', async () => {
    const chat: any[] = [{ is_user: false, message_id: 7, mes: 'anchor', swipe_id: 0 }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    const identity = {
      runId: 'run', chatIdentity: 'chat-a', triggerKind: 'agent_chat_message' as const, triggerConversationMessageId: 'turn-1',
      anchorMessageId: anchor.messageId, anchorMessageKey: anchor.messageKey, anchorSwipeId: anchor.swipeId,
      anchorContentDigest: anchor.contentDigest, baseLedgerRevision: 0, taskId: 'task', stageId: 'stage', stageRevision: 1,
    };
    envelope.task = { taskId: 'task', originInstruction: '推进', status: 'paused', createdAt: 1, updatedAt: 1, activeRun: identity, stopReason: '证据不足' };
    envelope.activeStageId = 'stage';
    envelope.stages = [{ stageId: 'stage', stageNumber: 1, status: 'failed', activeRevision: 1, revisions: [{ revision: 1, createdAt: 1, reason: 'initial', replanInstruction: '', frozen: true, plan: { schemaVersion: 1, title: 'p', objective: 'o', impactScope: [], factsToVerify: [], plannedTools: [], plannedSpecialists: [], expectedLedgerChanges: [], convergenceConditions: [], blockingConditions: [], completedSteps: [], nextStep: '' } }] }];
    chat[0]._qrf_world_simulation = envelope;
    const runtime = new WorldSimulationRuntime_ACU(orchestrator, () => chat);

    const snapshot = runtime.readUiSnapshot();
    expect(snapshot.envelope?.task).toMatchObject({ status: 'paused', stopReason: '证据不足' });
    await runtime.resume();
    await runtime.sendAgentMessage('继续', 'turn-continue');
    await runtime.sendAgentMessage('resume', 'turn-resume');
    expect(resume).toHaveBeenCalledTimes(3);
    expect(resume).toHaveBeenNthCalledWith(1, { anchor });
    expect(resume).toHaveBeenNthCalledWith(2, { anchor, resetRunBudget: true });
    expect(resume).toHaveBeenNthCalledWith(3, { anchor, resetRunBudget: true });
    expect(start).not.toHaveBeenCalled();
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

  it('在途时发送会先打断并等待结算，再按同锚点带指令恢复同一 run', async () => {
    const chat: any[] = [{ is_user: false, message_id: 7, mes: 'anchor', swipe_id: 0 }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    chat[0]._qrf_world_simulation = pausedEnvelope(anchor, 'running').envelope;
    inFlight = true;
    const runtime = new WorldSimulationRuntime_ACU(orchestrator, () => chat);

    await runtime.sendAgentMessage('把边境压力调高', 'turn-2');

    expect(interrupt).toHaveBeenCalledWith('chat-a');
    expect(interrupt.mock.invocationCallOrder[0]).toBeLessThan(resume.mock.invocationCallOrder[0]);
    expect(resume).toHaveBeenCalledWith({ anchor, instruction: '把边境压力调高', resetRunBudget: true });
    expect(start).not.toHaveBeenCalled();
  });

  it('paused 任务锚点仍是最新 assistant 时，任意文本都恢复同一 run 而不新建任务', async () => {
    const chat: any[] = [{ is_user: false, message_id: 7, mes: 'anchor', swipe_id: 0 }, { is_user: true, mes: '用户又说了一句' }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    chat[0]._qrf_world_simulation = pausedEnvelope(anchor).envelope;
    const runtime = new WorldSimulationRuntime_ACU(orchestrator, () => chat);

    await runtime.sendAgentMessage('补充：北境是重点', 'turn-2');

    expect(resume).toHaveBeenCalledWith({ anchor, instruction: '补充：北境是重点', resetRunBudget: true });
    expect(start).not.toHaveBeenCalled();
    expect(interrupt).not.toHaveBeenCalled();
  });

  it('paused 任务的锚点已不是最新 assistant 时，只要旧锚点仍可恢复就带 resetRunBudget 续跑同一 run', async () => {
    const chat: any[] = [
      { is_user: false, message_id: 7, mes: 'old anchor', swipe_id: 0 },
      { is_user: true, mes: 'user' },
      { is_user: false, message_id: 8, mes: 'new assistant', swipe_id: 0 },
    ];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);
    const oldAnchor = resolveWorldSimulationAnchor_ACU(0, chat);
    chat[0]._qrf_world_simulation = pausedEnvelope(oldAnchor).envelope;
    const runtime = new WorldSimulationRuntime_ACU(orchestrator, () => chat);

    await runtime.sendAgentMessage('推进新楼层', 'turn-3');

    expect(start).not.toHaveBeenCalled();
    expect(resume).toHaveBeenCalledWith({ anchor: oldAnchor, instruction: '推进新楼层', resetRunBudget: true });
  });

  it('paused 任务的锚点楼层已被删除时，快照不再整体失败，发送按最新 assistant 新建运行', async () => {
    const chat: any[] = [{ is_user: false, message_id: 7, mes: 'anchor', swipe_id: 0 }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    const staleIdentity = { ...pausedEnvelope(anchor).identity, anchorContentDigest: 'digest-of-deleted-floor', anchorMessageKey: 'number:99' };
    const { envelope } = pausedEnvelope(anchor);
    envelope.task!.activeRun = staleIdentity;
    chat[0]._qrf_world_simulation = envelope;
    const runtime = new WorldSimulationRuntime_ACU(orchestrator, () => chat);

    const snapshot = runtime.readUiSnapshot();
    expect(snapshot.anchor).toMatchObject({ messageIndex: 0, messageId: 7 });
    await runtime.sendAgentMessage('重新推演', 'turn-4');
    expect(resume).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ instruction: '重新推演', anchor: expect.objectContaining({ messageId: 7 }) }));
  });

  it('僵死 running（无在途 controller）在 UI 快照中派生为 paused/interrupted', () => {
    const chat: any[] = [{ is_user: false, message_id: 7, mes: 'anchor', swipe_id: 0 }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    chat[0]._qrf_world_simulation = pausedEnvelope(anchor, 'running').envelope;
    const runtime = new WorldSimulationRuntime_ACU(orchestrator, () => chat);

    expect(runtime.readUiSnapshot().envelope?.task).toMatchObject({ status: 'paused', stopReason: 'interrupted' });
    expect(chat[0]._qrf_world_simulation.task.status).toBe('running');
  });

  it('paused（含 blocked）任务允许保存设置；在途时以 retryable 冲突拒绝', async () => {
    const saveChat = vi.fn().mockResolvedValue(undefined);
    const chat: any[] = [{ is_user: false, message_id: 7, mes: 'anchor', swipe_id: 0 }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    chat[0]._qrf_world_simulation = pausedEnvelope(anchor).envelope;
    const runtime = new WorldSimulationRuntime_ACU(orchestrator, () => chat);
    const settings = buildDefaultWorldSimulationSettings_ACU();
    settings.agentRunBudget.maxIterations = 7;

    await runtime.saveSettings(settings);
    expect(saveChat).toHaveBeenCalledTimes(1);
    expect(chat[0]._qrf_world_simulation).toMatchObject({ settings: { agentRunBudget: { maxIterations: 7 } }, task: { status: 'paused', activeRun: { runId: 'run' } } });

    inFlight = true;
    await expect(runtime.saveSettings(settings)).rejects.toMatchObject({ error: { code: 'WORLD_SIMULATION_REVISION_CONFLICT', retryable: true } });
    expect(saveChat).toHaveBeenCalledTimes(1);
  });


  it('一键清空重置信封与账本、删除各楼层分桶字段、保留设置，并拒绝在途时清空', async () => {
    const saveChat = vi.fn().mockResolvedValue(undefined);
    const chat: any[] = [
      { is_user: false, message_id: 7, mes: 'anchor', swipe_id: 0, _qrf_world_simulation_state: { schemaVersion: 1, entries: {} }, _qrf_world_simulation_agent_run: { x: 1 } },
      { is_user: true, mes: 'user' },
      { is_user: false, message_id: 8, mes: 'assistant 2', swipe_id: 0, _qrf_world_simulation_agent_chat: { schemaVersion: 1, entries: {} }, _qrf_world_simulation_agent_materials: { schemaVersion: 1, entries: {} } },
    ];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    const { envelope } = pausedEnvelope(anchor);
    envelope.settings.autoTriggerEnabled = false;
    envelope.ledger = { ...envelope.ledger, revision: 3 };
    chat[0]._qrf_world_simulation = envelope;
    beginWorldSimulationSessionRun_ACU('chat-a', '运行');
    const runtime = new WorldSimulationRuntime_ACU(orchestrator, () => chat);

    inFlight = true;
    await expect(runtime.clearData()).rejects.toMatchObject({ error: { code: 'WORLD_SIMULATION_REVISION_CONFLICT' } });
    expect(saveChat).not.toHaveBeenCalled();

    inFlight = false;
    await expect(runtime.clearData()).resolves.toEqual({ clearedFloors: 2 });
    expect(chat[0]._qrf_world_simulation).toMatchObject({ settings: { autoTriggerEnabled: false }, task: null, stages: [], activeStageId: null, timeline: [], lastError: null, ledger: { revision: 0 } });
    for (const message of chat) {
      expect(message).not.toHaveProperty('_qrf_world_simulation_state');
      expect(message).not.toHaveProperty('_qrf_world_simulation_agent_run');
      expect(message).not.toHaveProperty('_qrf_world_simulation_agent_chat');
      expect(message).not.toHaveProperty('_qrf_world_simulation_agent_materials');
    }
    expect(chat[0].mes).toBe('anchor');
    expect(saveChat).toHaveBeenCalledTimes(2);
    expect(runtime.readUiSnapshot().session).toMatchObject({ entries: [], running: false });
  });

  it('stop 等待编排器结算并返回是否确有在途运行', async () => {
    const chat: any[] = [{ is_user: false, message_id: 7, mes: 'anchor', swipe_id: 0 }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a' } as any);
    const runtime = new WorldSimulationRuntime_ACU(orchestrator, () => chat);
    inFlight = true;
    await expect(runtime.stop()).resolves.toBe(true);
    expect(interrupt).toHaveBeenCalledWith('chat-a');
    await expect(runtime.stop()).resolves.toBe(false);
  });
});
