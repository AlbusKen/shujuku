import type { WorldFact_ACU, WorldLocationRef_ACU, WorldSimulationLedger_ACU, WorldTime_ACU } from './model';

/** 仅声明可验证的门槛；兼容旧自由格式 gate 但不会推断其语义已满足。 */
export interface WorldStructuredRevealGate_ACU {
  actorIds?: string[];
  locationRef?: WorldLocationRef_ACU;
  notBefore?: WorldTime_ACU;
  requiredEventIds?: string[];
  requiredFactIds?: string[];
  semanticCondition: string;
}

export type WorldGateCheck_ACU =
  | { status: 'blocked'; reason: string }
  | { status: 'semantic-review-required'; factId: string; semanticCondition: string };

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys_ACU(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every(key => keys.includes(key));
}

/** 只接受完整、无额外字段的结构化日/时段；自由文本 slot 不可排序。 */
export function isStrictWorldTime_ACU(value: unknown): value is WorldTime_ACU {
  return isRecord_ACU(value) && hasExactKeys_ACU(value, ['day', 'slot'])
    && typeof value.day === 'number' && Number.isSafeInteger(value.day) && value.day >= 1 && typeof value.slot === 'string';
}

function isUsableWorldTime_ACU(value: unknown): value is WorldTime_ACU {
  return isRecord_ACU(value) && typeof value.day === 'number' && Number.isSafeInteger(value.day) && value.day >= 1 && typeof value.slot === 'string';
}

/** 下限已达到：跨日可证明；同日不排序自由文本，仅空下限或非空精确相同的 slot 可证明。 */
export function isWorldTimeReached_ACU(at: WorldTime_ACU, current: WorldTime_ACU): boolean {
  if (!isStrictWorldTime_ACU(at) || !isUsableWorldTime_ACU(current)) return false;
  return at.day < current.day || (at.day === current.day
    && (at.slot === '' || (current.slot !== '' && at.slot === current.slot)));
}

/** 上限尚未越过：跨日可证明；同日空上限覆盖全天，具体 slot 仅精确相同可证明。 */
export function isWorldTimeNotExpired_ACU(until: WorldTime_ACU, current: WorldTime_ACU): boolean {
  if (!isStrictWorldTime_ACU(until) || !isUsableWorldTime_ACU(current)) return false;
  return current.day < until.day || (current.day === until.day
    && (until.slot === '' || (current.slot !== '' && until.slot === current.slot)));
}

/** 事实在候选时间是否已经成立；条件事实还必须能证明没有失效。 */
export function isWorldFactEstablishedAt_ACU(fact: WorldFact_ACU, current: WorldTime_ACU): boolean {
  if (!isUsableWorldTime_ACU(current)) return false;
  const start = fact.temporalKind === 'occurrence' ? fact.happenedAt : fact.validFrom;
  if (!start || !isWorldTimeReached_ACU(start, current)) return false;
  return fact.temporalKind === 'occurrence' || fact.validUntil === null
    || isWorldTimeNotExpired_ACU(fact.validUntil, current);
}

function isStrictLocationRef_ACU(value: unknown): value is WorldLocationRef_ACU & { place: string } {
  return isRecord_ACU(value) && hasExactKeys_ACU(value, ['region', 'place'])
    && typeof value.region === 'string' && value.region.trim() !== ''
    && typeof value.place === 'string' && value.place.trim() !== '';
}

function samePlace_ACU(left: unknown, right: unknown): boolean {
  return isStrictLocationRef_ACU(left) && isStrictLocationRef_ACU(right)
    && left.region === right.region && left.place === right.place;
}

function isStrictIdList_ACU(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(id => typeof id === 'string' && id.trim() !== '')
    && new Set(value).size === value.length;
}

function hasKnownActor_ACU(ledger: WorldSimulationLedger_ACU, id: string): boolean {
  return ledger.actors.some(actor => actor.id === id);
}

/** 不读取事实全文；通过结构条件后仍须在独立语义阶段核验正文锚点。 */
export function checkWorldFactRevealGate_ACU(
  ledger: WorldSimulationLedger_ACU, factId: string, candidateTime: WorldTime_ACU,
  sceneLocation: WorldLocationRef_ACU | null, contactedActorIds: readonly string[],
): WorldGateCheck_ACU {
  const fact: WorldFact_ACU | undefined = ledger.facts.find(item => item.id === factId);
  if (!fact || fact.projectionPolicy !== 'gated' || fact.revealState !== 'locked') {
    return { status: 'blocked', reason: '不是待解锁的 gated fact' };
  }
  if (!isStrictWorldTime_ACU(candidateTime)) return { status: 'blocked', reason: '候选时间结构不受支持' };
  if (!isStrictIdList_ACU(contactedActorIds) || !contactedActorIds.every(id => hasKnownActor_ACU(ledger, id))) {
    return { status: 'blocked', reason: '实际接触人物输入不受支持' };
  }
  const raw = fact.revealGate;
  if (!isRecord_ACU(raw)) return { status: 'blocked', reason: '缺少结构化揭示条件' };
  const allowed = ['actorIds', 'locationRef', 'notBefore', 'requiredEventIds', 'requiredFactIds', 'semanticCondition'];
  if (Object.keys(raw).some(key => !allowed.includes(key)) || typeof raw.semanticCondition !== 'string' || !raw.semanticCondition.trim()) {
    return { status: 'blocked', reason: '揭示条件结构不受支持' };
  }
  const gate = raw as unknown as WorldStructuredRevealGate_ACU;
  if (gate.actorIds !== undefined && (!isStrictIdList_ACU(gate.actorIds)
    || !gate.actorIds.every(id => contactedActorIds.includes(id) && hasKnownActor_ACU(ledger, id)))) {
    return { status: 'blocked', reason: '必要人物尚未实际接触' };
  }
  if (gate.locationRef !== undefined && !samePlace_ACU(gate.locationRef, sceneLocation)) {
    return { status: 'blocked', reason: '场景地点不满足门槛' };
  }
  if (gate.notBefore !== undefined && !isWorldTimeReached_ACU(gate.notBefore, candidateTime)) {
    return { status: 'blocked', reason: '揭示时间尚未达到' };
  }
  if (gate.requiredEventIds !== undefined && (!isStrictIdList_ACU(gate.requiredEventIds)
    || !gate.requiredEventIds.every(id => ledger.worldEvents.some(event => event.id === id && event.status === 'resolved')))) {
    return { status: 'blocked', reason: '前置世界事件未收束' };
  }
  if (gate.requiredFactIds !== undefined && (!isStrictIdList_ACU(gate.requiredFactIds)
    || !gate.requiredFactIds.every(id => [...ledger.facts, ...(ledger.factArchive ?? [])].some(item => item.id === id && isWorldFactEstablishedAt_ACU(item, candidateTime))))) {
    return { status: 'blocked', reason: '前置确定事实尚未成立' };
  }
  if (!isWorldFactEstablishedAt_ACU(fact, candidateTime)) {
    return { status: 'blocked', reason: '事实时间尚未成立或已失效' };
  }
  return { status: 'semantic-review-required', factId, semanticCondition: gate.semanticCondition };
}
