/**
 * useDataManagement — 数据管理页业务流编排
 *
 * v2 页面只依赖本 composable；旧 settings / chat / worldbook / template service
 * 调用集中在这里，避免 Vue 组件跨进旧 presentation 层。
 */
import { computed, reactive, ref } from 'vue';
import { DEFAULT_MERGE_SUMMARY_PROMPT_ACU, DEFAULT_MERGE_SUMMARY_PROMPT_SQL_ACU } from '../../shared/defaults-json.js';
import { normalizeIsolationCode_ACU } from '../../shared/data-constants';
import { ensureSheetOrderNumbers_ACU, logError_ACU, parseTableTemplateJson_ACU } from '../../shared/utils';
import { readIsolatedTagData_ACU } from '../../data/repositories/chat-message-data-repo';
import { currentChatFileIdentifier_ACU, currentJsonTableData_ACU, getCurrentIsolationKey_ACU, settings_ACU } from '../../service/runtime/state-manager';
import {
  applyTemplateScopeForCurrentChat_ACU,
  applyCombinedSettingsImport_ACU,
  getDataIsolationHistory_ACU,
  removeDataIsolationHistory_ACU,
  saveSettings_ACU,
  switchIsolationProfile_ACU,
} from '../../service/settings/settings-service';
import { normalizeResetDefaultsOptions, hasSelectedResetDefaultsOption, resetAllDefaults_ACU, type ResetDefaultsCleanupOptions } from '../../service/table/reset-defaults-service';
import { getCurrentStorageMode, isSqliteMode } from '../../service/table/storage-mode';
import { reloadStorageProvider } from '../../service/table/table-storage-strategy';
import { getChatArray_ACU, deleteLocalDataWithScope_ACU, isFullRangeDeletionRequest_ACU, overrideLatestLayerWithTemplateCore_ACU } from '../../service/chat/chat-service';
import { loadOrCreateJsonTableFromChatHistory_ACU } from '../../service/table/table-service';
import { cleanupWorldbookEntriesAfterDataDeletion_ACU } from '../../service/worldbook/worldbook-cleanup';
import { deleteAllGeneratedEntries_ACU, refreshMergedDataAndNotify_ACU } from '../../service/worldbook/pipeline';
import { applyTemplateSnapshotToScope_ACU } from '../../service/template/template-preset-service';
import { sanitizeChatSheetsObject_ACU } from '../../service/template/chat-scope';
import { buildCurrentTableCheckpoint_ACU, parseTableCheckpointFile_ACU, restoreTableCheckpointToLatestAi_ACU, type TableCheckpointFileV1_ACU } from '../../service/table/table-checkpoint-transfer';
import { buildRegisteredMixedStorageSnapshotTransfer_ACU, commitRegisteredMixedStorageDecision_ACU, getActiveMixedStorageDecisionSummary_ACU, type MixedStorageDecisionSummary_ACU } from '../../service/table/mixed-storage-decision-registry';
import type { MixedStorageCommitAction_ACU } from '../../shared/models/mixed-storage-commit-action';
import { commitPreparedV2Recovery_ACU, prepareV2Recovery_ACU, scanV2IsolationDiagnostics_ACU, type V2IsolationDiagnostic_ACU, type V2RecoverySummary_ACU } from '../../service/table/table-v2-recovery-service';
import { useToastStore } from '../stores/toast-store';

export type DataMgmtMessageKind = 'info' | 'success' | 'warning' | 'error';

export interface DataMgmtMessage {
  kind: DataMgmtMessageKind;
  text: string;
  at: number;
}

export type { ResetDefaultsCleanupKey, ResetDefaultsCleanupOptions } from '../../service/table/reset-defaults-service';

function setMessage(target: ReturnType<typeof ref<DataMgmtMessage | null>>, kind: DataMgmtMessageKind, text: string): void {
  target.value = { kind, text, at: Date.now() };
}

function normalizeFloorValue(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function normalizeRetainRecentLayers(value: unknown): number {
  if (value === '' || value === null || value === undefined) return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

async function readFileText(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('文件读取失败'));
    reader.readAsText(file, 'UTF-8');
  });
}

function formatCheckpointExportTimestamp(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('') + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function downloadJson(filename: string, data: unknown): void {
  const jsonString = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function getAiMessageCount(): number {
  const chat = getChatArray_ACU();
  return Array.isArray(chat) ? chat.filter((msg: any) => !msg?.is_user).length : 0;
}

function buildCombinedExportPayload(): Record<string, unknown> {
  const templateObj = parseTableTemplateJson_ACU({ stripSeedRows: false });
  if (!templateObj || typeof templateObj !== 'object') {
    throw new Error('无法解析当前模板。');
  }

  const sheetKeys = Object.keys(templateObj).filter(k => k.startsWith('sheet_'));
  ensureSheetOrderNumbers_ACU(templateObj, { baseOrderKeys: sheetKeys, forceRebuild: false });
  const templateData = sanitizeChatSheetsObject_ACU(templateObj, { ensureMate: true });

  return {
    prompt: Array.isArray(settings_ACU.charCardPrompt) ? settings_ACU.charCardPrompt : [],
    template: templateData,
    mergeSummaryPrompt: settings_ACU.mergeSummaryPrompt || (isSqliteMode() ? DEFAULT_MERGE_SUMMARY_PROMPT_SQL_ACU : DEFAULT_MERGE_SUMMARY_PROMPT_ACU),
    mergeTargetCount: settings_ACU.mergeTargetCount || 1,
    mergeBatchSize: settings_ACU.mergeBatchSize || 5,
    mergeStartIndex: settings_ACU.mergeStartIndex || 1,
    mergeEndIndex: settings_ACU.mergeEndIndex || null,
    autoMergeEnabled: settings_ACU.autoMergeEnabled || false,
    autoMergeThreshold: settings_ACU.autoMergeThreshold || 20,
    autoMergeReserve: settings_ACU.autoMergeReserve || 0,
    deleteStartFloor: settings_ACU.deleteStartFloor || null,
    deleteEndFloor: settings_ACU.deleteEndFloor || null,
  };
}

export function useDataManagement() {
  const toast = useToastStore();
  const message = ref<DataMgmtMessage | null>(null);
  const busyAction = ref('');
  const isolationCode = ref('');
  const activeIsolationCode = ref('');
  const mixedStorageDecision = ref<MixedStorageDecisionSummary_ACU | null>(null);
  const v2RecoverySummary = ref<V2RecoverySummary_ACU | null>(null);
  const v2IsolationDiagnostics = ref<V2IsolationDiagnostic_ACU[]>([]);
  const isolationHistory = ref<string[]>([]);
  const deleteRange = reactive({
    startFloor: 1 as number | string,
    endFloor: '' as number | string,
  });
  const retainRecentLayers = ref(100);
  const aiMessageCount = ref(0);

  const currentIsolationLabel = computed(() => {
    const code = activeIsolationCode.value;
    return code || '默认数据（未隔离）';
  });
  const isolationModeLabel = computed(() => (activeIsolationCode.value ? '已启用隔离' : '未启用隔离'));
  const isolationHistoryOptions = computed(() =>
    isolationHistory.value.map(code => ({ value: code, label: code })),
  );
  const rangeLabel = computed(() => {
    const start = normalizeFloorValue(deleteRange.startFloor);
    const end = normalizeFloorValue(deleteRange.endFloor);
    if (start && end) return `第 ${start} 到 ${end} 个 AI 楼层`;
    if (start) return `从第 ${start} 个 AI 楼层开始`;
    if (end) return `到第 ${end} 个 AI 楼层结束`;
    return '全部 AI 楼层';
  });
  const tableCount = computed(() =>
    currentJsonTableData_ACU && typeof currentJsonTableData_ACU === 'object'
      ? Object.keys(currentJsonTableData_ACU).filter(key => key.startsWith('sheet_')).length
      : 0,
  );

  function refresh(): void {
    const currentCode = normalizeIsolationCode_ACU(settings_ACU.dataIsolationCode || '');
    activeIsolationCode.value = currentCode;
    isolationCode.value = currentCode;
    isolationHistory.value = getDataIsolationHistory_ACU();
    deleteRange.startFloor = settings_ACU.deleteStartFloor || 1;
    deleteRange.endFloor = settings_ACU.deleteEndFloor || '';
    retainRecentLayers.value = normalizeRetainRecentLayers(settings_ACU.retainRecentLayers ?? 100);
    aiMessageCount.value = getAiMessageCount();
    mixedStorageDecision.value = getActiveMixedStorageDecisionSummary_ACU();
  }

  function getCheckpointTargetStorageMode(): 'native' | 'sqlite' {
    return getCurrentStorageMode();
  }

  async function applyIsolation(): Promise<void> {
    const targetCode = normalizeIsolationCode_ACU(isolationCode.value);
    busyAction.value = 'apply-isolation';
    try {
      await switchIsolationProfile_ACU(targetCode);
      refresh();
      activeIsolationCode.value = targetCode;
      isolationCode.value = targetCode;
      isolationHistory.value = getDataIsolationHistory_ACU();
      message.value = null;
      toast.success(`已切换到 ${targetCode || '默认数据（未隔离）'}。`);
    } catch (e: any) {
      logError_ACU('[ACU-V2] applyIsolation failed', e);
      message.value = null;
      toast.error('切换隔离标识失败，详情见运行日志。');
    } finally {
      busyAction.value = '';
    }
  }

  async function removeHistory(code: string): Promise<void> {
    const target = normalizeIsolationCode_ACU(code);
    if (!target) return;
    busyAction.value = 'remove-history';
    try {
      const wasActive = target === activeIsolationCode.value;
      if (wasActive) {
        await switchIsolationProfile_ACU('');
      }
      removeDataIsolationHistory_ACU(target);
      refresh();
      if (wasActive) {
        activeIsolationCode.value = '';
        isolationCode.value = '';
        isolationHistory.value = getDataIsolationHistory_ACU();
        message.value = null;
        toast.success(`已从历史记录移除标识：${target}；当前已切换到默认数据（未隔离）。`);
      } else {
        message.value = null;
        toast.success(`已从历史记录移除标识：${target}`);
      }
    } catch (e: any) {
      logError_ACU('[ACU-V2] removeHistory failed', e);
      message.value = null;
      toast.error('移除历史标识失败，详情见运行日志。');
    } finally {
      busyAction.value = '';
    }
  }

  async function deleteCurrentIsolationEntries(): Promise<void> {
    busyAction.value = 'delete-isolation-entries';
    try {
      await deleteAllGeneratedEntries_ACU();
      message.value = null;
      toast.success('已删除当前标识对应的数据库注入条目。');
    } catch (e: any) {
      logError_ACU('[ACU-V2] deleteCurrentIsolationEntries failed', e);
      message.value = null;
      toast.error('删除注入条目失败，详情见运行日志。');
    } finally {
      busyAction.value = '';
    }
  }

  async function importCombinedSettings(file: File): Promise<void> {
    busyAction.value = 'import-combined';
    try {
      const text = await readFileText(file);
      const combinedData = JSON.parse(text);
      if (!Array.isArray(combinedData?.prompt)) throw new Error('"prompt" 的值必须是数组。');
      if (!combinedData?.template || typeof combinedData.template !== 'object') throw new Error('缺少有效的 "template" 对象。');

      applyCombinedSettingsImport_ACU(combinedData);
      const applied = await applyTemplateSnapshotToScope_ACU(combinedData.template, {
        scope: 'global',
        source: 'v2_import_combined',
        presetName: '',
        save: true,
        persistChatScope: false,
      });
      if (!applied) throw new Error('模板结构无效，无法应用到当前全局模板。');
      if (typeof applied === 'object' && 'saved' in applied && applied.saved === false) {
        throw new Error((applied as any).error || '模板已解析，但应用到当前全局模板失败（当前聊天协调提交被拒绝）。');
      }
      refresh();
      message.value = null;
      toast.success('合并配置已导入：提示词、合并设置和全局模板已更新。', { muteable: false });
    } catch (e: any) {
      logError_ACU('[ACU-V2] importCombinedSettings failed', e);
      setMessage(message, 'error', `合并导入失败：${e?.message || '未知错误'}`);
    } finally {
      busyAction.value = '';
    }
  }

  function exportCombinedSettings(): void {
    try {
      const payload = buildCombinedExportPayload();
      downloadJson('TavernDB_Combined_Settings.json', payload);
      message.value = null;
      toast.success('合并配置已导出。');
    } catch (e: any) {
      logError_ACU('[ACU-V2] exportCombinedSettings failed', e);
      message.value = null;
      toast.error('合并配置导出失败，详情见运行日志。');
    }
  }

  function exportJsonData(): void {
    if (!currentJsonTableData_ACU) {
      message.value = null;
      toast.warning('没有可导出的数据库。请先开始一个对话或加载当前聊天数据。');
      return;
    }
    try {
      const sanitized = sanitizeChatSheetsObject_ACU(currentJsonTableData_ACU, { ensureMate: true });
      const chatName = String(currentChatFileIdentifier_ACU || 'current_chat').replace(/[\\/:*?"<>|]+/g, '_');
      downloadJson(`TavernDB_data_${chatName}.json`, sanitized);
      message.value = null;
      toast.success('当前聊天数据库 JSON 已导出。');
    } catch (e: any) {
      logError_ACU('[ACU-V2] exportJsonData failed', e);
      message.value = null;
      toast.error('导出 JSON 失败，详情见运行日志。');
    }
  }

  function exportTableCheckpoint(): void {
    try {
      const checkpoint = buildCurrentTableCheckpoint_ACU();
      const chatName = String(currentChatFileIdentifier_ACU || 'current_chat').replace(/[\\/:*?"<>|]+/g, '_');
      downloadJson(`TavernDB_checkpoint_${chatName}_${formatCheckpointExportTimestamp()}.json`, checkpoint);
      message.value = null;
      toast.success('当前聊天 Checkpoint 已导出。');
    } catch (e: any) {
      logError_ACU('[ACU-V2] exportTableCheckpoint failed', e);
      message.value = null;
      toast.error(`导出 Checkpoint 失败：${e?.message || '未知错误'}`);
    }
  }

  function exportMixedStorageSnapshots(): void {
    const decision = mixedStorageDecision.value;
    if (!decision) {
      toast.warning('当前没有可导出的混合存储决议。');
      return;
    }
    busyAction.value = 'export-mixed-storage-snapshots';
    try {
      const transfer = buildRegisteredMixedStorageSnapshotTransfer_ACU(decision.decisionId);
      downloadJson(transfer.legacy.filename, transfer.legacy.payload);
      downloadJson(transfer.v2.filename, transfer.v2.payload);
      toast.success('已导出 legacy-v1 与 V2 两份混合存储快照。');
    } catch (e: any) {
      logError_ACU('[ACU-V2] exportMixedStorageSnapshots failed', e);
      mixedStorageDecision.value = getActiveMixedStorageDecisionSummary_ACU();
      toast.error(`导出混合存储快照失败：${e?.message || '未知错误'}`);
    } finally {
      busyAction.value = '';
    }
  }

  async function commitMixedStorageDecision(action: MixedStorageCommitAction_ACU): Promise<void> {
    const decision = mixedStorageDecision.value;
    if (!decision) {
      toast.warning('混合存储决议已失效，请重新加载当前聊天。');
      return;
    }
    busyAction.value = `commit-mixed-storage-${action}`;
    try {
      const result = await commitRegisteredMixedStorageDecision_ACU(decision.decisionId, action);
      mixedStorageDecision.value = getActiveMixedStorageDecisionSummary_ACU();
      if (result.status === 'committed') {
        toast.success(action === 'keep_v2' ? '已保留 V2 数据并清理冗余 legacy 数据。' : '已提交经验证的混合存储合并候选。');
      } else if (result.status === 'committed_postcondition_failed') {
        toast.warning(`数据已保存，但后置校验失败：${result.error || '未知错误'}。请重新加载当前聊天后核对数据。`, { muteable: false, durationMs: 6000 });
      } else {
        toast.error(`混合存储提交失败：${result.error || '未知错误'}`);
      }
    } catch (e: any) {
      logError_ACU('[ACU-V2] commitMixedStorageDecision failed', e);
      mixedStorageDecision.value = getActiveMixedStorageDecisionSummary_ACU();
      toast.error(`混合存储决议已失效：${e?.message || '未知错误'}`);
    } finally {
      busyAction.value = '';
    }
  }

  async function scanV2IsolationDiagnostics(): Promise<void> {
    busyAction.value = 'scan-v2-isolation-diagnostics';
    try {
      v2IsolationDiagnostics.value = await scanV2IsolationDiagnostics_ACU();
      if (v2IsolationDiagnostics.value.length === 0) {
        toast.warning('当前聊天不存在 V2 storage frame，无法生成隔离域恢复诊断。');
      } else {
        toast.info(`已完成 ${v2IsolationDiagnostics.value.length} 个 V2 隔离域的只读诊断。`);
      }
    } catch (e: any) {
      logError_ACU('[ACU-V2] scanV2IsolationDiagnostics failed', e);
      v2IsolationDiagnostics.value = [];
      toast.error(`V2 隔离域诊断失败：${e?.message || '未知错误'}`);
    } finally {
      busyAction.value = '';
    }
  }

  async function prepareV2Recovery(): Promise<void> {
    busyAction.value = 'prepare-v2-recovery';
    try {
      v2RecoverySummary.value = await prepareV2Recovery_ACU();
      const summary = v2RecoverySummary.value;
      if (summary.status === 'recoverable_repaired_checkpoint') {
        toast.warning('检测到可修复的 V2 full checkpoint。请先导出原始 frame 备份，再确认提交。', { muteable: false, durationMs: 6000 });
      } else if (summary.status === 'recoverable_orphan_data_replace') {
        toast.warning('检测到无锚点 data_replace。该恢复必须经过两次明确确认。', { muteable: false, durationMs: 6000 });
      } else if (summary.status === 'recoverable_temporary_sheet_anchor') {
        toast.warning('检测到历史回放依赖临时 Sheet 补锚。请提交恢复，将兼容状态固化为 integrity_repair checkpoint。', { muteable: false, durationMs: 6000 });
      } else if (summary.status === 'recoverable_redundant_full_checkpoint') {
        toast.warning('检测到同一隔离键下存在多个 full checkpoint（回放只认最后一个，之前增量已失效）。请先导出原始 frame 备份，再提交收敛。', { muteable: false, durationMs: 6000 });
      } else if (summary.status === 'unrecoverable_late_checkpoint_artifacts') {
        toast.warning('检测到较晚 checkpoint 两侧均有 V2 artifact。自动前移会改变后缀回放语义；请先导出恢复备份，再人工核对。', { muteable: false, durationMs: 6000 });
      } else {
        toast.warning(summary.message, { muteable: false, durationMs: 6000 });
      }
    } catch (e: any) {
      logError_ACU('[ACU-V2] prepareV2Recovery failed', e);
      v2RecoverySummary.value = null;
      toast.error(`V2 恢复诊断失败：${e?.message || '未知错误'}`);
    } finally {
      busyAction.value = '';
    }
  }

  function exportV2RecoveryBackups(): void {
    const isolationKey = getCurrentIsolationKey_ACU();
    const backups = getChatArray_ACU().flatMap((message: any, messageIndex: number) => {
      if (message?.is_user) return [];
      const backup = readIsolatedTagData_ACU(message, isolationKey)?.recoveryBackup;
      return backup ? [{ messageIndex, backup: JSON.parse(JSON.stringify(backup)) }] : [];
    });
    if (backups.length === 0) {
      toast.warning('当前隔离标识没有可导出的 V2 恢复原始 frame 备份。');
      return;
    }
    try {
      const chatName = String(currentChatFileIdentifier_ACU || 'current_chat').replace(/[\/:*?"<>|]+/g, '_');
      downloadJson(`TavernDB_v2_recovery_backups_${chatName}_${formatCheckpointExportTimestamp()}.json`, { version: 1, isolationKey, backups });
      toast.success(`已导出 ${backups.length} 份 V2 恢复原始 frame 备份。`);
    } catch (e: any) {
      logError_ACU('[ACU-V2] exportV2RecoveryBackups failed', e);
      toast.error(`导出 V2 恢复备份失败：${e?.message || '未知错误'}`);
    }
  }

  async function commitV2Recovery(confirmOrphanDataReplace: boolean): Promise<void> {
    const summary = v2RecoverySummary.value;
    if (!summary?.planId || !summary.status.startsWith('recoverable_')) {
      toast.warning('V2 恢复计划已失效，请重新诊断。');
      return;
    }
    busyAction.value = 'commit-v2-recovery';
    try {
      const result = await commitPreparedV2Recovery_ACU(summary.planId, { confirmOrphanDataReplace });
      if (result.status === 'committed') {
        v2RecoverySummary.value = null;
        toast.success('V2 恢复已保存；原始 frame 已写入隔离备份。');
      } else if (result.status === 'committed_postcondition_failed') {
        v2RecoverySummary.value = null;
        toast.warning(`V2 恢复已保存，但后置校验失败：${result.error || '未知错误'}。请重新加载当前聊天核对数据。`, { muteable: false, durationMs: 6000 });
      } else {
        toast.error(`V2 恢复提交失败：${result.error || '未知错误'}`);
      }
    } catch (e: any) {
      logError_ACU('[ACU-V2] commitV2Recovery failed', e);
      toast.error(`V2 恢复提交异常：${e?.message || '未知错误'}`);
    } finally {
      busyAction.value = '';
    }
  }

  async function parseTableCheckpoint(file: File): Promise<TableCheckpointFileV1_ACU | null> {
    busyAction.value = 'parse-checkpoint';
    try {
      const parsed = parseTableCheckpointFile_ACU(await readFileText(file));
      if (parsed.success === false) throw new Error(parsed.error);
      return parsed.checkpoint;
    } catch (e: any) {
      logError_ACU('[ACU-V2] parseTableCheckpoint failed', e);
      message.value = null;
      toast.error(`Checkpoint 文件无效：${e?.message || '未知错误'}`);
      return null;
    } finally {
      busyAction.value = '';
    }
  }

  async function restoreTableCheckpoint(checkpoint: TableCheckpointFileV1_ACU): Promise<void> {
    busyAction.value = 'restore-checkpoint';
    try {
      const result = await restoreTableCheckpointToLatestAi_ACU(checkpoint);
      if (!result.success) throw new Error(result.error || 'Checkpoint 恢复失败。');
      refresh();
      message.value = null;
      const cleanupWarnings = result.cleanupWarnings || [];
      const derivedRefreshWarnings = result.derivedRefreshWarnings || [];
      const postCondition = result.postCondition;
      const postConditionFailures = !postCondition
        ? ['恢复后置条件缺失']
        : [
            !postCondition.runtimeMatches ? '运行时数据不一致' : '',
            !postCondition.scopeIsChatOverride ? '模板作用域不是 chat_override' : '',
            !postCondition.templateMatches ? '聊天模板快照不一致' : '',
            !postCondition.guideMatches ? '指导表不一致' : '',
          ].filter(Boolean);
      const providerFallback = getCurrentStorageMode() === 'sqlite' && postCondition?.providerMode === 'native';
      const warnings = [
        ...derivedRefreshWarnings.map(warning => `派生刷新：${warning}`),
        ...cleanupWarnings.map(warning => `清理：${warning}`),
      ];
      const targetMessage = `第 ${result.restoredMessageIndex! + 1} 条消息`;
      const providerMessage = `实际存储：${postCondition?.providerMode || '不可用'}`;
      if (warnings.length || postConditionFailures.length || providerFallback) {
        const reasons = [
          ...postConditionFailures,
          providerFallback ? '目标设置为 SQLite，实际存储 fallback 为 native' : '',
          ...warnings,
        ].filter(Boolean).join('；');
        toast.warning(`Checkpoint 已恢复到${targetMessage}，但属于部分成功：${providerMessage}；${reasons}。`, { muteable: false, durationMs: 6000 });
      } else {
        toast.success(`Checkpoint 已恢复到${targetMessage}；${providerMessage}。`, { muteable: false });
      }
      for (const warning of cleanupWarnings) logError_ACU('[ACU-V2] Checkpoint cleanup warning', warning);
      for (const warning of derivedRefreshWarnings) logError_ACU('[ACU-V2] Checkpoint derived refresh warning', warning);
    } catch (e: any) {
      logError_ACU('[ACU-V2] restoreTableCheckpoint failed', e);
      message.value = null;
      toast.error(`恢复 Checkpoint 失败：${e?.message || '未知错误'}`, { muteable: false });
    } finally {
      busyAction.value = '';
    }
  }

  async function resetAllDefaults(options: ResetDefaultsCleanupOptions = {}): Promise<void> {
    const cleanup = normalizeResetDefaultsOptions(options);
    if (!hasSelectedResetDefaultsOption(cleanup)) {
      toast.warning('未选择需要恢复或清理的项目。');
      return;
    }

    busyAction.value = 'reset-defaults';
    try {
      const outcome = await resetAllDefaults_ACU(cleanup);
      if (outcome.skipped) {
        message.value = null;
        toast.warning(outcome.failures[0]?.error || '未选择需要恢复或清理的项目。');
        return;
      }
      if (!outcome.success) {
        const hardFailures = outcome.failures.filter(f => f.step !== 'derived_refresh');
        const summary = outcome.failures.map(f => `${f.step}: ${f.error}`).join('；');
        message.value = null;
        if (hardFailures.length > 0) {
          toast.error(hardFailures.some(f => f.compensated)
            ? `恢复默认部分失败：${summary}`
            : `恢复默认失败：${summary}`);
        } else {
          toast.warning(`已按所选项目恢复默认配置，但后续刷新未完成：${summary}`);
        }
        return;
      }
      if (outcome.warnings.length) {
        toast.warning(`已按所选项目恢复默认配置，但部分后续刷新未完成：${outcome.warnings.join('；')}`);
      } else {
        toast.success('已按所选项目恢复默认配置。');
      }
      refresh();
      message.value = null;
    } catch (e: any) {
      logError_ACU('[ACU-V2] resetAllDefaults failed', e);
      message.value = null;
      toast.error('恢复默认失败，详情见运行日志。');
    } finally {
      busyAction.value = '';
    }
  }

  async function overrideLatestLayerWithTemplate(): Promise<void> {
    busyAction.value = 'override-latest';
    try {
      applyTemplateScopeForCurrentChat_ACU();
      const templateData = parseTableTemplateJson_ACU({ stripSeedRows: true });
      if (!templateData) throw new Error('无法解析当前生效模板。');
      const modifiedCount = await overrideLatestLayerWithTemplateCore_ACU(templateData);
      if (modifiedCount > 0) {
        await loadOrCreateJsonTableFromChatHistory_ACU();
        await refreshMergedDataAndNotify_ACU();
        message.value = null;
        toast.success(`已使用当前生效模板覆盖最新 AI 楼层的 ${modifiedCount} 个表格。`, { muteable: false });
      } else {
        message.value = null;
        toast.info('没有找到可覆盖的最新 AI 楼层表格数据。', { muteable: false });
      }
    } catch (e: any) {
      logError_ACU('[ACU-V2] overrideLatestLayerWithTemplate failed', e);
      message.value = null;
      toast.error('模板覆盖失败，详情见运行日志。');
    } finally {
      busyAction.value = '';
    }
  }

  /**
   * 预判当前范围输入会走哪条删除路径，供页面生成确认文案。
   * 与服务层 deleteLocalDataWithScope_ACU 使用同一判定函数，不重复实现规则。
   */
  function resolveDeletionPath(mode: 'current' | 'all'): 'purge' | 'range' {
    if (mode !== 'all') return 'range';
    const start = normalizeFloorValue(deleteRange.startFloor);
    const end = normalizeFloorValue(deleteRange.endFloor);
    return isFullRangeDeletionRequest_ACU(start, end, getAiMessageCount()) ? 'purge' : 'range';
  }

  async function deleteLocalData(mode: 'current' | 'all'): Promise<void> {
    const expectedPath = resolveDeletionPath(mode);
    busyAction.value = expectedPath === 'purge'
      ? 'purge-all-local'
      : (mode === 'current' ? 'delete-current-local' : 'delete-all-local');
    try {
      const start = normalizeFloorValue(deleteRange.startFloor);
      const end = normalizeFloorValue(deleteRange.endFloor);
      settings_ACU.deleteStartFloor = start;
      settings_ACU.deleteEndFloor = end;
      saveSettings_ACU();

      const outcome = await deleteLocalDataWithScope_ACU(mode, start, end, expectedPath);

      if (outcome.path === 'aborted') {
        message.value = null;
        toast.warning(outcome.reason, { muteable: false, durationMs: 6000 });
        return;
      }
      if (outcome.path === 'purge') {
        applyPurgeOutcome(outcome.result);
        return;
      }
      await applyRangeDeletionOutcome(outcome.deletedCount);
    } catch (e: any) {
      logError_ACU('[ACU-V2] deleteLocalData failed', e);
      message.value = null;
      toast.error('删除本地数据失败，详情见运行日志。');
    } finally {
      busyAction.value = '';
    }
  }

  async function applyRangeDeletionOutcome(deletedCount: number): Promise<void> {
    if (deletedCount > 0) {
      await loadOrCreateJsonTableFromChatHistory_ACU();
      if (isSqliteMode()) await reloadStorageProvider();
      await refreshMergedDataAndNotify_ACU();
      const worldbookDeleted = await cleanupWorldbookEntriesAfterDataDeletion_ACU();
      refresh();
      setMessage(
        message,
        'success',
        `已删除 ${deletedCount} 条消息中的本地数据${worldbookDeleted ? `，并清理 ${worldbookDeleted} 个世界书条目` : ''}。`,
      );
      const text = message.value?.text || '';
      message.value = null;
      toast.success(text, { muteable: false });
    } else {
      message.value = null;
      toast.info('没有发现符合当前范围的数据。', { muteable: false });
    }
  }

  /**
   * 应用硬清空（purge）结果到 UI（C 方案接线 purge 的收尾）。
   *
   * 与 applyRangeDeletionOutcome 的收尾差异：
   * - 不调用 loadOrCreateJsonTableFromChatHistory_ACU / reloadStorageProvider：
   *   purgeCurrentChatDatabaseState_ACU 内部已在严格保存后回落为当前全局模板的
   *   header-only 空结构（S1-1，pristine：不写 frame，首次填表才建根），此处只需刷新展示。
   * - 不调用 cleanupWorldbookEntriesAfterDataDeletion_ACU（C3）：purge 内部已做
   *   cleanupDatabaseGeneratedWorldbookEntries_ACU，结果进入 result.cleanupWarnings。
   * - 调用 refreshMergedDataAndNotify_ACU 让各面板显示回落后的模板空结构（S1-1 语义下
   *   "从模板重建空结构"是期望行为，不再是需要防御的重新物化）。
   * - 表格页面（FormFill/Dashboard）的显示由 getCurrentTableDisplayData_ACU 纯读取回退到
   *   当前全局模板（stripSeedRows），页面 mount/既有 refresh tick 即可展示，无需重新物化 runtime。
   */
  async function applyPurgeOutcome(result: { saved: boolean; clearedMessageCount: number; removedMetadata: string[]; cleanupWarnings?: string[]; error?: string }): Promise<void> {
    if (!result.saved) {
      message.value = null;
      toast.error(result.error || '硬清空失败，详情见运行日志。', { muteable: false });
      return;
    }
    await refreshMergedDataAndNotify_ACU();
    refresh();
    if (result.cleanupWarnings?.length) {
      toast.warning(`本地数据已全部硬清空（${result.clearedMessageCount} 条消息）。警告：${result.cleanupWarnings[0]}`, { muteable: false, durationMs: 6000 });
    } else {
      const removed = result.removedMetadata.length ? `，移除元数据：${result.removedMetadata.join('、')}` : '';
      toast.success(`已删除所有本地数据（${result.clearedMessageCount} 条消息）${removed}。`, { muteable: false });
    }
  }

  function setRetainRecentLayers(value: number | string): void {
    const normalized = normalizeRetainRecentLayers(value);
    retainRecentLayers.value = normalized;
    settings_ACU.retainRecentLayers = normalized;
    saveSettings_ACU();
    message.value = null;
  }

  return {
    message,
    busyAction,
    isolationCode,
    isolationHistory,
    mixedStorageDecision,
    v2RecoverySummary,
    v2IsolationDiagnostics,
    isolationHistoryOptions,
    currentIsolationLabel,
    isolationModeLabel,
    deleteRange,
    retainRecentLayers,
    rangeLabel,
    aiMessageCount,
    tableCount,
    refresh,
    getCheckpointTargetStorageMode,
    applyIsolation,
    removeHistory,
    deleteCurrentIsolationEntries,
    importCombinedSettings,
    exportCombinedSettings,
    exportJsonData,
    exportTableCheckpoint,
    exportMixedStorageSnapshots,
    commitMixedStorageDecision,
    scanV2IsolationDiagnostics,
    prepareV2Recovery,
    exportV2RecoveryBackups,
    commitV2Recovery,
    parseTableCheckpoint,
    restoreTableCheckpoint,
    resetAllDefaults,
    overrideLatestLayerWithTemplate,
    deleteLocalData,
    resolveDeletionPath,
    setRetainRecentLayers,
  };
}
