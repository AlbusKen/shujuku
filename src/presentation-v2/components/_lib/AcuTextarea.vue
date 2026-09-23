<template>
  <textarea
    ref="textareaRef"
    :id="id"
    class="acu-textarea"
    :class="{ 'acu-textarea--auto-resize': autoResize }"
    :value="modelValue"
    :placeholder="placeholder"
    :rows="rows"
    :disabled="disabled"
    @input="onInput"
    @focus="onFocus"
    @blur="onBlur"
  ></textarea>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  acuCancelAnimationFrame,
  acuClearTimeout,
  acuGetComputedStyle,
  acuRequestAnimationFrame,
  acuSetTimeout,
  type AcuTimerHandle,
} from '../../bootstrap/host-env';

const props = withDefaults(defineProps<{
  id?: string;
  modelValue: string;
  placeholder?: string;
  rows?: number;
  maxRows?: number;
  autoResize?: boolean;
  disabled?: boolean;
}>(), {
  id: undefined,
  placeholder: undefined,
  rows: 4,
  maxRows: undefined,
  autoResize: false,
  disabled: false,
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'focus', event: FocusEvent): void;
  (e: 'blur', event: FocusEvent): void;
}>();

const textareaRef = ref<HTMLTextAreaElement | null>(null);
let resizeObserver: ResizeObserver | null = null;
let resizeFrame: AcuTimerHandle | null = null;
let resizeTimer: AcuTimerHandle | null = null;

function normalizeRows(value: number | undefined, fallback: number): number {
  const rows = Math.trunc(Number(value));
  return Number.isFinite(rows) && rows > 0 ? rows : fallback;
}

function parsePixel(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getLineHeight(style: CSSStyleDeclaration): number {
  const explicit = parsePixel(style.lineHeight);
  if (explicit > 0) return explicit;
  const fontSize = parsePixel(style.fontSize);
  return fontSize > 0 ? fontSize * 1.45 : 18;
}

function getRowsHeight(el: HTMLTextAreaElement, rows: number): number {
  const style = acuGetComputedStyle(el);
  const verticalInset =
    parsePixel(style.paddingTop)
    + parsePixel(style.paddingBottom)
    + parsePixel(style.borderTopWidth)
    + parsePixel(style.borderBottomWidth);
  return Math.ceil(getLineHeight(style) * rows + verticalInset);
}

function resizeTextarea(el = textareaRef.value): void {
  if (!el) return;
  if (!props.autoResize) {
    el.style.height = '';
    el.style.overflowY = '';
    return;
  }

  const minRows = normalizeRows(props.rows, 1);
  const maxRows = props.maxRows === undefined
    ? null
    : Math.max(minRows, normalizeRows(props.maxRows, minRows));
  const minHeight = getRowsHeight(el, minRows);
  const maxHeight = maxRows === null ? Number.POSITIVE_INFINITY : getRowsHeight(el, maxRows);

  el.style.height = 'auto';
  const contentHeight = Math.max(el.scrollHeight, minHeight);
  const nextHeight = Math.min(contentHeight, maxHeight);
  el.style.height = `${nextHeight}px`;
  el.style.overflowY = maxRows === null || contentHeight > maxHeight ? 'auto' : 'hidden';
}

function clearScheduledResize(): void {
  if (resizeFrame !== null) {
    acuCancelAnimationFrame(resizeFrame);
    resizeFrame = null;
  }
  if (resizeTimer !== null) {
    acuClearTimeout(resizeTimer);
    resizeTimer = null;
  }
}

function scheduleTextareaResize(): void {
  if (!props.autoResize) return;
  clearScheduledResize();
  resizeFrame = acuRequestAnimationFrame(() => {
    resizeFrame = null;
    resizeTextarea();
  });
  resizeTimer = acuSetTimeout(() => {
    resizeTimer = null;
    resizeTextarea();
  }, 60);
}

function stopWatchingSize(): void {
  resizeObserver?.disconnect();
  resizeObserver = null;
}

function watchSizeForAutoResize(): void {
  stopWatchingSize();
  const el = textareaRef.value;
  if (!props.autoResize || !el || typeof ResizeObserver === 'undefined') return;
  resizeObserver = new ResizeObserver(() => resizeTextarea(el));
  resizeObserver.observe(el);
}

function onInput(ev: Event): void {
  const el = ev.target as HTMLTextAreaElement | null;
  if (props.autoResize) resizeTextarea(el);
  emit('update:modelValue', el?.value ?? '');
}

function onFocus(ev: FocusEvent): void {
  resizeTextarea();
  scheduleTextareaResize();
  emit('focus', ev);
}

function onBlur(ev: FocusEvent): void {
  emit('blur', ev);
}

onMounted(() => {
  void nextTick(() => {
    resizeTextarea();
    scheduleTextareaResize();
    watchSizeForAutoResize();
    void textareaRef.value?.ownerDocument.fonts?.ready.then(() => scheduleTextareaResize());
  });
});

onBeforeUnmount(() => {
  clearScheduledResize();
  stopWatchingSize();
});

watch(
  () => [props.modelValue, props.rows, props.maxRows, props.autoResize],
  () => {
    void nextTick(() => {
      resizeTextarea();
      scheduleTextareaResize();
      watchSizeForAutoResize();
    });
  },
);
</script>

<style scoped>
.acu-textarea {
  appearance: none !important;
  -webkit-appearance: none !important;
  display: block !important;
  width: 100% !important;
  min-width: 0 !important;
  box-sizing: border-box !important;
  margin: 0 !important;
  padding: var(--acu-space-2, 8px) var(--acu-space-250, 10px) !important;
  border: 0 !important;
  border-radius: var(--acu-radius-sm) !important;
  background: var(--acu-bg-2) !important;
  color: var(--acu-text-1) !important;
  font: inherit !important;
  font-size: var(--acu-font-size-body, 12px) !important;
  line-height: 1.45 !important;
  letter-spacing: 0 !important;
  text-align: start !important;
  resize: none !important;
  outline: none !important;
  box-shadow: none !important;
  caret-color: var(--acu-text-1);
  -webkit-tap-highlight-color: transparent;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}
.acu-textarea--auto-resize {
  overflow-x: hidden !important;
  overflow-y: auto;
}
.acu-textarea:hover:not(:disabled) {
  background: linear-gradient(var(--acu-hover-overlay), var(--acu-hover-overlay)), var(--acu-bg-2) !important;
}
.acu-textarea:focus {
  outline: none !important;
  box-shadow: 0 0 0 2px var(--acu-accent-glow) !important;
}
.acu-textarea:disabled {
  opacity: 0.5; cursor: not-allowed;
}
</style>
