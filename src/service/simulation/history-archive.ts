import { WORLD_CHRONICLE_HOT_WINDOW_ACU, type WorldSimulationLedger_ACU } from './model';

/** 已被正文记录的历史固定进入冷层；未标记历史仍按最近 32 条划分冷热。 */
export function normalizeWorldHistoryArchive_ACU(ledger: WorldSimulationLedger_ACU): WorldSimulationLedger_ACU {
  const archive = ledger.historyArchive;
  const all = [...ledger.historyMilestones, ...(archive ?? [])];
  if (all.length <= WORLD_CHRONICLE_HOT_WINDOW_ACU && archive === undefined
    && !all.some(item => item.narrativeRecord !== undefined)) return ledger;

  const ordered = structuredClone(all).sort((left, right) =>
    right.happenedAt.day - left.happenedAt.day || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const unrecorded = ordered.filter(item => item.narrativeRecord === undefined);
  const hot = unrecorded.slice(0, WORLD_CHRONICLE_HOT_WINDOW_ACU);
  const hotIds = new Set(hot.map(item => item.id));
  return {
    ...ledger,
    historyMilestones: hot,
    historyArchive: ordered.filter(item => !hotIds.has(item.id)),
  };
}
