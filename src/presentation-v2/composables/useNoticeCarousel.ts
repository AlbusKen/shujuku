/**
 * useNoticeCarousel — 单气泡轮播调度
 *
 * 时间片固定 5 秒：待播消息先进先出、播完出队；进行中任务循环复播。
 * 每播满 2 片消息/任务插 1 片冷笑话；无消息无任务时空闲，每 5 分钟冒 1 条笑话。
 * 静默模式或页面隐藏时不播放（静默时清空待播消息）。单一计时器驱动。
 */
import { computed, getCurrentScope, onScopeDispose, ref, watch, type ComputedRef, type Ref } from "vue";
import { clearNotices_ACU, dismissNoticeTask_ACU, runNoticeAction_ACU, shiftNotice_ACU, type Notice_ACU, type NoticeAction_ACU } from "../../shared/notice-hub";
import { acuClearTimeout, acuSetTimeout, type AcuTimerHandle } from "../bootstrap/host-env";
import { getAcuHostDocument } from "../bootstrap/host-document";
import { pickDeskPetJoke } from "../copy/desk-pet-jokes";
import { pickDeskPetStatusWord } from "../copy/desk-pet-status-words";
import type { ActivityTask, NoticeHubState } from "./useTaskActivity";

export const NOTICE_SLIDE_MS = 5000;
export const NOTICE_IDLE_JOKE_MS = 5 * 60 * 1000;
export const NOTICE_SLIDES_PER_JOKE = 2;
/** 悬停后恢复计时时至少保留的展示时间，给用户移开鼠标后的余量。 */
const RESUME_MIN_MS = 1500;

export type NoticeSlide =
  | { type: "notice"; key: string; notice: Notice_ACU; word: string }
  | { type: "task"; key: string; taskId: string; word: string }
  | { type: "joke"; key: string; text: string };

export interface NoticeCarousel {
  slide: Ref<NoticeSlide | null>;
  /** 当前任务片对应的最新任务数据（进度实时刷新）。 */
  currentTask: ComputedRef<ActivityTask | null>;
  actionBusy: Ref<boolean>;
  skip(): void;
  pause(): void;
  resume(): void;
  runNoticeAction(action: NoticeAction_ACU): Promise<void>;
  runTaskAction(): Promise<void>;
  dismissTask(): void;
}

export function useNoticeCarousel(hubState: NoticeHubState, tasks: ComputedRef<ActivityTask[]>): NoticeCarousel {
  const slide = ref<NoticeSlide | null>(null);
  const actionBusy = ref(false);
  const pageHidden = ref(false);
  let slideTimer: AcuTimerHandle | undefined;
  let idleTimer: AcuTimerHandle | undefined;
  let slideStartedAt = 0;
  let pausedRemaining: number | null = null;
  let slidesSinceJoke = 0;
  let lastTaskId: string | null = null;
  let lastJoke = "";
  let nextKey = 1;

  const active = computed(() => !hubState.silent.value && !pageHidden.value);

  const currentTask = computed<ActivityTask | null>(() => {
    const current = slide.value;
    if (!current || current.type !== "task") return null;
    return tasks.value.find(task => task.id === current.taskId) ?? null;
  });

  function clearSlideTimer(): void {
    if (slideTimer === undefined) return;
    acuClearTimeout(slideTimer);
    slideTimer = undefined;
  }

  function clearIdleTimer(): void {
    if (idleTimer === undefined) return;
    acuClearTimeout(idleTimer);
    idleTimer = undefined;
  }

  function hasContent(): boolean {
    return hubState.snapshot.value.notices.length > 0 || tasks.value.length > 0;
  }

  function nextTask(): ActivityTask | null {
    const list = tasks.value;
    if (!list.length) return null;
    const lastIndex = lastTaskId ? list.findIndex(task => task.id === lastTaskId) : -1;
    return list[(lastIndex + 1) % list.length];
  }

  function show(next: NoticeSlide): void {
    clearSlideTimer();
    clearIdleTimer();
    actionBusy.value = false;
    pausedRemaining = null;
    slide.value = next;
    slideStartedAt = Date.now();
    slideTimer = acuSetTimeout(advance, NOTICE_SLIDE_MS);
  }

  function showJoke(): void {
    // 冷笑话插播开关关闭（或桌宠关闭）时不再出现冷笑话。
    if (!hubState.jokesEnabled.value) return;
    lastJoke = pickDeskPetJoke(lastJoke);
    if (!lastJoke) return;
    show({ type: "joke", key: `joke-${nextKey++}`, text: lastJoke });
  }

  function armIdle(): void {
    clearIdleTimer();
    if (!active.value || !hubState.jokesEnabled.value) return;
    idleTimer = acuSetTimeout(() => {
      idleTimer = undefined;
      if (slide.value === null && active.value) showJoke();
    }, NOTICE_IDLE_JOKE_MS);
  }

  function goIdle(): void {
    clearSlideTimer();
    slide.value = null;
    slidesSinceJoke = 0;
    armIdle();
  }

  function advance(): void {
    clearSlideTimer();
    if (!active.value) {
      slide.value = null;
      return;
    }
    if (hubState.jokesEnabled.value && slidesSinceJoke >= NOTICE_SLIDES_PER_JOKE && hasContent()) {
      slidesSinceJoke = 0;
      showJoke();
      return;
    }
    const notice = shiftNotice_ACU();
    if (notice) {
      slidesSinceJoke += 1;
      show({ type: "notice", key: notice.id, notice, word: pickDeskPetStatusWord(`${notice.title} ${notice.text}`) });
      return;
    }
    const task = nextTask();
    if (task) {
      slidesSinceJoke += 1;
      lastTaskId = task.id;
      show({ type: "task", key: `${task.id}-${nextKey++}`, taskId: task.id, word: pickDeskPetStatusWord(task.feature) });
      return;
    }
    goIdle();
  }

  function skip(): void {
    advance();
  }

  function pause(): void {
    if (slideTimer === undefined) return;
    pausedRemaining = Math.max(0, NOTICE_SLIDE_MS - (Date.now() - slideStartedAt));
    clearSlideTimer();
  }

  function resume(): void {
    if (pausedRemaining === null || !slide.value) return;
    const remaining = Math.max(pausedRemaining, RESUME_MIN_MS);
    pausedRemaining = null;
    slideStartedAt = Date.now() - (NOTICE_SLIDE_MS - remaining);
    slideTimer = acuSetTimeout(advance, remaining);
  }

  async function runNoticeAction(action: NoticeAction_ACU): Promise<void> {
    if (actionBusy.value) return;
    actionBusy.value = true;
    try {
      await runNoticeAction_ACU(action);
    } finally {
      actionBusy.value = false;
    }
    advance();
  }

  async function runTaskAction(): Promise<void> {
    const task = currentTask.value;
    if (!task?.action || actionBusy.value) return;
    actionBusy.value = true;
    try {
      await task.action.run();
    } catch {
      // 动作自身负责提示；这里只保证按钮状态复位。
    } finally {
      actionBusy.value = false;
    }
  }

  function dismissTask(): void {
    const task = currentTask.value;
    if (!task?.dismissible) return;
    dismissNoticeTask_ACU(task.id);
    advance();
  }

  // 新内容到达时从空闲唤醒。
  watch(
    () => [hubState.snapshot.value.notices.length, tasks.value.length] as const,
    () => {
      if (active.value && slide.value === null && hasContent()) advance();
    },
  );

  // 当前任务片对应的任务结束时立即切走，不留空气泡。
  watch(
    () => slide.value?.type === "task" && !currentTask.value,
    (taskGone) => {
      if (taskGone) advance();
    },
  );

  watch(active, (isActive) => {
    if (!isActive) {
      clearSlideTimer();
      clearIdleTimer();
      slide.value = null;
      if (hubState.silent.value) clearNotices_ACU();
      return;
    }
    advance();
  }, { immediate: true });

  // 冷笑话开关切换：打开后若正空闲则重新计时，关闭后撤掉待插播的空闲笑话。
  watch(
    () => hubState.jokesEnabled.value,
    (enabled) => {
      if (!enabled) clearIdleTimer();
      else if (slide.value === null) armIdle();
    },
  );

  const doc = getAcuHostDocument();
  const onVisibilityChange = (): void => {
    pageHidden.value = doc.hidden === true;
  };
  onVisibilityChange();
  doc.addEventListener("visibilitychange", onVisibilityChange);

  if (getCurrentScope()) {
    onScopeDispose(() => {
      doc.removeEventListener("visibilitychange", onVisibilityChange);
      clearSlideTimer();
      clearIdleTimer();
    });
  }

  return { slide, currentTask, actionBusy, skip, pause, resume, runNoticeAction, runTaskAction, dismissTask };
}
