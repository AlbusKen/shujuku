import { describe, expect, it, vi } from 'vitest';
import { buildDefaultWorldSimulationEnvelope_ACU, buildDefaultWorldSimulationSettings_ACU } from '../../../src/service/simulation/defaults';
import { buildDefaultWorldSimulationAgentPrompts_ACU } from '../../../src/service/simulation/agent/agent-defaults';
import { confirmWorldSimulationStageRevision_ACU, replaceWorldSimulationStagePlan_ACU, WorldSimulationStagePlanner_ACU } from '../../../src/service/simulation/simulation-stage-planner';
import { WorldSimulationStageExecutionEngine_ACU } from '../../../src/service/simulation/simulation-stage-execution-engine';
import { createWorldSimulationEvidenceRegistry_ACU, snapshotWorldSimulationEvidenceRegistry_ACU } from '../../../src/service/simulation/world-simulation-evidence-registry';

const apiPreset = { resolvePreset: () => ({ resolved: true, apiMode: 'openai' as any, apiConfig: {} as any, tavernProfile: '' }) };
const context = () => {
  const registry = createWorldSimulationEvidenceRegistry_ACU('stage');
  return { task: {}, history: [], runtimeContext: {}, agentCatalog: [], toolCatalog: [], evidence: [], userGuidance: '', worldState: {}, anchorMessage: '', anchorIdentity: {}, worldStagePlan: {}, worldChronicle: [], worldCandidates: [], evidenceRegistry: snapshotWorldSimulationEvidenceRegistry_ACU(registry), projectionPreview: {} };
};
const plan = { schemaVersion: 1 as const, title: '阶段', objective: '推进世界', impactScope: ['world'], factsToVerify: [], plannedTools: [], plannedSpecialists: [], expectedLedgerChanges: ['clock' as const], convergenceConditions: ['完成'], blockingConditions: [], completedSteps: [], nextStep: '执行' };

describe('世界推演阶段 runtime', () => {
  it('生成、确认并冻结阶段 revision', async () => {
    const settings = { ...buildDefaultWorldSimulationSettings_ACU(), agentPrompts: buildDefaultWorldSimulationAgentPrompts_ACU() };
    const planner = new WorldSimulationStagePlanner_ACU({ apiPreset, countTokens: async () => 1, invoke: async () => JSON.stringify({ action: 'plan', summary: 'ok', plan }) });
    const result = await planner.plan({ settings, promptContext: context(), now: 10 });
    expect(result.revision).toMatchObject({ revision: 1, createdAt: 10, reason: 'initial', frozen: false });
    const frozen = confirmWorldSimulationStageRevision_ACU(result.revision);
    expect(frozen.frozen).toBe(true);
    expect(() => replaceWorldSimulationStagePlan_ACU(frozen, plan)).toThrow('WORLD_SIMULATION_STAGE_REVISION_FROZEN');
  });

  it('执行引擎在主循环前后复核冻结身份与锚点', async () => {
    const identity = {
      runId: 'run-1', chatIdentity: 'chat-1', triggerKind: 'assistant_completed' as const,
      triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1',
      anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0,
      taskId: 'task-1', stageId: 'stage-1', stageRevision: 1,
    };
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.task = { taskId: 'task-1', originInstruction: '推进', status: 'running', createdAt: 1, updatedAt: 1, activeRun: identity, stopReason: null };
    envelope.activeStageId = 'stage-1';
    envelope.stages = [{ stageId: 'stage-1', stageNumber: 1, status: 'running', activeRevision: 1, revisions: [{ revision: 1, createdAt: 1, reason: 'initial', replanInstruction: '', frozen: true, plan }] }];
    const runMainLoop = vi.fn(async () => ({ outcome: 'blocked' as const, summary: 'done', unresolved: ['x'], outcomes: [] }));
    const assertAnchorCurrent = vi.fn();
    const engine = new WorldSimulationStageExecutionEngine_ACU({ readEnvelope: () => envelope, getChatIdentity: () => 'chat-1', assertAnchorCurrent, runMainLoop });
    await expect(engine.run({ identity })).resolves.toMatchObject({ outcome: 'blocked' });
    expect(runMainLoop).toHaveBeenCalledOnce();
    expect(assertAnchorCurrent).toHaveBeenCalledTimes(2);
  });

  it('身份或 ledger revision 过期时在主循环前 fail-closed', async () => {
    const identity = {
      runId: 'run-1', chatIdentity: 'chat-1', triggerKind: 'assistant_completed' as const,
      triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1',
      anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0,
      taskId: 'task-1', stageId: 'stage-1', stageRevision: 1,
    };
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.ledger.revision = 1;
    envelope.task = { taskId: 'task-1', originInstruction: '推进', status: 'running', createdAt: 1, updatedAt: 1, activeRun: identity, stopReason: null };
    envelope.activeStageId = 'stage-1';
    envelope.stages = [{ stageId: 'stage-1', stageNumber: 1, status: 'running', activeRevision: 1, revisions: [{ revision: 1, createdAt: 1, reason: 'initial', replanInstruction: '', frozen: true, plan }] }];
    const runMainLoop = vi.fn();
    const engine = new WorldSimulationStageExecutionEngine_ACU({ readEnvelope: () => envelope, getChatIdentity: () => 'chat-1', assertAnchorCurrent: vi.fn(), runMainLoop });
    await expect(engine.run({ identity })).rejects.toThrow('WORLD_SIMULATION_LEDGER_STALE');
    expect(runMainLoop).not.toHaveBeenCalled();
  });
});
