import type { TableDataObject_ACU } from '../../shared/models/table-data';
import type { SqlMutationResult } from '../../shared/table-storage-provider';
import { logError_ACU, logWarn_ACU } from '../../shared/utils';
import { currentChatFileIdentifier_ACU, currentJsonTableData_ACU, getCurrentIsolationKey_ACU, isAutoUpdatingCard_ACU, _set_currentJsonTableData_ACU } from '../runtime/state-manager';
import { ensureLegacyStorageMigratedBeforeWrite_ACU, persistTablesToChatMessage_ACU } from './table-service';
import { ensureStorageProviderReady_ACU, reloadStorageProvider } from './table-storage-strategy';
import { runTableWriteTransaction_ACU, type TableWriteTransactionContext_ACU } from './table-write-transaction';
import { ensureNoActiveProvisionalBridgeForCurrentScope_ACU } from './manual-catch-up-provisional-bridge';
import type { ReplaceExistingIncrementalOptions_ACU } from './storage-frame-v2-persist';
import type { ManualRefillProgressV2_ACU, TableCheckpointV2_ACU, TableMutationOperationV2_ACU, TableMutationSourceV2_ACU, TableWriteConflictUnitV2_ACU } from './storage-frame-v2-types';
import { buildSqlSheetBatchOperations_ACU, rebindSqlMutationIdentifiers_ACU } from './sql-table-service';
import {
  extractPendingSheetKeysFromWriteSet_ACU,
  markRuntimeOnlyPendingSheets_ACU,
  runRegisteredRuntimeOnlyPendingFlush_ACU,
} from './runtime-only-pending-state';

export interface TableUpdateCommitApplyContext_ACU {
  transactionContext: TableWriteTransactionContext_ACU;
  workingData: TableDataObject_ACU | null;
}

export interface TableUpdateCommitPersistOverride_ACU {
  /**
   * 在表格快照写入聊天前暂存同一聊天保存周期内的附属状态。
   * 若后续持久化失败，rollback 会在释放表锁前执行，避免表格与附属状态分叉。
   */
  beforePersist?: (tableData: TableDataObject_ACU) => Promise<{ rollback?: () => void | Promise<void> } | void> | { rollback?: () => void | Promise<void> } | void;
  targetMessageIndex?: number;
  targetSheetKeys?: string[] | null;
  updateGroupKeys?: string[] | null;
  trackingSheetKeys?: string[] | null;
  trackAsUpdate?: boolean;
  operations?: TableMutationOperationV2_ACU[];
  revisionWriteSet?: TableWriteConflictUnitV2_ACU[];
  forceCheckpoint?: boolean;
  checkpointReason?: TableCheckpointV2_ACU['reason'];
  manualRefillProgress?: ManualRefillProgressV2_ACU;
  replaceExistingIncremental?: ReplaceExistingIncrementalOptions_ACU;
  strictSave?: boolean;
}

export type TableUpdateCommitErrorCategory_ACU = 'model' | 'infrastructure' | 'precondition';

export interface TableUpdateCommitApplyResult_ACU<T> {
  success: boolean;
  value?: T;
  tableData?: TableDataObject_ACU;
  mutationResult?: SqlMutationResult;
  persist?: TableUpdateCommitPersistOverride_ACU;
  error?: string;
  errorCategory?: TableUpdateCommitErrorCategory_ACU;
}

export interface RunTableUpdateCommitOptions_ACU {
  source: TableMutationSourceV2_ACU;
  reason: string;
  chatKey?: string;
  writeSet: TableWriteConflictUnitV2_ACU[];
  revisionWriteSet?: TableWriteConflictUnitV2_ACU[];
  isolationKey?: string;
  baseRevision?: string | null;
  /** apply 已在事务外构建结果且不读取 workingData 时，可跳过事务工作副本克隆。 */
  workingDataMode?: 'clone' | 'none';
  initialData?: TableDataObject_ACU | null;
  targetMessageIndex: number;
  targetSheetKeys: string[] | null;
  updateGroupKeys?: string[] | null;
  trackingSheetKeys?: string[] | null;
  trackAsUpdate?: boolean;
  operations?: TableMutationOperationV2_ACU[];
  manualRefillProgress?: ManualRefillProgressV2_ACU;
  replaceExistingIncremental?: ReplaceExistingIncrementalOptions_ACU;
  strictSave?: boolean;
  /** manual catch-up provisional bridge run 的 runId；透传给 V2 persist 做准入校验。 */
  manualCatchUpRunId?: string;
  performanceRunId?: string;
  performanceParentSpanId?: string;
  /**
   * 旧契约：跳过聊天 V2 frame 写入（sql-api/table-crud-api 的 skipChatSave）。仍走 bridge gate 与 legacy 迁移。
   * 外部来源（manual_crud / raw_sql_*）的 skipChatSave 提交会登记为「运行时未落盘变更」，
   * 由下一次普通持久化提交或填表开始前统一写回聊天。
   */
  skipChatSave?: boolean;
  /** 仅供 runtime-only flush 自身使用：flush 提交不得再触发一次 flush。 */
  skipRuntimeOnlyPendingFlush?: boolean;
  /**
   * 提交语义判别联合（计划 5.3）。
   *
   * - 缺省或 'persist_v2'：普通持久化提交，写聊天 V2 frame 并推进 tracking/checkpoint。
   * - 'stage_only'：隔离 stage-only 提交。复用现有 apply（AI 响应收集、表白名单、SQL 重绑定、
   *   row_id 分配、编辑解析、表级校验），但最终只更新 run-scoped 的隔离 working snapshot：
   *   - 不调用 persistTablesToChatMessage_ACU；
   *   - 不推进 tracking / manualRefillProgress / summary vector flush；
   *   - 跳过 bridge gate 与 ensureLegacyStorageMigratedBeforeWrite_ACU（后者可能写聊天迁移帧）；
   *   - 成功只更新 runtime 快照（_set_currentJsonTableData_ACU）。
   * 允许恢复 bucket 前 runtime snapshot（快照保存在调用方 staging runner）。
   */
  commitMode?: 'persist_v2' | 'stage_only';
}

export interface RunTableUpdateCommitResult_ACU<T> {
  success: boolean;
  value?: T;
  tableData?: TableDataObject_ACU;
  mutationResult?: SqlMutationResult;
  saved?: boolean;
  messageIndex?: number;
  error?: string;
  errorCategory?: TableUpdateCommitErrorCategory_ACU;
}

class TableUpdateCommitError_ACU extends Error {
  constructor(message: string, readonly category: TableUpdateCommitErrorCategory_ACU) {
    super(message);
    this.name = 'TableUpdateCommitError';
  }
}

function cloneTableData_ACU(data: TableDataObject_ACU): TableDataObject_ACU {
  return JSON.parse(JSON.stringify(data));
}

function normalizeSqlBindParams_ACU(params: (string | number | null)[] | undefined): (string | number | null)[][] | undefined {
  return Array.isArray(params) && params.length > 0 ? [params.map(value => value ?? null)] : undefined;
}

/**
 * Final persistence boundary: reject malformed row identities without repairing
 * data. Identity allocation belongs to the row creation path; repairing here
 * would hide the origin of a corrupt row and could change persisted semantics.
 */
function assertPersistableRowIdentities_ACU(
  data: TableDataObject_ACU,
  reason: string,
  targetSheetKeys?: string[] | null,
): void {
  const scopedKeys = Array.isArray(targetSheetKeys) && targetSheetKeys.length > 0 ? new Set(targetSheetKeys) : null;
  for (const [sheetKey, sheet] of Object.entries(data)) {
    if (!sheetKey.startsWith('sheet_')) continue;
    if (scopedKeys && !scopedKeys.has(sheetKey)) continue;
    const content = (sheet as any)?.content;
    if (!Array.isArray(content) || content.length === 0) continue;
    const headers = content[0];
    if (!Array.isArray(headers) || String(headers[0] ?? '') !== 'row_id') {
      throw new Error(`[TableUpdateCommit] ${reason}: sheetKey=${sheetKey} 缺少 row_id 首列表头。`);
    }
    const rowIds = new Set<string>();
    for (let rowIndex = 1; rowIndex < content.length; rowIndex += 1) {
      const row = content[rowIndex];
      if (!Array.isArray(row)) {
        throw new Error(`[TableUpdateCommit] ${reason}: sheetKey=${sheetKey}, rowIndex=${rowIndex} 不是数组行。`);
      }
      const rowId = String(row[0] ?? '').trim();
      if (!rowId) {
        throw new Error(`[TableUpdateCommit] ${reason}: sheetKey=${sheetKey}, rowIndex=${rowIndex} 的 row_id 为空。`);
      }
      if (rowIds.has(rowId)) {
        throw new Error(`[TableUpdateCommit] ${reason}: sheetKey=${sheetKey}, rowIndex=${rowIndex} 的 row_id 重复：${rowId}。`);
      }
      rowIds.add(rowId);
    }
  }
}

/**
 * 填表期间会拒绝的外部变更来源：开放 API 的 CRUD/SQL 与可视化编辑器/SQL 控制台。
 * 填表自身（auto_fill/manual_fill/group_fill）、导入（import）与模板提交不受影响。
 * 拒绝而非排队：排队的写入基于陈旧快照，醒来后仍会与填表结果冲突。
 */
const EXTERNAL_MUTATION_SOURCES_ACU: ReadonlySet<TableMutationSourceV2_ACU> = new Set([
  'manual_crud',
  'raw_sql_mutation',
  'raw_sql_batch',
]);

function resolvePendingScope_ACU(options: RunTableUpdateCommitOptions_ACU): { chatKey: string; isolationKey: string } {
  return {
    chatKey: String(options.chatKey ?? currentChatFileIdentifier_ACU ?? ''),
    isolationKey: String(options.isolationKey ?? getCurrentIsolationKey_ACU() ?? ''),
  };
}

/**
 * skipChatSave 的外部写入只改了 live runtime：登记受影响的表，等下一次普通持久化写入
 * 或填表开始前统一物化进聊天，否则这些行永远不会进入楼层帧与填表基底。
 */
function markRuntimeOnlyPendingAfterSkipChatSave_ACU(
  options: RunTableUpdateCommitOptions_ACU,
  revisionWriteSet: TableWriteConflictUnitV2_ACU[] | undefined,
  tableData: TableDataObject_ACU,
): void {
  if (!EXTERNAL_MUTATION_SOURCES_ACU.has(options.source)) return;
  const candidate = extractPendingSheetKeysFromWriteSet_ACU(revisionWriteSet ?? options.writeSet);
  const pending = candidate.all
    ? { all: false, sheetKeys: Object.keys(tableData || {}).filter(key => key.startsWith('sheet_')) }
    : candidate;
  if (!pending.all && pending.sheetKeys.length === 0) return;
  markRuntimeOnlyPendingSheets_ACU(resolvePendingScope_ACU(options), pending);
}

/**
 * 普通持久化提交前先把已登记的 runtime-only 变更写回聊天；失败只记 warn，
 * 不阻断本次提交（登记保留，下一次机会再试）。
 */
async function flushRuntimeOnlyPendingBeforeCommit_ACU(options: RunTableUpdateCommitOptions_ACU): Promise<void> {
  if (options.skipChatSave || options.skipRuntimeOnlyPendingFlush) return;
  try {
    await runRegisteredRuntimeOnlyPendingFlush_ACU(resolvePendingScope_ACU(options), options.reason);
  } catch (error) {
    logWarn_ACU(`[TableUpdateCommit] ${options.reason}: 运行时未落盘变更写回聊天失败，继续本次提交。`, error);
  }
}

function assertNoActiveFillForExternalMutation_ACU(options: RunTableUpdateCommitOptions_ACU): void {
  if (!EXTERNAL_MUTATION_SOURCES_ACU.has(options.source)) return;
  if (!isAutoUpdatingCard_ACU) return;
  throw new TableUpdateCommitError_ACU(
    `[TableUpdateCommit] ${options.reason}: AI 填表正在进行中，已拒绝外部表格写入（source=${options.source}），请等待填表完成后重试。`,
    'precondition',
  );
}

function assertExpectedCommitScope_ACU(options: RunTableUpdateCommitOptions_ACU, phase: string): void {
  if (options.chatKey === undefined && options.isolationKey === undefined) return;
  const currentChatKey = String(currentChatFileIdentifier_ACU || 'current-chat');
  const expectedChatKey = String(options.chatKey ?? currentChatKey);
  const currentIsolationKey = String(getCurrentIsolationKey_ACU() || '');
  const expectedIsolationKey = String(options.isolationKey ?? currentIsolationKey);
  if (currentChatKey !== expectedChatKey || currentIsolationKey !== expectedIsolationKey) {
    throw new TableUpdateCommitError_ACU(
      `[TableUpdateCommit] ${options.reason}: ${phase} 检测到聊天或隔离标识已切换，已拒绝提交。请在当前聊天重新执行填表。`,
      'precondition',
    );
  }
}

export async function runTableUpdateCommit_ACU<T>(
  options: RunTableUpdateCommitOptions_ACU,
  apply: (context: TableUpdateCommitApplyContext_ACU) => Promise<TableUpdateCommitApplyResult_ACU<T>> | TableUpdateCommitApplyResult_ACU<T>,
): Promise<RunTableUpdateCommitResult_ACU<T>> {
  let requiresRuntimeReload = false;
  try {
    assertNoActiveFillForExternalMutation_ACU(options);
    assertExpectedCommitScope_ACU(options, '提交前');
    const commitMode = options.commitMode ?? 'persist_v2';
    if (commitMode === 'stage_only') {
      // stage-only：不进入聊天写入路径。跳过 bridge gate 与 legacy 迁移——迁移可能写聊天帧，
      // 且 staging 运行期间不应推进持久化拓扑。scope 复检已在函数入口执行。
      return await runTableWriteTransaction_ACU({
        source: options.source,
        reason: options.reason,
        chatKey: options.chatKey,
        isolationKey: options.isolationKey ?? getCurrentIsolationKey_ACU(),
        writeSet: options.writeSet,
        baseRevision: options.baseRevision,
        workingDataMode: options.workingDataMode,
        initialData: options.initialData !== undefined ? options.initialData : currentJsonTableData_ACU,
      }, async (transactionContext, workingData) => {
        let commitRevisionWriteSet = options.revisionWriteSet;
        return transactionContext.runCommit(async () => {
          assertExpectedCommitScope_ACU(options, 'stage 应用前');
          const applied = await apply({ transactionContext, workingData });
          if (!applied.success || !applied.tableData) {
            throw new TableUpdateCommitError_ACU(applied.error || `${options.reason}: stage apply failed`, applied.errorCategory || 'infrastructure');
          }
          commitRevisionWriteSet = applied.persist?.revisionWriteSet ?? options.revisionWriteSet;
          _set_currentJsonTableData_ACU(cloneTableData_ACU(applied.tableData));
          return {
            success: true,
            value: applied.value,
            tableData: applied.tableData,
            mutationResult: applied.mutationResult,
            saved: false,
            messageIndex: undefined as number | undefined,
          };
        }, () => commitRevisionWriteSet);
      });
    }
    // 普通表写入前统一恢复门：残留 provisional bridge 先自动 finalize/rollback。
    // catch-up 自身携带 runId 时跳过——该 bridge 正是本次 run 建立的，不能提前汇合。
    if (!options.manualCatchUpRunId) {
      const bridgeGate = await ensureNoActiveProvisionalBridgeForCurrentScope_ACU({
        chatKey: options.chatKey,
        isolationKey: options.isolationKey ?? getCurrentIsolationKey_ACU(),
      });
      if (!bridgeGate.ok) {
        return {
          success: false,
          error: (bridgeGate as { ok: false; error: string }).error,
          errorCategory: 'precondition',
        };
      }
    }
    const migration = await ensureLegacyStorageMigratedBeforeWrite_ACU(options.reason);
    if (!migration.success) {
      return {
        success: false,
        error: migration.error || '旧存储迁移失败，已阻止本次写入。',
        errorCategory: 'infrastructure',
      };
    }
    if (migration.migrated) {
      await reloadStorageProvider();
    }
    assertExpectedCommitScope_ACU(options, '迁移后');
    await flushRuntimeOnlyPendingBeforeCommit_ACU(options);
    assertExpectedCommitScope_ACU(options, '未落盘变更写回后');

    return await runTableWriteTransaction_ACU({
      source: options.source,
      reason: options.reason,
      chatKey: options.chatKey,
      isolationKey: options.isolationKey ?? getCurrentIsolationKey_ACU(),
      writeSet: options.writeSet,
      baseRevision: options.baseRevision,
      workingDataMode: options.workingDataMode,
      initialData: options.initialData !== undefined ? options.initialData : currentJsonTableData_ACU,
    }, async (transactionContext, workingData) => {
      let commitRevisionWriteSet = options.revisionWriteSet;
      return transactionContext.runCommit(async () => {
        let rollbackBeforePersist: (() => void | Promise<void>) | undefined;
        try {
          assertExpectedCommitScope_ACU(options, '应用前');
          const applied = await apply({ transactionContext, workingData });
          if (!applied.success || !applied.tableData) {
            throw new TableUpdateCommitError_ACU(applied.error || `${options.reason}: update apply failed`, applied.errorCategory || 'infrastructure');
          }

          let saved = true;
          let messageIndex: number | undefined;
          const persistOptions = applied.persist || {};
          const revisionWriteSet = persistOptions.revisionWriteSet ?? options.revisionWriteSet;
          const targetSheetKeys = persistOptions.targetSheetKeys !== undefined ? persistOptions.targetSheetKeys : options.targetSheetKeys;
          const operations = persistOptions.operations ?? options.operations;
          commitRevisionWriteSet = revisionWriteSet;
          const staged = persistOptions.beforePersist
            ? await persistOptions.beforePersist(applied.tableData)
            : undefined;
          if (staged && typeof staged.rollback === 'function') {
            rollbackBeforePersist = staged.rollback;
          }
          if (!options.skipChatSave) {
            assertExpectedCommitScope_ACU(options, '持久化前');
            assertPersistableRowIdentities_ACU(applied.tableData, options.reason, targetSheetKeys);
            const saveResult = await persistTablesToChatMessage_ACU({
              targetMessageIndex: persistOptions.targetMessageIndex ?? options.targetMessageIndex,
              targetSheetKeys,
              updateGroupKeys: persistOptions.updateGroupKeys !== undefined ? persistOptions.updateGroupKeys : (options.updateGroupKeys ?? null),
              trackingSheetKeys: persistOptions.trackingSheetKeys !== undefined ? persistOptions.trackingSheetKeys : (options.trackingSheetKeys ?? []),
              tableData: applied.tableData,
              trackAsUpdate: persistOptions.trackAsUpdate ?? options.trackAsUpdate ?? false,
              source: options.source,
              operations,
              revisionWriteSet,
              forceCheckpoint: persistOptions.forceCheckpoint,
              checkpointReason: persistOptions.checkpointReason,
              manualRefillProgress: persistOptions.manualRefillProgress ?? options.manualRefillProgress,
              replaceExistingIncremental: persistOptions.replaceExistingIncremental ?? options.replaceExistingIncremental,
              strictSave: persistOptions.strictSave ?? options.strictSave,
              manualCatchUpRunId: options.manualCatchUpRunId,
              performanceRunId: options.performanceRunId,
              performanceParentSpanId: options.performanceParentSpanId,
              assumeCommitLock: true,
              transactionContext,
            });
            saved = saveResult.saved;
            messageIndex = saveResult.messageIndex;
            if (!saveResult.saved) {
              logWarn_ACU(`[TableUpdateCommit] persist failed after runtime update; reload after releasing transaction locks: ${saveResult.error || 'unknown error'}`);
              requiresRuntimeReload = true;
              throw new TableUpdateCommitError_ACU(saveResult.error || `${options.reason}: persist failed`, 'infrastructure');
            }
          } else {
            markRuntimeOnlyPendingAfterSkipChatSave_ACU(options, revisionWriteSet, applied.tableData);
          }

          _set_currentJsonTableData_ACU(cloneTableData_ACU(applied.tableData));
          return {
            success: true,
            value: applied.value,
            tableData: applied.tableData,
            mutationResult: applied.mutationResult,
            saved,
            messageIndex,
          };
        } catch (error) {
          if (rollbackBeforePersist) await rollbackBeforePersist();
          throw error;
        }
      }, () => commitRevisionWriteSet);
    });
  } catch (error: any) {
    if (requiresRuntimeReload) {
      try {
        await reloadStorageProvider();
      } catch (reloadError) {
        logError_ACU(`[TableUpdateCommit] ${options.reason} failed to reload runtime after persistence failure:`, reloadError);
      }
    }
    const message = error?.message || String(error);
    const errorCategory: TableUpdateCommitErrorCategory_ACU = error instanceof TableUpdateCommitError_ACU
      ? error.category
      : 'infrastructure';
    logError_ACU(`[TableUpdateCommit] ${options.reason} failed:`, error);
    return {
      success: false,
      error: message,
      errorCategory,
    };
  }
}

export interface RunSqliteRuntimeMutationCommitOptions_ACU<T> extends RunTableUpdateCommitOptions_ACU {
  sql: string;
  params?: (string | number | null)[];
  validate?: (input: { mutationResult: SqlMutationResult; tableData: TableDataObject_ACU }) => string | null;
  mapValue: (input: { mutationResult: SqlMutationResult; tableData: TableDataObject_ACU }) => T;
}

export async function runSqliteRuntimeMutationCommit_ACU<T>(
  options: RunSqliteRuntimeMutationCommitOptions_ACU<T>,
): Promise<RunTableUpdateCommitResult_ACU<T>> {
  return runTableUpdateCommit_ACU(options, async ({ workingData }) => {
    const provider = await ensureStorageProviderReady_ACU();
    const runtimeData = (workingData || currentJsonTableData_ACU) as TableDataObject_ACU | null;
    const runtimeSql = runtimeData
      ? rebindSqlMutationIdentifiers_ACU([options.sql], runtimeData)[0]
      : options.sql;
    const mutationResult = provider.executeMutation(runtimeSql, options.params);
    if (mutationResult.errors?.length) {
      return { success: false, error: mutationResult.errors.join(', '), mutationResult };
    }
    const tableData = provider.getCurrentData();
    if (!tableData) {
      return { success: false, error: 'SQLite runtime data export failed', mutationResult };
    }
    const validationError = options.validate?.({ mutationResult, tableData: tableData as TableDataObject_ACU });
    if (validationError) {
      return { success: false, error: validationError, mutationResult, tableData: tableData as TableDataObject_ACU };
    }
    const runtimeOperations = options.operations ? undefined : buildSqlSheetBatchOperations_ACU(
      [runtimeSql],
      tableData as TableDataObject_ACU,
      {
        params: normalizeSqlBindParams_ACU(options.params),
        fallbackTargetSheetKeys: options.targetSheetKeys || undefined,
        allowSingleTargetFallback: true,
        keepLegacyForUnclassified: true,
        reason: 'manual_crud',
      },
    ).operations;
    return {
      success: true,
      value: options.mapValue({ mutationResult, tableData: tableData as TableDataObject_ACU }),
      tableData: tableData as TableDataObject_ACU,
      mutationResult,
      ...(runtimeOperations ? { persist: { operations: runtimeOperations } } : {}),
    };
  });
}
