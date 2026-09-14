import { ContinuationValidationError_ACU, createContinuationError_ACU, type ContinuationStage_ACU } from './model';
import type { AgentModuleSnapshot_ACU, AgentStoryArcEntry_ACU } from './agent/agent-model';

export const CONTINUATION_MAX_STAGES_PER_VOLUME_DEFAULT_ACU = 5;
export const CONTINUATION_MAX_STAGES_PER_VOLUME_MAX_ACU = 20;

export interface ContinuationStageVolumeBinding_ACU {
  volumeId: string;
  storyArcRevision: number;
}

export interface ContinuationStageVolumeResolution_ACU {
  binding: ContinuationStageVolumeBinding_ACU | null;
  reason: string | null;
}

export interface ContinuationVolumeCapacityDiagnostic_ACU {
  activeVolumeId: string | null;
  activeVolumeCount: number;
  countedStages: number;
  maxStagesPerVolume: number;
  legacyMappingProblems: string[];
}

function activeVolumes_ACU(snapshot: AgentModuleSnapshot_ACU): AgentStoryArcEntry_ACU[] {
  return snapshot.storyArc.filter(entry => entry.scope === 'volume' && !entry.retired && entry.status === 'active');
}

export function isCountedContinuationStage_ACU(stage: ContinuationStage_ACU): boolean {
  return ['planning', 'awaiting_review', 'running', 'completed'].includes(stage.status)
    || (stage.status === 'abandoned' && stage.completedTurns > 0);
}

export function resolveContinuationStageVolume_ACU(
  stage: ContinuationStage_ACU,
  snapshot: AgentModuleSnapshot_ACU,
  allowActiveVolumeFallback = false,
): ContinuationStageVolumeResolution_ACU {
  const revision = snapshot.revisions.storyArc;
  if (stage.volumeId) {
    const volume = snapshot.storyArc.find(entry => entry.id === stage.volumeId && entry.scope === 'volume' && !entry.retired);
    return volume
      ? { binding: { volumeId: volume.id, storyArcRevision: stage.storyArcRevision ?? revision }, reason: null }
      : { binding: null, reason: `阶段 ${stage.stageNumber} 绑定的卷 ${stage.volumeId} 不存在或已废止` };
  }
  const registered = snapshot.storyArc.filter(entry => entry.scope === 'volume' && !entry.retired && entry.stageNumbers.includes(stage.stageNumber));
  if (registered.length === 1) return { binding: { volumeId: registered[0].id, storyArcRevision: revision }, reason: null };
  if (registered.length > 1) return { binding: null, reason: `阶段 ${stage.stageNumber} 同时登记在多个卷：${registered.map(entry => entry.id).join('、')}` };
  if (!allowActiveVolumeFallback) return { binding: null, reason: `阶段 ${stage.stageNumber} 未登记到任何卷，不能把历史阶段猜测为当前 active 卷` };
  const active = activeVolumes_ACU(snapshot);
  if (active.length === 1) return { binding: { volumeId: active[0].id, storyArcRevision: revision }, reason: null };
  return { binding: null, reason: active.length ? `当前存在 ${active.length} 个 active 卷，无法映射旧阶段` : '当前没有 active 卷，无法映射旧阶段' };
}

/**
 * 只读地解释当前卷的阶段容量。它与创建门禁共用同一 binding resolver，
 * 让 UI 不会按数组位置另猜一套历史归属；诊断绝不写回 legacy stage。
 */
export function diagnoseContinuationVolumeCapacity_ACU(
  stages: readonly ContinuationStage_ACU[],
  snapshot: AgentModuleSnapshot_ACU,
  maxStagesPerVolume: number,
  activeStageId: string | null,
): ContinuationVolumeCapacityDiagnostic_ACU {
  const active = activeVolumes_ACU(snapshot);
  const legacyMappingProblems: string[] = [];
  if (!Number.isInteger(maxStagesPerVolume) || maxStagesPerVolume < 1 || maxStagesPerVolume > CONTINUATION_MAX_STAGES_PER_VOLUME_MAX_ACU) {
    legacyMappingProblems.push('每卷阶段上限配置非法');
  }
  if (active.length !== 1) {
    legacyMappingProblems.push(active.length ? `当前存在 ${active.length} 个 active 卷，无法计算容量` : '当前没有 active 卷，无法计算容量');
    return { activeVolumeId: null, activeVolumeCount: active.length, countedStages: 0, maxStagesPerVolume, legacyMappingProblems };
  }
  let countedStages = 0;
  for (const stage of stages) {
    if (!isCountedContinuationStage_ACU(stage)) continue;
    const resolution = resolveContinuationStageVolume_ACU(stage, snapshot, stage.stageId === activeStageId);
    if (!resolution.binding) {
      legacyMappingProblems.push(resolution.reason ?? `阶段 ${stage.stageNumber} 的卷归属无法确定`);
    } else if (resolution.binding.volumeId === active[0].id) {
      countedStages += 1;
    }
  }
  return { activeVolumeId: active[0].id, activeVolumeCount: 1, countedStages, maxStagesPerVolume, legacyMappingProblems };
}

function failCapacity_ACU(message: string, details: Record<string, unknown>): never {
  throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_VOLUME_STAGE_LIMIT_REACHED', 'persist', message, false, details));
}

export function assertCanCreateContinuationStage_ACU(
  stages: readonly ContinuationStage_ACU[],
  snapshot: AgentModuleSnapshot_ACU,
  maxStagesPerVolume: number,
  activeStageId: string | null,
): ContinuationStageVolumeBinding_ACU {
  if (!Number.isInteger(maxStagesPerVolume) || maxStagesPerVolume < 1 || maxStagesPerVolume > CONTINUATION_MAX_STAGES_PER_VOLUME_MAX_ACU) {
    failCapacity_ACU('每卷阶段上限配置非法', { maxStagesPerVolume });
  }
  const active = activeVolumes_ACU(snapshot);
  if (active.length !== 1) {
    failCapacity_ACU('创建阶段前必须恰有一个 active 卷', { activeVolumeIds: active.map(volume => volume.id) });
  }
  const volume = active[0];
  if (volume.targetStageRange && volume.targetStageRange.max > maxStagesPerVolume) {
    failCapacity_ACU(`active 卷 ${volume.id} 的 targetStageRange.max 超过每卷阶段上限`, { volumeId: volume.id, targetMax: volume.targetStageRange.max, maxStagesPerVolume });
  }
  let counted = 0;
  for (const stage of stages) {
    if (!isCountedContinuationStage_ACU(stage)) continue;
    const resolution = resolveContinuationStageVolume_ACU(stage, snapshot, stage.stageId === activeStageId);
    if (!resolution.binding) failCapacity_ACU('旧阶段卷归属无法唯一确定，拒绝继续增加阶段', { stageId: stage.stageId, stageNumber: stage.stageNumber, reason: resolution.reason });
    if (resolution.binding.volumeId === volume.id) counted += 1;
  }
  if (counted >= maxStagesPerVolume) {
    failCapacity_ACU(`卷 ${volume.id} 已达到每卷 ${maxStagesPerVolume} 个阶段的硬上限`, { volumeId: volume.id, counted, maxStagesPerVolume });
  }
  return { volumeId: volume.id, storyArcRevision: snapshot.revisions.storyArc };
}

export function assertStoryArcTargetStageRanges_ACU(entries: readonly AgentStoryArcEntry_ACU[], maxStagesPerVolume: number): void {
  if (!Number.isInteger(maxStagesPerVolume) || maxStagesPerVolume < 1 || maxStagesPerVolume > CONTINUATION_MAX_STAGES_PER_VOLUME_MAX_ACU) {
    failCapacity_ACU('每卷阶段上限配置非法', { maxStagesPerVolume });
  }
  for (const entry of entries) {
    if (entry.retired || entry.scope !== 'volume' || !entry.targetStageRange) continue;
    if (entry.targetStageRange.max > maxStagesPerVolume) {
      failCapacity_ACU(`卷 ${entry.id} 的 targetStageRange.max 不得超过每卷阶段上限`, { volumeId: entry.id, targetMax: entry.targetStageRange.max, maxStagesPerVolume });
    }
  }
}
