/**
 * presentation/bootstrap/api-groups/plot-preset-api.ts
 * 剧情推进预设管理 API + 游戏初始化 API
 */

import { deriveTemplatePresetNameForImport_ACU } from '../../../shared/template-preset-utils';
import { logDebug_ACU, logError_ACU, logWarn_ACU } from '../../../shared/utils';
import { settings_ACU } from '../../../service/runtime/state-manager';
import { getCurrentRuntimePlotPresetName_ACU, normalizePlotPresetExcludeRules_ACU, switchCurrentChatPlotPreset_ACU } from '../../../service/plot/plot-logic';
import { resetCurrentChatTableStateFromTemplate_ACU } from '../../../service/table/template-state-reset';
import { applyChatTemplateSnapshotWithReconciliation_ACU, upsertTemplatePreset_ACU } from '../../../service/template/template-preset-service';
import { sanitizeTemplateSnapshotForChat_ACU } from '../../../service/template/chat-scope';
import { isSqliteMode } from '../../../service/table/storage-mode';
import { didSqliteFallbackAfterReload_ACU, reloadStorageProvider } from '../../../service/table/table-storage-strategy';
import { setCurrentChatFillMode_ACU } from '../../../service/fill-mode/fill-mode-chat-switch';
import { notifyChatConfigurationChanged_ACU } from '../../../shared/chat-configuration-change';
import { saveSettingsAndNotify_ACU } from '../../components/settings-ui-helpers';
import { refreshPresetUIAfterSwitch_ACU } from '../../components/pipeline-ui-helpers';
import type { ApiGroupContext } from './callback-api';

export function createPlotPresetApi(ctx: ApiGroupContext): Record<string, Function> {
    async function switchImportedPresetMode() {
        try {
            const fillModeSwitch = await setCurrentChatFillMode_ACU('llm');
            const warning = 'reason' in fillModeSwitch
                ? `预设已导入，但当前会话未切换到 LLM 召回模式（${fillModeSwitch.reason}）。请在填表模式页处理确认或重试。`
                : '';
            return { fillModeSwitch, warning };
        } catch (error: any) {
            return {
                fillModeSwitch: { ok: false, reason: 'switch_exception', error: String(error?.message || error) },
                warning: '预设已保存，但当前会话模式切换异常，请在填表模式页核对并重试。',
            };
        }
    }

    function refreshImportedPresets(): string {
        notifyChatConfigurationChanged_ACU('plot-presets');
        try {
            refreshPresetUIAfterSwitch_ACU();
            return '';
        } catch (error) {
            logWarn_ACU('[API] 已保存预设的界面刷新失败:', error);
            return '预设已保存，但界面刷新失败，请重新打开配置页。';
        }
    }

    async function importPreset(presetData: any, options: any = {}, deferPostImport = false) {
        try {
           const { overwrite = false, switchTo = false } = options;
            const preset = typeof presetData === 'string' ? JSON.parse(presetData)
                : typeof presetData === 'object' && presetData !== null ? JSON.parse(JSON.stringify(presetData)) : null;
            if (!preset || typeof preset.name !== 'string' || !preset.name.trim()) {
                return { success: false, message: '预设数据无效：必须是包含非空 name 的 JSON 对象。' };
            }
            const previousPresets = settings_ACU.plotSettings.promptPresets || [];
            const presets = [...previousPresets];
            let finalName = preset.name.trim();
            const existingIndex = presets.findIndex((item: any) => item.name === finalName);
            const normalizedPreset = normalizePlotPresetExcludeRules_ACU(preset);
            if (existingIndex !== -1 && !overwrite) {
                let counter = 1;
                while (presets.some((item: any) => item.name === finalName)) finalName = `${preset.name.trim()} (${counter++})`;
            }
            normalizedPreset.name = finalName;
            if (existingIndex !== -1 && overwrite) presets[existingIndex] = normalizedPreset;
            else presets.push(normalizedPreset);
            settings_ACU.plotSettings.promptPresets = presets;
            try {
                const saved = saveSettingsAndNotify_ACU();
                if (!saved?.saved || saved.storageType === 'memory') {
                    settings_ACU.plotSettings.promptPresets = previousPresets;
                    return { success: false, message: saved?.error || saved?.warning || '预设未能持久化保存，请稍后重试。' };
                }
            } catch (error) {
                settings_ACU.plotSettings.promptPresets = previousPresets;
                throw error;
            }
            // 保存已经成功；后续独立操作只能产生警告，不能把已导入预设误报为丢失。
            const postImport = deferPostImport ? { fillModeSwitch: undefined, warning: '' } : await switchImportedPresetMode();
            const warnings = [postImport.warning];
            let switchedCurrentChat = false;
            if (!deferPostImport && switchTo) {
                try {
                    switchedCurrentChat = ctx.getApi().injectPlotPresetToCurrentChat(finalName) === true;
                    if (!switchedCurrentChat) warnings.push('预设已保存，但未能绑定到当前会话，请手动选择该预设。');
                } catch (error) {
                    logWarn_ACU('[API] 已导入预设的会话绑定异常:', error);
                    warnings.push('预设已保存，但当前会话预设绑定异常，请手动选择该预设。');
                }
            }
            if (!deferPostImport) warnings.push(refreshImportedPresets());
            return {
                success: true,
                message: switchedCurrentChat
                    ? `预设 "${finalName}" 已成功导入到全局预设库，并已切换当前聊天使用该预设。`
                    : `预设 "${finalName}" 已成功导入到全局预设库！`,
                presetName: finalName, switchedCurrentChat,
                fillModeSwitch: postImport.fillModeSwitch,
                warning: warnings.filter(Boolean).join('；'),
            };
        } catch (error: any) {
            logError_ACU('importPlotPresetFromData failed:', error);
            return { success: false, message: `导入失败: ${error?.message || error}` };
        }
    }

    return {
        getPlotPresets: function() {
            try {
                const presets = settings_ACU.plotSettings?.promptPresets || [];
                return presets.map((p: any) => normalizePlotPresetExcludeRules_ACU(p));
            } catch (e) {
                logError_ACU('getPlotPresets failed:', e);
                return [];
            }
        },

        getCurrentPlotPreset: function() {
            try {
                return getCurrentRuntimePlotPresetName_ACU({ fallbackToGlobal: true });
            } catch (e) {
                logError_ACU('getCurrentPlotPreset failed:', e);
                return '';
            }
        },

        switchPlotPreset: function(presetName: any) {
            try {
                if (presetName === undefined || presetName === null) {
                    logError_ACU('switchPlotPreset: Invalid preset name provided.');
                    return false;
                }

                const result = switchCurrentChatPlotPreset_ACU(presetName, {
                    source: 'api',
                    save: true,
                });

                if (!result) {
                    logError_ACU(`switchPlotPreset: Preset "${presetName}" not found.`);
                    return false;
                }

                logDebug_ACU(`Successfully switched current chat to plot preset: "${result.followsGlobal ? '跟随全局' : result.presetName}"`);
                refreshPresetUIAfterSwitch_ACU();
                return true;
            } catch (e) {
                logError_ACU('switchPlotPreset failed:', e);
                return false;
            }
        },

        injectPlotPresetToCurrentChat: function(presetName: any) {
            try {
                if (presetName === undefined || presetName === null) {
                    logError_ACU('injectPlotPresetToCurrentChat: Invalid preset name provided.');
                    return false;
                }

                const result = switchCurrentChatPlotPreset_ACU(presetName, {
                    source: 'api',
                    save: true,
                });

                if (!result) {
                    logError_ACU(`injectPlotPresetToCurrentChat: Preset "${presetName}" not found.`);
                    return false;
                }

                logDebug_ACU(`Injected global plot preset into current chat: "${result.followsGlobal ? '跟随全局' : result.presetName}"`);
                refreshPresetUIAfterSwitch_ACU();
                return true;
            } catch (e) {
                logError_ACU('injectPlotPresetToCurrentChat failed:', e);
                return false;
            }
        },

        getPlotPresetDetails: function(presetName: any) {
            try {
                if (!presetName || typeof presetName !== 'string') {
                    return null;
                }
                const presets = settings_ACU.plotSettings?.promptPresets || [];
                const preset = presets.find((p: any) => p.name === presetName);
                return preset ? normalizePlotPresetExcludeRules_ACU(preset) : null;
            } catch (e) {
                logError_ACU('getPlotPresetDetails failed:', e);
                return null;
            }
        },

        getPlotPresetNames: function() {
            try {
                const presets = settings_ACU.plotSettings?.promptPresets || [];
                return presets.map((p: any) => p.name);
            } catch (e) {
                logError_ACU('getPlotPresetNames failed:', e);
                return [];
            }
        },

        importPlotPresetFromData: (presetData: any, options: any = {}) => importPreset(presetData, options),

        importPlotPresetsFromData: async function(presetsArray: any[], options: any = {}) {
            try {
                if (!Array.isArray(presetsArray)) {
                    return { success: false, message: '输入必须是数组', imported: 0, failed: 0, details: [] as Record<string, any>[] };
                }

                const details = [];
                let imported = 0;
                let failed = 0;

                for (const presetData of presetsArray) {
                    const result = await importPreset(presetData, { ...options, switchTo: false }, true);
                    details.push(result);
                    if (result.success) {
                        imported++;
                    } else {
                        failed++;
                    }
                }

                // 成功条目已经独立保存；批量结束只尝试一次会话模式切换与刷新。
                const postImport = imported > 0 ? await switchImportedPresetMode() : { fillModeSwitch: undefined, warning: '' };
                const refreshWarning = imported > 0 ? refreshImportedPresets() : '';

                return {
                    success: failed === 0,
                    message: `批量导入完成：成功 ${imported} 个，失败 ${failed} 个`,
                    imported,
                    failed,
                    details,
                    fillModeSwitch: postImport.fillModeSwitch,
                    warning: [postImport.warning, refreshWarning].filter(Boolean).join('；'),
                };

            } catch (e) {
                logError_ACU('importPlotPresetsFromData failed:', e);
                return { success: false, message: `批量导入失败: ${e.message}`, imported: 0, failed: 0, details: [] as Record<string, any>[] };
            }
        },

        exportAllPlotPresets: function() {
            try {
                const presets = settings_ACU.plotSettings?.promptPresets || [];
                return presets.map((p: any) => normalizePlotPresetExcludeRules_ACU(p));
            } catch (e) {
                logError_ACU('exportAllPlotPresets failed:', e);
                return [];
            }
        },

        // =========================
        // 游戏初始化 API
        // =========================

        initGameSession: async function(characterData: any, options: any = {}) {
            const result: any = {
                success: false,
                templateInjected: false,
                presetLoaded: false,
                protagonistInitialized: false,
                equipmentInitialized: false,
                runtimeReady: true,
                warning: '',
                message: ''
            };

            try {
                // 步骤1: 注入数据库模板到首楼
                if (options.injectTemplate !== false) {
                    logDebug_ACU('[游戏初始化] 开始注入数据库模板...');
                    try {
                        let templateData;

                        if (options.templateData) {
                            logDebug_ACU('[游戏初始化] 使用传入的模板数据');
                            templateData = options.templateData;
                        } else {
                            logDebug_ACU('[游戏初始化] 从服务器加载模板数据');
                            const templateResponse = await fetch('/TavernDB_template_默认模板.json');
                            if (!templateResponse.ok) {
                                throw new Error(`HTTP ${templateResponse.status}: ${templateResponse.statusText}`);
                            }
                            templateData = await templateResponse.json();
                        }

                        const templateObj = typeof templateData === 'string' ? JSON.parse(templateData) : templateData;
                        const templatePresetName = deriveTemplatePresetNameForImport_ACU({
                            presetName: options.templatePresetName || characterData?.name || characterData?.data?.name || '',
                        });
                        const resetExistingTableData = options.resetExistingTableData !== false;
                        const templateResult = resetExistingTableData
                            ? await resetCurrentChatTableStateFromTemplate_ACU(templateObj, {
                                reason: 'game_init',
                                presetName: templatePresetName,
                                source: 'game_init',
                                resetExistingTableData: true,
                            })
                            : await applyChatTemplateSnapshotWithReconciliation_ACU(templateObj, {
                                source: 'game_init',
                                presetName: templatePresetName,
                                destructiveChangeConfirmed: false,
                            });
                        if (!templateResult?.saved) throw new Error(templateResult?.error || '模板原子提交失败');
                        result.templateInjected = true;
                        const committedTemplateData = (
                            'normalizedTemplateData' in templateResult && templateResult.normalizedTemplateData
                        ) || templateObj;
                        // 预设库不是聊天状态的一部分，不能先于严格聊天保存；失败只报告警告，不能回滚已提交 checkpoint。
                        if (templatePresetName) {
                            try {
                                const snapshot = sanitizeTemplateSnapshotForChat_ACU(committedTemplateData);
                                if (!snapshot?.templateStr || !upsertTemplatePreset_ACU(templatePresetName, snapshot.templateStr)) {
                                    throw new Error('模板预设存储拒绝写入。');
                                }
                            } catch (error: any) {
                                result.warning = `模板已保存，但模板预设注册失败：${error?.message || String(error)}`;
                                logWarn_ACU('[游戏初始化] 模板预设注册失败:', error);
                            }
                        }
                        const runtimeStatus = templateResult as { runtimeReady?: boolean; postCommitWarning?: string };
                        if (runtimeStatus.runtimeReady === false) {
                            result.runtimeReady = false;
                            result.warning = runtimeStatus.postCommitWarning || '模板已保存，但运行时尚未就绪。';
                        }
                        const messageIndex = (templateResult as { messageIndex?: number }).messageIndex;
                        if (isSqliteMode() && resetExistingTableData) {
                            try {
                                await reloadStorageProvider();
                                if (didSqliteFallbackAfterReload_ACU('sqlite')) {
                                    throw new Error('SQLite 运行时重载后已回退到原生模式。');
                                }
                            } catch (error: any) {
                                result.runtimeReady = false;
                                result.warning = `模板已保存，但 SQLite 运行时重建失败：${error?.message || String(error)}`;
                                logWarn_ACU('[游戏初始化] SQLite 运行时重建失败:', error);
                            }
                        }
                        // 模板已由严格保存路径写入聊天。这里若同步触发 MESSAGE_UPDATED 或表格
                        // 回调，会销毁正在 await initGameSession() 的第三方 iframe，使其后续
                        // insertRow 永远没有机会执行。初始化 API 只保证持久化和 runtime 就绪；
                        // 宿主重渲染仍由正常消息生命周期或调用方后续写入的既有通知路径处理。
                        logDebug_ACU('[游戏初始化] 数据库模板已原子提交');
                    } catch (templateError) {
                        logError_ACU('[游戏初始化] 模板注入失败:', templateError);
                        throw new Error(`数据库模板注入失败: ${templateError.message}`);
                    }
                }

                // 步骤2: 加载剧情引导预设
                if (options.loadPreset !== false) {
                    logDebug_ACU('[游戏初始化] 开始加载剧情引导预设...');
                    const presetName = options.presetName || '西幻剧情引导';
                    try {
                        let presetData;

                        if (options.presetData) {
                            logDebug_ACU('[游戏初始化] 使用传入的预设数据');
                            presetData = options.presetData;
                        } else {
                            logDebug_ACU('[游戏初始化] 从服务器加载预设数据');
                            const presetResponse = await fetch('/西幻剧情引导.json');
                            if (!presetResponse.ok) {
                                throw new Error(`HTTP ${presetResponse.status}: ${presetResponse.statusText}`);
                            }
                            presetData = await presetResponse.json();
                        }

                        const importResult = await ctx.getApi().importPlotPresetFromData(presetData, {
                            overwrite: true,
                            switchTo: true
                        });
                        if (!importResult.success) {
                            throw new Error(importResult.message || '预设导入失败');
                        }
                        result.presetLoaded = true;
                        result.fillModeSwitch = importResult.fillModeSwitch;
                        result.warning = [result.warning, importResult.warning].filter(Boolean).join('；');
                        logDebug_ACU('[游戏初始化] 剧情引导预设加载成功');
                    } catch (presetError) {
                        logError_ACU('[游戏初始化] 预设加载失败:', presetError);
                        logWarn_ACU('[游戏初始化] 剧情引导预设加载失败，但继续游戏初始化');
                    }
                }

                // 步骤3: 保存设置。不得在异步初始化链中刷新消息/iframe，见上方模板提交说明。
                try {
                    saveSettingsAndNotify_ACU();
                } catch (saveError) {
                    logWarn_ACU('[游戏初始化] 保存设置时出错:', saveError);
                }

                result.success = true;
                result.message = '游戏初始化成功';
                logDebug_ACU('[游戏初始化] 游戏初始化流程完成');

            } catch (error) {
                result.message = `初始化失败: ${error.message}`;
                logError_ACU('initGameSession failed:', error);
            }

            return result;
        },
    };
}
