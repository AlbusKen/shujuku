import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDefaultWorldSimulationSettings_ACU, WORLD_SIMULATION_MAX_JOIN_WAIT_MS_ACU } from '../../../src/service/simulation/defaults';
import { settings_ACU, _set_settings_ACU } from '../../../src/service/runtime/state-manager';
import {
  isWorldSimulationSettings_ACU,
  normalizeWorldSimulationSettings_ACU,
  readWorldSimulationSettings_ACU,
  setWorldSimulationSettingsPersistence_ACU,
  writeWorldSimulationSettings_ACU,
} from '../../../src/service/simulation/simulation-settings';

function enabled() {
  return { ...buildDefaultWorldSimulationSettings_ACU(), enabled: true };
}

let persist: ReturnType<typeof vi.fn>;

beforeEach(() => {
  _set_settings_ACU({} as any);
  persist = vi.fn();
  setWorldSimulationSettingsPersistence_ACU(persist);
});

describe('world simulation settings validation', () => {
  it('accepts the complete default shape and both joinWaitMs bounds', () => {
    expect(isWorldSimulationSettings_ACU(buildDefaultWorldSimulationSettings_ACU())).toBe(true);
    expect(isWorldSimulationSettings_ACU({ ...enabled(), joinWaitMs: 0 })).toBe(true);
    expect(isWorldSimulationSettings_ACU({ ...enabled(), joinWaitMs: WORLD_SIMULATION_MAX_JOIN_WAIT_MS_ACU })).toBe(true);
    expect(isWorldSimulationSettings_ACU(null)).toBe(false);
    expect(isWorldSimulationSettings_ACU([])).toBe(false);
  });

  it('rejects out-of-range or mistyped known fields instead of coercing them', () => {
    expect(isWorldSimulationSettings_ACU({ ...enabled(), joinWaitMs: -1 })).toBe(false);
    expect(isWorldSimulationSettings_ACU({ ...enabled(), joinWaitMs: WORLD_SIMULATION_MAX_JOIN_WAIT_MS_ACU + 1 })).toBe(false);
    expect(isWorldSimulationSettings_ACU({ ...enabled(), joinWaitMs: 1.5 })).toBe(false);
    expect(isWorldSimulationSettings_ACU({ ...enabled(), enabled: 'yes' })).toBe(false);
    expect(isWorldSimulationSettings_ACU({ ...enabled(), visibilityPolicy: 'sometimes' })).toBe(false);
    expect(isWorldSimulationSettings_ACU({ ...enabled(), showHiddenInUi: 'true' })).toBe(false);
    expect(isWorldSimulationSettings_ACU({ ...enabled(), minFloorGap: 0 })).toBe(false);
    expect(isWorldSimulationSettings_ACU({ ...enabled(), budgets: { light: { maxIterations: 0, maxDelegations: 0, maxReads: 0, readTokenBudget: 'low' } } })).toBe(false);
    expect(isWorldSimulationSettings_ACU({ ...enabled(), unknownField: true })).toBe(false);
    expect(isWorldSimulationSettings_ACU({ ...enabled(), budgets: { ...enabled().budgets, extra: enabled().budgets.light } })).toBe(false);
    expect(isWorldSimulationSettings_ACU({ ...enabled(), budgets: { ...enabled().budgets, light: { ...enabled().budgets.light, unexpected: 1 } } })).toBe(false);
  });
});

describe('world simulation settings read/write', () => {
  it('reads nothing when the persisted field is absent or malformed', () => {
    expect(readWorldSimulationSettings_ACU()).toBeNull();
    _set_settings_ACU({ worldSimulation: 42 } as any);
    expect(readWorldSimulationSettings_ACU()).toBeNull();
    _set_settings_ACU({ worldSimulation: { enabled: true, joinWaitMs: 99_999 } } as any);
    // A present-but-out-of-range value is invalid, not "old data": the feature stays off.
    expect(readWorldSimulationSettings_ACU()).toBeNull();
  });

  it('normalizes partial legacy data in memory and reports it as an upgrade', () => {
    const result = normalizeWorldSimulationSettings_ACU({ enabled: true, joinWaitMs: 1_000 });
    expect(result?.upgraded).toBe(true);
    expect(result?.settings).toEqual({ ...buildDefaultWorldSimulationSettings_ACU(), enabled: true, joinWaitMs: 1_000 });
    _set_settings_ACU({ worldSimulation: { enabled: true } } as any);
    expect(readWorldSimulationSettings_ACU()?.joinWaitMs).toBe(buildDefaultWorldSimulationSettings_ACU().joinWaitMs);
  });

  it('does not mark complete data as upgraded and rejects an empty object', () => {
    expect(normalizeWorldSimulationSettings_ACU(enabled())?.upgraded).toBe(false);
    expect(normalizeWorldSimulationSettings_ACU({})).toBeNull();
    expect(normalizeWorldSimulationSettings_ACU({ unknownField: 1 })).toBeNull();
    expect(normalizeWorldSimulationSettings_ACU({ ...enabled(), unknownField: 1 })).toBeNull();
    expect(normalizeWorldSimulationSettings_ACU({ ...enabled(), budgets: { ...enabled().budgets, light: { ...enabled().budgets.light, unexpected: 1 } } })).toBeNull();
  });

  it('deeply upgrades missing legacy budget fields in memory, but rejects invalid fields that are present', () => {
    const legacy = normalizeWorldSimulationSettings_ACU({
      enabled: true,
      budgets: { light: { maxIterations: 2 }, deep: { readTokenBudget: 'low' } },
    });
    expect(legacy).toMatchObject({ upgraded: true, settings: { enabled: true } });
    expect(legacy?.settings.budgets.light).toEqual({ ...buildDefaultWorldSimulationSettings_ACU().budgets.light, maxIterations: 2 });
    expect(legacy?.settings.budgets.normal).toEqual(buildDefaultWorldSimulationSettings_ACU().budgets.normal);
    expect(legacy?.settings.budgets.deep).toEqual({ ...buildDefaultWorldSimulationSettings_ACU().budgets.deep, readTokenBudget: 'low' });
    expect(normalizeWorldSimulationSettings_ACU({ enabled: true, budgets: { light: { maxIterations: 0 } } })).toBeNull();
  });

  it('writes through to the shared settings store and reads the value back', () => {
    expect(writeWorldSimulationSettings_ACU(enabled())).toEqual({ ok: true, upgraded: false });
    expect((settings_ACU as any).worldSimulation).toEqual(enabled());
    expect(readWorldSimulationSettings_ACU()).toEqual(enabled());
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('refuses to persist an invalid value, leaves the store untouched, and never saves', () => {
    writeWorldSimulationSettings_ACU(enabled());
    persist.mockClear();
    const before = (settings_ACU as any).worldSimulation;
    expect(writeWorldSimulationSettings_ACU({ ...enabled(), joinWaitMs: -1 })).toEqual({ ok: false, reason: 'invalid' });
    expect((settings_ACU as any).worldSimulation).toBe(before);
    expect(persist).not.toHaveBeenCalled();
  });

  it('round-trips a full custom budget set', () => {
    const custom = {
      ...enabled(),
      budgets: {
        light: { maxIterations: 2, maxDelegations: 0, maxReads: 1, readTokenBudget: 'low' as const },
        normal: { maxIterations: 4, maxDelegations: 1, maxReads: 8, readTokenBudget: 'high' as const },
        deep: { maxIterations: 9, maxDelegations: 3, maxReads: 20, readTokenBudget: 'high' as const },
      },
    };
    expect(writeWorldSimulationSettings_ACU(custom)).toEqual({ ok: true, upgraded: false });
    expect(readWorldSimulationSettings_ACU()).toEqual(custom);
  });
});
