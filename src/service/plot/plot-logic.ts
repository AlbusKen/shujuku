/**
 * service/plot/plot-logic.ts — 剧情推进纯逻辑函数
 *
 * 从 presentation/components/optimization-ui.ts 真正搬入的纯数据/逻辑函数。
 * 不操作 DOM，不引用 $popupInstance_ACU / jQuery_API_ACU 等 UI 对象。
 */

import { DEFAULT_PLOT_SETTINGS_ACU } from '../../shared/defaults-json.js';
import { activePlotEditorSettings_ACU, buildDefaultPlotPromptGroup_ACU, currentEditablePlotPresetState_ACU, ensurePlotPromptGroup_ACU, _set_currentEditablePlotPresetState_ACU, _set_activePlotEditorSettings_ACU, _set_currentPlotTaskEditorId_ACU } from './plot-state';
import { currentChatFileIdentifier_ACU, settings_ACU } from '../runtime/state-manager';
import { getChatArray_ACU, saveChatToHost_ACU } from '../../data/gateways/chat-gateway';
import { saveSettings_ACU } from '../settings/settings-service';
import { clearCurrentChatPlotScopeState_ACU, getCurrentChatPlotScopeState_ACU, sanitizePlotSettingsSnapshotForChat_ACU } from '../template/chat-scope';
import { cleanChatName_ACU, logDebug_ACU, logWarn_ACU, normalizeExcludeRules_ACU, normalizeExtractRules_ACU, normalizeNonNegativeInteger_ACU, normalizePositiveInteger_ACU } from '../../shared/utils';
import { getLastOptimizationBase_ACU, setLastOptimizationBase_ACU } from '../optimization/content-optimization';
import { stripLegacyLoopPromptFields_ACU, stripLegacyLoopPromptFieldsInPlace_ACU } from '../../shared/legacy-loop-fields';

// ═══ 循环提示词/提示词组兼容 ═══

export function ensureLoopPromptsArray_ACU(plotSettings: Record<string, any>) {
    stripLegacyLoopPromptFieldsInPlace_ACU(plotSettings);
}

export function ensureTagRulesCompat_ACU(targetSettings: Record<string, any>) {
    if (!targetSettings || typeof targetSettings !== 'object') return;

    targetSettings.tableContextExtractRules = normalizeExtractRules_ACU(
      targetSettings.tableContextExtractRules,
      targetSettings.tableContextExtractTags || '',
    );
    targetSettings.tableContextExcludeRules = normalizeExcludeRules_ACU(
      targetSettings.tableContextExcludeRules,
      targetSettings.tableContextExcludeTags || '',
    );

    const plot = targetSettings.plotSettings;
    if (!plot || typeof plot !== 'object') return;

    plot.contextExtractRules = normalizeExtractRules_ACU(
      plot.contextExtractRules,
      plot.contextExtractTags || '',
    );
    plot.contextExcludeRules = normalizeExcludeRules_ACU(
      plot.contextExcludeRules,
      plot.contextExcludeTags || '',
    );

    if ((!Array.isArray(plot.contextExtractRules) || plot.contextExtractRules.length === 0)
      && (plot.contextExtractTags || '').trim() === '') {
      plot.contextExtractRules = normalizeExtractRules_ACU(
        DEFAULT_PLOT_SETTINGS_ACU.contextExtractRules,
        DEFAULT_PLOT_SETTINGS_ACU.contextExtractTags || '',
      );
    }
    if ((!Array.isArray(plot.contextExcludeRules) || plot.contextExcludeRules.length === 0)
      && (plot.contextExcludeTags || '').trim() === '') {
      plot.contextExcludeRules = normalizeExcludeRules_ACU(
        DEFAULT_PLOT_SETTINGS_ACU.contextExcludeRules,
        DEFAULT_PLOT_SETTINGS_ACU.contextExcludeTags || '',
      );
    }

    ensurePlotTasksCompat_ACU(plot);

    if (Array.isArray(plot.promptPresets)) {
      plot.promptPresets = plot.promptPresets.map((preset: Record<string, any>) => normalizePlotPresetExcludeRules_ACU(preset));
    }
}

// ═══ Prompt 辅助 ═══

export function getLegacyPromptFromThree_ACU(prompts: any, id: string) {
    if (!prompts) return '';
    if (Array.isArray(prompts)) return (prompts.find(item => item && item.id === id)?.content) || '';
    if (typeof prompts === 'object') return prompts[id] || '';
    return '';
}

function looksLikePromptGroupSegments_ACU(arr: any) {
    if (!Array.isArray(arr) || arr.length === 0) return false;
    const first = arr[0];
    return first && typeof first === 'object' && 'role' in first && 'content' in first && !('id' in first);
}

function getMainSlotFromPlotSegment_ACU(segment: Record<string, any>) {
    if (!segment) return '';
    const slot = String(segment.mainSlot || '').toUpperCase();
    if (slot === 'A' || slot === 'B') return slot;
    if (segment.isMain) return 'A';
    if (segment.isMain2) return 'B';
    return '';
}

export function getLegacyPromptTextsFromPromptGroup_ACU(promptGroup: any) {
    const segments = Array.isArray(promptGroup) ? promptGroup : [];
    return {
      mainPrompt: (segments.find((segment: Record<string, any>) => getMainSlotFromPlotSegment_ACU(segment) === 'A')?.content) || '',
      systemPrompt: (segments.find((segment: Record<string, any>) => getMainSlotFromPlotSegment_ACU(segment) === 'B')?.content) || '',
    };
}

export function getPlotPromptGroupFromSource_ACU(source: Record<string, any> | null, { fallbackPromptGroup = null }: { fallbackPromptGroup?: any } = {}) {
    if (Array.isArray(source?.promptGroup) && source.promptGroup.length > 0) {
      return JSON.parse(JSON.stringify(source.promptGroup));
    }
    if (looksLikePromptGroupSegments_ACU(source?.prompts)) {
      return JSON.parse(JSON.stringify(source.prompts));
    }
    const fallbackTexts = getLegacyPromptTextsFromPromptGroup_ACU(fallbackPromptGroup);
    const legacyMain = source?.mainPrompt || getLegacyPromptFromThree_ACU(source?.prompts, 'mainPrompt') || fallbackTexts.mainPrompt || '';
    const legacySystem = source?.systemPrompt || getLegacyPromptFromThree_ACU(source?.prompts, 'systemPrompt') || fallbackTexts.systemPrompt || '';
    return buildDefaultPlotPromptGroup_ACU({ mainAContent: legacyMain, mainBContent: legacySystem });
}

export function getPlotFinalDirectiveFromSource_ACU(source: Record<string, any> | null) {
    if (!source || typeof source !== 'object') return '';
    return source.finalSystemDirective
      || source.finalDirective
      || getPlotPromptContentByIdFromSettings_ACU(source, 'finalSystemDirective')
      || getLegacyPromptFromThree_ACU(source.prompts, 'finalSystemDirective')
      || '';
}

// ═══ 任务规范化 ═══

function hasOwnField_ACU(source: Record<string, any>, key: string) {
    return !!source && Object.prototype.hasOwnProperty.call(source, key);
}

function normalizeOptionalString_ACU(value: any, fallbackValue: any = '') {
    if (typeof value === 'string') return value;
    if (typeof fallbackValue === 'string') return fallbackValue;
    return '';
}

function normalizeStringArrayField_ACU(value: any, fallbackValue: any = []) {
    const raw = Array.isArray(value) ? value : (Array.isArray(fallbackValue) ? fallbackValue : []);
    return raw
      .map((item: any) => String(item ?? '').trim())
      .filter((item: string, index: number, array: string[]) => item && array.indexOf(item) === index);
}

function normalizeOptionalPositiveIntegerField_ACU(value: any, fallbackValue: any = undefined) {
    const raw = value ?? fallbackValue;
    if (raw === undefined || raw === null || raw === '') return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n)) return undefined;
    const normalized = Math.trunc(n);
    return normalized > 0 ? normalized : undefined;
}

function normalizeOptionalNonNegativeIntegerField_ACU(value: any, fallbackValue: any = undefined) {
    const raw = value ?? fallbackValue;
    if (raw === undefined || raw === null || raw === '') return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n)) return undefined;
    const normalized = Math.trunc(n);
    return normalized >= 0 ? normalized : undefined;
}

function normalizeBooleanField_ACU(source: Record<string, any>, fallback: Record<string, any>, key: string, defaultValue: boolean) {
    if (hasOwnField_ACU(source, key)) return source[key] === true;
    if (hasOwnField_ACU(fallback, key)) return fallback[key] === true;
    return defaultValue;
}

function normalizePlotTaskAgentControl_ACU(value: any, fallbackValue: any = null) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const fallback = fallbackValue && typeof fallbackValue === 'object' && !Array.isArray(fallbackValue) ? fallbackValue : {};
    const preferredStage = normalizeOptionalPositiveIntegerField_ACU(source.preferredStage, fallback.preferredStage);
    const preferredOrder = normalizeOptionalNonNegativeIntegerField_ACU(source.preferredOrder, fallback.preferredOrder);
    const normalized: Record<string, any> = {
      enabled: normalizeBooleanField_ACU(source, fallback, 'enabled', false),
      selectable: normalizeBooleanField_ACU(source, fallback, 'selectable', true),
      defaultSelected: normalizeBooleanField_ACU(source, fallback, 'defaultSelected', false),
      allowSequential: normalizeBooleanField_ACU(source, fallback, 'allowSequential', true),
      allowParallel: normalizeBooleanField_ACU(source, fallback, 'allowParallel', true),
      dependsOnTaskIds: normalizeStringArrayField_ACU(source.dependsOnTaskIds, fallback.dependsOnTaskIds),
      blocksTaskIds: normalizeStringArrayField_ACU(source.blocksTaskIds, fallback.blocksTaskIds),
    };
    if (preferredStage !== undefined) normalized.preferredStage = preferredStage;
    if (preferredOrder !== undefined) normalized.preferredOrder = preferredOrder;
    return normalized;
}

export function normalizePlotTask_ACU(task: Record<string, any> | null, { index = 0, fallbackTask = null }: { index?: number; fallbackTask?: Record<string, any> | null } = {}) {
    const cloned = task && typeof task === 'object' ? JSON.parse(JSON.stringify(task)) : {};
    const fallback = fallbackTask && typeof fallbackTask === 'object' ? fallbackTask : null;
    const defaultId = `plotTask${index + 1}`;
    const rawId = String(cloned.id || cloned.name || fallback?.id || defaultId).trim();
    const taskId = rawId.replace(/[^\w-]+/g, '_') || defaultId;
    const taskName = String(cloned.name || fallback?.name || `剧情任务${index + 1}`).trim() || `剧情任务${index + 1}`;
    const promptGroup = getPlotPromptGroupFromSource_ACU(cloned, { fallbackPromptGroup: fallback?.promptGroup || null });

    return {
      id: taskId,
      name: taskName,
      enabled: cloned.enabled !== false,
      promptGroup,
      extractTags: typeof cloned.extractTags === 'string' ? cloned.extractTags : (fallback?.extractTags || ''),
      extractInjectTags: typeof cloned.extractInjectTags === 'string' ? cloned.extractInjectTags : (fallback?.extractInjectTags || ''),
      finalDirectiveTemplate: typeof cloned.finalDirectiveTemplate === 'string' ? cloned.finalDirectiveTemplate : (fallback?.finalDirectiveTemplate || ''),
      minLength: normalizeNonNegativeInteger_ACU(cloned.minLength, fallback?.minLength ?? 0),
      maxRetries: normalizePositiveInteger_ACU(
        cloned.maxRetries ?? cloned.loopSettings?.maxRetries,
        fallback?.maxRetries ?? DEFAULT_PLOT_SETTINGS_ACU.loopSettings?.maxRetries ?? 3,
      ),
      mergeStrategy: typeof cloned.mergeStrategy === 'string' && cloned.mergeStrategy.trim()
        ? cloned.mergeStrategy.trim()
        : (fallback?.mergeStrategy || 'append'),
      stage: normalizePositiveInteger_ACU(cloned.stage, fallback?.stage ?? 1),
      order: normalizeNonNegativeInteger_ACU(cloned.order, fallback?.order ?? index),
      description: normalizeOptionalString_ACU(cloned.description, fallback?.description),
      triggerWhen: normalizeOptionalString_ACU(cloned.triggerWhen, fallback?.triggerWhen),
      agentControl: normalizePlotTaskAgentControl_ACU(cloned.agentControl, fallback?.agentControl),
    };
}

function buildLegacyWrappedPlotTask_ACU(source: Record<string, any> | null, { taskId = 'defaultPlotTask', taskName = '默认任务', order = 0 } = {}) {
    return normalizePlotTask_ACU({
      id: taskId,
      name: taskName,
      enabled: true,
      promptGroup: getPlotPromptGroupFromSource_ACU(source),
      extractTags: typeof source?.extractTags === 'string' ? source.extractTags : '',
      minLength: source?.minLength,
      maxRetries: source?.loopSettings?.maxRetries,
      mergeStrategy: 'append',
      stage: 1,
      order,
    }, { index: order });
}

export function normalizePlotTasks_ACU(source: Record<string, any> | null, { fallbackTaskId = 'defaultPlotTask', fallbackTaskName = '默认任务' } = {}) {
    const baseSource = source && typeof source === 'object' ? source : {};
    const fallbackTask = buildLegacyWrappedPlotTask_ACU(baseSource, {
      taskId: fallbackTaskId,
      taskName: fallbackTaskName,
      order: 0,
    });
    const rawTasks = Array.isArray(baseSource.plotTasks) && baseSource.plotTasks.length > 0
      ? baseSource.plotTasks
      : [fallbackTask];
    return rawTasks
      .map((task: Record<string, any>, index: number) => normalizePlotTask_ACU(task, {
        index,
        fallbackTask: { ...fallbackTask, order: index },
      }))
      .sort((a: Record<string, any>, b: Record<string, any>) => a.order - b.order);
}

export function syncLegacyPlotSettingsFromTask_ACU(plotSettings: Record<string, any>, task: Record<string, any>) {
    if (!plotSettings || !task) return;
    ensurePlotPromptsArray_ACU(plotSettings);
    const normalizedPromptGroup = getPlotPromptGroupFromSource_ACU(task);
    plotSettings.promptGroup = JSON.parse(JSON.stringify(normalizedPromptGroup));
    plotSettings.extractTags = typeof task.extractTags === 'string' ? task.extractTags : '';
    plotSettings.minLength = normalizeNonNegativeInteger_ACU(task.minLength, 0);
    const legacyPromptTexts = getLegacyPromptTextsFromPromptGroup_ACU(normalizedPromptGroup);
    setPlotPromptContentByIdForSettings_ACU(plotSettings, 'mainPrompt', legacyPromptTexts.mainPrompt || '');
    setPlotPromptContentByIdForSettings_ACU(plotSettings, 'systemPrompt', legacyPromptTexts.systemPrompt || '');
}

function syncPrimaryPlotTaskFromLegacySettings_ACU(plotSettings: Record<string, any>) {
    if (!plotSettings || typeof plotSettings !== 'object') return;
    ensurePlotPromptGroup_ACU(plotSettings);
    ensurePlotPromptsArray_ACU(plotSettings);
    const legacyPromptTexts = getLegacyPromptTextsFromPromptGroup_ACU(plotSettings.promptGroup || []);
    setPlotPromptContentByIdForSettings_ACU(plotSettings, 'mainPrompt', legacyPromptTexts.mainPrompt || '');
    setPlotPromptContentByIdForSettings_ACU(plotSettings, 'systemPrompt', legacyPromptTexts.systemPrompt || '');
    const normalizedTasks = normalizePlotTasks_ACU(plotSettings);
    const primaryTaskIndex = normalizedTasks.findIndex((task: Record<string, any>) => task && task.enabled !== false);
    const targetIndex = primaryTaskIndex >= 0 ? primaryTaskIndex : 0;
    const currentTask = normalizedTasks[targetIndex] || buildLegacyWrappedPlotTask_ACU(plotSettings, { order: targetIndex });
    normalizedTasks[targetIndex] = normalizePlotTask_ACU({
      ...currentTask,
      promptGroup: JSON.parse(JSON.stringify(plotSettings.promptGroup || [])),
      extractTags: plotSettings.extractTags,
      minLength: plotSettings.minLength,
      maxRetries: plotSettings.loopSettings?.maxRetries,
      order: currentTask.order ?? targetIndex,
    }, {
      index: targetIndex,
      fallbackTask: currentTask,
    });
    plotSettings.plotTasks = normalizedTasks;
}

export function ensurePlotTasksCompat_ACU(plotSettings: Record<string, any>, { persist = false, syncLegacy = true } = {}) {
    if (!plotSettings || typeof plotSettings !== 'object') return;
    const normalizedTasks = normalizePlotTasks_ACU(plotSettings);
    plotSettings.plotTasks = normalizedTasks;
    if (syncLegacy && normalizedTasks.length > 0) {
      const primaryTask = normalizedTasks.find((task: Record<string, any>) => task && task.enabled !== false) || normalizedTasks[0];
      syncLegacyPlotSettingsFromTask_ACU(plotSettings, primaryTask);
    }
    if (persist) {
      try { saveSettings_ACU(); } catch (e) {}
    }
}

// ═══ 预设选择值规范化 ═══

export const DEFAULT_PRESET_OPTION_VALUE_ACU = '__ACU_DEFAULT_PRESET__';

export function normalizePlotPresetSelectionValue_ACU(presetName: any): string {
    const normalizedName = String(presetName ?? '').trim();
    return normalizedName === DEFAULT_PRESET_OPTION_VALUE_ACU ? '' : normalizedName;
}

export function isDefaultPlotPresetSelection_ACU(presetName: any) {
    return normalizePlotPresetSelectionValue_ACU(presetName) === '';
}

// ═══ 预设绑定存储 ═══

export function ensurePlotPresetBindingsStore_ACU() {
    if (!settings_ACU || typeof settings_ACU !== 'object') return {};
    if (!settings_ACU.plotPresetBindings || typeof settings_ACU.plotPresetBindings !== 'object' || Array.isArray(settings_ACU.plotPresetBindings)) {
      settings_ACU.plotPresetBindings = {};
    }
    return settings_ACU.plotPresetBindings;
}

function normalizePlotPresetBindingChatId_ACU(chatId = currentChatFileIdentifier_ACU) {
    const normalizedChatId = cleanChatName_ACU(String(chatId ?? '').trim());
    return (normalizedChatId && normalizedChatId !== 'unknown_chat_source') ? normalizedChatId : '';
}

function hasPlotPresetBindingForChat_ACU(chatId = currentChatFileIdentifier_ACU) {
    const normalizedChatId = normalizePlotPresetBindingChatId_ACU(chatId);
    if (!normalizedChatId) return false;
    return Object.prototype.hasOwnProperty.call(ensurePlotPresetBindingsStore_ACU(), normalizedChatId);
}

export function getPlotPresetBindingForChat_ACU(chatId = currentChatFileIdentifier_ACU) {
    const normalizedChatId = normalizePlotPresetBindingChatId_ACU(chatId);
    if (!normalizedChatId) return null;
    const bindingStore = ensurePlotPresetBindingsStore_ACU();
    if (!Object.prototype.hasOwnProperty.call(bindingStore, normalizedChatId)) return null;
    const rawBinding = bindingStore[normalizedChatId] || {};
    const normalizedSource = ['inherit', 'ui', 'api'].includes(rawBinding.source) ? rawBinding.source : 'inherit';
    const normalizedBinding = {
      presetName: normalizePlotPresetSelectionValue_ACU(rawBinding.presetName),
      source: normalizedSource,
      isExplicit: rawBinding.isExplicit === true,
      updatedAt: Number.isFinite(rawBinding.updatedAt) ? rawBinding.updatedAt : 0,
    };
    bindingStore[normalizedChatId] = normalizedBinding;
    return normalizedBinding;
}

export function setPlotPresetBindingForChat_ACU(chatId: string, presetName: string, { source = 'inherit', isExplicit = false } = {}) {
    const normalizedChatId = normalizePlotPresetBindingChatId_ACU(chatId);
    if (!normalizedChatId) return null;
    const normalizedSource = ['inherit', 'ui', 'api'].includes(source) ? source : 'inherit';
    const binding = {
      presetName: normalizePlotPresetSelectionValue_ACU(presetName),
      source: normalizedSource,
      isExplicit: isExplicit === true,
      updatedAt: Date.now(),
    };
    ensurePlotPresetBindingsStore_ACU()[normalizedChatId] = binding;
    return binding;
}

export function clearPlotPresetBindingForChat_ACU(chatId = currentChatFileIdentifier_ACU) {
    const normalizedChatId = normalizePlotPresetBindingChatId_ACU(chatId);
    if (!normalizedChatId) return false;
    const bindingStore = ensurePlotPresetBindingsStore_ACU();
    if (!Object.prototype.hasOwnProperty.call(bindingStore, normalizedChatId)) return false;
    delete bindingStore[normalizedChatId];
    return true;
}

export function findPlotPresetByName_ACU(presetName: string) {
    const normalizedPresetName = normalizePlotPresetSelectionValue_ACU(presetName);
    if (!normalizedPresetName) return null;
    const presets = settings_ACU?.plotSettings?.promptPresets || [];
    const targetPresetRaw = presets.find((p: Record<string, any>) => p.name === normalizedPresetName);
    return targetPresetRaw ? normalizePlotPresetExcludeRules_ACU(targetPresetRaw) : null;
}

export function resolveActivePlotPresetName_ACU({ fallbackToGlobal = true } = {}) {
    const chatScopeState = getCurrentChatPlotScopeState_ACU();
    if (chatScopeState) {
      return normalizePlotPresetSelectionValue_ACU(chatScopeState.presetName || '');
    }
    const binding = getPlotPresetBindingForChat_ACU();
    if (binding) {
      if (isDefaultPlotPresetSelection_ACU(binding.presetName)) return '';
      const boundPreset = findPlotPresetByName_ACU(binding.presetName);
      if (boundPreset) return boundPreset.name;
    }
    if (!fallbackToGlobal) return '';
    const globalPresetName = normalizePlotPresetSelectionValue_ACU(settings_ACU?.plotSettings?.lastUsedPresetName || '');
    if (isDefaultPlotPresetSelection_ACU(globalPresetName)) return '';
    const globalPreset = findPlotPresetByName_ACU(globalPresetName);
    return globalPreset ? globalPreset.name : '';
}

export function getCurrentRuntimePlotPresetName_ACU({ fallbackToGlobal = true } = {}) {
    return normalizePlotPresetSelectionValue_ACU(resolveActivePlotPresetName_ACU({ fallbackToGlobal }));
}

// ═══ 编辑器设置 ═══

function normalizePlotEditorScope_ACU(scope = 'resolved') {
    if (scope === 'chat') return 'chat';
    if (scope === 'global') return 'global';
    return 'resolved';
}

export function setCurrentEditablePlotPresetState_ACU(presetName: string, { scope = 'resolved', source = '' } = {}) {
    _set_currentEditablePlotPresetState_ACU({
      initialized: true,
      presetName: normalizePlotPresetSelectionValue_ACU(presetName),
      scope: normalizePlotEditorScope_ACU(scope),
      source: String(source || ''),
    });
    return currentEditablePlotPresetState_ACU;
}

export function syncCurrentEditablePlotPresetState_ACU({ source = 'runtime_sync' } = {}) {
    const chatScopeState = getCurrentChatPlotScopeState_ACU();
    const binding = getPlotPresetBindingForChat_ACU();
    const resolvedPresetName = resolveActivePlotPresetName_ACU({ fallbackToGlobal: true });
    const scope = (chatScopeState || binding) ? 'chat' : 'global';
    return setCurrentEditablePlotPresetState_ACU(resolvedPresetName, { scope, source });
}

export function getActivePlotEditorSettings_ACU({ fallbackToRuntime = true } = {}) {
    const activeSettings = activePlotEditorSettings_ACU || (fallbackToRuntime ? settings_ACU?.plotSettings : null);
    return activeSettings && typeof activeSettings === 'object' ? activeSettings : null;
}

export function setActivePlotEditorSettings_ACU(plotSettings: Record<string, any> | null) {
    if (!plotSettings || typeof plotSettings !== 'object') {
      _set_activePlotEditorSettings_ACU(null);
      return null;
    }
    _set_activePlotEditorSettings_ACU(plotSettings);
    stripLegacyLoopPromptFieldsInPlace_ACU(activePlotEditorSettings_ACU);
    ensurePlotPromptsArray_ACU(activePlotEditorSettings_ACU);
    ensurePlotTasksCompat_ACU(activePlotEditorSettings_ACU, { syncLegacy: true });
    activePlotEditorSettings_ACU.finalSystemDirective = getPlotFinalDirectiveFromSource_ACU(activePlotEditorSettings_ACU);
    setPlotPromptContentByIdForSettings_ACU(
      activePlotEditorSettings_ACU,
      'finalSystemDirective',
      activePlotEditorSettings_ACU.finalSystemDirective || '',
    );
    return activePlotEditorSettings_ACU;
}

export function getPlotGlobalRevision_ACU() {
    const rawRevision = settings_ACU?.plotSettings?.globalRevision;
    return Number.isFinite(rawRevision) ? Math.max(0, Math.trunc(rawRevision)) : 0;
}

// ═══ 预设应用/重置 ═══

function cloneDefaultPlotSettingsForPreset_ACU() {
    const defaults = JSON.parse(JSON.stringify(DEFAULT_PLOT_SETTINGS_ACU));
    ensurePlotPromptsArray_ACU(defaults);
    ensurePlotTasksCompat_ACU(defaults, { syncLegacy: true });
    return defaults;
}

export function applyPlotPresetToSettings_ACU(plotSettings: Record<string, any>, preset: Record<string, any> | null) {
    if (!plotSettings || !preset) {
      return { normalizedPreset: null, promptGroup: [], finalDirective: '' };
    }
    const preservedEnabled = plotSettings.enabled === true;
    const normalizedPreset = normalizePlotPresetExcludeRules_ACU(preset);
    const finalDirective = getPlotFinalDirectiveFromSource_ACU(normalizedPreset);
    ensurePlotPromptsArray_ACU(plotSettings);
    plotSettings.enabled = preservedEnabled;
    plotSettings.plotTasks = normalizePlotTasks_ACU(normalizedPreset);
    plotSettings.promptGroup = JSON.parse(JSON.stringify(getPlotPromptGroupFromSource_ACU(normalizedPreset)));
    plotSettings.finalSystemDirective = finalDirective || '';
    setPlotPromptContentByIdForSettings_ACU(plotSettings, 'finalSystemDirective', finalDirective || '');
    plotSettings.rateMain = normalizedPreset.rateMain ?? 1.0;
    plotSettings.ratePersonal = normalizedPreset.ratePersonal ?? 1.0;
    plotSettings.rateErotic = normalizedPreset.rateErotic ?? 0;
    plotSettings.rateCuckold = normalizedPreset.rateCuckold ?? 1.0;
    plotSettings.recallCount = normalizedPreset.recallCount ?? 20;
    plotSettings.extractTags = normalizedPreset.extractTags || '';
    plotSettings.contextExtractRules = normalizeExtractRules_ACU(normalizedPreset.contextExtractRules, normalizedPreset.contextExtractTags || '');
    plotSettings.contextExcludeRules = normalizeExcludeRules_ACU(normalizedPreset.contextExcludeRules, normalizedPreset.contextExcludeTags || '');
    plotSettings.minLength = normalizedPreset.minLength ?? 0;
    plotSettings.contextTurnCount = normalizedPreset.contextTurnCount ?? 3;
    if (normalizedPreset.loopSettings) {
      stripLegacyLoopPromptFieldsInPlace_ACU(plotSettings);
      plotSettings.loopSettings = { ...plotSettings.loopSettings, ...normalizedPreset.loopSettings };
    }
    stripLegacyLoopPromptFieldsInPlace_ACU(plotSettings);
    ensurePlotTasksCompat_ACU(plotSettings, { syncLegacy: true });
    plotSettings.finalSystemDirective = getPlotPromptContentByIdFromSettings_ACU(plotSettings, 'finalSystemDirective') || plotSettings.finalSystemDirective || '';
    return {
      normalizedPreset,
      promptGroup: JSON.parse(JSON.stringify(plotSettings.promptGroup || [])),
      finalDirective: getPlotPromptContentByIdFromSettings_ACU(plotSettings, 'finalSystemDirective') || '',
    };
}

/**
 * 剧情世界书选择（plotWorldbookConfig）以角色卡为单位持久化，不属于预设/聊天快照的一部分；
 * 预设重置/快照替换时必须原样保留，否则切聊天走"继承默认预设"路径会把用户的手动选择打回默认。
 */
function preservePlotWorldbookConfig_ACU(plotSettings: Record<string, any>): Record<string, any> | null {
    const cfg = plotSettings?.plotWorldbookConfig;
    return cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? JSON.parse(JSON.stringify(cfg)) : null;
}

export function resetPlotSettingsToDefault_ACU(plotSettings: Record<string, any>) {
    if (!plotSettings || typeof plotSettings !== 'object') return null;
    const preservedEnabled = plotSettings.enabled === true;
    const preservedPromptPresets = Array.isArray(plotSettings.promptPresets)
      ? JSON.parse(JSON.stringify(plotSettings.promptPresets)).map(stripLegacyLoopPromptFields_ACU)
      : [];
    const preservedLastUsedPresetName = normalizePlotPresetSelectionValue_ACU(plotSettings.lastUsedPresetName || '');
    const preservedGlobalRevision = Number.isFinite(plotSettings.globalRevision)
      ? Math.max(0, Math.trunc(plotSettings.globalRevision))
      : 0;
    const preservedPlotWorldbookConfig = preservePlotWorldbookConfig_ACU(plotSettings);
    const defaults = cloneDefaultPlotSettingsForPreset_ACU();
    Object.keys(plotSettings).forEach((key: string) => { delete plotSettings[key]; });
    Object.assign(plotSettings, defaults);
    plotSettings.enabled = preservedEnabled;
    plotSettings.promptPresets = preservedPromptPresets;
    plotSettings.lastUsedPresetName = preservedLastUsedPresetName;
    plotSettings.globalRevision = preservedGlobalRevision;
    if (preservedPlotWorldbookConfig) plotSettings.plotWorldbookConfig = preservedPlotWorldbookConfig;
    ensurePlotPromptsArray_ACU(plotSettings);
    ensurePlotTasksCompat_ACU(plotSettings, { syncLegacy: true });
    return plotSettings;
}

export function replaceCurrentPlotSettingsWithSnapshot_ACU(plotSettings: Record<string, any>, snapshot: Record<string, any> | null) {
    if (!plotSettings || typeof plotSettings !== 'object') return null;
    const normalizedSnapshot = sanitizePlotSettingsSnapshotForChat_ACU(snapshot);
    if (!normalizedSnapshot) return null;
    const preservedEnabled = plotSettings.enabled === true;
    const preservedPromptPresets = Array.isArray(plotSettings.promptPresets)
      ? JSON.parse(JSON.stringify(plotSettings.promptPresets)).map(stripLegacyLoopPromptFields_ACU)
      : [];
    const preservedLastUsedPresetName = normalizePlotPresetSelectionValue_ACU(plotSettings.lastUsedPresetName || '');
    const preservedGlobalRevision = Number.isFinite(plotSettings.globalRevision)
      ? Math.max(0, Math.trunc(plotSettings.globalRevision))
      : 0;
    const preservedPlotWorldbookConfig = preservePlotWorldbookConfig_ACU(plotSettings);
    const defaults = cloneDefaultPlotSettingsForPreset_ACU();
    Object.keys(plotSettings).forEach((key: string) => { delete plotSettings[key]; });
    Object.assign(plotSettings, defaults, normalizedSnapshot);
    plotSettings.enabled = preservedEnabled;
    plotSettings.promptPresets = preservedPromptPresets;
    plotSettings.lastUsedPresetName = preservedLastUsedPresetName;
    plotSettings.globalRevision = preservedGlobalRevision;
    if (preservedPlotWorldbookConfig) plotSettings.plotWorldbookConfig = preservedPlotWorldbookConfig;
    ensurePlotPromptsArray_ACU(plotSettings);
    ensurePlotTasksCompat_ACU(plotSettings, { syncLegacy: true });
    plotSettings.finalSystemDirective = getPlotFinalDirectiveFromSource_ACU(plotSettings);
    setPlotPromptContentByIdForSettings_ACU(plotSettings, 'finalSystemDirective', plotSettings.finalSystemDirective || '');
    return plotSettings;
}

// ═══ 排除规则 ═══

export function stripPlotTaskRuntimeApiPresetFields_ACU(tasks: any[]) {
    if (!Array.isArray(tasks)) return [];
    return tasks.map((task: any) => {
      if (!task || typeof task !== 'object') return task;
      const clonedTask = { ...task };
      delete clonedTask.taskApiPreset;
      return clonedTask;
    });
}

export function normalizePlotPresetExcludeRules_ACU(preset: Record<string, any> | null) {
    if (!preset || typeof preset !== 'object') return preset;
    const cloned = JSON.parse(JSON.stringify(preset));
    stripLegacyLoopPromptFieldsInPlace_ACU(cloned);
    cloned.contextExtractRules = normalizeExtractRules_ACU(cloned.contextExtractRules, cloned.contextExtractTags || '');
    cloned.contextExcludeRules = normalizeExcludeRules_ACU(cloned.contextExcludeRules, cloned.contextExcludeTags || '');
    cloned.plotTasks = stripPlotTaskRuntimeApiPresetFields_ACU(normalizePlotTasks_ACU(cloned));
    cloned.finalSystemDirective = getPlotFinalDirectiveFromSource_ACU(cloned);
    ensurePlotTasksCompat_ACU(cloned, { syncLegacy: true });
    cloned.plotTasks = stripPlotTaskRuntimeApiPresetFields_ACU(normalizePlotTasks_ACU(cloned));
    setPlotPromptContentByIdForSettings_ACU(cloned, 'finalSystemDirective', cloned.finalSystemDirective || '');
    delete cloned.contextExtractTags;
    delete cloned.contextExcludeTags;
    return cloned;
}

export function stripPlotPresetWorldbookEntrySelectionForExport_ACU(preset: Record<string, any> | null) {
    const normalizedPreset = normalizePlotPresetExcludeRules_ACU(preset);
    if (!normalizedPreset || typeof normalizedPreset !== 'object') return normalizedPreset;
    const exportPreset = JSON.parse(JSON.stringify(normalizedPreset));
    if (exportPreset.plotWorldbookConfig && typeof exportPreset.plotWorldbookConfig === 'object') {
      delete exportPreset.plotWorldbookConfig.enabledEntries;
    }
    return exportPreset;
}

// ═══ Prompt 内容读写 ═══

export function ensurePlotPromptsArray_ACU(plotSettings: Record<string, any>) {
    if (!plotSettings) return;
    const p = plotSettings.prompts;
    if (Array.isArray(p)) {
      const required = [
        { id: 'mainPrompt', role: 'system', name: '主系统提示词 (通用)' },
        { id: 'systemPrompt', role: 'user', name: '拦截任务详细指令' },
        { id: 'finalSystemDirective', role: 'system', name: '最终注入指令 (Storyteller Directive)' },
      ];
      required.forEach((req: { id: string; role: string; name: string }) => {
        if (!p.some((x: any) => x && x.id === req.id)) {
          p.push({ ...req, content: '', deletable: false });
        }
      });
      return;
    }
    const legacy = (p && typeof p === 'object') ? p : {};
    plotSettings.prompts = [
      { id: 'mainPrompt', name: '主系统提示词 (通用)', role: 'system', content: legacy.mainPrompt || '', deletable: false },
      { id: 'systemPrompt', name: '拦截任务详细指令', role: 'user', content: legacy.systemPrompt || '', deletable: false },
      { id: 'finalSystemDirective', name: '最终注入指令 (Storyteller Directive)', role: 'system', content: legacy.finalSystemDirective || '', deletable: false },
    ];
}

export function getPlotPromptContentByIdFromSettings_ACU(plotSettings: Record<string, any>, promptId: string) {
    if (!plotSettings) return '';
    ensurePlotPromptsArray_ACU(plotSettings);
    const arr = plotSettings.prompts || [];
    const item = arr.find((p: any) => p && p.id === promptId);
    return item?.content || '';
}

export function setPlotPromptContentByIdForSettings_ACU(plotSettings: Record<string, any>, promptId: string, content: string) {
    if (!plotSettings) return;
    ensurePlotPromptsArray_ACU(plotSettings);
    const arr = plotSettings.prompts || [];
    const item = arr.find((p: any) => p && p.id === promptId);
    if (item) item.content = content ?? '';
}

// ═══ 拦截标记 ═══

let lastPlotInterception_ACU = { text: '', ts: 0 };

export function markPlotIntercept_ACU(text: string) {
    lastPlotInterception_ACU = { text: String(text || ''), ts: Date.now() };
}

export function shouldSkipPlotIntercept_ACU(text: string, windowMs = 5000) {
    const t = String(text || '');
    if (!t) return false;
    const age = Date.now() - (lastPlotInterception_ACU?.ts || 0);
    if (age < 0 || age > windowMs) return false;
    return t === String(lastPlotInterception_ACU?.text || '');
}

// ═══ 预设持久化（纯数据操作） ═══

function queueSaveCurrentChatPlotScope_ACU(source = 'ui_plot_scope') {
    Promise.resolve()
      .then(() => saveChatToHost_ACU())
      .catch(error => logWarn_ACU(`[剧情推进] 保存聊天级预设快照失败(${source}):`, error));
}

export function persistCurrentChatPlotEditorSnapshot_ACU({ source = 'ui_task_edit', save = true } = {}) {
    if (!settings_ACU?.plotSettings) return null;
    const normalizedPresetName = getCurrentRuntimePlotPresetName_ACU({ fallbackToGlobal: true });
    const hadLegacyChatScopeSnapshot = !!getCurrentChatPlotScopeState_ACU();
    if (hadLegacyChatScopeSnapshot) {
      clearCurrentChatPlotScopeState_ACU();
    }
    setPlotPresetBindingForChat_ACU(currentChatFileIdentifier_ACU, normalizedPresetName, {
      source,
      isExplicit: source !== 'inherit',
    });
    if (save) {
      saveSettings_ACU();
      if (hadLegacyChatScopeSnapshot) {
        queueSaveCurrentChatPlotScope_ACU(`${source}_clear_legacy_plot_scope`);
      }
    }
    return getPlotPresetBindingForChat_ACU(currentChatFileIdentifier_ACU);
}

export function persistPlotPresetSelectionState_ACU(presetName: string, options: { source?: string; updateGlobal?: boolean; save?: boolean; persistChatScope?: boolean } = {}) {
    const { source = 'ui', updateGlobal = false, save = true, persistChatScope = !updateGlobal } = options;
    const normalizedPresetName = normalizePlotPresetSelectionValue_ACU(presetName);
    const hadLegacyChatScopeSnapshot = !!getCurrentChatPlotScopeState_ACU();

    if (updateGlobal && settings_ACU?.plotSettings) {
      settings_ACU.plotSettings.lastUsedPresetName = normalizedPresetName;
    } else if (persistChatScope && settings_ACU?.plotSettings) {
      if (hadLegacyChatScopeSnapshot) {
        clearCurrentChatPlotScopeState_ACU();
      }
      setPlotPresetBindingForChat_ACU(currentChatFileIdentifier_ACU, normalizedPresetName, {
        source,
        isExplicit: source !== 'inherit',
      });
    } else {
      setPlotPresetBindingForChat_ACU(currentChatFileIdentifier_ACU, normalizedPresetName, {
        source,
        isExplicit: source !== 'inherit',
      });
    }

    if (save) {
      saveSettings_ACU();
      if (hadLegacyChatScopeSnapshot && !updateGlobal) {
        Promise.resolve()
          .then(() => saveChatToHost_ACU())
          .catch(error => logWarn_ACU('[剧情推进] 清理旧聊天级预设快照失败:', error));
      }
    }

    return normalizedPresetName;
}

// ═══ 预设切换（纯业务逻辑，去掉 refreshUi） ═══

export function switchCurrentChatPlotPreset_ACU(presetName: string, { source = 'ui', save = true } = {}) {
    if (!settings_ACU?.plotSettings) return false;

    const normalizedPresetName = normalizePlotPresetSelectionValue_ACU(presetName);
    const hadLegacyChatScopeSnapshot = !!getCurrentChatPlotScopeState_ACU();
    if (hadLegacyChatScopeSnapshot) {
      clearCurrentChatPlotScopeState_ACU();
    }

    const bindingSource = String(source || '').startsWith('api') ? 'api' : 'ui';
    let result = null;

    if (isDefaultPlotPresetSelection_ACU(normalizedPresetName)) {
      clearPlotPresetBindingForChat_ACU(currentChatFileIdentifier_ACU);
      const inheritedGlobalPresetName = normalizePlotPresetSelectionValue_ACU(settings_ACU.plotSettings.lastUsedPresetName || '');
      const inheritedGlobalPreset = findPlotPresetByName_ACU(inheritedGlobalPresetName);
      if (inheritedGlobalPreset) {
        applyPlotPresetToSettings_ACU(settings_ACU.plotSettings, inheritedGlobalPreset);
      } else {
        resetPlotSettingsToDefault_ACU(settings_ACU.plotSettings);
      }
      _set_currentPlotTaskEditorId_ACU('');
      setCurrentEditablePlotPresetState_ACU(inheritedGlobalPresetName, { scope: 'chat', source });
      result = {
        presetName: '',
        isDefault: true,
        followsGlobal: true,
        preset: inheritedGlobalPreset || null,
        activePresetName: inheritedGlobalPresetName,
      };
    } else {
      const targetPreset = findPlotPresetByName_ACU(normalizedPresetName);
      if (!targetPreset) return false;
      applyPlotPresetToSettings_ACU(settings_ACU.plotSettings, targetPreset);
      setPlotPresetBindingForChat_ACU(currentChatFileIdentifier_ACU, targetPreset.name, {
        source: bindingSource,
        isExplicit: true,
      });
      _set_currentPlotTaskEditorId_ACU('');
      setCurrentEditablePlotPresetState_ACU(targetPreset.name, { scope: 'chat', source });
      result = {
        presetName: targetPreset.name,
        isDefault: false,
        followsGlobal: false,
        preset: targetPreset,
        activePresetName: targetPreset.name,
      };
    }

    if (save) {
      saveSettings_ACU();
      if (hadLegacyChatScopeSnapshot) {
        queueSaveCurrentChatPlotScope_ACU(`${bindingSource}_clear_legacy_plot_scope`);
      }
    }

    return result;
}

export async function clearCurrentChatPlotPresetOverride_ACU({
    source = 'reset_all_defaults',
    save = true,
    saveSettings,
    saveChat,
}: {
    source?: string;
    save?: boolean;
    saveSettings?: boolean;
    saveChat?: boolean;
} = {}) {
    const shouldSaveSettings = saveSettings ?? save;
    const shouldSaveChat = saveChat ?? save;
    const hadChatScopeSnapshot = !!getCurrentChatPlotScopeState_ACU();
    const hadBinding = !!getPlotPresetBindingForChat_ACU(currentChatFileIdentifier_ACU);
    const result = switchCurrentChatPlotPreset_ACU('', { source, save: false });
    if (!result || typeof result !== 'object') {
      return {
        changed: false,
        clearedChatScope: false,
        clearedBinding: false,
        activePresetName: '',
        followsGlobal: false,
      };
    }

    if (shouldSaveSettings) {
      saveSettings_ACU();
    }
    if (shouldSaveChat && hadChatScopeSnapshot) {
      try {
        await saveChatToHost_ACU();
      } catch (error) {
        logWarn_ACU('[剧情推进] 保存当前聊天剧情推进预设清理失败:', error);
      }
    }

    return {
      changed: hadChatScopeSnapshot || hadBinding,
      clearedChatScope: hadChatScopeSnapshot,
      clearedBinding: hadBinding,
      activePresetName: result.activePresetName || '',
      followsGlobal: result.followsGlobal === true,
    };
}

function buildPlotSettingsPreviewFromPreset_ACU(presetName: string) {
    const normalizedPresetName = normalizePlotPresetSelectionValue_ACU(presetName);
    const previewSettings = cloneDefaultPlotSettingsForPreset_ACU();
    if (isDefaultPlotPresetSelection_ACU(normalizedPresetName)) {
      resetPlotSettingsToDefault_ACU(previewSettings);
    } else {
      const targetPreset = findPlotPresetByName_ACU(normalizedPresetName);
      if (!targetPreset) return null;
      applyPlotPresetToSettings_ACU(previewSettings, targetPreset);
    }
    previewSettings.lastUsedPresetName = normalizedPresetName;
    ensurePlotPromptsArray_ACU(previewSettings);
    ensurePlotTasksCompat_ACU(previewSettings, { syncLegacy: true });
    previewSettings.finalSystemDirective = getPlotFinalDirectiveFromSource_ACU(previewSettings);
    setPlotPromptContentByIdForSettings_ACU(previewSettings, 'finalSystemDirective', previewSettings.finalSystemDirective || '');
    return previewSettings;
}

export function applyGlobalPlotPresetSelectionForEditor_ACU(presetName: string, { source = 'ui', save = true } = {}) {
    if (!settings_ACU?.plotSettings) return false;
    const normalizedPresetName = normalizePlotPresetSelectionValue_ACU(presetName);
    const previewSettings = buildPlotSettingsPreviewFromPreset_ACU(normalizedPresetName);
    if (!previewSettings) return false;
    _set_currentPlotTaskEditorId_ACU('');
    setCurrentEditablePlotPresetState_ACU(normalizedPresetName, { scope: 'global', source });
    persistPlotPresetSelectionState_ACU(normalizedPresetName, {
      source,
      updateGlobal: true,
      save,
      persistChatScope: false,
    });
    return {
      presetName: normalizedPresetName,
      isDefault: isDefaultPlotPresetSelection_ACU(normalizedPresetName),
      previewSettings,
    };
}

// ═══ 全局修订 ═══ (resolveActivePlotPresetName_ACU 已在上方定义为内部函数)

// ═══ 优化相关 ═══

export function getLastOptimizedMessageIndex_ACU() {
    const chat = getChatArray_ACU();
    const cachedBase = getLastOptimizationBase_ACU();

    if (cachedBase?.messageId != null) {
    const runtimeIndex = chat.findIndex((msg: any) => msg && !msg.is_user && msg.message_id === cachedBase.messageId);
      if (runtimeIndex >= 0) return runtimeIndex;
    }

    if (Number.isInteger(cachedBase?.messageIndex) && cachedBase.messageIndex >= 0 && chat[cachedBase.messageIndex] && !chat[cachedBase.messageIndex].is_user) {
      return cachedBase.messageIndex;
    }

    let latestIndex = -1;
    let latestTimestamp = -1;
    for (let i = 0; i < chat.length; i++) {
      const msg = chat[i];
      if (!msg || msg.is_user) continue;
      const extra = msg.extra || {};
      const ts = Number(extra._acu_last_optimized_at || 0);
      if (extra._acu_original_content && ts >= latestTimestamp) {
        latestTimestamp = ts;
        latestIndex = i;
      }
    }

    if (latestIndex >= 0) {
      const latestMessage = chat[latestIndex];
      const latestExtra = latestMessage?.extra || {};
      setLastOptimizationBase_ACU({
        messageIndex: latestIndex,
        messageId: latestMessage?.message_id ?? null,
        baseContent: latestExtra._acu_original_content || latestMessage?.mes || ''
      });
    }

    return latestIndex;
}
