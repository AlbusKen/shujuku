<template>
  <div class="acu-preset-dd" :class="{ 'acu-preset-dd--disabled': disabled }" ref="rootRef">
    <button type="button" class="acu-preset-dd__trigger" :disabled="disabled" @click="toggleOpen">
      <span class="acu-preset-dd__label">{{ selectedLabel }}</span>
      <i class="fa-solid fa-chevron-down acu-preset-dd__caret" :class="{ 'acu-preset-dd__caret--open': open }"></i>
    </button>
    <ul v-if="open" class="acu-preset-dd__menu">
      <li
        v-for="item in items" :key="itemValue(item)"
        class="acu-preset-dd__item"
        :class="{ 'acu-preset-dd__item--active': itemValue(item) === modelValue }"
        @click="selectItem(itemValue(item))"
      >
        <span class="acu-preset-dd__item-name">{{ itemLabel(item) }}</span>
        <span v-if="item.meta" class="acu-preset-dd__item-meta">{{ item.meta }}</span>
        <button
          v-if="showDefaultAction"
          type="button"
          class="acu-preset-dd__star"
          :class="{ 'acu-preset-dd__star--active': itemValue(item) === defaultName }"
          :title="itemValue(item) === defaultName ? defaultActiveTitle : defaultInactiveTitle"
          :aria-label="itemValue(item) === defaultName ? defaultActiveTitle : defaultInactiveTitle"
          @click.stop="$emit('set-default', itemValue(item))"
        >
          <i :class="itemValue(item) === defaultName ? 'fa-solid fa-star' : 'fa-regular fa-star'"></i>
        </button>
        <i v-if="itemValue(item) === modelValue" class="fa-solid fa-check acu-preset-dd__check"></i>
      </li>
      <li v-if="!items.length" class="acu-preset-dd__empty">{{ emptyText }}</li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { getAcuHostDocument } from '../../bootstrap/host-document';

export interface PresetDropdownItem {
  name?: string;
  value?: string;
  label?: string;
  meta?: string;
}

const props = withDefaults(defineProps<{
  items: PresetDropdownItem[];
  modelValue: string;
  defaultName: string;
  emptyText?: string;
  placeholder?: string;
  disabled?: boolean;
  showDefaultAction?: boolean;
  defaultActiveTitle?: string;
  defaultInactiveTitle?: string;
}>(), {
  emptyText: '暂无预设',
  placeholder: '未选择',
  disabled: false,
  showDefaultAction: true,
  defaultActiveTitle: '全局默认',
  defaultInactiveTitle: '设为全局默认',
});

const emit = defineEmits<{
  (e: 'update:modelValue', name: string): void;
  (e: 'set-default', name: string): void;
}>();

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);

const selectedLabel = computed(() => {
  const item = props.items.find(i => itemValue(i) === props.modelValue);
  return item ? itemLabel(item) : props.placeholder;
});

function itemValue(item: PresetDropdownItem): string {
  return item.value ?? item.name ?? '';
}

function itemLabel(item: PresetDropdownItem): string {
  return item.label ?? item.name ?? item.value ?? '';
}

function toggleOpen(): void {
  if (props.disabled) return;
  open.value = !open.value;
}

function selectItem(value: string) {
  if (props.disabled) return;
  emit('update:modelValue', value);
  open.value = false;
}

function onClickOutside(e: MouseEvent) {
  if (rootRef.value && !rootRef.value.contains(e.target as Node)) {
    open.value = false;
  }
}

let hostDoc: Document | null = null;
onMounted(() => {
  hostDoc = getAcuHostDocument();
  hostDoc.addEventListener('mousedown', onClickOutside);
});
onBeforeUnmount(() => {
  hostDoc?.removeEventListener('mousedown', onClickOutside);
});
</script>

<style scoped>
.acu-preset-dd { position: relative; flex: 1; min-width: 0; }
.acu-preset-dd__trigger {
  display: flex; align-items: center; gap: var(--acu-space-2, 8px); width: 100%;
  min-height: var(--acu-control-height-md, 32px); padding: var(--acu-control-padding-y-md, 6px) var(--acu-control-padding-x-md, 9px);
  background: var(--acu-bg-2); border: 0;
  border-radius: var(--acu-radius-sm); color: var(--acu-text-1);
  font: inherit; font-size: var(--acu-font-size-body, 12px); cursor: pointer;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}
.acu-preset-dd__trigger:hover {
  background: linear-gradient(var(--acu-hover-overlay), var(--acu-hover-overlay)), var(--acu-bg-2);
}
.acu-preset-dd__trigger:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--acu-accent-glow); }
.acu-preset-dd__trigger:disabled { opacity: 0.5; cursor: not-allowed; }
.acu-preset-dd--disabled { pointer-events: none; opacity: 0.5; }
.acu-preset-dd__label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.acu-preset-dd__caret { font-size: var(--acu-font-size-micro, 10px); --acu-icon-color: var(--acu-text-3); color: var(--acu-text-3); transition: transform 0.15s ease; }
.acu-preset-dd__caret--open { transform: rotate(180deg); }
.acu-preset-dd__menu {
  position: absolute; top: calc(100% + var(--acu-space-1, 4px)); left: 0; right: 0; z-index: 100;
  margin: 0; padding: var(--acu-space-1, 4px) 0; list-style: none;
  background: var(--acu-bg-1); border: 1px solid var(--acu-border);
  border-radius: var(--acu-radius-sm); box-shadow: var(--acu-shadow);
  max-height: var(--acu-menu-max-height, 240px); overflow-y: auto;
}
.acu-preset-dd__item {
  display: flex; align-items: center; gap: var(--acu-space-2, 8px);
  padding: var(--acu-space-2, 8px) var(--acu-space-3, 12px); cursor: pointer; font-size: var(--acu-font-size-body-lg, 13px);
  color: var(--acu-text-2); transition: background 0.1s ease;
}
.acu-preset-dd__item:hover { background: var(--acu-hover-overlay); color: var(--acu-text-1); }
.acu-preset-dd__item--active { color: var(--acu-on-accent); background: var(--acu-accent); }
.acu-preset-dd__item-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.acu-preset-dd__item-meta { font-size: var(--acu-font-size-caption, 11px); color: var(--acu-text-3); white-space: nowrap; }
.acu-preset-dd__star {
  width: var(--acu-menu-action-size, 24px); height: var(--acu-menu-action-size, 24px); display: flex; align-items: center; justify-content: center;
  border: 0; background: transparent; color: var(--acu-text-3); cursor: pointer;
  border-radius: var(--acu-radius-sm); font-size: var(--acu-font-size-body, 12px); transition: color 0.15s ease;
}
.acu-preset-dd__star:hover { color: var(--acu-text-1); background: var(--acu-hover-overlay); }
.acu-preset-dd__star--active { color: var(--acu-text-1); }
.acu-preset-dd__item--active .acu-preset-dd__item-meta,
.acu-preset-dd__item--active .acu-preset-dd__star,
.acu-preset-dd__item--active .acu-preset-dd__check { --acu-icon-color: var(--acu-on-accent); color: var(--acu-on-accent); }
.acu-preset-dd__check { font-size: var(--acu-font-size-caption, 11px); --acu-icon-color: var(--acu-text-1); color: var(--acu-text-1); }
.acu-preset-dd__empty { padding: var(--acu-space-3, 12px); text-align: center; color: var(--acu-text-3); font-size: var(--acu-font-size-body, 12px); }
</style>
