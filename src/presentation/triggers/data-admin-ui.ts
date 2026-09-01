import { deriveTemplatePresetNameForImport_ACU, getCurrentTemplatePresetName_ACU, normalizeTemplatePresetSelectionValue_ACU, sanitizeFilenameComponent_ACU } from '../../shared/template-preset-utils';
import { renderPromptSegments_ACU } from '../components/plot-editors';
import { getDefaultTemplateSnapshot_ACU, getTemplatePreset_ACU, resolveTemplateForExport_ACU } from '../../service/template/template-preset-service';
import { showToastr_ACU } from '../theme/toast';
import { ACU_TOAST_CATEGORY_ACU } from '../../shared/constants';
import { isSqliteMode } from '../../service/table/storage-mode';
import { reloadStorageProvider } from '../../service/table/table-storage-strategy';
import { getChatArray_ACU, deleteLocalDataWithScope_ACU, overrideLatestLayerWithTemplateCore_ACU } from '../../service/chat/chat-service';
import { isWorldbookApiAvailable_ACU } from '../../service/worldbook/worldbook-service';
import { cleanupWorldbookEntriesAfterDataDeletion_ACU } from '../../service/worldbook/worldbook-cleanup';
import { currentChatFileIdentifier_ACU, currentJsonTableData_ACU, getCurrentIsolationKey_ACU, settings_ACU } from '../../service/runtime/state-manager';
import { $popupInstance_ACU } from '../state/ui-refs';
import { resetAllPromptsToDefault_ACU } from '../../service/settings/settings-write-service';
import { sanitizeChatSheetsObject_ACU } from '../../service/template/chat-scope';
import { refreshMergedDataAndNotifyWithUI_ACU, refreshPresetUIAfterSwitch_ACU } from '../components/pipeline-ui-helpers';
import { SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';

import { ensureSheetOrderNumbers_ACU, logDebug_ACU, logError_ACU, logWarn_ACU, parseTableTemplateJson_ACU } from '../../shared/utils';
import { loadOrCreateJsonTableFromChatHistory_ACU } from '../../service/table/table-service';
import { applyChatTemplateSnapshotWithReconciliation_ACU, applyTemplateSnapshotToScope_ACU, normalizeTemplateOperationScope_ACU, parseImportedTemplateData_ACU, upsertTemplatePreset_ACU } from '../../service/template/template-preset-service';
import { applyCombinedSettingsImport_ACU } from '../../service/settings/settings-service';
import { getTemplatePresetSelectJQ_ACU, refreshTemplatePresetSelectInUI_ACU } from '../components/template-preset-ui';
import { updateCardUpdateStatusDisplay_ACU } from '../components/update-status-display';
import { migrateLegacySummaryVectorIndexToContentAddressed_ACU } from '../../service/vector/summary-vector-index-archive-service';
/**
 * presentation/triggers/data-admin-ui.ts — 导入/导出/重置 UI
 * 从 features/data/01_data_admin.js 迁移而来
 */

  export function importCombinedSettings_ACU() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = e => {
        const file = (e.target as any).files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (readerEvent) => {
            const content = readerEvent.target.result;
            let combinedData;

            try {
                combinedData = JSON.parse(content as string);
            } catch (error) {
                logError_ACU('导入合并配置失败：JSON解析错误。', error);
                showToastr_ACU('error', '文件不是有效的JSON格式。', { timeOut: 5000 });
                return;
            }
            
            try {
                // Validation
                if (!combinedData.prompt || !combinedData.template) {
                    throw new Error('JSON文件缺少 "prompt" 或 "template" 键。');
                }
                if (!Array.isArray(combinedData.prompt)) {
                    throw new Error('"prompt" 的值必须是一个数组。');
                }
                if (typeof combinedData.template !== 'object' || combinedData.template === null) {
                    throw new Error('"template" 的值必须是一个对象。');
                }

                // [重构] 调用 service 层导入配置
                const modifiedFields = applyCombinedSettingsImport_ACU(combinedData);
                logDebug_ACU(`Combined settings imported. Modified fields: ${modifiedFields.join(', ')}`);

                // UI 操作：渲染提示词段落
                renderPromptSegments_ACU(combinedData.prompt);
                showToastr_ACU('success', '提示词预设已成功导入并保存！');

                // 合并总结 UI 已停用；导入兼容仍保留 merge 字段，但不再尝试同步已移除的合并控件。
                if (modifiedFields.includes('mergeTargetCount')) {
                    const $deleteStartFloor = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-delete-start-floor`);
                    const $deleteEndFloor = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-delete-end-floor`);
                    if ($deleteStartFloor.length) $deleteStartFloor.val(settings_ACU.deleteStartFloor || 1);
                    if ($deleteEndFloor.length) $deleteEndFloor.val(settings_ACU.deleteEndFloor || '');
                }
                
                // 2. Apply and save template
                // [瘦身] 导入时清洗模板并回写（兼容旧模板带冗余字段）
                const sheetKeys = Object.keys(combinedData.template).filter(k => k.startsWith('sheet_'));
                ensureSheetOrderNumbers_ACU(combinedData.template, { baseOrderKeys: sheetKeys, forceRebuild: false });
                const sanitizedTemplate = sanitizeChatSheetsObject_ACU(combinedData.template, { ensureMate: true });
                const appliedTemplate = await applyTemplateSnapshotToScope_ACU(sanitizedTemplate, {
                    scope: 'global',
                    source: 'import_combined',
                    presetName: normalizeTemplatePresetSelectionValue_ACU(getCurrentTemplatePresetName_ACU(settings_ACU, { requireExisting: false })),
                    save: true,
                    persistChatScope: false,
                });
                if (!appliedTemplate || (typeof appliedTemplate === 'object' && 'saved' in appliedTemplate && (appliedTemplate as any).saved === false)) {
                    const reason = appliedTemplate && typeof appliedTemplate === 'object' && 'error' in appliedTemplate && typeof (appliedTemplate as any).error === 'string'
                        ? (appliedTemplate as any).error
                        : '';
                    throw new Error(reason || '合并配置中的表格模板已解析，但应用到全局模板失败。');
                }

                showToastr_ACU('success', '表格模板已成功导入！模板已更新，但不会影响当前聊天记录的本地数据。');

                // 刷新模板预设下拉 UI，确保预设列表与状态文案同步
                refreshPresetUIAfterSwitch_ACU();

                // [优化] 不再触发表格数据初始化，仅修改当前插件模板
                // 只有在新开卡或之前没有用过插件的聊天记录里才会使用新的通用模板作为基底
                showToastr_ACU('success', '合并配置已成功导入！');

            } catch (error) {
                logError_ACU('导入合并配置失败：结构验证失败。', error);
                showToastr_ACU('error', `导入失败: ${error.message}`, { timeOut: 10000 });
            }
        };
        reader.readAsText(file, 'UTF-8');
    };
    input.click();
  }

  // [新增] 删除聊天记录中的本地数据
  // 范围感知：mode='all' 且范围覆盖全部 AI 楼层时由服务层编排入口切换为硬清空 purge，
  // 其余情况走范围删除（deleteLocalDataInChatCore_ACU）。
  export async function deleteLocalDataInChat_ACU(mode: 'current' | 'all' = 'current', startFloor: any = null, endFloor: any = null) {
      const chat = getChatArray_ACU();
      if (!chat || chat.length === 0) {
          showToastr_ACU('warning', '聊天记录为空，无法执行删除操作。');
          return;
      }

      const aiMessageCount = chat.filter((msg: any) => !msg.is_user).length;
      const outcome = await deleteLocalDataWithScope_ACU(mode, startFloor, endFloor);

      // aiCount === 0 时不再提前 return：范围覆盖全部（含 0 层）的 all 请求会走 purge，
      // purge 仍需清理用户首条消息字段与 chat[0] scope/guide 镜像。
      // 只有走 range 路径且确实没有 AI 楼层时才提示无可删数据。
      if (outcome.path === 'range' && aiMessageCount === 0) {
          showToastr_ACU('warning', '聊天记录中没有AI消息，无法执行范围删除。');
          return;
      }

      if (outcome.path === 'aborted') {
          showToastr_ACU('warning', outcome.reason, { timeOut: 10000 });
          return;
      }

      if (outcome.path === 'purge') {
          await applyPurgeResultToUi_ACU(outcome.result);
          return;
      }

      const deletedCount = outcome.deletedCount;
      if (deletedCount > 0) {
          // 刷新内存和UI：删除楼层数据后，SQLite 运行时必须从当前聊天持久化模板/guide 重建
          await loadOrCreateJsonTableFromChatHistory_ACU();
          if (isSqliteMode()) await reloadStorageProvider();
          await refreshMergedDataAndNotifyWithUI_ACU();

          // [重构] 调用 service 层清理世界书条目
          await cleanupWorldbookEntriesAfterDataDeletion_ACU();

          if (typeof updateCardUpdateStatusDisplay_ACU === 'function') {
              updateCardUpdateStatusDisplay_ACU();
          }

          showToastr_ACU('success', `已成功删除 ${deletedCount} 条消息中的本地数据 (${mode === 'all' ? '所有标识' : '当前标识'})。`);
      } else {
          showToastr_ACU('info', '没有发现符合删除条件的数据。');
      }
  }

  /**
   * 硬清空（purge）结果落 UI（legacy 入口共用）。
   *
   * 与 range 删除的收尾差异：
   * purgeCurrentChatDatabaseState_ACU 内部已在严格保存后回落为当前全局模板的
   * header-only 空结构（S1-1，pristine：不写 frame，首次填表才建根），此处不再
   * loadOrCreate / reloadStorageProvider，只调 refreshMergedDataAndNotifyWithUI_ACU
   * 让面板展示回落后的模板空结构；世界书条目清理由 purge 内部完成
   * （cleanupDatabaseGeneratedWorldbookEntries_ACU），结果进入 result.cleanupWarnings。
   */
  export async function applyPurgeResultToUi_ACU(result: { saved: boolean; clearedMessageCount: number; removedMetadata: string[]; cleanupWarnings?: string[]; error?: string }): Promise<void> {
      if (!result.saved) {
          showToastr_ACU('error', result.error || '硬清空失败，详情见运行日志。', { timeOut: 10000 });
          return;
      }
      await refreshMergedDataAndNotifyWithUI_ACU();
      if (typeof updateCardUpdateStatusDisplay_ACU === 'function') {
          updateCardUpdateStatusDisplay_ACU();
      }
      const removed = result.removedMetadata.length ? `，移除元数据：${result.removedMetadata.join('、')}` : '';
      if (result.cleanupWarnings?.length) {
          showToastr_ACU('warning', `已硬清空全部本地数据（${result.clearedMessageCount} 条消息）${removed}。警告：${result.cleanupWarnings[0]}`, { timeOut: 10000 });
      } else {
          showToastr_ACU('success', `已删除所有本地数据（${result.clearedMessageCount} 条消息）${removed}。`);
      }
  }



  export async function migrateLegacySummaryVectorIndex_ACU() {
    try {
        const result = await migrateLegacySummaryVectorIndexToContentAddressed_ACU();
        if (result.success && !result.skipped) {
            showToastr_ACU('success', `旧交火索引已非破坏迁移：${result.indexedRowCount || 0} 行，${result.chunkCount || 0} 个 chunks。旧外置文件仍保留给历史楼层回退使用。`);
            return result;
        }
        if (result.success && result.skipped) {
            const reason = result.reason === 'already_content_addressed'
                ? '当前交火索引已经是内容寻址协议，无需迁移。'
                : '当前聊天没有可迁移的旧交火索引。';
            showToastr_ACU('info', reason);
            return result;
        }
        const reasonText = result.errors?.length ? result.errors.join('；') : (result.reason || '未知原因');
        showToastr_ACU('error', `旧交火索引迁移失败：${reasonText}`);
        return result;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error || '未知错误');
        logError_ACU('旧交火索引迁移失败:', error);
        showToastr_ACU('error', `旧交火索引迁移失败：${message}`);
        return { success: false, skipped: false, indexedRowCount: 0, skippedRowCount: 0, chunkCount: 0, reason: 'exception', errors: [message] };
    }
  }

  export function exportCurrentJsonData_ACU() {
    if (!currentJsonTableData_ACU) {
        showToastr_ACU('warning', '没有可导出的数据库。请先开始一个对话。');
        return;
    }
    try {
        const chatName = currentChatFileIdentifier_ACU || 'current_chat';
        const fileName = `TavernDB_data_${chatName}.json`;
        // [瘦身] Json导出时清洗冗余字段（兼容旧数据输入，但导出不再携带）
        const sanitized = sanitizeChatSheetsObject_ACU(currentJsonTableData_ACU, { ensureMate: true });
        const jsonString = JSON.stringify(sanitized, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToastr_ACU('success', '数据库JSON文件已成功导出！');
    } catch (error) {
        logError_ACU('导出JSON数据失败:', error);
        showToastr_ACU('error', '导出JSON失败，请检查控制台获取详情。');
    }
  }

  export function exportTableTemplate_ACU({ scope = 'global' } = {}) {
    const normalizedScope = normalizeTemplateOperationScope_ACU(scope);
    try {
        // [重构] 调用 service 层解析模板数据
        const selectedPresetName = String(getTemplatePresetSelectJQ_ACU()?.val?.() || '');
        const resolved = resolveTemplateForExport_ACU(normalizedScope, selectedPresetName);
        if (!resolved) {
            throw new Error('无法解析当前模板。');
        }

        const { jsonData, fromPresetName } = resolved;

        const sanitized = sanitizeChatSheetsObject_ACU(jsonData, { ensureMate: true });
        const jsonString = JSON.stringify(sanitized, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        if (fromPresetName) {
            const safePart = sanitizeFilenameComponent_ACU(fromPresetName) || 'template';
            a.download = normalizedScope === 'chat'
                ? `TavernDB_template_chat_${safePart}.json`
                : `TavernDB_template_${safePart}.json`;
        } else {
            a.download = normalizedScope === 'chat'
                ? 'TavernDB_template_chat_snapshot.json'
                : 'TavernDB_template.json';
        }
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (normalizedScope === 'chat') {
            showToastr_ACU('success', fromPresetName ? `当前聊天模板快照已成功导出：${fromPresetName}` : '当前聊天模板快照已成功导出！');
        } else {
            showToastr_ACU('success', fromPresetName ? `全局表格模板预设已成功导出：${fromPresetName}` : '全局表格模板已成功导出！(已包含最新导出参数)');
        }
        return true;
    } catch (error) {
        logError_ACU('导出模板失败:', error);
        showToastr_ACU('error', '导出模板失败，请检查控制台获取详情。');
        return false;
    }
  }

  export async function resetAllToDefaults_ACU() {
      if (!confirm('确定要同时恢复【默认AI指令预设】和【默认表格模板】吗？\n\n这将覆盖您当前的自定义设置。此操作不可撤销。')) {
          return false;
      }

      try {
          // [V1 收敛] 委托 service 事务式恢复默认提示词（含保存失败回滚），不再直写 settings_ACU。
          const promptResetResult = resetAllPromptsToDefault_ACU();
          if (!promptResetResult.ok) {
              showToastr_ACU('error', promptResetResult.message || '恢复默认提示词失败，已回滚。');
              return false;
          }

          const templateResetOk = await resetTableTemplate_ACU({
              showToast: false,
              updatePresetSelection: true,
              _refreshUi: false,
              overwriteReason: 'reset_all_defaults',
              scope: 'global',
              source: 'reset_all_defaults',
          });
          if (!templateResetOk) {
              showToastr_ACU('error', '恢复默认设置失败：默认表格模板恢复失败。');
              return false;
          }

          refreshTemplatePresetSelectInUI_ACU({ selectName: '', keepValue: false });
          showToastr_ACU('success', '已恢复默认预设及模板！模板已更新，但不会影响当前聊天记录的本地数据。');
          return true;
      } catch (error) {
          logError_ACU('恢复默认设置失败:', error);
          showToastr_ACU('error', '恢复默认设置失败，请检查控制台获取详情。');
          return false;
      }
  }

  // [新增] 使用通用模板覆盖最新层所有表格数据的函数
  export async function overrideLatestLayerWithTemplate_ACU() {
      if (!confirm('⚠️ 警告：此操作将使用当前通用模板覆盖聊天记录中最新一层的所有表格数据！\n\n' +
                  '• 模板中有的表格会被覆盖（只保留表头，数据清空）\n' +
                  '• 模板中没有的表格会被忽略（本地数据保持不变）\n' +
                  '• 此操作仅影响最新的一条AI消息\n' +
                  '• 删除最新层的聊天数据后即可恢复正常\n\n' +
                  '确定要继续吗？')) {
          return;
      }

      const chat = getChatArray_ACU();
      if (!chat || chat.length === 0) {
          showToastr_ACU('error', '聊天记录为空，无法执行覆盖操作。');
          return;
      }

      // 解析通用模板
      const templateData = parseTableTemplateJson_ACU({ stripSeedRows: true });
      if (!templateData) {
          showToastr_ACU('error', '无法解析通用模板，请检查模板格式。');
          return;
      }

      // 检查是否有AI消息
      const hasAiMessage = chat.some((msg: any) => !msg.is_user);
      if (!hasAiMessage) {
          showToastr_ACU('error', '聊天记录中没有AI消息，无法执行覆盖操作。');
          return;
      }

      // 调用 service 层核心逻辑执行覆盖
      const modifiedCount = await overrideLatestLayerWithTemplateCore_ACU(templateData);

      if (modifiedCount > 0) {
          // 刷新内存和UI
          await loadOrCreateJsonTableFromChatHistory_ACU();
          await refreshMergedDataAndNotifyWithUI_ACU();

          showToastr_ACU('success', `已使用通用模板覆盖最新层的${Object.keys(templateData).filter(k => k.startsWith('sheet_')).length}个表格数据。`);
      } else {
          showToastr_ACU('warning', '没有找到需要覆盖的表格数据。');
      }
  }

  export async function resetTableTemplate_ACU({ showToast = true, updatePresetSelection = true, _refreshUi = true, overwriteReason = 'reset_template', scope = 'global', source = '' } = {}) {
    const normalizedScope = normalizeTemplateOperationScope_ACU(scope);
    try {
        const snapshot = getDefaultTemplateSnapshot_ACU();
        if (!snapshot?.templateStr) {
            throw new Error('无法解析默认模板。');
        }

        const result = await applyTemplateSnapshotToScope_ACU(snapshot.templateStr, {
            scope: normalizedScope,
            source: source || overwriteReason || (normalizedScope === 'chat' ? 'ui_chat_reset' : 'ui_global_reset'),
            presetName: '',
            save: true,
            persistChatScope: normalizedScope === 'chat',
        });
        if (!result || (typeof result === 'object' && 'saved' in result && result.saved === false)) {
            throw new Error('应用默认模板快照失败。');
        }

        if (showToast) {
            if (normalizedScope === 'chat') {
                const warning = typeof result === 'object' && 'postCommitWarning' in result && typeof result.postCommitWarning === 'string'
                    ? result.postCommitWarning
                    : '';
                showToastr_ACU(warning ? 'warning' : 'success', warning || '当前聊天模板已恢复为默认值！仅影响当前聊天，不会改动全局模板。', {
                    acuToastCategory: warning ? ACU_TOAST_CATEGORY_ACU.ERROR : ACU_TOAST_CATEGORY_ACU.IMPORT,
                });
            } else {
                showToastr_ACU('success', '全局模板已恢复为默认值！模板已更新，但不会影响当前聊天记录的本地数据。');
            }
        }
        logDebug_ACU(`Table template has been reset to default for scope: ${normalizedScope}. updatePresetSelection=${updatePresetSelection}`);
        return true;
    } catch (error) {
        logError_ACU('恢复默认模板失败:', error);
        if (showToast) {
            showToastr_ACU('error', '恢复默认模板失败，请检查控制台获取详情。');
        }
        return false;
    }
  }

  export function importTableTemplate_ACU({ scope = 'global' } = {}) {
    const normalizedScope = normalizeTemplateOperationScope_ACU(scope);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = e => {
        const file = (e.target as any).files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (readerEvent) => {
            try {
                const content = String(readerEvent?.target?.result || '');
                const prepared = parseImportedTemplateData_ACU(content);
                const derivedPresetName = deriveTemplatePresetNameForImport_ACU({
                    filename: file?.name,
                    fallbackLabel: normalizedScope === 'global'
                        ? `导入模板_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`
                        : '',
                });

                if (normalizedScope === 'global') {
                    // ═══ 全局导入：仅保存到预设库，不自动切换当前生效模板 ═══
                    // 用户可随后通过下拉手动切换到新导入的预设
                    let savePresetOk = false;
                    if (derivedPresetName) {
                        try {
                            savePresetOk = upsertTemplatePreset_ACU(derivedPresetName, prepared.templateStr);
                        } catch (presetError) {
                            savePresetOk = false;
                            logWarn_ACU('[TemplateScope] 导入全局模板后保存预设失败:', presetError);
                        }
                    }

                    // 刷新 UI 让新预设立即出现在下拉列表中，但保持当前选中值不变
                    refreshPresetUIAfterSwitch_ACU({ keepTemplateGlobalValue: true });

                    if (savePresetOk) {
                        showToastr_ACU('success', `模板已保存为全局预设：${derivedPresetName}（同名自动覆盖）。你可以在"全局模板预设"下拉中手动切换到它。`, {
                            acuToastCategory: ACU_TOAST_CATEGORY_ACU.IMPORT,
                        });
                    } else if (derivedPresetName) {
                        showToastr_ACU('warning', `模板已解析，但保存到预设库失败：${derivedPresetName}`, {
                            acuToastCategory: ACU_TOAST_CATEGORY_ACU.ERROR,
                        });
                    } else {
                        showToastr_ACU('warning', '模板已解析，但无法确定预设名称，未保存到预设库。', {
                            acuToastCategory: ACU_TOAST_CATEGORY_ACU.ERROR,
                        });
                    }
                    logDebug_ACU(`[TemplateScope] Template imported to global preset library: ${derivedPresetName}. saveOk=${savePresetOk}`);
                } else {
                    const applied = await applyChatTemplateSnapshotWithReconciliation_ACU(prepared.templateObj, {
                        source: 'ui_chat_import',
                        presetName: derivedPresetName,
                    });
                    if (!applied.saved) {
                        throw new Error(applied.error || '模板已解析，但应用到当前聊天失败。');
                    }

                    refreshPresetUIAfterSwitch_ACU({ keepTemplateGlobalValue: true });
                    const warning = 'postCommitWarning' in applied && typeof applied.postCommitWarning === 'string'
                        ? applied.postCommitWarning
                        : '';
                    showToastr_ACU(
                        warning ? 'warning' : 'success',
                        warning || `当前聊天模板快照已导入${derivedPresetName ? `（预设名：${derivedPresetName}）` : ''}。`,
                        { acuToastCategory: warning ? ACU_TOAST_CATEGORY_ACU.ERROR : ACU_TOAST_CATEGORY_ACU.IMPORT },
                    );
                    logDebug_ACU(`[TemplateScope] Template imported to chat scope: ${derivedPresetName}.`);
                }
            } catch (error) {
                logError_ACU('导入模板失败：', error);
                showToastr_ACU('error', `导入失败: ${error.message}`, {
                    acuToastCategory: ACU_TOAST_CATEGORY_ACU.ERROR,
                    timeOut: 10000,
                });
            }
        };
        reader.onerror = error => {
            logError_ACU('导入模板失败：文件读取失败。', error);
            showToastr_ACU('error', '读取模板文件失败，请重试。', {
                acuToastCategory: ACU_TOAST_CATEGORY_ACU.ERROR,
                timeOut: 10000,
            });
        };
        reader.readAsText(file, 'UTF-8');
    };
    input.click();
  }

  // --- [New Visualizer & Inheritance Module] ---

  // CSS for the Visualizer - 墨韵清雅设计系统（古典中国风）