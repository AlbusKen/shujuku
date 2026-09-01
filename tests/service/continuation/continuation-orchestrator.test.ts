import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FirstFloorContinuationStore_ACU } from '../../../src/service/continuation/continuation-store';
import { ContinuationOrchestrator_ACU } from '../../../src/service/continuation/continuation-orchestrator';
import { buildDefaultContinuationSettings_ACU } from '../../../src/service/continuation/defaults';
import { ContinuationValidationError_ACU, createContinuationError_ACU } from '../../../src/service/continuation/model';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';

/** 每三轮一个低压轮，满足默认 0.3 的低压占比与连续高压上限，避免固定件本身就违反节奏规则。 */
const pacingAt = (index: number) => (index % 3 === 0 ? 'setup' : 'pressure') as 'setup' | 'pressure';

const outline = { schemaVersion: 1 as const, title: '阶段', goal: '目标', totalTurns: 6, nodes: [{ id: 'node-1', title: '节点', goal: '节点目标', suggestedTurns: 6, turns: Array.from({ length: 6 }, (_, index) => ({ id: `turn-${index + 1}`, goal: `轮次 ${index + 1}`, pacing: pacingAt(index) })) }] };

/**
 * 执行引擎桩：模拟主 Agent 的大纲行为——没有可执行大纲（无阶段或阶段已完成）时
 * 先通过注入的回调派工大纲子代理，review/stopped 时按真实循环的行为抛错中止。
 */
function createOrchestrator(options: { preview?: boolean; planner?: ReturnType<typeof vi.fn>; hasLiveHostClaim?: () => boolean; conversation?: ReturnType<typeof vi.fn>; onSettingsReplaced?: ReturnType<typeof vi.fn> } = {}) {
  const planner = options.planner ?? vi.fn().mockResolvedValue({ outline, attempts: 1, requiresReview: !!options.preview, apiPreset: { presetName: 'preset-a', source: 'fixed', reason: 'fixed_preset' } });
  let sequence = 0;
  const store = new FirstFloorContinuationStore_ACU();
  const executionEngine = {
    prepareCurrentTurnInstruction: vi.fn().mockImplementation(async (_isLeaseCurrent: unknown, _retryAttempt: unknown, applyOutline: (instruction: string) => Promise<{ requiresReview: boolean; stopped: string | null }>) => {
      const task = store.readPersisted()?.activeTask;
      const stage = task?.activeStageId ? task.stages.find(item => item.stageId === task.activeStageId) : null;
      if (!stage || stage.status === 'completed') {
        const result = await applyOutline('按当前要求规划大纲');
        if (result.stopped) {
          throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_TASK_STATE_INVALID', 'agent_loop', '任务已停止', false, { stopped: result.stopped }));
        }
        if (result.requiresReview) {
          throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_OUTLINE_REPLANNED', 'agent_loop', '新大纲等待确认', false));
        }
      }
      return { identity: {}, instruction: { instruction: '发送文本', attempts: 1 } };
    }),
  };
  // 会话记录默认走桩：楼层锚定存储属于 agent-conversation-store 的测试范围，
  // 这里只关心「编排器有没有在正确的时机记下用户消息」。
  const appendAgentConversation = options.conversation ?? vi.fn(async () => true);
  const clearAgentModules = vi.fn(async () => true);
  const clearAgentConversation = vi.fn(async () => true);
  const orchestrator = new ContinuationOrchestrator_ACU({
    store, planner: { plan: planner } as any, executionEngine: executionEngine as any,
    getChatIdentity: () => 'chat-a', now: () => 1_000, allocateId: prefix => `${prefix}-${++sequence}`,
    readChronicleSnapshot: vi.fn().mockResolvedValue({ count: 3, range: { first: 'AM1', last: 'AM3' } }),
    createOutlineResolvers: () => ({}),
    appendAgentConversation, clearAgentModules, clearAgentConversation,
    ...(options.hasLiveHostClaim ? { hasLiveHostClaim: options.hasLiveHostClaim } : {}),
    ...(options.onSettingsReplaced ? { onSettingsReplaced: options.onSettingsReplaced } : {}),
  });
  return { orchestrator, planner, store, executionEngine, appendAgentConversation, clearAgentModules, clearAgentConversation };
}

async function recordPendingHostTurn(orchestrator: ContinuationOrchestrator_ACU, identity: any): Promise<void> {
  await orchestrator.recordHostTurn({
    identity,
    capture: { capturedAt: 1_000, capturedChatLength: 1, capturedAiFloorCount: 0, generationSeq: 1 },
  });
}

async function confirmTurns(orchestrator: ContinuationOrchestrator_ACU, store: FirstFloorContinuationStore_ACU, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    // 每轮确认后任务统一落 paused，真实链路由桥的自动续写调 continueTask 再进入下一轮。
    const before = store.readPersisted()!.activeTask!;
    if (before.status === 'paused' && before.stopReason === null) await orchestrator.continueTask();
    const task = store.readPersisted()!.activeTask!;
    const stage = task.stages.find(item => item.stageId === task.activeStageId)!;
    const revision = stage.revisions.find(item => item.revision === stage.activeRevision)!;
    const node = revision.outline.nodes[stage.activeNodeIndex];
    const turn = node.turns[stage.activeTurnIndex];
    const identity = { chatIdentity: 'chat-a', taskId: task.taskId, stageId: stage.stageId, revision: stage.activeRevision, nodeId: node.id, turnId: turn.id, attemptId: `attempt-${index}` };
    await recordPendingHostTurn(orchestrator, identity);
    await orchestrator.confirmCurrentTurn(identity);
  }
}

async function expectCode(action: () => Promise<unknown>, code: string) {
  try { await action(); } catch (error) {
    expect(error).toBeInstanceOf(ContinuationValidationError_ACU);
    expect((error as ContinuationValidationError_ACU).error.code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe('ContinuationOrchestrator_ACU', () => {
  beforeEach(() => _set_SillyTavern_API_ACU({ chat: [{}], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn().mockResolvedValue(undefined) } as any));

  it('creates the task instantly without planning; the agent-driven continue creates the frozen first stage', async () => {
    const { orchestrator, store, planner } = createOrchestrator();
    const created = await orchestrator.createTask({ originInstruction: '  推进剧情  ' });
    expect(planner).not.toHaveBeenCalled();
    expect(created.task).toMatchObject({ originInstruction: '推进剧情', status: 'paused', runStageCount: 0, activeStageId: null });
    expect(created.task.stages).toEqual([]);

    await orchestrator.continueTask();
    expect(planner).toHaveBeenCalledTimes(1);
    const task = store.readPersisted()!.activeTask!;
    expect(task.runStageCount).toBe(1);
    expect(task.stages[0]).toMatchObject({ status: 'running', activeRevision: 1 });
    expect(task.stages[0].revisions[0].frozen).toBe(true);
    expect(task.stages[0].revisions[0].replanInstruction).toBe('按当前要求规划大纲');
  });

  it('persists replacement settings through the first-floor transaction, including while the task is running', async () => {
    const { orchestrator, store } = createOrchestrator();
    const settings = { ...buildDefaultContinuationSettings_ACU(), loopTags: 'required-tag', internalAiRetryLimit: 0 };

    await expect(orchestrator.replaceSettings({ settings })).resolves.toMatchObject({ settings });
    expect(store.readPersisted()).toMatchObject({ settings });

    // 任务运行中（等待宿主正文等空档）也允许保存：设置在每轮规划开始时才被重新读取，
    // 落盘发生在轮与轮之间，不影响在途生成。拒绝保存会让 UI 显示的渠道与实际调用永久脱节。
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();
    expect(store.readPersisted()!.activeTask!.status).toBe('running');
    const updated = { ...settings, agentHistoryTokenBudget: 12000 };
    await expect(orchestrator.replaceSettings({ settings: updated })).resolves.toMatchObject({ settings: updated });
    expect(store.readPersisted()!.settings.agentHistoryTokenBudget).toBe(12000);
    expect(store.readPersisted()!.activeTask!.status).toBe('running');
  });

  it('keeps preview revisions mutable until acceptance and rejects blank task input', async () => {
    const { orchestrator, store } = createOrchestrator({ preview: true });
    await expectCode(() => orchestrator.createTask({ originInstruction: '   ' }), 'CONTINUATION_ORIGIN_INSTRUCTION_EMPTY');
    await orchestrator.createTask({ originInstruction: '推进剧情' });

    await expectCode(() => orchestrator.continueTask(), 'CONTINUATION_AGENT_OUTLINE_REPLANNED');
    const preview = store.readPersisted()!.activeTask!;
    expect(preview.status).toBe('awaiting_outline_review');
    expect(preview.stages[0].revisions[0].frozen).toBe(false);

    const accepted = await orchestrator.acceptOutline();
    expect(accepted.task).toMatchObject({ status: 'paused' });
    expect(accepted.task.stages[0].revisions[0].frozen).toBe(true);
    expect(store.readPersisted()?.activeTask?.status).toBe('paused');
  });

  it('sets one persistent deadline on continue and never calls the engine after it expires', async () => {
    let now = 1_000;
    const { orchestrator, executionEngine, store } = createOrchestrator();
    (orchestrator as any).dependencies.now = () => now;
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    const stored = store.readPersisted()!;
    stored.settings = { ...buildDefaultContinuationSettings_ACU(), totalDurationMinutes: 1 };
    await store.replaceAtomically(stored, { chatIdentity: 'chat-a' });
    await orchestrator.continueTask();
    expect(executionEngine.prepareCurrentTurnInstruction).toHaveBeenCalledTimes(1);
    now = 61_001;
    const result = await orchestrator.continueTask();
    expect(result.task.stopReason).toBe('duration_reached');
    expect(executionEngine.prepareCurrentTurnInstruction).toHaveBeenCalledTimes(1);
  });

  it('opens a new duration window from a user message without rebuilding the current stage', async () => {
    let now = 1_000;
    const { orchestrator, store } = createOrchestrator();
    (orchestrator as any).dependencies.now = () => now;
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    const persisted = store.readPersisted()!;
    persisted.settings = { ...persisted.settings, totalDurationMinutes: 1 };
    await store.replaceAtomically(persisted, { chatIdentity: 'chat-a' });
    await orchestrator.continueTask();
    const beforeExpiry = store.readPersisted()!.activeTask!;

    now = 61_001;
    await orchestrator.continueTask();
    const stopped = store.readPersisted()!.activeTask!;
    expect(stopped).toMatchObject({ status: 'paused', stopReason: 'duration_reached', taskId: beforeExpiry.taskId });

    const result = await orchestrator.sendAgentMessage({ text: '从当前阶段继续，但把冲突收束一些' });
    const resumed = store.readPersisted()!.activeTask!;
    expect(result).toMatchObject({ created: false, interrupted: false, disposition: 'continue_now', shouldContinue: true });
    expect(resumed).toMatchObject({
      taskId: stopped.taskId,
      status: 'paused',
      stopReason: null,
      lastError: null,
      activeStageId: stopped.activeStageId,
      runStageCount: stopped.runStageCount,
      stageBudgetBaseCount: stopped.runStageCount,
      runStartedAt: now,
      deadlineAt: now + 60_000,
    });
    expect(resumed.stages).toEqual(stopped.stages);
  });

  it('advances only a uniquely current confirmed turn and rejects the same attempt after the cursor moves', async () => {
    const { orchestrator, store } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();
    const task = store.readPersisted()!.activeTask!;
    const stage = task.stages[0];
    const revision = stage.revisions[0];
    const identity = { chatIdentity: 'chat-a', taskId: task.taskId, stageId: stage.stageId, revision: 1, nodeId: revision.outline.nodes[0].id, turnId: revision.outline.nodes[0].turns[0].id, attemptId: 'attempt-a' };
    await recordPendingHostTurn(orchestrator, identity);
    await orchestrator.confirmCurrentTurn(identity, 3);
    const afterConfirm = store.readPersisted()!.activeTask!;
    expect(afterConfirm.stages[0]).toMatchObject({ completedTurns: 1, activeNodeIndex: 0, activeTurnIndex: 1 });
    expect(afterConfirm.timeline.some(entry => entry.kind === 'turn_completed' && entry.messageIndex === 3)).toBe(true);
    await expectCode(() => orchestrator.confirmCurrentTurn(identity), 'CONTINUATION_INTERNAL_REQUEST_STALE');
  });

  it('continueTask 按仍存在的确认楼层回退硬游标，再把校正后的阶段交给 Agent', async () => {
    const { orchestrator, store, executionEngine } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();
    const task = store.readPersisted()!.activeTask!;
    const stage = task.stages[0];
    const revision = stage.revisions[0];
    const identity = { chatIdentity: 'chat-a', taskId: task.taskId, stageId: stage.stageId, revision: 1, nodeId: revision.outline.nodes[0].id, turnId: revision.outline.nodes[0].turns[0].id, attemptId: 'attempt-anchor' };
    await recordPendingHostTurn(orchestrator, identity);
    await orchestrator.confirmCurrentTurn(identity, 3);
    expect(store.readPersisted()!.activeTask!.stages[0].completedTurns).toBe(1);

    const persisted = store.readPersisted()!;
    _set_SillyTavern_API_ACU({ chat: [{ _qrf_continuation: persisted }], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn().mockResolvedValue(undefined) } as any);

    executionEngine.prepareCurrentTurnInstruction.mockClear();
    await orchestrator.continueTask();
    expect(store.readPersisted()!.activeTask!.stages[0].completedTurns).toBe(0);
    expect(executionEngine.prepareCurrentTurnInstruction).toHaveBeenCalledOnce();
  });

  it('pauses at every confirmed turn boundary and exposes auto-continue eligibility', async () => {
    const { orchestrator, store } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();
    await confirmTurns(orchestrator, store, 1);

    // 非最后一轮的确认同样落 paused：自动续写与手动继续都从这个状态出发。
    expect(store.readPersisted()!.activeTask).toMatchObject({ status: 'paused', stopReason: null, lastError: null, pendingHostTurn: null });
    expect(orchestrator.readAutoContinueState()).toEqual({ eligible: true, delaySeconds: 5 });
  });

  it('denies auto-continue for stopped tasks, recorded errors, and pending host turns', async () => {
    const { orchestrator, store } = createOrchestrator();
    expect(orchestrator.readAutoContinueState()).toEqual({ eligible: false, delaySeconds: 0 });

    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();
    const task = store.readPersisted()!.activeTask!;
    const stage = task.stages[0];
    const revision = stage.revisions[0];
    const identity = { chatIdentity: 'chat-a', taskId: task.taskId, stageId: stage.stageId, revision: 1, nodeId: revision.outline.nodes[0].id, turnId: revision.outline.nodes[0].turns[0].id, attemptId: 'attempt-a' };
    await recordPendingHostTurn(orchestrator, identity);
    const staleFailure = store.readPersisted()!;
    staleFailure.activeTask = {
      ...staleFailure.activeTask!,
      stopReason: 'state_invalid',
      lastError: { code: 'CONTINUATION_TASK_STATE_INVALID', message: '历史宿主归属失败', phase: 'generation_evaluate', retryable: true },
    };
    await store.replaceAtomically(staleFailure, { chatIdentity: 'chat-a' });
    expect(orchestrator.readAutoContinueState().eligible).toBe(false);

    await orchestrator.confirmCurrentTurn(identity);
    expect(store.readPersisted()!.activeTask).toMatchObject({ pendingHostTurn: null, stopReason: null, lastError: null });
    expect(orchestrator.readAutoContinueState().eligible).toBe(true);
    await orchestrator.stopTask();
    expect(orchestrator.readAutoContinueState().eligible).toBe(false);
  });

  it('pauses after the final confirmed turn; the next continue delegates the next stage outline to the agent', async () => {
    const { orchestrator, planner, store } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();
    await confirmTurns(orchestrator, store, 6);

    // 末轮确认后不再自动规划：任务落到可继续的暂停态。
    const completed = store.readPersisted()!.activeTask!;
    expect(planner).toHaveBeenCalledTimes(1);
    expect(completed).toMatchObject({ status: 'paused', runStageCount: 1 });
    expect(completed.stages[0].status).toBe('completed');

    await orchestrator.continueTask();
    const task = store.readPersisted()!.activeTask!;
    expect(planner).toHaveBeenCalledTimes(2);
    expect(task).toMatchObject({ runStageCount: 2 });
    expect(task.stages.map(stage => stage.status)).toEqual(['completed', 'running']);
    expect(task.stages[1].revisions[0].frozen).toBe(true);
  });

  it('replans the remaining stage as an agent outline op and freezes the next revision', async () => {
    const { orchestrator, planner, store } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();

    const result = await orchestrator.replanRemaining({ instruction: '收束当前冲突' });
    expect(planner).toHaveBeenCalledTimes(2);
    expect(result.task).toMatchObject({ status: 'paused' });
    const stage = store.readPersisted()!.activeTask!.stages[0];
    expect(stage.activeRevision).toBe(2);
    const revision = stage.revisions.find(item => item.revision === 2)!;
    expect(revision).toMatchObject({ reason: 'manual_replan', replanInstruction: '收束当前冲突', frozen: true });
  });

  it('persists a host-turn identity before dispatch and rejects a mismatched attempt result', async () => {
    const { orchestrator, store } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();
    const task = store.readPersisted()!.activeTask!;
    const stage = task.stages[0];
    const revision = stage.revisions[0];
    const identity = { chatIdentity: 'chat-a', taskId: task.taskId, stageId: stage.stageId, revision: 1, nodeId: revision.outline.nodes[0].id, turnId: revision.outline.nodes[0].turns[0].id, attemptId: 'attempt-host-a' };

    await recordPendingHostTurn(orchestrator, identity);
    expect(store.readPersisted()!.activeTask!.pendingHostTurn).toMatchObject({ identity, status: 'awaiting_generation', retryCount: 0 });
    await expectCode(() => orchestrator.confirmCurrentTurn({ ...identity, attemptId: 'attempt-host-b' }), 'CONTINUATION_INTERNAL_REQUEST_STALE');
    expect(store.readPersisted()!.activeTask!.stages[0].completedTurns).toBe(0);
  });

  it('retries the current host turn with its stable attempt and pauses after the generation retry limit', async () => {
    const { orchestrator, store } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    const initial = store.readPersisted()!;
    initial.settings = { ...initial.settings, generationRetryLimit: 1 };
    await store.replaceAtomically(initial, { chatIdentity: 'chat-a' });
    await orchestrator.continueTask();
    const task = store.readPersisted()!.activeTask!;
    const stage = task.stages[0];
    const revision = stage.revisions[0];
    const identity = { chatIdentity: 'chat-a', taskId: task.taskId, stageId: stage.stageId, revision: 1, nodeId: revision.outline.nodes[0].id, turnId: revision.outline.nodes[0].turns[0].id, attemptId: 'attempt-host-a' };

    await recordPendingHostTurn(orchestrator, identity);
    await orchestrator.rejectHostTurnForMissingTags({ identity, messageIndex: 1 });
    expect(store.readPersisted()!.activeTask).toMatchObject({ status: 'paused', pendingHostTurn: { retryCount: 1, status: 'retry_ready' }, lastError: { code: 'CONTINUATION_GENERATION_TAGS_MISSING' } });

    await orchestrator.continueTask();
    await recordPendingHostTurn(orchestrator, identity);
    await orchestrator.rejectHostTurnForMissingTags({ identity, messageIndex: 2 });
    expect(store.readPersisted()!.activeTask).toMatchObject({ status: 'paused', stopReason: 'generation_retry_exhausted', pendingHostTurn: { retryCount: 1, status: 'exhausted' }, lastError: { code: 'CONTINUATION_GENERATION_TAGS_MISSING', retryable: false } });

    // 重试耗尽后点继续：再走一次酒馆 regenerate，不重跑 Agent、不跳轮。
    const recoveredResult = await orchestrator.continueTask();
    const recovered = store.readPersisted()!.activeTask!;
    expect(recovered).toMatchObject({ status: 'running', stopReason: null, lastError: null, pendingHostTurn: { status: 'retry_ready', identity } });
    expect(recovered.stages[0].completedTurns).toBe(0);
    expect(recoveredResult.retryHostGeneration).toBe(true);
  });

  it('accounts failed generations against the retry limit and stays recoverable after exhaustion', async () => {
    const { orchestrator, store } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    const initial = store.readPersisted()!;
    initial.settings = { ...initial.settings, generationRetryLimit: 1 };
    await store.replaceAtomically(initial, { chatIdentity: 'chat-a' });
    await orchestrator.continueTask();
    const task = store.readPersisted()!.activeTask!;
    const stage = task.stages[0];
    const revision = stage.revisions[0];
    const identity = { chatIdentity: 'chat-a', taskId: task.taskId, stageId: stage.stageId, revision: 1, nodeId: revision.outline.nodes[0].id, turnId: revision.outline.nodes[0].turns[0].id, attemptId: 'attempt-host-a' };

    // 首次生成失败：消耗一次重试额度，转 retry_ready（桥据此自动重发），不设停止原因。
    await recordPendingHostTurn(orchestrator, identity);
    await orchestrator.rejectHostTurnForFailedGeneration(identity);
    expect(store.readPersisted()!.activeTask).toMatchObject({ status: 'paused', stopReason: null, pendingHostTurn: { retryCount: 1, status: 'retry_ready' }, lastError: { code: 'CONTINUATION_GENERATION_FAILED', retryable: true } });

    // 额度耗尽：落 generation_retry_exhausted + exhausted。
    await orchestrator.continueTask();
    await recordPendingHostTurn(orchestrator, identity);
    await orchestrator.rejectHostTurnForFailedGeneration(identity);
    expect(store.readPersisted()!.activeTask).toMatchObject({ status: 'paused', stopReason: 'generation_retry_exhausted', pendingHostTurn: { retryCount: 1, status: 'exhausted' }, lastError: { code: 'CONTINUATION_GENERATION_FAILED', retryable: false } });

    // 自动链停下后，手动「继续」再走一次酒馆 regenerate，不重跑 Agent。
    const recoveredResult = await orchestrator.continueTask();
    expect(store.readPersisted()!.activeTask).toMatchObject({ status: 'running', stopReason: null, lastError: null, pendingHostTurn: { status: 'retry_ready' } });
    expect(recoveredResult.retryHostGeneration).toBe(true);
  });

  it('recovers from a host attribution failure (state_invalid) through an explicit continue', async () => {
    const { orchestrator, store } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();
    const task = store.readPersisted()!.activeTask!;
    const stage = task.stages[0];
    const revision = stage.revisions[0];
    const identity = { chatIdentity: 'chat-a', taskId: task.taskId, stageId: stage.stageId, revision: 1, nodeId: revision.outline.nodes[0].id, turnId: revision.outline.nodes[0].turns[0].id, attemptId: 'attempt-host-a' };

    await recordPendingHostTurn(orchestrator, identity);
    await orchestrator.pauseForHostResultFailure(identity);
    expect(store.readPersisted()!.activeTask).toMatchObject({ status: 'paused', stopReason: 'state_invalid', pendingHostTurn: { status: 'exhausted' }, lastError: { code: 'CONTINUATION_TASK_STATE_INVALID' } });

    // 正文生成出错/归属失败后，继续按钮直接从当前轮次恢复，不再要求清空任务重新规划。
    await orchestrator.continueTask();
    const recovered = store.readPersisted()!.activeTask!;
    expect(recovered).toMatchObject({ status: 'running', stopReason: null, lastError: null });
    expect(recovered.pendingHostTurn).toBeNull();
    expect(recovered.stages[0].completedTurns).toBe(0);
  });

  it('mirrors replaced settings to the global hook only after the envelope persists', async () => {
    const onSettingsReplaced = vi.fn();
    const { orchestrator } = createOrchestrator({ onSettingsReplaced });
    const settings = { ...buildDefaultContinuationSettings_ACU(), loopTags: 'mirror-tag' };
    await orchestrator.replaceSettings({ settings });
    expect(onSettingsReplaced).toHaveBeenCalledTimes(1);
    expect(onSettingsReplaced).toHaveBeenCalledWith(settings);
  });

  it('keeps a manual stop authoritative when an invalidated outline op returns late', async () => {
    let resolvePlan: ((value: any) => void) | undefined;
    const planner = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolvePlan = resolve; }));
    const { orchestrator, store } = createOrchestrator({ planner });
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    const replan = orchestrator.replanRemaining({ instruction: '改为收束冲突' });
    const guarded = replan.catch(error => error);
    // 重规划说明会先作为用户消息落进 Agent 会话再进入租约，因此要等到大纲调用真正发出。
    await vi.waitFor(() => { expect(resolvePlan).toBeDefined(); });
    await orchestrator.stopTask();
    resolvePlan!({ outline, attempts: 1, requiresReview: false, apiPreset: { presetName: 'preset-a', source: 'fixed', reason: 'fixed_preset' } });
    const error = await guarded;
    expect(error).toBeInstanceOf(ContinuationValidationError_ACU);
    expect((error as ContinuationValidationError_ACU).error.code).toBe('CONTINUATION_INTERNAL_REQUEST_STALE');
    expect(store.readPersisted()!.activeTask).toMatchObject({ status: 'paused', stopReason: 'manual' });
    expect(store.readPersisted()!.activeTask!.stages).toEqual([]);
  });

  it('stops after the initial stage when the automatic stage limit is one', async () => {
    const { orchestrator, planner, store } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    const persisted = store.readPersisted()!;
    persisted.settings = { ...persisted.settings, maxAutomaticStages: 1 };
    await store.replaceAtomically(persisted, { chatIdentity: 'chat-a' });
    await orchestrator.continueTask();
    await confirmTurns(orchestrator, store, 6);
    const stopped = store.readPersisted()!.activeTask!;
    expect(stopped).toMatchObject({ status: 'paused', stopReason: 'stage_limit_reached', runStageCount: 1 });
    expect(planner).toHaveBeenCalledTimes(1);

    // 普通继续不重置预算窗口，仍然拒绝。
    await expectCode(() => orchestrator.continueTask(), 'CONTINUATION_TASK_STATE_INVALID');

    const result = await orchestrator.sendAgentMessage({ text: '保留现有进度，继续下一阶段' });
    const resumed = store.readPersisted()!.activeTask!;
    expect(result).toMatchObject({ disposition: 'continue_now', shouldContinue: true });
    expect(resumed).toMatchObject({
      taskId: stopped.taskId,
      status: 'paused',
      stopReason: null,
      runStageCount: 1,
      stageBudgetBaseCount: 1,
    });

    await orchestrator.continueTask();
    const secondStage = store.readPersisted()!.activeTask!;
    expect(secondStage.runStageCount).toBe(2);
    expect(secondStage.stages.at(-1)).toMatchObject({ stageNumber: 2, status: 'running' });
    expect(planner).toHaveBeenCalledTimes(2);

    await confirmTurns(orchestrator, store, 6);
    expect(store.readPersisted()!.activeTask).toMatchObject({
      status: 'paused',
      stopReason: 'stage_limit_reached',
      runStageCount: 2,
      stageBudgetBaseCount: 1,
    });
  });

  it('applies sentence-level outline edits as a frozen next revision without an AI call', async () => {
    const { orchestrator, planner, store } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();
    expect(planner).toHaveBeenCalledTimes(1);

    const result = await (orchestrator as any).applyOutlineEditsWithinLease_ACU('chat-a', {} as any, [
      { op: 'set_turn_goal', turnId: 'turn-2', goal: '守门人先露出破绽' },
      { op: 'insert_turn', nodeId: 'node-1', afterTurnId: 'turn-3', goal: '巡查队提前到场' },
    ], 'running');
    expect(result.summary).toContain('2 处');
    expect(planner).toHaveBeenCalledTimes(1);

    const stage = store.readPersisted()!.activeTask!.stages[0];
    expect(stage.activeRevision).toBe(2);
    expect(stage).toMatchObject({ activeNodeIndex: 0, activeTurnIndex: 0, completedTurns: 0 });
    const revision = stage.revisions.find(item => item.revision === 2)!;
    expect(revision.frozen).toBe(true);
    const turns = revision.outline.nodes.flatMap(node => node.turns);
    expect(turns).toHaveLength(7);
    expect(turns[1].goal).toBe('守门人先露出破绽');
    expect(turns[3].goal).toBe('巡查队提前到场');
    expect(revision.outline.totalTurns).toBe(7);
    expect(revision.outline.nodes[0].suggestedTurns).toBe(7);
  });

  it('outline edits cannot touch completed turns, remove the cursor turn, or leave the stage-size range', async () => {
    const { orchestrator, store } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();

    await expectCode(() => (orchestrator as any).applyOutlineEditsWithinLease_ACU('chat-a', {} as any, [
      { op: 'remove_turn', turnId: 'turn-1' },
    ], 'running'), 'CONTINUATION_AGENT_WRITE_REJECTED');

    // 标准阶段规模下限为 6：删一轮使总轮数掉出范围。
    await expectCode(() => (orchestrator as any).applyOutlineEditsWithinLease_ACU('chat-a', {} as any, [
      { op: 'remove_turn', turnId: 'turn-6' },
    ], 'running'), 'CONTINUATION_OUTLINE_TOTAL_TURNS_OUT_OF_RANGE');

    await confirmTurns(orchestrator, store, 1);
    await orchestrator.continueTask();
    await expectCode(() => (orchestrator as any).applyOutlineEditsWithinLease_ACU('chat-a', {} as any, [
      { op: 'set_turn_goal', turnId: 'turn-1', goal: '篡改已完成轮次' },
    ], 'running'), 'CONTINUATION_REPLAN_COMPLETED_PREFIX_CHANGED');
    expect(store.readPersisted()!.activeTask!.stages[0].activeRevision).toBe(1);
  });

  it('工具编辑要过阶段形态的低压下限，但不受任何周期约束，默认插入轮标为 setup', async () => {
    const { orchestrator, store } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();

    // 固定件是 setup/pressure/pressure/setup/pressure/pressure，形态回填为 mixed（低压下限四分之一）。
    // 删掉一轮低压再补一轮高压，6 轮里只剩 1 轮低压，跌破下限。
    await expectCode(() => (orchestrator as any).applyOutlineEditsWithinLease_ACU('chat-a', {} as any, [
      { op: 'remove_turn', turnId: 'turn-4' },
      { op: 'insert_turn', nodeId: 'node-1', afterTurnId: 'turn-5', goal: '补一场冲突', pacing: 'pressure' },
    ], 'running'), 'CONTINUATION_AGENT_WRITE_REJECTED');
    expect(store.readPersisted()!.activeTask!.stages[0].activeRevision).toBe(1);

    // 只插一轮 pressure：低压轮数量没变，仍满足下限，因此放行——阶段内不存在「每几轮必须有一轮低压」的要求。
    await (orchestrator as any).applyOutlineEditsWithinLease_ACU('chat-a', {} as any, [
      { op: 'insert_turn', nodeId: 'node-1', afterTurnId: 'turn-2', goal: '再加一场追杀', pacing: 'pressure' },
    ], 'running');
    const denser = store.readPersisted()!.activeTask!.stages[0].revisions.find(item => item.revision === 2)!;
    expect(denser.outline.nodes[0].turns.map(turn => turn.pacing)).toEqual(['setup', 'pressure', 'pressure', 'pressure', 'setup', 'pressure', 'pressure']);

    // 不写 pacing 时按 setup 落值，低压轮因此变多而不是变少。
    await (orchestrator as any).applyOutlineEditsWithinLease_ACU('chat-a', {} as any, [
      { op: 'insert_turn', nodeId: 'node-1', afterTurnId: 'turn-2', goal: '两人在檐下躲雨说话' },
    ], 'running');
    const revision = store.readPersisted()!.activeTask!.stages[0].revisions.find(item => item.revision === 3)!;
    expect(revision.outline.nodes[0].turns[2].pacing).toBe('setup');
  });

  it('规划时把跨阶段节奏上下文交给 planner：上一阶段形态与尾部连续高压段都被带上', async () => {
    const { orchestrator, store, planner } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();

    expect(planner.mock.calls[0][0].pacingContext).toEqual({ previousTempo: null, leadingPressureStreak: 0 });

    await confirmTurns(orchestrator, store, 3);
    await orchestrator.replanRemaining({ instruction: '改写剩余部分' });

    // 已完成 3 轮 setup/pressure/pressure，尾部两轮高压要带进重规划；上一阶段形态取它前面的阶段（没有）。
    const revised = planner.mock.calls[planner.mock.calls.length - 1][0];
    expect(revised.pacingContext).toEqual({ previousTempo: null, leadingPressureStreak: 2 });
  });

  it('stays busy while the bridge holds a live claim for the awaiting host turn', async () => {
    const { orchestrator, store } = createOrchestrator({ hasLiveHostClaim: () => true });
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();
    const task = store.readPersisted()!.activeTask!;
    const stage = task.stages[0];
    const revision = stage.revisions[0];
    const identity = { chatIdentity: 'chat-a', taskId: task.taskId, stageId: stage.stageId, revision: 1, nodeId: revision.outline.nodes[0].id, turnId: revision.outline.nodes[0].turns[0].id, attemptId: 'attempt-live' };
    await recordPendingHostTurn(orchestrator, identity);

    await expectCode(() => orchestrator.continueTask(), 'CONTINUATION_OPERATION_BUSY');
    expect(store.readPersisted()!.activeTask!.pendingHostTurn).toMatchObject({ status: 'awaiting_generation' });
  });

  it('recovers a stale awaiting host turn without a live claim and continues from current progress', async () => {
    const { orchestrator, store, executionEngine } = createOrchestrator({ hasLiveHostClaim: () => false });
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();
    const task = store.readPersisted()!.activeTask!;
    const stage = task.stages[0];
    const revision = stage.revisions[0];
    const identity = { chatIdentity: 'chat-a', taskId: task.taskId, stageId: stage.stageId, revision: 1, nodeId: revision.outline.nodes[0].id, turnId: revision.outline.nodes[0].turns[0].id, attemptId: 'attempt-stale' };
    await recordPendingHostTurn(orchestrator, identity);

    // 重载/事件丢失后的滞留等待轮：桥没有活认领，继续应当丢弃它并重新规划当前轮。
    await orchestrator.continueTask();
    const recovered = store.readPersisted()!.activeTask!;
    expect(recovered.pendingHostTurn).toBeNull();
    expect(recovered.status).toBe('running');
    expect(executionEngine.prepareCurrentTurnInstruction).toHaveBeenCalledTimes(2);
  });

  it('resumes a manually stopped task from current progress and clears its awaiting turn on stop', async () => {
    const { orchestrator, store, executionEngine } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();
    const task = store.readPersisted()!.activeTask!;
    const stage = task.stages[0];
    const revision = stage.revisions[0];
    const identity = { chatIdentity: 'chat-a', taskId: task.taskId, stageId: stage.stageId, revision: 1, nodeId: revision.outline.nodes[0].id, turnId: revision.outline.nodes[0].turns[0].id, attemptId: 'attempt-stop' };
    await recordPendingHostTurn(orchestrator, identity);

    await orchestrator.stopTask();
    const stopped = store.readPersisted()!.activeTask!;
    expect(stopped).toMatchObject({ status: 'paused', stopReason: 'manual' });
    expect(stopped.pendingHostTurn).toBeNull();

    await orchestrator.continueTask();
    const resumed = store.readPersisted()!.activeTask!;
    expect(resumed.stopReason).toBeNull();
    expect(resumed.status).toBe('running');
    expect(executionEngine.prepareCurrentTurnInstruction).toHaveBeenCalledTimes(2);
  });

  it('keeps non-manual stop reasons non-resumable', async () => {
    const { orchestrator, store } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    const persisted = store.readPersisted()!;
    persisted.settings = { ...persisted.settings, maxAutomaticStages: 1 };
    await store.replaceAtomically(persisted, { chatIdentity: 'chat-a' });
    await orchestrator.continueTask();
    await confirmTurns(orchestrator, store, 6);
    expect(store.readPersisted()!.activeTask!.stopReason).toBe('stage_limit_reached');

    await expectCode(() => orchestrator.continueTask(), 'CONTINUATION_TASK_STATE_INVALID');
  });

  it('converts a stopped host generation into a retryable turn without consuming the retry budget', async () => {
    const { orchestrator, store } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();
    const task = store.readPersisted()!.activeTask!;
    const stage = task.stages[0];
    const revision = stage.revisions[0];
    const identity = { chatIdentity: 'chat-a', taskId: task.taskId, stageId: stage.stageId, revision: 1, nodeId: revision.outline.nodes[0].id, turnId: revision.outline.nodes[0].turns[0].id, attemptId: 'attempt-stopped' };
    await recordPendingHostTurn(orchestrator, identity);

    await orchestrator.failHostTurnForStoppedGeneration(identity);
    expect(store.readPersisted()!.activeTask).toMatchObject({
      status: 'paused',
      stopReason: null,
      pendingHostTurn: { status: 'retry_ready', retryCount: 0 },
      lastError: { code: 'CONTINUATION_TASK_STATE_INVALID', retryable: true },
    });
  });

  it('requires explicit confirmation before abandoning the current task', async () => {
    const { orchestrator, store } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await expectCode(() => orchestrator.abandonAndCreate({ originInstruction: '新任务' }), 'CONTINUATION_TASK_STATE_INVALID');
    expect(store.readPersisted()!.activeTask?.originInstruction).toBe('推进剧情');
  });

  it('sendAgentMessage 在没有任务时创建任务，并把这句话记成用户消息', async () => {
    const { orchestrator, store, appendAgentConversation, planner } = createOrchestrator();
    const result = await orchestrator.sendAgentMessage({ text: '  推进主角进入禁区  ' });

    expect(result).toMatchObject({ created: true, interrupted: false, shouldContinue: true });
    expect(store.readPersisted()!.activeTask).toMatchObject({ originInstruction: '推进主角进入禁区', status: 'paused' });
    // 创建本身不发起大纲规划：规划由紧随其后的 continueTask 触发。
    expect(planner).not.toHaveBeenCalled();
    expect(appendAgentConversation).toHaveBeenCalledOnce();
    expect(appendAgentConversation.mock.calls[0][0]).toMatchObject([{ kind: 'user', text: '推进主角进入禁区', digest: '创建续写任务' }]);
  });

  it('sendAgentMessage 打断运行中的循环并落回可继续的 paused，在途结果随后被判失效', async () => {
    let resolvePlan: ((value: any) => void) | undefined;
    const planner = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolvePlan = resolve; }));
    const { orchestrator, store, appendAgentConversation } = createOrchestrator({ planner });
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    const guarded = orchestrator.continueTask().catch(error => error);
    await vi.waitFor(() => { expect(resolvePlan).toBeDefined(); });
    expect(store.readPersisted()!.activeTask!.status).toBe('running');

    const result = await orchestrator.sendAgentMessage({ text: '这一轮别揭穿守门人' });
    expect(result).toMatchObject({ created: false, interrupted: true, shouldContinue: true });
    expect(appendAgentConversation.mock.calls[0][0]).toMatchObject([{ kind: 'user', text: '这一轮别揭穿守门人', digest: '打断并插话' }]);
    // 打断不是停止：不设 stopReason，等着带上新消息继续。
    expect(store.readPersisted()!.activeTask).toMatchObject({ status: 'paused', stopReason: null, lastError: null });

    resolvePlan!({ outline, attempts: 1, requiresReview: false, apiPreset: { presetName: 'preset-a', source: 'fixed', reason: 'fixed_preset' } });
    expect((await guarded as ContinuationValidationError_ACU).error.code).toBe('CONTINUATION_INTERNAL_REQUEST_STALE');
  });

  it('sendAgentMessage 在会话持久化返回 false 时不会中断仍在运行的循环', async () => {
    let resolvePlan: ((value: any) => void) | undefined;
    const planner = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolvePlan = resolve; }));
    const { orchestrator, store } = createOrchestrator({ planner, conversation: vi.fn(async () => false) });
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    const running = orchestrator.continueTask();
    await vi.waitFor(() => { expect(resolvePlan).toBeDefined(); });

    await expectCode(() => orchestrator.sendAgentMessage({ text: '这条消息必须先保存' }), 'CONTINUATION_PERSIST_FAILED');
    expect(store.readPersisted()!.activeTask).toMatchObject({ status: 'running', stopReason: null });

    resolvePlan!({ outline, attempts: 1, requiresReview: false, apiPreset: { presetName: 'preset-a', source: 'fixed', reason: 'fixed_preset' } });
    await expect(running).resolves.toMatchObject({ task: { status: 'running' } });
  });

  it('sendAgentMessage 在会话持久化拒绝时不会中断仍在运行的循环', async () => {
    let resolvePlan: ((value: any) => void) | undefined;
    const planner = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolvePlan = resolve; }));
    const { orchestrator, store } = createOrchestrator({ planner, conversation: vi.fn(async () => { throw new Error('会话写入失败'); }) });
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    const running = orchestrator.continueTask();
    await vi.waitFor(() => { expect(resolvePlan).toBeDefined(); });

    await expectCode(() => orchestrator.sendAgentMessage({ text: '这条消息必须先保存' }), 'CONTINUATION_PERSIST_FAILED');
    expect(store.readPersisted()!.activeTask).toMatchObject({ status: 'running', stopReason: null });

    resolvePlan!({ outline, attempts: 1, requiresReview: false, apiPreset: { presetName: 'preset-a', source: 'fixed', reason: 'fixed_preset' } });
    await expect(running).resolves.toMatchObject({ task: { status: 'running' } });
  });

  it('sendAgentMessage 在有 live host claim 的等待宿主正文时只排队，不打断酒馆生成', async () => {
    const { orchestrator, store, appendAgentConversation } = createOrchestrator({ hasLiveHostClaim: () => true });
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();
    const task = store.readPersisted()!.activeTask!;
    const stage = task.stages[0];
    const revision = stage.revisions[0];
    await recordPendingHostTurn(orchestrator, {
      chatIdentity: 'chat-a', taskId: task.taskId, stageId: stage.stageId, revision: 1,
      nodeId: revision.outline.nodes[0].id, turnId: revision.outline.nodes[0].turns[0].id, attemptId: 'attempt-await',
    });

    const result = await orchestrator.sendAgentMessage({ text: '下一轮收一点' });
    expect(result).toMatchObject({ interrupted: false, disposition: 'queued_after_host', shouldContinue: false });
    expect(appendAgentConversation.mock.calls[0][0]).toMatchObject([{ kind: 'user', digest: '会话输入' }]);
    expect(store.readPersisted()!.activeTask!.pendingHostTurn).toMatchObject({ status: 'awaiting_generation' });
  });

  it('sendAgentMessage 清理无 live claim 的滞留等待轮并立即恢复', async () => {
    const { orchestrator, store } = createOrchestrator({ hasLiveHostClaim: () => false });
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();
    const task = store.readPersisted()!.activeTask!;
    const stage = task.stages[0];
    const revision = stage.revisions[0];
    await recordPendingHostTurn(orchestrator, {
      chatIdentity: 'chat-a', taskId: task.taskId, stageId: stage.stageId, revision: 1,
      nodeId: revision.outline.nodes[0].id, turnId: revision.outline.nodes[0].turns[0].id, attemptId: 'attempt-stale-message',
    });

    const result = await orchestrator.sendAgentMessage({ text: '从这一轮重新准备' });
    expect(result).toMatchObject({ interrupted: false, disposition: 'continue_now', shouldContinue: true });
    expect(store.readPersisted()!.activeTask).toMatchObject({ status: 'paused', pendingHostTurn: null, stopReason: null });
  });

  it('sendAgentMessage 接收专用流程状态中的消息但不穿透大纲确认门禁', async () => {
    const { orchestrator, store } = createOrchestrator({ preview: true });
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await expectCode(() => orchestrator.continueTask(), 'CONTINUATION_AGENT_OUTLINE_REPLANNED');
    expect(store.readPersisted()!.activeTask!.status).toBe('awaiting_outline_review');

    const result = await orchestrator.sendAgentMessage({ text: '确认前先把节奏放慢' });
    expect(result).toMatchObject({
      disposition: 'accepted_without_resume',
      shouldContinue: false,
      detail: '当前大纲正在等待确认，确认后才能继续执行。',
    });
    expect(store.readPersisted()!.activeTask!.status).toBe('awaiting_outline_review');
  });

  it('replaceActiveOutline 走与工具编辑相同的校验：改未完成的目标句可以，动当前执行轮不行', async () => {
    const { orchestrator, store, planner } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();
    // 运行中不许手动改：先确认一轮让任务落回 paused。
    await expectCode(() => orchestrator.replaceActiveOutline({ outline: outline as any }), 'CONTINUATION_OPERATION_BUSY');
    await confirmTurns(orchestrator, store, 1);

    const current = store.readPersisted()!.activeTask!.stages[0].revisions[0].outline;
    const edited = {
      ...current,
      nodes: [{ ...current.nodes[0], turns: current.nodes[0].turns.map((turn, index) => index === 2 ? { ...turn, goal: '用户改写的第三轮目标' } : turn) }],
    };
    await orchestrator.replaceActiveOutline({ outline: edited as any });
    // 手动编辑不发大纲 AI 调用，直接生成下一个已冻结 revision。
    expect(planner).toHaveBeenCalledTimes(1);
    const stage = store.readPersisted()!.activeTask!.stages[0];
    expect(stage.activeRevision).toBe(2);
    const saved = stage.revisions.find(item => item.revision === 2)!;
    expect(saved).toMatchObject({ frozen: true, reason: 'manual_replan', replanInstruction: '用户手动编辑' });
    expect(saved.outline.nodes[0].turns[2].goal).toBe('用户改写的第三轮目标');

    // 删掉当前正在执行的轮次（已完成 1 轮，游标在第 2 轮）：拒绝，revision 不变。
    const withoutCursor = { ...saved.outline, nodes: [{ ...saved.outline.nodes[0], turns: saved.outline.nodes[0].turns.filter(turn => turn.id !== 'turn-2') }] };
    await expectCode(() => orchestrator.replaceActiveOutline({ outline: withoutCursor as any }), 'CONTINUATION_AGENT_WRITE_REJECTED');
    expect(store.readPersisted()!.activeTask!.stages[0].activeRevision).toBe(2);
  });

  it('clearContinuationData 丢任务、资料与会话记录，但不碰正文楼层', async () => {
    const { orchestrator, store, clearAgentModules, clearAgentConversation } = createOrchestrator();
    await orchestrator.createTask({ originInstruction: '推进剧情' });
    await orchestrator.continueTask();
    expect(store.readPersisted()!.activeTask).not.toBeNull();

    const result = await orchestrator.clearContinuationData();
    expect(result).toMatchObject({ clearedModules: true, clearedConversation: true });
    expect(result.envelope.activeTask).toBeNull();
    expect(store.readPersisted()!.activeTask).toBeNull();
    expect(clearAgentModules).toHaveBeenCalledOnce();
    expect(clearAgentConversation).toHaveBeenCalledOnce();
    // 设置不受影响：清空只针对任务与运行期资料。
    expect(store.readPersisted()!.settings).toBeTruthy();

    // 清空后可以直接从当前剧情重新开始规划。
    await orchestrator.sendAgentMessage({ text: '从这里重新规划' });
    expect(store.readPersisted()!.activeTask).toMatchObject({ originInstruction: '从这里重新规划' });
  });
});
