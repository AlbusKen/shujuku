import { validateContinuationEnvelope_ACU, derivePausedContinuationEnvelopeAfterReload_ACU } from '../continuation/continuation-store';
import { createContinuationError_ACU, type ContinuationEnvelope_ACU, type ContinuationWriteGuard_ACU,
  type ContinuationLogicalRef_ACU, type ContinuationTask_ACU, type TurnAttemptIdentity_ACU } from '../continuation/model';
import { AGENT_CONVERSATION_SEGMENT_SCHEMA_VERSION_ACU, AGENT_CONVERSATION_FIELD_ACU, type AgentConversationAppend_ACU } from '../continuation/agent/agent-model';
import { appendAgentConversation_ACU, readAgentConversation_ACU } from '../continuation/agent/agent-conversation-store';
import { reconcileTaskCursorFromHistory_ACU } from '../continuation/stage-cursor';
import { getPublishedZeroLayerPath_ACU } from './timeline';
import { assertZeroLayerCarrier_ACU, captureZeroLayerCarrier_ACU, type ZeroLayerCarrierContext_ACU } from './carrier-context';
import { ZeroLayerError_ACU, type ZeroLayerEnvelope_ACU, type ZeroLayerContinuationState_ACU } from './model';
import { ZeroLayerStore_ACU } from './store';
import { validateZeroLayerContinuationReceipt_ACU } from './validation';
import { survivesBridgeContinuationAnchor_ACU } from './bridge-continuation';
import { isReachableBranchAnchor_ACU } from './branch-path';

export function emptyZeroLayerContinuation_ACU(): ZeroLayerContinuationState_ACU {
  return { schemaVersion: 1, envelope: null, moduleFrames: {},
    conversation: { schemaVersion: AGENT_CONVERSATION_SEGMENT_SCHEMA_VERSION_ACU, updatedAt: 0, segment: [] }, confirmed: [] };
}

/** 固定会话/分支的 Adapter；同步读取仍经过保存未知门禁，不缓存候选为权威状态。 */
export class ZeroLayerContinuationStore_ACU {
  readonly context: ZeroLayerCarrierContext_ACU;
  readonly sessionId: string;
  readonly branchId: string;
  constructor(readonly store = new ZeroLayerStore_ACU()) {
    this.context = captureZeroLayerCarrier_ACU();
    const envelope = store.readSnapshot();
    if (!envelope?.enabled) throw new ZeroLayerError_ACU('mode-disabled', '零层续写需要已启用的载体。');
    this.sessionId = envelope.sessionId;
    this.branchId = envelope.activeBranchId;
  }

  readSource(): ZeroLayerEnvelope_ACU {
    assertZeroLayerCarrier_ACU(this.context);
    const source = this.store.readSnapshot();
    if (!source?.enabled || source.sessionId !== this.sessionId || source.activeBranchId !== this.branchId) {
      throw new ZeroLayerError_ACU('scope-changed', '续写所属会话或分支已变化。');
    }
    return source;
  }

  readState(): ZeroLayerContinuationState_ACU {
    return this.readSource().branches.find(branch => branch.branchId === this.branchId)!.continuation ?? emptyZeroLayerContinuation_ACU();
  }
  readPersisted(): ContinuationEnvelope_ACU | null { return this.readState().envelope; }
  read(): ContinuationEnvelope_ACU | null {
    const envelope = this.readPersisted();
    if (!envelope) return null;
    const derived = derivePausedContinuationEnvelopeAfterReload_ACU(envelope);
    // 逻辑等待轮的引用仍持久存在，不能套用宿主事件丢失后清除认领的恢复行为。
    const pendingHostTurn = envelope.activeTask?.pendingHostTurn;
    return derived.activeTask ? { ...derived, activeTask: { ...this.reconcile(derived.activeTask), pendingHostTurn } } : derived;
  }

  async updateState(mutator: (state: ZeroLayerContinuationState_ACU, source: ZeroLayerEnvelope_ACU) => void, confirmation?: ContinuationLogicalRef_ACU): Promise<void> {
    this.readSource();
    await this.store.updateContinuation(this.sessionId, this.branchId, source => {
      assertZeroLayerCarrier_ACU(this.context);
      const branch = source.branches.find(item => item.branchId === this.branchId)!;
      branch.continuation ??= emptyZeroLayerContinuation_ACU();
      mutator(branch.continuation, source);
      return source;
    }, confirmation);
  }

  getChatIdentity(): string {
    return JSON.stringify(['zero-layer-continuation', this.context.key, this.sessionId, this.branchId]);
  }

  anchor(): { logicalAnchor: { sessionId: string; branchId: string; headTurnId: string | null } } {
    const source = this.readSource();
    return { logicalAnchor: { sessionId: this.sessionId, branchId: this.branchId,
      headTurnId: source.branches.find(branch => branch.branchId === this.branchId)!.headTurnId } };
  }

  reconcile(task: ContinuationTask_ACU): ContinuationTask_ACU {
    const source = this.readSource();
    const path = getPublishedZeroLayerPath_ACU(source);
    const bridge = source.branches.find(branch => branch.branchId === this.branchId)?.bridge;
    return reconcileTaskCursorFromHistory_ACU(task, anchor => {
      if (anchor.messageIndex !== undefined) return survivesBridgeContinuationAnchor_ACU(task, anchor, bridge);
      if (anchor.logicalAnchor) {
        const ref = anchor.logicalAnchor;
        return ref.sessionId === this.sessionId
          && isReachableBranchAnchor_ACU(source, ref.branchId, ref.headTurnId);
      }
      const ref = anchor.logicalRef;
      return !!ref && ref.sessionId === this.sessionId
        && path.some(turn => turn.branchId === ref.branchId && turn.turnId === ref.turnId && turn.attemptId === ref.attemptId
          && turn.assistantFloor.floorId === ref.floorId);
    });
  }

  assertCanContinue(): void {
    this.store.assertCanOperate();
    const source = this.readSource();
    const checkpoints = source.branches.find(branch => branch.branchId === this.branchId)!.checkpoints;
    if (checkpoints?.pending || checkpoints?.cleanupPending) {
      throw new ZeroLayerError_ACU('effects-pending', 'checkpoint 提交尚未收尾；请先恢复已保存阶段，不得继续规划或修改资料。');
    }
    if (source.turns.some(turn => turn.branchId === this.branchId
      && !['published', 'failed', 'cancelled'].includes(turn.phase))) {
      throw new ZeroLayerError_ACU('pending-turn', '逻辑正文尚未发布，请先恢复已保存回合，不能重新规划或发送。');
    }
  }

  async appendConversation(appends: readonly AgentConversationAppend_ACU[]): Promise<boolean> {
    if (!appends.length) return false;
    await this.updateState(state => {
      const before = readAgentConversation_ACU([{ [AGENT_CONVERSATION_FIELD_ACU]: state.conversation }]);
      const next = appendAgentConversation_ACU(before, appends);
      state.conversation.segment.push(...next.messages.filter(message => message.id >= before.nextId));
      state.conversation.updatedAt = next.updatedAt;
    });
    return true;
  }

  /** 发送/恢复失败只改变同一轮任务状态；持久阶段决定是否可以解除等待。 */
  async pauseTurnFailure(identity: TurnAttemptIdentity_ACU, ref?: ContinuationLogicalRef_ACU): Promise<void> {
    identity = structuredClone(identity);
    ref = ref && structuredClone(ref);
    await this.updateState((state, source) => {
      const envelope = state.envelope;
      const task = envelope?.activeTask;
      if (!envelope || !task || task.taskId !== identity.taskId || task.stopReason !== null
        || !['running', 'paused'].includes(task.status) || identity.chatIdentity !== this.getChatIdentity()) return;
      const identityKeys = ['chatIdentity', 'taskId', 'stageId', 'revision', 'nodeId', 'turnId', 'attemptId'] as const;
      const refKeys = ['sessionId', 'branchId', 'turnId', 'attemptId', 'floorId'] as const;
      const turn = source.turns.find(item => item.branchId === this.branchId && item.continuationIdentity
        && identityKeys.every(key => item.continuationIdentity![key] === identity[key]));
      if (ref && (ref.sessionId !== this.sessionId || ref.branchId !== this.branchId
        || !turn || turn.turnId !== ref.turnId || turn.attemptId !== ref.attemptId
        || turn.assistantFloor.floorId !== ref.floorId)) return;
      if (turn?.phase === 'published') return;
      const pending = task.pendingHostTurn;
      if (pending && (!identityKeys.every(key => pending.identity[key] === identity[key])
        || !pending.capture.logicalRef || !turn
        || pending.capture.logicalRef.sessionId !== this.sessionId
        || pending.capture.logicalRef.branchId !== this.branchId
        || pending.capture.logicalRef.turnId !== turn.turnId
        || pending.capture.logicalRef.attemptId !== turn.attemptId
        || pending.capture.logicalRef.floorId !== turn.assistantFloor.floorId
        || (ref && !refKeys.every(key => pending.capture.logicalRef![key] === ref![key])))) return;
      const confirmed = turn && state.confirmed.some(item => item.turnId === turn.turnId
        && item.attemptId === turn.attemptId && item.continuationAttemptId === identity.attemptId);
      if (!confirmed) {
        const stage = task.stages.find(item => item.stageId === task.activeStageId);
        const revision = stage?.revisions.find(item => item.revision === stage.activeRevision);
        const node = revision?.outline.nodes[stage!.activeNodeIndex];
        if (stage?.stageId !== identity.stageId || stage.activeRevision !== identity.revision
          || node?.id !== identity.nodeId || node.turns[stage!.activeTurnIndex]?.id !== identity.turnId) return;
      }
      const unsent = !turn || ['failed', 'cancelled'].includes(turn.phase);
      const durable = !!turn && ['response-durable', 'effects-durable'].includes(turn.phase);
      const message = durable ? '正文已保存，结算或发布未完成；请显式继续，仅补结算。'
        : unsent ? '本轮正文未发送，续写已暂停；请检查状态后显式继续。'
        : '本轮发送结果未知或准备未完成；已保留逻辑引用，禁止重新请求模型。';
      state.envelope = validateContinuationEnvelope_ACU({ ...envelope, activeTask: { ...task,
        status: 'paused', updatedAt: Date.now(), pendingHostTurn: unsent ? null : pending,
        lastError: createContinuationError_ACU('CONTINUATION_GENERATION_FAILED',
          durable ? 'generation_evaluate' : 'host_send', message, false,
          { logicalAttemptId: identity.attemptId, turnPhase: turn?.phase ?? 'not-prepared' }),
      } }, 'persist');
    });
  }

  /** 发布恢复成功后只清除本轮失败记录，不覆盖用户停止或下一轮状态。 */
  async clearPublishedTurnFailure(identity: TurnAttemptIdentity_ACU, ref: ContinuationLogicalRef_ACU): Promise<void> {
    identity = structuredClone(identity);
    ref = structuredClone(ref);
    // 常规发布没有失败记录，不额外保存 carrier。
    if (this.readPersisted()?.activeTask?.lastError?.details?.logicalAttemptId !== identity.attemptId) return;
    await this.updateState((state, source) => {
      const envelope = state.envelope;
      const task = envelope?.activeTask;
      const turn = source.turns.find(item => item.turnId === ref.turnId && item.attemptId === ref.attemptId);
      if (ref.sessionId !== this.sessionId || ref.branchId !== this.branchId
        || turn?.branchId !== this.branchId || turn.assistantFloor.floorId !== ref.floorId
        || turn.phase !== 'published' || !state.confirmed.some(item => item.turnId === ref.turnId
          && item.attemptId === ref.attemptId && item.continuationAttemptId === identity.attemptId)
        || !envelope || !task || task.taskId !== identity.taskId || task.status !== 'paused'
        || task.stopReason !== null || task.pendingHostTurn
        || task.lastError?.details?.logicalAttemptId !== identity.attemptId) return;
      state.envelope = { ...envelope, activeTask: { ...task, lastError: null, updatedAt: Date.now() } };
    });
  }

  async confirm(ref: ContinuationLogicalRef_ACU,
    advance: (current: ContinuationEnvelope_ACU) => ContinuationEnvelope_ACU,
  ): Promise<ContinuationEnvelope_ACU> {
    ref = structuredClone(ref);
    let result: ContinuationEnvelope_ACU | null = null;
    await this.updateState((state, source) => {
      const turn = source.turns.find(item => item.turnId === ref.turnId && item.attemptId === ref.attemptId);
      if (ref.sessionId !== this.sessionId || ref.branchId !== this.branchId
        || !turn?.continuationIdentity || turn.branchId !== this.branchId
        || turn.assistantFloor.floorId !== ref.floorId || !turn.body?.trim() || !state.envelope) {
        throw new ZeroLayerError_ACU('revision-conflict', '续写确认引用与持久化正文不匹配。');
      }
      const identity = turn.continuationIdentity;
      const confirmed = state.confirmed.find(item => item.turnId === ref.turnId);
      // 首次确认的回执已由存储层组合进内存候选；这里只校验，不能另行保存。
      validateZeroLayerContinuationReceipt_ACU(turn, this.sessionId);
      if (confirmed) {
        if (confirmed.attemptId !== ref.attemptId || confirmed.floorId !== ref.floorId
          || confirmed.continuationAttemptId !== identity.attemptId) {
          throw new ZeroLayerError_ACU('corrupt-data', '逻辑续写确认与结算回执不一致。');
        }
        result = state.envelope;
        return;
      }
      const taskBefore = state.envelope.activeTask;
      const pending = taskBefore?.pendingHostTurn;
      const capturedRef = pending?.capture.logicalRef;
      if (turn.phase !== 'response-durable' || taskBefore?.status !== 'running'
        || pending?.status !== 'awaiting_generation' || identity.chatIdentity !== this.getChatIdentity()
        || !(['chatIdentity', 'taskId', 'stageId', 'revision', 'nodeId', 'turnId', 'attemptId'] as const)
          .every(key => pending.identity[key] === identity[key])
        || !capturedRef || !(['sessionId', 'branchId', 'turnId', 'attemptId', 'floorId'] as const)
          .every(key => capturedRef[key] === ref[key])) {
        throw new ZeroLayerError_ACU('revision-conflict', '逻辑正文已不属于当前续写等待轮。');
      }
      result = validateContinuationEnvelope_ACU(advance(state.envelope), 'persist');
      state.envelope = result;
      state.confirmed.push({ turnId: ref.turnId, attemptId: ref.attemptId, floorId: ref.floorId,
        continuationAttemptId: identity.attemptId });
      const task = result.activeTask!;
      const stage = task.stages.find(item => item.stageId === task.activeStageId)!;
      const revision = stage.revisions.find(item => item.revision === stage.activeRevision)!;
      const nextTurn = stage.status === 'running' ? revision.outline.nodes[stage.activeNodeIndex]?.turns[stage.activeTurnIndex] : null;
      const snapshot = readAgentConversation_ACU([{ [AGENT_CONVERSATION_FIELD_ACU]: state.conversation }]);
      const next = appendAgentConversation_ACU(snapshot, [{ kind: 'turn', digest: '逻辑正文已确认',
        turnKey: `${stage.stageId}#${stage.activeRevision}#${nextTurn?.id ?? ''}`,
        text: `逻辑正文已确认，上一轮已结束。第 ${stage.stageNumber} 阶段；下一轮目标：${nextTurn?.goal ?? '当前阶段已完成，继续时准备下一阶段大纲'}。` }]);
      state.conversation.segment.push(...next.messages.filter(message => message.id >= snapshot.nextId));
      state.conversation.updatedAt = next.updatedAt;
    }, ref);
    return result!;
  }

  private assertGuard(envelope: ContinuationEnvelope_ACU | null, guard?: ContinuationWriteGuard_ACU): void {
    if (!guard) return;
    const task = envelope?.activeTask;
    const stage = task?.stages.find(item => item.stageId === task.activeStageId);
    if (guard.chatIdentity !== this.getChatIdentity()
      || (guard.taskId !== undefined && guard.taskId !== (task?.taskId ?? null))
      || (guard.stageId !== undefined && guard.stageId !== (task?.activeStageId ?? null))
      || (guard.revision !== undefined && guard.revision !== (stage?.activeRevision ?? null))) {
      throw new ZeroLayerError_ACU('revision-conflict', '续写任务、阶段或 revision 守卫不匹配。');
    }
  }

  async replaceAtomically(candidate: ContinuationEnvelope_ACU, guard?: ContinuationWriteGuard_ACU): Promise<void> {
    const validated = validateContinuationEnvelope_ACU(candidate, 'persist');
    await this.updatePersistedAtomically(() => validated, guard);
  }

  async updatePersistedAtomically(
    mutator: (current: ContinuationEnvelope_ACU | null) => ContinuationEnvelope_ACU,
    guard?: ContinuationWriteGuard_ACU,
  ): Promise<void> {
    await this.updateState(state => {
      this.assertGuard(state.envelope, guard);
      state.envelope = validateContinuationEnvelope_ACU(mutator(structuredClone(state.envelope)), 'persist');
    });
  }
}
