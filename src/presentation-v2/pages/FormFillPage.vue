<template>
  <section class="acu-v2-form-fill-page">
    <AcuMobilePanelNav :items="panelNavItems" />

    <AcuPanelGrid class="acu-v2-form-fill-page__grid">
      <AcuPanel
        id="form-fill-status-panel"
        class="acu-v2-form-fill-page__panel--status"
        :title="formFillCopy.panels.status.title"
        :description="formFillCopy.panels.status.description"
      >
        <AcuText
          variant="status-line"
          class="acu-v2-form-fill-page__status-line"
          aria-label="表格状态概览"
        >
          当前聊天:
          <strong
            class="acu-text__value acu-v2-form-fill-page__status-chat"
            :title="dashboard.chatFileIdentifier.value || '未初始化'"
          >
            {{ dashboard.chatFileIdentifier.value || "未初始化" }}
          </strong>
          · AI回复累计层数:
          <strong class="acu-text__value">{{
            dashboard.aiMessageCount.value
          }}</strong>
          · 当前 full checkpoint:
          <strong class="acu-text__value acu-v2-form-fill-page__checkpoint-label">
            {{ manualUpdate.checkpointFloorsLabel.value }}
          </strong>
        </AcuText>

        <AcuMessage kind="info">
          按当前手动填表设置，预计处理范围：{{ manualUpdate.manualRefillRangeLabel.value }}。
        </AcuMessage>

        <AcuMessage v-if="!dashboard.hasTables.value" kind="info">
          当前尚未加载数据库表格。
        </AcuMessage>

        <div class="acu-v2-form-fill-page__table-wrap">
          <table class="acu-v2-form-fill-page__status-table">
            <thead>
              <tr>
                <th>表格</th>
                <th>频率</th>
                <th>未记录</th>
                <th>上次更新</th>
                <th>下次触发</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!dashboard.tableRows.value.length">
                <td colspan="5" class="acu-v2-form-fill-page__empty">
                  暂无数据
                </td>
              </tr>
              <tr
                v-for="row in dashboard.tableRows.value"
                :key="row.key"
                :class="{
                  'acu-v2-form-fill-page__status-row--ready': row.ready,
                }"
              >
                <td>{{ row.name }}</td>
                <td>{{ row.frequencyLabel }}</td>
                <td>{{ row.unrecordedLabel }}</td>
                <td>{{ row.lastUpdatedLabel }}</td>
                <td>
                  <AcuBadge v-if="row.ready" variant="success">就绪</AcuBadge>
                  <span v-else>{{ row.nextTriggerLabel }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </AcuPanel>

      <AcuPanel
        id="form-fill-mode-panel"
        class="acu-v2-form-fill-page__panel--mode"
        title="填表模式"
        :description="fillModeDescriptions[formFillMode.selectedMode]"
      >
        <AcuFormRow label="当前填表模式" hint="从下拉菜单中选择一种模式。每种模式的参数独立保存，切换模式不会覆盖其它模式，也不会改变功能档位。">
          <AcuSelect
            :options="FORM_FILL_MODE_OPTIONS"
            :model-value="formFillMode.selectedMode"
            @update:model-value="selectFillMode"
          />
        </AcuFormRow>

        <AcuMessage v-if="formFillMode.saveError" kind="error">
          {{ formFillMode.saveError }}
        </AcuMessage>

        <template v-if="formFillMode.selectedMode === 'classic'">
          <AcuFormRow label="最近纪要表条数" hint="同时控制界面显示与经典模式提示词中的近期纪要条数，默认 15 条。">
            <AcuInput
              type="number"
              :min="1"
              :max="200"
              :step="1"
              :model-value="formFillMode.profiles.classic.recentChronicleRows"
              @change="formFillMode.setClassicRecentChronicleRows($event)"
            />
          </AcuFormRow>
        </template>

        <template v-if="formFillMode.selectedMode === 'vector'">
          <AcuFormRow label="保留相关纪要条数" hint="按 rerank 结果从上到下保留的纪要条数；embedding 与 rerank 服务在下方「Embedding / Rerank」面板配置。">
            <AcuInput
              type="number"
              :min="1"
              :max="1000"
              :step="1"
              :model-value="formFillMode.profiles.vector.resultCount"
              @change="formFillMode.setVectorResultCount($event)"
            />
          </AcuFormRow>
        </template>

        <template v-if="formFillMode.selectedMode === 'llm'">
          <AcuFormRow label="LLM / continuation API 预设" hint="选择后仅用于逻辑召回模式；留空时跟随当前 API。">
            <AcuSelect
              :options="apiPresetSelectOptions"
              :model-value="formFillMode.profiles.llm.apiPresetName"
              :placeholder="followActiveApiLabel"
              @update:model-value="formFillMode.setLlmApiPresetName($event)"
            />
          </AcuFormRow>
        </template>

      </AcuPanel>

      <FormFillUpdateSettingsPanel
        id="form-fill-update-panel"
        class="acu-v2-form-fill-page__panel--update"
      />

      <TableTemplatePresetPanel
        id="form-fill-template-panel"
        class="acu-v2-form-fill-page__panel--template"
      />

      <AcuPanel
        id="form-fill-manual-panel"
        class="acu-v2-form-fill-page__panel--manual"
        :title="formFillCopy.panels.manual.title"
        :description="formFillCopy.panels.manual.description"
      >
        <div class="acu-v2-form-fill-page__manual-number-grid">
          <AcuFormRow
            label="手动处理最近 N 层"
            hint="从可用 AI 回复中取最近 N 层执行手动填表。"
          >
            <AcuInput
              type="number"
              :min="0"
              :step="1"
              :model-value="manualUpdate.manualContextDepth.value"
              @change="manualUpdate.setManualContextDepth($event)"
            />
          </AcuFormRow>

          <AcuFormRow
            label="每 N 层合并为一次填表"
            hint="把多少层 AI 回复压缩成一次填表请求。"
          >
            <AcuInput
              type="number"
              :min="1"
              :step="1"
              :model-value="manualUpdate.manualBatchSize.value"
              @change="manualUpdate.setManualBatchSize($event)"
            />
          </AcuFormRow>
        </div>

        <AcuMessage kind="info">
          当前 full checkpoint：{{ manualUpdate.checkpointFloorsLabel.value }}；按当前设置预计处理范围：{{ manualUpdate.manualRefillRangeLabel.value }}。
          选中表：{{ manualUpdate.selectedSheetSummary.value }}。
        </AcuMessage>

        <TableSelector
          :sheet-keys="manualUpdate.sheetKeys.value"
          :selected-keys="manualUpdate.selectedManualTableKeys.value"
          :sheet-names="manualUpdate.sheetNames.value"
          :disabled="!manualUpdate.runtimeReady.value"
          empty-text="当前没有可手动填表的表格。"
          @update:selected-keys="manualUpdate.setManualSelectedKeys($event)"
          @select-all="manualUpdate.selectAllManualTables"
          @select-none="manualUpdate.selectNoManualTables"
        />

        <div class="acu-v2-form-fill-page__manual-extra">
          <AcuFormRow
            label="本次填表附加要求"
            hint="留空时不会给本次手动填表追加额外要求。"
          >
            <AcuTextarea
              :model-value="manualUpdate.manualExtraHint.value"
              :rows="4"
              placeholder="仅用于本次手动填表..."
              @update:model-value="manualUpdate.manualExtraHint.value = $event"
            />
          </AcuFormRow>
        </div>

        <AcuMessage v-if="manualUpdate.vectorIndexWarning.value" kind="warning">
          交火模式纪要索引启用时不建议手动更新表格；特殊场景下仍可点击执行。
        </AcuMessage>
        <AcuMessage kind="info">
          {{ formFillCopy.panels.manual.catchUpBoundary }}
        </AcuMessage>

        <div class="acu-v2-form-fill-page__actions">
          <AcuButton
            variant="secondary"
            :disabled="
              manualUpdate.manualUpdateBusy.value ||
              manualUpdate.catchUpBusy.value ||
              !manualUpdate.selectedManualTableKeys.value.length
            "
            @click="manualUpdate.runManualCatchUp"
          >
            {{
              manualUpdate.catchUpBusy.value
                ? formFillCopy.panels.manual.catchUpBusyLabel
                : formFillCopy.panels.manual.catchUpLabel
            }}
          </AcuButton>
          <AcuButton
            variant="primary"
            :disabled="
              manualUpdate.manualUpdateBusy.value ||
              manualUpdate.catchUpBusy.value ||
              !manualUpdate.selectedManualTableKeys.value.length
            "
            @click="manualUpdate.runManualUpdate"
          >
            {{
              manualUpdate.manualUpdateBusy.value
                ? "填表中..."
                : manualUpdate.vectorIndexWarning.value
                  ? "交火索引已启用"
                  : formFillCopy.panels.manual.runLabel
            }}
          </AcuButton>
        </div>
      </AcuPanel>
    </AcuPanelGrid>

    <FormFillVectorPanels
      v-if="vectorPanelMode"
      :mode="vectorPanelMode"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import AcuBadge from "../components/_lib/AcuBadge.vue";
import AcuButton from "../components/_lib/AcuButton.vue";
import AcuFormRow from "../components/_lib/AcuFormRow.vue";
import AcuInput from "../components/_lib/AcuInput.vue";
import AcuMessage from "../components/_lib/AcuMessage.vue";
import AcuMobilePanelNav from "../components/_lib/AcuMobilePanelNav.vue";
import AcuPanel from "../components/_lib/AcuPanel.vue";
import AcuPanelGrid from "../components/_lib/AcuPanelGrid.vue";
import AcuSelect from "../components/_lib/AcuSelect.vue";
import AcuText from "../components/_lib/AcuText.vue";
import AcuTextarea from "../components/_lib/AcuTextarea.vue";
import FormFillVectorPanels from "../components/FormFillVectorPanels.vue";
import FormFillUpdateSettingsPanel from "../components/FormFillUpdateSettingsPanel.vue";
import TableTemplatePresetPanel from "../components/TableTemplatePresetPanel.vue";
import TableSelector from "../components/TableSelector.vue";
import { useApiPresetSelectOptions } from "../composables/useApiPresetSelectOptions";
import { useChatChangedTick } from "../composables/useChatChangedListener";
import { useTemplateRuntimeChangeTick } from "../composables/useTemplateRuntimeChangeListener";
import { useDashboardPage } from "../composables/useDashboardPage";
import { useManualUpdate } from "../composables/useManualUpdate";
import { formFillCopy } from "../copy/form-fill-copy";
import { tableCopy } from "../copy/table-copy";
import { vectorIndexCopy } from "../copy/vector-index-copy";
import {
  FORM_FILL_MODE_OPTIONS,
  useFormFillModeStore,
  type FillMode,
} from "../stores/form-fill-mode-store";

const dashboard = useDashboardPage();
const manualUpdate = useManualUpdate();
const formFillMode = useFormFillModeStore();
const { followActiveApiLabel, apiPresetSelectOptions } = useApiPresetSelectOptions();
const fillModeDescriptions: Record<FillMode, string> = {
  classic: "经典表格：沿用稳定的经典填表流程，是新安装的默认模式。",
  vector: "向量表格：只用 embedding 与 rerank 选出相关纪要，不生成关键词，也不执行剧情推进或混合召回。",
  llm: "LLM 逻辑召回：由 LLM 先读纪要概览与目录，再按信息缺口精读具体纪要区间。",
  crossfire: "交火模式：关键词、向量、混合召回与 rerank 的完整流程；全部参数与索引维护在下方面板。",
};
/** 向量表格与交火模式需要向量服务与索引维护面板；其余模式不渲染。 */
const vectorPanelMode = computed<"vector" | "crossfire" | null>(() => {
  const mode = formFillMode.selectedMode;
  return mode === "vector" || mode === "crossfire" ? mode : null;
});
const panelNavItems = computed(() => {
  const items = [
    { id: "form-fill-status-panel", label: formFillCopy.nav.status },
    { id: "form-fill-mode-panel", label: "填表模式" },
    { id: "form-fill-update-panel", label: formFillCopy.nav.update },
    { id: "form-fill-manual-panel", label: formFillCopy.nav.manual },
    { id: "form-fill-template-panel", label: tableCopy.panels.templatePreset.title },
  ];
  if (vectorPanelMode.value === "crossfire") {
    items.push(
      { id: "vector-index-status-panel", label: vectorIndexCopy.nav.status },
      { id: "vector-index-keyword-panel", label: vectorIndexCopy.nav.keyword },
      { id: "vector-index-api-panel", label: vectorIndexCopy.nav.api },
      { id: "vector-index-prompt-panel", label: vectorIndexCopy.nav.prompt },
      { id: "vector-index-recall-panel", label: vectorIndexCopy.nav.recall },
      { id: "vector-index-archive-panel", label: vectorIndexCopy.nav.archive },
    );
  } else if (vectorPanelMode.value === "vector") {
    items.push(
      { id: "vector-index-status-panel", label: vectorIndexCopy.nav.status },
      { id: "vector-index-api-panel", label: vectorIndexCopy.nav.api },
      { id: "vector-index-archive-panel", label: vectorIndexCopy.nav.archive },
    );
  }
  return items;
});

function selectFillMode(value: string): void {
  if (value === "classic" || value === "vector" || value === "llm" || value === "crossfire") {
    formFillMode.selectMode(value);
  }
}

async function refreshAll(): Promise<void> {
  manualUpdate.refresh();
  await dashboard.refresh();
}

onMounted(() => {
  void refreshAll();
});
watch(useChatChangedTick(), () => {
  void refreshAll();
});
watch(useTemplateRuntimeChangeTick(), () => {
  void refreshAll();
});
</script>

<style scoped>
.acu-v2-form-fill-page {
  min-height: 100%;
  min-width: 0;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.acu-v2-form-fill-page__grid {
  grid-template-areas:
    "status mode"
    "update template"
    "manual template";
}

.acu-v2-form-fill-page__panel--status {
  grid-area: status;
}

.acu-v2-form-fill-page__panel--update {
  grid-area: update;
}

.acu-v2-form-fill-page__panel--mode {
  grid-area: mode;
}

.acu-v2-form-fill-page__panel--template {
  grid-area: template;
}

.acu-v2-form-fill-page__panel--manual {
  grid-area: manual;
}

.acu-v2-form-fill-page__manual-number-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.acu-v2-form-fill-page__mode-number-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.acu-v2-form-fill-page__status-line {
  margin: 0 0 10px;
  font-size: var(--acu-font-size-body, 12px);
  line-height: var(--acu-line-height-body, 1.45);
}

.acu-v2-form-fill-page__status-chat {
  max-width: min(42ch, 100%);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acu-v2-form-fill-page__checkpoint-label {
  color: var(--acu-accent);
}

.acu-v2-form-fill-page__manual-extra {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.acu-v2-form-fill-page__checkpoint-risk {
  color: var(--acu-danger);
  font-weight: 700;
}

.acu-v2-form-fill-page__table-wrap {
  min-width: 0;
  overflow: auto;
  border: 0;
  border-radius: var(--acu-radius-sm);
  background: var(--acu-bg-0);
}

.acu-v2-form-fill-page__status-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 560px;
  font-size: var(--acu-font-size-body, 12px);
}

.acu-v2-form-fill-page__status-table th,
.acu-v2-form-fill-page__status-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--acu-border-2);
  text-align: left;
}

.acu-v2-form-fill-page__status-table th {
  color: var(--acu-text-3);
  font-weight: 600;
  background: var(--acu-bg-1);
}

.acu-v2-form-fill-page__status-table td {
  color: var(--acu-text-2);
}

.acu-v2-form-fill-page__status-table tr:last-child td {
  border-bottom: 0;
}

.acu-v2-form-fill-page__status-row--ready td {
  color: var(--acu-text-1);
}

.acu-v2-form-fill-page__empty {
  text-align: center !important;
  color: var(--acu-text-3) !important;
}

.acu-v2-form-fill-page__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 12px;
  margin-top: 4px;
}

@media (max-width: 860px) {
  .acu-v2-form-fill-page {
    padding: 14px;
  }

  .acu-v2-form-fill-page__grid {
    grid-template-areas:
      "status"
      "mode"
      "update"
      "manual"
      "template";
  }

  .acu-v2-form-fill-page__manual-number-grid {
    grid-template-columns: 1fr;
  }

  .acu-v2-form-fill-page__mode-number-grid {
    grid-template-columns: 1fr;
  }
}
</style>
