import { beforeEach, describe, expect, it } from 'vitest';
import {
  consumeWorldSimulationProjectionEmit_ACU,
  markWorldSimulationProjectionEmit_ACU,
  resetWorldSimulationCommitGuardForTests_ACU,
} from '../../../src/service/simulation/simulation-commit-guard';

beforeEach(() => {
  resetWorldSimulationCommitGuardForTests_ACU();
});

describe('world simulation commit guard', () => {
  it('consumes exactly one self-emit token per marked floor', () => {
    markWorldSimulationProjectionEmit_ACU(7);
    expect(consumeWorldSimulationProjectionEmit_ACU(7)).toBe(true);
    // One-time consumption: a user edit on the same floor must still invalidate afterwards.
    expect(consumeWorldSimulationProjectionEmit_ACU(7)).toBe(false);
  });

  it('does not let one floor token absorb an event for another floor', () => {
    markWorldSimulationProjectionEmit_ACU(7);
    expect(consumeWorldSimulationProjectionEmit_ACU(8)).toBe(false);
    expect(consumeWorldSimulationProjectionEmit_ACU(7)).toBe(true);
  });

  it('ignores malformed or negative indices in both directions', () => {
    markWorldSimulationProjectionEmit_ACU(-1);
    markWorldSimulationProjectionEmit_ACU(1.5);
    markWorldSimulationProjectionEmit_ACU(Number.NaN);
    expect(consumeWorldSimulationProjectionEmit_ACU(0)).toBe(false);
    expect(consumeWorldSimulationProjectionEmit_ACU(-1)).toBe(false);
    expect(consumeWorldSimulationProjectionEmit_ACU(undefined)).toBe(false);
    expect(consumeWorldSimulationProjectionEmit_ACU('7')).toBe(false);
    markWorldSimulationProjectionEmit_ACU(3);
    expect(consumeWorldSimulationProjectionEmit_ACU(3)).toBe(true);
  });

  it('expires an unobserved token instead of swallowing a much later user edit', () => {
    const realNow = Date.now;
    try {
      Date.now = () => 1_000;
      markWorldSimulationProjectionEmit_ACU(5);
      Date.now = () => 1_000 + 5_001;
      expect(consumeWorldSimulationProjectionEmit_ACU(5)).toBe(false);
    } finally {
      Date.now = realNow;
    }
  });
});
