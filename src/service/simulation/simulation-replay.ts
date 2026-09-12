import { readIsolatedDataContainer_ACU } from '../../data/repositories/chat-message-data-repo';
import {
  createWorldSimError_ACU,
  WORLD_SIMULATION_FIELD_ACU,
  WorldSimulationValidationError_ACU,
  type WorldSimulationLedgerRecord_ACU,
  type WorldStateDelta_ACU,
  type WorldStateSnapshot_ACU,
} from './model';
import { parseLegacyWorldSimulationLedgerRecord_ACU, parseWorldSimulationPerSwipeEnvelope_ACU } from './simulation-schema';
import { parseWorldSimulationProjection_ACU } from './simulation-projection';
import { resolveActiveWorldSimulationSwipe_ACU } from './simulation-swipe';

export interface WorldSimulationReplay_ACU {
  state: WorldStateSnapshot_ACU;
  checkpointMessageIndex: number;
  checkpointId: string;
  deltaMessageIndices: number[];
  digest: string;
  branchReparsed: boolean;
}

function failRead_ACU(message: string, details?: Record<string, unknown>): never {
  throw new WorldSimulationValidationError_ACU(createWorldSimError_ACU('WORLD_SIM_READ_FAILED', 'replay', message, false, details));
}

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function integer_ACU(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function clone_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Parses one persisted record without permitting malformed history to look empty. */
export function parseWorldSimulationLedgerRecord_ACU(raw: unknown, messageIndex: number): WorldSimulationLedgerRecord_ACU {
  const parsed = parseLegacyWorldSimulationLedgerRecord_ACU(raw);
  if (parsed) return clone_ACU(parsed);
  return failRead_ACU('世界推演账本记录类型或载荷非法', {
    messageIndex,
    ...(isRecord_ACU(raw) ? { kind: raw.kind } : {}),
  });
}

/** Applies a complete module delta to a cloned state and rejects revision regressions. */
export function applyWorldSimulationDelta_ACU(state: WorldStateSnapshot_ACU, delta: WorldStateDelta_ACU): WorldStateSnapshot_ACU {
  if (delta.anchorMessageIndex < state.anchorMessageIndex) {
    return failRead_ACU('世界推演 delta 锚点倒退', { previous: state.anchorMessageIndex, next: delta.anchorMessageIndex });
  }
  for (const key of ['entities', 'events', 'threads'] as const) {
    if (delta.revisions[key] < state.revisions[key]) {
      return failRead_ACU('世界推演模块 revision 倒退', { module: key, previous: state.revisions[key], next: delta.revisions[key] });
    }
  }
  return {
    anchorMessageIndex: delta.anchorMessageIndex,
    storyClock: clone_ACU(delta.storyClock),
    entities: delta.entities === undefined ? clone_ACU(state.entities) : clone_ACU(delta.entities),
    events: delta.events === undefined ? clone_ACU(state.events) : clone_ACU(delta.events),
    threads: delta.threads === undefined ? clone_ACU(state.threads) : clone_ACU(delta.threads),
    revisions: clone_ACU(delta.revisions),
  };
}

type SelectedLedgerRecord_ACU = {
  record: WorldSimulationLedgerRecord_ACU;
  parentReplayDigest: string | null | undefined;
} | {
  branchMismatch: true;
};

function recordAt_ACU(message: any, isolationKey: string, index: number): SelectedLedgerRecord_ACU | null {
  const rawContainer = message?.TavernDB_ACU_IsolatedData;
  const container = readIsolatedDataContainer_ACU(message);
  if (rawContainer !== undefined && !container) return failRead_ACU('隔离数据容器无法读取', { messageIndex: index });
  if (!container || !Object.prototype.hasOwnProperty.call(container, isolationKey)) return null;
  const slot = container[isolationKey];
  if (!isRecord_ACU(slot)) return failRead_ACU('隔离数据槽格式非法', { messageIndex: index, isolationKey });
  if (!Object.prototype.hasOwnProperty.call(slot, WORLD_SIMULATION_FIELD_ACU)) return null;
  const raw = (slot as any)[WORLD_SIMULATION_FIELD_ACU];
  if (isRecord_ACU(raw) && raw.version === 2) {
    const envelope = parseWorldSimulationPerSwipeEnvelope_ACU(raw);
    if (!envelope) return failRead_ACU('per-swipe 世界推演账本格式非法', { messageIndex: index });
    let active;
    try {
      active = resolveActiveWorldSimulationSwipe_ACU(index, message);
    } catch (_) {
      return { branchMismatch: true };
    }
    const entry = envelope.entries.find(candidate => (
      candidate.swipe.messageIndex === active.identity.messageIndex
      && candidate.swipe.messageKey === active.identity.messageKey
      && candidate.swipe.swipeIndex === active.identity.swipeIndex
    ));
    if (!entry) return null;
    if (entry.projection === null) {
      if (parseWorldSimulationProjection_ACU(active.text) || active.identity.baseTextHash !== entry.swipe.baseTextHash) {
        return { branchMismatch: true };
      }
      return { record: entry.record, parentReplayDigest: entry.parentReplayDigest };
    }
    const projection = parseWorldSimulationProjection_ACU(active.text);
    if (!projection || projection.baseTextHash !== entry.swipe.baseTextHash
      || projection.blockHash !== entry.projection.blockHash
      || projection.baseTextHash !== entry.projection.baseTextHash) return { branchMismatch: true };
    return { record: entry.record, parentReplayDigest: entry.parentReplayDigest };
  }
  const record = parseWorldSimulationLedgerRecord_ACU(raw, index);
  // The persisted anchor is an identity guard. A shifted suffix belongs to the
  // discarded branch after deletion/swipe and must not be replayed on the new one.
  return record.anchorMessageIndex === index ? { record, parentReplayDigest: undefined } : null;
}

function fingerprintRecordId_ACU(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Replay digest deliberately includes only stable record identity and placement, never story text. */
export function buildWorldSimulationReplayDigest_ACU(
  checkpointMessageIndex: number,
  checkpointId: string,
  deltaRecords: readonly Pick<WorldSimulationLedgerRecord_ACU, 'id' | 'anchorMessageIndex'>[],
): string {
  return `checkpoint:${checkpointMessageIndex}:${fingerprintRecordId_ACU(checkpointId)}|deltas:${deltaRecords.map(record => `${record.anchorMessageIndex}:${fingerprintRecordId_ACU(record.id)}`).join(',')}`;
}

/** Replays records present at or before maxMessageIndex. A missing ledger is distinct from malformed history. */
export function replayWorldSimulationFromChat_ACU(
  chat: any[],
  isolationKey: string,
  maxMessageIndex = Array.isArray(chat) ? chat.length - 1 : -1,
): WorldSimulationReplay_ACU | null {
  if (!Array.isArray(chat)) return failRead_ACU('当前聊天不是消息数组');
  if (!Number.isInteger(maxMessageIndex) || maxMessageIndex < -1) return failRead_ACU('回放边界非法', { maxMessageIndex });
  const boundary = Math.min(maxMessageIndex, chat.length - 1);
  let checkpoint: Extract<WorldSimulationLedgerRecord_ACU, { kind: 'checkpoint' }> | null = null;
  let checkpointMessageIndex = -1;
  let state: WorldStateSnapshot_ACU | null = null;
  const deltas: WorldSimulationLedgerRecord_ACU[] = [];
  const deltaMessageIndices: number[] = [];
  let foundRecord = false;
  let branchReparsed = false;
  for (let index = 0; index <= boundary; index += 1) {
    const record = recordAt_ACU(chat[index], isolationKey, index);
    if (!record) continue;
    if ('branchMismatch' in record) {
      branchReparsed = true;
      break;
    }
    foundRecord = true;
    const prefixDigest = checkpoint
      ? buildWorldSimulationReplayDigest_ACU(checkpointMessageIndex, checkpoint.id, deltas)
      : null;
    if (record.parentReplayDigest !== undefined && record.parentReplayDigest !== prefixDigest) {
      branchReparsed = true;
      break;
    }
    if (record.record.kind === 'checkpoint') {
      checkpoint = record.record;
      checkpointMessageIndex = index;
      state = { ...clone_ACU(record.record.state), anchorMessageIndex: index };
      deltas.length = 0;
      deltaMessageIndices.length = 0;
      continue;
    }
    if (!state || !checkpoint) return failRead_ACU('世界推演历史缺少 checkpoint 基底', { maxMessageIndex: boundary, messageIndex: index });
    state = applyWorldSimulationDelta_ACU(state, { ...record.record.delta, anchorMessageIndex: index });
    deltas.push(record.record);
    deltaMessageIndices.push(index);
  }
  if (!foundRecord) return null;
  if (!checkpoint || !state) return failRead_ACU('世界推演历史缺少 checkpoint 基底', { maxMessageIndex: boundary });
  return {
    state,
    checkpointMessageIndex,
    checkpointId: checkpoint.id,
    deltaMessageIndices,
    digest: buildWorldSimulationReplayDigest_ACU(checkpointMessageIndex, checkpoint.id, deltas),
    branchReparsed,
  };
}

/** Counts ledger deltas since the active checkpoint without exposing their story payload. */
export function countWorldSimulationDeltasSinceCheckpoint_ACU(replay: WorldSimulationReplay_ACU | null): number {
  return replay?.deltaMessageIndices.length ?? 0;
}