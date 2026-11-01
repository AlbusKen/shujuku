import { describe, expect, it } from 'vitest';
import { buildPlotWorldContext_ACU, renderPlotWorldContextMessage_ACU } from '../../../../src/service/runtime/plot-runtime/plot-world-context';
import type { WorldSimulationLedger_ACU } from '../../../../src/service/simulation/model';

function ledger(): WorldSimulationLedger_ACU {
  return {
    schemaVersion: 7, revision: 2,
    clock: { day: 8, slot: '夜', storyTime: '第八日', precision: 'exact', evidenceRefs: [] },
    worldEvents: [{ id: 'event', title: '远方密谋', state: '仍在策划', status: 'active', actorIds: ['actor'], organizationIds: [], locationRefs: [{ region: '远方' }], startedAt: null, deadline: null, nextCheck: null, relatedEventIds: [], loreRefs: [], evidenceRefs: [], tags: [], revision: 1, legacy: null }],
    actors: [{ id: 'actor', name: '幕后人物', interests: ['权力'], location: '远方', locationRef: { region: '远方' }, life: 'alive', diedAtDay: null, deathSummary: null, resources: [], goals: ['夺取密函'], constraints: [], informationSources: ['信使'], knownFacts: ['密函尚未送达'], visibility: 'hidden', currentAction: { text: '等候信使', expectedDuration: '一日', startedAtDay: 8, startedAt: '夜' }, longTermAction: { text: '夺取密函', expectedDuration: '数日', startedAtDay: 8, startedAt: '夜', status: 'ongoing', outcome: null }, shortTermAction: { text: '夺取密函', expectedDuration: '数日', startedAtDay: 8, startedAt: '夜', status: 'ongoing', outcome: null }, experiences: [], revision: 1 }],
    facts: [{ id: 'locked', summary: '远方存在密函', temporalKind: 'occurrence', happenedAt: { day: 7, slot: '夜' }, validFrom: null, validUntil: null, locationRef: { region: '远方' }, actorIds: ['actor'], worldEventIds: ['event'], projectionPolicy: 'internal', revealState: 'locked', revealGate: { condition: '见到信使' }, nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: ['old'], revision: 1 }],
    factArchive: [{ id: 'old', summary: '旧日密函', temporalKind: 'occurrence', happenedAt: { day: 2, slot: '午' }, validFrom: null, validUntil: null, locationRef: null, actorIds: [], worldEventIds: [], projectionPolicy: 'gated', revealState: 'locked', revealGate: null, nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 }],
    historyMilestones: [{ id: 'milestone', summary: '密函诞生', happenedAt: { day: 7, slot: '夜' }, actorIds: ['actor'], worldEventIds: ['event'], locationRef: null, sourceFactIds: ['locked'], importance: 5, category: '秘密', visibility: 'internal', revision: 1, legacyRefs: [] }],
    historyArchive: [{ id: 'old-milestone', summary: '古老事件', happenedAt: { day: 2, slot: '午' }, actorIds: [], worldEventIds: [], locationRef: null, sourceFactIds: ['old'], importance: 1, category: '历史', visibility: 'internal', revision: 1, legacyRefs: [] }],
    dimensions: [], seeds: [], projection: { anchor: null, deliveries: [] }, legacyMigration: { issues: [] }, chronicle: [], rumors: [], player: { location: null, locationUpdatedAtDay: 8, regionVisits: [], contact: 'open', evidenceRefs: [] }, guidance: { signals: [], excludedFacts: [], evidenceRefs: [] }, chronicleOverview: [], materialCompletion: { state: 'complete_changed', expectedModules: [], modules: {}, sourceRunId: 'internal-run', updatedAt: 0 }, pendingFixes: [],
  };
}

describe('格林剧情推进完整资料', () => {
  it('六组仅业务资料完整透传锁定远处事实、冷热纪要和人物认知且不改变输入', () => {
    const current = ledger();
    const snapshot = structuredClone(current);
    const context = buildPlotWorldContext_ACU({ ledger: current, previousLedger: null, summary: '完成' });
    expect(Object.keys(context)).toEqual(['clock', 'round', 'worldEvents', 'actors', 'facts', 'historyMilestones']);
    expect(context.facts.hot[0]).toMatchObject({ storage: 'hot', projectionPolicy: 'internal', revealState: 'locked', revealGate: { condition: '见到信使' }, happenedAt: { day: 7 }, supersedesFactIds: ['old'] });
    expect(context.facts.cold[0]).toMatchObject({ storage: 'cold', id: 'old' });
    expect(context.historyMilestones.cold[0]).toMatchObject({ storage: 'cold', id: 'old-milestone' });
    expect(context.actors[0]).toMatchObject({ goals: ['夺取密函'], knownFacts: ['密函尚未送达'], informationSources: ['信使'], shortTermAction: { status: 'ongoing' } });
    expect(context.actors[0]).not.toHaveProperty('longTermAction');
    expect(context.worldEvents[0]).not.toHaveProperty('legacy');
    expect(JSON.stringify(context)).not.toContain('internal-run');
    expect(current).toEqual(snapshot);
    const message = renderPlotWorldContextMessage_ACU(context);
    expect(message.role).toBe('system');
    expect(message.content).toContain('[[ACU_WORLD_SIMULATION_CONTEXT]]');
    expect(message.content).toContain('远方存在密函');
    expect(message.content).toContain('读取不自动修改账本或揭示状态');
    expect(message.content).not.toContain('selectedFactIds');
  });

  it('按实际前后差异记录新增、更新、移除与完成行动，不把旧事实当本轮新增', () => {
    const before = ledger();
    const after = structuredClone(before);
    after.revision++;
    after.clock.day = 9;
    after.worldEvents[0].state = '行动开始';
    after.actors[0].experiences.push({ text: '交付信件', expectedDuration: '一日', startedAtDay: 8, startedAt: '夜', endedAtDay: 9, endedAt: '晨', status: 'done', outcome: '完成' });
    after.factArchive = [];
    after.facts.push({ ...structuredClone(before.facts[0]), id: 'fresh', summary: '新事件', supersedesFactIds: [] });
    const context = buildPlotWorldContext_ACU({ ledger: after, previousLedger: before, summary: '行动推进' });
    expect(context.round.comparison).toBe('available');
    expect(context.round.clock?.before.day).toBe(8);
    expect(context.round.worldEvents?.updated).toHaveLength(1);
    expect(context.round.worldEvents?.added).toEqual([]);
    expect(context.round.facts?.added.map(item => item.id)).toEqual(['fresh']);
    expect(context.round.facts?.removed.map(item => item.id)).toEqual(['old']);
    expect(context.round.facts?.updated).toEqual([]);
    expect(context.round.completedActions).toMatchObject([{ actorId: 'actor', experience: { status: 'done', outcome: '完成' } }]);
    expect(before.clock.day).toBe(8);
  });

  it('无变化显示空变更，缺失比较基底明确 unavailable', () => {
    const current = ledger();
    const same = buildPlotWorldContext_ACU({ ledger: current, previousLedger: structuredClone(current), summary: '无变化' });
    expect(same.round).toMatchObject({ comparison: 'available', clock: null, worldEvents: { added: [], updated: [], removed: [] }, completedActions: [] });
    const unknown = buildPlotWorldContext_ACU({ ledger: current, previousLedger: null, summary: '未知基底' });
    expect(unknown.round).toMatchObject({ comparison: 'unavailable', clock: null, actors: null, facts: null, completedActions: null });
    expect(unknown.facts.hot).toHaveLength(1);
  });
});
