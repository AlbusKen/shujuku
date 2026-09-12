import { describe, expect, it } from 'vitest';
import type { WorldSimulationTransaction_ACU, WorldStateSnapshot_ACU } from '../../../src/service/simulation/model';
import { renderWorldSimulationPublicDelta_ACU } from '../../../src/service/simulation/simulation-public-delta';

function state(anchorMessageIndex: number): WorldStateSnapshot_ACU {
  return { anchorMessageIndex, storyClock: { anchorText: `第${anchorMessageIndex}日`, elapsedSinceLastRun: '即时', precision: 'exact', evidenceIndexes: [anchorMessageIndex], updatedIndex: anchorMessageIndex }, entities: [
    { id: 'visible-entity', kind: 'character', name: '港口守卫', importance: 'active', situation: '港口', agenda: '巡逻', lastMovedIndex: anchorMessageIndex, lastMovedAt: `第${anchorMessageIndex}日`, visibility: { mode: 'revealed' }, retired: false, updatedIndex: anchorMessageIndex },
    { id: 'hidden-entity', kind: 'faction', name: '暗部', importance: 'background', situation: '北岸', agenda: '潜伏', lastMovedIndex: anchorMessageIndex, lastMovedAt: `第${anchorMessageIndex}日`, visibility: { mode: 'hidden' }, retired: false, updatedIndex: anchorMessageIndex },
  ], events: [
    { id: 'rumor-event', summary: '渡口传来封港流言', actorIds: [], occurredIndex: anchorMessageIndex, occurredAt: `第${anchorMessageIndex}日`, durationHint: '即时', visibility: { mode: 'rumored' }, retired: false, updatedIndex: anchorMessageIndex },
  ], threads: [], revisions: { entities: 0, events: 0, threads: 0 } };
}

function transaction(): WorldSimulationTransaction_ACU {
  return { anchorMessageIndex: 7, storyClock: state(7).storyClock, expectedRevisions: { entities: 0, events: 0 }, entities: [
    { action: 'upsert', value: state(7).entities[0]! },
    { action: 'upsert', value: state(7).entities[1]! },
  ], events: [{ action: 'upsert', value: state(7).events[0]! }], threads: [] };
}

describe('world simulation public delta', () => {
  it('renders only transaction-touched revealed and rumored entries', () => {
    const result = renderWorldSimulationPublicDelta_ACU(state(5), transaction(), state(7));
    expect(result.publicEntryIds).toEqual(['entities:visible-entity', 'events:rumor-event']);
    expect(result.text).toContain('港口守卫');
    expect(result.text).toContain('传闻｜事件｜渡口传来封港流言');
    expect(result.text).not.toContain('暗部');
    expect(result.text).not.toContain('<与此同时>');
  });

  it('keeps whole entries within the configured entry and character bounds', () => {
    const result = renderWorldSimulationPublicDelta_ACU(state(5), transaction(), state(7), { maxEntries: 1, maxChars: 80 });
    expect(result.publicEntryIds).toEqual(['entities:visible-entity']);
    expect(result.text).toContain('港口守卫');
    expect(result.text).not.toContain('渡口传来封港流言');
  });

  it('keeps public changes with the same stable id in different modules', () => {
    const before = state(5);
    const after = state(7);
    after.events[0] = { ...after.events[0]!, id: 'visible-entity' };
    const result = renderWorldSimulationPublicDelta_ACU(before, {
      ...transaction(),
      events: [{ action: 'upsert', value: after.events[0]! }],
    }, after);
    expect(result.publicEntryIds).toEqual(['entities:visible-entity', 'events:visible-entity']);
    expect(result.text).toContain('港口守卫');
    expect(result.text).toContain('渡口传来封港流言');
  });
});
