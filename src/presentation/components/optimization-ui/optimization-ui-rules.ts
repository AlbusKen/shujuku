/**
 * presentation/components/optimization-ui/optimization-ui-rules.ts
 * 排除规则 + 循环提示词 UI
 */
import { activePlotEditorSettings_ACU, buildDefaultPlotPromptGroup_ACU, currentEditablePlotPresetState_ACU, currentPlotTaskEditorId_ACU, ensurePlotPromptGroup_ACU , _set_currentEditablePlotPresetState_ACU, _set_activePlotEditorSettings_ACU, _set_currentPlotTaskEditorId_ACU} from '../../../service/plot/plot-state';
import { showToastr_ACU } from '../../theme/toast';
import { getChatArray_ACU, saveChatToHost_ACU, setChatMessages_ACU, emitMessageUpdated_ACU } from '../../../service/chat/chat-service';
import { jQuery_API_ACU } from '../../dom-utils';
import { $popupInstance_ACU } from '../../state/ui-refs';
import { buildChatPlotScopeStateFromSettings_ACU, clearCurrentChatPlotScopeState_ACU, getCurrentChatPlotScopeState_ACU, sanitizePlotSettingsSnapshotForChat_ACU, setCurrentChatPlotScopeState_ACU } from '../../../service/template/chat-scope';
import { escapeHtml_ACU } from '../../../shared/html-helpers';
import { cleanChatName_ACU, logDebug_ACU, logError_ACU, logWarn_ACU, normalizeExcludeRules_ACU, normalizeExtractRules_ACU, normalizeNonNegativeInteger_ACU, normalizePositiveInteger_ACU } from '../../../shared/utils';
import { triggerAutomaticUpdateIfNeeded_ACU } from '../../triggers/settings-ui-sync';
import { cancelContentOptimization_ACU, contentOptimizationAbortRequested_ACU, ensureOptimizationNotCancelled_ACU, getLastOptimizationBase_ACU, optimizationProgressToast_ACU, performContentOptimization_ACU, setLastOptimizationBase_ACU, _set_optimizationProgressToast_ACU, _set_contentOptimizationAbortRequested_ACU } from '../../../service/optimization/content-optimization';
import { applyContextTagFilters_ACU } from '../../../service/runtime/helpers-remaining';
import { getActivePlotEditorSettings_ACU } from '../../../service/plot/plot-logic';


  function schedulePlotSettingsUiRefresh_ACU(plotSettingsOverride: any = null) {
    if (!$popupInstance_ACU || !$popupInstance_ACU.length) return;
 
    const refreshTarget = plotSettingsOverride || getActivePlotEditorSettings_ACU();
    const $targetPopup = $popupInstance_ACU;
    const runRefresh = () => {
      if (!$popupInstance_ACU || !$popupInstance_ACU.length) return;
      if (!$targetPopup || !$targetPopup.length) return;
      $targetPopup.triggerHandler('acu_plot_settings_refresh', [refreshTarget]);
    };
 
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => window.requestAnimationFrame(runRefresh));
      return;
    }
 
    setTimeout(runRefresh, 0);
  }

  export function renderExcludeRuleRows_ACU(containerSelector: string, rules: any, { startPlaceholder = '开始词', endPlaceholder = '结束词', fallbackRules = [] as any[] } = {}) {
    if (!$popupInstance_ACU) return;
    const $container = $popupInstance_ACU.find(containerSelector);
    if (!$container.length) return;

    let normalized = normalizeExcludeRules_ACU(rules, '');
    if (normalized.length === 0 && Array.isArray(fallbackRules) && fallbackRules.length > 0) {
      normalized = normalizeExcludeRules_ACU(fallbackRules, '');
    }
    $container.empty();

    const appendRow = (rule: any = {}) => {
      const rowHtml = `
        <div class="acu-exclude-rule-row" style="display:flex; gap:8px; margin-bottom:6px; align-items:center;">
          <input type="text" class="text_pole acu-exclude-rule-start" placeholder="${escapeHtml_ACU(startPlaceholder)}" style="flex:1;" value="${escapeHtml_ACU(rule.start || '')}">
          <input type="text" class="text_pole acu-exclude-rule-end" placeholder="${escapeHtml_ACU(endPlaceholder)}" style="flex:1;" value="${escapeHtml_ACU(rule.end || '')}">
          <button type="button" class="button acu-exclude-rule-delete" title="删除规则" style="padding:4px 8px;">删除</button>
        </div>
      `;
      $container.append(rowHtml);
    };

    const rows = normalized.length > 0 ? normalized : [{ start: '', end: '' }];
    rows.forEach(rule => appendRow(rule));
  }

  export function appendExcludeRuleRow_ACU(containerSelector: string, { startPlaceholder = '开始词', endPlaceholder = '结束词' } = {}) {
    if (!$popupInstance_ACU) return;
    const $container = $popupInstance_ACU.find(containerSelector);
    if (!$container.length) return;
    const rowHtml = `
      <div class="acu-exclude-rule-row" style="display:flex; gap:8px; margin-bottom:6px; align-items:center;">
        <input type="text" class="text_pole acu-exclude-rule-start" placeholder="${escapeHtml_ACU(startPlaceholder)}" style="flex:1;" value="">
        <input type="text" class="text_pole acu-exclude-rule-end" placeholder="${escapeHtml_ACU(endPlaceholder)}" style="flex:1;" value="">
        <button type="button" class="button acu-exclude-rule-delete" title="删除规则" style="padding:4px 8px;">删除</button>
      </div>
    `;
    $container.append(rowHtml);
  }

  export function readExcludeRulesFromRows_ACU(containerSelector: string) {
    if (!$popupInstance_ACU) return [];
    const $container = $popupInstance_ACU.find(containerSelector);
    if (!$container.length) return [];
    const collected: any[] = [];
    $container.find('.acu-exclude-rule-row').each(function() {
      const start = String(jQuery_API_ACU(this).find('.acu-exclude-rule-start').val() || '').trim();
      const end = String(jQuery_API_ACU(this).find('.acu-exclude-rule-end').val() || '').trim();
      if (start && end) collected.push({ start, end });
    });
    return normalizeExcludeRules_ACU(collected, '');
  }
