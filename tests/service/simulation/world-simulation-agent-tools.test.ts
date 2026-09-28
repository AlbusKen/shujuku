import { describe, expect, it } from 'vitest';
import { createWorldSimulationReadRoundState_ACU, createWorldSimulationToolDependencies_ACU, runWorldSimulationToolBatch_ACU } from '../../../src/service/simulation/world-simulation-agent-tools';
import { createWorldSimulationEvidenceRegistry_ACU, snapshotWorldSimulationEvidenceRegistry_ACU } from '../../../src/service/simulation/world-simulation-evidence-registry';
import { createWorldSimulationReadGateState_ACU } from '../../../src/service/simulation/agent/agent-read-gate';
import { worldSimulationCanReadAddress_ACU } from '../../../src/service/simulation/agent/agent-catalog';

describe('格林推演工具与 EvidenceRegistry', () => {
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

  it('逐栏归档读取实时折叠新提交，损坏读取保留 failed 而非 empty', async () => {
    const registry = createWorldSimulationEvidenceRegistry_ACU('live-archive-tools');
    let archive: unknown = { records: {} };
    const dependencies = createWorldSimulationToolDependencies_ACU({
      anchorMessage: '', summary: '', ledger: {}, stagePlan: {}, candidates: [], chronicle: [], projectionPreview: {},
      liveArchive: () => archive,
    });
    archive = { records: { 'arc-new': { archiveRef: 'arc-new', summary: '后续逐栏写入' } } };
    const current = await runWorldSimulationToolBatch_ACU({ registry, dependencies,
      calls: [{ kind: 'read', reads: ['chronicle-archive:arc-new'] }] });
    expect(current[0]).toMatchObject({ status: 'ok', content: expect.stringContaining('后续逐栏写入') });
    archive = { get records() { throw new Error('WORLD_SIMULATION_SNAPSHOT_INVALID'); } };
    const corrupted = await runWorldSimulationToolBatch_ACU({ registry, dependencies,
      calls: [{ kind: 'read', reads: ['chronicle-archive:arc-new'] }] });
    expect(corrupted[0]).toMatchObject({ status: 'failed', summary: 'WORLD_SIMULATION_SNAPSHOT_INVALID' });
    expect(corrupted[0].evidenceRef).toBeUndefined();
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

  it('有门禁的并发 read 必须整批完整才登记证据和一次成功额度', async () => {
    const registry = createWorldSimulationEvidenceRegistry_ACU('atomic-tools');
    const state = createWorldSimulationReadGateState_ACU();
    const usage = { readsUsed: 0, successfulReadBatches: 0 };
    const gate = { state, usage, readOnce: true, maxReads: 4,
      config: { historyTokenBudget: 1000, readTokenBudget: 500, fallbackTokens: 50 },
      count: async (text: string) => text.length };
    let damaged = true;
    let started = 0;
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const dependencies = { read: async (address: string) => {
      started += 1;
      if (started === 2) release();
      await waiting;
      return address === 'second' && damaged
        ? { status: 'ok' as const, content: 'CUT', exact: true, truncated: true }
        : { status: 'ok' as const, content: `FULL:${address}`, exact: true };
    }, search: async () => ({ status: 'empty' as const, hits: [] }) };
    const calls = [{ kind: 'read' as const, reads: ['first'] }, { kind: 'read' as const, reads: ['second'] }];
    const rejected = await runWorldSimulationToolBatch_ACU({ registry, dependencies, gate, calls });
    expect(started).toBe(2);
    expect(rejected.every(item => item.status === 'failed' && item.content === undefined && !item.evidenceRef)).toBe(true);
    expect(usage).toEqual({ readsUsed: 0, successfulReadBatches: 0 });
    expect(snapshotWorldSimulationEvidenceRegistry_ACU(registry).entries).toEqual([]);
    damaged = false;
    const accepted = await runWorldSimulationToolBatch_ACU({ registry, dependencies, gate, calls });
    expect(accepted.map(item => item.content)).toEqual(['FULL:first', 'FULL:second']);
    expect(usage).toEqual({ readsUsed: 2, successfulReadBatches: 1 });
    expect((await runWorldSimulationToolBatch_ACU({ registry, dependencies, gate,
      calls: [{ kind: 'read', reads: ['third'] }] }))[0]).toMatchObject({ status: 'failed', summary: 'read-once-exhausted' });
  });

  it('普通子代理容量拒绝不登记失败 evidence、不耗成功额度，修正后可重试', async () => {
    const registry = createWorldSimulationEvidenceRegistry_ACU('capacity-retry');
    const state = createWorldSimulationReadGateState_ACU();
    const usage = { readsUsed: 0, successfulReadBatches: 0 };
    const gate = { state, usage, readOnce: true, maxReads: 2,
      config: { historyTokenBudget: 100, readTokenBudget: 3, fallbackTokens: 2 },
      count: async (text: string) => text.length };
    const dependencies = { read: async (address: string) => ({ status: 'ok' as const, content: `FULL:${address}`, exact: true }),
      search: async () => ({ status: 'empty' as const, hits: [] }) };
    const calls = [{ kind: 'read' as const, reads: ['first'] }];
    const rejected = await runWorldSimulationToolBatch_ACU({ registry, dependencies, gate, calls });
    expect(rejected).toMatchObject([{ status: 'failed' }]);
    expect(rejected[0]).not.toHaveProperty('content');
    expect(rejected[0]).not.toHaveProperty('evidenceRef');
    expect(rejected[0].summary).toContain('WORLD_SIMULATION_READ_REJECTED');
    expect(snapshotWorldSimulationEvidenceRegistry_ACU(registry).entries).toEqual([]);
    expect(usage).toEqual({ readsUsed: 0, successfulReadBatches: 0 });
    gate.config.readTokenBudget = 100;
    const accepted = await runWorldSimulationToolBatch_ACU({ registry, dependencies, gate, calls });
    expect(accepted).toMatchObject([{ status: 'ok', content: 'FULL:first' }]);
    expect(usage).toEqual({ readsUsed: 1, successfulReadBatches: 1 });
    expect(snapshotWorldSimulationEvidenceRegistry_ACU(registry).entries).toHaveLength(1);
  });

  it('普通子代理 maxReads 预检拒绝不登记 evidence 或执行读取', async () => {
    const registry = createWorldSimulationEvidenceRegistry_ACU('read-limit');
    const usage = { readsUsed: 0, successfulReadBatches: 0 };
    let attempted = 0;
    const result = await runWorldSimulationToolBatch_ACU({
      registry,
      dependencies: { read: async () => { attempted += 1; return { status: 'ok', content: 'body', exact: true }; },
        search: async () => ({ status: 'empty', hits: [] }) },
      gate: { state: createWorldSimulationReadGateState_ACU(), usage, readOnce: true, maxReads: 1,
        config: { historyTokenBudget: 100, readTokenBudget: 50, fallbackTokens: 5 } },
      calls: [{ kind: 'read', reads: ['first', 'second'] }],
    });
    expect(result).toHaveLength(2);
    expect(result.every(item => item.status === 'failed' && item.summary === 'WORLD_SIMULATION_READ_LIMIT_REACHED'
      && !Object.hasOwn(item, 'content') && !Object.hasOwn(item, 'evidenceRef'))).toBe(true);
    expect(attempted).toBe(0);
    expect(usage).toEqual({ readsUsed: 0, successfulReadBatches: 0 });
    expect(snapshotWorldSimulationEvidenceRegistry_ACU(registry).entries).toEqual([]);
  });

  it('同角色同轮跨实例仅成功一次，并发占位与失败重试互不泄漏', async () => {
    const registry = createWorldSimulationEvidenceRegistry_ACU('round-shared');
    const readRoundState = createWorldSimulationReadRoundState_ACU();
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const waiting = new Promise<void>(resolve => { release = resolve; });
    let damaged = true;
    const dependencies = { read: async (address: string) => {
      started();
      await waiting;
      return damaged && address === 'bad'
        ? { status: 'ok' as const, content: 'CUT', exact: true, truncated: true }
        : { status: 'ok' as const, content: `FULL:${address}`, exact: true };
    }, search: async () => ({ status: 'empty' as const, hits: [] }) };
    const gate = (key: string) => ({ state: createWorldSimulationReadGateState_ACU(),
      usage: { readsUsed: 0, successfulReadBatches: 0 }, readOnce: true, maxReads: 4,
      readRoundState, readRoundKey: key,
      config: { historyTokenBudget: 1000, readTokenBudget: 500, fallbackTokens: 50 },
      count: async (text: string) => text.length });
    const batch = (key: string, addresses: string[]) => runWorldSimulationToolBatch_ACU({
      registry, dependencies, gate: gate(key), calls: [{ kind: 'read' as const, reads: addresses }] });
    const pending = batch('timekeeper:round-1', ['good', 'bad']);
    await entered;
    expect(await batch('timekeeper:round-1', ['other'])).toMatchObject([{ status: 'failed', summary: 'read-in-progress' }]);
    release();
    expect((await pending).every(item => item.status === 'failed' && item.content === undefined)).toBe(true);
    expect(snapshotWorldSimulationEvidenceRegistry_ACU(registry).entries).toEqual([]);
    damaged = false;
    expect((await batch('timekeeper:round-1', ['good', 'bad'])).map(item => item.content)).toEqual(['FULL:good', 'FULL:bad']);
    expect(await batch('timekeeper:round-1', ['other'])).toMatchObject([{ status: 'failed', summary: 'read-once-exhausted' }]);
    expect((await batch('timekeeper:round-2', ['other']))[0]).toMatchObject({ status: 'ok', content: 'FULL:other' });
    expect((await batch('chronicler:round-1', ['other']))[0]).toMatchObject({ status: 'ok', content: 'FULL:other' });
  });

  it('混合越权地址整批预拒绝，零宿主调用且修正后仍可成功读取', async () => {
    const registry = createWorldSimulationEvidenceRegistry_ACU('unauthorized-batch');
    const readRoundState = createWorldSimulationReadRoundState_ACU();
    let readCount = 0;
    const dependencies = { read: async (address: string) => {
      readCount += 1;
      return { status: 'ok' as const, content: `FULL:${address}`, exact: true };
    }, search: async () => ({ status: 'empty' as const, hits: [] }) };
    const gate = { state: createWorldSimulationReadGateState_ACU(), usage: { readsUsed: 0, successfulReadBatches: 0 },
      readOnce: true, maxReads: 3, readRoundState, readRoundKey: 'timekeeper:round-1',
      canReadAddress: (address: string) => worldSimulationCanReadAddress_ACU('timekeeper', address),
      config: { historyTokenBudget: 1000, readTokenBudget: 500, fallbackTokens: 50 },
      count: async (text: string) => text.length };
    const denied = await runWorldSimulationToolBatch_ACU({ registry, dependencies, gate,
      calls: [{ kind: 'read', reads: ['anchor:message', 'field:actors:actor-1'] }] });
    expect(denied).toHaveLength(2);
    expect(denied.every(item => item.status === 'failed' && item.summary.includes('read-address-unauthorized')
      && item.content === undefined && item.evidenceRef === undefined)).toBe(true);
    expect(readCount).toBe(0);
    expect(snapshotWorldSimulationEvidenceRegistry_ACU(registry).entries).toEqual([]);
    expect(gate.usage).toEqual({ readsUsed: 0, successfulReadBatches: 0 });
    expect((await runWorldSimulationToolBatch_ACU({ registry, dependencies, gate,
      calls: [{ kind: 'read', reads: ['anchor:message'] }] }))[0]).toMatchObject({ status: 'ok', content: 'FULL:anchor:message' });
  });

  it('围栏证明越界或 revision 非法时整批不注入，并允许修正后重试', async () => {
    const registry = createWorldSimulationEvidenceRegistry_ACU('fence-out-of-bounds');
    const requestedFence = { lower: 2, upper: 5 };
    const state = createWorldSimulationReadGateState_ACU();
    const usage = { readsUsed: 0, successfulReadBatches: 0 };
    const gate = { state, usage, readOnce: true, maxReads: 2,
      config: { historyTokenBudget: 1000, readTokenBudget: 500, fallbackTokens: 50 },
      count: async (text: string) => text.length };
    let resolvedFence = JSON.stringify({ lower: 1, upper: 5 });
    let revision: string | number = '';
    const dependencies = { read: async (address: string) => ({ status: 'ok' as const,
      content: `PRIVATE:${address}`, exact: true, requestedFence: JSON.stringify(requestedFence),
      resolvedFence: address === 'second' ? resolvedFence : JSON.stringify(requestedFence),
      stableAddress: address, revision: address === 'second' ? revision : 1, completeWithinFence: true }),
    search: async () => ({ status: 'empty' as const, hits: [] }) };
    const run = () => runWorldSimulationToolBatch_ACU({ registry, dependencies, gate,
      calls: [{ kind: 'read' as const, reads: ['first', 'second'], requestedFence }] });
    for (const invalid of [JSON.stringify({ lower: 1, upper: 5 }), JSON.stringify({ lower: 2, upper: 6 })]) {
      resolvedFence = invalid;
      revision = 1;
      const rejected = await run();
      expect(rejected.every(item => item.status === 'failed' && !item.content && !item.evidenceRef)).toBe(true);
      expect(rejected[0].summary).toContain('fence-proof-invalid');
    }
    resolvedFence = JSON.stringify(requestedFence);
    revision = '';
    expect((await run()).every(item => item.status === 'failed' && !item.content)).toBe(true);
    expect(usage.successfulReadBatches).toBe(0);
    expect(snapshotWorldSimulationEvidenceRegistry_ACU(registry).entries).toEqual([]);
    revision = 2;
    expect((await run()).map(item => item.content)).toEqual(['PRIVATE:first', 'PRIVATE:second']);
    expect(usage.successfulReadBatches).toBe(1);
  });
});

it('请求围栏会透传给依赖，且完整 proof 才能放行读取', async () => {
  const registry = createWorldSimulationEvidenceRegistry_ACU('requested-fence-forwarding');
  const state = createWorldSimulationReadGateState_ACU();
  const usage = { readsUsed: 0, successfulReadBatches: 0 };
  const requestedFence = { lower: 1, upper: 2 };
  const seenFences: Array<{ lower?: string | number; upper?: string | number } | undefined> = [];
  const dependencies = {
    read: async (address: string, fence?: { lower?: string | number; upper?: string | number }) => {
      seenFences.push(fence);
      const serializedFence = JSON.stringify(fence);
      return {
        status: 'ok' as const,
        content: `FULL:${address}`,
        exact: true,
        requestedFence: serializedFence,
        resolvedFence: serializedFence,
        stableAddress: address,
        revision: 9,
        completeWithinFence: true,
      };
    },
    search: async () => ({ status: 'empty' as const, hits: [] }),
  };
  const accepted = await runWorldSimulationToolBatch_ACU({
    registry,
    dependencies,
    gate: { state, usage, readOnce: true, maxReads: 1, config: { historyTokenBudget: 1000, readTokenBudget: 500, fallbackTokens: 50 } },
    calls: [{ kind: 'read', reads: ['field:seeds:seed-1:title'], requestedFence }],
  });

  expect(seenFences).toEqual([requestedFence]);
  expect(accepted).toMatchObject([{ status: 'ok', content: 'FULL:field:seeds:seed-1:title' }]);
  expect(usage).toEqual({ readsUsed: 1, successfulReadBatches: 1 });
});

it('请求围栏下缺少 proof 时整批拒绝且不登记 evidence', async () => {
  const registry = createWorldSimulationEvidenceRegistry_ACU('requested-fence-proof-required');
  const state = createWorldSimulationReadGateState_ACU();
  const usage = { readsUsed: 0, successfulReadBatches: 0 };
  const result = await runWorldSimulationToolBatch_ACU({
    registry,
    dependencies: {
      read: async (address: string) => ({ status: 'ok' as const, content: `FULL:${address}`, exact: true }),
      search: async () => ({ status: 'empty' as const, hits: [] }),
    },
    gate: { state, usage, readOnce: true, maxReads: 1, config: { historyTokenBudget: 1000, readTokenBudget: 500, fallbackTokens: 50 } },
    calls: [{ kind: 'read', reads: ['field:seeds:seed-1:title'], requestedFence: { lower: 1, upper: 2 } }],
  });

  expect(result).toMatchObject([{ status: 'failed' }]);
  expect(result[0].summary).toContain('fence-proof-invalid');
  expect(result[0].content).toBeUndefined();
  expect(result[0].evidenceRef).toBeUndefined();
  expect(usage).toEqual({ readsUsed: 0, successfulReadBatches: 0 });
  expect(snapshotWorldSimulationEvidenceRegistry_ACU(registry).entries).toEqual([]);
});

it('默认上围栏预算在无显式围栏时透传给依赖，适配器证明无需回显 requestedFence', async () => {
  const registry = createWorldSimulationEvidenceRegistry_ACU('default-fence-budget');
  const state = createWorldSimulationReadGateState_ACU();
  const usage = { readsUsed: 0, successfulReadBatches: 0 };
  const seenBudgets: Array<number | undefined> = [];
  const dependencies = {
    read: async (address: string, fence?: { lower?: string | number; upper?: string | number }, defaultReadFenceTokens?: number) => {
      expect(fence).toBeUndefined();
      seenBudgets.push(defaultReadFenceTokens);
      return { status: 'ok' as const, content: `FULL:${address}`, exact: true,
        resolvedFence: JSON.stringify({ lower: 0, upper: defaultReadFenceTokens ?? 0 }),
        stableAddress: address, revision: 3, completeWithinFence: true };
    },
    search: async () => ({ status: 'empty' as const, hits: [] }),
  };
  const gate = { state, usage, readOnce: true, maxReads: 2, defaultReadFenceTokens: 539,
    config: { historyTokenBudget: 1000, readTokenBudget: 500, fallbackTokens: 50 },
    count: async (text: string) => text.length };
  const accepted = await runWorldSimulationToolBatch_ACU({ registry, dependencies, gate,
    calls: [{ kind: 'read' as const, reads: ['first', 'second'] }] });

  expect(seenBudgets).toEqual([539, 539]);
  expect(accepted.map(item => item.content)).toEqual(['FULL:first', 'FULL:second']);
  expect(usage).toEqual({ readsUsed: 2, successfulReadBatches: 1 });
});

it('显式请求围栏存在时不注入默认上围栏预算', async () => {
  const registry = createWorldSimulationEvidenceRegistry_ACU('explicit-fence-overrides-default');
  const state = createWorldSimulationReadGateState_ACU();
  const usage = { readsUsed: 0, successfulReadBatches: 0 };
  const requestedFence = { lower: 1, upper: 2 };
  const serialized = JSON.stringify(requestedFence);
  const seenBudgets: Array<number | undefined> = [];
  const dependencies = {
    read: async (address: string, fence?: unknown, defaultReadFenceTokens?: number) => {
      seenBudgets.push(defaultReadFenceTokens);
      return { status: 'ok' as const, content: `FULL:${address}`, exact: true,
        requestedFence: serialized, resolvedFence: serialized,
        stableAddress: address, revision: 4, completeWithinFence: true };
    },
    search: async () => ({ status: 'empty' as const, hits: [] }),
  };
  const accepted = await runWorldSimulationToolBatch_ACU({ registry, dependencies,
    gate: { state, usage, readOnce: true, maxReads: 1, defaultReadFenceTokens: 539,
      config: { historyTokenBudget: 1000, readTokenBudget: 500, fallbackTokens: 50 } },
    calls: [{ kind: 'read', reads: ['field:seeds:seed-1:title'], requestedFence }] });

  expect(seenBudgets).toEqual([undefined]);
  expect(accepted).toMatchObject([{ status: 'ok', content: 'FULL:field:seeds:seed-1:title' }]);
});
  it('声明围栏证明不完整或稳定地址不匹配时整批拒绝，修正后只计一次成功', async () => {
    const registry = createWorldSimulationEvidenceRegistry_ACU('fence-proof-tools');
    const state = createWorldSimulationReadGateState_ACU();
    const usage = { readsUsed: 0, successfulReadBatches: 0 };
    let damaged = true;
    const gate = { state, usage, readOnce: true, maxReads: 2,
      config: { historyTokenBudget: 1000, readTokenBudget: 500, fallbackTokens: 50 },
      count: async (text: string) => text.length };
    const dependencies = {
      read: async (address: string) => damaged
        ? { status: 'ok' as const, content: `FULL:${address}`, exact: true, requestedFence: 'fence:1-2', resolvedFence: 'fence:1-2', stableAddress: 'wrong-address', revision: 7, completeWithinFence: true }
        : { status: 'ok' as const, content: `FULL:${address}`, exact: true, requestedFence: 'fence:1-2', resolvedFence: 'fence:1-2', stableAddress: address, revision: 7, completeWithinFence: true },
      search: async () => ({ status: 'empty' as const, hits: [] }),
    };
    const calls = [{ kind: 'read' as const, reads: ['first', 'second'] }];
    const rejected = await runWorldSimulationToolBatch_ACU({ registry, dependencies, gate, calls });
    expect(rejected.every(item => item.status === 'failed' && item.content === undefined && !item.evidenceRef)).toBe(true);
    expect(rejected.every(item => item.summary?.includes('fence-proof-invalid'))).toBe(true);
    expect(usage).toEqual({ readsUsed: 0, successfulReadBatches: 0 });
    expect(snapshotWorldSimulationEvidenceRegistry_ACU(registry).entries).toEqual([]);

    damaged = false;
    const accepted = await runWorldSimulationToolBatch_ACU({ registry, dependencies, gate, calls });
    expect(accepted.map(item => item.content)).toEqual(['FULL:first', 'FULL:second']);
    expect(usage).toEqual({ readsUsed: 2, successfulReadBatches: 1 });
    expect(snapshotWorldSimulationEvidenceRegistry_ACU(registry).entries).toHaveLength(2);
  });
