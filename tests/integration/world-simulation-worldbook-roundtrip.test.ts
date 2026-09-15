import { afterEach, describe, expect, it, vi } from 'vitest';
import { _set_TavernHelper_API_ACU } from '../../src/shared/host-api';
import * as settings from '../../src/service/settings/settings-readers';
import { WorldSimulationDirectorRuntime_ACU } from '../../src/service/simulation/world-simulation-director-runtime';
import { runWorldSimulationManualAgentExecution_ACU } from '../../src/service/simulation/world-simulation-agent-execution';
import { buildDefaultWorldSimulationSettings_ACU } from '../../src/service/simulation/defaults';
import { WorldSimulationValidationError_ACU } from '../../src/service/simulation/model';

afterEach(() => { vi.restoreAllMocks(); _set_TavernHelper_API_ACU(undefined as any); });
function host(read: ReturnType<typeof vi.fn>, names = ['设定集']) {
  vi.spyOn(settings, 'getCurrentWorldbookConfig_ACU').mockReturnValue({ source: 'manual', manualSelection: ['设定集'], enabledEntries: {} } as any);
  _set_TavernHelper_API_ACU({ getLorebooks: async () => names, getLorebookEntries: read } as any);
}
const snapshot: any = { anchorMessageIndex: 1, storyClock: { anchorText: '港口', elapsedSinceLastRun: '即时', precision: 'unknown', evidenceIndexes: [], updatedIndex: 1 }, entities: [{ id: 'ent-1', kind: 'character', name: '密探', importance: 'active', situation: '观察', agenda: '等待', lastMovedIndex: 1, lastMovedAt: '即时', visibility: { mode: 'hidden' }, retired: false, updatedIndex: 1 }], events: [], threads: [], revisions: { entities: 0, events: 0, threads: 0 } };
const loop: any = { snapshot, agentsRun: ['entity-movement'], callsUsed: 1, readTokens: 1, transactions: [{ expectedRevisions: { entities: 0 }, entities: [{ action: 'upsert', value: snapshot.entities[0] }], events: [], threads: [] }] };
const search = { kind: 'search' as const, query: '蓝色通行证', scope: ['worldbook' as const], isRegex: false, maxResults: 20 };
const enabled = [{ uid: 7, enabled: true, comment: '港口规则', keys: ['港口'], content: '夜间封锁，通行需出示蓝色通行证。', type: 'constant' }];
function directorInput() {
  return { runId: 'roundtrip', snapshot, storyClock: snapshot.storyClock, settings: buildDefaultWorldSimulationSettings_ACU(), reads: [] as string[], userInstruction: '核验港口通行', isCurrent: () => true };
}

describe('world-simulation worldbook roundtrip', () => {
  it('loads through the real pipeline, searches the body, grants only after read, and forwards W1', async () => {
    const read = vi.fn().mockResolvedValue(enabled);
    host(read);
    const master = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ action: 'tools', thought: '搜索通行', calls: [search] }))
      .mockResolvedValueOnce(JSON.stringify({ action: 'tools', thought: '精读设定', calls: [{ kind: 'read', reads: ['$WORLDBOOK:设定集:7'] }] }))
      .mockResolvedValueOnce(JSON.stringify({ action: 'delegate', thought: '派工', delegations: [{ agentName: 'entity-movement', task: '核验港口', materialGrants: ['W1'], reads: [] }] }))
      .mockResolvedValueOnce(JSON.stringify({ action: 'finalize', thought: '采用', decision: 'commit', acceptedAgents: ['entity-movement'], summary: '可提交', unresolved: [] }));
    const specialists = vi.fn(async (_plan, grants) => {
      expect(grants.get('entity-movement')).toMatchObject([{ grantId: 'W1', content: expect.stringContaining('蓝色通行证') }]);
      return loop;
    });
    const result = await new WorldSimulationDirectorRuntime_ACU().run(directorInput(), { runMaster: master, runSpecialists: specialists });
    expect(read).toHaveBeenCalledWith('设定集');
    expect(result.grants).toHaveLength(1);
    expect(result.history.some(message => message.role === 'user' && message.content.includes('蓝色通行证') && message.content.includes('$WORLDBOOK:设定集:7'))).toBe(true);
    expect(specialists).toHaveBeenCalledTimes(1);
  });
  it('stops before any model call when the host read fails', async () => {
    host(vi.fn().mockRejectedValue(new Error('host read failure')));
    const master = vi.fn();
    await expect(new WorldSimulationDirectorRuntime_ACU().run(directorInput(), { runMaster: master, runSpecialists: vi.fn() })).rejects.toBeInstanceOf(WorldSimulationValidationError_ACU);
    expect(master).not.toHaveBeenCalled();
  });
  it('treats enabled-empty data as an available snapshot and proceeds', async () => {
    host(vi.fn().mockResolvedValue([{ uid: 7, enabled: false, comment: '关闭', content: '不该暴露' }]));
    const master = vi.fn(async () => JSON.stringify({ action: 'finalize', thought: '结束', decision: 'no_change', acceptedAgents: [], summary: '无变更', unresolved: [] }));
    const result = await new WorldSimulationDirectorRuntime_ACU().run(directorInput(), { runMaster: master, runSpecialists: vi.fn() });
    expect(result.action).toMatchObject({ kind: 'finalize', decision: 'no_change' });
    expect(master).toHaveBeenCalledTimes(1);
  });
  it('lets execution omit the snapshot so director uses the default loader', async () => {
    const read = vi.fn().mockResolvedValue(enabled);
    host(read);
    let masterTurns = 0;
    const runAgent = vi.fn(async (request: { source: string }) => {
      if (String(request.source).startsWith('world-sim-agent:')) {
        return JSON.stringify({ expectedRevisions: { entities: 0 }, entities: [{ action: 'upsert', value: snapshot.entities[0] }], events: [], threads: [], evidenceRefs: ['W1'], summary: '密探继续观察', uncertainties: [] });
      }
      masterTurns += 1;
      if (masterTurns === 1) return JSON.stringify({ action: 'tools', thought: '精读', calls: [{ kind: 'read', reads: ['$WORLDBOOK:设定集:7'] }] });
      if (masterTurns === 2) return JSON.stringify({ action: 'delegate', thought: '派工', delegations: [{ agentName: 'entity-movement', task: '核验港口', materialGrants: ['W1'], reads: [] }] });
      return JSON.stringify({ action: 'finalize', thought: '采用', decision: 'commit', acceptedAgents: ['entity-movement'], summary: '可提交', unresolved: [] });
    });
    const result = await runWorldSimulationManualAgentExecution_ACU({
      runId: 'manual-roundtrip', snapshot, anchorMessageIndex: 1, storyClock: snapshot.storyClock, settings: buildDefaultWorldSimulationSettings_ACU(), reads: [], isCurrent: () => true, userInstruction: '核验港口通行',
      readGateConfig: { historyTokenBudget: 1000, readTokenBudget: 500, fallbackTokens: 100, defaultHistoryTokenBudget: 1000, defaultFallbackTokens: 100 },
    }, { countTokens: async () => 1, runAgent });
    expect(read).toHaveBeenCalledWith('设定集');
    expect(result.grants).toMatchObject([{ grantId: 'W1' }]);
    expect(result.loop?.agentsRun).toEqual(['entity-movement']);
  });
});
