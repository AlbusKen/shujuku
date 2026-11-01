import { describe, expect, it } from 'vitest';
import { buildEmptyWorldSimulationLedger_ACU } from '../../../src/service/simulation/defaults';
import { buildWorldRecallManifestPages_ACU } from '../../../src/service/simulation/world-recall-manifest';
import type { WorldActor_ACU, WorldEvent_ACU, WorldFact_ACU, WorldHistoryMilestone_ACU } from '../../../src/service/simulation/model';

function actor(id: string, patch: Partial<WorldActor_ACU> = {}): WorldActor_ACU {
  return { id, name: id, interests: [], location: '远方', locationRef: null, life: 'alive', diedAtDay: null,
    deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [], knownFacts: [],
    visibility: 'hidden', currentAction: null, longTermAction: null, shortTermAction: null,
    simulationStatus: 'active', loreRefs: [], experiences: [], revision: 1, ...patch };
}
function fact(id: string, patch: Partial<WorldFact_ACU> = {}): WorldFact_ACU {
  return { id, summary: '秘密：远方当事人已经签约', temporalKind: 'occurrence',
    happenedAt: { day: 1, slot: '' }, validFrom: null, validUntil: null,
    locationRef: { region: '上海' }, actorIds: [], worldEventIds: [], projectionPolicy: 'gated',
    revealState: 'locked', revealGate: { condition: '主动询问' }, nextCheck: { day: 2, slot: '', reason: '复核' },
    sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1, ...patch };
}
function history(id: string, day: number, patch: Partial<WorldHistoryMilestone_ACU> = {}): WorldHistoryMilestone_ACU {
  return { id, summary: `第${day}日重要旧史`, happenedAt: { day, slot: '' }, actorIds: ['actor-1'],
    worldEventIds: [], locationRef: { region: '远方' }, sourceFactIds: [], importance: 3,
    category: '人物', visibility: 'internal', revision: 1, legacyRefs: [], ...patch };
}

describe('格林推演有限召回清单', () => {
  it('无 active 人物时仍有世界页；多人物页只在第一页附全局候选', () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.clock.day = 2;
    const event = { id: 'event-1', title: '节日筹备', state: '进行中', status: 'active' as const,
      actorIds: [], organizationIds: [], locationRefs: [], startedAt: null, deadline: null,
      nextCheck: { day: 2, slot: '', reason: '复核' }, relatedEventIds: [], loreRefs: [],
      evidenceRefs: [], tags: [], revision: 1, legacy: null };
    const directory = { historyByActor: {}, candidateEvents: [event], candidateFacts: [fact('secret-1')] };
    const empty = buildWorldRecallManifestPages_ACU([], ledger.clock, { region: '上海' }, directory);
    expect(empty).toHaveLength(1);
    expect(empty[0]).toMatchObject({ actorIds: [], dueEventIds: ['event-1'], projectionCheckIds: ['secret-1'] });
    const pages = buildWorldRecallManifestPages_ACU([actor('a'), actor('b')], ledger.clock, { region: '上海' },
      directory, { actorsPerPage: 1 });
    expect(pages.map(page => page.actorIds)).toEqual([['a'], ['b']]);
    expect(pages.map(page => page.dueEventIds)).toEqual([['event-1'], []]);
    expect(pages.map(page => page.projectionCheckIds)).toEqual([['secret-1'], []]);
  });

  it('全部 active 人物分页，未点名且没有到期事务也不能省略', () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = Array.from({ length: 55 }, (_, index) => actor(`actor-${String(54 - index).padStart(2, '0')}`));
    ledger.actors.push(actor('archived', { simulationStatus: 'archived' }));
    const pages = buildWorldRecallManifestPages_ACU(ledger.actors, ledger.clock, null,
      { historyByActor: {}, candidateEvents: [], candidateFacts: [] }, { actorsPerPage: 20 });
    expect(pages.map(page => page.actors.length)).toEqual([20, 20, 15]);
    expect(pages.flatMap(page => page.actorIds)).toEqual(ledger.actors.filter(item => item.id !== 'archived').map(item => item.id).sort());
    expect(JSON.stringify(pages)).not.toContain('archived');
  });

  it('人物只带有限近期和相关旧史 ID，绝不注入历史全文', () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.clock.day = 12;
    const current = actor('actor-1', { currentAction: { text: '给家人发消息', expectedDuration: '几分钟', startedAtDay: 12, startedAt: '午后' },
      shortTermAction: { text: '筹备下周演出', expectedDuration: '五日', startedAtDay: 8, startedAt: '早晨', status: 'ongoing', outcome: null },
      goals: ['维持演出事业'] });
    const many = Array.from({ length: 40 }, (_, index) => history(`h-${index}`, index + 1,
      { summary: `不应注入的历史全文-${index}-${'秘密'.repeat(50)}` }));
    const pages = buildWorldRecallManifestPages_ACU([current], ledger.clock, { region: '远方' },
      { historyByActor: { 'actor-1': many }, candidateEvents: [], candidateFacts: [] },
      { recentHistoryPerActor: 2, relatedHistoryPerActor: 1 });
    expect(pages[0].actors[0]).toMatchObject({ currentAction: '给家人发消息', shortTermAction: '筹备下周演出',
      recentHistoryIds: ['h-11', 'h-10'], relatedHistoryIds: ['h-7'] });
    expect(JSON.stringify(pages)).not.toContain('不应注入的历史全文');
    expect(pages[0].actors[0].goal).toBe('维持演出事业');
  });

  it('结构化人物地点优先于玩家地点，缺失时沿用玩家地点且近期占满后仍补足两条旧史', () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.clock.day = 10;
    const distant = actor('distant', { location: '北京', locationRef: { region: '北京' } });
    const fallback = actor('fallback', { location: '北京（自由文本）', locationRef: null });
    const rows = (actorId: string, ids: Array<[string, number, string]>) => ids.map(([id, day, region]) =>
      history(id, day, { actorIds: [actorId], locationRef: { region } }));
    const distantRows = rows('distant', [
      ['distant-recent-c', 10, '广州'], ['distant-recent-b', 9, '深圳'], ['distant-recent-a', 8, '上海'],
      ['distant-beijing-b', 7, '北京'], ['distant-beijing-a', 6, '北京'], ['distant-shanghai', 5, '上海'],
      ['distant-future', 11, '北京'],
    ]);
    const fallbackRows = rows('fallback', [
      ['fallback-recent-c', 10, '北京'], ['fallback-recent-b', 9, '广州'], ['fallback-recent-a', 8, '深圳'],
      ['fallback-shanghai-b', 7, '上海'], ['fallback-shanghai-a', 6, '上海'], ['fallback-beijing', 5, '北京'],
      ['other-person', 7, '上海'],
    ]);
    fallbackRows.find(row => row.id === 'other-person')!.actorIds = ['other'];
    const page = buildWorldRecallManifestPages_ACU([distant, fallback], ledger.clock, { region: '上海' },
      { historyByActor: { distant: distantRows, fallback: fallbackRows }, candidateEvents: [], candidateFacts: [] },
      { recentHistoryPerActor: 3, relatedHistoryPerActor: 2 });

    expect(page[0].actors).toMatchObject([
      { actorId: 'distant', recentHistoryIds: ['distant-recent-c', 'distant-recent-b', 'distant-recent-a'],
        relatedHistoryIds: ['distant-beijing-b', 'distant-beijing-a'] },
      { actorId: 'fallback', recentHistoryIds: ['fallback-recent-c', 'fallback-recent-b', 'fallback-recent-a'],
        relatedHistoryIds: ['fallback-shanghai-b', 'fallback-shanghai-a'] },
    ]);
    expect(page[0].actors.flatMap(item => [...item.recentHistoryIds, ...item.relatedHistoryIds])).not.toContain('distant-future');
    expect(page[0].actors.flatMap(item => [...item.recentHistoryIds, ...item.relatedHistoryIds])).not.toContain('other-person');
    for (const item of page[0].actors) {
      expect(new Set([...item.recentHistoryIds, ...item.relatedHistoryIds]).size)
        .toBe(item.recentHistoryIds.length + item.relatedHistoryIds.length);
    }
  });

  it('锁定秘密只给 projection-check ID，不给摘要；远方场景事实不投影', () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.clock.day = 2;
    const near = fact('scene-1', { summary: '附近已搭起舞台', projectionPolicy: 'scene', revealState: 'unlocked',
      happenedAt: { day: 2, slot: '' }, locationRef: { region: '上海', place: '广场' } });
    const far = fact('scene-far', { summary: '远方已搭起舞台', projectionPolicy: 'scene', revealState: 'unlocked',
      locationRef: { region: '北京' } });
    const sameCityFar = fact('scene-same-city', { summary: '同城另一地点发生的事', projectionPolicy: 'scene', revealState: 'unlocked',
      happenedAt: { day: 2, slot: '' }, locationRef: { region: '上海', place: '另一条街' } });
    const pages = buildWorldRecallManifestPages_ACU([actor('actor-1')], ledger.clock, { region: '上海', place: '广场' },
      { historyByActor: {}, candidateEvents: [], candidateFacts: [fact('secret-1'), near, far, sameCityFar] });
    expect(pages[0].projectionCheckIds).toEqual(['secret-1']);
    expect(pages[0].sceneFactIds).toEqual(['scene-1']);
    expect(JSON.stringify(pages)).not.toContain('秘密：远方当事人已经签约');
    expect(JSON.stringify(pages)).not.toContain('远方已搭起舞台');
    expect(pages[0].sceneFactIds).not.toContain('scene-same-city');
  });

  it('到期 internal 事实保留世界复核 ID，但绝不进入正文候选', () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.clock.day = 2;
    const pages = buildWorldRecallManifestPages_ACU([actor('actor-1')], ledger.clock, null,
      { historyByActor: {}, candidateEvents: [], candidateFacts: [fact('internal-1', {
        projectionPolicy: 'internal', summary: '内部已确定事项',
      })] });
    expect(pages[0].dueFactIds).toEqual(['internal-1']);
    expect(pages[0].sceneFactIds).toEqual([]);
    expect(pages[0].projectionCheckIds).toEqual([]);
    expect(JSON.stringify(pages)).not.toContain('内部已确定事项');
  });

  it('未来尚未发生或已经结束的事实不进入当前场景，锁定事实也不泄漏内容', () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.clock.day = 5;
    const candidates = [
      fact('future', { projectionPolicy: 'scene', revealState: 'unlocked', happenedAt: { day: 6, slot: '' } }),
      fact('expired', { projectionPolicy: 'scene', revealState: 'unlocked', temporalKind: 'condition',
        happenedAt: null, validFrom: { day: 1, slot: '' }, validUntil: { day: 4, slot: '' } }),
      fact('current', { projectionPolicy: 'scene', revealState: 'unlocked', temporalKind: 'condition',
        happenedAt: null, validFrom: { day: 2, slot: '' }, validUntil: { day: 7, slot: '' },
        locationRef: { region: '上海', place: '广场' } }),
      fact('past', { projectionPolicy: 'scene', revealState: 'unlocked', happenedAt: { day: 3, slot: '' } }),
      fact('future-secret', { happenedAt: { day: 6, slot: '' }, nextCheck: { day: 5, slot: '', reason: '复核' } }),
    ];
    const pages = buildWorldRecallManifestPages_ACU([actor('actor-1')], ledger.clock, { region: '上海', place: '广场' },
      { historyByActor: {}, candidateEvents: [], candidateFacts: candidates });
    expect(pages[0].sceneFactIds).toEqual(['current']);
    expect(pages[0].projectionCheckIds).toEqual([]);
    expect(JSON.stringify(pages)).not.toContain('秘密：远方当事人已经签约');
  });

  it('dueEventIds 沿用字段名但收录所有当页事件，状态和 nextCheck 不阻止列入', () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.clock.day = 2;
    const base: WorldEvent_ACU = { id: 'active', title: '不可进入目录的事件正文', state: '进行中', status: 'active',
      actorIds: [], organizationIds: [], locationRefs: [], startedAt: null, deadline: null,
      nextCheck: { day: 2, slot: '', reason: '隐秘复核理由' }, relatedEventIds: [], loreRefs: [],
      evidenceRefs: [], tags: [], revision: 1, legacy: null };
    const events: WorldEvent_ACU[] = [base,
      { ...base, id: 'future', status: 'scheduled', nextCheck: { day: 50, slot: '', reason: '秘密远期' } },
      { ...base, id: 'no-check', nextCheck: null },
      { ...base, id: 'paused', status: 'paused', nextCheck: null },
      { ...base, id: 'resolved', status: 'resolved', nextCheck: null },
      { ...base, id: 'cancelled', status: 'cancelled', nextCheck: null }];
    const pages = buildWorldRecallManifestPages_ACU([], ledger.clock, null,
      { historyByActor: {}, candidateEvents: events, candidateFacts: [] }, { eventsPerPage: 3 });
    expect(pages).toHaveLength(1);
    expect(pages[0].dueEventIds).toEqual(['active', 'future', 'no-check']);
    expect(pages[0].deferred).toEqual(['paused', 'resolved', 'cancelled']
      .map(id => ({ kind: 'worldEvent', id, reason: 'budget' })));
    expect(JSON.stringify(pages)).not.toContain('不可进入目录的事件正文');
    expect(JSON.stringify(pages)).not.toContain('秘密远期');
    expect(JSON.stringify(pages)).not.toContain('隐秘复核理由');
  });

  it('到期事件和事实超出每页预算时只列有限 ID，候选时钟不写入原账本', () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    const events = Array.from({ length: 50 }, (_, index) => ({
      id: `event-${index}`, title: `大型事件${index}`, state: '进行中', status: 'active' as const,
      actorIds: [], organizationIds: [], locationRefs: [], startedAt: null, deadline: null,
      nextCheck: { day: 2, slot: '晨', reason: '按时复核' }, relatedEventIds: [], loreRefs: [],
      evidenceRefs: [], tags: [], revision: 1, legacy: null,
    }));
    const pages = buildWorldRecallManifestPages_ACU([actor('actor-1')], { ...ledger.clock, day: 2 }, null,
      { historyByActor: {}, candidateEvents: events, candidateFacts: Array.from({ length: 50 }, (_, index) => fact(`fact-${index}`)) },
      { eventsPerPage: 6, factsPerPage: 5 });
    expect(pages[0].dueEventIds).toHaveLength(6);
    expect(pages[0].projectionCheckIds).toHaveLength(5);
    expect(pages[0].deferred.filter(item => item.kind === 'worldEvent')).toHaveLength(44);
    expect(pages[0].deferred.filter(item => item.kind === 'fact')).toHaveLength(45);
    expect(pages[0].deferred.every(item => item.reason === 'budget')).toBe(true);
    expect(ledger.clock.day).toBe(1);
    expect(JSON.stringify(pages)).not.toContain('大型事件');
    expect(() => buildWorldRecallManifestPages_ACU([], ledger.clock, null,
      { historyByActor: {}, candidateEvents: [], candidateFacts: [] }, { actorsPerPage: 0 })).toThrow(/1..64/);
    expect(() => buildWorldRecallManifestPages_ACU([], ledger.clock, null,
      { historyByActor: {}, candidateEvents: Array.from({ length: 257 }, (_, index) => ({ ...events[0], id: `overflow-${index}` })), candidateFacts: [] }))
      .toThrow(/须先按索引分页/);
  });
});
