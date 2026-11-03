import type { ZeroLayerSimulationState_ACU, ZeroLayerSimulationResult_ACU } from './model';
import type { ZeroLayerCommand_ACU } from './store-command';
import type { WorldSimulationLogicalAnchorIdentity_ACU } from '../simulation/agent/agent-model';
import { buildWorldSimulationProjection_ACU } from '../simulation/simulation-projection';
import { getTableDataFingerprint_ACU } from '../table/table-data-upgrade-audit';

/** 只组合候选；结果、确认引用和回执由 carrier 写队列一次保存。 */
export function buildZeroLayerSimulationEffect_ACU(
  state: ZeroLayerSimulationState_ACU, anchor: WorldSimulationLogicalAnchorIdentity_ACU,
  outcome: ZeroLayerSimulationResult_ACU['outcome'], summary: string,
): Extract<ZeroLayerCommand_ACU, { type: 'record-effect' }> {
  const ref = structuredClone(anchor.logicalRef);
  const result: ZeroLayerSimulationResult_ACU = {
    schemaVersion: 1, ref, outcome, summary,
    ledger: structuredClone(state.envelope?.ledger ?? null),
    fields: structuredClone(state.fields), archive: structuredClone(state.archive),
    projection: state.envelope ? buildWorldSimulationProjection_ACU(state.envelope.ledger) : null,
  };
  return { type: 'record-effect', turnId: ref.turnId, attemptId: ref.attemptId,
    receipt: { effectId: JSON.stringify([ref.sessionId, ref.branchId, ref.turnId, 'simulation']),
      kind: 'simulation', status: outcome === 'skipped-by-config' ? 'skipped-by-config' : 'durable',
      fingerprint: getTableDataFingerprint_ACU(result) }, assistantData: { simulation: result } };
}
