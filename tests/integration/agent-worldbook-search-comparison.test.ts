import { describe, expect, it, vi } from 'vitest';
import { runAgentSearch_ACU } from '../../src/service/continuation/agent/agent-search';
import { executeWorldSimulationAgentTools_ACU } from '../../src/service/simulation/world-simulation-agent-tools';
import { WorldSimulationDirectorRuntime_ACU } from '../../src/service/simulation/world-simulation-director-runtime';
import { buildDefaultWorldSimulationSettings_ACU } from '../../src/service/simulation/defaults';

const worldbook = { available: true, entries: [{ bookName: '设定集', uid: '7', title: '港口规则', keys: ['港口'], constant: false, content: '夜间封锁，通行需出示蓝色通行证。', tokens: 20 }] };
const snapshot: any = { anchorMessageIndex: 1, storyClock: { anchorText: '港口', elapsedSinceLastRun: '即时', precision: 'unknown', evidenceIndexes: [], updatedIndex: 1 }, entities: [], events: [], threads: [], revisions: { entities: 0, events: 0, threads: 0 } };
const call = { kind: 'search' as const, query: '蓝色通行证', scope: ['worldbook' as const], isRegex: false, maxResults: 20 };

describe('worldbook search execution-path comparison', () => {
  it('continuation locates a body-only keyword in the same loaded snapshot', () => {
    const text = runAgentSearch_ACU({ ...call, action: 'search' } as any, { worldbook } as any);
    expect(text).toContain('$WORLDBOOK:设定集:7');
    expect(text).toContain('蓝色通行证');
  });
  it('simulation specialist locates a body-only keyword; exact read succeeds and search itself grants nothing', () => {
    const result = executeWorldSimulationAgentTools_ACU({ calls: [call], snapshot, worldbook });
    expect(result.text).toContain('蓝色通行证');
    expect(result.text).toContain('$WORLDBOOK:设定集:7');
    expect(result.successfulReadRefs).toEqual([]);
    const read = executeWorldSimulationAgentTools_ACU({ calls: [{ kind: 'read', reads: ['$WORLDBOOK:设定集:7'] }], snapshot, worldbook });
    expect(read.text).toContain('蓝色通行证');
    expect(read.successfulReadRefs).toEqual(['$WORLDBOOK:设定集:7']);
  });
  it('simulation director locates that same body-only keyword without granting', async () => {
    const master = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ action: 'tools', thought: '查找通行要求', calls: [call] }))
      .mockResolvedValueOnce(JSON.stringify({ action: 'finalize', thought: '结束诊断', decision: 'no_change', acceptedAgents: [], summary: '无变更', unresolved: [] }));
    const result = await new WorldSimulationDirectorRuntime_ACU().run({ runId: 'search-diagnostic', snapshot, storyClock: snapshot.storyClock, settings: buildDefaultWorldSimulationSettings_ACU(), reads: [], userInstruction: '', isCurrent: () => true, worldbook }, { runMaster: master, runSpecialists: vi.fn() });
    expect(result.history.some(message => message.role === 'user' && message.content.includes('蓝色通行证'))).toBe(true);
    expect(result.history.some(message => message.role === 'user' && message.content.includes('$WORLDBOOK:设定集:7'))).toBe(true);
    expect(result.grants).toEqual([]);
  });
});
