/**
 * useDeskPetQuickActions — 桌宠动作菜单的快捷动作实现。
 *
 * 只做编排，不改既有 service：
 * - 跳转日志 / 打开表格编辑器复用现成入口；
 * - 一键追平复用 prepareManualCatchUpPlan_ACU + orchestrateManualCatchUp_ACU；
 * - 结果与进度全部走 notice-hub 气泡（app shell 关闭时 toast / dialog 不可见，
 *   因此确认放在菜单里的内联卡片，不依赖 dialog host）。
 */
import { computed, onScopeDispose, ref, type ComputedRef, type Ref } from 'vue';
import { topLevelWindow_ACU } from '../../shared/env';
import { beginNoticeTask_ACU, getNoticeHubSnapshot_ACU, notify_ACU } from '../../shared/notice-hub';
import {
  getActiveTemplatePresetMeta_ACU,
} from '../../service/template/template-preset-service';
import {
  orchestrateManualCatchUp_ACU,
  prepareManualCatchUpPlan_ACU,
  type CardUpdateProgressEvent,
} from '../../service/table/update-orchestrator';
import type { ManualCatchUpPlan_ACU } from '../../service/table/manual-fill-planner';
import {
  getCurrentTableDisplayData_ACU,
  hasRuntimeTableData_ACU,
} from '../../service/settings/settings-readers';
import { getSortedSheetKeys_ACU } from '../../service/template/chat-scope';
import { refreshMergedDataAndNotify_ACU } from '../../service/worldbook/pipeline';
import { settings_ACU } from '../../service/runtime/state-manager';
import { getAcuV2PiniaForBridge, openAcuV2App } from '../bootstrap/mount';
import { useApiPresetStore } from '../stores/api-preset-store';
import { usePlotPresetStore } from '../stores/plot-preset-store';
import { useRouterStore } from '../stores/router-store';
import { openVisualizerSurface_ACU } from '../surfaces/visualizer/open-visualizer-surface';
import type { DeskPetMenuConfigRow, DeskPetMenuConfirm } from '../components/desk-pet-action-menu';

const CATCH_UP_TITLE = '一键追平';
/** 与填表工作台一致的任务特征名，用于阻止并发追平。 */
const MANUAL_CATCH_UP_FEATURE = '手动追平';
const LOG_PAGE_ID = 'advanced-tools';

/** 执行用表键：只认 runtime 真实表，模板表绝不作为追平目标。 */
function runtimeSheetKeys(): string[] {
  try {
    if (!hasRuntimeTableData_ACU()) return [];
    return getSortedSheetKeys_ACU(getCurrentTableDisplayData_ACU() || {}) || [];
  } catch {
    return [];
  }
}

function sameKeySet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((key) => rightSet.has(key));
}

function formatFloorRange(startAiFloor: number, endAiFloor: number): string {
  return startAiFloor === endAiFloor
    ? `AI 第 ${startAiFloor} 层`
    : `AI 第 ${startAiFloor}~${endAiFloor} 层`;
}

function progressLabel(event: CardUpdateProgressEvent): string {
  const prefix = event.currentBatch && event.totalBatches
    ? `批次 ${event.currentBatch}/${event.totalBatches} · `
    : '';
  switch (event.phase) {
    case 'preparing': return `${prefix}准备上下文`;
    case 'calling_ai': return `${prefix}调用 AI`;
    case 'parsing': return `${prefix}解析填表结果`;
    case 'saving': return `${prefix}保存表格数据`;
    case 'chunk_done': return `${prefix}分块完成`;
    case 'complete': return `${prefix}完成`;
    case 'retry': return `${prefix}重试中`;
    case 'error': return `${prefix}出错`;
    default: return prefix || '处理中';
  }
}

interface PendingCatchUp {
  snapshotKeys: string[];
  plan: ManualCatchUpPlan_ACU;
}

export interface DeskPetQuickActions {
  /** 「检测当前配置」的行数据，随设置变化实时重算。 */
  configRows: ComputedRef<DeskPetMenuConfigRow[]>;
  /** 追平规划或执行中：菜单按钮置灰，避免重复触发。 */
  busy: ComputedRef<boolean>;
  /** 非空时菜单切换为内联确认卡片。 */
  confirm: Ref<DeskPetMenuConfirm | null>;
  openLogs: () => void;
  openVisualizer: () => void;
  detect: () => void;
  requestCatchUp: () => Promise<void>;
  acceptCatchUp: () => void;
  cancelCatchUp: () => void;
}

export function useDeskPetQuickActions(): DeskPetQuickActions {
  const apiPresetStore = useApiPresetStore();
  const plotPresetStore = usePlotPresetStore();
  const planningBusy = ref(false);
  const catchUpBusy = ref(false);
  const confirm = ref<DeskPetMenuConfirm | null>(null);
  const detectVersion = ref(0);
  let pending: PendingCatchUp | null = null;
  let abortController: AbortController | null = null;

  const busy = computed(() => planningBusy.value || catchUpBusy.value);

  function refreshPreviewStores(): void {
    try { apiPresetStore.refreshFromSettings(); } catch { /* 预览失败不阻断动作 */ }
    try { plotPresetStore.refreshFromSettings(); } catch { /* 预览失败不阻断动作 */ }
  }

  refreshPreviewStores();

  const configRows = computed<DeskPetMenuConfigRow[]>(() => {
    void detectVersion.value;
    const rows: DeskPetMenuConfigRow[] = [];

    try {
      const meta = getActiveTemplatePresetMeta_ACU();
      rows.push({ label: '表格模板', value: `${meta.displayName || '默认预设'}（${meta.scopeLabel}）` });
    } catch {
      rows.push({ label: '表格模板', value: '读取失败' });
    }

    rows.push({
      label: '填表 API',
      value: apiPresetStore.activePresetName || apiPresetStore.currentConfigLabel || '当前 API 配置不完整',
    });

    if (plotPresetStore.enabled) {
      rows.push({
        label: '剧情预设',
        value: plotPresetStore.activePresetName || plotPresetStore.defaultPresetName || '未选择预设',
      });
      rows.push({ label: '剧情 API', value: plotPresetStore.pageApiPresetName || '跟随默认 API' });
    } else {
      rows.push({ label: '剧情预设', value: '剧情推进已关闭' });
      rows.push({ label: '剧情 API', value: '—' });
    }
    return rows;
  });

  function detect(): void {
    refreshPreviewStores();
    detectVersion.value += 1;
  }

  function openLogs(): void {
    void (async () => {
      try {
        await openAcuV2App();
        const pinia = getAcuV2PiniaForBridge();
        if (!pinia) throw new Error('v2 app was not mounted.');
        useRouterStore(pinia).setActivePage(LOG_PAGE_ID);
      } catch {
        notify_ACU('warning', '运行日志打开失败，请在仪表盘里手动进入高级工具页。', { title: '打开日志' });
      }
    })();
  }

  function openVisualizer(): void {
    void (async () => {
      const opened = await openVisualizerSurface_ACU({ source: 'v2-shell' });
      if (!opened) {
        notify_ACU('warning', '表格编辑器打开失败，请稍后重试。', { title: '表格编辑器' });
      }
    })();
  }

  function cancelCatchUp(): void {
    pending = null;
    confirm.value = null;
  }

  async function requestCatchUp(): Promise<void> {
    if (busy.value || confirm.value) return;
    // 填表工作台的手动追平也登记为「手动追平」任务：并发执行会互相改写锚点。
    const runningElsewhere = getNoticeHubSnapshot_ACU().tasks.some(
      task => task.busy && task.feature === MANUAL_CATCH_UP_FEATURE,
    );
    if (runningElsewhere) {
      notify_ACU('warning', '已有追平任务在进行中，等它结束再试。', { title: CATCH_UP_TITLE });
      return;
    }
    const targetKeys = runtimeSheetKeys();
    if (!targetKeys.length) {
      notify_ACU('warning', '当前表格运行时未就绪，无法执行一键追平。', { title: CATCH_UP_TITLE });
      return;
    }
    planningBusy.value = true;
    try {
      const planning = await prepareManualCatchUpPlan_ACU(targetKeys);
      if (!planning.success || !planning.plan) {
        notify_ACU('error', planning.error || '无法生成一键追平计划。', { title: CATCH_UP_TITLE });
        return;
      }
      const plan = planning.plan;
      if (!plan.waves.length) {
        notify_ACU('info', '所有表都已追平，无需调用 AI 或写入数据。', { title: CATCH_UP_TITLE });
        return;
      }
      const totalBuckets = plan.waves.reduce((count, wave) => count + wave.groups.reduce(
        (waveCount, group) => waveCount + Math.ceil(wave.messageIndices.length / group.batchSize),
        0,
      ), 0);
      const waveSummary = plan.waves.slice(0, 3).map((wave, index) =>
        `Wave ${index + 1}：${formatFloorRange(wave.startAiFloor, wave.endAiFloor)}`
      ).join('\n') + (plan.waves.length > 3 ? `\n…共 ${plan.waves.length} 个 wave` : '');
      const skipFloors = Number(settings_ACU.skipUpdateFloors) || 0;
      pending = { snapshotKeys: targetKeys.slice(), plan };
      confirm.value = {
        title: '一键追平全表',
        message: `目标：${targetKeys.length} 张表，共 ${plan.waves.length} 个 wave、约 ${totalBuckets} 个 bucket。\n跳过最新 ${skipFloors} 层。\n${waveSummary}\n只补每张表已提交连续前沿之后的缺口；执行前会重新预检存储锚点，无法证明安全时会在调用 AI 前阻止。`,
        confirmLabel: '开始追平',
        cancelLabel: '取消',
      };
    } catch (error: any) {
      notify_ACU('error', error?.message || '一键追平规划异常。', { title: CATCH_UP_TITLE });
    } finally {
      planningBusy.value = false;
    }
  }

  function finishCatchUp(kind: 'info' | 'success' | 'warning' | 'error', text: string): void {
    notify_ACU(kind, text, { title: CATCH_UP_TITLE });
  }

  function acceptCatchUp(): void {
    const current = pending;
    if (!current || catchUpBusy.value) return;
    confirm.value = null;
    pending = null;
    // TOCTOU 复检：确认期间 runtime 可能被 purge / 删表 / 新增表。
    const targetKeys = runtimeSheetKeys();
    if (!sameKeySet(targetKeys, current.snapshotKeys)) {
      finishCatchUp('warning', '表格运行时在确认期间发生变化，已取消本次追平，请重新确认目标。');
      return;
    }
    catchUpBusy.value = true;
    abortController = new AbortController();
    const controller = abortController;
    const task = beginNoticeTask_ACU(CATCH_UP_TITLE, {
      detail: '正在准备追平…',
      kind: 'info',
      busy: true,
      action: {
        label: '终止',
        variant: 'danger',
        run: () => {
          if (!controller.signal.aborted) controller.abort();
        },
      },
    });
    void (async () => {
      try {
        const result = await orchestrateManualCatchUp_ACU(
          targetKeys,
          refreshMergedDataAndNotify_ACU,
          {
            abortController: controller,
            onProgress: event => task.update(progressLabel(event)),
            executionSnapshot: { sheetKeys: current.snapshotKeys },
          },
        );
        if (result.dataCommitted === true) {
          try { (topLevelWindow_ACU as any).AutoCardUpdaterAPI?._notifyTableUpdate?.(); } catch { /* 忽略宿主通知失败 */ }
        }
        const ended = result.outcome === 'complete' || result.outcome === 'no_work' || result.success;
        if (result.outcome === 'sync_pending') {
          finishCatchUp('warning', '数据已提交，但世界书同步未完成；可到「填表工作台」仅重试同步。');
        } else if (result.outcome === 'no_work') {
          finishCatchUp('info', '所有表都已追平，无需调用 AI 或写入数据。');
        } else if (result.outcome === 'progress_metadata_failed') {
          finishCatchUp('warning', `数据已提交，但完成状态记录失败：${result.error || '下次追平会重新记录状态。'}`);
        } else if (result.outcome === 'integrity_failed') {
          finishCatchUp('error', `持久化完整性校验失败，已回载聊天中的已保存数据：${result.error || '请执行 V2 恢复诊断。'}`);
        } else if (result.outcome === 'blocked') {
          finishCatchUp('error', result.error || '已在调用 AI 前阻止：V2 存储锚点无法安全修复。');
        } else if (result.outcome === 'stopped' || controller.signal.aborted) {
          finishCatchUp('warning', `已终止；保留了 ${result.committedBucketCount || 0} 个已提交 bucket。`);
        } else if (ended) {
          finishCatchUp('success', `追平完成，共提交 ${result.committedBucketCount || 0} 个 bucket。`);
        } else {
          finishCatchUp('error', result.error || '一键追平失败。');
        }
      } catch (error: any) {
        finishCatchUp('error', error?.message || '一键追平执行异常。');
      } finally {
        task.end();
        abortController = null;
        catchUpBusy.value = false;
      }
    })();
  }

  onScopeDispose(() => {
    if (abortController && !abortController.signal.aborted) abortController.abort();
    abortController = null;
  });

  return {
    configRows,
    busy,
    confirm,
    openLogs,
    openVisualizer,
    detect,
    requestCatchUp,
    acceptCatchUp,
    cancelCatchUp,
  };
}
