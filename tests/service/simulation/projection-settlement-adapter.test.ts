import { describe, expect, it, vi } from 'vitest';
import type { WorldSimulationRebaseResult_ACU } from '../../../src/service/simulation/simulation-rebase';
import { createWorldSimulationProjectionSettlementAdapter_ACU } from '../../../src/service/simulation/projection-settlement-adapter';

function state(index: number, visibility: 'revealed' | 'hidden') {
  return { anchorMessageIndex: index, storyClock: { anchorText: `第${index}日`, elapsedSinceLastRun: '即时', precision: 'exact' as const, evidenceIndexes: [index], updatedIndex: index }, entities: [{ id: `${visibility}-entity`, kind: 'character' as const, name: visibility === 'revealed' ? '港口守卫' : '暗部', importance: 'active' as const, situation: '港口', agenda: '巡逻', lastMovedIndex: index, lastMovedAt: `第${index}日`, visibility: { mode: visibility }, retired: false, updatedIndex: index }], events: [], threads: [], revisions: { entities: 0, events: 0, threads: 0 } };
}

function rebase(visibility: 'revealed' | 'hidden'): WorldSimulationRebaseResult_ACU {
  const after = state(7, visibility);
  return { verdict: 'compatible', targetAnchorMessageIndex: 7, coverageStartMessageIndex: 5, coverageEndMessageIndex: 7, state: after, transaction: { anchorMessageIndex: 7, storyClock: after.storyClock, expectedRevisions: { entities: 0 }, entities: [{ action: 'upsert', value: after.entities[0]! }], events: [], threads: [] } };
}

const context = { recordId: 'settled-7', checkpointInterval: 20, expectedReplayDigest: 'digest', parentReplayDigest: null, swipe: { messageIndex: 7, messageKey: 'string:ai-7', swipeIndex: 0, baseTextHash: 'base-7' }, expectedProjectionBlockHash: null };

describe('world simulation projection settlement adapter', () => {
  it('maps a public r6 result to one complete r4 joint-commit input', async () => {
    const commit = vi.fn(async input => ({ record: { version: 1 as const, kind: 'checkpoint' as const, id: input.recordId, anchorMessageIndex: input.anchorMessageIndex, state: input.state }, projection: { blockHash: 'block', baseTextHash: 'base-7' } }));
    const result = await createWorldSimulationProjectionSettlementAdapter_ACU(commit)({ before: state(5, 'hidden'), rebase: rebase('revealed'), context });
    expect(result.projection).toEqual({ blockHash: 'block', baseTextHash: 'base-7' });
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ anchorMessageIndex: 7, sourceAnchorMessageIndex: 5, coverageStartMessageIndex: 5, coverageEndMessageIndex: 7, publicEntryIds: ['entities:revealed-entity'] }));
    expect(commit.mock.calls[0]![0].publicText).toContain('港口守卫');
  });

  it('maps a hidden-only r6 result to explicit null projection and rejects mismatched context', async () => {
    const commit = vi.fn(async input => ({ record: { version: 1 as const, kind: 'checkpoint' as const, id: input.recordId, anchorMessageIndex: input.anchorMessageIndex, state: input.state }, projection: null }));
    await createWorldSimulationProjectionSettlementAdapter_ACU(commit)({ before: state(5, 'hidden'), rebase: rebase('hidden'), context });
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ publicText: null, publicEntryIds: [] }));

    const invalidCommit = vi.fn();
    await expect(createWorldSimulationProjectionSettlementAdapter_ACU(invalidCommit)({ before: state(5, 'hidden'), rebase: rebase('hidden'), context: { ...context, swipe: { ...context.swipe, messageIndex: 6 } } })).rejects.toMatchObject({ error: { code: 'WORLD_SIM_REBASE_REJECTED' } });
    expect(invalidCommit).not.toHaveBeenCalled();
  });
});
