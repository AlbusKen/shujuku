<template>
  <AcuPanel
    :title="tableCopy.panels.templatePreset.title"
    :description="tableCopy.panels.templatePreset.description"
  >
    <AcuMessage v-if="templates.message.value" :kind="templates.message.value.kind">
      {{ templates.message.value.text }}
    </AcuMessage>
    <AcuMessage v-if="management.message.value" :kind="management.message.value.kind">
      {{ management.message.value.text }}
    </AcuMessage>

    <AcuText variant="status-line" class="acu-table-template-panel__status-line">
      当前聊天: <strong class="acu-text__value">{{ templates.selectedChatPresetLabel.value }}</strong>
      <template v-if="templates.selectedGlobalPreset.value"> · 全局默认: <strong class="acu-text__value">{{ templates.selectedGlobalPreset.value }}</strong></template>
      <template v-else> · 全局默认: <strong class="acu-text__value">默认预设</strong></template>
      <AcuBadge :variant="templates.isChatOverridden.value ? 'accent' : 'neutral'">
        {{ templates.isChatOverridden.value ? '已覆盖' : '跟随全局' }}
      </AcuBadge>
      <AcuBadge v-if="templates.runtimeDiffersFromLibrary.value" variant="warning">
        当前生效模板与预设库内容不同
      </AcuBadge>
      <AcuBadge v-if="templates.chatSnapshotDiffersFromLibrary.value" variant="warning">
        聊天快照内容已偏离库中同名预设
      </AcuBadge>
    </AcuText>

    <div class="acu-table-template-panel__preset-row">
      <AcuPresetDropdown
        :items="templates.chatPresetItems.value"
        :model-value="templates.selectedChatPreset.value"
        :default-name="templates.selectedGlobalPresetValue.value"
        :disabled="templates.busy.value || management.busy.value"
        placeholder="默认预设"
        @update:model-value="templates.selectChatPreset($event)"
        @set-default="templates.selectGlobalPreset($event)"
      />
      <AcuFileButton
        icon-only
        title="导入模板 JSON"
        accept="application/json,.json"
        :disabled="templates.busy.value || management.busy.value"
        @file="templates.importPresetForCurrentChat($event)"
      >
        <i class="fa-solid fa-download"></i>
      </AcuFileButton>
      <AcuIconButton
        icon="fa-solid fa-upload"
        title="导出当前生效模板"
        :disabled="templates.busy.value || management.busy.value || !templates.runtimeTemplateAvailable.value"
        @click="templates.exportTemplate('runtime')"
      />
      <AcuIconButton
        icon="fa-solid fa-clock-rotate-left"
        title="恢复历史模板归档"
        :disabled="templates.busy.value || management.busy.value || templates.chatArchiveItems.value.length === 0"
        @click="templates.restoreArchivedChatTemplate"
      />
      <AcuIconButton
        v-if="templates.isChatOverridden.value"
        icon="fa-solid fa-link-slash"
        title="跟随全局（清除聊天覆盖）"
        :disabled="templates.busy.value || management.busy.value"
        @click="templates.followGlobalTemplate"
      />
      <AcuIconButton
        icon="fa-solid fa-gear"
        title="管理表格模板预设"
        :disabled="management.busy.value"
        @click="management.openManage"
      />
    </div>

    <div class="acu-table-template-panel__action-area">
      <AcuButton
        variant="primary"
        class="acu-table-template-panel__visualizer-button"
        title="打开可视化表格编辑器"
        :disabled="templates.busy.value || management.busy.value"
        @click="management.openVisualizer"
      >
        <i class="fa-solid fa-table-columns"></i>
        打开可视化表格编辑器
      </AcuButton>
    </div>

    <TablePresetDrawer
      :is-open="management.isDrawerOpen.value"
      :title="management.title.value"
      :busy="management.busy.value"
      :message="management.message.value"
      :preset-meta="management.presetMeta.value"
      :default-preset-name="management.defaultPresetName.value"
      @close="management.closeDrawer"
      @create-blank="management.createBlankPreset"
      @set-default="management.setAsDefault($event)"
      @export="management.exportPreset($event)"
      @rename="management.renamePreset($event)"
      @edit="management.editPreset($event)"
      @delete="management.deletePreset($event)"
    />
  </AcuPanel>
</template>

<script setup lang="ts">
import { onMounted, watch } from 'vue';
import AcuBadge from './_lib/AcuBadge.vue';
import AcuButton from './_lib/AcuButton.vue';
import AcuFileButton from './_lib/AcuFileButton.vue';
import AcuMessage from './_lib/AcuMessage.vue';
import AcuIconButton from './_lib/AcuIconButton.vue';
import AcuPanel from './_lib/AcuPanel.vue';
import AcuPresetDropdown from './_lib/AcuPresetDropdown.vue';
import AcuText from './_lib/AcuText.vue';
import TablePresetDrawer from './TablePresetDrawer.vue';
import { useChatChangedTick } from '../composables/useChatChangedListener';
import { useTemplateRuntimeChangeTick } from '../composables/useTemplateRuntimeChangeListener';
import { useTablePresetManagement } from '../composables/useTablePresetManagement';
import { useTableTemplatePresets } from '../composables/useTableTemplatePresets';
import { tableCopy } from '../copy/table-copy';

const templates = useTableTemplatePresets();
const management = useTablePresetManagement();

function refreshAll(): void {
  templates.refresh();
  management.refresh();
}

onMounted(refreshAll);
watch(useChatChangedTick(), refreshAll);
watch(useTemplateRuntimeChangeTick(), refreshAll);
</script>

<style scoped>
.acu-table-template-panel__status-line {
  margin: 0 0 10px;
  font-size: var(--acu-font-size-body, 12px);
  line-height: var(--acu-line-height-body, 1.45);
}

.acu-table-template-panel__preset-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) repeat(4, max-content);
  gap: 6px;
  align-items: stretch;
  min-width: 0;
}

.acu-table-template-panel__action-area {
  margin-top: 10px;
}

.acu-table-template-panel__visualizer-button {
  width: 100%;
}

</style>
