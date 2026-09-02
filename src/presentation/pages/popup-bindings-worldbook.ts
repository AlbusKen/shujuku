// popup-bindings-worldbook.ts
// 世界书标签页事件绑定

import { showToastr_ACU } from '../theme/toast';
import { SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';
import { logDebug_ACU, logError_ACU, logWarn_ACU } from '../../shared/utils';
import { jQuery_API_ACU } from '../dom-utils';
import { getCharLorebooks_ACU, getLorebookEntries_ACU, setLorebookEntries_ACU, isWorldbookApiAvailable_ACU } from '../../service/worldbook/worldbook-service';
import { settings_ACU, currentJsonTableData_ACU } from '../../service/runtime/state-manager';
import { $popupInstance_ACU } from '../state/ui-refs';
import { saveSettingsAndNotify_ACU } from '../components/settings-ui-helpers';
import { applyWorldbookEntryFilter_ACU, applyWorldbookListFilter_ACU, applyWorldbookSelectFilter_ACU, isEntryBlocked_ACU, populateImportWorldbookTargetSelector_ACU, populateWorldbookEntryList_ACU, populateWorldbookList_ACU, renderLazyWorldbookEntryItems_ACU, toggleLazyWorldbookEntryGroup_ACU, updateLazyWorldbookEntryCheckedState_ACU, updateWorldbookSourceView_ACU } from '../components/worldbook-selector';
import { getLorebookEntriesByNames_ACU, getWorldBooks_ACU, updateReadableLorebookEntry_ACU } from '../../service/worldbook/pipeline';
import { getInjectionTargetLorebook_ACU, getIsolationPrefix_ACU, updateOutlineTableEntry_ACU } from '../../service/worldbook/injection-engine';
import { refreshMergedDataAndNotifyWithUI_ACU } from '../components/pipeline-ui-helpers';
import { getCurrentWorldbookConfig_ACU } from '../../service/settings/settings-readers';
import { setSummaryVectorIndexMode_ACU, setZeroTkOccupyMode_ACU } from '../../service/settings/settings-service';
import { formatJsonToReadable_ACU } from '../../service/runtime/helpers-remaining';
import { getCurrentVectorMemoryConfig_ACU, getDefaultVectorMemoryConfig_ACU, updateGlobalVectorMemoryConfigFields_ACU } from '../../service/vector/vector-memory-config';
import { getAggregatedSummaryVectorIndexSnapshot_ACU } from '../../service/vector/summary-vector-index-state-service';
import { defaultVectorMemoryConfig_ACU } from '../../shared/defaults';
import { syncManualUpdateButtonAvailability_ACU } from '../components/status-display';

const KEYWORD_PROMPT_SEGMENT_CLASS = 'acu-keyword-prompt-segment';

function renderPromptGroupToContainer_ACU(containerId: string, segments: any[]): void {
    const $container = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-${containerId}`);
    if (!$container.length) return;
    $container.empty();
    if (!Array.isArray(segments) || segments.length === 0) return;

    for (const segment of segments) {
        const $block = jQuery_API_ACU('<div>')
            .addClass(KEYWORD_PROMPT_SEGMENT_CLASS)
            .css({ border: '1px solid var(--acu-border-2)', borderRadius: '6px', padding: '8px', background: 'var(--acu-bg-1)' });

        const $header = jQuery_API_ACU('<div>').css({ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '6px' });

        const $roleSelect = jQuery_API_ACU('<select>').css({ width: '120px' });
        $roleSelect.append(
            jQuery_API_ACU('<option>').val('system').text('System'),
            jQuery_API_ACU('<option>').val('assistant').text('Assistant'),
            jQuery_API_ACU('<option>').val('user').text('User'),
        );
        $roleSelect.val(segment.role || 'system');

        const $deleteBtn = jQuery_API_ACU('<button>')
            .addClass('acu-btn-small')
            .text('✕')
            .attr('title', '删除此段落')
            .css({ fontSize: '11px', marginLeft: 'auto' });
        if (segment.deletable === false) {
            $deleteBtn.prop('disabled', true).css({ opacity: 0.4, cursor: 'not-allowed' });
        }

        $header.append($roleSelect, $deleteBtn);

        const $textarea = jQuery_API_ACU('<textarea>')
            .addClass('text_pole')
            .val(segment.content || '')
            .css({ width: '100%', minHeight: '60px', resize: 'vertical' });

        $block.append($header, $textarea);
        $container.append($block);
    }
}

function readPromptGroupFromContainer_ACU(containerId: string): any[] {
    const $container = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-${containerId}`);
    if (!$container.length) return [];
    const segments: any[] = [];
    $container.find(`.${KEYWORD_PROMPT_SEGMENT_CLASS}`).each(function () {
        const $block = jQuery_API_ACU(this);
        const role = String($block.find('select').val() || 'system').toLowerCase().trim();
        const content = String($block.find('textarea').val() || '').trim();
        const $deleteBtn = $block.find('button');
        const deletable = !$deleteBtn.prop('disabled');
        if (content) {
            segments.push({ role, content, deletable });
        }
    });
    return segments;
}

export function renderKeywordPromptGroupToUI_ACU(segments: any[]): void {
    renderPromptGroupToContainer_ACU('worldbook-vector-memory-keyword-prompt-group', segments);
}

export function renderSummaryPromptGroupToUI_ACU(segments: any[]): void {
    renderPromptGroupToContainer_ACU('worldbook-vector-memory-summary-prompt-group', segments);
}

export function readKeywordPromptGroupFromUI_ACU(): any[] {
    return readPromptGroupFromContainer_ACU('worldbook-vector-memory-keyword-prompt-group');
}

export function readSummaryPromptGroupFromUI_ACU(): any[] {
    return readPromptGroupFromContainer_ACU('worldbook-vector-memory-summary-prompt-group');
}


/**
 * 绑定世界书标签页的所有事件
 */
export async function bindWorldbookEvents_ACU(): Promise<void> {
      // [向量记忆] 配置已迁移到全局 settings_ACU.vectorMemoryConfig，
      // 不再跟随世界书配置（角色级），而是跟随数据库全局设置。
      const toggleVectorMemoryConfigBlock_ACU = () => {
          const worldbookConfig = getCurrentWorldbookConfig_ACU();
          const summaryVectorIndexEnabled = worldbookConfig.summaryVectorIndexModeEnabled === true;
          $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-enabled`).prop('checked', summaryVectorIndexEnabled);
          $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-config-block`).toggle(summaryVectorIndexEnabled);
      };
      const logVectorMemorySaveResult_ACU = (fieldNames: string[], result: { ok: boolean; message?: string }) => {
          const safeFieldNames = fieldNames.map(field => /key/i.test(field) ? `${field}(redacted)` : field).join(',');
          logDebug_ACU(`[交火模式配置] 已保存字段: ${safeFieldNames}; ok=${result.ok}${result.message ? `; message=${result.message}` : ''}`);
      };
      const updateVectorMemoryFields_ACU = (patch: Record<string, any>) => {
          // [V1 收敛] 委托 service 事务式更新（快照 → 修改 → 保存 → 失败回滚）。
          const result = updateGlobalVectorMemoryConfigFields_ACU(patch);
          if (!result.ok) {
              showToastr_ACU('error', result.message || '保存向量记忆配置失败，已回滚。');
              return;
          }
          logVectorMemorySaveResult_ACU(Object.keys(patch), result);
      };
      const updateVectorMemoryField_ACU = (field: string, value: any) => {
          updateVectorMemoryFields_ACU({ [field]: value });
      };
      const parseIntegerField_ACU = (rawValue: any, fallbackValue: number) => {
          const parsed = Number.parseInt(String(rawValue ?? '').trim(), 10);
          return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackValue;
      };
      const parseFloatField_ACU = (rawValue: any, fallbackValue: number) => {
          const parsed = Number.parseFloat(String(rawValue ?? '').trim());
          return Number.isFinite(parsed) ? parsed : fallbackValue;
      };
      const bindVectorMemoryInput_ACU = (selector: string, eventName: string, updater: ($input: any) => any) => {
          const $input = $popupInstance_ACU.find(selector);
          if (!$input.length) return;
          const events = String(eventName || 'change')
              .split(/\s+/)
              .map(event => event.trim())
              .filter(Boolean);
          const namespacedEvents = events.map(event => `${event}.acu_vector_memory`).join(' ');
          for (const event of events) {
              $input.off(`${event}.acu_vector_memory`);
          }
          $input.on(namespacedEvents, function() {
              updater(jQuery_API_ACU(this));
          });
      };
      const $worldbookSourceRadios = $popupInstance_ACU.find(`input[name="${SCRIPT_ID_PREFIX_ACU}-worldbook-source"]`);
      const $refreshWorldbooksButton = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-refresh-worldbooks`);
      const $worldbookSelect = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-select`);
      const $worldbookEntryList = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-entry-list`);
      const $selectAllButton = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-select-all`);
      const $deselectAllButton = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-deselect-all`);

      // [新增] 世界书UI事件绑定
      if ($worldbookSourceRadios.length) {
          $worldbookSourceRadios.on('change', async function() {
              const worldbookConfig = getCurrentWorldbookConfig_ACU();
              worldbookConfig.source = jQuery_API_ACU(this).val();
              saveSettingsAndNotify_ACU();
              await updateWorldbookSourceView_ACU();
          });
      }
      // [新增] 世界书筛选：注入目标 / 手动选择列表 / 条目列表
      const $wbTargetFilter = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-injection-target-filter`);
      const $wbListFilter = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-select-filter`);
      const $wbEntryFilter = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-entry-filter`);
      if ($wbTargetFilter.length) {
          $wbTargetFilter.on('input', function() {
              const $sel = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-injection-target`);
              applyWorldbookSelectFilter_ACU($sel, jQuery_API_ACU(this).val());
          });
      }
      if ($wbListFilter.length) {
          $wbListFilter.on('input', function() {
              applyWorldbookListFilter_ACU($worldbookSelect, jQuery_API_ACU(this).val());
          });
      }
      if ($wbEntryFilter.length) {
          $wbEntryFilter.on('input', function() {
              applyWorldbookEntryFilter_ACU($worldbookEntryList, jQuery_API_ACU(this).val());
          });
      }
      if ($refreshWorldbooksButton.length) {
          $refreshWorldbooksButton.on('click', populateWorldbookList_ACU);
      }
      bindVectorMemoryInput_ACU(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-enabled`, 'change', ($input) => {
          const worldbookConfig = getCurrentWorldbookConfig_ACU();
          $input.prop('checked', worldbookConfig.summaryVectorIndexModeEnabled === true);
          toggleVectorMemoryConfigBlock_ACU();
          syncManualUpdateButtonAvailability_ACU();
      });
      bindVectorMemoryInput_ACU(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-threshold`, 'input change', ($input) => {
          const defaults = getDefaultVectorMemoryConfig_ACU();
          updateVectorMemoryField_ACU('threshold', parseIntegerField_ACU($input.val(), defaults.threshold));
      });
      bindVectorMemoryInput_ACU(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-archive-trigger-count`, 'input change', ($input) => {
          const defaults = getDefaultVectorMemoryConfig_ACU();
          updateVectorMemoryField_ACU('archiveTriggerCount', parseIntegerField_ACU($input.val(), (defaults as any).archiveTriggerCount || defaults.archiveBatchSize));
      });
      bindVectorMemoryInput_ACU(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-archive-batch-size`, 'input change', ($input) => {
          const defaults = getDefaultVectorMemoryConfig_ACU();
          updateVectorMemoryField_ACU('archiveBatchSize', parseIntegerField_ACU($input.val(), defaults.archiveBatchSize));
      });
      bindVectorMemoryInput_ACU(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-archive-max-concurrency`, 'input change', ($input) => {
          const defaults = getDefaultVectorMemoryConfig_ACU();
          const value = parseIntegerField_ACU($input.val(), (defaults as any).summaryIndexArchiveMaxConcurrency || (defaults as any).archiveMaxConcurrency || 30);
          updateVectorMemoryFields_ACU({
              summaryIndexArchiveMaxConcurrency: value,
              archiveMaxConcurrency: value,
          });
      });
      bindVectorMemoryInput_ACU(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-summary-index-keyword-min-rows`, 'input change', ($input) => {
          const defaults = getDefaultVectorMemoryConfig_ACU();
          updateVectorMemoryField_ACU('summaryIndexKeywordMinRows', parseIntegerField_ACU($input.val(), (defaults as any).summaryIndexKeywordMinRows || 100));
      });
      bindVectorMemoryInput_ACU(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-topk`, 'input change', ($input) => {
          const defaults = getDefaultVectorMemoryConfig_ACU();
          updateVectorMemoryField_ACU('topK', parseIntegerField_ACU($input.val(), defaults.topK));
      });
      bindVectorMemoryInput_ACU(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-min-score`, 'input change', ($input) => {
          const defaults = getDefaultVectorMemoryConfig_ACU();
          updateVectorMemoryField_ACU('minScore', parseFloatField_ACU($input.val(), defaults.minScore));
      });
      bindVectorMemoryInput_ACU(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-namespace`, 'input change', ($input) => {
          updateVectorMemoryField_ACU('vectorNamespace', String($input.val() ?? '').trim());
      });
      bindVectorMemoryInput_ACU(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-embedding-endpoint`, 'input change', ($input) => {
          updateVectorMemoryField_ACU('embeddingEndpoint', String($input.val() ?? '').trim());
      });
      bindVectorMemoryInput_ACU(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-embedding-model`, 'input change', ($input) => {
          updateVectorMemoryField_ACU('embeddingModel', String($input.val() ?? '').trim());
      });
      bindVectorMemoryInput_ACU(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-embedding-api-key`, 'input change', ($input) => {
          updateVectorMemoryField_ACU('embeddingApiKey', String($input.val() ?? '').trim());
      });
      bindVectorMemoryInput_ACU(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-rerank-endpoint`, 'input change', ($input) => {
          updateVectorMemoryField_ACU('rerankEndpoint', String($input.val() ?? '').trim());
      });
      bindVectorMemoryInput_ACU(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-rerank-model`, 'input change', ($input) => {
          updateVectorMemoryField_ACU('rerankModel', String($input.val() ?? '').trim());
      });
      bindVectorMemoryInput_ACU(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-rerank-api-key`, 'input change', ($input) => {
          updateVectorMemoryField_ACU('rerankApiKey', String($input.val() ?? '').trim());
      });
      bindVectorMemoryInput_ACU(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-rerank-instruction`, 'input change', ($input) => {
          updateVectorMemoryField_ACU('rerankInstruction', String($input.val() ?? ''));
      });
      bindVectorMemoryInput_ACU(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-rerank-batch-size`, 'input change', ($input) => {
          const defaults = getDefaultVectorMemoryConfig_ACU();
          updateVectorMemoryField_ACU('rerankBatchSize', parseIntegerField_ACU($input.val(), (defaults as any).rerankBatchSize || 300));
      });
      bindVectorMemoryInput_ACU(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-chunk-chronicle-by-sentence`, 'change', ($input) => {
          updateVectorMemoryField_ACU('summaryIndexChunkChronicleBySentence', $input.is(':checked'));
      });
      bindVectorMemoryInput_ACU(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-keyword-generation-enabled`, 'change', ($input) => {
          updateVectorMemoryField_ACU('keywordGenerationEnabled', $input.is(':checked'));
      });

      bindVectorMemoryInput_ACU(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-overview-sentence-limit`, 'input change', ($input) => {
          const defaults = getDefaultVectorMemoryConfig_ACU();
          updateVectorMemoryField_ACU('summaryChunkSentenceCount', parseIntegerField_ACU($input.val(), defaults.summaryChunkSentenceCount));
      });
      bindVectorMemoryInput_ACU(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-archive-without-summary`, 'change', ($input) => {
          updateVectorMemoryField_ACU('archiveWithoutSummary', $input.is(':checked'));
      });
      bindVectorMemoryInput_ACU(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-recall-candidate-limit`, 'input change', ($input) => {
          const defaults = getDefaultVectorMemoryConfig_ACU();
          updateVectorMemoryField_ACU('recallCandidateLimit', parseIntegerField_ACU($input.val(), defaults.recallCandidateLimit));
      });
      bindVectorMemoryInput_ACU(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-recent-fixed-inject-count`, 'input change', ($input) => {
          const defaults = getDefaultVectorMemoryConfig_ACU();
          updateVectorMemoryField_ACU('recentFixedInjectCount', parseIntegerField_ACU($input.val(), (defaults as any).recentFixedInjectCount || 50));
      });
      bindVectorMemoryInput_ACU(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-rolling-delta-enabled`, 'change', ($input) => {
          updateVectorMemoryField_ACU('summaryIndexRollingDeltaEnabled', $input.is(':checked'));
      });
      bindVectorMemoryInput_ACU(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-rolling-delta-fold-threshold`, 'input change', ($input) => {
          const defaults = getDefaultVectorMemoryConfig_ACU();
          updateVectorMemoryField_ACU('summaryIndexRollingDeltaFoldThreshold', parseIntegerField_ACU($input.val(), (defaults as any).summaryIndexRollingDeltaFoldThreshold || 15));
      });
      bindVectorMemoryInput_ACU(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-entry-comment`, 'input change', ($input) => {
          updateVectorMemoryField_ACU('entryComment', String($input.val() ?? '').trim());
      });
      bindVectorMemoryInput_ACU(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-entry-key`, 'input change', ($input) => {
          updateVectorMemoryField_ACU('entryKey', String($input.val() ?? '').trim());
      });
      bindVectorMemoryInput_ACU(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-keyword-api-preset`, 'change', ($input) => {
          updateVectorMemoryField_ACU('keywordApiPreset', String($input.val() ?? '').trim());
      });
      bindVectorMemoryInput_ACU(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-keyword-context-pair-count`, 'input change', ($input) => {
          const defaults = getDefaultVectorMemoryConfig_ACU();
          updateVectorMemoryField_ACU('keywordContextPairCount', parseIntegerField_ACU($input.val(), defaults.keywordContextPairCount));
      });
      bindVectorMemoryInput_ACU(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-keyword-generation-max-attempts`, 'input change', ($input) => {
          const defaults = getDefaultVectorMemoryConfig_ACU();
          updateVectorMemoryField_ACU('keywordGenerationMaxAttempts', parseIntegerField_ACU($input.val(), (defaults as any).keywordGenerationMaxAttempts || 3));
      });

      const bindPromptGroupEditor_ACU = (
          containerId: string,
          addButtonId: string,
          resetButtonId: string,
          fieldName: string,
          renderFn: (segments: any[]) => void,
          readFn: () => any[],
          getDefaultSegments: () => any[],
      ) => {
          const $container = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-${containerId}`);
          if ($container.length) {
              $container.on('click', 'button:not(:disabled)', function () {
                  jQuery_API_ACU(this).closest(`.${KEYWORD_PROMPT_SEGMENT_CLASS}`).remove();
                  const segments = readFn();
                  updateVectorMemoryField_ACU(fieldName, segments);
              });
              $container.on('input change', 'select, textarea', function () {
                  const segments = readFn();
                  updateVectorMemoryField_ACU(fieldName, segments);
              });
          }

          const $addBtn = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-${addButtonId}`);
          if ($addBtn.length) {
              $addBtn.on('click', function () {
                  const currentSegments = readFn();
                  currentSegments.push({ role: 'user', content: '', deletable: true });
                  renderFn(currentSegments);
                  updateVectorMemoryField_ACU(fieldName, currentSegments);
              });
          }

          const $resetBtn = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-${resetButtonId}`);
          if ($resetBtn.length) {
              $resetBtn.on('click', function () {
                  const defaultSegments = getDefaultSegments();
                  renderFn(defaultSegments);
                  updateVectorMemoryField_ACU(fieldName, defaultSegments);
              });
          }
      };

      bindPromptGroupEditor_ACU(
          'worldbook-vector-memory-keyword-prompt-group',
          'worldbook-vector-memory-keyword-prompt-add',
          'worldbook-vector-memory-keyword-prompt-reset',
          'keywordPromptGroup',
          renderKeywordPromptGroupToUI_ACU,
          readKeywordPromptGroupFromUI_ACU,
          () => JSON.parse(JSON.stringify(getDefaultVectorMemoryConfig_ACU().keywordPromptGroup || [])),
      );

      bindPromptGroupEditor_ACU(
          'worldbook-vector-memory-summary-prompt-group',
          'worldbook-vector-memory-summary-prompt-add',
          'worldbook-vector-memory-summary-prompt-reset',
          'summaryPromptGroup',
          renderSummaryPromptGroupToUI_ACU,
          readSummaryPromptGroupFromUI_ACU,
          () => JSON.parse(JSON.stringify((getDefaultVectorMemoryConfig_ACU() as any).summaryPromptGroup || [])),
      );

      toggleVectorMemoryConfigBlock_ACU();
      // [新增] 外部导入世界书选择器的事件绑定
      const $refreshImportWorldbooksButton = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-refresh-import-worldbooks`);
      if ($refreshImportWorldbooksButton.length) {
          $refreshImportWorldbooksButton.on('click', populateImportWorldbookTargetSelector_ACU);
      }
      const $importWorldbookTargetSelect = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-import-worldbook-injection-target`);
      const $importWorldbookTargetFilter = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-import-worldbook-injection-target-filter`);
      const $importPromptExcludeImportedEntriesToggle = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-import-prompt-exclude-imported-worldbook-entries`);
      if ($importWorldbookTargetFilter.length) {
          $importWorldbookTargetFilter.on('input', function() {
              applyWorldbookSelectFilter_ACU($importWorldbookTargetSelect, jQuery_API_ACU(this).val());
          });
      }
      if ($importWorldbookTargetSelect.length) {
          $importWorldbookTargetSelect.on('change', function() {
              settings_ACU.importWorldbookTarget = jQuery_API_ACU(this).val();
              saveSettingsAndNotify_ACU();
              logDebug_ACU(`Import worldbook target changed to: ${settings_ACU.importWorldbookTarget}`);
          });
      }
      if ($importPromptExcludeImportedEntriesToggle.length) {
          $importPromptExcludeImportedEntriesToggle.off('change.acu_import_prompt_filter').on('change.acu_import_prompt_filter', function() {
              settings_ACU.importPromptExcludeImportedWorldbookEntries = jQuery_API_ACU(this).is(':checked');
              saveSettingsAndNotify_ACU();
              logDebug_ACU(`[外部导入] importPromptExcludeImportedWorldbookEntries=${settings_ACU.importPromptExcludeImportedWorldbookEntries}`);
          });
      }
      const resolveWorldbookBookNames_ACU = async () => {
          const worldbookConfig = getCurrentWorldbookConfig_ACU();
          if ((worldbookConfig.source || 'character') === 'manual') {
              return [...new Set((Array.isArray(worldbookConfig.manualSelection) ? worldbookConfig.manualSelection : []).filter(Boolean))];
          }
          const names = [];
          try {
              const charLorebooks = await getCharLorebooks_ACU({ type: 'all' });
              if (charLorebooks.primary) names.push(charLorebooks.primary);
              if (charLorebooks.additional?.length) names.push(...charLorebooks.additional);
          } catch (e) {}
          return [...new Set(names.filter(Boolean))];
      };
      const isWorldbookEntryAllowedForUI_ACU = (entry: any) => {
          if (!entry) return false;
          const comment = entry.comment || '';
          if (comment.startsWith('TavernDB-ACU-') || comment.startsWith('重要人物条目') || comment.startsWith('总结条目')) {
              return false;
          }
          if (isEntryBlocked_ACU(entry)) return false;
          if (!entry.enabled) return false;
          return true;
      };
      const setWorldbookEntriesSelection_ACU = async (mode: any) => {
          const worldbookConfig = getCurrentWorldbookConfig_ACU();
          const bookNames = await resolveWorldbookBookNames_ACU();
          if (!worldbookConfig.enabledEntries) worldbookConfig.enabledEntries = {};
          const entriesMap = await getLorebookEntriesByNames_ACU(bookNames);
          for (const bookName of bookNames) {
              const entries = Array.isArray(entriesMap[bookName]) ? entriesMap[bookName] : [];
              if (mode === 'none') {
                  worldbookConfig.enabledEntries[bookName] = [];
              } else {
                  worldbookConfig.enabledEntries[bookName] = entries.filter(isWorldbookEntryAllowedForUI_ACU).map(entry => entry.uid);
              }
          }
          saveSettingsAndNotify_ACU();
          await populateWorldbookEntryList_ACU();
      };
      if ($worldbookSelect.length) {
          // New click handler for the custom list
          $worldbookSelect.on('click', '.qrf_worldbook_list_item', async function() {
              const $item = jQuery_API_ACU(this);
              const bookName = $item.data('book-name');
              const worldbookConfig = getCurrentWorldbookConfig_ACU();
              let selection = worldbookConfig.manualSelection || [];

              if ($item.hasClass('selected')) {
                  // Deselect
              selection = selection.filter((name: string) => name !== bookName);
              } else {
                  // Select
                  selection.push(bookName);
              }
              
              worldbookConfig.manualSelection = selection;
              $item.toggleClass('selected'); // Toggle visual state
              
              saveSettingsAndNotify_ACU();
              await populateWorldbookEntryList_ACU();
          });
      }
      if ($worldbookEntryList.length) {
          $worldbookEntryList.off('change.acu_wb_list').on('change.acu_wb_list', 'input[type="checkbox"]', function() {
              const $checkbox = jQuery_API_ACU(this);
              const bookName = $checkbox.data('book');
              const entryUid = $checkbox.data('uid');
              const worldbookConfig = getCurrentWorldbookConfig_ACU();

              if (!worldbookConfig.enabledEntries[bookName]) {
                  worldbookConfig.enabledEntries[bookName] = [];
              }
              const enabledList = worldbookConfig.enabledEntries[bookName];
              const index = enabledList.indexOf(entryUid);
              const checked = $checkbox.is(':checked');

              if (checked) {
                  if (index === -1) enabledList.push(entryUid);
              } else if (index > -1) {
                  enabledList.splice(index, 1);
              }
              updateLazyWorldbookEntryCheckedState_ACU($worldbookEntryList, bookName, entryUid, checked);
              saveSettingsAndNotify_ACU();
          });
          $worldbookEntryList.off('click.acu_wb_toggle').on('click.acu_wb_toggle', '.qrf_worldbook_entry_toggle', function() {
              const bookName = jQuery_API_ACU(this).closest('.qrf_worldbook_entry_group').data('book-name');
              if (!bookName) return;
              toggleLazyWorldbookEntryGroup_ACU($worldbookEntryList, bookName);
          });
          $worldbookEntryList.off('click.acu_wb_more').on('click.acu_wb_more', '.qrf_worldbook_entry_load_more', function() {
              const bookName = jQuery_API_ACU(this).closest('.qrf_worldbook_entry_group').data('book-name');
              if (!bookName) return;
              renderLazyWorldbookEntryItems_ACU($worldbookEntryList, bookName);
          });
      }

      // [新增] "总结大纲(总体大纲)"条目启用开关
      const $outlineEnabledToggle = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-outline-entry-enabled`);
      if ($outlineEnabledToggle.length) {
          $outlineEnabledToggle.off('change.acu_outline_toggle').on('change.acu_outline_toggle', async function() {
              const modeEnabled = jQuery_API_ACU(this).is(':checked');
              setZeroTkOccupyMode_ACU(modeEnabled);
              showToastr_ACU(
                  'info',
                  `0TK占用模式已${modeEnabled ? '启用' : '禁用'}。`,
              );

              // 尝试立即同步世界书条目 enabled 状态（不强制全量更新）
              try {
                  if (currentJsonTableData_ACU) {
                      const { outlineTable } = formatJsonToReadable_ACU(currentJsonTableData_ACU);
                      await updateOutlineTableEntry_ACU(outlineTable, false);
                  }
                  const primaryLorebookName = await getInjectionTargetLorebook_ACU();
                  if (primaryLorebookName && isWorldbookApiAvailable_ACU()) {
                      const allEntries = await getLorebookEntries_ACU(primaryLorebookName);
                      const existingIndexEntry = allEntries.find(e => e.comment && e.comment.endsWith('TavernDB-ACU-CustomExport-纪要索引'));
                      if (existingIndexEntry) {
                          const nextEnabled = !modeEnabled;
                          if (existingIndexEntry.enabled !== nextEnabled) {
                              await setLorebookEntries_ACU(primaryLorebookName, [{
                                  uid: existingIndexEntry.uid,
                                  enabled: nextEnabled,
                              }]);
                              logDebug_ACU(`0TK mode toggle: updated 纪要索引 entry. enabled=${nextEnabled}`);
                          }
                      }
                  }
              } catch (e) {
                  logWarn_ACU('Failed to sync outline entry enabled state immediately:', e);
              }
          });
      }

      const $summaryVectorIndexModeToggle = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-summary-vector-index-mode-enabled`);
      if ($summaryVectorIndexModeToggle.length) {
          $summaryVectorIndexModeToggle.off('change.acu_summary_vector_index_mode').on('change.acu_summary_vector_index_mode', async function() {
              const modeEnabled = jQuery_API_ACU(this).is(':checked');
              setSummaryVectorIndexMode_ACU(modeEnabled);
              $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-enabled`).prop('checked', modeEnabled);
              $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-config-block`).toggle(modeEnabled);
              syncManualUpdateButtonAvailability_ACU();

              try {
                  const primaryLorebookName = await getInjectionTargetLorebook_ACU();
                  if (primaryLorebookName && isWorldbookApiAvailable_ACU()) {
                      const allEntries = await getLorebookEntries_ACU(primaryLorebookName);
                      const existingIndexEntry = allEntries.find(e => e.comment && e.comment.endsWith('TavernDB-ACU-CustomExport-纪要索引'));
                      if (existingIndexEntry) {
                          const nextEnabled = getCurrentWorldbookConfig_ACU()?.zeroTkOccupyMode !== true;
                          if (existingIndexEntry.enabled !== nextEnabled) {
                              await setLorebookEntries_ACU(primaryLorebookName, [{
                                  uid: existingIndexEntry.uid,
                                  enabled: nextEnabled,
                              }]);
                              logDebug_ACU(`summary vector mode toggle: updated 纪要索引 entry. enabled=${nextEnabled}`);
                          }
                      }
                  }
              } catch (e) {
                  logWarn_ACU('Failed to sync summary index entry enabled state immediately:', e);
              }

              const activeSnapshot = getAggregatedSummaryVectorIndexSnapshot_ACU();
              const activeState = activeSnapshot?.summaryVectorIndexState || null;
              const archivedRowCount = activeState?.rowCount || (Array.isArray(activeState?.rows) ? activeState.rows.length : 0);
              const hasArchive = !!activeState;
              const vectorConfig = getCurrentVectorMemoryConfig_ACU();
              const summaryIndexKeywordMinRows = Math.max(1, Math.floor(Number((vectorConfig as any).summaryIndexKeywordMinRows || 100)));
              showToastr_ACU(
                  !modeEnabled || archivedRowCount >= summaryIndexKeywordMinRows ? 'info' : 'warning',
                  modeEnabled
                      ? hasArchive
                          ? archivedRowCount >= summaryIndexKeywordMinRows
                              ? `交火模式纪要索引已启用。当前纪要向量索引 ${archivedRowCount} 条，已达到 ${summaryIndexKeywordMinRows} 条门槛；发送前会召回概要列 chunk、执行可选 Rerank，并按纪要表原顺序覆盖原概要索引条目。`
                              : `交火模式纪要索引已启用。当前纪要向量索引 ${archivedRowCount}/${summaryIndexKeywordMinRows} 条；未达到门槛前，用户发送不会触发交火召回，填表保存后仍会立即归档并继续累积。`
                          : '交火模式纪要索引已启用。当前聊天尚无纪要向量索引归档；完成一次纪要表填写后会自动归档，也可手动构建。'
                      : '交火模式纪要索引已禁用，概要索引将回到原本的全量纪要表流程。',
              );
          });
      }

      // [新增] 全选/全不选事件
      if ($selectAllButton.length) {
          $selectAllButton.off('click.acu_wb_bulk').on('click.acu_wb_bulk', async function() {
              await setWorldbookEntriesSelection_ACU('all');
          });
      }

      if ($deselectAllButton.length) {
          $deselectAllButton.off('click.acu_wb_bulk').on('click.acu_wb_bulk', async function() {
              await setWorldbookEntriesSelection_ACU('none');
          });
      }


}
