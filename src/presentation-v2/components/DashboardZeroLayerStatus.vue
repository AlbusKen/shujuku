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
    <AcuButton size="sm" :disabled="status.view.value.status === 'loading'" @click="status.refresh()">
      只读刷新状态
    </AcuButton>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import AcuBadge from './_lib/AcuBadge.vue';
import AcuButton from './_lib/AcuButton.vue';
import { useZeroLayerStatus } from '../composables/useZeroLayerStatus';

const status = useZeroLayerStatus();
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
</style>
