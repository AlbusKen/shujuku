<template>
  <div class="acu-v2-fill-mode-plot">
    <AcuPanel
      id="fill-mode-plot-panel"
      :title="fillModeCopy.panels.plot.title"
      :description="fillModeCopy.panels.plot.description"
    >
      <AcuFormRow
        :label="fillModeCopy.panels.plot.enableLabel"
        :hint="fillModeCopy.panels.plot.enableHint"
      >
        <AcuToggle
          :model-value="plotStore.enabled"
          data-acu-plot-enabled-toggle="1"
          @update:model-value="plotStore.setEnabled($event)"
        />
      </AcuFormRow>
    </AcuPanel>

    <template v-if="plotStore.enabled">
      <PlotPresetPanel />

      <AcuPanel
        id="fill-mode-plot-worldbook-panel"
        :title="fillModeCopy.panels.worldbook.title"
        :description="fillModeCopy.panels.worldbook.description"
      >
        <WorldbookEntryPickerBody
          :source="plotWorldbook.source.value"
          :selected-names="plotWorldbook.manualSelection.value"
          :names="worldbook.names.value"
          :selector-status="worldbook.status.value"
          :selector-error="worldbook.error.value"
          :current-label="currentWorldbookLabel"
          v-model:filter="entryFilter"
          :groups="wbEntries.groups.value"
          :loading="wbEntries.status.value === 'loading'"
          :entry-status="wbEntries.status.value"
          :entry-error="wbEntries.error.value"
          :empty-text="entryEmptyText"
          @update:source="onWorldbookSourceChange($event)"
          @toggle-book="onManualWorldbookToggle"
          @select-all="wbEntries.selectAll()"
          @deselect-all="wbEntries.deselectAll()"
          @toggle="(bookName: string, uid: number, checked: boolean) => wbEntries.toggleEntry(bookName, uid, checked)"
          @toggle-group="wbEntries.toggleGroupExpanded($event)"
        />
      </AcuPanel>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import AcuFormRow from './_lib/AcuFormRow.vue';
import AcuPanel from './_lib/AcuPanel.vue';
import AcuToggle from './_lib/AcuToggle.vue';
import PlotPresetPanel from './PlotPresetPanel.vue';
import WorldbookEntryPickerBody from './WorldbookEntryPickerBody.vue';
import { useWorldbookSelector } from '../composables/useWorldbookSelector';
import { usePlotWorldbookConfig } from '../composables/usePlotWorldbookConfig';
import { usePlotWorldbookEntries } from '../composables/usePlotWorldbookEntries';
import { useChatChangedTick } from '../composables/useChatChangedListener';
import { fillModeCopy } from '../copy/fill-mode-copy';
import { plotCopy } from '../copy/plot-copy';
import { usePlotPresetStore } from '../stores/plot-preset-store';

type WorldbookSource = 'character' | 'manual';

const plotStore = usePlotPresetStore();
const worldbook = useWorldbookSelector();
const plotWorldbook = usePlotWorldbookConfig();
const wbEntries = usePlotWorldbookEntries();
const entryFilter = ref('');
const entryEmptyText = ref(plotCopy.worldbook.emptyDefault);

async function refreshWorldbookEntries(): Promise<void> {
  let names: string[];
  try {
    names = await plotWorldbook.resolveBookNames();
  } catch {
    wbEntries.reportLoadFailure();
    return;
  }
  entryEmptyText.value = resolveEntryEmptyText(names);
  await wbEntries.loadEntries(names);
}

function resolveEntryEmptyText(names: string[]): string {
  if (plotWorldbook.source.value === 'character' && names.length === 0) {
    return plotCopy.worldbook.emptyCharacter;
  }
  if (plotWorldbook.source.value === 'manual' && plotWorldbook.manualSelection.value.length === 0) {
    return plotCopy.worldbook.emptyManual;
  }
  return plotCopy.worldbook.emptyDefault;
}

function onWorldbookSourceChange(value: WorldbookSource): void {
  plotWorldbook.setSource(value);
  void refreshWorldbookEntries();
}

function onManualWorldbookToggle(name: string, checked: boolean): void {
  plotWorldbook.toggleManualBook(name, checked);
  void refreshWorldbookEntries();
}

const currentWorldbookLabel = computed<string>(() => {
  if (plotWorldbook.source.value === 'character') {
    return worldbook.charPrimary.value
      ? `角色卡所有世界书 · 主册 ${worldbook.charPrimary.value}`
      : '角色卡所有世界书';
  }
  const names = plotWorldbook.manualSelection.value;
  return names.length ? names.join('、') : '（未选择）';
});

async function refreshAll(): Promise<void> {
  plotStore.refreshFromSettings();
  plotWorldbook.refreshFromSettings();
  await worldbook.refresh();
  await refreshWorldbookEntries();
}

onMounted(() => { void refreshAll(); });
watch(useChatChangedTick(), () => { void refreshAll(); });
</script>

<style scoped>
.acu-v2-fill-mode-plot {
  min-width: 0;
  display: contents;
}
</style>
