<template>
  <div
    ref="menuEl"
    class="acu-desk-pet-menu"
    role="menu"
    aria-label="奶龙动作菜单"
    :style="menuStyle"
  >
    <button
      ref="actionEl"
      type="button"
      class="acu-desk-pet-menu__action"
      role="menuitem"
      title="打开数据库仪表盘"
      @click="openDashboard"
    >
      打开仪表盘
    </button>
    <button
      type="button"
      class="acu-desk-pet-menu__close"
      role="menuitem"
      title="关闭动作菜单"
      aria-label="关闭动作菜单"
      @click="close(true)"
    >
      ×
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { DeskPetRect } from "../composables/useTaskActivity";

const props = withDefaults(defineProps<{
  anchor: DeskPetRect;
  viewportWidth: number;
  viewportHeight: number;
  autoFocus?: boolean;
}>(), {
  autoFocus: false,
});

const emit = defineEmits<{
  (event: "close", restoreFocus: boolean): void;
  (event: "open-dashboard"): void;
}>();

const MENU_MAX_WIDTH_PX = 152;
const MENU_HEIGHT_PX = 36;
const VIEWPORT_MARGIN_PX = 8;
const ANCHOR_GAP_PX = 10;

const menuEl = ref<HTMLElement | null>(null);
const actionEl = ref<HTMLButtonElement | null>(null);
let ownerDocument: Document | null = null;

const menuSize = computed(() => ({
  width: Math.min(MENU_MAX_WIDTH_PX, Math.max(0, props.viewportWidth - VIEWPORT_MARGIN_PX * 2)),
  height: MENU_HEIGHT_PX,
}));

function clamp(value: number, maximum: number): number {
  return Math.min(Math.max(VIEWPORT_MARGIN_PX, value), Math.max(VIEWPORT_MARGIN_PX, maximum));
}

const menuPosition = computed(() => {
  const { x, y, width, height } = props.anchor;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const right = { x: x + width + ANCHOR_GAP_PX, y: centerY - MENU_HEIGHT_PX / 2 };
  const left = { x: x - ANCHOR_GAP_PX - menuSize.value.width, y: centerY - MENU_HEIGHT_PX / 2 };
  const above = { x: centerX - menuSize.value.width / 2, y: y - ANCHOR_GAP_PX - MENU_HEIGHT_PX };
  const below = { x: centerX - menuSize.value.width / 2, y: y + height + ANCHOR_GAP_PX };
  const fits = (point: { x: number; y: number }) =>
    point.x >= VIEWPORT_MARGIN_PX
    && point.y >= VIEWPORT_MARGIN_PX
    && point.x + menuSize.value.width <= props.viewportWidth - VIEWPORT_MARGIN_PX
    && point.y + MENU_HEIGHT_PX <= props.viewportHeight - VIEWPORT_MARGIN_PX;
  const candidate = [right, left, above, below].find(fits) ?? below;
  return {
    x: clamp(candidate.x, props.viewportWidth - menuSize.value.width - VIEWPORT_MARGIN_PX),
    y: clamp(candidate.y, props.viewportHeight - MENU_HEIGHT_PX - VIEWPORT_MARGIN_PX),
  };
});

const menuStyle = computed(() => ({
  width: `${menuSize.value.width}px`,
  height: `${menuSize.value.height}px`,
  transform: `translate3d(${Math.round(menuPosition.value.x)}px, ${Math.round(menuPosition.value.y)}px, 0)`,
}));

function close(restoreFocus = false): void {
  emit("close", restoreFocus);
}

function openDashboard(): void {
  close();
  emit("open-dashboard");
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
  actionEl.value?.focus();
}

defineExpose({ focusAction });
watch(() => props.autoFocus, enabled => {
  if (enabled) void focusAction();
});

onMounted(() => {
  ownerDocument = menuEl.value?.ownerDocument ?? null;
  ownerDocument?.addEventListener("pointerdown", onDocumentPointerDown, true);
  ownerDocument?.addEventListener("keydown", onDocumentKeydown, true);
  if (props.autoFocus) void focusAction();
});

onBeforeUnmount(() => {
  ownerDocument?.removeEventListener("pointerdown", onDocumentPointerDown, true);
  ownerDocument?.removeEventListener("keydown", onDocumentKeydown, true);
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
  display: flex;
  align-items: center;
  gap: 2px;
  width: 152px;
  height: 36px;
  padding: 4px 5px;
  border: 1px solid #e9cf8a;
  border-radius: 18px;
  background: #fffaf0;
  color: #3d3122;
  box-shadow: 0 8px 22px rgba(70, 50, 10, 0.18), 0 2px 6px rgba(70, 50, 10, 0.12);
  font-family: inherit;
  font-size: 12px;
  pointer-events: auto;
}

.acu-desk-pet-menu * {
  box-sizing: border-box;
}

.acu-desk-pet-menu__action {
  appearance: none;
  flex: 1 1 auto;
  min-width: 0;
  height: 26px;
  padding: 0 9px;
  border: 1px solid #d4a93a;
  border-radius: 13px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.acu-desk-pet-menu__action:hover,
.acu-desk-pet-menu__action:focus-visible {
  background: #d4a93a;
  color: #fffaf0;
  outline: none;
}

.acu-desk-pet-menu__close {
  appearance: none;
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #7a6a52;
  font: inherit;
  font-size: 15px;
  line-height: 24px;
  cursor: pointer;
}

.acu-desk-pet-menu__close:hover,
.acu-desk-pet-menu__close:focus-visible {
  background: rgba(120, 90, 30, 0.12);
  color: #3d3122;
  outline: none;
}

@media (prefers-reduced-motion: reduce) {
  .acu-desk-pet-menu,
  .acu-desk-pet-menu__action,
  .acu-desk-pet-menu__close {
    transition: none;
  }
}
</style>
