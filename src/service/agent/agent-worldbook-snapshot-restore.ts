import type { AgentWorldbookControlSnapshot_ACU } from '../../shared/models/agent-worldbook-model';
import { getLorebookEntries_ACU, setLorebookEntries_ACU } from '../../data/gateways/worldbook-gateway';
import { hashUserInput_ACU, logWarn_ACU } from '../../shared/utils';
import { buildAgentWorldbookSnapshotSelectionSignature_ACU } from '../../shared/agent-worldbook-snapshot';
import {
  createAgentTakeoverMetaPattern_ACU,
  createSkillMetaPattern_ACU,
  stripAgentTakeoverMetaBlockLoose_ACU,
} from '../../shared/agent-worldbook-comment';

export interface AgentWorldbookSnapshotRestoreResult_ACU {
  restored: number;
  skipped: number;
  failed: number;
  signatureMatched: boolean;
  rollbackPatchesByBook: Record<string, Record<string, any>[]>;
  restoredPatchesByBook: Record<string, Record<string, any>[]>;
}

function isSamePatchValue_ACU(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function doesEntryMatchPatch_ACU(entry: any, patch: Record<string, any>): boolean {
  if (!entry || String(entry.uid) !== String(patch.uid)) return false;
  return Object.entries(patch)
    .filter(([key]) => key !== 'uid')
    .every(([key, value]) => isSamePatchValue_ACU(entry[key], value));
}

async function readConfirmedPatches_ACU(
  bookName: string,
  patches: Record<string, any>[],
): Promise<Record<string, any>[]> {
  const entries = await getLorebookEntries_ACU(bookName);
  const entriesByUid = new Map((entries || []).map(entry => [String(entry?.uid), entry]));
  return patches.filter(patch => doesEntryMatchPatch_ACU(entriesByUid.get(String(patch.uid)), patch));
}

/**
 * 恢复操作实际改动过的字段在写入前的值。仅保存此次 restore patch 涉及的字段，
 * 使调用方可在后续 scope 配置持久化失败时将条目恢复为接管中的原始状态。
 */
export async function rollbackAgentWorldbookSnapshotRestore_ACU(
  rollbackPatchesByBook: Record<string, Record<string, any>[]>,
  restoredPatchesByBook: Record<string, Record<string, any>[]>,
): Promise<boolean> {
  let succeeded = true;
  for (const [rawBookName, patches] of Object.entries(rollbackPatchesByBook || {})) {
    const bookName = rawBookName;
    if (!bookName.trim() || !Array.isArray(patches) || patches.length === 0) continue;
    try {
      const restoredPatches = restoredPatchesByBook?.[bookName];
      if (!Array.isArray(restoredPatches) || restoredPatches.length === 0) {
        succeeded = false;
        logWarn_ACU(`[Agent世界书] 回滚世界书条目恢复缺少恢复后状态：${bookName}`);
        continue;
      }
      const restoredByUid = new Map(restoredPatches.map(patch => [String(patch.uid), patch]));
      const entries = await getLorebookEntries_ACU(bookName);
      const entriesByUid = new Map((entries || []).map(entry => [String(entry?.uid), entry]));
      const safePatches = patches.filter(patch => {
        const restoredPatch = restoredByUid.get(String(patch.uid));
        return restoredPatch !== undefined
          && doesEntryMatchPatch_ACU(entriesByUid.get(String(patch.uid)), restoredPatch);
      });
      if (safePatches.length !== patches.length) {
        succeeded = false;
        logWarn_ACU(`[Agent世界书] 回滚世界书条目恢复发生并发冲突：${bookName}`);
      }
      if (safePatches.length === 0) continue;
      await setLorebookEntries_ACU(bookName, safePatches);
      const confirmed = await readConfirmedPatches_ACU(bookName, safePatches);
      if (confirmed.length !== safePatches.length) {
        succeeded = false;
        logWarn_ACU(`[Agent世界书] 回滚世界书条目恢复未被完整确认：${bookName}`);
      }
    } catch (error) {
      succeeded = false;
      logWarn_ACU(`[Agent世界书] 回滚世界书条目恢复失败：${bookName}`, error);
    }
  }
  return succeeded;
}

export function buildAgentWorldbookSelectionSignature_ACU(bookNames: string[]): string {
  return buildAgentWorldbookSnapshotSelectionSignature_ACU(bookNames);
}

function hasValidUid_ACU(value: unknown): value is string | number {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function stripTakeoverMeta_ACU(comment: unknown): string {
  return stripAgentTakeoverMetaBlockLoose_ACU(comment);
}

function comparableComment_ACU(comment: unknown): string {
  return stripTakeoverMeta_ACU(comment).replace(createSkillMetaPattern_ACU(), '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function isCommentHashMatched_ACU(snapshotHash: string | undefined, currentComment: unknown): boolean {
  if (!snapshotHash) return true;
  const stripped = stripTakeoverMeta_ACU(currentComment);
  return hashUserInput_ACU(comparableComment_ACU(currentComment)) === snapshotHash
    || hashUserInput_ACU(stripped) === snapshotHash;
}

export async function restoreAgentWorldbookSnapshotEntries_ACU(
  snapshot: AgentWorldbookControlSnapshot_ACU,
  expectedBookNames: string[],
): Promise<AgentWorldbookSnapshotRestoreResult_ACU> {
  const expectedSignature = buildAgentWorldbookSelectionSignature_ACU(expectedBookNames);
  if (snapshot.active !== true || snapshot.selectionSignature !== expectedSignature) {
    return {
      restored: 0,
      skipped: 0,
      failed: 0,
      signatureMatched: false,
      rollbackPatchesByBook: {},
      restoredPatchesByBook: {},
    };
  }

  let restored = 0;
  let skipped = 0;
  let failed = 0;
  const rollbackPatchesByBook: Record<string, Record<string, any>[]> = {};
  const restoredPatchesByBook: Record<string, Record<string, any>[]> = {};
  for (const [rawBookName, rawSnapshotEntries] of Object.entries(snapshot.books || {})) {
    const bookName = rawBookName;
    const snapshotEntries = Array.isArray(rawSnapshotEntries) ? rawSnapshotEntries : [];
    if (!bookName.trim() || snapshotEntries.length === 0) continue;
    try {
      const entries = await getLorebookEntries_ACU(bookName);
      const currentByUid = new Map((entries || []).map(entry => [String(entry?.uid), entry]));
      const patches: Record<string, any>[] = [];
      const rollbackPatches: Record<string, any>[] = [];
      let restoredInBook = 0;
      for (const snapshotEntry of snapshotEntries) {
        if (!hasValidUid_ACU(snapshotEntry?.uid)) {
          skipped += 1;
          continue;
        }
        const current = currentByUid.get(String(snapshotEntry.uid));
        if (!current || !isCommentHashMatched_ACU(snapshotEntry.commentHash, current.comment)) {
          if (current) {
            const strippedComment = stripTakeoverMeta_ACU(current.comment);
            if (strippedComment !== String(current.comment || '')) {
              patches.push({ uid: snapshotEntry.uid, comment: strippedComment });
              rollbackPatches.push({ uid: snapshotEntry.uid, comment: current.comment });
            }
          }
          skipped += 1;
          continue;
        }
        const patch = {
          uid: snapshotEntry.uid,
          comment: stripTakeoverMeta_ACU(current.comment),
          enabled: snapshotEntry.previousEnabled !== false,
          keys: Array.isArray(snapshotEntry.previousKeys) ? snapshotEntry.previousKeys : [],
          type: snapshotEntry.previousType,
        };
        patches.push(patch);
        rollbackPatches.push({
          uid: snapshotEntry.uid,
          comment: current.comment,
          enabled: current.enabled,
          keys: current.keys,
          type: current.type,
        });
        restoredInBook += 1;
      }
      if (patches.length > 0) {
        // 宿主批量写在 reject 前仍可能已应用部分 patch，因此先保留完整 pre-image。
        rollbackPatchesByBook[bookName] = rollbackPatches;
        restoredPatchesByBook[bookName] = patches;
        let writeFailed = false;
        try {
          await setLorebookEntries_ACU(bookName, patches);
        } catch (error) {
          writeFailed = true;
          logWarn_ACU(`[Agent世界书] 恢复世界书条目写入失败：${bookName}`, error);
        }
        try {
          const confirmed = await readConfirmedPatches_ACU(bookName, patches);
          const confirmedUidSet = new Set(confirmed.map(patch => String(patch.uid)));
          rollbackPatchesByBook[bookName] = rollbackPatches.filter(patch => confirmedUidSet.has(String(patch.uid)));
          restoredPatchesByBook[bookName] = patches.filter(patch => confirmedUidSet.has(String(patch.uid)));
          if (rollbackPatchesByBook[bookName].length === 0) delete rollbackPatchesByBook[bookName];
          if (restoredPatchesByBook[bookName].length === 0) delete restoredPatchesByBook[bookName];
          if (writeFailed || confirmed.length !== patches.length) {
            restoredInBook = 0;
            failed += snapshotEntries.length;
          }
        } catch (error) {
          // 无法读回时不能假定零副作用；保留完整 pre-image 交由上层补偿。
          restoredInBook = 0;
          failed += snapshotEntries.length;
          logWarn_ACU(`[Agent世界书] 恢复世界书条目后确认失败：${bookName}`, error);
        }
      }
      restored += restoredInBook;
    } catch (error) {
      logWarn_ACU(`[Agent世界书] 恢复世界书条目失败：${bookName}`, error);
      failed += snapshotEntries.length;
    }
  }
  return { restored, skipped, failed, signatureMatched: true, rollbackPatchesByBook, restoredPatchesByBook };
}
