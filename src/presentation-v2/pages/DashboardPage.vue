<template>
  <section class="acu-v2-dashboard-page">
    <AcuPanelGrid class="acu-v2-dashboard-page__grid">
      <AcuPanel
        :title="dashboardCopy.panels.healthTitle"
        :description="dashboardCopy.panels.healthDescription"
      >
        <div class="acu-v2-dashboard-page__health-list">
          <article
            v-for="item in dashboard.healthItems.value"
            :key="item.key"
            class="acu-v2-dashboard-page__health-item"
            :class="`acu-v2-dashboard-page__health-item--${item.kind}`"
          >
            <div class="acu-v2-dashboard-page__health-icon" aria-hidden="true">
              <i :class="item.iconClass"></i>
            </div>
            <div class="acu-v2-dashboard-page__health-body">
              <div class="acu-v2-dashboard-page__health-heading">
                <strong>{{ item.title }}</strong>
              </div>
              <p>{{ item.summary }}</p>
            </div>
            <div class="acu-v2-dashboard-page__health-side">
              <AcuBadge :variant="item.badgeVariant">{{
                item.badge
              }}</AcuBadge>
              <AcuButton
                v-if="item.action"
                class="acu-v2-dashboard-page__health-action"
                size="sm"
                @click="goToHealthAction(item.action.pageId)"
              >
                <i class="fa-solid fa-arrow-right"></i>
                {{ item.action.label }}
              </AcuButton>
            </div>
          </article>
        </div>
      </AcuPanel>

      <AcuPanel
        :title="dashboardCopy.panels.togglesTitle"
        :description="dashboardCopy.panels.togglesDescription"
      >
        <AcuSegmentedControl
          v-model="activeGroup"
          :options="groupOptions"
          :aria-label="dashboardCopy.groups.ariaLabel"
          size="sm"
        />

        <div
          class="acu-v2-dashboard-page__toggle-list"
          :data-acu-toggle-group="activeGroup"
        >
          <template v-if="activeGroup === 'basic'">
            <ToggleRow
              v-for="item in dashboard.basicToggles.value"
              :key="item.key"
              :item="item"
              @change="handleToggleChange(item.key, $event)"
            />
          </template>

          <template v-else>
            <ToggleRow
              v-for="item in dashboard.advancedToggles.value"
              :key="item.key"
              :item="item"
              @change="handleToggleChange(item.key, $event)"
            />

            <DashboardStorageModeSection
              :model-value="dashboard.storageMode.value"
              :options="dashboard.storageOptions"
              @update:model-value="handleStorageModeChange"
            />
            <AcuMessage
              v-if="dashboard.storageMessage.value"
              :kind="dashboard.storageMessage.value.kind"
            >
              {{ dashboard.storageMessage.value.text }}
            </AcuMessage>
          </template>
        </div>
      </AcuPanel>
    </AcuPanelGrid>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import AcuBadge from "../components/_lib/AcuBadge.vue";
import AcuButton from "../components/_lib/AcuButton.vue";
import AcuMessage from "../components/_lib/AcuMessage.vue";
import AcuPanel from "../components/_lib/AcuPanel.vue";
import AcuPanelGrid from "../components/_lib/AcuPanelGrid.vue";
import AcuSegmentedControl from "../components/_lib/AcuSegmentedControl.vue";
import DashboardStorageModeSection from "../components/DashboardStorageModeSection.vue";
import ToggleRow from "../components/DashboardToggleRow.vue";
import { useChatChangedTick } from "../composables/useChatChangedListener";
import { useTemplateRuntimeChangeTick } from "../composables/useTemplateRuntimeChangeListener";
import { useDashboardPage } from "../composables/useDashboardPage";
import {
  FEATURE_GATE_CONTENT_REPLACE,
  FEATURE_GATE_CONTINUATION,
  FEATURE_GATE_WORLD_SIMULATION,
  FEATURE_GATE_IMPORT,
  FEATURE_GATE_PLOT,
  FEATURE_GATE_VECTOR_INDEX,
} from "../router/page-registry";
import { dashboardCopy } from "../copy/dashboard-copy";
import { useDialogStore } from "../stores/dialog-store";
import { usePlotPresetStore } from "../stores/plot-preset-store";
import { useRouterStore } from "../stores/router-store";
import { useToastStore } from "../stores/toast-store";

const dashboard = useDashboardPage();
const plotStore = usePlotPresetStore();
const routerStore = useRouterStore();
const dialogStore = useDialogStore();
const toastStore = useToastStore();

const activeGroup = ref<"basic" | "advanced">("basic");
const groupOptions = [
  { value: "basic", label: dashboardCopy.groups.basic },
  { value: "advanced", label: dashboardCopy.groups.advanced },
];

async function refreshAll(): Promise<void> {
  plotStore.refreshFromSettings();
  await dashboard.refresh();
  routerStore.setSqliteMode(dashboard.storageMode.value === "sqlite");
  syncFeaturePageGates();
}

function syncFeaturePageGates(): void {
  routerStore.syncFeatureGate(
    FEATURE_GATE_CONTENT_REPLACE,
    dashboard.contentReplaceGateEnabled.value,
  );
  routerStore.syncFeatureGate(FEATURE_GATE_PLOT, plotStore.enabled === true);
  routerStore.syncFeatureGate(
    FEATURE_GATE_CONTINUATION,
    dashboard.advancedToggles.value.some(
      (item) => item.key === "continuationPageEnabled" && item.value,
    ),
  );
  routerStore.syncFeatureGate(
    FEATURE_GATE_WORLD_SIMULATION,
    dashboard.advancedToggles.value.some(
      (item) => item.key === "worldSimulationPageEnabled" && item.value,
    ),
  );
  routerStore.syncFeatureGate(
    FEATURE_GATE_IMPORT,
    dashboard.advancedToggles.value.some(
      (item) => item.key === "externalImportPageEnabled" && item.value,
    ),
  );
  routerStore.syncFeatureGate(
    FEATURE_GATE_VECTOR_INDEX,
    dashboard.advancedToggles.value.some(
      (item) => item.key === "summaryVectorIndexModeEnabled" && item.value,
    ),
  );
}

function goToHealthAction(pageId: string): void {
  routerStore.setActivePage(pageId);
}

async function handleToggleChange(key: string, value: boolean): Promise<void> {
  if (key === "flightMode") {
    if (!value) {
      const confirmed = await dialogStore.confirm({
        title: dashboardCopy.toggles.flightMode.disableTitle,
        message: dashboardCopy.toggles.flightMode.disableMessage,
        dangerMessage: dashboardCopy.toggles.flightMode.disableDanger,
        confirmLabel: dashboardCopy.toggles.flightMode.confirmDisable,
        confirmVariant: "danger",
      });
      if (!confirmed) return;
    }
    const result = await dashboard.setFlightMode(value);
    if (result.ok) {
      toastStore.success(
        value
          ? dashboardCopy.toggles.flightMode.enabled
          : dashboardCopy.toggles.flightMode.disabled,
        { muteable: false },
      );
      return;
    }
    if (result.reason === "template_scope_changed") {
      const confirmed = await dialogStore.confirm({
        title: dashboardCopy.toggles.flightMode.templateScopeChangedTitle,
        message: dashboardCopy.toggles.flightMode.templateScopeChangedMessage,
        dangerMessage: dashboardCopy.toggles.flightMode.templateScopeChangedDanger,
        confirmLabel: dashboardCopy.toggles.flightMode.confirmDisableLabel,
        confirmVariant: "danger",
      });
      if (!confirmed) return;
      const confirmedResult = await dashboard.setFlightMode(false, {
        confirmTemplateScopeChange: true,
      });
      if (confirmedResult.ok) {
        toastStore.success(dashboardCopy.toggles.flightMode.disabled, { muteable: false });
      } else {
        toastStore.error(confirmedResult.error || dashboardCopy.toggles.flightMode.disableFailed, { muteable: false });
      }
      return;
    }
    if (result.reason === "too_many_visible_chronicle_rows") {
      toastStore.error(`飞行模式未开启：当前有 ${result.visibleChronicleRowCount ?? 0} 条可见纪要，最多允许 15 条。`, { muteable: false });
      return;
    }
    toastStore.error(result.error || (value ? dashboardCopy.toggles.flightMode.enableFailed : dashboardCopy.toggles.flightMode.disableFailed), { muteable: false });
    return;
  }
  dashboard.setToggle(key, value);
  if (key === "plotEnabled") plotStore.refreshFromSettings();
  syncFeaturePageGates();
}

async function handleStorageModeChange(value: string): Promise<void> {
  await dashboard.setStorageMode(value);
  routerStore.setSqliteMode(dashboard.storageMode.value === "sqlite");
}

onMounted(() => {
  void refreshAll();
});
watch(useChatChangedTick(), () => {
  void refreshAll();
});
watch(useTemplateRuntimeChangeTick(), () => {
  void refreshAll();
});
</script>

<style scoped>
.acu-v2-dashboard-page {
  min-height: 100%;
  min-width: 0;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.acu-v2-dashboard-page__toggle-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 14px;
}

.acu-v2-dashboard-page__health-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.acu-v2-dashboard-page__health-item {
  min-width: 0;
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) max-content;
  column-gap: 10px;
  row-gap: 8px;
  align-items: center;
  padding: 10px;
  border: 1px solid var(--acu-border);
  border-radius: var(--acu-radius-md);
  background: var(--acu-bg-1);
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.acu-v2-dashboard-page__health-item--error {
  border-color: color-mix(in srgb, var(--acu-danger) 38%, var(--acu-border));
}

.acu-v2-dashboard-page__health-icon {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--acu-radius-sm);
  background: var(--acu-bg-2);
  color: var(--acu-text-2);
}

.acu-v2-dashboard-page__health-item--ok .acu-v2-dashboard-page__health-icon {
  color: var(--acu-success);
  background: color-mix(in srgb, var(--acu-success) 10%, transparent);
}

.acu-v2-dashboard-page__health-item--warning
  .acu-v2-dashboard-page__health-icon {
  color: var(--acu-warning);
  background: color-mix(in srgb, var(--acu-warning) 12%, transparent);
}

.acu-v2-dashboard-page__health-item--error .acu-v2-dashboard-page__health-icon {
  color: var(--acu-danger);
  background: color-mix(in srgb, var(--acu-danger) 12%, transparent);
}

.acu-v2-dashboard-page__health-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.acu-v2-dashboard-page__health-heading {
  min-width: 0;
}

.acu-v2-dashboard-page__health-heading strong {
  min-width: 0;
  color: var(--acu-text-1);
  font-size: var(--acu-font-size-body-lg, 13px);
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acu-v2-dashboard-page__health-body p {
  margin: 0;
  color: var(--acu-text-2);
  font-size: var(--acu-font-size-body, 12px);
  line-height: 1.55;
}

.acu-v2-dashboard-page__health-side {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  justify-self: end;
}

.acu-v2-dashboard-page__health-action {
  white-space: nowrap;
}

@media (max-width: 860px) {
  .acu-v2-dashboard-page {
    padding: 14px;
  }

  .acu-v2-dashboard-page__health-item {
    grid-template-columns: 30px minmax(0, 1fr);
    align-items: center;
  }

  .acu-v2-dashboard-page__health-side {
    grid-column: 2;
    align-items: flex-start;
    justify-self: start;
    flex-direction: row;
    flex-wrap: wrap;
  }

  .acu-v2-dashboard-page__health-action {
    justify-self: start;
  }
}
</style>
