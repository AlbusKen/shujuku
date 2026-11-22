<template>
  <div class="acu-v2-vector-index-page">
    <AcuPanelGrid class="acu-v2-vector-index-page__main-grid">
      <div class="acu-v2-vector-index-page__panel-stack">
        <AcuPanel
          id="vector-index-status-panel"
          :title="vectorIndexCopy.panels.status.title"
          :description="vectorIndexCopy.panels.status.description"
        >
          <template #actions>
            <AcuBadge :variant="vector.statusVariant.value">{{
              vector.statusLabel.value
            }}</AcuBadge>
          </template>

          <AcuStatsList :items="vector.statusStatsItems.value" />

          <p class="acu-v2-vector-index-page__hint">
            {{ isCrossfire ? CROSSFIRE_FLOW_HINT : VECTOR_FLOW_HINT }}
          </p>

          <div
            class="acu-v2-vector-index-page__maintenance-spacer"
            aria-hidden="true"
          ></div>

          <div class="acu-v2-vector-index-page__actions">
            <AcuButton
              variant="primary"
              :disabled="vector.buildBusy.value || vector.maintenanceBusy.value"
              @click="vector.buildNow"
            >
              <i class="fa-solid fa-brain"></i>
              {{
                vector.buildBusy.value ? "正在重建..." : "立即构建交火纪要索引"
              }}
            </AcuButton>
            <p class="acu-v2-vector-index-page__hint">
              检测到旧向量方案时会提示「向量方案已优化，需要重建」。链冲突与 checkpoint 指纹不匹配会自动修复，不弹确认。
            </p>
            <AcuButton v-if="SHOW_LEGACY_VECTOR_MAINTENANCE_UI"
              :disabled="vector.maintenanceBusy.value || vector.buildBusy.value"
              @click="vector.migrateLegacyIndex"
            >
              非破坏迁移旧索引
            </AcuButton>
            <AcuButton
              :disabled="vector.maintenanceBusy.value || vector.buildBusy.value"
              @click="vector.clearIndexCache"
            >
              清空临时缓存
            </AcuButton>
            <AcuButton
              variant="danger"
              :disabled="vector.maintenanceBusy.value || vector.buildBusy.value"
              @click="onDeleteCurrentIndex"
            >
              删除当前索引
            </AcuButton>
          </div>
        </AcuPanel>

        <AcuPanel
          v-if="isCrossfire"
          id="vector-index-keyword-panel"
          :title="vectorIndexCopy.panels.keyword.title"
          :description="vectorIndexCopy.panels.keyword.description"
        >
          <AcuFormRow
            label="AI 补充关键词"
            hint="开启时每次发送前多调用一次 AI 生成关键词；关闭后直接用你的输入召回记忆，更省时间。"
          >
            <AcuToggle
              :model-value="vector.form.keywordGenerationEnabled"
              label="发送前用 AI 补充检索关键词"
              @update:model-value="
                vector.setBooleanField('keywordGenerationEnabled', $event)
              "
            />
          </AcuFormRow>
          <AcuFormRow
            label="关键词 API 预设"
            hint="默认使用当前 API，单独选择后仅用于生成关键词。"
          >
            <AcuSelect
              :options="keywordApiOptions"
              :model-value="vector.form.keywordApiPreset"
              :placeholder="followActiveApiLabel"
              @update:model-value="
                vector.setApiField('keywordApiPreset', $event)
              "
            />
          </AcuFormRow>
          <div class="acu-v2-vector-index-page__number-grid">
            <AcuFormRow
              label="上下文读取层数"
              hint="生成关键词时往前看几轮对话（1 轮 = 1 条用户输入 + 1 条 AI 回复）。"
            >
              <AcuInput
                :model-value="vector.form.keywordContextPairCount"
                type="number"
                :min="1"
                :step="1"
                @change="
                  vector.setNumberField('keywordContextPairCount', $event)
                "
              />
            </AcuFormRow>
            <AcuFormRow
              label="最大尝试次数"
              hint="生成关键词失败时，自动改用你的原话召回记忆，不影响发送。"
            >
              <AcuInput
                :model-value="vector.form.keywordGenerationMaxAttempts"
                type="number"
                :min="1"
                :step="1"
                @change="
                  vector.setNumberField('keywordGenerationMaxAttempts', $event)
                "
              />
            </AcuFormRow>
          </div>
        </AcuPanel>
      </div>

      <div class="acu-v2-vector-index-page__panel-stack">
        <AcuPanel
          id="vector-index-api-panel"
          :title="vectorIndexCopy.panels.api.title"
          :description="vectorIndexCopy.panels.api.description"
        >
          <form
            class="acu-v2-vector-api-form"
            @submit.prevent="saveVectorApiConfig"
          >
            <fieldset class="acu-v2-vector-api-form__section">
              <legend>Embedding</legend>
              <AcuFormRow label="URL">
                <AcuInput
                  v-model="vectorApiConfig.form.embeddingEndpoint"
                  type="text"
                  placeholder="https://example.com/embeddings"
                />
              </AcuFormRow>
              <AcuFormRow label="模型名">
                <AcuInput
                  v-model="vectorApiConfig.form.embeddingModel"
                  type="text"
                  placeholder="text-embedding-3-large"
                />
              </AcuFormRow>
              <AcuFormRow label="API 密钥">
                <AcuInput
                  v-model="vectorApiConfig.form.embeddingApiKey"
                  type="password"
                  autocomplete="off"
                />
              </AcuFormRow>
            </fieldset>

            <fieldset class="acu-v2-vector-api-form__section">
              <legend>Rerank</legend>
              <AcuFormRow label="URL">
                <AcuInput
                  v-model="vectorApiConfig.form.rerankEndpoint"
                  type="text"
                  placeholder="https://example.com/rerank"
                />
              </AcuFormRow>
              <AcuFormRow label="模型名">
                <AcuInput
                  v-model="vectorApiConfig.form.rerankModel"
                  type="text"
                  placeholder="bge-reranker-v2-m3"
                />
              </AcuFormRow>
              <AcuFormRow label="API 密钥">
                <AcuInput
                  v-model="vectorApiConfig.form.rerankApiKey"
                  type="password"
                  autocomplete="off"
                />
              </AcuFormRow>
              <AcuFormRow
                label="重排指令"
                hint="默认启用。如果 Rerank 服务商不支持附加指令而报错，清空即可。"
              >
                <textarea
                  v-model="vectorApiConfig.form.rerankInstruction"
                  class="acu-v2-vector-api-form__instruction-textarea"
                  rows="3"
                  placeholder="留空则不发送 instruction"
                ></textarea>
              </AcuFormRow>
              <AcuFormRow
                label="每批条数"
                :hint="`候选超过这个数时分批发送给 Rerank 再合并结果，服务商单次通常限 500 条以内，范围 ${RERANK_BATCH_SIZE_LIMITS.min}–${RERANK_BATCH_SIZE_LIMITS.max}，默认 ${RERANK_BATCH_SIZE_LIMITS.default}。`"
              >
                <AcuInput
                  :model-value="vectorApiConfig.form.rerankBatchSize"
                  type="number"
                  :min="RERANK_BATCH_SIZE_LIMITS.min"
                  :max="RERANK_BATCH_SIZE_LIMITS.max"
                  :step="10"
                  @change="onRerankBatchSizeChange($event)"
                />
              </AcuFormRow>
            </fieldset>

            <AcuMessage v-if="vectorApiConfig.errors.value.length" kind="error">
              <p v-for="error in vectorApiConfig.errors.value" :key="error">
                {{ error }}
              </p>
            </AcuMessage>
            <div class="acu-v2-vector-api-form__actions">
              <AcuButton variant="primary" native-type="submit">保存</AcuButton>
            </div>
          </form>
        </AcuPanel>

        <AcuPanel
          v-if="isCrossfire"
          id="vector-index-prompt-panel"
          :title="vectorIndexCopy.panels.prompt.title"
          :description="vectorIndexCopy.panels.prompt.description"
        >
          <template #actions>
            <AcuBadge :variant="promptTemplateBadgeVariant">{{
              promptTemplateBadgeLabel
            }}</AcuBadge>
          </template>

          <AcuMessage v-if="keywordPromptEmpty" kind="warning">
            关键词生成提示词为空，发送前会直接用用户输入参与召回；建议载入默认提示词后保存。
          </AcuMessage>

          <div class="acu-v2-vector-index-page__prompt-actions">
            <AcuButton variant="primary" @click="promptDrawerOpen = true"
              >编辑提示词</AcuButton
            >
          </div>
        </AcuPanel>
      </div>
    </AcuPanelGrid>

    <AcuPanelGrid
      class="acu-v2-vector-index-page__advanced-grid"
    >
      <AcuPanel
        v-if="isCrossfire"
        id="vector-index-recall-panel"
        :title="vectorIndexCopy.panels.recall.title"
        :description="vectorIndexCopy.panels.recall.description"
      >
        <div class="acu-v2-vector-index-page__number-grid">
          <AcuFormRow
            label="混合召回"
            hint="开启后会把关键词匹配和向量搜索结果合并筛选；关闭则只用向量搜索。"
          >
            <AcuToggle
              :model-value="vector.form.hybridRetrievalEnabled"
              label="启用 BM25 混合召回"
              @update:model-value="vector.setBooleanField('hybridRetrievalEnabled', $event)"
            />
          </AcuFormRow>
          <AcuFormRow
            label="触发阈值"
            hint="纪要条数达到此值后才开启搜索筛选，未达到则按原方式全量处理。"
          >
            <AcuInput
              :model-value="vector.form.summaryIndexKeywordMinRows"
              type="number"
              :min="1"
              :step="1"
              @change="
                vector.setNumberField('summaryIndexKeywordMinRows', $event)
              "
            />
          </AcuFormRow>
          <AcuFormRow
            label="TopK"
            hint="每次最多召回多少条相关纪要（不含最近固定条数）。候选不多于此数时跳过 Rerank，按原顺序写入。"
          >
            <AcuInput
              :model-value="vector.form.topK"
              type="number"
              :min="1"
              :step="1"
              @change="vector.setNumberField('topK', $event)"
            />
          </AcuFormRow>
          <AcuFormRow
            label="预筛最低分"
            hint="相关度最低门槛，低于此分不进入候选，默认 0.35。"
          >
            <AcuInput
              :model-value="vector.form.minScore"
              type="number"
              :min="0"
              :max="1"
              :step="0.01"
              @change="vector.setMinScore($event)"
            />
          </AcuFormRow>
          <AcuFormRow
            label="候选上限"
            hint="初筛保留的候选上限，不能小于最终召回条数。"
          >
            <AcuInput
              :model-value="vector.form.recallCandidateLimit"
              type="number"
              :min="1"
              :step="1"
              @change="vector.setNumberField('recallCandidateLimit', $event)"
            />
          </AcuFormRow>
          <AcuFormRow
            label="固定写入"
            hint="最近 N 条纪要固定保留，不参与筛选淘汰。"
          >
            <AcuInput
              :model-value="vector.form.recentFixedInjectCount"
              type="number"
              :min="1"
              :step="1"
              @update:model-value="vector.previewRecentFixedInjectCount($event)"
              @change="vector.setNumberField('recentFixedInjectCount', $event)"
            />
          </AcuFormRow>
          <AcuFormRow
            label="命名空间"
            hint="用来区分不同聊天的索引前缀，一般保持默认即可。"
          >
            <AcuInput
              :model-value="vector.form.vectorNamespace"
              type="text"
              placeholder="chat"
              @change="vector.setApiField('vectorNamespace', $event)"
            />
          </AcuFormRow>
        </div>
      </AcuPanel>

      <AcuPanel
        id="vector-index-archive-panel"
        :title="vectorIndexCopy.panels.archive.title"
        :description="vectorIndexCopy.panels.archive.description"
      >
        <div class="acu-v2-vector-index-page__number-grid">
          <AcuFormRow
            label="按句切分纪要正文"
            hint="默认关闭，每条纪要整体归档，省空间。开启后按下方句数拆分正文，找得更细但索引体积翻倍；改动后需重建索引。"
          >
            <AcuToggle
              :model-value="vector.form.summaryIndexChunkChronicleBySentence"
              label="切分纪要正文为多个分片"
              @update:model-value="
                vector.setBooleanField('summaryIndexChunkChronicleBySentence', $event)
              "
            />
          </AcuFormRow>
          <AcuFormRow
            label="分块句数"
            hint="开启按句切分后生效，设置几句拆成一段，越小越细。"
          >
            <AcuInput
              :model-value="vector.form.summaryChunkSentenceCount"
              type="number"
              :min="1"
              :step="1"
              :disabled="!vector.form.summaryIndexChunkChronicleBySentence"
              @change="
                vector.setNumberField('summaryChunkSentenceCount', $event)
              "
            />
          </AcuFormRow>
          <AcuFormRow label="单请求最多行数" hint="单次 Embedding 请求最多处理几条纪要，避免一次发太大。">
            <AcuInput
              :model-value="vector.form.summaryIndexArchiveMaxConcurrency"
              type="number"
              :min="1"
              :step="1"
              @change="
                vector.setNumberField(
                  'summaryIndexArchiveMaxConcurrency',
                  $event,
                )
              "
            />
          </AcuFormRow>
          <AcuFormRow label="单请求字符预算" hint="单次 Embedding 请求的字数上限，单条超长时会单独发送。">
            <AcuInput
              :model-value="vector.form.summaryIndexArchiveMaxInputChars"
              type="number"
              :min="1"
              :step="1"
              @change="vector.setNumberField('summaryIndexArchiveMaxInputChars', $event)"
            />
          </AcuFormRow>
          <AcuFormRow label="同时请求数" hint="最多同时发起几个 Embedding 请求；设为 1 逐条发送，最稳妥。">
            <AcuInput
              :model-value="vector.form.summaryIndexArchiveEmbeddingConcurrency"
              type="number"
              :min="1"
              :step="1"
              @change="vector.setNumberField('summaryIndexArchiveEmbeddingConcurrency', $event)"
            />
          </AcuFormRow>
          <AcuFormRow v-if="SHOW_LEGACY_VECTOR_MAINTENANCE_UI"
            label="滚动增量"
            hint="此旧开关当前已暂停，开了也不生效，系统会自动用新方式安全存档。"
          >
            <AcuToggle
              :model-value="vector.form.summaryIndexRollingDeltaEnabled"
              label="滚动增量写入暂不可用"
              :disabled="true"
            />
          </AcuFormRow>
          <AcuFormRow v-if="SHOW_LEGACY_VECTOR_MAINTENANCE_UI"
            label="折叠阈值 K"
            hint="仅用于兼容旧配置，目前不生效。"
          >
            <AcuInput
              :model-value="vector.form.summaryIndexRollingDeltaFoldThreshold || 15"
              type="number"
              :min="1"
              :step="1"
              disabled
            />
          </AcuFormRow>
        </div>
        <AcuFormRow
          v-if="SHOW_LEGACY_VECTOR_MAINTENANCE_UI"
          label="V2 写入闸门"
          hint="默认开启，使用新版归档方式。关闭后不再写入新版归档，但已存的仍可正常读取。"
        >
          <AcuToggle
            :model-value="vector.form.summaryIndexV2WriteEnabled"
            label="允许 V2 快照写入"
            @update:model-value="vector.setBooleanField('summaryIndexV2WriteEnabled', $event)"
          />
        </AcuFormRow>
        <AcuFormRow
          v-if="SHOW_LEGACY_VECTOR_MAINTENANCE_UI"
          label="V2 写入 scope allowlist"
          hint="高级项：限制允许写入的范围标识，普通用户留空即可。"
        >
          <textarea
            :value="vector.form.summaryIndexV2WriteScopeAllowlistText"
            class="acu-v2-vector-index-page__scope-allowlist"
            rows="4"
            spellcheck="false"
            placeholder="每行一个 scope fingerprint"
            @change="vector.setV2WriteScopeAllowlist(($event.target as HTMLTextAreaElement).value)"
          ></textarea>
        </AcuFormRow>
      </AcuPanel>
      <div v-if="!isCrossfire" aria-hidden="true"></div>
    </AcuPanelGrid>

    <VectorIndexPromptDrawer
      :is-open="promptDrawerOpen"
      :segments="promptSegmentsForView"
      :dirty="vector.promptDirty.value"
      :message="vector.message.value"
      :role-options="ROLE_OPTIONS"
      @close="promptDrawerOpen = false"
      @save="vector.savePromptGroup"
      @reset="vector.resetPromptGroup"
      @add="vector.addPromptSegment($event)"
      @delete="vector.deletePromptSegment($event)"
      @update="onPromptUpdate"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import AcuBadge, {
  type AcuBadgeVariant,
} from "../components/_lib/AcuBadge.vue";
import AcuButton from "../components/_lib/AcuButton.vue";
import AcuFormRow from "../components/_lib/AcuFormRow.vue";
import AcuInput from "../components/_lib/AcuInput.vue";
import AcuMessage from "../components/_lib/AcuMessage.vue";
import AcuPanel from "../components/_lib/AcuPanel.vue";
import AcuPanelGrid from "../components/_lib/AcuPanelGrid.vue";
import type { PromptSegment } from "../components/_lib/AcuPromptSegments.vue";
import AcuSelect, {
  type AcuSelectOption,
} from "../components/_lib/AcuSelect.vue";
import AcuStatsList from "../components/_lib/AcuStatsList.vue";
import AcuToggle from "../components/_lib/AcuToggle.vue";
import VectorIndexPromptDrawer from "../components/VectorIndexPromptDrawer.vue";
import { useApiPresetSelectOptions } from "../composables/useApiPresetSelectOptions";
import { useChatChangedTick } from "../composables/useChatChangedListener";

import { useUiCloseGuard } from "../composables/useUiCloseGuard";
import { RERANK_BATCH_SIZE_LIMITS, useVectorApiConfig } from "../composables/useVectorApiConfig";
import { useVectorIndexConfig } from "../composables/useVectorIndexConfig";
import { vectorIndexCopy } from "../copy/vector-index-copy";
import { useDialogStore } from "../stores/dialog-store";

/**
 * 交火索引页遗留维护入口的 UI 显示开关。
 *
 * V2 快照写入已经是默认行为，并由 settings-service 的一次性 marker 处理
 * 旧配置迁移；这里仅停止暴露可关闭 writer、约束 scope 与已停用滚动增量的
 * 页面控件。composable、配置字段和持久化逻辑不受影响，改为 true 即可恢复。
 *
 * 隐藏非破坏迁移按钮会使 legacy 索引不再有页面级主动迁移入口；其读取路径
 * 与保留策略不变。
 */
const SHOW_LEGACY_VECTOR_MAINTENANCE_UI = false;

const CROSSFIRE_FLOW_HINT =
  '发送前流程：关键词生成（可关闭）→ 用户输入与关键词合并 embedding → "概览 + 纪要正文"向量与 BM25 混合召回（可关闭）→ 可选 Rerank（按纪要正文分批精排，候选不多于 TopK 时跳过）→ 按纪要表原顺序覆盖原概要索引条目。';
const VECTOR_FLOW_HINT =
  '发送前流程：用户输入直接 embedding 召回 → Rerank 精排并按「保留相关纪要条数」截取 → 选中的纪要条目切为蓝灯（常驻）注入，其余保持原条目类型；纪要索引条目保持完整目录，不按召回结果筛选；纪要有效行数少于「保留相关纪要条数」时不召回，全部纪要条目切为蓝灯。向量表格不生成关键词、不做混合召回、不触发剧情推进；Rerank 未配置或失败时本轮召回判定失败并撤回蓝灯，不会静默退回 embedding 排序。召回参数在上方「填表模式」面板单独设置。';

const props = defineProps<{
  /** 当前填表模式：向量表格只显示索引、向量服务与分块面板；交火模式显示全部参数。 */
  mode: "vector" | "crossfire";
}>();
const isCrossfire = computed(() => props.mode === "crossfire");

const dialogStore = useDialogStore();
const vector = useVectorIndexConfig();
const vectorApiConfig = useVectorApiConfig();

const {
  apiStore,
  followActiveApiLabel,
  apiPresetSelectOptions: keywordApiOptions,
} = useApiPresetSelectOptions();
const promptDrawerOpen = ref(false);

const ROLE_OPTIONS: AcuSelectOption[] = [
  { value: "system", label: "SYSTEM" },
  { value: "user", label: "USER" },
  { value: "assistant", label: "ASSISTANT" },
];

const promptSegmentsForView = computed<PromptSegment[]>(() =>
  vector.promptSegments.value.map((seg) => ({
    role: seg.role,
    content: seg.content,
    deletable: seg.deletable,
  })),
);
const keywordPromptEmpty = computed(() =>
  vector.promptSegments.value.every((seg) => !String(seg.content || "").trim()),
);
const promptTemplateBadgeLabel = computed(() =>
  vector.promptTemplateMode.value === "default"
    ? "使用默认提示词"
    : "已自定义提示词",
);
const promptTemplateBadgeVariant = computed<AcuBadgeVariant>(() =>
  vector.promptTemplateMode.value === "default" ? "neutral" : "accent",
);

function confirmPromptClose(): boolean | Promise<boolean> {
  if (!promptDrawerOpen.value || !vector.promptDirty.value) return true;
  return dialogStore.confirm({
    title: "关闭新 UI",
    message: "你有未保存的关键词生成提示词修改，确定要关闭新 UI 吗？",
    confirmLabel: "关闭新 UI",
    confirmVariant: "danger",
  });
}

function onPromptUpdate(index: number, patch: Partial<PromptSegment>): void {
  vector.updatePromptSegment(index, {
    ...(patch.role !== undefined ? { role: patch.role } : {}),
    ...(patch.content !== undefined ? { content: patch.content } : {}),
  });
}

function refreshAll(): void {
  vector.refresh();
  vectorApiConfig.refresh();
  void vector.refreshIndexStatus(false);
  apiStore.refreshFromSettings();
}

function saveVectorApiConfig(): void {
  if (vectorApiConfig.save()) vector.refresh();
}

function onRerankBatchSizeChange(raw: string | number): void {
  const value = Math.floor(Number(raw));
  vectorApiConfig.form.rerankBatchSize = Number.isFinite(value) && value > 0
    ? Math.min(RERANK_BATCH_SIZE_LIMITS.max, Math.max(RERANK_BATCH_SIZE_LIMITS.min, value))
    : RERANK_BATCH_SIZE_LIMITS.default;
}

async function onDeleteCurrentIndex(): Promise<void> {
  const confirmed = await dialogStore.confirm({
    title: "删除当前索引",
    message:
      "确定删除当前聊天的交火索引？删除后需要重新构建。",
    confirmLabel: "删除索引",
    confirmVariant: "danger",
  });
  if (!confirmed)
    return;
  void vector.deleteCurrentIndex();
}

onMounted(() => {
  refreshAll();
});
watch(useChatChangedTick(), () => {
  refreshAll();
});
useUiCloseGuard(confirmPromptClose);
</script>

<style scoped>
.acu-v2-vector-index-page {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--acu-page-gap, 14px);
}

.acu-v2-vector-index-page__panel-stack {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.acu-v2-vector-index-page__number-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 10px;
}

.acu-v2-vector-api-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.acu-v2-vector-api-form__section {
  min-width: 0;
  margin: 0;
  padding: 0 0 18px;
  border: 0;
  border-bottom: 1px solid
    color-mix(in srgb, var(--acu-text-3) 16%, transparent);
  border-radius: 0;
  background: transparent;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.acu-v2-vector-api-form__section:last-of-type {
  padding-bottom: 0;
  border-bottom: 0;
}

.acu-v2-vector-api-form__section + .acu-v2-vector-api-form__section {
  padding-top: 2px;
}

.acu-v2-vector-api-form__section legend {
  width: 100%;
  margin: 0 0 2px;
  padding: 0;
  color: var(--acu-text-1);
  font-size: var(--acu-font-size-body, 12px);
  font-weight: 700;
  line-height: 1.35;
}

.acu-v2-vector-api-form__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 12px;
  margin-top: 4px;
}

.acu-v2-vector-index-page__hint {
  margin: 0;
  font-size: var(--acu-font-size-body, 12px);
  color: var(--acu-text-3);
  line-height: 1.55;
}

.acu-v2-vector-index-page__maintenance-spacer {
  flex: 1 1 auto;
  min-height: 0;
}

.acu-v2-vector-index-page__actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 12px;
  margin-top: 4px;
}

.acu-v2-vector-index-page__prompt-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 12px;
  margin-top: 4px;
}

.acu-v2-vector-api-form__instruction-textarea {
  width: 100%;
  min-height: 60px;
  padding: 6px 8px;
  border: 1px solid color-mix(in srgb, var(--acu-text-3) 24%, transparent);
  border-radius: 4px;
  background: var(--acu-bg-2, transparent);
  color: var(--acu-text-1);
  font-size: var(--acu-font-size-body, 12px);
  line-height: 1.5;
  resize: vertical;
}

.acu-v2-vector-index-page__scope-allowlist {
  width: 100%;
  min-height: 72px;
  padding: 6px 8px;
  border: 1px solid color-mix(in srgb, var(--acu-text-3) 24%, transparent);
  border-radius: 4px;
  background: var(--acu-bg-2, transparent);
  color: var(--acu-text-1);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: var(--acu-font-size-small, 11px);
  line-height: 1.5;
  resize: vertical;
}
</style>
