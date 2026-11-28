import { describe, expect, it } from 'vitest';
import { isIncompleteInitialZeroLayerAutoActivation_ACU } from '../../../src/presentation/bootstrap/zero-layer-bootstrap';
import type { ZeroLayerEnvelope_ACU } from '../../../src/service/zero-layer/model';

function makeEnvelope(overrides: Partial<ZeroLayerEnvelope_ACU> = {}, bridgePhase?: string): ZeroLayerEnvelope_ACU {
  const branchId = 'branch-1';
  return {
    schemaVersion: 1,
    sessionId: 'sess-1',
    scope: { chatId: 'chat-new-1', characterKey: 'char:末日求生卡.png' },
    carrierId: 'carrier-1',
    carrierSwipeId: 0,
    seedBody: '<start>开场白</start>',
    activationFingerprint: 'sha256:abc',
    activationMessageCount: 1,
    enabled: false,
    apiPresetName: 'Minimax',
    revision: 5,
    activeBranchId: branchId,
    branches: [{
      branchId,
      headTurnId: null,
      ...(bridgePhase ? { bridge: { phase: bridgePhase } as any } : {}),
    }],
    turns: [],
    ...overrides,
  };
}

describe('isIncompleteInitialZeroLayerAutoActivation_ACU', () => {
  it('returns true when initial bridge activation was interrupted at activated (rev 5, enabled:false, 0 turns)', () => {
    expect(isIncompleteInitialZeroLayerAutoActivation_ACU(makeEnvelope({ enabled: false, revision: 5 }, 'activated'))).toBe(true);
    expect(isIncompleteInitialZeroLayerAutoActivation_ACU(makeEnvelope({ enabled: false, revision: 0 }, undefined))).toBe(true);
    expect(isIncompleteInitialZeroLayerAutoActivation_ACU(makeEnvelope({ enabled: false, revision: 6 }, 'reconciled'))).toBe(true);
  });

  it('returns false when already enabled, manually disabled after activation (rev >= 8), has turns, or has exitManifest', () => {
    expect(isIncompleteInitialZeroLayerAutoActivation_ACU(makeEnvelope({ enabled: true, revision: 7 }, 'reconciled'))).toBe(false);
    expect(isIncompleteInitialZeroLayerAutoActivation_ACU(makeEnvelope({ enabled: false, revision: 8 }, 'reconciled'))).toBe(false);
    expect(isIncompleteInitialZeroLayerAutoActivation_ACU(makeEnvelope({ enabled: false, revision: 5, turns: [{} as any] }, 'activated'))).toBe(false);
    expect(isIncompleteInitialZeroLayerAutoActivation_ACU(makeEnvelope({ enabled: false, revision: 5, exitManifest: { phase: 'prepared' } as any }, 'activated'))).toBe(false);
    expect(isIncompleteInitialZeroLayerAutoActivation_ACU(null)).toBe(false);
  });
});
