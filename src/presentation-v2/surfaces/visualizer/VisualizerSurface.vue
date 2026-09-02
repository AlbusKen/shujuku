<template>
  <main
    class="acu-visualizer-surface"
    data-acu-visualizer-surface
    @pointerdown.capture="handleSurfacePointerDown"
  >
    <aside class="acu-visualizer-surface__sidebar" aria-label="数据库导航">
      <VisualizerNavigation
        :sheet-items="visualizer.sheetItems"
        :current-sheet-key="visualizer.currentSheetKey"
        :dirty="visualizer.dirty"
        :is-sheet-editing-mode="isSheetEditingMode"
        :mode="visualizer.mode"
        @select-sheet="selectNavSheet"
        @select-table-management="selectTableManagementNav"
      />
    </aside>

    <section
      class="acu-visualizer-surface__main"
      aria-label="数据库编辑器主区域"
    >
      <header class="acu-visualizer-surface__topbar">
        <div
          class="acu-visualizer-surface__topbar-context"
          aria-label="数据库编辑器状态"
        >
          <AcuIconButton
            class="acu-visualizer-surface__mobile-menu"
            icon="fa-solid fa-bars"
            title="打开数据库导航"
            aria-label="打开数据库导航"
            :aria-expanded="isMobileNavOpen"
            @click="openMobileNav"
          />
          <div
            class="acu-visualizer-surface__context-items"
            aria-label="当前编辑上下文"
          >
            <div class="acu-visualizer-surface__context-item">
              <span>当前模板</span>
              <strong>{{ templatePresetLabel }}</strong>
            </div>
            <div
              v-if="visualizer.currentSheetKey && visualizer.currentSheet"
              class="acu-visualizer-surface__context-item"
            >
              <span>当前表</span>
              <strong>{{ currentSheetName }}</strong>
            </div>
          </div>
          <AcuBadge
            v-if="visualizer.externalRevisionChanged"
            class="acu-visualizer-surface__context-badge"
            variant="warning"
          >
            外部数据已变化
          </AcuBadge>
          <AcuBadge
            v-else-if="visualizer.dirty"
            class="acu-visualizer-surface__context-badge"
            variant="warning"
            >未保存</AcuBadge
          >
        </div>

        <AcuSegmentedControl
          v-if="isSheetEditingMode && visualizer.currentSheetKey"
          class="acu-visualizer-surface__mode-tabs"
          :options="modes"
          :model-value="visualizer.mode"
          aria-label="编辑模式"
          @update:model-value="setWorkspaceMode"
        />

        <AcuIconButton
          class="acu-visualizer-surface__close"
          icon="fa-solid fa-xmark"
          title="关闭数据库编辑器"
          aria-label="关闭数据库编辑器"
          @click="emit('close')"
        />
      </header>

      <AcuInfoBanner
        v-if="visualizer.externalRevisionChanged"
        tone="warning"
        class="acu-visualizer-surface__conflict"
      >
        当前聊天的数据在编辑器打开后发生变化。重新载入会丢弃当前草稿；保留草稿则继续编辑，下一次保存会以这里的内容为准。
        <span class="acu-visualizer-surface__conflict-actions">
          <AcuButton size="sm" @click="data.forceReloadFromCurrentContext"
            >重新载入外部数据</AcuButton
          >
          <AcuButton size="sm" @click="visualizer.clearExternalRefreshConflict"
            >保留当前草稿</AcuButton
          >
        </span>
      </AcuInfoBanner>

      <section
        ref="workspaceRef"
        class="acu-visualizer-surface__workspace"
        :class="{ 'acu-visualizer-surface__workspace--assistant': visualizer.mode === 'assistant' }"
        aria-label="数据库编辑工作区"
      >
        <div
          v-if="visualizer.isLoading"
          class="acu-visualizer-surface__loading"
        >
          <i class="fa-solid fa-spinner fa-spin"></i>
          <span>正在载入当前聊天的表格数据...</span>
        </div>

        <AcuPanel
          v-else-if="visualizer.loadError"
          title="无法载入数据库"
          description="数据库编辑器需要先读取当前聊天或隔离标签下的表格数据。请先完成初始化或一次填表；如果刚切换了聊天，可以重新打开新 UI 再试。"
        >
          <p class="acu-visualizer-surface__empty">
            {{ visualizer.loadError }}
          </p>
          <AcuButton @click="data.forceReloadFromCurrentContext"
            >重新尝试载入</AcuButton
          >
        </AcuPanel>

        <template
          v-else-if="
            visualizer.mode === 'global' ||
            visualizer.mode === 'table-management'
          "
        >
          <div class="acu-visualizer-surface__database-toolbar">
            <div>
              <h2>数据库管理</h2>
            </div>
            <AcuButton
              v-if="visualizer.currentSheetKey"
              size="sm"
              @click="returnToCurrentSheet"
            >
              <i class="fa-solid fa-arrow-left"></i>
              返回当前表编辑
            </AcuButton>
          </div>
          <VisualizerTableManagementPanel
            :sheet-items="visualizer.sheetItems"
            @move-sheet="moveSheet"
            @request-add-sheet="requestAddSheet"
            @request-delete-sheet="requestDeleteSheet"
          />
          <VisualizerGlobalInjectionPanels />
        </template>

        <template v-else>
          <template v-if="visualizer.mode === 'data'">
            <p v-if="rowCount === 0" class="acu-visualizer-surface__empty">
              当前表还没有数据行。可以先新增行，再逐个字段填写内容。
            </p>

            <div
              v-if="isDataPaginated"
              ref="paginationRef"
              class="acu-visualizer-surface__pagination"
              aria-label="数据分页"
            >
              <div
                class="acu-visualizer-surface__pagination-pages"
                aria-label="页码"
              >
                <AcuButton
                  v-for="item in dataPaginationItems"
                  :key="item.key"
                  class="acu-visualizer-surface__page-button"
                  :class="{
                    'acu-visualizer-surface__page-button--active': item.active,
                  }"
                  :variant="item.active ? 'primary' : 'default'"
                  size="md"
                  :aria-label="
                    item.targetPage
                      ? `跳转到第 ${item.targetPage} 页`
                      : item.page
                        ? `第 ${item.page} 页`
                        : '省略的页码'
                  "
                  @click="item.targetPage && setDataPage(item.targetPage)"
                >
                  {{ item.label }}
                </AcuButton>
              </div>
              <AcuInput
                class="acu-visualizer-surface__page-jump"
                :model-value="dataPageJumpValue"
                type="number"
                size="md"
                :min="1"
                :max="dataPageCount"
                :step="1"
                autocomplete="off"
                aria-label="跳转到页码"
                @update:model-value="updateDataPageJumpValue"
                @change="commitDataPageJumpValue"
              />
            </div>

            <div v-if="rowCount > 0" class="acu-visualizer-surface__card-grid">
              <article
                v-for="row in rows"
                :key="row.index"
                class="acu-visualizer-surface__data-card"
              >
                <header class="acu-visualizer-surface__card-header">
                  <strong>#{{ row.index + 1 }}</strong>
                  <span>{{ row.fields.length }} 个字段</span>
                  <AcuIconButton
                    class="acu-visualizer-surface__row-lock"
                    icon="fa-solid fa-lock"
                    size="sm"
                    :variant="row.locked ? 'accent' : 'default'"
                    :title="
                      row.locked
                        ? '取消这一行的自动更新保护'
                        : '锁定这一行，阻止自动更新改动整行'
                    "
                    :aria-label="row.locked ? '取消锁定这一行' : '锁定这一行'"
                    @click="
                      visualizer.toggleRowLock(
                        visualizer.currentSheetKey,
                        row.index,
                      )
                    "
                  />
                  <AcuIconButton
                    icon="fa-solid fa-trash"
                    size="sm"
                    variant="danger"
                    title="删除这一行"
                    @click="deleteRow(row.index)"
                  />
                </header>
                <div class="acu-visualizer-surface__fields">
                  <div
                    v-for="fieldRow in row.fieldRows"
                    :key="fieldRow.key"
                    class="acu-visualizer-surface__field-row"
                    :class="{ 'is-wide': fieldRow.wide }"
                    :data-acu-visualizer-field-row-layout="
                      fieldRow.wide ? 'wide' : 'half'
                    "
                  >
                    <div
                      v-for="field in fieldRow.fields"
                      :key="field.columnIndex"
                      class="acu-visualizer-surface__field"
                      :class="{
                        'is-locked': field.locked,
                        'is-special-index': field.specialIndexLocked,
                        'is-actions-active': isFieldActionsActive(
                          row.index,
                          field.columnIndex,
                        ),
                      }"
                      :data-acu-visualizer-field-layout="
                        fieldRow.wide ? 'wide' : 'half'
                      "
                      @pointerdown="
                        setActiveFieldActions(row.index, field.columnIndex)
                      "
                      @focusin="setActiveFieldActions(row.index, field.columnIndex)"
                    >
                      <span class="acu-visualizer-surface__field-label">
                        <span>{{ field.header }}</span>
                        <span class="acu-visualizer-surface__field-locks">
                          <AcuBadge
                            v-if="field.specialIndexLocked"
                            variant="warning"
                            title="编码索引由系统维护；保存、AI 更新或行数变化时会按 AM 序列重排"
                          >
                            自动编号
                          </AcuBadge>
                          <AcuIconButton
                            v-else-if="
                              field.locked ||
                              isFieldActionsActive(row.index, field.columnIndex)
                            "
                            class="acu-visualizer-surface__lock-button"
                            icon="fa-solid fa-table-columns"
                            size="sm"
                            :variant="field.columnLocked ? 'accent' : 'default'"
                            :title="
                              field.columnLocked
                                ? '取消当前列的自动更新保护'
                                : '锁定当前列，阻止自动更新改动这一列'
                            "
                            :aria-label="
                              field.columnLocked
                                ? '取消锁定当前列'
                                : '锁定当前列'
                            "
                            @click.stop.prevent="
                              handleFieldColumnLockClick(
                                row.index,
                                field.columnIndex,
                              )
                            "
                            @pointerdown.stop.prevent="
                              handleFieldColumnLockPointerDown(
                                row.index,
                                field.columnIndex,
                              )
                            "
                          />
                          <AcuIconButton
                            v-if="
                              !field.specialIndexLocked &&
                              (field.locked ||
                                isFieldActionsActive(
                                  row.index,
                                  field.columnIndex,
                                ))
                            "
                            class="acu-visualizer-surface__lock-button"
                            icon="fa-solid fa-lock"
                            size="sm"
                            :variant="field.cellLocked ? 'accent' : 'default'"
                            :title="
                              field.cellLocked
                                ? '取消当前单元格的自动更新保护'
                                : '锁定当前单元格，阻止自动更新改动这个值'
                            "
                            :aria-label="
                              field.cellLocked
                                ? '取消锁定当前单元格'
                                : '锁定当前单元格'
                            "
                            @click.stop.prevent="
                              handleFieldCellLockClick(
                                row.index,
                                field.columnIndex,
                              )
                            "
                            @pointerdown.stop.prevent="
                              handleFieldCellLockPointerDown(
                                row.index,
                                field.columnIndex,
                              )
                            "
                          />
                        </span>
                      </span>
                      <AcuTextarea
                        v-if="isDataCellEditing(row.index, field.columnIndex)"
                        :ref="setActiveDataTextareaRef"
                        :model-value="field.value"
                        :rows="1"
                        :aria-label="`编辑${field.header}`"
                        auto-resize
                        @focus="
                          startDataCellEditing(row.index, field.columnIndex)
                        "
                        @blur="
                          stopDataCellEditing(row.index, field.columnIndex)
                        "
                        @update:model-value="
                          (value) =>
                            visualizer.updateCell(
                              row.index,
                              field.columnIndex,
                              value,
                            )
                        "
                      />
                      <div
                        v-else
                        class="acu-visualizer-surface__field-preview"
                        :class="{ 'is-empty': !field.value }"
                        role="button"
                        tabindex="0"
                        title="点击编辑该字段"
                        @pointerdown.stop="
                          setActiveFieldActions(row.index, field.columnIndex)
                        "
                        @mousedown.prevent
                        @click="
                          startDataCellEditing(row.index, field.columnIndex)
                        "
                        @keydown.enter.prevent="
                          startDataCellEditing(row.index, field.columnIndex)
                        "
                        @keydown.space.prevent="
                          startDataCellEditing(row.index, field.columnIndex)
                        "
                      >
                        {{ field.value || "未填写" }}
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            </div>

            <div class="acu-visualizer-surface__data-toolbar">
              <span class="acu-visualizer-surface__data-range">
                {{ dataRangeText }}
              </span>
              <div class="acu-visualizer-surface__data-toolbar-actions">
                <AcuButton size="sm" variant="primary" @click="addRow">
                  <i class="fa-solid fa-plus"></i>
                  新增行
                </AcuButton>
              </div>
            </div>
          </template>

          <VisualizerConfigPanels
            v-else-if="visualizer.mode === 'config'"
            @request-add-column="requestAddColumn"
            @request-delete-column="requestDeleteColumn"
          />

          <VisualizerAssistantPanel v-else />
        </template>
      </section>

      <footer class="acu-visualizer-surface__footer" aria-label="保存操作">
        <span>{{ footerStatus }}</span>
        <div class="acu-visualizer-surface__footer-actions">
          <AcuButton
            :disabled="saveDisabled"
            :loading="visualizer.isSaving"
            variant="primary"
            @click="save.saveDataToCurrentMessage"
          >
            保存数据到当前消息
          </AcuButton>
          <AcuButton
            :disabled="saveDisabled"
            :loading="visualizer.isSaving"
            @click="save.saveTemplateToCurrentChat"
          >
            保存模板到当前聊天
          </AcuButton>
          <AcuButton
            :disabled="saveDisabled"
            :loading="visualizer.isSaving"
            @click="save.saveTemplateToGlobal"
          >
            保存模板到全局
          </AcuButton>
        </div>
      </footer>
    </section>

    <div
      v-if="isMobileNavRendered"
      class="acu-visualizer-surface__mobile-nav-layer"
      :class="{ 'is-closing': isMobileNavClosing }"
      @click.self="closeMobileNav"
    >
      <aside
        class="acu-visualizer-surface__mobile-nav"
        :style="mobileNavDrawerStyle"
        role="dialog"
        aria-modal="true"
        aria-label="数据库导航"
        data-acu-mobile-nav-width="360px"
        @click.stop
      >
        <VisualizerNavigation
          :sheet-items="visualizer.sheetItems"
          :current-sheet-key="visualizer.currentSheetKey"
          :dirty="visualizer.dirty"
          :is-sheet-editing-mode="isSheetEditingMode"
          :mode="visualizer.mode"
          @select-sheet="selectNavSheet"
          @select-table-management="selectTableManagementNav"
        />
      </aside>
    </div>

  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import AcuBadge from "../../components/_lib/AcuBadge.vue";
import AcuButton from "../../components/_lib/AcuButton.vue";
import AcuIconButton from "../../components/_lib/AcuIconButton.vue";
import AcuInfoBanner from "../../components/_lib/AcuInfoBanner.vue";
import AcuInput from "../../components/_lib/AcuInput.vue";
import AcuPanel from "../../components/_lib/AcuPanel.vue";
import AcuSegmentedControl from "../../components/_lib/AcuSegmentedControl.vue";
import AcuTextarea from "../../components/_lib/AcuTextarea.vue";
import { useUiCloseGuard } from "../../composables/useUiCloseGuard";
import { useVisualizerConfigEditing } from "../../composables/visualizer/useVisualizerConfigEditing";
import { useVisualizerData } from "../../composables/visualizer/useVisualizerData";
import { useVisualizerSave } from "../../composables/visualizer/useVisualizerSave";
import { acuClearTimeout, acuSetTimeout, type AcuTimerHandle } from "../../bootstrap/host-env";
import { getSheetColumnProjection_ACU } from "../../../shared/ddl-utils";
import { useDialogStore } from "../../stores/dialog-store";
import { useVisualizerStore } from "../../stores/visualizer-store";
import VisualizerAssistantPanel from "./VisualizerAssistantPanel.vue";
import VisualizerConfigPanels from "./VisualizerConfigPanels.vue";
import VisualizerGlobalInjectionPanels from "./VisualizerGlobalInjectionPanels.vue";
import VisualizerNavigation from "./VisualizerNavigation.vue";
import VisualizerTableManagementPanel from "./VisualizerTableManagementPanel.vue";

const visualizer = useVisualizerStore();
const dialogStore = useDialogStore();
const data = useVisualizerData();
const config = useVisualizerConfigEditing();
const emit = defineEmits<{
  (event: "close"): void;
}>();
const isMobileNavRendered = ref(false);
const isMobileNavClosing = ref(false);
const workspaceRef = ref<HTMLElement | null>(null);
const paginationRef = ref<HTMLElement | null>(null);
const VISUALIZER_MOBILE_NAV_LEAVE_MS = 150;
const VISUALIZER_DATA_PAGE_SIZE = 30;
const mobileNavDrawerStyle = {
  width: "360px",
  maxWidth: "calc(100% - 24px)",
  flex: "0 0 360px",
};
let mobileNavCloseTimer: AcuTimerHandle | undefined;
let paginationResizeObserver: ResizeObserver | undefined;

const save = useVisualizerSave({
  requestGlobalPresetName(defaultName) {
    return openInputDialog({
      title: "保存模板到全局",
      message:
        "当前生效的是默认模板，保存模板到全局前需要给这份模板起一个名字。取消后不会写入聊天或清掉未保存状态。",
      label: "模板预设名称",
      defaultValue: defaultName,
      placeholder: "例如：当前角色专用模板",
      confirmLabel: "保存模板到全局",
    });
  },
  confirmOverwriteGlobalPreset(presetName) {
    return openConfirmDialog({
      title: "覆盖全局模板",
      message: `这会用当前编辑结果覆盖全局预设"${presetName}"。如果不确定，可以先取消，当前草稿会继续保留在编辑器里。`,
      confirmLabel: "覆盖并保存",
      confirmVariant: "primary",
    });
  },
  requestSchemaMigrationChoice(summary) {
    return dialogStore.choose({
      title: "确认历史列对应关系",
      message: `${summary.message}。可保留历史列值进行映射，或以当前编辑器候选整表作为新边界。草稿变化后必须重新选择。`,
      actions: [
        ...summary.choices.map(choice => ({
          value: choice.id,
          label: choice.label,
          variant: "primary" as const,
        })),
        {
          value: summary.rebaseChoiceId,
          label: "按当前表结构重建",
          variant: "danger" as const,
        },
      ],
      cancelLabel: "取消保存",
    });
  },
  confirmDestructiveSchemaChange(summary) {
    const details = summary.sheets.map(sheet => {
      const columns = sheet.droppedColumns
        .map(column => `「${column.displayHeader}」`)
        .join("、");
      return `表「${sheet.tableName}」将删除 ${columns}（影响 ${sheet.affectedRowCount} 行历史数据）`;
    }).join("；");
    return openConfirmDialog({
      title: "确认保存并永久删除列数据",
      message: `${details}。这会把当前聊天中这些列的历史值从本次模板提交后的结构中移除，不能直接恢复；如需恢复只能依赖提交前备份或 checkpoint。确认仅适用于当前草稿快照，草稿变化后必须重新确认。`,
      confirmLabel: "确认删除并保存",
      confirmVariant: "danger",
    });
  },
});

const modes: Array<{ value: "data" | "config" | "assistant"; label: string }> =
  [
  { value: "data", label: "数据" },
  { value: "config", label: "结构/参数" },
  { value: "assistant", label: "AI 助手" },
];

function setWorkspaceMode(value: string): void {
  if (value === "data" || value === "config" || value === "assistant") {
    visualizer.setMode(value);
  }
}

const isSheetEditingMode = computed(
  () =>
    visualizer.mode === "data" ||
    visualizer.mode === "config" ||
    visualizer.mode === "assistant",
);

const currentSheetName = computed(() =>
  String(
    visualizer.currentSheet?.name || visualizer.currentSheetKey || "未选择表格",
  ),
);

const templatePresetLabel = computed(
  () => data.templatePresetLabel.value || "载入中",
);

const isMobileNavOpen = computed(
  () => isMobileNavRendered.value && !isMobileNavClosing.value,
);

function openMobileNav(): void {
  clearMobileNavCloseTimer();
  isMobileNavRendered.value = true;
  isMobileNavClosing.value = false;
}

function closeMobileNav(): void {
  if (!isMobileNavRendered.value || isMobileNavClosing.value) return;
  isMobileNavClosing.value = true;
  clearMobileNavCloseTimer();
  mobileNavCloseTimer = acuSetTimeout(() => {
    isMobileNavRendered.value = false;
    isMobileNavClosing.value = false;
    mobileNavCloseTimer = undefined;
  }, VISUALIZER_MOBILE_NAV_LEAVE_MS);
}

function clearMobileNavCloseTimer(): void {
  if (mobileNavCloseTimer === undefined) return;
  acuClearTimeout(mobileNavCloseTimer);
  mobileNavCloseTimer = undefined;
}

function selectNavSheet(key: string): void {
  visualizer.selectSheet(key);
  closeMobileNav();
}

function selectTableManagementNav(): void {
  visualizer.selectTableManagement();
  closeMobileNav();
}

function returnToCurrentSheet(): void {
  if (visualizer.currentSheetKey) visualizer.setMode("data");
}

function moveSheet(key: string, direction: "up" | "down"): void {
  visualizer.moveSheet(key, direction);
}

const headers = computed<string[]>(() => {
  const content = visualizer.currentSheet?.content;
  if (!Array.isArray(content) || !Array.isArray(content[0])) return [];
  return content[0].slice(1).map((item: any, index: number) => String(item || `字段 ${index + 1}`));
});

const visibleColumns = computed(() => {
  const sheet = visualizer.currentSheet;
  if (!sheet) return [];
  return getSheetColumnProjection_ACU(sheet).visibleColumns
    .filter(column => column.sourceIndex > 0)
    .map(column => ({ ...column, columnIndex: column.sourceIndex - 1 }));
});

const VISUALIZER_SHORT_FIELD_CHAR_LIMIT = 24;
const activeDataCell = ref<{ rowIndex: number; columnIndex: number } | null>(
  null,
);
const activeFieldActions = ref<{
  rowIndex: number;
  columnIndex: number;
} | null>(null);
const fieldLockPointerAction = ref<{
  kind: "column" | "cell";
  rowIndex: number;
  columnIndex: number;
  at: number;
} | null>(null);
const activeDataTextareaRef = ref<HTMLTextAreaElement | null>(null);
const editingColumnLayoutSnapshot = ref<boolean[] | null>(null);
const currentDataPage = ref(1);
const dataPageJumpValue = ref<string | number>(1);
const paginationWidth = ref<number | null>(null);

const rowCount = computed(() => {
  const content = visualizer.currentSheet?.content;
  return Array.isArray(content) ? Math.max(0, content.length - 1) : 0;
});

const dataPageSize = VISUALIZER_DATA_PAGE_SIZE;

const dataPageCount = computed(() =>
  Math.max(1, Math.ceil(rowCount.value / dataPageSize)),
);

const isDataPaginated = computed(() => rowCount.value > dataPageSize);

const dataPaginationSiblingWindow = computed(() => {
  const width = paginationWidth.value;
  if (width == null) return 2;
  if (width < 330) return 0;
  if (width < 430) return 1;
  return 2;
});

interface DataPaginationItem {
  key: string;
  label: string;
  page: number | null;
  targetPage: number | null;
  active: boolean;
  ellipsis: boolean;
}

const dataPaginationItems = computed<DataPaginationItem[]>(() => {
  const total = dataPageCount.value;
  const current = currentDataPage.value;
  const pages = new Set<number>([1, current, total]);
  const siblingWindow = dataPaginationSiblingWindow.value;
  const groupSize = Math.max(1, siblingWindow * 2 + 1);
  const edgeWindow =
    siblingWindow >= 2 ? 5 : siblingWindow === 1 ? 3 : 1;
  const maxDirectPages =
    siblingWindow >= 2 ? 7 : siblingWindow === 1 ? 5 : 3;

  if (total <= maxDirectPages) {
    for (let page = 1; page <= total; page += 1) pages.add(page);
  } else if (current <= edgeWindow - 1) {
    for (let page = 1; page <= edgeWindow; page += 1) pages.add(page);
  } else if (current >= total - edgeWindow + 2) {
    for (let page = total - edgeWindow + 1; page <= total; page += 1) {
      pages.add(page);
    }
  } else {
    for (
      let page = current - siblingWindow;
      page <= current + siblingWindow;
      page += 1
    ) {
      pages.add(page);
    }
  }

  const sortedPages = Array.from(pages)
    .filter((page) => page >= 1 && page <= total)
    .sort((a, b) => a - b);
  const items: DataPaginationItem[] = [];

  sortedPages.forEach((page, index) => {
    const previous = sortedPages[index - 1];
    if (previous && page - previous > 1) {
      const targetPage =
        page <= current
          ? Math.max(1, current - groupSize)
          : Math.min(total, current + groupSize);
      items.push({
        key: `ellipsis-${previous}-${page}`,
        label: "...",
        page: null,
        targetPage,
        active: false,
        ellipsis: true,
      });
    }
    items.push({
      key: `page-${page}`,
      label: String(page),
      page,
      targetPage: page,
      active: page === current,
      ellipsis: false,
    });
  });

  return items;
});

const dataPageStartIndex = computed(() =>
  Math.min(
    rowCount.value,
    Math.max(0, (currentDataPage.value - 1) * dataPageSize),
  ),
);

const dataPageEndIndex = computed(() =>
  Math.min(rowCount.value, dataPageStartIndex.value + dataPageSize),
);

const dataRangeText = computed(() => {
  if (rowCount.value === 0) return "共 0 行";
  return `第 ${dataPageStartIndex.value + 1}-${dataPageEndIndex.value} 行 / 共 ${rowCount.value} 行`;
});

const visibleDataRows = computed<any[][]>(() => {
  const content = visualizer.currentSheet?.content;
  if (!Array.isArray(content)) return [];
  return content.slice(dataPageStartIndex.value + 1, dataPageEndIndex.value + 1);
});

function scrollWorkspaceToTop(): void {
  void nextTick(() => {
    if (workspaceRef.value) workspaceRef.value.scrollTop = 0;
  });
}

function preserveWorkspaceScrollPosition(action: () => void): void {
  const scrollTop = workspaceRef.value?.scrollTop ?? 0;
  const scrollLeft = workspaceRef.value?.scrollLeft ?? 0;
  action();
  void nextTick(() => {
    const workspace = workspaceRef.value;
    if (!workspace) return;
    workspace.scrollTop = scrollTop;
    workspace.scrollLeft = scrollLeft;
  });
}

function setDataPage(page: number): void {
  const requestedPage = Math.trunc(Number(page));
  if (!Number.isFinite(requestedPage)) return;
  const nextPage = Math.min(
    dataPageCount.value,
    Math.max(1, requestedPage),
  );
  if (nextPage === currentDataPage.value) {
    dataPageJumpValue.value = currentDataPage.value;
    return;
  }
  currentDataPage.value = nextPage;
  dataPageJumpValue.value = nextPage;
  clearDataCellEditing();
  scrollWorkspaceToTop();
}

function updateDataPageJumpValue(value: string | number): void {
  dataPageJumpValue.value = value;
  if (value === "" || value === "-") return;
  setDataPage(Number(value));
}

function commitDataPageJumpValue(value: string | number): void {
  if (value === "" || value === "-") {
    dataPageJumpValue.value = currentDataPage.value;
    return;
  }
  setDataPage(Number(value));
  dataPageJumpValue.value = currentDataPage.value;
}

function isShortDataField(value: string): boolean {
  const normalized = String(value || "").trim();
  if (normalized.includes("\n") || normalized.includes("\r")) return false;
  return (
    Array.from(normalized.replace(/\s+/g, " ")).length <=
    VISUALIZER_SHORT_FIELD_CHAR_LIMIT
  );
}

function getColumnIsShort(dataRows: any[][]): boolean[] {
  return visibleColumns.value.map(column =>
    dataRows.every((row: any[]) =>
      isShortDataField(
        String(Array.isArray(row) ? (row[column.sourceIndex] ?? "") : ""),
      ),
    ),
  );
}

function getEffectiveColumnIsShort(dataRows: any[][]): boolean[] {
  const columnIsShort = getColumnIsShort(dataRows);
  const active = activeDataCell.value;
  const snapshot = editingColumnLayoutSnapshot.value;
  if (!active || !snapshot || snapshot.length !== columnIsShort.length) {
    return columnIsShort;
  }
  return columnIsShort.map((value, index) =>
    visibleColumns.value[index]?.columnIndex === active.columnIndex
      ? snapshot[index] : value,
  );
}

function buildFieldLayoutRows<T extends { columnIndex: number }>(
  fields: T[],
  columnIsShort: boolean[],
): Array<{ key: string; wide: boolean; fields: T[] }> {
  const result: Array<{ key: string; wide: boolean; fields: T[] }> = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    const next = fields[index + 1];
    const pairWithNext =
      columnIsShort[index] === true &&
      !!next &&
      columnIsShort[index + 1] === true;
    if (pairWithNext && next) {
      result.push({
        key: `${field.columnIndex}-${next.columnIndex}`,
        wide: false,
        fields: [field, next],
      });
      index += 1;
    } else {
      result.push({
        key: String(field.columnIndex),
        wide: true,
        fields: [field],
      });
    }
  }
  return result;
}

function asTextarea(el: unknown): HTMLTextAreaElement | null {
  if (el instanceof HTMLTextAreaElement) return el;
  const root = (el as { $el?: unknown } | null)?.$el;
  if (root instanceof HTMLTextAreaElement) return root;
  if (root instanceof HTMLElement) return root.querySelector("textarea");
  return null;
}

function setActiveDataTextareaRef(el: unknown): void {
  activeDataTextareaRef.value = asTextarea(el);
}

function isDataCellEditing(rowIndex: number, columnIndex: number): boolean {
  const active = activeDataCell.value;
  return (
    !!active &&
    active.rowIndex === Math.trunc(Number(rowIndex)) &&
    active.columnIndex === Math.trunc(Number(columnIndex))
  );
}

function setActiveFieldActions(rowIndex: number, columnIndex: number): void {
  activeFieldActions.value = {
    rowIndex: Math.trunc(Number(rowIndex)),
    columnIndex: Math.trunc(Number(columnIndex)),
  };
}

function isFieldActionsActive(rowIndex: number, columnIndex: number): boolean {
  const active = activeFieldActions.value;
  return (
    !!active &&
    active.rowIndex === Math.trunc(Number(rowIndex)) &&
    active.columnIndex === Math.trunc(Number(columnIndex))
  );
}

function clearFieldActions(): void {
  activeFieldActions.value = null;
}

function consumeFieldLockPointerAction(
  kind: "column" | "cell",
  rowIndex: number,
  columnIndex: number,
): boolean {
  const action = fieldLockPointerAction.value;
  fieldLockPointerAction.value = null;
  return (
    !!action &&
    action.kind === kind &&
    action.rowIndex === Math.trunc(Number(rowIndex)) &&
    action.columnIndex === Math.trunc(Number(columnIndex)) &&
    Date.now() - action.at < 1000
  );
}

function markFieldLockPointerAction(
  kind: "column" | "cell",
  rowIndex: number,
  columnIndex: number,
): void {
  fieldLockPointerAction.value = {
    kind,
    rowIndex: Math.trunc(Number(rowIndex)),
    columnIndex: Math.trunc(Number(columnIndex)),
    at: Date.now(),
  };
}

function toggleFieldColumnLock(rowIndex: number, columnIndex: number): void {
  setActiveFieldActions(rowIndex, columnIndex);
  visualizer.toggleColumnLock(visualizer.currentSheetKey, columnIndex);
}

function toggleFieldCellLock(rowIndex: number, columnIndex: number): void {
  setActiveFieldActions(rowIndex, columnIndex);
  visualizer.toggleCellLock(visualizer.currentSheetKey, rowIndex, columnIndex);
}

function handleFieldColumnLockPointerDown(
  rowIndex: number,
  columnIndex: number,
): void {
  markFieldLockPointerAction("column", rowIndex, columnIndex);
  toggleFieldColumnLock(rowIndex, columnIndex);
}

function handleFieldCellLockPointerDown(
  rowIndex: number,
  columnIndex: number,
): void {
  markFieldLockPointerAction("cell", rowIndex, columnIndex);
  toggleFieldCellLock(rowIndex, columnIndex);
}

function handleFieldColumnLockClick(
  rowIndex: number,
  columnIndex: number,
): void {
  if (consumeFieldLockPointerAction("column", rowIndex, columnIndex)) return;
  toggleFieldColumnLock(rowIndex, columnIndex);
}

function handleFieldCellLockClick(
  rowIndex: number,
  columnIndex: number,
): void {
  if (consumeFieldLockPointerAction("cell", rowIndex, columnIndex)) return;
  toggleFieldCellLock(rowIndex, columnIndex);
}

function handleSurfacePointerDown(event: PointerEvent): void {
  const target = event.target;
  if (
    target instanceof Element &&
    target.closest(".acu-visualizer-surface__field")
  ) {
    return;
  }
  clearFieldActions();
}

async function startDataCellEditing(
  rowIndex: number,
  columnIndex: number,
): Promise<void> {
  setActiveFieldActions(rowIndex, columnIndex);
  // The textarea re-enters here via its own focus event; avoid re-assigning
  // the active cell (which would rebuild the card layout mid-edit).
  if (isDataCellEditing(rowIndex, columnIndex)) return;
  activeDataCell.value = {
    rowIndex: Math.trunc(Number(rowIndex)),
    columnIndex: Math.trunc(Number(columnIndex)),
  };
  editingColumnLayoutSnapshot.value = getColumnIsShort(visibleDataRows.value);
  await nextTick();
  const textarea = activeDataTextareaRef.value;
  if (!textarea) return;
  if (textarea.ownerDocument.activeElement !== textarea) textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

function stopDataCellEditing(rowIndex: number, columnIndex: number): void {
  const active = activeDataCell.value;
  if (
    !active ||
    active.rowIndex !== Math.trunc(Number(rowIndex)) ||
    active.columnIndex !== Math.trunc(Number(columnIndex))
  ) {
    return;
  }
  activeDataCell.value = null;
  activeDataTextareaRef.value = null;
  editingColumnLayoutSnapshot.value = null;
}

function clearDataCellEditing(): void {
  activeDataCell.value = null;
  activeDataTextareaRef.value = null;
  editingColumnLayoutSnapshot.value = null;
  clearFieldActions();
}

const rows = computed(() => {
  const sheetKey = visualizer.currentSheetKey;
  const specialIndexInfo = config.specialIndex.value;
  const columnIsShort = getEffectiveColumnIsShort(visibleDataRows.value);
  const lockDraft = sheetKey ? visualizer.getLockDraft(sheetKey) : null;
  const lockedRows = new Set(lockDraft?.rows || []);
  const lockedColumns = new Set(lockDraft?.cols || []);
  const lockedCells = new Set(lockDraft?.cells || []);
  const specialIndexLocked = lockDraft?.specialIndexLocked !== false;
  return visibleDataRows.value.map((row: any[], visibleIndex: number) => {
    const index = dataPageStartIndex.value + visibleIndex;
    const rowLocked = lockedRows.has(index);
    const fields = visibleColumns.value.map(column => ({
      header: column.header,
      columnIndex: column.columnIndex,
      value: String(Array.isArray(row) ? (row[column.sourceIndex] ?? "") : ""),
      rowLocked,
      columnLocked: lockedColumns.has(column.columnIndex),
      cellLocked: lockedCells.has(`${index}:${column.columnIndex}`),
      specialIndexLocked:
        specialIndexInfo.enabled &&
        specialIndexInfo.index === column.columnIndex &&
        specialIndexLocked,
      locked:
        rowLocked ||
        lockedColumns.has(column.columnIndex) ||
        lockedCells.has(`${index}:${column.columnIndex}`) ||
        (specialIndexInfo.enabled &&
          specialIndexInfo.index === column.columnIndex &&
          specialIndexLocked),
    }));
    return {
      index,
      locked: rowLocked,
      fields,
      fieldRows: buildFieldLayoutRows(fields, columnIsShort),
    };
  });
});

const footerStatus = computed(() => {
  if (visualizer.isLoading) return "正在读取当前聊天的表格数据。";
  if (visualizer.loadError) return "当前没有可保存的表格草稿。";
  if (visualizer.isSaving) return "正在保存表格数据...";
  if (visualizer.dirty) return "有未保存修改，保存前只存在于编辑器草稿中。";
  if (visualizer.lastSavedAt) return "最近一次保存已完成。";
  return "载入后可以分别保存数据、当前聊天模板或全局模板。";
});

const saveDisabled = computed(
  () => visualizer.isLoading || !!visualizer.loadError || !visualizer.tempData,
);

async function requestAddSheet(): Promise<void> {
  const name = await openInputDialog({
    title: "新增表格",
    message:
      "新表格会先放进当前编辑草稿，只有点击保存后才会写回聊天或全局模板。",
    label: "表格名称",
    defaultValue: "新建表格",
    placeholder: "例如：角色状态",
    confirmLabel: "新增表格",
  });
  if (name) {
    data.addSheet(name);
    closeMobileNav();
  }
}

async function requestDeleteSheet(key: string): Promise<void> {
  const sheet = visualizer.tempData?.[key];
  const name = String(sheet?.name || key);
  const confirmed = await openConfirmDialog({
    title: "删除表格",
    message: `确定要删除表格"${name}"吗？保存后，这张表的数据和模板配置都会被移除。取消后草稿不会变化。`,
    confirmLabel: "删除表格",
    confirmVariant: "danger",
  });
  if (confirmed) data.deleteSheet(key);
}

async function deleteRow(rowIndex: number): Promise<void> {
  const confirmed = await openConfirmDialog({
    title: "删除数据行",
    message: `确定要删除第 ${rowIndex + 1} 行吗？这只会修改当前草稿，保存前仍可通过关闭时取消来保留编辑器。`,
    confirmLabel: "删除这一行",
    confirmVariant: "danger",
  });
  if (!confirmed) return;
  visualizer.deleteRow(rowIndex);
  refreshSpecialIndexColumnDraft();
  if (currentDataPage.value > dataPageCount.value) {
    currentDataPage.value = dataPageCount.value;
  }
  clearDataCellEditing();
}

function addRow(): void {
  preserveWorkspaceScrollPosition(() => {
    visualizer.addRow();
    refreshSpecialIndexColumnDraft();
    currentDataPage.value = dataPageCount.value;
    clearDataCellEditing();
  });
}

function refreshSpecialIndexColumnDraft(): void {
  const sheet = visualizer.currentSheet;
  const info = config.specialIndex.value;
  if (
    !sheet ||
    !info.enabled ||
    !visualizer.isSpecialIndexLocked(visualizer.currentSheetKey)
  )
    return;
  if (!Array.isArray(sheet.content) || info.index < 0) return;
  for (let rowIndex = 1; rowIndex < sheet.content.length; rowIndex += 1) {
    const row = sheet.content[rowIndex];
    if (Array.isArray(row)) {
      row[info.index + 1] = `AM${String(rowIndex).padStart(4, "0")}`;
    }
  }
}

async function requestAddColumn(): Promise<void> {
  const name = await openInputDialog({
    title: "新增列",
    message:
      "新列会加入当前表头，并给已有数据行补一个空值。保存前，这个结构变化只存在于编辑器草稿中。",
    label: "列名",
    defaultValue: "新列",
    placeholder: "例如：状态",
    confirmLabel: "新增列",
  });
  if (name) config.addColumn(name);
}

async function requestDeleteColumn(index: number): Promise<void> {
  const header = headers.value[index] || `第 ${index + 1} 列`;
  const confirmed = await openConfirmDialog({
    title: "删除列",
    message: `确定要删除"${header}"吗？这会同时删除该列在所有数据行里的值。取消后草稿不会变化。`,
    confirmLabel: "删除列",
    confirmVariant: "danger",
  });
  if (!confirmed) return;
  config.deleteColumn(index);
}

useUiCloseGuard(async () => {
  if (!visualizer.isActive || !visualizer.dirty) return true;
  const action = await openCloseDirtyDialog();
  if (action === "cancel") return false;
  if (action === "discard") return true;
  return save.saveToChat();
});

function openInputDialog(options: {
  title: string;
  message: string;
  label: string;
  defaultValue: string;
  placeholder?: string;
  confirmLabel: string;
}): Promise<string | null> {
  return dialogStore.prompt({
    title: options.title,
    message: options.message,
    label: options.label,
    defaultValue: options.defaultValue,
    placeholder: options.placeholder,
    confirmLabel: options.confirmLabel,
  });
}

function openConfirmDialog(options: {
  title: string;
  message: string;
  confirmLabel: string;
  confirmVariant?: "default" | "primary" | "danger";
}): Promise<boolean> {
  return dialogStore.confirm({
    title: options.title,
    message: options.message,
    confirmLabel: options.confirmLabel,
    confirmVariant: options.confirmVariant,
  });
}

function updatePaginationWidth(): void {
  const el = paginationRef.value;
  if (!el) {
    paginationWidth.value = null;
    return;
  }
  if (el.clientWidth > 0) paginationWidth.value = el.clientWidth;
}

function observePaginationWidth(el: HTMLElement | null): void {
  paginationResizeObserver?.disconnect();
  paginationResizeObserver = undefined;

  if (!el) {
    paginationWidth.value = null;
    return;
  }

  paginationWidth.value = el.clientWidth || null;
  if (typeof ResizeObserver !== "function") return;

  paginationResizeObserver = new ResizeObserver((entries) => {
    const entry = entries[0];
    paginationWidth.value = entry?.contentRect.width || el.clientWidth || null;
  });
  paginationResizeObserver.observe(el);
}

function openCloseDirtyDialog(): Promise<"save" | "discard" | "cancel"> {
  return dialogStore.choose({
    title: "关闭数据库编辑器",
    message:
      "当前草稿还没有保存。保存会先写入当前聊天再关闭；丢弃会关闭编辑器并清空这次草稿；取消关闭会回到编辑器继续处理。",
    badge: { label: "未保存", variant: "warning" },
    cancelLabel: "取消关闭",
    actions: [
      { value: "save", label: "保存数据到当前消息", variant: "primary" },
      { value: "discard", label: "丢弃草稿", variant: "danger" },
    ],
  }).then((value) => value || "cancel");
}

onMounted(() => {
  void data.loadFromCurrentContext();
  void nextTick(updatePaginationWidth);
});

onBeforeUnmount(() => {
  clearMobileNavCloseTimer();
  paginationResizeObserver?.disconnect();
  paginationResizeObserver = undefined;
});

watch(
  paginationRef,
  (el) => {
    observePaginationWidth(el);
  },
  { flush: "post" },
);

watch(
  () => visualizer.externalRefreshTick,
  () => {
    if (!visualizer.isActive || visualizer.dirty) return;
    void data.loadFromCurrentContext();
  },
);

watch(
  () => visualizer.currentSheetKey,
  () => {
    currentDataPage.value = 1;
    clearDataCellEditing();
  },
);

watch(
  () => visualizer.mode,
  () => {
    clearDataCellEditing();
  },
);

watch(currentDataPage, (page) => {
  dataPageJumpValue.value = page;
});

watch(rowCount, () => {
  if (currentDataPage.value > dataPageCount.value) {
    currentDataPage.value = dataPageCount.value;
  }
  if (currentDataPage.value < 1) currentDataPage.value = 1;
  clearDataCellEditing();
});
</script>

<style scoped>
.acu-visualizer-surface {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  overflow: hidden;
  background: var(--acu-bg-0);
  color: var(--acu-text-1);
}

.acu-visualizer-surface__sidebar {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 24px 12px 16px;
  overflow-y: auto;
  border-right: 1px solid var(--acu-border-2);
  background: var(--acu-sidebar-bg);
}

.acu-visualizer-surface__main {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--acu-bg-0);
}

.acu-visualizer-surface__topbar {
  flex: 0 0 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 50px;
  padding: 8px 12px 8px 16px;
  border-bottom: 1px solid var(--acu-border-2);
  background: var(--acu-bg-0);
}

.acu-visualizer-surface__topbar-context {
  min-width: 0;
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  gap: 10px;
}

.acu-visualizer-surface__mobile-menu {
  display: none;
  flex: 0 0 auto;
  background: transparent;
  color: var(--acu-text-2);
  box-shadow: none;
}

.acu-visualizer-surface__mobile-menu:hover:not(:disabled) {
  background: transparent;
  color: var(--acu-text-1);
}

.acu-visualizer-surface__context-items {
  min-width: 0;
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  justify-content: flex-start;
  gap: 16px;
}

.acu-visualizer-surface__context-item {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.acu-visualizer-surface__context-item:first-child {
  flex: 0 1 auto;
  max-width: min(560px, 42vw);
}

.acu-visualizer-surface__context-item + .acu-visualizer-surface__context-item {
  flex: 0 0 auto;
  max-width: min(260px, 20vw);
}

.acu-visualizer-surface__context-item span {
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-caption, 11px);
  line-height: 1.2;
}

.acu-visualizer-surface__context-item strong {
  min-width: 0;
  overflow: hidden;
  color: var(--acu-text-1);
  font-size: var(--acu-font-size-body-lg, 13px);
  font-weight: 600;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acu-visualizer-surface__context-item:first-child strong {
  overflow: visible;
  text-overflow: clip;
  white-space: normal;
  word-break: break-word;
}

.acu-visualizer-surface__context-badge {
  flex: 0 0 auto;
}

.acu-visualizer-surface__conflict {
  flex: 0 0 auto;
  margin: 12px 16px 0;
}

.acu-visualizer-surface__conflict-actions {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-left: 8px;
}

.acu-visualizer-surface__data-toolbar,
.acu-visualizer-surface__data-toolbar-actions,
.acu-visualizer-surface__database-toolbar,
.acu-visualizer-surface__pagination,
.acu-visualizer-surface__pagination-pages,
.acu-visualizer-surface__card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.acu-visualizer-surface__workspace {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: auto;
  padding: 16px;
}

.acu-visualizer-surface__workspace--assistant {
  overflow: hidden;
  padding: 0;
}

.acu-visualizer-surface__loading {
  min-height: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--acu-text-3);
}

.acu-visualizer-surface__mode-tabs {
  flex: 0 0 auto;
  width: min(360px, 42vw);
}

.acu-visualizer-surface__close {
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  border: 0;
  background: transparent;
  color: var(--acu-text-2);
  font-size: var(--acu-font-size-page-title, 22px);
  line-height: 1;
  border-radius: var(--acu-radius-sm);
}

.acu-visualizer-surface__close:hover {
  background: var(--acu-hover-overlay);
  color: var(--acu-text-1);
}

.acu-visualizer-surface__data-toolbar {
  flex: 0 0 auto;
  justify-content: space-between;
  padding: 4px 0 0;
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-body, 12px);
}

.acu-visualizer-surface__data-toolbar-actions {
  flex: 0 0 auto;
  justify-content: flex-end;
}

.acu-visualizer-surface__pagination {
  flex: 0 0 auto;
  justify-content: center;
  gap: 14px;
  padding: 6px 0;
  color: var(--acu-text-2);
  font-size: var(--acu-font-size-body-lg, 13px);
}

.acu-visualizer-surface__pagination-pages {
  min-width: 0;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}

.acu-visualizer-surface__page-button {
  width: 34px;
  min-width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid var(--acu-border);
  background: var(--acu-bg-0);
  color: var(--acu-text-1);
  font-size: var(--acu-font-size-body-lg, 13px);
  font-weight: 500;
}

.acu-visualizer-surface__page-button:hover:not(:disabled) {
  border-color: var(--acu-accent);
  color: var(--acu-accent);
}

.acu-visualizer-surface__page-button--active,
.acu-visualizer-surface__page-button--active:hover:not(:disabled) {
  border-color: var(--acu-accent);
  background: var(--acu-accent);
  color: var(--acu-on-accent);
}

.acu-visualizer-surface__page-button:disabled:not(
    .acu-visualizer-surface__page-button--active
  ) {
  border-color: var(--acu-border);
  background: var(--acu-bg-0);
  color: var(--acu-text-2);
  opacity: 1;
  cursor: default;
}

.acu-visualizer-surface__page-jump {
  flex: 0 0 64px;
  width: 64px;
}

.acu-visualizer-surface__page-jump :deep(.acu-input) {
  min-height: 34px;
  border: 1px solid var(--acu-border) !important;
  background: var(--acu-bg-0) !important;
  text-align: center;
  font-size: var(--acu-font-size-body-lg, 13px) !important;
  font-variant-numeric: tabular-nums;
}

.acu-visualizer-surface__data-range {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acu-visualizer-surface__database-toolbar {
  flex: 0 0 auto;
  padding: 0 0 4px;
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-body, 12px);
}

.acu-visualizer-surface__database-toolbar h2 {
  margin: 0;
  color: var(--acu-text-1);
  font-size: var(--acu-font-size-page-title, 22px);
  font-weight: 700;
  line-height: 1.2;
}

.acu-visualizer-surface__database-toolbar p {
  margin: 5px 0 0;
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-body, 12px);
  line-height: var(--acu-line-height-readable, 1.55);
}

.acu-visualizer-surface__empty {
  margin: 0;
  color: var(--acu-text-2);
  font-size: var(--acu-font-size-body-lg, 13px);
  line-height: 1.55;
}

.acu-visualizer-surface__card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr));
  gap: 12px;
}

.acu-visualizer-surface__data-card {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  padding: 16px;
  border: 1px solid var(--acu-border);
  border-radius: var(--acu-radius-md);
  background: var(--acu-bg-1);
}

.acu-visualizer-surface__card-header strong {
  color: var(--acu-text-1);
  font-family: var(--acu-font-mono);
  font-size: var(--acu-font-size-panel-title, 15px);
}

.acu-visualizer-surface__card-header span {
  min-width: 0;
  margin-right: auto;
  overflow: hidden;
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-caption, 11px);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acu-visualizer-surface__card-header :deep(.acu-icon-btn) {
  background: transparent;
}

.acu-visualizer-surface__card-header
  :deep(.acu-icon-btn--default:hover:not(:disabled)) {
  background:
    linear-gradient(var(--acu-hover-overlay), var(--acu-hover-overlay)),
    transparent;
}

.acu-visualizer-surface__card-header :deep(.acu-icon-btn--accent) {
  background: var(--acu-accent-glow);
  color: var(--acu-accent);
}

.acu-visualizer-surface__card-header
  :deep(.acu-icon-btn--danger:hover:not(:disabled)) {
  background: color-mix(in srgb, var(--acu-danger) 12%, transparent);
}

.acu-visualizer-surface__fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.acu-visualizer-surface__field-row {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  align-items: stretch;
}

.acu-visualizer-surface__field-row.is-wide {
  grid-template-columns: minmax(0, 1fr);
}

.acu-visualizer-surface__field {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 2px;
  border: 1px solid transparent;
  border-radius: var(--acu-radius-sm);
  background: transparent;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.acu-visualizer-surface__field :deep(.acu-textarea) {
  flex: 1 1 auto;
  min-height: 34px;
  font-size: var(--acu-font-size-body, 12px);
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: break-word;
}

.acu-visualizer-surface__field-preview {
  width: 100%;
  min-height: 34px;
  box-sizing: border-box;
  padding: 8px 10px;
  border-radius: var(--acu-radius-sm);
  background: var(--acu-bg-2);
  color: var(--acu-text-1);
  cursor: text;
  display: block;
  font-size: var(--acu-font-size-body, 12px);
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: break-word;
  transition:
    background 0.15s ease,
    box-shadow 0.15s ease;
}

.acu-visualizer-surface__field-preview:hover,
.acu-visualizer-surface__field-preview:focus-visible {
  outline: none;
  background:
    linear-gradient(var(--acu-hover-overlay), var(--acu-hover-overlay)),
    var(--acu-bg-2);
  box-shadow: 0 0 0 2px var(--acu-accent-glow);
}

.acu-visualizer-surface__field-preview.is-empty {
  color: var(--acu-text-3);
}

.acu-visualizer-surface__field-label {
  min-width: 0;
  min-height: 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  color: var(--acu-text-2);
  font-size: var(--acu-font-size-caption, 11px);
  font-weight: 600;
}

.acu-visualizer-surface__field-label > span:first-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acu-visualizer-surface__field-locks {
  flex: 0 0 auto;
  min-width: 51px;
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 3px;
  opacity: 0.44;
  transition: opacity 0.15s ease;
}

.acu-visualizer-surface__field:hover .acu-visualizer-surface__field-locks,
.acu-visualizer-surface__field:focus-within
  .acu-visualizer-surface__field-locks,
.acu-visualizer-surface__field.is-actions-active
  .acu-visualizer-surface__field-locks,
.acu-visualizer-surface__field.is-locked .acu-visualizer-surface__field-locks,
.acu-visualizer-surface__field.is-special-index
  .acu-visualizer-surface__field-locks {
  opacity: 1;
}

.acu-visualizer-surface__field-locks :deep(.acu-icon-btn) {
  --acu-icon-btn-size: 24px;
  --acu-icon-btn-font-size: 11px;
  width: 24px;
  height: 24px;
  background: transparent !important;
}

.acu-visualizer-surface__field-locks
  :deep(.acu-icon-btn--default:hover:not(:disabled)) {
  background:
    linear-gradient(var(--acu-hover-overlay), var(--acu-hover-overlay)),
    transparent;
  color: var(--acu-text-1);
}

.acu-visualizer-surface__field-locks :deep(.acu-icon-btn--accent) {
  color: var(--acu-warning) !important;
  background: color-mix(in srgb, var(--acu-warning) 16%, transparent) !important;
}

.acu-visualizer-surface__field-locks
  :deep(.acu-icon-btn--accent:hover:not(:disabled)) {
  color: var(--acu-warning) !important;
  background: color-mix(in srgb, var(--acu-warning) 22%, transparent) !important;
}

.acu-visualizer-surface__field.is-locked {
  border-color: var(--acu-border);
  background: color-mix(in srgb, var(--acu-warning) 8%, transparent);
}

.acu-visualizer-surface__field.is-actions-active:not(.is-locked) {
  background: color-mix(in srgb, var(--acu-accent) 6%, transparent);
}

.acu-visualizer-surface__footer {
  flex: 0 0 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-top: 1px solid var(--acu-border-2);
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-body, 12px);
}

.acu-visualizer-surface__footer-actions {
  display: flex;
  gap: 8px;
  flex: 0 0 auto;
}

.acu-visualizer-surface__footer-actions :deep(.acu-btn) {
  min-width: 132px;
}

.acu-visualizer-surface__mobile-nav-layer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  inset: 0;
  width: 100%;
  width: 100vw;
  width: 100dvw;
  height: 100%;
  height: 100vh;
  height: 100dvh;
  min-height: 100vh;
  min-height: 100dvh;
  z-index: 9350;
  display: none;
  align-items: stretch;
  justify-content: flex-start;
  padding: var(--acu-safe-top, 0px) var(--acu-safe-right, 0px) var(--acu-safe-bottom, 0px) var(--acu-safe-left, 0px);
  overflow: hidden;
  background: rgba(0, 0, 0, 0.58);
  pointer-events: auto;
  overscroll-behavior: contain;
  animation: visualizer-mobile-nav-layer-in 0.18s ease-out both;
}

.acu-visualizer-surface__mobile-nav-layer.is-closing {
  pointer-events: auto;
  animation: visualizer-mobile-nav-layer-out 0.15s ease-in both;
}

.acu-visualizer-surface__mobile-nav {
  width: 360px;
  max-width: calc(100% - 24px - var(--acu-safe-left, 0px) - var(--acu-safe-right, 0px));
  height: 100%;
  max-height: 100%;
  min-width: 0;
  min-height: 0;
  align-self: stretch;
  flex: 0 1 360px;
  display: flex;
  flex-direction: column;
  padding: 24px 12px 16px;
  overflow-y: auto;
  border-right: 0;
  background: var(--acu-sidebar-bg);
  box-shadow: var(--acu-shadow);
  pointer-events: auto;
  animation: visualizer-mobile-nav-drawer-in 0.18s ease-out both;
}

.acu-visualizer-surface__mobile-nav-layer.is-closing
  .acu-visualizer-surface__mobile-nav {
  animation: visualizer-mobile-nav-drawer-out 0.15s ease-in both;
}

@supports (width: min(360px, calc(100% - 24px))) {
  .acu-visualizer-surface__mobile-nav {
    width: min(360px, calc(100% - 24px - var(--acu-safe-left, 0px) - var(--acu-safe-right, 0px)));
    flex: 0 0 min(360px, calc(100% - 24px - var(--acu-safe-left, 0px) - var(--acu-safe-right, 0px)));
  }
}

@supports (width: 100dvw) {
  .acu-visualizer-surface__mobile-nav {
    max-width: calc(100% - 24px - var(--acu-safe-left, 0px) - var(--acu-safe-right, 0px));
  }
}

@supports (height: 100dvh) {
  .acu-visualizer-surface__mobile-nav {
    height: 100%;
    max-height: 100%;
  }
}

@keyframes visualizer-mobile-nav-layer-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes visualizer-mobile-nav-drawer-in {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(0);
  }
}

@keyframes visualizer-mobile-nav-layer-out {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}

@keyframes visualizer-mobile-nav-drawer-out {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(-100%);
  }
}

@media (max-width: 1024px) {
  .acu-visualizer-surface {
    grid-template-columns: 220px minmax(0, 1fr);
  }

  .acu-visualizer-surface__card-grid {
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 360px), 1fr));
  }

  .acu-visualizer-surface__topbar {
    flex-wrap: wrap;
  }

  .acu-visualizer-surface__mode-tabs {
    order: 3;
    width: min(420px, 100%);
  }
}

@media (max-width: 767px) {
  .acu-visualizer-surface {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 1fr);
  }

  .acu-visualizer-surface__sidebar {
    display: none;
  }

  .acu-visualizer-surface__topbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    min-height: 0;
    padding: 8px;
  }

  .acu-visualizer-surface__topbar-context {
    grid-column: 1;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .acu-visualizer-surface__mobile-menu {
    display: inline-flex;
  }

  .acu-visualizer-surface__context-items {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .acu-visualizer-surface__context-item:first-child,
  .acu-visualizer-surface__context-item + .acu-visualizer-surface__context-item {
    max-width: none;
  }

  .acu-visualizer-surface__mobile-nav-layer {
    display: flex;
  }

  .acu-visualizer-surface__close {
    grid-column: 2;
    grid-row: 1;
    align-self: center;
  }

  .acu-visualizer-surface__mode-tabs {
    grid-column: 1 / -1;
    width: 100%;
  }

  .acu-visualizer-surface__workspace {
    padding: 10px;
  }

  .acu-visualizer-surface__data-toolbar,
  .acu-visualizer-surface__database-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .acu-visualizer-surface__data-toolbar :deep(.acu-btn),
  .acu-visualizer-surface__database-toolbar :deep(.acu-btn) {
    width: 100%;
  }

  .acu-visualizer-surface__data-toolbar-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .acu-visualizer-surface__pagination {
    align-items: center;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 6px;
    padding: 2px 0 6px;
  }

  .acu-visualizer-surface__pagination-pages {
    flex: 0 1 auto;
    align-items: center;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 5px;
  }

  .acu-visualizer-surface__page-button {
    width: 36px;
    min-width: 36px;
    height: 34px;
    flex: 0 0 36px;
  }

  .acu-visualizer-surface__page-jump {
    flex: 0 0 54px;
    width: 54px;
  }

  .acu-visualizer-surface__footer {
    display: grid;
    grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
    align-items: center;
    gap: 8px;
    padding: 8px;
  }

  .acu-visualizer-surface__footer > span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .acu-visualizer-surface__footer-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
  }

  .acu-visualizer-surface__footer-actions :deep(.acu-btn) {
    min-width: 0;
    width: 100%;
  }

}

@media (max-width: 480px) {
  .acu-visualizer-surface__card-grid {
    grid-template-columns: 1fr;
  }

  .acu-visualizer-surface__fields {
    grid-template-columns: 1fr;
  }

  .acu-visualizer-surface__mode-tabs {
    width: 100%;
  }

  .acu-visualizer-surface__conflict-actions {
    display: flex;
    margin: 8px 0 0;
  }

  .acu-visualizer-surface__footer {
    grid-template-columns: 1fr;
  }

  .acu-visualizer-surface__footer > span {
    display: none;
  }

}
</style>
