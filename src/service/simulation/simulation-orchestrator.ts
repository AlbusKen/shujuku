import { buildDefaultWorldSimulationEnvelope_ACU } from './defaults';
import type { WorldSimulationAnchorIdentity_ACU, WorldSimulationCommitCandidate_ACU, WorldSimulationMainLoopResult_ACU } from './agent/agent-model';
import {
  createWorldSimulationError_ACU,
  WorldSimulationValidationError_ACU,
  type WorldSimulationEnvelope_ACU,
  type WorldSimulationError_ACU,
  type WorldSimulationRunIdentity_ACU,
  type WorldSimulationStagePlan_ACU,
  type WorldSimulationStageRevision_ACU,
  type WorldSimulationTriggerKind_ACU,
} from './model';

export interface WorldSimulationStorePort_ACU {
  read(): WorldSimulationEnvelope_ACU | null;
  updateAtomically(mutator: (current: WorldSimulationEnvelope_ACU | null) => WorldSimulationEnvelope_ACU, guard?: { chatIdentity: string; taskId?: string | null; stageId?: string | null; revision?: number | null }): Promise<void>;
}
export interface WorldSimulationPreparedRun_ACU {
  revision: WorldSimulationStageRevision_ACU;
  alreadyFrozen?: boolean;
  execute(identity: WorldSimulationRunIdentity_ACU): Promise<WorldSimulationMainLoopResult_ACU>;
}
export interface WorldSimulationOrchestratorDependencies_ACU {
  store: WorldSimulationStorePort_ACU;
  now(): number;
  allocateId(kind: 'task' | 'stage' | 'run' | 'timeline'): string;
  prepare(input: { identity: WorldSimulationRunIdentity_ACU; anchor: WorldSimulationAnchorIdentity_ACU; instruction: string; envelope: WorldSimulationEnvelope_ACU; signal: AbortSignal; previous?: WorldSimulationStageRevision_ACU | null; reason?: WorldSimulationStageRevision_ACU['reason']; replanInstruction?: string }): Promise<WorldSimulationPreparedRun_ACU>;
  assertAnchorCurrent(anchor: WorldSimulationAnchorIdentity_ACU): void | Promise<void>;
  appendUserMessage?(input: { identity: WorldSimulationRunIdentity_ACU; anchor: WorldSimulationAnchorIdentity_ACU; text: string }): Promise<void>;
  commitProjection(input: { identity: WorldSimulationRunIdentity_ACU; anchor: WorldSimulationAnchorIdentity_ACU; commitCandidate: WorldSimulationCommitCandidate_ACU; completedAt: number; timelineId: string }): Promise<void>;
}
export type WorldSimulationOrchestratorResult_ACU =
  | { status: 'skipped'; reason: 'disabled' | 'duplicate' | 'busy' }
  | { status: 'awaiting_plan_review'; identity: WorldSimulationRunIdentity_ACU }
  | { status: 'completed'; identity: WorldSimulationRunIdentity_ACU; result: WorldSimulationMainLoopResult_ACU }
  | { status: 'cancelled'; identity: WorldSimulationRunIdentity_ACU }
  | { status: 'failed'; identity: WorldSimulationRunIdentity_ACU; error: WorldSimulationError_ACU };

const placeholderPlan_ACU: WorldSimulationStagePlan_ACU = {
  schemaVersion: 1,
  title: '准备世界推演',
  objective: '生成阶段计划',
  impactScope: [],
  factsToVerify: [],
  plannedTools: [],
  plannedSpecialists: [],
  expectedLedgerChanges: [],
  convergenceConditions: [],
  blockingConditions: [],
  completedSteps: [],
  nextStep: '规划',
};
const abortByChat_ACU = new Map<string, AbortController>();

const activeTaskStatuses_ACU = new Set(['drafting', 'awaiting_plan_review', 'running', 'stopping_after_inflight', 'paused']);

function sameTrigger_ACU(
  run: WorldSimulationRunIdentity_ACU | null,
  input: { triggerKind: WorldSimulationTriggerKind_ACU; anchor: WorldSimulationAnchorIdentity_ACU; triggerConversationMessageId?: string | null },
): boolean {
  if (!run || run.triggerKind !== input.triggerKind) return false;
  if (run.chatIdentity !== input.anchor.chatIdentity || run.anchorMessageKey !== input.anchor.messageKey || run.anchorSwipeId !== input.anchor.swipeId || run.anchorContentDigest !== input.anchor.contentDigest) return false;
  return input.triggerKind === 'assistant_completed'
    || run.triggerConversationMessageId === (input.triggerConversationMessageId ?? null);
}

function assertRunCurrent_ACU(envelope: WorldSimulationEnvelope_ACU | null, identity: WorldSimulationRunIdentity_ACU): void {
  const active = envelope?.task?.activeRun;
  if (!active || envelope?.task?.taskId !== identity.taskId || active.runId !== identity.runId) throw new Error('WORLD_SIMULATION_RUN_STALE');
  if (envelope.activeStageId !== identity.stageId || active.stageRevision !== identity.stageRevision) throw new Error('WORLD_SIMULATION_STAGE_STALE');
  if (envelope.ledger.revision !== identity.baseLedgerRevision) throw new Error('WORLD_SIMULATION_LEDGER_STALE');
}

function errorFromUnknown_ACU(error: unknown): WorldSimulationError_ACU {
  if (error instanceof WorldSimulationValidationError_ACU) return error.error;
  return createWorldSimulationError_ACU(
    'WORLD_SIMULATION_REVISION_CONFLICT',
    'agent_loop',
    error instanceof Error ? error.message : String(error),
    false,
  );
}

export class WorldSimulationOrchestrator_ACU {
  constructor(private readonly dependencies: WorldSimulationOrchestratorDependencies_ACU) {}

  cancel(chatIdentity: string): boolean {
    const controller = abortByChat_ACU.get(chatIdentity);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  async start(input: { triggerKind: WorldSimulationTriggerKind_ACU; anchor: WorldSimulationAnchorIdentity_ACU; instruction: string; triggerConversationMessageId?: string | null }): Promise<WorldSimulationOrchestratorResult_ACU> {
    const existing = this.dependencies.store.read();
    if (input.triggerKind === 'assistant_completed' && existing && !existing.settings.autoTriggerEnabled) return { status: 'skipped', reason: 'disabled' };
    if (sameTrigger_ACU(existing?.task?.activeRun ?? null, input)) return { status: 'skipped', reason: 'duplicate' };
    if (abortByChat_ACU.has(input.anchor.chatIdentity)) return { status: 'skipped', reason: 'busy' };
    if (existing?.task && activeTaskStatuses_ACU.has(existing.task.status)) return { status: 'skipped', reason: 'busy' };

    return this.runNew_ACU(input, existing);
  }

  async resume(input: { anchor: WorldSimulationAnchorIdentity_ACU; instruction?: string }): Promise<WorldSimulationOrchestratorResult_ACU> {
    const envelope = this.dependencies.store.read();
    const identity = envelope?.task?.activeRun;
    if (!envelope?.task || !identity || envelope.activeStageId !== identity.stageId) return { status: 'skipped', reason: 'duplicate' };
    if (identity.chatIdentity !== input.anchor.chatIdentity || identity.anchorMessageKey !== input.anchor.messageKey || identity.anchorSwipeId !== input.anchor.swipeId || identity.anchorContentDigest !== input.anchor.contentDigest) return { status: 'skipped', reason: 'duplicate' };
    if (abortByChat_ACU.has(identity.chatIdentity)) return { status: 'skipped', reason: 'busy' };

    const controller = new AbortController();
    abortByChat_ACU.set(identity.chatIdentity, controller);
    try {
      await this.dependencies.assertAnchorCurrent(input.anchor);
      assertRunCurrent_ACU(envelope, identity);
      const prepared = await this.dependencies.prepare({ identity, anchor: input.anchor, instruction: input.instruction ?? envelope.task.originInstruction, envelope, signal: controller.signal });
      return await this.persistPlanAndMaybeExecute_ACU(identity, input.anchor, prepared, controller.signal, true);
    } catch (error) {
      return this.finishFailure_ACU(identity, error, controller.signal.aborted);
    } finally {
      if (abortByChat_ACU.get(identity.chatIdentity) === controller) abortByChat_ACU.delete(identity.chatIdentity);
    }
  }

  async replan(input: { anchor: WorldSimulationAnchorIdentity_ACU; instruction: string }): Promise<WorldSimulationOrchestratorResult_ACU> {
    const envelope = this.dependencies.store.read();
    const identity = envelope?.task?.activeRun;
    const instruction = input.instruction.trim();
    if (!envelope?.task || !identity || envelope.task.status !== 'awaiting_plan_review' || envelope.activeStageId !== identity.stageId) {
      return { status: 'skipped', reason: 'duplicate' };
    }
    if (!instruction) {
      throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
        'WORLD_SIMULATION_CONFIG_INVALID', 'persist', '重规划指令不能为空', false,
      ));
    }
    if (abortByChat_ACU.has(identity.chatIdentity)) return { status: 'skipped', reason: 'busy' };
    const stage = envelope.stages.find(item => item.stageId === identity.stageId);
    const previous = stage?.revisions.find(item => item.revision === stage.activeRevision) ?? null;
    if (!stage || !previous || previous.revision !== identity.stageRevision) {
      throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
        'WORLD_SIMULATION_REVISION_CONFLICT', 'persist', '待重规划阶段 revision 已变化', false,
      ));
    }

    const controller = new AbortController();
    abortByChat_ACU.set(identity.chatIdentity, controller);
    try {
      await this.dependencies.assertAnchorCurrent(input.anchor);
      assertRunCurrent_ACU(envelope, identity);
      const prepared = await this.dependencies.prepare({
        identity,
        anchor: input.anchor,
        instruction,
        envelope,
        signal: controller.signal,
        previous,
        reason: 'manual_replan',
        replanInstruction: instruction,
      });
      return await this.persistPlanAndMaybeExecute_ACU(identity, input.anchor, prepared, controller.signal, false);
    } catch (error) {
      return this.finishFailure_ACU(identity, error, controller.signal.aborted);
    } finally {
      if (abortByChat_ACU.get(identity.chatIdentity) === controller) abortByChat_ACU.delete(identity.chatIdentity);
    }
  }

  private async runNew_ACU(
    input: { triggerKind: WorldSimulationTriggerKind_ACU; anchor: WorldSimulationAnchorIdentity_ACU; instruction: string; triggerConversationMessageId?: string | null },
    existing: WorldSimulationEnvelope_ACU | null,
  ): Promise<WorldSimulationOrchestratorResult_ACU> {
    const controller = new AbortController();
    abortByChat_ACU.set(input.anchor.chatIdentity, controller);
    const now = this.dependencies.now();
    const taskId = this.dependencies.allocateId('task');
    const stageId = this.dependencies.allocateId('stage');
    const identity: WorldSimulationRunIdentity_ACU = {
      runId: this.dependencies.allocateId('run'),
      chatIdentity: input.anchor.chatIdentity,
      triggerKind: input.triggerKind,
      triggerConversationMessageId: input.triggerConversationMessageId ?? null,
      anchorMessageId: input.anchor.messageId,
      anchorMessageKey: input.anchor.messageKey,
      anchorSwipeId: input.anchor.swipeId,
      anchorContentDigest: input.anchor.contentDigest,
      baseLedgerRevision: existing?.ledger.revision ?? 0,
      taskId,
      stageId,
      stageRevision: 1,
    };

    try {
      await this.dependencies.assertAnchorCurrent(input.anchor);
      await this.dependencies.store.updateAtomically(current => {
        const envelope = current ?? buildDefaultWorldSimulationEnvelope_ACU();
        if (envelope.task && activeTaskStatuses_ACU.has(envelope.task.status)) throw new Error('WORLD_SIMULATION_TASK_BUSY');
        const reservation = { revision: 1, createdAt: now, reason: 'initial' as const, replanInstruction: '', frozen: false, plan: placeholderPlan_ACU };
        return {
          ...envelope,
          task: { taskId, originInstruction: input.instruction, status: 'drafting', createdAt: now, updatedAt: now, activeRun: identity, stopReason: null },
          stages: [{ stageId, stageNumber: 1, status: 'planning', activeRevision: 1, revisions: [reservation] }],
          activeStageId: stageId,
          timeline: [...envelope.timeline, { id: this.dependencies.allocateId('timeline'), at: now, kind: 'task_created', taskId, stageId, revision: 1, runId: identity.runId }],
          lastError: null,
          updatedAt: now,
        };
      }, { chatIdentity: identity.chatIdentity });

      if (input.triggerKind === 'agent_chat_message' && this.dependencies.appendUserMessage) {
        await this.dependencies.appendUserMessage({ identity, anchor: input.anchor, text: input.instruction });
      }
      const reserved = this.dependencies.store.read();
      assertRunCurrent_ACU(reserved, identity);
      await this.dependencies.assertAnchorCurrent(input.anchor);
      if (controller.signal.aborted) throw new Error('WORLD_SIMULATION_ABORTED');
      const prepared = await this.dependencies.prepare({ identity, anchor: input.anchor, instruction: input.instruction, envelope: reserved!, signal: controller.signal });
      return await this.persistPlanAndMaybeExecute_ACU(identity, input.anchor, prepared, controller.signal, false);
    } catch (error) {
      return this.finishFailure_ACU(identity, error, controller.signal.aborted);
    } finally {
      if (abortByChat_ACU.get(identity.chatIdentity) === controller) abortByChat_ACU.delete(identity.chatIdentity);
    }
  }

  private async persistPlanAndMaybeExecute_ACU(
    reservedIdentity: WorldSimulationRunIdentity_ACU,
    anchor: WorldSimulationAnchorIdentity_ACU,
    prepared: WorldSimulationPreparedRun_ACU,
    signal: AbortSignal,
    forceExecute: boolean,
  ): Promise<WorldSimulationOrchestratorResult_ACU> {
    if (signal.aborted) throw new Error('WORLD_SIMULATION_ABORTED');
    await this.dependencies.assertAnchorCurrent(anchor);
    assertRunCurrent_ACU(this.dependencies.store.read(), reservedIdentity);
    const current = this.dependencies.store.read()!;
    const shouldAwaitReview = current.settings.planPreview && !forceExecute && !prepared.alreadyFrozen;
    const revision = shouldAwaitReview || prepared.revision.frozen ? prepared.revision : { ...prepared.revision, frozen: true };
    const identity = { ...reservedIdentity, stageRevision: revision.revision };
    const now = this.dependencies.now();

    await this.dependencies.store.updateAtomically(envelope => {
      assertRunCurrent_ACU(envelope, reservedIdentity);
      const stage = envelope!.stages.find(item => item.stageId === reservedIdentity.stageId)!;
      return {
        ...envelope!,
        task: { ...envelope!.task!, status: shouldAwaitReview ? 'awaiting_plan_review' : 'running', updatedAt: now, activeRun: identity },
        stages: envelope!.stages.map(item => item.stageId === stage.stageId ? { ...item, status: shouldAwaitReview ? 'awaiting_review' : 'running', activeRevision: revision.revision, revisions: [revision] } : item),
        timeline: [
          ...envelope!.timeline,
          { id: this.dependencies.allocateId('timeline'), at: now, kind: 'plan_ready', taskId: identity.taskId, stageId: identity.stageId, revision: identity.stageRevision, runId: identity.runId },
          ...(shouldAwaitReview ? [] : [
            { id: this.dependencies.allocateId('timeline'), at: now, kind: 'plan_confirmed' as const, taskId: identity.taskId, stageId: identity.stageId, revision: identity.stageRevision, runId: identity.runId },
            { id: this.dependencies.allocateId('timeline'), at: now, kind: 'stage_started' as const, taskId: identity.taskId, stageId: identity.stageId, revision: identity.stageRevision, runId: identity.runId },
          ]),
        ],
        updatedAt: now,
      };
    }, { chatIdentity: identity.chatIdentity, taskId: identity.taskId, stageId: identity.stageId, revision: reservedIdentity.stageRevision });

    if (shouldAwaitReview) return { status: 'awaiting_plan_review', identity };
    if (signal.aborted) throw new Error('WORLD_SIMULATION_ABORTED');
    const result = await prepared.execute(identity);
    await this.dependencies.assertAnchorCurrent(anchor);
    const completedAt = this.dependencies.now();
    if (result.outcome === 'commit') {
      await this.dependencies.commitProjection({
        identity,
        anchor,
        commitCandidate: result.commitCandidate,
        completedAt,
        timelineId: this.dependencies.allocateId('timeline'),
      });
      return { status: 'completed', identity, result };
    }
    await this.dependencies.store.updateAtomically(envelope => {
      assertRunCurrent_ACU(envelope, identity);
      const awaiting = result.outcome === 'awaiting_plan_review' || result.outcome === 'stage_replanned';
      const blocked = result.outcome === 'blocked';
      return {
        ...envelope!,
        task: { ...envelope!.task!, status: awaiting ? 'awaiting_plan_review' : blocked ? 'paused' : 'completed', updatedAt: completedAt, activeRun: awaiting || blocked ? envelope!.task!.activeRun : null, stopReason: blocked ? result.summary : null },
        stages: envelope!.stages.map(stage => stage.stageId === identity.stageId ? { ...stage, status: awaiting ? 'awaiting_review' : blocked ? 'failed' : 'completed' } : stage),
        timeline: [...envelope!.timeline, { id: this.dependencies.allocateId('timeline'), at: completedAt, kind: awaiting ? 'stage_replanned' : blocked ? 'blocked' : 'no_change', taskId: identity.taskId, stageId: identity.stageId, revision: identity.stageRevision, runId: identity.runId, message: result.summary }],
        updatedAt: completedAt,
      };
    }, { chatIdentity: identity.chatIdentity, taskId: identity.taskId, stageId: identity.stageId, revision: identity.stageRevision });
    return { status: 'completed', identity, result };
  }

  private async finishFailure_ACU(identity: WorldSimulationRunIdentity_ACU, cause: unknown, cancelled: boolean): Promise<WorldSimulationOrchestratorResult_ACU> {
    const error = errorFromUnknown_ACU(cause);
    const now = this.dependencies.now();
    try {
      await this.dependencies.store.updateAtomically(envelope => {
        const active = envelope?.task?.activeRun;
        if (!envelope?.task || !active || active.runId !== identity.runId) throw new Error('WORLD_SIMULATION_RUN_STALE');
        return {
          ...envelope,
          task: { ...envelope.task, status: cancelled ? 'abandoned' : 'failed', updatedAt: now, activeRun: null, stopReason: cancelled ? 'cancelled' : error.message },
          stages: envelope.stages.map(stage => stage.stageId === identity.stageId ? { ...stage, status: cancelled ? 'abandoned' : 'failed' } : stage),
          timeline: [...envelope.timeline, { id: this.dependencies.allocateId('timeline'), at: now, kind: cancelled ? 'stopped' : 'failed', taskId: identity.taskId, stageId: identity.stageId, revision: identity.stageRevision, runId: identity.runId, message: cancelled ? 'cancelled' : error.message, ...(cancelled ? {} : { errorCode: error.code }) }],
          lastError: cancelled ? null : error,
          updatedAt: now,
        };
      }, { chatIdentity: identity.chatIdentity, taskId: identity.taskId });
    } catch {
      // A newer task or revision owns the envelope. Late failure must not overwrite it.
    }
    return cancelled ? { status: 'cancelled', identity } : { status: 'failed', identity, error };
  }
}
