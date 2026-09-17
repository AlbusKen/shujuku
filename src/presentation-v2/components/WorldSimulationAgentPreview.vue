<template>
  <AcuPanel title="当前 active swipe 世界账本资料" description="只读回放当前分支；默认隐藏 hidden 条目，不会写回账本、会话或正文。">
    <div class="world-sim-preview">
      <div class="world-sim-preview__actions"><span>{{ summary }}</span><AcuButton size="sm" @click="emit('refresh')">刷新资料</AcuButton></div>
      <p v-if="!ledger">当前分支还没有已结算的世界账本。</p>
      <template v-else>
        <p>锚点：{{ anchor ? `第 ${anchor.messageIndex + 1} 楼 · swipe ${Number(anchor.swipeId) + 1}` : '当前未解析到 assistant 锚点' }}</p>
        <div class="world-sim-preview__overview">
          <div><strong>revision</strong><span>{{ ledger.revision }}</span></div>
          <div><strong>故事时间</strong><span>{{ ledger.clock.storyTime || '未知' }}</span></div>
          <div><strong>经过</strong><span>{{ ledger.clock.elapsed || '未知' }}</span></div>
        </div>
        <section v-for="group in groups" :key="group.key" class="world-sim-preview__group">
          <strong>{{ group.label }} · {{ group.items.length }}</strong>
          <p v-if="!group.items.length">暂无可显示条目。</p>
          <ul v-else><li v-for="item in group.items" :key="item.id"><strong>{{ item.title }}</strong><span>{{ item.detail }}</span></li></ul>
        </section>
        <details class="world-sim-preview__projection"><summary>Projection preview</summary><pre>{{ projectionPreview || '当前没有系统投影。' }}</pre></details>
        <details v-if="diagnostics.length" class="world-sim-preview__diagnostics"><summary>读取诊断 · {{ diagnostics.length }}</summary><ul><li v-for="item in diagnostics" :key="item">{{ item }}</li></ul></details>
      </template>
    </div>
  </AcuPanel>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { WorldSimulationAnchorIdentity_ACU } from '../../service/simulation/agent/agent-model';
import type { WorldSimulationLedger_ACU } from '../../service/simulation/model';
import AcuButton from './_lib/AcuButton.vue';
import AcuPanel from './_lib/AcuPanel.vue';

const props = withDefaults(defineProps<{
  ledger: WorldSimulationLedger_ACU | null;
  anchor: WorldSimulationAnchorIdentity_ACU | null;
  diagnostics?: string[];
  showHidden?: boolean;
  projectionPreview?: string | null;
}>(), { diagnostics: () => [], showHidden: false });
const emit = defineEmits<{ (event: 'refresh'): void }>();
const summary = computed(() => props.showHidden ? '已显示 hidden 条目。' : 'hidden 条目默认不显示。');
const visible = (visibility: string): boolean => props.showHidden || visibility !== 'hidden';
const groups = computed(() => {
  const ledger = props.ledger;
  if (!ledger) return [];
  return [
    { key: 'dimensions', label: '世界维度', items: ledger.dimensions.map(item => ({ id: item.id, title: item.name, detail: `${item.value} / ${item.trend} · ${item.rationale || '暂无依据摘要'}` })) },
    { key:'seeds', label: '世界种子', items: ledger.seeds.filter(item => visible(item.visibility)).map(item => ({ id: item.id, title: item.title, detail: `${item.status} · L${item.level} · ${item.catalyst || '暂无催化条件'}` })) },
    { key: 'actors', label: '行动者', items: ledger.actors.filter(item => visible(item.visibility)).map(item => ({ id: item.id, title: item.name, detail: `位置：${item.location || '未知'} · 目标：${item.goals.join('、') || '无'}` })) },
    { key: 'chronicle', label: '世界编年', items: ledger.chronicle.map(item => ({ id: item.id, title: item.at, detail: item.summary })) },
  ];
});
</script>

<style scoped>
.world-sim-preview{display:grid;gap:10px}.world-sim-preview__actions{display:flex;gap:8px;align-items:center;color:var(--acu-text-3);font-size:12px}.world-sim-preview__actions span{margin-right:auto}.world-sim-preview p{margin:0;color:var(--acu-text-3);font-size:12px}.world-sim-preview__overview{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.world-sim-preview__overview>div,.world-sim-preview__group,.world-sim-preview__diagnostics,.world-sim-preview__projection{display:grid;gap:6px;padding:9px;border:1px solid color-mix(in srgb,var(--acu-text-3) 18%,transparent);border-radius:7px}.world-sim-preview__overview span,.world-sim-preview li span{color:var(--acu-text-2);font-size:12px}.world-sim-preview ul{display:grid;gap:5px;margin:0;padding:0;list-style:none}.world-sim-preview li{display:grid;gap:2px}.world-sim-preview__projection summary{cursor:pointer}.world-sim-preview__projection pre{max-height:260px;overflow:auto;margin:6px 0 0;padding:10px;border-radius:8px;background:var(--acu-bg-2);white-space:pre-wrap;word-break:break-word}@media(max-width:640px){.world-sim-preview__overview{grid-template-columns:1fr}}
</style>
