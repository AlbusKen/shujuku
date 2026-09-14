import type { ContinuationEnvelope_ACU, ContinuationStage_ACU, ContinuationTask_ACU, StageRevision_ACU } from './model';

interface CursorCompletion_ACU {
  stageId: string;
  turnId: string | null;
  requireContiguousTurnId: boolean;
  anchored: boolean;
  surviving: boolean;
}

function isLiveTarget_ACU(chat: readonly any[], index: unknown, messageId: unknown, swipeIndex: unknown): boolean {
  if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= chat.length || !Number.isInteger(messageId) || !Number.isInteger(swipeIndex)) return false;
  const message = chat[index as number];
  return !!message && message.is_user !== true && message.extra?.type !== 'narrator'
    && message.message_id === messageId && (message.swipe_id ?? 0) === swipeIndex;
}

function externalProgressCompletions_ACU(entry: ContinuationTask_ACU['timeline'][number], chat: readonly any[], chatIdentity: string): CursorCompletion_ACU[] {
  if (entry.kind !== 'external_progress_adopted' || !entry.stageId) return [];
  const valid = entry.adoptionChatIdentity === chatIdentity
    && isLiveTarget_ACU(chat, entry.targetMessageIndex, entry.targetMessageId, entry.targetSwipeIndex);
  return (entry.satisfiedTurnIds ?? []).map(turnId => ({ stageId: entry.stageId!, turnId, requireContiguousTurnId: true, anchored: true, surviving: valid }));
}

function completionRecords_ACU(task: ContinuationTask_ACU, chatOrLength: readonly any[] | number, chatIdentity: string): CursorCompletion_ACU[] {
  const chat = typeof chatOrLength === 'number' ? null : chatOrLength;
  const chatLength = typeof chatOrLength === 'number' ? chatOrLength : chatOrLength.length;
  const result: CursorCompletion_ACU[] = [];
  for (const entry of task.timeline) {
    if (entry.kind === 'turn_completed' && entry.stageId) {
      const anchored = typeof entry.messageIndex === 'number';
      result.push({ stageId: entry.stageId, turnId: entry.turnId ?? null, requireContiguousTurnId: false, anchored, surviving: !anchored || entry.messageIndex! < chatLength });
      continue;
    }
    if (entry.kind === 'external_progress_adopted' && entry.stageId) {
      if (chat) result.push(...externalProgressCompletions_ACU(entry, chat, chatIdentity));
      else result.push(...(entry.satisfiedTurnIds ?? []).map(turnId => ({ stageId: entry.stageId!, turnId, requireContiguousTurnId: true, anchored: true, surviving: false })));
    }
  }
  return result;
}

/**
 * 按聊天实际长度重算阶段硬游标。
 *
 * 每轮确认时把正文楼层号写进 timeline.turn_completed.messageIndex。退楼层后那些
 * 下标不再落在 chat 内，对应轮次视为未完成——游标跟着对话走，而不是停在首楼里
 * 回退前的阶段。没有任何带 messageIndex 的完成记录时保持原游标，避免旧信封被误回退。
 *
 * @param task 当前任务
 * @param chatLength 当前聊天数组长度
 * @returns 游标已对齐的任务；无需改动时返回原对象
 */
export function reconcileTaskCursorFromChat_ACU(task: ContinuationTask_ACU, chatOrLength: readonly any[] | number, chatIdentity = ''): ContinuationTask_ACU {
  const chatLength = typeof chatOrLength === 'number' ? chatOrLength : chatOrLength.length;
  if (!Number.isInteger(chatLength) || chatLength < 0) return task;
  const completions = completionRecords_ACU(task, chatOrLength, chatIdentity);
  const survivingByStage = new Map<string, number>();
  const hasAnchorByStage = new Map<string, boolean>();
  for (const entry of completions) {
    const stageId = entry.stageId;
    if (entry.anchored) hasAnchorByStage.set(stageId, true);
    const surviving = survivingByStage.get(stageId) ?? 0;
    survivingByStage.set(stageId, surviving + (entry.surviving ? 1 : 0));
  }
  // 从前往后扫：一旦某阶段因楼层消失而未完成，其后没有任何存活完成的阶段应废弃，
  // 否则主 Agent 会把它们当成「下一阶段已在」再排一份新大纲。
  let firstOpenIndex = -1;
  let changed = false;
  const stages = task.stages.map((stage, index) => {
    const revision = stage.revisions.find(item => item.revision === stage.activeRevision) ?? null;
    const totalTurns = revision?.outline.totalTurns ?? 0;
    const hasAnchor = hasAnchorByStage.get(stage.stageId) === true;
    if (!hasAnchor) {
      if (stage.status !== 'completed' && stage.status !== 'abandoned' && stage.status !== 'failed' && firstOpenIndex < 0) {
        firstOpenIndex = index;
      }
      return stage;
    }
    const expectedTurnIds = revision?.outline.nodes.flatMap(node => node.turns.map(turn => turn.id)) ?? [];
    const records = completions.filter(entry => entry.stageId === stage.stageId);
    let surviving = 0;
    for (const entry of records) {
      if (!entry.surviving) continue;
      // 外部接管必须从既有完成前缀之后逐项连续；普通历史 completion 保持既有计数兼容。
      if (entry.requireContiguousTurnId && expectedTurnIds[surviving] !== entry.turnId) continue;
      surviving += 1;
    }
    surviving = Math.min(surviving, totalTurns);
    const cursor = cursorFromCompletedTurns_ACU(revision, surviving);
    const fullyDone = totalTurns > 0 && surviving >= totalTurns;
    let nextStatus: ContinuationStage_ACU['status'] = stage.status;
    if (fullyDone) {
      if (stage.status !== 'abandoned' && stage.status !== 'failed') nextStatus = 'completed';
    } else if (stage.status === 'completed') {
      nextStatus = 'running';
    }
    if (!fullyDone && firstOpenIndex < 0) firstOpenIndex = index;
    if (
      stage.completedTurns === surviving
      && stage.activeNodeIndex === cursor.nodeIndex
      && stage.activeTurnIndex === cursor.turnIndex
      && stage.status === nextStatus
    ) {
      return stage;
    }
    changed = true;
    return { ...stage, completedTurns: surviving, activeNodeIndex: cursor.nodeIndex, activeTurnIndex: cursor.turnIndex, status: nextStatus };
  });

  if (firstOpenIndex >= 0) {
    for (let index = firstOpenIndex + 1; index < stages.length; index += 1) {
      const stage = stages[index];
      const hasAnchor = hasAnchorByStage.get(stage.stageId) === true;
      const surviving = hasAnchor ? (survivingByStage.get(stage.stageId) ?? 0) : stage.completedTurns;
      if (surviving > 0) continue;
      if (stage.status === 'abandoned' && stage.completedTurns === 0 && stage.activeNodeIndex === 0 && stage.activeTurnIndex === 0) continue;
      stages[index] = { ...stage, status: 'abandoned', completedTurns: 0, activeNodeIndex: 0, activeTurnIndex: 0 };
      changed = true;
    }
  }

  const firstOpen = stages.find(stage => stage.status !== 'completed' && stage.status !== 'abandoned' && stage.status !== 'failed') ?? null;
  const activeStageId = firstOpen?.stageId ?? task.activeStageId;
  if (activeStageId !== task.activeStageId) changed = true;
  if (!changed) return task;
  return { ...task, activeStageId, stages };
}

/**
 * 把信封里的任务游标按聊天长度对齐。任务为空时原样返回。
 */
export function reconcileContinuationEnvelopeCursor_ACU(envelope: ContinuationEnvelope_ACU, chatOrLength: readonly any[] | number, chatIdentity = ''): ContinuationEnvelope_ACU {
  const task = envelope.activeTask;
  if (!task) return envelope;
  const next = reconcileTaskCursorFromChat_ACU(task, chatOrLength, chatIdentity);
  return next === task ? envelope : { ...envelope, activeTask: next };
}

/**
 * 由已完成轮数还原节点/轮次下标。全部完成时停在最后一轮，与 advanceConfirmedTurn 终局写法一致。
 */
export function cursorFromCompletedTurns_ACU(revision: StageRevision_ACU | null, completedTurns: number): { nodeIndex: number; turnIndex: number } {
  if (!revision || completedTurns <= 0) return { nodeIndex: 0, turnIndex: 0 };
  let remaining = completedTurns;
  for (let nodeIndex = 0; nodeIndex < revision.outline.nodes.length; nodeIndex += 1) {
    const turnCount = revision.outline.nodes[nodeIndex].turns.length;
    if (remaining < turnCount) return { nodeIndex, turnIndex: remaining };
    remaining -= turnCount;
  }
  const lastNodeIndex = Math.max(0, revision.outline.nodes.length - 1);
  const lastTurnCount = revision.outline.nodes[lastNodeIndex]?.turns.length ?? 1;
  return { nodeIndex: lastNodeIndex, turnIndex: Math.max(0, lastTurnCount - 1) };
}
