<template>
  <div class="ws-chat">
    <div class="ws-chat__headline">
      <div><strong>{{ running ? '世界推演 Agent 正在工作' : '可发送补充请求' }}</strong><p>{{ status }}</p></div>
      <span v-if="anchor" class="ws-chat__anchor">{{ anchor.messageKey }} · swipe {{ Number(anchor.swipeId) + 1 }}</span>
    </div>
    <WorldSimulationSessionFeed :entries="entries" :running="running" />
    <div class="ws-chat__composer">
      <AcuTextarea v-model="draft" :rows="3" :max-rows="8" auto-resize :disabled="disabled" placeholder="补充你希望世界侧推进、保留或撤销的方向；这不是已发生事实。" @keydown="onKeydown" />
      <div class="ws-chat__actions">
        <span>Ctrl / ⌘ + Enter 发送</span>
        <AcuButton v-if="running" variant="danger" :disabled="disabled" @click="emit('cancel')">中断当前运行</AcuButton>
        <AcuButton variant="primary" :disabled="disabled || !draft.trim()" @click="send">发送</AcuButton>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import type { WorldSimulationAnchorIdentity_ACU } from '../../service/simulation/agent/agent-model';
import type { WorldSimulationSessionEntry_ACU } from '../../service/simulation/agent/agent-session-log';
import AcuButton from './_lib/AcuButton.vue';
import AcuTextarea from './_lib/AcuTextarea.vue';
import WorldSimulationSessionFeed from './WorldSimulationSessionFeed.vue';
const props = withDefaults(defineProps<{ status: string; anchor: WorldSimulationAnchorIdentity_ACU | null; entries: WorldSimulationSessionEntry_ACU[]; running: boolean; disabled?: boolean }>(), { disabled: false });
const emit = defineEmits<{ (event: 'send', text: string): void; (event: 'cancel'): void }>();
const draft = ref('');
function send(): void { const text = draft.value.trim(); if (props.disabled || !text) return; emit('send', text); draft.value = ''; }
function onKeydown(event: KeyboardEvent): void { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); send(); } }
</script>
<style scoped>
.ws-chat{display:grid;gap:12px}.ws-chat__headline{display:flex;align-items:flex-start;gap:12px}.ws-chat__headline>div{flex:1}.ws-chat__headline p{margin:4px 0 0;color:var(--acu-text-3);font-size:12px}.ws-chat__anchor{padding:3px 9px;border-radius:999px;background:color-mix(in srgb,var(--acu-accent) 14%,transparent);color:var(--acu-text-2);font-size:11px}.ws-chat__composer{display:grid;gap:8px;padding:10px;border:1px solid color-mix(in srgb,var(--acu-text-3) 20%,transparent);border-radius:8px}.ws-chat__actions{display:flex;gap:8px;align-items:center}.ws-chat__actions span{margin-right:auto;color:var(--acu-text-3);font-size:11px}@media(max-width:640px){.ws-chat__headline{display:grid}.ws-chat__anchor{justify-self:start}.ws-chat__actions{flex-wrap:wrap}.ws-chat__actions span{flex:1 0 100%}}
</style>
