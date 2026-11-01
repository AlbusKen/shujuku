import { checkWorldFactRevealGate_ACU } from './world-fact-gate';
import { verifiedWorldRecallManifests_ACU, type WorldRecallGrant_ACU } from './world-recall-gate';
import type { WorldClock_ACU, WorldLocationRef_ACU, WorldSimulationLedger_ACU, WorldTime_ACU } from './model';

export interface WorldProjectionCheckPlan_ACU {
  sceneFactIds: string[];
  semanticCheckIds: string[];
  blockedFactIds: string[];
}

/** 从已批准的召回清单规划；只给 ID，不返回锁定事实全文或修改账本。 */
export function planWorldProjectionChecks_ACU(
  ledger: WorldSimulationLedger_ACU, grant: WorldRecallGrant_ACU,
  time: WorldTime_ACU, location: WorldLocationRef_ACU | null,
  contactedActorIds: readonly string[], state: import('./agent/agent-read-gate').WorldSimulationReadGateState_ACU,
): WorldProjectionCheckPlan_ACU {
  const manifests = verifiedWorldRecallManifests_ACU(grant, ledger, time as WorldClock_ACU, location, state);
  if (!manifests) throw new Error('投影规划缺少有效整轮召回许可');
  const sceneFactIds: string[] = [];
  const semanticCheckIds: string[] = [];
  const blockedFactIds: string[] = [];
  for (const page of manifests) {
    for (const id of page.sceneFactIds) {
      const fact = ledger.facts.find(item => item.id === id);
      if (fact?.revealState === 'unlocked' && fact.projectionPolicy === 'scene') sceneFactIds.push(id);
    }
    for (const id of page.projectionCheckIds) {
      const result = checkWorldFactRevealGate_ACU(ledger, id, { day: time.day, slot: time.slot }, location, contactedActorIds);
      (result.status === 'semantic-review-required' ? semanticCheckIds : blockedFactIds).push(id);
    }
  }
  return { sceneFactIds, semanticCheckIds, blockedFactIds };
}
