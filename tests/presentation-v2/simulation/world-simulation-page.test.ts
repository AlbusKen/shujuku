/**
 * WorldSimulationPage — 仅验证 v2 会话 UI 到 runtime composable 的派发与页面骨架。
 * 编排器分派语义由 simulation-runtime-entry / simulation-orchestrator 测试覆盖。
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { computed, createApp, nextTick, ref } from 'vue';
import { buildDefaultWorldSimulationEnvelope_ACU, buildDefaultWorldSimulationSettings_ACU } from '../../../src/service/simulation/defaults';
import { useDialogStore } from '../../../src/presentation-v2/stores/dialog-store';

const mountedApps = new Set<{ unmount: () => void }>();
const chatTick = ref(0);
const mutationTick = ref(0);
const ready = ref(true);
const busy = ref(false);
const error = ref('');
const snapshot = ref<any>(null);
const settings = ref<any>(buildDefaultWorldSimulationSettings_ACU());
const statusText = ref('尚未创建任务');
const stageText = ref('尚未创建任务');
const revisionText = ref('');
const anchorText = ref('第 1 楼 · swipe 1');
const refresh = vi.fn(() => true);
const send = vi.fn(async () => true);
const stop = vi.fn(async () => undefined);
const resume = vi.fn(async () => true);
const saveSettings = vi.fn(async () => 'saved' as const);
const clearData = vi.fn(async () => true);
const restorePromptDefault = vi.fn((draft: any) => draft);
const parsePromptBundle = vi.fn();
const resyncAfterChatMutation = vi.fn();

const envelope = computed(() => snapshot.value?.envelope ?? null);
const task = computed(() => envelope.value?.task ?? null);
const activeStage = computed(() => envelope.value?.stages.find((stage: any) => stage.stageId === envelope.value?.activeStageId) ?? null);
const activeRevision = computed(() => activeStage.value?.revisions[0] ?? null);
const anchor = computed(() => snapshot.value?.anchor ?? null);
const entries = computed(() => snapshot.value?.session.entries ?? []);
const running = computed(() => snapshot.value?.session.running ?? false);

vi.mock('../../../src/presentation-v2/composables/useWorldSimulationRuntime', () => ({
  useWorldSimulationRuntime: () => ({
    snapshot, ready, busy, error, envelope, task, settings, activeStage, activeRevision, anchor, anchorText, entries, running,
    statusText, stageText, revisionText, refresh, send, stop, resume, saveSettings, clearData, restorePromptDefault, parsePromptBundle, resyncAfterChatMutation,
  }),
}));
vi.mock('../../../src/presentation-v2/composables/useApiPresetSelectOptions', async () => {
  const { ref } = await import('vue');
  return {
    useApiPresetSelectOptions: () => ({
      apiStore: { presets: [{ name: '预设A' }], activePresetName: '预设A', refreshFromSettings: vi.fn() },
      followActiveApiLabel: ref('跟随当前活动 API（预设A）'),
      apiPresetSelectOptions: ref([{ value: '', label: '跟随当前活动 API（预设A）' }, { value: '预设A', label: '预设A' }]),
    }),
  };
});
vi.mock('../../../src/presentation-v2/composables/useChatChangedListener', () => ({ useChatChangedTick: () => chatTick, useChatMutationTick: () => mutationTick }));

function baseSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    envelope: { ...buildDefaultWorldSimulationEnvelope_ACU(), settings: settings.value },
    conversation: { messages: [], nextId: 1, compaction: null, diagnostics: [] },
    materials: { snapshot: null, diagnostics: [], adoptedIndex: null },
    session: { chatIdentity: 'chat-a', entries: [], running: false },
    anchor: { chatIdentity: 'chat-a', messageIndex: 0, messageId: 7, messageKey: 'number:7', swipeId: '0', contentDigest: 'd' },
    projectionPreview: null,
    ...overrides,
  };
}

function setTask(status: 'paused' | 'running' | 'completed' = 'paused', stopReason: string | null = null) {
  const identity = {
    runId: 'run', chatIdentity: 'chat-a', triggerKind: 'agent_chat_message', triggerConversationMessageId: 'turn-1',
    anchorMessageId: 7, anchorMessageKey: 'number:7', anchorSwipeId: '0', anchorContentDigest: 'd', baseLedgerRevision: 0, taskId: 'task', stageId: 'stage', stageRevision: 1,
  };
  const next = baseSnapshot();
  next.envelope.task = { taskId: 'task', originInstruction: '推进', status, createdAt: 1, updatedAt: 1, activeRun: status === 'completed' ? null : identity, stopReason } as any;
  next.envelope.activeStageId = 'stage';
  next.envelope.stages = [{ stageId: 'stage', stageNumber: 1, status: 'running', activeRevision: 1, revisions: [{ revision: 1, createdAt: 1, reason: 'initial', replanInstruction: '', frozen: true, plan: { schemaVersion: 1, title: '北境阶段', objective: '核实边境压力', impactScope: [], factsToVerify: [], plannedTools: [], plannedSpecialists: [], expectedLedgerChanges: [], convergenceConditions: [], blockingConditions: [], completedSteps: [], nextStep: '' } }] }] as any;
  next.session.running = status === 'running';
  snapshot.value = next;
  statusText.value = status === 'running' ? '运行中' : status === 'paused' ? '已暂停 · 用户手动停止' : '已完成';
  stageText.value = '第 1 阶段';
  revisionText.value = 'revision 1';
}

async function mountPage() {
  const Page = (await import('../../../src/presentation-v2/pages/WorldSimulationPage.vue')).default;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const pinia = createPinia();
  setActivePinia(pinia);
  const app = createApp(Page);
  app.use(pinia);
  const originalUnmount = app.unmount.bind(app);
  app.unmount = () => { mountedApps.delete(app); originalUnmount(); };
  mountedApps.add(app);
  app.mount(host);
  await nextTick();
  return { app, host };
}

const button = (host: Element, text: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent?.includes(text));
const chatInput = (host: Element) => host.querySelector<HTMLTextAreaElement>('.acu-v2-agent-chat__input')!;

function typeInto(textarea: HTMLTextAreaElement, value: string): void {
  textarea.value = value;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 首次发送（task=null）会先弹高 RPM 风险确认框（5 秒倒计时）；需要调用方已开启 fake timers。 */
async function passFirstSendRpmConfirm(): Promise<void> {
  const dialog = useDialogStore();
  expect(dialog.active?.kind).toBe('confirm');
  dialog.submitActive();
  expect(dialog.active?.kind).toBe('confirm');
  await vi.advanceTimersByTimeAsync(5000);
  dialog.submitActive();
  expect(dialog.active).toBeNull();
}

beforeEach(() => {
  document.body.innerHTML = '';
  setActivePinia(createPinia());
  chatTick.value = 0;
  mutationTick.value = 0;
  ready.value = true;
  busy.value = false;
  error.value = '';
  settings.value = buildDefaultWorldSimulationSettings_ACU();
  snapshot.value = baseSnapshot();
  statusText.value = '尚未创建任务';
  stageText.value = '尚未创建任务';
  revisionText.value = '';
  vi.clearAllMocks();
  saveSettings.mockResolvedValue('saved' as const);
  send.mockResolvedValue(true);
});

afterEach(() => {
  for (const app of Array.from(mountedApps)) app.unmount();
  vi.useRealTimers();
});

describe('WorldSimulationPage', () => {
  it('页面骨架与智能续写同构：会话面板整宽在上，资料与设置并列，提示词独立面板；不再有显式保存按钮', async () => {
    const { host } = await mountPage();
    const root = host.querySelector('.acu-v2-world-simulation-page')!;
    const children = Array.from(root.children);
    expect(children[0].textContent).toContain('Agent 会话');
    expect(children[1].classList.contains('acu-panel-grid')).toBe(true);
    expect(children[1].textContent).toContain('已有资料');
    expect(children[1].textContent).toContain('推演设置');
    expect(children[2].textContent).toContain('伪 Role 提示词');
    // 旧版把整个工作区塞进 2 列网格的单个格子里；现在会话面板直接是页面子级，内部不再嵌套第二层面板。
    expect(children[0].classList.contains('acu-panel')).toBe(true);
    expect(children[0].querySelectorAll('.acu-panel').length).toBe(0);
    expect(host.textContent).not.toContain('世界推演 Agent 会话');
    expect(button(host, '保存世界推演设置')).toBeUndefined();
    expect(host.textContent).toContain('锚点 第 1 楼 · swipe 1');
  });

  it('挂载与聊天变化只严格刷新，不隐式保存；楼层变动走会话重灌', async () => {
    await mountPage();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(saveSettings).not.toHaveBeenCalled();
    chatTick.value++;
    await nextTick();
    expect(refresh).toHaveBeenCalledTimes(2);
    mutationTick.value++;
    await nextTick();
    expect(resyncAfterChatMutation).toHaveBeenCalledTimes(1);
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('无任务时首条消息经高 RPM 确认后交给 runtime 发送并清空草稿', async () => {
    vi.useFakeTimers();
    const { host } = await mountPage();
    typeInto(chatInput(host), '推进北境局势');
    await nextTick();
    button(host, '发送')!.click();
    await nextTick();
    expect(send).not.toHaveBeenCalled();
    await passFirstSendRpmConfirm();
    await vi.advanceTimersByTimeAsync(0);
    await nextTick();
    expect(send).toHaveBeenCalledWith('推进北境局势');
    expect(chatInput(host).value).toBe('');
  });

  it('首次发送确认框被取消时不派发且保留草稿', async () => {
    const { host } = await mountPage();
    typeInto(chatInput(host), '推进北境局势');
    await nextTick();
    button(host, '发送')!.click();
    await nextTick();
    const dialog = useDialogStore();
    expect(dialog.active?.kind).toBe('confirm');
    dialog.cancelActive();
    await nextTick();
    expect(send).not.toHaveBeenCalled();
    expect(chatInput(host).value).toBe('推进北境局势');
  });

  it('已有任务时发送不弹确认框；消息未被接收时保留草稿', async () => {
    setTask('paused', 'manual');
    send.mockResolvedValueOnce(false);
    const { host } = await mountPage();
    typeInto(chatInput(host), '补充：北境是重点');
    await nextTick();
    button(host, '发送')!.click();
    await Promise.resolve();
    await nextTick();
    expect(useDialogStore().active).toBeNull();
    expect(send).toHaveBeenCalledWith('补充：北境是重点');
    expect(chatInput(host).value).toBe('补充：北境是重点');
    expect(host.textContent).toContain('已暂停 · 用户手动停止');
  });

  it('运行中只显示停止，点击调用 runtime.stop', async () => {
    setTask('running');
    const { host } = await mountPage();
    expect(button(host, '发送')).toBeUndefined();
    const stopButton = button(host, '停止')!;
    stopButton.click();
    await nextTick();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('运行中');
  });

  it('设置修改后 800ms 防抖经 runtime 保存；渠道选择立即保存', async () => {
    vi.useFakeTimers();
    const { host } = await mountPage();
    const historyInput = host.querySelector<HTMLInputElement>('input.acu-input[type="number"]')!;
    historyInput.value = '90000';
    historyInput.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    expect(saveSettings).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(900);
    expect(saveSettings).toHaveBeenCalledOnce();
    expect(saveSettings.mock.calls[0][0]).toMatchObject({ agentHistoryTokenBudget: 90000, agentRunBudget: { maxIterations: 12 } });

    host.querySelector<HTMLButtonElement>('.acu-select__trigger')!.click();
    await nextTick();
    const option = Array.from(host.querySelectorAll<HTMLLIElement>('.acu-select__item')).find(item => item.textContent?.trim() === '预设A')!;
    option.click();
    await nextTick();
    await vi.advanceTimersByTimeAsync(0);
    expect(saveSettings).toHaveBeenCalledTimes(2);
    expect(saveSettings.mock.calls[1][0]).toMatchObject({ apiPresetMode: 'fixed', fixedApiPresetName: '预设A' });
  });

  it('运行中保存返回 busy：显示排队提示并自动重试，落盘后提示消失', async () => {
    vi.useFakeTimers();
    setTask('running');
    saveSettings.mockResolvedValueOnce('busy' as any);
    const { host } = await mountPage();
    const historyInput = host.querySelector<HTMLInputElement>('input.acu-input[type="number"]')!;
    historyInput.value = '80000';
    historyInput.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    await vi.advanceTimersByTimeAsync(900);
    expect(saveSettings).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('将在本轮结束后自动保存');
    await vi.advanceTimersByTimeAsync(900);
    expect(saveSettings).toHaveBeenCalledTimes(2);
    await nextTick();
    expect(host.textContent).not.toContain('将在本轮结束后自动保存');
  });

  it('非法设置值在页面内报错且不落盘', async () => {
    vi.useFakeTimers();
    const { host } = await mountPage();
    const historyInput = host.querySelector<HTMLInputElement>('input.acu-input[type="number"]')!;
    historyInput.value = '-5';
    historyInput.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    await vi.advanceTimersByTimeAsync(900);
    expect(saveSettings).not.toHaveBeenCalled();
    expect(host.textContent).toContain('会话自动总结阈值 必须是 0 到 1000000 之间的整数');
  });

  it('设置与提示词按分组折叠，渠道与提示词分组使用中文角色名', async () => {
    const { host } = await mountPage();
    const groups = Array.from(host.querySelectorAll<HTMLElement>('.acu-v2-world-simulation-page__group'));
    const labels = groups.map(group => group.querySelector('.acu-disclosure-group__label')?.textContent?.trim());
    expect(labels).toEqual(expect.arrayContaining(['Agent 运行预算', '设定研究（网页检索）', '各 Agent 渠道', '主 Agent（world-director）提示词', '因果审核（causality-reviewer）提示词', '占位符速查']));
    for (const group of groups) {
      expect(group.querySelector('.acu-disclosure-group__header')?.getAttribute('aria-expanded')).toBe('false');
    }
    const channelGroup = groups.find(group => group.textContent?.includes('各 Agent 渠道'))!;
    channelGroup.querySelector<HTMLButtonElement>('.acu-disclosure-group__header')!.click();
    await nextTick();
    expect(channelGroup.textContent).toContain('世界推演');
    expect(channelGroup.textContent).toContain('设定研究');
    const topLevelLabels = Array.from(host.querySelectorAll<HTMLElement>('.acu-form-row__label'))
      .filter(label => !label.closest('.acu-v2-world-simulation-page__group'))
      .map(label => label.textContent?.trim());
    expect(topLevelLabels).toContain('API 预设（全局默认）');
    expect(topLevelLabels).not.toContain('主 Agent 迭代上限');
  });

  it('资料面板：投影预览页签渲染 runtime 提供的 projection preview，一键清空需确认后才调用 clearData', async () => {
    snapshot.value = baseSnapshot({ projectionPreview: '<!-- projection-test -->北境压力上升' });
    const { host } = await mountPage();
    expect(host.textContent).toContain('世界状态');
    button(host, '投影预览')!.click();
    await nextTick();
    expect(host.textContent).toContain('Projection preview');
    expect(host.textContent).toContain('北境压力上升');

    button(host, '一键清空')!.click();
    await nextTick();
    expect(clearData).not.toHaveBeenCalled();
    expect(host.textContent).toContain('确认清空');
    button(host, '确认清空')!.click();
    await nextTick();
    expect(clearData).toHaveBeenCalledTimes(1);
  });

  it('严格读取失败时展示结构化错误且不渲染会话输入与资料', async () => {
    ready.value = false;
    error.value = 'WORLD_SIMULATION_ENVELOPE_INVALID: envelope 损坏';
    snapshot.value = null;
    const { host } = await mountPage();
    expect(host.textContent).toContain('WORLD_SIMULATION_ENVELOPE_INVALID');
    expect(host.querySelector('.acu-v2-agent-chat__input')).toBeNull();
    expect(host.textContent).not.toContain('还没有运行记录');
    expect(saveSettings).not.toHaveBeenCalled();
    button(host, '重新读取')!.click();
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
