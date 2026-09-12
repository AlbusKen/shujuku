<template>
  <AcuPanel title="世界推演" description="仅在你明确保存后启用或更新。面板挂载只读取当前快照，绝不覆盖历史配置。">
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
    <AcuMessage v-if="message" :kind="message.kind">{{ message.text }}</AcuMessage>
    <AcuButton variant="primary" @click="save">保存世界推演设置</AcuButton>
  </AcuPanel>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { buildDefaultWorldSimulationSettings_ACU } from '../../service/simulation/defaults';
import { readWorldSimulationSettings_ACU, writeWorldSimulationSettings_ACU } from '../../service/simulation/simulation-settings';
import type { WorldReadBudgetTier_ACU, WorldSimulationScale_ACU, WorldSimulationSettings_ACU, WorldVisibilityPolicy_ACU } from '../../service/simulation/model';
import AcuButton from './_lib/AcuButton.vue';
import AcuFormRow from './_lib/AcuFormRow.vue';
import AcuInput from './_lib/AcuInput.vue';
import AcuMessage from './_lib/AcuMessage.vue';
import AcuPanel from './_lib/AcuPanel.vue';
import AcuSelect from './_lib/AcuSelect.vue';
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
function clone(value: WorldSimulationSettings_ACU): WorldSimulationSettings_ACU { return { ...value, budgets: { light: { ...value.budgets.light }, normal: { ...value.budgets.normal }, deep: { ...value.budgets.deep } } }; }
const draft = ref(clone(readWorldSimulationSettings_ACU() ?? buildDefaultWorldSimulationSettings_ACU()));
const message = ref<{ kind: 'success' | 'error'; text: string } | null>(null);
function asNumber(value: string | number): number { return Number(value); }
function setBudgetNumber(scale: WorldSimulationScale_ACU, key: typeof budgetNumberFields[number]['key'], value: string | number): void { draft.value.budgets[scale][key] = asNumber(value); }
function save(): void { const result = writeWorldSimulationSettings_ACU(clone(draft.value)); message.value = result.ok ? { kind: 'success', text: result.upgraded ? '设置已保存并升级旧格式。' : '世界推演设置已保存。' } : { kind: 'error', text: result.reason === 'store_unavailable' ? '设置存储不可用，未保存。' : '设置无效，未保存。' }; }
</script>
