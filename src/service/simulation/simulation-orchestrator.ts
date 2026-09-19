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
import { endWorldSimulationSessionRun_ACU } from './agent/agent-session-log';

export interface WorldSimulationStorePort_ACU {
  read(): WorldSimulationEnvelope_ACU | null;
  updateAtomically(mutator: (current: WorldSimulationEnvelope_ACU | null) => WorldSimulationEnvelope_ACU, guard?: { chatIdentity: string; taskId?: string | null; stageId?: string | null; revision?: number | null }): Promise<void>;
}
export interface WorldSimulationPreparedRun_ACU {
  revision: WorldSimulationStageRevision_ACU;
  execute(identity: WorldSimulationRunIdentity_ACU): Promise<WorldSimulationMainLoopResult_ACU>;
}
export interface WorldSimulationOrchestratorDependencies_ACU {
  store: WorldSimulationStorePort_ACU;
  now(): number;
  allocateId(kind: 'task' | 'stage' | 'run' | 'timeline'): string;
  prepare(input: { identity: WorldSimulationRunIdentity_ACU; anchor: WorldSimulationAnchorIdentity_ACU; instruction: string; envelope: WorldSimulationEnvelope_ACU; signal: AbortSignal }): Promise<WorldSimulationPreparedRun_ACU>;
  assertAnchorCurrent(anchor: WorldSimulationAnchorIdentity_ACU): void | Promise<void>;
  appendUserMessage?(input: { identity: WorldSimulationRunIdentity_ACU; anchor: WorldSimulationAnchorIdentity_ACU; text: string; idempotent?: boolean }): Promise<void>;
  commitProjection(input: { identity: WorldSimulationRunIdentity_ACU; anchor: WorldSimulationAnchorIdentity_ACU; commitCandidate: WorldSimulationCommitCandidate_ACU; completedAt: number; timelineId: string }): Promise<void>;
}
/**
 * skipped 的各原因：
 * - disabled：自动触发已关闭；
 * - duplicate：同一冻结锚点已有本次运行（在途或暂停中），不重复调用模型；
 * - busy：当前聊天有在途运行，且本次不是可排队的自动触发；
 * - queued：自动触发到达时有在途运行，已登记为待执行，在途运行结算后自动开始。
 */
export type WorldSimulationOrchestratorResult_ACU =
  | { status: 'skipped'; reason: 'disabled' | 'duplicate' | 'busy' | 'queued' }
  | { status: 'completed'; identity: WorldSimulationRunIdentity_ACU; result: WorldSimulationMainLoopResult_ACU }
  | { status: 'cancelled'; identity: WorldSimulationRunIdentity_ACU }
  | { status: 'failed'; identity: WorldSimulationRunIdentity_ACU; error: WorldSimulationError_ACU };

export interface WorldSimulationStartInput_ACU {
  triggerKind: WorldSimulationTriggerKind_ACU;
  anchor: WorldSimulationAnchorIdentity_ACU;
  instruction: string;
  triggerConversationMessageId?: string | null;
}

/** 手动停止 / 页面重载中断 / 被更新楼层取代 三种非模型终局的稳定 stopReason。 */
export const WORLD_SIMULATION_STOP_REASON_MANUAL_ACU = 'manual';
export const WORLD_SIMULATION_STOP_REASON_INTERRUPTED_ACU = 'interrupted';
export const WORLD_SIMULATION_STOP_REASON_SUPERSEDED_ACU = 'superseded';

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
/** 在途运行的结算 Promise：interrupt 需要等它落盘后才能安全地 resume / 取代。 */
const inflightByChat_ACU = new Map<string, Promise<WorldSimulationOrchestratorResult_ACU>>();
/** 在途期间到达的自动触发只保留最新一次：更早楼层的推演在更新楼层出现后已无意义。 */
const pendingAutoByChat_ACU = new Map<string, { anchor: WorldSimulationAnchorIdentity_ACU; instruction: string }>();
/** 本次在途运行是被用户主动停止/打断的：结算后不得排空 pending 自动触发，否则用户刚停就被自动重启。 */
const manualStopByChat_ACU = new Set<string>();

/** 测试隔离：模块级在途 / 排队 / 手停登记按 chatIdentity 共享，用例之间必须清空。 */
export function resetWorldSimulationOrchestratorStateForTests_ACU(): void {
  for (const controller of abortByChat_ACU.values()) controller.abort();
  abortByChat_ACU.clear();
  inflightByChat_ACU.clear();
  pendingAutoByChat_ACU.clear();
  manualStopByChat_ACU.clear();
}

/** 这些状态表示"任务在跑"——但只有内存里确有 AbortController 才是真在途，否则是重载后的僵死态。 */
const inflightTaskStatuses_ACU = new Set(['drafting', 'running', 'stopping_after_inflight']);
/** 已终结、不再持有运行身份的任务状态。 */
const terminalTaskStatuses_ACU = new Set(['completed', 'failed', 'abandoned']);

function sameAnchor_ACU(run: WorldSimulationRunIdentity_ACU, anchor: WorldSimulationAnchorIdentity_ACU): boolean {
  return run.chatIdentity === anchor.chatIdentity
    && run.anchorMessageKey === anchor.messageKey
    && run.anchorSwipeId === anchor.swipeId
    && run.anchorContentDigest === anchor.contentDigest;
}

function sameTrigger_ACU(run: WorldSimulationRunIdentity_ACU | null, input: WorldSimulationStartInput_ACU): boolean {
  if (!run || run.triggerKind !== input.triggerKind) return false;
  if (!sameAnchor_ACU(run, input.anchor)) return false;
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

  /** 当前聊天是否有真正在途的运行（内存里持有 AbortController）。 */
  isInFlight(chatIdentity: string): boolean {
    return abortByChat_ACU.has(chatIdentity);
  }

  /**
   * 请求停止在途运行。只发 abort 信号，不等待结算；结算后任务落为 paused/manual 并保留 activeRun，
   * 用户随后发送任意消息或点恢复即可从持久化的 run state 继续。
   * @returns 是否确有在途运行被要求停止
   */
  cancel(chatIdentity: string): boolean {
    const controller = abortByChat_ACU.get(chatIdentity);
    if (!controller) return false;
    manualStopByChat_ACU.add(chatIdentity);
    pendingAutoByChat_ACU.delete(chatIdentity);
    controller.abort();
    return true;
  }

  /**
   * 停止在途运行并等待其落盘结算。与 cancel 的区别是返回时 abort/inflight 登记已清理，
   * 调用方可以立刻 resume 或 start 而不会撞上 busy。
   * @returns 是否确有在途运行被打断
   */
  async interrupt(chatIdentity: string): Promise<boolean> {
    const inflight = inflightByChat_ACU.get(chatIdentity);
    const cancelled = this.cancel(chatIdentity);
    if (inflight) await inflight.catch((): void => undefined);
    return cancelled;
  }

  /**
   * 派生视图：持久化里写着 running/drafting，但当前聊天没有在途运行（脚本重载、事件丢失），
   * 这份"运行中"是僵死态。对 UI 与后续判定一律按 paused/interrupted 处理，但不落盘——
   * 真在途的运行仍持有自己的 identity，落盘会与它的写入竞争。
   */
  deriveEnvelopeView(envelope: WorldSimulationEnvelope_ACU | null): WorldSimulationEnvelope_ACU | null {
    const task = envelope?.task;
    if (!envelope || !task || !inflightTaskStatuses_ACU.has(task.status)) return envelope;
    const chatIdentity = task.activeRun?.chatIdentity;
    if (chatIdentity && this.isInFlight(chatIdentity)) return envelope;
    return { ...envelope, task: { ...task, status: 'paused', stopReason: WORLD_SIMULATION_STOP_REASON_INTERRUPTED_ACU } };
  }

  async start(input: WorldSimulationStartInput_ACU): Promise<WorldSimulationOrchestratorResult_ACU> {
    const persisted = this.dependencies.store.read();
    if (input.triggerKind === 'assistant_completed' && persisted && !persisted.settings.autoTriggerEnabled) return { status: 'skipped', reason: 'disabled' };
    const chatIdentity = input.anchor.chatIdentity;
    if (this.isInFlight(chatIdentity)) {
      const active = persisted?.task?.activeRun ?? null;
      if (sameTrigger_ACU(active, input)) return { status: 'skipped', reason: 'duplicate' };
      if (input.triggerKind === 'assistant_completed') {
        pendingAutoByChat_ACU.set(chatIdentity, { anchor: input.anchor, instruction: input.instruction });
        return { status: 'skipped', reason: 'queued' };
      }
      return { status: 'skipped', reason: 'busy' };
    }
    const existing = this.deriveEnvelopeView(persisted);
    const pausedRun = existing?.task?.status === 'paused' ? existing.task.activeRun : null;
    if (pausedRun && sameAnchor_ACU(pausedRun, input.anchor)) {
      // 同一楼层已有一次未完成的运行：自动触发属于重复事件；手动消息应由 runtime 走 resume 续接。
      return { status: 'skipped', reason: input.triggerKind === 'assistant_completed' ? 'duplicate' : 'busy' };
    }
    return this.runNew_ACU(input, existing, pausedRun ? existing!.task!.taskId : null);
  }

  async resume(input: { anchor: WorldSimulationAnchorIdentity_ACU; instruction?: string }): Promise<WorldSimulationOrchestratorResult_ACU> {
    const envelope = this.deriveEnvelopeView(this.dependencies.store.read());
    const identity = envelope?.task?.activeRun;
    if (!envelope?.task || !identity || envelope.activeStageId !== identity.stageId) return { status: 'skipped', reason: 'duplicate' };
    if (!sameAnchor_ACU(identity, input.anchor)) return { status: 'skipped', reason: 'duplicate' };
    if (this.isInFlight(identity.chatIdentity)) return { status: 'skipped', reason: 'busy' };

    const controller = new AbortController();
    abortByChat_ACU.set(identity.chatIdentity, controller);
    const instruction = typeof input.instruction === 'string' && input.instruction.trim() ? input.instruction.trim() : '';
    const completion = (async (): Promise<WorldSimulationOrchestratorResult_ACU> => {
      try {
        await this.dependencies.assertAnchorCurrent(input.anchor);
        assertRunCurrent_ACU(envelope, identity);
        if (instruction && this.dependencies.appendUserMessage) {
          await this.dependencies.appendUserMessage({ identity, anchor: input.anchor, text: instruction, idempotent: true });
        }
        if (controller.signal.aborted) throw new Error('WORLD_SIMULATION_ABORTED');
        const prepared = await this.dependencies.prepare({ identity, anchor: input.anchor, instruction: instruction || envelope.task!.originInstruction, envelope, signal: controller.signal });
        return await this.persistPlanAndExecute_ACU(identity, input.anchor, prepared, controller.signal);
      } catch (error) {
        return this.finishFailure_ACU(identity, error, controller.signal.aborted);
      }
    })();
    return this.trackInflight_ACU(identity.chatIdentity, controller, completion);
  }

  private async runNew_ACU(
    input: WorldSimulationStartInput_ACU,
    existing: WorldSimulationEnvelope_ACU | null,
    supersededTaskId: string | null,
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

    const completion = (async (): Promise<WorldSimulationOrchestratorResult_ACU> => {
      try {
        await this.dependencies.assertAnchorCurrent(input.anchor);
        await this.dependencies.store.updateAtomically(current => {
          const envelope = current ?? buildDefaultWorldSimulationEnvelope_ACU();
          const previous = envelope.task;
          // start() 已在同步路径上以 isInFlight 判忙并登记了本次 controller，这里不可能再有别的在途运行。
          // 旧任务若仍持有 activeRun（paused / 僵死 running），说明它被本次更新楼层的运行取代，留痕后替换。
          const superseded = !!previous && previous.activeRun !== null && (previous.taskId === supersededTaskId || !terminalTaskStatuses_ACU.has(previous.status));
          const supersededTimeline = superseded && previous
            ? [{ id: this.dependencies.allocateId('timeline'), at: now, kind: 'stopped' as const, taskId: previous.taskId, stageId: envelope.activeStageId ?? undefined, runId: previous.activeRun?.runId, message: WORLD_SIMULATION_STOP_REASON_SUPERSEDED_ACU }]
            : [];
          const reservation = { revision: 1, createdAt: now, reason: 'initial' as const, replanInstruction: '', frozen: false, plan: placeholderPlan_ACU };
          return {
            ...envelope,
            task: { taskId, originInstruction: input.instruction, status: 'drafting', createdAt: now, updatedAt: now, activeRun: identity, stopReason: null },
            stages: [{ stageId, stageNumber: 1, status: 'planning', activeRevision: 1, revisions: [reservation] }],
            activeStageId: stageId,
            timeline: [...envelope.timeline, ...supersededTimeline, { id: this.dependencies.allocateId('timeline'), at: now, kind: 'task_created', taskId, stageId, revision: 1, runId: identity.runId }],
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
        return await this.persistPlanAndExecute_ACU(identity, input.anchor, prepared, controller.signal);
      } catch (error) {
        return this.finishFailure_ACU(identity, error, controller.signal.aborted);
      }
    })();
    return this.trackInflight_ACU(identity.chatIdentity, controller, completion);
  }

  /**
   * 登记在途 Promise；结算后按顺序清理 abort/inflight 登记，再排空 pending 自动触发。
   * 清理必须先于 drain：drain 内部会再次 start，start 以 isInFlight 判忙。
   */
  private trackInflight_ACU(
    chatIdentity: string,
    controller: AbortController,
    completion: Promise<WorldSimulationOrchestratorResult_ACU>,
  ): Promise<WorldSimulationOrchestratorResult_ACU> {
    const tracked = completion.finally(() => {
      if (abortByChat_ACU.get(chatIdentity) === controller) abortByChat_ACU.delete(chatIdentity);
      if (inflightByChat_ACU.get(chatIdentity) === tracked) inflightByChat_ACU.delete(chatIdentity);
      this.drainPending_ACU(chatIdentity);
    });
    inflightByChat_ACU.set(chatIdentity, tracked);
    return tracked;
  }

  /** 在途运行结算后，若期间有新楼层的自动触发被排队且本次不是用户主动停止，立刻为该楼层开始一次运行。 */
  private drainPending_ACU(chatIdentity: string): void {
    const manual = manualStopByChat_ACU.delete(chatIdentity);
    const pending = pendingAutoByChat_ACU.get(chatIdentity);
    pendingAutoByChat_ACU.delete(chatIdentity);
    if (manual || !pending) return;
    void this.start({ triggerKind: 'assistant_completed', anchor: pending.anchor, instruction: pending.instruction }).catch((): void => undefined);
  }

  private async persistPlanAndExecute_ACU(
    reservedIdentity: WorldSimulationRunIdentity_ACU,
    anchor: WorldSimulationAnchorIdentity_ACU,
    prepared: WorldSimulationPreparedRun_ACU,
    signal: AbortSignal,
  ): Promise<WorldSimulationOrchestratorResult_ACU> {
    if (signal.aborted) throw new Error('WORLD_SIMULATION_ABORTED');
    await this.dependencies.assertAnchorCurrent(anchor);
    assertRunCurrent_ACU(this.dependencies.store.read(), reservedIdentity);
    const revision = prepared.revision.frozen ? prepared.revision : { ...prepared.revision, frozen: true };
    const identity = { ...reservedIdentity, stageRevision: revision.revision };
    const now = this.dependencies.now();

    await this.dependencies.store.updateAtomically(envelope => {
      assertRunCurrent_ACU(envelope, reservedIdentity);
      const stage = envelope!.stages.find(item => item.stageId === reservedIdentity.stageId)!;
      return {
        ...envelope!,
        task: { ...envelope!.task!, status: 'running', updatedAt: now, activeRun: identity, stopReason: null },
        stages: envelope!.stages.map(item => item.stageId === stage.stageId ? { ...item, status: 'running', activeRevision: revision.revision, revisions: [revision] } : item),
        timeline: [
          ...envelope!.timeline,
          { id: this.dependencies.allocateId('timeline'), at: now, kind: 'plan_ready', taskId: identity.taskId, stageId: identity.stageId, revision: identity.stageRevision, runId: identity.runId },
          { id: this.dependencies.allocateId('timeline'), at: now, kind: 'stage_started' as const, taskId: identity.taskId, stageId: identity.stageId, revision: identity.stageRevision, runId: identity.runId },
        ],
        lastError: null,
        updatedAt: now,
      };
    }, { chatIdentity: identity.chatIdentity, taskId: identity.taskId, stageId: identity.stageId, revision: reservedIdentity.stageRevision });

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
      const blocked = result.outcome === 'blocked';
      return {
        ...envelope!,
        task: { ...envelope!.task!, status: blocked ? 'paused' : 'completed', updatedAt: completedAt, activeRun: blocked ? envelope!.task!.activeRun : null, stopReason: blocked ? result.summary : null },
        stages: envelope!.stages.map(stage => stage.stageId === identity.stageId ? { ...stage, status: blocked ? 'failed' : 'completed' } : stage),
        timeline: [...envelope!.timeline, { id: this.dependencies.allocateId('timeline'), at: completedAt, kind: blocked ? 'blocked' : 'no_change', taskId: identity.taskId, stageId: identity.stageId, revision: identity.stageRevision, runId: identity.runId, message: result.summary }],
        updatedAt: completedAt,
      };
    }, { chatIdentity: identity.chatIdentity, taskId: identity.taskId, stageId: identity.stageId, revision: identity.stageRevision });
    return { status: 'completed', identity, result };
  }

  /**
   * 非正常终局落盘。
   * - 用户取消：任务落为 paused/manual 并保留 activeRun——run state 已按 cursorKey 持久化在锚点楼层，
   *   resume 时可以从中断处继续，与智能续写"手停可恢复"同语义；
   * - 其他异常：落为 failed 并记录 lastError。
   */
  private async finishFailure_ACU(identity: WorldSimulationRunIdentity_ACU, cause: unknown, cancelled: boolean): Promise<WorldSimulationOrchestratorResult_ACU> {
    const error = errorFromUnknown_ACU(cause);
    const now = this.dependencies.now();
    // 异常终局兜底：正常路径由 run_completed/run_failed/block 事件关闭 running，异常路径不会写这些事件，
    // 必须在这里强制关闭，否则 UI 的 running 脉冲与「停止」按钮会一直卡住。
    try { endWorldSimulationSessionRun_ACU(identity.chatIdentity); } catch { /* 观察者异常不应阻断失败落盘 */ }
    try {
      await this.dependencies.store.updateAtomically(envelope => {
        const active = envelope?.task?.activeRun;
        if (!envelope?.task || !active || active.runId !== identity.runId) throw new Error('WORLD_SIMULATION_RUN_STALE');
        if (cancelled) {
          return {
            ...envelope,
            task: { ...envelope.task, status: 'paused', updatedAt: now, stopReason: WORLD_SIMULATION_STOP_REASON_MANUAL_ACU },
            timeline: [...envelope.timeline, { id: this.dependencies.allocateId('timeline'), at: now, kind: 'paused', taskId: identity.taskId, stageId: identity.stageId, revision: active.stageRevision, runId: identity.runId, message: WORLD_SIMULATION_STOP_REASON_MANUAL_ACU }],
            lastError: null,
            updatedAt: now,
          };
        }
        return {
          ...envelope,
          task: { ...envelope.task, status: 'failed', updatedAt: now, activeRun: null, stopReason: error.message },
          stages: envelope.stages.map(stage => stage.stageId === identity.stageId ? { ...stage, status: 'failed' } : stage),
          timeline: [...envelope.timeline, { id: this.dependencies.allocateId('timeline'), at: now, kind: 'failed', taskId: identity.taskId, stageId: identity.stageId, revision: identity.stageRevision, runId: identity.runId, message: error.message, errorCode: error.code }],
          lastError: error,
          updatedAt: now,
        };
      }, { chatIdentity: identity.chatIdentity, taskId: identity.taskId });
    } catch {
      // A newer task or revision owns the envelope. Late failure must not overwrite it.
    }
    return cancelled ? { status: 'cancelled', identity } : { status: 'failed', identity, error };
  }
}
