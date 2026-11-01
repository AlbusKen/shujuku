import { readWorldNarrativeScene_ACU, type WorldNarrativeSceneReceipt_ACU } from './world-scene-review';
import { runWorldProjectionStage_ACU, type WorldProjectionStageInput_ACU, type WorldProjectionStageResult_ACU } from './world-projection-stage';

export type NarrativeReviewedWorldProjectionStageInput_ACU = Omit<WorldProjectionStageInput_ACU, 'sceneLocation' | 'contactedActorIds'> & {
  sceneReceipt: WorldNarrativeSceneReceipt_ACU;
};

/** 仅转接已绑定的正文审查结论；地点缺失时拒绝而不伪造空投影回执。 */
export async function runNarrativeReviewedWorldProjectionStage_ACU(
  input: NarrativeReviewedWorldProjectionStageInput_ACU,
): Promise<WorldProjectionStageResult_ACU> {
  const reviewed = readWorldNarrativeScene_ACU(input.sceneReceipt, {
    ledger: input.ledger,
    anchor: input.targetAnchor,
    anchorText: input.anchorText,
    signal: input.signal,
    assertCurrent: () => {
      if (!input.isCurrent()) throw new Error('WORLD_NARRATIVE_REVIEWED_PROJECTION_INVALID:运行租约已失效');
    },
  });
  if (!reviewed.sceneLocation) throw new Error('WORLD_NARRATIVE_REVIEWED_PROJECTION_INVALID:正文审查未确定场景地点');
  return runWorldProjectionStage_ACU({
    ...input,
    trustedNarrativeScene: true,
    narrativeReviewReceipt: input.sceneReceipt,
    sceneLocation: reviewed.sceneLocation,
    contactedActorIds: reviewed.contactedActorIds,
  });
}
