<template>
  <AcuPanel title="世界推演资料维护" description="只编辑当前 active swipe。状态保存经严格账本/投影联合提交；要求保存仅写入独立 sidecar。">
    <div class="world-sim-materials">
      <div class="world-sim-materials__tabs">
        <button v-for="tab in tabs" :key="tab.id" type="button" :class="{ active: activeTab === tab.id }" @click="activeTab = tab.id">{{ tab.label }}</button>
        <AcuButton size="sm" @click="reload()">刷新</AcuButton>
      </div>
      <p v-if="materials.loadError.value" class="world-sim-materials__error">读取资料失败：{{ materials.loadError.value }}。请检查当前聊天后刷新；未保存草稿仍保留在此页面。</p>
      <template v-else-if="activeTab === 'state'">
        <p v-if="!materials.snapshot.value" class="world-sim-materials__empty">当前 active swipe 还没有已结算的世界账本。</p>
        <template v-else>
          <p class="world-sim-materials__meta">锚点第 {{ materials.baseline.value!.anchorMessageIndex + 1 }} 楼 · revision {{ materials.snapshot.value.revisions.entities }}/{{ materials.snapshot.value.revisions.events }}/{{ materials.snapshot.value.revisions.threads }}</p>
          <details v-for="module in modules" :key="module" class="world-sim-materials__block" open>
            <summary>{{ labels[module] }} · {{ materials.snapshot.value[module].length }} 条 <em v-if="materials.modules[module].dirty">未保存</em></summary>
            <ul v-if="materials.snapshot.value[module].length" class="world-sim-materials__cards"><li v-for="item in materials.snapshot.value[module]" :key="item.id"><strong>{{ item.id }}</strong> · {{ itemTitle(module, item) }}<span v-if="item.retired"> · 已撤销</span></li></ul>
            <p v-else class="world-sim-materials__empty">暂无条目。</p>
            <details class="world-sim-materials__editor"><summary>编辑原始 JSON</summary><AcuTextarea :model-value="materials.modules[module].draft" :rows="12" @update:model-value="value => materials.updateDraft(module, value)" /><p v-if="materials.modules[module].error" class="world-sim-materials__error">{{ materials.modules[module].error }}</p><div><AcuButton :disabled="!materials.modules[module].dirty" @click="materials.discard(module)">放弃修改</AcuButton><AcuButton variant="primary" :loading="materials.modules[module].saving" :disabled="!materials.modules[module].dirty" @click="materials.save(module)">保存{{ labels[module] }}</AcuButton></div></details>
          </details>
        </template>
      </template>
<template v-else-if="activeTab === 'requirements'">
        <p class="world-sim-materials__meta">要求按 active swipe 独立保存，不推进世界账本 revision。</p>
        <AcuTextarea :model-value="materials.requirements.draft" :rows="16" @update:model-value="materials.updateRequirementsDraft" />
        <p v-if="materials.requirements.error" class="world-sim-materials__error">{{ materials.requirements.error }}</p><div><AcuButton :disabled="!materials.requirements.dirty" @click="materials.discardRequirements">放弃修改</AcuButton><AcuButton variant="primary" :loading="materials.requirements.saving" :disabled="!materials.requirements.dirty" @click="materials.saveRequirements">保存当前要求</AcuButton></div>
      </template>
      <template v-else><p v-if="!materials.diagnostics.value" class="world-sim-materials__empty">当前没有可显示的回放诊断。</p><dl v-else class="world-sim-materials__diagnostics"><dt>checkpoint</dt><dd>{{ materials.diagnostics.value.checkpointId }}（第 {{ materials.diagnostics.value.checkpointMessageIndex + 1 }} 楼）</dd><dt>delta</dt><dd>{{ materials.diagnostics.value.deltaMessageIndices.length ? materials.diagnostics.value.deltaMessageIndices.map(index => index + 1).join('、') : '无' }}</dd><dt>branch</dt><dd>{{ materials.diagnostics.value.branchReparsed ? '后续分支已自然回退' : '当前回放分支稳定' }}</dd><dt>swipe</dt><dd>{{ materials.baseline.value?.swipe.messageKey ?? '无' }} / {{ materials.baseline.value?.swipe.swipeIndex ?? 0 }}</dd></dl></template>
    </div>
  </AcuPanel>
</template>
<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import type { WorldSimulationMaterialModule_ACU } from '../composables/useWorldSimulationMaterials';
import { useWorldSimulationMaterials, WORLD_SIMULATION_MATERIAL_MODULES_ACU, WORLD_SIMULATION_MATERIAL_MODULE_LABELS_ACU } from '../composables/useWorldSimulationMaterials';
import AcuButton from './_lib/AcuButton.vue'; import AcuPanel from './_lib/AcuPanel.vue'; import AcuTextarea from './_lib/AcuTextarea.vue';
const props = defineProps<{ refreshTick: number }>();
const materials = useWorldSimulationMaterials(); const activeTab = ref<'state' | 'requirements' | 'diagnostics'>('state');
const modules = WORLD_SIMULATION_MATERIAL_MODULES_ACU; const labels = WORLD_SIMULATION_MATERIAL_MODULE_LABELS_ACU; const tabs = [{ id: 'state', label: '世界状态' }, { id: 'requirements', label: '当前要求' }, { id: 'diagnostics', label: '回放诊断' }] as const;
function itemTitle(module: WorldSimulationMaterialModule_ACU, item: any): string { return module === 'entities' ? `${item.name} · ${item.situation}` : module === 'events' ? `${item.summary} · ${item.occurredAt}` : `${item.title} · ${item.summary}`; }
function reload(options: { preserveDirty?: boolean } = {}): void { materials.reload(options); }
onMounted(() => reload()); watch(() => props.refreshTick, () => reload({ preserveDirty: true })); defineExpose({ reload });
</script>
<style scoped>
.world-sim-materials{display:grid;gap:10px}.world-sim-materials__tabs{display:flex;flex-wrap:wrap;gap:6px}.world-sim-materials__tabs button{border:1px solid color-mix(in srgb,var(--acu-text-3) 25%,transparent);border-radius:999px;background:transparent;color:var(--acu-text-2);padding:4px 10px;cursor:pointer}.world-sim-materials__tabs button.active{color:var(--acu-text-1);border-color:var(--acu-primary,#5b8def)}.world-sim-materials__tabs .acu-btn{margin-left:auto}.world-sim-materials__block{display:grid;gap:8px;padding:9px;border:1px solid color-mix(in srgb,var(--acu-text-3) 20%,transparent);border-radius:7px}.world-sim-materials__block summary,.world-sim-materials__editor summary{cursor:pointer}.world-sim-materials__cards{display:grid;gap:4px;margin:0;padding-left:20px;color:var(--acu-text-2);font-size:12px}.world-sim-materials__cards strong{color:var(--acu-text-1)}.world-sim-materials__editor{display:grid;gap:7px}.world-sim-materials__editor>div,.world-sim-materials>div{display:flex;gap:7px;justify-content:flex-end}.world-sim-materials__meta,.world-sim-materials__empty,.world-sim-materials__error{margin:0;color:var(--acu-text-3);font-size:12px;white-space:pre-wrap}.world-sim-materials__error{color:var(--acu-danger,#d65b5b)}em{font-style:normal;color:var(--acu-primary,#5b8def)}.world-sim-materials__diagnostics{display:grid;grid-template-columns:max-content 1fr;gap:6px;margin:0;color:var(--acu-text-2);font-size:12px}.world-sim-materials__diagnostics dt{color:var(--acu-text-3)}.world-sim-materials__diagnostics dd{margin:0}
</style>
