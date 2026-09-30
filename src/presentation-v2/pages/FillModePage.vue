<template>
  <section class="acu-v2-fill-mode-page">
    <AcuMobilePanelNav :items="panelNavItems" />

    <AcuPanelGrid class="acu-v2-fill-mode-page__grid">
      <AcuPanel
        id="fill-mode-select-panel"
        :title="fillModeCopy.panels.mode.title"
        :description="fillModeCopy.panels.mode.description"
      >
        <template #actions>
          <AcuBadge variant="accent">{{ currentIntro.label }}</AcuBadge>
        </template>

        <AcuFormRow label="当前填表模式" hint="每种模式的参数独立保存，切换模式不会覆盖其它模式。">
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

      <AcuPanel
        id="fill-mode-intro-panel"
        :title="fillModeCopy.panels.intro.title"
        :description="fillModeCopy.panels.intro.description"
      >
        <ul class="acu-v2-fill-mode-page__intro-list">
          <li
            v-for="item in modeIntroList"
            :key="item.mode"
            class="acu-v2-fill-mode-page__intro-item"
            :class="{
              'acu-v2-fill-mode-page__intro-item--active':
                item.mode === formFillMode.selectedMode,
            }"
            :data-acu-fill-mode-intro="item.mode"
          >
            <div class="acu-v2-fill-mode-page__intro-head">
              <span class="acu-v2-fill-mode-page__intro-name">{{ item.label }}</span>
              <AcuBadge
                v-if="item.mode === formFillMode.selectedMode"
                variant="accent"
              >当前</AcuBadge>
            </div>
            <p class="acu-v2-fill-mode-page__intro-summary">{{ item.summary }}</p>
            <p class="acu-v2-fill-mode-page__intro-line">
              <span class="acu-v2-fill-mode-page__intro-tag acu-v2-fill-mode-page__intro-tag--pro">优点</span>
              {{ item.pros }}
            </p>
            <p class="acu-v2-fill-mode-page__intro-line">
              <span class="acu-v2-fill-mode-page__intro-tag acu-v2-fill-mode-page__intro-tag--con">缺点</span>
              {{ item.cons }}
            </p>
          </li>
        </ul>
      </AcuPanel>
    </AcuPanelGrid>

    <FormFillVectorPanels v-if="vectorPanelMode" :mode="vectorPanelMode" />

    <AcuPanelGrid v-if="showPlotPanels" class="acu-v2-fill-mode-page__plot-grid">
      <FormFillPlotPanels />
    </AcuPanelGrid>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import AcuBadge from "../components/_lib/AcuBadge.vue";
import AcuFormRow from "../components/_lib/AcuFormRow.vue";
import AcuInput from "../components/_lib/AcuInput.vue";
import AcuMessage from "../components/_lib/AcuMessage.vue";
import AcuMobilePanelNav from "../components/_lib/AcuMobilePanelNav.vue";
import AcuPanel from "../components/_lib/AcuPanel.vue";
import AcuPanelGrid from "../components/_lib/AcuPanelGrid.vue";
import AcuSelect from "../components/_lib/AcuSelect.vue";
import FormFillVectorPanels from "../components/FormFillVectorPanels.vue";
import FormFillPlotPanels from "../components/FormFillPlotPanels.vue";
import { useApiPresetSelectOptions } from "../composables/useApiPresetSelectOptions";
import { FILL_MODE_INTROS, fillModeCopy } from "../copy/fill-mode-copy";
import { vectorIndexCopy } from "../copy/vector-index-copy";
import {
  FORM_FILL_MODE_OPTIONS,
  useFormFillModeStore,
  type FillMode,
} from "../stores/form-fill-mode-store";

const formFillMode = useFormFillModeStore();
const { followActiveApiLabel, apiPresetSelectOptions } = useApiPresetSelectOptions();

const MODE_ORDER: readonly FillMode[] = ["classic", "vector", "llm", "crossfire"];
const modeIntroList = MODE_ORDER.map((mode) => ({ mode, ...FILL_MODE_INTROS[mode] }));
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
    { id: "fill-mode-intro-panel", label: fillModeCopy.panels.intro.title },
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
  if (showPlotPanels.value) {
    items.push({ id: "fill-mode-plot-panel", label: fillModeCopy.nav.plot });
  }
  return items;
});

function selectFillMode(value: string): void {
  if (value === "classic" || value === "vector" || value === "llm" || value === "crossfire") {
    formFillMode.selectMode(value);
  }
}
</script>

<style scoped>
.acu-v2-fill-mode-page {
  min-height: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--acu-page-gap, 14px);
}

.acu-v2-fill-mode-page__intro-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--acu-space-1, 4px);
  min-width: 0;
}

.acu-v2-fill-mode-page__intro-item {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--acu-space-075, 3px);
  padding: var(--acu-space-250, 10px);
  border: 0;
  border-radius: var(--acu-radius-sm);
  background: transparent;
}

.acu-v2-fill-mode-page__intro-item--active {
  background: var(--acu-bg-2);
}

.acu-v2-fill-mode-page__intro-head {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--acu-space-2, 8px);
}

.acu-v2-fill-mode-page__intro-name {
  min-width: 0;
  color: var(--acu-text-1);
  font-size: var(--acu-font-size-body-lg, 13px);
  font-weight: 650;
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
