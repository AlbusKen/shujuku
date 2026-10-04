<template>
  <section class="acu-v2-plot-page">
    <p v-if="!supportsPlot" class="acu-v2-plot-page__empty" role="status">
      {{ plotCopy.unsupported(currentModeLabel) }}
    </p>
    <template v-else>
      <AcuMobilePanelNav :items="panelNavItems" />
      <AcuPanelGrid :columns="2">
        <AcuPanel id="plot-settings-panel" :title="plotCopy.controls.title" :description="plotCopy.controls.description">
          <AcuFormRow :label="plotCopy.controls.enableLabel" :hint="plotCopy.controls.enableHint">
            <AcuToggle :model-value="plotStore.enabled" :aria-label="plotCopy.controls.enableLabel"
              data-acu-plot-enabled-toggle="1" @update:model-value="plotStore.setEnabled($event)" />
          </AcuFormRow>
          <AcuFormRow :label="plotCopy.controls.disguiseDisabledLabel" :hint="plotCopy.controls.disguiseDisabledHint">
            <AcuToggle :model-value="plotStore.sendDisguiseDisabled" :aria-label="plotCopy.controls.disguiseDisabledLabel"
              data-acu-plot-disguise-disabled-toggle="1" @update:model-value="plotStore.setSendDisguiseDisabled($event)" />
          </AcuFormRow>
        </AcuPanel>
        <PlotPresetPanel id="plot-preset-panel" />
      </AcuPanelGrid>
      <FormFillPlotPanels />
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue';
import { subscribeChatConfigurationChanges_ACU } from '../../shared/chat-configuration-change';
import AcuMobilePanelNav from '../components/_lib/AcuMobilePanelNav.vue';
import AcuPanelGrid from '../components/_lib/AcuPanelGrid.vue';
import AcuPanel from '../components/_lib/AcuPanel.vue';
import AcuFormRow from '../components/_lib/AcuFormRow.vue';
import AcuToggle from '../components/_lib/AcuToggle.vue';
import PlotPresetPanel from '../components/PlotPresetPanel.vue';
import FormFillPlotPanels from '../components/FormFillPlotPanels.vue';
import { useChatChangedTick, useChatMutationTick } from '../composables/useChatChangedListener';
import { useFormFillModeStore } from '../stores/form-fill-mode-store';
import { usePlotPresetStore } from '../stores/plot-preset-store';
import { FILL_MODE_INTROS } from '../copy/fill-mode-copy';
import { plotCopy } from '../copy/plot-copy';

const modeStore = useFormFillModeStore();
const plotStore = usePlotPresetStore();
const supportsPlot = computed(() => modeStore.selectedMode === 'llm' || modeStore.selectedMode === 'crossfire');
const currentModeLabel = computed(() => FILL_MODE_INTROS[modeStore.selectedMode].label);
const panelNavItems = [
  { id: 'plot-settings-panel', label: plotCopy.nav.settings },
  { id: 'plot-preset-panel', label: plotCopy.nav.preset },
  { id: 'fill-mode-plot-worldbook-panel', label: plotCopy.nav.worldbook },
];
function refresh(): void {
  modeStore.refresh();
  plotStore.refreshFromSettings();
}
onMounted(refresh);
watch([useChatChangedTick(), useChatMutationTick()], refresh);
onBeforeUnmount(subscribeChatConfigurationChanges_ACU(refresh));
</script>

<style scoped>
.acu-v2-plot-page {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--acu-page-gap, 14px);
}
.acu-v2-plot-page__empty {
  margin: 0;
  color: var(--acu-text-2);
  line-height: 1.55;
}
</style>