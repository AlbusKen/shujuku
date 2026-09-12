import { createWorldSimError_ACU, WorldSimulationValidationError_ACU } from './model';

/** Provenance of one world-simulation-owned internal main-API generation. */
export interface WorldSimulationInternalAiRequestIdentity_ACU {
  requestId: string;
  chatIdentity: string;
  source: string;
}

interface InternalRequestRecord_ACU {
  identity: WorldSimulationInternalAiRequestIdentity_ACU;
  mainApiInvocationActive: boolean;
  /** True once this request really entered the direct main-API transport. */
  enteredMainApi: boolean;
  generationSeq: number | null;
  expiresAt: number;
}

const INTERNAL_REQUEST_TTL_MS_ACU = 60_000;
const requestsById_ACU = new Map<string, InternalRequestRecord_ACU>();

function fail_ACU(message: string, details?: Record<string, unknown>): never {
  throw new WorldSimulationValidationError_ACU(createWorldSimError_ACU('WORLD_SIM_PROTOCOL_INVALID', 'protocol', message, false, details));
}

function purgeExpiredRequests_ACU(now = Date.now()): void {
  for (const [requestId, record] of requestsById_ACU) {
    if (record.expiresAt <= now) requestsById_ACU.delete(requestId);
  }
}

/**
 * World-simulation-owned twin of the continuation registry. It is deliberately a
 * separate module: the host omits request ids, so attribution must never be
 * shared across two independent background callers.
 */
export function beginWorldSimulationInternalAiRequest_ACU(identity: WorldSimulationInternalAiRequestIdentity_ACU): void {
  purgeExpiredRequests_ACU();
  if (!identity || typeof identity.requestId !== 'string' || !identity.requestId.trim()
    || typeof identity.chatIdentity !== 'string' || !identity.chatIdentity.trim()
    || typeof identity.source !== 'string' || !identity.source.trim()) {
    fail_ACU('世界推演内部 AI 请求身份非法');
  }
  if (requestsById_ACU.has(identity.requestId)) fail_ACU('重复的世界推演内部请求 ID', { requestId: identity.requestId });
  requestsById_ACU.set(identity.requestId, { identity, mainApiInvocationActive: false, enteredMainApi: false, generationSeq: null, expiresAt: Date.now() + INTERNAL_REQUEST_TTL_MS_ACU });
}

/** Opens the synchronous attribution window around the direct main-API call. */
export function beginWorldSimulationInternalAiMainApiInvocation_ACU(requestId: string): void {
  const record = requestsById_ACU.get(requestId);
  if (!record) return;
  record.mainApiInvocationActive = true;
  record.enteredMainApi = true;
  record.expiresAt = Date.now() + INTERNAL_REQUEST_TTL_MS_ACU;
}

export function endWorldSimulationInternalAiMainApiInvocation_ACU(requestId: string): void {
  const record = requestsById_ACU.get(requestId);
  if (record) record.mainApiInvocationActive = false;
}

/**
 * A request that never entered the main-API transport cannot produce a host generation event, so
 * its record is dropped immediately. One that did enter the transport but never got a synchronously
 * bound sequence may still deliver a late `GENERATION_ENDED`; its record stays for one TTL so the
 * fail-closed guard can recognise that event instead of mistaking it for a user floor.
 */
export function settleWorldSimulationInternalAiRequest_ACU(requestId: string): void {
  const record = requestsById_ACU.get(requestId);
  if (!record) return;
  record.mainApiInvocationActive = false;
  if (record.generationSeq === null && !record.enteredMainApi) {
    requestsById_ACU.delete(requestId);
    return;
  }
  record.expiresAt = Date.now() + INTERNAL_REQUEST_TTL_MS_ACU;
}

export function cancelWorldSimulationInternalAiRequest_ACU(requestId: string): void {
  requestsById_ACU.delete(requestId);
}

/** Only a unique synchronously-active request may claim one host start sequence. */
export function bindWorldSimulationInternalAiGenerationStarted_ACU(generationSeq: number): WorldSimulationInternalAiRequestIdentity_ACU | null {
  purgeExpiredRequests_ACU();
  const candidates = [...requestsById_ACU.values()].filter(record => record.mainApiInvocationActive && record.generationSeq === null);
  if (candidates.length !== 1) return null;
  const record = candidates[0];
  record.generationSeq = generationSeq;
  record.expiresAt = Date.now() + INTERNAL_REQUEST_TTL_MS_ACU;
  return record.identity;
}

export function consumeWorldSimulationInternalAiGenerationEnded_ACU(generationSeq: number | undefined): WorldSimulationInternalAiRequestIdentity_ACU | null {
  if (generationSeq === undefined) return null;
  purgeExpiredRequests_ACU();
  const match = [...requestsById_ACU.values()].find(record => record.generationSeq === generationSeq);
  if (!match) return null;
  requestsById_ACU.delete(match.identity.requestId);
  return match.identity;
}

/**
 * Fail-closed backstop for host events that cannot be attributed. While any world-sim internal
 * request is inside its main-API window, an unattributable `GENERATION_ENDED` must not be treated
 * as an ordinary new AI floor: doing so would let world-sim feed its own internal call back into
 * `onAiFloorCompleted` and trigger itself in a loop.
 */
export function hasActiveWorldSimulationInternalAiMainApiInvocation_ACU(): boolean {
  purgeExpiredRequests_ACU();
  for (const record of requestsById_ACU.values()) {
    if (record.mainApiInvocationActive) return true;
  }
  return false;
}

/**
 * Consumes one host generation event that cannot be attributed by sequence while a world-sim
 * internal request is still awaiting its own lifecycle end. `afterMainApiCall` closes the
 * synchronous window as soon as `generateRaw` hands back its promise, so the window guard alone
 * leaves a hole from that point until `GENERATION_ENDED` arrives. Treating such an event as an
 * ordinary user floor would let world-sim feed its own internal call back into
 * `onAiFloorCompleted`. The record is consumed here so at most one event per unresolved request is
 * dropped, and the TTL bounds the damage if the host never sends one.
 */
export function consumeUnattributedWorldSimulationInternalAiEnded_ACU(): WorldSimulationInternalAiRequestIdentity_ACU | null {
  purgeExpiredRequests_ACU();
  for (const [requestId, record] of requestsById_ACU) {
    if (record.generationSeq !== null || !record.enteredMainApi) continue;
    requestsById_ACU.delete(requestId);
    return record.identity;
  }
  return null;
}

/**
 * Drops every entered-but-unbound claim after a host generation was stopped. A stopped generation
 * never delivers `GENERATION_ENDED`, so without this its record would linger for one TTL and could
 * swallow exactly one unrelated user floor. Returns how many claims were discarded.
 */
export function discardUnattributedWorldSimulationInternalAiRequests_ACU(): number {
  purgeExpiredRequests_ACU();
  let discarded = 0;
  for (const [requestId, record] of requestsById_ACU) {
    if (record.generationSeq !== null || !record.enteredMainApi) continue;
    requestsById_ACU.delete(requestId);
    discarded += 1;
  }
  return discarded;
}

export function resetWorldSimulationInternalAiEventRegistryForTests_ACU(): void {
  requestsById_ACU.clear();
}
