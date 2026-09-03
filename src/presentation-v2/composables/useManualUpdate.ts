import { computed, ref, type ComputedRef, type Ref } from 'vue';
import {
  settings_ACU,
  abortAllActiveRequests_ACU,
  _set_isAutoUpdatingCard_ACU,
  _set_manualExtraHint_ACU,
  _set_wasStoppedByUser_ACU,
  getCurrentIsolationKey_ACU,
} from '../../service/runtime/state-manager';
import { getChatArray_ACU } from '../../service/chat/chat-service';
import { saveSettings_ACU } from '../../service/settings/settings-service';
import {
  getCurrentTableDisplayData_ACU,
  getCurrentWorldbookConfig_ACU,
  hasRuntimeTableData_ACU,
} from '../../service/settings/settings-readers';
import { getSortedSheetKeys_ACU } from '../../service/template/chat-scope';
import { collectV2CheckpointFloorsFromChat_ACU } from '../../service/table/table-history';
import {
  executeCardUpdateCore_ACU,
  orchestrateManualCatchUp_ACU,
  orchestrateManualUpdate_ACU,
  prepareManualCatchUpPlan_ACU,
  processUpdatesBatch_ACU,
  type BatchUpdateProgressContext,
  type CardUpdateProgressEvent,
} from '../../service/table/update-orchestrator';
import { resolveManualUpdateBatchSize_ACU, resolveManualUpdateContextDepth_ACU } from '../../service/table/manual-update-settings';
import { refreshMergedDataAndNotify_ACU } from '../../service/worldbook/pipeline';
import { getCurrentCharPrimaryLorebook_ACU } from '../../service/worldbook/worldbook-service';
import { topLevelWindow_ACU } from '../../shared/env';
import { useDialogStore } from '../stores/dialog-store';
import { useToastStore } from '../stores/toast-store';

type MessageKind = 'info' | 'success' | 'warning' | 'error';

/**
 * 确认弹窗用的世界书注入目标描述：大规模历史回填会一次生成上百条 TavernDB 条目，
 * 用户必须在确认前看到它们将写入哪本世界书（默认是角色卡绑定的主世界书，而不是
 * 用户新建的外挂数据库世界书）。解析失败不阻断确认流程，只降级为提示文案。
 */
async function describeInjectionTargetForConfirm(): Promise<string> {
  const target = String(getCurrentWorldbookConfig_ACU()?.injectionTarget || '').trim() || 'character';
  if (target !== 'character') return target;
  try {
    const primary = await getCurrentCharPrimaryLorebook_ACU();
    return primary ? `角色卡绑定世界书 · ${primary}` : '角色卡绑定世界书（未解析到主世界书）';
  } catch {
    return '角色卡绑定世界书（未解析到主世界书）';
  }
}

export interface ManualUpdateState {
  selectedManualTableKeys: Ref<string[]>;
  manualContextDepth: Ref<number>;
  manualBatchSize: Ref<number>;
  manualExtraHint: Ref<string>;
  manualUpdateBusy: Ref<boolean>;
  catchUpBusy: Ref<boolean>;
  sheetKeys: ComputedRef<string[]>;
  sheetNames: ComputedRef<Record<string, string>>;
  /** runtime 是否已持有真实表格数据；false（如 purge 后）时展示层仅展示模板，选择器应禁用 */
  runtimeReady: ComputedRef<boolean>;
  selectedSheetSummary: ComputedRef<string>;
  checkpointFloorsLabel: ComputedRef<string>;
  manualRefillRangeLabel: ComputedRef<string>;
  checkpointRiskMessage: ComputedRef<string>;
  vectorIndexWarning: ComputedRef<boolean>;
  refresh: () => void;
  setManualContextDepth: (value: number | string) => void;
  setManualBatchSize: (value: number | string) => void;
  setManualSelectedKeys: (keys: string[]) => void;
  selectAllManualTables: () => void;
  selectNoManualTables: () => void;
  runManualUpdate: () => Promise<void>;
  runManualCatchUp: () => Promise<void>;
}

function currentSheetKeys(): string[] {
  try {
    return getSortedSheetKeys_ACU(getCurrentTableDisplayData_ACU() || {});
  } catch {
    return [];
  }
}

/**
 * 执行用表键：仅 runtime 真实表。
 * runtime 未就绪（purge 后为 null / 空）时返回 []，避免把模板表
 * 当作可执行数据传给 orchestrator。
 */
function runtimeExecutionSheetKeys(): string[] {
  if (!hasRuntimeTableData_ACU()) return [];
  try {
    return getSortedSheetKeys_ACU(getCurrentTableDisplayData_ACU() || {});
  } catch {
    return [];
  }
}

/**
 * TOCTOU 执行边界校验：确认后重新读取 runtime，
 * 要求当前 runtime 表集合与确认前快照完全一致，且快照目标仍全部有效。
 * 任一变化（purge、表删除、新增表、外部直接写 Ref 篡改选择）都会 fail-closed 阻断，
 * 避免在确认文案与最终执行目标不一致的情况下继续破坏性操作。
 */
function runtimeTargetsStillMatch(snapshotKeys: string[], requestedKeys: string[]): boolean {
  if (!requestedKeys.length || !hasRuntimeTableData_ACU()) return false;
  const currentKeys = runtimeExecutionSheetKeys();
  if (currentKeys.length !== snapshotKeys.length) return false;
  const snapshotSet = new Set(snapshotKeys);
  if (!currentKeys.every((key) => snapshotSet.has(key))) return false;
  return requestedKeys.every((key) => snapshotSet.has(key));
}

function resolveManualSelection(keys: string[]): string[] {
  if (!keys.length) return [];
  const saved = Array.isArray(settings_ACU.manualSelectedTables) ? settings_ACU.manualSelectedTables : [];
  if (settings_ACU.hasManualSelection !== true) return keys.slice();
  const valid = new Set(keys);
  return saved.filter((key: string) => valid.has(key));
}

function saveManualSelection(keys: string[]): void {
  // runtime 未就绪（如 purge 后）时禁止写入手动选表配置：
  // 此时展示的是模板表，若把空选择写回会永久覆盖用户原有选表偏好
  // （hasManualSelection=true + manualSelectedTables=[]），待 runtime 恢复后
  // resolveManualSelection 会错误地继续返回空数组。必须 fail-closed 保持原状态。
  if (!hasRuntimeTableData_ACU()) return;
  const valid = new Set(runtimeExecutionSheetKeys());
  settings_ACU.manualSelectedTables = keys.filter(key => valid.has(key));
  settings_ACU.hasManualSelection = true;
  saveSettings_ACU();
}

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

// 手动面板的层数/分批参数由 service 层统一解析：手动更新与一键追平都读同一处，
// 不再在 UI 侧临时改写自动填表的全局设置来“桥接”。
const resolveManualContextDepth = resolveManualUpdateContextDepth_ACU;
const resolveManualBatchSize = resolveManualUpdateBatchSize_ACU;

interface ManualRefillRangeSummary {
  indices: number[];
  startAiFloor: number;
  endAiFloor: number;
}

function resolveManualRefillRangeSummary_ACU(manualDepth: number): ManualRefillRangeSummary | null {
  const chat = getChatArray_ACU();
  if (!Array.isArray(chat) || chat.length === 0) return null;
  const aiItems = chat
    .map((msg: any, index: number) => (msg && !msg.is_user ? { index, aiFloor: 0 } : null))
    .filter((item): item is { index: number; aiFloor: number } => item !== null);
  aiItems.forEach((item, idx) => { item.aiFloor = idx + 1; });
  const skip = normalizeNonNegativeInteger(settings_ACU.skipUpdateFloors, 0);
  const effectiveAiItems = skip > 0 ? aiItems.slice(0, -skip) : aiItems.slice();
  const contextItems = manualDepth > 0 ? effectiveAiItems.slice(-manualDepth) : effectiveAiItems;
  if (!contextItems.length) return null;
  return {
    indices: contextItems.map(item => item.index),
    startAiFloor: contextItems[0].aiFloor,
    endAiFloor: contextItems[contextItems.length - 1].aiFloor,
  };
}

function formatAiFloorRange_ACU(startAiFloor: number, endAiFloor: number): string {
  return startAiFloor === endAiFloor
    ? `AI 第 ${startAiFloor} 层`
    : `AI 第 ${startAiFloor}~${endAiFloor} 层`;
}

function progressLabel(event: CardUpdateProgressEvent): string {
  const prefix = event.currentBatch && event.totalBatches
    ? `批次 ${event.currentBatch}/${event.totalBatches} · `
    : '';
  if (event.message && event.phase !== 'retry' && event.phase !== 'error') {
    return `${prefix}${normalizeManualProgressMessage(event.message)}`;
  }
  switch (event.phase) {
    case 'preparing': return `${prefix}准备上下文`;
    case 'calling_ai': return `${prefix}调用 AI${event.attempt ? `（第 ${event.attempt}/${event.maxRetries || '?'} 次尝试）` : ''}`;
    case 'parsing': return `${prefix}解析填表结果`;
    case 'saving': return `${prefix}保存表格数据`;
    case 'retry': return `${prefix}重试中${event.message ? `:${event.message}` : ''}`;
    case 'complete': return `${prefix}完成`;
    case 'chunk_done': return `${prefix}分块完成`;
    case 'error': return `${prefix}出错${event.message ? `:${event.message}` : ''}`;
    default: return prefix || '处理中';
  }
}

function normalizeManualProgressMessage(message: string): string {
  return message
    .split(' AI 响应').join('手动填表结果')
    .split('AI 响应').join('手动填表结果');
}

export function useManualUpdate(): ManualUpdateState {
  const dialogStore = useDialogStore();
  const toast = useToastStore();
  const selectedManualTableKeys = ref<string[]>(resolveManualSelection(runtimeExecutionSheetKeys()));
  const manualContextDepth = ref(resolveManualContextDepth());
  const manualBatchSize = ref(resolveManualBatchSize());
  const manualExtraHint = ref('');
  const manualUpdateBusy = ref(false);
  const catchUpBusy = ref(false);
  const refreshTick = ref(0);
  let progressToastId: string | null = null;
  let abortRequested = false;
  let catchUpAbortController: AbortController | null = null;

  function progressToastOptions(onAbort: () => void = requestAbort) {
    const abortDisabled = onAbort === requestCatchUpAbort
      ? catchUpAbortController?.signal.aborted === true
      : abortRequested;
    return {
      durationMs: 0,
      muteable: false,
      dismissible: false,
      action: abortDisabled
        ? undefined
        : {
            label: '终止',
            variant: 'danger' as const,
            dismissOnClick: false,
            onClick: onAbort,
          },
    };
  }

  function notifyProgress(text: string, onAbort: () => void = requestAbort): void {
    if (progressToastId && toast.update(progressToastId, 'info', text, progressToastOptions(onAbort))) {
      return;
    }
    progressToastId = toast.info(text, progressToastOptions(onAbort));
  }

  function finishToast(kind: MessageKind, text: string): void {
    if (progressToastId) {
      if (toast.update(progressToastId, kind, text, { muteable: false })) {
        progressToastId = null;
        return;
      }
      progressToastId = null;
    }
    toast[kind](text, { muteable: false });
  }

  function requestAbort(): void {
    if (abortRequested) return;
    abortRequested = true;
    _set_wasStoppedByUser_ACU(true);
    abortAllActiveRequests_ACU();
    _set_isAutoUpdatingCard_ACU(false);
    if (progressToastId) {
      toast.update(progressToastId, 'warning', '手动填表已终止，正在停止当前任务与后续批次...', {
        durationMs: 0,
        muteable: false,
        dismissible: false,
      });
    } else {
      toast.warning('手动填表已终止，正在停止当前任务与后续批次...', {
        durationMs: 0,
        muteable: false,
        dismissible: false,
      });
    }
  }

  function requestCatchUpAbort(): void {
    if (!catchUpAbortController || catchUpAbortController.signal.aborted) return;
    catchUpAbortController.abort();
    const text = '手动追平已终止，正在等待当前安全边界收敛...';
    if (progressToastId) {
      toast.update(progressToastId, 'warning', text, { durationMs: 0, muteable: false, dismissible: false });
    } else {
      toast.warning(text, { durationMs: 0, muteable: false, dismissible: false });
    }
  }

  const sheetKeys = computed(() => {
    void refreshTick.value;
    return currentSheetKeys();
  });

  /** runtime 就绪判据：仅真实表存在时选择器才允许交互 */
  const runtimeReady = computed<boolean>(() => {
    void refreshTick.value;
    return hasRuntimeTableData_ACU();
  });

  const sheetNames = computed<Record<string, string>>(() => {
    const displayData = getCurrentTableDisplayData_ACU() || {};
    const names: Record<string, string> = {};
    for (const key of sheetKeys.value) {
      names[key] = String(displayData[key]?.name || key);
    }
    return names;
  });

  const selectedSheetSummary = computed<string>(() => {
    const keys = selectedManualTableKeys.value;
    if (!keys.length) return '未选择表格';
    const names = sheetNames.value;
    return keys
      .map(key => `${names[key] || key}（${key}）`)
      .join('、');
  });

  const checkpointFloors = computed(() => {
    void refreshTick.value;
    try {
      return collectV2CheckpointFloorsFromChat_ACU(getChatArray_ACU(), getCurrentIsolationKey_ACU());
    } catch {
      return [];
    }
  });

  function formatCheckpointReasonLabel(reason?: string): string {
    switch (reason) {
      case 'init':
        return '初始基线';
      case 'migration':
        return '迁移基线';
      case 'compaction':
        return '保留边界基线';
      case 'manual':
        return '历史手动基线';
      case 'periodic':
        return '历史周期基线';
      default:
        return reason ? `旧基线:${reason}` : '旧基线';
    }
  }

  const checkpointFloorsLabel = computed<string>(() => {
    const checkpoints = checkpointFloors.value;
    return checkpoints.length > 0
      ? checkpoints
        .map(item => `AI 第 ${item.aiFloor} 层（${formatCheckpointReasonLabel(item.reason)}）`)
        .join('、')
      : '当前隔离标签暂无 full checkpoint';
  });

  const manualRefillRange = computed<ManualRefillRangeSummary | null>(() => {
    void refreshTick.value;
    try {
      return resolveManualRefillRangeSummary_ACU(manualContextDepth.value);
    } catch {
      return null;
    }
  });

  const manualRefillRangeLabel = computed<string>(() => {
    const range = manualRefillRange.value;
    return range
      ? formatAiFloorRange_ACU(range.startAiFloor, range.endAiFloor)
      : '暂无可重填 AI 楼层';
  });

  const checkpointRiskMessage = computed<string>(() => {
    const checkpoints = checkpointFloors.value;
    const range = manualRefillRange.value;
    if (checkpoints.length === 0 || !range) return '';
    const checkpointIndexSet = new Set(range.indices);
    const coveredCheckpoints = checkpoints.filter(item => checkpointIndexSet.has(item.messageIndex));
    if (coveredCheckpoints.length !== checkpoints.length) return '';
    const coveredFloors = coveredCheckpoints.map(item => `AI 第 ${item.aiFloor} 层`).join('、');
    return `危险：当前聊天的所有 full checkpoint 都在本次重填范围内（${coveredFloors}）。系统首次执行时只会做边界检查；如果确认缺少重填起点前可回放 checkpoint，会在下一步要求你单独确认是否替换本次范围内选中表的基底。`;
  });

  const vectorIndexWarning = computed<boolean>(() => {
    void refreshTick.value;
    try {
      return getCurrentWorldbookConfig_ACU().summaryVectorIndexModeEnabled === true;
    } catch {
      return false;
    }
  });

  function refresh(): void {
    selectedManualTableKeys.value = resolveManualSelection(runtimeExecutionSheetKeys());
    manualContextDepth.value = resolveManualContextDepth();
    manualBatchSize.value = resolveManualBatchSize();
    refreshTick.value++;
  }

  function setManualContextDepth(value: number | string): void {
    const normalized = normalizeNonNegativeInteger(value, manualContextDepth.value);
    manualContextDepth.value = normalized;
    settings_ACU.manualUpdateContextDepth = normalized;
    saveSettings_ACU();
  }

  function setManualBatchSize(value: number | string): void {
    const normalized = normalizePositiveInteger(value, manualBatchSize.value);
    manualBatchSize.value = normalized;
    settings_ACU.manualUpdateBatchSize = normalized;
    saveSettings_ACU();
  }

  function setManualSelectedKeys(keys: string[]): void {
    const valid = new Set(runtimeExecutionSheetKeys());
    selectedManualTableKeys.value = keys.filter((key) => valid.has(key));
    saveManualSelection(selectedManualTableKeys.value);
    refreshTick.value++;
  }

  function selectAllManualTables(): void {
    setManualSelectedKeys(runtimeExecutionSheetKeys());
  }

  function selectNoManualTables(): void {
    setManualSelectedKeys([]);
  }

  async function runManualUpdate(): Promise<void> {
    if (manualUpdateBusy.value || catchUpBusy.value) return;
    // 空选择优先于 runtime 状态判断：保持原有提示，避免误报“运行时未就绪”。
    if (!selectedManualTableKeys.value.length) {
      toast.warning('未选择需要手动填表的表格。');
      return;
    }
    // 执行边界校验（确认前）：selected keys 必须仍是当前 runtime 真实表。
    // 展示层可回退模板，但破坏性重填绝不允许把模板表当作执行目标；
    // 也防止任何外部直接写 Ref 绕过 setter 隔离后仍被这里放行。
    // 在弹确认框前建立不可变快照：确认文案与最终执行目标必须来自同一快照。
    const requestedTargetKeys = selectedManualTableKeys.value.slice();
    const snapshotRuntimeKeys = runtimeExecutionSheetKeys();
    const runtimeKeys = new Set(snapshotRuntimeKeys);
    const validTargetKeys = requestedTargetKeys.filter((key) => runtimeKeys.has(key));
    if (!snapshotRuntimeKeys.length || validTargetKeys.length !== requestedTargetKeys.length) {
      toast.warning('当前表格运行时未就绪，无法执行手动填表。');
      return;
    }

    manualUpdateBusy.value = true;
    try {
      const injectionTargetLabel = await describeInjectionTargetForConfirm();
      const confirmed = await dialogStore.confirm({
        title: '执行手动填表',
        message: `即将执行手动填表。\n\n当前 full checkpoint：${checkpointFloorsLabel.value}\n本次重填范围：${manualRefillRangeLabel.value}\n选中表：${selectedSheetSummary.value}\n世界书注入目标：${injectionTargetLabel}（填表结果会写入该世界书的 TavernDB 条目）\n\n高风险操作：系统会先删除本次重填范围内选中表的 checkpoint 与 V2 增量日志，再以清理后的状态作为填表基底重新填写，最后写入新的单表 checkpoint。\n如果被删除的 checkpoint 是这些表唯一的数据基线，此前楼层的表格数据将无法恢复。\n\n范围外的 checkpoint、范围外聊天记录的表格数据和未选中的表不会被删除。执行失败或中途终止时不会回滚：已清理的旧数据不会恢复，已成功提交的批次会保留，运行时会按聊天记录中的已提交结果重新对齐。`,
        dangerMessage: checkpointRiskMessage.value || undefined,
        confirmLabel: '确认并继续',
        cancelLabel: '取消',
        confirmVariant: 'danger',
      });
      if (!confirmed) return;
      // 兼容沿用 clearBeforeUpdate 参数名；service 层实际执行事务式重填，不会预清空聊天记录。
      const clearBeforeUpdate = true;
      // 确认后 TOCTOU 复检：确认期间 runtime 可能被 purge/表删除/新增表改变。
      // 若当前 runtime 表集合与确认前快照不一致，或目标已失效，必须 fail-closed 阻断，
      // 不得静默缩减/替换执行目标后继续破坏性重填。
      if (!runtimeTargetsStillMatch(snapshotRuntimeKeys, requestedTargetKeys)) {
        toast.warning('表格运行时在确认期间发生变化，已取消本次手动填表，请确认后重试。');
        return;
      }
      const targetManualTableKeys = requestedTargetKeys.slice();

      progressToastId = null;
      abortRequested = false;
      _set_wasStoppedByUser_ACU(false);
      notifyProgress('手动填表开始。');
      const extra = manualExtraHint.value.trim();
      if (extra) _set_manualExtraHint_ACU(`以下为用户的额外填表要求,请严格遵守:\n${extra}`);
      const handleProgress = (event: CardUpdateProgressEvent) => {
        notifyProgress(progressLabel(event));
        if (event.phase === 'complete') {
          try { (topLevelWindow_ACU as any).AutoCardUpdaterAPI?._notifyTableUpdate?.(); } catch (_) {}
          refreshTick.value++;
        }
      };

      const runProcessBatch = (indices: number[], mode: string, options: any) =>
        processUpdatesBatch_ACU(indices, mode, options, (
          messagesToUse: any[],
          saveTargetIndex: number,
          updateMode: string,
          isSilentMode: boolean,
          targetSheetKeys: string[] | null,
          requestOptions: Record<string, any> | null,
          progressContext: BatchUpdateProgressContext,
        ) => executeCardUpdateCore_ACU(
          messagesToUse,
          saveTargetIndex,
          false,
          updateMode,
          isSilentMode,
          targetSheetKeys,
          requestOptions,
          new AbortController(),
          progressContext,
          handleProgress,
        ));

      const result = await orchestrateManualUpdate_ACU(
        targetManualTableKeys,
        runProcessBatch,
        async () => { await refreshMergedDataAndNotify_ACU(); },
        {
          clearBeforeUpdate,
          onProgress: handleProgress,
          // 把确认前快照传给 service 层：orchestrator 在破坏性清理前会再次校验 runtime。
          executionSnapshot: { sheetKeys: snapshotRuntimeKeys },
        },
      );
      finishToast(
        result.success ? (result.checkpointWarning ? 'warning' : 'success') : (abortRequested || result.error?.includes('终止') ? 'warning' : 'error'),
        result.success
          ? `${result.autoMergeTriggered
              ? `手动填表完成;自动合并总结${result.autoMergeSuccess ? '已完成' : '未完成'}。`
              : '手动填表完成。'}${result.checkpointWarning
                ? ` 但 AI 楼层保留边界 checkpoint 建立失败：${result.checkpointWarning}`
                : ''}`
          : (abortRequested ? '手动填表任务已由用户终止。' : (result.error || '手动填表失败。')),
      );
    } catch (error: any) {
      finishToast('error', error?.message || '手动填表执行异常。');
    } finally {
      manualUpdateBusy.value = false;
      refresh();
    }
  }

  async function retryCatchUpSyncOnly(): Promise<void> {
    if (manualUpdateBusy.value || catchUpBusy.value) return;
    catchUpBusy.value = true;
    try {
      if (progressToastId) {
        toast.update(progressToastId, 'info', '正在仅重试世界书同步，不会再次调用 AI...', {
          durationMs: 0,
          muteable: false,
          dismissible: false,
        });
      }
      const result = await refreshMergedDataAndNotify_ACU();
      refresh();
      if (result.degraded) {
        showCatchUpSyncPending();
        return;
      }
      finishToast('success', '世界书同步已完成；没有再次调用 AI。');
    } catch (error: any) {
      showCatchUpSyncPending(error?.message || '世界书同步仍未完成。');
    } finally {
      catchUpBusy.value = false;
    }
  }

  function showCatchUpSyncPending(detail?: string): void {
    const text = `追平数据已保存，但世界书同步待重试。${detail ? ` ${detail}` : ''}`;
    const options = {
      durationMs: 0,
      muteable: false,
      dismissible: true,
      action: {
        label: '仅同步重试',
        dismissOnClick: false,
        onClick: retryCatchUpSyncOnly,
      },
    };
    if (progressToastId && toast.update(progressToastId, 'warning', text, options)) return;
    progressToastId = toast.warning(text, options);
  }

  async function runManualCatchUp(): Promise<void> {
    if (manualUpdateBusy.value || catchUpBusy.value) return;
    // 空选择优先于 runtime 状态判断：保持原有提示，避免误报“运行时未就绪”。
    if (!selectedManualTableKeys.value.length) {
      toast.warning('未选择需要追平的表格。');
      return;
    }
    // 执行边界校验（确认前）：追平同样绝不允许把模板表当作执行目标。
    // 弹确认框前建立不可变快照：确认文案与最终执行目标必须来自同一快照。
    const requestedTargetKeys = selectedManualTableKeys.value.slice();
    const snapshotRuntimeKeys = runtimeExecutionSheetKeys();
    const runtimeKeys = new Set(snapshotRuntimeKeys);
    const validTargetKeys = requestedTargetKeys.filter((key) => runtimeKeys.has(key));
    if (!snapshotRuntimeKeys.length || validTargetKeys.length !== requestedTargetKeys.length) {
      toast.warning('当前表格运行时未就绪，无法执行手动追平。');
      return;
    }

    catchUpBusy.value = true;
    try {
      const planningResult = await prepareManualCatchUpPlan_ACU(requestedTargetKeys);
      if (!planningResult.success || !planningResult.plan) {
        finishToast('error', planningResult.error || '无法生成手动追平计划。');
        return;
      }
      const plan = planningResult.plan;
      if (!plan.waves.length) {
        finishToast('info', '所选表已追平，无需调用 AI 或写入数据。');
        return;
      }
      const totalBuckets = plan.waves.reduce((count, wave) => count + wave.groups.reduce(
        (waveCount, group) => waveCount + Math.ceil(wave.messageIndices.length / group.batchSize),
        0,
      ), 0);
      const waveSummary = plan.waves.map((wave, index) =>
        `Wave ${index + 1}：${formatAiFloorRange_ACU(wave.startAiFloor, wave.endAiFloor)}；${wave.sheetKeys.map(key => sheetNames.value[key] || key).join('、')}`
      ).join('\n');
      const confirmed = await dialogStore.confirm({
        title: '追平所选表未填楼层',
        message: `锁定目标：AI 第 ${plan.targetAiFloor} 层\n预计 ${plan.waves.length} 个 wave、${totalBuckets} 个 bucket。\n跳过最新楼层：${normalizeNonNegativeInteger(settings_ACU.skipUpdateFloors, 0)} 层。\n\n${waveSummary}\n\n本功能只补每张表已提交连续前沿之后的后缀缺口，不扫描或修复历史前沿之前的内部空洞。执行时会重新读取已提交事实并重新规划，避免重复处理确认期间已完成的 bucket。\n\n执行前会基于当前已提交事实重新预检存储锚点：若目标楼层早于正式 checkpoint，将自动建立临时锚点并在原边界原子汇合（已提交成果不会丢失，也不会留下第二正式根）；若预检无法证明安全，将在调用 AI 前阻止。`,
        confirmLabel: '确认追平',
        cancelLabel: '取消',
      });
      if (!confirmed) return;

      // 确认后 TOCTOU 复检：确认期间 runtime 可能被 purge/表删除/新增表改变。
      // 追平计划基于确认前快照生成，若当前 runtime 表集合与快照不一致，
      // 必须重新规划并要求用户重新确认，避免“确认的计划”与“执行的目标”不一致。
      if (!runtimeTargetsStillMatch(snapshotRuntimeKeys, requestedTargetKeys)) {
        finishToast('warning', '表格运行时在确认期间发生变化，已取消本次追平，请重新确认目标。');
        return;
      }
      progressToastId = null;
      abortRequested = false;
      catchUpAbortController = new AbortController();
      notifyProgress('手动追平开始。', requestCatchUpAbort);
      const result = await orchestrateManualCatchUp_ACU(
        requestedTargetKeys,
        refreshMergedDataAndNotify_ACU,
        {
          abortController: catchUpAbortController,
          onProgress: event => notifyProgress(progressLabel(event), requestCatchUpAbort),
          // 把确认前快照传给 service 层：orchestrator 内部会再次校验 runtime 一致性，
          // 使 TOCTOU 防护延伸到 UI 复检之后的异步窗口。
          executionSnapshot: { sheetKeys: snapshotRuntimeKeys },
        },
      );
      if (result.dataCommitted === true) {
        try { (topLevelWindow_ACU as any).AutoCardUpdaterAPI?._notifyTableUpdate?.(); } catch (_) {}
      }
      if (result.outcome === 'sync_pending') {
        showCatchUpSyncPending();
      } else if (result.outcome === 'no_work') {
        finishToast('info', '所选表已追平，无需调用 AI 或写入数据。');
      } else if (result.outcome === 'progress_metadata_failed') {
        finishToast('warning', `手动追平数据已提交，但完成状态记录失败：${result.error || '下次追平会重新记录状态。'}`);
      } else if (result.outcome === 'integrity_failed') {
        finishToast('error', `手动追平持久化完整性校验失败，已回载聊天中的已保存数据：${result.error || '请执行 V2 恢复诊断。'}`);
      } else if (result.outcome === 'blocked') {
        finishToast('error', result.error || '手动追平已在调用 AI 前阻止：V2 存储锚点无法安全修复。');
      } else if (result.outcome === 'stopped' || catchUpAbortController.signal.aborted) {
        finishToast('warning', `手动追平已终止；已保留 ${result.committedBucketCount || 0} 个已提交 bucket。`);
      } else if (result.success) {
        finishToast('success', `手动追平完成，共提交 ${result.committedBucketCount || 0} 个 bucket。`);
      } else {
        finishToast('error', result.error || '手动追平失败。');
      }
    } catch (error: any) {
      finishToast('error', error?.message || '手动追平执行异常。');
    } finally {
      catchUpAbortController = null;
      catchUpBusy.value = false;
      refresh();
    }
  }

  return {
    selectedManualTableKeys,
    manualContextDepth,
    manualBatchSize,
    manualExtraHint,
    manualUpdateBusy,
    catchUpBusy,
    sheetKeys,
    sheetNames,
    runtimeReady,
    selectedSheetSummary,
    checkpointFloorsLabel,
    manualRefillRangeLabel,
    checkpointRiskMessage,
    vectorIndexWarning,
    refresh,
    setManualContextDepth,
    setManualBatchSize,
    setManualSelectedKeys,
    selectAllManualTables,
    selectNoManualTables,
    runManualUpdate,
    runManualCatchUp,
  };
}
