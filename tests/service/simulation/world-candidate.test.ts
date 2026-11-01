import { describe, expect, it } from 'vitest';
import { buildDefaultWorldSimulationSettings_ACU, buildEmptyWorldSimulationLedger_ACU } from '../../../src/service/simulation/defaults';
import { materializeReviewedWorldRoundCandidate_ACU, materializeWorldRoundCandidate_ACU, type WorldRoundCandidate_ACU } from '../../../src/service/simulation/world-candidate';
import { prepareWorldFactRevealProof_ACU, runWorldProjectionStage_ACU } from '../../../src/service/simulation/agent/world-projection-stage';
import { sha256HexSync_ACU } from '../../../src/shared/sha256-sync';
import type { WorldActor_ACU, WorldHistoryMilestone_ACU, WorldSimulationLedger_ACU } from '../../../src/service/simulation/model';

function actor(id: string, patch: Partial<WorldActor_ACU> = {}): WorldActor_ACU {
  return { id, name: id, interests: [], location: '', locationRef: null, life: 'alive', diedAtDay: null,
    deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [], knownFacts: [],
    visibility: 'hidden', currentAction: null, longTermAction: null, shortTermAction: null,
    simulationStatus: 'active', loreRefs: [], experiences: [], revision: 1, ...patch };
}
function round(base: WorldSimulationLedger_ACU, patch: Partial<WorldRoundCandidate_ACU> = {}): WorldRoundCandidate_ACU {
  return { baseRevision: base.revision, candidateClock: structuredClone(base.clock), worldEventWrites: [], actorWrites: [],
    factWrites: [], historyMilestoneWrites: [], actorCompletions: base.actors.filter(item => item.simulationStatus !== 'archived')
      .map(item => ({ actorId: item.id, completion: 'no_change', expectedRevision: item.revision })),
    projection: structuredClone(base.projection), completion: 'no_change', ...patch };
}

describe('新世界候选纯内存合并', () => {
  it('人物 changed 必须有真实写集，no_change 不得携带伪写集', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.actors = [actor('a')];
    expect(() => materializeWorldRoundCandidate_ACU(base, round(base, {
      actorCompletions: [{ actorId: 'a', completion: 'changed', expectedRevision: 1 }], completion: 'no_change',
    }))).toThrow(/未变化却标记 changed/);
    const sameActor = actor('a', { revision: 2 });
    expect(() => materializeWorldRoundCandidate_ACU(base, round(base, {
      actorWrites: [{ value: sameActor, expectedRevision: 1 }],
      actorCompletions: [{ actorId: 'a', completion: 'changed', expectedRevision: 1 }], completion: 'changed',
    }))).toThrow(/未变化却标记 changed/);
    expect(() => materializeWorldRoundCandidate_ACU(base, round(base, {
      actorWrites: [{ value: sameActor, expectedRevision: 1 }],
      actorCompletions: [{ actorId: 'a', completion: 'no_change', expectedRevision: 1 }], completion: 'changed',
    }))).toThrow(/标记 no_change 却提供写入/);
  });

  it('已归档人物不能经新候选绕过 active roster 修改，初次出现的 archived 路人也不扩充 roster', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.actors = [actor('archived', { simulationStatus: 'archived' })];
    const update = actor('archived', { simulationStatus: 'archived', location: '远方', revision: 2 });
    expect(() => materializeWorldRoundCandidate_ACU(base, round(base, {
      actorWrites: [{ value: update, expectedRevision: 1 }], completion: 'changed',
    }))).toThrow(/归档人物 archived 不能进入本轮写集/);
    const passerby = actor('passing', { simulationStatus: 'archived' });
    expect(() => materializeWorldRoundCandidate_ACU(base, round(base, {
      actorWrites: [{ value: passerby, expectedRevision: 0 }], completion: 'changed',
    }))).toThrow(/新人物 passing 缺少完整 active 初始状态/);
    expect(base.actors[0].location).toBe('');
  });

  it('全部 active 返回 no_change 时允许无业务变化且不改基础账本', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.actors = [actor('z'), actor('a')];
    const snapshot = structuredClone(base);
    const next = materializeWorldRoundCandidate_ACU(base, round(base));
    expect(next.revision).toBe(base.revision + 1);
    expect(next.actors).toEqual(base.actors);
    expect(base).toEqual(snapshot);
  });

  it('时钟和投影纯对象键重排不构成变化，completion 仍为 no_change', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.clock = { day: 1, slot: '', storyTime: '第一日', precision: 'exact', evidenceRefs: ['时间见证'] };
    base.facts = [{ id: 'scene-fact', summary: '现场事实', temporalKind: 'occurrence',
      happenedAt: { day: 1, slot: '' }, validFrom: null, validUntil: null, locationRef: null,
      actorIds: [], worldEventIds: [], projectionPolicy: 'scene', revealState: 'unlocked', revealGate: null,
      nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 }];
    base.projection = { anchor: 'scene', deliveries: [{ factId: 'scene-fact', status: 'delivered', attempts: 1 }] };
    const snapshot = structuredClone(base);
    const candidate = round(base, {
      candidateClock: { evidenceRefs: ['时间见证'], precision: 'exact', storyTime: '第一日', slot: '', day: 1 },
      projection: { deliveries: [{ attempts: 1, status: 'delivered', factId: 'scene-fact' }], anchor: 'scene' },
    });
    const next = materializeWorldRoundCandidate_ACU(base, candidate);
    expect(next.clock).toEqual(base.clock);
    expect(next.projection).toEqual(base.projection);
    expect(base).toEqual(snapshot);
  });

  it('缺少任一人物批次的逐人覆盖证明时整轮不产生候选账本', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.actors = [actor('z'), actor('a')];
    const candidate = round(base, { actorCompletions: [{ actorId: 'a', completion: 'no_change', expectedRevision: 1 }] });
    expect(() => materializeWorldRoundCandidate_ACU(base, candidate)).toThrow(/z 缺少本轮覆盖证明/);
    expect(base.revision).toBe(0);
  });

  it('同轮新建 active 必须完整初始化和 changed；同轮归档旧 active 仍需证明', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.actors = [actor('old')];
    const afterOld = actor('old', { revision: 2, simulationStatus: 'archived' });
    const newActor = actor('new', { revision: 1 });
    const candidate = round(base, { actorWrites: [
      { value: afterOld, expectedRevision: 1 }, { value: newActor, expectedRevision: 0 },
    ], actorCompletions: [
      { actorId: 'old', completion: 'changed', expectedRevision: 1 },
      { actorId: 'new', completion: 'changed', expectedRevision: 0 },
    ], completion: 'changed' });
    expect(materializeWorldRoundCandidate_ACU(base, candidate).actors).toEqual([afterOld, newActor]);
    const incomplete = { ...candidate, actorWrites: [{ value: { ...newActor, loreRefs: undefined }, expectedRevision: 0 }] };
    expect(() => materializeWorldRoundCandidate_ACU(base, incomplete)).toThrow(/完整 active 初始状态/);
  });

  it('主时钟可推进但人物仍全员检查；任何失败都不修改旧时钟', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.actors = [actor('a')];
    const next = materializeWorldRoundCandidate_ACU(base, round(base, { candidateClock: { ...base.clock, day: 2 }, completion: 'changed' }));
    expect(next.clock.day).toBe(2);
    expect(base.clock.day).toBe(1);
    expect(() => materializeWorldRoundCandidate_ACU(base, round(base, { candidateClock: { ...base.clock, day: 2 }, actorCompletions: [], completion: 'changed' })))
      .toThrow(/缺少本轮覆盖证明/);
    expect(base.clock.day).toBe(1);
  });

  it('已入账事实不能原位改写，跨对象引用和锁定投影必须在合并后校验', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    const fact = { id: 'fact-1', summary: '合同已签', temporalKind: 'occurrence' as const,
      happenedAt: { day: 1, slot: '' }, validFrom: null, validUntil: null, locationRef: null,
      actorIds: [], worldEventIds: [], projectionPolicy: 'internal' as const, revealState: 'locked' as const,
      revealGate: null, nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 };
    const first = materializeWorldRoundCandidate_ACU(base, round(base, {
      factWrites: [{ value: fact, expectedRevision: 0 }], completion: 'changed',
    }));
    expect(first.facts[0].summary).toBe('合同已签');
    expect(() => materializeWorldRoundCandidate_ACU(first, round(first, {
      factWrites: [{ value: { ...fact, summary: '悄悄修改', revision: 2 }, expectedRevision: 1 }], completion: 'changed',
    }))).toThrow(/不能原位改写/);
    expect(() => materializeWorldRoundCandidate_ACU(base, round(base, {
      factWrites: [{ value: { ...fact, worldEventIds: ['missing'] }, expectedRevision: 0 }], completion: 'changed',
    }))).toThrow(/不存在的 event/);
    expect(() => materializeWorldRoundCandidate_ACU(base, round(base, {
      factWrites: [{ value: fact, expectedRevision: 0 }], completion: 'changed',
      projection: { anchor: 'scene', deliveries: [{ factId: 'fact-1', status: 'delivered', attempts: 1 }] },
    }))).toThrow(/不能自行改写 projection/);
    expect(base.facts).toEqual([]);
  });

  it('未取得语义 gate 许可前 gated fact 不得直接解锁或投影', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    const secret = { id: 'secret-1', summary: '秘密合同', temporalKind: 'occurrence' as const,
      happenedAt: { day: 1, slot: '' }, validFrom: null, validUntil: null,
      locationRef: { region: '上海', place: '广场' }, actorIds: [], worldEventIds: [],
      projectionPolicy: 'gated' as const, revealState: 'unlocked' as const, revealGate: { semanticCondition: '主动寻找' },
      nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 };
    expect(() => materializeWorldRoundCandidate_ACU(base, round(base, {
      factWrites: [{ value: secret, expectedRevision: 0 }], completion: 'changed',
    }))).toThrow(/不能绕过触发流程直接解锁/);
  });

  it('即使 scene fact 已解锁，新候选也不能伪造 delivered 或 acknowledged', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    const sceneFact = { id: 'scene-1', summary: '搭好舞台', temporalKind: 'occurrence' as const,
      happenedAt: { day: 1, slot: '' }, validFrom: null, validUntil: null,
      locationRef: { region: '上海', place: '广场' }, actorIds: [], worldEventIds: [],
      projectionPolicy: 'scene' as const, revealState: 'unlocked' as const, revealGate: null,
      nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 };
    const candidate = round(base, { factWrites: [{ value: sceneFact, expectedRevision: 0 }], completion: 'changed' });
    expect(materializeWorldRoundCandidate_ACU(base, candidate).facts).toHaveLength(1);
    for (const status of ['delivered', 'acknowledged', 'expired'] as const) {
      expect(() => materializeWorldRoundCandidate_ACU(base, {
        ...candidate, projection: { anchor: 'scene', deliveries: [{ factId: 'scene-1', status, attempts: 1 }] },
      })).toThrow(/不能自行改写 projection/);
    }
    expect(base.projection.deliveries).toEqual([]);
  });

  it('世界事件无变化不必重排 next-check，实际变化或收束必须产生结果事实', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    const event = { id: 'event-1', title: '持续谈判', state: '等待答复', status: 'active' as const,
      actorIds: [], organizationIds: [], locationRefs: [], startedAt: { day: 1, slot: '' },
      deadline: null, nextCheck: { day: 2, slot: '', reason: '等待答复' }, relatedEventIds: [], loreRefs: [],
      evidenceRefs: [], tags: [], revision: 1, legacy: null };
    base.worldEvents = [event];
    const snapshot = structuredClone(base);
    expect(materializeWorldRoundCandidate_ACU(base, round(base, {
      worldEventWrites: [{ value: { ...event, revision: 2 }, expectedRevision: 1 }], completion: 'changed',
    })).worldEvents[0]).toEqual({ ...event, revision: 2 });
    expect(base).toEqual(snapshot);
    const nextCheck = { ...event, revision: 2, nextCheck: { day: 3, slot: '', reason: '明天再问' } };
    expect(materializeWorldRoundCandidate_ACU(base, round(base, { worldEventWrites: [{ value: nextCheck, expectedRevision: 1 }],
      completion: 'changed' })).worldEvents[0].nextCheck).toEqual(nextCheck.nextCheck);
    const resultFact = { id: 'result-1', summary: '谈判已经结束', temporalKind: 'occurrence' as const,
      happenedAt: { day: 2, slot: '' }, validFrom: null, validUntil: null, locationRef: null,
      actorIds: [], worldEventIds: ['event-1'], projectionPolicy: 'internal' as const,
      revealState: 'locked' as const, revealGate: null, nextCheck: null, sourceRefs: [], evidenceRefs: [],
      supersedesFactIds: [], revision: 1 };
    expect(() => materializeWorldRoundCandidate_ACU(base, round(base, {
      worldEventWrites: [{ value: nextCheck, expectedRevision: 1 }],
      factWrites: [{ value: resultFact, expectedRevision: 0 }], completion: 'changed',
    }))).toThrow(/仅复查不能制造结果事实/);
    const resolved = { ...event, revision: 2, state: '谈判已结束', status: 'resolved' as const, nextCheck: null };
    expect(() => materializeWorldRoundCandidate_ACU(base, round(base, {
      candidateClock: { ...base.clock, day: 2 }, worldEventWrites: [{ value: resolved, expectedRevision: 1 }], completion: 'changed',
    }))).toThrow(/缺少确定结果事实/);
    expect(materializeWorldRoundCandidate_ACU(base, round(base, {
      candidateClock: { ...base.clock, day: 2 }, worldEventWrites: [{ value: resolved, expectedRevision: 1 }],
      factWrites: [{ value: resultFact, expectedRevision: 0 }], completion: 'changed',
    })).facts.map(item => item.id)).toEqual(['result-1']);
    expect(base.worldEvents[0].status).toBe('active');
  });

  it.each(['resolved', 'cancelled'] as const)('世界事件 %s 允许本轮逾期结果发生在基础日与候选日之间', status => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.clock.day = 5;
    const event = { id: 'event-elapsed', title: '远方谈判', state: '等待答复', status: 'active' as const,
      actorIds: [], organizationIds: [], locationRefs: [], startedAt: { day: 5, slot: '' },
      deadline: null, nextCheck: { day: 6, slot: '', reason: '等待答复' }, relatedEventIds: [], loreRefs: [],
      evidenceRefs: [], tags: [], revision: 1, legacy: null };
    base.worldEvents = [event];
    const snapshot = structuredClone(base);
    const ended = { ...event, revision: 2, status, state: '谈判已收束', nextCheck: null };
    const result = { id: 'event-result', summary: '谈判已收束', temporalKind: 'occurrence' as const,
      happenedAt: { day: 6, slot: '' }, validFrom: null, validUntil: null, locationRef: null,
      actorIds: [], worldEventIds: [event.id], projectionPolicy: 'internal' as const, revealState: 'locked' as const,
      revealGate: null, nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 };
    const candidate = round(base, { candidateClock: { ...base.clock, day: 7 },
      worldEventWrites: [{ value: ended, expectedRevision: 1 }],
      factWrites: [{ value: result, expectedRevision: 0 }], completion: 'changed' });
    expect(materializeWorldRoundCandidate_ACU(base, candidate).facts[0].happenedAt?.day).toBe(6);
    expect(() => materializeWorldRoundCandidate_ACU(base, {
      ...candidate, factWrites: [{ value: { ...result, happenedAt: { day: 4, slot: '' } }, expectedRevision: 0 }],
    })).toThrow(/收束时缺少本轮确定结果/);
    expect(() => materializeWorldRoundCandidate_ACU(base, {
      ...candidate, factWrites: [{ value: { ...result, happenedAt: { day: 8, slot: '' } }, expectedRevision: 0 }],
    })).toThrow(/尚未在候选时间成立/);
    expect(() => materializeWorldRoundCandidate_ACU(base, { ...candidate, factWrites: [] }))
      .toThrow(/缺少确定结果事实/);
    expect(base).toEqual(snapshot);
  });

  it.each(['done', 'abandoned'] as const)('短期事务 %s 有具体上一轮结果时不另交事实也可归档经历', status => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    const ongoing = { text: '查验密信', expectedDuration: '两日', startedAtDay: 1, startedAt: '第一日', status: 'ongoing' as const, outcome: null };
    base.clock.day = 2;
    base.actors = [actor('a', { shortTermAction: ongoing, longTermAction: { ...ongoing } }), actor('b')];
    const ended = { ...ongoing, status, outcome: '查验结束' };
    const result = '密信核验完毕，封口完好。';
    const candidate = round(base, {
      candidateClock: { ...base.clock, day: 3 },
      actorWrites: [{ value: { ...base.actors[0], previousActionResult: result,
        shortTermAction: ended, longTermAction: { ...ended }, revision: 2 }, expectedRevision: 1 }],
      actorCompletions: [{ actorId: 'a', completion: 'changed', expectedRevision: 1 }, { actorId: 'b', completion: 'no_change', expectedRevision: 1 }],
      completion: 'changed',
    });
    const snapshot = structuredClone(base);
    const originalCandidate = structuredClone(candidate);
    const next = materializeWorldRoundCandidate_ACU(base, candidate);
    expect(next.actors[0]).toMatchObject({ previousActionResult: result,
      experiences: [{ status, outcome: '查验结束', endedAtDay: 3 }] });
    expect(next.actors[0].shortTermAction).toBeNull();
    expect(next.actors[0].longTermAction).toBeNull();
    expect(next.actors[1]).toEqual(base.actors[1]);
    expect(next.facts).toEqual([]);
    expect(base).toEqual(snapshot);
    expect(candidate).toEqual(originalCandidate);
  });

  it('事实、历史节点与事件收束不能写入候选时间尚未发生的结果', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    const futureFact = { id: 'future', summary: '尚未发生的合同签署', temporalKind: 'occurrence' as const,
      happenedAt: { day: 3, slot: '' }, validFrom: null, validUntil: null, locationRef: null,
      actorIds: [], worldEventIds: [], projectionPolicy: 'internal' as const, revealState: 'locked' as const,
      revealGate: null, nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 };
    const milestone = { id: 'milestone-future', summary: '尚未发生的变故', happenedAt: { day: 3, slot: '' },
      actorIds: [], worldEventIds: [], locationRef: null, sourceFactIds: [], importance: 2,
      category: '人生节点', visibility: 'internal' as const, revision: 1, legacyRefs: [] };
    const snapshot = structuredClone(base);
    expect(() => materializeWorldRoundCandidate_ACU(base, round(base, {
      factWrites: [{ value: futureFact, expectedRevision: 0 }], completion: 'changed',
    }))).toThrow(/尚未在候选时间成立/);
    expect(() => materializeWorldRoundCandidate_ACU(base, round(base, {
      historyMilestoneWrites: [{ value: milestone, expectedRevision: 0 }], completion: 'changed',
    }))).toThrow(/历史节点 milestone-future 尚未发生/);
    const event = { id: 'event-future', title: '未来活动', state: '结束', status: 'resolved' as const,
      actorIds: [], organizationIds: [], locationRefs: [], startedAt: { day: 3, slot: '' },
      deadline: null, nextCheck: null, relatedEventIds: [], loreRefs: [], evidenceRefs: [], tags: [],
      revision: 1, legacy: null };
    expect(() => materializeWorldRoundCandidate_ACU(base, round(base, {
      worldEventWrites: [{ value: event, expectedRevision: 0 }],
      factWrites: [{ value: { ...futureFact, happenedAt: { day: 1, slot: '' }, worldEventIds: ['event-future'] }, expectedRevision: 0 }],
      completion: 'changed',
    }))).toThrow(/起点尚未发生/);
    expect(base).toEqual(snapshot);
  });

  it('客观事实不会自动进入人物认知，人物候选仍保留原有已知事实更新入口', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.actors = [actor('a', { knownFacts: ['亲眼见过邻居'], informationSources: ['亲眼目击'] })];
    const fact = { id: 'fact-1', summary: '客观发生的事', temporalKind: 'occurrence' as const,
      happenedAt: { day: 1, slot: '' }, validFrom: null, validUntil: null, locationRef: null,
      actorIds: [], worldEventIds: [], projectionPolicy: 'internal' as const, revealState: 'locked' as const,
      revealGate: null, nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 };
    const factOnly = materializeWorldRoundCandidate_ACU(base, round(base, {
      factWrites: [{ value: fact, expectedRevision: 0 }], completion: 'changed',
    }));
    expect(factOnly.actors[0].knownFacts).toEqual(['亲眼见过邻居']);
    const updated = actor('a', { knownFacts: ['亲眼见过邻居', '亲眼见到客观事实'], informationSources: ['亲眼目击'], revision: 2 });
    const next = materializeWorldRoundCandidate_ACU(base, round(base, {
      actorWrites: [{ value: updated, expectedRevision: 1 }],
      actorCompletions: [{ actorId: 'a', completion: 'changed', expectedRevision: 1 }], completion: 'changed',
    }));
    expect(next.actors[0].knownFacts).toEqual(updated.knownFacts);
    expect(base.actors[0].knownFacts).toEqual(['亲眼见过邻居']);
  });

  it('仅对实际写入人物按候选时钟盖 current 与 ongoing 短期事务，未写 active 保持原样', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    const originalAction = { text: '巡查码头', expectedDuration: '半日', startedAtDay: 1, startedAt: '第一日清晨' };
    const originalShort = { text: '清点货箱', expectedDuration: '一日', startedAtDay: 1, startedAt: '第一日清晨', status: 'ongoing' as const, outcome: null };
    base.actors = [
      actor('written', { currentAction: originalAction, shortTermAction: originalShort, longTermAction: { ...originalShort } }),
      actor('untouched', { currentAction: originalAction, shortTermAction: originalShort, longTermAction: { ...originalShort } }),
    ];
    const snapshot = structuredClone(base);
    const candidateAction = { ...originalAction, startedAtDay: 999, startedAt: '模型自填时间' };
    const candidateShort = { text: '转移货箱', expectedDuration: '两日', startedAtDay: 999, startedAt: '模型自填时间', status: 'ongoing' as const, outcome: null };
    const written = actor('written', { location: '码头仓库', currentAction: candidateAction,
      shortTermAction: candidateShort, longTermAction: { ...candidateShort }, revision: 2 });
    const next = materializeWorldRoundCandidate_ACU(base, round(base, {
      candidateClock: { ...base.clock, day: 2, storyTime: '第二日午后' },
      actorWrites: [{ value: written, expectedRevision: 1 }],
      actorCompletions: [
        { actorId: 'written', completion: 'changed', expectedRevision: 1 },
        { actorId: 'untouched', completion: 'no_change', expectedRevision: 1 },
      ], completion: 'changed',
    }));
    expect(next.actors[0].currentAction).toEqual({ ...originalAction });
    expect(next.actors[0].shortTermAction).toEqual({ ...candidateShort, startedAtDay: 1, startedAt: '第一日清晨' });
    expect(next.actors[0].longTermAction).toEqual(next.actors[0].shortTermAction);
    expect(next.actors[1]).toEqual(base.actors[1]);
    expect(base).toEqual(snapshot);
  });

  it('仅篡改动作起点不能冒充人物业务变化', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    const action = { text: '巡查码头', expectedDuration: '半日', startedAtDay: 1, startedAt: '第一日清晨' };
    base.actors = [actor('a', { currentAction: action })];
    const candidate = round(base, {
      candidateClock: { ...base.clock, day: 2 },
      actorWrites: [{ value: actor('a', { currentAction: { ...action, startedAtDay: 999, startedAt: '模型时间' }, revision: 2 }), expectedRevision: 1 }],
      actorCompletions: [{ actorId: 'a', completion: 'changed', expectedRevision: 1 }], completion: 'changed',
    });
    const snapshot = structuredClone(candidate);
    expect(() => materializeWorldRoundCandidate_ACU(base, candidate)).toThrow('未变化却标记 changed');
    expect(candidate).toEqual(snapshot);
    expect(base.actors[0].currentAction).toEqual(action);
  });

  it('更换 currentAction 时按候选时钟重盖起点', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.actors = [actor('a', { currentAction: { text: '旧行动', expectedDuration: '一日', startedAtDay: 1, startedAt: '第一日' } })];
    const replacement = actor('a', { currentAction: { text: '新行动', expectedDuration: '一日', startedAtDay: 999, startedAt: '模型自填时间' }, revision: 2 });
    const next = materializeWorldRoundCandidate_ACU(base, round(base, {
      candidateClock: { ...base.clock, day: 2, storyTime: '第二日' },
      actorWrites: [{ value: replacement, expectedRevision: 1 }],
      actorCompletions: [{ actorId: 'a', completion: 'changed', expectedRevision: 1 }], completion: 'changed',
    }));
    expect(next.actors[0].currentAction).toEqual({ text: '新行动', expectedDuration: '一日', startedAtDay: 2, startedAt: '第二日' });
  });

  it.each(['done', 'abandoned'] as const)('显式 %s 的短期事务归入经历并清空双字段', status => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    const oldShort = { text: '追查线索', expectedDuration: '三日', startedAtDay: 1, startedAt: '第一日', status: 'ongoing' as const, outcome: null };
    base.actors = [actor('a', { knownFacts: ['原有认知'], shortTermAction: oldShort, longTermAction: { ...oldShort } })];
    const finished = { text: '追查线索', expectedDuration: '三日', startedAtDay: 999, startedAt: '模型自填时间', status, outcome: '找到藏匿处' };
    const next = materializeWorldRoundCandidate_ACU(base, round(base, {
      candidateClock: { ...base.clock, day: 2, storyTime: '第二日夜晚' },
      actorWrites: [{ value: actor('a', { knownFacts: ['原有认知'], previousActionResult: '找到藏匿处',
        shortTermAction: finished, longTermAction: { ...finished }, revision: 2 }), expectedRevision: 1 }],
      actorCompletions: [{ actorId: 'a', completion: 'changed', expectedRevision: 1 }], completion: 'changed',
    }));
    expect(next.actors[0].shortTermAction).toBeNull();
    expect(next.actors[0].longTermAction).toBeNull();
    expect(next.actors[0].knownFacts).toEqual(['原有认知']);
    expect(next.actors[0].previousActionResult).toBe('找到藏匿处');
    expect(next.facts).toEqual([]);
    expect(next.actors[0].experiences).toEqual([{ text: '追查线索', expectedDuration: '三日', startedAtDay: 1, startedAt: '第一日',
      endedAtDay: 2, endedAt: '第二日夜晚', status, outcome: '找到藏匿处' }]);
  });
});

describe('历史纪要冷热分层', () => {
  function milestone(id: string, day: number, actorIds = ['a', 'b']) {
    return { id, summary: `${id} 历史节点`, happenedAt: { day, slot: '' }, actorIds, worldEventIds: [],
      locationRef: null, sourceFactIds: [], importance: 2, category: '事件', visibility: 'internal' as const,
      revision: 1, legacyRefs: [] };
  }
  const recorded: NonNullable<WorldHistoryMilestone_ACU['narrativeRecord']> = {
    status: 'recorded', recordedAt: { day: 1, slot: '' }, anchorDigest: 'a'.repeat(64),
    deliveryQuote: '正文写下旧事', evidenceQuote: '回执确认旧事已投送',
  };
  const recording = (historyId: string, expectedRevision = 1) => ({ historyId, expectedRevision, record: structuredClone(recorded) });

  it('热史记载移冷、原业务正文不改，已有冷史记载不复热且重复同标记不递增', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.actors = [actor('a'), actor('b')];
    const hot = { ...milestone('hot', 1), sourceFactIds: ['source'], legacyRefs: ['legacy'] };
    base.facts = [{ id: 'source', summary: '来源', temporalKind: 'occurrence', happenedAt: { day: 1, slot: '' },
      validFrom: null, validUntil: null, locationRef: null, actorIds: [], worldEventIds: [],
      projectionPolicy: 'internal', revealState: 'locked', revealGate: null, nextCheck: null,
      sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 }];
    base.historyMilestones = [hot];
    base.historyArchive = [milestone('cold', 1)];
    const snapshot = structuredClone(base);
    const next = materializeWorldRoundCandidate_ACU(base, round(base, {
      historyRecordings: [recording('hot'), recording('cold')], completion: 'changed',
    }));
    expect(next.clock).toEqual(base.clock);
    expect(next.historyMilestones).toEqual([]);
    expect(next.historyArchive).toEqual([
      { ...base.historyArchive[0], revision: 2, narrativeRecord: recorded },
      { ...hot, revision: 2, narrativeRecord: recorded },
    ]);
    expect(base).toEqual(snapshot);
    const replay = materializeWorldRoundCandidate_ACU(next, round(next, {
      historyRecordings: [recording('hot'), { ...recording('cold'), record: {
        evidenceQuote: recorded.evidenceQuote, deliveryQuote: recorded.deliveryQuote, anchorDigest: recorded.anchorDigest,
        recordedAt: { slot: recorded.recordedAt.slot, day: recorded.recordedAt.day }, status: recorded.status,
      } }], completion: 'no_change',
    }));
    expect(replay.historyArchive).toEqual(next.historyArchive);
    expect(replay.historyMilestones).toEqual([]);
  });

  it('历史记录严格校验存在、版本、结构与时钟，失败不落半账本', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.historyMilestones = [milestone('hot', 1, [])];
    const snapshot = structuredClone(base);
    for (const entry of [
      recording('missing'), recording('hot', 0),
      { ...recording('hot'), record: { ...recorded, status: 'sent' } },
      { ...recording('hot'), record: { ...recorded, deliveryQuote: ' ' } },
      { ...recording('hot'), record: { ...recorded, recordedAt: { day: 2, slot: '' } } },
    ]) {
      expect(() => materializeWorldRoundCandidate_ACU(base, round(base, {
        historyRecordings: [recording('hot'), entry] as WorldRoundCandidate_ACU['historyRecordings'], completion: 'changed',
      }))).toThrow();
      expect(base).toEqual(snapshot);
    }
    expect(() => materializeWorldRoundCandidate_ACU(base, round(base, {
      historyRecordings: [recording('hot', 0)], completion: 'changed',
    }))).toThrow(/expectedRevision 冲突/);
  });

  it('普通历史写集不能自报正文记录，也不能改写热史；旧无标记路径保持原样', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.historyMilestones = [milestone('old', 1, [])];
    expect(() => materializeWorldRoundCandidate_ACU(base, round(base, {
      historyMilestoneWrites: [{ value: { ...milestone('new', 1, []), narrativeRecord: recorded }, expectedRevision: 0 }],
      completion: 'changed',
    }))).toThrow(/不能自行声明正文记载/);
    expect(() => materializeWorldRoundCandidate_ACU(base, round(base, {
      historyMilestoneWrites: [{ value: { ...milestone('old', 1, []), revision: 2 }, expectedRevision: 1 }],
      completion: 'changed',
    }))).toThrow(/不能原位改写/);
    const next = materializeWorldRoundCandidate_ACU(base, round(base));
    expect(next.historyMilestones).toEqual(base.historyMilestones);
    expect(next.historyArchive).toBeUndefined();
  });

  it('仅标记历史、候选时钟不变也算 changed，no_change 不可冒充', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.historyMilestones = [milestone('old', 1, [])];
    const candidate = round(base, { historyRecordings: [recording('old')], completion: 'changed' });
    expect(materializeWorldRoundCandidate_ACU(base, candidate).historyArchive?.[0].revision).toBe(2);
    expect(() => materializeWorldRoundCandidate_ACU(base, { ...candidate, completion: 'no_change' })).toThrow(/完成状态/);
  });

  it('新候选成功后把 33 条完整纪要稳定分为 32 条热层和 1 条冷层，不复制也不改基础账本', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.actors = [actor('a'), actor('b')];
    base.historyMilestones = Array.from({ length: 32 }, (_, index) => milestone(`old-${index}`, index + 1));
    const snapshot = structuredClone(base);
    const next = materializeWorldRoundCandidate_ACU(base, round(base, {
      candidateClock: { ...base.clock, day: 33 },
      historyMilestoneWrites: [{ value: milestone('new-33', 33), expectedRevision: 0 }], completion: 'changed',
    }));

    expect(next.historyMilestones).toHaveLength(32);
    expect(next.historyArchive).toEqual([milestone('old-0', 1)]);
    expect(next.historyMilestones[0].id).toBe('new-33');
    expect(new Set([...next.historyMilestones, ...next.historyArchive!].map(item => item.id)).size).toBe(33);
    expect(base).toEqual(snapshot);

    const replay = materializeWorldRoundCandidate_ACU(next, round(next));
    expect(replay.historyMilestones).toEqual(next.historyMilestones);
    expect(replay.historyArchive).toEqual(next.historyArchive);
  });

  it('冷层的既有 ID 不得经模型 historyMilestoneWrites 覆盖', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.historyArchive = [milestone('cold-1', 1, [])];
    expect(() => materializeWorldRoundCandidate_ACU(base, round(base, {
      historyMilestoneWrites: [{ value: { ...milestone('cold-1', 2, []), revision: 2 }, expectedRevision: 1 }],
      completion: 'changed',
    }))).toThrow(/不能原位改写/);
  });

  function fact(id: string, patch: Record<string, unknown> = {}) {
    return { id, summary: id, temporalKind: 'occurrence' as const, happenedAt: { day: 1, slot: '' }, validFrom: null,
      validUntil: null, locationRef: null, actorIds: [], worldEventIds: [], projectionPolicy: 'internal' as const,
      revealState: 'locked' as const, revealGate: null, nextCheck: null, sourceRefs: [], evidenceRefs: [],
      supersedesFactIds: [], revision: 1, ...patch };
  }

  it('已成立 replacement 才归档 superseded 热事实；同日未知 slot 不提前归档', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.clock = { ...base.clock, day: 2, slot: '傍晚' };
    base.facts = [fact('old')];
    const futureSameDay = fact('new', { happenedAt: { day: 2, slot: '上午' }, supersedesFactIds: ['old'] });
    const before = structuredClone(base);
    const noArchive = materializeWorldRoundCandidate_ACU(base, round(base, {
      factWrites: [{ value: futureSameDay, expectedRevision: 0 }], completion: 'changed',
    }));
    expect(noArchive.facts.map(item => item.id)).toEqual(['old', 'new']);
    expect(noArchive.factArchive).toBeUndefined();
    const replacement = { ...futureSameDay, id: 'new-established', happenedAt: { day: 1, slot: '' } };
    const archived = materializeWorldRoundCandidate_ACU(before, round(before, {
      factWrites: [{ value: replacement, expectedRevision: 0 }], completion: 'changed',
    }));
    expect(archived.facts.map(item => item.id)).toEqual(['new-established']);
    expect(archived.factArchive?.map(item => item.id)).toEqual(['old']);
  });

  it('只冷藏明确过期条件，保留投送引用、待检查项和有效锁定秘密，历史来源仍完整', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.clock.day = 3;
    const expired = (id: string) => ({ ...fact(id), temporalKind: 'condition' as const, happenedAt: null,
      validFrom: { day: 1, slot: '' }, validUntil: { day: 2, slot: '' } });
    base.facts = [expired('cold'), { ...expired('review'), nextCheck: { day: 3, slot: '', reason: '复查' } },
      { ...expired('delivery'), projectionPolicy: 'scene', revealState: 'unlocked' }, fact('old-secret')];
    base.projection = { anchor: 'fact-archive-test', deliveries: [{ factId: 'delivery', status: 'delivered', attempts: 1 }] };
    base.historyMilestones = [{ id: 'history-source', summary: '重要结果', happenedAt: { day: 2, slot: '' },
      actorIds: [], worldEventIds: [], locationRef: null, sourceFactIds: ['cold'], importance: 3, category: '重大事件',
      visibility: 'internal', revision: 1, legacyRefs: [] }];
    const before = structuredClone(base);
    const next = materializeWorldRoundCandidate_ACU(base, round(base));
    expect(next.factArchive).toEqual([expired('cold')]);
    expect(next.facts.map(item => item.id)).toEqual(['review', 'delivery', 'old-secret']);
    expect(next.historyMilestones[0].sourceFactIds).toEqual(['cold']);
    expect(base).toEqual(before);
    expect(materializeWorldRoundCandidate_ACU(next, round(next)).factArchive).toEqual(next.factArchive);
    expect(() => materializeWorldRoundCandidate_ACU(next, round(next, {
      factWrites: [{ expectedRevision: 0, value: fact('cold') }], completion: 'changed',
    }))).toThrow(/不能原位改写/);
  });

  it('进入归档后保留十轮，第十一轮清理，同日无变化推演也计一轮', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.clock.day = 3;
    base.facts = [{ ...fact('expired'), temporalKind: 'condition', happenedAt: null,
      validFrom: { day: 1, slot: '' }, validUntil: { day: 2, slot: '' } }];
    const original = structuredClone(base);
    let next = materializeWorldRoundCandidate_ACU(base, round(base));
    expect(next.factArchiveRetention).toEqual({ completedRounds: 1, enteredAtRound: { expired: 1 } });
    for (let index = 0; index < 10; index++) next = materializeWorldRoundCandidate_ACU(next, round(next));
    expect(next.factArchive?.map(item => item.id)).toEqual(['expired']);
    expect(next.factArchiveRetention?.completedRounds).toBe(11);
    const retained = structuredClone(next);
    next = materializeWorldRoundCandidate_ACU(next, round(next));
    expect(next.factArchive).toEqual([]);
    expect(next.factArchiveRetention).toEqual({ completedRounds: 12, enteredAtRound: {} });
    expect(next.clock.day).toBe(3);
    expect(retained.factArchive).toHaveLength(1);
    expect(base).toEqual(original);
  });

  it('各事实独立计龄，旧归档首次遇到时从当前轮开始，不根据故事日数倒推', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.clock.day = 100;
    base.factArchive = [fact('legacy-cold')];
    let next = materializeWorldRoundCandidate_ACU(base, round(base));
    expect(next.factArchiveRetention).toEqual({ completedRounds: 1, enteredAtRound: { 'legacy-cold': 1 } });
    next = materializeWorldRoundCandidate_ACU(next, round(next, { candidateClock: { ...next.clock, day: 1000 }, completion: 'changed' }));
    expect(next.factArchive).toHaveLength(1);
    next.facts = [{ ...fact('later'), temporalKind: 'condition', happenedAt: null, validFrom: { day: 1, slot: '' }, validUntil: { day: 2, slot: '' } }];
    next = materializeWorldRoundCandidate_ACU(next, round(next));
    expect(next.factArchiveRetention?.enteredAtRound).toEqual({ 'legacy-cold': 1, later: 3 });
    for (let index = 0; index < 9; index++) next = materializeWorldRoundCandidate_ACU(next, round(next));
    expect(next.factArchive?.map(item => item.id)).toEqual(['later']);
    expect(next.factArchiveRetention?.enteredAtRound).toEqual({ later: 3 });
  });

  it('清理过期归档时移除失效来源引用但保留重要历史内容', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.factArchive = [fact('expired')];
    base.factArchiveRetention = { completedRounds: 10, enteredAtRound: { expired: 0 } };
    base.facts = [fact('replacement', { supersedesFactIds: ['expired'] })];
    const history = { id: 'history', summary: '永久保留的重要转折', happenedAt: { day: 1, slot: '' }, actorIds: [], worldEventIds: [],
      locationRef: null, sourceFactIds: ['expired'], importance: 3, category: '人生节点', visibility: 'internal' as const, revision: 1, legacyRefs: [] };
    base.historyMilestones = [history];
    base.historyArchive = [{ ...history, id: 'cold-history' }];
    const next = materializeWorldRoundCandidate_ACU(base, round(base));
    expect(next.factArchive).toEqual([]);
    expect(next.facts[0].supersedesFactIds).toEqual([]);
    expect([...next.historyMilestones, ...(next.historyArchive ?? [])]).toHaveLength(2);
    expect([...next.historyMilestones, ...(next.historyArchive ?? [])].every(item => item.sourceFactIds.length === 0 && item.summary === history.summary)).toBe(true);
    expect(base.historyMilestones[0].sourceFactIds).toEqual(['expired']);
  });

  it('预检同一候选不会累计轮次，失败候选也不改变归档计龄', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.factArchive = [fact('cold')];
    base.factArchiveRetention = { completedRounds: 5, enteredAtRound: { cold: 1 } };
    const before = structuredClone(base);
    const candidate = round(base);
    expect(materializeWorldRoundCandidate_ACU(base, candidate).factArchiveRetention?.completedRounds).toBe(6);
    expect(materializeWorldRoundCandidate_ACU(base, candidate).factArchiveRetention?.completedRounds).toBe(6);
    expect(() => materializeWorldRoundCandidate_ACU(base, round(base, { completion: 'changed' }))).toThrow();
    expect(base).toEqual(before);
  });

  it('已有冷事实不因后续读取条件变化复活', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.factArchive = [fact('cold', { nextCheck: { day: 9, slot: '', reason: '后续复核' } })];
    const next = materializeWorldRoundCandidate_ACU(base, round(base));
    expect(next.facts).toEqual([]);
    expect(next.factArchive?.map(item => item.id)).toEqual(['cold']);
  });
});

const reviewedAnchorText = '我主动向守卫询问那封密信的去向。';
const reviewedPlace = { region: '上海', place: '广场' } as const;
const reviewedAnchorDigest = sha256HexSync_ACU(reviewedAnchorText);
const reviewedIdentity = {
  kind: 'host' as const, runId: 'reviewed-run', chatIdentity: 'reviewed-chat', triggerKind: 'assistant_completed' as const,
  triggerConversationMessageId: null, anchorContentDigest: reviewedAnchorDigest, baseLedgerRevision: 0,
  taskId: 'reviewed-task', stageId: 'reviewed-stage', stageRevision: 1, deliveryTarget: 'body' as const,
  workflowMode: 'single' as const, workflowProtocol: 'world-round-v1' as const,
  anchorMessageId: 'reviewed-message', anchorMessageKey: 'reviewed-key', anchorSwipeId: 'reviewed-swipe',
};
const reviewedAnchor = { chatIdentity: 'reviewed-chat', messageIndex: 1, messageId: 'reviewed-message',
  messageKey: 'reviewed-key', swipeId: 'reviewed-swipe', contentDigest: reviewedAnchorDigest } as const;

function reviewedFact(id = 'secret-1', patch: Partial<import('../../../src/service/simulation/model').WorldFact_ACU> = {}) {
  return { id, summary: '不得泄漏的秘密摘要', temporalKind: 'occurrence' as const, happenedAt: { day: 3, slot: '' }, validFrom: null,
    validUntil: null, locationRef: reviewedPlace, actorIds: [], worldEventIds: [], projectionPolicy: 'gated' as const,
    revealState: 'locked' as const, revealGate: { semanticCondition: '玩家主动询问守卫关于密信', actorIds: ['guard-1'], locationRef: reviewedPlace, notBefore: { day: 3, slot: '' } },
    nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1, ...patch };
}
function reviewedBase() {
  const base = buildEmptyWorldSimulationLedger_ACU();
  base.revision = 5;
  base.clock = { day: 3, slot: '', storyTime: '第三日', precision: 'exact', evidenceRefs: [] };
  base.player.location = { ...reviewedPlace };
  base.facts = [reviewedFact()];
  base.actors = [actor('guard-1', { location: '广场', locationRef: { ...reviewedPlace }, visibility: 'limited' })];
  return base;
}
function reviewedSettings() {
  const settings = buildDefaultWorldSimulationSettings_ACU();
  settings.workflowMode = 'single';
  settings.agentReadTokenBudget = 1000;
  settings.agentReadFallbackTokens = 1000;
  return settings;
}
async function issueReviewedProof(base: WorldSimulationLedger_ACU, identityPatch: Partial<typeof reviewedIdentity> = {}) {
  const settings = reviewedSettings();
  const identity = { ...reviewedIdentity, baseLedgerRevision: base.revision, ...identityPatch };
  const targetAnchor = { ...reviewedAnchor };
  const stage = await runWorldProjectionStage_ACU({ ledger: base, identity, targetAnchor,
    anchorText: reviewedAnchorText, sceneLocation: reviewedPlace, contactedActorIds: ['guard-1'], settings,
    signal: new AbortController().signal, isCurrent: () => true, countTokens: async () => 1,
    invoke: async () => JSON.stringify({ reviews: [{ factId: 'secret-1', triggered: true, evidence: [{ quote: '主动向守卫询问那封密信' }] }] }),
  });
  const prepared = await prepareWorldFactRevealProof_ACU({ receipt: stage.receipt, ledger: base, identity, targetAnchor,
    anchorText: reviewedAnchorText, clock: base.clock, sceneLocation: reviewedPlace, contactedActorIds: ['guard-1'], settings,
    signal: new AbortController().signal, isCurrent: () => true, countTokens: async () => 1,
  });
  return { ...prepared, identity, targetAnchor };
}

describe('受审世界候选纯内存揭示', () => {
  it('受审预览纳入历史记载，正式提交只归档一次且不重写历史业务内容', async () => {
    const base = reviewedBase();
    const history: WorldHistoryMilestone_ACU = { id: 'reviewed-history', summary: '守卫曾收信',
      happenedAt: { day: 1, slot: '' }, actorIds: ['guard-1'], worldEventIds: [], locationRef: null,
      sourceFactIds: [], importance: 3, category: '人生节点', visibility: 'internal', revision: 1, legacyRefs: [] };
    base.historyMilestones = [history];
    const record: NonNullable<WorldHistoryMilestone_ACU['narrativeRecord']> = {
      status: 'recorded', recordedAt: { day: 3, slot: '' }, anchorDigest: reviewedAnchorDigest,
      deliveryQuote: '守卫曾收信', evidenceQuote: '我询问了守卫收信之事',
    };
    const candidate = round(base, { historyRecordings: [{ historyId: history.id, expectedRevision: 1, record }], completion: 'changed' });
    const preview = materializeWorldRoundCandidate_ACU(base, candidate);
    const auth = await issueReviewedProof(preview);
    const next = materializeReviewedWorldRoundCandidate_ACU(base, candidate, auth);
    expect(next.historyArchive).toEqual([{ ...history, narrativeRecord: record, revision: 2 }]);
    expect(next.historyMilestones).toEqual([]);
    expect(next.facts[0]).toMatchObject({ revealState: 'unlocked', revision: 2 });
    expect(base.historyMilestones).toEqual([history]);
  });

  it('真实 stage proof 只解锁既有 gated fact，保持其余账本和基础账本不变', async () => {
    const base = reviewedBase();
    const snapshot = structuredClone(base);
    const preview = materializeWorldRoundCandidate_ACU(base, round(base));
    const authorization = await issueReviewedProof(preview);
    const next = materializeReviewedWorldRoundCandidate_ACU(base, round(base, { completion: 'changed' }), authorization);
    expect(next.facts).toHaveLength(1);
    expect(next.facts[0]).toEqual({ ...base.facts[0], revealState: 'unlocked', revision: 2 });
    expect(next.actors).toEqual(base.actors);
    expect(next.clock).toEqual(base.clock);
    expect(next.projection).toEqual(base.projection);
    expect(base).toEqual(snapshot);
  });

  it('受审解锁可与同轮新事实一起物化，proof 仍只改变既有 locked gated fact', async () => {
    const base = reviewedBase();
    const previewCandidate = round(base, {
      factWrites: [{ value: { ...reviewedFact('new-scene-fact'), projectionPolicy: 'scene' as const, revealState: 'unlocked' as const,
        revealGate: null, summary: '本轮新场景事实' }, expectedRevision: 0 }],
      completion: 'changed',
    });
    const preview = materializeWorldRoundCandidate_ACU(base, previewCandidate);
    const authorization = await issueReviewedProof(preview);
    const next = materializeReviewedWorldRoundCandidate_ACU(base, previewCandidate, authorization);
    expect(next.facts.find(fact => fact.id === 'secret-1')).toMatchObject({ revealState: 'unlocked', revision: 2 });
    expect(next.facts.find(fact => fact.id === 'new-scene-fact')).toMatchObject({ revealState: 'unlocked', revision: 1 });
  });

  it('受审解锁沿用同一人物盖戳预览，提交不重复归档或改写候选', async () => {
    const base = reviewedBase();
    base.historyMilestones = Array.from({ length: 33 }, (_, index) => ({ id: `reviewed-history-${String(index).padStart(2, '0')}`,
      summary: `重要历史-${index}`, happenedAt: { day: 1, slot: '' }, actorIds: ['guard-1'], worldEventIds: [], locationRef: null,
      sourceFactIds: [], importance: 3, category: '人生节点', visibility: 'internal' as const, revision: 1, legacyRefs: [] }));
    base.facts.push({ ...reviewedFact('expired-proof-source'), projectionPolicy: 'internal', revealGate: null,
      temporalKind: 'condition', happenedAt: null, validFrom: { day: 1, slot: '' }, validUntil: { day: 2, slot: '' } });
    const prior = { text: '查验密信', expectedDuration: '两日', startedAtDay: 1, startedAt: '第一日', status: 'ongoing' as const, outcome: null };
    base.actors[0] = { ...base.actors[0], shortTermAction: prior, longTermAction: { ...prior } };
    const ended = { ...prior, status: 'done' as const, outcome: '查验完毕', startedAtDay: 999, startedAt: '模型时间' };
    const candidate = round(base, {
      actorWrites: [{ value: { ...base.actors[0], shortTermAction: ended, longTermAction: { ...ended }, revision: 2 }, expectedRevision: 1 }],
      factWrites: [{ value: { ...reviewedFact('letter-checked'), summary: '守卫查验密信结束', actorIds: ['guard-1'], projectionPolicy: 'internal',
        revealGate: null, happenedAt: { day: 3, slot: '' } }, expectedRevision: 0 }],
      actorCompletions: [{ actorId: 'guard-1', completion: 'changed', expectedRevision: 1 }], completion: 'changed',
    });
    const snapshot = structuredClone(candidate);
    const preview = materializeWorldRoundCandidate_ACU(base, candidate);
    const authorization = await issueReviewedProof(preview);
    const next = materializeReviewedWorldRoundCandidate_ACU(base, candidate, authorization);
    expect(next.actors).toEqual(preview.actors);
    expect(next.historyMilestones).toHaveLength(32);
    expect(next.historyArchive).toEqual(preview.historyArchive);
    expect(next.historyArchive).toHaveLength(1);
    expect(next.factArchive).toEqual(preview.factArchive);
    expect(next.factArchive).toMatchObject([{ id: 'expired-proof-source', revealState: 'locked' }]);
    expect(base.factArchive).toBeUndefined();
    expect(base.historyMilestones).toHaveLength(33);
    expect(base.historyArchive).toBeUndefined();
    expect(next.actors[0].experiences).toMatchObject([{ text: '查验密信', startedAtDay: 1, endedAtDay: 3, status: 'done' }]);
    expect(next.actors[0].shortTermAction).toBeNull();
    expect(next.facts[0]).toMatchObject({ revealState: 'unlocked', revision: 2 });
    expect(candidate).toEqual(snapshot);
    expect(base.actors[0].experiences).toEqual([]);
  });

  it('纯揭示的最终 completion 为 changed，而未解锁预览为 no_change', async () => {
    const base = reviewedBase();
    const preview = materializeWorldRoundCandidate_ACU(base, round(base));
    const authorization = await issueReviewedProof(preview);
    expect(() => materializeReviewedWorldRoundCandidate_ACU(base, round(base), authorization)).toThrow(/必须为 changed/);
  });

  it('拒绝伪造、重用或变更预览身份的 proof，且不改基础账本', async () => {
    const base = reviewedBase();
    const snapshot = structuredClone(base);
    await expect((async () => materializeReviewedWorldRoundCandidate_ACU(base, round(base, { completion: 'changed' }), {
      proof: {}, factIds: ['secret-1'], identity: reviewedIdentity, targetAnchor: reviewedAnchor,
    }))()).rejects.toThrow();
    const forged = await issueReviewedProof(materializeWorldRoundCandidate_ACU(base, round(base)));
    expect(() => materializeReviewedWorldRoundCandidate_ACU(base, round(base, { candidateClock: { ...base.clock, storyTime: '伪造预览' }, completion: 'changed' }), forged)).toThrow(/proof|预览/i);
    const valid = await issueReviewedProof(materializeWorldRoundCandidate_ACU(base, round(base)));
    materializeReviewedWorldRoundCandidate_ACU(base, round(base, { completion: 'changed' }), valid);
    expect(() => materializeReviewedWorldRoundCandidate_ACU(base, round(base, { completion: 'changed' }), valid)).toThrow(/proof|领取/i);
    expect(base).toEqual(snapshot);
  });

  it('缺少授权或跨 run 仍拒绝，同 run 同 swipe 正文变化不阻断受审结果', async () => {
    const base = reviewedBase();
    const preview = materializeWorldRoundCandidate_ACU(base, round(base));
    const valid = await issueReviewedProof(preview);
    const changedBody = '我主动向守卫询问那封密信的去向，但篡改了正文。';
    const changedDigest = sha256HexSync_ACU(changedBody);

    expect(() => materializeReviewedWorldRoundCandidate_ACU(base, round(base, { completion: 'changed' }), {
      proof: valid.proof, factIds: valid.factIds,
    } as never)).toThrow(/proof|身份|锚点/i);

    const foreign = await issueReviewedProof(preview, { runId: 'another-reviewed-run' });
    expect(() => materializeReviewedWorldRoundCandidate_ACU(base, round(base, { completion: 'changed' }), {
      proof: foreign.proof, factIds: foreign.factIds, identity: valid.identity, targetAnchor: valid.targetAnchor,
    })).toThrow(/proof|身份|锚点/i);

    const altered = await issueReviewedProof(preview);
    const adopted = materializeReviewedWorldRoundCandidate_ACU(base, round(base, { completion: 'changed' }), {
      proof: altered.proof, factIds: altered.factIds,
      identity: { ...altered.identity, anchorContentDigest: changedDigest },
      targetAnchor: { ...altered.targetAnchor, contentDigest: changedDigest },
    });
    expect(adopted.facts.find(fact => fact.id === altered.factIds[0])?.revealState).toBe('unlocked');
  });

  it('旧公开物化入口即使附加 proof 也保持拒绝旧 factWrites 和非空 projection', async () => {
    const base = reviewedBase();
    const preview = materializeWorldRoundCandidate_ACU(base, round(base));
    const authorization = await issueReviewedProof(preview);
    const publicMaterialize = materializeWorldRoundCandidate_ACU as (...args: unknown[]) => WorldSimulationLedger_ACU;

    expect(() => publicMaterialize(base, round(base, {
      factWrites: [{ value: { ...base.facts[0], revealState: 'unlocked', revision: 2 }, expectedRevision: 1 }], completion: 'changed',
    }), authorization)).toThrow(/不能原位改写/);
    expect(() => publicMaterialize(base, round(base, {
      projection: { anchor: 'forged', deliveries: [] }, completion: 'changed',
    }), authorization)).toThrow(/不能自行改写 projection/);
  });

  it('拒绝多 ID、非 gated、已解锁、缺人和非空 projection', async () => {
    const cases: Array<(base: WorldSimulationLedger_ACU, auth: Awaited<ReturnType<typeof issueReviewedProof>>) => WorldRoundCandidate_ACU | { candidate: WorldRoundCandidate_ACU; factIds: string[] }> = [
      (_base, _auth) => ({ candidate: round(_base, { completion: 'changed' }), factIds: ['secret-1', 'other'] }),
      (base) => ({ candidate: round(base, { factWrites: [{ value: reviewedFact('new'), expectedRevision: 0 }], completion: 'changed' }), factIds: ['secret-1'] }),
      (base) => ({ candidate: round(base, { actorCompletions: [], completion: 'changed' }), factIds: ['secret-1'] }),
      (base) => ({ candidate: round(base, { projection: { anchor: 'x', deliveries: [] }, completion: 'changed' }), factIds: ['secret-1'] }),
    ];
    for (const make of cases) {
      const base = reviewedBase(); const snapshot = structuredClone(base); const preview = materializeWorldRoundCandidate_ACU(base, round(base)); const auth = await issueReviewedProof(preview); const result = make(base, auth);
      const candidate = 'candidate' in result ? result.candidate : result;
      const factIds = 'factIds' in result ? result.factIds : auth.factIds;
      expect(() => materializeReviewedWorldRoundCandidate_ACU(base, candidate, {
        proof: auth.proof, factIds, identity: auth.identity, targetAnchor: auth.targetAnchor,
      })).toThrow();
      expect(base).toEqual(snapshot);
    }
    for (const patch of [
      { projectionPolicy: 'scene' as const }, { revealState: 'unlocked' as const },
    ]) {
      const base = reviewedBase(); base.facts = [reviewedFact('secret-1', patch)]; const snapshot = structuredClone(base);
      const proofBase = reviewedBase(); const auth = await issueReviewedProof(materializeWorldRoundCandidate_ACU(proofBase, round(proofBase)));
      expect(() => materializeReviewedWorldRoundCandidate_ACU(base, round(base, { completion: 'changed' }), auth)).toThrow();
      expect(base).toEqual(snapshot);
    }
  });
});
