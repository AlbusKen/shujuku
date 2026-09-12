import { buildDefaultWorldSimulationSettings_ACU, WORLD_SIMULATION_MAX_JOIN_WAIT_MS_ACU } from './defaults';
import type { WorldSimulationSettings_ACU, WorldVisibilityPolicy_ACU } from './model';
import { settings_ACU } from '../runtime/state-manager';

/** In-memory normalization result: `upgraded` means a successful write should persist the upgrade. */
export interface WorldSimulationSettingsUpgrade_ACU {
  settings: WorldSimulationSettings_ACU;
  upgraded: boolean;
}

const VISIBILITY_POLICIES_ACU: readonly WorldVisibilityPolicy_ACU[] = ['agent', 'always_hidden', 'always_revealed'];
const SCALES_ACU = ['light', 'normal', 'deep'] as const satisfies readonly (keyof WorldSimulationSettings_ACU['budgets'])[];
const READ_TIERS_ACU = ['low', 'medium', 'high'] as const;
const SETTINGS_KEYS_ACU: readonly (keyof WorldSimulationSettings_ACU)[] = ['enabled', 'joinWaitMs', 'minFloorGap', 'checkpointInterval', 'maxTrackedEntities', 'visibilityPolicy', 'showHiddenInUi', 'budgets'];
const BUDGET_KEYS_ACU: readonly (keyof WorldSimulationSettings_ACU['budgets']['light'])[] = ['maxIterations', 'maxDelegations', 'maxReads', 'readTokenBudget'];

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isIntAtLeast_ACU(value: unknown, min: number): value is number {
  return Number.isInteger(value) && (value as number) >= min;
}

function hasOnlyKnownKeys_ACU(value: Record<string, unknown>, knownKeys: readonly string[]): boolean {
  return Object.keys(value).every(key => knownKeys.includes(key));
}

function hasExactKeys_ACU(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length
    && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function isBudgetFieldValue_ACU(key: keyof WorldSimulationSettings_ACU['budgets']['light'], value: unknown): boolean {
  switch (key) {
    case 'maxIterations': return isIntAtLeast_ACU(value, 1);
    case 'maxDelegations':
    case 'maxReads': return isIntAtLeast_ACU(value, 0);
    case 'readTokenBudget': return READ_TIERS_ACU.includes(String(value) as (typeof READ_TIERS_ACU)[number]);
    default: return false;
  }
}

/** Accepts a legacy partial budget only after rejecting unknown fields and invalid present values. */
function isPartialBudget_ACU(value: unknown): value is Partial<WorldSimulationSettings_ACU['budgets']['light']> {
  if (!isRecord_ACU(value)) return false;
  return hasOnlyKnownKeys_ACU(value, BUDGET_KEYS_ACU)
    && BUDGET_KEYS_ACU.every(key => !Object.prototype.hasOwnProperty.call(value, key) || isBudgetFieldValue_ACU(key, value[key]));
}

function isCompleteBudget_ACU(value: unknown): value is WorldSimulationSettings_ACU['budgets']['light'] {
  return isPartialBudget_ACU(value) && hasExactKeys_ACU(value, BUDGET_KEYS_ACU);
}

function isPartialBudgets_ACU(value: unknown): value is Partial<WorldSimulationSettings_ACU['budgets']> {
  if (!isRecord_ACU(value) || !hasOnlyKnownKeys_ACU(value, SCALES_ACU)) return false;
  return SCALES_ACU.every(scale => !Object.prototype.hasOwnProperty.call(value, scale) || isPartialBudget_ACU(value[scale]));
}

function isCompleteBudgets_ACU(value: unknown): value is WorldSimulationSettings_ACU['budgets'] {
  return isPartialBudgets_ACU(value) && hasExactKeys_ACU(value, SCALES_ACU)
    && SCALES_ACU.every(scale => isCompleteBudget_ACU(value[scale]));
}

/** True only for a complete, in-range settings object. Never normalizes and never guesses. */
export function isWorldSimulationSettings_ACU(value: unknown): value is WorldSimulationSettings_ACU {
  if (!isRecord_ACU(value) || !hasExactKeys_ACU(value, SETTINGS_KEYS_ACU)) return false;
  if (typeof value.enabled !== 'boolean') return false;
  if (!Number.isInteger(value.joinWaitMs) || (value.joinWaitMs as number) < 0
    || (value.joinWaitMs as number) > WORLD_SIMULATION_MAX_JOIN_WAIT_MS_ACU) return false;
  if (!isIntAtLeast_ACU(value.minFloorGap, 1)) return false;
  if (!isIntAtLeast_ACU(value.checkpointInterval, 1)) return false;
  if (!isIntAtLeast_ACU(value.maxTrackedEntities, 1)) return false;
  if (!VISIBILITY_POLICIES_ACU.includes(String(value.visibilityPolicy) as WorldVisibilityPolicy_ACU)) return false;
  if (typeof value.showHiddenInUi !== 'boolean') return false;
  return isCompleteBudgets_ACU(value.budgets);
}

const TOP_LEVEL_FIELD_VALIDATORS_ACU: Omit<Record<keyof WorldSimulationSettings_ACU, (value: unknown) => boolean>, 'budgets'> = {
  enabled: value => typeof value === 'boolean',
  joinWaitMs: value => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= WORLD_SIMULATION_MAX_JOIN_WAIT_MS_ACU,
  minFloorGap: value => isIntAtLeast_ACU(value, 1),
  checkpointInterval: value => isIntAtLeast_ACU(value, 1),
  maxTrackedEntities: value => isIntAtLeast_ACU(value, 1),
  visibilityPolicy: value => VISIBILITY_POLICIES_ACU.includes(String(value) as WorldVisibilityPolicy_ACU),
  showHiddenInUi: value => typeof value === 'boolean',
};

/**
 * Strict-then-normalize: a recognized field that is present but out of range is a real invalid value,
 * so the whole object is REJECTED and the feature stays off (fail-closed). Only a missing field on
 * otherwise old data is filled from defaults in memory and reported as `upgraded`, so nothing is
 * written back until the caller actually persists.
 */
export function normalizeWorldSimulationSettings_ACU(raw: unknown): WorldSimulationSettingsUpgrade_ACU | null {
  if (!isRecord_ACU(raw)) return null;
  if (!hasOnlyKnownKeys_ACU(raw, SETTINGS_KEYS_ACU)) return null;
  const present = SETTINGS_KEYS_ACU
    .filter(key => Object.prototype.hasOwnProperty.call(raw, key));
  if (present.length === 0) return null;
  for (const key of present) {
    if (key !== 'budgets' && !TOP_LEVEL_FIELD_VALIDATORS_ACU[key](raw[key])) return null;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'budgets') && !isPartialBudgets_ACU(raw.budgets)) return null;
  if (isWorldSimulationSettings_ACU(raw)) return { settings: raw, upgraded: false };

  const defaults = buildDefaultWorldSimulationSettings_ACU();
  const rawBudgets = (raw.budgets ?? {}) as Partial<WorldSimulationSettings_ACU['budgets']>;
  const budgets: WorldSimulationSettings_ACU['budgets'] = {
    light: { ...defaults.budgets.light, ...(rawBudgets.light ?? {}) },
    normal: { ...defaults.budgets.normal, ...(rawBudgets.normal ?? {}) },
    deep: { ...defaults.budgets.deep, ...(rawBudgets.deep ?? {}) },
  };
  const merged: WorldSimulationSettings_ACU = {
    ...defaults,
    ...raw,
    budgets,
  };
  // This should hold because all present fields were validated and every missing field is copied
  // from the complete defaults. Keep the fail-closed guard in case this contract changes.
  if (!isWorldSimulationSettings_ACU(merged)) return null;
  return { settings: merged, upgraded: true };
}

/** In-memory read. Partial legacy data is normalized but never written back implicitly. */
export function readWorldSimulationSettings_ACU(): WorldSimulationSettings_ACU | null {
  const raw = (settings_ACU as Record<string, unknown> | undefined)?.worldSimulation;
  return normalizeWorldSimulationSettings_ACU(raw)?.settings ?? null;
}

/**
 * Persistence is injected rather than imported, so this module never drags the settings service into
 * the module graph of every simulation test. Production uses a lazy import; tests inject a spy.
 */
let persistSettings_ACU: (() => void) | null = null;

export function setWorldSimulationSettingsPersistence_ACU(persist: (() => void) | null): void {
  persistSettings_ACU = persist;
}

function persistInBackground(): void {
  if (persistSettings_ACU) {
    persistSettings_ACU();
    return;
  }
  // Fire-and-forget: a failed settings save must never break the in-memory read path. The import is
  // dynamic on purpose so the settings service never enters the module graph of simulation callers.
  void (async (): Promise<void> => {
    try {
      const module = await import('../settings/settings-service');
      module.saveSettings_ACU();
    } catch (_) {
      // The in-memory value is already updated; a failed persist must not break the read path.
    }
  })();
}

export type WriteWorldSimulationSettingsResult_ACU =
  | { ok: true; upgraded: boolean }
  | { ok: false; reason: 'invalid' | 'store_unavailable' };

/** The write path: validate strictly, then persist. An invalid value never reaches the store. */
export function writeWorldSimulationSettings_ACU(raw: unknown): WriteWorldSimulationSettingsResult_ACU {
  const normalized = normalizeWorldSimulationSettings_ACU(raw);
  if (!normalized) return { ok: false, reason: 'invalid' };
  if (!isRecord_ACU(settings_ACU)) return { ok: false, reason: 'store_unavailable' };
  (settings_ACU as Record<string, unknown>).worldSimulation = normalized.settings;
  persistInBackground();
  return { ok: true, upgraded: normalized.upgraded };
}
