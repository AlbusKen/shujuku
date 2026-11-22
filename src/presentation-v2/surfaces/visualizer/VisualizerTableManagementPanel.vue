<template>
  <div class="acu-viz-table-management" data-acu-visualizer-table-management>
    <AcuPanel
      title="表格管理"
      description="调整表格顺序、新增或删除表格。保存前仅在草稿中生效，误删可在保存前取消关闭或重新载入。"
    >
      <template #actions>
        <AcuBadge variant="neutral">{{ sheetItems.length }} 张表</AcuBadge>
      </template>

      <div class="acu-viz-table-management__list">
        <article
          v-for="(item, index) in sheetItems"
          :key="item.key"
          class="acu-viz-table-management__item"
        >
          <div class="acu-viz-table-management__copy">
            <h3>
              <span>{{ item.name }}</span>
            </h3>
            <p>{{ item.rowCount }} 行 · {{ item.columnCount }} 列</p>
          </div>
          <div class="acu-viz-table-management__actions">
            <AcuIconButton
              icon="fa-solid fa-chevron-up"
              size="sm"
              title="上移表格"
              aria-label="上移表格"
              :disabled="index === 0"
              @click="$emit('move-sheet', item.key, 'up')"
            />
            <AcuIconButton
              icon="fa-solid fa-chevron-down"
              size="sm"
              title="下移表格"
              aria-label="下移表格"
              :disabled="index === sheetItems.length - 1"
              @click="$emit('move-sheet', item.key, 'down')"
            />
            <AcuIconButton
              icon="fa-solid fa-trash"
              size="sm"
              variant="danger"
              title="删除表格"
              aria-label="删除表格"
              @click="$emit('request-delete-sheet', item.key)"
            />
          </div>
        </article>

        <p v-if="sheetItems.length === 0" class="acu-viz-table-management__empty">
          当前数据库还没有表格。可以先新增表格，再进入表格编辑数据、结构和 AI 助手。
        </p>
      </div>

      <div class="acu-viz-table-management__operation">
        <AcuButton size="sm" variant="primary" @click="$emit('request-add-sheet')">
          <i class="fa-solid fa-plus"></i>
          新增表格
        </AcuButton>
      </div>
    </AcuPanel>
  </div>
</template>

<script setup lang="ts">
import AcuBadge from '../../components/_lib/AcuBadge.vue';
import AcuButton from '../../components/_lib/AcuButton.vue';
import AcuIconButton from '../../components/_lib/AcuIconButton.vue';
import AcuPanel from '../../components/_lib/AcuPanel.vue';
import type { VisualizerSheetItem } from '../../stores/visualizer-store';

defineProps<{
  sheetItems: VisualizerSheetItem[];
}>();

defineEmits<{
  (e: 'move-sheet', key: string, direction: 'up' | 'down'): void;
  (e: 'request-add-sheet'): void;
  (e: 'request-delete-sheet', key: string): void;
}>();
</script>

<style scoped>
.acu-viz-table-management {
  min-width: 0;
  display: grid;
  gap: 12px;
}

.acu-viz-table-management__list {
  min-width: 0;
  display: grid;
  gap: 8px;
}

.acu-viz-table-management__item {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--acu-border);
  border-radius: var(--acu-radius-sm);
  background: var(--acu-bg-0);
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.acu-viz-table-management__copy {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.acu-viz-table-management__copy h3 {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: var(--acu-text-1);
  font-size: var(--acu-font-size-body-lg, 13px);
  line-height: 1.35;
}

.acu-viz-table-management__copy h3 > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acu-viz-table-management__copy p,
.acu-viz-table-management__empty {
  margin: 0;
  color: var(--acu-text-2);
  font-size: var(--acu-font-size-body, 12px);
  line-height: 1.55;
}

.acu-viz-table-management__actions,
.acu-viz-table-management__operation {
  display: flex;
  align-items: center;
  gap: 6px;
}

.acu-viz-table-management__operation {
  justify-content: flex-end;
  padding-top: 2px;
}

@media (max-width: 767px) {
  .acu-viz-table-management__item {
    grid-template-columns: minmax(0, 1fr);
    align-items: stretch;
  }

  .acu-viz-table-management__actions {
    justify-content: flex-end;
  }

  .acu-viz-table-management__operation :deep(.acu-btn) {
    width: 100%;
  }
}
</style>
