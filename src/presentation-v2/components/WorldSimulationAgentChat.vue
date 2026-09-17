<template>
  <AcuPanel title="世界推演 Agent 会话" description="像和 coding agent 对话一样使用：随时输入、随时打断。主 Agent 按需派工子代理取证与改写，最终账本经审核后严格提交。">
    <p v-if="error" class="world-sim-agent-chat__error">
      {{ error }}
      <AcuButton size="sm" @click="emit('refresh')">重新读取</AcuButton>
    </p>
    <p v-else-if="!ready" class="world-sim-agent-chat__muted">正在读取并验证世界推演快照…</p>
    <template v-else>
      <WorldSimulationChat
        :task="task"
        :last-error="lastError"
        :entries="entries"
        :running="running"
        :draft="draft"
        :sending="sending"
        :status-text="statusText"
        :stage-text="stageText"
        :revision-text="revisionText"
        @send="emit('send', $event)"
        @update:draft="emit('update:draft', $event)"
        @stop="emit('stop')"
      />
      <section v-if="taskStatus === 'awaiting_plan_review' && activePlan" class="world-sim-agent-chat__review">
        <header><strong>阶段计划预览</strong><span>{{ activePlan.title }}</span></header>
        <p>{{ activePlan.objective }}</p>
        <details><summary>查看完整计划</summary><pre>{{ JSON.stringify(activePlan, null, 2) }}</pre></details>
        <AcuTextarea v-model="replanDraft" :rows="3" placeholder="输入重规划约束或修正方向" />
        <div class="world-sim-agent-chat__actions">
          <AcuButton :disabled="busy || !replanDraft.trim()" @click="replan">重规划</AcuButton>
          <AcuButton variant="primary" :loading="busy" @click="emit('confirm-plan')">确认计划并执行</AcuButton>
        </div>
      </section>
      <div v-if="taskStatus === 'paused'" class="world-sim-agent-chat__actions">
        <AcuButton variant="primary" :loading="busy" @click="emit('resume')">恢复当前任务</AcuButton>
      </div>
    </template>
  </AcuPanel>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { WorldSimulationAnchorIdentity_ACU } from '../../service/simulation/agent/agent-model'; // arch-ok: 仅类型导入，用于 props 标注，编译后无运行时依赖
import type { WorldSimulationSessionEntry_ACU } from '../../service/simulation/agent/agent-session-log'; // arch-ok: 仅类型导入，用于 props 标注，编译后无运行时依赖
import type { WorldSimulationTask_ACU } from '../../service/simulation/model'; // arch-ok: 仅类型导入，用于 props 标注，编译后无运行时依赖
import type { WorldSimulationError_ACU, WorldSimulationStagePlan_ACU, WorldSimulationTaskStatus_ACU } from '../../service/simulation/model'; // arch-ok: 仅类型导入，用于 props 标注，编译后无运行时依赖
import AcuButton from './_lib/AcuButton.vue';
import AcuMessage from './_lib/AcuMessage.vue';
import AcuPanel from './_lib/AcuPanel.vue';
import AcuTextarea from './_lib/AcuTextarea.vue';
import WorldSimulationChat from './WorldSimulationChat.vue';

defineProps<{
  ready: boolean;
  busy: boolean;
  error: string;
  statusText: string;
  stageText: string;
  revisionText: string;
  draft: string;
  sending: boolean;
  running: boolean;
  task: WorldSimulationTask_ACU | null;
  lastError: WorldSimulationError_ACU | null;
  entries: WorldSimulationSessionEntry_ACU[];
  activePlan: WorldSimulationStagePlan_ACU | null;
  anchor: WorldSimulationAnchorIdentity_ACU | null;
  taskStatus: WorldSimulationTaskStatus_ACU | null;
}>();
const emit = defineEmits<{
  (event: 'send', text: string): void;
  (event: 'update:draft', value: string): void;
  (event: 'stop' | 'confirm-plan' | 'resume' | 'refresh'): void;
  (event: 'replan', text: string): void;
}>();
const replanDraft = ref('');
function replan(): void {
  const text = replanDraft.value.trim();
  if (!text) return;
  emit('replan', text);
  replanDraft.value = '';
}
</script>

<style scoped>
.world-sim-agent-chat__muted{margin:0;color:var(--acu-text-3);font-size:12px}.world-sim-agent-chat__error{margin:0;color:var(--acu-danger);white-space:pre-wrap}.world-sim-agent-chat__review{display:grid;gap:9px;margin-top:12px;padding-top:12px;border-top:1px solid color-mix(in srgb,var(--acu-text-3) 18%,transparent)}.world-sim-agent-chat__review header{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px}.world-sim-agent-chat__review p{margin:0;color:var(--acu-text-2);white-space:pre-wrap}.world-sim-agent-chat__review pre{max-height:260px;overflow:auto;padding:10px;border-radius:8px;background:var(--acu-bg-2);white-space:pre-wrap;word-break:break-word}.world-sim-agent-chat__actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:10px}
</style>
