<template>
  <div ref="rootRef" class="acu-select" :class="rootClasses">
    <button type="button" class="acu-select__trigger" :disabled="disabled" @click="open = !open">
      <span class="acu-select__label" :class="{ 'acu-select__label--placeholder': !hasSelection }">{{ selectedLabel }}</span>
      <i class="fa-solid fa-chevron-down acu-select__caret" :class="{ 'acu-select__caret--open': open }"></i>
    </button>
    <ul v-if="open" class="acu-select__menu">
      <template v-for="entry in groupedOptions" :key="entry.key">
        <li v-if="entry.group !== null" class="acu-select__group">{{ entry.group }}</li>
        <li
          class="acu-select__item"
          :class="{ 'acu-select__item--active': entry.opt.value === modelValue }"
          @click="select(entry.opt.value)"
        >
          {{ entry.opt.label }}
        </li>
      </template>
      <li v-if="!options.length" class="acu-select__empty">无可选项</li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { getAcuHostDocument } from '../../bootstrap/host-document';

export interface AcuSelectOption {
  value: string;
  label: string;
  /** 可选分组名：相邻同名分组的选项会共享一个组标题（不可点击，仅视觉分组）。 */
  group?: string;
}

const props = withDefaults(defineProps<{
  options: AcuSelectOption[];
  modelValue: string;
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
}>(), {
  placeholder: '请选择',
  disabled: false,
  size: 'md',
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);

const rootClasses = computed(() => ({
  'acu-select--sm': props.size === 'sm',
  'acu-select--disabled': props.disabled,
}));

const hasSelection = computed(() => props.options.some(o => o.value === props.modelValue));

const selectedLabel = computed(() => {
  const item = props.options.find(o => o.value === props.modelValue);
  return item ? item.label : props.placeholder;
});

const groupedOptions = computed(() => {
  const groupOf = (opt: AcuSelectOption): string | null =>
    typeof opt.group === 'string' && opt.group ? opt.group : null;
  return props.options.map((opt, index) => {
    const group = groupOf(opt);
    const prevGroup = index > 0 ? groupOf(props.options[index - 1]) : null;
    return {
      key: `${index}:${opt.value}`,
      opt,
      group,
      showGroupLabel: group !== null && group !== prevGroup,
    };
  });
});

function select(value: string) {
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
.acu-select {
  position: relative;
  display: block;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  outline: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}

.acu-select__trigger {
  display: flex; align-items: center; gap: var(--acu-space-2, 8px); width: 100%;
  min-width: 0; max-width: 100%; box-sizing: border-box;
  min-height: var(--acu-control-height-md, 32px); padding: var(--acu-control-padding-y-md, 6px) var(--acu-control-padding-x-md, 9px);
  margin: 0 !important;
  background: var(--acu-bg-2) !important; border: 0 !important;
  border-radius: var(--acu-radius-sm); color: var(--acu-text-1);
  font: inherit; font-size: var(--acu-font-size-body, 12px); cursor: pointer;
  transition: background 0.15s ease, box-shadow 0.15s ease;
  box-shadow: none;
}
.acu-select__trigger:hover {
  background: linear-gradient(var(--acu-hover-overlay), var(--acu-hover-overlay)), var(--acu-bg-2) !important;
}
.acu-select__trigger:focus { outline: none !important; }
.acu-select__trigger:focus:not(:focus-visible) { box-shadow: none !important; }
.acu-select__trigger:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--acu-accent-glow); }
.acu-select__trigger:disabled { opacity: 0.5; cursor: not-allowed; }

.acu-select__label {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left;
}
.acu-select__label--placeholder { color: var(--acu-text-3); }

.acu-select__caret { font-size: var(--acu-font-size-micro, 10px); --acu-icon-color: var(--acu-text-3); color: var(--acu-text-3); transition: transform 0.15s ease; flex-shrink: 0; }
.acu-select__caret--open { transform: rotate(180deg); }

.acu-select__menu {
  position: absolute; top: calc(100% + var(--acu-space-1, 4px)); left: 0; right: 0; z-index: 100;
  margin: 0; padding: var(--acu-space-1, 4px) 0; list-style: none;
  background: var(--acu-bg-1); border: 1px solid var(--acu-border);
  border-radius: var(--acu-radius-sm); box-shadow: var(--acu-shadow);
  min-width: 0; max-width: 100%; box-sizing: border-box;
  max-height: var(--acu-menu-max-height, 240px); overflow-y: auto;
}

.acu-select__group {
  padding: var(--acu-space-2, 8px) var(--acu-space-3, 12px) var(--acu-space-1, 4px);
  font-size: var(--acu-font-size-micro, 10px);
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--acu-text-3);
  user-select: none;
  pointer-events: none;
}

.acu-select__item {
  padding: var(--acu-space-2, 8px) var(--acu-space-3, 12px); cursor: pointer; font-size: var(--acu-font-size-body-lg, 13px);
  color: var(--acu-text-2); transition: background 0.1s ease;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.acu-select__item:hover { background: var(--acu-hover-overlay); color: var(--acu-text-1); }
.acu-select__item--active { color: var(--acu-on-accent); background: var(--acu-accent); }

.acu-select__empty { padding: var(--acu-space-3, 12px); text-align: center; color: var(--acu-text-3); font-size: var(--acu-font-size-body, 12px); }

/* ── sm variant ── */
.acu-select--sm .acu-select__trigger { min-height: var(--acu-control-height-sm, 26px); padding: var(--acu-control-padding-y-sm, 3px) var(--acu-control-padding-x-sm, 7px); font-size: var(--acu-font-size-caption, 11px); }
.acu-select--sm .acu-select__item { padding: var(--acu-space-150, 6px) var(--acu-space-250, 10px); font-size: var(--acu-font-size-body, 12px); }

.acu-select--disabled { pointer-events: none; opacity: 0.5; }
</style>
