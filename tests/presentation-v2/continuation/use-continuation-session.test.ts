/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h } from 'vue';

const harness = vi.hoisted(() => ({ readTimeline: vi.fn() }));

vi.mock('../../../src/service/continuation/agent/agent-conversation-store', () => ({
  readAgentConversationTimeline_ACU: harness.readTimeline,
}));

import { useContinuationSession } from '../../../src/presentation-v2/composables/useContinuationSession';
import { beginAgentSessionRun_ACU, logAgentSession_ACU, resetAgentSessionLogForTests_ACU } from '../../../src/service/continuation/agent/agent-session-log';


/** 组件里挂载 composable：onMounted 回灌与卸载退订都要在真实组件生命周期里跑。 */
function mountSession_ACU() {
  let session: ReturnType<typeof useContinuationSession> | null = null;
  const host = defineComponent({
    setup() {
      session = useContinuationSession();
      return () => h('div');
    },
  });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(host);
  app.mount(el);
  return { app, session: session as unknown as ReturnType<typeof useContinuationSession> };
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
  resetAgentSessionLogForTests_ACU();
  harness.readTimeline.mockReturnValue([]);
});

describe('useContinuationSession', () => {
  it('挂载时把持久会话时间线按消息种类投影成会话流条目，交接文件是独立条目', () => {
    harness.readTimeline.mockReturnValue([
      { id: 'm1', kind: 'turn', text: '开始新的一轮规划', digest: '第 2 阶段 · 第 1 轮', createdAt: 1, turnKey: 'stage-1#1' },
      { id: 'm2', kind: 'user', text: '别揭穿守门人', digest: '会话输入', createdAt: 2, turnKey: null },
      { id: 'm3', kind: 'agent', text: '{"actions":[]}', digest: '第 1 次迭代', createdAt: 3, turnKey: null },
      { id: 'm4', kind: 'tool', text: '子代理回执', digest: 'mainline-planner', createdAt: 4, turnKey: null },
      { id: 'm5', kind: 'handoff', text: '早期轮次摘要', digest: '早期会话交接报告（此前内容对当前 AI 不可见）', createdAt: 5, turnKey: null },
    ]);

    const { session } = mountSession_ACU();

    expect(session.entries.value.map(entry => [entry.kind, entry.title, entry.detail])).toEqual([
      ['run_started', '第 2 阶段 · 第 1 轮', '开始新的一轮规划'],
      ['user_message', '会话输入', '别揭穿守门人'],
      ['main_action', '第 1 次迭代', '{"actions":[]}'],
      ['delegation', 'mainline-planner', '子代理回执'],
      ['handoff', '早期会话交接报告（此前内容对当前 AI 不可见）', '早期轮次摘要'],
    ]);
    // 回灌是历史展示，不能把自己算成"正在运行"。
    expect(session.running.value).toBe(false);
  });

  it('会话流已有实时条目时不回灌，避免历史覆盖正在进行的运行', () => {
    harness.readTimeline.mockReturnValue([
      { id: 'm1', kind: 'user', text: '历史消息', digest: '会话输入', createdAt: 1, turnKey: null },
    ]);
    logAgentSession_ACU({ kind: 'main_action', title: '正在进行的迭代' });

    const { session } = mountSession_ACU();

    expect(harness.readTimeline).not.toHaveBeenCalled();
    expect(session.entries.value).toHaveLength(1);
    expect(session.entries.value[0].title).toBe('正在进行的迭代');
  });

  it('持久会话不可读时保持空会话流而不是让页面崩掉', () => {
    harness.readTimeline.mockImplementation(() => { throw new Error('楼层不可读'); });

    const { session } = mountSession_ACU();

    expect(session.entries.value).toEqual([]);
  });

  it('rehydrate 清空既有条目并从当前聊天的持久会话重新回灌（切换聊天用）', () => {
    logAgentSession_ACU({ kind: 'main_action', title: '上一个聊天的条目' });
    const { session } = mountSession_ACU();
    expect(session.entries.value.map(entry => entry.title)).toEqual(['上一个聊天的条目']);

    harness.readTimeline.mockReturnValue([
      { id: 'm1', kind: 'user', text: '新聊天的历史消息', digest: '会话输入', createdAt: 1, turnKey: null },
    ]);
    session.rehydrate();

    expect(session.entries.value.map(entry => [entry.kind, entry.detail])).toEqual([['user_message', '新聊天的历史消息']]);
  });

  it('resyncAfterChatMutation 按现存楼层重灌、保留运行标记并留下说明（删楼 / swipe 用）', () => {
    harness.readTimeline.mockReturnValue([
      { id: 'm1', kind: 'agent', text: '第一轮的规划', digest: '', createdAt: 1, turnKey: 'k1' },
      { id: 'm2', kind: 'agent', text: '被删楼层上的规划', digest: '', createdAt: 2, turnKey: 'k2' },
    ]);
    const { session } = mountSession_ACU();
    beginAgentSessionRun_ACU('第 1 阶段 · 第 3 轮');
    logAgentSession_ACU({ kind: 'thought', title: '只存在于内存里的思考' });
    expect(session.running.value).toBe(true);

    harness.readTimeline.mockReturnValue([
      { id: 'm1', kind: 'agent', text: '第一轮的规划', digest: '', createdAt: 1, turnKey: 'k1' },
    ]);
    session.resyncAfterChatMutation();

    expect(session.entries.value.map(entry => [entry.kind, entry.kind === 'thought' ? entry.title : entry.detail])).toEqual([
      ['main_action', '第一轮的规划'],
      ['thought', '楼层已变化，会话已按现存楼层重新加载'],
    ]);
    expect(session.running.value).toBe(true);

    // 楼层上已没有任何会话记录时只清空，不追加说明——空会话流有自己的引导文案。
    harness.readTimeline.mockReturnValue([]);
    session.resyncAfterChatMutation();
    expect(session.entries.value).toEqual([]);
  });

  it('卸载后实时事件不再写进已销毁组件的会话流', () => {
    const { app, session } = mountSession_ACU();
    logAgentSession_ACU({ kind: 'main_action', title: '卸载前' });
    expect(session.entries.value).toHaveLength(1);

    app.unmount();
    logAgentSession_ACU({ kind: 'main_action', title: '卸载后' });

    expect(session.entries.value).toHaveLength(1);
  });
});
