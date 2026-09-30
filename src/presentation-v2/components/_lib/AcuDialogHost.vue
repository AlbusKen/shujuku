<template>
  <Teleport v-if="portalTarget" :to="portalTarget">
    <div
      v-if="renderedDialog"
      class="acu-dialog-layer"
      :class="{ 'is-closing': isClosing }"
      role="presentation"
      @click.self="dialog.cancelActive"
    >
      <section
        class="acu-dialog"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        @click.stop
      >
        <header class="acu-dialog__header">
          <h2 :id="titleId">{{ renderedDialog.title }}</h2>
          <AcuBadge
            v-if="renderedDialog.badge"
            :variant="renderedDialog.badge.variant || 'neutral'"
          >
            {{ renderedDialog.badge.label }}
          </AcuBadge>
        </header>

        <p class="acu-dialog__message">{{ renderedDialog.message }}</p>
        <p v-if="renderedDialog.dangerMessage" class="acu-dialog__danger-message">
          {{ renderedDialog.dangerMessage }}
        </p>

        <label v-if="renderedDialog.kind === 'prompt'" class="acu-dialog__field">
          <span>{{ renderedDialog.label }}</span>
          <AcuInput
            v-model="dialog.inputValue"
            autocomplete="off"
            :placeholder="renderedDialog.placeholder"
            @keyup.enter="dialog.submitActive()"
          />
        </label>

        <div
          v-if="renderedDialog.kind === 'multiselect'"
          class="acu-dialog__checklist"
        >
          <AcuCheckbox
            v-for="option in renderedDialog.checkboxOptions || []"
            :key="option.value"
            :model-value="dialog.checkedValues[option.value] === true"
            :disabled="option.disabled"
            @update:model-value="dialog.setCheckedValue(option.value, $event)"
          >
            <span class="acu-dialog__check-option">
              <span class="acu-dialog__check-label">{{ option.label }}</span>
              <span
                v-if="option.description"
                class="acu-dialog__check-description"
              >
                {{ option.description }}
              </span>
            </span>
          </AcuCheckbox>
        </div>

        <footer
          class="acu-dialog__actions"
          :class="{ 'acu-dialog__actions--stacked': isChoiceDialog }"
        >
          <template v-if="isChoiceDialog">
            <AcuButton
              v-for="action in renderedDialog.actions"
              :key="action.value"
              :variant="action.variant || 'default'"
              @click="dialog.submitActive(action.value)"
            >
              {{ action.label }}
            </AcuButton>
            <AcuButton @click="dialog.cancelActive">
              {{ renderedDialog.cancelLabel || "取消" }}
            </AcuButton>
          </template>
          <template v-else>
            <AcuButton v-if="renderedDialog.kind !== 'alert'" @click="dialog.cancelActive">
              {{ renderedDialog.cancelLabel || "取消" }}
            </AcuButton>
            <AcuButton
              :variant="renderedDialog.confirmVariant || 'primary'"
              :disabled="dialog.confirmDisabled"
              @click="dialog.submitActive()"
            >
              {{ dialog.confirmCountdownRemaining > 0
                ? `${renderedDialog.confirmLabel || "确认"}（${dialog.confirmCountdownRemaining}s）`
                : (renderedDialog.confirmLabel || "确认") }}
            </AcuButton>
          </template>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { getAcuHostDocument } from "../../bootstrap/host-document";
import { acuClearTimeout, acuSetTimeout, type AcuTimerHandle } from "../../bootstrap/host-env";
import { useDialogStore, type AcuDialogRequest } from "../../stores/dialog-store";
import AcuBadge from "./AcuBadge.vue";
import AcuButton from "./AcuButton.vue";
import AcuCheckbox from "./AcuCheckbox.vue";
import AcuInput from "./AcuInput.vue";

const DIALOG_LEAVE_MS = 160;
const dialog = useDialogStore();
const titleId = "acu-dialog-title";
const renderedDialog = ref<AcuDialogRequest | null>(null);
const isClosing = ref(false);
const isChoiceDialog = computed(() => renderedDialog.value?.kind === "choice");
const portalTarget = ref<HTMLElement | null>(null);
let closeTimer: AcuTimerHandle | undefined;

onMounted(() => {
  const doc = getAcuHostDocument();
  portalTarget.value = doc.getElementById("acu-app-v2") ?? doc.body;
});

onBeforeUnmount(() => {
  acuClearTimeout(closeTimer);
});

watch(
  () => dialog.active,
  (active) => {
    acuClearTimeout(closeTimer);
    closeTimer = undefined;
    if (active) {
      renderedDialog.value = active;
      isClosing.value = false;
      return;
    }
    if (!renderedDialog.value) return;
    isClosing.value = true;
    closeTimer = acuSetTimeout(() => {
      renderedDialog.value = null;
      isClosing.value = false;
      closeTimer = undefined;
    }, DIALOG_LEAVE_MS);
  },
  { immediate: true },
);
</script>

<style scoped>
.acu-dialog-layer {
  position: fixed;
  inset: 0;
  z-index: 9600;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100vw;
  width: 100dvw;
  height: 100vh;
  height: 100dvh;
  padding:
    calc(var(--acu-dialog-edge-gap, 18px) + var(--acu-safe-top, 0px))
    calc(var(--acu-dialog-edge-gap, 18px) + var(--acu-safe-right, 0px))
    calc(var(--acu-dialog-edge-gap, 18px) + var(--acu-safe-bottom, 0px))
    calc(var(--acu-dialog-edge-gap, 18px) + var(--acu-safe-left, 0px));
  background: rgba(0, 0, 0, 0.52);
  pointer-events: auto;
  animation: acu-dialog-layer-in 0.16s ease-out both;
}

.acu-dialog-layer.is-closing {
  pointer-events: none;
  animation: acu-dialog-layer-out 0.16s ease-in both;
}

.acu-dialog {
  width: min(var(--acu-dialog-width, 440px), 100%);
  max-height: min(var(--acu-dialog-max-height, 560px), calc(100vh - var(--acu-dialog-edge-gap, 18px) - var(--acu-dialog-edge-gap, 18px) - var(--acu-safe-top, 0px) - var(--acu-safe-bottom, 0px)));
  max-height: min(var(--acu-dialog-max-height, 560px), calc(100dvh - var(--acu-dialog-edge-gap, 18px) - var(--acu-dialog-edge-gap, 18px) - var(--acu-safe-top, 0px) - var(--acu-safe-bottom, 0px)));
  display: flex;
  flex-direction: column;
  gap: var(--acu-page-gap, 14px);
  padding: var(--acu-panel-padding, 16px);
  border: 1px solid var(--acu-border);
  border-radius: var(--acu-radius-md);
  background: var(--acu-bg-1);
  color: var(--acu-text-1);
  box-shadow: var(--acu-shadow);
  overflow: auto;
  animation: acu-dialog-panel-in 0.16s ease-out both;
}

.acu-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--acu-panel-gap, 12px);
}

.acu-dialog__header h2 {
  min-width: 0;
  margin: 0;
  color: var(--acu-text-1);
  font-size: var(--acu-font-size-panel-title, 15px);
  line-height: 1.35;
  font-weight: 700;
}

.acu-dialog__message {
  margin: 0;
  color: var(--acu-text-2);
  font-size: var(--acu-font-size-body, 12px);
  line-height: 1.55;
  white-space: pre-wrap;
}

.acu-dialog__danger-message {
  margin: 0;
  padding: var(--acu-space-2, 8px) var(--acu-space-250, 10px);
  border-radius: var(--acu-radius-sm);
  background: color-mix(in srgb, var(--acu-danger) 10%, transparent);
  color: var(--acu-danger);
  font-size: var(--acu-font-size-body, 12px);
  font-weight: 700;
  line-height: 1.55;
  white-space: pre-wrap;
}

.acu-dialog__field {
  display: flex;
  flex-direction: column;
  gap: var(--acu-space-150, 6px);
  color: var(--acu-text-2);
  font-size: var(--acu-font-size-body, 12px);
  line-height: 1.4;
}

.acu-dialog__checklist {
  display: flex;
  flex-direction: column;
  gap: var(--acu-space-250, 10px);
  min-width: 0;
  padding: var(--acu-space-250, 10px);
  border: 1px solid var(--acu-border);
  border-radius: var(--acu-radius-sm);
  background: color-mix(in srgb, var(--acu-bg-2) 74%, transparent);
}

.acu-dialog__checklist :deep(.acu-checkbox) {
  width: 100%;
}

.acu-dialog__check-option {
  display: flex;
  flex-direction: column;
  gap: var(--acu-space-050, 2px);
  min-width: 0;
}

.acu-dialog__check-label {
  color: var(--acu-text-1);
  font-weight: 600;
}

.acu-dialog__check-description {
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-caption, 11px);
  line-height: 1.45;
}

.acu-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--acu-space-2, 8px);
  flex-wrap: wrap;
  padding-top: var(--acu-space-050, 2px);
}

.acu-dialog__actions--stacked :deep(.acu-btn) {
  flex: 1 1 var(--acu-dialog-choice-min-width, 128px);
}

.acu-dialog-layer.is-closing .acu-dialog {
  animation: acu-dialog-panel-out 0.16s ease-in both;
}

@keyframes acu-dialog-layer-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes acu-dialog-layer-out {
  from { opacity: 1; }
  to { opacity: 0; }
}

@keyframes acu-dialog-panel-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes acu-dialog-panel-out {
  from {
    opacity: 1;
    transform: translateY(0);
  }
  to {
    opacity: 0;
    transform: translateY(6px);
  }
}

@media (max-width: 520px) {
  .acu-dialog-layer {
    align-items: flex-end;
    padding:
      calc(var(--acu-dialog-edge-gap-compact, 12px) + var(--acu-safe-top, 0px))
      calc(var(--acu-dialog-edge-gap-compact, 12px) + var(--acu-safe-right, 0px))
      calc(var(--acu-dialog-edge-gap-compact, 12px) + var(--acu-safe-bottom, 0px))
      calc(var(--acu-dialog-edge-gap-compact, 12px) + var(--acu-safe-left, 0px));
  }

  .acu-dialog {
    width: 100%;
    max-height: calc(100vh - var(--acu-dialog-edge-gap-compact, 12px) - var(--acu-dialog-edge-gap-compact, 12px) - var(--acu-safe-top, 0px) - var(--acu-safe-bottom, 0px));
    max-height: calc(100dvh - var(--acu-dialog-edge-gap-compact, 12px) - var(--acu-dialog-edge-gap-compact, 12px) - var(--acu-safe-top, 0px) - var(--acu-safe-bottom, 0px));
  }

  .acu-dialog__actions,
  .acu-dialog__actions--stacked {
    display: grid;
    grid-template-columns: 1fr;
  }
}
</style>
