import {
  HostChatSaveNotStartedError_ACU,
  getChatArray_ACU,
  readChatFromHostStrict_ACU,
  saveChatToHostStrict_ACU,
} from '../../data/gateways/chat-gateway';
import { sha256HexSync_ACU } from '../../shared/sha256-sync';
import { assertWorldDispatchAuthorizationCurrent_ACU, claimWorldDispatchAuthorization_ACU,
  type WorldDispatchAuthorization_ACU } from './world-dispatch-authorization';
import { assertWorldDispatchHostClaim_ACU } from './world-dispatch-host-authorization';
import { isAiMessage_ACU } from '../runtime/message-handler';
import { readWorldSimulationLedgerAtAnchor_ACU } from './agent/agent-module-store';
import {
  claimWorldDeliveryAdoption_ACU,
  readWorldDeliveryAdoption_ACU,
  type WorldDeliveryAdoptionClaimInput_ACU,
} from './agent/world-delivery-adoption';
import type { WorldSimulationAnchorIdentity_ACU } from './agent/agent-model';
import type { WorldSimulationCompletedAnchor_ACU } from './model';
import { requireWorldSimulationHostAnchor_ACU } from './simulation-identity';
import { resolveCurrentWorldSimulationAnchor_ACU } from './simulation-store';
import {
  applyWorldDeliveryAdoption_ACU,
  buildEmptyWorldDeliveryLifecycle_ACU,
  createWorldDeliveryIntent_ACU,
  markWorldDeliveryAttempted_ACU,
  markWorldDeliveryUnknown_ACU,
  recordWorldDeliveryDurableSuccessor_ACU,
  validateWorldDeliveryLifecycle_ACU,
  type WorldDeliveryAdoptionReceipt_ACU,
  type WorldDeliveryLifecycle_ACU,
  type WorldDeliveryAttempt_ACU,
} from './world-delivery-lifecycle';

export const WORLD_DELIVERY_LIFECYCLE_FIELD_ACU = '_qrf_world_projection_delivery_v1';

type Source_ACU = Extract<WorldSimulationCompletedAnchor_ACU, { kind?: 'host' }>;
type BucketEntry_ACU = { anchor: Source_ACU; value: WorldDeliveryLifecycle_ACU; updatedAt: number };
type Bucket_ACU = { schemaVersion: 1; entries: Record<string, BucketEntry_ACU> };
type Lease_ACU = { chat: any[]; message: Record<string, unknown>; source: Source_ACU };
type Pending_ACU = { baseline: unknown; candidate: Bucket_ACU; expectedSuccessor?: Source_ACU };
type IntentInput_ACU = Omit<WorldDeliveryAttempt_ACU, 'status' | 'successor' | 'adoptedFactIds' | 'reviewSource'>;

const HASH_ACU = /^[a-f0-9]{64}$/;

function canonical_ACU(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical_ACU).join(',')}]`;
  if (isRecord_ACU(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical_ACU(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function clone_ACU<T>(value: T): T { return structuredClone(value); }
function equal_ACU(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function isRecord_ACU(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function fail_ACU(message: string): never { throw new Error(`WORLD_DELIVERY_HOST_INVALID: ${message}`); }
function unknown_ACU(message: string, cause: unknown): never {
  const error = new Error(`WORLD_DELIVERY_PERSIST_UNKNOWN: ${message}`) as Error & { code?: string; details?: { message: string } };
  error.code = 'WORLD_DELIVERY_PERSIST_UNKNOWN'; error.details = { message: cause instanceof Error ? cause.message : String(cause) };
  throw error;
}
function exactKeys_ACU(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const actual = Object.keys(value);
  if (Object.getOwnPropertySymbols(value).length || actual.length !== keys.length || actual.some(key => !keys.includes(key)) || keys.some(key => !(key in value))) fail_ACU(`${path} 字段不完整或含未知字段`);
}
function toSource_ACU(anchor: WorldSimulationAnchorIdentity_ACU): Source_ACU {
  return { chatIdentity: anchor.chatIdentity, messageKey: anchor.messageKey, swipeId: anchor.swipeId, contentDigest: anchor.contentDigest };
}
function sameSource_ACU(left: Source_ACU, right: Source_ACU): boolean {
  return left.chatIdentity === right.chatIdentity && left.messageKey === right.messageKey && left.swipeId === right.swipeId && left.contentDigest === right.contentDigest;
}
function key_ACU(source: Source_ACU): string { return sha256HexSync_ACU(JSON.stringify([source.chatIdentity, source.messageKey, source.swipeId])); }
function scope_ACU(source: Source_ACU): string { return JSON.stringify([source.chatIdentity, source.messageKey, source.swipeId, source.contentDigest]); }
function messageText_ACU(message: Record<string, unknown>): string { return typeof message.mes === 'string' ? message.mes : typeof message.message === 'string' ? message.message : ''; }
function sourceAt_ACU(chat: any[], index: number, chatIdentity: string): Source_ACU {
  const message = chat[index];
  if (!isRecord_ACU(message) || !isAiMessage_ACU(message)) fail_ACU('目标不是 assistant 楼层');
  const raw = message.message_id; const id = typeof raw === 'string' || typeof raw === 'number' ? raw : index;
  return { chatIdentity, messageKey: `${typeof id}:${String(id)}`, swipeId: typeof message.swipe_id === 'number' && Number.isInteger(message.swipe_id) && message.swipe_id >= 0 ? String(message.swipe_id) : '0', contentDigest: sha256HexSync_ACU(messageText_ACU(message)) };
}
function findRemoteSource_ACU(chat: any[], source: Source_ACU): Record<string, unknown> {
  const matches: Record<string, unknown>[] = [];
  for (let index = 0; index < chat.length; index += 1) try {
    if (sameSource_ACU(sourceAt_ACU(chat, index, source.chatIdentity), source) && isRecord_ACU(chat[index])) matches.push(chat[index]);
  } catch { /* 非 assistant 楼层不可恢复 */ }
  if (matches.length !== 1) throw new Error('WORLD_DELIVERY_RECOVERY_UNRESOLVED: 服务器 source 缺失或不唯一');
  return matches[0];
}
function validateSource_ACU(raw: unknown, path: string): Source_ACU {
  if (!isRecord_ACU(raw)) fail_ACU(`${path} 必须是对象`);
  const keys = raw.kind === undefined ? ['chatIdentity', 'messageKey', 'swipeId', 'contentDigest'] : ['kind', 'chatIdentity', 'messageKey', 'swipeId', 'contentDigest'];
  exactKeys_ACU(raw, keys, path);
  if (raw.kind !== undefined && raw.kind !== 'host') fail_ACU(`${path} 不可为 logical`);
  for (const key of ['chatIdentity', 'messageKey', 'swipeId'] as const) if (typeof raw[key] !== 'string' || !raw[key].trim()) fail_ACU(`${path}.${key} 非法`);
  if (typeof raw.contentDigest !== 'string' || !HASH_ACU.test(raw.contentDigest)) fail_ACU(`${path}.contentDigest 非法`);
  const chatIdentity = raw.chatIdentity as string;
  const messageKey = raw.messageKey as string;
  const swipeId = raw.swipeId as string;
  const contentDigest = raw.contentDigest as string;
  return raw.kind === 'host' ? { kind: 'host', chatIdentity, messageKey, swipeId, contentDigest } : { chatIdentity, messageKey, swipeId, contentDigest };
}
function validateBucket_ACU(raw: unknown, current: Source_ACU): { bucket: Bucket_ACU; lifecycle: WorldDeliveryLifecycle_ACU | null } {
  if (raw === undefined) return { bucket: { schemaVersion: 1, entries: {} }, lifecycle: null };
  if (!isRecord_ACU(raw)) fail_ACU('delivery 分桶必须是对象'); exactKeys_ACU(raw, ['schemaVersion', 'entries'], 'delivery 分桶');
  if (raw.schemaVersion !== 1 || !isRecord_ACU(raw.entries)) fail_ACU('delivery 分桶版本或 entries 非法');
  const entries: Record<string, BucketEntry_ACU> = {};
  for (const [entryKey, entry] of Object.entries(raw.entries)) {
    if (!HASH_ACU.test(entryKey) || !isRecord_ACU(entry)) fail_ACU('delivery 分桶条目非法');
    exactKeys_ACU(entry, ['anchor', 'value', 'updatedAt'], `delivery 分桶 ${entryKey}`);
    const anchor = validateSource_ACU(entry.anchor, `delivery 分桶 ${entryKey}.anchor`);
    if (key_ACU(anchor) !== entryKey || typeof entry.updatedAt !== 'number' || !Number.isSafeInteger(entry.updatedAt) || entry.updatedAt < 0) fail_ACU('delivery 分桶锚点或更新时间非法');
    const value = validateWorldDeliveryLifecycle_ACU(entry.value);
    if (value.records.some(record => record.source.kind === 'logical' || !sameSource_ACU(record.source, anchor))) fail_ACU('普通 host store 只容纳同一 host source');
    entries[entryKey] = { anchor, value, updatedAt: entry.updatedAt };
  }
  const found = entries[key_ACU(current)];
  if (!found) return { bucket: clone_ACU({ schemaVersion: 1, entries }), lifecycle: null };
  if (!sameSource_ACU(found.anchor, current)) fail_ACU('当前 swipe 的正文锚点已变化');
  return { bucket: clone_ACU({ schemaVersion: 1, entries }), lifecycle: clone_ACU(found.value) };
}

/** 普通宿主专属 delivery lifecycle store：独立 swipe bucket；正常写入以宿主 saveChat 完成为准，未知结果须显式 recover。 */
export class WorldDeliveryHostStore_ACU {
  private static tails_ACU = new Map<string, Promise<void>>();
  private static pending_ACU = new Map<string, Pending_ACU>();
  private static runningAttempts_ACU = new Set<string>();
  private readonly anchor: WorldSimulationAnchorIdentity_ACU;
  private readonly lease: Lease_ACU;

  constructor(anchor: WorldSimulationAnchorIdentity_ACU) {
    requireWorldSimulationHostAnchor_ACU(anchor); this.anchor = clone_ACU(anchor); this.lease = this.capture_ACU();
  }

  read(): WorldDeliveryLifecycle_ACU {
    const lease = this.assertLease_ACU(); this.assertNotPending_ACU(lease.source);
    return validateBucket_ACU(lease.message[WORLD_DELIVERY_LIFECYCLE_FIELD_ACU], lease.source).lifecycle ?? buildEmptyWorldDeliveryLifecycle_ACU();
  }

  recordIntent(intent: IntentInput_ACU): Promise<WorldDeliveryLifecycle_ACU> {
    const frozen = clone_ACU(intent); const lease = this.assertLease_ACU(); this.assertNotPending_ACU(lease.source);
    if (frozen.source.kind === 'logical' || !sameSource_ACU(frozen.source, lease.source)) fail_ACU('intent.source 必须等于冻结 host source');
    return this.enqueue_ACU(async current => {
      const history = this.readChatHistory_ACU(current);
      createWorldDeliveryIntent_ACU(history, frozen);
      return this.transition_ACU(current, lifecycle => createWorldDeliveryIntent_ACU(lifecycle, frozen));
    });
  }

  /** 只接受实际本地第一 assistant 后继；正常保存以宿主 saveChat 完成为准。 */
  recordDurableSuccessor(deliveryId: string): Promise<WorldDeliveryLifecycle_ACU> {
    return this.enqueue_ACU(async current => {
      const successor = this.firstSuccessor_ACU(current);
      return this.transition_ACU(current, lifecycle => recordWorldDeliveryDurableSuccessor_ACU(lifecycle, deliveryId, successor), successor);
    });
  }

  markUnknown(deliveryId: string): Promise<WorldDeliveryLifecycle_ACU> {
    return this.enqueue_ACU(async current => this.transition_ACU(current, lifecycle => markWorldDeliveryUnknown_ACU(lifecycle, deliveryId)));
  }

  /** 公共写口只接收 adoption agent 签发的 opaque receipt + 同一 binding，不能接收 plain adopted IDs。 */
  applyAdoption(receipt: object, input: WorldDeliveryAdoptionClaimInput_ACU): Promise<WorldDeliveryLifecycle_ACU> {
    readWorldDeliveryAdoption_ACU(receipt); // 只读取无敏感 metadata；claim 会以当前实物输入再次核验。
    return this.enqueue_ACU(async current => {
      const lifecycle = validateBucket_ACU(current.message[WORLD_DELIVERY_LIFECYCLE_FIELD_ACU], current.source).lifecycle ?? buildEmptyWorldDeliveryLifecycle_ACU();
      const dto = claimWorldDeliveryAdoption_ACU(receipt, input);
      this.assertReceiptActual_ACU(dto, current, lifecycle);
      const next = applyWorldDeliveryAdoption_ACU(lifecycle, dto);
      if (equal_ACU(next, lifecycle)) return next;
      await this.persist_ACU(current, current.message[WORLD_DELIVERY_LIFECYCLE_FIELD_ACU], validateBucket_ACU(current.message[WORLD_DELIVERY_LIFECYCLE_FIELD_ACU], current.source).bucket, next, this.firstSuccessor_ACU(current),
        () => this.assertReceiptActual_ACU(dto, current, lifecycle));
      return next;
    });
  }

  /** intent 严格落盘后才标 attempted 且恰好调用一次 dispatch；异常仅持久化 unknown，不吞原错误、不自动重试。 */
  async runAttempt<T>(intent: IntentInput_ACU, authorization: WorldDispatchAuthorization_ACU,
    payload: Record<string, unknown>, dispatch: () => Promise<T>): Promise<T> {
    const frozenIntent = clone_ACU(intent);
    const frozenPayload = clone_ACU(payload);
    const payloadFingerprint = sha256HexSync_ACU(canonical_ACU(frozenPayload));
    assertWorldDispatchAuthorizationCurrent_ACU(authorization);
    const claim = claimWorldDispatchAuthorization_ACU(authorization, frozenPayload);
    if (frozenIntent.target !== 'body' || frozenIntent.source.kind === 'logical'
      || !sameSource_ACU(frozenIntent.source, claim.source)
      || frozenIntent.ledgerRevision !== claim.ledgerRevision || frozenIntent.ledgerFingerprint !== claim.ledgerFingerprint
      || frozenIntent.requestFingerprint !== claim.requestFingerprint || !equal_ACU(frozenIntent.factIds, claim.factIds)) fail_ACU('投送意图与真实授权不一致');
    const assertAuthorized = () => {
      this.assertLease_ACU();
      assertWorldDispatchAuthorizationCurrent_ACU(authorization);
      assertWorldDispatchHostClaim_ACU(this.anchor, claim);
      if (sha256HexSync_ACU(canonical_ACU(payload)) !== payloadFingerprint) fail_ACU('最终请求在保存期间已变化');
    };
    assertAuthorized();
    const sourceIndex = this.lease.chat.indexOf(this.lease.message);
    if (this.lease.chat.some((message, index) => index > sourceIndex && isAiMessage_ACU(message))) {
      fail_ACU('源之后已有 assistant 正文，不能把旧后继认作本次发送结果');
    }
    await this.recordIntent(frozenIntent);
    assertAuthorized();
    const attemptScope = `${scope_ACU(this.assertLease_ACU().source)}:${frozenIntent.deliveryId}`;
    await this.enqueue_ACU(async current => {
      const lifecycle = validateBucket_ACU(current.message[WORLD_DELIVERY_LIFECYCLE_FIELD_ACU], current.source).lifecycle ?? buildEmptyWorldDeliveryLifecycle_ACU();
      const record = lifecycle.records.find(item => item.deliveryId === frozenIntent.deliveryId);
      if (!record || record.status !== 'intent' || WorldDeliveryHostStore_ACU.runningAttempts_ACU.has(attemptScope)) {
        fail_ACU('delivery 已尝试、处于未知/完成状态或正由另一调用执行，禁止重复 dispatch');
      }
      assertAuthorized();
      const next = markWorldDeliveryAttempted_ACU(lifecycle, frozenIntent.deliveryId);
      await this.persist_ACU(current, current.message[WORLD_DELIVERY_LIFECYCLE_FIELD_ACU], validateBucket_ACU(current.message[WORLD_DELIVERY_LIFECYCLE_FIELD_ACU], current.source).bucket, next, undefined, assertAuthorized);
      WorldDeliveryHostStore_ACU.runningAttempts_ACU.add(attemptScope);
    });
    try { assertAuthorized(); return await dispatch(); } catch (error) {
      try { await this.markUnknown(frozenIntent.deliveryId); } catch (markError) { unknown_ACU('dispatch 失败且 unknown 标记未能确认', markError); }
      throw error;
    } finally { WorldDeliveryHostStore_ACU.runningAttempts_ACU.delete(attemptScope); }
  }

  async recover(): Promise<{ status: 'previous' | 'candidate'; lifecycle: WorldDeliveryLifecycle_ACU }> {
    const lease = this.assertLease_ACU(); const pendingScope = scope_ACU(lease.source);
    return this.enqueueRecover_ACU(async current => {
      const pending = WorldDeliveryHostStore_ACU.pending_ACU.get(pendingScope);
      if (!pending) throw new Error('WORLD_DELIVERY_RECOVERY_UNAVAILABLE: 没有待恢复未知写入');
      if (!equal_ACU(current.message[WORLD_DELIVERY_LIFECYCLE_FIELD_ACU], pending.candidate)) throw new Error('WORLD_DELIVERY_RECOVERY_UNRESOLVED: 本地字段已变化');
      let remote: any[]; try { remote = await readChatFromHostStrict_ACU(); } catch (error) { unknown_ACU('恢复远端读取失败', error); }
      if (WorldDeliveryHostStore_ACU.pending_ACU.get(pendingScope) !== pending || !equal_ACU(this.assertLease_ACU().message[WORLD_DELIVERY_LIFECYCLE_FIELD_ACU], pending.candidate)) throw new Error('WORLD_DELIVERY_RECOVERY_UNRESOLVED: 恢复期间本地状态已变化');
      const remoteMessage = findRemoteSource_ACU(remote, current.source);
      const remoteValue = remoteMessage[WORLD_DELIVERY_LIFECYCLE_FIELD_ACU];
      const status = equal_ACU(remoteValue, pending.baseline) ? 'previous' : equal_ACU(remoteValue, pending.candidate) ? 'candidate' : null;
      if (!status) throw new Error('WORLD_DELIVERY_RECOVERY_UNRESOLVED: 远端字段既非基线也非候选');
      if (status === 'candidate' && pending.expectedSuccessor) {
        this.assertRemoteFirstSuccessor_ACU(remote, remoteMessage, pending.expectedSuccessor);
        this.assertRemoteFirstSuccessor_ACU(current.chat, current.message, pending.expectedSuccessor);
      }
      if (status === 'previous') { if (pending.baseline === undefined) delete current.message[WORLD_DELIVERY_LIFECYCLE_FIELD_ACU]; else current.message[WORLD_DELIVERY_LIFECYCLE_FIELD_ACU] = clone_ACU(pending.baseline); }
      else current.message[WORLD_DELIVERY_LIFECYCLE_FIELD_ACU] = clone_ACU(pending.candidate);
      WorldDeliveryHostStore_ACU.pending_ACU.delete(pendingScope);
      return { status, lifecycle: validateBucket_ACU(current.message[WORLD_DELIVERY_LIFECYCLE_FIELD_ACU], current.source).lifecycle ?? buildEmptyWorldDeliveryLifecycle_ACU() };
    });
  }

  readHistory(): WorldDeliveryLifecycle_ACU {
    const current = this.assertLease_ACU();
    this.assertNotPending_ACU(current.source);
    return this.readChatHistory_ACU(current);
  }

  private readChatHistory_ACU(current: Lease_ACU): WorldDeliveryLifecycle_ACU {
    const records: WorldDeliveryAttempt_ACU[] = [];
    for (let index = 0; index < current.chat.length; index += 1) {
      const message = current.chat[index];
      if (!isRecord_ACU(message) || !isAiMessage_ACU(message) || message[WORLD_DELIVERY_LIFECYCLE_FIELD_ACU] === undefined) continue;
      const source = sourceAt_ACU(current.chat, index, current.source.chatIdentity);
      const lifecycle = validateBucket_ACU(message[WORLD_DELIVERY_LIFECYCLE_FIELD_ACU], source).lifecycle;
      if (lifecycle) records.push(...lifecycle.records);
    }
    return validateWorldDeliveryLifecycle_ACU({ schemaVersion: 1, revision: 0, records });
  }

  private capture_ACU(): Lease_ACU {
    const chat = getChatArray_ACU(); const resolved = resolveCurrentWorldSimulationAnchor_ACU(this.anchor, chat); const source = toSource_ACU(resolved);
    if (!sameSource_ACU(source, toSource_ACU(this.anchor)) || !isRecord_ACU(chat[resolved.messageIndex])) fail_ACU('source 已过期');
    return { chat, message: chat[resolved.messageIndex], source };
  }
  private assertLease_ACU(): Lease_ACU {
    const chat = getChatArray_ACU();
    if (chat !== this.lease.chat) throw new Error('WORLD_DELIVERY_SOURCE_STALE: 聊天数组已替换');
    const resolved = resolveCurrentWorldSimulationAnchor_ACU(this.anchor, chat); const source = toSource_ACU(resolved);
    if (!sameSource_ACU(source, this.lease.source) || chat[resolved.messageIndex] !== this.lease.message) throw new Error('WORLD_DELIVERY_SOURCE_STALE: source 已变化');
    return this.lease;
  }
  private assertNotPending_ACU(source: Source_ACU): void {
    if (WorldDeliveryHostStore_ACU.pending_ACU.has(scope_ACU(source))) throw new Error('WORLD_DELIVERY_PERSIST_UNKNOWN: 必须先 recover，禁止自动重发');
  }
  private firstSuccessor_ACU(current: Lease_ACU): Source_ACU {
    const sourceIndex = current.chat.indexOf(current.message);
    const index = current.chat.findIndex((message, candidate) => candidate > sourceIndex && isAiMessage_ACU(message));
    if (sourceIndex < 0 || index < 0) throw new Error('WORLD_DELIVERY_SUCCESSOR_UNAVAILABLE: 尚无第一 assistant 后继');
    return sourceAt_ACU(current.chat, index, current.source.chatIdentity);
  }
  private assertRemoteFirstSuccessor_ACU(remote: any[], remoteMessage: Record<string, unknown>, expected: Source_ACU): void {
    const sourceIndex = remote.indexOf(remoteMessage); const next = remote.findIndex((message, index) => index > sourceIndex && isAiMessage_ACU(message));
    if (sourceIndex < 0 || next < 0 || !sameSource_ACU(sourceAt_ACU(remote, next, expected.chatIdentity), expected)) throw new Error('WORLD_DELIVERY_RECOVERY_UNRESOLVED: 远端第一后继不一致');
  }
  private assertReceiptActual_ACU(receipt: WorldDeliveryAdoptionReceipt_ACU, current: Lease_ACU, lifecycle: WorldDeliveryLifecycle_ACU): void {
    const record = lifecycle.records.find(item => item.deliveryId === receipt.deliveryId);
    if (!record || record.status !== 'response-durable' || !record.successor || record.source.kind === 'logical') fail_ACU('receipt 没有对应的 durable host delivery');
    const first = this.firstSuccessor_ACU(current);
    if (!sameSource_ACU(record.source as Source_ACU, current.source) || receipt.source.kind === 'logical' || !sameSource_ACU(receipt.source as Source_ACU, current.source)
      || receipt.successor.kind === 'logical' || !sameSource_ACU(receipt.successor as Source_ACU, first) || !sameSource_ACU(record.successor as Source_ACU, first)) fail_ACU('receipt 不对应实际首后继');
    const ledger = readWorldSimulationLedgerAtAnchor_ACU(this.anchor, current.chat);
    if (!ledger || ledger.revision !== receipt.ledgerRevision
      || sha256HexSync_ACU(canonical_ACU(ledger)) !== receipt.ledgerFingerprint) fail_ACU('receipt 权威账本已变化');
  }
  private async transition_ACU(current: Lease_ACU, transform: (lifecycle: WorldDeliveryLifecycle_ACU) => WorldDeliveryLifecycle_ACU, expectedSuccessor?: Source_ACU): Promise<WorldDeliveryLifecycle_ACU> {
    const loaded = validateBucket_ACU(current.message[WORLD_DELIVERY_LIFECYCLE_FIELD_ACU], current.source); const baseline = loaded.lifecycle ?? buildEmptyWorldDeliveryLifecycle_ACU();
    const next = transform(baseline); if (equal_ACU(next, baseline)) return next;
    await this.persist_ACU(current, current.message[WORLD_DELIVERY_LIFECYCLE_FIELD_ACU], loaded.bucket, next, expectedSuccessor); return next;
  }
  private async persist_ACU(current: Lease_ACU, baseline: unknown, bucket: Bucket_ACU, lifecycle: WorldDeliveryLifecycle_ACU,
    expectedSuccessor?: Source_ACU, assertAdditional?: () => void): Promise<void> {
    this.assertNotPending_ACU(current.source); const candidate = clone_ACU(bucket); candidate.entries[key_ACU(current.source)] = { anchor: clone_ACU(current.source), value: clone_ACU(lifecycle), updatedAt: Date.now() };
    validateBucket_ACU(candidate, current.source); const pending: Pending_ACU = { baseline: clone_ACU(baseline), candidate: clone_ACU(candidate), ...(expectedSuccessor ? { expectedSuccessor: clone_ACU(expectedSuccessor) } : {}) };
    current.message[WORLD_DELIVERY_LIFECYCLE_FIELD_ACU] = candidate;
    try {
      this.assertLease_ACU(); assertAdditional?.();
      if (expectedSuccessor) this.assertRemoteFirstSuccessor_ACU(current.chat, current.message, expectedSuccessor);
      if (current.message[WORLD_DELIVERY_LIFECYCLE_FIELD_ACU] !== candidate) throw new Error('保存前本地字段被变更');
      await saveChatToHostStrict_ACU();
      this.assertLease_ACU(); assertAdditional?.();
      if (expectedSuccessor) this.assertRemoteFirstSuccessor_ACU(current.chat, current.message, expectedSuccessor);
      if (current.message[WORLD_DELIVERY_LIFECYCLE_FIELD_ACU] !== candidate) throw new Error('保存期间本地字段被变更');
    } catch (error) {
      if (error instanceof HostChatSaveNotStartedError_ACU) {
        try { if (this.assertLease_ACU().message[WORLD_DELIVERY_LIFECYCLE_FIELD_ACU] === candidate) { if (baseline === undefined) delete current.message[WORLD_DELIVERY_LIFECYCLE_FIELD_ACU]; else current.message[WORLD_DELIVERY_LIFECYCLE_FIELD_ACU] = clone_ACU(baseline); } } catch { /* 租约已失效不得回滚 */ }
        throw error;
      }
      WorldDeliveryHostStore_ACU.pending_ACU.set(scope_ACU(current.source), pending); unknown_ACU('保存可能已提交，禁止补偿或自动重试', error);
    }
  }
  private enqueue_ACU<T>(operation: (lease: Lease_ACU) => Promise<T>): Promise<T> { return this.queue_ACU(operation, true); }
  private enqueueRecover_ACU<T>(operation: (lease: Lease_ACU) => Promise<T>): Promise<T> { return this.queue_ACU(operation, false); }
  private queue_ACU<T>(operation: (lease: Lease_ACU) => Promise<T>, rejectPending: boolean): Promise<T> {
    const key = this.lease.source.chatIdentity; const previous = WorldDeliveryHostStore_ACU.tails_ACU.get(key) ?? Promise.resolve();
    const result = previous.then(async () => { const lease = this.assertLease_ACU(); if (rejectPending) this.assertNotPending_ACU(lease.source); return operation(lease); }, async () => { const lease = this.assertLease_ACU(); if (rejectPending) this.assertNotPending_ACU(lease.source); return operation(lease); });
    const settled: Promise<void> = result.then(
      (): void => undefined,
      (): void => undefined,
    );
    WorldDeliveryHostStore_ACU.tails_ACU.set(key, settled);
    void settled.finally(() => { if (WorldDeliveryHostStore_ACU.tails_ACU.get(key) === settled) WorldDeliveryHostStore_ACU.tails_ACU.delete(key); }); return result;
  }
}
