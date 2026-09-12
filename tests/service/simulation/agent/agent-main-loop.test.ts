import { describe, expect, it } from 'vitest';
import type { WorldSimulationBudget_ACU, WorldStateSnapshot_ACU, WorldStoryClock_ACU } from '../../../../src/service/simulation/model';
import { WorldSimulationValidationError_ACU } from '../../../../src/service/simulation/model';
import { findWorldSimulationAgent_ACU, selectWorldSimulationAgents_ACU } from '../../../../src/service/simulation/agent/agent-catalog';
import { parseWorldSimulationAgentOutput_ACU } from '../../../../src/service/simulation/agent/agent-protocol';
import { runWorldSimulationAgentLoop_ACU } from '../../../../src/service/simulation/agent/agent-main-loop';

const clock = (precision: WorldStoryClock_ACU['precision'] = 'approximate', elapsedSinceLastRun = '约一日'): WorldStoryClock_ACU => ({ anchorText: '港口次日', elapsedSinceLastRun, precision, evidenceIndexes: precision === 'unknown' ? [] : [4], updatedIndex: 5 });
const budget = (patch: Partial<WorldSimulationBudget_ACU> = {}): WorldSimulationBudget_ACU => ({ maxIterations: 1, maxDelegations: 0, maxReads: 1, readTokenBudget: 'low', ...patch });
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
  return { snapshot, anchorMessageIndex: 5, storyClock, scale: 'light' as const, budget: currentBudget, maxTrackedEntities: 3, readTexts: ['正文证据'], readGateConfig: { historyTokenBudget: 1000, readTokenBudget: 500, fallbackTokens: 100, defaultHistoryTokenBudget: 1000, defaultFallbackTokens: 100 }, contextTokens: 0 };
}
async function expectCode(action: () => Promise<unknown>, code: string): Promise<void> {
  try { await action(); throw new Error('expected world simulation error'); } catch (error) {
    expect(error).toBeInstanceOf(WorldSimulationValidationError_ACU);
    expect((error as WorldSimulationValidationError_ACU).error.code).toBe(code);
  }
}

describe('world simulation agent loop', () => {
  it('uses a world-only catalog and returns a candidate snapshot without mutating the source', async () => {
    expect(selectWorldSimulationAgents_ACU('light').map(agent => agent.name)).toEqual(['world-director']);
    expect(selectWorldSimulationAgents_ACU('normal').map(agent => agent.name)).toEqual(['world-director', 'entity-movement', 'faction-events']);
    expect(selectWorldSimulationAgents_ACU('deep')).toHaveLength(4);
    const base = state();
    const result = await runWorldSimulationAgentLoop_ACU(input(base), { countTokens: async text => text.length, runAgent: async request => entityOutput(request.snapshot) });
    expect(result.agentsRun).toEqual(['world-director']);
    expect(result.snapshot.entities[0]).toMatchObject({ situation: '已行动', updatedIndex: 5 });
    expect(base.entities[0].situation).toBe('等待');
  });

  it('fails closed for read, iteration, delegation, and protocol budgets', async () => {
    const deps = { countTokens: async (text: string) => text.length, runAgent: async (request: any) => entityOutput(request.snapshot) };
    await expectCode(() => runWorldSimulationAgentLoop_ACU({ ...input(), readTexts: ['a', 'b'] }, deps), 'WORLD_SIM_BUDGET_EXCEEDED');
    await expectCode(() => runWorldSimulationAgentLoop_ACU({ ...input(undefined, undefined, budget({ maxIterations: 1, maxDelegations: 0 })), scale: 'normal' }, deps), 'WORLD_SIM_BUDGET_EXCEEDED');
    await expectCode(() => runWorldSimulationAgentLoop_ACU({ ...input(), readGateConfig: { ...input().readGateConfig, readTokenBudget: 1 } }, deps), 'WORLD_SIM_BUDGET_EXCEEDED');
    let calls = 0;
    await expectCode(() => runWorldSimulationAgentLoop_ACU(input(undefined, undefined, budget({ maxIterations: 2 })), { countTokens: async () => 1, runAgent: async () => { calls += 1; return '{}'; } }), 'WORLD_SIM_PROTOCOL_INVALID');
    expect(calls).toBe(2);
    await expectCode(() => runWorldSimulationAgentLoop_ACU({ ...input(), readTexts: ['ok', 1] as any }, deps), 'WORLD_SIM_PROTOCOL_INVALID');
  });

  it('retries a malformed role output only while an actual invocation budget remains', async () => {
    let calls = 0;
    const result = await runWorldSimulationAgentLoop_ACU(input(undefined, undefined, budget({ maxIterations: 2 })), {
      countTokens: async () => 1,
      runAgent: async request => {
        calls += 1;
        return calls === 1 ? '{}' : entityOutput(request.snapshot);
      },
    });
    expect(calls).toBe(2);
    expect(result.snapshot.entities[0].situation).toBe('已行动');
  });

  it('runs the normal director plus the three-role plan within the declared delegation budget', async () => {
    const result = await runWorldSimulationAgentLoop_ACU({
      ...input(undefined, undefined, budget({ maxIterations: 3, maxDelegations: 2 })),
      scale: 'normal',
    }, {
      countTokens: async () => 1,
      runAgent: async request => {
        if (request.agent.name === 'world-director') return JSON.stringify({ expectedRevisions: {}, entities: [], events: [], threads: [] });
        if (request.agent.name === 'entity-movement') return entityOutput(request.snapshot);
        if (request.agent.name === 'faction-events') return eventOutput(request.snapshot, '即时');
        throw new Error('unexpected deep-only role');
      },
    });
    expect(result.agentsRun).toEqual(['world-director', 'entity-movement', 'faction-events']);
    expect(result.snapshot.entities[0].situation).toBe('已行动');
    expect(result.snapshot.events).toHaveLength(1);
  });

  it('reserves normal-role budget before retrying and gates a grown candidate snapshot', async () => {
    let calls = 0;
    await expectCode(() => runWorldSimulationAgentLoop_ACU({
      ...input(undefined, undefined, budget({ maxIterations: 3, maxDelegations: 2 })),
      scale: 'normal',
    }, {
      countTokens: async () => 1,
      runAgent: async () => { calls += 1; return '{}'; },
    }), 'WORLD_SIM_PROTOCOL_INVALID');
    expect(calls).toBe(1);

    calls = 0;
    await expectCode(() => runWorldSimulationAgentLoop_ACU({
      ...input(undefined, undefined, budget({ maxIterations: 3, maxDelegations: 2 })),
      scale: 'normal',
      readGateConfig: { ...input().readGateConfig, readTokenBudget: 500 },
    }, {
      countTokens: async text => text.length,
      runAgent: async request => {
        calls += 1;
        if (request.agent.name === 'world-director') return JSON.stringify({ expectedRevisions: {}, entities: [], events: [], threads: [] });
        if (request.agent.name === 'entity-movement') {
          return JSON.stringify({ expectedRevisions: { entities: request.snapshot.revisions.entities }, entities: [{ action: 'upsert', value: { ...request.snapshot.entities[0], situation: 'x'.repeat(1_000), updatedIndex: 0 } }], events: [], threads: [] });
        }
        return eventOutput(request.snapshot, '即时');
      },
    }), 'WORLD_SIM_BUDGET_EXCEEDED');
    expect(calls).toBe(2);
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

  it('rejects unauthorized writes and time-infeasible event output', () => {
    const agent = findWorldSimulationAgent_ACU('faction-events')!;
    const base = state();
    expect(() => parseWorldSimulationAgentOutput_ACU({ raw: entityOutput(base), agent, snapshot: base, anchorMessageIndex: 5, storyClock: clock() })).toThrow(WorldSimulationValidationError_ACU);
    expect(() => parseWorldSimulationAgentOutput_ACU({ raw: eventOutput(base, '约一周'), agent, snapshot: base, anchorMessageIndex: 5, storyClock: clock('approximate', '约一日') })).toThrow(WorldSimulationValidationError_ACU);
    expect(() => parseWorldSimulationAgentOutput_ACU({ raw: eventOutput(base, '约一日'), agent, snapshot: base, anchorMessageIndex: 5, storyClock: clock('unknown', '未知') })).toThrow(WorldSimulationValidationError_ACU);
    expect(parseWorldSimulationAgentOutput_ACU({ raw: eventOutput(base, '即时'), agent, snapshot: base, anchorMessageIndex: 5, storyClock: clock('unknown', '未知') })!.events).toHaveLength(1);
  });
});
