import { showToastr_ACU } from '../theme/toast';
import { SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';
import { logDebug_ACU, logError_ACU, logWarn_ACU } from '../../shared/utils';
import { jQuery_API_ACU } from '../dom-utils';
import { getCurrentCharPrimaryLorebook_ACU } from '../../service/worldbook/worldbook-service';
import { currentChatFileIdentifier_ACU, currentJsonTableData_ACU, settings_ACU } from '../../service/runtime/state-manager';
import { $popupInstance_ACU, _assignUIPlaceholders_ACU } from '../state/ui-refs';
import { getCurrentWorldbookConfig_ACU } from '../../service/settings/settings-readers';
import { saveSettingsAndNotify_ACU, loadSettingsAndRefreshUI_ACU } from '../components/settings-ui-helpers';
import { deleteAllGeneratedEntries_ACU, updateReadableLorebookEntry_ACU } from '../../service/worldbook/pipeline';
import { populateInjectionTargetSelector_ACU, populateImportWorldbookTargetSelector_ACU } from '../components/worldbook-selector';
import { updateCardUpdateStatusDisplay_ACU } from '../components/update-status-display';
import { exportCharCardPromptToJson_ACU, loadCharCardPromptFromJson_ACU, loadTavernApiProfiles_ACU, updateApiModeView_ACU } from '../triggers/settings-ui-sync';
// [V1 收敛] API 配置写权限统一委托 service 事务式函数。
import { setApiMode_ACU, setTavernProfile_ACU } from '../../service/settings/api-preset-service';

// 子模块绑定函数
import { bindStatusEvents_ACU } from './popup-bindings-status';
import { bindWorldbookEvents_ACU } from './popup-bindings-worldbook';
import { bindDataEvents_ACU } from './popup-bindings-data';
import { bindPlotEvents_ACU } from './popup-bindings-plot';
import { bindOptimizationEvents_ACU } from './popup-bindings-optimization';
import { bindSqlConsoleEvents_ACU } from './sql-console';
import { bindLogViewerEvents_ACU } from './log-viewer';
import { isSqliteMode } from '../../service/table/storage-mode';

/**
 * presentation/pages/popup-bindings.ts — 主弹窗事件绑定
 * 从 main-popup.ts 拆出（原 onReady 回调中的事件绑定部分）
 */

  export async function bindPopupEvents_ACU() {
 
      // Assign jQuery objects for UI elements (via batch setter to avoid ESM reassignment)
      _assignUIPlaceholders_ACU({
        $apiConfigSectionToggle_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-api-config-toggle`),
        $apiConfigAreaDiv_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-api-config-area-div`),
        $customApiUrlInput_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-api-url`),
        $customApiKeyInput_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-api-key`),
        $customApiModelInput_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-api-model-input`),
        $customApiModelSelect_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-api-model-select`),
        $maxTokensInput_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-max-tokens`),
        $temperatureInput_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-temperature`),
        $loadModelsButton_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-load-models`),
        $saveApiConfigButton_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-save-config`),
        $clearApiConfigButton_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-clear-config`),
        $apiStatusDisplay_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-api-status`),
        $charCardPromptToggle_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-char-card-prompt-toggle`),
        $charCardPromptAreaDiv_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-char-card-prompt-area-div`),
        $charCardPromptSegmentsContainer_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-prompt-segments-container`),
        $saveCharCardPromptButton_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-save-char-card-prompt`),
        $resetCharCardPromptButton_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-reset-char-card-prompt`),
        $autoUpdateThresholdInput_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-auto-update-threshold`),
        $saveAutoUpdateThresholdButton_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-save-auto-update-threshold`),
        $autoUpdateTokenThresholdInput_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-auto-update-token-threshold`),
        $saveAutoUpdateTokenThresholdButton_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-save-auto-update-token-threshold`),
        $autoUpdateFrequencyInput_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-auto-update-frequency`),
        $saveAutoUpdateFrequencyButton_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-save-auto-update-frequency`),
        $updateBatchSizeInput_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-update-batch-size`),
        $saveUpdateBatchSizeButton_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-save-update-batch-size`),
        $maxConcurrentGroupsInput_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-max-concurrent-groups`),
        $skipUpdateFloorsInput_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-skip-update-floors`),
        $saveSkipUpdateFloorsButton_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-save-skip-update-floors`),
        $retainRecentLayersInput_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-retain-recent-layers`),
        $saveRetainRecentLayersButton_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-save-retain-recent-layers`),
        $autoUpdateEnabledCheckbox_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-auto-update-enabled-checkbox`),
        $standardizedTableFillEnabledCheckbox_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-standardized-table-fill-enabled-checkbox`),
        $toastMuteEnabledCheckbox_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-toast-mute-enabled-checkbox`),
        $promptTemplateEnabledCheckbox_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-prompt-template-enabled-checkbox`),
        $tableEditLastPairOnlyCheckbox_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-tableedit-last-pair-only-checkbox`),
        $tableMaxRetriesInput_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-table-max-retries`),
        $manualExtraHintCheckbox_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-manual-extra-hint-checkbox`),
        $manualUpdateCardButton_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-manual-update-card`),
        $manualTableSelectAll_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-manual-table-select-all`),
        $manualTableSelectNone_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-manual-table-select-none`),
        $manualTableSelector_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-manual-table-selector`),
        $importTableSelectAll_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-import-table-select-all`),
        $importTableSelectNone_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-import-table-select-none`),
        $importTableSelector_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-import-table-selector`),
        $statusMessageSpan_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-status-message`),
        $cardUpdateStatusDisplay_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-card-update-status-display`),
        $useMainApiCheckbox_ACU: $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-use-main-api-checkbox`),
      });
      const $loadCharCardPromptFromJsonButton_ACU = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-load-char-card-prompt-from-json`);
      const $exportCharCardPromptToJsonButton_ACU = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-export-char-card-prompt-to-json`);

      const $apiModeRadios = $popupInstance_ACU.find(`input[name="${SCRIPT_ID_PREFIX_ACU}-api-mode"]`);
      const $tavernProfileSelect = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-tavern-api-profile-select`);
      const $refreshTavernProfilesButton = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-refresh-tavern-api-profiles`);

      // Load existing settings into UI fields
      loadSettingsAndRefreshUI_ACU(); // This function will populate the fields
      // [新增] 加载世界书UI状态（已移至 loadSettings_ACU）
      // $worldbookSourceRadios.filter(`[value="${getCurrentWorldbookConfig_ACU().source}"]`).prop('checked', true);
      // updateWorldbookSourceView_ACU();
      // [新增] 填充并设置注入目标选择器
      populateInjectionTargetSelector_ACU();
      // [新增] 填充外部导入专用的世界书选择器
      populateImportWorldbookTargetSelector_ACU();

      const $injectionTargetSelect = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-worldbook-injection-target`);
      if ($injectionTargetSelect.length) {
          $injectionTargetSelect.on('change', async function() {
              const worldbookConfig = getCurrentWorldbookConfig_ACU();
              const oldTargetSetting = worldbookConfig.injectionTarget;
              const newTargetSetting = jQuery_API_ACU(this).val();

              if (oldTargetSetting === newTargetSetting) return;

              // 异步获取旧的世界书实际名称
              const getOldLorebookName = async () => {
                  if (oldTargetSetting === 'character') {
        return await getCurrentCharPrimaryLorebook_ACU();
                  }
                  return oldTargetSetting;
              };
              const oldLorebookName = await getOldLorebookName();

              // 1. 从旧目标删除条目
              if (oldLorebookName) {
                  showToastr_ACU('info', `正在从旧目标 [${oldLorebookName}] 中清除条目...`);
                  try {
                      await deleteAllGeneratedEntries_ACU(oldLorebookName);
                      // [修复] 增加短暂延迟，确保后端/API完成删除操作
                      await new Promise(resolve => setTimeout(resolve, 300));
                  } catch (e) {
                      logError_ACU(`Failed to clean up old target ${oldLorebookName}:`, e);
                  }
              } else {
                  logWarn_ACU('Old lorebook name could not be determined, skipping cleanup.');
              }

              // 2. 更新设置为新目标并保存
              worldbookConfig.injectionTarget = newTargetSetting;
              saveSettingsAndNotify_ACU();
              logDebug_ACU(`Injection target changed from "${oldTargetSetting}" to "${newTargetSetting}" for char ${currentChatFileIdentifier_ACU}.`);

              // 3. 向新目标注入条目
              if (currentJsonTableData_ACU) {
                  showToastr_ACU('info', `正在向新目标注入条目...`);
                  await updateReadableLorebookEntry_ACU(true); // `true` to ensure entries are created
                  showToastr_ACU('success', '数据注入目标已成功切换！');
              } else {
                  showToastr_ACU('warning', '数据注入目标已更新，但当前无数据可注入。');
              }
          });
      }

      // [新增] 提示词组 JSON 导入/导出
      if ($loadCharCardPromptFromJsonButton_ACU && $loadCharCardPromptFromJsonButton_ACU.length) {
        $loadCharCardPromptFromJsonButton_ACU.off('click').on('click', function () {
          loadCharCardPromptFromJson_ACU();
        });
      }
      if ($exportCharCardPromptToJsonButton_ACU && $exportCharCardPromptToJsonButton_ACU.length) {
        $exportCharCardPromptToJsonButton_ACU.off('click').on('click', function () {
          exportCharCardPromptToJson_ACU();
        });
      }

      // Attach event listeners

        // --- [新增] Tab切换逻辑 ---
        const $tabButtons = $popupInstance_ACU.find('.acu-tabs-nav > .acu-tab-button');
        const $tabContents = $popupInstance_ACU.find('.acu-layout > .acu-main > .acu-tab-content');
        $tabButtons.on('click', function() {
            const tabId = jQuery_API_ACU(this).data('tab');
            $tabButtons.removeClass('active');
            jQuery_API_ACU(this).addClass('active');
            $tabContents.removeClass('active');
            $popupInstance_ACU.find(`.acu-layout > .acu-main > #acu-tab-${tabId}`).addClass('active');
        });
        
        // --- [新增] 高级工具子Tab切换逻辑 ---
        const $subtabButtons = $popupInstance_ACU.find('.acu-subtab-button');
        const $subtabContents = $popupInstance_ACU.find('.acu-subtab-content');
        $subtabButtons.on('click', function() {
            const subtabId = jQuery_API_ACU(this).data('subtab');
            // 只在高级工具tab内部切换
            const $advancedTab = $popupInstance_ACU.find('#acu-tab-advanced');
            $advancedTab.find('.acu-subtab-button').removeClass('active');
            jQuery_API_ACU(this).addClass('active');
            $advancedTab.find('.acu-subtab-content').removeClass('active');
            $advancedTab.find(`#acu-subtab-${subtabId}`).addClass('active');
        });
        
        // API Mode switching logic
        if ($apiModeRadios.length) {
            $apiModeRadios.on('change', function() {
                const selectedMode = String(jQuery_API_ACU(this).val() || '');
                const result = setApiMode_ACU(selectedMode);
                if (!result.ok) {
                    showToastr_ACU('error', result.message || '保存API模式失败，已回滚。');
                    return;
                }
                updateApiModeView_ACU(selectedMode);
            });
        }
        if ($refreshTavernProfilesButton.length) {
            $refreshTavernProfilesButton.on('click', loadTavernApiProfiles_ACU);
        }
        if ($tavernProfileSelect.length) {
            $tavernProfileSelect.on('change', function() {
                const result = setTavernProfile_ACU(String(jQuery_API_ACU(this).val() || ''));
                if (!result.ok) {
                    showToastr_ACU('error', result.message || '保存酒馆API预设失败，已回滚。');
                    return;
                }
            });
        }


      // ═══ 调用各子模块绑定函数 ═══
      await bindStatusEvents_ACU();
      await bindWorldbookEvents_ACU();
      await bindDataEvents_ACU();
      await bindPlotEvents_ACU();
      await bindOptimizationEvents_ACU();
      if (isSqliteMode()) {
          await bindSqlConsoleEvents_ACU();
      }
      await bindLogViewerEvents_ACU();

      // Removed call to applyActualMessageVisibility_ACU();
      // Removed call to updateAdvancedHideUIDisplay_ACU();
      if (typeof updateCardUpdateStatusDisplay_ACU === 'function') updateCardUpdateStatusDisplay_ACU();
      showToastr_ACU('success', '数据库更新工具已加载。');
  }