<template>
  <AcuPanel title="世界推演 Agent 会话" description="输入补充后，主 Agent 只负责选择子代理；子代理的增删改仍必须通过账本 revision、active swipe 与联合提交校验。">
    <div class="world-sim-chat">
      <p class="world-sim-chat__status">{{ committing ? '世界账本严格保存中' : running ? '世界推演 Agent 正在工作' : '可发送补充请求' }}</p>
      <WorldSimulationSessionFeed :entries="entries" :running="running" />
      <p v-if="notice" class="world-sim-chat__notice">{{ notice }}</p>
      <div class="world-sim-chat__composer">
        <textarea :value="draft" rows="3" placeholder="补充你希望世界侧推进、保留或撤销的方向；这不是已发生事实。" @input="draft = ($event.target as HTMLTextAreaElement).value" @keydown="onKeydown" />
        <div class="world-sim-chat__actions">
          <span>Ctrl / ⌘ + Enter 发送</span>
          <AcuButton v-if="running" variant="danger" @click="interrupt">中断并维护</AcuButton>
          <AcuButton variant="primary" :disabled="!draft.trim() || busy" @click="send">发送</AcuButton>
        </div>
      </div>
    </div>
  </AcuPanel>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { getWorldSimulationRuntime_ACU } from '../../service/simulation/simulation-runtime-registry';
import { useWorldSimulationSession } from '../composables/useWorldSimulationSession';
import { useChatChangedTick, useChatMutationTick } from '../composables/useChatChangedListener';
import AcuButton from './_lib/AcuButton.vue';
import AcuPanel from './_lib/AcuPanel.vue';
import WorldSimulationSessionFeed from './WorldSimulationSessionFeed.vue';

const runtime = getWorldSimulationRuntime_ACU();
const session = useWorldSimulationSession();
const { entries, notice } = session;
const draft = ref('');
const busy = ref(false);
const running = computed(() => busy.value || session.running.value || runtime.isAgentSessionRunning() || runtime.isAutomaticFlightRunning?.() === true);
const committing = computed(() => runtime.isAgentSessionCommitting?.() === true || runtime.isAutomaticFlightCommitting?.() === true);
async function send(): Promise<void> { const text = draft.value.trim(); if (!text || busy.value) return; busy.value = true; notice.value = ''; try { const result = await runtime.submitAgentMessage(text); draft.value = ''; notice.value = result === 'queued' ? '请求已排队，当前飞行完成后会按顺序处理。' : result === 'started_with_audit_warning' ? '世界账本已联合提交，但会话审计同步失败；不要重复发送同一请求。' : '请求已提交给世界推演 Agent。'; } catch (error) { notice.value = error instanceof Error ? error.message : String(error); } finally { busy.value = false; } }
async function interrupt(): Promise<void> {
  if (busy.value) return;
  busy.value = true; notice.value = '';
  try {
    const instruction = draft.value.trim() || '中止当前可取消的世界推演，并先维护后续请求。';
    const result = await runtime.interruptAndMaintain({ action: 'interrupt_and_maintain', instruction });
    draft.value = '';
    notice.value = result === 'queued_after_commit'
      ? '世界账本严格保存已开始，无法取消；中断请求已排队，保存完成后会先维护。'
      : result === 'queued_after_abort' || result === 'queued_after_flight'
        ? '当前可取消飞行已中断；请求将按顺序先维护。'
        : '中断请求已提交给世界推演 Agent。';
  } catch (error) { notice.value = error instanceof Error ? error.message : String(error); }
  finally { busy.value = false; }
}
function onKeydown(event: KeyboardEvent): void { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void send(); } }
watch(useChatChangedTick(), () => session.rehydrate());
watch(useChatMutationTick(), () => session.resyncAfterChatMutation());
</script>

<style scoped>
.world-sim-chat{display:grid;gap:10px}.world-sim-chat__status,.world-sim-chat__notice{margin:0;color:var(--acu-text-3);font-size:12px}.world-sim-chat__composer{display:grid;gap:8px;padding:10px;border:1px solid color-mix(in srgb,var(--acu-text-3) 20%,transparent);border-radius:8px}.world-sim-chat__composer textarea{width:100%;box-sizing:border-box;resize:vertical;background:var(--acu-bg-2);color:var(--acu-text-1);border:0;border-radius:6px;padding:8px;font:inherit}.world-sim-chat__actions{display:flex;gap:8px;align-items:center}.world-sim-chat__actions span{margin-right:auto;color:var(--acu-text-3);font-size:11px}
</style>
