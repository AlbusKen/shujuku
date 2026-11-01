import type { WorldSimulationLedger_ACU } from './model';

/** 删除人物本体与结构化 ID 引用；既有叙述及无关实体保持原样。 */
export function removeWorldActor_ACU(ledger: WorldSimulationLedger_ACU, actorId: string): WorldSimulationLedger_ACU {
  if (!ledger.actors.some(actor => actor.id === actorId)) return ledger;
  const removeId = (ids: string[]): string[] => ids.filter(id => id !== actorId);
  const actorReferences = <T extends { actorIds: string[]; revision: number }>(items: T[]): T[] => items.map(item =>
    item.actorIds.includes(actorId) ? { ...item, actorIds: removeId(item.actorIds), revision: item.revision + 1 } : item);
  const factReferences = (items: WorldSimulationLedger_ACU['facts']): WorldSimulationLedger_ACU['facts'] => items.map(fact => {
    const actorChanged = fact.actorIds.includes(actorId);
    const gateIds = fact.revealGate?.actorIds;
    const gateChanged = Array.isArray(gateIds) && gateIds.includes(actorId);
    if (!actorChanged && !gateChanged) return fact;
    return {
      ...fact,
      ...(actorChanged ? { actorIds: removeId(fact.actorIds) } : {}),
      ...(gateChanged ? { revealGate: fact.revealState === 'locked' ? null
        : { ...fact.revealGate, actorIds: removeId(gateIds as string[]) } } : {}),
      revision: fact.revision + 1,
    };
  });
  return {
    ...ledger,
    revision: ledger.revision + 1,
    actors: ledger.actors.filter(actor => actor.id !== actorId),
    worldEvents: actorReferences(ledger.worldEvents),
    facts: factReferences(ledger.facts),
    ...(ledger.factArchive === undefined ? {} : { factArchive: factReferences(ledger.factArchive) }),
    historyMilestones: actorReferences(ledger.historyMilestones),
    ...(ledger.historyArchive === undefined ? {} : { historyArchive: actorReferences(ledger.historyArchive) }),
    seeds: actorReferences(ledger.seeds),
    rumors: ledger.rumors.map(rumor => rumor.relatedActorIds.includes(actorId)
      ? { ...rumor, relatedActorIds: removeId(rumor.relatedActorIds), revision: rumor.revision + 1 } : rumor),
    chronicle: ledger.chronicle.map(entry => entry.relatedIds.includes(actorId)
      ? { ...entry, relatedIds: removeId(entry.relatedIds) } : entry),
  };
}
