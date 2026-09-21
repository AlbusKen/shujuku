// ═══════════════════════════════════════════════════════════════
// service/table/table-service.ts — 表格数据操作 service 层
// 从 data/repositories/table-repo.ts 迁入（消除 data 层越权）
// ═══════════════════════════════════════════════════════════════

import { getChatArray_ACU, saveChatToHost_ACU } from '../../data/gateways/chat-gateway';
import { logDebug_ACU, logError_ACU, logWarn_ACU, parseTableTemplateJson_ACU } from '../../shared/utils';
import { currentJsonTableData_ACU, getCurrentIsolationKey_ACU, settings_ACU, _set_currentJsonTableData_ACU } from '../runtime/state-manager';
import { applyTemplateScopeForCurrentChat_ACU } from '../settings/settings-service';
import {
  attachSeedRowsToCurrentDataFromGuide_ACU,
  buildChatSheetGuideDataFromData_ACU,
  ensureChatSheetGuideSeeded_ACU,
  getChatSheetGuideDataForIsolationKey_ACU,
  getSortedSheetKeys_ACU,
  setChatSheetGuideDataForIsolationKey_ACU,
} from '../template/chat-scope';
import { deleteAllGeneratedEntries_ACU } from '../worldbook/pipeline';
import { consumeLastMergeSourceInventory_ACU, mergeAllIndependentTables_ACU, mergeAllIndependentTablesLegacyV1_ACU } from '../runtime/helpers-remaining';
import { readIsolatedTagData_ACU, readLegacyIndependentData_ACU, isLegacyMatchForIsolation_ACU } from '../../data/repositories/chat-message-data-repo';
import { isV2TagData_ACU, resolveTableStorageStrategy_ACU } from './storage-strategy-resolver';
import { persistTableMutationLogV2_ACU, type ReplaceExistingIncrementalOptions_ACU } from './storage-frame-v2-persist';
import { migrateLegacyStorageToV2OnLoad_ACU } from './storage-v2-migration';
import type { ManualRefillProgressV2_ACU, TableCheckpointV2_ACU, TableMutationOperationV2_ACU, TableMutationSourceV2_ACU, TableWriteConflictUnitV2_ACU } from './storage-frame-v2-types';
import type { TableWriteTransactionContext_ACU } from './table-write-transaction';
import type { TableDataObject_ACU } from '../../shared/models/table-data';

export interface TableChatPersistOptions_ACU {
  targetMessageIndex?: number;
  targetSheetKeys?: string[] | null;
  updateGroupKeys?: string[] | null;
  /**
   * 只把这些 sheet 记录为“本轮已更新”。
   * targetSheetKeys 决定保存哪些表；trackingSheetKeys 决定哪些表推进自动更新门禁。
   * 未传时沿用 targetSheetKeys，保持旧调用兼容。
   */
  trackingSheetKeys?: string[] | null;
  /**
   * 显式声明本次实际物化并完成填充的表。传入时优先于
   * trackAsUpdate/updateGroupKeys，避免把结构或元数据变更伪造为 filled。
   */
  filledSheetKeys?: string[] | null;
  tableData?: TableDataObject_ACU | null;
  trackAsUpdate?: boolean;
  source?: TableMutationSourceV2_ACU;
  requestId?: string;
  batchId?: string;
  operations?: TableMutationOperationV2_ACU[];
  baseRevision?: string | null;
  revisionWriteSet?: TableWriteConflictUnitV2_ACU[];
  forceCheckpoint?: boolean;
  checkpointReason?: TableCheckpointV2_ACU['reason'];
  manualRefillProgress?: ManualRefillProgressV2_ACU;
  /** 在本次 V2 entry 写入前替换指定 bucket 的历史增量。 */
  replaceExistingIncremental?: ReplaceExistingIncrementalOptions_ACU;
  /** 调用方已处于 transactionContext.runCommit 临界区内时使用，避免嵌套 commit 锁。 */
  assumeCommitLock?: boolean;
  /** 对破坏性复合写入要求宿主真实保存；默认保持历史宽松保存语义。 */
  strictSave?: boolean;
  /** manual catch-up provisional bridge run 的 runId；透传给 V2 persist 做准入校验。 */
  manualCatchUpRunId?: string;
  performanceRunId?: string;
  performanceParentSpanId?: string;
  transactionContext?: TableWriteTransactionContext_ACU;
}

const TABLE_PERSIST_COMMIT_MODEL_REQUIRED_ACU = 'Table persistence requires table update commit model; direct unsafe writes are not allowed.';

export async function ensureLegacyStorageMigratedBeforeWrite_ACU(reason = 'table_write'): Promise<{
  success: boolean;
  migrated?: boolean;
  data?: TableDataObject_ACU | null;
  error?: string;
}> {
  const chat = getChatArray_ACU();
  if (!Array.isArray(chat) || chat.length === 0) return { success: true, migrated: false };

  const isolationKey = getCurrentIsolationKey_ACU();
  const isolationConfig = {
    enabled: settings_ACU.dataIsolationEnabled,
    code: settings_ACU.dataIsolationCode,
  };
  const strategy = resolveTableStorageStrategy_ACU(chat, isolationKey, isolationConfig);
  if (strategy.mode !== 'legacy-v1') return { success: true, migrated: false };

  logWarn_ACU(`[LegacyMigrationGate] ${reason}: detected legacy-v1 before write, migrating first. reason=${strategy.reason}${strategy.warning ? `; warning=${strategy.warning}` : ''}`);
  const mergedLegacyData = await mergeAllIndependentTablesLegacyV1_ACU();
  const sourceInventory = consumeLastMergeSourceInventory_ACU();
  if (!mergedLegacyData || !Object.keys(mergedLegacyData).some(k => k.startsWith('sheet_'))) {
    return { success: false, error: '旧存储迁移失败：无法从 legacy-v1 合并出有效表格数据。' };
  }

  const migrationResult = await migrateLegacyStorageToV2OnLoad_ACU({
    data: mergedLegacyData,
    isolationKey,
    isolationConfig,
    skipUpdateFloors: settings_ACU.skipUpdateFloors,
    sourceInventory,
  });
  if (!migrationResult.migrated) {
    return { success: false, error: `旧存储迁移到 V2 失败: ${migrationResult.error || '未执行迁移'}` };
  }
  if (!migrationResult.data) {
    return { success: false, error: '旧存储迁移到 V2 失败: 迁移成功结果缺少修复后的表格数据。' };
  }

  const postStrategy = resolveTableStorageStrategy_ACU(chat, isolationKey, isolationConfig);
  if (postStrategy.mode === 'legacy-v1') {
    return { success: false, error: `旧存储迁移后仍检测到 legacy-v1: ${postStrategy.reason}` };
  }

  const migratedData = migrationResult.data;
  _set_currentJsonTableData_ACU(JSON.parse(JSON.stringify(migratedData)) as TableDataObject_ACU);
  return { success: true, migrated: true, data: migratedData };
}

export async function persistTablesToChatMessage_ACU(
  options: TableChatPersistOptions_ACU = {},
): Promise<{ saved: boolean; messageIndex?: number; error?: string }> {
  if (!options.transactionContext || options.assumeCommitLock !== true) {
    logError_ACU(TABLE_PERSIST_COMMIT_MODEL_REQUIRED_ACU);
    return { saved: false, error: TABLE_PERSIST_COMMIT_MODEL_REQUIRED_ACU };
  }
  return persistTablesToChatMessageWithLockOption_ACU(options);
}

async function persistTablesToChatMessageWithLockOption_ACU(
  options: TableChatPersistOptions_ACU = {},
): Promise<{ saved: boolean; messageIndex?: number; error?: string }> {
  const {
    targetMessageIndex = -1,
    targetSheetKeys = null,
    updateGroupKeys = null,
    trackingSheetKeys,
    filledSheetKeys: explicitFilledSheetKeys,
    tableData: explicitTableData,
    trackAsUpdate = true,
    source,
    requestId,
    batchId,
    operations,
    revisionWriteSet,
    forceCheckpoint,
    checkpointReason,
    manualRefillProgress,
    replaceExistingIncremental,
    assumeCommitLock,
    strictSave,
    manualCatchUpRunId,
    performanceRunId,
    performanceParentSpanId,
    transactionContext,
  } = options;

  const effectiveTableData = explicitTableData !== undefined ? explicitTableData : currentJsonTableData_ACU;
  if (!effectiveTableData) {
    logError_ACU('Save aborted: currentJsonTableData_ACU is null.');
    return { saved: false, error: 'currentJsonTableData is null' };
  }

  const currentIsolationKey = getCurrentIsolationKey_ACU();

  const persistCore = async () => {
    const chat = getChatArray_ACU();
    if (!chat || chat.length === 0) {
      logError_ACU('Save failed: Chat history is empty.');
      return { saved: false, error: 'chat history is empty' };
    }

    let strategy = resolveTableStorageStrategy_ACU(chat, currentIsolationKey, {
      enabled: settings_ACU.dataIsolationEnabled,
      code: settings_ACU.dataIsolationCode,
    });

    if (strategy.mode === 'legacy-v1') {
      const migration = await ensureLegacyStorageMigratedBeforeWrite_ACU('persistTablesToChatMessage');
      if (!migration.success) {
        const message = migration.error || 'legacy-v1 table storage migration failed before write.';
        logError_ACU(message);
        return { saved: false, error: message };
      }
      strategy = resolveTableStorageStrategy_ACU(chat, currentIsolationKey, {
        enabled: settings_ACU.dataIsolationEnabled,
        code: settings_ACU.dataIsolationCode,
      });
      if (strategy.mode === 'legacy-v1') {
        const message = `legacy-v1 table storage still detected after migration: ${strategy.reason}`;
        logError_ACU(message);
        return { saved: false, error: message };
      }
    }

    let keysToSave: string[] = Array.isArray(targetSheetKeys)
      ? targetSheetKeys.filter((sheetKey): sheetKey is string => typeof sheetKey === 'string' && sheetKey.length > 0)
      : getSortedSheetKeys_ACU(effectiveTableData);
    keysToSave = [...new Set(keysToSave.filter(sheetKey => Boolean(effectiveTableData[sheetKey])))];

    const changedCandidateKeys = Array.isArray(trackingSheetKeys)
      ? trackingSheetKeys.filter((sheetKey): sheetKey is string => typeof sheetKey === 'string' && sheetKey.length > 0)
      : keysToSave;
    const trackingKeySet = new Set(
      changedCandidateKeys.filter(sheetKey => Boolean(effectiveTableData[sheetKey]))
    );
    const metadataOnlyUpdateGroupKeys = Array.isArray(updateGroupKeys)
      ? [...new Set(updateGroupKeys.filter(sheetKey => typeof sheetKey === 'string' && Boolean(effectiveTableData[sheetKey])))]
      : [];
    const filledSheetKeys = explicitFilledSheetKeys !== undefined
      ? [...new Set((explicitFilledSheetKeys || []).filter(sheetKey => typeof sheetKey === 'string' && Boolean(effectiveTableData[sheetKey])))]
      : (trackAsUpdate ? metadataOnlyUpdateGroupKeys : []);

    try {
      const existingGuide = getChatSheetGuideDataForIsolationKey_ACU(currentIsolationKey);
      if (!existingGuide || !Object.keys(existingGuide).some(k => k.startsWith('sheet_'))) {
        const templateObjForSeed = parseTableTemplateJson_ACU({ stripSeedRows: false });
        const guideData = buildChatSheetGuideDataFromData_ACU(effectiveTableData, {
          preserveSeedRowsFromGuideData: null,
          seedRowsFromTemplateObj: templateObjForSeed,
        });
        if (guideData && Object.keys(guideData).some(k => k.startsWith('sheet_'))) {
          setChatSheetGuideDataForIsolationKey_ACU(currentIsolationKey, guideData, { reason: 'first_fill' });
          logDebug_ACU(`[SheetGuide] Created chat sheet guide for tag [${currentIsolationKey || '无标签'}] (tables=${Object.keys(guideData).filter(k => k.startsWith('sheet_')).length}).`);
        }
      }
    } catch (e) {
      logWarn_ACU('[SheetGuide] Failed to create sheet guide on first fill:', e);
    }

    const persistSource = source || (metadataOnlyUpdateGroupKeys.length > 0 ? 'group_fill' : 'system');
    // empty 只表示聊天里还没有 V2 帧。首次真实填表才剥 operations、写 init 快照。
    // Checkpoint 恢复/导入同样会在 clear 之后走到 empty，但必须保留 data_replace，
    // 否则落盘只剩 reason=init、logEntries=[]，F5 一旦剥空 checkpoint.data 就无法回放。
    const treatAsEmptyBootstrap = strategy.mode === 'empty' && persistSource !== 'import';
    const persistedOperations = treatAsEmptyBootstrap ? [] : operations;
    const persistV2InTransaction = async (transactionContext: TableWriteTransactionContext_ACU) => {
      const result = await persistTableMutationLogV2_ACU({
        targetMessageIndex,
        source: persistSource,
        afterData: effectiveTableData,
        operations: persistedOperations,
        filledSheetKeys,
        candidateChangedSheetKeys: [...trackingKeySet],
        groupKeys: metadataOnlyUpdateGroupKeys,
        requestId,
        batchId,
        forceCheckpoint: forceCheckpoint === true || treatAsEmptyBootstrap,
        checkpointReason: checkpointReason || (treatAsEmptyBootstrap ? 'init' : undefined),
        manualRefillProgress,
        replaceExistingIncremental,
        isolationKey: currentIsolationKey,
        revisionWriteSet,
        assumeCommitLock,
        strictSave,
        manualCatchUpRunId,
        performanceRunId,
        performanceParentSpanId,
        transactionContext,
      });

      return { saved: result.saved, messageIndex: result.messageIndex, error: result.error };
    };

    if (!transactionContext || assumeCommitLock !== true) {
      logError_ACU(TABLE_PERSIST_COMMIT_MODEL_REQUIRED_ACU);
      return { saved: false, error: TABLE_PERSIST_COMMIT_MODEL_REQUIRED_ACU };
    }

    transactionContext.assertFresh?.('persistTablesToChatMessage:before_v2_persist');

    return persistV2InTransaction(transactionContext);
  };

  return persistCore();
}


/**
 * @deprecated 旧兼容写入口已收口禁用。所有表格写入必须走 runTableUpdateCommit_ACU。
 */
export async function saveIndependentTableToChatHistory_ACU(
  _targetMessageIndex = -1,
  _targetSheetKeys: string[] | null = null,
  _updateGroupKeys: string[] | null = null,
  _skipPostRefresh = false,
  _trackingSheetKeys: string[] | null = _targetSheetKeys,
  _source?: TableMutationSourceV2_ACU,
  _requestId?: string,
  _batchId?: string,
  _transactionContext?: TableWriteTransactionContext_ACU,
  _operations?: TableMutationOperationV2_ACU[],
  _revisionWriteSet?: TableWriteConflictUnitV2_ACU[],
): Promise<{ saved: boolean; messageIndex?: number; error?: string }> {
  logError_ACU(TABLE_PERSIST_COMMIT_MODEL_REQUIRED_ACU);
  return { saved: false, error: TABLE_PERSIST_COMMIT_MODEL_REQUIRED_ACU };
}

/**
 * 检查当前聊天是否为首次初始化（无任何已有表格数据）。
 */
export async function checkIfFirstTimeInit_ACU(): Promise<boolean> {
  const chat = getChatArray_ACU();
  if (!chat || chat.length === 0) return true;

  const currentIsolationKey = getCurrentIsolationKey_ACU();

  for (let i = chat.length - 1; i >= 0; i--) {
    const message = chat[i];
    if (message.is_user) continue;

    const tagData = readIsolatedTagData_ACU(message, currentIsolationKey) as any;
    if (isV2TagData_ACU(tagData)) {
      const checkpointData = tagData.storageFrame?.checkpoint?.data;
      if (checkpointData && Object.keys(checkpointData).some(k => k.startsWith('sheet_'))) {
        return false;
      }
      const hasV2SheetOperation = (tagData.storageFrame?.logEntries || []).some((entry: any) =>
        Array.isArray(entry?.operations) && entry.operations.some((operation: any) => {
          if (operation?.kind === 'sheet_replace') return typeof operation.sheetKey === 'string' && operation.sheetKey.startsWith('sheet_');
          if (operation?.kind === 'sheet_schema_migrate') return typeof operation.sheetKey === 'string' && operation.sheetKey.startsWith('sheet_');
          if (operation?.kind === 'row_upsert' || operation?.kind === 'row_delete' || operation?.kind === 'meta_update') return typeof operation.sheetKey === 'string' && operation.sheetKey.startsWith('sheet_');
          if (operation?.kind === 'data_replace') return operation.data && Object.keys(operation.data).some((k: string) => k.startsWith('sheet_'));
          if (operation?.kind === 'sql_sheet_batch') return typeof operation.sheetKey === 'string' && operation.sheetKey.startsWith('sheet_') && Array.isArray(operation.statements) && operation.statements.length > 0;
          if (operation?.kind === 'sql_batch') return Array.isArray(operation.statements) && operation.statements.length > 0;
          return false;
        })
      );
      if (hasV2SheetOperation) return false;
    }
    if (tagData?.independentData && Object.keys(tagData.independentData).some(k => k.startsWith('sheet_'))) {
      return false;
    }

    const isolationConfig = { enabled: settings_ACU.dataIsolationEnabled, code: settings_ACU.dataIsolationCode };
    if (isLegacyMatchForIsolation_ACU(message, isolationConfig)) {
      const legacyIndep = readLegacyIndependentData_ACU(message);
      if (legacyIndep && Object.keys(legacyIndep).some(k => k.startsWith('sheet_'))) {
        return false;
      }
    }
  }

  return true;
}

/**
 * 从模板初始化数据库到内存（不写聊天记录）。
 * 返回 { initialized: boolean, error?: string }
 */
async function initializeJsonTableInChatHistory_ACU(): Promise<{ initialized: boolean; error?: string }> {
  logDebug_ACU('No database found in chat history. Initializing a new one from template.');

  try {
    _set_currentJsonTableData_ACU(parseTableTemplateJson_ACU({ stripSeedRows: true }));
    logDebug_ACU('Successfully initialized database in memory.');
  } catch (error) {
    logError_ACU('Failed to parse template and initialize database in memory:', error);
    _set_currentJsonTableData_ACU(null);
    return { initialized: false, error: '从模板解析数据库失败，请检查模板格式。' };
  }
  if (!currentJsonTableData_ACU) {
    return { initialized: false, error: '从模板解析数据库失败，请检查模板格式。' };
  }

  logDebug_ACU('Database initialized in memory. It will be saved to chat history on the first update.');

  try {
    const guideData = await ensureChatSheetGuideSeeded_ACU({ reason: 'init_chat_seedrows' });
    if (guideData) {
      attachSeedRowsToCurrentDataFromGuide_ACU(guideData);
    }
  } catch (e) {
    logWarn_ACU('[SheetGuide] Failed to ensure sheet guide during initialization:', e);
  }

  try {
    await deleteAllGeneratedEntries_ACU();
    logDebug_ACU('Deleted all generated lorebook entries during initialization.');
  } catch (deleteError) {
    logWarn_ACU('Failed to delete generated lorebook entries during initialization:', deleteError);
  }

  return { initialized: true };
}

/**
 * 从聊天记录加载或创建表格数据到内存。
 * 返回 { loaded: boolean, source: 'merged'|'initialized'|'empty', error?: string }
 * 注意：不再内部调用 refreshMergedDataAndNotify，调用方按需自行刷新。
 */
export async function loadOrCreateJsonTableFromChatHistory_ACU(): Promise<{
  loaded: boolean;
  source: 'merged' | 'initialized' | 'empty';
  error?: string;
  /** 本轮当前聊天回放得到的 canonical 快照，供 SQLite hydrate 显式使用。 */
  data?: TableDataObject_ACU | null;
}> {
  _set_currentJsonTableData_ACU(null);
  logDebug_ACU('Attempting to load database from chat history...');

  const chat = getChatArray_ACU();
  applyTemplateScopeForCurrentChat_ACU();
  if (!chat || chat.length === 0) {
    logDebug_ACU('Chat history is empty. Initializing new database.');
    const initResult = await initializeJsonTableInChatHistory_ACU();
    return {
      loaded: initResult.initialized,
      source: 'initialized',
      error: initResult.error,
      data: currentJsonTableData_ACU as TableDataObject_ACU | null,
    };
  }

  const mergedData = await mergeAllIndependentTables_ACU();

  if (mergedData) {
    const canonicalData = JSON.parse(JSON.stringify(mergedData)) as TableDataObject_ACU;
    _set_currentJsonTableData_ACU(canonicalData);
    logDebug_ACU('Database content successfully merged (tag-aware) and loaded into memory.');
    return { loaded: true, source: 'merged', data: canonicalData };
  }

  logDebug_ACU('No database found for current tag in chat history. Initializing a new one.');
  const initResult = await initializeJsonTableInChatHistory_ACU();
  return {
    loaded: initResult.initialized,
    source: 'initialized',
    error: initResult.error,
    data: currentJsonTableData_ACU as TableDataObject_ACU | null,
  };
}
