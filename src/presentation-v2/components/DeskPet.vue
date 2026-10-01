<template>
  <div
    ref="petEl"
    class="acu-desk-pet"
    :class="rootClass"
    :style="petStyle"
    role="img"
    :aria-label="ariaLabel"
    :title="titleText"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @pointerenter="onPointerEnter"
    @pointerleave="onPointerLeave"
  >
    <div v-if="showPeek" class="acu-desk-pet__peek" :class="`is-${dockEdge}`">
      <img class="acu-desk-pet__peek-img" :src="peekSrc" :style="peekImgStyle" alt="" draggable="false" />
    </div>
    <div v-else class="acu-desk-pet__body" :class="{ 'is-breathing': breathing }">
      <div class="acu-desk-pet__flip" :class="{ 'is-flipped': flipped }">
        <img class="acu-desk-pet__img" :class="`pose-${pose}`" :src="POSE_IMAGES[pose]" alt="" draggable="false" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import angryImage from "../assets/desk-pet/angry.png";
import blinkImage from "../assets/desk-pet/blink.png";
import dizzyImage from "../assets/desk-pet/dizzy.png";
import eatAImage from "../assets/desk-pet/eat-a.png";
import eatBImage from "../assets/desk-pet/eat-b.png";
import happyImage from "../assets/desk-pet/happy.png";
import huffImage from "../assets/desk-pet/huff.png";
import idleImage from "../assets/desk-pet/idle.png";
import knockdownImage from "../assets/desk-pet/knockdown.png";
import lookLeftImage from "../assets/desk-pet/look-left.png";
import lookRightImage from "../assets/desk-pet/look-right.png";
import peekImage from "../assets/desk-pet/peek.png";
import peekOriginalImage from "../assets/desk-pet/peek-original.png";
import peekSleepyImage from "../assets/desk-pet/peek-sleepy.png";
import poundImage from "../assets/desk-pet/pound.png";
import rollImage from "../assets/desk-pet/roll.png";
import shyImage from "../assets/desk-pet/shy.png";
import sitSnoreImage from "../assets/desk-pet/sit-snore.png";
import snoreImage from "../assets/desk-pet/snore.png";
import struggleImage from "../assets/desk-pet/struggle.png";
import surprisedImage from "../assets/desk-pet/surprised.png";
import tickleImage from "../assets/desk-pet/tickle.png";
import walkAImage from "../assets/desk-pet/walk-a.png";
import walkBImage from "../assets/desk-pet/walk-b.png";
import waveImage from "../assets/desk-pet/wave.png";
import workingImage from "../assets/desk-pet/working.png";
import yawnImage from "../assets/desk-pet/yawn.png";
import {
  acuCancelAnimationFrame,
  acuClearTimeout,
  acuMatchesMedia,
  acuRequestAnimationFrame,
  acuSetTimeout,
  type AcuTimerHandle,
} from "../bootstrap/host-env";
import { getAcuHostWindow } from "../bootstrap/host-document";
import {
  readDeskPetPositionRatio,
  saveDeskPetPositionRatio,
  type DeskPetDockEdge,
  type DeskPetRect,
} from "../composables/useTaskActivity";

type IdlePose = "idle" | "blink" | "look-left" | "look-right" | "walk-a" | "walk-b" | "roll" | "eat-a" | "eat-b" | "yawn";
type SnoozePose = "snore" | "sit-snore";
type ReactionPose = "shy" | "tickle" | "angry" | "happy" | "dizzy" | "surprised" | "wave" | "huff" | "pound" | "knockdown";
type Pose = IdlePose | SnoozePose | ReactionPose | "working" | "struggle";

const POSE_IMAGES: Record<Pose, string> = {
  idle: idleImage,
  blink: blinkImage,
  "look-left": lookLeftImage,
  "look-right": lookRightImage,
  "walk-a": walkAImage,
  "walk-b": walkBImage,
  roll: rollImage,
  "eat-a": eatAImage,
  "eat-b": eatBImage,
  yawn: yawnImage,
  snore: snoreImage,
  "sit-snore": sitSnoreImage,
  working: workingImage,
  struggle: struggleImage,
  shy: shyImage,
  tickle: tickleImage,
  angry: angryImage,
  happy: happyImage,
  dizzy: dizzyImage,
  surprised: surprisedImage,
  wave: waveImage,
  huff: huffImage,
  pound: poundImage,
  knockdown: knockdownImage,
};

const POSE_LABELS: Record<Pose, string> = {
  idle: "发呆中",
  blink: "发呆中",
  "look-left": "东张西望",
  "look-right": "东张西望",
  "walk-a": "散步中",
  "walk-b": "散步中",
  roll: "打滚中",
  "eat-a": "偷吃零食",
  "eat-b": "偷吃零食",
  yawn: "打哈欠",
  snore: "打呼噜",
  "sit-snore": "坐地上打呼噜",
  working: "干活中",
  struggle: "被拎起来了",
  shy: "害羞",
  tickle: "怕痒",
  angry: "生气了",
  happy: "被摸得很舒服",
  dizzy: "被晃晕了",
  surprised: "吓一跳",
  wave: "打招呼",
  huff: "气得直哈气",
  pound: "锤屏幕",
  knockdown: "把自己震倒了",
};

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
/** 松手时离左右边缘不超过该距离就吸附到侧边。 */
const DOCK_SNAP_PX = 28;
/** 宽屏下吸附阈值按视口短边比例放大。 */
const DOCK_SNAP_RATIO = 0.05;
/** 拖动时允许越过屏幕边缘的比例；越过后松手立刻缩进。 */
const DRAG_OVERSHOOT_RATIO = 0.5;
/** 吸附后完整露出时离屏幕边缘的距离。 */
const DOCK_INSET_PX = 2;
/** 半隐时露出的宽度占桌宠尺寸的比例：只露眼睛和嘴。 */
const PEEK_DEPTH_RATIO = 0.56;
/** 原图探头帧：与普通探头同规范（头朝屏幕内、只露头顶到嘴），头顶到嘴下约占 61%。 */
const PEEK_ORIGINAL_DEPTH_RATIO = 0.61;
/** 缩边期间每隔多久重抽一次探头造型。 */
const PEEK_ROTATE_MS = 30000;
/** 原图探头是稀有造型：与普通探头按 1:99 抽取。 */
const PEEK_ORIGINAL_CHANCE = 0.01;
/** 吸附后无人理会多久缩进去。 */
const TUCK_DELAY_MS = 4000;
/** 待机动作间隔 15–20 秒。 */
const IDLE_ACTION_MIN_MS = 15000;
const IDLE_ACTION_SPREAD_MS = 5000;
/** 无任何互动多久后睡着打呼噜。 */
const SNORE_AFTER_MS = 60000;
/** 短时间内连点达到该次数，从害羞变成怕痒。 */
const TICKLE_TAP_COUNT = 3;
const TICKLE_WINDOW_MS = 1200;
/** 短时间内戳太多次会生气。 */
const ANGRY_TAP_COUNT = 6;
const ANGRY_WINDOW_MS = 2600;
/** 按住不动超过该时长算被摸。 */
const LONG_PRESS_MS = 550;
/** 拖动中左右甩动的折返次数达到该值，松手后会晕。 */
const DIZZY_REVERSALS = 4;
/** 鼠标靠近时打招呼的冷却时间。 */
const WAVE_COOLDOWN_MS = 30000;
/** 散步/打滚至少要有这么宽的空地。 */
const STROLL_MIN_ROOM_PX = 60;
const REACTION_MS: Record<ReactionPose, number> = {
  shy: 1600,
  tickle: 1600,
  angry: 2200,
  happy: 1100,
  dizzy: 2400,
  surprised: 1300,
  wave: 1600,
  huff: 1000,
  pound: 1300,
  knockdown: 2200,
};
/** 戳到生气后的连段：生气 → 哈气 → 锤屏幕 → 把自己震得仰面倒地。 */
const RAGE_SEQUENCE: ReactionPose[] = ["angry", "huff", "pound", "knockdown"];

const petEl = ref<HTMLElement | null>(null);
const viewport = ref(readViewport());
const left = ref(0);
const top = ref(0);
const dragging = ref(false);
/** 首次落位完成后才开启位移过渡，避免挂载时从左上角滑入。 */
const settled = ref(false);
const dockEdge = ref<DeskPetDockEdge | null>(null);
const tucked = ref(false);
const hovering = ref(false);
const snoozing = ref(false);
const snoozePose = ref<SnoozePose>("snore");
const idleAction = ref<IdlePose | null>(null);
const reaction = ref<ReactionPose | null>(null);
/** 散步/打滚的朝向；素材朝右。 */
const facing = ref<"left" | "right">("right");
/** 散步/打滚时每步的位移时长；大于 0 时位移过渡改为匀速。 */
const strollMs = ref(0);

let pointerId: number | null = null;
let dragStart = { x: 0, y: 0, left: 0, top: 0 };
let pendingPosition: { left: number; top: number } | null = null;
let frameHandle: AcuTimerHandle | undefined;
let idleTimer: AcuTimerHandle | null = null;
let idleStepTimer: AcuTimerHandle | null = null;
let snoozeTimer: AcuTimerHandle | null = null;
let tuckTimer: AcuTimerHandle | null = null;
let reactionTimer: AcuTimerHandle | null = null;
let settleTimer: AcuTimerHandle | null = null;
let tapTimes: number[] = [];
let pressTimer: AcuTimerHandle | null = null;
let pressWasSnoozing = false;
let petting = false;
let reversals = 0;
let lastMoveX = 0;
let lastMoveDir = 0;
let lastWaveAt = 0;

const size = computed(() => (viewport.value.width <= NARROW_VIEWPORT_PX ? 64 : 88));
const showPeek = computed(() => !!dockEdge.value && tucked.value && !dragging.value && !reaction.value);

/** 缩边探头造型：普通探头为主、原图探头稀有（1:99），每 30 秒重抽一次；睡着时固定犯困探头。 */
const peekVariant = ref<"peek" | "original">("peek");
let peekRotateTimer: AcuTimerHandle | null = null;

function rollPeekVariant(): "peek" | "original" {
  return Math.random() < PEEK_ORIGINAL_CHANCE ? "original" : "peek";
}
const peekOriginal = computed(() => peekVariant.value === "original" && !snoozing.value);
const peekSrc = computed(() => (snoozing.value ? peekSleepyImage : peekOriginal.value ? peekOriginalImage : peekImage));
const peekDepth = computed(() => Math.round(size.value * (peekOriginal.value ? PEEK_ORIGINAL_DEPTH_RATIO : PEEK_DEPTH_RATIO)));

function stopPeekRotate(): void {
  acuClearTimeout(peekRotateTimer);
  peekRotateTimer = null;
}

function schedulePeekRotate(): void {
  stopPeekRotate();
  peekRotateTimer = acuSetTimeout(() => {
    peekRotateTimer = null;
    peekVariant.value = rollPeekVariant();
    schedulePeekRotate();
  }, PEEK_ROTATE_MS);
}

watch(showPeek, shown => {
  if (!shown) {
    stopPeekRotate();
    return;
  }
  // 每次缩进去按 1:99 抽一次造型，之后每 30 秒重抽。
  peekVariant.value = rollPeekVariant();
  schedulePeekRotate();
});

const pose = computed<Pose>(() => {
  if (dragging.value) return "struggle";
  if (reaction.value) return reaction.value;
  if (props.busy) return "working";
  if (snoozing.value) return snoozePose.value;
  return idleAction.value ?? "idle";
});

/** 待机系动作共用一条呼吸动画，切帧时动画不重启。 */
const breathing = computed(() => ["idle", "blink", "look-left", "look-right", "snore", "sit-snore"].includes(pose.value));

/** 素材朝右；向左散步或打滚时水平镜像。 */
const flipped = computed(() => facing.value === "left" && ["walk-a", "walk-b", "roll"].includes(pose.value));

/** 实际露出的区域：半隐时只剩贴边的一条，气泡据此锚定。 */
const visibleRect = computed<DeskPetRect>(() => {
  if (showPeek.value) {
    const depth = peekDepth.value;
    switch (dockEdge.value) {
      case "right":
        return { x: viewport.value.width - depth, y: top.value, width: depth, height: size.value };
      case "left":
        return { x: 0, y: top.value, width: depth, height: size.value };
      case "top":
        return { x: left.value, y: 0, width: size.value, height: depth };
      default:
        return { x: left.value, y: viewport.value.height - depth, width: size.value, height: depth };
    }
  }
  return { x: left.value, y: top.value, width: size.value, height: size.value };
});

const petStyle = computed(() => ({
  width: `${visibleRect.value.width}px`,
  height: `${visibleRect.value.height}px`,
  transform: `translate3d(${visibleRect.value.x}px, ${visibleRect.value.y}px, 0)`,
  ...(strollMs.value > 0 ? { transition: `transform ${strollMs.value}ms linear` } : {}),
}));

/** 探头图底边平切：按停靠边旋转，让平切边贴住屏幕边缘（下边不转、上边转 180°、右边 -90°、左边 90°）。 */
const peekImgStyle = computed(() => {
  const edge = dockEdge.value ?? "bottom";
  const base = { width: `${size.value}px`, height: `${size.value}px` };
  if (edge === "right") return { ...base, top: "0px", right: "0px", transform: "rotate(-90deg)" };
  if (edge === "left") return { ...base, top: "0px", left: "0px", transform: "rotate(90deg)" };
  if (edge === "top") return { ...base, top: "0px", left: "0px", transform: "rotate(180deg)" };
  return { ...base, bottom: "0px", left: "0px" };
});

const rootClass = computed(() => ({
  "is-dragging": dragging.value,
  "is-tucked": showPeek.value,
  "is-animated": settled.value && !dragging.value,
}));

const ariaLabel = computed(() => `桌宠：${showPeek.value ? "躲在边上偷看" : POSE_LABELS[pose.value]}`);
const titleText = computed(() =>
  showPeek.value ? "躲在边上偷看（悬停或点一下就探出来）" : `${POSE_LABELS[pose.value]}（可拖动，点一下有反应）`,
);

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

/** 拖动中的夹取：允许越过屏幕边缘一部分，用来把桌宠「推进墙里」。 */
function clampDragPosition(nextLeft: number, nextTop: number): { left: number; top: number } {
  const over = Math.round(size.value * DRAG_OVERSHOOT_RATIO);
  const maxLeft = viewport.value.width - size.value + over;
  const maxTop = viewport.value.height - size.value + over;
  return {
    left: Math.min(Math.max(-over, nextLeft), Math.max(-over, maxLeft)),
    top: Math.min(Math.max(-over, nextTop), Math.max(-over, maxTop)),
  };
}

/** 吸附到某条边后的完整露出位置：贴边那一轴靠边，另一轴夹进视口。 */
function dockedPosition(edge: DeskPetDockEdge, fromLeft: number, fromTop: number): { left: number; top: number } {
  const free = clampPosition(fromLeft, fromTop);
  const farLeft = Math.max(DOCK_INSET_PX, viewport.value.width - size.value - DOCK_INSET_PX);
  const farTop = Math.max(DOCK_INSET_PX, viewport.value.height - size.value - DOCK_INSET_PX);
  if (edge === "left") return { left: DOCK_INSET_PX, top: free.top };
  if (edge === "right") return { left: farLeft, top: free.top };
  if (edge === "top") return { left: free.left, top: DOCK_INSET_PX };
  return { left: free.left, top: farTop };
}

/** 按已保存比例（或默认右下角）落位并夹进当前视口；吸附过侧边的继续贴边。 */
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
  dockEdge.value = ratio?.edge ?? null;
  const placed = dockEdge.value ? dockedPosition(dockEdge.value, next.left, next.top) : next;
  left.value = placed.left;
  top.value = placed.top;
  if (dockEdge.value) {
    if (!tucked.value) scheduleTuck();
  } else {
    untuck();
  }
}

function persistPosition(): void {
  saveDeskPetPositionRatio({
    x: (left.value - EDGE_MARGIN_PX) / usableSpan(viewport.value.width),
    y: (top.value - EDGE_MARGIN_PX) / usableSpan(viewport.value.height),
    edge: dockEdge.value,
  });
}

/**
 * 松手时贴近上下左右任一边就吸附过去；阈值随视口放大，宽屏也容易吸附。
 * 返回 true 表示是被推进墙里的，应立刻缩进。
 */
function settleDock(): boolean {
  const snap = Math.max(DOCK_SNAP_PX, Math.round(Math.min(viewport.value.width, viewport.value.height) * DOCK_SNAP_RATIO));
  const maxLeft = viewport.value.width - size.value - EDGE_MARGIN_PX;
  const maxTop = viewport.value.height - size.value - EDGE_MARGIN_PX;
  const distances: Array<[DeskPetDockEdge, number]> = [
    ["left", left.value - EDGE_MARGIN_PX],
    ["right", maxLeft - left.value],
    ["top", top.value - EDGE_MARGIN_PX],
    ["bottom", maxTop - top.value],
  ];
  distances.sort((a, b) => a[1] - b[1]);
  const [edge, distance] = distances[0];
  if (distance > snap) {
    dockEdge.value = null;
    const free = clampPosition(left.value, top.value);
    left.value = free.left;
    top.value = free.top;
    return false;
  }
  dockEdge.value = edge;
  const placed = dockedPosition(edge, left.value, top.value);
  left.value = placed.left;
  top.value = placed.top;
  return distance < -EDGE_MARGIN_PX;
}

function flushPendingPosition(): void {
  frameHandle = undefined;
  if (!pendingPosition) return;
  left.value = pendingPosition.left;
  top.value = pendingPosition.top;
  pendingPosition = null;
}

function clearTimer(handle: AcuTimerHandle | null): null {
  acuClearTimeout(handle);
  return null;
}

function stopIdleAction(): void {
  idleStepTimer = clearTimer(idleStepTimer);
  idleAction.value = null;
  if (strollMs.value > 0) {
    strollMs.value = 0;
    persistPosition();
  }
}

/** 按步骤播放一串待机帧，例如连眨两下、先看左再看右。 */
function playIdleSequence(steps: Array<[IdlePose, number]>): void {
  idleStepTimer = clearTimer(idleStepTimer);
  const [head, ...rest] = steps;
  if (!head) {
    idleAction.value = null;
    return;
  }
  idleAction.value = head[0];
  idleStepTimer = acuSetTimeout(() => {
    idleStepTimer = null;
    playIdleSequence(rest);
  }, head[1]);
}

/** 散步或打滚：在当前高度左右挪一段，结束后保存新位置。贴边或空地不够时不走动。 */
function playStroll(kind: "walk" | "roll"): boolean {
  if (dockEdge.value || acuMatchesMedia("(prefers-reduced-motion: reduce)")) return false;
  const maxLeft = Math.max(EDGE_MARGIN_PX, viewport.value.width - size.value - EDGE_MARGIN_PX);
  const roomLeft = left.value - EDGE_MARGIN_PX;
  const roomRight = maxLeft - left.value;
  if (Math.max(roomLeft, roomRight) < STROLL_MIN_ROOM_PX) return false;
  const dir = roomLeft < STROLL_MIN_ROOM_PX ? 1 : roomRight < STROLL_MIN_ROOM_PX ? -1 : Math.random() < 0.5 ? -1 : 1;
  const steps = kind === "walk" ? 12 : 6;
  const stepPx = kind === "walk" ? 8 : 15;
  const stepMs = kind === "walk" ? 230 : 170;
  idleStepTimer = clearTimer(idleStepTimer);
  facing.value = dir > 0 ? "right" : "left";
  strollMs.value = stepMs;
  let step = 0;
  const tick = (): void => {
    idleStepTimer = null;
    if (step >= steps) {
      stopIdleAction();
      return;
    }
    idleAction.value = kind === "roll" ? "roll" : step % 2 ? "walk-b" : "walk-a";
    left.value = clampPosition(left.value + dir * stepPx, top.value).left;
    step++;
    idleStepTimer = acuSetTimeout(tick, stepMs);
  };
  tick();
  return true;
}

function runIdleAction(): void {
  idleTimer = null;
  const quiet = !props.busy && !dragging.value && !reaction.value && !snoozing.value && !showPeek.value;
  if (quiet && !idleAction.value) {
    const dice = Math.random();
    if (dice < 0.16) playIdleSequence([["blink", 160]]);
    else if (dice < 0.24) playIdleSequence([["blink", 140], ["idle", 110], ["blink", 140]]);
    else if (dice < 0.38) playIdleSequence([["look-left", 1300], ["idle", 250], ["look-right", 1300]]);
    else if (dice < 0.56) {
      if (!playStroll("walk")) playIdleSequence([["look-right", 1600]]);
    } else if (dice < 0.66) {
      if (!playStroll("roll")) playIdleSequence([["blink", 160]]);
    } else if (dice < 0.8) playIdleSequence([["eat-a", 900], ["eat-b", 650], ["eat-a", 450], ["eat-b", 900]]);
    else if (dice < 0.9) playIdleSequence([["yawn", 1500]]);
    else playIdleSequence([[dice < 0.95 ? "look-left" : "look-right", 1800]]);
  }
  scheduleIdleAction();
}

function scheduleIdleAction(): void {
  idleTimer = clearTimer(idleTimer);
  idleTimer = acuSetTimeout(runIdleAction, IDLE_ACTION_MIN_MS + Math.random() * IDLE_ACTION_SPREAD_MS);
}

/** 有互动就醒过来，并重新计时打瞌睡。 */
function markActive(): void {
  snoozing.value = false;
  snoozeTimer = clearTimer(snoozeTimer);
  if (props.busy) return;
  snoozeTimer = acuSetTimeout(() => {
    snoozeTimer = null;
    if (props.busy || dragging.value || reaction.value) return;
    stopIdleAction();
    snoozePose.value = Math.random() < 0.5 ? "snore" : "sit-snore";
    snoozing.value = true;
  }, SNORE_AFTER_MS);
}

function canTuck(): boolean {
  return !!dockEdge.value && !hovering.value && !dragging.value && !props.busy && !reaction.value;
}

function scheduleTuck(): void {
  tuckTimer = clearTimer(tuckTimer);
  if (!canTuck()) return;
  tuckTimer = acuSetTimeout(() => {
    tuckTimer = null;
    if (canTuck()) tucked.value = true;
  }, TUCK_DELAY_MS);
}

function untuck(): void {
  tuckTimer = clearTimer(tuckTimer);
  tucked.value = false;
}

function endReactionLater(ms: number): void {
  reactionTimer = clearTimer(reactionTimer);
  reactionTimer = acuSetTimeout(() => {
    reactionTimer = null;
    reaction.value = null;
    scheduleTuck();
  }, ms);
}

/** 播放互动反应；hold 为 true 时持续到调用方结束（例如长按被摸）。 */
function startReaction(kind: ReactionPose, hold = false): void {
  reaction.value = kind;
  stopIdleAction();
  untuck();
  reactionTimer = clearTimer(reactionTimer);
  if (!hold) endReactionLater(REACTION_MS[kind]);
}

/** 按顺序播放一串互动反应（生气连段），播完回到常态。 */
function playReactionSequence(steps: ReactionPose[]): void {
  const [head, ...rest] = steps;
  if (!head) {
    reaction.value = null;
    scheduleTuck();
    return;
  }
  startReaction(head, true);
  reactionTimer = acuSetTimeout(() => {
    reactionTimer = null;
    playReactionSequence(rest);
  }, REACTION_MS[head]);
}

function inRageSequence(): boolean {
  return !!reaction.value && RAGE_SEQUENCE.includes(reaction.value);
}

/** 点一下害羞，连点三下怕痒，戳太多会生气；睡着时被点会吓一跳。 */
function onTap(): void {
  if (pressWasSnoozing) {
    tapTimes = [];
    startReaction("surprised");
    return;
  }
  // 气头上的连段不被打断。
  if (inRageSequence()) return;
  const now = Date.now();
  tapTimes = [...tapTimes.filter(time => now - time < ANGRY_WINDOW_MS), now];
  const recent = tapTimes.filter(time => now - time < TICKLE_WINDOW_MS).length;
  if (tapTimes.length >= ANGRY_TAP_COUNT) {
    tapTimes = [];
    playReactionSequence(RAGE_SEQUENCE);
  } else if (recent >= TICKLE_TAP_COUNT) {
    startReaction("tickle");
  } else {
    startReaction("shy");
  }
}

/** 鼠标靠近时挥手打招呼，有冷却，不打断正在进行的互动。 */
function maybeWave(): void {
  const now = Date.now();
  if (pointerId !== null || props.busy || reaction.value || snoozing.value) return;
  if (now - lastWaveAt < WAVE_COOLDOWN_MS) return;
  lastWaveAt = now;
  startReaction("wave");
}

function onPointerDown(event: PointerEvent): void {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  pointerId = event.pointerId;
  pressWasSnoozing = snoozing.value;
  markActive();
  untuck();
  dragStart = { x: event.clientX, y: event.clientY, left: left.value, top: top.value };
  dragging.value = false;
  reversals = 0;
  lastMoveX = event.clientX;
  lastMoveDir = 0;
  petting = false;
  pressTimer = clearTimer(pressTimer);
  pressTimer = acuSetTimeout(() => {
    pressTimer = null;
    if (pointerId === null || dragging.value) return;
    petting = true;
    startReaction("happy", true);
  }, LONG_PRESS_MS);
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
  if (!dragging.value) {
    dragging.value = true;
    pressTimer = clearTimer(pressTimer);
    petting = false;
    stopIdleAction();
    reaction.value = null;
    reactionTimer = clearTimer(reactionTimer);
  }
  trackShake(event.clientX);
  event.preventDefault();
  pendingPosition = clampDragPosition(dragStart.left + dx, dragStart.top + dy);
  if (frameHandle === undefined) frameHandle = acuRequestAnimationFrame(flushPendingPosition);
}

/** 记录拖动中左右甩动的折返次数。 */
function trackShake(x: number): void {
  const delta = x - lastMoveX;
  if (Math.abs(delta) < 6) return;
  const dir = Math.sign(delta);
  if (lastMoveDir && dir !== lastMoveDir) reversals++;
  lastMoveDir = dir;
  lastMoveX = x;
}

function finishDrag(): void {
  if (frameHandle !== undefined) {
    acuCancelAnimationFrame(frameHandle);
    frameHandle = undefined;
  }
  flushPendingPosition();
  dragging.value = false;
  const pushedIn = settleDock();
  persistPosition();
  if (reversals >= DIZZY_REVERSALS) startReaction("dizzy");
  else if (pushedIn) {
    tuckTimer = clearTimer(tuckTimer);
    tucked.value = true;
  } else scheduleTuck();
}

function releasePointer(event: PointerEvent): boolean {
  if (pointerId !== event.pointerId) return false;
  pointerId = null;
  pressTimer = clearTimer(pressTimer);
  try {
    petEl.value?.releasePointerCapture(event.pointerId);
  } catch {
    // 捕获已随指针结束自动释放。
  }
  return true;
}

function onPointerUp(event: PointerEvent): void {
  if (!releasePointer(event)) return;
  if (dragging.value) finishDrag();
  else if (petting) {
    petting = false;
    endReactionLater(900);
  } else onTap();
}

function onPointerCancel(event: PointerEvent): void {
  if (!releasePointer(event)) return;
  if (dragging.value) finishDrag();
  else if (petting) {
    petting = false;
    endReactionLater(300);
  } else scheduleTuck();
}

function onPointerEnter(event: PointerEvent): void {
  hovering.value = true;
  tuckTimer = clearTimer(tuckTimer);
  if (event.pointerType !== "mouse") return;
  if (tucked.value) {
    untuck();
    markActive();
  }
  maybeWave();
}

function onPointerLeave(): void {
  hovering.value = false;
  scheduleTuck();
}

function onResize(): void {
  viewport.value = readViewport();
  if (!dragging.value) applySavedPosition();
}

watch(visibleRect, rect => emit("rect", { ...rect }), { immediate: true });

watch(() => props.settingsVersion, () => {
  if (!dragging.value) applySavedPosition();
});

watch(() => props.busy, busy => {
  if (busy) {
    stopIdleAction();
    untuck();
  } else {
    scheduleTuck();
  }
  markActive();
});

onMounted(() => {
  viewport.value = readViewport();
  applySavedPosition();
  getAcuHostWindow().addEventListener("resize", onResize);
  scheduleIdleAction();
  markActive();
  settleTimer = acuSetTimeout(() => {
    settleTimer = null;
    settled.value = true;
  }, 60);
});

onBeforeUnmount(() => {
  getAcuHostWindow().removeEventListener("resize", onResize);
  if (frameHandle !== undefined) acuCancelAnimationFrame(frameHandle);
  for (const handle of [idleTimer, idleStepTimer, snoozeTimer, tuckTimer, reactionTimer, settleTimer, pressTimer]) acuClearTimeout(handle);
  stopPeekRotate();
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

.acu-desk-pet.is-animated {
  transition:
    transform 0.32s cubic-bezier(0.2, 0.8, 0.2, 1),
    width 0.32s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.acu-desk-pet.is-dragging {
  cursor: grabbing;
}

.acu-desk-pet.is-tucked {
  cursor: pointer;
}

.acu-desk-pet__body {
  width: 100%;
  height: 100%;
  transform-origin: 50% 100%;
  transition: transform 0.2s ease-out;
}

.acu-desk-pet__body.is-breathing {
  animation: acu-desk-pet-breathe 2.8s ease-in-out infinite;
}

/* 被拎起来时整体悬空 */
.acu-desk-pet.is-dragging .acu-desk-pet__body {
  transform: translateY(-10px);
}

.acu-desk-pet__img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
  filter: drop-shadow(0 4px 6px rgba(60, 40, 0, 0.28));
  transform-origin: 50% 100%;
  transition: transform 0.25s ease-out;
}

.acu-desk-pet__img.pose-look-left {
  transform: translateX(-3px) rotate(-3deg);
}

.acu-desk-pet__img.pose-look-right {
  transform: translateX(3px) rotate(3deg);
}

.acu-desk-pet__img.pose-working {
  animation: acu-desk-pet-sway 1.4s ease-in-out infinite;
}

/* 悬空挣扎：以头顶为支点乱晃。挣扎帧四肢张开，身体在素材里只占待机帧约 66% 面积，
   按面积比放大 1.23 倍，让身体保持与基础状态同等体型（四肢可超出桌宠框）。 */
.acu-desk-pet__img.pose-struggle {
  transform-origin: 50% 20%;
  transform: scale(1.23);
  filter: drop-shadow(0 14px 8px rgba(60, 40, 0, 0.16));
  animation: acu-desk-pet-dangle 0.42s ease-in-out infinite;
}

.acu-desk-pet__img.pose-shy {
  animation: acu-desk-pet-shy 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

.acu-desk-pet__img.pose-tickle {
  animation: acu-desk-pet-tickle 0.18s linear infinite;
}

.acu-desk-pet__flip {
  width: 100%;
  height: 100%;
}

.acu-desk-pet__flip.is-flipped {
  transform: scaleX(-1);
}

/* 走路两帧左右脚交替，身体随步子左右摇摆，不再上下跳 */
.acu-desk-pet__img.pose-walk-a {
  transform: rotate(-3deg);
}

.acu-desk-pet__img.pose-walk-b {
  transform: rotate(3deg);
}

.acu-desk-pet__img.pose-huff {
  animation: acu-desk-pet-huff 0.5s ease-in-out infinite;
}

/* 锤屏幕：一下下朝镜头扑过来 */
.acu-desk-pet__img.pose-pound {
  transform-origin: 50% 60%;
  animation: acu-desk-pet-pound 0.43s cubic-bezier(0.3, 0, 0.2, 1) 3;
}

/* 把自己震倒：先往后弹，再仰面落地。倒地帧身体面积只有旧帧约 80%（14721/18394），
   关键帧里的缩放统一乘 1.12（面积比开方），以底边为原点放大，让倒地后体型与基础状态一致；
   两侧可略微超出桌宠框（与挣扎帧同一补偿方式）。 */
.acu-desk-pet__img.pose-knockdown {
  animation: acu-desk-pet-knockdown 0.7s cubic-bezier(0.3, 1.4, 0.5, 1) both;
}

.acu-desk-pet__img.pose-roll {
  transform-origin: 50% 55%;
  animation: acu-desk-pet-roll 0.68s linear infinite;
}

.acu-desk-pet__img.pose-eat-b {
  animation: acu-desk-pet-chew 0.32s ease-in-out infinite;
}

.acu-desk-pet__img.pose-yawn {
  animation: acu-desk-pet-yawn 1.5s ease-in-out both;
}

.acu-desk-pet__img.pose-happy {
  animation: acu-desk-pet-happy 1.1s ease-in-out infinite;
}

.acu-desk-pet__img.pose-angry {
  animation: acu-desk-pet-stomp 0.22s linear infinite;
}

.acu-desk-pet__img.pose-dizzy {
  animation: acu-desk-pet-dizzy 1.2s ease-in-out infinite;
}

/* 吓一跳：惊吓帧身体收拢，不透明面积只有待机帧约 72%，按面积比放大 1.18 倍，
   让被叫醒时体型与基础状态一致（与挣扎帧同一补偿方式）。 */
.acu-desk-pet__img.pose-surprised {
  transform: scale(1.18);
  animation: acu-desk-pet-jump 0.6s cubic-bezier(0.3, 1.6, 0.5, 1) both;
}

.acu-desk-pet__img.pose-wave {
  animation: acu-desk-pet-wave 0.8s ease-in-out 2;
}

.acu-desk-pet__peek {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.acu-desk-pet__peek-img {
  position: absolute;
  top: 0;
  display: block;
  object-fit: contain;
  pointer-events: none;
  filter: drop-shadow(0 2px 4px rgba(60, 40, 0, 0.25));
}

/* 探头时轻轻往里缩、再往外探 */
.acu-desk-pet__peek.is-right {
  animation: acu-desk-pet-peek-right 3.4s ease-in-out infinite;
}

.acu-desk-pet__peek.is-left {
  animation: acu-desk-pet-peek-left 3.4s ease-in-out infinite;
}

.acu-desk-pet__peek.is-top {
  animation: acu-desk-pet-peek-top 3.4s ease-in-out infinite;
}

.acu-desk-pet__peek.is-bottom {
  animation: acu-desk-pet-peek-bottom 3.4s ease-in-out infinite;
}

@keyframes acu-desk-pet-breathe {
  0%,
  100% {
    transform: scale(1, 1) translateY(0);
  }
  35% {
    transform: scale(1.05, 0.94) translateY(0);
  }
  70% {
    transform: scale(0.97, 1.04) translateY(-2px);
  }
}

@keyframes acu-desk-pet-sway {
  0%,
  100% {
    transform: rotate(-4deg) translateY(0);
  }
  50% {
    transform: rotate(4deg) translateY(-3px);
  }
}

@keyframes acu-desk-pet-dangle {
  0%,
  100% {
    transform: scale(1.23) rotate(-10deg);
  }
  25% {
    transform: scale(1.23) rotate(6deg) translateY(2px);
  }
  50% {
    transform: scale(1.23) rotate(-6deg) translateY(-1px);
  }
  75% {
    transform: scale(1.23) rotate(10deg) translateY(2px);
  }
}

@keyframes acu-desk-pet-shy {
  0% { transform: scale(1, 1); }
  25% { transform: scale(1.08, 0.88) translateY(2px); }
  55% { transform: scale(0.95, 1.06) translateY(-5px); }
  80% { transform: scale(1.02, 0.98); }
  100% { transform: scale(1, 1); }
}

@keyframes acu-desk-pet-tickle {
  0%, 100% { transform: rotate(-6deg) translateX(-2px); }
  50% { transform: rotate(6deg) translateX(2px); }
}

@keyframes acu-desk-pet-peek-right {
  0%, 100% { transform: translateX(0); }
  50% { transform: translateX(4px); }
}

@keyframes acu-desk-pet-peek-left {
  0%, 100% { transform: translateX(0); }
  50% { transform: translateX(-4px); }
}

@keyframes acu-desk-pet-peek-top {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}

@keyframes acu-desk-pet-peek-bottom {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(4px); }
}

@keyframes acu-desk-pet-huff {
  0%, 100% { transform: scale(1, 1); }
  40% { transform: scale(1.06, 0.95) translateY(1px); }
  70% { transform: scale(0.97, 1.04) translateX(1px); }
}

@keyframes acu-desk-pet-pound {
  0%, 100% { transform: scale(1) translateY(0); }
  45% { transform: scale(1.22) translateY(-4px); }
  60% { transform: scale(1.16) translateY(-2px) rotate(-2deg); }
}

@keyframes acu-desk-pet-knockdown {
  0% { transform: translateY(-18px) rotate(-20deg) scale(1.03); }
  60% { transform: translateY(2px) rotate(4deg) scale(1.165, 1.075); }
  100% { transform: translateY(0) rotate(0deg) scale(1.12); }
}

@keyframes acu-desk-pet-roll {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes acu-desk-pet-chew {
  0%, 100% { transform: scale(1, 1); }
  50% { transform: scale(1.03, 0.97); }
}

@keyframes acu-desk-pet-yawn {
  0%, 100% { transform: scale(1, 1); }
  45% { transform: scale(0.96, 1.08) translateY(-2px); }
}

@keyframes acu-desk-pet-happy {
  0%, 100% { transform: rotate(-4deg) translateY(0); }
  50% { transform: rotate(4deg) translateY(-3px); }
}

@keyframes acu-desk-pet-stomp {
  0%, 100% { transform: translateX(-2px); }
  50% { transform: translateX(2px) scale(1.02, 0.98); }
}

@keyframes acu-desk-pet-dizzy {
  0%, 100% { transform: rotate(-8deg) translateX(-2px); }
  50% { transform: rotate(8deg) translateX(2px); }
}

@keyframes acu-desk-pet-jump {
  0% { transform: translateY(0) scale(1.18, 1.18); }
  30% { transform: translateY(-14px) scale(1.11, 1.27); }
  70% { transform: translateY(0) scale(1.25, 1.11); }
  100% { transform: translateY(0) scale(1.18, 1.18); }
}

@keyframes acu-desk-pet-wave {
  0%, 100% { transform: rotate(0deg); }
  25% { transform: rotate(-5deg); }
  75% { transform: rotate(5deg); }
}

@media (prefers-reduced-motion: reduce) {
  .acu-desk-pet.is-animated,
  .acu-desk-pet__body,
  .acu-desk-pet__body.is-breathing,
  .acu-desk-pet__img,
  .acu-desk-pet__peek {
    animation: none !important;
    transition: none;
  }
}
</style>
