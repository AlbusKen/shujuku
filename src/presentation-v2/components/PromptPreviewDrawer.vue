<template>
  <AcuDrawer :is-open="isOpen" :title="drawerTitle" width="860px" @close="emit('close')">
    <div class="acu-v2-prompt-preview-drawer">
      <AcuMessage v-if="error" kind="error">
        <div class="acu-v2-prompt-preview-drawer__error">
          <p class="acu-v2-prompt-preview-drawer__error-title">生成提示词预览失败</p>
          <p class="acu-v2-prompt-preview-drawer__error-message">{{ error.message }}</p>
          <p v-if="error.detail" class="acu-v2-prompt-preview-drawer__error-detail">{{ error.detail }}</p>
        </div>
      </AcuMessage>

      <div v-if="loading" class="acu-v2-prompt-preview-drawer__loading" role="status">
        <i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i>
        正在生成提示词预览…
      </div>

      <template v-else>
        <!-- 填表模式：管线切换 + meta + 分段 + 脱敏请求体 -->
        <div v-if="mode === 'table-fill'" class="acu-v2-prompt-preview-drawer__body">
          <div class="acu-v2-prompt-preview-drawer__scenario">
            <span class="acu-v2-prompt-preview-drawer__scenario-label">管线</span>
            <AcuSegmentedControl
              :options="scenarioOptions"
              :model-value="scenario"
              size="sm"
              aria-label="选择填表管线"
              @update:model-value="onScenarioChange"
            />
          </div>

          <dl v-if="tableFillPreview" class="acu-v2-prompt-preview-drawer__meta">
            <div class="acu-v2-prompt-preview-drawer__meta-item">
              <dt>管线</dt>
              <dd>{{ scenarioMetaLabel }}</dd>
            </div>
            <div class="acu-v2-prompt-preview-drawer__meta-item">
              <dt>存储模式</dt>
              <dd>{{ storageLabel }}</dd>
            </div>
            <div class="acu-v2-prompt-preview-drawer__meta-item">
              <dt>填表模式</dt>
              <dd>{{ tableFillPreview.meta.fillMode }}</dd>
            </div>
            <div class="acu-v2-prompt-preview-drawer__meta-item">
              <dt>更新方式</dt>
              <dd>{{ tableFillPreview.meta.updateMode }}</dd>
            </div>
            <div class="acu-v2-prompt-preview-drawer__meta-item">
              <dt>API 预设</dt>
              <dd>{{ tableFillPreview.meta.presetName }}</dd>
            </div>
            <div class="acu-v2-prompt-preview-drawer__meta-item">
              <dt>目标表</dt>
              <dd>{{ targetSheetLabel }}</dd>
            </div>
            <div class="acu-v2-prompt-preview-drawer__meta-item">
              <dt>合计 tokens</dt>
              <dd>{{ tableFillPreview.totalTokens }}</dd>
            </div>
          </dl>

          <div
            v-for="(segment, index) in tableFillPreview?.segments ?? []"
            :key="index"
            class="acu-v2-prompt-preview-drawer__segment"
          >
            <div class="acu-v2-prompt-preview-drawer__segment-header">
              <AcuBadge :variant="roleVariant(segment.role)">{{ segment.role }}</AcuBadge>
              <span class="acu-v2-prompt-preview-drawer__segment-tokens">{{ segment.tokens }} tokens</span>
            </div>
            <pre class="acu-v2-prompt-preview-drawer__segment-content">{{ segment.content }}</pre>
          </div>

          <AcuDisclosureGroup
            v-if="tableFillPreview"
            class="acu-v2-prompt-preview-drawer__request-body"
            label="请求体预览（已脱敏）"
            :expanded="requestBodyOpen"
            body-mode="if"
            @toggle="requestBodyOpen = !requestBodyOpen"
          >
            <pre class="acu-v2-prompt-preview-drawer__request-body-json">{{ requestBodyJson }}</pre>
          </AcuDisclosureGroup>

          <p
            v-if="!tableFillPreview && !error"
            class="acu-v2-prompt-preview-drawer__empty"
          >
            尚未生成填表提示词预览。
          </p>
        </div>

        <!-- 剧情模式：模拟输入 + 按任务分组 -->
        <div v-else class="acu-v2-prompt-preview-drawer__body">
          <div class="acu-v2-prompt-preview-drawer__plot-input">
            <AcuTextarea
              class="acu-v2-prompt-preview-drawer__plot-textarea"
              :model-value="plotVirtualInput"
              placeholder="模拟输入框文本，留空则 $7/$8 为空"
              :rows="3"
              @update:model-value="onPlotInput"
            />
            <AcuButton
              variant="primary"
              size="sm"
              class="acu-v2-prompt-preview-drawer__plot-generate"
              @click="emit('generate-plot')"
            >
              生成预览
            </AcuButton>
          </div>

          <AcuInfoBanner
            v-if="plotPreview?.truncatedToFirstStage"
            tone="warning"
            class="acu-v2-prompt-preview-drawer__truncated-note"
          >
            为避免真实请求，仅展示第一阶段任务的提示词，后续阶段未执行
          </AcuInfoBanner>

          <p v-if="!plotPreview && !error" class="acu-v2-prompt-preview-drawer__empty">
            输入模拟用户输入后点击「生成预览」，将按当前配置模拟剧情任务提示词（不会发起真实请求）。
          </p>

          <section
            v-for="task in plotPreview?.tasks ?? []"
            :key="task.taskId"
            class="acu-v2-prompt-preview-drawer__plot-task"
          >
            <header class="acu-v2-prompt-preview-drawer__plot-task-header">
              <span class="acu-v2-prompt-preview-drawer__plot-task-name">{{ task.taskName }}</span>
              <AcuBadge variant="accent">第 {{ task.stage }} 阶段</AcuBadge>
              <span class="acu-v2-prompt-preview-drawer__plot-task-preset">预设：{{ task.presetName }}</span>
              <span class="acu-v2-prompt-preview-drawer__plot-task-tokens">{{ task.totalTokens }} tokens</span>
            </header>
            <div
              v-for="(segment, index) in task.segments"
              :key="index"
              class="acu-v2-prompt-preview-drawer__segment"
            >
              <div class="acu-v2-prompt-preview-drawer__segment-header">
                <AcuBadge :variant="roleVariant(segment.role)">{{ segment.role }}</AcuBadge>
                <span class="acu-v2-prompt-preview-drawer__segment-tokens">{{ segment.tokens }} tokens</span>
              </div>
              <pre class="acu-v2-prompt-preview-drawer__segment-content">{{ segment.content }}</pre>
            </div>
          </section>
        </div>
      </template>

      <footer class="acu-v2-prompt-preview-drawer__actions">
        <AcuButton @click="emit('close')">关闭</AcuButton>
      </footer>
    </div>
  </AcuDrawer>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import AcuBadge, { type AcuBadgeVariant } from './_lib/AcuBadge.vue';
import AcuButton from './_lib/AcuButton.vue';
import AcuDisclosureGroup from './_lib/AcuDisclosureGroup.vue';
import AcuDrawer from './_lib/AcuDrawer.vue';
import AcuInfoBanner from './_lib/AcuInfoBanner.vue';
import AcuMessage from './_lib/AcuMessage.vue';
import AcuSegmentedControl, { type AcuSegmentedOption } from './_lib/AcuSegmentedControl.vue';
import AcuTextarea from './_lib/AcuTextarea.vue';
import type { PromptPreviewErrorView, PromptPreviewMode } from '../composables/usePromptPreview';
import type {
  TableFillPromptPreview_ACU,
  TableFillPreviewScenario_ACU,
} from '../../service/preview/table-fill-prompt-preview';
import type { PlotPromptPreview_ACU } from '../../service/preview/plot-prompt-preview';

const props = withDefaults(defineProps<{
  isOpen: boolean;
  mode: PromptPreviewMode;
  loading?: boolean;
  error?: PromptPreviewErrorView | null;
  scenario?: TableFillPreviewScenario_ACU;
  tableFillPreview?: TableFillPromptPreview_ACU | null;
  plotVirtualInput?: string;
  plotPreview?: PlotPromptPreview_ACU | null;
}>(), {
  loading: false,
  error: null,
  scenario: 'auto',
  tableFillPreview: null,
  plotVirtualInput: '',
  plotPreview: null,
});

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'update:scenario', value: TableFillPreviewScenario_ACU): void;
  (e: 'update:plotVirtualInput', value: string): void;
  (e: 'generate-plot'): void;
}>();

/** 管线三档标签（与 lead 指定的文案一致） */
const SCENARIO_LABELS: Record<TableFillPreviewScenario_ACU, string> = {
  auto: '自动填表',
  manual_refill: '手动重填',
  catch_up: '一键追平',
};

const STORAGE_LABELS: Record<'json' | 'sqlite', string> = {
  json: 'JSON 原生',
  sqlite: 'SQLite',
};

const scenarioOptions: AcuSegmentedOption[] = [
  { value: 'auto', label: SCENARIO_LABELS.auto },
  { value: 'manual_refill', label: SCENARIO_LABELS.manual_refill },
  { value: 'catch_up', label: SCENARIO_LABELS.catch_up },
];

const drawerTitle = computed(() =>
  props.mode === 'table-fill' ? '预览填表提示词' : '预览剧情提示词',
);
const requestBodyOpen = ref(false);

const scenarioMetaLabel = computed(
  () => SCENARIO_LABELS[props.tableFillPreview?.meta.scenario ?? props.scenario],
);
const storageLabel = computed(() => STORAGE_LABELS[props.tableFillPreview?.meta.storageMode ?? 'json']);
const targetSheetLabel = computed(() => {
  const keys = props.tableFillPreview?.meta.targetSheetKeys;
  return keys && keys.length > 0 ? keys.join('、') : '未限定';
});
const requestBodyJson = computed(() =>
  props.tableFillPreview ? JSON.stringify(props.tableFillPreview.requestBody, null, 2) : '',
);

function roleVariant(role: string): AcuBadgeVariant {
  if (role === 'user') return 'accent';
  if (role === 'assistant') return 'success';
  return 'neutral';
}

function onScenarioChange(value: string): void {
  emit('update:scenario', value as TableFillPreviewScenario_ACU);
}

function onPlotInput(value: string): void {
  emit('update:plotVirtualInput', value);
}
</script>

<style scoped>
.acu-v2-prompt-preview-drawer__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.acu-v2-prompt-preview-drawer__scenario {
  display: flex;
  align-items: center;
  gap: 8px;
}

.acu-v2-prompt-preview-drawer__scenario-label {
  font-size: var(--acu-font-size-caption, 11px);
  color: var(--acu-text-3);
}

.acu-v2-prompt-preview-drawer__meta {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 6px 16px;
  padding: 10px 12px;
  border-radius: var(--acu-radius-sm);
  background: color-mix(in srgb, var(--acu-text-3) 8%, transparent);
}

.acu-v2-prompt-preview-drawer__meta-item dt {
  font-size: var(--acu-font-size-caption, 11px);
  color: var(--acu-text-3);
}

.acu-v2-prompt-preview-drawer__meta-item dd {
  margin: 0;
  font-size: var(--acu-font-size-body, 12px);
  color: var(--acu-text-1);
  word-break: break-word;
}

.acu-v2-prompt-preview-drawer__segment {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.acu-v2-prompt-preview-drawer__segment-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.acu-v2-prompt-preview-drawer__segment-tokens {
  font-size: var(--acu-font-size-caption, 11px);
  color: var(--acu-text-3);
}

.acu-v2-prompt-preview-drawer__segment-content,
.acu-v2-prompt-preview-drawer__request-body-json {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--acu-radius-sm);
  background: var(--acu-bg-2);
  color: var(--acu-text-1);
  font-family: ui-monospace, SFMono-Regular, Consolas, 'Courier New', monospace;
  font-size: var(--acu-font-size-caption, 11px);
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  max-height: 320px;
  overflow-y: auto;
}

.acu-v2-prompt-preview-drawer__plot-input {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.acu-v2-prompt-preview-drawer__plot-generate {
  align-self: flex-start;
}

.acu-v2-prompt-preview-drawer__plot-task {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--acu-radius-sm);
  background: color-mix(in srgb, var(--acu-text-3) 6%, transparent);
}

.acu-v2-prompt-preview-drawer__plot-task-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.acu-v2-prompt-preview-drawer__plot-task-name {
  font-weight: 600;
  color: var(--acu-text-1);
}

.acu-v2-prompt-preview-drawer__plot-task-preset,
.acu-v2-prompt-preview-drawer__plot-task-tokens {
  font-size: var(--acu-font-size-caption, 11px);
  color: var(--acu-text-3);
}

.acu-v2-prompt-preview-drawer__loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 0;
  color: var(--acu-text-2);
}

.acu-v2-prompt-preview-drawer__empty {
  margin: 0;
  color: var(--acu-text-2);
  line-height: 1.55;
}

.acu-v2-prompt-preview-drawer__error-title {
  margin: 0;
  font-weight: 600;
}

.acu-v2-prompt-preview-drawer__error-message,
.acu-v2-prompt-preview-drawer__error-detail {
  margin: 4px 0 0;
  word-break: break-word;
}

.acu-v2-prompt-preview-drawer__error-detail {
  color: var(--acu-text-3);
}

.acu-v2-prompt-preview-drawer__actions {
  position: sticky;
  bottom: -16px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 0 0;
  margin-top: 12px;
  background: var(--acu-bg-1);
}
</style>
