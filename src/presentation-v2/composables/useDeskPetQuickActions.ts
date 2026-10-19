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
import { currentChatFileIdentifier_ACU, getCurrentIsolationKey_ACU, settings_ACU } from '../../service/runtime/state-manager';
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

function formatReplyRange(startAiFloor: number, endAiFloor: number): string {
  return startAiFloor === endAiFloor
    ? `第 ${startAiFloor} 条 AI 回复`
    : `第 ${startAiFloor}~${endAiFloor} 条 AI 回复`;
}

function progressLabel(event: CardUpdateProgressEvent): string {
  const prefix = event.currentBatch && event.totalBatches
    ? `第 ${event.currentBatch}/${event.totalBatches} 批 · `
    : '';
  switch (event.phase) {
    case 'preparing': return `${prefix}正在准备聊天内容`;
    case 'calling_ai': return `${prefix}正在让 AI 填写`;
    case 'parsing': return `${prefix}正在整理 AI 的回复`;
    case 'saving': return `${prefix}正在保存表格`;
    case 'chunk_done': return `${prefix}这一批完成了`;
    case 'complete': return `${prefix}完成`;
    case 'retry': return `${prefix}遇到问题，正在重试`;
    case 'error': return `${prefix}出错了`;
    default: return prefix || '处理中';
  }
}

interface PendingCatchUp {
  snapshotKeys: string[];
  scopeKey: string;
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
  let planningGeneration = 0;
  let disposed = false;
  const scopeKey = () => JSON.stringify([currentChatFileIdentifier_ACU, getCurrentIsolationKey_ACU()]);
  const runningElsewhere = () => getNoticeHubSnapshot_ACU().tasks.some(
    task => task.busy && task.feature === MANUAL_CATCH_UP_FEATURE,
  );


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

    const tablePreset = String(settings_ACU.tableApiPreset || '').trim();
    rows.push({
      label: '填表 API',
      value: tablePreset
        ? `${tablePreset}${apiPresetStore.presets.some(preset => preset.name === tablePreset) ? '' : '（已失效）'}`
        : apiPresetStore.activePresetName || apiPresetStore.currentConfigLabel || '当前 API 配置不完整',
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
      try {
        const opened = await openVisualizerSurface_ACU({ source: 'v2-shell' });
        if (opened) return;
      } catch { /* 与返回 false 使用同一可见失败提示。 */ }
      notify_ACU('warning', '表格编辑器打开失败，请稍后重试。', { title: '表格编辑器' });
    })();
  }

  function cancelCatchUp(): void {
    planningGeneration += 1;
    planningBusy.value = false;
    pending = null;
    confirm.value = null;
  }

  async function requestCatchUp(): Promise<void> {
    if (disposed || busy.value || confirm.value) return;
    if (runningElsewhere()) {
      notify_ACU('warning', '已经有一次补填在进行中，等它结束再试。', { title: CATCH_UP_TITLE });
      return;
    }
    const targetKeys = runtimeSheetKeys();
    if (!targetKeys.length) {
      notify_ACU('warning', '表格还没加载好，暂时不能补填；等聊天里的表格出现后再试。', { title: CATCH_UP_TITLE });
      return;
    }
    planningBusy.value = true;
    const generation = ++planningGeneration;
    const planningScope = scopeKey();
    try {
      const planning = await prepareManualCatchUpPlan_ACU(targetKeys);
      if (disposed || generation !== planningGeneration) return;
      if (scopeKey() !== planningScope || !sameKeySet(runtimeSheetKeys(), targetKeys)) {
        finishCatchUp('warning', '规划期间聊天或表格有变化，请重新发起补填。');
        return;
      }
      if (!planning.success || !planning.plan) {
        notify_ACU('error', '没法生成补填计划，请稍后再试。', { title: CATCH_UP_TITLE });
        return;
      }
      const plan = planning.plan;
      if (!plan.waves.length) {
        notify_ACU('info', '所有表都已经是最新的，不用再补了。', { title: CATCH_UP_TITLE });
        return;
      }
      const waveSummary = plan.waves.slice(0, 3).map((wave, index) =>
        `第 ${index + 1} 批：${formatReplyRange(wave.startAiFloor, wave.endAiFloor)}`
      ).join('\n') + (plan.waves.length > 3 ? `\n…共 ${plan.waves.length} 批` : '');
      const skipFloors = Number(settings_ACU.skipUpdateFloors) || 0;
      const skipLine = skipFloors > 0 ? `· 跳过最新 ${skipFloors} 条 AI 回复（最新的先不补）\n` : '';
      pending = { snapshotKeys: targetKeys.slice(), scopeKey: planningScope, plan };
      confirm.value = {
        title: '补齐还没填的内容',
        message: `准备补齐 ${targetKeys.length} 张表还没填的内容。\n· 范围：${formatReplyRange(plan.waves[0].startAiFloor, plan.waves[plan.waves.length - 1].endAiFloor)}，分 ${plan.waves.length} 批处理\n${skipLine}· 只补上次填完之后的新内容，已经填好的部分不会重填\n\n${waveSummary}\n\n开始前会再核对一次表格状态；如果发现表格有变化、可能影响已填内容，会在开始前停下，不会改动任何数据。`,
        confirmLabel: '开始追平',
        cancelLabel: '取消',
      };
    } catch {
      if (disposed || generation !== planningGeneration) return;
      notify_ACU('error', '补填计划生成出错了，请稍后再试。', { title: CATCH_UP_TITLE });
    } finally {
      if (generation === planningGeneration) planningBusy.value = false;
    }
  }

  function finishCatchUp(kind: 'info' | 'success' | 'warning' | 'error', text: string): void {
    notify_ACU(kind, text, { title: CATCH_UP_TITLE });
  }

  function acceptCatchUp(): void {
    const current = pending;
    if (disposed || !current || catchUpBusy.value) return;
    confirm.value = null;
    pending = null;
    if (scopeKey() !== current.scopeKey) {
      finishCatchUp('warning', '确认期间聊天或隔离标签已切换，请重新发起补填。');
      return;
    }
    if (runningElsewhere()) {
      finishCatchUp('warning', '已经有一次补填在进行中，等它结束再试。');
      return;
    }
    // TOCTOU 复检：确认期间 runtime 可能被 purge / 删表 / 新增表。
    const targetKeys = runtimeSheetKeys();
    if (!sameKeySet(targetKeys, current.snapshotKeys)) {
      finishCatchUp('warning', '确认期间表格有变化，这次补填已取消，请重新确认。');
      return;
    }
    catchUpBusy.value = true;
    abortController = new AbortController();
    const controller = abortController;
    const task = beginNoticeTask_ACU(MANUAL_CATCH_UP_FEATURE, {
      detail: '正在准备补填…',
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
          finishCatchUp('warning', '内容已经写入，但世界书还没同步好；可以稍后到「填表工作台」里点「仅同步重试」。');
        } else if (result.outcome === 'no_work') {
          finishCatchUp('info', '所有表都已经是最新的，不用再补了。');
        } else if (result.outcome === 'progress_metadata_failed') {
          finishCatchUp('warning', '内容已经写入表格，但进度记录没保存成功。这不影响已填的内容，下次补填时会先把进度补记上，不会重填这次写好的部分。');
        } else if (result.outcome === 'integrity_failed') {
          finishCatchUp('error', '写入后发现数据不一致，已经恢复成聊天里上次保存的内容。可以到「数据管理」里做一次数据恢复检查。');
        } else if (result.outcome === 'blocked') {
          finishCatchUp('error', '为了不覆盖已有内容，这次补填在开始前停下了。可以先到「数据管理」里的数据恢复检查看一下。');
        } else if (result.outcome === 'stopped' || controller.signal.aborted) {
          finishCatchUp('warning', `已停止；已经写好的 ${result.committedBucketCount || 0} 段保留了。`);
        } else if (ended) {
          finishCatchUp('success', `补填完成，共写入 ${result.committedBucketCount || 0} 段。`);
        } else {
          finishCatchUp('error', '补填没有完成，请稍后再试。');
        }
      } catch {
        finishCatchUp('error', '补填过程中出错了，请稍后再试。');
      } finally {
        task.end();
        abortController = null;
        catchUpBusy.value = false;
      }
    })();
  }

  onScopeDispose(() => {
    disposed = true;
    cancelCatchUp();
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
