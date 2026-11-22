<template>
  <div class="acu-viz-assistant" data-acu-visualizer-assistant>
    <div class="acu-viz-assistant__head">
      <AcuPanel
        title="AI 改表助手"
        description="让助手生成改表草稿。应用前请先检查改动，不满意可以改写需求重来。"
      >
        <template #actions>
          <AcuBadge v-if="assistant.isRunning.value" variant="warning">运行中</AcuBadge>
          <AcuBadge v-else-if="assistant.latestResult.value" variant="accent">有草稿</AcuBadge>
          <AcuBadge v-else variant="neutral">待输入</AcuBadge>
        </template>

        <div class="acu-viz-assistant__controls">
          <AcuFormRow label="API 预设">
            <AcuSelect
              :model-value="assistant.tableApiPreset.value"
              :options="assistant.apiPresetOptions.value"
              :disabled="assistant.isRunning.value"
              @update:model-value="value => assistant.tableApiPreset.value = value"
            />
          </AcuFormRow>
          <AcuButton size="sm" variant="secondary" :disabled="assistant.isRunning.value" @click="promptDrawerOpen = true">
            <i class="fa-solid fa-pen-to-square"></i> 编辑提示词
          </AcuButton>
        </div>

        <AcuInfoBanner v-if="assistant.errorMessage.value" tone="warning">
          {{ assistant.errorMessage.value }}
        </AcuInfoBanner>
      </AcuPanel>
    </div>

    <div ref="streamRef" class="acu-viz-assistant__stream">
        <div v-if="assistant.isRunning.value" class="acu-viz-assistant__running">
          <i class="fa-solid fa-spinner fa-spin"></i>
          <span>正在生成草稿…</span>
        </div>

        <p v-if="!assistant.turns.value.length && !assistant.rounds.value.length" class="acu-viz-assistant__empty">
          还没有会话。发送需求后，助手会列出变化对比和需要确认的风险项。
        </p>

        <div class="acu-viz-assistant__turns">
          <article
            v-for="turn in assistant.turns.value"
            :key="turn.id"
            class="acu-viz-assistant__turn"
            :class="`acu-viz-assistant__turn--${turn.type}`"
          >
            <header class="acu-viz-assistant__turn-head">
              <strong v-if="turn.type === 'user'">你提出的需求</strong>
              <strong v-else-if="turn.type === 'round'">AI 助手</strong>
              <strong v-else-if="turn.type === 'final'">AI 助手 · 最终草稿</strong>
              <strong v-else>执行错误</strong>
              <AcuBadge v-if="turn.type === 'final'" variant="accent">
                {{ assistant.getTurnSessionSummary(turn) }}
              </AcuBadge>
              <AcuBadge v-else-if="turn.type === 'error'" variant="warning">需要处理</AcuBadge>
              <AcuBadge v-else variant="neutral">请求</AcuBadge>
              <div class="acu-viz-assistant__turn-ops">
                <AcuButton
                  v-if="turn.type === 'user'"
                  size="sm"
                  icon-only
                  title="从这条需求重新生成（将丢弃它之后的记录）"
                  :disabled="assistant.isRunning.value"
                  @click="assistant.regenerateFromUserTurn(turn)"
                >
                  <i class="fa-solid fa-rotate-right"></i>
                </AcuButton>
                <AcuButton
                  size="sm"
                  icon-only
                  title="删除这条记录"
                  :disabled="assistant.isRunning.value"
                  @click="assistant.deleteTurn(turn.id)"
                >
                  <i class="fa-solid fa-trash"></i>
                </AcuButton>
              </div>
            </header>
            <p>{{ assistant.getTurnSummary(turn) }}</p>

            <AcuInfoBanner
              v-if="assistant.getTurnValidationError(turn)"
              tone="warning"
            >
              校验失败：{{ assistant.getTurnValidationError(turn) }}
            </AcuInfoBanner>

            <AcuDisclosureGroup
              v-if="assistant.getTurnRawText(turn)"
              label="查看 AI 原始输出"
              :expanded="rawExpandedByTurn[turn.id] === true"
              :body-id="`acu-viz-assistant-raw-turn-${turn.id}`"
              body-mode="show"
              root-class="acu-viz-assistant__raw-disclosure"
              @toggle="toggleRawExpanded(turn.id)"
            >
              <pre class="acu-viz-assistant__raw-text">{{ assistant.getTurnRawText(turn) }}</pre>
            </AcuDisclosureGroup>

            <AcuInfoBanner
              v-if="assistant.getTurnWarnings(turn).length"
              tone="warning"
            >
              <ul class="acu-viz-assistant__inline-list">
                <li
                  v-for="warning in assistant.getTurnWarnings(turn)"
                  :key="warning"
                >
                  {{ warning }}
                </li>
              </ul>
            </AcuInfoBanner>

            <div
              v-if="assistant.getTurnDiffGroups(turn).length"
              class="acu-viz-assistant__turn-diff"
            >
              <section
                v-for="group in assistant.getTurnDiffGroups(turn)"
                :key="`${turn.id}-${group.key}`"
                class="acu-viz-assistant__diff-group"
                :class="{ 'acu-viz-assistant__diff-group--warning': group.tone === 'warning' }"
              >
                <h4>{{ group.title }}</h4>
                <ul>
                  <li v-for="item in group.items" :key="item">{{ item }}</li>
                </ul>
              </section>
            </div>

            <div
              v-if="turn.type === 'round' || turn.type === 'final'"
              class="acu-viz-assistant__turn-apply"
            >
              <div
                v-if="assistant.getTurnHighRiskItems(turn).length"
                class="acu-viz-assistant__turn-risk"
              >
                <h4>高风险确认</h4>
                <article
                  v-for="(item, index) in assistant.getTurnHighRiskItems(turn)"
                  :key="`${turn.id}-${item.type}-${index}`"
                  class="acu-viz-assistant__risk-item"
                >
                  <AcuCheckbox
                    :model-value="assistant.riskConfirmations.value[`${turn.id}:${index}`] === true"
                    @update:model-value="value => assistant.setRiskConfirmation(turn.id, index, value)"
                  >
                    {{ item.label }}
                  </AcuCheckbox>
                </article>
              </div>
              <AcuButton
                v-if="assistant.getTurnApplyPayload(turn)"
                :disabled="!assistant.canApplyTurn(turn)"
                :title="assistant.getTurnApplyBlockReason(turn)"
                @click="assistant.applyTurnDraft(turn)"
              >
                应用到编辑器草稿
              </AcuButton>
              <p
                v-if="assistant.getTurnApplyPayload(turn) && assistant.getTurnApplyBlockReason(turn)"
                class="acu-viz-assistant__apply-reason"
              >
                {{ assistant.getTurnApplyBlockReason(turn) }}
              </p>
            </div>
          </article>
        </div>
    </div>

    <div class="acu-viz-assistant__composer">
      <AcuTextarea
        class="acu-viz-assistant__composer-input"
        :model-value="assistant.userRequest.value"
        :rows="2"
        :max-rows="8"
        auto-resize
        :disabled="assistant.isRunning.value"
        placeholder="描述你想怎么改表。例如：给角色状态表新增“短期目标”和“风险提示”两列。"
        @update:model-value="value => assistant.userRequest.value = value"
      />
      <div class="acu-viz-assistant__composer-actions">
        <AcuButton
          v-if="assistant.isRunning.value"
          variant="danger"
          size="sm"
          @click="assistant.cancel"
        >
          <i class="fa-solid fa-stop"></i>
          停止
        </AcuButton>
        <AcuButton
          v-else
          variant="primary"
          size="sm"
          :disabled="!assistant.userRequest.value.trim()"
          @click="assistant.run"
        >
          <i class="fa-solid fa-paper-plane"></i>
          发送
        </AcuButton>
      </div>
    </div>

    <AssistantPromptDrawer
      :is-open="promptDrawerOpen"
      :segments="assistant.promptSegments.value"
      :dirty="assistant.promptDirty.value"
      :message="null"
      @close="promptDrawerOpen = false"
      @save="assistant.savePrompt"
      @reset="assistant.resetPrompt"
      @import-file="assistant.importPromptFile($event)"
      @export="assistant.exportPrompt"
      @add="assistant.addPromptSegment($event)"
      @delete="assistant.deletePromptSegment($event)"
      @update="(index, patch) => assistant.updatePromptSegment(index, patch)"
    />
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import AssistantPromptDrawer from '../../components/AssistantPromptDrawer.vue';
import AcuBadge from '../../components/_lib/AcuBadge.vue';
import AcuButton from '../../components/_lib/AcuButton.vue';
import AcuCheckbox from '../../components/_lib/AcuCheckbox.vue';
import AcuDisclosureGroup from '../../components/_lib/AcuDisclosureGroup.vue';
import AcuFormRow from '../../components/_lib/AcuFormRow.vue';
import AcuInfoBanner from '../../components/_lib/AcuInfoBanner.vue';
import AcuPanel from '../../components/_lib/AcuPanel.vue';
import AcuSelect from '../../components/_lib/AcuSelect.vue';
import AcuTextarea from '../../components/_lib/AcuTextarea.vue';
import { useVisualizerAssistant } from '../../composables/visualizer/useVisualizerAssistant';

const assistant = useVisualizerAssistant();
const promptDrawerOpen = ref(false);

// 按 turn 隔离的「查看 AI 原始输出」展开状态（AcuDisclosureGroup 是受控组件，展开必须由父级维护）。
const rawExpandedByTurn = ref<Record<string, boolean>>({});
function toggleRawExpanded(turnId: string): void {
  // 用新对象赋值而非原地改属性，保证 Vue 响应式可靠触发。
  rawExpandedByTurn.value = {
    ...rawExpandedByTurn.value,
    [turnId]: rawExpandedByTurn.value[turnId] !== true,
  };
}

// 会话列表唯一滚动区：新 turn 到达时若用户已在底部附近则自动滚到底，
// 避免打断向上翻阅历史。
const streamRef = ref<HTMLElement | null>(null);
watch(
  () => assistant.turns.value.length,
  async () => {
    const el = streamRef.value;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (!nearBottom) return;
    await nextTick();
    el.scrollTop = el.scrollHeight;
  },
);
</script>

<style scoped>
.acu-viz-assistant {
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.acu-viz-assistant__head {
  flex: 0 0 auto;
  min-width: 0;
}

.acu-viz-assistant__controls {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(140px, 180px);
  gap: 10px;
}

.acu-viz-assistant__stream {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  display: grid;
  gap: 8px;
  align-content: start;
}

.acu-viz-assistant__composer {
  flex: 0 0 auto;
  min-width: 0;
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--acu-border);
  background: var(--acu-bg-1);
}

.acu-viz-assistant__composer-input {
  flex: 1 1 auto;
  min-width: 0;
}

.acu-viz-assistant__composer-actions {
  flex: 0 0 auto;
  display: flex;
  gap: 6px;
}

.acu-viz-assistant__turn-ops {
  margin-left: auto;
  display: flex;
  gap: 4px;
  flex: 0 0 auto;
}
.acu-viz-assistant__apply-reason {
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-caption, 11px);
  line-height: 1.4;
}

.acu-viz-assistant__raw-disclosure {
  min-width: 0;
  border: 1px solid var(--acu-border);
  border-radius: var(--acu-radius-sm);
  background: var(--acu-bg-0);
}

.acu-viz-assistant__raw-text {
  margin: 0;
  max-height: 260px;
  overflow: auto;
  padding: 10px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--acu-font-mono);
  font-size: 11px;
  line-height: 1.5;
  color: var(--acu-text-2);
  background: var(--acu-bg-1);
  border-radius: var(--acu-radius-sm);
}

.acu-viz-assistant__running {
  color: var(--acu-text-2);
  font-size: var(--acu-font-size-body-lg, 13px);
}

.acu-viz-assistant__empty {
  margin: 0;
  color: var(--acu-text-2);
  font-size: var(--acu-font-size-body-lg, 13px);
  line-height: 1.55;
}

.acu-viz-assistant__turns,
.acu-viz-assistant__risk-list {
  min-width: 0;
  display: grid;
  gap: 8px;
}

.acu-viz-assistant__turn,
.acu-viz-assistant__risk-item,
.acu-viz-assistant__diff-group {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--acu-border);
  border-radius: var(--acu-radius-sm);
  background: var(--acu-bg-0);
}

.acu-viz-assistant__turn strong,
.acu-viz-assistant__diff-group h4,
.acu-viz-assistant__risk-list h4 {
  min-width: 0;
  margin: 0;
  color: var(--acu-text-1);
  font-size: var(--acu-font-size-body-lg, 13px);
  line-height: 1.35;
}

.acu-viz-assistant__turn {
  display: grid;
  gap: 6px;
}

.acu-viz-assistant__turn--user {
  box-shadow: inset 3px 0 0 var(--acu-accent);
}

.acu-viz-assistant__turn--round {
  background: var(--acu-bg-1);
}

.acu-viz-assistant__turn--error {
  box-shadow: inset 3px 0 0 var(--acu-warning);
}

.acu-viz-assistant__turn-head {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: flex-start;
}

.acu-viz-assistant__turn-head strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acu-viz-assistant__turn p {
  margin: 0;
  color: var(--acu-text-2);
  font-size: var(--acu-font-size-body, 12px);
  line-height: 1.55;
}

.acu-viz-assistant__turn-diff {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
}

.acu-viz-assistant__diff-group {
  display: grid;
  gap: 8px;
}

.acu-viz-assistant__diff-group--warning {
  box-shadow: inset 3px 0 0 var(--acu-warning);
}

.acu-viz-assistant__diff-group ul,
.acu-viz-assistant__inline-list {
  margin: 0;
  padding-left: 18px;
  color: var(--acu-text-2);
  font-size: var(--acu-font-size-body, 12px);
  line-height: 1.55;
}

.acu-viz-assistant__risk-list {
  padding-top: 10px;
  border-top: 1px solid var(--acu-border-2);
}

@media (max-width: 860px) {
  .acu-viz-assistant__controls {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 767px) {
  .acu-viz-assistant__composer {
    flex-direction: column;
    align-items: stretch;
  }

  .acu-viz-assistant__composer-actions {
    justify-content: flex-end;
  }
}

@media (max-width: 480px) {
  .acu-viz-assistant__turn-head {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
