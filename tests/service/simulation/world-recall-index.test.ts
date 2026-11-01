import { describe, expect, it } from 'vitest';
import { buildEmptyWorldSimulationLedger_ACU } from '../../../src/service/simulation/defaults';
import { buildWorldRecallIndex_ACU, queryWorldRecallIndexPage_ACU, queryWorldRecallManifestPage_ACU } from '../../../src/service/simulation/world-recall-index';
import { buildWorldRecallManifestPages_ACU } from '../../../src/service/simulation/world-recall-manifest';
import { validateWorldSimulationLedger_ACU } from '../../../src/service/simulation/simulation-store';
import { prepareWorldExecutionRecall_ACU, readWorldExecutionRecall_ACU } from '../../../src/service/simulation/world-execution-recall';
import type { WorldActor_ACU, WorldFact_ACU, WorldHistoryMilestone_ACU, WorldEvent_ACU } from '../../../src/service/simulation/model';

function actor(id: string, status: 'active' | 'archived' = 'active'): WorldActor_ACU {
  return { id, name: id, interests: [], location: '', locationRef: null, life: 'alive', diedAtDay: null,
    deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [], knownFacts: [],
    visibility: 'hidden', currentAction: null, longTermAction: null, shortTermAction: null,
    simulationStatus: status, loreRefs: [], experiences: [], revision: 1 };
}
function fact(id: string): WorldFact_ACU {
  return { id, summary: `内部事实全文${id}`, temporalKind: 'occurrence', happenedAt: { day: 1, slot: '' },
    validFrom: null, validUntil: null, locationRef: null, actorIds: [], worldEventIds: [],
    projectionPolicy: 'gated', revealState: 'locked', revealGate: { semanticCondition: '主动接触' },
    nextCheck: { day: 2, slot: '', reason: '复查' }, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 };
}
function event(id: string): WorldEvent_ACU {
  return { id, title: id, state: '进行中', status: 'active', actorIds: [], organizationIds: [],
    locationRefs: [], startedAt: null, deadline: null, nextCheck: { day: 2, slot: '', reason: '复查' },
    relatedEventIds: [], loreRefs: [], evidenceRefs: [], tags: [], revision: 1, legacy: null };
}
function milestone(id: string, day: number, actorId: string, location: string): WorldHistoryMilestone_ACU {
  return { id, summary: `历史全文${id}`, happenedAt: { day, slot: '' }, actorIds: [actorId],
    worldEventIds: [], locationRef: { region: location }, sourceFactIds: [], importance: 3,
    category: '人生节点', visibility: 'internal', revision: 1, legacyRefs: [] };
}

describe('格林推演程序侧紧凑目录索引', () => {
  it('旧重要纪要经真实迁移进入本人历史召回，但不公开摘要或生成投影事实', () => {
    const raw: any = structuredClone(buildEmptyWorldSimulationLedger_ACU());
    raw.schemaVersion = 6;
    for (const key of ['worldEvents', 'facts', 'historyMilestones', 'projection', 'legacyMigration']) delete raw[key];
    const legacyActor: any = actor('a');
    for (const key of ['shortTermAction', 'simulationStatus', 'loreRefs']) delete legacyActor[key];
    raw.actors = [legacyActor];
    raw.clock.day = 12;
    raw.chronicle = [{ id: 'old-important', at: '第12日', summary: '秘密身份已发生重大改变',
      relatedIds: ['a'], evidenceRefs: ['story:12'], missedNote: '主角错过身份变化' }];
    const snapshot = structuredClone(raw);
    const ledger = validateWorldSimulationLedger_ACU(raw);
    expect(ledger.historyMilestones).toHaveLength(1);
    const milestoneId = ledger.historyMilestones[0].id;
    const index = buildWorldRecallIndex_ACU(ledger);
    expect(index.historyByActor.get('a')).toEqual(ledger.historyMilestones);
    const page = queryWorldRecallManifestPage_ACU(index, ledger.actors, ledger.clock, null,
      { actorsPerPage: 24, recentHistoryPerActor: 3, relatedHistoryPerActor: 2, eventsPerPage: 16, factsPerPage: 16 });
    expect(page.manifest.actorIds).toEqual(['a']);
    expect(page.manifest.actors[0].recentHistoryIds).toEqual([milestoneId]);
    expect(JSON.stringify(page)).not.toContain('秘密身份');
    expect(ledger.facts).toEqual([]);
    expect(ledger.projection).toEqual({ anchor: null, deliveries: [] });
    expect(raw).toEqual(snapshot);
  });

  it('分页枚举到期及逾期事件、事实，不漏项不重复', () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.revision = 3;
    ledger.worldEvents = Array.from({ length: 370 }, (_, i) => event(`event-${String(i).padStart(3, '0')}`));
    ledger.facts = Array.from({ length: 380 }, (_, i) => fact(`fact-${String(i).padStart(3, '0')}`));
    ledger.actors = [actor('active'), actor('archived', 'archived')];
    const index = buildWorldRecallIndex_ACU(ledger);
    const clock = { ...ledger.clock, day: 2 };
    let cursor: string | null = null;
    const events: string[] = [];
    const facts: string[] = [];
    do {
      const page = queryWorldRecallIndexPage_ACU(index, ledger.actors, clock, null, 64, cursor);
      const manifest = buildWorldRecallManifestPages_ACU(ledger.actors, clock, null, page.directory);
      events.push(...manifest[0].dueEventIds, ...manifest[0].deferred.filter(row => row.kind === 'worldEvent').map(row => row.id));
      facts.push(...manifest[0].dueFactIds, ...manifest[0].deferred.filter(row => row.kind === 'fact').map(row => row.id));
      expect(Object.keys(page.directory.historyByActor)).toEqual(page.actorIds);
      expect(JSON.stringify(page.directory)).not.toContain('内部事实全文');
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(new Set(events).size).toBe(370);
    expect(new Set(facts).size).toBe(380);
    expect(events).toHaveLength(370);
    expect(facts).toHaveLength(380);
    expect(ledger.clock.day).toBe(1);
  });

  it('装配入口跨页枚举全部到期对象，不把 deferred 误当处理完成', () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.worldEvents = Array.from({ length: 75 }, (_, i) => event(`event-${i}`));
    ledger.facts = Array.from({ length: 83 }, (_, i) => fact(`fact-${i}`));
    ledger.actors = Array.from({ length: 70 }, (_, i) => actor(`actor-${i}`));
    const index = buildWorldRecallIndex_ACU(ledger);
    const clock = { ...ledger.clock, day: 2 };
    const limits = { actorsPerPage: 24, recentHistoryPerActor: 3, relatedHistoryPerActor: 2, eventsPerPage: 16, factsPerPage: 16 };
    let cursor: string | null = null;
    const events: string[] = [];
    const facts: string[] = [];
    const people: string[] = [];
    do {
      const page = queryWorldRecallManifestPage_ACU(index, ledger.actors, clock, null, limits, cursor);
      events.push(...page.manifest.dueEventIds);
      facts.push(...page.manifest.projectionCheckIds);
      people.push(...page.manifest.actorIds);
      expect(page.manifest.deferred).toEqual([]);
      expect(page.manifest.actorIds.length).toBeLessThanOrEqual(16);
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(new Set(events).size).toBe(75);
    expect(new Set(facts).size).toBe(83);
    expect(new Set(people).size).toBe(70);
    expect(events).toHaveLength(75);
    expect(facts).toHaveLength(83);
    expect(people).toHaveLength(70);
    expect(ledger.clock.day).toBe(1);
  });

  it('不同账本 revision/候选时间的旧 cursor 不复用，结束事件仍占世界页', () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.worldEvents = [event('active'), { ...event('finished'), status: 'resolved' }];
    const index = buildWorldRecallIndex_ACU(ledger);
    const clock = { ...ledger.clock, day: 2 };
    const page = queryWorldRecallIndexPage_ACU(index, [], clock, null, 1);
    expect(page.directory.candidateEvents.map(item => item.id)).toEqual(['active']);
    expect(page.nextCursor).not.toBeNull();
    expect(queryWorldRecallIndexPage_ACU(index, [], clock, null, 1, page.nextCursor).directory.candidateEvents)
      .toEqual([{ id: 'finished', status: 'resolved', nextCheck: { day: 2, slot: '' } }]);
    expect(() => queryWorldRecallIndexPage_ACU(index, [], { ...clock, day: 3 }, null, 1, page.nextCursor)).toThrow(/游标与账本或候选时间不一致/);
    const more = buildWorldRecallIndex_ACU({ ...ledger, worldEvents: [event('active'), event('second')] });
    const next = queryWorldRecallIndexPage_ACU(more, [], clock, null, 1).nextCursor!;
    expect(() => queryWorldRecallIndexPage_ACU(more, [], clock, null, 1, next.replace(/:1$/, ':999'))).toThrow(/游标超出范围/);
    expect(() => queryWorldRecallIndexPage_ACU(index, [], clock, null, 1, next)).toThrow(/游标与账本或候选时间不一致/);
  });

  it('未到期、无复核日及暂停/解决/取消事件都稳定分页，事实仍按时间筛选且目录不含全文', () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.worldEvents = [event('active'),
      { ...event('future-check'), status: 'scheduled', nextCheck: { day: 30, slot: '', reason: '未到期秘密' } },
      { ...event('no-check'), nextCheck: null },
      { ...event('paused'), status: 'paused', nextCheck: null },
      { ...event('resolved'), status: 'resolved', nextCheck: null },
      { ...event('cancelled'), status: 'cancelled', nextCheck: null }];
    ledger.facts = [fact('established'), { ...fact('future'), happenedAt: { day: 30, slot: '' } },
      { ...fact('expired'), temporalKind: 'condition', happenedAt: null,
        validFrom: { day: 1, slot: '' }, validUntil: { day: 1, slot: '' } }];
    const snapshot = structuredClone(ledger);
    const index = buildWorldRecallIndex_ACU(ledger);
    const clock = { ...ledger.clock, day: 2 };
    const limits = { actorsPerPage: 2, recentHistoryPerActor: 3, relatedHistoryPerActor: 2, eventsPerPage: 2, factsPerPage: 2 };
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = queryWorldRecallManifestPage_ACU(index, [], clock, null, limits, cursor);
      seen.push(...page.manifest.dueEventIds);
      expect(page.manifest.deferred).toEqual([]);
      expect(page.manifest.dueFactIds).toEqual(cursor === null ? ['established'] : []);
      expect(JSON.stringify(page)).not.toContain('内部事实全文');
      expect(JSON.stringify(page)).not.toContain('未到期秘密');
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(seen).toEqual(['active', 'future-check', 'cancelled', 'no-check', 'paused', 'resolved']);
    expect(new Set(seen).size).toBe(ledger.worldEvents.length);
    expect(ledger).toEqual(snapshot);
  });

  it('锁定事实和事件的复核理由不会进入普通召回目录', () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.facts = [fact('secret')];
    ledger.worldEvents = [event('e')];
    ledger.facts[0].nextCheck!.reason = '秘密调查对象的真实身份';
    ledger.worldEvents[0].nextCheck!.reason = '秘密接头地点';
    const page = queryWorldRecallIndexPage_ACU(buildWorldRecallIndex_ACU(ledger), [],
      { ...ledger.clock, day: 2 }, null, 8);
    expect(page.directory.candidateFacts[0].nextCheck).toEqual({ day: 2, slot: '' });
    expect(page.directory.candidateEvents[0].nextCheck).toEqual({ day: 2, slot: '' });
    expect(JSON.stringify(page.directory)).not.toContain('秘密');
  });

  it('索引冻结账本快照，不受后续原对象修改影响；多人物历史目录不泄漏其他名单', () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = [actor('a'), actor('b')];
    ledger.worldEvents = [event('event-1')];
    ledger.historyMilestones = [{ ...milestone('shared', 1, 'a', '上海'), actorIds: ['a', 'b'] }];
    const index = buildWorldRecallIndex_ACU(ledger);
    ledger.worldEvents[0].title = '修改后秘密';
    ledger.historyMilestones[0].summary = '修改后历史';
    const page = queryWorldRecallIndexPage_ACU(index, ledger.actors, { ...ledger.clock, day: 2 }, { region: '上海' }, 1);
    expect(page.actorIds).toEqual(['a']);
    expect(page.directory.historyByActor.a).toEqual([{ id: 'shared', happenedAt: { day: 1, slot: '' }, actorIds: ['a'], locationRef: { region: '上海' } }]);
    expect(JSON.stringify(page.directory)).not.toContain('修改后秘密');
    expect(JSON.stringify(page.directory)).not.toContain('修改后历史');
    ledger.actors[0].name = '被外部篡改';
    expect(() => queryWorldRecallIndexPage_ACU(index, ledger.actors, { ...ledger.clock, day: 2 }, { region: '上海' }, 1))
      .toThrow(/人物资料与索引快照不一致/);
  });

  it('人物历史按 ID 最近和同地点旧事限额，非目标人物及未来历史不可见', () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = [actor('a'), actor('b', 'archived')];
    ledger.historyMilestones = [milestone('old', 1, 'a', '上海'), milestone('future', 8, 'a', '上海'),
      ...Array.from({ length: 12 }, (_, i) => milestone(`recent-${i}`, i + 2, 'a', '北京')),
      milestone('other', 1, 'b', '上海')];
    const directory = queryWorldRecallIndexPage_ACU(buildWorldRecallIndex_ACU(ledger), ledger.actors,
      { ...ledger.clock, day: 5 }, { region: '上海' }, 24).directory;
    expect(directory.historyByActor.a.map(item => item.id)).toEqual(['recent-3', 'recent-2', 'recent-1', 'old']);
    expect(directory.historyByActor).not.toHaveProperty('b');
    expect(JSON.stringify(buildWorldRecallManifestPages_ACU(ledger.actors, { ...ledger.clock, day: 5 }, { region: '上海' }, directory)))
      .not.toContain('历史全文');
  });

  it.each(['ongoing', 'done', 'abandoned'] as const)('人物迁地后仅为 %s 短期事务保留异地起始日冷史，近3旧2限额不变', async status => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.clock.day = 50;
    ledger.actors = [actor('a')];
    ledger.actors[0].locationRef = { region: '北京' };
    ledger.actors[0].shortTermAction = { text: '追查旧线索', expectedDuration: '数日', startedAtDay: 1,
      startedAt: '第一日', status, outcome: null };
    ledger.historyMilestones = [milestone('recent-a', 49, 'a', '广州'), milestone('recent-b', 48, 'a', '广州'),
      milestone('recent-c', 47, 'a', '广州'), milestone('local-a', 46, 'a', '北京'), milestone('local-b', 45, 'a', '北京')];
    ledger.historyArchive = [milestone('action-origin', 1, 'a', '上海'), milestone('future', 51, 'a', '北京'),
      milestone('other-person', 1, 'b', '上海')];
    const snapshot = structuredClone(ledger);
    const index = buildWorldRecallIndex_ACU(ledger);
    const page = queryWorldRecallIndexPage_ACU(index, ledger.actors, ledger.clock, null, 24);
    const selected = page.directory.historyByActor.a.map(row => row.id);
    expect(selected).toEqual(['recent-a', 'recent-b', 'recent-c', ...(status === 'ongoing'
      ? ['action-origin', 'local-a'] : ['local-a', 'local-b'])]);
    const manifest = queryWorldRecallManifestPage_ACU(index, ledger.actors, ledger.clock, null,
      { actorsPerPage: 24, recentHistoryPerActor: 3, relatedHistoryPerActor: 2, eventsPerPage: 16, factsPerPage: 16 }).manifest;
    expect(manifest.actors[0].recentHistoryIds).toEqual(['recent-a', 'recent-b', 'recent-c']);
    expect(manifest.actors[0].relatedHistoryIds).toEqual(status === 'ongoing' ? ['action-origin', 'local-a'] : ['local-a', 'local-b']);
    expect(selected).toHaveLength(5);
    expect(JSON.stringify(manifest)).not.toContain('历史全文');
    const config = { limits: { actorsPerPage: 24, recentHistoryPerActor: 3, relatedHistoryPerActor: 2, eventsPerPage: 16, factsPerPage: 16 },
      read: { historyTokenBudget: 1000, readTokenBudget: 1000, fallbackTokens: 1000 }, actorBatchSize: 24 };
    const prepared = await prepareWorldExecutionRecall_ACU(ledger, ledger.clock, null, config, async () => 1);
    if (!prepared.allowed) throw new Error('起点历史准备失败');
    const read = await readWorldExecutionRecall_ACU(prepared.receipt, ledger, ledger.clock, null, config,
      { kind: 'actor', batchIndex: 0, historyByActor: { a: ['action-origin'] }, worldEventIds: [], factIds: [] }, undefined, async () => 1);
    expect(read.allowed).toBe(status === 'ongoing');
    if (read.allowed) expect(read.materials.historyMilestones).toEqual([ledger.historyArchive![0]]);
    expect(ledger).toEqual(snapshot);
  });

  it('事实冷层参与索引指纹但不进入普通召回目录', () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.facts = [fact('hot-a'), fact('hot-b')];
    ledger.factArchive = [{ ...fact('cold-nearby'), nextCheck: null,
      locationRef: { region: '上海', place: '广场' } }];
    const clock = { ...ledger.clock, day: 2 };
    const first = buildWorldRecallIndex_ACU(ledger);
    const page = queryWorldRecallIndexPage_ACU(first, [], clock, { region: '上海', place: '广场' }, 1);
    expect(page.directory.candidateFacts.map(item => item.id)).toEqual(['hot-a']);
    expect(JSON.stringify(page.directory)).not.toContain('cold-nearby');
    expect(page.nextCursor).not.toBeNull();

    const changed = structuredClone(ledger);
    changed.factArchive![0].summary = '冷层内容已变更';
    const second = buildWorldRecallIndex_ACU(changed);
    expect(second.fingerprint).not.toBe(first.fingerprint);
    expect(() => queryWorldRecallIndexPage_ACU(second, [], clock, { region: '上海', place: '广场' }, 1, page.nextCursor))
      .toThrow(/游标与账本或候选时间不一致/);
  });

  it('活跃人物的完整结构化地点把已成立的远方事实纳入内部资料候选，不改变授权范围', () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    const remoteActor = actor('remote');
    remoteActor.locationRef = { region: '北京', place: '广场' };
    const archivedActor = actor('archived-place', 'archived');
    archivedActor.locationRef = { region: '上海', place: '码头' };
    const textOnlyActor = actor('text-only');
    textOnlyActor.location = '天津车站';
    ledger.actors = [remoteActor, archivedActor, textOnlyActor];
    ledger.clock = { ...ledger.clock, day: 2, slot: '夜' };
    ledger.facts = [
      { ...fact('remote-established'), nextCheck: null, locationRef: { region: '北京', place: '广场' } },
      { ...fact('archived-only'), nextCheck: null, locationRef: { region: '上海', place: '码头' } },
      { ...fact('text-only'), nextCheck: null, locationRef: { region: '天津', place: '车站' } },
      { ...fact('future-slot'), nextCheck: null, happenedAt: { day: 2, slot: '午前' }, locationRef: { region: '北京', place: '广场' } },
      { ...fact('expired'), temporalKind: 'condition', happenedAt: null, validFrom: { day: 1, slot: '' },
        validUntil: { day: 1, slot: '' }, nextCheck: null, locationRef: { region: '北京', place: '广场' } },
    ];
    ledger.factArchive = [{ ...fact('cold'), nextCheck: null, locationRef: { region: '北京', place: '广场' } }];
    const snapshot = structuredClone(ledger);
    const index = buildWorldRecallIndex_ACU(ledger);
    const directory = queryWorldRecallIndexPage_ACU(index, ledger.actors, ledger.clock, null, 16).directory;
    expect(directory.candidateFacts.map(item => item.id)).toEqual(['remote-established']);
    expect(JSON.stringify(directory)).not.toContain('内部事实全文');

    const manifest = queryWorldRecallManifestPage_ACU(index, ledger.actors, ledger.clock, null,
      { actorsPerPage: 24, recentHistoryPerActor: 3, relatedHistoryPerActor: 2, eventsPerPage: 16, factsPerPage: 16 }).manifest;
    expect(manifest.dueFactIds).toEqual(['remote-established']);
    expect(manifest.projectionCheckIds).toEqual(['remote-established']);
    expect(JSON.stringify(manifest)).not.toContain('内部事实全文');
    expect(ledger).toEqual(snapshot);
  });

  it('同一活跃地点的大量内部资料候选稳定跨页且不泄漏摘要', () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    const remoteActor = actor('remote');
    remoteActor.locationRef = { region: '北京', place: '广场' };
    ledger.actors = [remoteActor];
    ledger.facts = Array.from({ length: 75 }, (_, i) => ({ ...fact(`remote-${String(i).padStart(3, '0')}`),
      nextCheck: null, locationRef: { region: '北京', place: '广场' } }));
    const snapshot = structuredClone(ledger);
    const index = buildWorldRecallIndex_ACU(ledger);
    const limits = { actorsPerPage: 24, recentHistoryPerActor: 3, relatedHistoryPerActor: 2, eventsPerPage: 16, factsPerPage: 16 };
    const facts: string[] = [];
    let cursor: string | null = null;
    do {
      const page = queryWorldRecallManifestPage_ACU(index, ledger.actors, ledger.clock, null, limits, cursor);
      facts.push(...page.manifest.dueFactIds);
      expect(JSON.stringify(page)).not.toContain('内部事实全文');
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(facts).toEqual(Array.from({ length: 75 }, (_, i) => `remote-${String(i).padStart(3, '0')}`));
    expect(new Set(facts).size).toBe(75);
    expect(ledger).toEqual(snapshot);
  });

  it('索引和真实清单查询按每名人物的结构化地点补足旧史，且两层结果一致', () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    const beijing = actor('beijing');
    beijing.locationRef = { region: '北京' };
    const shanghai = actor('shanghai');
    shanghai.locationRef = { region: '上海' };
    ledger.actors = [beijing, shanghai];
    ledger.clock.day = 10;
    ledger.historyMilestones = [
      milestone('beijing-recent-c', 10, 'beijing', '广州'),
      milestone('beijing-recent-b', 9, 'beijing', '深圳'),
      milestone('beijing-recent-a', 8, 'beijing', '上海'),
      milestone('beijing-old-b', 7, 'beijing', '北京'),
      milestone('beijing-old-a', 6, 'beijing', '北京'),
      milestone('beijing-future', 11, 'beijing', '北京'),
      milestone('shanghai-recent-c', 10, 'shanghai', '北京'),
      milestone('shanghai-recent-b', 9, 'shanghai', '广州'),
      milestone('shanghai-recent-a', 8, 'shanghai', '深圳'),
      milestone('shanghai-old-b', 7, 'shanghai', '上海'),
      milestone('shanghai-old-a', 6, 'shanghai', '上海'),
      milestone('shanghai-future', 11, 'shanghai', '上海'),
      milestone('other-person', 7, 'other', '北京'),
    ];
    const index = buildWorldRecallIndex_ACU(ledger);
    const playerLocation = { region: '上海' };
    const limits = { actorsPerPage: 24, recentHistoryPerActor: 3, relatedHistoryPerActor: 2, eventsPerPage: 16, factsPerPage: 16 };
    const indexed = queryWorldRecallIndexPage_ACU(index, ledger.actors, ledger.clock, playerLocation, 24);
    const direct = buildWorldRecallManifestPages_ACU(ledger.actors, ledger.clock, playerLocation, indexed.directory, limits)[0];
    const queried = queryWorldRecallManifestPage_ACU(index, ledger.actors, ledger.clock, playerLocation, limits);

    expect(indexed.directory.historyByActor.beijing.map(item => item.id)).toEqual([
      'beijing-recent-c', 'beijing-recent-b', 'beijing-recent-a', 'beijing-old-b', 'beijing-old-a',
    ]);
    expect(indexed.directory.historyByActor.shanghai.map(item => item.id)).toEqual([
      'shanghai-recent-c', 'shanghai-recent-b', 'shanghai-recent-a', 'shanghai-old-b', 'shanghai-old-a',
    ]);
    expect(queried.manifest.actors).toEqual(direct.actors);
    expect(queried.manifest.actors).toMatchObject([
      { actorId: 'beijing', relatedHistoryIds: ['beijing-old-b', 'beijing-old-a'] },
      { actorId: 'shanghai', relatedHistoryIds: ['shanghai-old-b', 'shanghai-old-a'] },
    ]);
    expect(new Set(queried.manifest.actors.flatMap(item => [...item.recentHistoryIds, ...item.relatedHistoryIds])).size).toBe(10);
    expect(JSON.stringify(queried)).not.toContain('future');
    expect(JSON.stringify(queried)).not.toContain('other-person');
  });
});
