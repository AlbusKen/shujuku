import type { WorldSimulationLedger_ACU } from './model';

/**
 * 人工删除一条重要历史（热层或冷层）。账本里没有任何其他实体按历史 ID 引用它：
 * 正文记载标记 narrativeRecord 在历史条目自身上，事实、事件、人物、纪要和投送回执都不记录历史 ID，
 * 所以只需从所在分区去掉该条；人物、事件、事实、正文和其余历史保持原样。
 * 不存在时返回原对象；整本账本 revision +1。
 */
export function removeWorldHistoryMilestone_ACU(ledger: WorldSimulationLedger_ACU, historyId: string): WorldSimulationLedger_ACU {
  const hot = ledger.historyMilestones.some(item => item.id === historyId);
  const cold = ledger.historyArchive?.some(item => item.id === historyId) ?? false;
  if (!hot && !cold) return ledger;
  return {
    ...ledger,
    revision: ledger.revision + 1,
    ...(hot ? { historyMilestones: ledger.historyMilestones.filter(item => item.id !== historyId) } : {}),
    ...(cold && ledger.historyArchive ? { historyArchive: ledger.historyArchive.filter(item => item.id !== historyId) } : {}),
  };
}
