<template>
  <div ref="feedElement" class="wsc-feed">
    <p v-if="!entries.length" class="wsc-feed__empty">
      还没有会话记录。发送补充后，主 Agent 的派工和受控提交结果会显示在这里。
    </p>
    <button v-if="hiddenCount > 0" type="button" class="wsc-feed__fold" @click="expandOlder">
      已折叠 {{ hiddenCount }} 条更早消息 · 点击展开更早的 {{ nextExpandCount }} 条
    </button>
    <template v-for="entry in visibleEntries" :key="entry.id">
      <div v-if="entry.kind === 'run_started'" class="wsc-feed__run-divider">
        <span class="wsc-feed__run-divider-badge">开始运行</span>
        <span class="wsc-feed__run-divider-title">{{ entry.title }}</span>
        <span class="wsc-feed__time">{{ formatTime(entry.at) }}</span>
      </div>
      <div v-else-if="entry.kind === 'user_message'" class="wsc-feed__user">
        <div class="wsc-feed__user-bubble">
          <p class="wsc-feed__user-text">{{ entry.detail || entry.title }}</p>
          <span class="wsc-feed__time">{{ formatTime(entry.at) }}</span>
        </div>
      </div>
      <div v-else class="wsc-feed__card" :class="[`wsc-feed__card--${entry.kind}`, `wsc-feed__card--${entry.status}`]">
        <button type="button" class="wsc-feed__card-head" @click="toggle(entry)">
          <span class="wsc-feed__status" :class="`wsc-feed__status--${entry.status}`">
            <span v-if="entry.status === 'running'" class="wsc-feed__spinner" />
            <template v-else-if="entry.status === 'failed'">✕</template>
            <template v-else>✓</template>
          </span>
          <span class="wsc-feed__badge">{{ kindLabel(entry) }}</span>
          <span class="wsc-feed__title">{{ entry.title }}</span>
          <span class="wsc-feed__time">{{ formatTime(entry.at) }}</span>
          <span v-if="entry.detail" class="wsc-feed__chevron" :class="{ 'wsc-feed__chevron--open': isExpanded(entry) }">▾</span>
        </button>
        <p v-if="entry.detail && !isExpanded(entry)" class="wsc-feed__preview" @click="toggle(entry)">{{ entry.detail }}</p>
        <p v-if="entry.detail && isExpanded(entry)" class="wsc-feed__detail">{{ entry.detail }}</p>
      </div>
    </template>
    <div v-if="running" class="wsc-feed__running">
      <span class="wsc-feed__pulse" />世界推演 Agent 正在工作…
    </div>
  </div>
</template>


<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { WorldSimulationSessionEntry_ACU } from '../../service/simulation/world-simulation-agent-session-log';

const props = defineProps<{ entries: WorldSimulationSessionEntry_ACU[]; running: boolean }>();

const feedElement = ref<HTMLElement | null>(null);
const expandedOverrides = ref<Record<number, boolean>>({});

const FOLD_VISIBLE_STEP_ACU = 40;
const visibleLimit = ref(FOLD_VISIBLE_STEP_ACU);
const hiddenCount = computed(() => Math.max(0, props.entries.length - visibleLimit.value));
const visibleEntries = computed(() => (hiddenCount.value > 0 ? props.entries.slice(hiddenCount.value) : props.entries));
const nextExpandCount = computed(() => Math.min(FOLD_VISIBLE_STEP_ACU, hiddenCount.value));

async function expandOlder(): Promise<void> {
  const element = feedElement.value;
  const beforeHeight = element?.scrollHeight ?? 0;
  visibleLimit.value += FOLD_VISIBLE_STEP_ACU;
  await nextTick();
  if (element) element.scrollTop += element.scrollHeight - beforeHeight;
}

const KIND_LABELS: Record<WorldSimulationSessionEntry_ACU['kind'], string> = {
  run_started: '开始',
  user_message: '你',
  main_action: '主 Agent',
  delegation: '子代理',
  rebase: '回退',
  run_failed: '失败',
  run_completed: '完成',
};

function kindLabel(entry: WorldSimulationSessionEntry_ACU): string {
  if (entry.kind === 'delegation' && entry.agentName) return entry.agentName;
  return KIND_LABELS[entry.kind];
}

function defaultExpanded(entry: WorldSimulationSessionEntry_ACU): boolean {
  if (entry.status === 'failed') return true;
  return entry.kind === 'run_completed' || entry.kind === 'run_failed' || entry.kind === 'rebase';
}

function isExpanded(entry: WorldSimulationSessionEntry_ACU): boolean {
  return expandedOverrides.value[entry.id] ?? defaultExpanded(entry);
}

function toggle(entry: WorldSimulationSessionEntry_ACU): void {
  if (!entry.detail) return;
  expandedOverrides.value = { ...expandedOverrides.value, [entry.id]: !isExpanded(entry) };
}

function formatTime(at: number): string { return new Date(at).toLocaleTimeString(); }

watch(() => props.entries.length, async (length, previous) => {
  if (length < (previous ?? 0)) visibleLimit.value = FOLD_VISIBLE_STEP_ACU;
  await nextTick();
  const element = feedElement.value;
  if (element) element.scrollTop = element.scrollHeight;
});
</script>


<style scoped>
.wsc-feed { display: flex; flex-direction: column; gap: 6px; max-height: 420px; overflow-y: auto; padding: 12px; border: 1px solid color-mix(in srgb, var(--acu-text-3) 20%, transparent); border-radius: 8px; background: color-mix(in srgb, var(--acu-bg-2) 60%, transparent); }
.wsc-feed > * { flex: 0 0 auto; }
.wsc-feed__empty { margin: 0; padding: 16px 8px; color: var(--acu-text-3); text-align: center; font-size: var(--acu-font-size-body, 12px); }
.wsc-feed__fold { padding: 6px 10px; border: 1px dashed color-mix(in srgb, var(--acu-text-3) 40%, transparent); border-radius: 8px; background: transparent; color: var(--acu-text-3); font: inherit; font-size: var(--acu-font-size-caption, 11px); cursor: pointer; text-align: center; }
.wsc-feed__fold:hover { color: var(--acu-text-2); border-color: color-mix(in srgb, var(--acu-text-3) 60%, transparent); }
.wsc-feed__run-divider { display: flex; align-items: center; gap: 8px; padding: 4px 2px; margin-top: 4px; }
.wsc-feed__run-divider::after { content: ''; flex: 1; height: 1px; background: color-mix(in srgb, var(--acu-text-3) 24%, transparent); }
.wsc-feed__run-divider-badge { flex: none; padding: 1px 8px; border-radius: 999px; background: color-mix(in srgb, var(--acu-primary, #5b8def) 18%, transparent); color: var(--acu-primary, #5b8def); font-size: var(--acu-font-size-caption, 11px); }
.wsc-feed__run-divider-title { color: var(--acu-text-2); font-size: var(--acu-font-size-body, 12px); }
.wsc-feed__user { display: flex; justify-content: flex-end; padding: 4px 2px; }
.wsc-feed__user-bubble { max-width: 82%; padding: 7px 11px; border-radius: 10px 10px 2px 10px; background: color-mix(in srgb, var(--acu-primary, #5b8def) 16%, var(--acu-bg-2)); border: 1px solid color-mix(in srgb, var(--acu-primary, #5b8def) 28%, transparent); }
.wsc-feed__user-text { margin: 0; color: var(--acu-text-1); font-size: var(--acu-font-size-body-lg, 13px); white-space: pre-wrap; word-break: break-word; }
.wsc-feed__user-bubble .wsc-feed__time { display: block; margin: 3px 0 0; text-align: right; }
.wsc-feed__card { border: 1px solid color-mix(in srgb, var(--acu-text-3) 16%, transparent); border-radius: 8px; background: var(--acu-bg-2); animation: wsc-feed-in 0.18s ease-out; overflow: hidden; }
.wsc-feed__card--delegation { margin-left: 16px; }
.wsc-feed__card--run_completed { border-left: 3px solid color-mix(in srgb, var(--acu-success, #4fa36c) 75%, transparent); background: color-mix(in srgb, var(--acu-success, #4fa36c) 7%, var(--acu-bg-2)); }
.wsc-feed__card--failed, .wsc-feed__card--run_failed { border-left: 3px solid color-mix(in srgb, var(--acu-danger, #d65b5b) 75%, transparent); background: color-mix(in srgb, var(--acu-danger, #d65b5b) 6%, var(--acu-bg-2)); }
.wsc-feed__card--running { border-left: 3px solid color-mix(in srgb, var(--acu-primary, #5b8def) 60%, transparent); }
.wsc-feed__card--rebase { border-left: 3px solid color-mix(in srgb, #c9963e 75%, transparent); background: color-mix(in srgb, #c9963e 7%, var(--acu-bg-2)); }
.wsc-feed__card-head { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 10px; border: none; background: transparent; cursor: pointer; text-align: left; font: inherit; color: inherit; }
.wsc-feed__status { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%; font-size: 10px; }
.wsc-feed__status--done { background: color-mix(in srgb, var(--acu-success, #4fa36c) 20%, transparent); color: var(--acu-success, #4fa36c); }
.wsc-feed__status--failed { background: color-mix(in srgb, var(--acu-danger, #d65b5b) 20%, transparent); color: var(--acu-danger, #d65b5b); }
.wsc-feed__status--running { background: transparent; }
.wsc-feed__spinner { width: 12px; height: 12px; border: 2px solid color-mix(in srgb, var(--acu-primary, #5b8def) 30%, transparent); border-top-color: var(--acu-primary, #5b8def); border-radius: 50%; animation: wsc-feed-spin 0.8s linear infinite; }
.wsc-feed__badge { flex: none; padding: 1px 7px; border-radius: 999px; background: color-mix(in srgb, var(--acu-text-3) 18%, transparent); color: var(--acu-text-2); font-size: var(--acu-font-size-caption, 11px); }
.wsc-feed__title { color: var(--acu-text-1); font-size: var(--acu-font-size-body-lg, 13px); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wsc-feed__time { margin-left: auto; flex: none; color: var(--acu-text-3); font-size: var(--acu-font-size-caption, 11px); }
.wsc-feed__chevron { flex: none; color: var(--acu-text-3); font-size: 10px; transition: transform 0.15s ease; }
.wsc-feed__chevron--open { transform: rotate(180deg); }
.wsc-feed__preview { margin: 0; padding: 0 10px 7px 34px; color: var(--acu-text-3); font-size: var(--acu-font-size-body, 12px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.wsc-feed__detail { margin: 0; padding: 0 10px 8px 34px; color: var(--acu-text-2); font-size: var(--acu-font-size-body, 12px); white-space: pre-wrap; word-break: break-word; }
.wsc-feed__running { display: flex; align-items: center; gap: 8px; padding: 6px 10px; color: var(--acu-text-2); font-size: var(--acu-font-size-body, 12px); }
.wsc-feed__pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--acu-primary, #5b8def); animation: wsc-feed-pulse 1.1s ease-in-out infinite; }
@media (max-width: 640px) {
  .wsc-feed { max-height: 62vh; padding: 8px; }
  .wsc-feed__card--delegation { margin-left: 8px; }
  .wsc-feed__card-head { padding: 7px 8px; gap: 6px; }
  .wsc-feed__preview { padding: 0 8px 7px 12px; }
  .wsc-feed__detail { padding: 0 8px 8px 12px; }
  .wsc-feed__user-bubble { max-width: 94%; }
}
@keyframes wsc-feed-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes wsc-feed-pulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
@keyframes wsc-feed-spin { to { transform: rotate(360deg); } }
</style>
