/**
 * shared/notice-hub.ts — 通知与进行中任务的统一汇流口
 *
 * 无框架依赖：V1 showToastr_ACU、V2 toast-store、ui-surface 与 service 层都把
 * 用户可见提示汇到这里，由 presentation-v2 的浮动气泡与桌宠订阅快照后呈现。
 *
 * - 一次性消息（notice）进入先进先出队列，由气泡按时间片逐条取出播放；
 * - 进行中任务（task）在结束前一直登记，气泡循环复播，桌宠据此切换工作状态；
 * - 静默模式只丢弃消息、隐藏任务气泡，任务登记照常进行（桌宠仍会干活）。
 *
 * 订阅者异常被就地吞掉：提示通道绝不允许反过来破坏调用方业务流程。
 */
import { logDebug_ACU } from './utils';

export type NoticeKind_ACU = 'info' | 'success' | 'warning' | 'error';

export interface NoticeAction_ACU {
  label: string;
  run: () => void | Promise<void>;
  variant?: 'default' | 'danger';
}

export interface Notice_ACU {
  id: string;
  kind: NoticeKind_ACU;
  title: string;
  text: string;
  createdAt: number;
  actions: NoticeAction_ACU[];
}

export interface NoticeTask_ACU {
  id: string;
  /** 功能名，如「自动填表」「剧情规划」，气泡据此挑状态词。 */
  feature: string;
  /** 真实进度文本。 */
  detail: string;
  kind: NoticeKind_ACU;
  startedAt: number;
  /** false 表示这是常驻待处理提示（如「待重试」），不驱动桌宠工作动画。 */
  busy: boolean;
  dismissible: boolean;
  action: NoticeAction_ACU | null;
}

export interface NoticeTaskOptions_ACU {
  detail?: string;
  kind?: NoticeKind_ACU;
  busy?: boolean;
  dismissible?: boolean;
  action?: NoticeAction_ACU | null;
}

export interface NoticeTaskPatch_ACU {
  kind?: NoticeKind_ACU;
  busy?: boolean;
  dismissible?: boolean;
  /** undefined 保持原样；null 移除操作按钮。 */
  action?: NoticeAction_ACU | null;
}

export interface NoticeTaskOutcome_ACU {
  kind: NoticeKind_ACU;
  text: string;
  title?: string;
}

export interface NoticeTaskHandle_ACU {
  readonly id: string;
  readonly ended: boolean;
  update(detail: string, patch?: NoticeTaskPatch_ACU): void;
  setAction(action: NoticeAction_ACU | null): void;
  /** 结束任务；可附带一次性结果消息（走普通消息队列，静默时同样被丢弃）。 */
  end(outcome?: NoticeTaskOutcome_ACU): void;
}

export interface NotifyOptions_ACU {
  title?: string;
  actions?: NoticeAction_ACU[];
}

export interface NoticeHubSnapshot_ACU {
  /** 任一状态变化都会递增，供订阅方判断是否需要重读。 */
  version: number;
  /** 设置（静默、桌宠开关与位置）可能变化时递增。 */
  settingsVersion: number;
  notices: readonly Notice_ACU[];
  tasks: readonly NoticeTask_ACU[];
}

export interface NoticeHubConfig_ACU {
  isSilent?: () => boolean;
}

/** 同文案去重窗口，沿用旧 toast 的 1.2 秒。 */
const DEDUPE_WINDOW_MS_ACU = 1200;
/** 待播消息上限；溢出丢最旧的并留日志。 */
const NOTICE_QUEUE_LIMIT_ACU = 20;
const MAX_TEXT_LENGTH_ACU = 600;

let config_ACU: NoticeHubConfig_ACU = {};
let notices_ACU: Notice_ACU[] = [];
let tasks_ACU: NoticeTask_ACU[] = [];
let version_ACU = 0;
let settingsVersion_ACU = 0;
let nextId_ACU = 1;
let snapshot_ACU: NoticeHubSnapshot_ACU | null = null;
const dedupe_ACU = new Map<string, number>();
const listeners_ACU = new Set<() => void>();

function emit_ACU(): void {
  version_ACU += 1;
  snapshot_ACU = null;
  for (const listener of [...listeners_ACU]) {
    try { listener(); } catch { /* 订阅者异常不允许影响调用方。 */ }
  }
}

function decodeEntities_ACU(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
}

/**
 * 把旧通知里的 HTML 片段压成纯文本：丢掉内嵌按钮（改由结构化 action 表达），
 * 换行类标签转成换行，其余标签剥掉。
 */
export function toNoticePlainText_ACU(raw: unknown): string {
  const text = String(raw ?? '')
    .replace(/<button\b[\s\S]*?<\/button>/gi, ' ')
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  const normalized = decodeEntities_ACU(text)
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  return normalized.length > MAX_TEXT_LENGTH_ACU ? `${normalized.slice(0, MAX_TEXT_LENGTH_ACU)}…` : normalized;
}

function makeId_ACU(prefix: string): string {
  return `${prefix}-${nextId_ACU++}`;
}

export function configureNoticeHub_ACU(next: NoticeHubConfig_ACU): void {
  config_ACU = { ...config_ACU, ...next };
  notifyNoticeSettingsChanged_ACU();
}

export function isNoticeHubSilent_ACU(): boolean {
  try {
    return config_ACU.isSilent?.() === true;
  } catch {
    return false;
  }
}

/** 设置被加载或修改后调用，让气泡与桌宠重读静默、桌宠开关与位置。 */
export function notifyNoticeSettingsChanged_ACU(): void {
  settingsVersion_ACU += 1;
  emit_ACU();
}

/**
 * 发布一条一次性消息。
 * @returns 消息 id；空文本、静默或去重命中时返回 null
 */
export function notify_ACU(kind: NoticeKind_ACU, rawText: unknown, options: NotifyOptions_ACU = {}): string | null {
  const text = toNoticePlainText_ACU(rawText);
  if (!text) return null;
  const title = toNoticePlainText_ACU(options.title || '');
  if (isNoticeHubSilent_ACU()) {
    logDebug_ACU(`[静默模式] 已丢弃通知(${kind})：${title ? `${title} · ` : ''}${text}`);
    return null;
  }
  const now = Date.now();
  const key = `${kind}|${title}|${text.slice(0, 120)}`;
  const last = dedupe_ACU.get(key) || 0;
  if (now - last < DEDUPE_WINDOW_MS_ACU) return null;
  dedupe_ACU.set(key, now);
  if (dedupe_ACU.size > 200) {
    for (const [entryKey, at] of dedupe_ACU) {
      if (now - at >= DEDUPE_WINDOW_MS_ACU) dedupe_ACU.delete(entryKey);
    }
  }

  const notice: Notice_ACU = {
    id: makeId_ACU('notice'),
    kind,
    title,
    text,
    createdAt: now,
    actions: Array.isArray(options.actions) ? options.actions.filter(action => action && action.label) : [],
  };
  notices_ACU = [...notices_ACU, notice];
  if (notices_ACU.length > NOTICE_QUEUE_LIMIT_ACU) {
    const dropped = notices_ACU.slice(0, notices_ACU.length - NOTICE_QUEUE_LIMIT_ACU);
    notices_ACU = notices_ACU.slice(-NOTICE_QUEUE_LIMIT_ACU);
    for (const item of dropped) logDebug_ACU(`[通知] 待播队列已满，丢弃最旧通知：${item.text}`);
  }
  emit_ACU();
  return notice.id;
}

/** 气泡取出下一条待播消息（出队）。 */
export function shiftNotice_ACU(): Notice_ACU | null {
  if (!notices_ACU.length) return null;
  const [head, ...rest] = notices_ACU;
  notices_ACU = rest;
  emit_ACU();
  return head;
}

/** 丢弃全部待播消息（静默模式开启时由气泡调用）。 */
export function clearNotices_ACU(): void {
  if (!notices_ACU.length) return;
  notices_ACU = [];
  emit_ACU();
}

function patchTask_ACU(id: string, patch: Partial<Omit<NoticeTask_ACU, 'id' | 'startedAt'>>): void {
  let changed = false;
  tasks_ACU = tasks_ACU.map(task => {
    if (task.id !== id) return task;
    changed = true;
    return { ...task, ...patch };
  });
  if (changed) emit_ACU();
}

function removeTask_ACU(id: string): boolean {
  const before = tasks_ACU.length;
  tasks_ACU = tasks_ACU.filter(task => task.id !== id);
  if (tasks_ACU.length === before) return false;
  emit_ACU();
  return true;
}

/**
 * 登记一个进行中任务。静默模式下同样登记，只是不在气泡里显示。
 * @param feature 功能名
 */
export function beginNoticeTask_ACU(feature: string, options: NoticeTaskOptions_ACU = {}): NoticeTaskHandle_ACU {
  const id = makeId_ACU('task');
  let ended = false;
  tasks_ACU = [...tasks_ACU, {
    id,
    feature: String(feature || '任务'),
    detail: toNoticePlainText_ACU(options.detail || ''),
    kind: options.kind || 'info',
    startedAt: Date.now(),
    busy: options.busy !== false,
    dismissible: options.dismissible === true,
    action: options.action || null,
  }];
  emit_ACU();

  return {
    id,
    get ended() {
      return ended || !tasks_ACU.some(task => task.id === id);
    },
    update(detail: string, patch: NoticeTaskPatch_ACU = {}) {
      if (ended) return;
      const next: Partial<NoticeTask_ACU> = { detail: toNoticePlainText_ACU(detail) };
      if (patch.kind) next.kind = patch.kind;
      if (typeof patch.busy === 'boolean') next.busy = patch.busy;
      if (typeof patch.dismissible === 'boolean') next.dismissible = patch.dismissible;
      if (patch.action !== undefined) next.action = patch.action;
      patchTask_ACU(id, next);
    },
    setAction(action: NoticeAction_ACU | null) {
      if (ended) return;
      patchTask_ACU(id, { action });
    },
    end(outcome?: NoticeTaskOutcome_ACU) {
      if (ended) return;
      ended = true;
      removeTask_ACU(id);
      if (outcome?.text) notify_ACU(outcome.kind, outcome.text, { title: outcome.title });
    },
  };
}

/** 用户在气泡上关闭一个可关闭的任务。 */
export function dismissNoticeTask_ACU(id: string): void {
  const task = tasks_ACU.find(item => item.id === id);
  if (!task || !task.dismissible) return;
  removeTask_ACU(id);
}

/** 执行任务上的操作按钮（停止、重试等）；异常只记日志。 */
export async function runNoticeTaskAction_ACU(id: string): Promise<void> {
  const task = tasks_ACU.find(item => item.id === id);
  const action = task?.action;
  if (!action) return;
  try {
    await action.run();
  } catch (error) {
    logDebug_ACU(`[通知] 任务「${task?.feature}」操作失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

/** 执行一次性消息上的操作按钮；异常只记日志。 */
export async function runNoticeAction_ACU(action: NoticeAction_ACU): Promise<void> {
  try {
    await action.run();
  } catch (error) {
    logDebug_ACU(`[通知] 操作「${action.label}」失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

export function getNoticeHubSnapshot_ACU(): NoticeHubSnapshot_ACU {
  if (!snapshot_ACU) {
    snapshot_ACU = {
      version: version_ACU,
      settingsVersion: settingsVersion_ACU,
      notices: notices_ACU,
      tasks: tasks_ACU,
    };
  }
  return snapshot_ACU;
}

export function subscribeNoticeHub_ACU(listener: () => void): () => void {
  listeners_ACU.add(listener);
  return () => { listeners_ACU.delete(listener); };
}

/** 仅供测试：清空全部状态与配置。 */
export function __resetNoticeHubForTests_ACU(): void {
  config_ACU = {};
  notices_ACU = [];
  tasks_ACU = [];
  version_ACU = 0;
  settingsVersion_ACU = 0;
  nextId_ACU = 1;
  snapshot_ACU = null;
  dedupe_ACU.clear();
  listeners_ACU.clear();
}
