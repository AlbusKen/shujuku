<template>
  <div class="ws-materials">
    <section><h4>Agent 会话材料</h4><p v-if="!conversation.messages.length" class="muted">暂无会话材料。</p><ol v-else><li v-for="item in conversation.messages" :key="item.id"><strong>{{ item.kind }}</strong> · {{ item.text }}<small>{{ item.turnKey }}</small></li></ol></section>
    <section><h4>结算快照</h4><p v-if="!materials.snapshot" class="muted">当前聊天没有世界推演材料快照。</p><template v-else><p>账本 revision {{ materials.snapshot.ledgerRevision }} · 证据 {{ materials.snapshot.evidenceRefs.length }} 条 · 来源楼层 {{ materials.adoptedIndex ?? '未知' }}</p><details><summary>证据引用</summary><ul><li v-for="ref in materials.snapshot.evidenceRefs" :key="ref">{{ ref }}</li></ul></details></template></section>
    <section v-if="materials.diagnostics.length"><h4>读取诊断</h4><ul><li v-for="item in materials.diagnostics" :key="item">{{ item }}</li></ul></section>
    <section><h4>候选与审查轨迹</h4><p v-if="!candidateEntries.length" class="muted">暂无候选、派工或终审记录。</p><ul v-else><li v-for="item in candidateEntries" :key="item.id"><strong>{{ item.title }}</strong><span>{{ item.detail }}</span></li></ul></section>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import type { WorldSimulationConversationView_ACU, WorldSimulationMaterialsReadResult_ACU } from '../../service/simulation/agent/agent-model';
import type { WorldSimulationSessionEntry_ACU } from '../../service/simulation/agent/agent-session-log';
const props=defineProps<{conversation:WorldSimulationConversationView_ACU;materials:WorldSimulationMaterialsReadResult_ACU;session:WorldSimulationSessionEntry_ACU[]}>();
const candidateEntries=computed(()=>props.session.filter(item=>['delegation','finalize','block'].includes(item.kind)));
</script>
<style scoped>
.ws-materials{display:grid;gap:12px}section{padding:10px;border:1px solid color-mix(in srgb,var(--acu-text-3) 20%,transparent);border-radius:8px}h4{margin:0 0 8px}p,ul,ol{margin:6px 0;padding-left:20px}.muted,small{color:var(--acu-text-3)}li{margin:5px 0;white-space:pre-wrap;word-break:break-word}li span,li small{display:block}
</style>
