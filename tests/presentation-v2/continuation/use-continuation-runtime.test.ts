/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  bridgeSend: vi.fn(async () => true),
  bridgeRetryHostGeneration: vi.fn(async () => true),
  bridgeSubscribe: vi.fn((listener: () => void) => { harness.bridgeStateListener = listener; return vi.fn(); }),
  bridgeStateListener: undefined as (() => void) | undefined,
  continueTask: vi.fn(),
  retryCurrentTurn: vi.fn(),
  createTask: vi.fn(),
  stopTask: vi.fn(),
  stopHostGeneration: vi.fn(),
  replanRemaining: vi.fn(),
  acceptOutline: vi.fn(),
  abandonAndCreate: vi.fn(),
  replaceSettings: vi.fn(),
  sendAgentMessage: vi.fn(),
  replaceActiveOutline: vi.fn(),
  clearContinuationData: vi.fn(),
  initialize: vi.fn(async () => null),
  read: vi.fn(() => null),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock('../../../src/service/continuation/continuation-runtime', () => ({
  // 展示兜底设置：composable 初始化即调用，mock 里给最小骨架即可（测试不断言其内容）。
  buildInitialContinuationSettings_ACU: () => ({}) as any,
  getContinuationRuntime_ACU: () => ({
    bridge: { send: harness.bridgeSend, retryHostGeneration: harness.bridgeRetryHostGeneration, stopHostGeneration: harness.stopHostGeneration, subscribeStateChanges: harness.bridgeSubscribe },
    orchestrator: {
      continueTask: harness.continueTask,
      retryCurrentTurn: harness.retryCurrentTurn,
      createTask: harness.createTask,
      stopTask: harness.stopTask,
      replanRemaining: harness.replanRemaining,
      acceptOutline: harness.acceptOutline,
      abandonAndCreate: harness.abandonAndCreate,
      replaceSettings: harness.replaceSettings,
      sendAgentMessage: harness.sendAgentMessage,
      replaceActiveOutline: harness.replaceActiveOutline,
      clearContinuationData: harness.clearContinuationData,
    },
    initialize: harness.initialize,
    read: harness.read,
  }),
}));
vi.mock('../../../src/presentation-v2/stores/toast-store', () => ({
  useToastStore: () => ({ error: harness.toastError, success: harness.toastSuccess, info: harness.toastInfo }),
}));

const envelope = { schemaVersion: 1, settings: {}, activeTask: null } as any;
const result = { envelope, task: { taskId: 'task-1' } } as any;
const preparedTurn = {
  identity: { chatIdentity: 'chat-a', taskId: 'task-1', stageId: 'stage-1', revision: 1, nodeId: 'node-1', turnId: 'turn-1', attemptId: 'attempt-1' },
  instruction: { instruction: '最终普通文本' },
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  harness.bridgeStateListener = undefined;
  harness.read.mockReturnValue(envelope);
  harness.initialize.mockResolvedValue(null);
  harness.bridgeSend.mockResolvedValue(true);
  harness.continueTask.mockResolvedValue(result);
  harness.createTask.mockResolvedValue(result);
  harness.stopTask.mockResolvedValue(result);
  harness.replanRemaining.mockResolvedValue(result);
  harness.retryCurrentTurn.mockResolvedValue(result);
  harness.acceptOutline.mockResolvedValue(result);
  harness.abandonAndCreate.mockResolvedValue(result);
  harness.replaceSettings.mockResolvedValue(envelope);
  harness.sendAgentMessage.mockResolvedValue({
    ...result,
    created: false,
    interrupted: false,
    disposition: 'accepted_without_resume',
    detail: '当前状态暂不能恢复。',
    shouldContinue: false,
  });
  harness.replaceActiveOutline.mockResolvedValue(result);
  harness.clearContinuationData.mockResolvedValue({ envelope, clearedModules: true, clearedConversation: true });
});

describe('useContinuationRuntime', () => {
  it('仅将 orchestrator 返回的 preparedTurn 交给 runtime bridge', async () => {
    harness.continueTask.mockResolvedValue({ ...result, preparedTurn });
    const { useContinuationRuntime } = await import('../../../src/presentation-v2/composables/useContinuationRuntime');
    const continuation = useContinuationRuntime();

    await continuation.continueTask();

    expect(harness.continueTask).toHaveBeenCalledOnce();
    expect(harness.bridgeSend).toHaveBeenCalledOnce();
    expect(harness.bridgeSend).toHaveBeenCalledWith(preparedTurn);
  });

  it('没有 preparedTurn 时不触发宿主发送', async () => {
    const { useContinuationRuntime } = await import('../../../src/presentation-v2/composables/useContinuationRuntime');
    const continuation = useContinuationRuntime();

    await continuation.continueTask();

    expect(harness.bridgeSend).not.toHaveBeenCalled();
  });

  it('refreshes the authoritative envelope when the host bridge confirms a result', async () => {
    const awaiting = { schemaVersion: 1, settings: {}, activeTask: { status: 'running', pendingHostTurn: { status: 'awaiting_generation' } } } as any;
    const confirmed = { schemaVersion: 1, settings: {}, activeTask: { status: 'paused', pendingHostTurn: null } } as any;
    harness.read.mockReturnValue(awaiting);
    const { useContinuationRuntime } = await import('../../../src/presentation-v2/composables/useContinuationRuntime');
    const continuation = useContinuationRuntime();
    continuation.refresh();
    harness.read.mockClear();
    harness.read.mockReturnValue(confirmed);

    harness.bridgeStateListener!();

    expect(harness.read).toHaveBeenCalledOnce();
    expect(continuation.task.value).toEqual(confirmed.activeTask);
  });

  it('初始化完成后刷新首楼权威状态', async () => {
    const { useContinuationRuntime } = await import('../../../src/presentation-v2/composables/useContinuationRuntime');
    const continuation = useContinuationRuntime();

    await continuation.initialize();

    expect(harness.initialize).toHaveBeenCalledOnce();
    expect(harness.read).toHaveBeenCalledOnce();
    expect(continuation.task.value).toBeNull();
  });

  it('创建任务成功后自动开始第一轮，创建失败则不继续', async () => {
    const pausedTask = { taskId: 'task-1', status: 'paused', stopReason: null, activeStageId: null, stages: [] };
    const createdEnvelope = { schemaVersion: 1, settings: {}, activeTask: pausedTask } as any;
    harness.createTask.mockResolvedValue({ envelope: createdEnvelope, task: pausedTask });
    harness.read.mockReturnValue(createdEnvelope);
    harness.continueTask.mockResolvedValue({ envelope: createdEnvelope, task: pausedTask });
    const { useContinuationRuntime } = await import('../../../src/presentation-v2/composables/useContinuationRuntime');
    const continuation = useContinuationRuntime();
    continuation.originInstruction.value = '推进剧情';

    await continuation.createTask();
    expect(harness.createTask).toHaveBeenCalledOnce();
    expect(harness.continueTask).toHaveBeenCalledOnce();

    harness.createTask.mockRejectedValue(new Error('创建失败'));
    harness.continueTask.mockClear();
    continuation.originInstruction.value = '再来一次';
    await continuation.createTask();
    expect(harness.continueTask).not.toHaveBeenCalled();
  });

  it('手动停止的任务允许继续，其余停止原因不允许', async () => {
    const stoppedTask = { taskId: 'task-1', status: 'paused', stopReason: 'manual', activeStageId: null, stages: [], pendingHostTurn: null };
    harness.read.mockReturnValue({ schemaVersion: 1, settings: {}, activeTask: stoppedTask } as any);
    const { useContinuationRuntime } = await import('../../../src/presentation-v2/composables/useContinuationRuntime');
    const continuation = useContinuationRuntime();
    continuation.refresh();
    expect(continuation.canContinue.value).toBe(true);

    harness.read.mockReturnValue({ schemaVersion: 1, settings: {}, activeTask: { ...stoppedTask, stopReason: 'duration_reached' } } as any);
    continuation.refresh();
    expect(continuation.canContinue.value).toBe(false);
  });

  it('将设置保存和预览确认经由编排器处理，不直接发送宿主消息', async () => {
    const { useContinuationRuntime } = await import('../../../src/presentation-v2/composables/useContinuationRuntime');
    const continuation = useContinuationRuntime();
    const settings = { stageSize: 'standard' } as any;
    const outline = { schemaVersion: 1, title: '阶段', goal: '目标', totalTurns: 6, nodes: [] } as any;

    await expect(continuation.saveSettings(settings)).resolves.toBe('saved');
    await continuation.acceptOutline(outline);

    expect(harness.replaceSettings).toHaveBeenCalledWith({ settings });
    expect(harness.acceptOutline).toHaveBeenCalledWith({ outline });
    expect(harness.bridgeSend).not.toHaveBeenCalled();
  });

  it('设置保存遇到操作互斥时返回 busy 且不弹错误吐司，其他错误返回 failed 并吐司', async () => {
    const { useContinuationRuntime } = await import('../../../src/presentation-v2/composables/useContinuationRuntime');
    const { ContinuationValidationError_ACU, createContinuationError_ACU } = await import('../../../src/service/continuation/model');
    const continuation = useContinuationRuntime();
    const settings = { stageSize: 'standard' } as any;

    harness.replaceSettings.mockRejectedValueOnce(new ContinuationValidationError_ACU(
      createContinuationError_ACU('CONTINUATION_OPERATION_BUSY', 'persist', '当前聊天已有智能续写操作正在执行', false),
    ));
    await expect(continuation.saveSettings(settings)).resolves.toBe('busy');
    expect(harness.toastError).not.toHaveBeenCalled();

    harness.replaceSettings.mockRejectedValueOnce(new Error('持久化失败'));
    await expect(continuation.saveSettings(settings)).resolves.toBe('failed');
    expect(harness.toastError).toHaveBeenCalled();
  });

  it('停止不经 busy 闸：循环在跑（busy 为 true）时 stopTask 仍直达编排器、打断宿主生成并刷新状态', async () => {
    const { useContinuationRuntime } = await import('../../../src/presentation-v2/composables/useContinuationRuntime');
    const continuation = useContinuationRuntime();
    let release!: (value: unknown) => void;
    harness.continueTask.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));

    const inflight = continuation.continueTask();
    expect(continuation.busy.value).toBe(true);

    await continuation.stopTask();
    expect(harness.stopTask).toHaveBeenCalledOnce();
    expect(harness.stopHostGeneration).toHaveBeenCalledOnce();
    expect(harness.read).toHaveBeenCalled();

    release(result);
    await inflight;
    expect(continuation.busy.value).toBe(false);
  });

  it('宿主直接重发通道：留会话痕迹并弹提示说明消息将在下一轮被读取', async () => {
    harness.sendAgentMessage.mockResolvedValue({ ...result, disposition: 'continue_now', shouldContinue: true });
    harness.continueTask.mockResolvedValue({ ...result, retryHostGeneration: true });
    const sessionLog = await import('../../../src/service/continuation/agent/agent-session-log');
    sessionLog.resetAgentSessionLogForTests_ACU();
    const { useContinuationRuntime } = await import('../../../src/presentation-v2/composables/useContinuationRuntime');
    const continuation = useContinuationRuntime();

    expect(await continuation.sendAgentMessage('继续吧')).toBe(true);

    expect(harness.bridgeRetryHostGeneration).toHaveBeenCalledOnce();
    expect(harness.bridgeSend).not.toHaveBeenCalled();
    expect(harness.toastInfo).toHaveBeenCalledWith('上一轮正文未完成，已让酒馆直接重新生成；你的消息会在下一轮被主 Agent 读取。');
    const entries = sessionLog.readAgentSessionLog_ACU();
    expect(entries.some(entry => entry.kind === 'protocol_retry' && entry.title === '重发上一轮正文')).toBe(true);
    sessionLog.resetAgentSessionLogForTests_ACU();
  });

  it('发送落盘后、续跑前点停止：不再调用 continueTask', async () => {
    let resolveSend!: (value: unknown) => void;
    harness.sendAgentMessage.mockImplementationOnce(() => new Promise(resolve => { resolveSend = resolve; }));
    const { useContinuationRuntime } = await import('../../../src/presentation-v2/composables/useContinuationRuntime');
    const continuation = useContinuationRuntime();

    const pending = continuation.sendAgentMessage('先记下这句话');
    await continuation.stopTask();
    resolveSend({ ...result, disposition: 'continue_now', shouldContinue: true });

    await expect(pending).resolves.toBe(true);
    expect(harness.continueTask).not.toHaveBeenCalled();
    expect(harness.stopHostGeneration).toHaveBeenCalledOnce();
  });

  it('在途操作被停止中断（STALE）时弹中性提示而不是错误吐司', async () => {
    const { useContinuationRuntime } = await import('../../../src/presentation-v2/composables/useContinuationRuntime');
    const { ContinuationValidationError_ACU, createContinuationError_ACU } = await import('../../../src/service/continuation/model');
    const continuation = useContinuationRuntime();

    harness.continueTask.mockRejectedValueOnce(new ContinuationValidationError_ACU(
      createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'agent_loop', '本轮规划已被用户中断', false),
    ));
    await continuation.continueTask();
    expect(harness.toastInfo).toHaveBeenCalledWith('本轮规划已被用户中断');
    expect(harness.toastError).not.toHaveBeenCalled();
  });

  it('由消息启动的新动作替换旧动作后，旧动作完成不会提前清除 busy', async () => {
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    harness.continueTask
      .mockImplementationOnce(() => new Promise(resolve => { releaseFirst = () => resolve(result); }))
      .mockImplementationOnce(() => new Promise(resolve => { releaseSecond = () => resolve(result); }));
    harness.sendAgentMessage.mockResolvedValue({ ...result, disposition: 'continue_now', shouldContinue: true });
    const { useContinuationRuntime } = await import('../../../src/presentation-v2/composables/useContinuationRuntime');
    const continuation = useContinuationRuntime();

    const first = continuation.continueTask();
    await vi.waitFor(() => { expect(harness.continueTask).toHaveBeenCalledTimes(1); });
    const message = continuation.sendAgentMessage('用新消息替换旧动作');
    await vi.waitFor(() => { expect(harness.continueTask).toHaveBeenCalledTimes(2); });

    releaseFirst();
    await first;
    expect(continuation.busy.value).toBe(true);

    releaseSecond();
    await expect(message).resolves.toBe(true);
    expect(continuation.busy.value).toBe(false);
  });

  it('会话发送：空白不派发，continue_now 时紧接着跑一轮', async () => {
    harness.sendAgentMessage.mockResolvedValue({ ...result, created: true, interrupted: false, disposition: 'continue_now', shouldContinue: true });
    const { useContinuationRuntime } = await import('../../../src/presentation-v2/composables/useContinuationRuntime');
    const continuation = useContinuationRuntime();

    expect(await continuation.sendAgentMessage('   ')).toBe(false);
    expect(harness.sendAgentMessage).not.toHaveBeenCalled();

    expect(await continuation.sendAgentMessage('别揭穿守门人')).toBe(true);
    expect(harness.sendAgentMessage).toHaveBeenCalledWith({ text: '别揭穿守门人' });
    expect(harness.continueTask).toHaveBeenCalledOnce();
  });

  it('会话发送按 disposition 区分排队、专用状态和未知后续动作', async () => {
    const { useContinuationRuntime } = await import('../../../src/presentation-v2/composables/useContinuationRuntime');
    const continuation = useContinuationRuntime();

    harness.sendAgentMessage.mockResolvedValue({ ...result, disposition: 'queued_after_host', shouldContinue: false });
    expect(await continuation.sendAgentMessage('当前正文结束后再收束')).toBe(true);
    expect(harness.continueTask).not.toHaveBeenCalled();
    expect(harness.toastInfo).toHaveBeenCalledWith('消息已排队，会在当前正文完成后生效。');

    harness.sendAgentMessage.mockResolvedValue({ ...result, disposition: 'accepted_without_resume', detail: '当前大纲正在等待确认。', shouldContinue: false });
    expect(await continuation.sendAgentMessage('确认前先放慢节奏')).toBe(true);
    expect(harness.continueTask).not.toHaveBeenCalled();
    expect(harness.toastInfo).toHaveBeenCalledWith('当前大纲正在等待确认。');

    harness.sendAgentMessage.mockResolvedValue({ ...result, disposition: 'unexpected_action', shouldContinue: false });
    expect(await continuation.sendAgentMessage('不接受未知动作')).toBe(false);
    expect(harness.toastError).toHaveBeenCalledWith('消息已保存，但返回了无法执行的后续动作。', { muteable: false });
  });

  it('消息已保存但续跑失败时不重复发送消息，并显示准确提示', async () => {
    harness.sendAgentMessage.mockResolvedValue({ ...result, disposition: 'continue_now', shouldContinue: true });
    harness.continueTask.mockRejectedValue(new Error('续跑失败'));
    const { useContinuationRuntime } = await import('../../../src/presentation-v2/composables/useContinuationRuntime');
    const continuation = useContinuationRuntime();

    expect(await continuation.sendAgentMessage('保存后继续')).toBe(true);
    expect(harness.sendAgentMessage).toHaveBeenCalledOnce();
    expect(harness.continueTask).toHaveBeenCalledOnce();
    // 失败原因必须带出来：只说「启动续写失败」用户无法判断是楼层、宿主还是状态问题。
    expect(harness.toastError).toHaveBeenCalledWith('消息已保存，但启动续写失败：续跑失败', { muteable: false });
  });

  it('会话发送失败时不触发续跑', async () => {
    harness.sendAgentMessage.mockRejectedValue(new Error('发送失败'));
    const { useContinuationRuntime } = await import('../../../src/presentation-v2/composables/useContinuationRuntime');
    const continuation = useContinuationRuntime();

    expect(await continuation.sendAgentMessage('打断一下')).toBe(false);
    expect(harness.continueTask).not.toHaveBeenCalled();
    expect(harness.toastError).toHaveBeenCalledOnce();
  });

  it('手动保存大纲与一键清空都经编排器，不直接发送宿主消息', async () => {
    const { useContinuationRuntime } = await import('../../../src/presentation-v2/composables/useContinuationRuntime');
    const continuation = useContinuationRuntime();
    const outline = { schemaVersion: 1, title: '阶段', goal: '目标', totalTurns: 6, nodes: [] } as any;

    expect(await continuation.saveActiveOutline(outline)).toBe(true);
    expect(harness.replaceActiveOutline).toHaveBeenCalledWith({ outline });

    expect(await continuation.clearData()).toBe(true);
    expect(harness.clearContinuationData).toHaveBeenCalledOnce();
    expect(harness.toastSuccess).toHaveBeenCalledOnce();
    expect(harness.bridgeSend).not.toHaveBeenCalled();

    harness.clearContinuationData.mockRejectedValue(new Error('清空失败'));
    expect(await continuation.clearData()).toBe(false);
    expect(harness.toastError).toHaveBeenCalledOnce();
  });
});
