export type WorldDispatchSource_ACU = {
  chatIdentity: string;
  messageKey: string;
  swipeId: string;
  contentDigest: string;
};

export type WorldDispatchRecord_ACU = {
  deliveryId: string;
  source: WorldDispatchSource_ACU;
  ledgerRevision: number;
  ledgerFingerprint: string;
  factIds: string[];
  requestFingerprint: string;
  createdAt: number;
  successor: null | {
    anchor: WorldDispatchSource_ACU;
    observedAt: number;
  };
};

export type WorldDispatchJournal_ACU = {
  schemaVersion: 1;
  revision: number;
  records: WorldDispatchRecord_ACU[];
};

const MAX_RECORDS_ACU = 256;
const MAX_FACT_IDS_ACU = 256;
const MAX_ID_LENGTH_ACU = 160;
const MAX_SOURCE_PART_LENGTH_ACU = 160;
const SHA256_HEX_ACU = /^[a-f0-9]{64}$/;

type UnknownRecord_ACU = Record<string, unknown>;

function reject_ACU(message: string): never {
  throw new Error(`WORLD_DISPATCH_JOURNAL_INVALID: ${message}`);
}

function isRecord_ACU(raw: unknown): raw is UnknownRecord_ACU {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

function exactKeys_ACU(raw: UnknownRecord_ACU, keys: readonly string[], path: string): void {
  const actual = Object.getOwnPropertyNames(raw);
  if (actual.length !== keys.length || Object.getOwnPropertySymbols(raw).length > 0
    || actual.some(key => !keys.includes(key)) || keys.some(key => !Object.prototype.hasOwnProperty.call(raw, key))) {
    reject_ACU(`${path} 的字段必须严格为 ${keys.join(', ')}`);
  }
}

function nonEmptyString_ACU(raw: unknown, path: string, maximum = MAX_ID_LENGTH_ACU): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > maximum) reject_ACU(`${path} 必须是非空且不超过 ${maximum} 字符的字符串`);
  return raw;
}

function sha256_ACU(raw: unknown, path: string): string {
  if (typeof raw !== 'string' || !SHA256_HEX_ACU.test(raw)) reject_ACU(`${path} 必须是 64 位小写 SHA-256 十六进制摘要`);
  return raw;
}

function safeNonNegativeInteger_ACU(raw: unknown, path: string): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0) reject_ACU(`${path} 必须是非负安全整数`);
  return raw;
}

function validateSource_ACU(raw: unknown, path: string): WorldDispatchSource_ACU {
  if (!isRecord_ACU(raw)) reject_ACU(`${path} 必须是对象`);
  exactKeys_ACU(raw, ['chatIdentity', 'messageKey', 'swipeId', 'contentDigest'], path);
  return {
    chatIdentity: nonEmptyString_ACU(raw.chatIdentity, `${path}.chatIdentity`, MAX_SOURCE_PART_LENGTH_ACU),
    messageKey: nonEmptyString_ACU(raw.messageKey, `${path}.messageKey`, MAX_SOURCE_PART_LENGTH_ACU),
    swipeId: nonEmptyString_ACU(raw.swipeId, `${path}.swipeId`, MAX_SOURCE_PART_LENGTH_ACU),
    contentDigest: sha256_ACU(raw.contentDigest, `${path}.contentDigest`),
  };
}

function sameSource_ACU(left: WorldDispatchSource_ACU, right: WorldDispatchSource_ACU): boolean {
  return left.chatIdentity === right.chatIdentity
    && left.messageKey === right.messageKey
    && left.swipeId === right.swipeId
    && left.contentDigest === right.contentDigest;
}

function validateSuccessor_ACU(raw: unknown, source: WorldDispatchSource_ACU, createdAt: number, path: string): WorldDispatchRecord_ACU['successor'] {
  if (raw === null) return null;
  if (!isRecord_ACU(raw)) reject_ACU(`${path} 必须是 null 或对象`);
  exactKeys_ACU(raw, ['anchor', 'observedAt'], path);
  const anchor = validateSource_ACU(raw.anchor, `${path}.anchor`);
  const observedAt = safeNonNegativeInteger_ACU(raw.observedAt, `${path}.observedAt`);
  if (anchor.chatIdentity !== source.chatIdentity) reject_ACU(`${path}.anchor 必须属于同一聊天`);
  if (anchor.messageKey === source.messageKey && anchor.swipeId === source.swipeId) {
    reject_ACU(`${path}.anchor 不能是仅摘要不同的原消息`);
  }
  if (observedAt < createdAt) reject_ACU(`${path}.observedAt 不能早于 createdAt`);
  return { anchor, observedAt };
}

function validateRecord_ACU(raw: unknown, path: string): WorldDispatchRecord_ACU {
  if (!isRecord_ACU(raw)) reject_ACU(`${path} 必须是对象`);
  exactKeys_ACU(raw, ['deliveryId', 'source', 'ledgerRevision', 'ledgerFingerprint', 'factIds', 'requestFingerprint', 'createdAt', 'successor'], path);
  const factIdsRaw = raw.factIds;
  if (!Array.isArray(factIdsRaw) || !factIdsRaw.length || factIdsRaw.length > MAX_FACT_IDS_ACU) reject_ACU(`${path}.factIds 必须是 1 至 ${MAX_FACT_IDS_ACU} 项的数组`);
  const factIds = factIdsRaw.map((factId, index) => nonEmptyString_ACU(factId, `${path}.factIds[${index}]`));
  if (new Set(factIds).size !== factIds.length) reject_ACU(`${path}.factIds 不能重复`);
  const source = validateSource_ACU(raw.source, `${path}.source`);
  const createdAt = safeNonNegativeInteger_ACU(raw.createdAt, `${path}.createdAt`);
  return {
    deliveryId: nonEmptyString_ACU(raw.deliveryId, `${path}.deliveryId`),
    source,
    ledgerRevision: safeNonNegativeInteger_ACU(raw.ledgerRevision, `${path}.ledgerRevision`),
    ledgerFingerprint: sha256_ACU(raw.ledgerFingerprint, `${path}.ledgerFingerprint`),
    factIds,
    requestFingerprint: sha256_ACU(raw.requestFingerprint, `${path}.requestFingerprint`),
    createdAt,
    successor: validateSuccessor_ACU(raw.successor, source, createdAt, `${path}.successor`),
  };
}

function requestTuple_ACU(record: WorldDispatchRecord_ACU): string {
  return JSON.stringify([record.source.chatIdentity, record.source.messageKey, record.source.swipeId, record.source.contentDigest, record.requestFingerprint]);
}

function validateIntent_ACU(raw: unknown): WorldDispatchRecord_ACU {
  if (!isRecord_ACU(raw)) reject_ACU('intent 必须是对象');
  exactKeys_ACU(raw, ['deliveryId', 'source', 'ledgerRevision', 'ledgerFingerprint', 'factIds', 'requestFingerprint', 'createdAt'], 'intent');
  return validateRecord_ACU({ ...raw, successor: null }, 'intent');
}

function sameIntent_ACU(left: WorldDispatchRecord_ACU, right: WorldDispatchRecord_ACU): boolean {
  return left.deliveryId === right.deliveryId
    && sameSource_ACU(left.source, right.source)
    && left.ledgerRevision === right.ledgerRevision
    && left.ledgerFingerprint === right.ledgerFingerprint
    && left.requestFingerprint === right.requestFingerprint
    && left.createdAt === right.createdAt
    && left.factIds.length === right.factIds.length
    && left.factIds.every((factId, index) => factId === right.factIds[index]);
}

function nextRevision_ACU(revision: number): number {
  if (revision >= Number.MAX_SAFE_INTEGER) reject_ACU('revision 已达到安全整数上限');
  return revision + 1;
}

export function buildEmptyWorldDispatchJournal_ACU(): WorldDispatchJournal_ACU {
  return { schemaVersion: 1, revision: 0, records: [] };
}

/** 仅验证和深克隆持久化记录，避免损坏状态进入后续写入。 */
export function validateWorldDispatchJournal_ACU(raw: unknown): WorldDispatchJournal_ACU {
  if (!isRecord_ACU(raw)) reject_ACU('journal 必须是对象');
  exactKeys_ACU(raw, ['schemaVersion', 'revision', 'records'], 'journal');
  if (raw.schemaVersion !== 1) reject_ACU('journal.schemaVersion 必须为 1');
  const revision = safeNonNegativeInteger_ACU(raw.revision, 'journal.revision');
  if (!Array.isArray(raw.records) || raw.records.length > MAX_RECORDS_ACU) reject_ACU(`journal.records 必须是至多 ${MAX_RECORDS_ACU} 项的数组`);
  const records = raw.records.map((record, index) => validateRecord_ACU(record, `journal.records[${index}]`));
  const deliveryIds = new Set(records.map(record => record.deliveryId));
  if (deliveryIds.size !== records.length) reject_ACU('journal.records.deliveryId 不能重复');
  const requestTuples = new Set(records.map(requestTuple_ACU));
  if (requestTuples.size !== records.length) reject_ACU('journal.records 不同 deliveryId 不能重复来源与 requestFingerprint');
  return { schemaVersion: 1, revision, records };
}

/** 仅记录本地投送意图，不推断 provider 接收或正文采用。 */
export function recordWorldDispatchIntent_ACU(
  journal: WorldDispatchJournal_ACU,
  input: Omit<WorldDispatchRecord_ACU, 'successor'>,
): WorldDispatchJournal_ACU {
  const current = validateWorldDispatchJournal_ACU(journal);
  const intent = validateIntent_ACU(input);
  const sameDelivery = current.records.find(record => record.deliveryId === intent.deliveryId);
  if (sameDelivery) {
    if (!sameIntent_ACU(sameDelivery, intent)) reject_ACU('同一 deliveryId 的投送意图不能变更');
    return current;
  }
  if (current.records.length >= MAX_RECORDS_ACU) reject_ACU(`journal.records 已达到 ${MAX_RECORDS_ACU} 项上限`);
  if (current.records.some(record => requestTuple_ACU(record) === requestTuple_ACU(intent))) {
    reject_ACU('同一来源与 requestFingerprint 不能使用不同 deliveryId 重复记录');
  }
  return { schemaVersion: 1, revision: nextRevision_ACU(current.revision), records: [...current.records, intent] };
}

/** 仅记录显式观察到的后继锚点，不证明正文采用。 */
export function observeWorldDispatchSuccessor_ACU(
  journal: WorldDispatchJournal_ACU,
  deliveryId: string,
  anchor: WorldDispatchSource_ACU,
  observedAt: number,
): WorldDispatchJournal_ACU {
  const current = validateWorldDispatchJournal_ACU(journal);
  const validDeliveryId = nonEmptyString_ACU(deliveryId, 'deliveryId');
  const recordIndex = current.records.findIndex(record => record.deliveryId === validDeliveryId);
  if (recordIndex < 0) reject_ACU('只能观察已存在的 deliveryId');
  const record = current.records[recordIndex];
  const successor = validateSuccessor_ACU({ anchor, observedAt }, record.source, record.createdAt, 'successor');
  if (record.successor) {
    if (!sameSource_ACU(record.successor.anchor, successor!.anchor)) reject_ACU('同一 deliveryId 不能替换已观察到的后继锚点');
    return current;
  }
  const records = current.records.map((item, index) => index === recordIndex ? { ...item, successor } : item);
  return { schemaVersion: 1, revision: nextRevision_ACU(current.revision), records };
}
