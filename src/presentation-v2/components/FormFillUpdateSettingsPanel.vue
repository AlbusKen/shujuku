<template>
  <AcuPanel
    :title="formFillCopy.panels.update.title"
    :description="formFillCopy.panels.update.description"
  >
    <div class="acu-form-fill-update-settings-panel__settings-groups">
      <section class="acu-form-fill-update-settings-panel__setting-group">
        <AcuFormRow
          label="填表 API 预设"
          hint="默认使用当前 API，单独选择后仅影响填表功能。"
        >
          <AcuSelect
            :options="tableApiPresetOptions"
            :model-value="settings.tableApiPreset.value"
            :placeholder="followActiveApiLabel"
            @update:model-value="settings.setTableApiPreset($event)"
          />
        </AcuFormRow>

        <AcuFormRow
          label="自动填表间隔"
          hint="每累计到指定数量的 AI 回复，自动填表一次。"
        >
          <AcuSelect
            :options="updateEveryOptions"
            :model-value="selectedUpdateEvery"
            :placeholder="selectedUpdateEvery === 'custom' ? '自定义' : '选择更新间隔'"
            @update:model-value="applyUpdateEvery"
          />
        </AcuFormRow>

        <AcuFormRow
          :label="skipLatestLayerLabel"
          :hint="skipLatestLayerHint"
        >
          <AcuToggle
            :model-value="skipLatestLayer"
            @update:model-value="setSkipLatestLayer"
          />
        </AcuFormRow>
      </section>

      <AcuDisclosureGroup
        v-if="showAdvanced"
        class="acu-form-fill-update-settings-panel__advanced"
        label="高级参数"
        :meta="advancedMetaLabel"
        :expanded="advancedExpanded"
        body-id="acu-form-fill-update-advanced"
        body-mode="if"
        @toggle="advancedExpanded = !advancedExpanded"
      >
        <div class="acu-form-fill-update-settings-panel__number-grid">
          <AcuFormRow
            v-for="field in advancedFields"
            :key="field.key"
            :label="field.label"
            :hint="field.hint"
          >
            <AcuInput
              type="number"
              :min="field.min"
              :step="field.step"
              :model-value="field.value"
              @change="settings.setNumber(field.key, $event)"
            />
          </AcuFormRow>
        </div>
      </AcuDisclosureGroup>
    </div>
  </AcuPanel>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useChatChangedTick } from "../composables/useChatChangedListener";
import { useApiPresetSelectOptions } from "../composables/useApiPresetSelectOptions";
import {
  useFormFillSettings,
  type NumberSettingKey,
} from "../composables/useFormFillSettings";
import { formFillCopy } from "../copy/form-fill-copy";
import AcuDisclosureGroup from "./_lib/AcuDisclosureGroup.vue";
import AcuFormRow from "./_lib/AcuFormRow.vue";
import AcuInput from "./_lib/AcuInput.vue";
import AcuPanel from "./_lib/AcuPanel.vue";
import AcuSelect, { type AcuSelectOption } from "./_lib/AcuSelect.vue";
import AcuToggle from "./_lib/AcuToggle.vue";

type UpdateEveryId = "1" | "3" | "5" | "custom";

withDefaults(
  defineProps<{
    showAdvanced?: boolean;
  }>(),
  {
    showAdvanced: true,
  },
);

const settings = useFormFillSettings();
const {
  apiStore,
  followActiveApiLabel,
  apiPresetSelectOptions: tableApiPresetOptions,
} = useApiPresetSelectOptions();
const advancedExpanded = ref(false);

const updateEveryOptions: AcuSelectOption[] = [
  { value: "1", label: "每 1 层：最及时" },
  { value: "3", label: "每 3 层：均衡" },
  { value: "5", label: "每 5 层：低频省 API" },
];
const advancedKeys = new Set<NumberSettingKey>([
  "autoUpdateThreshold",
  "autoUpdateFrequency",
  "updateBatchSize",
  "skipUpdateFloors",
  "autoUpdateTokenThreshold",
  "tableFillMinResponseLength",
  "tableMaxRetries",
]);

const advancedFields = computed(() =>
  settings.numberFields.value.filter((field) => advancedKeys.has(field.key)),
);
const advancedMetaLabel = computed(() => (isCustomCadence.value || isCustomSkip.value ? "自定义" : "默认"));
const selectedUpdateEvery = computed<UpdateEveryId>(() => {
  for (const id of ["1", "3", "5"] as const) {
    const interval = Number(id);
    if (
      numberValue("autoUpdateThreshold") ===
        contextDepthForInterval(interval) &&
      numberValue("autoUpdateFrequency") === interval &&
      numberValue("updateBatchSize") === batchSizeForInterval(interval)
    ) {
      return id;
    }
  }
  return "custom";
});

const isCustomCadence = computed(() => selectedUpdateEvery.value === "custom");
const isCustomSkip = computed(() => numberValue("skipUpdateFloors") > 1);
const skipLatestLayer = computed(() => numberValue("skipUpdateFloors") >= 1);
const skipLatestLayerLabel = computed(() =>
  isCustomSkip.value ? "最新层不填表：自定义" : "最新层不填表",
);
const skipLatestLayerHint = computed(() => {
  const skip = numberValue("skipUpdateFloors");
  if (skip > 1) {
    return `当前高级参数设置为跳过最新 ${skip} 层；关闭会改为不跳过，开启会改为只让最新层不填表。`;
  }
  return "开启后，最新一条 AI 回复先不写入表格，等下一层出现后再处理；建议在经常需要重roll最新楼层时开启。";
});

function numberValue(
  key:
    | "autoUpdateThreshold"
    | "autoUpdateFrequency"
    | "updateBatchSize"
    | "skipUpdateFloors",
): number {
  return (
    settings.numberFields.value.find((field) => field.key === key)?.value ?? 0
  );
}

function contextDepthForInterval(interval: number): number {
  return interval <= 3 ? 3 : interval;
}

function batchSizeForInterval(interval: number): number {
  return interval === 1 ? 3 : interval;
}

function applyUpdateEvery(value: string): void {
  const interval = Number(value);
  if (!Number.isFinite(interval) || interval < 1) return;
  settings.setNumbers({
    autoUpdateThreshold: contextDepthForInterval(interval),
    autoUpdateFrequency: interval,
    updateBatchSize: batchSizeForInterval(interval),
  });
}

function setSkipLatestLayer(value: boolean): void {
  settings.setNumber("skipUpdateFloors", value ? 1 : 0);
}

function refreshAll(): void {
  settings.refresh();
  apiStore.refreshFromSettings();
}

onMounted(refreshAll);
watch(useChatChangedTick(), refreshAll);
</script>

<style scoped>
.acu-form-fill-update-settings-panel__settings-groups {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.acu-form-fill-update-settings-panel__setting-group {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.acu-form-fill-update-settings-panel__setting-group
  + .acu-form-fill-update-settings-panel__setting-group {
  padding-top: 14px;
  border-top: 1px solid var(--acu-border-2);
}

.acu-form-fill-update-settings-panel__advanced {
  border: 0;
  background: transparent;
}

.acu-form-fill-update-settings-panel__number-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

@media (max-width: 560px) {
  .acu-form-fill-update-settings-panel__number-grid {
    grid-template-columns: 1fr;
  }
}
</style>
