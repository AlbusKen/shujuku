import { describe, expect, it, vi } from 'vitest';
import { buildDefaultWorldSimulationSettings_ACU, buildEmptyWorldSimulationLedger_ACU } from '../../../../src/service/simulation/defaults';
import { runWorldSimulationWorkflow_ACU } from '../../../../src/service/simulation/agent/agent-workflow';
import { createWorldSimulationEvidenceRegistry_ACU, snapshotWorldSimulationEvidenceRegistry_ACU } from '../../../../src/service/simulation/world-simulation-evidence-registry';
import type { WorldSimulationLedger_ACU, WorldSimulationPendingFix_ACU } from '../../../../src/service/simulation/model';
import type { WorldSimulationSubagentOutcome_ACU } from '../../../../src/service/simulation/agent/agent-model';

function pending(module: WorldSimulationPendingFix_ACU['module'], attempts: number): WorldSimulationPendingFix_ACU {
  return {
    module,
    candidateId: `candidate:${module}`,
    agentName: module === 'clock' ? 'timekeeper' : module === 'guidance' ? 'guidance-composer' : 'undercurrent-analyst',
    violations: [{ path: `$.patch.${module}`, message: `${module} 待修复` }],
    attempts,
    firstFailedAtDay: 1,
    lastError: `${module} 待修复`,
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

  it('正文指纹未变且没有待修复项时不调用任何子代理', async () => {
    const env = harness(buildEmptyWorldSimulationLedger_ACU(), {});
    const result = await runWorldSimulationWorkflow_ACU({
      identity: env.identity, settings: env.settings, promptContext: env.promptContext, registry: env.registry, tools: env.tools,
      opening: { summary: '开局', focus: '时钟', dispatchChronicler: false, skipModules: [] },
      anchorMaterialsCommitted: true,
      subagents: env.subagents,
    });
    expect(env.subagents.run).not.toHaveBeenCalled();
    expect(result).toMatchObject({ outcome: 'no_change', pendingFixes: [] });
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
    expect(result.outcome).toBe('commit');
    expect(result.ledger.clock.day).toBe(2);
    expect(result.ledger.guidance.signals).toEqual([]);
    expect(result.pendingFixes).toEqual(expect.arrayContaining([expect.objectContaining({ module: 'guidance' })]));
  });

  it('自动修复成功后清除对应 pendingFix，且修复派工发生在常规派工之后', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.pendingFixes = [pending('clock', 1)];
    const fixed = {
      agentName: 'timekeeper', status: 'candidate' as const, summary: '修复时钟', evidenceRefs: [] as string[], uncertainties: [] as string[],
      candidate: {
        candidateId: 'run-workflow:timekeeper:2', agentName: 'timekeeper', patch: { clock: { days: 1, storyTime: '次日' } },
        summary: '修复时钟', evidenceRefs: [], uncertainties: [], writableModules: ['clock'],
      },
    };
    const env = harness(ledger, {
      timekeeper: [noChange('timekeeper'), fixed],
      'undercurrent-analyst': [noChange('undercurrent-analyst')],
      'dramatis-keeper': [noChange('dramatis-keeper')],
      'guidance-composer': [noChange('guidance-composer')],
    });
    const result = await runWorldSimulationWorkflow_ACU({
      identity: env.identity, settings: env.settings, promptContext: env.promptContext, registry: env.registry, tools: env.tools,
      opening: { summary: '开局', focus: '修复时钟', dispatchChronicler: false, skipModules: [] },
      subagents: env.subagents,
    });
    expect(env.calls.filter(name => name === 'timekeeper')).toEqual(['timekeeper', 'timekeeper']);
    expect(result.ledger.clock.storyTime).toBe('次日');
    expect(result.pendingFixes.some(item => item.module === 'clock')).toBe(false);
  });

  it('失败满 3 次或关闭自动修复时不派修复工，并升级主会话', async () => {
    const exhausted = buildEmptyWorldSimulationLedger_ACU();
    exhausted.pendingFixes = [pending('clock', 3)];
    const first = harness(exhausted, {
      timekeeper: [noChange('timekeeper')],
      'undercurrent-analyst': [noChange('undercurrent-analyst')],
      'dramatis-keeper': [noChange('dramatis-keeper')],
    });
    const escalated = await runWorldSimulationWorkflow_ACU({
      identity: first.identity, settings: first.settings, promptContext: first.promptContext, registry: first.registry, tools: first.tools,
      opening: { summary: '开局', focus: '时钟', dispatchChronicler: false, skipModules: [] },
      subagents: first.subagents,
    });
    expect(first.calls.filter(name => name === 'timekeeper')).toEqual(['timekeeper']);
    expect(escalated).toMatchObject({ outcome: 'escalate', escalated: true });

    const disabledLedger = buildEmptyWorldSimulationLedger_ACU();
    disabledLedger.pendingFixes = [pending('clock', 1)];
    const second = harness(disabledLedger, {
      timekeeper: [noChange('timekeeper')],
      'undercurrent-analyst': [noChange('undercurrent-analyst')],
      'dramatis-keeper': [noChange('dramatis-keeper')],
    });
    second.settings.workflow.autoFixEnabled = false;
    const disabled = await runWorldSimulationWorkflow_ACU({
      identity: second.identity, settings: second.settings, promptContext: second.promptContext, registry: second.registry, tools: second.tools,
      opening: { summary: '开局', focus: '时钟', dispatchChronicler: false, skipModules: [] },
      anchorMaterialsCommitted: true,
      subagents: second.subagents,
    });
    expect(second.calls.filter(name => name === 'timekeeper')).toEqual(['timekeeper']);
    expect(disabled.outcome).toBe('escalate');
  });
});
