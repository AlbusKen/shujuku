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
