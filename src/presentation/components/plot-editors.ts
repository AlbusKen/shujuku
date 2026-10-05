// plot-editors.ts
// 从 02_shared_editors_and_selectors.js 整体迁入

import { DEFAULT_CHAR_CARD_PROMPT_ACU } from '../../shared/defaults-json.js';
import { showToastr_ACU } from '../theme/toast';

import {
  settings_ACU,
  isAutoUpdatingCard_ACU,
  wasStoppedByUser_ACU,
  contentOptimizationDebounceTimer_ACU,
  chatMutationDebounceTimer_ACU,
  currentAbortController_ACU,
  activeAbortControllers_ACU,
  manualExtraHint_ACU,
  trackAbortController_ACU,
  untrackAbortController_ACU,
  abortAllActiveRequests_ACU,
  _set_currentAbortController_ACU,
  _set_isAutoUpdatingCard_ACU,
  _set_manualExtraHint_ACU,
  _set_wasStoppedByUser_ACU,
  _set_contentOptimizationDebounceTimer_ACU,
  _set_chatMutationDebounceTimer_ACU,
} from '../../service/runtime/state-manager';

let plotTaskEditorAutoSaveTimer_ACU: ReturnType<typeof setTimeout> | null = null;
import { saveSettingsAndNotify_ACU } from './settings-ui-helpers';
import { SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';
import { escapeHtml_ACU } from '../../shared/html-helpers';
import { logWarn_ACU, normalizePositiveInteger_ACU } from '../../shared/utils';
import { ensurePlotTasksCompat_ACU, getActivePlotEditorSettings_ACU, getPlotPromptGroupFromSource_ACU, normalizePlotTask_ACU, normalizePlotTasks_ACU, persistCurrentChatPlotEditorSnapshot_ACU, syncLegacyPlotSettingsFromTask_ACU } from '../../service/plot/plot-logic';
import { activePlotEditorSettings_ACU, currentEditablePlotPresetState_ACU, currentPlotTaskEditorId_ACU, _set_currentPlotTaskEditorId_ACU, buildDefaultPlotPromptGroup_ACU, ensurePlotPromptGroup_ACU } from '../../service/plot/plot-state';
import { $popupInstance_ACU, $charCardPromptSegmentsContainer_ACU, $plotPromptSegmentsContainer_ACU, $plotTaskListContainer_ACU, _assignUIPlaceholders_ACU } from '../state/ui-refs';
import { DEFAULT_PLOT_SETTINGS_ACU } from '../../shared/defaults-json.js';
import { jQuery_API_ACU } from '../dom-utils';

function getPlotTaskApiPresetOverrides_ACU(): Record<string, string> {
    if (!settings_ACU.plotTaskApiPresetOverridesById || typeof settings_ACU.plotTaskApiPresetOverridesById !== 'object' || Array.isArray(settings_ACU.plotTaskApiPresetOverridesById)) {
        settings_ACU.plotTaskApiPresetOverridesById = {};
    }
    return settings_ACU.plotTaskApiPresetOverridesById;
}

function ensureSelectOptionValue_ACU($select: any, value: string, label = value) {
    const normalizedValue = String(value || '').trim();
    if (!$select || !$select.length || !normalizedValue) return;
    const escapedValue = escapeHtml_ACU(normalizedValue);
    if ($select.find(`option[value="${escapedValue}"]`).length) return;
    $select.append(`<option value="${escapedValue}">${escapeHtml_ACU(label || normalizedValue)}</option>`);
}

function setPlotTaskApiPresetSelectValue_ACU(task: any) {
    if (!$popupInstance_ACU) return;
    const presetName = getPlotTaskApiPresetFromGlobalSettings_ACU(task);
    const $select = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-task-api-preset`);
    ensureSelectOptionValue_ACU($select, presetName);
    $select.val(presetName);
}

function getPlotTaskApiPresetFromGlobalSettings_ACU(task: any): string {
    const taskId = String(task?.id || '').trim();
    if (!taskId) return '';
    const overrides = getPlotTaskApiPresetOverrides_ACU();
    const mappedPreset = String(overrides[taskId] || '').trim();
    if (mappedPreset) return mappedPreset;
    return String(task?.taskApiPreset || '').trim();
}

function setPlotTaskApiPresetInGlobalSettings_ACU(taskId: any, presetName: any) {
    const normalizedTaskId = String(taskId || '').trim();
    if (!normalizedTaskId) return;
    const overrides = getPlotTaskApiPresetOverrides_ACU();
    const normalizedPresetName = String(presetName || '').trim();
    if (normalizedPresetName) {
        overrides[normalizedTaskId] = normalizedPresetName;
    } else {
        delete overrides[normalizedTaskId];
    }
}

function persistPlotTaskApiPresetOverride_ACU(source = 'ui_task_api_preset') {
    if (currentEditablePlotPresetState_ACU?.scope === 'global') {
        saveSettingsAndNotify_ACU();
        return;
    }
    persistCurrentChatPlotEditorSnapshot_ACU({ source, save: true });
}

function stripRuntimeOnlyPlotTaskFields_ACU(task: any) {
    if (!task || typeof task !== 'object') return task;
    const cloned = { ...task };
    delete cloned.taskApiPreset;
    return cloned;
}

  export function renderPromptSegments_ACU(segments: any) {
      if (!$charCardPromptSegmentsContainer_ACU) return;
      $charCardPromptSegmentsContainer_ACU.empty();
      
      // 确保 segments 是一个数组
      if (!Array.isArray(segments)) {
          // 如果不是数组，尝试解析。如果解析失败或内容为空，则创建一个默认的段落。
          let parsedSegments;
          try {
              if (typeof segments === 'string' && segments.trim()) {
                  parsedSegments = JSON.parse(segments);
              }
          } catch (e) {
              logWarn_ACU('Could not parse charCardPrompt as JSON. Treating as a single text block.', segments);
          }
          
          if (!Array.isArray(parsedSegments) || parsedSegments.length === 0) {
              // 解析失败或结果不是有效数组，则将原始输入（如果是字符串）放入一个默认段落
              const content = (typeof segments === 'string' && segments.trim()) ? segments : DEFAULT_CHAR_CARD_PROMPT_ACU;
              parsedSegments = [{ role: 'assistant', content: content, deletable: false }];
          }
          segments = parsedSegments;
      }
      
      // 如果渲染后还是空数组，则添加一个不可删除的默认段落
      if (segments.length === 0) {
          segments.push({ role: 'assistant', content: DEFAULT_CHAR_CARD_PROMPT_ACU, deletable: false });
      }



      segments.forEach((segment: any, index: number) => {
          const roleUpper = String(segment?.role || '').toUpperCase();
          const roleLower = String(segment?.role || '').toLowerCase();
          const mainSlot = (segment && (String(segment.mainSlot || '').toUpperCase() || (segment.isMain ? 'A' : (segment.isMain2 ? 'B' : '')))) || '';
          const isMainA = mainSlot === 'A';
          const isMainB = mainSlot === 'B';
          const isMainPrompt = isMainA || isMainB;
          const borderColor = isMainA ? 'var(--accent-primary)' : (isMainB ? '#ffb74d' : '');
          const segmentId = `${SCRIPT_ID_PREFIX_ACU}-prompt-segment-${index}`;
          
          const segmentHtml = `
              <div class="prompt-segment" id="${segmentId}" data-main-slot="${escapeHtml_ACU(mainSlot)}" ${isMainPrompt ? `style="border-left: 3px solid ${borderColor};"` : ''}>
                  <div class="prompt-segment-toolbar">
                      <div style="display:flex; align-items:center; gap:8px;">
                          <select class="prompt-segment-role">
                              <option value="assistant" ${roleUpper === 'AI' || roleUpper === 'ASSISTANT' || roleLower === 'assistant' ? 'selected' : ''}>AI</option>
                              <option value="SYSTEM" ${roleUpper === 'SYSTEM' || roleLower === 'system' ? 'selected' : ''}>系统</option>
                              <option value="USER" ${roleUpper === 'USER' || roleLower === 'user' ? 'selected' : ''}>用户</option>
                          </select>
                          <label style="display:flex; align-items:center; gap:6px; font-size:0.8em; cursor:pointer; user-select:none;" title="用于运行时替换/合并注入的主提示词槽位。A/B 均不可删除；剧情推进会优先覆盖 A(系统) + B(用户)。">
                              <span style="opacity:0.85;">主提示词</span>
                              <select class="prompt-segment-main-slot" style="font-size:0.85em;">
                                  <option value="" ${!isMainPrompt ? 'selected' : ''}>普通</option>
                                  <option value="A" ${isMainA ? 'selected' : ''}>A(建议System)</option>
                                  <option value="B" ${isMainB ? 'selected' : ''}>B(建议User)</option>
                              </select>
                          </label>
                      </div>
                      <button class="prompt-segment-delete-btn" data-index="${index}" style="${isMainPrompt ? 'display:none;' : ''}">-</button>
                  </div>
                  <textarea class="prompt-segment-content" rows="4">${escapeHtml_ACU(segment.content)}</textarea>
              </div>
          `;
          $charCardPromptSegmentsContainer_ACU.append(segmentHtml);
      });
  }

  export function getCharCardPromptFromUI_ACU() {
      if (!$charCardPromptSegmentsContainer_ACU) return [];
      const segments: any[] = [];
      $charCardPromptSegmentsContainer_ACU.find('.prompt-segment').each(function() {
          const $segment = jQuery_API_ACU(this);
          const role = $segment.find('.prompt-segment-role').val();
          const content = $segment.find('.prompt-segment-content').val();
          const mainSlotRaw = $segment.find('.prompt-segment-main-slot').val();
          const mainSlot = String(mainSlotRaw || '').toUpperCase();
          const isMainA = mainSlot === 'A';
          const isMainB = mainSlot === 'B';
          
          // 主提示词A/B不可删除
          const isDeletable = (isMainA || isMainB) ? false : true;
          
          const segmentData: any = { role: role, content: content, deletable: isDeletable };
          if (isMainA) {
            segmentData.mainSlot = 'A';
            segmentData.isMain = true; // 兼容旧逻辑
          } else if (isMainB) {
            segmentData.mainSlot = 'B';
            segmentData.isMain2 = true; // 兼容旧逻辑（若有）
          }
          
          segments.push(segmentData);
      });
      return segments;
  }

  // --- [剧情推进] 独立提示词组（段落编辑器） ---
  // buildDefaultPlotPromptGroup_ACU, getLegacyPlotPromptContent_ACU, ensurePlotPromptGroup_ACU 已搬到 service/plot/plot-state.ts

  export function renderPlotPromptSegments_ACU(segments: any) {
      if ((!$plotPromptSegmentsContainer_ACU || !$plotPromptSegmentsContainer_ACU.length) && $popupInstance_ACU) {
          _assignUIPlaceholders_ACU({ $plotPromptSegmentsContainer_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-prompt-segments-container`) });
      }
      if (!$plotPromptSegmentsContainer_ACU || !$plotPromptSegmentsContainer_ACU.length) return;
      $plotPromptSegmentsContainer_ACU.empty();

      // 确保 segments 是一个数组
      if (!Array.isArray(segments)) {
          segments = [];
      }
      if (segments.length === 0) {
          const activeSettings = getActivePlotEditorSettings_ACU() || settings_ACU?.plotSettings;
          ensurePlotPromptGroup_ACU(activeSettings);
          segments = JSON.parse(JSON.stringify(activeSettings?.promptGroup || []));
      }

      const getMainSlot = (seg: any) => {
          if (!seg) return '';
          const slot = String(seg.mainSlot || '').toUpperCase();
          if (slot === 'A' || slot === 'B') return slot;
          if (seg.isMain) return 'A';
          if (seg.isMain2) return 'B';
          return '';
      };

      segments.forEach((segment: any, index: number) => {
          const roleUpper = String(segment?.role || '').toUpperCase();
          const roleLower = String(segment?.role || '').toLowerCase();
          const mainSlot = getMainSlot(segment);
          const isMainA = mainSlot === 'A';
          const isMainB = mainSlot === 'B';
          const isMainPrompt = isMainA || isMainB;
          const borderColor = isMainA ? 'var(--accent-primary)' : (isMainB ? '#ffb74d' : '');
          const segmentId = `${SCRIPT_ID_PREFIX_ACU}-plot-prompt-segment-${index}`;

          const segmentHtml = `
              <div class="plot-prompt-segment" id="${segmentId}" data-main-slot="${escapeHtml_ACU(mainSlot)}" ${isMainPrompt ? `style="border-left: 3px solid ${borderColor};"` : ''}>
                  <div class="plot-prompt-segment-toolbar">
                      <div style="display:flex; align-items:center; gap:8px;">
                          <select class="plot-prompt-segment-role">
                              <option value="assistant" ${roleUpper === 'AI' || roleUpper === 'ASSISTANT' || roleLower === 'assistant' ? 'selected' : ''}>AI</option>
                              <option value="SYSTEM" ${roleUpper === 'SYSTEM' || roleLower === 'system' ? 'selected' : ''}>系统</option>
                              <option value="USER" ${roleUpper === 'USER' || roleLower === 'user' ? 'selected' : ''}>用户</option>
                          </select>
                          <label style="display:flex; align-items:center; gap:6px; font-size:0.8em; cursor:pointer; user-select:none;" title="用于兼容旧预设的A/B槽位。A/B 均不可删除；但运行时不会再对其进行自动替换，完全由本提示词组决定。">
                              <span style="opacity:0.85;">主提示词</span>
                              <select class="plot-prompt-segment-main-slot" style="font-size:0.85em;">
                                  <option value="" ${!isMainPrompt ? 'selected' : ''}>普通</option>
                                  <option value="A" ${isMainA ? 'selected' : ''}>A(建议System)</option>
                                  <option value="B" ${isMainB ? 'selected' : ''}>B(建议User)</option>
                              </select>
                          </label>
                      </div>
                      <button class="plot-prompt-segment-delete-btn" data-index="${index}" style="${isMainPrompt ? 'display:none;' : ''}">-</button>
                  </div>
                  <textarea class="plot-prompt-segment-content" rows="4">${escapeHtml_ACU(segment.content)}</textarea>
              </div>
          `;
          $plotPromptSegmentsContainer_ACU.append(segmentHtml);
      });
  }

  export function getPlotPromptGroupFromUI_ACU() {
      if (!$plotPromptSegmentsContainer_ACU) return [];
      const segments: any[] = [];
      $plotPromptSegmentsContainer_ACU.find('.plot-prompt-segment').each(function() {
          const $segment = jQuery_API_ACU(this);
          const role = $segment.find('.plot-prompt-segment-role').val();
          const content = $segment.find('.plot-prompt-segment-content').val();
          const mainSlotRaw = $segment.find('.plot-prompt-segment-main-slot').val();
          const mainSlot = String(mainSlotRaw || '').toUpperCase();
          const isMainA = mainSlot === 'A';
          const isMainB = mainSlot === 'B';

          // 主提示词A/B不可删除
          const isDeletable = (isMainA || isMainB) ? false : true;

          const segmentData: any = { role: role, content: content, deletable: isDeletable };
          if (isMainA) {
              segmentData.mainSlot = 'A';
              segmentData.isMain = true;
          } else if (isMainB) {
              segmentData.mainSlot = 'B';
              segmentData.isMain2 = true;
          }
          segments.push(segmentData);
      });
      return segments;
  }

  export function normalizePlotTaskListForEditor_ACU(tasks: any[]) {
      return (Array.isArray(tasks) ? tasks : []).map((task: any, index: number) => normalizePlotTask_ACU({
          ...(task || {}),
          order: index,
      }, {
          index,
          fallbackTask: task || null,
      }));
  }

  export function getPrimaryPlotTask_ACU(plotSettings: Record<string, any>) {
      const tasks = Array.isArray(plotSettings?.plotTasks) ? plotSettings.plotTasks : normalizePlotTasks_ACU(plotSettings);
      return tasks.find((task: any) => task && task.enabled !== false) || tasks[0] || null;
  }

  export function syncLegacyPlotSettingsFromPrimaryTask_ACU(plotSettings: Record<string, any>) {
      if (!plotSettings || typeof plotSettings !== 'object') return null;
      const primaryTask = getPrimaryPlotTask_ACU(plotSettings);
      if (primaryTask) {
          syncLegacyPlotSettingsFromTask_ACU(plotSettings, primaryTask);
      }
      return primaryTask;
  }

  export function getCurrentPlotTaskEditorState_ACU(plotSettings = settings_ACU?.plotSettings, { autoSelect = true } = {}) {
      if (!plotSettings || typeof plotSettings !== 'object') {
          return { tasks: [], selectedTask: null, selectedIndex: -1 };
      }

      ensurePlotTasksCompat_ACU(plotSettings, { syncLegacy: false });
      const tasks = Array.isArray(plotSettings.plotTasks) ? plotSettings.plotTasks : [];
      if (!tasks.length) {
          _set_currentPlotTaskEditorId_ACU('');
          return { tasks: [], selectedTask: null, selectedIndex: -1 };
      }

      let selectedIndex = tasks.findIndex((task: any) => task && task.id === currentPlotTaskEditorId_ACU);
      if (selectedIndex === -1 && autoSelect) {
          const fallbackTask = tasks.find((task: any) => task && task.enabled !== false) || tasks[0];
          selectedIndex = tasks.indexOf(fallbackTask);
          _set_currentPlotTaskEditorId_ACU(fallbackTask?.id || '');
      }

      const selectedTask = selectedIndex >= 0 ? tasks[selectedIndex] : null;
      if (selectedTask?.id) {
          _set_currentPlotTaskEditorId_ACU(selectedTask.id);
      }

      return { tasks, selectedTask, selectedIndex };
  }

  export function renderPlotTaskList_ACU(plotSettings = getActivePlotEditorSettings_ACU()) {
      if (!$popupInstance_ACU) return;
      if (!$plotTaskListContainer_ACU || !$plotTaskListContainer_ACU.length) {
          _assignUIPlaceholders_ACU({ $plotTaskListContainer_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-task-list`) });
      }
      if (!$plotTaskListContainer_ACU || !$plotTaskListContainer_ACU.length) return;

      const { tasks, selectedTask } = getCurrentPlotTaskEditorState_ACU(plotSettings, { autoSelect: true });
      $plotTaskListContainer_ACU.empty();

      if (!tasks.length) {
          $plotTaskListContainer_ACU.append('<div class="notes" style="padding: 10px 12px;">暂无剧情任务</div>');
          return;
      }

      tasks.forEach((task: any, index: number) => {
          const isSelected = selectedTask?.id === task.id;
          const enabledText = task.enabled !== false ? '启用' : '停用';
          const enabledColor = task.enabled !== false ? 'var(--green)' : 'var(--red)';
          const stageNo = normalizePositiveInteger_ACU(task?.stage, 1);
          const itemHtml = `
              <button type="button" class="button acu-plot-task-item ${isSelected ? 'acu-plot-task-item--active' : ''}" data-task-id="${escapeHtml_ACU(task.id)}" style="display:flex; width:100%; align-items:center; justify-content:space-between; gap:12px; margin-bottom:8px; padding:10px 12px; text-align:left; border:${isSelected ? '1px solid var(--accent-primary)' : '1px solid var(--border_color_light)'}; background:${isSelected ? 'color-mix(in srgb, var(--accent-primary) 12%, var(--background_default))' : 'var(--background_default)'}; border-radius:8px;">
                  <span style="display:flex; flex-direction:column; gap:4px; min-width:0;">
                      <span style="font-weight:600; color:var(--text_primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${index + 1}. ${escapeHtml_ACU(task.name || task.id || `剧情任务${index + 1}`)}</span>
                      <span class="notes" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">阶段：${stageNo} · 标签：${escapeHtml_ACU(task.extractTags || '(未设置)')}</span>
                  </span>
                  <span style="flex-shrink:0; font-size:0.8em; color:${enabledColor};">${enabledText}${isSelected ? ' · 编辑中' : ''}</span>
              </button>
          `;
          $plotTaskListContainer_ACU.append(itemHtml);
      });
  }

  export function loadCurrentPlotTaskToUI_ACU(plotSettings = getActivePlotEditorSettings_ACU()) {
      if (!$popupInstance_ACU) return;
      const { selectedTask } = getCurrentPlotTaskEditorState_ACU(plotSettings, { autoSelect: true });
      if (!selectedTask) {
          renderPlotPromptSegments_ACU(JSON.parse(JSON.stringify(getPlotPromptGroupFromSource_ACU(plotSettings))));
          $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-task-name`).val('');
          $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-task-enabled`).prop('checked', true);
          $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-extract-tags`).val('');
          $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-extract-inject-tags`).val('');
          $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-min-length`).val(plotSettings?.minLength ?? 0);
          $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-task-stage`).val(1);
          $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-task-max-retries`).val(plotSettings?.loopSettings?.maxRetries ?? DEFAULT_PLOT_SETTINGS_ACU.loopSettings?.maxRetries ?? 3);
          $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-task-api-preset`).val('');
          return;
      }

      renderPlotPromptSegments_ACU(JSON.parse(JSON.stringify(selectedTask.promptGroup || [])));
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-task-name`).val(selectedTask.name || '');
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-task-enabled`).prop('checked', selectedTask.enabled !== false);
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-extract-tags`).val(selectedTask.extractTags || '');
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-extract-inject-tags`).val(selectedTask.extractInjectTags || '');
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-min-length`).val(selectedTask.minLength ?? 0);
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-task-stage`).val(normalizePositiveInteger_ACU(selectedTask.stage, 1));
      $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-task-max-retries`).val(selectedTask.maxRetries ?? DEFAULT_PLOT_SETTINGS_ACU.loopSettings?.maxRetries ?? 3);
      setPlotTaskApiPresetSelectValue_ACU(selectedTask);
  }

  export function refreshCurrentPlotTaskApiPresetSelect_ACU(plotSettings = getActivePlotEditorSettings_ACU()) {
      if (!$popupInstance_ACU || !plotSettings) return;
      const { selectedTask } = getCurrentPlotTaskEditorState_ACU(plotSettings, { autoSelect: true });
      if (!selectedTask) {
          $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-task-api-preset`).val('');
          return;
      }
      setPlotTaskApiPresetSelectValue_ACU(selectedTask);
  }

function persistPlotTaskEditorSettings_ACU(source = 'ui_task_edit') {
      if (currentEditablePlotPresetState_ACU?.scope === 'global') {
          saveSettingsAndNotify_ACU();
          return;
      }
      persistCurrentChatPlotEditorSnapshot_ACU({ source, save: true });
  }

  export function saveCurrentPlotTaskFromUI_ACU({ silent = false, renderTaskList = false, persist = true } = {}) {
      if (!$popupInstance_ACU) return null;
      const plotSettings = getActivePlotEditorSettings_ACU();
      if (!plotSettings) return null;
      const { tasks, selectedTask, selectedIndex } = getCurrentPlotTaskEditorState_ACU(plotSettings, { autoSelect: true });
      if (!selectedTask || selectedIndex < 0) return null;

      const taskNameRaw = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-task-name`).val();
      const taskExtractTagsRaw = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-extract-tags`).val();
      const taskExtractInjectTagsRaw = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-extract-inject-tags`).val();
      const taskMinLengthRaw = parseInt($popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-min-length`).val() as string, 10);
      const taskStageRaw = parseInt($popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-task-stage`).val() as string, 10);
      const taskMaxRetriesRaw = parseInt($popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-task-max-retries`).val() as string, 10);
      const updatedTask = normalizePlotTask_ACU({
          ...stripRuntimeOnlyPlotTaskFields_ACU(selectedTask),
          name: String(taskNameRaw || '').trim() || selectedTask.name || `剧情任务${selectedIndex + 1}`,
          enabled: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-task-enabled`).is(':checked'),
          promptGroup: getPlotPromptGroupFromUI_ACU(),
          extractTags: String(taskExtractTagsRaw || ''),
          extractInjectTags: String(taskExtractInjectTagsRaw || ''),
          minLength: Number.isFinite(taskMinLengthRaw) ? taskMinLengthRaw : selectedTask.minLength,
          stage: Number.isFinite(taskStageRaw) && taskStageRaw > 0
              ? taskStageRaw
              : selectedTask.stage,
          maxRetries: Number.isFinite(taskMaxRetriesRaw) && taskMaxRetriesRaw > 0
              ? taskMaxRetriesRaw
              : selectedTask.maxRetries,
          order: selectedTask.order ?? selectedIndex,
      }, {
          index: selectedIndex,
          fallbackTask: selectedTask,
      });

      const nextTasks = normalizePlotTaskListForEditor_ACU(tasks.map((task: any, index: number) => index === selectedIndex ? updatedTask : task));
      plotSettings.plotTasks = nextTasks;
      _set_currentPlotTaskEditorId_ACU(updatedTask.id);
      syncLegacyPlotSettingsFromPrimaryTask_ACU(plotSettings);

      if (persist) {
          persistPlotTaskEditorSettings_ACU('ui_task_edit');
      }
      if (renderTaskList) renderPlotTaskList_ACU(plotSettings);
      if (!silent) showToastr_ACU('success', '当前剧情任务已保存。');
      return updatedTask;
  }

  export function saveCurrentPlotTaskApiPresetFromUI_ACU({ persist = true } = {}) {
      if (!$popupInstance_ACU) return false;
      const plotSettings = getActivePlotEditorSettings_ACU();
      if (!plotSettings) return false;
      const { selectedTask } = getCurrentPlotTaskEditorState_ACU(plotSettings, { autoSelect: true });
      const taskId = String(selectedTask?.id || currentPlotTaskEditorId_ACU || '').trim();
      if (!taskId) return false;

      const taskApiPresetRaw = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-plot-task-api-preset`).val();
      setPlotTaskApiPresetInGlobalSettings_ACU(taskId, taskApiPresetRaw);
      if (persist) {
          persistPlotTaskApiPresetOverride_ACU('ui_task_api_preset');
      }
      return true;
  }

  export function flushCurrentPlotTaskEditorState_ACU({ renderTaskList = false, persist = true } = {}) {
      clearTimeout(plotTaskEditorAutoSaveTimer_ACU);
      return saveCurrentPlotTaskFromUI_ACU({ silent: true, renderTaskList, persist });
  }

  export function buildNewPlotTaskForUI_ACU(plotSettings = getActivePlotEditorSettings_ACU()) {
      const tasks = Array.isArray(plotSettings?.plotTasks) ? plotSettings.plotTasks : [];
      const defaultStage = normalizePositiveInteger_ACU(tasks[tasks.length - 1]?.stage, 1);
      let serial = tasks.length + 1;
      let taskId = `plotTask${serial}`;
      while (tasks.some((task: any) => task && task.id === taskId)) {
          serial += 1;
          taskId = `plotTask${serial}`;
      }
      return normalizePlotTask_ACU({
          id: taskId,
          name: `剧情任务${tasks.length + 1}`,
          enabled: true,
          promptGroup: buildDefaultPlotPromptGroup_ACU(),
          extractTags: DEFAULT_PLOT_SETTINGS_ACU.extractTags || '',
          minLength: 0,
          stage: defaultStage,
          maxRetries: plotSettings?.loopSettings?.maxRetries ?? DEFAULT_PLOT_SETTINGS_ACU.loopSettings?.maxRetries ?? 3,
          order: tasks.length,
      }, { index: tasks.length });
  }

  export function schedulePlotTaskAutoSave_ACU({ renderTaskList = true } = {}) {
      clearTimeout(plotTaskEditorAutoSaveTimer_ACU);
      plotTaskEditorAutoSaveTimer_ACU = setTimeout(() => {
          saveCurrentPlotTaskFromUI_ACU({ silent: true, renderTaskList, persist: true });
      }, 300);
  }

  export function selectPlotTaskForEditing_ACU(taskId: string, { saveCurrent = true } = {}) {
      const plotSettings = getActivePlotEditorSettings_ACU();
      if (!plotSettings || !taskId) return;
      if (saveCurrent) {
          saveCurrentPlotTaskFromUI_ACU({ silent: true, renderTaskList: false, persist: true });
      }
      _set_currentPlotTaskEditorId_ACU(String(taskId));
      renderPlotTaskList_ACU(plotSettings);
      loadCurrentPlotTaskToUI_ACU(plotSettings);
  }

  export function addPlotTaskFromUI_ACU() {
      const plotSettings = getActivePlotEditorSettings_ACU();
      if (!plotSettings) return;
      saveCurrentPlotTaskFromUI_ACU({ silent: true, renderTaskList: false, persist: true });
      const nextTasks = normalizePlotTaskListForEditor_ACU([
          ...(Array.isArray(plotSettings.plotTasks) ? plotSettings.plotTasks : []),
          buildNewPlotTaskForUI_ACU(plotSettings),
      ]);
      plotSettings.plotTasks = nextTasks;
      _set_currentPlotTaskEditorId_ACU(nextTasks[nextTasks.length - 1]?.id || currentPlotTaskEditorId_ACU);
      syncLegacyPlotSettingsFromPrimaryTask_ACU(plotSettings);
      persistPlotTaskEditorSettings_ACU('ui_task_add');
      renderPlotTaskList_ACU(plotSettings);
      loadCurrentPlotTaskToUI_ACU(plotSettings);
      showToastr_ACU('success', '已新增一个剧情任务。');
  }

  export function deleteCurrentPlotTaskFromUI_ACU() {
      const plotSettings = getActivePlotEditorSettings_ACU();
      if (!plotSettings) return;
      const { tasks, selectedTask, selectedIndex } = getCurrentPlotTaskEditorState_ACU(plotSettings, { autoSelect: true });
      if (!selectedTask || selectedIndex < 0) return;
      if (tasks.length <= 1) {
          showToastr_ACU('warning', '至少需要保留一个剧情任务。');
          return;
      }
      if (!confirm(`确定要删除剧情任务"${selectedTask.name || selectedTask.id}"吗？`)) {
          return;
      }

      const nextTasks = normalizePlotTaskListForEditor_ACU(tasks.filter((_: any, index: number) => index !== selectedIndex));
      const fallbackIndex = Math.min(selectedIndex, nextTasks.length - 1);
      plotSettings.plotTasks = nextTasks;
      _set_currentPlotTaskEditorId_ACU(nextTasks[fallbackIndex]?.id || nextTasks[0]?.id || '');
      syncLegacyPlotSettingsFromPrimaryTask_ACU(plotSettings);
      persistPlotTaskEditorSettings_ACU('ui_task_delete');
      renderPlotTaskList_ACU(plotSettings);
      loadCurrentPlotTaskToUI_ACU(plotSettings);
      showToastr_ACU('success', '剧情任务已删除。');
  }

  export function moveCurrentPlotTask_ACU(direction: string) {
      const plotSettings = getActivePlotEditorSettings_ACU();
      if (!plotSettings) return;
      const { tasks, selectedTask, selectedIndex } = getCurrentPlotTaskEditorState_ACU(plotSettings, { autoSelect: true });
      if (!selectedTask || selectedIndex < 0) return;

      const offset = direction === 'up' ? -1 : 1;
      const targetIndex = selectedIndex + offset;
      if (targetIndex < 0 || targetIndex >= tasks.length) return;

      saveCurrentPlotTaskFromUI_ACU({ silent: true, renderTaskList: false, persist: true });
      const reordered = [...plotSettings.plotTasks];
      const [movedTask] = reordered.splice(selectedIndex, 1);
      reordered.splice(targetIndex, 0, movedTask);
      plotSettings.plotTasks = normalizePlotTaskListForEditor_ACU(reordered);
      _set_currentPlotTaskEditorId_ACU(movedTask?.id || currentPlotTaskEditorId_ACU);
      syncLegacyPlotSettingsFromPrimaryTask_ACU(plotSettings);
      persistPlotTaskEditorSettings_ACU('ui_task_move');
      renderPlotTaskList_ACU(plotSettings);
      loadCurrentPlotTaskToUI_ACU(plotSettings);
  }


// 运行时可变状态统一归 service/runtime/state-manager 所有；此处仅保留兼容导出。
export {
  isAutoUpdatingCard_ACU, wasStoppedByUser_ACU,
  contentOptimizationDebounceTimer_ACU, chatMutationDebounceTimer_ACU,
  currentAbortController_ACU, activeAbortControllers_ACU,
  manualExtraHint_ACU, trackAbortController_ACU, untrackAbortController_ACU,
  abortAllActiveRequests_ACU, _set_currentAbortController_ACU, _set_isAutoUpdatingCard_ACU,
  _set_manualExtraHint_ACU, _set_wasStoppedByUser_ACU,
  _set_contentOptimizationDebounceTimer_ACU, _set_chatMutationDebounceTimer_ACU,
};