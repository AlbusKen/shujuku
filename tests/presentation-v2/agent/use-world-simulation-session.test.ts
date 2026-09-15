/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetWorldSimulationSessionLogForTests_ACU } from '../../../src/service/simulation/world-simulation-agent-session-log';

type TimelineMessage = {
  id: number;
  kind: 'user' | 'plan' | 'delegation' | 'commit' | 'error';
  title: string;
  detail: string;
  agentName: string;
};

function makeTimeline(messages: TimelineMessage[]) {
  return { messages, invalidMessageIndexes: [] as number[] };
}

async function mountComposable() {
  vi.resetModules();
  document.body.innerHTML = '';
  const timeline = makeTimeline([]);
  const conversation = {
    readWorldSimulationConversationTimelineWithDiagnostics_ACU: vi.fn(() => timeline),
    subscribeWorldSimulationConversation_ACU: vi.fn(() => () => {}),
  };
  vi.doMock('../../../src/service/simulation/world-simulation-agent-conversation', () => conversation);
  const { createApp, defineComponent, h, nextTick } = await import('vue');
  const { useWorldSimulationSession } = await import('../../../src/presentation-v2/composables/useWorldSimulationSession');
  let exposed: ReturnType<typeof useWorldSimulationSession> | null = null;
  const Host = defineComponent({
    setup() {
      exposed = useWorldSimulationSession();
      return () => h('div');
    },
  });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(Host); app.mount(el); await nextTick();
  const api = exposed as unknown as ReturnType<typeof useWorldSimulationSession>;
  const sessionLog = await import('../../../src/service/simulation/world-simulation-agent-session-log');
  return { api, conversation, sessionLog, nextTick, setTimeline(next: TimelineMessage[]) { timeline.messages = next; } };
}

describe('useWorldSimulationSession', () => {
  it('hydrates once from the audit timeline when the in-memory log is empty', async () => {
    const { api, conversation, sessionLog, nextTick, setTimeline } = await mountComposable();
    expect(conversation.readWorldSimulationConversationTimelineWithDiagnostics_ACU).toHaveBeenCalledTimes(1);
    setTimeline([
      { id: 1, kind: 'user', title: '补充', detail: '推进港口', agentName: '' },
      { id: 2, kind: 'delegation', title: '派工', detail: '细节', agentName: '子代理' },
      { id: 3, kind: 'error', title: '失败', detail: '原因', agentName: '' },
      { id: 4, kind: 'commit', title: '提交', detail: '结果', agentName: '' },
    ]);
    api.rehydrate();
    await nextTick();
    const kinds = sessionLog.readWorldSimulationSessionLog_ACU().map(entry => entry.kind);
    expect(kinds).toEqual(['user_message', 'delegation', 'run_failed', 'run_completed']);
    expect(api.entries.value.map(entry => entry.kind)).toEqual(kinds);
  });

  it('does not re-hydrate over an existing session log', async () => {
    const { api, conversation, sessionLog, nextTick, setTimeline } = await mountComposable();
    setTimeline([{ id: 1, kind: 'user', title: '补充', detail: 'x', agentName: '' }]);
    api.rehydrate();
    await nextTick();
    const first = sessionLog.readWorldSimulationSessionLog_ACU().length;
    api.rehydrate();
    await nextTick();
    expect(conversation.readWorldSimulationConversationTimelineWithDiagnostics_ACU).toHaveBeenCalledTimes(3); // mount 回灌 + 两次强制重灌
    expect(sessionLog.readWorldSimulationSessionLog_ACU().length).toBe(first);
  });

  it('surfaces audit diagnostics as notice without altering entries', async () => {
    const { api, conversation, nextTick, setTimeline } = await mountComposable();
    setTimeline([{ id: 1, kind: 'user', title: '补充', detail: 'x', agentName: '' }]);
    // 注入一条损坏索引以验证诊断横幅
    (conversation.readWorldSimulationConversationTimelineWithDiagnostics_ACU as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      messages: [],
      invalidMessageIndexes: [3],
    }));
    api.rehydrate();
    await nextTick();
    expect(api.notice.value).toContain('已跳过 1 条损坏的非权威会话记录；原始数据未被改写。');
  });

  it('resyncAfterChatMutation keeps running and re-projects from the current floors', async () => {
    const { api, sessionLog, nextTick, setTimeline } = await mountComposable();
    setTimeline([
      { id: 1, kind: 'user', title: '补充', detail: 'x', agentName: '' },
      { id: 2, kind: 'delegation', title: '派工', detail: 'y', agentName: '子代理' },
    ]);
    api.rehydrate();
    await nextTick();
    expect(api.entries.value.length).toBe(2);
    setTimeline([{ id: 2, kind: 'delegation', title: '派工', detail: 'y', agentName: '子代理' }]);
    api.resyncAfterChatMutation();
    await nextTick();
    expect(api.entries.value.length).toBe(2); // 现存楼层投影重建后仅剩 1 条，再加楼层变化提示
    const titles = api.entries.value.map(entry => entry.title);
    expect(titles[titles.length - 1]).toBe('楼层已变化，会话已按现存楼层重新加载');
  });
});

