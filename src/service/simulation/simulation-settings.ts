import { buildDefaultWorldSimulationAgentGuidance_ACU, buildDefaultWorldSimulationAgentPrompts_ACU, buildDefaultWorldSimulationSettings_ACU, WORLD_SIMULATION_MAX_JOIN_WAIT_MS_ACU, WORLD_SIMULATION_PROMPT_FORCE_DEFAULT_VERSION_ACU } from './defaults';
import type { WorldSimulationAgentGuidance_ACU, WorldSimulationAgentName_ACU, WorldSimulationAgentPrompts_ACU, WorldSimulationPromptRole_ACU, WorldSimulationSettings_ACU, WorldVisibilityPolicy_ACU } from './model';
import { settings_ACU } from '../runtime/state-manager';

/** In-memory normalization result: `upgraded` means a successful write should persist the upgrade. */
export interface WorldSimulationSettingsUpgrade_ACU {
  settings: WorldSimulationSettings_ACU;
  upgraded: boolean;
}

const VISIBILITY_POLICIES_ACU: readonly WorldVisibilityPolicy_ACU[] = ['agent', 'always_hidden', 'always_revealed'];
const SCALES_ACU = ['light', 'normal', 'deep'] as const satisfies readonly (keyof WorldSimulationSettings_ACU['budgets'])[];
const READ_TIERS_ACU = ['low', 'medium', 'high'] as const;
const AGENT_NAMES_ACU: readonly WorldSimulationAgentName_ACU[] = ['world-director', 'entity-movement', 'faction-events', 'thread-weaver'];
const PROMPT_ROLES_ACU: readonly WorldSimulationPromptRole_ACU[] = ['system', 'user', 'assistant'];
const BASE_SETTINGS_KEYS_ACU = ['enabled', 'joinWaitMs', 'minFloorGap', 'checkpointInterval', 'maxTrackedEntities', 'visibilityPolicy', 'showHiddenInUi', 'toolsEnabled', 'budgets'] as const;
const SETTINGS_KEYS_ACU: readonly (keyof WorldSimulationSettings_ACU)[] = [...BASE_SETTINGS_KEYS_ACU, 'agentPrompts', 'promptForceDefaultVersion'];
const GUIDANCE_LEGACY_SETTINGS_KEYS_ACU = [...BASE_SETTINGS_KEYS_ACU, 'agentGuidance', 'promptForceDefaultVersion'] as const;
const PRE_KERNEL_PROMPT_SETTINGS_KEYS_ACU = [...BASE_SETTINGS_KEYS_ACU, 'agentPrompts'] as const;
const BUDGET_KEYS_ACU: readonly (keyof WorldSimulationSettings_ACU['budgets']['light'])[] = ['maxMasterModelTurns', 'maxSpecialistModelTurns', 'maxDelegations', 'readTokenBudget', 'legacyReadCount'];
const LEGACY_BUDGET_KEYS_ACU = ['maxIterations', 'maxDelegations', 'maxReads', 'readTokenBudget'] as const;
const LEGACY_BUDGET_EXCLUSIVE_KEYS_ACU = ['maxIterations', 'maxReads'] as const;
const NEW_BUDGET_EXCLUSIVE_KEYS_ACU = ['maxMasterModelTurns', 'maxSpecialistModelTurns', 'legacyReadCount'] as const;

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
    case 'maxMasterModelTurns':
    case 'maxSpecialistModelTurns': return isIntAtLeast_ACU(value, 1);
    case 'maxDelegations':
      return isIntAtLeast_ACU(value, 0);
    case 'readTokenBudget': return READ_TIERS_ACU.includes(String(value) as (typeof READ_TIERS_ACU)[number]);
    case 'legacyReadCount': return value === null || isIntAtLeast_ACU(value, 0);
    default: return false;
  }
}

function isLegacyBudgetFieldValue_ACU(key: typeof LEGACY_BUDGET_KEYS_ACU[number], value: unknown): boolean {
  if (key === 'maxIterations') return isIntAtLeast_ACU(value, 1);
  if (key === 'maxDelegations' || key === 'maxReads') return isIntAtLeast_ACU(value, 0);
  return READ_TIERS_ACU.includes(String(value) as (typeof READ_TIERS_ACU)[number]);
}

type LegacyBudget_ACU = { maxIterations: number; maxDelegations: number; maxReads: number; readTokenBudget: WorldSimulationSettings_ACU['budgets']['light']['readTokenBudget'] };

/** New and legacy budget objects are accepted separately; a mixed shape is never guessed. */
function isPartialBudget_ACU(value: unknown): value is Partial<WorldSimulationSettings_ACU['budgets']['light']> | Partial<LegacyBudget_ACU> {
  if (!isRecord_ACU(value)) return false;
  const keys = Object.keys(value);
  const useLegacy = keys.some(key => (LEGACY_BUDGET_EXCLUSIVE_KEYS_ACU as readonly string[]).includes(key));
  const useNew = keys.some(key => (NEW_BUDGET_EXCLUSIVE_KEYS_ACU as readonly string[]).includes(key));
  // maxDelegations and readTokenBudget exist in both persisted shapes, so they cannot
  // identify a version. A tier containing both exclusive sets is not historical data.
  if (useLegacy && useNew) return false;
  const allowed = useLegacy ? LEGACY_BUDGET_KEYS_ACU : BUDGET_KEYS_ACU;
  if (!hasOnlyKnownKeys_ACU(value, allowed)) return false;
  return useLegacy
    ? LEGACY_BUDGET_KEYS_ACU.every(key => !Object.prototype.hasOwnProperty.call(value, key) || isLegacyBudgetFieldValue_ACU(key, value[key]))
    : BUDGET_KEYS_ACU.every(key => !Object.prototype.hasOwnProperty.call(value, key) || isBudgetFieldValue_ACU(key, value[key]));
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

function normalizeBudget_ACU(raw: unknown, fallback: WorldSimulationSettings_ACU['budgets']['light']): { budget: WorldSimulationSettings_ACU['budgets']['light']; legacy: boolean; upgraded: boolean } | null {
  if (!isPartialBudget_ACU(raw)) return null;
  const value = raw as Record<string, unknown>;
  const legacy = Object.keys(value).some(key => (LEGACY_BUDGET_EXCLUSIVE_KEYS_ACU as readonly string[]).includes(key));
  if (!legacy) {
    return {
      budget: { ...fallback, ...value } as WorldSimulationSettings_ACU['budgets']['light'],
      legacy: false,
      upgraded: !hasExactKeys_ACU(value, BUDGET_KEYS_ACU),
    };
  }
  return {
    budget: {
      maxMasterModelTurns: Object.prototype.hasOwnProperty.call(value, 'maxIterations') ? value.maxIterations as number : fallback.maxMasterModelTurns,
      maxSpecialistModelTurns: fallback.maxSpecialistModelTurns,
      maxDelegations: Object.prototype.hasOwnProperty.call(value, 'maxDelegations') ? value.maxDelegations as number : fallback.maxDelegations,
      readTokenBudget: Object.prototype.hasOwnProperty.call(value, 'readTokenBudget') ? value.readTokenBudget as WorldSimulationSettings_ACU['budgets']['light']['readTokenBudget'] : fallback.readTokenBudget,
      legacyReadCount: Object.prototype.hasOwnProperty.call(value, 'maxReads') ? value.maxReads as number : null,
    },
    legacy: true,
    upgraded: true,
  };
}

function normalizeBudgets_ACU(raw: unknown, defaults: WorldSimulationSettings_ACU['budgets']): { budgets: WorldSimulationSettings_ACU['budgets']; legacy: boolean; upgraded: boolean } | null {
  if (!isRecord_ACU(raw) || !hasOnlyKnownKeys_ACU(raw, SCALES_ACU)) return null;
  const normalized = {} as WorldSimulationSettings_ACU['budgets']; let legacy = false; let upgraded = !hasExactKeys_ACU(raw, SCALES_ACU);
  for (const scale of SCALES_ACU) {
    const result = normalizeBudget_ACU(raw[scale] ?? {}, defaults[scale]);
    if (!result) return null;
    normalized[scale] = result.budget; legacy ||= result.legacy; upgraded ||= result.upgraded;
  }
  return { budgets: normalized, legacy, upgraded };
}

function isPromptSegment_ACU(value: unknown): boolean {
  if (!isRecord_ACU(value) || !hasExactKeys_ACU(value, ['role', 'content', 'enabled', 'deletable'])) return false;
  return PROMPT_ROLES_ACU.includes(value.role as WorldSimulationPromptRole_ACU)
    && typeof value.content === 'string' && value.content.trim().length > 0
    && typeof value.enabled === 'boolean' && typeof value.deletable === 'boolean';
}

function isPartialAgentPrompts_ACU(value: unknown): value is Partial<WorldSimulationAgentPrompts_ACU> {
  if (!isRecord_ACU(value) || !hasOnlyKnownKeys_ACU(value, AGENT_NAMES_ACU)) return false;
  return AGENT_NAMES_ACU.every(name => !Object.prototype.hasOwnProperty.call(value, name)
    || (Array.isArray(value[name]) && value[name].every(isPromptSegment_ACU)));
}

function hasEnabledPromptSegments_ACU(value: Partial<WorldSimulationAgentPrompts_ACU>): boolean {
  return AGENT_NAMES_ACU.every(name => !Object.prototype.hasOwnProperty.call(value, name)
    || value[name]!.some(segment => segment.enabled));
}

function mergeAgentPrompts_ACU(raw: Partial<WorldSimulationAgentPrompts_ACU> | undefined): WorldSimulationAgentPrompts_ACU {
  const defaults = buildDefaultWorldSimulationAgentPrompts_ACU();
  return Object.fromEntries(AGENT_NAMES_ACU.map(name => [name, raw?.[name] ?? defaults[name]])) as WorldSimulationAgentPrompts_ACU;
}

function legacyPromptsToCurrentPrompts_ACU(prompts: Partial<WorldSimulationAgentPrompts_ACU>): WorldSimulationAgentPrompts_ACU {
  const defaults = buildDefaultWorldSimulationAgentPrompts_ACU();
  const guidance = buildDefaultWorldSimulationAgentGuidance_ACU();
  for (const name of AGENT_NAMES_ACU) {
    const legacy = prompts[name];
    if (!legacy) continue;
    // The old configurable prompt group was the user-owned guidance area. Keep its role, order and
    // enabled state while placing it between the new root placeholder and the protocol placeholders.
    const guidanceIndex = defaults[name].findIndex(segment => segment.content === guidance[name]);
    defaults[name].splice(guidanceIndex, 1, ...legacy.map(segment => ({ ...segment })));
  }
  return defaults;
}

function guidanceToCurrentPrompts_ACU(guidance: Partial<WorldSimulationAgentGuidance_ACU>): WorldSimulationAgentPrompts_ACU {
  return buildDefaultWorldSimulationAgentPrompts_ACU({ ...buildDefaultWorldSimulationAgentGuidance_ACU(), ...guidance });
}

function isPartialAgentGuidance_ACU(value: unknown): value is Partial<WorldSimulationAgentGuidance_ACU> {
  return isRecord_ACU(value) && hasOnlyKnownKeys_ACU(value, AGENT_NAMES_ACU)
    && AGENT_NAMES_ACU.every(name => !Object.prototype.hasOwnProperty.call(value, name) || typeof value[name] === 'string');
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
  if (typeof value.toolsEnabled !== 'boolean') return false;
  return isCompleteBudgets_ACU(value.budgets)
    && isPartialAgentPrompts_ACU(value.agentPrompts) && hasExactKeys_ACU(value.agentPrompts, AGENT_NAMES_ACU)
    && hasEnabledPromptSegments_ACU(value.agentPrompts)
    && value.promptForceDefaultVersion === WORLD_SIMULATION_PROMPT_FORCE_DEFAULT_VERSION_ACU;
}

const TOP_LEVEL_FIELD_VALIDATORS_ACU: Omit<Record<keyof WorldSimulationSettings_ACU, (value: unknown) => boolean>, 'budgets' | 'agentPrompts' | 'promptForceDefaultVersion'> = {
  enabled: value => typeof value === 'boolean',
  joinWaitMs: value => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= WORLD_SIMULATION_MAX_JOIN_WAIT_MS_ACU,
  minFloorGap: value => isIntAtLeast_ACU(value, 1),
  checkpointInterval: value => isIntAtLeast_ACU(value, 1),
  maxTrackedEntities: value => isIntAtLeast_ACU(value, 1),
  visibilityPolicy: value => VISIBILITY_POLICIES_ACU.includes(String(value) as WorldVisibilityPolicy_ACU),
  showHiddenInUi: value => typeof value === 'boolean',
  toolsEnabled: value => typeof value === 'boolean',
};

/**
 * Strict-then-normalize: a recognized field that is present but out of range is a real invalid value,
 * so the whole object is REJECTED and the feature stays off (fail-closed). Only a missing field on
 * otherwise old data is filled from defaults in memory and reported as `upgraded`, so nothing is
 * written back until the caller actually persists.
 */
export function normalizeWorldSimulationSettings_ACU(raw: unknown): WorldSimulationSettingsUpgrade_ACU | null {
  if (!isRecord_ACU(raw)) return null;
  const hasGuidance = Object.prototype.hasOwnProperty.call(raw, 'agentGuidance');
  const hasPrompts = Object.prototype.hasOwnProperty.call(raw, 'agentPrompts');
  // A mixed object is not a historical shape: accepting it would make precedence ambiguous.
  if (hasGuidance && hasPrompts) return null;
  const keys = hasGuidance
    ? GUIDANCE_LEGACY_SETTINGS_KEYS_ACU
    : hasPrompts ? SETTINGS_KEYS_ACU : PRE_KERNEL_PROMPT_SETTINGS_KEYS_ACU;
  if (!hasOnlyKnownKeys_ACU(raw, keys)) return null;
  const present = keys
    .filter(key => Object.prototype.hasOwnProperty.call(raw, key));
  if (present.length === 0) return null;
  for (const key of present) {
    if (key !== 'budgets' && key !== 'agentGuidance' && key !== 'agentPrompts' && key !== 'promptForceDefaultVersion'
      && !TOP_LEVEL_FIELD_VALIDATORS_ACU[key](raw[key])) return null;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'budgets') && !isPartialBudgets_ACU(raw.budgets)) return null;
  if (hasGuidance && !isPartialAgentGuidance_ACU(raw.agentGuidance)) return null;
  if (hasPrompts && (!isPartialAgentPrompts_ACU(raw.agentPrompts) || !hasEnabledPromptSegments_ACU(raw.agentPrompts))) return null;
  if (Object.prototype.hasOwnProperty.call(raw, 'promptForceDefaultVersion')
    && (typeof raw.promptForceDefaultVersion !== 'string' || !raw.promptForceDefaultVersion.trim())) return null;
  if (isWorldSimulationSettings_ACU(raw)) {
    return { settings: raw, upgraded: false };
  }

  const defaults = buildDefaultWorldSimulationSettings_ACU();
  const normalizedBudgets = normalizeBudgets_ACU(raw.budgets ?? {}, defaults.budgets);
  if (!normalizedBudgets) return null;
  const budgets = normalizedBudgets.budgets;
  const version = raw.promptForceDefaultVersion;
  const agentPrompts = hasGuidance
    ? guidanceToCurrentPrompts_ACU(raw.agentGuidance as Partial<WorldSimulationAgentGuidance_ACU>)
    : hasPrompts && version !== WORLD_SIMULATION_PROMPT_FORCE_DEFAULT_VERSION_ACU
      ? legacyPromptsToCurrentPrompts_ACU(raw.agentPrompts as Partial<WorldSimulationAgentPrompts_ACU>)
      : mergeAgentPrompts_ACU(raw.agentPrompts as Partial<WorldSimulationAgentPrompts_ACU> | undefined);
  const { budgets: _budgets, agentGuidance: _guidance, agentPrompts: _prompts, promptForceDefaultVersion: _version, ...top } = raw;
  const merged: WorldSimulationSettings_ACU = {
    ...defaults,
    ...top,
    budgets,
    agentPrompts,
    toolsEnabled: Object.prototype.hasOwnProperty.call(raw, 'toolsEnabled') ? raw.toolsEnabled as boolean : defaults.toolsEnabled,
    promptForceDefaultVersion: WORLD_SIMULATION_PROMPT_FORCE_DEFAULT_VERSION_ACU,
  };
  // This should hold because all present fields were validated and every missing field is copied
  // from the complete defaults. Keep the fail-closed guard in case this contract changes.
  if (!isCompleteBudgets_ACU(merged.budgets) || !isPartialAgentPrompts_ACU(merged.agentPrompts)
    || !hasExactKeys_ACU(merged.agentPrompts, AGENT_NAMES_ACU) || !hasEnabledPromptSegments_ACU(merged.agentPrompts)) return null;
  return {
    settings: merged,
    upgraded: true,
  };
}

/** In-memory read. Partial legacy data is normalized but never written back implicitly. */
export function readWorldSimulationSettings_ACU(): WorldSimulationSettings_ACU | null {
  return readWorldSimulationSettingsUpgrade_ACU()?.settings ?? null;
}

/** Exposes upgrade/review state to the UI without turning a read into a write. */
export function readWorldSimulationSettingsUpgrade_ACU(): WorldSimulationSettingsUpgrade_ACU | null {
  const raw = (settings_ACU as Record<string, unknown> | undefined)?.worldSimulation;
  return normalizeWorldSimulationSettings_ACU(raw);
}

/**
 * Persistence is injected rather than imported, so this module never drags the settings service into
 * the module graph of every simulation test. Production uses a lazy import; tests inject a spy.
 */
let persistSettings_ACU: (() => unknown) | null = null;

export function setWorldSimulationSettingsPersistence_ACU(persist: (() => unknown) | null): void {
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

export type WriteWorldSimulationSettingsStrictResult_ACU =
  | { ok: true; upgraded: boolean; storageType: 'tavern' | 'indexeddb' }
  | { ok: false; reason: 'invalid' | 'store_unavailable' | 'persist_failed' };

function clonePersistedValue_ACU(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isReliableSaveResult_ACU(value: unknown): value is { saved: true; storageType: 'tavern' | 'indexeddb' } {
  return isRecord_ACU(value) && value.saved === true
    && (value.storageType === 'tavern' || value.storageType === 'indexeddb');
}

/**
 * Explicit UI save: wait for a real persistence result and restore the previous in-memory value on
 * failure. Unlike the legacy sync write, a memory-only fallback is not presented as a saved setting.
 */
export async function writeWorldSimulationSettingsStrict_ACU(raw: unknown): Promise<WriteWorldSimulationSettingsStrictResult_ACU> {
  const normalized = normalizeWorldSimulationSettings_ACU(raw);
  if (!normalized) return { ok: false, reason: 'invalid' };
  if (!isRecord_ACU(settings_ACU)) return { ok: false, reason: 'store_unavailable' };
  const store = settings_ACU as Record<string, unknown>;
  const had = Object.prototype.hasOwnProperty.call(store, 'worldSimulation');
  const previous = clonePersistedValue_ACU(store.worldSimulation);
  store.worldSimulation = normalized.settings;
  try {
    const result = persistSettings_ACU
      ? await persistSettings_ACU()
      : (await import('../settings/settings-service')).saveSettings_ACU();
    if (!isReliableSaveResult_ACU(result)) throw new Error('世界推演设置未获得可靠持久化确认');
    return { ok: true, upgraded: normalized.upgraded, storageType: result.storageType };
  } catch (_) {
    if (had) store.worldSimulation = previous;
    else delete store.worldSimulation;
    return { ok: false, reason: 'persist_failed' };
  }
}

/** The write path: validate strictly, then persist. An invalid value never reaches the store. */
export function writeWorldSimulationSettings_ACU(raw: unknown): WriteWorldSimulationSettingsResult_ACU {
  const normalized = normalizeWorldSimulationSettings_ACU(raw);
  if (!normalized) return { ok: false, reason: 'invalid' };
  if (!isRecord_ACU(settings_ACU)) return { ok: false, reason: 'store_unavailable' };
  (settings_ACU as Record<string, unknown>).worldSimulation = normalized.settings;
  persistInBackground();
  return { ok: true, upgraded: normalized.upgraded };
}
