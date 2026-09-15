/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resetWorldSimulationSessionLogForTests_ACU,
  type WorldSimulationSessionEntry_ACU,
} from '../../../src/service/simulation/world-simulation-agent-session-log';

afterEach(() => { vi.restoreAllMocks(); resetWorldSimulationSessionLogForTests_ACU(); });

function makeEntry(partial: Partial<WorldSimulationSessionEntry_ACU>): WorldSimulationSessionEntry_ACU {
  return {
    id: partial.id ?? 1,
    at: partial.at ?? Date.now(),
    kind: partial.kind ?? 'main_action',
    title: partial.title ?? '标题',
    detail: partial.detail ?? '',
    agentName: partial.agentName ?? '',
    ok: partial.ok ?? true,
    status: partial.status ?? 'done',
  };
}

async function mountFeed(entries: WorldSimulationSessionEntry_ACU[], running = false) {
  vi.resetModules();
  document.body.innerHTML = '';
  const { createApp, nextTick } = await import('vue');
  const Feed = (await import('../../../src/presentation-v2/components/WorldSimulationSessionFeed.vue')).default;
  const el = document.createElement('div'); document.body.appendChild(el);
  const app = createApp(Feed, { entries, running });
  app.mount(el); await nextTick();
  return { app, el };
}

describe('WorldSimulationSessionFeed', () => {
  it('renders empty state and running pulse only when running', async () => {
    const { app, el } = await mountFeed([], false);
    expect(el.textContent).toContain('还没有会话记录');
    expect(el.textContent).not.toContain('世界推演 Agent 正在工作');
    app.unmount();
    const { app: app2, el: el2 } = await mountFeed([], true);
    expect(el2.textContent).toContain('世界推演 Agent 正在工作');
    app2.unmount();
  });

  it('renders run divider, user bubble, and cards with kind labels', async () => {
    const entries = [
      makeEntry({ id: 1, kind: 'run_started', title: '开始运行' }),
      makeEntry({ id: 2, kind: 'user_message', title: '补充', detail: '推进港口局势' }),
      makeEntry({ id: 3, kind: 'delegation', title: '派工', detail: '细节', agentName: '子代理' }),
      makeEntry({ id: 4, kind: 'run_completed', title: '完成', detail: '已提交' }),
    ];
    const { app, el } = await mountFeed(entries);
    expect(el.textContent).toContain('开始运行');
    expect(el.textContent).toContain('推进港口局势');
    expect(el.textContent).toContain('子代理');
    expect(el.textContent).toContain('完成');
    app.unmount();
  });

  it('defaults terminal and rebase entries expanded while folding procedural ones', async () => {
    const entries = [
      makeEntry({ id: 1, kind: 'delegation', title: '派工', detail: '过程细节' }),
      makeEntry({ id: 2, kind: 'rebase', title: '回退', detail: '回退原因' }),
      makeEntry({ id: 3, kind: 'run_failed', title: '失败', detail: '失败原因', ok: false, status: 'failed' }),
    ];
    const { app, el } = await mountFeed(entries);
    const cards = Array.from(el.querySelectorAll('.wsc-feed__card'));
    expect(cards).toHaveLength(3);
    expect(cards[0].querySelector('.wsc-feed__preview')).not.toBeNull();
    expect(cards[0].querySelector('.wsc-feed__detail')).toBeNull();
    expect(cards[1].querySelector('.wsc-feed__detail')).not.toBeNull();
    expect(cards[1].querySelector('.wsc-feed__detail')).not.toBeNull();
    expect(cards[2].textContent).toContain('失败原因');
  });

  it('folds beyond 40 entries with an expand banner and shows the newest last', async () => {
    const entries = Array.from({ length: 45 }, (_, index) => makeEntry({ id: index + 1, kind: 'main_action', title: `条目${index + 1}`, detail: `细节${index + 1}` }));
    const { app, el } = await mountFeed(entries);
    expect(el.textContent).toContain('已折叠 5 条更早消息');
    const titles = Array.from(el.querySelectorAll('.wsc-feed__title')).map(node => node.textContent);
    expect(titles[0]).toBe('条目6');
    expect(titles[titles.length - 1]).toBe('条目45');
    app.unmount();
  });
});
