<template>
  <AcuPanel title="世界推演 Agent 会话" description="输入补充后，主 Agent 只负责选择子代理；子代理的增删改仍必须通过账本 revision、active swipe 与联合提交校验。">
    <div class="world-sim-chat">
      <p class="world-sim-chat__status">{{ committing ? '世界账本严格保存中' : running ? '世界推演 Agent 正在工作' : '可发送补充请求' }}</p>
      <div class="world-sim-chat__feed">
        <p v-if="!entries.length" class="world-sim-chat__empty">还没有会话记录。发送补充后，主 Agent 的派工和受控提交结果会显示在这里。</p>
        <article v-for="entry in entries" :key="`${entry.id}-${entry.at}`" class="world-sim-chat__entry" :class="`world-sim-chat__entry--${entry.status}`">
          <strong>{{ label(entry) }}</strong><span>{{ entry.title }}</span>
          <p>{{ entry.detail }}</p>
        </article>
      </div>
      <p v-if="notice" class="world-sim-chat__notice">{{ notice }}</p>
      <div class="world-sim-chat__composer">
        <textarea :value="draft" rows="3" placeholder="补充你希望世界侧推进、保留或撤销的方向；这不是已发生事实。" @input="draft = ($event.target as HTMLTextAreaElement).value" @keydown="onKeydown" />
        <div class="world-sim-chat__actions">
          <span>Ctrl / ⌘ + Enter 发送</span>
          <AcuButton v-if="running" variant="danger" @click="stop">停止</AcuButton>
          <AcuButton v-else variant="primary" :disabled="!draft.trim()" @click="send">发送</AcuButton>
        </div>
      </div>
    </div>
  </AcuPanel>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { getWorldSimulationRuntime_ACU } from '../../service/simulation/simulation-runtime-registry';
import { readWorldSimulationConversationTimelineWithDiagnostics_ACU, subscribeWorldSimulationConversation_ACU, type WorldSimulationConversationMessage_ACU } from '../../service/simulation/world-simulation-agent-conversation';
import { useChatChangedTick } from '../composables/useChatChangedListener';
import AcuButton from './_lib/AcuButton.vue';
import AcuPanel from './_lib/AcuPanel.vue';

const runtime = getWorldSimulationRuntime_ACU();
const entries = ref<WorldSimulationConversationMessage_ACU[]>([]);
const draft = ref('');
const busy = ref(false);
const notice = ref('');
const running = computed(() => busy.value || runtime.isAgentSessionRunning());
const committing = computed(() => runtime.isAgentSessionCommitting?.() === true);
function refresh(): void {
  const timeline = readWorldSimulationConversationTimelineWithDiagnostics_ACU();
  entries.value = timeline.messages;
  if (timeline.invalidMessageIndexes.length) {
    notice.value = `已跳过 ${timeline.invalidMessageIndexes.length} 条损坏的非权威会话记录；原始数据未被改写。`;
  }
}
function label(entry: WorldSimulationConversationMessage_ACU): string { return entry.kind === 'user' ? '你' : entry.kind === 'plan' ? '主 Agent' : entry.agentName || entry.kind; }
async function send(): Promise<void> { const text = draft.value.trim(); if (!text || running.value) return; busy.value = true; notice.value = ''; try { const result = await runtime.submitAgentMessage(text); draft.value = ''; notice.value = result === 'queued' ? '请求已排队，下一条可用 AI 楼层会处理。' : result === 'started_with_audit_warning' ? '世界账本已联合提交，但会话审计同步失败；不要重复发送同一请求。' : '请求已提交给世界推演 Agent。'; } catch (error) { notice.value = error instanceof Error ? error.message : String(error); } finally { busy.value = false; refresh(); } }
function stop(): void {
  const result = runtime.stopAgentSession();
  notice.value = result === 'committed'
    ? '世界账本已联合提交；会话审计同步仍在进行，无需重复发送请求。'
    : result === 'committing'
    ? '世界账本严格保存已开始，无法取消；正在等待联合保存完成。'
    : result === 'aborted'
      ? '已请求停止；尚未取得提交权的账本变化不会落盘。'
      : '当前没有可停止的世界推演 Agent 会话。';
}
function onKeydown(event: KeyboardEvent): void { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void send(); } }
let unsubscribe: (() => void) | null = null;
onMounted(() => { refresh(); unsubscribe = subscribeWorldSimulationConversation_ACU(refresh); });
onBeforeUnmount(() => { unsubscribe?.(); });
watch(useChatChangedTick(), refresh);
</script>

<style scoped>
.world-sim-chat{display:grid;gap:10px}.world-sim-chat__status,.world-sim-chat__notice{margin:0;color:var(--acu-text-3);font-size:12px}.world-sim-chat__feed{max-height:420px;overflow:auto;display:grid;gap:6px;padding:10px;border:1px solid color-mix(in srgb,var(--acu-text-3) 20%,transparent);border-radius:8px;background:var(--acu-bg-2)}.world-sim-chat__empty{margin:0;padding:16px 4px;text-align:center;color:var(--acu-text-3);font-size:12px}.world-sim-chat__entry{padding:8px;border-left:3px solid var(--acu-primary);background:var(--acu-bg-1);border-radius:6px}.world-sim-chat__entry--failed{border-left-color:var(--acu-danger)}.world-sim-chat__entry strong{margin-right:8px;font-size:11px}.world-sim-chat__entry span{font-size:13px}.world-sim-chat__entry p{margin:5px 0 0;white-space:pre-wrap;font-size:12px;color:var(--acu-text-2)}.world-sim-chat__composer{display:grid;gap:8px;padding:10px;border:1px solid color-mix(in srgb,var(--acu-text-3) 20%,transparent);border-radius:8px}.world-sim-chat__composer textarea{width:100%;box-sizing:border-box;resize:vertical;background:var(--acu-bg-2);color:var(--acu-text-1);border:0;border-radius:6px;padding:8px;font:inherit}.world-sim-chat__actions{display:flex;gap:8px;align-items:center}.world-sim-chat__actions span{margin-right:auto;color:var(--acu-text-3);font-size:11px}
</style>
