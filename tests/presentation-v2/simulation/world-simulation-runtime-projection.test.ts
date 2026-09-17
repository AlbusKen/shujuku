import { describe, expect, it } from 'vitest';
import { projectWorldSimulationSessionFromConversation_ACU } from '../../../src/presentation-v2/composables/useWorldSimulationRuntime';

describe('世界推演会话回灌投影', () => {
  it('优先使用持久事件元数据并保留状态、角色与时间', () => {
    const projected = projectWorldSimulationSessionFromConversation_ACU([{
      id: 9,
      kind: 'agent',
      text: '候选已通过审核',
      digest: '旧摘要',
      turnKey: 'run-1:completed',
      at: 1234,
      eventKind: 'run_completed',
      title: '世界推演完成',
      status: 'done',
      agentName: 'world-director',
      ok: true,
    }]);

    expect(projected).toEqual([{
      kind: 'run_completed',
      title: '世界推演完成',
      detail: '候选已通过审核',
      status: 'done',
      agentName: 'world-director',
      ok: true,
      at: 1234,
    }]);
  });

  it('旧消息继续按 kind 兼容映射且不回灌 handoff', () => {
    const projected = projectWorldSimulationSessionFromConversation_ACU([
      { id: 1, kind: 'user', text: '推进北境', digest: '', turnKey: '', at: 10 },
      { id: 2, kind: 'runtime', text: '内部摘要', digest: '历史过程', turnKey: '', at: 11 },
      { id: 0, kind: 'handoff', text: '交接报告', digest: '早期会话交接报告', turnKey: '', at: 12 },
    ]);

    expect(projected.map(item => item.kind)).toEqual(['user_message', 'thought']);
    expect(projected[0]).toMatchObject({ title: '你的消息', detail: '推进北境', at: 10 });
  });
});
