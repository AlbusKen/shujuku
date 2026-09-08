/**
 * presentation/pages/visualizer-main-save.ts
 * 可视化编辑器保存变更
 */
import { TABLE_TEMPLATE_ACU } from '../../shared/defaults-json.js';
import { isDefaultTemplatePresetSelection_ACU, normalizeTemplatePresetSelectionValue_ACU } from '../../shared/template-preset-utils';
import { getOrderedSheetKeys_ACU } from './visualizer-sidebar';
import { showToastr_ACU } from '../theme/toast';
import { getChatArray_ACU, saveChatToHost_ACU } from '../../service/chat/chat-service';
import { currentJsonTableData_ACU, getCurrentIsolationKey_ACU, settings_ACU, _set_currentJsonTableData_ACU } from '../../service/runtime/state-manager';
import { buildChatSheetGuideDataFromData_ACU, getChatSheetGuideDataForIsolationKey_ACU, sanitizeTemplateSnapshotForChat_ACU, setChatSheetGuideDataForIsolationKey_ACU } from '../../service/template/chat-scope';
import { updateReadableLorebookEntry_ACU } from '../../service/worldbook/pipeline';
import { refreshMergedDataAndNotifyWithUI_ACU } from '../components/pipeline-ui-helpers';
import { SCRIPT_ID_PREFIX_ACU, TABLE_ORDER_FIELD_ACU } from '../../shared/constants';
import { topLevelWindow_ACU } from '../../shared/env';
import { safeJsonStringify_ACU } from '../../shared/json-helpers';
import { applySheetOrderNumbers_ACU, ensureSheetOrderNumbers_ACU, isSummaryOrOutlineTable_ACU, logDebug_ACU, logError_ACU, logWarn_ACU, parseTableTemplateJson_ACU } from '../../shared/utils';
import { applyTemplatePresetToCurrent_ACU, resolveActiveTemplatePresetName_ACU, upsertTemplatePreset_ACU } from '../../service/template/template-preset-service';
import { loadTemplatePresetSelect_ACU } from '../components/template-preset-ui';
import { updateCardUpdateStatusDisplay_ACU } from '../components/update-status-display';
import { applySpecialIndexSequenceToSummaryTables_ACU } from '../../service/runtime/helpers-remaining';
import { getSortedSheetKeys_ACU, materializeDataFromSheetGuide_ACU } from '../../service/template/chat-scope';
import { getGlobalInjectionConfigFromData_ACU } from '../../service/worldbook/injection-engine';
import { _acuVisState } from './visualizer';
import { $popupInstance_ACU } from '../state/ui-refs';
import { closeACUWindow } from '../window/window-system';
import { isSqliteMode } from '../../service/table/storage-mode';
import { reloadStorageProvider } from '../../service/table/table-storage-strategy';
import { getLatestAiMessageIndexFromChat_ACU, getLatestTableAppendMessageIndexFromChat_ACU } from '../../service/table/table-history';
import { getCurrentWorldbookConfig_ACU } from '../../service/settings/settings-readers';
import { enqueueSummaryVectorIndexFlush_ACU } from '../../service/vector/summary-vector-index-flush-queue';
import {
    applyVisualizerPendingDataOps_ACU,
    hasVisualizerPendingDataOps_ACU,
    replaceVisualizerTemporaryRowIds_ACU,
    resetVisualizerPendingDataOps_ACU,
} from './visualizer-data-ops';
import { validateSqliteTemplateDataStrict_ACU } from '../../service/table/sqlite-template-validation';
import { validateDDLTextAgainstHeaders_ACU } from '../../shared/ddl-utils';

function cloneData_ACU<T>(value: T): T {
    return JSON.parse(JSON.stringify(value || {}));
}

function cloneMaybe_ACU(value: any): any {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function getDataSheetKeys_ACU(data: any): string[] {
    return data && typeof data === 'object' ? Object.keys(data).filter(key => key.startsWith('sheet_')) : [];
}

function prepareOrderedVisualizerData_ACU(): Record<string, any> {
    const orderedData: Record<string, any> = {};
    const orderedKeys = getOrderedSheetKeys_ACU();

    Object.keys(_acuVisState.tempData || {}).forEach((key: string) => {
        if (!key.startsWith('sheet_')) orderedData[key] = _acuVisState.tempData[key];
    });

    orderedKeys.forEach((key: string) => {
        if (_acuVisState.tempData?.[key]) orderedData[key] = _acuVisState.tempData[key];
    });

    applySheetOrderNumbers_ACU(orderedData, orderedKeys);
    applySpecialIndexSequenceToSummaryTables_ACU(orderedData);
    return orderedData;
}

function hasTemplateStructureChanges_ACU(templateData: Record<string, any>): boolean {
    const runtimeData = currentJsonTableData_ACU || {};
    const sheetKeys = new Set([...getDataSheetKeys_ACU(runtimeData), ...getDataSheetKeys_ACU(templateData)]);
    if (JSON.stringify(runtimeData?.mate?.globalInjectionConfig || {}) !== JSON.stringify(templateData?.mate?.globalInjectionConfig || {})) return true;

    for (const sheetKey of sheetKeys) {
        const before = runtimeData[sheetKey];
        const after = templateData[sheetKey];
        if (!before || !after) return true;
        const fields = ['name', 'sourceData', 'updateConfig', 'exportConfig', TABLE_ORDER_FIELD_ACU];
        for (const field of fields) {
            if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) return true;
        }
        const beforeHeader = Array.isArray(before?.content?.[0]) ? before.content[0] : [];
        const afterHeader = Array.isArray(after?.content?.[0]) ? after.content[0] : [];
        if (JSON.stringify(beforeHeader) !== JSON.stringify(afterHeader)) return true;
    }
    return false;
}

function buildTemplateCompatibilityCandidate_ACU(templateData: Record<string, any>, options: { includeRuntimeRows: boolean }): { data: Record<string, any>; issues: string[] } {
    const runtimeData = options.includeRuntimeRows ? (currentJsonTableData_ACU || {}) : {};
    const candidate = cloneData_ACU(templateData);
    const issues: string[] = [];

    getDataSheetKeys_ACU(candidate).forEach((sheetKey: string) => {
        const nextSheet = candidate[sheetKey];
        const oldSheet = runtimeData[sheetKey];
        const nextHeader = Array.isArray(nextSheet?.content?.[0]) ? cloneData_ACU(nextSheet.content[0]) : ['row_id'];
        const oldHeader = Array.isArray(oldSheet?.content?.[0]) ? oldSheet.content[0] : [];
        const oldRows = Array.isArray(oldSheet?.content) ? oldSheet.content.slice(1) : [];
        const oldHeaderIndex = new Map<string, number>();

        oldHeader.forEach((header: any, index: number) => {
            const key = String(header ?? '').trim();
            if (key && !oldHeaderIndex.has(key)) oldHeaderIndex.set(key, index);
        });

        const nextRows = oldRows.map((oldRow: any[]) => nextHeader.map((header: any, index: number) => {
            if (index === 0) return Array.isArray(oldRow) ? (oldRow[0] ?? null) : null;
            const oldIndex = oldHeaderIndex.get(String(header ?? '').trim());
            return oldIndex === undefined || !Array.isArray(oldRow) ? '' : (oldRow[oldIndex] ?? '');
        }));
        nextSheet.content = [nextHeader, ...nextRows];

        if (isSqliteMode()) {
            const ddl = String(nextSheet?.sourceData?.ddl || '').trim();
            if (!ddl) {
                issues.push(`表「${nextSheet?.name || sheetKey}」缺少 DDL，SQLite 模式下不能保存该模板。`);
            } else {
                const validation = validateDDLTextAgainstHeaders_ACU(ddl, nextHeader);
                if (!validation.valid) issues.push(`表「${nextSheet?.name || sheetKey}」DDL 与表头不兼容：${validation.message}`);
            }
        }
    });

    return { data: candidate, issues };
}

async function validateTemplateCompatibleWithRuntimeData_ACU(templateData: Record<string, any>, options: { includeRuntimeRows: boolean }): Promise<{ success: boolean; data?: Record<string, any>; error?: string }> {
    const candidate = buildTemplateCompatibilityCandidate_ACU(templateData, options);
    if (candidate.issues.length > 0) {
        return { success: false, error: candidate.issues.slice(0, 5).join('\n') };
    }

    if (!isSqliteMode()) return { success: true, data: candidate.data };

    const validation = await validateSqliteTemplateDataStrict_ACU(candidate.data);
    if (!validation.success) return { success: false, error: validation.error };
    return { success: true, data: candidate.data };
}

function buildTemplateObjectFromVisualizerData_ACU(templateData: Record<string, any>, orderedKeys: string[]): { templateObj: any; changed: boolean } {
    let templateObj: any = null;
    try {
        templateObj = JSON.parse(TABLE_TEMPLATE_ACU);
    } catch (_) {
        templateObj = {};
    }
    if (!templateObj || typeof templateObj !== 'object') templateObj = {};

    const tempGlobalCfg = getGlobalInjectionConfigFromData_ACU(templateData, { ensureWriteBack: true });
    const prevGlobalCfgStr = safeJsonStringify_ACU(templateObj?.mate?.globalInjectionConfig || {}, '{}');
    const nextGlobalCfgStr = safeJsonStringify_ACU(tempGlobalCfg || {}, '{}');
    if (!templateObj.mate || typeof templateObj.mate !== 'object') templateObj.mate = { type: 'chatSheets', version: 1 };
    if (!templateObj.mate.type) templateObj.mate.type = 'chatSheets';
    if (!Number.isFinite(templateObj.mate.version)) templateObj.mate.version = 1;
    templateObj.mate.globalInjectionConfig = tempGlobalCfg;

    let changed = prevGlobalCfgStr !== nextGlobalCfgStr;

    getDataSheetKeys_ACU(templateData).forEach((key: string) => {
        const currentTable = templateData[key];
        if (!templateObj[key]) {
            const newTemplateTable = cloneData_ACU(currentTable);
            if (Array.isArray(newTemplateTable.content) && newTemplateTable.content.length > 1) {
                newTemplateTable.content = [newTemplateTable.content[0]];
            }
            newTemplateTable[TABLE_ORDER_FIELD_ACU] = currentTable[TABLE_ORDER_FIELD_ACU];
            templateObj[key] = newTemplateTable;
            changed = true;
            return;
        }

        const templateTable = templateObj[key];
        let tableChanged = false;
        const fields = ['name', 'sourceData', 'updateConfig', 'exportConfig', TABLE_ORDER_FIELD_ACU];
        fields.forEach((field: string) => {
            if (JSON.stringify(templateTable[field]) !== JSON.stringify(currentTable[field])) {
                if (currentTable[field] === undefined) delete templateTable[field];
                else templateTable[field] = cloneMaybe_ACU(currentTable[field]);
                tableChanged = true;
            }
        });

        if (Array.isArray(currentTable.content?.[0])) {
            if (!Array.isArray(templateTable.content)) templateTable.content = [];
            if (JSON.stringify(templateTable.content[0]) !== JSON.stringify(currentTable.content[0])) {
                templateTable.content[0] = cloneData_ACU(currentTable.content[0]);
                templateChangedRowsOnly_ACU(templateTable);
                tableChanged = true;
            }
        }

        templateChangedRowsOnly_ACU(templateTable);
        if (tableChanged) changed = true;
    });

    getDataSheetKeys_ACU(templateObj).forEach((key: string) => {
        if (!templateData[key]) {
            delete templateObj[key];
            changed = true;
        }
    });

    ensureSheetOrderNumbers_ACU(templateObj, { baseOrderKeys: orderedKeys, forceRebuild: false });
    return { templateObj, changed };
}

function templateChangedRowsOnly_ACU(templateTable: any): void {
    if (Array.isArray(templateTable?.content) && templateTable.content.length > 1) {
        templateTable.content = [templateTable.content[0]];
    }
}

async function runPostSaveRefresh_ACU(reason: string, targetMessageIndex?: number, sourceTableKey?: string): Promise<void> {
    await refreshMergedDataAndNotifyWithUI_ACU();

    if (sourceTableKey && getCurrentWorldbookConfig_ACU().summaryVectorIndexModeEnabled === true) {
        try {
            const queueResult = await enqueueSummaryVectorIndexFlush_ACU({
                targetMessageIndex,
                sourceTableKey,
                mode: 'sync',
                reason,
            });
            if (!queueResult.queued && !queueResult.skipped) {
                logWarn_ACU('[VisualizerVectorIndex] 交火索引防抖归档入队失败:', queueResult.reason);
                showToastr_ACU('warning', `表格已保存，但交火索引防抖归档入队失败：${queueResult.reason || 'unknown'}`);
            }
        } catch (error) {
            logWarn_ACU('[VisualizerVectorIndex] 交火索引防抖归档入队异常:', error);
            showToastr_ACU('warning', '表格已保存，但交火索引防抖归档入队异常，请查看控制台日志。');
        }
    }

    await updateReadableLorebookEntry_ACU(true);
    (topLevelWindow_ACU as any).AutoCardUpdaterAPI?._notifyTableUpdate?.();
    if (typeof updateCardUpdateStatusDisplay_ACU === 'function') updateCardUpdateStatusDisplay_ACU();
    if ($popupInstance_ACU && $popupInstance_ACU.length) loadTemplatePresetSelect_ACU({ keepGlobalValue: false });
}

export async function saveVisualizerDataChanges_ACU(): Promise<void> {
    const orderedData = prepareOrderedVisualizerData_ACU();
    if (hasTemplateStructureChanges_ACU(orderedData)) {
        showToastr_ACU('error', '存在未保存的模板/结构变更；本次是数据保存，已阻止混合提交。请先保存模板，或刷新后只保存数据。');
        return;
    }

    const result = await applyVisualizerPendingDataOps_ACU(_acuVisState);
    if (!result.success) {
        showToastr_ACU('error', result.error || '可视化编辑器保存失败：批量 SQL 写入运行时失败。');
        return;
    }
    if (!result.changed) {
        showToastr_ACU('info', '没有需要保存的数据增量。');
        return;
    }

    const chat = getChatArray_ACU();
    const isolationKey = getCurrentIsolationKey_ACU();
    const latestAiIndex = getLatestAiMessageIndexFromChat_ACU(chat);
    const appendTargetIndex = getLatestTableAppendMessageIndexFromChat_ACU(chat, isolationKey, settings_ACU);
    const sourceTableKey = (result.changedSheetKeys || []).find((sheetKey: string) => {
        const table = currentJsonTableData_ACU?.[sheetKey];
        return !!table?.name && isSummaryOrOutlineTable_ACU(String(table.name));
    });
    await runPostSaveRefresh_ACU('visualizer_save_data', appendTargetIndex !== -1 ? appendTargetIndex : (latestAiIndex !== -1 ? latestAiIndex : undefined), sourceTableKey);
    replaceVisualizerTemporaryRowIds_ACU(_acuVisState, result.insertedRowIds || {});
    resetVisualizerPendingDataOps_ACU(_acuVisState);
    showToastr_ACU('success', '数据增量已通过 V2 回放保存到当前消息。');
    closeACUWindow(`${SCRIPT_ID_PREFIX_ACU}-visualizer-window`);
}

export async function saveVisualizerTemplateChanges_ACU(scope: 'chat' | 'global'): Promise<void> {
    if (hasVisualizerPendingDataOps_ACU(_acuVisState)) {
        showToastr_ACU('error', '存在未保存的数据增量；本次是模板保存，已阻止混合提交。请先保存数据，或刷新后只保存模板。');
        return;
    }

    const orderedData = prepareOrderedVisualizerData_ACU();
    const orderedKeys = getOrderedSheetKeys_ACU();
    const hasCurrentChat = getChatArray_ACU().length > 0;
    if (scope === 'chat' && !hasCurrentChat) {
        showToastr_ACU('error', '当前没有聊天，不能保存模板到当前聊天。');
        return;
    }

    const shouldValidateRuntimeRecovery = hasCurrentChat && isSqliteMode();
    const compatibility = await validateTemplateCompatibleWithRuntimeData_ACU(orderedData, { includeRuntimeRows: shouldValidateRuntimeRecovery });
    if (!compatibility.success || !compatibility.data) {
        const prefix = shouldValidateRuntimeRecovery ? '模板与当前聊天旧数据不兼容，已阻止保存。' : '模板自身校验失败，已阻止保存。';
        showToastr_ACU('error', `${prefix}\n${compatibility.error || ''}`);
        return;
    }

    const templateData = compatibility.data;
    _acuVisState.tempData = orderedData;

    if (scope === 'chat') {
        const isolationKey = getCurrentIsolationKey_ACU();
        const existingGuide = getChatSheetGuideDataForIsolationKey_ACU(isolationKey);
        const templateObjForSeed = parseTableTemplateJson_ACU({ stripSeedRows: false });
        const guideData = buildChatSheetGuideDataFromData_ACU(templateData, {
            preserveSeedRowsFromGuideData: existingGuide,
            seedRowsFromTemplateObj: templateObjForSeed,
            orderedKeys,
        });
        if (!guideData || !Object.keys(guideData).some(key => key.startsWith('sheet_'))) {
            showToastr_ACU('error', '保存当前聊天模板失败：无法生成模板指导表。');
            return;
        }

        const templateScopeSource = materializeDataFromSheetGuide_ACU(guideData, { includeSeedRows: true });
        const saved = setChatSheetGuideDataForIsolationKey_ACU(isolationKey, guideData, {
            reason: 'visualizer_template_save_chat',
            syncTemplateScope: true,
            templateSource: templateScopeSource,
            presetName: resolveActiveTemplatePresetName_ACU({ fallbackToGlobal: true, isolationKey }),
            source: 'visualizer_template_save_chat',
        });
        if (!saved) {
            showToastr_ACU('error', '保存当前聊天模板失败：无法写入指导表。');
            return;
        }
        await saveChatToHost_ACU();
        if (isSqliteMode()) await reloadStorageProvider();
        await runPostSaveRefresh_ACU('visualizer_save_template_chat');
        showToastr_ACU('success', '模板/结构已保存到当前聊天。');
        closeACUWindow(`${SCRIPT_ID_PREFIX_ACU}-visualizer-window`);
        return;
    }

    const { templateObj, changed } = buildTemplateObjectFromVisualizerData_ACU(templateData, orderedKeys);
    if (!changed) {
        showToastr_ACU('info', '全局模板无变化，无需保存。');
        return;
    }

    const isolationKey = getCurrentIsolationKey_ACU();
    const activePresetName = normalizeTemplatePresetSelectionValue_ACU(
        resolveActiveTemplatePresetName_ACU({ fallbackToGlobal: true, isolationKey }),
    );
    let finalGlobalPresetName = activePresetName;
    if (isDefaultTemplatePresetSelection_ACU(finalGlobalPresetName)) {
        const promptedName = prompt('请输入要保存到全局的模板预设名称：', '新模板预设');
        if (!promptedName) return;
        finalGlobalPresetName = normalizeTemplatePresetSelectionValue_ACU(String(promptedName).trim());
    } else if (!confirm(`确定要用当前编辑结果覆盖全局预设 "${finalGlobalPresetName}" 吗？`)) {
        return;
    }
    if (!finalGlobalPresetName) return;

    const preparedSnapshot = sanitizeTemplateSnapshotForChat_ACU(templateObj);
    if (!preparedSnapshot?.templateStr) {
        showToastr_ACU('error', '保存全局模板失败：无法生成模板快照。');
        return;
    }
    const presetSaved = upsertTemplatePreset_ACU(finalGlobalPresetName, preparedSnapshot.templateStr);
    if (!presetSaved) {
        showToastr_ACU('error', '保存全局模板失败：无法写入全局预设库。');
        return;
    }

    const appliedGlobalTemplate = await applyTemplatePresetToCurrent_ACU(finalGlobalPresetName, {
        source: 'visualizer_save_template_global',
        updateGlobal: true,
        save: true,
        persistChatScope: false,
    });
    if (!appliedGlobalTemplate) {
        showToastr_ACU('error', '保存全局模板失败：模板快照应用失败。');
        return;
    }
    if (isSqliteMode()) await reloadStorageProvider();
    await runPostSaveRefresh_ACU('visualizer_save_template_global');
    showToastr_ACU('success', `模板/结构已保存到全局预设：${finalGlobalPresetName}。`);
    closeACUWindow(`${SCRIPT_ID_PREFIX_ACU}-visualizer-window`);
}

export async function saveVisualizerChanges_ACU(saveToTemplate = false): Promise<void> {
    if (saveToTemplate) {
        await saveVisualizerTemplateChanges_ACU('global');
        return;
    }
    await saveVisualizerDataChanges_ACU();
}

// --- [Inheritance Logic (Legacy Removed)] ---
