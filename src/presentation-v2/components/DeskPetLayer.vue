<template>
  <Teleport v-if="portalTarget" :to="portalTarget">
    <div class="acu-desk-pet-layer">
      <DeskPet
        v-if="hubState.petEnabled.value"
        :busy="activity.busy.value"
        :settings-version="hubState.snapshot.value.settingsVersion"
        @rect="petRect = $event"
      />
      <NoticeBubble
        :slide="carousel.slide.value"
        :task="carousel.currentTask.value"
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
import { onBeforeUnmount, onMounted, ref } from "vue";
import { getAcuHostDocument, getAcuHostWindow } from "../bootstrap/host-document";
import { useNoticeCarousel } from "../composables/useNoticeCarousel";
import { useNoticeHubState, useTaskActivity, type DeskPetRect } from "../composables/useTaskActivity";
import DeskPet from "./DeskPet.vue";
import NoticeBubble from "./NoticeBubble.vue";

const hubState = useNoticeHubState();
const activity = useTaskActivity(hubState);
const carousel = useNoticeCarousel(hubState, activity.tasks);

const portalTarget = ref<HTMLElement | null>(null);
const petRect = ref<DeskPetRect | null>(null);
const viewport = ref({ width: 0, height: 0 });

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
