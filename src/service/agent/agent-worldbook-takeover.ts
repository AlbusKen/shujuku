import type {
  AgentWorldbookControlSnapshot_ACU,
  AgentWorldbookControlSnapshotEntry_ACU,
} from '../../shared/models/agent-worldbook-model';
import type { StrictLorebookReadContext_ACU } from '../worldbook/pipeline';
import { getAgentRuntimeLorebookEntries_ACU } from './agent-worldbook-runtime-read';
import {
  deleteLorebookEntriesRequired_ACU,
  deleteLorebookEntries_ACU,
  getLorebookEntries_ACU,
  getLorebookEntriesRequired_ACU,
  setLorebookEntries_ACU,
  setLorebookEntriesRequired_ACU,
} from '../../data/gateways/worldbook-gateway';
import { persistTavernSettings_ACU } from '../../data/storage/tavern-storage';
import { hashUserInput_ACU, logWarn_ACU } from '../../shared/utils';
import { classifyLorebookReadError_ACU, summarizeLorebookRuntimeError_ACU } from '../../shared/lorebook-read-error';
import { buildAgentWorldbookSnapshotSelectionSignature_ACU } from '../../shared/agent-worldbook-snapshot';
import {
  AGENT_TAKEOVER_META_END_ACU,
  AGENT_TAKEOVER_META_START_ACU,
  createAgentTakeoverMetaPattern_ACU,
  stripAgentTakeoverMetaBlockStrict_ACU,
} from '../../shared/agent-worldbook-comment';
import {
  getAgentWorldbookSnapshotRevision_ACU,
  getAgentWorldbookSnapshotState_ACU,
  setAgentWorldbookSnapshotState_ACU,
  setAgentWorldbookSnapshotStateIfRevision_ACU,
} from './agent-worldbook-snapshot-state';
import { settings_ACU } from '../runtime/state-manager';
import {
  getWorldbookEntryKeywordsForSkillify_ACU,
  isWorldbookEntrySkillifyCandidate_ACU,
} from './agent-skillify-service';
import {
  hasUsableWorldbookSkillMeta_ACU,
  resolveAgentWorldbookFilterAvailability_ACU,
  stripWorldbookSkillMetaBlock_ACU,
} from './agent-worldbook-skill-meta';
import {
  deleteAgentWorldbookStateEntry_ACU,
  readAgentWorldbookStateFromWorldbooks_ACU,
  resolveAgentWorldbookScopeBookNames_ACU,
  writeAgentWorldbookStateToWorldbook_ACU,
} from './agent-worldbook-config-meta';
import { runExclusiveAgentWorldbookOperation_ACU } from './agent-worldbook-operation-lock';

export interface AgentWorldbookTakeoverEntryUpdate_ACU {
  bookName: string;
  uid: string | number;
}

export interface AgentWorldbookFinalGreenlightRef_ACU {
  bookName: string;
  uid: string | number;
  reason?: string;
}

export interface AgentWorldbookTakeoverResult_ACU {
  updated: boolean;
  reason?: string;
  bookNames: string[];
  selectionSignature: string;
  totalCandidates: number;
  disabled: number;
  failed: number;
  snapshot: AgentWorldbookControlSnapshot_ACU;
  updates: AgentWorldbookTakeoverEntryUpdate_ACU[];
}

export interface AgentWorldbookRestoreResult_ACU {
  updated: boolean;
  reason?: string;
  bookNames: string[];
  selectionSignature: string;
  restored: number;
  skipped: number;
  failed: number;
  updates: AgentWorldbookTakeoverEntryUpdate_ACU[];
}


export const AGENT_WORLDBOOK_SNAPSHOT_COMMENT_ACU = 'TavernDB-ACU-AgentWorldbookSnapshot';
export const AGENT_FINAL_GENERATION_GREENLIGHT_COMMENT_ACU = 'TavernDB-ACU-AgentFinalGenerationGreenlights';

interface AgentWorldbookTakeoverMeta_ACU {
  version: 1;
  kind: 'agent_worldbook_takeover';
  selectionSignature: string;
  createdAt: number;
  previousEnabled: boolean;
  previousKeys?: string[];
  previousType?: string;
  commentHash?: string;
}

function normalizeBookNamesForTakeover_ACU(bookNames: unknown): string[] {
  if (!Array.isArray(bookNames)) return [];
  return [...new Set(bookNames.map(name => String(name || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function normalizeCommentText_ACU(comment: unknown): string {
  return typeof comment === 'string' ? comment : '';
}

function hasValidWorldbookUid_ACU(uid: unknown): uid is string | number {
  return uid !== null && uid !== undefined && String(uid).trim() !== '';
}

/**
 * 清绿灯专用 legacy cleanup helper：
 * - required read + required delete，宿主 API 缺失立即失败关闭；
 * - not-found（stale）隔离并继续，其余失败关闭。
 */
async function deleteInternalEntriesByComment_ACU(
  bookNames: string[],
  comment: string,
  options: { readContext?: StrictLorebookReadContext_ACU; onStaleBookNames?: (staleBookNames: string[]) => void } = {},
): Promise<{ deleted: number; staleBookNames: string[] }> {
  let deleted = 0;
  const staleBookNames: string[] = [];
  for (const bookName of normalizeBookNamesForTakeover_ACU(bookNames)) {
    let entries: any[];
    try {
      entries = await (options.readContext
        ? getAgentRuntimeLorebookEntries_ACU(bookName, options.readContext)
        : getLorebookEntriesRequired_ACU(bookName));
    } catch (error) {
      if (classifyLorebookReadError_ACU(error) === 'lorebook_not_found') {
        staleBookNames.push(bookName);
        continue;
      }
      throw error;
    }
    const matched = (entries || []).filter(entry => String(entry?.comment || '').trim() === comment && hasValidWorldbookUid_ACU(entry?.uid));
    if (matched.length === 0) continue;
    await deleteLorebookEntriesRequired_ACU(bookName, matched.map(entry => entry.uid));
    deleted += matched.length;
  }
  options.onStaleBookNames?.(staleBookNames);
  return { deleted, staleBookNames };
}

function normalizeAgentWorldbookRefs_ACU(greenlights: unknown): AgentWorldbookFinalGreenlightRef_ACU[] {
  if (!Array.isArray(greenlights)) return [];
  const normalized: AgentWorldbookFinalGreenlightRef_ACU[] = [];
  const seen = new Set<string>();

  for (const ref of greenlights) {
    if (!ref || typeof ref !== 'object') continue;
    const bookName = String((ref as any).bookName || '').trim();
    const uid = (ref as any).uid;
    if (!bookName || !hasValidWorldbookUid_ACU(uid)) continue;
    const key = `${bookName}\u0000${String(uid).trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const reason = String((ref as any).reason || '').trim();
    normalized.push(reason ? { bookName, uid, reason } : { bookName, uid });
  }

  return normalized;
}

function buildSnapshotUidSetByBook_ACU(snapshot: AgentWorldbookControlSnapshot_ACU): Map<string, Set<string>> {
  const uidSetByBook = new Map<string, Set<string>>();
  if (snapshot.active !== true) return uidSetByBook;

  for (const [bookName, entries] of Object.entries(snapshot.books || {})) {
    const normalizedBookName = String(bookName || '').trim();
    if (!normalizedBookName || !Array.isArray(entries)) continue;
    const uidSet = new Set<string>();
    for (const entry of entries) {
      if (!hasValidWorldbookUid_ACU(entry?.uid) || entry.takeoverStatus === 'pending') continue;
      uidSet.add(String(entry.uid));
    }
    if (uidSet.size > 0) uidSetByBook.set(normalizedBookName, uidSet);
  }

  return uidSetByBook;
}

function buildAllowedFinalGreenlightKeySet_ACU(greenlights: AgentWorldbookFinalGreenlightRef_ACU[], snapshotUidSetByBook: Map<string, Set<string>>): Set<string> {
  const allowed = new Set<string>();
  for (const ref of greenlights) {
    const bookName = String(ref.bookName || '').trim();
    const uid = String(ref.uid).trim();
    if (!snapshotUidSetByBook.get(bookName)?.has(uid)) continue;
    allowed.add(`${bookName}\u0000${uid}`);
  }
  return allowed;
}

function getSnapshotEntryForBookAndUid_ACU(
  snapshot: AgentWorldbookControlSnapshot_ACU,
  bookName: string,
  uid: unknown,
): AgentWorldbookControlSnapshotEntry_ACU | undefined {
  return (snapshot.books?.[bookName] || []).find(entry => String(entry?.uid) === String(uid));
}

function isFinalGenerationBlueLightEntry_ACU(entry: Record<string, any>): boolean {
  // SillyTavern constant worldbook entries are blue lights whenever enabled; keys do not affect triggering.
  return entry?.enabled !== false
    && String(entry?.type || '').trim().toLowerCase() === 'constant';
}

function buildFinalGreenlightKey_ACU(bookName: string, uid: unknown): string {
  return `${String(bookName || '').trim()}\u0000${String(uid ?? '').trim()}`;
}

/**
 * 清绿灯专用 patch helper：
 * - required read + required set，宿主 API 缺失立即失败关闭；
 * - not-found（竞态 stale）隔离该书并继续处理有效书；
 * - api 缺失/权限/契约/未知写入失败向上抛出（由 clearFinalGenerationGreenlights 失败关闭）。
 */
async function patchSnapshotEntries_ACU(
  snapshotUidSetByBook: Map<string, Set<string>>,
  buildPatch: (bookName: string, entry: Record<string, any>) => Record<string, any> | null,
  options: { readContext?: StrictLorebookReadContext_ACU } = {},
): Promise<{ patched: number; staleBookNames: string[] }> {
  let patched = 0;
  const staleBookNames: string[] = [];
  for (const [bookName, uidSet] of snapshotUidSetByBook.entries()) {
    let entries: any[];
    try {
      entries = await (options.readContext
        ? getAgentRuntimeLorebookEntries_ACU(bookName, options.readContext)
        : getLorebookEntriesRequired_ACU(bookName));
    } catch (error) {
      if (classifyLorebookReadError_ACU(error) === 'lorebook_not_found') {
        staleBookNames.push(bookName);
        continue;
      }
      throw error;
    }
    const patches = (entries || [])
      .filter(entry => uidSet.has(String(entry?.uid)))
      .map(entry => buildPatch(bookName, entry))
      .filter(Boolean) as Record<string, any>[];
    if (patches.length === 0) continue;
    await setLorebookEntriesRequired_ACU(bookName, patches);
    patched += patches.length;
  }
  return { patched, staleBookNames };
}

export function buildWorldbookSelectionSignature_ACU(bookNames: string[]): string {
  return buildAgentWorldbookSnapshotSelectionSignature_ACU(bookNames);
}

function buildActiveSnapshot_ACU(selectionSignature: string, books: Record<string, AgentWorldbookControlSnapshotEntry_ACU[]>): AgentWorldbookControlSnapshot_ACU {
  return { active: true, selectionSignature, createdAt: Date.now(), books };
}

function isTakeoverSnapshotEntryApplied_ACU(entry: AgentWorldbookControlSnapshotEntry_ACU): boolean {
  return entry.takeoverStatus !== 'pending';
}

function mergeSnapshotEntry_ACU(
  existingEntry: AgentWorldbookControlSnapshotEntry_ACU,
  incomingEntry: AgentWorldbookControlSnapshotEntry_ACU,
): AgentWorldbookControlSnapshotEntry_ACU {
  return {
    uid: existingEntry.uid,
    takeoverStatus: isTakeoverSnapshotEntryApplied_ACU(existingEntry) || isTakeoverSnapshotEntryApplied_ACU(incomingEntry)
      ? 'applied'
      : 'pending',
    previousEnabled: typeof existingEntry.previousEnabled === 'boolean'
      ? existingEntry.previousEnabled
      : incomingEntry.previousEnabled,
    previousKeys: Array.isArray(existingEntry.previousKeys)
      ? existingEntry.previousKeys
      : incomingEntry.previousKeys,
    previousType: existingEntry.previousType === undefined || existingEntry.previousType === null
      ? incomingEntry.previousType
      : existingEntry.previousType,
    commentHash: String(existingEntry.commentHash || '').trim() || incomingEntry.commentHash,
  };
}

function mergeSnapshotBooks_ACU(
  existingBooks: Record<string, AgentWorldbookControlSnapshotEntry_ACU[]>,
  candidateBooks: Record<string, AgentWorldbookControlSnapshotEntry_ACU[]>,
): Record<string, AgentWorldbookControlSnapshotEntry_ACU[]> {
  const mergedBooks: Record<string, AgentWorldbookControlSnapshotEntry_ACU[]> = {};
  for (const books of [existingBooks, candidateBooks]) {
    for (const [bookName, entries] of Object.entries(books || {})) {
      const normalizedBookName = String(bookName || '').trim();
      if (!normalizedBookName || !Array.isArray(entries)) continue;
      const mergedEntries = mergedBooks[normalizedBookName] || (mergedBooks[normalizedBookName] = []);
      const entryIndexByUid = new Map(mergedEntries.map((entry, index) => [String(entry?.uid), index]));
      for (const entry of entries) {
        if (!hasValidWorldbookUid_ACU(entry?.uid)) continue;
        const existingIndex = entryIndexByUid.get(String(entry.uid));
        if (existingIndex === undefined) {
          mergedEntries.push(entry);
          entryIndexByUid.set(String(entry.uid), mergedEntries.length - 1);
          continue;
        }
        mergedEntries[existingIndex] = mergeSnapshotEntry_ACU(mergedEntries[existingIndex], entry);
      }
    }
  }
  return Object.fromEntries(Object.entries(mergedBooks).filter(([, entries]) => entries.length > 0));
}

function setSnapshotEntryStatusByUpdates_ACU(
  books: Record<string, AgentWorldbookControlSnapshotEntry_ACU[]>,
  updates: AgentWorldbookTakeoverEntryUpdate_ACU[],
  takeoverStatus: 'pending' | 'applied',
): Record<string, AgentWorldbookControlSnapshotEntry_ACU[]> {
  const uidsByBook = new Map<string, Set<string>>();
  for (const update of updates) {
    const bookName = String(update.bookName || '').trim();
    if (!bookName || !hasValidWorldbookUid_ACU(update.uid)) continue;
    const uids = uidsByBook.get(bookName) || new Set<string>();
    uids.add(String(update.uid));
    uidsByBook.set(bookName, uids);
  }
  return Object.fromEntries(Object.entries(books || {}).map(([bookName, entries]) => [
    bookName,
    (entries || []).map(entry => uidsByBook.get(bookName)?.has(String(entry.uid))
      ? { ...entry, takeoverStatus }
      : entry),
  ]));
}

function markSnapshotBooksPending_ACU(
  books: Record<string, AgentWorldbookControlSnapshotEntry_ACU[]>,
): Record<string, AgentWorldbookControlSnapshotEntry_ACU[]> {
  return Object.fromEntries(Object.entries(books || {}).map(([bookName, entries]) => [
    bookName,
    (entries || []).map(entry => ({ ...entry, takeoverStatus: 'pending' })),
  ]));
}


function hasSnapshotEntriesAbsentFrom_ACU(
  existingBooks: Record<string, AgentWorldbookControlSnapshotEntry_ACU[]>,
  incomingBooks: Record<string, AgentWorldbookControlSnapshotEntry_ACU[]>,
): boolean {
  const mergedBooks = mergeSnapshotBooks_ACU(existingBooks, incomingBooks);
  for (const [bookName, entries] of Object.entries(incomingBooks || {})) {
    const existingEntriesByUid = new Map((existingBooks[bookName] || []).map(entry => [String(entry?.uid), entry]));
    const mergedEntriesByUid = new Map((mergedBooks[bookName] || []).map(entry => [String(entry?.uid), entry]));
    if ((entries || []).some(entry => {
      if (!hasValidWorldbookUid_ACU(entry?.uid)) return false;
      const existingEntry = existingEntriesByUid.get(String(entry.uid));
      const mergedEntry = mergedEntriesByUid.get(String(entry.uid));
      return !existingEntry
        || existingEntry.commentHash !== mergedEntry?.commentHash
        || existingEntry.previousType !== mergedEntry?.previousType
        || JSON.stringify(existingEntry.previousKeys) !== JSON.stringify(mergedEntry?.previousKeys)
        || existingEntry.previousEnabled !== mergedEntry?.previousEnabled;
    })) {
      return true;
    }
  }
  return false;
}

function buildInactiveSnapshot_ACU(selectionSignature = ''): AgentWorldbookControlSnapshot_ACU {
  return { active: false, selectionSignature, createdAt: 0, books: {} };
}

function stripTakeoverMetaBlock_ACU(comment: unknown): string {
  return stripAgentTakeoverMetaBlockStrict_ACU(comment);
}

function hasTakeoverMetaBlock_ACU(comment: unknown): boolean {
  return new RegExp(createAgentTakeoverMetaPattern_ACU().source).test(normalizeCommentText_ACU(comment));
}

function hasUnsupportedTakeoverMetaBlock_ACU(comment: unknown): boolean {
  const text = normalizeCommentText_ACU(comment);
  const pattern = createAgentTakeoverMetaPattern_ACU();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    try {
      const meta = JSON.parse(match[1].trim()) as Record<string, unknown>;
      if (meta.version !== 1 || meta.kind !== 'agent_worldbook_takeover') return true;
    } catch {
      return true;
    }
  }
  return false;
}

function normalizeTakeoverComparableComment_ACU(comment: unknown): string {
  return stripWorldbookSkillMetaBlock_ACU(stripTakeoverMetaBlock_ACU(comment));
}

function doesTakeoverSnapshotCommentHashMatch_ACU(snapshotCommentHash: string | undefined, currentComment: string): boolean {
  if (!snapshotCommentHash) return true;
  const strippedComment = stripTakeoverMetaBlock_ACU(currentComment);
  const comparableComment = stripWorldbookSkillMetaBlock_ACU(strippedComment);

  return hashUserInput_ACU(comparableComment) === snapshotCommentHash
    // Legacy snapshots created before Skill metadata was excluded from the comparable comment stored hashes that kept Skill metadata.
    || hashUserInput_ACU(strippedComment) === snapshotCommentHash;
}

function parseTakeoverMetaFromComment_ACU(comment: unknown): AgentWorldbookTakeoverMeta_ACU | null {
  const text = normalizeCommentText_ACU(comment);
  const pattern = createAgentTakeoverMetaPattern_ACU();
  const match = pattern.exec(text);
  if (!match) return null;
  try {
    const raw = JSON.parse(match[1].trim()) as Record<string, unknown>;
    if (raw.version !== 1 || raw.kind !== 'agent_worldbook_takeover') return null;
    const selectionSignature = String(raw.selectionSignature || '').trim();
    if (!selectionSignature) return null;
    const previousKeys = Array.isArray(raw.previousKeys) ? raw.previousKeys.map(key => String(key || '').trim()).filter(Boolean) : [];
    const previousType = raw.previousType === undefined || raw.previousType === null ? undefined : String(raw.previousType);
    const commentHash = String(raw.commentHash || '').trim();
    return {
      version: 1,
      kind: 'agent_worldbook_takeover',
      selectionSignature,
      createdAt: Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : 0,
      previousEnabled: raw.previousEnabled !== false,
      previousKeys,
      previousType,
      commentHash: commentHash || undefined,
    };
  } catch {
    return null;
  }
}

function buildTakeoverMetaComment_ACU(comment: unknown, selectionSignature: string, createdAt: number, snapshotEntry: AgentWorldbookControlSnapshotEntry_ACU): string {
  const baseComment = stripTakeoverMetaBlock_ACU(comment);
  const meta: AgentWorldbookTakeoverMeta_ACU = {
    version: 1,
    kind: 'agent_worldbook_takeover',
    selectionSignature,
    createdAt,
    previousEnabled: snapshotEntry.previousEnabled !== false,
    previousKeys: Array.isArray(snapshotEntry.previousKeys) ? snapshotEntry.previousKeys : [],
    previousType: snapshotEntry.previousType,
    commentHash: snapshotEntry.commentHash,
  };
  const metaBlock = `<!-- ${AGENT_TAKEOVER_META_START_ACU}\n${JSON.stringify(meta)}\n${AGENT_TAKEOVER_META_END_ACU} -->`;
  return [baseComment, metaBlock].filter(Boolean).join('\n\n');
}

function getLegacyPlotAgentWorldbookSnapshot_ACU(): AgentWorldbookControlSnapshot_ACU {
  const snapshot = (settings_ACU.plotSettings as any)?.agentWorldbookControlSnapshot;
  if (!snapshot || typeof snapshot !== 'object') return buildInactiveSnapshot_ACU();
  return {
    active: snapshot.active === true,
    selectionSignature: String(snapshot.selectionSignature || ''),
    createdAt: Number(snapshot.createdAt || 0),
    books: snapshot.books && typeof snapshot.books === 'object' ? snapshot.books : {},
  };
}

function clearLegacyPlotAgentWorldbookSnapshot_ACU(): boolean {
  if (!settings_ACU.plotSettings || typeof settings_ACU.plotSettings !== 'object') return false;
  if (!Object.prototype.hasOwnProperty.call(settings_ACU.plotSettings, 'agentWorldbookControlSnapshot')) return false;
  delete (settings_ACU.plotSettings as any).agentWorldbookControlSnapshot;
  persistTavernSettings_ACU();
  return true;
}

export function getPlotAgentWorldbookSnapshot_ACU(): AgentWorldbookControlSnapshot_ACU {
  return getAgentWorldbookSnapshotState_ACU();
}

export function setPlotAgentWorldbookSnapshot_ACU(snapshot: AgentWorldbookControlSnapshot_ACU): void {
  setAgentWorldbookSnapshotState_ACU(snapshot);
  plotAgentWorldbookSnapshotHydrated_ACU = true;
}

/**
 * 切换角色卡会话时丢弃上一会话的内存快照。
 * 持久 state 仍由下一次按当前角色绑定刷新时读取，不能在这里删除或改写世界书条目。
 */
export function resetPlotAgentWorldbookSessionSnapshot_ACU(): void {
  setAgentWorldbookSnapshotState_ACU(buildInactiveSnapshot_ACU());
  preTakeoverSnapshotResolutionPromisesBySignature_ACU.clear();
  plotAgentWorldbookSnapshotHydrated_ACU = false;
  plotAgentWorldbookSnapshotHydrationPromise_ACU = null;
}

/** 内存快照是否已从持久账本（或权威操作结果）填充过；页面刷新/会话切换后为 false。 */
let plotAgentWorldbookSnapshotHydrated_ACU = false;
let plotAgentWorldbookSnapshotHydrationPromise_ACU: Promise<void> | null = null;

/**
 * 确保内存快照至少水合过一次持久账本。
 * 供生成前的接管激活判定使用：页面刷新后内存快照为空，若不回读持久态，
 * 接管活跃期间的最终提示词过滤会在冷启动首轮被跳过。
 * 读取失败只记录警告并保持未水合（下轮重试），不阻断本轮生成。
 */
export async function ensurePlotAgentWorldbookSnapshotHydrated_ACU(): Promise<void> {
  if (plotAgentWorldbookSnapshotHydrated_ACU) return;
  if (!plotAgentWorldbookSnapshotHydrationPromise_ACU) {
    plotAgentWorldbookSnapshotHydrationPromise_ACU = refreshPlotAgentWorldbookSnapshotFromWorldbooks_ACU()
      .then((): void => undefined)
      .catch(error => {
        logWarn_ACU('[Agent世界书] 冷启动水合接管快照失败，本轮按未接管处理，下轮将重试。', error);
      })
      .finally(() => {
        plotAgentWorldbookSnapshotHydrationPromise_ACU = null;
      });
  }
  await plotAgentWorldbookSnapshotHydrationPromise_ACU;
}

export interface PreTakeoverWorldbookSnapshotResolution_ACU {
  snapshot: AgentWorldbookControlSnapshot_ACU;
  expectedSignature: string;
}

const preTakeoverSnapshotResolutionPromisesBySignature_ACU = new Map<string, Promise<PreTakeoverWorldbookSnapshotResolution_ACU>>();

async function readAndMaybeCachePlotAgentWorldbookSnapshot_ACU(
  resolvedBookNames: string[],
  selectionSignature: string,
  initialRevision: number,
  readContext?: StrictLorebookReadContext_ACU,
  options: { onStaleBookNames?: (staleBookNames: string[]) => void } = {},
): Promise<AgentWorldbookControlSnapshot_ACU> {
  const snapshot = await readPlotAgentWorldbookSnapshotFromStateOrLegacy_ACU(resolvedBookNames, selectionSignature, { readContext, onStaleBookNames: options.onStaleBookNames });
  setAgentWorldbookSnapshotStateIfRevision_ACU(initialRevision, snapshot);
  // CAS 失败也视为已水合：说明并发方已写入更新的权威快照。
  plotAgentWorldbookSnapshotHydrated_ACU = true;
  return snapshot;
}

/** 内部：带 stale 收集的刷新，供清绿灯预检使用（公共 refresh 保持原签名不变）。 */
async function refreshPlotAgentWorldbookSnapshotWithStale_ACU(
  readContext?: StrictLorebookReadContext_ACU,
): Promise<{ snapshot: AgentWorldbookControlSnapshot_ACU; staleBookNames: string[] }> {
  const initialRevision = getAgentWorldbookSnapshotRevision_ACU();
  const resolvedBookNames = await resolveTakeoverBookNames_ACU(readContext);
  const selectionSignature = buildWorldbookSelectionSignature_ACU(resolvedBookNames);
  let staleBookNames: string[] = [];
  const snapshot = await readPlotAgentWorldbookSnapshotFromStateOrLegacy_ACU(
    resolvedBookNames,
    selectionSignature,
    { readContext, onStaleBookNames: (stale) => { staleBookNames = stale; }, backfillMissingMeta: false },
  );
  setAgentWorldbookSnapshotStateIfRevision_ACU(initialRevision, snapshot);
  plotAgentWorldbookSnapshotHydrated_ACU = true;
  return { snapshot, staleBookNames };
}

export async function refreshPlotAgentWorldbookSnapshotFromWorldbooks_ACU(readContext?: StrictLorebookReadContext_ACU, options: { readOnly?: boolean } = {}): Promise<AgentWorldbookControlSnapshot_ACU> {
  const initialRevision = getAgentWorldbookSnapshotRevision_ACU();
  const resolvedBookNames = await resolveTakeoverBookNames_ACU(readContext);
  const selectionSignature = buildWorldbookSelectionSignature_ACU(resolvedBookNames);
  if (options.readOnly) {
    return readPlotAgentWorldbookSnapshotFromStateOrLegacy_ACU(resolvedBookNames, selectionSignature, { readContext, readOnly: true });
  }
  return readAndMaybeCachePlotAgentWorldbookSnapshot_ACU(resolvedBookNames, selectionSignature, initialRevision, readContext);
}

/** 为普通剧情与填表读取解析持久化接管前视图；expectedSignature 独立于返回快照，防止快照自签名。 */
export async function resolvePreTakeoverWorldbookSnapshot_ACU(readContext?: StrictLorebookReadContext_ACU, options: { readOnly?: boolean } = {}): Promise<PreTakeoverWorldbookSnapshotResolution_ACU> {
  const initialRevision = getAgentWorldbookSnapshotRevision_ACU();
  const resolvedBookNames = await resolveTakeoverBookNames_ACU(readContext);
  const expectedSignature = buildWorldbookSelectionSignature_ACU(resolvedBookNames);
  if (options.readOnly) {
    const snapshot = await readPlotAgentWorldbookSnapshotFromStateOrLegacy_ACU(resolvedBookNames, expectedSignature, { readContext, readOnly: true });
    return { snapshot, expectedSignature };
  }
  const existingPromise = preTakeoverSnapshotResolutionPromisesBySignature_ACU.get(expectedSignature);
  if (existingPromise) return existingPromise;

  const resolutionPromise = readAndMaybeCachePlotAgentWorldbookSnapshot_ACU(
    resolvedBookNames,
    expectedSignature,
    initialRevision,
    readContext,
  ).then(snapshot => ({ snapshot, expectedSignature }));
  preTakeoverSnapshotResolutionPromisesBySignature_ACU.set(expectedSignature, resolutionPromise);
  const clearResolutionPromise = () => {
    if (preTakeoverSnapshotResolutionPromisesBySignature_ACU.get(expectedSignature) === resolutionPromise) {
      preTakeoverSnapshotResolutionPromisesBySignature_ACU.delete(expectedSignature);
    }
  };
  void resolutionPromise.then(
    clearResolutionPromise,
    clearResolutionPromise,
  );
  return resolutionPromise;
}

async function backfillMissingTakeoverMeta_ACU(snapshot: AgentWorldbookControlSnapshot_ACU): Promise<void> {
  for (const [bookName, snapshotEntries] of Object.entries(snapshot.books || {})) {
    if (!bookName || !Array.isArray(snapshotEntries) || snapshotEntries.length === 0) continue;
    try {
      const snapshotEntriesByUid = new Map(
        snapshotEntries
          .filter(snapshotEntry => hasValidWorldbookUid_ACU(snapshotEntry?.uid))
          .map(snapshotEntry => [String(snapshotEntry.uid), snapshotEntry]),
      );
      const entries = await getLorebookEntries_ACU(bookName);
      const patches = (entries || []).flatMap(entry => {
        const snapshotEntry = snapshotEntriesByUid.get(String(entry?.uid));
        if (!snapshotEntry) return [];
        const currentComment = normalizeCommentText_ACU(entry?.comment);
        if (hasTakeoverMetaBlock_ACU(currentComment)
          || !doesTakeoverSnapshotCommentHashMatch_ACU(snapshotEntry.commentHash, currentComment)
          || (entry?.enabled !== false && !isFinalGenerationBlueLightEntry_ACU(entry))) return [];
        return [{
          uid: entry.uid,
          comment: buildTakeoverMetaComment_ACU(currentComment, snapshot.selectionSignature, snapshot.createdAt, snapshotEntry),
        }];
      });
      if (patches.length > 0) await setLorebookEntries_ACU(bookName, patches);
    } catch (error) {
      logWarn_ACU(`[Agent世界书] 为旧接管条目补写可分享恢复元数据失败：${bookName}`, error);
    }
  }
}

async function readPlotAgentWorldbookSnapshotFromStateOrLegacy_ACU(
  resolvedBookNames: string[],
  selectionSignature: string,
  options: { backfillMissingMeta?: boolean; readOnly?: boolean; readContext?: StrictLorebookReadContext_ACU; onStaleBookNames?: (staleBookNames: string[]) => void } = {},
): Promise<AgentWorldbookControlSnapshot_ACU> {
  const state = await readAgentWorldbookStateFromWorldbooks_ACU(options.readContext);
  const rawActiveStateSnapshot = state.snapshot.active === true && state.snapshot.selectionSignature === selectionSignature
    ? state.snapshot
    : null;
  // 预检可能识别出 stale 书：先收集 staleBookNames，最后统一决定是否剪除 active snapshot，
  // 避免旧 snapshot 把 stale 书带回 patch。无 stale 时不拷贝，保持对象身份（hydration 共享引用）。
  let activeStateSnapshot = rawActiveStateSnapshot;

  const snapshotBooks: Record<string, AgentWorldbookControlSnapshotEntry_ACU[]> = {};
  const staleBookNames: string[] = [];
  let createdAt = 0;
  for (const bookName of resolvedBookNames) {
    let entries: any[];
    try {
      entries = await getAgentRuntimeLorebookEntries_ACU(bookName, options.readContext);
    } catch (error) {
      if (classifyLorebookReadError_ACU(error) === 'lorebook_not_found') {
        staleBookNames.push(bookName);
        continue;
      }
      throw error;
    }
    const bookSnapshot: AgentWorldbookControlSnapshotEntry_ACU[] = [];
    for (const entry of entries || []) {
      if (!hasValidWorldbookUid_ACU(entry?.uid)) continue;
      const meta = parseTakeoverMetaFromComment_ACU(entry?.comment);
      if (!meta || meta.selectionSignature !== selectionSignature) continue;
      bookSnapshot.push({
        uid: entry.uid,
        takeoverStatus: 'applied',
        previousEnabled: meta.previousEnabled !== false,
        previousKeys: Array.isArray(meta.previousKeys) ? meta.previousKeys : [],
        previousType: meta.previousType,
        commentHash: meta.commentHash,
      });
      createdAt = Math.max(createdAt, meta.createdAt || 0);
    }
    if (bookSnapshot.length > 0) snapshotBooks[bookName] = bookSnapshot;
  }
  if (staleBookNames.length > 0) {
    logWarn_ACU('[Agent世界书] 接管扫描中隔离失效世界书引用（可能已删除/改名），其余世界书继续工作。', {
      phase: 'read_pre_takeover_snapshot',
      staleBookNames,
    });
    if (activeStateSnapshot) {
      const staleSet = new Set(staleBookNames);
      const hasStaleBook = Object.keys(activeStateSnapshot.books || {}).some(bookName => staleSet.has(bookName));
      if (hasStaleBook) {
        const prunedBooks: Record<string, AgentWorldbookControlSnapshotEntry_ACU[]> = {};
        for (const [bookName, entries] of Object.entries(activeStateSnapshot.books || {})) {
          if (staleSet.has(bookName)) continue;
          prunedBooks[bookName] = entries;
        }
        activeStateSnapshot = { ...activeStateSnapshot, books: prunedBooks };
      }
    }
    options.onStaleBookNames?.(staleBookNames);
  }

  if (Object.keys(snapshotBooks).length > 0) {
    const mergedBooks = mergeSnapshotBooks_ACU(activeStateSnapshot?.books || {}, snapshotBooks);
    const mergedSnapshot = {
      active: true,
      selectionSignature,
      createdAt: Math.max(activeStateSnapshot?.createdAt || 0, createdAt || 0) || Date.now(),
      books: mergedBooks,
    };
    if (!options.readOnly && (!activeStateSnapshot || hasSnapshotEntriesAbsentFrom_ACU(activeStateSnapshot.books, snapshotBooks))) {
      try {
        const writeResult = await writeAgentWorldbookStateToWorldbook_ACU({ snapshot: mergedSnapshot });
        if (!writeResult.updated) {
          logWarn_ACU('[Agent世界书] 迁移接管快照到独立状态条目未落盘，将继续保留条目 meta 作为恢复依据。');
          return activeStateSnapshot || buildInactiveSnapshot_ACU(selectionSignature);
        }
      } catch (error) {
        logWarn_ACU('[Agent世界书] 迁移旧接管快照到独立状态条目失败。', error);
        return activeStateSnapshot || buildInactiveSnapshot_ACU(selectionSignature);
      }
    }
    if (!options.readOnly && options.backfillMissingMeta !== false) {
      await backfillMissingTakeoverMeta_ACU(mergedSnapshot);
    }
    return mergedSnapshot;
  }

  if (activeStateSnapshot) {
    if (!options.readOnly && options.backfillMissingMeta !== false) {
      await backfillMissingTakeoverMeta_ACU(activeStateSnapshot);
    }
    return activeStateSnapshot;
  }

  const legacySnapshot = getLegacyPlotAgentWorldbookSnapshot_ACU();
  const snapshot = legacySnapshot.active === true && legacySnapshot.selectionSignature === selectionSignature
    ? legacySnapshot
    : buildInactiveSnapshot_ACU(selectionSignature);
  return snapshot;
}

async function readPlotAgentWorldbookStateSnapshotOnly_ACU(selectionSignature: string): Promise<AgentWorldbookControlSnapshot_ACU> {
  const state = await readAgentWorldbookStateFromWorldbooks_ACU();
  return state.snapshot.active === true && state.snapshot.selectionSignature === selectionSignature ? state.snapshot : buildInactiveSnapshot_ACU(selectionSignature);
}

export function isWorldbookTakeoverActive_ACU(): boolean {
  return getPlotAgentWorldbookSnapshot_ACU().active === true;
}

async function resolveTakeoverBookNames_ACU(readContext?: StrictLorebookReadContext_ACU): Promise<string[]> {
  return normalizeBookNamesForTakeover_ACU(await resolveAgentWorldbookScopeBookNames_ACU(undefined, readContext));
}

function buildSnapshotEntry_ACU(entry: Record<string, any>): AgentWorldbookControlSnapshotEntry_ACU | null {
  if (!hasValidWorldbookUid_ACU(entry?.uid)) return null;
  const previousType = entry?.type === undefined || entry?.type === null ? undefined : String(entry.type);
  const comment = normalizeTakeoverComparableComment_ACU(entry?.comment);
  return {
    uid: entry.uid,
    previousEnabled: entry.enabled !== false,
    previousKeys: getWorldbookEntryKeywordsForSkillify_ACU(entry),
    previousType,
    commentHash: hashUserInput_ACU(comment),
  };
}

async function collectTakeoverCandidates_ACU(bookNames: string[]): Promise<{
  snapshotBooks: Record<string, AgentWorldbookControlSnapshotEntry_ACU[]>;
  updates: AgentWorldbookTakeoverEntryUpdate_ACU[];
}> {
  const snapshotBooks: Record<string, AgentWorldbookControlSnapshotEntry_ACU[]> = {};
  const updates: AgentWorldbookTakeoverEntryUpdate_ACU[] = [];

  for (const bookName of bookNames) {
    const entries = await getLorebookEntries_ACU(bookName);
    const bookSnapshot: AgentWorldbookControlSnapshotEntry_ACU[] = [];
    for (const entry of entries || []) {
      if (!isWorldbookEntrySkillifyCandidate_ACU(entry)) continue;
      if (!hasUsableWorldbookSkillMeta_ACU(entry?.comment)) continue;
      const snapshotEntry = buildSnapshotEntry_ACU(entry);
      if (!snapshotEntry) continue;
      bookSnapshot.push(snapshotEntry);
      updates.push({ bookName, uid: snapshotEntry.uid });
    }
    if (bookSnapshot.length > 0) snapshotBooks[bookName] = bookSnapshot;
  }

  return { snapshotBooks, updates };
}

async function reconcileExistingTakeoverSnapshotWithSkillMeta_ACU(
  existingSnapshot: AgentWorldbookControlSnapshot_ACU,
  selectionSignature: string,
): Promise<{
  snapshot: AgentWorldbookControlSnapshot_ACU;
  restored: number;
  skipped: number;
  failed: number;
  pruned: number;
  staleSnapshot: AgentWorldbookControlSnapshot_ACU;
}> {
  const keptBooks: Record<string, AgentWorldbookControlSnapshotEntry_ACU[]> = {};
  const staleBooks: Record<string, AgentWorldbookControlSnapshotEntry_ACU[]> = {};
  let pruned = 0;

  for (const [bookName, snapshotEntries] of Object.entries(existingSnapshot.books || {})) {
    const normalizedBookName = String(bookName || '').trim();
    const entriesToCheck = Array.isArray(snapshotEntries) ? snapshotEntries : [];
    if (!normalizedBookName || entriesToCheck.length === 0) continue;
    const currentEntries = await getLorebookEntries_ACU(normalizedBookName);
    const currentByUid = new Map((currentEntries || []).map(entry => [String(entry?.uid), entry]));
    for (const snapshotEntry of entriesToCheck) {
      if (!hasValidWorldbookUid_ACU(snapshotEntry?.uid)) continue;
      if (snapshotEntry.takeoverStatus === 'pending') {
        if (!keptBooks[normalizedBookName]) keptBooks[normalizedBookName] = [];
        keptBooks[normalizedBookName].push(snapshotEntry);
        continue;
      }
      const currentEntry = currentByUid.get(String(snapshotEntry.uid));
      const stillHasSkillMeta = currentEntry ? hasUsableWorldbookSkillMeta_ACU(currentEntry?.comment) : false;
      if (stillHasSkillMeta) {
        if (!keptBooks[normalizedBookName]) keptBooks[normalizedBookName] = [];
        keptBooks[normalizedBookName].push(snapshotEntry);
        continue;
      }
      if (!staleBooks[normalizedBookName]) staleBooks[normalizedBookName] = [];
      staleBooks[normalizedBookName].push(snapshotEntry);
      pruned += 1;
    }
  }

  const staleSnapshot = pruned > 0
    ? buildActiveSnapshot_ACU(selectionSignature, staleBooks)
    : buildInactiveSnapshot_ACU(selectionSignature);
  const hasKeptEntries = Object.values(keptBooks).some(entries => Array.isArray(entries) && entries.length > 0);
  return {
    snapshot: hasKeptEntries ? buildActiveSnapshot_ACU(selectionSignature, keptBooks) : buildInactiveSnapshot_ACU(selectionSignature),
    restored: 0,
    skipped: 0,
    failed: 0,
    pruned,
    staleSnapshot,
  };
}

interface AgentWorldbookEntryPatchReport_ACU {
  applied: AgentWorldbookTakeoverEntryUpdate_ACU[];
  failed: AgentWorldbookTakeoverEntryUpdate_ACU[];
}

function filterSnapshotBooksByUpdates_ACU(
  books: Record<string, AgentWorldbookControlSnapshotEntry_ACU[]>,
  updates: AgentWorldbookTakeoverEntryUpdate_ACU[],
): Record<string, AgentWorldbookControlSnapshotEntry_ACU[]> {
  const allowedByBook = new Map<string, Set<string>>();
  for (const update of updates) {
    const bookName = String(update?.bookName || '').trim();
    if (!bookName || !hasValidWorldbookUid_ACU(update?.uid)) continue;
    const allowed = allowedByBook.get(bookName) || new Set<string>();
    allowed.add(String(update.uid));
    allowedByBook.set(bookName, allowed);
  }
  return Object.fromEntries(Object.entries(books || {}).flatMap(([bookName, entries]) => {
    const allowed = allowedByBook.get(bookName);
    const filtered = (entries || []).filter(entry => allowed?.has(String(entry?.uid)));
    return filtered.length > 0 ? [[bookName, filtered]] : [];
  }));
}

function excludeSnapshotEntriesByUpdates_ACU(
  books: Record<string, AgentWorldbookControlSnapshotEntry_ACU[]>,
  updates: AgentWorldbookTakeoverEntryUpdate_ACU[],
): Record<string, AgentWorldbookControlSnapshotEntry_ACU[]> {
  const excludedByBook = new Map<string, Set<string>>();
  for (const update of updates) {
    const bookName = String(update?.bookName || '').trim();
    if (!bookName || !hasValidWorldbookUid_ACU(update?.uid)) continue;
    const excluded = excludedByBook.get(bookName) || new Set<string>();
    excluded.add(String(update.uid));
    excludedByBook.set(bookName, excluded);
  }
  return Object.fromEntries(Object.entries(books || {}).flatMap(([bookName, entries]) => {
    const excluded = excludedByBook.get(bookName);
    const filtered = (entries || []).filter(entry => !excluded?.has(String(entry?.uid)));
    return filtered.length > 0 ? [[bookName, filtered]] : [];
  }));
}

async function disableTakeoverCandidates_ACU(
  snapshot: AgentWorldbookControlSnapshot_ACU,
  candidateBooks: Record<string, AgentWorldbookControlSnapshotEntry_ACU[]>,
): Promise<{ disabled: number; failed: number; report: AgentWorldbookEntryPatchReport_ACU }> {
  const updatesByBook = new Map<string, Set<string>>();
  for (const [bookName, snapshotEntries] of Object.entries(candidateBooks || {})) {
    if (!bookName) continue;
    const uidSet = new Set<string>();
    for (const snapshotEntry of Array.isArray(snapshotEntries) ? snapshotEntries : []) {
      if (!hasValidWorldbookUid_ACU(snapshotEntry?.uid)) continue;
      uidSet.add(String(snapshotEntry.uid));
    }
    if (uidSet.size === 0) continue;
    if (!updatesByBook.has(bookName)) updatesByBook.set(bookName, new Set());
    for (const uid of uidSet.keys()) updatesByBook.get(bookName)!.add(uid);
  }

  let disabled = 0;
  let failed = 0;
  const report: AgentWorldbookEntryPatchReport_ACU = { applied: [], failed: [] };
  for (const [bookName, uidSet] of updatesByBook.entries()) {
    try {
      const entries = await getLorebookEntries_ACU(bookName);
      const snapshotEntriesByUid = new Map(
        (snapshot.books[bookName] || [])
          .filter(snapshotEntry => hasValidWorldbookUid_ACU(snapshotEntry?.uid))
          .map(snapshotEntry => [String(snapshotEntry.uid), snapshotEntry]),
      );
      const patchEntries = (entries || [])
        .map(entry => ({ entry, snapshotEntry: snapshotEntriesByUid.get(String(entry?.uid)) }))
        .filter(({ entry, snapshotEntry }) => uidSet.has(String(entry?.uid)) && snapshotEntry)
        .map(({ entry, snapshotEntry }) => ({
          uid: entry.uid,
          enabled: false,
          comment: buildTakeoverMetaComment_ACU(entry?.comment, snapshot.selectionSignature, snapshot.createdAt, snapshotEntry!),
        }));
      if (patchEntries.length === 0) continue;
      await setLorebookEntries_ACU(bookName, patchEntries);
      const patchedEntriesByUid = new Map((await getLorebookEntries_ACU(bookName) || []).map(entry => [String(entry?.uid), entry]));
      for (const patch of patchEntries) {
        const currentEntry = patchedEntriesByUid.get(String(patch.uid));
        const meta = parseTakeoverMetaFromComment_ACU(currentEntry?.comment);
        const update = { bookName, uid: patch.uid };
        if (currentEntry?.enabled === false && meta?.selectionSignature === snapshot.selectionSignature) {
          disabled += 1;
          report.applied.push(update);
        } else {
          failed += 1;
          report.failed.push(update);
        }
      }
    } catch (error) {
      const failedUpdates = [...uidSet].map(uid => ({ bookName, uid }));
      failed += failedUpdates.length;
      report.failed.push(...failedUpdates);
      logWarn_ACU(`[Agent世界书] 禁用世界书接管候选失败：${bookName}`, error);
    }
  }
  return { disabled, failed, report };
}

async function restoreSnapshotEntries_ACU(snapshot: AgentWorldbookControlSnapshot_ACU): Promise<{ restored: number; skipped: number; failed: number; report: AgentWorldbookEntryPatchReport_ACU }> {
  let restored = 0;
  let skipped = 0;
  let failed = 0;
  const report: AgentWorldbookEntryPatchReport_ACU = { applied: [], failed: [] };

  for (const [bookName, snapshotEntries] of Object.entries(snapshot.books || {})) {
    const normalizedBookName = String(bookName || '').trim();
    const entriesToRestore = Array.isArray(snapshotEntries)
      ? snapshotEntries.filter(entry => entry.takeoverStatus !== 'pending') : [];
    if (!normalizedBookName || entriesToRestore.length === 0) continue;
    const patches: any[] = [];
    let currentEntriesRead = false;
    try {
      const currentEntries = await getLorebookEntries_ACU(normalizedBookName);
      currentEntriesRead = true;
      const currentByUid = new Map((currentEntries || []).map(entry => [String(entry?.uid), entry]));
      for (const snapshotEntry of entriesToRestore) {
        if (!hasValidWorldbookUid_ACU(snapshotEntry?.uid)) {
          logWarn_ACU(
            `[Agent世界书] 跳过恢复世界书条目：${normalizedBookName} 中存在无效 uid。`,
            snapshotEntry?.uid,
          );
          skipped += 1;
          continue;
        }
        const currentEntry = currentByUid.get(String(snapshotEntry.uid));
        if (!currentEntry) {
          logWarn_ACU(`[Agent世界书] 跳过恢复世界书条目：${normalizedBookName}#${snapshotEntry.uid} 当前条目不存在。`);
          skipped += 1;
          continue;
        }
        const currentComment = typeof currentEntry.comment === 'string' ? currentEntry.comment : '';
        if (hasUnsupportedTakeoverMetaBlock_ACU(currentComment)) {
          logWarn_ACU(
            `[Agent世界书] 跳过恢复世界书条目：${normalizedBookName}#${snapshotEntry.uid} 包含不受支持的接管元数据版本。`,
          );
          skipped += 1;
          continue;
        }
        const strippedComment = stripTakeoverMetaBlock_ACU(currentComment);
        if (!snapshotEntry.commentHash) {
          logWarn_ACU(
            `[Agent世界书] 跳过恢复世界书条目：${normalizedBookName}#${snapshotEntry.uid} 缺少 comment 指纹，避免覆盖用户修改。`,
          );
          skipped += 1;
          continue;
        }
        if (!doesTakeoverSnapshotCommentHashMatch_ACU(snapshotEntry.commentHash, currentComment)) {
          logWarn_ACU(
            `[Agent世界书] 跳过恢复世界书条目：${normalizedBookName}#${snapshotEntry.uid} comment 已变化，避免覆盖用户修改。`,
          );
          skipped += 1;
          continue;
        }
        patches.push({
          uid: snapshotEntry.uid,
          comment: strippedComment,
          enabled: snapshotEntry.previousEnabled !== false,
          keys: Array.isArray(snapshotEntry.previousKeys) ? snapshotEntry.previousKeys : [],
          type: snapshotEntry.previousType,
        });
      }
      if (patches.length > 0) {
        await setLorebookEntries_ACU(normalizedBookName, patches);
        const patchedEntriesByUid = new Map((await getLorebookEntries_ACU(normalizedBookName) || []).map(entry => [String(entry?.uid), entry]));
        for (const patch of patches) {
          const currentEntry = patchedEntriesByUid.get(String(patch.uid));
          const keysMatch = JSON.stringify(currentEntry?.keys || []) === JSON.stringify(patch.keys || []);
          const restoredEntry = currentEntry
            && currentEntry.enabled === patch.enabled
            && currentEntry.type === patch.type
            && keysMatch
            && !hasTakeoverMetaBlock_ACU(currentEntry.comment);
          const update = { bookName: normalizedBookName, uid: patch.uid };
          if (restoredEntry) {
            restored += 1;
            report.applied.push(update);
          } else {
            failed += 1;
            report.failed.push(update);
          }
        }
      }
    } catch (error) {
      logWarn_ACU(`[Agent世界书] 恢复世界书条目失败：${normalizedBookName}`, error);
      const failedUpdates = currentEntriesRead
        ? patches.map(patch => ({ bookName: normalizedBookName, uid: patch.uid }))
        : entriesToRestore
          .filter(entry => hasValidWorldbookUid_ACU(entry?.uid))
          .map(entry => ({ bookName: normalizedBookName, uid: entry.uid }));
      failed += failedUpdates.length;
      report.failed.push(...failedUpdates);
    }
  }

  return { restored, skipped, failed, report };
}

async function collectRecoveredPendingSnapshotUpdates_ACU(
  snapshot: AgentWorldbookControlSnapshot_ACU,
): Promise<AgentWorldbookTakeoverEntryUpdate_ACU[]> {
  const recovered: AgentWorldbookTakeoverEntryUpdate_ACU[] = [];
  for (const [bookName, snapshotEntries] of Object.entries(snapshot.books || {})) {
    const pendingEntries = (snapshotEntries || []).filter(entry => entry.takeoverStatus === 'pending' && hasValidWorldbookUid_ACU(entry?.uid));
    if (pendingEntries.length === 0) continue;
    const entries = await getLorebookEntries_ACU(bookName);
    const entriesByUid = new Map((entries || []).map(entry => [String(entry?.uid), entry]));
    for (const snapshotEntry of pendingEntries) {
      const entry = entriesByUid.get(String(snapshotEntry.uid));
      if (!entry || hasTakeoverMetaBlock_ACU(entry.comment)) continue;
      if (!snapshotEntry.commentHash || !doesTakeoverSnapshotCommentHashMatch_ACU(snapshotEntry.commentHash, String(entry.comment || ''))) continue;
      const previousKeys = Array.isArray(snapshotEntry.previousKeys) ? snapshotEntry.previousKeys : [];
      const keys = Array.isArray(entry.keys) ? entry.keys : [];
      if (entry.enabled !== (snapshotEntry.previousEnabled !== false)
        || entry.type !== snapshotEntry.previousType
        || JSON.stringify(keys) !== JSON.stringify(previousKeys)) continue;
      recovered.push({ bookName, uid: snapshotEntry.uid });
    }
  }
  return recovered;
}

export function writeFinalGenerationGreenlights_ACU(greenlights: unknown): Promise<boolean> {
  return runExclusiveAgentWorldbookOperation_ACU(() => writeFinalGenerationGreenlightsExclusive_ACU(greenlights));
}

async function writeFinalGenerationGreenlightsExclusive_ACU(greenlights: unknown): Promise<boolean> {
  let snapshot = getPlotAgentWorldbookSnapshot_ACU();
  let snapshotUidSetByBook = buildSnapshotUidSetByBook_ACU(snapshot);
  if (snapshotUidSetByBook.size === 0) {
    // 内存快照可能因刷新页面/会话切换被清空，回退到持久账本快照重建后再判定。
    // 刻意不用完整 refresh：其 comment 扫描与 merge 会把账本写入失败场景下的
    // pending 条目调和成 applied 并污染内存缓存，破坏"账本未确认不消费绿灯"的恢复不变量。
    const selectionSignature = buildWorldbookSelectionSignature_ACU(await resolveTakeoverBookNames_ACU());
    snapshot = await readPlotAgentWorldbookStateSnapshotOnly_ACU(selectionSignature);
    snapshotUidSetByBook = buildSnapshotUidSetByBook_ACU(snapshot);
    if (snapshotUidSetByBook.size === 0) return false;
  }

  const normalizedGreenlights = normalizeAgentWorldbookRefs_ACU(greenlights);
  const allowedKeySet = buildAllowedFinalGreenlightKeySet_ACU(normalizedGreenlights, snapshotUidSetByBook);

  const patchResult = await patchSnapshotEntries_ACU(snapshotUidSetByBook, (bookName, entry) => {
    if (!hasValidWorldbookUid_ACU(entry?.uid)) return null;
    const isAllowed = allowedKeySet.has(buildFinalGreenlightKey_ACU(bookName, entry.uid));
    if (isAllowed) {
      const snapshotEntry = getSnapshotEntryForBookAndUid_ACU(snapshot, bookName, entry.uid);
      const liveKeys = getWorldbookEntryKeywordsForSkillify_ACU(entry);
      const previousKeys = Array.isArray(snapshotEntry?.previousKeys) ? snapshotEntry.previousKeys : [];
      const shouldRestoreLegacyClearedKeys = liveKeys.length === 0
        && previousKeys.length > 0
        && !!snapshotEntry?.commentHash
        && doesTakeoverSnapshotCommentHashMatch_ACU(snapshotEntry.commentHash, String(entry?.comment || ''));
      if (isFinalGenerationBlueLightEntry_ACU(entry) && !shouldRestoreLegacyClearedKeys) return null;
      return {
        uid: entry.uid,
        ...(isFinalGenerationBlueLightEntry_ACU(entry) ? {} : { enabled: true, type: 'constant' }),
        ...(shouldRestoreLegacyClearedKeys ? { keys: [...previousKeys] } : {}),
      };
    }
    if (entry.enabled === false) return null;
    return { uid: entry.uid, enabled: false };
  }, { readContext: undefined });

  return patchResult.patched > 0;
}

export async function readFinalGenerationGreenlights_ACU(): Promise<AgentWorldbookFinalGreenlightRef_ACU[]> {
  const snapshot = getPlotAgentWorldbookSnapshot_ACU();
  const snapshotUidSetByBook = buildSnapshotUidSetByBook_ACU(snapshot);
  const greenlights: AgentWorldbookFinalGreenlightRef_ACU[] = [];
  const seen = new Set<string>();

  for (const [bookName, uidSet] of snapshotUidSetByBook.entries()) {
    const entries = await getLorebookEntries_ACU(bookName);
    for (const entry of entries || []) {
      if (!hasValidWorldbookUid_ACU(entry?.uid) || !uidSet.has(String(entry.uid)) || !isFinalGenerationBlueLightEntry_ACU(entry)) continue;
      const key = buildFinalGreenlightKey_ACU(bookName, entry.uid);
      if (seen.has(key)) continue;
      seen.add(key);
      greenlights.push({ bookName, uid: entry.uid });
    }
  }

  return greenlights;
}

export interface ClearFinalGenerationGreenlightsResult_ACU {
  status: 'noop' | 'cleared' | 'isolated_stale' | 'failed';
  patched: number;
  staleBookNames: string[];
  /** 仅 failed 时存在：安全分类，不携带宿主正文。 */
  error?: {
    category: string;
    phase: string;
    subphase: 'resolve_snapshot' | 'patch_snapshot_entries' | 'delete_legacy_greenlights';
    status?: string;
    source?: string;
    validationPolicy?: string;
    runId?: string;
    failedBookNames?: string[];
    errorCategories?: string[];
    staleBookNames?: string[];
  };
}

/**
 * 清绿灯预检：
 * - 无 active snapshot / 无待清理条目 → noop（不写世界书）；
 * - 宿主列表中存在已删除/改名书（not-found）→ 记为 stale 并继续清理其他有效书；
 * - 读取权限/宿主契约/写入失败 → failed（失败关闭，由调用方阻断 AI）。
 * 不自动修改 manualSelection 或角色绑定，只记录安全诊断。
 */
export function clearFinalGenerationGreenlights_ACU(
  readContext?: StrictLorebookReadContext_ACU,
): Promise<ClearFinalGenerationGreenlightsResult_ACU> {
  return runExclusiveAgentWorldbookOperation_ACU(() => clearFinalGenerationGreenlightsExclusive_ACU(readContext));
}

async function clearFinalGenerationGreenlightsExclusive_ACU(
  readContext?: StrictLorebookReadContext_ACU,
): Promise<ClearFinalGenerationGreenlightsResult_ACU> {
  function buildFailedError(
    subphase: 'resolve_snapshot' | 'patch_snapshot_entries' | 'delete_legacy_greenlights',
    error: unknown,
  ): ClearFinalGenerationGreenlightsResult_ACU['error'] {
    // 取消/作用域变化必须保留独立安全分类，不能落为 strict_lorebook_read/unknown。
    const classifiedCategory = classifyLorebookReadError_ACU(error);
    const summary = classifiedCategory === 'aborted' || classifiedCategory === 'scope_changed' || classifiedCategory === 'api_unavailable'
      ? { category: classifiedCategory }
      : (summarizeLorebookRuntimeError_ACU(error) || { category: 'unknown' });
    return {
      category: String(summary.category || classifiedCategory || 'unknown'),
      phase: 'clear_final_generation_greenlights',
      subphase,
      status: typeof summary.status === 'string' ? summary.status : undefined,
      source: typeof summary.source === 'string' ? summary.source : undefined,
      validationPolicy: typeof summary.validationPolicy === 'string' ? summary.validationPolicy : undefined,
      runId: typeof summary.runId === 'string' ? summary.runId : undefined,
      failedBookNames: Array.isArray(summary.failedBookNames) && summary.failedBookNames.every(item => typeof item === 'string')
        ? summary.failedBookNames
        : undefined,
      errorCategories: Array.isArray(summary.errorCategories) && summary.errorCategories.every(item => typeof item === 'string')
        ? summary.errorCategories
        : undefined,
      staleBookNames: Array.isArray(summary.staleBookNames) && summary.staleBookNames.every(item => typeof item === 'string')
        ? summary.staleBookNames
        : undefined,
    };
  }

  const baseResult = { patched: 0, staleBookNames: [] as string[] };
  let snapshot: Awaited<ReturnType<typeof refreshPlotAgentWorldbookSnapshotWithStale_ACU>>['snapshot'];
  let staleFromRefresh: string[] = [];
  try {
    const refreshed = await refreshPlotAgentWorldbookSnapshotWithStale_ACU(readContext);
    snapshot = refreshed.snapshot;
    staleFromRefresh = refreshed.staleBookNames;
  } catch (error) {
    return {
      ...baseResult,
      status: 'failed',
      error: buildFailedError('resolve_snapshot', error),
    };
  }
  const snapshotUidSetByBook = buildSnapshotUidSetByBook_ACU(snapshot);
  if (snapshot.active !== true || snapshotUidSetByBook.size === 0) {
    const noopStale = [...new Set([...staleFromRefresh])];
    return {
      ...baseResult,
      status: noopStale.length > 0 ? 'isolated_stale' : 'noop',
      staleBookNames: noopStale,
    };
  }

  let patched = 0;
  try {
    const patchResult = await patchSnapshotEntries_ACU(snapshotUidSetByBook, (_bookName, entry) => {
      if (!isFinalGenerationBlueLightEntry_ACU(entry)) return null;
      return { uid: entry.uid, enabled: false };
    }, { readContext });
    patched = patchResult.patched;
    staleFromRefresh = [...new Set([...staleFromRefresh, ...patchResult.staleBookNames])];
  } catch (error) {
    return {
      ...baseResult,
      status: 'failed',
      error: buildFailedError('patch_snapshot_entries', error),
    };
  }

  let staleBookNames: string[] = [];
  let deletedLegacyEntries = 0;
  try {
    const resolvedBookNames = await resolveTakeoverBookNames_ACU(readContext);
    const deleted = await deleteInternalEntriesByComment_ACU(resolvedBookNames, AGENT_FINAL_GENERATION_GREENLIGHT_COMMENT_ACU, {
      readContext,
      onStaleBookNames: (stale) => { staleBookNames = [...staleBookNames, ...stale]; },
    });
    deletedLegacyEntries = deleted.deleted;
    staleBookNames = deleted.staleBookNames;
  } catch (error) {
    return {
      ...baseResult,
      status: 'failed',
      error: buildFailedError('delete_legacy_greenlights', error),
    };
  }

  staleBookNames = [...new Set([...staleFromRefresh, ...staleBookNames])];
  return {
    status: staleBookNames.length > 0 ? 'isolated_stale' : 'cleared',
    patched: patched + deletedLegacyEntries,
    staleBookNames,
  };
}

export function takeoverWorldbookGreenlights_ACU(): Promise<AgentWorldbookTakeoverResult_ACU> {
  return runExclusiveAgentWorldbookOperation_ACU(() => takeoverWorldbookGreenlightsExclusive_ACU());
}

async function takeoverWorldbookGreenlightsExclusive_ACU(): Promise<AgentWorldbookTakeoverResult_ACU> {
  const availability = await resolveAgentWorldbookFilterAvailability_ACU();
  const resolvedBookNames = availability.bookNames;
  const selectionSignature = buildWorldbookSelectionSignature_ACU(resolvedBookNames);

  if (!availability.available) {
    const snapshot = buildInactiveSnapshot_ACU(selectionSignature);
    setPlotAgentWorldbookSnapshot_ACU(snapshot);
    return {
      updated: false,
      reason: availability.reason,
      bookNames: resolvedBookNames,
      selectionSignature,
      totalCandidates: 0,
      disabled: 0,
      failed: 0,
      snapshot,
      updates: [],
    };
  }

  const existingSnapshot = await readAndMaybeCachePlotAgentWorldbookSnapshot_ACU(
    resolvedBookNames,
    selectionSignature,
    getAgentWorldbookSnapshotRevision_ACU(),
  );
  const { snapshotBooks, updates } = await collectTakeoverCandidates_ACU(resolvedBookNames);
  const totalCandidates = updates.length || Object.values(snapshotBooks || {}).reduce((sum, entries) => sum + (Array.isArray(entries) ? entries.length : 0), 0);
  const shouldReconcileExistingActiveSnapshot = existingSnapshot.active === true && existingSnapshot.selectionSignature === selectionSignature;
  const reconciledExistingSnapshot = shouldReconcileExistingActiveSnapshot
    ? await reconcileExistingTakeoverSnapshotWithSkillMeta_ACU(existingSnapshot, selectionSignature)
    : { snapshot: buildInactiveSnapshot_ACU(selectionSignature), restored: 0, skipped: 0, failed: 0, pruned: 0, staleSnapshot: buildInactiveSnapshot_ACU(selectionSignature) };
  const pendingCandidateBooks = markSnapshotBooksPending_ACU(snapshotBooks);
  const workingSnapshotBooks = mergeSnapshotBooks_ACU(existingSnapshot.books, pendingCandidateBooks);
  const workingSnapshot = Object.keys(workingSnapshotBooks).length > 0
    ? buildActiveSnapshot_ACU(selectionSignature, workingSnapshotBooks)
    : buildInactiveSnapshot_ACU(selectionSignature);
  let stateWriteFailed = 0;
  let persistentSnapshot = existingSnapshot;
  let stateWriteSucceeded = false;
  if (workingSnapshot.active === true) {
    try {
      const stateWriteResult = await writeAgentWorldbookStateToWorldbook_ACU({ snapshot: workingSnapshot });
      stateWriteSucceeded = stateWriteResult.updated;
      if (!stateWriteSucceeded) stateWriteFailed = totalCandidates > 0 ? totalCandidates : reconciledExistingSnapshot.pruned;
      if (stateWriteSucceeded) persistentSnapshot = workingSnapshot;
    } catch (error) {
      logWarn_ACU('[Agent世界书] 写入独立接管快照失败，已阻止本次物理禁用以避免无法恢复。', error);
      stateWriteFailed = totalCandidates > 0 ? totalCandidates : reconciledExistingSnapshot.pruned;
    }
  }
  const disableResult = totalCandidates > 0
    && stateWriteSucceeded
    ? await disableTakeoverCandidates_ACU(workingSnapshot, pendingCandidateBooks)
    : { disabled: 0, failed: 0, report: { applied: [], failed: [] } };
  const candidateOutcomeBooks = setSnapshotEntryStatusByUpdates_ACU(
    pendingCandidateBooks,
    disableResult.report.applied,
    'applied',
  );
  let restoreResult: {
    restored: number;
    skipped: number;
    failed: number;
    report: AgentWorldbookEntryPatchReport_ACU;
  } = { restored: 0, skipped: 0, failed: 0, report: { applied: [], failed: [] } };
  const staleUpdates = Object.entries(reconciledExistingSnapshot.staleSnapshot.books)
    .flatMap(([bookName, entries]) => (entries || []).map(entry => ({ bookName, uid: entry.uid })));

  if (reconciledExistingSnapshot.pruned > 0 && stateWriteSucceeded) {
    const restorePendingBooks = setSnapshotEntryStatusByUpdates_ACU(
      workingSnapshot.books,
      staleUpdates,
      'pending',
    );
    const restorePendingSnapshot = buildActiveSnapshot_ACU(selectionSignature, restorePendingBooks);
    try {
      const stateWriteResult = await writeAgentWorldbookStateToWorldbook_ACU({ snapshot: restorePendingSnapshot });
      if (!stateWriteResult.updated) {
        stateWriteFailed += reconciledExistingSnapshot.pruned;
      } else {
        persistentSnapshot = restorePendingSnapshot;
        restoreResult = await restoreSnapshotEntries_ACU(reconciledExistingSnapshot.staleSnapshot);
      }
    } catch (error) {
      logWarn_ACU('[Agent世界书] 标记接管恢复待处理状态失败，未恢复旧条目以保留可重试状态。', error);
      stateWriteFailed += reconciledExistingSnapshot.pruned;
    }
  }

  if (stateWriteSucceeded && stateWriteFailed === 0 && (totalCandidates > 0 || reconciledExistingSnapshot.pruned > 0)) {
    const unresolvedStaleBooks = setSnapshotEntryStatusByUpdates_ACU(
      excludeSnapshotEntriesByUpdates_ACU(reconciledExistingSnapshot.staleSnapshot.books, restoreResult.report.applied),
      staleUpdates,
      'applied',
    );
    const finalizedBooks = mergeSnapshotBooks_ACU(
      reconciledExistingSnapshot.snapshot.books,
      mergeSnapshotBooks_ACU(candidateOutcomeBooks, unresolvedStaleBooks),
    );
    const finalizedSnapshot = Object.keys(finalizedBooks).length > 0
      ? buildActiveSnapshot_ACU(selectionSignature, finalizedBooks)
      : buildInactiveSnapshot_ACU(selectionSignature);
    try {
      const stateWriteResult = await writeAgentWorldbookStateToWorldbook_ACU({ snapshot: finalizedSnapshot });
      if (stateWriteResult.updated) {
        persistentSnapshot = finalizedSnapshot;
      } else {
        stateWriteFailed += Math.max(disableResult.failed, restoreResult.failed, totalCandidates, reconciledExistingSnapshot.pruned);
      }
    } catch (error) {
      logWarn_ACU('[Agent世界书] 接管结果收敛写入失败，已保留 pending 状态供后续刷新处理。', error);
      stateWriteFailed += Math.max(disableResult.failed, restoreResult.failed, totalCandidates, reconciledExistingSnapshot.pruned);
    }
  }

  setPlotAgentWorldbookSnapshot_ACU(persistentSnapshot);
  const totalFailed = disableResult.failed + stateWriteFailed + restoreResult.failed;
  const reconciledChanged = restoreResult.restored > 0 || restoreResult.skipped > 0 || restoreResult.failed > 0 || reconciledExistingSnapshot.pruned > 0;

  return {
    updated: disableResult.disabled > 0 || totalFailed > 0 || reconciledChanged,
    reason: stateWriteFailed > 0
      ? 'snapshot_state_write_failed'
      : (totalCandidates > 0
        ? 'native_worldbook_trigger_disabled'
        : (reconciledExistingSnapshot.pruned > 0
          ? 'native_worldbook_trigger_snapshot_reconciled'
          : (shouldReconcileExistingActiveSnapshot
          ? 'native_worldbook_trigger_already_disabled'
          : 'empty_candidates'))),
    bookNames: resolvedBookNames,
    selectionSignature,
    totalCandidates,
    disabled: disableResult.disabled,
    failed: totalFailed,
    snapshot: persistentSnapshot,
    updates,
  };
}

export function restoreWorldbookGreenlights_ACU(options: {
  cleanupMode?: 'full' | 'restore_only';
} = {}): Promise<AgentWorldbookRestoreResult_ACU> {
  return runExclusiveAgentWorldbookOperation_ACU(() => restoreWorldbookGreenlightsExclusive_ACU(options));
}

async function restoreWorldbookGreenlightsExclusive_ACU(options: {
  cleanupMode?: 'full' | 'restore_only';
} = {}): Promise<AgentWorldbookRestoreResult_ACU> {
  const cleanupMode = options.cleanupMode || 'full';
  const resolvedBookNames = await resolveTakeoverBookNames_ACU();
  const selectionSignature = buildWorldbookSelectionSignature_ACU(resolvedBookNames);
  const worldbookSnapshot = await readPlotAgentWorldbookSnapshotFromStateOrLegacy_ACU(
    resolvedBookNames,
    selectionSignature,
    { backfillMissingMeta: false },
  );
  const legacySnapshot = getLegacyPlotAgentWorldbookSnapshot_ACU();
  const stateSnapshot = await readPlotAgentWorldbookStateSnapshotOnly_ACU(selectionSignature);
  const shouldUseLegacySnapshot = stateSnapshot.active !== true
    && legacySnapshot.active === true
    && legacySnapshot.selectionSignature === selectionSignature;
  const snapshot = worldbookSnapshot;
  const shouldRestoreSnapshot = snapshot.active === true && snapshot.selectionSignature === selectionSignature;
  let recoveredPendingUpdates: AgentWorldbookTakeoverEntryUpdate_ACU[] = [];
  let pendingRecoveryReadFailed = false;
  if (cleanupMode === 'full' && shouldRestoreSnapshot) {
    try {
      recoveredPendingUpdates = await collectRecoveredPendingSnapshotUpdates_ACU(snapshot);
    } catch (error) {
      pendingRecoveryReadFailed = true;
      logWarn_ACU('[Agent世界书] 检查待处理恢复结果失败，已保留 pending 状态供后续诊断。', error);
    }
  }
  const restoreUpdates = cleanupMode === 'full' && shouldRestoreSnapshot
    ? Object.entries(snapshot.books || {}).flatMap(([bookName, entries]) => (entries || [])
      .filter(entry => entry.takeoverStatus !== 'pending' && hasValidWorldbookUid_ACU(entry?.uid))
      .map(entry => ({ bookName, uid: entry.uid })))
    : [];
  const restorePendingSnapshot = shouldRestoreSnapshot && restoreUpdates.length > 0
    ? buildActiveSnapshot_ACU(
      selectionSignature,
      setSnapshotEntryStatusByUpdates_ACU(snapshot.books, restoreUpdates, 'pending'),
    )
    : snapshot;
  let stateWriteFailed = 0;
  let pendingSnapshotPersisted = false;
  if (restoreUpdates.length > 0) {
    try {
      const stateWriteResult = await writeAgentWorldbookStateToWorldbook_ACU({ snapshot: restorePendingSnapshot });
      pendingSnapshotPersisted = stateWriteResult.updated;
      if (!pendingSnapshotPersisted) stateWriteFailed = restoreUpdates.length;
    } catch (error) {
      stateWriteFailed = restoreUpdates.length;
      logWarn_ACU('[Agent世界书] 标记接管恢复待处理状态失败，未恢复条目以保留可重试状态。', error);
    }
  }
  const restoreResult = shouldRestoreSnapshot && (cleanupMode !== 'full' || restoreUpdates.length === 0 || pendingSnapshotPersisted)
    ? await restoreSnapshotEntries_ACU(snapshot)
    : { restored: 0, skipped: 0, failed: 0, report: { applied: [], failed: [] } };
  const completedRestoreUpdates = [
    ...recoveredPendingUpdates,
    ...restoreResult.report.applied,
  ];
  const remainingBooks = shouldRestoreSnapshot
    ? excludeSnapshotEntriesByUpdates_ACU(restorePendingSnapshot.books, completedRestoreUpdates)
    : {};
  const finalizedSnapshot = Object.keys(remainingBooks).length > 0
    ? buildActiveSnapshot_ACU(selectionSignature, remainingBooks)
    : buildInactiveSnapshot_ACU(selectionSignature);
  let persistentSnapshot = pendingSnapshotPersisted ? restorePendingSnapshot : snapshot;
  const canFinalizeSnapshot = cleanupMode === 'full'
    && shouldRestoreSnapshot
    && !pendingRecoveryReadFailed
    && (restoreUpdates.length === 0 || pendingSnapshotPersisted);
  if (canFinalizeSnapshot && shouldRestoreSnapshot) {
    try {
      const stateWriteResult = await writeAgentWorldbookStateToWorldbook_ACU({ snapshot: finalizedSnapshot });
      if (stateWriteResult.updated) {
        persistentSnapshot = finalizedSnapshot;
      } else {
        stateWriteFailed += Math.max(1, completedRestoreUpdates.length);
      }
    } catch (error) {
      stateWriteFailed += Math.max(1, completedRestoreUpdates.length);
      logWarn_ACU('[Agent世界书] 接管恢复结果收敛写入失败，已保留 pending 状态供后续诊断。', error);
    }
  }
  const canCleanupPersistentSnapshot = cleanupMode === 'full'
    && canFinalizeSnapshot
    && shouldRestoreSnapshot
    && stateWriteFailed === 0
    && finalizedSnapshot.active !== true;
  const canClearLegacySnapshot = cleanupMode === 'full' && shouldUseLegacySnapshot && restoreResult.skipped === 0 && restoreResult.failed === 0;
  const deletedFinalGreenlights = (await deleteInternalEntriesByComment_ACU(resolvedBookNames, AGENT_FINAL_GENERATION_GREENLIGHT_COMMENT_ACU)).deleted;
  const deletedSnapshots = cleanupMode === 'full' ? (await deleteInternalEntriesByComment_ACU(resolvedBookNames, AGENT_WORLDBOOK_SNAPSHOT_COMMENT_ACU)).deleted : 0;
  const deletedStateEntries = canCleanupPersistentSnapshot ? await deleteAgentWorldbookStateEntry_ACU() : 0;
  const legacySnapshotCleared = canClearLegacySnapshot && clearLegacyPlotAgentWorldbookSnapshot_ACU() ? 1 : 0;
  const cleaned = deletedFinalGreenlights + deletedSnapshots + deletedStateEntries + legacySnapshotCleared;
  const changed = restoreResult.restored + restoreResult.failed + stateWriteFailed + cleaned;
  setPlotAgentWorldbookSnapshot_ACU(canCleanupPersistentSnapshot
    ? buildInactiveSnapshot_ACU(selectionSignature)
    : persistentSnapshot);

  return {
    updated: changed > 0,
    reason: stateWriteFailed > 0
      ? 'snapshot_state_write_failed'
      : (restoreResult.restored > 0
        ? 'native_worldbook_trigger_restored'
      : (restoreResult.failed > 0
        ? 'native_worldbook_trigger_restore_failed'
      : (restoreResult.skipped > 0
        ? 'native_worldbook_trigger_restore_skipped'
        : (cleaned > 0 ? 'legacy_artifacts_cleaned' : 'no_active_snapshot')))),
    bookNames: resolvedBookNames,
    selectionSignature,
    restored: restoreResult.restored,
    skipped: restoreResult.skipped,
    failed: restoreResult.failed,
    updates: [],
  };
}
