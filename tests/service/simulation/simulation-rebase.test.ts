import { describe, expect, it, vi } from 'vitest';
import type { WorldSimulationTransaction_ACU, WorldStateSnapshot_ACU, WorldStoryClock_ACU } from '../../../src/service/simulation/model';
import { WorldSimulationValidationError_ACU } from '../../../src/service/simulation/model';
import { rebaseWorldSimulationCandidate_ACU, runWorldSimulationRebaseRound_ACU, settleWorldSimulationRebase_ACU } from '../../../src/service/simulation/simulation-rebase';

const clock = (index: number): WorldStoryClock_ACU => ({ anchorText: `第${index}日`, elapsedSinceLastRun: '约一日', precision: 'approximate', evidenceIndexes: [index], updatedIndex: index });
function current(): WorldStateSnapshot_ACU {
  return { anchorMessageIndex: 5, storyClock: clock(5), entities: [{ id: 'ent-live', kind: 'character', name: '旧角色', importance: 'active', situation: '港口', agenda: '守望', lastMovedIndex: 5, lastMovedAt: '第五日', visibility: { mode: 'revealed', revealedIndex: 5 }, retired: false, updatedIndex: 5 }], events: [{ id: 'evt-old', summary: '旧巡逻', actorIds: ['ent-live'], occurredIndex: 5, occurredAt: '第五日', durationHint: '即时', visibility: { mode: 'rumored' }, retired: false, updatedIndex: 5 }], threads: [], revisions: { entities: 1, events: 1, threads: 0 } };
}
function source(): WorldSimulationTransaction_ACU {
  return { anchorMessageIndex: 5, storyClock: clock(5), expectedRevisions: { entities: 1, events: 1, threads: 0 }, entities: [{ action: 'upsert', value: { id: 'ent-pending', kind: 'character', name: '候选角色', importance: 'active', situation: '北岸', agenda: '集结', lastMovedIndex: 5, lastMovedAt: '第五日', visibility: { mode: 'hidden' }, retired: false, updatedIndex: 5 } }], events: [{ action: 'upsert', value: { id: 'evt-pending', summary: '候选行动', actorIds: ['ent-pending'], occurredIndex: 5, occurredAt: '第五日', durationHint: '即时', visibility: { mode: 'hidden' }, retired: false, updatedIndex: 5 } }], threads: [{ action: 'upsert', value: { id: 'thr-pending', title: '候选暗线', status: 'brewing', summary: '等待', visibility: { mode: 'hidden' }, relatedEventIds: ['evt-pending'], retired: false, updatedIndex: 5 } }] };
}
function compatibleDecision(target = 7): string { return JSON.stringify({ verdict: 'compatible', targetAnchorMessageIndex: target, coverageStartMessageIndex: 5, coverageEndMessageIndex: target, rebaseStoryClock: clock(target) }); }
function adjustDecision(ops: unknown[], target = 7): string { return JSON.stringify({ verdict: 'adjust', targetAnchorMessageIndex: target, coverageStartMessageIndex: 5, coverageEndMessageIndex: target, rebaseStoryClock: clock(target), ops }); }
function input(rawDecision: string, target = 7) { return { current: current(), sourceTransactions: [source()], sourceAnchorMessageIndex: 5, targetAnchorMessageIndex: target, coverageStartMessageIndex: 5, coverageEndMessageIndex: target, rebaseStoryClock: clock(target), maxTrackedEntities: 3, rawDecision }; }
function roundInput(rawDecision: string, decide: () => Promise<string | null>, isCurrent?: () => boolean) { const { rawDecision: _rawDecision, ...base } = input(rawDecision); return { ...base, decide, ...(isCurrent ? { isCurrent } : {}) }; }
function expectCode(action: () => unknown, code: string): void { try { action(); throw new Error('expected error'); } catch (error) { expect(error).toBeInstanceOf(WorldSimulationValidationError_ACU); expect((error as WorldSimulationValidationError_ACU).error.code).toBe(code); } }

describe('world simulation rebase', () => {
  it('rebuilds every compatible candidate operation at the target clock', () => {
    const result = rebaseWorldSimulationCandidate_ACU(input(compatibleDecision()));
    expect(result).toMatchObject({ verdict: 'compatible', targetAnchorMessageIndex: 7, coverageStartMessageIndex: 5, coverageEndMessageIndex: 7 });
    expect(result.transaction.anchorMessageIndex).toBe(7);
    expect(result.transaction.entities).toHaveLength(1);
    expect(result.transaction.events).toHaveLength(1);
    expect(result.transaction.threads).toHaveLength(1);
    expect(result.state.entities.find(item => item.id === 'ent-pending')).toMatchObject({ updatedIndex: 7 });
    expect(result.state.events.find(item => item.id === 'evt-pending')).toMatchObject({ updatedIndex: 7 });
  });

  it('adjusts with keep, modify, drop, insert and retire at the target', () => {
    const result = rebaseWorldSimulationCandidate_ACU(input(adjustDecision([
      { op: 'keep', module: 'entities', id: 'ent-pending' },
      { op: 'modify', module: 'events', id: 'evt-pending', patch: { summary: '北岸行动被修正' }, reason: '新正文改写地点' },
      { op: 'drop', module: 'threads', id: 'thr-pending', reason: '候选与新正文矛盾' },
      { op: 'insert', module: 'events', item: { id: 'evt-insert', summary: '临时改派', actorIds: ['ent-live'], occurredIndex: 7, occurredAt: '第七日', durationHint: '即时', visibility: { mode: 'rumored' }, retired: false, updatedIndex: 7 }, reason: '新正文后果' },
      { op: 'retire', module: 'events', id: 'evt-old', reason: '正文推翻旧事实' },
    ])));
    expect(result.verdict).toBe('adjust');
    expect(result.state.events.find(item => item.id === 'evt-pending')).toMatchObject({ summary: '北岸行动被修正', updatedIndex: 7 });
    expect(result.state.events.find(item => item.id === 'evt-insert')).toBeTruthy();
    expect(result.state.events.find(item => item.id === 'evt-old')).toMatchObject({ retired: true });
    expect(result.state.threads.find(item => item.id === 'thr-pending')).toBeUndefined();
  });

  it('rejects malformed verdicts and target, coverage or clock mismatches', () => {
    const compatible = JSON.parse(compatibleDecision());
    const invalids = [
      JSON.stringify({ ...compatible, verdict: 'unknown' }),
      JSON.stringify({ ...compatible, coverageStartMessageIndex: 6 }),
      JSON.stringify({ ...compatible, coverageEndMessageIndex: 6 }),
      JSON.stringify({ ...compatible, rebaseStoryClock: { ...clock(7), anchorText: '漂移时钟' } }),
      adjustDecision([{ op: 'keep', module: 'entities', id: 'ent-pending' }]),
      adjustDecision([
        { op: 'drop', module: 'entities', id: 'ent-pending', reason: '无效' },
        { op: 'drop', module: 'events', id: 'evt-pending', reason: '无效' },
        { op: 'drop', module: 'threads', id: 'thr-pending', reason: '无效' },
      ]),
    ];
    for (const raw of invalids) expectCode(() => rebaseWorldSimulationCandidate_ACU(input(raw)), 'WORLD_SIM_REBASE_REJECTED');
  });

  it('runs exactly one light decision and settles only a validated result', async () => {
    const decide = vi.fn(async () => compatibleDecision());
    const settle = vi.fn(async result => ({ verdict: result.verdict, target: result.targetAnchorMessageIndex }));
    await expect(settleWorldSimulationRebase_ACU({ ...roundInput(compatibleDecision(), decide), settle })).resolves.toEqual({ verdict: 'compatible', target: 7 });
    expect(decide).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle.mock.calls[0]![0]).toMatchObject({ targetAnchorMessageIndex: 7, coverageStartMessageIndex: 5, coverageEndMessageIndex: 7 });

    const rejectedSettle = vi.fn();
    await expect(settleWorldSimulationRebase_ACU({ ...roundInput(adjustDecision([{ op: 'keep', module: 'entities', id: 'ent-pending' }]), async () => adjustDecision([{ op: 'keep', module: 'entities', id: 'ent-pending' }])), settle: rejectedSettle })).rejects.toMatchObject({ error: { code: 'WORLD_SIM_REBASE_REJECTED' } });
    expect(rejectedSettle).not.toHaveBeenCalled();

    const staleSettle = vi.fn();
    const staleAfterDecision = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValueOnce(false);
    await expect(settleWorldSimulationRebase_ACU({ ...roundInput(compatibleDecision(), async () => compatibleDecision(), staleAfterDecision), settle: staleSettle })).rejects.toMatchObject({ error: { code: 'WORLD_SIM_STALE' } });
    expect(staleSettle).not.toHaveBeenCalled();
  });


  it('rejects duplicate source operations and never invokes settlement', async () => {
    expectCode(() => rebaseWorldSimulationCandidate_ACU({
      ...input(compatibleDecision()),
      sourceTransactions: [source(), source()],
    }), 'WORLD_SIM_REBASE_REJECTED');

    const settle = vi.fn();
    await expect(settleWorldSimulationRebase_ACU({
      ...roundInput(compatibleDecision(), async () => compatibleDecision()),
      sourceTransactions: [source(), source()],
      settle,
    })).rejects.toMatchObject({ error: { code: 'WORLD_SIM_REBASE_REJECTED' } });
    expect(settle).not.toHaveBeenCalled();
  });

  it('rejects only-retire results and a rejected light call without settlement', async () => {
    const onlyRetire = adjustDecision([
      { op: 'drop', module: 'entities', id: 'ent-pending', reason: '无效' },
      { op: 'drop', module: 'events', id: 'evt-pending', reason: '无效' },
      { op: 'drop', module: 'threads', id: 'thr-pending', reason: '无效' },
      { op: 'retire', module: 'events', id: 'evt-old', reason: '正文推翻旧事实' },
    ]);
    const retireSettle = vi.fn();
    await expect(settleWorldSimulationRebase_ACU({
      ...roundInput(onlyRetire, async () => onlyRetire),
      settle: retireSettle,
    })).rejects.toMatchObject({ error: { code: 'WORLD_SIM_REBASE_REJECTED' } });
    expect(retireSettle).not.toHaveBeenCalled();

    const rejectedCallSettle = vi.fn();
    const rejectedDecide = vi.fn(async () => { throw new Error('light unavailable'); });
    await expect(settleWorldSimulationRebase_ACU({
      ...roundInput(compatibleDecision(), rejectedDecide),
      settle: rejectedCallSettle,
    })).rejects.toMatchObject({ error: { code: 'WORLD_SIM_REBASE_REJECTED' } });
    expect(rejectedDecide).toHaveBeenCalledTimes(1);
    expect(rejectedCallSettle).not.toHaveBeenCalled();
  });

});