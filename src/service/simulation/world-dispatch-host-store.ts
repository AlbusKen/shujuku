import {
  HostChatSaveNotStartedError_ACU,
  getChatArray_ACU,
  readChatFromHostStrict_ACU,
  saveChatToHostStrict_ACU,
} from '../../data/gateways/chat-gateway';
import { sha256HexSync_ACU } from '../../shared/sha256-sync';
import { isAiMessage_ACU } from '../runtime/message-handler';
import type { WorldSimulationAnchorIdentity_ACU } from './agent/agent-model';
import { requireWorldSimulationHostAnchor_ACU } from './simulation-identity';
import {
  resolveCurrentWorldSimulationAnchor_ACU,
  resolveWorldSimulationAnchor_ACU,
} from './simulation-store';
import {
  buildEmptyWorldDispatchJournal_ACU,
  observeWorldDispatchSuccessor_ACU,
  recordWorldDispatchIntent_ACU,
  validateWorldDispatchJournal_ACU,
  type WorldDispatchJournal_ACU,
  type WorldDispatchRecord_ACU,
  type WorldDispatchSource_ACU,
} from './world-dispatch-journal';

export const WORLD_DISPATCH_JOURNAL_FIELD_ACU = '_qrf_world_projection_dispatch';

type WorldDispatchBucketEntry_ACU = {
  anchor: WorldDispatchSource_ACU;
  value: WorldDispatchJournal_ACU;
  updatedAt: number;
};

type WorldDispatchBucket_ACU = {
  schemaVersion: 1;
  entries: Record<string, WorldDispatchBucketEntry_ACU>;
};

type CapturedLease_ACU = {
  chat: any[];
  message: Record<string, unknown>;
  source: WorldDispatchSource_ACU;
};

type PendingPersist_ACU = {
  baseline: unknown;
  candidate: WorldDispatchBucket_ACU;
  expectedSuccessor?: WorldDispatchSource_ACU;
};

const SHA256_HEX_ACU = /^[a-f0-9]{64}$/;

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys_ACU(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  if (Object.getOwnPropertySymbols(value).length > 0 || Object.keys(value).length !== keys.length
    || keys.some(key => !Object.prototype.hasOwnProperty.call(value, key))
    || Object.keys(value).some(key => !keys.includes(key))) {
    throw new Error(`WORLD_DISPATCH_HOST_INVALID: ${path} 的字段不完整或包含未知字段`);
  }
}

function clone_ACU<T>(value: T): T {
  return structuredClone(value);
}

function equal_ACU(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function throwUnknown_ACU(message: string, cause: unknown): never {
  const error = new Error(`WORLD_DISPATCH_PERSIST_UNKNOWN: ${message}`);
  (error as Error & { code?: string; details?: Record<string, unknown> }).code = 'WORLD_DISPATCH_PERSIST_UNKNOWN';
  (error as Error & { code?: string; details?: Record<string, unknown> }).details = {
    message: cause instanceof Error ? cause.message : String(cause),
  };
  throw error;
}

function toSource_ACU(anchor: WorldSimulationAnchorIdentity_ACU): WorldDispatchSource_ACU {
  return {
    chatIdentity: anchor.chatIdentity,
    messageKey: anchor.messageKey,
    swipeId: anchor.swipeId,
    contentDigest: anchor.contentDigest,
  };
}

function sameSource_ACU(left: WorldDispatchSource_ACU, right: WorldDispatchSource_ACU): boolean {
  return left.chatIdentity === right.chatIdentity
    && left.messageKey === right.messageKey
    && left.swipeId === right.swipeId
    && left.contentDigest === right.contentDigest;
}

function validateSource_ACU(raw: unknown, path: string): WorldDispatchSource_ACU {
  if (!isRecord_ACU(raw)) throw new Error(`WORLD_DISPATCH_HOST_INVALID: ${path} 必须是对象`);
  exactKeys_ACU(raw, ['chatIdentity', 'messageKey', 'swipeId', 'contentDigest'], path);
  const values = ['chatIdentity', 'messageKey', 'swipeId'] as const;
  for (const key of values) {
    if (typeof raw[key] !== 'string' || !raw[key].trim()) {
      throw new Error(`WORLD_DISPATCH_HOST_INVALID: ${path}.${key} 必须是非空字符串`);
    }
  }
  if (typeof raw.contentDigest !== 'string' || !SHA256_HEX_ACU.test(raw.contentDigest)) {
    throw new Error(`WORLD_DISPATCH_HOST_INVALID: ${path}.contentDigest 必须是 SHA-256 摘要`);
  }
  return {
    chatIdentity: raw.chatIdentity as string,
    messageKey: raw.messageKey as string,
    swipeId: raw.swipeId as string,
    contentDigest: raw.contentDigest as string,
  };
}

function dispatchBucketKey_ACU(source: WorldDispatchSource_ACU): string {
  // 正文摘要是 entry 的严格身份校验，不纳入 swipe 桶键；同一 swipe 的正文变更必须拒绝而非复用旧桶。
  return sha256HexSync_ACU(JSON.stringify([source.chatIdentity, source.messageKey, source.swipeId]));
}

function scopeKey_ACU(source: WorldDispatchSource_ACU): string {
  return JSON.stringify([source.chatIdentity, source.messageKey, source.swipeId, source.contentDigest]);
}

function readMessageContent_ACU(message: Record<string, unknown>): string {
  return typeof message.mes === 'string' ? message.mes : typeof message.message === 'string' ? message.message : '';
}

function remoteSourceAt_ACU(messages: any[], messageIndex: number, chatIdentity: string): WorldDispatchSource_ACU {
  const message = messages[messageIndex];
  if (!isRecord_ACU(message) || message.is_user === true
    || (isRecord_ACU(message.extra) && message.extra.type === 'narrator')) {
    throw new Error('WORLD_DISPATCH_RECOVERY_UNRESOLVED: 服务器上找不到原 assistant 楼层');
  }
  const rawMessageId = message.message_id;
  const messageId = typeof rawMessageId === 'string' || typeof rawMessageId === 'number' ? rawMessageId : messageIndex;
  const swipeId = typeof message.swipe_id === 'number' && Number.isInteger(message.swipe_id) && message.swipe_id >= 0
    ? String(message.swipe_id)
    : '0';
  return {
    chatIdentity,
    messageKey: `${typeof messageId}:${String(messageId)}`,
    swipeId,
    contentDigest: sha256HexSync_ACU(readMessageContent_ACU(message)),
  };
}

function findRemoteMessageForSource_ACU(messages: any[], source: WorldDispatchSource_ACU): Record<string, unknown> {
  const matches: Record<string, unknown>[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    try {
      const candidate = remoteSourceAt_ACU(messages, index, source.chatIdentity);
      if (sameSource_ACU(candidate, source) && isRecord_ACU(messages[index])) matches.push(messages[index]);
    } catch {
      // 其它楼层不是合法的原 assistant source，不能充当恢复目标。
    }
  }
  if (matches.length !== 1) {
    throw new Error('WORLD_DISPATCH_RECOVERY_UNRESOLVED: 服务器原 source 缺失或不唯一');
  }
  return matches[0];
}

function validateBucket_ACU(raw: unknown, currentSource: WorldDispatchSource_ACU): {
  bucket: WorldDispatchBucket_ACU;
  journal: WorldDispatchJournal_ACU | null;
} {
  if (raw === undefined) return { bucket: { schemaVersion: 1, entries: {} }, journal: null };
  if (!isRecord_ACU(raw)) throw new Error('WORLD_DISPATCH_HOST_INVALID: dispatch 分桶必须是对象');
  exactKeys_ACU(raw, ['schemaVersion', 'entries'], 'dispatch 分桶');
  if (raw.schemaVersion !== 1 || !isRecord_ACU(raw.entries)) {
    throw new Error('WORLD_DISPATCH_HOST_INVALID: dispatch 分桶版本或 entries 无效');
  }
  const entries: Record<string, WorldDispatchBucketEntry_ACU> = {};
  for (const [key, rawEntry] of Object.entries(raw.entries)) {
    if (!SHA256_HEX_ACU.test(key) || !isRecord_ACU(rawEntry)) {
      throw new Error('WORLD_DISPATCH_HOST_INVALID: dispatch 分桶条目键或结构无效');
    }
    exactKeys_ACU(rawEntry, ['anchor', 'value', 'updatedAt'], `dispatch 分桶条目 ${key}`);
    const anchor = validateSource_ACU(rawEntry.anchor, `dispatch 分桶条目 ${key}.anchor`);
    if (dispatchBucketKey_ACU(anchor) !== key) {
      throw new Error('WORLD_DISPATCH_HOST_INVALID: dispatch 分桶条目键与锚点不一致');
    }
    if (typeof rawEntry.updatedAt !== 'number' || !Number.isSafeInteger(rawEntry.updatedAt) || rawEntry.updatedAt < 0) {
      throw new Error('WORLD_DISPATCH_HOST_INVALID: dispatch 分桶条目 updatedAt 无效');
    }
    const value = validateWorldDispatchJournal_ACU(rawEntry.value);
    if (value.records.some(record => !sameSource_ACU(record.source, anchor))) {
      throw new Error('WORLD_DISPATCH_HOST_INVALID: dispatch journal 的来源与所属 swipe 桶不一致');
    }
    entries[key] = { anchor, value, updatedAt: rawEntry.updatedAt };
  }
  const key = dispatchBucketKey_ACU(currentSource);
  const current = entries[key];
  if (!current) return { bucket: clone_ACU(raw) as WorldDispatchBucket_ACU, journal: null };
  if (!sameSource_ACU(current.anchor, currentSource)) {
    throw new Error('WORLD_DISPATCH_HOST_INVALID: 当前 source 的 dispatch 分桶锚点不一致');
  }
  return { bucket: clone_ACU(raw) as WorldDispatchBucket_ACU, journal: clone_ACU(current.value) };
}

/**
 * 宿主聊天楼层上的投送意图日志。普通宿主模式专用：不读取或复用逻辑/zero 模式字段。
 * 每次可写操作在同一 chat 队列内重新核验实际楼层、正文摘要和原始 bucket。
 */
export class WorldDispatchHostStore_ACU {
  private static tailsByChat_ACU = new Map<string, Promise<void>>();
  private static pendingByScope_ACU = new Map<string, PendingPersist_ACU>();

  private readonly anchor: WorldSimulationAnchorIdentity_ACU;
  private readonly captured: CapturedLease_ACU;

  constructor(anchor: WorldSimulationAnchorIdentity_ACU) {
    requireWorldSimulationHostAnchor_ACU(anchor);
    this.anchor = clone_ACU(anchor);
    this.captured = this.captureLease_ACU();
  }

  read(): WorldDispatchJournal_ACU {
    const lease = this.assertLease_ACU();
    this.assertNotPending_ACU(lease.source);
    const loaded = validateBucket_ACU(lease.message[WORLD_DISPATCH_JOURNAL_FIELD_ACU], lease.source);
    return loaded.journal ?? buildEmptyWorldDispatchJournal_ACU();
  }

  async recordIntent(intent: Omit<WorldDispatchRecord_ACU, 'successor'>): Promise<WorldDispatchJournal_ACU> {
    // 入队前即冻结调用方数据，调用方随后改写对象不得改变将要保存的意图。
    const frozenIntent = clone_ACU(intent);
    const lease = this.assertLease_ACU();
    this.assertNotPending_ACU(lease.source);
    this.assertExactIntentSource_ACU(frozenIntent, lease.source);
    return this.enqueue_ACU(async current => {
      this.assertExactIntentSource_ACU(frozenIntent, current.source);
      const loaded = validateBucket_ACU(current.message[WORLD_DISPATCH_JOURNAL_FIELD_ACU], current.source);
      const baselineJournal = loaded.journal ?? buildEmptyWorldDispatchJournal_ACU();
      const journal = recordWorldDispatchIntent_ACU(baselineJournal, frozenIntent);
      if (equal_ACU(journal, baselineJournal)) return journal;
      await this.persistJournal_ACU(current, current.message[WORLD_DISPATCH_JOURNAL_FIELD_ACU], loaded.bucket, journal);
      return journal;
    });
  }

  observeSuccessor(
    deliveryId: string,
    successorAnchor: WorldSimulationAnchorIdentity_ACU,
    observedAt: number,
  ): Promise<WorldDispatchJournal_ACU> {
    const frozenDeliveryId = String(deliveryId);
    const frozenSuccessorHint = clone_ACU(successorAnchor);
    const frozenObservedAt = clone_ACU(observedAt);
    const lease = this.assertLease_ACU();
    this.assertNotPending_ACU(lease.source);
    return this.enqueue_ACU(async current => {
      const actualSuccessor = this.resolveActualSuccessor_ACU(current, frozenSuccessorHint);
      const loaded = validateBucket_ACU(current.message[WORLD_DISPATCH_JOURNAL_FIELD_ACU], current.source);
      const baselineJournal = loaded.journal ?? buildEmptyWorldDispatchJournal_ACU();
      const journal = observeWorldDispatchSuccessor_ACU(
        baselineJournal,
        frozenDeliveryId,
        toSource_ACU(actualSuccessor),
        frozenObservedAt,
      );
      if (equal_ACU(journal, baselineJournal)) return journal;
      await this.persistJournal_ACU(
        current,
        current.message[WORLD_DISPATCH_JOURNAL_FIELD_ACU],
        loaded.bucket,
        journal,
        () => this.resolveActualSuccessor_ACU(current, frozenSuccessorHint),
        toSource_ACU(actualSuccessor),
      );
      return journal;
    });
  }

  async recover(): Promise<{ status: 'previous' | 'candidate'; journal: WorldDispatchJournal_ACU }> {
    const lease = this.assertLease_ACU();
    const scope = scopeKey_ACU(lease.source);
    return this.enqueueRecovery_ACU(async current => {
      const pending = WorldDispatchHostStore_ACU.pendingByScope_ACU.get(scope);
      if (!pending) {
        throw new Error('WORLD_DISPATCH_RECOVERY_UNAVAILABLE: 当前 source 没有待恢复的未知持久化结果');
      }
      const capturedPending = pending;
      const localField = current.message[WORLD_DISPATCH_JOURNAL_FIELD_ACU];
      if (!equal_ACU(localField, capturedPending.candidate)) {
        throw new Error('WORLD_DISPATCH_RECOVERY_UNRESOLVED: 本地 dispatch 字段已被外部变更，结果仍未知');
      }
      let remote: any[];
      try {
        remote = await readChatFromHostStrict_ACU();
      } catch (error) {
        throwUnknown_ACU('恢复读取服务器聊天失败，结果仍未知', error);
      }
      const latest = this.assertLease_ACU();
      if (WorldDispatchHostStore_ACU.pendingByScope_ACU.get(scope) !== capturedPending
        || !equal_ACU(latest.message[WORLD_DISPATCH_JOURNAL_FIELD_ACU], capturedPending.candidate)) {
        throw new Error('WORLD_DISPATCH_RECOVERY_UNRESOLVED: 恢复期间本地字段或 pending 已变化，结果仍未知');
      }
      const remoteMessage = findRemoteMessageForSource_ACU(remote, latest.source);
      const remoteField = remoteMessage[WORLD_DISPATCH_JOURNAL_FIELD_ACU];
      const status = equal_ACU(remoteField, capturedPending.baseline)
        ? 'previous'
        : equal_ACU(remoteField, capturedPending.candidate)
          ? 'candidate'
          : null;
      if (!status) {
        throw new Error('WORLD_DISPATCH_RECOVERY_UNRESOLVED: 服务器字段既非原值也非候选值，结果仍未知');
      }
      if (status === 'candidate' && capturedPending.expectedSuccessor) {
        for (const [messages, sourceMessage] of [[remote, remoteMessage], [latest.chat, latest.message]] as const) {
          const sourceIndex = messages.indexOf(sourceMessage);
          const nextAssistant = messages.findIndex((message, index) => index > sourceIndex && isAiMessage_ACU(message));
          if (sourceIndex < 0 || nextAssistant < 0
            || !sameSource_ACU(remoteSourceAt_ACU(messages, nextAssistant, latest.source.chatIdentity), capturedPending.expectedSuccessor)) {
            throw new Error('WORLD_DISPATCH_RECOVERY_UNRESOLVED: 第一后继与未知保存的观察值不一致，结果仍未知');
          }
        }
      }
      // 只恢复本字段的内存视图；不保存、不替换聊天数组，也不改动其它 swipe 或楼层。
      if (status === 'previous') {
        if (capturedPending.baseline === undefined) delete latest.message[WORLD_DISPATCH_JOURNAL_FIELD_ACU];
        else latest.message[WORLD_DISPATCH_JOURNAL_FIELD_ACU] = clone_ACU(capturedPending.baseline);
      } else {
        latest.message[WORLD_DISPATCH_JOURNAL_FIELD_ACU] = clone_ACU(capturedPending.candidate);
      }
      const journal = validateBucket_ACU(latest.message[WORLD_DISPATCH_JOURNAL_FIELD_ACU], latest.source).journal
        ?? buildEmptyWorldDispatchJournal_ACU();
      WorldDispatchHostStore_ACU.pendingByScope_ACU.delete(scope);
      return { status, journal };
    });
  }

  private captureLease_ACU(): CapturedLease_ACU {
    const chat = getChatArray_ACU();
    const current = resolveCurrentWorldSimulationAnchor_ACU(this.anchor, chat);
    const source = toSource_ACU(current);
    if (!sameSource_ACU(source, toSource_ACU(this.anchor))) {
      throw new Error('WORLD_DISPATCH_SOURCE_STALE: source 的正文摘要或身份已变化');
    }
    const message = chat[current.messageIndex];
    if (!isRecord_ACU(message)) throw new Error('WORLD_DISPATCH_SOURCE_STALE: source 楼层不可用');
    return { chat, message, source };
  }

  private assertLease_ACU(): CapturedLease_ACU {
    const chat = getChatArray_ACU();
    if (chat !== this.captured.chat) throw new Error('WORLD_DISPATCH_SOURCE_STALE: 当前聊天数组已切换');
    const current = resolveCurrentWorldSimulationAnchor_ACU(this.anchor, chat);
    const source = toSource_ACU(current);
    if (!sameSource_ACU(source, this.captured.source) || chat[current.messageIndex] !== this.captured.message) {
      throw new Error('WORLD_DISPATCH_SOURCE_STALE: source 的身份、正文或楼层对象已变化');
    }
    return this.captured;
  }

  private assertNotPending_ACU(source: WorldDispatchSource_ACU): void {
    if (WorldDispatchHostStore_ACU.pendingByScope_ACU.has(scopeKey_ACU(source))) {
      throw new Error('WORLD_DISPATCH_PERSIST_UNKNOWN: 该 source 的上次保存结果未知，必须先 recover');
    }
  }

  private assertExactIntentSource_ACU(intent: Omit<WorldDispatchRecord_ACU, 'successor'>, source: WorldDispatchSource_ACU): void {
    if (!sameSource_ACU(intent.source, source)) {
      throw new Error('WORLD_DISPATCH_SOURCE_STALE: dispatch intent.source 必须与冻结 source 完全一致');
    }
  }

  private resolveActualSuccessor_ACU(
    current: CapturedLease_ACU,
    successorHint: WorldSimulationAnchorIdentity_ACU,
  ): WorldSimulationAnchorIdentity_ACU {
    const actual = resolveCurrentWorldSimulationAnchor_ACU(successorHint, current.chat);
    const hintedSource = toSource_ACU(successorHint);
    const actualSource = toSource_ACU(actual);
    const sourceIndex = current.chat.indexOf(current.message);
    if (!sameSource_ACU(hintedSource, actualSource)
      || actual.chatIdentity !== current.source.chatIdentity || sourceIndex < 0 || actual.messageIndex <= sourceIndex) {
      throw new Error('WORLD_DISPATCH_SUCCESSOR_INVALID: successor 必须是同一聊天 source 之后的 assistant 楼层');
    }
    for (let index = sourceIndex + 1; index < actual.messageIndex; index += 1) {
      if (isAiMessage_ACU(current.chat[index])) {
        throw new Error('WORLD_DISPATCH_SUCCESSOR_INVALID: 不能跳过更早的 assistant 后继楼层');
      }
    }
    return actual;
  }

  private async persistJournal_ACU(
    lease: CapturedLease_ACU,
    baseline: unknown,
    bucket: WorldDispatchBucket_ACU,
    journal: WorldDispatchJournal_ACU,
    assertAdditionalLease?: () => unknown,
    expectedSuccessor?: WorldDispatchSource_ACU,
  ): Promise<void> {
    this.assertNotPending_ACU(lease.source);
    const key = dispatchBucketKey_ACU(lease.source);
    const candidate = clone_ACU(bucket);
    candidate.entries[key] = {
      anchor: clone_ACU(lease.source),
      value: clone_ACU(journal),
      updatedAt: Date.now(),
    };
    // 领域函数已严格校验 journal；这里再验证完整候选 bucket，确保其它 swipe 未被擦除或放宽。
    validateBucket_ACU(candidate, lease.source);
    const pending: PendingPersist_ACU = {
      baseline: clone_ACU(baseline),
      candidate: clone_ACU(candidate),
      ...(expectedSuccessor ? { expectedSuccessor: clone_ACU(expectedSuccessor) } : {}),
    };
    lease.message[WORLD_DISPATCH_JOURNAL_FIELD_ACU] = candidate;
    try {
      this.assertLease_ACU();
      assertAdditionalLease?.();
      if (lease.message[WORLD_DISPATCH_JOURNAL_FIELD_ACU] !== candidate) {
        throw new Error('保存前本地 dispatch 字段已被外部变更');
      }
      await saveChatToHostStrict_ACU();
      this.assertLease_ACU();
      assertAdditionalLease?.();
      if (lease.message[WORLD_DISPATCH_JOURNAL_FIELD_ACU] !== candidate) {
        throw new Error('保存后本地 dispatch 字段已被外部变更');
      }
    } catch (error) {
      if (error instanceof HostChatSaveNotStartedError_ACU) {
        // 这是唯一能证明 save 尚未开始的错误；只在同一捕获 scope 和候选仍在位时安全撤回内存字段。
        try {
          const current = this.assertLease_ACU();
          if (current.message[WORLD_DISPATCH_JOURNAL_FIELD_ACU] === candidate) {
            if (baseline === undefined) delete current.message[WORLD_DISPATCH_JOURNAL_FIELD_ACU];
            else current.message[WORLD_DISPATCH_JOURNAL_FIELD_ACU] = clone_ACU(baseline);
          }
        } catch {
          // 既然无法再证明同一 source，不能触碰已切换的聊天或消息对象。
        }
        throw error;
      }
      WorldDispatchHostStore_ACU.pendingByScope_ACU.set(scopeKey_ACU(lease.source), pending);
      throwUnknown_ACU('保存可能已经提交；禁止自动补偿或盲重试', error);
    }
  }

  private enqueueRecovery_ACU<T>(operation: (lease: CapturedLease_ACU) => Promise<T>): Promise<T> {
    const chatIdentity = this.captured.source.chatIdentity;
    const previous = WorldDispatchHostStore_ACU.tailsByChat_ACU.get(chatIdentity) ?? Promise.resolve();
    const result = previous.then(() => operation(this.assertLease_ACU()), () => operation(this.assertLease_ACU()));
    const settled: Promise<void> = result.then(
      (): void => undefined,
      (): void => undefined,
    );
    WorldDispatchHostStore_ACU.tailsByChat_ACU.set(chatIdentity, settled);
    void settled.finally(() => {
      if (WorldDispatchHostStore_ACU.tailsByChat_ACU.get(chatIdentity) === settled) {
        WorldDispatchHostStore_ACU.tailsByChat_ACU.delete(chatIdentity);
      }
    });
    return result;
  }

  private enqueue_ACU<T>(operation: (lease: CapturedLease_ACU) => Promise<T>): Promise<T> {
    const chatIdentity = this.captured.source.chatIdentity;
    const previous = WorldDispatchHostStore_ACU.tailsByChat_ACU.get(chatIdentity) ?? Promise.resolve();
    const result = previous.then(
      async () => {
        const lease = this.assertLease_ACU();
        this.assertNotPending_ACU(lease.source);
        return operation(lease);
      },
      async () => {
        const lease = this.assertLease_ACU();
        this.assertNotPending_ACU(lease.source);
        return operation(lease);
      },
    );
    const settled: Promise<void> = result.then(
      (): void => undefined,
      (): void => undefined,
    );
    WorldDispatchHostStore_ACU.tailsByChat_ACU.set(chatIdentity, settled);
    void settled.finally(() => {
      if (WorldDispatchHostStore_ACU.tailsByChat_ACU.get(chatIdentity) === settled) {
        WorldDispatchHostStore_ACU.tailsByChat_ACU.delete(chatIdentity);
      }
    });
    return result;
  }
}
