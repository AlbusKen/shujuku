import { describe, expect, it } from 'vitest';
import {
  parseLegacyWorldSimulationLedgerRecord_ACU,
  parseWorldSimulationPerSwipeEnvelope_ACU,
  parseWorldSimulationPersistedValue_ACU,
} from '../../../src/service/simulation/simulation-schema';

function state(): any {
  return {
    anchorMessageIndex: 4,
    storyClock: { anchorText: '第四日', elapsedSinceLastRun: '一日', precision: 'approximate', evidenceIndexes: [4], updatedIndex: 4 },
    entities: [], events: [],
    threads: [{ id: 'thr-a', title: '暗线', status: 'brewing', summary: '等待', visibility: { mode: 'hidden' }, relatedEventIds: [], retired: false, updatedIndex: 4 }],
    revisions: { entities: 0, events: 0, threads: 1 },
  };
}

function record(): any {
  return { version: 1, kind: 'checkpoint', id: 'cp-4', anchorMessageIndex: 4, state: state() };
}

function envelope(): any {
  return {
    version: 2, kind: 'per_swipe', entries: [{
      swipe: { messageIndex: 4, messageKey: 'number:4', swipeIndex: 1, baseTextHash: 'body-4' },
      parentReplayDigest: null,
      sourceAnchorMessageIndex: 2,
      coverageStartMessageIndex: 3,
      coverageEndMessageIndex: 4,
      projection: { version: 1, blockHash: 'block-4', baseTextHash: 'body-4', publicEntryIds: ['evt-a'] },
      record: record(),
    }],
  };
}

describe('world simulation schema migration', () => {
  it('normalizes only legacy thread visibility in a cloned v1 record', () => {
    const legacy = record();
    delete legacy.state.threads[0].visibility;
    const parsed = parseLegacyWorldSimulationLedgerRecord_ACU(legacy)!;
    expect(parsed.kind).toBe('checkpoint');
    expect(parsed.state.threads[0]).toMatchObject({ visibility: { mode: 'hidden' } });
    expect(legacy.state.threads[0].visibility).toBeUndefined();
    expect(parseWorldSimulationPersistedValue_ACU(legacy)).toMatchObject({ version: 1, kind: 'checkpoint' });
  });

  it('accepts a complete per-swipe envelope and keeps its lineage/projection binding', () => {
    const parsed = parseWorldSimulationPerSwipeEnvelope_ACU(envelope());
    expect(parsed).toMatchObject({ version: 2, kind: 'per_swipe', entries: [{
      swipe: { messageIndex: 4, swipeIndex: 1 }, parentReplayDigest: null,
      coverageStartMessageIndex: 3, coverageEndMessageIndex: 4,
      projection: { blockHash: 'block-4', baseTextHash: 'body-4' },
    }] });
    expect(parseWorldSimulationPersistedValue_ACU(envelope())?.version).toBe(2);
  });

  it('accepts explicit null projection for a hidden-only active swipe ledger', () => {
    const hiddenOnly = envelope();
    hiddenOnly.entries[0].projection = null;
    expect(parseWorldSimulationPerSwipeEnvelope_ACU(hiddenOnly)).toMatchObject({ entries: [{ projection: null }] });
    hiddenOnly.entries[0].projection = { version: 1, blockHash: 'block-4', baseTextHash: 'other-body', publicEntryIds: [] };
    expect(parseWorldSimulationPerSwipeEnvelope_ACU(hiddenOnly)).toBeNull();
  });


  it('rejects legacy thread records inside v2 and malformed branch/projection bindings', () => {
    const missingVisibility = envelope();
    delete missingVisibility.entries[0].record.state.threads[0].visibility;
    expect(parseWorldSimulationPerSwipeEnvelope_ACU(missingVisibility)).toBeNull();

    const duplicate = envelope();
    duplicate.entries.push(JSON.parse(JSON.stringify(duplicate.entries[0])));
    expect(parseWorldSimulationPerSwipeEnvelope_ACU(duplicate)).toBeNull();

    const mismatched = envelope();
    mismatched.entries[0].coverageEndMessageIndex = 5;
    expect(parseWorldSimulationPerSwipeEnvelope_ACU(mismatched)).toBeNull();

    const duplicatePublic = envelope();
    duplicatePublic.entries[0].projection.publicEntryIds = ['evt-a', 'evt-a'];
    expect(parseWorldSimulationPerSwipeEnvelope_ACU(duplicatePublic)).toBeNull();
  });
});
