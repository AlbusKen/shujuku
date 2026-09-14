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
    <AcuFormRow label="允许 Agent 使用 read/search" hint="关闭后主/子 Agent 只能依据固定正文、账本、当前要求与已分配资料收敛；不会隐式恢复工具。">
      <AcuToggle :model-value="draft.toolsEnabled" @update:model-value="draft.toolsEnabled = $event" />
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
      <p v-if="draft.budgets[scale].legacyReadCount !== null" class="world-simulation-settings__legacy">已兼容读取旧版累计读取数：{{ draft.budgets[scale].legacyReadCount }}。它不再限制当前运行；现在由模型轮次与单批读取围栏控制。</p>
    </section>
    <section class="world-simulation-settings__prompts">
      <div class="world-simulation-settings__prompt-heading">
        <div><strong>四角色提示词布局（v6 具名块）</strong><p>五层结构：系统宪章 → 真实 run 历史锚点 → 单一运行时上下文 → assistant 确认 → 执行边界。锁定块只可移动位置；用户自定义段保持完整编辑。正文、要求、世界书、工具结果和委派始终作为独立 user-role UNTRUSTED 消息。</p></div>
        <div class="world-simulation-settings__actions"><AcuButton size="sm" @click="restoreDefaultPrompts">恢复默认提示词</AcuButton><AcuButton size="sm" @click="exportPrompts">导出到文本</AcuButton></div>
      </div>
      <details v-for="agent in agents" :key="agent.name" class="world-simulation-settings__prompt-agent" :open="agent.name === 'world-director'">
        <summary>{{ agent.label }} · {{ agent.hint }}</summary>
        <ol class="world-simulation-settings__prompt-blocks">
          <li v-for="block in blockViews[agent.name]" :key="block.index" :class="{ 'is-locked': block.locked }">
            <div class="world-simulation-settings__prompt-block-head">
              <strong>{{ block.name }}</strong>
              <span class="world-simulation-settings__prompt-block-role">[{{ block.role.toUpperCase() }}]</span>
              <span v-if="block.locked" class="world-simulation-settings__prompt-block-badge">锁定</span>
              <span class="world-simulation-settings__prompt-block-kind">{{ block.kind === 'placeholder' ? '引擎占位符' : block.kind === 'anchor' ? '引擎静态' : '自定义' }}</span>
            </div>
            <p class="world-simulation-settings__prompt-block-desc">{{ block.description }}</p>
            <textarea v-if="!block.locked" :value="block.editableContent" rows="4" @input="updatePrompt(agent.name, block.index, { content: ($event.target as HTMLTextAreaElement).value })"></textarea>
            <pre v-else-if="block.token" class="world-simulation-settings__prompt-block-token">{{ block.token }}</pre>
            <div class="world-simulation-settings__actions">
              <AcuButton size="sm" :disabled="block.index === 0" @click="movePrompt(agent.name, block.index, -1)">上移</AcuButton>
              <AcuButton size="sm" :disabled="block.index === draft.agentPrompts[agent.name].length - 1" @click="movePrompt(agent.name, block.index, 1)">下移</AcuButton>
              <AcuButton size="sm" :disabled="block.locked" @click="deletePrompt(agent.name, block.index)">删除</AcuButton>
            </div>
          </li>
        </ol>
        <div class="world-simulation-settings__actions"><AcuButton size="sm" @click="addPrompt(agent.name, 'bottom')">添加自定义段</AcuButton></div>
      </details>
      <details class="world-simulation-settings__prompt-transfer">
        <summary>导入 / 导出 Prompt Segments JSON</summary>
        <p>导入只更新本地草稿；请在核对四个角色后点击底部保存。不会导入世界账本、会话或正文。</p>
        <AcuTextarea :model-value="promptsTransfer" :rows="8" placeholder="点击“导出到文本”后在此复制，或粘贴四角色 Prompt Segments JSON 后导入。" @update:model-value="promptsTransfer = $event" />
        <div class="world-simulation-settings__actions"><AcuButton size="sm" @click="importPrompts">从文本导入</AcuButton><AcuButton size="sm" :disabled="!promptsTransfer" @click="promptsTransfer = ''">清空文本</AcuButton></div>
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
import type { WorldReadBudgetTier_ACU, WorldSimulationAgentName_ACU, WorldSimulationAgentPrompts_ACU, WorldSimulationPromptSegment_ACU, WorldSimulationScale_ACU, WorldSimulationSettings_ACU, WorldVisibilityPolicy_ACU } from '../../service/simulation/model';
import { buildWorldSimulationPromptBlocks_ACU, type WorldSimulationPromptBlockView_ACU } from '../composables/useWorldSimulationPromptBlocks';
import { isWorldSimulationSettings_ACU, readWorldSimulationSettings_ACU, readWorldSimulationSettingsUpgrade_ACU, writeWorldSimulationSettingsStrict_ACU } from '../../service/simulation/simulation-settings';
import { renderWorldSimulationAgentMessages_ACU } from '../../service/simulation/world-simulation-agent-prompts';
import AcuButton from './_lib/AcuButton.vue';
import AcuFormRow from './_lib/AcuFormRow.vue';
import AcuInput from './_lib/AcuInput.vue';
import AcuMessage from './_lib/AcuMessage.vue';
import AcuPanel from './_lib/AcuPanel.vue';
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
const budgetNumberFields = [
  { key: 'maxMasterModelTurns', label: '主 Agent 模型轮次', min: 1 },
  { key: 'maxSpecialistModelTurns', label: '每个子代理模型轮次', min: 1 },
  { key: 'maxDelegations', label: '最大委派', min: 0 },
] as const;
const visibilityOptions = [{ value: 'agent', label: '由 Agent 决定' }, { value: 'always_hidden', label: '始终隐藏' }, { value: 'always_revealed', label: '始终公开' }];
const tierOptions = [{ value: 'low', label: '低' }, { value: 'medium', label: '中' }, { value: 'high', label: '高' }];
const agents: ReadonlyArray<{ name: WorldSimulationAgentName_ACU; label: string; hint: string }> = [
  { name: 'world-director', label: '主 Agent（world-director）', hint: '只能选择子代理，不能直接写账本。' },
  { name: 'entity-movement', label: '实体子代理（entity-movement）', hint: '仅 entities。' },
  { name: 'faction-events', label: '事件子代理（faction-events）', hint: '仅 events。' },
  { name: 'thread-weaver', label: '线索子代理（thread-weaver）', hint: '仅 threads。' },
];
const previewAgentOptions = agents.map(agent => ({ value: agent.name, label: agent.label }));
const blockViews = computed<Record<WorldSimulationAgentName_ACU, WorldSimulationPromptBlockView_ACU[]>>(() => Object.fromEntries(
  agents.map(agent => [agent.name, buildWorldSimulationPromptBlocks_ACU(agent.name, draft.value.agentPrompts[agent.name])]),
) as Record<WorldSimulationAgentName_ACU, WorldSimulationPromptBlockView_ACU[]>);
const previewSnapshot = {
  anchorMessageIndex: 0,
  storyClock: { anchorText: '预览锚点', elapsedSinceLastRun: '即时', precision: 'unknown' as const, evidenceIndexes: [], updatedIndex: 0 },
  entities: [], events: [], threads: [], revisions: { entities: 0, events: 0, threads: 0 },
};
function clonePrompts(value: WorldSimulationAgentPrompts_ACU): WorldSimulationAgentPrompts_ACU {
  return Object.fromEntries(agents.map(agent => [agent.name, value[agent.name].map(segment => ({ ...segment }))])) as WorldSimulationAgentPrompts_ACU;
}
function clone(value: WorldSimulationSettings_ACU): WorldSimulationSettings_ACU {
  return { ...value, budgets: { light: { ...value.budgets.light }, normal: { ...value.budgets.normal }, deep: { ...value.budgets.deep } }, agentPrompts: clonePrompts(value.agentPrompts) };
}
const emit = defineEmits<{ (event: 'saved', settings: WorldSimulationSettings_ACU): void }>();
const loaded = readWorldSimulationSettingsUpgrade_ACU();
const draft = ref(clone(loaded?.settings ?? buildDefaultWorldSimulationSettings_ACU()));
const message = ref<{ kind: 'success' | 'error'; text: string } | null>(null);
const promptsTransfer = ref('');
const previewAgent = ref<WorldSimulationAgentName_ACU>('world-director');
const previewMessages = computed(() => {
  const agent = previewAgent.value === 'world-director'
    ? WORLD_SIMULATION_DIRECTOR_DEFINITION_ACU
    : findWorldSimulationAgent_ACU(previewAgent.value);
  if (!agent) return [];
  return renderWorldSimulationAgentMessages_ACU({
    agent, prompts: draft.value.agentPrompts, toolsEnabled: draft.value.toolsEnabled, snapshot: previewSnapshot, storyClock: previewSnapshot.storyClock,
    reads: [], mode: agent.name === 'world-director' ? 'master' : 'specialist',
  });
});
function asNumber(value: string | number): number { return Number(value); }
function setBudgetNumber(scale: WorldSimulationScale_ACU, key: typeof budgetNumberFields[number]['key'], value: string | number): void { draft.value.budgets[scale][key] = asNumber(value); }
function promptList(agent: WorldSimulationAgentName_ACU): WorldSimulationPromptSegment_ACU[] { return draft.value.agentPrompts[agent]; }
function addPrompt(agent: WorldSimulationAgentName_ACU, position: 'top' | 'bottom'): void {
  const prompts = promptList(agent);
  const segment: WorldSimulationPromptSegment_ACU = { role: 'user', content: '请填写提示词内容。', enabled: true, deletable: true };
  if (position === 'top') prompts.unshift(segment); else prompts.push(segment);
}
function deletePrompt(agent: WorldSimulationAgentName_ACU, index: number): void {
  const prompts = promptList(agent);
  if (prompts[index]?.deletable !== false) prompts.splice(index, 1);
}
function movePrompt(agent: WorldSimulationAgentName_ACU, index: number, delta: -1 | 1): void {
  const prompts = promptList(agent); const target = index + delta;
  if (target >= 0 && target < prompts.length) [prompts[index], prompts[target]] = [prompts[target], prompts[index]];
}
function updatePrompt(agent: WorldSimulationAgentName_ACU, index: number, patch: Partial<WorldSimulationPromptSegment_ACU>): void {
  const current = promptList(agent)[index];
  if (current) promptList(agent)[index] = { ...current, ...patch };
}
function restoreDefaultPrompts(): void {
  draft.value.agentPrompts = clonePrompts(buildDefaultWorldSimulationAgentPrompts_ACU());
  message.value = { kind: 'success', text: '已恢复本地默认提示词；尚未保存。' };
}
function exportPrompts(): void { promptsTransfer.value = JSON.stringify(draft.value.agentPrompts, null, 2); message.value = { kind: 'success', text: '已导出到下方文本框；尚未保存。' }; }
/** v6 必需引擎锚点：导入布局不可缺失；缺失即整体拒绝（fail-closed）。 */
const REQUIRED_PROMPT_ANCHORS_ACU = ['$WORLD_SIMULATION_ROOT', '$WORLD_SIMULATION_HISTORY', '$WORLD_SIMULATION_RUNTIME_CONTEXT', '$WORLD_SIMULATION_EXECUTION_BOUNDARY'] as const;
function promptsKeepRequiredAnchors_ACU(prompts: WorldSimulationAgentPrompts_ACU): boolean {
  return agents.every(agent => {
    const contents = prompts[agent.name].map(segment => segment.content.trim());
    return REQUIRED_PROMPT_ANCHORS_ACU.every(anchor => contents.includes(anchor))
      && (agent.name === 'world-director' || contents.includes('$WORLD_SIMULATION_SPECIALIST_RULES'));
  });
}
function importPrompts(): void {
  try {
    const imported = JSON.parse(promptsTransfer.value);
    const candidate = { ...buildDefaultWorldSimulationSettings_ACU(), agentPrompts: imported };
    if (!isWorldSimulationSettings_ACU(candidate)) throw new Error('JSON 不是完整的四角色 Prompt Segments 配置');
    if (!promptsKeepRequiredAnchors_ACU(candidate.agentPrompts)) throw new Error('导入布局缺失 v6 必需引擎锚点（宪章/历史/运行时上下文/执行边界等），已拒绝');
    draft.value.agentPrompts = clonePrompts(candidate.agentPrompts);
    message.value = { kind: 'success', text: 'Prompt Segments 已导入本地草稿；尚未保存。' };
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
