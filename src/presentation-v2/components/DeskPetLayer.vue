<template>
  <Teleport v-if="portalTarget" :to="portalTarget">
    <div class="acu-desk-pet-layer">
      <DeskPet
        ref="pet"
        v-if="hubState.petEnabled.value"
        :busy="activity.busy.value"
        :settings-version="hubState.snapshot.value.settingsVersion"
        :appearance="hubState.petAppearance.value"
        :menu-open="menuOpen"
        @rect="petRect = $event"
        @menu-request="requestMenu"
      />
      <DeskPetActionMenu
        ref="menu"
        v-if="menuOpen && petRect"
        :anchor="petRect"
        :viewport-width="viewport.width"
        :viewport-height="viewport.height"
        :busy="quickActions.busy.value"
        :confirm="quickActions.confirm.value"
        :config-rows="quickActions.configRows.value"
        :colors="hubState.bubbleAppearance.value.colors"
        @close="closeMenu"
        @open-dashboard="openDashboard"
        @open-logs="openLogs"
        @open-visualizer="openVisualizer"
        @catch-up="quickActions.requestCatchUp"
        @detect="quickActions.detect"
        @confirm-catch-up="startCatchUp"
        @cancel-catch-up="quickActions.cancelCatchUp"
      />
      <NoticeBubble
        :slide="carousel.slide.value"
        :task="carousel.currentTask.value"
        :appearance="hubState.bubbleAppearance.value"
        :anchor="hubState.petEnabled.value ? petRect : null"
        :viewport-width="viewport.width"
        :viewport-height="viewport.height"
        :action-busy="carousel.actionBusy.value"
        :show-real-work="hubState.showRealWork.value"
        @pause="carousel.pause"
        @resume="carousel.resume"
        @skip="carousel.skip"
        @notice-action="carousel.runNoticeAction"
        @task-action="carousel.runTaskAction"
        @dismiss-task="carousel.dismissTask"
      />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 桌宠与统一浮动气泡的宿主：挂在设置外壳之外、传送到宿主 body，
 * 设置面板关闭时同样可见。通知、进度任务与冷笑话都经这里的单一气泡轮播。
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { getAcuHostDocument, getAcuHostWindow } from "../bootstrap/host-document";
import { useDeskPetQuickActions } from "../composables/useDeskPetQuickActions";
import { useNoticeCarousel } from "../composables/useNoticeCarousel";
import { useNoticeHubState, useTaskActivity, type DeskPetRect } from "../composables/useTaskActivity";
import DeskPet from "./DeskPet.vue";
import DeskPetActionMenu from "./DeskPetActionMenu.vue";
import NoticeBubble from "./NoticeBubble.vue";

const emit = defineEmits<{ (event: "openDashboard"): void }>();

const hubState = useNoticeHubState();
const activity = useTaskActivity(hubState);
const carousel = useNoticeCarousel(hubState, activity.tasks);
const quickActions = useDeskPetQuickActions();

const portalTarget = ref<HTMLElement | null>(null);
const petRect = ref<DeskPetRect | null>(null);
const viewport = ref({ width: 0, height: 0 });
const menuOpen = ref(false);
const pet = ref<InstanceType<typeof DeskPet> | null>(null);
const menu = ref<InstanceType<typeof DeskPetActionMenu> | null>(null);

async function requestMenu(source: "pointer" | "keyboard"): Promise<void> {
  menuOpen.value = true;
  if (source === "keyboard") {
    await nextTick();
    await menu.value?.focusAction();
  }
}

function closeMenu(restoreFocus = false): void {
  // 关菜单即放弃未确认的追平确认卡，避免下次点开时误触旧计划。
  quickActions.cancelCatchUp();
  menuOpen.value = false;
  if (restoreFocus) (pet.value?.$el as HTMLElement | undefined)?.focus();
}

function runAndClose(action: () => void): void {
  closeMenu();
  action();
}

function openDashboard(): void {
  menuOpen.value = false;
  emit("openDashboard");
}

function openLogs(): void {
  runAndClose(quickActions.openLogs);
}

function openVisualizer(): void {
  runAndClose(quickActions.openVisualizer);
}

function startCatchUp(): void {
  quickActions.acceptCatchUp();
  menuOpen.value = false;
}

watch(() => hubState.petEnabled.value, enabled => {
  if (!enabled) closeMenu();
});

function readViewport(): void {
  const win = getAcuHostWindow();
  viewport.value = { width: win.innerWidth || 0, height: win.innerHeight || 0 };
}

onMounted(() => {
  portalTarget.value = getAcuHostDocument().body;
  readViewport();
  getAcuHostWindow().addEventListener("resize", readViewport);
});

onBeforeUnmount(() => {
  getAcuHostWindow().removeEventListener("resize", readViewport);
});
</script>

<style scoped>
.acu-desk-pet-layer {
  display: contents;
}
</style>
