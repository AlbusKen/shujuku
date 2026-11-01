import { validateWorldSimulationLedger_ACU } from './simulation-store';
import { isWorldFactEstablishedAt_ACU } from './world-fact-gate';
import type {
  WorldFact_ACU,
  WorldLocationRef_ACU,
  WorldSimulationCompletedAnchor_ACU,
  WorldSimulationLedger_ACU,
  WorldTime_ACU,
} from './model';

export type WorldDeliveryStatus_ACU = 'intent' | 'attempted' | 'response-durable' | 'reviewed' | 'unknown';

export type WorldDeliveryAttempt_ACU = {
  deliveryId: string;
  target: 'body' | 'plot';
  source: WorldSimulationCompletedAnchor_ACU;
  ledgerRevision: number;
  ledgerFingerprint: string;
  factIds: string[];
  requestFingerprint: string;
  createdAt: number;
  status: WorldDeliveryStatus_ACU;
  successor: WorldSimulationCompletedAnchor_ACU | null;
  adoptedFactIds: string[] | null;
  reviewSource: 'narrative-review' | null;
};

export type WorldDeliveryLifecycle_ACU = {
  schemaVersion: 1;
  revision: number;
  records: WorldDeliveryAttempt_ACU[];
};

export type WorldDeliveryAdoptionReceipt_ACU = {
  schemaVersion: 1;
  deliveryId: string;
  ledgerRevision: number;
  ledgerFingerprint: string;
  source: WorldSimulationCompletedAnchor_ACU;
  successor: WorldSimulationCompletedAnchor_ACU;
  requestFingerprint: string;
  reviewSource: 'narrative-review';
  results: Array<{ factId: string; adopted: boolean; evidenceQuotes: string[] }>;
};

export type WorldDeliveryRedeliveryCandidate_ACU = {
  record: WorldDeliveryAttempt_ACU;
  factIds: string[];
};

export class WorldDeliveryLifecycleError_ACU extends Error {
  constructor(message: string) {
    super(`WORLD_DELIVERY_LIFECYCLE_INVALID: ${message}`);
    this.name = 'WorldDeliveryLifecycleError_ACU';
  }
}

const MAX_RECORDS_ACU = 256;
const MAX_FACT_IDS_ACU = 256;
const MAX_ID_LENGTH_ACU = 160;
const MAX_QUOTE_LENGTH_ACU = 4_096;
const SHA256_HEX_ACU = /^[a-f0-9]{64}$/;

type UnknownRecord_ACU = Record<string, unknown>;

type IntentInput_ACU = Omit<WorldDeliveryAttempt_ACU, 'status' | 'successor' | 'adoptedFactIds' | 'reviewSource'>;

function fail_ACU(message: string): never {
  throw new WorldDeliveryLifecycleError_ACU(message);
}

function isRecord_ACU(value: unknown): value is UnknownRecord_ACU {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys_ACU(value: UnknownRecord_ACU, keys: readonly string[], path: string): void {
  const actual = Object.keys(value);
  if (Object.getOwnPropertySymbols(value).length || actual.length !== keys.length
    || actual.some(key => !keys.includes(key)) || keys.some(key => !Object.prototype.hasOwnProperty.call(value, key))) {
    fail_ACU(`${path} 的字段必须严格为 ${keys.join(', ')}`);
  }
}

function nonEmptyString_ACU(value: unknown, path: string, maximum = MAX_ID_LENGTH_ACU): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail_ACU(`${path} 必须是非空且不超过 ${maximum} 字符的字符串`);
  return value;
}

function hash_ACU(value: unknown, path: string): string {
  if (typeof value !== 'string' || !SHA256_HEX_ACU.test(value)) fail_ACU(`${path} 必须是 64 位小写 SHA-256 十六进制摘要`);
  return value;
}

function safeInteger_ACU(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail_ACU(`${path} 必须是非负安全整数`);
  return value;
}

function clone_ACU<T>(value: T): T {
  return structuredClone(value);
}

function validateAnchor_ACU(value: unknown, path: string): WorldSimulationCompletedAnchor_ACU {
  if (!isRecord_ACU(value)) fail_ACU(`${path} 必须是对象`);
  if (value.kind === 'logical') {
    exactKeys_ACU(value, ['kind', 'chatIdentity', 'logicalRef', 'contentDigest'], path);
    if (!isRecord_ACU(value.logicalRef)) fail_ACU(`${path}.logicalRef 必须是对象`);
    exactKeys_ACU(value.logicalRef, ['sessionId', 'branchId', 'turnId', 'attemptId', 'floorId'], `${path}.logicalRef`);
    return {
      kind: 'logical',
      chatIdentity: nonEmptyString_ACU(value.chatIdentity, `${path}.chatIdentity`, 4096),
      logicalRef: {
        sessionId: nonEmptyString_ACU(value.logicalRef.sessionId, `${path}.logicalRef.sessionId`),
        branchId: nonEmptyString_ACU(value.logicalRef.branchId, `${path}.logicalRef.branchId`),
        turnId: nonEmptyString_ACU(value.logicalRef.turnId, `${path}.logicalRef.turnId`),
        attemptId: nonEmptyString_ACU(value.logicalRef.attemptId, `${path}.logicalRef.attemptId`),
        floorId: nonEmptyString_ACU(value.logicalRef.floorId, `${path}.logicalRef.floorId`),
      },
      contentDigest: hash_ACU(value.contentDigest, `${path}.contentDigest`),
    };
  }
  const accepted = value.kind === undefined
    ? ['chatIdentity', 'messageKey', 'swipeId', 'contentDigest']
    : ['kind', 'chatIdentity', 'messageKey', 'swipeId', 'contentDigest'];
  exactKeys_ACU(value, accepted, path);
  if (value.kind !== undefined && value.kind !== 'host') fail_ACU(`${path}.kind 只能为 host 或 logical`);
  const host = {
    chatIdentity: nonEmptyString_ACU(value.chatIdentity, `${path}.chatIdentity`, 4096),
    messageKey: nonEmptyString_ACU(value.messageKey, `${path}.messageKey`),
    swipeId: nonEmptyString_ACU(value.swipeId, `${path}.swipeId`),
    contentDigest: hash_ACU(value.contentDigest, `${path}.contentDigest`),
  };
  return value.kind === 'host' ? { kind: 'host', ...host } : host;
}

function sameAnchor_ACU(left: WorldSimulationCompletedAnchor_ACU, right: WorldSimulationCompletedAnchor_ACU): boolean {
  if (left.kind === 'logical' || right.kind === 'logical') {
    return left.kind === 'logical' && right.kind === 'logical'
      && left.chatIdentity === right.chatIdentity && left.contentDigest === right.contentDigest
      && left.logicalRef.sessionId === right.logicalRef.sessionId && left.logicalRef.branchId === right.logicalRef.branchId
      && left.logicalRef.turnId === right.logicalRef.turnId && left.logicalRef.attemptId === right.logicalRef.attemptId
      && left.logicalRef.floorId === right.logicalRef.floorId;
  }
  return left.chatIdentity === right.chatIdentity && left.messageKey === right.messageKey
    && left.swipeId === right.swipeId && left.contentDigest === right.contentDigest;
}

function validateFactIds_ACU(value: unknown, path: string, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && !value.length) || value.length > MAX_FACT_IDS_ACU) {
    fail_ACU(`${path} 必须为${allowEmpty ? '至多' : '1 至'} ${MAX_FACT_IDS_ACU} 项的数组`);
  }
  const ids = value.map((item, index) => nonEmptyString_ACU(item, `${path}[${index}]`));
  if (new Set(ids).size !== ids.length) fail_ACU(`${path} 不能重复`);
  return ids;
}

function validateStatus_ACU(value: unknown, path: string): WorldDeliveryStatus_ACU {
  if (!['intent', 'attempted', 'response-durable', 'reviewed', 'unknown'].includes(String(value))) fail_ACU(`${path} 非法`);
  return value as WorldDeliveryStatus_ACU;
}

function validateAttempt_ACU(value: unknown, path: string): WorldDeliveryAttempt_ACU {
  if (!isRecord_ACU(value)) fail_ACU(`${path} 必须是对象`);
  exactKeys_ACU(value, ['deliveryId', 'target', 'source', 'ledgerRevision', 'ledgerFingerprint', 'factIds', 'requestFingerprint', 'createdAt', 'status', 'successor', 'adoptedFactIds', 'reviewSource'], path);
  const status = validateStatus_ACU(value.status, `${path}.status`);
  if (value.target !== 'body' && value.target !== 'plot') fail_ACU(`${path}.target 必须为 body 或 plot`);
  const source = validateAnchor_ACU(value.source, `${path}.source`);
  const successor = value.successor === null ? null : validateAnchor_ACU(value.successor, `${path}.successor`);
  const factIds = validateFactIds_ACU(value.factIds, `${path}.factIds`);
  const adoptedFactIds = value.adoptedFactIds === null ? null : validateFactIds_ACU(value.adoptedFactIds, `${path}.adoptedFactIds`, true);
  if (adoptedFactIds && adoptedFactIds.some(id => !factIds.includes(id))) fail_ACU(`${path}.adoptedFactIds 必须是 factIds 的子集`);
  if (value.reviewSource !== null && value.reviewSource !== 'narrative-review') fail_ACU(`${path}.reviewSource 非法`);
  if (successor !== null) {
    if (successor.chatIdentity !== source.chatIdentity) fail_ACU(`${path}.successor 必须属于同一聊天`);
    if (sameAnchor_ACU(source, successor)) fail_ACU(`${path}.successor 不能等于 source`);
  }
  if (status === 'intent' || status === 'attempted' || status === 'unknown') {
    if (successor !== null || adoptedFactIds !== null || value.reviewSource !== null) fail_ACU(`${path}.${status} 不得携带后继或审查结果`);
  }
  if (status === 'response-durable' && (successor === null || adoptedFactIds !== null || value.reviewSource !== null)) {
    fail_ACU(`${path}.response-durable 必须有 successor 且不得携带审查结果`);
  }
  if (status === 'reviewed' && (successor === null || adoptedFactIds === null || value.reviewSource !== 'narrative-review')) {
    fail_ACU(`${path}.reviewed 必须有 successor、采用结果和 narrative-review`);
  }
  return {
    deliveryId: nonEmptyString_ACU(value.deliveryId, `${path}.deliveryId`),
    target: value.target,
    source,
    ledgerRevision: safeInteger_ACU(value.ledgerRevision, `${path}.ledgerRevision`),
    ledgerFingerprint: hash_ACU(value.ledgerFingerprint, `${path}.ledgerFingerprint`),
    factIds,
    requestFingerprint: hash_ACU(value.requestFingerprint, `${path}.requestFingerprint`),
    createdAt: safeInteger_ACU(value.createdAt, `${path}.createdAt`),
    status,
    successor,
    adoptedFactIds,
    reviewSource: value.reviewSource as 'narrative-review' | null,
  };
}

function validateIntent_ACU(value: unknown): IntentInput_ACU {
  if (!isRecord_ACU(value)) fail_ACU('intent 必须是对象');
  exactKeys_ACU(value, ['deliveryId', 'target', 'source', 'ledgerRevision', 'ledgerFingerprint', 'factIds', 'requestFingerprint', 'createdAt'], 'intent');
  const attempt = validateAttempt_ACU({ ...value, status: 'intent', successor: null, adoptedFactIds: null, reviewSource: null }, 'intent');
  const { status: _status, successor: _successor, adoptedFactIds: _adoptedFactIds, reviewSource: _reviewSource, ...intent } = attempt;
  return intent;
}

function sameIntent_ACU(left: WorldDeliveryAttempt_ACU, right: IntentInput_ACU): boolean {
  return left.deliveryId === right.deliveryId && left.target === right.target && sameAnchor_ACU(left.source, right.source)
    && left.ledgerRevision === right.ledgerRevision && left.ledgerFingerprint === right.ledgerFingerprint
    && left.requestFingerprint === right.requestFingerprint && left.createdAt === right.createdAt
    && left.factIds.length === right.factIds.length && left.factIds.every((id, index) => id === right.factIds[index]);
}

function requestTuple_ACU(value: Pick<WorldDeliveryAttempt_ACU, 'target' | 'source' | 'requestFingerprint'>): string {
  return JSON.stringify([value.target, value.source, value.requestFingerprint]);
}

function nextRevision_ACU(revision: number): number {
  if (revision >= Number.MAX_SAFE_INTEGER) fail_ACU('revision 已达安全整数上限');
  return revision + 1;
}

function replaceRecord_ACU(lifecycle: WorldDeliveryLifecycle_ACU, index: number, record: WorldDeliveryAttempt_ACU): WorldDeliveryLifecycle_ACU {
  return { schemaVersion: 1, revision: nextRevision_ACU(lifecycle.revision), records: lifecycle.records.map((item, itemIndex) => itemIndex === index ? record : item) };
}

export function buildEmptyWorldDeliveryLifecycle_ACU(): WorldDeliveryLifecycle_ACU {
  return { schemaVersion: 1, revision: 0, records: [] };
}

export function validateWorldDeliveryLifecycle_ACU(raw: unknown): WorldDeliveryLifecycle_ACU {
  if (!isRecord_ACU(raw)) fail_ACU('lifecycle 必须是对象');
  exactKeys_ACU(raw, ['schemaVersion', 'revision', 'records'], 'lifecycle');
  if (raw.schemaVersion !== 1) fail_ACU('lifecycle.schemaVersion 必须为 1');
  const recordsRaw = raw.records;
  if (!Array.isArray(recordsRaw) || recordsRaw.length > MAX_RECORDS_ACU) fail_ACU(`lifecycle.records 必须为至多 ${MAX_RECORDS_ACU} 项的数组`);
  const records = recordsRaw.map((value, index) => validateAttempt_ACU(value, `lifecycle.records[${index}]`));
  if (new Set(records.map(item => item.deliveryId)).size !== records.length) fail_ACU('deliveryId 不能重复');
  if (new Set(records.map(requestTuple_ACU)).size !== records.length) fail_ACU('target、source 与 requestFingerprint 不能重复');
  return { schemaVersion: 1, revision: safeInteger_ACU(raw.revision, 'lifecycle.revision'), records };
}

export function createWorldDeliveryIntent_ACU(lifecycle: WorldDeliveryLifecycle_ACU, input: IntentInput_ACU): WorldDeliveryLifecycle_ACU {
  const current = validateWorldDeliveryLifecycle_ACU(lifecycle);
  const intent = validateIntent_ACU(input);
  const existing = current.records.find(item => item.deliveryId === intent.deliveryId);
  if (existing) {
    if (!sameIntent_ACU(existing, intent)) fail_ACU('同一 deliveryId 的 intent 不可变更');
    return current;
  }
  if (current.records.length >= MAX_RECORDS_ACU) fail_ACU(`records 已达到 ${MAX_RECORDS_ACU} 项上限`);
  if (current.records.some(item => requestTuple_ACU(item) === requestTuple_ACU(intent))) fail_ACU('同一 target/source/requestFingerprint 不可重复 intent');
  const adopted = new Set(current.records.flatMap(record => record.adoptedFactIds ?? []));
  for (const factId of intent.factIds) {
    if (adopted.has(factId)) fail_ACU('已采用 fact 不可再次投送');
    if (current.records.some(record => record.factIds.includes(factId) && record.status !== 'reviewed')) {
      fail_ACU('同一 fact 尚有未审查或未知投送，不能重投');
    }
    if (current.records.filter(record => record.factIds.includes(factId)).length >= 2) fail_ACU('单个 fact 跨来源累计最多投送两次');
  }
  return { schemaVersion: 1, revision: nextRevision_ACU(current.revision), records: [...current.records, { ...intent, status: 'intent', successor: null, adoptedFactIds: null, reviewSource: null }] };
}

export function markWorldDeliveryAttempted_ACU(lifecycle: WorldDeliveryLifecycle_ACU, deliveryId: string): WorldDeliveryLifecycle_ACU {
  const current = validateWorldDeliveryLifecycle_ACU(lifecycle);
  const id = nonEmptyString_ACU(deliveryId, 'deliveryId');
  const index = current.records.findIndex(item => item.deliveryId === id);
  if (index < 0) fail_ACU('只能标记既有 deliveryId');
  const record = current.records[index];
  if (record.status === 'attempted') return current;
  if (record.status !== 'intent') fail_ACU(`${record.status} 不能转为 attempted`);
  return replaceRecord_ACU(current, index, { ...record, status: 'attempted' });
}

export function recordWorldDeliveryDurableSuccessor_ACU(
  lifecycle: WorldDeliveryLifecycle_ACU,
  deliveryId: string,
  successor: WorldSimulationCompletedAnchor_ACU,
): WorldDeliveryLifecycle_ACU {
  const current = validateWorldDeliveryLifecycle_ACU(lifecycle);
  const id = nonEmptyString_ACU(deliveryId, 'deliveryId');
  const index = current.records.findIndex(item => item.deliveryId === id);
  if (index < 0) fail_ACU('只能记录既有 deliveryId 的后继');
  const record = current.records[index];
  const actual = validateAnchor_ACU(successor, 'successor');
  if (sameAnchor_ACU(record.source, actual)) fail_ACU('successor 不能等于 source');
  if (record.status === 'response-durable' || record.status === 'reviewed') {
    if (!record.successor || !sameAnchor_ACU(record.successor, actual)) fail_ACU('既有 successor 不可替换');
    return current;
  }
  if (record.status !== 'attempted') fail_ACU(`${record.status} 不能记录 durable successor`);
  return replaceRecord_ACU(current, index, { ...record, status: 'response-durable', successor: actual });
}

function validateReceipt_ACU(value: unknown): WorldDeliveryAdoptionReceipt_ACU {
  if (!isRecord_ACU(value)) fail_ACU('adoption receipt 必须是对象');
  exactKeys_ACU(value, ['schemaVersion', 'deliveryId', 'ledgerRevision', 'ledgerFingerprint', 'source', 'successor', 'requestFingerprint', 'reviewSource', 'results'], 'adoption receipt');
  if (value.schemaVersion !== 1 || value.reviewSource !== 'narrative-review') fail_ACU('adoption receipt schemaVersion 或 reviewSource 非法');
  if (!Array.isArray(value.results) || !value.results.length || value.results.length > MAX_FACT_IDS_ACU) fail_ACU('adoption receipt.results 必须为非空有限数组');
  const results = value.results.map((raw, index) => {
    if (!isRecord_ACU(raw)) fail_ACU(`adoption receipt.results[${index}] 必须是对象`);
    exactKeys_ACU(raw, ['factId', 'adopted', 'evidenceQuotes'], `adoption receipt.results[${index}]`);
    if (typeof raw.adopted !== 'boolean' || !Array.isArray(raw.evidenceQuotes) || raw.evidenceQuotes.some(quote => typeof quote !== 'string' || !quote.trim() || quote.length > MAX_QUOTE_LENGTH_ACU)) {
      fail_ACU(`adoption receipt.results[${index}] 非法`);
    }
    if (raw.adopted && !raw.evidenceQuotes.length) fail_ACU(`adoption receipt.results[${index}] 正例必须有精确引文`);
    return { factId: nonEmptyString_ACU(raw.factId, `adoption receipt.results[${index}].factId`), adopted: raw.adopted, evidenceQuotes: [...raw.evidenceQuotes] as string[] };
  });
  if (new Set(results.map(item => item.factId)).size !== results.length) fail_ACU('adoption receipt.results.factId 不能重复');
  return {
    schemaVersion: 1,
    deliveryId: nonEmptyString_ACU(value.deliveryId, 'adoption receipt.deliveryId'),
    ledgerRevision: safeInteger_ACU(value.ledgerRevision, 'adoption receipt.ledgerRevision'),
    ledgerFingerprint: hash_ACU(value.ledgerFingerprint, 'adoption receipt.ledgerFingerprint'),
    source: validateAnchor_ACU(value.source, 'adoption receipt.source'),
    successor: validateAnchor_ACU(value.successor, 'adoption receipt.successor'),
    requestFingerprint: hash_ACU(value.requestFingerprint, 'adoption receipt.requestFingerprint'),
    reviewSource: 'narrative-review',
    results,
  };
}

export function applyWorldDeliveryAdoption_ACU(lifecycle: WorldDeliveryLifecycle_ACU, rawReceipt: WorldDeliveryAdoptionReceipt_ACU): WorldDeliveryLifecycle_ACU {
  const current = validateWorldDeliveryLifecycle_ACU(lifecycle);
  const receipt = validateReceipt_ACU(rawReceipt);
  const index = current.records.findIndex(item => item.deliveryId === receipt.deliveryId);
  if (index < 0) fail_ACU('receipt 只能对应既有 deliveryId');
  const record = current.records[index];
  if (record.status !== 'response-durable' && record.status !== 'reviewed') fail_ACU(`${record.status} 尚无可审查的 durable response`);
  if (!record.successor || record.ledgerRevision !== receipt.ledgerRevision || record.ledgerFingerprint !== receipt.ledgerFingerprint
    || record.requestFingerprint !== receipt.requestFingerprint || !sameAnchor_ACU(record.source, receipt.source)
    || !sameAnchor_ACU(record.successor, receipt.successor)) fail_ACU('receipt 未绑定到 delivery 的 ledger/source/successor/request');
  if (receipt.results.length !== record.factIds.length || receipt.results.some(item => !record.factIds.includes(item.factId))) fail_ACU('receipt 必须精确覆盖 delivery 的全部 factIds');
  const adoptedFactIds = receipt.results.filter(item => item.adopted).map(item => item.factId);
  if (record.status === 'reviewed') {
    if (record.adoptedFactIds && record.adoptedFactIds.length === adoptedFactIds.length && record.adoptedFactIds.every((id, itemIndex) => id === adoptedFactIds[itemIndex])) return current;
    fail_ACU('已审查 delivery 不可替换 receipt');
  }
  return replaceRecord_ACU(current, index, { ...record, status: 'reviewed', adoptedFactIds, reviewSource: 'narrative-review' });
}

export function markWorldDeliveryUnknown_ACU(lifecycle: WorldDeliveryLifecycle_ACU, deliveryId: string): WorldDeliveryLifecycle_ACU {
  const current = validateWorldDeliveryLifecycle_ACU(lifecycle);
  const id = nonEmptyString_ACU(deliveryId, 'deliveryId');
  const index = current.records.findIndex(item => item.deliveryId === id);
  if (index < 0) fail_ACU('只能标记既有 deliveryId');
  const record = current.records[index];
  if (record.status === 'unknown') return current;
  if (record.status === 'reviewed' || record.status === 'response-durable') fail_ACU(`${record.status} 不可降级为 unknown`);
  return replaceRecord_ACU(current, index, { ...record, status: 'unknown' });
}

function isRedeliveryEligible_ACU(fact: WorldFact_ACU | undefined, scene: WorldLocationRef_ACU, clock: WorldTime_ACU, superseded: ReadonlySet<string>): boolean {
  return !!fact && fact.projectionPolicy !== 'internal' && fact.revealState === 'unlocked' && !superseded.has(fact.id)
    && !!fact.locationRef && fact.locationRef.region === scene.region && fact.locationRef.place === scene.place
    && isWorldFactEstablishedAt_ACU(fact, clock) && (fact.temporalKind !== 'occurrence' || !!fact.happenedAt && fact.happenedAt.day === clock.day
      && (fact.happenedAt.slot === '' || fact.happenedAt.slot === clock.slot));
}

/** 只返回真实 narrative-review 未采用、仍属于当前 scene + unlocked 的事实；unknown 永不自动重投。 */
export function queryWorldDeliveryRedeliveryCandidates_ACU(
  lifecycle: WorldDeliveryLifecycle_ACU,
  ledger: WorldSimulationLedger_ACU,
  scene: WorldLocationRef_ACU,
  clock: WorldTime_ACU,
): WorldDeliveryRedeliveryCandidate_ACU[] {
  const current = validateWorldDeliveryLifecycle_ACU(lifecycle);
  // 候选查询同样只能建立在完整权威账本之上，损坏状态不能伪装为无候选。
  const validatedLedger = validateWorldSimulationLedger_ACU(ledger, 'agent_persist');
  const facts = new Map(validatedLedger.facts.map(fact => [fact.id, fact]));
  const superseded = new Set(validatedLedger.facts.filter(fact => isWorldFactEstablishedAt_ACU(fact, clock))
    .flatMap(fact => fact.supersedesFactIds));
  const adopted = new Set(current.records.flatMap(record => record.adoptedFactIds ?? []));
  const blocked = new Set(current.records.filter(record => ['intent', 'attempted', 'unknown'].includes(record.status)).flatMap(record => record.factIds));
  const selected = new Set<string>();
  return [...current.records].reverse().flatMap(record => {
    if (record.status !== 'reviewed' || record.reviewSource !== 'narrative-review' || !record.adoptedFactIds) return [];
    const factIds = record.factIds.filter(id => !selected.has(id) && !adopted.has(id) && !blocked.has(id)
      && isRedeliveryEligible_ACU(facts.get(id), scene, clock, superseded)
      && current.records.filter(candidate => candidate.factIds.includes(id)).length < 2);
    factIds.forEach(id => selected.add(id));
    return factIds.length ? [{ record: clone_ACU(record), factIds }] : [];
  });
}
