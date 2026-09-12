/**
 * Self-emit guard for the world-simulation joint commit.
 *
 * A successful joint commit emits `MESSAGE_UPDATED` so the host repaints the message. That same
 * event is also the signal used to invalidate an in-flight candidate after a *user* edit. The host
 * attaches no origin to the event, so without a guard the commit would immediately invalidate the
 * very candidate it just settled, and the next AI floor would start a fresh main flight over an
 * unchanged branch.
 *
 * The committing side therefore owns a token: it is recorded before `emit` fires and consumed
 * exactly once by the listener. A single consumption matters because one user edit must still be
 * able to invalidate after any number of system repaints, and vice versa.
 */
const SELF_EMIT_TTL_MS_ACU = 5_000;

/** One pending system repaint per message index; the TTL bounds an emit that is never observed. */
const pendingSelfEmits_ACU = new Map<number, number>();

function purgeExpiredSelfEmits_ACU(now = Date.now()): void {
  for (const [messageIndex, expiresAt] of pendingSelfEmits_ACU) {
    if (expiresAt <= now) pendingSelfEmits_ACU.delete(messageIndex);
  }
}

/** Records that the next `MESSAGE_UPDATED` for this floor is system-owned, not a user edit. */
export function markWorldSimulationProjectionEmit_ACU(messageIndex: number): void {
  if (!Number.isInteger(messageIndex) || messageIndex < 0) return;
  purgeExpiredSelfEmits_ACU();
  pendingSelfEmits_ACU.set(messageIndex, Date.now() + SELF_EMIT_TTL_MS_ACU);
}

/**
 * Consumes one system-owned repaint token. `true` means this event came from our own joint commit
 * and must not invalidate the in-flight candidate; `false` means the event is user-originated.
 */
export function consumeWorldSimulationProjectionEmit_ACU(messageIndex: unknown): boolean {
  const index = typeof messageIndex === 'number' ? messageIndex : NaN;
  if (!Number.isInteger(index) || index < 0) return false;
  purgeExpiredSelfEmits_ACU();
  if (!pendingSelfEmits_ACU.has(index)) return false;
  pendingSelfEmits_ACU.delete(index);
  return true;
}

export function resetWorldSimulationCommitGuardForTests_ACU(): void {
  pendingSelfEmits_ACU.clear();
}
