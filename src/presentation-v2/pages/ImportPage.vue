<template>
  <section class="acu-v2-import-page">
    <AcuPanelGrid class="acu-v2-import-page__grid">
      <AcuPanel
        :title="importCopy.panels.worldbookTarget.title"
        :description="importCopy.panels.worldbookTarget.description"
      >
        <WorldbookSelector
          :model-value="store.worldbookTarget"
          :names="wb.names.value"
          :char-primary="wb.charPrimary.value"
          :status="wb.status.value"
          :error="wb.error.value"
          @retry="wb.refresh()"
          :filterable="true"
          @update:model-value="store.setWorldbookTarget($event)"
        />
      </AcuPanel>

      <AcuPanel
        :title="importCopy.panels.splitEncoding.title"
        :description="importCopy.panels.splitEncoding.description"
      >
        <AcuFormRow label="每段字符数">
          <AcuInput
            type="number"
            :min="100"
            :step="100"
            :model-value="store.splitSize"
            @change="store.setSplitSize(Number($event))"
          />
        </AcuFormRow>
        <AcuFormRow label="文件编码">
          <AcuSelect
            :options="encodingOptions"
            :model-value="store.encoding"
            @update:model-value="
              store.setEncoding($event as 'UTF-8' | 'GBK' | 'Big5')
            "
          />
        </AcuFormRow>
      </AcuPanel>

      <AcuPanel
        :title="importCopy.panels.tableSelection.title"
        :description="importCopy.panels.tableSelection.description"
      >
        <TableSelector
          :sheet-keys="store.availableSheetKeys"
          :selected-keys="store.selectedSheetKeys"
          :sheet-names="store.sheetNames"
          empty-text="尚未加载可选表格。请先确认数据库模板是否已就绪。"
          @update:selected-keys="store.setSelectedSheetKeys($event)"
          @select-all="store.selectAllSheets"
          @select-none="store.selectNoneSheets"
        />
      </AcuPanel>

      <AcuPanel
        :title="importCopy.panels.operations.title"
        :description="importCopy.panels.operations.description"
      >
        <AcuMessage :kind="statusKind">
          {{ store.statusText }}
        </AcuMessage>

        <div class="acu-v2-import-page__action-grid">
          <AcuFileButton
            variant="primary"
            block
            accept=".txt"
            :disabled="store.busy"
            @file="onFileSelected"
            >选择并拆分</AcuFileButton
          >
          <AcuButton
            block
            :disabled="!store.canInject"
            :loading="store.busy"
            @click="inject"
          >
            {{ injectLabel }}
            <template #loading-text>写入中...</template>
          </AcuButton>
          <AcuButton block :disabled="store.busy" @click="onClearStaging"
            >清空缓存</AcuButton
          >
          <AcuButton block variant="danger" :disabled="store.busy" @click="onDelete"
            >删除条目</AcuButton
          >
        </div>
      </AcuPanel>
    </AcuPanelGrid>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import AcuButton from "../components/_lib/AcuButton.vue";
import AcuFileButton from "../components/_lib/AcuFileButton.vue";
import AcuFormRow from "../components/_lib/AcuFormRow.vue";
import AcuInput from "../components/_lib/AcuInput.vue";
import AcuMessage from "../components/_lib/AcuMessage.vue";
import AcuPanel from "../components/_lib/AcuPanel.vue";
import AcuPanelGrid from "../components/_lib/AcuPanelGrid.vue";
import type { AcuSelectOption } from "../components/_lib/AcuSelect.vue";
import AcuSelect from "../components/_lib/AcuSelect.vue";
import TableSelector from "../components/TableSelector.vue";
import WorldbookSelector from "../components/WorldbookSelector.vue";
import { useChatChangedTick } from "../composables/useChatChangedListener";
import { useImportFlow } from "../composables/useImportFlow";
import { useWorldbookSelector } from "../composables/useWorldbookSelector";
import { importCopy } from "../copy/import-copy";
import { useImportFlowStore } from "../stores/import-flow-store";

const encodingOptions: AcuSelectOption[] = [
  { value: "UTF-8", label: "UTF-8" },
  { value: "GBK", label: "GBK (简体中文)" },
  { value: "Big5", label: "Big5 (繁体中文)" },
];

const store = useImportFlowStore();
const flow = useImportFlow();
const wb = useWorldbookSelector();

const statusKind = computed(() => {
  if (store.busy) return "info";
  if (!store.staging.hasChunks) return "info";
  if (store.hasTableSelection && store.selectedSheetKeys.length === 0)
    return "warning";
  if (
    store.staging.processedIndex != null &&
    store.staging.processedIndex >= 0 &&
    store.staging.processedIndex < store.staging.chunkCount
  )
    return "warning";
  return "success";
});

const injectLabel = computed(() => {
  if (
    store.staging.processedIndex != null &&
    store.staging.processedIndex >= 0 &&
    store.staging.processedIndex < store.staging.chunkCount
  ) {
    return "继续写入";
  }
  return "写入";
});

async function refreshAll(): Promise<void> {
  store.refreshFromSettings();
  await Promise.all([wb.refresh(), store.refreshStaging()]);
}

onMounted(() => {
  void refreshAll();
});

watch(useChatChangedTick(), () => {
  void refreshAll();
});

async function onFileSelected(file: File): Promise<void> {
  await flow.splitFile(file);
}
async function inject(): Promise<void> {
  await flow.injectChunks();
}
async function onDelete(): Promise<void> {
  await flow.deleteImportedEntries();
}
async function onClearStaging(): Promise<void> {
  await flow.clearStaging();
}
</script>

<style scoped>
.acu-v2-import-page {
  min-height: 100%;
  min-width: 0;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.acu-v2-import-page__action-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding-top: 12px;
  margin-top: 4px;
}

.acu-v2-import-page__action-grid :deep(.acu-file-button),
.acu-v2-import-page__action-grid :deep(.acu-btn) {
  width: 100%;
  min-width: 0;
}

@media (max-width: 860px) {
  .acu-v2-import-page {
    padding: 14px;
  }
}

@media (max-width: 560px) {
  .acu-v2-import-page__action-grid {
    grid-template-columns: 1fr;
  }
}
</style>
