/**
 * presentation/bootstrap/api-groups/template-preset-api.ts
 * 模板预设 API — 模板预设的列表/切换/导入
 */

import { deriveTemplatePresetNameForImport_ACU, normalizeTemplatePresetSelectionValue_ACU } from '../../../shared/template-preset-utils';
import { logDebug_ACU, logError_ACU } from '../../../shared/utils';
import {
    applyTemplatePresetToCurrent_ACU,
    applyChatTemplateSnapshotWithReconciliation_ACU,
    listTemplatePresetNames_ACU,
    normalizeTemplateOperationScope_ACU,
    parseImportedTemplateData_ACU,
    resolveTemplateForExport_ACU,
    upsertTemplatePreset_ACU,
} from '../../../service/template/template-preset-service';
import { refreshTemplatePresetSelectInUI_ACU } from '../../components/template-preset-ui';
import { refreshPresetUIAfterSwitch_ACU } from '../../components/pipeline-ui-helpers';
import type { ApiGroupContext } from './callback-api';

export function createTemplatePresetApi(ctx: ApiGroupContext): Record<string, Function> {
    return {
        getTemplatePresetNames: function() {
            try {
                return listTemplatePresetNames_ACU();
            } catch (e) {
                logError_ACU('getTemplatePresetNames failed:', e);
                return [];
            }
        },

        switchTemplatePreset: async function(presetName: any, options: any = {}) {
            try {
                const { scope = 'global', destructiveChangeConfirmed = false } = options || {};
                const normalizedScope = normalizeTemplateOperationScope_ACU(scope);
                const name = normalizeTemplatePresetSelectionValue_ACU(presetName);
                const displayName = name || '默认预设';
                const result = await applyTemplatePresetToCurrent_ACU(name, {
                    source: 'api',
                    updateGlobal: normalizedScope === 'global',
                    save: true,
                    persistChatScope: normalizedScope === 'chat',
                    // S1-3：全局切换影响 inherit_global 聊天时经协调器，可能返回
                    // 破坏性 blockers；调用方确认后带 destructiveChangeConfirmed 重试。
                    destructiveChangeConfirmed: destructiveChangeConfirmed === true,
                });
                const saved = !!result && (!(typeof result === 'object' && 'saved' in result) || result.saved !== false);
                if (saved) {
                    refreshPresetUIAfterSwitch_ACU({
                        templateGlobalSelectName: normalizedScope === 'global' ? name : null,
                        keepTemplateGlobalValue: normalizedScope !== 'global',
                    });
                    const runtimeReady = typeof result === 'object' && 'runtimeReady' in result
                        ? result.runtimeReady !== false
                        : undefined;
                    const postCommitWarning = typeof result === 'object' && 'postCommitWarning' in result && typeof result.postCommitWarning === 'string'
                        ? result.postCommitWarning
                        : undefined;
                    return {
                        success: true,
                        scope: normalizedScope,
                        message: `${normalizedScope === 'global' ? '全局模板预设' : '当前聊天模板预设'}已切换：${displayName}`,
                        ...(runtimeReady === undefined ? {} : { runtimeReady }),
                        ...(postCommitWarning ? { warning: postCommitWarning, postCommitWarning } : {}),
                    };
                }
                const error = typeof result === 'object' && result && 'error' in result && typeof result.error === 'string'
                    ? result.error
                    : '';
                const blockers = typeof result === 'object' && result && 'blockers' in result && Array.isArray((result as any).blockers)
                    ? (result as any).blockers
                    : null;
                return {
                    success: false,
                    scope: normalizedScope,
                    message: error || `${normalizedScope === 'global' ? '全局模板预设' : '当前聊天模板预设'}切换失败：${displayName}`,
                    ...(error ? { error } : {}),
                    ...(blockers && blockers.length > 0 ? { blockers } : {}),
                };
            } catch (e) {
                logError_ACU('switchTemplatePreset failed:', e);
                const error = e?.message || String(e);
                return { success: false, scope: normalizeTemplateOperationScope_ACU(options?.scope || 'global'), message: `模板预设切换失败：${error}`, error };
            }
        },

        injectTemplatePresetToCurrentChat: async function(presetName: any) {
            try {
                return await ctx.getApi().switchTemplatePreset(presetName, { scope: 'chat' });
            } catch (e) {
                logError_ACU('injectTemplatePresetToCurrentChat failed:', e);
                return { success: false, message: `当前聊天模板预设切换失败：${e.message}` };
            }
        },

        importTemplateFromData: async function(templateData: any, options: any = {}) {
            try {
                const { scope = 'global', presetName = '', dataMode, conflictPolicy } = options || {};
                const normalizedScope = normalizeTemplateOperationScope_ACU(scope);
                const normalizedPresetName = deriveTemplatePresetNameForImport_ACU({
                    presetName,
                    fallbackLabel: normalizedScope === 'global'
                        ? `导入模板_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`
                        : '',
                });
                const prepared = parseImportedTemplateData_ACU(templateData, { dataMode, conflictPolicy });

                if (normalizedScope === 'global') {
                    // ═══ 全局导入：仅保存到预设库，不自动切换当前生效模板 ═══
                    if (normalizedPresetName) {
                        const savePresetOk = upsertTemplatePreset_ACU(normalizedPresetName, prepared.templateStr);
                        if (!savePresetOk) {
                            return {
                                success: false,
                                scope: normalizedScope,
                                message: `模板已解析，但保存全局模板预设失败：${normalizedPresetName}`,
                            };
                        }
                    }

                    // 刷新 UI 让新预设立即出现在下拉列表中，但保持当前选中值不变
                    refreshPresetUIAfterSwitch_ACU({ keepTemplateGlobalValue: true });

                    logDebug_ACU(`[API] importTemplateFromData: 模板已保存到全局预设库：${normalizedPresetName}。`);
                    return {
                        success: true,
                        scope: normalizedScope,
                        message: normalizedPresetName
                            ? `模板已保存为全局预设：${normalizedPresetName}。你可以在"全局模板预设"下拉中手动切换到它。`
                            : '模板已解析，但未指定预设名称，未保存到预设库。',
                        presetName: normalizedPresetName || undefined,
                        dataMode: prepared.dataMode,
                        conflictPolicy: prepared.conflictPolicy,
                    // 跨 content/seedRows 完全重复去重审计（content 优先），无去重时为空数组
                    deduplication: prepared.deduplication,
                    };
                }

                // ═══ 聊天导入：应用到当前聊天作用域 ═══
                const applied = await applyChatTemplateSnapshotWithReconciliation_ACU(prepared.templateObj, {
                    source: 'api_import_template_chat',
                    presetName: normalizedPresetName,
                    dataMode: prepared.dataMode,
                    conflictPolicy: prepared.conflictPolicy,
                });
                if (!applied.saved) {
                    const error = applied.error || '无法应用到当前聊天。';
                    return {
                        success: false,
                        scope: normalizedScope,
                        message: `模板导入失败：${error}`,
                        error,
                    };
                }

                logDebug_ACU(`[API] importTemplateFromData: 模板已成功导入到当前聊天。`);
                refreshPresetUIAfterSwitch_ACU({ keepTemplateGlobalValue: true });
                const postCommitWarning = 'postCommitWarning' in applied && typeof applied.postCommitWarning === 'string'
                    ? applied.postCommitWarning
                    : undefined;
                const runtimeReady = 'runtimeReady' in applied ? applied.runtimeReady !== false : true;
                return {
                    success: true,
                    scope: normalizedScope,
                    message: postCommitWarning || `模板已成功导入到当前聊天${normalizedPresetName ? `（预设名：${normalizedPresetName}）` : ''}！`,
                    presetName: normalizedPresetName || undefined,
                    runtimeReady,
                    dataMode: prepared.dataMode,
                    conflictPolicy: prepared.conflictPolicy,
                    // 跨 content/seedRows 完全重复去重审计（content 优先），无去重时为空数组
                    deduplication: prepared.deduplication,
                    ...(postCommitWarning ? { warning: postCommitWarning, postCommitWarning } : {}),
                };

            } catch (e) {
                logError_ACU('importTemplateFromData failed:', e);
                const error = e?.message || String(e);
                return { success: false, scope: normalizeTemplateOperationScope_ACU(options?.scope || 'global'), message: `导入失败: ${error}`, error };
            }
        },

        getTableTemplate: function(options: any = {}) {
            try {
                const scope = normalizeTemplateOperationScope_ACU(options?.scope || 'chat');
                const resolved = resolveTemplateForExport_ACU(scope, options?.presetName);
                if (resolved?.jsonData) return resolved.jsonData;
                if (scope !== 'global') {
                    const fallbackGlobal = resolveTemplateForExport_ACU('global', options?.presetName);
                    if (fallbackGlobal?.jsonData) return fallbackGlobal.jsonData;
                }
                return null;
            } catch (e) {
                logError_ACU('getTableTemplate failed:', e);
                return null;
            }
        },
    };
}
