/**
 * tests/service/simulation/simulation-ledger-sql-view.test.ts
 * 推演账本 SQL 易失视图：物化、数组模块行级 upsert/remove、单行替换、revision 冲突、
 * 编年归档按 archiveRef 行级写与 fail-closed。
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  materializeWorldSimulationLedgerSqlView_ACU,
  WorldSimulationSqlViewError_ACU,
  type WorldSimulationLedgerSqlView_ACU,
} from '../../../src/service/simulation/simulation-ledger-sql-view';
import {
  WORLD_LEDGER_SCHEMA_VERSION_ACU,
  type WorldSimulationLedger_ACU,
} from '../../../src/service/simulation/model';
import {
  WORLD_SIMULATION_CHRONICLE_ARCHIVE_SCHEMA_VERSION_ACU,
  type WorldChronicleArchiveSnapshot_ACU,
} from '../../../src/service/simulation/agent/agent-model';

function makeLedger(): WorldSimulationLedger_ACU {
  return {
    schemaVersion: WORLD_LEDGER_SCHEMA_VERSION_ACU,
    revision: 7,
    clock: { day: 3, slot: 'morning', storyTime: '第三日清晨', precision: 'exact', evidenceRefs: ['m1'] },
    dimensions: [
      { id: 'dim-1', name: '王国局势', kind: 'politics', value: '紧张', trend: 'rising', rationale: '边境冲突', evidenceRefs: ['m1'], revision: 1 },
    ],
    seeds: [
      { id: 'seed-1', title: '失踪的商队', status: 'active', level: 2, catalyst: '商队未归', visibility: 'public', actorIds: ['a1'], location: '北境', expiresAtDay: null, missedOutcome: '', exposePolicy: 'auto', evidenceRefs: ['m1'], retiredReason: '', revision: 1 },
    ],
    actors: [
      { id: 'a1', name: '商人会长', interests: '贸易利益', location: '王都', locationRef: '', life: 'alive', diedAtDay: null, deathSummary: '', resources: '商队', goals: '保住商路', constraints: '', informationSources: ['商队汇报'], knownFacts: ['商队失踪'], visibility: 'public', revision: 1 },
    ],
    chronicle: [
      { id: 'ch-1', at: 3, summary: '商队逾期未归', relatedIds: ['seed-1'], evidenceRefs: ['m1'] },
    ],
    rumors: [
      { id: 'rum-1', fact: '商队被山贼劫了', originDay: 3, earliestRevealDay: 4, channels: ['酒馆'], relatedActorIds: ['a1'], status: 'active', revealedAtDay: null, revision: 1 },
    ],
    player: { location: { region: '北境' }, regionVisits: {}, contact: { companionActorId: null }, locationUpdatedAtDay: 3, evidenceRefs: ['m1'] },
    guidance: { signals: [{ sourceId: 'ch-1', text: '追查商队下落', voice: 'narrator' }], excludedFacts: [], evidenceRefs: ['m1'] },
    chronicleOverview: [
      { archiveRef: 'A-1', day: 2, fingerprint: 'fp-1', oneLine: '次日记录' },
    ],
    materialCompletion: { state: 'complete_changed', rangeStartDay: 1, rangeEndDay: 3, modules: {}, updatedAt: 900 },
    pendingFixes: [],
  } as unknown as WorldSimulationLedger_ACU;
}

function makeArchive(): WorldChronicleArchiveSnapshot_ACU {
  return {
    schemaVersion: WORLD_SIMULATION_CHRONICLE_ARCHIVE_SCHEMA_VERSION_ACU,
    records: {
      'A-1': { archiveRef: 'A-1', day: 2, summary: '次日归档', fingerprints: ['fp-1'], relatedIds: [], sourceChronicleIds: ['ch-0'] },
    },
  };
}

describe('simulation-ledger-sql-view', () => {
  let view: WorldSimulationLedgerSqlView_ACU | null = null;
  afterEach(() => { view?.dispose(); view = null; });

  it('物化账本与归档：条目、revision 与标量字段完整进库', async () => {
    view = await materializeWorldSimulationLedgerSqlView_ACU(makeLedger(), makeArchive());
    const back = view.readLedger();
    expect(back.dimensions.map(item => item.id)).toEqual(['dim-1']);
    expect(back.actors.map(item => item.id)).toEqual(['a1']);
    expect(back.chronicleOverview.map(item => item.archiveRef)).toEqual(['A-1']);
    expect(back.clock.day).toBe(3);
    expect(back.revision).toBe(7);
    expect(view.hasChanges()).toBe(false);
  });


  it('数组模块行级 upsert/remove 并推进账本 revision', async () => {
    view = await materializeWorldSimulationLedgerSqlView_ACU(makeLedger());
    const next = view.applyArrayWrite({
      module: 'actors',
      expectedRevision: 7,
      upserts: [
        { id: 'a1', name: '商人会长（更新）', interests: '贸易利益', location: '北境', life: 'alive', goals: '找回商队', informationSources: ['山贼口供'], knownFacts: ['商队被劫'], visibility: 'public', revision: 2 },
        { id: 'a2', name: '山贼头目', interests: '赎金', location: '山寨', life: 'alive', goals: '销赃', informationSources: [], knownFacts: [], visibility: 'hidden', revision: 1 },
      ],
    });
    expect(next).toBe(8);
    view.applyArrayWrite({ module: 'rumors', expectedRevision: 8, removedIds: ['rum-1'] });
    const back = view.readLedger();
    expect(back.actors.map(item => item.id)).toEqual(['a1', 'a2']);
    expect(back.rumors).toEqual([]);
    expect(back.revision).toBe(9);
    expect(view.hasChanges()).toBe(true);
  });

  it('revision 冲突在 SQL 层拒绝且库内容不变（fail-closed）', async () => {
    view = await materializeWorldSimulationLedgerSqlView_ACU(makeLedger());
    expect(() => view!.applyArrayWrite({
      module: 'seeds',
      expectedRevision: 1,
      upserts: [{ id: 'seed-9', title: '不该写入' }],
    })).toThrow(WorldSimulationSqlViewError_ACU);
    const back = view.readLedger();
    expect(back.seeds.map(item => item.id)).toEqual(['seed-1']);
    expect(back.revision).toBe(7);
    expect(view.hasChanges()).toBe(false);
  });

  it('clock/player/guidance 单行替换并导出进 delta', async () => {
    view = await materializeWorldSimulationLedgerSqlView_ACU(makeLedger());
    view.applySingletonWrite({
      module: 'clock',
      expectedRevision: 7,
      value: { day: 4, slot: 'dusk', storyTime: '第四日黄昏', precision: 'exact', evidenceRefs: ['m2'] },
    });
    const back = view.readLedger();
    expect(back.clock.day).toBe(4);
    expect(back.revision).toBe(8);
    const delta = view.exportDelta();
    expect(delta.clock?.day).toBe(4);
    expect(delta.player).toBeUndefined();
    expect(delta.revision).toBe(8);
    expect(view.hasChanges()).toBe(false);
  });

  it('变更导出：同 id 先删后写只剩 upsert，导出后清空追踪', async () => {
    view = await materializeWorldSimulationLedgerSqlView_ACU(makeLedger());
    view.applyArrayWrite({ module: 'dimensions', expectedRevision: 7, removedIds: ['dim-1'] });
    view.applyArrayWrite({
      module: 'dimensions',
      expectedRevision: 8,
      upserts: [
        { id: 'dim-1', name: '王国局势（重建）', kind: 'politics', value: '开战', trend: 'rising', rationale: '谈判破裂', evidenceRefs: ['m2'], revision: 2 },
      ],
    });
    const delta = view.exportDelta();
    expect(delta.upserts.dimensions?.map(item => item.id)).toEqual(['dim-1']);
    expect(delta.removedIds.dimensions).toBeUndefined();
    expect(delta.revision).toBe(9);
    const back = view.readLedger();
    expect(back.dimensions.map(item => item.id)).toEqual(['dim-1']);
  });

  it('归档按 archiveRef 行级 upsert/remove，导出仅含最终 upsert', async () => {
    view = await materializeWorldSimulationLedgerSqlView_ACU(makeLedger(), makeArchive());
    view.applyArchiveWrite({
      upserts: [
        { archiveRef: 'A-1', day: 2, summary: '次日归档（改写）', fingerprints: ['fp-1'], relatedIds: [], sourceChronicleIds: ['ch-0'] },
        { archiveRef: 'A-2', day: 3, summary: '第三日归档', fingerprints: ['fp-2'], relatedIds: ['seed-1'], sourceChronicleIds: ['ch-1'] },
      ],
    });
    view.applyArchiveWrite({ removedRefs: ['A-2'] });
    const records = view.exportArchiveRecords();
    expect(Object.keys(records)).toEqual(['A-1']);
    expect(records['A-1'].summary).toBe('次日归档（改写）');
    expect(view.hasChanges()).toBe(false);
  });

  it('归档 upsert 缺少 archiveRef 即拒绝', async () => {
    view = await materializeWorldSimulationLedgerSqlView_ACU(makeLedger(), makeArchive());
    expect(() => view!.applyArchiveWrite({ upserts: [{ day: 4, summary: '无 ref' } as never] })).toThrow(/archiveRef/);
    expect(view.hasChanges()).toBe(false);
  });

  it('物化含无主键条目的账本即失败', async () => {
    const broken = makeLedger();
    (broken.actors as unknown[]).push({ name: '无 id 角色' });
    await expect(materializeWorldSimulationLedgerSqlView_ACU(broken)).rejects.toThrow(/无法物化/);
  });
});

describe('simulation-ledger-sql-view 逐栏层', () => {
  let view: WorldSimulationLedgerSqlView_ACU | null = null;
  afterEach(() => { view?.dispose(); view = null; });

  function fullActor(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id, name: '新角色', interests: ['打铁'], location: '北岭', locationRef: null, life: 'alive',
      diedAtDay: null, deathSummary: null, resources: [], goals: ['活下去'], constraints: [],
      informationSources: ['村民'], knownFacts: ['山路'], visibility: 'public', revision: 1,
      ...overrides,
    };
  }

  it('未提供分栏视图时按领域条目播种：数组条目与单例均 legacy_unknown、栏目 revision 0', async () => {
    view = await materializeWorldSimulationLedgerSqlView_ACU(makeLedger());
    const actor = view.readFieldRecord('actors', 'a1');
    expect(actor?.status).toBe('legacy_unknown');
    expect(actor?.fields.name).toEqual({ value: '商人会长', revision: 0, updatedAt: 0 });
    const clock = view.readFieldRecord('clock', '_');
    expect(clock?.status).toBe('legacy_unknown');
    expect(clock?.fields.day).toEqual({ value: 3, revision: 0, updatedAt: 0 });
  });

  it('数组模块单栏更新已登记条目：账本 revision 推进一次，领域行与分栏层同步并导出', async () => {
    view = await materializeWorldSimulationLedgerSqlView_ACU(makeLedger());
    const merged = { id: 'a1', name: '商人会长', interests: '贸易利益', location: '北境', locationRef: '', life: 'alive', diedAtDay: null, deathSummary: '', resources: '商队', goals: '找回商队', constraints: '', informationSources: ['商队汇报'], knownFacts: ['商队失踪'], visibility: 'public', revision: 2 };
    const next = view.applyFieldBatch({
      module: 'actors',
      expectedRevision: 7,
      updatedAt: 2000,
      fieldWrites: { a1: { location: { value: '北境' }, goals: { value: '找回商队' } } },
      domainUpserts: { a1: merged },
    });
    expect(next).toBe(8);
    const record = view.readFieldRecord('actors', 'a1');
    expect(record?.status).toBe('complete');
    expect(record?.fields.location).toEqual({ value: '北境', revision: 1, updatedAt: 2000 });
    expect(record?.fields.goals).toEqual({ value: '找回商队', revision: 1, updatedAt: 2000 });
    expect(record?.fields.name.revision).toBe(0);
    expect(record?.fields.revision.value).toBe(2);
    const delta = view.exportDelta();
    expect(delta.upserts.actors).toEqual([merged]);
    expect(delta.fieldUpserts?.actors?.a1).toEqual({ location: { value: '北境' }, goals: { value: '找回商队' } });
    expect(delta.revision).toBe(8);
    expect(view.hasChanges()).toBe(false);
  });

  it('纯草稿批次不推进账本 revision，partial 草稿随 fieldUpserts 导出', async () => {
    view = await materializeWorldSimulationLedgerSqlView_ACU(makeLedger());
    const next = view.applyFieldBatch({
      module: 'actors',
      expectedRevision: 7,
      updatedAt: 2000,
      fieldWrites: { a9: { name: { value: '新角色' }, interests: { value: ['打铁'] } } },
    });
    expect(next).toBe(7);
    expect(view.readLedger().revision).toBe(7);
    const record = view.readFieldRecord('actors', 'a9');
    expect(record?.status).toBe('partial');
    expect(record?.missingFields).toEqual(['location', 'goals', 'informationSources', 'knownFacts']);
    expect(view.readLedger().actors.map(item => item.id)).toEqual(['a1']);
    const delta = view.exportDelta();
    expect(delta.revision).toBe(7);
    expect(delta.upserts.actors).toBeUndefined();
    expect(delta.fieldUpserts?.actors?.a9).toEqual({ name: { value: '新角色' }, interests: { value: ['打铁'] } });
  });

  it('必填栏补齐并给出领域整行后提升为 complete，账本 revision 此时才推进', async () => {
    view = await materializeWorldSimulationLedgerSqlView_ACU(makeLedger());
    view.applyFieldBatch({
      module: 'actors',
      expectedRevision: 7,
      updatedAt: 2000,
      fieldWrites: { a9: { name: { value: '新角色' }, interests: { value: ['打铁'] } } },
    });
    const promoted = fullActor('a9');
    const next = view.applyFieldBatch({
      module: 'actors',
      expectedRevision: 7,
      updatedAt: 2100,
      fieldWrites: {
        a9: {
          location: { value: '北岭' },
          goals: { value: ['活下去'] },
          informationSources: { value: ['村民'] },
          knownFacts: { value: ['山路'] },
        },
      },
      domainUpserts: { a9: promoted },
    });
    expect(next).toBe(8);
    const record = view.readFieldRecord('actors', 'a9');
    expect(record?.status).toBe('complete');
    expect(record?.missingFields).toEqual([]);
    expect(record?.fields.name).toEqual({ value: '新角色', revision: 1, updatedAt: 2000 });
    expect(record?.fields.location).toEqual({ value: '北岭', revision: 1, updatedAt: 2100 });
    expect(record?.fields.life).toEqual({ value: 'alive', revision: 1, updatedAt: 2100 });
    expect(view.readPartialRecords()).toEqual([]);
    expect(view.readLedger().actors.map(item => item.id)).toEqual(['a1', 'a9']);
    const delta = view.exportDelta();
    expect(delta.revision).toBe(8);
    expect(delta.upserts.actors).toEqual([promoted]);
    expect(delta.fieldUpserts?.actors?.a9).toEqual({
      name: { value: '新角色' },
      interests: { value: ['打铁'] },
      location: { value: '北岭' },
      goals: { value: ['活下去'] },
      informationSources: { value: ['村民'] },
      knownFacts: { value: ['山路'] },
    });
  });

  it('单例 clock 逐栏更新：固定 ID 归一、领域替换与导出', async () => {
    view = await materializeWorldSimulationLedgerSqlView_ACU(makeLedger());
    const clock4 = { day: 4, slot: 'dusk', storyTime: '第四日黄昏', precision: 'exact', evidenceRefs: ['m2'] };
    const next = view.applyFieldBatch({
      module: 'clock',
      expectedRevision: 7,
      updatedAt: 2000,
      fieldWrites: { '_': { day: { value: 4 }, storyTime: { value: '第四日黄昏' }, slot: { value: 'dusk' }, evidenceRefs: { value: ['m2'] } } },
      domainUpserts: { '_': clock4 },
    });
    expect(next).toBe(8);
    const record = view.readFieldRecord('clock', '任意输入归一');
    expect(record?.status).toBe('complete');
    expect(record?.fields.day).toEqual({ value: 4, revision: 1, updatedAt: 2000 });
    const delta = view.exportDelta();
    expect(delta.clock?.day).toBe(4);
    expect(delta.fieldUpserts?.clock?._).toEqual({
      day: { value: 4 },
      storyTime: { value: '第四日黄昏' },
      slot: { value: 'dusk' },
      evidenceRefs: { value: ['m2'] },
    });
    expect(delta.revision).toBe(8);
  });

  it('丢弃草稿：记录删除并导出全栏 unset，账本 revision 不推进', async () => {
    view = await materializeWorldSimulationLedgerSqlView_ACU(makeLedger());
    view.applyFieldBatch({
      module: 'actors',
      expectedRevision: 7,
      updatedAt: 2000,
      fieldWrites: { a9: { name: { value: '新角色' } } },
    });
    const next = view.applyFieldBatch({
      module: 'actors',
      expectedRevision: 7,
      updatedAt: 2100,
      discardPartialIds: ['a9'],
    });
    expect(next).toBe(7);
    expect(view.readFieldRecord('actors', 'a9')).toBeNull();
    const delta = view.exportDelta();
    expect(delta.revision).toBe(7);
    expect(delta.fieldUpserts?.actors?.a9).toEqual({ name: { unset: true } });
  });

  it('完整条目按草稿丢弃、撤销完整条目栏目、矩阵外模块、空批次、陈旧 revision 均 fail-closed', async () => {
    view = await materializeWorldSimulationLedgerSqlView_ACU(makeLedger());
    expect(() => view!.applyFieldBatch({ module: 'actors', expectedRevision: 7, updatedAt: 2000, discardPartialIds: ['a1'] })).toThrow(/完整条目/);
    expect(() => view!.applyFieldBatch({ module: 'actors', expectedRevision: 7, updatedAt: 2000, fieldWrites: { a1: { name: { unset: true } } } })).toThrow(/不能按草稿撤销/);
    expect(() => view!.applyFieldBatch({ module: 'chronicleOverview', expectedRevision: 7, updatedAt: 2000, fieldWrites: { x: { oneLine: { value: 'x' } } } })).toThrow(/未知账本栏目模块/);
    expect(() => view!.applyFieldBatch({ module: 'actors', expectedRevision: 7, updatedAt: 2000 })).toThrow(/批次为空/);
    expect(() => view!.applyFieldBatch({ module: 'actors', expectedRevision: 99, updatedAt: 2000, fieldWrites: { a1: { name: { value: 'x' } } } })).toThrow(/revision 冲突/);
    const back = view.readLedger();
    expect(back.actors).toHaveLength(1);
    expect(back.revision).toBe(7);
    expect(view.hasChanges()).toBe(false);
    expect(view.readFieldRecord('actors', 'a1')?.status).toBe('legacy_unknown');
  });

  it('行写同步分栏层：upsert 记为 legacy_unknown，remove 删除记录', async () => {
    view = await materializeWorldSimulationLedgerSqlView_ACU(makeLedger());
    view.applyArrayWrite({
      module: 'actors',
      expectedRevision: 7,
      upserts: [fullActor('a2', { name: '山贼头目' })],
    });
    const inserted = view.readFieldRecord('actors', 'a2');
    expect(inserted?.status).toBe('legacy_unknown');
    expect(inserted?.fields.name).toEqual({ value: '山贼头目', revision: 1, updatedAt: 0 });
    view.applyArrayWrite({ module: 'actors', expectedRevision: 8, removedIds: ['a2'] });
    expect(view.readFieldRecord('actors', 'a2')).toBeNull();
    expect(view.readFieldRecord('actors', 'a1')?.status).toBe('legacy_unknown');
  });
});

describe('simulation-ledger-sql-view 批次复算边界', () => {
  let view: WorldSimulationLedgerSqlView_ACU | null = null;
  afterEach(() => { view?.dispose(); view = null; });

  it('跨模块合批只推进一次 revision，其余批次用当前 revision 作为乐观锁', async () => {
    view = await materializeWorldSimulationLedgerSqlView_ACU(makeLedger());
    view.applyFieldBatch({ module: 'dimensions', expectedRevision: 7, updatedAt: 123, fieldWrites: { 'dim-1': { value: { value: '加剧' } } }, domainUpserts: { 'dim-1': { ...makeLedger().dimensions[0], value: '加剧', revision: 2 } }, advanceRevision: true });
    view.applyFieldBatch({ module: 'actors', expectedRevision: 8, updatedAt: 123, fieldWrites: { a1: { name: { value: '新会长' } } }, domainUpserts: { a1: { ...makeLedger().actors[0], name: '新会长', revision: 2 } }, advanceRevision: false });
    expect(view.readLedger().revision).toBe(8);
    expect(view.exportDelta()).toMatchObject({ revision: 8, upserts: { dimensions: [{ value: '加剧' }], actors: [{ name: '新会长' }] } });
  });

  it('删除完整条目清理其栏目记录且导出删除 ID', async () => {
    view = await materializeWorldSimulationLedgerSqlView_ACU(makeLedger());
    view.applyFieldBatch({ module: 'actors', expectedRevision: 7, updatedAt: 123, domainRemovedIds: ['a1'] });
    expect(view.readFieldRecord('actors', 'a1')).toBeNull();
    expect(view.exportDelta()).toMatchObject({ revision: 8, removedIds: { actors: ['a1'] } });
  });
});
