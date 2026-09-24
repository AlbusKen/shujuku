import type { WorldSimulationEnvelope_ACU, WorldSimulationRunIdentity_ACU } from './model';
import type { WorldSimulationMainLoopResult_ACU } from './agent/agent-model';
import type { WorldSimulationRunWriteState_ACU } from './simulation-run-write-state';

export interface WorldSimulationStageExecutionDependencies_ACU<TInput> {
  readEnvelope(): WorldSimulationEnvelope_ACU | null;
  runWrites?: WorldSimulationRunWriteState_ACU;
  getChatIdentity(): string;
  assertAnchorCurrent(identity: WorldSimulationRunIdentity_ACU): void | Promise<void>;
  runMainLoop(input: TInput): Promise<WorldSimulationMainLoopResult_ACU>;
}

function assertIdentity_ACU(envelope: WorldSimulationEnvelope_ACU | null, chatIdentity: string, identity: WorldSimulationRunIdentity_ACU, runWrites?: WorldSimulationRunWriteState_ACU): void {
  if (!envelope?.task || envelope.task.taskId !== identity.taskId) throw new Error('WORLD_SIMULATION_TASK_STALE');
  if (chatIdentity !== identity.chatIdentity) throw new Error('WORLD_SIMULATION_CHAT_STALE');
  const active = envelope.task.activeRun;
  if (!active || active.runId !== identity.runId || active.anchorMessageKey !== identity.anchorMessageKey || active.anchorSwipeId !== identity.anchorSwipeId || active.anchorContentDigest !== identity.anchorContentDigest) throw new Error('WORLD_SIMULATION_RUN_STALE');
  const stage = envelope.stages.find(item => item.stageId === identity.stageId);
  const revision = stage?.revisions.find(item => item.revision === identity.stageRevision);
  if (!stage || stage.activeRevision !== identity.stageRevision || !revision?.frozen) throw new Error('WORLD_SIMULATION_STAGE_STALE');
  if (runWrites) {
    runWrites.assertCurrent();
    if (runWrites.currentLedgerRevision !== envelope.ledger.revision) throw new Error('WORLD_SIMULATION_LEDGER_STALE');
  } else if (envelope.ledger.revision !== identity.baseLedgerRevision) throw new Error('WORLD_SIMULATION_LEDGER_STALE');
  if (envelope.task.status !== 'running' || stage.status !== 'running') throw new Error('WORLD_SIMULATION_RUN_NOT_RUNNING');
}

export class WorldSimulationStageExecutionEngine_ACU<TInput extends { identity: WorldSimulationRunIdentity_ACU }> {
  constructor(private readonly dependencies: WorldSimulationStageExecutionDependencies_ACU<TInput>) {}

  async run(input: TInput): Promise<WorldSimulationMainLoopResult_ACU> {
    assertIdentity_ACU(this.dependencies.readEnvelope(), this.dependencies.getChatIdentity(), input.identity, this.dependencies.runWrites);
    await this.dependencies.assertAnchorCurrent(input.identity);
    const result = await this.dependencies.runMainLoop(input);
    assertIdentity_ACU(this.dependencies.readEnvelope(), this.dependencies.getChatIdentity(), input.identity, this.dependencies.runWrites);
    await this.dependencies.assertAnchorCurrent(input.identity);
    return result;
  }
}
