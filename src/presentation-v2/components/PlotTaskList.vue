<template>
  <fieldset class="acu-v2-plot-tasks">
    <legend>
      <span>剧情任务列表</span>
      <span class="acu-v2-plot-tasks__toolbar">
        <AcuIconButton icon="fa-solid fa-arrow-left" size="sm" :disabled="!canMove(-1)" title="左移" @click="$emit('move', -1)" />
        <AcuIconButton icon="fa-solid fa-arrow-right" size="sm" :disabled="!canMove(1)" title="右移" @click="$emit('move', 1)" />
        <AcuIconButton icon="fa-solid fa-trash-can" size="sm" variant="danger" :disabled="tasks.length <= 1" title="删除当前任务" @click="$emit('delete')" />
        <AcuIconButton icon="fa-solid fa-plus" size="sm" variant="accent" title="新增任务" @click="$emit('add')" />
      </span>
    </legend>

    <div class="acu-v2-plot-tasks__cards">
      <button
        v-for="task in tasks"
        :key="task.id"
        type="button"
        class="acu-v2-plot-tasks__card"
        :class="{
          'acu-v2-plot-tasks__card--active': task.id === currentTaskId,
          'acu-v2-plot-tasks__card--disabled': !task.enabled,
        }"
        @click="$emit('select', task.id)"
      >
        <span class="acu-v2-plot-tasks__name">{{ task.name }}</span>
        <span class="acu-v2-plot-tasks__stage" title="阶段号 — 阶段号相同的同时跑，阶段号小的跑完再跑大的。">阶段 {{ task.stage }}</span>
        <span class="acu-v2-plot-tasks__seg-count">{{ task.promptGroup.length }} 段</span>
        <span v-if="!task.enabled" class="acu-v2-plot-tasks__disabled-label">已禁用</span>
      </button>
      <div v-if="!tasks.length" class="acu-v2-plot-tasks__empty">暂无任务，点击右上 + 新增。</div>
    </div>
  </fieldset>
</template>

<script setup lang="ts">
import AcuIconButton from './_lib/AcuIconButton.vue';
import type { PlotTaskDraft } from '../composables/usePlotTaskEditing';

const props = defineProps<{
  tasks: PlotTaskDraft[];
  currentTaskId: string;
}>();

defineEmits<{
  (e: 'add'): void;
  (e: 'select', id: string): void;
  (e: 'move', delta: -1 | 1): void;
  (e: 'delete'): void;
}>();

function canMove(delta: -1 | 1): boolean {
  const idx = props.tasks.findIndex(t => t.id === props.currentTaskId);
  if (idx < 0) return false;
  const target = idx + delta;
  return target >= 0 && target < props.tasks.length;
}
</script>

<style scoped>
.acu-v2-plot-tasks {
  margin: 0; padding: 0 0 14px;
  border: 0; border-bottom: 1px solid color-mix(in srgb, var(--acu-text-3) 16%, transparent);
  border-radius: 0;
  background: transparent;
  display: flex; flex-direction: column; gap: 10px;
  min-width: 0;
}
.acu-v2-plot-tasks > legend {
  padding: 0;
  font-size: var(--acu-font-size-section-title, 12px); font-weight: 600; color: var(--acu-text-2);
  display: flex; align-items: center; gap: 10px;
}

.acu-v2-plot-tasks__toolbar { display: inline-flex; gap: 4px; }

.acu-v2-plot-tasks__cards {
  display: flex; gap: 8px;
  min-width: 0;
  overflow-x: auto;
}

.acu-v2-plot-tasks__card {
  flex: 0 0 140px;
  min-height: 100px;
  display: flex; flex-direction: column; gap: 6px;
  padding: 10px 12px;
  border-radius: var(--acu-radius-sm);
  background: var(--acu-bg-2);
  border: 0;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition: box-shadow 0.15s ease, color 0.15s ease, opacity 0.15s ease;
}
.acu-v2-plot-tasks__card:hover,
.acu-v2-plot-tasks__card:focus-visible {
  box-shadow: inset 0 0 0 2px var(--acu-accent-glow);
  outline: none;
}
.acu-v2-plot-tasks__card--active {
  background: var(--acu-accent);
  color: var(--acu-on-accent);
}
.acu-v2-plot-tasks__card--disabled {
  opacity: 0.5;
}
.acu-v2-plot-tasks__card--disabled.acu-v2-plot-tasks__card--active {
  opacity: 0.7;
}
.acu-v2-plot-tasks__card--disabled .acu-v2-plot-tasks__name {
  text-decoration: line-through;
}

.acu-v2-plot-tasks__name {
  font-size: var(--acu-font-size-list-title, 13px); color: var(--acu-text-1); font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.acu-v2-plot-tasks__card--active .acu-v2-plot-tasks__name,
.acu-v2-plot-tasks__card--active .acu-v2-plot-tasks__stage,
.acu-v2-plot-tasks__card--active .acu-v2-plot-tasks__seg-count,
.acu-v2-plot-tasks__card--active .acu-v2-plot-tasks__disabled-label {
  color: var(--acu-on-accent);
}

.acu-v2-plot-tasks__stage {
  font-size: var(--acu-font-size-caption, 11px); color: var(--acu-text-3);
  font-family: var(--acu-font-mono);
}

.acu-v2-plot-tasks__seg-count {
  font-size: var(--acu-font-size-micro, 10px); color: var(--acu-text-3);
  margin-top: auto;
}

.acu-v2-plot-tasks__disabled-label {
  font-size: var(--acu-font-size-micro, 10px); color: var(--acu-warning);
  font-weight: 500;
}

.acu-v2-plot-tasks__empty {
  padding: 16px 12px; text-align: center;
  color: var(--acu-text-3); font-size: var(--acu-font-size-body, 12px);
  flex: 1;
}
</style>
