import type { ContinuationEnvelope_ACU, ContinuationStage_ACU, ContinuationTask_ACU, StageRevision_ACU, ContinuationLogicalAnchor_ACU, ContinuationLogicalRef_ACU } from './model';

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
  return reconcileTaskCursorFromHistory_ACU(task, anchor => typeof anchor.messageIndex === 'number' && anchor.messageIndex < chatLength);
}

/** 恢复算法共用；存活判定由物理或逻辑 Adapter 提供，不能把逻辑序号当物理下标。 */
export function reconcileTaskCursorFromHistory_ACU(
  task: ContinuationTask_ACU,
  survives: (anchor: { messageIndex?: number; logicalAnchor?: ContinuationLogicalAnchor_ACU; logicalRef?: ContinuationLogicalRef_ACU }) => boolean,
): ContinuationTask_ACU {
  const anchored = (entry: { messageIndex?: number; logicalRef?: ContinuationLogicalRef_ACU }) =>
    typeof entry.messageIndex === 'number' || entry.logicalRef !== undefined;
  const selection = [...(task.progressSelections ?? [])].reverse().find(survives);
  // 阶段交接随新阶段一起保存选择；恢复时只采用仍有聊天依据的最新选择。
  const selectedStageId = selection?.stageId ?? null;
  const completions = task.timeline.filter(entry => entry.kind === 'turn_completed' && entry.stageId);
  const survivingByStage = new Map<string, number>();
  const hasAnchorByStage = new Map<string, boolean>();
  for (const entry of completions) {
    const stageId = entry.stageId as string;
    if (anchored(entry)) hasAnchorByStage.set(stageId, true);
    const surviving = survivingByStage.get(stageId) ?? 0;
    if (anchored(entry)) {
      if (survives(entry)) survivingByStage.set(stageId, surviving + 1);
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
    // 大纲重规划保护已完成前缀，校准基线在后续修订中仍然有效。
    const adjustments = stage.progressAdjustments ?? [];
    const adjustment = [...adjustments].reverse().find(survives);
    const stageCompletions = task.timeline.slice(adjustment?.timelineOffset ?? 0)
      .filter(entry => entry.kind === 'turn_completed' && entry.stageId === stage.stageId);
    // 校准是进度基线，不是假造的宿主完成记录；基线之后仍按真实楼层恢复。
    const hasAnchor = hasAnchorByStage.get(stage.stageId) === true || adjustments.length > 0;
    if (hasAnchor) hasAnchorByStage.set(stage.stageId, true);

    if (!hasAnchor) {
      if (stage.status !== 'completed' && stage.status !== 'abandoned' && stage.status !== 'failed' && firstOpenIndex < 0) {
        firstOpenIndex = index;
      }
      return stage;
    }
    const baseline = adjustment?.completedTurns ?? 0;
    const recorded = baseline + stageCompletions.length;
    let surviving = baseline;
    for (const entry of stageCompletions) {
      if (anchored(entry)) {
        if (survives(entry)) surviving += 1;
        else break;
      } else {
        surviving += 1;
      }
    }
    surviving = Math.min(surviving, recorded, totalTurns);
    survivingByStage.set(stage.stageId, surviving);
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

  if (firstOpenIndex >= 0 && !selectedStageId) {
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
  const selectedIndex = stages.findIndex(stage => stage.stageId === selectedStageId);
  const selected = stages[selectedIndex];
  const nextSelected = selected?.status === 'completed'
    ? stages.slice(selectedIndex + 1).find(stage => stage.status !== 'completed' && stage.status !== 'abandoned' && stage.status !== 'failed')
    : null;
  const activeStageId = selected && (selected.status === 'running' || selected.status === 'completed')
    ? nextSelected?.stageId ?? selected.stageId : firstOpen?.stageId ?? task.activeStageId;
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
