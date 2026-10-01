// popup-bindings-status.ts
// 状态&操作标签页事件绑定（对话编辑器 + 设置参数自动保存 + checkbox）

import { showToastr_ACU } from '../theme/toast';
import { ACU_TOAST_CATEGORY_ACU, SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';
import { logDebug_ACU, logError_ACU, logWarn_ACU } from '../../shared/utils';
import { jQuery_API_ACU } from '../dom-utils';
import { settings_ACU } from '../../service/runtime/state-manager';
import { $popupInstance_ACU, $charCardPromptSegmentsContainer_ACU, $autoUpdateTokenThresholdInput_ACU, $autoUpdateThresholdInput_ACU, $autoUpdateFrequencyInput_ACU, $updateBatchSizeInput_ACU, $maxConcurrentGroupsInput_ACU, $skipUpdateFloorsInput_ACU, $retainRecentLayersInput_ACU, $tableMaxRetriesInput_ACU, $autoUpdateEnabledCheckbox_ACU, $standardizedTableFillEnabledCheckbox_ACU, $toastMuteEnabledCheckbox_ACU, $promptTemplateEnabledCheckbox_ACU, $tableEditLastPairOnlyCheckbox_ACU, $manualUpdateCardButton_ACU, $manualTableSelectAll_ACU, $manualTableSelectNone_ACU } from '../state/ui-refs';
import { saveSettingsAndNotify_ACU } from '../components/settings-ui-helpers';
import { saveAutoUpdateFrequency_ACU, saveAutoUpdateThreshold_ACU, saveAutoUpdateTokenThreshold_ACU, saveMaxConcurrentGroups_ACU, saveRetainRecentLayers_ACU, saveSkipUpdateFloors_ACU, saveTableMaxRetries_ACU, saveUpdateBatchSize_ACU } from '../triggers/settings-ui-sync';
import { setStorageMode_ACU, setAutoUpdateEnabled_ACU } from '../../service/settings/settings-write-service';
import { handleManualUpdate_ACU } from '../triggers/update-process';
import { handleManualSelectAll_ACU, handleManualSelectNone_ACU } from '../components/table-selector';
import { renderPromptSegments_ACU, getCharCardPromptFromUI_ACU } from '../components/plot-editors';
import { switchStorageMode } from '../../service/table/table-storage-strategy';
import { getCurrentStorageMode } from '../../service/table/storage-mode';

/**
 * 绑定状态&操作标签页的所有事件（对话编辑器 + 设置参数 + checkbox + 手动更新）
 */
export async function bindStatusEvents_ACU(): Promise<void> {
      // --- [新增] 对话编辑器事件绑定 ---
      $popupInstance_ACU.on('click', `.${SCRIPT_ID_PREFIX_ACU}-add-prompt-segment-btn`, function() {
          const position = jQuery_API_ACU(this).data('position');
          const newSegment = { role: 'USER', content: '', deletable: true };
          let segments = getCharCardPromptFromUI_ACU();
          if (position === 'top') {
              segments.unshift(newSegment);
          } else {
              segments.push(newSegment);
          }
          renderPromptSegments_ACU(segments);
      });

      $popupInstance_ACU.on('click', '.prompt-segment-delete-btn', function() {
          const indexToDelete = jQuery_API_ACU(this).data('index');
          let segments = getCharCardPromptFromUI_ACU();
          segments.splice(indexToDelete, 1);
          renderPromptSegments_ACU(segments);
      });

      // [新增] 主提示词槽位切换事件（A/B 两个槽位，各自保持唯一）
      $popupInstance_ACU.on('change', '.prompt-segment-main-slot', function() {
          const $currentSegment = jQuery_API_ACU(this).closest('.prompt-segment');
          const selected = String(jQuery_API_ACU(this).val() || '').toUpperCase();

          // 1) A/B 槽位唯一：同槽位的其他段落自动改为"普通"
          if (selected === 'A' || selected === 'B') {
            $charCardPromptSegmentsContainer_ACU
              .find('.prompt-segment')
              .not($currentSegment)
              .each(function() {
                const $seg = jQuery_API_ACU(this);
                const v = String($seg.find('.prompt-segment-main-slot').val() || '').toUpperCase();
                if (v === selected) {
                  $seg.find('.prompt-segment-main-slot').val('');
                }
              });
          }

          // 2) 统一刷新样式与删除按钮可见性
          $charCardPromptSegmentsContainer_ACU.find('.prompt-segment').each(function() {
            const $seg = jQuery_API_ACU(this);
            const slot = String($seg.find('.prompt-segment-main-slot').val() || '').toUpperCase();
            const isA = slot === 'A';
            const isB = slot === 'B';
            const isMain = isA || isB;
            const borderColor = isA ? 'var(--accent-primary)' : (isB ? '#ffb74d' : '');
            if (isMain) {
              $seg.css('border-left', `3px solid ${borderColor}`).attr('data-main-slot', slot);
              $seg.find('.prompt-segment-delete-btn').hide();
            } else {
              $seg.css('border-left', '').attr('data-main-slot', '');
              $seg.find('.prompt-segment-delete-btn').show();
            }
          });
      });
      

      // [优化] 填表相关参数：取消"保存按钮"，改为输入后自动保存（与剧情推进一致）
      const bindAutoSaveNumberInput_ACU = ($input: JQuery<HTMLElement> | null, saveFn: Function, debounceMs = 450) => {
          if (!$input || !$input.length || typeof saveFn !== 'function') return;
          let t: ReturnType<typeof setTimeout> | null = null;
          const run = () => saveFn({ silent: true, skipReload: true });
          $input.off('input.acu_autosave change.acu_autosave blur.acu_autosave')
              .on('input.acu_autosave', function() {
                  clearTimeout(t);
                  t = setTimeout(run, debounceMs);
              })
              .on('change.acu_autosave blur.acu_autosave', function() {
                  clearTimeout(t);
                  run();
              });
      };

      bindAutoSaveNumberInput_ACU($autoUpdateTokenThresholdInput_ACU, saveAutoUpdateTokenThreshold_ACU);
      bindAutoSaveNumberInput_ACU($autoUpdateThresholdInput_ACU, saveAutoUpdateThreshold_ACU);
      bindAutoSaveNumberInput_ACU($autoUpdateFrequencyInput_ACU, saveAutoUpdateFrequency_ACU);
      bindAutoSaveNumberInput_ACU($updateBatchSizeInput_ACU, saveUpdateBatchSize_ACU);
      bindAutoSaveNumberInput_ACU($maxConcurrentGroupsInput_ACU, saveMaxConcurrentGroups_ACU);
      bindAutoSaveNumberInput_ACU($skipUpdateFloorsInput_ACU, saveSkipUpdateFloors_ACU);
      bindAutoSaveNumberInput_ACU($retainRecentLayersInput_ACU, saveRetainRecentLayers_ACU);
      bindAutoSaveNumberInput_ACU($tableMaxRetriesInput_ACU, saveTableMaxRetries_ACU); // [新增] 填表重试次数
      if ($autoUpdateEnabledCheckbox_ACU.length) {
        $autoUpdateEnabledCheckbox_ACU.on('change', function () {
          const enabled = jQuery_API_ACU(this).is(':checked');
          const result = setAutoUpdateEnabled_ACU(enabled);
          if (!result.ok) {
            showToastr_ACU('error', result.message || '保存自动更新开关失败，已回滚。');
            jQuery_API_ACU(this).prop('checked', !enabled);
            return;
          }
          logDebug_ACU('数据库自动更新启用状态已保存:', enabled);
          showToastr_ACU('info', `数据库自动更新已 ${enabled ? '启用' : '禁用'}`);
        });
      }
      if ($standardizedTableFillEnabledCheckbox_ACU && $standardizedTableFillEnabledCheckbox_ACU.length) {
        $standardizedTableFillEnabledCheckbox_ACU.on('change', function () {
          settings_ACU.standardizedTableFillEnabled = jQuery_API_ACU(this).is(':checked');
          saveSettingsAndNotify_ACU();
          logDebug_ACU('规范填表功能启用状态已保存:', settings_ACU.standardizedTableFillEnabled);
          showToastr_ACU('info', `规范填表功能已 ${settings_ACU.standardizedTableFillEnabled ? '开启' : '关闭'}`, {
            acuToastCategory: ACU_TOAST_CATEGORY_ACU.MANUAL_TABLE,
          });
        });
      }
      if ($toastMuteEnabledCheckbox_ACU && $toastMuteEnabledCheckbox_ACU.length) {
        $toastMuteEnabledCheckbox_ACU.on('change', function () {
          settings_ACU.toastMuteEnabled = jQuery_API_ACU(this).is(':checked');
          saveSettingsAndNotify_ACU();
          logDebug_ACU('静默提示框启用状态已保存:', settings_ACU.toastMuteEnabled);
          // 该提示属于"导入/手动操作类"允许项，避免用户开启后无反馈
          showToastr_ACU('info', `静默提示框已 ${settings_ACU.toastMuteEnabled ? '开启' : '关闭'}`, {
            acuToastCategory: ACU_TOAST_CATEGORY_ACU.IMPORT,
          });
        });
      }
      if ($promptTemplateEnabledCheckbox_ACU && $promptTemplateEnabledCheckbox_ACU.length) {
        $promptTemplateEnabledCheckbox_ACU.on('change', function () {
          if (!settings_ACU.promptTemplateSettings) {
            settings_ACU.promptTemplateSettings = { enabled: true, maxNestingDepth: 10, debugMode: false };
          }
          settings_ACU.promptTemplateSettings.enabled = jQuery_API_ACU(this).is(':checked');
          saveSettingsAndNotify_ACU();
          logDebug_ACU('条件模板功能启用状态已保存:', settings_ACU.promptTemplateSettings.enabled);
          showToastr_ACU('info', `条件模板功能已 ${settings_ACU.promptTemplateSettings.enabled ? '开启' : '关闭'}`, {
            acuToastCategory: ACU_TOAST_CATEGORY_ACU.MANUAL_TABLE,
          });
        });
      }
      if ($tableEditLastPairOnlyCheckbox_ACU && $tableEditLastPairOnlyCheckbox_ACU.length) {
        $tableEditLastPairOnlyCheckbox_ACU.on('change', function () {
          settings_ACU.tableEditLastPairOnly = jQuery_API_ACU(this).is(':checked');
          saveSettingsAndNotify_ACU();
          logDebug_ACU('仅识别最后一对 tableEdit 启用状态已保存:', settings_ACU.tableEditLastPairOnly);
          showToastr_ACU('info', `tableEdit 解析将${settings_ACU.tableEditLastPairOnly ? '仅使用最后一对标签' : '按全部标签优先匹配'}`, {
            acuToastCategory: ACU_TOAST_CATEGORY_ACU.MANUAL_TABLE,
          });
        });
      }
      // [新增] 统一的手动更新按钮
      if ($manualUpdateCardButton_ACU && $manualUpdateCardButton_ACU.length) {
          // 包一层箭头函数：不把 jQuery 事件对象当作 options 传入，按钮点击始终保留确认框。
          $manualUpdateCardButton_ACU.on('click', () => { void handleManualUpdate_ACU(); });
      }

      // 手动更新表选择：全选 / 全不选
      if ($manualTableSelectAll_ACU && $manualTableSelectAll_ACU.length) {
          $manualTableSelectAll_ACU.on('click', handleManualSelectAll_ACU);
      }
      if ($manualTableSelectNone_ACU && $manualTableSelectNone_ACU.length) {
          $manualTableSelectNone_ACU.on('click', handleManualSelectNone_ACU);
      }

      // [新增] 存储模式切换（原生 / SQLite）
      const $storageModeRadios = $popupInstance_ACU.find(`input[name="${SCRIPT_ID_PREFIX_ACU}-storage-mode"]`);
      if ($storageModeRadios.length) {
          // 初始化：根据当前设置选中对应的 radio
          const currentMode = getCurrentStorageMode();
          $storageModeRadios.filter(`[value="${currentMode}"]`).prop('checked', true);

          $storageModeRadios.on('change', async function() {
              const selectedMode = String(jQuery_API_ACU(this).val() || 'native') as 'native' | 'sqlite';
              const previousMode = getCurrentStorageMode();
              if (selectedMode === previousMode) return;

              const targetModeLabel = selectedMode === 'sqlite' ? 'SQLite' : '原生';
              showToastr_ACU('info', `正在切换到 ${targetModeLabel} 模式...`);

              try {
                  // [V1 收敛] 先通过 service 原子写 settings（含提示词重置）；
                  // 保存失败即返回，不触发 provider 切换。与 V2 useDashboardPage.setStorageMode 语义一致。
                  const writeResult = setStorageMode_ACU(selectedMode);
                  if (!writeResult.ok) {
                      showToastr_ACU('error', writeResult.message || '存储模式保存失败。');
                      $storageModeRadios.filter(`[value="${previousMode}"]`).prop('checked', true);
                      return;
                  }

                  // 执行模式切换（包含数据重载和 fallback）
                  await switchStorageMode(selectedMode);

                  showToastr_ACU('success', `已切换到 ${targetModeLabel} 模式，数据已重新加载。`);
                  logDebug_ACU(`存储模式已切换: ${previousMode} → ${selectedMode}`);
              } catch (e: any) {
                  // 切换失败：回滚 settings 到切换前的模式，避免 storageMode 与运行时 provider 分叉。
                  const fallbackMode = getCurrentStorageMode(); // switchStorageMode 内部可能已 fallback
                  const rollbackResult = setStorageMode_ACU(fallbackMode);
                  if (!rollbackResult.ok) {
                      logError_ACU('存储模式回滚失败:', rollbackResult.message);
                  }
                  $storageModeRadios.filter(`[value="${fallbackMode}"]`).prop('checked', true);

                  logError_ACU(`存储模式切换失败: ${e?.message}`);
                  showToastr_ACU('error', `模式切换失败: ${e?.message || '未知错误'}。已回退到${fallbackMode === 'sqlite' ? 'SQLite' : '原生'}模式。`);
              }
          });
      }

      // Removed $advHideToggle event listener
}
