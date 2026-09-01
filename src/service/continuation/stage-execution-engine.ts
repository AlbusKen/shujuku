import { ContinuationValidationError_ACU, createContinuationError_ACU, type ContinuationEnvelope_ACU, type ContinuationInternalAiRequestIdentity_ACU, type ContinuationStage_ACU, type ContinuationTask_ACU, type StageNode_ACU, type StageRevision_ACU, type StageTurn_ACU, type TurnAttemptIdentity_ACU } from './model';
import type { AgentOutlineOpResult_ACU, ContinuationAgentTurnPlanResult_ACU } from './agent/agent-model';
import type { ContinuationAgentTurnPlanner_ACU } from './agent/agent-main-loop';

/** 严格执行快照：只在铸造宿主归属身份时使用，要求大纲游标完整且已冻结。 */
export interface ContinuationExecutionSnapshot_ACU {
  envelope: ContinuationEnvelope_ACU;
  task: ContinuationTask_ACU;
  stage: ContinuationStage_ACU;
  revision: StageRevision_ACU;
  node: StageNode_ACU;
  turn: StageTurn_ACU;
  turnNumber: number;
  nodeTurnNumber: number;
}

/**
 * 宽松执行上下文：Agent 循环全程使用。任务必须在跑，但允许尚无大纲
 * （stage 为 null）或当前阶段已完成（游标为 null）——这两种状态正是
 * 主 Agent 需要派工大纲子代理去创建或继续大纲的时机。
 */
export interface ContinuationAgentExecutionContext_ACU {
  envelope: ContinuationEnvelope_ACU;
  task: ContinuationTask_ACU;
  stage: ContinuationStage_ACU | null;
  revision: StageRevision_ACU | null;
  node: StageNode_ACU | null;
  turn: StageTurn_ACU | null;
  turnNumber: number | null;
  nodeTurnNumber: number | null;
}

export interface ContinuationPreparedTurnInstruction_ACU {
  identity: TurnAttemptIdentity_ACU;
  instruction: ContinuationAgentTurnPlanResult_ACU;
}

export interface StageExecutionEngineDependencies_ACU {
  readEnvelope: () => ContinuationEnvelope_ACU | null;
  getChatIdentity: () => string;
  allocateId: (prefix: string) => string;
  planner: ContinuationAgentTurnPlanner_ACU;
}

function fail_ACU(code: 'CONTINUATION_TASK_NOT_FOUND' | 'CONTINUATION_TASK_STATE_INVALID' | 'CONTINUATION_INTERNAL_REQUEST_STALE', message: string): never {
  throw new ContinuationValidationError_ACU(createContinuationError_ACU(code, 'turn_call', message, false));
}

function currentSnapshot_ACU(envelope: ContinuationEnvelope_ACU | null): ContinuationExecutionSnapshot_ACU {
  const task = envelope?.activeTask;
  if (!task) fail_ACU('CONTINUATION_TASK_NOT_FOUND', '当前聊天没有智能续写任务');
  if (task.status !== 'running' || !task.activeStageId) fail_ACU('CONTINUATION_TASK_STATE_INVALID', '当前任务不允许生成每轮指令');
  const stage = task.stages.find(item => item.stageId === task.activeStageId);
  if (!stage || stage.status !== 'running') fail_ACU('CONTINUATION_TASK_STATE_INVALID', '当前阶段不允许生成每轮指令');
  const revision = stage.revisions.find(item => item.revision === stage.activeRevision);
  if (!revision || !revision.frozen) fail_ACU('CONTINUATION_TASK_STATE_INVALID', '当前阶段大纲尚未冻结');
  const node = revision.outline.nodes[stage.activeNodeIndex];
  const turn = node?.turns[stage.activeTurnIndex];
  if (!node || !turn) fail_ACU('CONTINUATION_TASK_STATE_INVALID', '当前阶段游标无效');
  const previousTurns = revision.outline.nodes.slice(0, stage.activeNodeIndex).reduce((total, item) => total + item.turns.length, 0) + stage.activeTurnIndex;
  if (stage.completedTurns !== previousTurns) fail_ACU('CONTINUATION_TASK_STATE_INVALID', '当前阶段游标与已完成轮数不一致');
  return { envelope, task, stage, revision, node, turn, turnNumber: previousTurns + 1, nodeTurnNumber: stage.activeTurnIndex + 1 };
}

/**
 * 构建宽松执行上下文。
 * @param envelope 当前首楼权威状态
 * @returns 上下文；任务必须处于 running 且未被停止，大纲游标缺失时对应字段为 null
 */
export function currentAgentContext_ACU(envelope: ContinuationEnvelope_ACU | null): ContinuationAgentExecutionContext_ACU {
  const task = envelope?.activeTask;
  if (!task) fail_ACU('CONTINUATION_TASK_NOT_FOUND', '当前聊天没有智能续写任务');
  if (task.status !== 'running' || task.stopReason !== null) fail_ACU('CONTINUATION_TASK_STATE_INVALID', '当前任务不允许生成每轮指令');
  const empty: ContinuationAgentExecutionContext_ACU = { envelope: envelope!, task, stage: null, revision: null, node: null, turn: null, turnNumber: null, nodeTurnNumber: null };
  const stage = task.activeStageId ? task.stages.find(item => item.stageId === task.activeStageId) ?? null : null;
  if (!stage) return empty;
  const revision = stage.revisions.find(item => item.revision === stage.activeRevision) ?? null;
  if (stage.status !== 'running' || !revision || !revision.frozen) return { ...empty, stage, revision };
  const node = revision.outline.nodes[stage.activeNodeIndex] ?? null;
  const turn = node?.turns[stage.activeTurnIndex] ?? null;
  if (!node || !turn) return { ...empty, stage, revision };
  const previousTurns = revision.outline.nodes.slice(0, stage.activeNodeIndex).reduce((total, item) => total + item.turns.length, 0) + stage.activeTurnIndex;
  return { envelope: envelope!, task, stage, revision, node, turn, turnNumber: previousTurns + 1, nodeTurnNumber: stage.activeTurnIndex + 1 };
}

export class StageExecutionEngine_ACU {
  constructor(private readonly dependencies: StageExecutionEngineDependencies_ACU) {}

  /**
   * 跑一轮 Agent 循环并铸造宿主归属身份。
   * 身份在循环结束后按当时游标铸造：循环内的大纲创建/维护/继续会改变游标，
   * 循环期间的内部调用只校验「租约 + 聊天 + 任务在跑」，不绑 revision。
   * @param isLeaseCurrent 租约有效性检查
   * @param existingAttempt 正文重试轮的既有身份；提供时禁止大纲操作且游标必须原样
   * @param applyOutline 大纲操作回调，由编排器在租约内执行
   * @param signal 中断信号；用户停止或插话时用于真正取消在途的内部 AI 请求
   * @returns 最终身份与写作指导
   */
  async prepareCurrentTurnInstruction(
    isLeaseCurrent: () => boolean = () => true,
    existingAttempt?: TurnAttemptIdentity_ACU,
    applyOutline?: (instruction: string) => Promise<AgentOutlineOpResult_ACU>,
    signal?: AbortSignal | null,
  ): Promise<ContinuationPreparedTurnInstruction_ACU> {
    const chatIdentity = this.dependencies.getChatIdentity();
    const initial = currentAgentContext_ACU(this.dependencies.readEnvelope());
    const taskId = initial.task.taskId;
    if (existingAttempt) this.assertAttemptMatchesCursor_ACU(existingAttempt, chatIdentity);

    const isCurrent = (candidate: ContinuationInternalAiRequestIdentity_ACU): boolean => {
      if (!isLeaseCurrent() || candidate.chatIdentity !== chatIdentity || candidate.taskId !== taskId) return false;
      if (this.dependencies.getChatIdentity() !== chatIdentity) return false;
      const task = this.dependencies.readEnvelope()?.activeTask;
      return !!task && task.taskId === taskId && task.status === 'running' && task.stopReason === null;
    };

    const attemptId = existingAttempt?.attemptId ?? this.dependencies.allocateId('attempt');
    const readContext = () => currentAgentContext_ACU(this.dependencies.readEnvelope());
    const instruction = await this.dependencies.planner.plan({
      settings: initial.envelope.settings,
      readContext,
      createInternalRequestIdentity: () => {
        const context = readContext();
        return {
          source: 'turn_instruction',
          requestId: this.dependencies.allocateId('turn-request'),
          chatIdentity,
          taskId,
          stageId: context.stage?.stageId ?? 'pre-outline',
          revision: context.revision?.revision ?? 0,
          nodeId: context.node?.id,
          turnId: context.turn?.id,
          attemptId,
        };
      },
      isInternalRequestCurrent: isCurrent,
      applyOutline: existingAttempt ? undefined : applyOutline,
      signal,
    });

    // 循环结束后按最终游标铸造身份：finalize 已由循环保证游标存在，这里的严格快照是最后防线。
    const snapshot = currentSnapshot_ACU(this.dependencies.readEnvelope());
    if (existingAttempt) {
      this.assertAttemptMatchesCursor_ACU(existingAttempt, chatIdentity);
      return { identity: existingAttempt, instruction };
    }
    return {
      identity: {
        chatIdentity, taskId: snapshot.task.taskId, stageId: snapshot.stage.stageId,
        revision: snapshot.revision.revision, nodeId: snapshot.node.id, turnId: snapshot.turn.id, attemptId,
      },
      instruction,
    };
  }

  private assertAttemptMatchesCursor_ACU(attempt: TurnAttemptIdentity_ACU, chatIdentity: string): void {
    const snapshot = currentSnapshot_ACU(this.dependencies.readEnvelope());
    if (attempt.chatIdentity !== chatIdentity || attempt.taskId !== snapshot.task.taskId
      || attempt.stageId !== snapshot.stage.stageId || attempt.revision !== snapshot.revision.revision
      || attempt.nodeId !== snapshot.node.id || attempt.turnId !== snapshot.turn.id) {
      fail_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', '正文重试身份已不属于当前阶段游标');
    }
  }
}
