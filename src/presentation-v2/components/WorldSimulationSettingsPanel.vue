<template>
  <AcuPanel title="世界推演 Agent 设置" description="这里配置世界推演专用 Agent；挂载和编辑都只修改本地草稿，只有点击保存才会持久化。">
    <AcuFormRow label="启用世界推演" hint="关闭时不会发起世界推演 AI 请求。">
      <AcuToggle :model-value="draft.enabled" @update:model-value="draft.enabled = $event" />
    </AcuFormRow>
    <div class="world-simulation-settings__numbers">
      <AcuFormRow v-for="field in numberFields" :key="field.key" :label="field.label" :hint="field.hint">
        <AcuInput type="number" :min="field.min" :max="field.max" :model-value="draft[field.key]" @update:model-value="draft[field.key] = asNumber($event)" />
      </AcuFormRow>
    </div>
    <AcuFormRow label="公开可见性" hint="控制公开投影与 hidden-only 上下文的默认策略。">
      <AcuSelect :model-value="draft.visibilityPolicy" :options="visibilityOptions" @update:model-value="draft.visibilityPolicy = $event as WorldVisibilityPolicy_ACU" />
    </AcuFormRow>
    <AcuFormRow label="在界面显示隐藏状态">
      <AcuToggle :model-value="draft.showHiddenInUi" @update:model-value="draft.showHiddenInUi = $event" />
    </AcuFormRow>
    <section v-for="scale in scales" :key="scale" class="world-simulation-settings__budget">
      <strong>{{ scale }} 预算</strong>
      <div class="world-simulation-settings__numbers">
        <AcuFormRow v-for="field in budgetNumberFields" :key="field.key" :label="field.label">
          <AcuInput type="number" :min="field.min" :model-value="draft.budgets[scale][field.key]" @update:model-value="setBudgetNumber(scale, field.key, $event)" />
        </AcuFormRow>
      </div>
      <AcuFormRow label="读取额度">
        <AcuSelect :model-value="draft.budgets[scale].readTokenBudget" :options="tierOptions" @update:model-value="draft.budgets[scale].readTokenBudget = $event as WorldReadBudgetTier_ACU" />
      </AcuFormRow>
    </section>
    <section class="world-simulation-settings__prompts">
      <div class="world-simulation-settings__prompt-heading">
        <div><strong>四角色伪 Role 提示词</strong><p>可编辑内容会按 Role 真实进入内部 AI messages；代码仍强制注入模块权限、JSON 协议、revision 和不可信数据边界。</p></div>
        <div class="world-simulation-settings__actions"><AcuButton size="sm" @click="restoreDefaultPrompts">恢复默认提示词</AcuButton><AcuButton size="sm" @click="exportPrompts">导出到文本</AcuButton></div>
      </div>
      <details v-for="agent in agents" :key="agent.name" class="world-simulation-settings__prompt-agent" :open="agent.name === 'world-director'">
        <summary>{{ agent.label }} · {{ agent.hint }}</summary>
        <AcuPromptSegments
          :segments="draft.agentPrompts[agent.name]"
          :role-options="promptRoleOptions"
          :show-slot="false"
          :show-enabled="true"
          :allow-move="true"
          :rows="4"
          empty-text="至少保留一段启用的提示词才能保存。"
          @add="addPromptSegment(agent.name, $event)"
          @delete="deletePromptSegment(agent.name, $event)"
          @move="(index, delta) => movePromptSegment(agent.name, index, delta)"
          @update="(index, patch) => updatePromptSegment(agent.name, index, patch)"
        />
      </details>
      <details class="world-simulation-settings__prompt-transfer">
        <summary>导入 / 导出伪 Role JSON</summary>
        <p>导入只更新本地草稿；请在核对四个角色后点击底部保存。不会导入世界账本、会话或正文。</p>
        <AcuTextarea :model-value="promptTransfer" :rows="8" placeholder="点击“导出到文本”后在此复制，或粘贴四角色提示词 JSON 后导入。" @update:model-value="promptTransfer = $event" />
        <div class="world-simulation-settings__actions"><AcuButton size="sm" @click="importPrompts">从文本导入</AcuButton><AcuButton size="sm" :disabled="!promptTransfer" @click="promptTransfer = ''">清空文本</AcuButton></div>
      </details>
      <details class="world-simulation-settings__prompt-preview">
        <summary>预览内部 Agent messages（不发送、不保存）</summary>
        <AcuSelect :model-value="previewAgent" :options="previewAgentOptions" @update:model-value="previewAgent = $event as WorldSimulationAgentName_ACU" />
        <ol class="world-simulation-settings__message-preview"><li v-for="(item, index) in previewMessages" :key="index"><strong>[{{ item.role }}]</strong><pre>{{ item.content }}</pre></li></ol>
      </details>
    </section>
    <AcuMessage v-if="message" :kind="message.kind">{{ message.text }}</AcuMessage>
    <AcuButton variant="primary" @click="save">保存世界推演设置</AcuButton>
  </AcuPanel>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { WORLD_SIMULATION_DIRECTOR_DEFINITION_ACU, findWorldSimulationAgent_ACU } from '../../service/simulation/agent/agent-catalog';
import { buildDefaultWorldSimulationAgentPrompts_ACU, buildDefaultWorldSimulationSettings_ACU } from '../../service/simulation/defaults';
import type { WorldReadBudgetTier_ACU, WorldSimulationAgentName_ACU, WorldSimulationPromptRole_ACU, WorldSimulationPromptSegment_ACU, WorldSimulationScale_ACU, WorldSimulationSettings_ACU, WorldVisibilityPolicy_ACU } from '../../service/simulation/model';
import { isWorldSimulationSettings_ACU, readWorldSimulationSettings_ACU, writeWorldSimulationSettingsStrict_ACU } from '../../service/simulation/simulation-settings';
import { renderWorldSimulationAgentMessages_ACU } from '../../service/simulation/world-simulation-agent-prompts';
import AcuButton from './_lib/AcuButton.vue';
import AcuFormRow from './_lib/AcuFormRow.vue';
import AcuInput from './_lib/AcuInput.vue';
import AcuMessage from './_lib/AcuMessage.vue';
import AcuPanel from './_lib/AcuPanel.vue';
import AcuPromptSegments from './_lib/AcuPromptSegments.vue';
import AcuSelect from './_lib/AcuSelect.vue';
import AcuTextarea from './_lib/AcuTextarea.vue';
import AcuToggle from './_lib/AcuToggle.vue';

const scales: WorldSimulationScale_ACU[] = ['light', 'normal', 'deep'];
const numberFields = [
  { key: 'joinWaitMs', label: '剧情推进等待（毫秒）', hint: '0 到 30000；只等待已存在的候选结算。', min: 0, max: 30000 },
  { key: 'minFloorGap', label: '最小楼层间隔', hint: '至少 1。', min: 1 },
  { key: 'checkpointInterval', label: '检查点间隔', hint: '至少 1。', min: 1 },
  { key: 'maxTrackedEntities', label: '最大追踪实体', hint: '至少 1。', min: 1 },
] as const;
const budgetNumberFields = [{ key: 'maxIterations', label: '最大迭代', min: 1 }, { key: 'maxDelegations', label: '最大委派', min: 0 }, { key: 'maxReads', label: '最大读取', min: 0 }] as const;
const visibilityOptions = [{ value: 'agent', label: '由 Agent 决定' }, { value: 'always_hidden', label: '始终隐藏' }, { value: 'always_revealed', label: '始终公开' }];
const tierOptions = [{ value: 'low', label: '低' }, { value: 'medium', label: '中' }, { value: 'high', label: '高' }];
const agents: ReadonlyArray<{ name: WorldSimulationAgentName_ACU; label: string; hint: string }> = [
  { name: 'world-director', label: '主 Agent（world-director）', hint: '只能选择子代理，不能直接写账本。' },
  { name: 'entity-movement', label: '实体子代理（entity-movement）', hint: '仅 entities。' },
  { name: 'faction-events', label: '事件子代理（faction-events）', hint: '仅 events。' },
  { name: 'thread-weaver', label: '线索子代理（thread-weaver）', hint: '仅 threads。' },
];
const promptRoleOptions = [
  { value: 'system', label: 'SYSTEM' },
  { value: 'user', label: 'USER' },
  { value: 'assistant', label: 'ASSISTANT' },
];
const previewAgentOptions = agents.map(agent => ({ value: agent.name, label: agent.label }));
const previewSnapshot = {
  anchorMessageIndex: 0,
  storyClock: { anchorText: '预览锚点', elapsedSinceLastRun: '即时', precision: 'unknown' as const, evidenceIndexes: [], updatedIndex: 0 },
  entities: [], events: [], threads: [], revisions: { entities: 0, events: 0, threads: 0 },
};
function clonePrompts(value: WorldSimulationSettings_ACU['agentPrompts']): WorldSimulationSettings_ACU['agentPrompts'] {
  return Object.fromEntries(agents.map(agent => [agent.name, value[agent.name].map(segment => ({ ...segment }))])) as WorldSimulationSettings_ACU['agentPrompts'];
}
function clone(value: WorldSimulationSettings_ACU): WorldSimulationSettings_ACU {
  return { ...value, budgets: { light: { ...value.budgets.light }, normal: { ...value.budgets.normal }, deep: { ...value.budgets.deep } }, agentPrompts: clonePrompts(value.agentPrompts) };
}
const emit = defineEmits<{ (event: 'saved', settings: WorldSimulationSettings_ACU): void }>();
const draft = ref(clone(readWorldSimulationSettings_ACU() ?? buildDefaultWorldSimulationSettings_ACU()));
const message = ref<{ kind: 'success' | 'error'; text: string } | null>(null);
const promptTransfer = ref('');
const previewAgent = ref<WorldSimulationAgentName_ACU>('world-director');
const previewMessages = computed(() => {
  const agent = previewAgent.value === 'world-director'
    ? WORLD_SIMULATION_DIRECTOR_DEFINITION_ACU
    : findWorldSimulationAgent_ACU(previewAgent.value);
  if (!agent) return [];
  return renderWorldSimulationAgentMessages_ACU({
    agent, prompts: draft.value.agentPrompts, snapshot: previewSnapshot, storyClock: previewSnapshot.storyClock,
    reads: [], mode: agent.name === 'world-director' ? 'master' : 'specialist',
  });
});
function asNumber(value: string | number): number { return Number(value); }
function setBudgetNumber(scale: WorldSimulationScale_ACU, key: typeof budgetNumberFields[number]['key'], value: string | number): void { draft.value.budgets[scale][key] = asNumber(value); }
function addPromptSegment(agent: WorldSimulationAgentName_ACU, position: 'top' | 'bottom'): void {
  const segment: WorldSimulationPromptSegment_ACU = { role: 'user', content: '', enabled: true, deletable: true };
  if (position === 'top') draft.value.agentPrompts[agent].unshift(segment);
  else draft.value.agentPrompts[agent].push(segment);
}
function deletePromptSegment(agent: WorldSimulationAgentName_ACU, index: number): void { draft.value.agentPrompts[agent].splice(index, 1); }
function movePromptSegment(agent: WorldSimulationAgentName_ACU, index: number, delta: -1 | 1): void {
  const segments = draft.value.agentPrompts[agent]; const next = index + delta;
  if (next < 0 || next >= segments.length) return;
  const [segment] = segments.splice(index, 1); segments.splice(next, 0, segment);
}
function updatePromptSegment(agent: WorldSimulationAgentName_ACU, index: number, patch: { role?: string; content?: string; enabled?: boolean }): void {
  const segment = draft.value.agentPrompts[agent][index];
  if (!segment) return;
  const role = patch.role === 'system' || patch.role === 'user' || patch.role === 'assistant' ? patch.role as WorldSimulationPromptRole_ACU : segment.role;
  draft.value.agentPrompts[agent][index] = { ...segment, role, ...(typeof patch.content === 'string' ? { content: patch.content } : {}), ...(typeof patch.enabled === 'boolean' ? { enabled: patch.enabled } : {}) };
}
function restoreDefaultPrompts(): void { draft.value.agentPrompts = clonePrompts(buildDefaultWorldSimulationAgentPrompts_ACU()); message.value = { kind: 'success', text: '已恢复本地默认伪 Role 提示词；尚未保存。' }; }
function exportPrompts(): void { promptTransfer.value = JSON.stringify(draft.value.agentPrompts, null, 2); message.value = { kind: 'success', text: '已导出到下方文本框；尚未保存。' }; }
function importPrompts(): void {
  try {
    const imported = JSON.parse(promptTransfer.value);
    const candidate = { ...buildDefaultWorldSimulationSettings_ACU(), agentPrompts: imported };
    if (!isWorldSimulationSettings_ACU(candidate)) throw new Error('JSON 不是完整、受限的四角色提示词配置');
    draft.value.agentPrompts = clonePrompts(candidate.agentPrompts);
    message.value = { kind: 'success', text: '伪 Role 提示词已导入本地草稿；尚未保存。' };
  } catch (error) { message.value = { kind: 'error', text: `导入失败：${error instanceof Error ? error.message : String(error)}` }; }
}
async function save(): Promise<void> {
  const result = await writeWorldSimulationSettingsStrict_ACU(clone(draft.value));
  if (!result.ok) {
    message.value = { kind: 'error', text: result.reason === 'store_unavailable'
      ? '设置存储不可用，未保存。'
      : result.reason === 'persist_failed'
        ? '设置持久化失败，已恢复保存前的配置。'
        : '设置无效，未保存。' };
    return;
  }
  const saved = readWorldSimulationSettings_ACU();
  if (!saved) { message.value = { kind: 'error', text: '设置保存后无法重新读取，未刷新界面状态。' }; return; }
  draft.value = clone(saved);
  emit('saved', clone(saved));
  message.value = { kind: 'success', text: result.upgraded ? '设置已保存并升级旧格式。' : '世界推演设置已保存。' };
}
</script>

<style scoped>
.world-simulation-settings__numbers{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.world-simulation-settings__budget,.world-simulation-settings__prompts{display:grid;gap:10px;margin-top:14px;padding-top:12px;border-top:1px solid color-mix(in srgb,var(--acu-text-3) 18%,transparent)}.world-simulation-settings__prompt-heading,.world-simulation-settings__actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.world-simulation-settings__prompt-heading>div:first-child{flex:1 1 340px}.world-simulation-settings__prompt-heading p,.world-simulation-settings__prompt-transfer p{margin:5px 0 0;color:var(--acu-text-3);font-size:12px}.world-simulation-settings__prompt-agent,.world-simulation-settings__prompt-transfer,.world-simulation-settings__prompt-preview{display:grid;gap:10px;padding:10px;border:1px solid color-mix(in srgb,var(--acu-text-3) 18%,transparent);border-radius:7px}.world-simulation-settings__prompt-agent summary,.world-simulation-settings__prompt-transfer summary,.world-simulation-settings__prompt-preview summary{cursor:pointer;font-size:13px}.world-simulation-settings__message-preview{display:grid;gap:8px;margin:0;padding:0;list-style:none}.world-simulation-settings__message-preview li{padding:8px;border-radius:6px;background:var(--acu-bg-2)}.world-simulation-settings__message-preview pre{margin:5px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;font-size:12px;color:var(--acu-text-2)}@media (max-width:640px){.world-simulation-settings__numbers{grid-template-columns:1fr}}
</style>
