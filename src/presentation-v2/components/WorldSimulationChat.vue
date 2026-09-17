<template>
  <div class="ws-chat">
    <div class="ws-status"><strong>{{ status }}</strong><span v-if="anchor">锚点 {{ anchor.messageKey }} / swipe {{ anchor.swipeId }}</span></div>
    <WorldSimulationSessionFeed :entries="entries" :running="running" />
    <textarea v-model="draft" rows="3" placeholder="输入世界推演指令；所有动作会经过 simulation runtime…" @keydown.ctrl.enter.prevent="send" />
    <div class="ws-actions"><AcuButton v-if="running" variant="danger" @click="$emit('cancel')">取消</AcuButton><AcuButton v-else variant="primary" :disabled="!draft.trim()" @click="send">发送</AcuButton></div>
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import AcuButton from './_lib/AcuButton.vue';
import WorldSimulationSessionFeed from './WorldSimulationSessionFeed.vue';
import type { WorldSimulationAnchorIdentity_ACU } from '../../service/simulation/agent/agent-model';
import type { WorldSimulationSessionEntry_ACU } from '../../service/simulation/agent/agent-session-log';
const props = defineProps<{ status: string; anchor: WorldSimulationAnchorIdentity_ACU | null; entries: WorldSimulationSessionEntry_ACU[]; running: boolean }>();
const emit = defineEmits<{ (event: 'send', text: string): void; (event: 'cancel'): void }>();
const draft = ref('');
function send(){ const text=draft.value.trim(); if(!text || props.running)return; emit('send',text); draft.value=''; }
</script>
<style scoped>
.ws-chat{display:grid;gap:10px}.ws-status{display:flex;flex-wrap:wrap;gap:12px;color:var(--acu-text-2)}textarea{box-sizing:border-box;width:100%;resize:vertical;padding:9px;border:1px solid color-mix(in srgb,var(--acu-text-3) 25%,transparent);border-radius:8px;background:var(--acu-bg-2);color:var(--acu-text-1);font:inherit}.ws-actions{display:flex;justify-content:flex-end}
</style>
