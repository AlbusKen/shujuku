import {
  createWorldSimError_ACU,
  isWorldEntity_ACU,
  isWorldEvent_ACU,
  isWorldStateSnapshot_ACU,
  isWorldStableId_ACU,
  isWorldStoryClock_ACU,
  isWorldThread_ACU,
  WorldSimulationValidationError_ACU,
  type WorldEntity_ACU,
  type WorldEvent_ACU,
  type WorldModuleRevisions_ACU,
  type WorldSimulationModule_ACU,
  type WorldSimulationTransaction_ACU,
  type WorldStateSnapshot_ACU,
  type WorldThread_ACU,
  type WorldVisibilityPolicy_ACU,
  type WorldVisibility_ACU,
} from './model';

type Retirable_ACU = { id: string; retired: boolean; retiredReason?: string; updatedIndex: number };
type TransactionItem_ACU<T extends Retirable_ACU> = { action: 'upsert'; value: T } | { action: 'retire'; id: string; reason: string };

const VISIBILITY_POLICIES_ACU: readonly WorldVisibilityPolicy_ACU[] = ['agent', 'always_hidden', 'always_revealed'];
const MODULES_ACU: readonly WorldSimulationModule_ACU[] = ['entities', 'events', 'threads'];

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeInteger_ACU(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function reject_ACU(code: 'WORLD_SIM_PROTOCOL_INVALID' | 'WORLD_SIM_CONFLICT', message: string, details?: Record<string, unknown>): never {
  throw new WorldSimulationValidationError_ACU(createWorldSimError_ACU(code, 'transaction', message, false, details));
}

function assertTransactionShape_ACU(
  snapshot: WorldStateSnapshot_ACU,
  transaction: WorldSimulationTransaction_ACU,
  maxTrackedEntities: number,
): readonly WorldSimulationModule_ACU[] {
  if (!isWorldStateSnapshot_ACU(snapshot)) reject_ACU('WORLD_SIM_PROTOCOL_INVALID', '世界推演事务基底快照非法');
  if (!isRecord_ACU(transaction) || !isNonNegativeInteger_ACU(transaction.anchorMessageIndex)
    || transaction.anchorMessageIndex < snapshot.anchorMessageIndex || !isWorldStoryClock_ACU(transaction.storyClock)
    || !isRecord_ACU(transaction.expectedRevisions) || !Array.isArray(transaction.entities)
    || !Array.isArray(transaction.events) || !Array.isArray(transaction.threads)) {
    reject_ACU('WORLD_SIM_PROTOCOL_INVALID', '世界推演事务载荷非法');
  }
  if (!Number.isInteger(maxTrackedEntities) || maxTrackedEntities < 1) {
    reject_ACU('WORLD_SIM_PROTOCOL_INVALID', 'maxTrackedEntities 必须是正整数', { maxTrackedEntities });
  }
  const touched = MODULES_ACU.filter(module => transaction[module].length > 0);
  if (!touched.length) reject_ACU('WORLD_SIM_PROTOCOL_INVALID', '世界推演事务不能是空写集');
  const expectedKeys = Object.keys(transaction.expectedRevisions);
  if (expectedKeys.length !== touched.length || expectedKeys.some(key => !touched.includes(key as WorldSimulationModule_ACU))) {
    reject_ACU('WORLD_SIM_PROTOCOL_INVALID', 'expectedRevisions 必须且只能声明被写入模块');
  }
  for (const module of touched) {
    const expected = transaction.expectedRevisions[module];
    if (!isNonNegativeInteger_ACU(expected)) reject_ACU('WORLD_SIM_PROTOCOL_INVALID', '被写入模块缺少合法 expectedRevision', { module });
    if (expected !== snapshot.revisions[module]) reject_ACU('WORLD_SIM_CONFLICT', '世界推演模块 revision 已变化，拒绝整批事务', { module, expected, actual: snapshot.revisions[module] });
  }
  return touched;
}

function clone_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function applyItems_ACU<T extends Retirable_ACU>(
  existing: readonly T[],
  items: readonly TransactionItem_ACU<T>[],
  anchorMessageIndex: number,
  isValid: (value: unknown) => value is T,
  label: string,
): T[] {
  const byId = new Map<string, T>();
  for (const entry of existing) {
    if (!isWorldStableId_ACU(entry.id) || byId.has(entry.id)) {
      reject_ACU('WORLD_SIM_PROTOCOL_INVALID', `${label} 模块存在非法或重复稳定 id`, { id: entry.id });
    }
    byId.set(entry.id, clone_ACU(entry));
  }
  const operatedIds = new Set<string>();
  for (const rawItem of items) {
    if (!isRecord_ACU(rawItem) || (rawItem.action !== 'upsert' && rawItem.action !== 'retire')) {
      reject_ACU('WORLD_SIM_PROTOCOL_INVALID', `${label} 写集操作非法`);
    }
    if (rawItem.action === 'upsert') {
      const value = rawItem.value;
      if (!isValid(value) || value.retired) {
        reject_ACU('WORLD_SIM_PROTOCOL_INVALID', `${label} upsert 条目非法；退役必须使用 retire 操作`);
      }
      if (operatedIds.has(value.id)) reject_ACU('WORLD_SIM_PROTOCOL_INVALID', `${label} 写集重复操作同一稳定 id`, { id: value.id });
      operatedIds.add(value.id);
      byId.set(value.id, { ...clone_ACU(value), updatedIndex: anchorMessageIndex });
      continue;
    }
    const id = rawItem.id;
    const reason = typeof rawItem.reason === 'string' ? rawItem.reason.trim() : '';
    if (!isWorldStableId_ACU(id) || !reason) reject_ACU('WORLD_SIM_PROTOCOL_INVALID', `${label} retire 必须提供规范稳定 id 和原因`);
    if (operatedIds.has(id)) reject_ACU('WORLD_SIM_PROTOCOL_INVALID', `${label} 写集重复操作同一稳定 id`, { id });
    const current = byId.get(id);
    if (!current) reject_ACU('WORLD_SIM_PROTOCOL_INVALID', `${label} retire 的条目不存在`, { id });
    operatedIds.add(id);
    byId.set(id, { ...current, retired: true, retiredReason: reason, updatedIndex: anchorMessageIndex });
  }
  return [...byId.values()];
}

function assertTrackedEntityCapacity_ACU(
  previous: readonly WorldEntity_ACU[],
  next: readonly WorldEntity_ACU[],
  maxTrackedEntities: number,
): void {
  const countTracked = (entries: readonly WorldEntity_ACU[]) => entries.filter(entry => !entry.retired && (entry.importance === 'core' || entry.importance === 'active')).length;
  const nextCount = countTracked(next);
  if (nextCount > maxTrackedEntities) {
    reject_ACU('WORLD_SIM_CONFLICT', 'core + active 实体超过 maxTrackedEntities，事务最终状态必须先退役或降级至上限以内', {
      maxTrackedEntities,
      nextCount,
    });
  }
}

function assertStableIds_ACU(entries: readonly Retirable_ACU[], label: string): void {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!isWorldStableId_ACU(entry.id) || ids.has(entry.id)) reject_ACU('WORLD_SIM_PROTOCOL_INVALID', `${label} 模块存在非法或重复稳定 id`, { id: entry.id });
    ids.add(entry.id);
  }
}

function normalizedVisibility_ACU(policy: WorldVisibilityPolicy_ACU, anchorMessageIndex: number, current: WorldVisibility_ACU): WorldVisibility_ACU {
  if (policy === 'agent') return clone_ACU(current);
  if (policy === 'always_hidden') return { mode: 'hidden' };
  return { mode: 'revealed', revealedIndex: anchorMessageIndex };
}

function normalizeVisibilityItems_ACU<T extends Retirable_ACU & { visibility: WorldVisibility_ACU }>(
  items: readonly TransactionItem_ACU<T>[],
  policy: WorldVisibilityPolicy_ACU,
  anchorMessageIndex: number,
): TransactionItem_ACU<T>[] {
  return items.map(item => {
    if (item.action === 'retire') return { ...item };
    if (item.value.retired) return { action: 'upsert', value: clone_ACU(item.value) };
    return { action: 'upsert', value: { ...clone_ACU(item.value), visibility: normalizedVisibility_ACU(policy, anchorMessageIndex, item.value.visibility) } };
  });
}

/**
 * Applies the saved visibility policy to a final candidate write set before transaction validation.
 * Retire operations and untouched ledger entries deliberately retain their existing visibility.
 */
export function normalizeWorldSimulationTransactionVisibility_ACU(
  transaction: WorldSimulationTransaction_ACU,
  policy: WorldVisibilityPolicy_ACU = 'agent',
): WorldSimulationTransaction_ACU {
  if (!VISIBILITY_POLICIES_ACU.includes(policy)) reject_ACU('WORLD_SIM_PROTOCOL_INVALID', '世界推演 visibilityPolicy 非法', { policy });
  return {
    ...transaction,
    expectedRevisions: { ...transaction.expectedRevisions },
    entities: normalizeVisibilityItems_ACU(transaction.entities, policy, transaction.anchorMessageIndex),
    events: normalizeVisibilityItems_ACU(transaction.events, policy, transaction.anchorMessageIndex),
    threads: normalizeVisibilityItems_ACU(transaction.threads, policy, transaction.anchorMessageIndex),
  };
}

/**
 * Applies one explicit world-state write set without mutating the source snapshot.
 * Each touched module must carry the revision that the caller read.
 */
export function applyWorldSimulationTransaction_ACU(
  snapshot: WorldStateSnapshot_ACU,
  transaction: WorldSimulationTransaction_ACU,
  maxTrackedEntities: number,
): WorldStateSnapshot_ACU {
  const touched = assertTransactionShape_ACU(snapshot, transaction, maxTrackedEntities);
  assertStableIds_ACU(snapshot.entities, '实体');
  assertStableIds_ACU(snapshot.events, '事件');
  assertStableIds_ACU(snapshot.threads, '线索');
  const entities = touched.includes('entities')
    ? applyItems_ACU(snapshot.entities, transaction.entities, transaction.anchorMessageIndex, isWorldEntity_ACU, '实体')
    : clone_ACU(snapshot.entities);
  const events = touched.includes('events')
    ? applyItems_ACU(snapshot.events, transaction.events, transaction.anchorMessageIndex, isWorldEvent_ACU, '事件')
    : clone_ACU(snapshot.events);
  const threads = touched.includes('threads')
    ? applyItems_ACU(snapshot.threads, transaction.threads, transaction.anchorMessageIndex, isWorldThread_ACU, '线索')
    : clone_ACU(snapshot.threads);
  assertTrackedEntityCapacity_ACU(snapshot.entities, entities, maxTrackedEntities);
  const revisions: WorldModuleRevisions_ACU = {
    entities: snapshot.revisions.entities + (touched.includes('entities') ? 1 : 0),
    events: snapshot.revisions.events + (touched.includes('events') ? 1 : 0),
    threads: snapshot.revisions.threads + (touched.includes('threads') ? 1 : 0),
  };
  return {
    anchorMessageIndex: transaction.anchorMessageIndex,
    storyClock: clone_ACU(transaction.storyClock),
    entities,
    events,
    threads,
    revisions,
  };
}
