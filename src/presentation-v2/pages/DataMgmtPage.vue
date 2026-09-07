<template>
  <section class="acu-v2-data-mgmt-page">
    <AcuMessage v-if="flow.message.value" :kind="flow.message.value.kind">
      {{ flow.message.value.text }}
    </AcuMessage>

    <AcuPanelGrid class="acu-v2-data-mgmt-page__layout">
      <div class="acu-v2-data-mgmt-page__panel-stack">
        <AcuPanel v-if="SHOW_LEGACY_DATA_MGMT_UI"
          :title="dataMgmtCopy.panels.isolation.title"
          :description="dataMgmtCopy.panels.isolation.description"
        >
          <div class="acu-v2-data-mgmt-page__form-stack">
            <AcuFormRow label="标识代码" :hint="isolationCodeHint">
              <AcuInput
                :model-value="flow.isolationCode.value"
                type="text"
                placeholder="输入标识代码"
                @update:model-value="flow.isolationCode.value = String($event)"
              />
            </AcuFormRow>

            <AcuDisclosureGroup
              class="acu-v2-data-mgmt-page__history"
              label="历史标识"
              :meta="historyMetaLabel"
              :expanded="historyExpanded"
              body-id="acu-data-isolation-history"
              body-mode="if"
              @toggle="historyExpanded = !historyExpanded"
            >
              <div
                v-if="flow.isolationHistory.value.length"
                class="acu-v2-data-mgmt-page__history-list"
              >
                <div
                  v-for="code in flow.isolationHistory.value"
                  :key="code"
                  class="acu-v2-data-mgmt-page__history-item"
                >
                  <AcuButton
                    class="acu-v2-data-mgmt-page__history-fill"
                    size="sm"
                    :title="`填入历史标识：${code}`"
                    :disabled="!!flow.busyAction.value || runtimeDiagnostic.busy.value"
                    @click="selectHistory(code)"
                  >
                    <span class="acu-v2-data-mgmt-page__history-code">{{
                      code
                    }}</span>
                    <span
                      v-if="code === flow.currentIsolationLabel.value"
                      class="acu-v2-data-mgmt-page__history-current"
                    >
                      当前
                    </span>
                  </AcuButton>
                  <AcuIconButton
                    icon="fa-solid fa-trash-can"
                    variant="danger"
                    :title="`删除历史标识：${code}`"
                    :aria-label="`删除历史标识：${code}`"
                    :disabled="!!flow.busyAction.value || runtimeDiagnostic.busy.value"
                    @click="onRemoveHistory(code)"
                  />
                </div>
              </div>
              <p v-else class="acu-v2-data-mgmt-page__history-empty">
                暂无历史标识。
              </p>
            </AcuDisclosureGroup>
          </div>

          <div class="acu-v2-data-mgmt-page__actions">
            <AcuButton
              :disabled="runtimeDiagnostic.busy.value"
              :loading="flow.busyAction.value === 'delete-isolation-entries'"
              @click="onDeleteCurrentIsolationEntries"
            >
              删除当前标识注入条目
            </AcuButton>
            <AcuButton
              variant="primary"
              :disabled="runtimeDiagnostic.busy.value"
              :loading="flow.busyAction.value === 'apply-isolation'"
              @click="onApplyIsolation"
            >
              保存并应用
            </AcuButton>
          </div>
        </AcuPanel>

        <AcuPanel
          :title="dataMgmtCopy.panels.backup.title"
          :description="dataMgmtCopy.panels.backup.description"
        >
          <div v-if="SHOW_LEGACY_DATA_MGMT_UI" class="acu-v2-data-mgmt-page__command-grid">
            <AcuFileButton
              variant="primary"
              block
              accept=".json,application/json"
              :disabled="!!flow.busyAction.value || runtimeDiagnostic.busy.value"
              @file="flow.importCombinedSettings"
            >
              <i class="fa-solid fa-download"></i>
              合并导入（模板+指令）
            </AcuFileButton>
            <AcuButton
              block
              :disabled="!!flow.busyAction.value || runtimeDiagnostic.busy.value"
              @click="flow.exportCombinedSettings"
            >
              <i class="fa-solid fa-upload"></i>
              合并导出（模板+指令）
            </AcuButton>
            <AcuButton
              block
              :disabled="!!flow.busyAction.value || runtimeDiagnostic.busy.value"
              @click="flow.exportJsonData"
            >
              <i class="fa-solid fa-upload"></i>
              特殊导出
            </AcuButton>
            <AcuButton
              block
              :disabled="runtimeDiagnostic.busy.value"
              :loading="flow.busyAction.value === 'override-latest'"
              @click="onOverrideLatestLayer"
            >
              模板覆盖最新层数据
            </AcuButton>
          </div>
          <section class="acu-v2-data-mgmt-page__checkpoint-section" aria-labelledby="acu-checkpoint-title">
            <h3 id="acu-checkpoint-title" class="acu-v2-data-mgmt-page__section-title">当前聊天 Checkpoint</h3>
            <p class="acu-v2-data-mgmt-page__section-description">
              导出当前隔离标识的表格、聊天模板和指导表。导入会清空当前聊天全部 AI 楼层、所有隔离标识的本地表格数据，
              仅在当前激活隔离键的最新 AI 楼层重建数据；当前聊天表格模板会切换为文件模板，后续更新将使用该模板。
              全局模板和聊天正文不变。
            </p>
            <div class="acu-v2-data-mgmt-page__checkpoint-actions">
              <AcuButton block :disabled="!!flow.busyAction.value || runtimeDiagnostic.busy.value" @click="flow.exportTableCheckpoint">
                导出 Checkpoint
              </AcuButton>
              <AcuFileButton
                block
                accept=".json,application/json"
                :disabled="!!flow.busyAction.value || runtimeDiagnostic.busy.value"
                @file="onImportTableCheckpoint"
              >
                导入 Checkpoint
              </AcuFileButton>
            </div>
          </section>
          <section
            v-if="flow.mixedStorageDecision.value"
            class="acu-v2-data-mgmt-page__checkpoint-section"
            aria-labelledby="acu-mixed-storage-title"
          >
            <h3 id="acu-mixed-storage-title" class="acu-v2-data-mgmt-page__section-title">混合存储决议</h3>
            <p class="acu-v2-data-mgmt-page__section-description">
              当前聊天同时检测到 legacy-v1 与 V2 数据。决议：{{ flow.mixedStorageDecision.value.kind }}。
              <template v-if="flow.mixedStorageDecision.value.diagnosticCodes.length">
                诊断：{{ flow.mixedStorageDecision.value.diagnosticCodes.join('、') }}。
              </template>
              <template v-if="flow.mixedStorageDecision.value.anchorStatus || flow.mixedStorageDecision.value.replayStatus">
                锚点：{{ flow.mixedStorageDecision.value.anchorStatus }}；回放：{{ flow.mixedStorageDecision.value.replayStatus }}；
                静态表数：{{ flow.mixedStorageDecision.value.staticSheetKeyCount }}。
              </template>
              可先导出两份独立快照；提交动作只引用当前决议，不会从页面接收或覆盖表格数据。
            </p>
            <div class="acu-v2-data-mgmt-page__checkpoint-actions">
              <AcuButton block :disabled="runtimeDiagnostic.busy.value" :loading="flow.busyAction.value === 'export-mixed-storage-snapshots'" @click="flow.exportMixedStorageSnapshots">
                导出 legacy/V2 快照
              </AcuButton>
              <AcuButton
                v-if="flow.mixedStorageDecision.value.allowedActions.includes('keep_v2')"
                block
                :disabled="runtimeDiagnostic.busy.value"
                :loading="flow.busyAction.value === 'commit-mixed-storage-keep_v2'"
                @click="onCommitMixedStorageDecision('keep_v2')"
              >
                保留 V2 并清理 legacy
              </AcuButton>
              <AcuButton
                v-if="flow.mixedStorageDecision.value.allowedActions.includes('commit_merge_candidate')"
                block
                :disabled="runtimeDiagnostic.busy.value"
                :loading="flow.busyAction.value === 'commit-mixed-storage-commit_merge_candidate'"
                @click="onCommitMixedStorageDecision('commit_merge_candidate')"
              >
                提交受限合并候选
              </AcuButton>
            </div>
          </section>
          <section
            v-if="flow.v2RecoverySummary.value"
            class="acu-v2-data-mgmt-page__checkpoint-section"
            aria-labelledby="acu-v2-recovery-title"
          >
            <h3 id="acu-v2-recovery-title" class="acu-v2-data-mgmt-page__section-title">V2 数据恢复诊断</h3>
            <p class="acu-v2-data-mgmt-page__section-description">
              {{ flow.v2RecoverySummary.value.message }}
              恢复仅使用服务端冻结候选，不会从页面读取或提交可编辑表格数据。
            </p>
            <div class="acu-v2-data-mgmt-page__checkpoint-actions">
              <AcuButton block :disabled="!!flow.busyAction.value || runtimeDiagnostic.busy.value" @click="flow.exportV2RecoveryBackups">
                导出已保存的原始 frame 备份
              </AcuButton>
              <AcuButton
                v-if="flow.v2RecoverySummary.value.status === 'recoverable_repaired_checkpoint' || flow.v2RecoverySummary.value.status === 'recoverable_temporary_sheet_anchor' || flow.v2RecoverySummary.value.status === 'recoverable_redundant_full_checkpoint' || flow.v2RecoverySummary.value.status === 'recoverable_from_recovery_backup'"
                block
                variant="danger"
                :disabled="runtimeDiagnostic.busy.value"
                :loading="flow.busyAction.value === 'commit-v2-recovery'"
                @click="onCommitV2Recovery(false)"
              >
                应用 Checkpoint 修复/收敛
              </AcuButton>
              <AcuButton
                v-if="flow.v2RecoverySummary.value.status === 'recoverable_orphan_data_replace'"
                block
                variant="danger"
                :disabled="runtimeDiagnostic.busy.value"
                :loading="flow.busyAction.value === 'commit-v2-recovery'"
                @click="onCommitV2Recovery(true)"
              >
                确认无锚点 data_replace 恢复
              </AcuButton>
            </div>
          </section>
          <section
            v-if="flow.v2IsolationDiagnostics.value.length"
            class="acu-v2-data-mgmt-page__checkpoint-section"
            aria-labelledby="acu-v2-isolation-diagnostics-title"
          >
            <h3 id="acu-v2-isolation-diagnostics-title" class="acu-v2-data-mgmt-page__section-title">V2 隔离域恢复诊断</h3>
            <div class="acu-v2-data-mgmt-page__form-stack">
              <div v-for="diagnostic in flow.v2IsolationDiagnostics.value" :key="diagnostic.isolationKey" class="acu-v2-data-mgmt-page__history-item">
                <strong>{{ diagnostic.isolationKey || '默认隔离域' }}</strong>
                <p>{{ diagnostic.message }}</p>
                <p v-if="!diagnostic.isCurrentIsolation">请切换到该隔离域后重新诊断；当前恢复提交不会跨隔离域执行。</p>
                <p v-else-if="diagnostic.status.startsWith('recoverable_')">当前隔离域存在可恢复候选，请使用下方“诊断 V2 数据恢复”生成可提交计划。</p>
              </div>
            </div>
          </section>
          <section
            v-if="SHOW_LEGACY_DATA_MGMT_UI"
            class="acu-v2-data-mgmt-page__checkpoint-section acu-v2-data-mgmt-page__sqlite-runtime-section"
            aria-labelledby="acu-sqlite-runtime-title"
          >
            <h3 id="acu-sqlite-runtime-title" class="acu-v2-data-mgmt-page__section-title">
              {{ dataMgmtCopy.panels.backup.sqliteRuntime.title }}
            </h3>
            <p class="acu-v2-data-mgmt-page__meta">{{ dataMgmtCopy.panels.backup.sqliteRuntime.description }}</p>
            <dl class="acu-v2-data-mgmt-page__runtime-health" data-testid="sqlite-runtime-health">
              <div><dt>{{ dataMgmtCopy.panels.backup.sqliteRuntime.healthSnapshot.status }}</dt><dd>{{ runtimeDiagnostic.health.value.status }}</dd></div>
              <div><dt>{{ dataMgmtCopy.panels.backup.sqliteRuntime.healthSnapshot.expectedMode }}</dt><dd>{{ runtimeDiagnostic.health.value.expectedMode }}</dd></div>
              <div><dt>{{ dataMgmtCopy.panels.backup.sqliteRuntime.healthSnapshot.activeMode }}</dt><dd>{{ runtimeDiagnostic.health.value.activeMode || dataMgmtCopy.panels.backup.sqliteRuntime.healthSnapshot.unavailable }}</dd></div>
              <div><dt>{{ dataMgmtCopy.panels.backup.sqliteRuntime.healthSnapshot.source }}</dt><dd>{{ runtimeDiagnostic.health.value.source || dataMgmtCopy.panels.backup.sqliteRuntime.healthSnapshot.unavailable }}</dd></div>
              <div><dt>{{ dataMgmtCopy.panels.backup.sqliteRuntime.healthSnapshot.loadToken }}</dt><dd>{{ runtimeDiagnostic.health.value.loadToken }}</dd></div>
              <div><dt>{{ dataMgmtCopy.panels.backup.sqliteRuntime.healthSnapshot.failureCode }}</dt><dd>{{ runtimeDiagnostic.health.value.failureCode || dataMgmtCopy.panels.backup.sqliteRuntime.healthSnapshot.unavailable }}</dd></div>
            </dl>
            <div v-if="runtimeDiagnostic.isVisible.value" class="acu-v2-data-mgmt-page__checkpoint-actions">
              <AcuButton
                block
                variant="primary"
                :disabled="!!flow.busyAction.value"
                :loading="runtimeDiagnostic.busy.value"
                @click="onReloadSqliteRuntime"
              >
                {{ dataMgmtCopy.panels.backup.sqliteRuntime.reloadLabel }}
              </AcuButton>
            </div>
          </section>
          <div v-if="SHOW_LEGACY_DATA_MGMT_UI" class="acu-v2-data-mgmt-page__checkpoint-actions">
            <AcuButton block :disabled="runtimeDiagnostic.busy.value" :loading="flow.busyAction.value === 'scan-v2-isolation-diagnostics'" @click="flow.scanV2IsolationDiagnostics">
              扫描全部 V2 隔离域
            </AcuButton>
            <AcuButton block :disabled="runtimeDiagnostic.busy.value" :loading="flow.busyAction.value === 'prepare-v2-recovery'" @click="flow.prepareV2Recovery">
              诊断 V2 数据恢复
            </AcuButton>
          </div>
        </AcuPanel>
      </div>

      <div class="acu-v2-data-mgmt-page__panel-stack">
        <AcuPanel
          :title="dataMgmtCopy.panels.cleanup.title"
          :description="dataMgmtCopy.panels.cleanup.description"
        >
          <section
            class="acu-v2-data-mgmt-page__cleanup-section"
            aria-labelledby="acu-cleanup-auto-title"
          >
            <h3
              id="acu-cleanup-auto-title"
              class="acu-v2-data-mgmt-page__section-title"
            >
              自动清理
            </h3>
            <div class="acu-v2-data-mgmt-page__form-stack">
              <AcuFormRow
                label="保留数据层数"
                hint="自动更新结束后，超过保留范围的旧楼层插件数据会被清理；不影响聊天正文。"
              >
                <AcuInput
                  type="number"
                  :min="0"
                  :step="1"
                  :disabled="runtimeDiagnostic.busy.value"
                  :model-value="flow.retainRecentLayers.value"
                  @change="flow.setRetainRecentLayers($event)"
                />
              </AcuFormRow>
            </div>
          </section>

          <section
            class="acu-v2-data-mgmt-page__cleanup-section"
            aria-labelledby="acu-cleanup-manual-title"
          >
            <h3
              id="acu-cleanup-manual-title"
              class="acu-v2-data-mgmt-page__section-title"
            >
              手动删除
            </h3>
            <p class="acu-v2-data-mgmt-page__meta">
              当前聊天 {{ flow.aiMessageCount.value }} 个 AI 楼层 · 将处理：{{
                flow.rangeLabel.value
              }}
            </p>

            <div class="acu-v2-data-mgmt-page__form-grid">
              <AcuFormRow
                label="起始楼层"
                hint="从第N个楼层 AI 回复开始，留空为第 1 层。"
              >
                <AcuInput
                  :model-value="flow.deleteRange.startFloor"
                  type="number"
                  :min="1"
                  :step="1"
                  @update:model-value="flow.deleteRange.startFloor = $event"
                />
              </AcuFormRow>
              <AcuFormRow label="终止楼层" hint="留空为最新楼层。">
                <AcuInput
                  :model-value="flow.deleteRange.endFloor"
                  type="number"
                  :min="1"
                  :step="1"
                  placeholder="到最后"
                  @update:model-value="flow.deleteRange.endFloor = $event"
                />
              </AcuFormRow>
            </div>

            <div
              v-if="flow.deletableSheetOptions.value.length > 0"
              class="acu-v2-data-mgmt-page__sheet-filter"
              role="group"
              aria-labelledby="acu-cleanup-sheet-filter-title"
            >
              <div class="acu-v2-data-mgmt-page__sheet-filter-head">
                <span id="acu-cleanup-sheet-filter-title" class="acu-v2-data-mgmt-page__sheet-filter-title">限定表格（可选）</span>
                <button
                  v-if="flow.hasDeleteSheetSelection.value"
                  type="button"
                  class="acu-v2-data-mgmt-page__sheet-filter-clear"
                  :disabled="runtimeDiagnostic.busy.value"
                  @click="flow.clearDeleteSheetSelection"
                >
                  清除选择
                </button>
              </div>
              <div class="acu-v2-data-mgmt-page__sheet-filter-list">
                <AcuCheckbox
                  v-for="option in flow.deletableSheetOptions.value"
                  :key="option.sheetKey"
                  :model-value="flow.deleteSheetKeys.value.includes(option.sheetKey)"
                  :label="option.name"
                  :disabled="runtimeDiagnostic.busy.value"
                  :data-sheet-key="option.sheetKey"
                  @update:model-value="flow.toggleDeleteSheetKey(option.sheetKey, $event)"
                />
              </div>
              <p class="acu-v2-data-mgmt-page__meta">
                勾选后只删除所选表格在楼层范围内的数据（包括 checkpoint 里这些表的数据），其它表格、模板与指导表都不受影响；不勾选则按整楼层删除。
              </p>
            </div>

          </section>


            <p class="acu-v2-data-mgmt-page__meta">
              {{ flow.hasDeleteSheetSelection.value
                ? `当前已限定 ${flow.deleteSheetKeys.value.length} 张表：${flow.selectedDeleteSheetNames.value.join('、')}。按表删除不会硬清空，即便范围覆盖全部楼层。`
                : '楼层范围同时作用于两个删除按钮。「删除所有本地数据」在范围覆盖全部 AI 楼层时执行硬清空，范围为局部时只删除对应楼层的填表数据。' }}
            </p>

          <div
            class="acu-v2-data-mgmt-page__command-grid acu-v2-data-mgmt-page__command-grid--cleanup"
          >
            <AcuButton v-if="SHOW_LEGACY_DATA_MGMT_UI"
              block
              :disabled="runtimeDiagnostic.busy.value"
              :loading="flow.busyAction.value === 'delete-current-local'"
              @click="onDeleteLocalData('current')"
            >
              删除当前标识本地数据
            </AcuButton>
            <AcuButton
              block
              variant="danger"
              :disabled="runtimeDiagnostic.busy.value"
              :loading="flow.busyAction.value === 'purge-all-local' || flow.busyAction.value === 'delete-all-local'"
              @click="onDeleteLocalData('all')"
            >
              {{ flow.hasDeleteSheetSelection.value ? `删除所选 ${flow.deleteSheetKeys.value.length} 张表的数据` : '删除所有本地数据' }}
            </AcuButton>
            <AcuButton
              block
              :disabled="runtimeDiagnostic.busy.value"
              :loading="flow.busyAction.value === 'reset-defaults'"
              @click="onResetAllDefaults"
            >
              恢复默认配置
            </AcuButton>
          </div>
        </AcuPanel>
      </div>
    </AcuPanelGrid>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import AcuButton from "../components/_lib/AcuButton.vue";
import AcuDisclosureGroup from "../components/_lib/AcuDisclosureGroup.vue";
import AcuFileButton from "../components/_lib/AcuFileButton.vue";
import AcuFormRow from "../components/_lib/AcuFormRow.vue";
import AcuIconButton from "../components/_lib/AcuIconButton.vue";
import AcuInput from "../components/_lib/AcuInput.vue";
import AcuMessage from "../components/_lib/AcuMessage.vue";
import AcuPanel from "../components/_lib/AcuPanel.vue";
import AcuPanelGrid from "../components/_lib/AcuPanelGrid.vue";
import AcuCheckbox from "../components/_lib/AcuCheckbox.vue";
import { useChatChangedTick } from "../composables/useChatChangedListener";
import { useSqliteRuntimeDiagnostic } from "../composables/useSqliteRuntimeDiagnostic";
import {
  useDataManagement,
  type ResetDefaultsCleanupKey,
  type ResetDefaultsCleanupOptions,
} from "../composables/useDataManagement";
import { dataMgmtCopy } from "../copy/data-mgmt-copy";
import { useDialogStore } from "../stores/dialog-store";
import type { MixedStorageCommitAction_ACU } from "../../shared/models/mixed-storage-commit-action";

/**
 * 旧数据管理入口的 UI 显示开关。
 *
 * 本次仅隐藏 UI，不改变业务逻辑：useDataManagement、SQLite 运行时诊断、
 * busy 联动和全部 service 链路仍会初始化并随聊天切换刷新。改为 true 即可
 * 恢复以下区块：数据隔离、备份四按钮、当前标识本地数据删除、SQLite 诊断和
 * V2 隔离域/恢复诊断触发按钮。
 *
 * 隐藏这些入口意味着隔离标识切换及手工 V2 恢复诊断不再能从页面触达；已持久化
 * 的隔离逻辑不受影响。
 */
const SHOW_LEGACY_DATA_MGMT_UI = false;

const resetDefaultsCleanupOptions: Array<{
  value: ResetDefaultsCleanupKey;
  label: string;
  description: string;
  defaultChecked: boolean;
}> = [
  {
    value: "restore-template-prompts",
    label: "默认表格模板与提示词",
    description: "恢复默认表格模板、填表提示词和合并总结提示词。",
    defaultChecked: true,
  },
  {
    value: "clear-template-snapshots",
    label: "当前聊天表格模板快照",
    description: "清理当前标识下由前端或角色卡导入的临时表格模板、预设快照和指导表。",
    defaultChecked: true,
  },
  {
    value: "clear-plot-snapshots",
    label: "当前聊天剧情推进预设快照",
    description: "清理当前聊天临时剧情推进覆盖，让它重新跟随全局设置。",
    defaultChecked: true,
  },
  {
    value: "clear-table-locks",
    label: "当前聊天表格锁",
    description: "清理当前聊天和当前标识下的表格行、列、单元格锁定状态。",
    defaultChecked: true,
  },
  {
    value: "clear-table-order",
    label: "表格顺序缓存",
    description: "清空旧的表格顺序缓存，后续按当前模板顺序重新显示。",
    defaultChecked: true,
  },
];

const dialogStore = useDialogStore();
const flow = useDataManagement();
const runtimeDiagnostic = useSqliteRuntimeDiagnostic();
const historyExpanded = ref(false);

const isolationCodeHint = computed(
  () =>
    `当前正在使用：${flow.currentIsolationLabel.value}。留空表示默认数据；修改后点击“保存并应用”才会切换。`,
);
const historyMetaLabel = computed(
  () => `${flow.isolationHistory.value.length} 个`,
);

function selectHistory(value: string): void {
  if (value && !runtimeDiagnostic.busy.value) flow.isolationCode.value = value;
}

async function onApplyIsolation(): Promise<void> {
  if (runtimeDiagnostic.busy.value) return;
  await flow.applyIsolation();
}

async function onRemoveHistory(code: string): Promise<void> {
  if (runtimeDiagnostic.busy.value) return;
  await flow.removeHistory(code);
}

async function onDeleteCurrentIsolationEntries(): Promise<void> {
  if (runtimeDiagnostic.busy.value) return;
  const confirmed = await dialogStore.confirm({
    title: "删除注入条目",
    message:
      "删除当前标识的数据库注入条目？这不会删除聊天正文，但会移除世界书里的插件生成条目。",
    confirmLabel: "删除注入条目",
    confirmVariant: "danger",
  });
  if (!confirmed)
    return;
  if (runtimeDiagnostic.busy.value) return;
  void flow.deleteCurrentIsolationEntries();
}

async function onOverrideLatestLayer(): Promise<void> {
  if (runtimeDiagnostic.busy.value) return;
  const confirmed = await dialogStore.confirm({
    title: "覆盖最新层数据",
    message:
      "用当前生效模板覆盖最新 AI 楼层的表格数据？这会清空模板内表格的数据行，只保留表头。",
    confirmLabel: "覆盖数据",
    confirmVariant: "danger",
  });
  if (!confirmed)
    return;
  if (runtimeDiagnostic.busy.value) return;
  void flow.overrideLatestLayerWithTemplate();
}

async function onImportTableCheckpoint(file: File): Promise<void> {
  if (runtimeDiagnostic.busy.value) return;
  const checkpoint = await flow.parseTableCheckpoint(file);
  if (!checkpoint) return;
  const sourceStorageMode = checkpoint.source.storageMode;
  const targetStorageMode = flow.getCheckpointTargetStorageMode();
  const confirmed = await dialogStore.confirm({
    title: "恢复当前聊天 Checkpoint",
    message: `导入将清空当前聊天全部 AI 楼层、所有隔离标识的本地表格数据。
仅在当前激活隔离键的最新 AI 楼层重建文件中的表格数据。
当前聊天表格模板会切换为文件模板，后续更新将使用该模板。
全局模板和聊天正文不变。来源模式：${sourceStorageMode}；目标模式：${targetStorageMode}。确认继续？`,
    confirmLabel: "恢复 Checkpoint",
    confirmVariant: "danger",
  });
  if (!confirmed) return;
  if (runtimeDiagnostic.busy.value) return;
  void flow.restoreTableCheckpoint(checkpoint);
}

async function onDeleteLocalData(mode: "current" | "all"): Promise<void> {
  if (runtimeDiagnostic.busy.value) return;
  const path = flow.resolveDeletionPath(mode);

  if (flow.hasDeleteSheetSelection.value) {
    const names = flow.selectedDeleteSheetNames.value;
    const confirmed = await dialogStore.confirm({
      title: "删除所选表格数据",
      message:
        `删除当前聊天中 ${flow.rangeLabel.value} 内表「${names.join("」「")}」的数据？\n` +
        "包括该范围内 full checkpoint、单表 checkpoint 与填表日志里属于这些表的部分；\n" +
        "其它表格的数据、聊天级模板 scope 与 guide 容器一律保留，不会执行硬清空。\n" +
        "仅作用于当前隔离标识。此操作不可恢复。",
      confirmLabel: "删除所选表格数据",
      confirmVariant: "danger",
    });
    if (!confirmed) return;
    if (runtimeDiagnostic.busy.value) return;
    void flow.deleteLocalData(mode);
    return;
  }

  if (path === "range") {
    const scopeText = mode === "current" ? "属于当前标识的" : "所有标识的";
    const confirmed = await dialogStore.confirm({
      title: mode === "current" ? "删除当前标识本地数据" : "删除指定楼层本地数据",
      message:
        `删除当前聊天中 ${flow.rangeLabel.value} ${scopeText}数据库数据？\n` +
        "仅清除该范围内楼层的填表数据；聊天级模板 scope 与 guide 容器保留，\n" +
        "未覆盖的楼层数据不受影响。此操作不可恢复。",
      confirmLabel: "删除数据",
      confirmVariant: "danger",
    });
    if (!confirmed) return;
    if (runtimeDiagnostic.busy.value) return;
    void flow.deleteLocalData(mode);
    return;
  }

  // path === 'purge'：范围覆盖全部 AI 楼层，将执行硬清空，保留两级确认。
  const confirmed = await dialogStore.confirm({
    title: "删除所有本地数据",
    message:
      "当前删除范围覆盖全部 AI 楼层，将硬清空当前聊天的全部本地数据库状态：\n" +
      "· 清除所有隔离标识的本地数据（不只当前标识）；\n" +
      "· 含用户首条消息上的字段；\n" +
      "· 清除聊天级模板 scope 与 guide 容器（模板选择回到继承全局）；\n" +
      "· 不保留 init 锚点，重新填表时 sheetKey 会重新分配；\n" +
      "· 结果等价于全新会话，不可恢复。\n" +
      "若只想删除部分楼层，请先在上方设置起止楼层范围。\n" +
      "全局模板、提示词与聊天正文不受影响。确认继续？",
    confirmLabel: "删除所有本地数据",
    confirmVariant: "danger",
  });
  if (!confirmed) return;
  if (!(await dialogStore.confirm({
    title: "再次确认删除",
    message: "再次确认：将当前聊天恢复到从未填表的全新状态？此操作不可撤销。",
    confirmLabel: "确认硬清空",
    confirmVariant: "danger",
  }))) return;
  if (runtimeDiagnostic.busy.value) return;
  void flow.deleteLocalData("all");
}


async function onCommitMixedStorageDecision(action: MixedStorageCommitAction_ACU): Promise<void> {
  if (runtimeDiagnostic.busy.value) return;
  const isMerge = action === 'commit_merge_candidate';
  const confirmed = await dialogStore.confirm({
    title: isMerge ? '提交混合存储合并候选' : '保留 V2 数据并清理 legacy',
    message: isMerge
      ? '将只提交服务端冻结且已审计通过的合并候。页面不会提交任何可编辑表格数据。确认继续？'
      : '将保留已验证的 V2 数据并清理冗余 legacy-v1 数据。确认继续？',
    confirmLabel: isMerge ? '继续提交候选' : '保留 V2',
    confirmVariant: 'danger',
  });
  if (!confirmed) return;
  if (isMerge) {
    const secondConfirmed = await dialogStore.confirm({
      title: '再次确认合并候选',
      message: '候选内容以服务端冻结决议为准；提交后不会用 legacy 数据覆盖 V2。确认提交？',
      confirmLabel: '确认提交候选',
      confirmVariant: 'danger',
    });
    if (!secondConfirmed) return;
  }
  if (runtimeDiagnostic.busy.value) return;
  void flow.commitMixedStorageDecision(action);
}

async function onCommitV2Recovery(confirmOrphanDataReplace: boolean): Promise<void> {
  if (runtimeDiagnostic.busy.value) return;
  const isOrphan = confirmOrphanDataReplace;
  const confirmed = await dialogStore.confirm({
    title: isOrphan ? '确认无锚点 data_replace 恢复' : '应用 V2 Checkpoint 修复',
    message: isOrphan
      ? '将只提交服务端冻结的无锚点 data_replace 候选。原始 frame 会保留为隔离备份，页面不会提交任何可编辑表格数据。确认继续？'
      : '将只提交服务端冻结且已审计通过的 Checkpoint 修复候选。原始 frame 会保留为隔离备份。确认继续？',
    confirmLabel: isOrphan ? '继续恢复' : '应用修复',
    confirmVariant: 'danger',
  });
  if (!confirmed) return;
  if (isOrphan) {
    const secondConfirmed = await dialogStore.confirm({
      title: '再次确认无锚点恢复',
      message: '无锚点 data_replace 会被提升为新的 full checkpoint。恢复内容完全以服务端冻结候选为准。确认提交？',
      confirmLabel: '确认提交恢复',
      confirmVariant: 'danger',
    });
    if (!secondConfirmed) return;
  }
  if (runtimeDiagnostic.busy.value) return;
  void flow.commitV2Recovery(isOrphan);
}

async function onReloadSqliteRuntime(): Promise<void> {
  if (runtimeDiagnostic.busy.value || flow.busyAction.value) return;
  const confirmed = await dialogStore.confirm({
    title: "重新初始化当前聊天 SQLite 运行时",
    message:
      "这只会重建当前聊天的 SQLite 内存数据库，不会修改聊天正文、Checkpoint、模板或世界书。确认继续？",
    confirmLabel: "重新初始化运行时",
    confirmVariant: "primary",
  });
  if (!confirmed) return;
  if (runtimeDiagnostic.busy.value || flow.busyAction.value) return;
  await runtimeDiagnostic.reload();
}

async function onResetAllDefaults(): Promise<void> {
  if (runtimeDiagnostic.busy.value) return;
  const selected = await dialogStore.selectMany<ResetDefaultsCleanupKey>({
    title: "恢复默认配置",
    message:
      "选择本次要恢复或清理的项目。默认全选；取消某一项后会保留对应内容。此流程不会删除聊天正文、本地楼层数据、API 配置或全局预设库。",
    options: resetDefaultsCleanupOptions,
    confirmLabel: "按所选项目恢复",
    confirmVariant: "danger",
    requireNonEmpty: true,
  });
  if (!selected) return;
  if (runtimeDiagnostic.busy.value) return;

  const selectedSet = new Set(selected);
  const cleanup: ResetDefaultsCleanupOptions = {
    restoreTemplateAndPrompts: selectedSet.has("restore-template-prompts"),
    clearTemplateSnapshots: selectedSet.has("clear-template-snapshots"),
    clearPlotSnapshots: selectedSet.has("clear-plot-snapshots"),
    clearTableLocks: selectedSet.has("clear-table-locks"),
    clearTableOrder: selectedSet.has("clear-table-order"),
  };
  void flow.resetAllDefaults(cleanup);
}

function refreshAll(): void {
  flow.refresh();
  runtimeDiagnostic.refresh();
  historyExpanded.value = false;
}

onMounted(refreshAll);
watch(useChatChangedTick(), refreshAll);
</script>

<style scoped>
.acu-v2-data-mgmt-page {
  min-height: 100%;
  min-width: 0;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.acu-v2-data-mgmt-page__panel-stack {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.acu-v2-data-mgmt-page__form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.acu-v2-data-mgmt-page__form-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.acu-v2-data-mgmt-page__meta {
  margin: 0;
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-body, 12px);
  line-height: 1.55;
}

.acu-v2-data-mgmt-page__cleanup-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.acu-v2-data-mgmt-page__sheet-filter {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--acu-border);
  border-radius: var(--acu-radius-md, 8px);
  background: var(--acu-bg-1);
}

.acu-v2-data-mgmt-page__sheet-filter-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.acu-v2-data-mgmt-page__sheet-filter-title {
  color: var(--acu-text-2);
  font-size: var(--acu-font-size-body, 12px);
  font-weight: 600;
}

.acu-v2-data-mgmt-page__sheet-filter-clear {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--acu-accent);
  font: inherit;
  font-size: var(--acu-font-size-body, 12px);
  cursor: pointer;
}

.acu-v2-data-mgmt-page__sheet-filter-clear:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.acu-v2-data-mgmt-page__sheet-filter-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 6px 12px;
}

.acu-v2-data-mgmt-page__cleanup-section
  + .acu-v2-data-mgmt-page__cleanup-section {
  margin-top: 4px;
  padding-top: 14px;
  border-top: 1px solid var(--acu-border);
}

.acu-v2-data-mgmt-page__section-title {
  margin: 0;
  color: var(--acu-text-1);
  font-size: var(--acu-font-size-body-lg, 13px);
  font-weight: 600;
  line-height: 1.35;
}

.acu-v2-data-mgmt-page__history {
  border: 1px solid var(--acu-border);
  border-radius: var(--acu-radius-sm);
  background: color-mix(in srgb, var(--acu-bg-2) 72%, transparent);
}

.acu-v2-data-mgmt-page__history :deep(.acu-disclosure-group__header) {
  border-radius: var(--acu-radius-sm);
}

.acu-v2-data-mgmt-page__history-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.acu-v2-data-mgmt-page__history-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
}

.acu-v2-data-mgmt-page__history-fill {
  width: 100%;
  min-width: 0;
  justify-content: flex-start;
}

.acu-v2-data-mgmt-page__history-code {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--acu-font-mono, Consolas, Menlo, monospace);
}

.acu-v2-data-mgmt-page__history-current {
  flex-shrink: 0;
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-caption, 11px);
}

.acu-v2-data-mgmt-page__history-empty {
  margin: 0;
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-caption, 11px);
  line-height: 1.5;
}

.acu-v2-data-mgmt-page__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.acu-v2-data-mgmt-page__actions,
.acu-v2-data-mgmt-page__command-grid {
  padding-top: 12px;
  margin-top: 4px;
}

.acu-v2-data-mgmt-page__command-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.acu-v2-data-mgmt-page__command-grid--cleanup {
  margin-top: 12px;
}

.acu-v2-data-mgmt-page__checkpoint-section {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--acu-border, rgba(255, 255, 255, 0.12));
}

.acu-v2-data-mgmt-page__runtime-health {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 12px 0 0;
}

.acu-v2-data-mgmt-page__runtime-health > div {
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--acu-border);
  border-radius: var(--acu-radius-sm);
  background: color-mix(in srgb, var(--acu-bg-2) 72%, transparent);
}

.acu-v2-data-mgmt-page__runtime-health dt {
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-caption, 11px);
}

.acu-v2-data-mgmt-page__runtime-health dd {
  margin: 4px 0 0;
  overflow-wrap: anywhere;
  color: var(--acu-text-1);
  font-family: var(--acu-font-mono, Consolas, Menlo, monospace);
}

.acu-v2-data-mgmt-page__checkpoint-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 10px;
}

.acu-v2-data-mgmt-page__checkpoint-actions :deep(.acu-file-button),
.acu-v2-data-mgmt-page__checkpoint-actions :deep(.acu-btn) { width: 100%; min-width: 0; }

.acu-v2-data-mgmt-page__command-grid :deep(.acu-file-button),
.acu-v2-data-mgmt-page__command-grid :deep(.acu-btn) {
  width: 100%;
  min-width: 0;
}

@media (max-width: 860px) {
  .acu-v2-data-mgmt-page {
    padding: 14px;
  }

  .acu-v2-data-mgmt-page__form-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 560px) {
  .acu-v2-data-mgmt-page__command-grid {
    grid-template-columns: 1fr;
  }
  .acu-v2-data-mgmt-page__checkpoint-actions {
    grid-template-columns: 1fr;
  }
  .acu-v2-data-mgmt-page__runtime-health {
    grid-template-columns: 1fr;
  }
}
</style>
