import { describe, expect, it } from 'vitest';
import { cursorFromCompletedTurns_ACU, reconcileTaskCursorFromChat_ACU } from '../../../src/service/continuation/stage-cursor';
import type { ContinuationStage_ACU, ContinuationTask_ACU, StageRevision_ACU } from '../../../src/service/continuation/model';

const pacingAt = (index: number) => (index % 3 === 0 ? 'setup' : 'pressure') as 'setup' | 'pressure';

function revisionOf(stageNumber: number, totalTurns: number): StageRevision_ACU {
  return {
    revision: 1,
    createdAt: 1,
    reason: 'initial',
    replanInstruction: '',
    frozen: true,
    outline: {
      schemaVersion: 1,
      title: `阶段${stageNumber}`,
      goal: '目标',
      tempo: 'mixed',
      totalTurns,
      nodes: [{
        id: `node-${stageNumber}`,
        title: '节点',
        goal: '节点目标',
        suggestedTurns: totalTurns,
        turns: Array.from({ length: totalTurns }, (_, index) => ({ id: `s${stageNumber}-t${index + 1}`, goal: `轮${index + 1}`, pacing: pacingAt(index) })),
      }],
    },
  };
}

function stageOf(stageNumber: number, totalTurns: number, completedTurns: number, status: ContinuationStage_ACU['status'] = 'running'): ContinuationStage_ACU {
  const revision = revisionOf(stageNumber, totalTurns);
  const cursor = cursorFromCompletedTurns_ACU(revision, completedTurns);
  return {
    stageId: `stage-${stageNumber}`,
    stageNumber,
    status,
    activeRevision: 1,
    revisions: [revision],
    activeNodeIndex: cursor.nodeIndex,
    activeTurnIndex: cursor.turnIndex,
    completedTurns,
  };
}

function taskOf(stages: ContinuationStage_ACU[], timeline: ContinuationTask_ACU['timeline'], activeStageId: string): ContinuationTask_ACU {
  return {
    taskId: 'task-a',
    originInstruction: '推进',
    status: 'paused',
    createdAt: 1,
    updatedAt: 1,
    runStartedAt: 1,
    deadlineAt: null,
    runStageCount: stages.length,
    activeStageId,
    stages,
    timeline,
    stopReason: null,
    lastError: null,
  };
}

function completed(stageId: string, turnId: string, messageIndex: number, id: string): ContinuationTask_ACU['timeline'][number] {
  return { id, at: 1, kind: 'turn_completed', stageId, turnId, messageIndex };
}

describe('reconcileTaskCursorFromChat_ACU', () => {
  it('把已确认楼层被删掉的轮次回退，并保持硬游标与存活楼层对齐', () => {
    const stage = stageOf(1, 6, 3, 'running');
    const task = taskOf(
      [stage],
      [
        completed('stage-1', 's1-t1', 1, 'c1'),
        completed('stage-1', 's1-t2', 3, 'c2'),
        completed('stage-1', 's1-t3', 5, 'c3'),
      ],
      'stage-1',
    );

    const next = reconcileTaskCursorFromChat_ACU(task, 4);

    expect(next).not.toBe(task);
    expect(next.stages[0]).toMatchObject({ completedTurns: 2, activeNodeIndex: 0, activeTurnIndex: 2, status: 'running' });
    expect(next.activeStageId).toBe('stage-1');
  });

  it('回退到更早未完成阶段时，废弃其后没有任何存活完成的阶段', () => {
    const first = stageOf(1, 4, 4, 'completed');
    const second = stageOf(2, 6, 2, 'running');
    const task = taskOf(
      [first, second],
      [
        completed('stage-1', 's1-t1', 1, 'a'),
        completed('stage-1', 's1-t2', 3, 'b'),
        completed('stage-1', 's1-t3', 5, 'c'),
        completed('stage-1', 's1-t4', 7, 'd'),
        completed('stage-2', 's2-t1', 9, 'e'),
        completed('stage-2', 's2-t2', 11, 'f'),
      ],
      'stage-2',
    );

    const next = reconcileTaskCursorFromChat_ACU(task, 6);

    expect(next.activeStageId).toBe('stage-1');
    expect(next.stages[0]).toMatchObject({ status: 'running', completedTurns: 3, activeTurnIndex: 3 });
    expect(next.stages[1]).toMatchObject({ status: 'abandoned', completedTurns: 0, activeTurnIndex: 0 });
  });

  it('没有任何带 messageIndex 的完成记录时保持原游标，避免旧信封被误回退', () => {
    const stage = stageOf(1, 6, 4, 'running');
    const task = taskOf(
      [stage],
      [{ id: 'legacy', at: 1, kind: 'turn_completed', stageId: 'stage-1', turnId: 's1-t1' }],
      'stage-1',
    );

    expect(reconcileTaskCursorFromChat_ACU(task, 1)).toBe(task);
  });
});
