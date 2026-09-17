<template>
  <div class="ws-ledger">
    <p v-if="!ledger" class="muted">尚未建立世界账本。</p>
    <template v-else>
      <div class="summary"><strong>revision {{ ledger.revision }}</strong><span>时间：{{ ledger.clock.storyTime || '未知' }}</span><span>经过：{{ ledger.clock.elapsed || '未知' }}</span><span>精度：{{ ledger.clock.precision }}</span></div>
      <details open><summary>维度（{{ ledger.dimensions.length }}）</summary><ul><li v-for="item in ledger.dimensions" :key="item.id"><strong>{{ item.name }}</strong> {{ item.value }} / {{ item.trend }}<small>{{ item.rationale }} · evidence {{ item.evidenceRefs.join(', ') || '无' }}</small></li></ul></details>
      <details open><summary>种子（{{ ledger.seeds.length }}）</summary><ul><li v-for="item in ledger.seeds" :key="item.id"><strong>{{ item.title }}</strong> · {{ item.status }} · L{{ item.level }}<small>{{ item.catalyst }} · evidence {{ item.evidenceRefs.join(', ') || '无' }}</small></li></ul></details>
      <details><summary>角色（{{ ledger.actors.length }}）</summary><ul><li v-for="item in ledger.actors" :key="item.id"><strong>{{ item.name }}</strong> · {{ item.location }}<small>目标：{{ item.goals.join('、') || '无' }}；已知：{{ item.knownFacts.join('、') || '无' }}</small></li></ul></details>
      <details open><summary>编年（{{ ledger.chronicle.length }}）</summary><ol><li v-for="item in ledger.chronicle" :key="item.id"><strong>{{ item.at }}</strong> {{ item.summary }}<small>evidence {{ item.evidenceRefs.join(', ') || '无' }}</small></li></ol></details>
      <details open><summary>安全 guidance</summary><ul><li v-for="item in ledger.guidance.signals" :key="item">{{ item }}</li></ul><p v-if="!ledger.guidance.signals.length" class="muted">无可投影信号。</p></details>
      <details><summary>Projection preview</summary><pre>{{ projectionPreview || '当前没有系统投影。' }}</pre></details>
    </template>
  </div>
</template>
<script setup lang="ts">
import type { WorldSimulationLedger_ACU } from '../../service/simulation/model';
defineProps<{ledger:WorldSimulationLedger_ACU|null;projectionPreview:string|null}>();
</script>
<style scoped>
.ws-ledger{display:grid;gap:10px}.summary{display:flex;flex-wrap:wrap;gap:10px}.muted,small{color:var(--acu-text-3)}ul,ol{margin:6px 0;padding-left:20px}li{margin:5px 0}small{display:block;white-space:pre-wrap}pre{max-height:260px;overflow:auto;padding:10px;border-radius:8px;background:var(--acu-bg-2);white-space:pre-wrap;word-break:break-word}
</style>
