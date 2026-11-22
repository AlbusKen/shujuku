<template>
  <div class="acu-viz-config" data-acu-visualizer-config>
    <AcuPanel
      title="基本信息与列定义"
      description="这里改表名和列名。AI 按这些名称理解栏目，如果总是填错列，先检查这里。"
    >
      <div class="acu-viz-config__grid">
        <AcuFormRow label="表格名称">
          <AcuInput
            :model-value="config.currentSheet.value?.name || ''"
            @update:model-value="config.renameSheet"
          />
        </AcuFormRow>
        <AcuFormRow label="表级 API 预设">
          <AcuSelect
            :model-value="config.currentTableApiPreset.value"
            :options="config.apiPresetOptions.value"
            @update:model-value="config.setTableApiPreset"
          />
        </AcuFormRow>
      </div>

      <div class="acu-viz-config__columns">
        <article
          v-for="column in config.visibleColumnEntries.value"
          :key="`column-${column.columnIndex}`"
          class="acu-viz-config__column-row"
        >
          <span class="acu-viz-config__column-index">#{{ column.columnIndex + 1 }}</span>
          <AcuInput
            :model-value="column.header"
            @update:model-value="value => config.updateHeader(column.columnIndex, value)"
          />
          <AcuIconButton
            icon="fa-solid fa-trash"
            size="sm"
            variant="danger"
            title="删除列"
            @click="$emit('request-delete-column', column.columnIndex)"
          />
        </article>
        <p v-if="config.visibleColumnEntries.value.length === 0" class="acu-viz-config__empty">
          当前表没有可编辑列。新增列后，已有数据行会自动补一个空值。
        </p>
        <div class="acu-viz-config__column-operation">
          <AcuButton size="sm" variant="primary" @click="$emit('request-add-column')">
            <i class="fa-solid fa-plus"></i>
            新增列
          </AcuButton>
        </div>
      </div>
    </AcuPanel>

    <AcuPanel
      title="自动化更新参数"
      description="调整当前表自动更新的范围和频率。不确定填 -1；想停用自动更新请把频率设为 0。"
    >
      <div class="acu-viz-config__grid acu-viz-config__grid--three">
        <AcuFormRow label="上下文层数">
          <AcuInput
            type="number"
            :model-value="updateConfig.contextDepth"
            :min="-1"
            :step="1"
            @update:model-value="value => config.updateUpdateConfig('contextDepth', value)"
          />
        </AcuFormRow>
        <AcuFormRow label="更新频率">
          <AcuInput
            type="number"
            :model-value="updateConfig.updateFrequency"
            :min="-1"
            :step="1"
            @update:model-value="value => config.updateUpdateConfig('updateFrequency', value)"
          />
        </AcuFormRow>
        <AcuFormRow label="批处理大小">
          <AcuInput
            type="number"
            :model-value="updateConfig.batchSize"
            :min="-1"
            :step="1"
            @update:model-value="value => config.updateUpdateConfig('batchSize', value)"
          />
        </AcuFormRow>
        <AcuFormRow label="分组编号">
          <AcuInput
            type="number"
            :model-value="updateConfig.groupId"
            :min="-1"
            :step="1"
            @update:model-value="value => config.updateUpdateConfig('groupId', value)"
          />
        </AcuFormRow>
        <AcuFormRow label="跳过楼层">
          <AcuInput
            type="number"
            :model-value="updateConfig.skipFloors"
            :min="-1"
            :step="1"
            @update:model-value="value => config.updateUpdateConfig('skipFloors', value)"
          />
        </AcuFormRow>
        <AcuFormRow label="发送最新行数">
          <AcuInput
            type="number"
            :model-value="updateConfig.sendLatestRows"
            :min="-1"
            :step="1"
            @update:model-value="value => config.updateUpdateConfig('sendLatestRows', value)"
          />
        </AcuFormRow>
      </div>
      <AcuFormRow
        v-if="config.isSQLite.value"
        label="填表发送数据模板"
        hint="高级功能：用自定义 SQL 筛选发给填表 AI 的当前数据，留空则继续按“发送最新行数”发送。"
      >
        <AcuTextarea
          :model-value="updateConfig.sendRowsSqlTemplate"
          :rows="6"
          auto-resize
          :placeholder="sendRowsSqlTemplatePlaceholder"
          @update:model-value="value => config.updateUpdateConfig('sendRowsSqlTemplate', value)"
        />
      </AcuFormRow>
    </AcuPanel>

    <AcuPanel
      title="AI 触发提示词"
      description="写给 AI 的表格说明和增删改规则。AI 不按预期改表时，先检查这里是否写清楚。"
    >
      <div class="acu-viz-config__prompts">
        <AcuFormRow label="表格说明">
          <AcuTextarea
            :model-value="sourceData.note"
            :rows="3"
            auto-resize
            @update:model-value="value => config.updateSourceData('note', value)"
          />
        </AcuFormRow>
        <AcuFormRow label="初始化触发">
          <AcuTextarea
            :model-value="sourceData.initNode"
            :rows="2"
            auto-resize
            @update:model-value="value => config.updateSourceData('initNode', value)"
          />
        </AcuFormRow>
        <AcuFormRow label="新增触发">
          <AcuTextarea
            :model-value="sourceData.insertNode"
            :rows="2"
            auto-resize
            @update:model-value="value => config.updateSourceData('insertNode', value)"
          />
        </AcuFormRow>
        <AcuFormRow label="更新触发">
          <AcuTextarea
            :model-value="sourceData.updateNode"
            :rows="2"
            auto-resize
            @update:model-value="value => config.updateSourceData('updateNode', value)"
          />
        </AcuFormRow>
        <AcuFormRow label="删除触发">
          <AcuTextarea
            :model-value="sourceData.deleteNode"
            :rows="2"
            auto-resize
            @update:model-value="value => config.updateSourceData('deleteNode', value)"
          />
        </AcuFormRow>
      </div>
    </AcuPanel>

    <AcuPanel
      v-if="config.isSQLite.value"
      title="DDL 定义"
      description="SQLite 模式在这里填 SQL 语法。与上方表头不一致时，填表可能报错或写错列。"
    >
      <AcuFormRow label="CREATE TABLE 语句">
        <AcuTextarea
          class="acu-viz-config__ddl"
          :model-value="sourceData.ddl"
          :rows="7"
          auto-resize
          @update:model-value="value => config.updateSourceData('ddl', value)"
        />
      </AcuFormRow>
      <div class="acu-viz-config__inline-actions">
        <AcuButton size="sm" @click="validateDDL">
          <i class="fa-solid fa-check-circle"></i>
          校验 DDL
        </AcuButton>
        <AcuBadge v-if="ddlValidation" :variant="ddlValidation.valid ? 'accent' : 'warning'">
          {{ ddlValidation.message }}
        </AcuBadge>
      </div>
    </AcuPanel>

    <AcuPanel
      title="世界书注入配置"
      description="控制这张表是否写入世界书、写成哪些条目及摆放位置。世界书缺失、重复或位置不对时检查这里。"
    >
      <div class="acu-viz-config__toggles">
        <AcuCheckbox
          :model-value="exportConfig.injectIntoWorldbook !== false"
          label="注入到世界书条目"
          @update:model-value="value => config.updateExportConfig('injectIntoWorldbook', value)"
        />
        <AcuCheckbox
          :model-value="exportConfig.enabled === true"
          label="启用独立导出"
          @update:model-value="value => config.updateExportConfig('enabled', value)"
        />
      </div>

      <AcuFormRow v-if="config.isSQLite.value" label="SQL 注入模板">
        <AcuTextarea
          :model-value="exportConfig.sqlInjectionTemplate || ''"
          :rows="5"
          auto-resize
          :placeholder="sqlInjectionTemplatePlaceholder"
          @update:model-value="value => config.updateExportConfig('sqlInjectionTemplate', value)"
        />
      </AcuFormRow>

      <template v-if="exportConfig.enabled === true">
        <div class="acu-viz-config__toggles">
          <AcuCheckbox
            :model-value="exportConfig.splitByRow === true"
            label="按行拆分独立条目"
            @update:model-value="value => config.updateExportConfig('splitByRow', value)"
          />
          <AcuCheckbox
            :model-value="exportConfig.preventRecursion !== false"
            label="防止递归触发"
            @update:model-value="value => config.updateExportConfig('preventRecursion', value)"
          />
        </div>

        <div class="acu-viz-config__grid">
          <AcuFormRow label="条目名称">
            <AcuInput
              :model-value="exportConfig.entryName || ''"
              @update:model-value="value => config.updateExportConfig('entryName', value)"
            />
          </AcuFormRow>
          <AcuFormRow label="条目类型">
            <AcuSelect
              :model-value="exportConfig.entryType || 'constant'"
              :options="config.entryTypeOptions"
              @update:model-value="value => config.updateExportConfig('entryType', value)"
            />
          </AcuFormRow>
          <AcuFormRow label="关键词">
            <AcuInput
              :model-value="exportConfig.keywords || ''"
              @update:model-value="value => config.updateExportConfig('keywords', value)"
            />
          </AcuFormRow>
        </div>

        <AcuFormRow label="自定义注入模板">
          <AcuTextarea
            :model-value="exportConfig.injectionTemplate || ''"
            :rows="3"
            @update:model-value="value => config.updateExportConfig('injectionTemplate', value)"
          />
        </AcuFormRow>

        <PlacementEditor
          title="主条目位置"
          :placement="config.getPlacement('entryPlacement')"
          :options="config.placementOptions"
          :update-field="(field, value) => config.updatePlacement('entryPlacement', field, value)"
        />

        <div class="acu-viz-config__subsection">
          <AcuCheckbox
            :model-value="exportConfig.extraIndexEnabled === true"
            label="额外增加索引条目"
            @update:model-value="value => config.updateExportConfig('extraIndexEnabled', value)"
          />
          <template v-if="exportConfig.extraIndexEnabled">
            <div class="acu-viz-config__grid">
              <AcuFormRow label="索引条目名称">
                <AcuInput
                  :model-value="exportConfig.extraIndexEntryName || ''"
                  @update:model-value="value => config.updateExportConfig('extraIndexEntryName', value)"
                />
              </AcuFormRow>
            </div>
            <AcuFormRow label="索引条目模板">
              <AcuTextarea
                :model-value="exportConfig.extraIndexInjectionTemplate || ''"
                :rows="3"
                @update:model-value="value => config.updateExportConfig('extraIndexInjectionTemplate', value)"
              />
            </AcuFormRow>
            <div class="acu-viz-config__column-modes">
              <article
                v-for="column in config.visibleColumnEntries.value"
                :key="`extra-index-column-${column.columnIndex}`"
                class="acu-viz-config__column-mode"
              >
                <AcuCheckbox
                  :model-value="extraIndexColumns.includes(column.header)"
                  :label="column.header"
                  @update:model-value="value => config.setExtraIndexColumn(column.header, value)"
                />
                <AcuSelect
                  size="sm"
                  :disabled="!extraIndexColumns.includes(column.header)"
                  :model-value="extraIndexColumnModes[column.header] === 'index_only' ? 'index_only' : 'both'"
                  :options="config.extraIndexModeOptions"
                  @update:model-value="value => config.setExtraIndexColumnMode(column.header, value === 'index_only' ? 'index_only' : 'both')"
                />
              </article>
            </div>
            <PlacementEditor
              title="索引条目位置"
              :placement="config.getPlacement('extraIndexPlacement')"
              :options="config.placementOptions"
              :update-field="(field, value) => config.updatePlacement('extraIndexPlacement', field, value)"
            />
          </template>
        </div>
      </template>
    </AcuPanel>

    <AcuPanel
      v-if="config.fixedConfigEnabled.value"
      title="固定条目注入配置"
      description="控制总结表、总体大纲、重要人物表等固定条目的位置。重复或顺序不对时检查这里。"
    >
      <PlacementEditor
        title="固定主条目位置"
        :placement="config.getPlacement('fixedEntryPlacement')"
        :options="config.placementOptions"
        :update-field="(field, value) => config.updatePlacement('fixedEntryPlacement', field, value)"
      />
      <PlacementEditor
        v-if="config.importantPersonsFixedIndexEnabled.value"
        title="固定索引条目位置"
        :placement="config.getPlacement('fixedIndexPlacement')"
        :options="config.placementOptions"
        :update-field="(field, value) => config.updatePlacement('fixedIndexPlacement', field, value)"
      />
    </AcuPanel>

    <AcuPanel
      v-if="config.specialIndex.value.enabled"
      title="编码索引自动编号"
      description="控制总结表、总体大纲里的 AM0001 类编码。开启后自动重排，关闭后需手动保证不重不乱。"
    >
      <div class="acu-viz-config__toggles">
        <AcuCheckbox
          :model-value="config.specialIndex.value.locked"
          label="保存和 AI 更新时自动重排编码"
          @update:model-value="config.setSpecialIndexLock"
        />
        <AcuBadge :variant="config.specialIndex.value.index >= 0 ? 'neutral' : 'warning'">
          {{ specialIndexLabel }}
        </AcuBadge>
      </div>
    </AcuPanel>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import AcuBadge from '../../components/_lib/AcuBadge.vue';
import AcuButton from '../../components/_lib/AcuButton.vue';
import AcuCheckbox from '../../components/_lib/AcuCheckbox.vue';
import AcuFormRow from '../../components/_lib/AcuFormRow.vue';
import AcuIconButton from '../../components/_lib/AcuIconButton.vue';
import AcuInput from '../../components/_lib/AcuInput.vue';
import AcuPanel from '../../components/_lib/AcuPanel.vue';
import AcuSelect from '../../components/_lib/AcuSelect.vue';
import AcuTextarea from '../../components/_lib/AcuTextarea.vue';
import { useVisualizerConfigEditing } from '../../composables/visualizer/useVisualizerConfigEditing';
import { parseDDLColumnNames } from '../../../shared/ddl-utils';
import PlacementEditor from './VisualizerPlacementEditor.vue';

defineEmits<{
  (e: 'request-add-column'): void;
  (e: 'request-delete-column', index: number): void;
}>();

const config = useVisualizerConfigEditing();
const ddlValidation = ref<{ valid: boolean; message: string } | null>(null);
const sqlInjectionTemplatePlaceholder = '留空则使用默认表格内容。支持 {[sql "SELECT ..."]} / {[db.表名.where(...).get(...)]}，会原样写入世界书并在发送前展开。';

const updateConfig = computed(() => {
  const raw = config.currentSheet.value?.updateConfig || {};
  return {
    contextDepth: Number.isFinite(raw.contextDepth) ? raw.contextDepth : -1,
    updateFrequency: Number.isFinite(raw.updateFrequency) ? raw.updateFrequency : -1,
    batchSize: Number.isFinite(raw.batchSize) ? raw.batchSize : -1,
    groupId: Number.isFinite(raw.groupId) ? raw.groupId : -1,
    skipFloors: Number.isFinite(raw.skipFloors) ? raw.skipFloors : -1,
    sendLatestRows: Number.isFinite(raw.sendLatestRows) ? raw.sendLatestRows : -1,
    sendRowsSqlTemplate: String(raw.sendRowsSqlTemplate || ''),
  };
});

const sourceData = computed(() => {
  const raw = config.currentSheet.value?.sourceData || {};
  return {
    note: String(raw.note || ''),
    initNode: String(raw.initNode || ''),
    insertNode: String(raw.insertNode || ''),
    updateNode: String(raw.updateNode || ''),
    deleteNode: String(raw.deleteNode || ''),
    ddl: String(raw.ddl || ''),
  };
});

const sendRowsSqlTemplatePlaceholder = computed(() => {
  const ddlColumns = parseDDLColumnNames(sourceData.value.ddl);
  const headers = ddlColumns.length > 0
    ? ddlColumns
    : (config.headers.value.length > 0 ? ['row_id', ...config.headers.value] : ['row_id']);
  const tableNameMatch = String(sourceData.value.ddl || '').match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)/i);
  const tableName = tableNameMatch?.[1] || 'your_table';
  return [
    `建议查询列：${headers.join(', ')}`,
    `展开格式示例：row_id: 1, ${headers.slice(1).map((header, index) => `${header}: 值${index + 1}`).join(', ')}`,
    '',
    '示例模板：',
    `{[sql "SELECT ${headers.join(', ')} FROM ${tableName} ORDER BY row_id ASC LIMIT 10"]}`,
  ].join('\n');
});

const exportConfig = computed(() => config.exportConfig.value || {});
const extraIndexColumns = computed<string[]>(() =>
  Array.isArray(exportConfig.value.extraIndexColumns) ? exportConfig.value.extraIndexColumns : [],
);
const extraIndexColumnModes = computed<Record<string, string>>(() =>
  exportConfig.value.extraIndexColumnModes && typeof exportConfig.value.extraIndexColumnModes === 'object'
    ? exportConfig.value.extraIndexColumnModes
    : {},
);

const specialIndexLabel = computed(() => {
  const info = config.specialIndex.value;
  if (info.index < 0) return '未识别编码索引列，将按默认方式处理';
  return `当前识别列：#${info.index + 1} ${info.header || '未命名列'}`;
});

function validateDDL(): void {
  ddlValidation.value = config.validateDDL();
}
</script>

<style scoped>
.acu-viz-config {
  min-width: 0;
  display: grid;
  gap: 12px;
}

.acu-viz-config__grid {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.acu-viz-config__grid--three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.acu-viz-config__columns,
.acu-viz-config__prompts,
.acu-viz-config__toggles,
.acu-viz-config__subsection,
.acu-viz-config__column-modes {
  min-width: 0;
  display: grid;
  gap: 10px;
}

.acu-viz-config__columns {
  margin-top: 12px;
}

.acu-viz-config__column-operation {
  display: flex;
  justify-content: flex-end;
  padding-top: 2px;
}

.acu-viz-config__column-row {
  min-width: 0;
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--acu-border);
  border-radius: var(--acu-radius-sm);
  background: var(--acu-bg-0);
}

.acu-viz-config__column-index {
  color: var(--acu-text-3);
  font-family: var(--acu-font-mono);
  font-size: var(--acu-font-size-body, 12px);
  text-align: right;
}

.acu-viz-config__empty {
  margin: 0;
  color: var(--acu-text-2);
  font-size: var(--acu-font-size-body-lg, 13px);
  line-height: 1.55;
}

.acu-viz-config__inline-actions,
.acu-viz-config__column-mode {
  min-width: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.acu-viz-config__inline-actions {
  margin-top: 10px;
}

.acu-viz-config__ddl {
  font-family: var(--acu-font-mono);
}

.acu-viz-config__column-mode {
  padding: 8px;
  border: 1px solid var(--acu-border);
  border-radius: var(--acu-radius-sm);
  background: var(--acu-bg-0);
}

.acu-viz-config__column-mode :deep(.acu-checkbox) {
  flex: 1 1 220px;
}

.acu-viz-config__column-mode :deep(.acu-select) {
  flex: 1 1 260px;
}

@media (max-width: 860px) {
  .acu-viz-config__grid,
  .acu-viz-config__grid--three {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 767px) {
  .acu-viz-config__column-operation {
    justify-content: stretch;
  }

  .acu-viz-config__column-operation :deep(.acu-btn) {
    width: 100%;
  }
}

@media (max-width: 520px) {
  .acu-viz-config__column-row {
    grid-template-columns: 34px minmax(0, 1fr) auto;
    padding: 7px;
  }
}
</style>
