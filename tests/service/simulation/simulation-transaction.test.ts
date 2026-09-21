import { describe, expect, it } from 'vitest';
import { buildEmptyWorldSimulationLedger_ACU } from '../../../src/service/simulation/defaults';
import { applyWorldSimulationCandidates_ACU, applyWorldSimulationCandidatesDetailed_ACU, preflightWorldSimulationCandidates_ACU } from '../../../src/service/simulation/simulation-transaction';
import { WORLD_CHRONICLE_OVERVIEW_CAP_ACU } from '../../../src/service/simulation/model';

const candidate = (patch: Record<string, unknown>, evidenceRefs = ['e1']) => ({
  candidateId: 'candidate:one', agentName: 'world-analyst', patch,
  summary: '候选', evidenceRefs, uncertainties: [], writableModules: ['clock', 'dimensions', 'seeds', 'actors', 'chronicle', 'player', 'rumors'],
});

describe('world simulation transaction', () => {
  it('按授权模块应用候选且账本 revision 只递增一次', () => {
    const next = applyWorldSimulationCandidates_ACU(
      buildEmptyWorldSimulationLedger_ACU(),
      [candidate({ clock: { days: 1, storyTime: '1h', evidenceRefs: ['e1'] } })],
      new Set(['e1']),
    );
    expect(next.revision).toBe(1);
    expect(next.clock).toMatchObject({ day: 2, storyTime: '1h', evidenceRefs: ['e1'] });
  });

  it('拒绝越权模块、未授权证据与条目 revision 冲突', () => {
    expect(() => applyWorldSimulationCandidates_ACU(
      buildEmptyWorldSimulationLedger_ACU(),
      [candidate({ guidance: { signals: ['泄露'] } })], new Set(['e1']),
    )).toThrow(/越权/);
    expect(() => applyWorldSimulationCandidates_ACU(
      buildEmptyWorldSimulationLedger_ACU(),
      [candidate({ clock: { evidenceRefs: ['e2'] } }, ['e2'])], new Set(['e1']),
    )).toThrow(/未授权/);
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.dimensions.push({ id: 'pressure', name: '压力', kind: 'pressure', value: 1, trend: 'stable', rationale: '', evidenceRefs: [], revision: 1 });
    expect(() => applyWorldSimulationCandidates_ACU(base, [candidate({ dimensions: { upsert: [{ id: 'pressure', expectedRevision: 0, name: '压力', kind: 'pressure', value: 2, trend: 'rising', rationale: '', evidenceRefs: [] }] } })], new Set(['e1']))).toThrow(/revision 冲突/);
  });

  it('dimensions upsert 缺 kind/value/trend 时按缺省补齐并可入库', () => {
    const next = applyWorldSimulationCandidates_ACU(
      buildEmptyWorldSimulationLedger_ACU(),
      [candidate({ dimensions: { upsert: [{ id: 'pressure', name: '压力', expectedRevision: 0, rationale: '', evidenceRefs: ['e1'] }] } })],
      new Set(['e1']),
    );
    expect(next.dimensions[0]).toMatchObject({ id: 'pressure', name: '压力', kind: 'pressure', value: 0, trend: 'stable', revision: 1 });
  });

  it('preflight 把可自动修复与必须人工修的违规分级返回', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.dimensions.push({ id: 'pressure', name: '压力', kind: 'pressure', value: 1, trend: 'stable', rationale: '', evidenceRefs: [], revision: 1 });
    const analyst = (candidateId: string, patch: Record<string, unknown>) => ({
      candidateId, agentName: 'world-analyst', patch, summary: '候选',
      evidenceRefs: ['e1'], uncertainties: [], writableModules: ['clock', 'dimensions', 'seeds', 'actors', 'chronicle', 'player', 'rumors'],
    });
    const report = preflightWorldSimulationCandidates_ACU(base, [
      analyst('candidate:clock', { clock: { days: -1, evidenceRefs: ['e1'] } }),
      analyst('candidate:dimension-missing', { dimensions: { upsert: [{ id: 'new-dim', name: '新维度', expectedRevision: 0, rationale: '', evidenceRefs: ['e1'] }] } }),
      analyst('candidate:dimension-revision', { dimensions: { upsert: [{ id: 'pressure', expectedRevision: 0, name: '压力', kind: 'pressure', value: 2, trend: 'rising', rationale: '', evidenceRefs: ['e1'] }] } }),
    ], new Set(['e1']));
    const blocking = report.blocking.map(item => item.message).join('\n');
    const autoFixed = report.autoFixed.map(item => item.message).join('\n');
    expect(blocking).toMatch(/非负整数/);
    expect(blocking).toMatch(/revision 冲突/);
    expect(autoFixed).toMatch(/缺省补齐|kind|value|trend/);
    expect(report.blocking.length).toBeGreaterThanOrEqual(2);
  });

  it('preflight 对类型偏差记 autoFixed，引用不存在 id 与跨字段硬约束仍 blocking', () => {
    const report = preflightWorldSimulationCandidates_ACU(buildEmptyWorldSimulationLedger_ACU(), [
      candidate({
        actors: { upsert: [{ id: 'actor-1', name: '角色', interests: '不是数组', location: '', locationRef: null, life: 'alive', diedAtDay: null, deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [], knownFacts: [], visibility: 'hidden', expectedRevision: 0 }] },
        seeds: { upsert: [
          { id: 'seed-1', title: '暗流', status: 'active', level: 1, catalyst: '', visibility: 'hidden', actorIds: [], location: null, expiresAtDay: null, missedOutcome: null, exposePolicy: 'on_collision', evidenceRefs: ['e1'], retiredReason: '', expectedRevision: 0 },
          { id: 'seed-2', title: '暗流二', status: 'active', level: 1, catalyst: '', visibility: 'hidden', actorIds: [], location: null, expiresAtDay: null, missedOutcome: null, exposePolicy: 'on_collision', evidenceRefs: ['e1'], retiredReason: '不该带原因', expectedRevision: 0 },
          { id: 'seed-3', title: '暗流三', status: 'active', level: 1, catalyst: '', visibility: 'hidden', actorIds: ['actor-missing'], location: null, expiresAtDay: null, missedOutcome: null, exposePolicy: 'on_collision', evidenceRefs: ['e1'], retiredReason: null, expectedRevision: 0 },
        ] },
      }),
    ], new Set(['e1']));
    const autoFixed = report.autoFixed.map(item => item.message).join('\n');
    const blocking = report.blocking.map(item => item.message).join('\n');
    expect(autoFixed).toMatch(/interests/);
    expect(autoFixed).toMatch(/retiredReason/);
    expect(blocking).toMatch(/非退役状态不能携带退役原因/);
    expect(blocking).toMatch(/引用了不存在的 actor/);
    expect(report.blocking.length).toBeGreaterThanOrEqual(2);
  });

  it('部分更新只改变更字段并与账本现值合并', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.dimensions.push({ id: 'pressure', name: '压力', kind: 'pressure', value: 1, trend: 'stable', rationale: '旧因', evidenceRefs: [], revision: 1 });
    const next = applyWorldSimulationCandidates_ACU(
      base,
      [candidate({ dimensions: { upsert: [{ id: 'pressure', value: '8', trend: 'RISING' }] } })],
      new Set(['e1']),
    );
    expect(next.dimensions[0]).toMatchObject({ id: 'pressure', name: '压力', kind: 'pressure', value: 8, trend: 'rising', rationale: '旧因', revision: 2 });
  });

  it('类型宽容接受逗号分隔数组与数字字符串，越权与伪造引用仍拒绝', () => {
    const next = applyWorldSimulationCandidates_ACU(
      buildEmptyWorldSimulationLedger_ACU(),
      [candidate({ actors: { upsert: [{ id: 'actor-1', name: '角色', interests: '刀, 盾', visibility: 'HIDDEN' }] } })],
      new Set(['e1']),
    );
    expect(next.actors[0]).toMatchObject({ id: 'actor-1', interests: ['刀', '盾'], visibility: 'hidden', life: 'alive' });
    expect(() => applyWorldSimulationCandidates_ACU(
      buildEmptyWorldSimulationLedger_ACU(),
      [candidate({ seeds: { upsert: [{ id: 'seed-x', title: '暗流', actorIds: ['actor-missing'] }] } })],
      new Set(['e1']),
    )).toThrow(/引用了不存在的 actor/);
    expect(() => applyWorldSimulationCandidates_ACU(
      buildEmptyWorldSimulationLedger_ACU(),
      [candidate({ guidance: { signals: [{ text: '泄露', voice: 'ambient' }] } })],
      new Set(['e1']),
    )).toThrow(/越权/);
  });

  it('clockAdvance 单调推进 day，拒绝直接写 day 与负数 days', () => {
    const next = applyWorldSimulationCandidates_ACU(
      buildEmptyWorldSimulationLedger_ACU(),
      [candidate({ clock: { days: 2, storyTime: '第三日', slot: '黄昏', evidenceRefs: ['e1'] } })],
      new Set(['e1']),
    );
    expect(next.clock).toMatchObject({ day: 3, slot: '黄昏', storyTime: '第三日', evidenceRefs: ['e1'] });
    expect(() => applyWorldSimulationCandidates_ACU(
      buildEmptyWorldSimulationLedger_ACU(),
      [candidate({ clock: { day: 9, evidenceRefs: ['e1'] } })],
      new Set(['e1']),
    )).toThrow(/未知字段|禁止直接写 day/);
    expect(() => applyWorldSimulationCandidates_ACU(
      buildEmptyWorldSimulationLedger_ACU(),
      [candidate({ clock: { days: -1, evidenceRefs: ['e1'] } })],
      new Set(['e1']),
    )).toThrow(/非负整数/);
  });

  it('超过 maxClockAdvanceDays 时必须提供非空 evidenceRefs', () => {
    expect(() => applyWorldSimulationCandidates_ACU(
      buildEmptyWorldSimulationLedger_ACU(),
      [candidate({ clock: { days: 15 } })],
      new Set(['e1']),
    )).toThrow(/maxClockAdvanceDays/);
    const next = applyWorldSimulationCandidates_ACU(
      buildEmptyWorldSimulationLedger_ACU(),
      [candidate({ clock: { days: 15, evidenceRefs: ['e1'] } })],
      new Set(['e1']),
    );
    expect(next.clock.day).toBe(16);
  });

  it('player 单例只允许 location/contact/evidenceRefs', () => {
    const next = applyWorldSimulationCandidates_ACU(
      buildEmptyWorldSimulationLedger_ACU(),
      [candidate({ player: { location: { region: '临川' }, contact: 'secluded', evidenceRefs: ['e1'] } })],
      new Set(['e1']),
    );
    expect(next.player).toMatchObject({ location: { region: '临川' }, contact: 'secluded', locationUpdatedAtDay: 1, regionVisits: [] });
    expect(() => applyWorldSimulationCandidates_ACU(
      buildEmptyWorldSimulationLedger_ACU(),
      [candidate({ player: { locationUpdatedAtDay: 9 } })],
      new Set(['e1']),
    )).toThrow(/未知字段/);
    expect(() => applyWorldSimulationCandidates_ACU(
      buildEmptyWorldSimulationLedger_ACU(),
      [candidate({ player: { regionVisits: [{ region: '临川', day: 1 }] } })],
      new Set(['e1']),
    )).toThrow(/未知字段/);
  });

  it('死亡行动者必须伴随 rumor，guidance 信号必须结构化', () => {
    const dead = { id: 'actor-dead', name: '死者', interests: [], location: '', locationRef: null, life: 'dead', diedAtDay: 1, deathSummary: '战死', resources: [], goals: [], constraints: [], informationSources: [], knownFacts: [], visibility: 'hidden', expectedRevision: 0 };
    const rumor = { id: 'rumor-death', fact: '有人战死', originDay: 1, earliestRevealDay: 1, channels: ['north'], relatedActorIds: ['actor-dead'], status: 'latent', revealedAtDay: null, expectedRevision: 0 };
    expect(() => applyWorldSimulationCandidates_ACU(buildEmptyWorldSimulationLedger_ACU(), [candidate({ actors: { upsert: [dead] } })], new Set(['e1']))).toThrow(/伴随 rumor/);
    const next = applyWorldSimulationCandidates_ACU(buildEmptyWorldSimulationLedger_ACU(), [candidate({ actors: { upsert: [dead] }, rumors: { upsert: [rumor] } })], new Set(['e1']));
    expect(next.actors[0].life).toBe('dead');
    expect(next.rumors[0].id).toBe('rumor-death');
    expect(() => applyWorldSimulationCandidates_ACU(buildEmptyWorldSimulationLedger_ACU(), [candidate({ rumors: { upsert: [{ ...rumor, id: 'rumor-bad', relatedActorIds: [], earliestRevealDay: 1, originDay: 2 }] } })], new Set(['e1']))).toThrow(/earliestRevealDay/);
    expect(() => applyWorldSimulationCandidates_ACU(buildEmptyWorldSimulationLedger_ACU(), [{ ...candidate({ guidance: { signals: ['钟声'] } }), agentName: 'causality-reviewer', writableModules: ['guidance'] }], new Set(['e1']))).toThrow(/必须是对象/);
    const guided = applyWorldSimulationCandidates_ACU(buildEmptyWorldSimulationLedger_ACU(), [{ ...candidate({ guidance: { signals: [{ text: '钟声', voice: 'ambient' }] } }), agentName: 'causality-reviewer', writableModules: ['guidance'] }], new Set(['e1']));
    expect(guided.guidance.signals).toEqual([{ text: '钟声', voice: 'ambient' }]);
  });

  it('chronicleArchive 合法落账，超容无合并行拒绝，相似事件不拦截', () => {
    const archivePatch = {
      chronicleArchive: {
        archiveEntries: [{
          archiveRef: 'arc-mine',
          day: 3,
          summary: '北岭矿洞塌方，三人受伤，暗流收束。',
          fingerprints: ['fp-mine'],
          relatedIds: ['seed-1'],
          sourceChronicleIds: ['ch-1'],
        }],
        overviewRows: [{ fingerprint: 'fp-mine', day: 3, oneLine: '第3日 · 北岭矿洞塌方，三人受伤', archiveRef: 'arc-mine' }],
      },
    };
    const detailed = applyWorldSimulationCandidatesDetailed_ACU(
      buildEmptyWorldSimulationLedger_ACU(),
      [candidate(archivePatch)],
      new Set(['e1']),
    );
    expect(detailed.ledger.chronicleOverview).toEqual([{
      fingerprint: 'fp-mine', day: 3, oneLine: '第3日 · 北岭矿洞塌方，三人受伤', archiveRef: 'arc-mine',
    }]);
    expect(detailed.chronicleArchiveWrites).toEqual([expect.objectContaining({ archiveRef: 'arc-mine', day: 3 })]);

    const filled = buildEmptyWorldSimulationLedger_ACU();
    filled.chronicleOverview = Array.from({ length: WORLD_CHRONICLE_OVERVIEW_CAP_ACU }, (_, index) => ({
      fingerprint: `fp${index}`,
      day: 1,
      oneLine: `事件${index}`,
      archiveRef: `arc-${index}`,
    }));
    expect(() => applyWorldSimulationCandidates_ACU(filled, [candidate(archivePatch)], new Set(['e1']))).toThrow(/超过/);

    const similar = applyWorldSimulationCandidates_ACU(
      detailed.ledger,
      [candidate({
        chronicle: { append: [{ id: 'ch-2', at: '第四日', summary: '北岭矿洞今夜塌方压伤了三人', relatedIds: [], evidenceRefs: ['e1'] }] },
      })],
      new Set(['e1']),
    );
    expect(similar.chronicle.some(item => item.id === 'ch-2')).toBe(true);
    expect(similar.chronicleOverview).toHaveLength(1);
  });
});
