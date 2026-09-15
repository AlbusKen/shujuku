<template>
  <div class="acu-prompt-segs">
    <div class="acu-prompt-segs__add">
      <AcuButton size="sm" class="acu-prompt-segs__add-btn" @click="$emit('add', 'top')">
        <i class="fa-solid fa-plus"></i> 在最上方插入
      </AcuButton>
    </div>
    <ol class="acu-prompt-segs__list">
      <li v-for="(seg, index) in segments" :key="index" class="acu-prompt-segs__item">
        <header class="acu-prompt-segs__item-head">
          <span class="acu-prompt-segs__index">#{{ index + 1 }}</span>
          <AcuCheckbox
            v-if="showEnabled"
            :model-value="seg.enabled !== false"
            label="启用"
            :disabled="lockUndeletable && seg.deletable === false"
            @update:model-value="$emit('update', index, { enabled: $event })"
          />
          <AcuSelect
            class="acu-prompt-segs__role"
            size="sm"
            :options="roleOptions"
            :model-value="seg.role"
            :disabled="lockUndeletable && seg.deletable === false"
            @update:model-value="$emit('update', index, { role: $event })"
          />
          <AcuSelect
            v-if="showSlot"
            class="acu-prompt-segs__slot"
            size="sm"
            :options="slotOptions"
            :model-value="seg.mainSlot || ''"
            title="主插槽 A=主提示词；B=拦截任务详细指令"
            @update:model-value="onSlot(index, $event)"
          />
          <div class="acu-prompt-segs__actions">
            <template v-if="allowMove">
              <AcuIconButton
                icon="fa-solid fa-arrow-up"
                size="sm"
                :disabled="index === 0 || isMoveLocked(index, -1)"
                :title="index === 0 ? '已经是第一段' : isMoveLocked(index, -1) ? '引擎段顺序不可改变' : '上移该段'"
                @click="$emit('move', index, -1)"
              />
              <AcuIconButton
                icon="fa-solid fa-arrow-down"
                size="sm"
                :disabled="index === segments.length - 1 || isMoveLocked(index, 1)"
                :title="index === segments.length - 1 ? '已经是最后一段' : isMoveLocked(index, 1) ? '引擎段顺序不可改变' : '下移该段'"
                @click="$emit('move', index, 1)"
              />
            </template>
            <AcuIconButton
              icon="fa-solid fa-trash-can"
              variant="danger"
              size="sm"
              :disabled="seg.deletable === false"
              :title="seg.deletable === false ? '该段不可删除' : '删除该段'"
              @click="$emit('delete', index)"
            />
          </div>
        </header>
        <AcuTextarea
          :model-value="seg.content"
          :rows="rows"
          placeholder="提示词内容..."
          @update:model-value="$emit('update', index, { content: $event })"
        />
      </li>
      <li v-if="!segments.length" class="acu-prompt-segs__empty">
        {{ emptyText }}
      </li>
    </ol>
    <div class="acu-prompt-segs__add">
      <AcuButton size="sm" class="acu-prompt-segs__add-btn" @click="$emit('add', 'bottom')">
        <i class="fa-solid fa-plus"></i> 在最下方插入
      </AcuButton>
    </div>
  </div>
</template>

<script lang="ts">
import type { AcuSelectOption } from './AcuSelect.vue';

export interface PromptSegment {
  role: string;
  content: string;
  enabled?: boolean;
  deletable?: boolean;
  mainSlot?: 'A' | 'B' | '';
  isMain?: boolean;
  isMain2?: boolean;
}

const DEFAULT_ROLE_OPTIONS: AcuSelectOption[] = [
  { value: 'SYSTEM', label: 'SYSTEM' },
  { value: 'USER', label: 'USER' },
  { value: 'assistant', label: 'ASSISTANT' },
];

const DEFAULT_SLOT_OPTIONS: AcuSelectOption[] = [
  { value: '', label: '普通段' },
  { value: 'A', label: '主插槽 A' },
  { value: 'B', label: '主插槽 B' },
];
</script>

<script setup lang="ts">
import AcuButton from './AcuButton.vue';
import AcuCheckbox from './AcuCheckbox.vue';
import AcuIconButton from './AcuIconButton.vue';
import AcuSelect from './AcuSelect.vue';
import AcuTextarea from './AcuTextarea.vue';

const props = withDefaults(defineProps<{
  segments: PromptSegment[];
  roleOptions?: AcuSelectOption[];
  slotOptions?: AcuSelectOption[];
  showSlot?: boolean;
  showEnabled?: boolean;
  allowMove?: boolean;
  lockUndeletable?: boolean;
  rows?: number;
  emptyText?: string;
}>(), {
  roleOptions: () => DEFAULT_ROLE_OPTIONS,
  slotOptions: () => DEFAULT_SLOT_OPTIONS,
  showSlot: true,
  showEnabled: false,
  allowMove: false,
  lockUndeletable: false,
  rows: 6,
  emptyText: '暂无提示词段。点击下方按钮添加第一段。',
});

const emit = defineEmits<{
  (e: 'add', position: 'top' | 'bottom'): void;
  (e: 'delete', index: number): void;
  (e: 'move', index: number, delta: -1 | 1): void;
  (e: 'update', index: number, patch: Partial<PromptSegment>): void;
}>();

function isMoveLocked(index: number, delta: -1 | 1): boolean {
  if (!props.lockUndeletable) return false;
  const target = index + delta;
  return props.segments[index]?.deletable === false || props.segments[target]?.deletable === false;
}

function onSlot(index: number, raw: string): void {
  const value = raw === 'A' || raw === 'B' ? raw : '';
  emit('update', index, { mainSlot: value });
}
</script>

<style scoped>
.acu-prompt-segs { display: flex; flex-direction: column; gap: 10px; min-width: 0; max-width: 100%; }
.acu-prompt-segs__add { display: flex; justify-content: center; min-width: 0; max-width: 100%; }
.acu-prompt-segs__add-btn { max-width: 100%; white-space: normal; }

.acu-prompt-segs__list {
  list-style: none; margin: 0; padding: 0;
  display: flex; flex-direction: column; gap: 10px; min-width: 0; max-width: 100%;
}

.acu-prompt-segs__item {
  border: 0; border-bottom: 1px solid color-mix(in srgb, var(--acu-text-3) 16%, transparent);
  border-radius: 0;
  background: transparent; padding: 0 0 12px;
  display: flex; flex-direction: column; gap: 8px;
  min-width: 0; max-width: 100%;
}

.acu-prompt-segs__item:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.acu-prompt-segs__item-head {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; max-width: 100%;
}

.acu-prompt-segs__index {
  font-size: var(--acu-font-size-caption, 11px); color: var(--acu-text-3);
  min-width: 26px;
  font-family: var(--acu-font-mono);
}

.acu-prompt-segs__role { flex: 1 1 110px; min-width: 0; max-width: 180px; }
.acu-prompt-segs__slot { flex: 1 1 120px; min-width: 0; max-width: 200px; }

.acu-prompt-segs__actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}

.acu-prompt-segs :deep(.acu-textarea),
.acu-prompt-segs :deep(textarea) {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
}

.acu-prompt-segs__empty {
  padding: 10px 0; text-align: center;
  color: var(--acu-text-3); font-size: var(--acu-font-size-body, 12px);
  border-top: 1px solid color-mix(in srgb, var(--acu-text-3) 14%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--acu-text-3) 14%, transparent);
  overflow-wrap: anywhere;
}

@media (max-width: 480px) {
  .acu-prompt-segs__item-head { align-items: stretch; }
  .acu-prompt-segs__index { flex: 0 0 100%; }
  .acu-prompt-segs__role,
  .acu-prompt-segs__slot { flex-basis: 100%; max-width: 100%; }
  .acu-prompt-segs__actions { width: 100%; margin-left: 0; justify-content: flex-end; }
}
</style>
