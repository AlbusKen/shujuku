import { getChatArray_ACU, saveChatToHostStrict_ACU } from '../../data/gateways/chat-gateway';
import { readTailSwipe_ACU } from '../../data/gateways/chat-message-snapshot';
import { cloneIsolatedData_ACU, NATIVE_SWIPE_TABLE_FIELD_ACU, readIsolatedTagData_ACU } from '../../data/repositories/chat-message-data-repo';
import type { FlightModeState_ACU } from '../../shared/models/flight-mode-model';
import { bumpTableReplayGeneration_ACU } from '../../shared/table-replay-generation';
import { getActiveChatStorageIdentity_ACU } from '../chat/chat-service';
import {
  getCurrentFlightModeState_ACU,
  setDetachedFlightModeState_ACU,
  stageFlightModeHiddenRowIds_ACU,
} from '../flight-mode/flight-mode-state';
import { settings_ACU } from '../runtime/state-manager';
import { readActiveProvisionalBridge_ACU } from './manual-catch-up-provisional-bridge';
import { hasRuntimeOnlyPendingSheets_ACU } from './runtime-only-pending-state';
import { getCurrentStorageMode } from './storage-mode';
import { loadTableStateFromFramesV2Detailed_ACU } from './storage-frame-v2-replay';
import { isV2TagData_ACU, resolveTableStorageStrategy_ACU } from './storage-strategy-resolver';
import { getTableDataFingerprint_ACU } from './table-data-upgrade-audit';
import type { TableFillChatView_ACU } from './table-fill-request-guard';
import { runTableWriteTransaction_ACU } from './table-write-transaction';

const TABLE_FIELD = 'TavernDB_ACU_IsolatedData';
const REPLAY_OPTIONS = { updateRuntimeState: false, compatibilityMode: 'disabled', backgroundFixation: 'skip' } as const;
type Tag = NonNullable<ReturnType<typeof readIsolatedTagData_ACU>>;
type Frames = Record<number, Tag | null>;
interface Candidate { body: string; frames: Frames; hiddenRowIds?: string[] }
interface SwipeArchive {
  version: 2;
  activeBody: string;
  activeFingerprint: string;
  /** Shared values where at least one candidate differs. */
  base: Frames;
  baseHiddenRowIds?: string[];
  entries: Candidate[];
}
interface SwipeScope { chatKey: string; isolationKey: string; isCurrent(): boolean }
export interface NativeSwipeTableIntent_ACU { index: number; message: any; slot: number; previousBody: string }
export type NativeSwipeTableResult_ACU = 'unchanged' | 'updated' | 'unsupported' | 'unsupported_checkpoint';

export function captureNativeSwipeTableIntent_ACU(chat: any[], index: unknown): NativeSwipeTableIntent_ACU | null {
  const selected = readTailSwipe_ACU(chat, index);
  return selected && selected.slot === selected.swipes.length
    ? { index: selected.index, message: selected.message, slot: selected.slot, previousBody: selected.swipes[selected.slot - 1] }
    : null;
}

function readFrames(chat: any[], isolationKey: string) {
  return chat.map(message => readIsolatedTagData_ACU(message, isolationKey));
}

function fingerprint(chat: any[], isolationKey: string) {
  // Vector mirrors follow the selected tables and can be refreshed independently.
  return getTableDataFingerprint_ACU(readFrames(chat, isolationKey).map(tag => {
    if (!isV2TagData_ACU(tag) || !tag.storageFrame.summaryVectorIndexFrame) return tag;
    const { summaryVectorIndexFrame: _mirror, ...frame } = tag.storageFrame;
    return { ...tag, storageFrame: frame };
  }));
}

function equal(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }
function hasFrame(frames: Frames, index: string | number) { return Object.prototype.hasOwnProperty.call(frames, index); }
function validHiddenRowIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}
function normalizeHiddenRowIds(value?: readonly string[]): string[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  for (const raw of value) {
    const id = String(raw ?? '').trim();
    if (id) ids.add(id);
  }
  return [...ids].sort();
}
function collectSheetRowIds(tableData: Record<string, any> | null | undefined, sheetKey: string): Set<string> {
  const ids = new Set<string>();
  const content = tableData?.[sheetKey]?.content;
  if (!Array.isArray(content)) return ids;
  for (const row of content.slice(1)) {
    if (!Array.isArray(row)) continue;
    const id = String(row[0] ?? '').trim();
    if (id) ids.add(id);
  }
  return ids;
}
function hasBigSummaryRowIncrease(
  baseData: Record<string, any> | null | undefined,
  liveData: Record<string, any> | null | undefined,
  bigSummarySheetKey: string,
): boolean {
  const key = String(bigSummarySheetKey || '').trim();
  if (!key) return false;
  const baseIds = collectSheetRowIds(baseData, key);
  const liveIds = collectSheetRowIds(liveData, key);
  return [...liveIds].some(id => !baseIds.has(id));
}

function validFrames(frames: unknown, lastIndex: number): frames is Frames {
  return !!frames && typeof frames === 'object' && !Array.isArray(frames)
    && Object.entries(frames).every(([key, tag]) => /^(0|[1-9]\d*)$/.test(key)
      && Number(key) <= lastIndex && (tag === null || isV2TagData_ACU(tag)));
}

/** Remove reply-local edits while keeping storage anchors needed by the normal fill path. */
function rollTailTag(tag: Tag | null): Tag | null | undefined {
  if (!tag) return null;
  if (!isV2TagData_ACU(tag) || tag.storageFrame.manualRefillProgress || tag.storageFrame.checkpoint?.manualRefillProgress
    || tag.storageFrame.sheetTimelineEvents?.length || tag.compatTransitionCheckpoint || tag.spv79TransitionCheckpoint) return undefined;
  const { checkpoint, perSheetCheckpoints, summaryVectorIndexFrame, logEntries } = tag.storageFrame;
  if (checkpoint?.kind === 'full' && checkpoint.reason === 'compaction') return undefined;
  const initialFill = checkpoint?.kind === 'full' && checkpoint.reason === 'init'
    && Boolean(checkpoint.event?.filledSheetKeys?.length || checkpoint.event?.groupKeys?.length);
  if (initialFill) return Object.keys(perSheetCheckpoints || {}).length ? undefined : null;
  if (!checkpoint && !Object.keys(perSheetCheckpoints || {}).length) return null;
  return { ...tag, storageFrame: {
    version: 2, logEntries: [],
    ...(checkpoint ? { checkpoint } : {}),
    ...(perSheetCheckpoints ? { perSheetCheckpoints } : {}),
    ...(summaryVectorIndexFrame?.checkpoint ? { summaryVectorIndexFrame: { ...summaryVectorIndexFrame, logEntries: [] } } : {}),
    headRevision: logEntries[0] ? logEntries[0].parentRevision : tag.storageFrame.headRevision,
  } };
}

function readArchive(chat: any[], index: number, isolationKey: string): SwipeArchive | null {
  const raw = chat[index]?.[NATIVE_SWIPE_TABLE_FIELD_ACU]?.[isolationKey];
  if (raw?.version === 2 && typeof raw.activeBody === 'string' && typeof raw.activeFingerprint === 'string'
    && validFrames(raw.base, index) && hasFrame(raw.base, index) && Array.isArray(raw.entries)
    && (raw.baseHiddenRowIds === undefined || validHiddenRowIds(raw.baseHiddenRowIds))
    && raw.entries.every((entry: Candidate) => typeof entry?.body === 'string' && validFrames(entry.frames, index)
      && (entry.hiddenRowIds === undefined || validHiddenRowIds(entry.hiddenRowIds))
      && Object.keys(entry.frames).every(key => hasFrame(raw.base, key)))
    && new Set(raw.entries.map((entry: Candidate) => entry.body)).size === raw.entries.length
    && raw.entries.some((entry: Candidate) => entry.body === raw.activeBody)) return raw;

  if (raw?.version !== 1 || !Array.isArray(raw.entries) || typeof raw.activeBody !== 'string'
    || !raw.entries.every((entry: { body: string; tag: Tag }) => typeof entry?.body === 'string' && isV2TagData_ACU(entry.tag))
    || new Set(raw.entries.map((entry: { body: string }) => entry.body)).size !== raw.entries.length) return null;
  const active = raw.entries.find((entry: { body: string }) => entry.body === raw.activeBody);
  if (!active || !equal(active.tag, readIsolatedTagData_ACU(chat[index], isolationKey))
    || raw.prefixFingerprint !== getTableDataFingerprint_ACU(readFrames(chat.slice(0, index), isolationKey))) return null;
  const base = rollTailTag(active.tag);
  if (base === undefined) return null;
  return {
    version: 2, activeBody: raw.activeBody, activeFingerprint: fingerprint(chat, isolationKey),
    base: { [index]: base },
    entries: raw.entries.map((entry: { body: string; tag: Tag }) => ({ body: entry.body, frames: { [index]: entry.tag } })),
  };
}

export function hasNativeSwipeCandidateChange_ACU(chat: any[], index: unknown, isolationKey: string): boolean {
  const selected = readTailSwipe_ACU(chat, index);
  if (!selected?.body) return false;
  const archive = readArchive(chat, selected.index, isolationKey);
  if (archive) return archive.activeBody !== selected.body;
  const boundBody = readBoundBody(selected.message, isolationKey, selected.swipes);
  return Boolean(boundBody && boundBody !== selected.body);
}

function withFrames(chat: any[], isolationKey: string, frames: Frames): any[] {
  return chat.map((message, i) => {
    if (!message?.[TABLE_FIELD] && !hasFrame(frames, i)) return { ...message };
    const container = cloneIsolatedData_ACU(message);
    if (hasFrame(frames, i)) {
      if (frames[i]) container[isolationKey] = structuredClone(frames[i]!);
      else delete container[isolationKey];
    }
    return { ...message, [TABLE_FIELD]: container };
  });
}

function captureTarget(scope: SwipeScope, index: number, deliveredSlot?: number) {
  const chat = getChatArray_ACU();
  const selected = readTailSwipe_ACU(chat, index);
  if (!scope.isCurrent() || !selected) return null;
  const { message, swipes } = selected;
  const slot = deliveredSlot ?? selected.slot;
  const body = deliveredSlot === undefined ? selected.body : swipes[slot];
  if (!body || swipes.indexOf(body) !== swipes.lastIndexOf(body)) return null;
  const messages = [...chat];
  const prefixBodies = chat.slice(0, index).map(item => item?.mes ?? item?.message);
  const identity = getActiveChatStorageIdentity_ACU(chat);
  const mode = getCurrentStorageMode();
  const assertCurrent = () => {
    const current = readTailSwipe_ACU(chat, index);
    if (!scope.isCurrent() || getChatArray_ACU() !== chat || getActiveChatStorageIdentity_ACU(chat) !== identity || getCurrentStorageMode() !== mode
      || current?.message !== message || current.swipes[slot] !== body
      || (deliveredSlot === undefined && (current.slot !== slot || current.body !== body))
      || messages.some((item, i) => item !== chat[i] || (i < index && (item?.mes ?? item?.message) !== prefixBodies[i]))) {
      throw new DOMException('Swipe 候选已变更。', 'AbortError');
    }
    if (hasRuntimeOnlyPendingSheets_ACU(scope)) throw new Error('请先保存表格改动，再切换 Swipe。');
  };
  return { chat, index, message, body, slot, swipes, assertCurrent };
}

function storageMode(chat: any[], isolationKey: string) {
  return resolveTableStorageStrategy_ACU(chat, isolationKey, {
    enabled: settings_ACU.dataIsolationEnabled, code: settings_ACU.dataIsolationCode,
  }).mode;
}

function readBoundBody(message: any, isolationKey: string, swipes: string[]): string | undefined {
  const binding = message[NATIVE_SWIPE_TABLE_FIELD_ACU]?.[isolationKey];
  if (binding?.version !== 2 || binding.entries !== undefined || !Number.isInteger(binding.slot)) return;
  const tag = readIsolatedTagData_ACU(message, isolationKey);
  const body = swipes[binding.slot];
  if (isV2TagData_ACU(tag)
    && typeof binding.head === 'string' && binding.head === tag.storageFrame.headRevision
    && body && binding.bodyFingerprint === getTableDataFingerprint_ACU(body)) return body;
}

function resolveRollView(
  chat: any[], index: number, isolationKey: string, swipes: string[], solePreviousCandidate?: string,
) {
  const message = chat[index];
  const previousArchive = message[NATIVE_SWIPE_TABLE_FIELD_ACU];
  const binding = previousArchive?.[isolationKey];
  const archive = readArchive(chat, index, isolationKey);
  const liveFingerprint = fingerprint(chat, isolationKey);
  const tag = readIsolatedTagData_ACU(message, isolationKey);
  const activeBody = archive?.activeBody ?? readBoundBody(message, isolationKey, swipes)
    ?? ((!binding || (binding.version === 2 && binding.entries === undefined)) ? solePreviousCandidate : undefined);
  const flightMode = getCurrentFlightModeState_ACU(chat, isolationKey);
  const liveHiddenRowIds = flightMode.enabled ? normalizeHiddenRowIds(flightMode.hiddenRowIds) : undefined;
  let flightBaseHiddenRowIds: string[] | undefined;
  if (flightMode.enabled) {
    if (archive) {
      const activeEntry = archive.entries.find(entry => entry.body === archive.activeBody);
      if (!validHiddenRowIds(archive.baseHiddenRowIds) || !validHiddenRowIds(activeEntry?.hiddenRowIds)
        || !equal(normalizeHiddenRowIds(activeEntry.hiddenRowIds), liveHiddenRowIds)) {
        return 'unsupported' as const;
      }
      flightBaseHiddenRowIds = normalizeHiddenRowIds(archive.baseHiddenRowIds);
    } else if (!tag) {
      flightBaseHiddenRowIds = [...(liveHiddenRowIds ?? [])];
    }
  }
  if (!activeBody || swipes.filter(item => item === activeBody).length !== 1
    || (archive && archive.activeFingerprint !== liveFingerprint)
    || readActiveProvisionalBridge_ACU(chat, isolationKey)) return 'unsupported' as const;
  const rollBase = archive ? archive.base[index] : rollTailTag(tag);
  if (rollBase === undefined) return 'unsupported_checkpoint' as const;
  const base = { ...archive?.base, [index]: rollBase };
  const detached = withFrames(chat, isolationKey, base);
  const mode = storageMode(detached, isolationKey);
  if (mode === 'legacy-v1') return 'unsupported_checkpoint' as const;
  return {
    previousArchive, archive, liveFingerprint, tag, activeBody, base, detached, mode,
    flightMode, liveHiddenRowIds, flightBaseHiddenRowIds,
  };
}

/** Share the reply-local rollback with physical deletion, which preserves the surviving history. */
export function readDeletedReplyRollback_ACU(chat: any[], deleted: any, chatKey: string, isolationKey: string) {
  if (!deleted?.[NATIVE_SWIPE_TABLE_FIELD_ACU]?.[isolationKey]
    || hasRuntimeOnlyPendingSheets_ACU({ chatKey, isolationKey })) return null;
  const before = [...chat, deleted];
  const index = chat.length;
  const selected = readTailSwipe_ACU(before, index);
  if (!selected?.body) return null;
  const view = resolveRollView(before, index, isolationKey, selected.swipes);
  if (typeof view === 'string' || view.activeBody !== selected.body) return null;
  // 物理删楼链路不会回滚 chatMetadata.flightModeByIsolationKey.hiddenRowIds：
  // 仅当本楼明确未改变 hiddenRowIds（与基底一致）时才放行，否则保持 fail-closed。
  if (view.flightMode.enabled && (
    view.flightBaseHiddenRowIds === undefined
    || !equal(view.flightBaseHiddenRowIds, view.liveHiddenRowIds)
  )) return null;
  return {
    tailTag: view.base[index],
    isCurrent: () => getChatArray_ACU() === chat && chat.length === index
      && chat.every((message, i) => message === before[i])
      && deleted[NATIVE_SWIPE_TABLE_FIELD_ACU] === view.previousArchive
      && fingerprint(before, isolationKey) === view.liveFingerprint
      && (!view.flightMode.enabled || equal(
        normalizeHiddenRowIds(getCurrentFlightModeState_ACU(chat, isolationKey).hiddenRowIds),
        view.liveHiddenRowIds,
      )),
  };
}

async function resolveFlightBaseHiddenRowIds(
  chat: any[],
  view: Exclude<ReturnType<typeof resolveRollView>, string>,
  isolationKey: string,
  baseData: Record<string, any> | null,
): Promise<{ ok: true; baseHiddenRowIds?: string[] } | { ok: false }> {
  if (!view.flightMode.enabled) return { ok: true, baseHiddenRowIds: undefined };
  if (view.flightBaseHiddenRowIds !== undefined) return { ok: true, baseHiddenRowIds: view.flightBaseHiddenRowIds };
  const liveReplay = await loadTableStateFromFramesV2Detailed_ACU(chat, isolationKey, REPLAY_OPTIONS);
  if (liveReplay?.baseKind !== 'full_checkpoint'
    || liveReplay.requiresCheckpointConvergence
    || liveReplay.compatibilityRepairs?.length
    || !liveReplay.data) {
    return { ok: false };
  }
  if (hasBigSummaryRowIncrease(baseData, liveReplay.data, view.flightMode.bigSummarySheetKey)) {
    return { ok: false };
  }
  return { ok: true, baseHiddenRowIds: [...(view.liveHiddenRowIds ?? [])] };
}

/** Read the same roll view before the new candidate body exists, including flight-mode hidden rows if enabled. */
export async function readNativeSwipeWorldbookProjection_ACU(
  intent: NativeSwipeTableIntent_ACU, chatKey: string, isolationKey: string, assertCurrent: () => void,
): Promise<{ data: Record<string, any>; flightModeOverride?: FlightModeState_ACU }> {
  assertCurrent();
  const chat = getChatArray_ACU();
  const selection = readTailSwipe_ACU(chat, intent.index);
  if (!selection || selection.message !== intent.message || selection.slot !== intent.slot
    || selection.slot !== selection.swipes.length) throw new DOMException('Swipe 候选已变更。', 'AbortError');
  if (hasRuntimeOnlyPendingSheets_ACU({ chatKey, isolationKey })) throw new Error('当前表格有未保存的改动。');
  const view = resolveRollView(chat, intent.index, isolationKey, selection.swipes, intent.slot === 1 ? intent.previousBody : undefined);
  if (typeof view === 'string') throw new Error('无法确认 Swipe 前的表格基底。');
  let baseData: Record<string, any> = {};
  if (view.mode !== 'empty') {
    const replay = await loadTableStateFromFramesV2Detailed_ACU(view.detached, isolationKey, REPLAY_OPTIONS);
    assertCurrent();
    if (view.liveFingerprint !== fingerprint(chat, isolationKey)
      || view.previousArchive !== intent.message[NATIVE_SWIPE_TABLE_FIELD_ACU]) {
      throw new Error('准备正文世界书期间，当前表格已变更。');
    }
    if (replay?.baseKind !== 'full_checkpoint' || replay.requiresCheckpointConvergence || replay.compatibilityRepairs?.length || !replay.data) {
      throw new Error('无法回放 Swipe 正文请求的表格基底。');
    }
    baseData = replay.data;
  }
  const flightResolved = await resolveFlightBaseHiddenRowIds(chat, view, isolationKey, baseData);
  assertCurrent();
  if (view.liveFingerprint !== fingerprint(chat, isolationKey)
    || view.previousArchive !== intent.message[NATIVE_SWIPE_TABLE_FIELD_ACU]
    || (view.flightMode.enabled && !equal(normalizeHiddenRowIds(getCurrentFlightModeState_ACU(chat, isolationKey).hiddenRowIds), view.liveHiddenRowIds))) {
    throw new Error('准备正文世界书期间，当前表格已变更。');
  }
  if (!flightResolved.ok) {
    throw new Error('无法确认经典表格模式在 Swipe 前的隐藏纪要基底。');
  }
  return view.flightMode.enabled
    ? { data: baseData, flightModeOverride: { ...view.flightMode, hiddenRowIds: flightResolved.baseHiddenRowIds ?? [] } }
    : { data: baseData };
}

/** Read the same roll view before the new candidate body exists. */
export async function readNativeSwipeWorldbookData_ACU(
  intent: NativeSwipeTableIntent_ACU, chatKey: string, isolationKey: string, assertCurrent: () => void,
): Promise<Record<string, any>> {
  const projection = await readNativeSwipeWorldbookProjection_ACU(intent, chatKey, isolationKey, assertCurrent);
  return projection.data;
}

async function publishCandidate(
  target: NonNullable<ReturnType<typeof captureTarget>>, scope: SwipeScope, projection: any[],
  archive: SwipeArchive, assertBase: () => void,
  indices: readonly number[] = Object.keys(archive.base).map(Number),
  targetHiddenRowIds?: string[],
): Promise<boolean> {
  const { chat, index, message } = target;
  const { isolationKey } = scope;
  const mode = storageMode(projection, isolationKey);
  if (mode === 'legacy-v1') return false;
  if (mode === 'v2') {
    const replay = await loadTableStateFromFramesV2Detailed_ACU(projection, isolationKey, REPLAY_OPTIONS);
    if (replay?.baseKind !== 'full_checkpoint' || replay.requiresCheckpointConvergence || replay.compatibilityRepairs?.length) return false;
  }

  const writeSet = [{ kind: 'all' as const }];
  return runTableWriteTransaction_ACU({
    source: 'auto_fill', reason: 'native_swipe', chatKey: scope.chatKey, isolationKey,
    writeSet, workingDataMode: 'none',
  }, tx => tx.runCommit(async () => {
    assertBase();
    tx.assertFresh?.('native_swipe_publish');
    const changes = indices.flatMap(i => {
      const tag = readIsolatedTagData_ACU(projection[i], isolationKey);
      if (equal(tag, readIsolatedTagData_ACU(chat[i], isolationKey))) return [];
      const item = chat[i];
      const replacement = cloneIsolatedData_ACU(item);
      if (tag) replacement[isolationKey] = structuredClone(tag);
      else delete replacement[isolationKey];
      return [{ i, item, previous: item[TABLE_FIELD], replacement }];
    });
    const previousArchive = message[NATIVE_SWIPE_TABLE_FIELD_ACU];
    const replacementArchive = { ...previousArchive, [isolationKey]: archive };
    const currentFlightMode = getCurrentFlightModeState_ACU(chat, isolationKey);
    const shouldStageHiddenRows = currentFlightMode.enabled && targetHiddenRowIds !== undefined
      && !equal(normalizeHiddenRowIds(currentFlightMode.hiddenRowIds), normalizeHiddenRowIds(targetHiddenRowIds));
    const rollbackHiddenRows = shouldStageHiddenRows
      ? stageFlightModeHiddenRowIds_ACU(normalizeHiddenRowIds(targetHiddenRowIds), chat, isolationKey)
      : null;
    for (const { item, replacement } of changes) item[TABLE_FIELD] = replacement;
    message[NATIVE_SWIPE_TABLE_FIELD_ACU] = replacementArchive;
    try {
      await saveChatToHostStrict_ACU({ verifyFields: [
        ...changes.map(({ i }) => ({ messageIndex: i, field: TABLE_FIELD })),
        { messageIndex: index, field: NATIVE_SWIPE_TABLE_FIELD_ACU },
      ] });
      bumpTableReplayGeneration_ACU();
      return true;
    } catch (error) {
      rollbackHiddenRows?.();
      for (const { item, previous, replacement } of changes) {
        if (item[TABLE_FIELD] !== replacement) continue;
        if (previous === undefined) delete item[TABLE_FIELD];
        else item[TABLE_FIELD] = previous;
      }
      if (message[NATIVE_SWIPE_TABLE_FIELD_ACU] === replacementArchive) {
        if (previousArchive === undefined) delete message[NATIVE_SWIPE_TABLE_FIELD_ACU];
        else message[NATIVE_SWIPE_TABLE_FIELD_ACU] = previousArchive;
      }
      throw error;
    }
  }));
}

function assertUnchanged(
  target: NonNullable<ReturnType<typeof captureTarget>>, isolationKey: string,
  previousArchive: unknown, activeFingerprint: string, expectedHiddenRowIds?: string[],
): void {
  target.assertCurrent();
  const flightMode = getCurrentFlightModeState_ACU(target.chat, isolationKey);
  if (target.message[NATIVE_SWIPE_TABLE_FIELD_ACU] !== previousArchive
    || fingerprint(target.chat, isolationKey) !== activeFingerprint
    || (expectedHiddenRowIds !== undefined && (!flightMode.enabled || !equal(normalizeHiddenRowIds(flightMode.hiddenRowIds), expectedHiddenRowIds)))) {
    throw new DOMException('Swipe 表格基底已变更。', 'AbortError');
  }
}

export async function restoreNativeSwipeTableCandidate_ACU(scope: SwipeScope, index: number): Promise<NativeSwipeTableResult_ACU> {
  const target = captureTarget(scope, index);
  if (!target) return 'unchanged';
  const { chat, body, message } = target;
  const { isolationKey } = scope;
  const archive = readArchive(chat, index, isolationKey);
  if (!archive || archive.activeBody === body) return 'unchanged';
  const candidate = archive.entries.find(entry => entry.body === body);
  const flightMode = getCurrentFlightModeState_ACU(chat, isolationKey);
  let liveHiddenRowIds: string[] | undefined;
  let candidateHiddenRowIds: string[] | undefined;
  if (flightMode.enabled) {
    liveHiddenRowIds = normalizeHiddenRowIds(flightMode.hiddenRowIds);
    const activeEntry = archive.entries.find(entry => entry.body === archive.activeBody);
    if (!validHiddenRowIds(archive.baseHiddenRowIds)
      || !validHiddenRowIds(activeEntry?.hiddenRowIds)
      || !validHiddenRowIds(candidate?.hiddenRowIds)
      || !equal(normalizeHiddenRowIds(activeEntry.hiddenRowIds), liveHiddenRowIds)) {
      return 'unsupported';
    }
    candidateHiddenRowIds = normalizeHiddenRowIds(candidate.hiddenRowIds);
  }
  if (!candidate || archive.activeFingerprint !== fingerprint(chat, isolationKey)
    || readActiveProvisionalBridge_ACU(chat, isolationKey)) return 'unsupported';
  const previousArchive = message[NATIVE_SWIPE_TABLE_FIELD_ACU];
  const next = withFrames(chat, isolationKey, { ...archive.base, ...candidate.frames });
  const saved = await publishCandidate(target, scope, next, {
    ...archive, activeBody: body, activeFingerprint: fingerprint(next, isolationKey),
  }, () => assertUnchanged(target, isolationKey, previousArchive, archive.activeFingerprint, liveHiddenRowIds), undefined, candidateHiddenRowIds);
  return saved ? 'updated' : 'unsupported_checkpoint';
}

/** Persist the unfilled candidate before the host can start generating or selecting again. */
export async function registerNativeSwipeTableCandidate_ACU(
  scope: SwipeScope, intent: NativeSwipeTableIntent_ACU,
): Promise<NativeSwipeTableResult_ACU | 'registered'> {
  const { index } = intent;
  const target = captureTarget(scope, index, intent.slot);
  if (!target || target.message !== intent.message) return 'unchanged';
  const { body, swipes } = target;
  const { isolationKey } = scope;
  const view = resolveRollView(target.chat, index, isolationKey, swipes, intent.slot === 1 ? intent.previousBody : undefined);
  if (typeof view === 'string') return view;
  const {
    previousArchive, archive, liveFingerprint, tag, activeBody, base, detached,
    flightMode, liveHiddenRowIds,
  } = view;
  if (activeBody === body) return 'unsupported';

  const assertBase = () => assertUnchanged(target, isolationKey, previousArchive, liveFingerprint, liveHiddenRowIds);
  let baseHiddenRowIds: string[] | undefined;
  if (flightMode.enabled) {
    let baseData: Record<string, any> | null = {};
    if (view.flightBaseHiddenRowIds === undefined && view.mode !== 'empty') {
      const baseReplay = await loadTableStateFromFramesV2Detailed_ACU(detached, isolationKey, REPLAY_OPTIONS);
      assertBase();
      if (baseReplay?.baseKind !== 'full_checkpoint' || baseReplay.requiresCheckpointConvergence || baseReplay.compatibilityRepairs?.length || !baseReplay.data) {
        return 'unsupported_checkpoint';
      }
      baseData = baseReplay.data;
    }
    const flightResolved = await resolveFlightBaseHiddenRowIds(target.chat, view, isolationKey, baseData);
    assertBase();
    if (!flightResolved.ok) return 'unsupported';
    baseHiddenRowIds = flightResolved.baseHiddenRowIds;
  }

  const existingEntries: Candidate[] = archive?.entries ?? [{
    body: activeBody,
    frames: { [index]: tag },
    ...(flightMode.enabled ? { hiddenRowIds: [...(liveHiddenRowIds ?? [])] } : {}),
  }];
  const entries = existingEntries.filter(entry => entry.body !== body && swipes.includes(entry.body));
  const nextEntry: Candidate = {
    body,
    frames: {},
    ...(flightMode.enabled ? { hiddenRowIds: [...(baseHiddenRowIds ?? [])] } : {}),
  };
  const next: SwipeArchive = {
    version: 2, activeBody: body, activeFingerprint: fingerprint(detached, isolationKey),
    base,
    ...(flightMode.enabled ? { baseHiddenRowIds: [...(baseHiddenRowIds ?? [])] } : {}),
    entries: [...entries, nextEntry],
  };
  if (!await publishCandidate(target, scope, detached, next, assertBase, undefined, baseHiddenRowIds)) return 'unsupported_checkpoint';
  const hiddenChanged = flightMode.enabled && !equal(liveHiddenRowIds ?? [], baseHiddenRowIds ?? []);
  return next.activeFingerprint === liveFingerprint && !hiddenChanged ? 'registered' : 'updated';
}

export async function refillNativeSwipeTableCandidate_ACU(
  scope: SwipeScope, intent: NativeSwipeTableIntent_ACU, fill: (view: TableFillChatView_ACU) => Promise<boolean>,
): Promise<NativeSwipeTableResult_ACU> {
  const target = captureTarget(scope, intent.index);
  if (!target || target.message !== intent.message || target.slot !== intent.slot) return 'unchanged';
  const { chat, index, message, body } = target;
  const { isolationKey } = scope;
  const archive = readArchive(chat, index, isolationKey);
  const liveFingerprint = fingerprint(chat, isolationKey);
  if (!archive || archive.activeBody !== body || archive.activeFingerprint !== liveFingerprint) return 'unsupported';
  const active = archive.entries.find(entry => entry.body === body)!;
  const flightMode = getCurrentFlightModeState_ACU(chat, isolationKey);
  let liveHiddenRowIds: string[] | undefined;
  if (flightMode.enabled) {
    liveHiddenRowIds = normalizeHiddenRowIds(flightMode.hiddenRowIds);
    if (!validHiddenRowIds(archive.baseHiddenRowIds)
      || !validHiddenRowIds(active.hiddenRowIds)
      || !equal(normalizeHiddenRowIds(active.hiddenRowIds), liveHiddenRowIds)) {
      return 'unsupported';
    }
  }
  const previousArchive = message[NATIVE_SWIPE_TABLE_FIELD_ACU];
  const assertBase = () => assertUnchanged(target, isolationKey, previousArchive, liveFingerprint, liveHiddenRowIds);
  const detached = withFrames(chat, isolationKey, {});
  if (flightMode.enabled) {
    setDetachedFlightModeState_ACU(detached, isolationKey, {
      ...flightMode,
      hiddenRowIds: [...(liveHiddenRowIds ?? [])],
    });
  }
  const baseline = readFrames(detached, isolationKey);
  const base = { ...archive.base };
  const frames = { ...active.frames };
  const shared = new Map<number, Tag | null>();
  let sharedHiddenRowIds: string[] | undefined;
  const candidateIndices = new Set(archive.entries.flatMap(entry => Object.keys(entry.frames).map(Number)));
  let canShareHistory = Object.keys(active.frames).length === 0;
  if (!await fill({
    chat: detached,
    assertCurrent: assertBase,
    onFramesPersisted(batchEndIndex, indices) {
      // Earlier batches can share their writes while their input and affected frames are still common.
      if (!canShareHistory || batchEndIndex === undefined || batchEndIndex < 0 || batchEndIndex >= index
        || indices.some(i => i >= index || candidateIndices.has(i))) {
        canShareHistory = false;
        return;
      }
      for (const i of indices) shared.set(i, structuredClone(readIsolatedTagData_ACU(detached[i], isolationKey)));
      if (flightMode.enabled) {
        sharedHiddenRowIds = normalizeHiddenRowIds(getCurrentFlightModeState_ACU(detached, isolationKey).hiddenRowIds);
      }
    },
  })) return 'unchanged';
  assertBase();

  const changedIndices: number[] = [];
  for (const [i, value] of readFrames(detached, isolationKey).entries()) {
    const sharedFrame = shared.get(i);
    if (equal(value, baseline[i]) && (sharedFrame === undefined || equal(sharedFrame, baseline[i]))) continue;
    changedIndices.push(i);
    if (sharedFrame !== undefined && equal(value, sharedFrame)) {
      delete base[i];
      delete frames[i];
      continue;
    }
    if (sharedFrame !== undefined) base[i] = sharedFrame;
    else if (!hasFrame(base, i)) base[i] = baseline[i];
    if (equal(value, base[i])) delete frames[i];
    else frames[i] = value;
  }
  const candidateHiddenRowIds = flightMode.enabled
    ? normalizeHiddenRowIds(getCurrentFlightModeState_ACU(detached, isolationKey).hiddenRowIds)
    : undefined;
  const hiddenChanged = flightMode.enabled && !equal(candidateHiddenRowIds ?? [], liveHiddenRowIds ?? []);
  if (!changedIndices.length && !hiddenChanged) return 'unchanged';
  const nextBaseHiddenRowIds = flightMode.enabled
    ? (sharedHiddenRowIds !== undefined
      ? normalizeHiddenRowIds([...(archive.baseHiddenRowIds ?? []), ...sharedHiddenRowIds])
      : normalizeHiddenRowIds(archive.baseHiddenRowIds))
    : undefined;
  const next: SwipeArchive = {
    ...archive,
    activeFingerprint: fingerprint(detached, isolationKey),
    base,
    ...(flightMode.enabled ? { baseHiddenRowIds: nextBaseHiddenRowIds } : {}),
    entries: archive.entries.map(entry => {
      if (entry === active) {
        return {
          body,
          frames,
          ...(flightMode.enabled ? { hiddenRowIds: candidateHiddenRowIds ?? [] } : {}),
        };
      }
      if (flightMode.enabled && sharedHiddenRowIds !== undefined) {
        return {
          ...entry,
          hiddenRowIds: normalizeHiddenRowIds([...(entry.hiddenRowIds ?? []), ...sharedHiddenRowIds]),
        };
      }
      return entry;
    }),
  };
  return await publishCandidate(target, scope, detached, next, assertBase, changedIndices, candidateHiddenRowIds) ? 'updated' : 'unsupported_checkpoint';
}
