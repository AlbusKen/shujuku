import { pageActiveWorldActors_ACU, validateWorldActorPages_ACU, type WorldActorCompletion_ACU } from './actor-completions';
import { materializeWorldRoundCandidate_ACU, type WorldRoundCandidate_ACU } from './world-candidate';
import { WorldSimulationValidationError_ACU, createWorldSimulationError_ACU,
  type WorldActor_ACU, type WorldSimulationLedger_ACU } from './model';

export interface WorldActorBatch_ACU {
  actorIds: string[];
  status: 'complete' | 'failed';
  actorWrites: Array<{ value: WorldActor_ACU; expectedRevision: number }>;
  actorCompletions: WorldActorCompletion_ACU[];
}

function fail_ACU(message: string): never {
  throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
    'WORLD_SIMULATION_AGENT_PROTOCOL_INVALID', 'agent_persist', message, false));
}

/** 每页只处理冻结的 active 人物；任一页失败时不产生局部候选。 */
export function materializeWorldActorBatches_ACU(
  base: WorldSimulationLedger_ACU,
  candidate: Omit<WorldRoundCandidate_ACU, 'actorWrites' | 'actorCompletions'>,
  pageSize: number,
  batches: readonly WorldActorBatch_ACU[],
  newlyActive: readonly { value: WorldActor_ACU; expectedRevision: 0 }[] = [],
): WorldSimulationLedger_ACU {
  const expected = pageActiveWorldActors_ACU(base.actors, pageSize);
  const pages = batches.map(batch => batch.actorIds);
  if (validateWorldActorPages_ACU(base.actors, pages).length || JSON.stringify(pages) !== JSON.stringify(expected)) {
    fail_ACU('人物批次未按冻结 roster 的稳定分页完整覆盖');
  }
  const actorWrites: WorldRoundCandidate_ACU['actorWrites'] = [];
  const actorCompletions: WorldActorCompletion_ACU[] = [];
  for (const [index, batch] of batches.entries()) {
    if (batch.status !== 'complete') fail_ACU(`人物批次 ${index + 1} 未完成`);
    const ids = new Set(batch.actorIds);
    if (batch.actorCompletions.length !== batch.actorIds.length
      || new Set(batch.actorCompletions.map(item => item.actorId)).size !== ids.size
      || batch.actorCompletions.some(item => !ids.has(item.actorId))) {
      fail_ACU(`人物批次 ${index + 1} 缺少逐人覆盖证明`);
    }
    if (batch.actorWrites.some(write => !ids.has(write.value.id))) fail_ACU(`人物批次 ${index + 1} 写入了页外人物`);
    actorWrites.push(...batch.actorWrites);
    actorCompletions.push(...batch.actorCompletions);
  }
  const existing = new Set(base.actors.map(item => item.id));
  for (const write of newlyActive) {
    if (existing.has(write.value.id) || write.value.simulationStatus !== 'active') fail_ACU('同轮新增人物必须是新 active 人物');
    actorWrites.push(write);
    actorCompletions.push({ actorId: write.value.id, completion: 'changed', expectedRevision: 0 });
  }
  return materializeWorldRoundCandidate_ACU(base, { ...candidate, actorWrites, actorCompletions });
}
