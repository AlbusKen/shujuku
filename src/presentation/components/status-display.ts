import { DEFAULT_MERGE_SUMMARY_PROMPT_ACU, DEFAULT_MERGE_SUMMARY_PROMPT_SQL_ACU } from '../../shared/defaults-json.js';
import { isSqliteMode } from '../../service/table/storage-mode';
import { getCurrentWorldbookConfig_ACU } from '../../service/settings/settings-readers';
import { getCurrentVectorMemoryConfig_ACU } from '../../service/vector/vector-memory-config';
import { getAggregatedSummaryVectorIndexSnapshot_ACU } from '../../service/vector/summary-vector-index-state-service';
import { renderPromptSegments_ACU } from './plot-editors';
import { renderKeywordPromptGroupToUI_ACU, renderSummaryPromptGroupToUI_ACU } from '../pages/popup-bindings-worldbook';
import { renderImportTableSelector_ACU, renderManualTableSelector_ACU } from './table-selector';
import { SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';
import { escapeHtml_ACU } from '../../shared/html-helpers';
import { normalizeExcludeRules_ACU, normalizeExtractRules_ACU } from '../../shared/utils';
import { renderExcludeRuleRows_ACU } from './optimization-ui';
import { populateInjectionTargetSelector_ACU, updateWorldbookSourceView_ACU } from './worldbook-selector';
import { updateApiModeView_ACU, updateApiStatusDisplay_ACU, updateCustomApiInputsState_ACU } from '../triggers/settings-ui-sync';
import { jQuery_API_ACU } from '../dom-utils';
import { $popupInstance_ACU, $statusMessageSpan_ACU, $manualUpdateCardButton_ACU, $customApiUrlInput_ACU, $customApiKeyInput_ACU, $maxTokensInput_ACU, $temperatureInput_ACU, $customApiModelInput_ACU, $customApiModelSelect_ACU, $charCardPromptSegmentsContainer_ACU, $autoUpdateThresholdInput_ACU, $autoUpdateFrequencyInput_ACU, $autoUpdateTokenThresholdInput_ACU, $updateBatchSizeInput_ACU, $maxConcurrentGroupsInput_ACU, $skipUpdateFloorsInput_ACU, $retainRecentLayersInput_ACU, $autoUpdateEnabledCheckbox_ACU, $standardizedTableFillEnabledCheckbox_ACU, $toastMuteEnabledCheckbox_ACU, $promptTemplateEnabledCheckbox_ACU, $tableEditLastPairOnlyCheckbox_ACU, $tableMaxRetriesInput_ACU, $useMainApiCheckbox_ACU, $streamingEnabledCheckbox_ACU, $manualTableSelector_ACU, $importTableSelector_ACU, _assignUIPlaceholders_ACU } from '../state/ui-refs';
// status-display.ts — 对应源文件有跨文件依赖，保留在原位

  // [T172] 可视化编辑器刷新通知（从 service/worldbook/pipeline.ts 提取）
  function notifyVisualizerRefresh_ACU() {
    try { jQuery_API_ACU(document).trigger('acu-visualizer-refresh-data'); } catch(e) {}
  }

  // [T173] 填表状态消息更新
  function updateTableFillStatus_ACU(text: string) {
    if (!$statusMessageSpan_ACU && $popupInstance_ACU)
        _assignUIPlaceholders_ACU({ $statusMessageSpan_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-status-message`) });
    if ($statusMessageSpan_ACU) $statusMessageSpan_ACU.text(text);
  }

  const MANUAL_UPDATE_VECTOR_SOFT_DISABLED_CLASS_ACU = 'acu-manual-update-vector-soft-disabled';
 
  export function isVectorMemoryManualUpdateBlocked_ACU() {
    try {
        return getCurrentWorldbookConfig_ACU().summaryVectorIndexModeEnabled === true;
    } catch (e) {
        return false;
    }
  }
 
  export function shouldShowVectorMemoryManualUpdateWarning_ACU() {
    return isVectorMemoryManualUpdateBlocked_ACU();
  }
 
  export function syncManualUpdateButtonAvailability_ACU() {
    if (!$manualUpdateCardButton_ACU) return;
  
    if (shouldShowVectorMemoryManualUpdateWarning_ACU()) {
        $manualUpdateCardButton_ACU
            .prop('disabled', false)
            .addClass(MANUAL_UPDATE_VECTOR_SOFT_DISABLED_CLASS_ACU)
            .text('交火索引已启用')
            .attr('title', '交火模式纪要索引启用时不建议手动更新表格；特殊场景下仍可点击执行。');
        return;
    }
  
    $manualUpdateCardButton_ACU
        .prop('disabled', false)
        .removeClass(MANUAL_UPDATE_VECTOR_SOFT_DISABLED_CLASS_ACU)
        .text('立即手动更新')
        .removeAttr('title');
  }

  // [T173] 填表停止按钮绑定
  export function bindTableFillStopButton_ACU(buttonId: string, onStop: any) {
    const $stopButton = jQuery_API_ACU(`#${buttonId}`);
    if ($stopButton.length) {
        $stopButton.off('click.acu_stop').on('click.acu_stop', function(e) {
            e.stopPropagation();
            e.preventDefault();
            syncManualUpdateButtonAvailability_ACU();
            jQuery_API_ACU(this).closest('.toast').remove();
            if (typeof onStop === 'function') onStop();
        });
    }
  }

  // [T173] 重置手动更新按钮状态
  export function resetManualUpdateButton_ACU() {
    syncManualUpdateButtonAvailability_ACU();
  }

  // [T174] 更新聊天标题显示
  function updateChatTitleDisplay_ACU(chatIdentifier: string) {
    if (!$popupInstance_ACU) return;
    const $titleElement = $popupInstance_ACU.find('h2#updater-main-title-acu');
    if ($titleElement.length)
        $titleElement.html(`当前聊天：${escapeHtml_ACU(chatIdentifier || '未知')}`);
  }

  // [T175] 检查弹窗是否打开（供 service 层用布尔判断，不暴露 DOM 引用）
  function isPopupOpen_ACU() {
    return !!$popupInstance_ACU;
  }

  // [T178] 将删除设置同步到 UI。合并总结 UI 已停用，不再同步 merge/auto-merge 控件。
  export function syncMergeSettingsToUI_ACU(s: any) {
    if (!$popupInstance_ACU) return;
    const find = (id: string) => $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-${id}`);
    const setVal = (id: string, v: any) => { const $el = find(id); if ($el.length) $el.val(v); };
    setVal('delete-start-floor', s.deleteStartFloor || 1);
    setVal('delete-end-floor', s.deleteEndFloor || '');
  }

  // [T179] 将全部设置同步到 UI（从 service/settings/settings-service.ts 提取）
  export function syncAllSettingsToUI_ACU(s: any) {
      if (!$popupInstance_ACU) return;
      if ($customApiUrlInput_ACU) $customApiUrlInput_ACU.val(s.apiConfig.url);
      if ($customApiKeyInput_ACU) $customApiKeyInput_ACU.val(s.apiConfig.apiKey);
      if ($maxTokensInput_ACU) $maxTokensInput_ACU.val(s.apiConfig.max_tokens);
      if ($temperatureInput_ACU) $temperatureInput_ACU.val(s.apiConfig.temperature);
      if ($customApiModelInput_ACU) $customApiModelInput_ACU.val(s.apiConfig.model || '');
      if ($customApiModelSelect_ACU) {
          $customApiModelSelect_ACU.empty().append('<option value="">-- 请先加载模型列表 --</option>');
          if (s.apiConfig.model) {
              $customApiModelSelect_ACU.append(`<option value="${escapeHtml_ACU(s.apiConfig.model)}">${escapeHtml_ACU(s.apiConfig.model)}</option>`);
          }
      }
      if (typeof updateApiStatusDisplay_ACU === 'function') updateApiStatusDisplay_ACU();
      if ($charCardPromptSegmentsContainer_ACU) {
          const promptForCurrentMode = s.strictJsonTableFillEnabled === true
              ? (s.storageMode === 'sqlite' ? s.strictJsonSqlCharCardPrompt : s.strictJsonCharCardPrompt)
              : s.charCardPrompt;
          renderPromptSegments_ACU(promptForCurrentMode || s.charCardPrompt);
      }
      if ($autoUpdateThresholdInput_ACU) $autoUpdateThresholdInput_ACU.val(s.autoUpdateThreshold);
      if ($autoUpdateFrequencyInput_ACU) $autoUpdateFrequencyInput_ACU.val(s.autoUpdateFrequency);
      if ($autoUpdateTokenThresholdInput_ACU) $autoUpdateTokenThresholdInput_ACU.val(s.autoUpdateTokenThreshold);
      if ($updateBatchSizeInput_ACU) $updateBatchSizeInput_ACU.val(s.updateBatchSize);
      if ($maxConcurrentGroupsInput_ACU) $maxConcurrentGroupsInput_ACU.val(s.maxConcurrentGroups || 1);
      if ($skipUpdateFloorsInput_ACU) $skipUpdateFloorsInput_ACU.val(s.skipUpdateFloors || 0);
      if ($retainRecentLayersInput_ACU) $retainRecentLayersInput_ACU.val(s.retainRecentLayers || '');
      if (typeof renderExcludeRuleRows_ACU === 'function') {
          renderExcludeRuleRows_ACU(`#${SCRIPT_ID_PREFIX_ACU}-table-context-extract-rules`, normalizeExtractRules_ACU(s.tableContextExtractRules, s.tableContextExtractTags || ''), { startPlaceholder: '开始词（例如：<think）', endPlaceholder: '结束词（例如：</think>）' });
          renderExcludeRuleRows_ACU(`#${SCRIPT_ID_PREFIX_ACU}-table-context-exclude-rules`, normalizeExcludeRules_ACU(s.tableContextExcludeRules, s.tableContextExcludeTags || ''), { startPlaceholder: '开始词（例如：<thinking）', endPlaceholder: '结束词（例如：</thinking>）' });
      }
      const find = (id: string) => $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-${id}`);
      const setVal = (id: string, v: any) => { const $el = find(id); if ($el.length) $el.val(v); };
      const setChecked = (id: string, v: any) => { const $el = find(id); if ($el.length) $el.prop('checked', !!v); };
      setVal('import-split-size', s.importSplitSize);
      setChecked('import-prompt-exclude-imported-worldbook-entries', s.importPromptExcludeImportedWorldbookEntries !== false);
      if ($autoUpdateEnabledCheckbox_ACU) $autoUpdateEnabledCheckbox_ACU.prop('checked', s.autoUpdateEnabled);
      if ($standardizedTableFillEnabledCheckbox_ACU) $standardizedTableFillEnabledCheckbox_ACU.prop('checked', s.standardizedTableFillEnabled !== false);
      if ($toastMuteEnabledCheckbox_ACU) $toastMuteEnabledCheckbox_ACU.prop('checked', !!s.toastMuteEnabled);
      if ($promptTemplateEnabledCheckbox_ACU) $promptTemplateEnabledCheckbox_ACU.prop('checked', s.promptTemplateSettings?.enabled !== false);
      if ($tableEditLastPairOnlyCheckbox_ACU) $tableEditLastPairOnlyCheckbox_ACU.prop('checked', s.tableEditLastPairOnly !== false);
      if ($tableMaxRetriesInput_ACU) $tableMaxRetriesInput_ACU.val(s.tableMaxRetries || 3);
      syncMergeSettingsToUI_ACU(s);
      const worldbookConfig = getCurrentWorldbookConfig_ACU();
      const vectorMemoryConfig = getCurrentVectorMemoryConfig_ACU();
      const summaryVectorIndexEnabled = worldbookConfig.summaryVectorIndexModeEnabled === true;
      $popupInstance_ACU.find(`input[name="${SCRIPT_ID_PREFIX_ACU}-worldbook-source"]`).filter(`[value="${worldbookConfig.source}"]`).prop('checked', true);
      if (typeof updateWorldbookSourceView_ACU === 'function') updateWorldbookSourceView_ACU();
      if (typeof populateInjectionTargetSelector_ACU === 'function') populateInjectionTargetSelector_ACU();
      setChecked('worldbook-vector-memory-enabled', summaryVectorIndexEnabled);
      setVal('worldbook-vector-memory-threshold', vectorMemoryConfig.threshold);
      setVal('worldbook-vector-memory-archive-trigger-count', (vectorMemoryConfig as any).archiveTriggerCount || vectorMemoryConfig.archiveBatchSize);
      setVal('worldbook-vector-memory-archive-batch-size', vectorMemoryConfig.archiveBatchSize);
      setVal('worldbook-vector-memory-archive-max-concurrency', (vectorMemoryConfig as any).summaryIndexArchiveMaxConcurrency || (vectorMemoryConfig as any).archiveMaxConcurrency || 30);
      setVal('worldbook-vector-memory-summary-index-keyword-min-rows', (vectorMemoryConfig as any).summaryIndexKeywordMinRows || 100);
      setVal('worldbook-vector-memory-topk', vectorMemoryConfig.topK);
      setVal('worldbook-vector-memory-min-score', vectorMemoryConfig.minScore);
      setVal('worldbook-vector-memory-namespace', vectorMemoryConfig.vectorNamespace);
      setVal('worldbook-vector-memory-embedding-endpoint', vectorMemoryConfig.embeddingEndpoint);
      setVal('worldbook-vector-memory-embedding-model', vectorMemoryConfig.embeddingModel);
      setVal('worldbook-vector-memory-embedding-api-key', vectorMemoryConfig.embeddingApiKey);
      setVal('worldbook-vector-memory-rerank-endpoint', (vectorMemoryConfig as any).rerankEndpoint || '');
      setVal('worldbook-vector-memory-rerank-model', (vectorMemoryConfig as any).rerankModel || '');
      setVal('worldbook-vector-memory-rerank-api-key', (vectorMemoryConfig as any).rerankApiKey || '');
      setVal('worldbook-vector-memory-rerank-instruction', vectorMemoryConfig.rerankInstruction || '');
      setVal('worldbook-vector-memory-rerank-batch-size', (vectorMemoryConfig as any).rerankBatchSize || 300);
      setChecked('worldbook-vector-memory-chunk-chronicle-by-sentence', (vectorMemoryConfig as any).summaryIndexChunkChronicleBySentence === true);
      setVal('worldbook-vector-memory-overview-sentence-limit', vectorMemoryConfig.summaryChunkSentenceCount);
      setChecked('worldbook-vector-memory-archive-without-summary', (vectorMemoryConfig as any).archiveWithoutSummary === true);
      setVal('worldbook-vector-memory-recall-candidate-limit', vectorMemoryConfig.recallCandidateLimit);
      setVal('worldbook-vector-memory-recent-fixed-inject-count', (vectorMemoryConfig as any).recentFixedInjectCount || 50);
      setChecked('worldbook-vector-memory-rolling-delta-enabled', (vectorMemoryConfig as any).summaryIndexRollingDeltaEnabled === true);
      setVal('worldbook-vector-memory-rolling-delta-fold-threshold', (vectorMemoryConfig as any).summaryIndexRollingDeltaFoldThreshold || 15);
      setVal('worldbook-vector-memory-entry-comment', vectorMemoryConfig.entryComment);
      setVal('worldbook-vector-memory-entry-key', vectorMemoryConfig.entryKey);
      setChecked('worldbook-vector-memory-keyword-generation-enabled', (vectorMemoryConfig as any).keywordGenerationEnabled !== false);
      setVal('worldbook-vector-memory-keyword-api-preset', vectorMemoryConfig.keywordApiPreset);
      setVal('worldbook-vector-memory-keyword-context-pair-count', (vectorMemoryConfig as any).keywordContextPairCount || 1);
      setVal('worldbook-vector-memory-keyword-generation-max-attempts', (vectorMemoryConfig as any).keywordGenerationMaxAttempts || 3);
      renderKeywordPromptGroupToUI_ACU((vectorMemoryConfig as any).keywordPromptGroup || []);
      renderSummaryPromptGroupToUI_ACU((vectorMemoryConfig as any).summaryPromptGroup || []);
      const $vectorMemoryBlock = find('worldbook-vector-memory-config-block');
      if ($vectorMemoryBlock.length) $vectorMemoryBlock.toggle(summaryVectorIndexEnabled);
      syncManualUpdateButtonAvailability_ACU();
      const $outlineToggle = find('worldbook-outline-entry-enabled');
      if ($outlineToggle.length) {
          let mode = worldbookConfig.zeroTkOccupyMode;
          if (typeof mode === 'undefined' && typeof worldbookConfig.outlineEntryEnabled !== 'undefined') mode = (worldbookConfig.outlineEntryEnabled === false);
          $outlineToggle.prop('checked', mode === true);
      }
      setChecked('worldbook-summary-vector-index-mode-enabled', summaryVectorIndexEnabled);
      setChecked('vector-index-mode-enabled', summaryVectorIndexEnabled);
      const $summaryVectorIndexHint = find('summary-vector-index-archive-hint');
      if ($summaryVectorIndexHint.length) {
          const activeSummaryVectorIndexSnapshot = getAggregatedSummaryVectorIndexSnapshot_ACU();
          const activeSummaryVectorIndexState = activeSummaryVectorIndexSnapshot?.summaryVectorIndexState || null;
          const summaryVectorIndexRowCount = activeSummaryVectorIndexState?.rowCount || (Array.isArray(activeSummaryVectorIndexState?.rows) ? activeSummaryVectorIndexState.rows.length : 0);
          const summaryVectorIndexChunkCount = activeSummaryVectorIndexState?.chunkCount || (Array.isArray(activeSummaryVectorIndexState?.chunks) ? activeSummaryVectorIndexState.chunks.length : 0);
          const hasSummaryVectorIndexArchive = !!activeSummaryVectorIndexState;
          const summaryIndexKeywordMinRows = Number((vectorMemoryConfig as any).summaryIndexKeywordMinRows || 100);
          $summaryVectorIndexHint.text(summaryVectorIndexEnabled
              ? hasSummaryVectorIndexArchive
                  ? summaryVectorIndexRowCount >= summaryIndexKeywordMinRows
                      ? `交火模式纪要索引已启用；当前可用索引：${summaryVectorIndexRowCount} 条纪要，${summaryVectorIndexChunkCount} 个概要列 chunks，已达到 ${summaryIndexKeywordMinRows} 条门槛。发送前会生成关键词、召回概要列 chunks、执行可选 Rerank，并按纪要表原顺序覆盖原概要索引条目。`
                      : `交火模式纪要索引已启用；当前可用索引：${summaryVectorIndexRowCount}/${summaryIndexKeywordMinRows} 条纪要，${summaryVectorIndexChunkCount} 个概要列 chunks。未达到门槛前，发送时不会触发交火召回，填表保存后仍会立即归档并继续累积外置索引。`
                  : `交火模式纪要索引已启用，但当前聊天尚无外置纪要向量索引；完成一次纪要表填写后会自动归档，也可点击“立即构建交火纪要索引”手动构建。`
              : '使用前请先配置好 Embedding 模型以及可选 Rerank 模型；开启后会在纪要表填写完成时立即归档外置概要列向量索引，达到门槛后发送前覆盖原概要索引条目。');
      }
      if ($useMainApiCheckbox_ACU) { $useMainApiCheckbox_ACU.prop('checked', s.apiConfig.useMainApi); if (typeof updateCustomApiInputsState_ACU === 'function') updateCustomApiInputsState_ACU(); }
      if ($streamingEnabledCheckbox_ACU) $streamingEnabledCheckbox_ACU.prop('checked', s.streamingEnabled || false);
      if ($manualTableSelector_ACU && typeof renderManualTableSelector_ACU === 'function') renderManualTableSelector_ACU();
      if ($importTableSelector_ACU && typeof renderImportTableSelector_ACU === 'function') renderImportTableSelector_ACU();
      $popupInstance_ACU.find(`input[name="${SCRIPT_ID_PREFIX_ACU}-api-mode"][value="${s.apiMode}"]`).prop('checked', true);
      if (typeof updateApiModeView_ACU === 'function') updateApiModeView_ACU(s.apiMode);
  }
