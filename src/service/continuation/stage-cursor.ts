import type { ContinuationEnvelope_ACU, ContinuationStage_ACU, ContinuationTask_ACU, StageRevision_ACU } from './model';

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
export function reconcileTaskCursorFromChat_ACU(task: ContinuationTask_ACU, chatLength: number): ContinuationTask_ACU {
  if (!Number.isInteger(chatLength) || chatLength < 0) return task;
  const completions = task.timeline.filter(entry => entry.kind === 'turn_completed' && entry.stageId);
  const survivingByStage = new Map<string, number>();
  const hasAnchorByStage = new Map<string, boolean>();
  for (const entry of completions) {
    const stageId = entry.stageId as string;
    if (typeof entry.messageIndex === 'number') hasAnchorByStage.set(stageId, true);
    const surviving = survivingByStage.get(stageId) ?? 0;
    if (typeof entry.messageIndex === 'number') {
      if (entry.messageIndex < chatLength) survivingByStage.set(stageId, surviving + 1);
      else survivingByStage.set(stageId, surviving);
    } else {
      survivingByStage.set(stageId, surviving + 1);
    }
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
    const recorded = completions.filter(entry => entry.stageId === stage.stageId).length;
    let surviving = 0;
    for (const entry of completions) {
      if (entry.stageId !== stage.stageId) continue;
      if (typeof entry.messageIndex === 'number') {
        if (entry.messageIndex < chatLength) surviving += 1;
        else break;
      } else {
        surviving += 1;
      }
    }
    surviving = Math.min(surviving, recorded, totalTurns);
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
export function reconcileContinuationEnvelopeCursor_ACU(envelope: ContinuationEnvelope_ACU, chatLength: number): ContinuationEnvelope_ACU {
  const task = envelope.activeTask;
  if (!task) return envelope;
  const next = reconcileTaskCursorFromChat_ACU(task, chatLength);
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
