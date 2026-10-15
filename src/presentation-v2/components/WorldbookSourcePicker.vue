<template>
  <div class="acu-v2-wb-source-picker">
    <AcuFormRow label="来源">
      <AcuSegmentedControl
        :model-value="source"
        :options="sourceOptions"
        aria-label="世界书来源"
        @update:model-value="onSourceChange"
      />
    </AcuFormRow>

    <template v-if="source === 'manual'">
      <AcuFormRow v-if="filterable" label="筛选">
        <AcuInput v-model="filter" type="text" placeholder="筛选世界书..." />
      </AcuFormRow>

      <div
        class="acu-v2-wb-source-picker__list"
        :class="{ 'acu-v2-wb-source-picker__list--disabled': status === 'loading' }"
      >
        <button
          v-for="name in filteredNames"
          :key="name"
          type="button"
          class="acu-v2-wb-source-picker__item"
          :class="{ 'acu-v2-wb-source-picker__item--selected': selectedSet.has(name) }"
          role="checkbox"
          :aria-checked="selectedSet.has(name) ? 'true' : 'false'"
          :disabled="status === 'loading'"
          @click="$emit('toggle-book', name, !selectedSet.has(name))"
        >
          <span class="acu-v2-wb-source-picker__item-label">{{ name }}</span>
          <i
            class="fa-solid fa-check acu-v2-wb-source-picker__item-check"
            aria-hidden="true"
          ></i>
        </button>
        <div v-if="!filteredNames.length && status !== 'error'" class="acu-v2-wb-source-picker__empty">
          {{ status === 'loading' ? '正在加载世界书...' : '无可选世界书' }}
        </div>
      </div>
    </template>

    <AcuText v-if="status === 'error'" variant="error" class="acu-v2-wb-source-picker__error">
      {{ error || '加载失败' }}
    </AcuText>
    <AcuButton v-if="status === 'error'" size="sm" @click="$emit('retry')">重试加载世界书</AcuButton>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import AcuFormRow from './_lib/AcuFormRow.vue';
import AcuInput from './_lib/AcuInput.vue';
import AcuSegmentedControl, { type AcuSegmentedOption } from './_lib/AcuSegmentedControl.vue';
import AcuText from './_lib/AcuText.vue';
import AcuButton from './_lib/AcuButton.vue';
import type { WorldbookLoadStatus } from '../composables/useWorldbookSelector';

type WorldbookSource = 'character' | 'manual';

const props = withDefaults(defineProps<{
  source: WorldbookSource;
  selectedNames: string[];
  names: string[];
  status: WorldbookLoadStatus;
  error: string;
  filterable?: boolean;
}>(), {
  filterable: true,
});

const emit = defineEmits<{
  (e: 'update:source', value: WorldbookSource): void;
  (e: 'toggle-book', name: string, checked: boolean): void;
  (e: 'retry'): void;
}>();

const filter = ref('');

const sourceOptions: AcuSegmentedOption[] = [
  { value: 'character', label: '跟随角色卡' },
  { value: 'manual', label: '手动选择' },
];

const selectedSet = computed(() => new Set(props.selectedNames.filter(Boolean)));

const filteredNames = computed<string[]>(() => {
  const f = filter.value.trim().toLowerCase();
  if (!f) return props.names;
  return props.names.filter(name => name.toLowerCase().includes(f));
});

function onSourceChange(value: string): void {
  emit('update:source', value === 'manual' ? 'manual' : 'character');
}
</script>

<style scoped>
.acu-v2-wb-source-picker {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.acu-v2-wb-source-picker__list {
  min-width: 0;
  max-height: 180px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border-radius: var(--acu-radius-sm);
  background: var(--acu-bg-2);
}

.acu-v2-wb-source-picker__list--disabled {
  opacity: 0.65;
}

.acu-v2-wb-source-picker__item {
  width: 100%;
  min-width: 0;
  min-height: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 0;
  padding: 7px 9px;
  border: 0;
  border-radius: var(--acu-radius-sm);
  background: transparent;
  color: var(--acu-text-2);
  font: inherit;
  font-size: var(--acu-font-size-body, 12px);
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}

.acu-v2-wb-source-picker__item:hover:not(:disabled) {
  background: var(--acu-hover-overlay);
  color: var(--acu-text-1);
}

.acu-v2-wb-source-picker__item:disabled {
  cursor: not-allowed;
}

.acu-v2-wb-source-picker__item:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--acu-accent-glow);
}

.acu-v2-wb-source-picker__item--selected {
  background: color-mix(in srgb, var(--acu-accent) 14%, transparent);
  color: var(--acu-text-1);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--acu-accent) 42%, transparent);
}

.acu-v2-wb-source-picker__item--selected:hover:not(:disabled) {
  background: color-mix(in srgb, var(--acu-accent) 20%, transparent);
  color: var(--acu-text-1);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--acu-accent) 54%, transparent);
}

.acu-v2-wb-source-picker__item-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acu-v2-wb-source-picker__item-check {
  flex-shrink: 0;
  font-size: var(--acu-font-size-caption, 11px);
  color: var(--acu-accent);
  opacity: 0;
  transform: scale(0.86);
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.acu-v2-wb-source-picker__item--selected .acu-v2-wb-source-picker__item-check {
  opacity: 1;
  transform: scale(1);
}

.acu-v2-wb-source-picker__empty {
  padding: 8px 2px;
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-body, 12px);
  text-align: center;
}

.acu-v2-wb-source-picker__error {
  margin: 0;
}
</style>
