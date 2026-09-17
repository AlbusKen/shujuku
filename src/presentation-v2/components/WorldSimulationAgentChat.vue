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
      <div v-if="taskStatus === 'paused'" class="world-sim-agent-chat__actions">
        <AcuButton variant="primary" :loading="busy" @click="emit('resume')">恢复当前任务</AcuButton>
      </div>
    </template>
  </AcuPanel>
</template>

<script setup lang="ts">
import type { WorldSimulationAnchorIdentity_ACU } from '../../service/simulation/agent/agent-model'; // arch-ok: 仅类型导入，用于 props 标注，编译后无运行时依赖
import type { WorldSimulationSessionEntry_ACU } from '../../service/simulation/agent/agent-session-log'; // arch-ok: 仅类型导入，用于 props 标注，编译后无运行时依赖
import type { WorldSimulationTask_ACU } from '../../service/simulation/model'; // arch-ok: 仅类型导入，用于 props 标注，编译后无运行时依赖
import type { WorldSimulationError_ACU, WorldSimulationTaskStatus_ACU } from '../../service/simulation/model'; // arch-ok: 仅类型导入，用于 props 标注，编译后无运行时依赖
import AcuButton from './_lib/AcuButton.vue';
import AcuMessage from './_lib/AcuMessage.vue';
import AcuPanel from './_lib/AcuPanel.vue';
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
  anchor: WorldSimulationAnchorIdentity_ACU | null;
  taskStatus: WorldSimulationTaskStatus_ACU | null;
}>();
const emit = defineEmits<{
  (event: 'send', text: string): void;
  (event: 'update:draft', value: string): void;
  (event: 'stop' | 'resume' | 'refresh'): void;
}>();
</script>

<style scoped>
.world-sim-agent-chat__muted{margin:0;color:var(--acu-text-3);font-size:12px}.world-sim-agent-chat__error{margin:0;color:var(--acu-danger);white-space:pre-wrap}.world-sim-agent-chat__actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:10px}
</style>
