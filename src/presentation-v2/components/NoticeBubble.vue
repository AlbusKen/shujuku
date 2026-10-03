<template>
  <div
    v-if="slide"
    ref="bubbleEl"
    class="acu-notice-bubble"
    :class="[
      `acu-notice-bubble--${tone}`,
      anchor ? `is-anchored is-${placement.side}` : 'is-docked',
      { 'is-measuring': anchor && !measured },
    ]"
    :style="bubbleStyle"
    :role="tone === 'error' ? 'alert' : 'status'"
    aria-live="polite"
    @pointerenter="emit('pause')"
    @pointerleave="onPointerLeave"
  >
    <div
      class="acu-notice-bubble__body"
      :class="{ 'is-expandable': expandable }"
      :role="expandable ? 'button' : undefined"
      :tabindex="expandable ? 0 : undefined"
      :aria-expanded="expandable ? expanded : undefined"
      :title="expandable ? (expanded ? '点击收起' : '点击查看在做什么') : undefined"
      @click="toggleDetail"
      @keydown.enter.prevent="toggleDetail"
      @keydown.space.prevent="toggleDetail"
    >
      <p v-if="heading" class="acu-notice-bubble__heading">{{ heading }}</p>
      <p v-if="bodyText" class="acu-notice-bubble__text">{{ bodyText }}</p>
      <div v-if="expandable" v-show="expanded" class="acu-notice-bubble__detail">
        <p v-if="detailTitle" class="acu-notice-bubble__detail-title">{{ detailTitle }}</p>
        <p v-if="detailText" class="acu-notice-bubble__detail-text">{{ detailText }}</p>
      </div>
    </div>
    <div v-if="actionButtons.length || closable" class="acu-notice-bubble__tools">
      <button
        v-for="button in actionButtons"
        :key="button.label"
        type="button"
        class="acu-notice-bubble__action"
        :class="{ 'is-danger': button.variant === 'danger' }"
        :disabled="actionBusy"
        @click="button.run"
      >
        {{ button.label }}
      </button>
      <button
        v-if="closable"
        type="button"
        class="acu-notice-bubble__close"
        :title="slide.type === 'task' ? '关闭提示' : '下一条'"
        :aria-label="slide.type === 'task' ? '关闭提示' : '下一条'"
        @click="onClose"
      >
        ×
      </button>
    </div>
    <span v-if="anchor" class="acu-notice-bubble__tail" :style="tailStyle" aria-hidden="true"></span>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import type { NoticeAction_ACU } from "../../shared/notice-hub";
import type { NoticeSlide } from "../composables/useNoticeCarousel";
import type { ActivityTask, DeskPetRect } from "../composables/useTaskActivity";

const props = defineProps<{
  slide: NoticeSlide | null;
  task: ActivityTask | null;
  /** 桌宠位置；为 null 时气泡停靠在原通知位置。 */
  anchor: DeskPetRect | null;
  viewportWidth: number;
  viewportHeight: number;
  actionBusy: boolean;
  showRealWork?: boolean;
}>();

const emit = defineEmits<{
  (event: "pause"): void;
  (event: "resume"): void;
  (event: "skip"): void;
  (event: "notice-action", action: NoticeAction_ACU): void;
  (event: "task-action"): void;
  (event: "dismiss-task"): void;
}>();

const BUBBLE_GAP_PX = 12;
const VIEWPORT_MARGIN_PX = 8;

const bubbleEl = ref<HTMLElement | null>(null);
const bubbleSize = ref({ width: 0, height: 0 });
const measured = computed(() => bubbleSize.value.width > 0 && bubbleSize.value.height > 0);
let resizeObserver: ResizeObserver | null = null;

const tone = computed(() => {
  const current = props.slide;
  if (!current) return "info";
  if (current.type === "joke") return "joke";
  if (current.type === "notice") return current.notice.kind;
  return props.task?.kind || "info";
});

const heading = computed(() => {
  const current = props.slide;
  if (!current) return "";
  if (current.type === "joke") return "你知道吗？";
  if (props.showRealWork) {
    return current.type === "notice" ? current.notice.title : props.task?.feature || "";
  }
  return "";
});

/** 真实内容沿用现有通知/进度，不额外读取任务载荷；默认显示桌宠状态词。 */
const bodyText = computed(() => {
  const current = props.slide;
  if (!current) return "";
  if (current.type === "joke") return current.text;
  if (props.showRealWork) {
    return current.type === "notice" ? current.notice.text : props.task?.detail || "";
  }
  if (current.type === "notice") return `正在${current.word}…`;
  return props.task ? `正在${current.word}…` : "";
});

const actionButtons = computed(() => {
  const current = props.slide;
  if (!current) return [];
  if (current.type === "notice") {
    return current.notice.actions.map(action => ({
      label: action.label,
      variant: action.variant,
      run: () => emit("notice-action", action),
    }));
  }
  if (current.type === "task" && props.task?.action) {
    return [{ label: props.task.action.label, variant: props.task.action.variant, run: () => emit("task-action") }];
  }
  return [];
});

/** 任务片只有可关闭任务才显示关闭；消息与笑话的关闭即跳到下一条。 */
const closable = computed(() => props.slide?.type !== "task" || props.task?.dismissible === true);

/** 通知片与任务片可点开查看真实内容；默认只显示「正在XXXX…」。 */
const expanded = ref(false);
const detailTitle = computed(() => {
  const current = props.slide;
  if (current?.type === "notice") return current.notice.title;
  if (current?.type === "task") return props.task?.feature || "";
  return "";
});
const detailText = computed(() => {
  const current = props.slide;
  if (current?.type === "notice") return current.notice.text;
  if (current?.type === "task") return props.task?.detail || "";
  return "";
});
const expandable = computed(() => !props.showRealWork && props.slide?.type !== "joke" && !!(detailText.value || detailTitle.value));

function toggleDetail(): void {
  if (!expandable.value) return;
  expanded.value = !expanded.value;
  // 展开时暂停轮播，方便看完；收起后继续。
  emit(expanded.value ? "pause" : "resume");
}

function onPointerLeave(event: PointerEvent): void {
  // 触屏点按后会立刻触发 pointerleave；展开期间不因此恢复轮播。
  if (expanded.value && event.pointerType !== "mouse") return;
  emit("resume");
}

watch(() => props.slide?.key, () => {
  expanded.value = false;
});

function onClose(): void {
  if (props.slide?.type === "task") emit("dismiss-task");
  else emit("skip");
}

/** 贴桌宠摆放：优先上方，放不下翻到下方，再不行放左右两侧，最后夹进视口。 */
const placement = computed(() => {
  const anchor = props.anchor;
  const { width, height } = bubbleSize.value;
  const vw = props.viewportWidth;
  const vh = props.viewportHeight;
  const clampX = (x: number) => Math.min(Math.max(VIEWPORT_MARGIN_PX, x), Math.max(VIEWPORT_MARGIN_PX, vw - width - VIEWPORT_MARGIN_PX));
  const clampY = (y: number) => Math.min(Math.max(VIEWPORT_MARGIN_PX, y), Math.max(VIEWPORT_MARGIN_PX, vh - height - VIEWPORT_MARGIN_PX));
  if (!anchor) return { side: "above" as const, left: 0, top: 0 };
  const centerX = anchor.x + anchor.width / 2;
  const centerY = anchor.y + anchor.height / 2;
  const above = anchor.y - height - BUBBLE_GAP_PX;
  if (above >= VIEWPORT_MARGIN_PX) return { side: "above" as const, left: clampX(centerX - width / 2), top: above };
  const below = anchor.y + anchor.height + BUBBLE_GAP_PX;
  if (below + height <= vh - VIEWPORT_MARGIN_PX) return { side: "below" as const, left: clampX(centerX - width / 2), top: below };
  const leftSide = anchor.x - width - BUBBLE_GAP_PX;
  if (leftSide >= VIEWPORT_MARGIN_PX) return { side: "left" as const, left: leftSide, top: clampY(centerY - height / 2) };
  return { side: "right" as const, left: clampX(anchor.x + anchor.width + BUBBLE_GAP_PX), top: clampY(centerY - height / 2) };
});

const bubbleStyle = computed(() => {
  if (!props.anchor) return {};
  return { transform: `translate3d(${Math.round(placement.value.left)}px, ${Math.round(placement.value.top)}px, 0)` };
});

/** 尾巴指向桌宠中心，夹在气泡边缘内。 */
const tailStyle = computed(() => {
  const anchor = props.anchor;
  if (!anchor) return {};
  const { width, height } = bubbleSize.value;
  const { side, left, top } = placement.value;
  if (side === "above" || side === "below") {
    const offset = Math.min(Math.max(anchor.x + anchor.width / 2 - left, 16), Math.max(16, width - 16));
    return { left: `${offset}px` };
  }
  const offset = Math.min(Math.max(anchor.y + anchor.height / 2 - top, 14), Math.max(14, height - 14));
  return { top: `${offset}px` };
});

function measure(): void {
  const el = bubbleEl.value;
  if (!el) return;
  bubbleSize.value = { width: el.offsetWidth, height: el.offsetHeight };
}

watch(bubbleEl, (el, previous) => {
  if (previous && resizeObserver) resizeObserver.unobserve(previous);
  if (!el) {
    bubbleSize.value = { width: 0, height: 0 };
    return;
  }
  const Observer = (el.ownerDocument.defaultView as (Window & typeof globalThis) | null)?.ResizeObserver;
  if (Observer && !resizeObserver) resizeObserver = new Observer(() => measure());
  resizeObserver?.observe(el);
  measure();
}, { flush: "post" });

watch(() => [props.slide?.key, bodyText.value, heading.value], () => {
  void nextTick(measure);
}, { flush: "post" });

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<style scoped>
.acu-notice-bubble {
  --bubble-bg: #fffaf0;
  --bubble-text: #3d3122;
  --bubble-muted: #7a6a52;
  --bubble-border: #e9cf8a;
  --bubble-tone: #d4a93a;
  position: fixed;
  z-index: 9410;
  box-sizing: border-box;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: max-content;
  min-width: 200px;
  max-width: min(400px, calc(100vw - 16px));
  padding: 10px 12px 10px 14px;
  border: 1px solid var(--bubble-border);
  border-radius: 12px;
  background: var(--bubble-bg);
  color: var(--bubble-text);
  box-shadow: 0 10px 28px rgba(70, 50, 10, 0.18), 0 2px 6px rgba(70, 50, 10, 0.12);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 12px;
  line-height: 1.5;
  pointer-events: auto;
  animation: acu-notice-bubble-in 0.18s ease-out both;
}

.acu-notice-bubble *,
.acu-notice-bubble *::before,
.acu-notice-bubble *::after {
  box-sizing: border-box;
}

.acu-notice-bubble.is-anchored {
  top: 0;
  left: 0;
}

.acu-notice-bubble.is-measuring {
  visibility: hidden;
}

.acu-notice-bubble.is-docked {
  top: calc(62px + env(safe-area-inset-top, 0px));
  right: calc(18px + env(safe-area-inset-right, 0px));
  max-width: min(360px, calc(100vw - 36px));
}

.acu-notice-bubble--success {
  --bubble-tone: #6f9a4d;
}

.acu-notice-bubble--warning {
  --bubble-tone: #d08a2c;
}

.acu-notice-bubble--error {
  --bubble-tone: #c2503a;
}

.acu-notice-bubble--joke {
  --bubble-tone: #e6b93c;
  --bubble-bg: #fff6d8;
}

.acu-notice-bubble__body {
  flex: 1 1 auto;
  min-width: 0;
}

.acu-notice-bubble__heading {
  margin: 0 0 2px;
  color: var(--bubble-tone);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.2px;
}

.acu-notice-bubble--joke .acu-notice-bubble__heading {
  color: #a47a12;
}

.acu-notice-bubble__text {
  margin: 0;
  color: var(--bubble-text);
  white-space: pre-line;
  overflow-wrap: anywhere;
}

.acu-notice-bubble__body.is-expandable {
  cursor: pointer;
}

.acu-notice-bubble__body.is-expandable:focus-visible {
  outline: 2px solid var(--bubble-tone);
  outline-offset: 2px;
  border-radius: 6px;
}

.acu-notice-bubble__detail {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed var(--bubble-border);
  max-height: 160px;
  overflow-y: auto;
}

.acu-notice-bubble__detail-title {
  margin: 0 0 2px;
  color: var(--bubble-muted);
  font-size: 11px;
  font-weight: 700;
}

.acu-notice-bubble__detail-text {
  margin: 0;
  color: var(--bubble-text);
  white-space: pre-line;
  overflow-wrap: anywhere;
}

.acu-notice-bubble__tools {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
}

.acu-notice-bubble__action {
  appearance: none;
  padding: 3px 9px;
  border: 1px solid var(--bubble-tone);
  border-radius: 999px;
  background: transparent;
  color: var(--bubble-text);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.acu-notice-bubble__action.is-danger {
  border-color: #c2503a;
  color: #a33d29;
}

.acu-notice-bubble__action:hover:not(:disabled) {
  background: var(--bubble-tone);
  color: #fffaf0;
}

.acu-notice-bubble__action.is-danger:hover:not(:disabled) {
  background: #c2503a;
}

.acu-notice-bubble__action:disabled {
  opacity: 0.55;
  cursor: default;
}

.acu-notice-bubble__close {
  appearance: none;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--bubble-muted);
  font-size: 15px;
  line-height: 20px;
  cursor: pointer;
}

.acu-notice-bubble__close:hover {
  background: rgba(120, 90, 30, 0.12);
  color: var(--bubble-text);
}

.acu-notice-bubble__tail {
  position: absolute;
  width: 12px;
  height: 12px;
  background: var(--bubble-bg);
  border: 1px solid var(--bubble-border);
  transform: rotate(45deg);
}

.acu-notice-bubble.is-above .acu-notice-bubble__tail {
  bottom: -7px;
  margin-left: -6px;
  border-top: 0;
  border-left: 0;
}

.acu-notice-bubble.is-below .acu-notice-bubble__tail {
  top: -7px;
  margin-left: -6px;
  border-right: 0;
  border-bottom: 0;
}

.acu-notice-bubble.is-left .acu-notice-bubble__tail {
  right: -7px;
  margin-top: -6px;
  border-bottom: 0;
  border-left: 0;
}

.acu-notice-bubble.is-right .acu-notice-bubble__tail {
  left: -7px;
  margin-top: -6px;
  border-top: 0;
  border-right: 0;
}

@keyframes acu-notice-bubble-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@media (max-width: 640px) {
  .acu-notice-bubble.is-docked {
    top: calc(58px + env(safe-area-inset-top, 0px));
    right: auto;
    left: 50%;
    width: min(88vw, 360px);
    max-width: calc(100vw - 24px);
    transform: translateX(-50%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .acu-notice-bubble {
    animation: none;
  }
}
</style>
