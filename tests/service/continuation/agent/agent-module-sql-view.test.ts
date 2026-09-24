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
  type AgentModuleFieldSnapshot_ACU,
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

describe('agent-module-sql-view 逐栏层', () => {
  let view: AgentModuleSqlView_ACU | null = null;
  afterEach(() => { view?.dispose(); view = null; });

  function partialFields(): AgentModuleFieldSnapshot_ACU {
    return {
      records: {
        hooks: {
          'hook-1': { module: 'hooks', id: 'hook-1', status: 'legacy_unknown', fields: { summary: { value: '旧伏笔', revision: 0, updatedAt: 1000 } }, missingFields: [], updatedAt: 1000 },
          P2: { module: 'hooks', id: 'P2', status: 'partial', fields: { summary: { value: '草稿伏笔', revision: 2, updatedAt: 1100 } }, missingFields: ['status', 'importance', 'plantedIndex', 'plannedPayoff'], updatedAt: 1100 },
        },
      },
    };
  }

  it('物化分栏视图：partial 草稿与领域记录按原状态进库', async () => {
    view = await materializeAgentModuleSqlView_ACU(makeSnapshot(), partialFields());
    const legacy = view.readFieldRecord('hooks', 'hook-1');
    expect(legacy?.status).toBe('legacy_unknown');
    expect(legacy?.fields.summary).toEqual({ value: '旧伏笔', revision: 0, updatedAt: 1000 });
    const draft = view.readFieldRecord('hooks', 'P2');
    expect(draft?.status).toBe('partial');
    expect(draft?.fields.summary).toEqual({ value: '草稿伏笔', revision: 2, updatedAt: 1100 });
    expect(draft?.missingFields).toEqual(['status', 'importance', 'plantedIndex', 'plannedPayoff']);
    expect(view.readPartialRecords().map(record => record.id)).toEqual(['P2']);
    expect(view.hasChanges()).toBe(false);
  });

  it('未提供分栏视图时按领域条目播种：legacy_unknown、栏目 revision 0', async () => {
    view = await materializeAgentModuleSqlView_ACU(makeSnapshot());
    const record = view.readFieldRecord('hooks', 'hook-1');
    expect(record?.status).toBe('legacy_unknown');
    expect(record?.fields.summary).toEqual({ value: '旧伏笔', revision: 0, updatedAt: 1000 });
    expect(record?.fields.updatedIndex.value).toBe(2);
    const singleton = view.readFieldRecord('userRequirements', '_');
    expect(singleton?.status).toBe('legacy_unknown');
    expect(singleton?.fields.value.value).toEqual(['保持悬疑']);
  });

  it('单栏更新已登记条目：一批一次 revision 推进，领域行与分栏层同步并导出', async () => {
    view = await materializeAgentModuleSqlView_ACU(makeSnapshot());
    const merged = { id: 'hook-1', summary: '旧伏笔（已更新）', status: 'planted', importance: 'high', plantedIndex: 2, updatedIndex: 12, plannedPayoff: '后期兑现', retired: false, retiredReason: '' };
    const next = view.applyFieldBatch({
      module: 'hooks',
      expectedRevision: 3,
      updatedAt: 2000,
      fieldWrites: { 'hook-1': { summary: { value: '旧伏笔（已更新）' } } },
      domainUpserts: { 'hook-1': merged },
    });
    expect(next).toBe(4);
    const record = view.readFieldRecord('hooks', 'hook-1');
    expect(record?.status).toBe('complete');
    expect(record?.fields.summary).toEqual({ value: '旧伏笔（已更新）', revision: 1, updatedAt: 2000 });
    expect(record?.fields.updatedIndex).toEqual({ value: 12, revision: 1, updatedAt: 2000 });
    expect(record?.fields.importance.revision).toBe(0);
    expect(view.readSnapshot().revisions.infoGap).toBe(2);
    const delta = view.exportDelta();
    expect(delta.writes.hooks).toEqual([merged]);
    expect(delta.fieldUpserts?.hooks?.['hook-1']).toEqual({ summary: { value: '旧伏笔（已更新）' } });
    expect(delta.revisions.hooks).toBe(4);
    expect(view.hasChanges()).toBe(false);
  });

  it('值未变的逐栏写入不推进栏目 revision，但被点名条目的血统与模块 revision 可回放', async () => {
    view = await materializeAgentModuleSqlView_ACU(makeSnapshot());
    const next = view.applyFieldBatch({
      module: 'hooks',
      expectedRevision: 3,
      updatedAt: 2000,
      fieldWrites: { 'hook-1': { summary: { value: '旧伏笔' } } },
    });
    expect(next).toBe(4);
    const record = view.readFieldRecord('hooks', 'hook-1');
    expect(record?.status).toBe('complete');
    expect(record?.fields.summary.revision).toBe(0);
    const delta = view.exportDelta();
    expect(delta.writes.hooks).toBeUndefined();
    expect(delta.fieldUpserts?.hooks?.['hook-1']).toEqual({ summary: { value: '旧伏笔' } });
    expect(delta.revisions.hooks).toBe(4);
    expect(view.readSnapshot().revisions.hooks).toBe(4);
  });

  it('新 ID 只写部分栏：存为 partial 草稿、不进领域数组，revision 随 fieldUpserts 导出', async () => {
    view = await materializeAgentModuleSqlView_ACU(makeSnapshot());
    const next = view.applyFieldBatch({
      module: 'hooks',
      expectedRevision: 3,
      updatedAt: 2000,
      fieldWrites: { P9: { summary: { value: '伏笔 P9' }, status: { value: 'planted' } } },
    });
    expect(next).toBe(4);
    const record = view.readFieldRecord('hooks', 'P9');
    expect(record?.status).toBe('partial');
    expect(record?.missingFields).toEqual(['importance', 'plantedIndex', 'plannedPayoff']);
    expect(view.readPartialRecords('hooks').map(item => item.id)).toEqual(['P9']);
    expect(view.readSnapshot().hooks.map(item => item.id)).toEqual(['hook-1', 'hook-2']);
    const delta = view.exportDelta();
    expect(delta.writes.hooks).toBeUndefined();
    expect(delta.fieldUpserts?.hooks?.P9).toEqual({ summary: { value: '伏笔 P9' }, status: { value: 'planted' } });
    expect(delta.revisions.hooks).toBe(4);
    expect(view.readSnapshot().revisions.hooks).toBe(4);
  });

  it('必填栏补齐并给出领域整行后提升为 complete，既有栏目 revision 保持', async () => {
    view = await materializeAgentModuleSqlView_ACU(makeSnapshot());
    view.applyFieldBatch({
      module: 'hooks',
      expectedRevision: 3,
      updatedAt: 2000,
      fieldWrites: { P9: { summary: { value: '伏笔 P9' }, status: { value: 'planted' } } },
    });
    const promoted = { id: 'P9', summary: '伏笔 P9', status: 'planted', importance: 'high', plantedIndex: 5, updatedIndex: 12, plannedPayoff: '揭晓', retired: false, retiredReason: '' };
    const next = view.applyFieldBatch({
      module: 'hooks',
      expectedRevision: 4,
      updatedAt: 2100,
      fieldWrites: { P9: { importance: { value: 'high' }, plantedIndex: { value: 5 }, plannedPayoff: { value: '揭晓' } } },
      domainUpserts: { P9: promoted },
    });
    expect(next).toBe(5);
    const record = view.readFieldRecord('hooks', 'P9');
    expect(record?.status).toBe('complete');
    expect(record?.missingFields).toEqual([]);
    expect(record?.fields.summary).toEqual({ value: '伏笔 P9', revision: 1, updatedAt: 2000 });
    expect(record?.fields.importance).toEqual({ value: 'high', revision: 1, updatedAt: 2100 });
    expect(record?.fields.updatedIndex).toEqual({ value: 12, revision: 1, updatedAt: 2100 });
    expect(view.readPartialRecords()).toEqual([]);
    expect(view.readSnapshot().hooks.map(item => item.id)).toEqual(['hook-1', 'hook-2', 'P9']);
    const delta = view.exportDelta();
    expect(delta.writes.hooks).toEqual([promoted]);
    expect(delta.fieldUpserts?.hooks?.P9).toEqual({
      summary: { value: '伏笔 P9' },
      status: { value: 'planted' },
      importance: { value: 'high' },
      plantedIndex: { value: 5 },
      plannedPayoff: { value: '揭晓' },
    });
    expect(delta.revisions.hooks).toBe(5);
  });

  it('丢弃草稿：记录删除并导出全栏 unset', async () => {
    view = await materializeAgentModuleSqlView_ACU(makeSnapshot());
    view.applyFieldBatch({
      module: 'hooks',
      expectedRevision: 3,
      updatedAt: 2000,
      fieldWrites: { P9: { summary: { value: '伏笔 P9' }, status: { value: 'planted' } } },
    });
    const next = view.applyFieldBatch({
      module: 'hooks',
      expectedRevision: 4,
      updatedAt: 2100,
      discardPartialIds: ['P9'],
    });
    expect(next).toBe(5);
    expect(view.readFieldRecord('hooks', 'P9')).toBeNull();
    const delta = view.exportDelta();
    expect(delta.fieldUpserts?.hooks?.P9).toEqual({ summary: { unset: true }, status: { unset: true } });
    expect(delta.revisions.hooks).toBe(5);
  });

  it('完整条目按草稿丢弃、撤销完整条目栏目、矩阵外栏目、空批次、陈旧 revision 均 fail-closed', async () => {
    view = await materializeAgentModuleSqlView_ACU(makeSnapshot());
    expect(() => view!.applyFieldBatch({ module: 'hooks', expectedRevision: 3, updatedAt: 2000, discardPartialIds: ['hook-1'] })).toThrow(/完整条目/);
    expect(() => view!.applyFieldBatch({ module: 'hooks', expectedRevision: 3, updatedAt: 2000, fieldWrites: { 'hook-1': { summary: { unset: true } } } })).toThrow(/不能按草稿撤销/);
    expect(() => view!.applyFieldBatch({ module: 'hooks', expectedRevision: 3, updatedAt: 2000, fieldWrites: { 'hook-1': { bogus: { value: 1 } } } })).toThrow(/不在栏目矩阵/);
    expect(() => view!.applyFieldBatch({ module: 'hooks', expectedRevision: 3, updatedAt: 2000 })).toThrow(/批次为空/);
    expect(() => view!.applyFieldBatch({ module: 'hooks', expectedRevision: 99, updatedAt: 2000, fieldWrites: { 'hook-1': { summary: { value: 'x' } } } })).toThrow(/revision 冲突/);
    const back = view.readSnapshot();
    expect(back.hooks).toHaveLength(2);
    expect(back.revisions.hooks).toBe(3);
    expect(view.hasChanges()).toBe(false);
    expect(view.readFieldRecord('hooks', 'hook-1')?.status).toBe('legacy_unknown');
  });

  it('userRequirements 整表单例：逐栏提交与领域整表同步', async () => {
    view = await materializeAgentModuleSqlView_ACU(makeSnapshot());
    const lines = ['保持悬疑', '控制节奏'];
    const next = view.applyFieldBatch({
      module: 'userRequirements',
      expectedRevision: 5,
      updatedAt: 2000,
      fieldWrites: { _: { value: { value: lines } } },
      domainUpserts: { _: lines },
    });
    expect(next).toBe(6);
    expect(view.readSnapshot().userRequirements).toEqual(lines);
    const record = view.readFieldRecord('userRequirements', '_');
    expect(record?.status).toBe('complete');
    expect(record?.fields.value).toEqual({ value: lines, revision: 1, updatedAt: 2000 });
    const delta = view.exportDelta();
    expect(delta.writes.userRequirements).toEqual(lines);
    expect(delta.fieldUpserts?.userRequirements?._).toEqual({ value: { value: lines } });
    expect(delta.revisions.userRequirements).toBe(6);
  });

  it('行写同步分栏层：upsert 记为 legacy_unknown，remove 删除记录但保留 partial 草稿', async () => {
    view = await materializeAgentModuleSqlView_ACU(makeSnapshot());
    view.applyFieldBatch({
      module: 'hooks',
      expectedRevision: 3,
      updatedAt: 2000,
      fieldWrites: { P9: { summary: { value: '伏笔 P9' } } },
    });
    view.applyRowWrite({
      module: 'hooks',
      expectedRevision: 4,
      upserts: [{ id: 'hook-3', summary: '行写新增', status: 'planted', importance: 'low', plantedIndex: 6, updatedIndex: 6, plannedPayoff: '', retired: false, retiredReason: '' }],
    });
    const inserted = view.readFieldRecord('hooks', 'hook-3');
    expect(inserted?.status).toBe('legacy_unknown');
    expect(inserted?.fields.summary).toEqual({ value: '行写新增', revision: 1, updatedAt: 0 });
    view.applyRowWrite({ module: 'hooks', expectedRevision: 5, removedIds: ['hook-2', 'P9'] });
    expect(view.readFieldRecord('hooks', 'hook-2')).toBeNull();
    expect(view.readFieldRecord('hooks', 'P9')?.status).toBe('partial');
  });
});

