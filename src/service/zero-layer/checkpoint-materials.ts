import type { ZeroLayerEnvelope_ACU, ZeroLayerTableResult_ACU, ZeroLayerSimulationResult_ACU } from './model';
import { checkpointPath_ACU, requireCheckpoint_ACU, checkpointFingerprint_ACU } from './checkpoint-payload';
import { validateZeroLayerTableResult_ACU } from './validation';
import { validateZeroLayerSimulationResult_ACU } from './simulation-validation';

/** 全量结算结果是无损 replacement 载荷；位置只由父链与 FloorRef 选择。 */
export function readCheckpointMaterials_ACU(source: ZeroLayerEnvelope_ACU, throughTurnId?: string) {
  const branch = source.branches.find(item => item.branchId === source.activeBranchId);
  requireCheckpoint_ACU(branch, 'checkpoint 资料分支不存在。');
  const path = checkpointPath_ACU(source, branch.branchId);
  const end = throughTurnId === undefined ? path.length - 1 : path.findIndex(turn => turn.turnId === throughTurnId);
  requireCheckpoint_ACU(throughTurnId === undefined || end >= 0, '资料回放目标不在已发布父链。');
  const active = branch.checkpoints?.active;
  const cut = active ? path.findIndex(turn => turn.turnId === active.position.ref.turnId) : -1;
  requireCheckpoint_ACU(!active || cut >= 0, '活动资料基线不在已发布父链。');
  // 回退到 active 之前必须读保留的原结果，不能套用未来基线。
  const useActive = !!active && cut <= end;
  let table: ZeroLayerTableResult_ACU | null = useActive ? structuredClone(active.table.result) : null;
  let simulation: ZeroLayerSimulationResult_ACU | null = useActive ? structuredClone(active.simulation) : null;
  for (let index = useActive ? cut + 1 : 0; index <= end; index += 1) {
    const turn = path[index];
    const tableResult = turn.assistantFloor.data.table;
    validateZeroLayerTableResult_ACU(tableResult, turn.assistantFloor.floorId);
    const simulationResult = turn.assistantFloor.data.simulation;
    validateZeroLayerSimulationResult_ACU(simulationResult);
    table = structuredClone(tableResult);
    simulation = structuredClone(simulationResult);
  }
  if (end >= 0) {
    requireCheckpoint_ACU(checkpointFingerprint_ACU(table) === checkpointFingerprint_ACU(path[end].assistantFloor.data.table)
      && checkpointFingerprint_ACU(simulation) === checkpointFingerprint_ACU(path[end].assistantFloor.data.simulation),
    '资料基线与未压缩结算回放不等价。');
  }
  return { table, simulation };
}

/** 确认态消费 active + 后缀；较新的工作账本或手动栏目修改不得被历史结果覆盖。 */
export function readCheckpointSimulationView_ACU(source: ZeroLayerEnvelope_ACU,
  state: import('./model').ZeroLayerSimulationState_ACU) {
  const confirmed = readCheckpointMaterials_ACU(source).simulation;
  const working = { ledger: state.envelope?.ledger ?? null, fields: state.fields, archive: state.archive };
  if (!confirmed) return structuredClone(working);
  const replay = { ledger: confirmed.ledger, fields: confirmed.fields, archive: confirmed.archive };
  if (checkpointFingerprint_ACU(working) === checkpointFingerprint_ACU(replay)) return structuredClone(replay);
  requireCheckpoint_ACU(!confirmed.ledger || working.ledger
    && working.ledger.revision >= confirmed.ledger.revision, '推演工作状态早于已确认的 checkpoint 回放。');
  return structuredClone(working);
}
