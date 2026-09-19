/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, type App } from 'vue';
import WorldSimulationSessionFeed from '../../../src/presentation-v2/components/WorldSimulationSessionFeed.vue';
import type { WorldSimulationSessionEntry_ACU } from '../../../src/service/simulation/agent/agent-session-log';

const mounted: Array<{ app: App<Element>; el: HTMLElement }> = [];

function entry_ACU(overrides: Partial<WorldSimulationSessionEntry_ACU> = {}): WorldSimulationSessionEntry_ACU {
  return {
    id: 1,
    at: 100,
    kind: 'protocol_retry',
    title: '主 Agent 协议修正',
    detail: 'UNKNOWN_FIELD $.reads[0].evidenceRef',
    agentName: 'world-director',
    ok: false,
    status: 'failed',
    ...overrides,
  };
}

function mountFeed(entries: WorldSimulationSessionEntry_ACU[]): HTMLElement {
  const wrapper = defineComponent({
    setup: () => () => h(WorldSimulationSessionFeed, { entries, running: false }),
  });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(wrapper);
  app.mount(el);
  mounted.push({ app, el });
  return el;
}

afterEach(() => {
  while (mounted.length) {
    const item = mounted.pop()!;
    item.app.unmount();
    item.el.remove();
  }
  document.body.innerHTML = '';
});

describe('WorldSimulationSessionFeed', () => {
  it('协议修正默认收敛为关闭的弱提示而非主流程卡片', () => {
    const el = mountFeed([entry_ACU()]);
    const details = el.querySelector<HTMLDetailsElement>('.acu-v2-session-feed__protocol');

    expect(details).not.toBeNull();
    expect(details!.open).toBe(false);
    expect(details!.querySelector('summary')?.textContent).toContain('已自动修正一次模型输出');
    expect(details!.textContent).toContain('UNKNOWN_FIELD $.reads[0].evidenceRef');
    expect(el.querySelector('.acu-v2-session-feed__card--protocol_retry')).toBeNull();
  });

  it('主流程完成事件仍使用高层级卡片', () => {
    const el = mountFeed([entry_ACU({
      kind: 'run_completed',
      title: '世界推演完成',
      detail: '候选已通过审核',
      ok: true,
      status: 'done',
    })]);

    expect(el.querySelector('.acu-v2-session-feed__card--run_completed')).not.toBeNull();
    expect(el.textContent).toContain('世界推演完成');
  });

  it('派工卡片用中文角色名展示，未知 agentName 回退原名', () => {
    const el = mountFeed([
      entry_ACU({ id: 1, kind: 'delegation', title: '正在推演世界', agentName: 'world-analyst', ok: true, status: 'done' }),
      entry_ACU({ id: 2, kind: 'stage_plan', title: '阶段计划就绪', agentName: 'world-stage-planner', ok: true, status: 'done' }),
      entry_ACU({ id: 3, kind: 'delegation', title: '自定义代理', agentName: 'custom-agent', ok: true, status: 'done' }),
    ]);
    const badges = Array.from(el.querySelectorAll('.acu-v2-session-feed__badge')).map(item => item.textContent?.trim());

    expect(badges).toEqual(['世界推演', '阶段规划', 'custom-agent']);
    expect(el.textContent).not.toContain('world-analyst');
  });
});
