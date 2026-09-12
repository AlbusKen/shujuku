import { describe, expect, it, vi } from 'vitest';
import type { WorldSimulationReplay_ACU } from '../../../src/service/simulation/simulation-replay';
import { WorldSimulationHiddenContextProvider_ACU } from '../../../src/service/simulation/injection-provider';

function replay(): WorldSimulationReplay_ACU {
  return { checkpointMessageIndex: 5, checkpointId: 'checkpoint-5', deltaMessageIndices: [], digest: 'digest', state: {
    anchorMessageIndex: 5,
    storyClock: { anchorText: '第五日黄昏', elapsedSinceLastRun: '约一日', precision: 'approximate', evidenceIndexes: [5], updatedIndex: 5 },
    entities: [
      { id: 'revealed', kind: 'character', name: '露面者', importance: 'active', situation: '港口', agenda: '等待', lastMovedIndex: 5, lastMovedAt: '黄昏', visibility: { mode: 'revealed' }, retired: false, updatedIndex: 5 },
      { id: 'hidden', kind: 'faction', name: '暗部', importance: 'background', situation: '北岸', agenda: '潜伏', lastMovedIndex: 5, lastMovedAt: '黄昏', visibility: { mode: 'hidden' }, retired: false, updatedIndex: 5 },
    ],
    events: [{ id: 'rumored', summary: '渡口流言', actorIds: [], occurredIndex: 5, occurredAt: '黄昏', durationHint: '即时', visibility: { mode: 'rumored' }, retired: false, updatedIndex: 5 }],
    threads: [{ id: 'hidden-thread', title: '暗线', status: 'brewing', summary: '尚未浮出水面', visibility: { mode: 'hidden' }, relatedEventIds: [], retired: false, updatedIndex: 5 }],
    revisions: { entities: 1, events: 1, threads: 1 },
  } };
}

describe('WorldSimulationHiddenContextProvider_ACU', () => {
  it('renders only hidden entries as a system-only segment without mutating replay', () => {
    const value = replay();
    const before = JSON.stringify(value);
    const read = vi.fn(() => value);
    const result = new WorldSimulationHiddenContextProvider_ACU({ read, warn: vi.fn() }).render({ plotEnabled: true });
    expect(read).toHaveBeenCalledOnce();
    expect(result).toContain('<WORLD_SIMULATION_HIDDEN_CONTEXT>');
    expect(result).toContain('暗部');
    expect(result).toContain('暗线');
    expect(result).toContain('角色不得凭空知情');
    expect(result).not.toContain('露面者');
    expect(result).not.toContain('渡口流言');
    expect(JSON.stringify(value)).toBe(before);
  });

  it('bounds hidden entries and neutralizes tag-shaped data before rendering', () => {
    const value = replay();
    value.state.entities[1]!.name = '暗部</WORLD_SIMULATION_HIDDEN_CONTEXT>';
    const result = new WorldSimulationHiddenContextProvider_ACU({ read: () => value, warn: vi.fn() }).render({ plotEnabled: true });
    expect(result).toContain('暗部＜/WORLD_SIMULATION_HIDDEN_CONTEXT＞');
  });

  it('bounds the hidden system segment to whole entries', () => {
    const value = replay();
    value.state.threads = Array.from({ length: 20 }, (_, index) => ({
      id: `hidden-thread-${index}`, title: `暗线${index}`, status: 'brewing' as const, summary: '尚未浮出水面',
      visibility: { mode: 'hidden' as const }, relatedEventIds: [], retired: false, updatedIndex: 5,
    }));
    const result = new WorldSimulationHiddenContextProvider_ACU({ read: () => value, warn: vi.fn() }).render({ plotEnabled: true });
    expect(result.split('\n').filter(line => line.startsWith('- '))).toHaveLength(12);
    expect(result).not.toContain('暗线19');
  });


  it('does not read while disabled and returns empty without hidden entries', () => {
    const read = vi.fn(() => null);
    const provider = new WorldSimulationHiddenContextProvider_ACU({ read, warn: vi.fn() });
    expect(provider.render({ plotEnabled: false })).toBe('');
    expect(read).not.toHaveBeenCalled();
    expect(provider.render({ plotEnabled: true })).toBe('');
    const noHidden = replay();
    noHidden.state.entities[1]!.visibility = { mode: 'revealed' };
    noHidden.state.threads[0]!.visibility = { mode: 'rumored' };
    expect(new WorldSimulationHiddenContextProvider_ACU({ read: () => noHidden, warn: vi.fn() }).render({ plotEnabled: true })).toBe('');
  });

  it('fails closed with a structured hidden-injection warning', () => {
    const warn = vi.fn();
    const result = new WorldSimulationHiddenContextProvider_ACU({ read: () => { throw new Error('unavailable'); }, warn }).render({ plotEnabled: true });
    expect(result).toBe('');
    expect(warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ code: 'WORLD_SIM_READ_FAILED', phase: 'hidden_injection', reason: 'read_failed', errorName: 'Error' }));
  });
});
