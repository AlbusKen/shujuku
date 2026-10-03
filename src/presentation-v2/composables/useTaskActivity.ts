/**
 * useTaskActivity — 汇总「正在干活」的任务，供桌宠动作与通知气泡共用。
 *
 * 任务来源：
 * - notice-hub 登记的任务（V1 填表/规划/优化/索引、V2 store 常驻进度）；
 * - 自带运行状态的功能：智能续写（Agent 会话运行标记）与格林推演（会话运行标记）。
 *   这两类不改 service，只把既有响应式信号合成同一形状的任务。
 */
import { computed, getCurrentScope, onScopeDispose, ref, shallowRef, watch, type ComputedRef, type ShallowRef } from "vue";
import {
  getNoticeHubSnapshot_ACU,
  isNoticeHubSilent_ACU,
  notify_ACU,
  runNoticeTaskAction_ACU,
  subscribeNoticeHub_ACU,
  type NoticeHubSnapshot_ACU,
  type NoticeKind_ACU,
} from "../../shared/notice-hub";
import {
  isAgentSessionRunning_ACU,
  logAgentSession_ACU,
  readAgentSessionLog_ACU,
  subscribeAgentSessionLog_ACU,
} from "../../service/continuation/agent/agent-session-log";
import { getContinuationRuntime_ACU } from "../../service/continuation/continuation-runtime";
import { settings_ACU } from "../../service/runtime/state-manager";
import { saveSettings_ACU } from "../../service/settings/settings-service";
import { deriveWorldSimulationProgressView_ACU } from "../simulation/world-simulation-progress-stage";
import { useChatChangedTick } from "./useChatChangedListener";
import { useWorldSimulationRuntime } from "./useWorldSimulationRuntime";

/** 桌宠在视口中的位置与尺寸（px），气泡据此锚定。 */
export interface DeskPetRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 桌宠吸附的侧边。 */
export type DeskPetDockEdge = "left" | "right" | "top" | "bottom";

/** 桌宠位置按视口可用范围的比例保存（0~1），换屏幕尺寸后仍落在相对同一处。 */
export interface DeskPetPositionRatio {
  x: number;
  y: number;
  /** 吸附的侧边；缺失或 null 表示自由停放（旧数据没有该字段）。 */
  edge?: DeskPetDockEdge | null;
}

function normalizeDockEdge(value: unknown): DeskPetDockEdge | null {
  return value === "left" || value === "right" || value === "top" || value === "bottom" ? value : null;
}

/** 读取已保存的桌宠位置；未保存或数据无效时返回 null（使用默认右下角）。 */
export function readDeskPetPositionRatio(): DeskPetPositionRatio | null {
  const saved = settings_ACU?.desktopPetPosition;
  if (!saved || typeof saved !== "object") return null;
  const x = Number(saved.x);
  const y = Number(saved.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.min(Math.max(x, 0), 1), y: Math.min(Math.max(y, 0), 1), edge: normalizeDockEdge(saved.edge) };
}

/** 保存桌宠位置到独立设置字段（走 saveSettings_ACU，不写 localStorage）。 */
export function saveDeskPetPositionRatio(ratio: DeskPetPositionRatio): void {
  settings_ACU.desktopPetPosition = {
    x: Number(ratio.x.toFixed(4)),
    y: Number(ratio.y.toFixed(4)),
    edge: normalizeDockEdge(ratio.edge),
  };
  saveSettings_ACU();
}

export interface ActivityTaskAction {
  label: string;
  variant?: "default" | "danger";
  run: () => void | Promise<void>;
}

export interface ActivityTask {
  id: string;
  feature: string;
  detail: string;
  kind: NoticeKind_ACU;
  busy: boolean;
  dismissible: boolean;
  action: ActivityTaskAction | null;
}

export interface NoticeHubState {
  snapshot: ShallowRef<NoticeHubSnapshot_ACU>;
  /** 静默模式（随设置加载/修改刷新）。 */
  silent: ComputedRef<boolean>;
  /** 桌宠开关（随设置加载/修改刷新）。 */
  petEnabled: ComputedRef<boolean>;
  /** 冷笑话插播开关：桌宠开启且未单独关闭冷笑话时为 true。 */
  jokesEnabled: ComputedRef<boolean>;
  /** 桌宠开启时直接显示已有通知与任务进度；缺失按关闭处理。 */
  showRealWork: ComputedRef<boolean>;
}

/** notice-hub 快照的响应式镜像。 */
export function useNoticeHubState(): NoticeHubState {
  const snapshot = shallowRef(getNoticeHubSnapshot_ACU());
  const unsubscribe = subscribeNoticeHub_ACU(() => {
    snapshot.value = getNoticeHubSnapshot_ACU();
  });
  if (getCurrentScope()) onScopeDispose(unsubscribe);

  const silent = computed(() => {
    void snapshot.value.settingsVersion;
    return isNoticeHubSilent_ACU();
  });
  const petEnabled = computed(() => {
    void snapshot.value.settingsVersion;
    try {
      return settings_ACU?.desktopPetEnabled !== false;
    } catch {
      return true;
    }
  });
  const jokesEnabled = computed(() => {
    void snapshot.value.settingsVersion;
    if (!petEnabled.value) return false;
    try {
      return settings_ACU?.deskPetJokesEnabled !== false;
    } catch {
      return true;
    }
  });
  const showRealWork = computed(() => {
    void snapshot.value.settingsVersion;
    if (!petEnabled.value) return false;
    try {
      return settings_ACU?.deskPetShowRealWork === true;
    } catch {
      return false;
    }
  });
  return { snapshot, silent, petEnabled, jokesEnabled, showRealWork };
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause ?? "未知错误");
}

/** 智能续写：以 Agent 会话运行标记为准，停止动作与续写页的停止按钮同序。 */
function useContinuationSignal(): ComputedRef<ActivityTask | null> {
  const running = ref(false);
  const detail = ref("");

  function sync(): void {
    running.value = isAgentSessionRunning_ACU();
    if (!running.value) {
      detail.value = "";
      return;
    }
    const entries = readAgentSessionLog_ACU();
    let latest = entries[entries.length - 1];
    for (let index = entries.length - 1; index >= 0; index--) {
      if (entries[index].status === "running") {
        latest = entries[index];
        break;
      }
    }
    detail.value = latest?.title || "";
  }

  async function stop(): Promise<void> {
    if (isAgentSessionRunning_ACU()) {
      logAgentSession_ACU({ kind: "run_failed", title: "已停止", detail: "用户停止", ok: false });
    }
    const runtime = getContinuationRuntime_ACU();
    try {
      await runtime.orchestrator.stopTask();
    } catch (cause) {
      notify_ACU("error", errorText(cause));
    } finally {
      try {
        runtime.bridge.stopHostGeneration();
      } catch {
        // 宿主 API 不可用时仍保留已落盘的停止态。
      }
    }
  }

  sync();
  const unsubscribe = subscribeAgentSessionLog_ACU(sync);
  if (getCurrentScope()) onScopeDispose(unsubscribe);

  return computed(() => running.value
    ? {
        id: "signal-continuation",
        feature: "智能续写",
        detail: detail.value,
        kind: "info",
        busy: true,
        dismissible: false,
        action: { label: "停止", variant: "danger", run: stop },
      }
    : null);
}

/** 格林推演：沿用浮动进度卡的运行态与阶段文案，停止走 runtime 既有入口。 */
function useWorldSimulationSignal(): ComputedRef<ActivityTask | null> {
  const runtime = useWorldSimulationRuntime();
  const view = computed(() => deriveWorldSimulationProgressView_ACU(runtime.entries.value, runtime.running.value));
  runtime.refresh();
  watch(useChatChangedTick(), () => {
    runtime.refresh();
  });
  // 原浮动进度卡会在结束后短暂显示终态；并入气泡后改为一条结果消息。
  watch(runtime.running, (running, wasRunning) => {
    if (running || !wasRunning || !view.value.terminal) return;
    notify_ACU(view.value.phase === "completed" ? "success" : "warning", view.value.label, { title: "格林推演" });
  });

  return computed(() => runtime.running.value
    ? {
        id: "signal-world-simulation",
        feature: "格林推演",
        detail: view.value.label,
        kind: "info",
        busy: true,
        dismissible: false,
        action: { label: "停止", variant: "danger", run: () => runtime.stop() },
      }
    : null);
}

export function useTaskActivity(hubState: NoticeHubState): {
  tasks: ComputedRef<ActivityTask[]>;
  busy: ComputedRef<boolean>;
} {
  const continuation = useContinuationSignal();
  const worldSimulation = useWorldSimulationSignal();

  const tasks = computed<ActivityTask[]>(() => {
    const fromHub: ActivityTask[] = hubState.snapshot.value.tasks.map(task => ({
      id: task.id,
      feature: task.feature,
      detail: task.detail,
      kind: task.kind,
      busy: task.busy,
      dismissible: task.dismissible,
      action: task.action
        ? { label: task.action.label, variant: task.action.variant, run: () => runNoticeTaskAction_ACU(task.id) }
        : null,
    }));
    const signals = [continuation.value, worldSimulation.value].filter((task): task is ActivityTask => !!task);
    return [...fromHub, ...signals];
  });

  const busy = computed(() => tasks.value.some(task => task.busy));
  return { tasks, busy };
}
