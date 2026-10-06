import { ZeroLayerError_ACU, type ZeroLayerEnvelope_ACU } from './model';
import { readCheckpointSimulationView_ACU } from './checkpoint-materials';

/** 正文在途时只展示开始前的已确认资料；结算端口仍消费分支工作状态。 */
export function readZeroLayerPublishedMaterials_ACU(source: ZeroLayerEnvelope_ACU) {
  const branch = source.branches.find(item => item.branchId === source.activeBranchId);
  if (!branch) throw new ZeroLayerError_ACU('corrupt-data', '活动资料分支不存在。');
  const pending = source.turns.find(turn => turn.branchId === branch.branchId
    && !['published', 'failed', 'cancelled'].includes(turn.phase));
  const project = (materials: { continuation: typeof branch.continuation | null; simulation: typeof branch.simulation | null }) => {
    const result = structuredClone(materials);
    if (result.simulation?.envelope && branch.checkpoints?.active) {
      const view = readCheckpointSimulationView_ACU(source, result.simulation);
      if (!view.ledger) throw new ZeroLayerError_ACU('corrupt-data', '已发布推演基线缺少账本。');
      result.simulation.envelope.ledger = view.ledger;
      result.simulation.fields = view.fields;
      result.simulation.archive = view.archive;
    }
    return result;
  };
  if (pending) {
    if (!pending.materialBaseline) {
      throw new ZeroLayerError_ACU('effects-pending', '在途回合缺少已确认资料基底，不能展示工作候选。');
    }
    return project(pending.materialBaseline);
  }
  return project({ continuation: branch.continuation ?? null, simulation: branch.simulation ?? null });
}
