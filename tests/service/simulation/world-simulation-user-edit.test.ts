import { describe, expect, it, vi } from 'vitest';
import { WorldSimulationUserEditAdapter_ACU } from '../../../src/service/simulation/world-simulation-user-edit';
import { hashWorldSimulationBody_ACU } from '../../../src/service/simulation/simulation-swipe';

function state() {
  return { anchorMessageIndex: 1, storyClock: { anchorText: '第1日', elapsedSinceLastRun: '即时', precision: 'unknown' as const, evidenceIndexes: [], updatedIndex: 1 }, entities: [{ id: 'ent-1', kind: 'character' as const, name: '密探', importance: 'active' as const, situation: '观察', agenda: '等待', lastMovedIndex: 1, lastMovedAt: '即时', visibility: { mode: 'hidden' as const }, retired: false, updatedIndex: 1 }], events: [], threads: [], revisions: { entities: 0, events: 0, threads: 0 } };
}
function chat(text = 'AI 正文') { return [{ is_user: true, mes: '用户' }, { is_user: false, message_id: 'ai-1', mes: text, swipe_id: 0, swipes: [text] }]; }
function harness() {
  const value = chat(); let replay: any = { state: state(), checkpointMessageIndex: 1, checkpointId: 'cp-1', deltaMessageIndices: [], digest: 'd1', branchReparsed: false };
  const commitProjection = vi.fn(async (input: any) => { replay = { ...replay, state: input.state, digest: 'd2' }; return { record: { version: 1, kind: 'checkpoint', id: 'cp-2', anchorMessageIndex: 1, state: input.state }, projection: null }; });
  const requirement = { feature: 'world-simulation' as const, revision: 1, lastAppliedUserMessageId: 'u-1', requirements: [{ id: 'R1', category: 'canon' as const, priority: 'hard' as const, text: '港口封锁', sourceRefs: ['u-1'] }] };
  const requirementsStore: any = { read: () => requirement, userSourceIds: () => ['u-1'], pendingSourceIds: () => [], replace: vi.fn(async (_: number, raw: any) => ({ ...requirement, revision: 2, requirements: raw.requirements })) };
  const adapter = new WorldSimulationUserEditAdapter_ACU({ store: { read: (index?: number) => index === 0 ? null : replay, commitProjection } as any, getChat: () => value, createRecordId: () => 'user-1', readSettings: () => ({ checkpointInterval: 20, maxTrackedEntities: 12, visibilityPolicy: 'always_revealed' } as any), requirementsStore });
  return { adapter, value, commitProjection, requirementsStore };
}

describe('WorldSimulationUserEditAdapter_ACU', () => {
  it('saves one state module only through commitProjection with saved visibility policy', async () => {
    const { adapter, commitProjection } = harness(); const read = adapter.read();
    if (read.kind !== 'ready') throw new Error('expected replay');
    const entities = read.baseline.state.entities.map(item => ({ ...item, situation: '码头观察' }));
    await adapter.saveModule(read.baseline, 'entities', entities);
    expect(commitProjection).toHaveBeenCalledTimes(1);
    expect(commitProjection.mock.calls[0][0]).toMatchObject({ expectedReplayDigest: 'd1', state: { revisions: { entities: 1, events: 0, threads: 0 }, entities: [{ situation: '码头观察', visibility: { mode: 'revealed', revealedIndex: 1 } }] } });
  });

  it('rejects stale active swipe or dropped entries before commitProjection', async () => {
    const { adapter, value, commitProjection } = harness(); const read = adapter.read();
    if (read.kind !== 'ready') throw new Error('expected replay');
    await expect(adapter.saveModule(read.baseline, 'entities', [])).rejects.toMatchObject({ error: { code: 'WORLD_SIM_CONFLICT' } });
    value[1].mes = '用户改写的正文'; value[1].swipes[0] = value[1].mes;
    await expect(adapter.saveModule(read.baseline, 'entities', read.baseline.state.entities)).rejects.toMatchObject({ error: { code: 'WORLD_SIM_STALE' } });
    expect(commitProjection).not.toHaveBeenCalled();
  });

  it('uses the original body hash for an existing system projection but still rejects an active swipe switch', async () => {
    const { adapter, value, commitProjection } = harness();
    const projected = 'AI 正文\n\n<与此同时>\n已公开的旧状态\n</与此同时>';
    value[1].mes = projected; value[1].swipes[0] = projected;
    const read = adapter.read(); if (read.kind !== 'ready') throw new Error('expected replay');
    expect(read.baseline.swipe.baseTextHash).toBe(hashWorldSimulationBody_ACU(projected));
    expect(read.baseline.commitSwipe.baseTextHash).toBe(hashWorldSimulationBody_ACU('AI 正文'));
    await adapter.saveModule(read.baseline, 'entities', read.baseline.state.entities.map(item => ({ ...item, situation: '投影后的编辑' })));
    expect(commitProjection.mock.calls[0]?.[0].swipe.baseTextHash).toBe(hashWorldSimulationBody_ACU('AI 正文'));

    const fresh = adapter.read(); if (fresh.kind !== 'ready') throw new Error('expected replay');
    value[1].swipes.push('另一个 swipe'); value[1].swipe_id = 1; value[1].mes = '另一个 swipe';
    await expect(adapter.saveModule(fresh.baseline, 'entities', fresh.baseline.state.entities)).rejects.toMatchObject({ error: { code: 'WORLD_SIM_STALE' } });
    expect(commitProjection).toHaveBeenCalledTimes(1);
  });

  it('propagates strict host-save failure without reporting a local state save', async () => {
    const { adapter, commitProjection } = harness(); const read = adapter.read();
    if (read.kind !== 'ready') throw new Error('expected replay');
    commitProjection.mockRejectedValueOnce(new Error('host save failed'));
    const entities = read.baseline.state.entities.map(item => ({ ...item, situation: '未落盘的修改' }));
    await expect(adapter.saveModule(read.baseline, 'entities', entities)).rejects.toThrow('host save failed');
    expect(commitProjection).toHaveBeenCalledTimes(1);
    const reread = adapter.read();
    expect(reread.kind).toBe('ready');
    if (reread.kind === 'ready') expect(reread.baseline.state.entities[0]?.situation).toBe('观察');
  });

  it('saves requirements through the independent sidecar without advancing the ledger', async () => {
    const { adapter, commitProjection, requirementsStore } = harness(); const read = adapter.read();
    if (read.kind !== 'ready') throw new Error('expected replay');
    await adapter.saveRequirements(read.requirements, read.requirements.requirements);
    expect(requirementsStore.replace).toHaveBeenCalledWith(1, expect.objectContaining({ action: 'maintain_requirements', expectedRevision: 1, appliedUserMessageId: 'u-1' }), expect.any(Array));
    expect(commitProjection).not.toHaveBeenCalled();
  });
});
