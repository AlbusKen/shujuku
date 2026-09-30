import { defineStore } from "pinia";
import {
  beginNoticeTask_ACU,
  isNoticeHubSilent_ACU,
  notify_ACU,
  type NoticeAction_ACU,
  type NoticeTaskHandle_ACU,
} from "../../shared/notice-hub";
import { acuClearTimeout, acuSetTimeout, type AcuTimerHandle } from "../bootstrap/host-env";

export type ToastKind = "info" | "success" | "warning" | "error";

export interface ToastAction {
  label: string;
  onClick: () => void | Promise<void>;
  dismissOnClick?: boolean;
  variant?: "default" | "danger";
}

export interface ToastItem {
  id: string;
  kind: ToastKind;
  text: string;
  createdAt: number;
  durationMs: number;
  dismissible: boolean;
  action?: ToastAction;
}

export interface ToastOptions {
  durationMs?: number;
  dismissible?: boolean;
  action?: ToastAction;
  /** 旧「静默提示框」豁免标记；静默模式改由 notice-hub 统一判定后不再生效，保留仅为兼容调用方。 */
  muteable?: boolean;
  maxItems?: number;
  /** durationMs 为 0 的常驻提示会登记为进行中任务；feature 是气泡里显示的功能名。 */
  feature?: string;
  /** 常驻提示是否代表正在干活（驱动桌宠工作动画）；待处理类提示传 false。默认 true。 */
  busy?: boolean;
}

const DEFAULT_DURATION_BY_KIND: Record<ToastKind, number> = {
  info: 2600,
  success: 2600,
  warning: 4000,
  error: 5000,
};

const DEFAULT_MAX_ITEMS = 4;
const DEFAULT_TASK_FEATURE = "任务";

let nextToastId = 1;
const dismissTimers = new Map<string, AcuTimerHandle>();
/** durationMs 为 0 的提示对应的 notice-hub 任务句柄。 */
const taskHandles = new Map<string, NoticeTaskHandle_ACU>();
let nextClearVersion = 0;

function makeToastId(): string {
  return `toast-${nextToastId++}`;
}

function clearDismissTimer(id: string): void {
  const timer = dismissTimers.get(id);
  if (timer === undefined) return;
  acuClearTimeout(timer);
  dismissTimers.delete(id);
}

function endTask(id: string, outcome?: { kind: ToastKind; text: string }): void {
  const handle = taskHandles.get(id);
  if (!handle) return;
  taskHandles.delete(id);
  handle.end(outcome);
}

function resolveDuration(kind: ToastKind, options: ToastOptions): number {
  return typeof options.durationMs === "number"
    ? Math.max(0, Math.trunc(options.durationMs))
    : DEFAULT_DURATION_BY_KIND[kind];
}

export const useToastStore = defineStore("acu-v2-toast", {
  state: () => ({
    items: [] as ToastItem[],
    clearVersion: 0,
  }),
  actions: {
    notify(kind: ToastKind, text: string, options: ToastOptions = {}): string | null {
      const normalizedText = String(text || "").trim();
      if (!normalizedText) return null;

      const durationMs = resolveDuration(kind, options);
      // 静默模式丢弃一次性通知；常驻进度仍登记为任务（只是不显示），调用方可继续更新。
      if (durationMs > 0 && isNoticeHubSilent_ACU()) return null;

      const id = makeToastId();
      const item: ToastItem = {
        id,
        kind,
        text: normalizedText,
        createdAt: Date.now(),
        durationMs,
        dismissible: options.dismissible !== false,
        action: options.action,
      };

      this.items.push(item);
      this.forwardToHub(item, options);
      this.pruneToMax(options.maxItems ?? DEFAULT_MAX_ITEMS);
      if (this.items.some((current) => current.id === id) && durationMs > 0) {
        dismissTimers.set(id, acuSetTimeout(() => this.dismiss(id), durationMs));
      }
      return id;
    },
    success(text: string, options?: ToastOptions): string | null {
      return this.notify("success", text, options);
    },
    info(text: string, options?: ToastOptions): string | null {
      return this.notify("info", text, options);
    },
    warning(text: string, options?: ToastOptions): string | null {
      return this.notify("warning", text, options);
    },
    error(text: string, options?: ToastOptions): string | null {
      return this.notify("error", text, options);
    },
    dismiss(id: string): void {
      clearDismissTimer(id);
      endTask(id);
      this.items = this.items.filter((item) => item.id !== id);
    },
    update(id: string, kind: ToastKind, text: string, options: ToastOptions = {}): boolean {
      const normalizedText = String(text || "").trim();
      if (!normalizedText) return false;
      const item = this.items.find((current) => current.id === id);
      if (!item) return false;

      clearDismissTimer(id);
      item.kind = kind;
      item.text = normalizedText;
      item.durationMs = resolveDuration(kind, options);
      item.dismissible = options.dismissible !== false;
      item.action = options.action;
      this.forwardToHub(item, options);
      if (item.durationMs > 0) {
        dismissTimers.set(id, acuSetTimeout(() => this.dismiss(id), item.durationMs));
      }
      return true;
    },
    clear(): void {
      for (const item of this.items) {
        clearDismissTimer(item.id);
        endTask(item.id);
      }
      this.items = [];
      this.clearVersion = ++nextClearVersion;
    },
    pruneToMax(maxItems: number): void {
      const max = Math.max(1, Math.trunc(maxItems));
      if (this.items.length <= max) return;
      const removed = this.items.slice(0, this.items.length - max);
      for (const item of removed) {
        clearDismissTimer(item.id);
        endTask(item.id);
      }
      this.items = this.items.slice(this.items.length - max);
    },
    /**
     * 把 store 条目同步到 notice-hub：常驻条目（durationMs 0）对应一个任务，
     * 一次性条目发布为消息；常驻条目更新为一次性文本时结束任务并带出结果消息。
     */
    forwardToHub(item: ToastItem, options: ToastOptions): void {
      const id = item.id;
      const action = item.action ? this.toHubAction(id, item.action) : null;
      const existing = taskHandles.get(id);
      if (item.durationMs === 0) {
        const patch = {
          kind: item.kind,
          action,
          busy: options.busy !== false,
          dismissible: options.dismissible === true,
        };
        if (existing && !existing.ended) {
          existing.update(item.text, patch);
          return;
        }
        taskHandles.set(id, beginNoticeTask_ACU(options.feature || DEFAULT_TASK_FEATURE, {
          detail: item.text,
          ...patch,
        }));
        return;
      }
      if (existing) {
        endTask(id, { kind: item.kind, text: item.text });
        return;
      }
      notify_ACU(item.kind, item.text, action ? { actions: [action] } : {});
    },
    toHubAction(id: string, action: ToastAction): NoticeAction_ACU {
      return {
        label: action.label,
        variant: action.variant,
        run: async () => {
          await action.onClick();
          if (action.dismissOnClick !== false) this.dismiss(id);
        },
      };
    },
  },
});

/** 仅供测试使用：清理模块级自动关闭定时器，避免 jsdom teardown 后回调访问已销毁的 window。 */
export function __resetToastStoreForTests(): void {
  for (const timer of dismissTimers.values()) {
    acuClearTimeout(timer);
  }
  dismissTimers.clear();
  for (const handle of taskHandles.values()) {
    handle.end();
  }
  taskHandles.clear();
  nextToastId = 1;
  nextClearVersion = 0;
}
