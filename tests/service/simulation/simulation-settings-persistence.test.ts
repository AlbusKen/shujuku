/**
 * WorldSimulation settings persistence round-trip.
 *
 * loadSettings_ACU does: deepMerge_ACU(buildDefaultSettings_ACU(), savedSettings).
 * That preserves settings_ACU.worldSimulation only if (a) the defaults carry no such top-level key
 * and (b) deepMerge copies unknown object keys out of the source. Both are asserted here against the
 * REAL implementations, together with the real save-side sanitizer and a real JSON storage round-trip.
 */
import { describe, expect, it } from 'vitest';
import { deepMerge_ACU } from '../../../src/shared/utils';
import { sanitizeSettingsForProfileSave_ACU } from '../../../src/data/repositories/profile-repo';
import { buildDefaultSettings_ACU } from '../../../src/service/settings/settings-service';
import { buildDefaultWorldSimulationSettings_ACU } from '../../../src/service/simulation/defaults';
import { isWorldSimulationSettings_ACU } from '../../../src/service/simulation/simulation-settings';

function custom() {
  return {
    ...buildDefaultWorldSimulationSettings_ACU(),
    enabled: true,
    joinWaitMs: 12_345,
    minFloorGap: 3,
    checkpointInterval: 7,
    maxTrackedEntities: 42,
    visibilityPolicy: 'always_revealed' as const,
    showHiddenInUi: true,
    budgets: {
      light: { maxIterations: 2, maxDelegations: 0, maxReads: 1, readTokenBudget: 'low' as const },
      normal: { maxIterations: 6, maxDelegations: 3, maxReads: 9, readTokenBudget: 'high' as const },
      deep: { maxIterations: 11, maxDelegations: 5, maxReads: 30, readTokenBudget: 'medium' as const },
    },
  };
}

describe('worldSimulation persistence round-trip', () => {
  it('defaults carry no top-level worldSimulation key', () => {
    // Precondition that makes deepMerge's unknown-key branch load-bearing on every load.
    expect(Object.prototype.hasOwnProperty.call(buildDefaultSettings_ACU(), 'worldSimulation')).toBe(false);
  });

  it('survives sanitize -> JSON -> deepMerge(defaults, saved) field-for-field', () => {
    const worldSimulation = custom();
    expect(isWorldSimulationSettings_ACU(worldSimulation)).toBe(true);

    const sanitized = sanitizeSettingsForProfileSave_ACU({ ...buildDefaultSettings_ACU(), worldSimulation });
    expect(sanitized.worldSimulation).toEqual(worldSimulation);

    const saved = JSON.parse(JSON.stringify(sanitized));
    expect(saved.worldSimulation).toEqual(worldSimulation);

    const merged = deepMerge_ACU(buildDefaultSettings_ACU(), saved);
    expect(merged.worldSimulation).toEqual(worldSimulation);
  });

  it('sanitizer drops only the three documented global keys', () => {
    const sanitized = sanitizeSettingsForProfileSave_ACU({
      worldSimulation: custom(),
      keepMe: { deep: true },
      dataIsolationHistory: ['x'],
      dataIsolationEnabled: true,
      vectorMemoryConfig: { anything: 1 },
    });
    expect(sanitized.worldSimulation).toEqual(custom());
    expect(sanitized.keepMe).toEqual({ deep: true });
    expect(sanitized.dataIsolationHistory).toBeUndefined();
    expect(sanitized.dataIsolationEnabled).toBeUndefined();
    expect(sanitized.vectorMemoryConfig).toBeUndefined();
  });
});
