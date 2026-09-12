<template>
  <AcuPanel title="当前 active swipe 世界账本资料" description="只读回放当前分支；默认不显示 hidden 条目，也不会写回任何账本或正文。">
    <div class="world-sim-preview">
      <div class="world-sim-preview__actions"><span>{{ summary }}</span><AcuButton size="sm" @click="refresh">刷新资料</AcuButton></div>
      <p v-if="preview.kind === 'empty'">当前分支还没有已结算的世界账本。</p>
      <p v-else-if="preview.kind === 'failed'" class="world-sim-preview__error">读取账本失败：{{ preview.message }}</p>
      <template v-else>
        <p>锚点：第 {{ preview.anchorMessageIndex + 1 }} 楼<span v-if="preview.branchReparsed"> · 后续分支已自然回退</span></p>
        <section v-for="group in groups" :key="group.key" class="world-sim-preview__group">
          <strong>{{ group.label }} · {{ group.items.length }}</strong>
          <p v-if="!group.items.length">暂无可显示条目。</p>
          <ul v-else><li v-for="item in group.items" :key="item.id"><strong>{{ item.title }}</strong><span>{{ item.detail }}</span></li></ul>
        </section>
      </template>
    </div>
  </AcuPanel>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { readWorldSimulationAgentPreview_ACU, type WorldSimulationAgentPreview_ACU } from '../../service/simulation/world-simulation-agent-preview';
import { useChatChangedTick } from '../composables/useChatChangedListener';
import AcuButton from './_lib/AcuButton.vue';
import AcuPanel from './_lib/AcuPanel.vue';

const props = withDefaults(defineProps<{ showHidden?: boolean }>(), { showHidden: false });
const preview = ref<WorldSimulationAgentPreview_ACU>({ kind: 'empty' });
const summary = computed(() => props.showHidden ? '已按已保存设置显示 hidden 条目。' : 'hidden 条目默认不显示。');
const groups = computed(() => preview.value.kind !== 'ready' ? [] : [
  { key: 'entities', label: '实体', items: preview.value.state.entities.map(item => ({ id: item.id, title: item.name, detail: item.situation })) },
  { key: 'events', label: '事件', items: preview.value.state.events.map(item => ({ id: item.id, title: item.summary, detail: item.occurredAt })) },
  { key: 'threads', label: '线索', items: preview.value.state.threads.map(item => ({ id: item.id, title: item.title, detail: item.summary })) },
]);
function refresh(): void { preview.value = readWorldSimulationAgentPreview_ACU(undefined, undefined, { showHidden: props.showHidden }); }
onMounted(refresh);
watch(useChatChangedTick(), refresh);
watch(() => props.showHidden, refresh);
defineExpose({ refresh });
</script>

<style scoped>
.world-sim-preview{display:grid;gap:10px}.world-sim-preview__actions{display:flex;gap:8px;align-items:center;color:var(--acu-text-3);font-size:12px}.world-sim-preview__actions span{margin-right:auto}.world-sim-preview p{margin:0;color:var(--acu-text-3);font-size:12px}.world-sim-preview__group{display:grid;gap:6px;padding:9px;border:1px solid color-mix(in srgb,var(--acu-text-3) 18%,transparent);border-radius:7px}.world-sim-preview ul{display:grid;gap:5px;margin:0;padding:0;list-style:none}.world-sim-preview li{display:grid;gap:2px}.world-sim-preview li span{font-size:12px;color:var(--acu-text-2)}.world-sim-preview__error{color:var(--acu-danger)!important}
</style>
