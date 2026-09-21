/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, ref, type App, type Ref } from 'vue';
import type { WorldSimulationSessionEntry_ACU } from '../../../src/service/simulation/agent/agent-session-log';

const runtimeState = vi.hoisted(() => ({
  running: undefined as Ref<boolean> | undefined,
  entries: undefined as Ref<WorldSimulationSessionEntry_ACU[]> | undefined,
  refresh: vi.fn(),
}));

vi.mock('../../../src/presentation-v2/composables/useWorldSimulationRuntime', () => ({
  useWorldSimulationRuntime: () => ({
    running: runtimeState.running,
    entries: runtimeState.entries,
    refresh: runtimeState.refresh,
  }),
}));

import WorldSimulationProgressCard from '../../../src/presentation-v2/components/WorldSimulationProgressCard.vue';

const mounted: Array<{ app: App<Element>; el: HTMLElement }> = [];

function entry(overrides: Partial<WorldSimulationSessionEntry_ACU> = {}): WorldSimulationSessionEntry_ACU {
  return {
    id: 1,
    at: 1,
    kind: 'run_started',
    title: '世界推演 Agent 运行',
    detail: '',
    agentName: 'world-director',
    ok: true,
    status: 'done',
    ...overrides,
  };
}

async function mountCard(): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp(WorldSimulationProgressCard);
  app.mount(host);
  mounted.push({ app, el: host });
  await nextTick();
  return host;
}

beforeEach(() => {
  runtimeState.running = ref(true);
  runtimeState.entries = ref([
    entry({ id: 1, kind: 'run_started' }),
    entry({ id: 2, kind: 'tool_read', title: '主 Agent 正在读取资料', status: 'running' }),
  ]);
  runtimeState.refresh.mockClear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
  while (mounted.length) {
    const item = mounted.pop()!;
    item.app.unmount();
    item.el.remove();
  }
  document.body.querySelectorAll('.acu-world-sim-progress').forEach(node => node.remove());
});

describe('WorldSimulationProgressCard', () => {
  it('Teleport 到 host document.body，展示高级阶段名且不暴露角色内部名', async () => {
    const host = await mountCard();
    const card = document.body.querySelector<HTMLElement>('.acu-world-sim-progress');
    expect(card).not.toBeNull();
    expect(card!.parentElement).toBe(document.body);
    expect(host.contains(card)).toBe(false);
    expect(card!.textContent).toContain('信息取证');
    expect(card!.textContent).not.toContain('timekeeper');
    expect(card!.textContent).not.toContain('world-director');
    expect(runtimeState.refresh).toHaveBeenCalled();
  });

  it('点击圆点可折叠，窄屏默认折叠为圆点', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 480, configurable: true });
    await mountCard();
    const card = document.body.querySelector<HTMLElement>('.acu-world-sim-progress');
    expect(card!.classList.contains('is-collapsed')).toBe(true);
    expect(card!.querySelector('.acu-world-sim-progress__label')).toBeNull();

    card!.querySelector<HTMLButtonElement>('.acu-world-sim-progress__dot')!.click();
    await nextTick();
    expect(card!.classList.contains('is-collapsed')).toBe(false);
    expect(card!.textContent).toContain('信息取证');
  });

  it('终态保持 2400ms 后自动收起', async () => {
    vi.useFakeTimers();
    await mountCard();
    runtimeState.running!.value = false;
    runtimeState.entries!.value = [
      entry({ id: 1, kind: 'run_started' }),
      entry({ id: 2, kind: 'run_completed', title: '世界推演完成' }),
    ];
    await nextTick();
    expect(document.body.querySelector('.acu-world-sim-progress')?.textContent).toContain('推演完成');
    await vi.advanceTimersByTimeAsync(2399);
    expect(document.body.querySelector('.acu-world-sim-progress')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(2);
    await nextTick();
    expect(document.body.querySelector('.acu-world-sim-progress')).toBeNull();
    vi.useRealTimers();
  });
});
