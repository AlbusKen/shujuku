import type {
  WorldEvent_ACU, WorldFact_ACU, WorldHistoryMilestone_ACU, WorldLocationRef_ACU, WorldProjection_ACU, WorldSimulationLedger_ACU,
  WorldTime_ACU,
} from './model';
import { collectLockedGateEventIds_ACU } from './world-event-removal';

/** 联合审查一次最多看到的“可清理候选”条数；超出预算时由调用方继续折半。 */
export const WORLD_FACT_PRUNE_CATALOG_LIMIT_ACU = 120;
/** 已结束事件目录的上限；与事实目录共享同一份输入预算，超预算时两类目录一起折半。 */
export const WORLD_EVENT_PRUNE_CATALOG_LIMIT_ACU = 60;
const SUMMARY_LIMIT_ACU = 400;
const LINK_LIMIT_ACU = 4;

/**
 * 内部管理事实：与界面“内部管理事实”栏一致，即不是“场景且已解锁”的热事实。
 * 场景事实、factArchive、世界事件、人物、历史、纪要与正文都不在此范围。
 */
export function isInternalManagedWorldFact_ACU(fact: Pick<WorldFact_ACU, 'projectionPolicy' | 'revealState'>): boolean {
  return fact.projectionPolicy !== 'scene' || fact.revealState !== 'unlocked';
}

export interface WorldFactPruneCandidate_ACU {
  id: string;
  summary: string;
  projectionPolicy: WorldFact_ACU['projectionPolicy'];
  revealState: WorldFact_ACU['revealState'];
  temporalKind: WorldFact_ACU['temporalKind'];
  happenedAt?: WorldTime_ACU;
  validFrom?: WorldTime_ACU;
  validUntil?: WorldTime_ACU;
  worldEventIds?: string[];
  /** 关联事件当前状态，帮助判断“是否仍影响进行中事件”。 */
  eventStatus?: Record<string, string>;
  actorIds?: string[];
  supersededByFactIds?: string[];
  citedByHistoryIds?: string[];
}

function dayOf_ACU(fact: WorldFact_ACU): number {
  return (fact.temporalKind === 'occurrence' ? fact.happenedAt : fact.validFrom)?.day ?? 0;
}

/**
 * 构建可清理候选目录。只收录 eligibleIds（提交前已存在）且不在 excludeIds（本轮写入）中的内部管理事实；
 * 已被取代或已有结束时间的条目排在前面，其余按成立时间由旧到新。
 */
export function buildWorldFactPruneCatalog_ACU(
  ledger: WorldSimulationLedger_ACU,
  options: { eligibleIds: ReadonlySet<string>; excludeIds: ReadonlySet<string> },
): WorldFactPruneCandidate_ACU[] {
  const allFacts = [...ledger.facts, ...(ledger.factArchive ?? [])];
  const eventStatus = new Map(ledger.worldEvents.map(event => [event.id, event.status]));
  const histories: WorldHistoryMilestone_ACU[] = [...ledger.historyMilestones, ...(ledger.historyArchive ?? [])];
  const rows = ledger.facts
    .filter(fact => isInternalManagedWorldFact_ACU(fact) && options.eligibleIds.has(fact.id) && !options.excludeIds.has(fact.id))
    .map(fact => {
      const supersededBy = allFacts.filter(item => item.supersedesFactIds.includes(fact.id)).map(item => item.id).slice(0, LINK_LIMIT_ACU);
      const citedBy = histories.filter(item => item.sourceFactIds.includes(fact.id)).map(item => item.id).slice(0, LINK_LIMIT_ACU);
      const candidate: WorldFactPruneCandidate_ACU = {
        id: fact.id,
        summary: fact.summary.length > SUMMARY_LIMIT_ACU ? `${fact.summary.slice(0, SUMMARY_LIMIT_ACU)}…` : fact.summary,
        projectionPolicy: fact.projectionPolicy, revealState: fact.revealState, temporalKind: fact.temporalKind,
        ...(fact.happenedAt ? { happenedAt: { ...fact.happenedAt } } : {}),
        ...(fact.validFrom ? { validFrom: { ...fact.validFrom } } : {}),
        ...(fact.validUntil ? { validUntil: { ...fact.validUntil } } : {}),
        ...(fact.worldEventIds.length ? {
          worldEventIds: [...fact.worldEventIds],
          eventStatus: Object.fromEntries(fact.worldEventIds.flatMap(id => eventStatus.has(id) ? [[id, eventStatus.get(id)!]] : [])),
        } : {}),
        ...(fact.actorIds.length ? { actorIds: [...fact.actorIds] } : {}),
        ...(supersededBy.length ? { supersededByFactIds: supersededBy } : {}),
        ...(citedBy.length ? { citedByHistoryIds: citedBy } : {}),
      };
      const strong = supersededBy.length > 0 || fact.validUntil !== null;
      return { candidate, strong, day: dayOf_ACU(fact) };
    });
  rows.sort((left, right) => Number(right.strong) - Number(left.strong)
    || left.day - right.day || left.candidate.id.localeCompare(right.candidate.id));
  return rows.slice(0, WORLD_FACT_PRUNE_CATALOG_LIMIT_ACU).map(row => row.candidate);
}

/**
 * 唯一的程序侧过滤：ID 必须存在于提交前热事实、属于内部管理事实、且不是本轮写入或改写的事实。
 * 不符合者静默跳过；结果去重并排序，保证两条提交路径重新物化时结果一致。
 */
export function selectRemovableWorldFactIds_ACU(
  previous: Pick<WorldSimulationLedger_ACU, 'facts'>,
  factWrites: readonly { value: { id: string } }[],
  requested: unknown,
): string[] {
  if (!Array.isArray(requested) || !requested.length) return [];
  const written = new Set(factWrites.map(write => write?.value?.id));
  const eligible = new Set(previous.facts.filter(isInternalManagedWorldFact_ACU).map(fact => fact.id));
  const result = new Set<string>();
  for (const id of requested) {
    if (typeof id === 'string' && eligible.has(id) && !written.has(id)) result.add(id);
  }
  return [...result].sort();
}

export interface WorldEventPruneCandidate_ACU {
  id: string;
  title: string;
  state: string;
  status: WorldEvent_ACU['status'];
  startedAt?: WorldTime_ACU;
  deadline?: WorldTime_ACU;
  locationRefs?: WorldLocationRef_ACU[];
  actorIds?: string[];
  /** 仍引用该事件的进行中事件（scheduled/active/paused）及其状态。 */
  referencedByActiveEvents?: Array<{ id: string; status: string }>;
  relatedFactIds?: string[];
  citedByHistoryIds?: string[];
}

export function isEndedWorldEvent_ACU(event: Pick<WorldEvent_ACU, 'status'>): boolean {
  return event.status === 'resolved' || event.status === 'cancelled';
}

/**
 * 唯一的结构性排除：仍被未解锁事实的揭示条件引用的事件不进目录也不会被删，否则该秘密永远无法揭示。
 * 提交前的热/冷事实和本轮写入的事实都算；其余语义判断全部交给联合审查专员。
 */
function lockedGateEventIds_ACU(
  previous: Pick<WorldSimulationLedger_ACU, 'facts' | 'factArchive'>, factWrites: readonly { value: WorldFact_ACU }[],
): Set<string> {
  return collectLockedGateEventIds_ACU([
    ...previous.facts, ...(previous.factArchive ?? []), ...factWrites.flatMap(write => write?.value ? [write.value] : []),
  ]);
}

/**
 * 程序侧过滤：事件必须存在于提交前账本、已是 resolved/cancelled、不是本轮写入的事件，
 * 且不被任何未解锁事实的揭示条件引用。不符合者静默跳过；结果去重排序，保证两条提交路径重新物化时一致。
 */
export function selectRemovableWorldEventIds_ACU(
  previous: Pick<WorldSimulationLedger_ACU, 'worldEvents' | 'facts' | 'factArchive'>,
  worldEventWrites: readonly { value: { id: string } }[],
  factWrites: readonly { value: WorldFact_ACU }[],
  requested: unknown,
): string[] {
  if (!Array.isArray(requested) || !requested.length) return [];
  const written = new Set(worldEventWrites.map(write => write?.value?.id));
  const locked = lockedGateEventIds_ACU(previous, factWrites);
  const eligible = new Set(previous.worldEvents.filter(isEndedWorldEvent_ACU).map(event => event.id));
  const result = new Set<string>();
  for (const id of requested) {
    if (typeof id === 'string' && eligible.has(id) && !written.has(id) && !locked.has(id)) result.add(id);
  }
  return [...result].sort();
}

function startDay_ACU(event: WorldEvent_ACU): number { return event.startedAt?.day ?? 0; }

/**
 * 构建已结束事件的清理候选目录。只收录提交前（base）就已 resolved/cancelled、本轮没有写入、
 * 且未被未解锁揭示条件引用的事件；没有进行中事件引用的排在前面，其余按起点由旧到新。
 * ledger 用最终物化账本，因此事实、历史引用已包含本轮写入。
 */
export function buildWorldEventPruneCatalog_ACU(
  base: Pick<WorldSimulationLedger_ACU, 'worldEvents' | 'facts' | 'factArchive'>,
  ledger: WorldSimulationLedger_ACU,
  writes: { worldEventWrites: readonly { value: { id: string } }[]; factWrites: readonly { value: WorldFact_ACU }[] },
): WorldEventPruneCandidate_ACU[] {
  const removable = new Set(selectRemovableWorldEventIds_ACU(
    base, writes.worldEventWrites, writes.factWrites, base.worldEvents.filter(isEndedWorldEvent_ACU).map(event => event.id)));
  const facts = [...ledger.facts, ...(ledger.factArchive ?? [])];
  const histories: WorldHistoryMilestone_ACU[] = [...ledger.historyMilestones, ...(ledger.historyArchive ?? [])];
  const rows = ledger.worldEvents.filter(event => removable.has(event.id)).map(event => {
    const active = ledger.worldEvents.filter(item => !isEndedWorldEvent_ACU(item) && item.relatedEventIds.includes(event.id))
      .slice(0, LINK_LIMIT_ACU).map(item => ({ id: item.id, status: item.status }));
    const relatedFacts = facts.filter(item => item.worldEventIds.includes(event.id)).map(item => item.id).slice(0, LINK_LIMIT_ACU);
    const cited = histories.filter(item => item.worldEventIds.includes(event.id)).map(item => item.id).slice(0, LINK_LIMIT_ACU);
    const candidate: WorldEventPruneCandidate_ACU = {
      id: event.id,
      title: event.title,
      state: event.state.length > SUMMARY_LIMIT_ACU ? `${event.state.slice(0, SUMMARY_LIMIT_ACU)}…` : event.state,
      status: event.status,
      ...(event.startedAt ? { startedAt: { ...event.startedAt } } : {}),
      ...(event.deadline ? { deadline: { ...event.deadline } } : {}),
      ...(event.locationRefs.length ? { locationRefs: event.locationRefs.map(ref => ({ ...ref })) } : {}),
      ...(event.actorIds.length ? { actorIds: [...event.actorIds] } : {}),
      ...(active.length ? { referencedByActiveEvents: active } : {}),
      ...(relatedFacts.length ? { relatedFactIds: relatedFacts } : {}),
      ...(cited.length ? { citedByHistoryIds: cited } : {}),
    };
    return { candidate, referenced: active.length > 0, day: startDay_ACU(event) };
  });
  rows.sort((left, right) => Number(left.referenced) - Number(right.referenced)
    || left.day - right.day || left.candidate.id.localeCompare(right.candidate.id));
  return rows.slice(0, WORLD_EVENT_PRUNE_CATALOG_LIMIT_ACU).map(row => row.candidate);
}

type PrunableParts_ACU = {
  facts: WorldFact_ACU[];
  factArchive?: WorldFact_ACU[];
  historyMilestones: WorldHistoryMilestone_ACU[];
  historyArchive?: WorldHistoryMilestone_ACU[];
  projection: WorldProjection_ACU;
};

/**
 * 移除事实本体并清理其结构化 ID 引用（取代链、历史来源、投送回执）；只清 ID，不删引用方、不改叙述文字。
 * chronicle.relatedIds 只允许指向维度、人物与种子，账本校验不接受事实 ID，因此无需处理。
 * 引用方 revision 仅在“与提交前相同”（即本轮未被写入）时 +1，避免与本轮写入的 revision 冲突。
 */
export function removeWorldFactsFromLedgerParts_ACU(
  previous: WorldSimulationLedger_ACU, current: PrunableParts_ACU, ids: ReadonlySet<string>,
): PrunableParts_ACU {
  const previousFactRevisions = new Map([...previous.facts, ...(previous.factArchive ?? [])].map(fact => [fact.id, fact.revision]));
  const previousHistoryRevisions = new Map([...previous.historyMilestones, ...(previous.historyArchive ?? [])].map(item => [item.id, item.revision]));
  const cleanFact = (fact: WorldFact_ACU): WorldFact_ACU => {
    if (!fact.supersedesFactIds.some(id => ids.has(id))) return fact;
    return { ...fact, supersedesFactIds: fact.supersedesFactIds.filter(id => !ids.has(id)),
      ...(previousFactRevisions.get(fact.id) === fact.revision ? { revision: fact.revision + 1 } : {}) };
  };
  const cleanHistory = (item: WorldHistoryMilestone_ACU): WorldHistoryMilestone_ACU => {
    if (!item.sourceFactIds.some(id => ids.has(id))) return item;
    return { ...item, sourceFactIds: item.sourceFactIds.filter(id => !ids.has(id)),
      ...(previousHistoryRevisions.get(item.id) === item.revision ? { revision: item.revision + 1 } : {}) };
  };
  return {
    facts: current.facts.filter(fact => !ids.has(fact.id)).map(cleanFact),
    ...(current.factArchive === undefined ? {} : { factArchive: current.factArchive.map(cleanFact) }),
    historyMilestones: current.historyMilestones.map(cleanHistory),
    ...(current.historyArchive === undefined ? {} : { historyArchive: current.historyArchive.map(cleanHistory) }),
    projection: { ...current.projection, deliveries: current.projection.deliveries.filter(delivery => !ids.has(delivery.factId)) },
  };
}

/** 联合审查固定协议中追加的清理职责说明（body 与仅清理两种请求共用；目录不存在的一类直接忽略）。 */
export const WORLD_FACT_PRUNE_DUTY_ACU = '另有两项清理职责，只处理 WORLD_RUNTIME_CONTEXT 中实际出现的目录。其一，pruneCandidates 是“内部管理事实”目录，只含尚未对台前公开的内部或锁定事实，不含场景事实、过期事件栏、人物、重要历史和正文。仅当某条事实已经无用时，才把它的 id 放入 pruneFactIds：被后续事实取代或已不再成立的旧状态、重复记录、已结束且不再影响任何进行中事件或人物的过程性记录、琐碎的中间步骤。仍在等待揭示且仍有意义的秘密或锁定事实、仍在影响进行中事件或人物处境的条件、被重要历史作为来源依据且仍有追溯意义的事实必须保留。其二，pruneEventCandidates 是“已结束世界事件”目录，只含状态为已收束或已取消、且不是本轮写入的事件，每条附有引用它的进行中事件、关联事实和重要历史。仅当某个事件已经无用时，才把它的 id 放入 pruneEventIds：冻结正文（ANCHOR_MESSAGE）已经写过它的结果，或已经没有任何进行中事件和人物还依赖它。仍有进行中的后续事件引用它、仍被人物当前行动或短期事务依赖、结果在正文里还没有写到的事件必须保留。删除事件只去掉事件条目和别处对它的 id 引用，它的结果事实和重要历史都不会被删除。两项都是拿不准就保留；pruneFactIds、pruneEventIds 只能使用对应目录内的 id，没有可清理的返回 []。清理判断不得影响场景、接触与语义审查结论。';

const PRUNE_KEYS_ACU = ['prunefactids', 'prunefacts', 'prune', 'removefactids', 'removefacts', 'deletefactids', 'factremovals', 'cleanupfactids'];
const ITEM_ID_KEYS_ACU = ['factid', 'id', 'fact'];
const PRUNE_EVENT_KEYS_ACU = ['pruneeventids', 'pruneevents', 'removeeventids', 'removeevents', 'deleteeventids', 'eventremovals', 'cleanupeventids'];
const EVENT_ITEM_ID_KEYS_ACU = ['eventid', 'id', 'event'];

function normalizeKey_ACU(key: string): string { return key.normalize('NFKC').replace(/[\s_-]/g, '').toLowerCase(); }
function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 宽容解析清理回复：接受别名字段、字符串数组或带理由/保留标记的对象数组；
 * 只返回目录内的 ID（精确或唯一的忽略大小写匹配），任何畸形输入都返回空数组，不抛错。
 */
function parsePruneIds_ACU(
  parsed: unknown, offeredIds: readonly string[], listKeys: readonly string[], itemIdKeys: readonly string[],
): string[] {
  if (!isRecord_ACU(parsed) || !offeredIds.length) return [];
  const entry = Object.entries(parsed).find(([key]) => listKeys.includes(normalizeKey_ACU(key)));
  if (!entry || !Array.isArray(entry[1])) return [];
  const offered = new Set(offeredIds);
  const resolve = (value: unknown): string | null => {
    if (typeof value !== 'string' || !value.trim()) return null;
    if (offered.has(value)) return value;
    if (offered.has(value.trim())) return value.trim();
    const matches = offeredIds.filter(id => id.toLowerCase() === value.trim().toLowerCase());
    return matches.length === 1 ? matches[0] : null;
  };
  const result = new Set<string>();
  for (const item of entry[1]) {
    let id: string | null = null;
    if (typeof item === 'string') id = resolve(item);
    else if (isRecord_ACU(item)) {
      const keep = item.keep === true || item.retain === true || item.prune === false || item.remove === false || item.delete === false;
      if (keep) continue;
      const idEntry = Object.entries(item).find(([key]) => itemIdKeys.includes(normalizeKey_ACU(key)));
      id = idEntry ? resolve(idEntry[1]) : null;
    }
    if (id) result.add(id);
  }
  return [...result];
}

export function parseWorldFactPruneIds_ACU(parsed: unknown, offeredIds: readonly string[]): string[] {
  return parsePruneIds_ACU(parsed, offeredIds, PRUNE_KEYS_ACU, ITEM_ID_KEYS_ACU);
}

/** 解析 pruneEventIds，风格与事实清理一致：只接受目录内 id，缺省或畸形为空数组。 */
export function parseWorldEventPruneIds_ACU(parsed: unknown, offeredIds: readonly string[]): string[] {
  return parsePruneIds_ACU(parsed, offeredIds, PRUNE_EVENT_KEYS_ACU, EVENT_ITEM_ID_KEYS_ACU);
}
