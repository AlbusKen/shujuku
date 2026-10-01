<template>
  <main ref="containerRef" class="acu-v2-main" data-acu-main>
    <component
      v-if="router.activePage"
      :is="router.activePage.component"
      :key="`${router.activePageId}:${shell.openRefreshTick}`"
    />
    <p v-else class="acu-v2-main__empty">没有可显示的页面（路由 store 异常）</p>
  </main>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { scheduleRouterBootComplete_ACU, useRouterStore } from '../stores/router-store';
import { useRootShellStore } from '../stores/root-shell-store';

const router = useRouterStore();
const shell = useRootShellStore();
const containerRef = ref<HTMLElement | null>(null);

// 仅在面板打开时挂载：父组件 setup 先于子页面 setup 执行，在这里武装崩溃哨兵，
// 当前页 setup/onMounted 卡死时哨兵保持 true，下次打开回退到默认页。
router.armBootPending();

function resetScroll() {
  if (containerRef.value) containerRef.value.scrollTop = 0;
}

function schedulePaintComplete(): void {
  const generation = router.bootGeneration;
  scheduleRouterBootComplete_ACU(() => router.markBootComplete(generation));
}

onMounted(() => {
  resetScroll();
  schedulePaintComplete();
});
watch(() => shell.scrollResetTick, resetScroll);
// 重开 UI 会 remount 当前重页，必须在新 setup 之前重新武装哨兵。
watch(() => shell.openRefreshTick, () => {
  router.armBootPending();
});
watch(
  () => `${router.activePageId}:${shell.openRefreshTick}`,
  () => {
    resetScroll();
    schedulePaintComplete();
  },
  { flush: 'post' },
);
</script>

<style scoped>
.acu-v2-main {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  scrollbar-gutter: stable;
  background: var(--acu-bg-0);
  color: var(--acu-text-1);
}

.acu-v2-main :deep(.acu-v2-dashboard-page),
.acu-v2-main :deep(.acu-v2-fill-mode-page),
.acu-v2-main :deep(.acu-v2-advanced-tools-page),
.acu-v2-main :deep(.acu-v2-form-fill-page),
.acu-v2-main :deep(.acu-v2-api-page),
.acu-v2-main :deep(.acu-v2-import-page),
.acu-v2-main :deep(.acu-v2-continuation-page),
.acu-v2-main :deep(.acu-v2-content-replace-page),
.acu-v2-main :deep(.acu-v2-data-mgmt-page),
.acu-v2-main :deep(.acu-v2-developer-page),
.acu-v2-main :deep(.acu-v2-plot-page),
.acu-v2-main :deep(.acu-v2-table-page) {
  padding: var(--acu-page-padding, 20px);
  gap: var(--acu-page-gap, 14px);
}

.acu-v2-main__empty {
  padding: var(--acu-space-6, 24px);
  font-size: var(--acu-font-size-body-lg, 13px);
  color: var(--acu-text-3);
}

@media (max-width: 720px) {
  .acu-v2-main :deep(.acu-v2-dashboard-page),
  .acu-v2-main :deep(.acu-v2-fill-mode-page),
  .acu-v2-main :deep(.acu-v2-advanced-tools-page),
  .acu-v2-main :deep(.acu-v2-form-fill-page),
  .acu-v2-main :deep(.acu-v2-api-page),
  .acu-v2-main :deep(.acu-v2-import-page),
  .acu-v2-main :deep(.acu-v2-continuation-page),
  .acu-v2-main :deep(.acu-v2-content-replace-page),
  .acu-v2-main :deep(.acu-v2-data-mgmt-page),
  .acu-v2-main :deep(.acu-v2-developer-page),
  .acu-v2-main :deep(.acu-v2-plot-page),
  .acu-v2-main :deep(.acu-v2-table-page) {
    padding: var(--acu-page-padding-compact, 14px);
  }
}
</style>
