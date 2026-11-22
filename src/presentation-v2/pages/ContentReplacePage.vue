<template>
  <section class="acu-v2-content-replace-page">
    <AcuMobilePanelNav :items="panelNavItems" />

    <AcuMessage v-if="store.message" :kind="store.message.kind">
      {{ store.message.text }}
    </AcuMessage>

    <AcuPanelGrid class="acu-v2-content-replace-page__layout">
      <AcuPanel
        id="content-replace-basic-panel"
        :title="contentReplaceCopy.panels.basic.title"
        :description="contentReplaceCopy.panels.basic.description"
      >
        <AcuFormRow
          label="API 预设"
          hint="默认使用当前 API，单独选择后仅影响正文替换。"
        >
          <AcuSelect
            :options="apiOptions"
            :model-value="store.apiPreset"
            :placeholder="followActiveApiLabel"
            @update:model-value="store.setString('apiPreset', $event)"
          />
        </AcuFormRow>

        <div class="acu-v2-content-replace-page__number-grid">
          <AcuFormRow label="最小正文长度" hint="低于此字数跳过优化。">
            <AcuInput
              :model-value="store.minLength"
              type="number"
              :min="0"
              :step="10"
              @change="store.setNumber('minLength', $event)"
            />
          </AcuFormRow>
          <AcuFormRow label="最大替换项数" hint="单次最多接受的修改条数。">
            <AcuInput
              :model-value="store.maxOptimizations"
              type="number"
              :min="1"
              :max="100"
              :step="1"
              @change="store.setNumber('maxOptimizations', $event)"
            />
          </AcuFormRow>
          <AcuFormRow
            label="循环优化次数"
            hint="再次检查优化结果，次数过高会增加等待时间。"
          >
            <AcuInput
              :model-value="store.loopCount"
              type="number"
              :min="1"
              :max="10"
              :step="1"
              @change="store.setNumber('loopCount', $event)"
            />
          </AcuFormRow>
          <AcuFormRow label="自动重试次数" hint="失败时最多重试几次。">
            <AcuInput
              :model-value="store.retryCount"
              type="number"
              :min="1"
              :max="10"
              :step="1"
              @change="store.setNumber('retryCount', $event)"
            />
          </AcuFormRow>
        </div>
      </AcuPanel>

      <AcuPanel
        id="content-replace-mode-panel"
        :title="contentReplaceCopy.panels.mode.title"
        :description="contentReplaceCopy.panels.mode.description"
      >
        <div class="acu-v2-content-replace-page__choice-list">
          <AcuCheckbox
            :model-value="store.seamlessMode"
            label="无感替换模式"
            @update:model-value="store.setBoolean('seamlessMode', $event)"
          />
          <AcuCheckbox
            :model-value="store.autoApply"
            label="自动应用替换结果"
            @update:model-value="store.setBoolean('autoApply', $event)"
          />
          <AcuCheckbox
            :model-value="store.showDiff"
            label="显示优化对比"
            @update:model-value="store.setBoolean('showDiff', $event)"
          />
          <AcuCheckbox
            :model-value="store.parallelMode"
            label="填表与正文替换并行执行"
            @update:model-value="store.setBoolean('parallelMode', $event)"
          />
        </div>

        <div class="acu-v2-content-replace-page__mini-status">
          <span>最近可重新优化</span>
          <strong>{{ store.lastOptimizedLabel }}</strong>
        </div>

        <div class="acu-v2-content-replace-page__actions">
          <AcuButton
            :loading="store.busyAction === 'reoptimize'"
            :disabled="store.lastOptimizedMessageIndex < 0"
            @click="store.reoptimizeLatest"
          >
            <i class="fa-solid fa-rotate-right"></i>
            重新优化最近一次
          </AcuButton>
        </div>
      </AcuPanel>

      <AcuPanel
        id="content-replace-preset-panel"
        :title="contentReplaceCopy.panels.preset.title"
        :description="contentReplaceCopy.panels.preset.description"
      >
        <template #actions>
          <AcuBadge :variant="promptTemplateBadgeVariant">{{
            promptTemplateBadgeLabel
          }}</AcuBadge>
        </template>

        <p class="acu-v2-content-replace-page__status-line">
          当前提示词:
          <strong>{{ store.activePresetLabel }}</strong>
          <span class="acu-v2-content-replace-page__badge">
            {{ store.promptSegmentCount }} 段提示词
          </span>
        </p>

        <div class="acu-v2-content-replace-page__select-row">
          <AcuPresetDropdown
            :items="presetDropdownItems"
            :model-value="store.selectedPresetName"
            default-name=""
            empty-text="暂无正文替换预设"
            placeholder="自定义提示词"
            :show-default-action="false"
            @update:model-value="store.selectPreset($event)"
          />
          <AcuIconButton
            icon="fa-solid fa-pen"
            :title="
              canEditCurrentPrompt
                ? '编辑当前提示词'
                : '默认预设不能直接编辑，请从默认新建后修改'
            "
            :disabled="!canEditCurrentPrompt"
            @click="openPromptDrawerForCurrent"
          />
          <AcuFileButton
            icon-only
            title="导入预设 JSON"
            accept="application/json,.json"
            :disabled="!!store.busyAction"
            @file="store.importPresets"
          >
            <i class="fa-solid fa-download"></i>
          </AcuFileButton>
          <AcuIconButton
            icon="fa-solid fa-gear"
            title="管理预设"
            @click="presetDrawerOpen = true"
          />
        </div>

        <AcuMessage v-if="promptGroupMissingContent" kind="warning">
          正文替换提示词缺少
          $CONTENT，占位符为空时运行时无法知道要检查哪段正文；请打开编辑器载入默认提示词或补回占位符。
        </AcuMessage>
      </AcuPanel>

      <AcuPanel
        id="content-replace-filter-panel"
        :title="contentReplaceCopy.panels.filter.title"
        :description="contentReplaceCopy.panels.filter.description"
      >
        <div class="acu-v2-content-replace-page__form-grid">
          <AcuFormRow label="提取标签" hint="多个标签用逗号分隔，留空不提取。">
            <AcuInput
              :model-value="store.extractTags"
              type="text"
              placeholder="例如: content,正文"
              @update:model-value="
                store.setString('extractTags', String($event))
              "
            />
          </AcuFormRow>
          <AcuFormRow label="排除标签" hint="多个标签用逗号分隔，留空不排除。">
            <AcuInput
              :model-value="store.excludeTags"
              type="text"
              placeholder="例如: think,thinking"
              @update:model-value="
                store.setString('excludeTags', String($event))
              "
            />
          </AcuFormRow>
        </div>

        <div class="acu-v2-content-replace-page__rule-stack">
          <AcuRulePairList
            label="正文标签提取规则"
            :model-value="store.extractRules"
            start-placeholder="开始词（例如：<content>）"
            end-placeholder="结束词（例如：</content>）"
            add-label="添加提取规则"
            @update:model-value="store.setExtractRules"
          />
          <AcuRulePairList
            label="标签排除规则"
            :model-value="store.excludeRules"
            start-placeholder="开始词（例如：<think>）"
            end-placeholder="结束词（例如：</think>）"
            add-label="添加排除规则"
            @update:model-value="store.setExcludeRules"
          />
        </div>
      </AcuPanel>

      <AcuPanel
        id="content-replace-test-panel"
        :title="contentReplaceCopy.panels.test.title"
        :description="contentReplaceCopy.panels.test.description"
      >
        <AcuFormRow
          label="测试文本"
          hint="输入一段测试正文，用来验证提示词和返回格式。"
        >
          <AcuTextarea
            :model-value="store.testInput"
            :rows="5"
            placeholder="输入模拟正文，验证提示词与返回格式。"
            @update:model-value="store.setString('testInput', $event)"
          />
        </AcuFormRow>

        <div class="acu-v2-content-replace-page__actions">
          <AcuButton
            variant="primary"
            :loading="store.busyAction === 'test'"
            @click="store.runTest"
          >
            执行优化测试
          </AcuButton>
        </div>

        <pre
          v-if="store.testOutput"
          class="acu-v2-content-replace-page__test-output"
          >{{ store.testOutput }}</pre
        >
      </AcuPanel>
    </AcuPanelGrid>

    <ContentReplacePresetDrawer
      :is-open="presetDrawerOpen"
      :presets="store.promptPresets"
      :message="store.message"
      @close="presetDrawerOpen = false"
      @create-from-default="store.createPresetFromDefault"
      @edit="onEditPreset"
      @rename="onRenamePreset"
      @delete="onDeletePreset"
      @export="store.exportPresetByName($event)"
    />

    <ContentReplacePromptDrawer
      :is-open="promptDrawerOpen"
      :segments="promptSegmentsForView"
      :dirty="store.promptDirty"
      :message="store.message"
      @close="closePromptDrawer"
      @save="onSavePromptGroup"
      @reset="onResetPromptGroup"
      @add="store.addPromptSegment($event)"
      @delete="store.deletePromptSegment($event)"
      @update="onPromptUpdate"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import AcuBadge, {
  type AcuBadgeVariant,
} from "../components/_lib/AcuBadge.vue";
import AcuButton from "../components/_lib/AcuButton.vue";
import AcuCheckbox from "../components/_lib/AcuCheckbox.vue";
import AcuFileButton from "../components/_lib/AcuFileButton.vue";
import AcuFormRow from "../components/_lib/AcuFormRow.vue";
import AcuIconButton from "../components/_lib/AcuIconButton.vue";
import AcuInput from "../components/_lib/AcuInput.vue";
import AcuMessage from "../components/_lib/AcuMessage.vue";
import AcuMobilePanelNav from "../components/_lib/AcuMobilePanelNav.vue";
import AcuPanel from "../components/_lib/AcuPanel.vue";
import AcuPanelGrid from "../components/_lib/AcuPanelGrid.vue";
import AcuPresetDropdown, {
  type PresetDropdownItem,
} from "../components/_lib/AcuPresetDropdown.vue";
import type { PromptSegment } from "../components/_lib/AcuPromptSegments.vue";
import AcuRulePairList from "../components/_lib/AcuRulePairList.vue";
import AcuSelect from "../components/_lib/AcuSelect.vue";
import AcuTextarea from "../components/_lib/AcuTextarea.vue";
import ContentReplacePresetDrawer from "../components/ContentReplacePresetDrawer.vue";
import ContentReplacePromptDrawer from "../components/ContentReplacePromptDrawer.vue";
import { useApiPresetSelectOptions } from "../composables/useApiPresetSelectOptions";
import { useChatChangedTick } from "../composables/useChatChangedListener";
import { useUiCloseGuard } from "../composables/useUiCloseGuard";
import { contentReplaceCopy } from "../copy/content-replace-copy";
import {
  CUSTOM_CONTENT_REPLACE_PRESET_VALUE,
  useContentReplaceStore,
  type ContentReplacePromptSegment,
} from "../stores/content-replace-store";
import { useDialogStore } from "../stores/dialog-store";

const store = useContentReplaceStore();
const dialogStore = useDialogStore();
const {
  apiStore,
  followActiveApiLabel,
  apiPresetSelectOptions: apiOptions,
} = useApiPresetSelectOptions();
const presetDrawerOpen = ref(false);
const promptDrawerOpen = ref(false);
const editingPresetName = ref("");
const panelNavItems = [
  { id: "content-replace-basic-panel", label: contentReplaceCopy.nav.basic },
  { id: "content-replace-mode-panel", label: contentReplaceCopy.nav.mode },
  { id: "content-replace-preset-panel", label: contentReplaceCopy.nav.preset },
  { id: "content-replace-filter-panel", label: contentReplaceCopy.nav.filter },
  { id: "content-replace-test-panel", label: contentReplaceCopy.nav.test },
];

const presetDropdownItems = computed<PresetDropdownItem[]>(() =>
  store.selectedPresetName === CUSTOM_CONTENT_REPLACE_PRESET_VALUE
    ? [
        {
          value: CUSTOM_CONTENT_REPLACE_PRESET_VALUE,
          label: "自定义提示词",
          meta: "未保存为预设",
        },
        {
          value: "",
          label: "默认预设",
          meta: `${store.defaultPromptSegmentCount} 段提示词`,
        },
        ...store.promptPresets.map((preset) => ({
          value: preset.name,
          label: preset.name,
          meta: `${preset.promptGroup.length} 段提示词`,
        })),
      ]
    : [
        {
          value: "",
          label: "默认预设",
          meta: `${store.defaultPromptSegmentCount} 段提示词`,
        },
        ...store.promptPresets.map((preset) => ({
          value: preset.name,
          label: preset.name,
          meta: `${preset.promptGroup.length} 段提示词`,
        })),
      ],
);

const promptSegmentsForView = computed<PromptSegment[]>(() =>
  store.promptGroup.map((segment) => ({
    role: segment.role,
    content: segment.content,
    deletable: segment.deletable,
    mainSlot: segment.mainSlot,
    isMain: segment.isMain,
    isMain2: segment.isMain2,
  })),
);

const promptGroupMissingContent = computed(
  () =>
    !store.promptGroup.some((segment) =>
      String(segment.content || "").includes("$CONTENT"),
    ),
);
const promptTemplateBadgeLabel = computed(() =>
  store.promptTemplateMode === "default" ? "使用默认提示词" : "已自定义提示词",
);
const promptTemplateBadgeVariant = computed<AcuBadgeVariant>(() =>
  store.promptTemplateMode === "default" ? "neutral" : "accent",
);
const canEditCurrentPrompt = computed(() => store.selectedPresetName !== "");

async function onDeletePreset(name: string): Promise<void> {
  if (!name) return;
  const confirmed = await dialogStore.confirm({
    title: "删除正文替换预设",
    message: `删除正文替换预设"${name}"？`,
    confirmLabel: "删除预设",
    confirmVariant: "danger",
  });
  if (!confirmed) return;
  store.deletePresetByName(name);
}

async function onRenamePreset(name: string): Promise<void> {
  const next = await dialogStore.prompt({
    title: "重命名正文替换预设",
    message: `将正文替换预设"${name}"重命名为：`,
    label: "预设名称",
    defaultValue: name,
    confirmLabel: "重命名",
  });
  if (!next) return;
  store.renamePreset(name, next);
}

function onEditPreset(name: string): void {
  store.selectPreset(name);
  editingPresetName.value = name;
  presetDrawerOpen.value = false;
  promptDrawerOpen.value = true;
}

function openPromptDrawerForCurrent(): void {
  editingPresetName.value = store.hasSelectedPreset
    ? store.selectedPresetName
    : "";
  promptDrawerOpen.value = true;
}

function closePromptDrawer(): void {
  promptDrawerOpen.value = false;
  editingPresetName.value = "";
}

function onSavePromptGroup(): void {
  if (editingPresetName.value)
    store.savePromptGroupToPreset(editingPresetName.value);
  else store.savePromptGroup();
}

async function onResetPromptGroup(): Promise<void> {
  const confirmed = await dialogStore.confirm({
    title: "载入默认提示词组",
    message:
      "载入默认正文替换提示词组？这会覆盖当前编辑器里的提示词内容，需要保存后才会生效。",
    confirmLabel: "载入默认",
    confirmVariant: "danger",
  });
  if (!confirmed)
    return;
  store.resetPromptGroup();
}

function onPromptUpdate(index: number, patch: Partial<PromptSegment>): void {
  store.updatePromptSegment(
    index,
    patch as Partial<ContentReplacePromptSegment>,
  );
}

function confirmPromptClose(): boolean | Promise<boolean> {
  if (!promptDrawerOpen.value || !store.promptDirty) return true;
  return dialogStore.confirm({
    title: "关闭新 UI",
    message: "你有未保存的正文替换提示词修改，确定要关闭新 UI 吗？",
    confirmLabel: "关闭新 UI",
    confirmVariant: "danger",
  });
}

function refreshAll(): void {
  store.refreshFromSettings();
  apiStore.refreshFromSettings();
}

onMounted(refreshAll);
watch(useChatChangedTick(), refreshAll);
useUiCloseGuard(confirmPromptClose);
</script>

<style scoped>
.acu-v2-content-replace-page {
  min-height: 100%;
  min-width: 0;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.acu-v2-content-replace-page__mini-status span {
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-caption, 11px);
  line-height: 1.5;
}

.acu-v2-content-replace-page__number-grid,
.acu-v2-content-replace-page__form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.acu-v2-content-replace-page__choice-list,
.acu-v2-content-replace-page__rule-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.acu-v2-content-replace-page__mini-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 0;
  border: 0;
  border-top: 1px solid color-mix(in srgb, var(--acu-text-3) 14%, transparent);
  border-bottom: 1px solid
    color-mix(in srgb, var(--acu-text-3) 14%, transparent);
  border-radius: 0;
  background: transparent;
}

.acu-v2-content-replace-page__mini-status strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--acu-text-2);
  font-size: var(--acu-font-size-body, 12px);
  font-family: var(--acu-font-mono);
}

.acu-v2-content-replace-page__status-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 0 0 10px;
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-body, 12px);
}

.acu-v2-content-replace-page__status-line strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--acu-text-1);
  font-size: var(--acu-font-size-body, 12px);
  font-family: var(--acu-font-mono);
}

.acu-v2-content-replace-page__badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: var(--acu-radius-sm);
  background: color-mix(in srgb, var(--acu-text-3) 16%, transparent);
  color: var(--acu-text-2);
  font-size: var(--acu-font-size-caption, 11px);
  font-weight: 500;
}

.acu-v2-content-replace-page__select-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) repeat(3, max-content);
  gap: 6px;
  align-items: stretch;
  min-width: 0;
}

.acu-v2-content-replace-page__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
  padding-top: 12px;
  margin-top: 4px;
}

.acu-v2-content-replace-page__test-output {
  margin: 0;
  max-height: 280px;
  overflow: auto;
  padding: 10px 0;
  border: 0;
  border-top: 1px solid color-mix(in srgb, var(--acu-text-3) 14%, transparent);
  border-bottom: 1px solid
    color-mix(in srgb, var(--acu-text-3) 14%, transparent);
  border-radius: 0;
  background: transparent;
  color: var(--acu-text-2);
  font-family: var(--acu-font-mono);
  font-size: var(--acu-font-size-caption, 11px);
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 860px) {
  .acu-v2-content-replace-page {
    padding: 14px;
  }

  .acu-v2-content-replace-page__number-grid,
  .acu-v2-content-replace-page__form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
