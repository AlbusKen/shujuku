import { describe, expect, it, vi } from 'vitest';
import { findWorldSimulationAgent_ACU } from '../../../src/service/simulation/agent/agent-catalog';
import { parseWorldSimulationSpecialistOutput_ACU } from '../../../src/service/simulation/agent/agent-protocol';
import { WorldSimulationValidationError_ACU } from '../../../src/service/simulation/model';
import { WorldSimulationSpecialistRuntime_ACU } from '../../../src/service/simulation/world-simulation-specialist-runtime';

const clock: any = { anchorText: '港口次日', elapsedSinceLastRun: '约一日', precision: 'approximate', evidenceIndexes: [4], updatedIndex: 5 };
function snapshot(): any {
  return { anchorMessageIndex: 4, storyClock: clock, entities: [{ id: 'ent-a', kind: 'character', name: '密探', importance: 'active', situation: '等待', agenda: '观察', lastMovedIndex: 4, lastMovedAt: '昨日', visibility: { mode: 'hidden' }, retired: false, updatedIndex: 4 }], events: [], threads: [], revisions: { entities: 1, events: 0, threads: 0 } };
}
const worldbook: any = { available: true, entries: [{ bookName: '港口', uid: '1', title: '宵禁', keys: ['港口'], constant: false, content: '午夜封锁', tokens: 2 }] };
function entityCandidate(refs: string[] = ['$WORLD_STATE']): string {
  const state = snapshot();
  return JSON.stringify({ expectedRevisions: { entities: state.revisions.entities }, entities: [{ action: 'upsert', value: { ...state.entities[0], situation: '已移动', updatedIndex: 0 } }], events: [], threads: [], evidenceRefs: refs, summary: '密探转移位置', uncertainties: [] });
}
function eventCandidate(expectedRevision = 0, durationHint = '即时'): string {
  return JSON.stringify({ expectedRevisions: { events: expectedRevision }, entities: [], events: [{ action: 'upsert', value: { id: 'evt-a', summary: '港口传来消息', actorIds: ['ent-a'], occurredIndex: 5, occurredAt: '港口次日', durationHint, visibility: { mode: 'rumored' }, retired: false, updatedIndex: 0 } }], threads: [], evidenceRefs: ['$WORLD_STATE'], summary: '事件候选', uncertainties: [] });
}
function hiddenThreadCandidate(expectedSurfaceHint: string): string {
  return JSON.stringify({ expectedRevisions: { threads: 0 }, entities: [], events: [], threads: [{ action: 'upsert', value: { id: 'thr-a', title: '港口暗线', status: 'brewing', summary: '密探已经掌握密道位置', expectedSurfaceHint, visibility: { mode: 'hidden' }, relatedEventIds: [], retired: false, updatedIndex: 0 } }], evidenceRefs: ['$WORLD_STATE'], summary: '暗线候选', uncertainties: [] });
}
function parse(raw: string, agent = findWorldSimulationAgent_ACU('entity-movement')!): unknown {
  return parseWorldSimulationSpecialistOutput_ACU({ raw, agent, snapshot: snapshot(), anchorMessageIndex: 5, storyClock: clock, allowedEvidenceRefs: ['$WORLD_STATE'] });
}

describe('WorldSimulationSpecialistRuntime_ACU', () => {
  it('feeds successful reads back through UNTRUSTED_TOOL_RESULTS before accepting a C5 candidate', async () => {
    const outputs = ['{"thought":"核对状态","action":"tools","calls":[{"kind":"read","reads":["$WORLD_STATE"]}]}', entityCandidate()];
    const runAgent = vi.fn(async () => outputs.shift() ?? null);
    const result = await new WorldSimulationSpecialistRuntime_ACU().run({ agent: findWorldSimulationAgent_ACU('entity-movement')!, snapshot: snapshot(), anchorMessageIndex: 5, storyClock: clock, materialGrants: [], seedReadRefs: [], fixedReads: [], worldbook, previousCandidateSummaries: [], maxCalls: 2, isCurrent: () => true }, { runAgent });
    expect(result.callsUsed).toBe(2);
    expect(result.successfulReadRefs).toContain('$WORLD_STATE');
    expect(result.candidate.evidenceRefs).toEqual(['$WORLD_STATE']);
    const toolResults = runAgent.mock.calls[1]![0].messages.find((message: any) => message.content.includes('<UNTRUSTED_TOOL_RESULTS>'));
    expect(toolResults).toMatchObject({ role: 'user' });
    expect(toolResults.content).toContain('### $WORLD_STATE');
  });

  it('counts a tools output as one of the specialist model turns', async () => {
    const outputs = ['{"thought":"核对状态","action":"tools","calls":[{"kind":"read","reads":["$WORLD_STATE"]}]}'];
    await expect(new WorldSimulationSpecialistRuntime_ACU().run({
      agent: findWorldSimulationAgent_ACU('entity-movement')!, snapshot: snapshot(), anchorMessageIndex: 5, storyClock: clock,
      materialGrants: [], seedReadRefs: [], fixedReads: [], worldbook, previousCandidateSummaries: [], maxCalls: 1, isCurrent: () => true,
    }, { runAgent: async () => outputs.shift() ?? null })).rejects.toMatchObject({ error: { code: 'WORLD_SIM_BUDGET_EXCEEDED' } });
  });

  it('rejects a tools output when the explicit tools switch is off', async () => {
    const outputs = ['{"thought":"核对状态","action":"tools","calls":[{"kind":"read","reads":["$WORLD_STATE"]}]}'];
    await expect(new WorldSimulationSpecialistRuntime_ACU().run({
      agent: findWorldSimulationAgent_ACU('entity-movement')!, snapshot: snapshot(), anchorMessageIndex: 5, storyClock: clock,
      materialGrants: [], seedReadRefs: [], fixedReads: [], worldbook, previousCandidateSummaries: [], maxCalls: 2, toolsEnabled: false, isCurrent: () => true,
    }, { runAgent: async () => outputs.shift() ?? null })).rejects.toMatchObject({ error: { code: 'WORLD_SIM_PROTOCOL_INVALID' } });
  });

  it('does not allow a search hit to become candidate evidence', async () => {
    const outputs = ['{"thought":"搜索","action":"tools","calls":[{"kind":"search","query":"密探","scope":["ledger"],"isRegex":false,"maxResults":20}]}', entityCandidate()];
    await expect(new WorldSimulationSpecialistRuntime_ACU().run({ agent: findWorldSimulationAgent_ACU('entity-movement')!, snapshot: snapshot(), anchorMessageIndex: 5, storyClock: clock, materialGrants: [], seedReadRefs: [], fixedReads: [], worldbook, previousCandidateSummaries: [], maxCalls: 2, isCurrent: () => true }, { runAgent: async () => outputs.shift() ?? null })).rejects.toBeInstanceOf(WorldSimulationValidationError_ACU);
  });

  it('does not treat missing or unavailable frozen story materials as successful C5 evidence', async () => {
    const missing = ['{"thought":"正文","action":"tools","calls":[{"kind":"read","reads":["$STORY_PENDING"]}]}', entityCandidate(['$STORY_PENDING'])];
    await expect(new WorldSimulationSpecialistRuntime_ACU().run({ agent: findWorldSimulationAgent_ACU('entity-movement')!, snapshot: snapshot(), anchorMessageIndex: 5, storyClock: clock, materialGrants: [], seedReadRefs: [], fixedReads: [], worldbook, previousCandidateSummaries: [], maxCalls: 2, isCurrent: () => true }, { runAgent: async () => missing.shift() ?? null })).rejects.toBeInstanceOf(WorldSimulationValidationError_ACU);

    const unavailable = ['{"thought":"读取概览","action":"tools","calls":[{"kind":"read","reads":["$STORY_OVERVIEW"]}]}', entityCandidate(['$STORY_OVERVIEW'])];
    const storyContext: any = { feature: 'world-simulation', runId: 'run-1', chatIdentity: 'chat-1', branchIdentity: 'branch-1', sourceRevision: 'r1', sourceDigest: 'd1', profile: 'world-specialist', overview: { state: 'failed', text: '', digest: 'o1', diagnostic: '读取失败' }, pending: { text: '正文', digest: 'p1' }, bridge: { text: '', digest: 'b1' }, catalog: { text: '目录', digest: 'c1' } };
    await expect(new WorldSimulationSpecialistRuntime_ACU().run({ agent: findWorldSimulationAgent_ACU('entity-movement')!, snapshot: snapshot(), anchorMessageIndex: 5, storyClock: clock, storyContext, materialGrants: [], seedReadRefs: [], fixedReads: [], worldbook, previousCandidateSummaries: [], maxCalls: 2, isCurrent: () => true }, { runAgent: async () => unavailable.shift() ?? null })).rejects.toBeInstanceOf(WorldSimulationValidationError_ACU);
  });

  it('rejects C5 proposals scope, unread W evidence, unknown fields, and privileged actions', () => {
    const invalid = [
      '{"thought":"越界","action":"tools","calls":[{"kind":"search","query":"x","scope":["proposals"],"isRegex":false,"maxResults":1}]}',
      entityCandidate(['W1']),
      `${entityCandidate().slice(0, -1)},"extra":true}`,
      '{"action":"delegate","thought":"越权","delegations":[]}',
      '{"action":"finalize","thought":"越权","decision":"no_change","acceptedAgents":[],"summary":"x","unresolved":[]}',
    ];
    for (const raw of invalid) expect(() => parse(raw)).toThrow(WorldSimulationValidationError_ACU);
  });

  it('rejects C5 cross-module writes, stale revisions, time-infeasible events, and direct hidden thread leaks', () => {
    const faction = findWorldSimulationAgent_ACU('faction-events')!;
    const thread = findWorldSimulationAgent_ACU('thread-weaver')!;
    expect(() => parse(entityCandidate(), faction)).toThrow(WorldSimulationValidationError_ACU);
    expect(() => parse(eventCandidate(1), faction)).toThrow(WorldSimulationValidationError_ACU);
    expect(() => parse(eventCandidate(0, '约一周'), faction)).toThrow(WorldSimulationValidationError_ACU);
    expect(() => parse(hiddenThreadCandidate('密探已经掌握密道位置'), thread)).toThrow(WorldSimulationValidationError_ACU);
    expect(parse(hiddenThreadCandidate('可通过港口传闻逐步显露'), thread)).toMatchObject({ kind: 'candidate' });
  });
});
