<template>
  <section class="ws-page">
    <AcuPanel title="世界推演" description="独立世界账本与 Agent runtime；页面只消费 simulation service，所有持久化动作均需显式触发。">
      <p v-if="runtime.error.value" class="error">{{ runtime.error.value }} <AcuButton @click="runtime.refresh">重新读取</AcuButton></p>
      <p v-else-if="!runtime.ready.value" class="muted">正在读取并验证世界推演快照…</p>
      <WorldSimulationChat v-else :status="statusText" :anchor="runtime.snapshot.value?.anchor ?? null" :entries="runtime.snapshot.value?.session.entries ?? []" :running="runtime.snapshot.value?.session.running ?? false" @send="runtime.send" @cancel="runtime.cancel" />
    </AcuPanel>

    <AcuPanel v-if="runtime.ready.value && runtime.task.value?.status === 'awaiting_plan_review' && runtime.activeRevision.value" title="阶段计划预览" description="确认和重规划都会复核冻结锚点、run/task/stage/revision。">
      <h3>{{ runtime.activeRevision.value.plan.title }}</h3>
      <p>{{ runtime.activeRevision.value.plan.objective }}</p>
      <pre>{{ JSON.stringify(runtime.activeRevision.value.plan, null, 2) }}</pre>
      <textarea v-model="replanDraft" rows="3" placeholder="输入重规划约束或修正方向" />
      <div class="actions"><AcuButton :loading="runtime.busy.value" :disabled="!replanDraft.trim()" @click="replan">重规划</AcuButton><AcuButton variant="primary" :loading="runtime.busy.value" @click="runtime.confirmPlan">确认计划并执行</AcuButton></div>
    </AcuPanel>

    <div v-if="runtime.ready.value" class="grid">
      <AcuPanel title="材料、候选与证据"><WorldSimulationMaterialsPanel :conversation="runtime.snapshot.value!.conversation" :materials="runtime.snapshot.value!.materials" :session="runtime.snapshot.value!.session.entries" /></AcuPanel>
      <AcuPanel title="世界账本与投影"><WorldSimulationLedgerPanel :ledger="runtime.envelope.value?.ledger ?? null" :projection-preview="runtime.snapshot.value!.projectionPreview" /></AcuPanel>
    </div>

    <AcuPanel v-if="runtime.ready.value && runtime.settingsDraft.value" title="运行设置" description="初始化不会写回；仅点击保存后才验证并提交当前聊天的 simulation envelope。">
      <div class="settings">
        <label><input v-model="runtime.settingsDraft.value.autoTriggerEnabled" type="checkbox" /> 自动触发</label>
        <label><input v-model="runtime.settingsDraft.value.planPreview" type="checkbox" /> 计划执行前预览</label>
        <label>API 模式<select v-model="runtime.settingsDraft.value.apiPresetMode"><option value="current">跟随当前</option><option value="fixed">固定预设</option></select></label>
        <label v-if="runtime.settingsDraft.value.apiPresetMode === 'fixed'">固定预设<input v-model="runtime.settingsDraft.value.fixedApiPresetName" /></label>
        <label>历史预算<input v-model.number="runtime.settingsDraft.value.agentHistoryTokenBudget" type="number" min="0" /></label>
        <label>读取预算<input v-model="runtime.settingsDraft.value.agentReadTokenBudget" /></label>
        <label>精读额度<input v-model.number="runtime.settingsDraft.value.agentReadFallbackTokens" type="number" min="1" /></label>
      </div>

      <details class="editor">
        <summary>Agent 运行预算</summary>
        <div class="settings">
          <label>主循环迭代上限<input v-model.number="runtime.settingsDraft.value.agentRunBudget.maxIterations" type="number" min="1" max="30" /></label>
          <label>派工总数上限<input v-model.number="runtime.settingsDraft.value.agentRunBudget.maxDelegations" type="number" min="0" max="20" /></label>
          <label>单代理派工上限<input v-model.number="runtime.settingsDraft.value.agentRunBudget.maxSameAgent" type="number" min="1" max="10" /></label>
          <label>并发派工上限<input v-model.number="runtime.settingsDraft.value.agentRunBudget.maxConcurrent" type="number" min="1" max="6" /></label>
          <label>读取批次上限<input v-model.number="runtime.settingsDraft.value.agentRunBudget.maxReads" type="number" min="0" max="30" /></label>
          <label>子代理额外读取轮<input v-model.number="runtime.settingsDraft.value.agentRunBudget.maxExtraReads" type="number" min="0" max="10" /></label>
        </div>
      </details>
      <details class="editor">
        <summary>网页研究</summary>
        <label><input v-model="runtime.settingsDraft.value.webResearch.enabled" type="checkbox" /> 启用受限网页研究</label>
        <div class="settings">
          <label>搜索服务<select v-model="runtime.settingsDraft.value.webResearch.searchProvider"><option value="duckduckgo">DuckDuckGo</option><option value="serper">Serper</option><option value="tavily">Tavily</option><option value="searxng">SearXNG</option></select></label>
          <label>SearXNG 地址<input v-model="runtime.settingsDraft.value.webResearch.searxngBaseUrl" /></label>
          <label>单页字符上限<input v-model.number="runtime.settingsDraft.value.webResearch.pageCharLimit" type="number" min="1" /></label>
          <label>禁用域名<input v-model="runtime.settingsDraft.value.webResearch.blockedDomains" /></label>
        </div>
      </details>
      <details class="editor">
        <summary>各 Agent API 渠道</summary>
        <p class="muted">JSON 仅允许 simulation Agent 的 current/fixed 渠道映射；保存前由严格 settings validator 复核。</p>
        <textarea v-model="agentApiDraft" rows="8" />
      </details>
      <details class="editor">
        <summary>Agent 提示词编辑与导入导出</summary>
        <p class="muted">导入只接受完整 simulation 角色集合与合法 segment；未知角色、字段或非法 JSON 会 fail-closed。</p>
        <textarea v-model="promptsDraft" rows="16" />
        <div class="actions"><AcuButton @click="loadPromptExport">从当前草稿导出</AcuButton><AcuButton @click="applyPromptImport">导入到设置草稿</AcuButton></div>
      </details>
      <div class="actions"><AcuButton variant="primary" :loading="runtime.busy.value" @click="saveSettings">保存世界推演设置</AcuButton></div>
    </AcuPanel>

    <AcuPanel v-if="runtime.ready.value && runtime.task.value?.status === 'paused'" title="恢复运行" description="恢复会重新校验冻结锚点与当前 revision。">
      <div class="actions"><AcuButton variant="primary" :loading="runtime.busy.value" @click="runtime.resume">恢复当前任务</AcuButton></div>
    </AcuPanel>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import AcuButton from '../components/_lib/AcuButton.vue';
import AcuPanel from '../components/_lib/AcuPanel.vue';
import WorldSimulationChat from '../components/WorldSimulationChat.vue';
import WorldSimulationLedgerPanel from '../components/WorldSimulationLedgerPanel.vue';
import WorldSimulationMaterialsPanel from '../components/WorldSimulationMaterialsPanel.vue';
import { useChatChangedTick, useChatMutationTick } from '../composables/useChatChangedListener';
import { useWorldSimulationRuntime } from '../composables/useWorldSimulationRuntime';

const runtime = useWorldSimulationRuntime();
const replanDraft = ref('');
const promptsDraft = ref('');
const agentApiDraft = ref('{}');
const chatChangedTick = useChatChangedTick();
const chatMutationTick = useChatMutationTick();
const statusText = computed(() => {
  const task = runtime.task.value;
  if (!task) return '尚未创建任务';
  const error = runtime.envelope.value?.lastError;
  return [task.status, error ? `${error.code}: ${error.message}` : ''].filter(Boolean).join(' · ');
});

function syncEditors(): void {
  const settings = runtime.settingsDraft.value;
  if (!settings) { promptsDraft.value = ''; agentApiDraft.value = '{}'; return; }
  promptsDraft.value = runtime.exportPrompts();
  agentApiDraft.value = JSON.stringify(settings.agentApiPresets, null, 2);
}
function refresh(): void { if (runtime.refresh()) syncEditors(); }
async function replan(): Promise<void> { if (await runtime.replan(replanDraft.value)) replanDraft.value = ''; }
function loadPromptExport(): void { promptsDraft.value = runtime.exportPrompts(); }
function applyPromptImport(): void { runtime.importPrompts(promptsDraft.value); }
async function saveSettings(): Promise<void> {
  const settings = runtime.settingsDraft.value;
  if (!settings) return;
  try {
    const parsed = JSON.parse(agentApiDraft.value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Agent API 渠道必须是对象');
    settings.agentApiPresets = parsed as typeof settings.agentApiPresets;
    if (!runtime.importPrompts(promptsDraft.value)) return;
    await runtime.saveSettings();
    syncEditors();
  } catch (cause) {
    runtime.error.value = cause instanceof Error ? cause.message : '设置 JSON 非法';
  }
}

onMounted(refresh);
watch([chatChangedTick, chatMutationTick], refresh);
</script>

<style scoped>
.ws-page{display:grid;gap:14px}.grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px}.settings{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px}.settings label{display:grid;gap:5px}.actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:10px}.editor{margin-top:12px;padding:8px;border:1px solid color-mix(in srgb,var(--acu-text-3) 20%,transparent);border-radius:8px}textarea,input,select{box-sizing:border-box;width:100%;padding:8px;border:1px solid color-mix(in srgb,var(--acu-text-3) 25%,transparent);border-radius:7px;background:var(--acu-bg-2);color:var(--acu-text-1);font:inherit}pre{max-height:300px;overflow:auto;padding:10px;border-radius:8px;background:var(--acu-bg-2);white-space:pre-wrap;word-break:break-word}.error{color:var(--acu-danger,#d65b5b)}.muted{color:var(--acu-text-3)}@media(max-width:800px){.grid{grid-template-columns:1fr}}
</style>
