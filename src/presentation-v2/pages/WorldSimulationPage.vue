<template>
  <section class="acu-v2-world-simulation-page">
      <AcuPanel title="世界状态" class="acu-v2-world-simulation-page__world-state">
        <template #title>
          <button type="button" class="acu-v2-world-simulation-page__world-title" :aria-expanded="worldStateExpanded" aria-controls="acu-world-state-content" @click="worldStateExpanded = !worldStateExpanded">世界状态<span class="acu-v2-world-simulation-page__floor">{{ runtime.anchor.value ? runtime.anchorText.value : '未确定' }}</span></button>
        </template>
        <template #actions>
          <AcuIconButton icon="fa-solid fa-rotate-right" title="刷新世界状态" aria-label="刷新世界状态" :disabled="runtime.busy.value" @click="refreshAll" />
          <AcuIconButton icon="fa-solid fa-trash" variant="danger" title="清空世界状态" aria-label="清空世界状态" :disabled="runtime.busy.value || !runtime.ready.value" @click="requestWorldStateClear" />
        </template>
        <div id="acu-world-state-content" v-show="worldStateExpanded">
          <WorldSimulationMaterialsPanel
            v-if="runtime.ready.value && runtime.snapshot.value"
            ref="materialsPanel"
            :field-snapshot="runtime.snapshot.value.fieldSnapshot"
            :ledger="'publishedLedger' in runtime.snapshot.value ? runtime.snapshot.value.publishedLedger ?? null : runtime.snapshot.value.envelope?.ledger ?? null"
            :busy="runtime.busy.value"
            @clear="clearData"
            @delete-actor="onDeleteActor"
            @delete-world-event="onDeleteWorldEvent"
            @delete-world-history="onDeleteWorldHistory"
            @scan-worldbooks="scanWorldbookActors"
          />
          <p v-else class="acu-v2-world-simulation-page__meta">暂无世界状态。</p>
        </div>
      </AcuPanel>

    <AcuPanelGrid class="acu-v2-world-simulation-page__layout">
      <AcuPanel title="世界推演会话">
        <p v-if="runtime.error.value" class="acu-v2-world-simulation-page__error">
          {{ runtime.error.value }}
          <AcuButton size="sm" @click="refreshAll">重新读取</AcuButton>
        </p>
        <p v-else-if="!runtime.ready.value" class="acu-v2-world-simulation-page__meta">正在读取并验证格林推演快照…</p>
        <WorldSimulationChat
          v-else
          :task="runtime.task.value"
          :last-error="runtime.envelope.value?.lastError ?? null"
          :entries="runtime.entries.value"
          :running="runtime.running.value"
          :draft="messageDraft"
          :sending="messageSending"
          :status-text="runtime.statusText.value"
          :stage-text="runtime.stageText.value"
          :revision-text="runtime.revisionText.value"
          :anchor-text="runtime.anchorText.value"
          @send="sendMessage"
          @update:draft="messageDraft = $event"
          @stop="runtime.stop"
        />
      </AcuPanel>

      <AcuPanel v-if="settingsDraft" title="推演设置">
        <div class="acu-v2-world-simulation-page__settings-grid">
          <AcuFormRow label="工作流模式">
            <AcuSelect v-model="settingsDraft.workflowMode" :options="workflowModeOptions" />
          </AcuFormRow>
          <AcuFormRow label="投送目标">
            <AcuSelect v-model="settingsDraft.deliveryTarget" :options="deliveryTargetOptions" />
          </AcuFormRow>
          <AcuFormRow label="API 预设（全局默认）">
            <AcuSelect
              :options="apiPresetOptions"
              :model-value="apiPresetValue"
              :placeholder="followActiveApiLabel"
              @update:model-value="applyApiPreset"
            />
          </AcuFormRow>
          <AcuFormRow label="单次请求 token 上限">
            <AcuInput v-model="settingsDraft.agentHistoryTokenBudget" type="number" :min="1" :max="1000000" />
          </AcuFormRow>
          <AcuFormRow label="单批次读取上限">
            <AcuInput v-model="settingsDraft.agentReadTokenBudget" type="text" />
          </AcuFormRow>
          <AcuFormRow label="各角色渠道">
            <AcuDisclosureGroup
              class="acu-v2-world-simulation-page__group acu-v2-world-simulation-page__channels"
              :label="channelGroupMeta"
              :expanded="isGroupExpanded('channels')"
              body-id="acu-world-simulation-group-channels"
              @toggle="toggleGroup('channels')"
            >
              <div class="acu-v2-world-simulation-page__channel-fields">
                <AcuFormRow v-for="agentName in agentNames" :key="agentName" :label="agentLabel(agentName)">
                  <AcuSelect
                    :options="agentChannelOptions"
                    :model-value="agentChannelValue(agentName)"
                    @update:model-value="value => applyAgentChannel(agentName, value)"
                  />
                </AcuFormRow>
              </div>
            </AcuDisclosureGroup>
          </AcuFormRow>
        </div>
        <div class="acu-v2-world-simulation-page__toggles">
          <AcuCheckbox class="acu-v2-world-simulation-page__auto-trigger" v-model="settingsDraft.autoTriggerEnabled" label="自动推演" />
        </div>

        <p v-if="settingsError" class="acu-v2-world-simulation-page__error">{{ settingsError }}</p>
        <p v-if="settingsNotice" class="acu-v2-world-simulation-page__meta">{{ settingsNotice }}</p>
      </AcuPanel>
    </AcuPanelGrid>

    <AcuPanel v-if="runtime.ready.value && runtime.snapshot.value" title="用户要求" class="acu-v2-world-simulation-page__requirements">
      <WorldSimulationRequirementsPanel
        :chat-identity="runtime.anchor.value?.chatIdentity ?? null"
        :user-requirements="runtime.snapshot.value.userRequirements"
        :save-requirements="runtime.saveUserRequirements"
        :busy="runtime.busy.value"
      />
    </AcuPanel>

    <AcuPanel v-if="settingsDraft" title="推演提示词">
      <div class="acu-v2-world-simulation-page__actions acu-v2-world-simulation-page__actions--start">
        <AcuButton @click="exportWorldRoundPrompts">导出推演提示词 JSON</AcuButton>
        <AcuButton @click="openWorldRoundPromptImport">导入推演提示词 JSON</AcuButton>
        <input
          ref="worldRoundPromptImportInput"
          class="acu-v2-world-simulation-page__file-input"
          type="file"
          accept="application/json,.json"
          @change="importWorldRoundPrompts"
        >
      </div>
      <div class="acu-v2-world-simulation-page__groups">
        <AcuDisclosureGroup
          v-for="roleKey in worldRoundPromptRoles"
          :key="roleKey"
          class="acu-v2-world-simulation-page__group"
          :label="worldRoundPromptLabel(roleKey)"
          :meta="worldRoundPromptGroupMeta(roleKey)"
          :expanded="isGroupExpanded(`world-round-prompt:${roleKey}`)"
          :body-id="`acu-world-round-prompt-${roleKey}`"
          @toggle="toggleGroup(`world-round-prompt:${roleKey}`)"
        >
          <template v-if="worldRoundPromptSegments(roleKey).length">
            <div
              v-for="(segment, index) in worldRoundPromptSegments(roleKey)"
              :key="`${roleKey}-${index}`"
              class="acu-v2-world-simulation-page__prompt-segment"
            >
              <div class="acu-v2-world-simulation-page__prompt-segment-actions">
                <AcuSelect
                  :model-value="segment.role"
                  :options="worldRoundPromptRoleOptions"
                  @update:model-value="value => updateWorldRoundPromptRole(roleKey, index, value)"
                />
                <AcuCheckbox
                  :model-value="segment.enabled"
                  label="启用"
                  @update:model-value="value => updateWorldRoundPromptEnabled(roleKey, index, value)"
                />
                <AcuButton size="sm" :disabled="index === 0" @click="moveWorldRoundPromptSegment(roleKey, index, -1)">上移</AcuButton>
                <AcuButton size="sm" :disabled="index === worldRoundPromptSegments(roleKey).length - 1" @click="moveWorldRoundPromptSegment(roleKey, index, 1)">下移</AcuButton>
                <AcuButton size="sm" :disabled="!segment.deletable || segment.pinned" @click="deleteWorldRoundPromptSegment(roleKey, index)">删除</AcuButton>
              </div>
              <textarea
                class="acu-v2-world-simulation-page__prompt-textarea"
                :value="segment.content"
                rows="5"
                aria-label="提示词内容"
                @input="updateWorldRoundPromptContent(roleKey, index, $event)"
              />
            </div>
          </template>
          <p v-else class="acu-v2-world-simulation-page__meta">{{ isExplicitlyDisabledWorldRoundPrompt(roleKey) ? '已关闭' : '未配置' }}</p>
          <div class="acu-v2-world-simulation-page__actions acu-v2-world-simulation-page__actions--start">
            <AcuButton v-if="hasExplicitWorldRoundPrompt(roleKey) && getDefaultWorldRoundPromptSegments_ACU(roleKey).length" size="sm" @click="restoreDefaultWorldRoundPrompt(roleKey)">恢复默认</AcuButton>
            <AcuButton size="sm" @click="addWorldRoundPromptSegment(roleKey)">添加段</AcuButton>
          </div>
        </AcuDisclosureGroup>
      </div>
    </AcuPanel>

    <details class="acu-v2-world-simulation-page__diagnostics">
      <summary>读取诊断</summary>
      <p v-if="!readingDiagnostics.length" class="acu-v2-world-simulation-page__meta">暂无读取诊断。</p>
      <ul v-else><li v-for="(item, index) in readingDiagnostics" :key="index">{{ item }}</li></ul>
    </details>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import type { WorldSimulationAgentName_ACU } from '../../service/simulation/agent/agent-catalog';
import { validateWorldRoundPrompts_ACU, type WorldRoundPromptRole_ACU } from '../../service/simulation/agent/world-round-prompts';
import { getDefaultWorldRoundPromptSegments_ACU } from '../../service/simulation/agent/world-round-prompt-defaults';
import type { WorldSimulationPromptSegment_ACU, WorldSimulationSettings_ACU } from '../../service/simulation/model';
import AcuButton from '../components/_lib/AcuButton.vue';
import AcuCheckbox from '../components/_lib/AcuCheckbox.vue';
import AcuDisclosureGroup from '../components/_lib/AcuDisclosureGroup.vue';
import AcuFormRow from '../components/_lib/AcuFormRow.vue';
import AcuIconButton from '../components/_lib/AcuIconButton.vue';
import AcuInput from '../components/_lib/AcuInput.vue';
import AcuPanel from '../components/_lib/AcuPanel.vue';
import AcuPanelGrid from '../components/_lib/AcuPanelGrid.vue';
import AcuSelect from '../components/_lib/AcuSelect.vue';
import WorldSimulationChat from '../components/WorldSimulationChat.vue';
import WorldSimulationMaterialsPanel from '../components/WorldSimulationMaterialsPanel.vue';
import WorldSimulationRequirementsPanel from '../components/WorldSimulationRequirementsPanel.vue';
import { useApiPresetSelectOptions } from '../composables/useApiPresetSelectOptions';
import { useChatChangedTick, useChatMutationTick } from '../composables/useChatChangedListener';
import { useWorldSimulationRuntime } from '../composables/useWorldSimulationRuntime';
import { worldSimulationAgentLabel_ACU } from '../copy/world-simulation-copy';
import { useDialogStore } from '../stores/dialog-store';

const runtime = useWorldSimulationRuntime();
const readingDiagnostics = computed(() => [
  ...(runtime.snapshot.value?.conversation.diagnostics ?? []),
  ...(runtime.snapshot.value?.materials.diagnostics ?? []),
]);
const dialog = useDialogStore();
const { apiStore, followActiveApiLabel, apiPresetSelectOptions: apiPresetOptions } = useApiPresetSelectOptions();
const worldStateExpanded = ref(true);
const materialsPanel = ref<InstanceType<typeof WorldSimulationMaterialsPanel> | null>(null);
function requestWorldStateClear(): void {
  worldStateExpanded.value = true;
  materialsPanel.value?.requestClear();
}
const settingsDraft = ref<WorldSimulationSettings_ACU | null>(null);
const messageDraft = ref('');
const messageSending = ref(false);
const settingsError = ref('');
const settingsNotice = ref('');

const agentNames = [
  'timekeeper',
  'undercurrent-analyst',
  'dramatis-keeper',
  'guidance-composer',
] as const satisfies readonly WorldSimulationAgentName_ACU[];
const agentLabel = worldSimulationAgentLabel_ACU;

const worldRoundPromptRoles = ['clock-recaller', 'world-event-analyst', 'actor-simulator', 'worldbook-registrar', 'joint-reviewer', 'world-simulator'] as const satisfies readonly WorldRoundPromptRole_ACU[];
type CurrentWorldRoundPromptRole = typeof worldRoundPromptRoles[number];
const WORLD_ROUND_PROMPT_LABELS: Record<CurrentWorldRoundPromptRole, string> = {
  'clock-recaller': '时钟与召回',
  'world-simulator': '单模式附加自定义',
  'world-event-analyst': '世界事件',
  'actor-simulator': '人物推演',
  'worldbook-registrar': '世界书角色整理',
  'joint-reviewer': '联合审查',
};
const worldRoundPromptRoleOptions = [
  { value: 'system', label: 'system' },
  { value: 'user', label: 'user' },
  { value: 'assistant', label: 'assistant' },
];
const worldRoundPromptImportInput = ref<HTMLInputElement | null>(null);

function worldRoundPromptLabel(roleKey: CurrentWorldRoundPromptRole): string {
  return WORLD_ROUND_PROMPT_LABELS[roleKey];
}

function worldRoundPromptSegments(roleKey: CurrentWorldRoundPromptRole): WorldSimulationPromptSegment_ACU[] {
  const configured = settingsDraft.value?.worldRoundPrompts;
  return Object.prototype.hasOwnProperty.call(configured ?? {}, roleKey)
    ? configured?.[roleKey] ?? []
    : getDefaultWorldRoundPromptSegments_ACU(roleKey);
}

function hasExplicitWorldRoundPrompt(roleKey: CurrentWorldRoundPromptRole): boolean {
  return Object.prototype.hasOwnProperty.call(settingsDraft.value?.worldRoundPrompts ?? {}, roleKey);
}

function isExplicitlyDisabledWorldRoundPrompt(roleKey: CurrentWorldRoundPromptRole): boolean {
  return hasExplicitWorldRoundPrompt(roleKey)
    && (settingsDraft.value?.worldRoundPrompts?.[roleKey] ?? []).length === 0
    && getDefaultWorldRoundPromptSegments_ACU(roleKey).length > 0;
}

function worldRoundPromptGroupMeta(roleKey: CurrentWorldRoundPromptRole): string {
  const segments = worldRoundPromptSegments(roleKey);
  return segments.length ? `${segments.filter(segment => segment.enabled).length}/${segments.length} 段启用` : '未配置';
}

function updateWorldRoundPromptSegments(roleKey: CurrentWorldRoundPromptRole, segments: WorldSimulationPromptSegment_ACU[]): void {
  if (!settingsDraft.value) return;
  settingsDraft.value.worldRoundPrompts = { ...(settingsDraft.value.worldRoundPrompts ?? {}), [roleKey]: segments };
}

function addWorldRoundPromptSegment(roleKey: CurrentWorldRoundPromptRole): void {
  updateWorldRoundPromptSegments(roleKey, [...worldRoundPromptSegments(roleKey), { role: 'system', content: '', enabled: true, deletable: true, pinned: false }]);
}

async function restoreDefaultWorldRoundPrompt(roleKey: CurrentWorldRoundPromptRole): Promise<void> {
  if (!settingsDraft.value || !hasExplicitWorldRoundPrompt(roleKey) || !getDefaultWorldRoundPromptSegments_ACU(roleKey).length) return;
  const confirmed = await dialog.confirm({
    title: '恢复默认业务稿',
    message: `将替换「${worldRoundPromptLabel(roleKey)}」当前的自定义设置，恢复默认提示词。`,
    confirmLabel: '恢复默认',
    cancelLabel: '取消',
  });
  if (!confirmed || !settingsDraft.value) return;
  const next = { ...(settingsDraft.value.worldRoundPrompts ?? {}) };
  delete next[roleKey];
  settingsDraft.value.worldRoundPrompts = next;
}

function updateWorldRoundPromptRole(roleKey: CurrentWorldRoundPromptRole, index: number, role: string): void {
  const segments = [...worldRoundPromptSegments(roleKey)];
  const segment = segments[index];
  if (!segment || !['system', 'user', 'assistant'].includes(role)) return;
  segments[index] = { ...segment, role };
  updateWorldRoundPromptSegments(roleKey, segments);
}

function updateWorldRoundPromptEnabled(roleKey: CurrentWorldRoundPromptRole, index: number, enabled: boolean): void {
  const segments = [...worldRoundPromptSegments(roleKey)];
  const segment = segments[index];
  if (!segment) return;
  segments[index] = { ...segment, enabled };
  updateWorldRoundPromptSegments(roleKey, segments);
}

function updateWorldRoundPromptContent(roleKey: CurrentWorldRoundPromptRole, index: number, event: Event): void {
  const segments = [...worldRoundPromptSegments(roleKey)];
  const segment = segments[index];
  if (!segment) return;
  segments[index] = { ...segment, content: (event.target as HTMLTextAreaElement).value };
  updateWorldRoundPromptSegments(roleKey, segments);
}

function deleteWorldRoundPromptSegment(roleKey: CurrentWorldRoundPromptRole, index: number): void {
  const segments = [...worldRoundPromptSegments(roleKey)];
  const segment = segments[index];
  if (!segment || !segment.deletable || segment.pinned) return;
  segments.splice(index, 1);
  updateWorldRoundPromptSegments(roleKey, segments);
}

function moveWorldRoundPromptSegment(roleKey: CurrentWorldRoundPromptRole, index: number, direction: -1 | 1): void {
  const segments = [...worldRoundPromptSegments(roleKey)];
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= segments.length) return;
  [segments[index], segments[nextIndex]] = [segments[nextIndex], segments[index]];
  updateWorldRoundPromptSegments(roleKey, segments);
}

function exportWorldRoundPrompts(): void {
  if (!settingsDraft.value) return;
  const effective = Object.fromEntries(worldRoundPromptRoles.map(role => [role, worldRoundPromptSegments(role)]));
  downloadJson('acu-world-round-prompts.json', { worldRoundPrompts: effective });
}

function openWorldRoundPromptImport(): void {
  worldRoundPromptImportInput.value?.click();
}

async function importWorldRoundPrompts(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || !settingsDraft.value) return;
  try {
    const parsed: unknown = JSON.parse(await file.text());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !('worldRoundPrompts' in parsed)) throw new Error('导入文件必须包含 worldRoundPrompts 映射');
    const worldRoundPrompts = validateWorldRoundPrompts_ACU((parsed as { worldRoundPrompts: unknown }).worldRoundPrompts);
    settingsDraft.value.worldRoundPrompts = Object.fromEntries(worldRoundPromptRoles
      .filter(role => Object.prototype.hasOwnProperty.call(worldRoundPrompts, role))
      .map(role => [role, worldRoundPrompts[role]]));
    settingsError.value = '';
    settingsNotice.value = '正式提示词已导入，等待自动保存。';
  } catch (error) {
    settingsError.value = error instanceof Error ? `正式提示词导入失败：${error.message}` : '正式提示词导入失败：文件无效';
  }
}

const workflowModeOptions = [
  { value: 'single', label: '单 Agent' },
  { value: 'layered', label: '分层' },
];

const deliveryTargetOptions = [
  { value: 'body', label: '直接正文' },
  { value: 'plot', label: '剧情推进' },
];

/** 渠道下拉里「跟随全局默认」的哨兵值：空串已被「跟随当前活动 API」占用。 */
const INHERIT_CHANNEL_VALUE = '__inherit__';

const apiPresetValue = computed(() => {
  if (!settingsDraft.value) return '';
  return settingsDraft.value.apiPresetMode === 'fixed' ? settingsDraft.value.fixedApiPresetName : '';
});

function applyApiPreset(value: string): void {
  if (!settingsDraft.value) return;
  const trimmed = String(value || '').trim();
  if (trimmed) {
    settingsDraft.value.apiPresetMode = 'fixed';
    settingsDraft.value.fixedApiPresetName = trimmed;
  } else {
    settingsDraft.value.apiPresetMode = 'current';
    settingsDraft.value.fixedApiPresetName = '';
  }
  // 渠道选择与智能续写一致：选择即保存，不等防抖窗口，避免用户离开页面时选择丢失。
  saveSettingsImmediately();
}

const agentChannelOptions = computed(() => [
  { value: INHERIT_CHANNEL_VALUE, label: '跟随全局默认' },
  ...apiPresetOptions.value,
]);

/** 格林推演的渠道映射以「键不存在」表示跟随全局默认，与 settings validator 的闭合契约一致。 */
function agentChannelValue(agentName: typeof agentNames[number]): string {
  const choice = settingsDraft.value?.agentApiPresets[agentName];
  if (!choice) return INHERIT_CHANNEL_VALUE;
  return choice.mode === 'fixed' ? choice.presetName : '';
}

function applyAgentChannel(agentName: typeof agentNames[number], value: string): void {
  if (!settingsDraft.value) return;
  const trimmed = String(value ?? '').trim();
  const next = { ...settingsDraft.value.agentApiPresets };
  if (trimmed === INHERIT_CHANNEL_VALUE) delete next[agentName];
  else if (trimmed) next[agentName] = { mode: 'fixed', presetName: trimmed };
  else next[agentName] = { mode: 'current', presetName: '' };
  settingsDraft.value.agentApiPresets = next;
  saveSettingsImmediately();
}

/** 折叠分组的展开状态：默认全部收起，只在本次打开面板期间记忆。 */
const expandedGroups = reactive<Record<string, boolean>>({});

function isGroupExpanded(key: string): boolean {
  return expandedGroups[key] === true;
}

function toggleGroup(key: string): void {
  expandedGroups[key] = !isGroupExpanded(key);
}

const channelGroupMeta = computed(() => {
  const presets = settingsDraft.value?.agentApiPresets;
  if (!presets) return '';
  const customized = agentNames.filter(name => presets[name] !== undefined).length;
  return customized ? `${customized} 个单独指定` : '全部跟随默认';
});

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function cloneSettings(settings: WorldSimulationSettings_ACU): WorldSimulationSettings_ACU {
  return JSON.parse(JSON.stringify(settings)) as WorldSimulationSettings_ACU;
}

/** 首次发送（即将创建任务）前的高 RPM 风险确认：5 秒倒计时结束前只能取消。 */
async function confirmFirstSendRpmWarning(): Promise<boolean> {
  return dialog.confirm({
    title: '开始格林推演前请确认',
    message: '本功能单次请求占用的 Token 不多，但 Agent 会连续发起大量请求，需要 API 支持很高的 RPM（每分钟请求数）。开启「自动推演」后每次正文生成完成都会再跑一轮。',
    dangerMessage: '禁止使用任何公益站，除非它明确表示允许 coding（本功能的请求模式与 coding 类似）。违规使用可能导致账号被封禁。',
    confirmLabel: '我已了解，开始',
    cancelLabel: '取消',
    confirmVariant: 'danger',
    confirmCountdownSeconds: 5,
  });
}

/** 会话发送：没有任务时创建任务，运行中会打断当前 run 并带着这句话继续或新建。 */
async function sendMessage(text: string): Promise<void> {
  if (messageSending.value) return;
  if (!runtime.task.value && !(await confirmFirstSendRpmWarning())) return;
  if (messageSending.value) return;
  messageSending.value = true;
  try {
    const accepted = await runtime.send(text);
    if (accepted && messageDraft.value.trim() === text) messageDraft.value = '';
  } finally {
    messageSending.value = false;
  }
}

async function clearData(): Promise<void> {
  await runtime.clearData();
}

async function onDeleteActor(id: string): Promise<void> {
  await runtime.deleteActor(id);
}

async function onDeleteWorldEvent(id: string): Promise<void> {
  await runtime.deleteWorldEvent(id);
}

async function onDeleteWorldHistory(id: string): Promise<void> {
  await runtime.deleteWorldHistory(id);
}

async function scanWorldbookActors(): Promise<void> {
  await runtime.scanWorldbookActors();
}

function requiredRangeInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  const numeric = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isInteger(numeric) || numeric < minimum || numeric > maximum) throw new Error(`${label} 必须是 ${minimum} 到 ${maximum} 之间的整数`);
  return numeric;
}

/** 读取预算接受两种形态：正整数（固定 token 数）或 1%-100% 的百分比串（按单次请求上限折算）。 */
function normalizedReadBudget(value: unknown): number | string {
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error('单批次读取上限不能为空');
  if (raw.endsWith('%')) {
    const percent = Number.parseInt(raw, 10);
    if (!Number.isInteger(percent) || percent < 1 || percent > 100 || `${percent}%` !== raw) throw new Error('读取预算百分比必须是 1% 到 100% 之间的整数百分比');
    return `${percent}%`;
  }
  const fixed = Number(raw);
  if (!Number.isInteger(fixed) || fixed < 1 || fixed > 1000000) throw new Error('单批次读取上限必须是 1 到 1000000 的整数，或形如 20% 的百分比');
  return fixed;
}

/** 判断预设名是否存在于当前 API 预设列表中：把悬挂引用从运行中途的任务失败提前到保存时报错。 */
function presetExists(presetName: string): boolean {
  return apiStore.presets.some(preset => preset.name === presetName);
}

function normalizeSettingsDraft(): WorldSimulationSettings_ACU {
  if (!settingsDraft.value) throw new Error('格林推演设置尚未加载');
  const source = settingsDraft.value;
  const normalized: WorldSimulationSettings_ACU = {
    ...cloneSettings(source),
    agentHistoryTokenBudget: requiredRangeInteger(source.agentHistoryTokenBudget, '单次请求 token 上限', 1, 1000000),
    agentReadTokenBudget: normalizedReadBudget(source.agentReadTokenBudget),
  };
  if (normalized.apiPresetMode === 'fixed') {
    const presetName = normalized.fixedApiPresetName.trim();
    if (!presetName) throw new Error('固定 API 预设名称不能为空');
    if (!presetExists(presetName)) throw new Error(`API 预设 "${presetName}" 不存在，请重新选择`);
  }
  for (const agentName of agentNames) {
    const choice = normalized.agentApiPresets[agentName];
    if (!choice || choice.mode !== 'fixed') continue;
    const presetName = choice.presetName.trim();
    if (!presetName) throw new Error(`${agentLabel(agentName)} 的固定渠道必须选择预设`);
    if (!presetExists(presetName)) throw new Error(`${agentLabel(agentName)} 渠道的 API 预设 "${presetName}" 不存在，请重新选择`);
  }
  return normalized;
}

/** 记录最近一次从权威状态装载/保存成功的草稿快照，用于跳过无变化的自动保存并切断"保存→刷新→重建草稿"的循环。 */
let lastPersistedSettingsJson = '';
let settingsSaveTimer: ReturnType<typeof setTimeout> | undefined;

/** 设置修改后自动保存（防抖 800ms），与智能续写/填表工作台的"改动即生效"一致。 */
function scheduleSettingsSave(): void {
  if (settingsSaveTimer !== undefined) clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(() => { void saveSettingsNow(); }, 800);
}

/** 立即触发保存：先取消挂起的防抖计时器再保存，保证渠道类改动不受 800ms 窗口影响。 */
function saveSettingsImmediately(): void {
  if (settingsSaveTimer !== undefined) {
    clearTimeout(settingsSaveTimer);
    settingsSaveTimer = undefined;
  }
  void saveSettingsNow();
}

async function saveSettingsNow(): Promise<void> {
  if (!settingsDraft.value) return;
  if (JSON.stringify(settingsDraft.value) === lastPersistedSettingsJson) return;
  let candidate: WorldSimulationSettings_ACU;
  try {
    apiStore.refreshFromSettings();
    candidate = normalizeSettingsDraft();
  } catch (error) {
    settingsError.value = error instanceof Error ? error.message : '格林推演设置无效';
    return;
  }
  const outcome = await runtime.saveSettings(candidate);
  if (outcome === 'saved') {
    settingsError.value = '';
    settingsNotice.value = '';
  } else if (outcome === 'busy') {
    // Agent 正在运行，改动不能丢：告知用户并排队等本轮结束后落盘。
    settingsNotice.value = '设置已修改：格林推演正在运行，将在本轮结束后自动保存并于下一轮生效。';
    scheduleSettingsSave();
  }
}

/** 刷新页面依赖的全部数据源：API 预设列表必须在挂载与聊天切换时重新读取，否则预设下拉是空的。 */
function refreshAll(): void {
  apiStore.refreshFromSettings();
  runtime.refresh();
  void runtime.initialize();
}

/**
 * 当前聊天内楼层被删除 / swipe 后：任务锚点、Agent 会话与资料快照都锚定在楼层上，
 * 存储层已随楼层回退，会话流必须清空重灌，否则显示的仍是删楼前的记录。
 */
function refreshAfterChatMutation(): void {
  runtime.resyncAfterChatMutation();
}

onMounted(() => {
  apiStore.refreshFromSettings();
  runtime.refresh();
  void runtime.initialize();
});
onBeforeUnmount(() => {
  // 防抖窗口内离开页面时冲刷一次未落盘的改动，避免"改了像改了、重进没了"。
  if (settingsSaveTimer !== undefined) {
    clearTimeout(settingsSaveTimer);
    settingsSaveTimer = undefined;
    void saveSettingsNow();
  }
});
watch(useChatChangedTick(), refreshAll);
watch(useChatMutationTick(), refreshAfterChatMutation);
watch(runtime.settings, settings => {
  // 每次刷新快照都会产生新的 settings 引用；只有持久化内容真的变了（保存成功、切换聊天）
  // 才重建草稿。否则运行期间的每次状态刷新都会把用户尚未保存的改动悄悄冲掉。
  const persistedJson = settings ? JSON.stringify(cloneSettings(settings)) : '';
  if (persistedJson === lastPersistedSettingsJson && settingsDraft.value) return;
  settingsDraft.value = settings ? cloneSettings(settings) : null;
  lastPersistedSettingsJson = persistedJson;
}, { immediate: true });
watch(settingsDraft, () => {
  if (!settingsDraft.value) return;
  if (JSON.stringify(settingsDraft.value) === lastPersistedSettingsJson) return;
  scheduleSettingsSave();
}, { deep: true });
</script>

<style scoped>
.acu-v2-world-simulation-page { min-height: 100%; padding: 20px; display: grid; gap: 18px; }
.acu-v2-world-simulation-page__layout { align-items: start; }
.acu-v2-world-simulation-page :deep(.acu-panel__header) { justify-content: center; }
.acu-v2-world-simulation-page :deep(.acu-panel__title) { text-align: center; }
.acu-v2-world-simulation-page__world-state :deep(.acu-panel__header) { display: grid; grid-template-columns: 1fr minmax(0, auto) 1fr; align-items: start; }
.acu-v2-world-simulation-page__world-state :deep(.acu-panel__title) { grid-column: 2; min-width: 0; text-align: center; }
.acu-v2-world-simulation-page__world-state :deep(.acu-panel__header-right) { grid-column: 3; justify-self: end; }
.acu-v2-world-simulation-page__world-title { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.acu-v2-world-simulation-page__world-title:focus-visible { outline: 2px solid var(--acu-accent); outline-offset: 5px; border-radius: 4px; }
.acu-v2-world-simulation-page__floor { color: var(--acu-text-3); font-size: var(--acu-font-size-caption, 11px); font-weight: 400; overflow-wrap: anywhere; }
.acu-v2-world-simulation-page :deep(summary) { list-style: none; }
.acu-v2-world-simulation-page :deep(summary::marker) { content: ''; }
.acu-v2-world-simulation-page :deep(summary::-webkit-details-marker) { display: none; }
.acu-v2-world-simulation-page :deep(.acu-disclosure-group__chevron) { display: none; }
.acu-v2-world-simulation-page__diagnostics { min-width: 0; padding: 12px 16px; border: 1px solid var(--acu-border-2); border-radius: var(--acu-radius-sm); color: var(--acu-text-3); font-size: var(--acu-font-size-body, 12px); }
.acu-v2-world-simulation-page__diagnostics > summary { cursor: pointer; }
.acu-v2-world-simulation-page__diagnostics > p, .acu-v2-world-simulation-page__diagnostics > ul { margin-top: 10px; }
.acu-v2-world-simulation-page__diagnostics li { white-space: pre-wrap; overflow-wrap: anywhere; }
.acu-v2-world-simulation-page__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.acu-v2-world-simulation-page__actions--start { justify-content: flex-start; margin-top: 0; margin-bottom: 12px; }
.acu-v2-world-simulation-page__file-input { display: none; }
.acu-v2-world-simulation-page__error { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0; color: var(--acu-danger, #d65b5b); white-space: pre-wrap; }
.acu-v2-world-simulation-page__meta { margin: 0; color: var(--acu-text-3); font-size: var(--acu-font-size-body, 12px); white-space: pre-wrap; }
.acu-v2-world-simulation-page__settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-items: start; }
.acu-v2-world-simulation-page__toggles { margin-top: 14px; }
.acu-v2-world-simulation-page__auto-trigger { width: 100%; flex-direction: row-reverse; justify-content: space-between; align-items: center; }
.acu-v2-world-simulation-page__channel-fields { display: grid; gap: 12px; }
.acu-v2-world-simulation-page__channels { border: 0; background: var(--acu-bg-2); }
.acu-v2-world-simulation-page__channels :deep(.acu-disclosure-group__header) { min-height: var(--acu-control-height-md, 32px); padding: var(--acu-control-padding-y-md, 6px) var(--acu-control-padding-x-md, 9px); }
.acu-v2-world-simulation-page__channels :deep(.acu-disclosure-group__label) { font-size: var(--acu-font-size-body, 12px); font-weight: 400; color: var(--acu-text-2); }
.acu-v2-world-simulation-page__groups { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
.acu-v2-world-simulation-page__group {
  border: 1px solid var(--acu-border, color-mix(in srgb, var(--acu-text-3) 18%, transparent));
  border-radius: var(--acu-radius-sm);
  background: color-mix(in srgb, var(--acu-bg-2) 72%, transparent);
}
.acu-v2-world-simulation-page__group :deep(.acu-disclosure-group__header) { border-radius: var(--acu-radius-sm); }
.acu-v2-world-simulation-page__group :deep(.acu-disclosure-group--expanded .acu-disclosure-group__header) { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
.acu-v2-world-simulation-page__group :deep(.acu-disclosure-group__body) { gap: 12px; padding: 12px; }
.acu-v2-world-simulation-page__group :deep(.acu-disclosure-group__meta) { max-width: 55%; overflow: hidden; text-overflow: ellipsis; }
.acu-v2-world-simulation-page__group .acu-v2-world-simulation-page__actions { margin-top: 0; }
.acu-v2-world-simulation-page__subheading { margin: 4px 0 0; color: var(--acu-text-2); font-size: var(--acu-font-size-body, 12px); font-weight: 600; }
.acu-v2-world-simulation-page__subheading:first-child { margin-top: 0; }
.acu-v2-world-simulation-page__prompt-segment { display: grid; gap: 8px; padding: 10px; border: 1px solid var(--acu-border, color-mix(in srgb, var(--acu-text-3) 18%, transparent)); border-radius: var(--acu-radius-sm); }
.acu-v2-world-simulation-page__prompt-segment-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.acu-v2-world-simulation-page__prompt-textarea { width: 100%; min-height: 96px; box-sizing: border-box; resize: vertical; padding: 8px; color: var(--acu-text-1); background: var(--acu-bg-1); border: 1px solid var(--acu-border, color-mix(in srgb, var(--acu-text-3) 24%, transparent)); border-radius: var(--acu-radius-sm); font: inherit; }
@media (max-width: 860px) { .acu-v2-world-simulation-page { padding: 14px; } }
@media (max-width: 640px) {
  .acu-v2-world-simulation-page { padding: 10px; gap: 12px; }
  .acu-v2-world-simulation-page__settings-grid { grid-template-columns: 1fr; }
  .acu-v2-world-simulation-page__actions > * { flex: 1 1 auto; }
  .acu-v2-world-simulation-page__group :deep(.acu-disclosure-group__meta) { display: none; }
}
</style>
