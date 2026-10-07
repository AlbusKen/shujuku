<template>
  <div
    v-if="slide"
    ref="bubbleEl"
    class="acu-notice-bubble"
    :class="[
      `acu-notice-bubble--${tone}`,
      anchor ? `is-anchored is-${placement.side}` : ['is-docked', ...dockClasses],
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
import type { NoticeBubbleAppearance_ACU, NoticeBubbleSide_ACU } from "../../shared/desk-pet-appearance";
import type { NoticeAction_ACU } from "../../shared/notice-hub";
import type { NoticeSlide } from "../composables/useNoticeCarousel";
import type { ActivityTask, DeskPetRect } from "../composables/useTaskActivity";

const props = defineProps<{
  slide: NoticeSlide | null;
  task: ActivityTask | null;
  /** 外观设置的生效值：配色、字号、尺寸与摆放。 */
  appearance: NoticeBubbleAppearance_ACU;
  /** 桌宠位置；为 null 时气泡停靠在设置的屏幕角落。 */
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

/** 错误始终显示真实内容，不受桌宠工作内容开关影响。 */
const showRealContent = computed(() => props.showRealWork || tone.value === "error");

const heading = computed(() => {
  const current = props.slide;
  if (!current) return "";
  if (current.type === "joke") return current.heading;
  if (showRealContent.value) {
    return current.type === "notice" ? current.notice.title : props.task?.feature || "";
  }
  return "";
});

/** 真实内容沿用现有通知/进度；非错误提示默认显示桌宠状态词。 */
const bodyText = computed(() => {
  const current = props.slide;
  if (!current) return "";
  if (current.type === "joke") return current.text;
  if (showRealContent.value) {
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

/** 使用桌宠状态词的通知片与任务片可点开查看真实内容。 */
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
const expandable = computed(() => !showRealContent.value && props.slide?.type !== "joke" && !!(detailText.value || detailTitle.value));

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

/**
 * 贴桌宠摆放：按设置的方位顺序（缺省上 → 下 → 左 → 右）取第一个放得下的；
 * 都放不下时用最后一个方位并夹进视口。
 */
const placement = computed(() => {
  const anchor = props.anchor;
  const { width, height } = bubbleSize.value;
  const vw = props.viewportWidth;
  const vh = props.viewportHeight;
  const { gap, sides } = props.appearance.anchor;
  const clampX = (x: number) => Math.min(Math.max(VIEWPORT_MARGIN_PX, x), Math.max(VIEWPORT_MARGIN_PX, vw - width - VIEWPORT_MARGIN_PX));
  const clampY = (y: number) => Math.min(Math.max(VIEWPORT_MARGIN_PX, y), Math.max(VIEWPORT_MARGIN_PX, vh - height - VIEWPORT_MARGIN_PX));
  if (!anchor) return { side: "above" as NoticeBubbleSide_ACU, left: 0, top: 0 };
  const centerX = anchor.x + anchor.width / 2;
  const centerY = anchor.y + anchor.height / 2;
  const spots: Record<NoticeBubbleSide_ACU, () => { fits: boolean; left: number; top: number }> = {
    above: () => {
      const top = anchor.y - height - gap;
      return { fits: top >= VIEWPORT_MARGIN_PX, left: clampX(centerX - width / 2), top };
    },
    below: () => {
      const top = anchor.y + anchor.height + gap;
      return { fits: top + height <= vh - VIEWPORT_MARGIN_PX, left: clampX(centerX - width / 2), top };
    },
    left: () => {
      const left = anchor.x - width - gap;
      return { fits: left >= VIEWPORT_MARGIN_PX, left, top: clampY(centerY - height / 2) };
    },
    right: () => {
      const left = anchor.x + anchor.width + gap;
      return { fits: left + width <= vw - VIEWPORT_MARGIN_PX, left: clampX(left), top: clampY(centerY - height / 2) };
    },
  };
  for (const side of sides) {
    const spot = spots[side]();
    if (spot.fits) return { side, left: spot.left, top: spot.top };
  }
  const fallback = sides[sides.length - 1] ?? "right";
  const spot = spots[fallback]();
  return { side: fallback, left: clampX(spot.left), top: clampY(spot.top) };
});

/** 外观设置经 CSS 变量下发，scoped 样式据此取色、取尺寸与停靠边距。 */
const appearanceVars = computed(() => {
  const { colors, size, dock, fontSize, fontFamily, borderRadius } = props.appearance;
  return {
    "--acu-nb-bg": colors.background,
    "--acu-nb-text": colors.text,
    "--acu-nb-muted": colors.muted,
    "--acu-nb-border": colors.border,
    "--acu-nb-info": colors.info,
    "--acu-nb-success": colors.success,
    "--acu-nb-warning": colors.warning,
    "--acu-nb-error": colors.error,
    "--acu-nb-joke": colors.joke,
    "--acu-nb-joke-bg": colors.jokeBackground,
    "--acu-nb-joke-heading": colors.jokeHeading,
    "--acu-nb-danger": colors.danger,
    "--acu-nb-danger-text": colors.dangerText,
    "--acu-nb-font-size": `${fontSize}px`,
    "--acu-nb-font-family": fontFamily,
    "--acu-nb-radius": `${borderRadius}px`,
    "--acu-nb-min-width": `${size.minWidth}px`,
    "--acu-nb-max-width": `${size.maxWidth}px`,
    "--acu-nb-docked-max-width": `${size.dockedMaxWidth}px`,
    "--acu-nb-detail-max-height": `${size.detailMaxHeight}px`,
    "--acu-nb-dock-x": `${dock.offsetX}px`,
    "--acu-nb-dock-y": `${dock.offsetY}px`,
    "--acu-nb-dock-narrow-y": `${dock.narrowOffsetY}px`,
  };
});

const dockClasses = computed(() => {
  const [vertical, horizontal] = props.appearance.dock.corner.split("-");
  return [`is-dock-${vertical}`, `is-dock-${horizontal}`];
});

const bubbleStyle = computed(() => {
  if (!props.anchor) return appearanceVars.value;
  return {
    ...appearanceVars.value,
    transform: `translate3d(${Math.round(placement.value.left)}px, ${Math.round(placement.value.top)}px, 0)`,
  };
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
  --bubble-bg: var(--acu-nb-bg);
  --bubble-text: var(--acu-nb-text);
  --bubble-muted: var(--acu-nb-muted);
  --bubble-border: var(--acu-nb-border);
  --bubble-tone: var(--acu-nb-info);
  position: fixed;
  z-index: 9410;
  box-sizing: border-box;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: max-content;
  min-width: var(--acu-nb-min-width);
  max-width: min(var(--acu-nb-max-width), calc(100vw - 16px));
  padding: 10px 12px 10px 14px;
  border: 1px solid var(--bubble-border);
  border-radius: var(--acu-nb-radius);
  background: var(--bubble-bg);
  color: var(--bubble-text);
  box-shadow: 0 10px 28px rgba(70, 50, 10, 0.18), 0 2px 6px rgba(70, 50, 10, 0.12);
  font-family: var(--acu-nb-font-family);
  font-size: var(--acu-nb-font-size);
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
  max-width: min(var(--acu-nb-docked-max-width), calc(100vw - 2 * var(--acu-nb-dock-x)));
}

.acu-notice-bubble.is-docked.is-dock-top {
  top: calc(var(--acu-nb-dock-y) + env(safe-area-inset-top, 0px));
}

.acu-notice-bubble.is-docked.is-dock-bottom {
  bottom: calc(var(--acu-nb-dock-y) + env(safe-area-inset-bottom, 0px));
}

.acu-notice-bubble.is-docked.is-dock-right {
  right: calc(var(--acu-nb-dock-x) + env(safe-area-inset-right, 0px));
}

.acu-notice-bubble.is-docked.is-dock-left {
  left: calc(var(--acu-nb-dock-x) + env(safe-area-inset-left, 0px));
}

.acu-notice-bubble--success {
  --bubble-tone: var(--acu-nb-success);
}

.acu-notice-bubble--warning {
  --bubble-tone: var(--acu-nb-warning);
}

.acu-notice-bubble--error {
  --bubble-tone: var(--acu-nb-error);
}

.acu-notice-bubble--joke {
  --bubble-tone: var(--acu-nb-joke);
  --bubble-bg: var(--acu-nb-joke-bg);
}

.acu-notice-bubble__body {
  flex: 1 1 auto;
  min-width: 0;
}

.acu-notice-bubble__heading {
  margin: 0 0 2px;
  color: var(--bubble-tone);
  font-size: calc(var(--acu-nb-font-size) - 1px);
  font-weight: 700;
  letter-spacing: 0.2px;
}

.acu-notice-bubble--joke .acu-notice-bubble__heading {
  color: var(--acu-nb-joke-heading);
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
  max-height: var(--acu-nb-detail-max-height);
  overflow-y: auto;
}

.acu-notice-bubble__detail-title {
  margin: 0 0 2px;
  color: var(--bubble-muted);
  font-size: calc(var(--acu-nb-font-size) - 1px);
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
  font-size: calc(var(--acu-nb-font-size) - 1px);
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.acu-notice-bubble__action.is-danger {
  border-color: var(--acu-nb-danger);
  color: var(--acu-nb-danger-text);
}

.acu-notice-bubble__action:hover:not(:disabled) {
  background: var(--bubble-tone);
  color: var(--bubble-bg);
}

.acu-notice-bubble__action.is-danger:hover:not(:disabled) {
  background: var(--acu-nb-danger);
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
  font-size: calc(var(--acu-nb-font-size) + 3px);
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

/* 窄屏停靠时水平居中，只保留设置角落的上 / 下边；左右角规则须同等优先级才能被覆盖。 */
@media (max-width: 640px) {
  .acu-notice-bubble.is-docked,
  .acu-notice-bubble.is-docked.is-dock-left,
  .acu-notice-bubble.is-docked.is-dock-right {
    right: auto;
    left: 50%;
    width: min(88vw, var(--acu-nb-docked-max-width));
    max-width: calc(100vw - 24px);
    transform: translateX(-50%);
  }

  .acu-notice-bubble.is-docked.is-dock-top {
    top: calc(var(--acu-nb-dock-narrow-y) + env(safe-area-inset-top, 0px));
  }

  .acu-notice-bubble.is-docked.is-dock-bottom {
    bottom: calc(var(--acu-nb-dock-narrow-y) + env(safe-area-inset-bottom, 0px));
  }
}

@media (prefers-reduced-motion: reduce) {
  .acu-notice-bubble {
    animation: none;
  }
}
</style>
