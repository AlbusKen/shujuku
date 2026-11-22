<template>
  <section class="acu-v2-developer-page">
    <AcuPanelGrid class="acu-v2-developer-page__grid">
      <AcuPanel
        :title="developerCopy.panels.gatedFields.title"
        :description="developerCopy.panels.gatedFields.description"
      >
        <div class="acu-v2-developer-page__toggle-list">
          <ToggleRow
            v-for="item in toggles"
            :key="item.key"
            :item="item"
            @change="handleToggleChange(item.key, $event)"
          />
        </div>
      </AcuPanel>

      <AcuPanel
        title="填表高级选项"
        description="仅在需要严格约束 AI 填表格式时开启，开启后会切到更严格的提示词和解析规则。"
      >
        <div class="acu-v2-developer-page__toggle-list">
          <ToggleRow
            :item="strictJsonTableFillToggle"
            @change="settings.setStrictJsonTableFillEnabled($event)"
          />
        </div>
      </AcuPanel>

      <AcuPanel
        :title="developerCopy.panels.formFillRuntime.title"
        :description="developerCopy.panels.formFillRuntime.description"
      >
        <AcuFormRow
          label="最大并发更新组数"
          hint="大于 1 时多组表格会同时调用填表 API。越大越快，但 API 压力和排查难度也越高。"
        >
          <AcuInput
            type="number"
            :min="1"
            :step="1"
            :model-value="maxConcurrentGroups"
            @change="settings.setNumber('maxConcurrentGroups', $event)"
          />
        </AcuFormRow>
      </AcuPanel>
    </AcuPanelGrid>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import AcuFormRow from "../components/_lib/AcuFormRow.vue";
import AcuInput from "../components/_lib/AcuInput.vue";
import AcuPanel from "../components/_lib/AcuPanel.vue";
import AcuPanelGrid from "../components/_lib/AcuPanelGrid.vue";
import ToggleRow from "../components/DashboardToggleRow.vue";
import { useDevOptions } from "../composables/useDevOptions";
import { useFormFillSettings } from "../composables/useFormFillSettings";
import { developerCopy } from "../copy/developer-copy";

const devOptions = useDevOptions();
const settings = useFormFillSettings();

interface DeveloperFieldItem {
  key: string;
  label: string;
  description: string;
  value: boolean;
}

const toggles = computed<DeveloperFieldItem[]>(() => [
  {
    key: "plotAdvanced",
    label: "剧情推进",
    description: '在编辑剧情推进预设的侧抽屉中显示"匹配替换"字段。',
    value: devOptions.plotAdvanced.value,
  },
  {
    key: "legacyUiMenuVisible",
    label: "旧 UI 入口",
    description: "在酒馆扩展菜单中显示旧版 UI 入口。默认隐藏，新界面出问题时可临时开启。",
    value: devOptions.legacyUiMenuVisible.value,
  },
]);
const strictJsonTableFillToggle = computed<DeveloperFieldItem>(() => ({
  key: "strictJsonTableFillEnabled",
  label: "严格 JSON 填表响应",
  description: "默认关闭。开启后要求 AI 按更严格的 JSON 格式输出改表指令。",
  value: settings.strictJsonTableFillEnabled.value,
}));
const maxConcurrentGroups = computed(
  () =>
    settings.numberFields.value.find(
      (field) => field.key === "maxConcurrentGroups",
    )?.value ?? 1,
);

function handleToggleChange(key: string, value: boolean): void {
  if (key === "plotAdvanced") {
    devOptions.setPlotAdvanced(value);
  }
  if (key === "legacyUiMenuVisible") {
    devOptions.setLegacyUiMenuVisible(value);
  }
}
</script>

<style scoped>
.acu-v2-developer-page {
  min-height: 100%;
  min-width: 0;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.acu-v2-developer-page__toggle-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

@media (max-width: 860px) {
  .acu-v2-developer-page {
    padding: 14px;
  }
}
</style>
