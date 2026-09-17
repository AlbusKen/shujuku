<template>
  <div class="ws-feed">
    <p v-if="!entries.length" class="ws-muted">暂无运行记录。只有成功读取后的空状态才会显示这里。</p>
    <article v-for="entry in entries" :key="entry.id" class="ws-entry" :class="`ws-entry--${entry.status}`">
      <header><strong>{{ labels[entry.kind] ?? entry.kind }}</strong><span>{{ entry.title }}</span><time>{{ format(entry.at) }}</time></header>
      <p v-if="entry.detail">{{ entry.detail }}</p>
      <small v-if="entry.agentName">{{ entry.agentName }}</small>
    </article>
    <p v-if="running" class="ws-running">主 Agent 正在运行…</p>
  </div>
</template>
<script setup lang="ts">
import type { WorldSimulationSessionEntry_ACU } from '../../service/simulation/agent/agent-session-log';
defineProps<{ entries: WorldSimulationSessionEntry_ACU[]; running: boolean }>();
const labels: Record<string, string> = { run_started: '开始', run_resumed: '恢复', user_message: '用户', thought: '思考', main_action: '主 Agent', protocol_retry: '协议纠错', tool_read: '证据读取', delegation: '派工', stage_plan: '阶段计划', handoff: '交接', finalize: '候选终审', block: '阻断', run_failed: '失败', run_completed: '完成' };
const format = (at: number) => new Date(at).toLocaleTimeString();
</script>
<style scoped>
.ws-feed{display:grid;gap:8px;max-height:430px;overflow:auto}.ws-entry{padding:9px;border:1px solid color-mix(in srgb,var(--acu-text-3) 22%,transparent);border-radius:8px;background:var(--acu-bg-2)}.ws-entry--failed{border-left:3px solid var(--acu-danger,#d65b5b)}.ws-entry--running{border-left:3px solid var(--acu-primary,#5b8def)}header{display:flex;gap:8px;align-items:center}time{margin-left:auto;color:var(--acu-text-3);font-size:11px}p{margin:5px 0;white-space:pre-wrap}.ws-muted,small{color:var(--acu-text-3)}.ws-running{color:var(--acu-primary,#5b8def)}
</style>
