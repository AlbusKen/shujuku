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
 * - 延迟 1500ms 执行刷新（旧 init.ts 的 CHAT_CHANGED 回调内有 1200ms setTimeout，
 *   需要等它完成后再读取最新状态）
 * - 同时递增全局 chatChangedTick，供非 Pinia 的页面级 composable watch
 */
import { onBeforeUnmount, ref, type Ref } from 'vue';
import { SillyTavern_API_ACU } from '../../shared/host-api';
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

  function onChatChanged(chatFileName: string): void {
    logDebug_ACU(`[ACU-V2] CHAT_CHANGED 收到: "${chatFileName}"，将延迟刷新 v2 store`);

    if (pendingTimer) clearTimeout(pendingTimer);

    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      logDebug_ACU('[ACU-V2] CHAT_CHANGED 延迟刷新开始');
      try {
        usePlotPresetStore().refreshFromSettings();
        useApiPresetStore().refreshFromSettings();
        useImportFlowStore().refreshFromSettings();
      } catch (e) {
        logWarn_ACU('[ACU-V2] CHAT_CHANGED 刷新 store 异常', e);
      }
      chatChangedTick.value++;
    }, 1500);
  }

  eventSource.on(eventTypes.CHAT_CHANGED, onChatChanged);
  for (const eventName of mutationEventNames) eventSource.on(eventName, onChatMutated);

  onBeforeUnmount(() => {
    if (pendingTimer) clearTimeout(pendingTimer);
    if (mutationTimer) clearTimeout(mutationTimer);
    try {
      eventSource.removeListener(eventTypes.CHAT_CHANGED, onChatChanged);
      for (const eventName of mutationEventNames) eventSource.removeListener(eventName, onChatMutated);
    } catch { /* ignore */ }
  });
}
