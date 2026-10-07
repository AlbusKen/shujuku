import { afterEach, describe, expect, it, vi } from 'vitest';

type RuntimeHarness = {
  runtime: typeof import('../../../src/service/continuation/continuation-runtime');
  setHostApi: typeof import('../../../src/shared/host-api')._set_SillyTavern_APICU;
  settings: any;
  saveSettings: ReturnType<typeof vi.fn>;
  chat: any[];
  saveChat: ReturnType<typeof vi.fn>;
  getBridge: () => unknown;
};

async function createHarness(saveResult: { saved: boolean } = { saved: true }): Promise<RuntimeHarness> {
  vi.resetModules();
  const settings = {
    plotSettings: {
      contextTurnCount: 3,
      loopSettings: {
        quickReplyContent: ['旧提示词'],
        currentPromptIndex: 1,
        loopTags: '<content>',
        loopDelay: 5,
        retryDelay: 3,
        loopTotalDuration: 20,
        maxRetries: 3,
      },
    },
  } as any;
  const saveSettings = vi.fn(() => saveResult);
  vi.doMock('../../../src/service/runtime/state-manager', () => ({ settings_ACU: settings }));
  vi.doMock('../../../src/service/settings/settings-service', () => ({ saveSettings_ACU: saveSettings }));

  const [runtime, hostApi, registry] = await Promise.all([
    import('../../../src/service/continuation/continuation-runtime'),
    import('../../../src/shared/host-api'),
    import('../../../src/service/continuation/host-generation-bridge-registry'),
  ]);
  const chat: any[] = [{}];
  const saveChat = vi.fn(async () => undefined);
  hostApi._set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
  return { runtime, setHostApi: hostApi._set_SillyTavern_API_ACU, settings, saveSettings, chat, saveChat, getBridge: registry.getContinuationHostGenerationBridge_ACU };
}

afterEach(() => {
  vi.doUnmock('../../../src/service/runtime/state-manager');
  vi.doUnmock('../../../src/service/settings/settings-service');
  vi.resetModules();
});

function stage_ACU(stageNumber: number, turnCount: number): any {
  return {
    stageId: `stage-${stageNumber}`, stageNumber, status: 'completed', activeRevision: 2,
    completedTurns: turnCount, activeNodeIndex: 0, activeTurnIndex: 0,
    revisions: [
      // 作废的旧 revision 不该出现在阶段历史里。
      { revision: 1, reason: 'initial', frozen: true, replanInstruction: '', outline: { schemaVersion: 1, title: `第 ${stageNumber} 阶段旧计划`, goal: '作废目标', totalTurns: turnCount, nodes: [] } },
      {
        revision: 2, reason: 'manual_replan', frozen: true, replanInstruction: '',
        outline: {
          schemaVersion: 1, title: `第 ${stageNumber} 阶段`, goal: `阶段 ${stageNumber} 目标`, totalTurns: turnCount,
          nodes: [{ id: `node-${stageNumber}`, title: `节点 ${stageNumber}`, goal: `节点 ${stageNumber} 目标`, suggestedTurns: turnCount, turns: Array.from({ length: turnCount }, (_, index) => ({ id: `t${stageNumber}-${index + 1}`, goal: `阶段 ${stageNumber} 第 ${index + 1} 轮目标` })) }],
        },
      },
    ],
  };
}

describe('阶段历史渲染', () => {
  it('没有阶段时如实说明这是第一个阶段', async () => {
    const h = await createHarness();
    expect(h.runtime.serializeStageHistory_ACU({ stages: [] } as any)).toContain('第一个阶段');
  });

  it('只给活动 revision，最近两个阶段保留逐轮目标，更早的压到节点级', async () => {
    const h = await createHarness();
    const text = h.runtime.serializeStageHistory_ACU({ stages: [stage_ACU(1, 2), stage_ACU(2, 2), stage_ACU(3, 2)] } as any);

    // 被替换掉的旧 revision 是作废的计划，不进上下文。
    expect(text).not.toContain('旧计划');
    expect(text).not.toContain('作废目标');
    // 第 1 阶段较早：只到节点级。
    expect(text).toContain('- 节点「节点 1」：节点 1 目标');
    expect(text).not.toContain('阶段 1 第 1 轮目标');
    expect(text).toContain('（该阶段较早，已省略逐轮目标；其事实已进入纪要。）');
    // 最近两个阶段：逐轮目标全给。
    expect(text).toContain('阶段 2 第 1 轮目标');
    expect(text).toContain('阶段 3 第 2 轮目标');
    // 输出是可读文本而不是 JSON，避免诱导大纲模型用 JSON 回话。
    expect(text).not.toContain('"totalTurns"');
    // 阶段纪要范围随 chronicleRange 字段一起退役，标题只保留完成进度。
    expect(text).toContain('已完成 2/2 轮');
    expect(text).not.toContain('纪要范围');
  });
});

describe('ContinuationRuntime_ACU migration', () => {
  it('先写入首楼权威状态，再成功清理废弃的 v2 循环字段', async () => {
    const h = await createHarness();
    const runtime = h.runtime.getContinuationRuntime_ACU();

    await runtime.initialize();

    expect(h.chat[0]._qrf_continuation).toMatchObject({ schemaVersion: 1, activeTask: null });
    expect(h.settings.plotSettings.loopSettings).not.toHaveProperty('quickReplyContent');
    expect(h.settings.plotSettings.loopSettings).not.toHaveProperty('currentPromptIndex');
    expect(h.saveChat).toHaveBeenCalledOnce();
    expect(h.saveSettings).toHaveBeenCalledOnce();
    expect(h.getBridge()).toBe(runtime.bridge);
    h.runtime.resetContinuationRuntimeForTests_ACU();
    expect(h.getBridge()).toBeNull();
  });

  it('设置保存失败时保留废弃字段，并可在后续初始化中恢复清理', async () => {
    const h = await createHarness({ saved: false });
    const runtime = h.runtime.getContinuationRuntime_ACU();

    await runtime.initialize();

    expect(h.chat[0]._qrf_continuation).toMatchObject({ schemaVersion: 1, activeTask: null });
    expect(h.settings.plotSettings.loopSettings.quickReplyContent).toEqual(['旧提示词']);
    expect(h.settings.plotSettings.loopSettings.currentPromptIndex).toBe(1);
    expect(h.saveChat).toHaveBeenCalledOnce();

    h.saveSettings.mockReturnValueOnce({ saved: true });
    await runtime.initialize();

    expect(h.settings.plotSettings.loopSettings).not.toHaveProperty('quickReplyContent');
    expect(h.settings.plotSettings.loopSettings).not.toHaveProperty('currentPromptIndex');
    expect(h.saveChat).toHaveBeenCalledOnce();
    h.runtime.resetContinuationRuntimeForTests_ACU();
    expect(h.getBridge()).toBeNull();
  });

  it('旧版本信封初始化时一次性重置提示词并立即落盘，重置后保存的编辑在重载后保留', async () => {
    const h = await createHarness();
    const defaults = await import('../../../src/service/continuation/defaults');
    const base = defaults.buildDefaultContinuationSettings_ACU();
    const stale = {
      ...base,
      promptForceDefaultVersion: defaults.CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V50_ACU,
      outlinePrompt: base.outlinePrompt.map((segment, index) => index === 0 ? { ...segment, content: '旧版大纲改写' } : segment),
      agentPrompts: { ...base.agentPrompts, main: base.agentPrompts.main.map((segment, index) => index === 0 ? { ...segment, content: '旧版主会话改写' } : segment) },
    };
    h.chat[0]._qrf_continuation = JSON.parse(JSON.stringify({ schemaVersion: 1, settings: stale, activeTask: null }));

    await h.runtime.getContinuationRuntime_ACU().initialize();

    expect(h.saveChat).toHaveBeenCalledOnce();
    const persisted = h.chat[0]._qrf_continuation.settings;
    expect(persisted.promptForceDefaultVersion).toBe(defaults.CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V51_ACU);
    expect(persisted.outlinePrompt[0].content).toBe(base.outlinePrompt[0].content);
    expect(persisted.agentPrompts.main[0].content).toBe(base.agentPrompts.main[0].content);

    const edited = JSON.parse(JSON.stringify(h.chat[0]._qrf_continuation));
    edited.settings.agentPrompts.main[0].content = '重置后的用户编辑';
    h.chat[0]._qrf_continuation = edited;
    h.runtime.resetContinuationRuntimeForTests_ACU();

    const reloaded = await h.runtime.getContinuationRuntime_ACU().initialize();

    expect(h.saveChat).toHaveBeenCalledOnce();
    expect(reloaded?.settings.agentPrompts.main[0].content).toBe('重置后的用户编辑');
    h.runtime.resetContinuationRuntimeForTests_ACU();
  });
});

describe('全局续写设置副本', () => {
  it('写入后持久化并可读回，读取深拷贝隔离，新聊天初始设置以全局副本为准', async () => {
    const h = await createHarness();
    const custom = { ...h.runtime.buildInitialContinuationSettings_ACU(), generationRetryLimit: 9, loopDelaySeconds: 42 };

    h.runtime.writeGlobalContinuationSettings_ACU(custom);
    expect(h.saveSettings).toHaveBeenCalledOnce();
    expect(h.settings.continuationGlobalSettings).toMatchObject({ generationRetryLimit: 9, loopDelaySeconds: 42 });

    const read = h.runtime.readGlobalContinuationSettings_ACU();
    expect(read).toMatchObject({ generationRetryLimit: 9, loopDelaySeconds: 42 });
    // 深拷贝隔离：改读出的对象不影响全局副本本体。
    read!.generationRetryLimit = 1;
    expect(h.settings.continuationGlobalSettings.generationRetryLimit).toBe(9);

    // 无信封聊天的初始设置：全局副本优先于内置默认。
    expect(h.runtime.buildInitialContinuationSettings_ACU()).toMatchObject({ generationRetryLimit: 9, loopDelaySeconds: 42 });
  });

  it('副本损坏时回落内置默认，不阻塞页面', async () => {
    const h = await createHarness();
    const defaults = h.runtime.buildInitialContinuationSettings_ACU();
    h.settings.continuationGlobalSettings = { 坏: '数据' };

    expect(h.runtime.readGlobalContinuationSettings_ACU()).toBeNull();
    expect(h.runtime.buildInitialContinuationSettings_ACU()).toEqual(defaults);
  });

  it('保存失败时回滚内存态，保留原有全局副本', async () => {
    const h = await createHarness();
    const original = { ...h.runtime.buildInitialContinuationSettings_ACU(), generationRetryLimit: 9 };
    h.runtime.writeGlobalContinuationSettings_ACU(original);
    expect(h.settings.continuationGlobalSettings.generationRetryLimit).toBe(9);

    h.saveSettings.mockReturnValueOnce({ saved: false });
    h.runtime.writeGlobalContinuationSettings_ACU({ ...original, generationRetryLimit: 2 });
    expect(h.settings.continuationGlobalSettings.generationRetryLimit).toBe(9);
  });
});
