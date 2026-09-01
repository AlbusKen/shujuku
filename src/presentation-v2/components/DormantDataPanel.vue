<template>
  <AcuPanel
    title="休眠数据"
    description="切换模板时未被新模板包含的表和列会进入休眠：数据保留在聊天历史中并跟随 checkpoint 迁移，不参与填表。在这里可以查看并唤醒它们。"
  >
    <AcuMessage v-if="dormant.listError.value" kind="error">
      {{ dormant.listError.value }}
    </AcuMessage>

    <AcuMessage v-if="dormant.integrityIssues.value.length" kind="warning">
      <p class="acu-v2-dormant-panel__integrity-title">
        休眠完整性自检发现 {{ dormant.integrityIssues.value.length }} 项问题：
      </p>
      <ul class="acu-v2-dormant-panel__integrity-list">
        <li
          v-for="issue in dormant.integrityIssues.value"
          :key="`${issue.sheetKey}:${issue.kind}`"
        >
          {{ issue.message }}
        </li>
      </ul>
    </AcuMessage>

    <p
      v-if="dormant.loaded.value && !dormant.listError.value && dormant.isEmpty.value"
      class="acu-v2-dormant-panel__empty"
    >
      当前没有休眠数据。
    </p>

    <section
      v-if="dormant.dormantTables.value.length"
      class="acu-v2-dormant-panel__section"
      aria-labelledby="acu-dormant-tables-title"
    >
      <h3 id="acu-dormant-tables-title" class="acu-v2-dormant-panel__section-title">
        休眠表（{{ dormant.dormantTables.value.length }}）
      </h3>
      <div
        v-for="entry in dormant.dormantTables.value"
        :key="entry.sheetKey"
        class="acu-v2-dormant-panel__item"
      >
        <div class="acu-v2-dormant-panel__item-main">
          <strong class="acu-v2-dormant-panel__item-name">{{ entry.name }}</strong>
          <span class="acu-v2-dormant-panel__item-meta">
            {{ entry.rowCount }} 行 · {{ entry.columnCount }} 列 · {{ formatHiddenAt(entry) }} · 来源模板：{{ formatSourcePreset(entry) }}
          </span>
          <span
            v-if="!entry.canWake && entry.wakeBlockedReason"
            class="acu-v2-dormant-panel__item-blocked"
          >
            {{ entry.wakeBlockedReason }}
          </span>
        </div>
        <AcuButton
          size="sm"
          variant="primary"
          :disabled="!entry.canWake || !!dormant.busyAction.value"
          :loading="dormant.busyAction.value === `wake:${entry.sheetKey}`"
          @click="dormant.wakeTable(entry)"
        >
          唤醒
        </AcuButton>
      </div>
    </section>

    <section
      v-if="dormant.dormantColumns.value.length"
      class="acu-v2-dormant-panel__section"
      aria-labelledby="acu-dormant-columns-title"
    >
      <h3 id="acu-dormant-columns-title" class="acu-v2-dormant-panel__section-title">
        休眠列（{{ dormant.dormantColumns.value.length }}）
      </h3>
      <div
        v-for="entry in dormant.dormantColumns.value"
        :key="`${entry.sheetKey}:${entry.hiddenName}`"
        class="acu-v2-dormant-panel__item"
      >
        <div class="acu-v2-dormant-panel__item-main">
          <strong class="acu-v2-dormant-panel__item-name">{{ entry.header }}</strong>
          <span class="acu-v2-dormant-panel__item-meta">所属表：{{ entry.sheetName }}</span>
        </div>
        <AcuButton
          size="sm"
          variant="primary"
          :disabled="!!dormant.busyAction.value"
          :loading="dormant.busyAction.value === `wake:${entry.sheetKey}:${entry.hiddenName}`"
          @click="dormant.wakeColumn(entry)"
        >
          唤醒
        </AcuButton>
      </div>
    </section>

    <div class="acu-v2-dormant-panel__actions">
      <AcuButton
        :disabled="!!dormant.busyAction.value"
        @click="dormant.refresh"
      >
        刷新休眠清单
      </AcuButton>
    </div>
  </AcuPanel>
</template>

<script setup lang="ts">
import { onMounted, watch } from 'vue';
import AcuButton from './_lib/AcuButton.vue';
import AcuMessage from './_lib/AcuMessage.vue';
import AcuPanel from './_lib/AcuPanel.vue';
import { useChatChangedTick } from '../composables/useChatChangedListener';
import { useDormantData } from '../composables/useDormantData';
import type { DormantTableEntry_ACU } from '../../service/template/dormant-data-service';

const dormant = useDormantData();
const chatChangedTick = useChatChangedTick();

function formatHiddenAt(entry: DormantTableEntry_ACU): string {
  if (typeof entry.hiddenAtTime === 'number' && Number.isFinite(entry.hiddenAtTime)) {
    const date = new Date(entry.hiddenAtTime);
    const pad = (value: number) => String(value).padStart(2, '0');
    return `休眠于 ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  if (typeof entry.hiddenAtMessageIndex === 'number') {
    return `休眠于第 ${entry.hiddenAtMessageIndex} 楼`;
  }
  return '休眠时间未记录';
}

function formatSourcePreset(entry: DormantTableEntry_ACU): string {
  return entry.sourcePresetName || '未记录';
}

onMounted(() => dormant.refresh());
watch(chatChangedTick, () => dormant.refresh());
</script>

<style scoped>
.acu-v2-dormant-panel__integrity-title {
  margin: 0 0 4px;
}

.acu-v2-dormant-panel__integrity-list {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.acu-v2-dormant-panel__empty {
  margin: 0;
  color: var(--acu-color-text-secondary, #8a8f98);
  font-size: 0.9em;
}

.acu-v2-dormant-panel__section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.acu-v2-dormant-panel__section-title {
  margin: 0;
  font-size: 0.95em;
}

.acu-v2-dormant-panel__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border: 1px solid var(--acu-color-border, rgba(128, 128, 128, 0.3));
  border-radius: 6px;
}

.acu-v2-dormant-panel__item-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.acu-v2-dormant-panel__item-name {
  font-size: 0.95em;
  overflow-wrap: anywhere;
}

.acu-v2-dormant-panel__item-meta {
  font-size: 0.82em;
  color: var(--acu-color-text-secondary, #8a8f98);
  overflow-wrap: anywhere;
}

.acu-v2-dormant-panel__item-blocked {
  font-size: 0.82em;
  color: var(--acu-color-warning, #c98a2b);
  overflow-wrap: anywhere;
}

.acu-v2-dormant-panel__actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
}
</style>
