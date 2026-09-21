<template>
  <div class="acu-v2-agent-chat">
    <div class="acu-v2-agent-chat__status">
      <span class="acu-v2-agent-chat__badge" :class="`acu-v2-agent-chat__badge--${statusTone}`">{{ statusText }}</span>
      <span class="acu-v2-agent-chat__status-item">{{ stageText }}</span>
      <span v-if="revisionText" class="acu-v2-agent-chat__status-item">计划 {{ revisionText }}</span>
      <!-- 冻结锚点：本轮推演写入的 assistant 楼层与 swipe，运行中不随新增楼层漂移。 -->
      <span v-if="anchorText" class="acu-v2-agent-chat__status-item">锚点 {{ anchorText }}</span>
    </div>
    <p v-if="anchorStaleDiff" class="acu-v2-agent-chat__anchor-diff">{{ anchorStaleDiff }}</p>

    <WorldSimulationSessionFeed :entries="entries" :running="running" />

    <p v-if="notice" class="acu-v2-agent-chat__notice">{{ notice }}</p>

    <div class="acu-v2-agent-chat__composer">
      <textarea
        class="acu-v2-agent-chat__input"
        :value="draft"
        :rows="3"
        :placeholder="placeholder"
        @input="onInput"
        @keydown="onKeydown"
      />
      <div class="acu-v2-agent-chat__composer-actions">
        <span class="acu-v2-agent-chat__hint">{{ inFlight ? '进行中可点停止' : 'Ctrl / ⌘ + Enter 发送' }}</span>
        <AcuButton v-if="inFlight" variant="danger" @click="emit('stop')">停止</AcuButton>
        <AcuButton v-else variant="primary" :disabled="!draft.trim()" @click="send">发送</AcuButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import AcuButton from './_lib/AcuButton.vue';
import WorldSimulationSessionFeed from './WorldSimulationSessionFeed.vue';
import { formatWorldSimulationAnchorStaleDiff_ACU } from '../simulation/world-simulation-anchor-diff';
import type { WorldSimulationSessionEntry_ACU } from '../../service/simulation/agent/agent-session-log'; // arch-ok: 仅类型导入，用于 props 标注，编译后无运行时依赖
import type { WorldSimulationTask_ACU } from '../../service/simulation/model'; // arch-ok: 仅类型导入，用于 props 标注，编译后无运行时依赖
import type { WorldSimulationError_ACU } from '../../service/simulation/model'; // arch-ok: 仅类型导入，用于 props 标注，编译后无运行时依赖

const props = defineProps<{
  task: WorldSimulationTask_ACU | null;
  lastError: WorldSimulationError_ACU | null;
  entries: WorldSimulationSessionEntry_ACU[];
  running: boolean;
  draft: string;
  sending: boolean;
  statusText: string;
  stageText: string;
  revisionText: string;
  anchorText: string;
}>();

const emit = defineEmits<{
  (event: 'send', text: string): void;
  (event: 'update:draft', value: string): void;
  (event: 'stop'): void;
}>();

/**
 * 发送与停止互斥：任一在途信号为真就把同一位置切成停止。
 * sending 覆盖点发送后、会话 running 尚未置位的空档；
 * running / task.status===running 覆盖 Agent 循环。
 */
const inFlight = computed(() =>
  props.sending
  || props.running
  || props.task?.status === 'running'
  || props.task?.status === 'drafting');

const statusTone = computed(() => {
  if (!props.task) return 'idle';
  if (props.task.status === 'running' || props.task.status === 'drafting' || props.running) return 'running';
  if (props.lastError || props.task.stopReason) return 'failed';
  return 'idle';
});

const placeholder = computed(() => {
  if (!props.task) return '描述你希望世界侧推进、保留或撤销的方向，发送后主 Agent 会创建任务并开始规划...';
  if (props.task.status === 'running' || props.task.status === 'drafting' || props.running) return '世界推演 Agent 正在工作。点「停止」可打断；要接着做就打字再发送。';
  return '继续和主 Agent 对话，写好后再发送...';
});

const notice = computed(() => {
  if (props.task?.stopReason) return `任务已停止：${props.task.stopReason}。输入新指令后发送即可继续。`;
  if (props.lastError) return `上一次失败：${props.lastError.message}`;
  return '';
});

const anchorStaleDiff = computed(() => formatWorldSimulationAnchorStaleDiff_ACU(props.lastError));

function onInput(event: Event): void {
  emit('update:draft', (event.target as HTMLTextAreaElement).value);
}

function send(): void {
  const text = props.draft.trim();
  if (!text || inFlight.value) return;
  emit('send', text);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
  event.preventDefault();
  send();
}
</script>
<style scoped>
/* 与 ContinuationChat 保持同一份样式：状态行、会话流、通知与 composer 全部同构。 */
.acu-v2-agent-chat { display: grid; gap: 10px; }
.acu-v2-agent-chat__status { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; color: var(--acu-text-3); font-size: var(--acu-font-size-caption, 11px); }
.acu-v2-agent-chat__badge { padding: 1px 8px; border-radius: 999px; background: color-mix(in srgb, var(--acu-text-3) 18%, transparent); color: var(--acu-text-2); }
.acu-v2-agent-chat__badge--running { background: color-mix(in srgb, var(--acu-primary, #5b8def) 20%, transparent); color: var(--acu-primary, #5b8def); }
.acu-v2-agent-chat__badge--failed { background: color-mix(in srgb, var(--acu-danger, #d65b5b) 18%, transparent); color: var(--acu-danger, #d65b5b); }
.acu-v2-agent-chat__status-item { color: var(--acu-text-3); }
.acu-v2-agent-chat__notice { margin: 0; color: var(--acu-text-3); font-size: var(--acu-font-size-body, 12px); white-space: pre-wrap; }
.acu-v2-agent-chat__anchor-diff { margin: 0; color: var(--acu-text-3); font-size: var(--acu-font-size-caption, 11px); white-space: pre-wrap; }
.acu-v2-agent-chat__composer { display: grid; gap: 8px; padding: 10px; border: 1px solid color-mix(in srgb, var(--acu-text-3) 22%, transparent); border-radius: 8px; background: var(--acu-bg-2); }
.acu-v2-agent-chat__input { width: 100%; box-sizing: border-box; resize: vertical; min-height: 62px; padding: 8px 10px; border: 1px solid color-mix(in srgb, var(--acu-text-3) 24%, transparent); border-radius: 6px; background: var(--acu-bg-1, var(--acu-bg-2)); color: var(--acu-text-1); font: inherit; font-size: var(--acu-font-size-body-lg, 13px); }
.acu-v2-agent-chat__input:focus { outline: none; border-color: color-mix(in srgb, var(--acu-primary, #5b8def) 60%, transparent); }
.acu-v2-agent-chat__composer-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }
.acu-v2-agent-chat__hint { margin-right: auto; color: var(--acu-text-3); font-size: var(--acu-font-size-caption, 11px); }

/* 手机窄屏：快捷键提示没有意义直接隐藏；按钮均分整行方便点按；
   输入框字号提到 16px，避免 iOS Safari 聚焦时自动放大页面。 */
@media (max-width: 640px) {
  .acu-v2-agent-chat__hint { display: none; }
  .acu-v2-agent-chat__composer-actions > * { flex: 1 1 auto; }
  .acu-v2-agent-chat__input { font-size: 16px; min-height: 56px; }
  .acu-v2-agent-chat__composer { padding: 8px; }
}
</style>