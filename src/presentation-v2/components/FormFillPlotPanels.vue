<template>
  <AcuPanel
    id="fill-mode-plot-worldbook-panel"
    class="acu-v2-fill-mode-plot"
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

<script setup lang="ts">
/**
 * 填表模式页的剧情推进世界书面板（通栏）。
 * 启用开关在填表模式面板内，剧情推进预设由页面直接挂载在右栏。
 */
import { computed, onMounted, ref, watch } from 'vue';
import AcuPanel from './_lib/AcuPanel.vue';
import WorldbookEntryPickerBody from './WorldbookEntryPickerBody.vue';
import { useWorldbookSelector } from '../composables/useWorldbookSelector';
import { usePlotWorldbookConfig } from '../composables/usePlotWorldbookConfig';
import { usePlotWorldbookEntries } from '../composables/usePlotWorldbookEntries';
import { useChatChangedTick } from '../composables/useChatChangedListener';
import { fillModeCopy } from '../copy/fill-mode-copy';
import { plotCopy } from '../copy/plot-copy';

type WorldbookSource = 'character' | 'manual';

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
  plotWorldbook.refreshFromSettings();
  await worldbook.refresh();
  await refreshWorldbookEntries();
}

onMounted(() => { void refreshAll(); });
watch(useChatChangedTick(), () => { void refreshAll(); });
</script>
