import { describe, expect, it } from 'vitest';
import { createWorldSimulationToolDependencies_ACU, runWorldSimulationToolBatch_ACU } from '../../../src/service/simulation/world-simulation-agent-tools';
import { createWorldSimulationEvidenceRegistry_ACU, snapshotWorldSimulationEvidenceRegistry_ACU } from '../../../src/service/simulation/world-simulation-evidence-registry';
import { createWorldSimulationReadGateState_ACU } from '../../../src/service/simulation/agent/agent-read-gate';

describe('世界推演工具与 EvidenceRegistry', () => {
  it('只有成功、精确且未截断的 read 产生 evidenceRef', async () => {
    const registry = createWorldSimulationEvidenceRegistry_ACU('tools');
    const dependencies = createWorldSimulationToolDependencies_ACU({
      anchorMessage: '正文', summary: '', ledger: { revision: 1 }, stagePlan: {}, candidates: [], chronicle: [], projectionPreview: {},
      externalRead: async address => {
        if (address === 'web:url:ok') return { status: 'ok', content: '网页正文', summary: '网页', exact: true };
        if (address === 'web:url:cut') return { status: 'ok', content: '截断', summary: '截断', exact: true, truncated: true };
        if (address === 'worldbook:entry:list') return { status: 'ok', content: '目录', summary: '目录', exact: true, directory: true };
        if (address === 'encyclopedia:entry:missing') return { status: 'empty', summary: '空' };
        return { status: 'dependency_unavailable', summary: '依赖缺失' };
      },
      externalSearch: async () => ({ status: 'ok', hits: [{ address: 'web:url:hit', summary: '命中' }] }),
    });
    const results = await runWorldSimulationToolBatch_ACU({
      registry, dependencies,
      calls: [
        { kind: 'read', reads: ['anchor:message', 'web:url:ok', 'web:url:cut', 'worldbook:entry:list', 'encyclopedia:entry:missing', 'web:url:none'] },
        { kind: 'search', query: '线索', scope: ['web'], maxResults: 5, isRegex: false },
      ],
    });
    expect(results.map(item => item.status)).toEqual(['ok', 'ok', 'truncated', 'ok', 'empty', 'dependency_unavailable', 'ok']);
    expect(results.filter(item => item.evidenceRef)).toHaveLength(2);
    expect(results.at(-1)?.evidenceRef).toBeUndefined();
    expect(snapshotWorldSimulationEvidenceRegistry_ACU(registry).entries).toHaveLength(7);
  });

  it('累计读取 Token 或 maxReads 超限时拒绝整批且不授权 evidenceRef', async () => {
    const registry = createWorldSimulationEvidenceRegistry_ACU('gated-tools');
    const readCalls: string[] = [];
    const dependencies = createWorldSimulationToolDependencies_ACU({
      anchorMessage: '', summary: '', ledger: {}, stagePlan: {}, candidates: [], chronicle: [], projectionPreview: {},
      externalRead: async address => { readCalls.push(address); return { status: 'ok', content: 'xxxx', summary: address, exact: true }; },
    });
    const state = createWorldSimulationReadGateState_ACU();
    const usage = { readsUsed: 0 };
    const gate = {
      state,
      config: { historyTokenBudget: 100, readTokenBudget: 6, fallbackTokens: 2 },
      usage,
      maxReads: 1,
      count: async (text: string) => text.length,
    };
    const first = await runWorldSimulationToolBatch_ACU({
      registry, dependencies, gate,
      calls: [{ kind: 'read', reads: ['web:url:first'] }],
    });
    expect(first[0]).toMatchObject({ status: 'ok' });
    expect(first[0].evidenceRef).toBeDefined();
    expect(state.grantedTokens).toBe(4);
    expect(usage.readsUsed).toBe(1);

    const second = await runWorldSimulationToolBatch_ACU({
      registry, dependencies, gate,
      calls: [{ kind: 'read', reads: ['web:url:second'] }],
    });
    expect(second[0]).toMatchObject({ status: 'failed', summary: 'WORLD_SIMULATION_READ_LIMIT_REACHED' });
    expect(second[0].evidenceRef).toBeUndefined();
    expect(readCalls).toEqual(['web:url:first']);
  });

  it('player:current 与 rumors:current 从账本切片读取', async () => {
    const registry = createWorldSimulationEvidenceRegistry_ACU('player-tools');
    const dependencies = createWorldSimulationToolDependencies_ACU({
      anchorMessage: '', summary: '',
      ledger: { player: { location: { region: 'qingyang' }, contact: 'open' }, rumors: [{ id: 'rumor-1', status: 'ripe' }] },
      stagePlan: {}, candidates: [], chronicle: [], projectionPreview: {},
    });
    const results = await runWorldSimulationToolBatch_ACU({
      registry, dependencies,
      calls: [{ kind: 'read', reads: ['player:current', 'rumors:current'] }],
    });
    expect(results.map(item => item.status)).toEqual(['ok', 'ok']);
    expect(results[0].content).toContain('qingyang');
    expect(results[1].content).toContain('rumor-1');
  });

  it('条目级地址与 chronicle-archive 可调阅详情，未知 id 返回 empty', async () => {
    const registry = createWorldSimulationEvidenceRegistry_ACU('item-tools');
    const dependencies = createWorldSimulationToolDependencies_ACU({
      anchorMessage: '', summary: '',
      ledger: {
        seeds: [{ id: 'seed-1', title: '矿难' }],
        actors: [{ id: 'actor-1', name: '铁匠' }],
        rumors: [{ id: 'rumor-1', fact: '铁匠死在北岭' }],
        chronicle: [{ id: 'ch-1', summary: '北岭塌方' }],
        dimensions: [{ id: 'dim-1', name: '秩序' }],
      },
      stagePlan: {}, candidates: [], chronicle: [], projectionPreview: {},
      chronicleArchive: {
        schemaVersion: 1,
        records: {
          'arc-mine': { archiveRef: 'arc-mine', day: 3, summary: '北岭矿洞塌方已归档', fingerprints: ['fp'], relatedIds: ['seed-1'], sourceChronicleIds: ['ch-1'] },
        },
      },
    });
    const results = await runWorldSimulationToolBatch_ACU({
      registry, dependencies,
      calls: [{ kind: 'read', reads: ['seeds:seed-1', 'actors:actor-1', 'rumors:rumor-1', 'chronicle:ch-1', 'dimensions:dim-1', 'chronicle-archive:arc-mine', 'seeds:missing', 'chronicle-archive:missing'] }],
    });
    expect(results.map(item => item.status)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'empty', 'empty']);
    expect(results[0].content).toContain('矿难');
    expect(results[5].content).toContain('北岭矿洞塌方已归档');
  });
});
