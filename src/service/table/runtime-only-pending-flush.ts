/**
 * service/table/runtime-only-pending-flush.ts — 把 runtime-only 变更物化进聊天 V2 帧。
 *
 * 触发时机（见 runtime-only-pending-state 的问题描述）：
 * - 任何普通（非 skipChatSave）持久化提交之前——兑现文档承诺「随后一次落盘写入即持久化」；
 * - 任何填表构建基底之前——填表基底来自聊天回放，必须先让聊天追上 live runtime，
 *   否则 AI 会把 runtime 里已有的行当作不存在重新 INSERT；
 * - 首楼 seed checkpoint 建立之前——seed 会重载运行时，未落盘的行会被直接丢弃。
 *
 * 做法：对登记的表，以当前运行时内容写一条 source:'system' 的 sheet_replace 增量到
 * 最新可追加的 AI 楼层；与聊天回放内容完全一致的表跳过（避免无意义的日志条目）。
 * 不推进 runtime revision（runtime 本身没有变化），不作为填表记录（不推进调度）。
 */

import type { Sheet_ACU, TableDataObject_ACU } from '../../shared/models/table-data';
import type { TableMutationOperationV2_ACU } from './storage-frame-v2-types';
import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { currentChatFileIdentifier_ACU, currentJsonTableData_ACU, getCurrentIsolationKey_ACU, settings_ACU } from '../runtime/state-manager';
import { isSqliteMode } from './storage-mode';
import { loadTableStateFromFramesV2Detailed_ACU } from './storage-frame-v2-replay';
import { getLatestTableAppendMessageIndexFromChat_ACU } from './table-history';
import { ensureStorageProviderReady_ACU } from './table-storage-strategy';
import { runTableUpdateCommit_ACU } from './table-update-commit';
import {
  clearRuntimeOnlyPendingSheets_ACU,
  readRuntimeOnlyPendingSheets_ACU,
  registerRuntimeOnlyPendingFlusher_ACU,
  type RuntimeOnlyPendingFlushResult_ACU,
} from './runtime-only-pending-state';

function cloneJson_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function currentScope_ACU(): { chatKey: string; isolationKey: string } {
  return {
    chatKey: String(currentChatFileIdentifier_ACU || ''),
    isolationKey: String(getCurrentIsolationKey_ACU() || ''),
  };
}

async function readRuntimeSnapshot_ACU(): Promise<TableDataObject_ACU | null> {
  if (isSqliteMode()) {
    const provider = await ensureStorageProviderReady_ACU();
    const data = provider.getCurrentData();
    return data ? cloneJson_ACU(data as TableDataObject_ACU) : null;
  }
  return currentJsonTableData_ACU ? cloneJson_ACU(currentJsonTableData_ACU as TableDataObject_ACU) : null;
}

function serializeSheetContent_ACU(sheet: unknown): string {
  const content = (sheet as Sheet_ACU | null)?.content;
  return JSON.stringify(Array.isArray(content) ? content : null);
}

/**
 * 回放到目标楼层，找出运行时内容与聊天不一致的表。回放失败时保守地返回全部候选表：
 * 多写一条与既有状态相同的 sheet_replace 是幂等的，漏写才会丢数据。
 */
async function resolveDivergedSheetKeys_ACU(
  chat: any[],
  isolationKey: string,
  targetMessageIndex: number,
  runtimeData: TableDataObject_ACU,
  candidateSheetKeys: string[],
): Promise<string[]> {
  try {
    const replay = await loadTableStateFromFramesV2Detailed_ACU(chat, isolationKey, {
      maxMessageIndex: targetMessageIndex,
      updateRuntimeState: false,
      allowTemporaryTemplateBaseline: true,
    });
    const replayed = replay?.data as Record<string, unknown> | undefined;
    if (!replayed) return candidateSheetKeys;
    return candidateSheetKeys.filter(sheetKey => (
      serializeSheetContent_ACU(replayed[sheetKey]) !== serializeSheetContent_ACU((runtimeData as Record<string, unknown>)[sheetKey])
    ));
  } catch (error) {
    logWarn_ACU('[RuntimeOnlyFlush] 回放比对失败，按全部登记表落盘。', error);
    return candidateSheetKeys;
  }
}

export async function flushRuntimeOnlyPendingChanges_ACU(reason: string): Promise<RuntimeOnlyPendingFlushResult_ACU> {
  const scope = currentScope_ACU();
  const pending = readRuntimeOnlyPendingSheets_ACU(scope);
  if (!pending) return { flushed: false, sheetKeys: [] };

  let runtimeData: TableDataObject_ACU | null;
  try {
    runtimeData = await readRuntimeSnapshot_ACU();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarn_ACU(`[RuntimeOnlyFlush] ${reason}: 无法读取运行时快照，保留待落盘登记。`, error);
    return { flushed: false, sheetKeys: [], error: message };
  }
  if (!runtimeData) return { flushed: false, sheetKeys: [], error: 'runtime snapshot unavailable' };

  const runtimeSheetKeys = Object.keys(runtimeData).filter(key => key.startsWith('sheet_'));
  const candidateSheetKeys = pending.all
    ? runtimeSheetKeys
    : pending.sheetKeys.filter(sheetKey => runtimeSheetKeys.includes(sheetKey));
  if (candidateSheetKeys.length === 0) {
    // 登记的表已不在运行时（被删除/重载），没有可落盘的内容。
    clearRuntimeOnlyPendingSheets_ACU(scope);
    return { flushed: false, sheetKeys: [] };
  }

  const chat = getChatArray_ACU();
  const targetMessageIndex = getLatestTableAppendMessageIndexFromChat_ACU(chat, scope.isolationKey, settings_ACU);
  if (targetMessageIndex < 0) {
    return { flushed: false, sheetKeys: [], error: 'no AI message to persist runtime-only changes' };
  }

  const divergedSheetKeys = await resolveDivergedSheetKeys_ACU(chat, scope.isolationKey, targetMessageIndex, runtimeData, candidateSheetKeys);
  if (divergedSheetKeys.length === 0) {
    clearRuntimeOnlyPendingSheets_ACU(scope);
    logDebug_ACU(`[RuntimeOnlyFlush] ${reason}: 运行时与聊天回放一致，无需落盘（${candidateSheetKeys.join('、')}）。`);
    return { flushed: false, sheetKeys: [] };
  }

  const operations: TableMutationOperationV2_ACU[] = divergedSheetKeys.map(sheetKey => ({
    kind: 'sheet_replace',
    sheetKey,
    sheet: cloneJson_ACU((runtimeData as Record<string, any>)[sheetKey]) as Sheet_ACU,
    reason: 'system',
  }));
  const writeSet = divergedSheetKeys.map(sheetKey => ({ kind: 'sheet' as const, sheetKey }));

  const commitResult = await runTableUpdateCommit_ACU<null>({
    source: 'system',
    reason: `runtime_only_flush:${reason}`,
    isolationKey: scope.isolationKey,
    writeSet,
    // 运行时本身没有变化，只是把它写回聊天：不推进 runtime revision，
    // 否则会让并发填表已捕获的 baseRevision 误判为冲突。
    revisionWriteSet: [],
    workingDataMode: 'none',
    initialData: runtimeData,
    targetMessageIndex,
    targetSheetKeys: divergedSheetKeys,
    updateGroupKeys: null,
    trackingSheetKeys: [],
    trackAsUpdate: false,
    operations,
    skipRuntimeOnlyPendingFlush: true,
  }, () => ({
    success: true,
    value: null,
    tableData: runtimeData as TableDataObject_ACU,
    persist: { operations, revisionWriteSet: [] },
  }));

  if (!commitResult.success) {
    logWarn_ACU(`[RuntimeOnlyFlush] ${reason}: 运行时未落盘变更写回聊天失败，保留登记待下次重试：${commitResult.error || 'unknown error'}`);
    return { flushed: false, sheetKeys: divergedSheetKeys, error: commitResult.error };
  }

  clearRuntimeOnlyPendingSheets_ACU(scope);
  logDebug_ACU(`[RuntimeOnlyFlush] ${reason}: 已把运行时未落盘变更写回 AI 楼层 #${commitResult.messageIndex ?? targetMessageIndex}：${divergedSheetKeys.join('、')}。`);
  return { flushed: true, sheetKeys: divergedSheetKeys, messageIndex: commitResult.messageIndex ?? targetMessageIndex };
}

registerRuntimeOnlyPendingFlusher_ACU(flushRuntimeOnlyPendingChanges_ACU);
