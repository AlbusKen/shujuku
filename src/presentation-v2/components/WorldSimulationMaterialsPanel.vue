<template>
  <AcuPanel title="世界推演资料维护" description="查看和修正当前 active swipe 的世界状态、执行要求与回放来源。保存前会进行严格校验，未保存草稿不会被刷新覆盖。">
    <div class="world-sim-materials">
      <div class="world-sim-materials__tabs">
        <button v-for="tab in tabs" :key="tab.id" type="button" class="world-sim-materials__tab" :class="{ 'world-sim-materials__tab--active': activeTab === tab.id }" @click="activeTab = tab.id">{{ tab.label }}</button>
        <AcuButton size="sm" @click="reload()">刷新</AcuButton>
      </div>
      <p v-if="materials.loadError.value" class="world-sim-materials__error">读取资料失败：{{ materials.loadError.value }}。请检查当前聊天后刷新；未保存草稿仍保留在此页面。</p>
      <template v-else-if="activeTab === 'state'">
        <p v-if="!materials.snapshot.value" class="world-sim-materials__empty">当前 active swipe 还没有已结算的世界账本。</p>
        <template v-else>
          <section class="world-sim-materials__overview">
            <div><strong>结算位置</strong><span>第 {{ materials.baseline.value!.anchorMessageIndex + 1 }} 楼 · 当前 swipe {{ materials.baseline.value!.swipe.swipeIndex + 1 }}</span></div>
            <div><strong>世界状态修订</strong><span>实体 {{ materials.snapshot.value.revisions.entities }} · 事件 {{ materials.snapshot.value.revisions.events }} · 线索 {{ materials.snapshot.value.revisions.threads }}</span></div>
            <div><strong>故事时间</strong><span>{{ materials.snapshot.value.storyClock.anchorText }} · {{ materials.snapshot.value.storyClock.elapsedSinceLastRun }} · {{ clockPrecision(materials.snapshot.value.storyClock.precision) }}</span></div>
          </section>
          <details v-for="module in modules" :key="module" class="world-sim-materials__block" open>
            <summary>{{ labels[module] }} · {{ materials.snapshot.value[module].length }} 条 <span v-if="materials.modules[module].dirty" class="world-sim-materials__badge">未保存</span></summary>
            <p v-if="!materials.snapshot.value[module].length" class="world-sim-materials__empty">{{ emptyHint(module) }}</p>
            <div v-else class="world-sim-materials__cards">
              <article v-for="item in materials.snapshot.value[module]" :key="item.id" class="world-sim-materials__card" :class="{ 'world-sim-materials__card--retired': item.retired }">
                <header><strong>{{ item.id }}</strong><span class="world-sim-materials__badge">{{ itemKind(module, item) }}</span><span class="world-sim-materials__badge">{{ visibility(item.visibility) }}</span><span v-if="item.retired" class="world-sim-materials__badge">已撤销</span></header>
                <p>{{ itemTitle(module, item) }}</p>
                <p class="world-sim-materials__card-meta">{{ itemDetail(module, item) }}</p>
                <p v-if="item.retiredReason" class="world-sim-materials__card-meta">撤销原因：{{ item.retiredReason }}</p>
              </article>
            </div>
            <details class="world-sim-materials__editor"><summary>高级编辑：原始 JSON</summary><p>适合批量修正完整领域对象。既有条目不可直接删除；需要停止追踪时标记为 retired 并填写原因。</p><AcuTextarea :model-value="materials.modules[module].draft" :rows="12" @update:model-value="value => materials.updateDraft(module, value)" /><p v-if="materials.modules[module].error" class="world-sim-materials__error">{{ materials.modules[module].error }}</p><div class="world-sim-materials__actions"><AcuButton :disabled="!materials.modules[module].dirty" @click="materials.discard(module)">放弃修改</AcuButton><AcuButton variant="primary" :loading="materials.modules[module].saving" :disabled="!materials.modules[module].dirty" @click="materials.save(module)">保存{{ labels[module] }}</AcuButton></div></details>
          </details>
        </template>
      </template>
      <template v-else-if="activeTab === 'requirements'">
        <p class="world-sim-materials__meta">当前要求是这条 active swipe 的执行口径；它独立保存，不推进世界状态 revision。来源引用必须对应真实用户输入。</p>
        <p v-if="!requirementItems.length" class="world-sim-materials__empty">还没有已维护的当前要求。世界推演收到用户补充后，会先建立这份执行口径。</p>
        <div v-else class="world-sim-materials__cards">
          <article v-for="item in requirementItems" :key="item.id" class="world-sim-materials__card">
            <header><strong>{{ item.id }}</strong><span class="world-sim-materials__badge">{{ category(item.category) }}</span><span class="world-sim-materials__badge">{{ item.priority === 'hard' ? '硬约束' : '普通' }}</span></header>
            <p>{{ item.text }}</p><p class="world-sim-materials__card-meta">来源：{{ item.sourceRefs?.join('、') || '未记录' }}</p>
          </article>
        </div>
        <details class="world-sim-materials__editor"><summary>高级编辑：当前要求 JSON</summary><p>保存会以当前 active swipe 的最新用户输入作为维护水位，并校验每条来源引用。</p><AcuTextarea :model-value="materials.requirements.draft" :rows="16" @update:model-value="materials.updateRequirementsDraft" /><p v-if="materials.requirements.error" class="world-sim-materials__error">{{ materials.requirements.error }}</p><div class="world-sim-materials__actions"><AcuButton :disabled="!materials.requirements.dirty" @click="materials.discardRequirements">放弃修改</AcuButton><AcuButton variant="primary" :loading="materials.requirements.saving" :disabled="!materials.requirements.dirty" @click="materials.saveRequirements">保存当前要求</AcuButton></div></details>
      </template>
      <template v-else><p v-if="!materials.diagnostics.value" class="world-sim-materials__empty">当前没有可显示的回放诊断。</p><dl v-else class="world-sim-materials__diagnostics"><dt>检查点</dt><dd>{{ materials.diagnostics.value.checkpointId }}（第 {{ materials.diagnostics.value.checkpointMessageIndex + 1 }} 楼）</dd><dt>增量楼层</dt><dd>{{ materials.diagnostics.value.deltaMessageIndices.length ? materials.diagnostics.value.deltaMessageIndices.map(index => `第 ${index + 1} 楼`).join('、') : '无' }}</dd><dt>分支状态</dt><dd>{{ materials.diagnostics.value.branchReparsed ? '后续分支已自然回退到当前 swipe' : '当前回放分支稳定' }}</dd><dt>当前页面</dt><dd>{{ materials.baseline.value?.swipe.messageKey ?? '无' }} · swipe {{ (materials.baseline.value?.swipe.swipeIndex ?? 0) + 1 }}</dd></dl></template>
    </div>
  </AcuPanel>
</template>
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { WorldSimulationMaterialModule_ACU } from '../composables/useWorldSimulationMaterials';
import { useWorldSimulationMaterials, WORLD_SIMULATION_MATERIAL_MODULES_ACU, WORLD_SIMULATION_MATERIAL_MODULE_LABELS_ACU } from '../composables/useWorldSimulationMaterials';
import AcuButton from './_lib/AcuButton.vue'; import AcuPanel from './_lib/AcuPanel.vue'; import AcuTextarea from './_lib/AcuTextarea.vue';
const props = defineProps<{ refreshTick: number }>();
const materials = useWorldSimulationMaterials(); const activeTab = ref<'state' | 'requirements' | 'diagnostics'>('state');
const modules = WORLD_SIMULATION_MATERIAL_MODULES_ACU; const labels = WORLD_SIMULATION_MATERIAL_MODULE_LABELS_ACU; const tabs = [{ id: 'state', label: '世界状态' }, { id: 'requirements', label: '当前要求' }, { id: 'diagnostics', label: '回放诊断' }] as const;
const requirementItems = computed(() => Array.isArray(materials.requirementsBaseline.value?.requirements) ? materials.requirementsBaseline.value!.requirements as any[] : []);
function clockPrecision(value: string): string { return value === 'exact' ? '时间精确' : value === 'approximate' ? '时间近似' : '时间未知'; }
function visibility(value: any): string { return value?.mode === 'revealed' ? '已公开' : value?.mode === 'rumored' ? '传闻' : '隐藏'; }
function category(value: string): string { return ({ goal: '目标', preference: '偏好', prohibition: '禁令', canon: '设定', process: '流程' } as Record<string, string>)[value] ?? value; }
function emptyHint(module: WorldSimulationMaterialModule_ACU): string { return module === 'entities' ? '还没有需要持续追踪的实体。' : module === 'events' ? '还没有已登记的世界事件。' : '还没有需要持续追踪的线索。'; }
function itemKind(module: WorldSimulationMaterialModule_ACU, item: any): string { return module === 'entities' ? ({ character: '角色', faction: '势力', location: '地点' }[item.kind] ?? '实体') : module === 'events' ? '事件' : ({ brewing: '酝酿', active: '进行中', converging: '收束中', closed: '已闭合' }[item.status] ?? '线索'); }
function itemTitle(module: WorldSimulationMaterialModule_ACU, item: any): string { return module === 'entities' ? `${item.name} · ${item.situation}` : module === 'events' ? `${item.summary}` : `${item.title} · ${item.summary}`; }
function itemDetail(module: WorldSimulationMaterialModule_ACU, item: any): string {
  if (module === 'entities') return `目标：${item.agenda || '未记录'} · 最近移动：第 ${(item.lastMovedIndex ?? 0) + 1} 楼（${item.lastMovedAt || '未记录'}） · 更新：第 ${(item.updatedIndex ?? 0) + 1} 楼`;
  if (module === 'events') return `发生：${item.occurredAt || '未记录'} · 第 ${(item.occurredIndex ?? 0) + 1} 楼 · 参与者：${item.actorIds?.join('、') || '未记录'}${item.consequenceHint ? ` · 后果：${item.consequenceHint}` : ''}`;
  return `关联事件：${item.relatedEventIds?.join('、') || '未记录'}${item.expectedSurfaceHint ? ` · 预期显露：${item.expectedSurfaceHint}` : ''} · 更新：第 ${(item.updatedIndex ?? 0) + 1} 楼`;
}
function reload(options: { preserveDirty?: boolean } = {}): void { materials.reload(options); }
onMounted(() => reload()); watch(() => props.refreshTick, () => reload({ preserveDirty: true })); defineExpose({ reload });
</script>
<style scoped>
.world-sim-materials{display:grid;gap:12px}.world-sim-materials__tabs{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.world-sim-materials__tab{border:1px solid color-mix(in srgb,var(--acu-text-3) 25%,transparent);border-radius:999px;background:transparent;color:var(--acu-text-2);padding:5px 12px;cursor:pointer;font:inherit}.world-sim-materials__tab--active{background:color-mix(in srgb,var(--acu-primary,#5b8def) 14%,transparent);border-color:color-mix(in srgb,var(--acu-primary,#5b8def) 60%,transparent);color:var(--acu-text-1)}.world-sim-materials__tabs .acu-btn{margin-left:auto}.world-sim-materials__overview{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.world-sim-materials__overview>div,.world-sim-materials__block,.world-sim-materials__card{display:grid;gap:5px;padding:10px;border:1px solid color-mix(in srgb,var(--acu-text-3) 20%,transparent);border-radius:7px}.world-sim-materials__overview strong,.world-sim-materials__card strong{color:var(--acu-text-1)}.world-sim-materials__overview span,.world-sim-materials__card-meta{color:var(--acu-text-3);font-size:12px}.world-sim-materials__block{gap:10px}.world-sim-materials__block summary,.world-sim-materials__editor summary{cursor:pointer;color:var(--acu-text-1)}.world-sim-materials__cards{display:grid;gap:8px}.world-sim-materials__card header{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.world-sim-materials__card p{margin:0;color:var(--acu-text-2);white-space:pre-wrap}.world-sim-materials__card--retired{opacity:.58}.world-sim-materials__badge{padding:1px 8px;border:1px solid color-mix(in srgb,var(--acu-text-3) 30%,transparent);border-radius:999px;color:var(--acu-text-2);font-size:11px}.world-sim-materials__editor{display:grid;gap:8px}.world-sim-materials__editor>p{margin:0;color:var(--acu-text-3);font-size:12px}.world-sim-materials__actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:7px}.world-sim-materials__meta,.world-sim-materials__empty,.world-sim-materials__error{margin:0;color:var(--acu-text-3);font-size:12px;white-space:pre-wrap}.world-sim-materials__error{color:var(--acu-danger,#d65b5b)}.world-sim-materials__diagnostics{display:grid;grid-template-columns:max-content 1fr;gap:8px;margin:0;padding:10px;border:1px solid color-mix(in srgb,var(--acu-text-3) 20%,transparent);border-radius:7px;color:var(--acu-text-2);font-size:12px}.world-sim-materials__diagnostics dt{color:var(--acu-text-3)}.world-sim-materials__diagnostics dd{margin:0}@media(max-width:640px){.world-sim-materials__tabs .acu-btn{margin-left:0;width:100%}.world-sim-materials__overview{grid-template-columns:1fr}}
</style>
