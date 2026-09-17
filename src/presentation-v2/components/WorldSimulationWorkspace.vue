<template>
  <section class="world-sim-workspace">
    <!-- 会话独占整宽在上，资料/账本/设置并列其下：会话是主操作面，其余是查阅与控制面。 -->
    <AcuPanel title="Agent 会话" description="像和 coding agent 对话一样使用：随时输入、随时打断。主 Agent 按需派工子代理取证与改写，最终账本经审核后严格提交。">
      <WorldSimulationAgentChat
        :ready="runtime.ready.value"
        :busy="runtime.busy.value"
        :error="runtime.error.value"
        :status-text="statusText"
        :stage-text="stageText"
        :revision-text="revisionText"
        :draft="messageDraft"
        :sending="messageSending"
        :running="sessionState.running"
        :task="runtime.task.value"
        :last-error="runtime.envelope.value?.lastError ?? null"
        :entries="sessionState.entries"
        :anchor="snapshot?.anchor ?? null"
        :task-status="runtime.task.value?.status ?? null"
        @send="sendMessage"
        @update:draft="messageDraft = $event"
        @stop="stopRun"
        @resume="runtime.resume"
        @refresh="refresh"
      />
    </AcuPanel>

    <AcuPanelGrid class="world-sim-workspace__layout">
      <AcuPanel title="世界推演资料维护" description="查看当前 active swipe 的世界状态、候选轨迹与读取诊断；当前版本保持只读，避免绕过 T1–T9 联合提交。">
        <WorldSimulationMaterialsPanel v-if="snapshot" :conversation="snapshot.conversation" :materials="snapshot.materials" :session="snapshot.session.entries" />
        <p v-else class="world-sim-workspace__muted">当前没有可显示的世界推演资料。</p>
      </AcuPanel>

      <AcuPanel title="当前 active swipe 世界账本资料" description="只读回放当前分支；默认隐藏 hidden 条目，不会写回账本、会话或正文。">
        <WorldSimulationAgentPreview
          :ledger="runtime.envelope.value?.ledger ?? null"
          :anchor="snapshot?.anchor ?? null"
          :diagnostics="diagnostics"
          :projection-preview="snapshot?.projectionPreview ?? null"
          @refresh="refresh"
        />
      </AcuPanel>
    </AcuPanelGrid>

    <WorldSimulationSettingsPanel :settings="runtime.settingsDraft.value" :busy="runtime.busy.value" @save="saveSettings" />
  </section>
</template>


<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { WorldSimulationSettings_ACU } from '../../service/simulation/model'; // arch-ok: 仅类型导入，用于 props 标注，编译后无运行时依赖
import AcuPanel from './_lib/AcuPanel.vue';
import AcuPanelGrid from './_lib/AcuPanelGrid.vue';
import WorldSimulationAgentChat from './WorldSimulationAgentChat.vue';
import WorldSimulationAgentPreview from './WorldSimulationAgentPreview.vue';
import WorldSimulationMaterialsPanel from './WorldSimulationMaterialsPanel.vue';
import WorldSimulationSettingsPanel from './WorldSimulationSettingsPanel.vue';
import { useChatChangedTick, useChatMutationTick } from '../composables/useChatChangedListener';
import { useWorldSimulationRuntime } from '../composables/useWorldSimulationRuntime';

const runtime = useWorldSimulationRuntime();
const snapshot = computed(() => runtime.snapshot.value);
const diagnostics = computed(() => snapshot.value ? [...snapshot.value.conversation.diagnostics, ...snapshot.value.materials.diagnostics] : []);

/** 会话流状态随 snapshot 刷新：session log 订阅在运行中会持续触发 runtime.refresh。 */
const sessionState = computed(() => snapshot.value?.session ?? { chatIdentity: null, entries: [], running: false });


/** 会话草稿与在途标记：与 ContinuationPage 相同的发送互斥语义。 */
const messageDraft = ref('');
const messageSending = ref(false);

const statusText = computed(() => {
  const task = runtime.task.value;
  if (!task) return '尚未创建任务';
  if (task.status === 'running' || task.status === 'drafting') return '运行中';
  if (task.status === 'paused') return '已暂停';
  if (task.status === 'completed') return '已完成';
  if (task.status === 'failed') return '已失败';
  if (task.status === 'abandoned') return '已中止';

  return task.status;
});
const stageText = computed(() => {
  if (!runtime.task.value) return '尚未创建任务';
  const stage = runtime.activeStage?.value ?? null;
  return stage ? `第 ${stage.stageNumber} 阶段` : '计划待创建';
});
const revisionText = computed(() => (runtime.activeRevision?.value ? `${runtime.activeRevision.value.revision}` : ''));

/** 发送与 ContinuationPage 同一语义：inFlight 时 Chat 已切成停止，这里只负责转发与清草稿。 */
async function sendMessage(text: string): Promise<void> {
  if (messageSending.value) return;
  messageSending.value = true;
  try {
    const accepted = await runtime.send(text);
    if (accepted && messageDraft.value.trim() === text) messageDraft.value = '';
  } finally {
    messageSending.value = false;
  }
}

/** 停止：中断当前 run 的 AbortController。 */
function stopRun(): void {
  runtime.cancel();
}

function refresh(): void { runtime.refresh(); }
function cloneSettings(settings: WorldSimulationSettings_ACU): WorldSimulationSettings_ACU {
  return JSON.parse(JSON.stringify(settings)) as WorldSimulationSettings_ACU;
}
async function saveSettings(settings: WorldSimulationSettings_ACU): Promise<void> {
  runtime.settingsDraft.value = cloneSettings(settings);
  await runtime.saveSettings();
}
const chatChangedTick = useChatChangedTick();
const chatMutationTick = useChatMutationTick();
onMounted(refresh);
watch([chatChangedTick, chatMutationTick], refresh);
</script>


<style scoped>
.world-sim-workspace { display: flex; flex-direction: column; gap: 18px; }
.world-sim-workspace__layout { align-items: start; }
.world-sim-workspace__muted { margin: 0; color: var(--acu-text-3); font-size: 12px; }
</style>
