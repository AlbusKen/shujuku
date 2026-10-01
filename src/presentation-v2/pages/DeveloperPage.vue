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
        description="仅在需要严格约束模型填表响应时开启。开启后将切换到隔离提示词和严格 JSON 解析链路。"
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
          hint="大于 1 时，多个表格分组可能同时调用填表 API。数值越大越快，但 API 压力和失败后排查难度也越高。"
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
    description: "在 SillyTavern 扩展菜单中显示旧 UI 入口。默认隐藏；新 UI 出问题时可临时开启。",
    value: devOptions.legacyUiMenuVisible.value,
  },
]);
const strictJsonTableFillToggle = computed<DeveloperFieldItem>(() => ({
  key: "strictJsonTableFillEnabled",
  label: "严格 JSON 填表响应",
  description: "默认关闭。开启后原生表格输出结构化操作，SQLite 输出 JSON 包裹的 SQL 脚本。",
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
