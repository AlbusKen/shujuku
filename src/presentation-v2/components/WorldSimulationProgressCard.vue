<template>
  <Teleport v-if="portalTarget" :to="portalTarget">
    <div
      v-if="cardVisible"
      class="acu-world-sim-progress"
      :class="{ 'is-collapsed': collapsed, 'is-terminal': view.terminal }"
      role="status"
      :aria-label="view.label"
      :style="{ zIndex: 8500 }"
    >
      <button
        type="button"
        class="acu-world-sim-progress__dot"
        :title="collapsed ? view.label : '折叠为圆点'"
        :aria-expanded="String(!collapsed)"
        @click="collapsed = !collapsed"
      >
        <span class="acu-world-sim-progress__pulse" />
      </button>
      <div v-if="!collapsed" class="acu-world-sim-progress__body">
        <p class="acu-world-sim-progress__kicker">世界推演</p>
        <p class="acu-world-sim-progress__label">{{ view.label }}</p>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { getAcuHostDocument } from '../bootstrap/host-document';
import { acuClearTimeout, acuSetTimeout, type AcuTimerHandle } from '../bootstrap/host-env';
import { useChatChangedTick } from '../composables/useChatChangedListener';
import { useWorldSimulationRuntime } from '../composables/useWorldSimulationRuntime';
import { deriveWorldSimulationProgressView_ACU } from '../simulation/world-simulation-progress-stage';

const NARROW_COLLAPSE_PX = 640;
const TERMINAL_HOLD_MS = 2400;

const runtime = useWorldSimulationRuntime();
const portalTarget = ref<HTMLElement | null>(null);
const collapsed = ref(false);
const dismissed = ref(false);
let hideTimer: AcuTimerHandle | undefined;

const view = computed(() => deriveWorldSimulationProgressView_ACU(runtime.entries.value, runtime.running.value));
const cardVisible = computed(() => view.value.visible && !dismissed.value);

function clearHideTimer(): void {
  if (hideTimer === undefined) return;
  acuClearTimeout(hideTimer);
  hideTimer = undefined;
}

onMounted(() => {
  const doc = getAcuHostDocument();
  portalTarget.value = doc.body;
  collapsed.value = (doc.defaultView?.innerWidth ?? 0) > 0 && (doc.defaultView?.innerWidth ?? 0) <= NARROW_COLLAPSE_PX;
  runtime.refresh();
});

onBeforeUnmount(() => {
  clearHideTimer();
});

watch(useChatChangedTick(), () => {
  runtime.refresh();
});

watch(
  () => [view.value.terminal, runtime.running.value] as const,
  ([terminal, running]) => {
    clearHideTimer();
    if (running) {
      dismissed.value = false;
      return;
    }
    if (!terminal) {
      dismissed.value = false;
      return;
    }
    hideTimer = acuSetTimeout(() => {
      dismissed.value = true;
      hideTimer = undefined;
    }, TERMINAL_HOLD_MS);
  },
);
</script>

<style scoped>
.acu-world-sim-progress {
  position: fixed;
  right: max(16px, var(--acu-safe-right, 0px));
  bottom: max(88px, calc(var(--acu-safe-bottom, 0px) + 72px));
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: min(280px, calc(100vw - 32px));
  padding: 10px 12px 10px 10px;
  border: 1px solid color-mix(in srgb, var(--acu-border, #3a4150) 80%, transparent);
  border-radius: 18px;
  background: color-mix(in srgb, var(--acu-bg-1, #161b22) 92%, transparent);
  box-shadow: 0 10px 28px color-mix(in srgb, #000 42%, transparent);
  color: var(--acu-text-1, #e8edf5);
  font-family: var(--acu-font-ui, inherit);
  pointer-events: auto;
}

.acu-world-sim-progress.is-collapsed {
  padding: 8px;
  border-radius: 999px;
}

.acu-world-sim-progress.is-terminal {
  border-color: color-mix(in srgb, var(--acu-success, #4fa36c) 45%, transparent);
}

.acu-world-sim-progress__dot {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--acu-primary, #5b8def) 18%, transparent);
  cursor: pointer;
}

.acu-world-sim-progress__pulse {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--acu-primary, #5b8def);
  animation: acu-world-sim-progress-pulse 1.2s ease-in-out infinite;
}

.acu-world-sim-progress.is-terminal .acu-world-sim-progress__pulse {
  background: var(--acu-success, #4fa36c);
  animation: none;
}

.acu-world-sim-progress__body {
  min-width: 0;
}

.acu-world-sim-progress__kicker {
  margin: 0;
  color: var(--acu-text-3, #8b95a7);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.acu-world-sim-progress__label {
  margin: 2px 0 0;
  color: var(--acu-text-1, #e8edf5);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@keyframes acu-world-sim-progress-pulse {
  0%, 100% { opacity: 0.35; transform: scale(0.92); }
  50% { opacity: 1; transform: scale(1); }
}

@media (max-width: 640px) {
  .acu-world-sim-progress {
    right: 12px;
    bottom: max(76px, calc(var(--acu-safe-bottom, 0px) + 64px));
  }
}
</style>
