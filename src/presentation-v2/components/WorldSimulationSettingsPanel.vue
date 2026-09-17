<template>
  <AcuPanel title="世界推演 Agent 设置" description="挂载和编辑只修改本地草稿；只有点击保存才经当前 runtime 严格校验并持久化。">
    <p v-if="!settings" class="world-sim-settings__muted">设置尚未加载。</p>
    <template v-else>
      <div class="world-sim-settings__toggles">
        <AcuFormRow label="自动触发" hint="assistant 完成后自动启动世界推演。"><AcuToggle v-model="draft.autoTriggerEnabled" /></AcuFormRow>
        <AcuFormRow label="计划执行前预览"><AcuToggle v-model="draft.planPreview" /></AcuFormRow>
      </div>
      <div class="world-sim-settings__numbers">
        <AcuFormRow label="历史 Token 预算"><AcuInput v-model="draft.agentHistoryTokenBudget" type="number" :min="0" /></AcuFormRow>
        <AcuFormRow label="读取预算" hint="整数或百分比，例如 20%。"><AcuInput :model-value="draft.agentReadTokenBudget" @update:model-value="draft.agentReadTokenBudget = $event" /></AcuFormRow>
        <AcuFormRow label="精读回退 Token"><AcuInput v-model="draft.agentReadFallbackTokens" type="number" :min="0" /></AcuFormRow>
        <AcuFormRow label="API 预设（全局默认）" hint="所有 Agent 默认走这个预设；需要单独指定时使用下方「Agent API 渠道映射」。"><AcuSelect :options="apiPresetSelectOptions" :model-value="globalApiValue" @update:model-value="setGlobalApi" /></AcuFormRow>
      </div>
      <section class="world-sim-settings__section">
        <strong>Agent 运行预算</strong>
        <div class="world-sim-settings__numbers">
          <AcuFormRow v-for="field in budgetFields" :key="field.key" :label="field.label"><AcuInput type="number" :min="field.min" :max="field.max" :model-value="draft.agentRunBudget[field.key]" @update:model-value="setBudget(field.key, $event)" /></AcuFormRow>
        </div>
      </section>
      <section class="world-sim-settings__section">
        <strong>受限网页研究</strong>
        <div class="world-sim-settings__toggles">
          <AcuFormRow label="启用网页研究" hint="只影响世界推演 Agent，不会为其他功能开放网络读取。"><AcuToggle v-model="draft.webResearch.enabled" /></AcuFormRow>
          <AcuFormRow label="萌娘百科"><AcuToggle v-model="draft.webResearch.sources.moegirl" /></AcuFormRow>
          <AcuFormRow label="中文 Wikipedia"><AcuToggle v-model="draft.webResearch.sources.wikipediaZh" /></AcuFormRow>
          <AcuFormRow label="英文 Wikipedia"><AcuToggle v-model="draft.webResearch.sources.wikipediaEn" /></AcuFormRow>
        </div>
        <div class="world-sim-settings__numbers">
          <AcuFormRow label="搜索服务"><AcuSelect v-model="draft.webResearch.searchProvider" :options="webProviderOptions" /></AcuFormRow>
          <AcuFormRow v-if="draft.webResearch.searchProvider === 'searxng'" label="SearXNG 地址"><AcuInput v-model="draft.webResearch.searxngBaseUrl" /></AcuFormRow>
          <AcuFormRow label="单页字符上限"><AcuInput v-model="draft.webResearch.pageCharLimit" type="number" :min="500" :max="20000" /></AcuFormRow>
          <AcuFormRow label="禁用域名" hint="使用现有 runtime 约定的文本格式。"><AcuInput v-model="draft.webResearch.blockedDomains" /></AcuFormRow>
        </div>
      </section>
      <section class="world-sim-settings__section">
        <div class="world-sim-settings__heading"><div><strong>Agent API 渠道映射</strong><p>「跟随全局默认」即使用上方 API 预设；单独指定后选择即写入草稿，保存时校验预设存在，不再手写 JSON。</p></div></div>
        <div class="world-sim-settings__numbers">
          <AcuFormRow v-for="role in agentChannelRoles" :key="role" :label="role">
            <AcuSelect :options="agentChannelOptions" :model-value="agentChannelValue(role)" @update:model-value="value => applyAgentChannel(role, String(value))" />
          </AcuFormRow>
        </div>
      </section>
      <section class="world-sim-settings__section">
        <div class="world-sim-settings__heading">
          <div><strong>角色提示词</strong><p>引擎 seam 不可删除；导入导出使用与智能续写一致的 JSON 文件，导入后立即提交保存；不会改写世界账本、会话或正文。</p></div>
          <div class="world-sim-settings__actions"><AcuButton size="sm" @click="exportPrompts">导出提示词 JSON</AcuButton><AcuButton size="sm" @click="promptImportInput?.click()">导入提示词 JSON</AcuButton><input ref="promptImportInput" type="file" accept=".json,application/json" class="world-sim-settings__file-input" @change="onImportPromptsFile" /><AcuButton size="sm" @click="restoreAllPrompts">恢复全部默认</AcuButton><AcuButton size="sm" @click="restoreAgent">恢复当前角色默认值</AcuButton></div>
        </div>
        <AcuSelect v-model="activeAgent" :options="agentOptions" />
        <AcuPromptSegments :segments="draft.agentPrompts[activeAgent]" :role-options="roleOptions" :show-slot="false" :show-enabled="true" :allow-move="true" :rows="5" @add="addPrompt" @delete="deletePrompt" @move="movePrompt" @update="updatePrompt" />
      </section>
      <AcuMessage v-if="message" :kind="message.kind">{{ message.text }}</AcuMessage>
      <div class="world-sim-settings__actions"><AcuButton variant="primary" :loading="busy" @click="save">保存世界推演设置</AcuButton></div>
    </template>
  </AcuPanel>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { WORLD_SIMULATION_AGENT_CATALOG_ACU, type WorldSimulationAgentName_ACU } from '../../service/simulation/agent/agent-catalog';
import { buildDefaultWorldSimulationAgentPrompt_ACU, buildDefaultWorldSimulationAgentPrompts_ACU } from '../../service/simulation/agent/agent-defaults';
import { exportWorldSimulationPrompts_ACU, importWorldSimulationPrompts_ACU } from '../../service/simulation/agent/prompt-template';
import type { WorldSimulationPromptSegment_ACU, WorldSimulationRunBudget_ACU, WorldSimulationSettings_ACU } from '../../service/simulation/model';
import { useApiPresetSelectOptions } from '../composables/useApiPresetSelectOptions';
import AcuButton from './_lib/AcuButton.vue';
import AcuFormRow from './_lib/AcuFormRow.vue';
import AcuInput from './_lib/AcuInput.vue';
import AcuMessage from './_lib/AcuMessage.vue';
import AcuPanel from './_lib/AcuPanel.vue';
import AcuPromptSegments, { type PromptSegment } from './_lib/AcuPromptSegments.vue';
import AcuSelect from './_lib/AcuSelect.vue';
import AcuToggle from './_lib/AcuToggle.vue';

const props = defineProps<{ settings: WorldSimulationSettings_ACU | null; busy: boolean }>();
const emit = defineEmits<{ (event: 'save', settings: WorldSimulationSettings_ACU): void }>();
const draft = reactive<WorldSimulationSettings_ACU>({} as WorldSimulationSettings_ACU);
const { apiStore, apiPresetSelectOptions } = useApiPresetSelectOptions();
const message = ref<{ kind: 'success' | 'error'; text: string } | null>(null);
const activeAgent = ref<WorldSimulationAgentName_ACU>('world-director');
const promptImportInput = ref<HTMLInputElement | null>(null);
const INHERIT_CHANNEL_VALUE = '__inherit__';
const webProviderOptions = [
  { value: 'duckduckgo', label: 'DuckDuckGo' },
  { value: 'serper', label: 'Serper' },
  { value: 'tavily', label: 'Tavily' },
  { value: 'searxng', label: 'SearXNG' },
];
const roleOptions = [{ value: 'system', label: 'SYSTEM' }, { value: 'user', label: 'USER' }, { value: 'assistant', label: 'ASSISTANT' }];
const agentOptions = WORLD_SIMULATION_AGENT_CATALOG_ACU.map(item => ({ value: item.name, label: `${item.name} · ${item.description}` }));
const agentChannelRoles = WORLD_SIMULATION_AGENT_CATALOG_ACU.map(item => item.name as WorldSimulationAgentName_ACU);
const agentChannelOptions = computed(() => [{ value: INHERIT_CHANNEL_VALUE, label: '跟随全局默认' }, ...apiPresetSelectOptions.value]);
const globalApiValue = computed(() => (draft.apiPresetMode === 'fixed' ? draft.fixedApiPresetName : ''));
const budgetFields: Array<{ key: keyof WorldSimulationRunBudget_ACU; label: string; min: number; max: number }> = [
  { key: 'maxIterations', label: '主循环迭代上限', min: 1, max: 100 }, { key: 'maxDelegations', label: '派工总数上限', min: 0, max: 100 },
  { key: 'maxSameAgent', label: '单代理派工上限', min: 0, max: 20 }, { key: 'maxConcurrent', label: '并发派工上限', min: 1, max: 20 },
  { key: 'maxReads', label: '读取批次上限', min: 0, max: 200 }, { key: 'maxExtraReads', label: '子代理额外读取轮', min: 0, max: 20 },
];
function cloneSettings(value: WorldSimulationSettings_ACU): WorldSimulationSettings_ACU { return JSON.parse(JSON.stringify(value)) as WorldSimulationSettings_ACU; }
function sync(value: WorldSimulationSettings_ACU | null): void { if (!value) return; Object.assign(draft, cloneSettings(value)); message.value = null; }
watch(() => props.settings, sync, { immediate: true, deep: true });
onMounted(() => apiStore.refreshFromSettings());
function setBudget(key: keyof WorldSimulationRunBudget_ACU, value: string | number): void { draft.agentRunBudget[key] = Number(value); }
function setGlobalApi(value: unknown): void { const trimmed = String(value ?? '').trim(); draft.apiPresetMode = trimmed ? 'fixed' : 'current'; draft.fixedApiPresetName = trimmed; }
function agentChannelValue(role: WorldSimulationAgentName_ACU): string {
  const choice = draft.agentApiPresets?.[role];
  if (!choice) return INHERIT_CHANNEL_VALUE;
  return choice.mode === 'fixed' ? choice.presetName : '';
}
function applyAgentChannel(role: WorldSimulationAgentName_ACU, value: unknown): void {
  const trimmed = String(value ?? '').trim();
  const next = { ...draft.agentApiPresets };
  if (trimmed === INHERIT_CHANNEL_VALUE) delete next[role];
  else next[role] = trimmed ? { mode: 'fixed', presetName: trimmed } : { mode: 'current', presetName: '' };
  draft.agentApiPresets = next;
}
function presetExists(presetName: string): boolean { return apiStore.presets.some(preset => preset.name === presetName); }
function addPrompt(position: 'top' | 'bottom'): void { const list = draft.agentPrompts[activeAgent.value]; const item: WorldSimulationPromptSegment_ACU = { role: 'user', content: '请填写提示词内容。', enabled: true, deletable: true, pinned: false }; position === 'top' ? list.unshift(item) : list.push(item); }
function deletePrompt(index: number): void { const list = draft.agentPrompts[activeAgent.value]; if (list[index]?.deletable) list.splice(index, 1); }
function movePrompt(index: number, delta: -1 | 1): void { const list = draft.agentPrompts[activeAgent.value]; const target = index + delta; if (target < 0 || target >= list.length || list[index]?.pinned || list[target]?.pinned) return; [list[index], list[target]] = [list[target], list[index]]; }
function updatePrompt(index: number, patch: Partial<PromptSegment>): void { const current = draft.agentPrompts[activeAgent.value][index]; if (!current) return; draft.agentPrompts[activeAgent.value][index] = current.pinned ? { ...current, ...(typeof patch.content === 'string' ? { content: patch.content } : {}) } : { ...current, ...patch, pinned: current.pinned } as WorldSimulationPromptSegment_ACU; }
function restoreAgent(): void { draft.agentPrompts[activeAgent.value] = buildDefaultWorldSimulationAgentPrompt_ACU(activeAgent.value); message.value = { kind: 'success', text: '已恢复当前角色的本地默认提示词；尚未保存。' }; }
function restoreAllPrompts(): void { draft.agentPrompts = buildDefaultWorldSimulationAgentPrompts_ACU(); message.value = { kind: 'success', text: '已恢复全部角色的本地默认提示词；尚未保存。' }; }
function exportPrompts(): void {
  try {
    const bundle = { version: 1, agentPrompts: JSON.parse(exportWorldSimulationPrompts_ACU(draft.agentPrompts)) };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'acu-world-simulation-prompts.json';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    message.value = { kind: 'success', text: '提示词 JSON 已导出。' };
  } catch (error) {
    message.value = { kind: 'error', text: error instanceof Error ? error.message : '提示词导出失败' };
  }
}
async function onImportPromptsFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const parsed: unknown = JSON.parse(await file.text());
    const prompts = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.prototype.hasOwnProperty.call(parsed, 'agentPrompts')
      ? (parsed as { agentPrompts: unknown }).agentPrompts
      : parsed;
    draft.agentPrompts = importWorldSimulationPrompts_ACU(JSON.stringify(prompts ?? ''));
    emit('save', cloneSettings(draft));
    message.value = { kind: 'success', text: '提示词 JSON 已导入并提交保存。' };
  } catch (error) {
    message.value = { kind: 'error', text: error instanceof Error ? error.message : '提示词 JSON 读取失败' };
  }
}
function save(): void {
  try {
    exportWorldSimulationPrompts_ACU(draft.agentPrompts);
    if (draft.apiPresetMode === 'fixed') {
      const presetName = draft.fixedApiPresetName.trim();
      if (!presetName) throw new Error('固定 API 预设不能为空');
      if (!presetExists(presetName)) throw new Error(`API 预设 "${presetName}" 不存在，请重新选择`);
    }
    for (const [role, choice] of Object.entries(draft.agentApiPresets ?? {})) {
      if (choice?.mode !== 'fixed') continue;
      const presetName = choice.presetName.trim();
      if (!presetName) throw new Error(`${role} 的固定渠道必须选择预设`);
      if (!presetExists(presetName)) throw new Error(`${role} 渠道的 API 预设 "${presetName}" 不存在，请重新选择`);
    }
    emit('save', cloneSettings(draft));
    message.value = { kind: 'success', text: '保存请求已提交；runtime 将重新读取并确认结果。' };
  } catch (error) {
    message.value = { kind: 'error', text: error instanceof Error ? error.message : '设置校验失败' };
  }
}
</script>

<style scoped>
.world-sim-settings__toggles,.world-sim-settings__numbers{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.world-sim-settings__section{display:grid;gap:10px;margin-top:14px;padding-top:12px;border-top:1px solid color-mix(in srgb,var(--acu-text-3) 18%,transparent)}.world-sim-settings__heading,.world-sim-settings__actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.world-sim-settings__heading>div:first-child{flex:1 1 320px}.world-sim-settings__heading p,.world-sim-settings__muted{margin:4px 0 0;color:var(--acu-text-3);font-size:12px}.world-sim-settings__actions{justify-content:flex-end}.world-sim-settings__file-input{display:none}@media(max-width:640px){.world-sim-settings__toggles,.world-sim-settings__numbers{grid-template-columns:1fr}}
</style>
