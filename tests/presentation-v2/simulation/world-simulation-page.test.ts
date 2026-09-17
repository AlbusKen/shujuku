/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, ref } from 'vue';
import { buildDefaultWorldSimulationEnvelope_ACU, buildDefaultWorldSimulationSettings_ACU } from '../../../src/service/simulation/defaults';

const chatTick = ref(0);
const mutationTick = ref(0);
const ready = ref(true);
const busy = ref(false);
const error = ref('');
const settingsDraft = ref<any>(buildDefaultWorldSimulationSettings_ACU());
const envelope = ref<any>(buildDefaultWorldSimulationEnvelope_ACU());
const task = ref<any>(null);
const activeRevision = ref<any>(null);
const refresh = vi.fn(() => true);
const send = vi.fn(async () => true);
const confirmPlan = vi.fn(async () => true);
const replan = vi.fn(async () => true);
const resume = vi.fn(async () => true);
const cancel = vi.fn(() => true);
const saveSettings = vi.fn(async () => true);
const snapshot = ref<any>({ envelope: envelope.value, conversation: { messages: [], nextId: 1, compaction: null, diagnostics: [] }, materials: { snapshot: null, diagnostics: [], adoptedIndex: null }, session: { entries: [], running: false }, anchor: null, projectionPreview: null });

vi.mock('../../../src/presentation-v2/composables/useWorldSimulationRuntime', () => ({
  useWorldSimulationRuntime: () => ({ snapshot, ready, busy, error, settingsDraft, envelope, task, activeRevision, refresh, send, confirmPlan, replan, resume, cancel, saveSettings }),
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

async function mountPage() {
  const Page = (await import('../../../src/presentation-v2/pages/WorldSimulationPage.vue')).default;
  const host = document.createElement('div'); document.body.appendChild(host);
  const app = createApp(Page); app.mount(host); await nextTick();
  return { app, host };
}
const button = (host: Element, text: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent?.includes(text));

beforeEach(() => {
  document.body.innerHTML = '';
  chatTick.value = 0;
  mutationTick.value = 0;
  ready.value = true;
  busy.value = false;
  error.value = '';
  settingsDraft.value = buildDefaultWorldSimulationSettings_ACU();
  envelope.value = buildDefaultWorldSimulationEnvelope_ACU();
  task.value = null;
  activeRevision.value = null;
  snapshot.value = { envelope: envelope.value, conversation: { messages: [], nextId: 1, compaction: null, diagnostics: [] }, materials: { snapshot: null, diagnostics: [], adoptedIndex: null }, session: { entries: [], running: false }, anchor: null, projectionPreview: null };
  vi.clearAllMocks();
});

describe('WorldSimulationPage', () => {
  it('挂载与聊天变化只严格刷新，不隐式保存', async () => {
    const { app } = await mountPage();
    expect(refresh).toHaveBeenCalledTimes(1); expect(saveSettings).not.toHaveBeenCalled();
    chatTick.value++; await nextTick();

    expect(refresh).toHaveBeenCalledTimes(2); expect(saveSettings).not.toHaveBeenCalled();
    app.unmount();
  });

  it('会话发送只派发到 simulation runtime', async () => {
    const { app, host } = await mountPage();
    const input = host.querySelector<HTMLTextAreaElement>('.acu-v2-agent-chat__input')!;
    input.value = '推进北境局势';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    button(host, '发送')?.click();
    await nextTick();
    expect(send).toHaveBeenCalledWith('推进北境局势');
    app.unmount();
  });

  it('待确认计划只通过 runtime 执行确认与重规划', async () => {
    task.value = { status: 'awaiting_plan_review' };
    activeRevision.value = { plan: { title: '北境阶段', objective: '核实边境压力' } };
    const { app, host } = await mountPage();
    const input = host.querySelector<HTMLTextAreaElement>('textarea[placeholder="输入重规划约束或修正方向"]')!;
    input.value = '只处理已授权证据';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    button(host, '重规划')?.click();
    await nextTick();
    expect(replan).toHaveBeenCalledWith('只处理已授权证据');
    button(host, '确认计划并执行')?.click();
    await nextTick();
    expect(confirmPlan).toHaveBeenCalledTimes(1);
    app.unmount();
  });

  it('设置只在显式保存时调用 runtime.saveSettings', async () => {
    const { app, host } = await mountPage();
    expect(saveSettings).not.toHaveBeenCalled();
    button(host, '保存世界推演设置')?.click();
    await nextTick();
    expect(saveSettings).toHaveBeenCalledTimes(1);
    app.unmount();
  });

  it('在母版预览面板展示 runtime 提供的 projection preview', async () => {
    snapshot.value = { ...snapshot.value, projectionPreview: '<!-- projection-test -->北境压力上升' };
    const { app, host } = await mountPage();
    expect(host.textContent).toContain('Projection preview');
    expect(host.textContent).toContain('北境压力上升');
    app.unmount();
  });

  it('严格读取失败时展示结构化错误且不渲染空状态面板', async () => {
    ready.value = false;
    error.value = 'WORLD_SIMULATION_ENVELOPE_INVALID: envelope 损坏';
    const { app, host } = await mountPage();
    expect(host.textContent).toContain('WORLD_SIMULATION_ENVELOPE_INVALID');
    expect(host.textContent).not.toContain('暂无运行记录');
    expect(saveSettings).not.toHaveBeenCalled();
    app.unmount();
  });
});
