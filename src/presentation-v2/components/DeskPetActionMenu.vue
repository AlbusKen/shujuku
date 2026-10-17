<template>
  <div
    ref="menuEl"
    class="acu-desk-pet-menu"
    :class="`is-side-${side}`"
    role="menu"
    aria-label="桌宠动作菜单"
    :style="menuStyle"
  >
    <div class="acu-desk-pet-menu__panel" :style="paletteStyle">
      <div v-if="confirm" class="acu-desk-pet-menu__confirm" role="group" :aria-label="confirm.title">
        <p class="acu-desk-pet-menu__confirm-title">{{ confirm.title }}</p>
        <p class="acu-desk-pet-menu__confirm-text">{{ confirm.message }}</p>
        <div class="acu-desk-pet-menu__confirm-actions">
          <button type="button" class="acu-desk-pet-menu__button" @click="cancelCatchUp">
            {{ confirm.cancelLabel || "取消" }}
          </button>
          <button
            type="button"
            class="acu-desk-pet-menu__button is-danger"
            @click="confirmCatchUp"
          >
            {{ confirm.confirmLabel || "开始追平" }}
          </button>
        </div>
      </div>

      <template v-else>
        <div class="acu-desk-pet-menu__section">
          <p class="acu-desk-pet-menu__section-title">跳转</p>
          <button
            ref="firstActionEl"
            type="button"
            class="acu-desk-pet-menu__action"
            role="menuitem"
            title="打开数据库仪表盘"
            @click="openDashboard"
          >
            <svg class="acu-desk-pet-menu__icon" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="2.2" y="2.2" width="4.6" height="4.6" rx="1.2" />
              <rect x="9.2" y="2.2" width="4.6" height="4.6" rx="1.2" />
              <rect x="2.2" y="9.2" width="4.6" height="4.6" rx="1.2" />
              <rect x="9.2" y="9.2" width="4.6" height="4.6" rx="1.2" />
            </svg>
            <span class="acu-desk-pet-menu__label">打开仪表盘</span>
          </button>
          <button
            type="button"
            class="acu-desk-pet-menu__action"
            role="menuitem"
            title="打开高级工具页的运行日志"
            @click="emit('open-logs')"
          >
            <svg class="acu-desk-pet-menu__icon" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 3.2h10M3 8h10M3 12.8h6.4" />
            </svg>
            <span class="acu-desk-pet-menu__label">打开日志</span>
            <span class="acu-desk-pet-menu__hint">运行日志</span>
          </button>
          <button
            type="button"
            class="acu-desk-pet-menu__action"
            role="menuitem"
            title="打开数据库原生可视化表格编辑器"
            @click="emit('open-visualizer')"
          >
            <svg class="acu-desk-pet-menu__icon" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="2.2" y="2.4" width="11.6" height="11.2" rx="1.6" />
              <path d="M2.2 6.4h11.6M2.2 10.2h11.6M6.2 6.4v7.2" />
            </svg>
            <span class="acu-desk-pet-menu__label">打开表格编辑器</span>
          </button>
        </div>

        <div class="acu-desk-pet-menu__section">
          <p class="acu-desk-pet-menu__section-title">功能</p>
          <button
            type="button"
            class="acu-desk-pet-menu__action"
            role="menuitem"
            :disabled="busy"
            title="补齐还没填的楼层，不会改动已经填好的内容"
            @click="emit('catch-up')"
          >
            <svg class="acu-desk-pet-menu__icon" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8.6 2.2 4 8.6h3.4L7 13.8l4.8-6.6H8.4l.2-5z" />
            </svg>
            <span class="acu-desk-pet-menu__label">{{ busy ? "正在追平…" : "一键追平" }}</span>
          </button>
          <button
            type="button"
            class="acu-desk-pet-menu__action"
            role="menuitem"
            :aria-expanded="detectOpen"
            title="检测当前使用的表格模板、填表 API、剧情推进预设与剧情推进 API"
            @click="toggleDetect"
          >
            <svg class="acu-desk-pet-menu__icon" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.1" />
              <path d="M10.2 10.2 13.4 13.4" />
            </svg>
            <span class="acu-desk-pet-menu__label">检测当前配置</span>
            <span class="acu-desk-pet-menu__hint">{{ detectOpen ? "收起" : "查看" }}</span>
          </button>
          <div v-if="detectOpen" class="acu-desk-pet-menu__detect" role="group" aria-label="当前配置检测结果">
            <div v-for="row in configRows" :key="row.label" class="acu-desk-pet-menu__detect-row">
              <span class="acu-desk-pet-menu__detect-label">{{ row.label }}</span>
              <span class="acu-desk-pet-menu__detect-value" :title="row.value">{{ row.value }}</span>
            </div>
          </div>
        </div>
      </template>

      <button
        type="button"
        class="acu-desk-pet-menu__close"
        role="menuitem"
        title="关闭动作菜单"
        aria-label="关闭动作菜单"
        @click="close(true)"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { NoticeBubbleAppearance_ACU } from "../../shared/desk-pet-appearance";
import type { DeskPetRect } from "../composables/useTaskActivity";
import type { DeskPetMenuConfigRow, DeskPetMenuConfirm } from "./desk-pet-action-menu";

const props = withDefaults(defineProps<{
  anchor: DeskPetRect;
  viewportWidth: number;
  viewportHeight: number;
  autoFocus?: boolean;
  /** 追平执行中：禁用重复触发。 */
  busy?: boolean;
  /** 非空时整块菜单切换为二次确认卡片。 */
  confirm?: DeskPetMenuConfirm | null;
  /** 当前配置检测结果（实时读取，展开时展示）。 */
  configRows?: DeskPetMenuConfigRow[];
  /** 与气泡共用同一套外观配色，避免自定义主题下两块 UI 割裂。 */
  colors?: NoticeBubbleAppearance_ACU["colors"];
}>(), {
  autoFocus: false,
  busy: false,
  confirm: null,
  configRows: () => [],
  colors: undefined,
});

const emit = defineEmits<{
  (event: "close", restoreFocus: boolean): void;
  (event: "open-dashboard"): void;
  (event: "open-logs"): void;
  (event: "open-visualizer"): void;
  (event: "catch-up"): void;
  (event: "detect"): void;
  (event: "confirm-catch-up"): void;
  (event: "cancel-catch-up"): void;
}>();

const MENU_WIDTH_PX = 236;
const NARROW_MENU_WIDTH_PX = 248;
const MENU_MAX_HEIGHT_PX = 420;
const VIEWPORT_MARGIN_PX = 8;
const ANCHOR_GAP_PX = 10;
const NARROW_VIEWPORT_PX = 640;

type MenuSide = "right" | "left" | "below" | "above";

const menuEl = ref<HTMLElement | null>(null);
const firstActionEl = ref<HTMLButtonElement | null>(null);
const menuSize = ref({ width: 0, height: 0 });
const detectOpen = ref(false);
let ownerDocument: Document | null = null;
let resizeObserver: ResizeObserver | null = null;

const isNarrow = computed(() => props.viewportWidth > 0 && props.viewportWidth < NARROW_VIEWPORT_PX);

const menuWidth = computed(() => {
  const vw = props.viewportWidth;
  const preferred = isNarrow.value ? NARROW_MENU_WIDTH_PX : MENU_WIDTH_PX;
  // 视口尚未测量时先用设计宽度；极端窄屏也不小于 60px，避免负宽度。
  if (vw <= 0) return preferred;
  return Math.max(60, Math.min(preferred, vw - VIEWPORT_MARGIN_PX * 2));
});

const menuMaxHeight = computed(() => {
  const vh = props.viewportHeight;
  if (vh <= 0) return MENU_MAX_HEIGHT_PX;
  return Math.max(160, Math.min(MENU_MAX_HEIGHT_PX, vh - VIEWPORT_MARGIN_PX * 2));
});

/** 已测高度优先；未测量时给一个保守估计，避免首帧跳到屏幕外。 */
const measuredHeight = computed(() => (menuSize.value.height > 0 ? menuSize.value.height : 240));

/** 朝屏幕中间展开：优先左右，其次上下；都不够时选空间最大的一侧。 */
const side = computed<MenuSide>(() => {
  const { x, y, width, height } = props.anchor;
  const vw = props.viewportWidth;
  const vh = props.viewportHeight;
  if (vw <= 0 || vh <= 0) return "right";
  const needW = menuWidth.value + ANCHOR_GAP_PX + VIEWPORT_MARGIN_PX;
  const needH = Math.min(measuredHeight.value, menuMaxHeight.value) + ANCHOR_GAP_PX + VIEWPORT_MARGIN_PX;
  const spaces: Array<[MenuSide, number]> = [
    ["right", vw - (x + width)],
    ["left", x],
    ["below", vh - (y + height)],
    ["above", y],
  ];
  const required = (candidate: MenuSide): number =>
    candidate === "right" || candidate === "left" ? needW : needH;
  const fitting = spaces.find(([candidate, space]) => space >= required(candidate));
  if (fitting) return fitting[0];
  return [...spaces].sort((a, b) => b[1] - a[1])[0][0];
});

const menuPosition = computed(() => {
  const { x, y, width, height } = props.anchor;
  const vw = props.viewportWidth;
  const vh = props.viewportHeight;
  const size = { width: menuWidth.value, height: Math.min(measuredHeight.value, menuMaxHeight.value) };
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const clampX = (value: number) => Math.min(
    Math.max(VIEWPORT_MARGIN_PX, value),
    Math.max(VIEWPORT_MARGIN_PX, vw - size.width - VIEWPORT_MARGIN_PX),
  );
  const clampY = (value: number) => Math.min(
    Math.max(VIEWPORT_MARGIN_PX, value),
    Math.max(VIEWPORT_MARGIN_PX, vh - size.height - VIEWPORT_MARGIN_PX),
  );
  switch (side.value) {
    case "right":
      return { x: x + width + ANCHOR_GAP_PX, y: clampY(centerY - size.height / 2) };
    case "left":
      return { x: x - ANCHOR_GAP_PX - size.width, y: clampY(centerY - size.height / 2) };
    case "below":
      return { x: clampX(centerX - size.width / 2), y: clampY(y + height + ANCHOR_GAP_PX) };
    default:
      return { x: clampX(centerX - size.width / 2), y: clampY(y - ANCHOR_GAP_PX - size.height) };
  }
});

const menuStyle = computed(() => ({
  width: `${menuWidth.value}px`,
  maxHeight: `${menuMaxHeight.value}px`,
  transform: `translate3d(${Math.round(menuPosition.value.x)}px, ${Math.round(menuPosition.value.y)}px, 0)`,
}));

/** 颜色沿用气泡外观设置；设置缺省时回落到与气泡一致的奶油金配色。 */
const paletteStyle = computed(() => {
  const colors = props.colors;
  return {
    "--dpm-bg": colors?.background || "#fffaf0",
    "--dpm-text": colors?.text || "#3d3122",
    "--dpm-muted": colors?.muted || "#7a6a52",
    "--dpm-border": colors?.border || "#e9cf8a",
    "--dpm-accent": colors?.info || "#d4a93a",
    "--dpm-danger": colors?.danger || "#c2503a",
    "--dpm-danger-text": colors?.dangerText || "#a33d29",
  };
});

function close(restoreFocus = false): void {
  emit("close", restoreFocus);
}

function openDashboard(): void {
  close();
  emit("open-dashboard");
}

function toggleDetect(): void {
  detectOpen.value = !detectOpen.value;
  if (detectOpen.value) emit("detect");
}

function cancelCatchUp(): void {
  emit("cancel-catch-up");
}

function confirmCatchUp(): void {
  emit("confirm-catch-up");
}

function measure(): void {
  const el = menuEl.value;
  if (!el) return;
  const height = el.offsetHeight;
  if (height > 0) menuSize.value = { width: el.offsetWidth, height };
}

function isInsideMenu(target: EventTarget | null): boolean {
  return !!target && !!menuEl.value?.contains(target as Node);
}

function onDocumentPointerDown(event: Event): void {
  if (!isInsideMenu(event.target)) close();
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    if (isInsideMenu(event.target)) {
      event.preventDefault();
      event.stopPropagation();
    }
    close(true);
    return;
  }
  if (!isInsideMenu(event.target)) return;
  const items = Array.from(menuEl.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
  if (!items.length) return;
  const index = items.indexOf(ownerDocument?.activeElement as HTMLButtonElement);
  let next: number;
  if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (index + 1) % items.length;
  else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (index - 1 + items.length) % items.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = items.length - 1;
  else return;
  event.preventDefault();
  items[next].focus();
}

async function focusAction(): Promise<void> {
  await nextTick();
  (firstActionEl.value
    ?? menuEl.value?.querySelector<HTMLButtonElement>(".acu-desk-pet-menu__action"))?.focus();
}

defineExpose({ focusAction });

watch(() => props.autoFocus, enabled => {
  if (enabled) void focusAction();
});

onMounted(() => {
  ownerDocument = menuEl.value?.ownerDocument ?? null;
  ownerDocument?.addEventListener("pointerdown", onDocumentPointerDown, true);
  ownerDocument?.addEventListener("keydown", onDocumentKeydown, true);
  const Observer = ownerDocument?.defaultView?.ResizeObserver;
  if (Observer && menuEl.value) {
    resizeObserver = new Observer(() => measure());
    resizeObserver.observe(menuEl.value);
  }
  void nextTick().then(measure);
  if (props.autoFocus) void focusAction();
});

onBeforeUnmount(() => {
  ownerDocument?.removeEventListener("pointerdown", onDocumentPointerDown, true);
  ownerDocument?.removeEventListener("keydown", onDocumentKeydown, true);
  resizeObserver?.disconnect();
  resizeObserver = null;
  ownerDocument = null;
});
</script>

<style scoped>
.acu-desk-pet-menu {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 9412;
  box-sizing: border-box;
  pointer-events: auto;
  font-family: inherit;
}

.acu-desk-pet-menu__panel {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  max-height: inherit;
  padding: 7px;
  overflow: hidden auto;
  border: 1px solid var(--dpm-border);
  border-radius: 16px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--dpm-bg) 82%, #fff) 0%, var(--dpm-bg) 58%);
  color: var(--dpm-text);
  box-shadow:
    0 16px 36px rgba(70, 50, 10, 0.2),
    0 3px 9px rgba(70, 50, 10, 0.14),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
  font-size: 12.5px;
  line-height: 1.4;
  animation: acu-desk-pet-menu-in 0.14s ease-out both;
  scrollbar-width: thin;
}

.acu-desk-pet-menu.is-side-right .acu-desk-pet-menu__panel {
  transform-origin: left center;
}

.acu-desk-pet-menu.is-side-left .acu-desk-pet-menu__panel {
  transform-origin: right center;
}

.acu-desk-pet-menu.is-side-below .acu-desk-pet-menu__panel {
  transform-origin: center top;
}

.acu-desk-pet-menu.is-side-above .acu-desk-pet-menu__panel {
  transform-origin: center bottom;
}

.acu-desk-pet-menu__panel *,
.acu-desk-pet-menu__panel *::before,
.acu-desk-pet-menu__panel *::after {
  box-sizing: border-box;
}

.acu-desk-pet-menu__section {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.acu-desk-pet-menu__section + .acu-desk-pet-menu__section {
  margin-top: 5px;
  padding-top: 6px;
  border-top: 1px solid color-mix(in srgb, var(--dpm-border) 55%, transparent);
}

.acu-desk-pet-menu__section-title {
  margin: 0;
  padding: 1px 30px 4px 8px;
  color: var(--dpm-muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
}

.acu-desk-pet-menu__action {
  appearance: none;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 32px;
  padding: 6px 8px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.acu-desk-pet-menu__action:hover {
  background: color-mix(in srgb, var(--dpm-accent) 13%, transparent);
}

.acu-desk-pet-menu__action:active {
  background: color-mix(in srgb, var(--dpm-accent) 20%, transparent);
}

.acu-desk-pet-menu__action:focus-visible {
  outline: 2px solid var(--dpm-accent);
  outline-offset: -2px;
}

.acu-desk-pet-menu__action:disabled {
  opacity: 0.55;
  cursor: default;
}

.acu-desk-pet-menu__action:disabled:hover {
  background: transparent;
}

.acu-desk-pet-menu__icon {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  fill: none;
  stroke: var(--dpm-accent);
  stroke-width: 1.35;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.acu-desk-pet-menu__label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.acu-desk-pet-menu__hint {
  flex: 0 0 auto;
  color: var(--dpm-muted);
  font-size: 10.5px;
}

.acu-desk-pet-menu__detect {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 2px 0 1px;
  padding: 7px 8px;
  border: 1px dashed color-mix(in srgb, var(--dpm-border) 70%, transparent);
  border-radius: 9px;
  background: color-mix(in srgb, var(--dpm-accent) 6%, transparent);
}

.acu-desk-pet-menu__detect-row {
  display: flex;
  align-items: baseline;
  gap: 7px;
  min-width: 0;
}

.acu-desk-pet-menu__detect-label {
  flex: 0 0 auto;
  width: 58px;
  color: var(--dpm-muted);
  font-size: 10.5px;
  letter-spacing: 0.02em;
}

.acu-desk-pet-menu__detect-value {
  flex: 1 1 auto;
  min-width: 0;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
  font-size: 11.5px;
  font-weight: 600;
}

.acu-desk-pet-menu__close {
  appearance: none;
  position: absolute;
  top: 5px;
  right: 5px;
  width: 22px;
  height: 22px;
  padding: 4px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dpm-muted);
  cursor: pointer;
}

.acu-desk-pet-menu__close svg {
  display: block;
  width: 100%;
  height: 100%;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
}

.acu-desk-pet-menu__close:hover,
.acu-desk-pet-menu__close:focus-visible {
  background: color-mix(in srgb, var(--dpm-accent) 15%, transparent);
  color: var(--dpm-text);
  outline: none;
}

.acu-desk-pet-menu__confirm {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 4px 3px 2px;
}

.acu-desk-pet-menu__confirm-title {
  margin: 0;
  padding-right: 24px;
  font-size: 12.5px;
  font-weight: 700;
}

.acu-desk-pet-menu__confirm-text {
  margin: 0;
  max-height: 34vh;
  overflow: auto;
  color: var(--dpm-muted);
  font-size: 11.5px;
  line-height: 1.55;
  white-space: pre-line;
  overflow-wrap: anywhere;
}

.acu-desk-pet-menu__confirm-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-top: 2px;
}

.acu-desk-pet-menu__button {
  appearance: none;
  flex: 0 0 auto;
  min-height: 28px;
  padding: 0 12px;
  border: 1px solid color-mix(in srgb, var(--dpm-border) 90%, transparent);
  border-radius: 999px;
  background: transparent;
  color: var(--dpm-text);
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.acu-desk-pet-menu__button:hover {
  background: color-mix(in srgb, var(--dpm-accent) 12%, transparent);
}

.acu-desk-pet-menu__button:focus-visible {
  outline: 2px solid var(--dpm-accent);
  outline-offset: 1px;
}

.acu-desk-pet-menu__button.is-danger {
  border-color: var(--dpm-danger);
  color: var(--dpm-danger-text);
}

.acu-desk-pet-menu__button.is-danger:hover {
  background: var(--dpm-danger);
  color: var(--dpm-bg);
}

@keyframes acu-desk-pet-menu-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@media (max-width: 640px) {
  .acu-desk-pet-menu__panel {
    padding: 6px;
    font-size: 13px;
  }

  .acu-desk-pet-menu__action {
    min-height: 36px;
    padding: 7px 9px;
  }

  .acu-desk-pet-menu__section-title {
    font-size: 10.5px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .acu-desk-pet-menu__panel {
    animation: none;
  }

  .acu-desk-pet-menu__action,
  .acu-desk-pet-menu__close,
  .acu-desk-pet-menu__button {
    transition: none;
  }
}
</style>
