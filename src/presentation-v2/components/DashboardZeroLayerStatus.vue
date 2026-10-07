<template>
  <div class="acu-dashboard-zero-layer" data-acu-zero-layer-status aria-live="polite">
    <div class="acu-dashboard-zero-layer__head">
      <strong>零层卡模式 · 当前聊天</strong>
      <AcuBadge :variant="badgeVariant">{{ status.view.value.label }}</AcuBadge>
    </div>
    <p>{{ intentLabel }}</p>
    <p>{{ status.view.value.detail }}</p>
    <p v-if="status.view.value.revision !== null">
      存档版本 {{ status.view.value.revision }} · 当前逻辑 head：{{ status.view.value.headTurnId ?? '尚无已发布回合' }}
    </p>
    <AcuSelect v-model="preset" :options="presetOptions" size="sm" placeholder="选择正文独立 API 预设"
      :disabled="locked || status.view.value.intent === true" />
    <AcuToggle :model-value="status.view.value.intent === true" label="当前聊天启用零层"
      :disabled="!!enableBlockedReason" :title="enableBlockedReason || undefined"
      @update:model-value="value => status.setEnabled(value, preset)" />
    <p v-if="status.view.value.intent === false">{{ activationHint }}</p>
    <label for="acu-zero-layer-wi-rounds">最近几轮零层对话参与世界书扫描（全局，0 为关闭）</label>
    <AcuInput id="acu-zero-layer-wi-rounds" v-model="worldInfoRounds" type="number" size="sm"
      :min="0" :max="100" :step="1" @change="commitWorldInfoRounds" />
    <p>一轮是一个 AI 回复，其间的用户输入一并参与扫描；本轮输入始终参与。只用于激活世界书条目，不进入提示词，下一回合生效。</p>
    <div class="acu-dashboard-zero-layer__actions">
      <AcuButton size="sm" :disabled="locked" @click="refresh">只读刷新状态</AcuButton>
      <AcuButton size="sm" :disabled="locked" @click="status.recover()">回读并恢复已存阶段</AcuButton>
      <AcuButton size="sm" @click="status.stop()">停止零层任务</AcuButton>
      <AcuButton size="sm" :disabled="locked || !status.controls.value.canExit" @click="status.exit()">确认退出到普通模式</AcuButton>
    </div>
    <template v-if="status.controls.value.pendingTurn">
      <p>未闭合回合 {{ status.controls.value.pendingTurn.turnId }} · {{ pendingPhaseLabel }}：正文未保存。放弃只记为取消并保留记录，不会重新请求模型；续写回合优先从续写面板恢复。</p>
      <AcuButton size="sm" :disabled="locked" @click="status.abandon()">确认放弃未保存回合（不重发）</AcuButton>
    </template>
    <p v-if="status.actionError.value" class="acu-dashboard-zero-layer__error" role="alert">{{ status.actionError.value }}</p>
    <label for="acu-zero-layer-input">本轮输入</label>
    <AcuInput id="acu-zero-layer-input" v-model="input" placeholder="输入游戏行动；失败或停止后保留草稿" :disabled="status.working.value" />
    <AcuButton size="sm" :disabled="!!sendBlockedReason" :title="sendBlockedReason || undefined"
      :aria-describedby="sendBlockedReason ? 'acu-zero-layer-send-hint' : undefined" @click="send">发送逻辑回合</AcuButton>
    <p v-if="sendBlockedReason" id="acu-zero-layer-send-hint">{{ sendBlockedReason }}</p>
    <details v-if="status.controls.value.branches.length">
      <summary>分支与只读历史</summary>
      <div class="acu-dashboard-zero-layer__tools">
        <AcuSelect v-model="branch" :options="status.controls.value.branches" size="sm" :disabled="locked" />
        <AcuButton size="sm" :disabled="locked || !status.controls.value.canSend" @click="status.selectBranch(branch)">切换所选分支</AcuButton>
        <AcuSelect v-model="head" :options="status.controls.value.heads" size="sm" placeholder="分叉切点" :disabled="locked" />
        <AcuInput v-model="newBranch" placeholder="新分支名称（不覆盖已有分支）" :disabled="locked" />
        <AcuButton size="sm" :disabled="locked || !status.controls.value.canSend || !newBranch.trim()"
          @click="status.forkBranch(newBranch.trim(), head)">从所选切点分叉</AcuButton>
        <AcuToggle v-model="diagnostic" label="宿主诊断：包含未发布回合" :disabled="locked || status.historyLoading.value" />
        <AcuButton size="sm" :disabled="locked || status.historyLoading.value || !branch"
          @click="status.loadHistory(branch, diagnostic)">读取所选分支历史</AcuButton>
        <p v-if="status.historyError.value" role="alert">{{ status.historyError.value }}</p>
        <AcuButton v-if="status.historyHasMore.value" size="sm" :disabled="locked || status.historyLoading.value"
          @click="status.loadHistory(branch, diagnostic, true)">读取更早回合</AcuButton>
        <details v-for="turn in status.history.value" :key="turn.turnId">
          <summary>{{ turn.turnId }}{{ turn.diagnostic ? ` · ${turn.diagnostic.phase}` : '' }}</summary>
          <p>{{ turn.input }}</p>
          <pre>{{ turn.body }}</pre>
        </details>
      </div>
    </details>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import AcuBadge from './_lib/AcuBadge.vue';
import AcuButton from './_lib/AcuButton.vue';
import AcuToggle from './_lib/AcuToggle.vue';
import AcuSelect from './_lib/AcuSelect.vue';
import AcuInput from './_lib/AcuInput.vue';
import { useApiPresetStore } from '../stores/api-preset-store';
import { useZeroLayerStatus } from '../composables/useZeroLayerStatus';

const status = useZeroLayerStatus();
const presets = useApiPresetStore();
const preset = ref('');
const input = ref('');
const branch = ref('');
const head = ref('');
const newBranch = ref('');
const diagnostic = ref(false);
const worldInfoRounds = ref<string | number>(status.worldInfoScanRounds.value);
watch(() => status.worldInfoScanRounds.value, value => { worldInfoRounds.value = value; });
function commitWorldInfoRounds(value: string | number) {
  // 非法输入不保存，输入框回到当前生效值。
  if (!status.setWorldInfoScanRounds(value)) worldInfoRounds.value = status.worldInfoScanRounds.value;
}
const locked = computed(() => status.working.value || status.view.value.status === 'loading');
const presetOptions = computed(() => presets.presets.filter(item => item.apiMode === 'custom'
  && !item.apiConfig.useMainApi && !item.apiConfig.sendViaTavern && item.apiConfig.url && item.apiConfig.model)
  .map(item => ({ value: item.name, label: item.name })));
const enableBlockedReason = computed(() => {
  if (status.working.value) return '零层操作进行中，请等待完成或停止任务。';
  if (status.view.value.status === 'loading') return '正在读取当前聊天状态。';
  if (status.view.value.intent === null) return status.view.value.detail;
  if (!status.view.value.intent && !presetOptions.value.some(item => item.value === preset.value)) {
    return '请先选择可用的正文独立 API 预设。';
  }
  return '';
});
const activationHint = computed(() => !presetOptions.value.length
  ? '请先在 API 页配置直连预设（端点与模型），再选择预设并打开“当前聊天启用零层”。'
  : '先选择正文独立 API 预设，打开“当前聊天启用零层”，再输入行动并发送逻辑回合。');
const sendBlockedReason = computed(() => {
  if (status.working.value) return '零层操作进行中，请等待完成或停止任务。';
  if (status.view.value.status === 'loading') return '正在读取当前聊天状态。';
  if (status.view.value.intent === null) return status.view.value.detail;
  if (!status.controls.value.canSend) return status.view.value.status === 'disabled'
    ? '当前聊天尚未启用零层，请先打开上方启用开关；输入草稿会保留。'
    : status.view.value.detail;
  if (!input.value.trim()) return '请输入本轮行动。';
  return '';
});
watch(() => status.controls.value, value => {
  presets.refreshFromSettings();
  preset.value = value.apiPresetName || preset.value;
  branch.value = value.branchId;
  if (!value.heads.some(item => item.value === head.value)) head.value = '';
});
async function refresh() { presets.refreshFromSettings(); await status.refresh(); }
async function send() {
  if (sendBlockedReason.value) return;
  const draft = input.value;
  if (await status.submit(draft) && input.value === draft) input.value = '';
}
const pendingPhaseLabel = computed(() => ({ prepared: '准备未完成', dispatching: '发送中断',
  'delivery-unknown': '发送结果未知' })[status.controls.value.pendingTurn?.phase ?? 'prepared']);
const intentLabel = computed(() => status.view.value.intent === null ? '聊天级开启意图：未确认'
  : status.view.value.intent ? '聊天级开启意图：已开启' : '聊天级开启意图：关闭');
const badgeVariant = computed(() => status.view.value.status === 'storage-read-failed' ? 'danger'
  : status.view.value.status === 'recovery-required' ? 'warning' : 'neutral');
</script>

<style scoped>
.acu-dashboard-zero-layer {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
}
.acu-dashboard-zero-layer__head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.acu-dashboard-zero-layer strong {
  font-size: var(--acu-font-size-body-lg, 13px);
  font-weight: 500;
}
.acu-dashboard-zero-layer p {
  margin: 0;
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-caption, 11px);
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.acu-dashboard-zero-layer p.acu-dashboard-zero-layer__error { color: var(--acu-danger); font-size: var(--acu-font-size-body, 12px); }
.acu-dashboard-zero-layer__actions { display: flex; flex-wrap: wrap; gap: 6px; }
.acu-dashboard-zero-layer__tools { display: flex; flex-direction: column; gap: 8px; padding-top: 8px; }
.acu-dashboard-zero-layer > .acu-select,
.acu-dashboard-zero-layer > .acu-input-shell,
.acu-dashboard-zero-layer > details { width: 100%; }
.acu-dashboard-zero-layer summary { cursor: pointer; overflow-wrap: anywhere; }
.acu-dashboard-zero-layer pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
</style>
