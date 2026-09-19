import { describe, expect, it } from 'vitest';
import { buildEmptyWorldSimulationLedger_ACU } from '../../../src/service/simulation/defaults';
import { applyWorldSimulationCandidates_ACU, preflightWorldSimulationCandidates_ACU } from '../../../src/service/simulation/simulation-transaction';

const candidate = (patch: Record<string, unknown>, evidenceRefs = ['e1']) => ({
  candidateId: 'candidate:one', agentName: 'world-analyst', patch,
  summary: '候选', evidenceRefs, uncertainties: [], writableModules: ['clock', 'dimensions', 'seeds', 'actors', 'chronicle'],
});

describe('world simulation transaction', () => {
  it('按授权模块应用候选且账本 revision 只递增一次', () => {
    const next = applyWorldSimulationCandidates_ACU(
      buildEmptyWorldSimulationLedger_ACU(),
      [candidate({ clock: { elapsed: '1h', evidenceRefs: ['e1'] } })],
      new Set(['e1']),
    );
    expect(next.revision).toBe(1);
    expect(next.clock).toMatchObject({ elapsed: '1h', evidenceRefs: ['e1'] });
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

  it('dimensions upsert 缺 kind/value/trend 时一次报出全部缺失字段', () => {
    expect(() => applyWorldSimulationCandidates_ACU(
      buildEmptyWorldSimulationLedger_ACU(),
      [candidate({ dimensions: { upsert: [{ id: 'pressure', name: '压力', expectedRevision: 0, rationale: '', evidenceRefs: ['e1'] }] } })],
      new Set(['e1']),
    )).toThrow(/缺少必填字段：kind,value,trend/);
  });

  it('preflight 聚合返回多候选多模块违规且不抛错', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.dimensions.push({ id: 'pressure', name: '压力', kind: 'pressure', value: 1, trend: 'stable', rationale: '', evidenceRefs: [], revision: 1 });
    const analyst = (candidateId: string, patch: Record<string, unknown>) => ({
      candidateId, agentName: 'world-analyst', patch, summary: '候选',
      evidenceRefs: ['e1'], uncertainties: [], writableModules: ['clock', 'dimensions', 'seeds', 'actors', 'chronicle'],
    });
    const violations = preflightWorldSimulationCandidates_ACU(base, [
      analyst('candidate:clock', { clock: { elapsed: '1h', precision: 'illegal', evidenceRefs: ['e1'] } }),
      analyst('candidate:dimension-missing', { dimensions: { upsert: [{ id: 'new-dim', name: '新维度', expectedRevision: 0, rationale: '', evidenceRefs: ['e1'] }] } }),
      analyst('candidate:dimension-revision', { dimensions: { upsert: [{ id: 'pressure', expectedRevision: 0, name: '压力', kind: 'pressure', value: 2, trend: 'rising', rationale: '', evidenceRefs: ['e1'] }] } }),
    ], new Set(['e1']));
    const messages = violations.map(item => item.message).join('\n');
    expect(messages).toMatch(/precision 非法/);
    expect(messages).toMatch(/缺少必填字段：kind,value,trend/);
    expect(messages).toMatch(/revision 冲突/);
    expect(violations.length).toBeGreaterThanOrEqual(3);
  });

  it('preflight 对模拟账本聚合回报 actors/seeds 的类型与跨字段违规', () => {
    const violations = preflightWorldSimulationCandidates_ACU(buildEmptyWorldSimulationLedger_ACU(), [
      candidate({
        actors: { upsert: [{ id: 'actor-1', name: '角色', interests: '不是数组', location: '', resources: [], goals: [], constraints: [], informationSources: [], knownFacts: [], visibility: 'hidden', expectedRevision: 0 }] },
        seeds: { upsert: [
          { id: 'seed-1', title: '暗流', status: 'active', level: 1, catalyst: '', visibility: 'hidden', actorIds: [], evidenceRefs: ['e1'], retiredReason: '', expectedRevision: 0 },
          { id: 'seed-2', title: '暗流二', status: 'active', level: 1, catalyst: '', visibility: 'hidden', actorIds: [], evidenceRefs: ['e1'], retiredReason: '不该带原因', expectedRevision: 0 },
          { id: 'seed-3', title: '暗流三', status: 'active', level: 1, catalyst: '', visibility: 'hidden', actorIds: ['actor-missing'], evidenceRefs: ['e1'], retiredReason: null, expectedRevision: 0 },
        ] },
      }),
    ], new Set(['e1']));
    const messages = violations.map(item => item.message).join('\n');
    expect(messages).toMatch(/actors\[0\]\.interests 必须是字符串数组/);
    expect(messages).toMatch(/seeds\[0\]\.retiredReason 必须是非空字符串/);
    expect(messages).toMatch(/seeds\[1\] 非退役状态不能携带退役原因/);
    expect(messages).toMatch(/seeds\[2\] 引用了不存在的 actor/);
    expect(violations.length).toBeGreaterThanOrEqual(4);
  });
});
