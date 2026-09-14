import { describe, expect, it, vi } from 'vitest';
import type { WorldSimulationBudget_ACU, WorldStateSnapshot_ACU, WorldStoryClock_ACU } from '../../../../src/service/simulation/model';
import { WorldSimulationValidationError_ACU } from '../../../../src/service/simulation/model';
import { findWorldSimulationAgent_ACU, selectWorldSimulationAgents_ACU, selectWorldSimulationLightAgentFromFocusHints_ACU } from '../../../../src/service/simulation/agent/agent-catalog';
import { parseWorldSimulationAgentOutput_ACU } from '../../../../src/service/simulation/agent/agent-protocol';
import { runWorldSimulationAgentLoop_ACU } from '../../../../src/service/simulation/agent/agent-main-loop';

const clock = (precision: WorldStoryClock_ACU['precision'] = 'approximate', elapsedSinceLastRun = '约一日'): WorldStoryClock_ACU => ({ anchorText: '港口次日', elapsedSinceLastRun, precision, evidenceIndexes: precision === 'unknown' ? [] : [4], updatedIndex: 5 });
const budget = (patch: Partial<WorldSimulationBudget_ACU> = {}): WorldSimulationBudget_ACU => ({ maxMasterModelTurns: 1, maxSpecialistModelTurns: 1, maxDelegations: 1, readTokenBudget: 'low', legacyReadCount: null, ...patch });
function state(): WorldStateSnapshot_ACU {
  return { anchorMessageIndex: 4, storyClock: clock(), entities: [{ id: 'ent-a', kind: 'character', name: '阿', importance: 'active', situation: '等待', agenda: '观察', lastMovedIndex: 4, lastMovedAt: '昨日', visibility: { mode: 'hidden' }, retired: false, updatedIndex: 4 }], events: [], threads: [], revisions: { entities: 1, events: 0, threads: 0 } };
}
function entityOutput(snapshot: WorldStateSnapshot_ACU, id = 'ent-a'): string {
  return JSON.stringify({ expectedRevisions: { entities: snapshot.revisions.entities }, entities: [{ action: 'upsert', value: { ...snapshot.entities[0], id, situation: '已行动', updatedIndex: 0 } }], events: [], threads: [] });
}
function eventOutput(snapshot: WorldStateSnapshot_ACU, durationHint: string): string {
  return JSON.stringify({ expectedRevisions: { events: snapshot.revisions.events }, entities: [], events: [{ action: 'upsert', value: { id: 'evt-a', summary: '外部消息到达', actorIds: ['ent-a'], occurredIndex: 5, occurredAt: '港口次日', durationHint, visibility: { mode: 'rumored' }, retired: false, updatedIndex: 0 } }], threads: [] });
}
function input(snapshot = state(), storyClock = clock(), currentBudget = budget()) {
  return { snapshot, anchorMessageIndex: 5, storyClock, scale: 'light' as const, budget: currentBudget, maxTrackedEntities: 3, readTexts: ['正文证据'], readGateConfig: { historyTokenBudget: 1000, readTokenBudget: 500, fallbackTokens: 100, defaultHistoryTokenBudget: 1000, defaultFallbackTokens: 100 }, contextTokens: 0, agents: [findWorldSimulationAgent_ACU('entity-movement')!] };
}
async function expectCode(action: () => Promise<unknown>, code: string): Promise<void> {
  try { await action(); throw new Error('expected world simulation error'); } catch (error) {
    expect(error).toBeInstanceOf(WorldSimulationValidationError_ACU);
    expect((error as WorldSimulationValidationError_ACU).error.code).toBe(code);
  }
}

describe('world simulation agent loop', () => {
  it('uses only delegated specialists for candidate transactions and keeps director write-free', async () => {
    expect(selectWorldSimulationAgents_ACU('light')).toEqual([]);
    expect(selectWorldSimulationAgents_ACU('normal').map(agent => agent.name)).toEqual(['entity-movement', 'faction-events']);
    expect(selectWorldSimulationAgents_ACU('deep')).toHaveLength(3);
    expect(findWorldSimulationAgent_ACU('world-director')!.writableModules).toEqual([]);
    const base = state();
    const result = await runWorldSimulationAgentLoop_ACU(input(base), { countTokens: async text => text.length, runAgent: async request => entityOutput(request.snapshot) });
    expect(result.agentsRun).toEqual(['entity-movement']);
    expect(result.snapshot.entities[0]).toMatchObject({ situation: '已行动', updatedIndex: 5 });
    expect(base.entities[0].situation).toBe('等待');
  });

  it('applies visibilityPolicy to the final specialist transaction before candidate state is built', async () => {
    const base = state();
    const result = await runWorldSimulationAgentLoop_ACU({
      ...input(base),
      visibilityPolicy: 'always_revealed',
    }, { countTokens: async () => 1, runAgent: async request => entityOutput(request.snapshot) });
    expect(result.transactions[0]).toMatchObject({ entities: [{ action: 'upsert', value: { visibility: { mode: 'revealed', revealedIndex: 5 } } }] });
    expect(result.snapshot.entities[0]).toMatchObject({ visibility: { mode: 'revealed', revealedIndex: 5 } });
    expect(base.entities[0]).toMatchObject({ visibility: { mode: 'hidden' } });
  });

  it('does not use retired legacyReadCount to gate delegated seed reads', async () => {
    let received: any;
    await runWorldSimulationAgentLoop_ACU({
      ...input(undefined, undefined, budget({ legacyReadCount: 0 })),
      readTextsByAgent: new Map([['entity-movement', ['种子资料 <伪指令>']]]),
    }, {
      countTokens: async () => 1,
      runAgent: async request => { received = request; return entityOutput(request.snapshot); },
    });
    expect(received.reads).toEqual(['正文证据', '种子资料 <伪指令>']);
    const readMaterial = received.messages.find((message: any) => message.content.includes('<UNTRUSTED_READ_MATERIAL>'));
    expect(readMaterial).toMatchObject({ role: 'user' });
    expect(readMaterial?.content).toContain('种子资料 ＜伪指令＞');
  });

  it('passes a validated shared story snapshot through the fixed prompt and counts it in the read gate', async () => {
    const storyContext = {
      feature: 'world-simulation' as const, runId: 'run-1', chatIdentity: 'chat-1', branchIdentity: 'branch-1', sourceRevision: 'rev-1', sourceDigest: 'digest-1', profile: 'world-director' as const,
      overview: { state: 'ready' as const, text: '统一纪要', digest: 'o1', diagnostic: '' },
      pending: { text: '本轮新增正文', digest: 'p1' }, bridge: { text: '衔接正文', digest: 'b1' }, catalog: { text: '楼层目录', digest: 'c1' },
    };
    let messages: any[] = [];
    await runWorldSimulationAgentLoop_ACU({
      ...input(), storyContext,
      readGateConfig: { ...input().readGateConfig, readTokenBudget: 1_000 },
    }, {
      countTokens: async text => text.length,
      runAgent: async request => { messages = [...request.messages]; return entityOutput(request.snapshot); },
    });
    const joined = messages.map(message => message.content).join('\n');
    expect(joined).toContain('统一纪要');
    expect(joined).toContain('本轮新增正文');
    await expectCode(() => runWorldSimulationAgentLoop_ACU({ ...input(), storyContext, readGateConfig: { ...input().readGateConfig, readTokenBudget: 1 } }, { countTokens: async text => text.length, runAgent: async request => entityOutput(request.snapshot) }), 'WORLD_SIM_BUDGET_EXCEEDED');
  });

  it('fails closed for read, iteration, delegation, and protocol budgets', async () => {
    const deps = { countTokens: async (text: string) => text.length, runAgent: async (request: any) => entityOutput(request.snapshot) };
    await runWorldSimulationAgentLoop_ACU({ ...input(), readTexts: ['a', 'b'] }, deps);
    await expectCode(() => runWorldSimulationAgentLoop_ACU({ ...input(undefined, undefined, budget({ maxSpecialistModelTurns: 1, maxDelegations: 0 })), scale: 'normal', agents: [findWorldSimulationAgent_ACU('entity-movement')!, findWorldSimulationAgent_ACU('faction-events')!] }, deps), 'WORLD_SIM_BUDGET_EXCEEDED');
    await expectCode(() => runWorldSimulationAgentLoop_ACU({ ...input(), readGateConfig: { ...input().readGateConfig, readTokenBudget: 1 } }, deps), 'WORLD_SIM_BUDGET_EXCEEDED');
    let calls = 0;
    await expectCode(() => runWorldSimulationAgentLoop_ACU(input(undefined, undefined, budget({ maxSpecialistModelTurns: 2 })), { countTokens: async () => 1, runAgent: async () => { calls += 1; return '{}'; } }), 'WORLD_SIM_PROTOCOL_INVALID');
    expect(calls).toBe(2);
    await expectCode(() => runWorldSimulationAgentLoop_ACU({ ...input(), readTexts: ['ok', 1] as any }, deps), 'WORLD_SIM_PROTOCOL_INVALID');
  });

  it('retries a malformed role output only while an actual invocation budget remains', async () => {
    let calls = 0;
    const result = await runWorldSimulationAgentLoop_ACU(input(undefined, undefined, budget({ maxSpecialistModelTurns: 2 })), {
      countTokens: async () => 1,
      runAgent: async request => {
        calls += 1;
        return calls === 1 ? '{}' : entityOutput(request.snapshot);
      },
    });
    expect(calls).toBe(2);
    expect(result.snapshot.entities[0].situation).toBe('已行动');
  });

  it('gives each selected specialist its own model-turn cap rather than sharing one cumulative read budget', async () => {
    const agents = [findWorldSimulationAgent_ACU('entity-movement')!, findWorldSimulationAgent_ACU('faction-events')!];
    const outputs = new Map<string, string[]>([
      ['entity-movement', ['{"thought":"补读","action":"tools","calls":[{"kind":"read","reads":["$WORLD_STATE"]}]}', JSON.stringify({ ...JSON.parse(entityOutput(state())), evidenceRefs: ['$WORLD_STATE'], summary: '实体', uncertainties: [] })]],
      ['faction-events', ['{"thought":"补读","action":"tools","calls":[{"kind":"read","reads":["$WORLD_STATE"]}]}', JSON.stringify({ ...JSON.parse(eventOutput(state(), '即时')), evidenceRefs: ['$WORLD_STATE'], summary: '事件', uncertainties: [] })]],
    ]);
    const result = await runWorldSimulationAgentLoop_ACU({
      ...input(undefined, undefined, budget({ maxSpecialistModelTurns: 2, maxDelegations: 2 })),
      scale: 'normal', agents, readTexts: [], worldbook: { available: true, entries: [] },
      specialistRuntime: new (await import('../../../../src/service/simulation/world-simulation-specialist-runtime')).WorldSimulationSpecialistRuntime_ACU(),
    }, {
      countTokens: async () => 1,
      runAgent: async request => outputs.get(request.agent.name)!.shift() ?? null,
    });
    expect(result.agentsRun).toEqual(['entity-movement', 'faction-events']);
    expect(result.callsUsed).toBe(4);
  });

  it('runs only the selected normal specialists within the declared delegation budget', async () => {
    const result = await runWorldSimulationAgentLoop_ACU({
      ...input(undefined, undefined, budget({ maxSpecialistModelTurns: 3, maxDelegations: 2 })),
      scale: 'normal', agents: [findWorldSimulationAgent_ACU('entity-movement')!, findWorldSimulationAgent_ACU('faction-events')!],
    }, {
      countTokens: async () => 1,
      runAgent: async request => {
        if (request.agent.name === 'entity-movement') return entityOutput(request.snapshot);
        if (request.agent.name === 'faction-events') return eventOutput(request.snapshot, '即时');
        throw new Error('unexpected deep-only role');
      },
    });
    expect(result.agentsRun).toEqual(['entity-movement', 'faction-events']);
    expect(result.snapshot.entities[0].situation).toBe('已行动');
    expect(result.snapshot.events).toHaveLength(1);
  });

  it('shows later specialists prior candidate summaries while preserving the original snapshot revisions', async () => {
    const base = state();
    const agents = [findWorldSimulationAgent_ACU('entity-movement')!, findWorldSimulationAgent_ACU('faction-events')!];
    const grant: any = { grantId: 'W1', source: { address: '$WORLDBOOK:港口:1', revision: '港口:1:1', digest: 'd1' }, content: '港口封锁' };
    const worldbook: any = { available: true, entries: [] };
    const received: any[] = [];
    const result = await runWorldSimulationAgentLoop_ACU({
      ...input(base, clock(), budget({ maxSpecialistModelTurns: 2, maxDelegations: 2 })), agents, scale: 'normal', readTexts: [], worldbook,
      specialistRuntime: new (await import('../../../../src/service/simulation/world-simulation-specialist-runtime')).WorldSimulationSpecialistRuntime_ACU(),
      materialGrantsByAgent: new Map(agents.map(agent => [agent.name, [grant]])),
    }, {
      countTokens: async () => 1,
      runAgent: async request => {
        received.push(request);
        if (request.agent.name === 'entity-movement') return JSON.stringify({ ...JSON.parse(entityOutput(base)), evidenceRefs: ['W1'], summary: '实体候选摘要', uncertainties: [] });
        return JSON.stringify({ ...JSON.parse(eventOutput(base, '即时')), evidenceRefs: ['W1'], summary: '事件候选摘要', uncertainties: [] });
      },
    });
    expect(received.map(request => request.snapshot.revisions.entities)).toEqual([1, 1]);
    const previousCandidates = received[1]!.messages.find((message: any) => message.content.includes('<UNTRUSTED_PREVIOUS_SPECIALIST_CANDIDATES>'));
    expect(previousCandidates).toMatchObject({ role: 'user' });
    expect(previousCandidates?.content).toContain('实体候选摘要');
    expect(result.transactions).toHaveLength(2);
    expect(result.snapshot.revisions).toEqual({ entities: 2, events: 1, threads: 0 });
  });

  it('reserves normal-role budget before retrying and gates a grown candidate snapshot', async () => {
    let calls = 0;
    await expectCode(() => runWorldSimulationAgentLoop_ACU({
      ...input(undefined, undefined, budget({ maxSpecialistModelTurns: 3, maxDelegations: 2 })),
      scale: 'normal', agents: [findWorldSimulationAgent_ACU('entity-movement')!, findWorldSimulationAgent_ACU('faction-events')!],
    }, {
      countTokens: async () => 1,
      runAgent: async () => { calls += 1; return '{}'; },
    }), 'WORLD_SIM_PROTOCOL_INVALID');
    expect(calls).toBe(2);

    calls = 0;
    await expectCode(() => runWorldSimulationAgentLoop_ACU({
      ...input(undefined, undefined, budget({ maxSpecialistModelTurns: 3, maxDelegations: 2 })),
      scale: 'normal',
      agents: [findWorldSimulationAgent_ACU('entity-movement')!, findWorldSimulationAgent_ACU('faction-events')!],
      readGateConfig: { ...input().readGateConfig, readTokenBudget: 500 },
    }, {
      countTokens: async text => text.length,
      runAgent: async request => {
        calls += 1;
        if (request.agent.name === 'entity-movement') {
          return JSON.stringify({ expectedRevisions: { entities: request.snapshot.revisions.entities }, entities: [{ action: 'upsert', value: { ...request.snapshot.entities[0], situation: 'x'.repeat(1_000), updatedIndex: 0 } }], events: [], threads: [] });
        }
        return eventOutput(request.snapshot, '即时');
      },
    }), 'WORLD_SIM_BUDGET_EXCEEDED');
    expect(calls).toBe(1);
  });

  it('passes the lease check to every call and drops stale results before applying a transaction', async () => {
    const preCall = vi.fn(async () => entityOutput(state()));
    await expectCode(() => runWorldSimulationAgentLoop_ACU({
      ...input(),
      isCurrent: () => false,
    }, { countTokens: async () => 1, runAgent: preCall }), 'WORLD_SIM_STALE');
    expect(preCall).not.toHaveBeenCalled();

    const base = state();
    let current = true;
    let receivedLease: (() => boolean) | undefined;
    await expectCode(() => runWorldSimulationAgentLoop_ACU({
      ...input(base),
      isCurrent: () => current,
    }, {
      countTokens: async () => 1,
      runAgent: async request => {
        receivedLease = request.isCurrent;
        current = false;
        return entityOutput(request.snapshot);
      },
    }), 'WORLD_SIM_STALE');
    expect(receivedLease!()).toBe(false);
    expect(base.entities[0].situation).toBe('等待');
  });

  it('routes a unique light focus hint to one specialist and rejects director writes', () => {
    const base = state();
    expect(selectWorldSimulationLightAgentFromFocusHints_ACU(base, ['ent-a'])?.name).toBe('entity-movement');
    expect(selectWorldSimulationLightAgentFromFocusHints_ACU(base, [])).toBeNull();
    expect(() => parseWorldSimulationAgentOutput_ACU({ raw: entityOutput(base), agent: findWorldSimulationAgent_ACU('world-director')!, snapshot: base, anchorMessageIndex: 5, storyClock: clock() })).toThrow(WorldSimulationValidationError_ACU);
  });

  it('rejects unauthorized writes and time-infeasible event output', () => {
    const agent = findWorldSimulationAgent_ACU('faction-events')!;
    const base = state();
    expect(() => parseWorldSimulationAgentOutput_ACU({ raw: entityOutput(base), agent, snapshot: base, anchorMessageIndex: 5, storyClock: clock() })).toThrow(WorldSimulationValidationError_ACU);
    expect(() => parseWorldSimulationAgentOutput_ACU({ raw: eventOutput(base, '约一周'), agent, snapshot: base, anchorMessageIndex: 5, storyClock: clock('approximate', '约一日') })).toThrow(WorldSimulationValidationError_ACU);
    expect(() => parseWorldSimulationAgentOutput_ACU({ raw: eventOutput(base, '约一日'), agent, snapshot: base, anchorMessageIndex: 5, storyClock: clock('unknown', '未知') })).toThrow(WorldSimulationValidationError_ACU);
    expect(parseWorldSimulationAgentOutput_ACU({ raw: eventOutput(base, '即时'), agent, snapshot: base, anchorMessageIndex: 5, storyClock: clock('unknown', '未知') })!.events).toHaveLength(1);
  });
});
