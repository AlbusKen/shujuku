/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick, reactive, type App } from 'vue';
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
    // 折叠行必须显示服务层写明的这一次被拒在哪，不能用固定文案盖掉标题。
    expect(details!.querySelector('summary')?.textContent).toContain('主 Agent 协议修正');
    expect(details!.textContent).toContain('UNKNOWN_FIELD $.reads[0].evidenceRef');
    expect(el.querySelector('.acu-v2-session-feed__card--protocol_retry')).toBeNull();
  });

  it('协议修正没有标题时回退为通用提示', () => {
    const el = mountFeed([entry_ACU({ title: '' })]);
    const details = el.querySelector<HTMLDetailsElement>('.acu-v2-session-feed__protocol');
    expect(details!.querySelector('summary')?.textContent).toContain('已自动修正一次模型输出');
  });

  it('主流程完成事件仍使用高层级卡片', () => {
    const el = mountFeed([entry_ACU({
      kind: 'run_completed',
      title: '格林推演完成',
      detail: '候选已通过审核',
      ok: true,
      status: 'done',
    })]);

    expect(el.querySelector('.acu-v2-session-feed__card--run_completed')).not.toBeNull();
    expect(el.textContent).toContain('格林推演完成');
  });

  it('同一阶段卡片实时从进行中转为通过或失败，并显示当前专员', async () => {
    const entries = reactive([entry_ACU({ kind: 'delegation', title: '人物推演第 1 批正在执行',
      agentName: 'dramatis-keeper', status: 'running', ok: true, detail: '正在执行阶段校验' })]);
    const el = mountFeed(entries);
    expect(el.textContent).toContain('人物推演');
    expect(el.textContent).toContain('进行中');
    expect(el.querySelector('.acu-v2-session-feed__spinner')).not.toBeNull();
    Object.assign(entries[0], { title: '人物推演第 1 批已通过', status: 'done', detail: '已覆盖 1 人，事实候选 0 项' });
    await nextTick();
    expect(el.textContent).toContain('已通过');
    expect(el.querySelector('.acu-v2-session-feed__spinner')).toBeNull();
    expect(el.querySelectorAll('.acu-v2-session-feed__card')).toHaveLength(1);
    Object.assign(entries[0], { title: '人物推演第 1 批失败', status: 'failed', ok: false, detail: '阶段调用或校验未通过' });
    await nextTick();
    expect(el.textContent).toContain('失败 / 中止');
    expect(el.querySelector('.acu-v2-session-feed__card--failed')).not.toBeNull();
  });

  it('派工卡片用中文角色名展示，未知 agentName 回退原名', () => {
    const el = mountFeed([
      entry_ACU({ id: 1, kind: 'delegation', title: '正在推演世界', agentName: 'world-analyst', ok: true, status: 'done' }),
      entry_ACU({ id: 2, kind: 'stage_plan', title: '阶段计划就绪', agentName: 'world-stage-planner', ok: true, status: 'done' }),
      entry_ACU({ id: 3, kind: 'delegation', title: '自定义代理', agentName: 'custom-agent', ok: true, status: 'done' }),
    ]);
    const badges = Array.from(el.querySelectorAll('.acu-v2-session-feed__badge')).map(item => item.textContent?.trim());

    expect(badges).toEqual(['格林推演', '阶段规划', 'custom-agent']);
    expect(el.textContent).not.toContain('world-analyst');
  });
});
