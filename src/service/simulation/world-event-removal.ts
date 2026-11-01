import type {
  WorldEvent_ACU, WorldFact_ACU, WorldHistoryMilestone_ACU, WorldSimulationLedger_ACU,
} from './model';

/** 事件结构引用所涉及的账本分区；与账本同名字段一一对应。 */
export interface WorldEventRemovalParts_ACU {
  worldEvents: WorldEvent_ACU[];
  facts: WorldFact_ACU[];
  factArchive?: WorldFact_ACU[];
  historyMilestones: WorldHistoryMilestone_ACU[];
  historyArchive?: WorldHistoryMilestone_ACU[];
  chronicle: WorldSimulationLedger_ACU['chronicle'];
}

/** 揭示条件中可能引用世界事件的字段：校验器读 requiredEventIds，人工删除历来只处理 worldEventIds。 */
const REVEAL_GATE_EVENT_KEYS_ACU = ['requiredEventIds', 'worldEventIds'] as const;

/**
 * 仍处于锁定状态、且揭示条件引用了某些世界事件的事实所涉及的事件 ID。
 * 这些事件一旦被删除，对应秘密将永远无法揭示，所以不能被清理。
 */
export function collectLockedGateEventIds_ACU(facts: readonly Pick<WorldFact_ACU, 'revealState' | 'revealGate'>[]): Set<string> {
  const ids = new Set<string>();
  for (const fact of facts) {
    if (fact.revealState !== 'locked' || !fact.revealGate) continue;
    for (const key of REVEAL_GATE_EVENT_KEYS_ACU) {
      const value = fact.revealGate[key];
      if (!Array.isArray(value)) continue;
      for (const id of value) if (typeof id === 'string') ids.add(id);
    }
  }
  return ids;
}

interface RemovalOptions_ACU {
  gateKeys: readonly string[];
  /** 提交前各条目的 revision；给出时，引用方仅在 revision 与提交前相同（本轮未被写入）时才 +1。缺省则总是 +1。 */
  previousRevisions?: { events: ReadonlyMap<string, number>; facts: ReadonlyMap<string, number>; histories: ReadonlyMap<string, number> };
}

/**
 * 移除一组事件本体，并清理其他实体对它们的结构化 ID 引用；不删事实、历史，也不改任何叙述文字。
 * 被锁定事实的揭示条件引用时，条件置空（人工删除沿用的旧约定）；已解锁事实只从条件数组里去掉该 ID。
 */
function removeWorldEventsFromParts_ACU(
  parts: WorldEventRemovalParts_ACU, ids: ReadonlySet<string>, options: RemovalOptions_ACU,
): WorldEventRemovalParts_ACU {
  const without = (list: string[]): string[] => list.filter(id => !ids.has(id));
  const touches = (list: unknown): boolean => Array.isArray(list) && list.some(id => typeof id === 'string' && ids.has(id));
  const bump = (kind: 'events' | 'facts' | 'histories', id: string, revision: number): number => {
    const previous = options.previousRevisions?.[kind];
    return previous === undefined || previous.get(id) === revision ? revision + 1 : revision;
  };
  const facts = (items: WorldFact_ACU[]): WorldFact_ACU[] => items.map(fact => {
    const linked = touches(fact.worldEventIds);
    const gate = fact.revealGate;
    const gated = gate !== null && options.gateKeys.some(key => touches(gate[key]));
    if (!linked && !gated) return fact;
    return { ...fact,
      ...(linked ? { worldEventIds: without(fact.worldEventIds) } : {}),
      ...(gated ? { revealGate: fact.revealState === 'locked' ? null
        : { ...gate, ...Object.fromEntries(options.gateKeys
          .filter(key => touches(gate![key])).map(key => [key, without(gate![key] as string[])])) } } : {}),
      revision: bump('facts', fact.id, fact.revision) };
  });
  const history = (items: WorldHistoryMilestone_ACU[]): WorldHistoryMilestone_ACU[] => items.map(item =>
    touches(item.worldEventIds)
      ? { ...item, worldEventIds: without(item.worldEventIds), revision: bump('histories', item.id, item.revision) } : item);
  return {
    worldEvents: parts.worldEvents.filter(event => !ids.has(event.id)).map(event =>
      touches(event.relatedEventIds)
        ? { ...event, relatedEventIds: without(event.relatedEventIds), revision: bump('events', event.id, event.revision) } : event),
    facts: facts(parts.facts),
    ...(parts.factArchive === undefined ? {} : { factArchive: facts(parts.factArchive) }),
    historyMilestones: history(parts.historyMilestones),
    ...(parts.historyArchive === undefined ? {} : { historyArchive: history(parts.historyArchive) }),
    chronicle: parts.chronicle.map(entry => touches(entry.relatedIds) ? { ...entry, relatedIds: without(entry.relatedIds) } : entry),
  };
}

/** 删除事件及其结构化引用；不改人物、事实、历史的叙述与可见性。人工删除入口，整本账本 revision +1。 */
export function removeWorldEvent_ACU(ledger: WorldSimulationLedger_ACU, eventId: string): WorldSimulationLedger_ACU {
  if (!ledger.worldEvents.some(event => event.id === eventId)) return ledger;
  return { ...ledger, revision: ledger.revision + 1,
    ...removeWorldEventsFromParts_ACU(ledger, new Set([eventId]), { gateKeys: ['worldEventIds'] }) };
}

/**
 * 轮内物化用：删除已结束事件并清理 ID 引用，不碰整本账本 revision（由物化统一 +1）。
 * 引用方 revision 只在“与提交前相同”（本轮未被写入）时 +1，避免与本轮写入的 revision 冲突。
 * 揭示条件的 worldEventIds 与 requiredEventIds 两种引用都会处理。
 */
export function removeWorldEventsFromLedgerParts_ACU(
  previous: WorldSimulationLedger_ACU, current: WorldEventRemovalParts_ACU, ids: ReadonlySet<string>,
): WorldEventRemovalParts_ACU {
  const revisions = (items: readonly { id: string; revision: number }[]): Map<string, number> =>
    new Map(items.map(item => [item.id, item.revision]));
  return removeWorldEventsFromParts_ACU(current, ids, {
    gateKeys: REVEAL_GATE_EVENT_KEYS_ACU,
    previousRevisions: {
      events: revisions(previous.worldEvents),
      facts: revisions([...previous.facts, ...(previous.factArchive ?? [])]),
      histories: revisions([...previous.historyMilestones, ...(previous.historyArchive ?? [])]),
    },
  });
}
