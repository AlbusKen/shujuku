<template>
  <div class="acu-v2-wb-selector">
    <AcuFormRow v-if="filterable" label="筛选">
      <AcuInput v-model="filter" type="text" placeholder="筛选世界书..." />
    </AcuFormRow>
    <AcuFormRow label="目标世界书">
      <AcuSelect
        :options="worldbookOptions"
        :model-value="modelValue"
        :disabled="status === 'loading'"
        placeholder="未选择"
        @update:model-value="$emit('update:modelValue', $event)"
      />
    </AcuFormRow>
    <AcuText v-if="status === 'error'" variant="error" class="acu-v2-wb-selector__error">{{ error || '加载失败' }}</AcuText>
    <AcuButton v-if="status === 'error'" size="sm" @click="$emit('retry')">重试加载世界书</AcuButton>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import AcuFormRow from './_lib/AcuFormRow.vue';
import AcuInput from './_lib/AcuInput.vue';
import AcuSelect from './_lib/AcuSelect.vue';
import type { AcuSelectOption } from './_lib/AcuSelect.vue';
import AcuText from './_lib/AcuText.vue';
import AcuButton from './_lib/AcuButton.vue';
import type { WorldbookLoadStatus } from '../composables/useWorldbookSelector';

const props = defineProps<{
  modelValue: string;
  names: string[];
  charPrimary: string | null;
  status: WorldbookLoadStatus;
  error: string;
  filterable?: boolean;
  showCharacterOption?: boolean;
  characterOptionLabel?: string;
  characterFallbackLabel?: string;
}>();

defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'retry'): void;
}>();

const filter = ref('');

const filteredNames = computed<string[]>(() => {
  const list = props.names;
  const f = filter.value.trim().toLowerCase();
  if (!f) return list;
  return list.filter(name => name.toLowerCase().includes(f));
});

const worldbookOptions = computed<AcuSelectOption[]>(() => {
  const result: AcuSelectOption[] = [];
  if (props.charPrimary || props.showCharacterOption) {
    const label = props.characterOptionLabel
      || (props.charPrimary ? `当前角色卡主世界书 · ${props.charPrimary}` : props.characterFallbackLabel || '当前角色卡主世界书');
    result.push({ value: 'character', label });
  }
  for (const name of filteredNames.value) {
    result.push({ value: name, label: name });
  }
  return result;
});
</script>

<style scoped>
.acu-v2-wb-selector { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
</style>
