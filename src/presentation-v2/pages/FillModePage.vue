<template>
  <section class="acu-v2-fill-mode-page">
    <AcuMobilePanelNav :items="panelNavItems" />

    <AcuPanelGrid class="acu-v2-fill-mode-page__grid" :columns="showPlotPanels ? 2 : 1">
      <AcuPanel
        id="fill-mode-select-panel"
        :title="fillModeCopy.panels.mode.title"
        :description="fillModeCopy.panels.mode.description"
      >
        <AcuFormRow label="当前对话填表模式" :hint="fillModeCopy.panels.mode.selectHint">
          <AcuPresetDropdown
            :items="modeItems"
            :model-value="formFillMode.selectedMode"
            :default-name="formFillMode.preferredMode"
            :disabled="formFillMode.switching"
            :default-active-title="fillModeCopy.panels.mode.preferActiveTitle"
            :default-inactive-title="fillModeCopy.panels.mode.preferInactiveTitle"
            data-acu-fill-mode-select="1"
            @update:model-value="selectFillMode"
            @set-default="setPreferredMode"
          />
        </AcuFormRow>

        <div class="acu-v2-fill-mode-page__intro" :data-acu-fill-mode-intro="formFillMode.selectedMode">
          <p class="acu-v2-fill-mode-page__intro-summary">{{ currentIntro.summary }}</p>
          <p class="acu-v2-fill-mode-page__intro-line">
            <span class="acu-v2-fill-mode-page__intro-tag acu-v2-fill-mode-page__intro-tag--pro">优点</span>
            {{ currentIntro.pros }}
          </p>
          <p class="acu-v2-fill-mode-page__intro-line">
            <span class="acu-v2-fill-mode-page__intro-tag acu-v2-fill-mode-page__intro-tag--con">缺点</span>
            {{ currentIntro.cons }}
          </p>
        </div>

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
          <AcuFormRow label="保留相关纪要条数" hint="按 rerank 结果从上到下保留的纪要条数，默认 30 条；纪要有效行数少于此数时不触发召回，全部纪要条目切为蓝灯。选中的纪要条目本轮切为蓝灯（常驻）注入，纪要索引仍保持完整目录。embedding 与 rerank 服务在下方「Embedding / Rerank」面板配置。">
            <AcuInput
              type="number"
              :min="1"
              :max="1000"
              :step="1"
              :model-value="formFillMode.profiles.vector.resultCount"
              @change="formFillMode.setVectorResultCount($event)"
            />
          </AcuFormRow>
          <AcuFormRow label="预筛最低分" hint="Embedding 余弦分门槛，低于此分不进入候选，默认 0.35。与交火模式的预筛最低分独立。">
            <AcuInput
              type="number"
              :min="0"
              :max="1"
              :step="0.01"
              :model-value="formFillMode.profiles.vector.minScore"
              @change="formFillMode.setVectorMinScore($event)"
            />
          </AcuFormRow>
          <AcuFormRow label="候选上限" hint="送入 Rerank 的候选分片上限，运行时不小于保留相关纪要条数。与交火模式的候选上限独立。">
            <AcuInput
              type="number"
              :min="1"
              :max="5000"
              :step="1"
              :model-value="formFillMode.profiles.vector.candidateLimit"
              @change="formFillMode.setVectorCandidateLimit($event)"
            />
          </AcuFormRow>
        </template>

        <!-- 填表工具调用对四种模式都生效，始终显示。 -->
        <AcuFormRow
          :label="fillModeCopy.panels.mode.nativeToolLabel"
          :hint="fillModeCopy.panels.mode.nativeToolHint"
        >
          <AcuToggle
            :model-value="formFillSettings.tableFillNativeToolEnabled.value"
            :aria-label="fillModeCopy.panels.mode.nativeToolLabel"
            data-acu-table-fill-native-tool-toggle="1"
            @update:model-value="formFillSettings.setTableFillNativeToolEnabled($event)"
          />
        </AcuFormRow>

        <AcuFormRow
          v-if="showPlotPanels"
          :label="fillModeCopy.panels.plot.enableLabel"
          :hint="fillModeCopy.panels.plot.enableHint"
        >
          <AcuToggle
            :model-value="plotStore.enabled"
            :aria-label="fillModeCopy.panels.plot.enableLabel"
            data-acu-plot-enabled-toggle="1"
            @update:model-value="plotStore.setEnabled($event)"
          />
        </AcuFormRow>
        <AcuFormRow
          v-if="showPlotPanels"
          :label="fillModeCopy.panels.plot.disguiseDisabledLabel"
          :hint="fillModeCopy.panels.plot.disguiseDisabledHint"
        >
          <AcuToggle
            :model-value="plotStore.sendDisguiseDisabled"
            :aria-label="fillModeCopy.panels.plot.disguiseDisabledLabel"
            data-acu-plot-disguise-disabled-toggle="1"
            @update:model-value="plotStore.setSendDisguiseDisabled($event)"
          />
        </AcuFormRow>
      </AcuPanel>
      <PlotPresetPanel v-if="showPlotPanels" id="fill-mode-plot-panel" />
    </AcuPanelGrid>

    <!-- 交火模式同时挂载两组面板：剧情推进在前，向量服务与索引维护在后。 -->
    <FormFillPlotPanels v-if="showPlotPanels" />

    <FormFillVectorPanels v-if="vectorPanelMode" :mode="vectorPanelMode" />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import AcuFormRow from "../components/_lib/AcuFormRow.vue";
import AcuInput from "../components/_lib/AcuInput.vue";
import AcuMessage from "../components/_lib/AcuMessage.vue";
import AcuMobilePanelNav from "../components/_lib/AcuMobilePanelNav.vue";
import AcuPanel from "../components/_lib/AcuPanel.vue";
import AcuPanelGrid from "../components/_lib/AcuPanelGrid.vue";
import AcuPresetDropdown from "../components/_lib/AcuPresetDropdown.vue";
import AcuToggle from "../components/_lib/AcuToggle.vue";
import FormFillVectorPanels from "../components/FormFillVectorPanels.vue";
import FormFillPlotPanels from "../components/FormFillPlotPanels.vue";
import PlotPresetPanel from "../components/PlotPresetPanel.vue";
import { useChatChangedTick } from "../composables/useChatChangedListener";
import { useFormFillSettings } from "../composables/useFormFillSettings";
import { FILL_MODE_INTROS, fillModeCopy } from "../copy/fill-mode-copy";
import { vectorIndexCopy } from "../copy/vector-index-copy";
import {
  FORM_FILL_MODE_OPTIONS,
  useFormFillModeStore,
  type FillMode,
} from "../stores/form-fill-mode-store";
import { useDialogStore } from "../stores/dialog-store";
import { usePlotPresetStore } from "../stores/plot-preset-store";

const formFillMode = useFormFillModeStore();
const plotStore = usePlotPresetStore();
const dialogStore = useDialogStore();
const formFillSettings = useFormFillSettings();

const modeItems = FORM_FILL_MODE_OPTIONS.map((option) => ({ value: option.value, label: option.label }));
const currentIntro = computed(() => FILL_MODE_INTROS[formFillMode.selectedMode]);

/** 向量表格与交火模式需要向量服务与索引维护面板。 */
const vectorPanelMode = computed<"vector" | "crossfire" | null>(() => {
  const mode = formFillMode.selectedMode;
  return mode === "vector" || mode === "crossfire" ? mode : null;
});
/** LLM 逻辑召回与交火模式依赖剧情推进在正文生成前分析记忆。 */
const showPlotPanels = computed(
  () => formFillMode.selectedMode === "llm" || formFillMode.selectedMode === "crossfire",
);

const panelNavItems = computed(() => {
  const items = [
    { id: "fill-mode-select-panel", label: fillModeCopy.nav.mode },
  ];
  if (showPlotPanels.value) {
    items.push({ id: "fill-mode-plot-panel", label: fillModeCopy.nav.plot });
  }
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

function isFillMode(value: string): value is FillMode {
  return value === "classic" || value === "vector" || value === "llm" || value === "crossfire";
}

async function selectFillMode(value: string): Promise<void> {
  if (!isFillMode(value)) return;
  if (formFillMode.classicActive && value !== "classic") {
    const confirmed = await dialogStore.confirm({
      title: fillModeCopy.leaveClassic.title,
      message: fillModeCopy.leaveClassic.message(FILL_MODE_INTROS[value].label),
      confirmLabel: fillModeCopy.leaveClassic.confirmLabel,
      confirmVariant: "danger",
    });
    if (!confirmed) return;
  }
  let result = await formFillMode.selectMode(value);
  if ("reason" in result && result.reason === "template_scope_changed") {
    const confirmed = await dialogStore.confirm({
      title: fillModeCopy.templateChanged.title,
      message: fillModeCopy.templateChanged.message,
      confirmLabel: fillModeCopy.templateChanged.confirmLabel,
      confirmVariant: "danger",
    });
    if (!confirmed) return;
    result = await formFillMode.selectMode(value, { confirmTemplateScopeChange: true });
  }
  if ("reason" in result) {
    await dialogStore.alert({
      title: fillModeCopy.reject.title,
      message: fillModeCopy.reject.message(result.reason, FILL_MODE_INTROS[result.currentMode].label, result.error),
    });
  }
}

function setPreferredMode(value: string): void {
  if (isFillMode(value)) formFillMode.setPreferredMode(value);
}

onMounted(() => formFillMode.refresh());
watch(useChatChangedTick(), () => formFillMode.refresh());
</script>

<style scoped>
.acu-v2-fill-mode-page {
  min-height: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--acu-page-gap, 14px);
}

.acu-v2-fill-mode-page__intro {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--acu-space-075, 3px);
  margin: 0 0 var(--acu-space-3, 12px);
}

.acu-v2-fill-mode-page__intro-summary {
  margin: 0;
  color: var(--acu-text-2);
  font-size: var(--acu-font-size-body, 12px);
  line-height: 1.55;
}

.acu-v2-fill-mode-page__intro-line {
  margin: 0;
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-caption, 11px);
  line-height: 1.55;
}

.acu-v2-fill-mode-page__intro-tag {
  margin-right: var(--acu-space-150, 6px);
  font-weight: 650;
}

.acu-v2-fill-mode-page__intro-tag--pro {
  color: var(--acu-success);
}

.acu-v2-fill-mode-page__intro-tag--con {
  color: var(--acu-warning);
}
</style>
