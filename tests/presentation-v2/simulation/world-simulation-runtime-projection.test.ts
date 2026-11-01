// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { projectWorldSimulationSessionFromConversation_ACU, useWorldSimulationRuntime } from '../../../src/presentation-v2/composables/useWorldSimulationRuntime';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../../src/service/simulation/defaults';
import { useToastStore } from '../../../src/presentation-v2/stores/toast-store';

const runtimeHarness = vi.hoisted(() => ({ getWorldSimulationRuntime_ACU: vi.fn() }));
vi.mock('../../../src/service/simulation/simulation-runtime', () => ({
  WORLD_SIMULATION_STOP_REASON_LABELS_ACU: {},
  getWorldSimulationRuntime_ACU: runtimeHarness.getWorldSimulationRuntime_ACU,
}));

describe('格林推演会话回灌投影', () => {
  it('优先使用持久事件元数据并保留状态、角色与时间', () => {
    const projected = projectWorldSimulationSessionFromConversation_ACU([{
      id: 9,
      kind: 'agent',
      text: '候选已通过审核',
      digest: '旧摘要',
      turnKey: 'run-1:completed',
      at: 1234,
      eventKind: 'run_completed',
      title: '格林推演完成',
      status: 'done',
      agentName: 'world-director',
      ok: true,
    }]);

    expect(projected).toEqual([{
      kind: 'run_completed',
      title: '格林推演完成',
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

describe('世界事件删除 composable', () => {
  it('busy 拦截、保存异常与回读失败均保留旧快照并报错，成功才显示新快照', async () => {
    setActivePinia(createPinia());
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    const event = { id: 'event-a', title: '夜市开张', state: '', status: 'active' as const, actorIds: [], organizationIds: [], locationRefs: [], startedAt: null, deadline: null, nextCheck: null, relatedEventIds: [], loreRefs: [], evidenceRefs: [], tags: [], revision: 1, legacy: null };
    envelope.ledger.worldEvents = [event];
    const saved = { envelope, session: { chatIdentity: null, entries: [], running: false }, conversation: { messages: [], nextId: 1, compaction: null, diagnostics: [] }, materials: { snapshot: null, diagnostics: [], adoptedIndex: null }, fieldSnapshot: { records: {} }, userRequirements: { snapshot: null, diagnostics: [], adoptedIndex: null }, anchor: null, projectionPreview: null };
    const deleted = { ...saved, envelope: { ...envelope, ledger: { ...envelope.ledger, worldEvents: [] } } };
    const readUiSnapshot = vi.fn().mockReturnValue(saved);
    const deleteWorldEvent = vi.fn().mockResolvedValue(undefined);
    runtimeHarness.getWorldSimulationRuntime_ACU.mockReturnValue({ readUiSnapshot, deleteWorldEvent });
    try {
      const ui = useWorldSimulationRuntime();
      const toast = useToastStore();
      const success = vi.spyOn(toast, 'success');
      const error = vi.spyOn(toast, 'error');
      expect(ui.refresh()).toBe(true);
      ui.busy.value = true;
      expect(await ui.deleteWorldEvent('event-a')).toBe(false);
      expect(deleteWorldEvent).not.toHaveBeenCalled();
      ui.busy.value = false;
      deleteWorldEvent.mockRejectedValueOnce(new Error('保存失败'));
      expect(await ui.deleteWorldEvent('event-a')).toBe(false);
      expect(ui.snapshot.value).toEqual(saved);
      expect(error).toHaveBeenLastCalledWith('保存失败', { muteable: false });
      readUiSnapshot.mockImplementationOnce(() => { throw new Error('回读失败'); });
      expect(await ui.deleteWorldEvent('event-a')).toBe(false);
      expect(ui.snapshot.value).toEqual(saved);
      expect(ui.ready.value).toBe(true);
      expect(error).toHaveBeenLastCalledWith('回读失败', { muteable: false });
      readUiSnapshot.mockReturnValue(deleted);
      expect(await ui.deleteWorldEvent('event-a')).toBe(true);
      expect(deleteWorldEvent).toHaveBeenCalledTimes(3);
      expect(deleteWorldEvent).toHaveBeenLastCalledWith('event-a');
      expect(ui.snapshot.value).toEqual(deleted);
      expect(ui.busy.value).toBe(false);
      expect(success).toHaveBeenCalledWith('已删除世界事件记录。');
    } finally { runtimeHarness.getWorldSimulationRuntime_ACU.mockReset(); }
  });

  it('deleteWorldHistory 与删除事件同一套安全流程：busy 不调用，失败保留旧快照，回读失败保留，成功刷新并提示', async () => {
    setActivePinia(createPinia());
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    const history = { id: 'history-a', summary: '守卫关闭北门', happenedAt: { day: 1, slot: '' }, actorIds: [], worldEventIds: [], locationRef: null,
      sourceFactIds: [], importance: 2, category: '行动', visibility: 'internal' as const, revision: 1, legacyRefs: [] };
    envelope.ledger.historyMilestones = [history];
    const base = { session: { chatIdentity: null, entries: [], running: false }, conversation: { messages: [], nextId: 1, compaction: null, diagnostics: [] } };
    const saved = { ...base, envelope };
    const deleted = { ...base, envelope: { ...envelope, ledger: { ...envelope.ledger, historyMilestones: [] } } };
    const readUiSnapshot = vi.fn().mockReturnValue(saved);
    const deleteWorldHistory = vi.fn().mockResolvedValue(undefined);
    runtimeHarness.getWorldSimulationRuntime_ACU.mockReturnValue({ readUiSnapshot, deleteWorldHistory });
    try {
      const ui = useWorldSimulationRuntime();
      const toast = useToastStore();
      const success = vi.spyOn(toast, 'success');
      const error = vi.spyOn(toast, 'error');
      expect(ui.refresh()).toBe(true);
      ui.busy.value = true;
      expect(await ui.deleteWorldHistory('history-a')).toBe(false);
      expect(deleteWorldHistory).not.toHaveBeenCalled();
      ui.busy.value = false;
      deleteWorldHistory.mockRejectedValueOnce(new Error('保存失败'));
      expect(await ui.deleteWorldHistory('history-a')).toBe(false);
      expect(ui.snapshot.value).toEqual(saved);
      expect(error).toHaveBeenLastCalledWith('保存失败', { muteable: false });
      readUiSnapshot.mockImplementationOnce(() => { throw new Error('回读失败'); });
      expect(await ui.deleteWorldHistory('history-a')).toBe(false);
      expect(ui.snapshot.value).toEqual(saved);
      expect(ui.ready.value).toBe(true);
      readUiSnapshot.mockReturnValue(deleted);
      expect(await ui.deleteWorldHistory('history-a')).toBe(true);
      expect(deleteWorldHistory).toHaveBeenLastCalledWith('history-a');
      expect(ui.snapshot.value).toEqual(deleted);
      expect(ui.busy.value).toBe(false);
      expect(success).toHaveBeenCalledWith('已删除重要历史记录。');
    } finally { runtimeHarness.getWorldSimulationRuntime_ACU.mockReset(); }
  });
});
