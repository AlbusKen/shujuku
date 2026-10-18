import type {
  AgentWorldbookCardConfigMeta_ACU,
  AgentWorldbookControl_ACU,
  AgentWorldbookPromptTemplates_ACU,
  AgentWorldbookScope_ACU,
  AgentWorldbookStateIdentity_ACU,
  AgentWorldbookControlMode_ACU,
  AgentWorldbookControlSnapshot_ACU,
  AgentWorldbookControlSnapshotEntry_ACU,
  AgentPlotExecutionMode_ACU,
  AgentWorldbookStateMeta_ACU,
} from '../../shared/models/agent-worldbook-model';
import {
  createLorebookEntries_ACU,
  deleteLorebookEntries_ACU,
  getCharLorebooks_ACU,
  getCurrentCharacterWorldbookBinding_ACU,
  isLorebookNotFoundError_ACU,
  getLorebookEntries_ACU,
  setLorebookEntries_ACU,
} from '../../data/gateways/worldbook-gateway';
import {
  buildDefaultAgentWorldbookControl_ACU,
  buildDefaultAgentWorldbookControlSnapshot_ACU,
  buildDefaultAgentWorldbookPromptTemplates_ACU,
} from '../../shared/defaults';
import {
  restoreAgentWorldbookSnapshotEntries_ACU,
  rollbackAgentWorldbookSnapshotRestore_ACU,
} from './agent-worldbook-snapshot-restore';
import type { StrictLorebookReadContext_ACU } from '../worldbook/pipeline';
import { getAgentRuntimeLorebookEntries_ACU } from './agent-worldbook-runtime-read';
import { settings_ACU } from '../runtime/state-manager';
import {
  normalizeAgentContextSettings_ACU,
  normalizeEditablePromptSegments_ACU,
} from './agent-prompt-template';
import { saveSettings_ACU } from '../settings/settings-service';
import { runExclusiveAgentWorldbookOperation_ACU } from './agent-worldbook-operation-lock';

export const AGENT_WORLDBOOK_CONFIG_COMMENT_ACU = 'TavernDB-ACU-AgentWorldbookConfig';

export type AgentWorldbookConfigSource_ACU = 'worldbook' | 'legacy_settings' | 'default';

interface ParsedAgentWorldbookStateMeta_ACU {
  control: Partial<AgentWorldbookControl_ACU>;
  snapshot: AgentWorldbookControlSnapshot_ACU;
  identity?: AgentWorldbookStateIdentity_ACU;
  updatedAt: number;
  legacy: boolean;
}

interface AgentWorldbookStateEntryCandidate_ACU {
  entry: any;
  meta: ParsedAgentWorldbookStateMeta_ACU;
  score: number;
  legacyCommentMatch: boolean;
}

export interface AgentWorldbookControlReadResult_ACU {
  control: AgentWorldbookControl_ACU;
  source: AgentWorldbookConfigSource_ACU;
  bookName: string;
  entryUid?: string | number;
  duplicateCount: number;
  writableBookName: string;
  reason?: string;
}

export interface AgentWorldbookStateReadResult_ACU extends AgentWorldbookControlReadResult_ACU {
  snapshot: AgentWorldbookControlSnapshot_ACU;
}

export interface AgentWorldbookStateWriteResult_ACU extends AgentWorldbookControlWriteResult_ACU {
  snapshot: AgentWorldbookControlSnapshot_ACU;
}

export interface AgentWorldbookControlWriteResult_ACU {
  updated: boolean;
  bookName: string;
  entryUid?: string | number;
  reason?: string;
  stateConfirmed?: boolean;
  control: AgentWorldbookControl_ACU;
}

function cloneDefaultAgentControl_ACU(): AgentWorldbookControl_ACU {
  return JSON.parse(JSON.stringify(buildDefaultAgentWorldbookControl_ACU())) as AgentWorldbookControl_ACU;
}

function cloneDefaultAgentSnapshot_ACU(): AgentWorldbookControlSnapshot_ACU {
  return JSON.parse(JSON.stringify(buildDefaultAgentWorldbookControlSnapshot_ACU())) as AgentWorldbookControlSnapshot_ACU;
}

function cloneAgentPromptTemplates_ACU(value: AgentWorldbookPromptTemplates_ACU): AgentWorldbookPromptTemplates_ACU {
  return JSON.parse(JSON.stringify(value)) as AgentWorldbookPromptTemplates_ACU;
}

function normalizeAgentPromptTemplates_ACU(value: unknown): AgentWorldbookPromptTemplates_ACU {
  const defaults = buildDefaultAgentWorldbookPromptTemplates_ACU();
  const source = normalizeControlPatch_ACU(value);
  return {
    agentDecisionPromptSegments: normalizeEditablePromptSegments_ACU(
      source.agentDecisionPromptSegments,
      defaults.agentDecisionPromptSegments,
    ),
    agentSkillifyPromptSegments: normalizeEditablePromptSegments_ACU(
      source.agentSkillifyPromptSegments,
      defaults.agentSkillifyPromptSegments,
    ),
  };
}

export function getAgentPromptTemplateDefaults_ACU(): AgentWorldbookPromptTemplates_ACU {
  const plotSettings = settings_ACU.plotSettings && typeof settings_ACU.plotSettings === 'object'
    ? settings_ACU.plotSettings as Record<string, any>
    : {};
  return cloneAgentPromptTemplates_ACU(normalizeAgentPromptTemplates_ACU(plotSettings.agentPromptTemplates));
}

export function setAgentPromptTemplateDefaults_ACU(value: unknown): boolean {
  if (!settings_ACU.plotSettings || typeof settings_ACU.plotSettings !== 'object' || Array.isArray(settings_ACU.plotSettings)) return false;
  const plotSettings = settings_ACU.plotSettings as Record<string, any>;
  const hadPreviousTemplates = Object.prototype.hasOwnProperty.call(plotSettings, 'agentPromptTemplates');
  const previousTemplates = plotSettings.agentPromptTemplates;
  plotSettings.agentPromptTemplates = normalizeAgentPromptTemplates_ACU(value);
  try {
    if (saveSettings_ACU().saved) return true;
  } catch {
    // 保存失败时同样回滚；调用方只需要收到 false，异常不应留下内存脏写。
  }
  if (hadPreviousTemplates) plotSettings.agentPromptTemplates = previousTemplates;
  else delete plotSettings.agentPromptTemplates;
  return false;
}

function normalizeBookNameList_ACU(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    const name = typeof item === 'string' ? item : '';
    if (name.trim() && !result.includes(name)) result.push(name);
  }
  return result;
}

function normalizeMode_ACU(value: unknown): AgentWorldbookControlMode_ACU {
  return value === 'passive' || value === 'agent' ? value : 'disabled';
}

function normalizeExecutionMode_ACU(value: unknown): AgentPlotExecutionMode_ACU {
  return value === 'sequential' ? 'sequential' : 'concurrent';
}

function normalizePositiveInt_ACU(value: unknown, fallback: number, min: number, max?: number): number {
  const raw = Number(value);
  const base = Number.isFinite(raw) ? Math.trunc(raw) : fallback;
  const bounded = max === undefined ? Math.min(Number.MAX_SAFE_INTEGER, base) : Math.min(max, base);
  return Math.max(min, bounded);
}

function normalizeControlPatch_ACU(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function normalizeAgentWorldbookScope_ACU(value: unknown, fallback: AgentWorldbookScope_ACU): AgentWorldbookScope_ACU {
  const source = normalizeControlPatch_ACU(value);
  if (!Object.prototype.hasOwnProperty.call(source, 'source')) {
    return {
      source: fallback.source,
      manualSelection: [...fallback.manualSelection],
    };
  }
  if (source.source !== 'manual') return { source: 'character', manualSelection: [] };
  return {
    source: 'manual',
    manualSelection: normalizeBookNameList_ACU(source.manualSelection),
  };
}

function getLegacyAgentWorldbookScope_ACU(): AgentWorldbookScope_ACU {
  const cfg = getPlotWorldbookConfig_ACU();
  return cfg.source === 'manual'
    ? { source: 'manual', manualSelection: normalizeBookNameList_ACU(cfg.manualSelection) }
    : { source: 'character', manualSelection: [] };
}

function isSameAgentWorldbookScope_ACU(left: AgentWorldbookScope_ACU, right: AgentWorldbookScope_ACU): boolean {
  return left.source === right.source
    && left.manualSelection.length === right.manualSelection.length
    && left.manualSelection.every((bookName, index) => bookName === right.manualSelection[index]);
}

function hasExplicitWorldbookScope_ACU(value: unknown): boolean {
  return Object.prototype.hasOwnProperty.call(normalizeControlPatch_ACU(value), 'worldbookScope');
}


function normalizeAgentWorldbookControlForCardConfig_ACU(value: unknown, promptTemplates = getAgentPromptTemplateDefaults_ACU()): AgentWorldbookControl_ACU {
  const defaults = cloneDefaultAgentControl_ACU();
  const source = normalizeControlPatch_ACU(value);
  const mode = normalizeMode_ACU(source.mode);
  const agentPlotExecutionMode = normalizeExecutionMode_ACU(source.agentPlotExecutionMode);
  const contextSettings = normalizeAgentContextSettings_ACU(source.contextSettings);
  const maxEntriesPerChannel = normalizeControlPatch_ACU(source.maxEntriesPerChannel);

  return {
    ...defaults,
    enabled: mode !== 'disabled',
    mode,
    agentPlotExecutionMode,
    scopeMode: 'follow_worldbook_page_selection',
    worldbookScope: normalizeAgentWorldbookScope_ACU(source.worldbookScope, getLegacyAgentWorldbookScope_ACU()),
    agentApiPreset: typeof source.agentApiPreset === 'string' ? source.agentApiPreset.trim() : defaults.agentApiPreset,
    agentSkillApiPreset: typeof source.agentSkillApiPreset === 'string' ? source.agentSkillApiPreset.trim() : defaults.agentSkillApiPreset,
    skillMetadataPolicy: 'comment_block',
    managedEntryPrefix: typeof source.managedEntryPrefix === 'string' && source.managedEntryPrefix.trim()
      ? source.managedEntryPrefix.trim()
      : defaults.managedEntryPrefix,
    finalInjectionMode: 'prompt_template',
    restoreOnDisable: source.restoreOnDisable !== false,
    agentDecisionConcurrency: normalizePositiveInt_ACU(source.agentDecisionConcurrency, defaults.agentDecisionConcurrency, 1),
    maxSkillifyConcurrency: normalizePositiveInt_ACU(source.maxSkillifyConcurrency, defaults.maxSkillifyConcurrency, 1),
    contextSettings,
    contextSettingsConfigured: source.contextSettingsConfigured === true,
    agentDecisionPromptSegments: normalizeEditablePromptSegments_ACU(
      source.agentDecisionPromptSegments,
      promptTemplates.agentDecisionPromptSegments,
    ),
    agentSkillifyPromptSegments: normalizeEditablePromptSegments_ACU(
      source.agentSkillifyPromptSegments,
      promptTemplates.agentSkillifyPromptSegments,
    ),
    maxEntriesPerChannel: {
      plot: normalizePositiveInt_ACU(maxEntriesPerChannel.plot, defaults.maxEntriesPerChannel.plot, 1),
      tableFill: normalizePositiveInt_ACU(maxEntriesPerChannel.tableFill, defaults.maxEntriesPerChannel.tableFill, 1),
      finalGeneration: normalizePositiveInt_ACU(maxEntriesPerChannel.finalGeneration, defaults.maxEntriesPerChannel.finalGeneration, 1),
    },
  };
}

function normalizeSnapshotKeys_ACU(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(key => String(key || '').trim()).filter(Boolean);
}

function hasValidWorldbookUid_ACU(uid: unknown): uid is string | number {
  return uid !== null && uid !== undefined && String(uid).trim() !== '';
}

function isSameWorldbookUid_ACU(left: unknown, right: unknown): boolean {
  return hasValidWorldbookUid_ACU(left) && hasValidWorldbookUid_ACU(right) && String(left) === String(right);
}

function normalizeSnapshotEntry_ACU(value: unknown): AgentWorldbookControlSnapshotEntry_ACU | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (!hasValidWorldbookUid_ACU(source.uid)) return null;
  const previousType = source.previousType === undefined || source.previousType === null ? undefined : String(source.previousType);
  const commentHash = typeof source.commentHash === 'string' && source.commentHash.trim() ? source.commentHash.trim() : undefined;
  return {
    uid: source.uid,
    ...(source.takeoverStatus === 'pending' || source.takeoverStatus === 'applied'
      ? { takeoverStatus: source.takeoverStatus }
      : {}),
    previousEnabled: source.previousEnabled !== false,
    previousKeys: normalizeSnapshotKeys_ACU(source.previousKeys),
    previousType,
    commentHash,
  };
}

function normalizeAgentWorldbookSnapshotForCardState_ACU(value: unknown): AgentWorldbookControlSnapshot_ACU {
  const defaults = cloneDefaultAgentSnapshot_ACU();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
  const source = value as Record<string, unknown>;
  const booksSource = source.books && typeof source.books === 'object' && !Array.isArray(source.books)
    ? source.books as Record<string, unknown>
    : {};
  const books: Record<string, AgentWorldbookControlSnapshotEntry_ACU[]> = {};
  for (const [rawBookName, rawEntries] of Object.entries(booksSource)) {
    const bookName = rawBookName;
    if (!bookName.trim() || !Array.isArray(rawEntries)) continue;
    const entries = rawEntries
      .map(entry => normalizeSnapshotEntry_ACU(entry))
      .filter(Boolean) as AgentWorldbookControlSnapshotEntry_ACU[];
    if (entries.length > 0) books[bookName] = entries;
  }
  return {
    active: source.active === true,
    selectionSignature: typeof source.selectionSignature === 'string' ? source.selectionSignature.trim() : defaults.selectionSignature,
    createdAt: Number.isFinite(Number(source.createdAt)) ? Number(source.createdAt) : defaults.createdAt,
    books,
  };
}

function normalizeAgentWorldbookStateIdentity_ACU(value: unknown): AgentWorldbookStateIdentity_ACU | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const marker = typeof source.marker === 'string' && source.marker.trim()
    ? source.marker.trim()
    : '';
  if (marker !== AGENT_WORLDBOOK_CONFIG_COMMENT_ACU) return undefined;
  const stateEntryUid = hasValidWorldbookUid_ACU(source.stateEntryUid) ? source.stateEntryUid : undefined;
  const hostBookName = typeof source.hostBookName === 'string' && source.hostBookName.trim()
    ? source.hostBookName
    : undefined;
  return { marker, ...(stateEntryUid !== undefined ? { stateEntryUid } : {}), ...(hostBookName ? { hostBookName } : {}) };
}

function buildAgentWorldbookStateIdentity_ACU(hostBookName: string, stateEntryUid?: string | number): AgentWorldbookStateIdentity_ACU {
  return {
    marker: AGENT_WORLDBOOK_CONFIG_COMMENT_ACU,
    ...(hasValidWorldbookUid_ACU(stateEntryUid) ? { stateEntryUid } : {}),
    ...(hostBookName.trim() ? { hostBookName } : {}),
  };
}

function buildAgentWorldbookStateMeta_ACU(control: AgentWorldbookControl_ACU, snapshot: AgentWorldbookControlSnapshot_ACU, identity?: AgentWorldbookStateIdentity_ACU): AgentWorldbookStateMeta_ACU {
  return {
    version: 2,
    kind: 'agent_worldbook_state',
    updatedAt: Date.now(),
    ...(identity ? { identity } : {}),
    control,
    snapshot,
  };
}

function parseAgentWorldbookStateMeta_ACU(value: unknown): ParsedAgentWorldbookStateMeta_ACU | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    if (raw.version === 2 && raw.kind === 'agent_worldbook_state') {
      return {
        updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : 0,
        identity: normalizeAgentWorldbookStateIdentity_ACU(raw.identity),
        control: normalizeControlPatch_ACU(raw.control) as Partial<AgentWorldbookControl_ACU>,
        snapshot: normalizeAgentWorldbookSnapshotForCardState_ACU(raw.snapshot),
        legacy: false,
      };
    }
    if (raw.version !== 1 || raw.kind !== 'agent_worldbook_config') return null;
    const legacyMeta: AgentWorldbookCardConfigMeta_ACU = {
      version: 1,
      kind: 'agent_worldbook_config',
      updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : 0,
      control: normalizeControlPatch_ACU(raw.control) as Partial<AgentWorldbookControl_ACU>,
    };
    return {
      updatedAt: legacyMeta.updatedAt,
      control: legacyMeta.control,
      snapshot: cloneDefaultAgentSnapshot_ACU(),
      legacy: true,
    };
  } catch {
    return null;
  }
}

function findAgentConfigEntries_ACU(entries: any[]): any[] {
  return (Array.isArray(entries) ? entries : [])
    .filter(entry => String(entry?.comment || '').trim() === AGENT_WORLDBOOK_CONFIG_COMMENT_ACU);
}

function buildAgentStateEntryCandidates_ACU(entries: any[], hostBookName: string): AgentWorldbookStateEntryCandidate_ACU[] {
  const result: AgentWorldbookStateEntryCandidate_ACU[] = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const meta = parseAgentWorldbookStateMeta_ACU(entry?.content);
    const legacyCommentMatch = String(entry?.comment || '').trim() === AGENT_WORLDBOOK_CONFIG_COMMENT_ACU;
    if (!meta && !legacyCommentMatch) continue;
    if (!meta) continue;

    let score = 10;
    if (!meta.legacy) score += 20;
    if (legacyCommentMatch) score += 5;
    if (meta.identity?.hostBookName && meta.identity.hostBookName === hostBookName) score += 30;
    if (isSameWorldbookUid_ACU(meta.identity?.stateEntryUid, entry?.uid)) score += 50;
    if (meta.identity && !isSameWorldbookUid_ACU(meta.identity.stateEntryUid, entry?.uid) && hasValidWorldbookUid_ACU(meta.identity.stateEntryUid)) score -= 40;
    result.push({ entry, meta, score, legacyCommentMatch });
  }
  return result.sort((left, right) => right.score - left.score || Number(right.meta.updatedAt || 0) - Number(left.meta.updatedAt || 0));
}

function findAgentStateEntry_ACU(entries: any[], hostBookName: string): {
  entry: any | null;
  meta: ParsedAgentWorldbookStateMeta_ACU | null;
  duplicateCount: number;
} {
  const candidates = buildAgentStateEntryCandidates_ACU(entries, hostBookName);
  const selected = candidates[0];
  return {
    entry: selected?.entry || null,
    meta: selected?.meta || null,
    duplicateCount: Math.max(0, candidates.length - (selected ? 1 : 0)),
  };
}

function findCreatedAgentStateEntry_ACU(entries: any[], hostBookName: string, createdAfter: number): any | null {
  const candidates = buildAgentStateEntryCandidates_ACU(entries, hostBookName)
    .filter(candidate => candidate.entry?.uid !== null && candidate.entry?.uid !== undefined);
  return candidates.find(candidate => Number(candidate.meta.updatedAt || 0) >= createdAfter)?.entry
    || candidates[0]?.entry
    || null;
}

function buildConfigEntryPayload_ACU(
  control: AgentWorldbookControl_ACU,
  snapshot: AgentWorldbookControlSnapshot_ACU,
  hostBookName: string,
  existing?: Record<string, any>,
  stateEntryUid?: string | number,
): Record<string, any> {
  const resolvedUid = hasValidWorldbookUid_ACU(stateEntryUid) ? stateEntryUid : existing?.uid;
  const identity = buildAgentWorldbookStateIdentity_ACU(hostBookName, resolvedUid);
  return {
    ...(existing || {}),
    comment: typeof existing?.comment === 'string' && existing.comment.trim() ? existing.comment : AGENT_WORLDBOOK_CONFIG_COMMENT_ACU,
    content: JSON.stringify(buildAgentWorldbookStateMeta_ACU(control, snapshot, identity), null, 2),
    keys: Array.isArray(existing?.keys) ? existing.keys : [],
    enabled: false,
    type: 'keyword',
    order: Number.isFinite(Number(existing?.order)) ? Number(existing.order) : 10000,
    prevent_recursion: true,
  };
}

type AgentWorldbookScopeWriteConfirmation_ACU = 'next' | 'current' | 'partial_next' | 'missing' | 'unknown';

function stringifyStableJsonValue_ACU(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => stringifyStableJsonValue_ACU(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stringifyStableJsonValue_ACU(record[key])}`).join(',')}}`;
}

function isSameStableJsonValue_ACU(left: unknown, right: unknown): boolean {
  return stringifyStableJsonValue_ACU(left) === stringifyStableJsonValue_ACU(right);
}

function isPartialNextScopeWrite_ACU(
  persistedControl: Record<string, any>,
  persistedSnapshot: AgentWorldbookControlSnapshot_ACU,
  currentPersistedControl: Partial<AgentWorldbookControl_ACU>,
  nextPersistedControl: Partial<AgentWorldbookControl_ACU>,
  nextSnapshot: AgentWorldbookControlSnapshot_ACU,
): boolean {
  if (
    !isSameStableJsonValue_ACU(persistedSnapshot, nextSnapshot)
    || !isSameStableJsonValue_ACU(persistedControl.worldbookScope, nextPersistedControl.worldbookScope)
  ) return false;
  return Object.entries(persistedControl).every(([key, value]) => {
    const hasNext = Object.prototype.hasOwnProperty.call(nextPersistedControl, key);
    const hasCurrent = Object.prototype.hasOwnProperty.call(currentPersistedControl, key);
    return (hasNext && isSameStableJsonValue_ACU(value, nextPersistedControl[key as keyof AgentWorldbookControl_ACU]))
      || (hasCurrent && isSameStableJsonValue_ACU(value, currentPersistedControl[key as keyof AgentWorldbookControl_ACU]));
  });
}

async function confirmAgentWorldbookScopeWrite_ACU(
  hostBookName: string,
  entryUid: string | number,
  currentPersistedControl: Partial<AgentWorldbookControl_ACU>,
  nextPersistedControl: Partial<AgentWorldbookControl_ACU>,
  currentSnapshot: AgentWorldbookControlSnapshot_ACU,
  nextSnapshot: AgentWorldbookControlSnapshot_ACU,
): Promise<AgentWorldbookScopeWriteConfirmation_ACU> {
  try {
    const entries = await getLorebookEntries_ACU(hostBookName);
    const entry = (entries || []).find(candidate => isSameWorldbookUid_ACU(candidate?.uid, entryUid));
    if (!entry) return 'missing';
    const meta = parseAgentWorldbookStateMeta_ACU(entry.content);
    if (!meta) return 'unknown';
    const persistedControl = normalizeControlPatch_ACU(meta.control);
    const persistedSnapshot = normalizeAgentWorldbookSnapshotForCardState_ACU(meta.snapshot);
    if (
      isSameStableJsonValue_ACU(persistedControl, nextPersistedControl)
      && isSameStableJsonValue_ACU(persistedSnapshot, nextSnapshot)
    ) return 'next';
    if (
      isSameStableJsonValue_ACU(persistedControl, currentPersistedControl)
      && isSameStableJsonValue_ACU(persistedSnapshot, currentSnapshot)
    ) return 'current';
    if (isPartialNextScopeWrite_ACU(
      persistedControl,
      persistedSnapshot,
      currentPersistedControl,
      nextPersistedControl,
      nextSnapshot,
    )) return 'partial_next';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}


function getPlotWorldbookConfig_ACU(): Record<string, any> {
  const plotSettings = settings_ACU.plotSettings && typeof settings_ACU.plotSettings === 'object'
    ? settings_ACU.plotSettings as Record<string, any>
    : {};
  const cfg = plotSettings.plotWorldbookConfig;
  return cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
}

function getManualPlotWorldbookNames_ACU(): string[] {
  const cfg = getPlotWorldbookConfig_ACU();
  return normalizeBookNameList_ACU(cfg.manualSelection);
}

async function resolveAgentWorldbookScopeBookNamesFromScope_ACU(scope: AgentWorldbookScope_ACU): Promise<string[]> {
  if (scope.source === 'manual') return normalizeBookNameList_ACU(scope.manualSelection);

  const binding = await getCurrentCharacterWorldbookBinding_ACU();
  return binding.orderedNames.slice();
}

export async function resolveAgentWorldbookScopeBookNames_ACU(scope?: AgentWorldbookScope_ACU, readContext?: StrictLorebookReadContext_ACU): Promise<string[]> {
  const resolvedScope = scope || (await readAgentWorldbookStateFromWorldbooks_ACU(readContext)).control.worldbookScope;
  return resolveAgentWorldbookScopeBookNamesFromScope_ACU(resolvedScope);
}

async function resolveAgentWorldbookBootstrapBookNames_ACU(): Promise<string[]> {
  const binding = await getCurrentCharacterWorldbookBinding_ACU();
  return normalizeBookNameList_ACU([
    ...binding.orderedNames,
    ...getManualPlotWorldbookNames_ACU(),
  ]);
}

async function resolveAgentWorldbookHostBookForScope_ACU(scope: AgentWorldbookScope_ACU): Promise<string> {
  const binding = await getCurrentCharacterWorldbookBinding_ACU();
  if (binding.primary) return binding.primary;
  if (scope.source === 'manual') return scope.manualSelection[0] || '';
  return '';
}

export async function resolveAgentWorldbookConfigHostBook_ACU(): Promise<string> {
  const state = await readAgentWorldbookStateFromWorldbooks_ACU();
  return state.bookName || resolveAgentWorldbookHostBookForScope_ACU(state.control.worldbookScope);
}

function getLegacyAgentWorldbookControl_ACU(): AgentWorldbookControl_ACU | null {
  const plotSettings = settings_ACU.plotSettings && typeof settings_ACU.plotSettings === 'object'
    ? settings_ACU.plotSettings as Record<string, any>
    : {};
  const legacy = plotSettings.agentWorldbookControl;
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) return null;
  return normalizeAgentWorldbookControlForCardConfig_ACU(legacy);
}

async function readWorldbookConfigEntry_ACU(bookName: string, readContext?: StrictLorebookReadContext_ACU): Promise<{
  bookName: string;
  entry: any | null;
  duplicateCount: number;
  control: AgentWorldbookControl_ACU | null;
  snapshot: AgentWorldbookControlSnapshot_ACU | null;
}> {
  const entries = await getAgentRuntimeLorebookEntries_ACU(bookName, readContext);
  const result = findAgentStateEntry_ACU(entries, bookName);
  if (!result.entry || !result.meta) return { bookName, entry: null, duplicateCount: result.duplicateCount, control: null, snapshot: null };
  return {
    bookName,
    entry: result.entry,
    duplicateCount: result.duplicateCount,
    control: normalizeAgentWorldbookControlForCardConfig_ACU(result.meta.control),
    snapshot: normalizeAgentWorldbookSnapshotForCardState_ACU(result.meta.snapshot),
  };
}

export async function readAgentWorldbookStateFromWorldbooks_ACU(readContext?: StrictLorebookReadContext_ACU): Promise<AgentWorldbookStateReadResult_ACU> {
  const scanBookNames = await resolveAgentWorldbookBootstrapBookNames_ACU();
  const defaultScope = getLegacyAgentWorldbookScope_ACU();
  const writableBookName = await resolveAgentWorldbookHostBookForScope_ACU(defaultScope);

  for (const bookName of scanBookNames) {
    let result: Awaited<ReturnType<typeof readWorldbookConfigEntry_ACU>>;
    try {
      result = await readWorldbookConfigEntry_ACU(bookName, readContext);
    } catch (error) {
      if (isLorebookNotFoundError_ACU(error)) continue;
      throw error;
    }
    if (!result.control) continue;
    return {
      control: result.control,
      snapshot: result.snapshot || cloneDefaultAgentSnapshot_ACU(),
      source: 'worldbook',
      bookName: result.bookName,
      entryUid: result.entry?.uid,
      duplicateCount: result.duplicateCount,
      writableBookName,
    };
  }

  const legacy = getLegacyAgentWorldbookControl_ACU();
  if (legacy) {
    return {
      control: legacy,
      snapshot: cloneDefaultAgentSnapshot_ACU(),
      source: 'legacy_settings',
      bookName: '',
      duplicateCount: 0,
      writableBookName,
      reason: 'legacy_settings_fallback',
    };
  }

  return {
    control: normalizeAgentWorldbookControlForCardConfig_ACU({}),
    snapshot: cloneDefaultAgentSnapshot_ACU(),
    source: 'default',
    bookName: '',
    duplicateCount: 0,
    writableBookName,
    reason: writableBookName ? 'worldbook_config_not_found' : 'no_config_host_book',
  };
}

export async function readAgentWorldbookControlFromWorldbooks_ACU(readContext?: StrictLorebookReadContext_ACU): Promise<AgentWorldbookControlReadResult_ACU> {
  const state = await readAgentWorldbookStateFromWorldbooks_ACU(readContext);
  return {
    control: state.control,
    source: state.source,
    bookName: state.bookName,
    entryUid: state.entryUid,
    duplicateCount: state.duplicateCount,
    writableBookName: state.writableBookName,
    reason: state.reason,
  };
}

export async function writeAgentWorldbookStateToWorldbook_ACU(patch: {
  control?: Partial<AgentWorldbookControl_ACU>;
  snapshot?: AgentWorldbookControlSnapshot_ACU;
}): Promise<AgentWorldbookStateWriteResult_ACU> {
  const current = await readAgentWorldbookStateFromWorldbooks_ACU();
  const requestedControlPatch = normalizeControlPatch_ACU(patch?.control);
  let nextControl = normalizeAgentWorldbookControlForCardConfig_ACU({
    ...current.control,
    ...requestedControlPatch,
  });
  let nextSnapshot = patch?.snapshot === undefined
    ? normalizeAgentWorldbookSnapshotForCardState_ACU(current.snapshot)
    : normalizeAgentWorldbookSnapshotForCardState_ACU(patch.snapshot);
  const changesScope = patch?.control !== undefined
    && hasExplicitWorldbookScope_ACU(patch.control)
    && !isSameAgentWorldbookScope_ACU(current.control.worldbookScope, nextControl.worldbookScope);

  const hostBookName = current.bookName || await resolveAgentWorldbookHostBookForScope_ACU(nextControl.worldbookScope);
  if (!hostBookName) {
    return {
      updated: false,
      bookName: '',
      reason: 'no_config_host_book',
      control: current.control,
      snapshot: current.snapshot,
    };
  }

  // 在恢复旧范围前完成配置宿主的读取和定位。这样宿主读取失败不会发生物理 restore，
  // active snapshot 的 scope 切换也不会因为并发删除状态条目而退化为“创建新条目”。
  const entries = await getLorebookEntries_ACU(hostBookName);
  const currentEntryUid = current.bookName === hostBookName ? current.entryUid : undefined;
  const existingByUid = hasValidWorldbookUid_ACU(currentEntryUid)
    ? entries.find(entry => isSameWorldbookUid_ACU(entry?.uid, currentEntryUid))
    : undefined;
  const existing = existingByUid || findAgentStateEntry_ACU(entries, hostBookName).entry;

  let restoreRollbackPatchesByBook: Record<string, Record<string, any>[]> | null = null;
  let restoreRestoredPatchesByBook: Record<string, Record<string, any>[]> | null = null;
  if (changesScope && current.snapshot.active === true) {
    if (current.source !== 'worldbook' || !existing || !hasValidWorldbookUid_ACU(existing.uid)) {
      return {
        updated: false,
        bookName: current.bookName,
        entryUid: current.entryUid,
        reason: 'scope_state_entry_missing',
        control: current.control,
        snapshot: current.snapshot,
      };
    }
    const oldBookNames = await resolveAgentWorldbookScopeBookNamesFromScope_ACU(current.control.worldbookScope);
    const restore = await restoreAgentWorldbookSnapshotEntries_ACU(current.snapshot, oldBookNames);
    if (!restore.signatureMatched || restore.skipped > 0 || restore.failed > 0) {
      const rollbackSucceeded = await rollbackAgentWorldbookSnapshotRestore_ACU(
        restore.rollbackPatchesByBook,
        restore.restoredPatchesByBook,
      );
      return {
        updated: false,
        bookName: current.bookName,
        entryUid: current.entryUid,
        reason: !rollbackSucceeded
          ? 'scope_restore_rollback_failed'
          : (!restore.signatureMatched ? 'scope_restore_signature_mismatch' : 'scope_restore_incomplete'),
        control: current.control,
        snapshot: current.snapshot,
      };
    }
    restoreRollbackPatchesByBook = restore.rollbackPatchesByBook;
    restoreRestoredPatchesByBook = restore.restoredPatchesByBook;
    nextSnapshot = cloneDefaultAgentSnapshot_ACU();
  }

  const existingMeta = existing ? parseAgentWorldbookStateMeta_ACU(existing.content) : null;
  const existingControl = normalizeControlPatch_ACU(existingMeta?.control);
  if (existingMeta) {
    nextControl = normalizeAgentWorldbookControlForCardConfig_ACU({
      ...existingControl,
      ...requestedControlPatch,
    });
  }
  const persistedControl = { ...nextControl } as Partial<AgentWorldbookControl_ACU>;
  for (const key of ['agentDecisionPromptSegments', 'agentSkillifyPromptSegments'] as const) {
    if (!Object.prototype.hasOwnProperty.call(existingControl, key) && !Object.prototype.hasOwnProperty.call(requestedControlPatch, key)) {
      delete persistedControl[key];
    }
  }
  try {
    const nextEntry = buildConfigEntryPayload_ACU(persistedControl as AgentWorldbookControl_ACU, nextSnapshot, hostBookName, existing || undefined, existing?.uid);
    if (existing?.uid !== null && existing?.uid !== undefined) {
      if (!restoreRollbackPatchesByBook) {
        await setLorebookEntries_ACU(hostBookName, [{ ...nextEntry, uid: existing.uid }]);
        return { updated: true, bookName: hostBookName, entryUid: existing.uid, control: nextControl, snapshot: nextSnapshot };
      }

      let writeFailed = false;
      try {
        await setLorebookEntries_ACU(hostBookName, [{ ...nextEntry, uid: existing.uid }]);
      } catch {
        writeFailed = true;
      }
      const confirmation = await confirmAgentWorldbookScopeWrite_ACU(
        hostBookName,
        existing.uid,
        existingControl,
        persistedControl,
        current.snapshot,
        nextSnapshot,
      );
      if (confirmation === 'next') {
        return { updated: true, bookName: hostBookName, entryUid: existing.uid, control: nextControl, snapshot: nextSnapshot };
      }
      let confirmedWriteState: AgentWorldbookScopeWriteConfirmation_ACU = confirmation;
      if (confirmation === 'partial_next') {
        try {
          await setLorebookEntries_ACU(hostBookName, [{ ...nextEntry, uid: existing.uid }]);
        } catch {
          // 继续按读回结果判定；宿主可能已提交但响应失败。
        }
        confirmedWriteState = await confirmAgentWorldbookScopeWrite_ACU(
          hostBookName, existing.uid, existingControl, persistedControl, current.snapshot, nextSnapshot,
        );
        if (confirmedWriteState === 'next') {
          return { updated: true, bookName: hostBookName, entryUid: existing.uid, control: nextControl, snapshot: nextSnapshot };
        }
      }
      if (confirmedWriteState === 'current') {
        const rollbackSucceeded = await rollbackAgentWorldbookSnapshotRestore_ACU(
          restoreRollbackPatchesByBook,
          restoreRestoredPatchesByBook || {},
        );
        return {
          updated: false,
          bookName: current.bookName,
          entryUid: current.entryUid,
          reason: rollbackSucceeded
            ? (writeFailed ? 'scope_state_write_failed' : 'scope_state_write_unconfirmed')
            : 'scope_state_write_rollback_failed',
          control: current.control,
          snapshot: current.snapshot,
        };
      }
      return {
        updated: false,
        bookName: current.bookName,
        entryUid: current.entryUid,
        reason: 'scope_state_write_unconfirmed',
        stateConfirmed: false,
        control: current.control,
        snapshot: current.snapshot,
      };
    }

    const createdAfter = Date.now();
    await createLorebookEntries_ACU(hostBookName, [nextEntry]);
    const refreshedEntries = await getLorebookEntries_ACU(hostBookName);
    const created = findCreatedAgentStateEntry_ACU(refreshedEntries, hostBookName, createdAfter);
    if (created?.uid !== null && created?.uid !== undefined) {
      const backfilledEntry = buildConfigEntryPayload_ACU(persistedControl as AgentWorldbookControl_ACU, nextSnapshot, hostBookName, created, created.uid);
      await setLorebookEntries_ACU(hostBookName, [{ ...backfilledEntry, uid: created.uid }]);
      return { updated: true, bookName: hostBookName, entryUid: created.uid, control: nextControl, snapshot: nextSnapshot };
    }
    return { updated: true, bookName: hostBookName, reason: 'state_entry_uid_unresolved', control: nextControl, snapshot: nextSnapshot };
  } catch (error) {
    if (!restoreRollbackPatchesByBook) throw error;
    const rollbackSucceeded = await rollbackAgentWorldbookSnapshotRestore_ACU(
      restoreRollbackPatchesByBook,
      restoreRestoredPatchesByBook || {},
    );
    return {
      updated: false,
      bookName: current.bookName,
      entryUid: current.entryUid,
      reason: rollbackSucceeded ? 'scope_state_write_failed' : 'scope_state_write_rollback_failed',
      control: current.control,
      snapshot: current.snapshot,
    };
  }
}

export function writeAgentWorldbookControlToWorldbook_ACU(
  controlPatch: Partial<AgentWorldbookControl_ACU>,
): Promise<AgentWorldbookControlWriteResult_ACU> {
  // UI 配置写（含 scope 变更引发的条目恢复）与接管/恢复/绿灯操作互斥；
  // 内层 writeAgentWorldbookStateToWorldbook_ACU 不加锁，供 takeover 持锁期间调用。
  return runExclusiveAgentWorldbookOperation_ACU(() => writeAgentWorldbookControlToWorldbookExclusive_ACU(controlPatch));
}

async function writeAgentWorldbookControlToWorldbookExclusive_ACU(
  controlPatch: Partial<AgentWorldbookControl_ACU>,
): Promise<AgentWorldbookControlWriteResult_ACU> {
  const result = await writeAgentWorldbookStateToWorldbook_ACU({ control: controlPatch });
  return {
    updated: result.updated,
    bookName: result.bookName,
    entryUid: result.entryUid,
    reason: result.reason,
    stateConfirmed: result.stateConfirmed,
    control: result.control,
  };
}

async function resolveAgentWorldbookStateCleanupBookNames_ACU(explicitBookName: string): Promise<string[]> {
  if (explicitBookName) return [explicitBookName];

  const names: string[] = [
    await resolveAgentWorldbookConfigHostBook_ACU(),
    ...(await resolveAgentWorldbookScopeBookNames_ACU()),
    ...getManualPlotWorldbookNames_ACU(),
  ];

  try {
    const charLorebooks = await getCharLorebooks_ACU({ type: 'all' });
    const primary = String(charLorebooks?.primary || '').trim();
    if (primary) names.push(primary);
    names.push(...normalizeBookNameList_ACU(charLorebooks?.additional));
  } catch {
    // Cleanup must remain best-effort across host/config changes; existing host/config names above are still valid.
  }

  return normalizeBookNameList_ACU(names);
}

export async function deleteAgentWorldbookStateEntry_ACU(bookName?: string): Promise<number> {
  const explicitBookName = typeof bookName === 'string' && bookName.trim() ? bookName : '';
  const scanBookNames = await resolveAgentWorldbookStateCleanupBookNames_ACU(explicitBookName);
  let deleted = 0;
  for (const targetBookName of scanBookNames) {
    const entries = await getLorebookEntries_ACU(targetBookName);
    const candidates = buildAgentStateEntryCandidates_ACU(entries, targetBookName)
      .map(candidate => candidate.entry)
      .filter(entry => entry?.uid !== null && entry?.uid !== undefined);
    const legacyCommentMatches = findAgentConfigEntries_ACU(entries)
      .filter(entry => entry?.uid !== null && entry?.uid !== undefined);
    const matchedByUid = new Map<string, any>();
    for (const entry of [...candidates, ...legacyCommentMatches]) {
      if (!hasValidWorldbookUid_ACU(entry?.uid)) continue;
      matchedByUid.set(String(entry.uid), entry);
    }
    const matched = Array.from(matchedByUid.values());
    if (matched.length === 0) continue;
    await deleteLorebookEntries_ACU(targetBookName, matched.map(entry => entry.uid));
    deleted += matched.length;
  }
  return deleted;
}

export { normalizeAgentWorldbookControlForCardConfig_ACU, normalizeAgentWorldbookSnapshotForCardState_ACU };
