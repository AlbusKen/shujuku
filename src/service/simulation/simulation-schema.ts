import {
  WORLD_SIMULATION_LEGACY_SCHEMA_VERSION_ACU,
  WORLD_SIMULATION_SCHEMA_VERSION_ACU,
  isWorldEntity_ACU,
  isWorldEvent_ACU,
  isWorldStateSnapshot_ACU,
  isWorldStableId_ACU,
  isWorldStoryClock_ACU,
  isWorldThread_ACU,
  isWorldModuleRevisions_ACU,
  type WorldSimulationLedgerRecord_ACU,
  type WorldSimulationPerSwipeEnvelope_ACU,
  type WorldSimulationPersistedValue_ACU,
  type WorldStateDelta_ACU,
  type WorldStateSnapshot_ACU,
} from './model';

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function integer_ACU(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function clone_ACU<T>(value: T): T | null {
  try { return JSON.parse(JSON.stringify(value)) as T; } catch (_) { return null; }
}

function normalizeLegacyThreads_ACU(value: unknown): unknown {
  const cloned = clone_ACU(value);
  if (!isRecord_ACU(cloned) || !Array.isArray(cloned.threads)) return cloned;
  cloned.threads = cloned.threads.map(thread => (
    isRecord_ACU(thread) && thread.visibility === undefined
      ? { ...thread, visibility: { mode: 'hidden' } }
      : thread
  ));
  return cloned;
}

/** Normalizes only missing legacy thread visibility in memory, never on the source record. */
export function normalizeLegacyWorldStateSnapshot_ACU(value: unknown): WorldStateSnapshot_ACU | null {
  const normalized = normalizeLegacyThreads_ACU(value);
  return isWorldStateSnapshot_ACU(normalized) ? normalized : null;
}

function isStrictWorldStateDelta_ACU(value: unknown): value is WorldStateDelta_ACU {
  return isRecord_ACU(value) && integer_ACU(value.anchorMessageIndex)
    && isWorldStoryClock_ACU(value.storyClock) && isWorldModuleRevisions_ACU(value.revisions)
    && (value.entities === undefined || (Array.isArray(value.entities) && value.entities.every(isWorldEntity_ACU)))
    && (value.events === undefined || (Array.isArray(value.events) && value.events.every(isWorldEvent_ACU)))
    && (value.threads === undefined || (Array.isArray(value.threads) && value.threads.every(isWorldThread_ACU)));
}

export function normalizeLegacyWorldStateDelta_ACU(value: unknown): WorldStateDelta_ACU | null {
  const normalized = normalizeLegacyThreads_ACU(value);
  return isStrictWorldStateDelta_ACU(normalized) ? normalized : null;
}

function normalizedString_ACU(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0;
}

function exactKeys_ACU(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

/** Parses a v1 record while upgrading only legacy thread visibility in memory. */
export function parseLegacyWorldSimulationLedgerRecord_ACU(raw: unknown): WorldSimulationLedgerRecord_ACU | null {
  return parseV1WorldSimulationLedgerRecord_ACU(raw, true);
}

function parseV1WorldSimulationLedgerRecord_ACU(raw: unknown, normalizeLegacyThreads: boolean): WorldSimulationLedgerRecord_ACU | null {
  if (!isRecord_ACU(raw) || raw.version !== WORLD_SIMULATION_LEGACY_SCHEMA_VERSION_ACU
    || !normalizedString_ACU(raw.id) || !integer_ACU(raw.anchorMessageIndex)) return null;
  if (raw.kind === 'checkpoint') {
    const state = normalizeLegacyThreads
      ? normalizeLegacyWorldStateSnapshot_ACU(raw.state)
      : (isWorldStateSnapshot_ACU(raw.state) ? clone_ACU(raw.state) : null);
    return state && state.anchorMessageIndex === raw.anchorMessageIndex
      ? { version: WORLD_SIMULATION_LEGACY_SCHEMA_VERSION_ACU, kind: 'checkpoint', id: raw.id, anchorMessageIndex: raw.anchorMessageIndex, state }
      : null;
  }
  if (raw.kind === 'delta') {
    const delta = normalizeLegacyThreads
      ? normalizeLegacyWorldStateDelta_ACU(raw.delta)
      : (isStrictWorldStateDelta_ACU(raw.delta) ? clone_ACU(raw.delta) : null);
    return delta && delta.anchorMessageIndex === raw.anchorMessageIndex
      ? { version: WORLD_SIMULATION_LEGACY_SCHEMA_VERSION_ACU, kind: 'delta', id: raw.id, anchorMessageIndex: raw.anchorMessageIndex, delta }
      : null;
  }
  return null;
}

function parseProjection_ACU(value: unknown): { version: 1; blockHash: string; baseTextHash: string; publicEntryIds: string[] } | null {
  if (!isRecord_ACU(value) || !exactKeys_ACU(value, ['version', 'blockHash', 'baseTextHash', 'publicEntryIds'])
    || value.version !== 1 || !normalizedString_ACU(value.blockHash) || !normalizedString_ACU(value.baseTextHash)
    || !Array.isArray(value.publicEntryIds) || !value.publicEntryIds.every(isWorldStableId_ACU)) return null;
  if (new Set(value.publicEntryIds).size !== value.publicEntryIds.length) return null;
  return { version: 1, blockHash: value.blockHash, baseTextHash: value.baseTextHash, publicEntryIds: [...value.publicEntryIds] };
}

function parseSwipe_ACU(value: unknown): { messageIndex: number; messageKey: string; swipeIndex: number; baseTextHash: string } | null {
  if (!isRecord_ACU(value) || !exactKeys_ACU(value, ['messageIndex', 'messageKey', 'swipeIndex', 'baseTextHash'])
    || !integer_ACU(value.messageIndex) || !integer_ACU(value.swipeIndex)
    || !normalizedString_ACU(value.messageKey) || !normalizedString_ACU(value.baseTextHash)) return null;
  return { messageIndex: value.messageIndex, messageKey: value.messageKey, swipeIndex: value.swipeIndex, baseTextHash: value.baseTextHash };
}

/** Strict parser for the new per-swipe persisted envelope; it never normalizes v2 input. */
export function parseWorldSimulationPerSwipeEnvelope_ACU(raw: unknown): WorldSimulationPerSwipeEnvelope_ACU | null {
  if (!isRecord_ACU(raw) || !exactKeys_ACU(raw, ['version', 'kind', 'entries'])
    || raw.version !== WORLD_SIMULATION_SCHEMA_VERSION_ACU || raw.kind !== 'per_swipe'
    || !Array.isArray(raw.entries) || raw.entries.length === 0) return null;
  const entries: WorldSimulationPerSwipeEnvelope_ACU['entries'] = [];
  const identities = new Set<string>();
  for (const rawEntry of raw.entries) {
    if (!isRecord_ACU(rawEntry) || !exactKeys_ACU(rawEntry, [
      'swipe', 'parentReplayDigest', 'sourceAnchorMessageIndex', 'coverageStartMessageIndex', 'coverageEndMessageIndex', 'projection', 'record',
    ])) return null;
    const swipe = parseSwipe_ACU(rawEntry.swipe);
    const projection = rawEntry.projection === null ? null : parseProjection_ACU(rawEntry.projection);
    const record = parseV1WorldSimulationLedgerRecord_ACU(rawEntry.record, false);
    let parentReplayDigest: string | null;
    if (rawEntry.parentReplayDigest === null) {
      parentReplayDigest = null;
    } else if (normalizedString_ACU(rawEntry.parentReplayDigest)) {
      parentReplayDigest = rawEntry.parentReplayDigest;
    } else return null;
    if (!swipe || (rawEntry.projection !== null && !projection) || !record
      || !integer_ACU(rawEntry.sourceAnchorMessageIndex) || !integer_ACU(rawEntry.coverageStartMessageIndex) || !integer_ACU(rawEntry.coverageEndMessageIndex)
      || rawEntry.sourceAnchorMessageIndex > rawEntry.coverageStartMessageIndex
      || rawEntry.coverageStartMessageIndex > rawEntry.coverageEndMessageIndex
      || swipe.messageIndex !== rawEntry.coverageEndMessageIndex
      || record.anchorMessageIndex !== rawEntry.coverageEndMessageIndex
      || (projection !== null && swipe.baseTextHash !== projection.baseTextHash)) return null;
    const key = `${swipe.messageIndex}:${swipe.messageKey}:${swipe.swipeIndex}`;
    if (identities.has(key)) return null;
    identities.add(key);
    entries.push({
      swipe,
      parentReplayDigest,
      sourceAnchorMessageIndex: rawEntry.sourceAnchorMessageIndex,
      coverageStartMessageIndex: rawEntry.coverageStartMessageIndex,
      coverageEndMessageIndex: rawEntry.coverageEndMessageIndex,
      projection,
      record,
    });
  }
  return { version: WORLD_SIMULATION_SCHEMA_VERSION_ACU, kind: 'per_swipe', entries };
}

/** Parses a persisted value without allowing a malformed v1/v2 payload to look absent. */
export function parseWorldSimulationPersistedValue_ACU(raw: unknown): WorldSimulationPersistedValue_ACU | null {
  return parseLegacyWorldSimulationLedgerRecord_ACU(raw) ?? parseWorldSimulationPerSwipeEnvelope_ACU(raw);
}
