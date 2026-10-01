/**
 * presentation/bootstrap/api-groups/settings-config-api.ts
 * 设置与配置 API — 设置面板 + 更新配置参数 + 手动更新表选择 + API 预设管理
 */

import { logDebug_ACU, logError_ACU } from '../../../shared/utils';
import { getUiSurface_ACU } from '../../../shared/ui-surface-registry';
import { settings_ACU, currentJsonTableData_ACU } from '../../../service/runtime/state-manager';
import { getSortedSheetKeys_ACU } from '../../../service/template/chat-scope';
import { handleManualUpdate_ACU } from '../../triggers/update-process';
import { saveSettingsAndNotify_ACU } from '../../components/settings-ui-helpers';
import { setUpdateNumberFields_ACU, type UpdateNumberSettingKey_ACU } from '../../../service/settings/settings-write-service';
// deleteApiPreset_ACU / loadApiPreset_ACU 不再从公开 API 层直接导入；
// 内部 UI 仍通过 settings-ui-sync 独立使用，不受公开 API 收敛影响。
import type { ApiGroupContext } from './callback-api';
import {
    clonePromptSegments_ACU,
    getDefaultAgentDecisionPromptSegments_ACU,
    getDefaultAgentSkillifyPromptSegments_ACU,
    normalizeEditablePromptSegments_ACU,
    normalizeAgentContextSettings_ACU,
} from '../../../service/agent/agent-prompt-template';
import { buildDefaultAgentWorldbookPromptTemplates_ACU } from '../../../shared/defaults';
import type { AgentWorldbookControl_ACU, AgentWorldbookPromptTemplates_ACU } from '../../../shared/models/agent-worldbook-model';
import {
    getAgentPromptTemplateDefaults_ACU,
    readAgentWorldbookControlFromWorldbooks_ACU,
    setAgentPromptTemplateDefaults_ACU,
    writeAgentWorldbookControlToWorldbook_ACU,
} from '../../../service/agent/agent-worldbook-config-meta';

type AgentContextSettingsForApi_ACU = ReturnType<typeof normalizeAgentContextSettings_ACU>;
type PromptSegmentForApi_ACU = {
    role: string;
    content: string;
    deletable: boolean;
    mainSlot?: string;
    isMain?: boolean;
    isMain2?: boolean;
};

async function readAgentWorldbookControlForSettingsApi_ACU(): Promise<AgentWorldbookControl_ACU> {
    const result = await readAgentWorldbookControlFromWorldbooks_ACU();
    return result.control;
}

function getAgentContextSettingsForApi_ACU(control: Pick<AgentWorldbookControl_ACU, 'contextSettings'> | null | undefined): AgentContextSettingsForApi_ACU {
    return normalizeAgentContextSettings_ACU(control?.contextSettings);
}

function patchAgentContextSettingsForApi_ACU(
    patch: unknown,
    currentControl: Pick<AgentWorldbookControl_ACU, 'contextSettings'> | null | undefined,
): AgentContextSettingsForApi_ACU | null {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return null;
    const current = getAgentContextSettingsForApi_ACU(currentControl) as unknown as Record<string, number>;
    const next: Record<string, number> = { ...current };
    for (const key of Object.keys(current)) {
        if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
        const raw = Number((patch as Record<string, unknown>)[key]);
        if (!Number.isFinite(raw)) return null;
        next[key] = Math.trunc(raw);
    }
    return normalizeAgentContextSettings_ACU(next);
}

function getAgentPromptSegmentsForApi_ACU(value: unknown, fallback: PromptSegmentForApi_ACU[]): PromptSegmentForApi_ACU[] {
    return clonePromptSegments_ACU(normalizeEditablePromptSegments_ACU(value, fallback));
}

function normalizeAgentPromptSegmentsForApi_ACU(value: unknown, fallback: PromptSegmentForApi_ACU[]): PromptSegmentForApi_ACU[] | null {
    if (!Array.isArray(value)) return null;
    return normalizeEditablePromptSegments_ACU(value, fallback);
}

function normalizeAgentPromptTemplatesForApi_ACU(value: unknown): AgentWorldbookPromptTemplates_ACU | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const source = value as Record<string, unknown>;
    if (!Array.isArray(source.agentDecisionPromptSegments) || !Array.isArray(source.agentSkillifyPromptSegments)) return null;
    const defaults = buildDefaultAgentWorldbookPromptTemplates_ACU();
    return {
        agentDecisionPromptSegments: normalizeEditablePromptSegments_ACU(source.agentDecisionPromptSegments, defaults.agentDecisionPromptSegments),
        agentSkillifyPromptSegments: normalizeEditablePromptSegments_ACU(source.agentSkillifyPromptSegments, defaults.agentSkillifyPromptSegments),
    };
}

async function writeAgentWorldbookControlPatchForSettingsApi_ACU(
    patch: Partial<AgentWorldbookControl_ACU>,
    failureContext: string,
): Promise<boolean> {
    const result = await writeAgentWorldbookControlToWorldbook_ACU(patch);
    if (!result.updated) {
        logError_ACU(`${failureContext}: ${result.reason || 'write_agent_worldbook_control_failed'}`);
        return false;
    }
    return true;
}

export function createSettingsConfigApi(_ctx: ApiGroupContext): Record<string, Function> {
    return {
        // 打开 V2 可视化编辑器
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

        // 打开 V2 设置面板
        openSettings: async function() {
            const surface = getUiSurface_ACU();
            if (!surface) {
                logError_ACU('openSettings failed: V2 UI surface is not registered.');
                return false;
            }
            try {
                return await surface.openSettings();
            } catch (error) {
                logError_ACU('openSettings failed:', error);
                return false;
            }
        },

        // 立即手动更新：外部调用默认直接执行，不弹出宿主页面的确认遮罩；传入 { confirm: true } 时保留确认框。
        manualUpdate: async function(options?: { confirm?: boolean }) {
            try {
                return await handleManualUpdate_ACU({ skipConfirm: options?.confirm !== true });
            } catch (e) {
                logError_ACU('manualUpdate failed:', e);
                return false;
            }
        },

        // =========================
        // 更新配置参数读写 API
        // =========================

        getUpdateConfigParams: function() {
            try {
                return {
                    autoUpdateThreshold: settings_ACU.autoUpdateThreshold ?? 3,
                    autoUpdateFrequency: settings_ACU.autoUpdateFrequency ?? 1,
                    updateBatchSize: settings_ACU.updateBatchSize ?? 2,
                    autoUpdateTokenThreshold: settings_ACU.autoUpdateTokenThreshold ?? 0
                };
            } catch (e) {
                logError_ACU('getUpdateConfigParams failed:', e);
                return {
                    autoUpdateThreshold: 3,
                    autoUpdateFrequency: 1,
                    updateBatchSize: 2,
                    autoUpdateTokenThreshold: 0
                };
            }
        },

        setUpdateConfigParams: function(params: any) {
            try {
                if (!params || typeof params !== 'object') {
                    logError_ACU('setUpdateConfigParams: Invalid params');
                    return false;
                }

                // [V1 收敛] 委托 service 事务式批量写入（含归一化与保存失败回滚）
                const patch: Partial<Record<UpdateNumberSettingKey_ACU, number>> = {};
                if (typeof params.autoUpdateThreshold === 'number' && params.autoUpdateThreshold >= 0) {
                    patch.autoUpdateThreshold = Math.floor(params.autoUpdateThreshold);
                }
                if (typeof params.autoUpdateFrequency === 'number' && params.autoUpdateFrequency >= 1) {
                    patch.autoUpdateFrequency = Math.floor(params.autoUpdateFrequency);
                }
                if (typeof params.updateBatchSize === 'number' && params.updateBatchSize >= 1) {
                    patch.updateBatchSize = Math.floor(params.updateBatchSize);
                }
                if (typeof params.autoUpdateTokenThreshold === 'number' && params.autoUpdateTokenThreshold >= 0) {
                    patch.autoUpdateTokenThreshold = Math.floor(params.autoUpdateTokenThreshold);
                }
                const result = setUpdateNumberFields_ACU(patch);
                if (!result.ok) {
                    logError_ACU('setUpdateConfigParams failed:', result.message || '');
                    return false;
                }
                logDebug_ACU('Update config params saved:', params);
                return true;
            } catch (e) {
                logError_ACU('setUpdateConfigParams failed:', e);
                return false;
            }
        },

        // =========================
        // 手动更新表选择读写 API
        // =========================

        getManualSelectedTables: function() {
            try {
                return {
                    selectedTables: Array.isArray(settings_ACU.manualSelectedTables)
                        ? [...settings_ACU.manualSelectedTables]
                        : [],
                    hasManualSelection: !!settings_ACU.hasManualSelection
                };
            } catch (e) {
                logError_ACU('getManualSelectedTables failed:', e);
                return { selectedTables: [], hasManualSelection: false };
            }
        },

        setManualSelectedTables: function(sheetKeys: string[]) {
            try {
                if (!Array.isArray(sheetKeys)) {
                    logError_ACU('setManualSelectedTables: sheetKeys must be an array');
                    return false;
                }

                const availableKeys = getSortedSheetKeys_ACU(currentJsonTableData_ACU);
                const validKeys = sheetKeys.filter(key => availableKeys.includes(key));

                settings_ACU.manualSelectedTables = validKeys;
                settings_ACU.hasManualSelection = true;
                saveSettingsAndNotify_ACU();

                logDebug_ACU('Manual selected tables updated:', validKeys);
                return true;
            } catch (e) {
                logError_ACU('setManualSelectedTables failed:', e);
                return false;
            }
        },

        clearManualSelectedTables: function() {
            try {
                settings_ACU.manualSelectedTables = [];
                settings_ACU.hasManualSelection = false;
                saveSettingsAndNotify_ACU();
                logDebug_ACU('Manual selected tables cleared');
                return true;
            } catch (e) {
                logError_ACU('clearManualSelectedTables failed:', e);
                return false;
            }
        },

        // =========================
        // API 预设管理 API
        // =========================

        getApiPresets: function(): any[] {
            try {
                // 已弃用：公开 API 不再返回预设内容，请使用 callAI 受限代理接口发起 AI 请求。
                logError_ACU('getApiPresets: 已弃用，公开 API 不再暴露预设内容，请使用 callAI');
                return [];
            } catch (e) {
                logError_ACU('getApiPresets failed:', e);
                return [];
            }
        },

        getTableApiPreset: function(): string {
            try {
                // 已弃用：公开 API 不再暴露内部预设选择状态，请使用 callAI 受限代理接口并在 options 中指定 presetName。
                logError_ACU('getTableApiPreset: 已弃用，公开 API 不再暴露内部配置状态');
                return '';
            } catch (e) {
                logError_ACU('getTableApiPreset failed:', e);
                return '';
            }
        },

        setTableApiPreset: function(presetName: string): boolean {
            try {
                // 已弃用：公开 API 不再允许外部切换内部预设选择，请使用 callAI 受限代理接口并在 options 中指定 presetName。
                logError_ACU('setTableApiPreset: 已弃用，公开 API 不再允许外部修改内部配置');
                return false;
            } catch (e) {
                logError_ACU('setTableApiPreset failed:', e);
                return false;
            }
        },

        getPlotApiPreset: function(): string {
            try {
                // 已弃用：公开 API 不再暴露内部预设选择状态，请使用 callAI 受限代理接口并在 options 中指定 presetName。
                logError_ACU('getPlotApiPreset: 已弃用，公开 API 不再暴露内部配置状态');
                return '';
            } catch (e) {
                logError_ACU('getPlotApiPreset failed:', e);
                return '';
            }
        },

        setPlotApiPreset: function(presetName: string): boolean {
            try {
                // 已弃用：公开 API 不再允许外部切换内部预设选择，请使用 callAI 受限代理接口并在 options 中指定 presetName。
                logError_ACU('setPlotApiPreset: 已弃用，公开 API 不再允许外部修改内部配置');
                return false;
            } catch (e) {
                logError_ACU('setPlotApiPreset failed:', e);
                return false;
            }
        },

        saveApiPreset: function(presetData: any): boolean {
            try {
                // 已弃用：公开 API 不再允许外部保存完整 API 预设（含 apiKey/settings/tavernProfile），请通过插件内部 UI 管理预设，通过 callAI 受限代理接口发起请求。
                logError_ACU('saveApiPreset: 已弃用，公开 API 不再允许外部保存 API 预设，请使用内部 UI 管理预设');
                return false;
            } catch (e) {
                logError_ACU('saveApiPreset failed:', e);
                return false;
            }
        },

        loadApiPreset: function(presetName: string): boolean {
            try {
                // 已弃用：公开 API 不再允许外部加载完整 API 预设（含 apiKey/settings/tavernProfile），请通过插件内部 UI 管理预设。
                logError_ACU('loadApiPreset: 已弃用，公开 API 不再允许外部加载 API 预设');
                return false;
            } catch (e) {
                logError_ACU('loadApiPreset failed:', e);
                return false;
            }
        },

        // =========================
        // Agent 世界书提示词与上下文参数 API
        // =========================

        getAgentPromptConfig: async function() {
            try {
                const control = await readAgentWorldbookControlForSettingsApi_ACU();
                return {
                    contextSettings: getAgentContextSettingsForApi_ACU(control),
                    agentDecisionPromptSegments: getAgentPromptSegmentsForApi_ACU(
                        control.agentDecisionPromptSegments,
                        getDefaultAgentDecisionPromptSegments_ACU(),
                    ),
                    agentSkillifyPromptSegments: getAgentPromptSegmentsForApi_ACU(
                        control.agentSkillifyPromptSegments,
                        getDefaultAgentSkillifyPromptSegments_ACU(),
                    ),
                };
            } catch (e) {
                logError_ACU('getAgentPromptConfig failed:', e);
                return {
                    contextSettings: normalizeAgentContextSettings_ACU(undefined),
                    agentDecisionPromptSegments: getDefaultAgentDecisionPromptSegments_ACU(),
                    agentSkillifyPromptSegments: getDefaultAgentSkillifyPromptSegments_ACU(),
                };
            }
        },

        getAgentPromptTemplates: function() {
            try {
                return getAgentPromptTemplateDefaults_ACU();
            } catch (e) {
                logError_ACU('getAgentPromptTemplates failed:', e);
                return buildDefaultAgentWorldbookPromptTemplates_ACU();
            }
        },

        setAgentPromptTemplates: function(templates: unknown) {
            try {
                const normalized = normalizeAgentPromptTemplatesForApi_ACU(templates);
                if (!normalized) {
                    logError_ACU('setAgentPromptTemplates: both prompt segment fields must be arrays');
                    return false;
                }
                const saved = setAgentPromptTemplateDefaults_ACU(normalized);
                if (!saved) {
                    logError_ACU('setAgentPromptTemplates: failed to persist global prompt templates');
                    return false;
                }
                logDebug_ACU('Global Agent prompt templates saved');
                return true;
            } catch (e) {
                logError_ACU('setAgentPromptTemplates failed:', e);
                return false;
            }
        },

        resetAgentPromptTemplates: function() {
            try {
                const saved = setAgentPromptTemplateDefaults_ACU(buildDefaultAgentWorldbookPromptTemplates_ACU());
                if (!saved) {
                    logError_ACU('resetAgentPromptTemplates: failed to persist global prompt templates');
                    return false;
                }
                logDebug_ACU('Global Agent prompt templates reset');
                return true;
            } catch (e) {
                logError_ACU('resetAgentPromptTemplates failed:', e);
                return false;
            }
        },

        getAgentContextSettings: async function() {
            try {
                const control = await readAgentWorldbookControlForSettingsApi_ACU();
                return getAgentContextSettingsForApi_ACU(control);
            } catch (e) {
                logError_ACU('getAgentContextSettings failed:', e);
                return normalizeAgentContextSettings_ACU(undefined);
            }
        },

        setAgentContextSettings: async function(patch: any) {
            try {
                const control = await readAgentWorldbookControlForSettingsApi_ACU();
                const normalized = patchAgentContextSettingsForApi_ACU(patch, control);
                if (!normalized) {
                    logError_ACU('setAgentContextSettings: Invalid context settings patch');
                    return false;
                }
                const saved = await writeAgentWorldbookControlPatchForSettingsApi_ACU({
                    contextSettings: normalized,
                    contextSettingsConfigured: true,
                }, 'setAgentContextSettings');
                if (!saved) return false;
                logDebug_ACU('Agent context settings saved:', normalized);
                return true;
            } catch (e) {
                logError_ACU('setAgentContextSettings failed:', e);
                return false;
            }
        },

        resetAgentContextSettings: async function() {
            try {
                const normalized = normalizeAgentContextSettings_ACU(undefined);
                const saved = await writeAgentWorldbookControlPatchForSettingsApi_ACU({
                    contextSettings: normalized,
                    contextSettingsConfigured: true,
                }, 'resetAgentContextSettings');
                if (!saved) return false;
                logDebug_ACU('Agent context settings reset');
                return true;
            } catch (e) {
                logError_ACU('resetAgentContextSettings failed:', e);
                return false;
            }
        },

        getAgentDecisionPromptSegments: async function() {
            try {
                const control = await readAgentWorldbookControlForSettingsApi_ACU();
                return getAgentPromptSegmentsForApi_ACU(control.agentDecisionPromptSegments, getDefaultAgentDecisionPromptSegments_ACU());
            } catch (e) {
                logError_ACU('getAgentDecisionPromptSegments failed:', e);
                return getDefaultAgentDecisionPromptSegments_ACU();
            }
        },

        setAgentDecisionPromptSegments: async function(segments: any) {
            try {
                const normalized = normalizeAgentPromptSegmentsForApi_ACU(segments, getDefaultAgentDecisionPromptSegments_ACU());
                if (!normalized) {
                    logError_ACU('setAgentDecisionPromptSegments: segments must be an array');
                    return false;
                }
                const saved = await writeAgentWorldbookControlPatchForSettingsApi_ACU({
                    agentDecisionPromptSegments: normalized,
                }, 'setAgentDecisionPromptSegments');
                if (!saved) return false;
                logDebug_ACU('Agent decision prompt segments saved');
                return true;
            } catch (e) {
                logError_ACU('setAgentDecisionPromptSegments failed:', e);
                return false;
            }
        },

        resetAgentDecisionPromptSegments: async function() {
            try {
                const segments = getDefaultAgentDecisionPromptSegments_ACU();
                const saved = await writeAgentWorldbookControlPatchForSettingsApi_ACU({
                    agentDecisionPromptSegments: segments,
                }, 'resetAgentDecisionPromptSegments');
                if (!saved) return false;
                logDebug_ACU('Agent decision prompt segments reset');
                return true;
            } catch (e) {
                logError_ACU('resetAgentDecisionPromptSegments failed:', e);
                return false;
            }
        },

        getAgentSkillifyPromptSegments: async function() {
            try {
                const control = await readAgentWorldbookControlForSettingsApi_ACU();
                return getAgentPromptSegmentsForApi_ACU(control.agentSkillifyPromptSegments, getDefaultAgentSkillifyPromptSegments_ACU());
            } catch (e) {
                logError_ACU('getAgentSkillifyPromptSegments failed:', e);
                return getDefaultAgentSkillifyPromptSegments_ACU();
            }
        },

        setAgentSkillifyPromptSegments: async function(segments: any) {
            try {
                const normalized = normalizeAgentPromptSegmentsForApi_ACU(segments, getDefaultAgentSkillifyPromptSegments_ACU());
                if (!normalized) {
                    logError_ACU('setAgentSkillifyPromptSegments: segments must be an array');
                    return false;
                }
                const saved = await writeAgentWorldbookControlPatchForSettingsApi_ACU({
                    agentSkillifyPromptSegments: normalized,
                }, 'setAgentSkillifyPromptSegments');
                if (!saved) return false;
                logDebug_ACU('Agent skillify prompt segments saved');
                return true;
            } catch (e) {
                logError_ACU('setAgentSkillifyPromptSegments failed:', e);
                return false;
            }
        },

        resetAgentSkillifyPromptSegments: async function() {
            try {
                const segments = getDefaultAgentSkillifyPromptSegments_ACU();
                const saved = await writeAgentWorldbookControlPatchForSettingsApi_ACU({
                    agentSkillifyPromptSegments: segments,
                }, 'resetAgentSkillifyPromptSegments');
                if (!saved) return false;
                logDebug_ACU('Agent skillify prompt segments reset');
                return true;
            } catch (e) {
                logError_ACU('resetAgentSkillifyPromptSegments failed:', e);
                return false;
            }
        },

        deleteApiPreset: function(presetName: string): boolean {
            try {
                // 已弃用：公开 API 不再允许外部删除 API 预设，请通过插件内部 UI 管理预设。
                logError_ACU('deleteApiPreset: 已弃用，公开 API 不再允许外部删除 API 预设');
                return false;
            } catch (e) {
                logError_ACU('deleteApiPreset failed:', e);
                return false;
            }
        },
    };
}
