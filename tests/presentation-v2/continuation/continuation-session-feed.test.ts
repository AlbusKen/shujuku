/**
 * ContinuationSessionFeed — 会话流折叠与交接条目渲染
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { type App, createApp, defineComponent, h, nextTick, ref, type Ref } from 'vue';
import ContinuationSessionFeed from '../../../src/presentation-v2/components/ContinuationSessionFeed.vue';
import type { AgentSessionEntry_ACU } from '../../../src/service/continuation/agent/agent-session-log';

interface Mounted {
  app: App<Element>;
  el: HTMLElement;
  entries: Ref<AgentSessionEntry_ACU[]>;
}

const mounted: Mounted[] = [];

function entry_ACU(id: number, overrides: Partial<AgentSessionEntry_ACU> = {}): AgentSessionEntry_ACU {
  return { id, at: id, kind: 'main_action', title: `条目 ${id}`, detail: '', agentName: '', ok: true, status: 'done', ...overrides };
}

function entriesOf_ACU(count: number): AgentSessionEntry_ACU[] {
  return Array.from({ length: count }, (_item, index) => entry_ACU(index + 1));
}

function mountFeed(initial: AgentSessionEntry_ACU[]): Mounted {
  const entries = ref<AgentSessionEntry_ACU[]>(initial);
  const wrapper = defineComponent({
    setup() {
      return () => h(ContinuationSessionFeed, { entries: entries.value, running: false });
    },
  });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(wrapper);
  app.mount(el);
  const item: Mounted = { app, el, entries };
  mounted.push(item);
  return item;
}

function foldButton(el: HTMLElement): HTMLButtonElement | null {
  return el.querySelector('.acu-v2-session-feed__fold');
}

function renderedTitles(el: HTMLElement): string[] {
  return [...el.querySelectorAll('.acu-v2-session-feed__title')].map(node => node.textContent ?? '');
}

afterEach(() => {
  while (mounted.length > 0) {
    const item = mounted.pop()!;
    item.app.unmount();
    item.el.remove();
  }
  document.body.innerHTML = '';
});

describe('ContinuationSessionFeed', () => {
  it('不超过 40 条时全量显示且没有折叠横幅', () => {
    const { el } = mountFeed(entriesOf_ACU(40));
    expect(foldButton(el)).toBeNull();
    expect(renderedTitles(el)).toHaveLength(40);
  });

  it('超过 40 条时只显示最近 40 条，横幅标注被折叠条数', () => {
    const { el } = mountFeed(entriesOf_ACU(41));
    const button = foldButton(el);
    expect(button).not.toBeNull();
    expect(button!.textContent).toContain('已折叠 1 条更早消息');
    const titles = renderedTitles(el);
    expect(titles).toHaveLength(40);
    expect(titles[0]).toBe('条目 2');
    expect(titles[titles.length - 1]).toBe('条目 41');
  });

  it('点击横幅每次多展开一批（40 条），展完后横幅消失', async () => {
    const { el } = mountFeed(entriesOf_ACU(100));
    expect(foldButton(el)!.textContent).toContain('已折叠 60 条更早消息');
    expect(foldButton(el)!.textContent).toContain('展开更早的 40 条');

    foldButton(el)!.click();
    await nextTick();
    expect(renderedTitles(el)).toHaveLength(80);
    // 剩余不足一批时，横幅如实标注剩余可展开数量。
    expect(foldButton(el)!.textContent).toContain('已折叠 20 条更早消息');
    expect(foldButton(el)!.textContent).toContain('展开更早的 20 条');

    foldButton(el)!.click();
    await nextTick();
    expect(renderedTitles(el)).toHaveLength(100);
    expect(foldButton(el)).toBeNull();
  });

  it('新条目追加时窗口保持锚定末尾；长度骤减（切聊天重灌）时折叠窗口复位', async () => {
    const { el, entries } = mountFeed(entriesOf_ACU(100));
    foldButton(el)!.click();
    await nextTick();
    expect(renderedTitles(el)).toHaveLength(80);

    // 追加一条：展开上限不变，仍显示最近 80 条。
    entries.value = [...entries.value, entry_ACU(101)];
    await nextTick();
    const titles = renderedTitles(el);
    expect(titles).toHaveLength(80);
    expect(titles[titles.length - 1]).toBe('条目 101');

    // 切换聊天重灌成 50 条：折叠窗口复位为 40。
    entries.value = entriesOf_ACU(50);
    await nextTick();
    expect(renderedTitles(el)).toHaveLength(40);
    expect(foldButton(el)!.textContent).toContain('已折叠 10 条更早消息');
  });

  it('交接条目以「交接」标签渲染，且带 handoff 样式类', () => {
    const { el } = mountFeed([
      entry_ACU(1),
      entry_ACU(2, { kind: 'handoff', title: '早期会话交接报告（此前内容对当前 AI 不可见）', detail: '浓缩记录正文' }),
    ]);
    const card = el.querySelector('.acu-v2-session-feed__card--handoff');
    expect(card).not.toBeNull();
    expect(card!.querySelector('.acu-v2-session-feed__badge')!.textContent).toBe('交接');
    expect(card!.textContent).toContain('早期会话交接报告（此前内容对当前 AI 不可见）');
  });

  it('子代理状态标签使用与渠道设置一致的中文角色名', () => {
    const { el } = mountFeed([
      entry_ACU(1, { kind: 'delegation', agentName: 'web-researcher', title: 'web-researcher 执行中', status: 'running' }),
      entry_ACU(2, { kind: 'delegation', agentName: 'arc-architect', title: 'arc-architect 执行中', status: 'running' }),
      entry_ACU(3, { kind: 'outline_op', agentName: 'outline-architect', title: 'outline-architect 执行中', status: 'running' }),
      entry_ACU(4, { kind: 'delegation', agentName: 'unknown-agent', title: 'unknown-agent 执行中', status: 'running' }),
    ]);
    const labels = [...el.querySelectorAll('.acu-v2-session-feed__badge')].map(node => node.textContent);
    expect(labels).toEqual(['网页检索', '故事总纲', '大纲子代理', 'unknown-agent']);
  });
});
