/**
 * tests/service/continuation/agent/agent-module-sql-view.test.ts
 * 续写资料 SQL 易失视图：物化、行级 upsert/remove、revision 冲突、变更导出与 fail-closed。
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  materializeAgentModuleSqlView_ACU,
  AgentModuleSqlViewError_ACU,
  type AgentModuleSqlView_ACU,
} from '../../../../src/service/continuation/agent/agent-module-sql-view';
import {
  AGENT_MODULE_SCHEMA_VERSION_ACU,
  type AgentModuleSnapshot_ACU,
} from '../../../../src/service/continuation/agent/agent-model';

function makeSnapshot(): AgentModuleSnapshot_ACU {
  return {
    schemaVersion: AGENT_MODULE_SCHEMA_VERSION_ACU,
    settledThroughIndex: 12,
    updatedAt: 1000,
    revisions: { hooks: 3, infoGap: 2, constraints: 1, storyArc: 0, chronology: 0, webRefs: 0, userRequirements: 5 },
    hooks: [
      { id: 'hook-1', summary: '旧伏笔', status: 'planted', importance: 'high', plantedIndex: 2, updatedIndex: 2, plannedPayoff: '后期兑现', retired: false, retiredReason: '' },
      { id: 'hook-2', summary: '待删伏笔', status: 'planted', importance: 'low', plantedIndex: 4, updatedIndex: 4, plannedPayoff: '', retired: false, retiredReason: '' },
    ],
    infoGap: [
      { id: 'gap-1', topic: '身世', objectiveFact: '主角是遗孤', readerKnown: '不知情', characterKnowledge: [{ name: '长老', knows: '全部真相' }], revealStatus: 'unrevealed', revealIndex: null, retired: false, retiredReason: '' },
    ],
    constraints: [],
    storyArc: [],
    chronology: [],
    webRefs: [],
    userRequirements: ['保持悬疑'],
    materialCompletion: { state: 'complete_changed', rangeStartIndex: 0, rangeEndIndex: 12, modules: {}, updatedAt: 900 },
    pendingFixes: [],
  };
}

describe('agent-module-sql-view', () => {
  let view: AgentModuleSqlView_ACU | null = null;
  afterEach(() => { view?.dispose(); view = null; });

  it('物化快照：条目、revision 与标量字段完整进库', async () => {
    view = await materializeAgentModuleSqlView_ACU(makeSnapshot());
    const back = view.readSnapshot();
    expect(back.hooks.map(item => item.id)).toEqual(['hook-1', 'hook-2']);
    expect(back.infoGap).toHaveLength(1);
    expect(back.userRequirements).toEqual(['保持悬疑']);
    expect(back.revisions.hooks).toBe(3);
    expect(back.revisions.userRequirements).toBe(5);
    expect(back.settledThroughIndex).toBe(12);
    expect(back.materialCompletion.state).toBe('complete_changed');
    expect(view.hasChanges()).toBe(false);
  });

  it('空快照物化为合法空库', async () => {
    const empty = makeSnapshot();
    empty.hooks = [];
    empty.infoGap = [];
    empty.userRequirements = [];
    view = await materializeAgentModuleSqlView_ACU(empty);
    const back = view.readSnapshot();
    expect(back.hooks).toEqual([]);
    expect(back.userRequirements).toEqual([]);
  });

  it('行级 upsert：新增与覆盖同 id 条目，revision 随写推进', async () => {
    view = await materializeAgentModuleSqlView_ACU(makeSnapshot());
    const next = view.applyRowWrite({
      module: 'hooks',
      expectedRevision: 3,
      upserts: [
        { id: 'hook-1', summary: '旧伏笔（已更新）', status: 'reinforced', importance: 'high', plantedIndex: 2, updatedIndex: 12, plannedPayoff: '后期兑现', retired: false, retiredReason: '' },
        { id: 'hook-3', summary: '新伏笔', status: 'planted', importance: 'mid', plantedIndex: 12, updatedIndex: 12, plannedPayoff: '', retired: false, retiredReason: '' },
      ],
    });
    expect(next).toBe(4);
    const back = view.readSnapshot();
    expect(back.hooks.map(item => item.id)).toEqual(['hook-1', 'hook-2', 'hook-3']);
    expect(back.hooks[0].summary).toBe('旧伏笔（已更新）');
    expect(back.revisions.hooks).toBe(4);
    expect(view.hasChanges()).toBe(true);
  });

  it('行级 remove：按 id 删除并进入变更追踪', async () => {
    view = await materializeAgentModuleSqlView_ACU(makeSnapshot());
    view.applyRowWrite({ module: 'hooks', expectedRevision: 3, removedIds: ['hook-2'] });
    const back = view.readSnapshot();
    expect(back.hooks.map(item => item.id)).toEqual(['hook-1']);
    const delta = view.exportDelta();
    expect(delta.removedIds?.hooks).toEqual(['hook-2']);
    expect(delta.revisions.hooks).toBe(4);
  });

  it('revision 冲突在 SQL 层拒绝且库内容不变（fail-closed）', async () => {
    view = await materializeAgentModuleSqlView_ACU(makeSnapshot());
    expect(() => view!.applyRowWrite({
      module: 'hooks',
      expectedRevision: 1,
      upserts: [{ id: 'hook-9', summary: '不该写入', status: 'planted', importance: 'low', plantedIndex: 0, updatedIndex: 0, plannedPayoff: '', retired: false, retiredReason: '' }],
    })).toThrow(AgentModuleSqlViewError_ACU);
    const back = view.readSnapshot();
    expect(back.hooks).toHaveLength(2);
    expect(back.revisions.hooks).toBe(3);
    expect(view.hasChanges()).toBe(false);
  });

  it('upsert 条目缺少合法 即拒绝', async () => {
    view = await materializeAgentModuleSqlView_ACU(makeSnapshot());
    expect(() => view!.applyRowWrite({ module: 'hooks', expectedRevision: 3, upserts: [{ summary: '无 id' }] })).toThrow(/缺少合法 id/);
    expect(view.hasChanges()).toBe(false);
  });

  it('物化含无 id 条目的快照即失败', async () => {
    const broken = makeSnapshot();
    (broken.hooks as unknown[]).push({ summary: '无 id 条目' });
    await expect(materializeAgentModuleSqlView_ACU(broken)).rejects.toThrow(/无法物化/);
  });


  it('变更导出：同 id 先删后写只剩 upsert，导出后清空追踪', async () => {
    view = await materializeAgentModuleSqlView_ACU(makeSnapshot());
    view.applyRowWrite({ module: 'hooks', expectedRevision: 3, removedIds: ['hook-2'] });
    view.applyRowWrite({
      module: 'hooks',
      expectedRevision: 4,
      upserts: [
        { id: 'hook-2', summary: '删后再建', status: 'planted', importance: 'low', plantedIndex: 4, updatedIndex: 13, plannedPayoff: '', retired: false, retiredReason: '' },
        { id: 'hook-4', summary: '全新条目', status: 'planted', importance: 'mid', plantedIndex: 13, updatedIndex: 13, plannedPayoff: '', retired: false, retiredReason: '' },
      ],
    });
    const delta = view.exportDelta();
    const upsertIds = (delta.writes.hooks ?? []).map(item => item.id);
    expect(upsertIds).toEqual(['hook-2', 'hook-4']);
    expect(delta.removedIds).toBeUndefined();
    expect(delta.revisions.hooks).toBe(5);
    expect(view.hasChanges()).toBe(false);
    const back = view.readSnapshot();
    expect(back.hooks.map(item => item.id)).toEqual(['hook-1', 'hook-2', 'hook-4']);
  });

  it('userRequirements 整表替换并导出为完整 writes', async () => {
    view = await materializeAgentModuleSqlView_ACU(makeSnapshot());
    view.applyRowWrite({ module: 'userRequirements', expectedRevision: 5, upserts: ['保持悬疑', '控制节奏'] });
    const back = view.readSnapshot();
    expect(back.userRequirements).toEqual(['保持悬疑', '控制节奏']);
    expect(back.revisions.userRequirements).toBe(6);
    const delta = view.exportDelta();
    expect(delta.writes.userRequirements).toEqual(['保持悬疑', '控制节奏']);
    expect(delta.revisions.userRequirements).toBe(6);
  });

  it('userRequirements 拒绝非 string 数组写集', async () => {
    view = await materializeAgentModuleSqlView_ACU(makeSnapshot());
    expect(() => view!.applyRowWrite({ module: 'userRequirements', expectedRevision: 5, upserts: [{ id: 'x' }] })).toThrow(/整表替换/);
    expect(view.hasChanges()).toBe(false);
  });
});

