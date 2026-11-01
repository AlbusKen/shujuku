/**
 * WorldSimulationPage — 验证 world-round v1 页面仅暴露真实生效设置，
 * 不再展示旧配置，资料补迁入口保持可用。
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { computed, createApp, nextTick, ref } from 'vue';
import { buildDefaultWorldSimulationEnvelope_ACU, buildDefaultWorldSimulationSettings_ACU, buildEmptyWorldSimulationLedger_ACU } from '../../../src/service/simulation/defaults';

const mountedApps = new Set<{ unmount: () => void }>();
const chatTick = ref(0);
const mutationTick = ref(0);
const ready = ref(true);
const busy = ref(false);
const legacyBackfillPreview = ref<any>(null);
const legacyBackfillResult = ref<any>(null);
const legacyBackfillError = ref('');
const error = ref('');
const snapshot = ref<any>(null);
const settings = ref<any>(buildDefaultWorldSimulationSettings_ACU());
const statusText = ref('尚未创建任务');
const stageText = ref('尚未创建任务');
const revisionText = ref('');
const anchorText = ref('第 1 楼 · swipe 1');
const refresh = vi.fn(() => true);
const initialize = vi.fn(async () => undefined);
const send = vi.fn(async () => true);
const stop = vi.fn(async () => undefined);
const resume = vi.fn(async () => true);
const saveSettings = vi.fn(async () => 'saved' as const);
const saveUserRequirements = vi.fn(async () => true);
const clearData = vi.fn(async () => true);
const deleteActor = vi.fn(async (_id: string) => true);
const deleteWorldEvent = vi.fn(async (_id: string) => true);
const deleteWorldHistory = vi.fn(async (_id: string) => true);
const scanWorldbookActors = vi.fn(async () => true);
const previewLegacyBackfill = vi.fn(async () => true);
const applyLegacyBackfill = vi.fn(async () => true);
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
    snapshot, ready, busy, legacyBackfillPreview, legacyBackfillResult, legacyBackfillError, error,
    envelope, task, settings, activeStage, activeRevision, anchor, anchorText, entries, running,
    statusText, stageText, revisionText, refresh, initialize, send, stop, resume, saveSettings,
    saveUserRequirements, clearData, deleteActor, deleteWorldEvent, deleteWorldHistory, scanWorldbookActors, previewLegacyBackfill, applyLegacyBackfill, resyncAfterChatMutation,
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
vi.mock('../../../src/presentation-v2/composables/useChatChangedListener', () => ({
  useChatChangedTick: () => chatTick,
  useChatMutationTick: () => mutationTick,
}));

function baseSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    envelope: { ...buildDefaultWorldSimulationEnvelope_ACU(), settings: settings.value },
    conversation: { messages: [], nextId: 1, compaction: null, diagnostics: [] },
    materials: { snapshot: null, diagnostics: [], adoptedIndex: null },
    fieldSnapshot: { records: {} },
    userRequirements: { snapshot: null, diagnostics: [], adoptedIndex: null },
    session: { chatIdentity: 'chat-a', entries: [], running: false },
    anchor: { chatIdentity: 'chat-a', messageIndex: 0, messageId: 7, messageKey: 'number:7', swipeId: '0', contentDigest: 'd' },
    projectionPreview: null,
    ...overrides,
  };
}

async function mountPage() {
  const Page = (await import('../../../src/presentation-v2/pages/WorldSimulationPage.vue')).default;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp(Page);
  app.use(createPinia());
  const originalUnmount = app.unmount.bind(app);
  app.unmount = () => { mountedApps.delete(app); originalUnmount(); };
  mountedApps.add(app);
  app.mount(host);
  await nextTick();
  return { app, host };
}

const button = (host: Element, text: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent?.includes(text));
const row = (host: Element, label: string) => Array.from(host.querySelectorAll<HTMLElement>('.acu-form-row')).find(item => item.querySelector('.acu-form-row__label')?.textContent?.trim() === label)!;

async function selectOption(host: Element, label: string, option: string): Promise<void> {
  const target = row(host, label);
  target.querySelector<HTMLButtonElement>('.acu-select__trigger')!.click();
  await nextTick();
  Array.from(target.querySelectorAll<HTMLLIElement>('.acu-select__item')).find(item => item.textContent?.trim() === option)!.click();
  await nextTick();
}

beforeEach(() => {
  document.body.innerHTML = '';
  setActivePinia(createPinia());
  chatTick.value = 0;
  mutationTick.value = 0;
  ready.value = true;
  busy.value = false;
  legacyBackfillPreview.value = null;
  legacyBackfillResult.value = null;
  legacyBackfillError.value = '';
  error.value = '';
  settings.value = buildDefaultWorldSimulationSettings_ACU();
  snapshot.value = baseSnapshot();
  vi.clearAllMocks();
  deleteActor.mockResolvedValue(true);
  deleteWorldEvent.mockResolvedValue(true);
  deleteWorldHistory.mockResolvedValue(true);
  saveSettings.mockResolvedValue('saved' as const);
});

afterEach(() => {
  for (const app of Array.from(mountedApps)) app.unmount();
  vi.useRealTimers();
});

describe('WorldSimulationPage', () => {
  it.each([
    ['单 Agent', '直接正文', 'single', 'body'],
    ['单 Agent', '剧情推进', 'single', 'plot'],
    ['分层', '直接正文', 'layered', 'body'],
    ['分层', '剧情推进', 'layered', 'plot'],
  ])('工作流四种组合：%s / %s 自动保存为真实运行选择', async (_workflowLabel, _deliveryLabel, workflowMode, deliveryTarget) => {
    vi.useFakeTimers();
    settings.value.workflowMode = workflowMode === 'single' ? 'layered' : 'single';
    settings.value.deliveryTarget = deliveryTarget === 'body' ? 'plot' : 'body';
    snapshot.value = baseSnapshot();
    const { host } = await mountPage();
    await selectOption(host, '工作流模式', _workflowLabel);
    await vi.advanceTimersByTimeAsync(900);
    await selectOption(host, '投送目标', _deliveryLabel);
    await vi.advanceTimersByTimeAsync(900);
    const saved = saveSettings.mock.calls.map(([candidate]) => candidate);
    expect(saved.length).toBeGreaterThan(0);
    expect(saved.at(-1)).toEqual(expect.objectContaining({ workflowMode, deliveryTarget }));
  });

  it('有效读取预算自动保存，无效单次请求上限在页面报错且不写入', async () => {
    vi.useFakeTimers();
    const { host } = await mountPage();
    const readBudget = row(host, '单批次读取上限').querySelector<HTMLInputElement>('input')!;
    readBudget.value = '25%';
    readBudget.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(900);
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ agentReadTokenBudget: '25%' }));

    saveSettings.mockClear();
    const historyBudget = row(host, '单次请求 token 上限').querySelector<HTMLInputElement>('input')!;
    historyBudget.value = '-1';
    historyBudget.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(900);
    expect(saveSettings).not.toHaveBeenCalled();
    expect(host.textContent).toContain('单次请求 token 上限 必须是 1 到 1000000 之间的整数');
  });

  it('全局和角色 API 渠道选择均自动保存', async () => {
    vi.useFakeTimers();
    const { host } = await mountPage();
    await selectOption(host, 'API 预设（全局默认）', '预设A');
    await vi.advanceTimersByTimeAsync(0);
    expect(saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ apiPresetMode: 'fixed', fixedApiPresetName: '预设A' }));

    const channelGroup = Array.from(host.querySelectorAll<HTMLElement>('.acu-v2-world-simulation-page__group'))
      .find(group => group.classList.contains('acu-v2-world-simulation-page__channels'))!;
    channelGroup.querySelector<HTMLButtonElement>('.acu-disclosure-group__header')!.click();
    await nextTick();
    const firstChannel = channelGroup.querySelector<HTMLElement>('.acu-form-row')!;
    firstChannel.querySelector<HTMLButtonElement>('.acu-select__trigger')!.click();
    await nextTick();
    Array.from(firstChannel.querySelectorAll<HTMLLIElement>('.acu-select__item')).find(item => item.textContent?.trim() === '预设A')!.click();
    await nextTick();
    await vi.advanceTimersByTimeAsync(0);
    expect(saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ agentApiPresets: expect.any(Object) }));
  });

  it('渠道使用表单行展开，自动推演位于下方且切换后保存', async () => {
    vi.useFakeTimers();
    const { host } = await mountPage();
    const channels = row(host, '各角色渠道');
    const trigger = channels.querySelector<HTMLButtonElement>('.acu-disclosure-group__header')!;
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    trigger.click();
    await nextTick();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(channels.querySelectorAll('.acu-select')).toHaveLength(4);
    const toggle = host.querySelector<HTMLButtonElement>('.acu-v2-world-simulation-page__auto-trigger')!;
    expect(channels.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const checked = toggle.getAttribute('aria-checked') === 'true';
    toggle.click();
    await vi.advanceTimersByTimeAsync(900);
    expect(saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ autoTriggerEnabled: !checked }));
    expect([...host.querySelectorAll('.acu-panel__title')].map(item => item.textContent?.trim())).toContain('推演提示词');
    expect(host.textContent).not.toContain('正式业务提示词');
  });

  it('删除旧提示词与配置的展示、导出入口，仍保留新版编辑入口', async () => {
    settings.value.agentPrompts['world-director'] = [{ role: 'system', content: '我的旧导演提示词', enabled: true, deletable: true, pinned: false }];
    snapshot.value = baseSnapshot();
    const { host } = await mountPage();
    for (const label of ['旧版提示词', '旧版配置', '导出旧三项审查', '我的旧导演提示词', '旧场景', '旧秘密触发', '旧正文采用']) {
      expect(host.textContent).not.toContain(label);
    }
    expect(host.textContent).toContain('推演提示词');
    expect(button(host, '导出推演提示词 JSON')).toBeDefined();
    expect(button(host, '导入推演提示词 JSON')).toBeDefined();
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('四份正式业务稿展示为派生默认；编辑后仅持久化目标角色，单模式附加稿可独立编辑', async () => {
    vi.useFakeTimers();
    const { host } = await mountPage();
    const registrarGroup = Array.from(host.querySelectorAll<HTMLElement>('.acu-v2-world-simulation-page__group'))
      .find(group => group.querySelector('.acu-disclosure-group__label')?.textContent?.trim() === '世界书角色整理')!;
    expect(registrarGroup.querySelectorAll('textarea').length).toBeGreaterThan(1);
    expect(registrarGroup.textContent).toContain('世界书角色整理');
    expect(saveSettings).not.toHaveBeenCalled();
    const clockGroup = Array.from(host.querySelectorAll<HTMLElement>('.acu-v2-world-simulation-page__group'))
      .find(group => group.querySelector('.acu-disclosure-group__label')?.textContent?.trim() === '时钟与召回')!;
    const jointGroup = Array.from(host.querySelectorAll<HTMLElement>('.acu-v2-world-simulation-page__group'))
      .find(group => group.textContent?.includes('联合审查'))!;
    const singleGroup = Array.from(host.querySelectorAll<HTMLElement>('.acu-v2-world-simulation-page__group'))
      .find(group => group.textContent?.includes('单模式附加自定义'))!;
    expect(clockGroup.textContent).not.toContain('程序派生的默认业务稿');
    expect(clockGroup.querySelectorAll('textarea').length).toBeGreaterThan(1);
    expect(jointGroup.textContent).toContain('联合审查');
    expect(singleGroup.textContent).toContain('未配置');
    clockGroup.querySelector<HTMLButtonElement>('.acu-disclosure-group__header')!.click();
    await nextTick();
    const content = clockGroup.querySelector<HTMLTextAreaElement>('textarea')!;
    content.value = '仅供时钟召回使用';
    content.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(900);
    const candidate = saveSettings.mock.calls.at(-1)?.[0];
    expect(candidate.worldRoundPrompts['clock-recaller'][0]).toEqual(expect.objectContaining({ content: '仅供时钟召回使用' }));
    expect(candidate.worldRoundPrompts['joint-reviewer']).toBeUndefined();
    singleGroup.querySelector<HTMLButtonElement>('.acu-disclosure-group__header')!.click();
    await nextTick();
    button(singleGroup, '添加段')!.click();
    await nextTick();
    expect(singleGroup.querySelectorAll('textarea')).toHaveLength(1);
  });

  it('正式业务稿导出当前有效默认，且不覆盖既有自定义', async () => {
    if (!URL.createObjectURL) Object.assign(URL, { createObjectURL: () => 'blob:prompts' });
    if (!URL.revokeObjectURL) Object.assign(URL, { revokeObjectURL: () => undefined });
    const objectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:prompts');
    const { host } = await mountPage();
    button(host, '导出推演提示词 JSON')!.click();
    const blob = objectUrl.mock.calls.at(-1)?.[0] as Blob;
    const exported = JSON.parse(await blob.text()) as { worldRoundPrompts: Record<string, Array<{ content: string }>> };
    expect(exported.worldRoundPrompts['clock-recaller'].length).toBeGreaterThan(1);
    expect(exported.worldRoundPrompts['joint-reviewer'].map(item => item.content).join('\n')).toContain('联合审查');
    expect(exported.worldRoundPrompts['worldbook-registrar'].map(item => item.content).join('\n')).toContain('世界书人物登记专员');
    expect(exported.worldRoundPrompts['worldbook-registrar'].map(item => item.content).join('\n')).toContain('一次判断全部已提供世界书条目');
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('正式提示词支持禁用、删除及上下移动', async () => {
    const settingsWithPrompts = buildDefaultWorldSimulationSettings_ACU() as any;
    settingsWithPrompts.worldRoundPrompts = {
      'clock-recaller': [
        { role: 'system', content: '第一段', enabled: true, deletable: true, pinned: false },
        { role: 'user', content: '第二段', enabled: true, deletable: true, pinned: false },
      ],
    };
    settings.value = settingsWithPrompts;
    snapshot.value = baseSnapshot();
    const { host } = await mountPage();
    const group = Array.from(host.querySelectorAll<HTMLElement>('.acu-v2-world-simulation-page__group'))
      .find(item => item.querySelector('.acu-disclosure-group__label')?.textContent?.trim() === '时钟与召回')!;
    group.querySelector<HTMLButtonElement>('.acu-disclosure-group__header')!.click();
    await nextTick();
    Array.from(group.querySelectorAll<HTMLButtonElement>('button')).filter(item => item.textContent?.includes('下移'))[0].click();
    await nextTick();
    expect(group.querySelectorAll<HTMLTextAreaElement>('textarea')[0].value).toBe('第二段');
    group.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click();
    await nextTick();
    expect(group.textContent).toContain('1/2 段启用');
    button(group, '删除')!.click();
    await nextTick();
    expect(group.querySelectorAll('textarea')).toHaveLength(1);
  });

  it('打开页面不写入正式提示词，旧 prompts 保持不变', async () => {
    const before = [{ role: 'system', content: '旧版内容', enabled: true, deletable: true, pinned: false }];
    settings.value.agentPrompts['world-director'] = before;
    snapshot.value = baseSnapshot();
    const { host } = await mountPage();
    await nextTick();
    expect(saveSettings).not.toHaveBeenCalled();
    expect(settings.value.agentPrompts['world-director']).toEqual(before);
    expect(host.textContent).toContain('推演提示词');
  });

  it('正式导入仅保留当前角色，不合并已有或导入的旧三项审查', async () => {
    vi.useFakeTimers();
    const segment = (content: string) => ({ role: 'system', content, enabled: true, deletable: true, pinned: false });
    settings.value.worldRoundPrompts = { 'scene-review': [segment('旧场景审查')], 'adoption-review': [segment('旧采用审查')] };
    snapshot.value = baseSnapshot();
    const { host } = await mountPage();
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File([JSON.stringify({ worldRoundPrompts: {
      'clock-recaller': [segment('正式校时稿')], 'worldbook-registrar': [segment('自定义世界书角色规则')], 'joint-reviewer': [], 'projection-review': [segment('旧触发审查')],
    } })], 'prompts.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(900);
    const saved = saveSettings.mock.calls.at(-1)?.[0];
    expect(saved.worldRoundPrompts).toEqual({ 'clock-recaller': [segment('正式校时稿')], 'worldbook-registrar': [segment('自定义世界书角色规则')], 'joint-reviewer': [] });
    expect(host.textContent).not.toContain('旧三项审查');
  });

  it('错误正式提示词导入被拒绝且已写正文不被污染', async () => {
    const settingsWithPrompts = buildDefaultWorldSimulationSettings_ACU() as any;
    settingsWithPrompts.worldRoundPrompts = {
      'clock-recaller': [{ role: 'system', content: '已写正文', enabled: true, deletable: true, pinned: false }],
    };
    settings.value = settingsWithPrompts;
    snapshot.value = baseSnapshot();
    const { host } = await mountPage();
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    const invalid = new File(['{"worldRoundPrompts":{"unknown":[]}}'], 'invalid.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { configurable: true, value: [invalid] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
    await nextTick();
    await nextTick();
    expect(host.textContent).toContain('正式提示词导入失败');
    const group = Array.from(host.querySelectorAll<HTMLElement>('.acu-v2-world-simulation-page__group'))
      .find(item => item.querySelector('.acu-disclosure-group__label')?.textContent?.trim() === '时钟与召回')!;
    group.querySelector<HTMLButtonElement>('.acu-disclosure-group__header')!.click();
    await nextTick();
    expect(group.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('已写正文');
  });

  it('不将旧工具、网页研究、迭代派工、风声碰撞、信号、纪要阈值显示为可生效功能', async () => {
    const { host } = await mountPage();
    const text = host.textContent ?? '';
    for (const retiredLabel of ['使用工具调用', '网页检索', '主 Agent 迭代上限', '派工总数上限', '风声等待上限', '碰撞兑现策略', '场外信号插入正文', '纪要热层阈值']) {
      expect(text).not.toContain(retiredLabel);
    }
    expect(text).not.toContain('旧版配置');
    expect(text).not.toContain('直接正文的结果进入下一次正文请求');
    expect(text).not.toContain('固定由世界角色处理世界');
    expect(host.querySelectorAll('.acu-panel__description-button')).toHaveLength(0);
    expect(host.querySelectorAll('.acu-form-row__hint')).toHaveLength(0);
    const channelGroup = Array.from(host.querySelectorAll<HTMLElement>('.acu-v2-world-simulation-page__group'))
      .find(group => group.classList.contains('acu-v2-world-simulation-page__channels'))!;
    expect(channelGroup.textContent).toContain('时钟与召回');
    expect(channelGroup.textContent).toContain('世界事件 / 单 Agent');
    expect(channelGroup.textContent).toContain('人物推演');
    expect(channelGroup.textContent).toContain('联合审查');
    expect(channelGroup.textContent).not.toContain('旧角色');
    expect(channelGroup.textContent).not.toContain('风声');
    expect(channelGroup.textContent).not.toContain('主 Agent');
    expect(channelGroup.textContent).not.toContain('因果审核');
  });

  it('世界状态平铺投送事件，楼层在标题下方，用户要求独立且读取诊断在最底部', async () => {
    snapshot.value = baseSnapshot({
      conversation: { messages: [], nextId: 1, compaction: null, diagnostics: ['会话读取错误'] },
      materials: { snapshot: null, diagnostics: ['快照读取错误'], adoptedIndex: null },
    });
    const { host } = await mountPage();
    const statePanel = host.querySelector('.acu-v2-world-simulation-page__world-state')!;
    const title = statePanel.querySelector('.acu-panel__title')!;
    expect(title.textContent).toContain('世界状态');
    expect(title.querySelector('.acu-v2-world-simulation-page__floor')?.textContent).toBe('第 1 楼 · swipe 1');
    expect(title.textContent).not.toContain('推演楼层');
    expect(statePanel.querySelectorAll('.acu-panel__actions button')).toHaveLength(2);
    expect(statePanel.querySelector('.acu-v2-ws-materials__tabs')).toBeNull();
    for (const retired of ['已有资料', '冻结锚点', '账本修订', '候选轨迹', '暂无基线', 'v7 运行资料', '投送状态']) {
      expect(statePanel.textContent).not.toContain(retired);
    }
    expect(statePanel.textContent).toContain('投送事件');
    expect(statePanel.textContent).not.toContain('用户要求');
    expect(host.querySelector('.acu-v2-world-simulation-page__requirements .acu-panel__title')?.textContent).toBe('用户要求');
    expect(host.querySelector('.acu-v2-world-simulation-page__requirements .acu-requirements-editor')).not.toBeNull();
    const bottom = host.querySelector('.acu-v2-world-simulation-page')!.lastElementChild!;
    expect(bottom.classList.contains('acu-v2-world-simulation-page__diagnostics')).toBe(true);
    expect(bottom.textContent).toContain('会话读取错误');
    expect(bottom.textContent).toContain('快照读取错误');
    expect(statePanel.textContent).not.toContain('读取诊断');
  });

  it('世界状态位于会话前，可折叠且清空确认会自动展开', async () => {
    const { host } = await mountPage();
    const panels = [...host.querySelectorAll('.acu-panel__title')].map(item => item.textContent?.trim());
    expect(panels[0]).toContain('世界状态');
    expect(panels[1]).toBe('世界推演会话');
    const toggle = host.querySelector<HTMLButtonElement>('.acu-v2-world-simulation-page__world-title')!;
    const content = host.querySelector<HTMLElement>('#acu-world-state-content')!;
    toggle.click();
    await nextTick();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(content.style.display).toBe('none');
    host.querySelector<HTMLButtonElement>('button[aria-label="清空世界状态"]')!.click();
    await nextTick();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(content.style.display).not.toBe('none');
    expect(button(host, '确认清空')).toBeDefined();
    expect(clearData).not.toHaveBeenCalled();
  });

  it('标题栏的清空操作仍需确认，可取消且只在确认后调用清空', async () => {
    const { host } = await mountPage();
    const clear = host.querySelector<HTMLButtonElement>('button[aria-label="清空世界状态"]')!;
    const refreshButton = host.querySelector<HTMLButtonElement>('button[aria-label="刷新世界状态"]')!;
    refresh.mockClear();
    refreshButton.click();
    expect(refresh).toHaveBeenCalledOnce();
    clear.click();
    await nextTick();
    expect(clearData).not.toHaveBeenCalled();
    expect(host.textContent).toContain('小说正文不变');
    button(host, '取消')!.click();
    await nextTick();
    expect(button(host, '确认清空')).toBeUndefined();
    clear.click();
    await nextTick();
    button(host, '确认清空')!.click();
    await nextTick();
    expect(clearData).toHaveBeenCalledOnce();
  });

  it('人物谱扫描经页面交给 composable，运行繁忙禁用，停止仍可点击', async () => {
    const { host } = await mountPage();
    const section = Array.from(host.querySelectorAll<HTMLDetailsElement>('.acu-v2-ws-materials__block'))
      .find(item => item.querySelector(':scope > summary')?.textContent?.includes('人物谱'))!;
    expect(section.querySelector('summary button')).toBeNull();
    button(section, '扫描世界书')!.click();
    await nextTick();
    expect(scanWorldbookActors).toHaveBeenCalledOnce();
    busy.value = true;
    snapshot.value = baseSnapshot({ session: { chatIdentity: 'chat-a', entries: [], running: true } });
    await nextTick();
    expect(button(section, '扫描世界书')?.disabled).toBe(true);
    button(section, '扫描世界书')!.click();
    expect(scanWorldbookActors).toHaveBeenCalledOnce();
    const stopButton = host.querySelector<HTMLButtonElement>('button[aria-label="停止"]') ?? button(host, '停止');
    expect(stopButton).toBeDefined();
    expect(stopButton?.disabled).toBe(false);
    stopButton!.click();
    await nextTick();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('世界事件删除从卡片传准确 id，失败保留确认，成功刷新后仅目标事件消失', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    const event = (id: string, title: string): typeof ledger.worldEvents[number] => ({
      id, title, state: '', status: 'active', actorIds: [], organizationIds: [], locationRefs: [], startedAt: null,
      deadline: null, nextCheck: null, relatedEventIds: [], loreRefs: [], evidenceRefs: [], tags: [], revision: 1, legacy: null,
    });
    ledger.worldEvents = [event('event-a', '夜市开张'), event('event-b', '春日集市')];
    snapshot.value = baseSnapshot({ publishedLedger: ledger });
    const { host } = await mountPage();
    const card = () => Array.from(host.querySelectorAll<HTMLDetailsElement>('.acu-v2-ws-materials__entry'))
      .find(item => item.querySelector('summary')?.textContent?.includes('夜市开张'));
    button(card()!, '删除')!.click();
    await nextTick();
    expect(deleteWorldEvent).not.toHaveBeenCalled();
    button(card()!, '取消')!.click();
    await nextTick();
    expect(deleteWorldEvent).not.toHaveBeenCalled();
    button(card()!, '删除')!.click();
    await nextTick();
    deleteWorldEvent.mockResolvedValueOnce(false);
    button(card()!, '确认删除')!.click();
    await nextTick();
    expect(deleteWorldEvent).toHaveBeenCalledExactlyOnceWith('event-a');
    expect(card()?.textContent).toContain('确认删除');
    deleteWorldEvent.mockImplementationOnce(async () => {
      snapshot.value = baseSnapshot({ publishedLedger: { ...ledger, worldEvents: [ledger.worldEvents[1]] } });
      return true;
    });
    button(card()!, '确认删除')!.click();
    await nextTick();
    await nextTick();
    expect(deleteWorldEvent).toHaveBeenCalledTimes(2);
    expect(card()).toBeUndefined();
    expect(host.textContent).toContain('春日集市');
  });

  it('重要历史删除从卡片传准确 id，确认文案说明只删这条记录；失败保留确认，成功刷新后仅目标历史消失，冷层历史不受影响', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    const history = (id: string, summary: string): typeof ledger.historyMilestones[number] => ({
      id, summary, happenedAt: { day: 2, slot: '' }, actorIds: [], worldEventIds: [], locationRef: null, sourceFactIds: [],
      importance: 2, category: '行动', visibility: 'internal', revision: 1, legacyRefs: [],
    });
    ledger.historyMilestones = [history('history-a', '守卫关闭北门'), history('history-b', '商队抵达城区')];
    ledger.historyArchive = [history('history-cold', '冷层旧事')];
    snapshot.value = baseSnapshot({ publishedLedger: ledger });
    const { host } = await mountPage();
    const card = (text: string) => Array.from(host.querySelectorAll<HTMLElement>('.acu-v2-ws-materials__card'))
      .find(item => item.textContent?.includes(text) && item.querySelector('.acu-v2-ws-materials__card-head'));
    button(card('守卫关闭北门')!, '删除')!.click();
    await nextTick();
    expect(deleteWorldHistory).not.toHaveBeenCalled();
    expect(card('守卫关闭北门')!.textContent).toContain('删除这条重要历史？只删除这条记录，人物、事件、事实和正文保留。');
    expect(card('商队抵达城区')!.textContent).not.toContain('确认删除');
    button(card('守卫关闭北门')!, '取消')!.click();
    await nextTick();
    expect(deleteWorldHistory).not.toHaveBeenCalled();
    expect(card('守卫关闭北门')!.textContent).not.toContain('确认删除');
    button(card('守卫关闭北门')!, '删除')!.click();
    await nextTick();
    deleteWorldHistory.mockResolvedValueOnce(false);
    button(card('守卫关闭北门')!, '确认删除')!.click();
    await nextTick();
    expect(deleteWorldHistory).toHaveBeenCalledExactlyOnceWith('history-a');
    expect(card('守卫关闭北门')?.textContent).toContain('确认删除');
    deleteWorldHistory.mockImplementationOnce(async () => {
      snapshot.value = baseSnapshot({ publishedLedger: { ...ledger, historyMilestones: [ledger.historyMilestones[1]] } });
      return true;
    });
    button(card('守卫关闭北门')!, '确认删除')!.click();
    await nextTick();
    await nextTick();
    expect(deleteWorldHistory).toHaveBeenCalledTimes(2);
    expect(deleteWorldHistory).toHaveBeenLastCalledWith('history-a');
    expect(card('守卫关闭北门')).toBeUndefined();
    expect(host.textContent).toContain('商队抵达城区');
    expect(host.textContent).toContain('冷层旧事');
  });

  it('人物谱删除由卡片确认传入准确 id，失败保留卡片与确认，成功刷新只移除目标人物', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    const actor = (id: string, name: string): typeof ledger.actors[number] => ({
      id, name, interests: [], location: '', locationRef: null, life: 'alive', diedAtDay: null, deathSummary: null,
      resources: [], goals: [], constraints: [], informationSources: [], knownFacts: [], visibility: 'public',
      currentAction: null, shortTermAction: null, longTermAction: null, simulationStatus: 'active', experiences: [], revision: 1,
    });
    ledger.actors = [actor('actor-a', '阿岚'), actor('actor-b', '小川')];
    ledger.worldEvents = [{ id: 'event-a', title: '夜市开张', state: '', status: 'active', actorIds: ['actor-a'], organizationIds: [], locationRefs: [], startedAt: null, deadline: null, nextCheck: null, relatedEventIds: [], loreRefs: [], evidenceRefs: [], tags: [], revision: 1, legacy: null }];
    snapshot.value = baseSnapshot({ publishedLedger: ledger });
    const { host } = await mountPage();
    const card = () => Array.from(host.querySelectorAll<HTMLDetailsElement>('.acu-v2-ws-materials__entry'))
      .find(item => item.querySelector('summary')?.textContent?.includes('阿岚'));
    expect(card()?.open).toBe(false);
    expect(card()?.querySelector('summary button')).toBeNull();
    card()!.open = true;
    button(card()!, '删除')!.click();
    await nextTick();
    expect(deleteActor).not.toHaveBeenCalled();
    button(card()!, '取消')!.click();
    await nextTick();
    expect(deleteActor).not.toHaveBeenCalled();
    button(card()!, '删除')!.click();
    await nextTick();
    deleteActor.mockResolvedValueOnce(false);
    button(card()!, '确认删除')!.click();
    await nextTick();
    expect(deleteActor).toHaveBeenCalledExactlyOnceWith('actor-a');
    expect(card()?.textContent).toContain('确认删除');
    deleteActor.mockImplementationOnce(async () => {
      snapshot.value = baseSnapshot({ publishedLedger: { ...ledger, actors: [ledger.actors[1]] } });
      return true;
    });
    button(card()!, '确认删除')!.click();
    await nextTick();
    await nextTick();
    expect(deleteActor).toHaveBeenCalledTimes(2);
    expect(card()).toBeUndefined();
    expect(host.textContent).toContain('小川');
    expect(host.textContent).toContain('夜市开张');
    expect(host.textContent).toContain('世界推演会话');
  });

  it('不再显示旧资料补迁和兼容入口，不调用旧补迁操作', async () => {
    legacyBackfillPreview.value = { changed: true, addedEventCount: 2, addedFactCount: 3, addedHistoryCount: 1, remainingIssueCount: 4 };
    const { host } = await mountPage();
    expect(button(host, '预览旧资料补迁')).toBeUndefined();
    expect(button(host, '确认补迁')).toBeUndefined();
    expect(host.textContent).not.toContain('旧兼容资料');
    expect(previewLegacyBackfill).not.toHaveBeenCalled();
    expect(applyLegacyBackfill).not.toHaveBeenCalled();
  });
});
