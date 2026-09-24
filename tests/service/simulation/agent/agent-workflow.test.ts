import { describe, expect, it, vi } from 'vitest';
import { buildDefaultWorldSimulationSettings_ACU, buildEmptyWorldSimulationLedger_ACU } from '../../../../src/service/simulation/defaults';
import { runWorldSimulationWorkflow_ACU } from '../../../../src/service/simulation/agent/agent-workflow';
import { WorldSimulationRunWriteState_ACU } from '../../../../src/service/simulation/simulation-run-write-state';
import { createWorldSimulationEvidenceRegistry_ACU, snapshotWorldSimulationEvidenceRegistry_ACU } from '../../../../src/service/simulation/world-simulation-evidence-registry';
import type { WorldSimulationLedger_ACU, WorldSimulationPendingFix_ACU } from '../../../../src/service/simulation/model';
import type { WorldSimulationSubagentOutcome_ACU } from '../../../../src/service/simulation/agent/agent-model';

function pending(module: WorldSimulationPendingFix_ACU['module'], attempts: number): WorldSimulationPendingFix_ACU {
  const now = Date.now();
  return {
    module,
    candidateId: `candidate:${module}`,
    agentName: module === 'clock' ? 'timekeeper' : module === 'guidance' ? 'guidance-composer' : 'undercurrent-analyst',
    violations: [{ path: `$.patch.${module}`, message: `${module} 待修复` }],
    attempts,
    firstFailedAtDay: 1,
    lastError: `${module} 待修复`,
    source: 'transaction_rejected',
    completion: 'failed',
    acceptedKeys: [],
    anchor: null,
    createdAt: now,
    updatedAt: now,
  };
}

function harness(ledger: WorldSimulationLedger_ACU, scripts: Record<string, WorldSimulationSubagentOutcome_ACU[]>) {
  const calls: string[] = [];
  const registry = createWorldSimulationEvidenceRegistry_ACU('workflow');
  const settings = buildDefaultWorldSimulationSettings_ACU();
  const promptContext = {
    task: {}, history: [], runtimeContext: {}, agentCatalog: [], toolCatalog: [], evidence: [], userGuidance: '',
    worldState: ledger, anchorMessage: '北岭的风停了一瞬。', anchorIdentity: {}, worldStagePlan: {}, worldChronicle: [],
    worldCandidates: [], worldCollisions: { playerRegion: null, playerContact: 'open' as const, secludedNote: null, collidedSeeds: [], ripeRumors: [] },
    evidenceRegistry: snapshotWorldSimulationEvidenceRegistry_ACU(registry), projectionPreview: {},
  };
  const identity = {
    runId: 'run-workflow', chatIdentity: 'chat-workflow', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null,
    anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: ledger.revision,
    taskId: 'task-workflow', stageId: 'stage-workflow', stageRevision: 1,
  };
  const subagents = {
    run: vi.fn(async ({ delegation }: { delegation: { agentName: string } }) => {
      calls.push(delegation.agentName);
      const queue = scripts[delegation.agentName];
      const next = queue?.shift();
      if (!next) throw new Error(`UNEXPECTED_WORKFLOW_AGENT:${delegation.agentName}`);
      return next;
    }),
  };
  return { calls, registry, settings, promptContext, identity, subagents, tools: { read: vi.fn(), search: vi.fn() } };
}

const noChange = (agentName: string): WorldSimulationSubagentOutcome_ACU => ({
  agentName, status: 'no_change', summary: `${agentName} 无变化`, evidenceRefs: [], uncertainties: [],
});

describe('世界推演固定工作流', () => {
  it('按 timekeeper、并行暗流与人物、投影决定的顺序执行，全 no_change 不调用投影决定', async () => {
    const env = harness(buildEmptyWorldSimulationLedger_ACU(), {
      timekeeper: [noChange('timekeeper')],
      'undercurrent-analyst': [noChange('undercurrent-analyst')],
      'dramatis-keeper': [noChange('dramatis-keeper')],
    });
    const result = await runWorldSimulationWorkflow_ACU({
      identity: env.identity, settings: env.settings, promptContext: env.promptContext, registry: env.registry, tools: env.tools,
      opening: { summary: '开局', focus: '时钟', dispatchChronicler: false, skipModules: [] },
      subagents: env.subagents,
    });
    expect(env.calls[0]).toBe('timekeeper');
    expect(env.calls.slice(1).sort()).toEqual(['dramatis-keeper', 'undercurrent-analyst']);
    expect(env.calls).not.toContain('guidance-composer');
    expect(result.outcome).toBe('no_change');
  });

  it('timekeeper 即时保存后，后续派工读取新账本，独立候选在其上预演且不会重放已保存写入', async () => {
    const initial = buildEmptyWorldSimulationLedger_ACU();
    const env = harness(initial, {});
    let current = initial;
    const archive = { schemaVersion: 1, records: {} };
    const runWrites = new WorldSimulationRunWriteState_ACU(() => ({ ledger: current, fields: undefined, archive }), initial.revision);
    const dimension = {
      candidateId: 'run-workflow:undercurrent-analyst:1', agentName: 'undercurrent-analyst',
      patch: { dimensions: { upsert: [{ id: 'dimension-1', name: '边境压力', kind: 'pressure', value: 1,
        trend: 'rising', rationale: '锚点证据', evidenceRefs: [], expectedRevision: 0 }] } },
      summary: '补充维度', evidenceRefs: [], uncertainties: [], writableModules: ['dimensions', 'seeds'],
    };
    env.subagents.run.mockImplementation(async ({ delegation, promptContext }: any) => {
      if (delegation.agentName === 'timekeeper') {
        current = { ...current, revision: 1, clock: { ...current.clock, day: 2 } };
        runWrites.confirm({ ledger: current, fields: undefined, archive }, [], [{ module: 'clock', id: 'singleton' }]);
        return noChange('timekeeper');
      }
      expect(promptContext.worldState.clock.day).toBe(2);
      return { agentName: dimension.agentName, status: 'candidate', summary: dimension.summary,
        evidenceRefs: [], uncertainties: [], candidate: dimension };
    });
    const result = await runWorldSimulationWorkflow_ACU({
      identity: env.identity, settings: env.settings, promptContext: env.promptContext, registry: env.registry, tools: env.tools,
      opening: { summary: '开局', focus: '压力', dispatchChronicler: false, skipModules: [] },
      targetModules: ['clock', 'dimensions'], subagents: env.subagents, readCurrent: () => current, runWrites,
    });
    expect(result.outcome).toBe('commit');
    expect(result.ledger).toMatchObject({ revision: 2, clock: { day: 2 } });
    expect(result.ledger.dimensions).toHaveLength(1);
    expect(result.commitCandidate?.acceptedCandidates).toEqual([expect.objectContaining({ candidateId: dimension.candidateId, patch: dimension.patch })]);
  });

  it('已确认即时写入与终局候选重叠时拒绝，而不悄悄丢弃候选', async () => {
    const initial = buildEmptyWorldSimulationLedger_ACU();
    const env = harness(initial, {});
    let current = initial;
    const archive = { schemaVersion: 1, records: {} };
    const runWrites = new WorldSimulationRunWriteState_ACU(() => ({ ledger: current, fields: undefined, archive }), initial.revision);
    env.subagents.run.mockImplementation(async ({ delegation }: any) => {
      if (delegation.agentName === 'timekeeper') {
        current = { ...current, revision: 1, clock: { ...current.clock, day: 2 } };
        runWrites.confirm({ ledger: current, fields: undefined, archive }, [], [{ module: 'clock', id: 'singleton' }]);
        return { agentName: 'timekeeper', status: 'candidate', summary: '再次推进', evidenceRefs: [], uncertainties: [],
          candidate: { candidateId: 'overlap', agentName: 'timekeeper', patch: { clock: { days: 1 } },
            summary: '再次推进', evidenceRefs: [], uncertainties: [], writableModules: ['clock'] } };
      }
      return noChange(delegation.agentName);
    });
    await expect(runWorldSimulationWorkflow_ACU({
      identity: env.identity, settings: env.settings, promptContext: env.promptContext, registry: env.registry, tools: env.tools,
      opening: { summary: '开局', focus: '时钟', dispatchChronicler: false, skipModules: [] },
      targetModules: ['clock'], subagents: env.subagents, readCurrent: () => current, runWrites,
    })).rejects.toThrow('WORLD_SIMULATION_RUN_WRITE_OVERLAP');
  });

  it('正文指纹未变且预期模块均完成时不调用任何子代理', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.materialCompletion = {
      state: 'complete_no_change',
      expectedModules: ['clock', 'dimensions', 'seeds', 'actors', 'rumors', 'player'],
      modules: {
        clock: 'complete_no_change',
        dimensions: 'complete_no_change',
        seeds: 'complete_no_change',
        actors: 'complete_no_change',
        rumors: 'complete_no_change',
        player: 'complete_no_change',
      },
      sourceRunId: 'run-completed',
      updatedAt: Date.now(),
    };
    const env = harness(ledger, {});
    const result = await runWorldSimulationWorkflow_ACU({
      identity: env.identity, settings: env.settings, promptContext: env.promptContext, registry: env.registry, tools: env.tools,
      opening: { summary: '开局', focus: '时钟', dispatchChronicler: false, skipModules: [] },
      anchorMaterialsCommitted: true,
      subagents: env.subagents,
    });
    expect(env.subagents.run).not.toHaveBeenCalled();
    expect(result).toMatchObject({ outcome: 'no_change', pendingFixes: [] });
  });

  it('只有材料快照但 completion 为 legacy_unknown 时不能短路', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    const env = harness(ledger, {
      timekeeper: [noChange('timekeeper')],
      'undercurrent-analyst': [noChange('undercurrent-analyst')],
      'dramatis-keeper': [noChange('dramatis-keeper')],
    });
    const result = await runWorldSimulationWorkflow_ACU({
      identity: env.identity, settings: env.settings, promptContext: env.promptContext, registry: env.registry, tools: env.tools,
      opening: { summary: '开局', focus: '时钟', dispatchChronicler: false, skipModules: [] },
      anchorMaterialsCommitted: true,
      subagents: env.subagents,
    });
    expect(env.calls).toEqual(expect.arrayContaining(['timekeeper', 'undercurrent-analyst', 'dramatis-keeper']));
    expect(result.outcome).toBe('no_change');
    expect(result.ledger.materialCompletion.state).toBe('complete_no_change');
  });

  it('时钟变化后调用投影决定；悬挂 sourceId 记入 pendingFixes 且不写入信号', async () => {
    const clock = {
      agentName: 'timekeeper', status: 'candidate' as const, summary: '推进一天', evidenceRefs: [] as string[], uncertainties: [] as string[],
      candidate: {
        candidateId: 'run-workflow:timekeeper:1', agentName: 'timekeeper', patch: { clock: { days: 1 } },
        summary: '推进一天', evidenceRefs: [], uncertainties: [], writableModules: ['clock'],
      },
    };
    const badGuidance = {
      agentName: 'guidance-composer', status: 'candidate' as const, summary: '坏投影', evidenceRefs: [] as string[], uncertainties: [] as string[],
      candidate: {
        candidateId: 'run-workflow:guidance-composer:1', agentName: 'guidance-composer',
        patch: { guidance: { signals: [{ text: '城中忽然多了一段没来源的钟声', voice: 'ambient', sourceId: 'missing-source' }] } },
        summary: '坏投影', evidenceRefs: [], uncertainties: [], writableModules: ['guidance'],
      },
    };
    const env = harness(buildEmptyWorldSimulationLedger_ACU(), {
      timekeeper: [clock],
      'undercurrent-analyst': [noChange('undercurrent-analyst')],
      'dramatis-keeper': [noChange('dramatis-keeper')],
      'guidance-composer': [badGuidance],
    });
    const result = await runWorldSimulationWorkflow_ACU({
      identity: env.identity, settings: env.settings, promptContext: env.promptContext, registry: env.registry, tools: env.tools,
      opening: { summary: '开局', focus: '时钟', dispatchChronicler: false, skipModules: [] },
      subagents: env.subagents,
    });
    expect(env.calls).toContain('guidance-composer');
    expect(result.outcome).toBe('escalate');
    expect(result.ledger.clock.day).toBe(2);
    expect(result.ledger.guidance.signals).toEqual([]);
    expect(result.pendingFixes).toEqual(expect.arrayContaining([expect.objectContaining({ module: 'guidance' })]));
  });

  it('已有 pending 在正常派工内补齐，不另开自动修复派工', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.pendingFixes = [pending('clock', 3)];
    const fixed = {
      agentName: 'timekeeper', status: 'candidate' as const, summary: '正常派工补齐时钟', evidenceRefs: [] as string[], uncertainties: [] as string[],
      candidate: {
        candidateId: 'run-workflow:timekeeper:1', agentName: 'timekeeper', patch: { clock: { days: 1, storyTime: '次日' } },
        summary: '正常派工补齐时钟', evidenceRefs: [], uncertainties: [], writableModules: ['clock'],
      },
    };
    const env = harness(ledger, {
      timekeeper: [fixed],
      'undercurrent-analyst': [noChange('undercurrent-analyst')],
      'dramatis-keeper': [noChange('dramatis-keeper')],
      'guidance-composer': [noChange('guidance-composer')],
    });
    const result = await runWorldSimulationWorkflow_ACU({
      identity: env.identity, settings: env.settings, promptContext: env.promptContext, registry: env.registry, tools: env.tools,
      opening: { summary: '开局', focus: '补齐时钟', dispatchChronicler: false, skipModules: [] }, subagents: env.subagents,
    });
    expect(env.calls.filter(name => name === 'timekeeper')).toEqual(['timekeeper']);
    expect(result.ledger.clock.storyTime).toBe('次日');
    expect(result.pendingFixes.some(item => item.module === 'clock')).toBe(false);
  });

  it('未补齐的 pending 直报主会话，不派独立修复', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.pendingFixes = [pending('clock', 1)];
    const env = harness(ledger, {
      timekeeper: [{ agentName: 'timekeeper', status: 'failed', completion: 'failed', summary: '仍缺字段', evidenceRefs: [], uncertainties: [],
        unresolvedIssues: [{ module: 'clock', source: 'missing_field', path: 'clock#singleton.storyTime', message: '缺字段' }] }],
      'undercurrent-analyst': [noChange('undercurrent-analyst')],
      'dramatis-keeper': [noChange('dramatis-keeper')],
    });
    const result = await runWorldSimulationWorkflow_ACU({
      identity: env.identity, settings: env.settings, promptContext: env.promptContext, registry: env.registry, tools: env.tools,
      opening: { summary: '开局', focus: '时钟', dispatchChronicler: false, skipModules: [] }, subagents: env.subagents,
    });
    expect(env.calls.filter(name => name === 'timekeeper')).toEqual(['timekeeper']);
    expect(result).toMatchObject({ outcome: 'escalate', escalated: true });
    expect(result.pendingFixes[0].violations).toContainEqual({ path: 'clock#singleton.storyTime', message: '缺字段' });
  });

});
