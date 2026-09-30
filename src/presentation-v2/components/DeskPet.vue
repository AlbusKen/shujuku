<template>
  <div
    ref="petEl"
    class="acu-desk-pet"
    :class="{ 'is-busy': busy, 'is-dragging': dragging }"
    :style="petStyle"
    role="img"
    :aria-label="busy ? '桌宠：干活中' : '桌宠：发呆中'"
    :title="busy ? '干活中…（可拖动）' : '发呆中（可拖动）'"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <img class="acu-desk-pet__img" :src="busy ? workingImage : idleImage" alt="" draggable="false" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import idleImage from "../assets/desk-pet/idle.png";
import workingImage from "../assets/desk-pet/working.png";
import { acuCancelAnimationFrame, acuRequestAnimationFrame, type AcuTimerHandle } from "../bootstrap/host-env";
import { getAcuHostWindow } from "../bootstrap/host-document";
import { readDeskPetPositionRatio, saveDeskPetPositionRatio, type DeskPetRect } from "../composables/useTaskActivity";

const props = defineProps<{
  busy: boolean;
  /** 设置版本：设置被加载或修改后重读已保存位置。 */
  settingsVersion: number;
}>();

const emit = defineEmits<{ (event: "rect", rect: DeskPetRect): void }>();

const DRAG_THRESHOLD_PX = 6;
const EDGE_MARGIN_PX = 8;
const NARROW_VIEWPORT_PX = 640;
/** 默认位置离底边的距离，避开宿主底部输入栏。 */
const DEFAULT_BOTTOM_GAP_PX = 120;

const petEl = ref<HTMLElement | null>(null);
const viewport = ref(readViewport());
const left = ref(0);
const top = ref(0);
const dragging = ref(false);

let pointerId: number | null = null;
let dragStart = { x: 0, y: 0, left: 0, top: 0 };
let pendingPosition: { left: number; top: number } | null = null;
let frameHandle: AcuTimerHandle | undefined;

const size = computed(() => (viewport.value.width <= NARROW_VIEWPORT_PX ? 64 : 88));

const petStyle = computed(() => ({
  width: `${size.value}px`,
  height: `${size.value}px`,
  transform: `translate3d(${left.value}px, ${top.value}px, 0)`,
}));

function readViewport(): { width: number; height: number } {
  const win = getAcuHostWindow();
  return {
    width: win.innerWidth || win.document?.documentElement?.clientWidth || 0,
    height: win.innerHeight || win.document?.documentElement?.clientHeight || 0,
  };
}

function clampPosition(nextLeft: number, nextTop: number): { left: number; top: number } {
  const maxLeft = Math.max(EDGE_MARGIN_PX, viewport.value.width - size.value - EDGE_MARGIN_PX);
  const maxTop = Math.max(EDGE_MARGIN_PX, viewport.value.height - size.value - EDGE_MARGIN_PX);
  return {
    left: Math.min(Math.max(EDGE_MARGIN_PX, nextLeft), maxLeft),
    top: Math.min(Math.max(EDGE_MARGIN_PX, nextTop), maxTop),
  };
}

function usableSpan(total: number): number {
  return Math.max(1, total - size.value - EDGE_MARGIN_PX * 2);
}

/** 按已保存比例（或默认右下角）落位，并夹进当前视口。 */
function applySavedPosition(): void {
  const ratio = readDeskPetPositionRatio();
  const next = ratio
    ? clampPosition(
        EDGE_MARGIN_PX + ratio.x * usableSpan(viewport.value.width),
        EDGE_MARGIN_PX + ratio.y * usableSpan(viewport.value.height),
      )
    : clampPosition(
        viewport.value.width - size.value - 16,
        viewport.value.height - size.value - DEFAULT_BOTTOM_GAP_PX,
      );
  left.value = next.left;
  top.value = next.top;
  emitRect();
}

function persistPosition(): void {
  saveDeskPetPositionRatio({
    x: (left.value - EDGE_MARGIN_PX) / usableSpan(viewport.value.width),
    y: (top.value - EDGE_MARGIN_PX) / usableSpan(viewport.value.height),
  });
}

function emitRect(): void {
  emit("rect", { x: left.value, y: top.value, width: size.value, height: size.value });
}

function flushPendingPosition(): void {
  frameHandle = undefined;
  if (!pendingPosition) return;
  left.value = pendingPosition.left;
  top.value = pendingPosition.top;
  pendingPosition = null;
  emitRect();
}

function onPointerDown(event: PointerEvent): void {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  pointerId = event.pointerId;
  dragStart = { x: event.clientX, y: event.clientY, left: left.value, top: top.value };
  dragging.value = false;
  try {
    petEl.value?.setPointerCapture(event.pointerId);
  } catch {
    // 部分 WebView 不支持指针捕获；仍可在元素范围内拖动。
  }
}

function onPointerMove(event: PointerEvent): void {
  if (pointerId !== event.pointerId) return;
  const dx = event.clientX - dragStart.x;
  const dy = event.clientY - dragStart.y;
  if (!dragging.value && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
  dragging.value = true;
  event.preventDefault();
  pendingPosition = clampPosition(dragStart.left + dx, dragStart.top + dy);
  if (frameHandle === undefined) frameHandle = acuRequestAnimationFrame(flushPendingPosition);
}

function onPointerUp(event: PointerEvent): void {
  if (pointerId !== event.pointerId) return;
  pointerId = null;
  try {
    petEl.value?.releasePointerCapture(event.pointerId);
  } catch {
    // 捕获已随指针结束自动释放。
  }
  if (!dragging.value) return;
  if (frameHandle !== undefined) {
    acuCancelAnimationFrame(frameHandle);
    frameHandle = undefined;
  }
  flushPendingPosition();
  dragging.value = false;
  persistPosition();
}

function onResize(): void {
  viewport.value = readViewport();
  if (!dragging.value) applySavedPosition();
}

watch(() => props.settingsVersion, () => {
  if (!dragging.value) applySavedPosition();
});

onMounted(() => {
  viewport.value = readViewport();
  applySavedPosition();
  getAcuHostWindow().addEventListener("resize", onResize);
});

onBeforeUnmount(() => {
  getAcuHostWindow().removeEventListener("resize", onResize);
  if (frameHandle !== undefined) acuCancelAnimationFrame(frameHandle);
});
</script>

<style scoped>
.acu-desk-pet {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 9410;
  display: block;
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  pointer-events: auto;
  will-change: transform;
}

.acu-desk-pet.is-dragging {
  cursor: grabbing;
}

.acu-desk-pet__img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
  filter: drop-shadow(0 4px 6px rgba(60, 40, 0, 0.28));
  transform-origin: 50% 100%;
  animation: acu-desk-pet-breathe 3.6s ease-in-out infinite;
}

.acu-desk-pet.is-busy .acu-desk-pet__img {
  animation: acu-desk-pet-sway 1.4s ease-in-out infinite;
}

.acu-desk-pet.is-dragging .acu-desk-pet__img {
  animation: none;
  transform: scale(1.06);
}

@keyframes acu-desk-pet-breathe {
  0%,
  100% {
    transform: scale(1, 1);
  }
  50% {
    transform: scale(1.015, 0.975);
  }
}

@keyframes acu-desk-pet-sway {
  0%,
  100% {
    transform: rotate(-3deg) translateY(0);
  }
  50% {
    transform: rotate(3deg) translateY(-2px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .acu-desk-pet__img,
  .acu-desk-pet.is-busy .acu-desk-pet__img {
    animation: none;
  }
}
</style>
