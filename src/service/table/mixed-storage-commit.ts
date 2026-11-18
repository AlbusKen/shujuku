import { getChatArray_ACU, saveChatToHostStrict_ACU } from '../../data/gateways/chat-gateway';
import type { IsolationConfig_ACU } from '../../data/models/chat-message-data';
import { cloneIsolatedData_ACU, isLegacyMatchForIsolation_ACU, readIsolatedTagData_ACU } from '../../data/repositories/chat-message-data-repo';
import { validateMigrationProvenanceV1_ACU } from '../../shared/canonical-checkpoint-validator';
import type { MixedStorageDecisionBackupV1_ACU } from './storage-frame-v2-types';
import type { TableDataObject_ACU } from '../../shared/models/table-data';
import { currentChatFileIdentifier_ACU, getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import { isV2TagData_ACU } from './storage-strategy-resolver';
import { buildCanonicalFullCheckpoint_ACU } from './canonical-checkpoint-builder';
import type { MixedStorageDecision_ACU } from './mixed-storage-decision';
import { collectMixedStorageEvidence_ACU } from './mixed-storage-evidence';
import { getCurrentStorageMode } from './storage-mode';
import { didSqliteFallbackAfterReload_ACU, reloadStorageProvider } from './table-storage-strategy';
import { auditTableDataForUpgrade_ACU, getTableDataFingerprint_ACU } from './table-data-upgrade-audit';
import type { MixedStorageCommitAction_ACU } from '../../shared/models/mixed-storage-commit-action';

export type { MixedStorageCommitAction_ACU } from '../../shared/models/mixed-storage-commit-action';
export type MixedStorageCommitStatus_ACU = 'committed' | 'commit_failed_rolled_back' | 'committed_postcondition_failed';
export interface MixedStorageCommitOptions_ACU { decision: MixedStorageDecision_ACU; action: MixedStorageCommitAction_ACU; isolationConfig: Readonly<IsolationConfig_ACU>; }
export interface MixedStorageCommitResult_ACU { status: MixedStorageCommitStatus_ACU; decisionId: string; error?: string; }

function clone_ACU<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function scopeError_ACU(decision: MixedStorageDecision_ACU): string | null {
  if (getChatArray_ACU() !== decision.scopeSnapshot.chatReference) return 'active chat reference changed';
  if (String(currentChatFileIdentifier_ACU || '').trim() !== decision.scopeSnapshot.chatIdentifier) return 'active chat identifier changed';
  if (getCurrentIsolationKey_ACU() !== decision.scopeSnapshot.activeIsolationKey) return 'active isolation changed';
  return null;
}
function removeLegacy_ACU(chat: any[], isolationKey: string, isolationConfig: Readonly<IsolationConfig_ACU>): void {
  for (const message of chat) {
    if (!message) continue;
    const isolated = cloneIsolatedData_ACU(message) as Record<string, any>;
    if (isolated && !isV2TagData_ACU(isolated[isolationKey])) {
      delete isolated[isolationKey];
      if (Object.keys(isolated).length === 0) delete message.TavernDB_ACU_IsolatedData;
      else message.TavernDB_ACU_IsolatedData = isolated;
    }
    if (!isLegacyMatchForIsolation_ACU(message, isolationConfig)) continue;
    delete message.TavernDB_ACU_IndependentData;
    delete message.TavernDB_ACU_Data;
    delete message.TavernDB_ACU_SummaryData;
    delete message.TavernDB_ACU_ModifiedKeys;
    delete message.TavernDB_ACU_UpdateGroupKeys;
    delete message.TavernDB_ACU_Identity;
  }
}
function latestSafeAiTarget_ACU(chat: any[], isolationKey: string): number | null {
  for (let index = chat.length - 1; index >= 0; index -= 1) {
    if (!chat[index] || chat[index].is_user || isV2TagData_ACU(readIsolatedTagData_ACU(chat[index], isolationKey))) continue;
    return index;
  }
  return null;
}
function aiFloor_ACU(chat: any[], index: number): number { return chat.slice(0, index + 1).filter(message => message && !message.is_user).length; }

/**
 * 写入新 migration 根后，同一隔离键下其余 full checkpoint（原 V2 anchor 及更早的根）
 * 必须同事务降级，否则形成多根：回放只认最后一个 full，之前增量全部失效，且后续
 * 手动重填会被锚点预检阻断。降级语义对齐 chat-service 的 checkpoint fallback：
 * checkpoint.data（含 untimed 分片覆盖）转为 seq ≤ 0 的 data_replace fallback
 * logEntry 前置到原帧，随后删除 checkpoint——数学上不改变回放输出（降级帧位于新根
 * 之前，回放从新根起步）且原数据无损保留在帧内。
 */
function downgradeOtherFullCheckpoints_ACU(chat: any[], isolationKey: string, keepIndex: number): number {
  let downgraded = 0;
  for (let index = 0; index < chat.length; index += 1) {
    if (index === keepIndex) continue;
    const message = chat[index];
    if (!message || message.is_user) continue;
    const tagData = readIsolatedTagData_ACU(message, isolationKey) as any;
    if (!isV2TagData_ACU(tagData)) continue;
    const frame = tagData.storageFrame;
    const checkpoint = frame.checkpoint;
    if (checkpoint?.kind !== 'full') continue;
    const existingEntries = Array.isArray(frame.logEntries) ? frame.logEntries : [];
    const finiteSeqs = existingEntries.map((entry: any) => Number(entry?.seq)).filter(Number.isFinite);
    const seq = Math.min(0, (finiteSeqs.length > 0 ? Math.min(...finiteSeqs) : 1) - 1);
    const fallbackData = clone_ACU(checkpoint.data || {}) as Record<string, any>;
    const sheetCheckpoints = frame.perSheetCheckpoints;
    if (sheetCheckpoints && typeof sheetCheckpoints === 'object' && !Array.isArray(sheetCheckpoints)) {
      for (const [sheetKey, sheetCheckpoint] of Object.entries<any>(sheetCheckpoints)) {
        if (
          !sheetKey.startsWith('sheet_')
          || !sheetCheckpoint
          || sheetCheckpoint.kind !== 'sheet_full'
          || sheetCheckpoint.sheetKey !== sheetKey
          || !sheetCheckpoint.data
          || typeof sheetCheckpoint.data !== 'object'
          || Array.isArray(sheetCheckpoint.data)
        ) continue;
        if (sheetCheckpoint.timeline !== undefined) continue;
        fallbackData[sheetKey] = clone_ACU(sheetCheckpoint.data);
      }
    }
    const sheetKeys = Object.keys(fallbackData).filter(key => key.startsWith('sheet_'));
    frame.logEntries = [{
      seq,
      entryId: `downgraded-checkpoint-${index}-${checkpoint.createdAt || Date.now()}`,
      createdAt: checkpoint.createdAt || Date.now(),
      source: 'system',
      targetMessageIndex: index,
      aiFloor: aiFloor_ACU(chat, index),
      filledSheetKeys: sheetKeys,
      changedSheetKeys: sheetKeys,
      groupKeys: [],
      operations: [{ kind: 'data_replace', data: fallbackData as TableDataObject_ACU, reason: 'checkpoint_fallback' }],
      writeSet: [{ kind: 'all' }],
    }, ...existingEntries];
    delete frame.checkpoint;
    downgraded += 1;
  }
  return downgraded;
}

function stableJson_ACU(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.keys(item).sort().reduce<Record<string, unknown>>((result, key) => {
      result[key] = item[key];
      return result;
    }, {});
  });
}
function sameEvidence_ACU(left: MixedStorageDecision_ACU['evidence'], right: MixedStorageDecision_ACU['evidence']): boolean {
  return left.legacy.candidateFingerprint === right.legacy.candidateFingerprint
    && stableJson_ACU(left.legacy.sourceMessageIndices) === stableJson_ACU(right.legacy.sourceMessageIndices)
    && stableJson_ACU(left.legacy.sourceAiFloors) === stableJson_ACU(right.legacy.sourceAiFloors)
    && left.legacy.sourceFingerprint === right.legacy.sourceFingerprint
    && left.v2.replay.fingerprint === right.v2.replay.fingerprint
    && stableJson_ACU(left.v2.anchor) === stableJson_ACU(right.v2.anchor)
    && stableJson_ACU(left.v2.frames) === stableJson_ACU(right.v2.frames);
}
function v2Projection_ACU(chat: any[], isolationKey: string): unknown[] {
  return chat.map((message, messageIndex) => {
    const tagData = readIsolatedTagData_ACU(message, isolationKey);
    return isV2TagData_ACU(tagData) ? { messageIndex, storageFrame: tagData.storageFrame } : null;
  });
}
async function currentEvidenceMatchesDecision_ACU(
  chat: any[],
  decision: MixedStorageDecision_ACU,
  isolationConfig: Readonly<IsolationConfig_ACU>,
): Promise<boolean> {
  const evidence = await collectMixedStorageEvidence_ACU({
    chat,
    isolationKey: decision.scopeSnapshot.activeIsolationKey,
    isolationConfig,
    legacyCandidateData: decision.legacyRepair.candidateData as any,
  });
  return sameEvidence_ACU(decision.evidence, evidence);
}
function commitFailure_ACU(decision: MixedStorageDecision_ACU, error: string): MixedStorageCommitResult_ACU {
  return { status: 'commit_failed_rolled_back', decisionId: decision.decisionId, error };
}

function buildDecisionBackup_ACU(
  decision: MixedStorageDecision_ACU,
  action: MixedStorageCommitAction_ACU,
  createdAt: number,
): MixedStorageDecisionBackupV1_ACU {
  return {
    version: 1, createdAt, action,
    legacyData: clone_ACU(decision.legacyAudit.sourceData),
    legacyFingerprint: decision.legacyFingerprint,
    v2Fingerprint: decision.v2Fingerprint,
    sourceMessageIndices: [...decision.evidence.legacy.sourceMessageIndices],
    sourceAiFloors: [...decision.evidence.legacy.sourceAiFloors],
    decisionId: decision.decisionId, decisionKind: decision.kind,
  };
}

/**
 * Commits only an evaluator-authorized action. Before mutation, source evidence and scope
 * are refreshed to reject stale decisions; a merge candidate is then deterministically
 * constructed from the frozen decision without replaying it as a post-generation proof.
 * The host is called exactly once on a successful commit.
 */
export async function commitMixedStorageDecision_ACU(options: MixedStorageCommitOptions_ACU): Promise<MixedStorageCommitResult_ACU> {
  const { decision, action, isolationConfig } = options;
  if (!decision.allowedActions.includes(action)) return commitFailure_ACU(decision, 'decision does not authorize this action');
  if (action === 'keep_v2' && decision.kind !== 'equivalent_provenance_verified' && decision.kind !== 'equivalent_projection_verified' && decision.kind !== 'v2_successor_verified') {
    return commitFailure_ACU(decision, 'keep_v2 requires a verified V2 decision');
  }
  if (action === 'commit_merge_candidate' && (decision.kind !== 'legacy_has_v2_missing_data' || !decision.frozenMergeCandidate)) {
    return commitFailure_ACU(decision, 'merge commit requires a frozen merge candidate');
  }
  const scopeError = scopeError_ACU(decision);
  if (scopeError) return commitFailure_ACU(decision, scopeError);
  const chat = getChatArray_ACU();
  try {
    if (!await currentEvidenceMatchesDecision_ACU(chat, decision, isolationConfig)) {
      return commitFailure_ACU(decision, 'mixed storage evidence changed after decision creation');
    }
  } catch (error) {
    return commitFailure_ACU(decision, `unable to revalidate mixed storage evidence: ${error instanceof Error ? error.message : String(error)}`);
  }

  const candidateChat = clone_ACU(chat);
  const isolationKey = decision.scopeSnapshot.activeIsolationKey;
  const originalV2 = v2Projection_ACU(candidateChat, isolationKey);
  const createdAt = Date.now();
  const backup = buildDecisionBackup_ACU(decision, action, createdAt);
  const backupTargetIndex = action === 'keep_v2' ? decision.evidence.v2.anchor.messageIndex : null;
  if (action === 'keep_v2' && (backupTargetIndex === null || !isV2TagData_ACU(readIsolatedTagData_ACU(candidateChat[backupTargetIndex], isolationKey)))) {
    return commitFailure_ACU(decision, 'verified V2 anchor is unavailable for decision backup');
  }
  if (action === 'commit_merge_candidate') {
    const candidateData = clone_ACU(decision.frozenMergeCandidate!);
    if (auditTableDataForUpgrade_ACU(candidateData).status !== 'clean') {
      return commitFailure_ACU(decision, 'frozen merge candidate no longer satisfies the canonical audit');
    }
    const targetIndex = latestSafeAiTarget_ACU(candidateChat, isolationKey);
    const anchorIndex = decision.evidence.v2.anchor.messageIndex;
    if (targetIndex === null || anchorIndex === null || targetIndex <= anchorIndex) {
      return commitFailure_ACU(decision, 'no later non-V2 AI message is available for an append-only merge checkpoint');
    }
    const target = candidateChat[targetIndex];
    const provenance = {
      version: 1 as const,
      legacyDataFingerprint: getTableDataFingerprint_ACU(candidateData),
      legacySourceMessageIndices: [...decision.evidence.legacy.sourceMessageIndices],
      legacySourceAiFloors: [...decision.evidence.legacy.sourceAiFloors],
      legacyLastChangedAiFloorBySheet: clone_ACU(decision.evidence.legacy.lastChangedAiFloorBySheet),
      targetMessageIndex: targetIndex,
      targetAiFloor: aiFloor_ACU(candidateChat, targetIndex),
      isolationKey,
      migratedAt: createdAt,
    };
    if (!validateMigrationProvenanceV1_ACU(provenance).valid) return commitFailure_ACU(decision, 'merge provenance validation failed');
    const checkpoint = buildCanonicalFullCheckpoint_ACU({
      createdAt,
      reason: 'migration',
      data: candidateData,
      scheduleSummary: Object.fromEntries(Object.entries(provenance.legacyLastChangedAiFloorBySheet).map(([sheetKey, lastChangedAiFloor]) => [sheetKey, { lastChangedAiFloor }])),
      migrationProvenance: provenance,
      context: { messageIndex: targetIndex, aiFloor: provenance.targetAiFloor, isolationKey },
    });
    if (!checkpoint.checkpoint) return commitFailure_ACU(decision, checkpoint.error || 'merge checkpoint construction failed');
    const isolated = cloneIsolatedData_ACU(target) as Record<string, any>;
    const existing = readIsolatedTagData_ACU(target, isolationKey) as any;
    isolated[isolationKey] = {
      ...(existing?.summaryVectorIndexState !== undefined ? { summaryVectorIndexState: existing.summaryVectorIndexState } : {}),
      ...(existing?.summaryVectorIndexManifest !== undefined ? { summaryVectorIndexManifest: existing.summaryVectorIndexManifest } : {}),
      _acu_storage_version: 2,
      mixedStorageDecisionBackup: backup,
      storageFrame: { version: 2, headRevision: `checkpoint:mixed-merge:${createdAt.toString(36)}`, checkpoint: checkpoint.checkpoint, logEntries: [] },
    };
    target.TavernDB_ACU_IsolatedData = isolated;
    downgradeOtherFullCheckpoints_ACU(candidateChat, isolationKey, targetIndex);
  }
  if (action === 'keep_v2') {
    const target = candidateChat[backupTargetIndex!];
    const isolated = cloneIsolatedData_ACU(target) as Record<string, any>;
    const existing = readIsolatedTagData_ACU(target, isolationKey) as any;
    isolated[isolationKey] = { ...existing, mixedStorageDecisionBackup: backup };
    target.TavernDB_ACU_IsolatedData = isolated;
  }
  removeLegacy_ACU(candidateChat, isolationKey, isolationConfig);
  if (action === 'keep_v2' && stableJson_ACU(originalV2) !== stableJson_ACU(v2Projection_ACU(candidateChat, isolationKey))) {
    return commitFailure_ACU(decision, 'legacy cleanup unexpectedly changed a V2 frame');
  }
  const finalScopeError = scopeError_ACU(decision);
  if (finalScopeError) return commitFailure_ACU(decision, finalScopeError);

  const originalChat = clone_ACU(chat);
  chat.splice(0, chat.length, ...candidateChat);
  try {
    await saveChatToHostStrict_ACU();
  } catch (error) {
    chat.splice(0, chat.length, ...originalChat);
    return commitFailure_ACU(decision, `host save failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const expectedStorageMode = getCurrentStorageMode();
  try {
    const postSaveScopeError = scopeError_ACU(decision);
    if (postSaveScopeError) throw new Error(`scope changed after host save: ${postSaveScopeError}`);
    if (expectedStorageMode === 'sqlite') {
      await reloadStorageProvider();
      if (didSqliteFallbackAfterReload_ACU(expectedStorageMode)) {
        throw new Error('SQLite 运行时重载后已静默回退到 native provider。');
      }
    }
    const postReloadScopeError = scopeError_ACU(decision);
    if (postReloadScopeError) throw new Error(`scope changed during post-commit reload: ${postReloadScopeError}`);
  } catch (error) {
    return { status: 'committed_postcondition_failed', decisionId: decision.decisionId, error: error instanceof Error ? error.message : String(error) };
  }
  return { status: 'committed', decisionId: decision.decisionId };
}

