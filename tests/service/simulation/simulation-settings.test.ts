import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDefaultWorldSimulationSettings_ACU, WORLD_SIMULATION_MAX_JOIN_WAIT_MS_ACU, WORLD_SIMULATION_PROMPT_FORCE_DEFAULT_VERSION_V4_ACU } from '../../../src/service/simulation/defaults';
import { settings_ACU, _set_settings_ACU } from '../../../src/service/runtime/state-manager';
import {
  isWorldSimulationSettings_ACU,
  normalizeWorldSimulationSettings_ACU,
  readWorldSimulationSettings_ACU,
  readWorldSimulationSettingsUpgrade_ACU,
  setWorldSimulationSettingsPersistence_ACU,
  writeWorldSimulationSettings_ACU,
  writeWorldSimulationSettingsStrict_ACU,
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
    expect(isWorldSimulationSettings_ACU({ ...enabled(), toolsEnabled: 'true' })).toBe(false);
    expect(isWorldSimulationSettings_ACU({ ...enabled(), minFloorGap: 0 })).toBe(false);
    expect(isWorldSimulationSettings_ACU({ ...enabled(), budgets: { light: { maxMasterModelTurns: 0, maxSpecialistModelTurns: 1, maxDelegations: 0, legacyReadCount: null, readTokenBudget: 'low' } } })).toBe(false);
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
      budgets: { light: { maxIterations: 2, maxReads: 7 }, deep: { readTokenBudget: 'low' } },
    });
    expect(legacy).toMatchObject({ upgraded: true, settings: { enabled: true } });
    expect(legacy?.settings.budgets.light).toEqual({ ...buildDefaultWorldSimulationSettings_ACU().budgets.light, maxMasterModelTurns: 2, legacyReadCount: 7 });
    expect(legacy?.settings.budgets.normal).toEqual(buildDefaultWorldSimulationSettings_ACU().budgets.normal);
    expect(legacy?.settings.budgets.deep).toEqual({ ...buildDefaultWorldSimulationSettings_ACU().budgets.deep, readTokenBudget: 'low' });
    expect(legacy?.settings.toolsEnabled).toBe(true);
    expect(normalizeWorldSimulationSettings_ACU({ enabled: true, budgets: { light: { maxIterations: 0 } } })).toBeNull();
  });

  it('treats shared-only budget fields as a partial new tier and rejects mixed exclusive shapes', () => {
    const defaults = buildDefaultWorldSimulationSettings_ACU();
    const sharedOnly = normalizeWorldSimulationSettings_ACU({
      enabled: true,
      budgets: { light: { maxDelegations: 3, readTokenBudget: 'low' } },
    });
    expect(sharedOnly).toMatchObject({ upgraded: true, settings: { enabled: true } });
    expect(sharedOnly?.settings.budgets.light).toEqual({
      ...defaults.budgets.light,
      maxDelegations: 3,
      readTokenBudget: 'low',
    });
    expect(normalizeWorldSimulationSettings_ACU({
      enabled: true,
      budgets: { light: { maxIterations: 2, maxSpecialistModelTurns: 2 } },
    })).toBeNull();
  });

  it('keeps legacy maxReads only as non-persisting compatibility metadata', () => {
    const legacy = {
      enabled: true,
      budgets: {
        light: { maxIterations: 2, maxDelegations: 1, maxReads: 99, readTokenBudget: 'low' },
        normal: { maxIterations: 3, maxDelegations: 2, maxReads: 88, readTokenBudget: 'medium' },
        deep: { maxIterations: 4, maxDelegations: 3, maxReads: 77, readTokenBudget: 'high' },
      },
    };
    _set_settings_ACU({ worldSimulation: legacy } as any);
    const upgrade = readWorldSimulationSettingsUpgrade_ACU();
    expect(upgrade?.settings.budgets.deep).toMatchObject({ maxMasterModelTurns: 4, maxSpecialistModelTurns: 4, legacyReadCount: 77 });
    expect((settings_ACU as any).worldSimulation).toBe(legacy);
  });

  it('migrates legacy prompts into v4 placeholders without writing, then persists only agentPrompts', async () => {
    const legacy = buildDefaultWorldSimulationSettings_ACU() as any;
    delete legacy.promptForceDefaultVersion;
    legacy.agentPrompts = {
      'world-director': [{ role: 'system', content: '旧主控规则：$USER_REQUEST', enabled: true, deletable: true }],
      'entity-movement': [{ role: 'user', content: '旧实体规则：$AGENT_NAME', enabled: true, deletable: true }],
      'faction-events': [{ role: 'user', content: '旧事件规则', enabled: true, deletable: true }],
      'thread-weaver': [{ role: 'assistant', content: '旧线索规则', enabled: true, deletable: true }],
    };
    _set_settings_ACU({ worldSimulation: legacy } as any);

    const upgrade = readWorldSimulationSettingsUpgrade_ACU();
    expect(upgrade).toMatchObject({ upgraded: true, settings: { agentPrompts: { 'world-director': expect.any(Array) } } });
    expect(upgrade!.settings.agentPrompts['world-director']).toContainEqual({ role: 'system', content: '旧主控规则：$USER_REQUEST', enabled: true, deletable: true });
    expect(upgrade!.settings.agentPrompts['world-director'].some(segment => segment.content === '$WORLD_SIMULATION_ROOT')).toBe(true);
    expect((settings_ACU as any).worldSimulation).toBe(legacy);

    persist.mockReturnValueOnce({ saved: true, storageType: 'tavern' });
    await expect(writeWorldSimulationSettingsStrict_ACU(upgrade!.settings)).resolves.toMatchObject({ ok: true, upgraded: false });
    expect((settings_ACU as any).worldSimulation).toMatchObject({ agentPrompts: upgrade!.settings.agentPrompts });
    expect((settings_ACU as any).worldSimulation.agentGuidance).toBeUndefined();
  });

  it('migrates v4 prompt layouts to one runtime-context/history seam while preserving custom static segments', () => {
    const v4 = buildDefaultWorldSimulationSettings_ACU() as any;
    v4.promptForceDefaultVersion = WORLD_SIMULATION_PROMPT_FORCE_DEFAULT_VERSION_V4_ACU;
    v4.agentPrompts['world-director'] = [
      { role: 'system', content: '$WORLD_SIMULATION_ROOT', enabled: true, deletable: true },
      { role: 'user', content: '用户保留的主控补充', enabled: true, deletable: true },
      { role: 'user', content: '$WORLD_SIMULATION_PROTOCOL', enabled: true, deletable: true },
      { role: 'user', content: '$WORLD_SIMULATION_STORY_PENDING', enabled: true, deletable: true },
      { role: 'user', content: '$WORLD_SIMULATION_TOOL_RESULTS', enabled: true, deletable: true },
    ];
    const upgrade = normalizeWorldSimulationSettings_ACU(v4)!;
    const prompts = upgrade.settings.agentPrompts['world-director'];
    expect(upgrade.upgraded).toBe(true);
    expect(prompts.some(segment => segment.content === '$WORLD_SIMULATION_RUNTIME_CONTEXT')).toBe(true);
    expect(prompts.some(segment => segment.content === '$WORLD_SIMULATION_HISTORY')).toBe(true);
    expect(prompts.some(segment => segment.content === '用户保留的主控补充')).toBe(true);
    expect(prompts.some(segment => segment.content === '$WORLD_SIMULATION_STORY_PENDING')).toBe(false);
    const boundaryIndex = prompts.findIndex(segment => segment.content === '$WORLD_SIMULATION_EXECUTION_BOUNDARY');
    expect(prompts[boundaryIndex - 1]?.role).toBe('assistant');
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
        light: { maxMasterModelTurns: 2, maxSpecialistModelTurns: 2, maxDelegations: 0, legacyReadCount: null, readTokenBudget: 'low' as const },
        normal: { maxMasterModelTurns: 4, maxSpecialistModelTurns: 3, maxDelegations: 1, legacyReadCount: null, readTokenBudget: 'high' as const },
        deep: { maxMasterModelTurns: 9, maxSpecialistModelTurns: 5, maxDelegations: 3, legacyReadCount: null, readTokenBudget: 'high' as const },
      },
    };
    expect(writeWorldSimulationSettings_ACU(custom)).toEqual({ ok: true, upgraded: false });
    expect(readWorldSimulationSettings_ACU()).toEqual(custom);
  });

  it('strict UI persistence confirms only a reliable save and restores the prior snapshot on failure', async () => {
    const prior = enabled();
    _set_settings_ACU({ worldSimulation: prior } as any);
    persist.mockReturnValueOnce({ saved: true, storageType: 'tavern' });
    const saved = { ...enabled(), joinWaitMs: 12_000 };
    await expect(writeWorldSimulationSettingsStrict_ACU(saved)).resolves.toEqual({ ok: true, upgraded: false, storageType: 'tavern' });
    expect(readWorldSimulationSettings_ACU()).toEqual(saved);

    persist.mockImplementationOnce(() => { throw new Error('host save failed'); });
    const rejected = { ...enabled(), joinWaitMs: 13_000 };
    await expect(writeWorldSimulationSettingsStrict_ACU(rejected)).resolves.toEqual({ ok: false, reason: 'persist_failed' });
    expect(readWorldSimulationSettings_ACU()).toEqual(saved);

    persist.mockReturnValueOnce({ saved: true, storageType: 'memory' });
    await expect(writeWorldSimulationSettingsStrict_ACU(rejected)).resolves.toEqual({ ok: false, reason: 'persist_failed' });
    expect(readWorldSimulationSettings_ACU()).toEqual(saved);
  });
});
