import {
  createWorldSimError_ACU,
  WorldSimulationValidationError_ACU,
  type WorldSimulationSwipeIdentity_ACU,
} from './model';

export type { WorldSimulationSwipeIdentity_ACU } from './model';

export interface ActiveWorldSimulationSwipe_ACU {
  message: Record<string, any>;
  text: string;
  identity: WorldSimulationSwipeIdentity_ACU;
}

/** Local rollback snapshot; it deliberately owns only fields the adapter writes. */
export interface WorldSimulationSwipeSnapshot_ACU {
  message: Record<string, any>;
  identity: WorldSimulationSwipeIdentity_ACU;
  mes: string;
  activeSwipeText: string | null;
  hadIsolatedData: boolean;
  isolatedData: unknown;
}

function fail_ACU(
  code: 'WORLD_SIM_CONFLICT' | 'WORLD_SIM_PROTOCOL_INVALID' | 'WORLD_SIM_STALE',
  message: string,
  details?: Record<string, unknown>,
): never {
  throw new WorldSimulationValidationError_ACU(
    createWorldSimError_ACU(code, 'persist', message, false, details),
  );
}

function normalizeNewlines_ACU(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** Hashes exact AI body semantics: line endings normalize, whitespace does not. */
export function hashWorldSimulationBody_ACU(text: string): string {
  const normalized = normalizeNewlines_ACU(text);
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${normalized.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

function messageKey_ACU(message: Record<string, any>, messageIndex: number): string {
  const id = message.message_id;
  if (typeof id === 'string' && id.trim()) return `string:${id}`;
  if (typeof id === 'number' && Number.isInteger(id) && id >= 0) return `number:${id}`;
  return `index:${messageIndex}`;
}

function isAiMessage_ACU(message: Record<string, any>): boolean {
  return message.is_user !== true && message?.extra?.type !== 'narrator';
}

function activeSwipeIndex_ACU(message: Record<string, any>): number {
  if (!Array.isArray(message.swipes)) {
    if (message.swipe_id === undefined || message.swipe_id === 0) return 0;
    return fail_ACU('WORLD_SIM_CONFLICT', '无 swipe 页的消息携带非法 active swipe', { swipeId: message.swipe_id });
  }
  if (!message.swipes.length || !message.swipes.every((item: unknown) => typeof item === 'string')) {
    return fail_ACU('WORLD_SIM_PROTOCOL_INVALID', '消息 swipe 页格式非法');
  }
  const swipeIndex = message.swipe_id === undefined ? (message.swipes.length === 1 ? 0 : -1) : message.swipe_id;
  if (!Number.isInteger(swipeIndex) || swipeIndex < 0 || swipeIndex >= message.swipes.length) {
    return fail_ACU('WORLD_SIM_CONFLICT', '当前 active swipe 不存在', { swipeId: message.swipe_id, swipeCount: message.swipes.length });
  }
  return swipeIndex;
}

/** Resolves exactly one active AI page without guessing inactive-swipe identity. */
export function resolveActiveWorldSimulationSwipe_ACU(messageIndex: number, rawMessage: unknown): ActiveWorldSimulationSwipe_ACU {
  if (!Number.isInteger(messageIndex) || messageIndex < 0 || !rawMessage || typeof rawMessage !== 'object' || Array.isArray(rawMessage)) {
    return fail_ACU('WORLD_SIM_PROTOCOL_INVALID', '世界推演目标消息或索引非法', { messageIndex });
  }
  const message = rawMessage as Record<string, any>;
  if (!isAiMessage_ACU(message) || typeof message.mes !== 'string') {
    return fail_ACU('WORLD_SIM_CONFLICT', '世界推演目标必须是当前 AI 正文楼层', { messageIndex });
  }
  const swipeIndex = activeSwipeIndex_ACU(message);
  const text = Array.isArray(message.swipes) ? message.swipes[swipeIndex] : message.mes;
  if (text !== message.mes) {
    return fail_ACU('WORLD_SIM_CONFLICT', '当前 AI 正文与 active swipe 页不一致', { messageIndex, swipeIndex });
  }
  return {
    message,
    text,
    identity: { messageIndex, messageKey: messageKey_ACU(message, messageIndex), swipeIndex, baseTextHash: hashWorldSimulationBody_ACU(text) },
  };
}

export function sameWorldSimulationSwipeIdentity_ACU(
  left: WorldSimulationSwipeIdentity_ACU,
  right: WorldSimulationSwipeIdentity_ACU,
): boolean {
  return left.messageIndex === right.messageIndex
    && left.messageKey === right.messageKey
    && left.swipeIndex === right.swipeIndex
    && left.baseTextHash === right.baseTextHash;
}

function cloneIsolationData_ACU(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return fail_ACU('WORLD_SIM_CONFLICT', '世界推演无法快照隔离数据用于回滚');
  }
}

/** Captures the active page before a later joint ledger/projection commit. */
export function captureWorldSimulationSwipeSnapshot_ACU(
  messageIndex: number,
  rawMessage: unknown,
): WorldSimulationSwipeSnapshot_ACU {
  const active = resolveActiveWorldSimulationSwipe_ACU(messageIndex, rawMessage);
  const hadIsolatedData = Object.prototype.hasOwnProperty.call(active.message, 'TavernDB_ACU_IsolatedData');
  return {
    message: active.message,
    identity: active.identity,
    mes: active.text,
    activeSwipeText: Array.isArray(active.message.swipes) ? active.text : null,
    hadIsolatedData,
    isolatedData: hadIsolatedData ? cloneIsolationData_ACU(active.message.TavernDB_ACU_IsolatedData) : undefined,
  };
}

/** Verifies that no content or active-page change has invalidated a captured target. */
export function assertCurrentWorldSimulationSwipe_ACU(snapshot: WorldSimulationSwipeSnapshot_ACU): ActiveWorldSimulationSwipe_ACU {
  const active = resolveActiveWorldSimulationSwipe_ACU(snapshot.identity.messageIndex, snapshot.message);
  if (!sameWorldSimulationSwipeIdentity_ACU(active.identity, snapshot.identity)) {
    return fail_ACU('WORLD_SIM_STALE', '世界推演目标 swipe 或正文基底已变化');
  }
  return active;
}

/** Updates only the active message page in memory; persistence belongs to the joint commit. */
export function writeWorldSimulationSwipeText_ACU(snapshot: WorldSimulationSwipeSnapshot_ACU, nextText: unknown): void {
  if (typeof nextText !== 'string') fail_ACU('WORLD_SIM_PROTOCOL_INVALID', '世界推演目标正文必须是字符串');
  const active = assertCurrentWorldSimulationSwipe_ACU(snapshot);
  active.message.mes = nextText;
  if (Array.isArray(active.message.swipes)) active.message.swipes[active.identity.swipeIndex] = nextText;
}

/** Restores only the active body and isolation field captured before the local commit attempt. */
export function restoreWorldSimulationSwipeSnapshot_ACU(snapshot: WorldSimulationSwipeSnapshot_ACU): void {
  snapshot.message.mes = snapshot.mes;
  if (snapshot.activeSwipeText !== null && Array.isArray(snapshot.message.swipes)) {
    snapshot.message.swipes[snapshot.identity.swipeIndex] = snapshot.activeSwipeText;
  }
  if (snapshot.hadIsolatedData) snapshot.message.TavernDB_ACU_IsolatedData = cloneIsolationData_ACU(snapshot.isolatedData);
  else delete snapshot.message.TavernDB_ACU_IsolatedData;
}
