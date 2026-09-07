/**
 * presentation/bootstrap/api-groups/data-admin-api.ts
 * 数据管理与导入 API — 模板导入导出 + TXT导入链路 + 合并总结
 */

import { logError_ACU } from '../../../shared/utils';
import { getUiSurface_ACU } from '../../../shared/ui-surface-registry';
import { exportCurrentJsonData_ACU, exportTableTemplate_ACU, importTableTemplate_ACU, migrateLegacySummaryVectorIndex_ACU, overrideLatestLayerWithTemplate_ACU, resetAllToDefaults_ACU, resetTableTemplate_ACU } from '../../triggers/data-admin-ui';
import { importCombinedSettings_ACU } from '../../triggers/data-admin-ui';
import { exportCombinedSettings_ACU, handleManualMergeSummary_ACU } from '../../triggers/update-trigger';
import { clearImportLocalStorage_ACU, clearImportedEntries_ACU, deleteImportedEntries_ACU } from '../../triggers/import-process';
import { handleTxtImportAndSplit_ACU, handleInjectSplitEntriesFull_ACU, handleInjectSplitEntriesStandard_ACU, handleInjectSplitEntriesSummary_ACU } from '../../components/import-status-ui';
import { deleteImportedEntriesCore_ACU, importTxtTextAndSplitCore_ACU, injectImportedSelectedCore_ACU } from '../../../service/import/import-executor';
import { commitPreparedV2Recovery_ACU, prepareV2Recovery_ACU } from '../../../service/table/table-v2-recovery-service';
import { scanSeedPollution_ACU } from '../../../service/template/template-seed-pollution-diagnostics';
import { commitSeedMigration_ACU, prepareSeedMigration_ACU, rollbackSeedMigration_ACU } from '../../../service/template/template-seed-pollution-migration';
import type { ApiGroupContext } from './callback-api';

function dataAdminApiError_ACU(error: unknown, fallback: string): { success: false; error: string } {
    return { success: false, error: error instanceof Error ? error.message : fallback };
}

function normalizeImportTxtTextAndSplitOptions_ACU(options: any = {}): { splitSize?: number; clearPrevious?: boolean } {
    const normalized: { splitSize?: number; clearPrevious?: boolean } = {};
    if (!options || typeof options !== 'object') return normalized;

    if (typeof options.splitSize === 'number' && Number.isFinite(options.splitSize)) {
        normalized.splitSize = options.splitSize;
    } else if (typeof options.splitSize === 'string' && options.splitSize.trim().length > 0) {
        const parsed = Number(options.splitSize.trim());
        if (Number.isFinite(parsed)) normalized.splitSize = parsed;
    }

    if (typeof options.clearPrevious === 'boolean') {
        normalized.clearPrevious = options.clearPrevious;
    }

    return normalized;
}

function normalizeInjectImportedSelectedOptions_ACU(options: any = {}): { success: true; options: any } | { success: false; error: string } {
    if (options === undefined || options === null) return { success: true, options: {} };
    if (typeof options !== 'object' || Array.isArray(options)) {
        return { success: false, error: 'injectImportedSelected options 必须是对象。' };
    }

    const normalized: any = {};

    if (typeof options.targetWorldbook === 'string') {
        const targetWorldbook = options.targetWorldbook.trim();
        if (targetWorldbook) normalized.targetWorldbook = targetWorldbook;
    } else if (options.targetWorldbook !== undefined) {
        return { success: false, error: 'targetWorldbook 必须是字符串。' };
    }

    if (options.selectedSheetKeys !== undefined) {
        if (!Array.isArray(options.selectedSheetKeys)) {
            return { success: false, error: 'selectedSheetKeys 必须是字符串数组。' };
        }
        const seen = new Set<string>();
        normalized.selectedSheetKeys = options.selectedSheetKeys
            .filter((key: unknown): key is string => typeof key === 'string')
            .map((key: string) => key.trim())
            .filter((key: string) => {
                if (!key || seen.has(key)) return false;
                seen.add(key);
                return true;
            });
    }

    if (typeof options.maxRetries === 'number' && Number.isFinite(options.maxRetries)) {
        normalized.maxRetries = Math.floor(options.maxRetries);
    } else if (typeof options.maxRetries === 'string' && options.maxRetries.trim().length > 0) {
        const parsed = Number(options.maxRetries.trim());
        if (Number.isFinite(parsed)) normalized.maxRetries = Math.floor(parsed);
    }

    if (options.requestOptions === null || (typeof options.requestOptions === 'object' && !Array.isArray(options.requestOptions))) {
        normalized.requestOptions = options.requestOptions;
    }

    return { success: true, options: normalized };
}

function normalizeClearImportedLorebookEntriesOptions_ACU(options: any = {}): { success: true; targetWorldbook: string } | { success: false; error: string } {
    if (options === undefined || options === null) {
        return { success: false, error: 'clearImportedLorebookEntries options 必须是对象，并提供 targetWorldbook。' };
    }
    if (typeof options !== 'object' || Array.isArray(options)) {
        return { success: false, error: 'clearImportedLorebookEntries options 必须是对象。' };
    }

    if (typeof options.targetWorldbook !== 'string') {
        return { success: false, error: 'targetWorldbook 必须是非空字符串。' };
    }

    const targetWorldbook = options.targetWorldbook.trim();
    if (!targetWorldbook) {
        return { success: false, error: 'targetWorldbook 必须是非空字符串。' };
    }
    return { success: true, targetWorldbook };
}

export function createDataAdminApi(_ctx: ApiGroupContext): Record<string, Function> {
    return {
        // 模板/数据管理
        importTemplate: async function(options: any = {}) { try { return await importTableTemplate_ACU(options); } catch (e) { logError_ACU('importTemplate failed:', e); return false; } },
        exportTemplate: async function(options: any = {}) { try { return await exportTableTemplate_ACU(options); } catch (e) { logError_ACU('exportTemplate failed:', e); return false; } },
        resetTemplate: async function(options: any = {}) { try { return await resetTableTemplate_ACU(options); } catch (e) { logError_ACU('resetTemplate failed:', e); return false; } },
        resetAllDefaults: async function() { try { return await resetAllToDefaults_ACU(); } catch (e) { logError_ACU('resetAllDefaults failed:', e); return false; } },
        exportJsonData: async function() { try { return await exportCurrentJsonData_ACU(); } catch (e) { logError_ACU('exportJsonData failed:', e); return false; } },
        importCombinedSettings: async function() { try { return await importCombinedSettings_ACU(); } catch (e) { logError_ACU('importCombinedSettings failed:', e); return false; } },
        exportCombinedSettings: async function() { try { return await exportCombinedSettings_ACU(); } catch (e) { logError_ACU('exportCombinedSettings failed:', e); return false; } },
        overrideWithTemplate: async function() { try { return await overrideLatestLayerWithTemplate_ACU(); } catch (e) { logError_ACU('overrideWithTemplate failed:', e); return false; } },
        migrateLegacyVectorIndex: async function() { try { return await migrateLegacySummaryVectorIndex_ACU(); } catch (e) { logError_ACU('migrateLegacyVectorIndex failed:', e); return false; } },
        openVisualizer: async function() {
            const surface = getUiSurface_ACU();
            if (!surface) {
                logError_ACU('openVisualizer failed: V2 UI surface is not registered.');
                return false;
            }
            try {
                return await surface.openVisualizer();
            } catch (error) {
                logError_ACU('openVisualizer failed:', error);
                return false;
            }
        },

        // 导入TXT链路
        importTxtAndSplit: async function() { try { return await handleTxtImportAndSplit_ACU(); } catch (e) { logError_ACU('importTxtAndSplit failed:', e); return false; } },
        importTxtTextAndSplit: async function(text: any, options: any = {}) { try { if (typeof text !== 'string') return { success: false, error: '导入文本必须是字符串。' }; return await importTxtTextAndSplitCore_ACU(text, normalizeImportTxtTextAndSplitOptions_ACU(options)); } catch (e) { logError_ACU('importTxtTextAndSplit failed:', e); return dataAdminApiError_ACU(e, 'TXT 文本拆分暂存失败。'); } },
        injectImportedSelected: async function(options: any = {}) { try { const normalized = normalizeInjectImportedSelectedOptions_ACU(options); if (normalized.success === false) return { success: false, error: normalized.error }; return await injectImportedSelectedCore_ACU(normalized.options); } catch (e) { logError_ACU('injectImportedSelected failed:', e); return dataAdminApiError_ACU(e, '外部导入注入失败。'); } },
        injectImportedStandard: async function() { try { return await handleInjectSplitEntriesStandard_ACU(); } catch (e) { logError_ACU('injectImportedStandard failed:', e); return false; } },
        injectImportedSummary: async function() { try { return await handleInjectSplitEntriesSummary_ACU(); } catch (e) { logError_ACU('injectImportedSummary failed:', e); return false; } },
        injectImportedFull: async function() { try { return await handleInjectSplitEntriesFull_ACU(); } catch (e) { logError_ACU('injectImportedFull failed:', e); return false; } },
        deleteImportedEntries: async function() { try { return await deleteImportedEntries_ACU(); } catch (e) { logError_ACU('deleteImportedEntries failed:', e); return false; } },
        clearImportedEntries: async function(clearAll = true) { try { return await clearImportedEntries_ACU(!!clearAll); } catch (e) { logError_ACU('clearImportedEntries failed:', e); return false; } },
        clearImportedLorebookEntries: async function(options: any = {}) { try { const normalized = normalizeClearImportedLorebookEntriesOptions_ACU(options); if (normalized.success === false) return { success: false, error: normalized.error }; const deletedCount = await deleteImportedEntriesCore_ACU(normalized.targetWorldbook); return { success: true, deletedCount, targetWorldbook: normalized.targetWorldbook }; } catch (e) { logError_ACU('clearImportedLorebookEntries failed:', e); return dataAdminApiError_ACU(e, '删除外部导入世界书条目失败。'); } },
        clearImportCache: async function(clearAll = true) { try { return await clearImportLocalStorage_ACU(!!clearAll); } catch (e) { logError_ACU('clearImportCache failed:', e); return false; } },


        scanSeedPollution: async function() { try { return scanSeedPollution_ACU(); } catch (e) { logError_ACU('scanSeedPollution failed:', e); return dataAdminApiError_ACU(e, 'seed 污染只读诊断失败。'); } },

        prepareSeedMigration: async function(options: any = {}) { try { if (options === null || typeof options !== 'object' || Array.isArray(options)) return { success: false, error: 'seed 迁移准备选项必须是对象。' }; return prepareSeedMigration_ACU({ isolationKey: typeof options.isolationKey === 'string' ? options.isolationKey : undefined }); } catch (e) { logError_ACU('prepareSeedMigration failed:', e); return dataAdminApiError_ACU(e, 'seed 迁移准备失败。'); } },
        commitSeedMigration: async function(planId: any, options: any = {}) { try { if (typeof planId !== 'string' || !planId.trim()) return { success: false, error: 'planId 必须是非空字符串。' }; if (options === null || typeof options !== 'object' || Array.isArray(options)) return { success: false, error: 'seed 迁移确认选项必须是对象。' }; return await commitSeedMigration_ACU(planId.trim(), { confirm: options.confirm === true }); } catch (e) { logError_ACU('commitSeedMigration failed:', e); return dataAdminApiError_ACU(e, 'seed 迁移提交失败。'); } },
        rollbackSeedMigration: async function(planId: any) { try { if (typeof planId !== 'string' || !planId.trim()) return { success: false, error: 'planId 必须是非空字符串。' }; return await rollbackSeedMigration_ACU(planId.trim()); } catch (e) { logError_ACU('rollbackSeedMigration failed:', e); return dataAdminApiError_ACU(e, 'seed 迁移回滚失败。'); } },

        prepareV2Recovery: async function() { try { return prepareV2Recovery_ACU(); } catch (e) { logError_ACU('prepareV2Recovery failed:', e); return dataAdminApiError_ACU(e, 'V2 恢复诊断失败。'); } },
        commitV2Recovery: async function(planId: any, options: any = {}) { try { if (typeof planId !== 'string' || !planId.trim()) return { success: false, error: 'planId 必须是非空字符串。' }; if (options === null || typeof options !== 'object' || Array.isArray(options)) return { success: false, error: 'V2 恢复确认选项必须是对象。' }; return await commitPreparedV2Recovery_ACU(planId.trim(), { confirmOrphanDataReplace: options.confirmOrphanDataReplace === true, confirmCompatTolerantFixation: options.confirmCompatTolerantFixation === true }); } catch (e) { logError_ACU('commitV2Recovery failed:', e); return dataAdminApiError_ACU(e, 'V2 恢复提交失败。'); } },

        // 合并总结
        mergeSummaryNow: async function() { try { return await handleManualMergeSummary_ACU(); } catch (e) { logError_ACU('mergeSummaryNow failed:', e); return false; } },
    };
}
