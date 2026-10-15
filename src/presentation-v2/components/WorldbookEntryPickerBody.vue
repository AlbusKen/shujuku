<template>
  <div class="acu-v2-wb-entry-picker">
    <WorldbookSourcePicker
      :source="source"
      :selected-names="selectedNames"
      :names="names"
      :status="selectorStatus"
      :error="selectorError"
      :filterable="filterable"
      @retry="$emit('retry')"
      @update:source="$emit('update:source', $event)"
      @toggle-book="(name: string, checked: boolean) => $emit('toggle-book', name, checked)"
    />
    <p class="acu-v2-wb-entry-picker__hint">
      目前已选: <strong>{{ currentLabel }}</strong>
    </p>

    <WorldbookEntryToolbar
      :filter="filter"
      :show-skillify-controls="false"
      @update:filter="$emit('update:filter', $event)"
      @select-all="$emit('select-all')"
      @deselect-all="$emit('deselect-all')"

    />
    <WorldbookEntryList
      :groups="groups"
      :filter="filter"
      :loading="loading"
      :status="entryStatus"
      :error="entryError"
      :empty-text="emptyText"
      :show-skillify-controls="false"
      :show-agent-takeover-state="false"
      :show-skill-editor="false"
      @toggle="(bookName: string, uid: number, checked: boolean) => $emit('toggle', bookName, uid, checked)"
      @toggle-group="$emit('toggle-group', $event)"
    />

  </div>
</template>

<script setup lang="ts">
import WorldbookSourcePicker from './WorldbookSourcePicker.vue';
import WorldbookEntryList from './WorldbookEntryList.vue';
import WorldbookEntryToolbar from './WorldbookEntryToolbar.vue';
import type { WorldbookLoadStatus } from '../composables/useWorldbookSelector';
import type { EntryLoadStatus } from '../composables/usePlotWorldbookEntries';
import type { WorldbookEntryDisplayGroup_ACU } from '../composables/worldbook-entry-display';

type WorldbookSource = 'character' | 'manual';

withDefaults(defineProps<{
  source: WorldbookSource;
  selectedNames: string[];
  names: string[];
  selectorStatus: WorldbookLoadStatus;
  selectorError: string;
  currentLabel: string;
  filter: string;
  groups: WorldbookEntryDisplayGroup_ACU[];
  loading: boolean;
  entryStatus?: EntryLoadStatus;
  entryError?: string;
  emptyText?: string;
  filterable?: boolean;
}>(), {
  filterable: true,
  emptyText: '所选世界书中无可显示的条目。',
  entryStatus: 'success',
  entryError: '',
});

defineEmits<{
  (e: 'update:source', value: WorldbookSource): void;
  (e: 'retry'): void;
  (e: 'toggle-book', name: string, checked: boolean): void;
  (e: 'update:filter', value: string): void;
  (e: 'select-all'): void;
  (e: 'deselect-all'): void;
  (e: 'toggle', bookName: string, uid: number, checked: boolean): void;
  (e: 'toggle-group', bookName: string): void;
}>();
</script>

<style scoped>
.acu-v2-wb-entry-picker {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.acu-v2-wb-entry-picker__hint {
  margin: 0;
  font-size: var(--acu-font-size-caption, 11px);
  color: var(--acu-text-3);
}

.acu-v2-wb-entry-picker__hint strong {
  color: var(--acu-text-1);
  font-weight: 500;
}


</style>
