/**
 * useChatChangedListener — 订阅酒馆 CHAT_CHANGED 事件，驱动 v2 store/composable 刷新
 *
 * 根因：settings_ACU / currentChatFileIdentifier_ACU 是普通 JS 变量，
 * 被旧 init.ts 的 CHAT_CHANGED 回调更新后，Vue 无法感知变化。
 * 本 composable 在 CHAT_CHANGED 触发后，延迟调用各 store 的 refreshFromSettings()，
 * 使已挂载的页面组件能够拿到最新数据。
 *
 * 设计：
 * - 在 App.vue setup 中调用一次 `useChatChangedListener()`
 * - 内部通过 SillyTavern_API_ACU.eventSource 订阅
 * - onBeforeUnmount 时自动取消订阅
 * - 旧 init.ts 的 CHAT_CHANGED 链路完成派生数据重建后会发出显式完成信号
 *   （shared/chat-runtime-reload-signal），收到与最近一次 CHAT_CHANGED 同名的信号才刷新；
 *   旧链路异常未发信号时由兜底计时器刷新一次
 * - 同时递增全局 chatChangedTick，供非 Pinia 的页面级 composable watch
 */
import { onBeforeUnmount, ref, type Ref } from 'vue';
import { SillyTavern_API_ACU } from '../../shared/host-api';
import { subscribeChatRuntimeReloaded_ACU } from '../../shared/chat-runtime-reload-signal';
import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { useApiPresetStore } from '../stores/api-preset-store';
import { usePlotPresetStore } from '../stores/plot-preset-store';
import { useImportFlowStore } from '../stores/import-flow-store';

/** 模块级响应式计数器，每次 CHAT_CHANGED 延迟刷新完成后 +1。 */
const chatChangedTick = ref(0);

/**
 * 当前聊天内楼层被删除 / 重新生成（swipe）后 +1。
 * 与聊天切换分开计数：切聊天要重建整套 store，楼层变动只需要按楼层锚定的数据重读一遍。
 */
const chatMutationTick = ref(0);

/** 楼层删除会连发事件（批量删除、regenerate 先删后生成），短窗口聚合成一次刷新。 */
const CHAT_MUTATION_DEBOUNCE_MS = 300;

/** 旧链路未发出完成信号时的兜底刷新延迟。 */
const CHAT_CHANGED_FALLBACK_REFRESH_MS = 10_000;

/** 页面级 composable 可 watch 此 ref 来响应聊天切换。 */
export function useChatChangedTick(): Ref<number> {
  return chatChangedTick;
}

/** 页面级 composable 可 watch 此 ref 来响应当前聊天内的楼层删除 / swipe。 */
export function useChatMutationTick(): Ref<number> {
  return chatMutationTick;
}

export function useChatChangedListener(): void {
  const eventSource = SillyTavern_API_ACU?.eventSource;
  const eventTypes = SillyTavern_API_ACU?.eventTypes;

  if (!eventSource || !eventTypes?.CHAT_CHANGED) {
    logWarn_ACU('[ACU-V2] useChatChangedListener: eventSource 不可用，跳过订阅');
    return;
  }

  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let mutationTimer: ReturnType<typeof setTimeout> | null = null;
  /** 最近一次 CHAT_CHANGED 的聊天名；null 表示没有待完成的切换。 */
  let pendingChatFileName: string | null = null;

  function onChatMutated(): void {
    if (mutationTimer) clearTimeout(mutationTimer);
    mutationTimer = setTimeout(() => {
      mutationTimer = null;
      chatMutationTick.value++;
    }, CHAT_MUTATION_DEBOUNCE_MS);
  }

  const mutationEventNames = (['MESSAGE_DELETED', 'MESSAGE_SWIPED'] as const)
    .map(name => (eventTypes as Record<string, string | undefined>)[name])
    .filter((name): name is string => typeof name === 'string' && name.length > 0);

  function runChatChangedRefresh(): void {
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = null;
    pendingChatFileName = null;
    logDebug_ACU('[ACU-V2] CHAT_CHANGED 刷新开始');
    try {
      usePlotPresetStore().refreshFromSettings();
      useApiPresetStore().refreshFromSettings();
      useImportFlowStore().refreshFromSettings();
    } catch (e) {
      logWarn_ACU('[ACU-V2] CHAT_CHANGED 刷新 store 异常', e);
    }
    chatChangedTick.value++;
  }

  function onChatChanged(chatFileName: string): void {
    logDebug_ACU(`[ACU-V2] CHAT_CHANGED 收到: "${chatFileName}"，等待旧链路完成信号后刷新 v2 store`);
    pendingChatFileName = String(chatFileName ?? '');
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      logWarn_ACU('[ACU-V2] 未收到 CHAT_CHANGED 完成信号，按兜底超时刷新 v2 store');
      runChatChangedRefresh();
    }, CHAT_CHANGED_FALLBACK_REFRESH_MS);
  }

  function onChatRuntimeReloaded(chatFileName: string): void {
    // 被后续切换取代的旧链路信号不触发刷新：只认最近一次 CHAT_CHANGED。
    if (pendingChatFileName === null || chatFileName !== pendingChatFileName) return;
    runChatChangedRefresh();
  }

  const unsubscribeReloaded = subscribeChatRuntimeReloaded_ACU(onChatRuntimeReloaded);
  eventSource.on(eventTypes.CHAT_CHANGED, onChatChanged);
  for (const eventName of mutationEventNames) eventSource.on(eventName, onChatMutated);

  onBeforeUnmount(() => {
    if (pendingTimer) clearTimeout(pendingTimer);
    if (mutationTimer) clearTimeout(mutationTimer);
    unsubscribeReloaded();
    try {
      eventSource.removeListener(eventTypes.CHAT_CHANGED, onChatChanged);
      for (const eventName of mutationEventNames) eventSource.removeListener(eventName, onChatMutated);
    } catch { /* ignore */ }
  });
}
