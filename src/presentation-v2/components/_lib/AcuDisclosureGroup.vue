<template>
  <div
    class="acu-disclosure-group"
    :class="[rootClass, { 'acu-disclosure-group--expanded': expanded }]"
  >
    <button
      type="button"
      class="acu-disclosure-group__header"
      :class="headerClass"
      :aria-expanded="expanded"
      :aria-controls="bodyId || undefined"
      @click="$emit('toggle')"
    >
      <i
        class="fa-solid fa-chevron-right acu-disclosure-group__chevron"
        :class="[chevronClass, { 'acu-disclosure-group__chevron--open': expanded, [chevronOpenClass]: expanded && chevronOpenClass }]"
        aria-hidden="true"
      ></i>
      <span class="acu-disclosure-group__label" :class="labelClass">
        <slot name="label">{{ label }}</slot>
      </span>
      <span v-if="$slots.meta || meta" class="acu-disclosure-group__meta" :class="metaClass">
        <slot name="meta">{{ meta }}</slot>
      </span>
    </button>

    <Transition
      :css="false"
      @before-enter="beforeEnter"
      @enter="enter"
      @after-enter="afterEnter"
      @enter-cancelled="cleanupTransition"
      @before-leave="beforeLeave"
      @leave="leave"
      @after-leave="afterLeave"
      @leave-cancelled="cleanupTransition"
    >
      <div
        v-if="bodyMode === 'show' || expanded"
        v-show="expanded"
        :id="bodyId || undefined"
        class="acu-disclosure-group__body"
        :class="bodyClass"
        :style="bodyStyle"
        :aria-hidden="!expanded ? 'true' : undefined"
        :inert="!expanded ? true : undefined"
      >
        <slot></slot>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useAcuHeightTransition } from './useAcuHeightTransition';

const props = withDefaults(defineProps<{
  label?: string;
  meta?: string;
  expanded: boolean;
  bodyId?: string;
  bodyMode?: 'if' | 'show';
  bodyMaxHeight?: string;
  rootClass?: string;
  headerClass?: string;
  bodyClass?: string;
  chevronClass?: string;
  chevronOpenClass?: string;
  labelClass?: string;
  metaClass?: string;
}>(), {
  label: '',
  meta: '',
  bodyId: '',
  bodyMode: 'show',
  bodyMaxHeight: '',
  rootClass: '',
  headerClass: '',
  bodyClass: '',
  chevronClass: '',
  chevronOpenClass: '',
  labelClass: '',
  metaClass: '',
});

defineEmits<{
  (e: 'toggle'): void;
}>();

// 裁切只在高度动画进行中需要（useAcuHeightTransition 会在 beforeEnter/beforeLeave 临时设 hidden）。
// 静止状态必须放开 overflow，否则 body 里的浮层（AcuSelect 下拉菜单等）会被折叠容器切掉。
// 指定了 bodyMaxHeight 的组是滚动容器，保持 overflow-y: auto。
const bodyStyle = computed(() => ({
  maxHeight: props.bodyMaxHeight || undefined,
  overflowY: props.bodyMaxHeight ? 'auto' as const : 'visible' as const,
  overflowX: props.bodyMaxHeight ? 'hidden' as const : 'visible' as const,
}));

const heightTransition = useAcuHeightTransition({
  restoreOverflow(el: HTMLElement) {
    el.style.overflowY = props.bodyMaxHeight ? 'auto' : 'visible';
    el.style.overflowX = props.bodyMaxHeight ? 'hidden' : 'visible';
  },
});

function beforeEnter(el: Element): void {
  heightTransition.beforeEnter(el);
}

function enter(el: Element, done: () => void): void {
  heightTransition.enter(el, done);
}

function afterEnter(el: Element): void {
  const body = el as HTMLElement;
  body.removeAttribute('aria-hidden');
  body.removeAttribute('inert');
  heightTransition.afterEnter(el);
}

function beforeLeave(el: Element): void {
  const body = el as HTMLElement;
  body.setAttribute('aria-hidden', 'true');
  body.setAttribute('inert', '');
  heightTransition.beforeLeave(el);
}

function leave(el: Element, done: () => void): void {
  heightTransition.leave(el, done);
}

function afterLeave(el: Element): void {
  heightTransition.afterLeave(el);
}

function cleanupTransition(el: Element): void {
  heightTransition.cleanupTransition(el);
}
</script>

<style scoped>
.acu-disclosure-group {
  display: flex;
  flex-direction: column;
  gap: 0;
  /* 根节点不裁切：折叠动画的裁切由 body 的内联 overflow 承担，静止时下拉菜单等浮层需要溢出到组外。 */
  overflow: visible;
  border-radius: var(--acu-radius-md);
  background: transparent;
}

.acu-disclosure-group__header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 34px;
  appearance: none;
  border: 0;
  /* 头部自己收圆角：根节点已不再用 overflow: hidden 帮它裁掉悬停底色。 */
  border-radius: var(--acu-radius-md);
  padding: 7px 10px;
  background: transparent;
  color: var(--acu-text-2);
  font: inherit;
  font-size: var(--acu-font-size-body, 12px);
  line-height: 1.35;
  text-align: left;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.15s ease, box-shadow 0.15s ease;
}

.acu-disclosure-group__header:hover {
  background: var(--acu-hover-overlay);
}

.acu-disclosure-group--expanded .acu-disclosure-group__header {
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}

.acu-disclosure-group__header:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--acu-accent-glow);
}

.acu-disclosure-group__chevron {
  flex: 0 0 10px;
  width: 10px;
  font-size: var(--acu-font-size-micro, 10px);
  --acu-icon-color: var(--acu-text-3);
  color: var(--acu-text-3);
  transition: transform 0.15s ease;
}

.acu-disclosure-group__chevron--open {
  transform: rotate(90deg);
}

.acu-disclosure-group__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
  color: var(--acu-text-2);
}

.acu-disclosure-group__meta {
  flex-shrink: 0;
  font-size: var(--acu-font-size-caption, 11px);
  color: var(--acu-text-3);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.acu-disclosure-group__body {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-top: 1px solid color-mix(in srgb, var(--acu-text-3) 18%, transparent);
  padding: 8px;
  opacity: 1;
  transform: translateY(0);
}
</style>
