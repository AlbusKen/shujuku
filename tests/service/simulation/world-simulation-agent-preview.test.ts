import { describe, expect, it } from 'vitest';
import { readWorldSimulationAgentPreview_ACU } from '../../../src/service/simulation/world-simulation-agent-preview';

function state() {
  return {
    anchorMessageIndex: 0,
    storyClock: { anchorText: '第 1 楼', elapsedSinceLastRun: '即时', precision: 'unknown' as const, evidenceIndexes: [], updatedIndex: 0 },
    entities: [
      { id: 'hidden', kind: 'character' as const, name: '密探', importance: 'active' as const, situation: '潜伏', agenda: '监听', lastMovedIndex: 0, lastMovedAt: '即时', visibility: { mode: 'hidden' as const }, retired: false, updatedIndex: 0 },
      { id: 'shown', kind: 'character' as const, name: '商人', importance: 'active' as const, situation: '现身', agenda: '交易', lastMovedIndex: 0, lastMovedAt: '即时', visibility: { mode: 'revealed' as const, revealedIndex: 0 }, retired: false, updatedIndex: 0 },
    ], events: [], threads: [], revisions: { entities: 1, events: 0, threads: 0 },
  };
}
function chat() { return [{ TavernDB_ACU_IsolatedData: { '': { worldSimulation: { version: 1, kind: 'checkpoint', id: 'cp-0', anchorMessageIndex: 0, state: state() } } } }]; }

describe('world simulation Agent preview', () => {
  it('hides hidden ledger entries by default without mutating the authoritative replay state', () => {
    const value = chat();
    const preview = readWorldSimulationAgentPreview_ACU(value, '');
    expect(preview).toMatchObject({ kind: 'ready', state: { entities: [{ id: 'shown' }] } });
    if (preview.kind !== 'ready') throw new Error('expected preview');
    preview.state.entities[0].name = '篡改副本';
    expect(value[0].TavernDB_ACU_IsolatedData[''].worldSimulation.state.entities[1].name).toBe('商人');
  });

  it('returns hidden entries only when the caller explicitly permits them', () => {
    const preview = readWorldSimulationAgentPreview_ACU(chat(), '', { showHidden: true });
    expect(preview).toMatchObject({ kind: 'ready', state: { entities: [{ id: 'hidden' }, { id: 'shown' }] } });
  });
});
