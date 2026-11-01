import type { WorldFact_ACU, WorldSimulationLedger_ACU } from './model';
import { isWorldFactEstablishedAt_ACU } from './world-fact-gate';

const FACT_ARCHIVE_RETAIN_ROUNDS_ACU = 10;

/** 统一读取热、冷事实；只读，不因读取将冷事实复活。 */
export function allWorldFacts_ACU(ledger: WorldSimulationLedger_ACU): WorldFact_ACU[] {
  return [...ledger.facts, ...(ledger.factArchive ?? [])];
}

export function normalizeWorldFactArchive_ACU(ledger: WorldSimulationLedger_ACU): WorldSimulationLedger_ACU {
  const deliveryIds = new Set(ledger.projection.deliveries.map(delivery => delivery.factId));
  const all = allWorldFacts_ACU(ledger);
  const supersededIds = new Set<string>();
  for (const fact of all) {
    if (!isWorldFactEstablishedAt_ACU(fact, ledger.clock)) continue;
    for (const id of fact.supersedesFactIds) supersededIds.add(id);
  }
  const coldIds = new Set(ledger.factArchive?.map(fact => fact.id) ?? []);
  for (const fact of ledger.facts) {
    if (deliveryIds.has(fact.id) || (fact.nextCheck !== null && fact.nextCheck.day >= ledger.clock.day)) continue;
    if ((fact.temporalKind === 'condition' && fact.validUntil !== null && fact.validUntil.day < ledger.clock.day)
      || supersededIds.has(fact.id)) coldIds.add(fact.id);
  }
  if (!coldIds.size && ledger.factArchive === undefined && ledger.factArchiveRetention === undefined) return ledger;
  const completedRounds = (ledger.factArchiveRetention?.completedRounds ?? 0) + 1;
  const enteredAtRound = Object.fromEntries([...coldIds].map(id => [id, ledger.factArchiveRetention?.enteredAtRound[id] ?? completedRounds]));
  const expiredIds = new Set([...coldIds].filter(id => completedRounds - enteredAtRound[id] > FACT_ARCHIVE_RETAIN_ROUNDS_ACU));
  for (const id of expiredIds) delete enteredAtRound[id];
  // 清理来源引用而非历史正文，防止归档删除后留下无法读取的账本。
  const retainedFact = (fact: WorldFact_ACU): WorldFact_ACU => expiredIds.size
    ? { ...fact, supersedesFactIds: fact.supersedesFactIds.filter(id => !expiredIds.has(id)) } : fact;
  return {
    ...ledger,
    facts: ledger.facts.filter(fact => !coldIds.has(fact.id)).map(retainedFact),
    factArchive: all.filter(fact => coldIds.has(fact.id) && !expiredIds.has(fact.id)).map(retainedFact),
    factArchiveRetention: { completedRounds, enteredAtRound },
    ...(expiredIds.size ? {
      historyMilestones: ledger.historyMilestones.map(item => ({ ...item, sourceFactIds: item.sourceFactIds.filter(id => !expiredIds.has(id)) })),
      ...(ledger.historyArchive === undefined ? {} : {
        historyArchive: ledger.historyArchive.map(item => ({ ...item, sourceFactIds: item.sourceFactIds.filter(id => !expiredIds.has(id)) })),
      }),
    } : {}),
  };
}
