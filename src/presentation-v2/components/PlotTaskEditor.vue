<template>
  <div v-if="task" class="acu-v2-plot-task-editor">
    <fieldset class="acu-v2-plot-task-editor__section">
      <legend>基本字段</legend>
      <div class="acu-v2-plot-task-editor__grid">
        <AcuFormRow label="任务名称">
          <AcuInput
            type="text"
            :model-value="task.name"
            placeholder="例如：记忆召回任务"
            @change="patch({ name: String($event) })"
          />
        </AcuFormRow>
        <AcuFormRow label="阶段号" hint="阶段号相同的同时跑，阶段号小的跑完再跑大的。">
          <AcuInput
            type="number"
            :min="1"
            :step="1"
            :model-value="task.stage"
            @change="patch({ stage: Math.max(1, Math.round(Number($event))) })"
          />
        </AcuFormRow>
        <AcuFormRow label="最大重试">
          <AcuInput
            type="number"
            :min="1"
            :step="1"
            :model-value="task.maxRetries"
            @change="
              patch({ maxRetries: Math.max(1, Math.round(Number($event))) })
            "
          />
        </AcuFormRow>
        <AcuFormRow label="启用任务">
          <AcuToggle
            :model-value="task.enabled"
            :label="task.enabled ? '已启用' : '已禁用'"
            @update:model-value="patch({ enabled: $event })"
          />
        </AcuFormRow>
      </div>
      <div class="acu-v2-plot-task-editor__grid">
        <AcuFormRow
          label="标签摘取"
          hint="例如 recall,supplement，仅对当前任务生效。"
        >
          <AcuInput
            type="text"
            :model-value="task.extractTags"
            @change="patch({ extractTags: String($event) })"
          />
        </AcuFormRow>
        <AcuFormRow label="提取写入标签" hint="优先级高于标签提取，留空不追加。">
          <AcuInput
            type="text"
            :model-value="task.extractInjectTags"
            @change="patch({ extractInjectTags: String($event) })"
          />
        </AcuFormRow>
        <AcuFormRow label="最小回复长度" hint="回复少于此字符长度时自动重试。">
          <AcuInput
            type="number"
            :min="0"
            :step="10"
            :model-value="task.minLength"
            @change="
              patch({ minLength: Math.max(0, Math.round(Number($event))) })
            "
          />
        </AcuFormRow>
      </div>
    </fieldset>

    <fieldset class="acu-v2-plot-task-editor__section">
      <legend>Agent 任务控制</legend>
      <p class="acu-v2-plot-task-editor__hint">
        下面填写的描述和触发条件，供 Agent 判断要不要跑这个任务、按什么顺序跑。留空则按原阶段号和顺序执行。
      </p>
      <div class="acu-v2-plot-task-editor__grid acu-v2-plot-task-editor__grid--wide">
        <AcuFormRow
          label="任务描述"
          hint="写明这个任务负责什么；留空时 Agent 不会自动选用它。"
        >
          <AcuTextarea
            :model-value="task.description"
            :rows="2"
            :max-rows="6"
            auto-resize
            placeholder="例如：从长期记忆中选择与当前剧情最相关的事件。"
            @update:model-value="patch({ description: $event })"
          />
        </AcuFormRow>
        <AcuFormRow
          label="触发条件"
          hint="写明什么情况下触发这个任务；留空则按原规则。"
        >
          <AcuTextarea
            :model-value="task.triggerWhen"
            :rows="2"
            :max-rows="6"
            auto-resize
            placeholder="例如：用户输入涉及旧事件、承诺、人物关系变化或未解决伏笔时触发。"
            @update:model-value="patch({ triggerWhen: $event })"
          />
        </AcuFormRow>
      </div>

      <div class="acu-v2-plot-task-editor__toggles">
        <AcuToggle
          :model-value="task.agentControl.enabled"
          :label="task.agentControl.enabled ? 'Agent 可控制此任务' : 'Agent 不控制此任务'"
          @update:model-value="patchAgentControl({ enabled: $event })"
        />
        <AcuToggle
          :model-value="task.agentControl.selectable"
          label="允许 Agent 选择/跳过"
          @update:model-value="patchAgentControl({ selectable: $event })"
        />
        <AcuToggle
          :model-value="task.agentControl.defaultSelected"
          label="Agent 无决策时默认选中"
          @update:model-value="patchAgentControl({ defaultSelected: $event })"
        />
        <AcuToggle
          :model-value="task.agentControl.allowSequential"
          label="允许串联"
          @update:model-value="patchAgentControl({ allowSequential: $event })"
        />
        <AcuToggle
          :model-value="task.agentControl.allowParallel"
          label="允许并行"
          @update:model-value="patchAgentControl({ allowParallel: $event })"
        />
      </div>

      <div class="acu-v2-plot-task-editor__grid">
        <AcuFormRow label="偏好阶段" hint="供 Agent 排顺序参考，留空不指定。">
          <AcuInput
            type="number"
            :min="1"
            :step="1"
            :model-value="task.agentControl.preferredStage ?? ''"
            @change="patchAgentControl({ preferredStage: parseOptionalPositiveInteger($event) })"
          />
        </AcuFormRow>
        <AcuFormRow label="偏好顺序" hint="同阶段内的先后顺序参考，留空不指定。">
          <AcuInput
            type="number"
            :min="0"
            :step="1"
            :model-value="task.agentControl.preferredOrder ?? ''"
            @change="patchAgentControl({ preferredOrder: parseOptionalNonNegativeInteger($event) })"
          />
        </AcuFormRow>
      </div>

      <div class="acu-v2-plot-task-editor__grid acu-v2-plot-task-editor__grid--wide">
        <AcuFormRow
          label="依赖任务 ID"
          hint="逗号分隔，填写必须排在当前任务之前执行的任务名。"
        >
          <AcuInput
            type="text"
            :model-value="formatTaskIdList(task.agentControl.dependsOnTaskIds)"
            placeholder="例如：recallTask, summaryTask"
            @change="patchAgentControl({ dependsOnTaskIds: parseTaskIdList($event) })"
          />
        </AcuFormRow>
        <AcuFormRow
          label="阻塞任务 ID"
          hint="逗号分隔，填写不应与当前任务同时执行的任务名。"
        >
          <AcuInput
            type="text"
            :model-value="formatTaskIdList(task.agentControl.blocksTaskIds)"
            placeholder="例如：legacyRecallTask"
            @change="patchAgentControl({ blocksTaskIds: parseTaskIdList($event) })"
          />
        </AcuFormRow>
      </div>
    </fieldset>

    <fieldset class="acu-v2-plot-task-editor__section">
      <legend>当前任务使用的 API</legend>
      <AcuFormRow
        label="API 预设"
        hint="单独给当前任务选 API 预设，不选则跟随剧情推进页。仅本地保存，不随预设导出。"
      >
        <AcuSelect
          :options="taskApiSelectOptions"
          :model-value="taskApiOverride"
          placeholder="继承剧情推进 API 预设"
          @update:model-value="$emit('task-api-override', $event)"
        />
      </AcuFormRow>
    </fieldset>

    <fieldset class="acu-v2-plot-task-editor__section">
      <legend>提示词段（promptGroup）</legend>
      <PlotPromptSegments
        :segments="task.promptGroup"
        @add="$emit('segment-add', $event)"
        @delete="$emit('segment-delete', $event)"
        @move="(index, delta) => $emit('segment-move', index, delta)"
        @update="(index, patch) => $emit('segment-update', index, patch)"
      />
    </fieldset>
  </div>
  <div v-else class="acu-v2-plot-task-editor__empty">
    请在上方选择一个任务进行编辑。
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type {
  PlotTaskAgentControlDraft,
  PlotPromptSegment,
  PlotTaskDraft,
} from "../composables/usePlotTaskEditing";
import AcuFormRow from "./_lib/AcuFormRow.vue";
import AcuInput from "./_lib/AcuInput.vue";
import type { AcuSelectOption } from "./_lib/AcuSelect.vue";
import AcuSelect from "./_lib/AcuSelect.vue";
import AcuTextarea from "./_lib/AcuTextarea.vue";
import AcuToggle from "./_lib/AcuToggle.vue";
import PlotPromptSegments from "./PlotPromptSegments.vue";

const props = defineProps<{
  task: PlotTaskDraft | null;
  apiPresetOptions: Array<{ name: string }>;
  taskApiOverride: string;
}>();

const emit = defineEmits<{
  (e: "patch", patch: Partial<PlotTaskDraft>): void;
  (e: "task-api-override", value: string): void;
  (e: "segment-add", position: "top" | "bottom"): void;
  (e: "segment-delete", index: number): void;
  (e: "segment-move", index: number, delta: -1 | 1): void;
  (e: "segment-update", index: number, patch: Partial<PlotPromptSegment>): void;
}>();

const taskApiSelectOptions = computed<AcuSelectOption[]>(() => [
  { value: "", label: "继承剧情推进 API 预设" },
  ...props.apiPresetOptions.map((o) => ({ value: o.name, label: o.name })),
]);

function patch(value: Partial<PlotTaskDraft>): void {
  emit("patch", value);
}

function patchAgentControl(patchValue: Partial<PlotTaskAgentControlDraft>): void {
  if (!props.task) return;
  patch({
    agentControl: {
      ...props.task.agentControl,
      ...patchValue,
    },
  });
}

function parseTaskIdList(value: unknown): string[] {
  return String(value ?? "")
    .split(/[，,\n]/g)
    .map(item => item.trim())
    .filter((item, index, array) => item && array.indexOf(item) === index);
}

function formatTaskIdList(value: string[] | undefined): string {
  return Array.isArray(value) ? value.join(", ") : "";
}

function parseOptionalPositiveInteger(value: unknown): number | undefined {
  if (value === "" || value === null || value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  const normalized = Math.trunc(n);
  return normalized > 0 ? normalized : undefined;
}

function parseOptionalNonNegativeInteger(value: unknown): number | undefined {
  if (value === "" || value === null || value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  const normalized = Math.trunc(n);
  return normalized >= 0 ? normalized : undefined;
}
</script>

<style scoped>
.acu-v2-plot-task-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.acu-v2-plot-task-editor__section {
  margin: 0;
  padding: 0 0 14px;
  border: 0;
  border-bottom: 1px solid
    color-mix(in srgb, var(--acu-text-3) 16%, transparent);
  border-radius: 0;
  background: transparent;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.acu-v2-plot-task-editor__section:last-of-type {
  padding-bottom: 0;
  border-bottom: 0;
}
.acu-v2-plot-task-editor__section legend {
  padding: 0;
  font-size: var(--acu-font-size-section-title, 12px);
  font-weight: 600;
  color: var(--acu-text-2);
}

.acu-v2-plot-task-editor__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

.acu-v2-plot-task-editor__grid--wide {
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
}

.acu-v2-plot-task-editor__toggles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr));
  gap: 8px 12px;
  padding: 8px 0;
  min-width: 0;
}

.acu-v2-plot-task-editor__toggles :deep(.acu-toggle) {
  align-items: flex-start;
  width: 100%;
  min-width: 0;
  min-height: var(--acu-control-height-sm, 26px);
}

.acu-v2-plot-task-editor__toggles :deep(.acu-toggle__label) {
  min-width: 0;
  white-space: normal;
  line-height: var(--acu-line-height-body, 1.45);
  overflow-wrap: anywhere;
}

.acu-v2-plot-task-editor__hint {
  margin: 0;
  font-size: var(--acu-font-size-caption, 11px);
  color: var(--acu-text-3);
  line-height: var(--acu-line-height-caption, 1.5);
}

.acu-v2-plot-task-editor__empty {
  padding: 18px 0;
  border: 0;
  border-top: 1px solid color-mix(in srgb, var(--acu-text-3) 14%, transparent);
  border-bottom: 1px solid
    color-mix(in srgb, var(--acu-text-3) 14%, transparent);
  border-radius: 0;
  background: transparent;
  text-align: center;
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-body, 12px);
}
</style>
