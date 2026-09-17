<template>
  <WorldSimulationAgentChat
    :ready="runtime.ready.value" :busy="runtime.busy.value" :error="runtime.error.value" :status="statusText"
    :anchor="snapshot?.anchor ?? null" :entries="snapshot?.session.entries ?? []" :running="snapshot?.session.running ?? false"
    :task-status="runtime.task.value?.status ?? null" :active-plan="runtime.activeRevision.value?.plan ?? null"
    @send="runtime.send" @cancel="runtime.cancel" @confirm-plan="runtime.confirmPlan" @replan="runtime.replan" @resume="runtime.resume" @refresh="refresh"
  />
  <WorldSimulationAgentPreview
    :ledger="runtime.envelope.value?.ledger ?? null" :anchor="snapshot?.anchor ?? null" :diagnostics="diagnostics" :projection-preview="snapshot?.projectionPreview ?? null" @refresh="refresh"
  />
  <AcuPanel title="世界推演资料维护" description="查看当前 active swipe 的世界状态、Agent 会话、候选轨迹与读取诊断；当前版本保持只读，避免绕过 T1–T9 联合提交。">
    <WorldSimulationMaterialsPanel v-if="snapshot" :conversation="snapshot.conversation" :materials="snapshot.materials" :session="snapshot.session.entries" />
    <p v-else class="world-sim-workspace__muted">当前没有可显示的世界推演资料。</p>
  </AcuPanel>
  <WorldSimulationSettingsPanel :settings="runtime.settingsDraft.value" :busy="runtime.busy.value" @save="saveSettings" />
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import type { WorldSimulationSettings_ACU } from '../../service/simulation/model';
import AcuPanel from './_lib/AcuPanel.vue';
import WorldSimulationAgentChat from './WorldSimulationAgentChat.vue';
import WorldSimulationAgentPreview from './WorldSimulationAgentPreview.vue';
import WorldSimulationMaterialsPanel from './WorldSimulationMaterialsPanel.vue';
import WorldSimulationSettingsPanel from './WorldSimulationSettingsPanel.vue';
import { useChatChangedTick, useChatMutationTick } from '../composables/useChatChangedListener';
import { useWorldSimulationRuntime } from '../composables/useWorldSimulationRuntime';

const runtime = useWorldSimulationRuntime();
const snapshot = computed(() => runtime.snapshot.value);
const diagnostics = computed(() => snapshot.value ? [...snapshot.value.conversation.diagnostics, ...snapshot.value.materials.diagnostics] : []);
const statusText = computed(() => {
  const task = runtime.task.value;
  if (!task) return '尚未创建任务';
  const error = runtime.envelope.value?.lastError;
  return [task.status, error ? `${error.code}: ${error.message}` : ''].filter(Boolean).join(' · ');
});
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
.world-sim-workspace__muted{margin:0;color:var(--acu-text-3);font-size:12px}
</style>
