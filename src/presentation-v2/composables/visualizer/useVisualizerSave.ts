import { TABLE_ORDER_FIELD_ACU } from '../../../shared/constants';
import { topLevelWindow_ACU } from '../../../shared/env';
import { notifyTemplateRuntimeCommitted_ACU } from '../../../shared/template-runtime-change';
import {
  applySheetOrderNumbers_ACU,
  ensureSheetOrderNumbers_ACU,
  isSummaryOrOutlineTable_ACU,
  logDebug_ACU,
  logWarn_ACU,
  parseTableTemplateJson_ACU,
} from '../../../shared/utils';
import {
  isDefaultTemplatePresetSelection_ACU,
  normalizeTemplatePresetSelectionValue_ACU,
} from '../../../shared/template-preset-utils';
import { getChatArray_ACU } from '../../../service/chat/chat-service';
import {
  currentJsonTableData_ACU,
  getCurrentIsolationKey_ACU,
  settings_ACU,
  _set_currentJsonTableData_ACU,
} from '../../../service/runtime/state-manager';
import {
  applySummaryIndexSequenceToTable_ACU,
  deleteTableLocksForSheet_ACU,
  getSummaryIndexColumnIndex_ACU,
  saveTableLocksForSheet_ACU,
  setSpecialIndexLockEnabled_ACU,
} from '../../../service/runtime/helpers-remaining';
import { getCurrentWorldbookConfig_ACU } from '../../../service/settings/settings-readers';
import { runTableUpdateCommit_ACU } from '../../../service/table/table-update-commit';
import {
  getLatestAiMessageIndexFromChat_ACU,
  resolveTableHistoryStateFromChat_ACU,
} from '../../../service/table/table-history';
import { isSqliteMode } from '../../../service/table/storage-mode';
import { commitCurrentFloorTemplateChanges_ACU, commitCurrentFloorTemplateScopeOnly_ACU, demoteTemplateOnlyRootToScopeOnly_ACU } from '../../../service/table/storage-frame-v2-persist';
import { captureTableRuntimeRevisionForWriteSet_ACU } from '../../../service/table/table-write-transaction';
import { preflightSchemaMigrations_ACU } from '../../../service/table/schema-migration-preflight';
import { resolveTemplateSwitchMode_ACU } from '../../../service/table/template-switch-mode-resolver';
import type { TableDataObject_ACU } from '../../../shared/models/table-data';
import { normalizeCanonicalTableRows_ACU } from '../../../shared/canonical-row-normalizer';
import { reloadStorageProvider } from '../../../service/table/table-storage-strategy';
import { applyTemplateScopeForCurrentChat_ACU } from '../../../service/settings/settings-service';
import {
  buildChatSheetGuideDataFromData_ACU,
  getChatSheetGuideDataForIsolationKey_ACU,
  getSortedSheetKeys_ACU,
  sanitizeTemplateSnapshotForChat_ACU,
} from '../../../service/template/chat-scope';
import { generateDDL, validateDDLTextAgainstHeaders_ACU } from '../../../data/sqlite/schema-mapper';
import {
  applyTemplatePresetToCurrent_ACU,
  getTemplatePreset_ACU,
  resolveActiveTemplatePresetName_ACU,
  upsertTemplatePreset_ACU,
} from '../../../service/template/template-preset-service';
import {
  ensureGlobalInjectionConfigDefaults_ACU,
  getGlobalInjectionConfigFromData_ACU,
  purgeSheetKeysFromChatHistoryHard_ACU,
} from '../../../service/worldbook/injection-engine';
import { refreshMergedDataAndNotify_ACU, updateReadableLorebookEntry_ACU } from '../../../service/worldbook/pipeline';
import { enqueueSummaryVectorIndexFlush_ACU } from '../../../service/vector/summary-vector-index-flush-queue';
import { deleteCurrentSummaryVectorIndexFromChat_ACU } from '../../../service/vector/summary-vector-index-chat-service';
import {
  applyVisualizerPendingDataOps_ACU,
  hasVisualizerPendingDataOps_ACU,
  replaceVisualizerTemporaryRowIds_ACU,
} from '../../../service/visualizer/visualizer-data-ops';
import { useToastStore } from '../../stores/toast-store';
import { useVisualizerStore, type VisualizerLockDraft, type VisualizerSaveTarget } from '../../stores/visualizer-store';

export interface VisualizerSaveInteractions {
  requestGlobalPresetName?: (defaultName: string) => string | null | Promise<string | null>;
  confirmOverwriteGlobalPreset?: (presetName: string) => boolean | Promise<boolean>;
  confirmDestructiveSchemaChange?: (summary: VisualizerDestructiveSchemaChangeSummary) => boolean | Promise<boolean>;
  requestSchemaMigrationChoice?: (summary: VisualizerSchemaMigrationChoiceSummary) => string | null | Promise<string | null>;
}

export interface VisualizerSchemaMigrationChoiceSummary {
  sheetKey: string;
  message: string;
  choices: Array<{ id: string; label: string }>;
  /** Rebase keeps the candidate Sheet authoritative when no historical mapping is desired. */
  rebaseChoiceId: string;
}

export interface VisualizerDestructiveSchemaChangeSummary {
  sheets: Array<{
    sheetKey: string;
    tableName: string;
    droppedColumns: Array<{ physicalName: string; displayHeader: string; index: number }>;
    affectedRowCount: number;
  }>;
}

type GlobalTemplateSaveResult =
  | { status: 'saved'; presetName: string }
  | { status: 'unchanged' }
  | { status: 'cancelled' };

function cloneData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function applySpecialIndexSequenceFromDrafts(
  data: Record<string, any>,
  lockDrafts: Record<string, VisualizerLockDraft>,
): void {
  Object.keys(data || {}).forEach(sheetKey => {
    if (!sheetKey.startsWith('sheet_')) return;
    const table = data[sheetKey];
    if (!table || !isSummaryOrOutlineTable_ACU(String(table.name || ''))) return;
    if (lockDrafts[sheetKey]?.specialIndexLocked === false) return;
    const colIndex = getSummaryIndexColumnIndex_ACU(table);
    if (colIndex < 0) return;
    applySummaryIndexSequenceToTable_ACU(table, colIndex);
  });
}

function buildOrderedData(
  tempData: Record<string, any> | null,
  sheetOrder: string[],
  lockDrafts: Record<string, VisualizerLockDraft>,
  options: {
    /** When false, preserve existing orderNo values (sparse holes allowed). Default true. */
    renumberOrder?: boolean;
    /** When false, skip summary special-index rewrite that mutates content. Default true. */
    applySpecialIndex?: boolean;
  } = {},
): Record<string, any> {
  const source = tempData || { mate: { type: 'chatSheets', version: 1 } };
  const orderedData: Record<string, any> = {};
  Object.keys(source).forEach(key => {
    if (!key.startsWith('sheet_')) orderedData[key] = cloneData(source[key]);
  });
  sheetOrder.forEach(key => {
    if (source[key]) orderedData[key] = cloneData(source[key]);
  });
  const renumberOrder = options.renumberOrder !== false;
  const applySpecialIndex = options.applySpecialIndex !== false;
  if (renumberOrder) applySheetOrderNumbers_ACU(orderedData, sheetOrder);
  if (applySpecialIndex) applySpecialIndexSequenceFromDrafts(orderedData, lockDrafts);
  return orderedData;
}

function saveLockDrafts(drafts: Record<string, VisualizerLockDraft>, tempData: Record<string, any> | null): void {
  Object.entries(drafts || {}).forEach(([sheetKey, draft]) => {
    if (!sheetKey) return;
    // 草稿索引指向编辑器工作副本：以它为上下文把索引解析为身份键（row_id/列名）后存储。
    saveTableLocksForSheet_ACU(sheetKey, {
      rows: new Set(draft.rows || []),
      cols: new Set(draft.cols || []),
      cells: new Set(draft.cells || []),
    }, tempData?.[sheetKey]?.content);
    setSpecialIndexLockEnabled_ACU(sheetKey, draft.specialIndexLocked !== false);
  });
}

type VisualizerTemplateChanges_ACU = {
  addedSheetKeys: string[];
  schemaChangedSheetKeys: string[];
  metadataChangedSheetKeys: string[];
  deletedSheetKeys: string[];
  mateChanged: boolean;
};

function sortForComparison_ACU(value: any): any {
  if (Array.isArray(value)) return value.map(sortForComparison_ACU);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce<Record<string, any>>((result, key) => {
    result[key] = sortForComparison_ACU(value[key]);
    return result;
  }, {});
}

function sameTemplateValue_ACU(left: any, right: any): boolean {
  return JSON.stringify(sortForComparison_ACU(left)) === JSON.stringify(sortForComparison_ACU(right));
}

function projectSheetSchema_ACU(sheet: any): Record<string, any> {
  return {
    uid: sheet?.uid,
    headers: Array.isArray(sheet?.content?.[0]) ? cloneData(sheet.content[0]) : [],
    ddl: sheet?.sourceData?.ddl || '',
  };
}

function projectSheetPersistentMetadata_ACU(sheet: any): Record<string, any> {
  const sourceData = cloneData(sheet?.sourceData || {});
  delete sourceData.ddl;
  const metadata: Record<string, any> = { sourceData };
  if (sheet?.name !== undefined) metadata.name = sheet.name;
  if (sheet?.orderNo !== undefined) metadata.orderNo = sheet.orderNo;
  if (sheet?.updateConfig !== undefined) metadata.updateConfig = cloneData(sheet.updateConfig);
  if (sheet?.exportConfig !== undefined) metadata.exportConfig = cloneData(sheet.exportConfig);
  return metadata;
}

/**
 * mate 级持久化投影。
 * 只纳入「用户可在编辑器中修改」的 mate 字段：
 * - globalInjectionConfig：全局注入位置配置（唯一 UI 入口）
 * 刻意排除：
 * - type / version：结构常量，由 sanitize / ensure 链路补齐，纳入会产生伪变更
 * - updateConfigUiSentinel：由持久层补齐（storage-frame-v2-persist.ts:3145），
 *   UI 侧写的是 sheet.updateConfig.uiSentinel，与 mate 无关
 * 两侧都必须过 ensureGlobalInjectionConfigDefaults_ACU 规范化，
 * 否则「基线未含该字段 + 草稿已被 ensureWriteBack 写入默认值」会被误判为变更。
 */
function projectTemplateMateProjection_ACU(data: Record<string, any> | null): Record<string, any> {
  return {
    globalInjectionConfig: ensureGlobalInjectionConfigDefaults_ACU(
      cloneData(data?.mate?.globalInjectionConfig ?? null),
    ),
  };
}

function classifyVisualizerTemplateChanges_ACU(
  baseData: Record<string, any> | null,
  nextData: Record<string, any>,
): VisualizerTemplateChanges_ACU {
  const baseKeys = Object.keys(baseData || {}).filter(key => key.startsWith('sheet_'));
  const nextKeys = Object.keys(nextData || {}).filter(key => key.startsWith('sheet_'));
  const addedSheetKeys = nextKeys.filter(key => !baseKeys.includes(key));
  const deletedSheetKeys = baseKeys.filter(key => !nextKeys.includes(key));
  const schemaChangedSheetKeys = nextKeys.filter(key => baseData?.[key]
    && !sameTemplateValue_ACU(projectSheetSchema_ACU(baseData[key]), projectSheetSchema_ACU(nextData[key])));
  const metadataChangedSheetKeys = nextKeys.filter(key => baseData?.[key]
    && !sameTemplateValue_ACU(projectSheetPersistentMetadata_ACU(baseData[key]), projectSheetPersistentMetadata_ACU(nextData[key])));
  const mateChanged = !sameTemplateValue_ACU(
    projectTemplateMateProjection_ACU(baseData),
    projectTemplateMateProjection_ACU(nextData),
  );
  return { addedSheetKeys, schemaChangedSheetKeys, metadataChangedSheetKeys, deletedSheetKeys, mateChanged };
}

function prepareTemplateSheetsForCommit_ACU(
  data: Record<string, any>,
  sheetKeys: string[],
): { removedNullRowCount: number } {
  const scopedData = Object.fromEntries(sheetKeys.map(sheetKey => [sheetKey, data[sheetKey]]));
  const normalization = normalizeCanonicalTableRows_ACU(scopedData);
  if (normalization.errors.length > 0) {
    throw new Error(`模板保存被拒绝：存在无法自动合并的 row_id 问题。`);
  }
  for (const sheetKey of sheetKeys) {
    const sheet = data[sheetKey];
    const headers = sheet?.content?.[0];
    if (!sheet || !Array.isArray(headers) || headers[0] !== 'row_id') {
      throw new Error(`模板保存被拒绝：${sheetKey} 缺少 row_id 表头。`);
    }
    if (!sheet.sourceData || typeof sheet.sourceData !== 'object') sheet.sourceData = {};
    if (!String(sheet.sourceData.ddl || '').trim()) sheet.sourceData.ddl = generateDDL(sheet, sheet.uid || sheetKey);
    const ddlValidation = validateDDLTextAgainstHeaders_ACU(sheet.sourceData.ddl, headers);
    if (!ddlValidation.valid) throw new Error(`模板保存被拒绝：${sheetKey} 的 DDL 无法 strict hydrate：${ddlValidation.message}`);
  }
  return { removedNullRowCount: normalization.removedRows.length };
}

async function saveGlobalTemplateSnapshot(
  orderedData: Record<string, any>,
  interactions: VisualizerSaveInteractions,
): Promise<GlobalTemplateSaveResult> {
  const templateObj: Record<string, any> = {};
  Object.keys(orderedData || {}).forEach(key => {
    if (!key.startsWith('sheet_')) templateObj[key] = cloneData(orderedData[key]);
  });
  if (!templateObj.mate || typeof templateObj.mate !== 'object') {
    templateObj.mate = { type: 'chatSheets', version: 1 };
  }
  if (!templateObj.mate.type) templateObj.mate.type = 'chatSheets';
  if (!Number.isFinite(templateObj.mate.version)) templateObj.mate.version = 1;
  templateObj.mate.globalInjectionConfig = getGlobalInjectionConfigFromData_ACU(orderedData, {
    ensureWriteBack: true,
  });

  const orderedSheetKeys = getSortedSheetKeys_ACU(orderedData, { ignoreChatGuide: true });
  orderedSheetKeys.forEach(key => {
    const currentTable = orderedData?.[key];
    if (!currentTable || typeof currentTable !== 'object') return;
    const templateTable = cloneData(currentTable);
    if (Array.isArray(templateTable.content) && templateTable.content.length > 1) {
      templateTable.content = [templateTable.content[0]];
    }
    templateTable[TABLE_ORDER_FIELD_ACU] = currentTable[TABLE_ORDER_FIELD_ACU];
    templateObj[key] = templateTable;
  });

  ensureSheetOrderNumbers_ACU(templateObj, {
    baseOrderKeys: orderedSheetKeys,
    forceRebuild: false,
  });

  const isolationKey = getCurrentIsolationKey_ACU();
  const activePresetName = normalizeTemplatePresetSelectionValue_ACU(
    resolveActiveTemplatePresetName_ACU({ fallbackToGlobal: true, isolationKey }),
  );
  let finalGlobalPresetName = activePresetName;
  if (isDefaultTemplatePresetSelection_ACU(finalGlobalPresetName)) {
    const promptedName = interactions.requestGlobalPresetName
      ? await interactions.requestGlobalPresetName('新模板预设')
      : null;
    if (!promptedName) return { status: 'cancelled' };
    finalGlobalPresetName = normalizeTemplatePresetSelectionValue_ACU(String(promptedName).trim());
  } else {
    const confirmed = interactions.confirmOverwriteGlobalPreset
      ? await interactions.confirmOverwriteGlobalPreset(finalGlobalPresetName)
      : false;
    if (!confirmed) return { status: 'cancelled' };
  }
  if (!finalGlobalPresetName) return { status: 'cancelled' };

  const preparedSnapshot = sanitizeTemplateSnapshotForChat_ACU(templateObj);
  // 比较对象是「目标预设自身」的 templateStr，而不是全局 profile 串：
  // 目标预设不存在（新建场景）视为有变化，必须落库。
  const targetPresetStr = getTemplatePreset_ACU(finalGlobalPresetName)?.templateStr || '';
  if (!preparedSnapshot?.templateStr) {
    throw new Error('无法生成模板快照。');
  }
  if (targetPresetStr && preparedSnapshot.templateStr === targetPresetStr) return { status: 'unchanged' };
  const presetSaved = upsertTemplatePreset_ACU(finalGlobalPresetName, preparedSnapshot.templateStr);
  if (!presetSaved) throw new Error('无法写入全局预设库。');

  const applied = await applyTemplatePresetToCurrent_ACU(finalGlobalPresetName, {
    source: 'visualizer_v2_save_to_global',
    updateGlobal: true,
    save: true,
    persistChatScope: false,
  });
  if (!applied) throw new Error('模板快照应用失败。');
  // S1-3：inherit_global 聊天下全局切换经协调器，失败（含破坏性 blockers）时
  // 全局预设名/生效模板未变，抛错让保存流程按失败收尾。
  if (typeof applied === 'object' && 'saved' in applied && applied.saved === false) {
    throw new Error(typeof (applied as any).error === 'string' && (applied as any).error ? (applied as any).error : '模板快照应用失败。');
  }
  return { status: 'saved', presetName: finalGlobalPresetName };
}

async function saveCurrentDataToChat(
  sheetKeysToSave: string[],
  deletedSheetKeys: string[],
): Promise<'memory-only' | 'saved'> {
  const chat = getChatArray_ACU();
  if (!chat.length) return 'memory-only';

  const isolationKey = getCurrentIsolationKey_ACU();
  const allSheetKeys = sheetKeysToSave.filter(key => !!currentJsonTableData_ACU?.[key]);
  const latestAiIndex = getLatestAiMessageIndexFromChat_ACU(chat);
  const bucketByIndex: Record<number, string[]> = {};

  allSheetKeys.forEach(key => {
    const table = currentJsonTableData_ACU?.[key];
    const history = resolveTableHistoryStateFromChat_ACU(chat, {
      sheetKey: key,
      isSummaryTable: table ? isSummaryOrOutlineTable_ACU(table.name) : false,
      isolationKey,
      settings: settings_ACU,
    });
    const idx = history.latestDataMessageIndex !== -1
      ? history.latestDataMessageIndex
      : latestAiIndex;
    if (idx === -1) return;
    if (!bucketByIndex[idx]) bucketByIndex[idx] = [];
    bucketByIndex[idx].push(key);
  });

  if (Object.keys(bucketByIndex).length === 0 && latestAiIndex !== -1) {
    bucketByIndex[latestAiIndex] = [...allSheetKeys];
  }
  if (Object.keys(bucketByIndex).length === 0) return 'memory-only';

  for (const [indexStr, keys] of Object.entries(bucketByIndex)) {
    const idx = Number.parseInt(indexStr, 10);
    if (Number.isNaN(idx)) continue;
    const writeSet = keys.map(sheetKey => ({ kind: 'sheet' as const, sheetKey }));
    const commitResult = await runTableUpdateCommit_ACU<null>({
      source: 'manual_crud',
      reason: 'visualizer_v2_save',
      isolationKey,
      writeSet,
      revisionWriteSet: writeSet,
      initialData: currentJsonTableData_ACU as any,
      targetMessageIndex: idx,
      targetSheetKeys: keys,
      updateGroupKeys: null,
      trackingSheetKeys: [],
      trackAsUpdate: false,
      operations: keys
        .filter(sheetKey => Boolean((currentJsonTableData_ACU as any)?.[sheetKey]))
        .map(sheetKey => ({ kind: 'sheet_replace' as const, sheetKey, sheet: (currentJsonTableData_ACU as any)[sheetKey], reason: 'manual_crud' as const })),
    }, () => ({
      success: true,
      value: null,
      tableData: currentJsonTableData_ACU as any,
      mutationResult: { changes: keys.length, errors: [] },
    }));
    if (!commitResult.success) {
      logWarn_ACU('[ACU-V2 Visualizer] save commit failed:', commitResult.error);
    }
  }

  if (deletedSheetKeys.length > 0) {
    const result = await purgeSheetKeysFromChatHistoryHard_ACU(deletedSheetKeys);
    if (result?.changed && isSqliteMode()) {
      try {
        await reloadStorageProvider();
      } catch (error) {
        logWarn_ACU('[ACU-V2 Visualizer] reloadStorageProvider failed:', error);
      }
    }
  }

  await refreshMergedDataAndNotify_ACU();

  const shouldSyncSummaryVectorIndex = allSheetKeys.some(sheetKey => {
    const table = currentJsonTableData_ACU?.[sheetKey];
    return !!table?.name && isSummaryOrOutlineTable_ACU(String(table.name || ''));
  });
  if (shouldSyncSummaryVectorIndex && getCurrentWorldbookConfig_ACU().summaryVectorIndexModeEnabled === true) {
    try {
      await enqueueSummaryVectorIndexFlush_ACU({
        targetMessageIndex: latestAiIndex !== -1 ? latestAiIndex : undefined,
        mode: 'sync',
        reason: 'visualizer_v2_save',
      });
    } catch (error) {
      logWarn_ACU('[ACU-V2 Visualizer] summary vector index queue failed:', error);
    }
  }

  try {
    (topLevelWindow_ACU as any).AutoCardUpdaterAPI?._notifyTableUpdate?.();
  } catch (error) {
    logDebug_ACU('[ACU-V2 Visualizer] table update notification skipped:', error);
  }

  return 'saved';
}

export function useVisualizerSave(interactions: VisualizerSaveInteractions = {}) {
  const visualizer = useVisualizerStore();
  const toastStore = useToastStore();

  async function runSaving(task: () => Promise<boolean>): Promise<boolean> {
    if (visualizer.isSaving) return false;
    visualizer.setSaving(true);
    try {
      return await task();
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存失败，请查看控制台日志。';
      logWarn_ACU('[ACU-V2 Visualizer] save failed:', error);
      toastStore.error(message, { muteable: false });
      return false;
    } finally {
      visualizer.setSaving(false);
    }
  }

  async function saveDataToCurrentMessage(): Promise<boolean> {
    return runSaving(async () => {
      const deletedSheetKeys = [...new Set((visualizer.deletedSheetKeys || [])
        .filter(key => typeof key === 'string' && key.startsWith('sheet_')),
      )];
      const hasDataChanges = hasVisualizerPendingDataOps_ACU(visualizer);
      if (hasDataChanges && deletedSheetKeys.length > 0) {
        toastStore.error('行数据增量与整表删除无法原子提交；请分别保存行数据和删表操作。', { muteable: false });
        return false;
      }
      const hasLockChanges = visualizer.lockDirty;
      const result = hasDataChanges
        ? await applyVisualizerPendingDataOps_ACU(visualizer)
        : { success: true, changed: false };
      if (!result.success) {
        toastStore.error(result.error || '数据保存失败。', { muteable: false });
        return false;
      }
      if (!result.changed && deletedSheetKeys.length === 0 && !hasLockChanges) {
        // 数据路径不负责模板层配置。若检测到仅存在 mate 级配置变更（如全局注入配置），
        // 给出可执行指引，而非误导性的「没有需要保存的」。
        const mateChanged = classifyVisualizerTemplateChanges_ACU(
          visualizer.templateBaseData,
          visualizer.tempData,
        ).mateChanged;
        toastStore.info(
          mateChanged
            ? '全局注入配置属于模板层，请使用「保存模板到当前聊天」保存。'
            : '没有需要保存的数据、锁或删表增量。',
          { muteable: false });
        return false;
      }
      if (deletedSheetKeys.length > 0) {
        const purgeResult = await purgeSheetKeysFromChatHistoryHard_ACU(deletedSheetKeys);
        if (purgeResult?.changed && isSqliteMode()) {
          try {
            await reloadStorageProvider();
          } catch (error) {
            logWarn_ACU('[ACU-V2 Visualizer] reloadStorageProvider failed after sheet purge:', error);
          }
        }
      }
      if (hasLockChanges) saveLockDrafts(visualizer.tableLockDrafts, visualizer.tempData);
      try {
        // 阶段 E：行数据保存路径复用 applyVisualizerPendingDataOps_ACU 已完成的
        // post-save canonical replay 结果，避免 merged refresh 内部再整链 replay 一次
        // （普通保存由四轮收敛为三轮）。删表等结构操作不携带 canonicalData，
        // 保持冷路径全量刷新。
        await refreshMergedDataAndNotify_ACU({ canonicalData: result.canonicalData || null });
      } catch (error: any) {
        if (visualizer.pendingDataOps?.committed) {
          throw new Error(`数据已持久化，但本地运行时刷新失败：${error?.message || String(error)}`);
        }
        throw error;
      }
      replaceVisualizerTemporaryRowIds_ACU(visualizer, result.insertedRowIds || {});
      try {
        (topLevelWindow_ACU as any).AutoCardUpdaterAPI?._notifyTableUpdate?.();
      } catch {}
      visualizer.markSaved('data');
      toastStore.success(
        deletedSheetKeys.length > 0 ? '数据增量、锁设置与删表清理已保存到当前消息。'
          : result.changed && hasLockChanges ? '数据增量与锁设置已保存到当前消息。'
            : result.changed ? '数据增量已保存到当前消息。'
            : '表格锁设置已保存。',
        { muteable: false },
      );
      return true;
    });
  }

  async function saveTemplateToCurrentChat(): Promise<boolean> {
    return runSaving(async () => {
      const commitMateOnlyTemplateChange = async (options: { hasPendingLocks: boolean }): Promise<boolean> => {
        const guideIsolationKey = getCurrentIsolationKey_ACU();
        // 1. fail-closed 前置：模板基线必须存在且包含 sheet，否则无法证明 sheet 投影一致。
        const hasSheetBaseline = visualizer.templateBaseData
          && Object.keys(visualizer.templateBaseData).some(key => key.startsWith('sheet_'));
        if (!hasSheetBaseline) {
          toastStore.error('模板基线缺失，无法安全保存全局配置；请重新载入当前聊天后重试。', { muteable: false });
          return false;
        }
        // 2. 构建 guideData（复用现有写法，含 preserveSeedRowsFromGuideData 与 seedRowsFromTemplateObj）。
        //    跳过 prepareTemplateSheetsForCommit_ACU：mate-only 没有变更 sheet，无需 DDL strict 校验。
        const existingGuide = getChatSheetGuideDataForIsolationKey_ACU(guideIsolationKey);
        const guideData = buildChatSheetGuideDataFromData_ACU(orderedData, {
          preserveSeedRowsFromGuideData: existingGuide,
          seedRowsFromTemplateObj: parseTableTemplateJson_ACU({ stripSeedRows: false }),
          orderedKeys: [...visualizer.sheetOrder],
        });
        if (!guideData || !Object.keys(guideData).some(key => key.startsWith('sheet_'))) {
          throw new Error('无法为当前模板结构生成聊天指导表。');
        }
        // 3. switchMode 分流。
        const switchMode = resolveTemplateSwitchMode_ACU(getChatArray_ACU(), guideIsolationKey);
        logDebug_ACU(`[ACU-V2 Visualizer] saveTemplateToCurrentChat mate-only 分流: mode=${switchMode.mode}${switchMode.mode === 'blocked' ? `, reason=${switchMode.reason}` : ''}。`);
        if (switchMode.mode === 'blocked') {
          toastStore.error(`模板保存已阻止：${switchMode.reason}`, { muteable: false });
          return false;
        }
        let commitResult;
        if (switchMode.mode === 'pristine') {
          // pristine 会话：与既有 pristine 分支完全一致的三态判定，不得简化为按 reason 文案匹配。
          const demotion = await demoteTemplateOnlyRootToScopeOnly_ACU({
            isolationKey: guideIsolationKey,
            requestId: `visualizer_v2_save:${guideIsolationKey}`,
          });
          if (!demotion.ok && demotion.noReplayRoot === true) {
            logDebug_ACU(`[ACU-V2 Visualizer] 聊天无回放根，跳过降级直接 scope-only：${demotion.reason}`);
          } else if (!demotion.ok) {
            toastStore.error(`模板保存被降级预检阻止：${demotion.reason || 'template_only_root 降级失败。'}`, { muteable: false });
            return false;
          }
          // 注意：与既有非-mate pristine 分支不同，此处**不得**传 pristineOverride: true。
          // 既有 pristine 分支传 true 是因为其基线可能为空对象（无 sheet），投影校验必然失败；
          // 而 mate-only 的 fail-closed 前置已强制要求基线存在 sheet（hasSheetBaseline），
          // 因此投影校验可正常执行。传 pristineOverride: true 会掩盖 R2 场景
          // （摘要索引锁静默改写数据行导致的 sheet 投影漂移），把「无法证明仅 mate 变化」
          // 的状态伪装成保存成功。计划 :77 与风险 R2 明确禁止此行为。
          commitResult = await commitCurrentFloorTemplateScopeOnly_ACU({
            isolationKey: guideIsolationKey,
            baselineData: visualizer.templateBaseData as any,
            candidateData: orderedData as any,
            guideData,
            templateSource: cloneData(orderedData),
            presetName: resolveActiveTemplatePresetName_ACU({ fallbackToGlobal: true, isolationKey: guideIsolationKey }),
            source: 'visualizer_v2_save',
            reason: 'visualizer_v2_template_mate_only',
            pristineOverride: false,
          });
        } else {
          // inherit 模式：直接走 scope-only（不得改走结构提交，它会因空 sheetChanges 拒绝）。
          commitResult = await commitCurrentFloorTemplateScopeOnly_ACU({
            isolationKey: guideIsolationKey,
            baselineData: visualizer.templateBaseData as any,
            candidateData: orderedData as any,
            guideData,
            templateSource: cloneData(orderedData),
            presetName: resolveActiveTemplatePresetName_ACU({ fallbackToGlobal: true, isolationKey: guideIsolationKey }),
            source: 'visualizer_v2_save',
            reason: 'visualizer_v2_template_mate_only',
            pristineOverride: false,
          });
        }
        // 5. 失败处理：投影不一致时追加可执行指引。
        if (!commitResult.saved) {
          const errorText = commitResult.error || '全局配置保存失败。';
          const projectionMismatch = errorText.includes('scope-only 模板提交要求 baseline 与 candidate 的持久化 Sheet 投影完全一致');
          toastStore.error(
            projectionMismatch
              ? `${errorText}存在未提交的表内容差异，请先保存数据到当前消息，再保存全局配置。`
              : errorText,
            { muteable: false },
          );
          return false;
        }
        // 6. 成功后置（顺序与既有成功路径一致）。
        try {
          applyTemplateScopeForCurrentChat_ACU();
        } catch (error) {
          logWarn_ACU('[ACU-V2 Visualizer] mate-only commit saved but applyTemplateScopeForCurrentChat failed:', error);
          toastStore.warning('模板已保存，但模板作用域运行时同步失败；请重新载入当前聊天后重试。', { muteable: false });
        }
        try {
          _set_currentJsonTableData_ACU(cloneData(orderedData));
        } catch (error) {
          logWarn_ACU('[ACU-V2 Visualizer] mate-only commit saved but runtime data synchronization failed:', error);
          toastStore.warning('全局配置已保存，但运行时数据同步失败；请重新载入当前聊天后重试。', { muteable: false });
        }
        let lockSaveFailed = false;
        if (options.hasPendingLocks) {
          try {
            saveLockDrafts(visualizer.tableLockDrafts, visualizer.tempData);
          } catch (error) {
            lockSaveFailed = true;
            logWarn_ACU('[ACU-V2 Visualizer] mate-only commit saved but lock drafts failed:', error);
            toastStore.warning('全局配置已保存，但表格锁定设置未保存；请重试保存。', { muteable: false });
          }
        }
        if (isSqliteMode()) {
          try {
            await reloadStorageProvider();
          } catch (error) {
            logWarn_ACU('[ACU-V2 Visualizer] mate-only commit saved but reloadStorageProvider failed:', error);
            toastStore.warning('全局配置已保存，但 SQLite 运行时刷新失败；请重新载入当前聊天后重试。', { muteable: false });
          }
        }
        try {
          await refreshMergedDataAndNotify_ACU();
        } catch (error) {
          logWarn_ACU('[ACU-V2 Visualizer] mate-only commit saved but refreshMergedDataAndNotify failed:', error);
          toastStore.warning('全局配置已保存，但合并数据刷新失败；请重新载入当前聊天后重试。', { muteable: false });
        }
        try {
          (topLevelWindow_ACU as any).AutoCardUpdaterAPI?._notifyTableUpdate?.();
        } catch {}
        if (lockSaveFailed && (visualizer.lockDirty || visualizer.pendingLockChanges.length > 0)) {
          visualizer.markTemplateSavedWithPendingLocks();
        } else {
          visualizer.markSaved('template-chat');
        }
        notifyTemplateRuntimeCommitted_ACU();
        toastStore.success(
          options.hasPendingLocks
            ? '全局注入配置与表格锁定设置已保存到当前聊天。'
            : '全局注入配置已保存到当前聊天。',
          { muteable: false },
        );
        return true;
      };
      if (hasVisualizerPendingDataOps_ACU(visualizer)) {
        toastStore.error('存在未保存的数据增量；本次是模板保存，已阻止混合提交。', { muteable: false });
        return false;
      }
      const orderedData = buildOrderedData(visualizer.tempData, visualizer.sheetOrder, visualizer.tableLockDrafts, {
        renumberOrder: false,
        applySpecialIndex: false,
      });
      const changes = classifyVisualizerTemplateChanges_ACU(
        visualizer.templateBaseData,
        orderedData,
      );
      const changedSheetKeys = [...new Set([
        ...changes.addedSheetKeys,
        ...changes.schemaChangedSheetKeys,
        ...changes.metadataChangedSheetKeys,
      ])];
      const deletedSheetKeys = [...changes.deletedSheetKeys];
      const deletedSummarySheetKeys = deletedSheetKeys.filter(sheetKey => {
        const table = visualizer.templateBaseData?.[sheetKey];
        return !!table?.name && isSummaryOrOutlineTable_ACU(String(table.name));
      });
      const hasRemainingSummarySheet = Object.keys(orderedData).some(sheetKey => sheetKey.startsWith('sheet_')
        && !!orderedData[sheetKey]?.name && isSummaryOrOutlineTable_ACU(String(orderedData[sheetKey].name)));
      if (changedSheetKeys.length === 0 && deletedSheetKeys.length === 0) {
        if (!changes.mateChanged) {
          // 无 mate 变更时，保持原语义：锁优先，其余提示无变化
          if (visualizer.pendingLockChanges.length > 0 || visualizer.lockDirty) {
            saveLockDrafts(visualizer.tableLockDrafts, visualizer.tempData);
            visualizer.markSaved('template-chat');
            toastStore.success('表格锁定设置已保存。', { muteable: false });
            return true;
          }
          toastStore.info('模板结构没有变化。', { muteable: false });
          return false;
        }
        // mate-only（可叠加锁变更）→ 走 scope-only 通道。
        return await commitMateOnlyTemplateChange({
          hasPendingLocks: visualizer.lockDirty || visualizer.pendingLockChanges.length > 0,
        });
      }
      const guideIsolationKey = getCurrentIsolationKey_ACU();
      const baseRevision = captureTableRuntimeRevisionForWriteSet_ACU(
        [...new Set([...changedSheetKeys, ...deletedSheetKeys])]
          .map(sheetKey => ({ kind: 'schema' as const, sheetKey })),
        { isolationKey: guideIsolationKey },
      );
      let schemaOperations: any[] = [];
      const rebaseSheetKeys = new Set<string>();
      if (changes.schemaChangedSheetKeys.length > 0 && visualizer.templateBaseData) {
        const preflightSnapshot = {
          tempData: cloneData(visualizer.tempData),
          sheetOrder: [...visualizer.sheetOrder],
          templateBaseData: cloneData(visualizer.templateBaseData),
          templateBaseSheetOrder: [...visualizer.templateBaseSheetOrder],
          deletedSheetKeys: [...visualizer.deletedSheetKeys],
          tableLockDrafts: cloneData(visualizer.tableLockDrafts),
          pendingLockChanges: cloneData(visualizer.pendingLockChanges),
          lockDirty: visualizer.lockDirty,
        };
        const schemaMigrationIntents: Record<string, any> = {};
        const requestedRebaseSheetKeys = new Set<string>();
        let preflight = await preflightSchemaMigrations_ACU({
          baselineData: visualizer.templateBaseData as any,
          candidateData: orderedData as any,
          destructiveChangeConfirmed: false,
        });
        const choiceDecisions = () => (preflight.decisions || []).filter(decision => decision.status === 'needs_choice');
        if (preflight.blockers.length > 0 && choiceDecisions().length > 0) {
          const decisions = choiceDecisions();
          const onlyChoiceBlockers = decisions.length === preflight.blockers.length
            && decisions.every(decision => Array.isArray(decision.choices) && decision.choices.length > 0);
          if (onlyChoiceBlockers && interactions.requestSchemaMigrationChoice) {
            for (const decision of decisions) {
              const rebaseChoiceId = `rebase:${decision.sheetKey}`;
              const selectedId = await interactions.requestSchemaMigrationChoice({
                sheetKey: decision.sheetKey,
                message: decision.message || '请选择该 Sheet 的历史列映射。',
                choices: (decision.choices || []).map(choice => ({ id: choice.id, label: choice.label })),
                rebaseChoiceId,
              });
              if (!selectedId) return false;
              if (selectedId === rebaseChoiceId) {
                requestedRebaseSheetKeys.add(decision.sheetKey);
                continue;
              }
              const selected = (decision.choices || []).find(choice => choice.id === selectedId);
              if (!selected) {
                toastStore.error(`schema migration 返回了无效选择：${decision.sheetKey}。`, { muteable: false });
                return false;
              }
              schemaMigrationIntents[decision.sheetKey] = cloneData(selected.intent);
            }
            const currentChoiceSnapshot = {
              tempData: cloneData(visualizer.tempData), sheetOrder: [...visualizer.sheetOrder],
              templateBaseData: cloneData(visualizer.templateBaseData), templateBaseSheetOrder: [...visualizer.templateBaseSheetOrder],
              deletedSheetKeys: [...visualizer.deletedSheetKeys], tableLockDrafts: cloneData(visualizer.tableLockDrafts),
              pendingLockChanges: cloneData(visualizer.pendingLockChanges), lockDirty: visualizer.lockDirty,
            };
            if (!sameTemplateValue_ACU(preflightSnapshot, currentChoiceSnapshot)) {
              toastStore.warning('模板结构在 schema migration 选择期间已变化；请重新保存。', { muteable: false });
              return false;
            }
            preflight = await preflightSchemaMigrations_ACU({
              baselineData: visualizer.templateBaseData as any, candidateData: orderedData as any,
              intents: schemaMigrationIntents,
              rebaseSheetKeys: [...requestedRebaseSheetKeys],
              destructiveChangeConfirmed: false,
            });
          }
        }
        if (preflight.blockers.length > 0) {
          const confirmationIssues = preflight.issues || [];
          const onlyDestructiveDropConfirmation = confirmationIssues.length > 0
            && confirmationIssues.length === preflight.blockers.length
            && confirmationIssues.every(issue => issue.code === 'DESTRUCTIVE_COLUMN_DROP_CONFIRMATION_REQUIRED');
          if (!onlyDestructiveDropConfirmation) {
            toastStore.error(`模板结构未通过 schema migration preflight：${preflight.blockers.join('；')}`, { muteable: false });
            return false;
          }
          const confirmed = interactions.confirmDestructiveSchemaChange
            ? await interactions.confirmDestructiveSchemaChange({
              sheets: confirmationIssues.map(issue => ({
                sheetKey: issue.sheetKey,
                tableName: issue.tableName,
                droppedColumns: issue.droppedColumns.map(column => ({ ...column })),
                affectedRowCount: issue.affectedRowCount,
              })),
            })
            : false;
          if (!confirmed) return false;
          const currentConfirmationSnapshot = {
            tempData: cloneData(visualizer.tempData),
            sheetOrder: [...visualizer.sheetOrder],
            templateBaseData: cloneData(visualizer.templateBaseData),
            templateBaseSheetOrder: [...visualizer.templateBaseSheetOrder],
            deletedSheetKeys: [...visualizer.deletedSheetKeys],
            tableLockDrafts: cloneData(visualizer.tableLockDrafts),
            pendingLockChanges: cloneData(visualizer.pendingLockChanges),
            lockDirty: visualizer.lockDirty,
          };
          if (!sameTemplateValue_ACU(preflightSnapshot, currentConfirmationSnapshot)) {
            toastStore.warning('模板结构在危险确认期间已变化；请重新保存。', { muteable: false });
            return false;
          }
          preflight = await preflightSchemaMigrations_ACU({
            baselineData: visualizer.templateBaseData as any,
            candidateData: orderedData as any,
            intents: schemaMigrationIntents,
            rebaseSheetKeys: [...requestedRebaseSheetKeys],
            destructiveChangeConfirmed: true,
          });
          if (preflight.blockers.length > 0) {
            toastStore.error(`模板结构未通过已确认 schema migration preflight：${preflight.blockers.join('；')}`, { muteable: false });
            return false;
          }
        }
        // 每个 schema-changed Sheet 必须恰有一个可持久化 action：migration operation 或 rebase。
        // 不允许“schema 变了但既没有 migration 也没有 rebase”的静默放行。
        const operationKeys = preflight.operations.map(operation => String(operation?.sheetKey || ''));
        const preflightChangedKeys = [...preflight.changedSheetKeys].sort();
        const expectedSchemaKeys = [...changes.schemaChangedSheetKeys].sort();
        // 兼容旧 preflight 返回值：没有 applyModes 时，operation 自然就是 migration。
        // 新契约中 applyModes 必须和 operation 的归属一致；不能把 rebase 和 migration
        // 同时用于一个 Sheet，更不能让未声明的 mode 绕过 action 校验。
        const declaredApplyModes = preflight.applyModes || {};
        const applyModes: Record<string, 'migration' | 'rebase'> = { ...declaredApplyModes };
        for (const sheetKey of operationKeys) {
          if (!applyModes[sheetKey]) applyModes[sheetKey] = 'migration';
        }
        const actionKeys = Object.keys(applyModes).sort();
        const operationKeysUnique = new Set(operationKeys).size === operationKeys.length;
        const operationModesAreMigration = operationKeys.every(sheetKey => applyModes[sheetKey] === 'migration');
        const modesAreSupported = Object.values(applyModes).every(mode => mode === 'migration' || mode === 'rebase');
        const actionValid = operationKeysUnique
          && operationModesAreMigration
          && modesAreSupported
          && sameTemplateValue_ACU(preflightChangedKeys, expectedSchemaKeys)
          && actionKeys.length === expectedSchemaKeys.length
          && new Set(actionKeys).size === actionKeys.length
          && actionKeys.every(sheetKey => expectedSchemaKeys.includes(sheetKey));
        if (!actionValid) {
          toastStore.error('模板结构预检未为每个变更 Sheet 返回 migration 或 rebase action，已拒绝保存。', { muteable: false });
          return false;
        }
        for (const [sheetKey, mode] of Object.entries(applyModes)) {
          if (mode === 'rebase') rebaseSheetKeys.add(sheetKey);
        }
        schemaOperations = preflight.operations.map(operation => cloneData(operation));
        const currentPreflightSnapshot = {
          tempData: cloneData(visualizer.tempData),
          sheetOrder: [...visualizer.sheetOrder],
          templateBaseData: cloneData(visualizer.templateBaseData),
          templateBaseSheetOrder: [...visualizer.templateBaseSheetOrder],
          deletedSheetKeys: [...visualizer.deletedSheetKeys],
          tableLockDrafts: cloneData(visualizer.tableLockDrafts),
          pendingLockChanges: cloneData(visualizer.pendingLockChanges),
          lockDirty: visualizer.lockDirty,
        };
        if (!sameTemplateValue_ACU(preflightSnapshot, currentPreflightSnapshot)) {
          toastStore.warning('模板结构在 schema migration preflight 期间已变化；请重新保存。', { muteable: false });
          return false;
        }
      }
      const existingGuide = getChatSheetGuideDataForIsolationKey_ACU(guideIsolationKey);
      const guideData = buildChatSheetGuideDataFromData_ACU(orderedData, {
        preserveSeedRowsFromGuideData: existingGuide,
        seedRowsFromTemplateObj: parseTableTemplateJson_ACU({ stripSeedRows: false }),
        orderedKeys: [...visualizer.sheetOrder],
      });
      if (!guideData || !Object.keys(guideData).some(key => key.startsWith('sheet_'))) {
        throw new Error('无法为当前模板结构生成聊天指导表。');
      }
      const preparation = prepareTemplateSheetsForCommit_ACU(orderedData, changedSheetKeys);
      const templateScopeSource = cloneData(orderedData);
      const schemaOperationBySheetKey = new Map(schemaOperations.map(operation => [operation.sheetKey, operation]));
      const sheetChanges = changedSheetKeys.map(sheetKey => {
        if (changes.addedSheetKeys.includes(sheetKey)) {
          return { kind: 'introduction' as const, sheetKey, sheetData: orderedData[sheetKey] };
        }
        if (rebaseSheetKeys.has(sheetKey)) {
          // rebase 以编辑器候选整表作为新边界快照；不伪造空 migration operation。
          return { kind: 'rebase' as const, sheetKey, sheetData: orderedData[sheetKey] };
        }
        const operations: any[] = [];
        const schemaOperation = schemaOperationBySheetKey.get(sheetKey);
        if (schemaOperation) operations.push(schemaOperation);
        if (changes.metadataChangedSheetKeys.includes(sheetKey)) {
          operations.push({
            kind: 'meta_update' as const,
            sheetKey,
            meta: projectSheetPersistentMetadata_ACU(orderedData[sheetKey]),
          });
        }
        if (operations.length === 0) {
          throw new Error(`模板保存缺少可持久化的变更 operation：${sheetKey}。`);
        }
        return {
          kind: 'operations' as const,
          sheetKey,
          targetSheetData: orderedData[sheetKey],
          operations,
        };
      });
      // 会话级模板提交分流（与 template-preset-service 的 pristine 策略对齐）：
      // - pristine / template_only_root：空数据会话，模板结构只落聊天级 guide + scope，
      //   绝不写 storage frame（零 full checkpoint），避免在聊天末尾立起回放根导致
      //   后续追平撞 fail-fast。
      // - inherit：有实质数据，走 commitCurrentFloorTemplateChanges_ACU（原有语义）。
      // - blocked：状态无法判定或已损坏，fail-closed 阻止。
      const switchMode = resolveTemplateSwitchMode_ACU(getChatArray_ACU(), guideIsolationKey);
      logDebug_ACU(`[ACU-V2 Visualizer] saveTemplateToCurrentChat 分流: mode=${switchMode.mode}${switchMode.mode === 'blocked' ? `, reason=${switchMode.reason}` : ''}, deletedSheetKeys=${deletedSheetKeys.join(',') || 'none'}, changedSheetKeys=${changedSheetKeys.join(',') || 'none'}。`);
      if (switchMode.mode === 'blocked') {
        toastStore.error(`模板保存已阻止：${switchMode.reason}`, { muteable: false });
        return false;
      }
      let commitResult;
      if (switchMode.mode === 'pristine') {
        // pristine 会话的模板保存只写聊天级 guide + template scope（见
        // commitCurrentFloorTemplateScopeOnly_ACU + pristineOverride），不写任何
        // storage frame。因此这里唯一需要防的是「聊天里残留的回放根会在 replay 中
        // 重建旧结构、与新模板 scope 冲突」。
        //
        // 降级是机会性清理，不是保存的前置条件：
        // - noReplayRoot: true → 聊天无 full checkpoint，结构零冲突，直接继续 scope-only
        // - 其余 ok: false → 有根但清不掉，或状态危险，fail-closed 阻止，零写入
        //
        // 不得改回按 reason 文案匹配，也不得把「降级没做成」当作「保存不允许」：
        // 两者任一都会让最正常的 pristine 会话永久无法保存模板（历史缺陷即此）。
        const demotion = await demoteTemplateOnlyRootToScopeOnly_ACU({
          isolationKey: guideIsolationKey,
          requestId: `visualizer_v2_save:${guideIsolationKey}`,
        });
        if (!demotion.ok && demotion.noReplayRoot === true) {
          logDebug_ACU(`[ACU-V2 Visualizer] 聊天无回放根，跳过降级直接 scope-only：${demotion.reason}`);
        } else if (!demotion.ok) {
          toastStore.error(`模板保存被降级预检阻止：${demotion.reason || 'template_only_root 降级失败。'}`, { muteable: false });
          return false;
        }
        const scopeOnlyBaseline = visualizer.templateBaseData && Object.keys(visualizer.templateBaseData).length > 0
          ? visualizer.templateBaseData
          : orderedData;
        commitResult = await commitCurrentFloorTemplateScopeOnly_ACU({
          isolationKey: guideIsolationKey,
          baselineData: scopeOnlyBaseline as any,
          candidateData: orderedData as any,
          guideData,
          templateSource: templateScopeSource,
          presetName: resolveActiveTemplatePresetName_ACU({ fallbackToGlobal: true, isolationKey: guideIsolationKey }),
          source: 'visualizer_v2_save',
          reason: 'visualizer_v2_template_scope_only',
          pristineOverride: true,
        });
        if (!commitResult.saved) {
          toastStore.error(commitResult.error || '模板/结构保存失败。', { muteable: false });
          return false;
        }
        // scope-only 不处理 deletedSheetKeys 硬删除：pristine 定义为无实质数据，但可能
        // 存在空 V2 frame 痕迹。删除后若残留 frame 痕迹，用 purge 清理；失败仅 warning，
        // 不回滚 scope-only（结构已正确，残留痕迹不影响回放）。
        if (deletedSheetKeys.length > 0) {
          try {
            const purgeResult = await purgeSheetKeysFromChatHistoryHard_ACU(deletedSheetKeys);
            if (purgeResult?.changed && isSqliteMode()) {
              await reloadStorageProvider();
            }
          } catch (error) {
            logWarn_ACU('[ACU-V2 Visualizer] scope-only 模板保存后 deletedSheetKeys 痕迹清理失败:', error);
            toastStore.warning('模板已保存，但已删除表的存储痕迹清理失败；请重新载入当前聊天后重试。', { muteable: false });
          }
        }
      } else {
        commitResult = await commitCurrentFloorTemplateChanges_ACU({
          isolationKey: guideIsolationKey,
          sheetChanges,
          deletedSheetKeys,
          guideData,
          syncTemplateScope: true,
          templateSource: templateScopeSource,
          presetName: resolveActiveTemplatePresetName_ACU({ fallbackToGlobal: true, isolationKey: guideIsolationKey }),
          // 休眠溯源（S3-4）：结构编辑在当前模板内进行，被 hide 的表的来源模板即当前活跃预设。
          hideSourcePresetName: resolveActiveTemplatePresetName_ACU({ fallbackToGlobal: true, isolationKey: guideIsolationKey }) || undefined,
          source: 'visualizer_v2_save',
          reason: 'visualizer_v2_schema_change',
          baseRevision,
        });
        if (!commitResult.saved) {
          toastStore.error(commitResult.error || '模板/结构保存失败。', { muteable: false });
          return false;
        }
      }
      logDebug_ACU(`[ACU-V2 Visualizer] saveTemplateToCurrentChat 提交完成: mode=${switchMode.mode}, commitMode=${commitResult.mode || 'unknown'}, deletedSheetKeys=${deletedSheetKeys.join(',') || 'none'}。`);
      try {
        applyTemplateScopeForCurrentChat_ACU();
      } catch (error) {
        logWarn_ACU('[ACU-V2 Visualizer] template commit saved but applyTemplateScopeForCurrentChat failed:', error);
        toastStore.warning('模板已保存，但模板作用域运行时同步失败；请重新载入当前聊天后重试。', { muteable: false });
      }
      try {
        _set_currentJsonTableData_ACU(cloneData(orderedData));
      } catch (error) {
        logWarn_ACU('[ACU-V2 Visualizer] template commit saved but runtime data synchronization failed:', error);
        toastStore.warning('模板已保存，但运行时数据同步失败；请重新载入当前聊天后重试。', { muteable: false });
      }
      for (const sheetKey of deletedSheetKeys) {
        delete visualizer.tableLockDrafts[sheetKey];
      }
      visualizer.pendingLockChanges = visualizer.pendingLockChanges.filter(change => !deletedSheetKeys.includes(String(change?.sheetKey || '')));
      try {
        for (const sheetKey of deletedSheetKeys) deleteTableLocksForSheet_ACU(sheetKey);
      } catch (error) {
        logWarn_ACU('[ACU-V2 Visualizer] template commit saved but deleted-sheet lock cleanup failed:', error);
        toastStore.warning('模板已保存，但已删除表的锁定状态清理失败；请重新载入当前聊天后重试。', { muteable: false });
      }
      let lockSaveFailed = false;
      const hasPendingLocks = visualizer.lockDirty || visualizer.pendingLockChanges.length > 0;
      if (hasPendingLocks) try {
        saveLockDrafts(visualizer.tableLockDrafts, visualizer.tempData);
      } catch (error) {
        lockSaveFailed = true;
        logWarn_ACU('[ACU-V2 Visualizer] template commit saved but lock drafts failed:', error);
        toastStore.warning('模板已保存，但表格锁定设置未保存；请重试保存。', { muteable: false });
      }
      if (isSqliteMode()) {
        try {
          await reloadStorageProvider();
        } catch (error) {
          logWarn_ACU('[ACU-V2 Visualizer] template commit saved but reloadStorageProvider failed:', error);
          toastStore.warning('模板已保存，但 SQLite 运行时刷新失败；请重新载入当前聊天后重试。', { muteable: false });
        }
      }
      if (deletedSummarySheetKeys.length > 0) {
        try {
          if (hasRemainingSummarySheet && getCurrentWorldbookConfig_ACU().summaryVectorIndexModeEnabled === true) {
            await enqueueSummaryVectorIndexFlush_ACU({ mode: 'sync', reason: 'visualizer_v2_template_sheet_delete' });
          } else if (!hasRemainingSummarySheet) {
            await deleteCurrentSummaryVectorIndexFromChat_ACU();
          }
        } catch (error) {
          logWarn_ACU('[ACU-V2 Visualizer] template commit saved but summary vector index cleanup failed:', error);
          toastStore.warning('模板已保存，但摘要向量索引清理失败；请重新载入当前聊天后重试。', { muteable: false });
        }
      }
      try {
        await refreshMergedDataAndNotify_ACU();
      } catch (error) {
        logWarn_ACU('[ACU-V2 Visualizer] template commit saved but refreshMergedDataAndNotify failed:', error);
        toastStore.warning('模板已保存，但合并数据刷新失败；请重新载入当前聊天后重试。', { muteable: false });
      }
      try {
        (topLevelWindow_ACU as any).AutoCardUpdaterAPI?._notifyTableUpdate?.();
      } catch {}
      if (lockSaveFailed && (visualizer.lockDirty || visualizer.pendingLockChanges.length > 0)) {
        visualizer.markTemplateSavedWithPendingLocks();
      } else {
        visualizer.markSaved('template-chat');
      }
      notifyTemplateRuntimeCommitted_ACU();
      const removedCount = preparation.removedNullRowCount + ((commitResult as any)?.removedNullRowCount || 0);
      const scopeOnlyMessage = switchMode.mode !== 'inherit' && commitResult.mode === 'scope_only'
        ? '（模板结构已同步到聊天配置，未写入任何数据帧）'
        : '';
      toastStore.success(
        removedCount > 0
          ? `模板/结构已保存到当前聊天${scopeOnlyMessage}，已删除 ${deletedSheetKeys.length} 张表并移除 ${removedCount} 条缺少 row_id 的数据行。`
          : deletedSheetKeys.length > 0
            ? `模板/结构已保存到当前聊天${scopeOnlyMessage}，已删除 ${deletedSheetKeys.length} 张表。`
            : `模板/结构已保存到当前聊天${scopeOnlyMessage}。`,
        { muteable: false });
      return true;
    });
  }

  async function saveTemplateToGlobal(): Promise<boolean> {
    return runSaving(async () => {
      if (hasVisualizerPendingDataOps_ACU(visualizer)) {
        toastStore.error('存在未保存的数据增量；本次是模板保存，已阻止混合提交。', { muteable: false });
        return false;
      }
      const orderedData = buildOrderedData(visualizer.tempData, visualizer.sheetOrder, visualizer.tableLockDrafts, {
        renumberOrder: false,
        applySpecialIndex: false,
      });
      const globalTemplateResult = await saveGlobalTemplateSnapshot(orderedData, interactions);
      if (globalTemplateResult.status === 'cancelled') return false;
      saveLockDrafts(visualizer.tableLockDrafts, visualizer.tempData);
      if (isSqliteMode()) await reloadStorageProvider();
      await refreshMergedDataAndNotify_ACU();
      visualizer.recordGlobalTemplateSaved();
      if (globalTemplateResult.status === 'saved') {
        toastStore.success(`模板/结构已保存到全局预设：${globalTemplateResult.presetName}。`, { muteable: false });
      } else {
        toastStore.info('全局模板无变化。', { muteable: false });
      }
      return true;
    });
  }

  return {
    saveDataToCurrentMessage,
    saveTemplateToCurrentChat,
    saveTemplateToGlobal,
    saveToChat: saveDataToCurrentMessage,
    saveToGlobal: saveTemplateToGlobal,
  };
}
