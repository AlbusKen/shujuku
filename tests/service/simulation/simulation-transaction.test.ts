import { describe, expect, it } from 'vitest';
import { findWorldSimulationAgentDefinition_ACU } from '../../../src/service/simulation/agent/agent-catalog';
import { buildEmptyWorldSimulationLedger_ACU } from '../../../src/service/simulation/defaults';
import { eventFingerprint_ACU } from '../../../src/service/simulation/event-similarity';
import { applyWorldSimulationCandidates_ACU, applyWorldSimulationCandidatesDetailed_ACU, preflightWorldSimulationCandidates_ACU } from '../../../src/service/simulation/simulation-transaction';
import { WORLD_CHRONICLE_OVERVIEW_CAP_ACU } from '../../../src/service/simulation/model';

function agentForPatch_ACU(patch: Record<string, unknown>): string {
  const keys = Object.keys(patch);
  if (keys.some(key => key === 'clock')) return 'timekeeper';
  if (keys.some(key => key === 'dimensions' || key === 'seeds')) return 'undercurrent-analyst';
  if (keys.some(key => key === 'actors' || key === 'player' || key === 'rumors')) return 'dramatis-keeper';
  if (keys.some(key => key === 'chronicle' || key === 'chronicleArchive')) return 'chronicler';
  if (keys.some(key => key === 'guidance')) return 'guidance-composer';
  throw new Error(`TEST_PATCH_HAS_NO_WRITER:${keys.join(',')}`);
}

const candidate = (patch: Record<string, unknown>, evidenceRefs = ['e1'], candidateId = 'candidate:one') => {
  const agentName = agentForPatch_ACU(patch);
  const definition = findWorldSimulationAgentDefinition_ACU(agentName)!;
  return {
    candidateId,
    agentName,
    patch,
    summary: '候选',
    evidenceRefs,
    uncertainties: [],
    writableModules: [...definition.writableModules],
  };
};

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
      [{ ...candidate({ clock: { days: 1, evidenceRefs: ['e1'] } }), patch: { guidance: { signals: [{ text: '泄露', voice: 'ambient' }] } } }], new Set(['e1']),
    )).toThrow(/越权/);
    expect(() => applyWorldSimulationCandidates_ACU(
      buildEmptyWorldSimulationLedger_ACU(),
      [candidate({ clock: { evidenceRefs: ['e2'] } }, ['e2'])], new Set(['e1']),
    )).toThrow(/未授权/);
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.dimensions.push({ id: 'pressure', name: '压力', kind: 'pressure', value: 1, trend: 'stable', rationale: '', evidenceRefs: [], revision: 1 });
    const conflicted = applyWorldSimulationCandidates_ACU(base, [candidate({ dimensions: { upsert: [{ id: 'pressure', expectedRevision: 0, name: '压力', kind: 'pressure', value: 2, trend: 'rising', rationale: '', evidenceRefs: [] }] } })], new Set(['e1']));
    expect(conflicted.dimensions[0]).toMatchObject({ value: 1, revision: 1 });
    expect(conflicted.pendingFixes).toEqual(expect.arrayContaining([
      expect.objectContaining({ module: 'dimensions', agentName: 'undercurrent-analyst' }),
    ]));
    expect(conflicted.pendingFixes[0].lastError).toMatch(/revision 冲突/);
    expect(conflicted.revision).toBe(1);
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
    const report = preflightWorldSimulationCandidates_ACU(base, [
      candidate({ clock: { days: -1, evidenceRefs: ['e1'] } }, ['e1'], 'candidate:clock'),
      candidate({ dimensions: { upsert: [{ id: 'new-dim', name: '新维度', expectedRevision: 0, rationale: '', evidenceRefs: ['e1'] }] } }, ['e1'], 'candidate:dimension-missing'),
      candidate({ dimensions: { upsert: [{ id: 'pressure', expectedRevision: 0, name: '压力', kind: 'pressure', value: 2, trend: 'rising', rationale: '', evidenceRefs: ['e1'] }] } }, ['e1'], 'candidate:dimension-revision'),
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
      }, ['e1'], 'candidate:actors'),
      candidate({
        seeds: { upsert: [
          { id: 'seed-1', title: '暗流', status: 'active', level: 1, catalyst: '', visibility: 'hidden', actorIds: [], location: null, expiresAtDay: null, missedOutcome: null, exposePolicy: 'on_collision', evidenceRefs: ['e1'], retiredReason: '', expectedRevision: 0 },
          { id: 'seed-2', title: '暗流二', status: 'active', level: 1, catalyst: '', visibility: 'hidden', actorIds: [], location: null, expiresAtDay: null, missedOutcome: null, exposePolicy: 'on_collision', evidenceRefs: ['e1'], retiredReason: '不该带原因', expectedRevision: 0 },
          { id: 'seed-3', title: '暗流三', status: 'active', level: 1, catalyst: '', visibility: 'hidden', actorIds: ['actor-missing'], location: null, expiresAtDay: null, missedOutcome: null, exposePolicy: 'on_collision', evidenceRefs: ['e1'], retiredReason: null, expectedRevision: 0 },
        ] },
      }, ['e1'], 'candidate:seeds'),
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
    const missingActor = applyWorldSimulationCandidates_ACU(
      buildEmptyWorldSimulationLedger_ACU(),
      [candidate({ seeds: { upsert: [{ id: 'seed-x', title: '暗流', actorIds: ['actor-missing'] }] } })],
      new Set(['e1']),
    );
    expect(missingActor.seeds).toEqual([]);
    expect(missingActor.pendingFixes.some(item => item.module === 'seeds' && item.lastError.includes('引用了不存在的 actor'))).toBe(true);
    expect(() => applyWorldSimulationCandidates_ACU(
      buildEmptyWorldSimulationLedger_ACU(),
      [{ ...candidate({ clock: { days: 1, evidenceRefs: ['e1'] } }), patch: { guidance: { signals: [{ text: '泄露', voice: 'ambient' }] } } }],
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
    const unknownDay = applyWorldSimulationCandidates_ACU(
      buildEmptyWorldSimulationLedger_ACU(),
      [candidate({ clock: { day: 9, evidenceRefs: ['e1'] } })],
      new Set(['e1']),
    );
    expect(unknownDay.clock.day).toBe(1);
    expect(unknownDay.pendingFixes[0].lastError).toMatch(/未知字段|禁止直接写 day/);
    const negative = applyWorldSimulationCandidates_ACU(
      buildEmptyWorldSimulationLedger_ACU(),
      [candidate({ clock: { days: -1, evidenceRefs: ['e1'] } })],
      new Set(['e1']),
    );
    expect(negative.clock.day).toBe(1);
    expect(negative.pendingFixes[0].lastError).toMatch(/非负整数/);
  });

  it('超过 maxClockAdvanceDays 时必须提供非空 evidenceRefs', () => {
    const blocked = applyWorldSimulationCandidates_ACU(
      buildEmptyWorldSimulationLedger_ACU(),
      [candidate({ clock: { days: 15 } })],
      new Set(['e1']),
    );
    expect(blocked.clock.day).toBe(1);
    expect(blocked.pendingFixes[0].lastError).toMatch(/maxClockAdvanceDays/);
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
    const forbiddenUpdatedAt = applyWorldSimulationCandidates_ACU(
      buildEmptyWorldSimulationLedger_ACU(),
      [candidate({ player: { locationUpdatedAtDay: 9 } })],
      new Set(['e1']),
    );
    expect(forbiddenUpdatedAt.player.locationUpdatedAtDay).toBe(1);
    expect(forbiddenUpdatedAt.pendingFixes[0].lastError).toMatch(/未知字段/);
    const forbiddenVisits = applyWorldSimulationCandidates_ACU(
      buildEmptyWorldSimulationLedger_ACU(),
      [candidate({ player: { regionVisits: [{ region: '临川', day: 1 }] } })],
      new Set(['e1']),
    );
    expect(forbiddenVisits.player.regionVisits).toEqual([]);
    expect(forbiddenVisits.pendingFixes[0].lastError).toMatch(/未知字段/);
  });

  it('死亡行动者必须伴随 rumor，guidance 信号必须结构化', () => {
    const dead = { id: 'actor-dead', name: '死者', interests: [], location: '', locationRef: null, life: 'dead', diedAtDay: 1, deathSummary: '战死', resources: [], goals: [], constraints: [], informationSources: [], knownFacts: [], visibility: 'hidden', expectedRevision: 0 };
    const rumor = { id: 'rumor-death', fact: '有人战死', originDay: 1, earliestRevealDay: 1, channels: ['north'], relatedActorIds: ['actor-dead'], status: 'latent', revealedAtDay: null, expectedRevision: 0 };
    const deadOnly = applyWorldSimulationCandidates_ACU(buildEmptyWorldSimulationLedger_ACU(), [candidate({ actors: { upsert: [dead] } })], new Set(['e1']));
    expect(deadOnly.actors).toEqual([]);
    expect(deadOnly.pendingFixes[0].lastError).toMatch(/伴随 rumor/);
    const next = applyWorldSimulationCandidates_ACU(buildEmptyWorldSimulationLedger_ACU(), [candidate({ actors: { upsert: [dead] }, rumors: { upsert: [rumor] } })], new Set(['e1']));
    expect(next.actors[0].life).toBe('dead');
    expect(next.rumors[0].id).toBe('rumor-death');
    const badRumor = applyWorldSimulationCandidates_ACU(buildEmptyWorldSimulationLedger_ACU(), [candidate({ rumors: { upsert: [{ ...rumor, id: 'rumor-bad', relatedActorIds: [], earliestRevealDay: 1, originDay: 2 }] } })], new Set(['e1']));
    expect(badRumor.rumors).toEqual([]);
    expect(badRumor.pendingFixes[0].lastError).toMatch(/earliestRevealDay/);
    const unstructured = applyWorldSimulationCandidates_ACU(buildEmptyWorldSimulationLedger_ACU(), [candidate({ guidance: { signals: ['钟声'] } })], new Set(['e1']));
    expect(unstructured.guidance.signals).toEqual([]);
    expect(unstructured.pendingFixes[0].lastError).toMatch(/必须是对象/);
    const guided = applyWorldSimulationCandidates_ACU(buildEmptyWorldSimulationLedger_ACU(), [candidate({ guidance: { signals: [{ text: '钟声', voice: 'ambient', sourceId: 'clock' }] } })], new Set(['e1']));
    expect(guided.guidance.signals).toEqual([{ text: '钟声', voice: 'ambient', sourceId: 'clock' }]);
    const missingSource = applyWorldSimulationCandidates_ACU(buildEmptyWorldSimulationLedger_ACU(), [candidate({ guidance: { signals: [{ text: '钟声', voice: 'ambient' }] } })], new Set(['e1']));
    expect(missingSource.guidance.signals).toEqual([]);
    expect(missingSource.pendingFixes[0].lastError).toMatch(/sourceId/);
  });

  it('部分模块违规时其余模块入库并记录 pendingFixes', () => {
    const detailed = applyWorldSimulationCandidatesDetailed_ACU(
      buildEmptyWorldSimulationLedger_ACU(),
      [
        candidate({ clock: { days: 1, storyTime: '次日', evidenceRefs: ['e1'] } }, ['e1'], 'candidate:clock'),
        candidate({ actors: { upsert: [{ id: 'actor-dead', name: '死者', life: 'dead', diedAtDay: 1, deathSummary: '战死', expectedRevision: 0 }] } }, ['e1'], 'candidate:actors'),
      ],
      new Set(['e1']),
    );
    expect(detailed.ledger.clock).toMatchObject({ day: 2, storyTime: '次日' });
    expect(detailed.ledger.actors).toEqual([]);
    expect(detailed.appliedModules).toEqual(['clock']);
    expect(detailed.pendingFixes).toEqual(expect.arrayContaining([
      expect.objectContaining({ module: 'actors', candidateId: 'candidate:actors', attempts: 1 }),
    ]));
    expect(detailed.ledger.revision).toBe(1);
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
    const overflow = applyWorldSimulationCandidates_ACU(filled, [candidate(archivePatch)], new Set(['e1']));
    expect(overflow.chronicleOverview).toHaveLength(WORLD_CHRONICLE_OVERVIEW_CAP_ACU);
    expect(overflow.pendingFixes[0].lastError).toMatch(/超过/);

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

  it('新建 upsert 省略 id 时按模块前缀编号；缺 name 仍拒绝', () => {
    const next = applyWorldSimulationCandidates_ACU(
      buildEmptyWorldSimulationLedger_ACU(),
      [candidate({ dimensions: { upsert: [{ name: '压力', rationale: '', evidenceRefs: ['e1'] }] } })],
      new Set(['e1']),
    );
    expect(next.dimensions[0]).toMatchObject({ id: 'dim-1', name: '压力', kind: 'pressure', value: 0, trend: 'stable', revision: 1 });
    const sequential = applyWorldSimulationCandidates_ACU(
      next,
      [candidate({ dimensions: { upsert: [{ name: '增长', rationale: '', evidenceRefs: ['e1'] }] } })],
      new Set(['e1']),
    );
    expect(sequential.dimensions.map(item => item.id)).toEqual(['dim-1', 'dim-2']);
    const missingName = applyWorldSimulationCandidates_ACU(
      buildEmptyWorldSimulationLedger_ACU(),
      [candidate({ dimensions: { upsert: [{ rationale: '', evidenceRefs: ['e1'] }] } })],
      new Set(['e1']),
    );
    expect(missingName.dimensions).toEqual([]);
    expect(missingName.pendingFixes[0].lastError).toMatch(/name 必须是非空字符串/);
  });

  it('chronicle append 省略 id/at 时按当前 clock 编号；先推进时钟再用推进后的 day', () => {
    const omitted = applyWorldSimulationCandidates_ACU(
      buildEmptyWorldSimulationLedger_ACU(),
      [candidate({ chronicle: { append: [{ summary: '北境起风', relatedIds: [], evidenceRefs: ['e1'] }] } })],
      new Set(['e1']),
    );
    expect(omitted.chronicle[0]).toMatchObject({ id: 'chr-1-1', at: '第1日', summary: '北境起风' });

    const advanced = applyWorldSimulationCandidates_ACU(
      buildEmptyWorldSimulationLedger_ACU(),
      [
        candidate({ clock: { days: 1, storyTime: '次日黎明', evidenceRefs: ['e1'] } }, ['e1'], 'candidate:clock'),
        candidate({ chronicle: { append: [{ summary: '时钟推进后的编年', relatedIds: [], evidenceRefs: ['e1'] }] } }, ['e1'], 'candidate:chronicle'),
      ],
      new Set(['e1']),
    );
    expect(advanced.clock).toMatchObject({ day: 2, storyTime: '次日黎明' });
    expect(advanced.chronicle[0]).toMatchObject({ id: 'chr-2-1', at: '次日黎明', summary: '时钟推进后的编年' });
  });

  it('chronicleArchive 省略 archiveRef/fingerprint 时按当日编号并与 overview 配对', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.clock.day = 3;
    const detailed = applyWorldSimulationCandidatesDetailed_ACU(
      base,
      [candidate({
        chronicleArchive: {
          archiveEntries: [{
            summary: '北岭矿洞塌方，三人受伤，暗流收束。',
            relatedIds: ['seed-1'],
            sourceChronicleIds: ['ch-1'],
          }],
          overviewRows: [{ oneLine: '第3日 · 北岭矿洞塌方，三人受伤' }],
        },
      })],
      new Set(['e1']),
    );
    const fingerprint = eventFingerprint_ACU('北岭矿洞塌方，三人受伤，暗流收束。', '3', ['seed-1']);
    expect(detailed.ledger.chronicleOverview).toEqual([{
      fingerprint, day: 3, oneLine: '第3日 · 北岭矿洞塌方，三人受伤', archiveRef: 'archive-3-1',
    }]);
    expect(detailed.chronicleArchiveWrites).toEqual([expect.objectContaining({
      archiveRef: 'archive-3-1', day: 3, fingerprints: [fingerprint], relatedIds: ['seed-1'], sourceChronicleIds: ['ch-1'],
    })]);
  });

  it('DELETE 写集经领域事务删除既有行；失效 revision 保留原行并形成待修复项', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.dimensions.push({ id: 'pressure', name: '压力', kind: 'pressure', value: 1, trend: 'stable', rationale: '事实', evidenceRefs: [], revision: 2 });
    base.chronicle.push({ id: 'ch-1', at: '第一日', summary: '旧事', relatedIds: [], evidenceRefs: [] });
    const removing = candidate({ dimensions: { remove: [{ id: 'pressure', expectedRevision: 2, reason: '证据失效' }] } });
    expect(preflightWorldSimulationCandidates_ACU(base, [removing], new Set(['e1'])).blocking).toEqual([]);
    const applied = applyWorldSimulationCandidatesDetailed_ACU(base, [removing], new Set(['e1']));
    expect(applied.ledger.dimensions).toEqual([]);
    expect(applied.appliedModules).toContain('dimensions');
    expect(base.dimensions).toHaveLength(1);
    const stale = candidate({ dimensions: { remove: [{ id: 'pressure', expectedRevision: 1, reason: '证据失效' }] } });
    expect(preflightWorldSimulationCandidates_ACU(base, [stale], new Set(['e1'])).blocking.some(item => item.message.includes('revision 冲突'))).toBe(true);
    const rejected = applyWorldSimulationCandidatesDetailed_ACU(base, [stale], new Set(['e1']));
    expect(rejected.ledger.dimensions).toEqual(base.dimensions);
    expect(rejected.pendingFixes[0].lastError).toContain('revision 冲突');
    const chronicle = applyWorldSimulationCandidatesDetailed_ACU(base, [candidate({ chronicle: { remove: [{ id: 'ch-1', reason: '重复事件' }] } })], new Set(['e1']));
    expect(chronicle.ledger.chronicle).toEqual([]);
    expect(chronicle.ledger.revision).toBe(base.revision + 1);
  });

  it('单例 SQL 修订号在事务入口比较账本版本，不把冲突降级为成功', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    const stale = candidate({ clock: { days: 1, expectedRevision: base.revision + 1 } });
    expect(preflightWorldSimulationCandidates_ACU(base, [stale], new Set(['e1'])).blocking.some(item => item.message.includes('revision 冲突'))).toBe(true);
    const applied = applyWorldSimulationCandidatesDetailed_ACU(base, [stale], new Set(['e1']));
    expect(applied.ledger.clock).toEqual(base.clock);
    expect(applied.pendingFixes[0].lastError).toContain('revision 冲突');
  });
});
