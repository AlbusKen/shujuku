<template>
  <div class="acu-v2-ws-materials">
    <div class="acu-v2-ws-materials__tabs">
      <button
        v-for="tab in TABS"
        :key="tab.id"
        type="button"
        class="acu-v2-ws-materials__tab"
        :class="{ 'acu-v2-ws-materials__tab--active': activeTab === tab.id }"
        @click="activeTab = tab.id"
      >{{ tab.label }}</button>
      <div class="acu-v2-ws-materials__tab-actions">
        <AcuButton @click="emit('refresh')">刷新</AcuButton>
      </div>
    </div>

    <!-- 世界状态：结算概览 + 分模块卡片，与 ContinuationMaterialsPanel 同一套视觉结构 -->
    <template v-if="activeTab === 'state'">
      <p v-if="!materials.snapshot" class="acu-v2-ws-materials__empty">当前 active swipe 还没有已结算的世界账本。</p>
      <template v-else>
        <div class="acu-v2-ws-materials__overview">
          <div><strong>结算位置</strong><span>第 {{ (materials.adoptedIndex ?? 0) + 1 }} 楼</span></div>
          <div><strong>账本修订</strong><span>revision {{ materials.snapshot.ledgerRevision }}</span></div>
          <div><strong>证据引用</strong><span>{{ materials.snapshot.evidenceRefs.length }} 条</span></div>
        </div>
        <details v-for="group in ledgerGroups" :key="group.key" class="acu-v2-ws-materials__block" open>
          <summary>{{ group.label }} · {{ group.items.length }} 条</summary>
          <p v-if="!group.items.length" class="acu-v2-ws-materials__empty">暂无记录。</p>
          <div v-else class="acu-v2-ws-materials__cards">
          <article v-for="item in group.items" :key="item.id" class="acu-v2-ws-materials__card">
            <p class="acu-v2-ws-materials__card-head"><strong>{{ item.title }}</strong></p>
            <p class="acu-v2-ws-materials__card-body">{{ item.detail }}</p>
          </article>
          </div>
        </details>
      </template>
    </template>

    <!-- Agent 会话：复用与会话主面板同一个 SessionFeed，持久会话消息投影成同构条目 -->
    <template v-else-if="activeTab === 'conversation'">
      <WorldSimulationSessionFeed v-if="conversationEntries.length" :entries="conversationEntries" :running="false" />
      <p v-else class="acu-v2-ws-materials__empty">还没有持久化的 Agent 会话材料。</p>
    </template>

    <!-- 候选轨迹：派工 / 阶段计划 / 交付 / 阻断，卡片结构与续写资料面板一致 -->
    <template v-else-if="activeTab === 'candidates'">
      <p v-if="!candidateEntries.length" class="acu-v2-ws-materials__empty">暂无候选、派工或终审记录。</p>
      <div v-else class="acu-v2-ws-materials__cards">
        <article v-for="item in candidateEntries" :key="item.id" class="acu-v2-ws-materials__card">
          <p class="acu-v2-ws-materials__card-head"><strong>{{ item.title }}</strong><span>{{ agentLabel(item) }}</span></p>
          <p class="acu-v2-ws-materials__card-body">{{ item.detail }}</p>
        </article>
      </div>
    </template>

    <!-- 读取诊断 -->
    <template v-else>
      <p v-if="!diagnostics.length" class="acu-v2-ws-materials__empty">当前没有读取诊断。</p>
      <ul v-else class="acu-v2-ws-materials__diagnostics"><li v-for="item in diagnostics" :key="item">{{ item }}</li></ul>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import AcuButton from './_lib/AcuButton.vue';
import WorldSimulationSessionFeed from './WorldSimulationSessionFeed.vue';
import type { WorldSimulationConversationView_ACU, WorldSimulationMaterialsReadResult_ACU } from '../../service/simulation/agent/agent-model'; // arch-ok: 仅类型导入，用于 props 标注，编译后无运行时依赖
import type { WorldSimulationSessionEntry_ACU } from '../../service/simulation/agent/agent-session-log'; // arch-ok: 仅类型导入，用于 props 标注，编译后无运行时依赖

const props = defineProps<{
  conversation: WorldSimulationConversationView_ACU;
  materials: WorldSimulationMaterialsReadResult_ACU;
  session: WorldSimulationSessionEntry_ACU[];
}>();
const emit = defineEmits<{ (event: 'refresh'): void }>();

const TABS = [
  { id: 'state', label: '世界状态' },
  { id: 'conversation', label: 'Agent 会话' },
  { id: 'candidates', label: '候选轨迹' },
  { id: 'diagnostics', label: '读取诊断' },
] as const;

type TabId = typeof TABS[number]['id'];
const activeTab = ref<TabId>('state');

const diagnostics = computed(() => [...props.conversation.diagnostics, ...props.materials.diagnostics]);

/** 持久会话消息（user/agent/runtime/tool/turn/handoff）投影成会话流条目，与主面板同构展示。 */
const conversationEntries = computed(() => props.conversation.messages.map((message, index) => ({
  id: index + 1,
  at: message.at,
  kind: (message.kind === 'user' ? 'user_message'
    : message.kind === 'handoff' ? 'handoff'
    : message.kind === 'turn' ? 'run_started'
    : 'tool_read') as WorldSimulationSessionEntry_ACU['kind'],
  title: message.digest || '会话材料',
  detail: message.text,
  agentName: '',
  ok: true,
  status: 'done' as const,
})));

const candidateEntries = computed(() => props.session.filter(item => ['delegation', 'finalize', 'block', 'stage_plan'].includes(item.kind)));

function agentLabel(item: WorldSimulationSessionEntry_ACU): string {
  return item.agentName || '主 Agent';
}

const ledgerGroups = computed(() => {
  const ledger = props.materials.snapshot?.ledger;
  if (!ledger) return [];
  return [
    { key: 'dimensions', label: '世界维度', items: ledger.dimensions.map(x => ({ id: x.id, title: `${x.name} · ${x.value} / ${x.trend}`, detail: x.rationale })) },
    { key: 'seeds', label: '世界种子', items: ledger.seeds.map(x => ({ id: x.id, title: `${x.title} · ${x.status}`, detail: `强度 ${x.level} · ${x.catalyst}` })) },
    { key: 'actors', label: '行动者', items: ledger.actors.map(x => ({ id: x.id, title: x.name, detail: `位置：${x.location || '未知'} · 目标：${x.goals.join('、') || '无'}` })) },
    { key: 'chronicle', label: '世界编年', items: ledger.chronicle.map(x => ({ id: x.id, title: x.at, detail: x.summary })) },
  ];
});
</script>

<style scoped>
/* 与 ContinuationMaterialsPanel 保持同一套视觉语言：页签行、概览块、卡片、诊断列表。 */
.acu-v2-ws-materials { display: grid; gap: 12px; }
.acu-v2-ws-materials__tabs { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.acu-v2-ws-materials__tab { padding: 5px 12px; border: 1px solid color-mix(in srgb, var(--acu-text-3) 22%, transparent); border-radius: 999px; background: transparent; color: var(--acu-text-2); cursor: pointer; font: inherit; font-size: var(--acu-font-size-body, 12px); }
.acu-v2-ws-materials__tab--active { border-color: color-mix(in srgb, var(--acu-primary, #5b8def) 55%, transparent); background: color-mix(in srgb,var(--acu-primary, #5b8def) 14%, transparent); color: var(--acu-text-1); }
.acu-v2-ws-materials__tab-actions { display: flex; gap: 6px; margin-left: auto; }
.acu-v2-ws-materials__overview { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.acu-v2-ws-materials__overview > div { display: grid; gap: 5px; padding: 10px; border: 1px solid color-mix(in srgb, var(--acu-text-3) 20%, transparent); border-radius: 7px; }
.acu-v2-ws-materials__overview span { color: var(--acu-text-3); font-size: 12px; }
.acu-v2-ws-materials__block { padding: 10px; border: 1px solid color-mix(in srgb, var(--acu-text-3) 20%, transparent); border-radius: 7px; display: grid; gap: 8px; }
.acu-v2-ws-materials__block > summary { cursor: pointer; color: var(--acu-text-1); font-size: var(--acu-font-size-body, 12px); }
.acu-v2-ws-materials__cards { display: grid; gap: 8px; }
.acu-v2-ws-materials__card { display: grid; gap: 4px; padding: 8px 10px; border: 1px solid color-mix(in srgb, var(--acu-text-3) 16%, transparent); border-radius: 7px; }
.acu-v2-ws-materials__card-head { margin: 0; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; color: var(--acu-text-1); font-size: var(--acu-font-size-body, 12px); }
.acu-v2-ws-materials__card-head span { color: var(--acu-text-3); font-size: 11px; }
.acu-v2-ws-materials__card-body { margin: 0; color: var(--acu-text-2); font-size: var(--acu-font-size-body, 12px); white-space: pre-wrap; word-break: break-word; }
.acu-v2-ws-materials__empty { margin: 0; color: var(--acu-text-3); font-size: var(--acu-font-size-body, 12px); }
.acu-v2-ws-materials__diagnostics { margin: 0; padding: 10px 10px 10px 28px; border: 1px solid color-mix(in srgb, var(--acu-text-3) 20%, transparent); border-radius: 7px; color: var(--acu-text-2); font-size: var(--acu-font-size-body, 12px); }
@media (max-width: 640px) { .acu-v2-ws-materials__overview { grid-template-columns: 1fr; } }
</style>
