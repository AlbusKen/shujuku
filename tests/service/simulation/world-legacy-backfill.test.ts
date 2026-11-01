import { describe, expect, it } from 'vitest';

import type { WorldChronicleArchiveSnapshot_ACU } from '../../../src/service/simulation/agent/agent-model';
import { buildEmptyWorldSimulationLedger_ACU } from '../../../src/service/simulation/defaults';
import { planWorldLegacyBackfill_ACU } from '../../../src/service/simulation/world-legacy-backfill';

function v6LikeLedger() {
  const ledger = buildEmptyWorldSimulationLedger_ACU();
  ledger.clock = { day: 5, slot: '', storyTime: '', precision: 'exact', evidenceRefs: [] };
  ledger.actors = [{
    id: 'actor-a', name: '甲', interests: [], location: '', locationRef: null, life: 'alive', diedAtDay: null, deathSummary: null,
    resources: [], goals: [], constraints: [], informationSources: [], knownFacts: ['保持原样'], visibility: 'hidden',
    currentAction: null, longTermAction: null, experiences: [{ text: '交付文书', expectedDuration: '', startedAtDay: null, startedAt: '', endedAtDay: 2, endedAt: '', status: 'done', outcome: null }], revision: 1,
  }];
  ledger.dimensions = [{ id: 'dimension-a', name: '北境压力', kind: 'pressure', value: 3, trend: 'rising', rationale: '旧依据', evidenceRefs: [], revision: 2 }];
  ledger.seeds = [{ id: 'seed-a', title: '庆典', status: 'active', level: 1, catalyst: '钟声', visibility: 'limited', actorIds: ['actor-a'], location: { region: '北境', place: '广场' }, expiresAtDay: null, missedOutcome: null, exposePolicy: 'on_collision', evidenceRefs: [], retiredReason: null, revision: 1 }];
  ledger.chronicle = [{ id: 'chronicle-a', at: '第2日', summary: '交付文书', relatedIds: ['actor-a'], evidenceRefs: ['evidence-a'], missedNote: '主角错过交付' }];
  ledger.chronicleOverview = [{ fingerprint: 'fp-a', day: 2, oneLine: '交付文书归档', archiveRef: 'archive-a' }];
  ledger.legacyMigration.issues = [
    { source: 'dimension', sourceId: 'dimension-a', reason: 'requires_review' },
    { source: 'seed', sourceId: 'seed-a', reason: 'requires_review' },
    { source: 'chronicle', sourceId: 'chronicle-a', reason: 'requires_review' },
    { source: 'chronicleArchive', sourceId: 'archive-a', reason: 'archive_detail_unavailable' },
    { source: 'rumor', sourceId: 'rumor-a', reason: 'missing_evidence' },
  ];
  return ledger;
}

function archive(): WorldChronicleArchiveSnapshot_ACU {
  return { schemaVersion: 1, records: {
    'archive-a': { archiveRef: 'archive-a', day: 2, summary: '交付文书归档详情', fingerprints: ['fp-a'], relatedIds: ['actor-a'], sourceChronicleIds: ['chronicle-a'] },
  } };
}

describe('v7 旧资料纯领域补迁', () => {
  it('追加缺失领域，保留 v7 资料与 knownFacts，且不修改输入', () => {
    const ledger = v6LikeLedger();
    const before = structuredClone(ledger);
    const archiveSnapshot = archive();
    const archiveBefore = structuredClone(archiveSnapshot);

    const result = planWorldLegacyBackfill_ACU(ledger, archiveSnapshot);

    expect(result.changed).toBe(true);
    expect(result.addedEventIds).toHaveLength(2);
    expect(result.addedFactIds).toHaveLength(1);
    expect(result.addedHistoryIds).toHaveLength(1);
    expect(result.ledger.actors[0].knownFacts).toEqual(['保持原样']);
    expect(result.ledger.worldEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ legacy: expect.objectContaining({ source: 'dimension', sourceId: 'dimension-a' }) }),
      expect.objectContaining({ legacy: expect.objectContaining({ source: 'seed', sourceId: 'seed-a' }) }),
    ]));
    expect(result.ledger.historyMilestones).toEqual(expect.arrayContaining([
      expect.objectContaining({ legacyRefs: expect.arrayContaining(['legacy:chronicle:chronicle-a', 'legacy:archive:archive-a']) }),
    ]));
    expect(result.remainingIssues).toEqual([{ source: 'rumor', sourceId: 'rumor-a', reason: 'missing_evidence' }]);
    expect(ledger).toEqual(before);
    expect(archiveSnapshot).toEqual(archiveBefore);
  });

  it('保留已演进的来源节点，重复执行不改变 revision', () => {
    const first = planWorldLegacyBackfill_ACU(v6LikeLedger(), archive());
    const evolved = structuredClone(first.ledger);
    const dimensionEvent = evolved.worldEvents.find(event => event.legacy?.sourceId === 'dimension-a')!;
    dimensionEvent.revision = 77;
    dimensionEvent.state = 'v7 已演进';
    const second = planWorldLegacyBackfill_ACU(evolved, archive());

    expect(second.changed).toBe(false);
    expect(second.ledger.revision).toBe(evolved.revision);
    expect(second.ledger.worldEvents.find(event => event.id === dimensionEvent.id)).toMatchObject({ revision: 77, state: 'v7 已演进' });
  });

  it('冷层中已映射的主来源保持幂等，且不把归档事实重新加入热层', () => {
    const first = planWorldLegacyBackfill_ACU(v6LikeLedger(), archive()).ledger;
    const coldFact = first.facts[0];
    const archived = { ...first, facts: [], factArchive: [coldFact] };

    const result = planWorldLegacyBackfill_ACU(archived, archive());

    expect(result.changed).toBe(false);
    expect(result.addedFactIds).toEqual([]);
    expect(result.ledger.facts).toEqual([]);
    expect(result.ledger.factArchive).toEqual([coldFact]);
  });

  it('同 ID 但来源不一致时拒绝而不覆盖既有事件', () => {
    const collisionId = planWorldLegacyBackfill_ACU(v6LikeLedger(), archive()).ledger.worldEvents
      .find(event => event.legacy?.sourceId === 'dimension-a')!.id;
    const ledger = v6LikeLedger();
    ledger.worldEvents = [{
      id: collisionId, title: '既有', state: '既有状态', status: 'active', actorIds: [], organizationIds: [], locationRefs: [],
      startedAt: null, deadline: null, nextCheck: null, relatedEventIds: [], loreRefs: [], evidenceRefs: [], tags: [], revision: 9,
      legacy: { source: 'dimension', sourceId: 'other-dimension' },
    }];
    expect(() => planWorldLegacyBackfill_ACU(ledger, archive())).toThrow(/worldEvent ID 冲突/);
  });

  it('仅为既有热历史补 archive 追溯时仍变更并递增 revision', () => {
    const withoutArchive = planWorldLegacyBackfill_ACU(v6LikeLedger(), { schemaVersion: 1, records: {} });
    const base = withoutArchive.ledger;
    const result = planWorldLegacyBackfill_ACU(base, archive());

    expect(result.addedHistoryIds).toEqual([]);
    expect(result.changed).toBe(true);
    expect(result.ledger.revision).toBe(base.revision + 1);
    expect(result.ledger.historyMilestones[0].legacyRefs).toContain('legacy:archive:archive-a');
  });

  it('多条归档来源仅在每个已有历史节点都可追溯时复用，并逐条补 archiveRef', () => {
    const ledger = v6LikeLedger();
    ledger.chronicle.push({ id: 'chronicle-b', at: '第2日', summary: '第二份交付', relatedIds: ['actor-a'], evidenceRefs: ['evidence-b'], missedNote: '主角错过第二份交付' });
    ledger.chronicleOverview = [{ fingerprint: 'fp-many', day: 2, oneLine: '合并归档', archiveRef: 'archive-many' }];
    ledger.legacyMigration.issues = [{ source: 'chronicleArchive', sourceId: 'archive-many', reason: 'archive_detail_unavailable' }];
    const archiveMany: WorldChronicleArchiveSnapshot_ACU = { schemaVersion: 1, records: {
      'archive-many': { archiveRef: 'archive-many', day: 2, summary: '合并归档详情', fingerprints: ['fp-many'], relatedIds: ['actor-a'], sourceChronicleIds: ['chronicle-a', 'chronicle-b'] },
    } };
    const prior = planWorldLegacyBackfill_ACU(ledger, { schemaVersion: 1, records: {} }).ledger;
    const result = planWorldLegacyBackfill_ACU(prior, archiveMany);

    expect(result.addedHistoryIds).toEqual([]);
    expect(result.ledger.historyMilestones.filter(history => history.legacyRefs.includes('legacy:archive:archive-many'))).toHaveLength(2);
  });

  it('将新历史关联重映射到已演进的不同 event ID', () => {
    const ledger = v6LikeLedger();
    ledger.worldEvents = [{
      id: 'evolved-dimension-a', title: '北境压力（演进）', state: '演进状态', status: 'active', actorIds: [], organizationIds: [], locationRefs: [],
      startedAt: null, deadline: null, nextCheck: null, relatedEventIds: [], loreRefs: [], evidenceRefs: [], tags: [], revision: 8,
      legacy: { source: 'dimension', sourceId: 'dimension-a' },
    }];
    ledger.chronicle[0].relatedIds = ['dimension-a'];
    const result = planWorldLegacyBackfill_ACU(ledger, archive());

    expect(result.ledger.historyMilestones.find(history => history.legacyRefs.includes('legacy:chronicle:chronicle-a'))?.worldEventIds)
      .toEqual(['evolved-dimension-a']);
  });

  it('跨 actor/event 同名来源保持 archive issue，不擅自选择关联对象', () => {
    const ledger = v6LikeLedger();
    ledger.dimensions[0].id = 'actor-a';
    ledger.chronicle[0].relatedIds = ['actor-a'];
    const result = planWorldLegacyBackfill_ACU(ledger, archive());

    expect(result.addedHistoryIds).toEqual([]);
    expect(result.remainingIssues).toContainEqual({ source: 'chronicleArchive', sourceId: 'archive-a', reason: 'archive_detail_unavailable' });
  });

  it('错配、缺源或无证据的冷归档不生成历史且保留对应 issue', () => {
    const ledger = v6LikeLedger();
    ledger.chronicle[0].evidenceRefs = [];
    const invalid = archive();
    invalid.records['archive-a'].day = 3;
    const result = planWorldLegacyBackfill_ACU(ledger, invalid);
    expect(result.addedHistoryIds).toEqual([]);
    expect(result.remainingIssues).toContainEqual({ source: 'chronicleArchive', sourceId: 'archive-a', reason: 'archive_detail_unavailable' });
  });
});
