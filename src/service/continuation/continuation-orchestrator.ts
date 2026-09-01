import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { buildDefaultContinuationSettings_ACU } from './defaults';
import { FirstFloorContinuationStore_ACU } from './continuation-store';
import { reconcileTaskCursorFromChat_ACU } from './stage-cursor';
import { acceptPlannedStageRevision_ACU, ContinuationOutlinePlanner_ACU, createPlannedStageRevision_ACU, freezePlannedStageRevision_ACU, type ContinuationOutlinePlanningResult_ACU } from './outline-planner';
import { listStageOutlineTurns_ACU, resolveContinuationTurnRange_ACU, resolveStageOutlinePacingContext_ACU, validateReplannedStageOutline_ACU, validateStageOutlinePacing_ACU } from './outline-schema';
import { CONTINUATION_RECOVERABLE_STOP_REASONS_ACU, ContinuationValidationError_ACU, createContinuationError_ACU, type ContinuationEnvelope_ACU, type ContinuationError_ACU, type ContinuationHostGenerationCapture_ACU, type ContinuationReplanConstraints_ACU, type ContinuationRevisionReason_ACU, type ContinuationSettings_ACU, type ContinuationStage_ACU, type ContinuationTask_ACU, type ContinuationWriteGuard_ACU, type StageOutline_ACU, type StageRevision_ACU, type TurnAttemptIdentity_ACU } from './model';
import { StageExecutionEngine_ACU, type ContinuationPreparedTurnInstruction_ACU, type ContinuationExecutionSnapshot_ACU } from './stage-execution-engine';
import type { AgentConversationAppend_ACU, AgentOutlineEditOp_ACU, AgentOutlineOpResult_ACU } from './agent/agent-model';
import { appendAgentConversationToChat_ACU, clearAgentConversationField_ACU } from './agent/agent-conversation-store';
import { clearAgentModuleField_ACU } from './agent/agent-module-store';
import { clearAgentRunState_ACU } from './agent/agent-run-cache';
import { clearAgentSessionLog_ACU, logAgentSession_ACU } from './agent/agent-session-log';
import type { ContinuationPromptPlaceholder_ACU } from './prompt-template';

export interface SendAgentMessageInput_ACU { text: string; }
export type SendAgentMessageDisposition_ACU = 'continue_now' | 'queued_after_host' | 'accepted_without_resume';
export interface SendAgentMessageResult_ACU extends ContinuationOrchestratorResult_ACU {
  /** 本次发送顺带创建了新任务。 */
  created: boolean;
  /** 本次发送打断了正在进行的 Agent 循环。 */
  interrupted: boolean;
  /** 消息接收后的明确后续动作。 */
  disposition: SendAgentMessageDisposition_ACU;
  /** disposition 为 accepted_without_resume 时提供给 UI 的可展示原因。 */
  detail?: string;
  /** 仅 continue_now 时为 true，兼容旧调用方。 */
  shouldContinue: boolean;
}
export interface ReplaceActiveOutlineInput_ACU { outline: StageOutline_ACU; }
export interface ClearContinuationDataResult_ACU { envelope: ContinuationEnvelope_ACU; clearedModules: boolean; clearedConversation: boolean; }
export interface ContinuationPlanningContext_ACU { envelope: ContinuationEnvelope_ACU; task: ContinuationTask_ACU; stage: ContinuationStage_ACU | null; reason: ContinuationRevisionReason_ACU; replanInstruction: string; }
export interface CreateContinuationTaskInput_ACU { originInstruction: string; }
export interface ReplanContinuationInput_ACU { instruction?: string; }
export interface AcceptOutlineInput_ACU { outline?: StageOutline_ACU; }
export interface ReplaceContinuationSettingsInput_ACU { settings: ContinuationEnvelope_ACU['settings']; }
export interface ContinuationOrchestratorResult_ACU { envelope: ContinuationEnvelope_ACU; task: ContinuationTask_ACU; planning?: Pick<ContinuationOutlinePlanningResult_ACU, 'attempts' | 'apiPreset' | 'requiresReview'>; }
export interface ContinuationHostTurnActionResult_ACU extends ContinuationOrchestratorResult_ACU {
  preparedTurn?: ContinuationPreparedTurnInstruction_ACU;
  /** 当前轮应走酒馆 regenerate/generate，而不是让 Agent 再造一条指令。 */
  retryHostGeneration?: boolean;
}
export interface RecordHostTurnInput_ACU { identity: TurnAttemptIdentity_ACU; capture: ContinuationHostGenerationCapture_ACU; }
export interface RejectHostTurnInput_ACU { identity: TurnAttemptIdentity_ACU; messageIndex: number; }
export interface ContinuationPendingHostTurnSnapshot_ACU { settings: ContinuationEnvelope_ACU['settings']; pending: NonNullable<ContinuationTask_ACU['pendingHostTurn']>; }

export interface ContinuationOrchestratorDependencies_ACU {
  store: FirstFloorContinuationStore_ACU;
  planner: ContinuationOutlinePlanner_ACU;
  executionEngine: StageExecutionEngine_ACU;
  getChatIdentity: () => string;
  now: () => number;
  allocateId: (prefix: string) => string;
  createOutlineResolvers: (context: ContinuationPlanningContext_ACU) => Partial<Record<ContinuationPromptPlaceholder_ACU, () => string | Promise<string | null | undefined> | null | undefined>>;
  /** 桥内存中是否持有该聊天的活认领。缺省视为无认领（测试注入场景）。 */
  hasLiveHostClaim?: (chatIdentity: string) => boolean;
  /** 把消息追加进主 Agent 的持久会话记录。缺省用楼层锚定存储。 */
  appendAgentConversation?: (appends: readonly AgentConversationAppend_ACU[]) => Promise<boolean>;
  /** 清除楼层上的资料快照字段。缺省用楼层锚定存储。 */
  clearAgentModules?: () => Promise<boolean>;
  /** 清除楼层上的会话记录字段。缺省用楼层锚定存储。 */
  clearAgentConversation?: () => Promise<boolean>;
  /** 无信封聊天的初始设置来源（全局设置副本优先于内置默认）。缺省用内置默认。 */
  buildFallbackSettings?: () => ContinuationSettings_ACU;
  /** 设置持久化成功后的镜像回调（把设置同步到全局副本）。失败不影响本聊天信封。 */
  onSettingsReplaced?: (settings: ContinuationSettings_ACU) => void;
}

type Lease_ACU = { id: string; epoch: number };
const leasesByChat_ACU = new Map<string, Lease_ACU>();
const epochsByChat_ACU = new Map<string, number>();
/**
 * 每个聊天在跑的 Agent 循环对应的中断控制器。
 * 租约作废只能让「下一次」身份校验失败，在途的 HTTP 请求还得等它自己返回；
 * 用户点停止或中途插话时要立刻见效，就必须真的 abort 掉在飞的请求。
 */
const abortControllersByChat_ACU = new Map<string, AbortController>();

function fail_ACU(code: 'CONTINUATION_OPERATION_BUSY' | 'CONTINUATION_ORIGIN_INSTRUCTION_EMPTY' | 'CONTINUATION_TASK_NOT_FOUND' | 'CONTINUATION_TASK_STATE_INVALID', message: string): never {
  throw new ContinuationValidationError_ACU(createContinuationError_ACU(code, 'persist', message, false));
}

function cloneOutline_ACU(outline: StageOutline_ACU): StageOutline_ACU {
  return { ...outline, nodes: outline.nodes.map(node => ({ ...node, turns: node.turns.map(turn => ({ ...turn })) })) };
}

function rejectOutlineEdit_ACU(message: string, details?: Record<string, unknown>): never {
  throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_WRITE_REJECTED', 'agent_loop', message, false, details));
}

/**
 * 把一批句级编辑应用到大纲副本上，并替模型收尾结构一致性（重算 suggestedTurns 与 totalTurns）。
 * 只做定位与变换，前缀保护、当前轮保护与范围校验由调用方统一执行。
 * @param outline 当前冻结大纲
 * @param edits 编辑操作列表
 * @param allocateId 新增轮次的 ID 分配器
 * @returns 编辑后的新大纲对象
 */
function applyOutlineEditOps_ACU(outline: StageOutline_ACU, edits: readonly AgentOutlineEditOp_ACU[], allocateId: (prefix: string) => string): StageOutline_ACU {
  const draft = cloneOutline_ACU(outline);
  const applyTurnMetadata = (turn: StageOutline_ACU['nodes'][number]['turns'][number], edit: Extract<AgentOutlineEditOp_ACU, { op: 'set_turn_goal' | 'insert_turn' }>): void => {
    if (edit.pacing !== undefined) turn.pacing = edit.pacing;
    if (edit.function !== undefined) turn.function = edit.function;
    if (edit.mainlineDelta !== undefined) turn.mainlineDelta = edit.mainlineDelta;
    if (edit.timeAdvance !== undefined) turn.timeAdvance = edit.timeAdvance;
    if (edit.timeAnchor === null) {
      delete turn.timeAnchor;
    } else if (edit.timeAnchor !== undefined) {
      turn.timeAnchor = edit.timeAnchor;
    }
  };
  for (const edit of edits) {
    if (edit.op === 'set_turn_goal') {
      const turn = draft.nodes.flatMap(node => node.turns).find(item => item.id === edit.turnId);
      if (!turn) rejectOutlineEdit_ACU(`set_turn_goal 找不到轮次：${edit.turnId}`, { turnId: edit.turnId });
      turn.goal = edit.goal;
      applyTurnMetadata(turn, edit);
      continue;
    }
    if (edit.op === 'set_node_goal') {
      const node = draft.nodes.find(item => item.id === edit.nodeId);
      if (!node) rejectOutlineEdit_ACU(`set_node_goal 找不到节点：${edit.nodeId}`, { nodeId: edit.nodeId });
      node.goal = edit.goal;
      continue;
    }
    if (edit.op === 'insert_turn') {
      const node = draft.nodes.find(item => item.id === edit.nodeId);
      if (!node) rejectOutlineEdit_ACU(`insert_turn 找不到节点：${edit.nodeId}`, { nodeId: edit.nodeId });
      // 旧编辑协议只提供 goal/pacing；新增语义字段使用保守默认，避免构造缺字段的新 revision。
      // UI 会展示这些默认值并提醒用户确认；严格校验仍负责拒绝与 pacing 不相容的组合。
      const newTurn: StageOutline_ACU['nodes'][number]['turns'][number] = {
        id: allocateId('turn'),
        goal: edit.goal,
        pacing: edit.pacing ?? 'setup',
        function: edit.function ?? 'transition',
        mainlineDelta: edit.mainlineDelta ?? 'hold',
        timeAdvance: edit.timeAdvance ?? 'continuous',
        ...(edit.timeAnchor ? { timeAnchor: edit.timeAnchor } : {}),
      };
      if (edit.afterTurnId === null) {
        node.turns.unshift(newTurn);
        continue;
      }
      const anchor = node.turns.findIndex(item => item.id === edit.afterTurnId);
      if (anchor < 0) rejectOutlineEdit_ACU(`insert_turn 的 afterTurnId 不在节点 ${edit.nodeId} 内：${edit.afterTurnId}`, { nodeId: edit.nodeId, afterTurnId: edit.afterTurnId });
      node.turns.splice(anchor + 1, 0, newTurn);
      continue;
    }
    const node = draft.nodes.find(item => item.turns.some(turn => turn.id === edit.turnId));
    if (!node) rejectOutlineEdit_ACU(`remove_turn 找不到轮次：${edit.turnId}`, { turnId: edit.turnId });
    node.turns = node.turns.filter(turn => turn.id !== edit.turnId);
  }
  const nodes = draft.nodes.map(node => ({ ...node, suggestedTurns: node.turns.length }));
  return { ...draft, nodes, totalTurns: nodes.reduce((sum, node) => sum + node.turns.length, 0) };
}

function guardForTask_ACU(chatIdentity: string, task: ContinuationTask_ACU | null): ContinuationWriteGuard_ACU {
  const stage = task?.activeStageId ? task.stages.find(item => item.stageId === task.activeStageId) : null;
  return task
    ? { chatIdentity, taskId: task.taskId, stageId: task.activeStageId, revision: stage?.activeRevision }
    : { chatIdentity };
}

function getActiveStage_ACU(task: ContinuationTask_ACU): ContinuationStage_ACU {
  const stage = task.activeStageId ? task.stages.find(item => item.stageId === task.activeStageId) : null;
  if (!stage) fail_ACU('CONTINUATION_TASK_STATE_INVALID', '任务缺少活动阶段');
  return stage;
}

function getActiveRevision_ACU(stage: ContinuationStage_ACU): StageRevision_ACU {
  const revision = stage.revisions.find(item => item.revision === stage.activeRevision);
  if (!revision) fail_ACU('CONTINUATION_TASK_STATE_INVALID', '阶段缺少活动 revision');
  return revision;
}

function taskResult_ACU(envelope: ContinuationEnvelope_ACU, planning?: ContinuationOrchestratorResult_ACU['planning']): ContinuationOrchestratorResult_ACU {
  if (!envelope.activeTask) fail_ACU('CONTINUATION_TASK_NOT_FOUND', '当前聊天没有智能续写任务');
  return { envelope, task: envelope.activeTask, ...(planning ? { planning } : {}) };
}

function normalizeOriginInstruction_ACU(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) fail_ACU('CONTINUATION_ORIGIN_INSTRUCTION_EMPTY', '初始续写要求不能为空');
  return value.trim();
}

function automaticStagesInWindow_ACU(task: ContinuationTask_ACU): number {
  return task.runStageCount - (task.stageBudgetBaseCount ?? 0);
}

function deadlineForNewRunWindow_ACU(settings: ContinuationSettings_ACU, now: number): number | null {
  return settings.totalDurationMinutes > 0 ? now + settings.totalDurationMinutes * 60_000 : null;
}

function userMessageResumeBlockDetail_ACU(task: ContinuationTask_ACU): string | null {
  if (task.status === 'awaiting_outline_review') return '当前大纲正在等待确认，确认后才能继续执行。';
  if (task.status === 'stopping_after_inflight') return '当前任务正在等待在途操作结束。';
  if (!['paused', 'running'].includes(task.status)) return `当前任务状态 ${task.status} 暂不能恢复。`;
  const stage = task.activeStageId ? task.stages.find(item => item.stageId === task.activeStageId) ?? null : null;
  if (!stage || stage.status === 'completed') return null;
  if (stage.status !== 'running') return '当前阶段尚未具备可执行的大纲。';
  return getActiveRevision_ACU(stage).frozen ? null : '当前阶段的大纲尚未冻结。';
}

function stageForOutline_ACU(stageId: string, stageNumber: number, revision: StageRevision_ACU, status: ContinuationStage_ACU['status']): ContinuationStage_ACU {
  return { stageId, stageNumber, status, activeRevision: revision.revision, revisions: [revision], activeNodeIndex: 0, activeTurnIndex: 0, completedTurns: 0 };
}

function identityMatchesCurrentTurn_ACU(task: ContinuationTask_ACU, identity: TurnAttemptIdentity_ACU): boolean {
  if (task.taskId !== identity.taskId || task.activeStageId !== identity.stageId) return false;
  const stage = task.stages.find(item => item.stageId === identity.stageId);
  if (!stage || stage.activeRevision !== identity.revision) return false;
  const revision = stage.revisions.find(item => item.revision === stage.activeRevision);
  const node = revision?.outline.nodes[stage.activeNodeIndex];
  const turn = node?.turns[stage.activeTurnIndex];
  if (node?.id !== identity.nodeId || turn?.id !== identity.turnId) return false;
  const pending = task.pendingHostTurn;
  return !pending || (
    pending.identity.chatIdentity === identity.chatIdentity
    && pending.identity.taskId === identity.taskId && pending.identity.stageId === identity.stageId
    && pending.identity.revision === identity.revision && pending.identity.nodeId === identity.nodeId
    && pending.identity.turnId === identity.turnId && pending.identity.attemptId === identity.attemptId
  );
}

function advanceConfirmedTurn_ACU(task: ContinuationTask_ACU, now: number, timeline: (kind: ContinuationTask_ACU['timeline'][number]['kind'], at: number, fields?: Omit<ContinuationTask_ACU['timeline'][number], 'id' | 'at' | 'kind'>) => ContinuationTask_ACU['timeline'][number], messageIndex?: number): ContinuationTask_ACU {
  const stage = getActiveStage_ACU(task);
  const revision = getActiveRevision_ACU(stage);
  const node = revision.outline.nodes[stage.activeNodeIndex];
  const turn = node?.turns[stage.activeTurnIndex];
  if (!node || !turn) fail_ACU('CONTINUATION_TASK_STATE_INVALID', '已确认轮次的阶段游标无效');
  const completedTurns = stage.completedTurns + 1;
  const isFinalTurn = completedTurns === revision.outline.totalTurns;
  const nextStage = isFinalTurn
    ? { ...stage, status: 'completed' as const, completedTurns }
    : stage.activeTurnIndex + 1 < node.turns.length
      ? { ...stage, activeTurnIndex: stage.activeTurnIndex + 1, completedTurns }
      : { ...stage, activeNodeIndex: stage.activeNodeIndex + 1, activeTurnIndex: 0, completedTurns };
  const entries = [...task.timeline, timeline('turn_completed', now, { stageId: stage.stageId, revision: stage.activeRevision, nodeId: node.id, turnId: turn.id, ...(messageIndex !== undefined ? { messageIndex } : {}) })];
  if (isFinalTurn) entries.push(timeline('stage_completed', now, { stageId: stage.stageId, revision: stage.activeRevision }));
  return { ...task, updatedAt: now, stages: task.stages.map(item => item.stageId === stage.stageId ? nextStage : item), timeline: entries };
}


export class ContinuationOrchestrator_ACU {
  constructor(private readonly dependencies: ContinuationOrchestratorDependencies_ACU) {}

  /**
   * 创建任务。不再预先规划大纲：大纲由主 Agent 在循环内按需派工大纲子代理创建，
   * 因此创建是即时操作，任务以「无阶段」状态落盘等待继续。
   */
  async createTask(input: CreateContinuationTaskInput_ACU): Promise<ContinuationOrchestratorResult_ACU> {
    const originInstruction = normalizeOriginInstruction_ACU(input.originInstruction);
    return this.withLease_ACU(async chatIdentity => {
      const existing = this.dependencies.store.readPersisted()?.activeTask ?? null;
      if (existing && !['completed', 'abandoned', 'failed'].includes(existing.status)) {
        fail_ACU('CONTINUATION_TASK_STATE_INVALID', '当前聊天已有未完成的智能续写任务');
      }
      const now = this.dependencies.now();
      const taskId = this.dependencies.allocateId('task');
      const base = this.baseEnvelope_ACU();
      const candidate: ContinuationEnvelope_ACU = {
        schemaVersion: base.schemaVersion,
        settings: base.settings,
        activeTask: {
          taskId, originInstruction, status: 'paused', createdAt: now, updatedAt: now, runStartedAt: null, deadlineAt: null,
          runStageCount: 0, stageBudgetBaseCount: 0, activeStageId: null, stages: [], timeline: [this.timeline_ACU('task_created', now)], stopReason: null, lastError: null,
        },
      };
      await this.dependencies.store.replaceAtomically(candidate, guardForTask_ACU(chatIdentity, existing));
      return taskResult_ACU(candidate);
    });
  }

  async acceptOutline(input: AcceptOutlineInput_ACU = {}): Promise<ContinuationOrchestratorResult_ACU> {
    return this.withLease_ACU(async chatIdentity => {
      let result: ContinuationEnvelope_ACU | null = null;
      await this.dependencies.store.updatePersistedAtomically(current => {
        const envelope = this.requireEnvelope_ACU(current);
        const task = this.requireTask_ACU(envelope);
        const stage = getActiveStage_ACU(task);
        const revision = getActiveRevision_ACU(stage);
        if (task.status !== 'awaiting_outline_review' || stage.status !== 'awaiting_review' || revision.frozen) {
          fail_ACU('CONTINUATION_TASK_STATE_INVALID', '当前任务没有可确认的大纲预览');
        }
        const previous = revision.reason === 'manual_replan'
          ? stage.revisions.find(item => item.revision === revision.revision - 1)
          : null;
        const candidateOutline = cloneOutline_ACU(input.outline ?? revision.outline);
        // 剩余轮数额度已放宽：按候选大纲的实际轮数复核，前缀保护仍以上一 revision 为基准。
        const constraints = previous
          ? { previousOutline: previous.outline, completedTurns: stage.completedTurns, expectedRemainingTurns: candidateOutline.nodes.reduce((sum, node) => sum + node.turns.length, 0) - stage.completedTurns }
          : undefined;
        const accepted = acceptPlannedStageRevision_ACU({ ...revision, outline: candidateOutline }, envelope.settings, constraints);
        const now = this.dependencies.now();
        const nextStage = { ...stage, status: 'running' as const, revisions: stage.revisions.map(item => item.revision === accepted.revision ? accepted : item) };
        result = { ...envelope, activeTask: { ...task, status: 'paused', updatedAt: now, stages: task.stages.map(item => item.stageId === stage.stageId ? nextStage : item) } };
        return result;
      }, { chatIdentity });
      return taskResult_ACU(result!);
    });
  }

  /**
   * 替换续写设置。任务运行中也允许保存：设置在每轮规划开始时才被重新读取，
   * 落盘发生在轮与轮之间不会影响在途生成；Agent 正在规划时租约互斥会以
   * CONTINUATION_OPERATION_BUSY 拒绝，调用方稍后重试即可。与现有任务冲突的
   * 修改（如阶段规模与已冻结大纲不符）由信封候选校验 fail-closed 拒绝。
   */
  async replaceSettings(input: ReplaceContinuationSettingsInput_ACU): Promise<ContinuationEnvelope_ACU> {
    return this.withLease_ACU(async chatIdentity => {
      let result: ContinuationEnvelope_ACU | null = null;
      await this.dependencies.store.updatePersistedAtomically(current => {
        const envelope = this.requireEnvelope_ACU(current);
        result = { ...envelope, settings: input.settings };
        return result;
      }, { chatIdentity });
      // 镜像到全局副本（尽力而为）：本聊天信封已落盘成功，全局写失败由回调内部处理，不上抛。
      this.dependencies.onSettingsReplaced?.(input.settings);
      return result!;
    });
  }

  async continueTask(): Promise<ContinuationHostTurnActionResult_ACU> {
    return this.withLease_ACU(async (chatIdentity, lease) => {
      let started: ContinuationEnvelope_ACU | null = null;
      await this.dependencies.store.updatePersistedAtomically(current => {
        const envelope = this.requireEnvelope_ACU(current);
        const chatLength = Array.isArray(getChatArray_ACU()) ? getChatArray_ACU().length : 0;
        const task = reconcileTaskCursorFromChat_ACU(this.requireTask_ACU(envelope), chatLength);
        // 等待宿主结果时只有"桥内存里仍有本次生成的活认领"才是真在飞；
        // 重载或事件丢失后的滞留等待轮无法再被归属，丢弃后从当前进度重新继续。
        const staleAwaitingTurn = task.pendingHostTurn?.status === 'awaiting_generation';
        if (staleAwaitingTurn && this.dependencies.hasLiveHostClaim?.(chatIdentity)) {
          fail_ACU('CONTINUATION_OPERATION_BUSY', '当前轮次正在等待宿主生成结果');
        }
        if (task.status === 'awaiting_outline_review' || task.status === 'stopping_after_inflight' || task.status === 'abandoned' || task.status === 'completed' || task.status === 'failed') {
          fail_ACU('CONTINUATION_TASK_STATE_INVALID', '当前任务不可继续');
        }
        // 可恢复的停止（手停、正文归属失败、输入不可用、重试耗尽）允许从当前进度恢复；
        // 终局停止（时长/阶段上限、completed）仍不可继续——放行只会立刻再次触发停止。
        if (task.stopReason !== null && !CONTINUATION_RECOVERABLE_STOP_REASONS_ACU.includes(task.stopReason)) {
          fail_ACU('CONTINUATION_TASK_STATE_INVALID', '已停止的任务不可继续');
        }
        const pending = task.pendingHostTurn;
        const promoteHostRetry = pending?.status === 'retry_ready'
          || (pending?.status === 'exhausted' && task.stopReason === 'generation_retry_exhausted');
        // 归属失败/输入不可用留下的 exhausted 仍清掉：那些场景不能安全 regenerate。
        const discardPending = staleAwaitingTurn || (pending?.status === 'exhausted' && !promoteHostRetry);
        // 无阶段（大纲待创建）与已完成阶段（下一阶段待继续）都可以进循环，由主 Agent 派工大纲子代理处理。
        const stage = task.activeStageId ? task.stages.find(item => item.stageId === task.activeStageId) ?? null : null;
        if (stage && stage.status !== 'completed' && (stage.status !== 'running' || !getActiveRevision_ACU(stage).frozen)) {
          fail_ACU('CONTINUATION_TASK_STATE_INVALID', '当前阶段不可继续');
        }
        const now = this.dependencies.now();
        if (task.deadlineAt !== null && now >= task.deadlineAt) {
          started = this.stopEnvelope_ACU({ ...envelope, activeTask: task }, 'duration_reached', now);
          return started;
        }
        const deadlineAt = task.deadlineAt ?? (envelope.settings.totalDurationMinutes > 0 ? now + envelope.settings.totalDurationMinutes * 60_000 : null);
        started = {
          ...envelope,
          activeTask: {
            ...task,
            status: 'running',
            runStartedAt: task.runStartedAt ?? now,
            deadlineAt,
            stopReason: null,
            lastError: null,
            updatedAt: now,
            pendingHostTurn: promoteHostRetry && pending
              ? { ...pending, status: 'retry_ready' }
              : discardPending ? null : pending,
          },
        };
        return started;
      }, { chatIdentity });
      const task = started!.activeTask!;
      if (task.status !== 'running') return taskResult_ACU(started!);
      if (task.pendingHostTurn?.status === 'retry_ready') {
        return { ...taskResult_ACU(started!), retryHostGeneration: true };
      }
      const controller = new AbortController();
      abortControllersByChat_ACU.set(chatIdentity, controller);
      try {
        const preparedTurn = await this.dependencies.executionEngine.prepareCurrentTurnInstruction(
          () => this.isLeaseCurrent_ACU(chatIdentity, lease),
          undefined,
          async instruction => (await this.applyOutlineOpWithinLease_ACU(chatIdentity, lease, instruction, 'running')).opResult,
          controller.signal,
        );
        return { ...taskResult_ACU(this.dependencies.store.readPersisted() ?? started!), preparedTurn };
      } catch (error) {
        await this.pauseWithError_ACU(chatIdentity, task.taskId, error, 'turn_call', '每轮指令生成失败');
        throw error;
      } finally {
        if (abortControllersByChat_ACU.get(chatIdentity) === controller) abortControllersByChat_ACU.delete(chatIdentity);
      }
    });
  }

  async retryCurrentTurn(): Promise<ContinuationHostTurnActionResult_ACU> {
    return this.withLease_ACU(async chatIdentity => {
      let started: ContinuationEnvelope_ACU | null = null;
      await this.dependencies.store.updatePersistedAtomically(current => {
        const envelope = this.requireEnvelope_ACU(current);
        const task = this.requireTask_ACU(envelope);
        if (task.pendingHostTurn?.status !== 'retry_ready') {
          fail_ACU('CONTINUATION_TASK_STATE_INVALID', '当前没有可重试的宿主正文轮次');
        }
        const now = this.dependencies.now();
        started = { ...envelope, activeTask: { ...task, status: 'running', stopReason: null, lastError: null, updatedAt: now } };
        return started;
      }, { chatIdentity });
      return { ...taskResult_ACU(started!), retryHostGeneration: true };
    });
  }

  /** Persists the host attribution boundary before the adapter writes the host textarea. */
  async recordHostTurn(input: RecordHostTurnInput_ACU): Promise<ContinuationOrchestratorResult_ACU> {
    const chatIdentity = this.requireChatIdentity_ACU();
    if (input.identity.chatIdentity !== chatIdentity) {
      throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'host_send', '宿主发送所属聊天已变化', false));
    }
    return this.withLease_ACU(async () => {
      let result: ContinuationEnvelope_ACU | null = null;
      await this.dependencies.store.updatePersistedAtomically(current => {
        const envelope = this.requireEnvelope_ACU(current);
        const task = this.requireTask_ACU(envelope);
        const existing = task.pendingHostTurn;
        const retrying = existing?.status === 'retry_ready';
        const statusOk = task.status === 'running' || (task.status === 'paused' && retrying);
        if (!statusOk || !identityMatchesCurrentTurn_ACU(task, input.identity) || (existing != null && !retrying)) {
          throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'host_send', '待发送正文已不属于当前轮次', false));
        }
        const retryCount = retrying ? existing.retryCount : 0;
        const now = this.dependencies.now();
        result = {
          ...envelope,
          activeTask: {
            ...task,
            status: 'running',
            updatedAt: now,
            pendingHostTurn: { identity: input.identity, capture: input.capture, retryCount, status: 'awaiting_generation' },
            timeline: [...task.timeline, this.timeline_ACU('turn_sent', now, { stageId: input.identity.stageId, revision: input.identity.revision, nodeId: input.identity.nodeId, turnId: input.identity.turnId, attemptId: input.identity.attemptId })],
          },
        };
        return result;
      }, { chatIdentity });
      return taskResult_ACU(result!);
    });
  }

  async pauseForHostInputFailure(identity: TurnAttemptIdentity_ACU): Promise<ContinuationOrchestratorResult_ACU> {
    return this.pauseHostTurn_ACU(identity, 'CONTINUATION_HOST_INPUT_UNAVAILABLE', '酒馆输入框或发送按钮不可用', 'host_input_unavailable');
  }

  /** Binds a generation sequence only after the host bridge observed a synchronous send-start event. */
  async bindHostTurnGeneration(identity: TurnAttemptIdentity_ACU, generationSeq: number): Promise<void> {
    const chatIdentity = this.requireChatIdentity_ACU();
    if (identity.chatIdentity !== chatIdentity) throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'host_send', '宿主生成所属聊天已变化', false));
    await this.withLease_ACU(async () => {
      await this.dependencies.store.updatePersistedAtomically(current => {
        const envelope = this.requireEnvelope_ACU(current);
        const task = this.requireTask_ACU(envelope);
        const pending = task.pendingHostTurn;
        if (!pending || pending.status !== 'awaiting_generation' || !identityMatchesCurrentTurn_ACU(task, identity) || pending.capture.generationSeq !== null) {
          throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'host_send', '宿主生成开始事件不属于当前轮次', false));
        }
        return { ...envelope, activeTask: { ...task, pendingHostTurn: { ...pending, capture: { ...pending.capture, generationSeq } } } };
      }, { chatIdentity });
    });
  }

  /**
   * 自动续写资格（只读）：一轮正文确认成功后，桥据此决定是否延迟触发下一轮。
   * 只有「暂停且无停止原因、无待处理正文、无遗留错误、阶段可继续」的任务才有资格；
   * 用户停止、时长/阶段数上限、大纲预览待确认、循环失败都会让资格消失。
   */
  readAutoContinueState(): { eligible: boolean; delaySeconds: number } {
    const envelope = this.dependencies.store.readPersisted();
    const task = envelope?.activeTask;
    if (!envelope || !task) return { eligible: false, delaySeconds: 0 };
    const stage = task.activeStageId ? task.stages.find(item => item.stageId === task.activeStageId) ?? null : null;
    const stageContinuable = !stage || ['running', 'completed'].includes(stage.status);
    const eligible = task.status === 'paused'
      && task.stopReason === null
      && task.lastError === null
      && !task.pendingHostTurn
      && stageContinuable;
    return { eligible, delaySeconds: Math.max(0, envelope.settings.loopDelaySeconds) };
  }

  /** Read-only bridge input; it never derives reload state or writes the envelope. */
  readPendingHostTurn(): ContinuationPendingHostTurnSnapshot_ACU | null {
    const envelope = this.dependencies.store.readPersisted();
    const task = envelope?.activeTask;
    if (!envelope || !task || !task.pendingHostTurn || task.pendingHostTurn.status === 'exhausted') return null;
    if (task.pendingHostTurn.identity.chatIdentity !== this.dependencies.getChatIdentity()) return null;
    return { settings: envelope.settings, pending: task.pendingHostTurn };
  }

  async pauseForHostResultFailure(identity: TurnAttemptIdentity_ACU): Promise<ContinuationOrchestratorResult_ACU> {
    return this.pauseHostTurn_ACU(identity, 'CONTINUATION_TASK_STATE_INVALID', '宿主正文无法唯一归属当前轮次', 'state_invalid');
  }

  async rejectHostTurnForMissingTags(input: RejectHostTurnInput_ACU): Promise<ContinuationOrchestratorResult_ACU> {
    const error = createContinuationError_ACU('CONTINUATION_GENERATION_TAGS_MISSING', 'generation_evaluate', '宿主正文缺少必需标签', true, { messageIndex: input.messageIndex });
    return this.rejectHostTurnAttempt_ACU(input.identity, error, input.messageIndex);
  }

  async rejectHostTurnForShortGeneration(input: RejectHostTurnInput_ACU & { tokenCount: number; threshold: number }): Promise<ContinuationOrchestratorResult_ACU> {
    const error = createContinuationError_ACU(
      'CONTINUATION_GENERATION_TOO_SHORT',
      'generation_evaluate',
      `宿主正文约 ${input.tokenCount} tokens，低于阈值 ${input.threshold}，视为截断或出错`,
      true,
      { messageIndex: input.messageIndex, tokenCount: input.tokenCount, threshold: input.threshold },
    );
    return this.rejectHostTurnAttempt_ACU(input.identity, error, input.messageIndex);
  }

  /**
   * 宿主生成失败或未产出正文（GENERATION_ENDED 到达但没有可归属的新 AI 楼层，典型如
   * 后端 API 报错）：与标签缺失同构地消耗一次重试额度并转 retry_ready，由桥按重试
   * 延迟自动重发当前轮；额度耗尽落 generation_retry_exhausted（可手动继续恢复）。
   * 没有楼层被写入宿主，重发不会产生重复正文。
   */
  async rejectHostTurnForFailedGeneration(identity: TurnAttemptIdentity_ACU): Promise<ContinuationOrchestratorResult_ACU> {
    const error = createContinuationError_ACU('CONTINUATION_GENERATION_FAILED', 'generation_evaluate', '宿主生成失败或未产出正文，将自动重试当前轮次', true);
    return this.rejectHostTurnAttempt_ACU(identity, error);
  }

  /**
   * 登记一次失败的正文尝试（标签缺失 / 生成失败共用的事务核心）：
   * 未达 generationRetryLimit 时 retryCount+1 并转 retry_ready（桥读到后自动重发）；
   * 达到上限时落 generation_retry_exhausted + exhausted（可手动继续恢复）。
   * @param identity 当前轮次尝试身份
   * @param error 本次失败的错误对象（retryable=true，耗尽时改写为 false）
   * @param messageIndex 失败正文的楼层号；生成未产出楼层时省略
   */
  private async rejectHostTurnAttempt_ACU(identity: TurnAttemptIdentity_ACU, error: ContinuationError_ACU, messageIndex?: number): Promise<ContinuationOrchestratorResult_ACU> {
    const chatIdentity = this.requireChatIdentity_ACU();
    if (identity.chatIdentity !== chatIdentity) {
      throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'generation_evaluate', '正文结果所属聊天已变化', false));
    }
    return this.withLease_ACU(async () => {
      let result: ContinuationEnvelope_ACU | null = null;
      await this.dependencies.store.updatePersistedAtomically(current => {
        const envelope = this.requireEnvelope_ACU(current);
        const task = this.requireTask_ACU(envelope);
        const pending = task.pendingHostTurn;
        if (task.status !== 'running' || !pending || pending.status !== 'awaiting_generation' || !identityMatchesCurrentTurn_ACU(task, identity)) {
          throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'generation_evaluate', '正文失败登记已不属于当前轮次', false));
        }
        const now = this.dependencies.now();
        const timelineFields = { stageId: identity.stageId, revision: identity.revision, nodeId: identity.nodeId, turnId: identity.turnId, attemptId: identity.attemptId, ...(messageIndex !== undefined ? { messageIndex } : {}), errorCode: error.code };
        if (pending.retryCount >= envelope.settings.generationRetryLimit) {
          result = { ...envelope, activeTask: { ...task, status: 'paused', updatedAt: now, stopReason: 'generation_retry_exhausted', lastError: { ...error, retryable: false }, pendingHostTurn: { ...pending, status: 'exhausted' }, timeline: [...task.timeline, this.timeline_ACU('failed', now, timelineFields)] } };
          return result;
        }
        result = { ...envelope, activeTask: { ...task, status: 'paused', updatedAt: now, lastError: error, pendingHostTurn: { ...pending, retryCount: pending.retryCount + 1, status: 'retry_ready' }, timeline: [...task.timeline, this.timeline_ACU('turn_retry', now, timelineFields)] } };
        return result;
      }, { chatIdentity });
      return taskResult_ACU(result!);
    });
  }

  /**
   * 宿主生成被用户中止（GENERATION_STOPPED）：等待轮转 retry_ready 并暂停任务。
   * 不消耗重试次数（中止是用户行为，不是模型产出不合格），不设 stopReason，
   * 用户可以直接重试当前轮次或继续任务。
   */
  async failHostTurnForStoppedGeneration(identity: TurnAttemptIdentity_ACU): Promise<ContinuationOrchestratorResult_ACU> {
    const chatIdentity = this.requireChatIdentity_ACU();
    if (identity.chatIdentity !== chatIdentity) {
      throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'generation_evaluate', '生成中止事件所属聊天已变化', false));
    }
    return this.withLease_ACU(async () => {
      let result: ContinuationEnvelope_ACU | null = null;
      await this.dependencies.store.updatePersistedAtomically(current => {
        const envelope = this.requireEnvelope_ACU(current);
        const task = this.requireTask_ACU(envelope);
        const pending = task.pendingHostTurn;
        if (task.status !== 'running' || !pending || pending.status !== 'awaiting_generation' || !identityMatchesCurrentTurn_ACU(task, identity)) {
          throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'generation_evaluate', '生成中止事件已不属于当前轮次', false));
        }
        const now = this.dependencies.now();
        const error = createContinuationError_ACU('CONTINUATION_TASK_STATE_INVALID', 'generation_evaluate', '宿主生成被中止，可重试当前轮次', true);
        result = { ...envelope, activeTask: { ...task, status: 'paused', updatedAt: now, lastError: error, pendingHostTurn: { ...pending, status: 'retry_ready' }, timeline: [...task.timeline, this.timeline_ACU('turn_retry', now, { stageId: identity.stageId, revision: identity.revision, nodeId: identity.nodeId, turnId: identity.turnId, attemptId: identity.attemptId, errorCode: error.code })] } };
        return result;
      }, { chatIdentity });
      return taskResult_ACU(result!);
    });
  }

  /** T9 calls this only after uniquely attributing a successful host generation to identity. */
  async confirmCurrentTurn(identity: TurnAttemptIdentity_ACU, messageIndex?: number): Promise<ContinuationOrchestratorResult_ACU> {
    const chatIdentity = this.requireChatIdentity_ACU();
    if (identity.chatIdentity !== chatIdentity) {
      throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'generation_evaluate', '正文结果所属聊天已变化', false));
    }
    return this.withLease_ACU(async (_currentChatIdentity, lease) => {
      const preEnvelope = this.requireEnvelope_ACU(this.dependencies.store.readPersisted());
      const preTask = this.requireTask_ACU(preEnvelope);
      if (preTask.status !== 'running' || preTask.pendingHostTurn?.status !== 'awaiting_generation' || !identityMatchesCurrentTurn_ACU(preTask, identity)) {
        throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'generation_evaluate', '正文结果已不属于当前轮次', false));
      }
      this.assertLeaseCurrent_ACU(chatIdentity, lease);
      let advanced: ContinuationEnvelope_ACU | null = null;
      await this.dependencies.store.updatePersistedAtomically(current => {
        const envelope = this.requireEnvelope_ACU(current);
        const task = this.requireTask_ACU(envelope);
        if (task.status !== 'running' || task.pendingHostTurn?.status !== 'awaiting_generation' || !identityMatchesCurrentTurn_ACU(task, identity)) {
          throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'generation_evaluate', '正文结果已不属于当前轮次', false));
        }
        const now = this.dependencies.now();
        const stage = getActiveStage_ACU(task);
        const isLastTurn = stage.completedTurns + 1 === getActiveRevision_ACU(stage).outline.totalTurns;
        const progressed = advanceConfirmedTurn_ACU(task, now, this.timeline_ACU.bind(this), messageIndex);
        const completedTurn: ContinuationTask_ACU = {
          ...progressed,
          pendingHostTurn: null,
          lastError: null,
          stopReason: null,
        };
        if (!isLastTurn) {
          // 轮边界统一落 paused：自动续写从这个可判定状态出发，页面重载后也能手动恢复。
          advanced = { ...envelope, activeTask: { ...completedTurn, status: 'paused', updatedAt: now } };
          return advanced;
        }
        if (task.deadlineAt !== null && now >= task.deadlineAt) {
          advanced = this.stopEnvelope_ACU({ ...envelope, activeTask: completedTurn }, 'duration_reached', now);
          return advanced;
        }
        if (automaticStagesInWindow_ACU(task) >= envelope.settings.maxAutomaticStages) {
          advanced = this.stopEnvelope_ACU({ ...envelope, activeTask: completedTurn }, 'stage_limit_reached', now);
          return advanced;
        }
        // 下一阶段的大纲由主 Agent 在下一次继续时派工大纲子代理创建，这里只落到可继续的暂停态。
        advanced = { ...envelope, activeTask: { ...completedTurn, status: 'paused', updatedAt: now } };
        return advanced;
      }, { chatIdentity });
      return taskResult_ACU(advanced!);
    });
  }

  async stopTask(): Promise<ContinuationOrchestratorResult_ACU> {
    const chatIdentity = this.requireChatIdentity_ACU();
    const task = this.requireTask_ACU(this.requireEnvelope_ACU(this.dependencies.store.readPersisted()));
    const guard = guardForTask_ACU(chatIdentity, task);
    this.invalidateLease_ACU(chatIdentity);
    return this.withLease_ACU(async () => {
      let stopped: ContinuationEnvelope_ACU | null = null;
      await this.dependencies.store.updatePersistedAtomically(current => {
        const envelope = this.requireEnvelope_ACU(current);
        stopped = this.stopEnvelope_ACU(envelope, 'manual', this.dependencies.now());
        return stopped;
      }, guard);
      return taskResult_ACU(stopped!);
    });
  }

  /**
   * 在 Agent 会话里以用户身份说话。这是「像 coding agent 一样交互」的唯一入口。
   *
   * 三种情形：没有任务时等价于创建任务并把这句话作为初始要求；空闲时把消息记进会话记录；
   * 循环正在跑时先中断在途请求再记消息——中断后主 Agent 下一次迭代会带着这条消息重新开始，
   * 已完成的派工结论由 run cache 保留，不会白跑。
   * @param input 用户输入的文本
   * @returns 任务快照与「调用方是否应接着继续跑循环」的判定
   */
  async sendAgentMessage(input: SendAgentMessageInput_ACU): Promise<SendAgentMessageResult_ACU> {
    const text = normalizeOriginInstruction_ACU(input.text);
    const chatIdentity = this.requireChatIdentity_ACU();
    const existing = this.dependencies.store.readPersisted()?.activeTask ?? null;
    const hasLiveTask = !!existing && !['completed', 'abandoned', 'failed'].includes(existing.status);
    if (!hasLiveTask) {
      const created = await this.createTask({ originInstruction: text });
      await this.recordUserMessage_ACU(text, '创建续写任务', true);
      let envelope: ContinuationEnvelope_ACU | null = null;
      await this.withLease_ACU(async () => {
        await this.dependencies.store.updatePersistedAtomically(current => {
          const currentEnvelope = this.requireEnvelope_ACU(current);
          const task = this.requireTask_ACU(currentEnvelope);
          if (task.taskId !== created.task.taskId) {
            throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'agent_persist', '创建后的续写任务已被其他操作替换', false));
          }
          const now = this.dependencies.now();
          envelope = {
            ...currentEnvelope,
            activeTask: {
              ...task,
              status: 'paused',
              updatedAt: now,
              runStartedAt: now,
              deadlineAt: deadlineForNewRunWindow_ACU(currentEnvelope.settings, now),
              stageBudgetBaseCount: task.runStageCount,
              stopReason: null,
              lastError: null,
            },
          };
          return envelope;
        }, guardForTask_ACU(chatIdentity, created.task));
      });
      return { ...taskResult_ACU(envelope!), created: true, interrupted: false, disposition: 'continue_now', shouldContinue: true };
    }

    const initialMessageDigest = existing!.status === 'running' && existing!.pendingHostTurn?.status !== 'awaiting_generation'
      ? '打断并插话'
      : '会话输入';
    await this.recordUserMessage_ACU(text, initialMessageDigest, true);
    const beforeResume = this.requireTask_ACU(this.requireEnvelope_ACU(this.dependencies.store.readPersisted()));
    if (beforeResume.taskId !== existing!.taskId) {
      throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'agent_persist', '用户消息写入期间续写任务已变化', false));
    }
    const hasLiveHostClaim = beforeResume.pendingHostTurn?.status === 'awaiting_generation'
      && this.dependencies.hasLiveHostClaim?.(chatIdentity) === true;
    if (hasLiveHostClaim) {
      return { ...taskResult_ACU(this.requireEnvelope_ACU(this.dependencies.store.readPersisted())), created: false, interrupted: false, disposition: 'queued_after_host', shouldContinue: false };
    }
    const blockDetail = userMessageResumeBlockDetail_ACU(beforeResume);
    if (blockDetail) {
      return { ...taskResult_ACU(this.requireEnvelope_ACU(this.dependencies.store.readPersisted())), created: false, interrupted: false, disposition: 'accepted_without_resume', detail: blockDetail, shouldContinue: false };
    }
    const wasRunning = beforeResume.status === 'running' && beforeResume.pendingHostTurn?.status !== 'awaiting_generation';
    if (wasRunning) this.invalidateLease_ACU(chatIdentity);


    let envelope: ContinuationEnvelope_ACU | null = null;
    let disposition: SendAgentMessageDisposition_ACU = 'continue_now';
    let detail: string | undefined;
    await this.withLease_ACU(async () => {
      await this.dependencies.store.updatePersistedAtomically(current => {
        const currentEnvelope = this.requireEnvelope_ACU(current);
        const task = this.requireTask_ACU(currentEnvelope);
        if (task.taskId !== beforeResume.taskId) {
          throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'agent_persist', '用户消息恢复前提已失效', false));
        }
        const liveHostClaim = task.pendingHostTurn?.status === 'awaiting_generation'
          && this.dependencies.hasLiveHostClaim?.(chatIdentity) === true;
        if (liveHostClaim) {
          disposition = 'queued_after_host';
          envelope = currentEnvelope;
          return currentEnvelope;
        }
        const currentBlockDetail = userMessageResumeBlockDetail_ACU(task);
        if (currentBlockDetail) {
          disposition = 'accepted_without_resume';
          detail = currentBlockDetail;
          envelope = currentEnvelope;
          return currentEnvelope;
        }
        const now = this.dependencies.now();
        const staleAwaitingTurn = task.pendingHostTurn?.status === 'awaiting_generation';
        envelope = {
          ...currentEnvelope,
          activeTask: {
            ...task,
            status: 'paused',
            updatedAt: now,
            runStartedAt: now,
            deadlineAt: deadlineForNewRunWindow_ACU(currentEnvelope.settings, now),
            stageBudgetBaseCount: task.runStageCount,
            stopReason: null,
            lastError: null,
            ...(staleAwaitingTurn ? { pendingHostTurn: null } : {}),
          },
        };
        return envelope;
      }, guardForTask_ACU(chatIdentity, beforeResume));
    });

    return {
      ...taskResult_ACU(envelope!),
      created: false,
      interrupted: disposition === 'continue_now' && wasRunning,
      disposition,
      ...(detail ? { detail } : {}),
      shouldContinue: disposition === 'continue_now',
    };
  }

  /**
   * 用户在资料界面手动改写当前阶段大纲后保存。
   *
   * 走与 Agent 工具编辑完全相同的校验：已完成轮次不可改、当前执行轮不可删、总轮数必须留在
   * 阶段规模范围内。这样「用户编辑」不会成为绕过大纲一致性约束的后门。
   * @param input 用户编辑后的完整大纲
   * @returns 任务快照
   */
  async replaceActiveOutline(input: ReplaceActiveOutlineInput_ACU): Promise<ContinuationOrchestratorResult_ACU> {
    return this.withLease_ACU(async chatIdentity => {
      const envelope = this.requireEnvelope_ACU(this.dependencies.store.readPersisted());
      const task = this.requireTask_ACU(envelope);
      if (task.status === 'running' || task.status === 'stopping_after_inflight') {
        fail_ACU('CONTINUATION_OPERATION_BUSY', '循环正在运行，请先停止再手动编辑大纲');
      }
      const stage = getActiveStage_ACU(task);
      const current = getActiveRevision_ACU(stage);
      if (stage.status !== 'running' || !current.frozen) {
        fail_ACU('CONTINUATION_TASK_STATE_INVALID', '当前没有可手动编辑的已冻结大纲');
      }
      await this.commitEditedOutline_ACU(chatIdentity, envelope, task, stage, current, cloneOutline_ACU(input.outline), '用户手动编辑', '已保存手动编辑的大纲（', 'paused');
      return taskResult_ACU(this.requireEnvelope_ACU(this.dependencies.store.readPersisted()));
    });
  }

  /**
   * 一键清空：丢弃当前任务、Agent 会话记录与本地资料快照，回到「可以从当前剧情重新规划」的状态。
   * 绝不触碰任何正文楼层——清掉的只有本插件写在楼层上的扩展字段与首楼信封里的任务。
   * @returns 清空后的信封与各项是否真的有内容被清除
   */
  async clearContinuationData(): Promise<ClearContinuationDataResult_ACU> {
    const chatIdentity = this.requireChatIdentity_ACU();
    const existing = this.dependencies.store.readPersisted()?.activeTask ?? null;
    this.invalidateLease_ACU(chatIdentity);
    const envelope = await this.withLease_ACU(async () => {
      let result: ContinuationEnvelope_ACU | null = null;
      await this.dependencies.store.updatePersistedAtomically(current => {
        const currentEnvelope = this.requireEnvelope_ACU(current);
        result = { ...currentEnvelope, activeTask: null };
        return result;
      }, guardForTask_ACU(chatIdentity, existing));
      return result!;
    });
    clearAgentRunState_ACU(chatIdentity);
    const clearedModules = await (this.dependencies.clearAgentModules ?? clearAgentModuleField_ACU)();
    const clearedConversation = await (this.dependencies.clearAgentConversation ?? clearAgentConversationField_ACU)();
    clearAgentSessionLog_ACU();
    return { envelope, clearedModules, clearedConversation };
  }

  async replanRemaining(input: ReplanContinuationInput_ACU = {}): Promise<ContinuationOrchestratorResult_ACU> {
    const replanInstruction = typeof input.instruction === 'string' ? input.instruction.trim() : '';
    const chatIdentity = this.requireChatIdentity_ACU();
    this.invalidateLease_ACU(chatIdentity);
    if (replanInstruction) await this.recordUserMessage_ACU(replanInstruction, '要求重新规划大纲');
    return this.withLease_ACU(async (_identity, lease) => {
      const taskId = this.requireTask_ACU(this.requireEnvelope_ACU(this.dependencies.store.readPersisted())).taskId;
      try {
        const outcome = await this.applyOutlineOpWithinLease_ACU(chatIdentity, lease, replanInstruction, 'paused');
        return taskResult_ACU(outcome.envelope, outcome.planning);
      } catch (error) {
        await this.pauseWithError_ACU(chatIdentity, taskId, error, 'outline_call', '阶段规划失败');
        throw error;
      }
    });
  }

  /**
   * 大纲操作事务内核：按 envelope 当前状态推断创建 / 维护 / 继续三种操作。
   * 主 Agent 循环通过 continueTask 注入的回调调用（endStatus='running'，租约由 continueTask 持有），
   * UI 的重新规划通过 replanRemaining 调用（endStatus='paused'）。withLease_ACU 不可重入，
   * 因此这里绝不获取租约，只使用调用方已持有的。
   * @param chatIdentity 当前聊天身份
   * @param lease 调用方已持有的租约
   * @param instruction 主 Agent 或用户给大纲子代理的要求
   * @param endStatus 操作成功后任务的落点状态；需要预览确认时一律 awaiting_outline_review
   * @returns 操作结果、最新 envelope 与规划摘要
   */
  async applyOutlineOpWithinLease_ACU(chatIdentity: string, lease: Lease_ACU, instruction: string, endStatus: 'running' | 'paused'): Promise<{ opResult: AgentOutlineOpResult_ACU; envelope: ContinuationEnvelope_ACU; planning?: ContinuationOrchestratorResult_ACU['planning'] }> {
    const envelope = this.requireEnvelope_ACU(this.dependencies.store.readPersisted());
    const task = this.requireTask_ACU(envelope);
    if (task.stopReason !== null) fail_ACU('CONTINUATION_TASK_STATE_INVALID', '已停止的任务不可规划大纲');
    const stage = task.activeStageId ? task.stages.find(item => item.stageId === task.activeStageId) ?? null : null;
    if (!stage) return this.createOutlineOp_ACU(chatIdentity, lease, envelope, task, instruction, endStatus);
    if (stage.status === 'completed') return this.continueOutlineOp_ACU(chatIdentity, lease, envelope, task, stage, instruction, endStatus);
    if (stage.status === 'running' || stage.status === 'failed') return this.reviseOutlineOp_ACU(chatIdentity, lease, envelope, task, stage, instruction, endStatus);
    fail_ACU('CONTINUATION_TASK_STATE_INVALID', '当前阶段状态不允许大纲操作');
  }

  /**
   * 大纲句级编辑事务：供 UI 等可信租约内入口直接增删改未完成部分的句子。
   * 结构一致性由运行时收尾（重算 suggestedTurns/totalTurns），完成前缀与当前轮由校验强制保护，
   * 编辑结果生成下一个 revision 并立即冻结。校验失败抛 CONTINUATION_AGENT_WRITE_REJECTED，
   * 主 Agent 文本协议不调用本事务；大纲问题由它委派 outline-architect 处理。
   */
  async applyOutlineEditsWithinLease_ACU(chatIdentity: string, _lease: Lease_ACU, edits: readonly AgentOutlineEditOp_ACU[], endStatus: 'running' | 'paused'): Promise<{ summary: string }> {
    const envelope = this.requireEnvelope_ACU(this.dependencies.store.readPersisted());
    const task = this.requireTask_ACU(envelope);
    if (task.stopReason !== null) fail_ACU('CONTINUATION_TASK_STATE_INVALID', '已停止的任务不可编辑大纲');
    const stage = task.activeStageId ? task.stages.find(item => item.stageId === task.activeStageId) ?? null : null;
    if (!stage || stage.status !== 'running') {
      throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_WRITE_REJECTED', 'agent_loop', '当前没有可编辑的执行中大纲；请先派工 outline-architect 创建或继续大纲', false));
    }
    const current = getActiveRevision_ACU(stage);
    if (!current.frozen) {
      throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_WRITE_REJECTED', 'agent_loop', '当前大纲尚未冻结（可能等待确认），不可编辑', false));
    }
    const edited = applyOutlineEditOps_ACU(current.outline, edits, this.dependencies.allocateId);
    return this.commitEditedOutline_ACU(chatIdentity, envelope, task, stage, current, edited, `Agent 工具编辑：${edits.length} 处`, `已按工具编辑改写大纲（${edits.length} 处`, endStatus, true);
  }

  /**
   * 把一份直接改好的大纲提交为下一个已冻结 revision。
   *
   * 工具编辑与用户手动编辑共用这条路径：两者的差别只是「怎么得到候选大纲」，
   * 之后的当前轮保护、前缀保护、轮数范围校验与落盘必须完全一致，否则手动编辑就成了绕过校验的后门。
   * @param chatIdentity 当前聊天身份
   * @param envelope 读到候选大纲时的信封
   * @param task 当时的任务
   * @param stage 当时的活动阶段
   * @param current 被替换的 revision
   * @param candidate 候选大纲
   * @param reasonNote 写入 revision 的来源说明
   * @param summaryHead 回执摘要前半段，函数负责补上 revision 与轮数
   * @param endStatus 落盘后任务状态
   * @param enforcePacing 是否复核剩余轮次的节奏配比。只对 Agent 工具编辑开启：
   *   用户手改大纲是最终裁量权，被节奏规则挡住会让人存不下自己的编辑。
   * @returns 回执摘要
   */
  private async commitEditedOutline_ACU(
    chatIdentity: string,
    envelope: ContinuationEnvelope_ACU,
    task: ContinuationTask_ACU,
    stage: ContinuationStage_ACU,
    current: StageRevision_ACU,
    candidate: StageOutline_ACU,
    reasonNote: string,
    summaryHead: string,
    endStatus: 'running' | 'paused',
    enforcePacing = false,
  ): Promise<{ summary: string }> {
    const oldCursorTurn = current.outline.nodes.flatMap(node => node.turns)[stage.completedTurns] ?? null;
    const newFlattened = candidate.nodes.flatMap(node => node.turns);
    const newCursorTurn = newFlattened[stage.completedTurns] ?? null;
    if (!oldCursorTurn || !newCursorTurn || newCursorTurn.id !== oldCursorTurn.id) {
      throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_WRITE_REJECTED', 'agent_loop', '编辑不能移除或替换当前正在执行的轮次（可以改它的目标句）', false, { cursorTurnId: oldCursorTurn?.id ?? null }));
    }
    const range = resolveContinuationTurnRange_ACU(envelope.settings.stageSize, envelope.settings.customTurnMin ?? undefined, envelope.settings.customTurnMax ?? undefined);
    const validated = validateReplannedStageOutline_ACU(candidate, range, {
      previousOutline: current.outline,
      completedTurns: stage.completedTurns,
      expectedRemainingTurns: newFlattened.length - stage.completedTurns,
    });
    if (enforcePacing) {
      // 编辑通道同样要过节奏配比，否则 outline-architect 那边的硬校验可以被 edit_outline 绕开。
      // 抛出的 outline_validate 错误在主循环里会直接中止本轮，转成写入拒绝才能回灌给主 Agent 自愈。
      const pacingContext = resolveStageOutlinePacingContext_ACU(task.stages, stage.stageId);
      try {
        validateStageOutlinePacing_ACU(listStageOutlineTurns_ACU(validated), {
          tempo: validated.tempo,
          previousTempo: pacingContext.previousTempo,
          leadingPressureStreak: pacingContext.leadingPressureStreak,
          maxConsecutivePressureTurns: envelope.settings.maxConsecutivePressureTurns,
          skipTurns: stage.completedTurns,
        });
      } catch (error) {
        if (!(error instanceof ContinuationValidationError_ACU)) throw error;
        rejectOutlineEdit_ACU(error.error.message, error.error.details ?? undefined);
      }
    }
    const nextRevisionNumber = current.revision + 1;
    const summary = `${summaryHead}，revision ${nextRevisionNumber}，共 ${validated.totalTurns} 轮）`;
    await this.dependencies.store.updatePersistedAtomically(currentEnvelope => {
      const env = this.requireEnvelope_ACU(currentEnvelope);
      const t = this.requireTask_ACU(env);
      const activeStage = getActiveStage_ACU(t);
      if (t.taskId !== task.taskId || activeStage.stageId !== stage.stageId || activeStage.activeRevision !== current.revision || t.stopReason !== null) {
        fail_ACU('CONTINUATION_TASK_STATE_INVALID', '大纲编辑结果已失效');
      }
      const at = this.dependencies.now();
      const revision = freezePlannedStageRevision_ACU(createPlannedStageRevision_ACU(validated, nextRevisionNumber, 'manual_replan', reasonNote, at));
      const nextStage = { ...activeStage, activeRevision: nextRevisionNumber, revisions: [...activeStage.revisions, revision] };
      return { ...env, activeTask: { ...t, status: endStatus, updatedAt: at, lastError: null, stages: t.stages.map(item => item.stageId === nextStage.stageId ? nextStage : item), timeline: [...t.timeline, this.timeline_ACU('outline_ready', at, { stageId: nextStage.stageId, revision: nextRevisionNumber })] } };
    }, guardForTask_ACU(chatIdentity, task));
    return { summary };
  }

  /** 创建首个阶段大纲。单阶段事务：先规划后一次性落盘，失败不留任何中间状态。 */
  private async createOutlineOp_ACU(chatIdentity: string, lease: Lease_ACU, envelope: ContinuationEnvelope_ACU, task: ContinuationTask_ACU, instruction: string, endStatus: 'running' | 'paused'): Promise<{ opResult: AgentOutlineOpResult_ACU; envelope: ContinuationEnvelope_ACU; planning?: ContinuationOrchestratorResult_ACU['planning'] }> {
    const stageId = this.dependencies.allocateId('stage');
    const context: ContinuationPlanningContext_ACU = { envelope, task, stage: null, reason: 'initial', replanInstruction: instruction };
    const planned = await this.planOutline_ACU(context, chatIdentity, lease, stageId, 1);
    this.assertLeaseCurrent_ACU(chatIdentity, lease);
    const stageNumber = task.runStageCount + 1;
    let result: ContinuationEnvelope_ACU | null = null;
    await this.dependencies.store.updatePersistedAtomically(current => {
      const env = this.requireEnvelope_ACU(current);
      const t = this.requireTask_ACU(env);
      if (t.taskId !== task.taskId || t.activeStageId !== null || t.stopReason !== null) {
        throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'outline_call', '大纲创建前提已失效', false));
      }
      const now = this.dependencies.now();
      const revision = createPlannedStageRevision_ACU(planned.outline, 1, 'initial', instruction, now);
      const nextStage = stageForOutline_ACU(stageId, stageNumber, planned.requiresReview ? revision : acceptPlannedStageRevision_ACU(revision, env.settings), planned.requiresReview ? 'awaiting_review' : 'running');
      result = { ...env, activeTask: { ...t, status: planned.requiresReview ? 'awaiting_outline_review' : endStatus, updatedAt: now, activeStageId: stageId, runStageCount: stageNumber, stages: [...t.stages, nextStage], lastError: null, timeline: [...t.timeline, this.timeline_ACU('outline_ready', now, { stageId, revision: 1 })] } };
      return result;
    }, guardForTask_ACU(chatIdentity, task));
    return {
      opResult: { op: 'create', requiresReview: planned.requiresReview, stopped: null, summary: `已创建第 ${stageNumber} 阶段大纲「${planned.outline.title}」（共 ${planned.outline.totalTurns} 轮）` },
      envelope: result!,
      planning: this.planningSummary_ACU(planned),
    };
  }

  /** 当前阶段已完成时继续下一阶段大纲。先做停止判定，任务被停止时不再规划。 */
  private async continueOutlineOp_ACU(chatIdentity: string, lease: Lease_ACU, envelope: ContinuationEnvelope_ACU, task: ContinuationTask_ACU, stage: ContinuationStage_ACU, instruction: string, endStatus: 'running' | 'paused'): Promise<{ opResult: AgentOutlineOpResult_ACU; envelope: ContinuationEnvelope_ACU; planning?: ContinuationOrchestratorResult_ACU['planning'] }> {
    const now = this.dependencies.now();
    if (task.deadlineAt !== null && now >= task.deadlineAt) {
      const stopped = this.stopEnvelope_ACU(envelope, 'duration_reached', now);
      await this.dependencies.store.replaceAtomically(stopped, guardForTask_ACU(chatIdentity, task));
      return { opResult: { op: 'continue', requiresReview: false, stopped: 'duration_reached', summary: '总时长已到，任务已停止，不再创建下一阶段' }, envelope: stopped };
    }
    if (automaticStagesInWindow_ACU(task) >= envelope.settings.maxAutomaticStages) {
      const stopped = this.stopEnvelope_ACU(envelope, 'stage_limit_reached', now);
      await this.dependencies.store.replaceAtomically(stopped, guardForTask_ACU(chatIdentity, task));
      return { opResult: { op: 'continue', requiresReview: false, stopped: 'stage_limit_reached', summary: '阶段数已达上限，任务已停止，不再创建下一阶段' }, envelope: stopped };
    }
    const nextStageId = this.dependencies.allocateId('stage');
    const context: ContinuationPlanningContext_ACU = { envelope, task, stage: null, reason: 'auto_next_stage', replanInstruction: instruction };
    const planned = await this.planOutline_ACU(context, chatIdentity, lease, nextStageId, 1);
    this.assertLeaseCurrent_ACU(chatIdentity, lease);
    const stageNumber = task.runStageCount + 1;
    let result: ContinuationEnvelope_ACU | null = null;
    await this.dependencies.store.updatePersistedAtomically(current => {
      const env = this.requireEnvelope_ACU(current);
      const t = this.requireTask_ACU(env);
      const completedStage = t.activeStageId ? t.stages.find(item => item.stageId === t.activeStageId) : null;
      if (t.taskId !== task.taskId || completedStage?.stageId !== stage.stageId || completedStage.status !== 'completed' || t.stopReason !== null) {
        throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'outline_call', '下一阶段规划前提已失效', false));
      }
      const at = this.dependencies.now();
      const revision = createPlannedStageRevision_ACU(planned.outline, 1, 'auto_next_stage', instruction, at);
      const nextStage = stageForOutline_ACU(nextStageId, stageNumber, planned.requiresReview ? revision : acceptPlannedStageRevision_ACU(revision, env.settings), planned.requiresReview ? 'awaiting_review' : 'running');
      result = { ...env, activeTask: { ...t, status: planned.requiresReview ? 'awaiting_outline_review' : endStatus, updatedAt: at, activeStageId: nextStageId, runStageCount: stageNumber, stages: [...t.stages, nextStage], lastError: null, timeline: [...t.timeline, this.timeline_ACU('outline_ready', at, { stageId: nextStageId, revision: 1 })] } };
      return result;
    }, guardForTask_ACU(chatIdentity, task));
    return {
      opResult: { op: 'continue', requiresReview: planned.requiresReview, stopped: null, summary: `已继续大纲：第 ${stageNumber} 阶段「${planned.outline.title}」（共 ${planned.outline.totalTurns} 轮）` },
      envelope: result!,
      planning: this.planningSummary_ACU(planned),
    };
  }

  /** 改写当前阶段剩余部分。完成前缀保护由 schema 校验强制：已完成轮次不可被改掉。 */
  private async reviseOutlineOp_ACU(chatIdentity: string, lease: Lease_ACU, envelope: ContinuationEnvelope_ACU, task: ContinuationTask_ACU, stage: ContinuationStage_ACU, instruction: string, endStatus: 'running' | 'paused'): Promise<{ opResult: AgentOutlineOpResult_ACU; envelope: ContinuationEnvelope_ACU; planning?: ContinuationOrchestratorResult_ACU['planning'] }> {
    if (!['running', 'paused', 'failed'].includes(task.status)) {
      fail_ACU('CONTINUATION_TASK_STATE_INVALID', '当前任务状态不可改写大纲');
    }
    const current = getActiveRevision_ACU(stage);
    const constraints: ContinuationReplanConstraints_ACU = { previousOutline: current.outline, completedTurns: stage.completedTurns, expectedRemainingTurns: current.outline.totalTurns - stage.completedTurns };
    const context: ContinuationPlanningContext_ACU = { envelope, task, stage, reason: 'manual_replan', replanInstruction: instruction };
    const nextRevisionNumber = current.revision + 1;
    const planned = await this.planOutline_ACU(context, chatIdentity, lease, stage.stageId, nextRevisionNumber, constraints);
    this.assertLeaseCurrent_ACU(chatIdentity, lease);
    let result: ContinuationEnvelope_ACU | null = null;
    await this.dependencies.store.updatePersistedAtomically(currentEnvelope => {
      const env = this.requireEnvelope_ACU(currentEnvelope);
      const t = this.requireTask_ACU(env);
      const activeStage = getActiveStage_ACU(t);
      if (t.taskId !== task.taskId || activeStage.stageId !== stage.stageId || activeStage.activeRevision !== current.revision || t.stopReason !== null) {
        fail_ACU('CONTINUATION_TASK_STATE_INVALID', '重新规划结果已失效');
      }
      const at = this.dependencies.now();
      const pending = createPlannedStageRevision_ACU(cloneOutline_ACU(planned.outline), nextRevisionNumber, 'manual_replan', instruction, at);
      // 剩余轮数额度已放宽：复核约束按规划结果的实际轮数重建，前缀保护仍以旧大纲为基准。
      const acceptConstraints: ContinuationReplanConstraints_ACU = { previousOutline: current.outline, completedTurns: stage.completedTurns, expectedRemainingTurns: planned.outline.totalTurns - stage.completedTurns };
      const accepted = planned.requiresReview ? pending : acceptPlannedStageRevision_ACU(pending, env.settings, acceptConstraints);
      const nextStage = { ...activeStage, status: (planned.requiresReview ? 'awaiting_review' : 'running') as ContinuationStage_ACU['status'], activeRevision: nextRevisionNumber, revisions: [...activeStage.revisions, accepted] };
      result = { ...env, activeTask: { ...t, status: planned.requiresReview ? 'awaiting_outline_review' : endStatus, updatedAt: at, lastError: null, stages: t.stages.map(item => item.stageId === nextStage.stageId ? nextStage : item), timeline: [...t.timeline, this.timeline_ACU('outline_ready', at, { stageId: nextStage.stageId, revision: nextRevisionNumber })] } };
      return result;
    }, guardForTask_ACU(chatIdentity, task));
    return {
      opResult: { op: 'revise', requiresReview: planned.requiresReview, stopped: null, summary: `已改写第 ${stage.stageNumber} 阶段大纲（revision ${nextRevisionNumber}，已完成的 ${stage.completedTurns} 轮保持不变）` },
      envelope: result!,
      planning: this.planningSummary_ACU(planned),
    };
  }

  async abandonAndCreate(input: CreateContinuationTaskInput_ACU & { confirmAbandon?: boolean }): Promise<ContinuationOrchestratorResult_ACU> {
    if (input.confirmAbandon !== true) {
      fail_ACU('CONTINUATION_TASK_STATE_INVALID', '放弃当前任务并新建必须经过明确确认');
    }
    const chatIdentity = this.requireChatIdentity_ACU();
    const sourceTask = this.requireTask_ACU(this.requireEnvelope_ACU(this.dependencies.store.readPersisted()));
    const sourceGuard = guardForTask_ACU(chatIdentity, sourceTask);
    this.invalidateLease_ACU(chatIdentity);
    await this.withLease_ACU(async () => {
      await this.dependencies.store.updatePersistedAtomically(current => {
        const envelope = this.requireEnvelope_ACU(current);
        const task = this.requireTask_ACU(envelope);
        return { ...envelope, activeTask: { ...task, status: 'abandoned', updatedAt: this.dependencies.now(), stopReason: 'manual', timeline: [...task.timeline, this.timeline_ACU('stopped', this.dependencies.now())] } };
      }, sourceGuard);
    });
    return this.createTask(input);
  }

  private async planOutline_ACU(context: ContinuationPlanningContext_ACU, chatIdentity: string, lease: Lease_ACU, stageId: string, revision: number, replanConstraints?: ContinuationReplanConstraints_ACU): Promise<ContinuationOutlinePlanningResult_ACU> {
    return this.dependencies.planner.plan({
      settings: context.envelope.settings,
      reason: context.reason,
      replanInstruction: context.replanInstruction,
      replanConstraints,
      // 新建阶段时 context.stage 为 null，跨阶段上下文按「追加在末尾的新阶段」推导；
      // 重规划时传本阶段 id，已完成前缀的连续高压段会被算进来。
      pacingContext: resolveStageOutlinePacingContext_ACU(context.task.stages, context.stage?.stageId ?? null),
      allocateId: this.dependencies.allocateId,
      resolvers: this.dependencies.createOutlineResolvers(context),
      createInternalRequestIdentity: attempt => ({ source: 'outline', requestId: this.dependencies.allocateId('outline-request'), chatIdentity, taskId: context.task.taskId, stageId, revision, attemptId: `outline-${attempt}` }),
      isInternalRequestCurrent: identity => this.isLeaseCurrent_ACU(chatIdentity, lease) && identity.chatIdentity === chatIdentity && identity.taskId === context.task.taskId && identity.stageId === stageId && identity.revision === revision,
    });
  }

  /**
   * 循环或规划失败后的统一暂停记录。单阶段事务化后失败不留中间状态，
   * 这里只负责把任务落到 paused 并记录 lastError，让用户可以直接再继续。
   */
  private async pauseWithError_ACU(chatIdentity: string, taskId: string, error: unknown, phase: 'turn_call' | 'outline_call', fallbackMessage: string): Promise<void> {
    if (error instanceof ContinuationValidationError_ACU && error.error.code === 'CONTINUATION_INTERNAL_REQUEST_STALE') {
      return;
    }
    const lastError = error instanceof ContinuationValidationError_ACU ? error.error : createContinuationError_ACU('CONTINUATION_INTERNAL_AI_REQUEST_FAILED', phase, fallbackMessage, false);
    try {
      await this.dependencies.store.updatePersistedAtomically(current => {
        const envelope = this.requireEnvelope_ACU(current);
        const task = this.requireTask_ACU(envelope);
        if (task.taskId !== taskId || task.stopReason !== null || !['running', 'paused', 'failed'].includes(task.status)) return envelope;
        return { ...envelope, activeTask: { ...task, status: 'paused', updatedAt: this.dependencies.now(), lastError, timeline: [...task.timeline, this.timeline_ACU('failed', this.dependencies.now(), { errorCode: lastError.code })] } };
      }, { chatIdentity });
    } catch { /* Preserve the primary error; a later guarded operation exposes persistence failure. */ }
  }

  /**
   * 把用户消息同时写进持久会话记录与展示用会话流。
   * 必须持久化的调用不能把未保存消息伪装成已接收。
   * @param text 用户消息正文
   * @param digest 短标签，用于压缩交接报告与 UI 标题
   * @param requirePersistence 是否要求持久会话写入成功
   */
  private async recordUserMessage_ACU(text: string, digest: string, requirePersistence = false): Promise<void> {
    const append = this.dependencies.appendAgentConversation ?? appendAgentConversationToChat_ACU;
    try {
      const persisted = await append([{ kind: 'user', text, digest }]);
      if (!persisted) {
        throw new Error('用户消息未写入持久会话记录');
      }
      logAgentSession_ACU({ kind: 'user_message', title: digest, detail: text });
    } catch (error) {
      logAgentSession_ACU({
        kind: 'run_failed',
        title: '这条消息未能写入持久会话记录',
        detail: `${error instanceof ContinuationValidationError_ACU ? error.error.message : error instanceof Error ? error.message : String(error)}\n本条消息只存在于当前界面，页面重载后会消失。`,
        ok: false,
      });
      if (requirePersistence) {
        throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_PERSIST_FAILED', 'agent_persist', '用户消息保存失败', false));
      }
    }
  }

  private planningSummary_ACU(result: ContinuationOutlinePlanningResult_ACU): ContinuationOrchestratorResult_ACU['planning'] {
    return { attempts: result.attempts, apiPreset: result.apiPreset, requiresReview: result.requiresReview };
  }

  /** 无信封聊天的初始设置：优先全局设置副本（由运行时装配），缺省内置默认。 */
  private fallbackSettings_ACU(): ContinuationSettings_ACU {
    return this.dependencies.buildFallbackSettings?.() ?? buildDefaultContinuationSettings_ACU();
  }

  private baseEnvelope_ACU(): ContinuationEnvelope_ACU {
    return this.dependencies.store.readPersisted() ?? { schemaVersion: 1, settings: this.fallbackSettings_ACU(), activeTask: null };
  }

  private requireEnvelope_ACU(value: ContinuationEnvelope_ACU | null): ContinuationEnvelope_ACU {
    if (!value) return { schemaVersion: 1, settings: this.fallbackSettings_ACU(), activeTask: null };
    return value;
  }

  private requireTask_ACU(envelope: ContinuationEnvelope_ACU): ContinuationTask_ACU {
    if (!envelope.activeTask) fail_ACU('CONTINUATION_TASK_NOT_FOUND', '当前聊天没有智能续写任务');
    return envelope.activeTask;
  }

  private stopEnvelope_ACU(envelope: ContinuationEnvelope_ACU, reason: 'manual' | 'duration_reached' | 'stage_limit_reached', now: number): ContinuationEnvelope_ACU {
    const task = this.requireTask_ACU(envelope);
    // 停止即放弃对等待中宿主生成的归属；清掉等待轮，之后继续/恢复不会被它卡死。
    const pendingHostTurn = task.pendingHostTurn?.status === 'awaiting_generation' ? null : task.pendingHostTurn;
    return { ...envelope, activeTask: { ...task, status: 'paused', updatedAt: now, stopReason: reason, ...(pendingHostTurn !== task.pendingHostTurn ? { pendingHostTurn } : {}), timeline: [...task.timeline, this.timeline_ACU('stopped', now)] } };
  }

  private async pauseHostTurn_ACU(identity: TurnAttemptIdentity_ACU, code: 'CONTINUATION_HOST_INPUT_UNAVAILABLE' | 'CONTINUATION_TASK_STATE_INVALID', message: string, stopReason: 'host_input_unavailable' | 'state_invalid'): Promise<ContinuationOrchestratorResult_ACU> {
    const chatIdentity = this.requireChatIdentity_ACU();
    if (identity.chatIdentity !== chatIdentity) throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'host_send', '宿主发送所属聊天已变化', false));
    return this.withLease_ACU(async () => {
      let result: ContinuationEnvelope_ACU | null = null;
      await this.dependencies.store.updatePersistedAtomically(current => {
        const envelope = this.requireEnvelope_ACU(current);
        const task = this.requireTask_ACU(envelope);
        if (!task.pendingHostTurn || task.pendingHostTurn.status !== 'awaiting_generation' || !identityMatchesCurrentTurn_ACU(task, identity)) {
          throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'host_send', '宿主发送失败已不属于当前轮次', false));
        }
        const now = this.dependencies.now();
        const error = createContinuationError_ACU(code, 'host_send', message, false);
        result = { ...envelope, activeTask: { ...task, status: 'paused', updatedAt: now, stopReason, lastError: error, pendingHostTurn: { ...task.pendingHostTurn, status: 'exhausted' }, timeline: [...task.timeline, this.timeline_ACU('failed', now, { stageId: identity.stageId, revision: identity.revision, nodeId: identity.nodeId, turnId: identity.turnId, attemptId: identity.attemptId, errorCode: error.code })] } };
        return result;
      }, { chatIdentity });
      return taskResult_ACU(result!);
    });
  }

  private timeline_ACU(kind: ContinuationTask_ACU['timeline'][number]['kind'], at: number, fields: Omit<ContinuationTask_ACU['timeline'][number], 'id' | 'at' | 'kind'> = {}): ContinuationTask_ACU['timeline'][number] {
    return { id: this.dependencies.allocateId('timeline'), at, kind, ...fields };
  }

  private requireChatIdentity_ACU(): string {
    const identity = this.dependencies.getChatIdentity();
    if (!identity) fail_ACU('CONTINUATION_TASK_STATE_INVALID', '当前聊天身份不可用');
    return identity;
  }

  private async withLease_ACU<T>(work: (chatIdentity: string, lease: Lease_ACU) => Promise<T>): Promise<T> {
    const chatIdentity = this.requireChatIdentity_ACU();
    if (leasesByChat_ACU.has(chatIdentity)) fail_ACU('CONTINUATION_OPERATION_BUSY', '当前聊天已有智能续写操作正在执行');
    const lease: Lease_ACU = { id: this.dependencies.allocateId('lease'), epoch: epochsByChat_ACU.get(chatIdentity) ?? 0 };
    leasesByChat_ACU.set(chatIdentity, lease);
    try { return await work(chatIdentity, lease); }
    finally { if (leasesByChat_ACU.get(chatIdentity) === lease) leasesByChat_ACU.delete(chatIdentity); }
  }

  private invalidateLease_ACU(chatIdentity: string): void {
    epochsByChat_ACU.set(chatIdentity, (epochsByChat_ACU.get(chatIdentity) ?? 0) + 1);
    leasesByChat_ACU.delete(chatIdentity);
    // 作废租约的同时中断在途请求：两者必须同时发生，否则「停止」在用户看来要等一整个 AI 调用。
    const controller = abortControllersByChat_ACU.get(chatIdentity);
    if (controller) {
      abortControllersByChat_ACU.delete(chatIdentity);
      try { controller.abort(); } catch { /* 中断失败不影响状态机推进。 */ }
    }
  }

  private isLeaseCurrent_ACU(chatIdentity: string, lease: Lease_ACU): boolean {
    return this.dependencies.getChatIdentity() === chatIdentity && (epochsByChat_ACU.get(chatIdentity) ?? 0) === lease.epoch && leasesByChat_ACU.get(chatIdentity) === lease;
  }

  private assertLeaseCurrent_ACU(chatIdentity: string, lease: Lease_ACU): void {
    if (!this.isLeaseCurrent_ACU(chatIdentity, lease)) {
      throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'outline_call', '智能续写操作已失效', false));
    }
  }
}
