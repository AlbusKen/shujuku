import { describe, expect, it, vi } from 'vitest';
import { buildDefaultWorldSimulationSettings_ACU } from '../../../src/service/simulation/defaults';
import { WorldSimulationDirectorRuntime_ACU } from '../../../src/service/simulation/world-simulation-director-runtime';
import { WorldSimulationValidationError_ACU } from '../../../src/service/simulation/model';

const snapshot: any = { anchorMessageIndex: 1, storyClock: { anchorText: '港口', elapsedSinceLastRun: '即时', precision: 'unknown', evidenceIndexes: [], updatedIndex: 1 }, entities: [{ id: 'ent-1', kind: 'character', name: '密探', importance: 'active', situation: '观察', agenda: '等待', lastMovedIndex: 1, lastMovedAt: '即时', visibility: { mode: 'hidden' }, retired: false, updatedIndex: 1 }], events: [], threads: [], revisions: { entities: 0, events: 0, threads: 0 } };
const worldbook: any = { available: true, entries: [{ bookName: '港口设定', uid: '1', title: '港口规则', keys: ['港口'], constant: false, content: '夜间封锁', tokens: 2 }] };
const clock = { ...snapshot.storyClock };
const loop: any = { snapshot, agentsRun: ['entity-movement'], callsUsed: 1, readTokens: 1, transactions: [{ expectedRevisions: { entities: 0 }, entities: [{ action: 'upsert', value: snapshot.entities[0] }], events: [], threads: [] }] };
function input() { return { runId: 'run-1', snapshot, storyClock: clock, settings: buildDefaultWorldSimulationSettings_ACU(), reads: [], isCurrent: () => true, userInstruction: '', worldbook }; }

describe('WorldSimulationDirectorRuntime_ACU', () => {
  it('issues a W grant only after an actual worldbook read and finalizes returned candidates', async () => {
    const master = vi.fn()
      .mockResolvedValueOnce('{"action":"tools","thought":"读取设定","calls":[{"kind":"read","reads":["$WORLDBOOK:港口设定:1"]}]}')
      .mockResolvedValueOnce('{"action":"delegate","thought":"核验实体","delegations":[{"agentName":"entity-movement","task":"核验位置","materialGrants":["W1"],"reads":[]}]}')
      .mockResolvedValueOnce('{"action":"finalize","thought":"采用候选","decision":"commit","acceptedAgents":["entity-movement"],"summary":"可提交","unresolved":[]}');
    const specialists = vi.fn(async (_plan, grants) => { expect(grants.get('entity-movement')).toMatchObject([{ grantId: 'W1', content: '夜间封锁' }]); return loop; });
    const result = await new WorldSimulationDirectorRuntime_ACU().run(input(), { runMaster: master, runSpecialists: specialists });
    expect(result.loop).toBe(loop); expect(result.grants).toHaveLength(1); expect(master).toHaveBeenCalledTimes(3); expect(specialists).toHaveBeenCalledTimes(1);
    const finalizeRequest = master.mock.calls[2]![0];
    const candidates = finalizeRequest.messages.find((message: any) => message.content.includes('<UNTRUSTED_SPECIALIST_CANDIDATES>'));
    expect(candidates).toMatchObject({ role: 'user' });
    expect(candidates.content).toContain('expectedRevisions');
    const contexts = finalizeRequest.messages.filter((message: any) => message.content.includes('【本次运行上下文】'));
    // The second snapshot is legitimately appended after the worldbook read grants W1 and
    // changes the available catalog; the later candidate remains part of real history.
    expect(contexts).toHaveLength(2);
    expect(finalizeRequest.messages.findIndex((message: any) => message === candidates)).toBeGreaterThan(finalizeRequest.messages.findIndex((message: any) => message === contexts.at(-1)));
    // Guided layout tail: candidates → guided history closing text (system) → assistant ack → execution boundary.
    expect(finalizeRequest.messages.at(-4)).toEqual(candidates);
    expect(finalizeRequest.messages.at(-3)?.content).toContain('以上历史只记录本次运行中真实发生的交互');
    expect(finalizeRequest.messages.at(-2)?.role).toBe('assistant');
    expect(finalizeRequest.messages.at(-1)?.role).toBe('system');
  });

  it('keeps a tight-budget legacy bare delegation executable without reserving a nonexistent finalize call', async () => {
    const settings = buildDefaultWorldSimulationSettings_ACU();
    settings.budgets.deep.maxMasterModelTurns = 1;
    const master = vi.fn(async () => '{"delegations":[{"agent":"entity-movement","instruction":"兼容派工"}]}');
    const specialists = vi.fn(async () => loop);
    const result = await new WorldSimulationDirectorRuntime_ACU().run({ ...input(), settings }, { runMaster: master, runSpecialists: specialists });
    expect(result.action).toMatchObject({ kind: 'delegate', legacy: true });
    expect(master).toHaveBeenCalledTimes(1); expect(specialists).toHaveBeenCalledTimes(1);
  });

  it('registers a $TABLE grant only after a successful frozen-table read and grants it to specialists via materialGrants', async () => {
    const tableData = { 'sheet1': { name: '纪要表', content: [['轮次', '概要'], ['第 1 轮', '主角抵达港口']] } };
    const master = vi.fn()
      .mockResolvedValueOnce('{"action":"tools","thought":"读取纪要","calls":[{"kind":"read","reads":["$TABLE:纪要表:1-1"]}]}')
      .mockResolvedValueOnce('{"action":"delegate","thought":"核验纪要","delegations":[{"agentName":"entity-movement","task":"核对到达","materialGrants":["W1"],"reads":["$TABLE:纪要表:1-1"]}]}')
      .mockResolvedValueOnce('{"action":"finalize","thought":"采用候选","decision":"commit","acceptedAgents":["entity-movement"],"summary":"可提交","unresolved":[]}');
    const specialists = vi.fn(async (_plan, grants) => {
      expect(grants.get('entity-movement')).toMatchObject([{ grantId: 'W1', content: expect.stringContaining('1. 第 1 轮 | 主角抵达港口') }]);
      return loop;
    });
    const result = await new WorldSimulationDirectorRuntime_ACU().run({ ...input(), tableData }, { runMaster: master, runSpecialists: specialists });
    expect(result.grants).toHaveLength(1);
    expect(result.grants[0]!.source.address).toBe('$TABLE:纪要表:1-1');
    expect(specialists).toHaveBeenCalledTimes(1);
  });

  it('never registers a grant for a failed $TABLE read and rejects unknown grant ids at delegation', async () => {
    const tableData = { 'sheet1': { name: '纪要表', content: [['轮次', '概要'], ['第 1 轮', '主角抵达港口']] } };
    const master = vi.fn()
      .mockResolvedValueOnce('{"action":"tools","thought":"读取不存在的表","calls":[{"kind":"read","reads":["$TABLE:不存在的表"]}]}')
      .mockResolvedValueOnce('{"action":"delegate","thought":"引用未授权 grant","delegations":[{"agentName":"entity-movement","task":"x","materialGrants":["W1"],"reads":[]}]}');
    await expect(new WorldSimulationDirectorRuntime_ACU().run({ ...input(), tableData }, { runMaster: master, runSpecialists: vi.fn() }))
      .rejects.toMatchObject({ error: { code: 'WORLD_SIM_PROTOCOL_INVALID' } });
  });


  it('counts tools against the director model-turn cap but never spends specialist turns', async () => {
    const settings = buildDefaultWorldSimulationSettings_ACU();
    settings.budgets.deep.maxMasterModelTurns = 1;
    settings.budgets.deep.maxSpecialistModelTurns = 4;
    const master = vi.fn(async () => '{"action":"tools","thought":"读取","calls":[{"kind":"read","reads":["$WORLD_STATE"]}]}');
    await expect(new WorldSimulationDirectorRuntime_ACU().run({ ...input(), settings }, { runMaster: master, runSpecialists: vi.fn() }))
      .rejects.toMatchObject({ error: { code: 'WORLD_SIM_BUDGET_EXCEEDED' } });
    expect(master).toHaveBeenCalledTimes(1);
  });

  it('rejects a master tools action when the explicit tools switch is off', async () => {
    const settings = buildDefaultWorldSimulationSettings_ACU();
    settings.toolsEnabled = false;
    const master = vi.fn(async () => '{"action":"tools","thought":"继续读取","calls":[{"kind":"read","reads":["$WORLD_STATE"]}]}');
    await expect(new WorldSimulationDirectorRuntime_ACU().run({ ...input(), settings }, { runMaster: master, runSpecialists: vi.fn() }))
      .rejects.toMatchObject({ error: { code: 'WORLD_SIM_PROTOCOL_INVALID' } });
    expect(master).toHaveBeenCalledTimes(1);
  });

  it('rejects a commit finalize that adopts no returned candidate', async () => {
    const master = vi.fn().mockResolvedValue('{"action":"finalize","thought":"伪造采用","decision":"commit","acceptedAgents":["entity-movement"],"summary":"x","unresolved":[]}');
    await expect(new WorldSimulationDirectorRuntime_ACU().run(input(), { runMaster: master, runSpecialists: vi.fn() })).rejects.toBeInstanceOf(WorldSimulationValidationError_ACU);
  });
});
