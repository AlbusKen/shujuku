/**
 * ContinuationPage — 仅验证 v2 会话 UI 到 runtime composable 的派发。
 * 宿主发送归属由 useContinuationRuntime 的独立测试覆盖。
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createApp, nextTick, ref } from 'vue';
import { useDialogStore } from '../../../src/presentation-v2/stores/dialog-store';

const mountedApps = new Set<{ unmount: () => void }>();
const chatTick = ref(0);
const task = ref<any>(null);
const activeStage = ref<any>(null);
const activeRevision = ref<any>(null);
const activeNode = ref<any>(null);
const activeTurn = ref<any>(null);
const materialsSnapshot = ref<any>(null);
const settings = ref<any>(null);
const busy = ref(false);
const canContinue = ref(false);
const awaitingHostResult = ref(false);
const originInstruction = ref('');
const statusText = ref('尚未创建任务');
const initialize = vi.fn(async () => undefined);
const refresh = vi.fn();
const continueTask = vi.fn(async () => undefined);
const retryCurrentTurn = vi.fn(async () => undefined);
const stopTask = vi.fn(async () => undefined);
const sendAgentMessage = vi.fn(async () => true);
const saveActiveOutline = vi.fn(async () => true);
const clearData = vi.fn(async () => true);
const acceptOutline = vi.fn(async () => true);
const saveSettings = vi.fn(async () => 'saved' as const);
const restorePromptDefault = vi.fn((draft: any) => draft);

vi.mock('../../../src/presentation-v2/composables/useContinuationRuntime', () => ({
  useContinuationRuntime: () => ({
    activeStage, activeRevision, activeNode, activeTurn, busy, canContinue, continueTask, initialize,
    isAwaitingHostResult: awaitingHostResult, originInstruction, refresh,
    retryCurrentTurn, acceptOutline, sendAgentMessage, saveActiveOutline, clearData, restorePromptDefault,
    saveSettings, settings, statusText, stopTask, task,
  }),
  // 连续高压轮上限输入框的上界常量：组件从 composable 取，mock 缺了它会整页渲染失败。
  CONTINUATION_MAX_CONSECUTIVE_PRESSURE_TURNS_MAX_UI_ACU: 20,
}));
vi.mock('../../../src/presentation-v2/composables/useContinuationMaterials', () => ({
  useContinuationMaterials: () => ({
    snapshot: materialsSnapshot,
    loadError: ref(''),
    modules: {},
    reload: vi.fn(),
    save: vi.fn(),
    discard: vi.fn(),
    updateDraft: vi.fn(),
  }),
}));
vi.mock('../../../src/presentation-v2/composables/useChatChangedListener', () => ({
  useChatChangedTick: () => chatTick,
}));

function setTask(status = 'paused', pending = false): void {
  task.value = {
    taskId: 'task-1', originInstruction: '让主角找到出口', status, stopReason: null,
    activeStageId: 'stage-1', stages: [
      {
        stageId: 'stage-1', stageNumber: 1, status: 'running', activeRevision: 2, activeNodeIndex: 1, activeTurnIndex: 0,
        completedTurns: 2, revisions: [{
          revision: 2, reason: 'initial', frozen: true,
          outline: {
            title: '逃离计划', goal: '让主角找到出口', tempo: 'mixed', role: 'development', timeSpanGoal: '三日内', totalTurns: 4,
            nodes: [
              { id: 'node-1', title: '摸清出口守卫', goal: '确认守卫换班规律', suggestedTurns: 2, turns: [
                { id: 'turn-1', goal: '观察守卫换班并熟悉巡逻习惯', pacing: 'setup', function: 'daily_world', mainlineDelta: 'hold', timeAdvance: 'same_day' },
                { id: 'turn-2', goal: '用假线索试探守卫', pacing: 'pressure', function: 'conflict', mainlineDelta: 'step', timeAdvance: 'continuous' },
              ] },
              { id: 'node-2', title: '夺取钥匙', goal: '利用换班空隙夺取钥匙', suggestedTurns: 2, turns: [
                { id: 'turn-3', goal: '趁换班夺取钥匙', pacing: 'turn', function: 'reveal', mainlineDelta: 'milestone', timeAdvance: 'overnight' },
                { id: 'turn-4', goal: '三日后伤势恢复并带着钥匙撤离', pacing: 'cooldown', function: 'recovery', mainlineDelta: 'hold', timeAdvance: 'days', timeAnchor: '取得钥匙后的第三日' },
              ] },
            ],
          },
        }],
      },
      {
        stageId: 'stage-0', stageNumber: 0, status: 'completed', activeRevision: 2, activeNodeIndex: 0, activeTurnIndex: 0,
        completedTurns: 2, revisions: [
          { revision: 1, reason: 'initial', frozen: true, outline: { title: '旧版试探', goal: '找到守卫弱点', tempo: 'opening', totalTurns: 2, nodes: [] } },
          { revision: 2, reason: 'replan', frozen: true, outline: { title: '最终试探', goal: '确认换班规律', tempo: 'opening', totalTurns: 2, nodes: [] } },
        ],
      },
    ], timeline: [],
    pendingHostTurn: pending ? { status: 'awaiting_generation' } : null,
  };
  materialsSnapshot.value = { storyArc: [{ id: 'VOL-01', scope: 'volume', title: '禁区试探', status: 'active', retired: false }], revisions: { storyArc: 1 } };
  activeStage.value = task.value.stages[0];
  activeRevision.value = task.value.stages[0].revisions[0];
  canContinue.value = status === 'paused';
  awaitingHostResult.value = pending;
  statusText.value = pending ? '等待宿主正文' : status;
}

async function mountPage() {
  const Page = (await import('../../../src/presentation-v2/pages/ContinuationPage.vue')).default;
  const el = document.createElement('div');
  document.body.appendChild(el);
  // 与测试代码共享同一个 pinia 实例，测试里 useDialogStore() 拿到的才是页面用的那个 store。
  const pinia = createPinia();
  setActivePinia(pinia);
  const app = createApp(Page);
  app.use(pinia);
  const originalUnmount = app.unmount.bind(app);
  app.unmount = () => {
    mountedApps.delete(app);
    originalUnmount();
  };
  mountedApps.add(app);
  app.mount(el);
  await nextTick();
  return { app, el };
}

function buttonByText(el: Element, text: string): HTMLButtonElement | undefined {
  return Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.includes(text));
}

function typeInto(textarea: HTMLTextAreaElement, value: string): void {
  textarea.value = value;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 会话输入框：页面里还有大纲/资料编辑框，按会话自己的类名定位。 */
function chatInput(el: Element): HTMLTextAreaElement {
  return el.querySelector<HTMLTextAreaElement>('.acu-v2-continuation-chat__input')!;
}

/**
 * 首次发送（task=null）会先弹高 RPM 风险确认框（5 秒倒计时）。
 * 页面测试不挂 AcuDialogHost，直接驱动 dialog store：推进 5 秒后确认。
 * 需要调用方已开启 fake timers。
 */
async function passFirstSendRpmConfirm(): Promise<void> {
  const dialog = useDialogStore();
  expect(dialog.active?.kind).toBe('confirm');
  // 倒计时未归零时提交被 store 硬性拒绝。
  dialog.submitActive();
  expect(dialog.active?.kind).toBe('confirm');
  await vi.advanceTimersByTimeAsync(5000);
  dialog.submitActive();
  expect(dialog.active).toBeNull();
}

beforeEach(() => {
  document.body.innerHTML = '';
  task.value = null;
  setActivePinia(createPinia());
  activeStage.value = null;
  activeRevision.value = null;
  activeNode.value = null;
  activeTurn.value = null;
  materialsSnapshot.value = null;
  settings.value = null;
  busy.value = false;
  canContinue.value = false;
  awaitingHostResult.value = false;
  originInstruction.value = '';
  statusText.value = '尚未创建任务';
  chatTick.value = 0;
  vi.clearAllMocks();
  sendAgentMessage.mockResolvedValue(true);
});

function setSettings(): void {
  settings.value = {
    stageSize: 'standard', customTurnMin: null, customTurnMax: null,
    outlinePreview: false, autoNextStage: true, maxAutomaticStages: 6,
    loopTags: '', loopDelaySeconds: 5, totalDurationMinutes: 0,
    retryDelaySeconds: 3, generationRetryLimit: 3, internalAiRetryLimit: 3, minGenerationTokens: 1000,
    storyWindowFloors: 20, storyTailFloors: 2, agentHistoryTokenBudget: 120000, maxConsecutivePressureTurns: 8,
    agentReadTokenBudget: '30%', agentReadFallbackTokens: 6000,
    finalReview: { enabled: false, readTokenBudget: '50%', maxExtraReads: 6 },
    agentRunBudget: { maxIterations: 8, maxDelegations: 6, maxSameAgent: 2, maxConcurrent: 3, maxReads: 8, maxExtraReads: 3 },
    contextExtractRules: [], contextExcludeRules: [],
    apiPresetMode: 'current', fixedApiPresetName: '', promptCacheEnabled: false,
    agentApiPresets: {
      main: { mode: 'inherit', presetName: '' },
      outline: { mode: 'inherit', presetName: '' },
      arcArchitect: { mode: 'inherit', presetName: '' },
      maintainer: { mode: 'inherit', presetName: '' },
      mainlinePlanner: { mode: 'inherit', presetName: '' },
      beatPlanner: { mode: 'inherit', presetName: '' },
      reviewer: { mode: 'inherit', presetName: '' },
      finalReviewer: { mode: 'inherit', presetName: '' },
    },
    outlinePrompt: [{ role: 'system', content: '规划', enabled: true, deletable: true }],
    agentPrompts: {
      main: [{ role: 'system', content: '主控', enabled: true, deletable: true }],
      arcArchitect: [{ role: 'system', content: '总纲', enabled: true, deletable: true }],
      maintainer: [{ role: 'system', content: '维护', enabled: true, deletable: true }],
      mainlinePlanner: [{ role: 'system', content: '主线', enabled: true, deletable: true }],
      beatPlanner: [{ role: 'system', content: '节拍', enabled: true, deletable: true }],
      reviewer: [{ role: 'system', content: '审查', enabled: true, deletable: true }],
      finalReviewer: [{ role: 'system', content: '终审', enabled: true, deletable: true }],
    },
  };
}

afterEach(() => {
  for (const app of [...mountedApps]) app.unmount();
  mountedApps.clear();
  document.body.innerHTML = '';
});

describe('ContinuationPage', () => {
  it('空态下没有独立的创建入口，第一条消息经高 RPM 确认后交给 runtime 创建任务', async () => {
    vi.useFakeTimers();
    try {
      const { app, el } = await mountPage();
      expect(el.textContent).toContain('Agent 会话');
      expect(initialize).toHaveBeenCalledOnce();
      // 创建任务不再是一个单独按钮：发送第一句话就是创建。
      expect(buttonByText(el, '创建续写任务')).toBeUndefined();
      expect(el.textContent).not.toContain('循环提示词');

      typeInto(chatInput(el), '让主角找到出口');
      await nextTick();
      buttonByText(el, '发送')!.click();
      await nextTick();
      // 首次发送先弹确认框，确认前不派发。
      expect(sendAgentMessage).not.toHaveBeenCalled();
      await passFirstSendRpmConfirm();
      await vi.waitFor(() => {
        expect(sendAgentMessage).toHaveBeenCalledWith('让主角找到出口');
        expect(chatInput(el).value).toBe('');
      });
      app.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('首次发送确认框被取消时不派发且保留草稿', async () => {
    const { app, el } = await mountPage();
    const input = chatInput(el);

    typeInto(input, '取消后应保留这句话');
    await nextTick();
    buttonByText(el, '发送')!.click();
    await nextTick();

    const dialog = useDialogStore();
    expect(dialog.active?.kind).toBe('confirm');
    // 倒计时期间取消随时可点。
    dialog.cancelActive();
    await nextTick();
    expect(sendAgentMessage).not.toHaveBeenCalled();
    expect(input.value).toBe('取消后应保留这句话');
    app.unmount();
  });

  it('已有任务时发送不弹确认框', async () => {
    setTask();
    const { app, el } = await mountPage();

    typeInto(chatInput(el), '继续推进剧情');
    await nextTick();
    buttonByText(el, '发送')!.click();
    await nextTick();

    const dialog = useDialogStore();
    expect(dialog.active).toBeNull();
    await vi.waitFor(() => { expect(sendAgentMessage).toHaveBeenCalledWith('继续推进剧情'); });
    app.unmount();
  });

  it('消息接收失败时保留草稿', async () => {
    vi.useFakeTimers();
    try {
      sendAgentMessage.mockResolvedValue(false);
      const { app, el } = await mountPage();
      const input = chatInput(el);

      typeInto(input, '持久化失败后保留这句话');
      await nextTick();
      buttonByText(el, '发送')!.click();
      await nextTick();
      await passFirstSendRpmConfirm();
      await vi.waitFor(() => { expect(sendAgentMessage).toHaveBeenCalledWith('持久化失败后保留这句话'); });
      await vi.waitFor(() => { expect(input.value).toBe('持久化失败后保留这句话'); });
      app.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('发送中阻止重复派发，且旧发送成功不清空用户随后改写的草稿', async () => {
    vi.useFakeTimers();
    try {
      let resolveSend!: (accepted: boolean) => void;
      sendAgentMessage.mockImplementationOnce(() => new Promise<boolean>(resolve => { resolveSend = resolve; }));
      const { app, el } = await mountPage();
      const input = chatInput(el);

      typeInto(input, '第一条消息');
      await nextTick();
      buttonByText(el, '发送')!.click();
      await nextTick();
      await passFirstSendRpmConfirm();
      await vi.waitFor(() => { expect(sendAgentMessage).toHaveBeenCalledOnce(); });
      await nextTick();
      // 点发送后同一位置切成停止，避免再点一次发送叠一条。
      expect(buttonByText(el, '发送')).toBeUndefined();
      const stop = buttonByText(el, '停止');
      expect(stop).not.toBeUndefined();

      typeInto(input, '用户随后改写的草稿');
      await nextTick();
      stop!.click();
      await nextTick();
      // 发送中：既不弹新确认框，也不重复派发；停止走独立入口。
      expect(useDialogStore().active).toBeNull();
      expect(sendAgentMessage).toHaveBeenCalledOnce();
      expect(stopTask).toHaveBeenCalledOnce();

      resolveSend(true);
      await vi.waitFor(() => { expect(input.value).toBe('用户随后改写的草稿'); });
      app.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('预算停止时仍允许发送新指令，并显示新的运行窗口提示', async () => {
    setTask();
    task.value.stopReason = 'duration_reached';
    canContinue.value = false;
    const { app, el } = await mountPage();
    const input = chatInput(el);

    expect(el.textContent).toContain('输入新指令后发送即可继续。');
    typeInto(input, '从当前进度继续');
    await nextTick();
    buttonByText(el, '发送')!.click();
    await vi.waitFor(() => { expect(sendAgentMessage).toHaveBeenCalledWith('从当前进度继续'); });
    app.unmount();
  });

  it('Ctrl + Enter 直接发送，空白内容不派发', async () => {
    setTask();
    const { app, el } = await mountPage();
    const input = chatInput(el);

    typeInto(input, '   ');
    await nextTick();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    await nextTick();
    expect(sendAgentMessage).not.toHaveBeenCalled();

    typeInto(input, '这一轮先别揭穿守门人');
    await nextTick();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    await nextTick();
    expect(sendAgentMessage).toHaveBeenCalledWith('这一轮先别揭穿守门人');
    app.unmount();
  });

  it('进行中按 Ctrl+Enter 不发送', async () => {
    setTask('running');
    const { app, el } = await mountPage();
    const input = chatInput(el);
    typeInto(input, '循环还在跑时不应发出');
    await nextTick();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    await nextTick();
    expect(sendAgentMessage).not.toHaveBeenCalled();
    expect(buttonByText(el, '停止')).not.toBeUndefined();
    app.unmount();
  });

  it('任务存在时渲染状态条、会话流空态，空闲只显示发送', async () => {
    setTask();
    const { app, el } = await mountPage();
    expect(el.querySelector('.acu-v2-session-feed')).not.toBeNull();
    expect(el.textContent).toContain('还没有运行记录');
    expect(el.textContent).toContain('第 1 阶段');
    expect(el.textContent).toContain('已完成 2 / 4 轮');
    expect(el.textContent).toContain('大纲 revision 2');

    expect(buttonByText(el, '发送')).not.toBeUndefined();
    expect(buttonByText(el, '停止')).toBeUndefined();
    expect(buttonByText(el, '继续当前轮次')).toBeUndefined();
    expect(buttonByText(el, '重试当前轮次')).toBeUndefined();
    app.unmount();
  });

  it('任务状态陈旧为 paused 但会话流显示循环在跑时，仍提供停止', async () => {
    const sessionLog = await import('../../../src/service/continuation/agent/agent-session-log');
    setTask();
    const { app, el } = await mountPage();
    try {
      expect(buttonByText(el, '停止')).toBeUndefined();

      // UI 发起的循环运行期间 envelope 不刷新，task.status 停留在陈旧的 paused；
      // 会话日志的运行标志才是实时信号，停止按钮必须据它显示。
      sessionLog.beginAgentSessionRun_ACU('第 1 阶段 · 第 1/6 轮');
      await nextTick();
      const stop = buttonByText(el, '停止');
      expect(stop).not.toBeUndefined();
      expect(buttonByText(el, '发送')).toBeUndefined();
      stop!.click();
      await nextTick();
      expect(stopTask).toHaveBeenCalledOnce();
    } finally {
      app.unmount();
      sessionLog.resetAgentSessionLogForTests_ACU();
    }
  });

  it('运行中与等待宿主正文时都只显示停止，并在聊天切换后刷新', async () => {
    setTask('running');
    const running = await mountPage();
    expect(buttonByText(running.el, '发送')).toBeUndefined();
    buttonByText(running.el, '停止')!.click();
    await nextTick();
    expect(stopTask).toHaveBeenCalledOnce();
    running.app.unmount();

    setTask('running', true);
    const { app, el } = await mountPage();
    expect(el.textContent).toContain('点「停止」会同时打断 Agent 和酒馆生成');
    expect(buttonByText(el, '停止')).not.toBeUndefined();
    expect(buttonByText(el, '发送')).toBeUndefined();
    expect(buttonByText(el, '继续当前轮次')).toBeUndefined();
    chatTick.value += 1;
    await nextTick();
    expect(refresh).toHaveBeenCalledOnce();
    app.unmount();
  });

  it('资料面板结构化展示当前大纲，保留 JSON 草稿保护、保存与清空确认', async () => {
    setTask();
    const { app, el } = await mountPage();
    expect(el.textContent).toContain('已有资料');
    expect(el.textContent).toContain('第 1 阶段：逃离计划');
    expect(el.textContent).toContain('阶段目标：让主角找到出口');
    expect(el.textContent).toContain('起伏型');
    expect(el.textContent).toContain('职责：发展');
    expect(el.textContent).toContain('故事时间目标：三日内');
    expect(el.textContent).toContain('完成 2 / 4 轮 · 剩余 2 轮');
    expect(el.textContent).toContain('所属 active 卷：[VOL-01]「禁区试探」');
    expect(el.textContent).toContain('摸清出口守卫');
    expect(el.textContent).toContain('功能：世界日常');
    expect(el.textContent).toContain('主线：停驻');
    expect(el.textContent).toContain('时间：数日 · 取得钥匙后的第三日');
    expect(el.textContent).toContain('当前执行');
    expect(el.querySelectorAll('.acu-v2-continuation-materials__turn--done')).toHaveLength(2);
    expect(el.querySelectorAll('.acu-v2-continuation-materials__turn--current')).toHaveLength(1);
    expect(el.querySelectorAll('.acu-v2-continuation-materials__turn--planned')).toHaveLength(1);
    expect(el.textContent).toContain('第 0 阶段');
    expect(el.textContent).toContain('最终试探');
    expect(el.textContent).toContain('旧 revision（1）');

    const outlineJson = el.querySelector<HTMLDetailsElement>('.acu-v2-continuation-materials__outline > .acu-v2-continuation-materials__json')!;
    expect(outlineJson.open).toBe(false);
    outlineJson.open = true;
    const outlineTextarea = outlineJson.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(JSON.parse(outlineTextarea.value).title).toBe('逃离计划');
    // 未改动时保存按钮禁用，避免无意义写盘推进 revision。
    expect(buttonByText(el, '保存大纲')!.disabled).toBe(true);

    const editedOutline = JSON.parse(outlineTextarea.value);
    editedOutline.title = '逃离计划 v2';
    editedOutline.nodes[1].turns[0] = { ...editedOutline.nodes[1].turns[0], function: 'payoff', mainlineDelta: 'step', timeAdvance: 'days', timeAnchor: '第二日清晨' };
    typeInto(outlineTextarea, JSON.stringify(editedOutline));
    await nextTick();
    activeRevision.value = { ...activeRevision.value, revision: 3, outline: { ...activeRevision.value.outline, title: '外部 revision' } };
    await nextTick();
    expect(JSON.parse(outlineTextarea.value).title).toBe('逃离计划 v2');
    buttonByText(el, '保存大纲')!.click();
    await nextTick();
    expect(saveActiveOutline).toHaveBeenCalledOnce();
    expect(saveActiveOutline.mock.calls[0][0]).toMatchObject({ title: '逃离计划 v2' });
    expect(saveActiveOutline.mock.calls[0][0].nodes[1].turns[0]).toMatchObject({
      function: 'payoff', mainlineDelta: 'step', timeAdvance: 'days', timeAnchor: '第二日清晨',
    });

    // JSON 写坏时就地报错，不派发给领域层。
    typeInto(outlineTextarea, '{不是 JSON');
    await nextTick();
    buttonByText(el, '保存大纲')!.click();
    await nextTick();
    expect(saveActiveOutline).toHaveBeenCalledOnce();
    expect(el.textContent).toContain('大纲 JSON 无法解析');

    buttonByText(el, '一键清空')!.click();
    await nextTick();
    expect(clearData).not.toHaveBeenCalled();
    expect(el.textContent).toContain('小说正文楼层不受影响');
    buttonByText(el, '确认清空')!.click();
    await nextTick();
    expect(clearData).toHaveBeenCalledOnce();
    app.unmount();
  });

  it('渲染设置与伪 Role 提示词，设置修改后自动经 runtime 保存', async () => {
    vi.useFakeTimers();
    try {
      setSettings();
      setTask();
      const { app, el } = await mountPage();

      expect(el.textContent).toContain('续写设置');
      expect(el.textContent).toContain('伪 Role 提示词');
      expect(el.textContent).toContain('正文可读窗口楼数');
      expect(el.textContent).toContain('会话自动总结阈值');
      expect(el.textContent).toContain('读取预算');
      expect(el.textContent).toContain('精读兜底额度');
      expect(el.textContent).toContain('连续高压轮上限');
      expect(el.textContent).toContain('终审读取预算');
      expect(el.textContent).toContain('关闭时不装配终审证据');
      expect(el.textContent).toContain('不会发起终审调用');
      expect(el.textContent).toContain('发送前终审子代理提示词');
      expect(el.textContent).toContain('固定注入差异：主 Agent、总纲代理、两类策划代理、连续性审查与终审固定获得 $OUTLINE_WINDOW');
      expect(el.textContent).toContain('伏笔与认知维护代理不接收用户目标或阶段大纲');
      expect(el.textContent).toContain('故事总纲子代理（arc-architect）提示词');
      expect(el.textContent).not.toContain('缓存优化');
      expect(el.textContent).not.toContain('prompt_cache_key');
      // 保存按钮已移除：修改任意设置项后由防抖自动保存。
      expect(buttonByText(el, '保存续写设置')).toBeUndefined();

      const stageSizeSelect = el.querySelector<HTMLSelectElement>('select')!;
      stageSizeSelect.value = 'short';
      stageSizeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await nextTick();
      expect(saveSettings).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(900);
      expect(saveSettings).toHaveBeenCalledOnce();
      expect(saveSettings.mock.calls[0][0]).toMatchObject({
        stageSize: 'short', storyWindowFloors: 20, agentHistoryTokenBudget: 120000, maxConsecutivePressureTurns: 8,
        finalReview: { enabled: false, readTokenBudget: '50%', maxExtraReads: 6 },
        agentApiPresets: { finalReviewer: { mode: 'inherit', presetName: '' } },
        agentPrompts: { finalReviewer: [{ content: '终审' }] },
      });
      app.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('续写设置：常用项直接可见，高级参数与提示词按分组折叠，可展开', async () => {
    setSettings();
    setTask();
    const { app, el } = await mountPage();

    const groups = Array.from(el.querySelectorAll<HTMLElement>('.acu-v2-continuation-page__group'));
    const labels = groups.map(group => group.querySelector('.acu-disclosure-group__label')?.textContent?.trim());
    expect(labels).toEqual(expect.arrayContaining([
      '运行与重试', '正文读取与上下文', 'Agent 运行预算', '发送前终审', '各 Agent 渠道', '上下文提取与排除规则',
      '主 Agent 提示词', '发送前终审子代理提示词', '占位符速查',
    ]));
    // 默认全部收起。
    for (const group of groups) {
      expect(group.querySelector('.acu-disclosure-group__header')?.getAttribute('aria-expanded')).toBe('false');
    }
    // 折叠态摘要露出关键取值。
    const metas = groups.map(group => group.querySelector('.acu-disclosure-group__meta')?.textContent?.trim());
    expect(metas).toEqual(expect.arrayContaining(['阶段上限 6 · 正文重试 3 次', '已关闭', '全部跟随默认', '1/1 段启用']));

    // 常用项在分组外面可直接操作；高级项（如正文可读窗口楼数）折叠在分组里。
    const topLevelLabels = Array.from(el.querySelectorAll<HTMLElement>('.acu-form-row__label'))
      .filter(label => !label.closest('.acu-v2-continuation-page__group'))
      .map(label => label.textContent?.trim());
    expect(topLevelLabels).toContain('阶段规模');
    expect(topLevelLabels).toContain('API 预设（全局默认）');
    expect(topLevelLabels).not.toContain('正文可读窗口楼数');
    // 长说明改为 hint 小字，不再塞进 label。
    expect(el.querySelector('.acu-form-row__hint')).not.toBeNull();
    for (const label of el.querySelectorAll<HTMLElement>('.acu-form-row__label')) {
      expect((label.textContent ?? '').length).toBeLessThan(24);
    }

    const runGroup = groups.find(group => group.textContent?.includes('运行与重试'))!;
    runGroup.querySelector<HTMLButtonElement>('.acu-disclosure-group__header')!.click();
    await nextTick();
    expect(runGroup.querySelector('.acu-disclosure-group__header')?.getAttribute('aria-expanded')).toBe('true');
    app.unmount();
  });

  it('Agent 规划占用时保存返回 busy：显示排队提示并自动重试，落盘后提示消失', async () => {
    vi.useFakeTimers();
    try {
      setSettings();
      setTask('running');
      saveSettings.mockResolvedValueOnce('busy' as any);
      const { app, el } = await mountPage();

      const stageSizeSelect = el.querySelector<HTMLSelectElement>('select')!;
      stageSizeSelect.value = 'short';
      stageSizeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await nextTick();
      await vi.advanceTimersByTimeAsync(900);
      expect(saveSettings).toHaveBeenCalledOnce();
      expect(el.textContent).toContain('将在本轮空档自动保存');

      // 第二次重试默认返回 'saved'：改动落盘，排队提示清除。
      await vi.advanceTimersByTimeAsync(900);
      expect(saveSettings).toHaveBeenCalledTimes(2);
      await nextTick();
      expect(el.textContent).not.toContain('将在本轮空档自动保存');
      app.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
