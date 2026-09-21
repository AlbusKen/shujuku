<template>
  <section class="acu-v2-table-page">
    <AcuMobilePanelNav :items="panelNavItems" />

    <AcuPanelGrid class="acu-v2-table-page__grid">
      <div class="acu-v2-table-page__col">
        <AcuPanel
          id="table-entries-panel"
          :title="tableCopy.panels.entries.title"
          :description="tableCopy.panels.entries.description"
        >
          <WorldbookEntryPickerBody
            :source="entriesSource.source.value"
            :selected-names="entriesSource.manualSelection.value"
            :names="entriesWb.names.value"
            :selector-status="entriesWb.status.value"
            :selector-error="entriesWb.error.value"
            :current-label="entriesSourceLabel"
            v-model:filter="entryFilter"
            :groups="entries.groups.value"
            :loading="entries.status.value === 'loading'"
            :empty-text="entryEmptyText"
            @update:source="onEntriesSourceChange($event)"
            @toggle-book="onEntriesManualBookToggle"
            @select-all="entries.selectAll()"
            @deselect-all="entries.deselectAll()"
            @toggle="(bookName: string, uid: number, checked: boolean) => entries.toggleEntry(bookName, uid, checked)"
            @toggle-group="entries.toggleGroupExpanded($event)"
          />
        </AcuPanel>

        <AcuPanel
          id="table-prompt-panel"
          :title="formFillCopy.panels.prompt.title"
          :description="formFillCopy.panels.prompt.description"
        >
          <template #actions>
            <AcuBadge :variant="promptTemplateBadgeVariant">{{
              promptTemplateBadgeLabel
            }}</AcuBadge>
          </template>

          <AcuMessage
            v-if="!promptSlotSummary.hasA || !promptSlotSummary.hasB"
            kind="warning"
          >
            填表提示词缺少必要主插槽，建议在编辑器里载入默认提示词后保存。
          </AcuMessage>

          <div class="acu-v2-table-page__actions">
            <AcuButton variant="primary" @click="promptDrawerOpen = true">
              编辑提示词
            </AcuButton>
          </div>
        </AcuPanel>
      </div>

      <div class="acu-v2-table-page__col">
        <AcuPanel
          id="table-filter-panel"
          :title="formFillCopy.panels.filter.title"
          :description="formFillCopy.panels.filter.description"
        >
          <div class="acu-v2-table-page__filter">
            <div class="acu-v2-table-page__toggle-row">
              <div class="acu-v2-table-page__toggle-head">
                <span class="acu-v2-table-page__toggle-label">
                  丢弃纯越权 SQL 语句
                </span>
                <AcuToggle
                  :model-value="settings.discardUnauthorizedTableEditsEnabled.value"
                  aria-label="丢弃纯越权 SQL 语句"
                  data-acu-setting-key="discardUnauthorizedTableEditsEnabled"
                  @update:model-value="settings.setDiscardUnauthorizedTableEditsEnabled($event)"
                />
              </div>
              <p class="acu-v2-table-page__toggle-desc">
                默认开启。仅丢弃可证明只影响非目标表的独立 SQL；跨目标表或无法归属的语句仍会拒绝并重试。
              </p>
            </div>

            <div class="acu-v2-table-page__toggle-row">
              <div class="acu-v2-table-page__toggle-head">
                <span class="acu-v2-table-page__toggle-label">
                  仅识别最后一对 &lt;tableEdit&gt; 标签
                </span>
                <AcuToggle
                  :model-value="settings.tableEditLastPairOnly.value"
                  aria-label="仅识别最后一对 tableEdit 标签"
                  data-acu-setting-key="tableEditLastPairOnly"
                  @update:model-value="settings.setTableEditLastPairOnly($event)"
                />
              </div>
              <p class="acu-v2-table-page__toggle-desc">
                默认开启，用于忽略前面思维链或草稿里的旧指令。
              </p>
            </div>

            <AcuRulePairList
              label="提取规则"
              :model-value="settings.extractRules.value"
              start-placeholder="提取开始边界"
              end-placeholder="提取结束边界"
              add-label="添加提取规则"
              @update:model-value="settings.setExtractRules($event)"
            />

            <AcuRulePairList
              label="排除规则"
              :model-value="settings.excludeRules.value"
              start-placeholder="排除开始边界"
              end-placeholder="排除结束边界"
              add-label="添加排除规则"
              @update:model-value="settings.setExcludeRules($event)"
            />
          </div>
        </AcuPanel>

        <AcuPanel
          id="table-injection-target-panel"
          :title="tableCopy.panels.injectionTarget.title"
          :description="tableCopy.panels.injectionTarget.description"
        >
          <DanglingReferenceBanner scope="worldbook" />
          <WorldbookSelector
            :model-value="injectionTarget.selectorValue.value"
            :names="injectionWb.names.value"
            :char-primary="injectionWb.charPrimary.value"
            :status="injectionWb.status.value"
            :error="injectionWb.error.value"
            show-character-option
            character-option-label="角色卡绑定世界书"
            filterable
            @update:model-value="onInjectionTargetChange($event)"
          />
          <p class="acu-v2-table-page__hint">
            目前已选: <strong>{{ injectionTargetLabel }}</strong>
          </p>
        </AcuPanel>
      </div>
    </AcuPanelGrid>

    <FormFillPromptDrawer
      :is-open="promptDrawerOpen"
      :segments="settings.promptSegments.value"
      :dirty="settings.promptDirty.value"
      :message="promptMessage"
      @close="promptDrawerOpen = false"
      @save="settings.savePrompt"
      @reset="settings.resetPrompt"
      @import-file="settings.importPromptFile($event)"
      @export="settings.exportPrompt"
      @add="settings.addPromptSegment($event)"
      @delete="settings.deletePromptSegment($event)"
      @update="updatePromptSegment"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import AcuBadge, { type AcuBadgeVariant } from '../components/_lib/AcuBadge.vue';
import AcuButton from '../components/_lib/AcuButton.vue';
import AcuMessage from '../components/_lib/AcuMessage.vue';
import AcuMobilePanelNav from '../components/_lib/AcuMobilePanelNav.vue';
import AcuPanel from '../components/_lib/AcuPanel.vue';
import AcuPanelGrid from '../components/_lib/AcuPanelGrid.vue';
import AcuRulePairList from '../components/_lib/AcuRulePairList.vue';
import AcuToggle from '../components/_lib/AcuToggle.vue';
import FormFillPromptDrawer from '../components/FormFillPromptDrawer.vue';
import DanglingReferenceBanner from '../components/DanglingReferenceBanner.vue';
import WorldbookSelector from '../components/WorldbookSelector.vue';
import WorldbookEntryPickerBody from '../components/WorldbookEntryPickerBody.vue';
import { useChatChangedTick } from '../composables/useChatChangedListener';
import { useFormFillInjectionTarget } from '../composables/useFormFillInjectionTarget';
import {
  useFormFillSettings,
  type FormFillPromptSegment,
} from '../composables/useFormFillSettings';
import { useFormFillWorldbookConfig } from '../composables/useFormFillWorldbookConfig';
import { useFormFillWorldbookEntries } from '../composables/useFormFillWorldbookEntries';
import { useUiCloseGuard } from '../composables/useUiCloseGuard';
import { useWorldbookSelector } from '../composables/useWorldbookSelector';
import { formFillCopy } from '../copy/form-fill-copy';
import { tableCopy } from '../copy/table-copy';
import { useDialogStore } from '../stores/dialog-store';

type WorldbookSource = 'character' | 'manual';

const dialogStore = useDialogStore();
const settings = useFormFillSettings();
const injectionTarget = useFormFillInjectionTarget();
const entriesSource = useFormFillWorldbookConfig();
const entries = useFormFillWorldbookEntries();
const injectionWb = useWorldbookSelector();
const entriesWb = useWorldbookSelector();
const entryFilter = ref('');
const injectionTargetLabel = ref('');
const entriesSourceLabel = ref('');
const entryEmptyText = ref(tableCopy.worldbook.emptyDefault);
const promptDrawerOpen = ref(false);
const panelNavItems = [
  { id: 'table-entries-panel', label: tableCopy.panels.entries.title },
  { id: 'table-prompt-panel', label: formFillCopy.nav.prompt },
  { id: 'table-filter-panel', label: formFillCopy.nav.filter },
  { id: 'table-injection-target-panel', label: tableCopy.panels.injectionTarget.title },
];
const promptSlotSummary = computed(() => ({
  hasA: settings.promptSegments.value.some(
    (segment) => segment.mainSlot === 'A' || segment.isMain === true,
  ),
  hasB: settings.promptSegments.value.some(
    (segment) => segment.mainSlot === 'B' || segment.isMain2 === true,
  ),
}));
const promptTemplateBadgeLabel = computed(() =>
  settings.promptTemplateMode.value === 'default'
    ? '使用默认提示词'
    : '已自定义提示词',
);
const promptTemplateBadgeVariant = computed<AcuBadgeVariant>(() =>
  settings.promptTemplateMode.value === 'default' ? 'neutral' : 'accent',
);
const promptMessage = computed(() =>
  settings.message.value?.scope === 'prompt' ? settings.message.value : null,
);

async function refreshInjectionLabel(): Promise<void> {
  injectionTargetLabel.value = await injectionTarget.describeTarget();
}

function confirmPromptClose(): boolean | Promise<boolean> {
  if (!promptDrawerOpen.value || !settings.promptDirty.value) return true;
  return dialogStore.confirm({
    title: '关闭新 UI',
    message: '你有未保存的填表提示词修改，确定要关闭新 UI 吗？',
    confirmLabel: '关闭新 UI',
    confirmVariant: 'danger',
  });
}

function updatePromptSegment(
  index: number,
  patch: Partial<FormFillPromptSegment>,
): void {
  settings.updatePromptSegment(index, patch);
}

async function refreshEntriesGroups(): Promise<void> {
  const names = await entriesSource.resolveBookNames();
  entryEmptyText.value = resolveEntryEmptyText(names);
  await entries.loadEntries(names);
  if (entriesSource.source.value === 'character') {
    const charPrimary = entriesWb.charPrimary.value;
    entriesSourceLabel.value = charPrimary
      ? `角色卡所有世界书 · 主册 ${charPrimary}`
      : '角色卡所有世界书';
  } else {
    const names = entriesSource.manualSelection.value;
    entriesSourceLabel.value = names.length ? names.join('、') : '（未选择）';
  }
}

function resolveEntryEmptyText(names: string[]): string {
  if (entriesSource.source.value === 'character' && names.length === 0) {
    return tableCopy.worldbook.emptyCharacter;
  }
  if (entriesSource.source.value === 'manual' && entriesSource.manualSelection.value.length === 0) {
    return tableCopy.worldbook.emptyManual;
  }
  return tableCopy.worldbook.emptyDefault;
}

function onEntriesSourceChange(value: WorldbookSource): void {
  entriesSource.setSource(value);
  void refreshEntriesGroups();
}

function onEntriesManualBookToggle(name: string, checked: boolean): void {
  entriesSource.toggleManualBook(name, checked);
  void refreshEntriesGroups();
}

async function onInjectionTargetChange(value: string): Promise<void> {
  await injectionTarget.onSelectorChange(value);
  await refreshInjectionLabel();
}

async function refreshAll(): Promise<void> {
  settings.refresh();
  injectionTarget.refreshFromSettings();
  entriesSource.refreshFromSettings();
  await Promise.all([
    injectionWb.refresh(),
    entriesWb.refresh(),
  ]);
  await Promise.all([
    refreshInjectionLabel(),
    refreshEntriesGroups(),
  ]);
}

onMounted(() => { void refreshAll(); });
watch(useChatChangedTick(), () => { void refreshAll(); });
useUiCloseGuard(confirmPromptClose);
</script>

<style scoped>
.acu-v2-table-page {
  min-height: 100%;
  min-width: 0;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.acu-v2-table-page__col {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.acu-v2-table-page__filter {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.acu-v2-table-page__toggle-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.acu-v2-table-page__toggle-head {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.acu-v2-table-page__toggle-label {
  min-width: 0;
  color: var(--acu-text-1);
  font-size: var(--acu-font-size-body-lg, 13px);
  font-weight: 500;
  line-height: 1.35;
}

.acu-v2-table-page__toggle-desc {
  margin: 0;
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-caption, 11px);
  line-height: 1.5;
}

.acu-v2-table-page__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 12px;
  margin-top: 4px;
}

.acu-v2-table-page__status-line {
  margin: 0 0 10px;
  font-size: var(--acu-font-size-body, 12px);
  color: var(--acu-text-3);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.acu-v2-table-page__status-line strong {
  color: var(--acu-text-1);
  font-weight: 500;
}

.acu-v2-table-page__preset-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) repeat(3, max-content);
  gap: 6px;
  align-items: stretch;
  min-width: 0;
}

.acu-v2-table-page__badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: var(--acu-radius-sm);
  font-size: var(--acu-font-size-caption, 11px);
  font-weight: 500;
}

.acu-v2-table-page__badge--inherit {
  background: color-mix(in srgb, var(--acu-text-3) 16%, transparent);
  color: var(--acu-text-2);
}

.acu-v2-table-page__badge--override {
  background: var(--acu-accent);
  color: var(--acu-on-accent);
}

.acu-v2-table-page__hint {
  margin: 0;
  font-size: var(--acu-font-size-body, 12px);
  color: var(--acu-text-3);
}

.acu-v2-table-page__hint strong {
  color: var(--acu-text-1);
  font-weight: 500;
}

@media (max-width: 860px) {
  .acu-v2-table-page {
    padding: 14px;
  }
}
</style>
