import { describe, expect, it } from 'vitest';

import { buildEmptyAgentModuleSnapshot_ACU } from '../../../src/service/continuation/agent/agent-module-store';
import {
  assertCanCreateContinuationStage_ACU,
  diagnoseContinuationVolumeCapacity_ACU,
  resolveContinuationStageVolume_ACU,
} from '../../../src/service/continuation/continuation-volume-capacity';

function volume_ACU(id: string, status: 'active' | 'planned' | 'done', stageNumbers: number[] = [], retired = false, targetStageRange?: { min: number; max: number }) {
  return { id, scope: 'volume' as const, title: id, direction: '推进剧情', escalation: '冲突升级后收束', withheld: '', status, stageNumbers, completionStageNumber: null, completionState: '', continuationRationale: '', retired, retiredReason: '', targetStageRange };
}
function snapshot_ACU(volumes: any[]) {
  return { ...buildEmptyAgentModuleSnapshot_ACU(), storyArc: volumes, revisions: { ...buildEmptyAgentModuleSnapshot_ACU().revisions, storyArc: 7 } };
}
function stage_ACU(number: number, status: any = 'completed', binding?: { volumeId: string; storyArcRevision: number }) {
  return { stageId: `stage-${number}`, stageNumber: number, status, activeRevision: 1, revisions: [], activeNodeIndex: 0, activeTurnIndex: 0, completedTurns: status === 'abandoned' ? 1 : 0, ...binding } as any;
}

describe('continuation volume capacity', () => {
  it('legacy stage first resolves a unique stageNumbers registration, then only its active stage may use a unique active fallback', () => {
    const snapshot = snapshot_ACU([volume_ACU('VOL-01', 'active', [2]), volume_ACU('VOL-02', 'planned')]);
    expect(resolveContinuationStageVolume_ACU(stage_ACU(2), snapshot)).toEqual({ binding: { volumeId: 'VOL-01', storyArcRevision: 7 }, reason: null });
    expect(resolveContinuationStageVolume_ACU(stage_ACU(3), snapshot).binding).toBeNull();
    expect(resolveContinuationStageVolume_ACU(stage_ACU(3), snapshot, true)).toEqual({ binding: { volumeId: 'VOL-01', storyArcRevision: 7 }, reason: null });
  });

  it('rejects multiple registrations and retired direct bindings instead of guessing a legacy volume', () => {
    const ambiguous = snapshot_ACU([volume_ACU('VOL-01', 'active', [1]), volume_ACU('VOL-02', 'planned', [1])]);
    expect(resolveContinuationStageVolume_ACU(stage_ACU(1), ambiguous).reason).toContain('多个卷');
    const retired = snapshot_ACU([volume_ACU('VOL-01', 'active', [], true)]);
    expect(resolveContinuationStageVolume_ACU(stage_ACU(1, 'completed', { volumeId: 'VOL-01', storyArcRevision: 2 }), retired).reason).toContain('不存在或已废止');
  });

  it('counts durable stage states, blocks an over-cap create, and exposes legacy ambiguity as read-only diagnostics', () => {
    const snapshot = snapshot_ACU([volume_ACU('VOL-01', 'active', [1])]);
    const stages = [stage_ACU(1, 'completed', { volumeId: 'VOL-01', storyArcRevision: 7 })];
    expect(() => assertCanCreateContinuationStage_ACU(stages, snapshot, 1, 'stage-1')).toThrow(/已达到每卷 1 个阶段/);

    const ambiguousSnapshot = snapshot_ACU([volume_ACU('VOL-01', 'active', [2]), volume_ACU('VOL-02', 'planned', [2])]);
    const diagnostic = diagnoseContinuationVolumeCapacity_ACU([stage_ACU(2)], ambiguousSnapshot, 5, 'stage-1');
    expect(diagnostic).toMatchObject({ activeVolumeId: 'VOL-01', countedStages: 0 });
    expect(diagnostic.legacyMappingProblems.join('；')).toContain('多个卷');
  });
});
