import { describe, expect, it, vi } from 'vitest';
import { buildEmptyWorldSimulationLedger_ACU } from '../../../src/service/simulation/defaults';
import { issueWorldExecutionOverlayReceipt_ACU, prepareWorldExecutionRecall_ACU, readWorldExecutionRecall_ACU } from '../../../src/service/simulation/world-execution-recall';
import type { WorldRoundCandidate_ACU } from '../../../src/service/simulation/world-candidate';
import type { WorldActor_ACU, WorldEvent_ACU, WorldFact_ACU } from '../../../src/service/simulation/model';

const config = { limits: { actorsPerPage: 24, recentHistoryPerActor: 3, relatedHistoryPerActor: 2, eventsPerPage: 16, factsPerPage: 16 }, read: { historyTokenBudget: 10000, readTokenBudget: 2000, fallbackTokens: 2000 } };
const count = async (text: string) => Math.max(1, Math.ceil(text.length / 4));
function reorderKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => reorderKeys(item)) as T;
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorderKeys(item)])) as T;
  return value;
}
function actor(id: string): WorldActor_ACU { return { id, name: id, interests: [], location: '', locationRef: null, life: 'alive', diedAtDay: null, deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [], knownFacts: [], visibility: 'hidden', currentAction: null, longTermAction: null, shortTermAction: null, simulationStatus: 'active', loreRefs: [], experiences: [], revision: 1 }; }
function event(id: string, actorIds: string[] = []): WorldEvent_ACU { return { id, title: id, state: '进行', status: 'active', actorIds, organizationIds: [], locationRefs: [], startedAt: { day: 1, slot: '' }, deadline: null, nextCheck: { day: 1, slot: '', reason: '检查' }, relatedEventIds: [], loreRefs: [], evidenceRefs: [], tags: [], revision: 1, legacy: null }; }
function fact(id: string, actorIds: string[] = [], worldEventIds: string[] = []): WorldFact_ACU { return { id, summary: id, temporalKind: 'occurrence', happenedAt: { day: 1, slot: '' }, validFrom: null, validUntil: null, locationRef: null, actorIds, worldEventIds, projectionPolicy: 'internal', revealState: 'locked', revealGate: null, nextCheck: { day: 1, slot: '', reason: '检查' }, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 }; }

describe('执行召回快照', () => {
  it('冷归档历史仍进入本人有限目录和精读，未选全文不泄漏且旧许可随冷层变化失效', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.clock.day = 40;
    ledger.actors = [{ ...actor('a'), locationRef: { region: '北京', place: '钟楼' } }];
    const history = (id: string, day: number, region: string) => ({ id, summary: `历史秘密全文-${id}`, happenedAt: { day, slot: '' },
      actorIds: ['a'], worldEventIds: [], locationRef: { region }, sourceFactIds: [], importance: 3,
      category: '人生节点', visibility: 'internal' as const, revision: 1, legacyRefs: [] });
    ledger.historyMilestones = [history('hot-1', 40, '上海'), history('hot-2', 39, '上海'), history('hot-3', 38, '上海')];
    ledger.historyArchive = [history('cold-local', 1, '北京'), history('cold-unselected', 2, '广州')];
    const before = structuredClone(ledger);
    const ready = await prepareWorldExecutionRecall_ACU(ledger, ledger.clock, null, config, count);
    if (!ready.allowed) throw new Error('expected receipt');
    expect(ready.manifests[0].actors[0].relatedHistoryIds).toEqual(['cold-local']);
    expect(JSON.stringify(ready.manifests)).not.toContain('历史秘密全文');
    const request = { kind: 'actor' as const, batchIndex: 0, historyByActor: { a: ['cold-local'] }, worldEventIds: [], factIds: [] };
    const read = await readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, config, request, undefined, count);
    expect(read).toMatchObject({ allowed: true, materials: { historyMilestones: [ledger.historyArchive[0]] } });
    expect(JSON.stringify(read)).not.toContain('历史秘密全文-cold-unselected');
    expect(ledger).toEqual(before);
    const next = await prepareWorldExecutionRecall_ACU(ledger, ledger.clock, null, config, count);
    if (!next.allowed) throw new Error('expected receipt');
    ledger.historyArchive[0].summary = '冷层已变更';
    expect(await readWorldExecutionRecall_ACU(next.receipt, ledger, ledger.clock, null, config, request, undefined, count))
      .toMatchObject({ allowed: false, reason: expect.stringContaining('快照已变化') });
  });

  it('260 人按页各自预算；总目录增长而单页峰值有界', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = Array.from({ length: 260 }, (_, i) => actor(`a${String(i).padStart(3, '0')}`));
    const result = await prepareWorldExecutionRecall_ACU(ledger, ledger.clock, null, { ...config, read: { ...config.read, readTokenBudget: 1200 } }, count);
    expect(result.allowed).toBe(true); if (!result.allowed) return;
    expect(result.manifests.length).toBeGreaterThan(1); expect(result.manifests.every(page => page.actorIds.length <= 24)).toBe(true);
    expect(result.peakDirectoryTokens).toBeLessThanOrEqual(1200); expect(result.totalDirectoryTokens).toBeGreaterThan(result.peakDirectoryTokens);
  });

  it('后页目录超额时不公开前页 manifest 或 receipt', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = Array.from({ length: 25 }, (_, i) => actor(`a${String(i).padStart(2, '0')}`));
    let pagesCounted = 0;
    const result = await prepareWorldExecutionRecall_ACU(ledger, ledger.clock, null, config, async text => {
      pagesCounted += 1;
      return pagesCounted === 2 ? 2001 : count(text);
    });
    expect(pagesCounted).toBe(2);
    expect(result).toMatchObject({ allowed: false, reason: expect.stringContaining('预算拒绝') });
    expect('manifests' in result).toBe(false); expect('receipt' in result).toBe(false);
  });

  it('伪造、时钟地点账本或批次配置变化以及非法索引均拒绝', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a')]; ledger.worldEvents = [event('e', ['a'])];
    const ready = await prepareWorldExecutionRecall_ACU(ledger, ledger.clock, null, config, count); if (!ready.allowed) throw new Error('expected receipt');
    const request = { kind: 'world' as const, pageIndex: 0, worldEventIds: ['e'], factIds: [] };
    expect((await readWorldExecutionRecall_ACU(ready.receipt, ledger, { ...ledger.clock, day: 2 }, null, config, request, undefined, count)).allowed).toBe(false);
    expect((await readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, { region: 'x', place: 'y' }, config, request, undefined, count)).allowed).toBe(false);
    expect((await readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, { ...config, actorBatchSize: 12 }, request, undefined, count)).allowed).toBe(false);
    expect((await readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, config, { ...request, pageIndex: -1 }, undefined, count)).allowed).toBe(false);
    expect((await readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, config, { ...request, pageIndex: .1 }, undefined, count)).allowed).toBe(false);
    ledger.worldEvents[0].state = '变化';
    expect((await readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, config, request, undefined, count)).allowed).toBe(false);
  });

  it('JSON 对象键重排不使账本、时钟、地点、配置和请求签名失效，字段值变化仍拒绝', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = [actor('a')]; ledger.worldEvents = [event('e')];
    const location = { region: '城区', place: '广场' };
    const ready = await prepareWorldExecutionRecall_ACU(ledger, ledger.clock, location, config, count);
    if (!ready.allowed) throw new Error('expected receipt');
    const request = { kind: 'actor' as const, batchIndex: 0, historyByActor: { a: [] }, worldEventIds: ['e'], factIds: [] };
    const reordered = await readWorldExecutionRecall_ACU(ready.receipt, reorderKeys(ledger), reorderKeys(ledger.clock), reorderKeys(location), reorderKeys(config), reorderKeys(request), undefined, count);
    expect(reordered).toMatchObject({ allowed: true, materials: { actors: [{ id: 'a' }], worldEvents: [{ id: 'e' }] } });
    expect(await readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, location, config, request, undefined, count))
      .toMatchObject({ allowed: false, diagnostic: { code: 'EXEC_READ_CONSUMED' } });
    expect(await readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, location, config, { ...request, worldEventIds: [] }, undefined, count))
      .toMatchObject({ allowed: false, diagnostic: { code: 'EXEC_READ_SELECTION_CHANGED' } });
    const changed = await prepareWorldExecutionRecall_ACU(ledger, ledger.clock, location, config, count);
    if (!changed.allowed) throw new Error('expected receipt');
    expect(await readWorldExecutionRecall_ACU(changed.receipt, { ...reorderKeys(ledger), worldEvents: [event('different')] }, ledger.clock, location, config, request, undefined, count))
      .toMatchObject({ allowed: false, diagnostic: { snapshot: 'ledger' } });
  });

  it('坏 counter 拒绝目录且不泄露 receipt，精读预算超额不返回材料', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a')];
    const bad = await prepareWorldExecutionRecall_ACU(ledger, ledger.clock, null, config, async () => Number.NaN);
    expect(bad).toMatchObject({ allowed: false }); expect('receipt' in bad).toBe(false);
    ledger.actors[0].name = '很长'.repeat(10000);
    const ready = await prepareWorldExecutionRecall_ACU(ledger, ledger.clock, null, config, count); if (!ready.allowed) throw new Error('expected receipt');
    const denied = await readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, config, { kind: 'actor', batchIndex: 0, historyByActor: { a: [] }, worldEventIds: [], factIds: [] }, undefined, count);
    expect(denied).toMatchObject({ allowed: false, reason: expect.stringContaining('预算拒绝') }); expect(JSON.stringify(denied)).not.toContain('很长');
  });
  it('receipt 防伪、并发消费与改选均拒绝', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a')]; ledger.worldEvents = [event('event-a', ['a'])];
    const ready = await prepareWorldExecutionRecall_ACU(ledger, ledger.clock, null, config, count); if (!ready.allowed) throw new Error('expected receipt');
    const request = { kind: 'world' as const, pageIndex: 0, worldEventIds: ['event-a'], factIds: [] };
    expect((await readWorldExecutionRecall_ACU({} as never, ledger, ledger.clock, null, config, request, undefined, count)).allowed).toBe(false);
    const [first, second] = await Promise.all([readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, config, request, undefined, count), readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, config, request, undefined, count)]);
    expect([first.allowed, second.allowed].filter(Boolean)).toHaveLength(1);
    expect(await readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, config, { ...request, worldEventIds: [] }, undefined, count)).toMatchObject({ allowed: false, reason: expect.stringContaining('执行精读请求不得变更选择') });
  });

  it('本批只读获选基线：无 owner、别人人物事件和独立事实可读，目录外秘密仍拒绝', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a'), actor('b')];
    ledger.worldEvents = [event('unowned'), event('event-b', ['b'])];
    ledger.facts = [fact('independent'), { ...fact('secret-b', ['b']), nextCheck: null }];
    const ready = await prepareWorldExecutionRecall_ACU(ledger, ledger.clock, null, config, count); if (!ready.allowed) throw new Error('expected receipt');
    ready.manifests[0].dueFactIds.push('secret-b');
    const result = await readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, config,
      { kind: 'actor', batchIndex: 0, historyByActor: { a: [] }, worldEventIds: ['unowned', 'event-b'], factIds: ['independent'] }, undefined, count);
    expect(result).toMatchObject({ allowed: true, materials: { worldEvents: [{ id: 'unowned' }, { id: 'event-b' }], facts: [{ id: 'independent' }] } });
    expect(JSON.stringify(result)).not.toContain('secret-b');
    const denied = await readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, config,
      { kind: 'world', pageIndex: 0, worldEventIds: [], factIds: ['secret-b'] }, undefined, count);
    expect(denied).toMatchObject({ allowed: false, diagnostic: { code: 'EXEC_BASELINE_FACT_UNLISTED' } });
    expect('materials' in denied).toBe(false);
  });

  it('非法人物批次索引拒绝，精读计数期间改账本或请求不会泄漏材料', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a')];
    const ready = await prepareWorldExecutionRecall_ACU(ledger, ledger.clock, null, config, count); if (!ready.allowed) throw new Error('expected receipt');
    const request = { kind: 'actor' as const, batchIndex: 0, historyByActor: { a: [] }, worldEventIds: [] as string[], factIds: [] as string[] };
    for (const batchIndex of [-1, 0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(await readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, config, { ...request, batchIndex }, undefined, count))
        .toMatchObject({ allowed: false, reason: expect.stringContaining('执行精读索引非法') });
    }
    const result = await readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, config, request, undefined, async text => {
      request.factIds.push('forged');
      ledger.actors[0].name = '计数期间改名';
      return count(text);
    });
    expect(result).toMatchObject({ allowed: false, reason: expect.stringContaining('快照已变化') });
    expect('materials' in result).toBe(false);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 0])('精读坏 counter %s 不返回材料', async invalid => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a')];
    const ready = await prepareWorldExecutionRecall_ACU(ledger, ledger.clock, null, config, count); if (!ready.allowed) throw new Error('expected receipt');
    const result = await readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, config,
      { kind: 'actor', batchIndex: 0, historyByActor: { a: [] }, worldEventIds: [], factIds: [] }, undefined, async () => invalid);
    expect(result).toMatchObject({ allowed: false, reason: expect.stringContaining('执行精读计数非法') });
    expect('materials' in result).toBe(false);
  });

  it('空 roster 的 preview 仍可精读本页到期世界资料，且不取得 actor 业务许可', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.worldEvents = [event('unowned')];
    const ready = await prepareWorldExecutionRecall_ACU(ledger, ledger.clock, null, config, count); if (!ready.allowed) throw new Error('expected receipt');
    const preview = await readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, config,
      { kind: 'preview', pageIndex: 0, requestKey: 'empty-page', historyByActor: {}, worldEventIds: ['unowned'], factIds: [] }, undefined, count);
    expect(preview).toMatchObject({ allowed: true, materials: { actors: [], worldEvents: [{ id: 'unowned' }] } });
    await expect(readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, config,
      { kind: 'actor', batchIndex: 0, historyByActor: {}, worldEventIds: [], factIds: [] }, undefined, count)).resolves.toMatchObject({ allowed: false });
  });

  it('preview 限于当页目录，采用独立 requestKey，不消费后续 actor 业务精读也不接受 overlay', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a')];
    ledger.historyMilestones = [{ id: 'recent', summary: '近期完整历史', happenedAt: { day: 1, slot: '' }, actorIds: ['a'], worldEventIds: [], locationRef: null, sourceFactIds: [], importance: 1, category: '历史', visibility: 'internal', revision: 1, legacyRefs: [] }];
    const ready = await prepareWorldExecutionRecall_ACU(ledger, ledger.clock, null, config, count); if (!ready.allowed) throw new Error('expected receipt');
    const preview = await readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, config,
      { kind: 'preview', pageIndex: 0, requestKey: 'choose-1', historyByActor: { a: ['recent'] }, worldEventIds: [], factIds: [] }, undefined, count);
    expect(preview).toMatchObject({ allowed: true, materials: { historyMilestones: [{ id: 'recent' }] } });
    await expect(readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, config,
      { kind: 'preview', pageIndex: 0, requestKey: 'choose-1', historyByActor: { a: [] }, worldEventIds: [], factIds: [] }, undefined, count)).resolves.toMatchObject({ allowed: false });
    await expect(readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, config,
      { kind: 'preview', pageIndex: 0, requestKey: 'choose-2', historyByActor: { a: ['forged'] }, worldEventIds: [], factIds: [] }, undefined, count)).resolves.toMatchObject({ allowed: false });
    const business = await readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, config,
      { kind: 'actor', batchIndex: 0, historyByActor: { a: ['recent'] }, worldEventIds: [], factIds: [] }, undefined, count);
    expect(business.allowed).toBe(true);
  });
  it('冷事实不因执行精读被纳入热层目录或获得额外权限', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.clock.day = 2;
    ledger.actors = [actor('a')];
    ledger.facts = [fact('hot-selected', ['a'])];
    ledger.factArchive = [{ ...fact('cold-selected', ['a']), nextCheck: { day: 1, slot: '', reason: '检查' } },
      { ...fact('cold-unselected', ['a']), nextCheck: null }];
    const ready = await prepareWorldExecutionRecall_ACU(ledger, ledger.clock, null, config, count);
    if (!ready.allowed) throw new Error('expected receipt');
    expect(ready.manifests[0].dueFactIds).toEqual(['hot-selected']);
    expect(await readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, config,
      { kind: 'world', pageIndex: 0, worldEventIds: [], factIds: ['cold-selected'] }, undefined, count))
      .toMatchObject({ allowed: false });
  });

  it('未经成功精读的世界条目不能伪造 overlay 许可', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a')];
    ledger.worldEvents = [event('secret-event', ['a'])];
    const ready = await prepareWorldExecutionRecall_ACU(ledger, ledger.clock, null, config, count); if (!ready.allowed) throw new Error('expected receipt');
    const candidate: WorldRoundCandidate_ACU = {
      baseRevision: ledger.revision, candidateClock: ledger.clock,
      worldEventWrites: [{ value: { ...ledger.worldEvents[0], revision: 2 }, expectedRevision: 1 }],
      actorWrites: [], factWrites: [], historyMilestoneWrites: [],
      actorCompletions: [{ actorId: 'a', completion: 'no_change', expectedRevision: 1 }], projection: ledger.projection, completion: 'changed',
    };
    expect(() => issueWorldExecutionOverlayReceipt_ACU(ready.receipt, ledger, candidate)).toThrow();
  });

  it('世界 overlay 不接受人物专员的历史正文记录写集', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    const ready = await prepareWorldExecutionRecall_ACU(ledger, ledger.clock, null, config, count);
    if (!ready.allowed) throw new Error('expected receipt');
    expect(() => issueWorldExecutionOverlayReceipt_ACU(ready.receipt, ledger, {
      baseRevision: ledger.revision, candidateClock: ledger.clock, worldEventWrites: [], actorWrites: [],
      factWrites: [], historyMilestoneWrites: [], actorCompletions: [], projection: ledger.projection,
      historyRecordings: [{ historyId: 'history', expectedRevision: 1, record: { status: 'recorded',
        recordedAt: { day: 1, slot: '' }, anchorDigest: 'a'.repeat(64), deliveryQuote: '投送', evidenceQuote: '正文' } }],
      completion: 'changed',
    })).toThrow('执行 overlay 只能来自纯世界阶段候选');
  });

  it('世界阶段已读取但未改写的事实仍能随关联人物跨批次读取', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a'), actor('b')];
    ledger.facts = [fact('existing-source', ['a', 'b'])];
    const scoped = { ...config, actorBatchSize: 1 };
    const ready = await prepareWorldExecutionRecall_ACU(ledger, ledger.clock, null, scoped, count);
    if (!ready.allowed) throw new Error('expected receipt');
    await readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, scoped,
      { kind: 'world', pageIndex: 0, worldEventIds: [], factIds: ['existing-source'] }, undefined, count);
    const overlay = issueWorldExecutionOverlayReceipt_ACU(ready.receipt, ledger, {
      baseRevision: ledger.revision, candidateClock: ledger.clock, worldEventWrites: [], actorWrites: [], factWrites: [], historyMilestoneWrites: [],
      actorCompletions: ledger.actors.map(row => ({ actorId: row.id, completion: 'no_change', expectedRevision: 1 })),
      projection: ledger.projection, completion: 'no_change',
    });
    for (const [batchIndex, actorId] of ['a', 'b'].entries()) {
      const result = await readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, scoped,
        { kind: 'actor', batchIndex, historyByActor: { [actorId]: [] }, worldEventIds: [], factIds: [] }, overlay, count);
      expect(result).toMatchObject({ allowed: true, materials: { facts: [{ id: 'existing-source' }] } });
    }
  });

  it('世界阶段已读取的无 owner 事件、别人人物事件和独立事实跨批次完整供给', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a'), actor('b')];
    ledger.worldEvents = [event('unowned'), event('other-actor', ['b'])];
    ledger.facts = [fact('independent')];
    const scoped = { ...config, actorBatchSize: 1 };
    const ready = await prepareWorldExecutionRecall_ACU(ledger, ledger.clock, null, scoped, count);
    if (!ready.allowed) throw new Error('expected receipt');
    const worldRead = await readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, scoped,
      { kind: 'world', pageIndex: 0, worldEventIds: ['unowned', 'other-actor'], factIds: ['independent'] }, undefined, count);
    expect(worldRead.allowed).toBe(true);
    const overlay = issueWorldExecutionOverlayReceipt_ACU(ready.receipt, ledger, {
      baseRevision: ledger.revision, candidateClock: ledger.clock, worldEventWrites: [], actorWrites: [], factWrites: [], historyMilestoneWrites: [],
      actorCompletions: ledger.actors.map(row => ({ actorId: row.id, completion: 'no_change', expectedRevision: 1 })),
      projection: ledger.projection, completion: 'no_change',
    });
    for (const [batchIndex, actorId] of ['a', 'b'].entries()) {
      const result = await readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, scoped,
        { kind: 'actor', batchIndex, historyByActor: { [actorId]: [] }, worldEventIds: [], factIds: [] }, overlay, count);
      expect(result).toMatchObject({ allowed: true, materials: { actors: [{ id: actorId }], worldEvents: [{ id: 'unowned' }, { id: 'other-actor' }], facts: [{ id: 'independent' }] } });
    }
  });

  it('世界页能精读未到期、无复核日及暂停/解决/取消事件，目录仅含 ID', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.worldEvents = [event('active'),
      { ...event('future-check'), status: 'scheduled', nextCheck: { day: 30, slot: '', reason: '隐秘复核' } },
      { ...event('no-check'), nextCheck: null },
      { ...event('paused'), status: 'paused', nextCheck: null },
      { ...event('resolved'), status: 'resolved', nextCheck: null },
      { ...event('cancelled'), status: 'cancelled', nextCheck: null }];
    ledger.worldEvents.forEach(row => { row.state = `内部世界事件正文-${row.id}`; });
    const scoped = { ...config, limits: { ...config.limits, eventsPerPage: 2, factsPerPage: 2 } };
    const snapshot = structuredClone(ledger);
    const ready = await prepareWorldExecutionRecall_ACU(ledger, ledger.clock, null, scoped, count);
    if (!ready.allowed) throw new Error('expected receipt');
    expect(ready.manifests.map(page => page.dueEventIds)).toEqual([
      ['active', 'future-check'], ['cancelled', 'no-check'], ['paused', 'resolved'],
    ]);
    expect(JSON.stringify(ready.manifests)).not.toContain('内部世界事件正文');
    expect(JSON.stringify(ready.manifests)).not.toContain('隐秘复核');
    for (const [pageIndex, page] of ready.manifests.entries()) {
      const read = await readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, scoped,
        { kind: 'world', pageIndex, worldEventIds: page.dueEventIds, factIds: [] }, undefined, count);
      expect(read.allowed).toBe(true);
      if (!read.allowed) throw new Error('expected world read');
      expect(read.materials.worldEvents.map(row => row.id).sort()).toEqual([...page.dueEventIds].sort());
      expect(read.materials.worldEvents.map(row => row.state).sort())
        .toEqual(page.dueEventIds.map(id => `内部世界事件正文-${id}`).sort());
    }
    expect(ledger).toEqual(snapshot);
  });

  it('前页已接纳的新事件和秘密事实可在后续世界页读取，preview 不能借 overlay 越权', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.worldEvents = [event('first'), event('second')];
    const scoped = { ...config, limits: { ...config.limits, eventsPerPage: 1, factsPerPage: 1 } };
    const snapshot = structuredClone(ledger);
    const ready = await prepareWorldExecutionRecall_ACU(ledger, ledger.clock, null, scoped, count);
    if (!ready.allowed) throw new Error('expected receipt');
    expect(ready.manifests.map(page => page.dueEventIds)).toEqual([['first'], ['second']]);
    expect(await readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, scoped,
      { kind: 'world', pageIndex: 0, worldEventIds: ['first'], factIds: [] }, undefined, count))
      .toMatchObject({ allowed: true });
    const addedEvent = { ...event('new-event'), title: '前页接纳的事件秘密' };
    const addedFact = { ...fact('new-fact', [], ['new-event']), summary: '前页接纳的事实秘密' };
    const candidate: WorldRoundCandidate_ACU = {
      baseRevision: ledger.revision, candidateClock: ledger.clock,
      worldEventWrites: [{ value: addedEvent, expectedRevision: 0 }],
      factWrites: [{ value: addedFact, expectedRevision: 0 }], actorWrites: [], historyMilestoneWrites: [],
      actorCompletions: [], projection: ledger.projection, completion: 'changed',
    };
    const overlay = issueWorldExecutionOverlayReceipt_ACU(ready.receipt, ledger, candidate);
    expect(JSON.stringify(ready.manifests)).not.toContain('前页接纳的事实秘密');
    const preview = await readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, scoped,
      { kind: 'preview', pageIndex: 1, requestKey: 'overlay-denied', historyByActor: {}, worldEventIds: ['second'], factIds: [] }, overlay, count);
    expect(preview).toMatchObject({ allowed: false, diagnostic: { code: 'EXEC_OVERLAY_REQUEST_KIND_INVALID', pageIndex: 1 } });
    expect(preview).not.toHaveProperty('materials');
    expect(JSON.stringify(preview)).not.toContain('前页接纳的事实秘密');
    const world = await readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, scoped,
      { kind: 'world', pageIndex: 1, worldEventIds: ['second'], factIds: [] }, overlay, count);
    expect(world.allowed).toBe(true);
    if (!world.allowed) throw new Error('expected overlay world read');
    expect(world.materials.worldEvents.map(row => row.id)).toEqual(['second', 'first', 'new-event']);
    expect(world.materials.worldEvents.find(row => row.id === 'new-event')?.title).toBe('前页接纳的事件秘密');
    expect(world.materials.facts).toMatchObject([{ id: 'new-fact', summary: '前页接纳的事实秘密' }]);
    expect(ledger).toEqual(snapshot);
  });

  it('后续世界页 overlay 超预算整包拒绝，不泄漏前页接纳的秘密材料', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.worldEvents = [event('first'), event('second')];
    const scoped = { ...config, limits: { ...config.limits, eventsPerPage: 1, factsPerPage: 1 } };
    const ready = await prepareWorldExecutionRecall_ACU(ledger, ledger.clock, null, scoped, count);
    if (!ready.allowed) throw new Error('expected receipt');
    expect(await readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, scoped,
      { kind: 'world', pageIndex: 0, worldEventIds: ['first'], factIds: [] }, undefined, count))
      .toMatchObject({ allowed: true });
    const secret = '前页新增秘密事实正文'.repeat(10000);
    const overlay = issueWorldExecutionOverlayReceipt_ACU(ready.receipt, ledger, {
      baseRevision: ledger.revision, candidateClock: ledger.clock,
      worldEventWrites: [{ value: event('new-event'), expectedRevision: 0 }],
      factWrites: [{ value: { ...fact('new-fact', [], ['new-event']), summary: secret }, expectedRevision: 0 }],
      actorWrites: [], historyMilestoneWrites: [], actorCompletions: [], projection: ledger.projection, completion: 'changed',
    });
    const denied = await readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, scoped,
      { kind: 'world', pageIndex: 1, worldEventIds: ['second'], factIds: [] }, overlay, count);
    expect(denied).toMatchObject({ allowed: false, diagnostic: { code: 'EXEC_READ_BUDGET_REJECTED', pageIndex: 1 } });
    expect(denied).not.toHaveProperty('materials');
    expect(JSON.stringify(denied)).not.toContain('前页新增秘密事实正文');
    expect(await readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, scoped,
      { kind: 'world', pageIndex: 1, worldEventIds: ['second'], factIds: [] }, undefined, count))
      .toMatchObject({ allowed: false, diagnostic: { code: 'EXEC_READ_CONSUMED' } });
  });

  it('获选世界 overlay 合并最新状态并供两个批次共享，超额 overlay 整包拒绝', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a'), actor('b')];
    ledger.worldEvents = [event('shared-event', ['a', 'b'])];
    const scoped = { ...config, actorBatchSize: 1 };
    const ready = await prepareWorldExecutionRecall_ACU(ledger, ledger.clock, null, scoped, count); if (!ready.allowed) throw new Error('expected receipt');
    expect(await readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, scoped,
      { kind: 'world', pageIndex: 0, worldEventIds: ['shared-event'], factIds: [] }, undefined, count)).toMatchObject({ allowed: true });
    const resultFact = fact('shared-result', ['a', 'b'], ['shared-event']);
    const candidate: WorldRoundCandidate_ACU = {
      baseRevision: ledger.revision, candidateClock: ledger.clock,
      worldEventWrites: [{ value: { ...ledger.worldEvents[0], state: '阶段已完成', revision: 2 }, expectedRevision: 1 }],
      actorWrites: [], factWrites: [{ value: resultFact, expectedRevision: 0 }], historyMilestoneWrites: [],
      actorCompletions: ledger.actors.map(row => ({ actorId: row.id, completion: 'no_change', expectedRevision: 1 })),
      projection: ledger.projection, completion: 'changed',
    };
    const overlay = issueWorldExecutionOverlayReceipt_ACU(ready.receipt, ledger, candidate);
    for (const [batchIndex, actorId] of ['a', 'b'].entries()) {
      const result = await readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, scoped,
        { kind: 'actor', batchIndex, historyByActor: { [actorId]: [] }, worldEventIds: [], factIds: [] }, overlay, count);
      expect(result.allowed).toBe(true); if (!result.allowed) throw new Error('expected shared overlay');
      expect(result.materials.actors.map(row => row.id)).toEqual([actorId]);
      expect(result.materials.worldEvents).toMatchObject([{ id: 'shared-event', state: '阶段已完成', revision: 2 }]);
      expect(result.materials.facts.map(row => row.id)).toEqual(['shared-result']);
    }
    const second = await prepareWorldExecutionRecall_ACU(ledger, ledger.clock, null, scoped, count); if (!second.allowed) throw new Error('expected receipt');
    await readWorldExecutionRecall_ACU(second.receipt, ledger, ledger.clock, null, scoped,
      { kind: 'world', pageIndex: 0, worldEventIds: ['shared-event'], factIds: [] }, undefined, count);
    const oversized = structuredClone(candidate); oversized.factWrites[0].value.summary = '超大秘密'.repeat(10000);
    const largeOverlay = issueWorldExecutionOverlayReceipt_ACU(second.receipt, ledger, oversized);
    const denied = await readWorldExecutionRecall_ACU(second.receipt, ledger, ledger.clock, null, scoped,
      { kind: 'actor', batchIndex: 0, historyByActor: { a: [] }, worldEventIds: [], factIds: [] }, largeOverlay, count);
    expect(denied).toMatchObject({ allowed: false, reason: expect.stringContaining('预算拒绝') });
    expect(JSON.stringify(denied)).not.toContain('超大秘密'); expect('materials' in denied).toBe(false);
  });
  it('失败定位只记录 ID，关闭 debug/API 开关仍写 error 且不泄露材料', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('actor-a')];
    ledger.worldEvents = [event('event-a', ['actor-a'])]; ledger.facts = [fact('fact-a', ['actor-a'])];
    const ready = await prepareWorldExecutionRecall_ACU(ledger, ledger.clock, null, config, count);
    if (!ready.allowed) throw new Error('expected receipt');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const cases = [
        { request: { kind: 'world' as const, pageIndex: 10, worldEventIds: [], factIds: [] }, code: 'EXEC_BASELINE_PAGE_MISSING', pageIndex: 10 },
        { request: { kind: 'world' as const, pageIndex: 0, worldEventIds: ['private-event'], factIds: [] }, code: 'EXEC_BASELINE_EVENT_UNLISTED', eventId: 'private-event' },
        { request: { kind: 'world' as const, pageIndex: 0, worldEventIds: [], factIds: ['private-fact'] }, code: 'EXEC_BASELINE_FACT_UNLISTED', factId: 'private-fact' },
        { request: { kind: 'actor' as const, batchIndex: 2, historyByActor: {}, worldEventIds: [], factIds: [] }, code: 'EXEC_BASELINE_BATCH_EMPTY', batchIndex: 2 },
        { request: { kind: 'actor' as const, batchIndex: 0, historyByActor: { outsider: [] }, worldEventIds: [], factIds: [] }, code: 'EXEC_BASELINE_ACTOR_OUT_OF_BATCH', actorId: 'outsider' },
        { request: { kind: 'preview' as const, pageIndex: 0, requestKey: 'history-denied', historyByActor: { 'actor-a': ['private-history'] }, worldEventIds: [], factIds: [] }, code: 'EXEC_BASELINE_HISTORY_UNLISTED', historyId: 'private-history' },
      ];
      for (const { request, code, ...detail } of cases) {
        const isolated = await prepareWorldExecutionRecall_ACU(ledger, ledger.clock, null, config, count);
        if (!isolated.allowed) throw new Error('expected receipt');
        const result = await readWorldExecutionRecall_ACU(isolated.receipt, ledger, ledger.clock, null, config, request, undefined, count);
        expect(result).toMatchObject({ allowed: false, diagnostic: { code, ...detail }, reason: expect.stringContaining(code) });
        expect(result).not.toHaveProperty('materials');
      }
      expect(error).toHaveBeenCalledTimes(cases.length);
      expect(JSON.stringify(error.mock.calls)).not.toContain('summary');
      expect(JSON.stringify(error.mock.calls)).not.toContain('materials');
    } finally { error.mockRestore(); }
  });
  it('时钟、地点、配置、roster、账本快照分别标记，目录与精读预算给出页批 limit', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('actor-a')];
    const ready = await prepareWorldExecutionRecall_ACU(ledger, ledger.clock, null, config, count);
    if (!ready.allowed) throw new Error('expected receipt');
    const request = { kind: 'actor' as const, batchIndex: 0, historyByActor: { 'actor-a': [] }, worldEventIds: [], factIds: [] };
    for (const [changed, label] of [
      [{ ledger, clock: { ...ledger.clock, day: 2 }, location: null, config }, 'clock'],
      [{ ledger, clock: ledger.clock, location: { region: '某地' }, config }, 'location'],
      [{ ledger, clock: ledger.clock, location: null, config: { ...config, actorBatchSize: 2 } }, 'config'],
      [{ ledger: { ...ledger, actors: [] }, clock: ledger.clock, location: null, config }, 'roster'],
      [{ ledger: { ...ledger, revision: ledger.revision + 1 }, clock: ledger.clock, location: null, config }, 'ledger'],
    ] as const) {
      expect(await readWorldExecutionRecall_ACU(ready.receipt, changed.ledger, changed.clock, changed.location, changed.config, request, undefined, count))
        .toMatchObject({ allowed: false, diagnostic: { code: 'EXEC_SNAPSHOT_CHANGED', snapshot: label, batchIndex: 0 } });
    }
    const denied = await readWorldExecutionRecall_ACU(ready.receipt, ledger, ledger.clock, null, config, request, undefined, async () => 2001);
    expect(denied).toMatchObject({ allowed: false, diagnostic: { code: 'EXEC_READ_BUDGET_REJECTED', batchIndex: 0, batch: 2001, limit: 2000 } });
    const directory = await prepareWorldExecutionRecall_ACU(ledger, ledger.clock, null, config, async () => 2001);
    expect(directory).toMatchObject({ allowed: false, diagnostic: { code: 'EXEC_DIRECTORY_BUDGET_REJECTED', pageIndex: 0, batch: 2001, limit: 2000 } });
  });
  it('overlay 违规写集、事件及事实引用逐项报告 code 与 ID', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('actor-a')]; ledger.worldEvents = [event('event-a', ['actor-a'])];
    const ready = await prepareWorldExecutionRecall_ACU(ledger, ledger.clock, null, config, count); if (!ready.allowed) throw new Error('expected receipt');
    const candidate: WorldRoundCandidate_ACU = {
      baseRevision: ledger.revision, candidateClock: ledger.clock, worldEventWrites: [], factWrites: [], actorWrites: [], historyMilestoneWrites: [],
      actorCompletions: [{ actorId: 'actor-a', completion: 'no_change', expectedRevision: 1 }], projection: ledger.projection, completion: 'changed',
    };
    expect(() => issueWorldExecutionOverlayReceipt_ACU(ready.receipt, ledger, { ...candidate, actorWrites: [{ value: actor('actor-a'), expectedRevision: 1 }] }))
      .toThrow('EXEC_OVERLAY_ACTOR_WRITE');
    expect(() => issueWorldExecutionOverlayReceipt_ACU(ready.receipt, ledger, { ...candidate, worldEventWrites: [{ value: ledger.worldEvents[0], expectedRevision: 1 }] }))
      .toThrow('EXEC_OVERLAY_EVENT_UNREAD');
    expect(() => issueWorldExecutionOverlayReceipt_ACU(ready.receipt, ledger, { ...candidate, factWrites: [{ value: fact('new-fact', [], ['unread-event']), expectedRevision: 0 }] }))
      .toThrow('EXEC_OVERLAY_FACT_EVENT_UNREAD');
    expect(() => issueWorldExecutionOverlayReceipt_ACU(ready.receipt, ledger, { ...candidate, factWrites: [{ value: { ...fact('new-fact'), supersedesFactIds: ['unread-fact'] }, expectedRevision: 0 }] }))
      .toThrow('EXEC_OVERLAY_FACT_SUPERSEDES_UNREAD');
  });
});
