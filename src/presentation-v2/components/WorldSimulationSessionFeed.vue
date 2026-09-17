<template>
  <div ref="feed" class="ws-feed">
    <p v-if="!entries.length" class="ws-feed__empty">还没有会话记录。发送补充后，主 Agent 的派工、取证和提交结果会显示在这里。</p>
    <button v-if="hiddenCount" class="ws-feed__fold" type="button" @click="visibleLimit += STEP">已折叠 {{ hiddenCount }} 条更早记录 · 点击展开</button>
    <template v-for="entry in visibleEntries" :key="entry.id">
      <div v-if="entry.kind === 'run_started' || entry.kind === 'run_resumed'" class="ws-feed__divider"><span>{{ entry.kind === 'run_resumed' ? '恢复运行' : '开始运行' }}</span><strong>{{ entry.title }}</strong><time>{{ format(entry.at) }}</time></div>
      <div v-else-if="entry.kind === 'user_message'" class="ws-feed__user"><div><p>{{ entry.detail || entry.title }}</p><time>{{ format(entry.at) }}</time></div></div>
      <div v-else-if="entry.kind === 'thought'" class="ws-feed__thought"><small>{{ entry.title }}</small><p v-if="entry.detail">{{ entry.detail }}</p></div>
      <article v-else class="ws-feed__card" :class="[`ws-feed__card--${entry.kind}`, `ws-feed__card--${entry.status}`]">
        <button type="button" class="ws-feed__head" @click="toggle(entry.id)"><span class="ws-feed__state">{{ entry.status === 'running' ? '…' : entry.status === 'failed' ? '×' : '✓' }}</span><span class="ws-feed__badge">{{ entry.agentName || labels[entry.kind] || entry.kind }}</span><strong>{{ entry.title }}</strong><time>{{ format(entry.at) }}</time><span v-if="entry.detail">▾</span></button>
        <p v-if="entry.detail && expanded[entry.id]" class="ws-feed__detail">{{ entry.detail }}</p>
        <p v-else-if="entry.detail" class="ws-feed__preview">{{ entry.detail }}</p>
      </article>
    </template>
    <div v-if="running" class="ws-feed__running"><span />世界推演 Agent 正在工作…</div>
  </div>
</template>
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { WorldSimulationSessionEntry_ACU } from '../../service/simulation/agent/agent-session-log';
const props = defineProps<{ entries: WorldSimulationSessionEntry_ACU[]; running: boolean }>();
const STEP = 40; const visibleLimit = ref(STEP); const expanded = ref<Record<number, boolean>>({}); const feed = ref<HTMLElement | null>(null);
const hiddenCount = computed(() => Math.max(0, props.entries.length - visibleLimit.value));
const visibleEntries = computed(() => hiddenCount.value ? props.entries.slice(hiddenCount.value) : props.entries);
const labels: Record<string, string> = { main_action:'主 Agent',protocol_retry:'纠错',tool_read:'证据读取',delegation:'子代理',stage_plan:'阶段计划',handoff:'交接',finalize:'交付',block:'阻断',run_failed:'失败',run_completed:'完成' };
function toggle(id:number):void{expanded.value={...expanded.value,[id]:!expanded.value[id]};} function format(at:number):string{return new Date(at).toLocaleTimeString();}
watch(() => props.entries.length, async () => { await nextTick(); if (feed.value) feed.value.scrollTop = feed.value.scrollHeight; });
</script>
<style scoped>
.ws-feed{display:flex;flex-direction:column;gap:6px;max-height:420px;overflow:auto;padding:12px;border:1px solid color-mix(in srgb,var(--acu-text-3) 20%,transparent);border-radius:8px;background:color-mix(in srgb,var(--acu-bg-2) 60%,transparent)}.ws-feed__empty,.ws-feed__preview,.ws-feed__detail,.ws-feed__thought p{margin:0;color:var(--acu-text-3);font-size:12px;white-space:pre-wrap}.ws-feed__fold{padding:6px;border:1px dashed var(--acu-border);border-radius:8px;background:transparent;color:var(--acu-text-3)}.ws-feed__divider{display:flex;align-items:center;gap:8px;padding:5px 2px}.ws-feed__divider span,.ws-feed__badge{padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--acu-accent) 15%,transparent);font-size:11px}.ws-feed time{margin-left:auto;color:var(--acu-text-3);font-size:11px}.ws-feed__user{display:flex;justify-content:flex-end}.ws-feed__user>div{max-width:82%;padding:8px 11px;border-radius:10px 10px 2px 10px;background:color-mix(in srgb,var(--acu-accent) 16%,var(--acu-bg-2))}.ws-feed__user p{margin:0;white-space:pre-wrap}.ws-feed__thought{padding-left:10px;border-left:2px solid color-mix(in srgb,var(--acu-text-3) 30%,transparent)}.ws-feed__card{overflow:hidden;border:1px solid color-mix(in srgb,var(--acu-text-3) 16%,transparent);border-radius:8px;background:var(--acu-bg-2)}.ws-feed__card--delegation,.ws-feed__card--tool_read{margin-left:16px}.ws-feed__card--failed,.ws-feed__card--run_failed,.ws-feed__card--block{border-left:3px solid var(--acu-danger)}.ws-feed__card--done.ws-feed__card--finalize,.ws-feed__card--run_completed{border-left:3px solid var(--acu-success)}.ws-feed__head{display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;border:0;background:transparent;color:inherit;text-align:left}.ws-feed__head strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ws-feed__state{width:16px;text-align:center}.ws-feed__preview,.ws-feed__detail{padding:0 10px 8px 34px}.ws-feed__preview{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ws-feed__running{display:flex;align-items:center;gap:8px;padding:6px 10px;color:var(--acu-text-2);font-size:12px}.ws-feed__running span{width:8px;height:8px;border-radius:50%;background:var(--acu-accent);animation:pulse 1.1s infinite}@keyframes pulse{50%{opacity:.3}}@media(max-width:640px){.ws-feed{max-height:62vh;padding:8px}.ws-feed__card--delegation,.ws-feed__card--tool_read{margin-left:8px}}
</style>
