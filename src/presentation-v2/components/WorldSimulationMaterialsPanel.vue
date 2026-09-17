<template>
  <div class="ws-materials">
    <div class="ws-materials__tabs"><button v-for="tab in tabs" :key="tab.id" type="button" :class="{active:activeTab===tab.id}" @click="activeTab=tab.id">{{ tab.label }}</button></div>
    <template v-if="activeTab==='state'">
      <p v-if="!materials.snapshot" class="muted">当前 active swipe 还没有已结算的世界账本。</p>
      <template v-else>
        <div class="ws-materials__overview"><div><strong>结算位置</strong><span>第 {{ (materials.adoptedIndex ?? 0)+1 }} 楼</span></div><div><strong>账本修订</strong><span>revision {{ materials.snapshot.ledgerRevision }}</span></div><div><strong>证据引用</strong><span>{{ materials.snapshot.evidenceRefs.length }} 条</span></div></div>
        <section v-for="group in ledgerGroups" :key="group.key"><header><strong>{{ group.label }}</strong><span>{{ group.items.length }} 条</span></header><p v-if="!group.items.length" class="muted">暂无记录。</p><div v-else class="ws-materials__cards"><article v-for="item in group.items" :key="item.id"><strong>{{ item.title }}</strong><p>{{ item.detail }}</p></article></div></section>
      </template>
    </template>
    <template v-else-if="activeTab==='conversation'">
      <p v-if="!conversation.messages.length" class="muted">还没有持久化的 Agent 会话材料。</p>
      <ol v-else class="ws-materials__timeline"><li v-for="item in conversation.messages" :key="`${item.id}:${item.at}`"><span>{{ kindLabel(item.kind) }}</span><div><strong>{{ item.digest || `消息 ${item.id}` }}</strong><p>{{ item.text }}</p><small>{{ item.turnKey }}</small></div></li></ol>
    </template>
    <template v-else-if="activeTab==='candidates'">
      <p v-if="!candidateEntries.length" class="muted">暂无候选、派工或终审记录。</p><div v-else class="ws-materials__cards"><article v-for="item in candidateEntries" :key="item.id"><header><strong>{{ item.title }}</strong><span>{{ item.agentName || kindLabel(item.kind) }}</span></header><p>{{ item.detail }}</p></article></div>
    </template>
    <template v-else><p v-if="!diagnostics.length" class="muted">当前没有读取诊断。</p><ul v-else class="ws-materials__diagnostics"><li v-for="item in diagnostics" :key="item">{{ item }}</li></ul></template>
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import type { WorldSimulationConversationView_ACU, WorldSimulationMaterialsReadResult_ACU } from '../../service/simulation/agent/agent-model';
import type { WorldSimulationSessionEntry_ACU } from '../../service/simulation/agent/agent-session-log';
const props=defineProps<{conversation:WorldSimulationConversationView_ACU;materials:WorldSimulationMaterialsReadResult_ACU;session:WorldSimulationSessionEntry_ACU[]}>();
const activeTab=ref<'state'|'conversation'|'candidates'|'diagnostics'>('state');
const tabs=[{id:'state',label:'世界状态'},{id:'conversation',label:'Agent 会话'},{id:'candidates',label:'候选轨迹'},{id:'diagnostics',label:'读取诊断'}] as const;
const candidateEntries=computed(()=>props.session.filter(item=>['delegation','finalize','block','stage_plan'].includes(item.kind)));
const diagnostics=computed(()=>[...props.conversation.diagnostics,...props.materials.diagnostics]);
const ledgerGroups=computed(()=>{const ledger=props.materials.snapshot?.ledger;if(!ledger)return[];return[
  {key:'dimensions',label:'世界维度',items:ledger.dimensions.map(x=>({id:x.id,title:`${x.name} · ${x.value} / ${x.trend}`,detail:x.rationale}))},
  {key:'seeds',label:'世界种子',items:ledger.seeds.map(x=>({id:x.id,title:`${x.title} · ${x.status}`,detail:`强度 ${x.level} · ${x.catalyst}`}))},
  {key:'actors',label:'行动者',items:ledger.actors.map(x=>({id:x.id,title:x.name,detail:`位置：${x.location||'未知'} · 目标：${x.goals.join('、')||'无'}`}))},
  {key:'chronicle',label:'世界编年',items:ledger.chronicle.map(x=>({id:x.id,title:x.at,detail:x.summary}))},
]});
function kindLabel(kind:string):string{return({user:'你',agent:'Agent',tool:'工具',runtime:'运行',turn:'轮次',handoff:'交接',delegation:'子代理',finalize:'终审',block:'阻断',stage_plan:'阶段计划'} as Record<string,string>)[kind]??kind;}
</script>
<style scoped>
.ws-materials{display:grid;gap:12px}.ws-materials__tabs{display:flex;flex-wrap:wrap;gap:6px}.ws-materials__tabs button{padding:5px 12px;border:1px solid color-mix(in srgb,var(--acu-text-3) 25%,transparent);border-radius:999px;background:transparent;color:var(--acu-text-2)}.ws-materials__tabs button.active{background:color-mix(in srgb,var(--acu-accent) 14%,transparent);border-color:var(--acu-accent);color:var(--acu-text-1)}.ws-materials__overview{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.ws-materials__overview>div,section,.ws-materials__cards article{display:grid;gap:5px;padding:10px;border:1px solid color-mix(in srgb,var(--acu-text-3) 20%,transparent);border-radius:7px}.ws-materials__overview span,section header span,.muted,small{color:var(--acu-text-3);font-size:12px}section header,.ws-materials__cards article header{display:flex;justify-content:space-between;gap:8px}.ws-materials__cards{display:grid;gap:8px}.ws-materials p{margin:0;white-space:pre-wrap}.ws-materials__timeline{display:grid;gap:8px;margin:0;padding:0;list-style:none}.ws-materials__timeline li{display:flex;gap:9px}.ws-materials__timeline li>span{align-self:start;padding:2px 8px;border-radius:999px;background:var(--acu-bg-2);font-size:11px}.ws-materials__timeline li>div{flex:1;padding:8px;border-left:2px solid color-mix(in srgb,var(--acu-accent) 40%,transparent)}.ws-materials__diagnostics{margin:0;padding:10px 10px 10px 28px;border:1px solid var(--acu-border);border-radius:7px;color:var(--acu-text-2);font-size:12px}@media(max-width:640px){.ws-materials__overview{grid-template-columns:1fr}}
</style>
